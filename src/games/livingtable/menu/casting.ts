/**
 * The Cast verb: what a caster can actually do with the spells `rules/
 * spells.ts` already defines.
 *
 * Before this module, `castSpell` had zero callers anywhere in `src/`, the
 * command menu had no Cast entry, and a character sheet cheerfully printed
 * "Spell slots: L1 0/2" for a Cleric and a Wizard whose slots nothing in the
 * app could ever decrement. Two of the four archetypes per template are
 * casters; a sheet advertising a resource the game has no verb for is worse
 * than omitting it, because the player hunts for the button and never finds
 * one.
 *
 * Cast routes exactly like Attack: local, engine-resolved, and free forever
 * (DESIGN.md's cost model prices combat, movement, search, items and levelling
 * at nothing). Nothing in here makes an AI call, so wiring it up does not move
 * a single credit.
 *
 * Scope note, stated rather than hidden: `CLERIC_SPELLS` / `WIZARD_SPELLS`
 * carry a name, a level and a description, but no mechanical effect, because
 * DESIGN.md's cut list covers the full SRD compendium and those lists are the
 * launch subset. `SPELL_EFFECTS` below is that missing mechanical half for
 * exactly those twelve spells, written from SRD 5.1, and it is keyed by name
 * so a spell added to `rules/spells.ts` without an effect here degrades to
 * "described, not castable" rather than crashing the menu.
 */
import { CLERIC_SPELLS, WIZARD_SPELLS, type SpellInfo, type SpellSlots } from "../rules/spells";
import type { AbilityScores } from "../rules/abilities";
import type { CharacterSheet } from "../characters/creation";
import type { Chassis } from "../characters/templates";
import { weaponIdentityFor } from "../session/combat";
import { activeCombatant, isPlayersTurn, tileDistanceFeet, type CombatRound } from "./combatRound";

/**
 * How the engine resolves a cast. Every variant routes into a resolver that
 * already exists (rules/combat.ts's resolveAttack + resolveDamage,
 * rules/checks.ts's resolveSavingThrow, the same heal path Item uses), which
 * is the point: casting adds a verb, not a second rules engine.
 */
export type SpellEffect =
  | { kind: "attack"; damage: string; damageType: string; attacks?: number; rangeFt: number }
  | { kind: "autohit"; damage: string; damageType: string; rangeFt: number }
  | { kind: "save"; ability: keyof AbilityScores; damage: string; damageType: string; halfOnSave: boolean; rangeFt: number }
  | { kind: "heal"; dice: string }
  | { kind: "utility"; note: string };

/**
 * SRD 5.1 mechanics for the twelve launch spells. `attacks` > 1 means the
 * spell rolls that many separate attack rolls, each doing `damage` (Scorching
 * Ray's three rays).
 *
 * `rangeFt` is here rather than on rules/spells.ts's `SpellInfo` for the same
 * reason the damage dice are: SpellInfo carries the name, the level and the
 * description a player reads, and this table is the mechanical half. It is
 * load-bearing, not decoration. The Cast row had no distance filter of ANY
 * kind, so an adversary put a wizard 85 feet from a skeleton and resolved a
 * 15-foot cone on it while the Attack button one row above correctly refused
 * the same target with "Too far away: 85 feet, and your reach is 5 feet." One
 * number per spell is what stops a touch spell, a cone and a 120-foot bolt
 * all being treated as the same distance.
 */
