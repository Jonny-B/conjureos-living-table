/**
 * The table's scene state: what a scene IS, before any rule acts on it.
 *
 * PlayState (the hero, the creatures, the door, the fog's memory, the DM's
 * leavings, the adventure's story record), the creature and body shapes, the
 * scene kit per template (the wall, the door, the container, the two monsters),
 * the test room's squares and limits, and the constructors: basePlay, newPlay,
 * addCreature. Moved out of the asset bench's registry as it was; nothing here
 * reaches the page.
 *
 * What did NOT move here is the bench's module-level singletons: the live
 * `play`, the start-screen flag, the Room setting and the session log. Those
 * belong to one window (mountTable's session), so the helpers that used them
 * take them as arguments: newPlay and basePlay take the room (default "one"),
 * sandboxFromAddress takes the host's env, and the session log is an object
 * from createSessionLog() that carryJournals writes to.
 *
 * The pictures' ids and walkability are NOT constants here: they come from the
 * bound catalog (catalog.ts), because the bench and the game draw different art.
 */
import { ARCHETYPE_IDS, CONTAINER_PROP_ASSET_IDS, TEMPLATE_OF_ARCHETYPE, bodySpriteId, type ArchetypeId } from "../characters/equipmentTypes";
import { createCharacter, type CharacterSheet } from "../characters/creation";
import { PLAYABLE_ARCHETYPE_IDS, type TemplateGenre } from "../characters/templates";
import type { ItemFlags } from "../inventory/itemActions";
import { carriedBy, type BodyState, type CarriedItem } from "../rules/corpses";
import { statblockFor } from "../session/combat";
import { sentenceCase } from "../menu/labels";
import type { CombatRound } from "../menu/combatRound";
import type { DmExchange, RollRecord } from "../session/adventureExport";
import type { AdventureProgress } from "../adventures/types";
import type { AdventureStepResult } from "../adventures/progress";
import { emptyExplored } from "../world/visibility";
import type { TileId } from "../world/cell";
import type { DmOption } from "./dmCore";
import type { RoomChoice, TableEnv } from "./host";
import { newActor, type Actor } from "./ui/cast";
import { noteSight } from "./sight";

export type { RoomChoice };

export interface XY {
  x: number;
  y: number;
}

export type Dir = "up" | "down" | "left" | "right";
export const DIR_STEP: Record<Dir, XY> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export interface SceneKit {
  wall: TileId;
  doorClosed: TileId;
  doorOpen: TileId;
  doorLabel: string;
  container: TileId;
  /** The opened sprite, when the template has one. The sci-fi crate has none, so it keeps its look and only the log says it was searched. */
  containerOpened: TileId | null;
  containerLabel: string;
  /** The creature the scene starts with. */
  monster: TileId;
  /** The second kind of creature, for the Room setting "two creatures" (it proves two hostiles with their own statblocks work). */
  second: TileId;
}

export const SCENE_KIT: Record<TemplateGenre, SceneKit> = {
  fantasy: {
    wall: "wall_stone",
    doorClosed: "door_closed",
    doorOpen: "door_open",
    doorLabel: "the door",
    container: CONTAINER_PROP_ASSET_IDS.fantasy[0]!,
    containerOpened: "chest_open",
    containerLabel: "the chest",
    monster: "token_goblin",
    second: "token_skeleton",
  },
  scifi: {
    wall: "wall_bulkhead",
    doorClosed: "door_airlock_closed",
    doorOpen: "door_airlock_open",
    doorLabel: "the airlock",
    container: CONTAINER_PROP_ASSET_IDS.scifi[0]!,
    containerOpened: null,
    containerLabel: "the crate",
    monster: "token_raider",
    second: "token_drone",
  },
};

