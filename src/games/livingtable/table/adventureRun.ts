/**
 * An adventure running in the scene, and the scene's board.
 *
 * An adventure's places are separate boards built by the engine's own
 * locationLayout; the hero walks between them by their exits. The story
 * (adventures/progress.ts) decides every step: the game reports what happened (an
 * event) and the engine says what it did (beats, objectives, a new scene, an end).
 * Everything here changes the state and queues what happened in `adventurePending`;
 * the window plays it out (cards, strip, journal).
 *
 * Also here, because the bench kept them in the same stretch of its registry: the
 * scene's tiles, props and layout (sceneTiles, sceneProps, sceneLayout), what stops
 * a foot (terrainBlocks), a path toward a square (pathToward), and the two loot
 * helpers every kill goes through (leaveBody, rollLoot).
 *
 * Moved out of the asset bench's registry as it was. What changed: walkability and
 * sprite names come from the bound catalog (catalog.ts) instead of the bench's own
 * sprite arrays, and the adventure being played is looked up through the bound
 * adventures (adventureCatalog.ts). Import-pure: nothing runs until a function is
 * called.
 */
import { bodySpriteId, gearItemName, LOOT_CAP_LINE, type ArchetypeId } from "../characters/equipmentTypes";
import { type AdventureStepResult, adventureKeepsTime, applyEvent, evaluate as evaluateCondition, settleProgress, startProgress } from "../adventures/progress";
import {
  type Adventure,
  type AdventureEvent,
  type AdventureExit,
  type AdventureFeature,
  type AdventureItem,
  type AdventureSpawn,
  dayOf,
  itemOf,
  locationOf,
  sceneOf,
  spawnInstanceIds,
  startingKitFor,
} from "../adventures/types";
import { locationLayout, spawnIsPresent } from "../adventures/validate";
import type { CharacterSheet } from "../characters/creation";
import type { TemplateGenre } from "../characters/templates";
import { lootLine, sentenceCase } from "../menu/labels";
import { bodyFor } from "../rules/corpses";
import { lootFor } from "../rules/loot";
import type { CellLayout, PlacedProp, PlacedToken, TileId } from "../world/cell";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import { emptyExplored } from "../world/visibility";
import { DEFAULT_MELEE_REACH_TILES, tileDistance } from "../world/reach";
import { adventureById } from "./adventureCatalog";
import { spriteName, walkableById } from "./catalog";
import { foldItem, withoutCount } from "./gearLoot";
import { footprintAt, groupWords, propGroupAt } from "./propGroups";
import type { HudJournal } from "./ui/overlay";
import { noteSight, creatureInSight } from "./sight";
import {
  addCreature,
  basePlay,
  CONTAINER_AT,
  type Creature,
  creatureAt,
  creatureLabel,
  DIVIDER_X,
  DOOR_AT,
  DRAIN_AT,
  DRAIN_TILE,
  HERO_ID,
  HERO_POTIONS,
  nextBoardEpoch,
  type PlaceMemory,
  type PlayBody,
  type PlayState,
  ROOM_FLOOR,
  same,
  SCENE_KIT,
  sentence,
  STORY_RECENT_KEEP,
  type XY,
} from "./state";
import { decodeExplored, encodeExplored } from "./snapshot";
import { newActor, playClips } from "./ui/cast";

// ---------------------------------------------------------------------------
// The adventure in the scene. An adventure's places are separate boards built by
// the engine's own locationLayout; the hero walks between them by their exits.
// The story (adventures/progress.ts) decides every step: the game reports what
// happened (an event) and the engine says what it did (beats, objectives, a new
// scene, an end). Everything here changes the state and queues what happened in
// `adventurePending`; the panel plays it out (cards, strip, journal).
// ---------------------------------------------------------------------------

