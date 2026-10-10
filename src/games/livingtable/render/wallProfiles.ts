/**
 * Wall profiles: draws walls as the strip they are seen from above, with the
 * corners, junctions and wall ends worked out from the neighbours, and draws a
 * door in a north-south wall side-on in its gap.
 *
 * Why this exists. Every wall cell drew the same front-face block, so a
 * north-south wall was a column of ashlar blocks, a corner was a block, and a
 * door standing in that column read as a chest set in it. A wall seen from
 * above is a different picture: a cap (the stone slab) wherever there is wall,
 * and a front face only where the wall actually faces the camera. That picture
 * is a property of the neighbours, so the choice of sprite is made here, from
 * the grid, rather than asked of the DM (the same argument terrainEdges.ts
 * makes for boundaries: a correct room is a property of the engine, not of a
 * good turn).
 *
 * CAMERA. Every wall cell draws its cap. A wall cell whose south neighbour is
 * not wall also shows a front face under the cap (at 16 px, rows 0 to 5 are
 * the cap band and rows 6 to 15 the face). A wall cell whose south neighbour IS
 * wall shows cap only, all sixteen rows. So a north-south run is a cap strip
 * the full tile wide, an east-west wall is a thin cap band over today's ashlar
 * face, and corners, T junctions, crossings and wall ends all fall out of the
 * four-bit mask below.
 *
 * It is DISPLAY ONLY, and that is load-bearing, for the same reason it is in
 * the other two passes. Nothing here touches the stored layout, so the DM keeps
 * laying `wall_stone` (and `_b`, `_c`, `_top`, `_base`) and `door_closed` /
 * `door_open`, and walkability, pathfinding, line of sight, validateLayout,
 * setDoorState and the turn schema read exactly what they read before. A saved
 * layout stays valid and starts drawing the new way. All five stored wall ids
 * count as wall and draw by the mask alone, so a room laid with the DM's
 * `_top` / `_base` convention and one laid in plain `wall_stone` look the same.
 *
 * ALL OR NOTHING. The swap is gated per manifest: it runs only when the
 * manifest carries all nineteen required ids (the sixteen base joins, the jamb
 * overlay and the two side-on door leaves). A partial set never draws, so a
 * manifest that lacks any one of them draws exactly what it drew before, byte
 * for byte, rather than a wall with a missing corner. The four run variants are
 * optional to the gate: a missing one just falls back to the base join.
 *
 * RENDER ONLY. The 23 ids this file names (`RENDER_ONLY_ASSET_IDS`) are never
 * the DM's to place. manifestCache.ts's adaptManifest keeps them out of the
 * world manifest and out of the prompt's id lists, which closes the hole at
 * both ends: the prompt never offers one, and naming one is rejected as an
 * unknown asset.
 *
 * It must not import terrainEdges.ts: terrainEdges composes this pass into
 * `applyDisplayTiles`, and the import would be a cycle.
 */
import type { PlacedProp, TileId } from "../world/cell";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import { VARIANT_SETS, variantAt, type VariantSet } from "./tileVariants";

/** The mask bits, the same values terrainEdges.ts uses. A bit is set when that neighbour joins this wall. */
export const WALL_N = 1;
export const WALL_E = 2;
export const WALL_S = 4;
export const WALL_W = 8;

/**
 * The join name per bitmask, indexed by (n | e | s | w): the joined sides in n,
 * e, s, w order, and "none" for a free-standing pillar. Spelled out rather than
 * derived, the way terrainEdges.ts spells its suffixes, because the art lane
 * authors tiles against these exact names and a rename here silently unnames a
 * sprite.
 *
 * What each shape is: 0 pillar, 1 south end of a north-south run, 2 west end of
 * an east-west run, 3 south-west room corner, 4 north end of a run, 5 a
 * north-south run, 6 north-west room corner, 7 junction (wall leaves east),
 * 8 east end of an east-west run, 9 south-east room corner, 10 an east-west
 * run, 11 junction (wall arrives from north), 12 north-east room corner,
 * 13 junction (wall leaves west), 14 junction (wall leaves south), 15 crossing.
 */
