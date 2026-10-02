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
 * Node), and this file must never be imported by src/.
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
}
export type TipStyle = "pixel" | "storybook" | "bench";

export interface TipOptions {
  /** The box the tip must stay inside (the game window). Default: the viewport. */
  boundary?: HTMLElement;
  /** The look. A function is read each time the tip opens, for a surface that can change style. Default "bench". */
  style?: TipStyle | (() => TipStyle);
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
  --tt-bg:#fff;--tt-ink:#1d1b16;--tt-muted:#6c6656;--tt-edge:#ddd7c9;--tt-accent:var(--tt-ink);color:var(--tt-ink);background:var(--tt-bg);border:1px solid var(--tt-edge)}
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

.lt-tip[data-style="pixel"]{--tt-bg:#141a3c;--tt-ink:#f4ecd0;--tt-muted:#98a5d8;--tt-edge:#4d5da6;--tt-accent:#ffc72a;border:2px solid var(--tt-edge);border-radius:0;
  box-shadow:0 0 0 2px #05061a,inset 0 0 0 1px #2c3874,0 6px 0 2px rgb(5 6 26/.45);font:13px/1.4 ${SANS}}
.lt-tip[data-style="pixel"][data-tone="good"]{--tt-edge:#59dd82;--tt-accent:#59dd82}
.lt-tip[data-style="pixel"][data-tone="bad"]{--tt-edge:#ff5a4a;--tt-accent:#ff5a4a}
.lt-tip[data-style="pixel"][data-tone="magic"]{--tt-edge:#a97bff;--tt-accent:#c9a6ff}
.lt-tip[data-style="pixel"] .lt-tip-title{font-size:14px}
.lt-tip[data-style="pixel"] .lt-tip-foot{font-size:12px;border-top:2px solid #2c3874}

.lt-tip[data-style="storybook"]{--tt-bg:#f6edd6;--tt-ink:#2a2016;--tt-muted:#6a5a3f;--tt-edge:#7c5c1e;--tt-accent:#8a5208;border-radius:9px;
  background:linear-gradient(180deg,#f6edd6,#e8d8b0);box-shadow:inset 0 0 0 2px #f6edd6,inset 0 0 0 3px #cf9f3b,0 8px 18px rgb(46 28 8/.35);font:14px/1.38 ${SERIF}}
.lt-tip[data-style="storybook"][data-tone="good"]{--tt-accent:#2a6a33}
.lt-tip[data-style="storybook"][data-tone="bad"]{--tt-accent:#a5281c}
.lt-tip[data-style="storybook"][data-tone="magic"]{--tt-accent:#6b3fa0}
.lt-tip[data-style="storybook"] .lt-tip-title{font-size:13px;letter-spacing:.07em;text-transform:uppercase}
.lt-tip[data-style="storybook"] .lt-tip-foot{font-size:12.5px;font-style:italic;border-top:1px solid #7c5c1e55}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lt-tip[data-style="storybook"]{--tt-bg:#25203a;--tt-ink:#f3e9cf;--tt-muted:#b6ab90;--tt-edge:#c79d45;--tt-accent:#ffd27a;
  background:linear-gradient(180deg,#25203a,#181526);box-shadow:inset 0 0 0 2px #25203a,inset 0 0 0 3px #e6bf5e,0 8px 18px rgb(0 0 0/.55)}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"][data-tone="good"]{--tt-accent:#86e096}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"][data-tone="bad"]{--tt-accent:#ff8c7a}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"][data-tone="magic"]{--tt-accent:#c9a6ff}
:root:not([data-theme="light"]) .lt-tip[data-style="storybook"] .lt-tip-foot{border-top-color:#c79d4566}}
:root[data-theme="dark"] .lt-tip[data-style="storybook"]{--tt-bg:#25203a;--tt-ink:#f3e9cf;--tt-muted:#b6ab90;--tt-edge:#c79d45;--tt-accent:#ffd27a;
  background:linear-gradient(180deg,#25203a,#181526);box-shadow:inset 0 0 0 2px #25203a,inset 0 0 0 3px #e6bf5e,0 8px 18px rgb(0 0 0/.55)}
:root[data-theme="dark"] .lt-tip[data-style="storybook"][data-tone="good"]{--tt-accent:#86e096}
:root[data-theme="dark"] .lt-tip[data-style="storybook"][data-tone="bad"]{--tt-accent:#ff8c7a}
:root[data-theme="dark"] .lt-tip[data-style="storybook"][data-tone="magic"]{--tt-accent:#c9a6ff}
:root[data-theme="dark"] .lt-tip[data-style="storybook"] .lt-tip-foot{border-top-color:#c79d4566}

.lt-tip[data-style="bench"]{--tt-bg:var(--bn-panel,#fff);--tt-ink:var(--bn-text,#1d1b16);--tt-muted:var(--bn-muted,#6c6656);--tt-edge:var(--bn-line,#ddd7c9);--tt-accent:var(--bn-text,#1d1b16);border-radius:8px;
  box-shadow:0 6px 20px rgb(0 0 0/.25);font:13px/1.45 ${SANS}}
.lt-tip[data-style="bench"][data-tone="good"]{--tt-accent:#2a7d45}
.lt-tip[data-style="bench"][data-tone="bad"]{--tt-accent:var(--bn-danger,#b3311d)}
.lt-tip[data-style="bench"][data-tone="magic"]{--tt-accent:var(--bn-accent,#6d4fe0)}
.lt-tip[data-style="bench"] .lt-tip-foot{font-size:12px}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lt-tip[data-style="bench"][data-tone="good"]{--tt-accent:#6fd68f}}
:root[data-theme="dark"] .lt-tip[data-style="bench"][data-tone="good"]{--tt-accent:#6fd68f}
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
function fill(n: HTMLElement, c: TipContent, style: TipStyle, maxWidth: number): void {
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
    if (shown || !el.isConnected) return;
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
    else touchWasUp = shown;
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") return;
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
