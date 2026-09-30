/**
 * Turn a picked archetype into a full, playable stat block.
 *
 * DESIGN.md's "Characters" section budgets this at "under two minutes": pick
 * a template, name it, pick an appearance, pick one or two flavour choices,
 * then play. That budget is why `creationChoicesFor` only ever returns a
 * choice where the chassis has a real SRD 5.1 branch point at level 1 (a
 * Fighter's fighting style, a Rogue's Expertise skill) -- Cleric and Wizard
 * get none, because inventing a choice just to have one would blow the two-
 * minute budget for no mechanical payoff.
 *
 * Every number here is real SRD 5.1 math built on rules/, not a re-derivation
 * of it: ability modifiers, proficiency bonus, and (for casters) spell slots
 * all come straight from the rules engine. The one number this module DOES
 * compute itself is level-1 max HP, and only because that's a level-1-
 * specific SRD rule (hit die MAXIMUM + CON modifier) that rules/leveling.ts
 * deliberately doesn't own -- its `applyLevelUp` always uses the AVERAGE hit
 * die value, which is the correct formula from level 2 onward but the wrong
 * one for the character you're rolling up right now.
 */
import { abilityModifier, computeAC, proficiencyBonus, spellSlotsForLevel } from "../rules";
import type { AbilityScores, ArmorCategory, CasterClass, LevelUpChange, SpellSlots } from "../rules";
import { normalizeBag } from "../rules/inventory";
import { getArchetype, type Archetype, type Chassis, type Consumable, type TemplateGenre } from "./templates";
import { normalizeEquipment } from "./equipment";
import {
  GEAR_ROLES,
  MAGIC_TIERS,
  STARTING_LOADOUT,
  accessoryEffect,
  gearItemKey,
  type BagItem,
  type Equipment,
  type GearItemKey,
  type LootLedger,
} from "./equipmentTypes";

// ── skills ──────────────────────────────────────────────────────────────

/**
 * SRD 5.1's skill-to-ability map, covering exactly the skills the eight
 * archetypes in templates.ts actually grant. A skill missing here is a bug
 * in templates.ts (a new archetype using a skill nobody taught this map
 * about), so createCharacter throws loudly rather than silently defaulting
 * an ability.
 */
export const SKILL_ABILITY: Record<string, keyof AbilityScores> = {
  Athletics: "str",
  Acrobatics: "dex",
  "Sleight of Hand": "dex",
  Stealth: "dex",
  Arcana: "int",
  History: "int",
  Investigation: "int",
  Nature: "int",
  Religion: "int",
  "Animal Handling": "wis",
  Insight: "wis",
  Medicine: "wis",
  Perception: "wis",
  Survival: "wis",
  Deception: "cha",
  Intimidation: "cha",
  Performance: "cha",
  Persuasion: "cha",
};

export interface SkillProficiency {
  skill: string;
  ability: keyof AbilityScores;
  bonus: number;
  expertise: boolean;
}

export interface SaveProficiency {
  ability: keyof AbilityScores;
  bonus: number;
}

// ── armor, level-1 AC by chassis ───────────────────────────────────────

/**
 * A default starting armor per chassis (matches each archetype's
 * startingInventory in templates.ts), because AC needs one to mean anything.
 * `category` is the SRD armor category rules/armorClass.ts's `computeAC`
 * switches on; the DEX-cap math itself (full DEX for light/unarmored, capped
 * at +2 for medium, none at all for heavy) lives there, not here, so this
 * table only has to say WHAT each chassis wears, never re-derive HOW that
 * category affects AC. Before this table carried `category`, it carried its
 * own `dexCap: number | null` and re-implemented that exact cap logic inline
 * -- the SRD 5.1 rule "one table-accurate function to call" computeAC's own
 * header comment predicts, and this is that call site.
 */
