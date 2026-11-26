import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { ChevronDown, ChevronRight, ChevronUp, Replace, ReplaceAll, X } from "lucide-solid";
import {
  api,
  FONT_FAMILY_CSS,
  FontFamilyId,
  MoveDir,
  SearchMatch,
  TokenSpan,
  ViewportLine,
  ViewportSnapshot,
} from "../api/bridge";
import { I18nDict } from "../i18n";
import { ColorDecoration, cssColorToHex, findColorDecorations } from "./colorSwatch";
import {
  hitTestColumn,
  makeCanvasFont,
  measurePrefixWidth,
  VisualRow,
  wrapLineIntoVisualRows,
} from "./textMeasure";

const GUTTER_WIDTH = 58;

export type FindMode = "closed" | "find" | "replace";

interface EditorViewportProps {
  tabId: string | null;
  viewport: ViewportSnapshot | null;
  findMode: FindMode;
  focusNonce: number;
  wordWrap: boolean;
  fontSize: number;
  fontFamily: FontFamilyId;
  t: I18nDict;
  onFindModeChange: (mode: FindMode) => void;
  onViewportUpdate: (vp: ViewportSnapshot) => void;
  onScrollLineChange: (startLine: number, visibleLines: number) => void;
  onJumpToLine?: number | null;
}

type RenderPiece =
  | { type: "swatch"; color: string; startCol: number; endCol: number }
  | { type: "text"; text: string; kind: string };

interface ActiveColorTarget {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

function buildSliceRenderPieces(
  chars: string[],
  tokens: TokenSpan[],
  colors: ColorDecoration[],
  sliceStart: number,
  sliceEnd: number
): RenderPiece[] {
  if (sliceStart >= sliceEnd) return [];

  const baseSpans: { start: number; end: number; kind: string }[] = [];
  let cursor = sliceStart;
  for (const tok of tokens) {
    if (tok.end <= sliceStart) continue;
    if (tok.start >= sliceEnd) break;
    const s = Math.max(cursor, Math.min(tok.start, sliceEnd));
    const e = Math.max(s, Math.min(tok.end, sliceEnd));
    if (s > cursor) baseSpans.push({ start: cursor, end: s, kind: "plain" });
    if (e > s) baseSpans.push({ start: s, end: e, kind: tok.kind });
    cursor = e;
  }
  if (cursor < sliceEnd) {
    baseSpans.push({ start: cursor, end: sliceEnd, kind: "plain" });
  }

  const sliceColors = colors.filter((c) => c.startCol >= sliceStart && c.startCol < sliceEnd);
  if (sliceColors.length === 0) {
    return baseSpans.map((sp) => ({
      type: "text",
      text: chars.slice(sp.start, sp.end).join(""),
      kind: sp.kind,
    }));
  }

  const pieces: RenderPiece[] = [];
  let colorIdx = 0;

  for (const sp of baseSpans) {
    let pos = sp.start;
    while (colorIdx < sliceColors.length && sliceColors[colorIdx].startCol < sp.end) {
      const c = sliceColors[colorIdx];
      if (c.startCol > pos) {
        pieces.push({
          type: "text",
          text: chars.slice(pos, c.startCol).join(""),
          kind: sp.kind,
        });
        pos = c.startCol;
      }
      if (c.startCol === pos) {
        pieces.push({
          type: "swatch",
          color: c.cssColor,
          startCol: c.startCol,
          endCol: c.endCol,
        });
      }
      colorIdx++;
    }
    if (pos < sp.end) {
      pieces.push({
        type: "text",
        text: chars.slice(pos, sp.end).join(""),
        kind: sp.kind,
      });
    }
  }

  return pieces;
}

export function EditorViewport(props: EditorViewportProps) {
  let scrollerRef: HTMLDivElement | undefined;
  let viewportLayerRef: HTMLDivElement | undefined;
  let imeRef: HTMLTextAreaElement | undefined;
  let findInputRef: HTMLInputElement | undefined;
  let replaceInputRef: HTMLInputElement | undefined;
  let colorInputRef: HTMLInputElement | undefined;

  const [startLine, setStartLine] = createSignal(0);
  const [visibleLines, setVisibleLines] = createSignal(45);
  const [contentWidth, setContentWidth] = createSignal(800);
  const [isComposing, setIsComposing] = createSignal(false);

  const [findQuery, setFindQuery] = createSignal("");
  const [replaceText, setReplaceText] = createSignal("");
  const [findMatches, setFindMatches] = createSignal<SearchMatch[]>([]);
  const [activeMatchIdx, setActiveMatchIdx] = createSignal(0);

  const [colorTarget, setColorTarget] = createSignal<ActiveColorTarget | null>(null);
  const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number } | null>(null);

