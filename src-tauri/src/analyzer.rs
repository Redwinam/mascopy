use crate::{
    scanner::{MediaFile, ScanProgress},
    storage::{files_equal_with_progress, unique_name},
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
        Self::analyze_with_progress(files, target_dir, overwrite_duplicates, |_| {})
    }

    pub fn analyze_with_progress(
        files: &mut [MediaFile],
        target_dir: &str,
        overwrite_duplicates: bool,
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
            let mut attempt = 0;
            loop {
                let name = if attempt == 0 {
                    file.filename.clone()
                } else {
                    unique_name(&file.filename, attempt)
                };
                let identity = name.to_lowercase();
                if names.contains(&identity) {
                    attempt += 1;
                    continue;
                }
                let candidate = directory.join(&name);
                match std::fs::symlink_metadata(&candidate) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        file.status = "upload".into();
                    }
                    Err(e) => return Err(format!("无法检查目标 {}: {e}", candidate.display())),
                    Ok(meta) => {
                        if meta.is_file()
                            && files_equal_with_progress(&file.path, &candidate, |done, total| {
                                progress.phase = "compare";
                                progress.bytes_done = done;
                                progress.bytes_total = total;
                                emit(progress.clone());
                            })
                            .map_err(|e| format!("比较文件失败 {}: {e}", candidate.display()))?
                        {
                            file.status = "skip".into();
                        } else if meta.is_file() && overwrite_duplicates && attempt == 0 {
                            file.status = "overwrite".into();
                        } else {
                            attempt += 1;
                            continue;
                        }
                    }
                }
                file.target_path = candidate;
                names.insert(identity);
                break;
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::tests::TestDir;
    #[test]
    fn equal_length_different_data_and_batch_overwrites_are_preserved() {
        let dir = TestDir::new();
        let source = dir.0.join("source");
        let target = dir.0.join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join("a.JPG"), b"AAAA").unwrap();
        std::fs::write(source.join("b.JPG"), b"BBBB").unwrap();
        let mut files = crate::scanner::Scanner::with_mode("sd")
            .scan(source.to_str().unwrap(), true, true)
            .unwrap();
        let date = files[0].date;
        for f in &mut files {
            f.filename = "same.JPG".into();
            f.date = date;
        }
        let day = DateTime::<Local>::from(date).format("%Y-%m-%d").to_string();
        std::fs::create_dir_all(target.join(&day)).unwrap();
        let existing = target.join(day).join("same.JPG");
        std::fs::write(&existing, b"CCCC").unwrap();
        Analyzer::analyze(&mut files, target.to_str().unwrap(), false).unwrap();
        assert!(files.iter().all(|f| f.status == "upload"));
        assert_ne!(files[0].target_path, files[1].target_path);
        Analyzer::analyze(&mut files, target.to_str().unwrap(), true).unwrap();
        assert_eq!(files[0].status, "overwrite");
        assert_eq!(files[1].status, "upload");
        assert_ne!(files[0].target_path, files[1].target_path);
        std::fs::copy(&files[0].path, &existing).unwrap();
        Analyzer::analyze(&mut files, target.to_str().unwrap(), false).unwrap();
        assert_eq!(files[0].status, "skip");
    }
}
