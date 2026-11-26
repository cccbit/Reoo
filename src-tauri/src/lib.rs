mod state;

use reoo_core::{MoveDir, SearchMatch, TextBuffer, ViewportSnapshot};
use reoo_search::{WorkspaceFileEntry, WorkspaceSearchHit};
use reoo_workspace::{FileNode, HotExitTab, SessionSnapshot};
use serde::{Deserialize, Serialize};
use state::{AppState, BufferEntry, TabMeta};
use std::path::Path;
use tauri::State;

const WELCOME_SNIPPET: &str = r##"// 欢迎使用 Reoo — 极简、轻量化、原生速度的现代编辑器
//
// 核心快捷体验（对齐 VS Code 快捷键 + 超越 Zed 的纯粹界面）：
//   Ctrl+P        四合一命令中心（搜文件 / >执行命令 / :跳行号）
//   Ctrl+D        增量选中下一个相同词（多光标并发编辑）
//   Alt+点击      在任意位置添加多个独立光标
//   Ctrl+Shift+F  工作区搜索（Ripgrep 同源引擎）
//   Ctrl+F / H    当前文件内查找 / 查找并替换
//   Ctrl+/        快速切换行注释    |   Shift+Alt+F  格式化文档
//   Ctrl+B        极简侧边栏开关    |   Ctrl+S       保存文件
//   Hot Exit      关闭软件无需确认，所有未保存草稿下次秒开原样恢复

fn main() {
    let editor = "Reoo";
    let accent = "#2563eb";
    let speed = "Sub-millisecond Rope Engine";

    // 试试把光标放在下方的 `editor` 上，连续按 Ctrl+D 多光标同时修改：
    println!("Launching {} ({}) with {}...", editor, accent, speed);
    println!("{} is ready for your next big idea.", editor);
}
"##;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabOpenResponse {
    pub tab: TabMeta,
    pub viewport: ViewportSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitSessionResponse {
    pub workspace_root: Option<String>,
    pub theme: String,
    pub locale: String,
    pub accent: String,
    pub startup_mode: String,
    pub word_wrap: bool,
    pub font_size: u32,
    pub font_family: String,
    pub active_tab_id: Option<String>,
    pub tabs: Vec<TabMeta>,
    pub active_viewport: Option<ViewportSnapshot>,
}

