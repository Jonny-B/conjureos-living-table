/**
 * What the player is told about the three things their character is wearing.
 *
 * `characters/equipmentTypes.ts` is the contract: which slots exist, what each
 * one is called at each rarity, what a tier is worth, and the cap on stacked
 * AC. This module is the layer above it, and it owns exactly two jobs:
 *
 *   1. DERIVE the numbers a screen has to show from that table, never from a
 *      number stored on the sheet. `EquippedItem` carries `{slot, tier}` and
 *      nothing else on purpose: a stored bonus is a number something other
 *      than `BONUS_BY_TIER` could write, and the whole point of this feature
 *      is that the engine owns every number equipment contributes.
 *   2. TURN THAT INTO COPY that states the real effect. The rule every string
 *      here is held to is the one two cold readers broke the creation screen
 *      on: state the number and what it does to a roll, or say plainly that
 *      the piece does nothing. Never a present-tense effect with neither.
 *      They made four build decisions off flavour-only copy and got zero
 *      right, twice picking the option whose copy sounded best over the one
 *      the engine actually read.
 *
 * NOTHING HERE COSTS A CREDIT. Equipping, swapping and reading the sheet call
 * no model and spend nothing, so no surface built from this module carries a
 * CostBadge. Combat, movement, search, items, resting, levelling and gear are
 * free forever (DESIGN.md, "Cost model").
 *
 * WHERE THE NUMBERS COME FROM, settled at integration: nowhere in this file.
 * Every bonus, every cap and every AC on this screen is read out of
 * `characters/equipment.ts` and `session/combat.ts`, which is the same engine
 * the d20 is resolved against. This module briefly carried its own fold of
 * those formulas, written while the rules lane was still in flight, and the
 * two implementations disagreed the moment SRD legality landed: the engine
 * refuses a shield to a character with both hands on their weapon, and the
 * local fold did not, so a Trooper's play screen and their actual AC were two
 * different numbers. That is the exact defect `defenderACForRollRequest`
 * exists to end, so the fold is gone and the re-exports below are the only
 * path. If a number on this screen is ever wrong again, it is wrong in the
 * engine and it is wrong in the dice too, which is the whole point.
 */
import { ARMOR_INCLUDES_SHIELD, classArmorFor, type CharacterSheet } from "../characters/creation";
import { loadoutInventoryFor } from "../characters/templates";
import {
  accessoryStatus,
  equipmentAttackBonus,
  equipmentOf,
  equipmentSaveBonus,
  isUnarmored,
  itemNameFor,
  normalizeEquipment,
  slotIsBare,
  slotIsWornArmor,
  slotsForArchetype,
  tierInSlot,
} from "../characters/equipment";
import {
  effectiveArmorClass,
  equipmentIssuesFor,
  speedBeforeBootsFt,
  equipmentStatusFor,
  weaponIdentityFor,
} from "../session/combat";
import {
  ACCESSORY_SLOT_WORD,
  ARCHETYPE_KEY,
  BONUS_BY_TIER,
  EQUIPMENT_TIERS,
  GLOW_BANDS_BY_TIER,
  GLOW_PULSES_BY_TIER,
  LAYER_FEET,
  LAYER_HEAD,
  MAX_TOTAL_AC_BONUS,
  MAX_TOTAL_SAVE_BONUS,
  RECOLOUR_BY_TIER,
  SLOT_ROLES,
  TIER_NAME_INDEX,
  UNARMORED_LABEL,
  attunedCounter as attunedCounterCopy,
  accessoryEffect,
  bodySpriteId,
  bootsSpriteId,
  equipmentSpriteId,
  gearItemExists,
  tierArtVariant,
  type AccessoryRole,
  type ArchetypeId,
  type BonusKind,
  type EquipmentLayerPlan,
  type EquipmentTier,
  type GearRole,
  type SlotDefinition,
  type SlotRole,
  type TokenRenderPlan,
  type TokenRenderPlans,
} from "../characters/equipmentTypes";
import { attunedRoles } from "../rules/attunement";
import { draftFromSheet } from "../rules/inventory";
import { ABILITY_NAME } from "./labels";

// The engine's readers, re-exported under the names every call site on this
// screen already uses. Re-exported rather than wrapped so there is no second
// function body that could drift from the one the dice go through.
export { effectiveArmorClass, equipmentIssuesFor, equipmentStatusFor };
export { equipmentAttackBonus, equipmentOf, equipmentSaveBonus, itemNameFor, tierInSlot };

// ── reading the sheet ───────────────────────────────────────────────────

/** True when this id is one of the eight archetypes the equipment table covers. `ARCHETYPE_KEY` is the enumeration, so a ninth archetype can never silently miss a set. */
function isArchetypeId(id: string): id is ArchetypeId {
  return Object.prototype.hasOwnProperty.call(ARCHETYPE_KEY, id);
}

/** The three slot definitions for an archetype id, or null for one the table does not cover. The engine's lookup, so a ninth archetype is unknown to both at once. */
function slotsOf(archetypeId: string): Readonly<Record<SlotRole, SlotDefinition>> | null {
  return slotsForArchetype(archetypeId);
}

/**
 * The three slot definitions for this character, or null for an archetype the
 * table does not cover. Null is rendered as no gear section at all, never as
 * an apology: a row that cannot say something true is not rendered.
 */
export function slotsFor(sheet: CharacterSheet): Readonly<Record<SlotRole, SlotDefinition>> | null {
  return slotsOf(sheet.archetypeId);
}

