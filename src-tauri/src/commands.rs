use crate::download_manager::DownloadManager;
use crate::engine_manager;
use crate::events;
use crate::models::{DownloadOptions, DownloadProgressEvent, DownloadState, DownloadTask, EngineStatus, EngineType, SystemDrive};
use crate::process_manager::ProcessManager;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::utils::config::WebviewUrl;
use tauri::webview::WebviewWindowBuilder;
use tauri::{window::{ProgressBarState, ProgressBarStatus}, AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tauri_plugin_store::StoreExt;
use url::Url;
use uuid::Uuid;

const STORE_PATH: &str = "level-up-nexus.json";
const BROWSER_WINDOW_LABEL: &str = "nexus-browser-1";

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub label: String,
    pub url: String,
    pub title: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserVideoFormat {
    pub format_id: String,
    pub label: String,
    pub ext: String,
    pub resolution: String,
    pub fps: Option<f64>,
    pub filesize: Option<u64>,
    pub audio_only: bool,
}

#[derive(Debug, Clone)]
pub struct BrowserFormatCache {
    pub url: String,
    pub formats: HashMap<String, BrowserFormatMeta>,
    pub expires_at: Instant,
}

#[derive(Debug, Clone)]
pub struct BrowserFormatMeta {
    pub audio_only: bool,
    pub has_audio: bool,
}

pub struct AppState {
    pub downloads: DownloadManager,
    pub processes: ProcessManager,
    pub browser_sessions: Arc<Mutex<HashMap<String, String>>>,
    pub browser_formats: Arc<Mutex<HashMap<String, BrowserFormatCache>>>,
    pub browser_tabs_lock: Arc<Mutex<()>>,
    pub shutting_down: Arc<AtomicBool>,
}

pub fn persist_tasks(app: &AppHandle, downloads: &DownloadManager) -> Result<(), CommandError> {
    let store = app.store(STORE_PATH).map_err(|error| CommandError::manager(error.to_string()))?;
    let tasks = downloads.list().map_err(CommandError::manager)?;
    let value = serde_json::to_value(tasks).map_err(|error| CommandError::manager(error.to_string()))?;
    store.set("downloads", value);
    store.save().map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(())
}

fn load_browser_tabs(app: &AppHandle) -> Result<Vec<BrowserTab>, CommandError> {
    let store = app.store(STORE_PATH).map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(store.get("browserTabs").and_then(|value| serde_json::from_value(value).ok()).unwrap_or_default())
}

fn save_browser_tabs(app: &AppHandle, tabs: &[BrowserTab]) -> Result<(), CommandError> {
    let store = app.store(STORE_PATH).map_err(|error| CommandError::manager(error.to_string()))?;
    let value = serde_json::to_value(tabs).map_err(|error| CommandError::manager(error.to_string()))?;
    store.set("browserTabs", value);
    store.save().map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(())
}

fn upsert_browser_tab(app: &AppHandle, state: &AppState, tab: BrowserTab, activate: bool) -> Result<Vec<BrowserTab>, CommandError> {
    let _guard = state.browser_tabs_lock.lock().map_err(|_| CommandError::manager("browser tab storage is unavailable"))?;
    let mut tabs = load_browser_tabs(app)?;
    if activate {
        for existing in &mut tabs { existing.active = false; }
    }
    if let Some(existing) = tabs.iter_mut().find(|existing| existing.label == tab.label) {
        existing.url = tab.url;
        existing.title = tab.title;
        existing.active = activate || existing.active;
    } else if tabs.len() < 8 {
        tabs.push(BrowserTab { active: activate, ..tab });
    } else {
        return Err(CommandError::manager("the saved browser session already contains eight tabs"));
    }
    save_browser_tabs(app, &tabs)?;
    Ok(tabs)
}

fn remove_browser_tab_record(app: &AppHandle, tabs_lock: &Arc<Mutex<()>>, label: &str) -> Result<Vec<BrowserTab>, CommandError> {
    let _guard = tabs_lock.lock().map_err(|_| CommandError::manager("browser tab storage is unavailable"))?;
    let mut tabs = load_browser_tabs(app)?;
    let was_active = tabs.iter().any(|tab| tab.label == label && tab.active);
    tabs.retain(|tab| tab.label != label);
    if was_active {
        if let Some(next) = tabs.first_mut() { next.active = true; }
    }
    save_browser_tabs(app, &tabs)?;
    Ok(tabs)
}

fn activate_browser_tab_record(app: &AppHandle, state: &AppState, label: &str) -> Result<Vec<BrowserTab>, CommandError> {
    let _guard = state.browser_tabs_lock.lock().map_err(|_| CommandError::manager("browser tab storage is unavailable"))?;
    let mut tabs = load_browser_tabs(app)?;
    if !tabs.iter().any(|tab| tab.label == label) {
        return Err(CommandError::validation("browser tab was not found"));
    }
    for tab in &mut tabs { tab.active = tab.label == label; }
    save_browser_tabs(app, &tabs)?;
    Ok(tabs)
}

fn validate_url(url: &str) -> Result<(), CommandError> {
    let trimmed = url.trim();
    let allowed = trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("magnet:");
    if !allowed || trimmed.len() > 8192 || trimmed.chars().any(char::is_control) || trimmed.starts_with("javascript:") || trimmed.starts_with("file:") {
        return Err(CommandError::validation("unsupported or unsafe download URL"));
    }
    Ok(())
}

fn validate_download_dir(path: &str) -> Result<PathBuf, CommandError> {
    let directory = parse_download_dir(path)?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| CommandError::manager(format!("cannot prepare download directory: {error}")))?;
    Ok(directory)
}

