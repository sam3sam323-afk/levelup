use crate::models::{DownloadState, DownloadTask, PlaylistItemProgress};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct DownloadManager {
    tasks: Arc<Mutex<HashMap<String, DownloadTask>>>,
}

impl DownloadManager {
    pub fn restore(&self, mut restored: Vec<DownloadTask>) -> Result<Vec<DownloadTask>, String> {
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
        let mut values: Vec<_> = tasks.values().cloned().collect();
        values.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.task_id.cmp(&b.task_id)));
        Ok(values)
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
        let mut values: Vec<_> = tasks.values().cloned().collect();
        values.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.task_id.cmp(&b.task_id)));
        Ok(values)
    }

    pub fn remove(&self, task_id: &str) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        tasks.remove(task_id).ok_or_else(|| "task not found".to_string())
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

    pub fn mark_playlist_item_completed(&self, task_id: &str) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        let task = tasks.get_mut(task_id).ok_or_else(|| "task not found".to_string())?;
        if let Some(index) = task.playlist_current_index {
            if let Some(item) = task.playlist_items.iter_mut().find(|item| item.index == index) {
                item.progress = 100.0;
                item.state = DownloadState::Completed;
                item.speed_bytes_per_second = 0;
                item.eta_seconds = None;
            }
        }
        task.updated_at = format!("{:?}", std::time::SystemTime::now());
        Ok(task.clone())
    }

    pub fn transition(&self, task_id: &str, next: DownloadState) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock().map_err(|_| "download manager lock poisoned".to_string())?;
        let task = tasks.get_mut(task_id).ok_or_else(|| "task not found".to_string())?;
        let allowed = matches!(
            (&task.state, &next),
            (DownloadState::Queued, DownloadState::Starting)
                | (DownloadState::Queued, DownloadState::Cancelled)
                | (DownloadState::Starting, DownloadState::Downloading)
                | (DownloadState::Starting, DownloadState::Queued)
                | (DownloadState::Starting, DownloadState::Paused)
                | (DownloadState::Downloading, DownloadState::Paused)
                | (DownloadState::Paused, DownloadState::Downloading)
                | (DownloadState::Paused, DownloadState::Starting)
                | (DownloadState::Downloading, DownloadState::Queued)
                | (DownloadState::Downloading, DownloadState::Completed)
                | (DownloadState::Downloading, DownloadState::Cancelled)
                | (DownloadState::Paused, DownloadState::Cancelled)
                | (DownloadState::Starting, DownloadState::Cancelled)
                | (DownloadState::Cancelled, DownloadState::Downloading)
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

#[cfg(test)]
mod tests {
    use super::DownloadManager;
    use crate::models::{DownloadOptions, DownloadState, DownloadTask, EngineType};
    use std::path::PathBuf;

    #[test]
    fn restore_converts_interrupted_tasks_to_paused_and_lists_deterministically() {
        let mut task = DownloadTask::queued(
            "https://example.com/video".into(),
            EngineType::YtDlp,
            PathBuf::from("/tmp/downloads"),
            DownloadOptions::default(),
        );
        task.state = DownloadState::Downloading;
        task.speed_bytes_per_second = 100;
        task.eta_seconds = Some(10);
        let manager = DownloadManager::default();
        let restored = manager.restore(vec![task]).unwrap();
        assert_eq!(restored.len(), 1);
        assert!(matches!(restored[0].state, DownloadState::Paused));
        assert_eq!(restored[0].speed_bytes_per_second, 0);
        assert_eq!(restored[0].eta_seconds, None);
        assert_eq!(manager.list().unwrap()[0].task_id, restored[0].task_id);
    }

    #[test]
    fn remove_deletes_task_from_list() {
        let manager = DownloadManager::default();
        let task = DownloadTask::queued(
            "https://example.com/file.zip".into(),
            EngineType::Aria2c,
            PathBuf::from("/tmp/downloads"),
            DownloadOptions::default(),
        );
        let task = manager.insert(task).unwrap();
        manager.remove(&task.task_id).unwrap();
        assert!(manager.get(&task.task_id).is_err());
        assert!(manager.list().unwrap().is_empty());
    }
}
