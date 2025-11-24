use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use directories::ProjectDirs;
use anyhow::Result;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub source_dir: String,
    pub target_dir: String,
    pub overwrite_duplicates: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            source_dir: String::new(),
            target_dir: String::new(),
            overwrite_duplicates: false,
        }
    }
}

pub struct ConfigManager {
    config_path: PathBuf,
}

impl ConfigManager {
    pub fn new() -> Self {
        let config_path = if let Some(proj_dirs) = ProjectDirs::from("com", "mascopy", "mascopy") {
            proj_dirs.config_dir().join("config.json")
        } else {
            PathBuf::from(".mascopy-config.json")
        };

        Self { config_path }
    }

    // Try to load from ~/.mascopy-config.json for backward compatibility first
    pub fn load(&self) -> Result<Config> {
        // Legacy path check
        let legacy_path = if let Some(user_dirs) = directories::UserDirs::new() {
            user_dirs.home_dir().join(".mascopy-config.json")
        } else {
            PathBuf::from(".mascopy-config.json")
        };

        if legacy_path.exists() {
            let content = fs::read_to_string(&legacy_path)?;
            let config: Config = serde_json::from_str(&content)?;
            return Ok(config);
        }

        if self.config_path.exists() {
            let content = fs::read_to_string(&self.config_path)?;
            let config: Config = serde_json::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Config::default())
        }
    }

    pub fn save(&self, config: &Config) -> Result<()> {
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(config)?;
        fs::write(&self.config_path, content)?;
        Ok(())
    }
}
