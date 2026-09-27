use std::path::Path;

// One owner for file kinds; modes restrict admission without redefining the type.
const FORMATS: &[(&str, &str, bool, bool, bool)] = &[
    ("jpg", "photo", true, true, true),
    ("jpeg", "photo", true, true, true),
    ("png", "photo", true, false, true),
    ("heic", "photo", true, false, true),
    ("hif", "photo", false, false, true),
    ("nef", "photo", true, false, true),
    ("cr2", "photo", true, false, true),
    ("cr3", "photo", true, false, true),
    ("arw", "photo", true, false, true),
    ("dng", "photo", true, false, true),
    ("mp4", "video", true, true, true),
    ("mov", "video", true, true, true),
    ("avi", "video", true, false, true),
    ("m4v", "video", true, false, true),
    ("3gp", "video", true, false, true),
    ("mkv", "video", true, false, true),
    ("crm", "video", false, false, true),
    ("lrf", "video", false, true, false),
    ("osv", "video", false, true, false),
];

pub fn classify(path: &Path, mode: &str) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    FORMATS.iter().find_map(|(name, kind, sd, dji, tether)| {
        let allowed = match mode {
            "sd" => *sd,
            "dji" => *dji,
            "tether" => *tether,
            _ => false,
        };
        (*name == ext && allowed).then_some(*kind)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_formats_have_one_kind_and_preserve_mode_admission() {
        let mut names = std::collections::HashSet::new();
        for (ext, kind, sd, dji, tether) in FORMATS {
            assert!(names.insert(ext));
            for (mode, allowed) in [("sd", sd), ("dji", dji), ("tether", tether)] {
                assert_eq!(
                    classify(
                        Path::new(&format!("IMG.{}", ext.to_ascii_uppercase())),
                        mode
                    ),
                    allowed.then_some(*kind)
                );
            }
        }
        assert_eq!(classify(Path::new("IMG.LRF"), "dji"), Some("video"));
        assert_eq!(classify(Path::new("IMG.HIF"), "tether"), Some("photo"));
        assert_eq!(classify(Path::new("IMG.JPG"), "unknown"), None);
    }
}
