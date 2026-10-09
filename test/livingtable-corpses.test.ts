/**
 * Tests for what a creature carries and the body it leaves
 * (src/games/livingtable/rules/corpses.ts).
 *
 * Run: npx -y tsx --test test/livingtable-corpses.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bodyFor,
  carriedBy,
  harvestFor,
  harvestForToken,
  itemNotes,
  pocketPick,
  takeFromBody,
} from "../src/games/livingtable/rules/corpses";
import type { CarriedItem } from "../src/games/livingtable/rules/corpses";
import { BESTIARY, beastById } from "../src/games/livingtable/rules/bestiary";
import { MONSTER_STATBLOCKS } from "../src/games/livingtable/session/combat";

/** Built from char codes so this file itself carries no dash character. */
const EM = String.fromCharCode(8212);
const EN = String.fromCharCode(8211);
const hasDash = (s: string): boolean => s.includes(EM) || s.includes(EN);

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function names(items: CarriedItem[]): string[] {
  return items.map((i) => i.name);
}

const goblin = beastById("goblin")!;
const wolf = beastById("wolf")!;
const skeleton = beastById("skeleton")!;

test("a goblin carries scimitar, shortbow, leather armor and shield, then coins", () => {
  const items = carriedBy(goblin, seeded(1));
  assert.deepEqual(names(items).slice(0, 4), ["Scimitar", "Shortbow", "Leather armor", "Shield"]);
  const coins = items.find((i) => i.kind === "coins");
  assert.ok(coins, "a goblin has a purse");
  assert.match(coins.name, /^\d+ copper pieces$/);
  assert.match(coins.note, /only something you carry/i);
  assert.doesNotMatch(coins.note, /does not track|DM does/i);
  assert.ok(items.length === 5 || items.length === 6, "purse plus at most one trinket");
});

test("natural attacks and natural armor are never emitted", () => {
  for (const b of BESTIARY) {
    for (const it of carriedBy(b, seeded(7))) {
      assert.ok(!/^(bite|claws?|slam|gore|beak|pseudopod|life drain|blood drain|rock)$/i.test(it.name), `${b.id}: ${it.name}`);
      assert.ok(!/natural armor/i.test(it.name), `${b.id}: ${it.name}`);
    }
  }
});

test("beasts carry nothing; a wolf harvests a pelt", () => {
  assert.deepEqual(carriedBy(wolf, seeded(3)), []);
  for (const b of BESTIARY.filter((x) => /^beast\b/.test(x.type))) {
    assert.deepEqual(carriedBy(b, seeded(3)), [], b.id);
  }
  const h = harvestFor(wolf);
  assert.ok(h);
  assert.equal(h.item.name, "Wolf pelt");
  assert.equal(h.item.kind, "part");
  assert.equal(h.item.pocketable, false);
  assert.equal(h.skill, "Survival");
  assert.equal(typeof h.dc, "number");
  assert.equal(harvestFor(goblin), null, "a person is not harvested");
  assert.equal(harvestFor(beastById("orc") ?? goblin), null, "nor is an orc");
});

test("a rat and a giant rat give a pelt: a small Survival check, nothing grand", () => {
  const rat = harvestFor(beastById("rat")!);
  assert.ok(rat, "the rat was the owner's case: Harvest on its body must work");
  assert.equal(rat.item.kind, "part");
  assert.equal(rat.item.pocketable, false);
  assert.equal(rat.skill, "Survival");
  assert.ok(rat.dc <= 10, "a low DC");
  assert.match(rat.item.note, /Worth (a copper|next to nothing|about)/);
  const giant = harvestFor(beastById("giant-rat")!);
  assert.ok(giant);
  assert.notEqual(giant.item.name, rat.item.name);
  assert.ok(giant.dc <= 10);
});

test("harvestForToken reads the token a body was made from: rats yield a part, a goblin, a skeleton or an unknown token does not", () => {
  assert.ok(harvestForToken("token_rat"));
  assert.ok(harvestForToken("token_giant_rat"));
  assert.equal(harvestForToken("token_rat")?.item.name, "Rat pelt");
  assert.equal(harvestForToken("token_skeleton"), null, "bones give nothing");
  assert.equal(harvestForToken("token_goblin"), null);
  assert.equal(harvestForToken("token_raider"), null);
  assert.equal(harvestForToken("token_nothing_like_it"), null);
  assert.equal(harvestForToken(""), null);
});

