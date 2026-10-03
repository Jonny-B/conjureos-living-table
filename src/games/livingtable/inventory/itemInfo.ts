/**
 * WHAT EVERY ITEM IS, in words a player cannot misread: the engine side of the
 * hover tip on every thing a hero can hold.
 *
 * The owner's request: "Inventory items should have a hover feature that
 * explains exactly what they are so the player is never confused." Three kinds
 * of thing sit on a sheet, and each had a different gap:
 *
 *   - worn and bagged GEAR was already explained, but only on the inventory
 *     screen's detail panel (inventoryView.ts), one tap at a time;
 *   - the flavour list (`sheet.inventory`: "Handaxe x2", "Explorer's pack") was
 *     explained nowhere at all, and most of it is not read by the engine;
 *   - consumables were a name and a count.
 *
 * Every line here is held to the game's own copy rule (equipmentTypes.ts,
 * rule 7): state the real number, and never imply an effect the engine does
 * not apply. Each `inGame` line therefore opens with one of two labels:
 *
 *   "The game applies this"  the engine reads it (a weapon's die, an armour
 *                            class, a bonus, a heal);
 *   "The DM rules on this"   the engine does not read it, so the player tells
 *                            the DM what they do and the DM decides.
 *
 * NOTHING HERE IS A SECOND OPINION ABOUT A NUMBER. Gear copy comes out of
 * menu/equipment.ts's `gearView`, `weaponCopy`, `armorCopy`, `saveCopy` and
 * `accessoryCopy`, and live figures (an attack's dice, an armour class, a
 * speed penalty) come out of session/combat.ts and characters/equipment.ts,
 * the same readers the dice go through. The only numbers typed in this file
 * are SRD 5.1's printed weapon, armour and pack figures, which the engine does
 * not own, and each of those sits beside the engine's own figure rather than
 * replacing it. Sci-fi gear is not an SRD item, so it carries no SRD number at
 * all, only what this game does with it.
 *
 * Pure: no React, no canvas, no model call, nothing spent. SRD 5.1 content is
 * CC BY 4.0 (NOTICE.md); the descriptions are our own words.
 */
import { ARMOR_INCLUDES_SHIELD, classArmorFor, withArmor, type CharacterSheet } from "../characters/creation";
import {
  armorSpeedPenaltyFt,
  equipmentOf,
  isUnarmored,
  itemNameFor,
  slotIsHandHeld,
  slotIsWornArmor,
  slotsForArchetype,
  tierInSlot,
} from "../characters/equipment";
import {
  ACCESSORY_ITEMS,
  ACCESSORY_SLOT_WORD,
  ATTUNEMENT_NOT_NEEDED_LINE,
  BONUS_BY_TIER,
  GEAR_ROLES,
  MAX_ATTUNED_ITEMS,
  MAX_TOTAL_AC_BONUS,
  MAX_TOTAL_SAVE_BONUS,
  TEMPLATE_OF_ARCHETYPE,
  TIER_WORD,
  accessoryEffect,
  attunementNeededLine,
  gearItemKey,
  gearItemName,
  gearRequiresAttunement,
  type AccessoryEffect,
  type AccessoryRole,
  type ArchetypeId,
  type BagItem,
  type EquipmentTier,
  type GearRole,
  type SlotRole,
} from "../characters/equipmentTypes";
import { getArchetype, type Consumable } from "../characters/templates";
import { ABILITY_NAME } from "../menu/labels";
import {
  accessoryCopy,
  armorCopy,
  effectiveArmorClass,
  equipmentAttackBonus,
  equipmentSaveBonus,
  gearView,
  packItems,
  saveCopy,
  sheetWithGear,
  slotLabelFor,
  weaponCopy,
} from "../menu/equipment";
import { attunedRoles } from "../rules/attunement";
import {
  ARCHERY_ATTACK_BONUS,
  DUELING_DAMAGE_BONUS,
  archeryBonusFor,
  attackerBonusFor,
  duelingBonusFor,
  speedBeforeBootsFt,
  weaponDamageNotationFor,
  weaponFor,
  weaponIdentityFor,
} from "../session/combat";

// ── the shape ───────────────────────────────────────────────────────────

export type ItemKind = "weapon" | "armor" | "accessory" | "consumable" | "kit" | "treasure" | "item";

export interface ItemInfo {
  name: string;
  kind: ItemKind;
  /** One plain sentence: what it is. */
  summary: string;
  /** Its real numbers: damage dice and type, properties, armour class, bonus, uses, healing dice, rarity, attunement. */
  facts: string[];
  /** Exactly what THIS game does with it. Opens with APPLIES_LABEL or DM_RULES_LABEL. */
  inGame: string;
  /** "Starting kit", "Loot", "Found", when known. */
  source?: string;
}

/** The two honest openings of every `inGame` line. */
export const APPLIES_LABEL = "The game applies this";
export const DM_RULES_LABEL = "The DM rules on this";

/** What an item the engine never reads says, word for word. */
export const DM_RULES_LINE = `${DM_RULES_LABEL}. The game does not use this on its own; tell the DM what you do with it and the DM decides.`;

/** The summary an item with no entry and no DM note gets. Exported so a test can prove no real item fell through to it. */
export const GENERIC_ITEM_SUMMARY = "The game has no rules entry for this item.";

// ── small helpers ───────────────────────────────────────────────────────

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** The two long-dash glyphs, built from their code points so this file never has to type them. */
const LONG_DASHES = new RegExp("\\s*[" + String.fromCharCode(0x2013, 0x2014) + "]\\s*", "g");
const CURLY_QUOTES = new RegExp("[" + String.fromCharCode(0x2018, 0x2019) + "]", "g");

/** Commas only: a DM's own description can carry any character, and no dash glyph may reach a tip. */
function clean(text: string): string {
  return text.replace(LONG_DASHES, ", ").replace(/\s+/g, " ").trim();
}