/** A square nothing is ever on: the test room's door and chest stand here while an adventure runs, so no rule that asks "is this the door?" says yes. */
export const OFF_BOARD: XY = { x: -50, y: -50 };
export const doorAt = (p: PlayState): XY => (p.adventureId ? OFF_BOARD : DOOR_AT);
export const containerAt = (p: PlayState): XY => (p.adventureId ? OFF_BOARD : CONTAINER_AT);

/** The adventure being played, or null in a test room. */
export function adventureOf(p: PlayState): Adventure | null {
  return p.adventureId && p.progress ? (adventureById(p.adventureId) ?? null) : null;
}

/** The place of the adventure the hero is in. */
export function currentLocation(p: PlayState) {
  const a = adventureOf(p);
  return a && p.progress ? locationOf(a, p.progress.locationId) : undefined;
}

/** A place built into squares: floor, props, where its exits and features stand. Built once per place (the map never changes). */
export interface LocationBoard {
  tiles: TileId[][];
  props: PlacedProp[];
  exitsAt: Record<string, XY>;
  featuresAt: Record<string, XY>;
  start?: XY;
}
export const boardsByAdventure = new WeakMap<Adventure, Map<string, LocationBoard>>();

export function locationBoard(a: Adventure, locationId: string): LocationBoard {
  let boards = boardsByAdventure.get(a);
  if (!boards) boardsByAdventure.set(a, (boards = new Map()));
  const hit = boards.get(locationId);
  if (hit) return hit;
  const walk = walkableById("fantasy");
  const built = locationLayout(a, locationId, {
    walkable: (t) => walk.get(t) === true,
    blocking: (id) => walk.get(id) === false,
  });
  const board: LocationBoard = { tiles: built.layout.tiles, props: built.layout.props, exitsAt: built.exitsAt, featuresAt: built.featuresAt, ...(built.start ? { start: built.start } : {}) };
  boards.set(locationId, board);
  return board;
}

/** The board of the place the hero is in, or null in a test room. */
export function advBoard(p: PlayState): LocationBoard | null {
  const a = adventureOf(p);
  return a && p.progress ? locationBoard(a, p.progress.locationId) : null;
}

/** A thing in a place the hero can walk onto to leave: an exit and the square it stands on. */
export interface ExitHere {
  exit: AdventureExit;
  at: XY;
}

export function exitsHere(p: PlayState): ExitHere[] {
  const board = advBoard(p);
  const loc = currentLocation(p);
  if (!board || !loc) return [];
  return loc.exits.flatMap((exit) => (board.exitsAt[exit.id] ? [{ exit, at: board.exitsAt[exit.id]! }] : []));
}

export const exitOn = (p: PlayState, at: XY): ExitHere | undefined => (p.adventureId ? exitsHere(p).find((e) => same(e.at, at)) : undefined);

/** Whether the way is open now: no condition on it, or the story says it holds. */
export function exitIsOpen(p: PlayState, exit: AdventureExit): boolean {
  const a = adventureOf(p);
  if (!exit.requires) return true;
  return a !== null && p.progress !== null && evaluateCondition(a, p.progress, exit.requires);
}

/** What the party finds while a way is shut, in the adventure's own words (or an honest plain line when it wrote none). */
export const exitLockedWords = (exit: AdventureExit): string => sentence(exit.lockedText ?? "That way is shut.");

export function featureAtSquare(p: PlayState, at: XY): AdventureFeature | undefined {
  const board = advBoard(p);
  const loc = currentLocation(p);
  if (!board || !loc) return undefined;
  // A thing drawn in several squares (the well) has its feature on one of them: any part of it is that feature.
  const squares = footprintAt(board.props, at);
  const id = Object.keys(board.featuresAt).find((k) => squares.some((s) => same(board.featuresAt[k]!, s)));
  return id ? loc.features.find((f) => f.id === id) : undefined;
}

