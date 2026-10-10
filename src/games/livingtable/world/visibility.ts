/**
 * Sight: what blocks it, who can see whom, and what a player remembers.
 *
 * WHY THIS IS NOT "WALKABLE". The first line of sight read the tile grid's
 * walkable flag, which is wrong in both directions: a river is not walkable but
 * you can see across it, and a door is a PROP, so a shut one never stopped an
 * eye however well it stopped a foot. Sight has its own flag, `opaque`
 * (world/cell.ts), and this file is the one place that decides it.
 *
 * Three levels per square, the shape a fog-of-war picture needs:
 *   0  never seen
 *   1  seen before, not in sight now (remembered: terrain and props, never creatures)
 *   2  in sight now
 *
 * Everything here is pure: arrays in, arrays out. `perception.ts` delegates its
 * line of sight to `visibleFrom`, so `getVisible`, `visibleTilesFrom`,
 * `combatGeometryFrom`, `lineOfSightFor` and the DM's attack validation all
 * agree by construction.
 *
 * Naming: "fog" is already taken in the world code (a "fog crossing" is the
 * party walking into a cell that has not been assembled), so the code here says
 * sight and explored. "Fog of war" stays the player-facing word.
 */
import { CELL_HEIGHT, CELL_WIDTH } from "./coordinates";
import type { AssetManifest, CellLayout, TileId } from "./cell";

/** 0 never seen, 1 seen before (remembered), 2 in sight now. */
export type SightLevel = 0 | 1 | 2;

interface XY {
  x: number;
  y: number;
}

/**
 * Tiles that are NOT walkable yet do not stop a look: water and its shores
 * (water, water_edge_*), the sci-fi hazard field (hazard_vent and the
 * deckplate_hazard_edge_* run around it), and any chasm or pit. A named list
 * rather than a manifest flag for now (the backend does not send `opaque`);
 * `adaptManifest` stamps the result onto the manifest, so this runs once per
 * asset, not once per square.
 */
const TRANSPARENT_TILE = /^(water(_|$)|hazard_vent$|deckplate_hazard_edge_)|(^|_)(chasm|pit|abyss)(_|$)/;

/**
 * Props that stop a look: a closed door of any art set or orientation
 * (door_closed, door_closed_ns, door_airlock_closed), a wall jamb, trees,
 * cottage walls and roofs (not the doorway), archway jambs (not the passage),
 * pillars, stacked crates, pipe columns, and the closed blast door.
 *
 * Everything else a room holds is transparent: chests, crates, tables, beds,
 * bunks, fences, wells, railings, consoles, torches, open doors, stairs. They
 * stop a foot (their own `blocks` flag) and not an eye.
 */
const OPAQUE_PROP = new RegExp(
  [
    "^door_(.*_)?closed(_|$)",
    "^wall_",
    "^tree(_|$)",
    "^cottage_(?!door$)",
    "^arch_jamb_",
    "^pillar_",
    "^crate_stack_",
    "^pipe_column_",
    "^blast_door_",
  ].join("|"),
);

/**
 * Whether an asset id stops sight. For a tile with no named verdict the answer
 * is "not walkable" (walls, canopy, cliff faces and the like are all
 * non-walkable and all opaque), minus the transparent list above. For a prop
 * the list is the whole answer: `walkable` is ignored, because a chest is not
 * walkable and does not hide the room behind it.
 */
export function isOpaqueAssetId(kind: "tile" | "prop", assetId: string, walkable: boolean): boolean {
  if (kind === "prop") return OPAQUE_PROP.test(assetId);
  if (walkable) return false;
  return !TRANSPARENT_TILE.test(assetId);
}

/** The manifest's own verdict when it has one, else the id list. An id the manifest has never heard of still gets the list (and a tile falls back to "not walkable", i.e. opaque). */
function tileOpaque(manifest: AssetManifest, id: TileId): boolean {
  const entry = manifest.tiles[id];
  if (entry && typeof entry.opaque === "boolean") return entry.opaque;
  return isOpaqueAssetId("tile", id, entry?.walkable === true);
}

function propOpaque(manifest: AssetManifest, id: TileId): boolean {
  const entry = manifest.props[id];
  if (entry && typeof entry.opaque === "boolean") return entry.opaque;
  return isOpaqueAssetId("prop", id, entry?.blocks !== true);
}

/**
 * The sight grid, [y][x]: true where a square stops a look. Tiles and props are
 * combined (a closed door is opaque on a floor tile; a wall tile is opaque with
 * nothing on it). A prop outside the grid is ignored rather than throwing, the
 * same leniency the walkability grid has.
 */
