/**
 * Save points for the table: what a snapshot of a scene holds, how it is checked
 * and put back, and the book of saves a window keeps.
 *
 * session/savePoints.ts decides what to keep and how a save reads back; this is
 * what the table puts in one. A snapshot is the scene minus what only the picture
 * needs (the two animated figures, the fight's pending note, the DM's suggested
 * moves) and with the explored squares written as text. Moved out of the asset
 * bench's registry as it was, with one change: the saves are no longer read from
 * and written to localStorage here. They go through the host's `storage.saves`
 * under one scope (SAVES_SCOPE), so the bench and the game each keep them where
 * they like, and the book of saves belongs to one window (createSaveBook) instead
 * of the page.
 *
 * isSnapshot checks the pictures a save names against the bound catalog
 * (catalog.ts) and the adventure it names against the bound adventures
 * (adventureCatalog.ts), so both must be bound before a save is read.
 */
import { refreshRetiredNames } from "../characters/creation";
import { type ArchetypeId } from "../characters/equipmentTypes";
import type { CombatRound } from "../menu/combatRound";
import { bodyFor, carriedBy, type BodyState, type CarriedItem } from "../rules/corpses";
import { addSave, latestSave, makeSavePoint, parseSaves, serializeSaves, type SaveKind, type SavePoint } from "../session/savePoints";
import { locationOf, progressMatches, sceneOf, type AdventureProgress } from "../adventures/types";
import type { TileId } from "../world/cell";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import { adventureById } from "./adventureCatalog";
import { walkableById } from "./catalog";
import type { RoomChoice, TableStorage } from "./host";
import {
  DEFAULT_LOCK_DC,
  HERO_ID,
  MONSTER_ID,
  PLAYABLE_HEROES,
  ROOM_CHOICES,
  SCENE_KIT,
  isNum,
  isRec,
  isStr,
  nextBoardEpoch,
  type Creature,
  type PlaceMemory,
  type PlayBody,
  type PlayState,
  type SavedCreature,
  type XY,
} from "./state";
import { noteSight } from "./sight";
import { newActor, playClips } from "./ui/cast";

// The bench kept these helpers in this stretch of its registry, so they are reachable from here as well as from state.ts.
export { creatureAt, creatureById, creatureLabel, creatureName, awakeHostiles, hostilesOf, heroDown, isNum, isRec, isStr, pluralName, same, sentence } from "./state";

/** 2 writes `creatures` (every creature, with its own seen, prone and carried). 1 is a save from before: one `monster` and the fields that went with it. */
export const SNAPSHOT_VERSION = 2;
export const LEGACY_SNAPSHOT_VERSION = 1;
/** The scope the saves are kept under in the host's `storage.saves` (the host maps it to its own key). */
export const SAVES_SCOPE = "saves";

export type SnapshotBase = Omit<PlayState, "heroActor" | "creatures" | "room" | "spawned" | "creatureSeq" | "bodies" | "explored" | "exploredRev" | "round" | "note" | "options" | "dmJournal" | "rollJournal" | "adventurePending" | "boardEpoch" | "adventureId" | "progress" | "places" | "featuresFound" | "goneSpawns" | "storyRecent"> & {
  /** The adventure being played (id only), where the story stands, and what each place left behind. Absent in a save from a test room or from before adventures. */
  adventureId?: string | null;
  progress?: AdventureProgress | null;
  places?: Record<string, PlaceMemory>;
  featuresFound?: string[];
  goneSpawns?: string[];
  storyRecent?: string[];
  bodies: PlayBody[];
  /** One "1" (seen) or "0" per square, row-major: PlayState.explored as text. */
  explored: string;
};

export type PlaySnapshot = SnapshotBase & {
  v: 2;
  room: RoomChoice;
  creatures: SavedCreature[];
  spawned: Record<string, number>;
  creatureSeq: number;
  /** The fight, when one is on: its order, whose turn it is and what each has left, so a save made mid-fight puts the fight back too. Left out (null) while exploring. */
  round?: CombatRound | null;
};

/** What a save from before creatures holds in their place (version 1): the one monster, whether it was seen, and what it carried. */
export type LegacySnapshot = Omit<SnapshotBase, "bodies"> & {
  v: 1;
  bodies?: Omit<PlayBody, "token">[];
  monster: { at: XY; hp: number; awake: boolean; prone?: boolean } | null;
  monsterSeen: boolean;
  monsterCarried?: CarriedItem[];
};