fn parse_browser_url(raw_url: &str) -> Result<Url, CommandError> {
    let url = Url::parse(raw_url.trim()).map_err(|_| CommandError::validation("enter a valid http(s) browser URL"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || raw_url.len() > 8192 {
        return Err(CommandError::validation("browser windows only support http(s) URLs"));
    }
    Ok(url)
}

fn is_browser_window_label(label: &str) -> bool {
    (1..=8).any(|slot| label == format!("nexus-browser-{slot}"))
}

fn is_browser_tab_label(label: &str) -> bool {
    is_browser_window_label(label) || (label.starts_with("nexus-tab-") && label.len() <= 64 && label[10..].chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

fn reveal_browser_window(window: &WebviewWindow) -> Result<(), CommandError> {
    if window.is_minimized().map_err(|error| CommandError::manager(error.to_string()))? {
        window.unminimize().map_err(|error| CommandError::manager(error.to_string()))?;
    }
    window.show().map_err(|error| CommandError::manager(error.to_string()))?;
    window.set_focus().map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(())
}

fn create_browser_window(
    app: &AppHandle,
    state: &AppState,
    raw_url: &str,
    requested_label: Option<&str>,
    record_label: Option<&str>,
    activate: bool,
) -> Result<BrowserTab, CommandError> {
    let browser_url = parse_browser_url(raw_url)?;
    let label = {
        let mut sessions = state.browser_sessions.lock().map_err(|_| CommandError::manager("browser session registry is unavailable"))?;
        let candidate = if let Some(requested) = requested_label {
            if !is_browser_window_label(requested) || sessions.contains_key(requested) {
                return Err(CommandError::validation("requested browser tab label is invalid or already open"));
            }
            requested.to_string()
        } else {
            if sessions.contains_key(BROWSER_WINDOW_LABEL) {
                return Err(CommandError::manager("the browser window is already open"));
            }
            BROWSER_WINDOW_LABEL.to_string()
        };
        let token = Uuid::new_v4().to_string();
        sessions.insert(candidate.clone(), token);
        candidate
    };
    let token = state.browser_sessions.lock().ok().and_then(|sessions| sessions.get(&label).cloned()).ok_or_else(|| CommandError::manager("browser session token was not registered"))?;
    let token_literal = serde_json::to_string(&token).map_err(|error| CommandError::manager(error.to_string()))?;
    let initialization_script = include_str!("browser_injection.js").replace("__NEXUS_SESSION_TOKEN__", &token_literal);
    let sessions = state.browser_sessions.clone();
    let formats = state.browser_formats.clone();
    let shutting_down = state.shutting_down.clone();
    let event_app = app.clone();
    let event_label = label.clone();
    let built = WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::External(browser_url.clone()))
        .title("LEVEL UP NEXUS — Browser")
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 560.0)
        .visible(activate)
        .resizable(true)
        .center()
        .theme(Some(tauri::Theme::Dark))
        .initialization_script(initialization_script)
        .on_navigation(|destination| matches!(destination.scheme(), "http" | "https"))
        .build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            if let Ok(mut sessions) = state.browser_sessions.lock() { sessions.remove(&label); }
            return Err(CommandError::manager(format!("cannot open browser tab: {error}")));
        }
    };
    let title = browser_url.host_str().unwrap_or("Browser").to_string();
    let tab = BrowserTab { label: record_label.unwrap_or(&label).to_string(), url: browser_url.to_string(), title, active: activate };
    if let Err(error) = upsert_browser_tab(app, state, tab.clone(), activate) {
        let _ = window.close();
        if let Ok(mut sessions) = state.browser_sessions.lock() { sessions.remove(&label); }
        return Err(error);
    }
    if activate {
        let _ = reveal_browser_window(&window);
    }
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) && !shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
            if let Some(main) = event_app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut sessions) = sessions.lock() { sessions.remove(&event_label); }
            if let Ok(mut cached) = formats.lock() { cached.remove(&event_label); }
            let _ = event_app.emit("browser://closed", &event_label);
        }
    });
    let _ = app.emit("browser://tab-updated", &tab);
    Ok(tab)
}

fn create_browser_tab_in_window(
    app: &AppHandle,
    state: &AppState,
    window: &WebviewWindow,
    raw_url: &str,
) -> Result<BrowserTab, CommandError> {
    let browser_url = parse_browser_url(raw_url)?;
    if load_browser_tabs(app)?.len() >= 8 {
        return Err(CommandError::manager("close an existing browser tab before opening another"));
    }
    let tab = BrowserTab {
        label: format!("nexus-tab-{}", Uuid::new_v4().simple()),
        url: browser_url.to_string(),
        title: browser_url.host_str().unwrap_or("Browser").to_string(),
        active: true,
    };
    window.navigate(browser_url).map_err(|error| CommandError::manager(format!("cannot navigate browser tab: {error}")))?;
    reveal_browser_window(window)?;
    upsert_browser_tab(app, state, tab.clone(), true)?;
    let _ = app.emit("browser://tab-updated", &tab);
    Ok(tab)
}

#[tauri::command]
pub async fn open_browser_window(app: AppHandle, state: State<'_, AppState>, url: String) -> Result<String, CommandError> {
    let tab = if let Some(window) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        create_browser_tab_in_window(&app, &state, &window, &url)?
    } else {
        create_browser_window(&app, &state, &url, Some(BROWSER_WINDOW_LABEL), None, true)?
    };
    Ok(tab.label)
}

#[tauri::command]
pub fn list_browser_tabs(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<BrowserTab>, CommandError> {
    let _guard = state.browser_tabs_lock.lock().map_err(|_| CommandError::manager("browser tab storage is unavailable"))?;
    load_browser_tabs(&app)
}

#[tauri::command]
pub fn restore_browser_tabs(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<BrowserTab>, CommandError> {
    let saved = {
        let _guard = state.browser_tabs_lock.lock().map_err(|_| CommandError::manager("browser tab storage is unavailable"))?;
        let mut tabs = load_browser_tabs(&app)?;
        let mut active_found = false;
        for tab in &mut tabs {
            if tab.active {
                if active_found { tab.active = false; } else { active_found = true; }
            }
        }
        if !active_found { if let Some(first) = tabs.first_mut() { first.active = true; } }
        save_browser_tabs(&app, &tabs)?;
        tabs
    };
    if app.get_webview_window(BROWSER_WINDOW_LABEL).is_none() {
        if let Some(active) = saved.iter().find(|tab| tab.active) {
            create_browser_window(&app, &state, &active.url, Some(BROWSER_WINDOW_LABEL), Some(&active.label), true)?;
        }
    }
    Ok(saved)
}

#[tauri::command]
pub fn focus_browser_tab(app: AppHandle, state: State<'_, AppState>, label: String) -> Result<bool, CommandError> {
    if !is_browser_tab_label(&label) { return Err(CommandError::validation("invalid browser tab label")); }
    let tab = load_browser_tabs(&app)?.into_iter().find(|tab| tab.label == label).ok_or_else(|| CommandError::validation("browser tab was not found"))?;
    let tabs = if let Some(window) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        window.navigate(parse_browser_url(&tab.url)?).map_err(|error| CommandError::manager(format!("cannot switch browser tab: {error}")))?;
        reveal_browser_window(&window)?;
        activate_browser_tab_record(&app, &state, &label)?
    } else {
        create_browser_window(&app, &state, &tab.url, Some(BROWSER_WINDOW_LABEL), Some(&label), true)?;
        load_browser_tabs(&app)?
    };
    if let Some(tab) = tabs.iter().find(|tab| tab.label == label) { let _ = app.emit("browser://tab-updated", tab); }
    Ok(true)
}

#[tauri::command]
pub fn close_browser_tab(app: AppHandle, state: State<'_, AppState>, label: String) -> Result<bool, CommandError> {
    if !is_browser_tab_label(&label) { return Err(CommandError::validation("invalid browser tab label")); }
    let was_active = load_browser_tabs(&app)?.iter().any(|tab| tab.label == label && tab.active);
    let tabs = remove_browser_tab_record(&app, &state.browser_tabs_lock, &label)?;
    if let Some(window) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        if was_active {
            if let Some(active) = tabs.iter().find(|tab| tab.active) {
                window.navigate(parse_browser_url(&active.url)?).map_err(|error| CommandError::manager(format!("cannot switch browser tab: {error}")))?;
                let _ = reveal_browser_window(&window);
                let _ = app.emit("browser://tab-updated", active);
            } else {
                window.close().map_err(|error| CommandError::manager(error.to_string()))?;
            }
        }
    }
    let _ = app.emit("browser://tab-closed", &label);
    Ok(true)
}

