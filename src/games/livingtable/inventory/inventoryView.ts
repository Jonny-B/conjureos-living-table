/**
 * THE INVENTORY SCREEN'S VIEW MODEL: everything InventoryScreen.tsx needs to
 * draw the frame, the six slot boxes, the bag grid and the detail panel, all
 * derived fresh from a `LoadoutDraft` and the current tap selection. Pure --
 * no React, no canvas, no sheet mutation -- so it is testable with `assert`
 * alone, the same split menu/equipment.ts's `gearView` already uses between
 * "what to show" and "how to draw it".
 *
 * Every sentence here is built off the pinned tables in
 * characters/equipmentTypes.ts and the copy helpers menu/equipment.ts
 * already exports (`weaponCopy` / `armorCopy` / `saveCopy` /
 * `accessoryCopy`), never a second, hand-typed number -- the rule this whole
 * feature is held to (equipmentTypes.ts rule 7 in this build's brief:
 * "every item string must state its real number, and nothing may imply an
 * effect the engine does not apply").
 */
import {
  ACCESSORY_ROLES,
  ACCESSORY_SLOT_WORD,
  ATTUNEMENT_NOT_NEEDED_LINE,
  BAG_CAPACITY,
  BONUS_BY_TIER,
  GEAR_ROLES,
  GLOW_BANDS_BY_TIER,
  INVENTORY_LAYOUT,
  INVENTORY_TITLE_BY_TEMPLATE,
  MAX_ATTUNED_ITEMS,
  RARITY_PIPS,
  SLOTS_BY_ARCHETYPE,
  TIER_WORD,
  accessoryEffect,
  attunedCounter,
  attunementNeededLine,
  emptySlotIconSource,
  gearIconSource,
  gearItemName,
  gearRequiresAttunement,
  type AccessoryRole,
  type ArchetypeId,
  type EquipmentTier,
  type GearIconSource,
  type GearRole,
  type SheetOnlyRole,
  type LoadoutDraft,
  type MagicTier,
  type SlotRole,
} from "../characters/equipmentTypes";
import type { CharacterSheet } from "../characters/creation";
import type { TemplateGenre } from "../characters/templates";
import {
  accessoryCopy,
  armorCopy,
  effectiveArmorClass,
  equipmentAttackBonus,
  equipmentSaveBonus,
  saveCopy,
  sheetWithGear,
  slotLabelFor,
  weaponCopy,
} from "../menu/equipment";
import { attunedRoles } from "../rules/attunement";
import { draftFromSheet, stageEquip } from "../rules/inventory";

export type InventorySelection = { kind: "bag"; index: number } | { kind: "slot"; role: GearRole } | null;

export interface SlotBoxView {
  role: GearRole;
  slotWord: string;
  /** null only for an empty ring or amulet. */
  itemName: string | null;
  tier: EquipmentTier | null;
  pips: 0 | 1 | 2 | 3;
  empty: boolean;
  /** This box was tapped directly. */
  selected: boolean;
  /** The bag cell currently selected fits this box -- it glows to show where an Equip would land. */
  highlighted: boolean;
  glowBands: 0 | 1 | 2;
  accessibleName: string;
  /** What render/gearIcon.ts draws in the box: the worn piece, or an empty ring/amulet's silhouette. Null only if no item exists there at all. */
  icon: GearIconSource | null;
}

export interface BagCellView {
  index: number;
  role: GearRole;
  slotWord: string;
  itemName: string;
  tier: MagicTier;
  pips: 1 | 2 | 3;
  selected: boolean;
  accessibleName: string;
  /** What render/gearIcon.ts draws in the cell, cropped from the same art the doll wears. */
  icon: GearIconSource | null;
}

