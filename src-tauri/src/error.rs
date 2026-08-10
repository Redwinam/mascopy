use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Configuration error: {0}")]
    Config(String),
    #[error("File system error: {0}")]
    Io(#[from] std::io::Error),
    #[allow(dead_code)]
    #[error("Scanning error: {0}")]
    Scan(String),
    #[error("Upload error: {0}")]
    Upload(String),
    #[allow(dead_code)]
    #[error("Analysis error: {0}")]
    Analyze(String),
    #[error("图片处理失败: {0}")]
    Image(String),
    #[error("Eagle: {0}")]
    Eagle(String),
    #[error("联机: {0}")]
    Tether(String),
    #[allow(dead_code)]
    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

pub type AppResult<T> = Result<T, AppError>;
