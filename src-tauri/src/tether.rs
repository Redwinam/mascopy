mod ftp;
pub use ftp::{prepare_inbox, spawn_ftp_server, FtpHandle};

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Window};
use tokio::sync::watch;

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const SETTLE_QUIET: Duration = Duration::from_millis(1200);

fn is_media(path: &Path) -> bool {
    crate::media::classify(path, "tether").is_some()
}

fn is_hidden_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(true)
}

#[derive(Clone, Debug, Serialize)]
struct TetherFilePayload {
    key: String,
    filename: String,
    status: String,
    target_path: String,
    size: u64,
    date_ms: u64,
    file_type: String,
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
            file_type: crate::media::classify(src, "tether")
                .unwrap_or("video")
                .to_string(),
            error: String::new(),
        }
    }
}

/// Uploaded 只携带 storage 已原子提交的完整路径，不接受 FTP 命令的相对后缀。
#[derive(Debug)]
pub enum WatchMsg {
    Touched(PathBuf),
    Uploaded(PathBuf),
}

pub struct TetherOptions {
    pub watch_dir: PathBuf,
    pub target_dir: PathBuf,
    /// 仅对 FTP 已提交对象生效；普通监听始终保留上游来源文件。
    pub move_files: bool,
    pub rescan: bool,
    /// 此目录只能是内置 FTP 的 completed 区，其中每个对象均已提交完成。
    pub ftp_fed: bool,
}

#[derive(Clone, Debug)]
pub struct SessionControl {
    stopped: Arc<AtomicBool>,
    shutdown: watch::Sender<bool>,
}

impl SessionControl {
    pub fn new() -> Self {
        Self {
            stopped: Arc::new(AtomicBool::new(false)),
            shutdown: watch::channel(false).0,
        }
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.shutdown.send_replace(true);
    }

    fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    async fn cancelled(&self) {
        let mut rx = self.shutdown.subscribe();
        while !*rx.borrow_and_update() {
            if rx.changed().await.is_err() {
                break;
            }
        }
    }
}

pub struct WatcherHandle {
    pub tx: Sender<WatchMsg>,
    thread: Option<std::thread::JoinHandle<()>>,
    control: SessionControl,
}

impl WatcherHandle {
    fn join(mut self) -> Result<(), String> {
        self.control.stop();
        if let Some(thread) = self.thread.take() {
            thread
                .join()
                .map_err(|_| "目录监听线程异常退出".to_string())?;
        }
        Ok(())
    }
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.control.stop();
    }
}

pub struct TetherHandle {
    pub control: SessionControl,
    pub watcher: Option<WatcherHandle>,
    pub ftp: Option<FtpHandle>,
}

impl TetherHandle {
    pub async fn shutdown(mut self) -> Result<(), String> {
        self.control.stop();
        let ftp_result = if let Some(ftp) = self.ftp.take() {
            ftp.shutdown().await
        } else {
            Ok(())
        };
        let watcher_result = if let Some(watcher) = self.watcher.take() {
            tauri::async_runtime::spawn_blocking(move || watcher.join())
                .await
                .map_err(|e| format!("等待目录监听结束失败: {e}"))?
        } else {
            Ok(())
        };
        ftp_result.and(watcher_result)
    }
}

impl Drop for TetherHandle {
    fn drop(&mut self) {
        self.control.stop();
    }
}

/// 锁覆盖启动/结束过程，避免第二个 start 或 stop 越过半初始化会话。
pub type TetherState = tokio::sync::Mutex<Option<TetherHandle>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Fingerprint {
    size: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    identity: (u64, u64),
}

impl Fingerprint {
    fn read(path: &Path) -> std::io::Result<Self> {
        let meta = std::fs::symlink_metadata(path)?;
        if !meta.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "不是普通文件",
            ));
        }
        Self::from_metadata(&meta)
    }
    fn from_metadata(meta: &std::fs::Metadata) -> std::io::Result<Self> {
        if !meta.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "不是普通文件",
            ));
        }
        Ok(Self {
            size: meta.len(),
            modified: meta.modified().ok(),
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                (meta.dev(), meta.ino())
            },
        })
    }
}

struct PendingFile {
    fingerprint: Fingerprint,
    changed_at: Instant,
    next_attempt: Instant,
    failures: u32,
    last_error: Option<String>,
}

pub fn validate_watch_target(watch: &Path, target: &Path) -> Result<(), String> {
    if target.starts_with(watch) || watch.starts_with(target) {
        return Err("监听目录与目标目录不能相同或互相包含".into());
    }
    Ok(())
}