// An outer wall and a dividing wall at DIVIDER_X with one door in it. The
// hero starts in the west room; the container and the monster are east.
export const DIVIDER_X = 11;
export const DOOR_AT: XY = { x: DIVIDER_X, y: 7 };
export const CONTAINER_AT: XY = { x: 16, y: 3 };
export const MONSTER_START: XY = { x: 16, y: 10 };
/** Where the second creature of the "two creatures" room starts (the east room, asleep like the first). */
export const SECOND_START: XY = { x: 15, y: 5 };
export const HERO_START: XY = { x: 4, y: 7 };
/** A hostile wakes when it and the hero see each other within this many squares... */
export const MONSTER_WAKE_TILES = 6;
/** ...or when a walking path to the hero is this short (it hears you, door or no door). */
export const MONSTER_HEARS_STEPS = 2;
/** The refusal for a click on a square the hero has never seen. */
export const NOT_SEEN = "You have not seen that far.";
/** Where a drain grate sits in each room: walkable floor the DM can look into later. */
export const DRAIN_AT: readonly XY[] = [
  { x: 7, y: 10 },
  { x: 14, y: 12 },
];
export const DRAIN_TILE: Record<TemplateGenre, TileId> = { fantasy: "floor_stone_drain", scifi: "floor_grating" };
export const HERO_ID = "hero";
/** The first creature of a scene is "monster"; the rest are "monster-2", "monster-3" and so on (see addCreature). */
export const MONSTER_ID = "monster";
/** The most creatures the room holds alive at once (the DM's spawn is refused past it). */
export const CREATURE_CAP = 8;
/** The Log tab's history: every roll, find and line of narration, newest last. */
export const LOG_KEEP = 200;
/** The DM's own limits on what it may leave behind in the scene. */
export const DM_MEMORY_KEEP = 12;
export const DM_RECENT_KEEP = 16;
export const DM_RECENT_SHOWN = 8;
export const DM_POTION_CAP = 2;
export const DM_PROPS_MAX = 8;
export const DM_INVENTORY_MAX = 24;
/** The debug journals' limits (the export carries them; the saves do not). */
export const DM_JOURNAL_KEEP = 100;
export const ROLL_JOURNAL_KEEP = 500;
/** The lock DC of a door the DM locked without naming one. */
export const DEFAULT_LOCK_DC = 15;
/** Lines of log that scrolled off the Log tab or belong to an earlier scene, kept for the debug export only. */
export const SESSION_LOG_KEEP = 4000;
// Indoor floors for a walled room; the Floor control still offers the rest.
export const ROOM_FLOOR: Record<TemplateGenre, TileId> = { fantasy: "floor_stone", scifi: "floor_deckplate" };
export const DOWN_NOTE = "You are down. Load the last save, or press Reset scene.";

/** The healing potions the hero walks in with (the table's own stock, so a heal has a source). */
export const HERO_POTIONS = 2;

/** The heroes a player can start as: the playable fantasy archetypes in library order (the Healer is out of play and sci-fi is paused, characters/templates.ts). */
export const PLAYABLE_HEROES: ArchetypeId[] = ARCHETYPE_IDS.filter((id) => TEMPLATE_OF_ARCHETYPE[id] === "fantasy" && PLAYABLE_ARCHETYPE_IDS.includes(id));

/** What each archetype is called in a name and a card. */
export const ARCHETYPE_LABEL: Record<ArchetypeId, string> = {
  knight: "Knight",
  shadow: "Rogue",
  healer: "Healer",
  "fireball-person": "Wizard",
  trooper: "Trooper",
  infiltrator: "Infiltrator",
  medic: "Medic",
  psion: "Psion",
};

export interface LogLine {
  text: string;
  /** good: went your way. bad: went against you. plain: neither. dm: the DM's own narration (the Log tab sets it apart). */
  tone: "good" | "bad" | "plain" | "dm";
  /** A short "+ a tarnished silver ring" the Pack button's notice shows once, when the line is first flushed (see flushLog). The log keeps the full line. */
  notice?: string;
}

/** Which creatures the sandbox room starts with (the Room setting): one goblin, or a goblin and a skeleton. (The type is host.ts's.) */
export const ROOM_CHOICES: readonly RoomChoice[] = ["one", "two"];

/**
 * One creature on the board: hostile or not, awake or asleep, with its own statblock (by `token`), hit points, what it carries and
 * what it is doing in the picture. Everything the rules decide about a creature reads from here; nothing is a one-off "the monster".
 */
