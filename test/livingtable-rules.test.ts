/**
 * Tests for The Living Table's SRD 5.1 rules engine (src/games/livingtable/rules).
 *
 * Every roll here uses an injected rng, never Math.random, so a test that
 * claims "natural 20 always hits" is actually forcing a natural 20 rather
 * than hoping for one. `dieFraction` converts a desired die face into the
 * 0..1 value `rng()` would need to return to produce it, with a half-step
 * margin so floating-point multiply/floor can't land it on the wrong face.
 *
 * Run: npx tsx --test test/livingtable-rules.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiceNotation, rollDice, rollD20, abilityModifier, proficiencyBonus, resolveAttack, resolveDamage, resolveSavingThrow, resolveSkillCheck, rollInitiative, sortInitiative, applyLevelUp, type LevelableCharacter, spellSlotsForLevel, castSpell, resetTurnEconomy, spendAction, spendMovement, type TurnEconomy, computeAC, normalizeConditions, resolveManeuver, getManeuver, maneuverSaveDC } from "../src/games/livingtable/rules";
import { defenderACForRollRequest, dcForRollRequest, modifierForRollRequest, lookupStatblock, monsterCurrentHp, monsterDamageNotationFor, damageMonster, criticalOnFor, attackerBonusFor, weaponDamageNotationFor, FALLBACK_MONSTER_STATBLOCK, superiorityDiceMaxFor, maneuverSaveDCFor, maneuversFor, maneuverTargetSaveModifier, monsterArmorClassFor, saveModifierFor, skillModifierFor, weaponFor, weaponIdentityFor, effectiveArmorClass, effectiveSpeedFt, equipmentContextFor, equipmentIssuesFor, legendaryRiderDamageFor, attackBonusSourcesFor, damageBonusSourcesFor, saveBonusSourcesFor, DEFAULT_SPEED_FT, checkAdvantageFor, checkBonusSourcesFor, evasionRescue } from "../src/games/livingtable/session/combat";
import { ARMOR_STRENGTH_BY_CHASSIS, canEquip, equipmentOf, equipSlot, equipmentStatus, itemNameFor, equipmentArmorBonus, equipmentBonusSources, legendaryRiderFor, normalizeEquipment, slotIsHandHeld, accessoryStatus, equipmentCheckBonus, equipmentSaveBonus, canEquip, armorSpeedPenaltyFt } from "../src/games/livingtable/characters/equipment";
import { ACCESSORY_ITEMS, ACCESSORY_ROLES, ARCHETYPE_IDS, BAG_CAPACITY, EFFECT_BOUNDS, EQUIPMENT_FORBIDDEN_WIRE_KEYS, GEAR_RAMP, GEAR_ROLES, LAYER_OFFHAND, MAGIC_TIERS, MAX_ATTUNED_ITEMS, MAX_DISTINCT_MAGIC_ITEMS, MAX_TOTAL_AC_BONUS, MAX_TOTAL_SAVE_BONUS, PROTECTED_PALETTE_INDICES, RECOLOUR_BY_TIER, SLOTS_BY_ARCHETYPE, SLOT_ROLES, STARTING_LOADOUT, bodySpriteId, equipmentSpriteId, gearItemExists, gearItemName, gearRequiresAttunement, tierArtVariant, type BagItem, type EquipmentTier, type GearRole, type PaletteRemap, type SlotRole } from "../src/games/livingtable/characters/equipmentTypes";
import { attunedRoles, isRoleAttuned, gearChangeBlockedReason } from "../src/games/livingtable/rules/attunement";
import { draftFromSheet, stageEquip, stageUnequip, commitLoadout, normalizeBag } from "../src/games/livingtable/rules/inventory";
import { loadoutInventoryFor } from "../src/games/livingtable/characters/templates";
import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { PALETTE as SCIFI_PALETTE, SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";
import { CHAIN_MAIL_STRENGTH, HEAVY_ARMOR_SPEED_PENALTY_FT, isLegalRiderNotation, resolveMagicWeaponRider, stackedArmorBonus } from "../src/games/livingtable/rules/magicItems";
import { createCharacter, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import type { AttackRollRequest, CheckRollRequest, SaveRollRequest } from "../src/games/livingtable/dm/turnSchema";

// ── rng test helper ────────────────────────────────────────────────────

/** The fraction rng() must return so `rollDie(sides, rng)` produces `result`. */
function dieFraction(result: number, sides: number): number {
  return (result - 0.5) / sides;
}

/** An rng that hands out queued fractions in order, and throws if drained past the end - which catches a roll happening that the test didn't expect. */
function queueRng(fractions: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= fractions.length) throw new Error("rng queue exhausted: more rolls happened than expected");
    return fractions[i++]!;
  };
}

// ── dice.ts ────────────────────────────────────────────────────────────

test("parseDiceNotation reads a modifier-less roll like 1d20", () => {
  const parsed = parseDiceNotation("1d20");
  assert.deepEqual(parsed, { count: 1, sides: 20, modifier: 0 });
});

test("parseDiceNotation reads a positive modifier", () => {
  assert.deepEqual(parseDiceNotation("1d8+3"), { count: 1, sides: 8, modifier: 3 });
});

test("parseDiceNotation reads a negative modifier", () => {
  assert.deepEqual(parseDiceNotation("2d6-1"), { count: 2, sides: 6, modifier: -1 });
});

test("parseDiceNotation rejects garbage", () => {
  assert.throws(() => parseDiceNotation("fireball"), /not valid dice notation/);
});

test("rollDice sums the queued rolls plus the modifier", () => {
  const rng = queueRng([dieFraction(3, 6), dieFraction(5, 6)]);
  const result = rollDice("2d6+2", rng);
  assert.deepEqual(result.rolls, [3, 5]);
  assert.equal(result.total, 3 + 5 + 2);
});

test("rollD20 with neither advantage nor disadvantage rolls exactly once", () => {
  const rng = queueRng([dieFraction(11, 20)]); // throws if a second roll is attempted
  assert.equal(rollD20(false, false, rng), 11);
});

test("rollD20 with advantage takes the higher of two rolls", () => {
  const rng = queueRng([dieFraction(5, 20), dieFraction(15, 20)]);
  assert.equal(rollD20(true, false, rng), 15);
});

test("rollD20 with disadvantage takes the lower of two rolls", () => {
  const rng = queueRng([dieFraction(5, 20), dieFraction(15, 20)]);
  assert.equal(rollD20(false, true, rng), 5);
});

test("rollD20 with both advantage and disadvantage cancels out to a single roll", () => {
  const rng = queueRng([dieFraction(9, 20)]); // throws if a second roll is attempted
  assert.equal(rollD20(true, true, rng), 9);
});

// ── abilities.ts ───────────────────────────────────────────────────────

test("abilityModifier follows the SRD table, including odd scores below 10", () => {
  assert.equal(abilityModifier(10), 0);
  assert.equal(abilityModifier(11), 0);
  assert.equal(abilityModifier(14), 2);
  assert.equal(abilityModifier(9), -1);
  assert.equal(abilityModifier(8), -1);
  assert.equal(abilityModifier(1), -5);
});

test("proficiencyBonus matches the SRD level table at every boundary", () => {
  assert.equal(proficiencyBonus(1), 2);
  assert.equal(proficiencyBonus(4), 2);
  assert.equal(proficiencyBonus(5), 3);
  assert.equal(proficiencyBonus(8), 3);
  assert.equal(proficiencyBonus(9), 4);
  assert.equal(proficiencyBonus(12), 4);
  assert.equal(proficiencyBonus(13), 5);
  assert.equal(proficiencyBonus(16), 5);
  assert.equal(proficiencyBonus(17), 6);
  assert.equal(proficiencyBonus(20), 6);
});

// ── combat.ts ──────────────────────────────────────────────────────────

test("resolveAttack: a natural 20 always hits, even against a huge AC with a terrible bonus", () => {
  const rng = queueRng([dieFraction(20, 20)]);
  const result = resolveAttack({ attackerBonus: -100, targetAC: 999, rng });
  assert.equal(result.critical, true);
  assert.equal(result.hit, true);
});

test("resolveAttack: a natural 1 always misses, even against AC 1 with a huge bonus", () => {
  const rng = queueRng([dieFraction(1, 20)]);
  const result = resolveAttack({ attackerBonus: 100, targetAC: 1, rng });
  assert.equal(result.fumble, true);
  assert.equal(result.hit, false);
});

test("resolveAttack: a normal roll compares total to AC", () => {
  const rng = queueRng([dieFraction(10, 20)]);
  const hitResult = resolveAttack({ attackerBonus: 5, targetAC: 15, rng });
  assert.equal(hitResult.hit, true); // 10 + 5 = 15, meets AC

  const rng2 = queueRng([dieFraction(9, 20)]);
  const missResult = resolveAttack({ attackerBonus: 5, targetAC: 15, rng: rng2 });
  assert.equal(missResult.hit, false); // 9 + 5 = 14, short of AC
});

test("resolveDamage on a critical doubles the DICE, not the flat modifier", () => {
  const rng = queueRng([dieFraction(4, 6), dieFraction(2, 6)]); // "1d6+3" crits into 2d6+3
  const result = resolveDamage("1d6+3", rng, true);
  assert.deepEqual(result.rolls, [4, 2]);
  assert.equal(result.total, 4 + 2 + 3); // modifier applied once, not doubled
});

test("resolveDamage without a critical rolls the notation as-is", () => {
  const rng = queueRng([dieFraction(6, 6)]);
  const result = resolveDamage("1d6+3", rng, false);
  assert.deepEqual(result.rolls, [6]);
  assert.equal(result.total, 9);
});

// ── checks.ts ──────────────────────────────────────────────────────────

test("resolveSavingThrow succeeds when the total exactly meets the DC", () => {
  const rng = queueRng([dieFraction(13, 20)]);
  const result = resolveSavingThrow({ modifier: 2, dc: 15, rng });
  assert.equal(result.total, 15);
  assert.equal(result.success, true);
});

test("resolveSavingThrow fails when the total falls one short of the DC", () => {
  const rng = queueRng([dieFraction(12, 20)]);
  const result = resolveSavingThrow({ modifier: 2, dc: 15, rng });
  assert.equal(result.total, 14);
  assert.equal(result.success, false);
});

test("resolveSkillCheck honors advantage the same way resolveAttack's d20 does", () => {
  const rng = queueRng([dieFraction(4, 20), dieFraction(18, 20)]);
  const result = resolveSkillCheck({ modifier: 0, dc: 10, advantage: true, rng });
  assert.equal(result.roll, 18);
  assert.equal(result.success, true);
});

// ── initiative.ts ──────────────────────────────────────────────────────

test("rollInitiative is 1d20 plus the DEX modifier", () => {
  const rng = queueRng([dieFraction(14, 20)]);
  assert.equal(rollInitiative(3, rng), 17);
});

test("sortInitiative sorts descending and breaks ties by original order", () => {
  const entries = [
    { id: "a", roll: 10 },
    { id: "b", roll: 15 },
    { id: "c", roll: 10 }, // ties with "a"; must stay after "a"
    { id: "d", roll: 20 },
  ];
  const sorted = sortInitiative(entries);
  assert.deepEqual(sorted.map((e) => e.id), ["d", "b", "a", "c"]);
  // The input array itself is untouched.
  assert.deepEqual(entries.map((e) => e.id), ["a", "b", "c", "d"]);
});

// ── leveling.ts ────────────────────────────────────────────────────────

test("applyLevelUp produces a correct HP total for a Fighter going 1 -> 2", () => {
  const fighter: LevelableCharacter = {
    characterClass: "fighter",
    level: 1,
    abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }, // CON 14 -> +2
    maxHp: 12, // 1st-level Fighter: max d10 (10) + CON mod (2)
    currentHp: 12,
    proficiencyBonus: 2,
  };

  const { character, changes } = applyLevelUp(fighter, 2);

  // d10 average (rounded up) is 6, plus CON mod 2, for one level gained.
  assert.equal(character.maxHp, 12 + 8);
  assert.equal(character.currentHp, 12 + 8);
  assert.equal(character.level, 2);
  assert.equal(character.proficiencyBonus, 2); // level 2 is still the +2 tier

  const hpChange = changes.find((c) => c.plain.includes("more health"));
  assert.ok(hpChange, "expected an HP change entry");
  assert.match(hpChange!.plain, /^8 more health/);
  // No proficiency-bonus change should be reported for a 1 -> 2 level-up.
  assert.equal(changes.some((c) => c.plain.includes("to hit")), false);
});

test("applyLevelUp reports a proficiency bonus change when it crosses a tier boundary", () => {
  const wizard: LevelableCharacter = {
    characterClass: "wizard",
    level: 4,
    abilities: { str: 8, dex: 12, con: 12, int: 16, wis: 10, cha: 10 }, // CON 12 -> +1
    maxHp: 30,
    currentHp: 30,
    proficiencyBonus: 2,
  };

  const { character, changes } = applyLevelUp(wizard, 5);

  // d6 average (rounded up) is 4, plus CON mod 1.
  assert.equal(character.maxHp, 30 + 5);
  assert.equal(character.proficiencyBonus, 3);

  const profChange = changes.find((c) => c.plain.includes("to hit"));
  assert.ok(profChange, "expected a proficiency-bonus change entry");
  assert.match(profChange!.plain, /^\+1 to hit/);
});

test("applyLevelUp floors HP gained at the SRD minimum of 1 per level, even for a low CON modifier", () => {
  const wizard: LevelableCharacter = {
    characterClass: "wizard",
    level: 1,
    abilities: { str: 8, dex: 12, con: 1, int: 16, wis: 10, cha: 10 }, // CON 1 -> mod -5
    maxHp: 5, // 1st-level Wizard: max d6 (6) + CON mod (-5), already floored at creation elsewhere
    currentHp: 5,
    proficiencyBonus: 2,
  };

  const { character, changes } = applyLevelUp(wizard, 2);

  // Raw d6 avg (4) + CON mod (-5) = -1, which must floor to +1, never a loss.
  assert.equal(character.maxHp, 5 + 1);
  assert.equal(character.currentHp, 5 + 1);
  assert.ok(character.maxHp >= 5, "leveling up must never reduce max HP");

  const hpChange = changes.find((c) => c.plain.includes("more health"));
  assert.ok(hpChange, "expected an HP change entry");
  assert.match(hpChange!.plain, /^1 more health/);
  assert.doesNotMatch(hpChange!.plain, /-/, "the plain-language message must never show a negative or double-signed HP gain");
  assert.doesNotMatch(hpChange!.technical, /\+-/, "the technical message must never show a broken '+-N' HP gain");
});

