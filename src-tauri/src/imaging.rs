use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;

/// 浏览器可直接解码显示的格式；其余（RAW/HEIC 等）交给 sips 转码
pub fn is_browser_native(ext: &str) -> bool {
    matches!(ext, "jpg" | "jpeg" | "png")
}

fn ext_lower(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 系统临时目录里的唯一文件名（绝不落在源 SD 卡或用户目录，用完即删）
fn transient_temp_path() -> PathBuf {
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "mascopy-eagle-{}-{}-{}.jpg",
        std::process::id(),
        seq,
        nanos
    ))
}

/// 用 macOS 自带 sips（ImageIO）把任意支持格式转成 JPEG 字节。
/// 中间文件写在系统临时目录，读入内存后立即删除。
fn sips_to_jpeg_bytes(input: &Path, max_dim: Option<u32>, quality: u32) -> Result<Vec<u8>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (input, max_dim, quality);
        return Err("RAW/HEIC 转码目前仅支持 macOS".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let tmp = transient_temp_path();
        let quality = quality.to_string();
        let mut args: Vec<&str> = vec!["-s", "format", "jpeg", "-s", "formatOptions", &quality];
        let z;
        if let Some(dim) = max_dim {
            z = dim.to_string();
            args.push("-Z");
            args.push(&z);
        }
        let input_s = input.to_string_lossy().to_string();
        let tmp_s = tmp.to_string_lossy().to_string();
        args.push(&input_s);
        args.push("--out");
        args.push(&tmp_s);

        let output = Command::new("/usr/bin/sips")
            .args(&args)
            .output()
            .map_err(|e| format!("调用 sips 失败: {e}"))?;

        if !output.status.success() {
            let _ = std::fs::remove_file(&tmp);
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("图片转码失败: {}", stderr.trim()));
        }

        let bytes = std::fs::read(&tmp).map_err(|e| format!("读取转码结果失败: {e}"));
        let _ = std::fs::remove_file(&tmp);
        bytes
    }
}

fn to_data_url(jpeg_bytes: &[u8]) -> String {
    format!("data:image/jpeg;base64,{}", B64.encode(jpeg_bytes))
}

/// 生成缩略图，返回 data URL（只存在于内存，不写任何缓存）
pub fn thumbnail_data_url(path_str: &str, size: u32) -> Result<String, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    let bytes = sips_to_jpeg_bytes(path, Some(size.clamp(64, 1024)), 82)?;
    Ok(to_data_url(&bytes))
}

/// 生成大图预览（RAW/HEIC 用），返回 data URL
pub fn preview_data_url(path_str: &str, max_dim: u32) -> Result<String, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    let bytes = sips_to_jpeg_bytes(path, Some(max_dim.clamp(512, 4096)), 88)?;
    Ok(to_data_url(&bytes))
}

/// 裁剪源字节的单槽缓存：同一张 RAW 连续裁剪多次时避免重复转码
pub type CropSourceCache = Mutex<Option<(String, Arc<Vec<u8>>)>>;

fn source_cache_key(path: &Path) -> String {
    let (len, mtime) = std::fs::metadata(path)
        .map(|m| {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            (m.len(), mtime)
        })
        .unwrap_or((0, 0));
    format!("{}|{}|{}", path.to_string_lossy(), len, mtime)
}

/// 取得用于裁剪的全分辨率 JPEG/PNG 字节：
/// - jpg/png 直接读原文件（只读，不写）
/// - 其他格式用 sips 转成全尺寸 JPEG（内存中，临时文件即刻删除）
pub fn crop_source_bytes(path_str: &str, cache: &CropSourceCache) -> Result<Arc<Vec<u8>>, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    let key = source_cache_key(path);
    if let Ok(guard) = cache.lock() {
        if let Some((k, bytes)) = guard.as_ref() {
            if *k == key {
                return Ok(bytes.clone());
            }
        }
    }

    let ext = ext_lower(path);
    let bytes = if is_browser_native(&ext) {
        std::fs::read(path).map_err(|e| format!("读取图片失败: {e}"))?
    } else {
        sips_to_jpeg_bytes(path, None, 95)?
    };
    let bytes = Arc::new(bytes);
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((key, bytes.clone()));
    }
    Ok(bytes)
}

fn read_orientation(bytes: &[u8]) -> u32 {
    (|| -> Option<u32> {
        let exif = exif::Reader::new()
            .read_from_container(&mut Cursor::new(bytes))
            .ok()?;
        exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?
            .value
            .get_uint(0)
    })()
    .unwrap_or(1)
}

/// 把像素转到与浏览器显示一致的“正立”方向（浏览器按 EXIF 自动旋转）
fn apply_orientation(img: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

pub struct CropOutput {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// 在内存中裁剪：rect 为相对于“正立”图像的归一化坐标（0..1）
pub fn crop_in_memory(
    source_bytes: &[u8],
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<CropOutput, String> {
    let orientation = read_orientation(source_bytes);
    let img =
        image::load_from_memory(source_bytes).map_err(|e| format!("解码图片失败: {e}"))?;
    let img = apply_orientation(img, orientation);

    let iw = img.width();
    let ih = img.height();
    let fx = x.clamp(0.0, 1.0);
    let fy = y.clamp(0.0, 1.0);
    let px = ((fx * iw as f64).round() as u32).min(iw.saturating_sub(1));
    let py = ((fy * ih as f64).round() as u32).min(ih.saturating_sub(1));
    let pw = ((w.max(0.0) * iw as f64).round() as u32)
        .min(iw - px)
        .max(1);
    let ph = ((h.max(0.0) * ih as f64).round() as u32)
        .min(ih - py)
        .max(1);
    if pw < 4 || ph < 4 {
        return Err("裁剪区域过小".to_string());
    }

    let cropped = img.crop_imm(px, py, pw, ph);
    let rgb = cropped.to_rgb8();
    let mut out: Vec<u8> = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 92)
        .encode_image(&rgb)
        .map_err(|e| format!("编码 JPEG 失败: {e}"))?;

    Ok(CropOutput {
        jpeg: out,
        width: pw,
        height: ph,
    })
}