/**
 * The three pieces an archetype starts with, in slot order, for the character
 * picker: the player sees what they will be carrying before they commit to
 * carrying it. Every one of them is common, so this line promises no bonus
 * and none is implied.
 */
export function startingGearNames(archetypeId: string): readonly string[] {
  const slots = slotsOf(archetypeId);
  if (!slots) return [];
  return SLOT_ROLES.map((role) => slots[role].nameByTier[TIER_NAME_INDEX.common]);
}

/** The rarity of the piece in one slot. Always answers, because every slot is always filled (common is a real piece, not an empty slot). The engine's sanitizing reader, so junk in the stored blob resolves the same way here as it does in a roll. */
function tierOf(sheet: CharacterSheet, role: SlotRole): EquipmentTier {
  // `tierInSlot` widened to six roles in contract v2 and can answer null, but
  // only for an empty ring or amulet; a v1 role always holds at least common.
  return tierInSlot(sheet, role) ?? "common";
}

/** What this archetype's piece in one slot is called at one rarity: the Knight's weapon is a "Longsword" at common and "Dawnbreaker" at legendary. The picker needs a name for a tier the character is NOT at, which is the one naming question the engine does not answer. */
export function itemNameAt(sheet: CharacterSheet, role: SlotRole, tier: EquipmentTier): string | null {
  const slots = slotsFor(sheet);
  return slots ? slots[role].nameByTier[TIER_NAME_INDEX[tier]] : null;
}

/**
 * Write a tier straight into one v1 slot. Pure and free.
 *
 * It writes a TIER, never a bonus, which is what keeps the ladder in
 * `BONUS_BY_TIER` the single source of what a piece is worth. There is
 * deliberately no path from a dungeon-master turn to this function: the model
 * narrates gear all it likes and has no field in which to name what it does.
 *
 * NOT the play screen's equip path since contract v2, and never to be wired
 * to a control: it neither checks that the piece is owned nor moves anything
 * through the bag. The one writer the player can reach is the inventory
 * screen's `commitLoadout` (rules/inventory.ts), which only ever MOVES owned
 * items. This stays as the direct fixture writer the tests build loadouts with.
 */
export function equipItem(sheet: CharacterSheet, role: SlotRole, tier: EquipmentTier): CharacterSheet {
  return { ...sheet, equipment: { ...normalizeEquipment(sheet.equipment), [role]: { slot: role, tier } } };
}

/**
 * Which rarities this character may put in a slot right now: common (every
 * drawn role always has its own piece available), the tier actually worn,
 * and every tier of this role sitting in the bag. `EQUIPMENT_TIERS` order,
 * so the ladder prints low to high.
 *
 * ── THE ONE SWITCH FOR THE WHOLE RARITY SURFACE (issue #15), THROWN ────
 *
 * This used to answer with exactly the tier already worn, because nothing in
 * the build granted a piece above common: an "upgrade" control would have
 * been a button that could not do anything. Loot (rules/loot.ts's
 * `lootFor`, wired at the fight-won and container-search sites) is the
 * engine-owned grant that was missing, so this now reads the bag too, and it
 * can genuinely answer with more than one tier the moment a player has found
 * something. That is the exact condition every hiding point in the app was
 * keyed to, and issue #15's restore list is back: the rarity chip on the
 * gear rows (LivingTable.tsx, `CharacterSheetPanel`), the "rarity" glossary
 * entry (menu/labels.ts), and `.lt-rarity*` in styles.css. The tier PICKER
 * this function used to feed is not one of them: it is REPLACED, not
 * restored, by the inventory screen (inventory/InventoryScreen.tsx), which is
 * the one staged surface that changes gear now, so two controls can never
 * disagree about what is worn.
 */
export function equippableTiers(sheet: CharacterSheet, role: SlotRole): readonly EquipmentTier[] {
  const draft = draftFromSheet(sheet);
  const owned = new Set<EquipmentTier>(["common"]);
  const worn = draft.equipment[role];
  if (worn) owned.add(worn.tier);
  for (const item of draft.bag) if (item.slot === role) owned.add(item.tier);
  return EQUIPMENT_TIERS.filter((t) => owned.has(t));
}

// ── the numbers, read out of the engine ─────────────────────────────────
//
// Not derived here. `equipmentStatusFor` resolves all three slots against the
// weapon actually in the character's hands and reports which bonuses SRD 5.1
// is granting RIGHT NOW, which is the same call `effectiveArmorClass` and
// `attackerBonusFor` make. Reading the screen off that status is what makes
// the sheet and the dice incapable of disagreeing.

/**
 * What the armour-kind slots add BEFORE the AC cap, counting only slots whose
 * bonus is actually being granted.
 *
 * "Active" is load-bearing and it is why this cannot be a sum over the tier
 * table: a Trooper's riot shield is a +3 piece that pays nothing while both
 * hands are on their plasma rifle, so a raw sum over the table would print a
 * cap note about a ceiling nothing was pushing against. The only gap this
 * number is allowed to describe is the cap.
 */
export function equipmentAcBonusRaw(sheet: CharacterSheet): number {
  const fromSlots = equipmentStatusFor(sheet)
    .filter((s) => s.bonusKind === "armor" && s.active)
    .reduce((total, s) => total + s.bonus, 0);
  // A worn, active Ring of Protection also pays into this ceiling
  // (characters/equipment.ts's `equipmentArmorBonus`, the function
  // `effectiveArmorClass` actually sums, already counts it). This used to
  // sum only the three v1 armour-kind slots, so a ring pushing the total
  // over MAX_TOTAL_AC_BONUS never made `capNote` below fire: the AC line
  // stayed capped correctly, but nothing on the sheet said why the ring's
  // own row was doing less than it claimed.
  return fromSlots + activeProtectionAmount(sheet, "ring");
}

