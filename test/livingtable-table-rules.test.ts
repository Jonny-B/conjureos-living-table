/**
 * The table window's rules modules (src/games/livingtable/table: sight, fightRules, dmScene, gearLoot) on their own: no DOM,
 * no bench. A memory host with the game's real art binds the catalog, and a scripted source binds the dice and the clock.
 *
 *   - the dice and the clock are the host's: unbound they throw, bound they are the only source a roll draws from;
 *   - sight, the wake rule, a step, a swing, a kill and a monster's turn behave as the bench's Play panel always did;
 *   - the DM's view of the scene and its effects read the catalog (what it may place, what is walkable);
 *   - gear, piles and bodies go through the engine's own item rules.
 *
 * Run: npx tsx --test test/livingtable-table-rules.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { PALETTE as _FP, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";
import { activeCombatant } from "../src/games/livingtable/menu/combatRound";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world/coordinates";
import { bindCatalog, dmAssets, type CatalogSprite } from "../src/games/livingtable/table/catalog";
import { createMemoryHost } from "../src/games/livingtable/table/hostDefault";
import {
  CONTAINER_AT,
  DM_POTION_CAP,
  DM_PROPS_MAX,
  DOOR_AT,
  DOWN_NOTE,
  HERO_START,
  MONSTER_START,
  SCENE_KIT,
  SECOND_START,
  newPlay,
  type PlayState,
} from "../src/games/livingtable/table/state";
import { creatureNotices, engineLayout, heroSees, hostileInSight, noteSight, noticers, seesTile, sightLevel } from "../src/games/livingtable/table/sight";
import {
  bindFightEnv,
  drinkPotionRules,
  fightEnvBound,
  heroAttackRefusal,
  heroAttackRules,
  heroInteractRules,
  heroStepTo,
  joinFight,
  monsterTurnRules,
  restRefusal,
  slayCreature,
  startFight,
  tableNow,
  tableRng,
} from "../src/games/livingtable/table/fightRules";
import { applyWorldEffect, dmAssetsFor, dmViewFor, isGrate, whatIsAt } from "../src/games/livingtable/table/dmScene";
import {
  foldItem,
  forgetItem,
  hostileNear,
  itemCardFor,
  itemName,
  lootNear,
  pileAt,
  slotNaming,
  takeFromPileInto,
  withoutCount,
  wornTier,
} from "../src/games/livingtable/table/gearLoot";
import type { DmEffect } from "../src/games/livingtable/table/dmCore";

void _FP;
const REAL = { fantasy: FANTASY_SPRITES as unknown as CatalogSprite[], scifi: SCIFI_SPRITES as unknown as CatalogSprite[] };

/** The dice: a value to answer with, and a count of how often they were asked. */
const dice = { value: 0.5, calls: 0, clock: 1000, clockCalls: 0 };
let unbindDice: (() => void) | null = null;

/** Drop the bound dice, so a test can see what an unbound roll does. */
function unbindAll(): void {
  unbindDice?.();
  unbindDice = null;
}

function setup(): void {
  bindCatalog(createMemoryHost({ sprites: REAL }).art);
  dice.value = 0.5;
  dice.calls = 0;
  dice.clockCalls = 0;
  unbindDice?.();
  unbindDice = bindFightEnv({
    rng: () => {
      dice.calls++;
      return dice.value;
    },
    now: () => {
      dice.clockCalls++;
      return dice.clock;
    },
  });
}