export function sightBlockers(layout: CellLayout, manifest: AssetManifest): boolean[][] {
  const grid = layout.tiles.map((row) => row.map((id) => tileOpaque(manifest, id)));
  for (const prop of layout.props) {
    const row = grid[prop.y];
    if (!row || prop.x < 0 || prop.x >= row.length) continue;
    if (propOpaque(manifest, prop.assetId)) row[prop.x] = true;
  }
  return grid;
}

/** One-directional Bresenham walk from `a` to `b`. */
function clearOneWay(opaque: boolean[][], a: XY, b: XY): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  let x = a.x;
  let y = a.y;
  const endOpaque = opaque[b.y]?.[b.x] === true;

  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    const px = x;
    const py = y;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    const last = x === b.x && y === b.y;
    // The corner-gap rule, matching pathing.ts's squeezesOn: a diagonal step
    // between two opaque side squares is a crack, not a gap, and a look does not
    // pass it any more than a foot does. It is waived on the final step into an
    // opaque far end: that step reveals only the wall itself (the far end is
    // always visible), and without the waiver the inside corner of every square
    // room could never be seen from anywhere, because the only way to it is
    // diagonal between its two walls.
    if (x !== px && y !== py && !(last && endOpaque)) {
      if (opaque[py]?.[x] === true && opaque[y]?.[px] === true) return false;
    }
    if (last) break;
    if (opaque[y]?.[x] === true) return false;
  }
  return true;
}

/**
 * Whether the line between two squares is clear. Symmetric: the pair counts as
 * visible if a line in EITHER direction is clear, because a Bresenham line is
 * not the same set of squares both ways and "I can see you but you cannot see
 * me" is not a rule anyone wants. The endpoints never block: you stand on your
 * own square, and a wall at the far end is visible (you just cannot see past it).
 */
export function hasClearLine(opaque: boolean[][], a: XY, b: XY): boolean {
  if (a.x === b.x && a.y === b.y) return true;
  return clearOneWay(opaque, a, b) || clearOneWay(opaque, b, a);
}

/** Every square in sight from `from`, [y][x]. The viewer's own square is always in. The grid has the shape of `opaque`. */
export function visibleFrom(opaque: boolean[][], from: XY): boolean[][] {
  return opaque.map((row, y) => row.map((_, x) => hasClearLine(opaque, from, { x, y })));
}

/** Whether two squares can see each other. The same answer as `hasClearLine`, named for the question a monster or an attack check asks. */
export function canSeeEachOther(opaque: boolean[][], a: XY, b: XY): boolean {
  return hasClearLine(opaque, a, b);
}

/** A blank memory: nothing explored. Row-major, one byte (0 or 1) per square. */
export function emptyExplored(cols: number = CELL_WIDTH, rows: number = CELL_HEIGHT): Uint8Array {
  return new Uint8Array(cols * rows);
}

/** Add what is in sight now to what was already explored. Returns a NEW array; the input is left alone so a caller can keep it as the previous state. */
export function mergeExplored(explored: Uint8Array, visible: boolean[][]): Uint8Array {
  const next = new Uint8Array(explored);
  const cols = visible[0]?.length ?? 0;
  for (let y = 0; y < visible.length; y++) {
    for (let x = 0; x < cols; x++) {
      const at = y * cols + x;
      if (visible[y]?.[x] && at < next.length) next[at] = 1;
    }
  }
  return next;
}

/** One SightLevel per square, row-major: 2 in sight now, 1 explored but out of sight, 0 never seen. */
export function visibilityStates(visible: boolean[][], explored: Uint8Array): Uint8Array {
  const cols = visible[0]?.length ?? 0;
  const out = new Uint8Array(visible.length * cols);
  for (let y = 0; y < visible.length; y++) {
    for (let x = 0; x < cols; x++) {
      const at = y * cols + x;
      out[at] = visible[y]?.[x] ? 2 : explored[at] ? 1 : 0;
    }
  }
  return out;
}

/** The explored memory as a compact string: a bitset, least significant bit first, in base64. A 20x15 room is 300 bits, 52 characters. */
export function encodeExplored(explored: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(explored.length / 8));
  for (let i = 0; i < explored.length; i++) {
    if (explored[i]) bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (1 << (i & 7));
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * The inverse of `encodeExplored`. Total: a malformed string, or one saved for
 * a different room size, decodes to whatever bits it has (the rest zero) rather
 * than throwing, because a stale save must never stop a room from drawing.
 */
export function decodeExplored(s: string, cols: number = CELL_WIDTH, rows: number = CELL_HEIGHT): Uint8Array {
  const out = emptyExplored(cols, rows);
  let binary = "";
  try {
    binary = atob(s);
  } catch {
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    const byte = binary.charCodeAt(i >> 3);
    if (Number.isFinite(byte) && byte & (1 << (i & 7))) out[i] = 1;
  }
  return out;
}
