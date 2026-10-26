mod commands;
mod download_manager;
mod engine_manager;
mod events;
mod models;
mod process_manager;

use commands::{
    cancel_download, get_default_download_dir, get_download, get_engine_status, get_system_drives, list_downloads, remove_download,
    open_file_location, pause_download, resume_download, start_download, AppState,
};
use download_manager::DownloadManager;
use models::DownloadTask;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running LEVEL UP NEXUS");
}