test("applyLevelUp floors HP per level, then multiplies, across a multi-level jump with a low CON modifier", () => {
  const wizard: LevelableCharacter = {
    characterClass: "wizard",
    level: 1,
    abilities: { str: 8, dex: 12, con: 3, int: 16, wis: 10, cha: 10 }, // CON 3 -> mod -4
    maxHp: 6,
    currentHp: 6,
    proficiencyBonus: 2,
  };

  const { character } = applyLevelUp(wizard, 4); // 3 levels gained, going 1 -> 4

  // Raw d6 avg (4) + CON mod (-4) = 0, floored to 1 per level, times 3 levels = 3.
  assert.equal(character.maxHp, 6 + 3);
  assert.ok(character.maxHp >= 6, "leveling up must never reduce max HP");
});

test("applyLevelUp rejects a newLevel that is not greater than the current level", () => {
  const character: LevelableCharacter = {
    characterClass: "rogue",
    level: 3,
    abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
    maxHp: 20,
    currentHp: 20,
    proficiencyBonus: 2,
  };
  assert.throws(() => applyLevelUp(character, 3), /greater than the character's current level/);
});

// ── spells.ts ──────────────────────────────────────────────────────────

test("spellSlotsForLevel: Cleric chassis levels 1-3 match the SRD full-caster table", () => {
  assert.deepEqual(spellSlotsForLevel("cleric", 1), { 1: { max: 2, used: 0 } });
  assert.deepEqual(spellSlotsForLevel("cleric", 2), { 1: { max: 3, used: 0 } });
  assert.deepEqual(spellSlotsForLevel("cleric", 3), { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } });
});

test("spellSlotsForLevel: Wizard chassis levels 1-3 match the SRD full-caster table", () => {
  assert.deepEqual(spellSlotsForLevel("wizard", 1), { 1: { max: 2, used: 0 } });
  assert.deepEqual(spellSlotsForLevel("wizard", 2), { 1: { max: 3, used: 0 } });
  assert.deepEqual(spellSlotsForLevel("wizard", 3), { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } });
});

test("spellSlotsForLevel: a level-3 Wizard has no 3rd-level slot, so the Wizard cannot cast Fireball yet", () => {
  // This locks in the SRD progression on purpose: the full-caster table does
  // not grant a 3rd-level slot until character level 5. A future "fix" that
  // hands the Wizard an early 3rd-level slot must fail this test, not
  // silently pass it.
  const slots = spellSlotsForLevel("wizard", 3);
  assert.equal(slots[3], undefined, "a level-3 Wizard must not have a 3rd-level spell slot bucket at all");
  assert.equal(castSpell(slots, 3), null, "casting a 3rd-level spell must be rejected, not silently allowed");
});

test("spellSlotsForLevel rejects a level outside the launch's 1-3 scope", () => {
  assert.throws(() => spellSlotsForLevel("cleric", 4), /only covers character levels 1-3/);
  assert.throws(() => spellSlotsForLevel("wizard", 0), /only covers character levels 1-3/);
});

test("castSpell spends one slot of the given level without touching other levels", () => {
  const slots = spellSlotsForLevel("cleric", 3); // { 1: {max:4,used:0}, 2: {max:2,used:0} }
  const afterOne = castSpell(slots, 1);
  assert.ok(afterOne);
  assert.deepEqual(afterOne![1], { max: 4, used: 1 });
  assert.deepEqual(afterOne![2], { max: 2, used: 0 }); // untouched
  // The original slots object is never mutated.
  assert.deepEqual(slots[1], { max: 4, used: 0 });
});

test("castSpell returns null once a spell level's slots are exhausted, and never lets used exceed max", () => {
  let slots = spellSlotsForLevel("wizard", 1); // { 1: { max: 2, used: 0 } }
  slots = castSpell(slots, 1)!;
  assert.deepEqual(slots[1], { max: 2, used: 1 });
  slots = castSpell(slots, 1)!;
  assert.deepEqual(slots[1], { max: 2, used: 2 });

  const overspent = castSpell(slots, 1);
  assert.equal(overspent, null, "a third 1st-level cast at a Wizard's level 1 must be rejected");
  assert.deepEqual(slots[1], { max: 2, used: 2 }, "the rejected cast must not have mutated the slots it was given");
});

test("castSpell returns null for a spell level the caster has no bucket for", () => {
  const slots = spellSlotsForLevel("cleric", 1); // only a 1st-level bucket exists
  assert.equal(castSpell(slots, 2), null);
});

// ── actionEconomy.ts ───────────────────────────────────────────────────

test("resetTurnEconomy starts every resource available and movement at full speed", () => {
  const economy = resetTurnEconomy(30);
  assert.deepEqual(economy, { action: true, bonusAction: true, reaction: true, movementRemaining: 30 });
});

test("resetTurnEconomy rejects a negative speed", () => {
  assert.throws(() => resetTurnEconomy(-5), /non-negative/);
});

test("spendAction marks only the named resource spent, leaving the others untouched", () => {
  const fresh = resetTurnEconomy(30);
  const afterAction = spendAction(fresh, "action");
  assert.deepEqual(afterAction, { action: false, bonusAction: true, reaction: true, movementRemaining: 30 });
  // The original economy is never mutated.
  assert.equal(fresh.action, true);
});

test("spendAction throws on a double-spend instead of silently allowing it", () => {
  const fresh = resetTurnEconomy(30);
  const afterAction = spendAction(fresh, "action");
  assert.throws(() => spendAction(afterAction, "action"), /action has already been spent this turn/);
  // The economy after the rejected double-spend is unchanged from the first spend.
  assert.equal(afterAction.action, false);
});

test("spendAction independently tracks bonus action and reaction from action", () => {
  let economy: TurnEconomy = resetTurnEconomy(30);
  economy = spendAction(economy, "bonusAction");
  economy = spendAction(economy, "reaction");
  assert.deepEqual(economy, { action: true, bonusAction: false, reaction: false, movementRemaining: 30 });
  assert.throws(() => spendAction(economy, "bonusAction"), /bonusAction has already been spent this turn/);
  assert.throws(() => spendAction(economy, "reaction"), /reaction has already been spent this turn/);
  // The action itself is still spendable exactly once.
  const afterAction = spendAction(economy, "action");
  assert.equal(afterAction.action, false);
});

test("spendMovement reduces movementRemaining without touching action/bonusAction/reaction", () => {
  const fresh = resetTurnEconomy(30);
  const afterMove = spendMovement(fresh, 20);
  assert.deepEqual(afterMove, { action: true, bonusAction: true, reaction: true, movementRemaining: 10 });
});

test("spendMovement rejects spending more than remains, and never lets movement go negative", () => {
  const fresh = resetTurnEconomy(30);
  assert.throws(() => spendMovement(fresh, 31), /not enough movement left/);
  // The original economy is untouched by the rejected spend.
  assert.equal(fresh.movementRemaining, 30);
});

test("spendMovement allows spending exactly what remains, landing at zero", () => {
  const fresh = resetTurnEconomy(30);
  const grounded = spendMovement(fresh, 30);
  assert.equal(grounded.movementRemaining, 0);
  assert.throws(() => spendMovement(grounded, 1), /not enough movement left/);
});

test("spendMovement rejects a negative amount", () => {
  const fresh = resetTurnEconomy(30);
  assert.throws(() => spendMovement(fresh, -5), /non-negative/);
});

// ── armorClass.ts ──────────────────────────────────────────────────────

test("computeAC: unarmored is 10 + DEX modifier, ignoring baseArmor.base entirely", () => {
  const ac = computeAC({ baseArmor: { category: "unarmored", base: 999 }, dexModifier: 3 });
  assert.equal(ac, 13);
});

test("computeAC: light armor adds the FULL DEX modifier, uncapped", () => {
  // Leather armor, base 11, a high DEX mod (+5) applies in full under light armor.
  const ac = computeAC({ baseArmor: { category: "light", base: 11 }, dexModifier: 5 });
  assert.equal(ac, 16);
});

test("computeAC: medium armor caps the DEX modifier at +2, even when DEX would give more", () => {
  // Chain shirt, base 13, DEX mod +4 must be capped down to +2.
  const capped = computeAC({ baseArmor: { category: "medium", base: 13 }, dexModifier: 4 });
  assert.equal(capped, 15);
  // A DEX modifier under the cap applies in full, uncapped-looking but correct.
  const underCap = computeAC({ baseArmor: { category: "medium", base: 13 }, dexModifier: 1 });
  assert.equal(underCap, 14);
});

test("computeAC: heavy armor ignores the DEX modifier completely", () => {
  // Chain mail, base 16, a high DEX mod contributes nothing.
  const ac = computeAC({ baseArmor: { category: "heavy", base: 16 }, dexModifier: 5 });
  assert.equal(ac, 16);
  // Even a negative DEX modifier does not lower it.
  const negativeDex = computeAC({ baseArmor: { category: "heavy", base: 16 }, dexModifier: -2 });
  assert.equal(negativeDex, 16);
});

test("computeAC stacks a shield bonus and other flat bonuses on top of the armor calculation", () => {
  // Cleric chassis: chain shirt (medium, base 15) + shield (+2) from creation.ts's ARMOR_BY_CHASSIS.
  const ac = computeAC({ baseArmor: { category: "medium", base: 13 }, dexModifier: 1, shieldBonus: 2, otherBonus: 1 });
  assert.equal(ac, 13 + 1 + 2 + 1);
});

test("computeAC defaults shieldBonus and otherBonus to 0 when omitted", () => {
  const withDefaults = computeAC({ baseArmor: { category: "light", base: 11 }, dexModifier: 2 });
  const explicitZeros = computeAC({ baseArmor: { category: "light", base: 11 }, dexModifier: 2, shieldBonus: 0, otherBonus: 0 });
  assert.equal(withDefaults, explicitZeros);
});

// ── session/combat.ts: the numbers the engine must NOT take from the model ──
//
// DESIGN.md's turn protocol says "the engine looks up ITS OWN modifier for
// this id; the model never supplies a modifier." These tests hold the same
// line for the number on the OTHER side of the d20: the defender's AC, which
// is a creature's own property, not a dial the DM turns per attack.

/** A real level-1 Knight sheet (chain mail, AC 16, DEX +0) to test the "against the player" branch with. */
function knightSheet(): CharacterSheet {
  return createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight" });
}

function attackRequest(overrides: Partial<AttackRollRequest> = {}): AttackRollRequest {
  return { id: "r1", by: "gob-1", kind: "attack", reason: "the goblin swings", targetAC: 13, against: "pc-1", ...overrides };
}

test("defenderACForRollRequest uses the player's own sheet AC, never the targetAC the model wrote", () => {
  const sheet = knightSheet();
  // The exact probe from the work order: a DM turn declaring targetAC 1
  // against the player character. The engine must resolve against the sheet.
  const ac = defenderACForRollRequest(attackRequest({ targetAC: 1 }), sheet, "token_knight");
  assert.equal(ac, sheet.armorClass, "the defender AC must come off the sheet, not the model's JSON");
  assert.ok(sheet.armorClass >= 16, "a level-1 Knight in chain mail should be AC 16 or better, so targetAC 1 is plainly a model-supplied lie");
});

test("defenderACForRollRequest closes the 'targetAC 1 shreds the party' probe end to end", () => {
  const sheet = knightSheet();
  const attackerBonus = 4; // an SRD goblin's scimitar bonus
  // 200 identical turns, deterministic d20 faces 1..20 cycled, so the hit
  // count is exact rather than sampled. Against the model's targetAC 1 every
  // roll but a natural 1 lands (195/200 in the original probe); against the
  // sheet's real AC, only rolls that actually beat it do.
  let hitsIfModelPickedAC = 0;
  let hitsAgainstRealAC = 0;
  for (let i = 0; i < 200; i++) {
    const face = (i % 20) + 1;
    const rngA = queueRng([dieFraction(face, 20)]);
    const rngB = queueRng([dieFraction(face, 20)]);
    const request = attackRequest({ targetAC: 1 });
    if (resolveAttack({ attackerBonus, targetAC: request.targetAC, rng: rngA }).hit) hitsIfModelPickedAC++;
    const realAC = defenderACForRollRequest(request, sheet, "token_knight");
    if (resolveAttack({ attackerBonus, targetAC: realAC, rng: rngB }).hit) hitsAgainstRealAC++;
  }
  assert.equal(hitsIfModelPickedAC, 190, "sanity: trusting the model's targetAC 1 means all 200 rolls but the natural 1s land");
  // The Knight's real sheet AC is 17 (chain mail 16, plus the Defense
  // fighting style's +1). Against +4 that needs a d20 face of 13 or better,
  // so 8 of every 20 faces connect.
  assert.equal(sheet.armorClass, 17);
  assert.equal(hitsAgainstRealAC, 80, "against the sheet's real AC, only rolls that genuinely beat it land");
});

test("defenderACForRollRequest resolves a monster's AC from its statblock, ignoring the model's targetAC", () => {
  // The player swings at a goblin and the model writes targetAC 30 to make
  // the swing whiff. The goblin's own SRD AC is 15, and that is what decides.
  const ac = defenderACForRollRequest(attackRequest({ by: "pc-1", against: "gob-1", targetAC: 30 }), null, "token_goblin");
  assert.equal(ac, 15);
  const skeletonAC = defenderACForRollRequest(attackRequest({ by: "pc-1", against: "skel-1", targetAC: 30 }), null, "token_skeleton");
  assert.equal(skeletonAC, 13);
});

test("defenderACForRollRequest gives a token with no statblock the engine's own fallback AC, never the model's targetAC", () => {
  // The regression this pins down. The fix used to stop one branch short:
  // the player got their sheet AC and the four MONSTER_STATBLOCKS sprites got
  // theirs, but the last line was still `return request.targetAC`, so every
  // OTHER token on the board -- a companion, a neutral NPC sprite, any
  // archetype token the DM decided to make hostile -- had the number its own
  // d20 was compared against written by the model. FALLBACK_MONSTER_STATBLOCK
  // is the engine's documented answer for "a creature with no statblock," and
  // it is what has to come back for all of them.
  const fallback = FALLBACK_MONSTER_STATBLOCK.armorClass;
  assert.equal(defenderACForRollRequest(attackRequest({ against: "ally-1", targetAC: 1 }), null, "token_knight"), fallback);
  assert.equal(defenderACForRollRequest(attackRequest({ against: "ally-1", targetAC: 30 }), null, "token_knight"), fallback);
  assert.equal(defenderACForRollRequest(attackRequest({ against: "npc-7", targetAC: 14 }), null, "token_healer"), fallback);
  assert.equal(defenderACForRollRequest(attackRequest({ against: "npc-7", targetAC: 14 }), null, undefined), fallback);
});