export const WALL_JOIN_BY_MASK: readonly string[] = [
  "none", // 0  ----
  "n", //     1  n---
  "e", //     2  -e--
  "ne", //    3  ne--
  "s", //     4  --s-
  "ns", //    5  n-s-
  "es", //    6  -es-
  "nes", //   7  nes-
  "w", //     8  ---w
  "nw", //    9  n--w
  "ew", //   10  -e-w
  "new", //  11  ne-w
  "sw", //   12  --sw
  "nsw", //  13  n-sw
  "esw", //  14  -esw
  "nesw", // 15  nesw
];

/**
 * The two long-run shapes carry interchangeable variants (`_b`, `_c`), which is
 * most of every room. This repeats tileVariants.ts's reason for scattering the
 * wall face three ways: a twenty-tile run of one sprite is a straight unbroken
 * line with nothing to interrupt the repeat. The variants differ only in where
 * the joints fall and in specks. They are optional to the gate.
 */
export const WALL_JOIN_VARIANT_SUFFIXES: Readonly<Record<string, readonly string[]>> = {
  ew: ["_b", "_c"],
  ns: ["_b", "_c"],
};

/**
 * One wall material that has drawn profiles.
 *
 * `wall` is every STORED id that IS this wall, which includes the three field
 * variants and the cap and base courses: the profile pass draws by the mask
 * alone, so `_top` and `_base` are synonyms for the plain wall here.
 *
 * `doors` maps a stored door id to the side-on leaf drawn in its place. A door
 * cell is a cell holding a prop whose assetId is a key of this table.
 */
export interface WallProfileRule {
  /** Stored ids that ARE this wall. */
  wall: readonly TileId[];
  /** Asset id prefix of the joins: prefix + a `WALL_JOIN_BY_MASK` name. */
  prefix: string;
  /** The overlay drawn on a side-on door's cell, under the leaf (a prop). */
  jambs: TileId;
  /** Stored door id to the side-on leaf id (props). */
  doors: Readonly<Record<TileId, TileId>>;
}

/**
 * Every id that counts as ONE wall: the base the DM places plus every field
 * variant tileVariants.ts may draw in its place, plus the courses the DM's
 * prompt teaches for the north and south edges.
 *
 * Derived from VARIANT_SETS the way terrainEdges.ts derives a material, for the
 * same reason: a hand copy of the list drifting from the variant set is a
 * silent bug, a wall cell wearing a variant that no rule names keeps the old
 * block on a fixed fraction of the wall.
 */
function wallIds(base: TileId, ...courses: readonly TileId[]): readonly TileId[] {
  const set = VARIANT_SETS.find((s) => s.base === base);
  return [...new Set([base, ...(set?.variants ?? []), ...courses])];
}

/**
 * Every wall with drawn profiles. Fantasy only: the sci-fi bulkhead has no
 * entry, and adding one later costs nothing until its art exists, because the
 * whole pass is gated on the manifest carrying the set.
 */
export const WALL_PROFILE_RULES: readonly WallProfileRule[] = [
  {
    wall: wallIds("wall_stone", "wall_stone_top", "wall_stone_base"),
    prefix: "wall_stone_join_",
    jambs: "wall_stone_jambs_ns",
    doors: { door_closed: "door_closed_ns", door_open: "door_open_ns" },
  },
];

/**
 * One rule's join ids, in mask order, each followed by its variants. Tiles all.
 * The sixteen with no suffix are the base joins the gate requires.
 */
function joinIdsOf(rule: WallProfileRule): TileId[] {
  const ids: TileId[] = [];
  for (const join of WALL_JOIN_BY_MASK) {
    ids.push(rule.prefix + join);
    for (const suffix of WALL_JOIN_VARIANT_SUFFIXES[join] ?? []) ids.push(rule.prefix + join + suffix);
  }
  return ids;
}

/**
 * Every id the profile pass draws with and the DM may never name: twenty join
 * tiles (sixteen base and four variants), the jamb overlay, and one side-on
 * leaf per stored door. Derived from the rules and the two tables above so a
 * new rule joins the set by being listed.
 *
 * Kind is not recorded here (the joins are tiles, the jambs and leaves are
 * props), because the one consumer that filters on it, adaptManifest, already
 * has the wire asset's own `kind` in hand.
 */
