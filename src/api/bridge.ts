import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export type TokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "type"
  | "function"
  | "operator"
  | "property"
  | "punctuation";

export interface TokenSpan {
  start: number;
  end: number;
  kind: TokenKind;
}

export interface ViewportLine {
  line_index: number;
  text: string;
  tokens: TokenSpan[];
}

export interface CursorView {
  line: number;
  col: number;
  is_primary: boolean;
}

export interface SelectionRangeView {
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
}

export interface ViewportSnapshot {
  total_lines: number;
  total_chars: number;
  start_line: number;
  lines: ViewportLine[];
  cursors: CursorView[];
  selections: SelectionRangeView[];
  primary_line: number;
  primary_col: number;
  cursor_count: number;
  dirty: boolean;
  encoding: string;
  line_ending: "LF" | "CRLF";
  language: string;
  large_file_mode: boolean;
  version: number;
}

export interface TabMeta {
  id: string;
  title: string;
  path: string | null;
  dirty: boolean;
  language: string;
}

export interface TabOpenResponse {
  tab: TabMeta;
  viewport: ViewportSnapshot;
}

export type ThemeMode = "dark" | "light" | "system";
export type StartupMode = "new_session" | "restore_session";
export type FontFamilyId =
  | "default"
  | "cascadia"
  | "jetbrains"
  | "fira"
  | "consolas"
  | "yahei_mono";

export const FONT_FAMILY_CSS: Record<FontFamilyId, string> = {
  default:
    '"JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", "PingFang SC", "Microsoft YaHei", monospace',
  cascadia: '"Cascadia Code", "Cascadia Mono", "Consolas", "Microsoft YaHei", monospace',
  jetbrains: '"JetBrains Mono", "Consolas", "PingFang SC", "Microsoft YaHei", monospace',
  fira: '"Fira Code", "Consolas", "PingFang SC", "Microsoft YaHei", monospace',
  consolas: '"Consolas", "Courier New", "Microsoft YaHei", monospace',
  yahei_mono: '"Cascadia Mono", "Consolas", "Microsoft YaHei UI", "PingFang SC", monospace',
};

export type AccentColor =
  | "blue"
  | "indigo"
  | "violet"
  | "emerald"
  | "amber"
  | "rose"
  | "slate";

export interface InitSessionResponse {
  workspace_root: string | null;
  theme: ThemeMode;
  locale: "zh" | "en";
  accent: AccentColor;
  startup_mode: StartupMode;
  word_wrap: boolean;
  font_size: number;
  font_family: FontFamilyId;
  active_tab_id: string | null;
  tabs: TabMeta[];
  active_viewport: ViewportSnapshot | null;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface WorkspaceFileEntry {
  path: string;
  relative_path: string;
  name: string;
}

export interface WorkspaceSearchHit {
  path: string;
  relative_path: string;
  line: number;
  preview: string;
}

export interface SearchMatch {
  line: number;
  start_col: number;
  end_col: number;
  start_char: number;
  end_char: number;
  line_text: string;
}

export type MoveDir =
  | "left"
  | "right"
  | "up"
  | "down"
  | "line_start"
  | "line_end"
  | "doc_start"
  | "doc_end";

export const api = {
  restoreOrInitSession: (viewportLines: number) =>
    invoke<InitSessionResponse>("restore_or_init_session", { viewportLines }),

  saveHotExitSession: (
    activeTabId: string | null,
    workspaceRoot: string | null,
    theme: ThemeMode,
    locale: "zh" | "en",
    accent: AccentColor,
    startupMode: StartupMode,
    wordWrap: boolean,
    fontSize: number,
    fontFamily: FontFamilyId
  ) =>
    invoke<void>("save_hot_exit_session", {
      activeTabId,
      workspaceRoot,
      theme,
      locale,
      accent,
      startupMode,
      wordWrap,
      fontSize,
      fontFamily,
    }),

  openFile: (path: string, startLine: number, lineCount: number) =>
    invoke<TabOpenResponse>("open_file", { path, startLine, lineCount }),

  createUntitledTab: (lineCount: number, title?: string, language?: string) =>
    invoke<TabOpenResponse>("create_untitled_tab", { title, language, lineCount }),

  closeTab: (tabId: string) => invoke<void>("close_tab", { tabId }),

  saveBuffer: (
    tabId: string,
    targetPath: string | null,
    startLine: number,
    lineCount: number
  ) =>
    invoke<TabOpenResponse>("save_buffer", {
      tabId,
      targetPath,
      startLine,
      lineCount,
    }),

  saveBufferWithEncoding: (
    tabId: string,
    targetPath: string | null,
    encoding: string,
    startLine: number,
    lineCount: number
  ) =>
    invoke<TabOpenResponse>("save_buffer_with_encoding", {
      tabId,
      targetPath,
      encoding,
      startLine,
      lineCount,
    }),

  getViewport: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("get_viewport", { tabId, startLine, lineCount }),

  insertText: (tabId: string, text: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_insert_text", { tabId, text, startLine, lineCount }),

  backspace: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_backspace", { tabId, startLine, lineCount }),

  deleteForward: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_delete_forward", { tabId, startLine, lineCount }),

  moveCursors: (
    tabId: string,
    dir: MoveDir,
    extend: boolean,
    word: boolean,
    startLine: number,
    lineCount: number
  ) =>
    invoke<ViewportSnapshot>("buffer_move_cursors", {
      tabId,
      dir,
      extend,
      word,
      startLine,
      lineCount,
    }),

  setCursor: (
    tabId: string,
    line: number,
    col: number,
    extend: boolean,
    startLine: number,
    lineCount: number
  ) =>
    invoke<ViewportSnapshot>("buffer_set_cursor", {
      tabId,
      line,
      col,
      extend,
      startLine,
      lineCount,
    }),

  addCursor: (
    tabId: string,
    line: number,
    col: number,
    startLine: number,
    lineCount: number
  ) =>
    invoke<ViewportSnapshot>("buffer_add_cursor", {
      tabId,
      line,
      col,
      startLine,
      lineCount,
    }),

  selectWord: (
    tabId: string,
    line: number,
    col: number,
    startLine: number,
    lineCount: number
  ) =>
    invoke<ViewportSnapshot>("buffer_select_word", {
      tabId,
      line,
      col,
      startLine,
      lineCount,
    }),

  selectLine: (
    tabId: string,
    line: number,
    startLine: number,
    lineCount: number
  ) =>
    invoke<ViewportSnapshot>("buffer_select_line", {
      tabId,
      line,
      startLine,
      lineCount,
    }),

  replaceLineRange: (
    tabId: string,
    line: number,
    startCol: number,
    endCol: number,
    replacement: string,
    startLine: number,
    lineCount: number
  ) =>
    invoke<ViewportSnapshot>("buffer_replace_line_range", {
      tabId,
      line,
      startCol,
      endCol,
      replacement,
      startLine,
      lineCount,
    }),

  formatDocument: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_format_document", {
      tabId,
      startLine,
      lineCount,
    }),

