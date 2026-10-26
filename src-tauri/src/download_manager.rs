use crate::models::{DownloadState, DownloadTask, PlaylistItemProgress};
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

    pub fn set_playlist_cursor(&self, task_id: &str, index: usize) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        let task = tasks.get_mut(task_id).ok_or_else(|| "task not found".to_string())?;
        task.playlist_current_index = Some(index);
        task.updated_at = format!("{:?}", std::time::SystemTime::now());
        Ok(task.clone())
    }

    pub fn mark_playlist_item_failed(&self, task_id: &str, error: String) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        let task = tasks.get_mut(task_id).ok_or_else(|| "task not found".to_string())?;
        if let Some(index) = task.playlist_current_index {
            if let Some(item) = task.playlist_items.iter_mut().find(|item| item.index == index) {
                item.state = DownloadState::Failed;
                item.speed_bytes_per_second = 0;
                item.eta_seconds = None;
            }
        }
        task.last_error = Some(error);
        task.updated_at = format!("{:?}", std::time::SystemTime::now());
        Ok(task.clone())
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
                | (DownloadState::Downloading, DownloadState::Queued)
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
        playlist_index: Option<usize>,
        playlist_total: Option<usize>,
        playlist_state: DownloadState,
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
        if let Some(index) = playlist_index {
            task.playlist_current_index = Some(index);
            task.playlist_total = playlist_total;
            let item = task.playlist_items.iter_mut().find(|item| item.index == index);
            if let Some(item) = item {
                item.total = playlist_total;
                item.title = task.filename.clone().unwrap_or_else(|| format!("Item {index}"));
                item.progress = task.progress;
                item.downloaded_bytes = downloaded_bytes;
                item.total_bytes = total_bytes;
                item.speed_bytes_per_second = speed_bytes_per_second;
                item.eta_seconds = eta_seconds;
                item.state = playlist_state;
            } else {
                task.playlist_items.push(PlaylistItemProgress {
                    index,
                    total: playlist_total,
                    title: task.filename.clone().unwrap_or_else(|| format!("Item {index}")),
                    progress: task.progress,
                    downloaded_bytes,
                    total_bytes,
                    speed_bytes_per_second,
                    eta_seconds,
                    state: playlist_state,
                });
                task.playlist_items.sort_by_key(|item| item.index);
            }
        }
        task.updated_at = format!("{:?}", std::time::SystemTime::now());
        Ok(task.clone())
    }
}
