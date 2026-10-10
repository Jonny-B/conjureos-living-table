/**
 * Pure helpers of the context menu: its width, its placement on the board, its entries.
 */
import type { OverlayPoint, ContextMenuEntry } from "./overlayTypes";
import { clamp } from "./domKit";

/** The widest a context menu grows, in CSS px: wide enough for a two-line explanation at the size the labels are drawn. */
export const MENU_MAX_WIDTH = 320;
/** A menu narrower than this (CSS px) puts the Send button under its text line. */
export const MENU_NARROW_PX = 300;
/** The least air kept between a menu and the edge of the board. */
export const MENU_MARGIN = 6;
/** A context menu ignores presses this soon after it opens (the finger lifting after a long press). */
export const MENU_GRACE_MS = 300;
/** How long a loot window shows "Nothing left." before it closes itself. */
export const LOOT_EMPTY_MS = 1200;

/** The width a context menu gets on a board `boardWidth` wide: the usual maximum, less the margins on a narrow board. */
export function menuWidth(boardWidth: number): number {
  return Math.max(140, Math.min(MENU_MAX_WIDTH, boardWidth - 16));
}

export interface MenuPlacement {
  left: number;
  top: number;
  /** The menu opened to the left of the point (no room on the right). */
  flipX: boolean;
  /** The menu opened above the point (no room below). */
  flipY: boolean;
  /** The tallest it may be: the board's height less the margins. Taller content scrolls. */
  maxHeight: number;
}

/**
 * Where a menu of `size` goes for a click at `at`, inside a board of `board` (all CSS px from the board's top-left): its top-left
 * corner on the point; when it would run past the right or the bottom edge it opens to the left of or above the point instead
 * (the point stays on a corner); and when it fits neither way it is clamped inside the board less `margin`. A menu bigger than the
 * board is pinned to the near edge.
 */
export function menuPlacement(
  at: OverlayPoint,
  size: { width: number; height: number },
  board: { width: number; height: number },
  margin = MENU_MARGIN,
  /** A rectangle of the board (CSS px, from its top-left) the menu should not cover, such as the hero's square: the four flips are tried for one that clears it. */
  avoid?: MenuRect,
): MenuPlacement {
  const maxHeight = Math.max(0, board.height - margin * 2);
  const h = Math.min(size.height, maxHeight);
  const span = (start: number, len: number, total: number): { pos: number; flip: boolean } => {
    const lo = margin;
    const hi = total - margin - len;
    if (hi < lo) return { pos: lo, flip: false };
    if (start + len <= total - margin) return { pos: Math.max(lo, start), flip: false };
    const back = start - len;
    if (back >= lo) return { pos: Math.min(hi, back), flip: true };
    return { pos: clamp(start, lo, hi), flip: false };
  };
  const x = span(at.x, size.width, board.width);
  const y = span(at.y, h, board.height);
  const first: MenuPlacement = { left: x.pos, top: y.pos, flipX: x.flip, flipY: y.flip, maxHeight };
  if (!avoid || !rectsMeet({ x: first.left, y: first.top, w: size.width, h }, avoid)) return first;
  // The usual corner covers it: try the menu on the other side of the point, above it, and both, and take the first that clears it.
  const at1 = (start: number, len: number, total: number, flip: boolean): number => {
    const lo = margin;
    const hi = total - margin - len;
    if (hi < lo) return lo;
    return clamp(flip ? start - len : start, lo, hi);
  };
  for (const [flipX, flipY] of [[false, true], [true, false], [true, true]] as const) {
    const left = at1(at.x, size.width, board.width, flipX);
    const top = at1(at.y, h, board.height, flipY);
    if (!rectsMeet({ x: left, y: top, w: size.width, h }, avoid)) return { left, top, flipX, flipY, maxHeight };
  }
  return first;
}

/** A rectangle in CSS px from the board's top-left. */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether two rectangles share any area (touching edges do not count). */
export function rectsMeet(a: MenuRect, b: MenuRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The words a screen reader gets for a menu entry: its label, why it is offered, what it costs to get there, and the reason it is unavailable. */
export function menuEntryName(e: Pick<ContextMenuEntry, "label" | "why" | "note" | "enabled" | "reason">): string {
  return [e.label, e.why, e.note, !e.enabled && e.reason ? `unavailable: ${e.reason}` : ""].filter(Boolean).join(", ");
}

/**
 * The height of a board that a soft keyboard leaves free. The keyboard covers the bottom of the visible area, so the board loses however far
 * its bottom edge (`boardBottom`) sits below the bottom of what can be seen (`visibleBottom`): both in the same viewport coordinates.
 */
export function boardRoomAboveKeyboard(boardHeight: number, boardBottom: number, visibleBottom: number): number {
  return Math.max(0, boardHeight - Math.max(0, boardBottom - visibleBottom));
}

/** The entries a menu really shows: the ones with an id and a label (the rest are dropped), in their order. */
export function menuEntries(entries: readonly ContextMenuEntry[]): ContextMenuEntry[] {
  return entries.filter((e) => e.id && e.label.trim() !== "").map((e) => ({ ...e, label: e.label.replace(/\s+/g, " ").trim() }));
}

/** Which edges of a scroller still have content past them: "up" (scrolled down some), "down" (more below), "both", or "" when it all shows. 2 px of slack. */
export function moreCue(scrollTop: number, clientHeight: number, scrollHeight: number): "up" | "down" | "both" | "" {
  const up = scrollTop > 2;
  const down = scrollHeight - scrollTop - clientHeight > 2;
  return up && down ? "both" : up ? "up" : down ? "down" : "";
}

/**
 * Keep `data-more` on a scroller (none when it all shows) and call the returned function to look again after its content or size changed.
 * The style sheets draw a shade at the edge named; the attribute is also what a test reads. `off` stops listening.
 */
export function trackMore(node: HTMLElement): { update: () => void; off: () => void } {
  const update = (): void => {
    const cue = moreCue(node.scrollTop, node.clientHeight, node.scrollHeight);
    if (cue) node.dataset.more = cue;
    else delete node.dataset.more;
  };
  node.addEventListener("scroll", update, { passive: true });
  return { update, off: () => node.removeEventListener("scroll", update) };
}