/** Run `fn` with Math.random fixed, for the dice the engine rolls with its own default (initiative, loot, the potion). */
function withRandom<T>(value: number, fn: () => T): T {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

const KNIGHT = "knight" as Parameters<typeof newPlay>[1];
function scene(room: "one" | "two" = "one"): PlayState {
  return newPlay("fantasy", KNIGHT, "floor_stone", undefined, undefined, room);
}

// ---- the dice and the clock --------------------------------------------------------

test("rolling or timing with nothing bound throws a message that names the fix", () => {
  unbindAll();
  assert.equal(fightEnvBound(), false);
  assert.throws(() => tableRng(), /bindFightEnv\(host\.env\)/);
  assert.throws(() => tableNow(), /bindFightEnv\(host\.env\)/);
  setup();
  const p = scene();
  unbindAll();
  p.heroAt = { x: 15, y: 10 };
  noteSight(p);
  assert.throws(() => heroAttackRules(p, p.creatures[0]!), /bindFightEnv/);
});

test("the host's source is the only one a roll draws from; an unbind of a replaced binding does nothing", () => {
  setup();
  assert.equal(fightEnvBound(), true);
  dice.value = 0.25;
  assert.equal(tableRng(), 0.25);
  assert.equal(tableNow(), 1000);
  const first = bindFightEnv({ rng: () => 0.75 });
  const second = bindFightEnv({ rng: () => 0.125 });
  first();
  assert.equal(tableRng(), 0.125, "the stale unbind left the current binding alone");
  assert.equal(typeof tableNow(), "number", "without a clock of its own it uses performance.now");
  second();
  assert.equal(fightEnvBound(), false);
  setup();
});

test("a swing draws its d20 and its damage from the host, not from Math.random", () => {
  setup();
  const p = scene();
  p.heroAt = { x: 15, y: 10 };
  noteSight(p);
  const m = p.creatures[0]!;
  dice.value = 0.999;
  const before = dice.calls;
  const out = withRandom(0.0001, () => heroAttackRules(p, m));
  assert.equal(out.refused, null);
  if (out.refused !== null) return;
  assert.ok(dice.calls > before, "the host's source was asked");
  assert.equal(out.dice.roll, 20, "0.999 is a natural 20, whatever Math.random says");
  assert.equal(out.dice.critical, true);
  assert.equal(out.dice.hit, true);
  const events = out.apply();
  assert.ok(events.length > 0);
  assert.equal(p.creatures.length, 0, "a critical from the Knight fells the goblin");
  assert.equal(p.bodies.length, 1);
});

test("a low roll misses and a kick is rolled from the same source", () => {
  setup();
  const p = scene();
  p.heroAt = { x: 15, y: 10 };
  noteSight(p);
  dice.value = 0;
  const out = heroAttackRules(p, p.creatures[0]!);
  assert.equal(out.refused, null);
  if (out.refused !== null) return;
  assert.equal(out.dice.roll, 1);
  assert.equal(out.dice.fumble, true);
  assert.equal(out.dice.hit, false);
});

// ---- sight and the wake rule -------------------------------------------------------

test("a shut door hides the east room; open, the hero sees across it, and what it saw is remembered", () => {
  setup();
  const p = scene("two");
  noteSight(p);
  assert.equal(seesTile(p, p.heroAt), true);
  assert.equal(p.creatures.some((c) => seesTile(p, c.at)), false, "nothing in the east room is in sight");
  assert.equal(hostileInSight(p), false);
  assert.equal(sightLevel(p, MONSTER_START), 0, "never seen");
  p.doorOpen = true;
  p.worldRev++;
  p.heroAt = { x: 10, y: 7 };
  noteSight(p);
  assert.equal(heroSees(p).length, CELL_HEIGHT);
  assert.equal(heroSees(p)[0]!.length, CELL_WIDTH);
  assert.equal(sightLevel(p, MONSTER_START), 2, "the goblin's square is in sight through the open door");
  p.doorOpen = false;
  p.worldRev++;
  p.heroAt = { x: 4, y: 7 };
  assert.equal(sightLevel(p, MONSTER_START), 1, "seen before, not now");
  assert.equal(p.creatures.every((c) => c.seen === false || !seesTile(p, c.at)), true);
});

test("each sleeper asks the wake rule for itself", () => {
  setup();
  const p = scene("two");
  p.doorOpen = true;
  p.worldRev++;
  p.heroAt = { x: 11, y: 7 };
  noteSight(p);
  assert.deepEqual(noticers(p).map((c) => c.id), ["monster", "monster-2"]);
  p.creatures[0]!.at = { x: 18, y: 12 };
  p.worldRev++;
  assert.deepEqual(noticers(p).map((c) => c.id), ["monster-2"]);
  p.creatures[1]!.awake = true;
  assert.equal(creatureNotices(p, p.creatures[1]!), false, "an awake creature is not a sleeper");
});

test("the engine's layout of the scene has the hero and every creature as tokens", () => {
  setup();
  const p = scene("two");
  assert.deepEqual(engineLayout(p).tokens.map((t) => t.id), ["hero", "monster", "monster-2"]);
});

// ---- steps, fights, turns ----------------------------------------------------------

test("a step is one open square; a wall, a diagonal and a far square are refused in words", () => {
  setup();
  const p = scene();
  const from = { ...p.heroAt };
  assert.deepEqual(from, HERO_START);
  const ok = heroStepTo(p, { x: from.x + 1, y: from.y });
  assert.equal(ok.refused, null);
  assert.deepEqual(p.heroAt, { x: from.x + 1, y: from.y });
  assert.equal(ok.events[0]!.kind, "move");
  assert.equal(heroStepTo(p, { x: p.heroAt.x + 2, y: p.heroAt.y }).refused, "One square at a time.");
  assert.match(String(heroStepTo(p, { x: 0, y: 0 }).refused), /./);
  p.hero = { ...p.hero, currentHp: 0, downed: true };
  assert.equal(heroStepTo(p, { x: p.heroAt.x + 1, y: p.heroAt.y }).refused, DOWN_NOTE);
});

test("a fight lists every awake hostile, a sleeper can join it, a kill leaves a body and the last one ends it", () => {
  setup();
  const p = scene("two");
  withRandom(0.5, () => startFight(p, false, [p.creatures[0]!]));
  assert.deepEqual([...p.round!.order.map((c) => c.id)].sort(), ["hero", "monster"]);
  const acting = activeCombatant(p.round!)!.id;
  withRandom(0.99, () => assert.equal(joinFight(p, p.creatures[1]!), 22));
  assert.equal(p.round!.order.length, 3);
  assert.equal(activeCombatant(p.round!)!.id, acting, "nobody's turn moved");
  assert.equal(joinFight(p, p.creatures[1]!), null, "already in");
  const [goblin, skeleton] = p.creatures as [(typeof p.creatures)[number], (typeof p.creatures)[number]];
  slayCreature(p, skeleton);
  assert.ok(p.round, "the goblin keeps the fight on");
  assert.deepEqual(p.bodies.map((b) => b.token), ["token_skeleton"]);
  slayCreature(p, goblin);
  assert.equal(p.round, null);
  assert.deepEqual(p.fallenAt, goblin.at);
});

test("the hero's attack is refused with a reason when the creature is out of reach or gone", () => {
  setup();
  const p = scene("two");
  p.heroAt = { x: 14, y: 5 };
  noteSight(p);
  const [goblin, skeleton] = p.creatures as [(typeof p.creatures)[number], (typeof p.creatures)[number]];
  assert.deepEqual(skeleton.at, SECOND_START);
  const ok = heroAttackRules(p, skeleton);
  assert.equal(ok.refused, null);
  if (ok.refused === null) assert.equal(ok.dice.target, 13, "the skeleton's armor class");
  assert.match(String(heroAttackRefusal(p, goblin)), /Too far away|You do not see/);
  assert.equal(heroAttackRefusal(p, undefined), "Nothing left to fight. Press Reset scene to bring it back.");
});

test("a monster's turn is one creature's; a prone one spends movement standing and the clock is the host's", () => {
  setup();
  const p = scene("two");
  p.heroAt = { x: 12, y: 7 };
  p.hero = { ...p.hero, currentHp: 99, maxHp: 99 };
  noteSight(p);
  withRandom(0.5, () => startFight(p, false, p.creatures));
  const i = p.round!.order.findIndex((c) => c.id === "monster-2");
  p.round = { ...p.round!, activeIndex: i };
  const skeleton = p.creatures[1]!;
  const goblinAt = { ...p.creatures[0]!.at };
  skeleton.prone = true;
  dice.clockCalls = 0;
  const turn = withRandom(0.5, () => monsterTurnRules(p, skeleton));
  assert.deepEqual(p.creatures[0]!.at, goblinAt, "the goblin did not move");
  assert.equal(skeleton.prone, false);
  assert.ok(turn.lines.some((l) => /to stand up/.test(l.text)));
  assert.ok(dice.clockCalls >= 1, "standing up timed the cast's clip with the host's clock");
  assert.equal(monsterTurnRules(scene(), scene().creatures[0]!).events.length, 0, "no fight, no turn");
});

test("the door and the chest are used from next to them; a potion heals, spends one and takes the action", () => {
  setup();
  const p = scene();
  p.heroAt = { x: DOOR_AT.x - 1, y: DOOR_AT.y };
  assert.equal(heroInteractRules(p).refused, null);
  assert.equal(p.doorOpen, true);
  p.heroAt = { x: 4, y: 2 };
  assert.match(String(heroInteractRules(p).refused), /Nothing to use here/);
  assert.equal(drinkPotionRules(p).refused, "You are already at full health.");
  p.hero = { ...p.hero, currentHp: 1 };
  const potions = p.potions;
  const out = withRandom(0.99, () => drinkPotionRules(p));
  assert.equal(out.refused, null);
  assert.equal(p.potions, potions - 1);
  assert.ok(p.hero.currentHp > 1);
  assert.match(String(restRefusal(p)), /enemy in sight/, "the open door shows the goblin");
  p.doorOpen = false;
  p.worldRev++;
  assert.equal(restRefusal(p), null, "shut again: nothing hostile is awake or in sight");
});

// ---- the DM's side of the scene ----------------------------------------------------

test("the DM's view is the whole scene as a grid, with what it may place read from the catalog", () => {
  setup();
  const p = scene("two");
  const v = dmViewFor(p);
  assert.equal(v.rows, CELL_HEIGHT);
  assert.equal(v.cols, CELL_WIDTH);
  assert.equal(v.grid.length, CELL_HEIGHT);
  assert.ok(v.grid.every((r) => r.length === CELL_WIDTH));
  assert.equal(v.grid[p.heroAt.y]![p.heroAt.x], "@");
  assert.equal(v.grid[DOOR_AT.y]![DOOR_AT.x], "D");
  assert.equal(v.grid[CONTAINER_AT.y]![CONTAINER_AT.x], "C");
  assert.deepEqual(v.features.slice(0, 2).map((f) => f.id), ["door", "container"]);
  assert.ok(v.features.slice(2).every((f) => /^drain-\d+-\d+$/.test(f.id)), "then the grates the floor shows (a scattered variant is a grate the DM knows)");
  const kit = SCENE_KIT.fantasy;
  assert.deepEqual(v.assets, dmAssets("fantasy", [kit.monster, kit.second]));
  assert.deepEqual(v.assets, dmAssetsFor("fantasy"));
  assert.ok(v.assets.props.length > 0 && v.assets.tiles.length > 0);
  assert.ok(!v.assets.props.some((id) => /^(door_|chest|cottage_|arch_|wall_)/.test(id)), "no doors, chests or wall pieces");
  assert.equal(v.monsters.length, 2);
  assert.equal(v.monsters[0]!.seenByHero, false);
  assert.equal(v.hero.hp, p.hero.currentHp);
});

test("the DM's view follows the scene scifi too, and the catalog's own pair of monsters", () => {
  setup();
  const p = newPlay("scifi", "trooper" as Parameters<typeof newPlay>[1], "floor_deckplate", undefined, undefined, "one");
  const v = dmViewFor(p);
  const kit = SCENE_KIT.scifi;
  assert.deepEqual(v.assets.monsters, [kit.monster, kit.second]);
  assert.ok(v.assets.tiles.includes("floor_deckplate"));
});

test("a DM effect that places, changes or removes is applied by the engine and each refusal says why", () => {
  setup();
  const p = scene();
  const rev = p.worldRev;
  const place: DmEffect = { type: "place", asset: "barrel", x: 6, y: 6, label: "a barrel" } as DmEffect;
  assert.deepEqual(applyWorldEffect(p, place), { ok: true });
  assert.equal(p.extraProps.length, 1);
  assert.equal(p.worldRev, rev + 1);
  const again = applyWorldEffect(p, place);
  assert.equal(again.ok, false);
  assert.match(again.ok ? "" : again.why, /another prop is already there/);
  const onHero = applyWorldEffect(p, { type: "place", asset: "barrel", x: p.heroAt.x, y: p.heroAt.y, label: "x" } as DmEffect);
  assert.match(onHero.ok ? "" : onHero.why, /the hero is standing there/);
  const wall = applyWorldEffect(p, { type: "place", asset: "barrel", x: 0, y: 0, label: "x" } as DmEffect);
  assert.match(wall.ok ? "" : wall.why, /solid terrain/, "the catalog says a wall is not walkable");
  assert.equal(applyWorldEffect(p, { type: "remove", id: p.extraProps[0]!.id } as DmEffect).ok, true);
  assert.equal(p.extraProps.length, 0);
  assert.equal(applyWorldEffect(p, { type: "remove", id: "door" } as DmEffect).ok, false);
  const outer = applyWorldEffect(p, { type: "tile", tile: "floor_grass", x: 0, y: 5 } as DmEffect);
  assert.match(outer.ok ? "" : outer.why, /outer wall/);
  assert.equal(applyWorldEffect(p, { type: "tile", tile: "floor_grass", x: 8, y: 5 } as DmEffect).ok, true);
  assert.deepEqual(p.tileOverrides, [{ x: 8, y: 5, tile: "floor_grass" }]);
  const solid = applyWorldEffect(p, { type: "tile", tile: "wall_stone", x: 8, y: 5 } as DmEffect);
  assert.equal(solid.ok, true, "turning a square solid is allowed when nothing stands on it");
  assert.equal(dmViewFor(p).grid[5]![8], "%", "changed solid terrain reads as % in the grid");
  assert.equal(applyWorldEffect(p, { type: "nonsense" } as unknown as DmEffect).ok, false);
});

test("the DM's props are capped, its potions are capped, a spawn needs a free square and a door it shuts stays shut", () => {
  setup();
  const p = scene();
  for (let i = 0; i < DM_PROPS_MAX; i++) assert.equal(applyWorldEffect(p, { type: "place", asset: "barrel", x: 2 + i, y: 3, label: `b${i}` } as DmEffect).ok, true);
  const over = applyWorldEffect(p, { type: "place", asset: "barrel", x: 2, y: 4, label: "one too many" } as DmEffect);
  assert.match(over.ok ? "" : over.why, new RegExp(`${DM_PROPS_MAX} props`));
  const q = scene();
  const base = q.potions;
  const got = applyWorldEffect(q, { type: "potion", count: DM_POTION_CAP + 1 } as DmEffect);
  assert.equal(got.ok, true);
  assert.equal(q.potions, base + DM_POTION_CAP);
  const more = applyWorldEffect(q, { type: "potion", count: 1 } as DmEffect);
  assert.match(more.ok ? "" : more.why, /no more healing potions/);
  const spawnHere = applyWorldEffect(q, { type: "monster", act: "spawn", x: q.heroAt.x, y: q.heroAt.y } as DmEffect);
  assert.equal(spawnHere.ok, false);
  assert.equal(applyWorldEffect(q, { type: "monster", act: "spawn", x: 7, y: 3 } as DmEffect).ok, true);
  assert.equal(q.creatures.length, 2);
  assert.equal(applyWorldEffect(q, { type: "door", state: "locked" } as DmEffect).ok, true);
  assert.equal(q.doorLocked, true);
  assert.equal(q.doorOpen, false);
});

test("what is on a square is told in the player's words, and the walkable terrain letters come from the catalog", () => {
  setup();
  const p = scene();
  assert.equal(whatIsAt(p, p.heroAt), "yourself");
  assert.equal(whatIsAt(p, DOOR_AT), SCENE_KIT.fantasy.doorLabel);
  assert.equal(whatIsAt(p, { x: 0, y: 0 }), "the stone wall");
  assert.equal(whatIsAt(p, { x: 6, y: 6 }), "the floor");
  assert.equal(isGrate(p, { x: 0, y: 0 }), false);
  assert.equal(dmViewFor(p).legend["."], "open floor");
});

// ---- gear, piles, bodies -----------------------------------------------------------

test("an item name is compared the way a person would, and a gear role is called by the archetype's own word", () => {
  assert.equal(foldItem("The Healing Potion!"), "healing potion");
  assert.equal(foldItem("An  Iron   Key "), "iron key");
  assert.equal(withoutCount("Torch x3"), "Torch");
  const knight = slotNaming("knight" as Parameters<typeof slotNaming>[0], "outer");
  assert.ok(knight.slot.length > 0);
  assert.equal(typeof knight.own, "string");
  assert.equal(slotNaming("knight" as Parameters<typeof slotNaming>[0], "ring").own, null, "a ring starts empty");
});

test("a pile on the hero's square can be searched and taken, and what is gone is forgotten", () => {
  setup();
  const p = scene();
  assert.equal(lootNear(p), null);
  p.piles.push({ at: { ...p.heroAt }, items: ["Old key"] });
  assert.deepEqual(pileAt(p, p.heroAt)?.items, ["Old key"]);
  assert.deepEqual(lootNear(p), { kind: "pile", at: p.heroAt });
  const refusals = takeFromPileInto(p, p.heroAt, "all");
  assert.deepEqual(refusals, []);
  assert.ok(p.hero.inventory.includes("Old key"));
  assert.equal(p.piles.length, 0);
  p.itemNotes["Old key"] = "from the cellar";
  p.hero = { ...p.hero, inventory: p.hero.inventory.filter((n) => n !== "Old key") };
  forgetItem(p, "Old key");
  assert.equal(p.itemNotes["Old key"], undefined);
  assert.deepEqual(takeFromPileInto(p, { x: 1, y: 1 }, "all"), ["There is nothing there."]);
});

test("gear names come from the engine, a worn tier is read off the sheet, and the card of an item offers what it can do", () => {
  setup();
  const p = scene();
  assert.equal(typeof itemName(p.archetypeId, "weapon", "common"), "string");
  assert.equal(wornTier(p, "weapon"), "common");
  assert.equal(hostileNear(p), false);
  p.creatures[0]!.awake = true;
  assert.equal(hostileNear(p), true, "an awake hostile is near whether or not it is in sight");
  assert.equal(itemCardFor(p, "Worn:not an item"), null);
  assert.equal(itemCardFor(p, "no colon"), null);
});
