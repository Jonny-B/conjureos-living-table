/**
 * Hover help for the bench: a small card that says exactly what a thing is, so
 * the player is never left guessing. Used by the HUD's pack list now, and meant
 * for the character sheet and the rule books later.
 *
 *   attachTip(el, { title, lines, footer?, tone? }, { boundary?, style? })  ->  detach
 *
 * It shows on a mouse hover (after about 150 ms, at once when another tip was
 * just up), on keyboard focus (the element is made focusable when it is not), and
 * on touch: a tap shows it, a tap on the same thing again or anywhere else hides
 * it, and the tap that showed it never also reaches whatever sits behind (the
 * click that follows a tap on a plain element is kept from its parents). Escape
 * hides it. One tip is up at a time. It stands beside the element, flips to the
 * side with room and is clamped inside the boundary (the viewport when none is
 * given), is never wider than about 280 px, wraps, and is position:fixed, so it
 * can never add a horizontal scrollbar to the page or be clipped by a scrolling
 * list. aria-describedby points at it while it is up.
 *
 * Three looks that follow the surface they appear on: pixel (the HUD's navy
 * frame, a bitmap heading and a clean body face), storybook (parchment and
 * serif, following the page theme) and bench (the bench's own --bn-* tokens).
 *
 * Nothing here touches the DOM at import time (the bench registry is imported in
 * Node).
 */
import { pixelText, type PixelColor } from "./pixelFont";

// ---- the public contract ----------------------------------------------------

export interface TipContent {
  /** What the thing is called. */
  title: string;
  /** What it is and what it does, one short paragraph per entry. */
  lines: string[];
  /** A quiet last line: a rule reminder, "The game applies this", "The DM rules on this". */
  footer?: string;
  /** Colours the heading and the frame: good (green), bad (red), magic (violet). Default plain. */
  tone?: "plain" | "good" | "bad" | "magic";
  /** A short line set apart right under the title, in the accent colour: "Cannot be used", "Worn". What the thing is to you right now. */
  lead?: string;
}
export type TipStyle = "pixel" | "storybook" | "bench";

export interface TipOptions {
  /** The box the tip must stay inside (the game window). Default: the viewport. */
  boundary?: HTMLElement;
  /** The look. A function is read each time the tip opens, for a surface that can change style. Default "bench". */
  style?: TipStyle | (() => TipStyle);
  /** Mouse hover and keyboard focus only: a tap on a touch screen does nothing here (the caller gives the tap its own meaning). Default false. */
  hoverOnly?: boolean;
  /** While this returns true the tip does not open (a card pinned on the same thing). */
  suppressed?: () => boolean;
}

// ---- pure helpers (unit tested) --------------------------------------------

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type TipSide = "right" | "left" | "below" | "above";
export interface TipPlacement {
  left: number;
  top: number;
  /** The side of the element the tip stands on. */
  side: TipSide;
  /** False when no side had room for the whole tip: it is then clamped inside the bounds and may overlap the element. */
  fits: boolean;
}

/** The widest a tip grows, in CSS px, on a surface with room. */
export const TIP_MAX_WIDTH = 280;
/** Air between the element and its tip. */
export const TIP_GAP = 8;
/** The least air kept between a tip and the edge of its bounds. */
export const TIP_MARGIN = 6;
const HOVER_DELAY_MS = 150;
/** A tip that was up this recently is replaced at once by the next one, so sweeping along a list does not stutter. */
const SWEEP_MS = 350;

/** The overlap of two boxes, or null when they do not touch. */
export function intersectBoxes(a: Box, b: Box): Box | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/** The widest a tip may be inside these bounds: the usual maximum, less the margins when the bounds are narrow. */
export function tipMaxWidth(bounds: Box, margin = TIP_MARGIN): number {
  return Math.max(60, Math.min(TIP_MAX_WIDTH, bounds.width - margin * 2));
}

function clampSpan(start: number, size: number, lo: number, hi: number): number {
  // A tip bigger than the room pins to the near edge (its far end is cut, never its start).
  if (size >= hi - lo) return lo;
  return Math.max(lo, Math.min(hi - size, start));
}

/** Where a span of `size` goes along one axis next to an anchor span: level with its start when the anchor is the bigger one, centred on it otherwise. */
function alignSpan(anchorStart: number, anchorSize: number, size: number): number {
  return anchorSize >= size ? anchorStart : anchorStart + (anchorSize - size) / 2;
}

/**
 * Where a tip of `size` stands next to `anchor`, inside `bounds` (all in the same coordinates, normally the viewport's).
 * It prefers the right of the element, then the left, then below, then above (below and above first for an element
 * wider than half the bounds, where the sides would be cut), and takes the first side with room for the whole tip.
 * With no such side it takes the one with the most room and clamps. The result is always inside the bounds
 * (less `margin`) unless the tip is bigger than the bounds, where it is pinned to their top left.
 */