const ARMOR_BY_CHASSIS: Record<Chassis, { label: string; base: number; category: ArmorCategory }> = {
  fighter: { label: "chain mail", base: 16, category: "heavy" },
  rogue: { label: "leather armor", base: 11, category: "light" },
  // "chain shirt and shield" folds the shield's flat +2 straight into `base`
  // (13 for the chain shirt itself, +2 for the shield) rather than passing it
  // as computeAC's separate shieldBonus param -- the DEX cap applies to the
  // combined base the same way either way, so folding it in here keeps this
  // table's `base` column the one number that means "what this chassis's kit
  // adds before DEX," matching how the other three rows read.
  cleric: { label: "chain shirt and shield", base: 15, category: "medium" },
  wizard: { label: "unarmored", base: 10, category: "unarmored" },
};

/**
 * Which chassis has a shield's flat +2 folded into the `base` above.
 *
 * One fact, exported rather than left to be recovered by looking for the word
 * "shield" inside `label`. The character sheet's AC line names the worn armour
 * out of the gear table now (menu/equipment.ts's `armorDisplayLabel`, so the
 * vitals line and the gear row call one object one thing), and a Cleric whose
 * line read "Vestments" alone would be explaining 15 points of armour class
 * with 13 points of vestments. Sniffing the label string for "shield" would
 * work today and break the first time someone rewords it; this cannot.
 */
export const ARMOR_INCLUDES_SHIELD: Readonly<Record<Chassis, boolean>> = Object.freeze({
  fighter: false,
  rogue: false,
  cleric: true,
  wizard: false,
});

function isCasterChassis(chassis: Chassis): chassis is CasterClass {
  return chassis === "cleric" || chassis === "wizard";
}

function abilityModifiers(abilities: AbilityScores): Record<keyof AbilityScores, number> {
  return {
    str: abilityModifier(abilities.str),
    dex: abilityModifier(abilities.dex),
    con: abilityModifier(abilities.con),
    int: abilityModifier(abilities.int),
    wis: abilityModifier(abilities.wis),
    cha: abilityModifier(abilities.cha),
  };
}

// ── the creation-time choice, fighter and rogue only ───────────────────

/** One pickable option, always carrying both the plain description and the real mechanical effect side by side -- never one hidden behind the other. */
export interface ChoiceOption extends LevelUpChange {
  id: string;
  label: string;
  /**
   * Set when this build's engine does not apply the option yet, in the words
   * the pill shows next to it.
   *
   * Two cold readers made four build decisions off these pills and got zero
   * right, and both blamed the same thing: no numbers anywhere, so the choice
   * read as three vibes. Worse, two of the three fighting styles and one of
   * the two level-3 archetypes are not read by the combat math at all, and
   * the copy described them in the present tense like the ones that are. Both
   * judges independently reasoned that Battle Master must have combat buttons
   * somewhere, went looking on the play screen, found no maneuver, and picked
   * it anyway because the copy outranked their own correct suspicion.
   *
   * The rule this field enforces, checked by a test over every option of
   * every archetype: state the real number, or say the build does not apply
   * this one yet. Never a present-tense effect with neither. Wiring an option
   * up is then a one-line deletion here, not a hunt for stale copy.
   */
  notYet?: string;
}

export interface CreationChoice {
  id: string;
  prompt: string;
  options: ChoiceOption[];
}

/**
 * The full SRD fighting-style catalog this build supports. Not every option
 * here is offered to every Fighter-chassis archetype: `fightingStyleOptionsFor`
 * below filters this list down to what an archetype's actual startingInventory
 * (templates.ts) can back up, keyed by `archetype.fightingStyles`. Dueling's
 * bonus, for instance, only ever triggers on a one-handed melee weapon; an
 * archetype whose kit carries none (the sci-fi Trooper -- plasma rifle, no
 * melee weapon at all) never sees it offered, so a newcomer never picks a
 * real-sounding choice that's mechanically dead for the character they built.
 */
