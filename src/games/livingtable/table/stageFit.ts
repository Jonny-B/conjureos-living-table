/**
 * The stage fit: how big the board is drawn, for the room the page gives it.
 *
 * The board is 20 by 15 squares and used to be a fixed box (a whole zoom picked once from the window's width when the window opened).
 * Full screen then filled a quarter of the page, and a tall page was blank under a small board. Now the zoom is chosen from the stage's
 * MEASURED size (the box the board may use, which is what the window leaves after the tray column, the DM's dock band and the
 * initiative band), and chosen again whenever that box changes: a resize, a turn of the phone, full screen, a view opening.
 *
 *   - The canvas is drawn at a whole number of pixels per art pixel (the largest that fits, never below 1), so the pixels stay square,
 *     and the box it sits in is CSS-sized to fill the stage exactly. Between whole steps the canvas is a little stretched; at a whole
 *     step it is one to one. Hit-testing (flows/board.ts tileAt) already divides by the canvas's drawn size, so it survives the stretch.
 *   - An explicit zoom from the Settings tab stays whole and is capped at what fits, so it never overflows.
 *   - At 720 px and narrower, or on any portrait page (taller than it is wide by a fifth or more: a tablet held upright), the tray column stacks
 *     under the stage and the stage takes the page's width, so an upright tablet gets a full width board with the panel below it instead of a
 *     half width board beside a column; otherwise it sits beside it. On a very large page the column is scaled up (hudZoomAt) so its text and
 *     buttons keep pace with the board. The portrait rules live in stackCss(), injected once, keyed on data-lt-stack on the root.
 *     When stacked, the dice tray (the roll prompt, the tumbling dice) moves OUT of the column into the stage as a layer over the board, above the
 *     DM's dock band, because the column is below the fold on a phone.
 *   - It also keeps `data-lt-hero-rect="x,y,w,h"` (the hero's square, in client pixels) on the viewport, for the checks that make sure the
 *     DM's box never covers the hero.
 *
 * The pure part (the scale picker) is first and has no page; the window part (createStageFit) is the only one that touches the DOM.
 * Every ResizeObserver here defers its work to an animation frame: resizing what an observer watches from inside its own callback is
 * what raises "ResizeObserver loop completed with undelivered notifications" as a window error.
 */
import type { XY } from "./state";
import { TABLE_ROOT_CLASS } from "./tableStyle";

// ---- the pure part --------------------------------------------------------------------------------------------------------------------

/** The page width, in CSS pixels, at and below which the tray column stacks under the stage. */
export const STACK_AT = 720;
/** A canvas is never made wider than this many pixels (a 4K screen would otherwise ask for a canvas four times the size of the art). */
export const MAX_CANVAS_W = 2560;

/** The room the board may use, in CSS pixels. */
export interface FitSpace {
  availW: number;
  availH: number;
}

/** The board: how many squares, and how many art pixels one square is (16 or 32). */
export interface FitBoard {
  cols: number;
  rows: number;
  artPx: number;
}

/** What to draw: `scale` canvas pixels per art pixel, the canvas's own size, and the CSS size of the box it fills. */
export interface BoardFit {
  scale: number;
  canvasW: number;
  canvasH: number;
  cssW: number;
  cssH: number;
}

/** A page at least this many times taller than it is wide stacks the tray column under the stage, however wide it is. */
export const PORTRAIT_STACK_RATIO = 1.2;

/** The media query the window part listens to: narrow, or portrait enough (width / height at most 1 / 1.2, written as 5/6). */
export const STACK_QUERY = `(max-width:${STACK_AT}px), (max-aspect-ratio:5/6)`;

/**
 * True when the tray column goes under the stage: the page is narrow (a phone), or, with its height known, portrait enough that a column
 * beside the board would leave the board half the width of the page in a tall void (an upright tablet).
 */
