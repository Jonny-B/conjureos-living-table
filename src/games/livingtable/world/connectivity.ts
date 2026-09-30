/**
 * Exit mirroring, and the standalone checks a layout must pass on its own.
 *
 * DESIGN.md ("Exits stitch the world together automatically"): assembling a
 * cell with an east exit stakes a "must connect here" constraint on its east
 * neighbour's west edge; when that neighbour is later assembled, its own west
 * exit is checked against the stake, and if its layout didn't declare one,
 * the engine inserts a matching opening at the mirrored position rather than
 * leaving a dead end. This is the module that makes "no floating props, no
 * tokens in walls, exits that go somewhere" an engine property instead of a
 * hope: it's tested directly, not inferred from a good prompt.
 */
import { CELL_HEIGHT, CELL_WIDTH, cellKey, inBounds, neighbourCell, type CellCoord, type Direction, type Edge, type TileCoord } from "./coordinates";
import type { AssetManifest, CellLayout, Exit, TileId } from "./cell";

/** The SRD 5.1 DC scale ("Very easy 5 ... Nearly impossible 30"), the range a searchable prop's `dc` has to sit inside to mean anything. */
export const MIN_DC = 5;
export const MAX_DC = 30;

/** The edge directly across a shared boundary from this one -- what an exit's mirror lands on. */
export function oppositeEdge(edge: Edge): Edge {
  switch (edge) {
    case "N":
      return "S";
    case "S":
      return "N";
    case "E":
      return "W";
    case "W":
      return "E";
  }
}

/** The boundary tile for a given edge, at position `along` (x for N/S, y for E/W). */
export function edgeCoord(edge: Edge, along: number): TileCoord {
  switch (edge) {
    case "N":
      return { x: along, y: 0 };
    case "S":
      return { x: along, y: CELL_HEIGHT - 1 };
    case "W":
      return { x: 0, y: along };
    case "E":
      return { x: CELL_WIDTH - 1, y: along };
  }
}

/** The coordinate that runs along a boundary edge -- what stays fixed when an exit mirrors to the opposite one. */
function alongCoord(edge: Edge, at: TileCoord): number {
  return edge === "N" || edge === "S" ? at.x : at.y;
}

/**
 * One pending "must connect here" constraint, deposited on a not-yet-assembled
 * neighbour when a cell is assembled with an exit pointing at it. `fromCell`
 * is who is owed the connection, so an auto-inserted exit (if the neighbour
 * never declares its own) points back the right way instead of nowhere.
 */
export interface Stake {
  edge: Edge;
  at: TileCoord;
  fromCell: CellCoord;
}

/** Pending stakes, keyed by the cell they're waiting on (see coordinates.cellKey). */
export type StakeMap = Map<string, Stake[]>;

/** The stake an exit deposits on its destination cell's opposite edge. */
export function stakeFor(fromCell: CellCoord, exit: Exit): { targetCell: CellCoord; stake: Stake } {
  const edge = oppositeEdge(exit.edge);
  const at = edgeCoord(edge, alongCoord(exit.edge, exit.at));
  return { targetCell: exit.toCell, stake: { edge, at, fromCell } };
}

/** Record a stake, returning a new map -- world state is threaded functionally throughout world/, never mutated in place. */
export function addStake(stakes: StakeMap, targetCell: CellCoord, stake: Stake): StakeMap {
  const key = cellKey(targetCell);
  const next = new Map(stakes);
  next.set(key, [...(next.get(key) ?? []), stake]);
  return next;
}

/** Stakes waiting on this cell, if any. */
export function stakesFor(stakes: StakeMap, cell: CellCoord): Stake[] {
  return stakes.get(cellKey(cell)) ?? [];
}

/** Same map with this cell's stakes cleared, once they've been reconciled at assembly time. */
export function clearStakes(stakes: StakeMap, cell: CellCoord): StakeMap {
  const next = new Map(stakes);
  next.delete(cellKey(cell));
  return next;
}

/**
 * The walkable tile id to repair a staked-but-walled opening with. Prefers a
 * walkable id the layout ALREADY uses (the most common one, so a patched tile
 * matches the room around it instead of introducing a foreign floor), and
 * falls back to any walkable id in the manifest. Returns undefined only if
 * nothing in the manifest is walkable at all, in which case there is no
 * honest repair to make and validateLayout's own rejection stands.
 */