test("defenderACForRollRequest closes the companion probe: a declared targetAC no longer moves the hit count", () => {
  // The adversary's actual probe, reproduced. Against a kind:"companion"
  // token, a declared targetAC of 1 produced 37 hits in 40 and a declared
  // targetAC of 30 produced 3 in 40 -- the model choosing, per attack, how
  // often its own attack landed. The two declared numbers must now produce
  // the SAME count, because neither one is read at all.
  const attackerBonus = 4;
  const hitsWithDeclaredAC = (targetAC: number): number => {
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      const face = (i % 20) + 1;
      const ac = defenderACForRollRequest(attackRequest({ against: "ally-1", targetAC }), null, "token_knight");
      if (resolveAttack({ attackerBonus, targetAC: ac, rng: queueRng([dieFraction(face, 20)]) }).hit) hits++;
    }
    return hits;
  };
  const manufacturedHits = hitsWithDeclaredAC(1);
  const manufacturedMisses = hitsWithDeclaredAC(30);
  assert.equal(manufacturedHits, manufacturedMisses, "the model's declared AC must not change how often its own d20 lands");
  // AC 13 against +4 needs a face of 9 or better: 12 of every 20 faces, so 24
  // of 40 cycled faces. Pinned as a number, not just as an equality, so a
  // future change that made BOTH branches wrong in the same direction would
  // still fail this test.
  assert.equal(manufacturedHits, 24, "an engine-owned AC 13 against +4 lands on 12 faces in 20");
});

test("dcForRollRequest clamps a DC outside the SRD 5 to 30 scale back onto it", () => {
  const save: SaveRollRequest = { id: "s1", by: "pc-1", kind: "save", ability: "dex", reason: "the floor gives way", dc: 30 };
  assert.equal(dcForRollRequest(save), 30, "DC 30 is the top of the SRD table and stays untouched");
  assert.equal(dcForRollRequest({ ...save, dc: 99 }), 30, "a DC above the scale clamps down to 30");
  assert.equal(dcForRollRequest({ ...save, dc: 0 }), 5, "a DC below the scale clamps up to 5");
  assert.equal(dcForRollRequest({ ...save, dc: -40 }), 5, "a negative DC, an auto-success dial, clamps up to 5");
  const check: CheckRollRequest = { id: "c1", by: "pc-1", kind: "check", skill: "Perception", reason: "something moved", dc: 1000 };
  assert.equal(dcForRollRequest(check), 30, "the clamp applies to skill checks the same way");
});

// ── session/combat.ts: four creatures, not one creature four times ──────

test("MONSTER_STATBLOCKS gives each shipped token its own SRD numbers", () => {
  const goblin = lookupStatblock("token_goblin")!;
  const skeleton = lookupStatblock("token_skeleton")!;
  const raider = lookupStatblock("token_raider")!;
  const drone = lookupStatblock("token_drone")!;
  assert.ok(goblin && skeleton && raider && drone, "all four shipped monster sprites need a statblock");

  // SRD 5.1 Goblin: AC 15, 7 hp, Scimitar +4 to hit, 1d6+2.
  assert.equal(goblin.armorClass, 15);
  assert.equal(goblin.maxHp, 7);
  assert.equal(goblin.attackBonus, 4);
  // SRD 5.1 Skeleton: AC 13, 13 hp, Shortsword +4 to hit, 1d6+2.
  assert.equal(skeleton.armorClass, 13);
  assert.equal(skeleton.maxHp, 13);

  // The point of the whole record: no two of them are the same creature.
  const shapes = [goblin, skeleton, raider, drone].map((b) => `${b.armorClass}/${b.maxHp}/${b.attackBonus}/${b.damageNotation}`);
  assert.equal(new Set(shapes).size, 4, "four distinct sprites must not resolve to four copies of one statblock");
});

test("lookupStatblock returns undefined for a token that is not a monster, so a PC never gets monster numbers", () => {
  assert.equal(lookupStatblock("token_knight"), undefined);
  assert.equal(lookupStatblock(undefined), undefined);
});

test("modifierForRollRequest reads a monster's own attack bonus and saves off its statblock", () => {
  const goblinAttack = attackRequest({ by: "gob-1" });
  assert.equal(modifierForRollRequest(goblinAttack, null, "token_goblin"), 4, "an SRD goblin swings at +4, not a flat placeholder");
  const raiderAttack = attackRequest({ by: "raid-1" });
  assert.equal(modifierForRollRequest(raiderAttack, null, "token_raider"), 3);

  // SRD 5.1 Goblin: DEX 14 (+2), CON 10 (+0). A flat one-size save modifier
  // gets both of these wrong, and gets them wrong in the same direction for
  // every creature in the game.
  const dexSave: SaveRollRequest = { id: "s1", by: "gob-1", kind: "save", ability: "dex", reason: "the blast", dc: 12 };
  assert.equal(modifierForRollRequest(dexSave, null, "token_goblin"), 2);
  assert.equal(modifierForRollRequest({ ...dexSave, ability: "con" }, null, "token_goblin"), 0);
  // SRD 5.1 Skeleton: CON 15 (+2), so the same save is not the same roll.
  assert.equal(modifierForRollRequest({ ...dexSave, ability: "con" }, null, "token_skeleton"), 2);
});

test("monster HP is read from the token, so a wounded monster stays wounded", () => {
  // The bug this locks down: HP kept in a React record outside the World
  // meant a goblin at 2 HP was back to full after a reload, and the DM was
  // never told it was hurt at all. currentHp lives on the token now.
  const fresh = { assetId: "token_goblin" };
  assert.equal(monsterCurrentHp(fresh), 7, "an undamaged goblin sits at its statblock maximum");

  const afterFirstHit = damageMonster(fresh, 5);
  assert.equal(afterFirstHit.currentHp, 2);
  assert.equal(afterFirstHit.down, false);

  const wounded = { assetId: "token_goblin", currentHp: afterFirstHit.currentHp };
  assert.equal(monsterCurrentHp(wounded), 2, "the wound has to survive being read back off the token");

  const afterSecondHit = damageMonster(wounded, 4);
  assert.equal(afterSecondHit.currentHp, 0, "HP never goes negative");
  assert.equal(afterSecondHit.down, true);
});

test("a skeleton takes genuinely more killing than a goblin", () => {
  // The fiction ships four sprites; before statblocks the mechanics shipped
  // one 12 HP creature four times, and a probe dropped it in 4 button presses.
  const goblinDown = damageMonster({ assetId: "token_goblin" }, 7);
  const skeletonSameHit = damageMonster({ assetId: "token_skeleton" }, 7);
  assert.equal(goblinDown.down, true);
  assert.equal(skeletonSameHit.down, false);
  assert.equal(skeletonSameHit.currentHp, 6);
});

test("monsterDamageNotationFor gives each creature its own damage die", () => {
  assert.equal(monsterDamageNotationFor("token_goblin"), "1d6+2");
  assert.equal(monsterDamageNotationFor("token_raider"), "1d8+1");
  // An unknown token still has to produce something rollable rather than throw.
  assert.doesNotThrow(() => parseDiceNotation(monsterDamageNotationFor("token_healer")));
});

// -- criticalOn: the Champion's level-3 pick changes a real number --------
//
// The whole point of the parameter is that the crit rule stays computed in
// exactly ONE place. Re-implementing "19 or 20 for a Champion" at the play
// screen would let the on-screen readout and the engine disagree about
// whether a swing crit, which is the failure DESIGN.md forbids outright.

test("resolveAttack still crits only on a natural 20 by default, so no existing caller changes", () => {
  const nineteen = resolveAttack({ attackerBonus: 0, targetAC: 30, rng: () => dieFraction(19, 20) });
  assert.equal(nineteen.roll, 19);
  assert.equal(nineteen.critical, false);
  assert.equal(nineteen.hit, false, "19 + 0 does not reach AC 30, and without a crit it is an ordinary miss");
});

test("criticalOn 19 makes a natural 19 a critical hit that lands regardless of AC", () => {
  const result = resolveAttack({ attackerBonus: 0, targetAC: 30, criticalOn: 19, rng: () => dieFraction(19, 20) });
  assert.equal(result.roll, 19);
  assert.equal(result.critical, true);
  assert.equal(result.hit, true, "a critical hits whatever the AC, same rule a natural 20 already followed");
});

test("a widened critical range does not rescue a natural 1", () => {
  const result = resolveAttack({ attackerBonus: 40, targetAC: 5, criticalOn: 19, rng: () => dieFraction(1, 20) });
  assert.equal(result.fumble, true);
  assert.equal(result.critical, false);
  assert.equal(result.hit, false);
});

test("criticalOnFor reads the recorded level-3 pick, and only the Champion moves the number", () => {
  const base = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "token_knight" });
  assert.equal(criticalOnFor(base), 20, "a level 1 fighter has made no subclass pick yet");

  const champion: CharacterSheet = { ...base, choices: { ...base.choices, martialArchetype: "champion" } };
  assert.equal(criticalOnFor(champion), 19);

  const battleMaster: CharacterSheet = { ...base, choices: { ...base.choices, martialArchetype: "battle-master" } };
  assert.equal(criticalOnFor(battleMaster), 20);

  const rogue = createCharacter({ archetypeId: "shadow", name: "Kira", appearanceAssetId: "token_shadow" });
  assert.equal(criticalOnFor(rogue), 20, "a chassis with no martial archetype must not pick one up by accident");
});

// -- fighting styles: the two labels that used to change nothing -----------
//
// The most damning result of the blind evaluation: two judges who had never
// played a tabletop game made four build decisions between them, and all four
// landed on features that did not exist. Both picked Dueling ("every hit that
// lands, lands harder") and both rejected Defense, the only style that then
// changed any number at all, as "the smallest possible buff". The copy was
// not the problem; the copy described real SRD mechanics that nothing read.
// These tests are the proof the numbers exist now, and they are written
// against the two functions the play screen already calls at swing time
// (`attackerBonusFor`, `weaponDamageNotationFor`) rather than against a new
// surface, because a style that only a test can see is the same bug again.

/** A Knight with one specific fighting style locked in, so a test can compare two builds that differ in exactly one pick. */
function knightWithStyle(fightingStyle: string): CharacterSheet {
  return createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight", choices: { fightingStyle } });
}

function trooperWithStyle(fightingStyle: string): CharacterSheet {
  return createCharacter({ archetypeId: "trooper", name: "Vas", appearanceAssetId: "token_trooper", choices: { fightingStyle } });
}

test("Dueling adds its SRD +2 to the damage of a one-handed melee weapon", () => {
  // SRD 5.1: "When you are wielding a melee weapon in one hand and no other
  // weapons, you gain a +2 bonus to damage rolls with that weapon." The
  // Knight's kit is longsword and shield -- a shield is not a weapon, so the
  // style applies, which is exactly what the option's copy promises.
  const defense = knightWithStyle("defense");
  const dueling = knightWithStyle("dueling");
  assert.equal(weaponDamageNotationFor(defense), "1d8+2", "STR +2 and nothing else without the style");
  assert.equal(weaponDamageNotationFor(dueling), "1d8+4", "Dueling is +2 damage, every hit, and it has to reach the damage roll");
});

test("Dueling does not leak onto a ranged weapon or onto a character who did not pick it", () => {
  // The style is conditional in the SRD and has to stay conditional here, or
  // "+2 damage" becomes a flat sheet number that misrepresents itself.
  assert.equal(weaponDamageNotationFor(trooperWithStyle("archery")), weaponDamageNotationFor(trooperWithStyle("defense")));
  const rogue = createCharacter({ archetypeId: "shadow", name: "Sable", appearanceAssetId: "token_shadow" });
  assert.equal(weaponDamageNotationFor(rogue), "1d6+2", "a chassis with no fighting style must not pick one up by accident");
});

test("Archery adds its SRD +2 to attack rolls made with a ranged weapon", () => {
  // SRD 5.1: "You gain a +2 bonus to attack rolls you make with ranged
  // weapons." The Trooper's plasma rifle is the ranged weapon this kit
  // fights with, so the bonus applies to every swing the play screen resolves.
  const defense = trooperWithStyle("defense");
  const archery = trooperWithStyle("archery");
  assert.equal(attackerBonusFor(defense), 4, "DEX +2 and proficiency +2");
  assert.equal(attackerBonusFor(archery), 6, "Archery is +2 to hit, and it has to reach the attack roll");
});

test("Archery does not apply to a melee weapon, so the Knight's choice is a real trade rather than a free bonus", () => {
  // The Knight's kit declares itself archery-viable (templates.ts: thrown
  // handaxes), so picking Archery has to do SOMETHING for that character --
  // a chosen style that silently does nothing is the bug this whole section
  // exists to close. What it does is swap which weapon the engine treats as
  // equipped: +2 to hit with a smaller die, instead of the longsword.
  const defense = knightWithStyle("defense");
  const archery = knightWithStyle("archery");
  assert.equal(attackerBonusFor(archery), attackerBonusFor(defense) + 2, "the +2 has to be real");
  assert.notEqual(weaponDamageNotationFor(archery), weaponDamageNotationFor(defense), "and it has to cost something");
});

test("Defense still adds exactly +1 AC and touches nothing else, so the fix did not move the one style that already worked", () => {
  const defense = knightWithStyle("defense");
  const dueling = knightWithStyle("dueling");
  assert.equal(defense.armorClass, dueling.armorClass + 1);
  assert.equal(attackerBonusFor(defense), attackerBonusFor(dueling), "Defense is an AC style; it must not touch the attack roll");
});

test("normalizeConditions drops anything that is not an SRD condition rather than letting it reach the engine", () => {
  assert.deepEqual(normalizeConditions(["prone", "bleeding", 7, null]), ["prone"]);
  assert.deepEqual(normalizeConditions(undefined), [], "a campaign saved before the field existed comes back clean, not crashed");
  assert.deepEqual(normalizeConditions(["unconscious"]), ["incapacitated", "prone", "unconscious"], "SRD implications are applied on the way in too");
});

