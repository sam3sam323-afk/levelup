mod commands;
mod download_manager;
mod download_router;
mod engine_manager;
mod events;
mod models;
mod process_manager;

use commands::{
    cancel_download, get_default_download_dir, get_download, get_engine_status, get_system_drives, list_downloads, remove_download,
    open_file_location, open_browser_window, browser_start_download, browser_get_video_formats, browser_save_tab,
    list_browser_tabs, restore_browser_tabs, focus_browser_tab, close_browser_tab,
    browser_list_tabs, browser_open_tab, browser_switch_tab,
    pause_download, resume_download, start_download, AppState,
};
use download_manager::DownloadManager;
use models::DownloadTask;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState {
            downloads: DownloadManager::default(),
            processes: process_manager::ProcessManager::default(),
            browser_sessions: Arc::new(Mutex::new(HashMap::new())),
            browser_formats: Arc::new(Mutex::new(HashMap::new())),
            browser_tabs_lock: Arc::new(Mutex::new(())),
            shutting_down: Arc::new(AtomicBool::new(false)),
        })
        .setup(|app| {
            let store = app.store("level-up-nexus.json")?;
            if let Some(value) = store.get("downloads") {
                if let Ok(tasks) = serde_json::from_value::<Vec<DownloadTask>>(value) {
                    let downloads = &app.state::<AppState>().downloads;
                    downloads.restore(tasks).map_err(std::io::Error::other)?;
                    let restored = serde_json::to_value(downloads.list().map_err(std::io::Error::other)?)?;
                    store.set("downloads", restored);
                    store.save()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            remove_download,
            get_download,
            list_downloads,
            get_default_download_dir,
            get_engine_status,
            get_system_drives,
            open_file_location,
            open_browser_window,
            list_browser_tabs,
            restore_browser_tabs,
            focus_browser_tab,
            close_browser_tab,
            browser_save_tab,
            browser_get_video_formats,
            browser_start_download,
            browser_list_tabs,
            browser_open_tab,
            browser_switch_tab,
        ])
        .build(tauri::generate_context!())
        .expect("error while building LEVEL UP NEXUS")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app_handle.state::<AppState>().shutting_down.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        });
}