export function placeTip(anchor: Box, size: { width: number; height: number }, bounds: Box, gap = TIP_GAP, margin = TIP_MARGIN): TipPlacement {
  const inner: Box = {
    left: bounds.left + margin,
    top: bounds.top + margin,
    width: Math.max(0, bounds.width - margin * 2),
    height: Math.max(0, bounds.height - margin * 2),
  };
  const iRight = inner.left + inner.width;
  const iBottom = inner.top + inner.height;
  const aRight = anchor.left + anchor.width;
  const aBottom = anchor.top + anchor.height;
  const room: Record<TipSide, number> = {
    right: iRight - (aRight + gap),
    left: anchor.left - gap - inner.left,
    below: iBottom - (aBottom + gap),
    above: anchor.top - gap - inner.top,
  };
  const need: Record<TipSide, number> = { right: size.width, left: size.width, below: size.height, above: size.height };
  const wide = anchor.width > bounds.width / 2;
  const order: [TipSide, TipSide, TipSide, TipSide] = wide ? ["below", "above", "right", "left"] : ["right", "left", "below", "above"];
  const roomy = order.find((s) => room[s] >= need[s]);
  const fits = roomy !== undefined;
  const side: TipSide = roomy ?? order.reduce<TipSide>((best, s) => (room[s] - need[s] > room[best] - need[best] ? s : best), order[0]);
  let left: number;
  let top: number;
  if (side === "right" || side === "left") {
    left = side === "right" ? aRight + gap : anchor.left - gap - size.width;
    top = alignSpan(anchor.top, anchor.height, size.height);
  } else {
    top = side === "below" ? aBottom + gap : anchor.top - gap - size.height;
    left = alignSpan(anchor.left, anchor.width, size.width);
  }
  return { left: clampSpan(left, size.width, inner.left, iRight), top: clampSpan(top, size.height, inner.top, iBottom), side, fits };
}

/** The tone with its default filled in. */
export function tipTone(content: Pick<TipContent, "tone">): NonNullable<TipContent["tone"]> {
  return content.tone ?? "plain";
}

// ---- styles -----------------------------------------------------------------

