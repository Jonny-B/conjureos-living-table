/**
 * Pure helpers for the command menu's LOCAL actions (Attack, Search, Item)
 * and for resolving a DM turn's `rollRequests`: deriving the real modifier a
 * roller should use, per DESIGN.md's "the engine looks up ITS OWN modifier
 * for this id; the model never supplies a modifier."
 *
 * This file also owns the two numbers the engine must never take from the
 * model at all: a defender's AC (`defenderACForRollRequest`) and a monster's
 * own statblock (`MONSTER_STATBLOCKS`). See those two sections below for why
 * a DM-supplied `targetAC` was a real hole rather than a cosmetic one.
 *
 * It also owns the small model of WHAT THE CHARACTER IS SWINGING
 * (`EngineWeapon`, `weaponFor`), which is what makes the SRD fighting styles
 * real: Dueling and Archery are both conditional on the weapon in hand, and
 * before this file knew a weapon could be ranged or one-handed there was no
 * condition either style could be evaluated against, so both were labels
 * attached to nothing.
 *
 * One genuine, documented gap is left here, because the data model it would
 * need doesn't exist yet in the subsystems this pass consumes (not something
 * this integration layer should invent a whole new system to paper over):
 * inventory items are plain strings with "no mechanical stat block of their
 * own yet" (DESIGN.md, characters/templates.ts's own comment), so a per-
 * archetype weapon table below stands in for "what you drew from your pack"
 * rather than the pack itself carrying stats, and a name-keyword heuristic
 * stands in for "this heals" in Item.
 */
import { DEFAULT_CRITICAL_ON } from "../rules/combat";
import { MANEUVERS, SUPERIORITY_DICE_POOL, maneuverSaveDC, type Maneuver } from "../rules/maneuvers";
import { resolveMagicWeaponRider } from "../rules/magicItems";
import type { DiceResult } from "../rules/dice";
import type { CheckResult } from "../rules/checks";
import type { AbilityScores } from "../rules/abilities";
import type { CharacterSheet, SkillProficiency } from "../characters/creation";
import { SKILL_ABILITY } from "../characters/creation";
import {
  accessoryStatus,
  armorSpeedPenaltyFt,
  equipmentArmorBonus,
  equipmentAttackBonus,
  equipmentBonusSources,
  equipmentCheckBonus,
  equipmentIssues,
  equipmentSaveBonus,
  equipmentStatus,
  itemNameFor,
  legendaryRiderFor,
  slotDefinition,
  type EquipmentContext,
  type EquipmentIssue,
  type SlotStatus,
} from "../characters/equipment";
import { gearItemKey, SLOT_ROLES, type BonusSource, type DamageType } from "../characters/equipmentTypes";
import type { Chassis } from "../characters/templates";
import { ABILITY_NAME } from "../menu/labels";
import type { AttackRollRequest, CheckRollRequest, RollRequest, SaveRollRequest } from "../dm/turnSchema";

/**
 * SRD 5.1's default speed for most player races (30 ft.). CharacterSheet
 * (characters/creation.ts) carries no `speed` field of its own yet, so the
 * local Move command uses this flat constant for every character rather
 * than reading a per-character value that doesn't exist. A real per-race
 * speed is a one-field addition to CharacterSheet whenever that lands; this
 * stands in until then.
 */
export const DEFAULT_SPEED_FT = 30;

// ── what the character is actually swinging ────────────────────────────
//
// The gap this closes, and it is the one a blind evaluation caught hardest:
// two of the three creation-time fighting styles were labels attached to
// nothing. Dueling ("+2 damage on melee attacks with a one-handed weapon")
// and Archery ("+2 to attack rolls made with ranged weapons") are both
// conditional on WHAT WEAPON IS IN YOUR HANDS, and this file's model of a
// weapon was one damage die per chassis with no notion of melee vs. ranged
// and no notion of how many hands it took. There was therefore no condition
// either style could be evaluated against, so neither one was, and both
// judges in the blind test spent their only build decision on one of them.
//
// This is the missing data, and deliberately no more than the missing data:
// per archetype, the one weapon the engine treats as equipped, plus (where
// the kit genuinely carries one) the other range band it can switch to. Full
// inventory-as-mechanical-items is still the documented gap in this file's
// header; this closes only the part two real player choices depend on.

export interface EngineWeapon {
  /** Fiction name, matching the archetype's own `startingInventory` entry in templates.ts. */
  name: string;
  /** The damage die alone, with no ability modifier folded in; `weaponDamageNotationFor` adds that. */
  damageDie: string;
  /** True for a bow, a rifle, a thrown axe, an attack cantrip: anything resolved at range. This is the fact SRD Archery keys off. */
  ranged: boolean;
  /**
   * True when this weapon is wielded in one hand with nothing else
   * weapon-shaped in the other, which is SRD Dueling's exact condition
   * ("wielding a melee weapon in one hand and no other weapons"). A shield
   * is not a weapon, so a sword-and-board Knight qualifies; a two-handed
   * rifle and a bow do not.
   */
  duelable: boolean;
  /**
   * How many hands this weapon occupies while it is in use: 1 or 2.
   *
   * Separate from `duelable` even though the two overlap, because they answer
   * different questions and a sidearm is the case that proves it: a suppressed
   * sidearm is one-handed (so a shield could ride in the other hand) and NOT
   * duelable (SRD Dueling is a melee-only style). Deriving hands from
   * `duelable` would have quietly told the engine that every ranged weapon in
   * the game takes two hands.
   *
   * This is the fact SRD 5.1's shield rule keys off: "a shield is made from
   * wood or metal and is carried in one hand," so a two-handed weapon leaves
   * no hand for one. See characters/equipment.ts's `equipmentStatus`.
   */
  hands: 1 | 2;
  /** Which ability drives both the attack roll and the damage roll for it. */
  ability: keyof AbilityScores;
}

/** The primary weapon an archetype fights with, plus the other range band its `startingInventory` covers when it covers one. */
interface ArchetypeKit {
  primary: EngineWeapon;
  alternate?: EngineWeapon;
}

