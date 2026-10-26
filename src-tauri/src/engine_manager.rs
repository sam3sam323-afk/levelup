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
    let basename = sidecar_basename(engine);
    let filename = format!("{basename}{extension}");
    let target_filename = format!("{basename}-{WINDOWS_TARGET}{extension}");
    [
        resource_dir.join(&filename),
        resource_dir.join(&target_filename),
        resource_dir.join("binaries").join(&filename),
        resource_dir.join("binaries").join(&target_filename),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
    .unwrap_or_else(|| resource_dir.join(filename))
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
            error: (!available).then(|| "sidecar executable was not found beside the application or in its binaries directory".to_string()),
        });
    }
    Ok(EngineStatus {
        platform: std::env::consts::OS.to_string(),
        target: WINDOWS_TARGET.to_string(),
        engines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn finds_packaged_sidecars_by_the_installed_basename() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("nexus-sidecar-test-{nonce}"));
        std::fs::create_dir_all(&dir).unwrap();
        let name = format!("yt-dlp{}", if cfg!(target_os = "windows") { ".exe" } else { "" });
        std::fs::write(dir.join(&name), b"test").unwrap();
        assert_eq!(sidecar_candidate(&dir, &EngineType::YtDlp), dir.join(&name));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn falls_back_to_legacy_binaries_directory() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("nexus-sidecar-test-{nonce}"));
        let binaries = dir.join("binaries");
        std::fs::create_dir_all(&binaries).unwrap();
        let name = format!("aria2c-{WINDOWS_TARGET}{}", if cfg!(target_os = "windows") { ".exe" } else { "" });
        std::fs::write(binaries.join(&name), b"test").unwrap();
        assert_eq!(sidecar_candidate(&dir, &EngineType::Aria2c), binaries.join(name));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