export const featureKey = (p: PlayState, f: AdventureFeature): string => `${p.progress?.locationId ?? ""}/${f.id}`;
export const featureIsFound = (p: PlayState, f: AdventureFeature): boolean => p.featuresFound.includes(featureKey(p, f));
/** A feature the hero can search: it has a DC, something to give or a secret. One with none of them is only looked at. */
export const featureSearchable = (f: AdventureFeature): boolean => f.searchDc !== undefined || (f.gives?.length ?? 0) > 0 || !!f.secret;

/** The nearest feature within one square of the hero (the hero's own square counts). */
export function featureNear(p: PlayState): { feature: AdventureFeature; at: XY } | undefined {
  const board = advBoard(p);
  const loc = currentLocation(p);
  if (!board || !loc) return undefined;
  let best: { feature: AdventureFeature; at: XY; d: number } | undefined;
  for (const f of loc.features) {
    const at = board.featuresAt[f.id];
    if (!at) continue;
    const d = tileDistance(p.heroAt, at);
    if (d <= 1 && (!best || d < best.d)) best = { feature: f, at, d };
  }
  return best ? { feature: best.feature, at: best.at } : undefined;
}

/** What a placed prop or feature is called in a sentence: a feature by its name, any other prop by its picture's name. */
export function advPropWords(p: PlayState, at: XY): string | null {
  const f = featureAtSquare(p, at);
  if (f) return f.name.toLowerCase().startsWith("the ") ? f.name : `the ${f.name.toLowerCase()}`;
  const props = advBoard(p)?.props ?? [];
  const prop = props.find((q) => same(q, at));
  if (!prop) return null;
  // A part of something bigger is named for the whole ("the well", not "the well, back right").
  if (propGroupAt(props, at).length > 1) return `the ${groupWords(prop.assetId)}`;
  const name = spriteName("fantasy", prop.assetId);
  return `the ${name.toLowerCase()}`;
}

export const npcOf = (a: Adventure, id: string | undefined) => (id ? a.npcs.find((n) => n.id === id) : undefined);

/** A square near `at` where a creature can stand: `at` itself when it is free, else the nearest free one within three squares. */
export function freeSquareNear(p: PlayState, at: XY): XY {
  const tiles = sceneTiles(p);
  const ok = (q: XY): boolean => q.x >= 0 && q.y >= 0 && q.x < CELL_WIDTH && q.y < CELL_HEIGHT && terrainBlocks(p, tiles, q) === null && !same(q, p.heroAt) && !creatureAt(p, q);
  if (ok(at)) return at;
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const q = { x: at.x + dx, y: at.y + dy };
        if (ok(q)) return q;
      }
    }
  }
  return at;
}

/**
 * Put the place's creatures on the board: every creature of every spawn that is in play (its own condition holds, no beat is still holding
 * it back) and not dead, as the engine's locationLayout places them. Creatures already there stay as they are; one whose spawn is not in
 * play any more (the landlady, once the job is done) goes. `only` limits it to these spawn ids (what a beat just brought in).
 * A hostile starts as the spawn says (awake or asleep); anybody else is an NPC with their own name.
 */
export function populateLocation(p: PlayState, only?: ReadonlySet<string>): void {
  const a = adventureOf(p);
  const loc = currentLocation(p);
  const progress = p.progress;
  if (!a || !loc || !progress) return;
  if (!only) {
    p.creatures = p.creatures.filter((c) => {
      const spawn = c.adv ? loc.spawns.find((s) => s.id === c.adv!.spawn) : undefined;
      return !c.adv || !spawn || spawnIsPresent(a, progress, spawn);
    });
  }
  const walk = walkableById("fantasy");
  const placed = locationLayout(a, loc.id, {
    progress,
    walkable: (t) => walk.get(t) === true,
    blocking: (id) => walk.get(id) === false,
  }).layout.tokens;
  const spawnOf = new Map<string, AdventureSpawn>();
  for (const s of loc.spawns) for (const id of spawnInstanceIds(s)) spawnOf.set(id, s);
  for (const t of placed) {
    const spawn = spawnOf.get(t.id);
    if (!spawn || (only && !only.has(spawn.id))) continue;
    if (p.creatures.some((c) => c.adv?.instance === t.id) || p.goneSpawns.includes(t.id)) continue;
    const npc = npcOf(a, spawn.npcId);
    addCreature(p, t.assetId, freeSquareNear(p, { x: t.x, y: t.y }), {
      id: t.id,
      awake: spawn.awake,
      hostile: spawn.hostile,
      ...(spawn.hostile ? {} : { npc: { role: npc?.role ?? "villager", ...(npc ? { name: npc.name } : {}) } }),
      adv: { spawn: spawn.id, instance: t.id, ...(spawn.npcId ? { npc: spawn.npcId } : {}) },
    });
  }
}

