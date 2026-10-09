/**
 * Pure layout maths for floats, plates and the dialogue hold: float stacking, size tiers, verdict words.
 */
import type { OverlayPoint, PlateReadout } from "./overlayTypes";
import { FLOAT_STACK_MS, FLOAT_GAP_PX, FLOAT_BASE_PX, STRIP_MAX_MS, STRIP_BASE_MS, STRIP_PER_CHAR_MS, STRIP_REDUCED_MAX_MS, STRIP_REDUCED_FACTOR } from "./overlayTheme";

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

/**
 * How long the last entry in the dialogue box waits, once it is all printed, before it fades: about 3.5 s plus 40 ms a character,
 * never more than 9 s. Under reduced motion (`still`) it is half as long again, up to 13.5 s, but it still clears.
 */
export function stripHoldMs(chars: number, still = false): number {
  const ms = Math.min(STRIP_MAX_MS, STRIP_BASE_MS + STRIP_PER_CHAR_MS * Math.max(0, chars));
  return still ? Math.min(STRIP_REDUCED_MAX_MS, Math.round(ms * STRIP_REDUCED_FACTOR)) : ms;
}

/**
 * The room the DM box takes at its fullest, in px, rounded up: `lines` rows of `row` px and the `chrome` around them (its frame and
 * its speaker tag). The board keeps clear of this much at its foot (the --lto-dock band) whether the box is up or not, so it never jumps.
 */
export function dialogueBoxPx(o: { lines: number; row: number; chrome: number }): number {
  return Math.ceil(Math.max(1, o.lines) * o.row + o.chrome);
}

/**
 * How many text rows a page of the story screen holds: as many as fit in `availH` px after `chrome` px of title, footer and frame,
 * at most 8 (a page you can read in one look) and at least 3.
 */
export function storyPerPage(availH: number, row: number, chrome: number): number {
  const fit = Math.floor((availH - chrome) / Math.max(1, row));
  return Math.max(3, Math.min(8, Number.isFinite(fit) ? fit : 3));
}
