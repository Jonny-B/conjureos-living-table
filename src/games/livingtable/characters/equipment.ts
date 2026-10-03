/**
 * THE EQUIPMENT REGISTRY: what a character is wearing, and what the ENGINE
 * says that is worth.
 *
 * `characters/equipmentTypes.ts` is the shared contract five lanes build
 * against: the slot table, the tier ladder, the sprite id grammar, the palette
 * remaps. It is types and frozen tables and nothing else. This file is the
 * half of the rules lane that reads a CharacterSheet: it turns "the Knight's
 * outer slot is at rare" into "+2 to Armor Class, unless SRD 5.1 says the
 * shield cannot be carried right now."
 *
 * THE LOAD-BEARING RULE, and the single reason this file is shaped the way it
 * is: the AI dungeon master never writes or runs code at play time and never
 * overrides a die roll. The engine owns every number. So there is no function
 * here that accepts a bonus, no field anywhere that stores one, and no path
 * from a string the model wrote to a number a d20 is compared against. What a
 * sheet stores is a TIER, which is a word from a four-item frozen list; the
 * bonus is looked up in `BONUS_BY_TIER` on every single read. A stored bonus
 * would be a number something other than that table could write, which is
 * exactly the door `AttackRollRequest` refusing to carry a `targetAC` keeps
 * shut one layer up.
 *
 * WHERE THE ARITHMETIC LIVES: in `rules/magicItems.ts`, which takes plain
 * numbers and knows nothing about a sheet, the same boundary `rules/combat.ts`
 * and `rules/maneuvers.ts` already keep. This file is the adapter between the
 * two, and `session/combat.ts` is where the result meets a d20.
 *
 * NOTHING HERE IS A PAID ACTION. Finding, equipping and swapping gear costs no
 * credit and calls no model, so no CostBadge belongs on any surface built from
 * these functions.
 *
 * Rules basis: SRD 5.1, CC BY 4.0.
 *
 * CONTRACT V2. Widened from three slots to six (`GEAR_ROLES`): ring, amulet
 * and boots join weapon, outer and crown. The three v1 roles keep their exact
 * shape and every function that only ever touched them (`slotsForArchetype`,
 * `slotDefinition`, `HAND_HELD_SLOTS`, `equipmentAttackBonus`) is unchanged.
 * What is new:
 *   - `equipmentOf` now defaults to `STARTING_LOADOUT` (boots common, ring and
 *     amulet empty) instead of `STARTING_EQUIPMENT`.
 *   - `tierInSlot` / `itemNameFor` widen to `GearRole` and can answer `null`
 *     for an empty ring or amulet slot -- the only two roles that can be.
 *   - `equipmentStatus` (the three drawn v1 roles) is now ATTUNEMENT-AWARE: a
 *     legendary weapon or an uncommon-or-better save-kind headgear piece is
 *     `active: false` with a reason when it is not one of the character's
 *     (at most three) attuned items, the same "refused, not silently short"
 *     treatment the shield-hand rule already gets.
 *   - `accessoryStatus` (new) is the equivalent reader for ring, amulet and
 *     boots, whose bonus comes from an `AccessoryEffect` rather than a
 *     `BonusKind`, and is exactly as attunement-aware.
 *   - `equipmentArmorBonus` / `equipmentSaveBonus` fold in a worn, active Ring
 *     of Protection's `protection` effect and a worn, active Stone of Good
 *     Luck's `luck` effect, each inside its own cap
 *     (`MAX_TOTAL_AC_BONUS` / `MAX_TOTAL_SAVE_BONUS`); `equipmentCheckBonus`
 *     (new) is `luck` alone, inside `MAX_TOTAL_CHECK_BONUS`. Boots' effects
 *     (advantage on a skill, a speed multiplier) do not touch any of these
 *     three: they are read straight off `accessoryStatus` by
 *     `session/combat.ts`'s `checkAdvantageFor` and `effectiveSpeedFt`.
 */
import type { AbilityScores } from "../rules/abilities";
import { attunedRoles, isRoleAttuned } from "../rules/attunement";
import {
  CHAIN_MAIL_STRENGTH,
  canCarryShield,
  heavyArmorSpeedPenalty,
  stackedArmorBonus,
} from "../rules/magicItems";
import type { Chassis } from "./templates";
import {
  ARCHETYPE_IDS,
  BONUS_BY_TIER,
  DRAWN_GEAR_ROLES,
  EQUIPMENT_TIERS,
  GEAR_ROLES,
  LAYER_OVERBODY,
  MAX_TOTAL_AC_BONUS,
  MAX_TOTAL_CHECK_BONUS,
  MAX_TOTAL_SAVE_BONUS,
  SHEET_ONLY_ROLES,
  SLOTS_BY_ARCHETYPE,
  SLOT_ROLES,
  STARTING_LOADOUT,
  TIER_NAME_INDEX,
  accessoryEffect,
  attunementNeededLine,
  gearItemExists,
  gearItemName,
  gearRequiresAttunement,
  type AccessoryEffect,
  type AccessoryRole,
  type ArchetypeId,
  type ArmorState,
  type BonusKind,
  type BonusSource,
  type Equipment,
  type EquipmentTier,
  type GearRole,
  type LegendaryRider,
  type SlotDefinition,
  type SlotRole,
} from "./equipmentTypes";

