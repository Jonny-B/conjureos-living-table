/**
 * Checking an adventure, and turning one of its ASCII maps into the engine's
 * own `CellLayout`.
 *
 * `validateAdventure` is the gate every adventure passes before a game may run
 * it, whoever wrote it (the owner, or the optional AI author). It checks every
 * reference and every map and says what is wrong in plain words with a path to
 * it. Errors stop the adventure; warnings are things worth a second look.
 *
 * `locationLayout` is the one place a map becomes a layout, so the checks and
 * the game agree about what a legend character means.
 */
import { CELL_HEIGHT, CELL_WIDTH, neighbourCell, type CellCoord, type Edge } from "../world";
import type { CellLayout, Exit, PlacedProp, PlacedToken } from "../world/cell";
import { BESTIARY, beastById } from "../rules/bestiary";
import { evaluate, startProgress } from "./progress";
import {
  ADVENTURE_CHASSIS,
  PLAYABLE_CHASSIS,
  allBeats,
  allSpawns,
  itemOf,
  locationOf,
  spawnInstanceIds,
  type Adventure,
  type AdventureAssets,
  type AdventureBeat,
  type AdventureIssue,
  type AdventureLocation,
  type AdventureProgress,
  type AdventureSpawn,
  type Condition,
} from "./types";

export interface XY {
  x: number;
  y: number;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_CONDITION_DEPTH = 24;
const MAX_SPAWN_COUNT = 30;

// ---------------------------------------------------------------------------
// Small shared helpers

/** A guess at which floor tiles can be walked on, used when the caller does not hand over the real list. */
export function defaultWalkable(tileId: string): boolean {
  return !/^(water|forest_canopy|cliff_face|wall_)|void|lava|chasm|abyss|(^|_)pit(_|$)/.test(tileId);
}

/** The token asset id that stands for a creature: a token id as is, else the bestiary's own token, else `token_<id>` (hyphens become underscores). */
export function creatureTokenId(creature: string): string {
  if (creature.startsWith("token_")) return creature;
  const beast = beastById(creature);
  return beast?.tokenAssetId ?? `token_${creature.replace(/-/g, "_")}`;
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function arr<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function edgeOfSquare(at: XY): Edge | undefined {
  if (at.x === 0) return "W";
  if (at.x === CELL_WIDTH - 1) return "E";
  if (at.y === 0) return "N";
  if (at.y === CELL_HEIGHT - 1) return "S";
  return undefined;
}

// ---------------------------------------------------------------------------
// Map scanning

interface LocScan {
  /** True when the grid has the right shape and every character it uses is in the legend. */
  ok: boolean;
  byFeature: Map<string, XY[]>;
  byExit: Map<string, XY[]>;
  bySpawn: Map<string, XY[]>;
  starts: XY[];
}

function mapShapeOk(loc: AdventureLocation): boolean {
  const rows = loc.map?.rows;
  return Array.isArray(rows) && rows.length === CELL_HEIGHT && rows.every((r) => typeof r === "string" && r.length === CELL_WIDTH);
}

function scanLocation(loc: AdventureLocation): LocScan {
  const scan: LocScan = { ok: mapShapeOk(loc), byFeature: new Map(), byExit: new Map(), bySpawn: new Map(), starts: [] };
  if (!scan.ok) return scan;
  const legend = loc.map.legend ?? {};
  const push = (m: Map<string, XY[]>, k: string, at: XY) => {
    const list = m.get(k);
    if (list) list.push(at);
    else m.set(k, [at]);
  };
  for (let y = 0; y < CELL_HEIGHT; y++) {
    const row = loc.map.rows[y]!;
    for (let x = 0; x < CELL_WIDTH; x++) {
      const entry = legend[row[x]!];
      if (!entry) {
        scan.ok = false;
        continue;
      }
      if (entry.feature) push(scan.byFeature, entry.feature, { x, y });
      if (entry.exit) push(scan.byExit, entry.exit, { x, y });
      if (entry.spawn) push(scan.bySpawn, entry.spawn, { x, y });
      if (entry.start) scan.starts.push({ x, y });
    }
  }
  return scan;
}

function tileAt(loc: AdventureLocation, x: number, y: number): string | undefined {
  return loc.map.legend[loc.map.rows[y]![x]!]?.tile;
}

function propAt(loc: AdventureLocation, x: number, y: number): string | undefined {
  return loc.map.legend[loc.map.rows[y]![x]!]?.prop;
}

// ---------------------------------------------------------------------------
// Placing creatures

interface PlacedInstance {
  spawn: AdventureSpawn;
  instanceId: string;
  at: XY;
}

/**
 * Where each creature of each spawn stands. Creature i of a spawn takes the
 * i-th square marked for it; any beyond the marked squares spread out to the
 * nearest free standable squares around the first one. Marked squares are
 * claimed before any spreading so a group never takes another spawn's spot.
 */
function placeInstances(
  loc: AdventureLocation,
  scan: LocScan,
  canStand: (x: number, y: number) => boolean,
  reserved: Set<string>,
  present: (s: AdventureSpawn) => boolean,
  alive: (instanceId: string) => boolean,
): { placed: PlacedInstance[]; missing: { spawn: AdventureSpawn; count: number }[] } {
  const taken = new Set(reserved);
  const avoidForSpread = new Set(reserved);
  for (const spots of scan.byExit.values()) for (const s of spots) avoidForSpread.add(key(s.x, s.y));

  const placed = new Map<string, PlacedInstance>();
  const pending: { spawn: AdventureSpawn; instanceId: string; from: XY }[] = [];
  const spawns = arr(loc.spawns).filter(present);

  for (const spawn of spawns) {
    const marks = scan.bySpawn.get(spawn.id) ?? [];
    const ids = spawnInstanceIds(spawn);
    ids.forEach((instanceId, i) => {
      if (!alive(instanceId)) return;
      const mark = marks[i];
      if (mark && canStand(mark.x, mark.y) && !taken.has(key(mark.x, mark.y))) {
        taken.add(key(mark.x, mark.y));
        placed.set(instanceId, { spawn, instanceId, at: mark });
      } else if (marks[0]) {
        pending.push({ spawn, instanceId, from: marks[0] });
      }
    });
  }

  const missingBy = new Map<string, { spawn: AdventureSpawn; count: number }>();
  for (const p of pending) {
    const at = nearestFree(p.from, canStand, (x, y) => taken.has(key(x, y)) || avoidForSpread.has(key(x, y)));
    if (at) {
      taken.add(key(at.x, at.y));
      placed.set(p.instanceId, { spawn: p.spawn, instanceId: p.instanceId, at });
    } else {
      const m = missingBy.get(p.spawn.id);
      if (m) m.count++;
      else missingBy.set(p.spawn.id, { spawn: p.spawn, count: 1 });
    }
  }

  // Report in file order: spawn order, then creature order.
  const ordered: PlacedInstance[] = [];
  for (const spawn of spawns) for (const id of spawnInstanceIds(spawn)) {
    const p = placed.get(id);
    if (p) ordered.push(p);
  }
  return { placed: ordered, missing: [...missingBy.values()] };
}

/** Breadth-first from `from` over standable squares, to the nearest square that is not blocked. */
function nearestFree(from: XY, canStand: (x: number, y: number) => boolean, blocked: (x: number, y: number) => boolean): XY | undefined {
  const seen = new Set<string>([key(from.x, from.y)]);
  const queue: XY[] = [from];
  const steps: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (!(cur.x === from.x && cur.y === from.y) && canStand(cur.x, cur.y) && !blocked(cur.x, cur.y)) return cur;
    for (const [dx, dy] of steps) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= CELL_WIDTH || ny >= CELL_HEIGHT) continue;
      if (seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      // Walk through anything that is floor, even a square somebody stands on; only walls end the search.
      if (canStand(nx, ny)) queue.push({ x: nx, y: ny });
    }
  }
  return undefined;
}

