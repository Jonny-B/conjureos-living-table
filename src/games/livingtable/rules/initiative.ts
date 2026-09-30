/**
 * Initiative: who acts first, and in what order.
 */
import { rollDie } from "./dice";

export function rollInitiative(dexModifier: number, rng: () => number = Math.random): number {
  return rollDie(20, rng) + dexModifier;
}

export interface InitiativeEntry {
  id: string;
  roll: number;
}

/**
 * Sort descending by roll. `Array.prototype.sort` has been a stable sort
 * since ES2019, so two entries with an identical roll keep their original
 * relative order rather than being reshuffled on every re-sort of the same
 * encounter, which is the tiebreak this function commits to: same roll,
 * original order wins, not a re-roll or a DEX-modifier lookup the caller
 * hasn't necessarily supplied. We sort a copy so the caller's array is never
 * mutated out from under it.
 */
export function sortInitiative<T extends InitiativeEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.roll - a.roll);
}
