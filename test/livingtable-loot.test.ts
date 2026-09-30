/**
 * Tests for The Living Table's engine-rolled loot (src/games/livingtable/rules/loot.ts).
 *
 * The load-bearing rule, restated for this file specifically: the AI dungeon
 * master never chooses an item, never chooses a tier, and never grants gear.
 * Every test below proves the engine's own die decides that, deterministically,
 * from an injected `rng` -- never `Math.random`, so a claimed d100 face is
 * actually forced rather than hoped for.
 *
 * Run: npx tsx --test test/livingtable-loot.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lootFor, lootDmNote, eligibleRolesFor } from "../src/games/livingtable/rules/loot";
import {
  GEAR_ROLES,
  LOOT_LEDGER_MAX_CELLS,
  LOOT_ROLLS_PER_CELL,
  gearItemName,
  lootCellKey,
  type LootSheet,
  type BagItem,
  type Equipment,
} from "../src/games/livingtable/characters/equipmentTypes";

/** A fresh loot-eligible sheet: no equipment (reads as all-common per the contract's own defaulting), no bag, no ledger. */
function freshSheet(archetypeId = "knight"): LootSheet {
  return { archetypeId, equipment: {}, bag: [] };
}

/** An rng that returns each value in `sequence` in order, then throws if called again -- so a test that claims "exactly N calls" actually fails loudly on an N+1th. */
function scriptedRng(sequence: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= sequence.length) throw new Error(`rng called more times than scripted (${sequence.length})`);
    return sequence[i++]!;
  };
}

test("the worked example, verbatim from the contract: rng [0.87, 0.5] on a fresh character rolls d100 = 88 (rare), d6 = 4, and lands on the ring, granting Ring of Protection", () => {
  const { sheet, roll } = lootFor(freshSheet(), { source: "fight", cx: 0, cy: 0 }, scriptedRng([0.87, 0.5]));
  assert.ok(roll);
  assert.equal(roll!.tierRoll, 88);
  assert.equal(roll!.tier, "rare");
  assert.deepEqual(roll!.eligible, GEAR_ROLES, "a fresh character owns nothing, so every role is eligible");
  assert.equal(roll!.slotDie, 6);
  assert.equal(roll!.slotRoll, 4);
  assert.deepEqual(roll!.item, { slot: "ring", tier: "rare" });
  assert.deepEqual(sheet.bag, [{ slot: "ring", tier: "rare" }]);
  assert.equal(gearItemName("knight", "ring", "rare"), "Ring of Protection");
});

test("band edges: 40 is nothing, 41 is uncommon, 75/76 is the uncommon/rare seam, 95/96 is the rare/legendary seam, 100 is legendary", () => {
  const tierOf = (d100Face: number): string | null => {
    // face N is produced by rng() = (N - 1) / 100, the smallest value that
    // floors to N - 1 and produces rollDie(100, rng) === N.
    const { roll } = lootFor(freshSheet(), { source: "fight", cx: d100Face, cy: 0 }, scriptedRng([(d100Face - 1) / 100, 0]));
    return roll!.tier;
  };
  assert.equal(tierOf(1), null);
  assert.equal(tierOf(40), null, "the top of the nothing band");
  assert.equal(tierOf(41), "uncommon", "the bottom of the uncommon band");
  assert.equal(tierOf(75), "uncommon", "the top of the uncommon band");
  assert.equal(tierOf(76), "rare", "the bottom of the rare band");
  assert.equal(tierOf(95), "rare", "the top of the rare band");
  assert.equal(tierOf(96), "legendary", "the bottom of the legendary band");
  assert.equal(tierOf(100), "legendary", "the top, and the only way to reach it");
});

test("determinism: rng is called exactly once for a nothing result, and exactly twice only when two or more roles are still eligible", () => {
  // face 1..40: nothing. Exactly one rng call; a second call would throw
  // because scriptedRng only has one value queued.
  const nothing = lootFor(freshSheet(), { source: "fight", cx: 1, cy: 0 }, scriptedRng([0])); // face 1
  assert.equal(nothing.roll!.tier, null);
  assert.equal(nothing.roll!.slotDie, 0);
  assert.equal(nothing.roll!.slotRoll, null);

  // A character who already owns every uncommon piece leaves exactly ONE
  // uncommon role eligible in the shipped roster (boots -- see the next
  // test for the full single-eligible walk), so a d100 landing uncommon
  // resolves with no second die at all.
  const ownsAllButBoots: Equipment = {
    weapon: { slot: "weapon", tier: "uncommon" },
    outer: { slot: "outer", tier: "uncommon" },
    crown: { slot: "crown", tier: "uncommon" },
    ring: { slot: "ring", tier: "uncommon" },
    amulet: { slot: "amulet", tier: "uncommon" },
  };
  const almostFull: LootSheet = { archetypeId: "knight", equipment: ownsAllButBoots, bag: [] };
  const single = lootFor(almostFull, { source: "container", cx: 2, cy: 0 }, scriptedRng([0.5])); // d100 = 51, uncommon
  assert.equal(single.roll!.tier, "uncommon");
  assert.deepEqual(single.roll!.eligible, ["boots"]);
  assert.equal(single.roll!.slotDie, 0, "no second die when only one role is left");
  assert.equal(single.roll!.slotRoll, null);
  assert.deepEqual(single.roll!.item, { slot: "boots", tier: "uncommon" });
});