pub fn spawn_watcher(
    opts: TetherOptions,
    control: SessionControl,
    window: Window,
) -> Result<WatcherHandle, String> {
    spawn_watcher_with(opts, control, move |payload| {
        let _ = window.emit("tether-file", payload);
    })
}

fn spawn_watcher_with<E>(
    mut opts: TetherOptions,
    control: SessionControl,
    emit: E,
) -> Result<WatcherHandle, String>
where
    E: Fn(TetherFilePayload) + Send + 'static,
{
    opts.watch_dir = opts
        .watch_dir
        .canonicalize()
        .map_err(|e| format!("监听目录不可用: {e}"))?;
    let (tx, rx) = std::sync::mpsc::channel::<WatchMsg>();
    let mut watcher = notify::recommended_watcher({
        let tx = tx.clone();
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                for path in event.paths {
                    let _ = tx.send(WatchMsg::Touched(path));
                }
            }
        }
    })
    .map_err(|e| format!("创建目录监听失败: {e}"))?;
    watcher
        .watch(&opts.watch_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("监听目录失败: {e}"))?;

    let thread_control = control.clone();
    let thread = std::thread::Builder::new()
        .name("mascopy-tether-watch".into())
        .spawn(move || {
            let _watcher = watcher;
            let mut pending: HashMap<PathBuf, PendingFile> = HashMap::new();
            let mut processed: HashMap<PathBuf, Fingerprint> = HashMap::new();
            while !thread_control.is_stopped() {
                if opts.rescan {
                    for entry in walkdir::WalkDir::new(&opts.watch_dir)
                        .into_iter()
                        .filter_map(Result::ok)
                    {
                        if entry.file_type().is_file() {
                            consider(
                                &opts.watch_dir,
                                &mut pending,
                                &mut processed,
                                entry.path().to_path_buf(),
                                &emit,
                            );
                        }
                    }
                }
                let deadline = Instant::now() + POLL_INTERVAL;
                loop {
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() || thread_control.is_stopped() {
                        break;
                    }
                    match rx.recv_timeout(left) {
                        Ok(WatchMsg::Touched(path) | WatchMsg::Uploaded(path)) => {
                            consider(&opts.watch_dir, &mut pending, &mut processed, path, &emit);
                        }
                        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
                    }
                }
                if thread_control.is_stopped() {
                    break;
                }

                let mut ready = Vec::new();
                let mut gone = Vec::new();
                for (path, state) in pending.iter_mut() {
                    match Fingerprint::read(path) {
                        Ok(fingerprint) => {
                            if fingerprint != state.fingerprint {
                                state.fingerprint = fingerprint;
                                state.changed_at = Instant::now();
                                state.next_attempt = Instant::now();
                                state.failures = 0;
                                state.last_error = None;
                                let mut payload = TetherFilePayload::new(path, "receiving");
                                payload.size = fingerprint.size;
                                emit(payload);
                            }
                            // FTP completed 区依靠原子提交；绝不以静默时间猜测网络传输完成。
                            if fingerprint.size > 0
                                && Instant::now() >= state.next_attempt
                                && (opts.ftp_fed || state.changed_at.elapsed() >= SETTLE_QUIET)
                            {
                                ready.push((path.clone(), fingerprint));
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                            gone.push(path.clone())
                        }
                        Err(e) => record_failure(path, state, format!("读取文件失败: {e}"), &emit),
                    }
                }
                for path in gone {
                    pending.remove(&path);
                    processed.remove(&path);
                    emit(TetherFilePayload::new(&path, "removed"));
                }
                for (path, fingerprint) in ready {
                    if thread_control.is_stopped() {
                        break;
                    }
                    match process_file(&path, fingerprint, &opts, &thread_control) {
                        Ok(Some(payload)) => {
                            pending.remove(&path);
                            processed.insert(path.clone(), fingerprint);
                            emit(payload);
                            if opts.ftp_fed {
                                if let Some(parent) =
                                    path.parent().filter(|p| **p != opts.watch_dir)
                                {
                                    let _ = std::fs::remove_dir(parent);
                                }
                            }
                        }
                        Ok(None) => {
                            // 复制期间源继续写入；保留任务，下一轮重新观察版本/静默时间。
                            if let Some(state) = pending.get_mut(&path) {
                                state.changed_at = Instant::now();
                            }
                        }
                        Err(error) => {
                            if !thread_control.is_stopped() {
                                if let Some(state) = pending.get_mut(&path) {
                                    record_failure(&path, state, error, &emit);
                                }
                            }
                        }
                    }
                }
            }
        })
        .map_err(|e| format!("启动目录监听线程失败: {e}"))?;
    Ok(WatcherHandle {
        tx,
        thread: Some(thread),
        control,
    })
}