/**
 * Per-archetype, because two reskins of one chassis genuinely do not fight
 * the same way: the Knight leads with a longsword and the Trooper with a
 * plasma rifle, and that difference is the whole reason templates.ts offers
 * them different fighting styles in the first place. Every entry is read
 * straight off that archetype's own `startingInventory`.
 *
 * NAMES ARE THE GEAR TABLE'S NAMES wherever the two tables describe the same
 * object, and that is a rule now rather than a coincidence. The gear row on
 * the character sheet reads its noun out of `SLOTS_BY_ARCHETYPE.weapon`
 * ("Shortblade", "Plasma Rifle", "Stun Baton") and the attack line reads its
 * noun out of this table, so the two spelling each object differently
 * ("Shortsword" against "Shortblade", "Sidearm (suppressed)" against
 * "Sidearm") meant a player was told they carry one thing and swing another.
 * Where they genuinely ARE two things -- a Wizard's Fire Bolt cast through a
 * quarterstaff, a Psion's Neural Lash channelled through a neural focus, a
 * Knight who picked Archery leading with a thrown handaxe rather than the
 * enchanted longsword -- the difference is real and `weaponIdentityFor` below
 * names BOTH rather than picking one and hoping.
 *
 * Ability assignments preserve what `ATTACK_ABILITY_BY_CHASSIS` produced
 * before this table replaced it, deliberately: the Trooper moving from STR
 * to DEX is the one change, and it is a wash in practice (STR 14 and DEX 15
 * are both +2 at level 1) while being the SRD-correct ability for a ranged
 * weapon. Nothing else's numbers move.
 */
const KIT_BY_ARCHETYPE: Record<string, ArchetypeKit> = {
  // Longsword in one hand, shield in the other: Dueling's textbook case.
  // The thrown handaxes are the ranged option templates.ts's own comment
  // cites as this kit's backing for Archery.
  knight: {
    primary: { name: "Longsword", damageDie: "1d8", ranged: false, duelable: true, hands: 1, ability: "str" },
    alternate: { name: "Thrown handaxe", damageDie: "1d6", ranged: true, duelable: false, hands: 1, ability: "str" },
  },
  // A rifle is two-handed and ranged: Archery applies, Dueling never can,
  // which is exactly why templates.ts doesn't offer this kit Dueling.
  trooper: {
    primary: { name: "Plasma Rifle", damageDie: "1d8", ranged: true, duelable: false, hands: 2, ability: "dex" },
  },
  shadow: {
    primary: { name: "Shortblade", damageDie: "1d6", ranged: false, duelable: true, hands: 1, ability: "dex" },
    alternate: { name: "Shortbow", damageDie: "1d6", ranged: true, duelable: false, hands: 2, ability: "dex" },
  },
  infiltrator: {
    primary: { name: "Sidearm", damageDie: "1d6", ranged: true, duelable: false, hands: 1, ability: "dex" },
  },
  healer: {
    primary: { name: "Mace", damageDie: "1d6", ranged: false, duelable: true, hands: 1, ability: "str" },
  },
  medic: {
    primary: { name: "Stun Baton", damageDie: "1d6", ranged: false, duelable: true, hands: 1, ability: "str" },
  },
  "fireball-person": {
    primary: { name: "Fire Bolt", damageDie: "1d10", ranged: true, duelable: false, hands: 1, ability: "int" },
  },
  psion: {
    primary: { name: "Neural Lash", damageDie: "1d10", ranged: true, duelable: false, hands: 1, ability: "int" },
  },
};

/**
 * The kit for a chassis whose archetype id isn't in the table above: a sheet
 * stored before an archetype was renamed, or a ninth archetype added without
 * a kit entry. Same numbers the old per-chassis constants produced, so an
 * unknown archetype degrades to exactly the behaviour that shipped before
 * this table existed rather than to nothing.
 */
const FALLBACK_KIT_BY_CHASSIS: Record<Chassis, ArchetypeKit> = {
  fighter: { primary: { name: "Weapon", damageDie: "1d8", ranged: false, duelable: true, hands: 1, ability: "str" } },
  rogue: { primary: { name: "Weapon", damageDie: "1d6", ranged: false, duelable: true, hands: 1, ability: "dex" } },
  cleric: { primary: { name: "Weapon", damageDie: "1d6", ranged: false, duelable: true, hands: 1, ability: "str" } },
  wizard: { primary: { name: "Attack cantrip", damageDie: "1d10", ranged: true, duelable: false, hands: 1, ability: "int" } },
};

/** The creation-time fighting style this character locked in ("defense" | "dueling" | "archery"), or undefined for a chassis that never picks one. */
export function fightingStyleOf(sheet: CharacterSheet): string | undefined {
  return sheet.choices?.fightingStyle;
}

/**
 * Which weapon the engine treats this character as having in hand.
 *
 * A chosen fighting style SELECTS the weapon when the kit offers one that
 * the style can apply to. That is the honest way to make a choice matter in
 * a game that models one equipped weapon at a time: a Knight who picked
 * Archery is a Knight who leads with the thrown axe, trading the longsword's
 * bigger die for +2 to hit. The alternative -- leaving the longsword equipped
 * and letting Archery apply to nothing -- is the exact "a label with no
 * implementation" failure this whole section exists to end, and it would be
 * invisible to the player who picked it.
 */
export function weaponFor(sheet: CharacterSheet): EngineWeapon {
  const kit = KIT_BY_ARCHETYPE[sheet.archetypeId] ?? FALLBACK_KIT_BY_CHASSIS[sheet.chassis];
  const style = fightingStyleOf(sheet);
  if (style === "archery") {
    if (kit.primary.ranged) return kit.primary;
    if (kit.alternate?.ranged) return kit.alternate;
  }
  if (style === "dueling") {
    if (kit.primary.duelable) return kit.primary;
    if (kit.alternate?.duelable) return kit.alternate;
  }
  return kit.primary;
}

/**
 * SRD 5.1, Archery: "You gain a +2 bonus to attack rolls you make with
 * ranged weapons." Zero for every other style, every other chassis, and for
 * an Archery pick swinging something that isn't ranged -- the style is
 * conditional in the ruleset and stays conditional here, which is why it is
 * computed at roll time rather than baked into a flat sheet number the way
 * Defense's unconditional +1 AC legitimately is.
 */
export const ARCHERY_ATTACK_BONUS = 2;

/** SRD 5.1, Dueling: "+2 bonus to damage rolls" with a one-handed melee weapon and no other weapon in hand. Same conditional-at-roll-time reasoning as Archery above. */
export const DUELING_DAMAGE_BONUS = 2;

export function archeryBonusFor(sheet: CharacterSheet, weapon: EngineWeapon = weaponFor(sheet)): number {
  return fightingStyleOf(sheet) === "archery" && weapon.ranged ? ARCHERY_ATTACK_BONUS : 0;
}

export function duelingBonusFor(sheet: CharacterSheet, weapon: EngineWeapon = weaponFor(sheet)): number {
  return fightingStyleOf(sheet) === "dueling" && !weapon.ranged && weapon.duelable ? DUELING_DAMAGE_BONUS : 0;
}

