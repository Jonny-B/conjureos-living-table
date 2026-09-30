/**
 * Reach, range and line of sight: the spatial rule a tactical grid needs in
 * order to be a battlefield rather than a picture.
 *
 * The gap this closes: before this module, the only spatial rule anywhere in
 * the engine was "is the tile walkable." Nothing checked how far apart two
 * combatants were, so a goblin standing six tiles from the player attacked it
 * and the engine resolved the roll without comment, positioning could not
 * matter, cover could not matter, a ranged character had no advantage over a
 * melee one, and retreating out of reach was impossible because there was no
 * reach. `world/perception.ts`'s `getVisible` had been written, tested by
 * nothing and called by nobody, and `moveDistanceFeet` in manipulation.ts
 * already knew how to measure a grid distance and was only ever used for
 * movement budgets.
 *
 * Everything here is pure data in, verdict out: no World, no AI, no dice. The
 * engine still decides hit or miss (rules/combat.ts); this only decides
 * whether the swing was ever geometrically possible, which is the same class
 * of question as "is that tile a wall."
 */
import { getPlayspace, getVisible, visibleTilesFrom, type Playspace, type World } from "./perception";
import type { AssetManifest, PlacedToken } from "./cell";
import type { TileCoord } from "./coordinates";

/**
 * SRD 5.1's 5 ft. melee reach, in tiles. One tile is 5 ft. (see
 * manipulation.ts's FEET_PER_TILE) and this board measures distance
 * Chebyshev-style, so "adjacent, diagonals included" is exactly reach 1.
 */
export const DEFAULT_MELEE_REACH_TILES = 1;

/**
 * A ranged weapon's normal range, in tiles. SRD 5.1's shortbow is 80/320 ft.
 * and its light crossbow 80/320: 80 ft. is 16 tiles, which comfortably spans
 * a 20x15 cell, so in practice a ranged attack inside one cell is limited by
 * line of sight rather than by distance. That is the correct answer, not a
 * cop-out: at this board size the interesting ranged constraint IS cover.
 */
export const DEFAULT_RANGED_REACH_TILES = 16;

/** Whether an attack is being made in melee or at range -- the model declares which, the engine holds it to the matching rule. */
export type AttackRange = "melee" | "ranged";

/**
 * Everything the reach check needs about where things are standing, with no
 * dependency on World or AssetManifest so it can be built from either side
 * (the world-level `buildCombatGeometry`, or `combatGeometryFrom` on a
 * Playspace, which is all the DM-turn path holds).
 */
export interface CombatGeometry {
  /** Every token in the playspace, by id. */
  positions: Record<string, TileCoord>;
  /**
   * Token id -> the reach in tiles the engine will hold that token's attacks
   * to, when the caller actually knows it (a PC's equipped weapon). Absent
   * means "use the default for the range the attack declares," which is the
   * right answer for a monster whose stat block is the DM's own fiction.
   */
  reachTiles?: Record<string, number>;
  /** Token id -> the ids of the tokens it currently has line of sight to. Absent for a token means visibility is unknown and is not checked. */
  visibleTokens?: Record<string, string[]>;
}

export type ReachCheck = { ok: true; distance: number; reach: number } | { ok: false; error: string };

/**
 * Chebyshev distance in tiles, matching how manipulation.ts already charges
 * movement (a diagonal step costs the same as an orthogonal one, the constant
 * -cost convention most top-down grid games use, and a stated simplification
 * of SRD 5.1's alternating-diagonal rule).
 */
export function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}