export const RENDER_ONLY_ASSET_IDS: ReadonlySet<TileId> = new Set(
  WALL_PROFILE_RULES.flatMap((rule) => [...joinIdsOf(rule), rule.jambs, ...Object.values(rule.doors)]),
);

/** Whether an id belongs to the profile pass and so is never the DM's to place. */
export function isRenderOnlyAssetId(id: TileId): boolean {
  return RENDER_ONLY_ASSET_IDS.has(id);
}

/**
 * Whether a manifest carries the whole required set for one rule: all sixteen
 * base joins as tiles, the jamb overlay and every leaf as props. The variants
 * are not asked for. This is the gate, and it is all or nothing on purpose.
 */
export function wallProfilesActive(
  rule: WallProfileRule,
  hasTile: (assetId: TileId) => boolean,
  hasProp: (assetId: TileId) => boolean,
): boolean {
  return (
    hasProp(rule.jambs) &&
    Object.values(rule.doors).every((leaf) => hasProp(leaf)) &&
    WALL_JOIN_BY_MASK.every((join) => hasTile(rule.prefix + join))
  );
}

// ── the mask ──────────────────────────────────────────────────────────────

/** Own-property lookup, so a prop called "constructor" or "toString" is never mistaken for a door. */
function isDoorKey(rule: WallProfileRule, assetId: TileId): boolean {
  return Object.hasOwn(rule.doors, assetId);
}

/**
 * A 20x15 grid of the cells that hold a door, read once per call and shared by
 * every mask lookup in it. A door cell is a cell holding a prop whose assetId
 * is a key of `rule.doors` AND whose own stored tile is not a wall id: a door
 * prop standing in a wall tile is a mistake, not a doorway, and must not count.
 */
function doorGrid(
  tiles: readonly (readonly TileId[])[],
  props: readonly Pick<PlacedProp, "assetId" | "x" | "y">[],
  rule: WallProfileRule,
): (x: number, y: number) => boolean {
  const grid: boolean[][] = Array.from({ length: CELL_HEIGHT }, () => Array<boolean>(CELL_WIDTH).fill(false));
  for (const prop of props) {
    if (!isDoorKey(rule, prop.assetId)) continue;
    const row = grid[prop.y];
    if (row === undefined || prop.x < 0 || prop.x >= CELL_WIDTH) continue;
    const own = tiles[prop.y]?.[prop.x];
    if (own === undefined || rule.wall.includes(own)) continue;
    row[prop.x] = true;
  }
  return (x, y) => grid[y]?.[x] === true;
}

function isWallAt(tiles: readonly (readonly TileId[])[], rule: WallProfileRule, x: number, y: number): boolean {
  const id = tiles[y]?.[x];
  return id !== undefined && rule.wall.includes(id);
}

/** A cell on the wall line: a wall tile, or a door cell. Out of bounds is neither. */
function inLineAt(
  tiles: readonly (readonly TileId[])[],
  rule: WallProfileRule,
  doorAt: (x: number, y: number) => boolean,
  x: number,
  y: number,
): boolean {
  if (isWallAt(tiles, rule, x, y)) return true;
  return tiles[y]?.[x] !== undefined && doorAt(x, y);
}

/**
 * Whether the neighbour one step along (dx, dy) joins the wall at (x, y). A
 * wall tile joins. A door cell joins only when the cell BEYOND it along the same
 * step is on the wall line too, which is what makes a door join the two walls
 * on either side of it (the strips run into the door's jambs). A bare gap with
 * no door joins nothing, so the walls beside it end with real ends, and a door
 * with wall on only one side joins nothing at all.
 */
function joinsAlong(
  tiles: readonly (readonly TileId[])[],
  rule: WallProfileRule,
  doorAt: (x: number, y: number) => boolean,
  x: number,
  y: number,
  dx: number,
  dy: number,
): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (isWallAt(tiles, rule, nx, ny)) return true;
  return tiles[ny]?.[nx] !== undefined && doorAt(nx, ny) && inLineAt(tiles, rule, doorAt, nx + dx, ny + dy);
}