export interface DetailView {
  kind: "none" | "bag" | "wornMagic" | "wornCommon" | "emptyAccessory";
  title: string | null;
  tierWord: string | null;
  pips: 0 | 1 | 2 | 3 | null;
  fitsLine: string | null;
  /**
   * "AC 17 -> 19" / "Attack +4 -> +7" / "Saves +0 -> +1": the LIVE, capped
   * before/after, read off the same functions the dice go through
   * (effectiveArmorClass / equipmentAttackBonus / equipmentSaveBonus), for a
   * bag item that would touch one of those three numbers. Null for an item
   * that does not (boots, a saveRescue ring, a hitDieHealingMultiplier
   * amulet) and for anything that is not a bag selection.
   *
   * This is what stops `effectSentence`'s worked example (menu/equipment.ts's
   * EXAMPLE_TO_HIT/EXAMPLE_SAVE_DC, a fixed "a 15") from reading as the
   * player's OWN number: a Knight already at AC 17 who reads "an attack that
   * needed a 15 now needs a 17" could mistake that fixed example for their
   * live AC and conclude the piece does nothing. The live delta is the
   * primary claim; the worked example stays underneath it as flavour.
   */
  statLine: string | null;
  effectSentence: string | null;
  attunementLine: string | null;
  /** "Replaces <worn>: <worn effect>", only for a bag selection whose slot is currently occupied. */
  replacesLine: string | null;
  bodyText: string | null;
  equipDisabled: boolean;
  equipDisabledReason: string | null;
  showUnequip: boolean;
  /** Bag indices that fit an empty accessory slot, tappable rows per THE SCREEN. */
  fittingBagIndices: readonly number[];
}

export interface InventoryView {
  title: string;
  attunedCounter: string;
  blockedReason: string | null;
  leftColumn: readonly SlotBoxView[];
  rightColumn: readonly SlotBoxView[];
  bag: readonly BagCellView[];
  bagCapacity: number;
  /** "Pack 2/18": the bag grid has no visible capacity number of its own (18 empty-looking cells otherwise read as "the bag is huge and mostly broken" rather than "this is the ceiling, and it is unreachable by design" -- equipmentTypes.ts's MAX_DISTINCT_MAGIC_ITEMS <= BAG_CAPACITY). */
  bagCountLabel: string;
  /** How many of the six roles the staged draft wears a different tier in than the committed sheet does. Shown beside Ok so a player who reaches for the header x (or Cancel) knows there is something to lose first -- the x's own behaviour is unchanged (THE SCREEN: "Cancel/x discard"), this only makes the stakes visible before they tap it. */
  stagedChangeCount: number;
  detail: DetailView;
  usableLine: string | null;
  carryingLine: string;
}

/** How many of the six roles wear a different tier in `draft` than in `committed`. Bag reordering/contents are not counted on their own -- every staging action (stageEquip/stageUnequip) always changes exactly one worn tier, so this is a faithful "N changes" count without a second, heavier deep-equal over the bag array. */
function countChangedRoles(committed: LoadoutDraft, draft: LoadoutDraft): number {
  return GEAR_ROLES.filter((role) => (committed.equipment[role]?.tier ?? null) !== (draft.equipment[role]?.tier ?? null)).length;
}

function isAccessoryRole(role: GearRole): role is AccessoryRole {
  return (ACCESSORY_ROLES as readonly GearRole[]).includes(role);
}

function slotWordFor(archetypeId: ArchetypeId, template: TemplateGenre, role: GearRole): string {
  if (isAccessoryRole(role)) return ACCESSORY_SLOT_WORD[template][role];
  return slotLabelFor(SLOTS_BY_ARCHETYPE[archetypeId][role as SlotRole]);
}

/** The one sentence stating this item's real effect, in the identical words the character sheet already uses -- never a second copy of the same number. */
function effectSentenceFor(archetypeId: ArchetypeId, role: GearRole, tier: EquipmentTier, baseSpeedFt: number): string {
  if (isAccessoryRole(role)) return accessoryCopy(role, tier, baseSpeedFt);
  const def = SLOTS_BY_ARCHETYPE[archetypeId][role as SlotRole];
  const bonus = BONUS_BY_TIER[tier];
  const copy = def.bonusKind === "weapon" ? weaponCopy(def, tier, bonus) : def.bonusKind === "armor" ? armorCopy(bonus) : saveCopy(bonus);
  return copy.plain;
}

