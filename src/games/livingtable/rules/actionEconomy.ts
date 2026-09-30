/**
 * Turn economy: action, bonus action, reaction, and movement, the fourth
 * pillar DESIGN.md's "The rules engine: real D&D, SRD 5.1" lists as in-scope
 * ("action economy (action / bonus action / movement / reaction)") alongside
 * ability checks, attacks, saves, and initiative. Before this module, action
 * economy existed only as flavor text inside condition descriptions
 * (conditions.ts's "your speed drops to 0"); nothing in `rules/` or `world/`
 * actually tracked whether a combatant had already spent their action this
 * turn.
 *
 * Every value here is a plain, immutable snapshot, matching the rest of
 * `rules/` (castSpell, applyLevelUp): spendAction and spendMovement both
 * return a NEW TurnEconomy rather than mutating the one they're given, so a
 * caller can't accidentally leak one combatant's spent action onto another's
 * turn by aliasing the same object.
 *
 * Movement is tracked in feet, matching SRD 5.1's speed stat directly (a
 * Fighter's base speed is written as "30 ft.", not "6 squares"). A caller
 * working in grid squares should convert at its own boundary; the SRD
 * default is 5 ft. per square.
 */

export type ActionKind = "action" | "bonusAction" | "reaction";

export interface TurnEconomy {
  action: boolean;
  bonusAction: boolean;
  reaction: boolean;
  /** Feet of movement left this turn. Never negative; see spendMovement. */
  movementRemaining: number;
}

/**
 * A fresh TurnEconomy at the start of a turn: every resource available,
 * movement reset to the combatant's full speed (in feet).
 */
export function resetTurnEconomy(speed: number): TurnEconomy {
  if (!Number.isFinite(speed) || speed < 0) {
    throw new Error(`speed must be a non-negative number of feet, got ${speed}`);
  }
  return { action: true, bonusAction: true, reaction: true, movementRemaining: speed };
}

/**
 * Spend the named resource (action, bonus action, or reaction). Returns a
 * NEW TurnEconomy with that resource marked spent.
 *
 * Throws if the resource is already spent this turn. This function exists
 * specifically to make a double-spend impossible, so it never silently
 * no-ops or hands back an unchanged economy: a caller that tries to spend an
 * already-spent action gets a thrown error at the exact call site, not a
 * rules bug that surfaces three turns later as "how did the goblin attack
 * twice."
 */
export function spendAction(economy: TurnEconomy, kind: ActionKind): TurnEconomy {
  if (!economy[kind]) {
    throw new Error(`${kind} has already been spent this turn`);
  }
  return { ...economy, [kind]: false };
}

/**
 * Spend feet of movement. Returns a NEW TurnEconomy with movementRemaining
 * reduced by `amount`.
 *
 * Throws rather than clamping to 0 if that would take movement negative.
 * Clamping would silently let a caller move further than they had left and
 * never find out; that is the same silent-overspend failure mode
 * spendAction guards against for actions, so movement gets the same
 * treatment.
 */
export function spendMovement(economy: TurnEconomy, amount: number): TurnEconomy {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`movement amount must be a non-negative number of feet, got ${amount}`);
  }
  const movementRemaining = economy.movementRemaining - amount;
  if (movementRemaining < 0) {
    throw new Error(
      `not enough movement left: ${economy.movementRemaining} ft. remaining, tried to spend ${amount} ft.`,
    );
  }
  return { ...economy, movementRemaining };
}
