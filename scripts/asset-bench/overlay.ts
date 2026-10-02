/**
 * The bench's on-screen text layer: banners, floating damage numbers, roll
 * plates, the dialogue box, the initiative strip and toasts, drawn as DOM over
 * the Play canvas. "The canvas paints sprites, DOM paints type": the game's own
 * rule (the LivingTable.tsx readout comment), so this layer never touches the
 * board's pixels.
 *
 * Two treatments, switchable live with setStyle, that share one semantic palette
 * (red damage, gold crits, green healing, grey misses):
 *
 *   pixel      a chunky bitmap font (pixelFont.ts) drawn onto canvases at
 *              integer scales, in nine-slice pixel windows. No web font.
 *   storybook  system serif stacks only (Georgia, Palatino Linotype, Book
 *              Antiqua), with the ConjureOS core.css treatments replicated in
 *              this file's own CSS because the bench loads none of it: .cg-t2
 *              (a hairline stroke, a hard lip and a soft shadow on small labels)
 *              and .cg-num (SVG text with paint-order stroke-then-fill, a dark
 *              stroke, a hard-stop two-tone face and a drop shadow, for numerals
 *              and titles).
 *
 * It reads on any floor art because nothing is bare text: titles sit on a dark
 * ribbon, plates are opaque, and the floating numbers carry a dark outline and a
 * shadow. Storybook plates follow the page theme (parchment in light, ink in
 * dark) with the same selector contract the bench uses; pixel windows are one
 * fixed navy-and-cream skin in both.
 *
 * Contract with the Play lane (coordinates are CSS px from the HOST's top-left
 * corner; the host should be a non-scrolling box that frames the board, because
 * the layer is absolutely positioned inside it). Hooks for tests: every element
 * carries data-lto-* attributes, the root carries data-busy (the number of
 * animations in flight, 0 when idle), and the visible text is also in data-text
 * because pixel text is canvas.
 *
 * Layout rules that are easy to break: floats landing on one spot stack by the
 * ink really stacked there (not by their own heights); a roll plate over a point
 * starts clear of an ordinary damage number and steps up out of the way of taller
 * ones, so a verdict is never printed under a number (on a host too short for both
 * the number wins); and pixel text is laid out at the CSS size it is really drawn
 * at (cssScale in pixelFont.ts), which is not the nominal scale at a fractional
 * device pixel ratio such as 1.25, 1.75 or 2.75.
 *
 * Nothing here touches the DOM at import time (the bench registry is imported in
 * Node for validation), and this file must never be imported by src/.
 */
import type { RollReadout } from "../../src/games/livingtable/render/canvasRenderer";
import { CELL_H, LINE_GAP, cssScale, deviceScale, fitScale, pixelText, textWidth, wrapWidth, type PixelColor, type PixelRun, type PixelTextOptions } from "./pixelFont";

// ---- the public contract ----------------------------------------------------

export type TextStyle = "pixel" | "storybook";
/** CSS px relative to the overlay host. */
export interface OverlayPoint {
  x: number;
  y: number;
}
export type BannerKind = "turn" | "enemy" | "initiative" | "victory" | "defeat";
export type FloatKind = "damage" | "crit" | "heal" | "miss" | "down" | "info";
export type DialogueTone = "good" | "bad" | "plain";
export interface DialogueLine {
  speaker?: string;
  text: string;
  tone?: DialogueTone;
}
/** Which team a combatant is on, for colour coding the turn-order strip. */
export type InitiativeSide = "hero" | "enemy";
export interface InitiativeEntry {
  id: string;
  label: string;
  total: number;
  /** Optional: with it the chip is coloured (blue for a hero, red for an enemy) in both styles; without it the chip is neutral. */
  side?: InitiativeSide;
}
/**
 * What rollPlate shows. A plain RollReadout (render/rollReadoutAdapter.ts) is
 * enough; the three optional fields are the ones LivingTable.tsx's ReadoutView
 * adds, so pass them through for the natural 20 and natural 1 lines the game's
 * own readout prints (attackResultToReadout drops them).
 */
export type PlateReadout = RollReadout & { caption?: string; critical?: boolean; fumble?: boolean };

export interface Overlay {
  setStyle(style: TextStyle): void;
  /** A big centred title for about 900 ms. Banners queue; resolves when this one is gone. */
  banner(text: string, kind: BannerKind): Promise<void>;
  /** A number that rises about 16 px over about 900 ms and fades over the last 300 ms. Floats on one spot within 300 ms stack upward. */
  float(at: OverlayPoint, text: string, kind: FloatKind): void;
  /** The d20 maths near a point. Plates queue and never overwrite one another. */
  rollPlate(at: OverlayPoint, readout: PlateReadout): void;
  /** A line in the dialogue box at the bottom of the board. 2 to 3 lines show; the history scrolls. */
  say(line: DialogueLine): void;
  /** The turn-order strip above the board. An empty array hides it. */
  initiative(entries: readonly InitiativeEntry[], activeId: string | null, round: number): void;
  /** A short notice, for refused clicks. */
  toast(text: string): void;
  /** Drop everything on screen (banners resolve at once), the dialogue history and the initiative strip included. */
  clear(): void;
  destroy(): void;
}

// ---- timing (ms) ------------------------------------------------------------

const BANNER_MS = 900;
const BANNER_REDUCED_MS = 500;
const FLOAT_MS = 900;
const FLOAT_FADE_MS = 300;
const FLOAT_RISE_PX = 16;
const FLOAT_STACK_MS = 300;
/** A float's bottom edge stands this far above its anchor. */
export const FLOAT_BASE_PX = 4;
/** Clear air kept between the inked glyphs of floats stacked on one spot, and between a float and a plate. */
export const FLOAT_GAP_PX = 6;
/** The least a roll plate stands over its point, where there is no room to clear a damage number. */
const PLATE_CLEAR_MIN_PX = 54;
/** How far a roll plate's pointer sticks out below it: the storybook diamond and the pixel caret. */
const PLATE_TAIL_PX = 10;
const PLATE_TAIL_PIXEL_PX = 13;
/** The share of a numeral's font size its capitals and figures rise above the baseline (a little generous, for the fonts that stand in). */
const NUMERAL_CAP = 0.72;
const PLATE_IN_MS = 170;
const PLATE_HOLD_MS = 2000;
const PLATE_HOLD_QUEUED_MS = 1100;
const PLATE_OUT_MS = 220;
const TOAST_MS = 1900;
const TOAST_FADE_MS = 200;
const HISTORY_LIMIT = 80;

// ---- palettes ---------------------------------------------------------------

/** A numeral's face: light top, a mid tone at the cliff, a deep tone below it. */
interface Face {
  top: string;
  mid: string;
  deep: string;
  outline: string;
}

const FACES: Record<FloatKind | BannerKind, Face> = {
  damage: { top: "#ffb3a5", mid: "#ff5646", deep: "#d4302a", outline: "#2b0a0a" },
  crit: { top: "#fff4ae", mid: "#ffd34c", deep: "#e0891a", outline: "#3b1f00" },
  heal: { top: "#c8ffd6", mid: "#5be486", deep: "#1f9a49", outline: "#06260f" },
  miss: { top: "#f5f6fa", mid: "#c5c8d6", deep: "#868a9d", outline: "#15161f" },
  down: { top: "#ffffff", mid: "#fff1f1", deep: "#ff9c9c", outline: "#8f1024" },
  info: { top: "#e0f3ff", mid: "#84c9ff", deep: "#3a8de2", outline: "#08162f" },
  turn: { top: "#fff4ae", mid: "#ffd34c", deep: "#e0891a", outline: "#3b1f00" },
  enemy: { top: "#ffa293", mid: "#ff4e3f", deep: "#bd1f19", outline: "#2b0a0a" },
  initiative: { top: "#e8f6ff", mid: "#8fd0ff", deep: "#3f8fe0", outline: "#08162f" },
  victory: { top: "#fffbd0", mid: "#ffe061", deep: "#e8941a", outline: "#3b1f00" },
  defeat: { top: "#ff8f8f", mid: "#d93a48", deep: "#7c1020", outline: "#1f0409" },
};

type FrameKey = "win" | "gold" | "red" | "blue";
const BANNER_FRAME: Record<BannerKind, FrameKey> = { turn: "gold", enemy: "red", initiative: "blue", victory: "gold", defeat: "red" };