export const SPELL_EFFECTS: Record<string, SpellEffect> = {
  // Cleric
  "Sacred Flame": { kind: "save", ability: "dex", damage: "1d8", damageType: "radiant", halfOnSave: false, rangeFt: 60 },
  "Cure Wounds": { kind: "heal", dice: "1d8" },
  Bless: { kind: "utility", note: "Everyone with you steadies. No number on your sheet changes for it yet." },
  "Guiding Bolt": { kind: "attack", damage: "4d6", damageType: "radiant", rangeFt: 120 },
  // SRD 5.1's Spiritual Weapon is cast at a point within 60 feet and the
  // spectral weapon then attacks a creature within 5 feet of itself; with no
  // separate summoned token on the board, 60 feet is the honest reach of the
  // whole effect from where the caster is standing.
  "Spiritual Weapon": { kind: "attack", damage: "1d8", damageType: "force", rangeFt: 60 },
  "Lesser Restoration": { kind: "utility", note: "A disease or a lingering condition lifts. Conditions are not tracked on your sheet yet." },
  // Wizard
  "Fire Bolt": { kind: "attack", damage: "1d10", damageType: "fire", rangeFt: 120 },
  "Magic Missile": { kind: "autohit", damage: "3d4+3", damageType: "force", rangeFt: 120 },
  Shield: { kind: "utility", note: "A shimmer turns the next blow aside. Reactions are not tracked on your sheet yet." },
  // A 15-foot cone. Measured here as a plain distance to the target, which is
  // the simplification this board already makes everywhere else (Chebyshev
  // tiles, see world/reach.ts): the cone's shape is not modelled, its REACH
  // is, and 15 feet is three tiles.
  "Burning Hands": { kind: "save", ability: "dex", damage: "3d6", damageType: "fire", halfOnSave: true, rangeFt: 15 },
  "Scorching Ray": { kind: "attack", damage: "2d6", damageType: "fire", attacks: 3, rangeFt: 120 },
  "Misty Step": { kind: "utility", note: "You blink a short distance. Jumping across the board is not possible yet." },
};

/** SRD 5.1's "touch": the caster's own square and everything adjacent to it, which is one tile on this board. */
const TOUCH_RANGE_FT = 5;

/**
 * How far this spell reaches, in feet. A spell with no mechanical effect
 * defined (described but not castable, see this file's header) and a spell
 * whose effect names no range (a heal, a utility) both read as touch, which
 * is the SRD range of every such spell on the launch list and the safest
 * default besides: it can never let a spell reach further than it should.
 */
export function spellRangeFt(spellName: string): number {
  const effect = SPELL_EFFECTS[spellName];
  if (!effect) return TOUCH_RANGE_FT;
  return "rangeFt" in effect ? effect.rangeFt : TOUCH_RANGE_FT;
}

/** Which ability a chassis casts with, per SRD 5.1's class table: Cleric is Wisdom, Wizard is Intelligence. */
const CASTING_ABILITY: Partial<Record<Chassis, keyof AbilityScores>> = {
  cleric: "wis",
  wizard: "int",
};

export function castingAbilityFor(sheet: CharacterSheet): keyof AbilityScores | null {
  return CASTING_ABILITY[sheet.chassis] ?? null;
}

/** SRD 5.1: 8 + proficiency bonus + spellcasting ability modifier. The number a target has to beat on a save against this caster. */
export function spellSaveDc(sheet: CharacterSheet): number {
  const ability = castingAbilityFor(sheet);
  if (!ability) return 0;
  return 8 + sheet.proficiencyBonus + sheet.modifiers[ability];
}

/** SRD 5.1: proficiency bonus + spellcasting ability modifier, added to a spell attack roll. */
export function spellAttackBonus(sheet: CharacterSheet): number {
  const ability = castingAbilityFor(sheet);
  if (!ability) return 0;
  return sheet.proficiencyBonus + sheet.modifiers[ability];
}

/** The spell list for this character's chassis, empty for the two non-casting chassis. */
export function spellListFor(sheet: CharacterSheet): SpellInfo[] {
  if (sheet.chassis === "cleric") return CLERIC_SPELLS;
  if (sheet.chassis === "wizard") return WIZARD_SPELLS;
  return [];
}

export interface CastableSpell {
  spell: SpellInfo;
  effect: SpellEffect | undefined;
  available: boolean;
  /** Why it is greyed out, in words, or null when it is castable. */
  blockedReason: string | null;
}

/**
 * Every spell this character knows, each marked castable or not. A cantrip
 * (level 0) is always castable and costs no slot, per SRD 5.1; a levelled
 * spell needs a remaining slot OF THAT LEVEL, which is exactly the rule that
 * makes a level-3 "Mage" unable to cast Fireball and is why the
 * launch list stops where it does (see rules/spells.ts's own note).
 */
