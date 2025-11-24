use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use directories::ProjectDirs;
use anyhow::Result;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModeConfig {
    #[serde(default)]
    pub source_dir: String,
    #[serde(default)]
    pub target_dir: String,
    #[serde(default)]
    pub overwrite_duplicates: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DjiSourceFavorite {
    pub path: String,
    #[serde(default)]
    pub device_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Favorites {
    #[serde(default)]
    pub sd_sources: Vec<String>,
    #[serde(default)]
    pub sd_targets: Vec<String>,
    #[serde(default)]
    pub dji_sources: Vec<DjiSourceFavorite>,
    #[serde(default)]
    pub dji_targets: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    #[serde(default)]
    pub sd: ModeConfig,
    #[serde(default)]
    pub dji: ModeConfig,
    #[serde(default)]
    pub favorites: Favorites,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            sd: ModeConfig::default(),
            dji: ModeConfig::default(),
            favorites: Favorites::default(),
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

    pub fn load(&self) -> Result<Config> {
        let legacy_path = if let Some(user_dirs) = directories::UserDirs::new() {
            user_dirs.home_dir().join(".mascopy-config.json")
        } else {
            PathBuf::from(".mascopy-config.json")
        };

        if self.config_path.exists() {
            let content = fs::read_to_string(&self.config_path)?;
            let config: Config = serde_json::from_str(&content)?;
            return Ok(config);
        }

        if legacy_path.exists() {
            let content = fs::read_to_string(&legacy_path)?;
            let config: Config = serde_json::from_str(&content)?;
            if let Some(parent) = self.config_path.parent() { fs::create_dir_all(parent)?; }
            let new_content = serde_json::to_string_pretty(&config)?;
            fs::write(&self.config_path, new_content)?;
            return Ok(config);
        }

        Ok(Config::default())
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