export interface Creature {
  /** "monster" for the first creature of a scene, then "monster-2", "monster-3": the id the engine, the DM and the log use. */
  id: string;
  /** The token asset id; the statblock, the dice look, the bestiary entry and the drawing all come from it. */
  token: TileId;
  /** Which of its kind this is (the first goblin is 1, a second is 2): it is part of the name only while the scene has more than one of the kind. */
  n: number;
  at: XY;
  hp: number;
  /** Awake creatures are in the fight (or start one). A sleeping one waits until it notices the hero, is woken, or is struck. */
  awake: boolean;
  /** Whether the hero has ever had it in sight. Until then the readout calls it "???". */
  seen: boolean;
  /** Knocked down: the hero's attacks next to it have advantage, and it spends half its movement to stand at the start of its turn. */
  prone: boolean;
  /** What it is still carrying while it lives (a pickpocket takes from here). When it falls, this is what its body holds. */
  carried: CarriedItem[];
  /** A hostile fights the hero. A creature that is not (a villager, a shopkeeper) is never in the initiative order and is never attacked by a click. */
  hostile: boolean;
  /** Set on a creature that is somebody (a role the DM and the readout name: "the innkeeper"; in an adventure, also their own name). Picture and words only; the rules read `hostile`. */
  npc?: { role: string; name?: string };
  /** Set only while an adventure runs: which creature of the adventure this is. `instance` is the id the story's kills use ("cellar_rats_2"), `npc` the adventure NPC entry it stands for. */
  adv?: { spawn: string; instance: string; npc?: string };
  /** What it is doing in the animated picture (cast.ts). Picture only: the rules never read it, and a save does not keep it. */
  actor: Actor;
}

/** A creature as a save keeps it: everything but the picture. */
export type SavedCreature = Omit<Creature, "actor">;

/** A body the hero's kills leave: the engine's BodyState plus which creature it was, so the picture draws the right figure lying there. */
export type PlayBody = BodyState & { token: TileId };