/** What they actually add: `effectiveArmorClass` minus the stored creation-time AC, so this can never be a second opinion about the same question. */
export function equipmentAcBonus(sheet: CharacterSheet): number {
  return effectiveArmorClass(sheet) - sheet.armorClass;
}

/**
 * The save-kind mirror of `equipmentAcBonusRaw`: every source that pays into
 * `equipmentSaveBonus`'s ceiling (MAX_TOTAL_SAVE_BONUS), uncapped, so a cap
 * note can name every contributor pushing against it the same way the AC one
 * does. Sources: a save-kind slot's active bonus, a worn active Ring of
 * Protection, a worn active Stone of Good Luck (Amulet).
 */
export function equipmentSaveBonusRaw(sheet: CharacterSheet): number {
  const fromSlots = equipmentStatusFor(sheet)
    .filter((s) => s.bonusKind === "save" && s.active)
    .reduce((total, s) => total + s.bonus, 0);
  return fromSlots + activeProtectionAmount(sheet, "ring") + activeLuckAmount(sheet, "amulet");
}

/** A worn, active ring or amulet's `protection` amount, or 0 -- the same read `characters/equipment.ts`'s own AC/save sums use, exposed here so the cap-note copy above can name the item rather than re-deriving the number a second way. */
function activeProtectionAmount(sheet: CharacterSheet, role: AccessoryRole): number {
  const status = accessoryStatus(sheet, role);
  return status.active && status.effect?.kind === "protection" ? status.effect.amount : 0;
}

/** Same, for a `luck` effect (the Stone of Good Luck's saves-and-checks bonus). */
function activeLuckAmount(sheet: CharacterSheet, role: AccessoryRole): number {
  const status = accessoryStatus(sheet, role);
  return status.active && status.effect?.kind === "luck" ? status.effect.amount : 0;
}

/**
 * A THROWAWAY sheet with exactly one gear role swapped to a candidate tier,
 * for a live "if you equipped this" reading -- never persisted, never
 * routed through `commitLoadout`'s invariants (the inventory screen's own
 * staging, rules/inventory.ts, is what actually moves an item between the
 * bag and a slot; this is read-only arithmetic on top of it). Exported so
 * inventory/inventoryView.ts can ask `effectiveArmorClass` /
 * `equipmentAttackBonus` / `equipmentSaveBonus` "what would this be" without
 * a second copy of that arithmetic, the same rule every number on this
 * screen is held to.
 */
export function sheetWithGear(sheet: CharacterSheet, role: GearRole, tier: EquipmentTier): CharacterSheet {
  return { ...sheet, equipment: { ...normalizeEquipment(sheet.equipment), [role]: { slot: role, tier } } };
}

// ── one suit of armour, one name ────────────────────────────────────────
//
// The panel used to print one suit of armour under three different names, and
// only one of them was the object the rarity ladder acts on. A Knight read
// "AC 16 (chain mail)" on the vitals line, "Plate Harness" in the gear row and
// "Chain mail" again in the Carrying list, with the shield called "Kite
// Shield" in one place and "Shield" in the other. A player cannot tell which
// of the three lists an upgrade would move, which is the whole question the
// rarity chip invites them to ask.
//
// The two functions below fix it from opposite ends: the AC parenthesis names
// the gear piece, and the Carrying line stops repeating what the loadout
// already named. Neither touches `sheet.armorLabel`, which stays the engine's
// own record of what armour the chassis was issued (characters/equipment.ts
// anchors the SRD Strength requirement to it), so nothing mechanical moves.

/**
 * What the AC line calls the armour that produced `sheet.armorClass`.
 *
 * The worn body armour is the slot the ENGINE already identifies as one,
 * `slotIsWornArmor` (layer LAYER_OVERBODY), which is the Knight's Plate
 * Harness, the Trooper's Carapace Vest, the Healer's Vestments and the
 * Medic's Field Vest. Naming that piece here is what makes the vitals line
 * and the gear row agree, and it answers the question a rarity chip on an
 * armour row raises: yes, upgrading this is what moves that number.
 *
 * At the CURRENT tier, not at common, because the gear row shows the current
 * tier and two surfaces naming the same object differently is the defect this
 * function exists to end.
 *
 * An archetype whose armour is not in a gear slot at all (a Rogue's leather,
 * a wizard standing in their own clothes) keeps the chassis label, because
 * there is nothing on the panel for it to agree with and inventing an
 * agreement would be worse.
 */
export function armorDisplayLabel(sheet: CharacterSheet): string {
  // No armour on the body: the AC line says so in the formula's own words,
  // whatever the gear row's plain pieces are called.
  if (isUnarmored(sheet)) return UNARMORED_LABEL;
  const slots = slotsFor(sheet);
  const worn = slots ? SLOT_ROLES.map((role) => slots[role]).find((slot) => slotIsWornArmor(slot)) : undefined;
  if (!worn) return sheet.armorLabel;
  const name = itemNameFor(sheet, worn.role);
  if (!name) return sheet.armorLabel;
  // The Cleric chassis folds a shield's flat +2 into its base AC (creation.ts
  // says so, and ARMOR_INCLUDES_SHIELD is that fact exported rather than
  // sniffed out of the label string). Dropping the shield from the sentence
  // would quietly explain 15 points of AC with 13 points of vestments.
  return ARMOR_INCLUDES_SHIELD[sheet.chassis] ? `${name} and shield` : name;
}

