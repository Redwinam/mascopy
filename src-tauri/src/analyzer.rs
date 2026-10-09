use crate::{
    scanner::{MediaFile, ScanProgress},
    storage::files_equal_with_progress,
};
use chrono::{DateTime, Local};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};
pub struct Analyzer;
impl Analyzer {
    #[cfg(test)]
    pub fn analyze(
        files: &mut [MediaFile],
        target_dir: &str,
        overwrite_duplicates: bool,
    ) -> Result<(), String> {
        Self::analyze_with_progress(files, target_dir, overwrite_duplicates, true, |_| {})
    }

    pub fn analyze_with_progress(
        files: &mut [MediaFile],
        target_dir: &str,
        overwrite_duplicates: bool,
        verify_duplicates: bool,
        mut emit: impl FnMut(ScanProgress),
    ) -> Result<(), String> {
        let target_root = Path::new(target_dir)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let mut used: HashMap<String, HashSet<String>> = HashMap::new();
        let mut checked_directories = HashSet::new();
        files.sort_by(|a, b| {
            a.date
                .cmp(&b.date)
                .then(a.filename.cmp(&b.filename))
                .then(a.path.cmp(&b.path))
        });
        let total = files.len();
        for (index, file) in files.iter_mut().enumerate() {
            let mut progress = ScanProgress {
                phase: "analyze",
                filename: file.filename.clone(),
                current: index + 1,
                total,
                ..Default::default()
            };
            emit(progress.clone());
            let date: DateTime<Local> = file.date.into();
            let day = date.format("%Y-%m-%d").to_string();
            let directory = target_root.join(&day);
            if checked_directories.insert(directory.clone())
                && directory.exists()
                && !directory
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(&target_root)
            {
                return Err("日期目录指向目标目录外部，请重新选择目标".into());
            }
            let names = used.entry(day).or_default();
            let name = &file.filename;
            if file.path.file_name().and_then(|n| n.to_str()) != Some(name.as_str()) {
                return Err("源文件名不一致，请重新扫描".into());
            }
            if !names.insert(name.to_lowercase()) {
                return Err(format!(
                    "同一日期下有多个同名源文件：{name}。文件名不能更改，请分别选择来源或目标目录"
                ));
            }
            let candidate = directory.join(name);
            file.status = match std::fs::symlink_metadata(&candidate) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => "upload",
                Err(e) => return Err(format!("无法检查目标 {}: {e}", candidate.display())),
                Ok(meta) => {
                    if meta.is_file()
                        && meta.len() == file.size
                        && (!verify_duplicates
                            || files_equal_with_progress(&file.path, &candidate, |done, total| {
                                progress.phase = "compare";
                                progress.bytes_done = done;
                                progress.bytes_total = total;
                                emit(progress.clone());
                            })
                            .map_err(|e| format!("比较文件失败 {}: {e}", candidate.display()))?)
                    {
                        "skip"
                    } else if meta.is_file() && overwrite_duplicates {
                        "overwrite"
                    } else {
                        "conflict"
                    }
                }
            }
            .into();
            file.target_path = candidate;
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::tests::TestDir;
    #[test]
    fn quick_duplicates_use_metadata_and_full_verification_remains_opt_in() {
        let dir = TestDir::new();
        let source = dir.0.join("source");
        let target = dir.0.join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        let original = source.join("movie.MP4");
        std::fs::write(&original, b"AAAA").unwrap();
        let mut files = crate::scanner::Scanner::with_mode("sd")
            .scan(source.to_str().unwrap(), true, true)
            .unwrap();
        let day = DateTime::<Local>::from(files[0].date)
            .format("%Y-%m-%d")
            .to_string();
        let existing = target.join(day).join("movie.MP4");
        std::fs::create_dir_all(existing.parent().unwrap()).unwrap();
        std::fs::write(&existing, b"BBBB").unwrap();
        assert_fast_skip(&mut files, &target);
        Analyzer::analyze_with_progress(&mut files, target.to_str().unwrap(), false, true, |_| {})
            .unwrap();
        assert_eq!(files[0].status, "conflict");
        assert_eq!(files[0].target_path.file_name().unwrap(), "movie.MP4");
        // Fast analysis must not open either media file: only the scanned size and
        // target metadata are needed, even if the source becomes unavailable.
        std::fs::remove_file(&original).unwrap();
        assert_fast_skip(&mut files, &target);
        std::fs::write(&existing, b"different length").unwrap();
        Analyzer::analyze_with_progress(&mut files, target.to_str().unwrap(), false, false, |_| {})
            .unwrap();
        assert_eq!(files[0].status, "conflict");
        Analyzer::analyze_with_progress(&mut files, target.to_str().unwrap(), true, false, |_| {})
            .unwrap();
        assert_eq!(files[0].status, "overwrite");
    }

    fn assert_fast_skip(files: &mut [MediaFile], target: &Path) {
        Analyzer::analyze_with_progress(
            files,
            target.to_str().unwrap(),
            false,
            false,
            |progress| {
                assert_ne!(progress.phase, "compare");
            },
        )
        .unwrap();
        assert_eq!(files[0].status, "skip");
    }

    #[test]
    #[ignore = "read-only timing check; requires MASCOPY_TEST_SCAN_SOURCE and MASCOPY_TEST_SCAN_TARGET"]
    fn mounted_fast_scan_timing() {
        let source = std::env::var("MASCOPY_TEST_SCAN_SOURCE").expect("scan source required");
        let target = std::env::var("MASCOPY_TEST_SCAN_TARGET").expect("scan target required");
        let start = std::time::Instant::now();
        let mut files = crate::scanner::Scanner::with_mode("sd")
            .scan(&source, true, true)
            .unwrap();
        Analyzer::analyze_with_progress(&mut files, &target, false, false, |progress| {
            assert_ne!(progress.phase, "compare");
        })
        .unwrap();
        assert!(!files.is_empty());
        println!(
            "快速扫描：{} 个文件，{} 个同名同大小跳过，用时 {:.3} 秒",
            files.len(),
            files.iter().filter(|f| f.status == "skip").count(),
            start.elapsed().as_secs_f64()
        );
    }
    #[test]
    fn same_day_source_name_collisions_never_get_renamed_or_overwritten() {
        let dir = TestDir::new();
        let source = dir.0.join("source");
        let target = dir.0.join("target");
        std::fs::create_dir_all(source.join("a")).unwrap();
        std::fs::create_dir_all(source.join("b")).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join("a/same.JPG"), b"AAAA").unwrap();
        std::fs::write(source.join("b/same.JPG"), b"BBBB").unwrap();
        let mut files = crate::scanner::Scanner::with_mode("sd")
            .scan(source.to_str().unwrap(), true, true)
            .unwrap();
        files[1].date = files[0].date;
        for overwrite in [false, true] {
            let error =
                Analyzer::analyze(&mut files, target.to_str().unwrap(), overwrite).unwrap_err();
            assert!(error.contains("文件名不能更改"));
        }
        assert_eq!(std::fs::read_dir(target).unwrap().count(), 0);
    }
}