/**
 * The slice of a CharacterSheet this file reads, and no more.
 *
 * Declared structurally rather than as `CharacterSheet` for one concrete
 * reason: `CharacterSheet` does not carry `equipment` yet (that one-line
 * addition belongs to whoever owns creation.ts), and a real sheet is assignable
 * to this shape either way because every field here is one it already has or is
 * optional. When the field lands on CharacterSheet nothing in this file
 * changes.
 */
export interface EquippedSheet {
  archetypeId: string;
  chassis: Chassis;
  abilities: AbilityScores;
  equipment?: Equipment;
  /** "none" when the hero wears no armour and no shield. Absent reads as "class" (see `ArmorState`). */
  armor?: ArmorState;
}

// ── reading what is equipped ───────────────────────────────────────────

function isArchetypeId(id: string): id is ArchetypeId {
  return (ARCHETYPE_IDS as readonly string[]).includes(id);
}

function isEquipmentTier(tier: unknown): tier is EquipmentTier {
  return typeof tier === "string" && (EQUIPMENT_TIERS as readonly string[]).includes(tier);
}

function isSlotRole(role: unknown): role is SlotRole {
  return typeof role === "string" && (SLOT_ROLES as readonly string[]).includes(role);
}

function isGearRole(role: unknown): role is GearRole {
  return typeof role === "string" && (GEAR_ROLES as readonly string[]).includes(role);
}

/** Ring or amulet: the only two roles a normalised `Equipment` may hold no entry for at all. */
function isSheetOnlyRole(role: GearRole): boolean {
  return (SHEET_ONLY_ROLES as readonly string[]).includes(role);
}

/**
 * The three slots this archetype defines, or null for an archetype the table
 * has never heard of.
 *
 * Null rather than a throw, and null rather than a silent default, because the
 * one caller that can legitimately hit it is a sheet stored under an archetype
 * id that has since been renamed. A ninth archetype added without a slot entry
 * should render and fight with no gear at all, which is visibly wrong and
 * fixable, rather than crash a campaign someone is mid-way through.
 */
export function slotsForArchetype(archetypeId: string): Readonly<Record<SlotRole, SlotDefinition>> | null {
  return isArchetypeId(archetypeId) ? SLOTS_BY_ARCHETYPE[archetypeId] : null;
}

/** This archetype's definition for one v1 slot, or null when it has none. Only ever meaningful for weapon/outer/crown: ring, amulet and boots have no `SlotDefinition` at all (see `accessoryStatus` for their equivalent). */
export function slotDefinition(sheet: EquippedSheet, role: SlotRole): SlotDefinition | null {
  return slotsForArchetype(sheet.archetypeId)?.[role] ?? null;
}

/**
 * What this character has equipped, defaulted.
 *
 * Every read goes through here rather than touching `sheet.equipment`, so a
 * sheet written before equipment existed, or before contract v2, behaves
 * identically to a fresh one: weapon, outer, crown and boots common, ring and
 * amulet empty. That is the same load-boundary defaulting `hitDiceRemaining`
 * and `deathSaves` already get, and it is why no migration is needed for a
 * field riding in a free-form jsonb blob.
 */
export function equipmentOf(sheet: EquippedSheet): Equipment {
  return sheet.equipment ?? STARTING_LOADOUT;
}

/** True when this hero wears no armour and no shield (`sheet.armor` is "none"). Absent, or any other value, is the class's own armour. */
export function isUnarmored(sheet: Pick<EquippedSheet, "armor">): boolean {
  return sheet.armor === "none";
}

/**
 * True when `role` is an armour-kind slot (the Knight's shield and plate, a
 * Shadow's or wizard's cloak) that holds only the plain common piece AND the
 * hero wears no armour: nothing is worn there. A magic piece in such a slot is
 * a real worn item and makes this false. See `ArmorState` for why this is a
 * reading of the sheet and not an empty storage slot.
 */
export function slotIsBare(sheet: EquippedSheet, role: GearRole): boolean {
  if (!isUnarmored(sheet) || !isSlotRole(role)) return false;
  if (slotDefinition(sheet, role)?.bonusKind !== "armor") return false;
  const item = equipmentOf(sheet)[role];
  return !item || !isEquipmentTier(item.tier) || item.tier === "common";
}

/**
 * The tier in one of the six gear roles, or `null` for an empty ring or
 * amulet slot, or for an armour-kind slot a hero with no armour has nothing
 * worn in (`slotIsBare`). A drawn role (weapon, outer, crown, boots) that is
 * absent or holds something this engine does not recognise reads as "common"
 * (the +0 starting kit), never as empty: the token is always drawn wearing
 * something there, except for the bare armour slots of an unarmored hero.
 */
export function tierInSlot(sheet: EquippedSheet, role: GearRole): EquipmentTier | null {
  if (slotIsBare(sheet, role)) return null;
  const item = equipmentOf(sheet)[role];
  if (item && isEquipmentTier(item.tier)) return item.tier;
  return isSheetOnlyRole(role) ? null : "common";
}

