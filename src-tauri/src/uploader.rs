
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Window};
use crate::scanner::MediaFile;

const BUFFER_SIZE: usize = 1024 * 1024; // 1 MiB read/write chunks
const EMIT_INTERVAL: Duration = Duration::from_millis(120); // throttle progress events

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    // 当前文件序号（1-based）与文件总数
    current: usize,
    total: usize,
    // 当前文件信息
    filename: String,
    path: String,
    status: String, // "uploading" | "done" | "skipped" | "error"
    // 单文件字节进度
    file_done: u64,
    file_total: u64,
    // 整体字节进度
    overall_done: u64,
    overall_total: u64,
    // 整体传输速度（字节/秒，瞬时平滑值），跳过时为 0
    speed: u64,
}

enum CopyOutcome {
    Completed,
    Cancelled,
    Failed(String),
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

    fn is_cancelled(&self) -> bool {
        self.should_cancel.lock().map(|c| *c).unwrap_or(false)
    }

    fn is_paused(&self) -> bool {
        self.is_paused.lock().map(|p| *p).unwrap_or(false)
    }

    pub async fn upload_files(&self, files: Vec<MediaFile>, window: Window) -> Result<(), String> {
        let total = files.len();

        // 整体总字节数：仅统计需要实际拷贝（upload / overwrite）的文件
        let overall_total: u64 = files
            .iter()
            .filter(|f| f.status == "upload" || f.status == "overwrite")
            .map(|f| f.size)
            .sum();

        let mut overall_done: u64 = 0;
        // 用于估算瞬时速度
        let mut speed_anchor_time = Instant::now();
        let mut speed_anchor_bytes: u64 = 0;
        let mut current_speed: u64 = 0;

        for (i, file) in files.iter().enumerate() {
            if self.is_cancelled() {
                break;
            }

            // 暂停等待（同时响应取消）
            while self.is_paused() {
                if self.is_cancelled() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if self.is_cancelled() {
                break;
            }

            let path_str = file.path.to_string_lossy().to_string();

            if file.status == "upload" || file.status == "overwrite" {
                if let Some(parent) = file.target_path.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        window
                            .emit(
                                "upload-error",
                                format!("Failed to create dir for {}: {}", file.filename, e),
                            )
                            .unwrap_or_default();
                        continue;
                    }
                }

                // 开始事件：让表格立即把该行标记为「上传中 0%」
                window
                    .emit(
                        "upload-progress",
                        ProgressPayload {
                            current: i + 1,
                            total,
                            filename: file.filename.clone(),
                            path: path_str.clone(),
                            status: "uploading".to_string(),
                            file_done: 0,
                            file_total: file.size,
                            overall_done,
                            overall_total,
                            speed: current_speed,
                        },
                    )
                    .unwrap_or_default();

                let outcome = self
                    .copy_with_progress(
                        file,
                        &path_str,
                        i + 1,
                        total,
                        &mut overall_done,
                        overall_total,
                        &mut speed_anchor_time,
                        &mut speed_anchor_bytes,
                        &mut current_speed,
                        &window,
                    )
                    .await;

                match outcome {
                    CopyOutcome::Completed => {
                        // 尽量保留原始时间戳
                        if let Ok(metadata) = std::fs::metadata(&file.path) {
                            if let (Ok(atime), Ok(mtime)) =
                                (metadata.accessed(), metadata.modified())
                            {
                                let _ = filetime::set_file_times(
                                    &file.target_path,
                                    filetime::FileTime::from_system_time(atime),
                                    filetime::FileTime::from_system_time(mtime),
                                );
                            }
                        }

                        window
                            .emit(
                                "upload-progress",
                                ProgressPayload {
                                    current: i + 1,
                                    total,
                                    filename: file.filename.clone(),
                                    path: path_str.clone(),
                                    status: "done".to_string(),
                                    file_done: file.size,
                                    file_total: file.size,
                                    overall_done,
                                    overall_total,
                                    speed: current_speed,
                                },
                            )
                            .unwrap_or_default();
                    }
                    CopyOutcome::Cancelled => {
                        // 半成品写在 .part 临时文件中并已由 copy_with_progress 清理，
                        // 正式文件（覆盖场景下的原文件）保持不变
                        break;
                    }
                    CopyOutcome::Failed(err) => {
                        window
                            .emit(
                                "upload-error",
                                format!("Failed to copy {}: {}", file.filename, err),
                            )
                            .unwrap_or_default();
                        window
                            .emit(
                                "upload-progress",
                                ProgressPayload {
                                    current: i + 1,
                                    total,
                                    filename: file.filename.clone(),
                                    path: path_str.clone(),
                                    status: "error".to_string(),
                                    file_done: 0,
                                    file_total: file.size,
                                    overall_done,
                                    overall_total,
                                    speed: current_speed,
                                },
                            )
                            .unwrap_or_default();
                    }
                }
            } else {
                window
                    .emit(
                        "upload-progress",
                        ProgressPayload {
                            current: i + 1,
                            total,
                            filename: file.filename.clone(),
                            path: path_str.clone(),
                            status: "skipped".to_string(),
                            file_done: 0,
                            file_total: file.size,
                            overall_done,
                            overall_total,
                            speed: current_speed,
                        },
                    )
                    .unwrap_or_default();
            }
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn copy_with_progress(
        &self,
        file: &MediaFile,
        path_str: &str,
        current: usize,
        total: usize,
        overall_done: &mut u64,
        overall_total: u64,
        speed_anchor_time: &mut Instant,
        speed_anchor_bytes: &mut u64,
        current_speed: &mut u64,
        window: &Window,
    ) -> CopyOutcome {
        let mut src = match std::fs::File::open(&file.path) {
            Ok(f) => f,
            Err(e) => return CopyOutcome::Failed(e.to_string()),
        };
        // 先写入同目录下的临时文件（追加 .part 后缀），全部写完再原子重命名为正式名。
        // 这样中断/失败不会留下与正式文件同名的半成品，重新扫描也不会误判为重复而生成 _1，
        // 覆盖（overwrite）场景下原文件在重命名成功前也保持完整。
        let temp_path = {
            let mut os = file.target_path.clone().into_os_string();
            os.push(".part");
            std::path::PathBuf::from(os)
        };
        let mut dst = match std::fs::File::create(&temp_path) {
            Ok(f) => f,
            Err(e) => return CopyOutcome::Failed(e.to_string()),
        };

        let mut buf = vec![0u8; BUFFER_SIZE];
        let mut file_done: u64 = 0;
        let mut last_emit = Instant::now();

        loop {
            if self.is_cancelled() {
                let _ = std::fs::remove_file(&temp_path);
                return CopyOutcome::Cancelled;
            }

            // 文件传输中途也支持暂停
            while self.is_paused() {
                if self.is_cancelled() {
                    let _ = std::fs::remove_file(&temp_path);
                    return CopyOutcome::Cancelled;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
                // 暂停期间重置速度锚点，避免恢复后速度被算成 0
                *speed_anchor_time = Instant::now();
                *speed_anchor_bytes = *overall_done;
            }

            let n = match src.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    let _ = std::fs::remove_file(&temp_path);
                    return CopyOutcome::Failed(e.to_string());
                }
            };

            if let Err(e) = dst.write_all(&buf[..n]) {
                let _ = std::fs::remove_file(&temp_path);
                return CopyOutcome::Failed(e.to_string());
            }

            file_done += n as u64;
            *overall_done += n as u64;

            // 节流上报进度
            if last_emit.elapsed() >= EMIT_INTERVAL {
                // 估算瞬时速度（基于最近一段时间的字节增量）
                let elapsed = speed_anchor_time.elapsed().as_secs_f64();
                if elapsed >= 0.5 {
                    let delta = overall_done.saturating_sub(*speed_anchor_bytes);
                    *current_speed = (delta as f64 / elapsed) as u64;
                    *speed_anchor_time = Instant::now();
                    *speed_anchor_bytes = *overall_done;
                }

                window
                    .emit(
                        "upload-progress",
                        ProgressPayload {
                            current,
                            total,
                            filename: file.filename.clone(),
                            path: path_str.to_string(),
                            status: "uploading".to_string(),
                            file_done,
                            file_total: file.size,
                            overall_done: *overall_done,
                            overall_total,
                            speed: *current_speed,
                        },
                    )
                    .unwrap_or_default();
                last_emit = Instant::now();
            }
        }

        if let Err(e) = dst.flush() {
            let _ = std::fs::remove_file(&temp_path);
            return CopyOutcome::Failed(e.to_string());
        }
        // 关闭文件句柄后再重命名，确保数据落盘且文件未被占用
        drop(dst);
        if let Err(e) = std::fs::rename(&temp_path, &file.target_path) {
            let _ = std::fs::remove_file(&temp_path);
            return CopyOutcome::Failed(e.to_string());
        }

        CopyOutcome::Completed
    }
}
