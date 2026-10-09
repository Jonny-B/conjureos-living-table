/**
 * The DM turn protocol's wire shape (DESIGN.md, "The DM turn protocol") and
 * the validator that gives it teeth.
 *
 * `this app's ai.complete bridge has no tool-calling` (DESIGN.md, "The rule
 * that shapes everything else"), so a DM turn is not a sequence of tool
 * invocations the model drives -- it is ONE `completeJson` call whose reply
 * must already be a single JSON object matching `DmTurn` below, exactly the
 * way `coldcase/generate.ts` treats a generated case. `validateDmTurn` is
 * that gate. It checks SHAPE only (right fields, right types, known action
 * and roll kinds) -- it deliberately does not re-check board semantics
 * (does this asset id exist, is this tile walkable), because that check
 * needs the live `AssetManifest` and `World`, which only exist once a
 * campaign is loaded, not at JSON-validation time. That deeper check is
 * `world/manipulation.ts`'s job, and it already drops-and-reports a
 * structurally-valid-but-semantically-wrong action rather than applying it
 * (DESIGN.md, "The manipulation API"). Two gates, two different kinds of
 * "wrong." `validateDmTurn` also carries one narrow exception to "shape
 * only": a `moveToken`/`removeToken` whose `reason` is "combat" must cite a
 * `resolvedRollId` that (a) names a roll this turn's context actually
 * contains, (b) actually decided the outcome being enacted -- a missed
 * attack, a saved-against save, or a failed check decides nothing, and (c)
 * concerns the token the action is acting on, per that roll's own `by`/
 * `against` -- and each resolved roll may be cited once per turn, not reused
 * to justify several removals (see `requireResolvedRollForCombat` below).
 * That's still not board semantics -- it needs no `World`, no
 * `AssetManifest` -- it's turn PROVENANCE, closing the gap where a model
 * could enact a combat outcome by skipping the dice (never asking for a
 * roll at all, citing a roll that didn't decide it, or citing someone
 * else's roll) rather than by overriding a rolled one. `reason` is itself a
 * field the model self-reports, so `requireResolvedRollForCombat` also
 * distrusts a "staging" label when this turn's resolved-rolls context
 * already contains a decisive, unspent roll that positively concerns the
 * token being moved or removed -- a mislabeled combat outcome the model
 * actually asked the engine to roll on. What this file cannot and does not
 * try to catch is the narrower, degenerate case: a "staging" label on a
 * moveToken/removeToken for which NO roll was ever requested at all, so
 * there is no fact in this turn's context to check the label against. That
 * residual gap is acknowledged, not silently open -- see the "reason is
 * prose-adjacent, not schema-verifiable" test in
 * test/livingtable-dm.test.ts -- and sits in the same category this file
 * already accepts for free-text narration: closing it needs either a
 * hostility/HP model this shape-only validator deliberately has no access
 * to, or narration-content analysis, which this file already treats as
 * unreliable for the exact same reason.
 * The second narrow exception: an "attack" `rollRequests` entry spends that
 * combatant's action for the round (see `requireActionEconomyForAttack`
 * below), so a second "attack" naming the same `by` id in the same turn is
 * rejected as a double-spend rather than let through as two independent
 * requests. That's DESIGN.md's action economy ("action / bonus action /
 * movement / reaction," part of "the rules engine ... enforced
 * structurally") getting its first real caller outside `rules/actionEconomy.ts`'s
 * own tests.
 *

 * The third narrow exception: an "attack" roll request has to have been
 * geometrically possible -- close enough for its declared range, and not
 * through a wall (see `requireReachForAttack`). Like the other two it needs
 * no `World` and no `AssetManifest`, only the plain positions the caller
 * already holds, and it does not run at all when the caller supplies none.
 * The fourth sits directly on top of the third and is the reason the third
 * was not enough on its own: the attacker has to EXIST (see
 * `requireAttackerOnBoard`). `checkAttackReach` fails open on a token it has
 * no position for, correctly for a pure geometry helper, and that fail-open
 * let twenty attacks from twenty invented ids reach the player's real sheet
 * in one turn without a single rejection. Paired with it is a flat cap on how
 * many rolls one turn may ask for at all (`MAX_ROLL_REQUESTS`), which is the
 * bound that still holds when there is no geometry to check anything against.
 * The fifth is the only one that reads the narration text, and it is
 * deliberately the narrowest of the lot: a turn may not tell the player what
 * they know while a roll it is only NOW requesting is still pending (see
 * `requireUnansweredRolls`). That is not the narration-content analysis this
 * header rejects below -- it infers nothing, it matches a fixed list of
 * second-person knowledge claims against a fact the model's own reply
 * supplied, namely that the deciding roll has not happened yet.
 *
 * One more thing this file does that its name doesn't imply: `validateDmTurn`
 * ACCUMULATES its rejections rather than throwing on the first one, matching
 * `world/connectivity.ts`'s `validateLayout`. `completeJson` grants exactly
 * one repair attempt, so reporting one problem out of six sends a model that
 * fixes it straight into the next rejection with no retry left -- and the
 * player has already paid for that turn.
 *
 * Every thrown message here is deliberately actionable, not just descriptive
 * -- `completeJson` feeds a validation failure back to the model verbatim as
 * "that response was not usable: <message>" and asks for one corrected
 * reply, so a message like `coldcase/generate.ts` writes ("culprit ... is
 * not one of the five suspects") has to tell the model what to change, not
 * just that something broke.
 */
import { asArray, asRecord, asString } from "../../../bridge/ai";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import type { Edge, TileCoord } from "../world/coordinates";
import type { CellLayout, Exit, PlacedProp, PlacedToken, TileId } from "../world/cell";
import { MAX_DC, MIN_DC } from "../world/connectivity";
import { checkAttackReach, type AttackRange, type CombatGeometry } from "../world/reach";
import type { AbilityScores } from "../rules/abilities";
import type { AttackResult } from "../rules/combat";
import type { CheckResult } from "../rules/checks";
import { resetTurnEconomy, spendAction, type TurnEconomy } from "../rules/actionEconomy";
import { EQUIPMENT_FORBIDDEN_WIRE_KEYS, GEAR_ASSET_ID_PREFIX, isMagicGearName, MAGIC_GEAR_NAMES } from "../characters/equipmentTypes";
import { parseDiceNotation } from "../rules/dice";
import { ATTITUDES, type StoryUpdate } from "../campaign/types";

// ── world actions ──────────────────────────────────────────────────────
//
// One variant per exported function in world/manipulation.ts, and each
// variant's fields are exactly that function's parameters minus `world` and
// `manifest` -- those two are runtime context the caller supplies, never
// something the model can know or should be trusted to invent. This is what
// "mirror the manipulation.ts signatures" buys: applying an action, once
// validated, is a direct `manipulation[action.type](world, action.cx,
// action.cy, ...rest, manifest)` call, no translation layer in between for a
// mismatch to hide in.

export interface AssembleCellAction {
  type: "assembleCell";
  cx: number;
  cy: number;
  layout: CellLayout;
}

export interface PlaceTokenAction {
  type: "placeToken";
  cx: number;
  cy: number;
  token: PlacedToken;
}

/**
 * Why a token is moving or being removed -- the gate this buys is below,
 * next to `validateWorldAction`'s "combat" case. "combat" means the move or
 * removal itself IS the outcome of a fight (a killing blow, a knockout, a
 * forced retreat) and must cite the roll that decided it. "staging" is
 * everything else the DM does with a token's position -- an NPC stepping
 * aside, someone walking toward a door, a companion following along -- and
 * needs no roll at all. The field is required, not defaulted, on purpose:
 * an omitted reason must never read as "no gate applies," or leaving it out
 * would just be a quieter way to skip the dice than overriding them outright.
 */
export type ActionReason = "combat" | "staging";

export interface MoveTokenAction {
  type: "moveToken";
  cx: number;
  cy: number;
  tokenId: string;
  to: TileCoord;
  reason: ActionReason;
  /**
   * Required, and must name an id from THIS turn's `resolvedRolls` context,
   * when `reason` is "combat" -- see `validateWorldAction`'s gate below and
   * turnSchema.ts's "resolved rolls" section for what populates that
   * context. Never a roll `id` requested in this SAME turn's `rollRequests`;
   * a request has no result yet, so citing it would be exactly the
   * skip-the-dice move this gate exists to close.
   */
  resolvedRollId?: string;
}

export interface RemoveTokenAction {
  type: "removeToken";
  cx: number;
  cy: number;
  tokenId: string;
  reason: ActionReason;
  /** Same rule as `MoveTokenAction.resolvedRollId` -- required, and must be a THIS-turn-resolved id, when `reason` is "combat". */
  resolvedRollId?: string;
}

export interface PlacePropAction {
  type: "placeProp";
  cx: number;
  cy: number;
  prop: PlacedProp;
}

export interface SetDoorStateAction {
  type: "setDoorState";
  cx: number;
  cy: number;
  propId: string;
  assetId: TileId;
}

export type WorldAction =
  | AssembleCellAction
  | PlaceTokenAction
  | MoveTokenAction
  | RemoveTokenAction
  | PlacePropAction
  | SetDoorStateAction;