/**
 * The Carrying line: the pack, not the loadout.
 *
 * `startingInventory` predates the three drawn gear slots and still names the
 * same objects in its own words, so the list repeated the weapon, the shield
 * and the armour the panel had already shown twice above. Filtering is by
 * exact string against a per-archetype list declared beside the inventory
 * itself (templates.ts's `loadoutInventory`), never by substring or by
 * guessing, so an item picked up mid-campaign is never silently swallowed.
 *
 * `sheet.inventory` itself is untouched. Since contract v2 the dungeon master
 * gets this same filtered list as "Carrying" (session/dmContext.ts), beside a
 * "Wearing" line naming the worn loadout, so the model still hears about
 * everything the character has, and hears about each piece exactly once.
 */
export function packItems(sheet: CharacterSheet): readonly string[] {
  const loadout = loadoutInventoryFor(sheet.archetypeId);
  // The class's armour is worn or it is in the pack. Worn, it is the armour
  // line and never a pack item; taken off (or never put on), the same string
  // is a pack item you can wear again, whatever the loadout list says.
  // An archetype this table has never heard of hides nothing (see below).
  const armorItem = slotsForArchetype(sheet.archetypeId) ? classArmorFor(sheet.chassis)?.itemName.toLowerCase() : undefined;
  if (armorItem === undefined) return sheet.inventory.filter((item) => !loadout.includes(item));
  const unarmored = isUnarmored(sheet);
  return sheet.inventory.filter((item) => {
    if (item.toLowerCase() === armorItem) return unarmored;
    return !loadout.includes(item);
  });
}

// ── what the renderer draws ─────────────────────────────────────────────

/**
 * The layer stack for one character's token, built from the character sheet.
 *
 * Equipment deliberately does NOT go into the world model: `PlacedToken` stays
 * `{id, assetId, x, y, kind, currentHp?}` and gains nothing, because the world
 * is persisted to `game_cells` and shown to the dungeon master, and anything
 * on a token is something the model can see and reason about supplying. The
 * plan is assembled here instead, out of the sheet the model never touches,
 * and handed to `renderCell` alongside the layout.
 *
 * Every layer is the same 16-wide sprite drawn at the body's own origin, so
 * there is no per-layer offset arithmetic anywhere; the draw order is the
 * `layer` integer on the slot, which is what lets a Knight's shield sit in
 * front of him while a Rogue's cloak sits behind her even though both are
 * the same `outer` role. A missing sprite id skips its layer, so a gap in the
 * manifest reads as a missing hat during play rather than as a broken screen.
 */
/**
 * The boots tier worn, off the engine's own six-role `tierInSlot` (rules
 * lane, characters/equipment.ts). `gearItemExists` is this function's own
 * extra guard: `tierInSlot` sanitises an UNRECOGNISED tier word to "common"
 * but does not know boots has no legendary rung, so a stray or corrupted
 * blob claiming "legendary" boots still degrades to common here rather than
 * asking `bootsSpriteId` for a variant that does not exist.
 */
function bootsTierOf(sheet: CharacterSheet, archetypeId: ArchetypeId): EquipmentTier {
  const tier = tierInSlot(sheet, "boots") ?? "common";
  return gearItemExists(archetypeId, "boots", tier) ? tier : "common";
}

export function renderPlanFor(sheet: CharacterSheet): TokenRenderPlan | null {
  const slots = slotsFor(sheet);
  if (!slots || !isArchetypeId(sheet.archetypeId)) return null;
  const archetypeId = sheet.archetypeId;
  // An unarmored hero is not drawn in the plain shield, cloak or armour they
  // are not wearing (`slotIsBare`); a magic piece in one of those slots is.
  const layers: EquipmentLayerPlan[] = SLOT_ROLES.filter((role) => !slotIsBare(sheet, role)).map((role) => {
    const tier = tierOf(sheet, role);
    return {
      spriteId: equipmentSpriteId(archetypeId, role, tierArtVariant(tier)),
      layer: slots[role].layer,
      // Common and uncommon share one drawing and differ only by this remap,
      // which is what makes "colour swaps cost no new sprites" literally true.
      remap: RECOLOUR_BY_TIER[sheet.template][tier],
      glowBands: GLOW_BANDS_BY_TIER[tier],
      glowPulses: GLOW_PULSES_BY_TIER[tier],
    };
  });
  // BOOTS (contract v2): drawn at LAYER_FEET, per archetype, no legendary
  // rung (gearIconSource already returns null past rare -- gearItemExists
  // below is the same "does this rung exist" check, applied before we ever
  // build a sprite id). `base` covers both common and uncommon (uncommon is
  // its RECOLOUR_BY_TIER remap, exactly like every other drawn role).
  // No legendary rung exists for boots (ACCESSORY_ITEMS), so `bootsTierOf`
  // can only ever return common, uncommon or rare, and `tierArtVariant` maps
  // the first two onto boots' one `base` drawing and the third onto `rare`.
  const bootsTier = bootsTierOf(sheet, archetypeId);
  if (gearItemExists(archetypeId, "boots", bootsTier)) {
    layers.push({
      spriteId: bootsSpriteId(archetypeId, bootsTier === "rare" ? "rare" : "base"),
      layer: LAYER_FEET,
      remap: RECOLOUR_BY_TIER[sheet.template][bootsTier],
      glowBands: GLOW_BANDS_BY_TIER[bootsTier],
      glowPulses: GLOW_PULSES_BY_TIER[bootsTier],
    });
  }
  layers.sort((a, b) => a.layer - b.layer);
  return { bodySpriteId: bodySpriteId(archetypeId), layers };
}

