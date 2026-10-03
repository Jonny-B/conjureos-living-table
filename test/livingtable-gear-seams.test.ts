/**
 * The Living Table, contract v2 (inventory, attunement, loot): the SEAMS
 * between lanes. Six lanes built this feature against one contract in
 * parallel; each test here pins a place where two of their halves met and the
 * integration pass found the join open (a cap checked on a capped count, a
 * rest that never read the amulet, a DM view nobody populated, a sentence
 * reading a speed that already included the boots, and so on).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { commitLoadout, draftFromSheet, normalizeBag, stageEquip } from "../src/games/livingtable/rules/inventory";
import { attunedRoles } from "../src/games/livingtable/rules/attunement";
import { eligibleRolesFor } from "../src/games/livingtable/rules/loot";
import { longRest, shortRest } from "../src/games/livingtable/characters/health";
import { createCharacter, normalizeItemCharges, normalizeSheet, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { effectiveSpeedFt, evasionRescue, speedBeforeBootsFt } from "../src/games/livingtable/session/combat";
import { accessoryCopy, gearView } from "../src/games/livingtable/menu/equipment";
import { GLOSSARY, explain } from "../src/games/livingtable/menu/labels";
import type { Equipment, LoadoutDraft } from "../src/games/livingtable/characters/equipmentTypes";

function knight(): CharacterSheet {
  return createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
}

function wearing(sheet: CharacterSheet, extra: Equipment): CharacterSheet {
  return { ...sheet, equipment: { ...sheet.equipment, ...extra } };
}

/** A deterministic rng from a fixed list of draws, which fails loudly if asked for one more. */
function draws(...values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng asked for draw ${i + 1}, only ${values.length} supplied`);
    return values[i++]!;
  };
}

// ── staging and commit ───────────────────────────────────────────────────

test("commitLoadout refuses a draft that WEARS four attunement items, although attunedRoles alone would only ever report three", () => {
  const owner: CharacterSheet = {
    ...knight(),
    bag: [
      { slot: "weapon", tier: "legendary" },
      { slot: "ring", tier: "rare" },
      { slot: "amulet", tier: "rare" },
      { slot: "boots", tier: "rare" },
    ],
  };
  const smuggled: LoadoutDraft = {
    equipment: {
      weapon: { slot: "weapon", tier: "legendary" },
      outer: { slot: "outer", tier: "common" },
      crown: { slot: "crown", tier: "common" },
      ring: { slot: "ring", tier: "rare" },
      amulet: { slot: "amulet", tier: "rare" },
      boots: { slot: "boots", tier: "rare" },
    },
    bag: [],
  };
  assert.equal(attunedRoles("knight", smuggled.equipment).length, 3, "attunedRoles slices at the cap, so it cannot be the cap check");
  assert.equal(commitLoadout(owner, smuggled), owner, "a fourth attunement item must return the sheet unchanged");
});

test("staging nothing and pressing Ok changes nothing", () => {
  const sheet: CharacterSheet = { ...knight(), bag: [{ slot: "ring", tier: "rare" }] };
  assert.deepEqual(commitLoadout(sheet, draftFromSheet(sheet)), sheet);
});

test("an archetype the tables do not know reads as no gear at every rules entry point, never a throw", () => {
  const draft: LoadoutDraft = { equipment: {}, bag: [{ slot: "weapon", tier: "rare" }] };
  assert.deepEqual(attunedRoles("bogus", { weapon: { slot: "weapon", tier: "legendary" } }), []);
  assert.equal(stageEquip("bogus", draft, 0).ok, false);
  const sheet = { archetypeId: "bogus", equipment: {}, bag: [] };
  assert.equal(commitLoadout(sheet, draft), sheet);
  assert.deepEqual(normalizeBag([{ slot: "ring", tier: "rare" }], "bogus", {}), []);
  assert.deepEqual(eligibleRolesFor({ archetypeId: "bogus" }, "rare"), []);
});

// ── the load boundary ─────────────────────────────────────────────────────

test("normalizeSheet runs a stored v1 three-key equipment through the six-role normaliser, not a bare default", () => {
  const legacy = {
    ...knight(),
    equipment: { weapon: { slot: "weapon", tier: "rare" }, outer: { slot: "outer", tier: "bogus" }, crown: { slot: "crown", tier: "common" } },
  } as unknown as CharacterSheet;
  assert.deepEqual(normalizeSheet(legacy).equipment, {
    weapon: { slot: "weapon", tier: "rare" },
    outer: { slot: "outer", tier: "common" },
    crown: { slot: "crown", tier: "common" },
    boots: { slot: "boots", tier: "common" },
  });
});

test("stored item charges keep only real charged items, each cut to that item's own maximum", () => {
  assert.deepEqual(normalizeItemCharges({ "ring:uncommon": 99, "weapon:rare": 2, "ring:rare": 1, junk: 4 }), { "ring:uncommon": 3 });
  assert.deepEqual(normalizeItemCharges({ "ring:uncommon": 1.8 }), { "ring:uncommon": 1 });
  assert.deepEqual(normalizeItemCharges(undefined), {}, "absent means every item is full");
});

test("evasionRescue reads an oversized stored charge count as the ring's own maximum, never a bigger pool", () => {
  const sheet: CharacterSheet = { ...wearing(knight(), { ring: { slot: "ring", tier: "uncommon" } }), itemCharges: { "ring:uncommon": 50 } };
  const rescue = evasionRescue(sheet, "dex", { roll: 2, modifier: 0, total: 2, dc: 15, success: false } as never);
  assert.ok(rescue);
  assert.equal(rescue!.sheet.itemCharges?.["ring:uncommon"], 2);
  assert.match(rescue!.note, /2 of 3 charges left/);
});

// ── rests: the three rest-tied SRD items ─────────────────────────────────

test("a short rest doubles the hit die with a worn Periapt of Wound Closure, then a worn Ring of Regeneration rolls 6d6 after it", () => {
  const sheet: CharacterSheet = {
    ...wearing(knight(), { amulet: { slot: "amulet", tier: "uncommon" }, ring: { slot: "ring", tier: "legendary" } }),
    currentHp: 1,
    maxHp: 60,
  };
  // d10 hit die at 0.4 is a 5, +2 Constitution is 7, doubled is 14. Then 6d6 at 0.5 is six 4s, 24.
  const out = shortRest(sheet, draws(0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5));
  assert.equal(out.sheet.currentHp, 1 + 14 + 24);
  assert.match(out.note, /doubled by the Periapt of Wound Closure\): 14 hit points back/);
  assert.match(out.note, /Ring of Regeneration: 24 more hit points \(6d6 rolled 24\)/);
});

test("a periapt and a ring sitting in the BAG do nothing at a short rest", () => {
  const sheet: CharacterSheet = {
    ...knight(),
    currentHp: 1,
    maxHp: 60,
    bag: [
      { slot: "amulet", tier: "uncommon" },
      { slot: "ring", tier: "legendary" },
    ],
  };
  const out = shortRest(sheet, draws(0.4));
  assert.equal(out.sheet.currentHp, 1 + 7, "the bag is not the neck or the finger, and no 6d6 was asked for");
});

test("the Ring of Regeneration's payout is capped at the hit point maximum, and the note says what was gained, not only what was rolled", () => {
  const sheet: CharacterSheet = { ...wearing(knight(), { ring: { slot: "ring", tier: "legendary" } }), currentHp: 1 };
  const out = shortRest(sheet, draws(0.4, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99));
  assert.equal(out.sheet.currentHp, out.sheet.maxHp);
  const gained = out.sheet.maxHp - (1 + 7);
  assert.match(out.note, new RegExp(`Ring of Regeneration: ${gained} more hit points \\(6d6 rolled 36\\)`));
});

test("a long rest rolls a spent Ring of Evasion's recharge through the injected rng, capped at its maximum, and leaves a full one alone", () => {
  const spent: CharacterSheet = { ...knight(), itemCharges: { "ring:uncommon": 1 } };
  const rested = longRest(spent, draws(0.99));
  assert.equal(rested.sheet.itemCharges?.["ring:uncommon"], 3, "1 + 1d3 (a 3), capped at 3");
  assert.match(rested.note, /Ring of Evasion regains 2 charges \(1d3 rolled 3\): 3 of 3\./);
  const full = longRest(knight(), draws());
  assert.equal(full.note.includes("regains"), false, "an absent key means full: no roll and no rng call");
});

// ── copy that states the real number ────────────────────────────────────

test("the Boots of Speed sentence names the speed BEFORE the boots double it, even while they are worn", () => {
  const sheet = wearing(knight(), { boots: { slot: "boots", tier: "rare" } });
  assert.equal(effectiveSpeedFt(sheet), 60);
  assert.equal(speedBeforeBootsFt(sheet), 30);
  const boots = gearView(sheet)!.accessorySlots.find((s) => s.role === "boots")!;
  assert.match(boots.plain, /30 feet becomes 60\./);
});

test("the Ring of Evasion sentence names the ability the way every dice line does", () => {
  assert.match(accessoryCopy("ring", "uncommon", 30), /When you fail a Dexterity saving throw/);
});

test("the rarity glossary does not promise a ring, amulet or boots the +1/+2/+3 ladder", () => {
  const rarity = explain("rarity")!;
  assert.match(rarity, /ring, amulet or pair of boots does what its own description says/i);
  assert.ok(GLOSSARY.some((g) => g.term === "attunement"));
});