const TIP_STYLE_ID = "lt-tip-style";
const TIP_ID = "lt-tip";
const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const TIP_CSS = `
.lt-tip{position:fixed;left:0;top:0;z-index:2147483000;box-sizing:border-box;width:max-content;max-width:${TIP_MAX_WIDTH}px;padding:8px 10px;margin:0;pointer-events:none;opacity:0;transition:opacity .12s ease;overflow-wrap:anywhere;text-align:left;
  --tt-bg:#fff;--tt-ink:#1d1b16;--tt-muted:#6c6656;--tt-edge:#ddd7c9;--tt-accent:var(--tt-ink);--tt-btn:#f4f1ea;color:var(--tt-ink);background:var(--tt-bg);border:1px solid var(--tt-edge)}
.lt-tip *{box-sizing:border-box}
.lt-tip[hidden]{display:none}
.lt-tip.on{opacity:1}
@media (prefers-reduced-motion: reduce){.lt-tip{transition:none}}
.lt-tip-title{margin:0 0 4px;font-weight:700;color:var(--tt-accent)}
.lt-tip-title canvas{display:block;max-width:100%}
.lt-tip-line{margin:0}
.lt-tip-line+.lt-tip-line{margin-top:4px}
.lt-tip-foot{margin:6px 0 0;padding-top:5px;border-top:1px solid var(--tt-edge);color:var(--tt-muted)}
.lt-tip-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
[data-lt-tip]{cursor:help}
[data-lt-tip]:focus-visible{outline:2px solid var(--bn-focus,#1d63e0);outline-offset:2px}

.lt-tip[data-style="pixel"]{--tt-btn:#1f2858;--tt-bg:#141a3c;--tt-ink:#f4ecd0;--tt-muted:#98a5d8;--tt-edge:#4d5da6;--tt-accent:#ffc72a;border:2px solid var(--tt-edge);border-radius:0;
  box-shadow:0 0 0 2px #05061a,inset 0 0 0 1px #2c3874,0 6px 0 2px rgb(5 6 26/.45);font:13px/1.4 ${SANS}}
.lt-tip[data-style="pixel"][data-tone="good"]{--tt-edge:#59dd82;--tt-accent:#59dd82}
.lt-tip[data-style="pixel"][data-tone="bad"]{--tt-edge:#ff5a4a;--tt-accent:#ff5a4a}
.lt-tip[data-style="pixel"][data-tone="magic"]{--tt-edge:#a97bff;--tt-accent:#c9a6ff}
.lt-tip[data-style="pixel"] .lt-tip-title{font-size:14px}
.lt-tip[data-style="pixel"] .lt-tip-foot{font-size:12px;border-top:2px solid #2c3874}

.lt-tip[data-style="storybook"]{--tt-btn:#fbf4df;--tt-bg:#f6edd6;--tt-ink:#2a2016;--tt-muted:#6a5a3f;--tt-edge:#7c5c1e;--tt-accent:#8a5208;border-radius:9px;
  background:linear-gradient(180deg,#f6edd6,#e8d8b0);box-shadow:inset 0 0 0 2px #f6edd6,inset 0 0 0 3px #cf9f3b,0 8px 18px rgb(46 28 8/.35);font:14px/1.38 ${SERIF}}
.lt-tip[data-style="storybook"][data-tone="good"]{--tt-accent:#2a6a33}
.lt-tip[data-style="storybook"][data-tone="bad"]{--tt-accent:#a5281c}
.lt-tip[data-style="storybook"][data-tone="magic"]{--tt-accent:#6b3fa0}
.lt-tip[data-style="storybook"] .lt-tip-title{font-size:13px;letter-spacing:.07em;text-transform:uppercase}
.lt-tip[data-style="storybook"] .lt-tip-foot{font-size:12.5px;font-style:italic;border-top:1px solid #7c5c1e55}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lt-tip[data-style="storybook"]{--tt-btn:#312b4d;--tt-bg:#25203a;--tt-ink:#f3e9cf;--tt-muted:#b6ab90;--tt-edge:#c79d45;--tt-accent:#ffd27a;
  background:linear-gradient(180deg,#25203a,#181526);box-shadow:inset 0 0 0 2px #25203a,inset 0 0 0 3px #e6bf5e,0 8px 18px rgb(0 0 0/.55)}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"][data-tone="good"]{--tt-accent:#86e096}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"][data-tone="bad"]{--tt-accent:#ff8c7a}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"][data-tone="magic"]{--tt-accent:#c9a6ff}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"] .lt-tip-foot{border-top-color:#c79d4566}}
:root[data-theme="dark"] .lt-tip[data-style="storybook"]{--tt-btn:#312b4d;--tt-bg:#25203a;--tt-ink:#f3e9cf;--tt-muted:#b6ab90;--tt-edge:#c79d45;--tt-accent:#ffd27a;
  background:linear-gradient(180deg,#25203a,#181526);box-shadow:inset 0 0 0 2px #25203a,inset 0 0 0 3px #e6bf5e,0 8px 18px rgb(0 0 0/.55)}
:root[data-theme="dark"] .lt-tip[data-style="storybook"][data-tone="good"]{--tt-accent:#86e096}
:root[data-theme="dark"] .lt-tip[data-style="storybook"][data-tone="bad"]{--tt-accent:#ff8c7a}
:root[data-theme="dark"] .lt-tip[data-style="storybook"][data-tone="magic"]{--tt-accent:#c9a6ff}
:root[data-theme="dark"] .lt-tip[data-style="storybook"] .lt-tip-foot{border-top-color:#c79d4566}

.lt-tip[data-style="bench"]{--tt-btn:var(--bn-bg,#f6f4ef);--tt-bg:var(--bn-panel,#fff);--tt-ink:var(--bn-text,#1d1b16);--tt-muted:var(--bn-muted,#6c6656);--tt-edge:var(--bn-line,#ddd7c9);--tt-accent:var(--bn-text,#1d1b16);border-radius:8px;
  box-shadow:0 6px 20px rgb(0 0 0/.25);font:13px/1.45 ${SANS}}
.lt-tip[data-style="bench"][data-tone="good"]{--tt-accent:#2a7d45}
.lt-tip[data-style="bench"][data-tone="bad"]{--tt-accent:var(--bn-danger,#b3311d)}
.lt-tip[data-style="bench"][data-tone="magic"]{--tt-accent:var(--bn-accent,#6d4fe0)}
.lt-tip[data-style="bench"] .lt-tip-foot{font-size:12px}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lt-tip[data-style="bench"][data-tone="good"]{--tt-accent:#6fd68f}}
:root[data-theme="dark"] .lt-tip[data-style="bench"][data-tone="good"]{--tt-accent:#6fd68f}

.lt-tip-lead{margin:0 0 5px;font-weight:700;color:var(--tt-accent)}
.lt-tip[data-style="storybook"] .lt-tip-lead{font-style:italic}

/* ---- the pinned item card: the same box, but it takes the pointer ---- */
.lt-card{pointer-events:auto;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;opacity:1;transition:none}
[data-lt-card]{cursor:pointer}
[data-lt-card][aria-expanded="true"]{outline:2px solid var(--bn-focus,#1d63e0);outline-offset:1px}
.lt-card-acts{display:flex;flex-direction:column;gap:5px;margin:8px 0 0;padding-top:8px;border-top:1px solid var(--tt-edge)}
.lt-card-q{margin:8px 0 0;padding-top:8px;border-top:1px solid var(--tt-edge);font-weight:700;color:var(--tt-accent)}
.lt-card-yn{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
.lt-card-btn{appearance:none;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;width:100%;min-width:0;margin:0;padding:6px 10px;min-height:34px;text-align:left;font:inherit;font-weight:700;line-height:1.25;color:var(--tt-ink);background:var(--tt-btn);border:1px solid var(--tt-edge);border-radius:6px;cursor:pointer;touch-action:manipulation;overflow-wrap:anywhere}
.lt-card-btn .why{font-weight:400;font-size:.9em;line-height:1.3;color:var(--tt-muted)}
.lt-card-btn[data-confirm] .lbl{color:var(--bn-danger,#b3311d)}
.lt-card-btn[aria-disabled="true"]{cursor:default;background:transparent;border-style:dashed}
.lt-card-btn[aria-disabled="true"] .lbl{opacity:.55}
.lt-card-btn:not([aria-disabled="true"]):hover{border-color:var(--tt-accent)}
.lt-card-btn:focus-visible{outline:2px solid var(--bn-focus,#1d63e0);outline-offset:1px}
.lt-card-yn .lt-card-btn{align-items:center;text-align:center}
.lt-card[data-style="pixel"] .lt-card-btn{border-radius:0;border-width:2px;font-size:13px}
.lt-card[data-style="pixel"] .lt-card-btn:not([aria-disabled="true"]):hover{border-color:#ffc72a}
.lt-card[data-style="pixel"] .lt-card-btn[data-confirm] .lbl,.lt-card[data-style="pixel"] .lt-card-q{color:#ff8c7a}
.lt-card[data-style="pixel"] .lt-card-acts,.lt-card[data-style="pixel"] .lt-card-q{border-top:2px solid #2c3874}
.lt-card[data-style="storybook"] .lt-card-btn{border-radius:8px;font-family:${SERIF};font-size:14px}
.lt-card[data-style="storybook"] .lt-card-btn[data-confirm] .lbl,.lt-card[data-style="storybook"] .lt-card-q{color:#a5281c}
.lt-card[data-style="storybook"] .lt-card-acts,.lt-card[data-style="storybook"] .lt-card-q{border-top:1px solid #7c5c1e55}
@media (pointer: coarse){.lt-card-btn{min-height:44px}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lt-card[data-style="storybook"] .lt-card-btn[data-confirm] .lbl,:root:not([data-theme="light"]) .lt-card[data-style="storybook"] .lt-card-q{color:#ff8c7a}}
:root[data-theme="dark"] .lt-card[data-style="storybook"] .lt-card-btn[data-confirm] .lbl,:root[data-theme="dark"] .lt-card[data-style="storybook"] .lt-card-q{color:#ff8c7a}
`;

