use crate::download_manager::DownloadManager;
use crate::engine_manager;
use crate::events;
use crate::models::{DownloadOptions, DownloadProgressEvent, DownloadState, DownloadTask, EngineStatus, EngineType, SystemDrive};
use crate::process_manager::ProcessManager;
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "level-up-nexus.json";

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    fn validation(message: impl Into<String>) -> Self {
        Self { code: "VALIDATION_ERROR".into(), message: message.into() }
    }
    fn manager(message: impl Into<String>) -> Self {
        Self { code: "TASK_MANAGER_ERROR".into(), message: message.into() }
    }
}

pub struct AppState {
    pub downloads: DownloadManager,
    pub processes: ProcessManager,
}

pub fn persist_tasks(app: &AppHandle, downloads: &DownloadManager) -> Result<(), CommandError> {
    let store = app.store(STORE_PATH).map_err(|error| CommandError::manager(error.to_string()))?;
    let tasks = downloads.list().map_err(CommandError::manager)?;
    let value = serde_json::to_value(tasks).map_err(|error| CommandError::manager(error.to_string()))?;
    store.set("downloads", value);
    store.save().map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(())
}

fn validate_url(url: &str) -> Result<(), CommandError> {
    let trimmed = url.trim();
    let allowed = trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("magnet:");
    if !allowed || trimmed.contains('\0') || trimmed.starts_with("javascript:") || trimmed.starts_with("file:") {
        return Err(CommandError::validation("unsupported or unsafe download URL"));
    }
    Ok(())
}

fn validate_download_dir(path: &str) -> Result<PathBuf, CommandError> {
    if path.trim().is_empty() || path.contains('\0') {
        return Err(CommandError::validation("download directory is required"));
    }
    let directory = PathBuf::from(path);
    if !directory.is_absolute() {
        return Err(CommandError::validation("download directory must be absolute"));
    }
    std::fs::create_dir_all(&directory)
        .map_err(|error| CommandError::validation(format!("cannot prepare download directory: {error}")))?;
    Ok(directory)
}

fn sidecar_name(engine: &EngineType) -> &'static str {
    match engine {
        EngineType::YtDlp => "binaries/yt-dlp",
        EngineType::Aria2c => "binaries/aria2c",
    }
}

fn sidecar_args(app: &AppHandle, task: &DownloadTask) -> Result<Vec<String>, CommandError> {
    let directory = task.download_dir.to_string_lossy().to_string();
    match task.engine {
        EngineType::YtDlp => {
            let resource_dir = app.path().resource_dir().map_err(|error| CommandError::manager(error.to_string()))?;
            let ffmpeg_dir = resource_dir.join("binaries").to_string_lossy().to_string();
            let mut args = vec![
                "--newline".into(),
                "--progress".into(),
                "--progress-delta".into(),
                "0.5".into(),
                "--progress-template".into(),
                "download:%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s".into(),
                "--continue".into(),
                "--ffmpeg-location".into(),
                ffmpeg_dir,
                "-P".into(),
                directory,
                "-o".into(),
                "%(title)s.%(ext)s".into(),
            ];
            if task.options.audio_only.unwrap_or(false) {
                args.push("-x".into());
            }
            args.push(task.url.clone());
            Ok(args)
        }
        EngineType::Aria2c => Ok(vec![
            "--no-conf".into(),
            "--continue=true".into(),
            "--summary-interval=1".into(),
            "--show-console-readout=true".into(),
            "--console-log-level=notice".into(),
            "--dir".into(),
            directory,
            "--max-connection-per-server".into(),
            task.options.connections.unwrap_or(16).clamp(1, 16).to_string(),
            task.url.clone(),
        ]),
    }
}