export const advHolds = (p: PlayState, item: AdventureItem): boolean => p.hero.inventory.some((n) => foldItem(withoutCount(n)) === foldItem(item.name));

/** Put an adventure item in the pack with its own description and flags (a quest item cannot be dropped or destroyed; a usable one sends its words to the DM). */
export function giveAdventureItem(p: PlayState, item: AdventureItem): void {
  if (advHolds(p, item)) return;
  p.hero = { ...p.hero, inventory: [...p.hero.inventory, item.name] };
  p.itemNotes[item.name] = item.description;
  if (item.quest === true || item.usable === true || item.useSay !== undefined) {
    p.itemFlags[item.name] = { ...(item.quest ? { quest: true } : {}), ...(item.usable ? { usable: true } : {}), ...(item.useSay !== undefined ? { useSay: item.useSay } : {}) };
  }
  p.log.push({ text: `You now carry ${item.name}.`, tone: "good", notice: `+ ${item.name}` });
}

/** What a step of the story leaves behind: the items its beats handed over, the creatures they brought in, what the Journal remembers, and the step itself for the panel to play. */
export function afterStep(p: PlayState, a: Adventure, r: AdventureStepResult): void {
  for (const b of r.fired) {
    for (const g of b.give ?? []) {
      const item = itemOf(a, g);
      if (item) giveAdventureItem(p, item);
    }
    if (b.narrate) p.storyRecent = [...p.storyRecent, b.narrate].slice(-STORY_RECENT_KEEP);
  }
  const brought = new Set(r.fired.flatMap((b) => b.spawn ?? []));
  if (brought.size > 0) populateLocation(p, brought);
  if (r.fired.length > 0 || r.completed.length > 0 || r.sceneChanged || r.ended) p.adventurePending.push(r);
}

/** Tell the story something happened. A refusal changes nothing (the result says why); anything else is applied and queued. */
export function advApply(p: PlayState, e: AdventureEvent): AdventureStepResult | null {
  const a = adventureOf(p);
  if (!a || !p.progress) return null;
  const r = applyEvent(a, p.progress, e);
  if (r.refused) return r;
  p.progress = r.progress;
  afterStep(p, a, r);
  return r;
}

/**
 * Keep the story's list of items the party holds in step with the pack: an adventure item that arrived is a "gain", one that left (dropped,
 * destroyed) a "lose". Cheap, so the panel runs it every frame.
 */
export function syncItems(p: PlayState): void {
  const a = adventureOf(p);
  const progress = p.progress;
  if (!a || !progress || progress.ended) return;
  for (const item of a.items) {
    const holds = advHolds(p, item);
    const has = p.progress!.has.includes(item.id);
    if (holds && !has) advApply(p, { type: "gain", item: item.id });
    else if (!holds && has) advApply(p, { type: "lose", item: item.id });
  }
}

/** The place the hero is in, as it will be remembered once they leave. */
export function stashPlace(p: PlayState): void {
  const id = p.progress?.locationId;
  if (!id) return;
  p.places[id] = {
    explored: encodeExplored(p.explored),
    creatures: p.creatures.map(({ actor: _actor, ...c }) => ({ ...c })),
    bodies: p.bodies.map((b) => ({ ...b })),
    piles: p.piles.map((q) => ({ at: { ...q.at }, items: [...q.items] })),
    extraProps: p.extraProps.map((e) => ({ ...e })),
    tileOverrides: p.tileOverrides.map((o) => ({ ...o })),
    propSecrets: { ...p.propSecrets },
  };
}