export function attackerBonusFor(sheet: CharacterSheet): number {
  const weapon = weaponFor(sheet);
  return sheet.modifiers[weapon.ability] + sheet.proficiencyBonus + archeryBonusFor(sheet, weapon) + equipmentAttackBonus(sheet);
}

/** Dice notation ("1d8+2") for this character's equipped weapon or cantrip, ready for rules/combat.ts's resolveDamage, with Dueling's +2 and any magic weapon's +N already in the modifier when they apply. */
export function weaponDamageNotationFor(sheet: CharacterSheet): string {
  const weapon = weaponFor(sheet);
  const mod = sheet.modifiers[weapon.ability] + duelingBonusFor(sheet, weapon) + equipmentAttackBonus(sheet);
  return `${weapon.damageDie}${mod >= 0 ? "+" : ""}${mod}`;
}

// ── equipment: the one route a magic item's number takes to a d20 ──────
//
// SRD 5.1 magic items are the first system in this game that adds a number to
// a roll AFTER character creation, which makes them the first plausible route
// by which a number the engine did not compute could reach a d20. The whole
// defence is structural rather than vigilant: a character sheet stores a TIER
// (one word from a four-item frozen list) and never a bonus, and the bonus is
// looked up in `BONUS_BY_TIER` on every read, here, in the same adapter layer
// that already turns a fighting style into a number.
//
// Nothing in `rules/` learned about equipment to make this work. The bonus
// lands inside `attackerBonusFor`, which is the number `resolveAttack` already
// compares against an AC, so a magic sword reaches the d20 through the exact
// channel the proficiency bonus does. That is the requirement, and it is why
// there is no new parameter on any function in rules/combat.ts.
//
// Ownership of the arithmetic itself is one layer further down again, in
// rules/magicItems.ts, which takes plain numbers and knows nothing about a
// sheet. characters/equipment.ts is the table reader in between.

/** Everything characters/equipment.ts needs from this file to judge SRD legality: how many hands the weapon actually in use takes, and what it is called so a refusal can name it. This module is the only one that knows what is in the character's hands. */
export function equipmentContextFor(sheet: CharacterSheet): EquipmentContext {
  const weapon = weaponFor(sheet);
  return { weaponHands: weapon.hands, weaponName: weapon.name };
}

// -- what is in the hand, and what is enchanted, when they are not the same --
//
// Two tables name the character's weapon and they answer different questions.
// KIT_BY_ARCHETYPE above says what the ENGINE rolls: the damage die, the
// ability, the range band, and it moves with the fighting style. The gear
// table's `weapon` slot says what is ENCHANTED: the object the rarity ladder
// acts on, the thing `equipmentAttackBonus` reads a tier off.
//
// For six of the eight archetypes those are one object and the two tables now
// spell it identically. For the other two, plus any archetype whose fighting
// style selects its alternate weapon, they are genuinely two, and pretending
// otherwise printed sentences that were simply false: a legendary Sunstroke on
// a Fireball Person logged "Sunstroke: 4 fire damage" against an attack the
// engine had resolved as a Fire Bolt, and an Archery Knight's +1 was labelled
// "Keen Longsword" on a thrown handaxe. Naming both is the only honest answer,
// and it is one function so no readout can invent a sixth way to phrase it.

export interface WeaponIdentity {
  /** What the engine actually rolled with, off KIT_BY_ARCHETYPE: "Fire Bolt", "Thrown handaxe", "Longsword". */
  weaponName: string;
  /** The enchanted item in the weapon slot AT ITS CURRENT TIER ("Dawnbreaker"), or null for an archetype with no slot table. */
  itemName: string | null;
  /** The same slot's COMMON-tier name ("Longsword"). The comparison anchor: a tier renames the same object, so comparing against the tier name would call every upgraded weapon a mismatch. */
  baseItemName: string | null;
  /** True when the enchanted item is not the thing being swung. */
  differs: boolean;
  /** The one label every readout uses: the item's name when they agree, "<weapon> (<item>)" when they do not. */
  label: string;
}

/**
 * Reconcile the two, once, so the dice log, the gear row and the rider line
 * cannot come to three different answers.
 */
export function weaponIdentityFor(sheet: CharacterSheet): WeaponIdentity {
  const weaponName = weaponFor(sheet).name;
  const role = SLOT_ROLES.find((r) => slotDefinition(sheet, r)?.bonusKind === "weapon");
  const definition = role ? slotDefinition(sheet, role) : null;
  const itemName = role ? itemNameFor(sheet, role) : null;
  const baseItemName = definition ? definition.nameByTier[0] : null;
  const differs = baseItemName !== null && baseItemName !== weaponName;
  const label = itemName === null ? weaponName : differs ? `${weaponName} (${itemName})` : itemName;
  return { weaponName, itemName, baseItemName, differs, label };
}

/** The weapon-slot gear lines of a readout, relabelled so the line names the weapon that was actually swung as well as the item the bonus came off. */
function equipmentWeaponSourcesFor(sheet: CharacterSheet): readonly BonusSource[] {
  const identity = weaponIdentityFor(sheet);
  return equipmentBonusSources(sheet, "weapon", equipmentContextFor(sheet)).map((source) =>
    source.label === identity.itemName ? { ...source, label: identity.label } : source,
  );
}

/** Every equipped slot, resolved against the weapon in hand: what it is, what it is worth, and whether SRD 5.1 is currently allowing it. */
export function equipmentStatusFor(sheet: CharacterSheet): readonly SlotStatus[] {
  return equipmentStatus(sheet, equipmentContextFor(sheet));
}

/**
 * The equipped items whose bonus is being refused right now, and why: a shield
 * that has no hand to be carried in is the case that exists in the shipped
 * table (the Trooper's riot shield against their two-handed plasma rifle).
 *
 * Surfaced as its own list rather than folded into a silent zero because a
 * player who cannot see why their shield does nothing will read it as a bug in
 * the maths, which is the same complaint the fighting styles earned before they
 * were real.
 */
export function equipmentIssuesFor(sheet: CharacterSheet): readonly EquipmentIssue[] {
  return equipmentIssues(sheet, equipmentContextFor(sheet));
}

/**
 * THE AC READER. Every caller that needs to know how hard this character is to
 * hit calls this, never `sheet.armorClass`.
 *
 * `sheet.armorClass` is computed once at creation and stored, and it keeps
 * meaning exactly what it has always meant: AC from armour, DEX and a fighting
 * style. Equipment is strictly additive on top and is DERIVED here rather than
 * written back into that field, because a stored derived number goes stale the
 * first time something forgets to recompute it, and a stale AC on a character
 * sheet is the failure `defenderACForRollRequest` already exists to end. If the
 * number the DM is told and the number the d20 is compared against are ever
 * two different numbers again, that fix has half-regressed.
 */
