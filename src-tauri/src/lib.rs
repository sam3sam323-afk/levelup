mod commands;
mod download_manager;
mod engine_manager;
mod events;
mod models;
mod process_manager;

use commands::{
    cancel_download, get_default_download_dir, get_download, get_engine_status, get_system_drives, list_downloads,
    open_file_location, pause_download, resume_download, start_download, AppState,
};
use download_manager::DownloadManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            downloads: DownloadManager::default(),
            processes: process_manager::ProcessManager::default(),
        })
        .invoke_handler(tauri::generate_handler![
            start_download,
            pause_download,
            resume_download,
            cancel_download,
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