export function stackedAt(pageWidth: number, pageHeight = 0): boolean {
  if (pageWidth <= STACK_AT) return true;
  return pageHeight > 0 && pageHeight >= pageWidth * PORTRAIT_STACK_RATIO;
}

/**
 * How much the tray column is scaled up on a large page (1 up to a 1.5 times full HD page, then 1.5, 2 and 3 as the page passes that many times
 * 1920 by 1080 on its tighter axis), so its text and buttons are not tiny beside a board that has grown to fill a 4K screen.
 */
export function hudZoomAt(pageWidth: number, pageHeight: number): number {
  if (!(pageWidth > 0) || !(pageHeight > 0)) return 1;
  const r = Math.min(pageWidth / 1920, pageHeight / 1080);
  if (r >= 3) return 3;
  if (r >= 2) return 2;
  if (r >= 1.5) return 1.5;
  return 1;
}

/**
 * The layout rules of a stacked page that is wider than 720 px (a portrait tablet), the same as tableStyle's narrow block, but keyed on
 * data-lt-stack on the root (which createStageFit sets whenever the tray column is under the stage). Four attributes deep so they beat the
 * base rules whatever order the two sheets were added in.
 */
export function stackCss(rootClass = "ltt-root"): string {
  const R = `.${rootClass}[data-fit][data-lt-stack]`;
  return [
    `.${rootClass}[data-lt-stack] .lt-arena[data-menu-open] .lt-tray-col{display:none}`,
    `${R}{height:auto;min-height:100%;padding:4px}`,
    `${R} .lt-arena{flex:1 0 auto;flex-direction:column;gap:8px}`,
    `${R} .lt-game{padding:6px}`,
    `${R} .lt-stage-wrap{flex:none;width:100%}`,
    `${R} .lt-tray-col{flex:1 0 auto;width:100%;overflow:visible}`,
  ].join(String.fromCharCode(10));
}

const finite = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** The largest whole scale at which a board still fits the room, at least 1 and not so large that the canvas passes MAX_CANVAS_W. */
export function autoScale(space: FitSpace, board: FitBoard): number {
  const tileW = board.cols * board.artPx;
  const tileH = board.rows * board.artPx;
  if (tileW <= 0 || tileH <= 0) return 1;
  const fits = Math.floor(Math.min(finite(space.availW) / tileW, finite(space.availH) / tileH));
  const cap = Math.max(1, Math.floor(MAX_CANVAS_W / tileW));
  return Math.max(1, Math.min(fits, cap));
}

/**
 * The board's fit for a room. `zoom` is the player's own choice (a whole number) or null for automatic; an explicit zoom is never above
 * what fits. The box is the largest of the board's shape that fits the room, to whole pixels (and at most the canvas's own size for an
 * explicit zoom, so a small zoom on a big screen is drawn one to one). An empty room answers a zero box, for the caller to leave alone.
 */
export function fitBoard(space: FitSpace, board: FitBoard, zoom: number | null): BoardFit {
  const auto = autoScale(space, board);
  const scale = zoom === null || !Number.isFinite(zoom) ? auto : Math.max(1, Math.min(Math.round(zoom), auto));
  const canvasW = scale * board.cols * board.artPx;
  const canvasH = scale * board.rows * board.artPx;
  const w = Math.floor(finite(space.availW));
  const h = Math.floor(finite(space.availH));
  if (w <= 0 || h <= 0 || board.cols <= 0 || board.rows <= 0) return { scale, canvasW, canvasH, cssW: 0, cssH: 0 };
  let cssW = Math.min(w, Math.floor((h * board.cols) / board.rows));
  let cssH = Math.min(h, Math.floor((w * board.rows) / board.cols));
  if (zoom !== null) {
    cssW = Math.min(cssW, canvasW);
    cssH = Math.min(cssH, canvasH);
  }
  return { scale, canvasW, canvasH, cssW, cssH };
}

// ---- the window part ------------------------------------------------------------------------------------------------------------------

