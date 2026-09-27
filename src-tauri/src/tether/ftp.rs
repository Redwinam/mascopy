use std::collections::HashMap;
use std::fmt::Debug;
use std::net::{Shutdown, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use libunftp::auth::{DefaultUser, Principal};
use libunftp::storage::{Error as StorageError, ErrorKind, Fileinfo, StorageBackend};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::Notify;

use super::{SessionControl, WatchMsg};

const STAGING_DIR: &str = ".mascopy-staging";
const COMPLETED_DIR: &str = ".mascopy-completed";
static TRANSFER_SEQ: AtomicU64 = AtomicU64::new(0);

/* ---------------- 内置 FTP：已提交文件与会话生命周期 ---------------- */

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
    ) -> Result<Principal, libunftp::auth::AuthenticationError> {
        if username == self.user && creds.password.as_deref() == Some(self.pass.as_str()) {
            Ok(Principal {
                username: username.to_string(),
            })
        } else {
            Err(libunftp::auth::AuthenticationError::BadPassword)
        }
    }
}

#[derive(Default, Debug)]
struct Activity {
    count: AtomicUsize,
    drained: Notify,
}

struct ActivityGuard(Arc<Activity>);
impl Drop for ActivityGuard {
    fn drop(&mut self) {
        if self.0.count.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.0.drained.notify_waiters();
        }
    }
}
impl Activity {
    fn enter(self: &Arc<Self>, control: &SessionControl) -> Result<ActivityGuard, StorageError> {
        self.count.fetch_add(1, Ordering::AcqRel);
        let guard = ActivityGuard(self.clone());
        if control.is_stopped() {
            return Err(ErrorKind::ConnectionClosed.into());
        }
        Ok(guard)
    }
    async fn drain(&self) {
        loop {
            let notified = self.drained.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.count.load(Ordering::Acquire) == 0 {
                return;
            }
            notified.await;
        }
    }
}

/// 此目录只由程序创建；拒绝以符号链接充当提交或暂存边界。
pub fn prepare_inbox(root: &Path) -> Result<PathBuf, String> {
    if std::fs::symlink_metadata(root)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("收件箱不能是符号链接".into());
    }
    std::fs::create_dir_all(root).map_err(|e| format!("创建收件箱失败: {e}"))?;
    let root = root
        .canonicalize()
        .map_err(|e| format!("收件箱不可用: {e}"))?;
    for name in [STAGING_DIR, COMPLETED_DIR] {
        let dir = root.join(name);
        match std::fs::create_dir(&dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let meta = std::fs::symlink_metadata(&dir).map_err(|e| e.to_string())?;
                if !meta.is_dir() {
                    return Err("FTP 内部目录被其他文件或符号链接占用".into());
                }
            }
            Err(e) => return Err(format!("创建 FTP 内部目录失败: {e}")),
        }
    }
    Ok(root.join(COMPLETED_DIR))
}

#[derive(Clone, Debug)]
struct InboxStorage {
    inner: Arc<unftp_sbe_fs::Filesystem>,
    root: PathBuf,
    control: SessionControl,
    activity: Arc<Activity>,
    watch_tx: Sender<WatchMsg>,
}

impl InboxStorage {
    fn public_path(&self, path: &Path) -> Result<PathBuf, StorageError> {
        if self.control.is_stopped() {
            return Err(ErrorKind::ConnectionClosed.into());
        }
        let mut result = PathBuf::new();
        for part in path.components() {
            match part {
                Component::RootDir | Component::CurDir => {}
                Component::ParentDir if result.pop() => {}
                Component::Normal(name) if !name.to_string_lossy().starts_with(".mascopy-") => {
                    result.push(name)
                }
                _ => return Err(ErrorKind::PermissionDenied.into()),
            }
        }
        if result.as_os_str().is_empty() {
            result.push(".");
        }
        Ok(result)
    }

