
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Window};
use crate::scanner::MediaFile;

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    current: usize,
    total: usize,
    filename: String,
    status: String,
}

pub struct Uploader {
    is_paused: Arc<Mutex<bool>>,
    should_cancel: Arc<Mutex<bool>>,
}

impl Uploader {
    pub fn new() -> Self {
        Self {
            is_paused: Arc::new(Mutex::new(false)),
            should_cancel: Arc::new(Mutex::new(false)),
        }
    }

    pub fn pause(&self) {
        if let Ok(mut paused) = self.is_paused.lock() {
            *paused = true;
        }
    }

    pub fn resume(&self) {
        if let Ok(mut paused) = self.is_paused.lock() {
            *paused = false;
        }
    }

    pub fn cancel(&self) {
        if let Ok(mut cancel) = self.should_cancel.lock() {
            *cancel = true;
        }
    }

    pub fn reset(&self) {
        if let Ok(mut paused) = self.is_paused.lock() {
            *paused = false;
        }
        if let Ok(mut cancel) = self.should_cancel.lock() {
            *cancel = false;
        }
    }

    pub async fn upload_files(&self, files: Vec<MediaFile>, window: Window) -> Result<(), String> {
        let total = files.len();
        
        for (i, file) in files.iter().enumerate() {
            // Check cancellation
            if *self.should_cancel.lock().unwrap() {
                break;
            }

            // Check pause
            loop {
                if *self.should_cancel.lock().unwrap() {
                    break;
                }
                if !*self.is_paused.lock().unwrap() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }

            if file.status == "upload" || file.status == "overwrite" {
                // Ensure target dir exists
                if let Some(parent) = file.target_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }

                // Copy file
                // We use std::fs::copy for simplicity. For large files, we might want async copy with progress,
                // but for now let's stick to simple copy to keep it robust.
                // To show progress within a file, we'd need a custom copy loop.
                // Given the requirement "make it simple", file-level progress is often enough.
                
                window.emit("upload-progress", ProgressPayload {
                    current: i + 1,
                    total,
                    filename: file.filename.clone(),
                    status: "uploading".to_string(),
                }).unwrap_or_default();

                match std::fs::copy(&file.path, &file.target_path) {
                    Ok(_) => {
                         // Try to preserve timestamps
                        if let Ok(metadata) = std::fs::metadata(&file.path) {
                            if let (Ok(atime), Ok(mtime)) = (metadata.accessed(), metadata.modified()) {
                                let _ = filetime::set_file_times(&file.target_path, filetime::FileTime::from_system_time(atime), filetime::FileTime::from_system_time(mtime));
                            }
                        }
                    },
                    Err(e) => {
                        window.emit("upload-error", format!("Failed to copy {}: {}", file.filename, e)).unwrap_or_default();
                    }
                }
            } else {
                 window.emit("upload-progress", ProgressPayload {
                    current: i + 1,
                    total,
                    filename: file.filename.clone(),
                    status: "skipped".to_string(),
                }).unwrap_or_default();
            }
        }

        Ok(())
    }
}
