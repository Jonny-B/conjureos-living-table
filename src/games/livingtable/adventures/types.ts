/**
 * The typed model of a pre-written adventure.
 *
 * An adventure is DATA the owner authors (one Markdown file per adventure, a
 * strict template with ASCII-grid maps) and the engine parses into this shape.
 * The game runs FROM it: it is gospel. The AI dungeon master improvises
 * texture, dialogue and small details, never facts, and the story moves only
 * along the transitions an adventure defines (progress.ts checks every step
 * the DM proposes).
 *
 * This file is types and a few tiny pure helpers only. Nothing here imports
 * the renderer, the DM, or anything that touches the network.
 */
import type { Chassis } from "../characters/templates";

export type { Chassis };

/** Every mechanical class chassis a hook or a starting kit can be keyed by. */
export const ADVENTURE_CHASSIS: readonly Chassis[] = Object.freeze(["fighter", "rogue", "cleric", "wizard"] as Chassis[]);

/** The chassis the launch archetypes actually use (knight, shadow, fireball-person). A hook or kit for each, or a `default`, is expected. */
export const PLAYABLE_CHASSIS: readonly Chassis[] = Object.freeze(["fighter", "rogue", "wizard"] as Chassis[]);

/** What the adventure gives a hero at the start, per class. */
export interface StartingKit {
  /** How the weapon is described, e.g. "a plain dagger". Words only: the weapon's numbers come from the class, never from this string. */
  weaponNote?: string;
  /** "none": the hero wears no armor (unarmored AC is SRD 5.1: 10 + DEX). "class": the class's normal armor. */
  armor: "none" | "class";
  /** Extra carried items, by item id or plain name. */
  items: string[];
  /** Healing potions to start with. A plain count; 0 means none. */
  potions: number;
}

/** One character in a map grid: its floor tile plus optionally what stands on it. */
export interface LegendEntry {
  /** The floor tile asset id painted on this square. */
  tile: string;
  /** A prop asset id standing on the square. */
  prop?: string;
  /** The id of one of the location's `features` this square is. */
  feature?: string;
  /** The id of one of the location's `spawns` that stands here. */
  spawn?: string;
  /** The id of one of the location's `exits` that is here. */
  exit?: string;
  /** True on the one square the hero starts on (or arrives on when an exit says `start`). */
  start?: boolean;
}

/** A thing in a location worth looking at, searching, or taking from. */
export interface AdventureFeature {
  id: string;
  name: string;
  /** What anyone sees. Safe to show the player. */
  description: string;
  /** What a successful search turns up. DM-only until found. */
  secret?: string;
  /** The Perception/Investigation DC to find the secret (SRD scale, 1 to 30). */
  searchDc?: number;
  /** Items handed over when the secret is found, by item id or plain name. */
  gives?: string[];
  once?: boolean;
}

export interface AdventureSpawn {
  id: string;
  /** A bestiary id ("giant-rat") or a token asset id ("token_goblin"). */
  creature: string;
  /** How many. With more than one, the first goes on the marked square and the rest spread to free neighbours. Default 1. */
  count?: number;
  hostile: boolean;
  /** True when it starts the scene awake and aware; false when asleep or unaware. */
  awake: boolean;
  /** Links the creature to an NPC entry (personality, secrets). */
  npcId?: string;
  /** When set, the creature is only there while this holds. */
  appearsWhen?: Condition;
}

export interface AdventureExit {
  id: string;
  /** The location this exit leads to. */
  to: string;
  /** An exit id in the target location, or "start" for the target's start square. */
  arriveAt: string;
  label: string;
  /** When set, the way is shut until this holds. */
  requires?: Condition;
  /** What the party finds while it is shut. */
  lockedText?: string;
}

export interface AdventureLocation {
  id: string;
  name: string;
  /** Read aloud when the party first arrives. */
  readAloud: string;
  /** DM-only notes about the place. */
  dmNotes?: string;
  map: {
    /** Exactly 15 rows (CELL_HEIGHT) of exactly 20 characters (CELL_WIDTH). */
    rows: string[];
    legend: Record<string, LegendEntry>;
  };
  features: AdventureFeature[];
  spawns: AdventureSpawn[];
  exits: AdventureExit[];
}