const FIGHTING_STYLE_OPTIONS: ChoiceOption[] = [
  {
    id: "defense",
    label: "Defense",
    technical: "+1 AC while wearing armor.",
    // The one style this build's math genuinely reads: createCharacter adds
    // the point below, and it is on the sheet's AC before the first fight.
    plain: "+1 armour class, so an attack that needed 16 to hit you now needs 17. Every fight, all the time.",
  },
  {
    id: "dueling",
    label: "Dueling",
    technical: "+2 damage on melee attacks with a one-handed weapon when no other weapon is in your other hand.",
    // Real, and conditional in the SRD, so it is applied at roll time rather
    // than baked into a flat sheet number: session/combat.ts's
    // `duelingBonusFor` adds it to the damage notation when the equipped
    // weapon actually qualifies.
    plain: "+2 damage on every hit with a one-handed weapon and nothing but a shield in your other hand.",
  },
  {
    id: "archery",
    label: "Archery",
    technical: "+2 to attack rolls made with ranged weapons.",
    // Also real: `archeryBonusFor` adds it to the attack roll, and picking it
    // switches which weapon the engine treats as equipped when the kit
    // carries a ranged option (a Knight leads with the thrown axe).
    plain: "+2 to hit with a ranged weapon, which is two more shots landing in every ten, and you lead with the ranged one in your kit.",
  },
];

/** The fighting-style options this specific archetype's kit actually supports (templates.ts's `fightingStyles`, defaulting to all three when unset). Shared by creationChoicesFor (what's offered) and createCharacter (what's valid), so the gate can't be bypassed by one and not the other. */
function fightingStyleOptionsFor(archetype: Archetype): ChoiceOption[] {
  const viable = archetype.fightingStyles;
  if (!viable) return FIGHTING_STYLE_OPTIONS;
  return FIGHTING_STYLE_OPTIONS.filter((option) => viable.includes(option.id));
}

function expertiseChoiceFor(archetype: Archetype): CreationChoice {
  return {
    id: "expertiseSkill",
    prompt: "Pick one of your skills to be exceptional at.",
    options: archetype.startingProficiencies.skills.map((skill) => ({
      id: skill,
      label: skill,
      technical: `Expertise in ${skill}: your proficiency bonus counts twice on ${skill} checks.`,
      // Two rounds of fixup landed here. The first gave this a felt-magnitude
      // cue but left "proficiency bonus" in, the one jargon term the fighting
      // styles avoid entirely. The second took the mechanic out and left no
      // number at all, which is exactly what two cold readers then said made
      // the whole picker unreadable: "I'm choosing between three vibes." So:
      // the felt magnitude AND the number, and no jargon. +2 is the level-1
      // figure (proficiency counted a second time) and it really does double
      // as the bonus grows, which is why the second clause is there.
      plain: `+2 on ${skill} checks on top of your training, and it doubles again every time your training grows.`,
    })),
  };
}

/**
 * The permanent record of a pick, for the character sheet's own list of what
 * this character's choices actually did.
 *
 * It carries the `notYet` caveat rather than dropping it, because the sheet
 * is exactly where a judge went looking to check: "Dueling shows up on my
 * sheet as the same flavour sentence and no number. I have no way to confirm
 * it's doing anything." A sheet that reads as if a dead option is live is the
 * same defect as a pill that does, one screen later.
 */
export function appliedEffectFor(option: ChoiceOption, prefix = ""): LevelUpChange {
  return {
    technical: option.technical,
    plain: `${prefix}${option.plain}${option.notYet ? ` ${option.notYet}` : ""}`,
  };
}

/** What DESIGN.md calls "one or two flavour choices": empty for Cleric/Wizard chassis, one real branch point for Fighter/Rogue. */
export function creationChoicesFor(archetypeId: string): CreationChoice[] {
  const archetype = getArchetype(archetypeId);
  if (archetype.chassis === "fighter") {
    return [{ id: "fightingStyle", prompt: "Pick a fighting style.", options: fightingStyleOptionsFor(archetype) }];
  }
  if (archetype.chassis === "rogue") {
    return [expertiseChoiceFor(archetype)];
  }
  return [];
}

// ── the finished character ─────────────────────────────────────────────