test("harvest table: every entry is a part with a skill, a DC and a note", () => {
  let found = 0;
  for (const b of BESTIARY) {
    const h = harvestFor(b);
    if (!h) continue;
    found += 1;
    assert.equal(h.item.kind, "part");
    assert.ok(h.item.note.length > 10);
    assert.ok(h.skill === "Survival" || h.skill === "Nature");
    assert.ok(h.dc >= 8 && h.dc <= 20, `${b.id} dc ${h.dc}`);
  }
  assert.ok(found >= 8);
});

test("a skeleton carries its shortsword and shortbow, armor scraps, never coins", () => {
  const items = carriedBy(skeleton, seeded(2));
  const n = names(items);
  assert.ok(n.includes("Shortsword"));
  assert.ok(n.includes("Shortbow"));
  assert.ok(n.includes("Armor scraps"));
  assert.ok(!items.some((i) => i.kind === "coins"));
  for (const it of items) assert.ok(["Shortsword", "Shortbow", "Armor scraps", "Grave token"].includes(it.name), it.name);
});

test("a zombie with no armor carries burial tatters; ghosts carry nothing", () => {
  assert.ok(names(carriedBy("zombie", seeded(4))).includes("Burial tatters"));
  assert.deepEqual(carriedBy("specter", seeded(4)), []);
  assert.deepEqual(carriedBy("wraith", seeded(4)), []);
});

test("tokens work by token id: goblin, skeleton, raider, drone", () => {
  assert.deepEqual(names(carriedBy("token_goblin", seeded(1))), names(carriedBy(goblin, seeded(1))));
  assert.deepEqual(names(carriedBy("token_skeleton", seeded(1))), names(carriedBy(skeleton, seeded(1))));
  const raider = carriedBy("token_raider", seeded(5));
  assert.deepEqual(names(raider).slice(0, 2), ["Scavenged sidearm", "Patched leather armor"]);
  assert.ok(raider.some((i) => i.kind === "coins"));
  assert.deepEqual(carriedBy("token_drone", seeded(5)), []);
  assert.deepEqual(carriedBy("token_who_knows", seeded(5)), []);
});

test("every token id the game fights with is understood, and names agree with MONSTER_STATBLOCKS", () => {
  for (const [id, sb] of Object.entries(MONSTER_STATBLOCKS)) {
    const body = bodyFor(`b_${id}`, id, { x: 1, y: 1 }, undefined, seeded(1));
    assert.equal(body.name, sb.name, id);
  }
});

test("a purse is sized by tier and is a real coin item", () => {
  const purse = (id: string, seed: number) => carriedBy(id, seeded(seed)).find((i) => i.kind === "coins")!;
  for (let s = 1; s <= 30; s += 1) {
    const g = purse("goblin", s);
    const n = Number(/^(\d+)/.exec(g.name)![1]);
    assert.ok(n >= 2 && n <= 12 && /copper/.test(g.name), g.name);
    const h = purse("hobgoblin", s);
    assert.ok(/silver/.test(h.name), h.name);
    const o = purse("ogre", s);
    assert.ok(/gold/.test(o.name), o.name);
    const gi = purse("hill-giant", s);
    const m = Number(/^(\d+)/.exec(gi.name)![1]);
    assert.ok(m >= 5 && m <= 30, gi.name);
  }
});

test("deterministic with a seeded rng, and the seed matters", () => {
  const a = carriedBy("goblin", seeded(42));
  const b = carriedBy("goblin", seeded(42));
  assert.deepEqual(a, b);
  const seen = new Set<string>();
  for (let s = 1; s <= 40; s += 1) seen.add(JSON.stringify(carriedBy("goblin", seeded(s))));
  assert.ok(seen.size > 3, "different seeds give different purses and trinkets");
  assert.deepEqual(pocketPick(a, seeded(9)), pocketPick(a, seeded(9)));
});

test("some goblins carry a trinket and some do not", () => {
  let withTrinket = 0;
  let without = 0;
  for (let s = 1; s <= 60; s += 1) {
    const items = carriedBy("goblin", seeded(s));
    if (items.some((i) => i.kind === "trinket")) withTrinket += 1;
    else without += 1;
  }
  assert.ok(withTrinket > 5 && without > 5, `${withTrinket} with, ${without} without`);
});

test("pocketPick never returns armor, a part or an unpocketable item", () => {
  for (const id of ["goblin", "hobgoblin", "ogre", "token_raider", "skeleton", "zombie", "kobold"]) {
    for (let s = 1; s <= 25; s += 1) {
      const carried = carriedBy(id, seeded(s));
      const { item, rest } = pocketPick(carried, seeded(s + 100));
      if (item) {
        assert.equal(item.pocketable, true);
        assert.notEqual(item.kind, "armor");
        assert.notEqual(item.kind, "part");
        assert.equal(rest.length, carried.length - 1);
      } else {
        assert.equal(rest.length, carried.length);
        assert.ok(carried.every((c) => !c.pocketable));
      }
    }
  }
  const armorOnly: CarriedItem[] = carriedBy("goblin", seeded(1)).filter((i) => i.kind === "armor");
  const r = pocketPick(armorOnly, seeded(1));
  assert.equal(r.item, null);
  assert.equal(r.rest.length, armorOnly.length);
  assert.deepEqual(pocketPick([], seeded(1)), { item: null, rest: [] });
});

