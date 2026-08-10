use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Window};

const POLL_INTERVAL: Duration = Duration::from_millis(350);
// 连续 N 个轮询周期大小不变，视为相机/联机软件已写完
const SETTLE_CHECKS: u32 = 2;

const PHOTO_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "hif", "nef", "cr2", "cr3", "arw", "dng",
];
const VIDEO_EXTS: &[&str] = &["mp4", "mov", "avi", "m4v", "3gp", "mkv", "crm"];

fn ext_lower(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

fn is_media(path: &Path) -> bool {
    let ext = ext_lower(path);
    PHOTO_EXTS.contains(&ext.as_str()) || VIDEO_EXTS.contains(&ext.as_str())
}

fn is_hidden_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(true)
}

#[derive(Clone, Serialize)]
struct TetherFilePayload {
    key: String,
    filename: String,
    status: String, // receiving | done | skipped | removed | error
    target_path: String,
    size: u64,
    date_ms: u64,
    file_type: String, // photo | video
    error: String,
}

impl TetherFilePayload {
    fn new(src: &Path, status: &str) -> Self {
        Self {
            key: src.to_string_lossy().to_string(),
            filename: src
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            status: status.to_string(),
            target_path: String::new(),
            size: 0,
            date_ms: 0,
            file_type: if PHOTO_EXTS.contains(&ext_lower(src).as_str()) {
                "photo".to_string()
            } else {
                "video".to_string()
            },
            error: String::new(),
        }
    }
}

fn emit_file(window: &Window, payload: TetherFilePayload) {
    window.emit("tether-file", payload).unwrap_or_default();
}

pub struct TetherOptions {
    /// 被监听的目录（watch 模式=联机软件保存目录；ftp 模式=收件箱）
    pub watch_dir: PathBuf,
    pub target_dir: PathBuf,
    /// 入库后删除源文件（FTP 收件箱恒为 true，避免磁盘留双份）
    pub move_files: bool,
    /// 启动时把目录里已有的文件也纳入处理（FTP 收件箱扫尾用）
    pub process_existing: bool,
}

struct PendingFile {
    last_size: u64,
    stable: u32,
}

pub struct TetherHandle {
    pub stop: Arc<AtomicBool>,
    pub ftp_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub type TetherState = Mutex<Option<TetherHandle>>;

/// 启动监听线程：新文件写稳后按日期整理进目标目录，并向前端推送进度事件
pub fn spawn_watcher(
    opts: TetherOptions,
    stop: Arc<AtomicBool>,
    window: Window,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<PathBuf>();

    let mut watcher = notify::recommended_watcher({
        let tx = tx.clone();
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                for p in event.paths {
                    let _ = tx.send(p);
                }
            }
        }
    })
    .map_err(|e| format!("创建目录监听失败: {e}"))?;

    watcher
        .watch(&opts.watch_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("监听目录失败: {e}"))?;

    std::thread::spawn(move || {
        // watcher 随线程存活，线程退出时自动释放
        let _watcher = watcher;
        let mut pending: HashMap<PathBuf, PendingFile> = HashMap::new();

        if opts.process_existing {
            for entry in walkdir::WalkDir::new(&opts.watch_dir)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if entry.file_type().is_file() {
                    consider(&mut pending, entry.path().to_path_buf(), &window);
                }
            }
        }

        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }

            match rx.recv_timeout(POLL_INTERVAL) {
                Ok(path) => {
                    consider(&mut pending, path, &window);
                    while let Ok(p) = rx.try_recv() {
                        consider(&mut pending, p, &window);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if stop.load(Ordering::Relaxed) {
                break;
            }

            // 轮询待写稳文件
            let mut ready: Vec<PathBuf> = Vec::new();
            let mut gone: Vec<PathBuf> = Vec::new();
            for (path, state) in pending.iter_mut() {
                match std::fs::metadata(path) {
                    Ok(meta) => {
                        let size = meta.len();
                        if size == state.last_size && size > 0 {
                            state.stable += 1;
                            if state.stable >= SETTLE_CHECKS {
                                ready.push(path.clone());
                            }
                        } else {
                            state.last_size = size;
                            state.stable = 0;
                        }
                    }
                    // 源文件消失（临时文件被改名等），从列表拿掉
                    Err(_) => gone.push(path.clone()),
                }
            }
            for path in gone {
                pending.remove(&path);
                emit_file(&window, TetherFilePayload::new(&path, "removed"));
            }
            for path in ready {
                pending.remove(&path);
                process_file(&path, &opts, &window);
            }
        }
    });

    Ok(())
}

