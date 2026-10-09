use crate::{
    scanner::MediaFile,
    storage::{files_equal_with_control, SourceStamp, StagedFile},
};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const BUFFER_SIZE: usize = 1024 * 1024;
const EMIT_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Clone, Debug, serde::Serialize)]
pub struct ProgressPayload {
    pub current: usize,
    pub total: usize,
    pub filename: String,
    pub path: String,
    pub status: String,
    pub file_done: u64,
    pub file_total: u64,
    pub overall_done: u64,
    pub overall_total: u64,
    pub speed: u64,
    pub error: Option<String>,
}
#[derive(Debug, serde::Serialize)]
pub struct UploadFailure {
    pub path: String,
    pub filename: String,
    pub error: String,
}
#[derive(Default, Debug, serde::Serialize)]
pub struct UploadOutcome {
    pub completed: usize,
    pub skipped: usize,
    pub failed: Vec<UploadFailure>,
    pub cancelled: bool,
    pub completed_paths: Vec<String>,
    pub skipped_paths: Vec<String>,
}

enum FileResult {
    Copied,
    Skipped,
    Cancelled,
}
#[derive(Default)]
struct Control {
    active: bool,
    paused: bool,
    cancelled: bool,
}
pub struct Uploader {
    control: Mutex<Control>,
    changed: Condvar,
}
pub struct UploadSession {
    uploader: Arc<Uploader>,
}
impl Uploader {
    pub fn new() -> Self {
        Self {
            control: Mutex::new(Control::default()),
            changed: Condvar::new(),
        }
    }
    pub fn start(self: &Arc<Self>) -> Result<UploadSession, String> {
        let mut c = self.control.lock().map_err(|_| "上传控制状态不可用")?;
        if c.active {
            return Err("已有上传任务运行中，请等待其结束".into());
        }
        *c = Control {
            active: true,
            ..Control::default()
        };
        Ok(UploadSession {
            uploader: self.clone(),
        })
    }
    pub fn pause(&self) {
        if let Ok(mut c) = self.control.lock() {
            if c.active {
                c.paused = true;
            }
        }
    }
    pub fn resume(&self) {
        if let Ok(mut c) = self.control.lock() {
            c.paused = false;
        }
        self.changed.notify_all();
    }
    pub fn cancel(&self) {
        if let Ok(mut c) = self.control.lock() {
            if c.active {
                c.cancelled = true;
            }
        }
        self.changed.notify_all();
    }
    fn proceed(&self) -> bool {
        let Ok(mut c) = self.control.lock() else {
            return false;
        };
        while c.paused && !c.cancelled {
            let Ok(next) = self.changed.wait(c) else {
                return false;
            };
            c = next;
        }
        !c.cancelled
    }
}
impl Drop for UploadSession {
    fn drop(&mut self) {
        if let Ok(mut c) = self.uploader.control.lock() {
            *c = Control::default();
        }
        self.uploader.changed.notify_all();
    }
}