export interface CreateCharacterInput {
  archetypeId: string;
  name: string;
  appearanceAssetId: string;
  /** choiceId -> optionId, matching creationChoicesFor's shape. Missing entries fall back to the first option, so creation never blocks on an unmade choice. */
  choices?: Record<string, string>;
}

/**
 * SRD 5.1's death saves, tracked on the sheet because the tracker itself is
 * one of the most recognisable objects in the game and its absence is
 * immediately legible. Before this existed, `Math.max(0, ...)` was the entire
 * zero-HP story: a character at 0 HP kept attacking, kept moving, and could be
 * healed back up without ever making a single roll.
 */
export interface DeathSaveState {
  successes: number;
  failures: number;
}

export interface CharacterSheet {
  archetypeId: string;
  template: TemplateGenre;
  chassis: Chassis;
  displayName: string;
  name: string;
  appearanceAssetId: string;
  level: number;
  abilities: AbilityScores;
  modifiers: Record<keyof AbilityScores, number>;
  proficiencyBonus: number;
  armorClass: number;
  armorLabel: string;
  maxHp: number;
  currentHp: number;
  hitDieSides: number;
  /**
   * Hit dice left to spend on a short rest. SRD 5.1 gives a character one hit
   * die per level and hands them back on a long rest; this is the resource
   * that makes "rest" a real decision rather than a free full heal button.
   */
  hitDiceRemaining: number;
  skills: SkillProficiency[];
  saves: SaveProficiency[];
  /** Flavour gear: what the character is carrying, shown on the sheet. Not what Item spends; see `consumables`. */
  inventory: string[];
  /**
   * The six gear roles: weapon, outer, crown, ring, amulet and boots. See
   * `characters/equipmentTypes.ts` for the contract every lane builds against.
   *
   * It stores a TIER and never a bonus. What a tier is worth lives in
   * `BONUS_BY_TIER` (or, for ring/amulet/boots, `accessoryEffect`) and is
   * derived on every read, because a stored bonus is a number something other
   * than that table could write, and equipment is the first system in this
   * game that could plausibly put one on a sheet. Same reasoning that keeps
   * `AttackRollRequest` from carrying a `targetAC`.
   *
   * Optional on the type and always present after `normalizeSheet`, which is
   * how every other field this jsonb blob gained after launch arrived.
   */
  equipment?: Equipment;
  /**
   * Owned magic gear that is not currently worn: a role and a tier per entry,
   * ordered (the order IS the inventory screen's bag grid order), never a
   * name or a number. See `characters/equipmentTypes.ts` section 11.4.
   * Absent reads as `[]`; a stored value crosses `rules/inventory.ts`'s
   * `normalizeBag` at the load boundary the same way `equipment` crosses
   * `normalizeEquipment`.
   */
  bag?: BagItem[];
  /**
   * Remaining charges of a worn item whose effect spends them (only
   * `saveRescue` items, at the time of writing: the Ring of Evasion). Keyed
   * by `gearItemKey(role, tier)`. ABSENT KEY MEANS FULL, the same convention
   * `superiorityDice` already uses for a Battle Master's pool, so a character
   * who owned the ring before this field existed has it at full charges
   * rather than at zero.
   */
  itemCharges?: Partial<Record<GearItemKey, number>>;
  /**
   * How many loot rolls each cell has already made, so a paid DM turn that
   * respawns a monster or restocks a chest cannot be farmed for gear. Absent
   * reads as no rolls made anywhere yet. See `characters/equipmentTypes.ts`
   * section 11.6 and `rules/loot.ts`'s `lootFor`.
   */
  lootLedger?: LootLedger;
  /** What the Item verb can actually spend, with uses remaining. See templates.ts's Consumable for why this is data rather than a substring match on an item's name. */
  consumables: Consumable[];
  spellSlots: SpellSlots | null;
  /** At 0 HP and not yet stable or dead: unconscious, no action economy, rolling death saves. */
  downed: boolean;
  /** Three death-save successes: still at 0 HP and unconscious, but no longer dying. */
  stable: boolean;
  /** Three death-save failures. The character is gone; the campaign is not, and nothing was charged for it. */
  dead: boolean;
  deathSaves: DeathSaveState;
  /**
   * True once this character has slept through the current in-fiction day.
   *
   * SRD 5.1: "a character can't benefit from more than one long rest in a
   * 24-hour period." Nothing enforced that, and a cold reader spotted the
   * consequence from one screen of text before ever pressing the button:
   * "my confident read is: Make camp is an infinite free full heal, Catch
   * your breath is strictly worse and pointless, and healing potions are
   * worthless." That read was correct, and it voided the potion, hit-die and
   * spell-slot economies at once. characters/health.ts's longRest sets this;
   * `newAdventuringDay` clears it when the campaign has actually moved on.
   */
  longRestUsed: boolean;
  /**
   * Milestones earned toward the next level: a fight won, a new scene the DM
   * built. DESIGN.md doesn't mandate an XP economy (5e supports milestone
   * levelling just as validly), but it does frame levelling as a reward, and a
   * reward with no earning condition is a debug button. See leveling.ts's
   * `canLevelUp` for how many it takes.
   */
  milestones: number;
  /** The resolved choiceId -> optionId this character actually locked in (defaults filled in). */
  choices: Record<string, string>;
  /** technical+plain, one per resolved choice, ready for a character-sheet UI to render as-is. */
  appliedEffects: LevelUpChange[];
  kitDescription: string;
}