fn consider(
    watch_dir: &Path,
    pending: &mut HashMap<PathBuf, PendingFile>,
    processed: &mut HashMap<PathBuf, Fingerprint>,
    path: PathBuf,
    emit: &dyn Fn(TetherFilePayload),
) {
    if !path.starts_with(watch_dir) || is_hidden_name(&path) || !is_media(&path) {
        return;
    }
    let fingerprint = match Fingerprint::read(&path) {
        Ok(value) => value,
        Err(_) => {
            processed.remove(&path);
            return;
        }
    };
    // 不沿监听目录中新增的符号链接读取目录外的对象。
    if !path
        .canonicalize()
        .map(|p| p.starts_with(watch_dir))
        .unwrap_or(false)
    {
        return;
    }
    if pending.contains_key(&path) || processed.get(&path) == Some(&fingerprint) {
        return;
    }
    let mut payload = TetherFilePayload::new(&path, "receiving");
    payload.size = fingerprint.size;
    emit(payload);
    pending.insert(
        path,
        PendingFile {
            fingerprint,
            changed_at: Instant::now(),
            next_attempt: Instant::now(),
            failures: 0,
            last_error: None,
        },
    );
}

fn record_failure(
    path: &Path,
    state: &mut PendingFile,
    error: String,
    emit: &dyn Fn(TetherFilePayload),
) {
    state.failures = state.failures.saturating_add(1);
    state.next_attempt = Instant::now()
        + Duration::from_millis(500 * (1u64 << state.failures.min(6).saturating_sub(1)));
    if state.last_error.as_ref() != Some(&error) {
        let mut payload = TetherFilePayload::new(path, "error");
        payload.size = state.fingerprint.size;
        payload.error = error.clone();
        emit(payload);
        state.last_error = Some(error);
    }
}

/// None 表示源文件在入库过程中变化，应重新等待；仅 FTP 已提交对象可以在入库后删除。
fn process_file(
    src: &Path,
    expected: Fingerprint,
    opts: &TetherOptions,
    control: &SessionControl,
) -> Result<Option<TetherFilePayload>, String> {
    let mut payload = TetherFilePayload::new(src, "error");
    let mtime = expected.modified.unwrap_or_else(SystemTime::now);
    payload.size = expected.size;
    payload.date_ms = mtime
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let date: DateTime<Local> = mtime.into();
    let target = opts
        .target_dir
        .canonicalize()
        .map_err(|e| format!("目标目录不可用: {e}"))?;
    if !target.is_dir() {
        return Err("目标路径不是目录".into());
    }
    let date_dir = target.join(date.format("%Y-%m-%d").to_string());
    match std::fs::create_dir(&date_dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("创建日期目录失败: {e}")),
    }
    let date_meta =
        std::fs::symlink_metadata(&date_dir).map_err(|e| format!("读取日期目录失败: {e}"))?;
    if !date_meta.is_dir() || date_dir.canonicalize().ok().as_deref() != Some(date_dir.as_path()) {
        return Err("日期目录必须是目标目录内的普通目录，不能是符号链接".into());
    }
    let original = src.file_name().ok_or("文件名无效")?.to_string_lossy();
    for attempt in 0.. {
        if control.is_stopped() {
            return Err("会话已停止".into());
        }
        if Fingerprint::read(src).ok() != Some(expected) {
            return Ok(None);
        }
        let name = if attempt == 0 {
            original.to_string()
        } else {
            crate::storage::unique_name(&original, attempt)
        };
        let dest = date_dir.join(name);
        if let (Ok(source), Ok(destination)) = (src.canonicalize(), dest.canonicalize()) {
            if source == destination {
                return Err("源文件已位于目标位置，不能将其作为重复文件删除".into());
            }
        }
        match std::fs::symlink_metadata(&dest) {
            Ok(meta) => {
                if meta.is_file()
                    && meta.len() == expected.size
                    && crate::storage::files_equal(src, &dest)
                        .map_err(|e| format!("比较已有文件失败: {e}"))?
                {
                    if Fingerprint::read(src).ok() != Some(expected) {
                        return Ok(None);
                    }
                    if control.is_stopped() {
                        return Err("会话已停止".into());
                    }
                    if opts.move_files && opts.ftp_fed {
                        std::fs::remove_file(src).map_err(|e| format!("删除源文件失败: {e}"))?;
                    }
                    payload.status = "skipped".into();
                    payload.target_path = dest.to_string_lossy().to_string();
                    return Ok(Some(payload));
                }
                continue;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("检查目标文件失败: {e}")),
        }
        let mut staged = match crate::storage::StagedFile::for_media(&dest, false) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("创建目标文件失败: {e}")),
        };
        let mut input = std::fs::File::open(src).map_err(|e| format!("读取文件失败: {e}"))?;
        if input
            .metadata()
            .and_then(|m| Fingerprint::from_metadata(&m))
            .ok()
            != Some(expected)
        {
            return Ok(None);
        }
        let mut buffer = vec![0u8; 256 * 1024];
        let mut copied = 0u64;
        loop {
            if control.is_stopped() {
                return Err("会话已停止".into());
            }
            let read = input
                .read(&mut buffer)
                .map_err(|e| format!("读取文件失败: {e}"))?;
            if read == 0 {
                break;
            }
            staged
                .file
                .write_all(&buffer[..read])
                .map_err(|e| format!("复制失败: {e}"))?;
            copied += read as u64;
        }
        if copied != expected.size
            || input
                .metadata()
                .and_then(|m| Fingerprint::from_metadata(&m))
                .ok()
                != Some(expected)
            || Fingerprint::read(src).ok() != Some(expected)
        {
            return Ok(None);
        }
        if control.is_stopped() {
            return Err("会话已停止".into());
        }
        let source_permissions = input
            .metadata()
            .map_err(|e| format!("读取源权限失败: {e}"))?
            .permissions();
        staged
            .file
            .set_permissions(source_permissions)
            .map_err(|e| format!("保留源权限失败: {e}"))?;
        let ft = filetime::FileTime::from_system_time(mtime);
        filetime::set_file_handle_times(&staged.file, Some(ft), Some(ft))
            .map_err(|e| format!("保留文件日期失败: {e}"))?;
        match staged.commit(&dest, false) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("提交入库文件失败: {e}")),
        }
        // 若源在提交后被改写，保留新版本供下一轮处理，绝不删除它。
        if opts.move_files && opts.ftp_fed && Fingerprint::read(src).ok() == Some(expected) {
            std::fs::remove_file(src).map_err(|e| format!("删除源文件失败: {e}"))?;
        }
        payload.status = "done".into();
        payload.target_path = dest.to_string_lossy().to_string();
        return Ok(Some(payload));
    }
    unreachable!()
}