test("a pickpocketed item is gone from the body", () => {
  const carried = carriedBy("goblin", seeded(11));
  const { item, rest } = pocketPick(carried, seeded(3));
  assert.ok(item);
  const body = bodyFor("g1", "token_goblin", { x: 4, y: 2 }, rest);
  assert.equal(body.items.length, carried.length - 1);
  assert.ok(!body.items.some((i) => i.name === item.name));
  assert.equal(body.beast, false);
  assert.equal(body.looted, false);
  assert.equal(body.harvested, false);
  assert.equal(body.engineLootRolled, false);
  assert.equal(body.name, "Goblin");
  assert.deepEqual(body.at, { x: 4, y: 2 });
});

test("bodyFor without a carried list rolls the full list; a wolf body is a beast with nothing on it", () => {
  const full = bodyFor("g2", goblin, { x: 0, y: 0 }, undefined, seeded(8));
  assert.deepEqual(full.items, carriedBy(goblin, seeded(8)));
  const w = bodyFor("w1", wolf, { x: 2, y: 2 });
  assert.equal(w.beast, true);
  assert.deepEqual(w.items, []);
  assert.equal(w.name, "Wolf");
});

test("takeFromBody: one item, then all, without mutating the original", () => {
  const body = bodyFor("g3", goblin, { x: 1, y: 1 }, undefined, seeded(5));
  const before = JSON.stringify(body);
  const one = takeFromBody(body, "scimitar");
  assert.equal(JSON.stringify(body), before, "input untouched");
  assert.deepEqual(names(one.taken), ["Scimitar"]);
  assert.equal(one.body.items.length, body.items.length - 1);
  assert.equal(one.body.looted, false);

  const none = takeFromBody(one.body, "Scimitar");
  assert.deepEqual(none.taken, []);
  assert.equal(none.body.items.length, one.body.items.length);

  const all = takeFromBody(one.body, "all");
  assert.equal(all.taken.length, one.body.items.length);
  assert.deepEqual(all.body.items, []);
  assert.equal(all.body.looted, true);

  let b = body;
  for (const n of names(body.items)) b = takeFromBody(b, n).body;
  assert.equal(b.looted, true, "taking the last item marks it looted");

  const empty = takeFromBody(bodyFor("w2", wolf, { x: 0, y: 0 }), "all");
  assert.deepEqual(empty.taken, []);
  assert.equal(empty.body.looted, true);
});

test("every emitted item has a real note, a valid kind, and fits describeCarried's notes shape", () => {
  const kinds = new Set(["weapon", "armor", "coins", "trinket", "part"]);
  let total = 0;
  for (const b of BESTIARY) {
    const items = [...carriedBy(b, seeded(13))];
    const h = harvestFor(b);
    if (h) items.push(h.item);
    for (const it of items) {
      total += 1;
      assert.ok(it.note.trim().length >= 12, `${b.id} ${it.name}`);
      assert.ok(kinds.has(it.kind), it.kind);
      assert.equal(typeof it.pocketable, "boolean");
      if (it.kind === "armor" || it.kind === "part") assert.equal(it.pocketable, false, it.name);
      if (it.kind === "coins") assert.match(it.note, /only something you carry/i);
    }
    const notes = itemNotes(items);
    for (const it of items) assert.equal(notes[it.name], it.note);
  }
  assert.ok(total > 50);
});

test("the source file and every string it emits contain no dash characters", () => {
  const src = readFileSync(new URL("../src/games/livingtable/rules/corpses.ts", import.meta.url), "utf8");
  assert.ok(!hasDash(src), "no em or en dash in the module");
  for (const b of BESTIARY) {
    for (const it of carriedBy(b, seeded(21))) assert.ok(!hasDash(it.name + it.note), `${b.id} ${it.name}`);
    const h = harvestFor(b);
    if (h) assert.ok(!hasDash(h.item.name + h.item.note), b.id);
  }
  for (const id of ["token_raider", "token_drone"]) {
    for (const it of carriedBy(id, seeded(21))) assert.ok(!hasDash(it.name + it.note), id);
  }
});
