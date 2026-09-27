use super::super::{
    process_file, rank_candidates, spawn_watcher_with, validate_watch_target, Fingerprint,
    SessionControl, TetherFilePayload, TetherHandle, TetherOptions,
};
use super::*;
use chrono::{DateTime, Local};
use std::io::Write;
use std::pin::Pin;
use std::sync::mpsc::{self, Receiver};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::ReadBuf;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "mascopy-tether-test-{}-{}",
            std::process::id(),
            TRANSFER_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn dir(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        std::fs::create_dir_all(&path).unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn wait_for(
    rx: &Receiver<TetherFilePayload>,
    status: &str,
    timeout: Duration,
) -> TetherFilePayload {
    let end = Instant::now() + timeout;
    loop {
        let left = end.saturating_duration_since(Instant::now());
        assert!(!left.is_zero(), "未收到 {status} 事件");
        let payload = rx.recv_timeout(left).expect("监听事件超时");
        if payload.status == status {
            return payload;
        }
    }
}

fn storage(root: &Path, control: &SessionControl, tx: Sender<WatchMsg>) -> InboxStorage {
    prepare_inbox(root).unwrap();
    InboxStorage {
        root: root.canonicalize().unwrap(),
        inner: Arc::new(unftp_sbe_fs::Filesystem::new(root).unwrap()),
        control: control.clone(),
        activity: Arc::new(Activity::default()),
        watch_tx: tx,
    }
}

fn files(root: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect()
}

fn ftp_reply(reader: &mut std::io::BufReader<std::net::TcpStream>) -> String {
    use std::io::BufRead;
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    assert!(!line.is_empty());
    line
}
fn ftp_command(
    writer: &mut std::net::TcpStream,
    reader: &mut std::io::BufReader<std::net::TcpStream>,
    command: &str,
) -> String {
    writer
        .write_all(format!("{command}\r\n").as_bytes())
        .unwrap();
    ftp_reply(reader)
}
fn ftp_login(
    address: SocketAddr,
) -> (std::net::TcpStream, std::io::BufReader<std::net::TcpStream>) {
    let mut control = std::net::TcpStream::connect(address).unwrap();
    control
        .set_read_timeout(Some(Duration::from_secs(4)))
        .unwrap();
    let mut reader = std::io::BufReader::new(control.try_clone().unwrap());
    assert!(ftp_reply(&mut reader).starts_with("220"));
    assert!(ftp_command(&mut control, &mut reader, "USER audit").starts_with("331"));
    assert!(ftp_command(&mut control, &mut reader, "PASS synthetic").starts_with("230"));
    (control, reader)
}

#[test]
fn growing_file_is_not_imported_during_an_event_storm() {
    let f = Fixture::new();
    let watch = f.dir("watch");
    let target = f.dir("target");
    let control = SessionControl::new();
    let (tx, rx) = mpsc::channel();
    let watcher = spawn_watcher_with(
        TetherOptions {
            watch_dir: watch.clone(),
            target_dir: target,
            move_files: false,
            rescan: true,
            ftp_fed: false,
        },
        control.clone(),
        move |p| {
            let _ = tx.send(p);
        },
    )
    .unwrap();
    let path = watch.join("IMG.JPG");
    let chunk = vec![7; 64 * 1024];
    let mut file = std::fs::File::create(&path).unwrap();
    for _ in 0..6 {
        file.write_all(&chunk).unwrap();
        file.flush().unwrap();
        for _ in 0..40 {
            watcher.tx.send(WatchMsg::Touched(path.clone())).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!rx.try_iter().any(|p| p.status == "done"));
    }
    drop(file);
    let done = wait_for(&rx, "done", Duration::from_secs(4));
    watcher.join().unwrap();
    assert_eq!(done.size, 6 * chunk.len() as u64);
    assert_eq!(
        std::fs::metadata(done.target_path).unwrap().len(),
        done.size
    );
}

#[test]
fn same_size_different_content_is_preserved_and_identical_retry_skips() {
    let f = Fixture::new();
    let watch = f.dir("watch");
    let target = f.dir("target");
    let src = watch.join("IMG.JPG");
    std::fs::write(&src, b"new image").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&src, std::fs::Permissions::from_mode(0o640)).unwrap();
    }
    let fingerprint = Fingerprint::read(&src).unwrap();
    let date: DateTime<Local> = fingerprint.modified.unwrap().into();
    let date_dir = target.join(date.format("%Y-%m-%d").to_string());
    std::fs::create_dir(&date_dir).unwrap();
    std::fs::write(date_dir.join("IMG.JPG"), b"old image").unwrap();
    let opts = TetherOptions {
        watch_dir: watch,
        target_dir: target,
        move_files: true,
        rescan: false,
        ftp_fed: true,
    };
    let result = process_file(&src, fingerprint, &opts, &SessionControl::new())
        .unwrap()
        .unwrap();
    assert_eq!(result.status, "done");
    assert_eq!(
        std::fs::read(date_dir.join("IMG.JPG")).unwrap(),
        b"old image"
    );
    assert_eq!(std::fs::read(&result.target_path).unwrap(), b"new image");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&result.target_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
    }
    assert!(!src.exists());
    std::fs::write(&src, b"new image").unwrap();
    let result = process_file(
        &src,
        Fingerprint::read(&src).unwrap(),
        &opts,
        &SessionControl::new(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(result.status, "skipped");
    assert!(!src.exists());
}

#[test]
fn watch_snapshots_never_delete_an_upstream_file_even_with_legacy_move_flag() {
    let f = Fixture::new();
    let watch = f.dir("watch");
    let target = f.dir("target");
    let source = watch.join("IMG.JPG");
    std::fs::write(&source, b"first part").unwrap();
    let opts = TetherOptions {
        watch_dir: watch,
        target_dir: target,
        move_files: true,
        rescan: false,
        ftp_fed: false,
    };
    let first = process_file(
        &source,
        Fingerprint::read(&source).unwrap(),
        &opts,
        &SessionControl::new(),
    )
    .unwrap()
    .unwrap();
    assert!(source.exists());
    std::fs::OpenOptions::new()
        .append(true)
        .open(&source)
        .unwrap()
        .write_all(b" final part")
        .unwrap();
    let last = process_file(
        &source,
        Fingerprint::read(&source).unwrap(),
        &opts,
        &SessionControl::new(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(std::fs::read(&source).unwrap(), b"first part final part");
    assert_eq!(std::fs::read(first.target_path).unwrap(), b"first part");
    assert_eq!(
        std::fs::read(last.target_path).unwrap(),
        b"first part final part"
    );
}

#[test]
fn watch_retries_after_target_recovers_without_another_source_event() {
    let f = Fixture::new();
    let watch = f.dir("watch");
    let target = f.0.join("unavailable");
    std::fs::write(&target, b"blocks directory creation").unwrap();
    let control = SessionControl::new();
    let (tx, rx) = mpsc::channel();
    let watcher = spawn_watcher_with(
        TetherOptions {
            watch_dir: watch.clone(),
            target_dir: target.clone(),
            move_files: false,
            rescan: false,
            ftp_fed: false,
        },
        control,
        move |p| {
            let _ = tx.send(p);
        },
    )
    .unwrap();
    let src = watch.join("IMG.JPG");
    std::fs::write(&src, b"complete").unwrap();
    watcher.tx.send(WatchMsg::Touched(src)).unwrap();
    wait_for(&rx, "error", Duration::from_secs(4));
    std::fs::remove_file(&target).unwrap();
    std::fs::create_dir(&target).unwrap();
    let result = wait_for(&rx, "done", Duration::from_secs(4));
    watcher.join().unwrap();
    assert_eq!(std::fs::read(result.target_path).unwrap(), b"complete");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stalled_ftp_upload_is_not_imported_after_thirty_seconds() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let target = f.dir("target");
    let completed = prepare_inbox(&root).unwrap();
    let control = SessionControl::new();
    let (tx, rx) = mpsc::channel();
    let watcher = spawn_watcher_with(
        TetherOptions {
            watch_dir: completed.clone(),
            target_dir: target,
            move_files: true,
            rescan: true,
            ftp_fed: true,
        },
        control.clone(),
        move |p| {
            let _ = tx.send(p);
        },
    )
    .unwrap();
    let store = storage(&root, &control, watcher.tx.clone());
    let (mut writer, reader) = tokio::io::duplex(1024);
    let put = tokio::spawn(async move {
        store
            .put(&DefaultUser, reader, Path::new("IMG.JPG"), 0)
            .await
    });
    writer.write_all(b"start").await.unwrap();
    tokio::time::sleep(Duration::from_secs(31)).await;
    assert!(files(&completed).is_empty());
    assert!(!rx.try_iter().any(|p| p.status == "done"));
    writer.write_all(b"end").await.unwrap();
    writer.shutdown().await.unwrap();
    drop(writer);
    assert_eq!(put.await.unwrap().unwrap(), 8);
    let result = wait_for(&rx, "done", Duration::from_secs(3));
    watcher.join().unwrap();
    assert_eq!(std::fs::read(result.target_path).unwrap(), b"startend");
}

struct FailingReader(bool);
impl AsyncRead for FailingReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if !self.0 {
            self.0 = true;
            buf.put_slice(b"partial");
            Poll::Ready(Ok(()))
        } else {
            Poll::Ready(Err(std::io::Error::new(
                std::io::ErrorKind::ConnectionReset,
                "synthetic reset",
            )))
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_and_legacy_uploads_stay_uncommitted_across_restart() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let target = f.dir("target");
    let (tx, _) = mpsc::channel();
    let old_control = SessionControl::new();
    let store = storage(&root, &old_control, tx);
    assert!(store
        .put(
            &DefaultUser,
            FailingReader(false),
            Path::new("failed.JPG"),
            0
        )
        .await
        .is_err());
    std::fs::write(root.join("legacy.JPG"), b"unknown old bytes").unwrap();
    assert_eq!(files(&root.join(STAGING_DIR)).len(), 1);
    // 已提交但尚未被 watcher 消费的对象，应能在下一会话恢复。
    store
        .put(&DefaultUser, &b"completed"[..], Path::new("good.JPG"), 0)
        .await
        .unwrap();
    old_control.stop();
    store.activity.drain().await;
    let (tx, rx) = mpsc::channel();
    let control = SessionControl::new();
    let watcher = spawn_watcher_with(
        TetherOptions {
            watch_dir: root.join(COMPLETED_DIR),
            target_dir: target.clone(),
            move_files: true,
            rescan: true,
            ftp_fed: true,
        },
        control,
        move |p| {
            let _ = tx.send(p);
        },
    )
    .unwrap();
    let result = wait_for(&rx, "done", Duration::from_secs(3));
    std::thread::sleep(Duration::from_millis(1400));
    watcher.join().unwrap();
    assert_eq!(result.filename, "good.JPG");
    assert_eq!(files(&target).len(), 1);
    assert!(root.join("legacy.JPG").exists());
    assert_eq!(files(&root.join(STAGING_DIR)).len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cwd_same_filename_completes_only_its_own_transfer() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let (tx, rx) = mpsc::channel();
    let control = SessionControl::new();
    let store = storage(&root, &control, tx);
    store.mkd(&DefaultUser, "A").await.unwrap();
    store.mkd(&DefaultUser, "B").await.unwrap();
    let (mut writer, reader) = tokio::io::duplex(1024);
    let other = store.clone();
    let pending =
        tokio::spawn(async move { other.put(&DefaultUser, reader, "/B/IMG.JPG", 0).await });
    writer.write_all(b"still receiving").await.unwrap();
    store
        .put(&DefaultUser, &b"done A"[..], "/A/IMG.JPG", 0)
        .await
        .unwrap();
    let first = match rx.recv_timeout(Duration::from_secs(2)).unwrap() {
        WatchMsg::Uploaded(path) => path,
        _ => panic!("expected committed path"),
    };
    assert_eq!(std::fs::read(&first).unwrap(), b"done A");
    assert_eq!(files(&root.join(COMPLETED_DIR)).len(), 1);
    assert!(rx.try_recv().is_err());
    writer.shutdown().await.unwrap();
    drop(writer);
    pending.await.unwrap().unwrap();
    let second = match rx.recv_timeout(Duration::from_secs(2)).unwrap() {
        WatchMsg::Uploaded(path) => path,
        _ => panic!("expected committed path"),
    };
    assert_ne!(first, second);
    assert_eq!(std::fs::read(second).unwrap(), b"still receiving");
    assert!(store.cwd(&DefaultUser, STAGING_DIR).await.is_err());
    assert!(store
        .put(&DefaultUser, &b"x"[..], "../escape.JPG", 0)
        .await
        .is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stop_cancels_and_drains_inflight_put_and_blocks_mutations() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let (tx, _) = mpsc::channel();
    let control = SessionControl::new();
    let store = storage(&root, &control, tx);
    let (mut writer, reader) = tokio::io::duplex(1024);
    let other = store.clone();
    let put = tokio::spawn(async move { other.put(&DefaultUser, reader, "IMG.JPG", 0).await });
    writer.write_all(b"before stop").await.unwrap();
    while store.activity.count.load(Ordering::Acquire) == 0 {
        tokio::task::yield_now().await;
    }
    control.stop();
    store.activity.drain().await;
    assert!(put.await.unwrap().is_err());
    let snapshots: Vec<_> = files(&root)
        .iter()
        .map(|p| (p.clone(), std::fs::read(p).unwrap()))
        .collect();
    let _ = writer.write_all(b"after stop").await;
    assert!(store.mkd(&DefaultUser, "after-stop").await.is_err());
    assert!(store
        .put(&DefaultUser, &b"new"[..], "new.JPG", 0)
        .await
        .is_err());
    tokio::time::sleep(Duration::from_millis(100)).await;
    for (path, bytes) in snapshots {
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
    assert!(files(&root.join(COMPLETED_DIR)).is_empty());
}

async fn ftp_fixture(root: PathBuf, tx: Sender<WatchMsg>, control: SessionControl) -> FtpHandle {
    spawn_ftp_server(
        root,
        SocketAddr::from(([127, 0, 0, 1], 0)),
        "audit".into(),
        "synthetic".into(),
        tx,
        control,
    )
    .await
    .unwrap()
}
fn curl_upload(port: u16, payload: &Path, user: &str) -> std::process::Output {
    std::process::Command::new("curl")
        .args([
            "--noproxy",
            "*",
            "-sS",
            "-m",
            "8",
            "-T",
            payload.to_str().unwrap(),
            "--user",
            user,
            &format!("ftp://127.0.0.1:{port}/IMG.JPG"),
        ])
        .output()
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ftp_upload_roundtrip() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let (tx, _) = mpsc::channel();
    let control = SessionControl::new();
    let ftp = ftp_fixture(root.clone(), tx, control).await;
    let payload = f.0.join("payload.bin");
    std::fs::write(&payload, b"ftp complete bytes").unwrap();
    assert!(!curl_upload(ftp.local_addr.port(), &payload, "audit:wrong")
        .status
        .success());
    let result = curl_upload(ftp.local_addr.port(), &payload, "audit:synthetic");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    ftp.shutdown().await.unwrap();
    let committed = files(&root.join(COMPLETED_DIR));
    assert_eq!(committed.len(), 1);
    assert_eq!(
        std::fs::read(&committed[0]).unwrap(),
        std::fs::read(payload).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ftp_upload_lands_complete_via_put_signal() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let completed = prepare_inbox(&root).unwrap();
    let target = f.dir("target");
    let control = SessionControl::new();
    let (tx, rx) = mpsc::channel();
    let watcher = spawn_watcher_with(
        TetherOptions {
            watch_dir: completed,
            target_dir: target,
            move_files: true,
            rescan: true,
            ftp_fed: true,
        },
        control.clone(),
        move |p| {
            let _ = tx.send(p);
        },
    )
    .unwrap();
    let ftp = ftp_fixture(root, watcher.tx.clone(), control.clone()).await;
    let payload = f.0.join("payload.bin");
    std::fs::write(&payload, vec![9; 2 * 1024 * 1024]).unwrap();
    let result = curl_upload(ftp.local_addr.port(), &payload, "audit:synthetic");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let done = wait_for(&rx, "done", Duration::from_secs(3));
    TetherHandle {
        control,
        watcher: Some(watcher),
        ftp: Some(ftp),
    }
    .shutdown()
    .await
    .unwrap();
    assert_eq!(
        std::fs::read(done.target_path).unwrap(),
        std::fs::read(payload).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bound_listener_prevents_false_start_and_shutdown_releases_port() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let held = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = held.local_addr().unwrap();
    let (tx, _) = mpsc::channel();
    assert!(spawn_ftp_server(
        root.clone(),
        address,
        "audit".into(),
        "synthetic".into(),
        tx.clone(),
        SessionControl::new()
    )
    .await
    .is_err());
    drop(held);
    let ftp = spawn_ftp_server(
        root,
        address,
        "audit".into(),
        "synthetic".into(),
        tx,
        SessionControl::new(),
    )
    .await
    .unwrap();
    let (mut control, mut reader) = ftp_login(address);
    let passive = ftp_command(&mut control, &mut reader, "EPSV");
    assert!(passive.starts_with("229"));
    let passive_port: u16 = passive.split('|').nth(3).unwrap().parse().unwrap();
    ftp.shutdown().await.unwrap();
    drop(control);
    drop(reader);
    let _rebound = tokio::net::TcpListener::bind(address).await.unwrap();
    let _passive_rebound = std::net::TcpListener::bind(("127.0.0.1", passive_port)).unwrap();
}

#[test]
fn overlapping_watch_roots_and_self_destination_never_delete_source() {
    let f = Fixture::new();
    let target = f.dir("target");
    let date = Local::now().format("%Y-%m-%d").to_string();
    let watch = target.join(date);
    std::fs::create_dir(&watch).unwrap();
    assert!(validate_watch_target(&watch, &target).is_err());
    assert!(validate_watch_target(&target, &watch).is_err());
    assert!(validate_watch_target(&target, &target).is_err());
    let source = watch.join("IMG.JPG");
    std::fs::write(&source, b"only original").unwrap();
    let result = process_file(
        &source,
        Fingerprint::read(&source).unwrap(),
        &TetherOptions {
            watch_dir: watch,
            target_dir: target,
            move_files: true,
            rescan: false,
            ftp_fed: false,
        },
        &SessionControl::new(),
    );
    assert!(result.is_err());
    assert_eq!(std::fs::read(source).unwrap(), b"only original");
}

#[cfg(unix)]
#[test]
fn destination_date_symlink_cannot_write_outside_target() {
    let f = Fixture::new();
    let target = f.dir("target");
    let watch = f.dir("watch");
    let outside = f.dir("outside");
    let source = watch.join("IMG.JPG");
    std::fs::write(&source, b"original").unwrap();
    let fp = Fingerprint::read(&source).unwrap();
    let date: DateTime<Local> = fp.modified.unwrap().into();
    std::os::unix::fs::symlink(&outside, target.join(date.format("%Y-%m-%d").to_string())).unwrap();
    assert!(process_file(
        &source,
        fp,
        &TetherOptions {
            watch_dir: watch,
            target_dir: target,
            move_files: true,
            rescan: false,
            ftp_fed: false,
        },
        &SessionControl::new()
    )
    .is_err());
    assert!(source.exists());
    assert!(files(&outside).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_ftp_stop_prevents_later_data_writes() {
    let f = Fixture::new();
    let root = f.dir("inbox");
    let (tx, _) = mpsc::channel();
    let ftp = ftp_fixture(root.clone(), tx, SessionControl::new()).await;
    let (mut control, mut reader) = ftp_login(ftp.local_addr);
    let passive = ftp_command(&mut control, &mut reader, "EPSV");
    assert!(passive.starts_with("229"));
    let port: u16 = passive.split('|').nth(3).unwrap().parse().unwrap();
    let mut data = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    assert!(ftp_command(&mut control, &mut reader, "STOR IMG.JPG").starts_with("150"));
    data.write_all(b"before stop").unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while files(&root.join(STAGING_DIR)).is_empty() {
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    ftp.shutdown().await.unwrap();
    let snapshot: Vec<_> = files(&root)
        .iter()
        .map(|p| (p.clone(), std::fs::read(p).unwrap()))
        .collect();
    let _ = data.write_all(b"after stop");
    drop(data);
    tokio::time::sleep(Duration::from_millis(150)).await;
    for (path, contents) in snapshot {
        assert_eq!(std::fs::read(path).unwrap(), contents);
    }
    assert!(files(&root.join(COMPLETED_DIR)).is_empty());
}

#[test]
fn lan_candidates_filter_virtual_interfaces() {
    use std::net::Ipv4Addr;
    let ranked = rank_candidates(vec![
        ("lo0".into(), Ipv4Addr::new(172, 30, 226, 225)),
        ("utun4".into(), Ipv4Addr::new(100, 112, 183, 48)),
        ("utun5".into(), Ipv4Addr::new(198, 19, 0, 1)),
        ("en0".into(), Ipv4Addr::new(192, 168, 31, 218)),
        ("awdl0".into(), Ipv4Addr::new(169, 254, 3, 4)),
    ]);
    assert_eq!(
        ranked,
        vec![("en0".into(), Ipv4Addr::new(192, 168, 31, 218))]
    );
}