/**
 * The four-bit join mask of the wall cell at (x, y), N=1 E=2 S=4 W=8.
 *
 * Out of bounds never joins: the next screen over is a separate 20x15 cell that
 * may not be assembled, so a border column has no outward arm, and with nothing
 * south of it the bottom screen row shows its outer face. This does not check
 * that (x, y) is itself a wall; the callers do.
 *
 * `tiles` is the STORED grid (the DM's ids, before any display pass), and
 * `doorAt` answers "is there a door in this cell", built from the layout's props.
 */
export function wallMaskAt(
  tiles: readonly (readonly TileId[])[],
  x: number,
  y: number,
  rule: WallProfileRule,
  doorAt: (x: number, y: number) => boolean,
): number {
  return (
    (joinsAlong(tiles, rule, doorAt, x, y, 0, -1) ? WALL_N : 0) |
    (joinsAlong(tiles, rule, doorAt, x, y, 1, 0) ? WALL_E : 0) |
    (joinsAlong(tiles, rule, doorAt, x, y, 0, 1) ? WALL_S : 0) |
    (joinsAlong(tiles, rule, doorAt, x, y, -1, 0) ? WALL_W : 0)
  );
}

// ── choosing the sprite ───────────────────────────────────────────────────

/**
 * The variant set of each long-run join, built once. The set lists the base
 * first and the same number of looks as the wall scatter in tileVariants.ts
 * (three), so, with the same hash, a run cell picks the same index there that
 * the scatter would have picked for the wall face it replaces.
 */
const JOIN_VARIANT_SETS = new Map<TileId, VariantSet>();

function joinVariantSet(id: TileId, suffixes: readonly string[]): VariantSet {
  let set = JOIN_VARIANT_SETS.get(id);
  if (set === undefined) {
    set = { base: id, variants: [id, ...suffixes.map((suffix) => id + suffix)] };
    JOIN_VARIANT_SETS.set(id, set);
  }
  return set;
}

for (const rule of WALL_PROFILE_RULES) {
  for (const [join, suffixes] of Object.entries(WALL_JOIN_VARIANT_SUFFIXES)) joinVariantSet(rule.prefix + join, suffixes);
}

/** The join id to draw for one mask at one coordinate, falling back to the base join when no variant of it is in the manifest. */
function joinIdFor(
  rule: WallProfileRule,
  mask: number,
  x: number,
  y: number,
  hasTile: (assetId: TileId) => boolean,
  seed: number,
): TileId {
  const join = WALL_JOIN_BY_MASK[mask] ?? "none";
  const id = rule.prefix + join;
  const suffixes = WALL_JOIN_VARIANT_SUFFIXES[join];
  if (suffixes === undefined) return id;
  return variantAt(joinVariantSet(id, suffixes), x, y, hasTile, seed) ?? id;
}

/**
 * What the profile pass needs to know about the layout beyond its tiles: where
 * the doors are, and whether the manifest carries the prop half of the set (the
 * jamb overlay and the leaves are props, and the tile pass only has `hasTile`).
 */
export interface WallPassInput {
  props: readonly Pick<PlacedProp, "assetId" | "x" | "y">[];
  hasProp: (assetId: TileId) => boolean;
}

/**
 * The id one cell would draw, or undefined when the cell is not a wall or the
 * gate is off. The single-cell accessor, for tests and for callers that want
 * one answer; the grid pass below does the same per cell.
 */
export function wallProfileAt(
  tiles: readonly (readonly TileId[])[],
  x: number,
  y: number,
  hasTile: (assetId: TileId) => boolean,
  walls: WallPassInput,
  seed = 0,
  rules: readonly WallProfileRule[] = WALL_PROFILE_RULES,
): TileId | undefined {
  const id = tiles[y]?.[x];
  if (id === undefined) return undefined;
  const rule = rules.find((r) => r.wall.includes(id));
  if (rule === undefined || !wallProfilesActive(rule, hasTile, walls.hasProp)) return undefined;
  const doorAt = doorGrid(tiles, walls.props, rule);
  return joinIdFor(rule, wallMaskAt(tiles, x, y, rule, doorAt), x, y, hasTile, seed);
}

