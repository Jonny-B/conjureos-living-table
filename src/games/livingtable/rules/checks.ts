/**
 * Saving throws and skill checks. Mechanically these are the exact same roll
 * (d20 + modifier, honoring advantage/disadvantage, compared to a DC); they
 * get two exported names because the caller's intent differs ("the goblin's
 * poison, save or take damage" reads differently from "can you spot the
 * trap"), and the DM turn protocol's `rollRequests` will want to say which
 * one it's asking for.
 */
import { rollD20 } from "./dice";

export interface CheckParams {
  modifier: number;
  dc: number;
  advantage?: boolean;
  disadvantage?: boolean;
  rng?: () => number;
}

export interface CheckResult {
  roll: number;
  total: number;
  success: boolean;
}

function resolveD20Check(params: CheckParams): CheckResult {
  const { modifier, dc, advantage = false, disadvantage = false, rng = Math.random } = params;
  const roll = rollD20(advantage, disadvantage, rng);
  const total = roll + modifier;
  // Unlike an attack roll, a natural 20/1 on a save or check is not an
  // automatic success/failure under SRD 5.1 (that rule is specific to
  // attacks vs. AC) - a boundary DC comparison is the whole story here.
  return { roll, total, success: total >= dc };
}

export const resolveSavingThrow = resolveD20Check;
export const resolveSkillCheck = resolveD20Check;
