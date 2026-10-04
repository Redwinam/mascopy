mod analyzer;
mod app_update;
mod config;
mod eagle;
mod error;
mod imaging;
mod media;
mod metadata;
mod scanner;
mod storage;
mod tether;
mod uploader;

use analyzer::Analyzer;
use config::{Config, ConfigManager};
use error::{AppError, AppResult};
use scanner::{MediaFile, Scanner};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, State, Window};
use tokio::sync::Semaphore;
use uploader::Uploader;

struct AppState {
    config_manager: ConfigManager,
    uploader: Arc<Uploader>,
    // 限制并发的 sips/解码任务数，避免滚动缩略图时进程风暴
    imaging_semaphore: Arc<Semaphore>,
    // 同一张图连续裁剪时复用转码结果（仅内存，单槽）
    crop_source_cache: Arc<imaging::CropSourceCache>,
    // 联机拍摄会话（监听/FTP）
    tether: tether::TetherState,
}

#[tauri::command]
fn get_config(state: State<AppState>) -> AppResult<Config> {
    state
        .config_manager
        .load()
        .map_err(|e| AppError::Config(e.to_string()))
}

#[tauri::command]
fn save_config(state: State<AppState>, config: Config) -> AppResult<()> {
    state
        .config_manager
        .save(&config)
        .map_err(|e| AppError::Config(e.to_string()))
}

#[derive(Deserialize)]
struct ScanArgs {
    #[serde(alias = "sourceDir")]
    source_dir: String,
    #[serde(alias = "targetDir")]
    target_dir: String,
    #[serde(default, alias = "overwriteDuplicates")]
    overwrite_duplicates: bool,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default, alias = "fastMode")]
    fast_mode: Option<bool>,
    #[serde(default, alias = "ignoreThumbnails")]
    ignore_thumbnails: Option<bool>,
}

#[tauri::command]
async fn scan_files(args: ScanArgs, window: Window) -> AppResult<Vec<MediaFile>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut last = std::time::Instant::now();
        let mut previous = ("", String::new());
        let mut emit = |payload: scanner::ScanProgress| {
            let key = (payload.phase, payload.filename.clone());
            if key != previous
                || last.elapsed() >= std::time::Duration::from_millis(120)
                || payload.bytes_done == payload.bytes_total && payload.bytes_total > 0
            {
                previous = key;
                last = std::time::Instant::now();
                let _ = window.emit("scan-progress", payload);
            }
        };
        let (source, target) =
            scanner::validate_roots(Path::new(&args.source_dir), Path::new(&args.target_dir))
                .map_err(AppError::Scan)?;
        let mode = args.mode.as_deref().unwrap_or("sd");
        if !matches!(mode, "sd" | "dji") {
            return Err(AppError::Scan("未知扫描模式".into()));
        }
        let mut files = Scanner::with_mode(mode)
            .scan_with_progress(
                &source.to_string_lossy(),
                args.fast_mode.unwrap_or(false),
                args.ignore_thumbnails.unwrap_or(true),
                &mut emit,
            )
            .map_err(AppError::Scan)?;
        Analyzer::analyze_with_progress(
            &mut files,
            &target.to_string_lossy(),
            args.overwrite_duplicates,
            &mut emit,
        )
        .map_err(AppError::Analyze)?;
        Ok(files)
    })
    .await
    .map_err(|e| AppError::Scan(e.to_string()))?
}

#[tauri::command]
async fn upload_files(
    files: Vec<MediaFile>,
    target_dir: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<uploader::UploadOutcome> {
    // Acquire before queueing blocking IO so an immediate cancellation belongs to this task.
    let session = state.uploader.start().map_err(AppError::Upload)?;
    tauri::async_runtime::spawn_blocking(move || {
        session
            .run(files, PathBuf::from(target_dir), |payload| {
                let _ = window.emit("upload-progress", payload);
            })
            .map_err(AppError::Upload)
    })
    .await
    .map_err(|e| AppError::Upload(e.to_string()))?
}

#[tauri::command]
fn pause_upload(state: State<AppState>) {
    state.uploader.pause();
}

#[tauri::command]
fn resume_upload(state: State<AppState>) {
    state.uploader.resume();
}

#[tauri::command]
fn cancel_upload(state: State<AppState>) {
    state.uploader.cancel();
}

#[tauri::command]
fn eject_volume(path: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        use std::path::Path;
        use std::process::Command;

        // Naive implementation: assume /Volumes/NAME
        let path_obj = Path::new(&path);
        if !path_obj.starts_with("/Volumes") {
            return Err(AppError::Unknown("Not a /Volumes path".to_string()));
        }

        let mut components = path_obj.components();
        // Skip root /
        components.next();
        // Check "Volumes"
        if let Some(std::path::Component::Normal(c)) = components.next() {
            if c != "Volumes" {
                return Err(AppError::Unknown("Not in /Volumes".to_string()));
            }
        }

        // Get the volume name
        if let Some(std::path::Component::Normal(vol_name)) = components.next() {
            let volume_path = format!("/Volumes/{}", vol_name.to_string_lossy());

            let output = Command::new("diskutil")
                .arg("eject")
                .arg(&volume_path)
                .output()
                .map_err(AppError::Io)?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Unknown(format!("Eject failed: {}", stderr)));
            }

            return Ok(());
        }

        Err(AppError::Unknown(
            "Could not determine volume name".to_string(),
        ))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Unknown(
            "Eject not supported on this OS yet".to_string(),
        ))
    }
}