export function effectiveArmorClass(sheet: CharacterSheet): number {
  return sheet.armorClass + equipmentArmorBonus(sheet, equipmentContextFor(sheet));
}

/**
 * This character's walking speed in feet, after SRD 5.1's armour Strength
 * requirement AND (contract v2) a worn, active Boots of Speed's `factor`.
 *
 * SRD: heavy armour "reduces the wearer's speed by 10 feet unless the wearer
 * has a Strength score equal to or higher than the listed score." Every
 * archetype this game ships clears its own requirement at creation (the Knight
 * and Trooper both wear chain mail and both have STR 13 or better), so the
 * penalty term returns 0 for the shipped roster. It exists because the
 * requirement has to be real BEFORE something moves a Strength score, not
 * after: a rule the engine only learns once it has already been broken is not
 * a rule.
 *
 * ORDER MATTERS, per the contract's own words: the armour penalty applies
 * FIRST, then the multiplier. A character in heavy armour they cannot carry,
 * wearing Boots of Speed, moves at (30 - 10) x 2 = 40, not (30 x 2) - 10 = 50:
 * SRD 5.1's own Boots of Speed reads "double your walking speed", i.e. double
 * whatever your speed already is, penalty included.
 */
export function effectiveSpeedFt(sheet: CharacterSheet): number {
  const afterArmor = speedBeforeBootsFt(sheet);
  const boots = accessoryStatus(sheet, "boots");
  if (boots.active && boots.effect?.kind === "speedMultiplier") return afterArmor * boots.effect.factor;
  return afterArmor;
}

/**
 * Walking speed after the armour penalty and BEFORE any boots multiplier: the
 * "<base>" in the Boots of Speed sentence ("Double walking speed in a fight:
 * <base> feet becomes <base x factor>"). Reading `effectiveSpeedFt` there
 * instead would double-count a pair that is already worn (60 becomes 120).
 */
export function speedBeforeBootsFt(sheet: CharacterSheet): number {
  return Math.max(0, DEFAULT_SPEED_FT - armorSpeedPenaltyFt(sheet));
}

/** A legendary weapon's extra damage, rolled and typed, or null when the weapon slot is not legendary. */
export interface RiderDamage {
  roll: DiceResult;
  damageType: DamageType;
  /** What the dice log says burned: the weapon that was actually swung, and the enchanted item it came off when those are two different things ("Fire Bolt (Sunstroke)"). Built by `weaponIdentityFor`, which is the only place that reconciliation happens. */
  source: string;
}

/**
 * Roll a legendary weapon's rider, SRD 5.1 "Flame Tongue" shape: extra damage
 * dice of a named type on a hit.
 *
 * Called AFTER a hit lands and added to the total once. Deliberately its own
 * `resolveDamage` call rather than concatenated into the weapon's own notation:
 * `parseDiceNotation` accepts exactly one "NdS" term, so "1d8+1d6+5" is not
 * even parseable, and a critical doubles damage DICE, so folding a rider into
 * the weapon's notation would change what gets doubled. `critical` is threaded
 * through because the SRD doubles the damage dice of the ATTACK, and a magic
 * weapon's extra dice are dice of that attack.
 */
export function legendaryRiderDamageFor(sheet: CharacterSheet, rng: () => number = Math.random, critical = false): RiderDamage | null {
  const rider = legendaryRiderFor(sheet);
  if (!rider) return null;
  return {
    roll: resolveMagicWeaponRider(rider.bonusDamage, rng, critical),
    damageType: rider.damageType,
    // `weaponIdentityFor().label`, not the item name alone. A Fireball Person
    // with a legendary staff resolves their attack as a Fire Bolt, and a dice
    // log reading "Sunstroke: 4 fire damage" beside an attack line reading
    // "Fire Bolt" names a weapon that was never swung. The label names the
    // weapon first and the item that lit it second.
    source: weaponIdentityFor(sheet).label,
  };
}

// ── naming the source, so a player can see WHY they hit ────────────────
//
// The gap this closes: `attackLine` prints "rolled 9, +5 = 14, needed 13 to
// hit", and +5 is an unexplained lump. It was survivable while +5 was always
// the same +5; equipment makes it a number that moves between fights, and a
// number that moves for reasons the player cannot see is indistinguishable from
// a number the game is making up.
//
// THE ONE HARD RULE for this shape, and it is the reason these functions live
// beside the ones that produce the modifier rather than in the UI: the amounts
// must sum to the modifier that was actually rolled. A breakdown that does not
// add up is worse than no breakdown, because it looks authoritative. Every one
// of these is asserted against its own bonus function in the rules test.

/** How a modifier is spelled out on screen: one line per real contributor, gear named by item. Ability and proficiency travel together because SRD applies proficiency to a roll, not to an ability. */
export function attackBonusSourcesFor(sheet: CharacterSheet): readonly BonusSource[] {
  const weapon = weaponFor(sheet);
  const sources: BonusSource[] = [
    { label: `${ABILITY_NAME[weapon.ability]} and training`, amount: sheet.modifiers[weapon.ability] + sheet.proficiencyBonus },
  ];
  const archery = archeryBonusFor(sheet, weapon);
  if (archery !== 0) sources.push({ label: "Archery", amount: archery });
  sources.push(...equipmentWeaponSourcesFor(sheet));
  return sources;
}

/** The same breakdown for the damage roll's flat modifier, which is what `weaponDamageNotationFor` puts after the die. */
export function damageBonusSourcesFor(sheet: CharacterSheet): readonly BonusSource[] {
  const weapon = weaponFor(sheet);
  const sources: BonusSource[] = [{ label: ABILITY_NAME[weapon.ability], amount: sheet.modifiers[weapon.ability] }];
  const dueling = duelingBonusFor(sheet, weapon);
  if (dueling !== 0) sources.push({ label: "Dueling", amount: dueling });
  sources.push(...equipmentWeaponSourcesFor(sheet));
  return sources;
}

/** And for a saving throw. Training is folded into the ability line when the character has it, matching how the sheet's own `saves` entry already reports one number. */
export function saveBonusSourcesFor(sheet: CharacterSheet, ability: keyof AbilityScores): readonly BonusSource[] {
  const trained = sheet.saves.find((s) => s.ability === ability);
  const sources: BonusSource[] = [
    trained
      ? { label: `${ABILITY_NAME[ability]} and training`, amount: trained.bonus }
      : { label: ABILITY_NAME[ability], amount: sheet.modifiers[ability] },
  ];
  sources.push(...equipmentBonusSources(sheet, "save", equipmentContextFor(sheet)));
  return sources;
}

