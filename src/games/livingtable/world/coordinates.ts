/**
 * The Living Table's two coordinate systems: a tile lives inside a cell, a
 * cell lives inside the world (DESIGN.md, "The coordinate system"). Keeping
 * these as distinct types, rather than two loose {x,y} pairs, is what stops a
 * cell coordinate from being passed where a tile coordinate belongs, an easy
 * mixup once both are just numbers.
 */

/** A cell's address in the world grid. */
export interface CellCoord {
  cx: number;
  cy: number;
}

/** A tile's address within one cell, zero-indexed from the top-left. */
export interface TileCoord {
  x: number;
  y: number;
}

/**
 * One cell is one screen's worth of world: a fixed 20x15 tile grid, matching
 * a classic 4th-gen 320x240 frame at 16px tiles (DESIGN.md). Every file under
 * world/ imports these rather than hardcoding 20 or 15, so the grid size is a
 * single knob, not a scattered assumption.
 */
export const CELL_WIDTH = 20;
export const CELL_HEIGHT = 15;

/** The eight directions a cell has neighbours in (the 3x3 offscreen model). */
export type Direction = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** The four directions an exit can sit on; a cell boundary has no diagonal edges. */
export type Edge = "N" | "S" | "E" | "W";

export const ALL_DIRECTIONS: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * Each direction's step in cell-space. N is "up" (negative cy), matching
 * screen convention (and how a top-down sprite grid actually reads), not
 * map/compass convention.
 */
const DIRECTION_DELTAS: Record<Direction, { dcx: number; dcy: number }> = {
  N: { dcx: 0, dcy: -1 },
  NE: { dcx: 1, dcy: -1 },
  E: { dcx: 1, dcy: 0 },
  SE: { dcx: 1, dcy: 1 },
  S: { dcx: 0, dcy: 1 },
  SW: { dcx: -1, dcy: 1 },
  W: { dcx: -1, dcy: 0 },
  NW: { dcx: -1, dcy: -1 },
};

/** The (dcx, dcy) step for one of the eight neighbour directions. */
export function directionDelta(dir: Direction): { dcx: number; dcy: number } {
  return DIRECTION_DELTAS[dir];
}

/** The cell one step away from `cell` in direction `dir`. */
export function neighbourCell(cell: CellCoord, dir: Direction): CellCoord {
  const { dcx, dcy } = directionDelta(dir);
  return { cx: cell.cx + dcx, cy: cell.cy + dcy };
}

/** Stable string key for using a CellCoord as a Map key ("cx,cy"). */
export function cellKey(cell: CellCoord): string {
  return `${cell.cx},${cell.cy}`;
}

/**
 * Whether a tile coordinate falls inside one cell's 20x15 grid, ON a real
 * tile. The integer check is load-bearing, not defensive boilerplate: a prop
 * has no walkability check by design (a statue in a wall alcove is a normal
 * placement), so the token/exit path's accidental protection via
 * `tiles[y]?.[x]` returning undefined on a fractional index does not extend
 * to props. Without this check, {x: 5.5, y: 2.25} passed every existing
 * validation and rendered as a prop floating between four tiles, exactly the
 * failure mode this module exists to make structurally impossible (found by
 * the gauntlet critic; see DECISIONS-equivalent note in the round-4 build log).
 */
export function inBounds(t: TileCoord): boolean {
  return (
    Number.isInteger(t.x) && Number.isInteger(t.y) && t.x >= 0 && t.x < CELL_WIDTH && t.y >= 0 && t.y < CELL_HEIGHT
  );
}
