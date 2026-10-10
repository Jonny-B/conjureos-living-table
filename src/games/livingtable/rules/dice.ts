/**
 * Dice, and only dice: parsing standard notation ("1d8+3") and rolling it.
 *
 * Every function here takes an injectable `rng` defaulting to `Math.random`
 * so the rest of the rules engine (and its tests) never has to reach for a
 * real random number generator to get a deterministic result. This is the
 * one module every other file in `rules/` depends on, directly or through
 * `resolveAttack` / `resolveSavingThrow`, so a bug here would be load-bearing
 * everywhere else.
 */

export interface DiceResult {
  total: number;
  rolls: number[];
  notation: string;
}

const DICE_PATTERN = /^(\d+)d(\d+)([+-]\d+)?$/i;

/**
 * Parse "NdS" or "NdS+M" / "NdS-M" into its parts. Kept separate from
 * `rollDice` because `resolveDamage` needs the parsed count/sides on a
 * critical hit (to double the dice without touching the modifier) rather
 * than a rolled total.
 */
export function parseDiceNotation(notation: string): { count: number; sides: number; modifier: number } {
  const cleaned = notation.replace(/\s+/g, "");
  const match = DICE_PATTERN.exec(cleaned);
  if (!match) throw new Error(`not valid dice notation: "${notation}"`);

  const countStr = match[1];
  const sidesStr = match[2];
  // The regex's first two groups are mandatory digit runs, so this branch is
  // unreachable in practice, but the indexed-access type is string | undefined
  // regardless of what the regex guarantees, so we check rather than assert.
  if (!countStr || !sidesStr) throw new Error(`not valid dice notation: "${notation}"`);

  const count = Number(countStr);
  const sides = Number(sidesStr);
  const modifier = match[3] ? Number(match[3]) : 0;

  if (count < 1) throw new Error(`dice count must be at least 1: "${notation}"`);
  if (sides < 2) throw new Error(`a die needs at least 2 sides: "${notation}"`);

  return { count, sides, modifier };
}

/** Roll one die of the given number of sides. The building block everything else composes. */
export function rollDie(sides: number, rng: () => number = Math.random): number {
  return Math.floor(rng() * sides) + 1;
}

/**
 * A flat amount written as a bare whole number ("1"), the way an SRD statblock
 * writes damage with no dice in it (the Rat's bite: "Hit: 1 piercing damage").
 * Null for anything else. parseDiceNotation stays strict, so dice validators
 * still refuse a bare number where dice are required; only rolling accepts it.
 */
export function flatAmount(notation: string): number | null {
  const cleaned = notation.replace(/\s+/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

export function rollDice(notation: string, rng: () => number = Math.random): DiceResult {
  const flat = flatAmount(notation);
  if (flat !== null) return { total: flat, rolls: [], notation };
  const { count, sides, modifier } = parseDiceNotation(notation);
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides, rng));
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { total, rolls, notation };
}

/**
 * Roll a d20 honoring advantage/disadvantage. Per SRD, when both apply to the
 * same roll they cancel rather than stack, so `advantage === disadvantage`
 * (both true or both false) is exactly the "roll once, plain" case; only a
 * pure advantage or pure disadvantage roll spends the second die.
 */
export function rollD20(advantage: boolean, disadvantage: boolean, rng: () => number = Math.random): number {
  if (advantage === disadvantage) return rollDie(20, rng);
  const a = rollDie(20, rng);
  const b = rollDie(20, rng);
  return advantage ? Math.max(a, b) : Math.min(a, b);
}
