#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Keep the native entrypoint small; process orchestration lives in lib.rs
    // and commands.rs so the Sidecar lifecycle remains testable and isolated.
    level_up_nexus_lib::run();
}