/**
 * A copy of the display grid with every wall cell swapped for its join.
 *
 * ONLY cells whose STORED id is one of a rule's wall ids are overwritten, and
 * every mask is read from `stored`, not from `display`. That is deliberate: the
 * tile and edge passes may already have rewritten cells in `display` (a wall
 * face variant, say), and a mask read from rewritten ids would drift with
 * whatever someone adds to those passes later. The stored grid is what the DM
 * placed and what is validated, so it is the stable thing to draw walls from.
 *
 * A rule whose gate is off leaves its walls exactly as `display` has them.
 */
export function applyWallProfiles(
  display: readonly (readonly TileId[])[],
  stored: readonly (readonly TileId[])[],
  hasTile: (assetId: TileId) => boolean,
  walls: WallPassInput,
  seed = 0,
  rules: readonly WallProfileRule[] = WALL_PROFILE_RULES,
): TileId[][] {
  const out = display.map((row) => [...row]);
  const height = Math.min(stored.length, CELL_HEIGHT);

  for (const rule of rules) {
    if (!wallProfilesActive(rule, hasTile, walls.hasProp)) continue;
    const doorAt = doorGrid(stored, walls.props, rule);
    for (let y = 0; y < height; y++) {
      const row = stored[y];
      const outRow = out[y];
      if (!row || !outRow) continue;
      const width = Math.min(row.length, CELL_WIDTH);
      for (let x = 0; x < width; x++) {
        const id = row[x];
        if (id === undefined || !rule.wall.includes(id)) continue;
        outRow[x] = joinIdFor(rule, wallMaskAt(stored, x, y, rule, doorAt), x, y, hasTile, seed);
      }
    }
  }

  return out;
}

// ── doors ─────────────────────────────────────────────────────────────────

/** What a side-on door draws: the jamb overlay first, then the leaf over it. Both are props, both drawn on the door's own cell. */
export interface DoorProfile {
  jambs: TileId;
  leaf: TileId;
}

/**
 * The side-on profile of one door prop, or undefined to draw it as it is stored.
 *
 * A door is side-on when it stands in a north-south wall: wall (or another
 * door) to its north and south, and not wall on BOTH of its east and west. The
 * jambs are the wall strip's ends, drawn on the door's cell so the strip runs up
 * to the gap; the leaf is the wooden bar standing in it, closed across the gap
 * or swung open against the south jamb. Double doors work for free, because a
 * door counts as being on the wall line.
 *
 * Undefined when: the prop is not a door; the gate is off (any of the nineteen
 * ids missing); the prop stands on a wall tile; the door sits in an east-west
 * wall (it keeps today's front-view sprite); it has walls on all four sides; or
 * it is free-standing. `facing` is not read: the open leaf always folds against
 * the south jamb.
 */
export function doorProfileFor(
  tiles: readonly (readonly TileId[])[],
  prop: Pick<PlacedProp, "assetId" | "x" | "y">,
  props: readonly Pick<PlacedProp, "assetId" | "x" | "y">[],
  hasTile: (assetId: TileId) => boolean,
  hasProp: (assetId: TileId) => boolean,
  rules: readonly WallProfileRule[] = WALL_PROFILE_RULES,
): DoorProfile | undefined {
  const rule = rules.find((r) => isDoorKey(r, prop.assetId));
  if (rule === undefined || !wallProfilesActive(rule, hasTile, hasProp)) return undefined;

  const own = tiles[prop.y]?.[prop.x];
  if (own !== undefined && rule.wall.includes(own)) return undefined;

  const doorAt = doorGrid(tiles, props, rule);
  const n = inLineAt(tiles, rule, doorAt, prop.x, prop.y - 1);
  const s = inLineAt(tiles, rule, doorAt, prop.x, prop.y + 1);
  const e = inLineAt(tiles, rule, doorAt, prop.x + 1, prop.y);
  const w = inLineAt(tiles, rule, doorAt, prop.x - 1, prop.y);
  if (!(n && s && !(e && w))) return undefined;

  const leaf = rule.doors[prop.assetId];
  return leaf === undefined ? undefined : { jambs: rule.jambs, leaf };
}
