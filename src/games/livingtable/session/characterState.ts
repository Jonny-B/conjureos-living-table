/**
 * Round-tripping a CharacterSheet (characters/creation.ts) through
 * `game_characters.stats`, the free-form jsonb bag games-db stores and
 * never interprets (see migration 116's own comment: "the server stores
 * what the client already validated, it does not re-run combat math").
 *
 * DESIGN.md doesn't say where "the party's current cell" should live across
 * sessions. This integration pass's choice, stated here once rather than
 * scattered across call sites: store it as `position` alongside the sheet's
 * own fields inside that same `stats` blob, updated via ltCharacterUpdate
 * whenever it changes. A character's stat block and its map position are
 * two different kinds of fact, but they share the same lifecycle (both are
 * "whatever this character's state is right now") and the same persistence
 * path, so one write covers both without a second table or column.
 */
import { normalizeItemCharges, normalizeLootLedger, type CharacterSheet } from "../characters/creation";
import { normalizeEquipment } from "../characters/equipment";
import { addCondition, expandConditions, normalizeConditions, removeCondition, type Condition, type ConditionSet } from "../rules/conditions";
import { normalizeBag } from "../rules/inventory";
import { superiorityDiceMaxFor } from "./combat";
import type { Position } from "../types";

export interface CharacterState {
  sheet: CharacterSheet;
  position: Position;
  /**
   * The SRD conditions currently on this character (rules/conditions.ts).
   *
   * Here rather than on CharacterSheet on purpose. A sheet is what the
   * character IS -- their scores, their kit, their choices -- and survives
   * every scene unchanged; a condition is what is happening to them right
   * now and is expected to come and go several times in one fight. They
   * share this blob because they share a lifecycle (both are "this
   * character's state as of this write") and one ltCharacterUpdate covers
   * both, exactly the reasoning `position` is already here for.
   *
   * Optional so that a `{ sheet, position }` literal written before this
   * field existed still type-checks; `activeConditionsFor` treats absent as
   * empty. Never read this field directly for anything the DM or the UI will
   * see -- use `activeConditionsFor`, which also derives the conditions the
   * SRD says a character's own vitals put them in.
   */
  conditions?: Condition[];
  /**
   * Battle Master superiority dice left in the pool (rules/maneuvers.ts).
   * Same reasoning as `conditions` for why it lives here and why it is
   * optional: it is a spendable resource that changes mid-fight, not a fact
   * about the character. Absent means "the pool has not been spent from
   * since this character last rested," which `superiorityDiceFor` resolves
   * to the full pool for their level and subclass.
   */
  superiorityDice?: number;
  /**
   * A written campaign's story state (campaign/types.ts's StoryState), kept
   * here as the app's own prior write and coerced against the module by
   * campaign/engine.ts's `coerceStoryState` whenever it is read.
   *
   * It is campaign state, not character state, and it lives here for the
   * reason `position` does: it shares this blob's persistence path, and
   * games-db stores what the client computed without a second table. A new
   * character rolled into the same campaign inherits it (LivingTable.tsx's
   * PlayScreen picks it up from the campaign's other characters), so a death
   * never rewinds the story. Absent on a campaign the AI planned.
   */
  story?: unknown;
}

const DEFAULT_POSITION: Position = { cx: 0, cy: 0 };