/**
 * Build a full, ready-to-persist character sheet. This is a pure function --
 * no AI call, no dice roll, no randomness at all -- because DESIGN.md scopes
 * character creation as a deterministic, under-two-minutes flow: the player's
 * choices are the only inputs, so the same choices always produce the same
 * sheet.
 */
export function createCharacter(input: CreateCharacterInput): CharacterSheet {
  const archetype = getArchetype(input.archetypeId);

  const name = input.name.trim();
  if (!name) throw new Error("a character needs a name");
  const appearanceAssetId = input.appearanceAssetId.trim();
  if (!appearanceAssetId) throw new Error("a character needs an appearance");

  const chosen = input.choices ?? {};
  const level = 1;
  const abilities = archetype.baseAbilityScores;
  const modifiers = abilityModifiers(abilities);
  const profBonus = proficiencyBonus(level);

  const armor = ARMOR_BY_CHASSIS[archetype.chassis];
  let armorClass = computeAC({ baseArmor: { category: armor.category, base: armor.base }, dexModifier: modifiers.dex });

  const resolvedChoices: Record<string, string> = {};
  const appliedEffects: LevelUpChange[] = [];

  if (archetype.chassis === "fighter") {
    const viableOptions = fightingStyleOptionsFor(archetype);
    const optionId = chosen.fightingStyle ?? viableOptions[0]!.id;
    const option = viableOptions.find((o) => o.id === optionId);
    if (!option) throw new Error(`"${optionId}" is not a fighting style option for this archetype's kit`);
    resolvedChoices.fightingStyle = option.id;
    appliedEffects.push(appliedEffectFor(option));
    // Defense is the one style with an always-on numeric effect; Dueling and
    // Archery are conditional on weapon choice mid-combat, which is the
    // combat resolver's call at attack time, not something to bake into a
    // flat sheet number that would misrepresent it as unconditional.
    if (option.id === "defense") armorClass += 1;
  }

  if (archetype.chassis === "rogue") {
    const viableOptions = expertiseChoiceFor(archetype).options;
    const optionId = chosen.expertiseSkill ?? viableOptions[0]!.id;
    const option = viableOptions.find((o) => o.id === optionId);
    if (!option) throw new Error(`"${optionId}" is not one of this archetype's starting skills`);
    resolvedChoices.expertiseSkill = option.id;
    appliedEffects.push(appliedEffectFor(option));
  }

  const expertiseSkill = resolvedChoices.expertiseSkill;
  const skills: SkillProficiency[] = archetype.startingProficiencies.skills.map((skill) => {
    const ability = SKILL_ABILITY[skill];
    if (!ability) throw new Error(`unknown skill "${skill}" - add it to SKILL_ABILITY in creation.ts`);
    const expertise = skill === expertiseSkill;
    const bonus = modifiers[ability] + profBonus * (expertise ? 2 : 1);
    return { skill, ability, bonus, expertise };
  });

  const saves: SaveProficiency[] = archetype.startingProficiencies.saves.map((ability) => ({
    ability,
    bonus: modifiers[ability] + profBonus,
  }));

  // SRD 5.1: level 1 max HP is the hit die's MAXIMUM face plus CON modifier,
  // floored at 1 (a very low CON can't make a level-1 character start at 0
  // or negative HP). This is deliberately not rules/leveling.ts's
  // averageHitDieValue -- that formula is correct from level 2 onward, not
  // for the character you're rolling up right now.
  const maxHp = Math.max(1, archetype.startingHitDie + modifiers.con);

  const spellSlots: SpellSlots | null = isCasterChassis(archetype.chassis)
    ? spellSlotsForLevel(archetype.chassis, level)
    : null;

  return {
    archetypeId: archetype.id,
    template: archetype.template,
    chassis: archetype.chassis,
    displayName: archetype.displayName,
    name,
    appearanceAssetId,
    level,
    abilities,
    modifiers,
    proficiencyBonus: profBonus,
    armorClass,
    armorLabel: armor.label,
    maxHp,
    currentHp: maxHp,
    hitDieSides: archetype.startingHitDie,
    hitDiceRemaining: level,
    skills,
    saves,
    inventory: [...archetype.startingInventory],
    // Weapon, outer, crown and boots filled, all four common, from turn one:
    // the token is drawn wearing them, so the sheet has to agree that they
    // are there. Ring and amulet start empty (STARTING_LOADOUT's own value).
    // A common piece is worth +0, which is exactly why it can be the
    // starting kit without moving a single number.
    equipment: { ...STARTING_LOADOUT },
    consumables: archetype.startingConsumables.map((c) => ({ ...c })),
    spellSlots,
    downed: false,
    stable: false,
    dead: false,
    deathSaves: { successes: 0, failures: 0 },
    longRestUsed: false,
    milestones: 0,
    choices: resolvedChoices,
    appliedEffects,
    kitDescription: archetype.kitDescription,
  };
}

