use anyhow::{anyhow, bail, Result};
use chrono::{Local, NaiveDateTime, TimeZone};
use exif::{Reader, Tag, Value};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub struct MetadataExtractor;
impl MetadataExtractor {
    pub fn get_date(path: &Path) -> SystemTime {
        Self::get_exif_date(path)
            .or_else(|_| Self::get_video_date(path))
            .or_else(|_| Ok::<_, anyhow::Error>(fs::metadata(path)?.modified()?))
            .unwrap_or_else(|_| SystemTime::now())
    }
    fn get_exif_date(path: &Path) -> Result<SystemTime> {
        let file = fs::File::open(path)?;
        let exif = Reader::new().read_from_container(&mut std::io::BufReader::new(file))?;
        let field = exif
            .get_field(Tag::DateTimeOriginal, exif::In::PRIMARY)
            .ok_or_else(|| anyhow!("没有EXIF拍摄时间"))?;
        let Value::Ascii(values) = &field.value else {
            bail!("EXIF时间格式无效")
        };
        let text = std::str::from_utf8(values.first().ok_or_else(|| anyhow!("EXIF时间为空"))?)?
            .trim_end_matches('\0');
        let naive = NaiveDateTime::parse_from_str(text, "%Y:%m:%d %H:%M:%S")?;
        // Earlier occurrence is deterministic during DST overlap; gaps fall back to mtime.
        Local
            .from_local_datetime(&naive)
            .earliest()
            .map(SystemTime::from)
            .ok_or_else(|| anyhow!("本地时间不存在"))
    }
    fn get_video_date(path: &Path) -> Result<SystemTime> {
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "mp4" | "mov" | "m4v" | "3gp" | "osv" | "lrf") {
            bail!("此容器使用文件修改时间")
        }
        let mut file = fs::File::open(path)?;
        let len = file.metadata()?.len();
        let seconds = read_movie_time(&mut file, 0, len, 0, &mut 100_000)?
            .ok_or_else(|| anyhow!("没有容器创建时间"))?;
        if seconds == 0 {
            bail!("容器时间未设置")
        }
        const QUICKTIME_EPOCH: u64 = 2_082_844_800;
        let time = if seconds >= QUICKTIME_EPOCH {
            UNIX_EPOCH.checked_add(Duration::from_secs(seconds - QUICKTIME_EPOCH))
        } else {
            UNIX_EPOCH.checked_sub(Duration::from_secs(QUICKTIME_EPOCH - seconds))
        }
        .ok_or_else(|| anyhow!("容器时间超出范围"))?;
        // Reject invalid clocks before serializing SystemTime to the frontend DTO.
        if time < UNIX_EPOCH || time > SystemTime::now() + Duration::from_secs(366 * 24 * 3600) {
            bail!("容器创建时间无效")
        }
        Ok(time)
    }
}

fn read_movie_time(
    file: &mut fs::File,
    start: u64,
    end: u64,
    depth: u8,
    budget: &mut usize,
) -> Result<Option<u64>> {
    if depth > 1 {
        bail!("容器层级过深")
    }
    let mut offset = start;
    while offset < end {
        if *budget == 0 || end - offset < 8 {
            bail!("容器atom无效")
        };
        *budget -= 1;
        file.seek(SeekFrom::Start(offset))?;
        let mut header = [0; 8];
        file.read_exact(&mut header)?;
        let small = u32::from_be_bytes(header[..4].try_into()?) as u64;
        let mut header_len = 8;
        let size = match small {
            0 => end - offset,
            1 => {
                if end - offset < 16 {
                    bail!("截断的扩展atom")
                };
                let mut ext = [0; 8];
                file.read_exact(&mut ext)?;
                header_len = 16;
                u64::from_be_bytes(ext)
            }
            n => n,
        };
        if size < header_len || size > end - offset {
            bail!("容器atom越界")
        }
        let body = offset + header_len;
        let next = offset + size;
        if &header[4..] == b"moov" && depth == 0 {
            if let Some(time) = read_movie_time(file, body, next, 1, budget)? {
                return Ok(Some(time));
            }
        } else if &header[4..] == b"mvhd" && depth == 1 {
            if next - body < 8 {
                bail!("截断的mvhd")
            };
            file.seek(SeekFrom::Start(body))?;
            let mut full = [0; 4];
            file.read_exact(&mut full)?;
            return match full[0] {
                0 => {
                    let mut b = [0; 4];
                    file.read_exact(&mut b)?;
                    Ok(Some(u32::from_be_bytes(b) as u64))
                }
                1 => {
                    if next - body < 12 {
                        bail!("截断的mvhd v1")
                    };
                    let mut b = [0; 8];
                    file.read_exact(&mut b)?;
                    Ok(Some(u64::from_be_bytes(b)))
                }
                _ => Err(anyhow!("未知mvhd版本")),
            };
        }
        offset = next;
    }
    Ok(None)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::tests::TestDir;
    fn atom(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut b = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        b.extend(kind);
        b.extend(body);
        b
    }
    #[test]
    fn mp4_and_mov_creation_time_versions_and_invalid_atoms() {
        let dir = TestDir::new();
        let p = dir.0.join("movie.MOV");
        let unix = 1_700_000_000u64;
        for version in [0, 1] {
            let mut body = vec![version, 0, 0, 0];
            if version == 0 {
                body.extend(((unix + 2_082_844_800) as u32).to_be_bytes())
            } else {
                body.extend((unix + 2_082_844_800).to_be_bytes())
            };
            fs::write(&p, atom(b"moov", &atom(b"mvhd", &body))).unwrap();
            assert_eq!(
                MetadataExtractor::get_video_date(&p).unwrap(),
                UNIX_EPOCH + Duration::from_secs(unix)
            );
        }
        fs::write(&p, [0xff; 16]).unwrap();
        assert!(MetadataExtractor::get_video_date(&p).is_err());
        assert_eq!(
            MetadataExtractor::get_date(&p),
            fs::metadata(&p).unwrap().modified().unwrap()
        );
    }
    #[test]
    fn exif_dst_child() {
        if std::env::var("MASCOPY_DST_TEST").is_err() {
            return;
        }
        let dir = TestDir::new();
        let p = dir.0.join("photo.tif");
        for (value, gap) in [
            ("2024:03:10 02:30:00", true),
            ("2024:11:03 01:30:00", false),
            ("2024:06:01 12:00:00", false),
        ] {
            let mut b = vec![
                b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0,
                0, 0, 0, 1, 0, 3, 0x90, 2, 0, 20, 0, 0, 0, 44, 0, 0, 0, 0, 0, 0, 0,
            ];
            b.extend(value.as_bytes());
            b.push(0);
            fs::write(&p, b).unwrap();
            assert_eq!(MetadataExtractor::get_exif_date(&p).is_err(), gap);
            let _ = MetadataExtractor::get_date(&p);
        }
    }
    #[test]
    fn dst_gaps_and_overlaps_never_panic() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "metadata::tests::exif_dst_child"])
            .env("TZ", "America/New_York")
            .env("MASCOPY_DST_TEST", "1")
            .status()
            .unwrap();
        assert!(status.success());
    }
}