const PX = {
  ink: "#f4ecd0",
  muted: "#98a5d8",
  gold: ["#fff3ad", "#ffc72a"] as const,
  good: ["#c2ffd2", "#59dd82"] as const,
  bad: ["#ffb0a4", "#ff5a4a"] as const,
  dark: "#05061a",
  shade: "rgba(5, 6, 26, 0.6)",
};

const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif';
// Georgia's figures are old-style (a 4 sinks below the line), which reads oddly
// on a damage number, so numerals prefer the serifs whose figures are lining.
const SERIF_NUM = '"Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", Georgia, serif';

// ---- pure helpers (unit tested) --------------------------------------------

export interface RecentFloat {
  x: number;
  y: number;
  t: number;
  n: number;
  /** How high above the anchor the top of this float's inked glyphs reaches, in px. Absent counts as 0. */
  top?: number;
}

/**
 * How many floats already stand on this spot within the stacking window: 0 for
 * a lone float, otherwise one more than the highest rung in use, so numbers
 * landing together climb instead of overprinting each other.
 */
export function floatStackIndex(recent: readonly RecentFloat[], at: OverlayPoint, now: number, radius = 28): number {
  let top = -1;
  for (const r of recent) {
    if (now - r.t >= FLOAT_STACK_MS) continue;
    if (Math.hypot(r.x - at.x, r.y - at.y) >= radius) continue;
    top = Math.max(top, r.n);
  }
  return top + 1;
}

/**
 * How high above the anchor the tallest float already stacked on this spot
 * reaches, in px of ink (0 for a lone float). The next float stands its own
 * glyphs a gap above this, so a number landing on a number clears the pile by
 * what is really stacked and not by its own height.
 */
export function floatStackTop(recent: readonly RecentFloat[], at: OverlayPoint, now: number, radius = 28): number {
  let top = 0;
  for (const r of recent) {
    if (now - r.t >= FLOAT_STACK_MS) continue;
    if (Math.hypot(r.x - at.x, r.y - at.y) >= radius) continue;
    top = Math.max(top, r.top ?? 0);
  }
  return top;
}

/**
 * How far above its natural spot (FLOAT_BASE_PX over the anchor) a float's box
 * must stand for its inked glyphs to clear a stack reaching `stackTop`. `padBottom`
 * is the empty margin under the glyphs inside the box.
 */
export function floatLift(stackTop: number, padBottom: number): number {
  return stackTop > 0 ? Math.max(0, stackTop + FLOAT_GAP_PX - FLOAT_BASE_PX - padBottom) : 0;
}

/** Size tier from the host's width: phones, in between, wide. */
export function sizeTier(width: number): "s" | "m" | "l" {
  return width < 520 ? "s" : width < 900 ? "m" : "l";
}