fn spawn_task(
    app: AppHandle,
    downloads: DownloadManager,
    processes: ProcessManager,
    task: DownloadTask,
) -> Result<DownloadTask, CommandError> {
    let starting = downloads.transition(&task.task_id, DownloadState::Starting).map_err(CommandError::manager)?;
    persist_tasks(&app, &downloads)?;
    let args = sidecar_args(&app, &starting)?;
    let command = app.shell().sidecar(sidecar_name(&starting.engine)).map_err(|error| CommandError::manager(error.to_string()))?;
    let (mut receiver, child) = match command.args(args).spawn() {
        Ok(result) => result,
        Err(error) => {
            let _ = downloads.transition(&task.task_id, DownloadState::Failed);
            let _ = persist_tasks(&app, &downloads);
            return Err(CommandError::manager(error.to_string()));
        }
    };
    processes.insert(task.task_id.clone(), child).map_err(CommandError::manager)?;
    let started = downloads.transition(&task.task_id, DownloadState::Downloading).map_err(CommandError::manager)?;
    persist_tasks(&app, &downloads)?;
    app.emit(events::DOWNLOAD_STARTED, &started).map_err(|error| CommandError::manager(error.to_string()))?;

    let app_handle = app.clone();
    let task_id = task.task_id.clone();
    let task_engine = task.engine.clone();
    let downloads_for_task = downloads.clone();
    let processes_for_task = processes.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_progress_emit = Instant::now() - Duration::from_secs(1);
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if let Some((progress, downloaded, total, speed, eta, filename)) = parse_progress(&task_engine, &line) {
                        if last_progress_emit.elapsed() >= Duration::from_millis(250) || progress >= 100.0 {
                            if let Ok(updated) = downloads_for_task.update_progress(&task_id, progress, downloaded, total, speed, eta, filename) {
                                let payload = DownloadProgressEvent {
                                    task_id: updated.task_id,
                                    state: updated.state,
                                    progress: updated.progress,
                                    downloaded_bytes: updated.downloaded_bytes,
                                    total_bytes: updated.total_bytes,
                                    speed_bytes_per_second: updated.speed_bytes_per_second,
                                    eta_seconds: updated.eta_seconds,
                                    filename: updated.filename,
                                    engine: updated.engine,
                                    error: updated.last_error,
                                };
                                let _ = app_handle.emit(events::DOWNLOAD_PROGRESS, payload);
                                let _ = persist_tasks(&app_handle, &downloads_for_task);
                                last_progress_emit = Instant::now();
                            }
                        }
                    } else if !line.is_empty() {
                        let _ = app_handle.emit("download://log", serde_json::json!({ "taskId": task_id, "stream": "stdout", "line": line }));
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        let _ = app_handle.emit("download://log", serde_json::json!({ "taskId": task_id, "stream": "stderr", "line": line }));
                    }
                }
                CommandEvent::Error(error) => {
                    let _ = downloads_for_task.transition(&task_id, DownloadState::Failed);
                    let _ = persist_tasks(&app_handle, &downloads_for_task);
                    let _ = app_handle.emit(events::DOWNLOAD_FAILED, serde_json::json!({ "taskId": task_id, "error": error }));
                }
                _ => {}
            }
        }
        let _ = processes_for_task.remove(&task_id);
        if let Ok(current) = downloads_for_task.get(&task_id) {
            if !matches!(current.state, DownloadState::Paused | DownloadState::Cancelled | DownloadState::Failed) {
                if let Ok(completed) = downloads_for_task.transition(&task_id, DownloadState::Completed) {
                    let _ = persist_tasks(&app_handle, &downloads_for_task);
                    let _ = app_handle.emit(events::DOWNLOAD_COMPLETED, completed);
                }
            }
        }
    });

    Ok(started)
}

#[tauri::command]
pub fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    engine: EngineType,
    download_dir: String,
    options: Option<DownloadOptions>,
) -> Result<DownloadTask, CommandError> {
    validate_url(&url)?;
    let directory = validate_download_dir(&download_dir)?;
    let options = options.unwrap_or_default();
    let task = state.downloads.insert(DownloadTask::queued(url.trim().to_string(), engine, directory, options))
        .map_err(CommandError::manager)?;
    app.emit(events::DOWNLOAD_QUEUED, &task).map_err(|error| CommandError::manager(error.to_string()))?;
    persist_tasks(&app, &state.downloads)?;
    spawn_task(app, state.downloads.clone(), state.processes.clone(), task)
}

fn parse_progress(engine: &EngineType, line: &str) -> Option<(f64, u64, Option<u64>, u64, Option<u64>, Option<String>)> {
    match engine {
        EngineType::YtDlp => parse_yt_dlp_progress(line),
        EngineType::Aria2c => parse_aria2c_progress(line),
    }
}

fn parse_yt_dlp_progress(line: &str) -> Option<(f64, u64, Option<u64>, u64, Option<u64>, Option<String>)> {
    let payload = line.strip_prefix("download:")?;
    let fields: Vec<&str> = payload.split('|').collect();
    if fields.len() < 7 { return None; }
    let downloaded = fields[1].parse::<u64>().ok()?;
    let total = parse_optional_u64(fields[2]).or_else(|| parse_optional_u64(fields[3]));
    let progress = total.map(|value| if value == 0 { 0.0 } else { downloaded as f64 * 100.0 / value as f64 }).unwrap_or(0.0);
    Some((if fields[0] == "finished" { 100.0 } else { progress }, downloaded, total, parse_rate(fields[4]), parse_eta(fields[5]), Some(fields[6].to_string()).filter(|value| !value.is_empty() && *value != "NA")))
}