  const lineHeight = () => Math.max(18, Math.round(props.fontSize * 1.57));
  const fontFamilyCss = () => FONT_FAMILY_CSS[props.fontFamily] ?? FONT_FAMILY_CSS.default;
  const canvasFont = () => makeCanvasFont(props.fontSize, fontFamilyCss());

  let isDragging = false;
  let dragRafId: number | null = null;
  let lastDragEvent: MouseEvent | null = null;

  const focusEditor = () => {
    requestAnimationFrame(() => imeRef?.focus());
  };

  const recalcLayout = () => {
    if (!scrollerRef) return;
    const h = scrollerRef.clientHeight || 720;
    const w = scrollerRef.clientWidth || 900;
    const lh = lineHeight();
    const count = Math.ceil(h / lh) + 12;
    setVisibleLines(count);
    setContentWidth(Math.max(180, w - GUTTER_WIDTH - 28));
    props.onScrollLineChange(startLine(), count);
  };

  const getVisualRows = (line: ViewportLine) => {
    const colors = findColorDecorations(line.text);
    const swatchCols = colors.map((c) => c.startCol);
    const maxW = props.wordWrap ? contentWidth() : 0;
    const rows = wrapLineIntoVisualRows(line.text, maxW, swatchCols, canvasFont());
    return { colors, swatchCols, rows };
  };

  const clientPosToLineCol = (clientX: number, clientY: number) => {
    if (!scrollerRef || !props.viewport) return { lineIdx: 0, col: 0 };
    const scrollerRect = scrollerRef.getBoundingClientRect();
    const relX = clientX - scrollerRect.left + scrollerRef.scrollLeft - GUTTER_WIDTH;
    const lh = lineHeight();

    // 优先通过实际渲染的行组 DOM 精确命中（完美支持自动换行后的多视觉子行）
    if (viewportLayerRef) {
      const groups = viewportLayerRef.querySelectorAll<HTMLElement>(".editor-line-group");
      let chosen: HTMLElement | null = null;
      for (const el of groups) {
        const r = el.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) {
          chosen = el;
          break;
        }
        if (clientY < r.top && !chosen) {
          chosen = el;
          break;
        }
        chosen = el;
      }
      if (chosen) {
        const lineIdx = Number(chosen.dataset.line ?? 0);
        const lineObj = props.viewport.lines.find((l) => l.line_index === lineIdx);
        if (lineObj) {
          const r = chosen.getBoundingClientRect();
          const { swatchCols, rows } = getVisualRows(lineObj);
          const rowIdx = Math.max(
            0,
            Math.min(rows.length - 1, Math.floor((clientY - r.top) / lh))
          );
          const row = rows[rowIdx];
          const chars = Array.from(lineObj.text);
          const subText = chars.slice(row.startCol, row.endCol).join("");
          const subSwatches = swatchCols
            .filter((c) => c >= row.startCol && c < row.endCol)
            .map((c) => c - row.startCol);
          const localCol = hitTestColumn(subText, relX, subSwatches, canvasFont());
          return { lineIdx, col: row.startCol + localCol };
        }
      }
    }