/** "  Thieves' Tools " -> "thieves' tools": the one key every lookup goes through (curly apostrophes folded). */
function normKey(name: string): string {
  return name.replace(CURLY_QUOTES, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** "Handaxe x2" -> { base: "Handaxe", count: 2 }. "Shortbow, 20 arrows" has no trailing count and stays whole. */
function splitCount(raw: string): { base: string; count: number } {
  const text = raw.trim();
  const m = /^(.*\S)\s+x\s*(\d+)$/i.exec(text);
  if (!m) return { base: text, count: 1 };
  const count = Number.parseInt(m[2]!, 10);
  return count >= 1 ? { base: m[1]!.trim(), count } : { base: text, count: 1 };
}

function isGearRole(role: string): role is GearRole {
  return (GEAR_ROLES as readonly string[]).includes(role);
}

function isSlotRole(role: GearRole): role is SlotRole {
  return role === "weapon" || role === "outer" || role === "crown";
}

function archetypeOf(sheet: CharacterSheet): ArchetypeId | null {
  return slotsForArchetype(sheet.archetypeId) ? (sheet.archetypeId as ArchetypeId) : null;
}

function attunedCount(sheet: CharacterSheet): number {
  return attunedRoles(sheet.archetypeId, equipmentOf(sheet)).length;
}

/** The worn-piece attunement line, in the identical words the inventory screen prints under a worn magic item. */
function wornAttunedLine(inUse: number): string {
  return `Attuned: this is one of your ${MAX_ATTUNED_ITEMS} (${inUse} of ${MAX_ATTUNED_ITEMS} in use).`;
}

/** How a character's own gear row names the piece in one slot, with its rarity word, or null when the slot is empty or unknown. */
function gearRowOf(sheet: CharacterSheet, role: GearRole): { name: string; tierWord: string } | null {
  const name = itemNameFor(sheet, role);
  const tier = tierInSlot(sheet, role);
  return name !== null && tier !== null ? { name, tierWord: TIER_WORD[tier] } : null;
}

// ── what the engine rolls for a weapon ──────────────────────────────────

const PROPERTIES_NOTE = "Its properties are listed for the DM; the game's own rolls use only the die, your ability and your bonuses.";

/** "Archery adds +2 to hit", "Dueling adds +2 damage": where a fighting style is inside the numbers just printed. */
function styleNote(sheet: CharacterSheet): string {
  const weapon = weaponFor(sheet);
  const bits: string[] = [];
  if (archeryBonusFor(sheet, weapon) > 0) bits.push(`Archery adds +${ARCHERY_ATTACK_BONUS} to hit`);
  if (duelingBonusFor(sheet, weapon) > 0) bits.push(`Dueling adds +${DUELING_DAMAGE_BONUS} damage`);
  return bits.length > 0 ? ` (${bits.join(", ")})` : "";
}

/** "1d8+3 at +5 to hit": the engine's own attack for this sheet, with magic and fighting style already in. */
function attackSummary(sheet: CharacterSheet): string {
  return `${weaponDamageNotationFor(sheet)} at ${signed(attackerBonusFor(sheet))} to hit`;
}

// ── the catalogue ───────────────────────────────────────────────────────

/**
 * One entry per distinct thing any archetype's `startingInventory` names.
 * `game` is a function because the honest answer depends on the sheet: the
 * weapon the engine is rolling, the armour class it is reading, the shield it
 * has or has not already folded in.
 */
interface Entry {
  kind: ItemKind;
  summary: string;
  facts: readonly string[];
  game: (sheet: CharacterSheet) => string;
  /** Names the engine's `weaponFor` can answer with when THIS item is the weapon in hand ("Shortsword" is rolled as "Shortblade"). */
  engine?: readonly string[];
  /** The spell the engine rolls instead when this item is only the focus it is cast through. */
  via?: string;
}

/** An item the engine never reads, with an optional extra sentence naming the nearest thing the game does. */
function dmEntry(kind: ItemKind, summary: string, facts: readonly string[], extra?: string): Entry {
  const line = extra ? `${DM_RULES_LINE} ${extra}` : DM_RULES_LINE;
  return { kind, summary, facts, game: () => line };
}

/** A weapon: the engine's rolled attack when it is the one in hand, an honest "that is not what your Attack rolls" when it is not. */
function weaponEntry(o: {
  summary: string;
  facts: readonly string[];
  engine: readonly string[];
  via?: string;
  /** True for an SRD weapon, whose properties the game lists but does not apply. */
  srd?: boolean;
  /** Said only when the engine is rolling something else. */
  idle?: (sheet: CharacterSheet) => string;
  /** Said when the engine is rolling this. */
  note?: string;
}): Entry {
  return {
    kind: "weapon",
    summary: o.summary,
    facts: o.facts,
    engine: o.engine,
    via: o.via,
    game: (sheet) => {
      const weapon = weaponFor(sheet);
      if (o.engine.includes(weapon.name)) {
        return [
          `${APPLIES_LABEL}: your weapon, so every Attack rolls ${attackSummary(sheet)}${styleNote(sheet)}.`,
          o.srd ? PROPERTIES_NOTE : "",
          o.note ?? "",
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (o.via && weapon.name === o.via) {
        return `${APPLIES_LABEL}: it is the focus you cast through, so your Attack is ${weapon.name}, rolling ${attackSummary(sheet)}${styleNote(sheet)}. This item's own damage die is never rolled.`;
      }
      return `${DM_RULES_LABEL}. Your Attack rolls ${weapon.name} (${attackSummary(sheet)}), not this.${o.idle ? ` ${o.idle(sheet)}` : ""} If you use it anyway, tell the DM what you do and the DM decides.`;
    },
  };
}

/**
 * What putting the class's armour on would do, read off the same engine
 * readers on a throwaway sheet (`withArmor`), for a hero who is not wearing
 * it: the armour class before and after, and the speed it would cost.
 */
function putOnLine(sheet: CharacterSheet): string {
  const after = withArmor(sheet, "class");
  const penalty = armorSpeedPenaltyFt(after);
  const slow = penalty > 0 ? ` It would cost you ${penalty} feet of speed (your Strength is ${sheet.abilities.str}).` : "";
  return `You are not wearing it. Equip it and your armour class goes from ${effectiveArmorClass(sheet)} to ${effectiveArmorClass(after)}.${slow}`;
}

/** A body-armour entry that is one chassis's armour line: worn it is the armour line, carried it can be put on. */
function classArmourEntry(label: string, o: { summary: string; facts: readonly string[] }): Entry {
  return {
    kind: "armor",
    summary: o.summary,
    facts: o.facts,
    game: (sheet) => {
      if (classArmorFor(sheet.chassis)?.label !== label) {
        return `${DM_RULES_LABEL}. The game does not work your armour class from this entry: your armour line is "${sheet.armorLabel}", armour class ${sheet.armorClass} on the sheet.`;
      }
      if (isUnarmored(sheet)) return `${APPLIES_LABEL} once you wear it. ${putOnLine(sheet)}`;
      return `${APPLIES_LABEL}: it is your body armour. ${armourLine(sheet)} The game does not apply the Stealth disadvantage.`;
    },
  };
}

/** The live armour sentence every body-armour entry shares: the class's armour line is what the engine reads. */
function armourLine(sheet: CharacterSheet): string {
  if (isUnarmored(sheet)) {
    const gear = effectiveArmorClass(sheet) - sheet.armorClass;
    return `Your armour class is ${effectiveArmorClass(sheet)}: you wear no armour, so it is 10 plus your Dexterity modifier (${signed(sheet.modifiers.dex)})${gear > 0 ? `, plus ${gear} from your gear` : ""}.`;
  }
  return `Your armour class is ${effectiveArmorClass(sheet)}, built on your class's armour line ("${sheet.armorLabel}", ${sheet.armorClass} on the sheet before gear bonuses).`;
}

const EXPLORERS_PACK_CONTENTS =
  "Backpack, bedroll, mess kit, tinderbox, 10 torches, 10 days of rations, waterskin, 50 feet of hempen rope";
const BURGLARS_PACK_CONTENTS =
  "Backpack, a bag of 1,000 ball bearings, 10 feet of string, bell, 5 candles, crowbar, hammer, 10 pitons, hooded lantern, 2 flasks of oil, 5 days of rations, tinderbox, waterskin, 50 feet of hempen rope";
const PRIESTS_PACK_CONTENTS =
  "Backpack, blanket, 10 candles, tinderbox, alms box, 2 blocks of incense, censer, vestments, 2 days of rations, waterskin";
const SCHOLARS_PACK_CONTENTS =
  "Backpack, book of lore, bottle of ink, ink pen, 10 sheets of parchment, little bag of sand, small knife";

const PACK_NOTE = "The game does not count what is inside, so nothing in it runs out.";

const CATALOGUE: Readonly<Record<string, Entry>> = Object.freeze({
  // ── fantasy weapons (SRD 5.1) ──────────────────────────────────────────
  longsword: weaponEntry({
    summary: "A one-handed steel sword with a long, straight blade.",
    facts: ["SRD 5.1 martial melee weapon.", "Damage 1d8 slashing.", "Versatile: 1d10 if held in two hands."],
    engine: ["Longsword"],
    srd: true,
  }),
  handaxe: weaponEntry({
    summary: "A small axe that can be swung up close or thrown.",
    facts: ["SRD 5.1 simple melee weapon.", "Damage 1d6 slashing.", "Light, thrown (range 20 / 60 feet)."],
    engine: ["Thrown handaxe"],
    srd: true,
    idle: (sheet) => (sheet.archetypeId === "knight" ? "A Knight who takes the Archery fighting style leads with the thrown handaxe instead." : ""),
  }),
  shortsword: weaponEntry({
    summary: "A short, quick one-handed blade made for fast stabs.",
    facts: ["SRD 5.1 martial melee weapon.", "Damage 1d6 piercing.", "Finesse (Strength or Dexterity), light."],
    engine: ["Shortblade"],
    srd: true,
  }),
  shortbow: weaponEntry({
    summary: "A light two-handed bow for shooting arrows at range.",
    facts: ["SRD 5.1 simple ranged weapon.", "Damage 1d6 piercing.", "Ammunition, two-handed, range 80 / 320 feet."],
    engine: ["Shortbow"],
    srd: true,
  }),
  "shortbow, 20 arrows": weaponEntry({
    summary: "A light two-handed bow, with a quiver of 20 arrows to shoot from it.",
    facts: ["SRD 5.1 simple ranged weapon.", "Damage 1d6 piercing.", "Ammunition, two-handed, range 80 / 320 feet.", "20 arrows come with it."],
    engine: ["Shortbow"],
    srd: true,
    note: "The game does not count arrows, so you never run out.",
    idle: () => "The game does not count arrows either.",
  }),
  mace: weaponEntry({
    summary: "A heavy metal-headed club that crushes armour and bone.",
    facts: ["SRD 5.1 simple melee weapon.", "Damage 1d6 bludgeoning."],
    engine: ["Mace"],
    srd: true,
  }),
  quarterstaff: weaponEntry({
    summary: "A long, sturdy wooden staff, carried as a walking stick and a spellcaster's focus.",
    facts: ["SRD 5.1 simple melee weapon.", "Damage 1d6 bludgeoning.", "Versatile: 1d8 if held in two hands."],
    engine: ["Quarterstaff"],
    via: "Fire Bolt",
    srd: true,
  }),

  // ── fantasy armour (SRD 5.1) ───────────────────────────────────────────
  "chain mail": {
    kind: "armor",
    summary: "A heavy shirt of interlocking metal rings that covers the whole body.",
    facts: [
      "SRD 5.1 heavy armour.",
      "Armour class 16, with no Dexterity added.",
      "Needs Strength 13, or you lose 10 feet of speed.",
      "The SRD also gives disadvantage on Stealth checks.",
    ],
    game: (sheet) => {
      if (classArmorFor(sheet.chassis)?.label !== "chain mail") {
        return `${DM_RULES_LABEL}. The game does not work your armour class from this entry: your class's armour line is "${sheet.armorLabel}", armour class ${sheet.armorClass} on the sheet.`;
      }
      if (isUnarmored(sheet)) return `${APPLIES_LABEL} once you wear it. ${putOnLine(sheet)} The SRD also gives disadvantage on Stealth checks, which the game does not apply.`;
      const penalty = armorSpeedPenaltyFt(sheet);
      const strength =
        penalty > 0
          ? `Your Strength is ${sheet.abilities.str}, too low for it, so it costs you ${penalty} feet of speed.`
          : `Your Strength is ${sheet.abilities.str}, which meets its requirement, so it costs you no speed.`;
      return `${APPLIES_LABEL}: it is your body armour. ${armourLine(sheet)} ${strength} The game does not apply the Stealth disadvantage.`;
    },
  },
  "scale mail": {
    kind: "armor",
    summary: "A coat covered in overlapping metal scales, lighter than chain mail.",
    facts: [
      "SRD 5.1 medium armour.",
      "Armour class 14 plus Dexterity (at most +2).",
      "The SRD also gives disadvantage on Stealth checks.",
    ],
    game: (sheet) =>
      `${APPLIES_LABEL}, but not with the SRD's numbers: ${armourLine(sheet)} The game reads your class's armour line, not this entry, and does not apply the Stealth disadvantage.`,
  },
  "leather armor": classArmourEntry("leather armor", {
    summary: "Armour of stiffened, boiled leather, light enough to move quietly in.",
    facts: ["SRD 5.1 light armour.", "Armour class 11 plus your Dexterity modifier."],
  }),
  "chain shirt and shield": classArmourEntry("chain shirt and shield", {
    summary: "A shirt of interlocking rings worn under the clothes, and a shield to go with it.",
    facts: [
      "SRD 5.1 medium armour (the chain shirt) and shield.",
      "Armour class 13 plus Dexterity (at most +2), and +2 for the shield: 15 plus that Dexterity.",
    ],
  }),
  shield: {
    kind: "armor",
    summary: "A wooden or metal shield carried on the arm to turn blows aside.",
    facts: ["SRD 5.1 shield.", "+2 armour class.", "Carried in one hand."],
    game: (sheet) =>
      ARMOR_INCLUDES_SHIELD[sheet.chassis]
        ? `${APPLIES_LABEL}: a shield's +2 is already folded into your sheet's armour class (${sheet.armorClass}, armour line "${sheet.armorLabel}"), so it is counted once and never added twice.`
        : `${APPLIES_LABEL}, with one change from the SRD: the flat +2 is not added. Your armour class (${effectiveArmorClass(sheet)}) comes from your class's armour line ("${sheet.armorLabel}") and Dexterity; the shield piece in your gear row adds only its magic bonus, +0 at Common.`,
  },
  "dark cloak": {
    kind: "armor",
    summary: "A plain, dark cloak that helps you fade into a corner.",
    facts: ["An ordinary cloak, not an SRD item."],
    game: (sheet) => gearRowGame(sheet, "outer"),
  },

  // ── fantasy gear (SRD 5.1) ─────────────────────────────────────────────
  "thieves' tools": dmEntry(
    "kit",
    "A small roll of lock picks, a file, pliers, a mirror on a handle and scissors.",
    ["SRD 5.1 tool."],
    "There is no lockpicking roll of its own, so ask the DM to let you try a lock.",
  ),
  "holy symbol": dmEntry(
    "item",
    "An emblem of your faith, worn or held so a cleric can focus on it.",
    ["SRD 5.1 spellcasting focus."],
    "The game never checks that you hold it: your spells and slots work without it.",
  ),
  spellbook: dmEntry(
    "item",
    "A thick book of parchment pages that holds a wizard's spells.",
    ["SRD 5.1 item for a wizard.", "About a hundred pages."],
    "The game never checks that you hold it: your spells and slots work without it.",
  ),
  "component pouch": dmEntry(
    "item",
    "A small belt pouch of compartments for the odds and ends of spellcasting.",
    ["SRD 5.1 spellcasting focus."],
    "The game never checks that you hold it: your spells and slots work without it.",
  ),
  "explorer's pack": dmEntry(
    "kit",
    "A backpack of everything for a long trek: bedroll, torches, food and rope.",
    ["SRD 5.1 equipment pack.", `Holds: ${EXPLORERS_PACK_CONTENTS}.`],
    PACK_NOTE,
  ),
  "burglar's pack": dmEntry(
    "kit",
    "A backpack of a thief's working gear: lantern, crowbar, rope and ball bearings.",
    ["SRD 5.1 equipment pack.", `Holds: ${BURGLARS_PACK_CONTENTS}.`],
    PACK_NOTE,
  ),
  "priest's pack": dmEntry(
    "kit",
    "A backpack of a priest's daily needs: candles, incense, vestments and a little food.",
    ["SRD 5.1 equipment pack.", `Holds: ${PRIESTS_PACK_CONTENTS}.`],
    PACK_NOTE,
  ),
  "scholar's pack": dmEntry(
    "kit",
    "A backpack of a scholar's tools: a book of lore, ink, an ink pen and parchment.",
    ["SRD 5.1 equipment pack.", `Holds: ${SCHOLARS_PACK_CONTENTS}.`],
    PACK_NOTE,
  ),

  // ── sci-fi gear (no SRD stat, so only what this game does) ─────────────
  "plasma rifle": weaponEntry({
    summary: "A two-handed rifle that fires bolts of superheated plasma.",
    facts: ["Sci-fi weapon, not an SRD item, so it has no SRD stats."],
    engine: ["Plasma Rifle"],
  }),
  "sidearm (suppressed)": weaponEntry({
    summary: "A compact pistol with a built-in suppressor.",
    facts: ["Sci-fi weapon, not an SRD item, so it has no SRD stats."],
    engine: ["Sidearm"],
    note: "Being suppressed is for the story: the game does not track noise.",
  }),
  "stun baton": weaponEntry({
    summary: "A short baton that delivers a shock on contact.",
    facts: ["Sci-fi weapon, not an SRD item, so it has no SRD stats."],
    engine: ["Stun Baton"],
    note: "The game rolls it as plain damage; any stunning is the DM's to narrate.",
  }),
  "neural focus": weaponEntry({
    summary: "A hand-held focus that channels a Psion's thoughts into a lash of force.",
    facts: ["Sci-fi gear, not an SRD item, so it has no SRD stats."],
    engine: ["Neural Focus"],
    via: "Neural Lash",
  }),
  "frag grenade": dmEntry(
    "weapon",
    "A hand-thrown fragmentation explosive.",
    ["Sci-fi weapon, not an SRD item.", "The game has no damage number for it."],
    "There is no grenade rule, so the DM decides what it does.",
  ),
  "combat vest": {
    kind: "armor",
    summary: "A load-bearing vest of armoured panels, worn over the chest and back.",
    facts: ["Sci-fi armour, not an SRD item, so it has no SRD stats."],
    game: (sheet) => `${APPLIES_LABEL}: it is your body armour in the story. ${armourLine(sheet)}`,
  },
  "ceramic-plate vest": {
    kind: "armor",
    summary: "A light vest with ceramic plates that stop most small arms fire.",
    facts: ["Sci-fi armour, not an SRD item, so it has no SRD stats."],
    game: (sheet) => `${APPLIES_LABEL}: it is your body armour in the story. ${armourLine(sheet)}`,
  },
  "light shield generator": {
    kind: "armor",
    summary: "A belt unit that projects a thin barrier around you.",
    facts: ["Sci-fi gear, not an SRD item, so it has no SRD stats."],
    game: (sheet) => `${gearRowGame(sheet, "outer")} ${armourLine(sheet)}`,
  },
  "field kit": dmEntry(
    "kit",
    "A soldier's pouch of patches, tape and spare parts for a long patrol.",
    ["Sci-fi gear, not an SRD item."],
    "Your healing in this game is the Medfoam injector, not this kit.",
  ),
  "hacking rig": dmEntry(
    "kit",
    "A portable terminal and cable set for getting into locked systems.",
    ["Sci-fi tool, not an SRD item."],
    "There is no hacking roll of its own, so ask the DM to let you try a system.",
  ),
  "holo-disguise kit": dmEntry(
    "kit",
    "A wearable projector that changes your face and clothes for a while.",
    ["Sci-fi tool, not an SRD item."],
    "There is no disguise roll of its own, so ask the DM to let you try it.",
  ),
  "grapnel line": dmEntry(
    "kit",
    "A launcher and cable for climbing a wall or crossing a gap.",
    ["Sci-fi tool, not an SRD item."],
    "There is no climbing roll of its own, so ask the DM to let you try it.",
  ),
  "diagnostic scanner": dmEntry(
    "kit",
    "A handheld scanner that reads a body or a machine.",
    ["Sci-fi tool, not an SRD item."],
    "It does not change any roll, so ask the DM what a reading tells you.",
  ),
  "data slate": dmEntry(
    "item",
    "A flat tablet holding notes, maps and records.",
    ["Sci-fi gear, not an SRD item."],
    "Ask the DM what you look up on it.",
  ),
  "ration pack": dmEntry(
    "kit",
    "Sealed food for a few days on the move.",
    ["Sci-fi gear, not an SRD item."],
    "The game does not track hunger, so nothing in it runs out.",
  ),
});

/** Other spellings a carried string or a gear name may arrive in, all pointing at a key above. */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "short sword": "shortsword",
  shortblade: "shortsword",
  handaxes: "handaxe",
  "hand axe": "handaxe",
  arrows: "shortbow, 20 arrows",
  "thieves tools": "thieves' tools",
  sidearm: "sidearm (suppressed)",
});

function lookup(key: string): Entry | undefined {
  return CATALOGUE[ALIASES[key] ?? key];
}

/**
 * Which gear row each loadout string IS, per archetype, so the tip can say
 * "your gear row shows it as Plate Harness". The Knight's panel once printed
 * one suit of armour under three names; this is the bridge between the
 * flavour list's words and the gear table's words. A test pins every key to
 * the archetype's own `loadoutInventory`, so it cannot drift from the kit.
 * A loadout string absent here (the Healer's Shield, folded into the armour
 * line) has no gear row of its own. Keys are normalised (lower case).
 */
export const LOADOUT_GEAR_ROLE: Readonly<Record<string, Readonly<Record<string, GearRole>>>> = Object.freeze({
  knight: { longsword: "weapon", shield: "outer", "chain mail": "crown" },
  shadow: { shortsword: "weapon", "dark cloak": "outer" },
  healer: { mace: "weapon", "scale mail": "outer" },
  "fireball-person": { quarterstaff: "weapon" },
  trooper: { "plasma rifle": "weapon", "combat vest": "crown" },
  infiltrator: { "sidearm (suppressed)": "weapon" },
  medic: { "stun baton": "weapon", "ceramic-plate vest": "outer" },
  psion: { "neural focus": "weapon", "light shield generator": "outer" },
});

// ── worn gear: the gear table's own words ───────────────────────────────

/** What each archetype's plain (Common) armour, cloak and headwear is, in our own words. Weapons live in the catalogue above. */
const GEAR_BASE: Readonly<Record<string, { summary: string; facts: readonly string[] }>> = Object.freeze({
  "kite shield": { summary: "A tall, tapering shield strapped to the arm.", facts: [] },
  "plate harness": { summary: "A knight's body armour, drawn as a harness of steel plates.", facts: [] },
  "dark cloak": { summary: "A plain, dark cloak that helps you fade into a corner.", facts: [] },
  hood: { summary: "A deep hood that shades the face.", facts: [] },
  vestments: { summary: "The plain robes of a holy order, worn as body armour.", facts: [] },
  mitre: { summary: "A tall ceremonial hat of a holy order.", facts: [] },
  "travelling cloak": { summary: "A sturdy cloak for the road.", facts: [] },
  "pointed hat": { summary: "A tall pointed hat, the old mark of a wizard.", facts: [] },
  "riot shield": { summary: "A braced barrier shield worn strapped to the forearm.", facts: ["Braced on the arm rather than gripped, so it needs no free hand."] },
  "carapace vest": { summary: "Layered body armour worn over the chest and back.", facts: [] },
  "stealth cape": { summary: "A cape of light-damping fabric.", facts: [] },
  "optic visor": { summary: "A visor that sits over the eyes.", facts: [] },
  "field vest": { summary: "A medic's vest of pockets and light plating, worn as body armour.", facts: [] },
  "scanner band": { summary: "A headband with a small scanning sensor.", facts: [] },
  "barrier field": { summary: "A thin projected barrier, drawn around the body.", facts: [] },
  "psi crown": { summary: "A circlet that helps a Psion focus.", facts: [] },
});

/** The plain item behind a gear row's Common name: a catalogue weapon, or a GEAR_BASE piece. */
function baseOf(commonName: string): { summary: string; facts: readonly string[] } | null {
  const key = normKey(commonName);
  const entry = lookup(key);
  if (entry && entry.kind === "weapon") return { summary: entry.summary, facts: entry.facts };
  return GEAR_BASE[key] ?? null;
}

/** "Your gear row shows it as Plate Harness (Common)", or nothing when the gear row names it the same way already. */
function gearRowFact(sheet: CharacterSheet, carriedName: string, role: GearRole): string | null {
  const row = gearRowOf(sheet, role);
  if (!row) return null;
  if (normKey(row.name) === normKey(carriedName) && row.tierWord === TIER_WORD.common) return null;
  return `Your gear row shows it as ${row.name} (${row.tierWord}).`;
}

/** The in-game line for a worn armour-kind piece, read off the same row the sheet draws. */
function gearRowGame(sheet: CharacterSheet, role: SlotRole): string {
  const view = gearView(sheet);
  const row = view?.slots.find((r) => r.role === role);
  const worn = gearRowOf(sheet, role);
  if (!row || !worn) return DM_RULES_LINE;
  return `${APPLIES_LABEL}: the piece your gear row shows as ${worn.name} (${worn.tierWord}). ${row.plain}`;
}

/** The in-game line for the weapon slot: the engine's own attack, and which item carries the bonus when that is not the weapon swung. */
function weaponSlotGame(sheet: CharacterSheet): string {
  const weapon = weaponFor(sheet);
  const identity = weaponIdentityFor(sheet);
  if (identity.differs) {
    return `${APPLIES_LABEL}: this item carries your weapon bonus, but your Attack is ${weapon.name}, rolling ${attackSummary(sheet)}${styleNote(sheet)}.`;
  }
  return `${APPLIES_LABEL}: your weapon, so every Attack rolls ${attackSummary(sheet)}${styleNote(sheet)}.`;
}

function slotPieceKind(bonusKind: "weapon" | "armor" | "save"): ItemKind {
  return bonusKind === "weapon" ? "weapon" : bonusKind === "armor" ? "armor" : "accessory";
}

function describeWornSlotPiece(sheet: CharacterSheet, role: SlotRole, tier: EquipmentTier, name: string): ItemInfo | null {
  const slots = slotsForArchetype(sheet.archetypeId);
  const row = gearView(sheet)?.slots.find((r) => r.role === role);
  if (!slots || !row) return null;
  const def = slots[role];
  const commonName = def.nameByTier[0];
  const base = baseOf(commonName);
  const bonus = BONUS_BY_TIER[tier];

  const facts: string[] = [
    `Slot: ${row.slotLabel}.`,
    tier === "common" ? "Rarity: Common (a plain piece, no item bonus)." : `Rarity: ${TIER_WORD[tier]} (item bonus +${bonus}).`,
    row.plain,
  ];
  if (tier !== "common") {
    facts.push(gearRequiresAttunement(sheet.archetypeId as ArchetypeId, role, tier) ? wornAttunedLine(attunedCount(sheet)) : ATTUNEMENT_NOT_NEEDED_LINE);
  }
  if (slotIsWornArmor(def)) {
    facts.push(`Your sheet's armour line is "${sheet.armorLabel}", ${sheet.armorClass} before gear bonuses; this is the piece the gear row shows for it.`);
  }
  if (slotIsHandHeld(sheet.archetypeId, role)) facts.push("Carried in one hand, so a two-handed weapon leaves no hand for it.");
  if (tier !== "common" && base) facts.push(`Base item: ${base.summary}`);
  if (base) facts.push(...base.facts);

  let inGame: string;
  if (def.bonusKind === "weapon") {
    inGame = weaponSlotGame(sheet);
  } else if (!row.active) {
    inGame = `${APPLIES_LABEL}, and right now it adds nothing: ${row.reason ?? "something is blocking it."}`;
  } else if (def.bonusKind === "armor") {
    inGame = `${APPLIES_LABEL}: it feeds your armour class, now ${effectiveArmorClass(sheet)}.${
      tier === "common" ? "" : ` Gear never adds more than +${MAX_TOTAL_AC_BONUS} armour class in total.`
    }`;
  } else {
    inGame =
      tier === "common"
        ? `${APPLIES_LABEL}: it is a plain piece and adds nothing to a roll. Magic versions add to saving throws only, never to armour class.`
        : `${APPLIES_LABEL}: its bonus goes on every saving throw you make, never on armour class. Gear never adds more than +${MAX_TOTAL_SAVE_BONUS} to saves in total.`;
  }

  let summary = tier === "common" ? (base?.summary ?? `Your plain ${commonName}.`) : `The ${TIER_WORD[tier].toLowerCase()} magic version of your ${commonName}.`;
  // A kit that describes the weapon in its own words (a plain dagger). Words
  // only: the card says so, and the numbers stay the class weapon's.
  const note = def.bonusKind === "weapon" ? sheet.weaponNote : undefined;
  if (note && tier === "common") {
    summary = `${note.charAt(0).toUpperCase()}${note.slice(1)}.`;
    facts.push(`That is how the weapon is described. The game's numbers for it are your ${commonName}'s, the ones on this card.`);
  }

  return {
    name,
    kind: slotPieceKind(def.bonusKind),
    summary,
    facts,
    inGame,
    source: tier === "common" ? "Starting kit" : "Loot",
  };
}

// ── ring, amulet and boots ──────────────────────────────────────────────

/** One plain sentence, no numbers (the numbers are in the facts and the in-game line), for what an accessory is. */
function accessorySummary(role: AccessoryRole, effect: AccessoryEffect | null): string {
  if (!effect) return role === "boots" ? "The plain boots you started in." : "A plain accessory.";
  switch (effect.kind) {
    case "protection":
      return "A magic ward worn to turn blows and spells aside.";
    case "luck":
      return "A charm that tilts luck a little in your favour.";
    case "skillAdvantage":
      return "Footwear that makes your steps quiet.";
    case "speedMultiplier":
      return "Boots that make you move much faster.";
    case "hitDieHealingMultiplier":
      return "A charm that makes your body mend faster when you catch your breath.";
    case "saveRescue":
      return "A ring that can turn a failed save into a success a limited number of times.";
    case "restRegeneration":
      return "A ring that keeps closing your wounds while you rest.";
  }
}

/** The facts every accessory carries, worn or bagged: rarity first, then the SRD source and what this game changed. */
function accessoryFacts(sheet: CharacterSheet, role: AccessoryRole, tier: EquipmentTier): string[] {
  const item = ACCESSORY_ITEMS[role][tier];
  const facts: string[] = [
    tier === "common" ? "Rarity: Common (a plain piece, no item bonus)." : `Rarity: ${TIER_WORD[tier]} (this game's rung, which can differ from the SRD's).`,
  ];
  if (item?.srd) {
    facts.push(`SRD 5.1 item: ${item.srd.name} (${item.srd.rarity} in the SRD${item.srd.attunement ? ", needs attunement" : ", no attunement"}).`);
  }
  const effect = accessoryEffect(role, tier);
  if (effect?.kind === "saveRescue") {
    const left = sheet.itemCharges?.[gearItemKey(role, tier)];
    facts.push(`Charges: ${left ?? effect.charges} of ${effect.charges}; a long rest brings back ${effect.rechargeDice}.`);
  }
  if (item) facts.push(...item.simplified);
  return facts;
}

function describeWornAccessory(sheet: CharacterSheet, role: AccessoryRole, tier: EquipmentTier, name: string): ItemInfo | null {
  const row = gearView(sheet)?.accessorySlots.find((r) => r.role === role);
  if (!row) return null;
  const effect = accessoryEffect(role, tier);
  const [rarity, ...rest] = accessoryFacts(sheet, role, tier);
  // gearView reads a plain pair of boots as "not in use" (it has no effect, so it is never "active"); the honest sentence for a Common piece is accessoryCopy's own.
  const plain = tier === "common" ? accessoryCopy(role, tier, speedBeforeBootsFt(sheet)) : row.plain;
  const facts = [`Slot: ${row.slotWord}.`, rarity!, plain, ...rest];
  if (tier !== "common") {
    facts.push(gearRequiresAttunement(sheet.archetypeId as ArchetypeId, role, tier) ? wornAttunedLine(attunedCount(sheet)) : ATTUNEMENT_NOT_NEEDED_LINE);
  }
  const inGame = row.empty
    ? DM_RULES_LINE
    : tier === "common" || row.attuned || !row.requiresAttunement
      ? `${APPLIES_LABEL}: ${plain}`
      : `${APPLIES_LABEL} only while you are attuned: ${plain}`;
  return {
    name,
    kind: "accessory",
    summary: accessorySummary(role, effect),
    facts,
    inGame,
    source: tier === "common" ? "Starting kit" : "Loot",
  };
}

// ── the public readers ──────────────────────────────────────────────────

/**
 * What the piece in one gear slot is, or null for an empty ring or amulet, a
 * slot name this game does not have, or an archetype with no gear table.
 * `slot` is a GearRole ("weapon", "outer", "crown", "boots", "ring",
 * "amulet"); typed as a string so a caller holding user text can ask without a
 * cast, and anything else answers null.
 */
export function describeWorn(sheet: CharacterSheet, slot: string): ItemInfo | null {
  if (!isGearRole(slot)) return null;
  if (!archetypeOf(sheet)) return null;
  const tier = tierInSlot(sheet, slot);
  const name = itemNameFor(sheet, slot);
  if (tier === null || name === null) return null;
  return isSlotRole(slot) ? describeWornSlotPiece(sheet, slot, tier, name) : describeWornAccessory(sheet, slot, tier, name);
}

/** The effect sentence for one gear piece at one tier, in the identical words the sheet and the inventory screen use. */
function effectSentence(sheet: CharacterSheet, role: GearRole, tier: EquipmentTier): string {
  if (!isSlotRole(role)) return accessoryCopy(role, tier, speedBeforeBootsFt(sheet));
  const def = slotsForArchetype(sheet.archetypeId)![role];
  const bonus = BONUS_BY_TIER[tier];
  const copy = def.bonusKind === "weapon" ? weaponCopy(def, tier, bonus) : def.bonusKind === "armor" ? armorCopy(bonus) : saveCopy(bonus);
  return copy.plain;
}

/** "Armour class 16 -> 18": what wearing a bagged piece would do to the three numbers gear can move, read off the same functions the dice use on a throwaway sheet. Null for a piece that moves none of them (boots, a charged ring, a healing charm). */
function wearDelta(sheet: CharacterSheet, role: GearRole, tier: EquipmentTier): string | null {
  const after = sheetWithGear(sheet, role, tier);
  const parts: string[] = [];
  const def = isSlotRole(role) ? slotsForArchetype(sheet.archetypeId)?.[role] : undefined;
  const kinds: ("armor" | "save" | "weapon")[] = [];
  if (def) {
    kinds.push(def.bonusKind);
  } else {
    const effect = accessoryEffect(role, tier);
    if (effect?.kind === "protection") kinds.push("armor", "save");
    else if (effect?.kind === "luck") kinds.push("save");
  }
  for (const kind of kinds) {
    if (kind === "weapon") parts.push(`Weapon bonus ${signed(equipmentAttackBonus(sheet))} -> ${signed(equipmentAttackBonus(after))}`);
    if (kind === "armor") parts.push(`Armour class ${effectiveArmorClass(sheet)} -> ${effectiveArmorClass(after)}`);
    if (kind === "save") parts.push(`Saving throw bonus ${signed(equipmentSaveBonus(sheet))} -> ${signed(equipmentSaveBonus(after))}`);
  }
  return parts.length > 0 ? `If you wear it: ${parts.join(", ")}.` : null;
}

/** An owned magic piece that is not worn. */
export function describeBagItem(sheet: CharacterSheet, item: BagItem): ItemInfo {
  const archetypeId = archetypeOf(sheet);
  const name = archetypeId ? gearItemName(archetypeId, item.slot, item.tier) : null;
  if (!archetypeId || name === null) {
    return {
      name: `${TIER_WORD[item.tier]} ${item.slot}`,
      kind: "item",
      summary: GENERIC_ITEM_SUMMARY,
      facts: [`Rarity: ${TIER_WORD[item.tier]}.`],
      inGame: DM_RULES_LINE,
      source: "Loot",
    };
  }
  const slot = item.slot;
  const def = isSlotRole(slot) ? slotsForArchetype(sheet.archetypeId)![slot] : null;
  const slotWord = def ? slotLabelFor(def) : ACCESSORY_SLOT_WORD[TEMPLATE_OF_ARCHETYPE[archetypeId]][slot as AccessoryRole];
  const needsAttunement = gearRequiresAttunement(archetypeId, slot, item.tier);
  const delta = wearDelta(sheet, slot, item.tier);

  const facts: string[] = [
    `Fits: ${slotWord}.`,
    `Rarity: ${TIER_WORD[item.tier]} (item bonus +${BONUS_BY_TIER[item.tier]}).`,
    effectSentence(sheet, slot, item.tier),
    needsAttunement ? attunementNeededLine(attunedCount(sheet)) : ATTUNEMENT_NOT_NEEDED_LINE,
  ];
  if (delta) facts.push(delta);
  if (!def) facts.push(...accessoryFacts(sheet, slot as AccessoryRole, item.tier).slice(1));

  const worn = gearRowOf(sheet, slot);
  const swap = worn ? ` Wearing it swaps out your ${worn.name}.` : "";
  const attune = needsAttunement ? ` Wearing it attunes you to it (at most ${MAX_ATTUNED_ITEMS} at once).` : "";

  return {
    name,
    kind: def ? slotPieceKind(def.bonusKind) : "accessory",
    summary: def
      ? `The ${TIER_WORD[item.tier].toLowerCase()} magic version of a ${def.nameByTier[0]}, not worn right now.`
      : accessorySummary(slot as AccessoryRole, accessoryEffect(slot, item.tier)),
    facts,
    inGame: `${APPLIES_LABEL} only once you wear it: it is in your bag, so it adds nothing yet.${swap}${attune} Gear can only be changed when nothing hostile is in the room and you are on your feet.`,
    source: "Loot",
  };
}

/** The healing every consumable in this game does, as characters/health.ts's `potionHealing` rolls it (a test pins the numbers to that function). */
const HEAL_NOTATION = "2d4+2";
const HEAL_MIN = 4;
const HEAL_MAX = 10;

/** The healing dice a consumable rolls, as notation, for callers that print it (inventory/itemActions.ts). */
export const CONSUMABLE_HEAL_NOTATION = HEAL_NOTATION;

/** What one stack of a consumable is, with the uses it has left. */
export function describeConsumable(c: Consumable, usesLeft: number = c.uses): ItemInfo {
  const left = Math.max(0, Math.floor(usesLeft));
  return {
    name: c.name,
    kind: "consumable",
    summary: clean(c.description),
    facts: [`Heals ${HEAL_NOTATION} hit points per use (${HEAL_MIN} to ${HEAL_MAX}).`, `Uses left: ${left}.`],
    inGame:
      left > 0
        ? `${APPLIES_LABEL}: press Item to use one. It heals ${HEAL_NOTATION} hit points, never past your maximum, and spends one use.`
        : `${APPLIES_LABEL}: none are left, so there is nothing to use until you find more.`,
  };
}

/** A consumable's info plus where it came from, when the sheet's own archetype says so. */
function consumableInfo(sheet: CharacterSheet, c: Consumable, usesLeft: number): ItemInfo {
  const info = describeConsumable(c, usesLeft);
  try {
    if (getArchetype(sheet.archetypeId).startingConsumables.some((s) => normKey(s.name) === normKey(c.name))) info.source = "Starting kit";
  } catch {
    // An archetype this table has never heard of: no source rather than a guess.
  }
  return info;
}

/** The consumable on a sheet that a carried name refers to ("Trauma kit" is both a flavour-list string and a three-use consumable). */
function consumableNamed(sheet: CharacterSheet, key: string): Consumable | undefined {
  return (sheet.consumables ?? []).find((c) => normKey(c.name) === key);
}

/** A DM's description of something it gave, matched on the exact name, the name without its count, or either one case-folded. */
function noteFor(notes: Readonly<Record<string, string>> | undefined, raw: string, base: string): string | null {
  if (!notes) return null;
  const wanted = new Set([normKey(raw), normKey(base)]);
  for (const [name, text] of Object.entries(notes)) {
    if (wanted.has(normKey(name)) && typeof text === "string" && clean(text)) return clean(text).slice(0, 400);
  }
  return null;
}

/** Whether this string is one of the archetype's own starting-kit names (counts and case ignored). */
function isStartingKit(sheet: CharacterSheet, key: string): boolean {
  try {
    return getArchetype(sheet.archetypeId).startingInventory.some((s) => normKey(splitCount(s).base) === key);
  } catch {
    return false;
  }
}

/**
 * One string off `sheet.inventory`: "Handaxe x2", "Explorer's pack", or
 * something the DM handed over. A catalogue entry wins; failing that, the
 * DM's own note for the name (`notes`) is used as the description; failing
 * that, the honest generic line. The stack count is parsed off the end and
 * reported as a fact.
 */
export function describeCarried(sheet: CharacterSheet, name: string, notes?: Readonly<Record<string, string>>): ItemInfo {
  const raw = name.trim();
  const { base, count } = splitCount(raw);
  const key = normKey(base);

  const consumable = consumableNamed(sheet, key);
  if (consumable) return consumableInfo(sheet, consumable, consumable.uses);

  const entry = lookup(key);
  if (entry) {
    const facts = [...entry.facts];
    const weapon = weaponFor(sheet);
    if (entry.engine && entry.engine.includes(weapon.name)) {
      facts.push(
        `In this game: ${weapon.damageDie} damage (${weapon.ranged ? "ranged" : "melee"}, ${weapon.hands === 2 ? "two hands" : "one hand"}), rolled with ${ABILITY_NAME[weapon.ability]}.`,
      );
    }
    const role = LOADOUT_GEAR_ROLE[sheet.archetypeId]?.[ALIASES[key] ?? key];
    const rowFact = role ? gearRowFact(sheet, base, role) : null;
    if (rowFact) facts.push(rowFact);
    if (count > 1) facts.push(`You carry ${count}.`);
    return {
      name: base,
      kind: entry.kind,
      summary: entry.summary,
      facts,
      inGame: entry.game(sheet),
      source: isStartingKit(sheet, key) ? "Starting kit" : "Found",
    };
  }

  const note = noteFor(notes, raw, base);
  return {
    name: base,
    kind: "item",
    summary: note ?? GENERIC_ITEM_SUMMARY,
    facts: count > 1 ? [`You carry ${count}.`] : [],
    inGame: DM_RULES_LINE,
    source: "Found",
  };
}

// ── the whole pack ──────────────────────────────────────────────────────

/** The bench's own healing potion, described in the words every other healing consumable uses (templates.ts's HEALING_DRAUGHT; a test pins the two together). */
const POTION_OF_HEALING: Consumable = {
  name: "Potion of healing",
  uses: 1,
  effect: "heal",
  description: "Drink it and some of the damage stops mattering: 2d4+2 hit points back.",
};

/**
 * The pack, section by section, in the order the inventory shows it: what is
 * worn, what is in the bag, what is carried (the flavour list MINUS the worn
 * kit it already named, via `packItems`, and minus anything that is really a
 * consumable, which is listed under Consumables with its uses), and the
 * consumables with uses left. `opts.potions`, when given, is the healing
 * potion count a host keeps itself, and replaces the sheet's own "Potion of
 * healing" uses.
 */
export function packInfo(
  sheet: CharacterSheet,
  opts?: { potions?: number; notes?: Readonly<Record<string, string>> },
): { label: string; items: ItemInfo[] }[] {
  const worn = GEAR_ROLES.map((role) => describeWorn(sheet, role)).filter((i): i is ItemInfo => i !== null);
  const bag = (sheet.bag ?? []).map((item) => describeBagItem(sheet, item));

  const consumableKeys = new Set((sheet.consumables ?? []).map((c) => normKey(c.name)));
  const carried = packItems(sheet)
    .filter((n) => !consumableKeys.has(normKey(splitCount(n).base)))
    .map((n) => describeCarried(sheet, n, opts?.notes));

  const stock: { c: Consumable; uses: number }[] = [];
  const potionKey = normKey(POTION_OF_HEALING.name);
  let potionPlaced = false;
  for (const c of sheet.consumables ?? []) {
    if (normKey(c.name) === potionKey && opts?.potions !== undefined) {
      stock.push({ c, uses: opts.potions });
      potionPlaced = true;
    } else {
      stock.push({ c, uses: c.uses });
    }
  }
  if (opts?.potions !== undefined && !potionPlaced) stock.unshift({ c: POTION_OF_HEALING, uses: opts.potions });
  const consumables = stock.filter((s) => s.uses > 0).map((s) => consumableInfo(sheet, s.c, s.uses));

  return [
    { label: "Worn", items: worn },
    { label: "Bag", items: bag },
    { label: "Carried", items: carried },
    { label: "Consumables", items: consumables },
  ];
}

/** The tip as display lines: what it is, its numbers, then what this game does with it. */
export function itemTipLines(info: ItemInfo): string[] {
  return [info.summary, ...info.facts, info.inGame];
}