fn parse_aria2c_progress(line: &str) -> Option<(f64, u64, Option<u64>, u64, Option<u64>, Option<String>)> {
    let percent_end = line.find("%)")?;
    let open = line[..percent_end].rfind('(')?;
    let progress = line[open + 1..percent_end].parse::<f64>().ok()?;
    let speed = line.split("DL:").nth(1).and_then(|value| value.split_whitespace().next()).map(parse_rate).unwrap_or(0);
    let eta = line.split("ETA:").nth(1).and_then(|value| value.split(|character: char| character == ']' || character.is_whitespace()).next()).and_then(parse_eta);
    Some((progress, 0, None, speed, eta, None))
}

fn parse_optional_u64(value: &str) -> Option<u64> {
    if value == "NA" || value.is_empty() { None } else { value.parse().ok() }
}

fn parse_rate(value: &str) -> u64 {
    let normalized = value.trim().trim_end_matches("/s");
    let split_at = normalized.find(|character: char| character.is_ascii_alphabetic()).unwrap_or(normalized.len());
    let number = normalized[..split_at].trim().parse::<f64>().unwrap_or(0.0);
    let unit = normalized[split_at..].to_ascii_lowercase();
    let multiplier = match unit.as_str() {
        "kib" | "ki" | "kb" | "k" => 1024.0,
        "mib" | "mi" | "mb" | "m" => 1024.0 * 1024.0,
        "gib" | "gi" | "gb" | "g" => 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (number * multiplier) as u64
}

fn parse_eta(value: &str) -> Option<u64> {
    if value == "NA" || value == "--" || value.is_empty() { return None; }
    let parts: Vec<u64> = value.split(':').filter_map(|part| part.parse().ok()).collect();
    match parts.as_slice() {
        [seconds] => Some(*seconds),
        [minutes, seconds] => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
}

#[tauri::command]
pub fn pause_download(app: AppHandle, state: State<'_, AppState>, task_id: String) -> Result<DownloadTask, CommandError> {
    state.processes.kill(&task_id).map_err(CommandError::manager)?;
    let task = state.downloads.transition(&task_id, DownloadState::Paused).map_err(CommandError::manager)?;
    persist_tasks(&app, &state.downloads)?;
    app.emit(events::DOWNLOAD_PAUSED, &task).map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(task)
}

#[tauri::command]
pub fn resume_download(app: AppHandle, state: State<'_, AppState>, task_id: String) -> Result<DownloadTask, CommandError> {
    let task = state.downloads.get(&task_id).map_err(CommandError::manager)?;
    if !matches!(task.state, DownloadState::Paused) {
        return Err(CommandError::manager("only paused downloads can be resumed"));
    }
    let resumed = spawn_task(app.clone(), state.downloads.clone(), state.processes.clone(), task)?;
    app.emit(events::DOWNLOAD_RESUMED, &resumed).map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(resumed)
}

#[tauri::command]
pub fn cancel_download(app: AppHandle, state: State<'_, AppState>, task_id: String) -> Result<DownloadTask, CommandError> {
    let _ = state.processes.kill(&task_id);
    let task = state.downloads.transition(&task_id, DownloadState::Cancelled).map_err(CommandError::manager)?;
    persist_tasks(&app, &state.downloads)?;
    app.emit(events::DOWNLOAD_CANCELLED, &task).map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(task)
}

#[tauri::command]
pub fn get_download(state: State<'_, AppState>, task_id: String) -> Result<DownloadTask, CommandError> {
    state.downloads.get(&task_id).map_err(CommandError::manager)
}

#[tauri::command]
pub fn list_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadTask>, CommandError> {
    state.downloads.list().map_err(CommandError::manager)
}

#[tauri::command]
pub fn get_default_download_dir() -> Result<String, CommandError> {
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").map_err(|_| CommandError::manager("USERPROFILE is not available"))?;
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").map_err(|_| CommandError::manager("HOME is not available"))?;
    let directory = PathBuf::from(home).join("Downloads").join("Nexus");
    std::fs::create_dir_all(&directory).map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(directory.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_engine_status(app: AppHandle) -> Result<EngineStatus, CommandError> {
    engine_manager::inspect(&app).map_err(CommandError::manager)
}

#[tauri::command]
pub fn get_system_drives() -> Result<Vec<SystemDrive>, CommandError> {
    #[cfg(target_os = "windows")]
    {
        let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        let path = PathBuf::from(format!("{}\\", system_drive.trim_end_matches('\\')));
        return Ok(vec![SystemDrive { name: system_drive, path, available_bytes: None, total_bytes: None }]);
    }
    #[cfg(not(target_os = "windows"))]
    Ok(Vec::new())
}

#[tauri::command]
pub fn open_file_location(path: String) -> Result<(), CommandError> {
    let target = PathBuf::from(path);
    if !target.is_absolute() || !target.exists() {
        return Err(CommandError::validation("file location must be an existing absolute path"));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map_err(|error| CommandError::manager(format!("cannot open file location: {error}")))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    Err(CommandError::manager("file location is currently implemented for Windows x64 only"))
}