#[tauri::command]
pub fn browser_list_tabs(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    session_token: String,
) -> Result<Vec<BrowserTab>, CommandError> {
    validate_browser_session(&window, &state, &session_token)?;
    let _guard = state.browser_tabs_lock.lock().map_err(|_| CommandError::manager("browser tab storage is unavailable"))?;
    load_browser_tabs(&app)
}

#[tauri::command]
pub fn browser_open_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    url: String,
    session_token: String,
) -> Result<BrowserTab, CommandError> {
    validate_browser_session(&window, &state, &session_token)?;
    create_browser_tab_in_window(&app, &state, &window, &url)
}

#[tauri::command]
pub fn browser_switch_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    label: String,
    session_token: String,
) -> Result<bool, CommandError> {
    validate_browser_session(&window, &state, &session_token)?;
    if !is_browser_tab_label(&label) {
        return Err(CommandError::validation("invalid browser tab label"));
    }
    let tab = load_browser_tabs(&app)?.into_iter().find(|tab| tab.label == label).ok_or_else(|| CommandError::validation("browser tab was not found"))?;
    window.navigate(parse_browser_url(&tab.url)?).map_err(|error| CommandError::manager(format!("cannot switch browser tab: {error}")))?;
    reveal_browser_window(&window)?;
    let tabs = activate_browser_tab_record(&app, &state, &label)?;
    if let Some(tab) = tabs.iter().find(|tab| tab.label == label) {
        let _ = app.emit("browser://tab-updated", tab);
    }
    Ok(true)
}

fn validate_browser_session(window: &WebviewWindow, state: &AppState, session_token: &str) -> Result<(String, Url), CommandError> {
    let label = window.label().to_string();
    if !is_browser_window_label(&label) {
        return Err(CommandError::validation("command is only available from a NEXUS browser tab"));
    }
    let session_matches = state.browser_sessions.lock()
        .map_err(|_| CommandError::manager("browser session registry is unavailable"))?
        .get(&label)
        .is_some_and(|active_token| active_token == session_token);
    if !session_matches { return Err(CommandError::validation("browser session is no longer valid")); }
    let current_url = window.url().map_err(|error| CommandError::manager(error.to_string()))?;
    Ok((label, current_url))
}

fn validate_browser_request(window: &WebviewWindow, state: &AppState, url: &str, session_token: &str) -> Result<(String, Url), CommandError> {
    let (label, current_url) = validate_browser_session(window, state, session_token)?;
    let requested_url = parse_browser_url(url)?;
    if current_url.as_str() != requested_url.as_str() {
        return Err(CommandError::validation("URL must match the page currently open in this browser tab"));
    }
    Ok((label, requested_url))
}

#[tauri::command]
pub fn browser_save_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    url: String,
    title: String,
    session_token: String,
) -> Result<BrowserTab, CommandError> {
    let (_, current_url) = validate_browser_session(&window, &state, &session_token)?;
    let requested_url = parse_browser_url(&url)?;
    if current_url.origin() != requested_url.origin() {
        return Err(CommandError::validation("saved URL must remain on the current browser origin"));
    }
    if title.len() > 2048 {
        return Err(CommandError::validation("browser tab title is invalid"));
    }
    let title = title.chars().filter(|character| !character.is_control()).take(160).collect::<String>();
    let title = if title.trim().is_empty() { requested_url.host_str().unwrap_or("Browser").to_string() } else { title.trim().to_string() };
    let active = load_browser_tabs(&app)?.into_iter().find(|tab| tab.active).ok_or_else(|| CommandError::manager("active browser tab was not found"))?;
    let tab = BrowserTab { label: active.label, url: requested_url.to_string(), title, active: true };
    upsert_browser_tab(&app, &state, tab.clone(), true)?;
    let _ = app.emit("browser://tab-updated", &tab);
    Ok(tab)
}

fn parse_browser_formats(payload: &[u8]) -> Result<(Vec<BrowserVideoFormat>, HashMap<String, BrowserFormatMeta>), CommandError> {
    let metadata: Value = serde_json::from_slice(payload).map_err(|_| CommandError::manager("yt-dlp returned invalid format metadata"))?;
    let entries = metadata.get("formats").and_then(Value::as_array).ok_or_else(|| CommandError::manager("yt-dlp returned no formats for this page"))?;
    struct Candidate { format: BrowserVideoFormat, meta: BrowserFormatMeta, height: Option<u64>, bitrate: f64 }
    let mut video = Vec::new();
    let mut audio = Vec::new();
    for entry in entries {
        if entry.get("has_drm").and_then(Value::as_bool).unwrap_or(false) { continue; }
        let Some(format_id) = entry.get("format_id").and_then(Value::as_str) else { continue };
        if format_id.is_empty() || format_id.len() > 80 || !format_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) { continue; }
        let vcodec = entry.get("vcodec").and_then(Value::as_str).unwrap_or("none");
        let acodec = entry.get("acodec").and_then(Value::as_str).unwrap_or("none");
        let audio_only = (vcodec == "none" || vcodec.is_empty()) && acodec != "none" && !acodec.is_empty();
        let has_video = vcodec != "none" && !vcodec.is_empty();
        if !audio_only && !has_video { continue; }
        let height = entry.get("height").and_then(Value::as_u64);
        let ext = entry.get("ext").and_then(Value::as_str).unwrap_or("media").chars().take(12).collect::<String>();
        let fps = entry.get("fps").and_then(Value::as_f64);
        let resolution = if audio_only {
            "Audio only".to_string()
        } else if let Some(height) = height {
            format!("{height}p")
        } else {
            entry.get("resolution").and_then(Value::as_str).unwrap_or("Video").chars().take(24).collect()
        };
        let abr = entry.get("abr").and_then(Value::as_f64).map(|rate| format!("{rate:.0} kbps"));
        let frame_label = fps.map(|rate| format!(" · {rate:.0} fps")).unwrap_or_default();
        let label = if audio_only {
            format!("Audio only · {} · {}", abr.unwrap_or_else(|| ext.clone()), ext)
        } else {
            format!("{resolution} · {ext}{frame_label}")
        };
        let filesize = entry.get("filesize").and_then(Value::as_u64)
            .or_else(|| entry.get("filesize_approx").and_then(Value::as_u64));
        let choice = BrowserVideoFormat { format_id: format_id.to_string(), label, ext, resolution, fps, filesize, audio_only };
        let candidate = Candidate {
            format: choice,
            meta: BrowserFormatMeta { audio_only, has_audio: acodec != "none" && !acodec.is_empty() },
            height,
            bitrate: entry.get("tbr").and_then(Value::as_f64).unwrap_or(0.0),
        };
        if audio_only { audio.push(candidate); } else { video.push(candidate); }
    }
    video.sort_by(|a, b| b.height.cmp(&a.height).then_with(|| b.bitrate.partial_cmp(&a.bitrate).unwrap_or(std::cmp::Ordering::Equal)));
    audio.sort_by(|a, b| b.bitrate.partial_cmp(&a.bitrate).unwrap_or(std::cmp::Ordering::Equal));
    let mut selected = Vec::new();
    let mut seen_resolutions = std::collections::HashSet::new();
    for candidate in video {
        let key = candidate.height.map(|height| format!("h{height}")).unwrap_or_else(|| candidate.format.resolution.clone());
        if seen_resolutions.insert(key) { selected.push(candidate); }
        if selected.len() >= 10 { break; }
    }
    selected.extend(audio.into_iter().take(3));
    if selected.is_empty() { return Err(CommandError::manager("yt-dlp found no downloadable video or audio formats")); }
    let mut cache = HashMap::new();
    let choices = selected.into_iter().map(|candidate| {
        cache.insert(candidate.format.format_id.clone(), candidate.meta);
        candidate.format
    }).collect();
    Ok((choices, cache))
}

