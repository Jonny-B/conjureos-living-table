/**
 * The combat round on the PLAYER's side of the table.
 *
 * `rules/initiative.ts` and `rules/actionEconomy.ts` were both built, both
 * tested, and both had zero callers anywhere in `src/`: a fight had no turn
 * order, monsters never acted, and every Move click constructed a fresh
 * `resetTurnEconomy(30)` inline, so nineteen consecutive clicks spent 95 feet
 * against a 30-foot speed and no turn ever ended. Action economy was enforced
 * against the model (dm/turnSchema.ts's combat gate) and never against the
 * person actually clicking, which is backwards.
 *
 * This module is the missing state: one initiative order, one TurnEconomy per
 * combatant that persists between clicks, and an explicit end of turn. It is
 * pure -- it holds no world, rolls no attack, and makes no AI call. The play
 * screen owns the dice and the board; this owns whose turn it is and what they
 * have left. That split matters for the cost model: DESIGN.md prices combat at
 * nothing, forever, so a monster's turn has to resolve locally, and a fight
 * must never need a paid message to get a response out of the other side.
 */
import { resetTurnEconomy, spendAction, spendMovement, type ActionKind, type TurnEconomy } from "../rules/actionEconomy";
import { rollInitiative, sortInitiative } from "../rules/initiative";
import { DEFAULT_MELEE_REACH_TILES, tileDistance } from "../world/reach";

/**
 * Feet per tile, matching world/manipulation.ts's own FEET_PER_TILE and its
 * stated simplification (Chebyshev distance, a diagonal costs the same as an
 * orthogonal step). Named here as a constant rather than imported because that
 * one is module-private there; the value is SRD 5.1's own "5 ft. per square",
 * not a local invention, so the two cannot meaningfully disagree.
 */
export const FEET_PER_TILE = 5;

/** SRD 5.1 melee reach in feet, derived from world/reach.ts's tile figure so the player-facing sentence and the engine's own check can never name different distances. */
export const MELEE_REACH_FT = DEFAULT_MELEE_REACH_TILES * FEET_PER_TILE;

/** Distance between two tiles in feet, the same Chebyshev math world/reach.ts checks reach with and moveToken charges movement at. */
export function tileDistanceFeet(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return tileDistance(from, to) * FEET_PER_TILE;
}

/** Whether a melee attacker standing at `from` can reach a target at `to`. Before this check the Attack button had no distance filter at all, so a longsword reached nineteen squares. */
export function withinMeleeReach(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return tileDistance(from, to) <= DEFAULT_MELEE_REACH_TILES;
}

/**
 * PLACEHOLDER, same documented gap session/combat.ts already owns: monster
 * tokens carry no stat block, so there is no DEX modifier to roll initiative
 * with. +2 is a low-level SRD skirmisher's DEX modifier (a goblin's is +2),
 * standing in until real statblocks land.
 */
export const MONSTER_INITIATIVE_MODIFIER = 2;

export interface Combatant {
  /** The token id on the board. */
  id: string;
  /** Already through labels.ts's tokenLabel: never an id. */
  label: string;
  side: "player" | "hostile";
  initiative: number;
  /** Persistent across clicks, which is the whole point of this module. */
  economy: TurnEconomy;
  /** Feet of movement this combatant gets at the start of each of its turns. */
  speedFt: number;
}

export interface CombatRound {
  order: Combatant[];
  activeIndex: number;
  /** 1-based, shown to the player as "Round 3" so a fight reads as having a shape. */
  roundNumber: number;
}

export interface StartCombatInput {
  player: { id: string; label: string; dexModifier: number; speedFt: number };
  hostiles: readonly { id: string; label: string; speedFt: number }[];
  rng?: () => number;
}

/**
 * Roll initiative for the player and every hostile in the playspace and sort
 * them, exactly DESIGN.md's "initiative (d20+DEX, sorted)". Every combatant
 * starts with a full economy; the active one is simply whoever sorted first,
 * so nobody gets a free extra turn at the top of the fight.
 */