const PIXEL_TITLE: Record<NonNullable<TipContent["tone"]>, PixelColor> = {
  plain: ["#fff3ad", "#ffc72a"],
  good: ["#c2ffd2", "#59dd82"],
  bad: ["#ffb0a4", "#ff5a4a"],
  magic: ["#e6d2ff", "#a97bff"],
};

function injectCss(): void {
  if (document.getElementById(TIP_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = TIP_STYLE_ID;
  s.textContent = TIP_CSS;
  document.head.appendChild(s);
}

// ---- the one tip node and the one tip up -----------------------------------

let node: HTMLElement | null = null;
/** The tip that is up, if any: how to close it, and when it was last up (for the sweep). */
let active: { hide: () => void } | null = null;
let lastHiddenAt = -Infinity;
const attached = new WeakMap<HTMLElement, () => void>();

function tipNode(): HTMLElement {
  if (node && node.isConnected) return node;
  injectCss();
  node = document.createElement("div");
  node.id = TIP_ID;
  node.className = "lt-tip";
  node.setAttribute("role", "tooltip");
  node.hidden = true;
  document.body.appendChild(node);
  return node;
}

function viewportBox(): Box {
  const d = document.documentElement;
  return { left: 0, top: 0, width: d.clientWidth || window.innerWidth, height: d.clientHeight || window.innerHeight };
}

function boxOf(r: DOMRect): Box {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Fill the tip node for one tip. The heading is bitmap text in the pixel look (with the words kept for screen readers). */
function fill(n: HTMLElement, c: TipContent, style: TipStyle, maxWidth: number, extra: readonly HTMLElement[] = []): void {
  const tone = tipTone(c);
  n.dataset.style = style;
  n.dataset.tone = tone;
  n.style.maxWidth = `${maxWidth}px`;
  const parts: HTMLElement[] = [];
  const title = document.createElement("div");
  title.className = "lt-tip-title";
  title.dataset.tipTitle = c.title;
  if (style === "pixel") {
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    try {
      const canvas = pixelText(c.title, { scale: 2, dpr, weight: "bold", color: PIXEL_TITLE[tone], outline: "#05061a", maxWidth: Math.max(8, Math.floor((maxWidth - 26) / 2)) });
      canvas.setAttribute("aria-hidden", "true");
      const sr = document.createElement("span");
      sr.className = "lt-tip-sr";
      sr.textContent = c.title;
      title.append(canvas, sr);
    } catch {
      title.textContent = c.title;
    }
  } else {
    title.textContent = c.title;
  }
  parts.push(title);
  if (c.lead) {
    const lead = document.createElement("p");
    lead.className = "lt-tip-lead";
    lead.dataset.tipLead = "";
    lead.textContent = c.lead;
    parts.push(lead);
  }
  for (const line of c.lines) {
    const p = document.createElement("p");
    p.className = "lt-tip-line";
    p.textContent = line;
    parts.push(p);
  }
  if (c.footer) {
    const f = document.createElement("p");
    f.className = "lt-tip-foot";
    f.textContent = c.footer;
    parts.push(f);
  }
  parts.push(...extra);
  n.replaceChildren(...parts);
}

const INTERACTIVE = "button,a[href],input,select,textarea,summary,[role=button],[role=link]";

/**
 * Hover, focus and tap help for `el`. Returns the function that detaches it (hiding the tip if it is the one up and
 * restoring the element's tabindex and aria-describedby). Attaching twice to one element replaces the first.
 */
export function attachTip(el: HTMLElement, content: TipContent | (() => TipContent), opts: TipOptions = {}): () => void {
  if (typeof document === "undefined") return () => {};
  attached.get(el)?.();
  const resolveStyle = (): TipStyle => (typeof opts.style === "function" ? opts.style() : (opts.style ?? "bench"));
  const resolveContent = (): TipContent => (typeof content === "function" ? content() : content);

  const addedTabindex = !el.hasAttribute("tabindex") && el.tabIndex < 0;
  if (addedTabindex) el.setAttribute("tabindex", "0");
  const hadTip = el.hasAttribute("data-lt-tip");
  el.setAttribute("data-lt-tip", "");
  const interactive = el.matches(INTERACTIVE) || typeof el.onclick === "function";

  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  /** Escape closed it: hovering does not bring it straight back until the pointer has left. */
  let dismissed = false;
  let lastDown = -Infinity;
  let touchWasUp = false;
  let swallow = false;
  let swallowTimer: ReturnType<typeof setTimeout> | undefined;
  let prevDescribed: string | null = null;

  const onDocPointerDown = (e: Event): void => {
    const t = e.target as Node | null;
    if (t && (el.contains(t) || node?.contains(t))) return;
    hide();
  };
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      dismissed = true;
      hide();
    }
  };
  const onDismissScroll = (): void => hide();

  function show(): void {
    if (shown || !el.isConnected || opts.suppressed?.()) return;
    const c = resolveContent();
    const style = resolveStyle();
    if (active) active.hide();
    const n = tipNode();
    const view = viewportBox();
    const boundary = opts.boundary && opts.boundary.isConnected ? intersectBoxes(boxOf(opts.boundary.getBoundingClientRect()), view) : null;
    const bounds = boundary ?? view;
    fill(n, c, style, tipMaxWidth(bounds));
    n.classList.remove("on");
    n.style.visibility = "hidden";
    n.style.left = "0px";
    n.style.top = "0px";
    n.hidden = false;
    const size = n.getBoundingClientRect();
    const spot = placeTip(boxOf(el.getBoundingClientRect()), { width: size.width, height: size.height }, bounds);
    n.style.left = `${Math.round(spot.left)}px`;
    n.style.top = `${Math.round(spot.top)}px`;
    n.dataset.side = spot.side;
    n.style.visibility = "";
    // Next frame, so the opacity change is a transition.
    requestAnimationFrame(() => {
      if (shown) n.classList.add("on");
    });
    shown = true;
    active = { hide };
    prevDescribed = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", prevDescribed ? `${prevDescribed} ${TIP_ID}` : TIP_ID);
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKey, true);
    window.addEventListener("scroll", onDismissScroll, true);
    window.addEventListener("resize", onDismissScroll);
    // The HUD redraws its list when the game changes: a tip whose element was replaced must not be left standing.
    watch = setInterval(() => {
      if (!el.isConnected) hide();
    }, 200);
  }

  function hide(): void {
    clearTimeout(timer);
    timer = undefined;
    if (!shown) return;
    shown = false;
    clearInterval(watch);
    watch = undefined;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKey, true);
    window.removeEventListener("scroll", onDismissScroll, true);
    window.removeEventListener("resize", onDismissScroll);
    if (prevDescribed) el.setAttribute("aria-describedby", prevDescribed);
    else el.removeAttribute("aria-describedby");
    active = null;
    lastHiddenAt = performance.now();
    if (node) {
      node.classList.remove("on");
      node.hidden = true;
    }
  }

  function later(ms: number): void {
    clearTimeout(timer);
    timer = setTimeout(show, ms);
  }

  const onEnter = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse" || dismissed) return;
    later(performance.now() - lastHiddenAt < SWEEP_MS ? 0 : HOVER_DELAY_MS);
  };
  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse") return;
    dismissed = false;
    hide();
  };
  const onDown = (e: PointerEvent): void => {
    lastDown = performance.now();
    if (e.pointerType === "mouse") hide();
    else if (!opts.hoverOnly) touchWasUp = shown;
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" || opts.hoverOnly) return;
    if (touchWasUp) {
      hide();
      return;
    }
    show();
    if (shown && !interactive) {
      swallow = true;
      clearTimeout(swallowTimer);
      swallowTimer = setTimeout(() => (swallow = false), 700);
    }
  };
  const onClick = (e: MouseEvent): void => {
    if (!swallow) return;
    swallow = false;
    e.stopPropagation();
  };
  const onFocus = (): void => {
    // A tap or a click focuses too, and has its own say: only keyboard focus shows it here.
    if (performance.now() - lastDown < 600) return;
    try {
      if (!el.matches(":focus-visible")) return;
    } catch {
      /* no :focus-visible: treat it as keyboard focus */
    }
    show();
  };
  const onBlur = (): void => hide();

  el.addEventListener("pointerenter", onEnter);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("click", onClick);
  el.addEventListener("focus", onFocus);
  el.addEventListener("blur", onBlur);

  const detach = (): void => {
    hide();
    clearTimeout(swallowTimer);
    el.removeEventListener("pointerenter", onEnter);
    el.removeEventListener("pointerleave", onLeave);
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("click", onClick);
    el.removeEventListener("focus", onFocus);
    el.removeEventListener("blur", onBlur);
    if (addedTabindex) el.removeAttribute("tabindex");
    if (!hadTip) el.removeAttribute("data-lt-tip");
    if (attached.get(el) === detach) attached.delete(el);
  };
  attached.set(el, detach);
  return detach;
}