/**
 * The player-facing name of what is in a role, at its current tier:
 * "Longsword" at common, "Dawnbreaker" at legendary, "Ring of Protection" for
 * a worn ring, `null` for an empty ring or amulet slot.
 *
 * Delegates to `gearItemName`, equipmentTypes.ts's own "THE ONE NAMER", for
 * all six roles rather than re-deriving the per-archetype lookup here: the
 * dice readout, the character sheet panel, the inventory screen and the DM's
 * own prompt all end up asking one function for a name, whichever file they
 * ask it through.
 */
export function itemNameFor(sheet: EquippedSheet, role: GearRole): string | null {
  if (!isArchetypeId(sheet.archetypeId)) return null;
  const tier = tierInSlot(sheet, role);
  if (tier === null) return null;
  return gearItemName(sheet.archetypeId, role, tier);
}

// ── SRD legality: what the engine refuses to let the fiction grant ─────
//
// Two conditions in SRD 5.1 stop a worn item from doing its job, and both are
// exactly the kind of thing a narrator would wave through: a shield needs a
// hand, and heavy armour needs the Strength to move in. The engine decides
// both, from the character's own numbers, every time the bonus is read. There
// is no cached "is this legal" flag, because a cached one goes stale the first
// time the character picks up a different weapon.
//
// Contract v2 adds a third gate, attunement, checked in `equipmentStatus` and
// `accessoryStatus` below rather than here: unlike the two SRD 5.1 legality
// rules, "is this one of your (at most three) attuned items" is not a fact
// about the weapon in hand, it is a fact about the WHOLE loadout at once
// (`rules/attunement.ts`'s `attunedRoles`), so it cannot be decided per-role
// in isolation the way a hand check can.

/**
 * WHICH SLOTS ARE GRIPPED IN A HAND. Explicit rules data, per archetype, and
 * the reason it is data rather than a derivation is the defect it replaces.
 *
 * The first version of this file answered the question with
 * `slot.layer === LAYER_OFFHAND`, which reads plausibly and is wrong: `layer`
 * is a DRAW BAND. LAYER_OFFHAND means "paint this in front of the torso and
 * behind the weapon arm", which is where a gripped kite shield goes and also
 * where a forearm-braced riot barrier goes. Inferring a rules fact ("this
 * occupies a hand") from a rendering fact ("this paints at 35") cost the
 * Trooper an entire slot: their kit's only weapon is a two-handed plasma
 * rifle, so `canCarryShield(2)` was false on every read of every Trooper sheet
 * that has ever existed, their outer slot could never pay out at any tier, and
 * the copy told them a hand was busy as though there were some other loadout
 * they could choose. There is not one. That is a permanently decorative third
 * of a Fighter's gear, on the one chassis the contract promises is mirrored
 * (the Knight and the Trooper are supposed to be equally strong).
 *
 * So the fact is stated, per archetype, and anchored to the one place in the
 * codebase that already records what a character actually carries:
 * `Archetype.loadoutInventory` in templates.ts, the exact list of the
 * `startingInventory` entries the three gear slots and the armour line name.
 * The Knight's reads ["Longsword", "Shield", "Chain mail"] -- an SRD shield,
 * "carried in one hand", so their Kite Shield is gripped and the SRD rule
 * governs it. The Trooper's reads ["Plasma rifle", "Combat vest"]: no shield,
 * no second weapon, nothing to grip. Their Riot Shield is a braced barrier
 * worn against the arm, which is the only reading consistent with a kit whose
 * only weapon takes both hands.
 *
 * The rules test asserts this table against `loadoutInventoryFor` on every
 * archetype, so it cannot drift away from what the kit says the character has.
 */
export const HAND_HELD_SLOTS: Readonly<Record<ArchetypeId, readonly SlotRole[]>> = Object.freeze({
  // SRD 5.1 shield, in the Knight's own inventory as "Shield".
  knight: Object.freeze(["outer"] as const),
  shadow: Object.freeze([] as const),
  healer: Object.freeze([] as const),
  "fireball-person": Object.freeze([] as const),
  // Riot Shield: braced, not gripped. See the note above.
  trooper: Object.freeze([] as const),
  infiltrator: Object.freeze([] as const),
  medic: Object.freeze([] as const),
  psion: Object.freeze([] as const),
});

/**
 * Whether this archetype's slot is gripped in a hand, and therefore subject to
 * SRD 5.1's "a shield is carried in one hand".
 *
 * False for an archetype the table has never heard of, which is the same
 * degrade-to-no-gear answer `slotsForArchetype` gives: a renamed archetype
 * mid-campaign should lose a rule, not gain a refusal nobody can explain.
 */
export function slotIsHandHeld(archetypeId: string, role: SlotRole): boolean {
  return isArchetypeId(archetypeId) ? HAND_HELD_SLOTS[archetypeId].includes(role) : false;
}

/** Whether a slot is the character's WORN BODY ARMOUR, which is what carries an SRD Strength requirement. Same derivation, same reason. */
export function slotIsWornArmor(slot: SlotDefinition): boolean {
  return slot.layer === LAYER_OVERBODY;
}

