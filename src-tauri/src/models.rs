use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineType {
    #[serde(rename = "yt-dlp")]
    YtDlp,
    #[serde(rename = "aria2c")]
    Aria2c,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadState {
    Queued,
    Starting,
    Downloading,
    Paused,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub connections: Option<u8>,
    pub output_template: Option<String>,
    pub audio_only: Option<bool>,
}

impl Default for DownloadOptions {
    fn default() -> Self {
        Self {
            connections: Some(16),
            output_template: None,
            audio_only: Some(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub task_id: String,
    pub url: String,
    pub engine: EngineType,
    pub options: DownloadOptions,
    pub download_dir: PathBuf,
    pub output_path: Option<PathBuf>,
    pub state: DownloadState,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub filename: Option<String>,
    pub pid: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
    pub last_error: Option<String>,
}

impl DownloadTask {
    pub fn queued(url: String, engine: EngineType, download_dir: PathBuf, options: DownloadOptions) -> Self {
        let now = format!("{:?}", std::time::SystemTime::now());
        Self {
            task_id: format!("nexus-{}", Uuid::new_v4()),
            url,
            engine,
            options,
            download_dir,
            output_path: None,
            state: DownloadState::Queued,
            progress: 0.0,
            downloaded_bytes: 0,
            total_bytes: None,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            filename: None,
            pid: None,
            created_at: now.clone(),
            updated_at: now,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub engine: EngineType,
    pub available: bool,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    pub platform: String,
    pub target: String,
    pub engines: Vec<EngineInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemDrive {
    pub name: String,
    pub path: PathBuf,
    pub available_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub task_id: String,
    pub state: DownloadState,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub filename: Option<String>,
    pub engine: EngineType,
    pub error: Option<String>,
}
