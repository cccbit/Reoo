use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotExitTab {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub content: String,
    pub dirty: bool,
    pub language: String,
    pub cursor_line: usize,
    pub cursor_col: usize,
}

fn default_locale() -> String {
    "zh".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_accent() -> String {
    "blue".to_string()
}

fn default_startup_mode() -> String {
    "new_session".to_string()
}

fn default_word_wrap() -> bool {
    true
}

fn default_font_size() -> u32 {
    14
}

fn default_font_family() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionSnapshot {
    pub workspace_root: Option<String>,
    pub active_tab_id: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default = "default_accent")]
    pub accent: String,
    #[serde(default = "default_startup_mode")]
    pub startup_mode: String,
    #[serde(default = "default_word_wrap")]
    pub word_wrap: bool,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    pub tabs: Vec<HotExitTab>,
}

/// 按需懒加载单层目录内容（目录排在前面，按名称排序）
pub fn list_directory(dir: &Path) -> Result<Vec<FileNode>, String> {
    let read_dir = fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut nodes = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" || name == "target" {
            continue;
        }
        let path = entry.path();
        let is_dir = path.is_dir();
        nodes.push(FileNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
        });
    }
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(nodes)
}

fn session_file_path() -> Option<PathBuf> {
    let dirs = ProjectDirs::from("com", "reoo", "Reoo")?;
    let data_dir = dirs.data_local_dir();
    let _ = fs::create_dir_all(data_dir);
    Some(data_dir.join("hot_exit_session.json"))
}

pub fn save_session(snapshot: &SessionSnapshot) -> Result<(), String> {
    let Some(path) = session_file_path() else {
        return Err("无法定位应用数据目录".to_string());
    };
    let json = serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn load_session() -> Option<SessionSnapshot> {
    let path = session_file_path()?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}