export interface StageFitOptions {
  /** The window's root (the element mountTable draws into). */
  root: HTMLElement;
  arena: HTMLElement;
  /** The overlay host: it carries the dock and top-band padding and holds the board's viewport. */
  stageWrap: HTMLElement;
  viewport: HTMLElement;
  /** The box the canvas and its two layers sit in. */
  board: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The dice tray's host, moved over the stage on a narrow page. */
  trayHost: HTMLElement;
  /** False for a host that is not the game's page (the bench): the box is left as its own styles lay it out, and only the hero rect is kept. */
  managed: boolean;
  cols: number;
  rows: number;
  /** Art pixels per square now (it changes when the art loads). */
  artPx: () => number;
  /** The player's explicit zoom, or null for automatic. */
  zoom: () => number | null;
  /** The scale the stage is drawing at now, and how to set it. */
  scale: () => number;
  setScale: (n: number) => void;
  /** The picture needs redrawing (the scale changed). */
  invalidate: () => void;
  heroAt: () => XY;
}

export interface StageFit {
  /** Measure now and apply. */
  refresh(): void;
  /** The scale automatic zoom would pick right now (what "Auto" means on this page). */
  auto(): number;
  dispose(): void;
}

/** Roughly how tall the tray is when it rolls (dice.ts keeps it between 160 and 200 pixels), plus the gap below it. */
const DICE_ROOM = 216;
/** About how tall the panel under the board is on an upright tablet (the status card and its three buttons), kept clear below the board. */
const TABLET_PANEL_ROOM = 280;
/** How long the tray stays over the board after the dice settle, in ms. */
const DICE_LINGER_MS = 2400;