/** The same, keyed by the token id the board knows this character by, which is what `renderCell` looks up. Two Knights on one board are two characters with two sets of gear. */
export function renderPlansFor(tokenId: string, sheet: CharacterSheet): TokenRenderPlans | undefined {
  const plan = renderPlanFor(sheet);
  return plan ? { [tokenId]: plan } : undefined;
}

// ── the copy ────────────────────────────────────────────────────────────

/**
 * Rarity in a word.
 *
 * MACHINERY, NOT A SURFACE, while the ladder is unclimbable (issue #15, and
 * see `equippableTiers` for the one switch): nothing renders this today. It
 * stays exported and tested because colour alone fails a colour blind player,
 * so the day a tier can be reached the rank has to arrive as a WORD first and
 * the colour only reinforce it -- and that is a property worth keeping under
 * test rather than rediscovering.
 */
export const RARITY_WORD: Readonly<Record<EquipmentTier, string>> = Object.freeze({
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
});

/**
 * What the slot is for, in words that agree with the sentence underneath it.
 *
 * This label used to be one string per ROLE, and the `crown` string was
 * "Armour or headwear". That is a lie for six of the eight archetypes: the
 * crown slot is bonusKind "armor" only for the Knight's Plate Harness and the
 * Trooper's Carapace Vest. On the Rogue, Healer, Wizard,
 * Infiltrator, Medic and Psion it is bonusKind "save", which
 * `equipmentSaveBonus` routes into `saveModifierFor` and which never touches
 * AC at all. A first-time player reads the label, not the paragraph, and
 * concludes their Hood is their armour: the screen's own rule (state the
 * number and what it does to a roll) was honoured in the effect sentence and
 * broken by the label above it.
 *
 * So the label is picked off `bonusKind`, which is the same field the engine
 * sums, rather than off the role. Two strings instead of one, and the two of
 * them agree with the eight sets automatically rather than by hand.
 */
export function slotLabelFor(slot: SlotDefinition): string {
  if (slot.bonusKind === "weapon") return "Weapon";
  // Naming the effect is the point: "Headwear" alone would leave the same
  // player guessing, and every other row on this panel says what it moves.
  if (slot.bonusKind === "save") return slot.layer === LAYER_HEAD ? "Headwear (saving throws)" : "Worn (saving throws)";
  // The NOUN comes off the same layer predicate the engine uses to decide
  // which piece carries an SRD armour Strength requirement, so the Healer's
  // Vestments and the Medic's Field Vest (worn on the torso, layer
  // LAYER_OVERBODY) are called armour rather than filed under "Shield or
  // cloak" with the Knight's kite shield. The AC line names that same piece,
  // so the two agree by construction.
  return slotIsWornArmor(slot) ? "Armour" : "Shield or cloak";
}

/**
 * The reference numbers the per-piece copy works its example against.
 *
 * Deliberately a worked example rather than this character's live totals for
 * the weapon and save rows: the attack bonus and the save modifier are
 * assembled by session/combat.ts at roll time out of ability, proficiency,
 * fighting style and gear, and a sentence on the sheet that named a live
 * total would be a second place for that arithmetic to live and a second
 * place for it to drift. The armour class is different and IS shown live, on
 * the vitals line, because `effectiveArmorClass` above is the one reader
 * every AC on this screen goes through.
 */
const EXAMPLE_TO_HIT = 15;
const EXAMPLE_SAVE_DC = 13;

/** "a 15", "an 18". Spoken article, because "needs a 18" reads as a typo in the one sentence that has to be trusted. */
function aRoll(n: number): string {
  const spoken = String(n);
  const vowelSound = spoken.startsWith("8") || spoken.startsWith("11") || spoken.startsWith("18");
  return `${vowelSound ? "an" : "a"} ${spoken}`;
}

/** Exported (contract v2) so inventory/inventoryView.ts can describe a bagged weapon/outer/crown piece in the identical words the sheet uses, rather than a second copy of the same three sentences. */
export function weaponCopy(def: SlotDefinition, tier: EquipmentTier, bonus: number): { plain: string; technical: string } {
  if (bonus === 0) {
    return {
      plain: "No bonus to hit and no bonus to damage. This is the weapon you started with.",
      technical: "No item bonus: attack and damage rolls are ability modifier plus proficiency, nothing more.",
    };
  }
  let plain =
    `+${bonus} to hit and +${bonus} damage: an attack that needed ${aRoll(EXAMPLE_TO_HIT)} on the die now lands on ` +
    `${aRoll(EXAMPLE_TO_HIT - bonus)}, and every hit does ${bonus} more damage.`;
  let technical = `SRD 5.1 "Weapon, +${bonus}": the bonus applies to the attack roll and to the damage roll.`;
  const rider = tier === "legendary" ? def.legendaryRider : undefined;
  if (rider) {
    plain += ` Every hit also does an extra ${rider.bonusDamage} ${rider.damageType} damage, rolled as its own die.`;
    technical += ` Plus ${rider.bonusDamage} ${rider.damageType} damage on a hit, rolled separately so a critical doubles the right dice.`;
  }
  return { plain, technical };
}

