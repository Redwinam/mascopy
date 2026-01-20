
mod config;
mod scanner;
mod metadata;
mod analyzer;
mod uploader;
mod error;

use std::sync::Arc;
use tauri::{State, Window};
use config::{Config, ConfigManager};
use scanner::{Scanner, MediaFile};
use analyzer::Analyzer;
use uploader::Uploader;
use error::{AppError, AppResult};
use serde::Deserialize;

struct AppState {
    config_manager: ConfigManager,
    uploader: Arc<Uploader>,
}

#[tauri::command]
fn get_config(state: State<AppState>) -> AppResult<Config> {
    state.config_manager.load().map_err(|e| AppError::Config(e.to_string()))
}

#[tauri::command]
fn save_config(state: State<AppState>, config: Config) -> AppResult<()> {
    state.config_manager.save(&config).map_err(|e| AppError::Config(e.to_string()))
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
}

#[tauri::command]
async fn scan_files(args: ScanArgs) -> AppResult<Vec<MediaFile>> {
    let scanner = Scanner::with_mode(&args.mode.clone().unwrap_or_else(|| "sd".to_string()));
    let mut files = scanner.scan(&args.source_dir, args.fast_mode.unwrap_or(false));
    // 假设 Analyzer::analyze 可能失败，如果它是 void 返回，我们保持现状。
    // 如果它返回 Result，这里应该 map_err
    Analyzer::analyze(&mut files, &args.target_dir, args.overwrite_duplicates);
    Ok(files)
}

#[tauri::command]
async fn upload_files(
    files: Vec<MediaFile>, 
    window: Window,
    state: State<'_, AppState>
) -> AppResult<()> {
    state.uploader.reset();
    state.uploader.upload_files(files, window).await.map_err(|e| AppError::Upload(e.to_string()))
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
        use std::process::Command;
        use std::path::Path;
        
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
        
        Err(AppError::Unknown("Could not determine volume name".to_string()))
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Unknown("Eject not supported on this OS yet".to_string()))
    }
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
        Err(AppError::Unknown("Reveal not supported on this OS yet".to_string()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let uploader = Arc::new(Uploader::new());
    let config_manager = ConfigManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(AppState {
            config_manager,
            uploader,
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
            reveal_in_finder
        ])
        .run(tauri::generate_context!("tauri.conf.json"))
        .expect("error while running tauri application");
}