export interface PlayState {
  template: TemplateGenre;
  archetypeId: ArchetypeId;
  floorId: TileId;
  hero: CharacterSheet;
  /** The hero as it began (quick-picked or made in the creator): what Reset scene starts again from, hit points full. */
  start: CharacterSheet;
  /** What the DM said each thing it gave is (its `desc`), keyed by the item's name; the pack's hover tip reads it. Taking the item removes it. */
  itemNotes: Record<string, string>;
  heroAt: XY;
  /** Which creatures the scene began with (the Room setting); Reset scene starts them all again. */
  room: RoomChoice;
  /** Every creature alive on the board, in the order they were made. A slain one leaves a body and is removed. */
  creatures: Creature[];
  /** How many creatures of each token have been made in this scene (it numbers a kind that has more than one). */
  spawned: Record<string, number>;
  /** The next creature's number (see Creature.id). */
  creatureSeq: number;
  doorOpen: boolean;
  searched: boolean;
  log: LogLine[];
  /** Why the last press did nothing, in words. Cleared by the next press that does something. */
  note: string | null;
  /** The fight, from the game's own combatRound.ts; null while exploring. */
  round: CombatRound | null;
  /** Healing potions left (the bench's own stock). */
  potions: number;
  /** Where the last creature fell. Bodies are the full record (each lies where it fell); this is only where the last "DOWN" floats from. */
  fallenAt: XY | null;
  /** What the hero is doing in the animated picture (cast.ts); each creature's own is on it. Picture only: the rules never read this. */
  heroActor: Actor;
  /** What the hero has seen so far, one byte per square (1 seen), row-major: the fog of war's memory (world/visibility.ts). */
  explored: Uint8Array;
  /** Bumps whenever `explored` gains a square, so a drawing can tell it changed without comparing it. */
  exploredRev: number;
  /** Props the DM has put in the room, with a label and an optional secret only the DM knows. */
  extraProps: DmProp[];
  /** The DM's secrets on the room's own features (a drain grate, the door, the chest), keyed by feature id. The drains start with none. */
  propSecrets: Record<string, string>;
  /** Terrain the DM changed: a collapsed wall, a flooded corner. Later entries win. */
  tileOverrides: { x: number; y: number; tile: TileId }[];
  /** A locked door refuses Use ("Locked.") until the DM unlocks it. */
  doorLocked: boolean;
  /** Facts the DM asked to remember (at most DM_MEMORY_KEEP). */
  dmMemory: string[];
  /** The last exchanges with the DM, oldest first, refusals included (so it stays honest). */
  dmRecent: { who: "player" | "dm"; text: string }[];
  /** The DM's suggested next moves from its last answer (at most 4); empty when there are none. Never saved: it clears when the hero moves, acts or the next answer comes. */
  options: DmOption[];
  /** Healing potions the DM has handed out this scene (capped at DM_POTION_CAP). */
  potionsGranted: number;
  /** Bumps whenever the DM changes the tiles or props, so sight and the picture know to rebuild. */
  worldRev: number;
  /** The next DM prop number. */
  propSeq: number;
  /** What the hero has slain, where each lies (rules/corpses.ts). A body keeps what its creature carried until the hero takes it; the picture draws each one lying down. */
  bodies: PlayBody[];
  /** Things the hero dropped, one pile per square, in the order they were put down. Picking one up takes it from here. */
  piles: { at: XY; items: string[] }[];
  /** What the DM said about each thing it handed over, keyed by the item's name: a quest item cannot be dropped or destroyed, a usable one has a Use button that sends its words to the DM. */
  itemFlags: Record<string, ItemFlags>;
  /** The hero is hidden (a successful Hide, or a Sneak step it did not notice): a hostile does not wake by sight, and the hero's next attack has advantage and ends it. */
  heroHidden: boolean;
  /** Sneaking mode: every step that would let a hostile notice the hero rolls Stealth against its passive Perception instead. */
  sneaking: boolean;
  /** The DC of the door's lock when it is locked (the DM sets none, so it is 15). */
  doorLockDc: number;
  /** Every exchange with the DM, oldest first, at most DM_JOURNAL_KEEP: the full input, raw answers, errors, what was applied and refused. Kept out of saves; it goes in the debug export. */
  dmJournal: DmExchange[];
  /** Every roll thrown in the tray, oldest first, at most ROLL_JOURNAL_KEEP. Kept out of saves; it goes in the debug export. */
  rollJournal: RollRecord[];
  /** The adventure being played (its id: the text is never in a save, the adventure is read again from the bench), or null in a test room. */
  adventureId: string | null;
  /** Where the story stands (progress.ts): the scene, the flags, the kills, the items held. The place the hero is in is `progress.locationId`. Null in a test room. */
  progress: AdventureProgress | null;
  /** The places of the adventure the hero has left, as they were left: what was explored, who is there, who lies dead. The place the hero is in lives in the fields above. */
  places: Record<string, PlaceMemory>;
  /** The features the hero has found the secret of, as "<location id>/<feature id>". */
  featuresFound: string[];
  /** Creatures (by instance id) the DM sent away: they do not come back when the place is read again. */
  goneSpawns: string[];
  /** The last beats of the story, oldest first: the Journal tab's "recently". */
  storyRecent: string[];
  /** What the story did since the board last showed it (beats, objectives, a new scene, an ending). Never saved: the panel plays it out and clears it. */
  adventurePending: AdventureStepResult[];
  /** A number no other board has ever had: it changes whenever the board is another place, so the picture, the sight and the tile caches know to rebuild. Never saved. */
  boardEpoch: number;
}

/** A place of an adventure the hero has left, as it was left (JSON, so a save keeps it). */
export interface PlaceMemory {
  explored: string;
  creatures: SavedCreature[];
  bodies: PlayBody[];
  piles: { at: XY; items: string[] }[];
  extraProps: DmProp[];
  tileOverrides: { x: number; y: number; tile: TileId }[];
  propSecrets: Record<string, string>;
}

/** How many of the story's last beats the Journal tab shows. */
export const STORY_RECENT_KEEP = 6;
let boardEpochSeq = 0;
/** A number no other board has ever had (see PlayState.boardEpoch). Counts up for the life of the page, across every window. */
export const nextBoardEpoch = (): number => ++boardEpochSeq;

