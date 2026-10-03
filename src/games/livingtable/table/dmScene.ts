/**
 * The DM's side of the scene (dmCore.ts is the model and the validation;
 * this is the room). The DM knows everything, so the view below is the whole
 * scene as a char grid plus every feature with its secret. What it may CHANGE is
 * a closed list of effects, each applied by the engine and each refusable: a
 * refusal never throws and never pops up, it is a plain log line and a note the
 * DM reads next turn. Dice (a check, a heal, a harm) are rolled in the tray by
 * the window, never here.
 *
 * Copied from the bench's Play panel. The picture ids the DM may place and the
 * walkability of each tile come from the bound catalog (catalog.ts: dmAssets,
 * walkableById) instead of constants built from the bench's sprite arrays.
 * Import-pure: nothing runs until a function is called.
 */
import { adventureBrief } from "../adventures/brief";
import { allowedDmSteps } from "../adventures/progress";
import { type Adventure, type Chassis, itemOf } from "../adventures/types";
import { GEAR_ROLES, LOOT_CAP_LINE } from "../characters/equipmentTypes";
import type { TemplateGenre } from "../characters/templates";
import { packInfo } from "../inventory/itemInfo";
import { activeCombatant, dropCombatant, hasHostiles } from "../menu/combatRound";
import { packItems } from "../menu/equipment";
import { hitPoints, sentenceCase } from "../menu/labels";
import { applyDisplayTiles } from "../render/terrainEdges";
import { damageMonster, effectiveArmorClass, effectiveSpeedFt, monsterArmorClassFor, skillModifierFor, statblockFor } from "../session/combat";
import type { CombatEvent } from "../session/combatEvents";
import type { TileId } from "../world/cell";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import {
  advApply,
  advBoard,
  adventureOf,
  advHolds,
  advPropWords,
  containerAt,
  currentLocation,
  doorAt,
  exitOn,
  featureIsFound,
  giveAdventureItem,
  npcOf,
  rollLoot,
  sceneProps,
  sceneTiles,
} from "./adventureRun";
import { dmAssets, walkableById, worldManifest } from "./catalog";
import type { DmEffect, DmSceneView } from "./dmCore";
import { slayCreature } from "./fightRules";
import { foldItem, forgetItem, itemName, pileAt, wornTier } from "./gearLoot";
import { activeCreature, creatureInSight, creaturesInSight, heroActionReady, heroesTurn, seesTile, sightLevel } from "./sight";
import {
  addCreature,
  CONTAINER_AT,
  type Creature,
  CREATURE_CAP,
  creatureAt,
  creatureById,
  creatureLabel,
  creatureName,
  DIVIDER_X,
  DM_INVENTORY_MAX,
  DM_POTION_CAP,
  DM_PROPS_MAX,
  DM_RECENT_SHOWN,
  DOOR_AT,
  DRAIN_TILE,
  type LogLine,
  type PlayState,
  same,
  SCENE_KIT,
  type XY,
} from "./state";
import { featureList } from "./ui/sheet";

// ---------------------------------------------------------------------------
// The DM's side of the scene (dmCore.ts is the model and the validation; this is
// the room). The DM knows everything, so the view below is the whole scene
// as a char grid plus every feature with its secret. What it may CHANGE is a
// closed list of effects, each applied by the engine and each refusable: a
// refusal never throws and never pops up, it is a plain log line and a note the
// DM reads next turn. Dice (a check, a heal, a harm) are rolled in the tray by
// the panel, never here.
// ---------------------------------------------------------------------------

/**
 * What the DM may place in this scene: the catalog's props and tiles minus the ones it may not touch (catalog.ts DM_PROP_SKIP and
 * DM_TILE_SKIP: doors, chests, the edge and join pieces the renderer picks on its own), and the scene's own pair of monsters (the kit's).
 */
export function dmAssetsFor(template: TemplateGenre): DmSceneView["assets"] {
  const kit = SCENE_KIT[template];
  return dmAssets(template, [kit.monster, kit.second]);
}

/** The tiles as the player SEES them (the renderer's own display pass, seed 0), so a grate that is only a scattered variant is still a grate the DM knows about. */
let displayCache: { key: string; tiles: TileId[][] } | null = null;
export function displayTiles(p: PlayState): TileId[][] {
  const key = `${p.template}|${p.floorId}|${p.worldRev}|${p.boardEpoch}`;
  if (displayCache?.key === key) return displayCache.tiles;
  const m = worldManifest(p.template);
  const tiles = applyDisplayTiles(sceneTiles(p), (id) => m.tiles[id] !== undefined, 0, { props: sceneProps(p), hasProp: (id) => m.props[id] !== undefined });
  displayCache = { key, tiles };
  return tiles;
}