/** A place nobody has been to: nothing explored, nobody there, nothing changed. */
export function clearPlace(p: PlayState): void {
  p.spawned = {};
  p.explored = emptyExplored();
  p.exploredRev++;
  p.creatures = [];
  p.bodies = [];
  p.piles = [];
  p.extraProps = [];
  p.tileOverrides = [];
  p.propSecrets = {};
  p.round = null;
  p.fallenAt = null;
}

export function restorePlace(p: PlayState, m: PlaceMemory): void {
  p.explored = decodeExplored(m.explored);
  p.exploredRev++;
  p.creatures = m.creatures.map((c) => ({ ...c, actor: newActor("left") }));
  // Each kind is numbered within the place ("Rat 2" only where there are several): the count carries on from the highest number kept here.
  p.spawned = {};
  for (const c of p.creatures) p.spawned[c.token] = Math.max(p.spawned[c.token] ?? 0, c.n);
  for (const c of p.creatures) if (c.prone) playClips(c.actor, ["death"], performance.now());
  p.bodies = m.bodies.map((b) => ({ ...b }));
  p.piles = m.piles.map((q) => ({ at: { ...q.at }, items: [...q.items] }));
  p.extraProps = m.extraProps.map((e) => ({ ...e }));
  p.tileOverrides = m.tileOverrides.map((o) => ({ ...o }));
  p.propSecrets = { ...m.propSecrets };
}

/**
 * The hero leaves for another place of the adventure: the place left is kept as it is, the story is told the party entered the new one
 * (it may fire beats, finish objectives, move to another scene), the board becomes the new place (remembered, or fresh) with the hero on
 * `at` and its creatures on their squares. Returns false, changing nothing, when the story has no such place.
 */
export function enterLocation(p: PlayState, locationId: string, at: XY): boolean {
  const a = adventureOf(p);
  if (!a || !p.progress || !locationOf(a, locationId)) return false;
  const r = applyEvent(a, p.progress, { type: "enter", location: locationId });
  if (r.refused) return false;
  stashPlace(p);
  clearPlace(p);
  p.progress = r.progress;
  p.heroAt = { ...at };
  const kept = p.places[locationId];
  if (kept) {
    restorePlace(p, kept);
    delete p.places[locationId];
  }
  p.heroHidden = false;
  p.sneaking = false;
  p.options = [];
  p.worldRev++;
  p.boardEpoch = nextBoardEpoch();
  afterStep(p, a, r);
  populateLocation(p);
  noteSight(p);
  return true;
}

/** A new game of an adventure: this hero, at the start of the first scene, in its first place, with the creatures that are there. */
export function newAdventurePlay(a: Adventure, sheet: CharacterSheet, template: TemplateGenre = "fantasy"): PlayState {
  const archetypeId = sheet.archetypeId as ArchetypeId;
  const p = basePlay(template, archetypeId, ROOM_FLOOR[template], undefined, sheet);
  const kit = startingKitFor(a, sheet.chassis);
  // The bench's own potion stock: what the adventure's kit says (none, in the first adventure), the usual two when it says nothing.
  p.potions = kit ? kit.potions : HERO_POTIONS;
  p.adventureId = a.id;
  const settled = settleProgress(a, startProgress(a));
  p.progress = settled.progress;
  p.heroAt = { ...a.start.at };
  afterStep(p, a, settled);
  populateLocation(p);
  noteSight(p);
  return p;
}