export interface DmProp {
  id: string;
  assetId: TileId;
  x: number;
  y: number;
  label: string;
  secret?: string;
}

export function freshHero(archetypeId: ArchetypeId): CharacterSheet {
  return createCharacter({ archetypeId, name: ARCHETYPE_LABEL[archetypeId], appearanceAssetId: bodySpriteId(archetypeId) });
}

/**
 * A new scene. `start` is the hero to begin as (a character made in the creator);
 * without it, the archetype's ready-made one. `keepGearOf` carries worn gear and the
 * pack over (Reset scene), while hit points, the loot ledger, the door, the
 * container and the monster all start again. The picture and the animated figure
 * follow the archetype either way.
 */
export function basePlay(template: TemplateGenre, archetypeId: ArchetypeId, floorId: TileId, keepGearOf?: CharacterSheet, start?: CharacterSheet, room: RoomChoice = "one"): PlayState {
  const fresh = start ?? freshHero(archetypeId);
  const hero = keepGearOf ? { ...fresh, equipment: keepGearOf.equipment, bag: keepGearOf.bag } : fresh;
  const p: PlayState = {
    template,
    archetypeId,
    floorId,
    hero,
    start: fresh,
    itemNotes: {},
    heroAt: { ...HERO_START },
    room,
    creatures: [],
    spawned: {},
    creatureSeq: 1,
    doorOpen: false,
    searched: false,
    log: [],
    note: null,
    round: null,
    potions: HERO_POTIONS,
    fallenAt: null,
    heroActor: newActor("down"),
    explored: emptyExplored(),
    exploredRev: 0,
    extraProps: [],
    propSecrets: {},
    tileOverrides: [],
    doorLocked: false,
    dmMemory: [],
    dmRecent: [],
    options: [],
    potionsGranted: 0,
    worldRev: 0,
    propSeq: 1,
    bodies: [],
    piles: [],
    itemFlags: {},
    heroHidden: false,
    sneaking: false,
    doorLockDc: DEFAULT_LOCK_DC,
    dmJournal: [],
    rollJournal: [],
    adventureId: null,
    progress: null,
    places: {},
    featuresFound: [],
    goneSpawns: [],
    storyRecent: [],
    adventurePending: [],
    boardEpoch: nextBoardEpoch(),
  };
  return p;
}

export function newPlay(template: TemplateGenre, archetypeId: ArchetypeId, floorId: TileId, keepGearOf?: CharacterSheet, start?: CharacterSheet, room: RoomChoice = "one"): PlayState {
  const p = basePlay(template, archetypeId, floorId, keepGearOf, start, room);
  // The scene's creatures, asleep in the east room.
  const kit = SCENE_KIT[template];
  addCreature(p, kit.monster, MONSTER_START);
  if (room === "two") addCreature(p, kit.second, SECOND_START);
  // The hero opens its eyes: the room it starts in is already seen.
  noteSight(p);
  return p;
}

/** The Room setting's words: "One goblin", "Goblin and skeleton". */
export function roomLabel(template: TemplateGenre, room: RoomChoice): string {
  const kit = SCENE_KIT[template];
  const first = statblockFor(kit.monster).name;
  return room === "one" ? `One ${first.toLowerCase()}` : `${first} and ${statblockFor(kit.second).name.toLowerCase()}`;
}

/**
 * Put a creature on the board (asleep, unseen, hostile, standing, carrying what its kind carries), and number it: the first of a scene is
 * "monster", the rest "monster-2", "monster-3". `over` changes any of it (an NPC is not hostile and is awake).
 */
export function addCreature(p: PlayState, token: TileId, at: XY, over: Partial<Pick<Creature, "awake" | "hostile" | "npc" | "hp" | "adv">> & { id?: string } = {}): Creature {
  const id = over.id ?? (p.creatureSeq === 1 ? MONSTER_ID : `${MONSTER_ID}-${p.creatureSeq}`);
  p.creatureSeq++;
  const n = (p.spawned[token] ?? 0) + 1;
  p.spawned[token] = n;
  const c: Creature = {
    id,
    token,
    n,
    at: { ...at },
    hp: over.hp ?? statblockFor(token).maxHp,
    awake: over.awake ?? false,
    seen: false,
    prone: false,
    carried: carriedBy(token),
    hostile: over.hostile ?? true,
    ...(over.npc ? { npc: over.npc } : {}),
    ...(over.adv ? { adv: over.adv } : {}),
    actor: newActor("left"),
  };
  p.creatures.push(c);
  return c;
}