export function armorCopy(bonus: number): { plain: string; technical: string } {
  if (bonus === 0) {
    return {
      plain: "No bonus to armour class. You are exactly as hard to hit as your armour and your Dexterity already make you.",
      technical: "No item bonus: AC is the armour, the Dexterity modifier and any fighting style.",
    };
  }
  return {
    plain: `+${bonus} armour class: an attack that needed ${aRoll(EXAMPLE_TO_HIT)} to hit you now needs ${aRoll(EXAMPLE_TO_HIT + bonus)}.`,
    technical: `SRD 5.1 "Armor, +${bonus}" / "Shield, +${bonus}": a bonus to Armor Class.`,
  };
}

/**
 * The copy for a piece whose bonus SRD 5.1 is refusing right now.
 *
 * The engine already wrote the sentence: `SlotStatus.reason` is player-facing
 * prose ("Riot Shield is carried in one hand, and both hands are on the
 * weapon"), so the screen repeats the engine's reason rather than inventing a
 * second explanation that could disagree with it.
 */
function refusedCopy(reason: string | null, kind: BonusKind): { plain: string; technical: string } {
  const what = kind === "armor" ? "armour class" : kind === "weapon" ? "your attacks" : "your saving throws";
  return {
    plain: `${reason ?? "This piece is not in use."} It is adding nothing to ${what} while that is true.`,
    technical: "SRD 5.1: a shield is carried in one hand, so a two-handed weapon leaves no hand to carry it in and its bonus does not apply.",
  };
}

export function saveCopy(bonus: number): { plain: string; technical: string } {
  if (bonus === 0) {
    return {
      plain: "No bonus to saving throws. A save is your ability and your training, nothing more.",
      technical: "No item bonus to saving throws.",
    };
  }
  return {
    plain:
      `+${bonus} on every saving throw, trained or not: a save that needed ${aRoll(EXAMPLE_SAVE_DC)} now succeeds on ` +
      `${aRoll(EXAMPLE_SAVE_DC - bonus)}.`,
    technical: `SRD 5.1 Cloak of Protection shape, narrowed: +${bonus} to saving throws only, never to Armor Class.`,
  };
}

export interface GearSlotView {
  role: SlotRole;
  /** "Weapon", "Shield or cloak", "Armour", "Headwear (saving throws)": picked off `bonusKind`, so it can never promise armour on a slot that only moves saves. */
  slotLabel: string;
  /** The piece at the rarity it is actually at: "Longsword", "Keen Longsword", "Dawnbreaker". */
  itemName: string;
  /** Which rank the piece is at. Common until loot puts something better in the bag; issue #15's restored rarity chip reads this directly. */
  tier: EquipmentTier;
  bonusKind: BonusKind;
  /** What this one piece is worth. Nominal: the AC cap is applied across the whole sheet, not per piece, and `GearView.capNote` says so out loud. */
  bonus: number;
  /**
   * False when SRD 5.1 is refusing this piece's bonus right now, which today
   * means a shield with no free hand to carry it in. The row still renders and
   * still names the piece; what it must not do is describe a bonus the dice
   * are not getting, so `plain` says the piece is paying nothing and `reason`
   * says why.
   */
  active: boolean;
  /** Why the bonus is refused, when it is. Null on the ordinary case. */
  reason: string | null;
  /** One sentence with the real number and what it does to a roll, or a plain statement that the piece adds nothing. */
  plain: string;
  /** The SRD shape behind it, for the row's tooltip. */
  technical: string;
  /** True for an armour-kind slot an unarmored hero has nothing worn in: `itemName` is then "Nothing worn", `tier` is "common" and `bonus` is 0. */
  empty: boolean;
}

/**
 * One accessory row (ring, amulet, boots -- contract v2). Its own, smaller
 * shape rather than folded into `GearSlotView`: an accessory's effect is one
 * of `AccessoryEffect`'s seven kinds, not a `BonusKind`, so it does not fit
 * `weaponCopy`/`armorCopy`/`saveCopy`/`refusedCopy`'s three-kind switch.
 * `plain` is built from `characters/equipment.ts`'s `accessoryStatus`, the
 * live engine read: `active` is true only when the piece is worn, has an
 * effect, and (needs no attunement or is one of the character's attuned
 * items), so this row can never claim a number the dice are not actually
 * using, same as every other row on this panel.
 */
export interface AccessorySlotView {
  role: AccessoryRole;
  slotWord: string;
  /** null only for an empty ring or amulet -- boots are never empty. */
  itemName: string | null;
  tier: EquipmentTier | null;
  requiresAttunement: boolean;
  /** False only in the bad-blob case: worn, needs attunement, but a fourth already claimed the cap (equipmentTypes.ts's "bad blob safe" rule). */
  attuned: boolean;
  plain: string;
  empty: boolean;
}