/** Whether a spawn is in play for this progress: not gated behind a beat that has not fired, and its own condition holds. Individual deaths are handled per creature by the caller. */
export function spawnIsPresent(a: Adventure, p: AdventureProgress, spawn: AdventureSpawn): boolean {
  const gated = allBeats(a).some((b) => (b.spawn ?? []).includes(spawn.id));
  if (gated && !(p.spawned ?? []).includes(spawn.id)) return false;
  if (spawn.appearsWhen && !evaluate(a, p, spawn.appearsWhen)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Layout

export interface LocationLayoutOptions {
  /** The game so far. Spawns that are dead, not yet appeared, or shut out by their condition are left off, and exits whose `requires` fails are not opened. Default: a fresh game. */
  progress?: AdventureProgress;
  /** Where this location sits in the world grid, so a boundary exit points at the true neighbour cell. Default {0,0}. */
  cell?: CellCoord;
  /** Whether a floor tile can be walked on. Default: a name-based guess (`defaultWalkable`). */
  walkable?: (tileId: string) => boolean;
  /** Whether a prop blocks its square. Default: nothing blocks. */
  blocking?: (propId: string) => boolean;
}

export interface LocationLayoutResult {
  layout: CellLayout;
  /** Spawn id to the squares its living creatures stand on, in creature order. */
  spawnsAt: Record<string, XY[]>;
  /** Exit id to its square. Includes exits inside the room; `layout.exits` has only the open ones on the room's edge. */
  exitsAt: Record<string, XY>;
  featuresAt: Record<string, XY>;
  /** The hero's start square, when the map marks one. */
  start?: XY;
}

/**
 * Build the engine's `CellLayout` from a location's ASCII map: floor tiles,
 * props, creature and NPC tokens (kind "monster" for hostile spawns, "npc"
 * otherwise; creature `i` of a group is the token `<spawn id>_<i>`), and
 * boundary exits. The hero's token is not placed; the game adds it at `start`
 * or at the square an exit leads to (`exitDestination`).
 *
 * Exits: the engine's own exit is a doorway on the room's edge to a
 * neighbouring cell, so only an adventure exit standing on an edge square
 * becomes a `layout.exits` entry. Exits inside the room (a stair, a hatch)
 * are in `exitsAt` only and the game handles them as its own verb. When there
 * is no open edge exit the layout is `sealed`, which is deliberate.
 *
 * Throws, in plain words, on a map that is not 20x15 or that uses a character
 * its legend does not define. Run `validateAdventure` first.
 */
export function locationLayout(a: Adventure, locationId: string, opts: LocationLayoutOptions = {}): LocationLayoutResult {
  const loc = locationOf(a, locationId);
  if (!loc) throw new Error(`There is no location "${locationId}" in the adventure "${a.id}".`);
  if (!mapShapeOk(loc)) throw new Error(`The map of "${locationId}" must be exactly ${CELL_HEIGHT} rows of ${CELL_WIDTH} characters.`);
  const legend = loc.map.legend ?? {};
  const progress = opts.progress ?? startProgress(a);
  const walkable = opts.walkable ?? defaultWalkable;
  const blocking = opts.blocking ?? (() => false);
  const here = opts.cell ?? { cx: 0, cy: 0 };

  const tiles: string[][] = [];
  const props: PlacedProp[] = [];
  const usedPropIds = new Set<string>();
  for (let y = 0; y < CELL_HEIGHT; y++) {
    const row = loc.map.rows[y]!;
    const tileRow: string[] = [];
    for (let x = 0; x < CELL_WIDTH; x++) {
      const entry = legend[row[x]!];
      if (!entry) throw new Error(`Row ${y + 1} of the map of "${locationId}" uses the character "${row[x]}" at column ${x + 1}, which the legend does not define.`);
      tileRow.push(entry.tile);
      if (!entry.prop) continue;
      const feature = entry.feature ? arr(loc.features).find((f) => f.id === entry.feature) : undefined;
      let id = feature?.id ?? `prop_${x}_${y}`;
      for (let n = 2; usedPropIds.has(id); n++) id = `${feature?.id ?? `prop_${x}_${y}`}_${n}`;
      usedPropIds.add(id);
      const prop: PlacedProp = { id, assetId: entry.prop, x, y };
      if (feature) {
        prop.label = feature.name;
        if (feature.searchDc !== undefined) prop.dc = feature.searchDc;
        if (feature.secret) prop.onFound = feature.secret;
        const first = arr(feature.gives)[0];
        if (first) prop.grantsItem = itemOf(a, first)?.name ?? first;
      }
      props.push(prop);
    }
    tiles.push(tileRow);
  }

  const scan = scanLocation(loc);
  const standable = (x: number, y: number) => {
    const t = tileAt(loc, x, y);
    if (!t || !walkable(t)) return false;
    const pr = propAt(loc, x, y);
    return !(pr && blocking(pr));
  };

  const start = scan.starts[0];
  const reserved = new Set<string>();
  if (start) reserved.add(key(start.x, start.y));
  const { placed } = placeInstances(
    loc,
    scan,
    standable,
    reserved,
    (s) => spawnIsPresent(a, progress, s),
    (id) => !progress.killed.includes(id),
  );

  const tokens: PlacedToken[] = placed.map((p) => ({
    id: p.instanceId,
    assetId: creatureTokenId(p.spawn.creature),
    x: p.at.x,
    y: p.at.y,
    kind: p.spawn.hostile ? "monster" : "npc",
  }));
  const spawnsAt: Record<string, XY[]> = {};
  for (const p of placed) (spawnsAt[p.spawn.id] ??= []).push(p.at);

  const exitsAt: Record<string, XY> = {};
  const exits: Exit[] = [];
  for (const ex of arr(loc.exits)) {
    const at = scan.byExit.get(ex.id)?.[0];
    if (!at) continue;
    exitsAt[ex.id] = at;
    const edge = edgeOfSquare(at);
    if (!edge) continue;
    if (ex.requires && !evaluate(a, progress, ex.requires)) continue;
    exits.push({ at: { x: at.x, y: at.y }, edge, toCell: neighbourCell(here, edge) });
  }

  const featuresAt: Record<string, XY> = {};
  for (const f of arr(loc.features)) {
    const at = scan.byFeature.get(f.id)?.[0];
    if (at) featuresAt[f.id] = at;
  }

  const layout: CellLayout = { tiles, props, tokens, exits };
  if (exits.length === 0) layout.sealed = true;
  const result: LocationLayoutResult = { layout, spawnsAt, exitsAt, featuresAt };
  if (start) result.start = start;
  return result;
}

/** Where an exit leaves the party: the target location and the square they arrive on (that location's start square, or the square of the exit it names). */
export function exitDestination(a: Adventure, fromLocationId: string, exitId: string): { locationId: string; at: XY } | undefined {
  const from = locationOf(a, fromLocationId);
  const exit = from ? arr(from.exits).find((e) => e.id === exitId) : undefined;
  const target = exit ? locationOf(a, exit.to) : undefined;
  if (!exit || !target) return undefined;
  const scan = scanLocation(target);
  const at = exit.arriveAt === "start" ? scan.starts[0] : scan.byExit.get(exit.arriveAt)?.[0];
  return at ? { locationId: target.id, at } : undefined;
}

// ---------------------------------------------------------------------------
// Validation

/**
 * Check an adventure. `assets` (the tile, prop and token ids the game really
 * has) makes the asset checks exact; `creatures` (known bestiary and token
 * ids) replaces the built-in bestiary as the list of creatures a spawn may
 * name. Without them, asset ids are not checked and creatures are checked
 * against the bestiary.
 */
export function validateAdventure(
  a: Adventure,
  assets?: AdventureAssets,
  creatures?: string[],
): { errors: AdventureIssue[]; warnings: AdventureIssue[] } {
  const errors: AdventureIssue[] = [];
  const warnings: AdventureIssue[] = [];
  const err = (path: string, message: string) => void errors.push({ path, message });
  const warn = (path: string, message: string) => void warnings.push({ path, message });

  const walkable = assets?.walkableTiles ? ((set) => (t: string) => set.has(t))(new Set(assets.walkableTiles)) : defaultWalkable;
  const blockingSet = new Set(assets?.blockingProps ?? []);
  const tileSet = assets ? new Set(assets.tiles) : undefined;
  const propSet = assets ? new Set(assets.props) : undefined;
  const tokenSet = assets ? new Set(assets.tokens) : undefined;
  const creatureSet = creatures ? new Set(creatures) : undefined;

  const locations = arr(a.locations);
  const scenes = arr(a.scenes);
  const npcs = arr(a.npcs);
  const items = arr(a.items);

  // ---- header ----
  if (!nonEmpty(a.id) || !ID_RE.test(a.id)) err("id", "The adventure needs an id of letters, digits, hyphens and underscores, starting with a letter or digit.");
  if (!nonEmpty(a.title)) err("title", "The adventure needs a title.");
  if (!nonEmpty(a.summary)) err("summary", "The adventure needs a summary.");
  if (!Number.isInteger(a.version) || a.version < 1) err("version", "The version must be a whole number, 1 or more.");
  if (a.author !== "owner" && a.author !== "ai") err("author", 'The author must be "owner" or "ai".');
  if (a.levelRange !== undefined) {
    const [lo, hi] = a.levelRange;
    if (!Array.isArray(a.levelRange) || a.levelRange.length !== 2 || !Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > 20 || lo > hi) {
      err("levelRange", "The level range must be two whole numbers from 1 to 20, lowest first.");
    }
  }
  if (arr(a.truths).length === 0) warn("truths", "The adventure lists no truths, so nothing is pinned down for the DM as fact.");
  for (const [field, list] of [["truths", a.truths], ["dmMust", a.dmMust], ["dmNever", a.dmNever]] as const) {
    arr(list).forEach((t, i) => {
      if (!nonEmpty(t)) err(`${field}[${i}]`, "This line is empty.");
    });
  }

  // ---- hooks and kits ----
  for (const k of Object.keys(a.hooks ?? {})) {
    if (k !== "default" && !(ADVENTURE_CHASSIS as readonly string[]).includes(k)) err(`hooks.${k}`, `"${k}" is not a class. Use fighter, rogue, cleric, wizard or default.`);
    else if (!nonEmpty((a.hooks as Record<string, string>)[k])) err(`hooks.${k}`, "This hook is empty.");
  }
  for (const [k, kit] of Object.entries(a.startingKit ?? {})) {
    const p = `startingKit.${k}`;
    if (k !== "default" && !(ADVENTURE_CHASSIS as readonly string[]).includes(k)) err(p, `"${k}" is not a class. Use fighter, rogue, cleric, wizard or default.`);
    if (!kit) continue;
    if (kit.armor !== "none" && kit.armor !== "class") err(`${p}.armor`, 'Armor must be "none" or "class".');
    if (!Array.isArray(kit.items)) err(`${p}.items`, "Items must be a list (it can be empty).");
    if (!Number.isInteger(kit.potions) || kit.potions < 0) err(`${p}.potions`, "Potions must be a whole number, 0 or more.");
  }
  for (const [field, map] of [["hooks", a.hooks], ["startingKit", a.startingKit]] as const) {
    const m = (map ?? {}) as Record<string, unknown>;
    if (m.default === undefined) {
      const missing = PLAYABLE_CHASSIS.filter((c) => m[c] === undefined);
      if (missing.length > 0) warn(field, `There is no default and no entry for ${missing.join(", ")}, so a hero of that class gets nothing from this.`);
    }
  }

  // ---- ids ----
  const countIds = (list: { id: string }[], path: string, what: string): Set<string> => {
    const seen = new Set<string>();
    list.forEach((x, i) => {
      if (!nonEmpty(x?.id) || !ID_RE.test(x.id)) {
        err(`${path}[${i}].id`, `This ${what} needs an id of letters, digits, hyphens and underscores.`);
        return;
      }
      if (seen.has(x.id)) err(`${path}[${i}].id`, `Two ${what}s share the id "${x.id}".`);
      seen.add(x.id);
    });
    return seen;
  };
  const locIds = countIds(locations, "locations", "location");
  const sceneIds = countIds(scenes, "scenes", "scene");
  const npcIds = countIds(npcs, "npcs", "NPC");
  const itemIds = countIds(items, "items", "item");

  const allObjectives = scenes.flatMap((s) => arr(s.objectives).map((o) => ({ o, sceneId: s.id })));
  const objIds = new Set<string>();
  allObjectives.forEach(({ o, sceneId }) => {
    const p = `scenes.${sceneId}.objectives.${o?.id}`;
    if (!nonEmpty(o?.id) || !ID_RE.test(o.id)) err(p, "This objective needs an id of letters, digits, hyphens and underscores.");
    else if (objIds.has(o.id)) err(p, `Two objectives share the id "${o.id}". Objective ids are unique across the whole adventure.`);
    else objIds.add(o.id);
  });
  const beatIds = new Set<string>();
  const worldBeats = arr(a.world?.beats);
  const worldNext = arr(a.world?.next);
  const beatPlaces = [...scenes.flatMap((s) => arr(s.beats).map((b) => ({ b, p: `scenes.${s.id}.beats.${b?.id}` }))), ...worldBeats.map((b) => ({ b, p: `world.beats.${b?.id}` }))];
  for (const { b, p } of beatPlaces) {
    if (!nonEmpty(b?.id) || !ID_RE.test(b.id)) err(p, "This beat needs an id of letters, digits, hyphens and underscores.");
    else if (beatIds.has(b.id)) err(p, `Two beats share the id "${b.id}". Beat ids are unique across the whole adventure.`);
    else beatIds.add(b.id);
  }

  const spawnList = allSpawns({ ...a, locations });
  const spawnIds = new Set<string>();
  const instanceIds = new Set<string>();
  for (const { spawn, locationId } of spawnList) {
    const p = `locations.${locationId}.spawns.${spawn?.id}`;
    if (!nonEmpty(spawn?.id) || !ID_RE.test(spawn.id)) {
      err(p, "This spawn needs an id of letters, digits, hyphens and underscores.");
      continue;
    }
    if (spawnIds.has(spawn.id) || instanceIds.has(spawn.id)) err(p, `The id "${spawn.id}" is used twice among creatures. Spawn ids are unique across the whole adventure.`);
    spawnIds.add(spawn.id);
    if (spawn.count !== undefined && (!Number.isInteger(spawn.count) || spawn.count < 1 || spawn.count > MAX_SPAWN_COUNT)) {
      err(`${p}.count`, `The count must be a whole number from 1 to ${MAX_SPAWN_COUNT}.`);
      continue;
    }
    for (const id of spawnInstanceIds(spawn)) {
      if (id !== spawn.id && (spawnIds.has(id) || instanceIds.has(id))) err(p, `The creature id "${id}" (from the group "${spawn.id}") clashes with another id.`);
      instanceIds.add(id);
    }
  }

  // ---- conditions ----
  const flagsSet = new Set<string>();
  const flagsRead = new Set<string>();
  const checkCond = (c: Condition | undefined, path: string, depth = 0): void => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return void err(path, "This is not a condition.");
    if (depth > MAX_CONDITION_DEPTH) return void err(path, "This condition is nested too deeply to follow.");
    const keys = Object.keys(c);
    if (keys.length !== 1) {
      return void err(path, `A condition has exactly one of flag, all, any, not, killed, entered, talkedTo, has, objective, day, always. This one has ${keys.length === 0 ? "none" : keys.join(", ")}.`);
    }
    if ("always" in c) {
      if (c.always !== true) err(path, "always must be true.");
    } else if ("flag" in c) {
      if (!nonEmpty(c.flag)) err(path, "This flag name is empty.");
      else flagsRead.add(c.flag);
    } else if ("all" in c) {
      if (!Array.isArray(c.all)) return void err(path, "all needs a list of conditions.");
      if (c.all.length === 0) warn(path, "An empty all is always true.");
      c.all.forEach((x, i) => checkCond(x, `${path}.all[${i}]`, depth + 1));
    } else if ("any" in c) {
      if (!Array.isArray(c.any)) return void err(path, "any needs a list of conditions.");
      if (c.any.length === 0) warn(path, "An empty any is never true.");
      c.any.forEach((x, i) => checkCond(x, `${path}.any[${i}]`, depth + 1));
    } else if ("not" in c) {
      checkCond(c.not, `${path}.not`, depth + 1);
    } else if ("killed" in c) {
      const ref = c.killed;
      if (!nonEmpty(ref)) err(path, "killed names no creature.");
      else if (ref.startsWith("all:")) {
        if (!spawnList.some((s) => s.spawn.id?.startsWith(ref.slice(4)))) err(path, `No spawn id starts with "${ref.slice(4)}", so "${ref}" can never be true.`);
      } else if (!spawnIds.has(ref) && !instanceIds.has(ref)) err(path, `"${ref}" is not a spawn or creature in this adventure.`);
    } else if ("entered" in c) {
      if (!locIds.has(c.entered)) err(path, `"${c.entered}" is not a location in this adventure.`);
    } else if ("talkedTo" in c) {
      if (!npcIds.has(c.talkedTo)) err(path, `"${c.talkedTo}" is not an NPC in this adventure.`);
    } else if ("has" in c) {
      if (!itemIds.has(c.has)) err(path, `"${c.has}" is not an item in this adventure.`);
    } else if ("objective" in c) {
      if (!objIds.has(c.objective)) err(path, `"${c.objective}" is not an objective in this adventure.`);
    } else if ("day" in c) {
      if (!Number.isInteger(c.day) || c.day < 1) err(path, `A day is a whole number from 1 (the first day), not ${JSON.stringify(c.day)}.`);
    } else {
      err(path, "This is not a condition the adventure understands.");
    }
  };

  // ---- items ----
  const givenNames = new Set<string>();
  const noteGiven = (names: string[] | undefined) => {
    for (const n of arr(names)) {
      const it = itemOf({ ...a, items }, n);
      givenNames.add(it ? it.id : n);
    }
  };
  for (const kit of Object.values(a.startingKit ?? {})) noteGiven(kit?.items);
  items.forEach((it) => {
    const p = `items.${it?.id}`;
    if (!nonEmpty(it?.name)) err(`${p}.name`, "This item needs a name.");
    if (!nonEmpty(it?.description)) err(`${p}.description`, "This item needs a description.");
    if (it?.usable && !nonEmpty(it.useSay)) warn(p, "This item is usable but has no useSay, so there is nothing for the game to say when it is used.");
    if (!it?.usable && nonEmpty(it?.useSay)) warn(p, "This item has a useSay but is not marked usable, so it is never said.");
  });

  // ---- npcs ----
  npcs.forEach((n, i) => {
    const p = `npcs.${n?.id ?? i}`;
    if (!nonEmpty(n?.name)) err(`${p}.name`, "This NPC needs a name.");
    if (!nonEmpty(n?.role)) err(`${p}.role`, "This NPC needs a role.");
    if (!nonEmpty(n?.personality)) err(`${p}.personality`, "This NPC needs a personality.");
    if (!nonEmpty(n?.token)) err(`${p}.token`, "This NPC needs a token (the picture that stands for them).");
    else if (n.token.startsWith("gear_")) err(`${p}.token`, `"${n.token}" is a piece of equipment, not a character.`);
    else if (tokenSet && !tokenSet.has(n.token)) err(`${p}.token`, `There is no token picture called "${n.token}".`);
    if (n?.location !== undefined && !locIds.has(n.location)) err(`${p}.location`, `"${n.location}" is not a location in this adventure.`);
    if (arr(n?.knows).length === 0) warn(`${p}.knows`, "This NPC knows nothing to tell the party.");
    const placed = spawnList.some((s) => s.spawn.npcId === n?.id) || n?.location !== undefined;
    if (!placed) warn(p, "This NPC is never placed: no spawn uses them and they have no location.");
  });

  // ---- locations ----
  const scans = new Map<string, LocScan>();
  locations.forEach((loc, li) => {
    const lp = `locations.${loc?.id ?? li}`;
    if (!nonEmpty(loc?.name)) err(`${lp}.name`, "This location needs a name.");
    if (!nonEmpty(loc?.readAloud)) err(`${lp}.readAloud`, "This location needs a read-aloud description.");
    const features = arr(loc.features);
    const spawns = arr(loc.spawns);
    const exits = arr(loc.exits);
    const featureIds = countIds(features, `${lp}.features`, "feature");
    const spawnLocal = new Set(spawns.map((s) => s?.id));
    const exitLocal = countIds(exits, `${lp}.exits`, "exit");

    // map shape
    const rows = loc.map?.rows;
    let shapeOk = true;
    if (!Array.isArray(rows)) {
      err(`${lp}.map.rows`, "This location has no map rows.");
      shapeOk = false;
    } else {
      if (rows.length !== CELL_HEIGHT) {
        err(`${lp}.map.rows`, `The map needs exactly ${CELL_HEIGHT} rows, this one has ${rows.length}.`);
        shapeOk = false;
      }
      rows.forEach((r, y) => {
        if (typeof r !== "string" || r.length !== CELL_WIDTH) {
          err(`${lp}.map.rows[${y}]`, `Row ${y + 1} needs exactly ${CELL_WIDTH} characters, this one has ${typeof r === "string" ? r.length : 0}.`);
          shapeOk = false;
        }
      });
    }

    // legend
    const legend = loc.map?.legend ?? {};
    const usedChars = new Set<string>();
    if (shapeOk) {
      (rows as string[]).forEach((r, y) => {
        const reported = new Set<string>();
        for (let x = 0; x < r.length; x++) {
          const ch = r[x]!;
          usedChars.add(ch);
          if (!legend[ch] && !reported.has(ch)) {
            reported.add(ch);
            err(`${lp}.map.rows[${y}]`, `Row ${y + 1}, column ${x + 1} uses "${ch}", which the legend does not define.`);
          }
        }
      });
    }
    for (const [ch, entry] of Object.entries(legend)) {
      const ep = `${lp}.map.legend["${ch}"]`;
      if (ch.length !== 1) err(ep, `A legend key is exactly one character, "${ch}" is ${ch.length}.`);
      if (shapeOk && !usedChars.has(ch)) warn(ep, `"${ch}" is in the legend but never used in the map.`);
      if (!nonEmpty(entry?.tile)) err(`${ep}.tile`, "A legend entry needs a floor tile.");
      else if (tileSet && !tileSet.has(entry.tile)) err(`${ep}.tile`, `There is no floor tile called "${entry.tile}".`);
      if (entry?.prop !== undefined && propSet && !propSet.has(entry.prop)) err(`${ep}.prop`, `There is no prop called "${entry.prop}".`);
      if (entry?.feature !== undefined && !featureIds.has(entry.feature)) err(`${ep}.feature`, `"${entry.feature}" is not a feature of ${loc.name}.`);
      if (entry?.spawn !== undefined && !spawnLocal.has(entry.spawn)) err(`${ep}.spawn`, `"${entry.spawn}" is not a spawn of ${loc.name}.`);
      if (entry?.exit !== undefined && !exitLocal.has(entry.exit)) err(`${ep}.exit`, `"${entry.exit}" is not an exit of ${loc.name}.`);
    }

    const scan = scanLocation(loc);
    scans.set(loc.id, scan);
    if (scan.starts.length > 1) err(`${lp}.map`, `The map marks ${scan.starts.length} start squares. A location has at most one.`);
    if (!scan.ok) return; // the squares cannot be trusted; the shape errors above say why

    const isBlocked = (x: number, y: number) => {
      const pr = propAt(loc, x, y);
      return pr !== undefined && blockingSet.has(pr);
    };
    const standable = (x: number, y: number) => {
      const t = tileAt(loc, x, y);
      return t !== undefined && walkable(t) && !isBlocked(x, y);
    };
    const describe = (at: XY) => `(${at.x + 1}, ${at.y + 1})`;

    // start
    const start = scan.starts[0];
    if (start && !standable(start.x, start.y)) err(`${lp}.map`, `The start square ${describe(start)} is not somewhere a hero can stand.`);

    // exits
    exits.forEach((ex) => {
      const p = `${lp}.exits.${ex?.id}`;
      if (!nonEmpty(ex?.label)) err(`${p}.label`, "This exit needs a label.");
      const target = locations.find((l) => l.id === ex?.to);
      if (!target) err(`${p}.to`, `"${ex?.to}" is not a location in this adventure.`);
      else if (ex.arriveAt === "start") {
        // Checked below, once every location has been scanned.
      } else if (!arr(target.exits).some((e) => e.id === ex.arriveAt)) {
        err(`${p}.arriveAt`, `"${ex.arriveAt}" is not an exit of ${target.name}. Name one of its exits, or "start".`);
      }
      if (ex?.requires !== undefined) {
        checkCond(ex.requires, `${p}.requires`);
        if (!nonEmpty(ex.lockedText)) warn(p, "This exit can be shut but has no lockedText to say what the party finds.");
      }
      const spots = scan.byExit.get(ex?.id) ?? [];
      if (spots.length === 0) err(p, `This exit is never placed on the map. Put its legend character on the square it should be at.`);
      else {
        if (spots.length > 1) warn(p, `This exit is placed on ${spots.length} squares; only the first ${describe(spots[0]!)} is used.`);
        const at = spots[0]!;
        if (!standable(at.x, at.y)) err(p, `This exit's square ${describe(at)} is not somewhere anyone can stand, so nothing could ever use it.`);
      }
    });

    // features
    features.forEach((f) => {
      const p = `${lp}.features.${f?.id}`;
      if (!nonEmpty(f?.name)) err(`${p}.name`, "This feature needs a name.");
      if (!nonEmpty(f?.description)) err(`${p}.description`, "This feature needs a description.");
      if (f?.searchDc !== undefined && (!Number.isInteger(f.searchDc) || f.searchDc < 1 || f.searchDc > 30)) {
        err(`${p}.searchDc`, "The search DC must be a whole number from 1 to 30.");
      }
      const searchable = f?.secret !== undefined || arr(f?.gives).length > 0;
      if (f?.secret !== undefined && f.searchDc === undefined) warn(p, "This feature has a secret but no searchDc, so the game cannot set a difficulty for finding it.");
      if (f?.searchDc !== undefined && !searchable) warn(p, "This feature has a searchDc but nothing to find (no secret, no gives).");
      if (arr(f?.gives).length > 1) warn(`${p}.gives`, "A search hands over one item per feature in the game's engine; only the first is given.");
      noteGiven(f?.gives);
      const spots = scan.byFeature.get(f?.id) ?? [];
      if (spots.length === 0) warn(p, "This feature is never placed on the map.");
      else {
        if (spots.length > 1) warn(p, `This feature is placed on ${spots.length} squares; only the first ${describe(spots[0]!)} is used.`);
        if (searchable) {
          const at = spots[0]!;
          if (!propAt(loc, at.x, at.y)) warn(p, "This feature has something to find but no prop on its square, so there is nothing on the map to search.");
        }
      }
    });

    // spawns
    spawns.forEach((s) => {
      const p = `${lp}.spawns.${s?.id}`;
      if (typeof s?.hostile !== "boolean") err(`${p}.hostile`, "hostile must be true or false.");
      if (typeof s?.awake !== "boolean") err(`${p}.awake`, "awake must be true or false.");
      if (!nonEmpty(s?.creature)) {
        err(`${p}.creature`, "This spawn names no creature.");
      } else {
        const known = creatureSet
          ? creatureSet.has(s.creature) || (tokenSet?.has(s.creature) ?? false)
          : beastById(s.creature) !== undefined || s.creature.startsWith("token_");
        if (!known) {
          const hint = creatureSet ? "" : ` Known creatures include ${BESTIARY.slice(0, 6).map((b) => b.id).join(", ")} and more.`;
          err(`${p}.creature`, `"${s.creature}" is not a creature the game knows.${hint}`);
        } else if (s.creature.startsWith("gear_")) {
          err(`${p}.creature`, `"${s.creature}" is a piece of equipment, not a creature.`);
        } else if (tokenSet && !tokenSet.has(creatureTokenId(s.creature))) {
          err(`${p}.creature`, `"${s.creature}" has no picture yet (the game would look for "${creatureTokenId(s.creature)}").`);
        }
      }
      if (s?.npcId !== undefined) {
        const npc = npcs.find((n) => n.id === s.npcId);
        if (!npc) err(`${p}.npcId`, `"${s.npcId}" is not an NPC in this adventure.`);
        else if (nonEmpty(s.creature) && npc.token !== creatureTokenId(s.creature)) warn(`${p}.npcId`, `This spawn's picture is "${creatureTokenId(s.creature)}" but the NPC's token is "${npc.token}".`);
      }
      if (s?.appearsWhen !== undefined) checkCond(s.appearsWhen, `${p}.appearsWhen`);
      const spots = scan.bySpawn.get(s?.id) ?? [];
      if (spots.length === 0) err(p, "This spawn is never placed on the map. Put its legend character on a square.");
      for (const at of spots) {
        if (start && start.x === at.x && start.y === at.y) err(p, `This spawn stands on the hero's start square ${describe(at)}.`);
        if (!standable(at.x, at.y)) err(p, `This spawn is placed at ${describe(at)}, which is not somewhere a creature can stand.`);
      }
      const n = Math.max(1, Math.floor(s?.count ?? 1));
      if (spots.length > n) warn(p, `This spawn is marked on ${spots.length} squares but has a count of ${n}; the extra squares are ignored.`);
    });

    // room for groups
    if (spawns.length > 0 && spawns.every((s) => Number.isInteger(s?.count ?? 1) && (s?.count ?? 1) >= 1)) {
      const reserved = new Set<string>();
      if (start) reserved.add(key(start.x, start.y));
      const { missing } = placeInstances(loc, scan, standable, reserved, () => true, () => true);
      for (const m of missing) err(`${lp}.spawns.${m.spawn.id}`, `There is no free floor near this spawn for ${m.count} of its ${spawnInstanceIds(m.spawn).length} creatures.`);
    }

    // everything connected to where the party arrives
    const entry = start ?? scan.byExit.values().next().value?.[0];
    if (entry) {
      const seen = new Set<string>([key(entry.x, entry.y)]);
      const queue: XY[] = [entry];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= CELL_WIDTH || ny >= CELL_HEIGHT || seen.has(key(nx, ny))) continue;
          const t = tileAt(loc, nx, ny);
          if (t === undefined || !walkable(t)) continue;
          seen.add(key(nx, ny));
          queue.push({ x: nx, y: ny });
        }
      }
      const cut = (label: string, spots: XY[] | undefined, p: string) => {
        const at = spots?.[0];
        if (at && !seen.has(key(at.x, at.y))) warn(p, `${label} at ${describe(at)} cannot be walked to from where the party arrives.`);
      };
      for (const e of exits) cut("This exit", scan.byExit.get(e?.id), `${lp}.exits.${e?.id}`);
      for (const f of features) cut("This feature", scan.byFeature.get(f?.id), `${lp}.features.${f?.id}`);
      for (const s of spawns) cut("This spawn", scan.bySpawn.get(s?.id), `${lp}.spawns.${s?.id}`);
    }
  });

  // arriving at "start" needs a start square there; and an exit's own check of the target
  for (const loc of locations) for (const ex of arr(loc.exits)) {
    if (ex?.arriveAt !== "start") continue;
    const target = locations.find((l) => l.id === ex.to);
    const scan = target ? scans.get(target.id) : undefined;
    if (target && scan && scan.ok && scan.starts.length === 0) err(`locations.${loc.id}.exits.${ex.id}.arriveAt`, `${target.name} has no start square for this exit to arrive at. Mark one in its legend with start: true.`);
  }

  // ---- the start ----
  const startLoc = locations.find((l) => l.id === a.start?.locationId);
  if (!a.start) err("start", "The adventure needs a start (scene, location and square).");
  else {
    if (!sceneIds.has(a.start.sceneId)) err("start.sceneId", `"${a.start.sceneId}" is not a scene in this adventure.`);
    if (!startLoc) err("start.locationId", `"${a.start.locationId}" is not a location in this adventure.`);
    const at = a.start.at;
    if (!at || !Number.isInteger(at.x) || !Number.isInteger(at.y) || at.x < 0 || at.y < 0 || at.x >= CELL_WIDTH || at.y >= CELL_HEIGHT) {
      err("start.at", `The start square must be inside the ${CELL_WIDTH} by ${CELL_HEIGHT} map.`);
    } else if (startLoc) {
      const scan = scans.get(startLoc.id);
      if (scan && scan.ok) {
        if (scan.starts.length !== 1) err(`locations.${startLoc.id}.map`, `The start location needs exactly one start square, this map marks ${scan.starts.length}.`);
        else if (scan.starts[0]!.x !== at.x || scan.starts[0]!.y !== at.y) {
          err("start.at", `The start square is (${at.x + 1}, ${at.y + 1}) but the map marks (${scan.starts[0]!.x + 1}, ${scan.starts[0]!.y + 1}).`);
        }
        const t = tileAt(startLoc, at.x, at.y);
        if (t === undefined || !walkable(t)) err("start.at", "The hero cannot stand on the start square: it is not walkable.");
      }
    }
    const startScene = scenes.find((s) => s.id === a.start.sceneId);
    if (startScene?.location !== undefined && startScene.location !== a.start.locationId) {
      warn("start.sceneId", "The first scene is set in a different location from the one the hero starts in.");
    }
  }

  // ---- scenes and the world ----
  const checkBeat = (b: AdventureBeat, bp: string): void => {
    checkCond(b?.when, `${bp}.when`);
    for (const f of arr(b?.setFlags)) {
      if (!nonEmpty(f)) err(`${bp}.setFlags`, "A flag name is empty.");
      else flagsSet.add(f);
    }
    for (const sid of arr(b?.spawn)) if (!spawnIds.has(sid)) err(`${bp}.spawn`, `"${sid}" is not a spawn in this adventure.`);
    noteGiven(b?.give);
    if (!nonEmpty(b?.narrate) && arr(b?.setFlags).length === 0 && arr(b?.give).length === 0 && arr(b?.spawn).length === 0) {
      warn(bp, "This beat does nothing: no narration, flags, items or spawns.");
    }
  };
  const checkNext = (n: { scene: string; when: Condition }, np: string): void => {
    if (!sceneIds.has(n?.scene)) err(`${np}.scene`, `"${n?.scene}" is not a scene in this adventure.`);
    checkCond(n?.when, `${np}.when`);
  };
  worldBeats.forEach((b) => checkBeat(b, `world.beats.${b?.id}`));
  worldNext.forEach((n, i) => checkNext(n, `world.next[${i}]`));

  scenes.forEach((s) => {
    const sp = `scenes.${s?.id}`;
    if (!nonEmpty(s?.title)) err(`${sp}.title`, "This scene needs a title.");
    if (s?.location !== undefined && !locIds.has(s.location)) err(`${sp}.location`, `"${s.location}" is not a location in this adventure.`);
    for (const o of arr(s?.objectives)) {
      if (!nonEmpty(o?.text)) err(`${sp}.objectives.${o?.id}.text`, "This objective needs text.");
      checkCond(o?.doneWhen, `${sp}.objectives.${o?.id}.doneWhen`);
    }
    for (const b of arr(s?.beats)) checkBeat(b, `${sp}.beats.${b?.id}`);
    arr(s?.next).forEach((n, i) => checkNext(n, `${sp}.next[${i}]`));
    if (s?.ending !== undefined) {
      if (!nonEmpty(s.ending.text)) err(`${sp}.ending.text`, "The ending needs text.");
      if (!["victory", "defeat", "continue"].includes(s.ending.outcome)) err(`${sp}.ending.outcome`, 'The outcome must be "victory", "defeat" or "continue".');
      if (arr(s.next).length > 0 && s.ending.outcome !== "continue") warn(sp, "This scene ends the adventure but also lists ways out, which will never be taken.");
    } else if (arr(s?.next).length === 0) {
      warn(sp, "This scene has no ending and no way out, so the story stops here with nowhere to go.");
    }
  });
  if (scenes.length === 0) err("scenes", "The adventure needs at least one scene.");
  else if (!scenes.some((s) => s.ending && (s.ending.outcome === "victory" || s.ending.outcome === "defeat"))) {
    warn("scenes", "No scene ends the adventure in victory or defeat, so it can never be finished.");
  }

  // reachability of scenes and locations
  if (sceneIds.has(a.start?.sceneId)) {
    // The world's ways out can be taken from any scene, so their targets are reachable from the start.
    const reach = new Set<string>([a.start.sceneId, ...worldNext.map((n) => n?.scene).filter((id) => sceneIds.has(id))]);
    const queue = [...reach];
    while (queue.length > 0) {
      const id = queue.shift();
      const cur = scenes.find((s) => s.id === id);
      for (const n of arr(cur?.next)) if (n?.scene && !reach.has(n.scene)) {
        reach.add(n.scene);
        queue.push(n.scene);
      }
    }
    for (const s of scenes) if (!reach.has(s.id)) warn(`scenes.${s.id}`, "No path of scene transitions from the first scene ever reaches this scene.");
  }
  if (startLoc) {
    const reach = new Set<string>([startLoc.id]);
    const queue = [startLoc.id];
    while (queue.length > 0) {
      const id = queue.shift();
      const cur = locations.find((l) => l.id === id);
      for (const e of arr(cur?.exits)) if (e?.to && locIds.has(e.to) && !reach.has(e.to)) {
        reach.add(e.to);
        queue.push(e.to);
      }
    }
    for (const l of locations) if (!reach.has(l.id)) warn(`locations.${l.id}`, "No chain of exits from the start location ever leads here.");
  }

  // flags and quest items
  for (const f of flagsSet) if (!flagsRead.has(f)) warn(`flags.${f}`, `The flag "${f}" is set by a beat but no condition ever checks it. Is it spelled the same everywhere?`);
  for (const it of items) if (it?.quest && !givenNames.has(it.id) && !givenNames.has(it.name)) {
    warn(`items.${it.id}`, "This is a quest item but nothing in the adventure ever hands it over.");
  }

  return { errors, warnings };
}