/**
 * The SRD armour-table Strength requirement for the armour a chassis wears,
 * or 0 for a chassis whose armour lists none.
 *
 * The source of truth for what each chassis wears is `ARMOR_BY_CHASSIS` in
 * creation.ts (fighter: chain mail, rogue: leather, cleric: chain shirt and
 * shield, wizard: unarmored), and it is private to that file. Restated here as
 * the one fact this feature needs, with a test that fails if creation.ts's own
 * `armorLabel` ever stops saying "chain mail" for a fighter, so the two cannot
 * drift silently. SRD 5.1 lists Str 13 for chain mail and no requirement at all
 * for leather or a chain shirt.
 */
export const ARMOR_STRENGTH_BY_CHASSIS: Readonly<Record<Chassis, number>> = Object.freeze({
  fighter: CHAIN_MAIL_STRENGTH,
  rogue: 0,
  cleric: 0,
  wizard: 0,
});

/**
 * The speed this character loses to armour they are not strong enough for.
 *
 * SRD 5.1: "the armor reduces the wearer's speed by 10 feet unless the wearer
 * has a Strength score equal to or higher than the listed score." Note what
 * this deliberately does NOT do: it does not block the equip and it does not
 * remove the armour's AC, because the SRD does neither. Being accurate matters
 * more than being strict, the same distinction `dcForRollRequest` draws when it
 * bounds a DM's DC rather than replacing it.
 *
 * Conditional on the archetype actually having a worn-armour slot, so this is a
 * property of a real piece of the loadout rather than a penalty floating free
 * of anything on screen. Unaffected by contract v2: boots' own speed effect
 * (Boots of Speed) is a MULTIPLIER applied on top of this penalty, in
 * `session/combat.ts`'s `effectiveSpeedFt`, never a second source of it.
 */
export function armorSpeedPenaltyFt(sheet: EquippedSheet): number {
  // No armour on the body, no armour Strength requirement to miss.
  if (isUnarmored(sheet)) return 0;
  const slots = slotsForArchetype(sheet.archetypeId);
  if (!slots) return 0;
  const wearsArmor = SLOT_ROLES.some((role) => slotIsWornArmor(slots[role]));
  if (!wearsArmor) return 0;
  return heavyArmorSpeedPenalty(sheet.abilities.str, ARMOR_STRENGTH_BY_CHASSIS[sheet.chassis] ?? 0);
}

/** Everything the engine needs from OUTSIDE this file to judge legality: how many hands the weapon in use takes, and what that weapon is called. session/combat.ts supplies both from `weaponFor`, which is the only module that knows what is in the character's hands. The name is here so a refusal can say which weapon is holding the hand rather than "the weapon", which is the difference between a sentence a player can act on and one they cannot. */
export interface EquipmentContext {
  weaponHands: number;
  weaponName: string;
}

/** One of the three v1 slots, resolved: what is in it, what it is worth right now, and why that is zero when it is. */
export interface SlotStatus {
  role: SlotRole;
  tier: EquipmentTier;
  definition: SlotDefinition;
  /** The item's player-facing name at this tier. */
  name: string;
  /** What `BONUS_BY_TIER` says this tier is worth. Present even when inactive, so a UI can show "+2 (not applied)". */
  bonus: number;
  bonusKind: BonusKind;
  /** False when SRD 5.1 says this item's bonus does not apply right now (no hand for it) or contract v2's attunement cap says it doesn't (not one of the character's three). `reason` says which. */
  active: boolean;
  reason?: string;
  /** True for an armour-kind slot with nothing worn in it (an unarmored hero's bare shield or armour slot). `name` is then the plain piece's name and is not worn; `bonus` is 0. */
  empty?: boolean;
}

/** An equipped item whose bonus SRD 5.1 (or the attunement cap) is currently refusing. Exactly the subset of `equipmentStatus` a UI should surface, so a player is told rather than silently shorted. */
export interface EquipmentIssue {
  role: SlotRole;
  name: string;
  reason: string;
}

/**
 * Resolve every one of the three v1 slots: three entries in SLOT_ROLES order,
 * always, so a caller can render three rows without a null check. Empty only
 * for an archetype with no slot table at all.
 *
 * Attunement-aware (contract v2): a legendary weapon or an uncommon-or-better
 * save-kind piece of headgear is only `active` when it is one of this
 * character's (at most three) attuned items, per `rules/attunement.ts`'s
 * `attunedRoles`. The hand-gate is still checked first and still wins when
 * both could apply, though the shipped data never actually puts both on the
 * same role: armour-kind slots (the only ones that can be hand-gated) never
 * require attunement at any tier.
 */