const WORLD_ACTION_TYPES = [
  "assembleCell",
  "placeToken",
  "moveToken",
  "removeToken",
  "placeProp",
  "setDoorState",
] as const;

// ── roll requests ──────────────────────────────────────────────────────
//
// This is the load-bearing structural guarantee behind "the model never
// overrides a die roll" (DESIGN.md, "The DM turn protocol"): every variant
// below carries only what's needed to ASK the engine for a roll (who's
// rolling, what they're rolling against, why) and there is no field, on any
// variant, that a resolved outcome could be written into. A d20 result, a
// hit/miss, a damage total -- none of those have anywhere to go in this
// type. The engine resolves rollRequests (rules/combat.ts, rules/checks.ts)
// and hands the resolved fact back in the *next* turn's message history as
// something that already happened, not as a field the model fills in.

export type AbilityName = keyof AbilityScores;

interface RollRequestCommon {
  /** Stable id for this one request, so the resolved-roll fact the engine reports back next turn can say which request it answers. */
  id: string;
  /** Token or character id making the roll -- the engine looks up ITS OWN modifier for this id; the model never supplies a modifier. */
  by: string;
  /** Short in-fiction reason ("the goblin swings at Kira", "the lock looks stubborn"), shown in the roll prompt and echoed back into next turn's context. */
  reason: string;
}

/**
 * An attack roll carries NO AC. Armor Class is a property of a creature under
 * SRD 5.1 (its armor, its DEX, its natural armor), not a per-attack judgement
 * call, so there is always a right answer the engine can look up and the model
 * has no legitimate reason to supply one. `session/combat.ts`'s
 * `defenderACForRollRequest` owns that lookup for every token on the board:
 * the player's real sheet, the defender's statblock, or the engine's fallback
 * statblock, in that order.
 *
 * This field used to exist and used to be REQUIRED, which is how the whole
 * citation gate stayed defeatable one field upstream: the model chose the
 * number its own d20 was compared against. `validateRollRequest` now REJECTS
 * a request that carries it rather than ignoring it, deliberately. A silently
 * ignored field is exactly how this half-regressed between rounds, the wire
 * still accepting a number that no longer meant anything, so half a fix
 * looked like a whole one. Rejecting it makes the next drift loud.
 */
export interface AttackRollRequest extends RollRequestCommon {
  kind: "attack";
  /**
   * Token/character id being attacked. REQUIRED, not "when there is one to
   * name" -- an earlier version of this field was optional on the theory
   * that the DM sometimes has no single target to name, which does not
   * actually happen in SRD play (an attack roll, unlike a save or an
   * area effect, is always made against one creature's AC by definition).
   * Making it optional bought nothing real and cost a lot: `tokenMatchesRoll`
   * had to decide what an absent `against` means for citation purposes, and
   * "let it match any token" was a real, exploitable hole (a gauntlet critic
   * found it, see turnSchema's `tokenMatchesRoll` history) while "let it
   * match no token" would have made an untargeted attack roll uncitable for
   * anything, which is equally wrong for a hit that plainly happened to
   * someone. Requiring the field removes the ambiguity at its source instead
   * of arbitrating it at the citation site.
   */
  against: string;
  /**
   * Melee or ranged, defaulting to melee. This is the DM's fiction call (does
   * this goblin have a bow), which is a legitimate one for the model to make
   * in a way an AC is not, and it selects which reach the engine holds the
   * swing to: 1
   * tile for melee (SRD's 5 ft.), a weapon's normal range for a shot, which
   * at this board size means the shot is limited by line of sight instead.
   * It is NOT a way to reach further than the geometry allows: when the
   * caller supplies a real reach for a token (a PC's equipped weapon), that
   * pins the number and this field cannot widen it. See world/reach.ts.
   */
  range?: AttackRange;
}

export interface SaveRollRequest extends RollRequestCommon {
  kind: "save";
  /** Which ability score saves -- the engine looks up that ability's modifier for `by`. */
  ability: AbilityName;
  dc: number;
  /**
   * What a FAILED save costs, in dice notation ("2d6"), optional.
   *
   * The gap this closes: a save carried a DC and a reason and nothing else,
   * so the engine had no number to apply when one failed. Two blind readers
   * caught the same moment in a session log, a goblin failing a Dexterity
   * save against a fire and never taking a point of damage: the narrative
   * remembered the coals, the math did not.
   *
   * This is a number the MODEL writes, unlike an attack's damage (which the
   * engine reads off the attacker's own statblock), and that is correct
   * rather than a hole: a hazard has no statblock to read. It is the same
   * class of call as the DC beside it, which SRD 5.1 states plainly is the
   * GM's, and it is bounded the same way `session/combat.ts`'s
   * `dcForRollRequest` bounds a DC. The engine still ROLLS it: the model
   * supplies the dice, never the total.
   *
   * Applied on a failure only. SRD's "half damage on a success" is real for
   * area effects but is a per-effect property this shape has no room to carry,
   * and guessing it for every save would be inventing a rule.
   *
   * Named `damageOnFailure` rather than `damage`, and that is load-bearing
   * rather than fussy. `test/livingtable-dm.test.ts`'s "no field a roll
   * outcome could structurally originate from" forbids the exact key
   * `damage` at compile time, alongside `result`, `hit` and `total`, because
   * a field called `damage` on a roll request is a field a model will
   * eventually fill in with 8 meaning "it took 8". This one is dice the
   * engine has yet to roll, an INPUT of the same kind as the `dc` beside it,
   * and the name has to say so on sight. `asSaveDamage` enforces the same
   * thing at runtime: a bare number is rejected, only notation is accepted.
   */
  damageOnFailure?: string;
}

/**
 * Bounds on a save's damage dice, in the same spirit as MIN_DC/MAX_DC: the
 * scale is checked, the DM's judgement inside it is not second-guessed.
 * 10d12+10 is well past anything SRD 5.1 throws at the level range this build
 * caps at, and it is small enough that "99d100" cannot be an outcome dial
 * dressed up as a hazard.
 */
const MAX_SAVE_DAMAGE_DICE = 10;
const MAX_SAVE_DAMAGE_SIDES = 12;
const MAX_SAVE_DAMAGE_MODIFIER = 10;

export interface CheckRollRequest extends RollRequestCommon {
  kind: "check";
  /** A skill name ("Perception", "Stealth", ...); which ability it keys off of is the engine's lookup, not the model's job to know. */
  skill: string;
  dc: number;
}

export type RollRequest = AttackRollRequest | SaveRollRequest | CheckRollRequest;

// ── resolved rolls: what a rollRequest becomes, one turn later ──────────
//
// The engine resolves a prior turn's `rollRequests` between turns
// (rules/combat.ts's `resolveAttack`, rules/checks.ts's `resolveSavingThrow`
// / `resolveSkillCheck`) and hands the outcome back as one of these in the
// NEXT turn's context -- never something the model produces. This is also
// the only thing a "combat" reason'd `moveToken`/`removeToken` may cite: see
// `resolvedRollId` on those two actions above and the gate in
// `validateWorldAction` below. Deliberately reuses the rules engine's own
// result types (`AttackResult`, `CheckResult`) rather than inventing a
// parallel shape -- this IS that result, just carrying the `id` that ties it
// back to the request that asked for it, plus `by` (and, for an attack,
// `against`) carried straight over from the `RollRequest` the engine
// resolved -- the same identity fields the model was shown when it asked
// for the roll, so a citation can be checked against WHO the roll was
// about, not just that some roll with a matching id exists somewhere.

export type ResolvedRoll =
  | ({ id: string; kind: "attack"; by: string; against: string } & AttackResult)
  | ({ id: string; kind: "save" | "check"; by: string } & CheckResult);

/**
 * What `validateDmTurn` needs from the caller besides the raw model reply:
 * the rolls that actually resolved before this turn, in full -- not just
 * their ids. An earlier version of this file carried only bare ids on the
 * theory that "validating a citation only needs to know the id is real, not
 * re-derive what the roll said." That turned out to be wrong: set-membership
 * on a bare id can't tell a resolved MISS from a resolved hit, or a roll
 * about one token from a roll about another, so a "combat" removeToken could
 * cite any id present here regardless of what that roll actually decided or
 * who it concerned. `requireResolvedRollForCombat` needs the full object to
 * close that gap. Defaults to empty, which is fail-closed on purpose: a turn
 * validated with no context can never satisfy the "combat" gate, so a caller
 * that forgets to wire this up gets every combat removeToken/moveToken
 * rejected loudly, never silently accepted.
 */
export interface DmTurnContext {
  resolvedRolls?: Iterable<ResolvedRoll>;
  /**
   * Where every token in the playspace is standing, plus what each one can
   * see (world/reach.ts). Supplied, this file checks that an attack roll was
   * geometrically possible at all: a melee swing has to come from an adjacent
   * tile, and a shot needs line of sight. Omitted, that check simply does not
   * run -- the same fail-open shape `checkAttackReach` itself uses, because a
   * validator with no positions has no fact to reject on and must never
   * invent one. This is the third narrow exception to this file's "shape
   * only" rule, alongside citation provenance and action economy, and it is
   * the same KIND of exception: it needs no World and no AssetManifest, only
   * plain data the caller already holds.
   */
  geometry?: CombatGeometry;
}

// ── the turn itself ─────────────────────────────────────────────────────

