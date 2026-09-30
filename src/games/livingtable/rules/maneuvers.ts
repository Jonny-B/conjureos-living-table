/**
 * Battle Master maneuvers and the superiority dice that pay for them.
 *
 * The gap this closes: Battle Master was the second half of the only level-up
 * branch in the whole 1-to-3 progression, and it was prose. `leveling.ts`
 * offered "a pool of superiority dice and a set of combat maneuvers (trip,
 * disarm, extra damage), spent and recovered on a rest" and nothing anywhere
 * held a pool, spent a die, or rolled a maneuver. Two blind playtesters, told
 * nothing about the game beyond the on-screen text, both picked it over the
 * Champion for exactly the reason the copy promised ("a toolbox of combat
 * tricks told me I'd get new buttons in combat"), and both then noticed there
 * was no button. Champion's widened crit range was already real (see
 * rules/combat.ts's `criticalOn`); this is the other half.
 *
 * Same division of labour as every other file in `rules/`: numbers in,
 * outcome out. This module knows nothing about character sheets, tokens or
 * the board -- `session/combat.ts` reads a sheet and hands these functions
 * the numbers, exactly as it already does for `criticalOnFor`.
 *
 * SRD 5.1 (CC-BY-4.0) throughout: four d8 superiority dice at Fighter 3, a
 * maneuver save DC of 8 + proficiency bonus + STR or DEX modifier, and the
 * two maneuvers below quoted mechanically rather than verbatim.
 */
import { rollDie } from "./dice";
import { resolveSavingThrow, type CheckResult } from "./checks";
import type { Condition } from "./conditions";
import type { AbilityScores } from "./abilities";

/** SRD 5.1: superiority dice are d8s at Fighter level 3 (they grow to d10 at 10th and d12 at 18th, both far outside this launch's 1-to-3 range). */
export const SUPERIORITY_DIE_SIDES = 8;

/** SRD 5.1: "You have four superiority dice" on taking the Battle Master archetype. The pool grows at 7th level, past this launch's scope. */
export const SUPERIORITY_DICE_POOL = 4;

export type ManeuverId = "trip" | "disarm";

export interface Maneuver {
  id: ManeuverId;
  label: string;
  /** The real rule, for the character sheet, in the same technical/plain pairing every other choice in this game uses. */
  technical: string;
  plain: string;
  /** Which ability the TARGET saves with. Both launch maneuvers are Strength saves per SRD 5.1. */
  saveAbility: keyof AbilityScores;
  /** The SRD condition a failed save applies, or null when the maneuver's effect isn't a condition (disarming moves an object, it doesn't condition a creature). */
  condition: Condition | null;
}

/**
 * The two maneuvers this launch ships, both chosen because their effect is
 * something the engine can actually APPLY rather than narrate: trip produces
 * an SRD condition the condition set already models, and disarm produces a
 * stated fact about the target's hands. The SRD's damage-only maneuvers
 * (Menacing Attack's fear, Precision Attack's to-hit) are additive content
 * for later, not architecture -- the same cut DESIGN.md already makes for
 * spells and statblocks.
 */
export const MANEUVERS: readonly Maneuver[] = [
  {
    id: "trip",
    label: "Trip Attack",
    technical:
      "On a hit, spend one superiority die: add it to the damage, and the target makes a Strength save against your maneuver DC or is knocked prone.",
    plain: "Put them on the floor. They hit harder for it, and getting up costs them.",
    saveAbility: "str",
    condition: "prone",
  },
  {
    id: "disarm",
    label: "Disarming Attack",
    technical:
      "On a hit, spend one superiority die: add it to the damage, and the target makes a Strength save against your maneuver DC or drops what it is holding.",
    plain: "Knock the weapon out of their hands. Whatever they were about to do with it, they are not doing it now.",
    saveAbility: "str",
    condition: null,
  },
];

export function getManeuver(id: ManeuverId): Maneuver {
  const found = MANEUVERS.find((m) => m.id === id);
  if (!found) throw new Error(`unknown maneuver id "${id}"`);
  return found;
}

/**
 * SRD 5.1's maneuver save DC: "8 + your proficiency bonus + your Strength or
 * Dexterity modifier (your choice)". The choice is resolved by taking the
 * better of the two, which is what any player would pick and what removes a
 * decision nobody would ever make differently.
 */
export function maneuverSaveDC(proficiencyBonus: number, strModifier: number, dexModifier: number): number {
  return 8 + proficiencyBonus + Math.max(strModifier, dexModifier);
}

export interface ManeuverParams {
  maneuver: ManeuverId;
  /** The target's own saving-throw modifier for this maneuver's ability, looked up by the caller off the target's statblock -- never supplied by the model, same rule as every other modifier in this engine. */
  targetSaveModifier: number;
  saveDC: number;
  rng?: () => number;
}

export interface ManeuverResult {
  maneuver: ManeuverId;
  /** The superiority die's face. SRD 5.1 adds it to the attack's damage "whether or not the save succeeds", so this is never conditional on `landed`. */
  bonusDamage: number;
  saveDC: number;
  save: CheckResult;
  /** True when the target FAILED the save and the maneuver's effect applies. */
  landed: boolean;
  /** The condition to apply on a landed trip, or null (a landed disarm applies none; a failed maneuver applies none either way). */
  condition: Condition | null;
  /** One line for the dice log, in the same plain register `attackLine` writes. */
  note: string;
}

/**
 * Resolve one maneuver. The caller has already resolved the attack and
 * confirmed it hit (SRD: every maneuver here triggers "when you hit a
 * creature with a weapon attack") and has already spent the die from the
 * pool; this rolls the die's damage and the target's save.
 *
 * Deliberately does NOT roll the attack itself or apply the damage. Keeping
 * those in the caller means a maneuver is strictly an add-on to the existing
 * attack path rather than a second, parallel way to resolve an attack -- and
 * a second path is exactly how an on-screen readout and the engine end up
 * disagreeing about whether a swing landed.
 */
export function resolveManeuver(params: ManeuverParams): ManeuverResult {
  const { maneuver: id, targetSaveModifier, saveDC, rng = Math.random } = params;
  const maneuver = getManeuver(id);

  const bonusDamage = rollDie(SUPERIORITY_DIE_SIDES, rng);
  const save = resolveSavingThrow({ modifier: targetSaveModifier, dc: saveDC, rng });
  const landed = !save.success;

  const outcome = landed
    ? id === "trip"
      ? "goes down hard."
      : "loses its grip and the weapon hits the floor."
    : "stays on its feet.";
  const note =
    `${maneuver.label}: +${bonusDamage} damage, and a Strength save against DC ${saveDC} ` +
    `(rolled ${save.roll}${targetSaveModifier >= 0 ? "+" : ""}${targetSaveModifier} = ${save.total}). It ${outcome}`;

  return {
    maneuver: id,
    bonusDamage,
    saveDC,
    save,
    landed,
    condition: landed ? maneuver.condition : null,
    note,
  };
}
