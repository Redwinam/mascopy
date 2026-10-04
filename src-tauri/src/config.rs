use crate::storage::StagedFile;
use anyhow::Result;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModeConfig {
    #[serde(default)]
    pub source_dir: String,
    #[serde(default)]
    pub target_dir: String,
    #[serde(default)]
    pub overwrite_duplicates: bool,
    /// Opt-in byte comparison; the default keeps legacy name-and-size scanning fast.
    #[serde(default)]
    pub verify_duplicates: bool,
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

fn default_eagle_base_url() -> String {
    "http://localhost:41595".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EagleConfig {
    #[serde(default = "default_eagle_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub last_folder_id: String,
}

impl Default for EagleConfig {
    fn default() -> Self {
        Self {
            base_url: default_eagle_base_url(),
            token: String::new(),
            last_folder_id: String::new(),
        }
    }
}

fn default_tether_mode() -> String {
    "ftp".to_string()
}

fn default_ftp_port() -> u16 {
    2121
}

fn default_ftp_user() -> String {
    "eos".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TetherConfig {
    #[serde(default = "default_tether_mode")]
    pub mode: String, // "ftp" | "watch"
    #[serde(default)]
    pub watch_dir: String,
    #[serde(default)]
    pub target_dir: String,
    #[serde(default = "default_ftp_port")]
    pub ftp_port: u16,
    #[serde(default = "default_ftp_user")]
    pub ftp_user: String,
    #[serde(default = "default_ftp_user")]
    pub ftp_pass: String,
    #[serde(default)]
    pub delete_source: bool,
}

impl Default for TetherConfig {
    fn default() -> Self {
        Self {
            mode: default_tether_mode(),
            watch_dir: String::new(),
            target_dir: String::new(),
            ftp_port: default_ftp_port(),
            ftp_user: default_ftp_user(),
            ftp_pass: default_ftp_user(),
            delete_source: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Config {
    #[serde(default)]
    pub sd: ModeConfig,
    #[serde(default)]
    pub dji: ModeConfig,
    #[serde(default)]
    pub favorites: Favorites,
    #[serde(default)]
    pub eagle: EagleConfig,
    #[serde(default)]
    pub tether: TetherConfig,
}

pub struct ConfigManager {
    config_path: PathBuf,
    io_lock: Mutex<()>,
}

impl ConfigManager {
    pub fn new() -> Self {
        let config_path = if let Some(proj_dirs) = ProjectDirs::from("com", "mascopy", "mascopy") {
            proj_dirs.config_dir().join("config.json")
        } else {
            PathBuf::from(".mascopy-config.json")
        };

        Self {
            config_path,
            io_lock: Mutex::new(()),
        }
    }

    pub fn load(&self) -> Result<Config> {
        let _guard = self
            .io_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("配置锁不可用"))?;
        let legacy_path = if let Some(user_dirs) = directories::UserDirs::new() {
            user_dirs.home_dir().join(".mascopy-config.json")
        } else {
            PathBuf::from(".mascopy-config.json")
        };

        if self.config_path.exists() {
            self.restrict_permissions()?;
            let content = fs::read_to_string(&self.config_path)?;
            let config: Config = serde_json::from_str(&content)?;
            return Ok(config);
        }

        if legacy_path.exists() {
            let content = fs::read_to_string(&legacy_path)?;
            let config: Config = serde_json::from_str(&content)?;
            self.persist(&config)?;
            return Ok(config);
        }

        Ok(Config::default())
    }

    pub fn save(&self, config: &Config) -> Result<()> {
        let _guard = self
            .io_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("配置锁不可用"))?;
        self.persist(config)
    }

    fn restrict_permissions(&self) -> Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(parent) = self
                .config_path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
            {
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
            }
            if self.config_path.exists() {
                fs::set_permissions(&self.config_path, fs::Permissions::from_mode(0o600))?;
            }
        }
        Ok(())
    }

    fn persist(&self, config: &Config) -> Result<()> {
        let content = serde_json::to_vec_pretty(config)?;
        if let Some(parent) = self
            .config_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
        self.restrict_permissions()?;
        let mut staged = StagedFile::new(&self.config_path)?;
        staged.file.write_all(&content)?;
        staged.commit(&self.config_path, true)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::tests::TestDir;
    use std::sync::Arc;
    #[test]
    fn concurrent_saves_are_complete_and_private() {
        let dir = TestDir::new();
        let manager = Arc::new(ConfigManager {
            config_path: dir.0.join("config/config.json"),
            io_lock: Mutex::new(()),
        });
        let threads: Vec<_> = (0..12)
            .map(|i| {
                let manager = manager.clone();
                std::thread::spawn(move || {
                    let mut c = Config::default();
                    c.sd.source_dir = format!("source-{i}");
                    manager.save(&c).unwrap();
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert!(manager.load().unwrap().sd.source_dir.starts_with("source-"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&manager.config_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(manager.config_path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        assert_eq!(
            fs::read_dir(manager.config_path.parent().unwrap())
                .unwrap()
                .count(),
            1
        );
    }
    #[test]
    fn older_configuration_defaults_survive_atomic_rewrite() {
        let dir = TestDir::new();
        let path = dir.0.join("config.json");
        fs::write(
            &path,
            r#"{"sd":{"source_dir":"old","overwrite_duplicates":true}}"#,
        )
        .unwrap();
        let manager = ConfigManager {
            config_path: path,
            io_lock: Mutex::new(()),
        };
        let mut c = manager.load().unwrap();
        assert!(c.sd.overwrite_duplicates);
        assert!(!c.sd.verify_duplicates);
        assert_eq!(c.tether.ftp_port, 2121);
        manager.save(&c).unwrap();
        assert_eq!(manager.load().unwrap().sd.source_dir, "old");
        c.sd.verify_duplicates = true;
        manager.save(&c).unwrap();
        assert!(manager.load().unwrap().sd.verify_duplicates);
        assert!(!manager.load().unwrap().dji.verify_duplicates);
    }
}