/**
 * Tier 3's closed category union (DESIGN.md, "Permanent campaign facts").
 * Deliberately restated here rather than imported from memory/types.ts: this
 * is the MODEL-facing contract, and the whole point of the field is that the
 * model must pick one of exactly these five, so the list the validator
 * enforces is the list the prompt prints.
 */
export type MemoryFactCategory = "npc" | "promise" | "item" | "event" | "thread";

/**
 * One durable campaign fact the DM itself types on the turn it happens.
 *
 * The gap this closes: tier 3 is the tier DESIGN.md calls the source of
 * truth, and the prose heuristic that fed it hardcoded EVERY fact to category
 * "event" and status "noted (heuristic, unverified)", so a sworn vow, a
 * murder, a theft and the weather all reached scene 14 as the same shape. A
 * heuristic structurally cannot know that a promise is outstanding or that an
 * NPC is dead. The model that just wrote the scene does, and was never asked.
 *
 * Constraints this respects, deliberately: no second AI call (it rides the
 * turn that was already paid for, so DESIGN.md's "condensation never becomes
 * its own charge" holds and the cost model is untouched), no code written or
 * run by the model, and the whole field is OPTIONAL, so a turn that omits it
 * still validates and the existing heuristic remains the fallback path.
 */
export interface DmMemoryFact {
  category: MemoryFactCategory;
  /** Stable slug this fact is upserted by, so an NPC's status can change without the record of having met them disappearing. */
  key: string;
  /** The fact itself, normalised to the Record shape tier 3 stores. A plain string is accepted and wrapped as `{ text }`. */
  fact: Record<string, unknown>;
  /** Real state, in the model's own words: "dead, killed by the party at the bridge", "outstanding, due the new moon". Never a provenance label. */
  status: string;
}

export interface DmTurn {
  narration: string;
  actions: WorldAction[];
  rollRequests?: RollRequest[];
  menuHint?: string[];
  memoryFacts?: DmMemoryFact[];
  /**
   * A written campaign's state changes, by id: the beats, clues, truths and
   * outcomes that happened this turn. Shape only here; whether each id
   * exists and whether its gate has opened is campaign/engine.ts's call,
   * made against the module, and a refused id comes back to the DM as an
   * engine note rather than costing the turn. Optional, and ignored on a
   * campaign the AI planned.
   */
  story?: StoryUpdate;
}

// ── small validation helpers ────────────────────────────────────────────
// bridge/ai.ts exports asRecord/asString/asArray, shared by every generator
// in this repo; the DM turn needs a couple more (numbers, enums, optional
// arrays) that no other generator has needed yet, so they live here rather
// than growing the shared file for one caller.

