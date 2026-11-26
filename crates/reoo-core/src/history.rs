use crate::selection::SelectionSet;

#[derive(Debug, Clone)]
pub struct EditOp {
    pub start: usize,
    pub end: usize,
    pub inserted: String,
    pub deleted: String,
}

#[derive(Debug, Clone)]
pub struct EditTransaction {
    /// 按文档从后往前的顺序记录的原子修改（便于精确重放与回滚）
    pub ops: Vec<EditOp>,
    pub before: SelectionSet,
    pub after: SelectionSet,
}

#[derive(Debug, Default)]
pub struct UndoHistory {
    undo_stack: Vec<EditTransaction>,
    redo_stack: Vec<EditTransaction>,
    max_depth: usize,
}

impl UndoHistory {
    pub fn new(max_depth: usize) -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_depth,
        }
    }

    pub fn push(&mut self, tx: EditTransaction) {
        if tx.ops.is_empty() {
            return;
        }
        self.redo_stack.clear();
        self.undo_stack.push(tx);
        if self.undo_stack.len() > self.max_depth {
            self.undo_stack.remove(0);
        }
    }

    pub fn pop_undo(&mut self) -> Option<EditTransaction> {
        let tx = self.undo_stack.pop()?;
        self.redo_stack.push(tx.clone());
        Some(tx)
    }

    pub fn pop_redo(&mut self) -> Option<EditTransaction> {
        let tx = self.redo_stack.pop()?;
        self.undo_stack.push(tx.clone());
        Some(tx)
    }

    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
    }
}