/** Whether the square is a drain grate, by the stored tile or by what is drawn there. */
export function isGrate(p: PlayState, at: XY): boolean {
  // In an adventure a drain grate is only a variant the renderer scatters on stone floor: the story does not know of it, so neither does the DM.
  if (p.adventureId) return false;
  const grate = DRAIN_TILE[p.template];
  return sceneTiles(p)[at.y]?.[at.x] === grate || displayTiles(p)[at.y]?.[at.x] === grate;
}

export const grateId = (at: XY): string => `drain-${at.x}-${at.y}`;
const tileChangeId = (at: XY): string => `tile-${at.x}-${at.y}`;

/** A tile in the player's words ("the stone wall"). */
function tileWords(id: TileId): string {
  if (/^wall_stone/.test(id)) return "the stone wall";
  if (/^wall_bulkhead/.test(id)) return "the bulkhead";
  if (/^water/.test(id)) return "the water";
  if (/^floor_stone_drain|^floor_grating/.test(id)) return "the drain grate";
  if (/^floor_stone_cracked/.test(id)) return "the cracked flagstones";
  if (/^floor_stone/.test(id)) return "the stone floor";
  if (/^floor_grass/.test(id)) return "the grass";
  if (/^floor_dirt/.test(id)) return "the packed dirt";
  if (/^floor_sand/.test(id)) return "the sand";
  if (/^floor_deckplate/.test(id)) return "the deck plating";
  if (/^forest_canopy/.test(id)) return "the thick canopy";
  if (/^cliff_face/.test(id)) return "the cliff face";
  if (/^cliff_top/.test(id)) return "the cliff top";
  return `the ${id.replace(/_/g, " ")}`;
}

/** What is on a square, in the words an examine sends: the hero, a creature (only while it is in sight), the door, the chest, a DM prop, a grate, then the ground. */
export function whatIsAt(p: PlayState, at: XY): string {
  const kit = SCENE_KIT[p.template];
  if (same(at, p.heroAt)) return "yourself";
  const there = creatureAt(p, at);
  if (there && creatureInSight(p, there)) return creatureLabel(p, there);
  if (same(at, doorAt(p))) return kit.doorLabel;
  if (same(at, containerAt(p))) return kit.containerLabel;
  const body = p.bodies.find((b) => same(b.at, at));
  if (body) return `the ${body.name.toLowerCase()}'s body`;
  if (pileAt(p, at)) return "the things lying on the ground";
  const prop = p.extraProps.find((e) => same(e, at));
  if (prop) return prop.label;
  const placed = p.adventureId ? advPropWords(p, at) : null;
  if (placed) return placed;
  if (isGrate(p, at)) return "the drain grate";
  const tile = sceneTiles(p)[at.y]?.[at.x];
  if (tile && walkableById(p.template).get(tile) === true) return tile === p.floorId || /^floor_stone/.test(tile) ? "the floor" : tileWords(tile);
  return tile ? tileWords(tile) : "the floor";
}

/** The feature the examine/left-click shortcut treats as lookable: a grate or a DM prop (the door and chest keep their Use). */
export function lookableAt(p: PlayState, at: XY): "grate" | "prop" | null {
  if (p.extraProps.some((e) => same(e, at))) return "prop";
  if (isGrate(p, at) && !same(at, doorAt(p)) && !same(at, containerAt(p))) return "grate";
  return null;
}