/// 判断是否为相机可达的真实局域网地址。
/// 过滤代理 TUN（198.18.0.0/15 基准测试段）、Tailscale 等 CGNAT（100.64.0.0/10）、
/// 链路本地（169.254/16）——这些是虚拟接口，相机连不上。
fn is_camera_reachable(ip: &std::net::Ipv4Addr) -> bool {
    let o = ip.octets();
    if ip.is_loopback() || ip.is_unspecified() {
        return false;
    }
    if o[0] == 169 && o[1] == 254 {
        return false;
    }
    if o[0] == 198 && (o[1] == 18 || o[1] == 19) {
        return false;
    }
    if o[0] == 100 && (64..=127).contains(&o[1]) {
        return false;
    }
    true
}

fn is_virtual_ifname(name: &str) -> bool {
    [
        "utun", "tun", "tap", "awdl", "llw", "bridge", "vmnet", "lo", "gif", "stf", "anpi",
    ]
    .iter()
    .any(|p| name.starts_with(p))
}

fn rank_candidates(
    mut raw: Vec<(String, std::net::Ipv4Addr)>,
) -> Vec<(String, std::net::Ipv4Addr)> {
    raw.retain(|(name, ip)| !is_virtual_ifname(name) && is_camera_reachable(ip));
    // RFC1918 私网段优先，物理网卡（macOS 上 en*）优先，其余按接口名排序
    raw.sort_by_key(|(name, ip)| {
        let o = ip.octets();
        let private = o[0] == 10
            || (o[0] == 192 && o[1] == 168)
            || (o[0] == 172 && (16..=31).contains(&o[1]));
        (
            std::cmp::Reverse(private),
            std::cmp::Reverse(name.starts_with("en")),
            name.clone(),
        )
    });
    raw
}

/// 相机可连的本机局域网 IP 候选（优先级从高到低）
pub fn lan_ip_candidates() -> Vec<String> {
    let raw: Vec<(String, std::net::Ipv4Addr)> = if_addrs::get_if_addrs()
        .map(|ifaces| {
            ifaces
                .into_iter()
                .filter_map(|iface| match iface.ip() {
                    std::net::IpAddr::V4(ip) => Some((iface.name, ip)),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    let mut out: Vec<String> = rank_candidates(raw)
        .into_iter()
        .map(|(_, ip)| ip.to_string())
        .collect();
    out.dedup();
    out
}

pub fn lan_ip() -> Option<String> {
    lan_ip_candidates().into_iter().next()
}
