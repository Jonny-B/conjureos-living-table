/**
 * Attack rolls and damage rolls: the two mechanical outcomes the DM turn
 * protocol is not allowed to originate itself (see DESIGN.md, "the DM turn
 * protocol"). The model can request a roll; only this module resolves one.
 */
import { rollD20, rollDie, rollDice, parseDiceNotation, type DiceResult } from "./dice";

export interface AttackParams {
  attackerBonus: number;
  targetAC: number;
  advantage?: boolean;
  disadvantage?: boolean;
  /**
   * The lowest natural d20 that counts as a critical hit. SRD 5.1's default
   * is 20, which is why this defaults to 20 and every existing caller is
   * unaffected. It exists because the Champion's Improved Critical ("your
   * weapon attacks score a critical hit on a roll of 19 or 20") is a real
   * SRD level-3 branch, and a level-up choice that cannot change a number is
   * not a choice. Threaded as a parameter rather than re-implemented at the
   * call site on purpose: a crit rule computed outside this module would let
   * the on-screen readout and the engine disagree, which is the exact failure
   * DESIGN.md forbids.
   */
  criticalOn?: number;
  rng?: () => number;
}

/** SRD 5.1's default critical range: a natural 20 and nothing else. */
export const DEFAULT_CRITICAL_ON = 20;

export interface AttackResult {
  roll: number; // the d20 result that decided it, after advantage/disadvantage
  total: number;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
}

export function resolveAttack(params: AttackParams): AttackResult {
  const { attackerBonus, targetAC, advantage = false, disadvantage = false, criticalOn = DEFAULT_CRITICAL_ON, rng = Math.random } = params;
  const roll = rollD20(advantage, disadvantage, rng);
  const critical = roll >= criticalOn;
  const fumble = roll === 1;
  // A critical always hits (and crits); natural 1 always misses. Both are
  // checked before the normal "roll + bonus >= AC" comparison, per SRD 5.1,
  // so no bonus is large enough to save a nat 1 and no AC is high enough to
  // deny a critical.
  const hit = critical || (!fumble && roll + attackerBonus >= targetAC);
  return { roll, total: roll + attackerBonus, hit, critical, fumble };
}

export function resolveDamage(notation: string, rng: () => number = Math.random, critical = false): DiceResult {
  if (!critical) return rollDice(notation, rng);

  // SRD 5.1: a critical hit doubles the DAMAGE DICE, not the flat modifier -
  // roll twice as many dice and add the modifier once. Re-parsing rather than
  // calling rollDice twice keeps the modifier from being added twice too.
  const { count, sides, modifier } = parseDiceNotation(notation);
  const rolls: number[] = [];
  for (let i = 0; i < count * 2; i++) rolls.push(rollDie(sides, rng));
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { total, rolls, notation };
}
