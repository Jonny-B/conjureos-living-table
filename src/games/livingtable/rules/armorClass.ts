/**
 * Armor Class, derived from actual inputs rather than invented per caller.
 *
 * Before this module, `targetAC` traveled through combat.ts, turnSchema.ts,
 * and rollReadoutAdapter.ts purely as an opaque number the DM's roll request
 * supplied; nothing in `rules/` computed an AC the way abilityModifier and
 * proficiencyBonus compute their numbers. computeAC is that missing
 * derivation, so a future caller building an AC has one table-accurate
 * function to call instead of re-deriving the DEX-cap rule inline.
 *
 * SRD 5.1 armor category rules:
 *  - unarmored: 10 + DEX modifier
 *  - light armor: armor's base AC + full DEX modifier
 *  - medium armor: armor's base AC + DEX modifier, capped at +2
 *  - heavy armor: armor's base AC, no DEX modifier at all
 * A shield and any other flat bonus (a class feature like the Fighter's
 * Defense fighting style, a magic item, etc.) stack on top of whichever of
 * the four applies.
 */

export type ArmorCategory = "unarmored" | "light" | "medium" | "heavy";

export interface BaseArmor {
  category: ArmorCategory;
  /**
   * The armor's own base AC rating: the SRD armor table's "Armor Class"
   * column for that piece (leather = 11, chain shirt = 13, chain mail = 16,
   * and so on). Ignored for "unarmored" -- SRD 5.1 always starts unarmored AC
   * at 10, so computeAC never reads `base` for that category and a caller
   * does not have to special-case it to 10 themselves.
   */
  base: number;
}

export interface ComputeACParams {
  baseArmor: BaseArmor;
  dexModifier: number;
  /** A shield's flat AC bonus (SRD 5.1: +2), 0 if none is worn. */
  shieldBonus?: number;
  /** Any other flat AC bonus not covered by armor or shield: a fighting style, a spell like Shield, a magic item. 0 if none applies. */
  otherBonus?: number;
}

/** Compute a real AC from armor category, DEX modifier, and flat bonuses, per the SRD 5.1 rules above. */
export function computeAC(params: ComputeACParams): number {
  const { baseArmor, dexModifier, shieldBonus = 0, otherBonus = 0 } = params;

  let armorAC: number;
  switch (baseArmor.category) {
    case "unarmored":
      armorAC = 10 + dexModifier;
      break;
    case "light":
      armorAC = baseArmor.base + dexModifier;
      break;
    case "medium":
      armorAC = baseArmor.base + Math.min(dexModifier, 2);
      break;
    case "heavy":
      armorAC = baseArmor.base;
      break;
    default: {
      // Exhaustiveness guard: TypeScript proves this branch unreachable for
      // any valid ArmorCategory, so if a fifth category is ever added without
      // updating the switch above, this throws at runtime instead of
      // silently falling through to `undefined + shieldBonus`.
      const exhaustive: never = baseArmor.category;
      throw new Error(`unknown armor category: ${exhaustive}`);
    }
  }

  return armorAC + shieldBonus + otherBonus;
}