export function equipmentStatus(sheet: EquippedSheet, ctx: EquipmentContext): readonly SlotStatus[] {
  const slots = slotsForArchetype(sheet.archetypeId);
  if (!slots) return [];
  const attuned = isArchetypeId(sheet.archetypeId) ? attunedRoles(sheet.archetypeId, equipmentOf(sheet)) : [];

  return SLOT_ROLES.map((role) => {
    const definition = slots[role];
    if (slotIsBare(sheet, role)) {
      return {
        role,
        tier: "common",
        definition,
        name: definition.nameByTier[TIER_NAME_INDEX.common],
        bonus: 0,
        bonusKind: definition.bonusKind,
        active: false,
        reason: "You wear no armour, so nothing is worn here.",
        empty: true,
      } satisfies SlotStatus;
    }
    const tier = tierInSlot(sheet, role) ?? "common";
    const bonus = BONUS_BY_TIER[tier];
    const name = definition.nameByTier[TIER_NAME_INDEX[tier]];
    const status: SlotStatus = { role, tier, definition, name, bonus, bonusKind: definition.bonusKind, active: true };

    // SRD 5.1: a shield is carried in one hand. A two-handed weapon leaves no
    // hand to carry it in, so the AC does not apply. This is the one rule that
    // makes sword-and-board a build rather than a free +2, and it is checked
    // against the weapon actually in use rather than against the archetype, so
    // a character who switches range bands gets the right answer both times.
    //
    // The refusal names the weapon, because a refusal a player cannot act on is
    // worse than no refusal at all: "both hands are on the weapon" describes a
    // condition, and the player has to be able to see which condition. It fires
    // only for a GRIPPED slot (`HAND_HELD_SLOTS` above), never for a piece that
    // merely draws in front of the torso.
    if (slotIsHandHeld(sheet.archetypeId, role) && !canCarryShield(ctx.weaponHands)) {
      status.active = false;
      status.reason = `${name} is carried in one hand, and both hands are on the ${ctx.weaponName}.`;
      return status;
    }

    // Contract v2: a legendary weapon (its Flame Tongue-shape rider) and an
    // uncommon-or-better save-kind headgear piece (its Cloak of Protection
    // shape) both require attunement. Unattuned is not "off," it is
    // "refused, with a reason," the same treatment the shield rule gets.
    if (isArchetypeId(sheet.archetypeId) && gearRequiresAttunement(sheet.archetypeId, role, tier) && !attuned.includes(role)) {
      status.active = false;
      status.reason = attunementNeededLine(attuned.length);
    }

    return status;
  });
}

/** The v1 slots whose bonus is currently being refused, and why. Empty for a legal, fully-attuned loadout, which is the common case. */
export function equipmentIssues(sheet: EquippedSheet, ctx: EquipmentContext): readonly EquipmentIssue[] {
  return equipmentStatus(sheet, ctx)
    .filter((s) => !s.active && s.bonus > 0)
    .map((s) => ({ role: s.role, name: s.name, reason: s.reason ?? "" }));
}

// ── contract v2: ring, amulet and boots ─────────────────────────────────

/** The equivalent of `SlotStatus` for a role whose bonus comes from an `AccessoryEffect` rather than a `BonusKind`: ring, amulet and boots. */
export interface AccessoryStatus {
  role: AccessoryRole;
  /** null only for an empty ring or amulet slot. Boots is never null: it defaults to the common pair. */
  tier: EquipmentTier | null;
  /** null exactly when `tier` is null. */
  name: string | null;
  /** null for an empty slot or a common piece (which does nothing, per design). */
  effect: AccessoryEffect | null;
  requiresAttunement: boolean;
  /** Meaningless (false) unless `requiresAttunement` is true. */
  attuned: boolean;
  /** True when this item's effect currently applies: present, has an effect, and (needs no attunement, or is one of the character's attuned items). */
  active: boolean;
  reason?: string;
}

/**
 * Resolve one of ring, amulet or boots. Unlike `equipmentStatus`, this never
 * returns an empty array: boots always has something (at worst the common
 * pair), and even an empty ring or amulet slot is a real status worth
 * showing ("No ring worn."), not a row a caller has to special-case away.
 */
export function accessoryStatus(sheet: EquippedSheet, role: AccessoryRole): AccessoryStatus {
  const tier = tierInSlot(sheet, role);
  const name = tier === null ? null : itemNameFor(sheet, role);
  const effect = tier === null ? null : accessoryEffect(role, tier);
  const archetypeId = isArchetypeId(sheet.archetypeId) ? sheet.archetypeId : null;
  const requiresAttunement = tier !== null && archetypeId !== null && gearRequiresAttunement(archetypeId, role, tier);
  const attuned = requiresAttunement && archetypeId !== null ? isRoleAttuned(archetypeId, equipmentOf(sheet), role) : false;
  const active = effect !== null && (!requiresAttunement || attuned);
  const status: AccessoryStatus = { role, tier, name, effect, requiresAttunement, attuned, active };
  if (effect !== null && requiresAttunement && !attuned) {
    const inUse = archetypeId !== null ? attunedRoles(archetypeId, equipmentOf(sheet)).length : 0;
    status.reason = attunementNeededLine(inUse);
  }
  return status;
}

// ── the three numbers, derived on every read ───────────────────────────

/**
 * The context to use for a bonus kind that NO SRD rule gates on a free hand.
 *
 * A weapon is in hand by definition, and nothing worn on the head or the back
 * needs a hand to hold it, so neither the weapon bonus nor the save bonus can
 * ever be refused by the shield rule. This constant makes that assumption
 * explicit instead of letting two call sites quietly invent a number, and the
 * rules test checks the assumption directly: no `weapon`-kind or `save`-kind
 * slot in any of the eight sets appears in `HAND_HELD_SLOTS`. If one ever does,
 * that test fails rather than this constant silently granting it a free pass.
 */
