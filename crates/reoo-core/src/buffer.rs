use crate::highlight::{TokenSpan, tokenize_line};
use crate::history::{EditOp, EditTransaction, UndoHistory};
use crate::selection::{Selection, SelectionSet};
use encoding_rs::UTF_8;
use memmap2::Mmap;
use regex::RegexBuilder;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use thiserror::Error;

const LARGE_FILE_THRESHOLD_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

#[derive(Debug, Error)]
pub enum BufferError {
    #[error("文件读写失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("正则表达式语法错误: {0}")]
    Regex(#[from] regex::Error),
    #[error("当前未命名文档没有关联路径")]
    MissingPath,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoveDir {
    Left,
    Right,
    Up,
    Down,
    LineStart,
    LineEnd,
    DocStart,
    DocEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorView {
    pub line: usize,
    pub col: usize,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionRangeView {
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewportLine {
    pub line_index: usize,
    pub text: String,
    pub tokens: Vec<TokenSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewportSnapshot {
    pub total_lines: usize,
    pub total_chars: usize,
    pub start_line: usize,
    pub lines: Vec<ViewportLine>,
    pub cursors: Vec<CursorView>,
    pub selections: Vec<SelectionRangeView>,
    pub primary_line: usize,
    pub primary_col: usize,
    pub cursor_count: usize,
    pub dirty: bool,
    pub encoding: String,
    pub line_ending: LineEnding,
    pub language: String,
    pub large_file_mode: bool,
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub line: usize,
    pub start_col: usize,
    pub end_col: usize,
    pub start_char: usize,
    pub end_char: usize,
    pub line_text: String,
}

pub struct TextBuffer {
    pub rope: Rope,
    pub path: Option<PathBuf>,
    pub encoding: String,
    pub line_ending: LineEnding,
    pub selections: SelectionSet,
    pub history: UndoHistory,
    pub dirty: bool,
    pub large_file_mode: bool,
    pub language: String,
    pub version: u64,
}

impl TextBuffer {
    pub fn new_empty(initial_text: &str, language: Option<&str>) -> Self {
        let normalized = initial_text.replace("\r\n", "\n");
        let line_ending = if initial_text.contains("\r\n") {
            LineEnding::Crlf
        } else {
            LineEnding::Lf
        };
        Self {
            rope: Rope::from_str(&normalized),
            path: None,
            encoding: "UTF-8".to_string(),
            line_ending,
            selections: SelectionSet::single(0),
            history: UndoHistory::new(500),
            dirty: false,
            large_file_mode: false,
            language: language.unwrap_or("plaintext").to_string(),
            version: 1,
        }
    }

    pub fn from_file(path: &Path) -> Result<Self, BufferError> {
        let file = File::open(path)?;
        let meta = file.metadata()?;
        let large_file_mode = meta.len() >= LARGE_FILE_THRESHOLD_BYTES;

        let raw_bytes: Vec<u8> = if meta.len() == 0 {
            Vec::new()
        } else {
            // 使用 memmap2 零拷贝映射读取，大幅提升大文件冷启动速度
            let mmap = unsafe { Mmap::map(&file)? };
            mmap.to_vec()
        };

        let (decoded, encoding_name) = decode_bytes(&raw_bytes);
        let line_ending = if decoded.contains("\r\n") {
            LineEnding::Crlf
        } else {
            LineEnding::Lf
        };
        let normalized = if line_ending == LineEnding::Crlf {
            decoded.replace("\r\n", "\n")
        } else {
            decoded
        };

        let language = detect_language(path);

        Ok(Self {
            rope: Rope::from_str(&normalized),
            path: Some(path.to_path_buf()),
            encoding: encoding_name,
            line_ending,
            selections: SelectionSet::single(0),
            history: UndoHistory::new(if large_file_mode { 100 } else { 500 }),
            dirty: false,
            large_file_mode,
            language,
            version: 1,
        })
    }

    pub fn save(&mut self, target_path: Option<&Path>) -> Result<PathBuf, BufferError> {
        let enc = self.encoding.clone();
        self.save_with_encoding(target_path, &enc)
    }

    pub fn save_with_encoding(
        &mut self,
        target_path: Option<&Path>,
        encoding_name: &str,
    ) -> Result<PathBuf, BufferError> {
        let dest = match target_path {
            Some(p) => {
                self.path = Some(p.to_path_buf());
                self.language = detect_language(p);
                p.to_path_buf()
            }
            None => self.path.clone().ok_or(BufferError::MissingPath)?,
        };

        let mut content = self.rope.to_string();
        if self.line_ending == LineEnding::Crlf {
            content = content.replace('\n', "\r\n");
        }

        let (bytes, canonical_enc) = encode_text(&content, encoding_name);

        let mut file = File::create(&dest)?;
        file.write_all(&bytes)?;
        file.flush()?;
        self.encoding = canonical_enc;
        self.dirty = false;
        self.version += 1;
        Ok(dest)
    }

    pub fn line_count(&self) -> usize {
        self.rope.len_lines().max(1)
    }

    pub fn line_text_without_newline(&self, line_idx: usize) -> String {
        if line_idx >= self.rope.len_lines() {
            return String::new();
        }
        let slice = self.rope.line(line_idx);
        let mut s = slice.to_string();
        if s.ends_with('\n') {
            s.pop();
        }
        if s.ends_with('\r') {
            s.pop();
        }
        s
    }

    pub fn line_len_without_newline(&self, line_idx: usize) -> usize {
        if line_idx >= self.rope.len_lines() {
            return 0;
        }
        let slice = self.rope.line(line_idx);
        let mut len = slice.len_chars();
        if len > 0 && slice.char(len - 1) == '\n' {
            len -= 1;
        }
        if len > 0 && slice.char(len - 1) == '\r' {
            len -= 1;
        }
        len
    }

    pub fn char_to_line_col(&self, char_idx: usize) -> (usize, usize) {
        let clamped = char_idx.min(self.rope.len_chars());
        let line = self.rope.char_to_line(clamped);
        let line_start = self.rope.line_to_char(line);
        (line, clamped.saturating_sub(line_start))
    }

    pub fn line_col_to_char(&self, line: usize, col: usize) -> usize {
        let max_line = self.rope.len_lines().saturating_sub(1);
        let clamped_line = line.min(max_line);
        let line_start = self.rope.line_to_char(clamped_line);
        let max_col = self.line_len_without_newline(clamped_line);
        line_start + col.min(max_col)
    }

    /// 原子多光标文本插入（支持换行自动缩进）
    pub fn insert_text(&mut self, raw_text: &str) {
        let text = raw_text.replace("\r\n", "\n");
        let before = self.selections.clone();
        let mut ops = Vec::with_capacity(self.selections.ranges.len());

        // 若是单独按回车，按每个光标所在行自动继承缩进
        let auto_indent = text == "\n";
        let ranges = self.selections.ranges.clone();
        let mut new_ranges = Vec::with_capacity(ranges.len());

        // 先计算每个光标对应的替换文本
        let inserts: Vec<String> = ranges
            .iter()
            .map(|sel| {
                if auto_indent {
                    let (line, _) = self.char_to_line_col(sel.start());
                    let line_str = self.line_text_without_newline(line);
                    let indent: String = line_str
                        .chars()
                        .take_while(|c| *c == ' ' || *c == '\t')
                        .collect();
                    format!("\n{indent}")
                } else {
                    text.clone()
                }
            })
            .collect();

        // 逆序执行编辑，避免前面偏移变化影响后面的选区
        for (sel, ins) in ranges.iter().zip(inserts.iter()).rev() {
            let start = sel.start();
            let end = sel.end();
            let deleted = self.rope.slice(start..end).to_string();
            if start != end {
                self.rope.remove(start..end);
            }
            if !ins.is_empty() {
                self.rope.insert(start, ins);
            }
            ops.push(EditOp {
                start,
                end,
                inserted: ins.clone(),
                deleted,
            });
        }

        // 正序累计偏移，精确计算每个新光标位置
        let mut delta: isize = 0;
        for (sel, ins) in ranges.iter().zip(inserts.iter()) {
            let start = sel.start();
            let end = sel.end();
            let ins_chars = ins.chars().count();
            let new_pos = (start as isize + delta + ins_chars as isize).max(0) as usize;
            new_ranges.push(Selection::caret(new_pos));
            delta += ins_chars as isize - (end - start) as isize;
        }

        self.selections = SelectionSet {
            ranges: new_ranges,
            primary_index: before.primary_index.min(ranges.len().saturating_sub(1)),
        };
        self.selections.normalize();

        self.history.push(EditTransaction {
            ops,
            before,
            after: self.selections.clone(),
        });
        self.dirty = true;
        self.version += 1;
    }

    pub fn backspace(&mut self) {
        let before = self.selections.clone();
        let ranges = self.selections.ranges.clone();
        let mut ops = Vec::new();
        let mut removals: Vec<(usize, usize)> = Vec::with_capacity(ranges.len());

        for sel in &ranges {
            if !sel.is_empty() {
                removals.push((sel.start(), sel.end()));
            } else if sel.start() > 0 {
                removals.push((sel.start() - 1, sel.start()));
            } else {
                removals.push((0, 0));
            }
        }

        for &(start, end) in removals.iter().rev() {
            if start < end {
                let deleted = self.rope.slice(start..end).to_string();
                self.rope.remove(start..end);
                ops.push(EditOp {
                    start,
                    end,
                    inserted: String::new(),
                    deleted,
                });
            }
        }

        if ops.is_empty() {
            return;
        }

        let mut delta: isize = 0;
        let mut new_ranges = Vec::with_capacity(removals.len());
        for &(start, end) in &removals {
            let new_pos = (start as isize + delta).max(0) as usize;
            new_ranges.push(Selection::caret(new_pos));
            delta -= (end - start) as isize;
        }

        self.selections = SelectionSet {
            ranges: new_ranges,
            primary_index: before.primary_index.min(removals.len().saturating_sub(1)),
        };
        self.selections.normalize();
        self.history.push(EditTransaction {
            ops,
            before,
            after: self.selections.clone(),
        });
        self.dirty = true;
        self.version += 1;
    }

    pub fn delete_forward(&mut self) {
        let before = self.selections.clone();
        let ranges = self.selections.ranges.clone();
        let total = self.rope.len_chars();
        let mut ops = Vec::new();
        let mut removals: Vec<(usize, usize)> = Vec::with_capacity(ranges.len());

        for sel in &ranges {
            if !sel.is_empty() {
                removals.push((sel.start(), sel.end()));
            } else if sel.end() < total {
                removals.push((sel.end(), sel.end() + 1));
            } else {
                removals.push((total, total));
            }
        }

        for &(start, end) in removals.iter().rev() {
            if start < end {
                let deleted = self.rope.slice(start..end).to_string();
                self.rope.remove(start..end);
                ops.push(EditOp {
                    start,
                    end,
                    inserted: String::new(),
                    deleted,
                });
            }
        }

        if ops.is_empty() {
            return;
        }

        let mut delta: isize = 0;
        let mut new_ranges = Vec::with_capacity(removals.len());
        for &(start, end) in &removals {
            let new_pos = (start as isize + delta).max(0) as usize;
            new_ranges.push(Selection::caret(new_pos));
            delta -= (end - start) as isize;
        }

        self.selections = SelectionSet {
            ranges: new_ranges,
            primary_index: before.primary_index.min(removals.len().saturating_sub(1)),
        };
        self.selections.normalize();
        self.history.push(EditTransaction {
            ops,
            before,
            after: self.selections.clone(),
        });
        self.dirty = true;
        self.version += 1;
    }

    pub fn move_cursors(&mut self, dir: MoveDir, extend: bool, word: bool) {
        let total = self.rope.len_chars();
        let mut updated = Vec::with_capacity(self.selections.ranges.len());

        for sel in &self.selections.ranges {
            let new_head = match dir {
                MoveDir::Left => {
                    if !extend && !sel.is_empty() {
                        sel.start()
                    } else if word {
                        self.prev_word_boundary(sel.head)
                    } else {
                        sel.head.saturating_sub(1)
                    }
                }
                MoveDir::Right => {
                    if !extend && !sel.is_empty() {
                        sel.end()
                    } else if word {
                        self.next_word_boundary(sel.head)
                    } else {
                        (sel.head + 1).min(total)
                    }
                }
                MoveDir::Up => {
                    let (line, col) = self.char_to_line_col(sel.head);
                    if line == 0 {
                        0
                    } else {
                        self.line_col_to_char(line - 1, col)
                    }
                }
                MoveDir::Down => {
                    let (line, col) = self.char_to_line_col(sel.head);
                    let max_line = self.rope.len_lines().saturating_sub(1);
                    if line >= max_line {
                        total
                    } else {
                        self.line_col_to_char(line + 1, col)
                    }
                }
                MoveDir::LineStart => {
                    let (line, _) = self.char_to_line_col(sel.head);
                    self.rope.line_to_char(line)
                }
                MoveDir::LineEnd => {
                    let (line, _) = self.char_to_line_col(sel.head);
                    self.line_col_to_char(line, self.line_len_without_newline(line))
                }
                MoveDir::DocStart => 0,
                MoveDir::DocEnd => total,
            };

            let new_anchor = if extend { sel.anchor } else { new_head };
            updated.push(Selection::new(new_anchor, new_head));
        }

        self.selections.ranges = updated;
        self.selections.normalize();
    }

    pub fn set_cursor_at_line_col(&mut self, line: usize, col: usize, extend: bool) {
        let pos = self.line_col_to_char(line, col);
        if extend {
            let primary = self.selections.primary();
            self.selections = SelectionSet::from_selection(Selection::new(primary.anchor, pos));
        } else {
            self.selections = SelectionSet::single(pos);
        }
    }

    pub fn add_cursor_at_line_col(&mut self, line: usize, col: usize) {
        let pos = self.line_col_to_char(line, col);
        self.selections.add(Selection::caret(pos));
    }

    pub fn select_word_at(&mut self, line: usize, col: usize) {
        let pos = self.line_col_to_char(line, col);
        let (start, end) = self.word_bounds_at(pos);
        self.selections = SelectionSet::from_selection(Selection::new(start, end));
    }

    pub fn select_line_at(&mut self, line: usize) {
        let max_line = self.rope.len_lines().saturating_sub(1);
        let clamped = line.min(max_line);
        let start = self.rope.line_to_char(clamped);
        let end = if clamped + 1 < self.rope.len_lines() {
            self.rope.line_to_char(clamped + 1)
        } else {
            self.rope.len_chars()
        };
        self.selections = SelectionSet::from_selection(Selection::new(start, end));
    }

    /// 精准替换指定行的列区间文本（供颜色选择器取色后原子写回，完整支持 Undo/Redo）
    pub fn replace_line_range(
        &mut self,
        line: usize,
        start_col: usize,
        end_col: usize,
        replacement: &str,
    ) {
        let start = self.line_col_to_char(line, start_col);
        let end = self.line_col_to_char(line, end_col);
        if start > end {
            return;
        }
        let before = self.selections.clone();
        let deleted = self.rope.slice(start..end).to_string();
        if start < end {
            self.rope.remove(start..end);
        }
        if !replacement.is_empty() {
            self.rope.insert(start, replacement);
        }
        let new_pos = start + replacement.chars().count();
        self.selections = SelectionSet::single(new_pos);
        self.history.push(EditTransaction {
            ops: vec![EditOp {
                start,
                end,
                inserted: replacement.to_string(),
                deleted,
            }],
            before,
            after: self.selections.clone(),
        });
        self.dirty = true;
        self.version += 1;
    }

    /// 轻量内置文档格式化（JSON 严格美化；其他代码规范行尾空白、缩进与末尾换行）
    pub fn format_document(&mut self) -> Result<bool, BufferError> {
        let original = self.rope.to_string();
        let formatted = if self.language == "json" {
            match serde_json::from_str::<serde_json::Value>(&original) {
                Ok(val) => serde_json::to_string_pretty(&val).unwrap_or_else(|_| original.clone()),
                Err(_) => return Ok(false),
            }
        } else {
            let mut out_lines: Vec<String> = original
                .lines()
                .map(|l| l.trim_end_matches([' ', '\t']).replace('\t', "    "))
                .collect();
            while out_lines.last().is_some_and(|l| l.is_empty()) {
                out_lines.pop();
            }
            let mut joined = out_lines.join("\n");
            if !joined.is_empty() {
                joined.push('\n');
            }
            joined
        };

        if formatted == original {
            return Ok(false);
        }

        let before = self.selections.clone();
        let old_len = self.rope.len_chars();
        self.rope = Rope::from_str(&formatted);
        self.selections.clamp(self.rope.len_chars());
        self.history.push(EditTransaction {
            ops: vec![EditOp {
                start: 0,
                end: old_len,
                inserted: formatted,
                deleted: original,
            }],
            before,
            after: self.selections.clone(),
        });
        self.dirty = true;
        self.version += 1;
        Ok(true)
    }

    /// 轻量缓冲区内转到定义（F12）：识别光标下标识符并跳转到声明行
    pub fn find_definition_of_cursor(&mut self) -> Option<(usize, usize)> {
        let primary = self.selections.primary();
        let (start, end) = self.word_bounds_at(primary.head);
        if start >= end {
            return None;
        }
        let symbol = self.rope.slice(start..end).to_string();
        if symbol.len() < 2 {
            return None;
        }

        let escaped = regex::escape(&symbol);
        let pattern = format!(
            r"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:fn|struct|enum|trait|type|const|static|let|mut|function|class|interface|def|func|var)\s+{escaped}\b"
        );
        let re = regex::Regex::new(&pattern).ok()?;
        let content = self.rope.to_string();
        let m = re.find(&content)?;
        let sym_offset = m.as_str().rfind(&symbol).unwrap_or(0);
        let target_char = self.rope.byte_to_char(m.start() + sym_offset);
        let (line, col) = self.char_to_line_col(target_char);
        self.selections = SelectionSet::single(target_char);
        Some((line, col))
    }

    pub fn select_all(&mut self) {
        self.selections = SelectionSet::from_selection(Selection::new(0, self.rope.len_chars()));
    }

    pub fn clear_extra_cursors(&mut self) {
        self.selections.clear_to_primary();
    }

    /// Sublime Text 灵魂功能 Ctrl+D：选中当前词，或增量选中下一个相同匹配并新增光标
    pub fn select_next_occurrence(&mut self) -> bool {
        let primary = self.selections.primary();
        if primary.is_empty() {
            let (start, end) = self.word_bounds_at(primary.head);
            if start < end {
                if let Some(p) = self.selections.ranges.get_mut(self.selections.primary_index) {
                    *p = Selection::new(start, end);
                }
                self.selections.normalize();
                return true;
            }
            return false;
        }

        let needle = self.rope.slice(primary.start()..primary.end()).to_string();
        if needle.is_empty() {
            return false;
        }

        let full = self.rope.to_string();
        let needle_chars = needle.chars().count();
        let search_from_byte = self.rope.char_to_byte(primary.end());

        // 先向后搜索，再从头环绕搜索
        let found_byte = full[search_from_byte..]
            .find(&needle)
            .map(|rel| search_from_byte + rel)
            .or_else(|| full[..search_from_byte].find(&needle));

        if let Some(byte_idx) = found_byte {
            let start_char = self.rope.byte_to_char(byte_idx);
            let end_char = start_char + needle_chars;
            let already_selected = self
                .selections
                .ranges
                .iter()
                .any(|s| s.start() == start_char && s.end() == end_char);
            if !already_selected {
                self.selections.add(Selection::new(start_char, end_char));
                return true;
            }
        }
        false
    }

    pub fn selected_text(&self) -> String {
        self.selections
            .ranges
            .iter()
            .filter(|s| !s.is_empty())
            .map(|s| self.rope.slice(s.start()..s.end()).to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn duplicate_lines(&mut self) {
        let (line, col) = self.char_to_line_col(self.selections.primary().head);
        let text = self.line_text_without_newline(line);
        let line_end = self.line_col_to_char(line, self.line_len_without_newline(line));
        self.selections = SelectionSet::single(line_end);
        self.insert_text(&format!("\n{text}"));
        let new_pos = self.line_col_to_char(line + 1, col);
        self.selections = SelectionSet::single(new_pos);
    }

    pub fn delete_lines(&mut self) {
        let (line, _) = self.char_to_line_col(self.selections.primary().head);
        let start = self.rope.line_to_char(line);
        let end = if line + 1 < self.rope.len_lines() {
            self.rope.line_to_char(line + 1)
        } else {
            self.rope.len_chars()
        };
        if start < end {
            self.selections = SelectionSet::from_selection(Selection::new(start, end));
            self.backspace();
        }
    }

    pub fn indent_lines(&mut self, outdent: bool) {
        if !outdent && self.selections.ranges.iter().all(|s| s.is_empty()) {
            self.insert_text("    ");
            return;
        }
        let primary = self.selections.primary();
        let (start_line, _) = self.char_to_line_col(primary.start());
        let (end_line, _) = self.char_to_line_col(primary.end());

        let before = self.selections.clone();
        let mut ops = Vec::new();
        for line in (start_line..=end_line).rev() {
            let line_start = self.rope.line_to_char(line);
            if outdent {
                let line_str = self.line_text_without_newline(line);
                let remove_count = if line_str.starts_with('\t') {
                    1
                } else {
                    line_str.chars().take(4).take_while(|c| *c == ' ').count()
                };
                if remove_count > 0 {
                    let deleted = self.rope.slice(line_start..line_start + remove_count).to_string();
                    self.rope.remove(line_start..line_start + remove_count);
                    ops.push(EditOp {
                        start: line_start,
                        end: line_start + remove_count,
                        inserted: String::new(),
                        deleted,
                    });
                }
            } else {
                self.rope.insert(line_start, "    ");
                ops.push(EditOp {
                    start: line_start,
                    end: line_start,
                    inserted: "    ".to_string(),
                    deleted: String::new(),
                });
            }
        }
        if !ops.is_empty() {
            self.selections.clamp(self.rope.len_chars());
            self.history.push(EditTransaction {
                ops,
                before,
                after: self.selections.clone(),
            });
            self.dirty = true;
            self.version += 1;
        }
    }

    pub fn toggle_line_comment(&mut self) {
        let prefix = match self.language.as_str() {
            "python" | "toml" | "yaml" | "shell" => "# ",
            "plaintext" | "markdown" | "json" => return,
            _ => "// ",
        };
        let primary = self.selections.primary();
        let (start_line, _) = self.char_to_line_col(primary.start());
        let (end_line, _) = self.char_to_line_col(primary.end());

        let all_commented = (start_line..=end_line).all(|l| {
            self.line_text_without_newline(l)
                .trim_start()
                .starts_with(prefix.trim())
        });

        let before = self.selections.clone();
        let mut ops = Vec::new();
        for line in (start_line..=end_line).rev() {
            let line_str = self.line_text_without_newline(line);
            let indent = line_str.chars().take_while(|c| *c == ' ' || *c == '\t').count();
            let pos = self.rope.line_to_char(line) + indent;
            if all_commented {
                let rest: String = line_str.chars().skip(indent).collect();
                let remove_len = if rest.starts_with(prefix) {
                    prefix.chars().count()
                } else if rest.starts_with(prefix.trim()) {
                    prefix.trim().chars().count()
                } else {
                    0
                };
                if remove_len > 0 {
                    let deleted = self.rope.slice(pos..pos + remove_len).to_string();
                    self.rope.remove(pos..pos + remove_len);
                    ops.push(EditOp {
                        start: pos,
                        end: pos + remove_len,
                        inserted: String::new(),
                        deleted,
                    });
                }
            } else {
                self.rope.insert(pos, prefix);
                ops.push(EditOp {
                    start: pos,
                    end: pos,
                    inserted: prefix.to_string(),
                    deleted: String::new(),
                });
            }
        }
        if !ops.is_empty() {
            self.selections.clamp(self.rope.len_chars());
            self.history.push(EditTransaction {
                ops,
                before,
                after: self.selections.clone(),
            });
            self.dirty = true;
            self.version += 1;
        }
    }

    pub fn undo(&mut self) -> bool {
        let Some(tx) = self.history.pop_undo() else {
            return false;
        };
        // 按逆序回滚（ops 原本就是逆序应用的，撤回时正向逆操作即可恢复原状）
        for op in tx.ops.iter().rev() {
            let ins_len = op.inserted.chars().count();
            if ins_len > 0 {
                self.rope.remove(op.start..op.start + ins_len);
            }
            if !op.deleted.is_empty() {
                self.rope.insert(op.start, &op.deleted);
            }
        }
        self.selections = tx.before;
        self.selections.clamp(self.rope.len_chars());
        self.dirty = true;
        self.version += 1;
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(tx) = self.history.pop_redo() else {
            return false;
        };
        for op in &tx.ops {
            if op.start < op.end {
                self.rope.remove(op.start..op.end);
            }
            if !op.inserted.is_empty() {
                self.rope.insert(op.start, &op.inserted);
            }
        }
        self.selections = tx.after;
        self.selections.clamp(self.rope.len_chars());
        self.dirty = true;
        self.version += 1;
        true
    }

    pub fn find_in_buffer(
        &self,
        query: &str,
        case_sensitive: bool,
        use_regex: bool,
    ) -> Result<Vec<SearchMatch>, BufferError> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = if use_regex {
            query.to_string()
        } else {
            regex::escape(query)
        };
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            .build()?;

        let content = self.rope.to_string();
        let mut results = Vec::new();
        for m in re.find_iter(&content).take(2000) {
            let start_char = self.rope.byte_to_char(m.start());
            let end_char = self.rope.byte_to_char(m.end());
            let (line, start_col) = self.char_to_line_col(start_char);
            let (_, end_col) = self.char_to_line_col(end_char);
            results.push(SearchMatch {
                line,
                start_col,
                end_col,
                start_char,
                end_char,
                line_text: self.line_text_without_newline(line),
            });
        }
        Ok(results)
    }

    pub fn replace_all(
        &mut self,
        query: &str,
        replacement: &str,
        case_sensitive: bool,
        use_regex: bool,
    ) -> Result<usize, BufferError> {
        let matches = self.find_in_buffer(query, case_sensitive, use_regex)?;
        if matches.is_empty() {
            return Ok(0);
        }
        let count = matches.len();
        let before = self.selections.clone();
        let mut ops = Vec::with_capacity(count);
        for m in matches.iter().rev() {
            let deleted = self.rope.slice(m.start_char..m.end_char).to_string();
            self.rope.remove(m.start_char..m.end_char);
            self.rope.insert(m.start_char, replacement);
            ops.push(EditOp {
                start: m.start_char,
                end: m.end_char,
                inserted: replacement.to_string(),
                deleted,
            });
        }
        self.selections.clamp(self.rope.len_chars());
        self.history.push(EditTransaction {
            ops,
            before,
            after: self.selections.clone(),
        });
        self.dirty = true;
        self.version += 1;
        Ok(count)
    }

    /// 仅切片提取当前可见视口行与高亮 Token（保证百万行大文件 O(1) 渲染开销）
    pub fn viewport_slice(&self, start_line: usize, line_count: usize) -> ViewportSnapshot {
        let total_lines = self.line_count();
        let clamped_start = start_line.min(total_lines.saturating_sub(1));
        let end_line = (clamped_start + line_count).min(total_lines);

        let mut lines = Vec::with_capacity(end_line.saturating_sub(clamped_start));
        for idx in clamped_start..end_line {
            let text = self.line_text_without_newline(idx);
            let tokens = if self.large_file_mode && text.len() > 2000 {
                Vec::new()
            } else {
                tokenize_line(&text, &self.language)
            };
            lines.push(ViewportLine {
                line_index: idx,
                text,
                tokens,
            });
        }

        let mut cursors = Vec::with_capacity(self.selections.ranges.len());
        let mut selections = Vec::new();

        for (i, sel) in self.selections.ranges.iter().enumerate() {
            let (head_line, head_col) = self.char_to_line_col(sel.head);
            cursors.push(CursorView {
                line: head_line,
                col: head_col,
                is_primary: i == self.selections.primary_index,
            });

            if !sel.is_empty() {
                let (s_line, s_col) = self.char_to_line_col(sel.start());
                let (e_line, e_col) = self.char_to_line_col(sel.end());
                selections.push(SelectionRangeView {
                    start_line: s_line,
                    start_col: s_col,
                    end_line: e_line,
                    end_col: e_col,
                });
            }
        }

        let primary = self.selections.primary();
        let (primary_line, primary_col) = self.char_to_line_col(primary.head);

        ViewportSnapshot {
            total_lines,
            total_chars: self.rope.len_chars(),
            start_line: clamped_start,
            lines,
            cursors,
            selections,
            primary_line,
            primary_col,
            cursor_count: self.selections.ranges.len(),
            dirty: self.dirty,
            encoding: self.encoding.clone(),
            line_ending: self.line_ending,
            language: self.language.clone(),
            large_file_mode: self.large_file_mode,
            version: self.version,
        }
    }

    fn word_bounds_at(&self, pos: usize) -> (usize, usize) {
        let len = self.rope.len_chars();
        if len == 0 {
            return (0, 0);
        }
        let mut idx = pos.min(len.saturating_sub(1));
        if !is_word_char(self.rope.char(idx)) && idx > 0 && is_word_char(self.rope.char(idx - 1)) {
            idx -= 1;
        }
        if !is_word_char(self.rope.char(idx)) {
            return (pos, pos);
        }
        let mut start = idx;
        while start > 0 && is_word_char(self.rope.char(start - 1)) {
            start -= 1;
        }
        let mut end = idx + 1;
        while end < len && is_word_char(self.rope.char(end)) {
            end += 1;
        }
        (start, end)
    }

    fn prev_word_boundary(&self, pos: usize) -> usize {
        if pos == 0 {
            return 0;
        }
        let mut i = pos - 1;
        while i > 0 && self.rope.char(i).is_whitespace() {
            i -= 1;
        }
        let target_word = is_word_char(self.rope.char(i));
        while i > 0 && is_word_char(self.rope.char(i - 1)) == target_word && !self.rope.char(i - 1).is_whitespace() {
            i -= 1;
        }
        i
    }

    fn next_word_boundary(&self, pos: usize) -> usize {
        let len = self.rope.len_chars();
        if pos >= len {
            return len;
        }
        let mut i = pos;
        let start_word = is_word_char(self.rope.char(i));
        while i < len && is_word_char(self.rope.char(i)) == start_word && !self.rope.char(i).is_whitespace() {
            i += 1;
        }
        while i < len && self.rope.char(i).is_whitespace() {
            i += 1;
        }
        i
    }
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn decode_bytes(bytes: &[u8]) -> (String, String) {
    if let Some((enc, bom_len)) = encoding_rs::Encoding::for_bom(bytes) {
        let (cow, _, _) = enc.decode(&bytes[bom_len..]);
        let name = if enc == UTF_8 {
            "UTF-8 with BOM".to_string()
        } else {
            enc.name().to_string()
        };
        return (cow.into_owned(), name);
    }
    let (cow, _, had_errors) = UTF_8.decode(bytes);
    if !had_errors {
        return (cow.into_owned(), "UTF-8".to_string());
    }
    // 中文 Windows 常见 GB18030 自动回退
    let (gb_cow, _, _) = encoding_rs::GB18030.decode(bytes);
    (gb_cow.into_owned(), "GB18030".to_string())
}

fn encode_text(text: &str, encoding_name: &str) -> (Vec<u8>, String) {
    match encoding_name.to_uppercase().as_str() {
        "UTF-8 WITH BOM" | "UTF-8-BOM" => {
            let mut out = Vec::with_capacity(3 + text.len());
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            out.extend_from_slice(text.as_bytes());
            (out, "UTF-8 with BOM".to_string())
        }
        "GB18030" | "GBK" | "GB2312" => {
            let (cow, _, _) = encoding_rs::GB18030.encode(text);
            (cow.into_owned(), "GB18030".to_string())
        }
        "UTF-16LE" => {
            let mut out = Vec::with_capacity(2 + text.len() * 2);
            out.extend_from_slice(&[0xFF, 0xFE]);
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            (out, "UTF-16LE".to_string())
        }
        "UTF-16BE" => {
            let mut out = Vec::with_capacity(2 + text.len() * 2);
            out.extend_from_slice(&[0xFE, 0xFF]);
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            (out, "UTF-16BE".to_string())
        }
        _ => (text.as_bytes().to_vec(), "UTF-8".to_string()),
    }
}

pub fn detect_language(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" | "mts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" | "pyi" => "python",
        "json" | "jsonc" => "json",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "md" | "markdown" => "markdown",
        "html" | "htm" => "html",
        "css" | "scss" => "css",
        "go" => "go",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "sh" | "bash" | "zsh" | "ps1" => "shell",
        _ => "plaintext",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_multi_cursor_ctrl_d_and_undo() {
        let mut buf = TextBuffer::new_empty("let foo = 1;\nlet foo = 2;\nlet foo = 3;", Some("rust"));
        buf.set_cursor_at_line_col(0, 5, false);
        assert!(buf.select_next_occurrence()); // 选中第一个 foo
        assert!(buf.select_next_occurrence()); // 选中第二个 foo
        assert!(buf.select_next_occurrence()); // 选中第三个 foo
        assert_eq!(buf.selections.ranges.len(), 3);

        buf.insert_text("bar");
        assert_eq!(buf.rope.to_string(), "let bar = 1;\nlet bar = 2;\nlet bar = 3;");

        assert!(buf.undo());
        assert_eq!(buf.rope.to_string(), "let foo = 1;\nlet foo = 2;\nlet foo = 3;");

        assert!(buf.redo());
        assert_eq!(buf.rope.to_string(), "let bar = 1;\nlet bar = 2;\nlet bar = 3;");
    }

    #[test]
    fn test_utf8_cjk_editing() {
        let mut buf = TextBuffer::new_empty("你好世界\nReoo 编辑器", Some("plaintext"));
        buf.set_cursor_at_line_col(0, 2, false);
        buf.insert_text("，极简");
        assert_eq!(buf.line_text_without_newline(0), "你好，极简世界");
    }
}
