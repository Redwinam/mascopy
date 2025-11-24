use std::path::Path;
use std::fs;
use std::time::SystemTime;
use chrono::{Local, NaiveDateTime, TimeZone};
use exif::{Reader, Tag};

use lofty::read_from_path;
use anyhow::Result;

pub struct MetadataExtractor;

impl MetadataExtractor {
    pub fn get_date(path: &Path) -> SystemTime {
        // Try EXIF for photos
        if let Ok(date) = Self::get_exif_date(path) {
            return date;
        }

        // Try Metadata for videos
        if let Ok(date) = Self::get_video_date(path) {
            return date;
        }

        // Fallback to file modification time
        if let Ok(metadata) = fs::metadata(path) {
            if let Ok(modified) = metadata.modified() {
                return modified;
            }
        }

        SystemTime::now()
    }

    fn get_exif_date(path: &Path) -> Result<SystemTime> {
        let file = fs::File::open(path)?;
        let reader = Reader::new();
        let exif = reader.read_from_container(&mut std::io::BufReader::new(file))?;

        if let Some(field) = exif.get_field(Tag::DateTimeOriginal, exif::In::PRIMARY) {
            let date_str = field.display_value().to_string();
            // Format: "YYYY-MM-DD HH:MM:SS"
            // We parse it as "Naive" local time, then convert to SystemTime
            // Note: exif crate display_value might use different separators, usually "YYYY-MM-DD HH:MM:SS" or "YYYY:MM:DD HH:MM:SS"
            let date_str = date_str.replace(":", "-").replace(" ", "T");
            // Try to parse roughly
             if let Ok(naive) = NaiveDateTime::parse_from_str(&date_str, "%Y-%m-%dT%H-%M-%S") {
                 // Assume local time
                 let local = Local.from_local_datetime(&naive).unwrap();
                 return Ok(local.into());
             }
             // Try standard EXIF format YYYY:MM:DD HH:MM:SS
             if let Some(field_val) = exif.get_field(Tag::DateTimeOriginal, exif::In::PRIMARY) {
                 let s = field_val.display_value().to_string(); // "2023-11-25 12:34:56" usually from this crate
                 if let Ok(naive) = NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S") {
                     let local = Local.from_local_datetime(&naive).unwrap();
                     return Ok(local.into());
                 }
             }
        }
        
        Err(anyhow::anyhow!("No EXIF date found"))
    }

    fn get_video_date(path: &Path) -> Result<SystemTime> {
        let _tagged_file = read_from_path(path)?;
        
        // Lofty doesn't always give creation date easily for all formats, 
        // but let's try standard tags.
        // For MP4, it's often in specific atoms. Lofty might not expose it generically in `tags()`.
        // This is a simplification. If Lofty fails, we might need a more specific parser or fallback.
        
        // For now, let's trust file mtime if lofty fails, or try to parse if we find a date tag.
        // Many video formats don't have a standardized "Creation Date" tag that Lofty unifies.
        
        Err(anyhow::anyhow!("Video metadata not fully implemented"))
    }
}