export interface GearView {
  slots: readonly GearSlotView[];
  /** Ring, amulet, boots -- issue #15's restore list, extended by contract v2. */
  accessorySlots: readonly AccessorySlotView[];
  /** "Attuned: n of 3", always shown once any of the six roles can carry a magic item. */
  attunedCounter: string;
  attackBonus: number;
  /** After the cap: what the engine actually adds. */
  acBonus: number;
  /** Before the cap: what the pieces are individually worth. */
  acBonusRaw: number;
  saveBonus: number;
  /** One line naming every number the whole kit contributes, or saying that it contributes none. */
  totalsLine: string;
  /**
   * NO `upgradeNote` HERE, AND THAT IS THE FIX (issue #15).
   *
   * This view used to carry a line reading "Nothing in this campaign upgrades
   * gear yet, so all three pieces stay common." It was true, and it was the
   * right answer to the wrong question: it apologised for a ladder the same
   * panel was busy advertising, three rarity chips and a four-rank glossary
   * entry at a time. With the ranks off the screen there is nothing left to
   * apologise for -- a player who has never been shown a tier is not owed a
   * sentence about tiers, and printing one would be the only place in the app
   * that still told them the ladder exists.
   *
   * The condition that brings a rank back to this panel is `equippableTiers`
   * answering with more than one tier; see the note on it.
   */
  /** Set only when the cap bites, and it names both numbers. Copy that printed the uncapped total would be the exact "sounds better than it is" defect the blind test caught. */
  capNote: string | null;
  /** The save-kind mirror of `capNote` (MAX_TOTAL_SAVE_BONUS): set only when a save-kind slot, a worn Ring of Protection and a worn Stone of Good Luck together would add more than the cap allows. */
  saveCapNote: string | null;
}

/** The item name / effect sentence for one accessory role at one tier, in the exact words EFFECT_COPY_NOTE pins. Exported so inventory/inventoryView.ts prints the identical sentence rather than a second copy of it. */
export function accessoryCopy(role: AccessoryRole, tier: EquipmentTier, baseSpeedFt: number): string {
  if (tier === "common") return role === "boots" ? "No effect. These are the boots you started in." : "No effect.";
  const effect = accessoryEffect(role, tier);
  if (!effect) return "No effect.";
  switch (effect.kind) {
    case "protection":
      return `+${effect.amount} armour class and +${effect.amount} on every saving throw.`;
    case "luck":
      return `+${effect.amount} on every skill check and every saving throw.`;
    case "skillAdvantage":
      return `Advantage on ${effect.skill} checks: roll two d20s and keep the higher.`;
    case "speedMultiplier": {
      const word = effect.factor === 2 ? "Double" : `x${effect.factor}`;
      return `${word} walking speed in a fight: ${baseSpeedFt} feet becomes ${baseSpeedFt * effect.factor}.`;
    }
    case "hitDieHealingMultiplier": {
      const word = effect.factor === 2 ? "twice" : `${effect.factor} times`;
      return `Every hit die you spend to catch your breath heals ${word} as much.`;
    }
    case "saveRescue":
      return `When you fail a ${ABILITY_NAME[effect.ability]} saving throw, a charge turns it into a success. ${effect.charges} charges; a long rest brings back ${effect.rechargeDice}.`;
    case "restRegeneration":
      return `Every time you catch your breath, the ring also restores ${effect.dice} hit points.`;
  }
}

/**
 * Everything the character sheet needs to draw the three slots, derived fresh
 * from the tier on the sheet every time it is read.
 */
/** What a bare armour-kind row calls itself. */
export const BARE_SLOT_NAME = "Nothing worn";

