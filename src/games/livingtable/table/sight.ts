/**
 * Sight and the fog of war, as the table window uses them: what the hero sees
 * now, what it has seen, and the small turn helpers that read the same grid
 * (whose turn it is, how far the hero may still walk, where it may step, which
 * sleeping hostile notices it).
 *
 * All of it is the engine's own world/visibility.ts and world/pathing.ts, so the
 * table and the game cannot disagree about what a closed door hides. Three
 * levels per square: 2 in sight now, 1 seen before, 0 never seen.
 *
 * Copied from the bench's Play panel. The one change: the tile library's flags
 * (walkable, blocking, opaque) come from the bound catalog (worldManifest in
 * catalog.ts) instead of a constant built from the bench's own sprite arrays.
 * Import-pure: nothing runs until a function is called.
 */
import { activeCombatant, FEET_PER_TILE, isPlayersTurn } from "../menu/combatRound";
import { sentenceCase, type TokenNamer } from "../menu/labels";
import { weaponFor } from "../session/combat";
import type { CellLayout } from "../world/cell";
import { CELL_WIDTH } from "../world/coordinates";
import { lineOfSightFor, type MovementField, movementField } from "../world/pathing";
import { DEFAULT_MELEE_REACH_TILES, DEFAULT_RANGED_REACH_TILES, tileDistance } from "../world/reach";
import { canSeeEachOther, mergeExplored, sightBlockers, visibleFrom } from "../world/visibility";
import { advPropWords, pathToward, sceneLayout, sceneTiles, terrainBlocks } from "./adventureRun";
import { worldManifest } from "./catalog";
import {
  type Creature,
  creatureAt,
  creatureById,
  creatureLabel,
  creatureName,
  HERO_ID,
  heroDown,
  MONSTER_HEARS_STEPS,
  MONSTER_WAKE_TILES,
  NOT_SEEN,
  type PlayState,
  same,
  SCENE_KIT,
  type XY,
} from "./state";

/** The scene as the engine sees it: the room plus both figures as tokens. */
export function engineLayout(p: PlayState): CellLayout {
  return sceneLayout(p, false);
}

// ---------------------------------------------------------------------------
// Sight and the fog of war: all of it the engine's world/visibility.ts, so the
// bench and the game cannot disagree about what a closed door hides. Three
// levels per square: 2 in sight now, 1 seen before, 0 never seen.
// ---------------------------------------------------------------------------

export interface SightKit {
  /** The sight grid, [y][x]: true where a square stops a look. */
  opaque: boolean[][];
  /** Whether two squares can see each other (lineOfSightFor: the attack check's own rule). */
  los: (from: XY, to: XY) => boolean;
}

/** Everything the grid depends on: the tiles (template and floor), the door, and whatever the DM changed (worldRev). Nothing else in the scene stops a look. */
const sightKey = (p: PlayState): string => `${p.template}|${p.floorId}|${p.doorOpen ? 1 : 0}|${p.worldRev}|${p.boardEpoch}`;

let kitCache: { key: string; kit: SightKit } | null = null;
export function sightKit(p: PlayState): SightKit {
  const key = sightKey(p);
  if (kitCache?.key === key) return kitCache.kit;
  const layout = engineLayout(p);
  const manifest = worldManifest(p.template);
  const kit: SightKit = { opaque: sightBlockers(layout, manifest), los: lineOfSightFor(layout, manifest) };
  kitCache = { key, kit };
  return kit;
}

let visibleCache: { key: string; visible: boolean[][] } | null = null;
/** What the hero sees right now, [y][x]. */
export function heroSees(p: PlayState): boolean[][] {
  const key = `${sightKey(p)}|${p.heroAt.x},${p.heroAt.y}`;
  if (visibleCache?.key === key) return visibleCache.visible;
  const visible = visibleFrom(sightKit(p).opaque, p.heroAt);
  visibleCache = { key, visible };
  return visible;
}

/** Whether the hero sees this square now. */
export const seesTile = (p: PlayState, at: XY): boolean => heroSees(p)[at.y]?.[at.x] === true;
/** Whether the hero has this creature in sight now. A creature out of sight is never drawn, outlined, clicked or attacked. */
export const creatureInSight = (p: PlayState, c: Creature): boolean => seesTile(p, c.at);
/** The creatures the hero sees now. */
export const creaturesInSight = (p: PlayState): Creature[] => p.creatures.filter((c) => seesTile(p, c.at));
/** Any hostile in sight, asleep or not. */
export const hostileInSight = (p: PlayState): boolean => p.creatures.some((c) => c.hostile && seesTile(p, c.at));

/** 2 in sight now, 1 seen before, 0 never seen. */
export function sightLevel(p: PlayState, at: XY): 0 | 1 | 2 {
  if (seesTile(p, at)) return 2;
  return p.explored[at.y * CELL_WIDTH + at.x] ? 1 : 0;
}