  gotoDefinition: (tabId: string, lineCount: number) =>
    invoke<[number, ViewportSnapshot] | null>("buffer_goto_definition", {
      tabId,
      lineCount,
    }),

  selectAll: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_select_all", { tabId, startLine, lineCount }),

  selectNextOccurrence: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_select_next_occurrence", {
      tabId,
      startLine,
      lineCount,
    }),

  clearExtraCursors: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_clear_extra_cursors", {
      tabId,
      startLine,
      lineCount,
    }),

  duplicateLines: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_duplicate_lines", { tabId, startLine, lineCount }),

  deleteLines: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_delete_lines", { tabId, startLine, lineCount }),

  indentLines: (
    tabId: string,
    outdent: boolean,
    startLine: number,
    lineCount: number
  ) =>
    invoke<ViewportSnapshot>("buffer_indent_lines", {
      tabId,
      outdent,
      startLine,
      lineCount,
    }),

  toggleComment: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_toggle_comment", { tabId, startLine, lineCount }),

  undo: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_undo", { tabId, startLine, lineCount }),

  redo: (tabId: string, startLine: number, lineCount: number) =>
    invoke<ViewportSnapshot>("buffer_redo", { tabId, startLine, lineCount }),

  selectedText: (tabId: string) =>
    invoke<string>("buffer_selected_text", { tabId }),

  findInBuffer: (
    tabId: string,
    query: string,
    caseSensitive: boolean,
    useRegex: boolean
  ) =>
    invoke<SearchMatch[]>("buffer_find", { tabId, query, caseSensitive, useRegex }),

  replaceAllInBuffer: (
    tabId: string,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    useRegex: boolean,
    startLine: number,
    lineCount: number
  ) =>
    invoke<[number, ViewportSnapshot]>("buffer_replace_all", {
      tabId,
      query,
      replacement,
      caseSensitive,
      useRegex,
      startLine,
      lineCount,
    }),

  listDir: (dir: string) => invoke<FileNode[]>("workspace_list_dir", { dir }),
  listWorkspaceFiles: (root: string) =>
    invoke<WorkspaceFileEntry[]>("workspace_list_files", { root }),
  searchWorkspace: (
    root: string,
    query: string,
    caseSensitive: boolean,
    useRegex: boolean
  ) =>
    invoke<WorkspaceSearchHit[]>("workspace_search", {
      root,
      query,
      caseSensitive,
      useRegex,
    }),

  getAppVersion: () => invoke<string>("get_app_version"),
  exitApp: () => invoke<void>("exit_app"),
  openExternalUrl: (url: string) => invoke<void>("open_external_url", { url }),
  shellMenuStatus: () => invoke<boolean>("shell_menu_status"),
  setShellContextMenu: (enabled: boolean) =>
    invoke<boolean>("set_shell_context_menu", { enabled }),

  pickFolder: async (): Promise<string | null> => {
    const res = await openDialog({ directory: true, multiple: false, title: "打开工作区文件夹" });
    return typeof res === "string" ? res : null;
  },

  pickFile: async (): Promise<string | null> => {
    const res = await openDialog({ directory: false, multiple: false, title: "打开文件" });
    return typeof res === "string" ? res : null;
  },

  pickSavePath: async (defaultName?: string): Promise<string | null> => {
    const res = await saveDialog({ title: "保存文件", defaultPath: defaultName });
    return typeof res === "string" ? res : null;
  },

  winMinimize: () => getCurrentWindow().minimize(),
  winToggleMaximize: () => getCurrentWindow().toggleMaximize(),
  winClose: () => getCurrentWindow().close(),
  winShow: () => getCurrentWindow().show(),
  winFocus: () => getCurrentWindow().setFocus(),
  onWinCloseRequested: (handler: (event: { preventDefault: () => void }) => void) =>
    getCurrentWindow().onCloseRequested(handler),
};