/** "+4", "+0", "-1": a modifier always carries its own sign, never a bare "0" that could be misread as "no bonus exists" versus "the bonus is exactly zero right now". */
function signedBonus(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function isSlotRole(role: GearRole): role is SlotRole {
  return role === "weapon" || role === "outer" || role === "crown";
}

/**
 * The live before/after for equipping `tier` in `role`, on the three numbers
 * this screen ever moves: AC, the weapon's attack bonus, and the flat save
 * bonus. Built off the identical readers the dice roll against
 * (`effectiveArmorClass`, `equipmentAttackBonus`, `equipmentSaveBonus`, all
 * re-exports of the engine's own functions), on a throwaway sheet
 * (`sheetWithGear`) rather than a second copy of the cap arithmetic -- the
 * same "never a second opinion" rule `menu/equipment.ts`'s own header holds
 * itself to.
 *
 * Null for a role/tier that touches none of the three: boots (speed and
 * skill advantage only), a ring's `saveRescue`/`restRegeneration` rungs, an
 * amulet's `hitDieHealingMultiplier` rung, and common (no effect at all).
 */
function statDeltaLine(archetypeId: ArchetypeId, sheet: CharacterSheet, role: GearRole, tier: EquipmentTier): string | null {
  if (tier === "common") return null;
  const after = sheetWithGear(sheet, role, tier);
  const parts: string[] = [];

  if (isSlotRole(role)) {
    const bonusKind = SLOTS_BY_ARCHETYPE[archetypeId][role].bonusKind;
    if (bonusKind === "weapon") {
      parts.push(`Attack ${signedBonus(equipmentAttackBonus(sheet))} -> ${signedBonus(equipmentAttackBonus(after))}`);
    } else if (bonusKind === "armor") {
      parts.push(`AC ${effectiveArmorClass(sheet)} -> ${effectiveArmorClass(after)}`);
    } else {
      parts.push(`Saves ${signedBonus(equipmentSaveBonus(sheet))} -> ${signedBonus(equipmentSaveBonus(after))}`);
    }
  } else if (role === "ring" || role === "amulet") {
    const effect = accessoryEffect(role, tier);
    if (effect?.kind === "protection") {
      parts.push(`AC ${effectiveArmorClass(sheet)} -> ${effectiveArmorClass(after)}`);
      parts.push(`Saves ${signedBonus(equipmentSaveBonus(sheet))} -> ${signedBonus(equipmentSaveBonus(after))}`);
    } else if (effect?.kind === "luck") {
      parts.push(`Saves ${signedBonus(equipmentSaveBonus(sheet))} -> ${signedBonus(equipmentSaveBonus(after))}`);
    }
  }
  // boots: skillAdvantage / speedMultiplier, neither AC, attack nor a save.

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * For a WORN attunement item (contract v2: wearing IS attuning -- see
 * equipmentTypes.ts). `attunementNeededLine` is the BAG's sentence ("put
 * this on and here is what it costs"); printed under a piece already worn it
 * read as "this still needs attunement" even while capped, e.g. "Needs
 * attunement. You are attuned to 3 of 3." beside an item that was itself one
 * of those three -- the exact wording a player would read as "this is NOT
 * one of my three", the opposite of the truth.
 */
function wornAttunedLine(attunedCount: number): string {
  return `Attuned: this is one of your ${MAX_ATTUNED_ITEMS} (${attunedCount} of ${MAX_ATTUNED_ITEMS} in use).`;
}

const EMPTY_DETAIL: DetailView = {
  kind: "none",
  title: null,
  tierWord: null,
  pips: null,
  fitsLine: null,
  statLine: null,
  effectSentence: null,
  attunementLine: null,
  replacesLine: null,
  bodyText: null,
  equipDisabled: true,
  equipDisabledReason: null,
  showUnequip: false,
  fittingBagIndices: [],
};

function buildDetail(
  archetypeId: ArchetypeId,
  template: TemplateGenre,
  sheet: CharacterSheet,
  draft: LoadoutDraft,
  selection: InventorySelection,
  attuned: readonly GearRole[],
  baseSpeedFt: number,
): DetailView {
  if (!selection) return EMPTY_DETAIL;
  // The live before/after reads off a throwaway sheet carrying the CURRENT
  // DRAFT's equipment, not the committed sheet: the doll already draws the
  // staged loadout (LivingTable.tsx's `dollPlan`), and a second Equip in the
  // same session should see the first one's effect too, not a delta frozen
  // at whatever the sheet looked like when the screen opened.
  const draftSheet: CharacterSheet = { ...sheet, equipment: draft.equipment };

  if (selection.kind === "bag") {
    const item = draft.bag[selection.index];
    if (!item) return EMPTY_DETAIL;
    const { slot: role, tier } = item;
    const itemName = gearItemName(archetypeId, role, tier) ?? "";
    const slotWord = slotWordFor(archetypeId, template, role);
    const worn = draft.equipment[role];
    const outcome = stageEquip(archetypeId, draft, selection.index);
    const requiresAttunement = gearRequiresAttunement(archetypeId, role, tier);
    return {
      kind: "bag",
      title: itemName,
      tierWord: TIER_WORD[tier],
      pips: RARITY_PIPS[tier],
      fitsLine: `Fits: ${slotWord}`,
      statLine: statDeltaLine(archetypeId, draftSheet, role, tier),
      effectSentence: effectSentenceFor(archetypeId, role, tier, baseSpeedFt),
      attunementLine: requiresAttunement ? attunementNeededLine(attuned.length) : ATTUNEMENT_NOT_NEEDED_LINE,
      replacesLine: worn
        ? `Replaces ${gearItemName(archetypeId, role, worn.tier)}: ${effectSentenceFor(archetypeId, role, worn.tier, baseSpeedFt)}`
        : null,
      bodyText: null,
      equipDisabled: !outcome.ok,
      equipDisabledReason: outcome.ok ? null : outcome.reason,
      showUnequip: false,
      fittingBagIndices: [],
    };
  }

  const role = selection.role;
  const worn = draft.equipment[role];
  const slotWord = slotWordFor(archetypeId, template, role);

  if (!worn) {
    const fittingBagIndices = draft.bag.map((b, i) => (b.slot === role ? i : -1)).filter((i) => i >= 0);
    return { ...EMPTY_DETAIL, kind: "emptyAccessory", bodyText: `No ${slotWord.toLowerCase()} worn.`, fittingBagIndices };
  }

  const itemName = gearItemName(archetypeId, role, worn.tier) ?? "";
  if (worn.tier === "common") {
    return { ...EMPTY_DETAIL, kind: "wornCommon", title: itemName, bodyText: `Your own ${itemName}. It is what you wear when nothing better is on.` };
  }

  const requiresAttunement = gearRequiresAttunement(archetypeId, role, worn.tier);
  return {
    kind: "wornMagic",
    title: itemName,
    tierWord: TIER_WORD[worn.tier],
    pips: RARITY_PIPS[worn.tier],
    fitsLine: `Fits: ${slotWord}`,
    statLine: null,
    effectSentence: effectSentenceFor(archetypeId, role, worn.tier, baseSpeedFt),
    attunementLine: requiresAttunement ? wornAttunedLine(attuned.length) : ATTUNEMENT_NOT_NEEDED_LINE,
    replacesLine: null,
    bodyText: null,
    equipDisabled: true,
    equipDisabledReason: null,
    showUnequip: true,
    fittingBagIndices: [],
  };
}

export function buildInventoryView(params: {
  archetypeId: ArchetypeId;
  template: TemplateGenre;
  sheet: CharacterSheet;
  draft: LoadoutDraft;
  selection: InventorySelection;
  blockedReason: string | null;
  usable: readonly { name: string; uses: number }[];
  carrying: readonly string[];
  baseSpeedFt: number;
}): InventoryView {
  const { archetypeId, template, sheet, draft, selection, blockedReason, usable, carrying, baseSpeedFt } = params;
  const attuned = attunedRoles(archetypeId, draft.equipment);
  const highlightRole: GearRole | null = selection?.kind === "bag" ? (draft.bag[selection.index]?.slot ?? null) : null;

  const slotBox = (role: GearRole): SlotBoxView => {
    const worn = draft.equipment[role];
    const tier = worn?.tier ?? null;
    const itemName = worn ? gearItemName(archetypeId, role, worn.tier) : null;
    const slotWord = slotWordFor(archetypeId, template, role);
    const pips = (tier ? RARITY_PIPS[tier] : 0) as 0 | 1 | 2 | 3;
    const glowBands = (tier ? GLOW_BANDS_BY_TIER[tier] : 0) as 0 | 1 | 2;
    const accessibleName = itemName && tier ? `${itemName}, ${TIER_WORD[tier]}, fits ${slotWord}` : `Empty ${slotWord}, fits ${slotWord}`;
    return {
      role,
      slotWord,
      itemName,
      tier,
      pips,
      empty: !worn,
      selected: selection?.kind === "slot" && selection.role === role,
      highlighted: highlightRole === role,
      glowBands,
      accessibleName,
      icon: worn
        ? gearIconSource(archetypeId, role, worn.tier)
        : role === "ring" || role === "amulet"
          ? emptySlotIconSource(template, role as SheetOnlyRole)
          : null,
    };
  };

  const bag: BagCellView[] = draft.bag.map((item, index) => {
    const itemName = gearItemName(archetypeId, item.slot, item.tier) ?? "";
    const slotWord = slotWordFor(archetypeId, template, item.slot);
    return {
      index,
      role: item.slot,
      slotWord,
      itemName,
      tier: item.tier,
      pips: RARITY_PIPS[item.tier] as 1 | 2 | 3,
      selected: selection?.kind === "bag" && selection.index === index,
      accessibleName: `${itemName}, ${TIER_WORD[item.tier]}, fits ${slotWord}`,
      icon: gearIconSource(archetypeId, item.slot, item.tier),
    };
  });

  // Only a consumable with uses LEFT is offered here: the play screen's own
  // Item verb already drops a used-up potion's button at zero, and this line
  // used to print `sheet.consumables` unfiltered, so "Potion of healing x0"
  // stayed on the inventory screen after the play screen had already moved
  // on to "nothing left to use".
  const usableWithCharges = usable.filter((c) => c.uses > 0);

  return {
    title: INVENTORY_TITLE_BY_TEMPLATE[template],
    attunedCounter: attunedCounter(attuned.length),
    blockedReason,
    leftColumn: INVENTORY_LAYOUT.leftColumn.map(slotBox),
    rightColumn: INVENTORY_LAYOUT.rightColumn.map(slotBox),
    bag,
    bagCapacity: BAG_CAPACITY,
    bagCountLabel: `Pack ${draft.bag.length}/${BAG_CAPACITY}`,
    stagedChangeCount: countChangedRoles(draftFromSheet(sheet), draft),
    detail: buildDetail(archetypeId, template, sheet, draft, selection, attuned, baseSpeedFt),
    usableLine: usableWithCharges.length > 0 ? `Usable: ${usableWithCharges.map((c) => `${c.name} x${c.uses}`).join(", ")}` : null,
    carryingLine: `Also carrying: ${carrying.length > 0 ? carrying.join(", ") : "nothing"}`,
  };
}