/** Either shape: what a stored save may be. fromSnapshot puts both back as a scene with creatures. */
export type StoredSnapshot = PlaySnapshot | LegacySnapshot;

export const encodeExplored = (e: Uint8Array): string => Array.from(e, (b) => (b ? "1" : "0")).join("");
export const decodeExplored = (s: string): Uint8Array => Uint8Array.from(s, (c) => (c === "1" ? 1 : 0));

/** A copy that later play cannot reach into. */
export function toSnapshot(p: PlayState): PlaySnapshot {
  const { heroActor: _hero, creatures, explored, exploredRev: _rev, round, note: _note, options: _options, dmJournal: _dm, rollJournal: _rolls, adventurePending: _pending, boardEpoch: _epoch, ...rest } = p;
  // A creature's actor is the picture, not the scene.
  const saved: SavedCreature[] = creatures.map(({ actor: _actor, ...c }) => c);
  return JSON.parse(JSON.stringify({ ...rest, creatures: saved, round, v: SNAPSHOT_VERSION, explored: encodeExplored(explored) })) as PlaySnapshot;
}

const inRoom = (v: unknown): boolean => isRec(v) && isNum(v.x) && isNum(v.y) && Number.isInteger(v.x) && Number.isInteger(v.y) && v.x >= 0 && v.y >= 0 && v.x < CELL_WIDTH && v.y < CELL_HEIGHT;
const isSheetLike = (v: unknown): boolean => isRec(v) && isStr(v.name) && isStr(v.archetypeId) && isNum(v.currentHp) && isNum(v.maxHp) && Array.isArray(v.inventory) && isRec(v.modifiers);

/** Whether a stored payload is one this table wrote and can put back whole. The envelope is savePoints.ts's; this guards the data inside. */
export function isSnapshot(d: unknown): d is StoredSnapshot {
  if (!isRec(d) || (d.v !== SNAPSHOT_VERSION && d.v !== LEGACY_SNAPSHOT_VERSION)) return false;
  if (d.template !== "fantasy" && d.template !== "scifi") return false;
  const known = walkableById(d.template);
  if (!isStr(d.archetypeId) || !PLAYABLE_HEROES.includes(d.archetypeId as ArchetypeId)) return false;
  if (!isStr(d.floorId) || !known.has(d.floorId)) return false;
  if (!isSheetLike(d.hero) || !isSheetLike(d.start) || !isRec(d.itemNotes) || !Object.values(d.itemNotes).every(isStr)) return false;
  if (!inRoom(d.heroAt)) return false;
  if (d.v === SNAPSHOT_VERSION) {
    if (!ROOM_CHOICES.includes(d.room as RoomChoice) || !isNum(d.creatureSeq) || !isRec(d.spawned) || !Object.values(d.spawned).every(isNum)) return false;
    if (!Array.isArray(d.creatures) || !d.creatures.every((c) => isCreatureLike(c, known))) return false;
  } else {
    const m = d.monster;
    if (m !== null && !(isRec(m) && inRoom(m.at) && isNum(m.hp) && typeof m.awake === "boolean" && (m.prone === undefined || typeof m.prone === "boolean"))) return false;
    if (typeof d.monsterSeen !== "boolean") return false;
  }
  if (d.fallenAt !== null && !inRoom(d.fallenAt)) return false;
  if (typeof d.doorOpen !== "boolean" || typeof d.searched !== "boolean" || typeof d.doorLocked !== "boolean") return false;
  if (!isNum(d.potions) || !isNum(d.potionsGranted) || !isNum(d.worldRev) || !isNum(d.propSeq)) return false;
  if (!isStr(d.explored) || d.explored.length !== CELL_WIDTH * CELL_HEIGHT || !/^[01]+$/.test(d.explored)) return false;
  if (!Array.isArray(d.log) || !d.log.every((l) => isRec(l) && isStr(l.text) && (l.tone === "good" || l.tone === "bad" || l.tone === "plain" || l.tone === "dm"))) return false;
  if (!Array.isArray(d.extraProps) || !d.extraProps.every((e) => isRec(e) && isStr(e.id) && isStr(e.assetId) && known.has(e.assetId) && inRoom(e) && isStr(e.label) && (e.secret === undefined || isStr(e.secret)))) return false;
  if (!isRec(d.propSecrets) || !Object.values(d.propSecrets).every(isStr)) return false;
  if (!Array.isArray(d.tileOverrides) || !d.tileOverrides.every((o) => isRec(o) && inRoom(o) && isStr(o.tile) && known.has(o.tile))) return false;
  if (!adventureFieldsOk(d)) return false;
  if (!Array.isArray(d.dmMemory) || !d.dmMemory.every(isStr)) return false;
  if (!Array.isArray(d.dmRecent) || !d.dmRecent.every((r) => isRec(r) && (r.who === "player" || r.who === "dm") && isStr(r.text))) return false;
  // Saves from before bodies, piles and item flags have none of these: they are optional here and filled in on load.
  if (d.bodies !== undefined && !(Array.isArray(d.bodies) && d.bodies.every(isBodyLike))) return false;
  if (d.v === LEGACY_SNAPSHOT_VERSION && d.monsterCarried !== undefined && !(Array.isArray(d.monsterCarried) && d.monsterCarried.every(isCarriedLike))) return false;
  if (d.piles !== undefined && !(Array.isArray(d.piles) && d.piles.every((q) => isRec(q) && inRoom(q.at) && Array.isArray(q.items) && q.items.every(isStr)))) return false;
  if (d.itemFlags !== undefined && !(isRec(d.itemFlags) && Object.values(d.itemFlags).every(isRec))) return false;
  // Hiding, sneaking and the lock's DC came later: an older save has none of them.
  if ((d.heroHidden !== undefined && typeof d.heroHidden !== "boolean") || (d.sneaking !== undefined && typeof d.sneaking !== "boolean") || (d.doorLockDc !== undefined && !isNum(d.doorLockDc))) return false;
  return true;
}

