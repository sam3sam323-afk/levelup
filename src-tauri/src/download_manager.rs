use crate::models::{DownloadState, DownloadTask};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct DownloadManager {
    tasks: Arc<Mutex<HashMap<String, DownloadTask>>>,
}

impl DownloadManager {
    pub fn restore(&self, mut restored: Vec<DownloadTask>) -> Result<(), String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        for task in &mut restored {
            if matches!(task.state, DownloadState::Starting | DownloadState::Downloading) {
                task.state = DownloadState::Paused;
                task.speed_bytes_per_second = 0;
                task.eta_seconds = None;
                task.last_error = Some("Paused because the application was closed".to_string());
            }
        }
        tasks.extend(restored.into_iter().map(|task| (task.task_id.clone(), task)));
        Ok(())
    }

    pub fn insert(&self, task: DownloadTask) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        if tasks.contains_key(&task.task_id) {
            return Err("task id already exists".to_string());
        }
        tasks.insert(task.task_id.clone(), task.clone());
        Ok(task)
    }

    pub fn list(&self) -> Result<Vec<DownloadTask>, String> {
        let tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        Ok(tasks.values().cloned().collect())
    }

    pub fn get(&self, task_id: &str) -> Result<DownloadTask, String> {
        let tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        tasks.get(task_id).cloned().ok_or_else(|| "task not found".to_string())
    }

    pub fn transition(&self, task_id: &str, next: DownloadState) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        let task = tasks.get_mut(task_id).ok_or_else(|| "task not found".to_string())?;
        let allowed = matches!(
            (&task.state, &next),
            (DownloadState::Queued, DownloadState::Starting)
                | (DownloadState::Starting, DownloadState::Downloading)
                | (DownloadState::Downloading, DownloadState::Paused)
                | (DownloadState::Paused, DownloadState::Starting)
                | (DownloadState::Paused, DownloadState::Downloading)
                | (DownloadState::Downloading, DownloadState::Completed)
                | (DownloadState::Downloading, DownloadState::Cancelled)
                | (DownloadState::Paused, DownloadState::Cancelled)
                | (DownloadState::Starting, DownloadState::Failed)
                | (DownloadState::Downloading, DownloadState::Failed)
                | (DownloadState::Paused, DownloadState::Failed)
        );
        if !allowed {
            return Err(format!("invalid state transition: {:?} -> {:?}", task.state, next));
        }
        task.state = next;
        task.updated_at = format!("{:?}", std::time::SystemTime::now());
        Ok(task.clone())
    }

    pub fn update_progress(
        &self,
        task_id: &str,
        progress: f64,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
        speed_bytes_per_second: u64,
        eta_seconds: Option<u64>,
        filename: Option<String>,
    ) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        let task = tasks.get_mut(task_id).ok_or_else(|| "task not found".to_string())?;
        task.progress = progress.clamp(0.0, 100.0);
        task.downloaded_bytes = downloaded_bytes;
        task.total_bytes = total_bytes;
        task.speed_bytes_per_second = speed_bytes_per_second;
        task.eta_seconds = eta_seconds;
        if filename.is_some() {
            task.filename = filename;
        }
        task.updated_at = format!("{:?}", std::time::SystemTime::now());
        Ok(task.clone())
    }
}
