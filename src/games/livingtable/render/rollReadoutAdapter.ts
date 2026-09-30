/**
 * The only functions that are allowed to build a RollReadout
 * (canvasRenderer.ts's "show the dice" overlay) from real engine output, plus
 * (contract v2) the one function that builds its loot-popup sibling,
 * LootReadout, from a real LootRoll.
 *
 * Neither rules/combat.ts's AttackResult nor rules/checks.ts's CheckResult
 * matches RollReadout's shape on its own: both are missing `modifier` and
 * `target` (the engine resolves a roll against a bonus/DC that isn't carried
 * on the result itself, so the caller has to supply it back), and CheckResult
 * calls its outcome `success`, not `hit`. Renaming `success` to `hit` at the
 * call site would quietly blur two different ideas: an attack "hits" a
 * target, but a saving throw or skill check "succeeds" or "fails" against a
 * DC, there's no target being struck. RollReadout only has a `hit` field
 * because it was written with attacks in mind; `checkResultToReadout` maps
 * `success` onto it deliberately, not by accident, and this comment is the
 * record of that choice for anyone tempted to add a `success` field to
 * RollReadout instead and fork the overlay.
 */
import type { AttackResult } from "../rules/combat";
import type { CheckResult } from "../rules/checks";
import { TIER_WORD, type BonusSource, type LootReadout, type LootRoll } from "../characters/equipmentTypes";
import type { RollReadout } from "./canvasRenderer";

/**
 * Turn a resolved attack roll into the HUD's RollReadout. `attackerBonus` and
 * `targetAC` are the inputs the engine rolled against; AttackResult itself
 * doesn't carry them back, so the caller (who already has the AttackParams)
 * supplies them here.
 *
 * `sources` breaks `attackerBonus` down into the parts a player can recognise
 * ("+3 Dexterity and training, +2 Keen Longsword") so a magic sword is visible
 * in the readout rather than folded into an unexplained lump. It is optional
 * and copied through untouched: this adapter does not compute, check or
 * reorder it, because the caller is the only thing that knows which addends the
 * engine actually summed. Omitting it prints the line exactly as before.
 */
export function attackResultToReadout(
  result: AttackResult,
  attackerBonus: number,
  targetAC: number,
  sources?: readonly BonusSource[],
): RollReadout {
  return {
    roll: result.roll,
    modifier: attackerBonus,
    total: result.total,
    target: targetAC,
    hit: result.hit,
    ...(sources ? { sources } : {}),
  };
}

/**
 * Turn a resolved saving throw / skill check into the HUD's RollReadout.
 * Maps CheckResult's `success` onto RollReadout's `hit`: for a check there's
 * no target being struck, only a DC being met or missed, but the overlay
 * only knows how to draw "HIT" / "MISS" against a target number, and a
 * check's pass/fail against its DC is the same shape of fact. `modifier`
 * and `dc` are the inputs the engine rolled against; CheckResult doesn't
 * carry them back, so the caller (who already has the CheckParams) supplies
 * them here. `sources` is the same optional breakdown of `modifier` that
 * `attackResultToReadout` takes, for the same reason: a Cloak of Protection
 * that quietly moves a saving throw is worth naming on the line that shows the
 * save.
 */
export function checkResultToReadout(
  result: CheckResult,
  modifier: number,
  dc: number,
  sources?: readonly BonusSource[],
): RollReadout {
  return {
    roll: result.roll,
    modifier,
    total: result.total,
    target: dc,
    hit: result.success,
    ...(sources ? { sources } : {}),
  };
}

/**
 * THE ONLY FUNCTION THAT BUILDS A LootReadout (contract v2, "the loot popup,
 * beside RollReadout in the same DOM overlay") from a real `LootRoll`. Same
 * shape of adapter as the two above: `LootRoll` is engine output (pure data:
 * a d100 face, an optional tier, an optional second die, the item it landed
 * on if any) and doesn't carry the player-facing WORDS a readout prints, so
 * the caller -- who already resolved `itemName` via `gearItemName`, THE one
 * namer -- supplies them back.
 *
 * `verdict` follows the three shapes the pinned loot words distinguish
 * (characters/equipmentTypes.ts, LOOT: THE WORDS):
 *   - the d100 landed in the nothing band (`roll.tier === null`): "Nothing of value".
 *   - a tier hit but every piece of it was already owned (`roll.item === null`,
 *     tier not null): "Nothing new".
 *   - a real find (`roll.item !== null`): the item's own name, exactly as the
 *     caller named it. `itemName` is expected non-null whenever `roll.item`
 *     is set (the caller looked it up from the very same slot/tier), so the
 *     "Nothing new" fallback below is defensive, not a real third path.
 */
export function lootRollToReadout(roll: LootRoll, itemName: string | null, caption: string): LootReadout {
  const tierWord = roll.tier === null ? "Nothing" : TIER_WORD[roll.tier];
  const verdict = roll.tier === null ? "Nothing of value" : roll.item === null ? "Nothing new" : itemName ?? "Nothing new";
  return {
    kind: "loot",
    caption,
    tierRoll: roll.tierRoll,
    tierWord,
    slotDie: roll.slotDie,
    slotRoll: roll.slotRoll,
    verdict,
  };
}
