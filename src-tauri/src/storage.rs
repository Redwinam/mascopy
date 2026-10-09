//! Atomic publication where supported, with exclusive media creation for SMB mounts.
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// 强退或断电时 Drop 来不及跑，暂存文件会留在目标目录里。写入中的暂存文件
/// 每次写都会刷新修改时间，所以只清理别的进程留下、且一小时没动过的。
const STALE_STAGE_AGE: Duration = Duration::from_secs(60 * 60);

fn is_foreign_stage_name(name: &str) -> bool {
    let Some(rest) = name
        .strip_prefix(".mascopy-")
        .and_then(|rest| rest.strip_suffix(".part"))
    else {
        return false;
    };
    let Some((pid, seq)) = rest.split_once('-') else {
        return false;
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    digits(pid) && digits(seq) && pid.parse::<u32>().ok() != Some(std::process::id())
}

/// 每个目录每次运行只扫一遍，失败一律忽略：清理遗留文件不能影响这次拷贝。
fn sweep_stale_stages(dir: &Path) {
    static SWEPT: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    let first_visit = SWEPT
        .get_or_init(Default::default)
        .lock()
        .map(|mut swept| swept.insert(dir.to_path_buf()))
        .unwrap_or(false);
    if !first_visit {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        if !is_foreign_stage_name(&entry.file_name().to_string_lossy()) {
            continue;
        }
        // DirEntry::metadata 不跟随符号链接，只删普通文件
        let Ok(meta) = entry.metadata() else { continue };
        let stale = meta.is_file()
            && meta
                .modified()
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age >= STALE_STAGE_AGE);
        if stale {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct SourceStamp {
    pub len: u64,
    modified: SystemTime,
    #[cfg(unix)]
    identity: (u64, u64),
}

impl SourceStamp {
    pub fn read(meta: &Metadata) -> io::Result<Self> {
        if !meta.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "源不是普通文件",
            ));
        }
        Ok(Self {
            len: meta.len(),
            modified: meta.modified()?,
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                (meta.dev(), meta.ino())
            },
        })
    }
}

pub fn files_equal(a: &Path, b: &Path) -> io::Result<bool> {
    files_equal_with_progress(a, b, |_, _| {})
}

pub fn files_equal_with_progress(
    a: &Path,
    b: &Path,
    mut progress: impl FnMut(u64, u64),
) -> io::Result<bool> {
    files_equal_with_control(a, b, |done, total| {
        progress(done, total);
        Ok(())
    })
}

/// The caller can pause/cancel long comparisons without accepting a partial check.
pub fn files_equal_with_control(
    a: &Path,
    b: &Path,
    mut progress: impl FnMut(u64, u64) -> io::Result<()>,
) -> io::Result<bool> {
    let mut left = File::open(a)?;
    let mut right = File::open(b)?;
    let left_stamp = SourceStamp::read(&left.metadata()?)?;
    let right_stamp = SourceStamp::read(&right.metadata()?)?;
    if left_stamp.len != right_stamp.len {
        return Ok(false);
    }
    let mut remaining = left_stamp.len;
    progress(0, left_stamp.len)?;
    let mut l = vec![0; 1024 * 1024];
    let mut r = vec![0; l.len()];
    while remaining > 0 {
        let count = remaining.min(l.len() as u64) as usize;
        left.read_exact(&mut l[..count])?;
        right.read_exact(&mut r[..count])?;
        if l[..count] != r[..count] {
            return Ok(false);
        }
        remaining -= count as u64;
        progress(left_stamp.len - remaining, left_stamp.len)?;
    }
    if SourceStamp::read(&left.metadata()?)? != left_stamp
        || SourceStamp::read(&right.metadata()?)? != right_stamp
        || SourceStamp::read(&fs::metadata(a)?)? != left_stamp
        || SourceStamp::read(&fs::metadata(b)?)? != right_stamp
    {
        return Err(io::Error::other("比较期间文件发生变化，请重新扫描"));
    }
    Ok(true)
}

pub struct StagedFile {
    pub file: File,
    path: PathBuf,
    direct: bool,
    committed: bool,
}