export function startCombat(input: StartCombatInput): CombatRound {
  const rng = input.rng ?? Math.random;
  const entries: Combatant[] = [
    {
      id: input.player.id,
      label: input.player.label,
      side: "player",
      initiative: rollInitiative(input.player.dexModifier, rng),
      economy: resetTurnEconomy(input.player.speedFt),
      speedFt: input.player.speedFt,
    },
    ...input.hostiles.map((h) => ({
      id: h.id,
      label: h.label,
      side: "hostile" as const,
      initiative: rollInitiative(MONSTER_INITIATIVE_MODIFIER, rng),
      economy: resetTurnEconomy(h.speedFt),
      speedFt: h.speedFt,
    })),
  ];
  // sortInitiative wants {id, roll}; sorting a projection and mapping back
  // keeps Combatant's own shape out of the rules engine's type, and keeps
  // that function's documented "same roll, original order wins" tiebreak.
  const ranked = sortInitiative(entries.map((c) => ({ id: c.id, roll: c.initiative })));
  const order = ranked.map((e) => entries.find((c) => c.id === e.id)!);
  return { order, activeIndex: 0, roundNumber: 1 };
}

export function activeCombatant(round: CombatRound): Combatant | undefined {
  return round.order[round.activeIndex];
}

/** True when it is the player's turn and they are still standing. Every player-side button in a fight gates on this. */
export function isPlayersTurn(round: CombatRound | null): boolean {
  if (!round) return false;
  return activeCombatant(round)?.side === "player";
}

/** Replace the active combatant's economy, returning a new round (state here is threaded functionally, same as everything under world/ and rules/). */
export function withActiveEconomy(round: CombatRound, economy: TurnEconomy): CombatRound {
  const order = [...round.order];
  const active = order[round.activeIndex];
  if (!active) return round;
  order[round.activeIndex] = { ...active, economy };
  return { ...round, order, activeIndex: round.activeIndex };
}

/**
 * Spend the active combatant's action (or bonus action / reaction). Returns
 * null instead of throwing when it is already spent: `spendAction` throws by
 * design so a rules bug surfaces at its call site, but "you already attacked
 * this turn" is an ordinary thing for a player to try, not a bug, so the UI
 * wants a value it can turn into a sentence.
 */
export function spendActiveAction(round: CombatRound, kind: ActionKind = "action"): CombatRound | null {
  const active = activeCombatant(round);
  if (!active) return null;
  return spendCombatantAction(round, active.id, kind);
}

/**
 * Spend a NAMED combatant's action, refusing when it is not their turn or
 * when they have already acted this round. Returns null with no state change
 * either way; the caller turns that into a sentence.
 *
 * This exists because the enforcement above bound only the LOCAL path. The
 * play screen's rollRequests loop never read or wrote the round at all, so a
 * DM turn could request a second attack by the player in a round they had
 * already acted in (the round pill still read "action spent" afterwards), and
 * could land a skeleton's swing while the pill read "Your turn, action ready".
 * dm/turnSchema.ts's own gate builds a fresh Map per DM turn, so it only ever
 * caught the same `by` twice inside ONE JSON reply, never a second action in
 * the same round. One economy per combatant per round, shared by both paths,
 * is the fix; `spendActiveAction` above is now this function with the active
 * combatant's id already filled in.
 */
export function spendCombatantAction(round: CombatRound, combatantId: string, kind: ActionKind = "action"): CombatRound | null {
  const active = activeCombatant(round);
  if (!active || active.id !== combatantId) return null;
  if (!active.economy[kind]) return null;
  return withActiveEconomy(round, spendAction(active.economy, kind));
}

/**
 * Why a DM-requested action by this combatant is being refused right now, in
 * words for the DM's next-turn context, or null when it is allowed. The
 * player-facing half of this is `attackBlockedReason` below; this is the same
 * two rules said to the model instead.
 */
export function dmActionBlockedReason(round: CombatRound | null, combatantId: string, label: string): string | null {
  if (!round) return null;
  const active = activeCombatant(round);
  if (!active) return null;
  if (active.id !== combatantId) return `it is not ${label}'s turn -- ${active.label} is acting in round ${round.roundNumber}`;
  if (!active.economy.action) return `${label} has already taken an action this round`;
  return null;
}