// ── monster statblocks ─────────────────────────────────────────────────
//
// The gap this closes: every monster used to be the same monster. Five flat
// DEFAULT_MONSTER_* constants (AC 13, +3 to hit, +1 to every save, 12 HP,
// 1d6+2) stood in for whatever token the DM had placed, so the manifest's
// four distinct sprites (token_goblin, token_skeleton, token_raider,
// token_drone) promised four creatures in the fiction and delivered one
// creature four times in the mechanics. DESIGN.md's cut list says "more than
// a handful of monster statblocks" is out of scope for launch, which means a
// handful is IN scope; this is that handful.
//
// Licensing, because it constrains what may go in this table: the fantasy
// pair are SRD 5.1 creatures used directly under the existing CC-BY-4.0
// attribution, numbers unchanged. The sci-fi pair are numeric RESKINS of SRD
// statblocks under their own names (a Raider is the SRD Bandit's numbers, a
// Drone is the SRD Flying Sword's), never an import of non-SRD named content.

export interface MonsterStatblock {
  /** In-fiction name, for dice-log and prompt text; never an asset id. */
  name: string;
  armorClass: number;
  /** SRD "Hit Points" average, the number the statblock prints before the hit dice in parentheses. */
  maxHp: number;
  /** The creature's to-hit bonus on its listed attack, SRD "+N to hit". */
  attackBonus: number;
  damageNotation: string;
  /**
   * The creature's six ability modifiers, which is exactly what an SRD
   * saving throw AND an SRD ability check use for a creature with no
   * proficiency listed in either -- and none of these four statblocks lists
   * a save or skill proficiency. One record rather than a separate
   * `saveModifiers` and `skillModifiers` pair, because for this handful they
   * would be the same six numbers written down twice.
   */
  abilityModifiers: Record<keyof AbilityScores, number>;
}

/**
 * Keyed by the manifest's token asset id, so the lookup is "what sprite is
 * standing there," which is the only creature identity the World actually
 * carries (world/cell.ts's PlacedToken is {id, assetId, x, y, kind}).
 */
export const MONSTER_STATBLOCKS: Record<string, MonsterStatblock> = {
  // SRD 5.1, Goblin (CR 1/4): AC 15 (leather armor, shield), 7 hp (2d6),
  // STR 8, DEX 14, CON 10, INT 10, WIS 8, CHA 8. Scimitar: +4 to hit,
  // 1d6+2 slashing. Fragile and quick: it dies to one good hit and it is
  // harder to hit back than anything else on this list bar the drone.
  token_goblin: {
    name: "Goblin",
    armorClass: 15,
    maxHp: 7,
    attackBonus: 4,
    damageNotation: "1d6+2",
    abilityModifiers: { str: -1, dex: 2, con: 0, int: 0, wis: -1, cha: -1 },
  },
  // SRD 5.1, Skeleton (CR 1/4): AC 13 (armor scraps), 13 hp (2d8+4),
  // STR 10, DEX 14, CON 15, INT 6, WIS 8, CHA 5. Shortsword: +4 to hit,
  // 1d6+2 piercing. The mirror image of the goblin: easy to hit, takes
  // nearly twice as much killing. The SRD gives both creatures the same
  // weapon die (1d6+2 for a scimitar and a shortsword alike), and that is
  // left accurate rather than nudged apart for variety's sake -- the real
  // difference between fighting these two is AC, HP and CON, and those are
  // genuinely different here.
  token_skeleton: {
    name: "Skeleton",
    armorClass: 13,
    maxHp: 13,
    attackBonus: 4,
    damageNotation: "1d6+2",
    abilityModifiers: { str: 0, dex: 2, con: 2, int: -2, wis: -1, cha: -3 },
  },
  // Sci-fi reskin of SRD 5.1's Bandit (CR 1/8): AC 12 (leather armor),
  // 11 hp (2d8+2), STR 11, DEX 12, CON 12, INT 10, WIS 10, CHA 10, light
  // crossbow +3 to hit for 1d8+1 -- read here as a scavenged sidearm. Own
  // name, SRD numbers; nothing about the source creature's flavour text,
  // name or non-SRD kin comes across.
  token_raider: {
    name: "Raider",
    armorClass: 12,
    maxHp: 11,
    attackBonus: 3,
    damageNotation: "1d8+1",
    abilityModifiers: { str: 0, dex: 1, con: 1, int: 0, wis: 0, cha: 0 },
  },
  // Sci-fi reskin of SRD 5.1's Flying Sword (CR 1/4): AC 17 (natural
  // armor), 17 hp (5d6), STR 12, DEX 15, CON 11, INT 1, WIS 5, CHA 1,
  // +3 to hit for 1d8+1. An autonomous flying weapon platform is what that
  // statblock already is mechanically, so the reskin is a rename and
  // nothing else. Its terrible INT/WIS/CHA modifiers are the point: a drone
  // fails a mind-affecting save that a raider shrugs off.
  token_drone: {
    name: "Combat Drone",
    armorClass: 17,
    maxHp: 17,
    attackBonus: 3,
    damageNotation: "1d8+1",
    abilityModifiers: { str: 1, dex: 2, con: 0, int: -5, wis: -3, cha: -5 },
  },
};

/**
 * The last-resort numbers for a token the manifest has no statblock for: an
 * NPC sprite the DM has decided to make hostile, a companion turning on the
 * party, anything the four entries above don't cover. Same values the old
 * flat DEFAULT_MONSTER_* constants carried (roughly a low-level SRD
 * skirmisher, split down the middle between goblin and skeleton), now scoped
 * to the one case where there is genuinely nothing better to use rather than
 * applied to every creature in the game.
 */
export const FALLBACK_MONSTER_STATBLOCK: MonsterStatblock = {
  name: "Hostile",
  armorClass: 13,
  maxHp: 12,
  attackBonus: 3,
  damageNotation: "1d6+2",
  abilityModifiers: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
};

/**
 * The six neutral NPC token ids added with the art roster (token_villager,
 * token_robed_figure, token_guard, token_technician, token_civilian,
 * token_officer) deliberately have NO entry above: they are non-combatants,
 * not monsters, and the game should not ship a statblock implying otherwise.
 * If the DM does place one as hostile, `lookupStatblock` returns undefined and
 * `statblockFor` degrades to FALLBACK_MONSTER_STATBLOCK, which is exactly the
 * path test/livingtable-rules.test.ts already pins for token_knight. Giving a
 * guard real numbers is a content decision for whoever wants a hostile guard,
 * not a gap to paper over here.
 */

