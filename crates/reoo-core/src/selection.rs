use serde::{Deserialize, Serialize};

/// 单个选区（使用字符偏移量，而非字节偏移量，天然兼容中文与 Emoji）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    pub anchor: usize,
    pub head: usize,
}

impl Selection {
    pub fn caret(pos: usize) -> Self {
        Self {
            anchor: pos,
            head: pos,
        }
    }

    pub fn new(anchor: usize, head: usize) -> Self {
        Self { anchor, head }
    }

    pub fn start(&self) -> usize {
        self.anchor.min(self.head)
    }

    pub fn end(&self) -> usize {
        self.anchor.max(self.head)
    }

    pub fn is_empty(&self) -> bool {
        self.anchor == self.head
    }

    pub fn is_reversed(&self) -> bool {
        self.head < self.anchor
    }

    pub fn clamp(&self, max_char: usize) -> Self {
        Self {
            anchor: self.anchor.min(max_char),
            head: self.head.min(max_char),
        }
    }
}

/// 有序且自动去重合并的多光标选区集合
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectionSet {
    pub ranges: Vec<Selection>,
    pub primary_index: usize,
}

impl Default for SelectionSet {
    fn default() -> Self {
        Self::single(0)
    }
}

impl SelectionSet {
    pub fn single(pos: usize) -> Self {
        Self {
            ranges: vec![Selection::caret(pos)],
            primary_index: 0,
        }
    }

    pub fn from_selection(sel: Selection) -> Self {
        Self {
            ranges: vec![sel],
            primary_index: 0,
        }
    }

    pub fn primary(&self) -> Selection {
        self.ranges
            .get(self.primary_index)
            .copied()
            .unwrap_or_else(|| Selection::caret(0))
    }

    pub fn add(&mut self, sel: Selection) {
        self.ranges.push(sel);
        self.primary_index = self.ranges.len() - 1;
        self.normalize();
    }

    pub fn clear_to_primary(&mut self) {
        let p = self.primary();
        self.ranges = vec![p];
        self.primary_index = 0;
    }

    pub fn clamp(&mut self, max_char: usize) {
        for r in &mut self.ranges {
            *r = r.clamp(max_char);
        }
        self.normalize();
    }

    /// 排序并合并重叠或相邻的相同光标，同时尽量维持主光标语义
    pub fn normalize(&mut self) {
        if self.ranges.is_empty() {
            self.ranges.push(Selection::caret(0));
            self.primary_index = 0;
            return;
        }
        let primary = self.primary();
        self.ranges.sort_by_key(|r| (r.start(), r.end()));

        let mut merged: Vec<Selection> = Vec::with_capacity(self.ranges.len());
        for sel in self.ranges.drain(..) {
            if let Some(last) = merged.last_mut() {
                let overlaps = if last.is_empty() && sel.is_empty() {
                    last.start() == sel.start()
                } else {
                    sel.start() < last.end() || (sel.start() == last.end() && (last.is_empty() || sel.is_empty()))
                };
                if overlaps {
                    let new_start = last.start().min(sel.start());
                    let new_end = last.end().max(sel.end());
                    *last = if sel.is_reversed() {
                        Selection::new(new_end, new_start)
                    } else {
                        Selection::new(new_start, new_end)
                    };
                    continue;
                }
            }
            merged.push(sel);
        }

        self.ranges = merged;
        self.primary_index = self
            .ranges
            .iter()
            .position(|r| r.start() <= primary.head && primary.head <= r.end())
            .unwrap_or(self.ranges.len().saturating_sub(1));
    }
}