/** The Journal tab: the adventure, the scene, its objectives (a hidden one is the DM's alone) and the last beats. */
export function journalFor(p: PlayState): HudJournal | undefined {
  const a = adventureOf(p);
  const progress = p.progress;
  if (!a || !progress) return undefined;
  const scene = sceneOf(a, progress.sceneId);
  return {
    title: a.title,
    scene: scene?.title ?? "",
    ...(adventureKeepsTime(a) ? { day: dayOf(progress) } : {}),
    objectives: (scene?.objectives ?? []).filter((o) => !o.hidden).map((o) => ({ text: o.text, done: progress.objectivesDone.includes(o.id) })),
    ...(p.storyRecent.length > 0 ? { recent: [...p.storyRecent] } : {}),
  };
}

/** What Use does now in an adventure: leave by the exit underfoot, search or look at the feature beside the hero. Null when neither. */
export function advUseFor(p: PlayState): { kind: "exit"; exit: ExitHere; label: string } | { kind: "feature"; feature: AdventureFeature; at: XY; label: string } | null {
  const here = exitOn(p, p.heroAt);
  if (here && !p.round) return { kind: "exit", exit: here, label: "Go" };
  const near = featureNear(p);
  if (near) return { kind: "feature", ...near, label: featureSearchable(near.feature) && !featureIsFound(p, near.feature) ? "Search" : "Look" };
  return null;
}

export function sceneTiles(p: PlayState): TileId[][] {
  const wall = SCENE_KIT[p.template].wall;
  const board = advBoard(p);
  const tiles = board
    ? board.tiles.map((row) => [...row])
    : Array.from({ length: CELL_HEIGHT }, (_, y) =>
        Array.from({ length: CELL_WIDTH }, (_, x) => {
          const edge = x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1;
          const divider = x === DIVIDER_X && y !== DOOR_AT.y;
          if (edge || divider) return wall;
          return DRAIN_AT.some((d) => same(d, { x, y })) ? DRAIN_TILE[p.template] : p.floorId;
        }),
      );
  // What the DM changed rides on top; it can never reach the border (the effect is refused there).
  for (const o of p.tileOverrides) {
    const row = tiles[o.y];
    if (row && o.x >= 0 && o.x < row.length) row[o.x] = o.tile;
  }
  return tiles;
}

export function sceneProps(p: PlayState): PlacedProp[] {
  const kit = SCENE_KIT[p.template];
  const board = advBoard(p);
  // An adventure's place: its own props (the map's, with the features' names), and whatever the DM added.
  if (board) return [...board.props, ...p.extraProps.map((e) => ({ id: e.id, assetId: e.assetId, x: e.x, y: e.y, label: e.label }))];
  return [
    { id: "door", assetId: p.doorOpen ? kit.doorOpen : kit.doorClosed, x: DOOR_AT.x, y: DOOR_AT.y, label: kit.doorLabel },
    {
      id: "container",
      assetId: p.searched && kit.containerOpened ? kit.containerOpened : kit.container,
      x: CONTAINER_AT.x,
      y: CONTAINER_AT.y,
      label: kit.containerLabel,
    },
    // Props the DM placed: the engine, the picture, sight and walking all read them from here.
    ...p.extraProps.map((e) => ({ id: e.id, assetId: e.assetId, x: e.x, y: e.y, label: e.label })),
  ];
}

/**
 * The scene as a layout. `forDisplay` is the picture the player gets: a creature
 * the hero cannot see this moment is left out (remembered squares never show
 * creatures). The engine's own view (engineLayout) always has every one.
 */
export function sceneLayout(p: PlayState, animated: boolean, forDisplay = false): CellLayout {
  // Animated, the panel draws the hero and the creatures itself over the scene
  // (cast.ts); otherwise all of them are tokens the game's own renderCell composites.
  if (animated) return { tiles: sceneTiles(p), props: sceneProps(p), tokens: [], exits: [], sealed: true };
  const tokens: PlacedToken[] = [{ id: HERO_ID, assetId: bodySpriteId(p.archetypeId), x: p.heroAt.x, y: p.heroAt.y, kind: "pc" }];
  for (const c of p.creatures) {
    if (forDisplay && !creatureInSight(p, c)) continue;
    tokens.push({ id: c.id, assetId: c.token, x: c.at.x, y: c.at.y, kind: c.hostile ? "monster" : "npc", currentHp: c.hp });
  }
  return { tiles: sceneTiles(p), props: sceneProps(p), tokens, exits: [], sealed: true };
}