#[tauri::command]
pub async fn browser_get_video_formats(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    url: String,
    session_token: String,
) -> Result<Vec<BrowserVideoFormat>, CommandError> {
    let (label, requested_url) = validate_browser_request(&window, &state, &url, &session_token)?;
    let command = app.shell().sidecar("yt-dlp")
        .map_err(|error| CommandError::manager(format!("cannot resolve yt-dlp sidecar: {error}")))?;
    let args = ["--dump-single-json", "--no-warnings", "--no-playlist", "--skip-download", "--no-progress", "--no-call-home", requested_url.as_str()];
    let (mut receiver, mut child) = command.args(args).spawn()
        .map_err(|error| CommandError::manager(format!("cannot start yt-dlp format scan: {error}")))?;
    let capture = async {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    if stdout.len().saturating_add(bytes.len()) > 12 * 1024 * 1024 { return Err("yt-dlp format metadata exceeded the safe limit".to_string()); }
                    stdout.extend_from_slice(&bytes);
                }
                CommandEvent::Stderr(bytes) => {
                    if stderr.len() < 64 * 1024 { stderr.extend_from_slice(&bytes[..bytes.len().min(64 * 1024 - stderr.len())]); }
                }
                CommandEvent::Error(error) => {
                    if stderr.len() < 64 * 1024 { stderr.extend_from_slice(error.as_bytes().get(..(64 * 1024 - stderr.len()).min(error.len())).unwrap_or_default()); }
                }
                CommandEvent::Terminated(payload) => { exit_code = payload.code; break; }
                _ => {}
            }
        }
        Ok::<_, String>((stdout, stderr, exit_code))
    };
    let captured = match tokio::time::timeout(Duration::from_secs(45), capture).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => { let _ = child.kill(); return Err(CommandError::manager(error)); }
        Err(_) => { let _ = child.kill(); return Err(CommandError::manager("yt-dlp format scan timed out after 45 seconds")); }
    };
    let (stdout, stderr, exit_code) = captured;
    if exit_code != Some(0) {
        let detail = String::from_utf8_lossy(&stderr).lines().next().unwrap_or("unknown yt-dlp error").chars().take(220).collect::<String>();
        return Err(CommandError::manager(format!("yt-dlp could not inspect video formats: {detail}")));
    }
    let (choices, formats) = parse_browser_formats(&stdout)?;
    let cache = BrowserFormatCache { url: requested_url.to_string(), formats, expires_at: Instant::now() + Duration::from_secs(600) };
    state.browser_formats.lock().map_err(|_| CommandError::manager("browser format cache is unavailable"))?.insert(label, cache);
    Ok(choices)
}

#[tauri::command]
pub async fn browser_start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    url: String,
    format_id: String,
    session_token: String,
) -> Result<DownloadTask, CommandError> {
    let (label, requested_url) = validate_browser_request(&window, &state, &url, &session_token)?;
    if format_id.len() > 80 || !format_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
        return Err(CommandError::validation("invalid yt-dlp format ID"));
    }
    let format = {
        let cache = state.browser_formats.lock().map_err(|_| CommandError::manager("browser format cache is unavailable"))?;
        let cached = cache.get(&label).ok_or_else(|| CommandError::validation("open the quality menu again to refresh available formats"))?;
        if cached.url != requested_url.as_str() || cached.expires_at <= Instant::now() {
            return Err(CommandError::validation("available formats expired; reopen the quality menu to refresh them"));
        }
        cached.formats.get(&format_id).cloned().ok_or_else(|| CommandError::validation("selected format was not returned for this page"))?
    };
    let format_selector = if format.audio_only || format.has_audio {
        format_id
    } else {
        format!("{format_id}+bestaudio/{format_id}")
    };
    let options = DownloadOptions {
        connections: Some(16),
        output_template: None,
        audio_only: Some(false),
        playlist: Some(false),
        quality: Some("best".into()),
        format_selector: Some(format_selector),
    };
    start_download(app, state, requested_url.to_string(), get_default_download_dir()?, Some(options)).await
}

fn parse_download_dir(path: &str) -> Result<PathBuf, CommandError> {
    if path.trim().is_empty() || path.len() > 4096 || path.chars().any(char::is_control) {
        return Err(CommandError::validation("download directory is required"));
    }
    let directory = PathBuf::from(path);
    if !directory.is_absolute() {
        return Err(CommandError::validation("download directory must be absolute"));
    }
    Ok(directory)
}

fn sidecar_name(engine: &EngineType) -> &'static str {
    match engine {
        EngineType::YtDlp => "yt-dlp",
        EngineType::Aria2c => "aria2c",
    }
}

fn sidecar_args(app: &AppHandle, task: &DownloadTask) -> Result<Vec<String>, CommandError> {
    let ffmpeg_dir = if matches!(&task.engine, EngineType::YtDlp) {
        let resource_dir = app.path().resource_dir().map_err(|error| CommandError::manager(error.to_string()))?;
        Some(resource_dir)
    } else {
        None
    };
    sidecar_args_with_ffmpeg_dir(task, ffmpeg_dir.as_deref())
}