// -- Battle Master: the other half of the only level-3 branch --------------

/** A level-3 Knight who took Battle Master, which is the pick both blind judges made. */
function battleMasterSheet(): CharacterSheet {
  const base = createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight" });
  return { ...base, level: 3, proficiencyBonus: proficiencyBonus(3), choices: { ...base.choices, martialArchetype: "battle-master" } };
}

test("a Battle Master has a real pool of superiority dice and a Champion does not", () => {
  const battleMaster = battleMasterSheet();
  const champion: CharacterSheet = { ...battleMaster, choices: { ...battleMaster.choices, martialArchetype: "champion" } };
  assert.equal(superiorityDiceMaxFor(battleMaster), 4, "SRD 5.1: four superiority dice at Fighter 3");
  assert.equal(superiorityDiceMaxFor(champion), 0);
  assert.equal(maneuversFor(battleMaster).length, 2, "trip and disarm, the two the launch ships");
  assert.equal(maneuversFor(champion).length, 0, "a Champion gets no maneuver buttons at all rather than disabled ones");
});

test("maneuverSaveDCFor is the SRD formula, not a number invented at the call site", () => {
  const sheet = battleMasterSheet();
  // Knight at level 3: proficiency +2, STR 15 (+2), DEX 13 (+1). SRD:
  // 8 + proficiency + the better of STR and DEX.
  assert.equal(maneuverSaveDCFor(sheet), 8 + 2 + 2);
  assert.equal(maneuverSaveDC(3, 1, 4), 8 + 3 + 4, "the better of the two modifiers is the one that counts");
});

test("a landed Trip Attack knocks the target prone and adds its die to the damage", () => {
  // Superiority die first (a d8), then the target's Strength save (a d20).
  const rng = queueRng([dieFraction(6, 8), dieFraction(3, 20)]);
  const result = resolveManeuver({ maneuver: "trip", targetSaveModifier: -1, saveDC: 12, rng });
  assert.equal(result.bonusDamage, 6);
  assert.equal(result.save.total, 2);
  assert.equal(result.landed, true, "3 - 1 = 2 does not reach DC 12");
  assert.equal(result.condition, "prone");
});

test("a saved-against maneuver still adds its die to the damage, per SRD, but applies no condition", () => {
  const rng = queueRng([dieFraction(4, 8), dieFraction(18, 20)]);
  const result = resolveManeuver({ maneuver: "trip", targetSaveModifier: 2, saveDC: 12, rng });
  assert.equal(result.bonusDamage, 4, "SRD 5.1 adds the superiority die to the damage whether or not the save succeeds");
  assert.equal(result.landed, false);
  assert.equal(result.condition, null);
});

test("a Disarming Attack lands as its own outcome rather than as a second prone", () => {
  const rng = queueRng([dieFraction(5, 8), dieFraction(2, 20)]);
  const result = resolveManeuver({ maneuver: "disarm", targetSaveModifier: 0, saveDC: 13, rng });
  assert.equal(result.landed, true);
  assert.equal(result.condition, null, "disarming moves an object; it is not a condition on the creature");
  assert.match(result.note, /grip/);
});

test("a maneuver's target save modifier comes off the target's own statblock, never from anywhere else", () => {
  const trip = getManeuver("trip");
  // SRD 5.1 Goblin: STR 8 (-1). SRD 5.1 Skeleton: STR 10 (+0). Two creatures
  // that are genuinely different to trip, which is the whole point of the
  // statblock table.
  assert.equal(maneuverTargetSaveModifier(trip, "token_goblin"), -1);
  assert.equal(maneuverTargetSaveModifier(trip, "token_skeleton"), 0);
  assert.equal(
    maneuverTargetSaveModifier(trip, "token_villager"),
    FALLBACK_MONSTER_STATBLOCK.abilityModifiers.str,
    "a token with no statblock uses the engine's own fallback, same rule as its AC",
  );
});

// -- equipment: SRD 5.1 magic items, and the engine that owns their numbers --
//
// The whole risk this section exists to hold down: equipment is the first
// system in the game that adds a number to a d20 AFTER character creation, so
// it is the first plausible route by which a number the ENGINE did not compute
// could reach a roll. Every test below is written against the same four
// functions the play screen already calls at swing time (`attackerBonusFor`,
// `weaponDamageNotationFor`, `effectiveArmorClass`, `saveModifierFor`) rather
// than against a new surface, because a bonus that only a test can see is the
// "label attached to nothing" failure the fighting styles already taught this
// codebase once.

function withGear(sheet: CharacterSheet, gear: Partial<Record<SlotRole, EquipmentTier>>): CharacterSheet {
  let equipment = equipmentOf(sheet);
  for (const role of SLOT_ROLES) {
    const tier = gear[role];
    if (tier) equipment = equipSlot(equipment, role, tier);
  }
  return { ...sheet, equipment } as CharacterSheet;
}