function isPosition(v: unknown): v is Position {
  if (!v || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.cx === "number" && typeof rec.cy === "number";
}

/** Pull a CharacterSheet + Position + live per-scene state back out of whatever ltCampaignGet handed back as a character row's `stats`. Trusts the shape (it's the client's own prior write, not adversarial input, the same trust model migration 116 already documents for this table). */
export function characterStateFromStats(stats: unknown): CharacterState {
  const rec = (stats && typeof stats === "object" ? stats : {}) as Record<string, unknown> & { position?: unknown };
  // `conditions` and `superiorityDice` are pulled out of the rest explicitly,
  // the same way `position` already is: everything left over is cast to the
  // sheet, so a field that is NOT a sheet field must be named here or it ends
  // up masquerading as one.
  const { position, conditions, superiorityDice, story, ...sheetFields } = rec;
  // `equipment`, `bag`, `itemCharges` and `lootLedger` are all sheet fields,
  // so they stay in `sheetFields` and ride back out through
  // `statsFromCharacterState` with everything else. What they need here is
  // the same load-boundary defaulting `characters/creation.ts`'s
  // `normalizeSheet` gives every field that predates its own feature: a
  // campaign saved before equipment (or before contract v2's four new
  // fields) existed comes back with the drawn slots at common, which is +0
  // and changes no number on the sheet, ring/amulet empty, an empty bag,
  // every item at full charges and an empty loot ledger. An unrecognised
  // tier resolves to common as well, never to a bonus, because the safe
  // answer to "this engine does not know what that is" is the starting kit.
  const equipment = normalizeEquipment(sheetFields.equipment);
  const sheet = {
    ...sheetFields,
    equipment,
    bag: normalizeBag(sheetFields.bag, typeof sheetFields.archetypeId === "string" ? sheetFields.archetypeId : "", equipment),
    itemCharges: normalizeItemCharges(sheetFields.itemCharges),
    lootLedger: normalizeLootLedger(sheetFields.lootLedger),
  } as unknown as CharacterSheet;
  const state: CharacterState = {
    sheet,
    position: isPosition(position) ? position : DEFAULT_POSITION,
    conditions: normalizeConditions(conditions),
  };
  if (typeof superiorityDice === "number" && Number.isFinite(superiorityDice)) {
    state.superiorityDice = Math.max(0, Math.floor(superiorityDice));
  }
  if (story && typeof story === "object") state.story = story;
  return state;
}

/** The `stats` blob to send to ltCharacterCreate / ltCharacterUpdate: the sheet's own fields plus everything above, flattened into one object. */
export function statsFromCharacterState(state: CharacterState): Record<string, unknown> {
  const stats: Record<string, unknown> = {
    ...(state.sheet as unknown as Record<string, unknown>),
    position: state.position,
    conditions: state.conditions ?? [],
  };
  if (state.superiorityDice !== undefined) stats.superiorityDice = state.superiorityDice;
  if (state.story !== undefined) stats.story = state.story;
  return stats;
}

// ── conditions ─────────────────────────────────────────────────────────
//
// The gap this closes: `buildDmCharacterView(sheet, characterId)` was called
// without its third argument at the one call site that exists, so the DM's
// system prompt read "Active conditions: (none)" on every turn of every
// campaign -- including the turn after the player hit 0 HP and the screen
// said "You are down." A DM that cannot be told the party is unconscious
// cannot narrate around it, cannot have a monster ignore a body on the floor,
// and cannot describe someone dragging them clear. Two things were missing:
// somewhere to keep a condition (above), and the derivation below.

/**
 * The conditions the character's own vitals put them in, per SRD 5.1,
 * regardless of what anybody applied by hand.
 *
 * A character at 0 hit points and dying "is unconscious" (SRD, "Dropping to
 * 0 Hit Points"), and an unconscious creature drops prone and is
 * incapacitated (rules/conditions.ts applies those implications). A STABLE
 * character is still at 0 HP and still unconscious -- stabilising stops the
 * death saves, it does not wake anyone up -- so it derives the same set.
 * A dead character derives nothing: death is not a condition in the SRD's
 * condition list, and the sheet's own `dead` flag is what the UI reads.
 */
function derivedConditions(sheet: CharacterSheet): Condition[] {
  if (sheet.dead) return [];
  return sheet.downed || sheet.stable ? ["unconscious"] : [];
}

/**
 * Everything wrong with this character right now: what was applied to them,
 * plus what their vitals imply, plus the SRD implications of both. This is
 * the value `buildDmCharacterView`'s third argument wants, and the only one
 * any caller should be handing it.
 */
export function activeConditionsFor(state: CharacterState): Condition[] {
  return expandConditions([...(state.conditions ?? []), ...derivedConditions(state.sheet)]);
}

/** Apply one or more conditions to a character. Pure: returns a new state, like everything else that touches a sheet. */
export function applyConditions(state: CharacterState, ...conditions: Condition[]): CharacterState {
  return { ...state, conditions: addCondition(state.conditions ?? [], ...conditions) };
}

/**
 * Clear one or more conditions. A condition that `activeConditionsFor`
 * DERIVES from the sheet's vitals cannot be cleared this way and shouldn't
 * be: a downed character stops being unconscious by getting hit points back,
 * not by having the label removed.
 */
export function clearConditions(state: CharacterState, ...conditions: Condition[]): CharacterState {
  return { ...state, conditions: removeCondition(state.conditions ?? [], ...conditions) };
}

/** Whether this character currently has a given condition, derived ones included. */
export function characterHasCondition(state: CharacterState, condition: Condition): boolean {
  return activeConditionsFor(state).includes(condition);
}

/** Re-export so a caller that already imports from this module doesn't need a second import just to type a set. */
export type { Condition, ConditionSet };

// ── the Battle Master's superiority dice ───────────────────────────────
//
// The pool the level-3 choice promised and nothing held. Kept here rather
// than on the sheet for the same reason `conditions` is: it is a resource
// that empties over a fight and refills on a rest, not a fact about who the
// character is. Absent resolves to full, so a Battle Master who levelled up
// before this field existed walks into their next fight with four dice
// rather than with zero.

/** How many superiority dice this character has left right now. */
export function superiorityDiceFor(state: CharacterState): number {
  const max = superiorityDiceMaxFor(state.sheet);
  if (state.superiorityDice === undefined) return max;
  return Math.max(0, Math.min(max, state.superiorityDice));
}

/**
 * Spend one superiority die, or return null when there is none to spend --
 * an empty pool is a real "you cannot do that right now", not something to
 * paper over by letting the count go negative. The caller renders the
 * maneuver button disabled off `superiorityDiceFor` and uses this as the
 * second gate, the same two-layer shape `spendActiveAction` already uses for
 * the action economy.
 */
export function spendSuperiorityDie(state: CharacterState): CharacterState | null {
  const left = superiorityDiceFor(state);
  if (left <= 0) return null;
  return { ...state, superiorityDice: left - 1 };
}

/** SRD 5.1: "You regain all of your expended superiority dice when you finish a short or long rest." Both rests call this; there is no half-recovery case. */
export function restoreSuperiorityDice(state: CharacterState): CharacterState {
  return { ...state, superiorityDice: superiorityDiceMaxFor(state.sheet) };
}