/** The statblock for this token asset id, or undefined when there is none. Callers that need to know "does the manifest ship real numbers for this creature" use this; callers that need a number to actually roll against use `statblockFor`, which never returns undefined. Note that `defenderACForRollRequest` deliberately uses the latter: an absent statblock must degrade to the engine's own fallback, never to anything the model wrote. */
export function lookupStatblock(assetId: string | null | undefined): MonsterStatblock | undefined {
  if (!assetId) return undefined;
  return MONSTER_STATBLOCKS[assetId];
}

/** Always returns a usable statblock, falling back to FALLBACK_MONSTER_STATBLOCK for an unknown token. */
export function statblockFor(assetId: string | null | undefined): MonsterStatblock {
  return lookupStatblock(assetId) ?? FALLBACK_MONSTER_STATBLOCK;
}

/** This creature's AC for the LOCAL Attack command, which has no RollRequest to read a targetAC off in the first place. */
export function monsterArmorClassFor(assetId: string | null | undefined): number {
  return statblockFor(assetId).armorClass;
}

/** This creature's damage die for a DM-requested attack that lands on the player. The rollRequests schema deliberately has nowhere for the model to name a damage die (DESIGN.md: the model never supplies a numeric outcome), so it comes from here. */
export function monsterDamageNotationFor(assetId: string | null | undefined): string {
  return statblockFor(assetId).damageNotation;
}

// ── monster hit points, on the token ───────────────────────────────────
//
// HP used to live in a plain React useState record in LivingTable.tsx, which
// meant it was never written to games-db, never part of the World, and never
// in the playspace the DM is shown: a goblin at 2 HP was back to full after a
// reload, and the DM was never told it had been hurt at all, which is why it
// could never have a wounded monster flee. `currentHp` is an optional field
// on world/cell.ts's PlacedToken now, so it persists through ltCellAssemble
// like every other cell mutation. Optional rather than required because a
// freshly placed token has taken no damage yet and "absent" reads as "at its
// statblock maximum" without every placeToken having to compute one.

/** Just the two fields these helpers need off a PlacedToken, so they stay usable on a plain object in tests as well as on a real token. */
export interface MonsterHpToken {
  assetId: string;
  currentHp?: number;
}

/** This token's current HP: what it has left if it has been hurt, else its statblock maximum. */
export function monsterCurrentHp(token: MonsterHpToken): number {
  return token.currentHp ?? statblockFor(token.assetId).maxHp;
}

/**
 * Apply damage to a token. SRD 5.1: damage reduces current hit points and
 * "when a creature drops to 0 hit points, it either dies outright or falls
 * unconscious," so HP floors at 0 rather than going negative, and `down` is
 * the flag the caller uses to decide whether the token leaves the board.
 */
export function damageMonster(token: MonsterHpToken, amount: number): { currentHp: number; down: boolean } {
  const currentHp = Math.max(0, monsterCurrentHp(token) - Math.max(0, amount));
  return { currentHp, down: currentHp <= 0 };
}

/**
 * DEPRECATED, kept only so an unconverted call site still compiles: these are
 * FALLBACK_MONSTER_STATBLOCK's fields, which means using one is the same as
 * asserting the creature in front of you has no statblock. Every call site
 * that knows which token it is looking at should read the statblock instead
 * (`monsterArmorClassFor`, `monsterDamageNotationFor`, `monsterCurrentHp`).
 */
export const DEFAULT_MONSTER_AC = FALLBACK_MONSTER_STATBLOCK.armorClass;
export const DEFAULT_MONSTER_ATTACK_MODIFIER = FALLBACK_MONSTER_STATBLOCK.attackBonus;
export const DEFAULT_MONSTER_SAVE_MODIFIER = FALLBACK_MONSTER_STATBLOCK.abilityModifiers.dex;
export const DEFAULT_MONSTER_HP = FALLBACK_MONSTER_STATBLOCK.maxHp;
export const DEFAULT_MONSTER_DAMAGE_NOTATION = FALLBACK_MONSTER_STATBLOCK.damageNotation;

/**
 * A skill's real bonus off the character sheet when the character is trained
 * in it, else the bare ability modifier, the same "proficiency only if
 * trained" rule every SRD check follows, PLUS (contract v2) a worn, active
 * Stone of Good Luck's `luck` bonus, which SRD 5.1 applies to "ability checks"
 * without narrowing to trained skills. `equipmentCheckBonus` is already
 * bounded by MAX_TOTAL_CHECK_BONUS, so this never needs its own cap.
 */
export function skillModifierFor(sheet: CharacterSheet, skillName: string): number {
  const trained: SkillProficiency | undefined = sheet.skills.find((s) => s.skill === skillName);
  const ability = SKILL_ABILITY[skillName];
  const base = trained ? trained.bonus : ability ? sheet.modifiers[ability] : 0;
  return base + equipmentCheckBonus(sheet);
}

/**
 * A saving throw's real modifier: the trained bonus off the sheet when the
 * character is proficient, else the bare ability modifier, plus anything worn
 * that protects every save.
 *
 * The equipment addend applies whether or not the character is trained in that
 * save, which is SRD 5.1's "Cloak of Protection" shape ("you gain a +1 bonus to
 * saving throws," full stop). `modifierForRollRequest` already delegates here,
 * so a DM-requested save picks it up with no second edit and no second place
 * for the two to disagree.
 */
export function saveModifierFor(sheet: CharacterSheet, ability: keyof AbilityScores): number {
  const trained = sheet.saves.find((s) => s.ability === ability);
  return (trained ? trained.bonus : sheet.modifiers[ability]) + equipmentSaveBonus(sheet);
}

// ── contract v2: boots' skill advantage, and the ring that undoes a failed save ──

/**
 * The NAME of the worn, active item granting advantage on `skill` (contract
 * v2's `skillAdvantage` accessory effect, i.e. Boots of Elvenkind's Stealth
 * advantage), or null when nothing worn grants it for this skill.
 *
 * Compares case-insensitively because `resolveSkillCheck` and this file both
 * take skill names as free-form strings passed down from a `CheckRollRequest`
 * or a command-menu button, and "stealth" and "Stealth" naming the same SRD
 * skill should never be the reason a boot's advantage silently fails to
 * apply. `AccessoryEffect`'s `skill` field is itself always "Stealth" today
 * (the one skillAdvantage item this game ships), so this is future-proofing
 * against a second one more than it is a live bug fix.
 */
