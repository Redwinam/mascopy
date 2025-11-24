use std::path::Path;
use std::collections::{HashMap, HashSet};
use chrono::{DateTime, Local};
use crate::scanner::MediaFile;

pub struct Analyzer;

impl Analyzer {
    pub fn analyze(
        files: &mut Vec<MediaFile>, 
        target_dir: &str, 
        overwrite_duplicates: bool
    ) {
        let target_path = Path::new(target_dir);
        let mut used_names_by_date: HashMap<String, HashSet<String>> = HashMap::new();

        // Sort files by date then filename
        files.sort_by(|a, b| {
            let date_cmp = a.date.cmp(&b.date);
            if date_cmp == std::cmp::Ordering::Equal {
                a.filename.cmp(&b.filename)
            } else {
                date_cmp
            }
        });

        for file in files.iter_mut() {
            let date: DateTime<Local> = file.date.into();
            let date_folder = date.format("%Y-%m-%d").to_string();
            let target_date_dir = target_path.join(&date_folder);
            
            // Ensure we track names for this date folder
            let used_names = used_names_by_date.entry(date_folder.clone()).or_insert_with(HashSet::new);

            let original_name = &file.filename;
            let mut candidate_name = original_name.clone();
            let mut attempt = 0;

            // Check for collision in target dir OR in current batch
            loop {
                let candidate_path = target_date_dir.join(&candidate_name);
                let exists_on_disk = candidate_path.exists();
                let used_in_batch = used_names.contains(&candidate_name);

                if !exists_on_disk && !used_in_batch {
                    // Available!
                    file.target_path = candidate_path;
                    file.status = "upload".to_string();
                    used_names.insert(candidate_name);
                    break;
                }

                if exists_on_disk {
                    // Check size for exact duplicate
                    if let Ok(metadata) = std::fs::metadata(&candidate_path) {
                        if metadata.len() == file.size {
                            // Exact duplicate
                            file.target_path = candidate_path;
                            file.status = "skip".to_string();
                            // Even if skipped, the name is "used" in this folder
                            used_names.insert(candidate_name); 
                            break;
                        } else if overwrite_duplicates && attempt == 0 {
                             // Overwrite allowed and it's the first attempt (original name)
                            file.target_path = candidate_path;
                            file.status = "overwrite".to_string();
                            used_names.insert(candidate_name);
                            break;
                        }
                    }
                }

                // Collision: generate new name
                attempt += 1;
                candidate_name = Self::make_unique_name(original_name, attempt);
            }
        }
    }

    fn make_unique_name(original_name: &str, attempt: usize) -> String {
        let path = Path::new(original_name);
        let stem = path.file_stem().unwrap().to_string_lossy();
        let ext = path.extension().map(|e| e.to_string_lossy()).unwrap_or_default();
        
        // Simple strategy: append _1, _2, etc.
        // The original JS had complex logic for A/B/C, but _N is safer and simpler for now.
        if ext.is_empty() {
            format!("{}_{}", stem, attempt)
        } else {
            format!("{}_{}.{}", stem, attempt, ext)
        }
    }
}