export function createStageFit(o: StageFitOptions): StageFit {
  const { root, arena, stageWrap, viewport, board } = o;
  const num = (v: string): number => Number.parseFloat(v) || 0;
  let disposed = false;
  let frame = 0;
  let tick = 0;
  /** Everything last applied, so an unchanged measure writes nothing (and so nothing can feed back into an observer). */
  let applied = "";
  let tickKey = "";
  let rectKey = "";

  const query = typeof window.matchMedia === "function" ? window.matchMedia(STACK_QUERY) : null;
  const stacked = (): boolean => o.managed && (query ? query.matches : stackedAt(window.innerWidth, window.innerHeight));
  if (o.managed) injectStackStyle();
  /** The tray column's current zoom, so an unchanged page writes nothing. */
  let hudZoom = 1;

  /** The room the board may use, or null before the stage has a size. */
  function space(): (FitSpace & { padY: number; winH: number; fullH: number }) | null {
    if (!stageWrap.isConnected) return null;
    const wc = getComputedStyle(stageWrap);
    const vc = getComputedStyle(viewport);
    const padX = num(wc.paddingLeft) + num(wc.paddingRight);
    const padY = num(wc.paddingTop) + num(wc.paddingBottom);
    const borderX = num(vc.borderLeftWidth) + num(vc.borderRightWidth);
    const borderY = num(vc.borderTopWidth) + num(vc.borderBottomWidth);
    const availW = stageWrap.clientWidth - padX - borderX;
    let availH: number;
    let winH = 0;
    let fullH = 0;
    if (stacked()) {
      // The stage is as tall as the board, so the room is what the scrolling window offers, less everything around the stage in it.
      const holder = root.parentElement;
      winH = holder && holder.clientHeight > 0 ? holder.clientHeight : window.innerHeight;
      const rc = getComputedStyle(root);
      const ac = getComputedStyle(arena);
      availH = winH - num(rc.paddingTop) - num(rc.paddingBottom) - num(ac.paddingTop) - num(ac.paddingBottom) - padY - borderY;
      fullH = availH;
      // A tablet held upright is wider than a phone, so its board is limited by the page's height (not the width) only if the panel under it
      // is left no room: keep a fixed amount for the panel, so the whole game is in view at once. (A phone is held by its width alone.)
      if (window.innerWidth > STACK_AT) availH -= Math.min(TABLET_PANEL_ROOM, availH * 0.4);
    } else {
      availH = stageWrap.clientHeight - padY - borderY;
      fullH = availH;
    }
    if (availW <= 0 || availH <= 0) return null;
    return { availW, availH, padY, winH, fullH };
  }

  const boardOf = (): FitBoard => ({ cols: o.cols, rows: o.rows, artPx: Math.max(1, o.artPx()) });

  /** Mark the root stacked or not (the rules of stackCss key on it) and scale the tray column for a big page, before anything is measured. */
  function applyLayout(): void {
    const on = stacked();
    if (root.hasAttribute("data-lt-stack") !== on) {
      if (on) root.setAttribute("data-lt-stack", "");
      else root.removeAttribute("data-lt-stack");
    }
    const zoom = on ? 1 : hudZoomAt(window.innerWidth, window.innerHeight);
    if (zoom !== hudZoom) {
      hudZoom = zoom;
      const col = root.querySelector<HTMLElement>(".lt-tray-col");
      if (col) col.style.zoom = zoom === 1 ? "" : String(zoom);
    }
  }

  function refresh(): void {
    if (disposed) return;
    if (o.managed) applyLayout();
    placeDice();
    if (!o.managed) return;
    const room = space();
    if (!room) return;
    const fit = fitBoard(room, boardOf(), o.zoom());
    if (fit.cssW <= 0 || fit.cssH <= 0) return;
    const vc = getComputedStyle(viewport);
    const borderX = num(vc.borderLeftWidth) + num(vc.borderRightWidth);
    const borderY = num(vc.borderTopWidth) + num(vc.borderBottomWidth);
    // On a narrow page the stage is as tall as the board and the bands (the tray's dice need a little room too); with a screen up
    // it fills the window so the screen has the whole page.
    let stageH = "";
    if (stacked()) {
      const wc = getComputedStyle(stageWrap);
      const padY = num(wc.paddingTop) + num(wc.paddingBottom);
      const own = Math.max(fit.cssH + borderY, DICE_ROOM) + padY;
      const screens = arena.hasAttribute("data-screens") || arena.hasAttribute("data-menu-open");
      stageH = `${Math.round(screens ? Math.max(own, room.fullH + borderY + room.padY) : own)}px`;
    }
    const key = [fit.scale, fit.cssW, fit.cssH, stageH].join("|");
    if (key !== applied) {
      applied = key;
      board.style.width = `${fit.cssW}px`;
      board.style.height = `${fit.cssH}px`;
      viewport.style.width = `${fit.cssW + borderX}px`;
      viewport.style.height = `${fit.cssH + borderY}px`;
      stageWrap.style.height = stageH;
    }
    if (fit.scale !== o.scale()) {
      o.setScale(fit.scale);
      o.invalidate();
    }
    markHero(true);
  }

  /** Redo the measure on the next frame, however many things ask before it. */
  function schedule(): void {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  }

  /** Add stackCss to the page, once. */
  function injectStackStyle(): void {
    const id = "lt-stagefit-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = stackCss(TABLE_ROOT_CLASS);
    document.head.appendChild(style);
  }

  // ---- the dice tray over the board on a narrow page --------------------------------------------------------------------------------

  const marker = typeof document !== "undefined" ? document.createComment("dice-tray") : null;
  let over = false;
  let linger = 0;

  /** Whether the tray has anything to show (a roll is waiting, in the air or just settled). */
  function diceState(): string {
    return o.trayHost.querySelector<HTMLElement>("[data-ltd-root]")?.dataset.state ?? "empty";
  }

  function diceVisibility(): void {
    if (!over) return;
    const state = diceState();
    window.clearTimeout(linger);
    linger = 0;
    if (state === "waiting" || state === "rolling") {
      o.trayHost.classList.remove("lt-dice-quiet");
    } else if (state === "settled") {
      o.trayHost.classList.remove("lt-dice-quiet");
      linger = window.setTimeout(() => o.trayHost.classList.add("lt-dice-quiet"), DICE_LINGER_MS);
    } else {
      o.trayHost.classList.add("lt-dice-quiet");
    }
  }

  function placeDice(): void {
    if (!o.managed || !marker) return;
    const want = stacked();
    if (want === over) return;
    over = want;
    if (want) {
      if (!marker.parentNode) o.trayHost.parentNode?.insertBefore(marker, o.trayHost);
      stageWrap.appendChild(o.trayHost);
      o.trayHost.classList.add("lt-dice-over");
      diceVisibility();
    } else {
      window.clearTimeout(linger);
      linger = 0;
      o.trayHost.classList.remove("lt-dice-over", "lt-dice-quiet");
      if (marker.parentNode) marker.parentNode.insertBefore(o.trayHost, marker);
      else root.querySelector(".lt-tray-col")?.appendChild(o.trayHost);
    }
  }

  // ---- the hero's square, for the checks ----------------------------------------------------------------------------------------------

  function markHero(force = false): void {
    const r = o.canvas.getBoundingClientRect();
    if (r.width <= 0) return;
    const at = o.heroAt();
    const tw = r.width / o.cols;
    const th = r.height / o.rows;
    const text = [r.left + at.x * tw, r.top + at.y * th, tw, th].map((n) => Math.round(n * 10) / 10).join(",");
    if (text === rectKey && !force) return;
    rectKey = text;
    viewport.setAttribute("data-lt-hero-rect", text);
  }

  /** Once a frame: a change of zoom setting or of the art's size is seen here (the Settings tab applies them on its own), and the hero's square is kept. */
  function loop(): void {
    if (disposed) return;
    tick = requestAnimationFrame(loop);
    const key = `${String(o.zoom())}|${o.artPx()}|${o.scale()}`;
    if (key !== tickKey) {
      tickKey = key;
      refresh();
      tickKey = `${String(o.zoom())}|${o.artPx()}|${o.scale()}`;
    }
    markHero();
  }

  // ---- what makes the room change ---------------------------------------------------------------------------------------------------

  const observers: Array<{ disconnect(): void }> = [];
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => schedule());
    ro.observe(stageWrap);
    ro.observe(root);
    if (root.parentElement) ro.observe(root.parentElement);
    observers.push(ro);
  }
  if (typeof MutationObserver === "function") {
    // A screen going up or down (data-screens on the arena, or the game menu on a narrow page) hides or brings back the tray column, which changes the stage's width.
    const mo = new MutationObserver(() => schedule());
    mo.observe(arena, { attributes: true, attributeFilter: ["data-screens", "data-menu-open"] });
    observers.push(mo);
    // The tray's own state (waiting, rolling, settled, empty) decides whether the layer over the board shows.
    const dice = new MutationObserver(() => diceVisibility());
    dice.observe(o.trayHost, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    observers.push(dice);
  }
  const onResize = (): void => schedule();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  document.addEventListener("fullscreenchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  query?.addEventListener?.("change", onResize);

  tick = requestAnimationFrame(loop);

  return {
    refresh,
    auto: () => {
      const room = space();
      return room ? autoScale(room, boardOf()) : o.scale();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(tick);
      window.clearTimeout(linger);
      for (const ob of observers) ob.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.removeEventListener("fullscreenchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      query?.removeEventListener?.("change", onResize);
      if (over && marker?.parentNode) marker.parentNode.insertBefore(o.trayHost, marker);
      o.trayHost.classList.remove("lt-dice-over", "lt-dice-quiet");
      marker?.remove();
      root.removeAttribute("data-lt-stack");
      const col = root.querySelector<HTMLElement>(".lt-tray-col");
      if (col) col.style.zoom = "";
    },
  };
}