fn sidecar_args_with_ffmpeg_dir(task: &DownloadTask, ffmpeg_dir: Option<&std::path::Path>) -> Result<Vec<String>, CommandError> {
    let directory = task.download_dir.to_string_lossy().to_string();
    match task.engine {
        EngineType::YtDlp => {
            let output_template = task.options.output_template.as_deref().unwrap_or("%(title)s.%(ext)s");
            if output_template.trim().is_empty()
                || output_template.len() > 256
                || output_template.contains('/')
                || output_template.contains('\\')
                || output_template.contains("..")
                || output_template.chars().any(char::is_control)
            {
                return Err(CommandError::validation("output template must be a safe file name template"));
            }
            let ffmpeg_dir = ffmpeg_dir
                .ok_or_else(|| CommandError::manager("FFmpeg resource directory is unavailable"))?
                .to_string_lossy()
                .to_string();
            let mut args = vec![
                "--newline".into(),
                "--progress".into(),
                "--progress-delta".into(),
                "0.5".into(),
                "--progress-template".into(),
                "download:%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(playlist_index)s|%(playlist_count)s|%(progress.filename)s".into(),
                "--continue".into(),
                "--ffmpeg-location".into(),
                ffmpeg_dir,
                "-P".into(),
                directory,
                "-o".into(),
                output_template.to_string(),
            ];
            args.push(if task.options.playlist.unwrap_or(false) { "--yes-playlist".into() } else { "--no-playlist".into() });
            if task.options.playlist.unwrap_or(false) {
                args.push("--playlist-items".into());
                args.push(task.playlist_current_index.unwrap_or(1).to_string());
            }
            if let Some(selector) = task.options.format_selector.as_deref() {
                if selector.is_empty() || selector.len() > 180 || !selector.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+' | '/')) {
                    return Err(CommandError::validation("unsafe yt-dlp format selector"));
                }
                args.extend(["-f".into(), selector.to_string()]);
            } else {
                match task.options.quality.as_deref().unwrap_or("best") {
                    "best" => {}
                    "1080p" => args.extend(["-f".into(), "bv*[height<=1080]+ba/b[height<=1080]".into()]),
                    "720p" => args.extend(["-f".into(), "bv*[height<=720]+ba/b[height<=720]".into()]),
                    "480p" => args.extend(["-f".into(), "bv*[height<=480]+ba/b[height<=480]".into()]),
                    "audio-320" => args.extend(["-x".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "320K".into()]),
                    "audio-192" => args.extend(["-x".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "192K".into()]),
                    "audio-128" => args.extend(["-x".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "128K".into()]),
                    _ => return Err(CommandError::validation("unsupported media quality")),
                }
            }
            if task.options.audio_only.unwrap_or(false) && !task.options.quality.as_deref().unwrap_or("best").starts_with("audio-") {
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
    let previous_state = task.state.clone();
    let starting = downloads.transition(&task.task_id, DownloadState::Starting).map_err(CommandError::manager)?;
    if let Err(error) = persist_tasks(&app, &downloads) {
        let _ = downloads.transition(&task.task_id, previous_state);
        return Err(error);
    }
    let args = match sidecar_args(&app, &starting) {
        Ok(args) => args,
        Err(error) => {
            let _ = downloads.transition(&task.task_id, DownloadState::Failed);
            let _ = persist_tasks(&app, &downloads);
            return Err(error);
        }
    };
    let sidecar = sidecar_name(&starting.engine);
    let command = match app.shell().sidecar(sidecar) {
        Ok(command) => command,
        Err(error) => {
            let _ = downloads.transition(&task.task_id, DownloadState::Failed);
            let _ = persist_tasks(&app, &downloads);
            return Err(CommandError::manager(format!("cannot resolve {sidecar} sidecar: {error}")));
        }
    };
    let (mut receiver, child) = match command.args(args).spawn() {
        Ok(result) => result,
        Err(error) => {
            let _ = downloads.transition(&task.task_id, DownloadState::Failed);
            let _ = persist_tasks(&app, &downloads);
            return Err(CommandError::manager(format!("cannot spawn {sidecar} sidecar: {error}")));
        }
    };
    processes.insert(task.task_id.clone(), child).map_err(CommandError::manager)?;
    let started = downloads.transition(&task.task_id, DownloadState::Downloading).map_err(CommandError::manager)?;
    let _ = persist_tasks(&app, &downloads);
    update_taskbar_progress(&app, &downloads);
    let _ = app.emit(events::DOWNLOAD_STARTED, &started);

    let app_handle = app.clone();
    let task_id = task.task_id.clone();
    let task_engine = task.engine.clone();
    let downloads_for_task = downloads.clone();
    let processes_for_task = processes.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_progress_emit = Instant::now() - Duration::from_secs(1);
        let mut stdout_buffer = Vec::new();
        let mut stderr_buffer = Vec::new();
        let mut exit_code: Option<i32> = None;
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    for line in append_output_lines(&mut stdout_buffer, &bytes) {
                        handle_download_output_line(&app_handle, &downloads_for_task, &task_id, &task_engine, "stdout", &line, &mut last_progress_emit);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    for line in append_output_lines(&mut stderr_buffer, &bytes) {
                        handle_download_output_line(&app_handle, &downloads_for_task, &task_id, &task_engine, "stderr", &line, &mut last_progress_emit);
                    }
                }
                CommandEvent::Error(error) => {
                    if let Ok(current) = downloads_for_task.get(&task_id) {
                        if current.options.playlist.unwrap_or(false) {
                            let failed = downloads_for_task.mark_playlist_item_failed(&task_id, error.clone()).ok();
                            let _ = downloads_for_task.transition(&task_id, DownloadState::Failed);
                            let _ = persist_tasks(&app_handle, &downloads_for_task);
                            update_taskbar_progress(&app_handle, &downloads_for_task);
                            let _ = app_handle.emit(events::DOWNLOAD_FAILED, serde_json::json!({ "taskId": task_id, "error": error, "playlistItem": failed.and_then(|task| task.playlist_current_index) }));
                        } else {
                            let _ = downloads_for_task.transition(&task_id, DownloadState::Failed);
                            let _ = persist_tasks(&app_handle, &downloads_for_task);
                            update_taskbar_progress(&app_handle, &downloads_for_task);
                            let _ = app_handle.emit(events::DOWNLOAD_FAILED, serde_json::json!({ "taskId": task_id, "error": error }));
                        }
                    }
                }
                CommandEvent::Terminated(payload) => exit_code = payload.code,
                _ => {}
            }
        }
        for (buffer, stream) in [(&mut stdout_buffer, "stdout"), (&mut stderr_buffer, "stderr")] {
            if !buffer.is_empty() {
                let line = String::from_utf8_lossy(buffer).trim().to_string();
                handle_download_output_line(&app_handle, &downloads_for_task, &task_id, &task_engine, stream, &line, &mut last_progress_emit);
            }
        }
        let _ = processes_for_task.remove(&task_id);
        if let Ok(current) = downloads_for_task.get(&task_id) {
            if current.state == DownloadState::Downloading && exit_code != Some(0) {
                let reason = format!("download engine exited unsuccessfully (code: {:?})", exit_code);
                if current.options.playlist.unwrap_or(false) {
                    let failed = downloads_for_task.mark_playlist_item_failed(&task_id, reason.clone()).ok();
                    let _ = downloads_for_task.transition(&task_id, DownloadState::Failed);
                    let _ = app_handle.emit(events::DOWNLOAD_FAILED, serde_json::json!({ "taskId": task_id, "error": reason, "playlistItem": failed.and_then(|task| task.playlist_current_index) }));
                } else {
                    let _ = downloads_for_task.transition(&task_id, DownloadState::Failed);
                    let _ = app_handle.emit(events::DOWNLOAD_FAILED, serde_json::json!({ "taskId": task_id, "error": reason }));
                }
                let _ = persist_tasks(&app_handle, &downloads_for_task);
                update_taskbar_progress(&app_handle, &downloads_for_task);
            } else if current.state == DownloadState::Downloading {
                if current.options.playlist.unwrap_or(false) {
                    let _ = downloads_for_task.mark_playlist_item_completed(&task_id);
                }
                let next_playlist_index = if current.options.playlist.unwrap_or(false) {
                    match (current.playlist_current_index, current.playlist_total) {
                        (Some(index), Some(total)) if index < total => Some(index + 1),
                        _ => None,
                    }
                } else {
                    None
                };
                if let Some(next_index) = next_playlist_index {
                    if let Ok(queued) = downloads_for_task.transition(&task_id, DownloadState::Queued) {
                        let _ = downloads_for_task.set_playlist_cursor(&task_id, next_index);
                        let queued = downloads_for_task.get(&task_id).unwrap_or(queued);
                        let _ = persist_tasks(&app_handle, &downloads_for_task);
                        if let Err(error) = spawn_task(app_handle.clone(), downloads_for_task.clone(), processes_for_task.clone(), queued) {
                            let _ = app_handle.emit(events::DOWNLOAD_FAILED, serde_json::json!({ "taskId": task_id, "error": error.message }));
                        }
                    }
                } else if let Ok(completed) = downloads_for_task.transition(&task_id, DownloadState::Completed) {
                    let _ = persist_tasks(&app_handle, &downloads_for_task);
                    update_taskbar_progress(&app_handle, &downloads_for_task);
                    let _ = app_handle.emit(events::DOWNLOAD_COMPLETED, completed);
                }
            }
        }
    });

    Ok(started)
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    download_dir: String,
    options: Option<DownloadOptions>,
) -> Result<DownloadTask, CommandError> {
    let url = url.trim().to_string();
    validate_url(&url)?;
    let directory = validate_download_dir(&download_dir)?;
    let options = options.unwrap_or_default();
    let engine = if options.format_selector.is_some() { EngineType::YtDlp } else { crate::download_router::detect_engine(&url).await };
    let task = state.downloads.insert(DownloadTask::queued(url, engine, directory, options))
        .map_err(CommandError::manager)?;
    if let Err(error) = persist_tasks(&app, &state.downloads) {
        let _ = state.downloads.remove(&task.task_id);
        return Err(error);
    }
    let _ = app.emit(events::DOWNLOAD_QUEUED, &task);
    match spawn_task(app.clone(), state.downloads.clone(), state.processes.clone(), task.clone()) {
        Ok(started) => Ok(started),
        Err(error) => {
            if let Ok(current) = state.downloads.get(&task.task_id) {
                if current.state != DownloadState::Failed {
                    let _ = state.downloads.transition(&task.task_id, DownloadState::Failed);
                }
            }
            let _ = state.downloads.set_last_error(&task.task_id, error.message.clone());
            let _ = persist_tasks(&app, &state.downloads);
            update_taskbar_progress(&app, &state.downloads);
            let _ = app.emit(events::DOWNLOAD_FAILED, serde_json::json!({ "taskId": task.task_id, "error": error.message }));
            Err(error)
        }
    }
}