export function castableSpells(sheet: CharacterSheet): CastableSpell[] {
  return spellListFor(sheet).map((spell) => {
    const effect = SPELL_EFFECTS[spell.name];
    if (spell.level === 0) {
      return { spell, effect, available: true, blockedReason: null };
    }
    const bucket = sheet.spellSlots?.[spell.level];
    if (!bucket) {
      return {
        spell,
        effect,
        available: false,
        blockedReason: `You do not have level ${spell.level} spell slots yet. They arrive as you level up.`,
      };
    }
    if (bucket.used >= bucket.max) {
      return {
        spell,
        effect,
        available: false,
        blockedReason: `No level ${spell.level} slots left. A long rest gives them back.`,
      };
    }
    return { spell, effect, available: true, blockedReason: null };
  });
}

/**
 * Spend the slot for a cast, or return the slots unchanged for a cantrip.
 * Returns null when there was nothing left to spend, which the caller reports
 * as "no slots of that level remaining" rather than silently casting for free
 * -- the exact contract rules/spells.ts's castSpell already documents.
 */
export function spendSlotFor(slots: SpellSlots | null, spellLevel: number): SpellSlots | null | "cantrip" {
  if (spellLevel === 0) return "cantrip";
  if (!slots) return null;
  const bucket = slots[spellLevel];
  if (!bucket || bucket.used >= bucket.max) return null;
  return { ...slots, [spellLevel]: { max: bucket.max, used: bucket.used + 1 } };
}

/**
 * A caster's at-will attack, named as the cantrip it actually is -- but ONLY
 * when the Attack row genuinely resolves that cantrip.
 *
 * The original version returned any level-0 spell, which was right for a
 * Wizard and quietly wrong for a Cleric. The Attack row resolves an attack
 * ROLL off the character's own to-hit bonus (session/combat.ts), which for a
 * Wizard is Fire Bolt exactly: 1d10, off INT, on a d20 against AC. For a
 * Cleric it is a 1d6+STR mace swing, and labelling that "Sacred Flame"
 * produced two buttons with the same name and two completely different
 * resolutions on the same screen: menu/casting.ts defines Sacred Flame as a
 * Dexterity SAVE for 1d8 radiant. A cold reader who knows nothing about
 * tabletop games found it from the labels alone and said they would waste a
 * minute working out whether the two buttons did different things. They do.
 *
 * So the gate is the effect's own kind: a cantrip may name the Attack row
 * only if it is resolved the way the Attack row resolves things.
 */
export function cantripNameFor(sheet: CharacterSheet): string | null {
  const cantrip = spellListFor(sheet).find((s) => s.level === 0);
  if (!cantrip) return null;
  return SPELL_EFFECTS[cantrip.name]?.kind === "attack" ? cantrip.name : null;
}

/**
 * What the Attack row actually swings, by name.
 *
 * Straight off session/combat.ts's own equipped-weapon table, which is the
 * only thing that can be right: that table is what picks the damage die and
 * the ability, and it moves with the fighting style (a Knight who picked
 * Archery leads with the thrown handaxe). Any second source for this noun --
 * the first item in `startingInventory`, a hand-written field on the
 * archetype -- is a name that can disagree with the dice, which is the exact
 * class of defect that put a Cleric's mace swing on a button labelled "Sacred
 * Flame".
 *
 * `weaponIdentityFor`, not `weaponFor(sheet).name` alone (contract v2): the
 * weapon slot can be equipped above common now that loot exists, and its
 * current-tier name ("Dawnbreaker") is what the gear row and the rider line
 * already call it. Reading the base kit name here left the Attack row and
 * its on-canvas caption the one place in the app still calling a legendary
 * sword by its starting name.
 *
 * The reconciled `identity.label` is used only once the weapon slot is
 * actually AT a magic tier (`itemName !== baseItemName`): at common there is
 * nothing enchanted to disambiguate, and printing the parenthetical anyway
 * would have every Mage's Attack button read "Fire Bolt
 * (Quarterstaff)" from level one, never just "Fire Bolt".
 */
