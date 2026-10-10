/**
 * When a turn ends by itself.
 *
 * A turn is over when the hero has nothing left to do with it: the action is spent, no bonus action could still be used,
 * and less than one step of movement is left. The window then ends it after a short beat, so nobody has to hunt for the
 * End turn button. While the action is still ready the turn is never ended for the player (free text, a spell, an
 * attack are always possible). The Settings tab can turn the whole thing off; it is on until a player says otherwise.
 *
 * Pure: data in, answer out. Import-pure.
 */
import { FEET_PER_TILE, activeCombatant, isPlayersTurn } from "../menu/combatRound";
import type { PlayState } from "./state";

/** What the rule reads of a scene. */
export type TurnScene = Pick<PlayState, "round" | "hero" | "heroHidden">;

/**
 * Whether the hero's turn has nothing left in it. True only on the hero's own turn, standing (not down), with the
 * action used, no usable bonus action (a rogue of level 2 or more who is not hidden can still Hide as a bonus action)
 * and under one step of movement.
 */
export function noMoveLeft(p: TurnScene): boolean {
  const round = p.round;
  if (!round || !isPlayersTurn(round)) return false;
  const h = p.hero;
  if (h.downed || h.stable || h.dead) return false;
  const economy = activeCombatant(round)?.economy;
  if (!economy) return false;
  if (economy.action) return false;
  if (economy.bonusAction && h.chassis === "rogue" && h.level >= 2 && !p.heroHidden) return false;
  return economy.movementRemaining < FEET_PER_TILE;
}

/** The Settings switch: on unless it was turned off (a saved setting from before there was one reads as on). */
export function autoEndTurnOn(settings: object): boolean {
  return (settings as { autoEndTurn?: boolean }).autoEndTurn !== false;
}
