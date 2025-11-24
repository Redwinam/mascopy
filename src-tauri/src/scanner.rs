use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use walkdir::WalkDir;
use std::time::SystemTime;
use crate::metadata::MetadataExtractor;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaFile {
    pub path: PathBuf,
    pub filename: String,
    pub size: u64,
    pub date: SystemTime,
    pub file_type: String,
    pub status: String, // "pending", "upload", "overwrite", "skip"
    pub target_path: PathBuf,
}

pub struct Scanner {
    supported_extensions: Vec<String>,
}

impl Scanner {
    pub fn with_mode(mode: &str) -> Self {
        let (photo_exts, video_exts) = match mode {
            "dji" => (
                vec!["jpg".to_string(), "jpeg".to_string(), "lrf".to_string()],
                vec!["osv".to_string(), "mp4".to_string(), "mov".to_string()],
            ),
            _ => (
                vec![
                    "jpg".to_string(), "jpeg".to_string(), "png".to_string(), 
                    "heic".to_string(), "nef".to_string(), "cr2".to_string(), 
                    "arw".to_string(), "dng".to_string(), "cr3".to_string()
                ],
                vec![
                    "mp4".to_string(), "mov".to_string(), "avi".to_string(), 
                    "m4v".to_string(), "3gp".to_string(), "mkv".to_string()
                ],
            ),
        };

        let mut supported = photo_exts.clone();
        supported.extend(video_exts.clone());

        Self {
            supported_extensions: supported,
        }
    }

    pub fn scan(&self, source_dir: &str, fast_mode: bool) -> Vec<MediaFile> {
        let mut files = Vec::new();

        for entry in WalkDir::new(source_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if let Some(ext_str) = ext.to_str() {
                        if self.supported_extensions.contains(&ext_str.to_lowercase()) {
                            let metadata = std::fs::metadata(path).ok();
                            let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                            let date = if fast_mode {
                                metadata.and_then(|m| m.modified().ok()).unwrap_or_else(SystemTime::now)
                            } else {
                                MetadataExtractor::get_date(path)
                            };
                            
                            let file_type = if ["jpg", "jpeg", "png", "heic", "nef", "cr2", "arw", "dng", "cr3"]
                                .contains(&ext_str.to_lowercase().as_str()) {
                                "photo".to_string()
                            } else {
                                "video".to_string()
                            };

                            files.push(MediaFile {
                                path: path.to_path_buf(),
                                filename: path.file_name().unwrap().to_string_lossy().to_string(),
                                size,
                                date,
                                file_type,
                                status: "pending".to_string(),
                                target_path: PathBuf::new(),
                            });
                        }
                    }
                }
            }
        }
        files
    }
}