    async fn put_complete<R: AsyncRead + Send + Sync + Unpin + 'static>(
        &self,
        user: &DefaultUser,
        mut input: R,
        path: &Path,
        start_pos: u64,
    ) -> Result<u64, StorageError> {
        let _active = self.activity.enter(&self.control)?;
        let path = self.public_path(path)?;
        if start_pos != 0 {
            return Err(ErrorKind::CommandNotImplemented.into());
        }
        let filename = path.file_name().ok_or(ErrorKind::FileNameNotAllowedError)?;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        self.inner.cwd(user, parent).await?;
        let id = format!(
            "transfer-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            TRANSFER_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let staging = self.root.join(STAGING_DIR).join(&id);
        let completed = self.root.join(COMPLETED_DIR).join(&id);
        tokio::fs::create_dir(&staging)
            .await
            .map_err(StorageError::from)?;
        let staged_path = staging.join(filename);
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged_path)
            .await
            .map_err(StorageError::from)?;
        let mut buf = vec![0u8; 128 * 1024];
        let mut total = 0;
        let result = loop {
            let read = tokio::select! {
                biased;
                _ = self.control.cancelled() => break Err(StorageError::from(ErrorKind::ConnectionClosed)),
                read = input.read(&mut buf) => read,
            };
            match read {
                Ok(0) => break Ok(()),
                Ok(n) => {
                    if let Err(e) = file.write_all(&buf[..n]).await {
                        break Err(StorageError::from(e));
                    }
                    total += n as u64;
                }
                Err(e) => break Err(StorageError::from(e)),
            }
        };
        // 即使取消/网络失败，也等已排入 tokio 文件线程池的写入结束后才释放活动计数。
        file.flush().await.map_err(StorageError::from)?;
        result?;
        file.sync_all().await.map_err(StorageError::from)?;
        drop(file);
        if self.control.is_stopped() {
            return Err(ErrorKind::ConnectionClosed.into());
        }
        // 原子迁移整个传输目录：重启后 completed 中的对象就是完成记录。
        tokio::fs::rename(&staging, &completed)
            .await
            .map_err(StorageError::from)?;
        let _ = self
            .watch_tx
            .send(WatchMsg::Uploaded(completed.join(filename)));
        Ok(total)
    }
}

#[async_trait::async_trait]
impl StorageBackend<DefaultUser> for InboxStorage {
    type Metadata = unftp_sbe_fs::Meta;
    // 不广告 REST：失败传输保留在 staging，仅完整重传可以生成 committed 对象。
    async fn metadata<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        path: P,
    ) -> Result<Self::Metadata, StorageError> {
        self.inner
            .metadata(user, self.public_path(path.as_ref())?)
            .await
    }
    async fn list<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        path: P,
    ) -> Result<Vec<Fileinfo<PathBuf, Self::Metadata>>, StorageError> {
        let mut files = self
            .inner
            .list(user, self.public_path(path.as_ref())?)
            .await?;
        files.retain(|f| {
            !f.path
                .file_name()
                .map(|n| n.to_string_lossy().starts_with(".mascopy-"))
                .unwrap_or(false)
        });
        Ok(files)
    }
    async fn get<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        path: P,
        start_pos: u64,
    ) -> Result<Box<dyn AsyncRead + Send + Sync + Unpin>, StorageError> {
        self.inner
            .get(user, self.public_path(path.as_ref())?, start_pos)
            .await
    }
    async fn put<P: AsRef<Path> + Send + Debug, R: AsyncRead + Send + Sync + Unpin + 'static>(
        &self,
        user: &DefaultUser,
        input: R,
        path: P,
        start_pos: u64,
    ) -> Result<u64, StorageError> {
        self.put_complete(user, input, path.as_ref(), start_pos)
            .await
    }
    async fn del<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        path: P,
    ) -> Result<(), StorageError> {
        let _active = self.activity.enter(&self.control)?;
        self.inner.del(user, self.public_path(path.as_ref())?).await
    }
    async fn mkd<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        path: P,
    ) -> Result<(), StorageError> {
        let _active = self.activity.enter(&self.control)?;
        self.inner.mkd(user, self.public_path(path.as_ref())?).await
    }
    async fn rename<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        from: P,
        to: P,
    ) -> Result<(), StorageError> {
        let _active = self.activity.enter(&self.control)?;
        self.inner
            .rename(
                user,
                self.public_path(from.as_ref())?,
                self.public_path(to.as_ref())?,
            )
            .await
    }
    async fn rmd<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        path: P,
    ) -> Result<(), StorageError> {
        let _active = self.activity.enter(&self.control)?;
        self.inner.rmd(user, self.public_path(path.as_ref())?).await
    }
    async fn cwd<P: AsRef<Path> + Send + Debug>(
        &self,
        user: &DefaultUser,
        path: P,
    ) -> Result<(), StorageError> {
        self.inner.cwd(user, self.public_path(path.as_ref())?).await
    }
}

pub struct FtpHandle {
    pub local_addr: SocketAddr,
    thread: Option<std::thread::JoinHandle<Result<(), String>>>,
    control: SessionControl,
    activity: Arc<Activity>,
}

impl FtpHandle {
    pub(super) async fn shutdown(mut self) -> Result<(), String> {
        self.control.stop();
        let result = if let Some(thread) = self.thread.take() {
            match tauri::async_runtime::spawn_blocking(move || thread.join()).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err("FTP 会话线程异常退出".into()),
                Err(e) => Err(format!("等待 FTP 会话线程失败: {e}")),
            }
        } else {
            Ok(())
        };
        self.activity.drain().await;
        result
    }
}
impl Drop for FtpHandle {
    fn drop(&mut self) {
        self.control.stop();
    }
}

