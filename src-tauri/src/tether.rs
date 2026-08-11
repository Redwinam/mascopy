use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Window};

const POLL_INTERVAL: Duration = Duration::from_millis(250);
// 大小持续这么久没变，才视为相机/联机软件已写完（兜底判据，必须按真实时间算）
const SETTLE_QUIET: Duration = Duration::from_millis(1200);
// FTP 传完有明确信号，兜底期放到远大于任何正常的网络卡顿：
// 相机 WiFi 一卡就按静默判定，等于又把没传完的文件当成传完了
const SETTLE_QUIET_FTP: Duration = Duration::from_secs(30);
// 「传完了」的通知只为覆盖文件被扫到之前的这点时差，过期即丢，免得错认到后来的同名文件
const REPORT_GRACE: Duration = Duration::from_secs(3);

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

/// 监听线程的输入
pub enum WatchMsg {
    /// 文件系统事件：路径刚被创建/写入，可能还没写完
    Touched(PathBuf),
    /// 内置 FTP 上报 STOR 已完成（路径由客户端给出，可能是相对路径）
    Uploaded(String),
}

pub struct TetherOptions {
    /// 被监听的目录（watch 模式=联机软件保存目录；ftp 模式=收件箱）
    pub watch_dir: PathBuf,
    pub target_dir: PathBuf,
    /// 入库后删除源文件（FTP 收件箱恒为 true，避免磁盘留双份）
    pub move_files: bool,
    /// 每个轮询周期主动重扫目录（FTP 收件箱用：目录小、扫描便宜，
    /// 探测比 FSEvents 及时，还能顺带处理上次会话的残留文件）
    pub rescan: bool,
    /// 目录由内置 FTP 供稿：传完有明确信号，静默判定只当兜底
    pub ftp_fed: bool,
}

struct PendingFile {
    last_size: u64,
    /// 最近一次观察到大小变化的时刻
    changed_at: Instant,
    /// 大小静默多久算写完
    quiet: Duration,
    /// FTP 已确认整份传完，不必再等静默期
    uploaded: bool,
}

pub struct TetherHandle {
    pub stop: Arc<AtomicBool>,
    pub ftp_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub type TetherState = Mutex<Option<TetherHandle>>;

/// 启动监听线程：新文件写稳后按日期整理进目标目录，并向前端推送进度事件。
/// 返回的发送端用于把「FTP 已传完」告诉监听线程（见 [`WatchMsg`]）。
pub fn spawn_watcher(
    opts: TetherOptions,
    stop: Arc<AtomicBool>,
    window: Window,
) -> Result<Sender<WatchMsg>, String> {
    spawn_watcher_with(opts, stop, move |payload| {
        window.emit("tether-file", payload).unwrap_or_default();
    })
}

/// 监听线程本体。事件出口做成闭包，测试里可以直接收事件，不需要真的起一个窗口。
fn spawn_watcher_with<E>(
    opts: TetherOptions,
    stop: Arc<AtomicBool>,
    emit: E,
) -> Result<Sender<WatchMsg>, String>
where
    E: Fn(TetherFilePayload) + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel::<WatchMsg>();

    let mut watcher = notify::recommended_watcher({
        let tx = tx.clone();
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                for p in event.paths {
                    let _ = tx.send(WatchMsg::Touched(p));
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
        let emit: &dyn Fn(TetherFilePayload) = &emit;
        let mut pending: HashMap<PathBuf, PendingFile> = HashMap::new();
        // 传得快的小图可能「先收到传完通知、后被扫到」，通知先记下来，等文件出现时认领
        let mut reported: Vec<(PathBuf, Instant)> = Vec::new();
        let live_quiet = if opts.ftp_fed {
            SETTLE_QUIET_FTP
        } else {
            SETTLE_QUIET
        };
        // 首轮扫到的是上次会话的残留文件：此刻不可能有正在传的文件，按常规静默期入库即可
        let mut first_scan = true;

        'session: loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            reported.retain(|(_, at)| at.elapsed() < REPORT_GRACE);

            // FTP 收件箱主动重扫：新文件最迟一个轮询周期内被发现
            if opts.rescan {
                let quiet = if first_scan { SETTLE_QUIET } else { live_quiet };
                for entry in walkdir::WalkDir::new(&opts.watch_dir)
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    if entry.file_type().is_file() {
                        consider(
                            &mut pending,
                            &mut reported,
                            entry.path().to_path_buf(),
                            quiet,
                            emit,
                        );
                    }
                }
                first_scan = false;
            }

            // 收满一个完整轮询周期的消息再判定写完没有：节奏必须由时间决定。
            // 传输中文件系统事件是雪崩式的，若来一个事件就判定一次，几毫秒内就能
            // 凑够「大小没变」的次数，把还在传的文件当成传完 → 入库半张图。
            let deadline = Instant::now() + POLL_INTERVAL;
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                match rx.recv_timeout(left) {
                    Ok(WatchMsg::Touched(p)) => {
                        consider(&mut pending, &mut reported, p, live_quiet, emit)
                    }
                    Ok(WatchMsg::Uploaded(p)) => mark_uploaded(&mut pending, &mut reported, &p),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => break 'session,
                }
            }

            if stop.load(Ordering::Relaxed) {
                break;
            }

            // 大小还在涨 → 上报接收进度；FTP 报了传完、或大小静默够久 → 入库
            let mut ready: Vec<PathBuf> = Vec::new();
            let mut gone: Vec<PathBuf> = Vec::new();
            for (path, state) in pending.iter_mut() {
                match std::fs::metadata(path) {
                    Ok(meta) => {
                        let size = meta.len();
                        let grew = size != state.last_size;
                        if grew {
                            state.last_size = size;
                            state.changed_at = Instant::now();
                        }
                        if size > 0 && (state.uploaded || state.changed_at.elapsed() >= state.quiet)
                        {
                            ready.push(path.clone());
                        } else if grew {
                            let mut p = TetherFilePayload::new(path, "receiving");
                            p.size = size;
                            emit(p);
                        }
                    }
                    // 源文件消失（临时文件被改名等），从列表拿掉
                    Err(_) => gone.push(path.clone()),
                }
            }
            for path in gone {
                pending.remove(&path);
                emit(TetherFilePayload::new(&path, "removed"));
            }
            for path in ready {
                pending.remove(&path);
                process_file(&path, &opts, emit);
            }
        }
    });

    Ok(tx)
}

