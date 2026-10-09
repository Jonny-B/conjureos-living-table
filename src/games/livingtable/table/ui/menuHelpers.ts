/**
 * Pure helpers of the context menu: its width, its placement on the board, its entries.
 */
import type { OverlayPoint, ContextMenuEntry } from "./overlayTypes";
import { clamp } from "./domKit";

/** The widest a context menu grows, in CSS px: wide enough for a two-line explanation at the size the labels are drawn. */
export const MENU_MAX_WIDTH = 320;
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
export function menuPlacement(at: OverlayPoint, size: { width: number; height: number }, board: { width: number; height: number }, margin = MENU_MARGIN): MenuPlacement {
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
  return { left: x.pos, top: y.pos, flipX: x.flip, flipY: y.flip, maxHeight };
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