export function checkAdvantageFor(sheet: CharacterSheet, skill: string): string | null {
  const boots = accessoryStatus(sheet, "boots");
  if (!boots.active || boots.effect?.kind !== "skillAdvantage") return null;
  if (boots.effect.skill.toLowerCase() !== skill.toLowerCase()) return null;
  return boots.name;
}

/** The same breakdown shape as `attackBonusSourcesFor` and `saveBonusSourcesFor`, for a skill check. Sums exactly to `skillModifierFor(sheet, skill)`: ability-and-training (or the bare ability modifier) first, then a worn, active Stone of Good Luck's `luck` bonus when it is contributing. */
export function checkBonusSourcesFor(sheet: CharacterSheet, skill: string): readonly BonusSource[] {
  const trained = sheet.skills.find((s) => s.skill === skill);
  const ability = SKILL_ABILITY[skill];
  const sources: BonusSource[] = [
    trained
      ? { label: `${ABILITY_NAME[trained.ability]} and training`, amount: trained.bonus }
      : { label: ability ? ABILITY_NAME[ability] : skill, amount: ability ? sheet.modifiers[ability] : 0 },
  ];
  const luck = equipmentCheckBonus(sheet);
  if (luck > 0) sources.push({ label: accessoryStatus(sheet, "amulet").name ?? "amulet", amount: luck });
  return sources;
}

/**
 * A worn, active Ring of Evasion's `saveRescue` effect: on a FAILED saving
 * throw of the matching ability, spend one charge and turn it into a success.
 *
 * SRD 5.1 has the player spend their reaction to do this; this engine spends
 * it for them on the first qualifying failure while a charge remains, per
 * `ACCESSORY_ITEMS`' own `simplified` note ("there is never a reason to
 * decline"). Returns null -- no rescue -- for every case that is not exactly
 * "a Ring of Evasion is worn and attuned, this was a failed Dexterity save,
 * and at least one charge remains": a passed save, a non-Dexterity save, no
 * ring, an unattuned ring, or an empty ring all fall through unchanged.
 *
 * `sheet.itemCharges` follows `superiorityDice`'s own convention: an absent
 * key means full. The spent charge is written back onto the RETURNED sheet,
 * never mutated in place, the same purity every other function in this file
 * keeps.
 */
export function evasionRescue(
  sheet: CharacterSheet,
  ability: keyof AbilityScores,
  result: CheckResult,
): { sheet: CharacterSheet; result: CheckResult; note: string } | null {
  if (result.success) return null;
  const ring = accessoryStatus(sheet, "ring");
  if (!ring.active || ring.effect?.kind !== "saveRescue" || ring.tier === null) return null;
  if (ring.effect.ability !== ability) return null;

  const key = gearItemKey("ring", ring.tier);
  const max = ring.effect.charges;
  const current = sheet.itemCharges?.[key];
  // Absent means full; a stored value above the item's own maximum (a bad
  // blob) is read as the maximum, never as a bigger pool.
  const charges = current === undefined ? max : Math.min(max, Math.max(0, Math.floor(current)));
  if (charges <= 0) return null;

  const nextCharges = charges - 1;
  const nextSheet: CharacterSheet = { ...sheet, itemCharges: { ...sheet.itemCharges, [key]: nextCharges } };
  const note = `${ring.name}: the failed ${ABILITY_NAME[ability]} save becomes a success. ${nextCharges} of ${max} charges left.`;
  return { sheet: nextSheet, result: { ...result, success: true }, note };
}

/**
 * The engine's own modifier lookup for a rollRequest's "by" id (DESIGN.md:
 * "the engine looks up ITS OWN modifier for this id; the model never
 * supplies one"). `sheet` is the player's own character sheet, passed when
 * `by` matches their token id; pass `null` for anything else, and
 * `byAssetId` (the roller's token assetId) so a monster's roll comes off its
 * own statblock rather than one flat number shared by every creature.
 *
 * SRD 5.1 for the non-sheet branches: a creature with no listed save or
 * skill proficiency rolls a saving throw or an ability check at the bare
 * ability modifier, which is why both read the same `abilityModifiers`
 * record. None of the four statblocks above lists a proficiency in either.
 */
export function modifierForRollRequest(
  request: RollRequest,
  sheet: CharacterSheet | null,
  byAssetId?: string | null,
): number {
  if (sheet) {
    if (request.kind === "attack") return attackerBonusFor(sheet);
    if (request.kind === "save") return saveModifierFor(sheet, request.ability);
    return skillModifierFor(sheet, request.skill);
  }
  const block = statblockFor(byAssetId);
  if (request.kind === "attack") return block.attackBonus;
  if (request.kind === "save") return block.abilityModifiers[request.ability];
  const ability = SKILL_ABILITY[request.skill];
  return ability ? block.abilityModifiers[ability] : 0;
}

/**
 * The engine's own DEFENDER lookup, the mirror of `modifierForRollRequest`
 * and the fix for a hole that made the whole citation gate defeatable one
 * field upstream.
 *
 * `AttackRollRequest.targetAC` is a number the MODEL writes. Taking it at
 * face value meant the model chose the number its own d20 was compared
 * against: a turn declaring `targetAC: 1` against the player landed 195 hits
 * in 200 on an AC 17 character, and `targetAC: 30` on a goblin made the
 * player's swing whiff by construction. The AC printed on the character
 * sheet panel was decorative, which is worse than a missing feature because
 * it looks authoritative. DESIGN.md's rule ("the engine looks up ITS OWN
 * modifier for this id; the model never supplies one") was enforced for the
 * attacker and abandoned for the defender; this closes that asymmetry.
 *
 * The distinction that makes this correct rather than merely strict: under
 * SRD 5.1 an Armor Class is a PROPERTY OF A CREATURE (its armor, its DEX,
 * its natural armor), not a per-attack judgement call, so there is always a
 * right answer the engine can look up and the model has no legitimate reason
 * to supply one. A DC is the opposite (the SRD says the GM sets it), which
 * is why `dcForRollRequest` below only bounds a DC instead of replacing it.
 *
 * The gap this closes, round two: the first version of this function stopped
 * one branch short. The player got their sheet AC and the four
 * MONSTER_STATBLOCKS sprites got theirs, but the last line was still
 * `return request.targetAC`, so every OTHER token on the board fell through
 * to the model's own number -- and `PlacedToken.kind` includes "companion",
 * so that was not a hypothetical corner. An adversary probed a companion
 * token: a declared targetAC of 1 produced 37 hits in 40, a declared 30
 * produced 3 in 40, and the manufactured hit was then cited as the
 * `resolvedRollId` justifying a "combat" `removeToken` on that companion.
 * Every number in that ally's death was written by the model, through this
 * one line. There is no such thing as a creature the engine holds no AC for
 * now: FALLBACK_MONSTER_STATBLOCK is the engine's own answer for a token
 * with no statblock of its own, `statblockFor` always returns something, and
 * so this function always has an engine-owned number to return.
 *
 * Order of authority, most authoritative first, and every one of them the
 * engine's own:
 *   1. `defenderSheet`, the player's real sheet, passed when `request.against`
 *      is the player's own characterId. This is the case the first probe abused.
 *   2. The defender token's statblock (MONSTER_STATBLOCKS above).
 *   3. FALLBACK_MONSTER_STATBLOCK, for a companion, a neutral NPC sprite, an
 *      archetype token the DM turned hostile, or anything else the manifest
 *      has no statblock for. Same values the old flat DEFAULT_MONSTER_*
 *      constants carried, which is what ground truth already documents this
 *      fallback as covering.
 */