test("never grants an item already owned (worn OR bagged), and eligible never includes an empty rung", () => {
  const ownsEverythingRare: Equipment = {
    weapon: { slot: "weapon", tier: "rare" },
    outer: { slot: "outer", tier: "rare" },
    crown: { slot: "crown", tier: "rare" },
    ring: { slot: "ring", tier: "rare" },
    amulet: { slot: "amulet", tier: "rare" },
    boots: { slot: "boots", tier: "rare" },
  };
  const sheet: LootSheet = { archetypeId: "knight", equipment: ownsEverythingRare, bag: [] };
  assert.deepEqual(eligibleRolesFor(sheet, "rare"), [], "every rare piece is already worn");

  // Bagged, not worn, is ALSO already owned.
  const bagged: LootSheet = {
    archetypeId: "knight",
    equipment: {},
    bag: [{ slot: "weapon", tier: "uncommon" }, { slot: "outer", tier: "uncommon" }],
  };
  const eligibleUncommon = eligibleRolesFor(bagged, "uncommon");
  assert.ok(!eligibleUncommon.includes("weapon"));
  assert.ok(!eligibleUncommon.includes("outer"));
  assert.ok(eligibleUncommon.includes("crown"), "an uncommon crown is real and not yet owned");

  // The two intentionally empty rungs: no amulet or boots item at legendary,
  // for ANY archetype.
  for (const archetypeId of ["knight", "trooper", "fireball-person", "psion"]) {
    const eligibleLegendary = eligibleRolesFor(freshSheet(archetypeId), "legendary");
    assert.ok(!eligibleLegendary.includes("amulet"), `${archetypeId}: no legendary amulet exists`);
    assert.ok(!eligibleLegendary.includes("boots"), `${archetypeId}: no legendary boots exist`);
  }
});

test("a roll that finds nothing new still counts against the cell, and a roll past LOOT_ROLLS_PER_CELL makes no roll and no rng call at all", () => {
  const sheet = freshSheet();
  const at = { source: "fight" as const, cx: 5, cy: 5 };

  const first = lootFor(sheet, at, scriptedRng([0.87, 0.5])); // uses both dice
  assert.ok(first.roll);
  assert.equal(first.sheet.lootLedger?.rollsByCell[lootCellKey(5, 5)], 1);

  const second = lootFor(first.sheet, at, scriptedRng([0.1])); // nothing band, one die
  assert.ok(second.roll);
  assert.equal(second.sheet.lootLedger?.rollsByCell[lootCellKey(5, 5)], LOOT_ROLLS_PER_CELL);

  // Third roll in the same cell is past the cap: scriptedRng([]) throws the
  // moment it is called even once, so this also proves zero rng calls.
  const third = lootFor(second.sheet, at, scriptedRng([]));
  assert.equal(third.roll, null);
  assert.equal(third.sheet, second.sheet, "an over-cap roll returns the SAME sheet object, unchanged");
});

test("the ledger evicts its oldest cell once more than LOOT_LEDGER_MAX_CELLS have rolled", () => {
  let sheet: LootSheet = freshSheet();
  for (let i = 0; i < LOOT_LEDGER_MAX_CELLS; i++) {
    sheet = lootFor(sheet, { source: "fight", cx: i, cy: 0 }, scriptedRng([0.1])).sheet; // nothing band, one die each
  }
  assert.equal(Object.keys(sheet.lootLedger!.rollsByCell).length, LOOT_LEDGER_MAX_CELLS);
  assert.ok(lootCellKey(0, 0) in sheet.lootLedger!.rollsByCell, "the very first cell is still remembered");

  // One more, brand new cell: the oldest key (cell 0) is evicted, the ledger
  // stays at its ceiling, and every other key survives.
  sheet = lootFor(sheet, { source: "fight", cx: LOOT_LEDGER_MAX_CELLS, cy: 0 }, scriptedRng([0.1])).sheet;
  assert.equal(Object.keys(sheet.lootLedger!.rollsByCell).length, LOOT_LEDGER_MAX_CELLS);
  assert.ok(!(lootCellKey(0, 0) in sheet.lootLedger!.rollsByCell), "the oldest cell is evicted");
  assert.ok(lootCellKey(1, 0) in sheet.lootLedger!.rollsByCell, "the second-oldest survives");
  assert.ok(lootCellKey(LOOT_LEDGER_MAX_CELLS, 0) in sheet.lootLedger!.rollsByCell, "the new cell is recorded");
});

test("lootFor never mutates equipment or inventory, only lootLedger and (on a find) bag", () => {
  const equipment: Equipment = { weapon: { slot: "weapon", tier: "legendary" } };
  const sheet = { archetypeId: "knight", equipment, bag: [] as BagItem[], inventory: ["a coil of rope"] };
  const { sheet: after } = lootFor(sheet, { source: "container", cx: 0, cy: 0 }, scriptedRng([0.5, 0.5]));
  assert.equal(after.equipment, sheet.equipment, "same reference: equipment is never touched");
  assert.equal(after.inventory, sheet.inventory, "same reference: the flavour inventory is never touched");
});

test("lootDmNote: the pinned fact line, verbatim, for a find and for nothing", () => {
  const { roll } = lootFor(freshSheet(), { source: "fight", cx: 0, cy: 0 }, scriptedRng([0.87, 0.5]));
  assert.equal(
    lootDmNote(roll!, "Ring of Protection", "the fight"),
    "the engine rolled loot from the fight: Ring of Protection (rare) is now in the player's pack. Narrate the find. The item and its quality are already decided; do not name a different one.",
  );

  const { roll: nothingRoll } = lootFor(freshSheet(), { source: "container", cx: 9, cy: 9 }, scriptedRng([0.1]));
  assert.equal(
    lootDmNote(nothingRoll!, null, "the chest"),
    "the engine rolled loot from the chest and nothing magical turned up. Describe ordinary odds and ends if you like, never a magic item.",
  );
});