/** A tile change's own feature, grates and the rest in one list, for the DM. */
function dmFeatures(p: PlayState): DmSceneView["features"] {
  const kit = SCENE_KIT[p.template];
  const seen = (at: XY): boolean => sightLevel(p, at) > 0;
  const out: DmSceneView["features"] = [];
  const add = (f: DmSceneView["features"][number]): void => {
    out.push(f);
  };
  const withSecret = <T extends object>(id: string, base: T): T & { secret?: string } => (p.propSecrets[id] ? { ...base, secret: p.propSecrets[id]! } : base);
  if (!p.adventureId) {
    add(withSecret("door", { id: "door", x: DOOR_AT.x, y: DOOR_AT.y, what: kit.doorLabel, asset: p.doorOpen ? kit.doorOpen : kit.doorClosed, state: p.doorOpen ? "open" : p.doorLocked ? "closed and locked" : "closed", seen: seen(DOOR_AT) }));
    add(
      withSecret("container", {
        id: "container",
        x: CONTAINER_AT.x,
        y: CONTAINER_AT.y,
        what: kit.containerLabel,
        asset: p.searched && kit.containerOpened ? kit.containerOpened : kit.container,
        state: p.searched ? "already opened and emptied" : "unopened (the engine rolls what is inside when the hero opens it; never invent its contents)",
        seen: seen(CONTAINER_AT),
      }),
    );
  }
  // The adventure's own features (a heap of sacks, a hoard chest): what the hero can see of them, never their secrets until they are found.
  const board = advBoard(p);
  for (const f of currentLocation(p)?.features ?? []) {
    const at = board?.featuresAt[f.id];
    if (!at) continue;
    const prop = board!.props.find((q) => same(q, at));
    add({ id: f.id, x: at.x, y: at.y, what: f.name, asset: prop?.assetId ?? "", state: featureIsFound(p, f) ? "already searched" : f.description, seen: seen(at) });
  }
  for (let y = 1; y < CELL_HEIGHT - 1; y++) {
    for (let x = 1; x < CELL_WIDTH - 1; x++) {
      const at = { x, y };
      if (!isGrate(p, at) || same(at, doorAt(p)) || same(at, containerAt(p))) continue;
      const id = grateId(at);
      add(withSecret(id, { id, x, y, what: "a drain grate in the floor", asset: DRAIN_TILE[p.template], seen: seen(at) }));
    }
  }
  for (const e of p.extraProps) add({ id: e.id, x: e.x, y: e.y, what: e.label, asset: e.assetId, seen: seen(e), ...(e.secret ? { secret: e.secret } : {}) });
  for (const o of p.tileOverrides) {
    const at = { x: o.x, y: o.y };
    add({ id: tileChangeId(at), x: o.x, y: o.y, what: `changed terrain: ${tileWords(o.tile)}`, asset: o.tile, seen: seen(at) });
  }
  return out;
}

/**
 * Who the hero is, for the DM (character creation): ancestry, background,
 * alignment, personality, backstory, traits (with whether the engine applies
 * each) and languages, plus what each thing carried is, in the same words the
 * player reads on hover. Only what the sheet actually has: a quick-picked hero
 * has no ancestry or background and adds nothing, so its prompt is unchanged
 * except for the item lines.
 */
function heroIdentityFor(p: PlayState): Partial<DmSceneView["hero"]> {
  const h = p.hero;
  const out: Partial<DmSceneView["hero"]> = {};
  if (h.ancestryName) out.ancestry = h.ancestryName;
  if (h.background?.name) out.background = h.background.name;
  if (h.alignment) out.alignment = h.alignment;
  if (h.background) {
    const personality: NonNullable<DmSceneView["hero"]["personality"]> = {};
    if (h.background.personalityTrait) personality.trait = h.background.personalityTrait;
    if (h.background.ideal) personality.ideal = h.background.ideal;
    if (h.background.bond) personality.bond = h.background.bond;
    if (h.background.flaw) personality.flaw = h.background.flaw;
    if (Object.keys(personality).length > 0) out.personality = personality;
  }
  if (h.backstory) out.backstory = h.backstory;
  const traits = featureList(h).map((f) => ({ name: f.name, text: f.text, applied: f.applied }));
  if (traits.length > 0) out.traits = traits;
  if (h.languages && h.languages.length > 0) out.languages = [...h.languages];
  const items: { name: string; what: string }[] = [];
  for (const section of packInfo(h, { potions: p.potions, notes: p.itemNotes })) {
    for (const info of section.items) items.push({ name: info.name, what: info.summary });
  }
  if (items.length > 0) out.items = items;
  return out;
}

/** The adventure's own name for a creature that is somebody (a hostile one too: the goblin Skrit), or undefined. */
function advNpcNameOf(p: PlayState, c: Creature): string | undefined {
  const a = adventureOf(p);
  return a ? npcOf(a, c.adv?.npc)?.name : undefined;
}

/** The most characters of the adventure's brief the DM is sent (dmCore.ts raises its own prompt cap by what this and the rules take). */
const DM_BRIEF_MAX = 5000;

/**
 * The adventure items the DM may hand over by id: the ones the story does not hand over itself. A feature's "gives" and a beat's "give" are
 * the engine's to give (when the search succeeds, when the beat fires), so offering them to the DM would let a story item arrive before the story
 * reaches it (the green cloth would end the search for the tunnel). What is left is what an adventure leaves to its people to hand out in talk.
 */
