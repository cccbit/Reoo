import { SWATCH_SLOT_WIDTH } from "./colorSwatch";

let measureCtx: CanvasRenderingContext2D | null = null;
let cachedFont = "";

function getCtx(font: string): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d")!;
  }
  if (cachedFont !== font) {
    measureCtx.font = font;
    cachedFont = font;
  }
  return measureCtx;
}

export function makeCanvasFont(fontSize: number, fontFamilyCss: string): string {
  return `${fontSize}px ${fontFamilyCss}`;
}

export interface VisualRow {
  rowIndex: number;
  startCol: number;
  endCol: number;
}

function expandTabs(str: string): string {
  return str.replace(/\t/g, "    ");
}

/**
 * 精确测量某行（或子行切片）前 col 个 Unicode 字符的像素宽度（自动计入颜色小方块占位）
 */
export function measurePrefixWidth(
  text: string,
  col: number,
  swatchCols: number[] = [],
  font: string
): number {
  let swatchOffset = 0;
  for (const sc of swatchCols) {
    if (sc < col) {
      swatchOffset += SWATCH_SLOT_WIDTH;
    } else {
      break;
    }
  }
  if (col <= 0) return swatchOffset;
  const chars = Array.from(text);
  const prefix = chars.slice(0, col).join("");
  return getCtx(font).measureText(expandTabs(prefix)).width + swatchOffset;
}

/**
 * 根据鼠标点击的相对 X 像素坐标反算最贴近的 Unicode 字符列号（跳过小方块占位）
 */
export function hitTestColumn(
  text: string,
  targetX: number,
  swatchCols: number[] = [],
  font: string
): number {
  if (targetX <= 0 || !text) return 0;
  const ctx = getCtx(font);
  const chars = Array.from(text);
  const swatchSet = swatchCols.length > 0 ? new Set(swatchCols) : null;
  let acc = 0;

  for (let i = 0; i < chars.length; i++) {
    if (swatchSet?.has(i)) {
      if (targetX < acc + SWATCH_SLOT_WIDTH * 0.5) {
        return i;
      }
      acc += SWATCH_SLOT_WIDTH;
    }
    const ch = chars[i] === "\t" ? "    " : chars[i];
    const w = ctx.measureText(ch).width;
    if (acc + w * 0.5 >= targetX) {
      return i;
    }
    acc += w;
  }
  return chars.length;
}

/**
 * 确定性自动换行布局拆分：将单行文本按可用像素宽度切分为若干等高视觉子行。
 * 当 maxWidth <= 0（关闭自动换行）时直接返回单行，保持零额外开销。
 */
export function wrapLineIntoVisualRows(
  lineText: string,
  maxWidth: number,
  swatchCols: number[],
  font: string
): VisualRow[] {
  const chars = Array.from(lineText);
  if (maxWidth <= 0 || chars.length === 0) {
    return [{ rowIndex: 0, startCol: 0, endCol: chars.length }];
  }

  const ctx = getCtx(font);
  const swatchSet = swatchCols.length > 0 ? new Set(swatchCols) : null;
  const rows: VisualRow[] = [];
  let rowStart = 0;
  let acc = 0;

  for (let i = 0; i < chars.length; i++) {
    const sw = swatchSet?.has(i) ? SWATCH_SLOT_WIDTH : 0;
    const ch = chars[i] === "\t" ? "    " : chars[i];
    const w = ctx.measureText(ch).width + sw;

    if (i > rowStart && acc + w > maxWidth) {
      rows.push({ rowIndex: rows.length, startCol: rowStart, endCol: i });
      rowStart = i;
      acc = w;
    } else {
      acc += w;
    }
  }

  rows.push({ rowIndex: rows.length, startCol: rowStart, endCol: chars.length });
  return rows;
}