/**
 * Fill in any field a stored sheet predates.
 *
 * `game_characters.stats` is a free-form jsonb bag this client wrote itself
 * and reads straight back (session/characterState.ts casts it without
 * validating, by design), so a campaign started before death saves, hit dice
 * or milestones existed comes back with those fields simply absent. Every one
 * of them is load-bearing for a button that would otherwise render against
 * `undefined` -- a death-save tracker showing "NaN/3", a Rest button that can
 * never find a hit die. Defaulting here, once, at the load boundary, is the
 * cheap version of a migration for a blob nobody else interprets.
 */
export function normalizeSheet(sheet: CharacterSheet): CharacterSheet {
  const equipment = sheet.equipment ? normalizeEquipment(sheet.equipment) : { ...STARTING_LOADOUT };
  const level = typeof sheet.level === "number" && sheet.level > 0 ? sheet.level : 1;
  return {
    ...sheet,
    level,
    hitDiceRemaining: typeof sheet.hitDiceRemaining === "number" ? sheet.hitDiceRemaining : level,
    downed: sheet.downed === true,
    stable: sheet.stable === true,
    dead: sheet.dead === true,
    // Absent means "has not slept yet", which is the safe default: a campaign
    // started before the per-day cap existed must not come back unable to
    // make camp.
    longRestUsed: sheet.longRestUsed === true,
    deathSaves:
      sheet.deathSaves && typeof sheet.deathSaves.successes === "number" && typeof sheet.deathSaves.failures === "number"
        ? sheet.deathSaves
        : { successes: 0, failures: 0 },
    milestones: typeof sheet.milestones === "number" ? sheet.milestones : 0,
    // A campaign started before equipment existed, or before contract v2
    // widened it to six roles, comes back with some or all of those slots
    // absent, and the play screen would then draw a body wearing gear the
    // sheet does not admit to. Defaulting to the starting kit costs nothing,
    // mechanically: every drawn piece in it is common, worth +0, and ring/
    // amulet start empty either way.
    // Through the six-role normaliser, not a bare default: a v1 three-key blob
    // gains its common boots here (and an unknown tier reads as common, an
    // empty ring or amulet stays empty) exactly as characterStateFromStats
    // already does on the other load path.
    equipment,
    // The bag crosses the same load boundary equipment does, and needs the
    // normalised equipment above to know which magic items are currently
    // worn (a bagged entry equal to a worn one is dropped).
    bag: normalizeBag(sheet.bag, sheet.archetypeId, equipment),
    // itemCharges: absent key means full (superiorityDice's own convention),
    // so this never invents a key; it keeps only real charged items, each
    // cut to an integer in 0..that item's own maximum.
    itemCharges: normalizeItemCharges(sheet.itemCharges),
    // lootLedger: absent means no rolls made anywhere yet.
    lootLedger: normalizeLootLedger(sheet.lootLedger),
    appliedEffects: Array.isArray(sheet.appliedEffects) ? sheet.appliedEffects : [],
    inventory: Array.isArray(sheet.inventory) ? sheet.inventory : [],
    consumables: Array.isArray(sheet.consumables) ? sheet.consumables : [],
  };
}