fn validate_destination(root: &Path, destination: &Path) -> Result<(), String> {
    if !destination.is_absolute()
        || destination
            .components()
            .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("目标文件路径必须是目标目录内的绝对路径".into());
    }
    let relative = destination
        .strip_prefix(root)
        .map_err(|_| "目标文件不属于本次备份目录，请重新扫描")?;
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 2 || !parts.iter().all(|c| matches!(c, Component::Normal(_))) {
        return Err("目标必须位于单层日期目录中".into());
    }
    let date = parts[0].as_os_str().to_string_lossy();
    let parsed =
        chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "目标日期目录无效")?;
    if parsed.format("%Y-%m-%d").to_string() != date {
        return Err("目标日期目录无效".into());
    }
    let parent = destination.parent().ok_or("目标目录无效")?;
    match fs::symlink_metadata(parent) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            return Err("目标日期目录必须是普通目录".into())
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}
fn validate_plan(files: &[MediaFile], root: &Path) -> Result<(), String> {
    let mut destinations = HashSet::new();
    for file in files {
        if !matches!(file.status.as_str(), "upload" | "overwrite" | "skip") {
            return Err("无效的上传状态，请重新扫描".into());
        }
        validate_destination(root, &file.target_path)?;
        if file.target_path.file_name() != file.path.file_name() {
            return Err("目标文件名必须与源文件名完全一致，请重新扫描".into());
        }
        if !destinations.insert(file.target_path.to_string_lossy().to_lowercase()) {
            return Err("多个源文件不能使用同一目标路径，请重新扫描".into());
        }
        // Reject copying any part of the destination tree back into itself.
        let source = file
            .path
            .canonicalize()
            .map_err(|e| format!("源文件不可用 {}: {e}", file.path.display()))?;
        if source.starts_with(root) {
            return Err("源文件位于目标目录内，请重新扫描".into());
        }
    }
    Ok(())
}
impl UploadSession {
    pub fn run(
        &self,
        files: Vec<MediaFile>,
        target: PathBuf,
        mut emit: impl FnMut(ProgressPayload),
    ) -> Result<UploadOutcome, String> {
        let root = target
            .canonicalize()
            .map_err(|e| format!("目标路径不存在: {e}"))?;
        if !root.is_dir() {
            return Err("目标路径不是目录".into());
        }
        validate_plan(&files, &root)?;
        let overall_total = files
            .iter()
            .filter(|f| f.status != "skip")
            .try_fold(0u64, |s, f| s.checked_add(f.size))
            .ok_or("文件总大小超出范围")?;
        let mut overall_done = 0u64;
        let mut outcome = UploadOutcome::default();
        for (index, file) in files.iter().enumerate() {
            if !self.uploader.proceed() {
                outcome.cancelled = true;
                break;
            }
            let before = overall_done;
            let mut event = ProgressPayload {
                current: index + 1,
                total: files.len(),
                filename: file.filename.clone(),
                path: file.path.to_string_lossy().into_owned(),
                status: "uploading".into(),
                file_done: 0,
                file_total: file.size,
                overall_done,
                overall_total,
                speed: 0,
                error: None,
            };
            emit(event.clone());
            let result = self.copy_file(file, &root, &mut event, &mut emit);
            match result {
                Ok(FileResult::Skipped) => {
                    outcome.skipped += 1;
                    outcome.skipped_paths.push(event.path.clone());
                    event.status = "skipped".into();
                    event.file_done = file.size;
                    if file.status != "skip" {
                        overall_done = before + file.size;
                    }
                }
                Ok(FileResult::Copied) => {
                    outcome.completed += 1;
                    outcome.completed_paths.push(event.path.clone());
                    overall_done = before + file.size;
                    event.status = "done".into();
                    event.file_done = file.size;
                }
                Ok(FileResult::Cancelled) => {
                    outcome.cancelled = true;
                    event.status = "cancelled".into();
                }
                Err(error) => {
                    log::error!(
                        "上传失败 {} -> {}: {}",
                        file.path.display(),
                        file.target_path.display(),
                        error
                    );
                    event.error = Some(error.clone());
                    outcome.failed.push(UploadFailure {
                        path: event.path.clone(),
                        filename: file.filename.clone(),
                        error,
                    });
                    event.status = "error".into();
                    event.file_done = 0;
                }
            }
            event.overall_done = overall_done;
            event.speed = 0;
            emit(event);
            if outcome.cancelled {
                break;
            }
        }
        Ok(outcome)
    }
    fn copy_file(
        &self,
        file: &MediaFile,
        root: &Path,
        event: &mut ProgressPayload,
        emit: &mut impl FnMut(ProgressPayload),
    ) -> Result<FileResult, String> {
        let mut src = File::open(&file.path).map_err(|e| e.to_string())?;
        let meta = src.metadata().map_err(|e| e.to_string())?;
        let stamp = SourceStamp::read(&meta).map_err(|e| e.to_string())?;
        if stamp.len != file.size
            || file
                .modified
                .is_some_and(|mtime| meta.modified().ok() != Some(mtime))
        {
            return Err("源文件在扫描后发生变化，请重新扫描".into());
        }
        validate_destination(root, &file.target_path)?;
        if file.status == "skip" {
            return match self.compare_target(file, event, emit)? {
                Some(true) => Ok(FileResult::Skipped),
                Some(false) => Err("源文件或重复目标已变化，请重新扫描".into()),
                None => Ok(FileResult::Cancelled),
            };
        }
        fs::create_dir_all(file.target_path.parent().ok_or("目标目录无效")?)
            .map_err(|e| e.to_string())?;
        validate_destination(root, &file.target_path)?;
        if !self.uploader.proceed() {
            return Ok(FileResult::Cancelled);
        }
        if file.status != "overwrite" {
            match fs::symlink_metadata(&file.target_path) {
                Ok(meta) => {
                    if meta.is_file() && meta.len() == file.size {
                        match self.compare_target(file, event, emit)? {
                            Some(true) => return Ok(FileResult::Skipped),
                            Some(false) => {}
                            None => return Ok(FileResult::Cancelled),
                        }
                    }
                    return Err("目标存在同名但不完整或内容不同的文件，文件名保持不变。请返回配置，开启「覆盖重复文件」后重新扫描，并仅选择需修复的文件；程序不会自动改名另存".into());
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("无法检查目标 {}: {e}", file.target_path.display())),
            }
        }
        let mut dst = StagedFile::for_media(&file.target_path, file.status == "overwrite")
            .map_err(|e| {
                format!(
                    "创建原名目标失败 {}: {e}。请检查目标占用或覆盖设置，程序不会改名另存",
                    file.target_path.display()
                )
            })?;
        event.status = "uploading".into();
        event.file_done = 0;
        emit(event.clone());
        let mut buf = vec![0; BUFFER_SIZE];
        let base = event.overall_done;
        let mut last = Instant::now();
        let mut anchor = Instant::now();
        let mut anchor_bytes = 0;
        loop {
            let pause_started = Instant::now();
            if !self.uploader.proceed() {
                return Ok(FileResult::Cancelled);
            }
            if pause_started.elapsed() > Duration::from_millis(50) {
                anchor = Instant::now();
                anchor_bytes = event.file_done;
            }
            let n = src
                .read(&mut buf)
                .map_err(|e| format!("读取源文件失败: {e}"))?;
            if n == 0 {
                break;
            }
            event.file_done = event.file_done.checked_add(n as u64).ok_or("文件过大")?;
            if event.file_done > file.size {
                return Err("源文件在复制期间增长，请重新扫描".into());
            }
            dst.file
                .write_all(&buf[..n])
                .map_err(|e| format!("写入目标文件失败: {e}"))?;
            event.overall_done = base + event.file_done;
            if last.elapsed() >= EMIT_INTERVAL {
                event.speed = ((event.file_done - anchor_bytes) as f64
                    / anchor.elapsed().as_secs_f64().max(0.001))
                    as u64;
                emit(event.clone());
                last = Instant::now();
                anchor = Instant::now();
                anchor_bytes = event.file_done;
            }
        }
        if !self.uploader.proceed() {
            return Ok(FileResult::Cancelled);
        }
        if event.file_done != stamp.len
            || SourceStamp::read(&src.metadata().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
                != stamp
            || SourceStamp::read(&fs::metadata(&file.path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
                != stamp
        {
            return Err("源文件在复制期间发生变化，请重新扫描".into());
        }
        validate_destination(root, &file.target_path)?;
        // Preserve timestamps on the staged inode before publication.
        dst.file
            .set_permissions(meta.permissions())
            .map_err(|e| format!("保留文件权限失败: {e}"))?;
        if let (Ok(atime), Ok(mtime)) = (meta.accessed(), meta.modified()) {
            let _ = filetime::set_file_handle_times(
                &dst.file,
                Some(filetime::FileTime::from_system_time(atime)),
                Some(filetime::FileTime::from_system_time(mtime)),
            );
        }
        dst.commit(&file.target_path, file.status == "overwrite")
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    "复制期间出现同名目标，原文件已保留；请重试校验；内容不同需明确选择覆盖，文件名保持不变"
                        .into()
                } else {
                    format!(
                        "提交目标文件失败 {}: {e}。请确认目标磁盘已连接且可写后重试",
                        file.target_path.display()
                    )
                }
            })?;
        Ok(FileResult::Copied)
    }