fn parse_progress(engine: &EngineType, line: &str) -> Option<(f64, u64, Option<u64>, u64, Option<u64>, Option<String>, Option<usize>, Option<usize>, DownloadState)> {
    match engine {
        EngineType::YtDlp => parse_yt_dlp_progress(line),
        EngineType::Aria2c => parse_aria2c_progress(line),
    }
}

fn parse_yt_dlp_progress(line: &str) -> Option<(f64, u64, Option<u64>, u64, Option<u64>, Option<String>, Option<usize>, Option<usize>, DownloadState)> {
    let payload = line.strip_prefix("download:")?;
    let fields: Vec<&str> = payload.split('|').collect();
    if fields.len() < 9 { return None; }
    let downloaded = fields[1].parse::<u64>().ok()?;
    let total = parse_optional_u64(fields[2]).or_else(|| parse_optional_u64(fields[3]));
    let progress = total.map(|value| if value == 0 { 0.0 } else { downloaded as f64 * 100.0 / value as f64 }).unwrap_or(0.0);
    let item_progress = if fields[0] == "finished" { 100.0 } else { progress };
    let playlist_index = fields[6].parse::<usize>().ok();
    let playlist_total = fields[7].parse::<usize>().ok();
    let filename = Some(fields[8..].join("|")).filter(|value| !value.is_empty() && *value != "NA");
    Some((item_progress, downloaded, total, parse_rate(fields[4]), parse_eta(fields[5]), filename, playlist_index, playlist_total, if fields[0] == "finished" { DownloadState::Completed } else { DownloadState::Downloading }))
}

fn parse_aria2c_progress(line: &str) -> Option<(f64, u64, Option<u64>, u64, Option<u64>, Option<String>, Option<usize>, Option<usize>, DownloadState)> {
    let percent_end = line.find("%)")?;
    let open = line[..percent_end].rfind('(')?;
    let progress = line[open + 1..percent_end].parse::<f64>().ok()?;
    let byte_pair = line[..open].split_whitespace().last().unwrap_or("");
    let (downloaded, total) = byte_pair.split_once('/')
        .map(|(downloaded, total)| (parse_human_bytes(downloaded), parse_human_bytes(total)))
        .unwrap_or((Some(0), None));
    let speed = line.split("DL:").nth(1).and_then(|value| value.split_whitespace().next()).map(parse_rate).unwrap_or(0);
    let eta = line.split("ETA:").nth(1).and_then(|value| value.split(|character: char| character == ']' || character.is_whitespace()).next()).and_then(parse_eta);
    Some((progress, downloaded.unwrap_or(0), total, speed, eta, None, None, None, DownloadState::Downloading))
}

fn append_output_lines(buffer: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    buffer.extend_from_slice(chunk);
    let mut lines = Vec::new();
    while let Some(index) = buffer.iter().position(|byte| *byte == b'\n' || *byte == b'\r') {
        let mut line: Vec<u8> = buffer.drain(..=index).collect();
        line.pop();
        lines.push(String::from_utf8_lossy(&line).trim().to_string());
    }
    lines
}

fn handle_download_output_line(
    app: &AppHandle,
    downloads: &DownloadManager,
    task_id: &str,
    engine: &EngineType,
    stream: &str,
    line: &str,
    last_progress_emit: &mut Instant,
) {
    if let Some((progress, downloaded, total, speed, eta, filename, playlist_index, playlist_total, playlist_state)) = parse_progress(engine, line) {
        if last_progress_emit.elapsed() >= Duration::from_millis(250) || progress >= 100.0 {
            if let Ok(updated) = downloads.update_progress(task_id, progress, downloaded, total, speed, eta, filename, playlist_index, playlist_total, playlist_state) {
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
                    playlist_items: updated.playlist_items,
                    playlist_current_index: updated.playlist_current_index,
                    playlist_total: updated.playlist_total,
                };
                let _ = app.emit(events::DOWNLOAD_PROGRESS, payload);
                let _ = persist_tasks(app, downloads);
                update_taskbar_progress(app, downloads);
                *last_progress_emit = Instant::now();
            }
        }
    } else if !line.is_empty() {
        let _ = app.emit("download://log", serde_json::json!({ "taskId": task_id, "stream": stream, "line": line }));
    }
}

