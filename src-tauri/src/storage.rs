//! Shared, fail-closed publication of complete media and configuration files.
use std::collections::HashSet;
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
    let mut left = File::open(a)?;
    let mut right = File::open(b)?;
    let left_stamp = SourceStamp::read(&left.metadata()?)?;
    let right_stamp = SourceStamp::read(&right.metadata()?)?;
    if left_stamp.len != right_stamp.len {
        return Ok(false);
    }
    let mut remaining = left_stamp.len;
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

pub fn unique_name(original: &str, attempt: usize) -> String {
    let path = Path::new(original);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    match path.extension().filter(|ext| !ext.is_empty()) {
        Some(ext) => format!("{stem}_{attempt}.{}", ext.to_string_lossy()),
        None => format!("{stem}_{attempt}"),
    }
}

pub struct StagedFile {
    pub file: File,
    path: PathBuf,
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
                Ok(file) => return Ok(Self { file, path }),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "无法创建独占临时文件",
        ))
    }

    pub fn commit(self, destination: &Path, overwrite: bool) -> io::Result<()> {
        self.file.sync_all()?;
        if overwrite {
            fs::rename(&self.path, destination)?;
        } else {
            publish_new(&self.path, destination)?;
        }
        Ok(())
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        // Unix allows unlinking an open file; Windows cleanup is retried after close below.
        if fs::remove_file(&self.path).is_err() {
            #[cfg(windows)]
            if let Ok(replacement) = File::open("NUL") {
                let file = std::mem::replace(&mut self.file, replacement);
                drop(file);
                let _ = fs::remove_file(&self.path);
            }
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
            let path = std::env::temp_dir().join(format!(
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
}