// ---- the item card: a hover tip that a click pins, with buttons ---------------

/** One button of an item card. A disabled one stays in the list with its reason printed under it. */
export interface ItemCardAction {
  id: string;
  label: string;
  enabled: boolean;
  /** Why it cannot be done (when disabled), or a short note on what it costs. Printed under the label. */
  reason?: string;
  /** When set, pressing the button asks this question first, with Yes and No ("Destroy the tarnished ring? It is gone for good."). */
  confirm?: string;
}
/** What an item card shows: the hover tip's facts, one clarity line on top, and the buttons. */
export interface ItemCardContent {
  tip: TipContent;
  /** The clarity line ("Cannot be used", "Worn: unequip it first"). Shown at the top of both the hover tip and the card. */
  status: string;
  actions: ItemCardAction[];
}

/** Where a pinned card is: shut, or open and maybe asking "are you sure" about one action. */
export type CardState = { open: false } | { open: true; confirming: string | null };
export type CardEvent = { type: "toggle" } | { type: "press"; id: string } | { type: "yes" } | { type: "no" } | { type: "dismiss" };
export interface CardStep {
  state: CardState;
  /** The action to run now (the card has already shut), or null. */
  fire: string | null;
}
export const CARD_CLOSED: CardState = { open: false };

/**
 * The card's whole behaviour as a pure step: a click or Enter pins it (and unpins it again); a button that needs no
 * confirmation fires and closes the card; one with a confirm asks first, and only Yes fires it; No goes back to the
 * buttons; Escape or a click elsewhere closes it. A disabled or unknown button does nothing at all.
 */