/** After anything that changes what the hero can see (a step, a door, a creature moving, a new scene): remember what is in sight now, and note which creatures have been seen. */
export function noteSight(p: PlayState): void {
  const visible = heroSees(p);
  let gained = false;
  for (let y = 0; y < visible.length && !gained; y++) {
    const row = visible[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x] && !p.explored[y * CELL_WIDTH + x]) {
        gained = true;
        break;
      }
    }
  }
  if (gained) {
    p.explored = mergeExplored(p.explored, visible);
    p.exploredRev++;
  }
  for (const c of p.creatures) if (!c.seen && seesTile(p, c.at)) c.seen = true;
}

/** What the readout calls a creature: its name once the hero has seen it, "???" before. */
export const foeName = (p: PlayState, c: Creature): string => (c.seen ? creatureName(p, c) : "???");

export function namerFor(p: PlayState): TokenNamer {
  return { playerTokenId: HERO_ID, playerName: p.hero.name, tokens: engineLayout(p).tokens };
}

export function heroesTurn(p: PlayState): boolean {
  return p.round !== null && isPlayersTurn(p.round);
}

/** Feet the hero may still walk: unlimited while exploring, the turn's movement in a fight, nothing on someone else's turn. */
export function heroBudgetFt(p: PlayState): number {
  if (!p.round) return Infinity;
  if (!isPlayersTurn(p.round)) return 0;
  return activeCombatant(p.round)?.economy.movementRemaining ?? 0;
}

export function heroActionReady(p: PlayState): boolean {
  if (!p.round) return true;
  return isPlayersTurn(p.round) && activeCombatant(p.round)?.economy.action === true;
}

/** The creature whose turn it is, or undefined while it is the hero's (or no fight is on). */
export function activeCreature(p: PlayState): Creature | undefined {
  const a = p.round ? activeCombatant(p.round) : undefined;
  return a && a.side === "hostile" ? creatureById(p, a.id) : undefined;
}

/**
 * Every square the hero can walk to now, with what it costs. A walk goes only
 * through squares the hero has seen: the others are walled off for the search,
 * so a path never runs into fog (and never gives away what is in it).
 */
export function heroField(p: PlayState): MovementField {
  const layout = engineLayout(p);
  const wall = SCENE_KIT[p.template].wall;
  const known = { ...layout, tiles: layout.tiles.map((row, y) => row.map((id, x) => (p.explored[y * CELL_WIDTH + x] ? id : wall))) };
  return movementField(known, worldManifest(p.template), HERO_ID, p.heroAt, heroBudgetFt(p));
}

export function heroReachTiles(p: PlayState): number {
  return weaponFor(p.hero).ranged ? DEFAULT_RANGED_REACH_TILES : DEFAULT_MELEE_REACH_TILES;
}

/** Why the hero cannot stand on `to`, in words. */
export function blockedWords(p: PlayState, to: XY): string {
  const kit = SCENE_KIT[p.template];
  if (sightLevel(p, to) === 0) return NOT_SEEN;
  const blocked = terrainBlocks(p, sceneTiles(p), to);
  if (blocked === "door") return p.doorLocked ? `${sentenceCase(kit.doorLabel)} is locked.` : `${sentenceCase(kit.doorLabel)} is closed. Right-click it (or press and hold) to open it.`;
  if (blocked === "container") return `${sentenceCase(kit.containerLabel)} is in the way.`;
  if (blocked === "prop") return `${sentenceCase(p.extraProps.find((e) => same(e, to))?.label ?? advPropWords(p, to) ?? "something")} is in the way.`;
  if (blocked) return "A wall. You cannot walk through it.";
  const there = creatureAt(p, to);
  if (there && creatureInSight(p, there)) return `${sentenceCase(creatureLabel(p, there))} is in the way.`;
  if (p.round && heroBudgetFt(p) < FEET_PER_TILE) return "No movement left this turn. Attack, or end your turn.";
  return p.round ? "Too far to walk this turn." : "You cannot get there from here.";
}

/**
 * Whether this sleeping hostile notices the hero, which is when it joins a fight (or starts one): the two
 * see each other within MONSTER_WAKE_TILES (the engine's own sight, so a closed
 * door hides the hero), or a walking path to the hero is MONSTER_HEARS_STEPS or
 * fewer (it hears you). Each creature asks for itself.
 */
export function creatureNotices(p: PlayState, c: Creature): boolean {
  if (!c.hostile || c.awake || heroDown(p)) return false;
  if (tileDistance(c.at, p.heroAt) <= MONSTER_WAKE_TILES && canSeeEachOther(sightKit(p).opaque, c.at, p.heroAt)) return true;
  const path = pathToward(p, sceneTiles(p), c.at, p.heroAt);
  return path !== null && path.steps <= MONSTER_HEARS_STEPS;
}

/** The sleeping hostiles that notice the hero now. */
export const noticers = (p: PlayState): Creature[] => p.creatures.filter((c) => creatureNotices(p, c));
