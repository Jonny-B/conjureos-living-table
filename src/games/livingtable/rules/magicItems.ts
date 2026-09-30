/**
 * SRD 5.1 magic items, expressed the way every other module in `rules/` is:
 * plain numbers in, outcomes out.
 *
 * Nothing here knows what a CharacterSheet is, what an archetype is, or what a
 * sprite looks like, and that is deliberate. `rules/` is the layer that decides
 * hit-or-miss, damage and legality from numbers alone; the adapter that reads a
 * sheet and hands those numbers over is `session/combat.ts`, exactly as it
 * already is for fighting styles, critical range and maneuvers. Keeping the
 * boundary means a magic item's arithmetic can be tested without building a
 * character, and it means no part of the engine that touches a d20 has to learn
 * about equipment at all.
 *
 * WHY THIS MODULE EXISTS AT ALL, given that a +1 is just an addition: equipment
 * is the first system in the game that adds a number to a d20 AFTER character
 * creation, which makes it the first plausible route by which a number the
 * engine did not compute could reach a roll. Every rule below is therefore
 * written as a function the engine calls rather than as a value anything can
 * store: a stored bonus is a number something other than this file could write.
 *
 * Rules basis: SRD 5.1, CC BY 4.0. The ladder is the SRD's own
 * "Weapon, +1/+2/+3" and "Armor, +1/+2/+3", the rider is the "Flame Tongue"
 * shape (extra damage dice of a named type on a hit), the shield rule is the
 * SRD equipment chapter's "a shield is carried in one hand", and the armour
 * Strength rule is the SRD armour table's Strength column. Nothing invented.
 */
import { parseDiceNotation, type DiceResult } from "./dice";
import { resolveDamage } from "./combat";

// ── the bonus ladder ───────────────────────────────────────────────────

/** SRD 5.1's magic bonus range. +0 is not an SRD magic item at all; it is this game's mundane starting kit, which is why the floor is 0 rather than 1. */
export const MAGIC_ITEM_BONUS_MIN = 0;
export const MAGIC_ITEM_BONUS_MAX = 3;

/**
 * Whether a number is a bonus the SRD would recognise on a magic item.
 *
 * Used as an assertion at the boundaries rather than as a filter: every bonus
 * in this game comes out of one frozen table, so a value failing this check
 * means the table is wrong, not that a caller passed something odd.
 */
export function isSrdMagicBonus(n: number): boolean {
  return Number.isInteger(n) && n >= MAGIC_ITEM_BONUS_MIN && n <= MAGIC_ITEM_BONUS_MAX;
}

/**
 * Sum a set of AC bonuses and bound the total.
 *
 * SRD 5.1 lets a +N armour and a +N shield stack without limit, which is
 * correct 5e and completely wrong for a game capped at level 3 against
 * creatures that hit at +4: a Fighter in +3 plate with a +3 shield is AC 22 at
 * level 3, which no launch monster can reach on anything but a natural 20. The
 * cap is the one house rule in this feature and it is applied HERE, in one
 * function, so there is exactly one place it can be argued with or lifted.
 *
 * Negative bonuses are not a thing this game ships (there is no cursed tier),
 * but the sum is floored at 0 anyway so a hand-edited table can never turn a
 * character's own armour into a penalty.
 *
 * CONTRACT V2 reuses this same function for the save cap (MAX_TOTAL_SAVE_BONUS)
 * and the check cap (MAX_TOTAL_CHECK_BONUS): "sum a set of bonuses and bound
 * the total" is the identical operation for all three, and giving each its
 * own copy would be three places a cap-spending bug could hide instead of
 * one. The name stays "Armor" because that is still its first and most-used
 * caller; a generic rename would touch every existing import for no
 * behavioural gain.
 */
export function stackedArmorBonus(bonuses: readonly number[], cap: number): number {
  const total = bonuses.reduce((sum, b) => sum + b, 0);
  return Math.max(0, Math.min(cap, total));
}

// ── hands, and what a shield needs ─────────────────────────────────────

/** A creature has two hands. Stated as a constant because the shield rule is arithmetic on it, not a special case about shields. */
export const HANDS_PER_CREATURE = 2;

/** SRD 5.1, Equipment: "A shield is made from wood or metal and is carried in one hand." */
export const SHIELD_HANDS_REQUIRED = 1;

/** How many hands are left after the weapon in use takes its own. Never negative: a weapon claiming three hands is a data bug, not a creature with a debt. */
export function handsFree(handsUsedByWeapon: number): number {
  return Math.max(0, HANDS_PER_CREATURE - Math.max(0, handsUsedByWeapon));
}