const NO_HAND_GATE: EquipmentContext = Object.freeze({ weaponHands: 1, weaponName: "weapon" });

function bonusFor(sheet: EquippedSheet, kind: BonusKind, ctx: EquipmentContext): number[] {
  return equipmentStatus(sheet, ctx)
    .filter((s) => s.bonusKind === kind && s.active && s.bonus > 0)
    .map((s) => s.bonus);
}

/**
 * SRD "Weapon, +1/+2/+3": the bonus applies to both the attack roll and the
 * damage roll. Exactly one slot per archetype carries `bonusKind: "weapon"`
 * (an invariant the rules test asserts over all eight sets), so this can never
 * stack with itself no matter what a loadout looks like.
 *
 * A weapon is always in hand by definition, so no context is needed and none is
 * taken: passing one would invite a caller to gate the attack bonus on
 * something, and there is nothing legitimate to gate it on.
 */
export function equipmentAttackBonus(sheet: EquippedSheet): number {
  return bonusFor(sheet, "weapon", NO_HAND_GATE).reduce((sum, b) => sum + b, 0);
}

/** The magnitude of an active accessory effect of a given kind, worn in `role`, or 0. A helper rather than a public reader: callers that need the ring or amulet's own detail go through `accessoryStatus` directly. */
function activeAccessoryAmount(sheet: EquippedSheet, role: AccessoryRole, kind: "protection" | "luck"): number {
  const status = accessoryStatus(sheet, role);
  if (!status.active || !status.effect || status.effect.kind !== kind) return 0;
  return status.effect.amount;
}

/**
 * SRD "Armor, +1/+2/+3" and "Shield, +1/+2/+3", summed over every ACTIVE
 * armour-kind v1 slot, PLUS a worn, active Ring of Protection's `protection`
 * amount (SRD: "+1 bonus to AC"), all bounded by MAX_TOTAL_AC_BONUS.
 *
 * The Fighter chassis is the only one with two v1 armour slots (the owner's
 * Knight example is sword, shield, armour), so it was the only one the cap
 * could bind on before contract v2; a Ring of Protection now gives every
 * chassis a second source to stack against the same ceiling. The cap is
 * applied in `rules/magicItems.ts`, in one function, on purpose.
 */
export function equipmentArmorBonus(sheet: EquippedSheet, ctx: EquipmentContext): number {
  const bonuses = [...bonusFor(sheet, "armor", ctx)];
  const ring = activeAccessoryAmount(sheet, "ring", "protection");
  if (ring > 0) bonuses.push(ring);
  return stackedArmorBonus(bonuses, MAX_TOTAL_AC_BONUS);
}

/**
 * SRD "Cloak of Protection" shape, narrowed to saves only, over the v1
 * save-kind slot; PLUS a worn, active Ring of Protection's `protection`
 * amount and a worn, active Stone of Good Luck's `luck` amount (both also
 * read "+1 bonus to ... saving throws" in the SRD). Summed and bounded by
 * MAX_TOTAL_SAVE_BONUS, contract v2's new save cap: before it, exactly one
 * slot could ever add to a save, so nothing needed one.
 *
 * No context: nothing worn on the head, the back, the finger or the neck is
 * gated on a free hand.
 */
export function equipmentSaveBonus(sheet: EquippedSheet): number {
  const bonuses = [...bonusFor(sheet, "save", NO_HAND_GATE)];
  const ring = activeAccessoryAmount(sheet, "ring", "protection");
  if (ring > 0) bonuses.push(ring);
  const amulet = activeAccessoryAmount(sheet, "amulet", "luck");
  if (amulet > 0) bonuses.push(amulet);
  return stackedArmorBonus(bonuses, MAX_TOTAL_SAVE_BONUS);
}

/**
 * A worn, active Stone of Good Luck's `luck` amount (SRD: "+1 bonus to
 * ability checks"), bounded by MAX_TOTAL_CHECK_BONUS. Contract v2's other new
 * cap: only one item in the whole tier ladder can ever contribute here, so
 * the cap can never actually bind against the shipped tables, but it exists
 * for the same reason `MAX_TOTAL_AC_BONUS` does -- a ceiling that happens not
 * to be reachable yet is still the honest one to state, and the rules test
 * asserts it binds if asked to.
 */
export function equipmentCheckBonus(sheet: EquippedSheet): number {
  return stackedArmorBonus([activeAccessoryAmount(sheet, "amulet", "luck")], MAX_TOTAL_CHECK_BONUS);
}

/**
 * The legendary weapon's rider, or null.
 *
 * Only at tier "legendary", only from the archetype's own frozen slot
 * definition, and only when that legendary weapon is one of the character's
 * attuned items (contract v2: Flame Tongue requires attunement, and this
 * game's legendary weapon rung carries its shape). There is no argument by
 * which a caller can supply one, which is the point: a rider is extra damage
 * dice, dice are numbers, and numbers are the engine's.
 */