pub async fn spawn_ftp_server(
    root: PathBuf,
    bind_addr: SocketAddr,
    user: String,
    pass: String,
    watch_tx: Sender<WatchMsg>,
    control: SessionControl,
) -> Result<FtpHandle, String> {
    prepare_inbox(&root)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let inner = Arc::new(
        unftp_sbe_fs::Filesystem::new(root.clone()).map_err(|e| format!("收件箱不可用: {e}"))?,
    );
    let activity = Arc::new(Activity::default());
    let storage = InboxStorage {
        inner,
        root,
        control: control.clone(),
        activity: activity.clone(),
        watch_tx,
    };
    let auth = Arc::new(FixedAuth { user, pass });
    let build_server = move || {
        let storage = storage.clone();
        libunftp::ServerBuilder::with_authenticator(Box::new(move || storage.clone()), auth.clone())
            .greeting("mascopy tether")
            .passive_ports(50021..=50040)
            .build()
    };
    // 在返回成功前验证构建，并持有真正用于 accept 的监听 socket。
    let _validated = build_server().map_err(|e| format!("FTP 服务配置失败: {e}"))?;
    let listener =
        std::net::TcpListener::bind(bind_addr).map_err(|e| format!("FTP 端口无法使用: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let local_addr = listener.local_addr().map_err(|e| e.to_string())?;
    let task_control = control.clone();
    let thread_activity = activity.clone();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    // libunftp 会独立 spawn 控制/被动监听/数据任务。会话拥有整个 runtime，
    // 停止时先完成受控写入，再销毁 runtime，确保连空 PASV socket 也不残留。
    let thread = std::thread::Builder::new().name("mascopy-ftp-session".into()).spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build() {
            Ok(runtime) => runtime,
            Err(error) => {
                let error = format!("创建 FTP 运行时失败: {error}");
                let _ = ready_tx.send(Err(error.clone()));
                return Err(error);
            }
        };
        let result = runtime.block_on(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    let error = format!("启动 FTP 监听失败: {error}");
                    let _ = ready_tx.send(Err(error.clone()));
                    return Err(error);
                }
            };
            let _ = ready_tx.send(Ok(()));
        let mut connections = tokio::task::JoinSet::new();
        let mut sockets = HashMap::new();
        let mut next_id = 0u64;
        let mut error = None;
        loop {
            tokio::select! {
                biased;
                _ = task_control.cancelled() => break,
                Some(result) = connections.join_next(), if !connections.is_empty() => {
                    if let Ok(id) = result { sockets.remove(&id); }
                }
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, _)) => {
                            let server = match build_server() {
                                Ok(server) => server,
                                Err(e) => { error = Some(format!("FTP 服务配置失败: {e}")); break; }
                            };
                            let std_stream = match stream.into_std() {
                                Ok(stream) => stream,
                                Err(e) => { error = Some(e.to_string()); break; }
                            };
                            let shutdown_socket = match std_stream.try_clone() {
                                Ok(stream) => stream,
                                Err(e) => { error = Some(e.to_string()); break; }
                            };
                            let stream = match tokio::net::TcpStream::from_std(std_stream) {
                                Ok(stream) => stream,
                                Err(e) => { error = Some(e.to_string()); break; }
                            };
                            let id = next_id;
                            next_id += 1;
                            sockets.insert(id, shutdown_socket);
                            connections.spawn(async move { let _ = server.service(stream).await; id });
                        }
                        Err(e) => { error = Some(format!("FTP 接受连接失败: {e}")); break; }
                    }
                }
            }
        }
        task_control.stop();
        drop(listener);
        for socket in sockets.values() {
            let _ = socket.shutdown(Shutdown::Both);
        }
        while connections.join_next().await.is_some() {}
            thread_activity.drain().await;
            match error { Some(error) => Err(error), None => Ok(()) }
        });
        // 在专属普通线程 drop，等待底层文件任务并取消所有 libunftp 子任务。
        drop(runtime);
        result
    }).map_err(|e| format!("启动 FTP 会话线程失败: {e}"))?;
    let handle = FtpHandle {
        local_addr,
        thread: Some(thread),
        control,
        activity,
    };
    match ready_rx.await {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(error)) => {
            let _ = handle.shutdown().await;
            Err(error)
        }
        Err(error) => {
            let _ = handle.shutdown().await;
            Err(format!("FTP 启动未完成: {error}"))
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