function geometryFrom(tokens: PlacedToken[], visible: Map<string, TileCoord[]>, reachTiles?: Record<string, number>): CombatGeometry {
  const positions: Record<string, TileCoord> = {};
  for (const token of tokens) positions[token.id] = { x: token.x, y: token.y };

  const visibleTokens: Record<string, string[]> = {};
  for (const token of tokens) {
    const tiles = visible.get(token.id);
    if (!tiles) continue;
    const seen = new Set(tiles.map((t) => `${t.x},${t.y}`));
    visibleTokens[token.id] = tokens.filter((other) => seen.has(`${other.x},${other.y}`)).map((other) => other.id);
  }

  const geometry: CombatGeometry = { positions, visibleTokens };
  if (reachTiles) geometry.reachTiles = reachTiles;
  return geometry;
}

/**
 * Geometry from a Playspace. Uses `visibleTilesFrom`, the same Bresenham walk
 * `getVisible` delegates to, so the DM-turn path (which holds a Playspace and
 * no World) and the world-level path below agree on what a wall blocks.
 */
export function combatGeometryFrom(playspace: Playspace, reachTiles?: Record<string, number>): CombatGeometry {
  const visible = new Map<string, TileCoord[]>();
  for (const token of playspace.tokens) visible.set(token.id, visibleTilesFrom(playspace, token.id));
  return geometryFrom(playspace.tokens, visible, reachTiles);
}

/**
 * Geometry for one assembled cell of a World. This is `getVisible`'s real
 * caller: a UI that wants to gray out an out-of-reach Attack button asks for
 * the same geometry the turn validator checks against, rather than
 * re-deriving a second, subtly different notion of "can this creature be hit
 * from here." Returns undefined when the cell isn't assembled, matching
 * getPlayspace's own contract.
 */
export function buildCombatGeometry(
  world: World,
  cx: number,
  cy: number,
  manifest: AssetManifest,
  reachTiles?: Record<string, number>,
): CombatGeometry | undefined {
  const space = getPlayspace(world, cx, cy, manifest);
  if (!space) return undefined;

  const visible = new Map<string, TileCoord[]>();
  for (const token of space.tokens) visible.set(token.id, getVisible(world, cx, cy, token.id, manifest));
  return geometryFrom(space.tokens, visible, reachTiles);
}

/**
 * Whether an attack from `attackerId` at `targetId` is geometrically
 * possible: close enough for its declared range, and (for a shot) not through
 * a wall.
 *
 * FAILS OPEN when either token has no position in `geometry`. That is
 * deliberate, not an oversight: a DM legitimately requests a roll for a
 * creature it is placing in the same turn, or for something the party can
 * hear but that isn't on this cell's board, and a validator with no position
 * for one side has no fact to reject on. What it must never do is invent one.
 */
export function checkAttackReach(
  geometry: CombatGeometry,
  attackerId: string,
  targetId: string,
  range: AttackRange = "melee",
): ReachCheck {
  const from = geometry.positions[attackerId];
  const to = geometry.positions[targetId];
  const reach = geometry.reachTiles?.[attackerId] ?? (range === "ranged" ? DEFAULT_RANGED_REACH_TILES : DEFAULT_MELEE_REACH_TILES);
  if (!from || !to) return { ok: true, distance: 0, reach };

  const distance = tileDistance(from, to);
  if (distance > reach) {
    return {
      ok: false,
      error:
        `"${attackerId}" is at (${from.x},${from.y}) and "${targetId}" is at (${to.x},${to.y}), ${distance} tiles apart, ` +
        `but a ${range} attack by "${attackerId}" reaches ${reach} tile${reach === 1 ? "" : "s"}. ` +
        `Move "${attackerId}" into reach first (reason "staging") and let it attack next turn, or have it do something ` +
        `it can actually do from where it stands.`,
    };
  }

  const seen = geometry.visibleTokens?.[attackerId];
  if (seen && !seen.includes(targetId)) {
    return {
      ok: false,
      error:
        `"${attackerId}" at (${from.x},${from.y}) has no line of sight to "${targetId}" at (${to.x},${to.y}) -- there is ` +
        `something solid in between. It cannot see, and so cannot shoot, that target from there.`,
    };
  }

  return { ok: true, distance, reach };
}