#[tauri::command]
async fn get_thumbnail(
    path: String,
    size: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let permit = state
        .imaging_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        imaging::thumbnail_data_url(&path, size.unwrap_or(512))
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))?
    .map_err(AppError::Image)
}

#[tauri::command]
async fn get_preview(
    path: String,
    max_dim: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let permit = state
        .imaging_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        imaging::preview_data_url(&path, max_dim.unwrap_or(2560))
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))?
    .map_err(AppError::Image)
}

#[tauri::command]
async fn eagle_ping(base_url: String, token: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || eagle::ping(&base_url, &token))
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
        .map_err(AppError::Eagle)
}

#[tauri::command]
async fn eagle_folders(base_url: String, token: String) -> AppResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || eagle::folders(&base_url, &token))
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
        .map_err(AppError::Eagle)
}

#[tauri::command]
async fn eagle_import(
    base_url: String,
    token: String,
    items: Vec<eagle::PathImportItem>,
    folder_id: Option<String>,
) -> AppResult<eagle::ImportOutcome> {
    tauri::async_runtime::spawn_blocking(move || {
        eagle::import_paths(&base_url, &token, &items, &folder_id)
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))
}

#[derive(Deserialize)]
struct CropRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(serde::Serialize)]
struct CropImportResult {
    width: u32,
    height: u32,
}

/// 内存中裁剪并直接推送 Eagle：不写 SD 卡，也不在磁盘留下任何裁剪文件
#[tauri::command]
// Keep the existing named IPC arguments stable for the frontend.
#[allow(clippy::too_many_arguments)]
async fn eagle_import_crop(
    path: String,
    rect: CropRect,
    name: Option<String>,
    tags: Option<Vec<String>>,
    folder_id: Option<String>,
    base_url: String,
    token: String,
    state: State<'_, AppState>,
) -> AppResult<CropImportResult> {
    let cache = state.crop_source_cache.clone();
    let permit = state
        .imaging_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let source = imaging::crop_source_bytes(&path, &cache).map_err(AppError::Image)?;
        let out = imaging::crop_in_memory(&source, rect.x, rect.y, rect.w, rect.h)
            .map_err(AppError::Image)?;
        let annotation = Some(format!("裁剪自 {path}"));
        eagle::import_jpeg_bytes(
            &base_url,
            &token,
            &out.jpeg,
            name.as_deref().unwrap_or(""),
            &tags.unwrap_or_default(),
            &annotation,
            &folder_id,
        )
        .map_err(AppError::Eagle)?;
        Ok(CropImportResult {
            width: out.width,
            height: out.height,
        })
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))?
}

#[derive(Deserialize)]
struct TetherArgs {
    mode: String, // "watch" | "ftp"
    #[serde(default, alias = "watchDir")]
    watch_dir: Option<String>,
    #[serde(alias = "targetDir")]
    target_dir: String,
    #[serde(default, alias = "ftpPort")]
    ftp_port: Option<u16>,
    #[serde(default, alias = "ftpUser")]
    ftp_user: Option<String>,
    #[serde(default, alias = "ftpPass")]
    ftp_pass: Option<String>,
    #[serde(default, alias = "deleteSource")]
    delete_source: bool,
}

#[derive(serde::Serialize)]
struct TetherStartInfo {
    lan_ip: String,
    ftp_port: Option<u16>,
    inbox: Option<String>,
}

