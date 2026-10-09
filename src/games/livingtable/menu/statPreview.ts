/**
 * The Inventory tab's stat preview: what the character's numbers would be with a bagged piece worn (or a worn one taken off).
 *
 * Nothing here knows a rule. It copies the sheet, runs the engine's own staging (rules/inventory.ts: draftFromSheet, stageEquip,
 * stageUnequip, commitLoadout) on the copy, and reads the same readers the dice go through (session/combat.ts and
 * characters/equipment.ts) before and after. So a number on the preview is the number the roll will use once the piece is worn,
 * and a refusal is the engine's own sentence (the attunement cap, gear locked in a fight). The real sheet is never touched.
 *
 * Pure and import-pure: no DOM, nothing read at import time.
 */
import type { CharacterSheet } from "../characters/creation";
import { equipmentSaveBonus, legendaryRiderFor } from "../characters/equipment";
import { MAX_ATTUNED_ITEMS, type GearRole } from "../characters/equipmentTypes";
import { attackerBonusFor, effectiveArmorClass, effectiveSpeedFt, weaponDamageNotationFor } from "../session/combat";
import { attunedRoles, gearChangeBlockedReason } from "../rules/attunement";
import { commitLoadout, draftFromSheet, stageEquip, stageUnequip } from "../rules/inventory";

/** The numbers the Inventory tab's stat column shows. */
export interface StatBlock {
  /** Armour class, as the dice use it. */
  ac: number;
  /** The attack bonus of the weapon in hand. */
  toHit: number;
  /** The weapon's damage as dice notation ("1d8+3"), the item bonus included. */
  damage: string;
  /** The flat part of `damage` (the +3), so two blocks can be compared. */
  damageBonus: number;
  /** A legendary weapon's extra dice ("+1d6 radiant"), or null. */
  rider: string | null;
  /** The bonus every saving throw gets from gear. */
  saves: number;
  /** Walking speed in feet, after the armour penalty and any boots. */
  speedFt: number;
  /** How many attunement spots are in use. */
  attuned: number;
  /** The most there are (three). */
  attunedMax: number;
}

/** After minus before, for each number that can move. Damage is the flat part only; the rider shows as words. */
export interface StatDelta {
  ac: number;
  toHit: number;
  damage: number;
  saves: number;
  speedFt: number;
  attuned: number;
}

export type StatPreview =
  /** `next` is the copy of the sheet with the change made, for drawing the doll as it would look. */
  | { ok: true; before: StatBlock; after: StatBlock; delta: StatDelta; next: CharacterSheet }
  | { ok: false; reason: string };

/** The flat modifier at the end of a dice notation: "1d8+3" is 3, "1d6-1" is -1, "1d6" is 0. */
export function damageBonusOf(notation: string): number {
  const m = /([+-])\s*(\d+)\s*$/.exec(notation);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * Number(m[2]);
}

/** Every number of the stat column, read off the engine for this sheet. */
export function statsOf(sheet: CharacterSheet): StatBlock {
  const damage = weaponDamageNotationFor(sheet);
  const rider = legendaryRiderFor(sheet);
  return {
    ac: effectiveArmorClass(sheet),
    toHit: attackerBonusFor(sheet),
    damage,
    damageBonus: damageBonusOf(damage),
    rider: rider ? `+${rider.bonusDamage} ${rider.damageType}` : null,
    saves: equipmentSaveBonus(sheet),
    speedFt: effectiveSpeedFt(sheet),
    attuned: sheet.equipment ? attunedRoles(sheet.archetypeId, sheet.equipment).length : 0,
    attunedMax: MAX_ATTUNED_ITEMS,
  };
}

/** after minus before, number by number. */
export function deltaOf(before: StatBlock, after: StatBlock): StatDelta {
  return {
    ac: after.ac - before.ac,
    toHit: after.toHit - before.toHit,
    damage: after.damageBonus - before.damageBonus,
    saves: after.saves - before.saves,
    speedFt: after.speedFt - before.speedFt,
    attuned: after.attuned - before.attuned,
  };
}

/** Why gear may not change now, in the game's words, or null when it may. */
function gate(sheet: CharacterSheet, hostilesPresent: boolean): string | null {
  return gearChangeBlockedReason({ name: sheet.name, downed: !!sheet.downed, stable: !!sheet.stable, dead: !!sheet.dead }, hostilesPresent);
}

function compare(sheet: CharacterSheet, next: CharacterSheet): StatPreview {
  const before = statsOf(sheet);
  const after = statsOf(next);
  return { ok: true, before, after, delta: deltaOf(before, after), next };
}

/**
 * The numbers with the bag's cell `bagIndex` worn. The same staging the Equip button runs, on a copy: refused, with the engine's
 * reason, when the cell is empty, the attunement cap is full, gear cannot change right now (`hostilesPresent`, a downed hero) or the
 * game would not commit the change.
 */
export function previewEquip(sheet: CharacterSheet, bagIndex: number, opts: { hostilesPresent?: boolean } = {}): StatPreview {
  const blocked = gate(sheet, opts.hostilesPresent === true);
  if (blocked) return { ok: false, reason: blocked };
  const staged = stageEquip(sheet.archetypeId, draftFromSheet(sheet), bagIndex);
  if (!staged.ok) return { ok: false, reason: staged.reason };
  const next = commitLoadout(sheet, staged.draft);
  // commitLoadout hands back the same sheet when it refuses a draft.
  if (next === sheet) return { ok: false, reason: "The game would not allow that change." };
  return compare(sheet, next);
}

/** The numbers with the magic piece worn in `role` taken off (your own plain piece goes back on). */
export function previewTakeOff(sheet: CharacterSheet, role: GearRole, opts: { hostilesPresent?: boolean } = {}): StatPreview {
  const blocked = gate(sheet, opts.hostilesPresent === true);
  if (blocked) return { ok: false, reason: blocked };
  const staged = stageUnequip(sheet.archetypeId, draftFromSheet(sheet), role);
  if (!staged.ok) return { ok: false, reason: staged.reason };
  const next = commitLoadout(sheet, staged.draft);
  if (next === sheet) return { ok: false, reason: "The game would not allow that change." };
  return compare(sheet, next);
}

// ---- the words ---------------------------------------------------------------

/** "+2", "-1", "+0". Plain hyphen for a minus: no long dashes anywhere. */
export function signedNumber(n: number): string {
  return n >= 0 ? `+${n}` : `-${Math.abs(n)}`;
}

/** The change as words: "+2" or "-3", and nothing at all when the number does not move. */
export function deltaWords(n: number): string {
  return n === 0 ? "" : signedNumber(n);
}

/** Whether a change is for the better, for the worse or no change (the column colours it green, red or leaves it). */
export function deltaTone(n: number): "up" | "down" | "same" {
  return n > 0 ? "up" : n < 0 ? "down" : "same";
}