export function defenderACForRollRequest(
  /**
   * Deliberately UNREAD, and named with a leading underscore so that stays
   * visible at a glance. The parameter survives only so the play screen's
   * existing call site keeps compiling; the moment anything in this function
   * reaches for `_request.targetAC` again, the hole above is back. The field
   * itself should not exist on the wire at all -- see the cross-lane note in
   * dm/turnSchema.ts's `AttackRollRequest`.
   */
  _request: AttackRollRequest,
  defenderSheet: CharacterSheet | null,
  defenderAssetId?: string | null,
): number {
  // `effectiveArmorClass`, not `defenderSheet.armorClass`: the stored field is
  // AC from armour, DEX and a fighting style, and worn equipment is additive on
  // top of it. Reading the raw field here would mean the engine rolls against a
  // different number than the one the character sheet panel and the DM's prompt
  // both show, which is the same class of defect this function was written to
  // end, reintroduced through a new door.
  if (defenderSheet) return effectiveArmorClass(defenderSheet);
  // A monster's AC is its statblock's, entire. Equipment is a player system:
  // MONSTER_STATBLOCKS carries no slots, `statblockFor` returns a number, and
  // there is nowhere on a creature for a magic item to attach.
  return statblockFor(defenderAssetId).armorClass;
}

/**
 * SRD 5.1's "Typical Difficulty Classes" table runs DC 5 (very easy) to
 * DC 30 (nearly impossible). Unlike an AC, a DC genuinely IS the DM's call
 * in the fiction, so the engine bounds it onto that scale rather than
 * replacing it: a DC of 99 (a guaranteed failed save, which the turn
 * validator would then happily accept as the fact justifying a "combat"
 * removeToken) and a DC of -40 (a guaranteed success) are both outside the
 * ruleset, and clamping is the narrowest correction that keeps the DM's
 * judgement while refusing an outcome dial disguised as a difficulty.
 *
 * Honest about what this does NOT do: DC 30 against a level-1 character is
 * still unreachable, and it is still a legal SRD DC. This bounds the scale,
 * it does not audit whether a DM's difficulty is fair for the party in front
 * of it, which is a balance judgement the engine has no basis to make.
 */
export const MIN_DC = 5;
export const MAX_DC = 30;

export function dcForRollRequest(request: SaveRollRequest | CheckRollRequest): number {
  return Math.max(MIN_DC, Math.min(MAX_DC, request.dc));
}

/**
 * The fallback Perception/Investigation DC for the local Search action, used
 * only when the prop carries no authored `dc` of its own (world/cell.ts's
 * PlacedProp now has one, set by the DM at assembly time). Matches a
 * "moderately observant player should usually clear this" SRD-typical DC.
 */
export const SEARCH_DC = 12;

/**
 * The lowest natural d20 this character crits on, for rules/combat.ts's
 * `criticalOn`. SRD 5.1's default is 20 for everyone; the Champion's Improved
 * Critical ("your weapon attacks score a critical hit on a roll of 19 or 20")
 * is the one level-1-to-3 branch that moves it, and it is recorded on the
 * sheet as `choices.martialArchetype === "champion"` by characters/leveling.ts.
 *
 * Lives here rather than in rules/ because it reads a CharacterSheet, and
 * rules/combat.ts deliberately knows nothing about character sheets: it takes
 * numbers and returns outcomes. This is the adapter between the two, the same
 * job `attackerBonusFor` and `weaponDamageNotationFor` already do.
 */
export function criticalOnFor(sheet: CharacterSheet): number {
  return sheet.choices?.martialArchetype === "champion" ? 19 : DEFAULT_CRITICAL_ON;
}

// ── the OTHER level-3 pick: Battle Master ──────────────────────────────
//
// The mirror of `criticalOnFor` for the branch the Champion is offered
// against. Same job, same reason it lives here rather than in rules/: these
// read a CharacterSheet, and rules/maneuvers.ts deliberately takes plain
// numbers so it never has to know what a sheet is.

/**
 * How many superiority dice this character's pool holds when full: four for
 * a Battle Master (SRD 5.1's `SUPERIORITY_DICE_POOL`), zero for everyone
 * else. Zero rather than undefined so a caller can render "0 of 0" or hide
 * the row without a second "is this even a Battle Master" check.
 */
export function superiorityDiceMaxFor(sheet: CharacterSheet): number {
  return sheet.choices?.martialArchetype === "battle-master" ? SUPERIORITY_DICE_POOL : 0;
}

/** SRD 5.1's maneuver save DC for this character: 8 + proficiency bonus + the better of their STR and DEX modifiers. */
export function maneuverSaveDCFor(sheet: CharacterSheet): number {
  return maneuverSaveDC(sheet.proficiencyBonus, sheet.modifiers.str, sheet.modifiers.dex);
}

/** The maneuvers this character can actually spend a die on: the shipped list for a Battle Master, empty for anyone else. This is what a command menu renders buttons from, so a non-Battle-Master gets no buttons rather than disabled ones. */
export function maneuversFor(sheet: CharacterSheet): readonly Maneuver[] {
  return superiorityDiceMaxFor(sheet) > 0 ? MANEUVERS : [];
}

/**
 * The target's saving-throw modifier for a maneuver, off the defender's own
 * statblock -- the same engine-owned lookup `modifierForRollRequest` and
 * `defenderACForRollRequest` already do, applied to the one new roll
 * maneuvers introduce. A token with no statblock gets
 * FALLBACK_MONSTER_STATBLOCK's modifier, never a number from anywhere else.
 */
export function maneuverTargetSaveModifier(maneuver: Maneuver, defenderAssetId: string | null | undefined): number {
  return statblockFor(defenderAssetId).abilityModifiers[maneuver.saveAbility];
}