/** Spend feet from the active combatant's persistent movement budget. Null when the step does not fit in what is left this turn. */
export function spendActiveMovement(round: CombatRound, feet: number): CombatRound | null {
  const active = activeCombatant(round);
  if (!active) return null;
  if (feet > active.economy.movementRemaining) return null;
  return withActiveEconomy(round, spendMovement(active.economy, feet));
}

/**
 * Hand the turn to the next combatant in the order, refreshing THEIR economy
 * (and only theirs) the way a turn boundary actually works: your action comes
 * back at the start of your next turn, not when someone else's ends.
 */
export function endTurn(round: CombatRound): CombatRound {
  if (round.order.length === 0) return round;
  const nextIndex = (round.activeIndex + 1) % round.order.length;
  const wrapped = nextIndex === 0;
  const order = [...round.order];
  const next = order[nextIndex]!;
  order[nextIndex] = { ...next, economy: resetTurnEconomy(next.speedFt) };
  return { order, activeIndex: nextIndex, roundNumber: wrapped ? round.roundNumber + 1 : round.roundNumber };
}

/**
 * Take a combatant out of the order (it died, it fled, it was removed by a DM
 * action). Keeps whoever is currently acting acting: dropping someone earlier
 * in the order would otherwise silently hand the turn to a different
 * combatant mid-click.
 */
export function dropCombatant(round: CombatRound, id: string): CombatRound {
  const index = round.order.findIndex((c) => c.id === id);
  if (index === -1) return round;
  const order = round.order.filter((c) => c.id !== id);
  if (order.length === 0) return { order, activeIndex: 0, roundNumber: round.roundNumber };
  let activeIndex = round.activeIndex;
  if (index < activeIndex) activeIndex -= 1;
  if (activeIndex >= order.length) activeIndex = 0;
  return { ...round, order, activeIndex };
}

/** Whether anyone hostile is still in the order; the play screen ends the fight when this goes false. */
export function hasHostiles(round: CombatRound): boolean {
  return round.order.some((c) => c.side === "hostile");
}

/**
 * Why the Attack button for this target is unavailable right now, in words, or
 * null when it is available. Rendered on the disabled button itself rather
 * than left for the player to guess, since "the button is grey" and "the
 * button is broken" look identical from the outside.
 *
 * `reachTiles` is the equipped weapon's reach, and it is the reason this
 * function no longer calls `withinMeleeReach` unconditionally. It used to,
 * which meant a Trooper with a plasma rifle, an Infiltrator with a sidearm
 * and both wizard archetypes could only attack a target standing next to
 * them: making Archery's "+2 to attack rolls with ranged weapons" real
 * exposed that the bonus applied to a shot the command menu would not let the
 * player take. The caller passes what `session/combat.ts`'s `weaponFor` says
 * is in hand; omitting it keeps the old melee-only behaviour.
 *
 * `hasLineOfSight` is only meaningful once a shot can cross the room. Undefined
 * means "not known, so not checked", the same fail-open `world/reach.ts`'s
 * `checkAttackReach` takes when it has no position for one side, and the right
 * default for melee where a target one tile away has nothing in between.
 */
export function attackBlockedReason(args: {
  round: CombatRound | null;
  attackerAt: { x: number; y: number } | undefined;
  targetAt: { x: number; y: number };
  downed: boolean;
  reachTiles?: number;
  hasLineOfSight?: boolean;
}): string | null {
  if (args.downed) return "You are down. You cannot attack until you are back on your feet.";
  if (!args.attackerAt) return "You are not standing in this room yet.";
  if (args.round && !isPlayersTurn(args.round)) return "It is not your turn yet.";
  if (args.round && !activeCombatant(args.round)?.economy.action) return "You have already taken your action this turn. End your turn to get it back.";
  const reachTiles = args.reachTiles ?? DEFAULT_MELEE_REACH_TILES;
  if (tileDistance(args.attackerAt, args.targetAt) > reachTiles) {
    const feet = tileDistanceFeet(args.attackerAt, args.targetAt);
    return `Too far away: ${feet} feet, and your reach is ${reachTiles * FEET_PER_TILE} feet. Move closer first.`;
  }
  if (args.hasLineOfSight === false) return "You cannot see it from here. Something solid is in the way.";
  return null;
}
