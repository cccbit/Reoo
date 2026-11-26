import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  FilePlus2,
  Maximize2,
  Minus,
  Monitor,
  Moon,
  PanelLeft,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-solid";
import {
  AccentColor,
  api,
  FontFamilyId,
  StartupMode,
  TabMeta,
  ThemeMode,
  ViewportSnapshot,
  WorkspaceFileEntry,
} from "./api/bridge";
import { getDict, Locale } from "./i18n";
import { EditorViewport, FindMode } from "./editor/EditorViewport";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette, PaletteCommand } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
import { ConfirmCloseDialog } from "./components/ConfirmCloseDialog";
import { MenuBar, TopMenuGroup } from "./components/MenuBar";
import reooIcon from "./assets/reoo-icon.png";

function applyColorSchemeMeta(mode: ThemeMode) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  const content = mode === "system" ? "light dark" : mode;
  if (meta) {
    meta.content = content;
  }
  try {
    if (mode === "system") {
      localStorage.removeItem("reoo-color-scheme");
    } else {
      localStorage.setItem("reoo-color-scheme", mode);
    }
  } catch {
    // 忽略存储受限环境
  }
}

export default function App() {
  const [tabs, setTabs] = createSignal<TabMeta[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);
  const [viewport, setViewport] = createSignal<ViewportSnapshot | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = createSignal<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = createSignal<WorkspaceFileEntry[]>([]);
  const [theme, setTheme] = createSignal<ThemeMode>("system");
  const [locale, setLocale] = createSignal<Locale>("zh");
  const [accent, setAccent] = createSignal<AccentColor>("blue");
  const [startupMode, setStartupMode] = createSignal<StartupMode>("new_session");
  const [wordWrap, setWordWrap] = createSignal<boolean>(true);
  const [fontSize, setFontSize] = createSignal<number>(14);
  const [fontFamily, setFontFamily] = createSignal<FontFamilyId>("default");
  const [systemPrefersDark, setSystemPrefersDark] = createSignal(
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [sidebarMode, setSidebarMode] = createSignal<"files" | "search">("files");
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [palettePrefix, setPalettePrefix] = createSignal("");
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [confirmExitOpen, setConfirmExitOpen] = createSignal(false);
  const [findMode, setFindMode] = createSignal<FindMode>("closed");
  const [jumpLine, setJumpLine] = createSignal<number | null>(null);
  const [focusNonce, setFocusNonce] = createSignal(0);

  const t = createMemo(() => getDict(locale()));

  let currentStartLine = 0;
  let currentVisibleLines = 50;
  let hotExitTimer: number | undefined;
  let allowImmediateClose = false;

  const requestEditorFocus = () => setFocusNonce((n) => n + 1);

  const scheduleHotExitSave = () => {
    window.clearTimeout(hotExitTimer);
    hotExitTimer = window.setTimeout(() => {
      api
        .saveHotExitSession(
          activeTabId(),
          workspaceRoot(),
          theme(),
          locale(),
          accent(),
          startupMode(),
          wordWrap(),
          fontSize(),
          fontFamily()
        )
        .catch(() => {});
    }, 350);
  };

  createEffect(() => {
    applyColorSchemeMeta(theme());
  });

  createEffect(() => {
    document.documentElement.setAttribute("data-accent", accent());
  });

  createEffect(() => {
    document.documentElement.lang = locale() === "zh" ? "zh-CN" : "en";
  });

  const refreshWorkspaceIndex = async (root: string | null) => {
    if (!root) {
      setWorkspaceFiles([]);
      return;
    }
    try {
      const files = await api.listWorkspaceFiles(root);
      setWorkspaceFiles(files);
    } catch {
      setWorkspaceFiles([]);
    }
  };

  onMount(async () => {
    // 全局禁用 WebView 原生右键菜单（刷新/打印/检查元素等）
    const blockNativeContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", blockNativeContextMenu);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMqChange = (ev: MediaQueryListEvent) => setSystemPrefersDark(ev.matches);
    mq.addEventListener("change", onMqChange);

    // 兜底显示定时器：确保窗口在任何情况下都不会保持隐藏
    let windowShown = false;
    const revealWindow = () => {
      if (windowShown) return;
      windowShown = true;
      requestAnimationFrame(() => {
        api.winShow().catch(() => {});
        api.winFocus().catch(() => {});
      });
    };
    const fallbackTimer = window.setTimeout(revealWindow, 450);

    try {
      const init = await api.restoreOrInitSession(currentVisibleLines);
      setTabs(init.tabs);
      setActiveTabId(init.active_tab_id);
      setViewport(init.active_viewport);
      setWorkspaceRoot(init.workspace_root);
      setTheme(
        init.theme === "light" || init.theme === "dark" || init.theme === "system"
          ? init.theme
          : "system"
      );
      setLocale(init.locale === "en" ? "en" : "zh");
      setAccent(
        init.accent && init.accent !== ("cyan" as string)
          ? (init.accent as AccentColor)
          : "blue"
      );
      setStartupMode(
        init.startup_mode === "restore_session" ? "restore_session" : "new_session"
      );
      setWordWrap(init.word_wrap ?? true);
      setFontSize(init.font_size >= 11 && init.font_size <= 26 ? init.font_size : 14);
      setFontFamily((init.font_family as FontFamilyId) || "default");
      // 首屏数据落位后立即呈现窗口，彻底消除 WebView2 初始化黑屏
      revealWindow();
      requestEditorFocus();

      // 工作区文件索引延后在后台静默构建，完全不阻塞冷启动首帧
      if (init.workspace_root) {
        const root = init.workspace_root;
        window.setTimeout(() => {
          refreshWorkspaceIndex(root);
        }, 500);
      }
    } catch {
      revealWindow();
    } finally {
      window.clearTimeout(fallbackTimer);
    }

    // 全局快捷键全面对齐 VS Code
    const onGlobalKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const lower = e.key.toLowerCase();

      if (e.key === "F1" || (ctrl && shift && lower === "p")) {
        e.preventDefault();
        setPalettePrefix(">");
        setPaletteOpen(true);
      } else if (ctrl && !shift && lower === "p") {
        e.preventDefault();
        setPalettePrefix("");
        setPaletteOpen(true);
      } else if (ctrl && !shift && lower === "g") {
        e.preventDefault();
        setPalettePrefix(":");
        setPaletteOpen(true);
      } else if (ctrl && lower === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (ctrl && lower === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (ctrl && shift && lower === "f") {
        e.preventDefault();
        setSidebarOpen(true);
        setSidebarMode("search");
      } else if (ctrl && !shift && lower === "f") {
        e.preventDefault();
        setFindMode("find");
      } else if (ctrl && !shift && lower === "h") {
        e.preventDefault();
        setFindMode("replace");
      } else if (ctrl && !shift && lower === "n") {
        e.preventDefault();
        handleNewFile();
      } else if (ctrl && !shift && lower === "o") {
        e.preventDefault();
        handlePickFile();
      } else if (ctrl && shift && lower === "s") {
        e.preventDefault();
        handleSaveAs();
      } else if (ctrl && !shift && lower === "s") {
        e.preventDefault();
        handleSaveActive();
      } else if (e.altKey && !ctrl && !shift && lower === "z") {
        e.preventDefault();
        setWordWrapMode(!wordWrap());
      } else if (ctrl && !shift && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setFontSizeMode(Math.min(26, fontSize() + 1));
      } else if (ctrl && !shift && e.key === "-") {
        e.preventDefault();
        setFontSizeMode(Math.max(11, fontSize() - 1));
      } else if (ctrl && !shift && e.key === "0") {
        e.preventDefault();
        setFontSizeMode(14);
      } else if (ctrl && !shift && lower === "w") {
        e.preventDefault();
        const id = activeTabId();
        if (id) handleCloseTab(id);
      }
    };

    const unlistenClose = await api.onWinCloseRequested((event) => {
      if (allowImmediateClose) return;
      const dirtyList = tabs().filter((item) => item.dirty);
      if (dirtyList.length > 0) {
        event.preventDefault();
        setConfirmExitOpen(true);
      } else {
        event.preventDefault();
        finalizeAndExit();
      }
    });

    window.addEventListener("keydown", onGlobalKey);
    onCleanup(() => {
      unlistenClose();
      window.removeEventListener("contextmenu", blockNativeContextMenu);
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("keydown", onGlobalKey);
      window.clearTimeout(hotExitTimer);
    });
  });

  const activeTab = () => tabs().find((item) => item.id === activeTabId()) ?? null;

  const syncViewportMeta = (vp: ViewportSnapshot) => {
    setViewport(vp);
    const id = activeTabId();
    if (id) {
      setTabs((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, dirty: vp.dirty, language: vp.language } : item
        )
      );
    }
    scheduleHotExitSave();
  };

  const runBufferAction = async (
    fn: (tabId: string, start: number, count: number) => Promise<ViewportSnapshot>
  ) => {
    const id = activeTabId();
    if (!id) return;
    const vp = await fn(id, currentStartLine, currentVisibleLines);
    syncViewportMeta(vp);
    requestEditorFocus();
  };

  const switchTab = async (tabId: string) => {
    setActiveTabId(tabId);
    currentStartLine = 0;
    const vp = await api.getViewport(tabId, 0, currentVisibleLines);
    setViewport(vp);
    requestEditorFocus();
    scheduleHotExitSave();
  };

  const handleOpenFile = async (path: string, line?: number) => {
    const start = line !== undefined ? Math.max(0, line - 6) : 0;
    const res = await api.openFile(path, start, currentVisibleLines);
    setTabs((prev) =>
      prev.some((item) => item.id === res.tab.id) ? prev : [...prev, res.tab]
    );
    setActiveTabId(res.tab.id);
    setViewport(res.viewport);
    if (line !== undefined) {
      const vp = await api.setCursor(res.tab.id, line, 0, false, start, currentVisibleLines);
      setViewport(vp);
      setJumpLine(line);
      setTimeout(() => setJumpLine(null), 50);
    }
    requestEditorFocus();
    scheduleHotExitSave();
  };

  const handleNewFile = async () => {
    const res = await api.createUntitledTab(currentVisibleLines, t().untitled);
    setTabs((prev) => [...prev, res.tab]);
    setActiveTabId(res.tab.id);
    setViewport(res.viewport);
    setFindMode("closed");
    requestEditorFocus();
    scheduleHotExitSave();
  };

  const handleCloseTab = async (tabId: string) => {
    await api.closeTab(tabId);
    const nextTabs = tabs().filter((item) => item.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId() === tabId) {
      const fallback = nextTabs[nextTabs.length - 1] ?? null;
      if (fallback) {
        await switchTab(fallback.id);
      } else {
        setActiveTabId(null);
        setViewport(null);
      }
    }
    scheduleHotExitSave();
  };

  const handleSaveActive = async () => {
    const tab = activeTab();
    if (!tab) return;
    let target = tab.path;
    if (!target) {
      target = await api.pickSavePath(tab.title);
      if (!target) return;
    }
    const res = await api.saveBuffer(tab.id, target, currentStartLine, currentVisibleLines);
    setTabs((prev) => prev.map((item) => (item.id === res.tab.id ? res.tab : item)));
    setViewport(res.viewport);
    requestEditorFocus();
    scheduleHotExitSave();
  };

  const handleSaveAs = async () => {
    const tab = activeTab();
    if (!tab) return;
    const target = await api.pickSavePath(tab.path ?? tab.title);
    if (!target) return;
    const res = await api.saveBuffer(tab.id, target, currentStartLine, currentVisibleLines);
    setTabs((prev) => prev.map((item) => (item.id === res.tab.id ? res.tab : item)));
    setViewport(res.viewport);
    requestEditorFocus();
    scheduleHotExitSave();
  };

  const handleSaveWithEncoding = async (encoding: string) => {
    const tab = activeTab();
    if (!tab) return;
    let target = tab.path;
    if (!target) {
      target = await api.pickSavePath(tab.title);
      if (!target) return;
    }
    const res = await api.saveBufferWithEncoding(
      tab.id,
      target,
      encoding,
      currentStartLine,
      currentVisibleLines
    );
    setTabs((prev) => prev.map((item) => (item.id === res.tab.id ? res.tab : item)));
    setViewport(res.viewport);
    requestEditorFocus();
    scheduleHotExitSave();
  };

  const handlePickFolder = async () => {
    const dir = await api.pickFolder();
    if (!dir) return;
    setWorkspaceRoot(dir);
    setSidebarOpen(true);
    setSidebarMode("files");
    await refreshWorkspaceIndex(dir);
    scheduleHotExitSave();
  };

  const handlePickFile = async () => {
    const file = await api.pickFile();
    if (file) await handleOpenFile(file);
  };

  const dirtyTabs = createMemo(() => tabs().filter((item) => item.dirty));

  const finalizeAndExit = async () => {
    allowImmediateClose = true;
    await api
      .saveHotExitSession(
        activeTabId(),
        workspaceRoot(),
        theme(),
        locale(),
        accent(),
        startupMode(),
        wordWrap(),
        fontSize(),
        fontFamily()
      )
      .catch(() => {});
    await api.exitApp();
  };

  const handleWindowClose = async () => {
    if (dirtyTabs().length > 0) {
      setConfirmExitOpen(true);
      return;
    }
    await finalizeAndExit();
  };

  const handleSaveAllAndExit = async () => {
    setConfirmExitOpen(false);
    for (const tab of dirtyTabs()) {
      let target = tab.path;
      if (!target) {
        target = await api.pickSavePath(tab.title);
        if (!target) {
          // 用户在保存对话框点击取消，中止退出
          return;
        }
      }
      const res = await api.saveBuffer(tab.id, target, currentStartLine, currentVisibleLines);
      setTabs((prev) => prev.map((item) => (item.id === res.tab.id ? res.tab : item)));
      if (tab.id === activeTabId()) {
        setViewport(res.viewport);
      }
    }
    await finalizeAndExit();
  };

  const handleDiscardAndExit = async () => {
    setConfirmExitOpen(false);
    await finalizeAndExit();
  };

  const setAccentMode = (next: AccentColor) => {
    setAccent(next);
    scheduleHotExitSave();
  };

  const setStartupModeVal = (next: StartupMode) => {
    setStartupMode(next);
    scheduleHotExitSave();
  };

  const setWordWrapMode = (next: boolean) => {
    setWordWrap(next);
    scheduleHotExitSave();
  };

  const setFontSizeMode = (next: number) => {
    setFontSize(next);
    scheduleHotExitSave();
  };

  const setFontFamilyMode = (next: FontFamilyId) => {
    setFontFamily(next);
    scheduleHotExitSave();
  };

  const setThemeMode = (mode: ThemeMode) => {
    setTheme(mode);
    scheduleHotExitSave();
  };

  const cycleTheme = () => {
    const next: ThemeMode =
      theme() === "system" ? "dark" : theme() === "dark" ? "light" : "system";
    setThemeMode(next);
  };

  const setLocaleMode = (next: Locale) => {
    setLocale(next);
    scheduleHotExitSave();
  };

  const themeLabel = () => {
    const m = theme();
    if (m === "dark") return t().themeDark;
    if (m === "light") return t().themeLight;
    return t().themeSystem;
  };

  const topMenus = createMemo<TopMenuGroup[]>(() => [
    {
      id: "file",
      label: t().menuFile,
      items: [
        { type: "item", label: t().cmdNewFile, shortcut: "Ctrl+N", action: handleNewFile },
        { type: "item", label: t().cmdOpenFile, shortcut: "Ctrl+O", action: handlePickFile },
        { type: "item", label: t().cmdOpenFolder, action: handlePickFolder },
        { type: "sep" },
        { type: "item", label: t().cmdSave, shortcut: "Ctrl+S", action: handleSaveActive },
        { type: "item", label: t().cmdSaveAs, shortcut: "Ctrl+Shift+S", action: handleSaveAs },
        {
          type: "submenu",
          label: t().cmdSaveWithEncoding,
          items: [
            { label: "UTF-8", action: () => handleSaveWithEncoding("UTF-8") },
            { label: "UTF-8 with BOM", action: () => handleSaveWithEncoding("UTF-8 with BOM") },
            { label: "GB18030 (GBK)", action: () => handleSaveWithEncoding("GB18030") },
            { label: "UTF-16LE", action: () => handleSaveWithEncoding("UTF-16LE") },
            { label: "UTF-16BE", action: () => handleSaveWithEncoding("UTF-16BE") },
          ],
        },
        {
          type: "item",
          label: t().cmdCloseTab,
          shortcut: "Ctrl+W",
          action: () => {
            const id = activeTabId();
            if (id) handleCloseTab(id);
          },
        },
      ],
    },
    {
      id: "edit",
      label: t().menuEdit,
      items: [
        { type: "item", label: t().cmdUndo, shortcut: "Ctrl+Z", action: () => runBufferAction(api.undo) },
        { type: "item", label: t().cmdRedo, shortcut: "Ctrl+Y", action: () => runBufferAction(api.redo) },
        { type: "sep" },
        {
          type: "item",
          label: t().cmdCut,
          shortcut: "Ctrl+X",
          action: async () => {
            const id = activeTabId();
            if (!id) return;
            const text = await api.selectedText(id);
            if (text) {
              await navigator.clipboard.writeText(text);
              await runBufferAction(api.backspace);
            }
          },
        },
        {
          type: "item",
          label: t().cmdCopy,
          shortcut: "Ctrl+C",
          action: async () => {
            const id = activeTabId();
            if (!id) return;
            const text = await api.selectedText(id);
            if (text) await navigator.clipboard.writeText(text);
          },
        },
        {
          type: "item",
          label: t().cmdPaste,
          shortcut: "Ctrl+V",
          action: async () => {
            const text = await navigator.clipboard.readText();
            if (text) await runBufferAction((id, s, c) => api.insertText(id, text, s, c));
          },
        },
        { type: "sep" },
        { type: "item", label: t().cmdFind, shortcut: "Ctrl+F", action: () => setFindMode("find") },
        { type: "item", label: t().cmdReplace, shortcut: "Ctrl+H", action: () => setFindMode("replace") },
        {
          type: "item",
          label: t().cmdGlobalSearch,
          shortcut: "Ctrl+Shift+F",
          action: () => {
            setSidebarOpen(true);
            setSidebarMode("search");
          },
        },
        { type: "sep" },
        {
          type: "item",
          label: t().cmdToggleComment,
          shortcut: "Ctrl+/",
          action: () => runBufferAction(api.toggleComment),
        },
        {
          type: "item",
          label: t().cmdFormatDoc,
          shortcut: "Shift+Alt+F",
          action: () => runBufferAction(api.formatDocument),
        },
      ],
    },
    {
      id: "selection",
      label: t().menuSelection,
      items: [
        { type: "item", label: t().cmdSelectAll, shortcut: "Ctrl+A", action: () => runBufferAction(api.selectAll) },
        {
          type: "item",
          label: t().cmdNextOccurrence,
          shortcut: "Ctrl+D",
          action: () => runBufferAction(api.selectNextOccurrence),
        },
        { type: "sep" },
        {
          type: "item",
          label: t().cmdDuplicateLine,
          shortcut: "Shift+Alt+↓",
          action: () => runBufferAction(api.duplicateLines),
        },
        {
          type: "item",
          label: t().cmdDeleteLine,
          shortcut: "Ctrl+Shift+K",
          action: () => runBufferAction(api.deleteLines),
        },
      ],
    },
    {
      id: "view",
      label: t().menuView,
      items: [
        {
          type: "item",
          label: t().cmdCommandPalette,
          shortcut: "Ctrl+Shift+P",
          action: () => {
            setPalettePrefix(">");
            setPaletteOpen(true);
          },
        },
        {
          type: "item",
          label: t().cmdGotoLine,
          shortcut: "Ctrl+G",
          action: () => {
            setPalettePrefix(":");
            setPaletteOpen(true);
          },
        },
        { type: "sep" },
        {
          type: "item",
          label: t().cmdToggleSidebar,
          shortcut: "Ctrl+B",
          action: () => setSidebarOpen((v) => !v),
        },
        {
          type: "item",
          label: t().cmdToggleWordWrap,
          shortcut: "Alt+Z",
          action: () => setWordWrapMode(!wordWrap()),
        },
        {
          type: "item",
          label: t().cmdSettings,
          shortcut: "Ctrl+,",
          action: () => setSettingsOpen(true),
        },
      ],
    },
  ]);

  const commands = createMemo<PaletteCommand[]>(() => [
    { id: "new", label: t().cmdNewFile, shortcut: "Ctrl+N", run: handleNewFile },
    { id: "open-file", label: t().cmdOpenFile, shortcut: "Ctrl+O", run: handlePickFile },
    { id: "open-folder", label: t().cmdOpenFolder, run: handlePickFolder },
    { id: "save", label: t().cmdSave, shortcut: "Ctrl+S", run: handleSaveActive },
    { id: "save-as", label: t().cmdSaveAs, shortcut: "Ctrl+Shift+S", run: handleSaveAs },
    { id: "find", label: t().cmdFind, shortcut: "Ctrl+F", run: () => setFindMode("find") },
    { id: "replace", label: t().cmdReplace, shortcut: "Ctrl+H", run: () => setFindMode("replace") },
    {
      id: "format",
      label: t().cmdFormatDoc,
      shortcut: "Shift+Alt+F",
      run: () => runBufferAction(api.formatDocument),
    },
    {
      id: "ws-search",
      label: t().cmdGlobalSearch,
      shortcut: "Ctrl+Shift+F",
      run: () => {
        setSidebarOpen(true);
        setSidebarMode("search");
      },
    },
    {
      id: "toggle-sidebar",
      label: t().cmdToggleSidebar,
      shortcut: "Ctrl+B",
      run: () => setSidebarOpen((v) => !v),
    },
    {
      id: "toggle-word-wrap",
      label: t().cmdToggleWordWrap,
      shortcut: "Alt+Z",
      run: () => setWordWrapMode(!wordWrap()),
    },
    {
      id: "settings",
      label: t().cmdSettings,
      shortcut: "Ctrl+,",
      run: () => setSettingsOpen(true),
    },
    {
      id: "theme-system",
      label: t().cmdThemeSystem(systemPrefersDark()),
      run: () => setThemeMode("system"),
    },
    {
      id: "theme-dark",
      label: t().cmdThemeDark,
      run: () => setThemeMode("dark"),
    },
    {
      id: "theme-light",
      label: t().cmdThemeLight,
      run: () => setThemeMode("light"),
    },
    {
      id: "lang-zh",
      label: t().cmdLangZh,
      run: () => setLocaleMode("zh"),
    },
    {
      id: "lang-en",
      label: t().cmdLangEn,
      run: () => setLocaleMode("en"),
    },
  ]);

  const handleJumpLine = async (line: number) => {
    const id = activeTabId();
    if (!id) return;
    const start = Math.max(0, line - 6);
    const vp = await api.setCursor(id, line, 0, false, start, currentVisibleLines);
    setViewport(vp);
    setJumpLine(line);
    setTimeout(() => setJumpLine(null), 50);
  };

  return (
    <div class="app-shell">
      {/* 36px 一体化无边框顶栏（融入极简菜单栏 + 标签页 + 搜索与设置图标） */}
      <header class="titlebar" data-tauri-drag-region>
        <div class="titlebar-left">
          <button
            class="brand-pill"
            title={t().openFolder}
            onClick={handlePickFolder}
          >
            <img src={reooIcon} class="brand-icon" alt="Reoo" />
            <span>Reoo</span>
          </button>

          <MenuBar menus={topMenus()} />

          <button
            class="icon-btn"
            title={t().toggleSidebar}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <PanelLeft size={15} />
          </button>
          <button class="icon-btn" title={t().newFile} onClick={handleNewFile}>
            <FilePlus2 size={15} />
          </button>
        </div>

        {/* 融入顶栏的极简标签条 */}
        <div class="tabs-strip" data-tauri-drag-region>
          <For each={tabs()}>
            {(tab) => (
              <div
                class={`tab-item${tab.id === activeTabId() ? " active" : ""}`}
                onClick={() => switchTab(tab.id)}
                title={tab.path ?? tab.title}
              >
                <span class="tab-title">{tab.title}</span>
                <Show when={tab.dirty}>
                  <span class="tab-dirty" title={t().unsaved} />
                </Show>
                <button
                  class="tab-close"
                  aria-label={t().closeTab}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </For>
        </div>

        <div class="titlebar-right">
          <button
            class="icon-btn"
            title={t().commandCenter}
            aria-label={t().commandCenter}
            onClick={() => {
              setPalettePrefix("");
              setPaletteOpen(true);
            }}
          >
            <Search size={15} />
          </button>

          <button
            class="icon-btn"
            title={t().settings}
            aria-label={t().settings}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={15} />
          </button>

          <div class="win-controls">
            <button class="win-btn" title={t().minimize} onClick={() => api.winMinimize()}>
              <Minus size={14} />
            </button>
            <button class="win-btn" title={t().maximize} onClick={() => api.winToggleMaximize()}>
              <Maximize2 size={12} />
            </button>
            <button class="win-btn close" title={t().close} onClick={handleWindowClose}>
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* 工作区主体 */}
      <main class="workspace-body">
        <Show when={sidebarOpen()}>
          <Sidebar
            mode={sidebarMode()}
            workspaceRoot={workspaceRoot()}
            activePath={activeTab()?.path ?? null}
            t={t()}
            onModeChange={setSidebarMode}
            onPickFolder={handlePickFolder}
            onOpenFile={handleOpenFile}
          />
        </Show>

        <EditorViewport
          tabId={activeTabId()}
          viewport={viewport()}
          findMode={findMode()}
          focusNonce={focusNonce()}
          wordWrap={wordWrap()}
          fontSize={fontSize()}
          fontFamily={fontFamily()}
          t={t()}
          onFindModeChange={setFindMode}
          onViewportUpdate={syncViewportMeta}
          onScrollLineChange={(s, c) => {
            currentStartLine = s;
            currentVisibleLines = c;
          }}
          onJumpToLine={jumpLine()}
        />
      </main>

      {/* 24px 极简核心状态栏 */}
      <footer class="statusbar">
        <div class="status-group">
          <Show when={viewport()?.large_file_mode}>
            <span class="status-pill accent">{t().largeFile}</span>
          </Show>
          <Show when={(viewport()?.cursor_count ?? 1) > 1}>
            <span class="status-pill accent">
              {t().cursorsCount(viewport()?.cursor_count ?? 1)}
            </span>
          </Show>
          <Show when={activeTab()?.title}>
            <span class="status-pill">{activeTab()?.title}</span>
          </Show>
        </div>

        <div class="status-group">
          <Show when={viewport()}>
            {(vp) => (
              <>
                <span class="status-pill">
                  {t().lineCol(vp().primary_line + 1, vp().primary_col + 1)}
                </span>
                <span class="status-pill">{vp().encoding}</span>
                <span class="status-pill">{vp().line_ending}</span>
                <span class="status-pill" style={{ "text-transform": "uppercase" }}>
                  {vp().language}
                </span>
              </>
            )}
          </Show>
          <button
            class="status-btn"
            title={t().themeTooltip(themeLabel())}
            aria-label={t().themeTooltip(themeLabel())}
            onClick={cycleTheme}
          >
            {theme() === "dark" ? (
              <Moon size={12} />
            ) : theme() === "light" ? (
              <Sun size={12} />
            ) : (
              <Monitor size={12} />
            )}
          </button>
        </div>
      </footer>

      <CommandPalette
        open={paletteOpen()}
        initialQuery={palettePrefix()}
        files={workspaceFiles()}
        commands={commands()}
        t={t()}
        onClose={() => {
          setPaletteOpen(false);
          requestEditorFocus();
        }}
        onOpenFile={(p) => handleOpenFile(p)}
        onJumpLine={handleJumpLine}
      />

      <SettingsDialog
        open={settingsOpen()}
        theme={theme()}
        locale={locale()}
        accent={accent()}
        startupMode={startupMode()}
        wordWrap={wordWrap()}
        fontSize={fontSize()}
        fontFamily={fontFamily()}
        t={t()}
        onClose={() => {
          setSettingsOpen(false);
          requestEditorFocus();
        }}
        onThemeChange={setThemeMode}
        onLocaleChange={setLocaleMode}
        onAccentChange={setAccentMode}
        onStartupModeChange={setStartupModeVal}
        onWordWrapChange={setWordWrapMode}
        onFontSizeChange={setFontSizeMode}
        onFontFamilyChange={setFontFamilyMode}
      />

      <ConfirmCloseDialog
        open={confirmExitOpen()}
        dirtyTabs={dirtyTabs()}
        t={t()}
        onSaveAndExit={handleSaveAllAndExit}
        onDiscardAndExit={handleDiscardAndExit}
        onCancel={() => {
          setConfirmExitOpen(false);
          requestEditorFocus();
        }}
      />
    </div>
  );
}
