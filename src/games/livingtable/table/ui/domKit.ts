/**
 * The overlay's DOM and canvas kit: element builders, text measuring, the nine-slice pixel frames, sprite canvases.
 */
import { deviceScale } from "./pixelFont";
import type { FrameKey } from "./overlayTheme";
import { SERIF_NUM, SERIF } from "./overlayTheme";

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- DOM helpers ------------------------------------------------------------

const SVGNS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The device pixel ratio now, read each time so a zoom or a move to another screen is honoured. */
export function deviceRatio(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of a line of serif text, for sizing an SVG numeral. Falls back to a rough estimate when there is no canvas. */
export function serifWidth(text: string, px: number, weight = 800): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = `${weight} ${px}px ${SERIF_NUM}`;
    return measureCtx.measureText(text).width;
  }
  return text.length * px * 0.62;
}

/** The dialogue box's storybook text: one font, one size, so the pages are cut by what the browser will really draw. */
export const DIALOGUE_FONT = `15.5px ${SERIF}`;

/** Width of a line of text in a CSS font by the canvas's own measure, or a rough per-character guess when there is no canvas. */
export function ctxWidth(text: string, font: string, fallbackPerChar: number): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }
  return text.length * fallbackPerChar;
}

// ---- the pixel windows: nine-slice frames drawn from data -------------------
//
// One 16x16 image per colour scheme, cut at 5 px, used as a border-image with
// the middle filled. The corner is the art; edges and middle repeat its last
// column and row. "o" outline, "L" light edge, "M" mid edge, "F" fill, "." clear.

const FRAME_CORNER = ["..ooo", ".oLLL", "oLMMM", "oLMFF", "oLMFF"];
const FRAME_SLICE = 5;
const FRAME_PX = 16;

export const FRAMES: Record<FrameKey, { o: string; L: string; M: string; F: string }> = {
  win: { o: "#05061a", L: "#e6dcb4", M: "#4d5da6", F: "#141a3c" },
  gold: { o: "#1a0f00", L: "#ffe27a", M: "#b8801a", F: "#221a3a" },
  red: { o: "#1a0408", L: "#ffb4a8", M: "#b3281f", F: "#2a1226" },
  blue: { o: "#04102a", L: "#d2ecff", M: "#4a8fd8", F: "#122244" },
};

const frameUrls = new Map<FrameKey, string>();

export function frameUrl(key: FrameKey): string | null {
  const cached = frameUrls.get(key);
  if (cached) return cached;
  try {
    const pal = FRAMES[key];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = FRAME_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (let y = 0; y < FRAME_PX; y++) {
      for (let x = 0; x < FRAME_PX; x++) {
        const cx = x < FRAME_SLICE ? x : x >= FRAME_PX - FRAME_SLICE ? FRAME_PX - 1 - x : FRAME_SLICE - 1;
        const cy = y < FRAME_SLICE ? y : y >= FRAME_PX - FRAME_SLICE ? FRAME_PX - 1 - y : FRAME_SLICE - 1;
        const code = (FRAME_CORNER[cy] ?? "")[cx];
        if (!code || code === ".") continue;
        ctx.fillStyle = pal[code as "o" | "L" | "M" | "F"];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const url = canvas.toDataURL("image/png");
    frameUrls.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/** A tiny sprite from character art: each character maps to a colour, "." is clear. */
export function spriteCanvas(rows: readonly string[], colors: Record<string, string>, scale: number): HTMLCanvasElement {
  const dpr = deviceRatio();
  const k = deviceScale(scale, dpr);
  const w = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement("canvas");
  canvas.width = w * k;
  canvas.height = rows.length * k;
  canvas.style.width = `${(w * k) / dpr}px`;
  canvas.style.height = `${(rows.length * k) / dpr}px`;
  canvas.style.imageRendering = "pixelated";
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  if (ctx) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = colors[row[x] as string];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * k, y * k, k, k);
      }
    });
  }
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}

export const CARET_DOWN = ["ooooooooo", "oCCCCCCCo", ".oCCCCCo.", "..oCCCo..", "...oCo...", "....o...."];