    fn compare_target(
        &self,
        file: &MediaFile,
        event: &mut ProgressPayload,
        emit: &mut impl FnMut(ProgressPayload),
    ) -> Result<Option<bool>, String> {
        let mut last = Instant::now();
        let result = files_equal_with_control(&file.path, &file.target_path, |done, _| {
            if !self.uploader.proceed() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Interrupted,
                    "已取消校验",
                ));
            }
            event.status = "verifying".into();
            event.file_done = done;
            event.speed = 0;
            if done == 0 || done == file.size || last.elapsed() >= EMIT_INTERVAL {
                emit(event.clone());
                last = Instant::now();
            }
            // Also honor cancellation requested by the progress callback.
            if !self.uploader.proceed() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Interrupted,
                    "已取消校验",
                ));
            }
            Ok(())
        });
        match result {
            Ok(equal) => Ok(Some(equal)),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => Ok(None),
            Err(e) => Err(format!(
                "校验已有目标失败 {}: {e}。请确认磁盘连接后重试",
                file.target_path.display()
            )),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{analyzer::Analyzer, scanner::Scanner, storage::tests::TestDir};
    fn fixture(dir: &TestDir) -> (Vec<MediaFile>, PathBuf) {
        let source = dir.0.join("source");
        let target = dir.0.join("target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("photo.JPG"), b"source").unwrap();
        let mut files = Scanner::with_mode("sd")
            .scan(source.to_str().unwrap(), true, true)
            .unwrap();
        Analyzer::analyze(&mut files, target.to_str().unwrap(), false).unwrap();
        (files, target)
    }
    #[test]
    fn retry_preserves_original_name_and_requires_explicit_overwrite_for_conflicts() {
        let dir = TestDir::new();
        let (mut files, target) = fixture(&dir);
        let dest = files[0].target_path.clone();
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let uploader = Arc::new(Uploader::new());
        for bytes in [b"partial".as_slice(), b"other!".as_slice()] {
            fs::write(&dest, bytes).unwrap();
            let out = uploader
                .start()
                .unwrap()
                .run(files.clone(), target.clone(), |_| {})
                .unwrap();
            assert_eq!(out.failed.len(), 1);
            assert!(out.failed[0].error.contains("文件名保持不变"));
            assert_eq!(out.completed, 0);
            assert_eq!(fs::read(&dest).unwrap(), bytes);
            assert_eq!(fs::read_dir(dest.parent().unwrap()).unwrap().count(), 1);
        }
        files[0].status = "overwrite".into();
        let out = uploader
            .start()
            .unwrap()
            .run(files.clone(), target.clone(), |_| {})
            .unwrap();
        assert_eq!(out.completed, 1);
        assert_eq!(fs::read(&dest).unwrap(), b"source");
        files[0].status = "upload".into();
        let mut events = Vec::new();
        let out = uploader
            .start()
            .unwrap()
            .run(files, target, |p| events.push(p))
            .unwrap();
        assert_eq!(out.skipped, 1);
        assert_eq!(out.completed, 0);
        assert!(events.iter().any(|p| p.status == "verifying"));
        assert_eq!(events.last().unwrap().overall_done, 6);
        assert_eq!(fs::read_dir(dest.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn renamed_targets_are_rejected_before_writing() {
        let dir = TestDir::new();
        let (mut files, target) = fixture(&dir);
        files[0].target_path = files[0].target_path.with_file_name("photo_1.JPG");
        let result = Arc::new(Uploader::new())
            .start()
            .unwrap()
            .run(files, target.clone(), |_| {});
        assert!(result.unwrap_err().contains("文件名必须与源文件名完全一致"));
        assert_eq!(fs::read_dir(target).unwrap().count(), 0);
    }

    #[test]
    fn cancellation_during_retry_comparison_preserves_existing_file() {
        let dir = TestDir::new();
        let (files, target) = fixture(&dir);
        let dest = files[0].target_path.clone();
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(&dest, b"source").unwrap();
        let uploader = Arc::new(Uploader::new());
        let out = uploader
            .start()
            .unwrap()
            .run(files, target, |p| {
                if p.status == "verifying" {
                    uploader.cancel();
                }
            })
            .unwrap();
        assert!(out.cancelled);
        assert_eq!(out.skipped, 0);
        assert_eq!(fs::read(&dest).unwrap(), b"source");
        assert_eq!(fs::read_dir(dest.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn cancellation_owns_the_worker_until_it_finishes() {
        let dir = TestDir::new();
        let (files, target) = fixture(&dir);
        let uploader = Arc::new(Uploader::new());
        let session = uploader.start().unwrap();
        uploader.pause();
        uploader.cancel();
        assert!(uploader.start().is_err());
        let out = session.run(files, target, |_| {}).unwrap();
        assert!(out.cancelled);
        assert_eq!(out.completed, 0);
        assert!(uploader.start().is_err());
        drop(session);
        assert!(uploader.start().is_ok());
    }

    #[test]
    fn cancellation_after_start_preserves_overwrite_target_and_cleans_staging() {
        let dir = TestDir::new();
        let (mut files, target) = fixture(&dir);
        let dest = files[0].target_path.clone();
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(&dest, b"original").unwrap();
        files[0].status = "overwrite".into();
        let uploader = Arc::new(Uploader::new());
        let outcome = uploader
            .start()
            .unwrap()
            .run(files, target, |event| {
                if event.status == "uploading" {
                    uploader.cancel();
                }
            })
            .unwrap();
        assert!(outcome.cancelled);
        assert!(outcome.failed.is_empty());
        assert_eq!(fs::read(&dest).unwrap(), b"original");
        assert_eq!(fs::read_dir(dest.parent().unwrap()).unwrap().count(), 1);
    }
    #[test]
    fn mutated_sources_and_out_of_root_destinations_are_rejected() {
        let dir = TestDir::new();
        let (mut files, target) = fixture(&dir);
        fs::write(&files[0].path, b"changed size").unwrap();
        let uploader = Arc::new(Uploader::new());
        let out = uploader
            .start()
            .unwrap()
            .run(files.clone(), target.clone(), |_| {})
            .unwrap();
        assert_eq!(out.failed.len(), 1);
        assert!(!files[0].target_path.exists());
        files[0].target_path = dir.0.join("elsewhere/photo.JPG");
        assert!(uploader
            .start()
            .unwrap()
            .run(files, target, |_| {})
            .is_err());
    }
    #[test]
    fn copies_content_then_verifies_skip_again() {
        let dir = TestDir::new();
        let (mut files, target) = fixture(&dir);
        let uploader = Arc::new(Uploader::new());
        let out = uploader
            .start()
            .unwrap()
            .run(files.clone(), target.clone(), |_| {})
            .unwrap();
        assert_eq!(out.completed, 1);
        assert_eq!(fs::read(&files[0].target_path).unwrap(), b"source");
        files[0].status = "skip".into();
        fs::write(&files[0].target_path, b"other!").unwrap();
        let out = uploader
            .start()
            .unwrap()
            .run(files, target, |_| {})
            .unwrap();
        assert_eq!(out.failed.len(), 1);
        assert_eq!(out.skipped, 0);
    }

    #[test]
    #[ignore = "requires MASCOPY_TEST_NAS_DIR; creates and cleans a private test directory"]
    fn nas_upload_roundtrip_and_cancellation() {
        let root = std::env::var_os("MASCOPY_TEST_NAS_DIR").expect("NAS test root required");
        let nas = TestDir::in_root(Path::new(&root));
        let local = TestDir::new();
        let bytes = vec![0x5a; 2 * BUFFER_SIZE + 17];
        fs::write(local.0.join("test.MP4"), &bytes).unwrap();
        let mut files = Scanner::with_mode("sd")
            .scan(local.0.to_str().unwrap(), true, true)
            .unwrap();
        Analyzer::analyze(&mut files, nas.0.to_str().unwrap(), false).unwrap();
        let uploader = Arc::new(Uploader::new());
        let outcome = uploader
            .start()
            .unwrap()
            .run(files.clone(), nas.0.clone(), |_| {})
            .unwrap();
        assert_eq!(outcome.completed, 1, "{:?}", outcome.failed);
        assert_eq!(fs::read(&files[0].target_path).unwrap(), bytes);
        // A stale scan must never overwrite a file that appeared in the meantime.
        let outcome = uploader
            .start()
            .unwrap()
            .run(files.clone(), nas.0.clone(), |_| {})
            .unwrap();
        assert!(outcome.failed.is_empty());
        assert_eq!(outcome.skipped, 1);
        assert_eq!(fs::read(&files[0].target_path).unwrap(), bytes);
        fs::write(&files[0].target_path, b"partial").unwrap();
        let conflict = uploader
            .start()
            .unwrap()
            .run(files.clone(), nas.0.clone(), |_| {})
            .unwrap();
        assert_eq!(conflict.failed.len(), 1);
        assert_eq!(fs::read(&files[0].target_path).unwrap(), b"partial");
        files[0].status = "overwrite".into();
        let recovered = uploader
            .start()
            .unwrap()
            .run(files.clone(), nas.0.clone(), |_| {})
            .unwrap();
        assert!(recovered.failed.is_empty(), "{:?}", recovered.failed);
        assert_eq!(recovered.completed, 1);
        assert_eq!(fs::read(&files[0].target_path).unwrap(), bytes);
        let cancelled = files[0].target_path.with_file_name("cancelled.MP4");
        files[0].target_path = cancelled.clone();
        files[0].path = local.0.join("cancelled.MP4");
        files[0].filename = "cancelled.MP4".into();
        files[0].modified = None;
        files[0].status = "upload".into();
        fs::write(&files[0].path, &bytes).unwrap();
        let outcome = uploader
            .start()
            .unwrap()
            .run(files, nas.0.clone(), |_| uploader.cancel())
            .unwrap();
        assert!(outcome.cancelled);
        assert!(!cancelled.exists());
        assert_eq!(
            fs::read_dir(cancelled.parent().unwrap()).unwrap().count(),
            1
        );
    }
}