function repairTileId(layout: CellLayout, manifest: AssetManifest): TileId | undefined {
  const counts = new Map<TileId, number>();
  for (const row of layout.tiles) {
    for (const id of row) {
      if (manifest.tiles[id]?.walkable === true) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let best: TileId | undefined;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  if (best) return best;
  return Object.keys(manifest.tiles).find((id) => manifest.tiles[id]?.walkable === true);
}

/**
 * Reconcile a layout against the stakes waiting on it: a stake already
 * satisfied by a declared exit is left alone; a stake with no matching exit
 * gets one inserted, pointing back at the cell that staked it. This is what
 * turns "the DM forgot the door back" into an opening instead of a dead end.
 *
 * `manifest` is what makes that promise real rather than nominal. Inserting
 * an Exit RECORD is not enough on its own: a DM that draws an ordinary fully
 * bordered room (the normal thing to draw) has a WALL sitting on the staked
 * tile, so the inserted exit lands on a non-walkable tile and validateLayout
 * then rejects the whole assembly with "exit sits on a non-walkable tile" --
 * turning a forgivable omission into a hard rejection of a turn the player
 * already paid a credit for. That was 2 of 5 fog crossings in a hand-authored
 * run. With the manifest in hand this also punches the tile through to a
 * walkable floor id, so a DM that forgets gets a repaired room rather than a
 * lost credit. The repair is surgical: exactly the staked tiles, nothing
 * else, and only when they are not already walkable.
 *
 * Every staked position is repaired, whether or not the DM declared its exit,
 * because a declared exit sitting on the DM's own wall tile is the same dead
 * doorway with the same fix.
 */
export function reconcileStakes(layout: CellLayout, pending: Stake[], manifest?: AssetManifest): CellLayout {
  if (pending.length === 0) return layout;
  const exits = [...layout.exits];
  let tiles = layout.tiles;
  const patch = manifest ? repairTileId(layout, manifest) : undefined;

  for (const stake of pending) {
    const satisfied = exits.some((e) => e.edge === stake.edge && e.at.x === stake.at.x && e.at.y === stake.at.y);
    if (!satisfied) {
      exits.push({ at: stake.at, edge: stake.edge, toCell: stake.fromCell });
    }
    if (!manifest || !patch) continue;
    const current = tiles[stake.at.y]?.[stake.at.x];
    if (current === undefined || manifest.tiles[current]?.walkable === true) continue;
    // Copy-on-write, once, and only for the row actually being changed --
    // everything under world/ threads state functionally rather than mutating
    // a caller's layout in place.
    if (tiles === layout.tiles) tiles = layout.tiles.map((row) => row);
    const row = [...tiles[stake.at.y]!];
    row[stake.at.x] = patch;
    tiles[stake.at.y] = row;
  }

  return { ...layout, tiles, exits };
}

/**
 * The exit (if any) on the boundary a given neighbour direction crosses.
 * Diagonals have no shared boundary edge between two cells, so they never
 * have an exit and always return undefined.
 *
 * Exported because "is there actually a way out this side" is a question the
 * command menu has to ask before offering a Move that leaves the cell:
 * without it, resolveMove reads only whether the neighbour is assembled and
 * the party walks out through the middle of a solid wall run.
 */
export function exitToNeighbour(layout: CellLayout, dir: Direction): Exit | undefined {
  if (dir !== "N" && dir !== "S" && dir !== "E" && dir !== "W") return undefined;
  return layout.exits.find((e) => e.edge === dir);
}

/**
 * Everything a layout must satisfy on its own, independent of its neighbours:
 * nothing off the 20x15 grid, no token standing on a wall, every exit on the
 * boundary its own edge implies, every exit's OWN tile walkable per the
 * manifest (an exit is a tile a token must walk onto to use it, so a doorway
 * declared on a wall tile is a dead exit, same class of bug as a token
 * standing on a wall), every exit's `toCell` the true geometric neighbour
 * that edge points to (not merely in-bounds and on the right boundary tile
 * -- an east exit whose `toCell` names the south neighbour, a distant cell,
 * or the assembling cell itself is exactly "an exit that goes somewhere"
 * failing silently, DESIGN.md's "The coordinate system"), and every asset id
 * used actually present in the manifest. `here` is the cell
 * being assembled, needed to compute that true neighbour via
 * coordinates.ts's `neighbourCell` (edge and Direction share their four
 * cardinal literals, so `exit.edge` is usable directly). Reconciliation
 * (auto-inserting a missing return exit) is reconcileStakes above, called by
 * assembleCell before this runs -- by the time validateLayout sees a layout,
 * connectivity to already-known neighbours has already been resolved, so
 * this only has to check the layout itself.
 */
export function validateLayout(
  layout: CellLayout,
  manifest: AssetManifest,
  here: CellCoord,
  // Accepted for signature parity with the rest of world/'s validation calls;
  // unused here on purpose. Reconciling a layout against pending stakes
  // (auto-inserting a missing return exit) is reconcileStakes above, and
  // assembleCell always runs it BEFORE calling this -- by the time
  // validateLayout sees a layout, any stakes it owed have already turned
  // into real exits, so there is nothing left for this function to check
  // them against.
  _stakes?: Stake[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (layout.tiles.length !== CELL_HEIGHT || layout.tiles.some((row) => row.length !== CELL_WIDTH)) {
    errors.push(`tile grid must be exactly ${CELL_WIDTH}x${CELL_HEIGHT}`);
  } else {
    for (let y = 0; y < CELL_HEIGHT; y++) {
      const row = layout.tiles[y]!;
      for (let x = 0; x < CELL_WIDTH; x++) {
        const id = row[x]!;
        if (!manifest.tiles[id]) errors.push(`tile (${x},${y}) references unknown asset "${id}"`);
      }
    }
  }

  const propIds = new Set<string>();
  for (const prop of layout.props) {
    if (propIds.has(prop.id)) {
      errors.push(`prop id "${prop.id}" is used more than once -- every prop in a cell needs its own id, or setDoorState and searching can't tell them apart`);
    }
    propIds.add(prop.id);
    if (!inBounds(prop)) errors.push(`prop "${prop.id}" at (${prop.x},${prop.y}) is out of bounds`);
    if (!manifest.props[prop.assetId]) errors.push(`prop "${prop.id}" references unknown asset "${prop.assetId}"`);
    if (prop.dc !== undefined && (!Number.isInteger(prop.dc) || prop.dc < MIN_DC || prop.dc > MAX_DC)) {
      errors.push(`prop "${prop.id}" has dc ${prop.dc}, outside the SRD ${MIN_DC} to ${MAX_DC} scale -- use ${MIN_DC} for "anyone spots it" up to ${MAX_DC} for "nearly impossible"`);
    }
  }

  // Token identity is load-bearing far outside this function: turnSchema.ts
  // spends about a hundred lines guaranteeing "one resolved roll decides one
  // outcome, not several," and that guarantee is unconditional on ids being
  // unique, which nothing enforced anywhere until here. Two monsters sharing
  // an id let a single cited hit remove both. Occupancy is the same class of
  // problem the player can actually SEE: SRD 5.1 is explicit that a creature
  // can't end its move in another creature's space, and the renderer just
  // draws two sprites on top of each other.
  const tokenIds = new Set<string>();
  const occupied = new Map<string, string>();
  for (const token of layout.tokens) {
    if (tokenIds.has(token.id)) {
      errors.push(`token id "${token.id}" is used more than once -- every token in a cell needs its own id, or one roll's outcome can land on more than one creature`);
    }
    tokenIds.add(token.id);
    if (!inBounds(token)) {
      errors.push(`token "${token.id}" at (${token.x},${token.y}) is out of bounds`);
      continue;
    }
    if (!manifest.tokens[token.assetId]) {
      errors.push(`token "${token.id}" references unknown asset "${token.assetId}"`);
    }
    const tileId = layout.tiles[token.y]?.[token.x];
    if (!tileId || manifest.tiles[tileId]?.walkable !== true) {
      errors.push(`token "${token.id}" at (${token.x},${token.y}) is not on a walkable tile`);
    }
    const square = `${token.x},${token.y}`;
    const sitting = occupied.get(square);
    if (sitting !== undefined) {
      errors.push(`tokens "${sitting}" and "${token.id}" are both standing at (${token.x},${token.y}) -- two creatures cannot share one square, put one of them on an adjacent tile`);
    } else {
      occupied.set(square, token.id);
    }
  }

  for (const exit of layout.exits) {
    if (!inBounds(exit.at)) {
      errors.push(`exit at (${exit.at.x},${exit.at.y}) is out of bounds`);
      continue;
    }
    const expected = edgeCoord(exit.edge, alongCoord(exit.edge, exit.at));
    if (expected.x !== exit.at.x || expected.y !== exit.at.y) {
      errors.push(`exit at (${exit.at.x},${exit.at.y}) is not on its ${exit.edge} boundary`);
    }
    const exitTileId = layout.tiles[exit.at.y]?.[exit.at.x];
    if (!exitTileId || manifest.tiles[exitTileId]?.walkable !== true) {
      errors.push(`exit at (${exit.at.x},${exit.at.y}) sits on a non-walkable tile, so nothing could ever walk onto it`);
    }
    const trueNeighbour = neighbourCell(here, exit.edge);
    if (exit.toCell.cx !== trueNeighbour.cx || exit.toCell.cy !== trueNeighbour.cy) {
      errors.push(
        `exit at (${exit.at.x},${exit.at.y}) on edge ${exit.edge} of cell (${here.cx},${here.cy}) claims toCell ` +
          `(${exit.toCell.cx},${exit.toCell.cy}), but that edge's true neighbour is (${trueNeighbour.cx},${trueNeighbour.cy})`,
      );
    }
  }

  // A cell with no exits at all is a room the party walks into and can never
  // leave. Before this check both validateLayout and assembleCell returned ok
  // on a 20x15 room with a solid border and zero exits, and the only thing
  // that ever caught one was luck: a neighbour's stake happening to land on a
  // wall. `sealed` is the deliberate escape hatch (a vault, a chamber the DM
  // means to open later with setDoorState), so the check is about an
  // ACCIDENTAL dead end, not about forbidding one on purpose.
  if (layout.exits.length === 0 && layout.sealed !== true) {
    errors.push(
      `this cell declares no exits at all, so nothing could ever walk out of it. Give it at least one exit on a ` +
        `boundary tile (and make that tile walkable), or set "sealed": true if the room really is meant to be closed.`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