/**
 * Whether a shield can be carried alongside the weapon in use.
 *
 * This is the SRD rule that makes sword-and-board a real build rather than a
 * free +2: a two-handed weapon leaves no hand for a shield, so the shield's AC
 * simply does not apply. Enforced by the engine rather than left to the
 * fiction, because "the character is holding a shield" is exactly the kind of
 * claim a narrator would happily make about someone gripping a rifle.
 */
export function canCarryShield(handsUsedByWeapon: number): boolean {
  return handsFree(handsUsedByWeapon) >= SHIELD_HANDS_REQUIRED;
}

// ── the armour Strength requirement ────────────────────────────────────

/**
 * SRD 5.1, Armor: "If the Armor table shows 'Str 13' or 'Str 15' in the
 * Strength column for an armor, the armor reduces the wearer's speed by 10 feet
 * unless the wearer has a Strength score equal to or higher than the listed
 * score."
 *
 * Note what the SRD does NOT say: it does not forbid wearing the armour and it
 * does not take the armour's AC away. A rule that banned the equip would be
 * stricter than the ruleset, and this engine's job is to be accurate rather
 * than merely strict, the same distinction `dcForRollRequest` already draws
 * between bounding a DC and replacing one.
 */
export const HEAVY_ARMOR_SPEED_PENALTY_FT = 10;

/** SRD 5.1 armour table, Strength column, for the two heavy armours this game's kits actually use. */
export const CHAIN_MAIL_STRENGTH = 13;
export const PLATE_STRENGTH = 15;

/**
 * The speed penalty in feet for wearing armour whose Strength requirement this
 * character does not meet. Zero when the armour lists no requirement
 * (`requirement` of 0, which is every light and medium armour in the SRD table
 * bar half plate and none of the ones this game ships).
 */
export function heavyArmorSpeedPenalty(strengthScore: number, requirement: number): number {
  if (requirement <= 0) return 0;
  return strengthScore >= requirement ? 0 : HEAVY_ARMOR_SPEED_PENALTY_FT;
}

// ── the legendary rider ────────────────────────────────────────────────

/**
 * Bounds on a legendary weapon's rider, in the same spirit as
 * `session/combat.ts`'s MIN_DC / MAX_DC: the ruleset allows a very wide range
 * of extra-damage magic weapons, and this game ships a narrow slice of it.
 * Mirrors MAX_RIDER_DICE / MAX_RIDER_SIDES in characters/equipmentTypes.ts;
 * they are restated here as defaults so this module stays free of any import
 * from characters/ and can still be called with nothing but a string.
 */
export const MAX_RIDER_DICE = 2;
export const MAX_RIDER_SIDES = 8;

/**
 * Whether a rider notation is one the engine will roll.
 *
 * Three conditions, and the third is the one that matters most: a rider is
 * extra DICE, so a flat modifier is refused outright. "1d6+3" would be three
 * points of damage no die ever produced, which is a number arriving without a
 * roll behind it, which is the thing this whole system exists to prevent.
 */
export function isLegalRiderNotation(notation: string, maxDice = MAX_RIDER_DICE, maxSides = MAX_RIDER_SIDES): boolean {
  let parsed: { count: number; sides: number; modifier: number };
  try {
    parsed = parseDiceNotation(notation);
  } catch {
    return false;
  }
  if (parsed.modifier !== 0) return false;
  return parsed.count >= 1 && parsed.count <= maxDice && parsed.sides >= 2 && parsed.sides <= maxSides;
}

/**
 * Roll a legendary weapon's extra damage, as its own roll.
 *
 * Separate from the weapon's own damage notation on purpose, and the reason is
 * mechanical rather than tidy: `resolveDamage` doubles the DICE on a critical
 * and adds the modifier once, and `parseDiceNotation` accepts exactly one
 * "NdS" term, so "1d8+1d6+4" is not even parseable. Rolling the rider through
 * its own `resolveDamage` call keeps both halves right.
 *
 * `critical` is threaded through rather than dropped because SRD 5.1 doubles
 * the damage dice OF THE ATTACK on a critical hit, and a magic weapon's extra
 * dice are damage dice of that attack. Dropping it would quietly make a
 * legendary weapon worse on the best roll in the game.
 */
export function resolveMagicWeaponRider(notation: string, rng: () => number = Math.random, critical = false): DiceResult {
  if (!isLegalRiderNotation(notation)) throw new Error(`not a legal magic weapon rider: "${notation}"`);
  return resolveDamage(notation, rng, critical);
}
