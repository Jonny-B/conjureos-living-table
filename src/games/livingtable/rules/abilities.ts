/**
 * Ability scores, their modifiers, and proficiency bonus by level.
 *
 * These two derivations are the base every other roll in `rules/` builds on
 * (attack bonus, save DC, skill modifier), so they're kept tiny, pure, and
 * table-accurate rather than re-derived inline anywhere else.
 */

export interface AbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

/** SRD 5.1: modifier = floor((score - 10) / 2). Math.floor, not integer division, so an odd score below 10 (e.g. 9 -> -1, not 0) rounds the right way. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** SRD 5.1 proficiency-bonus-by-level table, the same progression for every class. */
export function proficiencyBonus(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new Error(`level must be a whole number of at least 1, got ${level}`);
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6; // 17-20
}