/** A Knight with a specific loadout, so a test can compare two builds that differ in exactly one piece of gear. */
function knightWithGear(gear: Partial<Record<SlotRole, EquipmentTier>>): CharacterSheet {
  return withGear(createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight" }), gear);
}

test("every archetype has exactly three slots, one per SlotRole, and exactly one of them is the weapon", () => {
  // The contract invariant the render lane and both art lanes build against:
  // three slots, three distinct layers, and one weapon bonus that therefore
  // can never stack with itself.
  for (const id of ARCHETYPE_IDS) {
    const slots = SLOTS_BY_ARCHETYPE[id];
    assert.deepEqual(Object.keys(slots).sort(), ["crown", "outer", "weapon"], `${id} must define all three slot roles and no others`);
    for (const role of SLOT_ROLES) assert.equal(slots[role].role, role, `${id}.${role} must name its own role`);
    const weaponSlots = SLOT_ROLES.filter((r) => slots[r].bonusKind === "weapon");
    assert.equal(weaponSlots.length, 1, `${id} must have exactly one weapon-bonus slot, else a +N weapon stacks with itself`);
    const layers = SLOT_ROLES.map((r) => slots[r].layer);
    assert.equal(new Set(layers).size, 3, `${id} must not give two slots the same draw layer`);
    assert.ok(!layers.includes(20), `${id} must not claim the body layer`);
  }
});

test("a legendary rider exists only on a weapon slot, is real dice notation, and stays inside the SRD bounds", () => {
  for (const id of ARCHETYPE_IDS) {
    const slots = SLOTS_BY_ARCHETYPE[id];
    for (const role of SLOT_ROLES) {
      const slot = slots[role];
      if (role !== "weapon") {
        assert.equal(slot.legendaryRider, undefined, `${id}.${role} is not a weapon and must carry no rider`);
        continue;
      }
      const rider = slot.legendaryRider;
      assert.ok(rider, `${id}'s weapon needs a legendary rider, else legendary is just +3`);
      assert.ok(isLegalRiderNotation(rider.bonusDamage), `${id}'s rider ${rider.bonusDamage} is outside MAX_RIDER_DICE / MAX_RIDER_SIDES`);
      assert.equal(parseDiceNotation(rider.bonusDamage).modifier, 0, "a rider is extra DICE, never a flat number the engine did not roll");
    }
  }
});

test("the starting kit is all common, so equipment changes not one number on a fresh character", () => {
  // Common is +0 on purpose: every archetype has all three slots drawn from
  // turn one, and none of them moves a roll until the player finds something.
  const bare = createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight" });
  assert.equal(effectiveArmorClass(bare), bare.armorClass, "an all-common loadout must equal the sheet's own AC");
  assert.equal(attackerBonusFor(bare), 4, "STR +2 and proficiency +2, and nothing from gear");
  assert.equal(weaponDamageNotationFor(bare), "1d8+2");
  assert.equal(saveModifierFor(bare, "str"), bare.saves.find((s) => s.ability === "str")!.bonus);
});

test("a +1 weapon moves BOTH the attack total and the damage total by exactly 1, through the same path proficiency takes", () => {
  const plain = knightWithGear({ weapon: "common" });
  const magic = knightWithGear({ weapon: "uncommon" });
  assert.equal(attackerBonusFor(magic), attackerBonusFor(plain) + 1, "SRD Weapon +1 applies to the attack roll");
  assert.equal(weaponDamageNotationFor(magic), "1d8+3", "and to the damage roll, in the same notation resolveDamage already takes");

  // The point of the routing: the bonus is inside `attackerBonus`, which is
  // the one number resolveAttack compares to an AC. Nothing new was threaded
  // into rules/, and nothing else can move it.
  const rng = queueRng([dieFraction(12, 20)]);
  const result = resolveAttack({ attackerBonus: attackerBonusFor(magic), targetAC: 17, rng });
  assert.equal(result.total, 17, "12 on the die, +2 STR, +2 proficiency, +1 sword");
  assert.equal(result.hit, true, "a 17 exactly meets AC 17, and the sword is what got it there");
});

test("the tier ladder is the SRD's own +1/+2/+3, and nothing in between", () => {
  const base = attackerBonusFor(knightWithGear({ weapon: "common" }));
  assert.equal(attackerBonusFor(knightWithGear({ weapon: "uncommon" })) - base, 1);
  assert.equal(attackerBonusFor(knightWithGear({ weapon: "rare" })) - base, 2);
  assert.equal(attackerBonusFor(knightWithGear({ weapon: "legendary" })) - base, 3);
});

test("a legendary weapon rolls its rider as its own damage roll, so a critical doubles the right dice", () => {
  const legend = knightWithGear({ weapon: "legendary" });
  const rider = legendaryRiderFor(legend);
  assert.ok(rider, "a legendary weapon carries an SRD Flame Tongue style rider");
  assert.equal(rider.damageType, "radiant");

  // Not concatenated into the weapon's own notation: "1d8+1d6+5" is not
  // parseable dice notation in the first place, and folding it in would change
  // what a critical doubles.
  assert.equal(weaponDamageNotationFor(legend), "1d8+5", "the weapon's own notation carries the +3 and nothing else");

  const rolled = legendaryRiderDamageFor(legend, queueRng([dieFraction(4, 6)]), false);
  assert.equal(rolled!.roll.total, 4, "one d6 of radiant, rolled by the engine like every other die");
  assert.equal(rolled!.damageType, "radiant");

  // SRD 5.1: a critical hit doubles the damage dice of the attack, and a
  // magic weapon's extra dice are damage dice of that attack.
  const crit = legendaryRiderDamageFor(legend, queueRng([dieFraction(4, 6), dieFraction(5, 6)]), true);
  assert.equal(crit!.roll.total, 9, "two d6 on a critical");
  assert.equal(legendaryRiderDamageFor(knightWithGear({ weapon: "rare" }), Math.random, false), null, "only legendary carries a rider");
});

test("effectiveArmorClass adds an armour bonus and is bounded, and a common loadout is a no-op", () => {
  const bare = knightWithGear({});
  assert.equal(effectiveArmorClass(bare), bare.armorClass);
  assert.equal(effectiveArmorClass(knightWithGear({ crown: "uncommon" })), bare.armorClass + 1, "SRD Armor +1");
  assert.equal(effectiveArmorClass(knightWithGear({ outer: "uncommon", crown: "uncommon" })), bare.armorClass + 2, "shield and plate stack");
  assert.equal(
    effectiveArmorClass(knightWithGear({ outer: "legendary", crown: "legendary" })),
    bare.armorClass + MAX_TOTAL_AC_BONUS,
    "+3 and +3 is +6 under raw SRD, which is the one house rule this feature bounds",
  );
});

test("the DM is told the same AC the engine rolls against, gear included", () => {
  // The exact defect `defenderACForRollRequest` was written to end, one level
  // up: if the reader the DM sees and the reader the d20 is compared against
  // are two different numbers, the fix half-regressed.
  const knight = knightWithGear({ outer: "rare", crown: "common" });
  const request: AttackRollRequest = { id: "r1", kind: "attack", by: "goblin-1", against: "pc", reason: "the goblin swings at Kira" };
  assert.equal(defenderACForRollRequest(request, knight, null), effectiveArmorClass(knight));
  assert.equal(defenderACForRollRequest(request, knight, null), knight.armorClass + 2);
});

test("an equipment save bonus reaches every saving throw, trained or not, the SRD Cloak of Protection shape", () => {
  const bare = createCharacter({ archetypeId: "fireball-person", name: "Ash", appearanceAssetId: "token_fireball_person" });
  const hatted = withGear(bare, { crown: "rare" });
  for (const ability of ["str", "dex", "con", "int", "wis", "cha"] as const) {
    assert.equal(saveModifierFor(hatted, ability), saveModifierFor(bare, ability) + 2, `${ability} save must pick the hat up`);
  }
  // And a DM-requested save goes through the same door with no second edit.
  const request: SaveRollRequest = { id: "r2", kind: "save", by: "pc", reason: "the spell reaches for her", dc: 13, ability: "wis" };
  assert.equal(modifierForRollRequest(request, hatted), saveModifierFor(hatted, "wis"));
});

test("a save-slot item never becomes a third source of AC, and an armour item never touches a save", () => {
  const bare = createCharacter({ archetypeId: "shadow", name: "Sable", appearanceAssetId: "token_shadow" });
  const hooded = withGear(bare, { crown: "legendary" });
  assert.equal(effectiveArmorClass(hooded), bare.armorClass, "a save item is not armour");
  const cloaked = withGear(bare, { outer: "legendary" });
  assert.equal(saveModifierFor(cloaked, "dex"), saveModifierFor(bare, "dex"), "an armour item is not a save item");
  assert.equal(effectiveArmorClass(cloaked), bare.armorClass + 3);
});

test("SRD: a GRIPPED shield needs a free hand, and the refusal names the weapon that took it", () => {
  // SRD 5.1 carries a shield "in one hand", so a two-handed weapon leaves none
  // for it. Checked against the Knight's Kite Shield, which HAND_HELD_SLOTS
  // names as the one gripped piece this game ships, under a forced two-handed
  // weapon: the rule has to bite on the object it governs.
  const knight = knightWithGear({ outer: "legendary" });
  const outerUnder = (weaponHands: number, weaponName: string) =>
    equipmentStatus(knight, { weaponHands, weaponName }).find((slot) => slot.role === "outer")!;

  const busy = outerUnder(2, "Greatsword");
  assert.equal(busy.active, false, "both hands on the weapon means no hand for the shield");
  assert.match(busy.reason!, /Greatsword/, "and it names WHICH weapon, or the sentence is one the player cannot act on");
  assert.equal(outerUnder(1, "Longsword").active, true, "a one-handed weapon leaves the hand the shield needs");

  // With the Knight's real longsword, the slot pays out in full and nothing is
  // refused at all.
  assert.equal(effectiveArmorClass(knight), knight.armorClass + 3);
  assert.deepEqual(equipmentIssuesFor(knight), []);
});

test("the Trooper's Riot Shield is a real slot, not a permanently decorative one", () => {
  // THE DEFECT: `slotIsHandHeld` used to answer "is this gripped in a hand?"
  // with `slot.layer === LAYER_OFFHAND`, which is a DRAW BAND, not a grip. The
  // Trooper's only weapon is a two-handed plasma rifle, so their outer slot was
  // refused on every read of every Trooper sheet that has ever existed, at
  // every tier, with no build, choice or action able to change it -- while the
  // copy told them a hand was busy as though another loadout existed. One
  // third of a Fighter's gear was decorative forever.
  const trooper = createCharacter({ archetypeId: "trooper", name: "Vas", appearanceAssetId: "token_trooper" });
  assert.equal(weaponFor(trooper).hands, 2, "the kit really is two-handed; that is not the barrier's problem to have");
  for (const tier of ["uncommon", "rare", "legendary"] as const) {
    const shielded = withGear(trooper, { outer: tier });
    assert.ok(effectiveArmorClass(shielded) > trooper.armorClass, `a ${tier} Riot Shield has to be worth something`);
    assert.deepEqual(equipmentIssuesFor(shielded), [], "and nobody is told about a hand they cannot free");
  }

  // The two Fighter reskins are supposed to be equally strong -- that is the
  // whole reason the chassis carries two armour slots instead of one.
  const knight = knightWithGear({ outer: "rare", crown: "rare" });
  const vas = withGear(trooper, { outer: "rare", crown: "rare" });
  assert.equal(effectiveArmorClass(vas) - vas.armorClass, effectiveArmorClass(knight) - knight.armorClass);
});

test("the gripped-slot table agrees with what each archetype's kit says it carries", () => {
  // HAND_HELD_SLOTS restates one fact that lives in templates.ts's
  // `loadoutInventory`: which archetypes actually carry a shield. This is the
  // alarm on that duplication, the same one ARMOR_STRENGTH_BY_CHASSIS carries
  // for chain mail. A slot is gripped only when the kit names a shield AND the
  // piece sits at the off-hand draw band; the Healer names a shield but wears
  // it as part of the chassis AC, and the Trooper has a panel at that band and
  // no shield in the kit at all.
  for (const id of ARCHETYPE_IDS) {
    const carriesShield = loadoutInventoryFor(id).includes("Shield");
    const slots = SLOTS_BY_ARCHETYPE[id];
    for (const role of SLOT_ROLES) {
      const expected = carriesShield && slots[role].layer === LAYER_OFFHAND;
      assert.equal(slotIsHandHeld(id, role), expected, `${id}.${role} gripped-in-a-hand must match the kit's own inventory`);
    }
  }
  assert.equal(slotIsHandHeld("knight", "outer"), true, "the Knight's kit lists a Shield, so SRD's one-hand rule governs it");
  assert.equal(slotIsHandHeld("trooper", "outer"), false, "the Trooper's kit lists no shield, so their panel is braced rather than gripped");
  assert.equal(slotIsHandHeld("necromancer", "outer"), false, "an archetype the table never heard of loses a rule rather than gaining a refusal");
});

test("SRD: heavy armour below its Strength requirement costs 10 feet of speed, and meeting it costs nothing", () => {
  // SRD 5.1 armour table: chain mail lists Str 13, and "the armor reduces the
  // wearer's speed by 10 feet unless the wearer has a Strength score equal to
  // or higher than the listed score." The Knight's STR 15 clears it.
  const knight = knightWithGear({ crown: "rare" });
  assert.equal(effectiveSpeedFt(knight), DEFAULT_SPEED_FT);

  const weak: CharacterSheet = { ...knight, abilities: { ...knight.abilities, str: 10 } };
  assert.equal(effectiveSpeedFt(weak), DEFAULT_SPEED_FT - HEAVY_ARMOR_SPEED_PENALTY_FT, "the requirement has to cost something or it is not a requirement");
  assert.equal(effectiveArmorClass(weak), knight.armorClass + 2, "and SRD does NOT take the armour's AC away for it");

  // A chassis that wears light or no armour has no requirement to fail.
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Ash", appearanceAssetId: "token_fireball_person" });
  assert.equal(effectiveSpeedFt({ ...wizard, abilities: { ...wizard.abilities, str: 3 } }), DEFAULT_SPEED_FT);
});

test("no field a DM turn could ever carry moves an equipment bonus", () => {
  // The load-bearing rule, tested rather than asserted. Every key the contract
  // forbids is hung on a roll request, and the engine's answer does not move
  // by one point: `modifierForRollRequest` reads the sheet and the statblock
  // table, and there is no third input.
  const knight = knightWithGear({ weapon: "uncommon" });
  const honest: AttackRollRequest = { id: "r3", kind: "attack", by: "pc", against: "goblin-1", reason: "she swings at the goblin" };
  const engineAnswer = modifierForRollRequest(honest, knight);

  const hostile = { ...honest } as Record<string, unknown>;
  for (const key of EQUIPMENT_FORBIDDEN_WIRE_KEYS) hostile[key] = 99;
  assert.equal(modifierForRollRequest(hostile as unknown as AttackRollRequest, knight), engineAnswer);

  // The same for the defender's AC and for a save.
  assert.equal(defenderACForRollRequest(hostile as unknown as AttackRollRequest, knight, null), effectiveArmorClass(knight));
  const save = { id: "r4", kind: "save", by: "pc", reason: "the spell reaches for her", dc: 12, ability: "wis", ...Object.fromEntries(EQUIPMENT_FORBIDDEN_WIRE_KEYS.map((k) => [k, 99])) };
  assert.equal(modifierForRollRequest(save as unknown as SaveRollRequest, knight), saveModifierFor(knight, "wis"));
});

test("a stored bonus cannot exist: the sheet carries a tier and the number is derived on every read", () => {
  // The door this design keeps shut. A sheet hand-edited to carry a number
  // gets that number ignored, because nothing anywhere reads it.
  const knight = knightWithGear({ weapon: "uncommon" });
  const tampered = {
    ...knight,
    equipment: { ...equipmentOf(knight), weapon: { slot: "weapon", tier: "uncommon", bonus: 99, attackBonus: 99 } },
  } as unknown as CharacterSheet;
  assert.equal(attackerBonusFor(tampered), attackerBonusFor(knight));
});

test("monsters never have equipment: a statblock is the creature's whole story", () => {
  const request: AttackRollRequest = { id: "r5", kind: "attack", by: "goblin-1", against: "pc", reason: "the goblin bites" };
  assert.equal(modifierForRollRequest(request, null, "token_goblin"), 4, "the goblin's own +4, with no slot to hang gear on");
  assert.equal(monsterArmorClassFor("token_goblin"), 15, "and nothing about a token can add to it");
});

test("the bonus sources sum to exactly the modifier that was rolled, or the readout is lying", () => {
  // The contract's one assertion for the readout: a broken-out list that does
  // not add up to the number on the die is worse than no breakdown at all.
  const knight = knightWithGear({ weapon: "rare" });
  const attack = attackBonusSourcesFor(knight);
  assert.equal(attack.reduce((sum, s) => sum + s.amount, 0), attackerBonusFor(knight));
  assert.ok(attack.some((s) => s.label === "Sword of the Vigil"), "and the gear is named, not folded into a lump");

  const damage = damageBonusSourcesFor(knight);
  assert.equal(damage.reduce((sum, s) => sum + s.amount, 0), parseDiceNotation(weaponDamageNotationFor(knight)).modifier);

  const archer = withGear(
    createCharacter({ archetypeId: "trooper", name: "Vas", appearanceAssetId: "token_trooper", choices: { fightingStyle: "archery" } }),
    { weapon: "legendary" },
  );
  const archerSources = attackBonusSourcesFor(archer);
  assert.equal(archerSources.reduce((sum, s) => sum + s.amount, 0), attackerBonusFor(archer));
  assert.ok(archerSources.some((s) => s.label === "Archery"), "a conditional style is its own line, not hidden inside the ability");

  const wizard = withGear(createCharacter({ archetypeId: "psion", name: "Rill", appearanceAssetId: "token_psion" }), { crown: "legendary" });
  const saveSources = saveBonusSourcesFor(wizard, "int");
  assert.equal(saveSources.reduce((sum, s) => sum + s.amount, 0), saveModifierFor(wizard, "int"));
});

test("gear is named from the engine's own table, per tier, so the readout never invents a name", () => {
  assert.equal(itemNameFor(knightWithGear({ weapon: "common" }), "weapon"), "Longsword");
  assert.equal(itemNameFor(knightWithGear({ weapon: "uncommon" }), "weapon"), "Keen Longsword");
  assert.equal(itemNameFor(knightWithGear({ weapon: "legendary" }), "weapon"), "Dawnbreaker");
  assert.equal(itemNameFor(knightWithGear({ crown: "rare" }), "crown"), "Vigil Plate");
});

test("normalizeEquipment refuses anything that is not in the engine's own table", () => {
  const junk = normalizeEquipment({ weapon: { slot: "weapon", tier: "mythic" }, outer: { slot: "outer", tier: "rare" }, hat: { slot: "hat", tier: "rare" } });
  assert.equal(junk.weapon!.tier, "common", "an unknown tier falls back to the starting kit, never to a bonus");
  assert.equal(junk.outer!.tier, "rare", "and a real one survives");
  assert.equal((junk as Record<string, unknown>).hat, undefined, "an unknown slot is dropped, not carried");
  assert.deepEqual(normalizeEquipment(null), STARTING_LOADOUT);
  assert.deepEqual(normalizeEquipment("legendary everything"), STARTING_LOADOUT);
});

test("the armour Strength requirement is anchored to the armour creation.ts actually issues", () => {
  // ARMOR_STRENGTH_BY_CHASSIS restates one fact that lives privately in
  // creation.ts's ARMOR_BY_CHASSIS. This is the alarm on that duplication: if
  // a fighter ever stops being issued chain mail, the SRD Str 13 this file
  // applies stops being the right requirement, and this fails rather than
  // quietly charging the wrong characters 10 feet.
  assert.equal(createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight" }).armorLabel, "chain mail");
  assert.equal(ARMOR_STRENGTH_BY_CHASSIS.fighter, CHAIN_MAIL_STRENGTH);
  assert.equal(ARMOR_STRENGTH_BY_CHASSIS.rogue, 0, "SRD leather armour lists no Strength requirement");
  assert.equal(ARMOR_STRENGTH_BY_CHASSIS.cleric, 0, "nor does a chain shirt");
  assert.equal(ARMOR_STRENGTH_BY_CHASSIS.wizard, 0);
});

test("every weapon the engine can put in a character's hands declares how many hands it takes", () => {
  // The shield rule is arithmetic on this number, so a kit entry that forgets
  // it would silently hand out a free shield. Checked over every archetype the
  // game ships plus the fallback path an unknown archetype takes.
  for (const id of [...ARCHETYPE_IDS, "some-archetype-that-does-not-exist"]) {
    const sheet = { archetypeId: id, chassis: "fighter", choices: {} } as unknown as CharacterSheet;
    const weapon = weaponFor(sheet);
    assert.ok(weapon.hands === 1 || weapon.hands === 2, `${id}'s weapon must declare 1 or 2 hands, got ${weapon.hands}`);
    if (weapon.duelable) assert.equal(weapon.hands, 1, "SRD Dueling needs a one-handed weapon, so a duelable weapon cannot take two hands");
  }
});

test("canEquip refuses only what the data genuinely forbids, and lets the SRD conditions be judged at use time", () => {
  const knight = createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight" });
  assert.equal(canEquip(knight, "outer", "legendary").ok, true);
  // The Trooper CAN don a riot shield they have no hand for. SRD 5.1 does not
  // forbid carrying it; it just does not let an unheld shield add AC, which is
  // what `equipmentIssues` reports and `effectiveArmorClass` acts on.
  const trooper = createCharacter({ archetypeId: "trooper", name: "Vas", appearanceAssetId: "token_trooper" });
  assert.equal(canEquip(trooper, "outer", "legendary").ok, true);

  const unknown = { ...knight, archetypeId: "necromancer" } as CharacterSheet;
  const refused = canEquip(unknown, "weapon", "rare");
  assert.equal(refused.ok, false, "an archetype with no slot table has no slot to fill");
  assert.match(refused.reason!, /weapon slot/);
  assert.equal(canEquip(knight, "weapon", "mythic" as EquipmentTier).ok, false, "and a tier that is not on the ladder has no bonus to look up");
});

test("an archetype the slot table has never heard of fights with no gear rather than crashing", () => {
  // A campaign saved under an archetype id that was later renamed. Every number
  // has to degrade to the bare sheet, because a mid-campaign crash is a worse
  // outcome than a missing hat.
  const knight = createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight" });
  const orphan = { ...knight, archetypeId: "necromancer", equipment: { weapon: { slot: "weapon", tier: "legendary" } } } as unknown as CharacterSheet;
  assert.equal(effectiveArmorClass(orphan), orphan.armorClass);
  assert.equal(attackerBonusFor(orphan), attackerBonusFor({ ...knight, archetypeId: "necromancer" } as CharacterSheet));
  assert.equal(legendaryRiderFor(orphan), null);
  assert.deepEqual(equipmentIssuesFor(orphan), []);
  assert.equal(itemNameFor(orphan, "weapon"), null);
});

test("an equipment save bonus does not leak into skill checks, which are not saving throws", () => {
  const bare = createCharacter({ archetypeId: "shadow", name: "Sable", appearanceAssetId: "token_shadow" });
  const hooded = withGear(bare, { crown: "legendary" });
  assert.equal(skillModifierFor(hooded, "Stealth"), skillModifierFor(bare, "Stealth"));
  assert.equal(saveModifierFor(hooded, "dex"), saveModifierFor(bare, "dex") + 3, "but the save it is for does move");
});

test("a rider notation carrying a flat number is refused, because a flat number is damage no die produced", () => {
  assert.equal(isLegalRiderNotation("1d6"), true);
  assert.equal(isLegalRiderNotation("2d8"), true);
  assert.equal(isLegalRiderNotation("1d6+3"), false, "extra DICE, never a flat addend");
  assert.equal(isLegalRiderNotation("3d6"), false, "beyond MAX_RIDER_DICE");
  assert.equal(isLegalRiderNotation("1d12"), false, "beyond MAX_RIDER_SIDES");
  assert.equal(isLegalRiderNotation("a lot"), false);
  assert.throws(() => resolveMagicWeaponRider("1d6+3"), /not a legal magic weapon rider/);
});

test("the AC cap is applied in one place, so a Fighter cannot outrun the monster to-hit table", () => {
  // SRD stacks a +3 shield and +3 armour to +6 without complaint, which is
  // correct 5e and wrong for a level-3 game against creatures that hit at +4.
  assert.equal(stackedArmorBonus([3, 3], MAX_TOTAL_AC_BONUS), MAX_TOTAL_AC_BONUS);
  assert.equal(stackedArmorBonus([1, 1], MAX_TOTAL_AC_BONUS), 2, "and below the cap it does not interfere at all");
  assert.equal(stackedArmorBonus([], MAX_TOTAL_AC_BONUS), 0);
});

test("only a gripped slot is ever gated on a free hand, so the weapon and save bonuses can never be refused by one", () => {
  // characters/equipment.ts computes the weapon and save bonuses with a fixed
  // "both hands could be free" context, on the grounds that nothing SRD gates
  // either of them on a hand. This is that grounds, checked rather than
  // assumed: if a future set ever puts a weapon or a save item in
  // HAND_HELD_SLOTS, this fails instead of that shortcut silently granting it.
  //
  // It is also the arity alarm on `slotIsHandHeld`. It used to take a
  // SlotDefinition and now takes (archetypeId, role), and this loop called it
  // the old way for a while: every call fell through the unknown-archetype
  // guard and returned false, so the assertion below passed on all eight sets
  // without ever reading the table it exists to police. Passing the ids makes
  // it read the real table again.
  // Collected through ONE call expression rather than asserted per slot, so
  // the list itself is the alarm: a `slotIsHandHeld` that answers false for
  // everything leaves it empty and the last assertion fails, instead of every
  // per-slot assertion passing for the wrong reason.
  const gripped: string[] = [];
  for (const id of ARCHETYPE_IDS) {
    for (const role of SLOT_ROLES) {
      if (!slotIsHandHeld(id, role)) continue;
      gripped.push(`${id}.${role}`);
      const slot = SLOTS_BY_ARCHETYPE[id][role];
      assert.equal(slot.bonusKind, "armor", `${id}.${role} is a ${slot.bonusKind} slot and must not be gripped in a hand`);
    }
  }
  assert.deepEqual(gripped, ["knight.outer"], "exactly one piece in the shipped table is gripped, and it is the Knight's Kite Shield");
});

test("the armour source list never claims more AC than the engine actually applied", () => {
  // The cap is the one place a per-slot amount could out-sum the total. A panel
  // reading "+3 shield, +3 plate" beside an AC that moved by three is the same
  // lie as a decorative AC, so the breakdown is spent against the cap.
  const capped = knightWithGear({ outer: "legendary", crown: "legendary" });
  const ctx = equipmentContextFor(capped);
  const sources = equipmentBonusSources(capped, "armor", ctx);
  assert.equal(sources.reduce((sum, s) => sum + s.amount, 0), equipmentArmorBonus(capped, ctx));
  assert.equal(effectiveArmorClass(capped), capped.armorClass + MAX_TOTAL_AC_BONUS);

  // Below the cap every slot reports its own real contribution, in full.
  const under = knightWithGear({ outer: "uncommon", crown: "uncommon" });
  const underCtx = equipmentContextFor(under);
  const underSources = equipmentBonusSources(under, "armor", underCtx);
  assert.equal(underSources.length, 2);
  assert.equal(underSources.reduce((sum, s) => sum + s.amount, 0), equipmentArmorBonus(under, underCtx));

  // And a refused shield contributes nothing to the list, not a phantom line.
  // Forced through a two-handed weapon rather than through the Trooper, whose
  // braced Riot Shield is never refused: the Knight's Kite Shield is the one
  // gripped piece this game ships, so it is the one this rule can bite on.
  const twoHanded = equipmentBonusSources(capped, "armor", { weaponHands: 2, weaponName: "Greatsword" });
  assert.deepEqual(twoHanded.map((s) => s.label), ["Harness of the Last Wall"], "the shield drops out, the plate still pays");
  assert.equal(twoHanded.reduce((sum, s) => sum + s.amount, 0), equipmentArmorBonus(capped, { weaponHands: 2, weaponName: "Greatsword" }));

  // The Trooper's own breakdown, which is the finding this test used to encode
  // backwards. Their outer slot is a braced barrier, not a gripped shield, so
  // it is spent against the cap FIRST (SLOT_ROLES order) and the carapace is
  // what drops out, rather than the shield being silently refused forever.
  const trooper = withGear(createCharacter({ archetypeId: "trooper", name: "Vas", appearanceAssetId: "token_trooper" }), { outer: "legendary", crown: "uncommon" });
  const trooperCtx = equipmentContextFor(trooper);
  const trooperSources = equipmentBonusSources(trooper, "armor", trooperCtx);
  assert.deepEqual(trooperSources.map((s) => s.label), ["Wall Protocol"]);
  assert.equal(trooperSources.reduce((sum, s) => sum + s.amount, 0), equipmentArmorBonus(trooper, trooperCtx));
  assert.equal(equipmentArmorBonus(trooper, trooperCtx), MAX_TOTAL_AC_BONUS, "a legendary barrier is worth the whole cap, not nothing");
});

// -- the uncommon recolour, measured against the palettes that actually ship --
//
// A "+1" piece is the same drawing as its common version with a palette remap
// over it, which is the whole reason common and uncommon cost one sprite
// between them. That makes the remap tables mechanical data rather than art
// direction, and it is why they live in equipmentTypes.ts and are measured
// here instead of in either art lane's file: neither art lane can see the
// other's table, and the rule they both have to obey is a comparison between
// two ramps in the same palette.
//
// THE RULE: a recolour moves the HUE and holds the VALUE. Steel becoming brass
// is a different metal. Steel becoming darker steel is the same metal in
// shadow, and on a 16px sprite that reads as a downgrade: the reviewer's words
// for the version this test rejects were that the +1 longsword's blade read as
// wood and the +1 kite shield read as leather.

/** Rec709 luminance, the same measure both art lanes' own palette tests use. */
function rec709(rgb: readonly number[]): number {
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

/** How far the target ramp's brightest step may fall below the source's before the piece reads as dimmer rather than as different. */
const RECOLOUR_TOP_SLACK_L = 10;
/** How far the target ramp's total span may compress before the shading flattens out. */
const RECOLOUR_SPAN_TOLERANCE = 0.15;
/** And the same slack on the mean, which is what catches a ramp that keeps its span by sliding the whole thing down. */
const RECOLOUR_MEAN_SLACK_L = 10;

/**
 * Every way a remap can fail the value rule, in words a reader can act on.
 * Returns an empty list for a ramp that passes, so a test can assert on both a
 * shipped table and a rejected one with the same function.
 */
function recolourValueFaults(
  label: string,
  palette: readonly (readonly number[])[],
  ramp: readonly number[],
  remap: PaletteRemap,
): string[] {
  const faults: string[] = [];
  const source = ramp.map((i) => rec709(palette[i]!));
  const target = ramp.map((i) => rec709(palette[remap[i] ?? i]!));
  const span = (a: readonly number[]) => Math.max(...a) - Math.min(...a);
  const mean = (a: readonly number[]) => a.reduce((sum, v) => sum + v, 0) / a.length;

  const topSource = Math.max(...source);
  const topTarget = Math.max(...target);
  if (topTarget < topSource - RECOLOUR_TOP_SLACK_L) {
    faults.push(`${label}: brightest step fell from L${topSource.toFixed(0)} to L${topTarget.toFixed(0)}, so the metal is dimmer rather than different`);
  }

  const spanRatio = span(target) / span(source);
  if (Math.abs(spanRatio - 1) > RECOLOUR_SPAN_TOLERANCE) {
    faults.push(`${label}: ramp span moved from ${span(source).toFixed(0)}L to ${span(target).toFixed(0)}L (${(spanRatio * 100).toFixed(0)} percent), so the shading no longer reads the same`);
  }

  if (mean(target) < mean(source) - RECOLOUR_MEAN_SLACK_L) {
    faults.push(`${label}: mean luminance fell from L${mean(source).toFixed(0)} to L${mean(target).toFixed(0)}, so the whole piece is simply darker`);
  }

  // The ramp is authored brightest to darkest, and the remap has to preserve
  // that ORDER or the highlight stops being the highlight and the shading
  // inverts on a sprite nobody re-drew.
  for (let i = 1; i < target.length; i++) {
    if (target[i]! >= target[i - 1]!) {
      faults.push(`${label}: step ${i} (L${target[i]!.toFixed(0)}) is no darker than step ${i - 1} (L${target[i - 1]!.toFixed(0)}), so the ramp is not a ramp`);
    }
  }
  return faults;
}

/**
 * The version this test exists to keep out, kept verbatim as the negative
 * control. Without it, a test that only ever sees a passing table proves
 * nothing about whether it can fail: this is the exact pair of remaps the
 * reviewer measured, and `recolourValueFaults` has to reject both.
 */
const REJECTED_UNCOMMON_REMAPS: Readonly<Record<"fantasy" | "scifi", PaletteRemap>> = Object.freeze({
  fantasy: Object.freeze({ 5: 42, 8: 31, 32: 30, 33: 29 }),
  scifi: Object.freeze({ 5: 10, 4: 40, 32: 11, 33: 41 }),
});

const TEMPLATE_PALETTE: Readonly<Record<"fantasy" | "scifi", readonly (readonly number[])[]>> = {
  fantasy: FANTASY_PALETTE,
  scifi: SCIFI_PALETTE,
};

test("the uncommon recolour moves the hue and holds the value, on both templates", () => {
  for (const template of ["fantasy", "scifi"] as const) {
    const remap = RECOLOUR_BY_TIER[template].uncommon;
    assert.ok(remap, `${template} uncommon must be a remap: it is the tier that costs no new sprite`);
    assert.deepEqual(
      recolourValueFaults(template, TEMPLATE_PALETTE[template], GEAR_RAMP[template], remap),
      [],
      `${template}'s uncommon remap must move the hue without dropping the value`,
    );
  }

  // The negative control: the measured-and-rejected version, which failed the
  // top-luminance bound on fantasy (L238 down to L180, a highlight darker than
  // the common midtone), the span bound on fantasy (compressed 44 percent) and
  // the mean on both. If a future edit relaxes the bounds far enough to let
  // these through, this fails too, which is the point of keeping them.
  for (const template of ["fantasy", "scifi"] as const) {
    const faults = recolourValueFaults(template, TEMPLATE_PALETTE[template], GEAR_RAMP[template], REJECTED_UNCOMMON_REMAPS[template]);
    assert.ok(faults.length > 0, `the rejected ${template} remap must still be rejected, or these bounds have stopped biting`);
  }
});

test("a recolour covers the whole gear ramp and can never dissolve a silhouette", () => {
  // Two properties, and both are the compositor's safety rather than taste.
  // Coverage: the art lanes promise their base gear draws its primary material
  // in exactly these four indices, so a remap missing one leaves a stripe of
  // the old metal on the new one. Protection: index 0 is the outline in both
  // palettes and 48 to 51 are the compositor's reserved glow band, so a remap
  // naming either end of one erases the ring or the edge of the figure.
  for (const template of ["fantasy", "scifi"] as const) {
    const tiers = RECOLOUR_BY_TIER[template];
    for (const tier of ["common", "rare", "legendary"] as const) {
      assert.equal(tiers[tier], null, `${template} ${tier} draws as authored: common is the base art and the other two have their own drawings`);
    }
    const remap = tiers.uncommon!;
    for (const index of GEAR_RAMP[template]) {
      assert.ok(Object.prototype.hasOwnProperty.call(remap, index), `${template}'s uncommon remap must cover gear ramp index ${index}`);
    }
    for (const [key, value] of Object.entries(remap)) {
      assert.ok(!PROTECTED_PALETTE_INDICES.includes(Number(key)), `${template} may not remap protected index ${key}`);
      assert.ok(!PROTECTED_PALETTE_INDICES.includes(value), `${template} may not remap onto protected index ${value}`);
      assert.ok(value < TEMPLATE_PALETTE[template].length, `${template} remaps ${key} to ${value}, which is off the end of the palette`);
    }
  }
});

test("common and uncommon share one drawing, so a colour swap costs no new sprite", () => {
  // The claim the whole recolour design rests on, checked against the art that
  // actually ships rather than against the id grammar alone: the two cheapest
  // tiers resolve to the same asset id, and every id the engine can name for a
  // tier exists in the library the renderer will look it up in.
  const shipped = new Set([...FANTASY_SPRITES, ...SCIFI_SPRITES].map((s) => s.assetId));
  for (const id of ARCHETYPE_IDS) {
    assert.ok(shipped.has(bodySpriteId(id)), `${id}'s body sprite ${bodySpriteId(id)} must exist, and its id may never move`);
    for (const role of SLOT_ROLES) {
      assert.equal(
        equipmentSpriteId(id, role, tierArtVariant("uncommon")),
        equipmentSpriteId(id, role, tierArtVariant("common")),
        `${id}.${role} at uncommon must reuse the common drawing; the tier differs by remap alone`,
      );
      for (const tier of ["common", "uncommon", "rare", "legendary"] as const) {
        const spriteId = equipmentSpriteId(id, role, tierArtVariant(tier));
        assert.ok(shipped.has(spriteId), `${id}.${role} at ${tier} names ${spriteId}, which nothing has drawn`);
      }
    }
  }
});

// -- what is in the hand, and what is enchanted, when they are not the same --

test("the item the bonus comes off and the weapon that was swung are reconciled, never picked between", () => {
  // THE DEFECT: two tables name a character's weapon and they answer different
  // questions. SLOTS_BY_ARCHETYPE says what is ENCHANTED (the object the rarity
  // ladder acts on); KIT_BY_ARCHETYPE says what the ENGINE ROLLS (the die, the
  // ability, the range band), and the fighting style can move it. For the
  // Mage and the Psion those are genuinely two objects, and naming
  // only the enchanted one printed a dice log that was simply false: a
  // legendary staff logged "Sunstroke: 4 fire damage" beside an attack the
  // engine had resolved as a Fire Bolt, naming a weapon nobody swung.
  const wizard = withGear(
    createCharacter({ archetypeId: "fireball-person", name: "Ash", appearanceAssetId: "token_fireball_person" }),
    { weapon: "legendary" },
  );
  assert.equal(weaponFor(wizard).name, "Fire Bolt", "the engine rolls the cantrip");
  assert.equal(itemNameFor(wizard, "weapon"), "Sunstroke", "and the bonus comes off the staff");

  const identity = weaponIdentityFor(wizard);
  assert.equal(identity.differs, true);
  assert.equal(identity.label, "Fire Bolt (Sunstroke)", "one label, naming the swing first and the item that lit it second");

  const rider = legendaryRiderDamageFor(wizard, () => 0.5, false)!;
  assert.ok(rider, "a legendary weapon has a rider to name");
  assert.equal(rider.source, identity.label, "the rider line names the weapon that was actually swung");
  assert.notEqual(rider.source, "Sunstroke", "which is precisely what it used to say, against a Fire Bolt");

  // The attack breakdown says the same thing, and still adds up, which is the
  // one hard rule for a readout: relabelling a source may not change its
  // amount.
  const sources = attackBonusSourcesFor(wizard);
  assert.ok(sources.some((s) => s.label === identity.label), "the gear line is relabelled too, not left disagreeing with the rider");
  assert.equal(sources.reduce((sum, s) => sum + s.amount, 0), attackerBonusFor(wizard));

  // The Psion is the sci-fi mirror of the same case.
  const psion = withGear(createCharacter({ archetypeId: "psion", name: "Rill", appearanceAssetId: "token_psion" }), { weapon: "legendary" });
  assert.equal(weaponIdentityFor(psion).label, "Neural Lash (Silence Itself)");
  assert.equal(legendaryRiderDamageFor(psion, () => 0.5, false)!.source, "Neural Lash (Silence Itself)");

  // And a fighting style that SELECTS a different weapon is the third case: an
  // Archery Knight leads with the thrown axe, so the +1 longsword is not what
  // is in their hand either, and the label has to follow the style.
  const archer = withGear(
    createCharacter({ archetypeId: "knight", name: "Kira", appearanceAssetId: "token_knight", choices: { fightingStyle: "archery" } }),
    { weapon: "uncommon" },
  );
  assert.equal(weaponFor(archer).name, "Thrown handaxe");
  assert.equal(weaponIdentityFor(archer).label, "Thrown handaxe (Keen Longsword)");
  assert.ok(attackBonusSourcesFor(archer).some((s) => s.label === "Thrown handaxe (Keen Longsword)"));
});

test("where the two tables describe one object they spell it identically, so nothing is named twice", () => {
  // The other half of the same fix, and the one that keeps the label above
  // rare rather than routine: for six of the eight archetypes the gear row and
  // the attack line are describing the same physical object, and they used to
  // spell it differently ("Shortsword" against "Shortblade", "Sidearm
  // (suppressed)" against "Sidearm", "Plasma rifle" against "Plasma Rifle").
  // A player was told they carry one thing and swing another. Where the names
  // agree, `weaponIdentityFor` prints ONE noun, with no parenthetical at all.
  const genuinelyTwoObjects = new Set(["fireball-person", "psion"]);
  for (const id of ARCHETYPE_IDS) {
    const sheet = createCharacter({ archetypeId: id, name: "Test", appearanceAssetId: bodySpriteId(id) });
    const identity = weaponIdentityFor(sheet);
    if (genuinelyTwoObjects.has(id)) {
      assert.equal(identity.differs, true, `${id} really does cast through its gear, so both nouns have to appear`);
      assert.match(identity.label, /\(.+\)/, `${id}'s label must name the item as well as the swing`);
      continue;
    }
    assert.equal(
      identity.baseItemName,
      weaponFor(sheet).name,
      `${id}'s gear table and kit table describe one object and must spell it identically`,
    );
    assert.equal(identity.differs, false);
    assert.equal(identity.label, itemNameFor(sheet, "weapon"), `${id} names the object once, at its current tier`);
    assert.doesNotMatch(identity.label, /\(/, `${id} has nothing to disambiguate, so no parenthetical belongs on it`);
  }
});

// ===========================================================================
// CONTRACT V2: six slots, the bag, attunement, and the new item effects
// ===========================================================================
//
// Every test below fails before this change (equipment.ts still only knew
// three roles, rules/attunement.ts and rules/inventory.ts did not exist,
// session/combat.ts had no checkAdvantageFor/checkBonusSourcesFor/
// evasionRescue) and passes after it.

/** Equip a role/tier onto a sheet directly (bypassing the bag), for a test that only needs the resulting numbers. Mirrors `withGear` above but over all six GearRoles. */
function withGearV2(sheet: CharacterSheet, gear: Partial<Record<GearRole, EquipmentTier>>): CharacterSheet {
  let equipment = equipmentOf(sheet);
  for (const role of GEAR_ROLES) {
    const tier = gear[role];
    if (tier) equipment = equipSlot(equipment, role, tier);
  }
  return { ...sheet, equipment } as CharacterSheet;
}

function fireballPersonWithGear(gear: Partial<Record<GearRole, EquipmentTier>>): CharacterSheet {
  return withGearV2(createCharacter({ archetypeId: "fireball-person", name: "Ren", appearanceAssetId: "token_fireball_person" }), gear);
}

test("GEAR_ROLES is the canonical six, weapon/outer/crown first, in that order", () => {
  assert.deepEqual(GEAR_ROLES, ["weapon", "outer", "crown", "ring", "amulet", "boots"]);
});

test("every ACCESSORY_ITEMS entry: its own role and tier match its keys, its effect sits inside EFFECT_BOUNDS, and requiresAttunement matches its SRD source exactly", () => {
  for (const role of ACCESSORY_ROLES) {
    for (const tier of MAGIC_TIERS) {
      const item = ACCESSORY_ITEMS[role][tier];
      if (!item) continue; // the two intentionally empty rungs
      assert.equal(item.role, role);
      assert.equal(item.tier, tier);
      assert.equal(item.requiresAttunement, item.srd?.attunement ?? false, `${role} ${tier}: requiresAttunement must equal its SRD source, or false when there is none`);
      const effect = item.effect;
      if (!effect) continue; // the mundane common boots
      switch (effect.kind) {
        case "protection":
          assert.ok(effect.amount >= 1 && effect.amount <= EFFECT_BOUNDS.protectionAmountMax);
          break;
        case "luck":
          assert.ok(effect.amount >= 1 && effect.amount <= EFFECT_BOUNDS.luckAmountMax);
          break;
        case "speedMultiplier":
          assert.ok(effect.factor >= 1 && effect.factor <= EFFECT_BOUNDS.speedFactorMax);
          break;
        case "hitDieHealingMultiplier":
          assert.ok(effect.factor >= 1 && effect.factor <= EFFECT_BOUNDS.hitDieHealingFactorMax);
          break;
        case "saveRescue": {
          assert.ok(effect.charges >= 1 && effect.charges <= EFFECT_BOUNDS.saveRescueChargesMax);
          const { count, sides, modifier } = parseDiceNotation(effect.rechargeDice);
          assert.equal(modifier, 0, "rechargeDice is dice alone, no flat modifier");
          assert.ok(count >= 1 && count <= EFFECT_BOUNDS.restRegenDiceMax);
          assert.ok(sides >= 2 && sides <= EFFECT_BOUNDS.restRegenSidesMax);
          break;
        }
        case "restRegeneration": {
          const { count, sides, modifier } = parseDiceNotation(effect.dice);
          assert.equal(modifier, 0, "restRegeneration's dice is dice alone, no flat modifier");
          assert.ok(count >= 1 && count <= EFFECT_BOUNDS.restRegenDiceMax);
          assert.ok(sides >= 2 && sides <= EFFECT_BOUNDS.restRegenSidesMax);
          break;
        }
        case "skillAdvantage":
          break; // a fixed skill, not a bounded magnitude
      }
    }
  }
});

test("a character can own at most MAX_DISTINCT_MAGIC_ITEMS pieces, and that always fits in the bag, so a full bag cannot happen", () => {
  assert.ok(MAX_DISTINCT_MAGIC_ITEMS <= BAG_CAPACITY, `${MAX_DISTINCT_MAGIC_ITEMS} owned pieces must fit inside a ${BAG_CAPACITY}-cell bag`);
  assert.equal(MAX_DISTINCT_MAGIC_ITEMS, 16, "3 rungs each on weapon/outer/crown/ring, 2 each on amulet/boots, per the contract's own arithmetic");
});

test("normalizeEquipment: boots falls back to common for a tier it has no item at (the empty legendary rung), never silently accepting an unbacked tier", () => {
  const out = normalizeEquipment({ boots: { slot: "boots", tier: "legendary" } });
  assert.equal(out.boots?.tier, "common", "there is no legendary boots item, so this must degrade exactly like an unrecognised tier does");
});

test("normalizeEquipment: ring and amulet are dropped, not defaulted, for common, an unknown tier, or a tier that has no item there", () => {
  assert.equal(normalizeEquipment({ ring: { slot: "ring", tier: "common" } }).ring, undefined, "no ring is ever tier common");
  assert.equal(normalizeEquipment({ amulet: { slot: "amulet", tier: "legendary" } }).amulet, undefined, "the legendary amulet rung is intentionally empty");
  assert.equal(normalizeEquipment({ ring: { slot: "ring", tier: "mythic" } }).ring, undefined);
  const kept = normalizeEquipment({ ring: { slot: "ring", tier: "rare" } });
  assert.deepEqual(kept.ring, { slot: "ring", tier: "rare" });
});

test("attunedRoles: GEAR_ROLES order, capped at MAX_ATTUNED_ITEMS, and a bad blob wearing more than three is still safe", () => {
  // fireball-person: crown (save-kind) requires attunement from uncommon up;
  // weapon requires it only at legendary; ring/amulet/boots per ACCESSORY_ITEMS.
  const oneAttuned = fireballPersonWithGear({ crown: "rare" });
  assert.deepEqual(attunedRoles("fireball-person", equipmentOf(oneAttuned)), ["crown"]);

  const threeAttuned = fireballPersonWithGear({ crown: "rare", ring: "rare", amulet: "rare" });
  assert.deepEqual(attunedRoles("fireball-person", equipmentOf(threeAttuned)), ["crown", "ring", "amulet"]);

  // A bad blob: weapon (legendary, needs attunement), crown, ring, amulet and
  // boots (rare, needs attunement) all at once is five candidates. Only the
  // first three in GEAR_ROLES order (weapon, crown, ring) count as attuned;
  // amulet and boots are refused, not silently active.
  const badBlob = fireballPersonWithGear({ weapon: "legendary", crown: "rare", ring: "rare", amulet: "rare", boots: "rare" });
  assert.deepEqual(attunedRoles("fireball-person", equipmentOf(badBlob)), ["weapon", "crown", "ring"]);
  assert.equal(isRoleAttuned("fireball-person", equipmentOf(badBlob), "amulet"), false, "the fourth candidate in GEAR_ROLES order is inactive, not attuned");
  assert.equal(isRoleAttuned("fireball-person", equipmentOf(badBlob), "boots"), false);

  // Common gear and gear that never needs attunement (a +1/+2 weapon, any
  // armour-kind slot, common boots, Boots of Elvenkind) never occupies a slot
  // in the attuned set at all.
  assert.deepEqual(attunedRoles("knight", equipmentOf(createCharacter({ archetypeId: "knight", name: "K", appearanceAssetId: "token_knight" }))), []);
});

test("accessoryStatus: a worn magic item within the attunement cap is active with no reason; one pushed past it is refused with the attunement-needed line, never silently active", () => {
  const withinCap = fireballPersonWithGear({ ring: "rare", amulet: "rare", boots: "rare" }); // three candidates, all fit
  const ring = accessoryStatus(withinCap, "ring");
  assert.equal(ring.name, "Ring of Protection");
  assert.equal(ring.requiresAttunement, true);
  assert.equal(ring.attuned, true);
  assert.equal(ring.active, true);
  assert.equal(ring.reason, undefined);

  const pastCap = fireballPersonWithGear({ crown: "rare", ring: "rare", amulet: "rare", boots: "rare" }); // crown makes it four candidates for a cap of three
  const status = accessoryStatus(pastCap, "boots");
  assert.equal(status.active, false, "boots is the fourth candidate in GEAR_ROLES order, so it falls out of the attuned set");
  assert.equal(status.reason, attunementNeededLineFor(pastCap));
});

function attunementNeededLineFor(sheet: CharacterSheet): string {
  return `Needs attunement. You are attuned to ${attunedRoles(sheet.archetypeId, equipmentOf(sheet)).length} of ${MAX_ATTUNED_ITEMS}.`;
}

test("a Ring of Protection's +1 joins BOTH the AC total and the save total, each inside its own cap", () => {
  const sheet = fireballPersonWithGear({ ring: "rare" }); // Ring of Protection, +1 AC, +1 save
  const ctx = equipmentContextFor(sheet);
  assert.equal(equipmentArmorBonus(sheet, ctx), 1, "outer is common (+0), so the ring alone carries the AC line");
  assert.equal(equipmentSaveBonus(sheet), 1);
});

test("a Stone of Good Luck's +1 joins both the check total and the save total", () => {
  const sheet = fireballPersonWithGear({ amulet: "rare" });
  assert.equal(equipmentCheckBonus(sheet), 1);
  assert.equal(equipmentSaveBonus(sheet), 1);
  const arcana = checkBonusSourcesFor(sheet, "Arcana");
  assert.equal(arcana.reduce((sum, s) => sum + s.amount, 0), skillModifierFor(sheet, "Arcana"), "checkBonusSourcesFor must sum to skillModifierFor exactly");
  assert.ok(arcana.some((s) => s.label === "Stone of Good Luck" && s.amount === 1));
});

test("MAX_TOTAL_SAVE_BONUS binds across a save-kind crown, a Ring of Protection and a Stone of Good Luck, spent in GEAR_ROLES order", () => {
  // fireball-person's crown is save-kind: at rare it is worth +2 and requires
  // attunement from uncommon up. Stacked with a rare ring (+1) and a rare
  // amulet (+1) that is 4 on paper against a cap of 3.
  const sheet = fireballPersonWithGear({ crown: "rare", ring: "rare", amulet: "rare" });
  assert.deepEqual(attunedRoles("fireball-person", equipmentOf(sheet)), ["crown", "ring", "amulet"], "all three fit inside the attunement cap too");
  assert.equal(equipmentSaveBonus(sheet), MAX_TOTAL_SAVE_BONUS, "2 + 1 + 1 = 4 on paper, capped at 3 in play");

  const ctx = equipmentContextFor(sheet);
  const sources = equipmentBonusSources(sheet, "save", ctx);
  assert.equal(sources.reduce((sum, s) => sum + s.amount, 0), MAX_TOTAL_SAVE_BONUS, "the breakdown must sum to exactly what the engine applies, never to the 4 on paper");
  assert.deepEqual(
    sources.map((s) => s.label),
    ["Hat of the Ember Circle", "Ring of Protection"],
    "spent in GEAR_ROLES order (crown before ring before amulet): the cap is gone before amulet's turn, so amulet drops out of the breakdown entirely",
  );
});

test("Boots of Elvenkind grant Stealth advantage by name, case-insensitively, and nothing else", () => {
  const sheet = fireballPersonWithGear({ boots: "uncommon" }); // no attunement needed at all
  assert.equal(accessoryStatus(sheet, "boots").requiresAttunement, false, "SRD: Boots of Elvenkind need no attunement");
  assert.equal(checkAdvantageFor(sheet, "Stealth"), "Boots of Elvenkind");
  assert.equal(checkAdvantageFor(sheet, "stealth"), "Boots of Elvenkind", "compared case-insensitively");
  assert.equal(checkAdvantageFor(sheet, "Athletics"), null);
  assert.equal(checkAdvantageFor(fireballPersonWithGear({}), "Stealth"), null, "the common starting boots grant nothing");
});

test("Boots of Speed double effective speed, applied AFTER the armour Strength penalty", () => {
  const sheet = fireballPersonWithGear({ boots: "rare" }); // Boots of Speed, requires attunement, and it is the only candidate
  assert.deepEqual(attunedRoles("fireball-person", equipmentOf(sheet)), ["boots"]);
  assert.equal(effectiveSpeedFt(sheet), DEFAULT_SPEED_FT * 2, "unarmoured wizard chassis: no penalty to apply first, so this is a clean x2");

  // A fighter chassis whose Strength does not clear its own armour's
  // requirement, wearing the same rare boots: (30 - 10) x 2 = 40, never
  // (30 x 2) - 10 = 50. SRD 5.1's own Boots of Speed doubles whatever your
  // speed already is, penalty included.
  const knight = withGearV2(createCharacter({ archetypeId: "knight", name: "Weak", appearanceAssetId: "token_knight" }), { boots: "rare" });
  const weak = { ...knight, abilities: { ...knight.abilities, str: 8 } } as CharacterSheet;
  assert.equal(armorSpeedPenaltyFt(weak), 10, "STR 8 fails chain mail's Str 13 requirement");
  assert.equal(effectiveSpeedFt(weak), (DEFAULT_SPEED_FT - 10) * 2);
});

test("evasionRescue: a Ring of Evasion turns a failed Dexterity save into a success and spends exactly one charge", () => {
  const sheet = fireballPersonWithGear({ ring: "uncommon" }); // Ring of Evasion, dex, 3 charges, needs attunement, only candidate
  assert.deepEqual(attunedRoles("fireball-person", equipmentOf(sheet)), ["ring"]);

  const failedDex = { roll: 4, total: 9, success: false };
  const first = evasionRescue(sheet, "dex", failedDex);
  assert.ok(first);
  assert.equal(first!.result.success, true);
  assert.match(first!.note, /Ring of Evasion.*2 of 3 charges left/);
  assert.equal(first!.sheet.itemCharges?.["ring:uncommon"], 2);

  const second = evasionRescue(first!.sheet, "dex", failedDex);
  const third = evasionRescue(second!.sheet, "dex", failedDex);
  assert.equal(third!.sheet.itemCharges?.["ring:uncommon"], 0);
  const fourth = evasionRescue(third!.sheet, "dex", failedDex);
  assert.equal(fourth, null, "no charges left: no rescue");

  assert.equal(evasionRescue(sheet, "dex", { roll: 15, total: 20, success: true }), null, "a save that already succeeded is never rescued");
  assert.equal(evasionRescue(sheet, "str", failedDex), null, "the ring only ever rescues Dexterity");
  assert.equal(evasionRescue(fireballPersonWithGear({}), "dex", failedDex), null, "no ring worn at all grants nothing");
});

test("accessoryStatus's attunement gate really can exclude a role: amulet and boots, which sit AFTER ring in GEAR_ROLES order, fall out once weapon, crown and ring have already filled the cap", () => {
  const sheet = fireballPersonWithGear({ weapon: "legendary", crown: "rare", ring: "rare", amulet: "rare", boots: "rare" });
  assert.deepEqual(attunedRoles("fireball-person", equipmentOf(sheet)), ["weapon", "crown", "ring"]);
  // Ring itself can never be the excluded one on this archetype: only
  // weapon and a save-kind crown can precede it in GEAR_ROLES order, and
  // that is at most two blockers against a cap of three, so a Ring of
  // Evasion equipped alongside them is always attuned. Amulet and boots,
  // which come AFTER ring, are the roles that can genuinely fall outside
  // the cap, and evasionRescue reads that gate through accessoryStatus.
  assert.equal(accessoryStatus(sheet, "ring").active, true);
  assert.equal(accessoryStatus(sheet, "amulet").active, false);
  assert.equal(accessoryStatus(sheet, "boots").active, false);
});

test("gearChangeBlockedReason: dead beats down beats hostiles beats nothing, in exactly that order, with the pinned copy", () => {
  const alive = { name: "Kira", downed: false, stable: false, dead: false };
  assert.equal(gearChangeBlockedReason(alive, false), null);
  assert.equal(gearChangeBlockedReason(alive, true), "Not with something still in the room. Look all you like; gear changes wait until the fight is over.");
  assert.equal(gearChangeBlockedReason({ ...alive, downed: true }, false), "You are on the floor. Gear changes wait until you are back on your feet.");
  assert.equal(gearChangeBlockedReason({ ...alive, stable: true }, true), "You are on the floor. Gear changes wait until you are back on your feet.", "down beats hostiles, checked first");
  assert.equal(gearChangeBlockedReason({ ...alive, dead: true }, true), "Kira is gone. Nothing here changes hands.", "dead beats everything else");
});

test("staging: draftFromSheet copies equipment and bag without aliasing the sheet's own arrays/objects", () => {
  const sheet = { ...fireballPersonWithGear({}), bag: [{ slot: "ring", tier: "rare" } as BagItem] } as CharacterSheet;
  const draft = draftFromSheet(sheet);
  assert.deepEqual(draft.bag, sheet.bag);
  assert.notEqual(draft.bag, sheet.bag, "must be a copy, not the same array reference");
  assert.deepEqual(draft.equipment, sheet.equipment);
  assert.notEqual(draft.equipment, sheet.equipment);
});

test("stageEquip swaps a bag item into its slot IN PLACE, and refuses a fourth attunement item with attunementFullReason", () => {
  const sheet = fireballPersonWithGear({ crown: "rare", ring: "rare", amulet: "rare" }); // 3 attuned, cap full
  const draft = { ...draftFromSheet(sheet), bag: [{ slot: "weapon", tier: "legendary" } as BagItem] };
  const refused = stageEquip("fireball-person", draft, 0);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(
      refused.reason,
      "You can be attuned to three magic items at once, and you are: Hat of the Ember Circle, Ring of Protection and Stone of Good Luck. Take one of them off first.",
    );
  }

  // Equipping something that needs NO attunement (a plain +1/+2 weapon) is
  // never gated by the cap, even while it is full.
  const plusOne = { ...draftFromSheet(sheet), bag: [{ slot: "weapon", tier: "uncommon" } as BagItem] };
  const equipped = stageEquip("fireball-person", plusOne, 0);
  assert.equal(equipped.ok, true);
  if (equipped.ok) {
    assert.equal(equipped.draft.equipment.weapon?.tier, "uncommon");
    // the outgoing piece was common, so the cell is REMOVED, not swapped:
    assert.deepEqual(equipped.draft.bag, []);
  }

  // Swapping in place: the outgoing MAGIC piece takes the incoming item's
  // cell, so the grid never jumps.
  const swapDraft: LoadoutDraftLike = { equipment: { ...sheet.equipment, ring: { slot: "ring", tier: "rare" } } as Equipment, bag: [{ slot: "ring", tier: "legendary" } as BagItem] };
  const swapped = stageEquip("fireball-person", swapDraft, 0);
  assert.equal(swapped.ok, true);
  if (swapped.ok) {
    assert.equal(swapped.draft.equipment.ring?.tier, "legendary");
    assert.deepEqual(swapped.draft.bag, [{ slot: "ring", tier: "rare" }], "the outgoing rare ring took the incoming legendary ring's cell");
  }
});

type LoadoutDraftLike = { equipment: Equipment; bag: BagItem[] };

test("stageUnequip appends to the end of the bag, restores the common piece for a drawn role, and empties a sheet-only role", () => {
  const sheet = fireballPersonWithGear({ weapon: "uncommon" });
  const draft = draftFromSheet(sheet);

  const unequippedWeapon = stageUnequip("fireball-person", draft, "weapon");
  assert.equal(unequippedWeapon.ok, true);
  if (unequippedWeapon.ok) {
    assert.equal(unequippedWeapon.draft.equipment.weapon?.tier, "common", "the character's own weapon returns");
    assert.deepEqual(unequippedWeapon.draft.bag, [{ slot: "weapon", tier: "uncommon" }]);
  }

  const ringSheet = fireballPersonWithGear({ ring: "rare" });
  const unequippedRing = stageUnequip("fireball-person", draftFromSheet(ringSheet), "ring");
  assert.equal(unequippedRing.ok, true);
  if (unequippedRing.ok) {
    assert.equal(unequippedRing.draft.equipment.ring, undefined, "an unequipped ring EMPTIES the slot; there is no common ring to fall back to");
  }

  const nothingWorn = stageUnequip("fireball-person", draftFromSheet(fireballPersonWithGear({})), "weapon");
  assert.equal(nothingWorn.ok, false, "the character's own common weapon has no Unequip button");
});

test("commitLoadout writes only equipment and bag, and refuses a draft that would create or destroy an owned item", () => {
  const sheet = fireballPersonWithGear({ weapon: "uncommon" });
  const legalDraft = stageUnequip("fireball-person", draftFromSheet(sheet), "weapon");
  assert.equal(legalDraft.ok, true);
  if (legalDraft.ok) {
    const committed = commitLoadout(sheet, legalDraft.draft);
    assert.deepEqual(committed.equipment, legalDraft.draft.equipment);
    assert.deepEqual(committed.bag, legalDraft.draft.bag);
    assert.equal(committed.currentHp, sheet.currentHp, "nothing but equipment and bag moves");
  }

  // A draft that invents an item out of nowhere (never staged) must be refused.
  const forged: LoadoutDraftLike = { equipment: sheet.equipment as Equipment, bag: [{ slot: "crown", tier: "legendary" } as BagItem] };
  const rejected = commitLoadout(sheet, forged);
  assert.equal(rejected, sheet, "an invalid transition returns the SAME sheet object, unchanged");
});

test("normalizeBag: drops an item that does not exist, a duplicate, or one already worn, and keeps every real distinct item that fits", () => {
  const equipment = equipmentOf(fireballPersonWithGear({ weapon: "uncommon" }));
  const raw = [
    { slot: "ring", tier: "rare" },
    { slot: "ring", tier: "rare" }, // duplicate, dropped
    { slot: "amulet", tier: "legendary" }, // does not exist, dropped
    { slot: "weapon", tier: "uncommon" }, // already worn, dropped
    { slot: "boots", tier: "rare" },
    "garbage",
    null,
  ];
  const bag = normalizeBag(raw, "fireball-person", equipment);
  assert.deepEqual(bag, [
    { slot: "ring", tier: "rare" },
    { slot: "boots", tier: "rare" },
  ]);

  // The BAG_CAPACITY truncation branch exists for a hand-edited or future
  // blob, but it is UNREACHABLE with data this game can actually produce:
  // there are only MAX_DISTINCT_MAGIC_ITEMS (16) distinct (role, tier) pairs
  // in the whole game, which is below BAG_CAPACITY (18) by construction (see
  // the dedicated test for that inequality), so every real magic item this
  // archetype could ever own survives normalisation at once.
  const everyRealItem: BagItem[] = ACCESSORY_ROLES.flatMap((role) =>
    MAGIC_TIERS.filter((tier) => gearItemExists("fireball-person", role, tier)).map((tier) => ({ slot: role, tier })),
  );
  assert.ok(everyRealItem.length < BAG_CAPACITY);
  assert.equal(normalizeBag(everyRealItem, "fireball-person", {}).length, everyRealItem.length);
});

test("gearRequiresAttunement / gearItemExists / gearItemName agree with the ACCESSORY_ITEMS table directly, for every role and tier this game ships", () => {
  for (const role of ACCESSORY_ROLES) {
    for (const tier of MAGIC_TIERS) {
      const item = ACCESSORY_ITEMS[role][tier];
      assert.equal(gearItemExists("fireball-person", role, tier), item !== undefined);
      if (item) {
        assert.equal(gearRequiresAttunement("fireball-person", role, tier), item.requiresAttunement);
        assert.equal(gearItemName("fireball-person", role, tier), item.nameByTemplate.fantasy);
        assert.equal(gearItemName("trooper", role, tier), item.nameByTemplate.scifi);
      }
    }
  }
});

test("canEquip refuses a role/tier pair with no item (an empty rung), even though it never refuses a legal donning", () => {
  const sheet = fireballPersonWithGear({});
  assert.equal(canEquip(sheet, "boots", "legendary").ok, false, "no legendary boots exist");
  assert.equal(canEquip(sheet, "amulet", "legendary").ok, false, "no legendary amulet exists");
  assert.equal(canEquip(sheet, "ring", "rare").ok, true);
  assert.equal(canEquip(sheet, "weapon", "legendary").ok, true, "donning is never banned; only attunement gates whether it does anything");
});