fn update_taskbar_progress(app: &AppHandle, downloads: &DownloadManager) {
    let Some(window) = app.get_webview_window("main") else { return };
    let active = downloads.list().unwrap_or_default().into_iter()
        .filter(|task| task.state == DownloadState::Downloading)
        .collect::<Vec<_>>();
    if active.is_empty() {
        let _ = window.set_progress_bar(ProgressBarState { status: Some(ProgressBarStatus::None), progress: None });
        return;
    }
    let percent = active.iter().map(|task| task.progress.clamp(0.0, 100.0)).sum::<f64>() / active.len() as f64;
    let _ = window.set_progress_bar(ProgressBarState { status: Some(ProgressBarStatus::Normal), progress: Some(percent.round() as u64) });
}

#[tauri::command]
pub async fn read_clipboard_text(app: AppHandle) -> Result<String, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        app.clipboard().read_text().map_err(|error| CommandError::manager(format!("cannot read clipboard: {error}")))
    }).await.map_err(|error| CommandError::manager(format!("clipboard worker failed: {error}")))?
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

fn parse_human_bytes(value: &str) -> Option<u64> {
    let normalized = value.trim().trim_end_matches(')');
    let split_at = normalized.find(|character: char| character.is_ascii_alphabetic()).unwrap_or(normalized.len());
    let number = normalized[..split_at].parse::<f64>().ok()?;
    let unit = normalized[split_at..].to_ascii_lowercase();
    let multiplier = match unit.as_str() {
        "kib" | "ki" => 1024_f64,
        "mib" | "mi" => 1024_f64.powi(2),
        "gib" | "gi" => 1024_f64.powi(3),
        "kb" | "k" => 1000_f64,
        "mb" | "m" => 1000_f64.powi(2),
        "gb" | "g" => 1000_f64.powi(3),
        "b" | "" => 1_f64,
        _ => return None,
    };
    Some((number * multiplier) as u64)
}

fn parse_eta(value: &str) -> Option<u64> {
    if value == "NA" || value == "--" || value.is_empty() { return None; }
    if value.contains('h') || value.contains('m') || value.contains('s') {
        let mut number = String::new();
        let mut total = 0_u64;
        for character in value.chars() {
            if character.is_ascii_digit() {
                number.push(character);
                continue;
            }
            if number.is_empty() { continue; }
            let part = number.parse::<u64>().ok()?;
            total += match character {
                'h' => part * 3600,
                'm' => part * 60,
                's' => part,
                _ => { number.clear(); continue; }
            };
            number.clear();
        }
        return if number.is_empty() { Some(total) } else { None };
    }
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
    let current = state.downloads.get(&task_id).map_err(CommandError::manager)?;
    if current.state != DownloadState::Downloading {
        return Err(CommandError::manager("only active downloads can be paused"));
    }
    state.downloads.transition(&task_id, DownloadState::Paused).map_err(CommandError::manager)?;
    if let Err(error) = state.processes.kill(&task_id) {
        let latest = state.downloads.get(&task_id).map_err(CommandError::manager)?;
        if latest.state == DownloadState::Paused {
            let _ = state.downloads.transition(&task_id, DownloadState::Downloading);
        } else if matches!(latest.state, DownloadState::Completed | DownloadState::Failed) {
            return Ok(latest);
        }
        return Err(CommandError::manager(error));
    }
    let task = state.downloads.get(&task_id).map_err(CommandError::manager)?;
    persist_tasks(&app, &state.downloads)?;
    update_taskbar_progress(&app, &state.downloads);
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
    let current = state.downloads.get(&task_id).map_err(CommandError::manager)?;
    if matches!(current.state, DownloadState::Downloading | DownloadState::Starting) {
        state.downloads.transition(&task_id, DownloadState::Cancelled).map_err(CommandError::manager)?;
        if let Err(error) = state.processes.kill(&task_id) {
            let _ = state.downloads.transition(&task_id, DownloadState::Downloading);
            return Err(CommandError::manager(error));
        }
    } else if current.state == DownloadState::Paused {
        state.downloads.transition(&task_id, DownloadState::Cancelled).map_err(CommandError::manager)?;
    } else if current.state == DownloadState::Queued {
        state.downloads.transition(&task_id, DownloadState::Cancelled).map_err(CommandError::manager)?;
    } else if current.state == DownloadState::Cancelled {
        return Ok(current);
    } else if matches!(current.state, DownloadState::Failed | DownloadState::Completed) {
        return Err(CommandError::manager("download cannot be cancelled in its current state"));
    }
    let task = state.downloads.get(&task_id).map_err(CommandError::manager)?;
    persist_tasks(&app, &state.downloads)?;
    update_taskbar_progress(&app, &state.downloads);
    app.emit(events::DOWNLOAD_CANCELLED, &task).map_err(|error| CommandError::manager(error.to_string()))?;
    Ok(task)
}

#[tauri::command]
pub fn remove_download(app: AppHandle, state: State<'_, AppState>, task_id: String) -> Result<(), CommandError> {
    let current = state.downloads.get(&task_id).map_err(CommandError::manager)?;
    if matches!(current.state, DownloadState::Downloading | DownloadState::Starting) {
        state.downloads.transition(&task_id, DownloadState::Cancelled).map_err(CommandError::manager)?;
        if let Err(error) = state.processes.kill(&task_id) {
            let _ = state.downloads.transition(&task_id, DownloadState::Downloading);
            return Err(CommandError::manager(error));
        }
    } else if current.state == DownloadState::Paused {
        state.downloads.transition(&task_id, DownloadState::Cancelled).map_err(CommandError::manager)?;
    }
    let removed = state.downloads.remove(&task_id).map_err(CommandError::manager)?;
    if let Err(error) = persist_tasks(&app, &state.downloads) {
        let _ = state.downloads.insert(removed);
        return Err(error);
    }
    Ok(())
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
        let mut command = std::process::Command::new("explorer.exe");
        if target.is_dir() {
            command.arg(&target);
        } else {
            command.arg(format!("/select,{}", target.display()));
        }
        command
            .spawn()
            .map_err(|error| CommandError::manager(format!("cannot open file location: {error}")))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    Err(CommandError::manager("file location is currently implemented for Windows x64 only"))
}

#[cfg(test)]
mod tests {
    use super::{append_output_lines, is_browser_tab_label, is_browser_window_label, parse_aria2c_progress, parse_browser_formats, parse_browser_url, parse_human_bytes, parse_rate, parse_yt_dlp_progress, sidecar_args_with_ffmpeg_dir};
    #[cfg(target_os = "windows")]
    use super::parse_download_dir;
    use crate::models::{DownloadOptions, DownloadTask, EngineType};
    use std::path::{Path, PathBuf};