export function legendaryRiderFor(sheet: EquippedSheet): LegendaryRider | null {
  const slots = slotsForArchetype(sheet.archetypeId);
  if (!slots || !isArchetypeId(sheet.archetypeId)) return null;
  const attuned = attunedRoles(sheet.archetypeId, equipmentOf(sheet));
  for (const role of SLOT_ROLES) {
    const slot = slots[role];
    if (slot.bonusKind !== "weapon") continue;
    if (tierInSlot(sheet, role) !== "legendary") return null;
    if (gearRequiresAttunement(sheet.archetypeId, role, "legendary") && !attuned.includes(role)) return null;
    return slot.legendaryRider ?? null;
  }
  return null;
}

// ── naming the source, so a player can see WHY they hit ────────────────

/**
 * One AC or save contribution, tagged with the GEAR_ROLES position it
 * occupies -- the order the contract's cap-spending rule walks -- so
 * `equipmentBonusSources` can sort a v1 slot and a ring or amulet effect into
 * one list without caring which table either one came from.
 */
interface RankedSource {
  role: GearRole;
  label: string;
  amount: number;
}

function rankedAccessorySources(sheet: EquippedSheet, kind: "armor" | "save"): RankedSource[] {
  const out: RankedSource[] = [];
  const ring = accessoryStatus(sheet, "ring");
  if (ring.active && ring.effect?.kind === "protection" && ring.name) {
    out.push({ role: "ring", label: ring.name, amount: ring.effect.amount });
  }
  if (kind === "save") {
    const amulet = accessoryStatus(sheet, "amulet");
    if (amulet.active && amulet.effect?.kind === "luck" && amulet.name) {
      out.push({ role: "amulet", label: amulet.name, amount: amulet.effect.amount });
    }
  }
  return out;
}

/**
 * The gear lines of a dice readout, for one bonus kind: one `BonusSource` per
 * source that is actually contributing, named by the item rather than by the
 * slot.
 *
 * Only ACTIVE, nonzero sources appear, because the contract's one hard rule
 * for this shape is that the amounts must sum to the modifier that was
 * rolled. A refused shield (or an unattuned ring) printed as "+3 Aegis
 * Unbroken" next to a total that does not include it is a readout that lies,
 * which is worse than no breakdown at all; the refusal is surfaced through
 * `equipmentIssues` / `accessoryStatus.reason` instead, where it can carry
 * its reason.
 */
export function equipmentBonusSources(sheet: EquippedSheet, kind: BonusKind, ctx: EquipmentContext): readonly BonusSource[] {
  const v1: RankedSource[] = equipmentStatus(sheet, ctx)
    .filter((s) => s.bonusKind === kind && s.active && s.bonus > 0)
    .map((s) => ({ role: s.role, label: s.name, amount: s.bonus }));

  if (kind !== "armor" && kind !== "save") return v1.map(({ label, amount }) => ({ label, amount }));

  const all = [...v1, ...rankedAccessorySources(sheet, kind)].sort(
    (a, b) => GEAR_ROLES.indexOf(a.role) - GEAR_ROLES.indexOf(b.role),
  );

  // The AC and save caps are the one place a per-role amount can add up to
  // more than the total the engine actually applies (a Fighter in legendary
  // plate with a legendary shield and a Ring of Protection is +7 AC on paper
  // and +3 in play). Printing every one of those beside a total that only
  // moved by three is precisely the readout that lies, so the cap is spent in
  // GEAR_ROLES order and a source with nothing left to claim drops out of the
  // list rather than claiming a number the engine did not grant.
  const cap = kind === "armor" ? MAX_TOTAL_AC_BONUS : MAX_TOTAL_SAVE_BONUS;
  let remaining = stackedArmorBonus(all.map((s) => s.amount), cap);
  const sources: BonusSource[] = [];
  for (const source of all) {
    const amount = Math.min(source.amount, remaining);
    if (amount <= 0) break;
    sources.push({ label: source.label, amount });
    remaining -= amount;
  }
  return sources;
}

// ── changing what is equipped ──────────────────────────────────────────

/** Whether an item may go in a role at all, with the refusal in words a UI can show. */
export interface EquipCheck {
  ok: boolean;
  reason?: string;
}

/**
 * The equip gate, widened to all six GearRoles.
 *
 * What it refuses is deliberately narrow, and the reason is worth stating
 * plainly rather than padding this out: across the eight sets this game ships
 * there is no case where SRD 5.1 forbids DONNING a piece of gear. The SRD's two
 * relevant rules both bite at use time instead (a shield you have no hand for
 * grants no AC; armour you lack the Strength for costs speed), and both are
 * enforced in `equipmentStatus` and `armorSpeedPenaltyFt` above, every read.
 * Inventing a ban the ruleset does not contain would be exactly the kind of
 * house rule this engine is supposed to refuse. Attunement is likewise not a
 * DONNING ban: an unattuned piece can be worn, it just does nothing until it
 * is one of the three (`equipmentStatus` / `accessoryStatus` again).
 *
 * So this gate holds the DATA-INTEGRITY refusals that are real: a slot the
 * archetype does not have, a tier that is not on the ladder, and (contract
 * v2) a role/tier pair with no item on it at all -- the two empty rungs, or a
 * role this table has never heard of. Every one is reachable from a stored
 * blob written by an older build or a bad hand edit, and letting any through
 * would put an unnamed item on a character sheet.
 */
