use crate::models::{EngineInfo, EngineStatus, EngineType};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const WINDOWS_TARGET: &str = "x86_64-pc-windows-msvc";

pub fn sidecar_basename(engine: &EngineType) -> &'static str {
    match engine {
        EngineType::YtDlp => "yt-dlp",
        EngineType::Aria2c => "aria2c",
    }
}

pub fn sidecar_candidate(resource_dir: &Path, engine: &EngineType) -> PathBuf {
    let extension = if cfg!(target_os = "windows") { ".exe" } else { "" };
    resource_dir
        .join("binaries")
        .join(format!("{}-{}{}", sidecar_basename(engine), WINDOWS_TARGET, extension))
}

pub fn inspect(app: &AppHandle) -> Result<EngineStatus, String> {
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let mut engines = Vec::new();
    for engine in [EngineType::YtDlp, EngineType::Aria2c] {
        let path = sidecar_candidate(&resource_dir, &engine);
        let available = path.is_file();
        engines.push(EngineInfo {
            engine,
            available,
            path: available.then_some(path),
            version: None,
            error: (!available).then(|| "sidecar not bundled yet".to_string()),
        });
    }
    Ok(EngineStatus {
        platform: std::env::consts::OS.to_string(),
        target: WINDOWS_TARGET.to_string(),
        engines,
    })
}