impl StagedFile {
    pub fn new(destination: &Path) -> io::Result<Self> {
        let parent = destination
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "目标没有父目录"))?;
        sweep_stale_stages(parent);
        for _ in 0..128 {
            let path = parent.join(format!(
                ".mascopy-{}-{}.part",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            let mut opts = OpenOptions::new();
            opts.write(true).read(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            match opts.open(&path) {
                Ok(file) => {
                    return Ok(Self {
                        file,
                        path,
                        direct: false,
                        committed: false,
                    })
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "无法创建独占临时文件",
        ))
    }

    /// Some SMB mounts support neither exclusive rename nor hard links. Probe with
    /// an empty private file before copying media, then use O_EXCL on those mounts.
    /// This preserves existing files and avoids copying large videos twice over SMB.
    /// Direct destinations are visible while copying; a killed process may leave a
    /// partial file, which must never be treated as a duplicate without a byte check.
    pub fn for_media(destination: &Path, overwrite: bool) -> io::Result<Self> {
        Self::for_media_with_publisher(destination, overwrite, publish_new)
    }

    fn for_media_with_publisher(
        destination: &Path,
        overwrite: bool,
        publish: impl FnOnce(&Path, &Path) -> io::Result<()>,
    ) -> io::Result<Self> {
        static SUPPORT: OnceLock<Mutex<HashMap<PathBuf, bool>>> = OnceLock::new();
        let mut stage = Self::new(destination)?;
        if overwrite {
            return Ok(stage);
        }
        let parent = destination.parent().unwrap();
        let cache = SUPPORT.get_or_init(Default::default);
        let cached = cache.lock().ok().and_then(|m| m.get(parent).copied());
        let supported = if let Some(value) = cached {
            value
        } else {
            let probe = Self::new(destination)?;
            let probe_path = probe.path.clone();
            drop(probe);
            let supported = match publish(&stage.path, &probe_path) {
                Ok(()) => {
                    stage.path = probe_path;
                    true
                }
                Err(e)
                    if e.kind() == io::ErrorKind::Unsupported
                        || cfg!(target_os = "macos")
                            && matches!(e.raw_os_error(), Some(45 | 102)) =>
                {
                    false
                }
                Err(e) => return Err(e),
            };
            if let Ok(mut map) = cache.lock() {
                map.insert(parent.to_path_buf(), supported);
            }
            if !supported {
                log::warn!(
                    "目标不支持独占重命名，使用独占创建方式复制媒体: {}",
                    parent.display()
                );
            }
            supported
        };
        if supported {
            return Ok(stage);
        }
        drop(stage);
        let mut opts = OpenOptions::new();
        opts.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        Ok(Self {
            file: opts.open(destination)?,
            path: destination.to_path_buf(),
            direct: true,
            committed: false,
        })
    }

    pub fn commit(mut self, destination: &Path, overwrite: bool) -> io::Result<()> {
        self.file.sync_all()?;
        if self.direct {
            if self.path != destination || !self.owns_path() {
                return Err(io::Error::other("复制期间目标文件被替换，请重新扫描"));
            }
        } else if overwrite {
            fs::rename(&self.path, destination)?;
        } else {
            publish_new(&self.path, destination)?;
        }
        self.committed = true;
        Ok(())
    }

    fn owns_path(&self) -> bool {
        let Ok(path_meta) = fs::symlink_metadata(&self.path) else {
            return false;
        };
        let Ok(file_meta) = self.file.metadata() else {
            return false;
        };
        if !path_meta.is_file() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            (path_meta.dev(), path_meta.ino()) == (file_meta.dev(), file_meta.ino())
        }
        #[cfg(not(unix))]
        {
            // The compatibility path is only needed for macOS SMB mounts. Do not
            // remove a destination when its identity cannot be proven.
            false
        }
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        if self.committed || self.direct && !self.owns_path() {
            return;
        }
        // Unix allows unlinking an open file; Windows cleanup is retried after close below.
        if let Err(error) = fs::remove_file(&self.path) {
            #[cfg(windows)]
            if let Ok(replacement) = File::open("NUL") {
                let file = std::mem::replace(&mut self.file, replacement);
                drop(file);
                if fs::remove_file(&self.path).is_ok() {
                    return;
                }
            }
            log::warn!(
                "未完成文件清理失败，请检查占用并按原文件名处理 {}: {}",
                self.path.display(),
                error
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn publish_new(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    unsafe extern "C" {
        fn renamex_np(
            from: *const std::ffi::c_char,
            to: *const std::ffi::c_char,
            flags: u32,
        ) -> i32;
    }
    let from = CString::new(source.as_os_str().as_bytes())?;
    let to = CString::new(destination.as_os_str().as_bytes())?;
    // Darwin stdio.h: RENAME_EXCL = 0x00000004, atomic fail if destination exists.
    // Both C strings remain alive for the call and contain no embedded NUL.
    let result = unsafe { renamex_np(from.as_ptr(), to.as_ptr(), 0x00000004) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn publish_new(source: &Path, destination: &Path) -> io::Result<()> {
    // A link publishes the complete inode without replacing an existing destination.
    // Unsupported filesystems return an error instead of risking an overwrite.
    fs::hard_link(source, destination)?;
    fs::remove_file(source)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    pub struct TestDir(pub PathBuf);
    impl TestDir {
        pub fn new() -> Self {
            Self::in_root(&std::env::temp_dir())
        }
        pub fn in_root(root: &Path) -> Self {
            let path = root.join(format!(
                "mascopy-test-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn equality_checks_bytes_not_just_size() {
        let dir = TestDir::new();
        let a = dir.0.join("a");
        let b = dir.0.join("b");
        fs::write(&a, b"aaaa").unwrap();
        fs::write(&b, b"bbbb").unwrap();
        assert!(!files_equal(&a, &b).unwrap());
        fs::write(&b, b"aaaa").unwrap();
        assert!(files_equal(&a, &b).unwrap());
    }
    #[test]
    fn publication_never_clobbers_unless_authorized() {
        let dir = TestDir::new();
        let dest = dir.0.join("photo.jpg");
        fs::write(&dest, b"old").unwrap();
        fs::write(dir.0.join("photo.jpg.part"), b"unrelated").unwrap();
        let mut stage = StagedFile::new(&dest).unwrap();
        stage.file.write_all(b"new").unwrap();
        assert!(stage.commit(&dest, false).is_err());
        assert_eq!(fs::read(&dest).unwrap(), b"old");
        assert_eq!(
            fs::read(dir.0.join("photo.jpg.part")).unwrap(),
            b"unrelated"
        );
        let mut stage = StagedFile::new(&dest).unwrap();
        stage.file.write_all(b"new").unwrap();
        stage.commit(&dest, true).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"new");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 2);
    }
    #[test]
    fn stale_stages_from_crashed_runs_are_swept_once() {
        let dir = TestDir::new();
        let old = SystemTime::now() - STALE_STAGE_AGE - Duration::from_secs(60);
        let crashed = dir.0.join(".mascopy-1-7.part");
        let active = dir.0.join(".mascopy-2-0.part");
        let unrelated = dir.0.join(".mascopy-notes.part");
        for path in [&crashed, &active, &unrelated] {
            fs::write(path, b"x").unwrap();
        }
        for path in [&crashed, &unrelated] {
            filetime::set_file_mtime(path, filetime::FileTime::from_system_time(old)).unwrap();
        }
        drop(StagedFile::new(&dir.0.join("photo.jpg")).unwrap());
        assert!(!crashed.exists());
        assert!(active.exists());
        assert!(unrelated.exists());
        assert!(!is_foreign_stage_name(&format!(
            ".mascopy-{}-0.part",
            std::process::id()
        )));
    }
    #[test]
    fn abandoned_staging_file_is_removed() {
        let dir = TestDir::new();
        let dest = dir.0.join("photo");
        drop(StagedFile::new(&dest).unwrap());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }

    fn unsupported(_: &Path, _: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "NAS does not support exclusive rename",
        ))
    }

    #[test]
    fn nas_fallback_copies_without_overwrite_and_probes_only_once() {
        let dir = TestDir::new();
        let dest = dir.0.join("movie.mp4");
        let mut output = StagedFile::for_media_with_publisher(&dest, false, unsupported).unwrap();
        assert!(output.direct);
        output.file.write_all(b"complete movie").unwrap();
        output.commit(&dest, false).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"complete movie");
        let error = StagedFile::for_media_with_publisher(&dest, false, |_, _| panic!("cached"))
            .err()
            .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&dest).unwrap(), b"complete movie");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn nas_fallback_removes_cancelled_partial_but_preserves_replacement() {
        let dir = TestDir::new();
        let dest = dir.0.join("movie.mp4");
        let mut output = StagedFile::for_media_with_publisher(&dest, false, unsupported).unwrap();
        output.file.write_all(b"partial").unwrap();
        drop(output);
        assert!(!dest.exists());
        let mut output = StagedFile::for_media_with_publisher(&dest, false, unsupported).unwrap();
        output.file.write_all(b"partial").unwrap();
        fs::rename(&dest, dir.0.join("moved")).unwrap();
        fs::write(&dest, b"another writer").unwrap();
        assert!(output.commit(&dest, false).is_err());
        assert_eq!(fs::read(&dest).unwrap(), b"another writer");
    }

    #[test]
    fn publication_permission_errors_do_not_enable_fallback() {
        let dir = TestDir::new();
        let dest = dir.0.join("movie.mp4");
        let error = StagedFile::for_media_with_publisher(&dest, false, |_, _| {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"))
        })
        .err()
        .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(!dest.exists());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }

    #[test]
    fn comparison_reports_byte_progress_without_weakening_equality() {
        let dir = TestDir::new();
        let a = dir.0.join("a");
        let b = dir.0.join("b");
        let data = vec![7; 2 * 1024 * 1024 + 10];
        fs::write(&a, &data).unwrap();
        fs::write(&b, &data).unwrap();
        let mut progress = Vec::new();
        assert!(
            files_equal_with_progress(&a, &b, |done, total| progress.push((done, total))).unwrap()
        );
        assert_eq!(progress.first(), Some(&(0, data.len() as u64)));
        assert_eq!(
            progress.last(),
            Some(&(data.len() as u64, data.len() as u64))
        );
        assert!(progress.len() > 2);
        let mut different = data;
        *different.last_mut().unwrap() = 8;
        fs::write(&b, different).unwrap();
        assert!(!files_equal(&a, &b).unwrap());
    }
}
