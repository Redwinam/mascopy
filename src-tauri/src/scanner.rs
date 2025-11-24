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
    pub fn new() -> Self {
        Self {
            supported_extensions: vec![
                // Photos
                "jpg".to_string(), "jpeg".to_string(), "png".to_string(), 
                "heic".to_string(), "nef".to_string(), "cr2".to_string(), 
                "arw".to_string(), "dng".to_string(), "cr3".to_string(),
                // Videos
                "mp4".to_string(), "mov".to_string(), "avi".to_string(), 
                "m4v".to_string(), "3gp".to_string(), "mkv".to_string(),
            ],
        }
    }

    pub fn scan(&self, source_dir: &str) -> Vec<MediaFile> {
        let mut files = Vec::new();

        for entry in WalkDir::new(source_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if let Some(ext_str) = ext.to_str() {
                        if self.supported_extensions.contains(&ext_str.to_lowercase()) {
                            let metadata = std::fs::metadata(path).ok();
                            let size = metadata.map(|m| m.len()).unwrap_or(0);
                            let date = MetadataExtractor::get_date(path);
                            
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