export function cardStep(state: CardState, ev: CardEvent, actions: readonly Pick<ItemCardAction, "id" | "enabled" | "confirm">[]): CardStep {
  const stay: CardStep = { state, fire: null };
  const find = (id: string) => actions.find((a) => a.id === id);
  switch (ev.type) {
    case "toggle":
      return { state: state.open ? CARD_CLOSED : { open: true, confirming: null }, fire: null };
    case "dismiss":
      return { state: CARD_CLOSED, fire: null };
    case "press": {
      if (!state.open) return stay;
      const a = find(ev.id);
      if (!a || !a.enabled) return stay;
      if (a.confirm && state.confirming !== a.id) return { state: { open: true, confirming: a.id }, fire: null };
      return { state: CARD_CLOSED, fire: a.id };
    }
    case "yes": {
      if (!state.open || state.confirming === null) return stay;
      const a = find(state.confirming);
      return a && a.enabled ? { state: CARD_CLOSED, fire: a.id } : { state: { open: true, confirming: null }, fire: null };
    }
    case "no":
      return state.open && state.confirming !== null ? { state: { open: true, confirming: null }, fire: null } : stay;
  }
}

/** The index the arrow keys land on in a row of `count` buttons (wrapping), or -1 when there are none. Home and End jump to the ends. */
export function cardNavIndex(count: number, current: number, key: string): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown" || key === "ArrowRight") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return current < 0 ? count - 1 : (current - 1 + count) % count;
  return current;
}

const CARD_ID = "lt-card";
const CARD_QUIET_MS = 450;
let cardBox: HTMLElement | null = null;
/** The card that is up, if any: how to close it. One at a time. */
let activeCard: { close: (refocus: boolean) => void } | null = null;
const cardAttached = new WeakMap<HTMLElement, () => void>();

function cardNode(): HTMLElement {
  if (cardBox && cardBox.isConnected) return cardBox;
  injectCss();
  cardBox = document.createElement("div");
  cardBox.id = CARD_ID;
  cardBox.className = "lt-tip lt-card";
  cardBox.setAttribute("role", "dialog");
  cardBox.hidden = true;
  document.body.appendChild(cardBox);
  return cardBox;
}

/** True while an item card is pinned (the character sheet leaves Escape to it). */
export function itemCardIsUp(): boolean {
  if (typeof document === "undefined") return false;
  const c = document.getElementById(CARD_ID);
  return !!c && !c.hidden;
}