    #[test]
    fn parses_aria2_progress_and_transfer_sizes() {
        let parsed = parse_aria2c_progress("[#abc 1.2MiB/2.4MiB(50%) CN:4 DL:512KiB ETA:00m01s]").unwrap();
        assert_eq!(parsed.0, 50.0);
        assert_eq!(parsed.1, (1.2_f64 * 1024_f64 * 1024_f64) as u64);
        assert_eq!(parsed.2, Some((2.4_f64 * 1024_f64 * 1024_f64) as u64));
        assert_eq!(parsed.3, 512 * 1024);
        assert_eq!(parsed.4, Some(1));
        assert_eq!(parsed.8, super::DownloadState::Downloading);
    }

    #[test]
    fn parses_fragmented_yt_dlp_progress_from_a_carriage_return_stream() {
        let mut buffer = Vec::new();
        assert!(append_output_lines(&mut buffer, b"download:downloading|1024|2048|2048|512KiB|00:00:02|NA|NA|video.mp4").is_empty());
        let lines = append_output_lines(&mut buffer, b"\r");
        assert_eq!(lines.len(), 1);
        let parsed = parse_yt_dlp_progress(&lines[0]).unwrap();
        assert_eq!(parsed.0, 50.0);
        assert_eq!(parsed.1, 1024);
        assert_eq!(parsed.5.as_deref(), Some("video.mp4"));
    }

    #[test]
    fn parses_aria2_progress_delivered_with_a_cr_terminator() {
        let mut buffer = Vec::new();
        let lines = append_output_lines(&mut buffer, b"[#abc 1.2MiB/2.4MiB(50%) CN:4 DL:512KiB ETA:00m01s]\r");
        assert_eq!(parse_aria2c_progress(&lines[0]).unwrap().0, 50.0);
    }

    #[test]
    fn parses_supported_human_byte_units() {
        assert_eq!(parse_human_bytes("1.5GiB"), Some((1.5_f64 * 1024_f64.powi(3)) as u64));
        assert_eq!(parse_human_bytes("2MB"), Some(2_000_000));
        assert_eq!(parse_human_bytes("unknown"), None);
        assert_eq!(parse_rate("512KiB/s"), 512 * 1024);
    }

    #[test]
    fn accepts_virtual_tab_ids_but_not_arbitrary_window_labels() {
        assert!(is_browser_tab_label("nexus-tab-7a1b2c"));
        assert!(is_browser_tab_label("nexus-browser-1"));
        assert!(!is_browser_tab_label("random-window"));
        assert!(!is_browser_window_label("nexus-tab-7a1b2c"));
    }

    #[test]
    fn yt_dlp_receives_the_complete_windows_path_as_one_argument() {
        let expected = r"C:\Users\Tarik\Downloads\Nexus";
        let task = DownloadTask::queued(
            "https://www.youtube.com/watch?v=test".into(),
            EngineType::YtDlp,
            PathBuf::from(expected),
            DownloadOptions::default(),
        );
        let args = sidecar_args_with_ffmpeg_dir(&task, Some(Path::new(r"C:\Nexus\binaries"))).unwrap();
        let path_index = args.iter().position(|argument| argument.as_str() == "-P").unwrap();
        assert_eq!(args[path_index + 1], expected);
        assert_eq!(args.last().map(String::as_str), Some("https://www.youtube.com/watch?v=test"));
    }

    #[test]
    fn aria2_receives_the_complete_windows_path_as_one_argument() {
        let expected = r"C:\Users\Tarik\Downloads\Nexus";
        let task = DownloadTask::queued(
            "https://cdn.example.test/archive.zip".into(),
            EngineType::Aria2c,
            PathBuf::from(expected),
            DownloadOptions::default(),
        );
        let args = sidecar_args_with_ffmpeg_dir(&task, None).unwrap();
        let path_index = args.iter().position(|argument| argument.as_str() == "--dir").unwrap();
        assert_eq!(args[path_index + 1], expected);
        assert_eq!(args.last().map(String::as_str), Some("https://cdn.example.test/archive.zip"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn accepts_absolute_windows_path_and_rejects_reversed_relative_path() {
        let valid = r"C:\Users\Tarik\Downloads\Nexus";
        assert_eq!(parse_download_dir(valid).unwrap().to_string_lossy(), valid);
        assert!(parse_download_dir(r"Downloads\Nexus\C:\Users\Tarik").is_err());
    }

    #[test]
    fn browser_urls_accept_only_http_and_https() {
        assert_eq!(parse_browser_url("https://www.youtube.com/watch?v=test").unwrap().scheme(), "https");
        assert!(parse_browser_url("file:///C:/Windows/win.ini").is_err());
        assert!(parse_browser_url("javascript:alert(1)").is_err());
        assert!(parse_browser_url("https://").is_err());
    }

    #[test]
    fn browser_window_labels_are_limited_to_eight_slots() {
        assert!(is_browser_window_label("nexus-browser-1"));
        assert!(is_browser_window_label("nexus-browser-8"));
        assert!(!is_browser_window_label("nexus-browser-9"));
        assert!(!is_browser_window_label("main"));
    }

    #[test]
    fn parses_real_ytdlp_formats_without_exposing_media_urls() {
        let payload = br#"{"formats":[
          {"format_id":"137","ext":"mp4","height":1080,"fps":60,"vcodec":"avc1","acodec":"none","filesize":104857600,"tbr":4000,"url":"https://signed.example/video"},
          {"format_id":"18","ext":"mp4","height":360,"vcodec":"avc1","acodec":"mp4a","filesize_approx":20971520,"tbr":500},
          {"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a","abr":128,"tbr":128},
          {"format_id":"unsafe/id","ext":"mp4","height":720,"vcodec":"avc1","acodec":"none"},
          {"format_id":"drm","ext":"mp4","height":2160,"vcodec":"avc1","acodec":"none","has_drm":true}
        ]}"#;
        let (formats, cache) = parse_browser_formats(payload).unwrap();
        assert_eq!(formats.len(), 3);
        assert_eq!(formats[0].format_id, "137");
        assert_eq!(formats[0].resolution, "1080p");
        assert!(!cache["137"].has_audio);
        assert!(formats.iter().any(|format| format.format_id == "140" && format.audio_only));
        assert!(formats.iter().all(|format| !format.label.contains("signed.example")));
    }

    #[test]
    fn yt_dlp_uses_the_validated_format_selector_as_one_argument() {
        let mut options = DownloadOptions::default();
        options.format_selector = Some("137+bestaudio/137".into());
        let task = DownloadTask::queued(
            "https://www.youtube.com/watch?v=test".into(),
            EngineType::YtDlp,
            PathBuf::from(r"C:\Nexus"),
            options,
        );
        let args = sidecar_args_with_ffmpeg_dir(&task, Some(Path::new(r"C:\Nexus\binaries"))).unwrap();
        let format_index = args.iter().position(|argument| argument.as_str() == "-f").unwrap();
        assert_eq!(args[format_index + 1], "137+bestaudio/137");
    }
}