/**
 * The host's own way past the start screen, for headless checks and for anyone who wants the test room at once: with #sandbox in the address
 * the one-goblin room starts, with #sandbox-two the goblin and skeleton room. Without it (or when the host does not allow sandbox rooms,
 * as the game does not) the window opens on its start screen.
 */
export function sandboxFromAddress(env: Pick<TableEnv, "address" | "sandboxRooms">): RoomChoice | null {
  if (!env.sandboxRooms) return null;
  try {
    const hash = String(env.address() ?? "").toLowerCase();
    if (hash === "#sandbox" || hash === "#sandbox-one") return "one";
    if (hash === "#sandbox-two") return "two";
  } catch {
    // No address to read.
  }
  return null;
}

/** Lines that scrolled off the Log tab, or belong to a scene that has since been replaced: the debug export keeps them, the game does not. */
export interface SessionLog {
  /** Oldest first, at most SESSION_LOG_KEEP. */
  readonly lines: LogLine[];
  archive(lines: readonly LogLine[]): void;
}

/** One window's session log (the bench kept one for the whole page; a window owns its own). */
export function createSessionLog(): SessionLog {
  const lines: LogLine[] = [];
  return {
    lines,
    archive(add) {
      lines.push(...add.map((l) => ({ text: l.text, tone: l.tone })));
      if (lines.length > SESSION_LOG_KEEP) lines.splice(0, lines.length - SESSION_LOG_KEEP);
    },
  };
}

/**
 * A new PlayState takes the place of `from` (Reset scene, a new hero, a loaded save): the debug journals ride over to it, so the
 * export holds the whole adventure and not only the scene since the last reset, and the old scene's log is kept with a marker.
 */
export function carryJournals(from: PlayState | null, to: PlayState, why: string, log: SessionLog): void {
  if (!from || from === to) return;
  to.dmJournal = from.dmJournal;
  to.rollJournal = from.rollJournal;
  log.archive([...from.log, { text: `--- ${why} ---`, tone: "plain" }]);
}

// ---- small shared helpers -------------------------------------------------------------

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isStr = (v: unknown): v is string => typeof v === "string";

export const same = (a: XY, b: XY): boolean => a.x === b.x && a.y === b.y;

export function sentence(text: string): string {
  const s = sentenceCase(text.trim());
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

// ---- creatures: finding them and naming them -------------------------------------

export const creatureById = (p: PlayState, id: string): Creature | undefined => p.creatures.find((c) => c.id === id);
export const creatureAt = (p: PlayState, at: XY): Creature | undefined => p.creatures.find((c) => same(c.at, at));
export const hostilesOf = (p: PlayState): Creature[] => p.creatures.filter((c) => c.hostile);
export const awakeHostiles = (p: PlayState): Creature[] => p.creatures.filter((c) => c.hostile && c.awake);

/** A creature's name: its statblock's ("Goblin"), the role of one that is somebody, and a number after it ("Rat 2") while the scene has more than one of its kind. */
export function creatureName(p: PlayState, c: Creature): string {
  if (c.npc?.name) return c.npc.name;
  const base = c.npc ? sentenceCase(c.npc.role) : statblockFor(c.token).name;
  return !c.npc && (p.spawned[c.token] ?? 0) > 1 ? `${base} ${c.n}` : base;
}

/** "the goblin", "the rat 2", "the innkeeper": a creature in a sentence. */
export const creatureLabel = (p: PlayState, c: Creature): string => (c.npc?.name ? c.npc.name : `the ${creatureName(p, c).toLowerCase()}`);

/** The plural of a kind's name, for a group ("Rats"). */
export const pluralName = (name: string): string => (/(s|x|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`);

export function heroDown(p: PlayState): boolean {
  return p.hero.downed || p.hero.stable || p.hero.dead;
}
