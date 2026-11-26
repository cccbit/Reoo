use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::SearcherBuilder;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSearchHit {
    pub path: String,
    pub relative_path: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFileEntry {
    pub path: String,
    pub relative_path: String,
    pub name: String,
}

/// 基于 ripgrep 同源引擎 (ignore + grep-searcher) 的高速工作区全文检索
pub fn search_workspace(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    max_hits: usize,
) -> Result<Vec<WorkspaceSearchHit>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let pattern = if use_regex {
        query.to_string()
    } else {
        regex_escape(query)
    };

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .build(&pattern)
        .map_err(|e| e.to_string())?;

    let mut searcher = SearcherBuilder::new()
        .binary_detection(grep_searcher::BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let mut hits = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .max_filesize(Some(8 * 1024 * 1024))
        .build();

    for entry in walker.flatten() {
        if hits.len() >= max_hits {
            break;
        }
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let path = entry.path();
        if path
            .components()
            .any(|c| c.as_os_str() == ".git" || c.as_os_str() == "node_modules" || c.as_os_str() == "target")
        {
            continue;
        }

        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let full = path.to_string_lossy().to_string();

        let _ = searcher.search_path(
            &matcher,
            path,
            UTF8(|line_num, line_text| {
                if hits.len() >= max_hits {
                    return Ok(false);
                }
                let trimmed = line_text.trim();
                let preview = if trimmed.chars().count() > 160 {
                    format!("{}…", trimmed.chars().take(160).collect::<String>())
                } else {
                    trimmed.to_string()
                };
                hits.push(WorkspaceSearchHit {
                    path: full.clone(),
                    relative_path: rel.clone(),
                    line: (line_num as usize).saturating_sub(1),
                    preview,
                });
                Ok(true)
            }),
        );
    }

    Ok(hits)
}

/// 列出工作区所有代码/文本文件（供命令面板 Ctrl+P 模糊秒搜）
pub fn list_workspace_files(root: &Path, limit: usize) -> Vec<WorkspaceFileEntry> {
    let mut files = Vec::new();
    let walker = WalkBuilder::new(root).hidden(false).git_ignore(true).build();
    for entry in walker.flatten() {
        if files.len() >= limit {
            break;
        }
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let path = entry.path();
        if path
            .components()
            .any(|c| c.as_os_str() == ".git" || c.as_os_str() == "node_modules" || c.as_os_str() == "target")
        {
            continue;
        }
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_path.clone());
        files.push(WorkspaceFileEntry {
            path: path.to_string_lossy().to_string(),
            relative_path,
            name,
        });
    }
    files
}

fn regex_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for c in text.chars() {
        if matches!(
            c,
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