export function dmGivableItemIds(a: Adventure): string[] {
  const engineGives = new Set<string>();
  // A feature or a beat names an item by id or by its name (itemOf takes either).
  const give = (ref: string): void => void engineGives.add(itemOf(a, ref)?.id ?? ref);
  for (const loc of a.locations) for (const f of loc.features) for (const g of f.gives ?? []) give(g);
  for (const s of a.scenes) for (const b of s.beats) for (const g of b.give ?? []) give(g);
  return a.items.filter((i) => !engineGives.has(i.id)).map((i) => i.id);
}

/**
 * What the DM is told about the adventure: its brief for this hero and moment (the truths, the secrets marked DM ONLY, the people here, the
 * current scene), the progress steps it may propose right now (allowedDmSteps), the adventure's people standing on this board with their
 * squares (the ids it answers talkedTo with) and the item ids it may give. Undefined in a test room, so a room's prompt is what it always was.
 */
export function dmAdventureView(p: PlayState): DmSceneView["adventure"] | undefined {
  const a = adventureOf(p);
  const progress = p.progress;
  if (!a || !progress) return undefined;
  const npcsHere: { id: string; name: string; at: XY }[] = [];
  for (const c of p.creatures) {
    const npc = npcOf(a, c.adv?.npc);
    if (npc && !npcsHere.some((n) => n.id === npc.id)) npcsHere.push({ id: npc.id, name: npc.name, at: { ...c.at } });
  }
  return {
    title: a.title,
    brief: adventureBrief(a, progress, { chassis: p.hero.chassis as Chassis, maxChars: DM_BRIEF_MAX }),
    allowedSteps: allowedDmSteps(a, progress),
    npcsHere,
    itemIds: dmGivableItemIds(a),
  };
}