    const relY = clientY - scrollerRect.top + scrollerRef.scrollTop;
    const lineIdx = Math.max(
      0,
      Math.min(props.viewport.total_lines - 1, Math.floor(relY / lh))
    );
    const lineObj = props.viewport.lines.find((l) => l.line_index === lineIdx);
    const swatchCols = lineObj ? findColorDecorations(lineObj.text).map((c) => c.startCol) : [];
    const col = lineObj ? hitTestColumn(lineObj.text, relX, swatchCols, canvasFont()) : 0;
    return { lineIdx, col };
  };

  const syncScrollAndFetch = async (targetScrollTop: number) => {
    if (!scrollerRef || !props.tabId) return;
    const lh = lineHeight();
    scrollerRef.scrollTop = Math.max(0, targetScrollTop);
    const nextStart = Math.max(0, Math.floor(scrollerRef.scrollTop / lh) - 4);
    if (nextStart !== startLine()) {
      setStartLine(nextStart);
      props.onScrollLineChange(nextStart, visibleLines());
    }
    const vp = await api.getViewport(props.tabId, nextStart, visibleLines());
    props.onViewportUpdate(vp);
  };

  onMount(() => {
    recalcLayout();
    const ro = new ResizeObserver(recalcLayout);
    if (scrollerRef) ro.observe(scrollerRef);

    const onWindowMouseMove = (e: MouseEvent) => {
      if (!isDragging || !props.tabId || !scrollerRef) return;
      lastDragEvent = e;
      if (dragRafId !== null) return;
      dragRafId = requestAnimationFrame(async () => {
        dragRafId = null;
        if (!isDragging || !lastDragEvent || !props.tabId || !scrollerRef) return;
        const ev = lastDragEvent;
        const rect = scrollerRef.getBoundingClientRect();
        const lh = lineHeight();
        if (ev.clientY < rect.top + 18) {
          scrollerRef.scrollTop = Math.max(0, scrollerRef.scrollTop - lh * 2);
        } else if (ev.clientY > rect.bottom - 18) {
          scrollerRef.scrollTop += lh * 2;
        }
        const nextStart = Math.max(0, Math.floor(scrollerRef.scrollTop / lh) - 4);
        if (nextStart !== startLine()) {
          setStartLine(nextStart);
          props.onScrollLineChange(nextStart, visibleLines());
        }
        const { lineIdx, col } = clientPosToLineCol(ev.clientX, ev.clientY);
        const vp = await api.setCursor(props.tabId, lineIdx, col, true, nextStart, visibleLines());
        props.onViewportUpdate(vp);
      });
    };

    const onWindowMouseUp = () => {
      isDragging = false;
      lastDragEvent = null;
      if (dragRafId !== null) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
    };

    const closeCtx = () => setCtxMenu(null);

    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    window.addEventListener("click", closeCtx);

    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
      window.removeEventListener("click", closeCtx);
    });
  });

  // 字号变化时重新计算可见行数
  createEffect(() => {
    const _fs = props.fontSize;
    recalcLayout();
  });

  createEffect(() => {
    const id = props.tabId;
    const _nonce = props.focusNonce;
    if (id && props.findMode === "closed") {
      focusEditor();
    }
  });

  createEffect(() => {
    const line = props.onJumpToLine;
    if (line !== null && line !== undefined && scrollerRef) {
      const lh = lineHeight();
      const targetScroll = Math.max(0, (line - 6) * lh);
      scrollerRef.scrollTop = targetScroll;
      const newStart = Math.floor(targetScroll / lh);
      setStartLine(newStart);
      props.onScrollLineChange(newStart, visibleLines());
      focusEditor();
    }
  });

  createEffect(() => {
    if (props.findMode === "find") {
      requestAnimationFrame(() => findInputRef?.focus());
    } else if (props.findMode === "replace") {
      requestAnimationFrame(() => {
        if (findQuery()) replaceInputRef?.focus();
        else findInputRef?.focus();
      });
    }
  });

  // 同步隐藏 IME 代理输入框到主光标位置
  createEffect(() => {
    const vp = props.viewport;
    if (!vp || !scrollerRef || !imeRef) return;
    const primary = vp.cursors.find((c) => c.is_primary) ?? vp.cursors[0];
    if (!primary) return;

    const lh = lineHeight();
    const rect = scrollerRef.getBoundingClientRect();
    const lineObj = vp.lines.find((l) => l.line_index === primary.line);
    let xOffset = 0;
    let extraRowY = 0;
    if (lineObj) {
      const { swatchCols, rows } = getVisualRows(lineObj);
      const row =
        rows.find(
          (r, idx) =>
            (primary.col >= r.startCol && primary.col < r.endCol) ||
            (idx === rows.length - 1 && primary.col === r.endCol)
        ) ?? rows[0];
      const chars = Array.from(lineObj.text);
      const subText = chars.slice(row.startCol, row.endCol).join("");
      const subSwatches = swatchCols
        .filter((c) => c >= row.startCol && c < row.endCol)
        .map((c) => c - row.startCol);
      xOffset = measurePrefixWidth(subText, primary.col - row.startCol, subSwatches, canvasFont());
      extraRowY = row.rowIndex * lh;
    }

    const top = rect.top + primary.line * lh + extraRowY - scrollerRef.scrollTop;
    const left = rect.left + GUTTER_WIDTH + xOffset - scrollerRef.scrollLeft;

    imeRef.style.top = `${Math.max(rect.top, Math.min(rect.bottom - lh, top))}px`;
    imeRef.style.left = `${Math.max(rect.left + GUTTER_WIDTH, Math.min(rect.right - 20, left))}px`;
  });

  const ensurePrimaryVisible = async (vp: ViewportSnapshot) => {
    if (!scrollerRef || !props.tabId) return;
    const lh = lineHeight();
    const y = vp.primary_line * lh;
    const top = scrollerRef.scrollTop;
    const h = scrollerRef.clientHeight;
    if (y < top + lh) {
      await syncScrollAndFetch(Math.max(0, y - lh * 2));
    } else if (y + lh * 2 > top + h) {
      await syncScrollAndFetch(y - h + lh * 4);
    }
  };

  const handleScroll = async () => {
    if (!scrollerRef || !props.tabId) return;
    const lh = lineHeight();
    const nextStart = Math.max(0, Math.floor(scrollerRef.scrollTop / lh) - 4);
    if (nextStart !== startLine()) {
      setStartLine(nextStart);
      props.onScrollLineChange(nextStart, visibleLines());
      const vp = await api.getViewport(props.tabId, nextStart, visibleLines());
      props.onViewportUpdate(vp);
    }
  };

  const applyAndSync = async (
    fn: (tabId: string, s: number, c: number) => Promise<ViewportSnapshot>
  ) => {
    if (!props.tabId) return;
    const vp = await fn(props.tabId, startLine(), visibleLines());
    props.onViewportUpdate(vp);
    await ensurePrimaryVisible(vp);
  };

  const handleMouseDown = async (e: MouseEvent) => {
    if (!props.tabId || !scrollerRef || !props.viewport) return;
    if (e.button !== 0) return;
    setCtxMenu(null);

    const { lineIdx, col } = clientPosToLineCol(e.clientX, e.clientY);

    if (e.altKey) {
      await applyAndSync((id, s, c) => api.addCursor(id, lineIdx, col, s, c));
    } else if (e.detail === 2) {
      await applyAndSync((id, s, c) => api.selectWord(id, lineIdx, col, s, c));
    } else if (e.detail >= 3) {
      await applyAndSync((id, s, c) => api.selectLine(id, lineIdx, s, c));
    } else {
      isDragging = true;
      await applyAndSync((id, s, c) => api.setCursor(id, lineIdx, col, e.shiftKey, s, c));
    }
    imeRef?.focus();
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menuW = 220;
    const menuH = 260;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  };

  const openColorPicker = (
    e: MouseEvent,
    lineIndex: number,
    startCol: number,
    endCol: number,
    cssColor: string
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!colorInputRef) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    colorInputRef.style.left = `${rect.left}px`;
    colorInputRef.style.top = `${rect.bottom + 4}px`;
    colorInputRef.value = cssColorToHex(cssColor);
    setColorTarget({ lineIndex, startCol, endCol });
    if (typeof colorInputRef.showPicker === "function") {
      try {
        colorInputRef.showPicker();
      } catch {
        colorInputRef.click();
      }
    } else {
      colorInputRef.click();
    }
  };

  const handleColorPicked = async (newHex: string) => {
    const target = colorTarget();
    if (!target || !props.tabId) return;
    const newLen = newHex.length;
    await applyAndSync((id, s, c) =>
      api.replaceLineRange(id, target.lineIndex, target.startCol, target.endCol, newHex, s, c)
    );
    setColorTarget({
      lineIndex: target.lineIndex,
      startCol: target.startCol,
      endCol: target.startCol + newLen,
    });
  };

  const doCopy = async () => {
    if (!props.tabId) return;
    const text = await api.selectedText(props.tabId);
    if (text) await navigator.clipboard.writeText(text);
  };

  const doCut = async () => {
    if (!props.tabId) return;
    const text = await api.selectedText(props.tabId);
    if (text) {
      await navigator.clipboard.writeText(text);
      await applyAndSync((id, s, c) => api.backspace(id, s, c));
    }
  };

  const doPaste = async () => {
    if (!props.tabId) return;
    const text = await navigator.clipboard.readText();
    if (text) {
      await applyAndSync((id, s, c) => api.insertText(id, text, s, c));
    }
  };

  const doFormat = async () => {
    await applyAndSync((id, s, c) => api.formatDocument(id, s, c));
  };

  const doGotoDef = async () => {
    if (!props.tabId) return;
    const res = await api.gotoDefinition(props.tabId, visibleLines());
    if (res) {
      const [line, vp] = res;
      props.onViewportUpdate(vp);
      await syncScrollAndFetch(Math.max(0, (line - 6) * lineHeight()));
    }
  };

  const handleKeyDown = async (e: KeyboardEvent) => {
    if (!props.tabId || isComposing()) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const lower = e.key.toLowerCase();

    if (
      (ctrl && ["p", "b", "s", "f", "h", "n", "o", "w", "g", ",", "=", "+", "-", "0"].includes(lower)) ||
      (alt && !ctrl && !shift && lower === "z") ||
      e.key === "F1"
    ) {
      return;
    }

    if (e.key === "F12") {
      e.preventDefault();
      await doGotoDef();
      return;
    }

    if (shift && alt && lower === "f") {
      e.preventDefault();
      await doFormat();
      return;
    }

    if (e.key === "Escape") {
      if (ctxMenu()) {
        setCtxMenu(null);
      } else if (props.findMode !== "closed") {
        props.onFindModeChange("closed");
      } else {
        await applyAndSync((id, s, c) => api.clearExtraCursors(id, s, c));
      }
      e.preventDefault();
      return;
    }

    if (ctrl && lower === "d" && !shift) {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.selectNextOccurrence(id, s, c));
      return;
    }

    if ((shift && alt && e.key === "ArrowDown") || (ctrl && shift && lower === "d")) {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.duplicateLines(id, s, c));
      return;
    }

    if (ctrl && shift && lower === "k") {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.deleteLines(id, s, c));
      return;
    }

    if (ctrl && e.key === "/") {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.toggleComment(id, s, c));
      return;
    }

    if (ctrl && lower === "a") {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.selectAll(id, s, c));
      return;
    }

    if (ctrl && lower === "z" && !shift) {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.undo(id, s, c));
      return;
    }

    if ((ctrl && lower === "y") || (ctrl && shift && lower === "z")) {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.redo(id, s, c));
      return;
    }

    if (ctrl && lower === "c") {
      e.preventDefault();
      await doCopy();
      return;
    }

    if (ctrl && lower === "x") {
      e.preventDefault();
      await doCut();
      return;
    }

    if (ctrl && lower === "v") {
      e.preventDefault();
      await doPaste();
      return;
    }

    const dirMap: Record<string, MoveDir> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Home: ctrl ? "doc_start" : "line_start",
      End: ctrl ? "doc_end" : "line_end",
    };

    if (e.key in dirMap) {
      e.preventDefault();
      await applyAndSync((id, s, c) =>
        api.moveCursors(
          id,
          dirMap[e.key],
          shift,
          ctrl && (e.key === "ArrowLeft" || e.key === "ArrowRight"),
          s,
          c
        )
      );
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.backspace(id, s, c));
      return;
    }

    if (e.key === "Delete") {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.deleteForward(id, s, c));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.insertText(id, "\n", s, c));
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      await applyAndSync((id, s, c) => api.indentLines(id, shift, s, c));
    }
  };

  const handleInput = async (e: InputEvent) => {
    if (isComposing() || !props.tabId) return;
    const el = e.currentTarget as HTMLTextAreaElement;
    const val = el.value;
    if (val) {
      el.value = "";
      await applyAndSync((id, s, c) => api.insertText(id, val, s, c));
    }
  };

  const handleCompositionEnd = async (e: CompositionEvent) => {
    setIsComposing(false);
    const el = e.currentTarget as HTMLTextAreaElement;
    const val = el.value;
    el.value = "";
    if (val && props.tabId) {
      await applyAndSync((id, s, c) => api.insertText(id, val, s, c));
    }
  };

  const runFind = async (q: string, preserveIndex = false) => {
    setFindQuery(q);
    if (!props.tabId || !q) {
      setFindMatches([]);
      setActiveMatchIdx(0);
      return;
    }
    const matches = await api.findInBuffer(props.tabId, q, false, false);
    setFindMatches(matches);
    if (matches.length === 0) {
      setActiveMatchIdx(0);
      return;
    }
    const nextIdx = preserveIndex ? Math.min(activeMatchIdx(), matches.length - 1) : 0;
    setActiveMatchIdx(nextIdx);
    await jumpToMatch(matches[nextIdx]);
  };

  const jumpToMatch = async (m: SearchMatch) => {
    if (!props.tabId) return;
    await applyAndSync((id, s, c) => api.setCursor(id, m.line, m.start_col, false, s, c));
  };

  const prevMatch = async () => {
    const list = findMatches();
    if (list.length === 0) return;
    const prev = (activeMatchIdx() - 1 + list.length) % list.length;
    setActiveMatchIdx(prev);
    await jumpToMatch(list[prev]);
  };

  const nextMatch = async () => {
    const list = findMatches();
    if (list.length === 0) return;
    const next = (activeMatchIdx() + 1) % list.length;
    setActiveMatchIdx(next);
    await jumpToMatch(list[next]);
  };

  const runReplaceOne = async () => {
    const list = findMatches();
    if (!props.tabId || list.length === 0) return;
    const target = list[activeMatchIdx()];
    if (!target) return;
    await applyAndSync((id, s, c) =>
      api.replaceLineRange(id, target.line, target.start_col, target.end_col, replaceText(), s, c)
    );
    await runFind(findQuery(), true);
  };

  const runReplaceAll = async () => {
    if (!props.tabId || !findQuery()) return;
    const [, vp] = await api.replaceAllInBuffer(
      props.tabId,
      findQuery(),
      replaceText(),
      false,
      false,
      startLine(),
      visibleLines()
    );
    props.onViewportUpdate(vp);
    setFindMatches([]);
  };

  const getSubRowSelections = (
    lineIdx: number,
    row: VisualRow,
    totalRows: number,
    subText: string,
    subSwatches: number[]
  ) => {
    const vp = props.viewport;
    if (!vp) return [];
    const results: { left: number; width: number; singleLine: boolean }[] = [];
    const subLen = row.endCol - row.startCol;

    for (const sel of vp.selections) {
      if (lineIdx < sel.start_line || lineIdx > sel.end_line) continue;
      const lineStartCol = lineIdx === sel.start_line ? sel.start_col : 0;
      const lineEndCol = lineIdx === sel.end_line ? sel.end_col : Number.MAX_SAFE_INTEGER;

      const s = Math.max(row.startCol, lineStartCol);
      const e = Math.min(row.endCol, lineEndCol);
      const extendsPastRow = lineEndCol > row.endCol;

      if (s > e || (s === e && !extendsPastRow)) continue;

      const singleLine =
        sel.start_line === sel.end_line &&
        sel.start_col >= row.startCol &&
        sel.end_col <= row.endCol;

      const left = measurePrefixWidth(subText, s - row.startCol, subSwatches, canvasFont());
      const right =
        extendsPastRow && row.rowIndex === totalRows - 1 && lineIdx < sel.end_line
          ? measurePrefixWidth(subText, subLen, subSwatches, canvasFont()) + 8
          : measurePrefixWidth(subText, e - row.startCol, subSwatches, canvasFont());

      results.push({ left, width: Math.max(4, right - left), singleLine });
    }
    return results;
  };

  const getSubRowFindHighlights = (
    lineIdx: number,
    row: VisualRow,
    subText: string,
    subSwatches: number[]
  ) => {
    if (props.findMode === "closed") return [];
    const list = findMatches();
    if (list.length === 0) return [];
    const curIdx = activeMatchIdx();
    const results: { left: number; width: number; active: boolean }[] = [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.line !== lineIdx) continue;
      const s = Math.max(row.startCol, m.start_col);
      const e = Math.min(row.endCol, m.end_col);
      if (s >= e) continue;
      const left = measurePrefixWidth(subText, s - row.startCol, subSwatches, canvasFont());
      const right = measurePrefixWidth(subText, e - row.startCol, subSwatches, canvasFont());
      results.push({ left, width: Math.max(4, right - left), active: i === curIdx });
    }
    return results;
  };

  const getSubRowCursors = (
    lineIdx: number,
    row: VisualRow,
    totalRows: number,
    subText: string,
    subSwatches: number[]
  ) => {
    const vp = props.viewport;
    if (!vp) return [];
    const isLast = row.rowIndex === totalRows - 1;
    return vp.cursors
      .filter(
        (c) =>
          c.line === lineIdx &&
          ((c.col >= row.startCol && c.col < row.endCol) || (isLast && c.col === row.endCol))
      )
      .map((c) => ({
        left: measurePrefixWidth(subText, c.col - row.startCol, subSwatches, canvasFont()),
        isPrimary: c.is_primary,
      }));
  };

  return (
    <div
      class="editor-stage"
      style={{
        "--editor-font-size": `${props.fontSize}px`,
        "--editor-line-height": `${lineHeight()}px`,
        "--editor-font-family": fontFamilyCss(),
      }}
      onContextMenu={handleContextMenu}
      onClick={() => props.findMode === "closed" && !ctxMenu() && imeRef?.focus()}
    >
      <input
        ref={colorInputRef}
        type="color"
        class="color-picker-hidden"
        tabindex={-1}
        aria-hidden="true"
        onInput={(e) => handleColorPicked(e.currentTarget.value)}
      />

      <Show when={props.findMode !== "closed"}>
        <div class="find-widget" onClick={(e) => e.stopPropagation()}>
          <div class="find-row">
            <button
              type="button"
              class="icon-btn"
              title={props.t.toggleReplace}
              onClick={() =>
                props.onFindModeChange(props.findMode === "replace" ? "find" : "replace")
              }
            >
              {props.findMode === "replace" ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
            <input
              ref={findInputRef}
              class="input-minimal"
              placeholder={props.t.findPlaceholder}
              value={findQuery()}
              onInput={(e) => runFind(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (e.shiftKey) prevMatch();
                  else nextMatch();
                }
                if (e.key === "Escape") {
                  props.onFindModeChange("closed");
                  focusEditor();
                }
              }}
            />
            <span class="find-count">
              {findMatches().length > 0 ? `${activeMatchIdx() + 1}/${findMatches().length}` : "0"}
            </span>
            <button class="icon-btn" title={props.t.prevMatch} onClick={prevMatch}>
              <ChevronUp size={14} />
            </button>
            <button class="icon-btn" title={props.t.nextMatch} onClick={nextMatch}>
              <ChevronDown size={14} />
            </button>
            <button
              class="icon-btn"
              title={props.t.closeFind}
              onClick={() => {
                props.onFindModeChange("closed");
                focusEditor();
              }}
            >
              <X size={14} />
            </button>
          </div>
          <Show when={props.findMode === "replace"}>
            <div class="find-row" style={{ "padding-left": "32px" }}>
              <input
                ref={replaceInputRef}
                class="input-minimal"
                placeholder={props.t.replacePlaceholder}
                value={replaceText()}
                onInput={(e) => setReplaceText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runReplaceOne();
                  if (e.key === "Escape") {
                    props.onFindModeChange("closed");
                    focusEditor();
                  }
                }}
              />
              <button class="icon-btn" title={props.t.replaceOne} onClick={runReplaceOne}>
                <Replace size={14} />
              </button>
              <button class="icon-btn" title={props.t.replaceAll} onClick={runReplaceAll}>
                <ReplaceAll size={14} />
              </button>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={ctxMenu()}>
        {(pos) => (
          <div
            class="context-menu"
            style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setCtxMenu(null);
                doGotoDef();
                focusEditor();
              }}
            >
              <span>{props.t.cmdGotoDef}</span>
              <span class="kbd-hint">F12</span>
            </button>
            <div class="menu-sep" />
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setCtxMenu(null);
                doCut();
                focusEditor();
              }}
            >
              <span>{props.t.cmdCut}</span>
              <span class="kbd-hint">Ctrl+X</span>
            </button>
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setCtxMenu(null);
                doCopy();
                focusEditor();
              }}
            >
              <span>{props.t.cmdCopy}</span>
              <span class="kbd-hint">Ctrl+C</span>
            </button>
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setCtxMenu(null);
                doPaste();
                focusEditor();
              }}
            >
              <span>{props.t.cmdPaste}</span>
              <span class="kbd-hint">Ctrl+V</span>
            </button>
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setCtxMenu(null);
                applyAndSync((id, s, c) => api.selectAll(id, s, c));
                focusEditor();
              }}
            >
              <span>{props.t.cmdSelectAll}</span>
              <span class="kbd-hint">Ctrl+A</span>
            </button>
            <div class="menu-sep" />
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setCtxMenu(null);
                doFormat();
                focusEditor();
              }}
            >
              <span>{props.t.cmdFormatDoc}</span>
              <span class="kbd-hint">Shift+Alt+F</span>
            </button>
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setCtxMenu(null);
                applyAndSync((id, s, c) => api.toggleComment(id, s, c));
                focusEditor();
              }}
            >
              <span>{props.t.cmdToggleComment}</span>
              <span class="kbd-hint">Ctrl+/</span>
            </button>
          </div>
        )}
      </Show>

      <textarea
        ref={imeRef}
        class="ime-proxy"
        aria-label={props.t.editorAria}
        autocapitalize="off"
        autocomplete="off"
        spellcheck={false}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={handleCompositionEnd}
      />

      <div
        ref={scrollerRef}
        class="editor-scroller scroller"
        style={{ "overflow-x": props.wordWrap ? "hidden" : "auto" }}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
      >
        <Show when={props.viewport}>
          {(vp) => (
            <div
              class="editor-spacer"
              style={{
                height: `${Math.max(vp().total_lines * lineHeight() + 260, 600)}px`,
              }}
            >
              <div
                ref={viewportLayerRef}
                class="editor-viewport-layer"
                style={{ transform: `translateY(${vp().start_line * lineHeight()}px)` }}
              >
                <For each={vp().lines}>
                  {(line) => {
                    const isCurrent = () => line.line_index === vp().primary_line;
                    const layout = () => getVisualRows(line);
                    const lineChars = () => Array.from(line.text);

                    return (
                      <div
                        class={`editor-line-group${isCurrent() ? " current" : ""}`}
                        data-line={line.line_index}
                      >
                        <For each={layout().rows}>
                          {(row) => {
                            const subText = () =>
                              lineChars().slice(row.startCol, row.endCol).join("");
                            const subSwatches = () =>
                              layout()
                                .swatchCols.filter((c) => c >= row.startCol && c < row.endCol)
                                .map((c) => c - row.startCol);
                            const pieces = () =>
                              buildSliceRenderPieces(
                                lineChars(),
                                line.tokens,
                                layout().colors,
                                row.startCol,
                                row.endCol
                              );
                            const sels = () =>
                              getSubRowSelections(
                                line.line_index,
                                row,
                                layout().rows.length,
                                subText(),
                                subSwatches()
                              );
                            const findHits = () =>
                              getSubRowFindHighlights(
                                line.line_index,
                                row,
                                subText(),
                                subSwatches()
                              );
                            const cursors = () =>
                              getSubRowCursors(
                                line.line_index,
                                row,
                                layout().rows.length,
                                subText(),
                                subSwatches()
                              );

                            return (
                              <div class="editor-line" data-row={row.rowIndex}>
                                <div class="line-gutter">
                                  {row.rowIndex === 0 ? line.line_index + 1 : ""}
                                </div>
                                <div class="line-content">
                                  <For each={sels()}>
                                    {(sel) => (
                                      <div
                                        class={`selection-overlay${sel.singleLine ? " single-line" : ""}`}
                                        style={{ left: `${sel.left}px`, width: `${sel.width}px` }}
                                      />
                                    )}
                                  </For>

                                  <For each={findHits()}>
                                    {(hit) => (
                                      <div
                                        class={`find-match-overlay${hit.active ? " active" : ""}`}
                                        style={{ left: `${hit.left}px`, width: `${hit.width}px` }}
                                      />
                                    )}
                                  </For>

                                  <For each={pieces()}>
                                    {(piece) =>
                                      piece.type === "swatch" ? (
                                        <span class="color-swatch-slot">
                                          <span
                                            class="color-swatch"
                                            title={props.t.pickColor}
                                            style={{ "background-color": piece.color }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={(e) =>
                                              openColorPicker(
                                                e,
                                                line.line_index,
                                                piece.startCol,
                                                piece.endCol,
                                                piece.color
                                              )
                                            }
                                          />
                                        </span>
                                      ) : piece.kind === "plain" ? (
                                        <>{piece.text}</>
                                      ) : (
                                        <span class={`tok-${piece.kind}`}>{piece.text}</span>
                                      )
                                    }
                                  </For>

                                  <For each={cursors()}>
                                    {(cur) => (
                                      <div
                                        class={`cursor-caret${cur.isPrimary ? "" : " secondary"}`}
                                        style={{ left: `${cur.left}px` }}
                                      />
                                    )}
                                  </For>
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