fn with_buffer<F, R>(state: &State<'_, AppState>, tab_id: &str, f: F) -> Result<R, String>
where
    F: FnOnce(&mut BufferEntry) -> R,
{
    let mut map = state.buffers.lock();
    let entry = map
        .get_mut(tab_id)
        .ok_or_else(|| format!("未找到缓冲区: {tab_id}"))?;
    let res = f(entry);
    entry.meta.dirty = entry.buffer.dirty;
    entry.meta.language = entry.buffer.language.clone();
    Ok(res)
}

#[tauri::command]
fn restore_or_init_session(
    state: State<'_, AppState>,
    viewport_lines: usize,
) -> Result<InitSessionResponse, String> {
    let mut buffers = state.buffers.lock();
    let mut order = state.tab_order.lock();
    buffers.clear();
    order.clear();

    let saved = reoo_workspace::load_session();

    // 始终先恢复用户个性化偏好设置（主题、语言、主题色、启动策略、自动换行、字号、字体）
    let mut theme = "system".to_string();
    let mut locale = "zh".to_string();
    let mut accent = "blue".to_string();
    let mut startup_mode = "new_session".to_string();
    let mut word_wrap = true;
    let mut font_size: u32 = 14;
    let mut font_family = "default".to_string();
    let mut workspace_root: Option<String> = None;

    if let Some(ref snap) = saved {
        if !snap.theme.is_empty() {
            theme = snap.theme.clone();
        }
        if !snap.locale.is_empty() {
            locale = snap.locale.clone();
        }
        if !snap.accent.is_empty() && snap.accent != "cyan" {
            accent = snap.accent.clone();
        }
        if snap.startup_mode == "restore_session" || snap.startup_mode == "new_session" {
            startup_mode = snap.startup_mode.clone();
        }
        word_wrap = snap.word_wrap;
        if (10..=32).contains(&snap.font_size) {
            font_size = snap.font_size;
        }
        if !snap.font_family.is_empty() {
            font_family = snap.font_family.clone();
        }
    }

    *state.theme.lock() = theme.clone();
    *state.locale.lock() = locale.clone();
    *state.accent.lock() = accent.clone();
    *state.startup_mode.lock() = startup_mode.clone();
    *state.word_wrap.lock() = word_wrap;
    *state.font_size.lock() = font_size;
    *state.font_family.lock() = font_family.clone();

    let mut tabs_meta: Vec<TabMeta> = Vec::new();
    let mut active_id: Option<String> = None;

    // 仅当用户选择「继续上一个会话」时，才恢复上次标签页与工作区（并重新分配唯一 ID 彻底杜绝 ID 碰撞）
    if startup_mode == "restore_session"
        && let Some(snap) = saved
        && !snap.tabs.is_empty()
    {
        workspace_root = snap.workspace_root.clone();
        let mut old_to_new_id: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        for t in snap.tabs {
            let new_id = state.gen_id();
            old_to_new_id.insert(t.id.clone(), new_id.clone());

            let mut buf = if !t.dirty
                && let Some(ref p) = t.path
                && Path::new(p).exists()
            {
                TextBuffer::from_file(Path::new(p))
                    .unwrap_or_else(|_| TextBuffer::new_empty(&t.content, Some(&t.language)))
            } else {
                let mut b = TextBuffer::new_empty(&t.content, Some(&t.language));
                b.path = t.path.as_ref().map(|p| Path::new(p).to_path_buf());
                b.dirty = t.dirty;
                b
            };
            buf.set_cursor_at_line_col(t.cursor_line, t.cursor_col, false);

            let meta = TabMeta {
                id: new_id.clone(),
                title: t.title,
                path: t.path,
                dirty: buf.dirty,
                language: buf.language.clone(),
            };
            tabs_meta.push(meta.clone());
            order.push(new_id.clone());
            buffers.insert(new_id, BufferEntry { meta, buffer: buf });
        }

        active_id = snap
            .active_tab_id
            .and_then(|old| old_to_new_id.get(&old).cloned())
            .or_else(|| order.first().cloned());
    }

    // 处理通过系统右键菜单或命令行传入的文件/目录参数
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = Path::new(&arg);
        if p.is_dir() {
            workspace_root = Some(arg);
        } else if p.is_file() {
            if let Some(existing_id) = buffers
                .values()
                .find(|e| e.meta.path.as_deref() == Some(arg.as_str()))
                .map(|e| e.meta.id.clone())
            {
                active_id = Some(existing_id);
            } else if let Ok(buf) = TextBuffer::from_file(p) {
                let id = state.gen_id();
                let title = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| arg.clone());
                let meta = TabMeta {
                    id: id.clone(),
                    title,
                    path: Some(arg),
                    dirty: false,
                    language: buf.language.clone(),
                };
                tabs_meta.push(meta.clone());
                order.push(id.clone());
                buffers.insert(id.clone(), BufferEntry { meta, buffer: buf });
                active_id = Some(id);
            }
        }
    }

    // 若既未恢复历史标签也未传入文件，则创建干净的空白新建文件（首次全新启动保留欢迎示例）
    if tabs_meta.is_empty() {
        let id = state.gen_id();
        let is_first_launch = reoo_workspace::load_session().is_none();
        let (title, initial_text, lang) = if is_first_launch {
            ("Welcome.rs".to_string(), WELCOME_SNIPPET, "rust")
        } else {
            let untitled = if locale == "en" {
                "Untitled"
            } else {
                "未命名"
            };
            (untitled.to_string(), "", "plaintext")
        };
        let buf = TextBuffer::new_empty(initial_text, Some(lang));
        let meta = TabMeta {
            id: id.clone(),
            title,
            path: None,
            dirty: false,
            language: buf.language.clone(),
        };
        tabs_meta.push(meta.clone());
        order.push(id.clone());
        buffers.insert(id.clone(), BufferEntry { meta, buffer: buf });
        active_id = Some(id);
    }

    *state.workspace_root.lock() = workspace_root.clone();

    let active_viewport = active_id
        .as_ref()
        .and_then(|id| buffers.get(id))
        .map(|e| e.buffer.viewport_slice(0, viewport_lines.max(40)));

    Ok(InitSessionResponse {
        workspace_root,
        theme,
        locale,
        accent,
        startup_mode,
        word_wrap,
        font_size,
        font_family,
        active_tab_id: active_id,
        tabs: tabs_meta,
        active_viewport,
    })
}