function cardButton(a: ItemCardAction, n: number, press: (id: string) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lt-card-btn";
  b.dataset.action = a.id;
  if (a.confirm) b.dataset.confirm = "";
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = a.label;
  b.append(lbl);
  if (!a.enabled) b.setAttribute("aria-disabled", "true");
  if (a.reason) {
    const why = document.createElement("span");
    why.className = "why";
    why.id = `${CARD_ID}-why-${n}`;
    why.textContent = a.reason;
    b.append(why);
    b.setAttribute("aria-describedby", why.id);
  }
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    press(a.id);
  });
  return b;
}

/**
 * Hover, focus and pinned help for a thing you can act on (an item). It shows exactly what attachTip shows (with the status line at
 * the top) on a mouse hover or keyboard focus. A click, a tap, or Enter or Space PINS a card instead: the same facts and the status
 * line, then one button per action. A button that cannot be used is greyed and prints its reason under it (not only on hover); a button
 * with a `confirm` asks that question inline with Yes and No before it calls onAction. Escape, a click anywhere else or pressing a
 * button closes the card. Tab and the arrow keys move through the buttons. The card is bounded by opts.boundary like a tip and follows
 * the surface's style. `content` is read each time the card opens, so it is always the current facts. Returns the detach function.
 * Attaching twice to one element replaces the first.
 */
