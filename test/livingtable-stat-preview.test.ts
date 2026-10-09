/**
 * Tests for the Inventory tab's stat preview (src/games/livingtable/menu/statPreview.ts): what the character's numbers
 * would be with a bagged piece worn, read off the engine's own readers on a copy, and the engine's refusals.
 *
 * Run: npx -y tsx --test test/livingtable-stat-preview.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCharacter, creationOptions, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { BONUS_BY_TIER, GEAR_CHANGE_BLOCKED, MAX_ATTUNED_ITEMS, attunementFullReason, type BagItem, type Equipment } from "../src/games/livingtable/characters/equipmentTypes";
import { attackerBonusFor, effectiveArmorClass, weaponDamageNotationFor } from "../src/games/livingtable/session/combat";
import { previewEquip, previewTakeOff, statsOf, deltaTone, deltaWords, signedNumber } from "../src/games/livingtable/menu/statPreview";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

function knight(over: Partial<CharacterSheet> = {}): CharacterSheet {
  const defaults = creationOptions("knight").defaults;
  return { ...createCharacter({ ...defaults, name: "Tester" }), ...over };
}

const withBag = (sheet: CharacterSheet, bag: BagItem[]): CharacterSheet => ({ ...sheet, bag });

test("statsOf reads the engine: armour class, to hit, damage, saves, speed and attunement", () => {
  const s = knight();
  const stats = statsOf(s);
  assert.equal(stats.ac, effectiveArmorClass(s));
  assert.equal(stats.toHit, attackerBonusFor(s));
  assert.equal(stats.damage, weaponDamageNotationFor(s));
  assert.equal(stats.attuned, 0);
  assert.equal(stats.attunedMax, MAX_ATTUNED_ITEMS);
  assert.equal(typeof stats.saves, "number");
  assert.ok(stats.speedFt >= 25);
});

test("a rare weapon in the bag previews to-hit and damage up by its bonus, and nothing else moves", () => {
  const s = withBag(knight(), [{ slot: "weapon", tier: "rare" }]);
  const r = previewEquip(s, 0);
  assert.ok(r.ok, "the engine allows it");
  if (!r.ok) return;
  const bonus = BONUS_BY_TIER.rare;
  assert.equal(r.delta.toHit, bonus, "to hit is up by the item bonus");
  assert.equal(r.delta.damage, bonus, "so is the damage");
  assert.equal(r.after.toHit, r.before.toHit + bonus);
  assert.notEqual(r.after.damage, r.before.damage, "the damage notation changed");
  assert.match(r.after.damage, /\+\d+$/);
  assert.equal(r.delta.ac, 0);
  assert.equal(r.delta.saves, 0);
  assert.equal(r.delta.speedFt, 0);
  // The preview is a copy: the real sheet is untouched.
  assert.equal(s.bag?.length, 1);
  assert.equal(attackerBonusFor(s), r.before.toHit);
});

test("a shield or armour piece previews its armour class", () => {
  const s = withBag(knight(), [{ slot: "outer", tier: "uncommon" }]);
  const r = previewEquip(s, 0);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.delta.ac, BONUS_BY_TIER.uncommon);
  assert.equal(r.delta.toHit, 0);
});

test("a piece that moves none of the numbers shows a zero change, not a refusal", () => {
  // Boots of Elvenkind (uncommon) are stealth advantage: no number of the column moves.
  const s = withBag(knight(), [{ slot: "boots", tier: "uncommon" }]);
  const r = previewEquip(s, 0);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual({ ...r.delta }, { ac: 0, toHit: 0, damage: 0, saves: 0, speedFt: 0, attuned: 0 });
});

test("a plain common piece in the bag changes nothing: the game refuses to stage it and says so", () => {
  // The bag only ever holds magic pieces; a hand-built common cell cannot be committed, so there is no after.
  const s = withBag(knight(), [{ slot: "weapon", tier: "common" } as unknown as BagItem]);
  const r = previewEquip(s, 0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.reason.length > 5);
});

test("with attunement full a fourth attuned piece is refused, with the engine's reason naming what is worn", () => {
  const equipment: Equipment = {
    weapon: { slot: "weapon", tier: "legendary" },
    ring: { slot: "ring", tier: "rare" },
    amulet: { slot: "amulet", tier: "rare" },
  };
  const s = withBag(knight({ equipment }), [{ slot: "boots", tier: "rare" }]);
  assert.equal(statsOf(s).attuned, MAX_ATTUNED_ITEMS);
  const r = previewEquip(s, 0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, new RegExp(attunementFullReason(["Dawnbreaker", "Ring of Protection", "Stone of Good Luck"]).slice(0, 12)));
});

test("in a fight the preview is refused with the game's own gear-change words", () => {
  const s = withBag(knight(), [{ slot: "weapon", tier: "rare" }]);
  const r = previewEquip(s, 0, { hostilesPresent: true });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, GEAR_CHANGE_BLOCKED.hostiles);
});

test("an empty cell is refused, not a crash", () => {
  const r = previewEquip(knight(), 3);
  assert.equal(r.ok, false);
});

test("taking off a worn magic piece previews the numbers going back down", () => {
  const equipment: Equipment = { weapon: { slot: "weapon", tier: "rare" } };
  const s = knight({ equipment });
  const r = previewTakeOff(s, "weapon");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.delta.toHit, -BONUS_BY_TIER.rare);
  assert.equal(r.delta.damage, -BONUS_BY_TIER.rare);
  assert.equal(previewTakeOff(knight(), "weapon").ok, false, "your own plain weapon cannot be taken off");
});

test("a legendary weapon names its rider in the preview", () => {
  const s = withBag(knight(), [{ slot: "weapon", tier: "legendary" }]);
  const r = previewEquip(s, 0);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.before.rider, null);
  assert.match(r.after.rider ?? "", /1d6 radiant/);
  assert.equal(r.after.attuned, 1, "it costs one of the three attunement spots");
  assert.equal(r.delta.attuned, 1);
});

test("the delta words: signed, plain, no dash glyphs, tone by direction", () => {
  assert.equal(signedNumber(2), "+2");
  assert.equal(signedNumber(0), "+0");
  assert.equal(signedNumber(-1), "-1");
  assert.equal(deltaWords(2), "+2");
  assert.equal(deltaWords(-3), "-3");
  assert.equal(deltaWords(0), "");
  assert.equal(deltaTone(2), "up");
  assert.equal(deltaTone(-1), "down");
  assert.equal(deltaTone(0), "same");
  for (const n of [-5, -1, 0, 1, 5]) {
    assert.ok(!deltaWords(n).includes(EM) && !deltaWords(n).includes(EN));
  }
});
