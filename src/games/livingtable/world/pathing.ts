/**
 * Pathfinding: where a creature can walk, and the squares it would walk
 * through to get there.
 *
 * DESIGN.md's "Command menu" says Move is a "pure engine (pathfind within the
 * known playspace)", and until this file nothing implemented it. The gap was
 * not cosmetic. `moveToken` (manipulation.ts) checks the DESTINATION square and
 * charges the straight-line distance to it, so handing it a far tile walks
 * straight through a wall: (9,3) to (13,3) across a wall at x=11 came back ok
 * with 10 ft. left. Every caller that moved a token more than one square had
 * to remember to step one square per call, and the one that did (a monster's
 * turn) stepped greedily toward its target and stopped at the first refusal,
 * so a goblin behind a wall with a gap in it stood at the wall forever.
 *
 * Two functions close that, and both stay pure (data in, answer out, no dice):
 *
 * - `movementField` is a breadth-first search over the 8 neighbours at 5 ft. a
 *   step. It answers "which squares can this creature reach, at what cost, and
 *   through which squares", for one reach query or a whole highlighted board.
 * - `walkPath` runs a path through `moveToken` ONE SQUARE PER CALL and stops at
 *   the first square the engine refuses. A far tile never reaches `moveToken`.
 *
 * ONE RULE FOR WHAT A STEP IS. A square is passable when world/'s own
 * `tileFreeFor` says the mover can stand there, which already covers walls,
 * blocking props (a closed door) and other creatures: this file adds no
 * walkability notion of its own, so a field can never promise a square
 * `moveToken` would then refuse. The one thing it adds is the diagonal rule
 * below, and `walkPath` enforces the same rule, so a hand-built path cannot
 * do what a found one never would.
 *
 * DIAGONALS cost the same as orthogonal steps (Chebyshev distance, the stated
 * simplification manipulation.ts and combatRound.ts already make). A diagonal
 * step may not SQUEEZE: it is refused when both squares it passes between are
 * blocked by terrain (a wall, or a closed door), because a token cannot slip
 * through a seam where two corners touch. A creature in one of those squares
 * does not count: only terrain does, so standing next to a friend never seals
 * a diagonal.
 */
import type { CellCoord, TileCoord } from "./coordinates";
import type { AssetManifest, CellLayout } from "./cell";
import { moveToken, tileFreeFor } from "./manipulation";
import { emptyWorld, getCell, getPlayspace, setCell, visibleTilesFrom, type World } from "./perception";
import { tileDistance } from "./reach";
import { FEET_PER_TILE } from "../menu/combatRound";
import { resetTurnEconomy, type TurnEconomy } from "../rules/actionEconomy";

/**
 * Every square a creature can reach from `from`, the cost in feet of getting
 * there, and the square each one was entered from.
 *
 * `reached` lists the reached squares nearest first, `from` included at 0, so a
 * UI that tints "where you can walk" can iterate it directly. `cost` and `prev`
 * are keyed by `tileKey`; read them through `fieldCostFt` and `pathTo` rather
 * than building keys by hand.
 */
export interface MovementField {
  moverId: string;
  from: TileCoord;
  /** The budget this field was built with, in feet. Infinity means "no limit" (exploring, or planning a route longer than one turn). */
  budgetFt: number;
  reached: readonly TileCoord[];
  cost: ReadonlyMap<string, number>;
  prev: ReadonlyMap<string, TileCoord>;
}

/** The key `MovementField.cost` and `.prev` use for a tile. */
export function tileKey(tile: TileCoord): string {
  return `${tile.x},${tile.y}`;
}

/**
 * Orthogonal steps first, then diagonals. Every step costs the same, so this
 * order only decides which of several equally short routes is reported, and
 * "straight, then cut the corner" reads as walking where "cut the corner, then
 * straight" reads as sidling. Fixed, so a path is the same on every run.
 */
