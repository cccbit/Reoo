export interface ColorDecoration {
  /** 颜色字面量在当前行中的起始 Unicode 字符列号 */
  startCol: number;
  endCol: number;
  cssColor: string;
}

/** 颜色预览小方块固定占位像素宽度（10px 方块 + 5px 间距），用于精确对齐光标与选区 */
export const SWATCH_SLOT_WIDTH = 15;

// 匹配 #RGB / #RGBA / #RRGGBB / #RRGGBBAA 以及 rgb/rgba/hsl/hsla/oklch(...)
const COLOR_PATTERN =
  /(?<![0-9a-zA-Z_-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])|\b(?:rgba?|hsla?|oklch)\(\s*[^()\n]{3,64}\)/g;

function isValidCssColor(raw: string): boolean {
  if (raw.startsWith("#")) return true;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("color", raw);
  }
  return true;
}

/** 将任意合法 CSS 颜色（含 #RGB / rgb / hsl / oklch）转为 #rrggbb 供原生取色器使用 */
export function cssColorToHex(cssColor: string): string {
  const trimmed = cssColor.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1], g = trimmed[2], b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "#38bdf8";
    ctx.fillStyle = trimmed;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return "#38bdf8";
  }
}

/**
 * 扫描单行代码中的颜色字面量并返回精确的 Unicode 字符列号映射。
 * 仅作为纯视觉辅助装饰，不改动缓冲区文本内容。
 */
export function findColorDecorations(lineText: string): ColorDecoration[] {
  if (!lineText || (!lineText.includes("#") && !lineText.includes("("))) {
    return [];
  }

  const chars = Array.from(lineText);
  const utf16ToCharIdx = new Int32Array(lineText.length + 1);
  let u16 = 0;
  for (let c = 0; c < chars.length; c++) {
    const step = chars[c].length;
    for (let k = 0; k < step; k++) {
      utf16ToCharIdx[u16 + k] = c;
    }
    u16 += step;
  }
  utf16ToCharIdx[lineText.length] = chars.length;

  const decorations: ColorDecoration[] = [];
  COLOR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = COLOR_PATTERN.exec(lineText)) !== null) {
    const raw = match[0];
    if (!isValidCssColor(raw)) continue;
    const startCol = utf16ToCharIdx[match.index];
    const endCol = utf16ToCharIdx[match.index + raw.length];
    decorations.push({ startCol, endCol, cssColor: raw });
  }

  return decorations;
}