/** The whole scene for one DM call, rebuilt from the state every time. */
export function dmViewFor(p: PlayState): DmSceneView {
  const kit = SCENE_KIT[p.template];
  const walkable = walkableById(p.template);
  const tiles = sceneTiles(p);
  const features = dmFeatures(p);
  const used = new Set<string>();
  const changed = new Set(p.tileOverrides.map((o) => `${o.x},${o.y}`));
  const propDigit = new Map<string, string>();
  p.extraProps.forEach((e, i) => propDigit.set(`${e.x},${e.y}`, i < 9 ? String(i + 1) : "*"));
  // One letter per kind of creature on the board, in the order they were made: M first, as it always was, then N, O and so on.
  const kindLetter = new Map<string, string>();
  for (const c of p.creatures) {
    const key = c.npc ? `npc:${c.npc.role}` : c.token;
    if (!kindLetter.has(key)) kindLetter.set(key, "MNOPQRSTUVWXYZ"[kindLetter.size] ?? "M");
  }
  const letterOf = (c: Creature): string => kindLetter.get(c.npc ? `npc:${c.npc.role}` : c.token)!;
  const grid = tiles.map((row, y) =>
    row
      .map((id, x) => {
        const at = { x, y };
        let ch: string;
        if (same(at, p.heroAt)) ch = "@";
        else if (creatureAt(p, at)) ch = letterOf(creatureAt(p, at)!);
        else if (same(at, doorAt(p))) ch = p.doorOpen ? "d" : "D";
        else if (same(at, containerAt(p))) ch = p.searched ? "c" : "C";
        else if (propDigit.has(`${x},${y}`)) ch = propDigit.get(`${x},${y}`)!;
        else if (isGrate(p, at)) ch = "o";
        else if (changed.has(`${x},${y}`)) ch = walkable.get(id) === true ? "," : "%";
        else ch = walkable.get(id) === true ? "." : "#";
        used.add(ch);
        return ch;
      })
      .join(""),
  );
  const words: Record<string, string> = {
    // Each creature kind's letter (a second of a kind shares it; the monster list below tells them apart by id).
    ...Object.fromEntries(p.creatures.map((c) => [letterOf(c), `${c.npc ? creatureLabel(p, c) : `the ${statblockFor(c.token).name.toLowerCase()}`}${c.hostile ? "" : " (not hostile)"}`])),
    "#": "solid terrain you cannot walk through (stone wall)",
    ".": "open floor",
    "@": "the hero",
    D: `${kit.doorLabel}, closed${p.doorLocked ? " and locked" : ""}`,
    d: `${kit.doorLabel}, open`,
    C: `${kit.containerLabel}, unopened`,
    c: `${kit.containerLabel}, opened`,
    o: "a drain grate set in the floor (walkable)",
    ",": "terrain you changed (walkable)",
    "%": "terrain you changed (solid)",
    "*": "a DM prop (see the feature list)",
  };
  const legend: Record<string, string> = {};
  for (const ch of used) {
    if (/^\d$/.test(ch)) legend[ch] = `DM prop ${ch}: ${p.extraProps[Number(ch) - 1]?.label ?? "a prop"}`;
    else if (words[ch]) legend[ch] = words[ch]!;
  }
  const h = p.hero;
  const c = p.round ? activeCombatant(p.round) : undefined;
  const mine = heroesTurn(p);
  const inSight = features.filter((f) => f.seen && seesTile(p, f)).map((f) => f.id);
  for (const c of creaturesInSight(p)) inSight.push(c.id);
  const conditions: string[] = [];
  if (h.dead) conditions.push("dead");
  else if (h.downed) conditions.push("down at 0 hit points, making death saves");
  else if (h.stable) conditions.push("stable at 0 hit points");
  const potions = p.potions;
  const adventure = dmAdventureView(p);
  return {
    template: p.template,
    cols: CELL_WIDTH,
    rows: CELL_HEIGHT,
    grid,
    legend,
    features,
    hero: {
      name: h.name,
      archetype: h.displayName,
      level: h.level,
      hp: h.currentHp,
      maxHp: h.maxHp,
      ac: effectiveArmorClass(h),
      at: { ...p.heroAt },
      speedFt: effectiveSpeedFt(h),
      abilities: { ...h.modifiers },
      skills: Object.fromEntries(h.skills.map((s) => [s.skill, skillModifierFor(h, s.skill)])),
      conditions,
      worn: GEAR_ROLES.map((role) => {
        const tier = wornTier(p, role);
        return tier ? itemName(p.archetypeId, role, tier) : null;
      }).filter((n): n is string => n !== null),
      bag: (h.bag ?? []).map((b) => itemName(p.archetypeId, b.slot, b.tier)),
      carried: [...packItems(h)],
      potions,
      consumables: (h.consumables ?? []).filter((x) => !/potion/i.test(x.name)).map((x) => `${x.name} x${x.uses}`),
      ...heroIdentityFor(p),
      ...(p.heroHidden ? { hidden: true } : {}),
    },
    monsters: p.creatures.map((m) => ({
      id: m.id,
      // Who it is, for the DM: its name (numbered while the scene has several of its kind), and the role of one that is somebody and not hostile.
      name: m.npc ? `${creatureName(p, m)} (not hostile)` : advNpcNameOf(p, m) ? `${advNpcNameOf(p, m)} (${creatureName(p, m).toLowerCase()})` : creatureName(p, m),
      hp: m.hp,
      maxHp: statblockFor(m.token).maxHp,
      ac: monsterArmorClassFor(m.token),
      at: { ...m.at },
      awake: m.awake,
      seenByHero: creatureInSight(p, m),
      // A hostile that is up has noticed the hero; one asleep has not. A creature that is not hostile says nothing about it.
      ...(m.hostile ? { awareOfHero: m.awake } : {}),
      ...(m.prone ? { prone: true } : {}),
    })),
    fight: p.round
      ? { round: p.round.roundNumber, whoseTurn: mine ? h.name : (activeCreature(p) ? creatureLabel(p, activeCreature(p)!) : "a creature"), heroMovementFt: mine ? (c?.economy.movementRemaining ?? 0) : 0, heroActionReady: heroActionReady(p) }
      : null,
    visibleToHero: `${inSight.length ? `ids in sight now: ${inSight.join(", ")}` : "no feature or creature in particular"}; the hero stands ${p.adventureId ? `in ${currentLocation(p)?.name ?? "the place"}` : `in the ${p.heroAt.x < DIVIDER_X ? "west" : "east"} room`}`,
    memory: [...p.dmMemory],
    recent: p.dmRecent.slice(-DM_RECENT_SHOWN),
    log: p.log.slice(-6).map((l) => l.text),
    assets: dmAssetsFor(p.template),
    // Only when there are any, so a scene without them reads exactly as it did.
    ...(p.bodies.length > 0 ? { bodies: p.bodies.map((b) => ({ id: b.id, name: b.name, at: { ...b.at }, looted: b.looted, items: b.items.map((i) => i.name) })) } : {}),
    ...(p.piles.some((q) => q.items.length > 0) ? { piles: p.piles.filter((q) => q.items.length > 0).map((q) => ({ at: { ...q.at }, items: [...q.items] })) } : {}),
    // Only in an adventure: then the DM is bound by it (the brief, the steps it may propose, the people and items it may name).
    ...(adventure ? { adventure } : {}),
  };
}