#[tauri::command]
async fn start_tether(
    args: TetherArgs,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<TetherStartInfo> {
    // 保留锁直到资源已真正启动或已回滚；stop 与后续 start 均等待完整生命周期。
    let mut guard = state.tether.lock().await;
    if guard.is_some() {
        return Err(AppError::Tether(
            "联机会话已在运行，请先结束当前会话".into(),
        ));
    }
    let target = PathBuf::from(&args.target_dir)
        .canonicalize()
        .map_err(|_| AppError::Tether("目标目录不存在".into()))?;
    if !target.is_dir() {
        return Err(AppError::Tether("目标路径不是目录".into()));
    }
    let control = tether::SessionControl::new();
    let lan_ip = tether::lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let (handle, info) = match args.mode.as_str() {
        "watch" => {
            if args.delete_source {
                return Err(AppError::Tether(
                    "监听模式无法确认上游写入已结束，必须保留来源文件".into(),
                ));
            }
            let watch = PathBuf::from(
                args.watch_dir
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .ok_or_else(|| AppError::Tether("请先选择监听目录".into()))?,
            )
            .canonicalize()
            .map_err(|_| AppError::Tether("监听目录不存在".into()))?;
            if !watch.is_dir() {
                return Err(AppError::Tether("监听路径不是目录".into()));
            }
            tether::validate_watch_target(&watch, &target).map_err(AppError::Tether)?;
            let watcher = tether::spawn_watcher(
                tether::TetherOptions {
                    watch_dir: watch,
                    target_dir: target,
                    move_files: false,
                    rescan: false,
                    ftp_fed: false,
                },
                control.clone(),
                window,
            )
            .map_err(AppError::Tether)?;
            (
                tether::TetherHandle {
                    control,
                    watcher: Some(watcher),
                    ftp: None,
                },
                TetherStartInfo {
                    lan_ip,
                    ftp_port: None,
                    inbox: None,
                },
            )
        }
        "ftp" => {
            let inbox = target.join(".mascopy-inbox");
            let completed = tether::prepare_inbox(&inbox).map_err(AppError::Tether)?;
            let watcher = tether::spawn_watcher(
                tether::TetherOptions {
                    watch_dir: completed,
                    target_dir: target,
                    move_files: true,
                    rescan: true,
                    ftp_fed: true,
                },
                control.clone(),
                window,
            )
            .map_err(AppError::Tether)?;
            let mut handle = tether::TetherHandle {
                control: control.clone(),
                watcher: Some(watcher),
                ftp: None,
            };
            let ftp = tether::spawn_ftp_server(
                inbox.clone(),
                std::net::SocketAddr::from(([0, 0, 0, 0], args.ftp_port.unwrap_or(2121))),
                args.ftp_user
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "eos".into()),
                args.ftp_pass
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "eos".into()),
                handle
                    .watcher
                    .as_ref()
                    .expect("watcher initialized")
                    .tx
                    .clone(),
                control,
            )
            .await;
            let ftp = match ftp {
                Ok(ftp) => ftp,
                Err(error) => {
                    let _ = handle.shutdown().await;
                    return Err(AppError::Tether(error));
                }
            };
            let port = ftp.local_addr.port();
            handle.ftp = Some(ftp);
            (
                handle,
                TetherStartInfo {
                    lan_ip,
                    ftp_port: Some(port),
                    inbox: Some(inbox.to_string_lossy().to_string()),
                },
            )
        }
        _ => return Err(AppError::Tether("未知联机模式".into())),
    };
    *guard = Some(handle);
    Ok(info)
}

#[tauri::command]
async fn stop_tether(state: State<'_, AppState>) -> AppResult<()> {
    let mut guard = state.tether.lock().await;
    if let Some(handle) = guard.take() {
        handle.shutdown().await.map_err(AppError::Tether)?;
    }
    Ok(())
}

/// 相机可连的本机 IP 候选（过滤代理 TUN/Tailscale 等虚拟接口），优先级从高到低
#[tauri::command]
fn get_lan_ip() -> Vec<String> {
    tether::lan_ip_candidates()
}

#[tauri::command]
fn reveal_in_finder(path: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let status = Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(AppError::Io)?;
        if status.success() {
            Ok(())
        } else {
            Err(AppError::Unknown("Open failed".to_string()))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Unknown(
            "Reveal not supported on this OS yet".to_string(),
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let uploader = Arc::new(Uploader::new());
    let config_manager = ConfigManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 自动更新：端点与验签公钥在 tauri.conf.json 的 plugins.updater；检查与安装由前端发起
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(AppState {
            config_manager,
            uploader,
            imaging_semaphore: Arc::new(Semaphore::new(4)),
            crop_source_cache: Arc::new(imaging::CropSourceCache::default()),
            tether: tether::TetherState::default(),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            scan_files,
            upload_files,
            pause_upload,
            resume_upload,
            cancel_upload,
            eject_volume,
            reveal_in_finder,
            get_thumbnail,
            get_preview,
            eagle_ping,
            eagle_folders,
            eagle_import,
            eagle_import_crop,
            start_tether,
            stop_tether,
            get_lan_ip,
            app_update::app_update_supported,
            app_update::relaunch_after_update
        ])
        .run(tauri::generate_context!("tauri.conf.json"))
        .expect("error while running tauri application");
}