/** The adventure part of a save: absent (a test room, or a save from before adventures), or an adventure the bench has, at the version the save was made against, with a story record and places that fit. */
function adventureFieldsOk(d: Record<string, unknown>): boolean {
  const id = d.adventureId;
  if (id === undefined || id === null) return d.progress === undefined || d.progress === null;
  if (!isStr(id)) return false;
  const a = adventureById(id);
  const pr = d.progress;
  if (!a || !isRec(pr) || !progressMatches(a, pr as unknown as AdventureProgress)) return false;
  const strs = (v: unknown): boolean => Array.isArray(v) && v.every(isStr);
  if (!isStr(pr.sceneId) || !isStr(pr.locationId) || !locationOf(a, pr.locationId) || !sceneOf(a, pr.sceneId)) return false;
  if (!isRec(pr.flags) || !strs(pr.objectivesDone) || !strs(pr.beatsFired) || !strs(pr.killed) || !strs(pr.entered) || !strs(pr.talkedTo) || !strs(pr.has)) return false;
  if (pr.spawned !== undefined && !strs(pr.spawned)) return false;
  if (pr.ended !== undefined && pr.ended !== "victory" && pr.ended !== "defeat") return false;
  if (d.places !== undefined) {
    if (!isRec(d.places)) return false;
    for (const [loc, m] of Object.entries(d.places)) {
      if (!locationOf(a, loc) || !isRec(m) || !isStr(m.explored) || m.explored.length !== CELL_WIDTH * CELL_HEIGHT || !/^[01]+$/.test(m.explored)) return false;
      if (!Array.isArray(m.creatures) || !m.creatures.every((c) => isCreatureLike(c, walkableById("fantasy")))) return false;
      if (!Array.isArray(m.bodies) || !m.bodies.every(isBodyLike)) return false;
      if (!Array.isArray(m.piles) || !m.piles.every((q) => isRec(q) && inRoom(q.at) && strs(q.items))) return false;
      if (!Array.isArray(m.extraProps) || !m.extraProps.every((e) => isRec(e) && isStr(e.id) && isStr(e.assetId) && inRoom(e) && isStr(e.label))) return false;
      if (!Array.isArray(m.tileOverrides) || !m.tileOverrides.every((o) => isRec(o) && inRoom(o) && isStr(o.tile))) return false;
      if (!isRec(m.propSecrets) || !Object.values(m.propSecrets).every(isStr)) return false;
    }
  }
  return (d.featuresFound === undefined || strs(d.featuresFound)) && (d.goneSpawns === undefined || strs(d.goneSpawns)) && (d.storyRecent === undefined || strs(d.storyRecent));
}

const isCarriedLike = (c: unknown): boolean => isRec(c) && isStr(c.name) && isStr(c.note) && isStr(c.kind) && typeof c.pocketable === "boolean";
const isBodyLike = (b: unknown): boolean =>
  isRec(b) && isStr(b.id) && isStr(b.name) && inRoom(b.at) && Array.isArray(b.items) && b.items.every(isCarriedLike) && typeof b.looted === "boolean" && typeof b.harvested === "boolean" && typeof b.beast === "boolean" && typeof b.engineLootRolled === "boolean" && (b.token === undefined || isStr(b.token));