/** What stops anyone standing on `at`: the room's edge, a wall tile, or a prop whose sprite is not walkable (a closed door, the container). Tokens are checked by the caller. */
export function terrainBlocks(p: PlayState, tiles: TileId[][], at: XY): "edge" | "wall" | "door" | "container" | "prop" | null {
  if (at.x < 0 || at.y < 0 || at.x >= CELL_WIDTH || at.y >= CELL_HEIGHT) return "edge";
  const walkable = walkableById(p.template);
  if (walkable.get(tiles[at.y]![at.x]!) !== true) return "wall";
  for (const prop of sceneProps(p)) {
    if (same(prop, at) && walkable.get(prop.assetId) === false) return prop.id === "door" ? "door" : prop.id === "container" ? "container" : "prop";
  }
  return null;
}

/**
 * The first step of a shortest path from `from` to any tile next to `to`, and
 * how many steps that path takes, or null when there is no way through (a
 * closed door, say). Eight-way steps, the same Chebyshev distance
 * world/reach.ts measures reach in.
 */
export function pathToward(p: PlayState, tiles: TileId[][], from: XY, to: XY): { steps: number; next: XY } | null {
  if (tileDistance(from, to) <= DEFAULT_MELEE_REACH_TILES) return { steps: 0, next: from };
  const key = (c: XY) => c.y * CELL_WIDTH + c.x;
  const prev = new Map<number, number>([[key(from), -1]]);
  const queue: XY[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nxt = { x: cur.x + dx, y: cur.y + dy };
        if (terrainBlocks(p, tiles, nxt) || same(nxt, to) || prev.has(key(nxt))) continue;
        prev.set(key(nxt), key(cur));
        if (tileDistance(nxt, to) <= DEFAULT_MELEE_REACH_TILES) {
          let k = key(nxt);
          let steps = 1;
          while (prev.get(k) !== key(from)) {
            k = prev.get(k)!;
            steps++;
          }
          return { steps, next: { x: k % CELL_WIDTH, y: Math.floor(k / CELL_WIDTH) } };
        }
        queue.push(nxt);
      }
    }
  }
  return null;
}

/**
 * A slain creature leaves its body where it fell: everything it still carried (what a pickpocket left it with), nothing else.
 * The engine's own loot roll is made when the body is first searched (ensureBodyLoot), so a body nobody opens costs no roll.
 * Any kill (the Attack button, or a DM effect) goes through here.
 */
export function leaveBody(p: PlayState, c: Creature): PlayBody {
  const body: PlayBody = { ...bodyFor(`body-${p.bodies.length + 1}`, c.token, c.at, c.carried), token: c.token };
  p.bodies.push(body);
  c.carried = [];
  p.log.push({ text: `${sentenceCase(creatureLabel(p, c))} lies where it fell. Right-click the body (or press and hold) to search it.`, tone: "plain" });
  return body;
}

/** Rolls the game's own loot; false when the cell's loot ledger is spent (the log says so). */
export function rollLoot(p: PlayState, source: "fight" | "container"): boolean {
  const { sheet, roll } = lootFor(p.hero, { source, cx: 0, cy: 0 });
  p.hero = sheet;
  if (!roll) {
    p.log.push({ text: LOOT_CAP_LINE, tone: "plain" });
    return false;
  }
  const name = roll.item ? gearItemName(p.archetypeId, roll.item.slot, roll.item.tier) : null;
  p.log.push({ text: lootLine(roll, name), tone: roll.item ? "good" : "plain", ...(roll.item && name ? { notice: `+ ${name}` } : {}) });
  return true;
}