fn consider(
    pending: &mut HashMap<PathBuf, PendingFile>,
    reported: &mut Vec<(PathBuf, Instant)>,
    path: PathBuf,
    quiet: Duration,
    emit: &dyn Fn(TetherFilePayload),
) {
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
    let mut payload = TetherFilePayload::new(&path, "receiving");
    payload.size = meta.len();
    emit(payload);
    let uploaded = match reported.iter().position(|(rel, _)| path.ends_with(rel)) {
        Some(i) => {
            reported.remove(i);
            true
        }
        None => false,
    };
    pending.insert(
        path,
        PendingFile {
            last_size: meta.len(),
            changed_at: Instant::now(),
            quiet,
            uploaded,
        },
    );
}

/// FTP 报的是客户端视角的路径（可能相对于会话工作目录），按路径后缀匹配收件箱里待入库的文件。
/// 文件还没被扫到就先收到通知的话，把通知留着，等 [`consider`] 认领。
fn mark_uploaded(
    pending: &mut HashMap<PathBuf, PendingFile>,
    reported: &mut Vec<(PathBuf, Instant)>,
    path: &str,
) {
    let rel: PathBuf = path
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    if rel.as_os_str().is_empty() {
        return;
    }
    let mut matched = false;
    for (path, state) in pending.iter_mut() {
        if path.ends_with(&rel) {
            state.uploaded = true;
            matched = true;
        }
    }
    if !matched {
        reported.push((rel, Instant::now()));
    }
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

fn process_file(src: &Path, opts: &TetherOptions, emit: &dyn Fn(TetherFilePayload)) {
    let mut payload = TetherFilePayload::new(src, "error");

    let meta = match std::fs::metadata(src) {
        Ok(m) => m,
        Err(e) => {
            payload.error = format!("读取文件失败: {e}");
            emit(payload);
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
        emit(payload);
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
            emit(payload);
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
            emit(payload);
        }
        Err(e) => {
            payload.error = e;
            emit(payload);
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

/// 把「STOR 已完成」转达给监听线程。大小静默只是兜底判据，
/// 有了这个信号才能确定相机整份传完，既不会入库半张图，也不用干等静默期。
#[derive(Debug)]
struct UploadNotifier {
    tx: Mutex<Sender<WatchMsg>>,
}

#[async_trait::async_trait]
impl libunftp::notification::DataListener for UploadNotifier {
    async fn receive_data_event(
        &self,
        event: libunftp::notification::DataEvent,
        _meta: libunftp::notification::EventMeta,
    ) {
        if let libunftp::notification::DataEvent::Put { path, .. } = event {
            if let Ok(tx) = self.tx.lock() {
                let _ = tx.send(WatchMsg::Uploaded(path));
            }
        }
    }
}

/// 在指定端口起 FTP 服务，根目录为收件箱。返回任务句柄，结束会话时 abort。
pub fn spawn_ftp_server(
    root: PathBuf,
    port: u16,
    user: String,
    pass: String,
    watch_tx: Sender<WatchMsg>,
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
        .notify_data(UploadNotifier {
            tx: Mutex::new(watch_tx),
        })
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
    ["utun", "tun", "tap", "awdl", "llw", "bridge", "vmnet", "lo", "gif", "stf", "anpi"]
        .iter()
        .any(|p| name.starts_with(p))
}

fn rank_candidates(mut raw: Vec<(String, std::net::Ipv4Addr)>) -> Vec<(String, std::net::Ipv4Addr)> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 相机传输中文件系统事件是雪崩式的：写完与否必须按真实时间判断。
    /// 按「事件轮数」计数会在几毫秒内判定完成，把还在写的文件入库 → 半张图。
    #[test]
    fn growing_file_is_not_imported_during_an_event_storm() {
        let base = std::env::temp_dir().join(format!("mascopy-settle-test-{}", std::process::id()));
        let watch = base.join("watch");
        let target = base.join("target");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&watch).unwrap();
        std::fs::create_dir_all(&target).unwrap();

        let (evt_tx, evt_rx) = std::sync::mpsc::channel::<TetherFilePayload>();
        let stop = Arc::new(AtomicBool::new(false));
        let tx = spawn_watcher_with(
            TetherOptions {
                watch_dir: watch.clone(),
                target_dir: target.clone(),
                move_files: false,
                rescan: true,
                ftp_fed: false,
            },
            stop.clone(),
            move |p| {
                let _ = evt_tx.send(p);
            },
        )
        .unwrap();

        // 分段写入：每段之间只有事件、没有新数据，模拟相机传输中的网络间隙
        let file = watch.join("IMG_0001.JPG");
        let chunk = vec![7u8; 64 * 1024];
        let chunks = 6;
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&file).unwrap();
            for _ in 0..chunks {
                f.write_all(&chunk).unwrap();
                f.flush().unwrap();
                for _ in 0..60 {
                    let _ = tx.send(WatchMsg::Touched(file.clone()));
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        }
        let total = (chunks * chunk.len()) as u64;

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut done: Option<TetherFilePayload> = None;
        while done.is_none() && Instant::now() < deadline {
            if let Ok(p) = evt_rx.recv_timeout(Duration::from_millis(200)) {
                if p.status == "done" {
                    done = Some(p);
                }
            }
        }
        stop.store(true, Ordering::Relaxed);

        let done = done.expect("文件写完后应当入库");
        assert_eq!(done.size, total, "文件还在写就被判定为传完");
        let dest = PathBuf::from(&done.target_path);
        assert_eq!(
            std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0),
            total,
            "入库的文件被截断了"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// FTP 全链路：上传完成信号必须直达监听线程并立刻入库。
    /// 断言在远小于 SETTLE_QUIET_FTP 的时间内完成，即入库是靠信号而不是靠静默兜底。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ftp_upload_lands_complete_via_put_signal() {
        let base = std::env::temp_dir().join(format!("mascopy-ftp-e2e-{}", std::process::id()));
        let inbox = base.join("inbox");
        let target = base.join("target");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&inbox).unwrap();
        std::fs::create_dir_all(&target).unwrap();

        let (evt_tx, evt_rx) = std::sync::mpsc::channel::<TetherFilePayload>();
        let stop = Arc::new(AtomicBool::new(false));
        let watch_tx = spawn_watcher_with(
            TetherOptions {
                watch_dir: inbox.clone(),
                target_dir: target.clone(),
                move_files: true,
                rescan: true,
                ftp_fed: true,
            },
            stop.clone(),
            move |p| {
                let _ = evt_tx.send(p);
            },
        )
        .unwrap();
        let task = spawn_ftp_server(
            inbox.clone(),
            21298,
            "eos".to_string(),
            "eos".to_string(),
            watch_tx,
        );
        tokio::time::sleep(Duration::from_millis(500)).await;

        let size = 2 * 1024 * 1024;
        let payload = base.join("payload.bin");
        std::fs::write(&payload, vec![9u8; size]).unwrap();
        let ok = std::process::Command::new("curl")
            .args([
                "-sS",
                "-m",
                "10",
                "-T",
                payload.to_str().unwrap(),
                "--user",
                "eos:eos",
                "ftp://127.0.0.1:21298/IMG_0002.JPG",
            ])
            .output()
            .unwrap();
        assert!(
            ok.status.success(),
            "curl 上传失败: {}",
            String::from_utf8_lossy(&ok.stderr)
        );

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut done: Option<TetherFilePayload> = None;
        while done.is_none() && Instant::now() < deadline {
            if let Ok(p) = evt_rx.recv_timeout(Duration::from_millis(200)) {
                if p.status == "done" {
                    done = Some(p);
                }
            }
        }
        stop.store(true, Ordering::Relaxed);
        task.abort();

        let done = done.expect("上传完成后应当立刻入库（没收到完成信号？）");
        assert_eq!(done.size as usize, size, "入库时文件还没传完");
        let dest = PathBuf::from(&done.target_path);
        assert_eq!(
            std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0) as usize,
            size,
            "入库的文件被截断了"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 用本机真实场景验证：代理 TUN（198.19.x）、Tailscale（100.x）、lo0 别名都被过滤，
    /// 只留物理网卡 en0 的局域网地址
    #[test]
    fn lan_candidates_filter_virtual_interfaces() {
        use std::net::Ipv4Addr;
        let ranked = rank_candidates(vec![
            ("lo0".to_string(), Ipv4Addr::new(172, 30, 226, 225)),
            ("utun4".to_string(), Ipv4Addr::new(100, 112, 183, 48)),
            ("utun5".to_string(), Ipv4Addr::new(198, 19, 0, 1)),
            ("en0".to_string(), Ipv4Addr::new(192, 168, 31, 218)),
            ("awdl0".to_string(), Ipv4Addr::new(169, 254, 3, 4)),
        ]);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].0, "en0");
        assert_eq!(ranked[0].1.to_string(), "192.168.31.218");
    }

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
