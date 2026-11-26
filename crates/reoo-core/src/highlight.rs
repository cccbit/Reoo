use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenKind {
    Plain,
    Keyword,
    String,
    Comment,
    Number,
    Type,
    Function,
    Operator,
    Property,
    Punctuation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSpan {
    /// 行内字符起始列（UTF-16/Unicode char 偏移）
    pub start: usize,
    pub end: usize,
    pub kind: TokenKind,
}

/// 极速行级语法分词器（零堆外依赖，按视口可见行实时执行，为后续 Tree-sitter 增量引擎提供统一 TokenSpan 接口）
pub fn tokenize_line(line: &str, language: &str) -> Vec<TokenSpan> {
    if language == "plaintext" || line.is_empty() {
        return Vec::new();
    }

    let chars: Vec<char> = line.chars().collect();
    let len = chars.len();
    let mut tokens = Vec::new();
    let mut i = 0;

    let is_hash_comment = matches!(language, "python" | "toml" | "yaml" | "shell");
    let is_slash_comment = matches!(
        language,
        "rust" | "typescript" | "javascript" | "json" | "go" | "c" | "cpp" | "css"
    );

    if language == "markdown" {
        return tokenize_markdown(&chars);
    }

    while i < len {
        let c = chars[i];

        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // 单行注释
        if is_slash_comment && c == '/' && i + 1 < len && chars[i + 1] == '/' {
            tokens.push(TokenSpan {
                start: i,
                end: len,
                kind: TokenKind::Comment,
            });
            break;
        }
        if is_hash_comment && c == '#' {
            tokens.push(TokenSpan {
                start: i,
                end: len,
                kind: TokenKind::Comment,
            });
            break;
        }

        // 块注释（单行内）
        if is_slash_comment && c == '/' && i + 1 < len && chars[i + 1] == '*' {
            let start = i;
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(len);
            tokens.push(TokenSpan {
                start,
                end: i,
                kind: TokenKind::Comment,
            });
            continue;
        }

        // 字符串
        if c == '"' || c == '\'' || (c == '`' && matches!(language, "typescript" | "javascript" | "go")) {
            let quote = c;
            let start = i;
            i += 1;
            while i < len {
                if chars[i] == '\\' && i + 1 < len {
                    i += 2;
                    continue;
                }
                if chars[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            // JSON 键名识别
            let mut kind = TokenKind::String;
            if language == "json" {
                let mut look = i;
                while look < len && chars[look].is_whitespace() {
                    look += 1;
                }
                if look < len && chars[look] == ':' {
                    kind = TokenKind::Property;
                }
            }
            tokens.push(TokenSpan {
                start,
                end: i,
                kind,
            });
            continue;
        }

        // 数字
        if c.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < len
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '.' || chars[i] == '_')
            {
                i += 1;
            }
            tokens.push(TokenSpan {
                start,
                end: i,
                kind: TokenKind::Number,
            });
            continue;
        }

        // 标识符 / 关键字 / 类型 / 函数
        if c.is_alphabetic() || c == '_' {
            let start = i;
            i += 1;
            while i < len && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            let kind = if is_keyword(&word, language) {
                TokenKind::Keyword
            } else if word.chars().next().is_some_and(|ch| ch.is_ascii_uppercase()) {
                TokenKind::Type
            } else if i < len && (chars[i] == '(' || (language == "rust" && chars[i] == '!')) {
                TokenKind::Function
            } else {
                TokenKind::Plain
            };
            if kind != TokenKind::Plain {
                tokens.push(TokenSpan {
                    start,
                    end: i,
                    kind,
                });
            }
            continue;
        }

        // 运算符
        if matches!(
            c,
            '=' | '+' | '-' | '*' | '/' | '%' | '!' | '<' | '>' | '&' | '|' | '^' | ':' | '?'
        ) {
            let start = i;
            i += 1;
            while i < len
                && matches!(
                    chars[i],
                    '=' | '>' | '<' | '&' | '|' | ':' | '+' | '-' | '*'
                )
            {
                i += 1;
            }
            tokens.push(TokenSpan {
                start,
                end: i,
                kind: TokenKind::Operator,
            });
            continue;
        }

        if matches!(c, '(' | ')' | '{' | '}' | '[' | ']' | ',' | ';' | '.') {
            tokens.push(TokenSpan {
                start: i,
                end: i + 1,
                kind: TokenKind::Punctuation,
            });
        }
        i += 1;
    }

    tokens
}

fn tokenize_markdown(chars: &[char]) -> Vec<TokenSpan> {
    let len = chars.len();
    if len == 0 {
        return Vec::new();
    }
    if chars[0] == '#' {
        return vec![TokenSpan {
            start: 0,
            end: len,
            kind: TokenKind::Keyword,
        }];
    }
    if chars[0] == '>' {
        return vec![TokenSpan {
            start: 0,
            end: len,
            kind: TokenKind::Comment,
        }];
    }
    if len >= 3 && chars[0] == '`' && chars[1] == '`' && chars[2] == '`' {
        return vec![TokenSpan {
            start: 0,
            end: len,
            kind: TokenKind::String,
        }];
    }
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < len {
        if chars[i] == '`' {
            let start = i;
            i += 1;
            while i < len && chars[i] != '`' {
                i += 1;
            }
            if i < len {
                i += 1;
            }
            tokens.push(TokenSpan {
                start,
                end: i,
                kind: TokenKind::String,
            });
            continue;
        }
        i += 1;
    }
    tokens
}

fn is_keyword(word: &str, language: &str) -> bool {
    match language {
        "rust" => matches!(
            word,
            "fn" | "let"
                | "mut"
                | "pub"
                | "struct"
                | "enum"
                | "impl"
                | "trait"
                | "for"
                | "in"
                | "while"
                | "loop"
                | "if"
                | "else"
                | "match"
                | "return"
                | "use"
                | "mod"
                | "crate"
                | "self"
                | "Self"
                | "super"
                | "async"
                | "await"
                | "move"
                | "ref"
                | "where"
                | "type"
                | "const"
                | "static"
                | "unsafe"
                | "true"
                | "false"
                | "break"
                | "continue"
                | "as"
        ),
        "typescript" | "javascript" => matches!(
            word,
            "function"
                | "const"
                | "let"
                | "var"
                | "if"
                | "else"
                | "for"
                | "while"
                | "return"
                | "import"
                | "export"
                | "from"
                | "default"
                | "class"
                | "interface"
                | "type"
                | "extends"
                | "implements"
                | "new"
                | "async"
                | "await"
                | "try"
                | "catch"
                | "finally"
                | "throw"
                | "switch"
                | "case"
                | "break"
                | "continue"
                | "true"
                | "false"
                | "null"
                | "undefined"
                | "typeof"
                | "as"
                | "in"
                | "of"
        ),
        "python" => matches!(
            word,
            "def" | "class"
                | "if"
                | "elif"
                | "else"
                | "for"
                | "while"
                | "in"
                | "return"
                | "import"
                | "from"
                | "as"
                | "with"
                | "try"
                | "except"
                | "finally"
                | "raise"
                | "pass"
                | "break"
                | "continue"
                | "lambda"
                | "yield"
                | "async"
                | "await"
                | "True"
                | "False"
                | "None"
                | "and"
                | "or"
                | "not"
                | "is"
        ),
        "json" => matches!(word, "true" | "false" | "null"),
        "go" => matches!(
            word,
            "func"
                | "package"
                | "import"
                | "type"
                | "struct"
                | "interface"
                | "var"
                | "const"
                | "if"
                | "else"
                | "for"
                | "range"
                | "return"
                | "go"
                | "defer"
                | "chan"
                | "select"
                | "switch"
                | "case"
                | "default"
                | "true"
                | "false"
                | "nil"
        ),
        "c" | "cpp" => matches!(
            word,
            "int" | "char"
                | "void"
                | "float"
                | "double"
                | "bool"
                | "auto"
                | "const"
                | "static"
                | "struct"
                | "class"
                | "enum"
                | "namespace"
                | "template"
                | "typename"
                | "if"
                | "else"
                | "for"
                | "while"
                | "return"
                | "switch"
                | "case"
                | "break"
                | "continue"
                | "public"
                | "private"
                | "protected"
                | "virtual"
                | "override"
                | "nullptr"
                | "true"
                | "false"
                | "include"
        ),
        "toml" | "yaml" => matches!(word, "true" | "false" | "null"),
        _ => false,
    }
}