/** The DC of a Perception check to listen at a door (SRD 5.1 gives hearing a DC of 10 for ordinary sounds). */
export const LISTEN_DC = 10;

/** The effect in plain words, for the debug journal's applied and refused lists. */
export function describeEffect(e: DmEffect): string {
  switch (e.type) {
    case "give": return `give ${e.itemId !== undefined ? `adventure item ${e.itemId}` : e.item}${e.quest ? " (quest item)" : ""}${e.usable ? " (usable)" : ""}`;
    case "take": return `take ${e.item}`;
    case "potion": return `potion x${e.count}`;
    case "loot": return "loot roll";
    case "heal": return `heal ${e.dice}`;
    case "harm": return `harm ${e.dice} (${e.why})`;
    case "place": return `place ${e.asset} "${e.label}" at (${e.x},${e.y})`;
    case "remove": return `remove ${e.id}`;
    case "alter": return `alter ${e.id}`;
    case "tile": return `tile ${e.tile} at (${e.x},${e.y})`;
    case "door": return `door ${e.state}`;
    case "monster": return `monster ${e.act}`;
    case "push": return `push ${e.id} ${e.squares} square${e.squares === 1 ? "" : "s"}`;
    case "hurt": return `hurt ${e.id}${e.dice ? ` ${e.dice}` : " (the attack's own damage)"}${e.damageType ? ` ${e.damageType}` : ""}`;
    case "prone": return `prone ${e.id}`;
    case "progress": return `progress ${e.step.kind} ${e.step.kind === "flag" ? e.step.flag : e.step.id}`;
  }
}

/** Damage a creature takes from something that is not a swing (a DM hurt with its own dice): hit points, the log, a kill. Returns the events the board floats. */
export function hurtCreatureBy(p: PlayState, m: Creature, amount: number, type?: string): CombatEvent[] {
  const hurt = damageMonster({ assetId: m.token, currentHp: m.hp }, amount);
  const lost = m.hp - hurt.currentHp;
  m.hp = hurt.currentHp;
  p.log.push({ text: `${sentenceCase(creatureLabel(p, m))} takes ${amount} ${type ? `${type} ` : ""}damage${hurt.down ? " and goes down" : `, ${hitPoints(m.hp)} left`}.`, tone: "good" });
  const events: CombatEvent[] = lost > 0 ? [{ kind: "damage", tokenId: m.id, amount, hpLost: lost, critical: false }] : [];
  if (hurt.down) {
    events.push({ kind: "down", tokenId: m.id });
    slayCreature(p, m);
  }
  return events;
}

export type EffectOutcome = { ok: true; line?: LogLine; wake?: Creature } | { ok: false; why: string; logged?: boolean };
const fail = (why: string, logged = false): EffectOutcome => ({ ok: false, why, logged });

/** Why a prop or a creature cannot stand on this square, in words; null when it is free. */
function squareBlockedWords(p: PlayState, at: XY): string | null {
  const tile = sceneTiles(p)[at.y]?.[at.x];
  if (!tile || walkableById(p.template).get(tile) !== true) return "that square is solid terrain";
  if (same(at, p.heroAt)) return "the hero is standing there";
  const there = creatureAt(p, at);
  if (there) return `${creatureLabel(p, there)} is standing there`;
  if (same(at, doorAt(p))) return "the door is there";
  if (same(at, containerAt(p))) return "the chest is there";
  if (p.extraProps.some((e) => same(e, at))) return "another prop is already there";
  // A square of an adventure's place that already holds a prop of the map (a barrel, a stair, an exit) is not free.
  if (p.adventureId && (advBoard(p)?.props.some((q) => same(q, at)) || exitOn(p, at))) return "something of the place is already there";
  return null;
}

/**
 * One DM effect that needs no dice, applied to the scene. Never throws: a
 * refusal comes back as { ok: false, why } for the caller to log. The tile,
 * prop and door effects bump worldRev so sight and the picture rebuild. heal
 * and harm are not here (the panel rolls them in the tray).
 */
