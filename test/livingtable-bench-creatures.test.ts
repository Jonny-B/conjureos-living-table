/**
 * The bench Play tab's creatures (scripts/asset-bench/assets.ts PLAY_RULES): the scene holds any number of
 * creatures, each with its own id, token, hit points, wake rule and turn; a fight lists every awake hostile,
 * a sleeper can join it, a kill ends the fight only with the last hostile, and a save (new shape or the old
 * single-monster one) puts every creature back. All of it runs with no DOM; the board is checked headless in
 * .cache/multi-play.cjs.
 *
 * Run: npx tsx --test test/livingtable-bench-creatures.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import bench, { PLAY_RULES as R } from "../scripts/asset-bench/assets";
import { activeCombatant } from "../src/games/livingtable/menu/combatRound";

void bench;

const KNIGHT = "knight" as Parameters<typeof R.newPlay>[1];

/** A scene for the Knight in the given room, hero at the start. */
function scene(room: "one" | "two") {
  return R.newPlay("fantasy", KNIGHT, "floor_stone", undefined, undefined, room);
}

/** Run `fn` with Math.random fixed (so startCombat's initiative dice are known). */
function withRandom<T>(value: number, fn: () => T): T {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test("the one-goblin room has the one goblin it always had, called monster", () => {
  const p = scene("one");
  assert.equal(p.room, "one");
  assert.deepEqual(p.creatures.map((c) => [c.id, c.token, c.awake, c.seen, c.hostile]), [["monster", "token_goblin", false, false, true]]);
  assert.equal(p.creatures[0]!.hp, 7);
  assert.deepEqual(p.creatures[0]!.at, R.MONSTER_START);
  assert.equal(R.creatureName(p, p.creatures[0]!), "Goblin");
});

test("the goblin and skeleton room has both, each with its own id, statblock and carried things", () => {
  const p = scene("two");
  assert.deepEqual(p.creatures.map((c) => [c.id, c.token]), [["monster", "token_goblin"], ["monster-2", "token_skeleton"]]);
  assert.deepEqual(p.creatures.map((c) => c.hp), [7, 13]);
  assert.deepEqual(p.creatures[1]!.at, R.SECOND_START);
  assert.ok(p.creatures.every((c) => !c.awake && !c.seen && !c.prone));
  // Nobody shares a square, and the creatures are tokens in the engine's view of the scene.
  const tokens = R.engineLayout(p).tokens.map((t) => t.id);
  assert.deepEqual(tokens, ["hero", "monster", "monster-2"]);
  assert.equal(R.roomLabel("fantasy", "one"), "One goblin");
  assert.equal(R.roomLabel("fantasy", "two"), "Goblin and skeleton");
});

test("a kind with several in the scene is numbered; a lone one is not", () => {
  const p = scene("one");
  assert.equal(R.creatureName(p, p.creatures[0]!), "Goblin");
  const second = R.addCreature(p, "token_goblin", { x: 14, y: 8 });
  assert.equal(second.id, "monster-2");
  assert.equal(R.creatureName(p, p.creatures[0]!), "Goblin 1");
  assert.equal(R.creatureName(p, second), "Goblin 2");
  assert.equal(R.creatureLabel(p, second), "the goblin 2");
  // An NPC is its role, never numbered, and not hostile unless made so.
  const keeper = R.addCreature(p, "token_villager", { x: 13, y: 9 }, { hostile: false, awake: true, npc: { role: "innkeeper" } });
  assert.equal(R.creatureName(p, keeper), "Innkeeper");
  assert.equal(R.hostilesOf(p).includes(keeper), false);
  assert.equal(R.engineLayout(p).tokens.find((t) => t.id === keeper.id)!.kind, "npc");
});

test("each sleeper asks the wake rule for itself", () => {
  const p = scene("two");
  // Door open, the hero in the doorway: both see the hero within six squares.
  p.doorOpen = true;
  p.worldRev++;
  p.heroAt = { x: 11, y: 7 };
  R.noteSight(p);
  assert.deepEqual(R.noticers(p).map((c) => c.id), ["monster", "monster-2"]);
  // Move the goblin out of range (and out of earshot): only the skeleton notices.
  p.creatures[0]!.at = { x: 18, y: 12 };
  p.worldRev++;
  assert.deepEqual(R.noticers(p).map((c) => c.id), ["monster-2"]);
  // The door shut and the hero in the west room: neither does.
  p.doorOpen = false;
  p.worldRev++;
  p.heroAt = { x: 4, y: 7 };
  assert.deepEqual(R.noticers(p), []);
  // An awake creature is not a sleeper, and one that is not hostile never notices.
  p.heroAt = { x: 11, y: 7 };
  p.doorOpen = true;
  p.worldRev++;
  p.creatures[1]!.awake = true;
  assert.deepEqual(R.noticers(p), []);
  p.creatures[1]!.awake = false;
  p.creatures[1]!.hostile = false;
  assert.deepEqual(R.noticers(p), []);
});

test("a fight lists the hero and every awake hostile, each with its own initiative", () => {
  const p = scene("two");
  R.startFight(p, false, p.creatures);
  assert.ok(p.round);
  assert.deepEqual([...p.round!.order.map((c) => c.id)].sort(), ["hero", "monster", "monster-2"]);
  assert.ok(p.creatures.every((c) => c.awake));
  const inits = p.round!.order.map((c) => c.initiative);
  assert.deepEqual(inits, [...inits].sort((a, b) => b - a), "sorted high to low");
  assert.ok(p.log.some((l) => /^Roll initiative!/.test(l.text)));
  // Only the one that woke is in it when the other sleeps on.
  const q = scene("two");
  R.startFight(q, false, [q.creatures[0]!]);
  assert.deepEqual([...q.round!.order.map((c) => c.id)].sort(), ["hero", "monster"]);
  assert.equal(q.creatures[1]!.awake, false);
});

test("a sleeper joins a fight that is on at its own initiative without moving anyone's turn", () => {
  const p = scene("two");
  withRandom(0.5, () => R.startFight(p, false, [p.creatures[0]!]));
  const before = p.round!;
  const actingBefore = activeCombatant(before)!.id;
  // A high roll sorts it first: it goes in before whoever is acting, and the turn does not move.
  withRandom(0.99, () => assert.equal(R.joinFight(p, p.creatures[1]!), 20 + 2));
  assert.equal(p.round!.order.length, 3);
  assert.equal(p.round!.order[0]!.id, "monster-2");
  assert.equal(activeCombatant(p.round!)!.id, actingBefore);
  assert.ok(p.creatures[1]!.awake);
  // Already in: nothing happens.
  assert.equal(R.joinFight(p, p.creatures[1]!), null);
  assert.equal(p.round!.order.length, 3);
  // A low roll sorts it last.
  const q = scene("two");
  withRandom(0.5, () => R.startFight(q, false, [q.creatures[0]!]));
  withRandom(0, () => R.joinFight(q, q.creatures[1]!));
  assert.equal(q.round!.order[q.round!.order.length - 1]!.id, "monster-2");
  assert.equal(activeCombatant(q.round!)!.id, activeCombatant(before)!.id);
  // Not in a fight at all: nothing to join.
  assert.equal(R.joinFight(scene("one"), scene("one").creatures[0]!), null);
});

test("a kill leaves a body of its own kind; the fight ends with the last hostile, not the first", () => {
  const p = scene("two");
  R.startFight(p, false, p.creatures);
  p.hero = { ...p.hero, longRestUsed: true };
  const [goblin, skeleton] = p.creatures as [(typeof p.creatures)[number], (typeof p.creatures)[number]];
  R.slayCreature(p, skeleton);
  assert.deepEqual(p.creatures.map((c) => c.id), ["monster"]);
  assert.deepEqual(p.bodies.map((b) => [b.token, b.name]), [["token_skeleton", "Skeleton"]]);
  assert.deepEqual(p.bodies[0]!.at, R.SECOND_START);
  assert.ok(p.round, "the goblin keeps the fight on");
  assert.deepEqual([...p.round!.order.map((c) => c.id)].sort(), ["hero", "monster"]);
  assert.equal(p.hero.longRestUsed, true, "the day has not turned over yet");
  R.slayCreature(p, goblin);
  assert.equal(p.round, null);
  assert.deepEqual(p.bodies.map((b) => b.token), ["token_skeleton", "token_goblin"]);
  assert.equal(p.hero.longRestUsed, false, "the last one down turns the day over");
  assert.deepEqual(p.fallenAt, goblin.at);
  // Slaying what is not on the board does nothing.
  R.slayCreature(p, goblin);
  assert.equal(p.bodies.length, 2);
});

test("a sleeper left alone does not hold the fight open", () => {
  const p = scene("two");
  R.startFight(p, false, [p.creatures[0]!]);
  R.slayCreature(p, p.creatures[0]!);
  assert.equal(p.round, null);
  assert.deepEqual(p.creatures.map((c) => c.id), ["monster-2"]);
  assert.equal(R.awakeHostiles(p).length, 0);
});

test("the hero's swing is at the creature named, with that creature's armor and a refusal that says why", () => {
  const p = scene("two");
  p.heroAt = { x: 14, y: 5 };
  R.noteSight(p);
  const [goblin, skeleton] = p.creatures as [(typeof p.creatures)[number], (typeof p.creatures)[number]];
  const hitsSkeleton = R.heroAttackRules(p, skeleton);
  assert.equal(hitsSkeleton.refused, null, "the skeleton is next to the hero");
  if (hitsSkeleton.refused === null) {
    assert.equal(hitsSkeleton.dice.target, 13, "the skeleton's AC");
  }
  const hitsGoblin = R.heroAttackRefusal(p, goblin);
  assert.match(String(hitsGoblin), /Too far away|You do not see/, "the goblin is not in reach");
  assert.equal(R.heroAttackRefusal(p, undefined), "Nothing left to fight. Press Reset scene to bring it back.");
});

test("a turn is one creature's: the engine moves and swings the creature named, and no other", () => {
  const p = scene("two");
  p.heroAt = { x: 12, y: 7 };
  p.hero = { ...p.hero, currentHp: 99, maxHp: 99 };
  R.noteSight(p);
  R.startFight(p, false, p.creatures);
  // Make it the skeleton's turn.
  const i = p.round!.order.findIndex((c) => c.id === "monster-2");
  p.round = { ...p.round!, activeIndex: i };
  const skeleton = p.creatures[1]!;
  const goblinAt = { ...p.creatures[0]!.at };
  const turn = R.monsterTurnRules(p, skeleton);
  // It walked toward the hero (or swung), and the goblin did not move.
  assert.deepEqual(p.creatures[0]!.at, goblinAt);
  assert.ok(turn.events.length > 0, "the skeleton did something");
  assert.ok(turn.events.every((e) => !("tokenId" in e) || e.tokenId === "monster-2" || e.tokenId === "hero"));
});

test("a save holds every creature, the fight and the room, and puts them back", () => {
  const p = scene("two");
  p.heroAt = { x: 12, y: 7 };
  R.noteSight(p);
  R.startFight(p, false, p.creatures);
  p.creatures[0]!.hp = 3;
  p.creatures[1]!.prone = true;
  p.creatures[1]!.carried = [];
  const snap = R.toSnapshot(p);
  assert.equal(snap.v, 2);
  assert.equal(snap.room, "two");
  assert.equal(snap.creatures.length, 2);
  assert.ok(snap.creatures.every((c) => !("actor" in c)), "the picture is not saved");
  assert.ok(snap.round);
  // It survives being written as text (a save lives in localStorage).
  const text = JSON.parse(JSON.stringify(snap)) as unknown;
  assert.equal(R.isSnapshot(text), true);
  const back = R.fromSnapshot(text)!;
  assert.deepEqual(back.creatures.map((c) => [c.id, c.token, c.hp, c.prone, c.awake, c.seen]), p.creatures.map((c) => [c.id, c.token, c.hp, c.prone, c.awake, c.seen]));
  assert.deepEqual(back.round, p.round);
  assert.equal(back.room, "two");
  assert.equal(back.creatureSeq, p.creatureSeq);
  assert.deepEqual(back.spawned, p.spawned);
  // Each creature comes back with a figure of its own.
  assert.notEqual(back.creatures[0]!.actor, back.creatures[1]!.actor);
});

test("a save with a fight that does not fit its creatures comes back as a scene with nobody fighting", () => {
  const p = scene("two");
  R.startFight(p, false, p.creatures);
  const snap = JSON.parse(JSON.stringify(R.toSnapshot(p))) as { round: { order: { id: string }[] } };
  snap.round.order[1]!.id = "monster-9";
  const back = R.fromSnapshot(snap)!;
  assert.equal(back.round, null);
  assert.equal(back.creatures.length, 2);
});

test("a save from before creatures (one monster) still loads, as one creature with its id", () => {
  const p = scene("one");
  p.creatures[0]!.hp = 4;
  p.creatures[0]!.seen = true;
  const snap = JSON.parse(JSON.stringify(R.toSnapshot(p))) as Record<string, unknown>;
  const c = (snap.creatures as { at: unknown; hp: number; awake: boolean; seen: boolean; carried: unknown }[])[0]!;
  const old: Record<string, unknown> = { ...snap, v: 1, monster: { at: c.at, hp: c.hp, awake: c.awake }, monsterSeen: c.seen, monsterCarried: c.carried, bodies: [], fallenAt: null };
  for (const k of ["creatures", "room", "spawned", "creatureSeq", "round"]) delete old[k];
  assert.equal(R.isSnapshot(old), true);
  const back = R.fromSnapshot(old)!;
  assert.deepEqual(back.creatures.map((x) => [x.id, x.token, x.hp, x.seen, x.hostile]), [["monster", "token_goblin", 4, true, true]]);
  assert.equal(back.room, "one");
  assert.equal(back.round, null);
  // Add a second creature: it takes the next id, and the first keeps its own.
  const next = R.addCreature(back, "token_skeleton", { x: 15, y: 5 });
  assert.equal(next.id, "monster-2");
  // An old save with the monster slain: no creatures, and the body (searched, as it was then) is the goblin's.
  const slain: Record<string, unknown> = { ...old, monster: null, fallenAt: { x: 16, y: 10 }, bodies: undefined };
  delete slain.bodies;
  const gone = R.fromSnapshot(slain)!;
  assert.equal(gone.creatures.length, 0);
  assert.deepEqual(gone.bodies.map((b) => [b.token, b.looted]), [["token_goblin", true]]);
});

test("junk is not a snapshot", () => {
  assert.equal(R.isSnapshot(null), false);
  assert.equal(R.isSnapshot({ v: 3 }), false);
  const p = scene("two");
  const snap = JSON.parse(JSON.stringify(R.toSnapshot(p))) as Record<string, unknown>;
  assert.equal(R.isSnapshot({ ...snap, room: "three" }), false);
  assert.equal(R.isSnapshot({ ...snap, creatures: [{ id: "monster" }] }), false);
  assert.equal(R.isSnapshot({ ...snap, creatures: [{ ...(snap.creatures as object[])[0], token: "token_nothing_at_all" }] }), false);
});
