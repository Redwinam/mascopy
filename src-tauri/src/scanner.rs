use crate::{media, metadata::MetadataExtractor};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaFile {
    pub path: PathBuf,
    pub filename: String,
    pub size: u64,
    pub date: SystemTime,
    #[serde(default)]
    pub modified: Option<SystemTime>,
    pub file_type: String,
    pub status: String,
    pub target_path: PathBuf,
}

pub struct Scanner {
    mode: String,
}
impl Scanner {
    pub fn with_mode(mode: &str) -> Self {
        Self {
            mode: mode.to_string(),
        }
    }
    pub fn scan(
        &self,
        source_dir: &str,
        fast_mode: bool,
        ignore_thumbnails: bool,
    ) -> Result<Vec<MediaFile>, String> {
        let root = Path::new(source_dir);
        let mut files = Vec::new();
        let entries = WalkDir::new(root).into_iter().filter_entry(|entry| {
            if entry.path() == root {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !(name.starts_with('.')
                || ignore_thumbnails && entry.file_type().is_dir() && is_thumbnail_dir_name(&name))
        });
        for entry in entries {
            let entry = entry.map_err(|e| format!("无法完整扫描目录: {e}"))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let Some(kind) = media::classify(path, &self.mode) else {
                continue;
            };
            let meta = std::fs::metadata(path)
                .map_err(|e| format!("读取文件信息失败 {}: {e}", path.display()))?;
            let modified = meta
                .modified()
                .map_err(|e| format!("读取文件时间失败 {}: {e}", path.display()))?;
            files.push(MediaFile {
                path: path.to_path_buf(),
                filename: entry.file_name().to_string_lossy().into_owned(),
                size: meta.len(),
                date: if fast_mode {
                    modified
                } else {
                    MetadataExtractor::get_date(path)
                },
                modified: Some(modified),
                file_type: kind.into(),
                status: "pending".into(),
                target_path: PathBuf::new(),
            });
        }
        Ok(files)
    }
}
fn is_thumbnail_dir_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper == "THM" || upper.contains("THUMB") || upper.contains("THMBNL")
}
pub fn validate_roots(source: &Path, target: &Path) -> Result<(PathBuf, PathBuf), String> {
    if !source.is_dir() {
        return Err("源路径不存在或不是目录".into());
    }
    if !target.is_dir() {
        return Err("目标路径不存在或不是目录".into());
    }
    let source = source
        .canonicalize()
        .map_err(|e| format!("源路径无法读取: {e}"))?;
    let target = target
        .canonicalize()
        .map_err(|e| format!("目标路径无法读取: {e}"))?;
    if source.starts_with(&target) || target.starts_with(&source) {
        return Err("源目录与目标目录必须分离，不能相同或互相包含".into());
    }
    Ok((source, target))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::tests::TestDir;
    #[test]
    fn source_ancestor_name_does_not_filter_all_photos() {
        let dir = TestDir::new();
        let root = dir.0.join("my-thumbnails-source");
        std::fs::create_dir_all(root.join("DCIM/THMBNL")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        for file in [
            "a.JPG",
            "DCIM/THMBNL/small.JPG",
            ".hidden/private.JPG",
            "._a.JPG",
        ] {
            std::fs::write(root.join(file), b"a").unwrap();
        }
        let scanner = Scanner::with_mode("sd");
        assert_eq!(
            scanner
                .scan(root.to_str().unwrap(), true, true)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            scanner
                .scan(root.to_str().unwrap(), true, false)
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn traversal_failure_is_not_an_empty_success() {
        let dir = TestDir::new();
        assert!(Scanner::with_mode("sd")
            .scan(dir.0.join("missing").to_str().unwrap(), true, true)
            .is_err());
    }
    #[test]
    fn nested_and_symlink_aliased_roots_are_rejected() {
        let dir = TestDir::new();
        let source = dir.0.join("source");
        let target = source.join("backup");
        std::fs::create_dir_all(&target).unwrap();
        assert!(validate_roots(&source, &target).is_err());
        assert!(validate_roots(&source, &source).is_err());
        #[cfg(unix)]
        {
            let alias = dir.0.join("alias");
            std::os::unix::fs::symlink(&target, &alias).unwrap();
            assert!(validate_roots(&source, &alias).is_err());
        }
    }
}