const STEPS: readonly TileCoord[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** A layout with its creatures taken off, so `tileFreeFor` on it answers "does TERRAIN stop this square", which is what the diagonal rule is about. */
function terrainOnly(layout: CellLayout): CellLayout {
  return { ...layout, tokens: [] };
}

function squeezesOn(terrain: CellLayout, manifest: AssetManifest, from: TileCoord, to: TileCoord): boolean {
  if (from.x === to.x || from.y === to.y) return false;
  return !tileFreeFor(terrain, manifest, to.x, from.y) && !tileFreeFor(terrain, manifest, from.x, to.y);
}

/**
 * Whether stepping diagonally from `from` to `to` would squeeze between two
 * blocked squares. False for an orthogonal step. Exported so a caller that
 * validates its own steps asks the same question the field does.
 */
export function isDiagonalSqueeze(layout: CellLayout, manifest: AssetManifest, from: TileCoord, to: TileCoord): boolean {
  return squeezesOn(terrainOnly(layout), manifest, from, to);
}

/**
 * Breadth-first search over the squares `moverId` can walk to from `from`
 * within `budgetFt`. `budgetFt` is the movement the creature has LEFT: pass
 * `movementRemaining` in a fight, `Infinity` to explore (outside a fight the
 * game gives a fresh economy per step, so there is no budget to respect), and
 * a smaller number than that to ask only about this turn. A budget below one
 * step reaches nothing but `from`.
 *
 * To WALK a path out of an Infinity field, hand `walkPath` `exploreEconomy()`.
 * `resetTurnEconomy(Infinity)` throws (a speed is a finite number of feet), and
 * an ordinary 30 ft. economy stops the walk after six squares with a "not enough
 * movement" refusal, however far the field said the square was.
 *
 * `moverId` is the creature's own token id, so its current square never reads
 * as occupied by someone else (the same contract `tileFreeFor` documents).
 * `from` need not be where that token stands: planning from a hypothetical
 * square is fine.
 */
export function movementField(
  layout: CellLayout,
  manifest: AssetManifest,
  moverId: string,
  from: TileCoord,
  budgetFt: number,
): MovementField {
  const maxSteps = Number.isNaN(budgetFt) ? 0 : budgetFt === Infinity ? Infinity : Math.max(0, Math.floor(budgetFt / FEET_PER_TILE));
  const terrain = terrainOnly(layout);

  const start: TileCoord = { x: from.x, y: from.y };
  const cost = new Map<string, number>([[tileKey(start), 0]]);
  const prev = new Map<string, TileCoord>();
  const reached: TileCoord[] = [start];

  // `reached` doubles as the queue: it only ever grows, and a square is added
  // the first time it is seen, which in a breadth-first search is its shortest
  // route, so it is also in nearest-first order.
  for (let head = 0; head < reached.length; head++) {
    const at = reached[head]!;
    const steps = cost.get(tileKey(at))! / FEET_PER_TILE;
    if (steps >= maxSteps) continue;
    for (const d of STEPS) {
      const next: TileCoord = { x: at.x + d.x, y: at.y + d.y };
      const key = tileKey(next);
      if (cost.has(key)) continue;
      if (!tileFreeFor(layout, manifest, next.x, next.y, moverId)) continue;
      if (squeezesOn(terrain, manifest, at, next)) continue;
      cost.set(key, (steps + 1) * FEET_PER_TILE);
      prev.set(key, at);
      reached.push(next);
    }
  }

  return { moverId, from: start, budgetFt, reached, cost, prev };
}

/** What it costs, in feet, to reach `tile` from where the field started, or undefined when the field cannot get there. The start itself costs 0. */
export function fieldCostFt(field: MovementField, tile: TileCoord): number | undefined {
  return field.cost.get(tileKey(tile));
}

/** Every square the field reaches EXCLUDING the start, nearest first, each with its cost in feet: the list a UI tints to show "where you can walk". */
export function reachableTiles(field: MovementField): { x: number; y: number; costFt: number }[] {
  return field.reached.slice(1).map((t) => ({ x: t.x, y: t.y, costFt: field.cost.get(tileKey(t))! }));
}

/**
 * The squares to walk to get from the field's start to `to`, in order and
 * EXCLUDING the start (so a three-square walk is a three-entry list, and
 * standing already on `to` is the empty list). Null when `to` is not in the
 * field: out of reach this turn, walled off, or occupied.
 */
export function pathTo(field: MovementField, to: TileCoord): TileCoord[] | null {
  if (!field.cost.has(tileKey(to))) return null;
  const path: TileCoord[] = [];
  let at: TileCoord = to;
  while (at.x !== field.from.x || at.y !== field.from.y) {
    path.push({ x: at.x, y: at.y });
    const before = field.prev.get(tileKey(at));
    if (!before) return null;
    at = before;
  }
  return path.reverse();
}

/**
 * A line-of-sight test between two squares, for a UI or a planner that has to
 * ask "could I see the target from THERE" about squares nobody is standing on
 * yet. It runs the game's own Bresenham walk (perception.ts's
 * `visibleTilesFrom`) from a probe token, so it blocks on exactly what the
 * attack check blocks on: a wall does, and a closed door does not (the game
 * does not treat a door as blocking sight today, and this must not disagree).
 */
export function lineOfSightFor(layout: CellLayout, manifest: AssetManifest): (from: TileCoord, to: TileCoord) => boolean {
  const origin: CellCoord = { cx: 0, cy: 0 };
  const space = getPlayspace(setCell(emptyWorld(), origin, layout), origin.cx, origin.cy, manifest)!;
  const seen = new Map<string, Set<string>>();
  return (from, to) => {
    const key = tileKey(from);
    let tiles = seen.get(key);
    if (!tiles) {
      const probe = { id: "line-of-sight-probe", assetId: "", x: from.x, y: from.y, kind: "pc" as const };
      tiles = new Set(visibleTilesFrom({ ...space, tokens: [probe] }, probe.id).map(tileKey));
      seen.set(key, tiles);
    }
    return tiles.has(tileKey(to));
  };
}

/**
 * The cheapest reachable square to attack `target` from: within `reachTiles`
 * of it (Chebyshev, the engine's own measure) and, when `hasLineOfSight` is
 * given, in sight of it. Null when there is no such square in the field.
 *
 * A creature already in position gets its own square back at cost 0, so "walk
 * up and attack" and "just attack" are one call. Ties on cost go to the square
 * nearest the target, so a melee attacker picks the side that faces the target
 * before a corner, then to the lowest row and column so the answer is stable.
 * The target's own square is never an answer.
 *
 * `hasLineOfSight` is optional and fails open, the same way `attackBlockedReason`
 * treats an unknown: melee needs none (nothing lies between neighbours), a
 * ranged attacker passes `lineOfSightFor(layout, manifest)`.
 */
export function approachTile(
  field: MovementField,
  target: TileCoord,
  reachTiles: number,
  hasLineOfSight?: (from: TileCoord, to: TileCoord) => boolean,
): TileCoord | null {
  const candidates = field.reached
    .filter((t) => (t.x !== target.x || t.y !== target.y) && tileDistance(t, target) <= reachTiles)
    .map((t) => ({ tile: t, cost: field.cost.get(tileKey(t))!, near: (t.x - target.x) ** 2 + (t.y - target.y) ** 2 }));
  candidates.sort((a, b) => a.cost - b.cost || a.near - b.near || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  for (const c of candidates) {
    if (!hasLineOfSight || hasLineOfSight(c.tile, target)) return { x: c.tile.x, y: c.tile.y };
  }
  return null;
}

/**
 * The economy to walk with OUTSIDE a fight: every resource ready and movement
 * that never runs out, so a path of any length can be walked (the squares an
 * `Infinity` `movementField` reaches, which are further than one turn's speed).
 *
 * It exists because `resetTurnEconomy` will not build this. It validates its
 * speed as a finite, non-negative number of feet and throws on `Infinity`, and
 * that check is right for a combatant, whose movement is a real figure that
 * `spendMovement` counts down. Here nothing counts down: `spendMovement` takes
 * five feet off `Infinity` and leaves `Infinity`, so `walkPath` hands back an
 * economy that is still unlimited. It is for exploring only. In a fight, walk
 * with the active combatant's own economy so the budget is real, and do not
 * store this one: `Infinity` does not survive JSON.
 */
export function exploreEconomy(): TurnEconomy {
  return { ...resetTurnEconomy(0), movementRemaining: Infinity };
}

/**
 * What `walkPath` did. `steps` is the squares actually entered, in order: a
 * prefix of the path it was given, and exactly the `path` of a `move` event.
 * `refusal` says why the walk stopped early, in the engine's own words (run it
 * through `humanizeEngineError` before it reaches a player), and is null when
 * every square was entered.
 */
export interface WalkResult {
  world: World;
  economy: TurnEconomy;
  steps: TileCoord[];
  complete: boolean;
  refusal: string | null;
}

/**
 * Walk `tokenId` along `path`, one square per `moveToken` call, stopping at
 * the first square the engine refuses (a wall, a closed door, someone standing
 * there, not enough movement left). Whatever was walked before that stays
 * walked: the result carries the world and the economy as they stand at the
 * stopping square, so a half-finished walk is a legitimate outcome and not an
 * error to roll back.
 *
 * `path` is what `pathTo` returns: each square next to the one before it, the
 * first next to where the token stands, none repeated. A square that is not
 * next to the previous one is refused here, never passed to `moveToken`, which
 * would charge the straight-line distance and ignore everything in between.
 * That check, and the diagonal rule, are the reason to walk a path through
 * this function and not through a loop of the caller's own.
 *
 * `economy` is what pays for the walk, five feet a square. In a fight it is the
 * active combatant's own, and the walk stops when it runs dry. To walk a path
 * of any length outside a fight (an explore walk, which `movementField` plans
 * with a budget of `Infinity`), pass `exploreEconomy()`: building one with
 * `resetTurnEconomy(Infinity)` throws, and a finite one stops the walk early.
 */
export function walkPath(
  world: World,
  tokenId: string,
  path: readonly TileCoord[],
  cell: CellCoord,
  manifest: AssetManifest,
  economy: TurnEconomy,
): WalkResult {
  let current = world;
  let spent = economy;
  const steps: TileCoord[] = [];
  const stop = (refusal: string): WalkResult => ({ world: current, economy: spent, steps, complete: false, refusal });

  const start = getCell(current, cell)?.tokens.find((t) => t.id === tokenId);
  if (!start) return stop(`no token "${tokenId}" in cell (${cell.cx},${cell.cy})`);
  let at: TileCoord = { x: start.x, y: start.y };

  for (const step of path) {
    if (tileDistance(at, step) !== 1) {
      return stop(`(${step.x},${step.y}) is not next to (${at.x},${at.y}) -- a path is walked one square at a time`);
    }
    const layout = getCell(current, cell)!;
    if (isDiagonalSqueeze(layout, manifest, at, step)) {
      return stop(`(${step.x},${step.y}) cannot be reached diagonally from (${at.x},${at.y}) -- it would squeeze between two blocked squares`);
    }
    const result = moveToken(current, cell.cx, cell.cy, tokenId, step, manifest, spent);
    if (!result.ok) return stop(result.error);
    current = result.world;
    spent = result.economy;
    at = { x: step.x, y: step.y };
    steps.push(at);
  }
  return { world: current, economy: spent, steps, complete: true, refusal: null };
}