fn consider(pending: &mut HashMap<PathBuf, PendingFile>, path: PathBuf, window: &Window) {
    if pending.contains_key(&path) {
        return;
    }
    if is_hidden_name(&path) || !is_media(&path) {
        return;
    }
    let Ok(meta) = std::fs::metadata(&path) else {
        return;
    };
    if !meta.is_file() {
        return;
    }
    emit_file(window, TetherFilePayload::new(&path, "receiving"));
    pending.insert(
        path,
        PendingFile {
            last_size: meta.len(),
            stable: 0,
        },
    );
}

fn make_unique_name(original: &str, attempt: usize) -> String {
    let path = Path::new(original);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| original.to_string());
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    if ext.is_empty() {
        format!("{stem}_{attempt}")
    } else {
        format!("{stem}_{attempt}.{ext}")
    }
}

fn process_file(src: &Path, opts: &TetherOptions, window: &Window) {
    let mut payload = TetherFilePayload::new(src, "error");

    let meta = match std::fs::metadata(src) {
        Ok(m) => m,
        Err(e) => {
            payload.error = format!("读取文件失败: {e}");
            emit_file(window, payload);
            return;
        }
    };
    let size = meta.len();
    let mtime = meta.modified().unwrap_or_else(|_| SystemTime::now());
    payload.size = size;
    payload.date_ms = mtime
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // 与 SD 备份流程一致：目标目录/YYYY-MM-DD/文件名
    let date: DateTime<Local> = mtime.into();
    let date_dir = opts.target_dir.join(date.format("%Y-%m-%d").to_string());
    if let Err(e) = std::fs::create_dir_all(&date_dir) {
        payload.error = format!("创建日期目录失败: {e}");
        emit_file(window, payload);
        return;
    }

    let original_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let mut attempt = 0;
    let dest = loop {
        let candidate = if attempt == 0 {
            original_name.clone()
        } else {
            make_unique_name(&original_name, attempt)
        };
        let dest = date_dir.join(&candidate);
        if !dest.exists() {
            break dest;
        }
        // 同名同大小视为重复（例如相机 FTP 重传），直接跳过
        if std::fs::metadata(&dest).map(|m| m.len()).ok() == Some(size) {
            if opts.move_files {
                let _ = std::fs::remove_file(src);
            }
            payload.status = "skipped".to_string();
            payload.target_path = dest.to_string_lossy().to_string();
            emit_file(window, payload);
            return;
        }
        attempt += 1;
    };

    let result = if opts.move_files {
        move_file(src, &dest)
    } else {
        copy_file(src, &dest)
    };

    match result {
        Ok(()) => {
            // 保留拍摄时间戳
            let ft = filetime::FileTime::from_system_time(mtime);
            let _ = filetime::set_file_times(&dest, ft, ft);
            payload.status = "done".to_string();
            payload.target_path = dest.to_string_lossy().to_string();
            emit_file(window, payload);
        }
        Err(e) => {
            payload.error = e;
            emit_file(window, payload);
        }
    }
}

/// 移动优先 rename（同卷瞬间完成），跨卷退化为复制+删除
fn move_file(src: &Path, dest: &Path) -> Result<(), String> {
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_file(src, dest)?;
            std::fs::remove_file(src).map_err(|e| format!("删除源文件失败: {e}"))?;
            Ok(())
        }
    }
}

/// 先写 .part 临时文件再原子改名，避免半成品
fn copy_file(src: &Path, dest: &Path) -> Result<(), String> {
    let temp = {
        let mut os = dest.to_path_buf().into_os_string();
        os.push(".part");
        PathBuf::from(os)
    };
    if let Err(e) = std::fs::copy(src, &temp) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("复制失败: {e}"));
    }
    std::fs::rename(&temp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("重命名失败: {e}")
    })
}

/* ---------------- 内置 FTP 服务器 ---------------- */

#[derive(Debug)]
struct FixedAuth {
    user: String,
    pass: String,
}