/**
 * Sanitise a stored `itemCharges` bag: keep only non-negative integer counts,
 * keyed by a string (the exact `GearItemKey` format is re-derived and checked
 * on read, not here, which is why this stays a light pass rather than a full
 * re-validation against ACCESSORY_ITEMS). Absent or malformed input reads as
 * `{}`, i.e. every item at full charges.
 *
 * Exported so `session/characterState.ts`'s `characterStateFromStats` -- the
 * OTHER load boundary this blob crosses, on every campaign load rather than
 * only where a defaulting pass happens to already run -- can apply the exact
 * same sanitising rather than a second, potentially drifting copy of it.
 */
export function normalizeItemCharges(value: unknown): Partial<Record<GearItemKey, number>> {
  if (!value || typeof value !== "object") return {};
  const rec = value as Record<string, unknown>;
  const out: Partial<Record<GearItemKey, number>> = {};
  // Walk the real charged items rather than trusting the blob's keys: only a
  // saveRescue item has charges, and its count is an integer in 0..charges
  // (contract v2, PERSISTENCE). A stray key is dropped, an oversized count is
  // cut to the item's own maximum, and an absent key still means full.
  for (const role of GEAR_ROLES) {
    for (const tier of MAGIC_TIERS) {
      const effect = accessoryEffect(role, tier);
      if (effect?.kind !== "saveRescue") continue;
      const key = gearItemKey(role, tier);
      const raw = rec[key];
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
        out[key] = Math.min(effect.charges, Math.floor(raw));
      }
    }
  }
  return out;
}

/** Sanitise a stored `lootLedger`: keep only non-negative integer roll counts, keyed by whatever string the blob used (eviction past LOOT_LEDGER_MAX_CELLS happens at write time in `rules/loot.ts`'s `lootFor`, not here). Absent or malformed input reads as no rolls made anywhere. Exported for the same reason `normalizeItemCharges` is: `session/characterState.ts` needs the identical sanitising pass. */
export function normalizeLootLedger(value: unknown): LootLedger {
  if (!value || typeof value !== "object") return { rollsByCell: {} };
  const rec = (value as { rollsByCell?: unknown }).rollsByCell;
  if (!rec || typeof rec !== "object") return { rollsByCell: {} };
  const rollsByCell: Record<string, number> = {};
  for (const [key, raw] of Object.entries(rec as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) rollsByCell[key] = Math.floor(raw);
  }
  return { rollsByCell };
}
