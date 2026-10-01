/**
 * What a resolved stretch of a fight HAPPENED as, in order, as plain data.
 *
 * The turn engine already hands the screen what it needs to print a fight:
 * dice-log lines, story sentences and the last roll's readout. None of that is
 * something a screen can ANIMATE. A floating "-6" over a head needs the amount
 * as a number (it used to exist only inside a sentence), a walk needs the
 * tiles stepped (it used to exist only as the token's end square), and a
 * paced monster turn needs the order things happened in (it used to keep only
 * the LAST readout, so with two monsters only the second swing ever showed).
 *
 * So the engine now returns a `CombatEvent[]` beside the lines, story and
 * readout it always returned. Every event is something the rules engine
 * already decided; this module computes nothing. A screen that draws a number
 * the engine did not produce is a bug (CLAUDE.md rule 1), and the events are
 * how a screen avoids having to guess: it plays them back, it never derives
 * them.
 *
 * `attackEvents` is the one place that turns "this attack resolved" into
 * events, for a monster's swing and a player's swing alike, so the bench and
 * the game cannot drift into two sets of rules for what a hit looks like.
 */
import type { AttackResult } from "../rules/combat";
import type { RollReadout } from "../render/canvasRenderer";
import type { TileCoord } from "../world/coordinates";

/** One line of the dice log. `hit` colours it green, meaning "this went the player's way" (a monster MISSING is the good outcome, hence the inversion where a monster rolled). */
export interface DiceLogEntry {
  text: string;
  hit: boolean;
}

/**
 * What the on-canvas readout overlay shows. Extends render/canvasRenderer's
 * RollReadout with the two facts the engine already computed and never told
 * the player: a natural 20 and a natural 1. `resolveAttack` returns both, and
 * dm/promptBuilder.ts even reports them to the model, but the readout printed
 * only "HIT" or "MISS" -- a natural 20 that killed a goblin read exactly like
 * an ordinary hit.
 */
export interface ReadoutView extends RollReadout {
  critical?: boolean;
  fumble?: boolean;
  /** Already through tokenLabel: who rolled, and what for. */
  caption: string;
}

/**
 * One thing that happened, in the order it happened.
 *
 * - `turnStart`: a combatant's turn began (`round` is the 1-based round number).
 * - `move`: a token walked. `from` is the square it left and `path` the squares
 *   it entered, in order, EXCLUDING `from`, so a walk of three squares is three
 *   entries and an animation can step through them one at a time.
 * - `attack`: `by` swung at `against`. `result` is the engine's own d20 outcome
 *   and `readout` is the same roll as the dice plate wants it.
 * - `damage`: `tokenId` was hit for `amount`, the damage ROLLED, which is the
 *   number the log sentence prints. `hpLost` is the hit points that actually
 *   came off the target, and it is the one to float over a head as "-N": it is
 *   0 for a hit on a creature already at 0 (that is a failed death save, not a
 *   loss of hit points, so `amount` there is a number that did not happen) and
 *   less than `amount` for a blow that overkills. `critical` is true when the
 *   blow was a natural 20.
 * - `heal`: `tokenId` recovered `amount`. Nothing in the engine's own monster
 *   turn heals; the player's potion and Cure Wounds paths build this one.
 * - `miss`: a swing at `tokenId` did not land.
 * - `down`: `tokenId` dropped to 0 hit points (a monster leaves the board, the
 *   hero falls and starts death saves).
 */
export type CombatEvent =
  | { kind: "turnStart"; combatantId: string; round: number }
  | { kind: "move"; tokenId: string; from: TileCoord; path: TileCoord[] }
  | { kind: "attack"; by: string; against: string; result: AttackResult; readout: ReadoutView }
  | { kind: "damage"; tokenId: string; amount: number; hpLost: number; critical: boolean }
  | { kind: "heal"; tokenId: string; amount: number }
  | { kind: "miss"; tokenId: string }
  | { kind: "down"; tokenId: string };

/**
 * The events for one resolved attack, whoever swung: the `attack` itself, then
 * `damage` when it hit for something or `miss` when it did not, then `down` when
 * the blow took the target to 0.
 *
 * `damage` is the amount the engine rolled (omit it for a miss). A hit that
 * rolled 0 emits no `damage` event, because a floating "-0" is noise and the
 * `attack` event already says it landed. `hpLost` is the hit points that
 * actually came off the target: the caller knows it (the sheet before and after
 * `applyDamage`, or what `damageMonster` took off) and this computes nothing.
 * It is 0 for a hit on a creature already at 0, and it is what a screen floats.
 * Left out, it is taken to be the whole of `damage`, which is right for a target
 * that was standing with hit points to spare; a caller whose target can be at 0,
 * or can take more than it has, should pass it. `down` is the caller's call (it
 * knows whether `damageMonster` or `applyDamage` reported the drop); this only
 * orders it after the damage that caused it.
 */
export function attackEvents(args: {
  by: string;
  against: string;
  result: AttackResult;
  readout: ReadoutView;
  damage?: number;
  hpLost?: number;
  down?: boolean;
}): CombatEvent[] {
  const events: CombatEvent[] = [{ kind: "attack", by: args.by, against: args.against, result: args.result, readout: args.readout }];
  if (!args.result.hit) {
    events.push({ kind: "miss", tokenId: args.against });
  } else if (args.damage !== undefined && args.damage > 0) {
    events.push({
      kind: "damage",
      tokenId: args.against,
      amount: args.damage,
      hpLost: args.hpLost ?? args.damage,
      critical: args.result.critical,
    });
  }
  if (args.down) events.push({ kind: "down", tokenId: args.against });
  return events;
}