export function gearView(sheet: CharacterSheet): GearView | null {
  const definitions = slotsFor(sheet);
  if (!definitions || !isArchetypeId(sheet.archetypeId)) return null;

  // The engine's own resolution of all three slots, against the weapon in
  // hand. Not a re-derivation: this is the same list `effectiveArmorClass`
  // sums, so a row can only ever claim a bonus the dice also got.
  const status = equipmentStatusFor(sheet);

  // The weapon row names the WEAPON THAT IS SWUNG as well as the enchanted
  // object the bonus comes off, whenever those are two different things. The
  // rider line and the attack breakdown already print this label; a gear row
  // that printed only "Sunstroke" while the dice log resolved a Fire Bolt left
  // the player with two names for one action and no way to square them.
  // `weaponIdentityFor` is the only place that reconciliation happens, on
  // purpose, so this row asks it rather than picking one of the two names.
  const weaponIdentity = weaponIdentityFor(sheet);

  const slots: GearSlotView[] = SLOT_ROLES.map((role) => {
    const def = definitions[role];
    const tier = tierOf(sheet, role);
    const bonus = BONUS_BY_TIER[tier];
    if (slotIsBare(sheet, role)) {
      return {
        role,
        slotLabel: slotLabelFor(def),
        itemName: BARE_SLOT_NAME,
        tier,
        bonusKind: def.bonusKind,
        bonus: 0,
        active: false,
        reason: "You wear no armour, so nothing is worn here.",
        plain: "Nothing worn here. You wear no armour, so this adds nothing to your armour class: you are 10 plus your Dexterity modifier.",
        technical: "SRD 5.1 unarmored: AC is 10 + the Dexterity modifier. A shield or armour you find and wear adds to it.",
        empty: true,
      };
    }
    const resolved = status.find((s) => s.role === role);
    const active = resolved ? resolved.active : true;
    const reason = (active ? null : resolved?.reason) ?? null;
    // A refused piece is described by what it is doing, which is nothing, not
    // by what its tier says it would be worth. Printing "+2 armour class" next
    // to an AC that did not move is the one thing the copy rule here forbids.
    const copy = !active
      ? refusedCopy(reason, def.bonusKind)
      : def.bonusKind === "weapon"
        ? weaponCopy(def, tier, bonus)
        : def.bonusKind === "armor"
          ? armorCopy(bonus)
          : saveCopy(bonus);
    return {
      role,
      slotLabel: slotLabelFor(def),
      itemName:
        def.bonusKind === "weapon" && weaponIdentity.differs
          ? weaponIdentity.label
          : def.nameByTier[TIER_NAME_INDEX[tier]],
      tier,
      bonusKind: def.bonusKind,
      bonus,
      active,
      reason,
      plain: copy.plain,
      technical: copy.technical,
      empty: false,
    };
  });

  const attackBonus = equipmentAttackBonus(sheet);
  const acBonusRaw = equipmentAcBonusRaw(sheet);
  const acBonus = equipmentAcBonus(sheet);
  const saveBonus = equipmentSaveBonus(sheet);

  const parts: string[] = [];
  if (attackBonus > 0) parts.push(`+${attackBonus} to hit and damage`);
  if (acBonus > 0) parts.push(`+${acBonus} armour class`);
  if (saveBonus > 0) parts.push(`+${saveBonus} to saving throws`);

  // The zero case used to read "All three pieces are common, which adds
  // nothing to any roll." Same fact, but it named a RANK, and with the rarity
  // ladder hidden (issue #15) this line would have been the last place in the
  // app still telling a player ranks exist. It says what the kit does instead,
  // which is what the sentence was for.
  const totalsLine =
    parts.length === 0
      ? "None of these three pieces adds anything to a roll: your numbers here are ability and training, nothing more."
      // Comma-separated rather than "A and B": two of the three parts already
      // contain an "and" of their own ("+1 to hit and damage"), and a third
      // one joining them reads as a single run-on number.
      : `This kit adds ${parts.join(", ")}, on top of ability and training.`;

  // Only the pieces actually pushing against the cap get named by the cap
  // note. A refused shield is not being capped, it is being refused, and its
  // row already says so. A worn, active Ring of Protection pays into this
  // same ceiling (equipmentAcBonusRaw above), so it is named here too when
  // it is what pushes the total over: without it, a ring silently adding
  // nothing (because the armour alone already sat at the cap) looked
  // identical to a ring the engine had never read.
  const ringStatus = accessoryStatus(sheet, "ring");
  const ringProtectionActive = ringStatus.active && ringStatus.effect?.kind === "protection";
  const armorNames = slots.filter((s) => s.bonusKind === "armor" && s.active).map((s) => s.itemName);
  if (ringProtectionActive && ringStatus.name) armorNames.push(ringStatus.name);
  const capNote =
    acBonusRaw > MAX_TOTAL_AC_BONUS
      ? `The ${listOf(armorNames)} would add +${acBonusRaw} armour class between them, but gear never adds more than ` +
        `+${MAX_TOTAL_AC_BONUS}, so +${MAX_TOTAL_AC_BONUS} is what the dice are rolled against.`
      : null;

  // The save-kind mirror: a save-kind slot (a Cloak of Protection-shaped
  // crown), the same ring's protection amount, and a worn Stone of Good
  // Luck's luck amount all pay into MAX_TOTAL_SAVE_BONUS.
  const amuletStatus = accessoryStatus(sheet, "amulet");
  const amuletLuckActive = amuletStatus.active && amuletStatus.effect?.kind === "luck";
  const saveBonusRaw = equipmentSaveBonusRaw(sheet);
  const saveNames = slots.filter((s) => s.bonusKind === "save" && s.active).map((s) => s.itemName);
  if (ringProtectionActive && ringStatus.name) saveNames.push(ringStatus.name);
  if (amuletLuckActive && amuletStatus.name) saveNames.push(amuletStatus.name);
  const saveCapNote =
    saveBonusRaw > MAX_TOTAL_SAVE_BONUS
      ? `The ${listOf(saveNames)} would add +${saveBonusRaw} to every saving throw between them, but gear never adds more than ` +
        `+${MAX_TOTAL_SAVE_BONUS} there, so +${MAX_TOTAL_SAVE_BONUS} is what the dice are rolled against.`
      : null;

  // ── ring, amulet, boots (contract v2, issue #15's restore extended) ─────
  //
  // `accessoryStatus` (characters/equipment.ts, rules lane) is the live
  // engine read: it already knows whether this piece's effect is ACTUALLY
  // applying right now (worn, has an effect, and attuned or needs none) and
  // prints the same attunementNeededLine the inventory screen does when it
  // is not. This row asks it rather than re-deriving attunement locally, so
  // the sheet can never claim an effect the engine is not applying --
  // exactly the rule every string on this panel is held to.
  const attunedCount = attunedRoles(sheet.archetypeId, equipmentOf(sheet)).length;
  // The Boots of Speed sentence names the speed BEFORE the boots double it.
  const baseSpeed = speedBeforeBootsFt(sheet);
  const accessorySlots: AccessorySlotView[] = (["ring", "amulet", "boots"] as const).map((role) => {
    const status = accessoryStatus(sheet, role);
    const plain =
      status.tier === null
        ? `No ${ACCESSORY_SLOT_WORD[sheet.template][role].toLowerCase()} worn.`
        : !status.active
          ? `${status.reason ?? "Not in use."} It is adding nothing while that is true.`
          : accessoryCopy(role, status.tier, baseSpeed);
    return {
      role,
      slotWord: ACCESSORY_SLOT_WORD[sheet.template][role],
      itemName: status.name,
      tier: status.tier,
      requiresAttunement: status.requiresAttunement,
      attuned: !status.requiresAttunement || status.attuned,
      plain,
      empty: status.tier === null,
    };
  });

  return {
    slots,
    accessorySlots,
    attunedCounter: attunedCounterCopy(attunedCount),
    attackBonus,
    acBonus,
    acBonusRaw,
    saveBonus,
    totalsLine,
    capNote,
    saveCapNote,
  };
}

/** "a", "a and b", "a, b and c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