export function canEquip(sheet: EquippedSheet, role: GearRole, tier: EquipmentTier): EquipCheck {
  if (!isEquipmentTier(tier)) return { ok: false, reason: `"${String(tier)}" is not one of the four item tiers` };
  if (isSlotRole(role)) {
    if (!slotDefinition(sheet, role)) return { ok: false, reason: `this character has no ${role} slot` };
    return { ok: true };
  }
  if (!isGearRole(role)) return { ok: false, reason: `"${String(role)}" is not a gear role` };
  if (!isArchetypeId(sheet.archetypeId) || !gearItemExists(sheet.archetypeId, role, tier)) {
    return { ok: false, reason: `there is no ${tier} item for the ${role} slot` };
  }
  return { ok: true };
}

/**
 * Put an item in a role. Pure: returns a new Equipment, like everything else
 * that touches a character.
 *
 * Takes an `Equipment` rather than a sheet so the caller decides what to do
 * with the result (write it to the sheet, preview it, diff two loadouts), and
 * so this cannot be mistaken for something that mutates a character. Note again
 * what it does not take: a bonus, a name, an asset id. A role and a tier are
 * the whole payload.
 *
 * Low-level and role/tier-only, on purpose: it does not know about the bag,
 * so it is right for writing a v1-style slot directly (still exactly what
 * `characters/creation.ts` and the v1 rules test do) but it is NOT the
 * inventory screen's equip path. `rules/inventory.ts`'s `stageEquip` is that
 * path -- it also moves the outgoing piece into the bag and enforces the
 * attunement cap, neither of which belongs in a function this small.
 */
export function equipSlot(equipment: Equipment, role: GearRole, tier: EquipmentTier): Equipment {
  if (!isGearRole(role) || !isEquipmentTier(tier)) return equipment;
  return { ...equipment, [role]: { slot: role, tier } };
}

/**
 * The load boundary: turn whatever came back out of `game_characters.stats`
 * into an Equipment this engine will answer for.
 *
 * The trust model for that blob is the client's own prior write (migration
 * 116's own comment: "the server stores what the client already validated"),
 * so this is not adversarial-input hardening. It is the same defaulting
 * `normalizeSheet` does for every other field that predates its own feature,
 * plus one thing that is worth doing anyway: an unrecognised tier resolves to
 * "common", never to a bonus. If this file cannot recognise a value, the safe
 * answer is the +0 starting kit, and the unsafe answer is anything else.
 *
 * CONTRACT V2: six roles. Weapon, outer, crown and boots (the four "drawn"
 * roles) always come back with an entry, defaulted to common exactly as
 * before -- a v1 blob's absent `boots` key resolves to common the same way an
 * absent `weapon` key always has, and so does a `boots` key naming a tier
 * with no item on it (boots has no legendary rung; weapon, outer and crown
 * never hit this case, since every archetype's set names all four tiers).
 * Ring and amulet come back with an entry ONLY when the stored value names a
 * real item at a MAGIC tier: an absent key, a tier of "common" (which no ring
 * or amulet ever is), or a tier this table has no item for (the two
 * intentionally empty rungs) all resolve to no entry at all, i.e. the slot
 * reads as empty. A v1 three-key blob therefore loads as `STARTING_LOADOUT`
 * plus its own weapon/outer/crown tiers: boots common, ring and amulet empty,
 * not one v1 number moved.
 */
export function normalizeEquipment(value: unknown): Equipment {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out: Equipment = {};

  for (const role of DRAWN_GEAR_ROLES) {
    const item = rec[role];
    const tier = item && typeof item === "object" ? (item as Record<string, unknown>).tier : undefined;
    // weapon/outer/crown exist at every one of the four tiers for every
    // archetype (a rules-test invariant), so `isEquipmentTier` alone is
    // enough to trust for them; `gearItemExists`'s own archetype argument is
    // ignored for `boots` (its items are shared per template, exactly like
    // ring and amulet), so passing ARCHETYPE_IDS[0] is safe for every role
    // here and keeps this one loop uniform rather than special-casing boots.
    out[role] = {
      slot: role,
      tier: isEquipmentTier(tier) && gearItemExists(ARCHETYPE_IDS[0]!, role, tier) ? tier : "common",
    };
  }

  for (const role of SHEET_ONLY_ROLES) {
    const item = rec[role];
    const tier = item && typeof item === "object" ? (item as Record<string, unknown>).tier : undefined;
    // gearItemExists's SlotRole branch is never taken for ring/amulet, so the
    // archetype argument is inert here; any valid id works and every id in
    // ARCHETYPE_IDS is valid, so this stays a pure function of `value` alone,
    // matching `NormalizeEquipmentFn`'s signature in equipmentTypes.ts.
    if (isEquipmentTier(tier) && tier !== "common" && gearItemExists(ARCHETYPE_IDS[0]!, role, tier)) {
      out[role] = { slot: role, tier };
    }
  }

  return out;
}