function isMagicWeaponTier(sheet: CharacterSheet): boolean {
  const identity = weaponIdentityFor(sheet);
  return identity.itemName !== null && identity.itemName !== identity.baseItemName;
}

export function attackWeaponName(sheet: CharacterSheet): string {
  const identity = weaponIdentityFor(sheet);
  return isMagicWeaponTier(sheet) ? identity.label : identity.weaponName;
}

/**
 * The on-canvas roll caption, in third person throughout.
 *
 * It used to build `${sheet.name} attacks ${target} with ${attackName}` where
 * attackName fell back to the literal string "your weapon", producing "Bram
 * attacks the goblin with your weapon" -- a sentence that changes person
 * mid-clause. An at-will attack cantrip is a proper noun and takes no article
 * ("with Fire Bolt"); anything else takes a possessive, and the sheet carries
 * no gender, so it is "their".
 *
 * A worn magic weapon (contract v2) is a proper noun too, by the identical
 * rule: "with Dawnbreaker", never "with their Dawnbreaker". `attackWeaponName`
 * above already carries the reconciled name -- "Dawnbreaker", or "Fire Bolt
 * (Sunstroke)" when the thing swung and the enchanted item differ -- so the
 * only question left is whether to prefix "their", and "is this a named
 * cantrip or a magic item" answers it exactly the way the gear row's own
 * reconciliation does.
 */
export function attackCaption(sheet: CharacterSheet, targetLabel: string): string {
  const identity = weaponIdentityFor(sheet);
  const weapon = attackWeaponName(sheet);
  const namedCantrip = cantripNameFor(sheet) === identity.weaponName;
  const properNoun = namedCantrip || isMagicWeaponTier(sheet);
  return `${sheet.name} attacks ${targetLabel} with ${properNoun ? weapon : `their ${weapon.toLowerCase()}`}`;
}

/**
 * Why the Cast button for this spell is unavailable right now, in words, or
 * null when it is castable.
 *
 * REGRESSION, adjacent: a previous pass wired reach into the Attack row and
 * left the Cast row completely open. `handleCast` checked busy, downed, whose
 * turn it is, the action economy and the spell slot, and never once asked how
 * far away the target was, so a 15-foot cone resolved at 85 feet against the
 * same target the Attack button one row above was correctly refusing. This is
 * deliberately the same function shape, the same sentence shape and the same
 * greyed-button-with-a-reason presentation `attackBlockedReason` already uses,
 * because that pattern is the one thing about the play screen both cold
 * readers found legible.
 */
export function castBlockedReason(args: {
  round: CombatRound | null;
  entry: CastableSpell;
  casterAt: { x: number; y: number } | undefined;
  targetAt: { x: number; y: number } | undefined;
  downed: boolean;
}): string | null {
  if (args.downed) return "You are on the floor. No spells until you are back up.";
  if (args.entry.blockedReason) return args.entry.blockedReason;
  if (!args.entry.effect) return `${args.entry.spell.name} is on your sheet, but the game cannot play it out yet.`;
  if (!args.casterAt) return "You are not standing in this room yet.";
  if (args.round && !isPlayersTurn(args.round)) return "It is not your turn yet.";
  if (args.round && !activeCombatant(args.round)?.economy.action) return "You have already taken your action this turn. End your turn to get it back.";

  if (!spellNeedsTarget(args.entry.effect)) return null;
  if (!args.targetAt) return "Nothing here to aim at.";
  const reach = spellRangeFt(args.entry.spell.name);
  const feet = tileDistanceFeet(args.casterAt, args.targetAt);
  if (feet > reach) return `Too far away: ${feet} feet, and ${args.entry.spell.name} reaches ${reach} feet. Move closer first.`;
  return null;
}

/** Whether this effect has to be aimed at something. A heal and a utility spell land on the caster, so distance never applies to them. */
export function spellNeedsTarget(effect: SpellEffect): boolean {
  return effect.kind !== "heal" && effect.kind !== "utility";
}