const isCreatureLike = (c: unknown, known: ReadonlyMap<string, boolean>): boolean =>
  isRec(c) &&
  isStr(c.id) &&
  isStr(c.token) &&
  isNum(c.n) &&
  inRoom(c.at) &&
  isNum(c.hp) &&
  typeof c.awake === "boolean" &&
  typeof c.seen === "boolean" &&
  typeof c.prone === "boolean" &&
  typeof c.hostile === "boolean" &&
  Array.isArray(c.carried) &&
  c.carried.every(isCarriedLike) &&
  (c.npc === undefined || (isRec(c.npc) && isStr(c.npc.role) && (c.npc.name === undefined || isStr(c.npc.name)))) &&
  (c.adv === undefined || (isRec(c.adv) && isStr(c.adv.spawn) && isStr(c.adv.instance) && (c.adv.npc === undefined || isStr(c.adv.npc)))) &&
  known.has(c.token);

/**
 * The fight a snapshot holds, or null when it holds none or it does not fit the scene (a combatant with no creature, no hero, an index out of
 * range): a save is never refused for it, it just comes back as a scene with nobody fighting.
 */
function roundFromSnapshot(raw: unknown, creatures: readonly SavedCreature[]): CombatRound | null {
  if (!isRec(raw) || !Array.isArray(raw.order) || !isNum(raw.activeIndex) || !isNum(raw.roundNumber)) return null;
  const order = raw.order;
  const fits = order.every(
    (cb) => isRec(cb) && isStr(cb.id) && isStr(cb.label) && (cb.side === "player" || cb.side === "hostile") && isNum(cb.initiative) && isNum(cb.speedFt) && isRec(cb.economy) && (cb.side === "player" ? cb.id === HERO_ID : creatures.some((c) => c.id === cb.id && c.hostile)),
  );
  if (!fits || order.length === 0 || !order.some((cb) => (cb as Record<string, unknown>).id === HERO_ID) || raw.activeIndex < 0 || raw.activeIndex >= order.length) return null;
  return raw as unknown as CombatRound;
}