export interface AdventureNpc {
  id: string;
  name: string;
  /** The token asset id that stands for them on the map. */
  token: string;
  role: string;
  personality: string;
  wants?: string;
  /** What they will tell the party when asked. */
  knows: string[];
  /** What they will not volunteer. DM-only. */
  secrets?: string[];
  voice?: string;
  /** The location they are normally found in. */
  location?: string;
}

export interface AdventureItem {
  id: string;
  name: string;
  description: string;
  /** A story item the adventure turns on. */
  quest?: boolean;
  usable?: boolean;
  /** What is said when it is used. Only meaningful with `usable`. */
  useSay?: string;
}

/** A thing the story checks. Reads the progress record; never rolls anything. */
export type Condition =
  | { flag: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  /** A spawn id (all of its creatures dead), one creature id ("rat_2"), or "all:<spawn id prefix>" (every creature of every spawn whose id starts with it). */
  | { killed: string }
  /** A location id the party has entered. */
  | { entered: string }
  /** An npc id the party has spoken with. */
  | { talkedTo: string }
  /** An item id the party holds now. */
  | { has: string }
  /** An objective id that is done. */
  | { objective: string }
  /**
   * It is this day of the adventure or later. The first day is day 1, and a
   * day passes each time the hero sleeps (a long rest). Days only move
   * forward, so "or later" is the only reading there is.
   */
  | { day: number }
  | { always: true };

export interface AdventureObjective {
  id: string;
  text: string;
  /** Hidden objectives are known to the DM but not shown to the player. */
  hidden?: boolean;
  doneWhen: Condition;
}

export interface AdventureBeat {
  id: string;
  when: Condition;
  /** Told to the player when the beat fires. */
  narrate?: string;
  setFlags?: string[];
  /** Items handed over, by item id or plain name. */
  give?: string[];
  /** Spawn ids that appear when this fires. */
  spawn?: string[];
  /** Beats fire once by default. `once: false` fires on every event while the condition holds. */
  once?: boolean;
}

export interface AdventureScene {
  id: string;
  title: string;
  location?: string;
  /** Read aloud on entering the scene. */
  opening?: string;
  objectives: AdventureObjective[];
  beats: AdventureBeat[];
  /** The only ways out of this scene. The first whose condition holds is taken. */
  next: { scene: string; when: Condition }[];
  ending?: { text: string; outcome: "victory" | "defeat" | "continue" };
}

/**
 * What happens in the world whatever scene the story is in: the villain's
 * clock, a rumour that reaches the village, the night the dead walk. Its beats
 * are checked in every scene, after the scene's own; its ways out are checked
 * before the scene's own, so a clock that has run out ends the story wherever
 * the party is standing.
 */
export interface AdventureWorld {
  beats: AdventureBeat[];
  next: { scene: string; when: Condition }[];
}

export interface Adventure {
  id: string;
  title: string;
  /** Bumped when the content changes in a way a saved game cares about. A positive integer. */
  version: number;
  author: "owner" | "ai";
  summary: string;
  levelRange?: [number, number];
  tone?: string;
  /** Gospel facts the DM must never contradict. */
  truths: string[];
  dmMust: string[];
  dmNever: string[];
  /** How the story addresses each class ("known for brawn"). */
  hooks: Partial<Record<Chassis | "default", string>>;
  startingKit: Partial<Record<Chassis | "default", StartingKit>>;
  locations: AdventureLocation[];
  npcs: AdventureNpc[];
  items: AdventureItem[];
  scenes: AdventureScene[];
  /** Beats and ways out that belong to no one scene. Absent in an adventure that has none. */
  world?: AdventureWorld;
  start: { sceneId: string; locationId: string; at: { x: number; y: number } };
}

/** Where a game stands in an adventure. A plain record, safe to save as JSON. */
export interface AdventureProgress {
  adventureId: string;
  version: number;
  sceneId: string;
  locationId: string;
  flags: Record<string, true>;
  objectivesDone: string[];
  beatsFired: string[];
  /** Creature ids ("rat_2", or "goblin" for a single one) that are dead. */
  killed: string[];
  entered: string[];
  talkedTo: string[];
  /** Item ids the party holds. */
  has: string[];
  /** Spawn ids a beat has brought in. A spawn named by some beat is absent until then. */
  spawned: string[];
  /** The adventure's day, from 1; one more each time the hero sleeps. Absent in a game saved before days existed, which reads as day 1. */
  day?: number;
  ended?: "victory" | "defeat";
}

/** What the DM may PROPOSE. The engine accepts one only when the adventure allows it right now. */
export type DmProgressStep =
  | { kind: "flag"; flag: string }
  | { kind: "objective"; id: string }
  | { kind: "scene"; id: string };

export type AdventureEvent =
  | { type: "enter"; location: string }
  | { type: "kill"; spawn: string }
  | { type: "talk"; npc: string }
  | { type: "gain"; item: string }
  | { type: "lose"; item: string }
  | { type: "flag"; flag: string }
  | { type: "dm"; step: DmProgressStep }
  /** The hero slept the night (a long rest): a day passes. */
  | { type: "rest" };

/** One problem found while checking an adventure. `path` points at it, `message` says it in plain words. */
export interface AdventureIssue {
  path: string;
  message: string;
}

/** The asset ids an adventure may name. Optional extras make the walkability checks exact. */
export interface AdventureAssets {
  tiles: string[];
  props: string[];
  tokens: string[];
  /** Tile ids that can be walked on. When absent, a name-based guess is used (water, walls, canopy and cliff faces are not walkable). */
  walkableTiles?: string[];
  /** Prop ids that block a square (a closed door, a chest). When absent, no prop is assumed to block. */
  blockingProps?: string[];
}

/** The id of one creature of a spawn: the spawn id for a single one, "<id>_<n>" (n from 1) for a group. */
export function spawnInstanceIds(spawn: { id: string; count?: number }): string[] {
  const n = Math.max(1, Math.floor(spawn.count ?? 1));
  if (n === 1) return [spawn.id];
  return Array.from({ length: n }, (_, i) => `${spawn.id}_${i + 1}`);
}

/** Every spawn in the adventure, in file order, with the location it stands in. */
export function allSpawns(a: Adventure): { spawn: AdventureSpawn; locationId: string }[] {
  const out: { spawn: AdventureSpawn; locationId: string }[] = [];
  for (const loc of a.locations) for (const spawn of loc.spawns) out.push({ spawn, locationId: loc.id });
  return out;
}

/** The adventure's world beats and ways out, empty when it has none. */
export function worldOf(a: Adventure): AdventureWorld {
  return { beats: a.world?.beats ?? [], next: a.world?.next ?? [] };
}

/** Every beat in the adventure, the scenes' and the world's, in file order. Anything that asks "does some beat do X" asks this. */
export function allBeats(a: Adventure): AdventureBeat[] {
  return [...a.scenes.flatMap((s) => s.beats), ...worldOf(a).beats];
}

/** What day it is in this game of the adventure. */
export function dayOf(p: AdventureProgress): number {
  return p.day ?? 1;
}

/** The scene with this id, or undefined. */
export function sceneOf(a: Adventure, id: string): AdventureScene | undefined {
  return a.scenes.find((s) => s.id === id);
}

/** The location with this id, or undefined. */
export function locationOf(a: Adventure, id: string): AdventureLocation | undefined {
  return a.locations.find((l) => l.id === id);
}

/** An item by id, or failing that by name (case-insensitive). */
export function itemOf(a: Adventure, idOrName: string): AdventureItem | undefined {
  const lower = idOrName.trim().toLowerCase();
  return a.items.find((i) => i.id === idOrName) ?? a.items.find((i) => i.name.trim().toLowerCase() === lower);
}

/** The hook line for this class, falling back to the default hook. */
export function heroHook(a: Adventure, chassis?: Chassis): string | undefined {
  return (chassis ? a.hooks[chassis] : undefined) ?? a.hooks.default;
}

/** The starting kit for this class, falling back to the default kit. */
export function startingKitFor(a: Adventure, chassis?: Chassis): StartingKit | undefined {
  return (chassis ? a.startingKit[chassis] : undefined) ?? a.startingKit.default;
}

/** Whether a saved progress record was written against this exact version of this adventure. */
export function progressMatches(a: Adventure, p: AdventureProgress): boolean {
  return p.adventureId === a.id && p.version === a.version;
}
