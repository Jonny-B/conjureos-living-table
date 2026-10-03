/**
 * The table window's rules modules answer exactly as the bench's own copy does (scripts/asset-bench/assets.ts, until the port's
 * last step makes the bench call these modules instead). Two scenes are built by the two newPlays with the same arguments, put
 * through the same moves, and compared. Delete this file when assets.ts delegates: the two sides are then one function.
 *
 * Run: npx tsx --test test/livingtable-table-rules-parity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import bench, { ADVENTURE_RULES as A, PLAY_RULES as R } from "../scripts/asset-bench/assets";
import { PALETTE as _FP, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";
import { bindCatalog, type CatalogSprite } from "../src/games/livingtable/table/catalog";
import { createMemoryHost } from "../src/games/livingtable/table/hostDefault";
import { newPlay, type PlayState } from "../src/games/livingtable/table/state";
import { creatureNotices, engineLayout, noteSight, noticers } from "../src/games/livingtable/table/sight";
import { bindFightEnv, heroAttackRefusal, heroAttackRules, heroStepTo, startFight } from "../src/games/livingtable/table/fightRules";
import { applyWorldEffect, dmViewFor } from "../src/games/livingtable/table/dmScene";
import type { DmEffect } from "../src/games/livingtable/table/dmCore";

void bench;
void _FP;

type Rooms = "one" | "two";
const REAL = { fantasy: FANTASY_SPRITES as unknown as CatalogSprite[], scifi: SCIFI_SPRITES as unknown as CatalogSprite[] };
bindCatalog(createMemoryHost({ sprites: REAL }).art);

/** One scripted sequence of numbers, shared by both sides: each side gets its own copy at the start. */
function sequence(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Both sides draw from the same stream: the table through its bound source, the bench through the test hook it always had. */
function withDice<T>(seed: number, side: "bench" | "table", fn: () => T): T {
  const rng = sequence(seed);
  const g = globalThis as { __ltBenchRng?: unknown };
  const had = g.__ltBenchRng;
  const unbind = bindFightEnv({ rng });
  g.__ltBenchRng = rng;
  const original = Math.random;
  Math.random = sequence(seed + 1);
  try {
    void side;
    return fn();
  } finally {
    Math.random = original;
    g.__ltBenchRng = had;
    unbind();
  }
}

type Make = { template: "fantasy" | "scifi"; hero: string; floor: string; room: Rooms };
const MAKES: Make[] = [
  { template: "fantasy", hero: "knight", floor: "floor_stone", room: "one" },
  { template: "fantasy", hero: "knight", floor: "floor_stone", room: "two" },
  { template: "fantasy", hero: "shadow", floor: "floor_grass", room: "two" },
  { template: "scifi", hero: "trooper", floor: "floor_deckplate", room: "one" },
];

function both(m: Make): { b: PlayState; t: PlayState } {
  const args = [m.template, m.hero as never, m.floor, undefined, undefined, m.room] as const;
  return { b: R.newPlay(...args) as unknown as PlayState, t: newPlay(...args) };
}

/** What the DM would be told, and what the board would draw from, as comparable text. */
const view = (p: PlayState, fn: (p: PlayState) => unknown): string => JSON.stringify(fn(p));
const benchView = (p: PlayState): unknown => A.dmViewFor(p as never);
const SIGHT_KEYS = (p: PlayState): unknown => ({ explored: [...p.explored], rev: p.exploredRev, seen: p.creatures.map((c) => c.seen) });

test("the DM's view of a scene is the same text, in every room and both templates, as the doors and the hero move", () => {
  for (const m of MAKES) {
    const { b, t } = both(m);
    assert.equal(view(t, dmViewFor), view(b, benchView), `${m.template} ${m.room} at the start`);
    for (const p of [b, t]) {
      p.doorOpen = true;
      p.worldRev++;
      p.heroAt = { x: 11, y: 7 };
      R.noteSight(p as never);
    }
    assert.equal(view(t, dmViewFor), view(b, benchView), `${m.template} ${m.room} in the doorway`);
    assert.equal(JSON.stringify(SIGHT_KEYS(t)), JSON.stringify(SIGHT_KEYS(b)), `${m.template} ${m.room} what was explored`);
  }
});

test("sight, the wake rule and the engine's layout agree", () => {
  for (const m of MAKES) {
    const { b, t } = both(m);
    for (const at of [{ x: 4, y: 7 }, { x: 10, y: 7 }, { x: 11, y: 7 }, { x: 14, y: 5 }]) {
      for (const p of [b, t]) {
        p.doorOpen = at.x >= 10;
        p.worldRev++;
        p.heroAt = { ...at };
        R.noteSight(p as never);
      }
      assert.deepEqual(noticers(t).map((c) => c.id), R.noticers(b as never).map((c) => c.id), `${m.room} noticers at ${at.x},${at.y}`);
      assert.deepEqual(t.creatures.map((c) => creatureNotices(t, c)), b.creatures.map((c) => R.creatureNotices(b as never, c as never)));
      assert.deepEqual(engineLayout(t), R.engineLayout(b as never));
    }
  }
});

test("a step, a swing and a refusal come out the same with the same dice", () => {
  for (const seed of [1, 7, 42, 99]) {
    const { b, t } = both({ template: "fantasy", hero: "knight", floor: "floor_stone", room: "two" });
    for (const p of [b, t]) {
      p.heroAt = { x: 14, y: 5 };
      R.noteSight(p as never);
    }
    const fromT = withDice(seed, "table", () => {
      const out = heroAttackRules(t, t.creatures[1]!);
      return out.refused === null ? { dice: out.dice, events: out.apply() } : out;
    });
    const fromB = withDice(seed, "bench", () => {
      const out = R.heroAttackRules(b as never, b.creatures[1]! as never);
      return out.refused === null ? { dice: out.dice, events: out.apply() } : out;
    });
    assert.deepEqual(JSON.parse(JSON.stringify(fromT)), JSON.parse(JSON.stringify(fromB)), `swing, seed ${seed}`);
    assert.deepEqual(t.log, b.log, `log, seed ${seed}`);
    assert.equal(t.creatures[1]?.hp, b.creatures[1]?.hp);
    assert.equal(heroAttackRefusal(t, t.creatures[0]), R.heroAttackRefusal(b as never, b.creatures[0] as never));
    for (const to of [{ x: 15, y: 5 }, { x: 13, y: 5 }, { x: 0, y: 0 }, { x: 20, y: 20 }]) {
      assert.deepEqual(heroStepTo(t, to), A.heroStepTo(b as never, to) as unknown);
    }
  }
});

test("a fight starts with the same order on both sides", () => {
  const { b, t } = both({ template: "fantasy", hero: "knight", floor: "floor_stone", room: "two" });
  withDice(5, "table", () => startFight(t, false, t.creatures));
  withDice(5, "bench", () => R.startFight(b as never, false, b.creatures as never));
  assert.deepEqual(t.round?.order.map((c) => [c.id, c.initiative]), b.round?.order.map((c) => [c.id, c.initiative]));
  assert.deepEqual(t.log, b.log);
  noteSight(t);
});

test("the DM's effects change the scene identically and refuse in the same words", () => {
  const effects = [
    { type: "place", asset: "barrel", x: 6, y: 6, label: "a barrel" },
    { type: "place", asset: "barrel", x: 6, y: 6, label: "again" },
    { type: "place", asset: "barrel", x: 0, y: 0, label: "in the wall" },
    { type: "place", asset: "barrel", x: 4, y: 7, label: "on the hero" },
    { type: "alter", id: "prop-0", asset: "torch", label: "a torch" },
    { type: "alter", id: "prop-0", asset: "not_a_prop" },
    { type: "alter", id: "door", label: "x" },
    { type: "tile", tile: "floor_grass", x: 8, y: 5 },
    { type: "tile", tile: "wall_stone", x: 9, y: 5 },
    { type: "tile", tile: "wall_stone", x: 6, y: 6 },
    { type: "tile", tile: "floor_grass", x: 0, y: 5 },
    { type: "remove", id: "prop-0" },
    { type: "remove", id: "door" },
    { type: "remove", id: "tile-8-5" },
    { type: "potion", count: 1 },
    { type: "potion", count: 3 },
    { type: "potion", count: 1 },
    { type: "door", state: "open" },
    { type: "door", state: "locked" },
    { type: "monster", act: "spawn", x: 7, y: 3 },
    { type: "monster", act: "spawn", x: 7, y: 3 },
    { type: "monster", act: "wake", id: "monster" },
    { type: "monster", act: "calm", id: "monster" },
    { type: "monster", act: "flee", id: "monster" },
    { type: "monster", act: "flee", id: "nobody" },
    { type: "give", item: "a silver ring", desc: "cold to the touch", quest: true },
    { type: "take", item: "silver ring" },
    { type: "take", item: "a thing it never had" },
    { type: "progress", step: { kind: "flag", flag: "x" } },
    { type: "nonsense" },
  ] as unknown as DmEffect[];
  for (const m of MAKES) {
    const { b, t } = both(m);
    effects.forEach((e, i) => {
      // A creature the effect names carries random coins from its own newPlay, so a wake is compared by id.
      const shape = (o: object): string => {
        const w = (o as { wake?: { id: string } }).wake;
        return JSON.stringify({ ...o, ...(w ? { wake: w.id } : {}) });
      };
      const gotT = shape(applyWorldEffect(t, e));
      const gotB = shape(A.applyWorldEffect(b as never, e as never));
      assert.equal(gotT, gotB, `${m.template} ${m.room} effect ${i} ${JSON.stringify(e)}`);
      const keep = (p: PlayState): string =>
        JSON.stringify({
          props: p.extraProps,
          tiles: p.tileOverrides,
          rev: p.worldRev,
          door: [p.doorOpen, p.doorLocked],
          potions: [p.potions, p.potionsGranted],
          inventory: p.hero.inventory,
          notes: p.itemNotes,
          flags: p.itemFlags,
          creatures: p.creatures.map((c) => [c.id, c.token, c.at, c.awake, c.hp]),
        });
      assert.equal(keep(t), keep(b), `${m.template} ${m.room} scene after effect ${i}`);
    });
  }
});