export function attachItemCard(el: HTMLElement, content: () => ItemCardContent, onAction: (id: string) => void, opts: TipOptions = {}): () => void {
  if (typeof document === "undefined") return () => {};
  cardAttached.get(el)?.();
  const resolveStyle = (): TipStyle => (typeof opts.style === "function" ? opts.style() : (opts.style ?? "bench"));

  let state: CardState = CARD_CLOSED;
  let current: ItemCardContent | null = null;
  let quietUntil = -Infinity;
  let watch: ReturnType<typeof setInterval> | undefined;
  /** The button last pressed, so Escape from a confirm puts the focus back on it. */
  let lastPressed = "";
  /** The card node this attachment put its key listeners on while it is up. */
  let listening: HTMLElement | null = null;

  const hadRole = el.hasAttribute("role");
  const interactive = el.matches(INTERACTIVE) || typeof el.onclick === "function";
  if (!hadRole && !interactive) el.setAttribute("role", "button");
  el.setAttribute("data-lt-card", "");
  el.setAttribute("aria-haspopup", "dialog");
  el.setAttribute("aria-expanded", "false");
  const detachTip = attachTip(
    el,
    () => {
      const c = content();
      return { ...c.tip, lead: c.status };
    },
    { ...opts, hoverOnly: true, suppressed: () => state.open || performance.now() < quietUntil },
  );

  const bounds = (): Box => {
    const view = viewportBox();
    const b = opts.boundary && opts.boundary.isConnected ? intersectBoxes(boxOf(opts.boundary.getBoundingClientRect()), view) : null;
    return b ?? view;
  };

  /** Where the card stands now, so a change of its content (the "are you sure" question) keeps its top and the buttons do not jump under the pointer. */
  let spotNow: { left: number; top: number } | null = null;
  const place = (keep = false): void => {
    const n = cardNode();
    const bb = bounds();
    n.style.maxHeight = `${Math.max(120, bb.height - TIP_MARGIN * 2)}px`;
    const size = n.getBoundingClientRect();
    const spot = placeTip(boxOf(el.getBoundingClientRect()), { width: size.width, height: size.height }, bb);
    let { left, top } = spot;
    if (keep && spotNow) {
      left = spotNow.left;
      top = Math.max(bb.top + TIP_MARGIN, Math.min(spotNow.top, bb.top + bb.height - TIP_MARGIN - size.height));
    }
    spotNow = { left, top };
    n.style.left = `${Math.round(left)}px`;
    n.style.top = `${Math.round(top)}px`;
    n.dataset.side = spot.side;
  };

  const buttons = (): HTMLButtonElement[] => (cardBox ? Array.from(cardBox.querySelectorAll<HTMLButtonElement>(".lt-card-btn")) : []);
  const focusFirst = (): void => {
    const list = buttons();
    (list.find((b) => b.getAttribute("aria-disabled") !== "true") ?? list[0])?.focus({ preventScroll: true });
  };

  function render(focus: "none" | "first" | "keep"): void {
    const c = content();
    current = c;
    const n = cardNode();
    const style = resolveStyle();
    const bb = bounds();
    n.style.visibility = "hidden";
    n.style.left = "0px";
    n.style.top = "0px";
    n.hidden = false;
    let extra: HTMLElement;
    let focusSel = "";
    const asking = state.open ? state.confirming : null;
    if (asking !== null) {
      const a = c.actions.find((x) => x.id === asking);
      extra = document.createElement("div");
      const q = document.createElement("p");
      q.className = "lt-card-q";
      q.dataset.cardQuestion = "";
      q.textContent = a?.confirm ?? "Are you sure?";
      const yn = document.createElement("div");
      yn.className = "lt-card-yn";
      const yes = cardButton({ id: "yes", label: "Yes", enabled: true }, 0, () => step({ type: "yes" }));
      const no = cardButton({ id: "no", label: "No", enabled: true }, 1, () => step({ type: "no" }));
      yes.dataset.yes = "";
      no.dataset.no = "";
      yn.append(yes, no);
      extra.append(q, yn);
      focusSel = "[data-no]";
    } else {
      extra = document.createElement("div");
      extra.className = "lt-card-acts";
      extra.setAttribute("role", "group");
      extra.setAttribute("aria-label", "Actions");
      c.actions.forEach((a, i) => extra.append(cardButton(a, i, (id) => step({ type: "press", id }))));
      if (c.actions.length === 0) extra = document.createElement("div");
    }
    fill(n, { ...c.tip, lead: c.status }, style, tipMaxWidth(bb), [extra]);
    n.setAttribute("aria-label", c.tip.title);
    place(focus === "keep");
    n.style.visibility = "";
    n.classList.add("on");
    if (focus === "first") focusFirst();
    else if (focus === "keep" && focusSel) cardBox?.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
    else if (focus === "keep") {
      const back = asking === null ? cardBox?.querySelector<HTMLElement>(`[data-action="${lastPressed}"]`) : null;
      (back ?? buttons()[0])?.focus({ preventScroll: true });
    }
  }

  const onDocPointerDown = (e: Event): void => {
    const t = e.target as Node | null;
    if (t && (el.contains(t) || cardBox?.contains(t))) return;
    step({ type: "dismiss" }, false);
  };
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.preventDefault();
    step({ type: "dismiss" }, true);
  };
  const reposition = (): void => {
    if (state.open && el.isConnected) place();
  };

  function open(source: "pointer" | "keyboard"): void {
    if (!el.isConnected) return;
    activeCard?.close(false);
    active?.hide();
    state = { open: true, confirming: null };
    activeCard = { close: (refocus) => step({ type: "dismiss" }, refocus) };
    el.setAttribute("aria-expanded", "true");
    render(source === "keyboard" ? "first" : "none");
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKey, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    watch = setInterval(() => {
      if (!el.isConnected) step({ type: "dismiss" }, false);
    }, 200);
    listening = cardNode();
    listening.addEventListener("keydown", onCardKey);
    listening.addEventListener("keyup", onCardKey);
    listening.addEventListener("keypress", onCardKey);
  }

  function shut(refocus: boolean): void {
    if (!state.open) return;
    state = CARD_CLOSED;
    clearInterval(watch);
    watch = undefined;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKey, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    quietUntil = performance.now() + CARD_QUIET_MS;
    el.setAttribute("aria-expanded", "false");
    if (listening) {
      listening.removeEventListener("keydown", onCardKey);
      listening.removeEventListener("keyup", onCardKey);
      listening.removeEventListener("keypress", onCardKey);
      listening = null;
    }
    activeCard = null;
    if (cardBox) {
      cardBox.classList.remove("on");
      cardBox.hidden = true;
    }
    if (refocus && el.isConnected) el.focus({ preventScroll: true });
  }

  /** Run one event through the state machine and show the result. */
  function step(ev: CardEvent, refocus = true): void {
    const actions = current?.actions ?? [];
    if (ev.type === "press") lastPressed = ev.id;
    const r = cardStep(state, ev, actions);
    if (!r.state.open) {
      const was = state.open;
      if (was) shut(refocus && r.fire === null);
      if (r.fire !== null) onAction(r.fire);
      return;
    }
    const changed = r.state !== state;
    state = r.state;
    if (changed) render("keep");
  }

  const onClick = (e: MouseEvent): void => {
    // A click that came from a key (detail 0) was already handled by onKey.
    if (e.detail === 0) return;
    e.stopPropagation();
    if (cardStep(state, { type: "toggle" }, []).state.open) open("pointer");
    else step({ type: "dismiss" }, false);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.target !== el) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (cardStep(state, { type: "toggle" }, []).state.open) open("keyboard");
      else step({ type: "dismiss" }, true);
    } else if (e.key === "Tab" && !e.shiftKey && state.open) {
      e.preventDefault();
      focusFirst();
    }
  };
  const onCardKey = (e: KeyboardEvent): void => {
    // Whatever is typed in the card is the card's own: the game behind it never sees it.
    e.stopPropagation();
    if (e.type !== "keydown" || !state.open) return;
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Tab") {
      e.preventDefault();
      if (list.length === 0) return;
      if (e.shiftKey && at <= 0) el.focus({ preventScroll: true });
      else list[e.shiftKey ? at - 1 : (at + 1) % list.length]?.focus({ preventScroll: true });
    } else if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      list[cardNavIndex(list.length, at, e.key)]?.focus({ preventScroll: true });
    }
  };
  el.addEventListener("click", onClick);
  el.addEventListener("keydown", onKey);

  const detach = (): void => {
    if (state.open) shut(false);
    detachTip();
    el.removeEventListener("click", onClick);
    el.removeEventListener("keydown", onKey);
    el.removeAttribute("data-lt-card");
    el.removeAttribute("aria-haspopup");
    el.removeAttribute("aria-expanded");
    if (!hadRole && !interactive) el.removeAttribute("role");
    if (cardAttached.get(el) === detach) cardAttached.delete(el);
  };
  cardAttached.set(el, detach);
  return detach;
}