/** The game's own wording for a roll's verdict (LivingTable.tsx RollReadoutOverlay). */
export function verdictWords(r: Pick<PlateReadout, "hit" | "critical" | "fumble">): string {
  return r.critical ? "NATURAL 20, CRITICAL HIT" : r.fumble ? "NATURAL 1, AUTOMATIC MISS" : r.hit ? "HIT" : "MISS";
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- DOM helpers ------------------------------------------------------------

const SVGNS = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The device pixel ratio now, read each time so a zoom or a move to another screen is honoured. */
function deviceRatio(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of a line of serif text, for sizing an SVG numeral. Falls back to a rough estimate when there is no canvas. */
function serifWidth(text: string, px: number, weight = 800): number {
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

// ---- the pixel windows: nine-slice frames drawn from data -------------------
//
// One 16x16 image per colour scheme, cut at 5 px, used as a border-image with
// the middle filled. The corner is the art; edges and middle repeat its last
// column and row. "o" outline, "L" light edge, "M" mid edge, "F" fill, "." clear.

const FRAME_CORNER = ["..ooo", ".oLLL", "oLMMM", "oLMFF", "oLMFF"];
const FRAME_SLICE = 5;
const FRAME_PX = 16;

const FRAMES: Record<FrameKey, { o: string; L: string; M: string; F: string }> = {
  win: { o: "#05061a", L: "#e6dcb4", M: "#4d5da6", F: "#141a3c" },
  gold: { o: "#1a0f00", L: "#ffe27a", M: "#b8801a", F: "#221a3a" },
  red: { o: "#1a0408", L: "#ffb4a8", M: "#b3281f", F: "#2a1226" },
  blue: { o: "#04102a", L: "#d2ecff", M: "#4a8fd8", F: "#122244" },
};

const frameUrls = new Map<FrameKey, string>();

function frameUrl(key: FrameKey): string | null {
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
function spriteCanvas(rows: readonly string[], colors: Record<string, string>, scale: number): HTMLCanvasElement {
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

const CARET_DOWN = ["ooooooooo", "oCCCCCCCo", ".oCCCCCo.", "..oCCCo..", "...oCo...", "....o...."];

// ---- styles -----------------------------------------------------------------

const STYLE_ID = "lto-style";

const CSS = `
.lto-root{--lto-serif:${SERIF};--lto-num:${SERIF_NUM};
  --sb-paper:#f6edd6;--sb-paper2:#e8d8b0;--sb-ink:#2a2016;--sb-muted:#6a5a3f;--sb-rule:#7c5c1e;--sb-gold:#cf9f3b;--sb-shade:46 28 8;
  --sb-good:#2a6a33;--sb-bad:#a5281c;--sb-spk:#8a5208;--sb-badge:#251b30;--sb-badge-ink:#ffd86b;--sb-focus:var(--bn-focus,#1d63e0);
  --sb-hero:#2a5db0;--sb-hero-deep:#1d3f7a;--sb-enemy:#a5281c;--sb-enemy-deep:#7a1c14;
  position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:40;--fs:2;--lto-lines:3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lto-root{
  --sb-paper:#25203a;--sb-paper2:#181526;--sb-ink:#f3e9cf;--sb-muted:#b6ab90;--sb-rule:#c79d45;--sb-gold:#e6bf5e;--sb-shade:0 0 0;
  --sb-good:#86e096;--sb-bad:#ff8c7a;--sb-spk:#ffd27a;--sb-badge:#0f0c18;--sb-hero:#7fb0ff;--sb-enemy:#ff8c7a}}
:root[data-theme="dark"] .lto-root{
  --sb-paper:#25203a;--sb-paper2:#181526;--sb-ink:#f3e9cf;--sb-muted:#b6ab90;--sb-rule:#c79d45;--sb-gold:#e6bf5e;--sb-shade:0 0 0;
  --sb-good:#86e096;--sb-bad:#ff8c7a;--sb-spk:#ffd27a;--sb-badge:#0f0c18;--sb-hero:#7fb0ff;--sb-enemy:#ff8c7a}
.lto-root[data-size="s"]{--fs:1;--lto-lines:2}
.lto-root *,.lto-root *::before,.lto-root *::after{box-sizing:border-box}
.lto-root [hidden]{display:none!important}
.lto-layer{position:absolute;inset:0;pointer-events:none}
.lto-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lto-top{position:absolute;left:8px;right:8px;top:8px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
.lto-bottom{position:absolute;left:8px;right:8px;bottom:8px;display:flex;justify-content:center;pointer-events:none}
.lto-banners{position:absolute;left:0;right:0;top:48px;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.lto-float{position:absolute;transform:translate(-50%,-100%);pointer-events:none;white-space:nowrap;will-change:transform,opacity}
.lto-float-in{transform-origin:50% 100%}
.lto-num{display:block;overflow:visible;filter:drop-shadow(0 3px 5px rgb(0 0 0/.6))}
.lto-num text{font-family:var(--lto-num);font-weight:800;stroke-linejoin:round}
.lto-plate-pos{position:absolute;pointer-events:none;max-width:calc(100% - 16px);transition:top .16s ease-out}

/* ---- pixel: the nine-slice windows ---- */
.lto-fr{--frame:var(--fr-win);border:calc(5px*var(--fs)) solid #05061a;border-image:var(--frame) 5 fill/calc(5px*var(--fs))/0 stretch;image-rendering:pixelated;background:#141a3c;color:#f4ecd0}
.lto-fr.fr-gold{--frame:var(--fr-gold)}.lto-fr.fr-red{--frame:var(--fr-red)}.lto-fr.fr-blue{--frame:var(--fr-blue)}
.lto-fr.fs1{border-width:5px;border-image-width:5px}
.lto-px canvas{image-rendering:pixelated}
.lto-px .lto-init{position:relative;display:flex;align-items:flex-start;gap:4px;max-width:100%;overflow-x:auto;overflow-y:hidden;pointer-events:auto;scrollbar-width:none;padding:4px 4px 10px}
.lto-px .lto-init::-webkit-scrollbar{display:none}
.lto-px .lto-chip{display:flex;align-items:center;gap:6px;padding:0 3px;flex:none;position:relative}
.lto-px .lto-chip.is-active{transform:translateY(1px)}
.lto-px .lto-chip[data-side].is-active{box-shadow:0 0 0 2px #ffe27a,0 0 0 4px #1a0f00}
.lto-px .lto-chip .lto-caret{position:absolute;left:50%;bottom:-17px;transform:translateX(-50%)}
.lto-px .lto-round{flex:none;padding:0 3px;display:flex;align-items:center}
.lto-px .lto-toast{padding:0 3px}
.lto-px .lto-dlg{width:min(760px,100%);padding:0 2px;pointer-events:auto}
.lto-px .lto-dlg-scroll{max-height:calc(var(--lto-lines)*var(--lto-row,20px));overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#4d5da6 #05061a}
.lto-px .lto-line:nth-last-child(n+4){opacity:.62}
.lto-px .lto-roll{padding:2px 4px;display:flex;flex-direction:column;align-items:center;gap:5px}
.lto-px .lto-math{display:flex;align-items:flex-end;gap:12px}
.lto-px .lto-math.is-tight{gap:6px}
.lto-px .lto-math.is-wrap{flex-wrap:wrap;justify-content:center;row-gap:6px}
.lto-px .lto-cell{display:flex;flex-direction:column;align-items:center;gap:5px}
.lto-px .lto-op{padding-bottom:6px}
.lto-px .lto-srcs{display:flex;flex-direction:column;align-items:center;gap:2px}
.lto-px .lto-tail{position:absolute;transform:translateX(-50%)}
.lto-px .lto-banner{padding:2px 8px}

/* ---- storybook: parchment and ink, a rulebook ---- */
.lto-sb{font-family:var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-plate{background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));color:var(--sb-ink);border-radius:9px;border:1px solid var(--sb-rule);
  box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-t2{font-weight:700;letter-spacing:.05em;text-transform:uppercase;paint-order:stroke fill;-webkit-text-stroke:.6px rgb(0 0 0/.7);text-shadow:0 1px 0 rgb(0 0 0/.5),0 2px 4px rgb(var(--sb-shade)/.7)}
.lto-sb .lto-init{position:relative;display:flex;align-items:center;gap:6px;max-width:100%;overflow-x:auto;overflow-y:hidden;pointer-events:auto;scrollbar-width:none;padding:2px 2px 12px}
.lto-sb .lto-init::-webkit-scrollbar{display:none}
.lto-sb .lto-round,.lto-sb .lto-chip,.lto-sb .lto-verdict,.lto-sb .lto-toast{font-family:var(--lto-num)}
.lto-sb .lto-round{flex:none;padding:4px 10px;border-radius:999px;background:var(--sb-badge);color:var(--sb-badge-ink);font-size:11px;border:1px solid var(--sb-gold);box-shadow:0 2px 6px rgb(0 0 0/.4)}
.lto-sb .lto-chip{position:relative;flex:none;display:flex;align-items:center;gap:7px;padding:3px 4px 3px 11px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.02em}
.lto-sb .lto-chip.is-active{transform:scale(1.08);box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 0 3px var(--sb-gold),0 6px 14px rgb(0 0 0/.5),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-chip[data-side="hero"]{--side:var(--sb-hero);--side-deep:var(--sb-hero-deep)}
.lto-sb .lto-chip[data-side="enemy"]{--side:var(--sb-enemy);--side-deep:var(--sb-enemy-deep)}
.lto-sb .lto-chip[data-side]{color:var(--side);border-color:var(--side);box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--side)}
.lto-sb .lto-chip[data-side] .lto-badge{background:var(--side-deep)}
.lto-sb .lto-chip[data-side].is-active{box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 0 3px var(--sb-gold),0 6px 14px rgb(0 0 0/.5),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--side)}
.lto-sb .lto-chip.is-active::after{content:"";position:absolute;left:50%;bottom:-9px;width:9px;height:9px;transform:translateX(-50%) rotate(45deg);background:var(--sb-gold);border:1px solid rgb(var(--sb-shade)/.7);border-top:0;border-left:0}
.lto-sb .lto-badge{min-width:26px;height:26px;padding:0 5px;border-radius:999px;display:grid;place-items:center;background:var(--sb-badge);color:var(--sb-badge-ink);font:800 15px/1 var(--lto-num);
  paint-order:stroke fill;-webkit-text-stroke:.6px rgb(0 0 0/.7);text-shadow:0 1px 0 rgb(0 0 0/.5),0 2px 4px rgb(0 0 0/.5);font-variant-numeric:lining-nums tabular-nums}
.lto-sb .lto-toast{padding:6px 14px;font-size:14px;font-weight:700;border-radius:999px;border-color:var(--sb-bad);
  box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-bad)}
.lto-sb .lto-dlg{width:min(760px,100%);padding:6px 12px 6px 14px;pointer-events:auto;border-radius:10px}
.lto-sb .lto-dlg-scroll{max-height:calc(var(--lto-lines)*1.4em);font-size:15px;line-height:1.4;overflow-y:auto;overflow-x:hidden;padding-right:6px;scrollbar-width:thin;scrollbar-color:var(--sb-rule) transparent}
.lto-sb .lto-line{color:var(--sb-ink);overflow-wrap:anywhere}
.lto-sb .lto-line:nth-last-child(n+4){opacity:.62}
.lto-sb .lto-line b{color:var(--sb-spk);font-variant:small-caps;letter-spacing:.06em;margin-right:.4em}
.lto-sb .lto-line[data-tone="good"]{color:var(--sb-good)}.lto-sb .lto-line[data-tone="bad"]{color:var(--sb-bad)}
.lto-sb .lto-roll{padding:9px 14px 10px;display:flex;flex-direction:column;align-items:center;gap:6px;max-width:100%}
.lto-sb .lto-plate.is-crit{box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 22px rgb(255 200 70/.6),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px #f0b52c}
.lto-sb .lto-cap{font-size:12px;font-style:italic;color:var(--sb-muted)}
.lto-sb .lto-math{display:flex;align-items:flex-end;gap:10px}
.lto-sb .lto-cell{display:flex;flex-direction:column;align-items:center;gap:1px}
.lto-sb .lto-cell b{font:800 30px/1 var(--lto-num);font-variant-numeric:lining-nums;text-shadow:0 1px 0 rgb(255 255 255/.5)}
.lto-sb .lto-cell.strong b{color:var(--sb-spk)}
.lto-sb .lto-cell i{font-size:11px;color:var(--sb-muted)}
.lto-sb .lto-op{font:700 18px/1 var(--lto-serif);color:var(--sb-muted);padding-bottom:13px}
.lto-sb .lto-srcs{display:flex;flex-wrap:wrap;justify-content:center;gap:2px 12px;font-size:12px;color:var(--sb-muted)}
.lto-sb .lto-verdict{padding:3px 14px 4px;border-radius:999px;font-size:13px;color:#fff}
.lto-sb .lto-verdict.hit{background:linear-gradient(#4cb862,#2a7a3a)}.lto-sb .lto-verdict.miss{background:linear-gradient(#c65a4c,#8a2a20)}.lto-sb .lto-verdict.crit{background:linear-gradient(#f5c64c,#b8790f)}
.lto-sb .lto-tail{position:absolute;width:13px;height:13px;transform:translateX(-50%) rotate(45deg);background:var(--sb-paper2);border:1px solid var(--sb-rule)}
.lto-sb .lto-tail.down{bottom:-7px;border-top:0;border-left:0}.lto-sb .lto-tail.up{top:-7px;border-bottom:0;border-right:0;background:var(--sb-paper)}
.lto-sb .lto-banner{position:relative;width:auto;padding:4px 36px 5px;display:flex;justify-content:center;
  background:linear-gradient(90deg,transparent 0,rgb(12 8 22/.8) 14%,rgb(12 8 22/.88) 50%,rgb(12 8 22/.8) 86%,transparent 100%)}
.lto-sb .lto-banner::before,.lto-sb .lto-banner::after{content:"";position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#d9ae4a 20%,#ffe9a0 50%,#d9ae4a 80%,transparent)}
.lto-sb .lto-banner::before{top:0}.lto-sb .lto-banner::after{bottom:0}
.lto-sb .lto-dlg:focus-visible,.lto-px .lto-dlg:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}

@media (prefers-reduced-motion: reduce){.lto-root *{animation:none!important;transition:none!important}}
`;

function injectStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- the overlay ------------------------------------------------------------

interface Internals {
  host: HTMLElement;
  root: HTMLElement;
}
const internals = new WeakMap<Overlay, Internals>();
let uidCounter = 0;

export function createOverlay(host: HTMLElement, initialStyle: TextStyle): Overlay {
  injectStyle();
  const uid = String(++uidCounter);
  let style: TextStyle = initialStyle;
  let destroyed = false;
  let epoch = 0;
  let busy = 0;

  let restorePosition: string | null = null;
  const hostStyle = getComputedStyle(host);
  if (hostStyle.position === "static") {
    restorePosition = host.style.position;
    host.style.position = "relative";
  }
  if (/auto|scroll/.test(`${hostStyle.overflowX} ${hostStyle.overflowY}`)) {
    console.warn("overlay: the host scrolls, so banners and the dialogue box would scroll away with the board. Pass a non-scrolling wrapper that sits over it.");
  }

  // ---- scaffolding
  const root = el("div", "lto-root");
  root.dataset.ltoRoot = "";
  root.dataset.busy = "0";
  const defs = buildDefs(uid);
  const live = el("div", "lto-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "false");
  live.dataset.ltoLive = "";
  const platesLayer = el("div", "lto-layer");
  const floatsLayer = el("div", "lto-layer");
  const top = el("div", "lto-top");
  const initEl = el("div", "lto-init");
  initEl.dataset.ltoInitiative = "";
  initEl.hidden = true;
  initEl.setAttribute("role", "group");
  initEl.setAttribute("aria-label", "Turn order");
  const toasts = el("div", "lto-toasts");
  toasts.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px";
  top.append(initEl, toasts);
  const bottom = el("div", "lto-bottom");
  const dlg = el("div", "lto-dlg");
  dlg.dataset.ltoDialogue = "";
  dlg.hidden = true;
  dlg.tabIndex = 0;
  dlg.setAttribute("role", "group");
  dlg.setAttribute("aria-label", "Dialogue history");
  const dlgScroll = el("div", "lto-dlg-scroll");
  dlg.append(dlgScroll);
  bottom.append(dlg);
  const bannersLayer = el("div", "lto-banners");
  // Stacking, bottom to top: the strip and toasts, the dialogue, roll plates (they cover the dialogue for
  // their two seconds rather than the other way round, so a verdict is never hidden), floats, banners.
  root.append(defs, live, top, bottom, platesLayer, floatsLayer, bannersLayer);
  host.appendChild(root);

  const frameVars = (): void => {
    for (const key of Object.keys(FRAMES) as FrameKey[]) {
      const url = frameUrl(key);
      if (url) root.style.setProperty(`--fr-${key}`, `url("${url}")`);
    }
  };
  frameVars();

  // ---- state
  const dialogue: DialogueLine[] = [];
  let initState: { entries: readonly InitiativeEntry[]; activeId: string | null; round: number } = { entries: [], activeId: null, round: 1 };
  let recent: RecentFloat[] = [];
  let tier: "s" | "m" | "l" = "l";
  let width = 0;

  // ---- time: every wait and animation is tracked so clear() can end them at once
  const waits = new Map<number, () => void>();
  const anims = new Set<Animation>();

  const reduced = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = window.setTimeout(() => {
        waits.delete(id);
        resolve();
      }, ms);
      waits.set(id, resolve);
    });
  }

  /** Start an animation; `anim` is the running one (null where there is no Web Animations API), `done` resolves when it ends or is cancelled. */
  function start(node: Element, frames: Keyframe[], ms: number, easing = "linear"): { anim: Animation | null; done: Promise<void> } {
    if (typeof node.animate !== "function") return { anim: null, done: wait(ms) };
    const anim = node.animate(frames, { duration: ms, easing, fill: "forwards" });
    anims.add(anim);
    const done = anim.finished.then(
      () => {
        anims.delete(anim);
      },
      () => {
        anims.delete(anim);
      },
    );
    return { anim, done };
  }

  function play(node: Element, frames: Keyframe[], ms: number, easing = "linear"): Promise<void> {
    return start(node, frames, ms, easing).done;
  }

  /** Count an animation in or out. A late finish from before a clear() must not touch the new count. */
  function setBusy(delta: number, forEpoch: number): void {
    if (forEpoch !== epoch) return;
    busy = Math.max(0, busy + delta);
    root.dataset.busy = String(busy);
  }

  function announce(text: string): void {
    const p = el("p", undefined, text);
    live.appendChild(p);
    while (live.childElementCount > 8) live.firstElementChild?.remove();
  }

  const isPixel = (): boolean => style === "pixel";

  const px = (input: string | readonly PixelRun[], opts: PixelTextOptions): HTMLCanvasElement => {
    const canvas = pixelText(input, { dpr: deviceRatio(), ...opts });
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  };

  const srText = (text: string): HTMLElement => el("span", "lto-sr", text);

  function frame(node: HTMLElement, key: FrameKey = "win", small = false): HTMLElement {
    node.classList.add("lto-fr", `fr-${key}`);
    if (small) node.classList.add("fs1");
    return node;
  }

  // ---- sizing
  function measure(): void {
    width = root.clientWidth;
    const next = sizeTier(width);
    root.dataset.size = next;
    const changed = next !== tier;
    tier = next;
    if (changed || isPixel()) scheduleRelayout();
  }
  let relayoutQueued = false;
  // Pixel text is drawn for one width and one device pixel ratio, so a change in either redraws it.
  const layoutKey = (): string => `${width}@${deviceRatio()}`;
  let lastLayoutKey = "";
  function scheduleRelayout(): void {
    if (relayoutQueued || layoutKey() === lastLayoutKey) return;
    relayoutQueued = true;
    const run = () => {
      relayoutQueued = false;
      if (destroyed) return;
      lastLayoutKey = layoutKey();
      renderDialogue();
      renderInitiative();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else run();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  ro?.observe(root);

  function applyStyleClass(): void {
    root.classList.toggle("lto-px", style === "pixel");
    root.classList.toggle("lto-sb", style === "storybook");
    root.dataset.style = style;
  }

  // ---- floats

  /**
   * A float's node, its box height and the empty margins inside the box above and
   * below its inked glyphs, which is what stacking and the plates clear: the box of
   * a storybook numeral carries the outline's room and a descender's, a pixel
   * canvas is all ink.
   */
  function floatNode(text: string, kind: FloatKind): { node: HTMLElement; h: number; padTop: number; padBottom: number } {
    const node = el("div", "lto-float");
    node.dataset.ltoFloat = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    node.setAttribute("aria-hidden", "true");
    const inner = el("div", "lto-float-in");
    const face = FACES[kind];
    let h: number;
    let padTop = 0;
    let padBottom = 0;
    if (isPixel()) {
      const small = tier === "s";
      const scale = kind === "crit" ? (small ? 4 : 5) : kind === "miss" || kind === "info" ? (small ? 2 : 3) : small ? 3 : 4;
      const canvas = px(text, { scale, weight: "bold", color: [face.mid, face.deep], outline: face.outline, outlinePx: 1, shadow: PX.shade });
      inner.append(canvas);
      h = parseFloat(canvas.style.height);
    } else {
      const size = { damage: 36, crit: 52, heal: 36, miss: 26, down: 40, info: 26 }[kind] * (tier === "s" ? 0.86 : 1);
      inner.append(numeral(uid, kind, text, size));
      ({ h, padTop, padBottom } = numeralGeometry(size, serifWidth(text, size)));
    }
    node.append(inner);
    return { node, h, padTop, padBottom };
  }

  /** The ink of a float that is up, in host px, with its rise included: what a plate has to stay out of. */
  interface FloatInk {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
  const liveFloats = new Set<FloatInk>();

  /** How high above its anchor an ordinary damage number reaches at its highest, rise included: where a plate on the same point starts out of its way. */
  function damageReach(): number {
    const { h, padTop } = floatNode("-00", "damage");
    return FLOAT_BASE_PX + h - padTop + FLOAT_RISE_PX;
  }

  function float(at: OverlayPoint, text: string, kind: FloatKind): void {
    if (destroyed) return;
    const now = performance.now();
    recent = recent.filter((r) => now - r.t < FLOAT_STACK_MS);
    const rung = floatStackIndex(recent, at, now);
    const stackTop = floatStackTop(recent, at, now);

    const { node, padTop, padBottom } = floatNode(text, kind);
    node.dataset.rung = String(rung);
    floatsLayer.appendChild(node);
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const rootW = root.clientWidth || width;
    const x = clamp(at.x, w / 2 + 2, Math.max(w / 2 + 2, rootW - w / 2 - 2));
    // The node is lifted by its own height, so `top` is its bottom edge. A float landing on others stands its
    // glyphs clear of the highest of theirs; one on its own stands on the anchor.
    const bottom = Math.max(h + FLOAT_RISE_PX + 2, at.y - FLOAT_BASE_PX - floatLift(stackTop, padBottom));
    node.style.left = `${x}px`;
    node.style.top = `${bottom}px`;
    recent.push({ x: at.x, y: at.y, t: now, n: rung, top: at.y - bottom + h - padTop });
    const ink: FloatInk = { left: x - w / 2, right: x + w / 2, top: bottom - h + padTop - FLOAT_RISE_PX, bottom: bottom - padBottom };
    liveFloats.add(ink);
    for (const plate of livePlates) stepPlateUp(plate, ink);

    const base = "translate(-50%, -100%)";
    const still = reduced();
    const fadeAt = (FLOAT_MS - FLOAT_FADE_MS) / FLOAT_MS;
    const frames: Keyframe[] = still
      ? [{ opacity: 1 }, { opacity: 1, offset: fadeAt }, { opacity: 0 }]
      : [
          { transform: `${base} translateY(0)`, opacity: 1, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
          { transform: `${base} translateY(${-FLOAT_RISE_PX * 0.85}px)`, opacity: 1, offset: fadeAt },
          { transform: `${base} translateY(${-FLOAT_RISE_PX}px)`, opacity: 0 },
        ];
    const mine = epoch;
    setBusy(1, mine);
    const inner = node.firstElementChild as HTMLElement | null;
    if (inner && !still) {
      const pop = kind === "crit" || kind === "down";
      void play(
        inner,
        pop
          ? [{ transform: "scale(0.45)", opacity: 0 }, { transform: "scale(1.28)", opacity: 1, offset: 0.5 }, { transform: "scale(1)", opacity: 1 }]
          : [{ transform: "scale(0.75)", opacity: 0.2 }, { transform: "scale(1)", opacity: 1 }],
        pop ? 260 : 130,
        "ease-out",
      );
    }
    void play(node, frames, FLOAT_MS).then(() => {
      node.remove();
      liveFloats.delete(ink);
      setBusy(-1, mine);
    });
  }

  // ---- banners

  function bannerNode(text: string, kind: BannerKind): HTMLElement {
    const node = el("div", "lto-banner");
    node.dataset.ltoBanner = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    node.setAttribute("aria-hidden", "true");
    const face = FACES[kind];
    const avail = Math.max(120, (root.clientWidth || width) - (isPixel() ? 56 : 40));
    if (isPixel()) {
      frame(node, BANNER_FRAME[kind]);
      const label = text.toUpperCase();
      // A title strip, not a poster: the owner found full-width banners blocked the board. Two or three times the font, never more.
      const scale = fitScale(textWidth(label, "bold") + 6, Math.min(avail - 24, 420), 2, 3, deviceRatio());
      node.append(
        px(label, { scale, weight: "bold", color: [face.top, face.mid], outline: face.outline, outlinePx: 2, shadow: PX.shade, shadowDx: 2, shadowDy: 2 }),
      );
    } else {
      const label = text.toUpperCase();
      let size = clamp(Math.floor((root.clientWidth || width) * 0.045), 18, 30);
      const spacing = 0.08;
      const fits = (s: number) => serifWidth(label, s) + (label.length - 1) * spacing * s + s * 0.6 <= avail;
      while (size > 20 && !fits(size)) size -= 2;
      node.append(numeral(uid, kind, label, size, spacing));
    }
    return node;
  }

  let bannerChain: Promise<void> = Promise.resolve();
  function banner(text: string, kind: BannerKind): Promise<void> {
    if (destroyed) return Promise.resolve();
    const mine = epoch;
    const run = bannerChain.then(async () => {
      if (destroyed || mine !== epoch) return;
      announce(text);
      const node = bannerNode(text, kind);
      bannersLayer.appendChild(node);
      setBusy(1, mine);
      const still = reduced();
      if (still) {
        await play(node, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }], BANNER_REDUCED_MS);
      } else {
        await play(
          node,
          [
            { opacity: 0, transform: "scale(0.9)", easing: "ease-out" },
            { opacity: 1, transform: "scale(1.03)", offset: 0.17 },
            { opacity: 1, transform: "scale(1)", offset: 0.27 },
            { opacity: 1, transform: "scale(1)", offset: 0.8 },
            { opacity: 0, transform: "scale(1.05)" },
          ],
          BANNER_MS,
        );
      }
      node.remove();
      setBusy(-1, mine);
    });
    bannerChain = run.catch(() => {});
    return run;
  }

  // ---- roll plates

  function cellsOf(r: PlateReadout): { n: string; l: string; strong?: boolean }[] {
    return [
      { n: String(r.roll), l: "your roll" },
      { n: signed(r.modifier), l: "your bonus" },
      { n: String(r.total), l: "total", strong: true },
      { n: String(r.target), l: "you needed" },
    ];
  }

  function sourcesOf(r: PlateReadout): string[] {
    return (r.sources ?? []).map((s) => `${signed(s.amount)} ${s.label}`);
  }

  function verdictClass(r: PlateReadout): "crit" | "hit" | "miss" {
    return r.critical ? "crit" : r.hit ? "hit" : "miss";
  }

  /**
   * Builds a plate; returns it plus a hook that sets the d20 face (for the tumble). The last two are the pixel
   * style's fitting steps for a narrow host: `numScale`, the scale of the four big numbers, and `squeeze`, 1 to
   * close up the gaps in the maths row and 2 to let it wrap onto a second row.
   */
  function plateNode(r: PlateReadout, avail: number, numScale: number, squeeze: number): { node: HTMLElement; setRoll: (n: number) => void } {
    const node = el("div", "lto-plate lto-roll");
    node.dataset.ltoPlate = "";
    node.dataset.hit = String(r.hit);
    node.dataset.roll = String(r.roll);
    node.dataset.text = `${r.roll} ${signed(r.modifier)} = ${r.total} vs ${r.target}: ${verdictWords(r)}`;
    node.setAttribute("aria-hidden", "true");
    const cells = cellsOf(r);
    const srcs = sourcesOf(r);
    const verdict = verdictWords(r);
    const vClass = verdictClass(r);
    let renderRoll: (n: number) => void = () => {};

    if (isPixel()) {
      const ratio = deviceRatio();
      frame(node, r.critical ? "gold" : "win");
      if (r.caption) node.append(px(r.caption, { scale: 1, color: PX.muted, maxWidth: wrapWidth(avail - 40, 1, ratio) }));
      const math = el("div", "lto-math");
      if (squeeze > 0) math.classList.add("is-tight");
      if (squeeze > 1) math.classList.add("is-wrap");
      // Numerals big, the game's own words under them at 1x, so the numbers carry the plate.
      cells.forEach((c, i) => {
        if (i === 2 || i === 3) {
          const op = el("div", "lto-op");
          op.append(px(i === 2 ? "=" : "vs", { scale: 2, color: PX.muted, shadow: PX.shade }));
          math.append(op);
        }
        const cell = el("div", "lto-cell");
        const numColor: PixelColor = c.strong ? PX.gold : PX.ink;
        const numHolder = el("div");
        const draw = (text: string) => numHolder.replaceChildren(px(text, { scale: numScale, weight: "bold", color: numColor, outline: PX.dark, shadow: PX.shade }));
        draw(c.n);
        if (i === 0) renderRoll = (n) => draw(String(n));
        cell.append(numHolder, px(c.l, { scale: 1, color: PX.muted, shadow: PX.shade }));
        math.append(cell);
      });
      node.append(math);
      if (srcs.length) {
        const wrap = el("div", "lto-srcs");
        for (const s of srcs) wrap.append(px(s, { scale: 1, color: PX.muted, maxWidth: Math.max(30, wrapWidth(avail - 40, 1, ratio)) }));
        node.append(wrap);
      }
      const vColor: PixelColor = vClass === "hit" ? PX.good : vClass === "crit" ? PX.gold : PX.bad;
      const vFont = textWidth(verdict, "bold") + 4;
      const vMax = verdict.length > 6 ? 2 : 3;
      node.append(px(verdict, { scale: fitScale(vFont, avail - 40, 1, vMax, ratio), weight: "bold", color: vColor, outline: PX.dark, shadow: PX.shade }));
    } else {
      if (r.critical) node.classList.add("is-crit");
      if (r.caption) node.append(el("div", "lto-cap", r.caption));
      const math = el("div", "lto-math");
      cells.forEach((c, i) => {
        if (i === 2 || i === 3) math.append(el("div", "lto-op", i === 2 ? "=" : "vs"));
        const cell = el("div", c.strong ? "lto-cell strong" : "lto-cell");
        const b = el("b", undefined, c.n);
        if (i === 0) {
          renderRoll = (n) => {
            b.textContent = String(n);
          };
        }
        cell.append(b, el("i", undefined, c.l));
        math.append(cell);
      });
      node.append(math);
      if (srcs.length) {
        const wrap = el("div", "lto-srcs");
        for (const s of srcs) wrap.append(el("span", undefined, s));
        node.append(wrap);
      }
      node.append(el("div", `lto-verdict lto-t2 ${vClass}`, verdict));
    }
    return { node, setRoll: renderRoll };
  }

  let plateChain: Promise<void> = Promise.resolve();
  let platesWaiting = 0;

  /**
   * A plate that is up. `above` plates stand over their point with a pointer `tail` px long hanging off the bottom;
   * `top` is where it is heading (its style), which is not what it measures while it is still sliding there.
   */
  interface LivePlate {
    pos: HTMLElement;
    above: boolean;
    tail: number;
    top: number;
  }
  const livePlates = new Set<LivePlate>();

  /** The lowest a plate may stand: under the turn-order strip when it is showing. */
  const safeTop = (): number => (initEl.hidden ? 8 : top.offsetHeight + 12);

  /**
   * Lift a plate that stands over its point clear of a float's ink: a taller float
   * than the plate made room for, or a stack climbing past it. A plate never prints
   * under a number, so the verdict is never hidden; where there is no room left
   * above it stays under the strip and the number wins, because floats are the
   * upper layer.
   */
  function stepPlateUp(plate: LivePlate, f: FloatInk): void {
    if (!plate.above) return;
    const { offsetLeft: left, offsetWidth: w, offsetHeight: h } = plate.pos;
    const bottom = plate.top + h + plate.tail;
    if (f.right <= left || f.left >= left + w) return;
    if (f.bottom <= plate.top || f.top >= bottom + FLOAT_GAP_PX) return;
    const next = Math.max(safeTop(), f.top - FLOAT_GAP_PX - plate.tail - h);
    if (next < plate.top) {
      plate.top = next;
      plate.pos.style.top = `${next}px`;
    }
  }

  async function showPlate(at: OverlayPoint, readout: PlateReadout, mine: number): Promise<void> {
    // A plate queued before a clear() was already forgotten by it, so only this epoch's plates are counted down.
    if (mine === epoch) platesWaiting--;
    const alive = () => !destroyed && mine === epoch;
    if (!alive()) return;
    const rootW = root.clientWidth || width;
    const pos = el("div", "lto-plate-pos");
    platesLayer.appendChild(pos);
    const bigScale = tier === "s" ? 3 : 4;
    // Pixel plates are canvases, which cannot wrap, so on a narrow host (or at a ratio that rounds the text up) close up
    // the maths row, then let it wrap, then step the big numbers down, until the plate holds all of its content.
    const fits: [number, number][] = [[bigScale, 1], [bigScale, 2]];
    for (let scale = bigScale - 1; scale >= 1; scale--) fits.push([scale, 2]);
    let built = plateNode(readout, rootW - 24, bigScale, 0);
    pos.append(built.node);
    for (const [numScale, squeeze] of fits) {
      if (!isPixel() || pos.scrollWidth <= pos.clientWidth + 1) break;
      built = plateNode(readout, rootW - 24, numScale, squeeze);
      pos.replaceChildren(built.node);
    }
    const { setRoll } = built;
    setBusy(1, mine);

    // Above the point if there is room under the strip, else below it; never under the dialogue box if it can be helped.
    // Above, it starts clear of an ordinary damage number rising off the same point (stepPlateUp lifts it further for a taller one).
    const w = pos.offsetWidth;
    const h = pos.offsetHeight;
    const rootH = root.clientHeight;
    const tailPx = isPixel() ? PLATE_TAIL_PIXEL_PX : PLATE_TAIL_PX;
    const strip = safeTop();
    const safeBottom = dlg.hidden ? rootH - 8 : rootH - dlg.offsetHeight - 16;
    const left = clamp(at.x - w / 2, 8, Math.max(8, rootW - w - 8));
    let above = true;
    let y = at.y - damageReach() - FLOAT_GAP_PX - tailPx - h;
    if (y < strip) y = at.y - PLATE_CLEAR_MIN_PX - h; // a small host: stand closer rather than flip
    if (y < strip) {
      above = false;
      y = at.y + 40;
    }
    y = clamp(y, strip, Math.max(strip, safeBottom - h));
    pos.style.left = `${left}px`;
    pos.style.top = `${y}px`;
    const plate: LivePlate = { pos, above, tail: tailPx, top: y };
    livePlates.add(plate);
    for (const f of liveFloats) stepPlateUp(plate, f);

    const tailX = clamp(at.x - left, 18, Math.max(18, w - 18));
    if (isPixel()) {
      const tail = spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.win.L }, 2);
      tail.classList.add("lto-tail");
      tail.style.left = `${tailX}px`;
      if (above) tail.style.bottom = "-13px";
      else {
        tail.style.top = "-13px";
        tail.style.transform = "translateX(-50%) scaleY(-1)";
      }
      pos.append(tail);
    } else {
      const tail = el("div", `lto-tail ${above ? "down" : "up"}`);
      tail.style.left = `${tailX}px`;
      pos.append(tail);
    }

    const still = reduced();
    if (still) {
      await play(pos, [{ opacity: 0 }, { opacity: 1 }], 120);
    } else {
      await play(
        pos,
        [{ opacity: 0, transform: "translateY(6px) scale(0.92)" }, { opacity: 1, transform: "translateY(0) scale(1.03)", offset: 0.7 }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        PLATE_IN_MS,
        "ease-out",
      );
      // The d20 tumbles through a few faces and settles. Deterministic, not random.
      for (let i = 0; i < 3 && alive(); i++) {
        setRoll(((readout.roll * 7 + i * 5 + 3) % 20) + 1);
        await wait(60);
      }
      setRoll(readout.roll);
    }
    if (alive()) await wait(platesWaiting > 0 ? PLATE_HOLD_QUEUED_MS : PLATE_HOLD_MS);
    if (alive()) await play(pos, [{ opacity: 1 }, { opacity: 0 }], still ? 120 : PLATE_OUT_MS);
    pos.remove();
    livePlates.delete(plate);
    setBusy(-1, mine);
  }

  function rollPlate(at: OverlayPoint, readout: PlateReadout): void {
    if (destroyed) return;
    const mine = epoch;
    platesWaiting++;
    plateChain = plateChain.then(() => showPlate(at, readout, mine)).catch(() => {});
  }

  // ---- dialogue

  function lineNode(line: DialogueLine): HTMLElement {
    const tone = line.tone ?? "plain";
    const node = el("div", "lto-line");
    node.dataset.ltoLine = "";
    node.dataset.tone = tone;
    if (line.speaker) node.dataset.speaker = line.speaker;
    node.dataset.text = line.text;
    if (isPixel()) {
      node.append(srText(line.speaker ? `${line.speaker}: ${line.text}` : line.text));
      const body = tone === "good" ? PX.good : tone === "bad" ? PX.bad : PX.ink;
      const runs: PixelRun[] = [];
      if (line.speaker) runs.push({ text: `${line.speaker}:`, color: PX.gold, weight: "bold" }, { text: " " });
      runs.push({ text: line.text, color: body });
      const ratio = deviceRatio();
      const inner = Math.max(80, (dlgScroll.clientWidth || width - 40) - 8);
      const canvas = px(runs, { scale: 2, shadow: PX.shade, maxWidth: wrapWidth(inner, 2, ratio) });
      // Every entry is a whole number of text rows tall, so the box scrolls on row boundaries and never shows half a line.
      // A row is what the text really takes: 20 CSS px only at whole ratios (see cssScale), and the scroll box's height follows it.
      const row = (CELL_H + LINE_GAP) * cssScale(2, ratio);
      root.style.setProperty("--lto-row", `${row}px`);
      node.style.height = `${Number(canvas.dataset.lines ?? "1") * row}px`;
      node.append(canvas);
    } else {
      if (line.speaker) node.append(el("b", undefined, line.speaker), srText(": "));
      node.append(document.createTextNode(line.text));
    }
    return node;
  }

  function renderDialogue(): void {
    dlg.hidden = dialogue.length === 0;
    if (dialogue.length === 0) {
      dlgScroll.replaceChildren();
      return;
    }
    frameDialogue();
    // A re-render (a resize, a style switch) keeps the reader where they were, measured from the newest line.
    const fromBottom = dlgScroll.scrollHeight - dlgScroll.scrollTop - dlgScroll.clientHeight;
    dlgScroll.replaceChildren(...dialogue.map(lineNode));
    dlgScroll.scrollTop = Math.max(0, dlgScroll.scrollHeight - dlgScroll.clientHeight - Math.max(0, fromBottom < 14 ? 0 : fromBottom));
  }

  function frameDialogue(): void {
    dlg.classList.remove("lto-fr", "fr-win", "fs1", "lto-plate");
    if (isPixel()) frame(dlg, "win", tier === "s");
    else dlg.classList.add("lto-plate");
  }

  function say(line: DialogueLine): void {
    if (destroyed) return;
    dialogue.push(line);
    while (dialogue.length > HISTORY_LIMIT) dialogue.shift();
    announce(line.speaker ? `${line.speaker}: ${line.text}` : line.text);
    const wasHidden = dlg.hidden;
    if (wasHidden) {
      dlg.hidden = false;
      frameDialogue();
    }
    const stick = wasHidden || dlgScroll.scrollHeight - dlgScroll.scrollTop - dlgScroll.clientHeight < 14;
    const node = lineNode(line);
    dlgScroll.appendChild(node);
    while (dlgScroll.childElementCount > HISTORY_LIMIT) dlgScroll.firstElementChild?.remove();
    if (stick) dlgScroll.scrollTop = dlgScroll.scrollHeight;
    if (!reduced() && typeof node.animate === "function") {
      void play(node, [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], 160, "ease-out");
    }
  }

  // ---- initiative strip

  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}.` : s);

  function renderInitiative(): void {
    const { entries, activeId, round } = initState;
    initEl.replaceChildren();
    initEl.hidden = entries.length === 0;
    if (entries.length === 0) return;
    const tab = el("div", "lto-round");
    tab.dataset.ltoRound = String(round);
    if (isPixel()) {
      frame(tab, "win", true);
      tab.append(px(`ROUND ${round}`, { scale: 2, color: PX.gold, shadow: PX.shade }));
    } else {
      tab.classList.add("lto-t2");
      tab.textContent = `Round ${round}`;
    }
    initEl.append(tab);
    for (const e of entries) {
      const active = e.id === activeId;
      const chip = el("div", `lto-chip${active ? " is-active" : ""}`);
      chip.dataset.ltoChip = "";
      chip.dataset.id = e.id;
      chip.dataset.active = String(active);
      chip.dataset.total = String(e.total);
      chip.dataset.text = `${e.label} ${e.total}`;
      if (e.side) chip.dataset.side = e.side;
      chip.append(srText(`${e.label}${e.side ? `, ${e.side}` : ""}, initiative ${e.total}${active ? ", taking a turn" : ""}`));
      if (isPixel()) {
        // A side colours the frame (blue hero, red enemy) and the active chip is marked by its ring and caret instead of a gold frame.
        frame(chip, e.side === "hero" ? "blue" : e.side === "enemy" ? "red" : active ? "gold" : "win", true);
        chip.append(
          px(clip(e.label, 10), { scale: 2, color: active ? PX.gold : PX.ink, shadow: PX.shade }),
          px(String(e.total), { scale: 2, weight: "bold", color: active ? PX.gold : PX.muted, shadow: PX.shade }),
        );
        if (active) {
          const caret = spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.gold.L }, 2);
          caret.classList.add("lto-caret");
          chip.append(caret);
        }
      } else {
        chip.classList.add("lto-plate");
        chip.append(el("span", undefined, clip(e.label, 14)), el("span", "lto-badge", String(e.total)));
        for (const child of Array.from(chip.children)) if (!child.classList.contains("lto-sr")) child.setAttribute("aria-hidden", "true");
      }
      initEl.append(chip);
    }
    const active = initEl.querySelector<HTMLElement>('[data-active="true"]');
    if (active) initEl.scrollLeft = active.offsetLeft - (initEl.clientWidth - active.offsetWidth) / 2;
    else initEl.scrollLeft = 0;
  }

  function initiative(entries: readonly InitiativeEntry[], activeId: string | null, round: number): void {
    if (destroyed) return;
    initState = { entries: entries.map((e) => ({ ...e })), activeId, round };
    renderInitiative();
  }

  // ---- toasts

  function toast(text: string): void {
    if (destroyed) return;
    const existing = Array.from(toasts.children).find((c) => (c as HTMLElement).dataset.text === text) as HTMLElement | undefined;
    if (existing) {
      // Same notice again: keep the one on screen and give it a fresh lease. If it was already fading out, stop that: a
      // fade that has run holds the node at opacity 0 (fill forwards), so the new lease would show nothing.
      const n = Number(existing.dataset.lease ?? "0") + 1;
      existing.dataset.lease = String(n);
      fades.get(existing)?.cancel();
      fades.delete(existing);
      void play(existing, [{ transform: "scale(1.06)" }, { transform: "scale(1)" }], 140, "ease-out");
      void wait(TOAST_MS).then(() => retire(existing, n));
      return;
    }
    while (toasts.childElementCount >= 3) toasts.firstElementChild?.remove();
    const node = el("div", "lto-toast");
    node.dataset.ltoToast = "";
    node.dataset.text = text;
    node.dataset.lease = "0";
    node.setAttribute("aria-hidden", "true");
    if (isPixel()) {
      frame(node, "red", true);
      node.append(px(text, { scale: 2, color: PX.ink, shadow: PX.shade, maxWidth: wrapWidth(Math.max(120, (root.clientWidth || width) - 70), 2, deviceRatio()) }));
    } else {
      node.classList.add("lto-plate");
      node.textContent = text;
    }
    toasts.append(node);
    announce(text);
    if (!reduced()) void play(node, [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "translateY(0)" }], 150, "ease-out");
    void wait(TOAST_MS).then(() => retire(node, 0));
  }

  /** The fade-out each leaving toast is running, so a repeat of its text can stop it. */
  const fades = new WeakMap<HTMLElement, Animation>();

  async function retire(node: HTMLElement, lease: number): Promise<void> {
    if (destroyed || !node.isConnected || Number(node.dataset.lease ?? "0") !== lease) return;
    const { anim, done } = start(node, [{ opacity: 1 }, { opacity: 0 }], TOAST_FADE_MS);
    if (anim) fades.set(node, anim);
    await done;
    if (anim && fades.get(node) === anim) fades.delete(node);
    if (node.isConnected && Number(node.dataset.lease ?? "0") === lease) node.remove();
  }

  // ---- control

  function clear(): void {
    epoch++;
    for (const [id, resolve] of waits) {
      window.clearTimeout(id);
      resolve();
    }
    waits.clear();
    for (const a of Array.from(anims)) a.cancel();
    anims.clear();
    platesLayer.replaceChildren();
    livePlates.clear();
    floatsLayer.replaceChildren();
    liveFloats.clear();
    bannersLayer.replaceChildren();
    toasts.replaceChildren();
    dlgScroll.replaceChildren();
    dlg.hidden = true;
    dialogue.length = 0;
    initState = { entries: [], activeId: null, round: 1 };
    renderInitiative();
    live.replaceChildren();
    recent = [];
    platesWaiting = 0;
    busy = 0;
    root.dataset.busy = "0";
  }

  function setStyle(next: TextStyle): void {
    if (destroyed || next === style) return;
    style = next;
    applyStyleClass();
    renderDialogue();
    renderInitiative();
  }

  function destroy(): void {
    if (destroyed) return;
    clear();
    destroyed = true;
    ro?.disconnect();
    root.remove();
    if (restorePosition !== null) host.style.position = restorePosition;
    internals.delete(api);
  }

  const api: Overlay = { setStyle, banner, float, rollPlate, say, initiative, toast, clear, destroy };
  internals.set(api, { host, root });
  applyStyleClass();
  measure();
  return api;
}

// ---- SVG numerals: the .cg-num treatment -----------------------------------

function buildDefs(uid: string): SVGSVGElement {
  const svg = svgEl("svg", { width: 0, height: 0, "aria-hidden": "true", focusable: "false" });
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  const defs = svgEl("defs");
  for (const [key, f] of Object.entries(FACES) as [string, Face][]) {
    const g = svgEl("linearGradient", { id: `lto${uid}-${key}`, x1: 0, y1: 0, x2: 0, y2: 1 });
    // The hard pair at .46 and .47 is on purpose: a one-percent value cliff
    // mid-glyph is what makes the numeral read as moulded metal, not a gradient.
    for (const [offset, color] of [[0, f.top], [0.46, f.mid], [0.47, f.deep], [1, f.mid]] as const) {
      g.append(svgEl("stop", { offset, "stop-color": color }));
    }
    defs.append(g);
  }
  svg.append(defs);
  return svg;
}

/**
 * The box of an SVG numeral at a font size, and where its inked glyphs sit in it:
 * `padTop` and `padBottom` are the empty margins above the capitals' top edge and
 * below the baseline, the outline's half stroke included.
 */
function numeralGeometry(px: number, textW: number): { stroke: number; w: number; h: number; baseline: number; padTop: number; padBottom: number } {
  const stroke = Math.max(3, Math.round(px * 0.3));
  const w = Math.ceil(textW + stroke * 2 + 4);
  const h = Math.ceil(px * 1.22 + stroke * 2);
  const baseline = stroke + px * 0.92;
  return {
    stroke,
    w,
    h,
    baseline,
    padTop: Math.max(0, baseline - px * NUMERAL_CAP - stroke / 2),
    padBottom: Math.max(0, h - baseline - stroke / 2),
  };
}

/**
 * Display text as an SVG numeral: paint-order stroke-then-fill so the dark
 * outline sits behind the face instead of eating it (the reason .cg-num is SVG
 * text and not -webkit-text-stroke on HTML), a hard-stop gradient face, and a
 * drop shadow from the .lto-num class.
 */
function numeral(uid: string, key: FloatKind | BannerKind, text: string, px: number, spacing = 0): SVGSVGElement {
  const f = FACES[key];
  const textW = serifWidth(text, px) + Math.max(0, text.length - 1) * spacing * px;
  const { stroke, w, h, baseline } = numeralGeometry(px, textW);
  const svg = svgEl("svg", { class: "lto-num", width: w, height: h, viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true", focusable: "false" });
  const t = svgEl("text", {
    x: w / 2,
    y: baseline,
    "text-anchor": "middle",
    "font-size": px,
    fill: `url(#lto${uid}-${key})`,
    stroke: f.outline,
    "stroke-width": stroke,
    "paint-order": "stroke fill",
    "stroke-linejoin": "round",
  });
  if (spacing) t.setAttribute("letter-spacing", String(spacing * px));
  t.textContent = text;
  svg.append(t);
  return svg;
}

// ---- the demo ---------------------------------------------------------------

export interface OverlayDemoOptions {
  /** Multiplies every pause. Default 1; 0 runs the whole thing back to back. */
  pace?: number;
  /** Called (and awaited) as each step begins, so a harness can screenshot it. */
  onStep?: (name: string) => void | Promise<void>;
}

/**
 * Cycles every element once: the initiative strip, each banner, floating
 * numbers of every kind, two stacked roll plates, dialogue in each tone, a
 * toast. It leaves the dialogue history and the strip on screen (call clear()
 * to wipe them). Resolves when the last banner is gone.
 */
export async function overlayDemo(overlay: Overlay, opts: OverlayDemoOptions = {}): Promise<void> {
  const inner = internals.get(overlay);
  const W = inner?.root.clientWidth || 480;
  const H = inner?.root.clientHeight || 320;
  const pace = opts.pace ?? 1;
  const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * pace));
  const step = async (name: string) => {
    await opts.onStep?.(name);
  };

  const hero = { x: Math.round(W * 0.3), y: Math.round(H * 0.62) };
  const goblin = { x: Math.round(W * 0.68), y: Math.round(H * 0.5) };
  const entries: InitiativeEntry[] = [
    { id: "hero", label: "Aldric", total: 17, side: "hero" },
    { id: "goblin", label: "Goblin", total: 12, side: "enemy" },
  ];

  await step("say");
  overlay.say({ text: "A goblin spots you across the room." });
  await pause(300);
  await step("banner-initiative");
  const b1 = overlay.banner("Roll initiative", "initiative");
  await pause(500);
  overlay.initiative(entries, null, 1);
  await b1;

  await step("banner-turn");
  overlay.initiative(entries, "hero", 1);
  await overlay.banner("Your turn", "turn");

  await step("plate-hit");
  overlay.rollPlate(goblin, {
    roll: 14,
    modifier: 5,
    total: 19,
    target: 15,
    hit: true,
    sources: [
      { label: "Strength and training", amount: 3 },
      { label: "Keen Longsword", amount: 2 },
    ],
    caption: "Aldric attacks the goblin",
  });
  overlay.rollPlate(goblin, { roll: 20, modifier: 5, total: 25, target: 15, hit: true, critical: true, caption: "Aldric attacks the goblin" });
  await pause(900);
  await step("floats");
  overlay.say({ speaker: "Aldric", text: "Longsword attack: 14 + 5 = 19 against AC 15. Hit!" });
  overlay.float({ x: goblin.x, y: goblin.y }, "-6", "damage");
  await pause(350);
  overlay.float({ x: goblin.x, y: goblin.y }, "-6", "damage");
  overlay.float({ x: goblin.x, y: goblin.y }, "-3", "damage");
  await pause(500);
  overlay.float({ x: goblin.x, y: goblin.y }, "-14 CRIT!", "crit");
  overlay.float({ x: hero.x, y: hero.y }, "MISS", "miss");
  overlay.float({ x: hero.x + 90, y: hero.y }, "+5", "heal");
  overlay.float({ x: goblin.x - 120, y: goblin.y + 20 }, "Poisoned", "info");
  await pause(700);
  overlay.float({ x: goblin.x, y: goblin.y }, "DOWN", "down");
  overlay.say({ speaker: "Goblin", text: "Shinies! Give!", tone: "bad" });
  overlay.say({ text: "You drink a healing potion and recover 5 hit points.", tone: "good" });
  await pause(600);
  await step("toast");
  overlay.toast("The goblin is too far away to reach this turn.");
  await pause(900);
  await step("banner-enemy");
  overlay.initiative(entries, "goblin", 1);
  await overlay.banner("Goblin's turn", "enemy");
  await step("banner-victory");
  await overlay.banner("Victory", "victory");
  await step("banner-defeat");
  await overlay.banner("Defeat", "defeat");
  // Let the last plate and floats finish too, so "done" means the screen is quiet.
  for (let i = 0; i < 160 && inner && inner.root.dataset.busy !== "0"; i++) await new Promise<void>((r) => setTimeout(r, 50));
  await step("done");
}