function asInt(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new Error(`${what} must be a whole number, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Like asArray, but a missing field defaults to empty rather than throwing -- used for the DM turn's genuinely optional lists (props/tokens/exits on a layout, actions on a pure-narration turn). */
function asOptionalArray(v: unknown, what: string): unknown[] {
  if (v === undefined) return [];
  return asArray(v, what);
}

/**
 * A save's failure damage: real dice notation, on a scale a hazard could
 * plausibly deal. Rejected rather than clamped, because a clamp on a STRING
 * would mean rewriting the model's dice into different dice and reporting a
 * roll it never asked for; a DC is a bare number and clamps cleanly, this
 * does not. The message names the bound so the one retry can fix it.
 */
function asSaveDamage(v: unknown, what: string): string {
  const notation = asString(v, what, 20);
  let parsed: { count: number; sides: number; modifier: number };
  try {
    parsed = parseDiceNotation(notation);
  } catch {
    throw new Error(`${what} must be dice notation like "2d6" or "1d10+2", got ${JSON.stringify(v)}.`);
  }
  if (parsed.count > MAX_SAVE_DAMAGE_DICE || parsed.sides > MAX_SAVE_DAMAGE_SIDES || Math.abs(parsed.modifier) > MAX_SAVE_DAMAGE_MODIFIER) {
    throw new Error(
      `${what} is ${notation}, which is off the scale this engine accepts for a failed save: at most ` +
        `${MAX_SAVE_DAMAGE_DICE} dice, at most d${MAX_SAVE_DAMAGE_SIDES}, and a flat modifier no bigger than ` +
        `${MAX_SAVE_DAMAGE_MODIFIER}. Pick damage a hazard could really deal and let the roll decide the rest.`,
    );
  }
  return notation;
}

function asEnum<T extends string>(v: unknown, what: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new Error(`${what} must be one of ${allowed.join(", ")}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

const EDGES: readonly Edge[] = ["N", "S", "E", "W"];
const TOKEN_KINDS = ["pc", "npc", "monster", "companion"] as const;
const ABILITIES: readonly AbilityName[] = ["str", "dex", "con", "int", "wis", "cha"];
const ACTION_REASONS: readonly ActionReason[] = ["combat", "staging"];
const ATTACK_RANGES: readonly AttackRange[] = ["melee", "ranged"];
const MEMORY_FACT_CATEGORIES: readonly MemoryFactCategory[] = ["npc", "promise", "item", "event", "thread"];
/** At most this many facts per turn, so an optional field can never balloon a turn the player paid for. */
const MAX_MEMORY_FACTS = 6;
/** At most this many ids in any one list of a turn's `story`; one turn of play does not resolve more than a handful of things. */
const MAX_STORY_IDS = 8;
const STORY_ID_LISTS = ["beats", "clues", "learned", "outcomes", "dead"] as const;
/**
 * At most this many rolls one turn may ask the engine for.
 *
 * `rollRequests` had no length limit of any kind: a turn carrying sixty attack
 * requests validated exactly as cleanly as one carrying one, and every attack
 * the engine resolves against the player is real damage on the real sheet, so
 * an unbounded list is an unbounded amount of harm out of a single paid turn.
 * Eight is the SRD-plausible ceiling for what one round of narration can
 * honestly contain: a launch-scale encounter is a handful of creatures and
 * each of them gets one action (`requireActionEconomyForAttack`), so a turn
 * asking for more than eight rolls is not a busy round, it is a mistake or an
 * attack. Note what this cap does NOT have to carry on its own: "no more
 * attacks than there are creatures" is already true by construction, because
 * `requireAttackerOnBoard` makes every attacker a token that exists and
 * `requireActionEconomyForAttack` lets each of them swing once. This is the
 * bound that still holds when there is no geometry to count creatures from.
 */
const MAX_ROLL_REQUESTS = 8;
/** At most this many keys inside one fact's object form, for the same reason. */
const MAX_FACT_FIELDS = 8;

function asTileCoord(v: unknown, what: string): TileCoord {
  const rec = asRecord(v, what);
  return { x: asInt(rec.x, `${what}.x`), y: asInt(rec.y, `${what}.y`) };
}

function asCellFields(rec: Record<string, unknown>, what: string): { cx: number; cy: number } {
  return { cx: asInt(rec.cx, `${what}.cx`), cy: asInt(rec.cy, `${what}.cy`) };
}

/**
 * REJECT, on sight, any key by which a dungeon master could try to name what a
 * piece of equipment is worth.
 *
 * The engine owns every equipment bonus: a sheet stores a TIER and the number
 * is looked up in a frozen table on every read, so there is no field on the
 * wire the model could fill in that would change a die roll. This check is
 * defence in depth on top of that, and it is deliberately a THROW rather than
 * a silent drop. The validators here build every object field by field, so an
 * unknown key is already ignored and can never reach a bonus function; but
 * ignoring it means a model that tries this gets no feedback, keeps trying, and
 * the day someone refactors a validator to spread an object instead the hole
 * opens silently. A throw makes the attempt visible in the retry message, in
 * the same voice as the existing `targetAC` rejection.
 */
function rejectEquipmentKeys(rec: Record<string, unknown>, what: string): void {
  for (const key of EQUIPMENT_FORBIDDEN_WIRE_KEYS) {
    if (rec[key] === undefined) continue;
    throw new Error(
      `${what} carries a "${key}". Equipment bonuses are the engine's: a character sheet stores which piece is in a slot ` +
        `and the engine looks up what it is worth, so a bonus, tier or item you name here is not used and must not be sent. ` +
        `Narrate the gear all you like; the numbers are not yours to set.`,
    );
  }
}

function validatePlacedToken(v: unknown, what: string): PlacedToken {
  const rec = asRecord(v, what);
  rejectEquipmentKeys(rec, what);
  const assetId = asString(rec.assetId, `${what}.assetId`, 80);
  // Equipment sprites ship with kind "token", so they reach the manifest's
  // token list and would otherwise be placeable. A gear sprite is drawn OVER a
  // character by the compositor; standing one on a floor tile is a disembodied
  // helmet on a flagstone, and it is also the only route by which a DM could
  // put a piece of equipment into the world at all.
  if (assetId.startsWith(GEAR_ASSET_ID_PREFIX)) {
    throw new Error(
      `${what}.assetId is "${assetId}", which is a piece of equipment, not a creature. Gear is drawn on the character ` +
        `wearing it and is never placed on a tile. Place a creature token, or describe the item in your narration.`,
    );
  }
  return {
    id: asString(rec.id, `${what}.id`, 80),
    assetId,
    x: asInt(rec.x, `${what}.x`),
    y: asInt(rec.y, `${what}.y`),
    kind: asEnum(rec.kind, `${what}.kind`, TOKEN_KINDS),
  };
}

/**
 * DM-lane close-out finding ("grantsItem magic-name lockout is exact-match
 * only"): `isMagicGearName` (equipmentTypes.ts) is an exact match after trim,
 * whitespace-collapse and case-fold, so it is dodged by anything wrapped in
 * ordinary DM prose around the same name: "a Ring of Protection", "the Boots
 * of Speed", "Keen Longsword +1", "Keen Longswords", "Dawnbreaker (worn)",
 * "Dawnbreaker.". A probe against every one of `MAGIC_GEAR_NAMES` in those
 * shapes found all of them accepted, none rejected.
 *
 * Below builds one case-insensitive pattern per magic gear name that matches
 * it as an isolated phrase inside a larger string: internal whitespace is
 * collapsed the same way `gearNameKey` collapses it, a single optional
 * trailing "s" absorbs the plural ("Longswords"), and the boundary either
 * side of the match is "not alphanumeric" rather than regex `\b` -- `\b`
 * itself fails at the end of a name like "Stone of Good Luck (Luckstone)",
 * which ends in a non-word character, so it would silently stop matching the
 * one name in this list that carries its own parenthetical.
 */
const MAGIC_GEAR_NAME_PATTERNS: readonly { name: string; pattern: RegExp }[] = Object.freeze(
  MAGIC_GEAR_NAMES.map((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return { name, pattern: new RegExp(`(?<![A-Za-z0-9])${escaped}s?(?![A-Za-z0-9])`, "i") };
  }),
);

/**
 * The first magic gear name found sitting inside `text`, wrapped in ordinary
 * noise or not, or `null` when none is. `multiWordOnly` skips every
 * single-word name ("Mercy", "Whisper", "Luckstone", ...): those are also
 * ordinary English words or short enough to appear in unrelated flavour
 * prose, so a free-text field (a prop's `label` or `onFound`) only rejects
 * the multi-word names a coincidence can't produce by accident, while a
 * dedicated name field (`grantsItem`) checks the full list.
 */
export function findMagicGearNameIn(text: string, opts: { multiWordOnly?: boolean } = {}): string | null {
  for (const { name, pattern } of MAGIC_GEAR_NAME_PATTERNS) {
    if (opts.multiWordOnly && !name.includes(" ")) continue;
    if (pattern.test(text)) return name;
  }
  return null;
}

function validatePlacedProp(v: unknown, what: string): PlacedProp {
  const rec = asRecord(v, what);
  // contract v2, equipmentTypes.ts section 11.7 point 1: every placed prop is
  // one of the sites EQUIPMENT_FORBIDDEN_WIRE_KEYS is checked against, the
  // same as a placed token and a roll request.
  rejectEquipmentKeys(rec, what);
  const prop: PlacedProp = {
    id: asString(rec.id, `${what}.id`, 80),
    assetId: asString(rec.assetId, `${what}.assetId`, 80),
    x: asInt(rec.x, `${what}.x`),
    y: asInt(rec.y, `${what}.y`),
  };
  // facing is optional on PlacedProp (cell.ts: "omitted when it doesn't [matter]"),
  // so only validate and attach it when the model actually sent one.
  if (rec.facing !== undefined) prop.facing = asEnum(rec.facing, `${what}.facing`, EDGES);
  // The searchable-prop fields (DESIGN.md's Search verb: "a check against a
  // DC set when the cell was assembled, revealing pre-authored flavour text
  // on the prop it was checked against"). All optional -- a torch has nothing
  // to find -- but a `dc` outside the SRD scale is rejected here rather than
  // silently clamped, because a DC of 47 is not a hard search, it is a
  // mistake, and the model's one retry can fix it.
  if (rec.label !== undefined) {
    const label = asString(rec.label, `${what}.label`, 80);
    // Defence in depth alongside `grantsItem` below: a label is what the
    // player reads on the prop BEFORE it is searched ("the iron-bound
    // chest"), so naming the magic item inside it there ("Boots of Speed")
    // tips the engine's own roll just as surely as a bare grantsItem would,
    // and `grantsItem`'s own guard has nothing to say about this field.
    // Single-word names are skipped (`multiWordOnly`) so an ordinary label
    // ("a merchant's letter of mercy") is never caught by a name that
    // happens to be one common English word.
    const matched = findMagicGearNameIn(label, { multiWordOnly: true });
    if (matched) {
      throw new Error(
        `${what}.label is "${label}", which names the magic item "${matched}". A prop's label is what the player sees ` +
          `before searching it; naming a magic item there gives away what the engine's loot roll hasn't decided yet. ` +
          `Describe the prop itself, not the treasure inside it.`,
      );
    }
    prop.label = label;
  }
  if (rec.dc !== undefined) {
    const dc = asInt(rec.dc, `${what}.dc`);
    if (dc < MIN_DC || dc > MAX_DC) {
      throw new Error(
        `${what}.dc is ${dc}, outside the SRD ${MIN_DC} to ${MAX_DC} scale. Use ${MIN_DC} for "anyone notices", ` +
          `10 to 15 for "you have to look", up to ${MAX_DC} for "nearly impossible".`,
      );
    }
    prop.dc = dc;
  }
  if (rec.onFound !== undefined) {
    const onFound = asString(rec.onFound, `${what}.onFound`, 400);
    // Same defence as `label` above, for the flavour text a successful
    // search reveals: "Beneath the rags lies a Ring of Protection." names the
    // item just as plainly as a bare grantsItem would, and handleSearch
    // pushes this string into the story verbatim. multiWordOnly for the same
    // reason as label -- this is free prose, not a name field.
    const matched = findMagicGearNameIn(onFound, { multiWordOnly: true });
    if (matched) {
      throw new Error(
        `${what}.onFound is "${onFound}", which names the magic item "${matched}". Magic items come only from the engine's ` +
          `loot roll, never from a prop's flavour text: narrate the search succeeding, never the specific magic item found.`,
      );
    }
    prop.onFound = onFound;
  }
  // `grantsItem` itself is legitimate -- it is NOT in EQUIPMENT_FORBIDDEN_WIRE_KEYS
  // -- so it is policed by VALUE instead of rejected outright (equipmentTypes.ts
  // section 11.7 point 2). A magic gear name is the one route left by which a
  // DM turn could try to hand the player typed gear (loot is the engine's
  // roll, never a prop), so it is rejected here, in the same loud voice as
  // every other equipment rejection in this file; an ordinary name ("a coil of
  // rope", or even a COMMON gear name like "Longsword", which is not magic by
  // this contract's own definition) stays legal flavour. The check is not
  // `isMagicGearName`'s own exact match (dodged by "a Ring of Protection",
  // "Keen Longsword +1", "Dawnbreaker." and every other wrapped variant --
  // see `findMagicGearNameIn`'s comment); this field checks the full name
  // list, not just multi-word ones, since it exists to hold nothing BUT a
  // short item name/description, never flowing prose.
  if (rec.grantsItem !== undefined) {
    const grantsItem = asString(rec.grantsItem, `${what}.grantsItem`, 60);
    const matched = isMagicGearName(grantsItem) ? grantsItem : findMagicGearNameIn(grantsItem);
    if (matched) {
      throw new Error(
        `${what}.grantsItem is "${grantsItem}", which names the magic item "${matched}". Magic items come only from the ` +
          `engine's loot roll, never from a prop. Grant an ordinary thing (a key, a letter, a coil of rope) or leave ` +
          `grantsItem out.`,
      );
    }
    prop.grantsItem = grantsItem;
  }
  return prop;
}

/**
 * One tier-3 fact. `fact` accepts either a short string (wrapped as
 * `{ text }`, since that is overwhelmingly the natural thing to write) or a
 * small object, whose values are stringified and capped so an arbitrary
 * nested blob can't ride in through a field meant for one sentence.
 */
function validateMemoryFact(v: unknown, what: string): DmMemoryFact {
  const rec = asRecord(v, what);
  const category = asEnum(rec.category, `${what}.category`, MEMORY_FACT_CATEGORIES);
  const key = asString(rec.key, `${what}.key`, 60);
  const status = asString(rec.status, `${what}.status`, 160);

  let fact: Record<string, unknown>;
  if (typeof rec.fact === "string") {
    fact = { text: asString(rec.fact, `${what}.fact`, 300) };
  } else {
    const raw = asRecord(rec.fact, `${what}.fact`);
    const keys = Object.keys(raw);
    if (keys.length > MAX_FACT_FIELDS) {
      throw new Error(`${what}.fact has ${keys.length} fields, at most ${MAX_FACT_FIELDS}. A permanent fact is one line, not a record sheet.`);
    }
    fact = {};
    for (const k of keys) fact[k.slice(0, 40)] = String(raw[k]).slice(0, 300);
  }

  return { category, key, fact, status };
}

/** The shape of a turn's `story` report: lists of short ids, and attitude shifts on the one scale campaign/types.ts defines. */
function validateStoryUpdate(v: unknown): StoryUpdate {
  const rec = asRecord(v, "story");
  const out: StoryUpdate = {};
  for (const key of STORY_ID_LISTS) {
    if (rec[key] === undefined) continue;
    const raw = asArray(rec[key], `story.${key}`);
    if (raw.length > MAX_STORY_IDS) throw new Error(`story.${key} has ${raw.length} entries, at most ${MAX_STORY_IDS}. Report only what happened this turn.`);
    out[key] = raw.map((id, i) => asString(id, `story.${key}[${i}]`, 60));
  }
  if (rec.attitudes !== undefined) {
    const raw = asArray(rec.attitudes, "story.attitudes");
    if (raw.length > MAX_STORY_IDS) throw new Error(`story.attitudes has ${raw.length} entries, at most ${MAX_STORY_IDS}.`);
    out.attitudes = raw.map((a, i) => {
      const entry = asRecord(a, `story.attitudes[${i}]`);
      return { id: asString(entry.id, `story.attitudes[${i}].id`, 60), attitude: asEnum(entry.attitude, `story.attitudes[${i}].attitude`, ATTITUDES) };
    });
  }
  return out;
}

function validateExit(v: unknown, what: string): Exit {
  const rec = asRecord(v, what);
  // contract v2: an exit is one of a layout's own child objects, like its
  // props and tokens, so a forbidden equipment key on it is REJECTED too
  // rather than silently dropped by the literal rebuild below. The
  // integrator's lockout probe found this the one site still ignoring them.
  rejectEquipmentKeys(rec, what);
  return {
    at: asTileCoord(rec.at, `${what}.at`),
    edge: asEnum(rec.edge, `${what}.edge`, EDGES),
    toCell: asCellFields(asRecord(rec.toCell, `${what}.toCell`), `${what}.toCell`),
  };
}

/**
 * A full cell layout, shape-checked only: the tile grid is exactly
 * CELL_WIDTH x CELL_HEIGHT (DESIGN.md's "one shot" assembly means there's no
 * partial-grid case to accept), and every prop/token/exit has the right
 * fields. Whether a given tile/token/prop asset id actually EXISTS in the
 * manifest, and whether a token landed on a walkable tile, is
 * world/connectivity.ts's validateLayout -- that check needs the manifest,
 * which this function doesn't have and shouldn't need.
 */
function validateCellLayout(v: unknown, what: string): CellLayout {
  const rec = asRecord(v, what);
  // contract v2: every assembleCell layout is checked directly for a
  // forbidden equipment key, same as the turn root and every action -- this
  // catches a key sitting on the LAYOUT object itself (e.g. layout.tier);
  // a key nested inside one of the layout's own props/tokens is a different
  // object entirely and is caught by validatePlacedProp/validatePlacedToken
  // below, which each run their own rejectEquipmentKeys.
  rejectEquipmentKeys(rec, what);
  const rows = asArray(rec.tiles, `${what}.tiles`, CELL_HEIGHT);
  const tiles: TileId[][] = rows.map((row, y) => {
    const cells = asArray(row, `${what}.tiles[${y}]`, CELL_WIDTH);
    return cells.map((id, x) => asString(id, `${what}.tiles[${y}][${x}]`, 60));
  });

  const layout: CellLayout = {
    tiles,
    props: asOptionalArray(rec.props, `${what}.props`).map((p, i) => validatePlacedProp(p, `${what}.props[${i}]`)),
    tokens: asOptionalArray(rec.tokens, `${what}.tokens`).map((t, i) => validatePlacedToken(t, `${what}.tokens[${i}]`)),
    exits: asOptionalArray(rec.exits, `${what}.exits`).map((e, i) => validateExit(e, `${what}.exits[${i}]`)),
  };
  // `sealed` waives connectivity.ts's "every room needs a way out" check, so
  // it has to survive validation to reach the engine at all -- but only as a
  // real boolean the model actually sent, never as a truthy string.
  if (rec.sealed !== undefined) {
    if (typeof rec.sealed !== "boolean") {
      throw new Error(`${what}.sealed must be true or false, got ${JSON.stringify(rec.sealed)}. Leave it out entirely for an ordinary room.`);
    }
    layout.sealed = rec.sealed;
  }
  return layout;
}

/**
 * Whether a resolved roll actually decided an outcome in the direction a
 * combat move/removal enacts, per SRD convention: an attack only lands on a
 * hit (a miss decides nothing), a save's bad effect only lands on a FAILED
 * save (a successful save resists it, per SRD 5.1's whole point of saving
 * throws), and a check's attempted action only lands on a SUCCESSFUL check
 * (a failed check is, by definition, an attempt that didn't work). A roll
 * that resolved the other way is real and present in `resolvedRolls`, but it
 * decided "nothing happens," not "enact this outcome" -- exactly the
 * distinction a bare id can't carry.
 */
function rollDecidesOutcome(roll: ResolvedRoll): boolean {
  if (roll.kind === "attack") return roll.hit;
  if (roll.kind === "save") return !roll.success;
  return roll.success;
}

/** Same three cases as `rollDecidesOutcome`, worded for the rejection message. */
function describeRollOutcome(roll: ResolvedRoll): string {
  if (roll.kind === "attack") return roll.hit ? "a hit" : "a miss";
  if (roll.kind === "save") return roll.success ? "a successful save (the effect was resisted)" : "a failed save";
  return roll.success ? "a successful check" : "a failed check";
}

/**
 * Whether the token a combat action is acting on is actually the token the
 * cited roll concerned. An attack roll names its target in `against`
 * (required -- see `AttackRollRequest.against`'s doc comment); a save or
 * check has no separate target, so the token it concerns is whoever made it,
 * `by`. Deliberately a STRICT equality check on both branches: an earlier
 * version let an attack roll with no named `against` match any token, on the
 * theory that an untargeted roll leaves "nothing to check against" so
 * citation shouldn't be blocked on that basis. That was wrong -- it let a
 * single untargeted hit justify a "combat" removeToken on ANY token in the
 * scene, which is exactly the skip-the-dice bypass this whole gate exists to
 * close, one field over. Requiring `against` at the schema level (rather
 * than arbitrating an absent one here) means this function never has to
 * choose between "match anything" and "match nothing" for a case that,
 * under real SRD rules, should never arise in the first place.
 */
function tokenMatchesRoll(tokenId: string, roll: ResolvedRoll): boolean {
  if (roll.kind === "attack") return roll.against === tokenId;
  return roll.by === tokenId;
}

/**
 * A cousin of `tokenMatchesRoll`, used only by the round-3 staging check
 * below, never by the citation-acceptance path above. Now that `against` is
 * required on every attack roll, the two functions agree on attacks (both
 * are a strict `against === tokenId` check); they stay separate functions
 * because they answer different questions and a future roll kind could
 * legitimately need them to diverge again -- `tokenMatchesRoll` asks "may
 * this roll be CITED for this token" (the citation direction, where the
 * model supplies both the roll id and the token), `tokenPositivelyImplicatedByRoll`
 * asks "does this roll's own resolved fact IMPLICATE this token" (the
 * cross-check direction, deciding whether a "staging" label should be
 * distrusted) -- collapsing them into one shared function would make that
 * distinction invisible at the call site.
 */
function tokenPositivelyImplicatedByRoll(tokenId: string, roll: ResolvedRoll): boolean {
  if (roll.kind === "attack") return roll.against === tokenId;
  return roll.by === tokenId;
}

/**
 * The gap this closes, round two: the first version of this gate checked
 * only that the cited `resolvedRollId` existed in this turn's resolved-rolls
 * context -- set-membership on a bare id. That let a resolved MISS's id
 * satisfy a "combat" kill just as well as a resolved hit, let a roll about
 * one token justify an action on a completely different token, and let the
 * same id be cited over and over to "justify" N separate removals in one
 * turn, because the gate never checked WHAT the roll decided, WHO it
 * concerned, or whether it had already been spent. This version checks all
 * three, in order: the roll must exist in `resolvedRolls` (unchanged from
 * before -- never a same-turn `rollRequests` id, since that roll has no
 * result yet), it must not already have been cited by an earlier action in
 * this same turn (`spentRollIds`, one shared set threaded through the whole
 * turn the same way `requireActionEconomyForAttack`'s `economies` map is),
 * it must have decided this direction of outcome (`rollDecidesOutcome`), and
 * it must concern the token this action is acting on (`tokenMatchesRoll`).
 * Only after all four hold is the id marked spent.
 *
 * The gap this closes, round three (critic-found): every check above only
 * ever ran when `reason === "combat"` -- the model's own, self-reported
 * label. A `removeToken` narrated as an outright kill but tagged reason
 * "staging" skipped this whole function, no rollRequests, no resolvedRollId,
 * no error, because nothing here ever cross-checked the label against
 * anything. That's the same "trust the model's own claim" failure this
 * function exists to close, one field up: round two stopped a citation from
 * lying about what a roll decided; round three stops the reason label from
 * lying about whether a roll is even in play. The `reason !== "combat"`
 * branch below now does one thing the old early-return didn't: it scans
 * `resolvedRolls` for a decisive, unspent roll that positively implicates
 * THIS token (`tokenPositivelyImplicatedByRoll`, deliberately stricter than
 * `tokenMatchesRoll` -- see that function's comment for why) and rejects if
 * one exists, because a "staging" label is not credible when the engine
 * already resolved, this turn, exactly the roll that would explain the
 * move/removal as a combat outcome. This closes the realistic version of the
 * bypass: a model that requests a roll, gets told it hit, and then tries to
 * enact the kill under "staging" to dodge citation. It does NOT and cannot
 * close the degenerate version -- a model that never requests any roll at
 * all and simply narrates a kill with reason "staging" -- because there is
 * then no independent fact in this turn's context to check the label
 * against; that residual gap is the same category as the narration-text gap
 * this file already documents (see the "unfixable prose gap" test in
 * test/livingtable-dm.test.ts), just one field over, and is acknowledged
 * there rather than silently left unaddressed. Closing it fully needs either
 * a hostility/HP model this shape-only validator deliberately doesn't have
 * access to (see this file's header), or narration-content analysis, which
 * this file's own established position already rejects as unreliable.
 */
function requireResolvedRollForCombat(
  reason: ActionReason,
  resolvedRollId: string | undefined,
  tokenId: string,
  resolvedRolls: ReadonlyMap<string, ResolvedRoll>,
  spentRollIds: Set<string>,
  what: string,
): void {
  if (reason !== "combat") {
    for (const roll of resolvedRolls.values()) {
      if (spentRollIds.has(roll.id)) continue; // already properly cited by an earlier action this turn -- not evidence against THIS action
      if (!rollDecidesOutcome(roll)) continue;
      if (!tokenPositivelyImplicatedByRoll(tokenId, roll)) continue;
      throw new Error(
        `${what} is reason "staging", but resolved roll "${roll.id}" (${describeRollOutcome(roll)}) from this turn's ` +
          `RESOLVED ROLLS concerns "${tokenId}" and decided an outcome. A "staging" label is not credible here -- ` +
          `if this move/removal IS that roll's outcome, mark it reason "combat" and cite resolvedRollId "${roll.id}"; ` +
          `if "${tokenId}" is unaffected by that roll, leave it where it is and let the roll be cited by whichever ` +
          `action it actually justifies instead.`,
      );
    }
    return;
  }
  if (!resolvedRollId) {
    throw new Error(
      `${what} has reason "combat" but no resolvedRollId -- a combat outcome must cite the roll that decided it. ` +
        `If that roll hasn't happened yet, request it via rollRequests and stop there for this outcome; ` +
        `you'll get the resolved result back next turn and can act on it then.`,
    );
  }
  const roll = resolvedRolls.get(resolvedRollId);
  if (!roll) {
    throw new Error(
      `${what}.resolvedRollId "${resolvedRollId}" is not a roll this turn has seen resolved. ` +
        `Only ids from resolvedRolls (rolls the engine resolved before this turn) may be cited here -- ` +
        `never the id of a roll THIS turn's rollRequests is asking for, since that roll has no result yet.`,
    );
  }
  if (spentRollIds.has(resolvedRollId)) {
    throw new Error(
      `${what}.resolvedRollId "${resolvedRollId}" was already cited by an earlier combat action this turn. ` +
        `One resolved roll decides one outcome, not several -- if another token's fate also depends on it, ` +
        `that isn't what actually happened; request a fresh roll via rollRequests for any further outcome.`,
    );
  }
  if (!rollDecidesOutcome(roll)) {
    throw new Error(
      `${what}.resolvedRollId "${resolvedRollId}" resolved as ${describeRollOutcome(roll)}, which does not decide ` +
        `a combat outcome -- an attack only lands on a hit, a save's effect only lands on a failed save, and a ` +
        `check's attempted action only lands on a successful check. If nothing decided this outcome yet, leave ` +
        `the token as it is rather than acting on a roll that didn't produce it.`,
    );
  }
  if (!tokenMatchesRoll(tokenId, roll)) {
    // The self-citation case gets its own wording on purpose. The generic
    // message said the roll "does not concern" the token in the same clause
    // that said the token rolled it, which reads as a contradiction, and
    // `tokenMatchesRoll` means an attacker is by construction never
    // implicated by their own attack -- so a model reading the old message
    // had nothing it could actually change. This file's header commits every
    // message to telling the model what to FIX, so this one names the fix.
    if (roll.kind === "attack" && roll.by === tokenId) {
      throw new Error(
        `${what}.resolvedRollId "${resolvedRollId}" was "${tokenId}"'s OWN attack roll against "${roll.against}". ` +
          `An attack roll only ever decides an outcome for its target, never for the attacker, so it cannot justify ` +
          `moving or removing "${tokenId}" itself. To act on "${tokenId}", request a roll aimed AT it (an attack whose ` +
          `"against" is "${tokenId}", or a save it has to make) and cite that result next turn.`,
      );
    }
    const rolledBy = `rolled by "${roll.by}"` + (roll.kind === "attack" ? ` against "${roll.against}"` : "");
    throw new Error(
      `${what}.resolvedRollId "${resolvedRollId}" does not concern "${tokenId}" -- it was ${rolledBy}. ` +
        `A "combat" moveToken/removeToken may only cite a roll whose outcome actually applies to the token it is acting on.`,
    );
  }
  spentRollIds.add(resolvedRollId);
}

/**
 * The geometry gate: an attack roll has to have been physically possible.
 *
 * The gap this closes: nothing anywhere checked distance. In a hand-authored
 * combat turn the PC stood at (9,0) and two goblins attacked from (9,6) and
 * (11,6), six tiles away, and the engine resolved both without complaint --
 * so positioning could not matter, cover could not matter, and retreating out
 * of reach was impossible because there was no reach. The arithmetic already
 * existed (manipulation.ts measures tile distance for movement budgets) and
 * was simply never called for an attack.
 *
 * No geometry supplied means no check, exactly like `checkAttackReach`'s own
 * fail-open contract: a validator with no positions has no fact to reject on.
 */
function requireReachForAttack(request: AttackRollRequest, geometry: CombatGeometry | undefined, what: string): void {
  if (!geometry) return;
  const verdict = checkAttackReach(geometry, request.by, request.against, request.range ?? "melee");
  if (!verdict.ok) throw new Error(`${what} ${verdict.error}`);
}

/**
 * The gate ABOVE the reach gate: whoever is swinging has to be standing on
 * the board.
 *
 * The gap this closes: `checkAttackReach` fails OPEN when it has no position
 * for one of the two tokens, and that fail-open is right where it lives (see
 * its doc comment, and world/reach.ts's own unit test for it) -- a pure
 * geometry helper handed no position has no fact to reject on and must never
 * invent one. The play loop inherited that fail-open and never asked the one
 * question the helper cannot: whether the attacker EXISTS. One turn carrying
 * twenty attack rollRequests whose `by` ids were "nobody-0" through
 * "nobody-19" validated with zero complaints, because not one of those ids
 * had a position and so not one reach check could fire; the engine then
 * resolved twenty swings at the fallback modifier and a level-2 character
 * went from full HP to dead inside a single paid turn.
 *
 * A missing position is neutral when the question is "was that swing too
 * far." It is not neutral when the question is "was there anybody swinging,"
 * because the side that pays for the turn is the side the damage lands on.
 * So the helper keeps its fail-open and this file, which knows who is paying,
 * refuses instead.
 *
 * Like every other gate here it does nothing when the caller supplies no
 * geometry: with no positions at all there is no roster to check an id
 * against. In the real play loop that is exactly one turn per campaign, the
 * bootstrap turn before any cell has been assembled (dm/dmTurn.ts derives
 * geometry from the playspace on every other turn), and what bounds the harm
 * on that one turn is `MAX_ROLL_REQUESTS` rather than this. Stated rather
 * than left implicit: a turn that opens a campaign by rolling attacks at the
 * player is a turn nothing here can check, and the cap is why it can no
 * longer be sixty of them.
 */
function requireAttackerOnBoard(request: AttackRollRequest, geometry: CombatGeometry | undefined, what: string): void {
  if (!geometry) return;
  // An OWN-property check, not a bare `positions[by]` truthiness test: `by`
  // is a model-supplied string, and "toString" or "constructor" would find
  // Object.prototype's own members and read back as a token that exists --
  // a ghost attacker wearing a name the language hands out for free.
  if (Object.prototype.hasOwnProperty.call(geometry.positions, request.by) && geometry.positions[request.by]) return;
  const roster = Object.keys(geometry.positions);
  throw new Error(
    `${what} is an attack rolled by "${request.by}", but there is no token with that id standing in the playspace. ` +
      `Only a creature that is actually on the board can swing at anything. The tokens present are ` +
      `${roster.length ? roster.map((id) => `"${id}"`).join(", ") : "(none)"}. ` +
      `If something is arriving now, put it on the board this turn with "placeToken" (or assemble it into the cell) ` +
      `and let it attack next turn -- an attacker nobody can see is not a surprise, it is a swing from nowhere.`,
  );
}

/**
 * The gap this closes: DESIGN.md's "The rules engine" lists action economy
 * (action / bonus action / movement / reaction) as one of the four pillars
 * "enforced structurally," but before this function nothing in the actual
 * turn-validation pipeline ever constructed or checked a `TurnEconomy` --
 * `rules/actionEconomy.ts`'s `spendAction` existed only for its own unit
 * tests to call. This is that missing call site: an "attack" roll request
 * spends the SRD Attack action, and one `DmTurn` is one narrated round for
 * every combatant it mentions (the model voices every NPC and monster's turn
 * in the same JSON reply), so a second "attack" `rollRequests` entry naming
 * the same `by` id in the same turn IS the double-spend `spendAction` exists
 * to catch -- a combatant attacking twice without a second turn's worth of
 * fiction passing in between. `economies` is threaded through by the caller
 * (one shared map for the whole turn) rather than rebuilt per call, exactly
 * so a repeat `by` id is seen as a repeat and not a fresh economy each time.
 *
 * Launch scope only ever grants one Attack action per round (Extra Attack is
 * a level-5 Fighter feature, and none of the four launch archetypes start
 * with a bonus-action attack -- DESIGN.md's "Characters" section), so gating
 * strictly on "action" here is correct for what's actually playable today;
 * a future archetype that legitimately gets a second attack needs its own
 * resource, not a loosened version of this check.
 */
function requireActionEconomyForAttack(by: string, economies: Map<string, TurnEconomy>, what: string): void {
  const fresh = economies.get(by) ?? resetTurnEconomy(0);
  let spent: TurnEconomy;
  try {
    spent = spendAction(fresh, "action");
  } catch {
    throw new Error(
      `${what} names "${by}" as "by", but "${by}" already spent their action on an earlier attack roll this turn. ` +
        `Each combatant gets one Attack action per round -- if "${by}" should act again, that has to be a later turn.`,
    );
  }
  economies.set(by, spent);
}

/**
 * Second-person sentences that state what the player character knows,
 * concludes or has already been told by the dice. Deliberately a short,
 * literal list, not a judgment of prose: each one is a phrase whose only
 * possible speaker is a narrator handing over the player's own mind.
 *
 * Present tense only, and that is doing real work rather than being an
 * accident of how they were typed: `\byou realize\b` does not match "you
 * realized" and `\byou fail\b` does not match "you failed". Past tense is how
 * a turn narrates the consequence of a roll the engine ALREADY resolved,
 * which is not only allowed but required (see the RESOLVED ROLLS block in
 * promptBuilder.ts); present tense in a turn with a roll still pending is the
 * one this rejects.
 */
const PRE_ANSWERED_PHRASES: RegExp[] = [
  /\byou (?:realize|realise)\b/i,
  /\byou can tell\b/i,
  /\byou get it\b/i,
  /\byou (?:are|'re) (?:certain|sure|convinced)\b/i,
  /\byou see through\b/i,
  /\byou (?:succeed|fail)\b/i,
];

/**
 * The one narration check in this file, and the exception is narrow enough to
 * state exactly: a turn may not tell the player what they know while a roll it
 * declared in the SAME turn is still pending.
 *
 * The gap this closes: two blind table judges, reading only a session log,
 * independently picked the same passage as the proof of machine authorship.
 * The DM wrote what an Insight check found ("she is choosing the true sentence
 * that is not the answer... you get it before she answers") and the roll
 * printed AFTERWARDS. Nothing was mechanically wrong -- the wire format is
 * doing its job, there is nowhere in `RollRequest` for an outcome to
 * originate, and the engine still rolled the die. What failed was the prose,
 * which answered the question before asking it and so made the enforced gap
 * invisible; one judge's verdict was that the dice then read as decoration,
 * "which retroactively undercuts the fight too."
 *
 * Why this is not the narration-content analysis this file's header rejects:
 * that rejection is about INFERRING intent from prose (did this paragraph
 * describe a kill?), which needs a hostility model this validator has no
 * business owning. This asks nothing about intent. It matches a fixed handful
 * of second-person knowledge claims, literally, and only in a turn where the
 * model has itself declared that the deciding roll has not happened yet -- an
 * independent fact from its own reply, exactly like the resolved-rolls
 * cross-check `requireResolvedRollForCombat` runs against a "staging" label.
 *
 * What it does NOT catch, stated rather than quietly left open: prose that
 * pre-answers a roll in the third person ("she is doing it fast enough that
 * she has done it before"), which is the subtler and more damaging half of the
 * same habit. That half is a prompt rule (promptBuilder.ts's HOW YOU NARRATE
 * block), because catching it needs a reader, not a regex.
 */
function requireUnansweredRolls(narration: string, requests: RollRequest[]): void {
  if (requests.length === 0) return;
  for (const pattern of PRE_ANSWERED_PHRASES) {
    const found = narration.match(pattern);
    if (!found) continue;
    throw new Error(
      `narration says "${found[0]}" in a turn that is also asking the engine for a roll (rollRequests is not empty). ` +
        `A roll that has not been made yet cannot already have an answer. Narrate up to the instant of the attempt and ` +
        `stop there -- what is said, what is in the room, what their hands are doing -- and never what the player ` +
        `realises, can tell, or is certain of. The engine's result comes back as established fact at the start of your ` +
        `next turn, and that is when its consequences get narrated. Rewrite that sentence so it hands over the evidence ` +
        `without stating what it adds up to.`,
    );
  }
}

/**
 * One action, dispatched on `type`. An unrecognised type is the single most
 * important rejection this file produces -- DESIGN.md's whole "AI never runs
 * code at play time" guarantee rests on the vocabulary being fixed and
 * closed, so the error names every legal type rather than just saying
 * "invalid," giving the model's one retry (via completeJson) something to
 * actually correct against.
 */
function validateWorldAction(
  value: unknown,
  index: number,
  resolvedRolls: ReadonlyMap<string, ResolvedRoll>,
  spentRollIds: Set<string>,
): WorldAction {
  const what = `actions[${index}]`;
  const rec = asRecord(value, what);
  // contract v2: every world action is checked directly, before dispatching
  // on type, so a forbidden key sitting on the action itself (rather than
  // buried in its prop/token/layout) is caught here once for all six action
  // shapes, rather than needing a bespoke check in each case below.
  rejectEquipmentKeys(rec, what);
  const type = asString(rec.type, `${what}.type`, 40);

  switch (type) {
    case "assembleCell": {
      const { cx, cy } = asCellFields(rec, what);
      return { type: "assembleCell", cx, cy, layout: validateCellLayout(rec.layout, `${what}.layout`) };
    }
    case "placeToken": {
      const { cx, cy } = asCellFields(rec, what);
      return { type: "placeToken", cx, cy, token: validatePlacedToken(rec.token, `${what}.token`) };
    }
    case "moveToken": {
      const { cx, cy } = asCellFields(rec, what);
      const tokenId = asString(rec.tokenId, `${what}.tokenId`, 80);
      const to = asTileCoord(rec.to, `${what}.to`);
      const reason = asEnum(rec.reason, `${what}.reason`, ACTION_REASONS);
      const resolvedRollId = rec.resolvedRollId === undefined ? undefined : asString(rec.resolvedRollId, `${what}.resolvedRollId`, 60);
      requireResolvedRollForCombat(reason, resolvedRollId, tokenId, resolvedRolls, spentRollIds, what);
      const action: MoveTokenAction = { type: "moveToken", cx, cy, tokenId, to, reason };
      if (resolvedRollId !== undefined) action.resolvedRollId = resolvedRollId;
      return action;
    }
    case "removeToken": {
      const { cx, cy } = asCellFields(rec, what);
      const tokenId = asString(rec.tokenId, `${what}.tokenId`, 80);
      const reason = asEnum(rec.reason, `${what}.reason`, ACTION_REASONS);
      const resolvedRollId = rec.resolvedRollId === undefined ? undefined : asString(rec.resolvedRollId, `${what}.resolvedRollId`, 60);
      requireResolvedRollForCombat(reason, resolvedRollId, tokenId, resolvedRolls, spentRollIds, what);
      const action: RemoveTokenAction = { type: "removeToken", cx, cy, tokenId, reason };
      if (resolvedRollId !== undefined) action.resolvedRollId = resolvedRollId;
      return action;
    }
    case "placeProp": {
      const { cx, cy } = asCellFields(rec, what);
      return { type: "placeProp", cx, cy, prop: validatePlacedProp(rec.prop, `${what}.prop`) };
    }
    case "setDoorState": {
      const { cx, cy } = asCellFields(rec, what);
      return {
        type: "setDoorState",
        cx,
        cy,
        propId: asString(rec.propId, `${what}.propId`, 80),
        assetId: asString(rec.assetId, `${what}.assetId`, 80),
      };
    }
    default:
      throw new Error(
        `${what}.type is "${type}", which is not a world-action this engine knows. ` +
          `Use exactly one of: ${WORLD_ACTION_TYPES.join(", ")}.`,
      );
  }
}

/**
 * One roll request, dispatched on `kind`. The DC/AC check is deliberately a
 * hand-written `typeof` guard before `asInt` rather than just calling
 * `asInt` directly -- a missing dc/ac should read back to the model as "you
 * asked for a roll but didn't say what it's against," not the generic
 * "must be a whole number, got undefined" a bare asInt would produce, because
 * the fix for the two failures is different (add the field vs. fix its type).
 */
function validateRollRequest(value: unknown, index: number): RollRequest {
  const what = `rollRequests[${index}]`;
  const rec = asRecord(value, what);
  rejectEquipmentKeys(rec, what);
  const common = {
    id: asString(rec.id, `${what}.id`, 60),
    by: asString(rec.by, `${what}.by`, 80),
    reason: asString(rec.reason, `${what}.reason`, 300),
  };
  const kind = asString(rec.kind, `${what}.kind`, 20);

  switch (kind) {
    case "attack": {
      // The inverse of the rule this used to enforce. See
      // AttackRollRequest's doc comment: the engine owns every defender's AC
      // now, so a supplied one is not merely unnecessary, it is a field the
      // wire must stop carrying or the next silent regression looks identical
      // to a fix.
      if (rec.targetAC !== undefined) {
        throw new Error(
          `${what} carries a "targetAC". The engine looks up every defender's Armor Class itself, from the player's sheet ` +
            `or the creature's own statblock, so a targetAC you supply is not used and must not be sent. Name the target in ` +
            `"against" and let the engine decide what its AC is.`,
        );
      }
      // `against` is required, not optional: an attack roll is always made
      // against one creature's AC (unlike a save or an area effect), and an
      // earlier version that let this be omitted opened a real citation
      // bypass -- see AttackRollRequest.against's doc comment.
      if (typeof rec.against !== "string" || !rec.against.trim()) {
        throw new Error(
          `${what} is an "attack" roll but has no "against" -- every attack roll must name the token id it's aimed at, ` +
            `even if the outcome is a miss. There is no such thing as an untargeted attack roll.`,
        );
      }
      const req: AttackRollRequest = {
        ...common,
        kind: "attack",
        against: asString(rec.against, `${what}.against`, 80),
      };
      if (rec.range !== undefined) req.range = asEnum(rec.range, `${what}.range`, ATTACK_RANGES);
      return req;
    }
    case "save": {
      if (typeof rec.dc !== "number") {
        throw new Error(`${what} is a "save" but has no numeric dc -- every saving throw must name the DC it's rolling against.`);
      }
      const save: SaveRollRequest = {
        ...common,
        kind: "save",
        dc: asInt(rec.dc, `${what}.dc`),
        ability: asEnum(rec.ability, `${what}.ability`, ABILITIES),
      };
      if (rec.damageOnFailure !== undefined) save.damageOnFailure = asSaveDamage(rec.damageOnFailure, `${what}.damageOnFailure`);
      return save;
    }
    case "check": {
      if (typeof rec.dc !== "number") {
        throw new Error(`${what} is a "check" but has no numeric dc -- every skill check must name the DC it's rolling against.`);
      }
      return { ...common, kind: "check", dc: asInt(rec.dc, `${what}.dc`), skill: asString(rec.skill, `${what}.skill`, 40) };
    }
    default:
      throw new Error(`${what}.kind is "${kind}", which is not a roll kind this engine knows. Use exactly one of: attack, save, check.`);
  }
}

/**
 * The single entry point: validate a raw model reply into a `DmTurn`, or
 * throw a message specific enough for the model's one `completeJson` retry
 * to actually fix. Every field is rebuilt as an explicit literal rather than
 * spread from the input record, on purpose -- that's what makes it
 * structurally impossible for a stray field the model invented (a `result`,
 * a `damageDealt`, anything shaped like a roll OUTCOME) to survive into the
 * value the rest of the app reads, even if the model's raw JSON contained one.
 *
 * `context.resolvedRolls` is the caller's job to populate from THIS turn's
 * resolved rolls (dm/dmTurn.ts passes `DmPromptArgs.resolvedRolls` straight
 * through, the same value the system prompt hands the model as fact) -- see
 * `requireResolvedRollForCombat` above for what it gates. Omitting it
 * defaults to empty, which is fail-closed: every "combat" reason'd
 * removeToken/moveToken gets rejected, never silently let through. Indexed
 * by id here into a `Map` once, up front, rather than re-scanned per action.
 * `spentRollIds` is one `Set` shared across every action in the turn (built
 * fresh per call, same pattern as `actionEconomies` below) so a resolvedRollId
 * cited by an earlier action in this turn is recognised as already spent
 * when a later action tries to cite it again.
 */
export function validateDmTurn(value: unknown, context: DmTurnContext = {}): DmTurn {
  const resolvedRolls = new Map<string, ResolvedRoll>();
  for (const roll of context.resolvedRolls ?? []) resolvedRolls.set(roll.id, roll);
  const spentRollIds = new Set<string>();
  // A non-object reply has nothing to accumulate errors ACROSS, so this one
  // still throws immediately; everything past it collects.
  const root = asRecord(value, "DM turn");
  const errors: string[] = [];
  const note = (e: unknown) => errors.push(e instanceof Error ? e.message : String(e));

  // contract v2, equipmentTypes.ts section 11.7 point 1: the turn ROOT is one
  // of the six sites EQUIPMENT_FORBIDDEN_WIRE_KEYS is checked against, so a
  // key like "loot" or "attunement" sitting directly on the top-level reply
  // (rather than nested inside an action or roll request) is caught too.
  // Accumulated like every other check here, not thrown immediately, so it
  // takes its place alongside whatever else is wrong with this turn rather
  // than spending the model's one repair attempt alone.
  try {
    rejectEquipmentKeys(root, "DM turn");
  } catch (e) {
    note(e);
  }

  let narration = "";
  try {
    narration = asString(root.narration, "narration", 4000);
  } catch (e) {
    note(e);
  }

  const actions: WorldAction[] = [];
  let rawActions: unknown[] = [];
  try {
    rawActions = asOptionalArray(root.actions, "actions");
  } catch (e) {
    note(e);
  }
  rawActions.forEach((a, i) => {
    try {
      actions.push(validateWorldAction(a, i, resolvedRolls, spentRollIds));
    } catch (e) {
      note(e);
    }
  });

  const turn: DmTurn = { narration, actions };

  if (root.rollRequests !== undefined) {
    // One shared map for the whole turn -- see requireActionEconomyForAttack
    // above -- so a repeated "by" id across entries is caught as the same
    // combatant spending a second action, not treated as two fresh economies.
    const actionEconomies = new Map<string, TurnEconomy>();
    const requests: RollRequest[] = [];
    let rawRequests: unknown[] = [];
    try {
      rawRequests = asArray(root.rollRequests, "rollRequests");
      // Checked on the RAW length, before a single entry is validated: an
      // over-long list is one problem with the turn, not sixty, and reporting
      // it sixty times would spend the model's one repair attempt on noise.
      // Same shape the memoryFacts cap below already uses.
      if (rawRequests.length > MAX_ROLL_REQUESTS) {
        throw new Error(
          `rollRequests has ${rawRequests.length} entries, at most ${MAX_ROLL_REQUESTS} per turn. ` +
            `One turn is one round: every creature in the scene gets one action, so a handful of rolls covers a busy ` +
            `round of combat. Ask for the rolls this moment actually needs and let the next turn ask for the next ones.`,
        );
      }
    } catch (e) {
      note(e);
      rawRequests = [];
    }
    rawRequests.forEach((r, i) => {
      try {
        const request = validateRollRequest(r, i);
        if (request.kind === "attack") {
          // Order matters for the message the model gets back: "there is no
          // such creature" is a more fundamental correction than "that
          // creature is standing too far away," and a swing from nowhere would
          // otherwise fall straight through checkAttackReach's fail-open.
          requireAttackerOnBoard(request, context.geometry, `rollRequests[${i}]`);
          requireActionEconomyForAttack(request.by, actionEconomies, `rollRequests[${i}]`);
          requireReachForAttack(request, context.geometry, `rollRequests[${i}]`);
        }
        requests.push(request);
      } catch (e) {
        note(e);
      }
    });
    turn.rollRequests = requests;
    try {
      requireUnansweredRolls(narration, requests);
    } catch (e) {
      note(e);
    }
  }
  if (root.menuHint !== undefined) {
    try {
      turn.menuHint = asArray(root.menuHint, "menuHint").map((h, i) => asString(h, `menuHint[${i}]`, 40));
    } catch (e) {
      note(e);
    }
  }
  if (root.memoryFacts !== undefined) {
    const facts: DmMemoryFact[] = [];
    let rawFacts: unknown[] = [];
    try {
      rawFacts = asArray(root.memoryFacts, "memoryFacts");
      if (rawFacts.length > MAX_MEMORY_FACTS) {
        throw new Error(
          `memoryFacts has ${rawFacts.length} entries, at most ${MAX_MEMORY_FACTS} per turn. ` +
            `Record only what genuinely has to survive the rest of the campaign; the rest is narration.`,
        );
      }
    } catch (e) {
      note(e);
      rawFacts = [];
    }
    rawFacts.forEach((f, i) => {
      try {
        facts.push(validateMemoryFact(f, `memoryFacts[${i}]`));
      } catch (e) {
        note(e);
      }
    });
    if (facts.length > 0) turn.memoryFacts = facts;
  }
  if (root.story !== undefined && root.story !== null) {
    try {
      turn.story = validateStoryUpdate(root.story);
    } catch (e) {
      note(e);
    }
  }

  // Batched, not fail-fast, and this is the whole point: `completeJson` gives
  // exactly ONE repair attempt, so a validator that reports the first problem
  // and stops sends a model that fixes it straight into the next rejection
  // with no retry left, and the player loses the credit. world/connectivity.ts's
  // validateLayout has always collected its errors this way; this matches it.
  if (errors.length === 1) throw new Error(errors[0]!);
  if (errors.length > 1) {
    throw new Error(`${errors.length} problems with this turn, fix ALL of them in your next reply:\n- ${errors.join("\n- ")}`);
  }

  return turn;
}