#[async_trait::async_trait]
impl libunftp::auth::Authenticator for FixedAuth {
    async fn authenticate(
        &self,
        username: &str,
        creds: &libunftp::auth::Credentials,
    ) -> Result<libunftp::auth::Principal, libunftp::auth::AuthenticationError> {
        if username == self.user && creds.password.as_deref() == Some(self.pass.as_str()) {
            Ok(libunftp::auth::Principal {
                username: username.to_string(),
            })
        } else {
            Err(libunftp::auth::AuthenticationError::BadPassword)
        }
    }
}

/// 在指定端口起 FTP 服务，根目录为收件箱。返回任务句柄，结束会话时 abort。
pub fn spawn_ftp_server(
    root: PathBuf,
    port: u16,
    user: String,
    pass: String,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let server = libunftp::ServerBuilder::with_authenticator(
            // 收件箱在启动会话时已创建，此处失败仅影响单条连接
            Box::new(move || {
                unftp_sbe_fs::Filesystem::new(root.clone()).expect("收件箱目录不可用")
            }),
            Arc::new(FixedAuth { user, pass }),
        )
        .greeting("mascopy tether")
        .passive_ports(50021..=50040)
        .build();

        match server {
            Ok(server) => {
                if let Err(e) = server.listen(format!("0.0.0.0:{port}")).await {
                    log::error!("FTP 服务异常退出: {e}");
                }
            }
            Err(e) => log::error!("FTP 服务启动失败: {e}"),
        }
    })
}

/// 本机局域网 IP（连外仅用于选路，不实际发包）
pub fn lan_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|a| a.ip().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 端到端验证内置 FTP：认证 + 上传落盘（curl 走真实 FTP 协议）。
    /// 必须多线程 runtime：测试体内有阻塞等待（curl 子进程），单线程会饿死服务任务。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ftp_upload_roundtrip() {
        let dir = std::env::temp_dir().join(format!("mascopy-ftp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let root = dir.clone();
        let server = libunftp::ServerBuilder::with_authenticator(
            Box::new(move || unftp_sbe_fs::Filesystem::new(root.clone()).unwrap()),
            Arc::new(FixedAuth {
                user: "eos".to_string(),
                pass: "eos".to_string(),
            }),
        )
        .passive_ports(51121..=51140)
        .build()
        .unwrap();
        let server_task = tokio::spawn(async move {
            if let Err(e) = server.listen("127.0.0.1:21299").await {
                eprintln!("FTP listen error: {e}");
            }
        });
        tokio::time::sleep(Duration::from_millis(500)).await;

        // 控制通道连通性与欢迎语
        {
            use std::io::Read;
            let mut s = std::net::TcpStream::connect("127.0.0.1:21299").expect("控制端口未监听");
            s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut buf = [0u8; 128];
            let n = s.read(&mut buf).unwrap_or(0);
            eprintln!("FTP greeting: {}", String::from_utf8_lossy(&buf[..n]));
        }

        let payload = dir.join("payload.bin");
        std::fs::write(&payload, b"mascopy tether ftp test payload").unwrap();

        // 错误密码必须被拒绝
        let bad = std::process::Command::new("curl")
            .args([
                "-s", "-m", "10", "-T",
                payload.to_str().unwrap(),
                "--user", "eos:wrong",
                "ftp://127.0.0.1:21299/rejected.bin",
            ])
            .output()
            .unwrap();
        assert!(!bad.status.success(), "错误密码不应上传成功");

        // 正确凭据上传成功且内容一致
        let ok = std::process::Command::new("curl")
            .args([
                "-sS", "-v", "-m", "10", "-T",
                payload.to_str().unwrap(),
                "--user", "eos:eos",
                "ftp://127.0.0.1:21299/IMG_0001.JPG",
            ])
            .output()
            .unwrap();
        assert!(
            ok.status.success(),
            "curl 上传失败: {}",
            String::from_utf8_lossy(&ok.stderr)
        );
        let uploaded = dir.join("IMG_0001.JPG");
        assert!(uploaded.exists(), "上传文件未落盘");
        assert_eq!(
            std::fs::read(&uploaded).unwrap(),
            std::fs::read(&payload).unwrap()
        );

        server_task.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