#[tauri::command]
async fn save_hot_exit_session(
    state: State<'_, AppState>,
    active_tab_id: Option<String>,
    workspace_root: Option<String>,
    theme: String,
    locale: String,
    accent: String,
    startup_mode: String,
    word_wrap: bool,
    font_size: u32,
    font_family: String,
) -> Result<(), String> {
    *state.workspace_root.lock() = workspace_root.clone();
    *state.theme.lock() = theme.clone();
    *state.locale.lock() = locale.clone();
    *state.accent.lock() = accent.clone();
    *state.startup_mode.lock() = startup_mode.clone();
    *state.word_wrap.lock() = word_wrap;
    *state.font_size.lock() = font_size;
    *state.font_family.lock() = font_family.clone();

    let snapshot = {
        let buffers = state.buffers.lock();
        let order = state.tab_order.lock();
        let mut tabs = Vec::with_capacity(order.len());

        // 仅在「继续上一个会话」模式下持久化未保存标签内容；新会话模式下仍保存全部用户设置
        if startup_mode == "restore_session" {
            for id in order.iter() {
                if let Some(entry) = buffers.get(id) {
                    let (line, col) = entry
                        .buffer
                        .char_to_line_col(entry.buffer.selections.primary().head);
                    let content =
                        if !entry.buffer.dirty && entry.buffer.rope.len_bytes() > 5 * 1024 * 1024 {
                            String::new()
                        } else {
                            entry.buffer.rope.to_string()
                        };
                    tabs.push(HotExitTab {
                        id: entry.meta.id.clone(),
                        title: entry.meta.title.clone(),
                        path: entry.meta.path.clone(),
                        content,
                        dirty: entry.buffer.dirty,
                        language: entry.buffer.language.clone(),
                        cursor_line: line,
                        cursor_col: col,
                    });
                }
            }
        }

        SessionSnapshot {
            workspace_root: if startup_mode == "restore_session" {
                workspace_root
            } else {
                None
            },
            active_tab_id: if startup_mode == "restore_session" {
                active_tab_id
            } else {
                None
            },
            theme,
            locale,
            accent,
            startup_mode,
            word_wrap,
            font_size,
            font_family,
            tabs,
        }
    };

    tokio::task::spawn_blocking(move || reoo_workspace::save_session(&snapshot))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_file(
    state: State<'_, AppState>,
    path: String,
    start_line: usize,
    line_count: usize,
) -> Result<TabOpenResponse, String> {
    // 若已打开相同路径，直接复用现有标签页
    {
        let buffers = state.buffers.lock();
        if let Some(existing) = buffers
            .values()
            .find(|e| e.meta.path.as_deref() == Some(path.as_str()))
        {
            return Ok(TabOpenResponse {
                tab: existing.meta.clone(),
                viewport: existing
                    .buffer
                    .viewport_slice(start_line, line_count.max(40)),
            });
        }
    }

    let p = Path::new(&path);
    let buf = TextBuffer::from_file(p).map_err(|e| e.to_string())?;
    let title = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let id = state.gen_id();
    let meta = TabMeta {
        id: id.clone(),
        title,
        path: Some(path),
        dirty: false,
        language: buf.language.clone(),
    };
    let viewport = buf.viewport_slice(start_line, line_count.max(40));

    state.tab_order.lock().push(id.clone());
    state.buffers.lock().insert(
        id,
        BufferEntry {
            meta: meta.clone(),
            buffer: buf,
        },
    );

    Ok(TabOpenResponse {
        tab: meta,
        viewport,
    })
}

#[tauri::command]
fn create_untitled_tab(
    state: State<'_, AppState>,
    title: Option<String>,
    language: Option<String>,
    line_count: usize,
) -> TabOpenResponse {
    let id = state.gen_id();
    let tab_title = title.unwrap_or_else(|| "未命名".to_string());
    let buf = TextBuffer::new_empty("", language.as_deref());
    let meta = TabMeta {
        id: id.clone(),
        title: tab_title,
        path: None,
        dirty: false,
        language: buf.language.clone(),
    };
    let viewport = buf.viewport_slice(0, line_count.max(40));

    state.tab_order.lock().push(id.clone());
    state.buffers.lock().insert(
        id,
        BufferEntry {
            meta: meta.clone(),
            buffer: buf,
        },
    );

    TabOpenResponse {
        tab: meta,
        viewport,
    }
}

#[tauri::command]
fn close_tab(state: State<'_, AppState>, tab_id: String) {
    state.buffers.lock().remove(&tab_id);
    state.tab_order.lock().retain(|id| id != &tab_id);
}

#[tauri::command]
fn save_buffer(
    state: State<'_, AppState>,
    tab_id: String,
    target_path: Option<String>,
    start_line: usize,
    line_count: usize,
) -> Result<TabOpenResponse, String> {
    with_buffer(&state, &tab_id, |entry| {
        let saved_path = entry
            .buffer
            .save(target_path.as_deref().map(Path::new))
            .map_err(|e| e.to_string())?;
        let path_str = saved_path.to_string_lossy().to_string();
        if let Some(name) = saved_path.file_name() {
            entry.meta.title = name.to_string_lossy().to_string();
        }
        entry.meta.path = Some(path_str);
        entry.meta.dirty = false;
        entry.meta.language = entry.buffer.language.clone();
        Ok(TabOpenResponse {
            tab: entry.meta.clone(),
            viewport: entry.buffer.viewport_slice(start_line, line_count.max(40)),
        })
    })?
}

#[tauri::command]
fn save_buffer_with_encoding(
    state: State<'_, AppState>,
    tab_id: String,
    target_path: Option<String>,
    encoding: String,
    start_line: usize,
    line_count: usize,
) -> Result<TabOpenResponse, String> {
    with_buffer(&state, &tab_id, |entry| {
        let saved_path = entry
            .buffer
            .save_with_encoding(target_path.as_deref().map(Path::new), &encoding)
            .map_err(|e| e.to_string())?;
        let path_str = saved_path.to_string_lossy().to_string();
        if let Some(name) = saved_path.file_name() {
            entry.meta.title = name.to_string_lossy().to_string();
        }
        entry.meta.path = Some(path_str);
        entry.meta.dirty = false;
        entry.meta.language = entry.buffer.language.clone();
        Ok(TabOpenResponse {
            tab: entry.meta.clone(),
            viewport: entry.buffer.viewport_slice(start_line, line_count.max(40)),
        })
    })?
}

#[tauri::command]
fn get_viewport(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_insert_text(
    state: State<'_, AppState>,
    tab_id: String,
    text: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.insert_text(&text);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_backspace(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.backspace();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_delete_forward(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.delete_forward();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_move_cursors(
    state: State<'_, AppState>,
    tab_id: String,
    dir: MoveDir,
    extend: bool,
    word: bool,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.move_cursors(dir, extend, word);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_set_cursor(
    state: State<'_, AppState>,
    tab_id: String,
    line: usize,
    col: usize,
    extend: bool,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.set_cursor_at_line_col(line, col, extend);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_add_cursor(
    state: State<'_, AppState>,
    tab_id: String,
    line: usize,
    col: usize,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.add_cursor_at_line_col(line, col);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_select_word(
    state: State<'_, AppState>,
    tab_id: String,
    line: usize,
    col: usize,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.select_word_at(line, col);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_select_line(
    state: State<'_, AppState>,
    tab_id: String,
    line: usize,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.select_line_at(line);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_replace_line_range(
    state: State<'_, AppState>,
    tab_id: String,
    line: usize,
    start_col: usize,
    end_col: usize,
    replacement: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer
            .replace_line_range(line, start_col, end_col, &replacement);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_format_document(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        let _ = e.buffer.format_document();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_goto_definition(
    state: State<'_, AppState>,
    tab_id: String,
    line_count: usize,
) -> Result<Option<(usize, ViewportSnapshot)>, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.find_definition_of_cursor().map(|(line, _)| {
            let start = line.saturating_sub(6);
            (line, e.buffer.viewport_slice(start, line_count.max(40)))
        })
    })
}

#[tauri::command]
fn buffer_select_all(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.select_all();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_select_next_occurrence(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.select_next_occurrence();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_clear_extra_cursors(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.clear_extra_cursors();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_duplicate_lines(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.duplicate_lines();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_delete_lines(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.delete_lines();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_indent_lines(
    state: State<'_, AppState>,
    tab_id: String,
    outdent: bool,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.indent_lines(outdent);
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_toggle_comment(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.toggle_line_comment();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_undo(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.undo();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_redo(
    state: State<'_, AppState>,
    tab_id: String,
    start_line: usize,
    line_count: usize,
) -> Result<ViewportSnapshot, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer.redo();
        e.buffer.viewport_slice(start_line, line_count.max(40))
    })
}

#[tauri::command]
fn buffer_selected_text(state: State<'_, AppState>, tab_id: String) -> Result<String, String> {
    with_buffer(&state, &tab_id, |e| e.buffer.selected_text())
}

#[tauri::command]
fn buffer_find(
    state: State<'_, AppState>,
    tab_id: String,
    query: String,
    case_sensitive: bool,
    use_regex: bool,
) -> Result<Vec<SearchMatch>, String> {
    with_buffer(&state, &tab_id, |e| {
        e.buffer
            .find_in_buffer(&query, case_sensitive, use_regex)
            .map_err(|err| err.to_string())
    })?
}

#[tauri::command]
fn buffer_replace_all(
    state: State<'_, AppState>,
    tab_id: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
    use_regex: bool,
    start_line: usize,
    line_count: usize,
) -> Result<(usize, ViewportSnapshot), String> {
    with_buffer(&state, &tab_id, |e| {
        let count = e
            .buffer
            .replace_all(&query, &replacement, case_sensitive, use_regex)
            .map_err(|err| err.to_string())?;
        Ok((
            count,
            e.buffer.viewport_slice(start_line, line_count.max(40)),
        ))
    })?
}

#[tauri::command]
async fn workspace_list_dir(dir: String) -> Result<Vec<FileNode>, String> {
    tokio::task::spawn_blocking(move || reoo_workspace::list_directory(Path::new(&dir)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn workspace_list_files(root: String) -> Vec<WorkspaceFileEntry> {
    tokio::task::spawn_blocking(move || reoo_search::list_workspace_files(Path::new(&root), 4000))
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn workspace_search(
    root: String,
    query: String,
    case_sensitive: bool,
    use_regex: bool,
) -> Result<Vec<WorkspaceSearchHit>, String> {
    tokio::task::spawn_blocking(move || {
        reoo_search::search_workspace(Path::new(&root), &query, case_sensitive, use_regex, 500)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("仅支持打开 http/https 链接".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn shell_menu_status() -> bool {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey("Software\\Classes\\*\\shell\\Reoo").is_ok()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 将 Reoo 写入或移除当前用户的 Windows 资源管理器右键菜单（无需管理员权限）
#[tauri::command]
fn set_shell_context_menu(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let keys = [
            ("Software\\Classes\\*\\shell\\Reoo", "\"%1\""),
            ("Software\\Classes\\Directory\\shell\\Reoo", "\"%1\""),
            (
                "Software\\Classes\\Directory\\Background\\shell\\Reoo",
                "\"%V\"",
            ),
        ];

        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe.to_string_lossy().to_string();
            for (subkey, arg_tpl) in keys {
                let (key, _) = hkcu.create_subkey(subkey).map_err(|e| e.to_string())?;
                key.set_value("", &"用 Reoo 打开")
                    .map_err(|e| e.to_string())?;
                key.set_value("Icon", &exe_str).map_err(|e| e.to_string())?;
                let (cmd_key, _) = key.create_subkey("command").map_err(|e| e.to_string())?;
                let cmd_val = format!("\"{exe_str}\" {arg_tpl}");
                cmd_key
                    .set_value("", &cmd_val)
                    .map_err(|e| e.to_string())?;
            }
            Ok(true)
        } else {
            for (subkey, _) in keys {
                let _ = hkcu.delete_subkey_all(subkey);
            }
            Ok(false)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("当前操作系统暂不支持系统右键菜单注册".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            restore_or_init_session,
            save_hot_exit_session,
            open_file,
            create_untitled_tab,
            close_tab,
            save_buffer,
            save_buffer_with_encoding,
            get_viewport,
            buffer_insert_text,
            buffer_backspace,
            buffer_delete_forward,
            buffer_move_cursors,
            buffer_set_cursor,
            buffer_add_cursor,
            buffer_select_word,
            buffer_select_line,
            buffer_replace_line_range,
            buffer_format_document,
            buffer_goto_definition,
            buffer_select_all,
            buffer_select_next_occurrence,
            buffer_clear_extra_cursors,
            buffer_duplicate_lines,
            buffer_delete_lines,
            buffer_indent_lines,
            buffer_toggle_comment,
            buffer_undo,
            buffer_redo,
            buffer_selected_text,
            buffer_find,
            buffer_replace_all,
            workspace_list_dir,
            workspace_list_files,
            workspace_search,
            get_app_version,
            exit_app,
            open_external_url,
            shell_menu_status,
            set_shell_context_menu,
        ])
        .run(tauri::generate_context!())
        .expect("Reoo 启动失败");
}
