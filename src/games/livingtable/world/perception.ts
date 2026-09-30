/**
 * The world model, and everything DESIGN.md's "The perception API" says the
 * DM can ask it: the playspace (both a dense grid and an object list, not a
 * choice between them -- see DESIGN.md for why), the 3x3's other eight cells,
 * and one token's line of sight. Nothing here mutates the world; that's
 * manipulation.ts.
 */
import {
  ALL_DIRECTIONS,
  CELL_HEIGHT,
  CELL_WIDTH,
  cellKey,
  neighbourCell,
  type CellCoord,
  type Direction,
  type TileCoord,
} from "./coordinates";
import type { AssetManifest, CellLayout, Exit, PlacedProp, PlacedToken, TileId } from "./cell";
import { stakesFor, type StakeMap } from "./connectivity";
import type { Edge } from "./coordinates";

/** Assembled cells plus whatever exits are still owed to cells that don't exist yet. */
export interface World {
  cells: Map<string, CellLayout>;
  stakes: StakeMap;
}

export function emptyWorld(): World {
  return { cells: new Map(), stakes: new Map() };
}

/** The stored layout for one cell, or undefined if it's still a stub. */
export function getCell(world: World, cell: CellCoord): CellLayout | undefined {
  return world.cells.get(cellKey(cell));
}

/** Store (or overwrite) one cell's layout, returning a new World. Everything under world/ threads state functionally rather than mutating it. */
export function setCell(world: World, cell: CellCoord, layout: CellLayout): World {
  const cells = new Map(world.cells);
  cells.set(cellKey(cell), layout);
  return { ...world, cells };
}

export interface Playspace {
  cell: CellCoord;
  tiles: TileId[][];
  walkable: boolean[][];
  props: PlacedProp[];
  tokens: PlacedToken[];
  exits: Exit[];
}

/**
 * The DM's view of the party's current cell, exactly DESIGN.md's shape:
 * dense terrain (what's there, is it walkable) plus the sparse, identity-
 * bearing lists on top of it. `walkable` is derived from the manifest here,
 * never hand-authored, so it can never drift from what the manifest actually
 * says is passable.
 */
export function getPlayspace(world: World, cx: number, cy: number, manifest: AssetManifest): Playspace | undefined {
  const layout = getCell(world, { cx, cy });
  if (!layout) return undefined;

  const walkable: boolean[][] = layout.tiles.map((row) => row.map((id) => manifest.tiles[id]?.walkable === true));

  return {
    cell: { cx, cy },
    tiles: layout.tiles,
    walkable,
    props: layout.props,
    tokens: layout.tokens,
    exits: layout.exits,
  };
}

/** An opening a built neighbour has already staked on this (not yet built) cell: the DM's layout MUST leave that tile walkable, or the room it came from becomes a dead end. */
export interface OwedOpening {
  edge: Edge;
  at: TileCoord;
}

/**
 * `cell` is on both variants because the DM has to be told WHICH coordinate a
 * direction letter actually means. Without it the prompt could only print
 * eight bare letters, and on the one turn type where it matters (a fog
 * crossing, where the party is still standing in the old cell and the DM must
 * assemble the NEIGHBOUR) the model had nothing to put in assembleCell's
 * cx/cy but a guess.
 */
export type OffscreenCell =
  | { status: "unassembled"; cell: CellCoord; hint: string; owedOpenings: OwedOpening[] }
  | { status: "assembled"; cell: CellCoord; summary: string };

export type OffscreenCells = Record<Direction, OffscreenCell>;

const DEFAULT_HINT = "unexplored";

/**
 * The playspace's eight neighbours, each reported as either a built cell
 * (a short summary, cheap enough to hand the DM without resending its full
 * layout) or a stub (a hint it can build from, its real coordinates, and any
 * openings already staked on it by a built neighbour). `hints` comes from the
 * campaign plan's region sketch when one exists (campaignGenerator.ts); a cell
 * nobody planned yet still gets a generic hint rather than nothing, so the DM
 * always has something to work with when it decides to assembleCell there.
 */
export function getOffscreenCells(
  world: World,
  cx: number,
  cy: number,
  hints?: Record<string, string>,
): OffscreenCells {
  const out = {} as OffscreenCells;
  for (const dir of ALL_DIRECTIONS) {
    const neighbour = neighbourCell({ cx, cy }, dir);
    const layout = getCell(world, neighbour);
    out[dir] = layout
      ? { status: "assembled", cell: neighbour, summary: summarize(layout) }
      : {
          status: "unassembled",
          cell: neighbour,
          hint: hints?.[cellKey(neighbour)] ?? DEFAULT_HINT,
          owedOpenings: stakesFor(world.stakes, neighbour).map((s) => ({ edge: s.edge, at: s.at })),
        };
  }
  return out;
}

function summarize(layout: CellLayout): string {
  const tokens = layout.tokens.length;
  const props = layout.props.length;
  return `assembled cell, ${tokens} token${tokens === 1 ? "" : "s"}, ${props} prop${props === 1 ? "" : "s"}`;
}

/**
 * Real line of sight from one token, for stealth/ranged checks: a Bresenham
 * line to every other tile in the cell, blocked by the first non-walkable
 * tile strictly between the two (the wall itself is visible, you just can't
 * see past it). `manifest` isn't in DESIGN.md's abbreviated getVisible(tokenId)
 * signature, but walkability -- what actually blocks a line -- only exists by
 * looking a tile id up in the manifest, so there's no way to answer this
 * question without it; every other lookup in this file takes it too.
 */
export function getVisible(world: World, cx: number, cy: number, tokenId: string, manifest: AssetManifest): TileCoord[] {
  const space = getPlayspace(world, cx, cy, manifest);
  if (!space) return [];
  return visibleTilesFrom(space, tokenId);
}

/**
 * The same line of sight, computed from a Playspace rather than the World.
 * `Playspace.walkable` is already derived from the manifest (see
 * getPlayspace), so this needs no manifest of its own -- which is what lets
 * the DM-turn path, which holds a Playspace and not a World, run the exact
 * same visibility rule the world-level `getVisible` does instead of a second,
 * subtly different one.
 */
export function visibleTilesFrom(playspace: Playspace, tokenId: string): TileCoord[] {
  const from = playspace.tokens.find((t) => t.id === tokenId);
  if (!from) return [];

  const visible: TileCoord[] = [];
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      if (x === from.x && y === from.y) {
        visible.push({ x, y });
        continue;
      }
      if (hasLineOfSight(playspace.walkable, from.x, from.y, x, y)) visible.push({ x, y });
    }
  }
  return visible;
}

/**
 * Bresenham's line algorithm, walked one tile at a time, stopping at the
 * first non-walkable tile strictly between the two endpoints. The loop
 * breaks the instant it reaches (x1,y1) -- the destination doesn't block
 * itself, so a wall is visible even though nothing beyond it is.
 */
function hasLineOfSight(walkable: boolean[][], x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) break;
    if (walkable[y]?.[x] !== true) return false;
  }
  return true;
}