export function applyWorldEffect(p: PlayState, e: DmEffect): EffectOutcome {
  const kit = SCENE_KIT[p.template];
  switch (e.type) {
    case "give": {
      if (p.hero.inventory.length >= DM_INVENTORY_MAX) return fail("the pack is full");
      // An item of the adventure, by id: the adventure's own name, description and quest flag (nothing the DM wrote about it), and the story hears of it.
      if (e.itemId !== undefined) {
        const a = adventureOf(p);
        const item = a ? itemOf(a, e.itemId) : undefined;
        if (!item) return fail(`"${e.itemId}" is not an item of this adventure`);
        if (advHolds(p, item)) return fail(`the hero already carries ${item.name}`);
        giveAdventureItem(p, item);
        return { ok: true };
      }
      p.hero = { ...p.hero, inventory: [...p.hero.inventory, e.item] };
      // What the DM says it is: the pack's hover tip shows it (and says the game does not use it by itself).
      if (typeof e.desc === "string" && e.desc.trim()) p.itemNotes[e.item] = e.desc.trim();
      // Its flags (quest, usable, what Use says) ride with its name; the item card and the engine's item rules read them.
      if (e.quest === true || e.usable === true || e.useSay !== undefined) {
        p.itemFlags[e.item] = { ...(p.itemFlags[e.item] ?? {}), ...(e.quest === true ? { quest: true } : {}), ...(e.usable === true ? { usable: true } : {}), ...(e.useSay !== undefined ? { useSay: e.useSay } : {}) };
      }
      return { ok: true, line: { text: `You now carry ${e.item}.`, tone: "good", notice: `+ ${e.item}` } };
    }
    case "take": {
      const want = foldItem(e.item);
      const carried = new Set(packItems(p.hero));
      const at = p.hero.inventory.findIndex((it) => carried.has(it) && (foldItem(it) === want || foldItem(it).includes(want) || want.includes(foldItem(it))));
      if (!want || at < 0) return fail(`the hero is not carrying "${e.item}" (only carried items can be taken)`);
      const gone = p.hero.inventory[at]!;
      p.hero = { ...p.hero, inventory: p.hero.inventory.filter((_, i) => i !== at) };
      if (!p.hero.inventory.includes(gone)) forgetItem(p, gone);
      return { ok: true, line: { text: `You no longer have ${gone}.`, tone: "plain" } };
    }
    case "progress": {
      // The story's own check (progress.ts): a step the adventure does not allow now changes nothing and comes back to the DM in plain words.
      if (!p.adventureId) return fail("there is no adventure running, so there is no story step to take");
      const r = advApply(p, { type: "dm", step: e.step });
      if (!r) return fail("there is no adventure running, so there is no story step to take");
      if (r.refused) return fail(r.refused);
      return { ok: true };
    }
    case "potion": {
      const grant = Math.min(e.count, DM_POTION_CAP - p.potionsGranted);
      if (grant <= 0) return fail(`no more healing potions can be handed out in this scene (the limit is ${DM_POTION_CAP})`);
      p.potions += grant;
      p.potionsGranted += grant;
      return { ok: true, line: { text: grant === 1 ? "You gain a potion of healing." : `You gain ${grant} potions of healing.`, tone: "good", notice: `+${grant} potion${grant === 1 ? "" : "s"}` } };
    }
    case "loot":
      // The game's own roll, capped by the cell's ledger (it logs its own line either way).
      return rollLoot(p, "container") ? { ok: true } : fail(LOOT_CAP_LINE, true);
    case "place": {
      if (p.extraProps.length >= DM_PROPS_MAX) return fail(`the room already holds ${DM_PROPS_MAX} props of yours`);
      const blocked = squareBlockedWords(p, { x: e.x, y: e.y });
      if (blocked) return fail(`a prop cannot go at (${e.x},${e.y}): ${blocked}`);
      p.extraProps.push({ id: `prop-${p.propSeq++}`, assetId: e.asset, x: e.x, y: e.y, label: e.label, ...(e.secret ? { secret: e.secret } : {}) });
      p.worldRev++;
      return { ok: true };
    }
    case "remove": {
      const i = p.extraProps.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        p.extraProps.splice(i, 1);
        p.worldRev++;
        return { ok: true };
      }
      if (e.id === "door" || e.id === "container") return fail(`${e.id === "door" ? kit.doorLabel : kit.containerLabel} is part of the room and cannot be removed`);
      if (e.id.startsWith("drain-") || e.id.startsWith("tile-")) return fail("terrain cannot be removed; change the floor with a tile effect");
      return fail(`there is no prop "${e.id}" to remove`);
    }
    case "alter": {
      const prop = p.extraProps.find((x) => x.id === e.id);
      if (prop) {
        if (e.asset !== undefined && !dmAssetsFor(p.template).props.includes(e.asset)) return fail(`"${e.asset}" is not a prop a prop can become`);
        if (e.asset !== undefined && e.asset !== prop.assetId) {
          prop.assetId = e.asset;
          p.worldRev++;
        }
        if (e.label !== undefined) prop.label = e.label;
        if (e.secret === null) delete prop.secret;
        else if (e.secret !== undefined) prop.secret = e.secret;
        return { ok: true };
      }
      const builtIn = e.id === "door" || e.id === "container" || e.id.startsWith("drain-");
      if (!builtIn) return fail(e.id.startsWith("tile-") ? "terrain is changed with a tile effect, not alter" : `there is no prop "${e.id}" to change`);
      if (e.asset !== undefined || e.label !== undefined) return fail("the door, the chest and the grates keep their look and their name; only their secret can change");
      if (e.secret === null) delete p.propSecrets[e.id];
      else if (e.secret !== undefined) p.propSecrets[e.id] = e.secret;
      return { ok: true };
    }
    case "tile": {
      const at = { x: e.x, y: e.y };
      if (e.x <= 0 || e.y <= 0 || e.x >= CELL_WIDTH - 1 || e.y >= CELL_HEIGHT - 1) return fail("the outer wall of the room cannot be changed");
      if (same(at, p.heroAt)) return fail("the hero is standing there");
      const standing = creatureAt(p, at);
      if (standing) return fail(`${creatureLabel(p, standing)} is standing there`);
      if (same(at, doorAt(p)) || same(at, containerAt(p))) return fail(`${same(at, doorAt(p)) ? kit.doorLabel : kit.containerLabel} is on that square`);
      if (p.adventureId && (exitOn(p, at) || advBoard(p)?.props.some((q) => same(q, at)))) return fail("something of the place stands on that square");
      const now = sceneTiles(p)[e.y]![e.x]!;
      if (now === e.tile) return { ok: true };
      const prop = p.extraProps.find((x) => same(x, at));
      if (prop && walkableById(p.template).get(e.tile) !== true) return fail(`${prop.label} stands on that square, which cannot turn solid`);
      p.tileOverrides = [...p.tileOverrides.filter((o) => !same(o, at)), { x: e.x, y: e.y, tile: e.tile }];
      p.worldRev++;
      return { ok: true };
    }
    case "door": {
      if (p.adventureId) return fail("there is no door the story lets you open or shut here; the way out is the exit, and the story decides when it opens");
      const inDoorway = same(p.heroAt, DOOR_AT) || creatureAt(p, DOOR_AT) !== undefined;
      if (e.state === "unlocked") {
        p.doorLocked = false;
        return { ok: true };
      }
      if (e.state === "open") {
        p.doorLocked = false;
        p.doorOpen = true;
        return { ok: true };
      }
      if (inDoorway) return fail(`someone is standing in the doorway, so ${kit.doorLabel} cannot shut`);
      p.doorOpen = false;
      if (e.state === "locked") p.doorLocked = true;
      return { ok: true };
    }
    case "monster": {
      if (e.act === "spawn") {
        if (p.creatures.length >= CREATURE_CAP) return fail(`the room already holds ${CREATURE_CAP} creatures`);
        const at = { x: e.x ?? 0, y: e.y ?? 0 };
        const blocked = squareBlockedWords(p, at);
        if (blocked) return fail(`a monster cannot appear at (${at.x},${at.y}): ${blocked}`);
        // A new creature is asleep and unseen; it joins a fight when it notices the hero, like any other.
        addCreature(p, e.asset ?? kit.monster, at);
        return { ok: true };
      }
      const m = e.id ? creatureById(p, e.id) : undefined;
      if (!m) return fail(`there is no creature "${e.id ?? ""}" in the room`);
      if (e.act === "wake") return { ok: true, wake: m };
      if (e.act === "calm") {
        if (p.round) return fail("a monster cannot be calmed in the middle of a fight");
        m.awake = false;
        return { ok: true };
      }
      // flee
      const wasSeen = creatureInSight(p, m);
      const label = creatureLabel(p, m);
      p.creatures = p.creatures.filter((x) => x !== m);
      // An adventure's creature that fled does not come back when the place is read again (it is not dead: the story's kills do not count it).
      if (m.adv) p.goneSpawns.push(m.adv.instance);
      if (p.round) {
        const rest = dropCombatant(p.round, m.id);
        p.round = hasHostiles(rest) ? rest : null;
      }
      return { ok: true, line: { text: wasSeen ? `${sentenceCase(label)} flees.` : "Something moves away out of sight.", tone: "good" } };
    }
    default:
      return fail("that effect is not one the engine knows");
  }
}