/** The scene a snapshot holds, as a fresh PlayState: new animated figures, the fight if one was on, no suggested moves. Null when it is not a snapshot. Reads both the shape with creatures and a save from before them (one monster). */
export function fromSnapshot(data: unknown): PlayState | null {
  if (!isSnapshot(data)) return null;
  const s = JSON.parse(JSON.stringify(data)) as StoredSnapshot;
  const { explored, ...rest } = s;
  const kit = SCENE_KIT[rest.template];
  const old = rest as Partial<Pick<SnapshotBase, "piles" | "itemFlags" | "heroHidden" | "sneaking" | "doorLockDc" | "adventureId" | "progress" | "places" | "featuresFound" | "goneSpawns" | "storyRecent">>;
  let creatures: Creature[];
  let room: RoomChoice;
  let spawned: Record<string, number>;
  let creatureSeq: number;
  let bodies: PlayBody[];
  if (s.v === SNAPSHOT_VERSION) {
    creatures = s.creatures.map((c) => ({ ...c, actor: newActor("left") }));
    room = s.room;
    spawned = s.spawned;
    creatureSeq = s.creatureSeq;
    // A body names its creature; one that does not (an older save) is the scene's first kind.
    bodies = (s.bodies as (BodyState & { token?: TileId })[]).map((b) => ({ ...b, token: b.token ?? kit.monster }));
  } else {
    // A save from before creatures: one monster (or none), whether it was seen, what it carried; its id is the one it always had.
    const m = s.monster;
    creatures = m
      ? [
          {
            id: MONSTER_ID,
            token: kit.monster,
            n: 1,
            at: { ...m.at },
            hp: m.hp,
            awake: m.awake,
            seen: s.monsterSeen,
            prone: m.prone === true,
            carried: s.monsterCarried ?? carriedBy(kit.monster),
            hostile: true,
            actor: newActor("left"),
          },
        ]
      : [];
    room = "one";
    spawned = { [kit.monster]: 1 };
    creatureSeq = 2;
    // A save from before bodies: a slain monster's loot went straight to the pack then, so its body is already searched.
    const legacyBodies = s.bodies ?? (s.fallenAt ? [{ ...bodyFor("body-1", kit.monster, s.fallenAt, []), looted: true, engineLootRolled: true }] : []);
    bodies = legacyBodies.map((b) => ({ ...b, token: kit.monster }));
  }
  const { v: _v, monster: _monster, monsterSeen: _seen, monsterCarried: _carried, creatures: _creatures, spawned: _spawned, creatureSeq: _seq, room: _room, bodies: _bodies, round: _round, adventureId: _aid, progress: _prog, places: _places, featuresFound: _found, goneSpawns: _gone, storyRecent: _recent, ...scene } = rest as typeof rest & Record<string, unknown>;
  const p: PlayState = {
    ...(scene as Omit<SnapshotBase, "bodies" | "explored" | "adventureId" | "progress" | "places" | "featuresFound" | "goneSpawns" | "storyRecent">),
    room,
    creatures,
    spawned,
    creatureSeq,
    bodies,
    piles: old.piles ?? [],
    itemFlags: old.itemFlags ?? {},
    heroHidden: old.heroHidden ?? false,
    sneaking: old.sneaking ?? false,
    doorLockDc: old.doorLockDc ?? DEFAULT_LOCK_DC,
    dmJournal: [],
    rollJournal: [],
    adventureId: old.adventureId ?? null,
    progress: old.progress ?? null,
    places: old.places ?? {},
    featuresFound: old.featuresFound ?? [],
    goneSpawns: old.goneSpawns ?? [],
    storyRecent: old.storyRecent ?? [],
    adventurePending: [],
    boardEpoch: nextBoardEpoch(),
    note: null,
    round: s.v === SNAPSHOT_VERSION ? roundFromSnapshot(s.round, s.creatures) : null,
    options: [],
    heroActor: newActor("down"),
    explored: decodeExplored(explored),
    exploredRev: 1,
  };
  // A hero saved before a class was renamed (the Mage, now the Wizard) reads by the current names everywhere: the HUD, the DM's brief, the log.
  p.hero = refreshRetiredNames(p.hero);
  p.start = refreshRetiredNames(p.start);
  noteSight(p);
  // A knocked-down creature is drawn lying there, as it was.
  for (const c of p.creatures) if (c.prone) playClips(c.actor, ["death"], performance.now());
  return p;
}

// ---- the book of saves ------------------------------------------------------------------

export type SavedGame = SavePoint<StoredSnapshot>;

/** What the host's storage holds; nothing when it is empty, unreadable or blocked. Never throws. */
export function readStoredSaves(store: TableStorage["saves"]): SavedGame[] {
  try {
    return parseSaves<StoredSnapshot>(store.read(SAVES_SCOPE), isSnapshot);
  } catch {
    return [];
  }
}

/** Keep the saves in the host's storage. Never throws: storage can be blocked, full or absent, and the saves still work for this visit. */
export function writeStoredSaves(store: TableStorage["saves"], list: readonly SavedGame[]): void {
  try {
    store.write(SAVES_SCOPE, serializeSaves(list));
  } catch {
    // Storage can be blocked, full or absent (a private window): the saves still work for this visit.
  }
}

/** One window's saves, newest first (savePoints.ts addSave), mirrored to the host's storage on every change. */
export interface SaveBook {
  /** Newest first. The same array object until the next add. */
  list(): readonly SavedGame[];
  /** Make a save of the scene as it is now (each kind trimmed on its own) and keep it. */
  add(p: PlayState, kind: SaveKind, label: string): void;
  /** A save by id, or the newest of any kind for "last". */
  find(id: string): SavedGame | undefined;
}

/** Read what the host kept, once, and keep a book of saves on top of it. The bench read them once per page load; a window reads them when it opens. */
export function createSaveBook(store: TableStorage["saves"]): SaveBook {
  let saves: SavedGame[] = readStoredSaves(store);
  return {
    list: () => saves,
    add(p, kind, label) {
      saves = addSave(saves, makeSavePoint(kind, label, toSnapshot(p)));
      writeStoredSaves(store, saves);
    },
    find: (id) => (id === "last" ? latestSave(saves) : saves.find((s) => s.id === id)),
  };
}

/** A line under a save in the Saves tab: who, how hurt, what is in the pack. */
export function saveDetail(save: SavedGame): string {
  const h = refreshRetiredNames(save.data.hero);
  return `${h.name}, ${h.currentHp}/${h.maxHp} HP, ${save.data.potions} potion${save.data.potions === 1 ? "" : "s"}`;
}
