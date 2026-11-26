use reoo_core::TextBuffer;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabMeta {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub dirty: bool,
    pub language: String,
}

pub struct BufferEntry {
    pub meta: TabMeta,
    pub buffer: TextBuffer,
}

pub struct AppState {
    pub buffers: Mutex<HashMap<String, BufferEntry>>,
    pub tab_order: Mutex<Vec<String>>,
    pub workspace_root: Mutex<Option<String>>,
    pub theme: Mutex<String>,
    pub locale: Mutex<String>,
    pub accent: Mutex<String>,
    pub startup_mode: Mutex<String>,
    pub word_wrap: Mutex<bool>,
    pub font_size: Mutex<u32>,
    pub font_family: Mutex<String>,
    pub preloaded: Mutex<bool>,
    next_id: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            buffers: Mutex::new(HashMap::new()),
            tab_order: Mutex::new(Vec::new()),
            workspace_root: Mutex::new(None),
            theme: Mutex::new("system".to_string()),
            locale: Mutex::new("zh".to_string()),
            accent: Mutex::new("blue".to_string()),
            startup_mode: Mutex::new("new_session".to_string()),
            word_wrap: Mutex::new(true),
            font_size: Mutex::new(14),
            font_family: Mutex::new("default".to_string()),
            preloaded: Mutex::new(false),
            next_id: AtomicU64::new(1),
        }
    }
}

impl AppState {
    pub fn gen_id(&self) -> String {
        let n = self.next_id.fetch_add(1, Ordering::Relaxed);
        format!("buf-{n}")
    }
}
