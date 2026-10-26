use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;

#[derive(Clone, Default)]
pub struct ProcessManager {
    children: Arc<Mutex<HashMap<String, CommandChild>>>,
}

impl ProcessManager {
    pub fn insert(&self, task_id: String, child: CommandChild) -> Result<(), String> {
        let mut children = self.children.lock().map_err(|_| "process manager lock poisoned".to_string())?;
        if children.contains_key(&task_id) {
            return Err("a process is already registered for this task".to_string());
        }
        children.insert(task_id, child);
        Ok(())
    }

    pub fn kill(&self, task_id: &str) -> Result<(), String> {
        let mut children = self.children.lock().map_err(|_| "process manager lock poisoned".to_string())?;
        let child = children.get_mut(task_id).ok_or_else(|| "process not found".to_string())?;
        child.kill().map_err(|error| error.to_string())
    }

    pub fn remove(&self, task_id: &str) -> Result<(), String> {
        let mut children = self.children.lock().map_err(|_| "process manager lock poisoned".to_string())?;
        children.remove(task_id);
        Ok(())
    }
}
