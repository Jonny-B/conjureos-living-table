/**
 * THE RULEBOOK: how The Living Table is actually played, as data.
 *
 * Plain language, second person, short. Every rule here is a rule the ENGINE
 * enforces (SRD 5.1 based, CC BY 4.0, see NOTICE.md). Where the engine does
 * not apply something, the text says so in the game's own words ("The DM rules
 * on this"): equipmentTypes.ts rule 7, the honesty rule, applies to prose as
 * much as to an item. A rule that states a number takes it from the engine, not
 * from memory: the number is IMPORTED from the module that owns it (or derived
 * from that module's own data), and a comment names the symbol that was checked.
 * test/livingtable-rulebook.test.ts asserts the numbers against the engine, so
 * a retuned constant fails the build instead of leaving this book wrong.
 *
 * It is views-free on purpose: the bench's Rules tab renders it, and the DM's
 * prompt can later take `rulebookText()`. Nothing here rolls, draws or calls a
 * model.
 *
 * Where the asset bench differs from the game, the book says so in one line
 * ("On the asset bench: ..."). The differences known today:
 *   - the bench chest always opens; in the game Search is a Perception check
 *   - a fight starts when the goblin notices you on the bench; in the game it
 *     starts when a hostile creature is on the board
 *   - the bench has no Rest buttons; the game has both rests
 *   - the bench's Potion button works on the floor; the game's Item does not
 *   - the fog of war is drawn on the bench; the game has the same sight rule
 *     but does not draw the fog yet
 */
import { abilityModifier, proficiencyBonus } from "./abilities";
import { applyLevelUp, HIT_DIE_SIDES, type CharacterClass, type LevelableCharacter } from "./leveling";
import { DEFAULT_CRITICAL_ON } from "./combat";
import { SUPERIORITY_DICE_POOL, SUPERIORITY_DIE_SIDES, MANEUVERS } from "./maneuvers";
import { spellSlotsForLevel, WIZARD_SPELLS } from "./spells";
import { SRD_CONDITIONS } from "./conditions";
import { CHAIN_MAIL_STRENGTH, HEAVY_ARMOR_SPEED_PENALTY_FT, MAGIC_ITEM_BONUS_MAX } from "./magicItems";
import {
  ACCESSORY_ITEMS,
  ACCESSORY_ROLES,
  BAG_CAPACITY,
  BAG_COLUMNS,
  BAG_ROWS,
  BONUS_BY_TIER,
  EQUIPMENT_TIERS,
  GEAR_ROLES,
  LOOT_DIE_SIDES,
  LOOT_ROLLS_PER_CELL,
  LOOT_TIER_BANDS,
  LOOT_CAP_LINE,
  MAX_ATTUNED_ITEMS,
  MAX_DISTINCT_MAGIC_ITEMS,
  MAX_TOTAL_AC_BONUS,
  MAX_TOTAL_CHECK_BONUS,
  MAX_TOTAL_SAVE_BONUS,
  SLOTS_BY_ARCHETYPE,
  TIER_WORD,
  type AccessoryEffect,
  type ArchetypeId,
  type BonusKind,
} from "../characters/equipmentTypes";
import { createCharacter, ABILITY_SCORE_CAP, POINT_BUY_BUDGET, STANDARD_ARRAY, pointBuyCost, CLASS_SKILL_CHOICES, SKILL_ABILITY, type CharacterSheet } from "../characters/creation";
import { ANCESTRIES } from "../characters/ancestries";
import { DEATH_SAVE_DC, potionHealing } from "../characters/health";
import { MILESTONES_PER_LEVEL } from "../characters/leveling";
import { PLAYABLE_ARCHETYPE_IDS, getArchetype } from "../characters/templates";
import { COMMAND_VERBS } from "../menu/commandMenu";
import { SPELL_EFFECTS, spellRangeFt } from "../menu/casting";
import { FEET_PER_TILE, MELEE_REACH_FT, MONSTER_INITIATIVE_MODIFIER } from "../menu/combatRound";
import { ABILITY_NAME, SRD_ATTRIBUTION } from "../menu/labels";
import {
  ARCHERY_ATTACK_BONUS,
  DEFAULT_SPEED_FT,
  DUELING_DAMAGE_BONUS,
  MAX_DC,
  MIN_DC,
  MONSTER_STATBLOCKS,
  SEARCH_DC,
  attackerBonusFor,
  maneuverSaveDCFor,
  skillModifierFor,
  weaponDamageNotationFor,
  weaponFor,
} from "../session/combat";
import { parseDiceNotation } from "./dice";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import { DEFAULT_RANGED_REACH_TILES } from "../world/reach";

// ── the shape ────────────────────────────────────────────────────────────

export type RuleBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "example"; text: string }
  | { kind: "note"; text: string };

export interface RuleSection {
  id: string;
  title: string;
  summary: string;
  blocks: RuleBlock[];
  seeAlso?: string[];
}

const p = (text: string): RuleBlock => ({ kind: "p", text });
const list = (...items: string[]): RuleBlock => ({ kind: "list", items });
const table = (head: string[], rows: string[][]): RuleBlock => ({ kind: "table", head, rows });
const example = (text: string): RuleBlock => ({ kind: "example", text });
const note = (text: string): RuleBlock => ({ kind: "note", text });

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

// ── numbers, each from the engine ────────────────────────────────────────

/** menu/combatRound.ts FEET_PER_TILE: one square is 5 ft. */
const SQUARE_FT = FEET_PER_TILE;
/** menu/combatRound.ts MELEE_REACH_FT: DEFAULT_MELEE_REACH_TILES (1) x FEET_PER_TILE. */
const MELEE_FT = MELEE_REACH_FT;
/** world/reach.ts DEFAULT_RANGED_REACH_TILES x FEET_PER_TILE: 16 squares. */
const RANGED_FT = DEFAULT_RANGED_REACH_TILES * FEET_PER_TILE;
/** session/combat.ts DEFAULT_SPEED_FT; menu/combatRound.ts spends it in FEET_PER_TILE steps. */
const SPEED_FT = DEFAULT_SPEED_FT;
const SPEED_SQUARES = DEFAULT_SPEED_FT / FEET_PER_TILE;
/** world/coordinates.ts CELL_WIDTH and CELL_HEIGHT: a room is one cell. */
const ROOM_COLS = CELL_WIDTH;
const ROOM_ROWS = CELL_HEIGHT;
/**
 * characters/health.ts potionHealing, probed. The notation itself is not exported, so the dice are read off the
 * function: how many dice it rolls (the calls it makes to its rng), and the lowest and highest total it can give.
 * With n dice of s sides and a flat m, the lowest total is n + m and the highest is n x s + m.
 */
const POTION_MIN = potionHealing(() => 0);
const POTION_MAX = potionHealing(() => 0.999999);
const POTION_DICE_COUNT = (() => {
  let calls = 0;
  potionHealing(() => {
    calls++;
    return 0;
  });
  return calls;
})();
const POTION_FLAT = POTION_MIN - POTION_DICE_COUNT;
const POTION_SIDES = (POTION_MAX - POTION_FLAT) / POTION_DICE_COUNT;
/** The potion's dice as notation ("2d4+2"), built from the probe above; the test checks it against the game's own item copy (templates.ts HEALING_DRAUGHT). */
const POTION_DICE = `${POTION_DICE_COUNT}d${POTION_SIDES}${POTION_FLAT > 0 ? `+${POTION_FLAT}` : POTION_FLAT < 0 ? String(POTION_FLAT) : ""}`;
/** session/combat.ts SEARCH_DC, the DC when a prop carries none of its own. */
const SEARCH_DEFAULT_DC = SEARCH_DC;
/** The wake rules of the bench's goblin: the bench's assets.ts MONSTER_WAKE_TILES and MONSTER_HEARS_STEPS (the test reads the source to check them; src cannot import the bench). */
const BENCH_NOTICE_TILES = 6;
const BENCH_HEARS_STEPS = 2;
/** the bench's assets.ts DM_POTION_CAP, and the bench's dm.ts DM_LIMITS (the test checks both against the bench). */
const BENCH_DM_POTIONS_PER_SCENE = 2;
const BENCH_DM_LIMITS = { maxEffects: 6, maxDice: 4, healMaxMod: 6, harmMaxMod: 4, harmMaxSides: 10, healMaxSides: 12 };
/**
 * The level cap. LivingTable.tsx's LAUNCH_MAX_LEVEL is not exported, and its own comment says it exists because
 * rules/spells.ts spellSlotsForLevel throws past the same ceiling, so the cap is read off that function: the
 * highest level it will give slots for. The test checks it against LAUNCH_MAX_LEVEL in the screen's source.
 */
const LEVEL_CAP = (() => {
  let level = 0;
  for (;;) {
    try {
      spellSlotsForLevel("wizard", level + 1);
    } catch {
      return level;
    }
    level++;
  }
})();

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

/** The six scores' modifier, from rules/abilities.ts. */
const modifierRows = [[1], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17], [18, 19], [20]].map((scores) => [
  scores.length === 1 ? String(scores[0]) : `${scores[0]} or ${scores[1]}`,
  signed(abilityModifier(scores[0]!)),
]);

/** What a level costs in hit points for a class, off rules/leveling.ts applyLevelUp at CON 10 (modifier 0): the die's average, rounded up. */
function levelHpAverage(characterClass: CharacterClass): number {
  const base: LevelableCharacter = {
    characterClass,
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    maxHp: 0,
    currentHp: 0,
    proficiencyBonus: proficiencyBonus(1),
  };
  return applyLevelUp(base, 2).character.maxHp;
}

const CLASS_NAME: Record<CharacterClass, string> = { fighter: "Fighter", rogue: "Rogue", cleric: "Cleric", wizard: "Wizard" };

/** A starting sheet for a playable hero, made by the creator's own createCharacter, so every number in the hero table is the engine's. */
function sampleHero(id: string, choices?: Record<string, string>): CharacterSheet {
  return createCharacter({
    archetypeId: id,
    name: "Example",
    appearanceAssetId: `token_${id.replace("-", "_")}`,
    ...(choices ? { choices } : {}),
  });
}

const HEROES = PLAYABLE_ARCHETYPE_IDS.map((id) => ({
  archetype: getArchetype(id),
  /** No fighting style picked beyond Dueling, so the armour figure is the bare armour. */
  bare: sampleHero(id, { fightingStyle: "dueling" }),
  /** The default pick (the first option). */
  usual: sampleHero(id),
}));

function armorClassText(bare: CharacterSheet): string {
  const defense = sampleHero(bare.archetypeId, { fightingStyle: "defense" });
  return bare.armorClass === defense.armorClass ? `${bare.armorClass}` : `${bare.armorClass} (${defense.armorClass} with Defense)`;
}

/** The knight's numbers, which the worked examples use. */
const KNIGHT = sampleHero("knight", { fightingStyle: "defense" });
const KNIGHT_ATTACK = attackerBonusFor(KNIGHT);
const KNIGHT_DAMAGE = parseDiceNotation(weaponDamageNotationFor(KNIGHT));
const GOBLIN = MONSTER_STATBLOCKS["token_goblin"]!;
const SKELETON = MONSTER_STATBLOCKS["token_skeleton"]!;
const RAT = MONSTER_STATBLOCKS["token_rat"]!;
const GIANT_RAT = MONSTER_STATBLOCKS["token_giant_rat"]!;
/** A Knight with no armour and no shield, and the same Knight in chain mail: the two figures the armour rule quotes, both made by the creator itself. */
const KNIGHT_BARE = createCharacter({ archetypeId: "knight", name: "Example", appearanceAssetId: "token_knight", startingKit: { armor: "none" } });
const KNIGHT_IN_MAIL = sampleHero("knight", { fightingStyle: "dueling" });
const KNIGHT_PERCEPTION = skillModifierFor(KNIGHT, "Perception");
/**
 * Fire Bolt twice over. Through the Attack button the Fireball Person swings it as a weapon (session/combat.ts
 * weaponDamageNotationFor: the die plus the Intelligence modifier, plus a magic weapon's bonus); through Cast it is
 * the spell (menu/casting.ts SPELL_EFFECTS: the die alone).
 */
const FIRE_BOLT_ATTACK_DAMAGE = weaponDamageNotationFor(sampleHero("fireball-person"));
const FIRE_BOLT_CAST_DAMAGE = (() => {
  const effect = SPELL_EFFECTS["Fire Bolt"];
  return effect && effect.kind === "attack" ? effect.damage : "no listed damage";
})();

const SKILLS_BY_ABILITY: Record<(typeof ABILITIES)[number], string[]> = { str: [], dex: [], con: [], int: [], wis: [], cha: [] };
for (const [skill, ability] of Object.entries(SKILL_ABILITY)) SKILLS_BY_ABILITY[ability].push(skill);

/** The first character level at which a wizard has a slot of this spell level, from rules/spells.ts spellSlotsForLevel. */
function firstLevelWithSlot(spellLevel: number): number | null {
  for (let level = 1; level <= LEVEL_CAP; level++) {
    if (spellSlotsForLevel("wizard", level)[spellLevel]) return level;
  }
  return null;
}

function slotsWords(level: number): string {
  const slots = spellSlotsForLevel("wizard", level);
  return Object.entries(slots)
    .map(([spellLevel, bucket]) => `${bucket.max} of level ${spellLevel}`)
    .join(", ");
}

function spellDoes(name: string): string {
  const effect = SPELL_EFFECTS[name];
  if (!effect) return "The DM rules on this. The game has no rules for it yet.";
  switch (effect.kind) {
    case "attack":
      return effect.attacks && effect.attacks > 1
        ? `${effect.attacks} separate spell attacks, each ${effect.damage} ${effect.damageType} damage on a hit.`
        : `A spell attack. ${effect.damage} ${effect.damageType} damage on a hit.`;
    case "autohit":
      return `Never misses, no roll to hit. ${effect.damage} ${effect.damageType} damage.`;
    case "save":
      return `The target makes a ${ABILITY_NAME[effect.ability]} save against your spell save DC. ${effect.damage} ${effect.damageType} damage${effect.halfOnSave ? ", half on a successful save" : ", none on a successful save"}.`;
    case "heal":
      return `Heals ${effect.dice} hit points.`;
    case "utility":
      return "Cast, and it spends its slot, but the game applies no number. The DM rules on this.";
  }
}

function spellReach(name: string): string {
  const effect = SPELL_EFFECTS[name];
  if (!effect || effect.kind === "utility" || effect.kind === "heal") return "Not aimed";
  return `${spellRangeFt(name)} ft`;
}

function tierWord(tier: (typeof EQUIPMENT_TIERS)[number]): string {
  return TIER_WORD[tier];
}

const BONUS_KIND_WORDS: Record<BonusKind, string> = {
  weapon: "attack and damage",
  armor: "Armor Class",
  save: "saving throws",
};

const SLOT_WORDS: Record<(typeof GEAR_ROLES)[number], string> = {
  weapon: "Weapon",
  outer: "Outer (shield or cloak)",
  crown: "Head or body",
  ring: "Ring",
  amulet: "Amulet",
  boots: "Boots",
};

function effectWords(effect: AccessoryEffect | null): string {
  if (!effect) return "Nothing. These are the boots you started in.";
  switch (effect.kind) {
    case "protection":
      return `${signed(effect.amount)} Armor Class and ${signed(effect.amount)} on every saving throw.`;
    case "luck":
      return `${signed(effect.amount)} on every skill check and every saving throw.`;
    case "skillAdvantage":
      return `Advantage on ${effect.skill} checks.`;
    case "speedMultiplier":
      return effect.factor === 2 ? "Doubles your walking speed." : `Your walking speed is multiplied by ${effect.factor}.`;
    case "hitDieHealingMultiplier":
      return `Every hit die you spend on a short rest heals ${effect.factor === 2 ? "twice" : `${effect.factor} times`} as much.`;
    case "saveRescue":
      return `A failed ${ABILITY_NAME[effect.ability]} saving throw becomes a success. ${effect.charges} charges; a long rest restores ${effect.rechargeDice}.`;
    case "restRegeneration":
      return `Each short rest also heals ${effect.dice} hit points.`;
  }
}

const ancestryRows = ANCESTRIES.map((a) => {
  const increases = [
    ...ABILITIES.filter((k) => a.abilityIncreases[k]).map((k) => `${signed(a.abilityIncreases[k]!)} ${ABILITY_NAME[k]}`),
    ...(a.chooseIncreases ? [`${signed(a.chooseIncreases.amount)} to ${a.chooseIncreases.count === 2 ? "two" : a.chooseIncreases.count} abilities you choose`] : []),
  ].join(", ");
  const skip = new Set(["Ability Score Increase", "Speed"]);
  const applied = a.traits.filter((t) => t.applied && !skip.has(t.name)).map((t) => t.name);
  const told = a.traits.filter((t) => !t.applied).map((t) => t.name);
  return [a.name, `${a.speedFt} ft`, increases, applied.join(", ") || "none", told.join(", ") || "none"];
});

const pointBuyRows = [8, 9, 10, 11, 12, 13, 14, 15].map((score) => [
  String(score),
  String(pointBuyCost({ str: score, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }) ?? "?"),
]);

// ── the sections ─────────────────────────────────────────────────────────

const HOW_TO_PLAY: RuleSection = {
  id: "how-to-play",
  title: "How to play",
  summary: "Three things sit at the table: the board, the dice and the DM. You choose what to try, the dice decide how it goes, and the DM tells the story around both.",
  blocks: [
    p("You play one hero in one room at a time. The board shows the room as a grid of squares, your hero and whatever else is in it. You walk, fight, search, use things, rest, or type what you want to try."),
    list(
      "The board: on the asset bench you click a square to walk there, the goblin to attack it, a door or a chest to use it. In the game screen you step with the N, E, S and W buttons, one square a press, and attack from a button for each creature.",
      "The dice: every roll that matters is a real die, rolled by the rules engine and shown to you. Nothing is decided without one.",
      "The DM: an AI that knows the whole room, tells you what you can see, and rules on anything you try that the buttons do not cover. It never rolls a die and never changes a result.",
    ),
    // menu/commandMenu.ts COMMAND_VERBS; the game screen's Inventory and Character sheet buttons, the bench's pack key (assets.ts, key "i")
    p(`The game's buttons are ${COMMAND_VERBS.join(", ")}. The Pack button (key I on the bench, the Inventory button in the game screen) shows what you wear and carry, and on the bench the Sheet button (key C) shows your character sheet, where New character makes a new one.`),
    // menu/commandMenu.ts resolveMenuAction: a move into an unassembled neighbour is the one local verb routed to the DM (1 credit)
    p("Moving, attacking, casting, searching, using items, resting and levelling are all worked out by the engine on your own device, and none of them costs anything. The one exception is in the game: a step out of the room into a room nobody has built yet asks the DM to build it, and that costs 1 credit. Talking to the DM, typing what you try and looking closer also ask it."),
    note("Where this book says \"The DM rules on this\", the engine has no number behind it and the DM decides what it does in the story. Where it says \"The game applies this\", the engine adds the number for you."),
    note("On the asset bench the Play tab's window shows Attack (F), Use (E), Potion (Q) and End turn (T) as buttons. The game has the full verb list above."),
  ],
  seeAlso: ["your-character", "checks", "the-dm"],
};

const YOUR_CHARACTER: RuleSection = {
  id: "your-character",
  title: "Your character",
  summary: "Your hero is a sheet of numbers. The engine reads those numbers every time you roll, so what the sheet says is exactly what is used.",
  blocks: [
    p(`Six ability scores, each from 1 to ${ABILITY_SCORE_CAP}. The modifier is what gets added to your rolls: the score minus 10, divided by 2, rounded down.`),
    // rules/abilities.ts abilityModifier
    table(["Score", "Modifier"], modifierRows),
    // SKILL_ABILITY in characters/creation.ts, and the engine's own uses of each ability
    table(
      ["Ability", "Skills", "What else uses it"],
      [
        ["Strength", SKILLS_BY_ABILITY.str.join(", "), `The Knight's attack and damage. Chain mail needs Strength ${CHAIN_MAIL_STRENGTH}, or your speed drops by ${HEAVY_ARMOR_SPEED_PENALTY_FT} ft.`],
        ["Dexterity", SKILLS_BY_ABILITY.dex.join(", "), "Initiative, Armor Class in light armor or none, the Shadow's attack and damage."],
        ["Constitution", SKILLS_BY_ABILITY.con.join(", ") || "none", "Hit points at every level, and what a short rest heals."],
        ["Intelligence", SKILLS_BY_ABILITY.int.join(", "), "The Fireball Person's attack, damage, spell attack and spell save DC."],
        ["Wisdom", SKILLS_BY_ABILITY.wis.join(", "), "Perception, which Search uses."],
        ["Charisma", SKILLS_BY_ABILITY.cha.join(", "), "Skills only. Nothing else on the sheet reads it yet."],
      ],
    ),
    // rules/abilities.ts proficiencyBonus
    p(`Proficiency bonus is ${signed(proficiencyBonus(1))} at level 1 and stays ${signed(proficiencyBonus(LEVEL_CAP))} at level ${LEVEL_CAP}. It is added to your attack rolls, to the skills and saving throws you are trained in, to your spell attack and to your spell save DC.`),
    p("A trained skill adds your proficiency bonus to its ability modifier. An untrained skill adds only the modifier. Expertise (the Shadow picks one skill for it) adds your proficiency bonus twice. You can roll any of the 18 skills, trained or not; the sheet lists the ones you are trained in. No skill can be trained twice: if your class, your background or your ancestry already gives you one, the creator refuses it from the second."),
    p("Each class is trained in two saving throws. A saving throw you are trained in adds your proficiency bonus; the others add only the ability modifier."),
    p("Armor Class (AC) is the number an attack has to meet or beat to hit you. It comes from your armor:"),
    list(
      "No armor: 10 plus your Dexterity modifier.",
      "Light armor: the armor's number plus your Dexterity modifier.",
      "Medium armor: the armor's number plus your Dexterity modifier, but that modifier counts for at most +2.",
      "Heavy armor: the armor's number, and Dexterity does not count.",
    ),
    p(`Hit points (HP) are how much you can take. At level 1 you have your hit die's highest face plus your Constitution modifier, never less than 1. You also have one hit die per level, which a short rest spends. Your speed is ${SPEED_FT} ft, which is ${SPEED_SQUARES} squares, unless your ancestry says otherwise.`),
    table(
      ["Hero", "Class", "Hit die", "HP at level 1", "AC", "Trained saves", "Starting skills"],
      HEROES.map(({ archetype, bare }) => [
        archetype.displayName,
        CLASS_NAME[archetype.chassis],
        `d${bare.hitDieSides}`,
        String(bare.maxHp),
        armorClassText(bare),
        bare.saves.map((s) => ABILITY_NAME[s.ability]).join(" and "),
        bare.skills.map((s) => s.skill).join(", "),
      ]),
    ),
    p("Every creation choice has a default, so you can begin with the defaults at any step. You choose:"),
    list(
      `A class: ${HEROES.map((h) => `${h.archetype.displayName} (${CLASS_NAME[h.archetype.chassis]})`).join(", ")}.`,
      `An ancestry, from the nine in the SRD (table below).`,
      `Six ability scores, one of three ways. Standard array: assign ${STANDARD_ARRAY.join(", ")}. Point buy: ${POINT_BUY_BUDGET} points, each score from 8 to 15 before your ancestry adds its bonus. Rolled: four d6 six times, each group's lowest die dropped. Ancestry bonuses can take a score no higher than ${ABILITY_SCORE_CAP}.`,
      `Your class skills: ${Object.entries(CLASS_SKILL_CHOICES)
        .filter(([cls]) => HEROES.some((h) => h.archetype.chassis === cls))
        .map(([cls, c]) => `${CLASS_NAME[cls as CharacterClass]} picks ${c.count}`)
        .join(", ")}, from the SRD class list.`,
      "A background you write yourself: a name and any two skills, plus (all optional) a personality trait, an ideal, a bond and a flaw in your own words.",
      "An alignment, a name and a backstory.",
    ),
    table(["Point buy score", "Cost in points"], pointBuyRows),
    // characters/ancestries.ts ANCESTRIES: each trait's `applied` flag
    table(["Ancestry", "Speed", "Ability increases", "Also applied by the game", "The DM rules on"], ancestryRows),
    note("Ability increases and speed are always applied by the game. The sheet labels every other trait one way or the other: \"The game applies this\" or \"The DM rules on this\". A trait marked the second way is part of the story and has no number behind it in the engine. Dwarven Toughness adds its hit point at level 1 only; the level-up engine does not add it again."),
    note("Class features beyond the ones in this book (the Rogue's Sneak Attack, for example) are not applied by the engine. The DM rules on them in the story."),
  ],
  seeAlso: ["checks", "combat", "levels", "equipment"],
};

const CHECKS: RuleSection = {
  id: "checks",
  title: "Checks and saving throws",
  summary: "When the outcome is uncertain, you roll a d20, add a modifier and try to meet a Difficulty Class.",
  blocks: [
    p("A check or a saving throw is one roll: a d20 plus a modifier, against a Difficulty Class (DC). Meet the DC or beat it and you succeed. A tie succeeds."),
    list(
      "A skill check adds that skill's bonus from your sheet.",
      "An ability check with no skill adds just the ability modifier (the bench DM can ask for one; in the game the DM names a skill).",
      "A saving throw adds your ability modifier, plus your proficiency bonus if you are trained in that save, plus any worn bonus to saves.",
    ),
    p("On a check or a saving throw a natural 20 is not an automatic success and a natural 1 is not an automatic failure. Attack rolls and death saves are the two rolls that treat them specially."),
    // session/combat.ts MIN_DC and MAX_DC; the SRD's own typical DC table
    table(
      ["How hard", "DC"],
      [["Very easy", "5"], ["Easy", "10"], ["Medium", "15"], ["Hard", "20"], ["Very hard", "25"], ["Nearly impossible", "30"]],
    ),
    p(`The engine keeps every DC the DM asks for between ${MIN_DC} and ${MAX_DC}. A Search uses the prop's own DC, or ${SEARCH_DEFAULT_DC} when it has none.`),
    p("Advantage means you roll two d20 and keep the higher. Disadvantage means you roll two and keep the lower. If you have both, they cancel and you roll one."),
    p("Today advantage comes from your gear (Boots of Elvenkind on Stealth checks) and, on the asset bench, from the DM granting it on a check it asks for. An attack roll never has advantage or disadvantage in the engine. The SRD conditions that would give one (prone, blinded, and so on) are told to the DM and are not applied: the DM rules on this."),
    p("Who rolls:"),
    list(
      "The engine rolls every die: your initiative, attacks, damage, saves, checks and death saves, every creature's dice, and every loot roll. You never choose a number.",
      "On the asset bench the tray waits for your tap to throw each roll (untick \"I roll my own dice\" and it throws by itself), but the number was fixed by the engine before the tray moved. In the game screen you press the button for what you do and the result lands in the dice log.",
      "The DM asks for a roll and names a DC. It never rolls and never changes the result.",
    ),
    p("The dice tray shows a d4, d6, d8, d10, d12 or d20 for each roll, with the number on the face turned to you, and lands on the number the engine already rolled. The tray only animates; it never picks. A loot roll is a d100, and it is written in the log."),
    example(
      `You search the chest. A Search is a Perception check against the chest's DC, ${SEARCH_DEFAULT_DC} if it has none of its own. The Knight's Perception is ${signed(KNIGHT_PERCEPTION)} (Wisdom ${KNIGHT.abilities.wis} gives ${signed(KNIGHT.modifiers.wis)}, and Perception is not one of the Knight's trained skills). You roll ${SEARCH_DEFAULT_DC - KNIGHT_PERCEPTION}: ${SEARCH_DEFAULT_DC - KNIGHT_PERCEPTION} ${signed(KNIGHT_PERCEPTION)} = ${SEARCH_DEFAULT_DC}, which meets DC ${SEARCH_DEFAULT_DC}. You find it.`,
    ),
  ],
  seeAlso: ["exploring", "combat", "the-dm"],
};

const EXPLORING: RuleSection = {
  id: "exploring",
  title: "Exploring",
  summary: "The room is a grid of 5 foot squares. You see only what is in line of sight, and you can try anything by typing it.",
  blocks: [
    p(`One square is ${SQUARE_FT} ft. A room is ${ROOM_COLS} squares wide and ${ROOM_ROWS} tall, which is ${ROOM_COLS * SQUARE_FT} ft by ${ROOM_ROWS * SQUARE_FT} ft. Distance is counted in squares in any direction, and a diagonal step costs the same ${SQUARE_FT} ft as a straight one.`),
    p(`Walking: on the asset bench you click a square and your hero walks there, and the route round anything in the way is found for you; in the game screen you step N, E, S or W, one square a press. Outside a fight there is no limit to how far you walk. In a fight you have ${SPEED_FT} ft (${SPEED_SQUARES} squares) a turn. You cannot walk through a wall, a shut door or another creature, and a diagonal step cannot squeeze between two solid corners that touch.`),
    p("Doors: a shut door blocks walking and blocks sight, for you and for monsters. In the game the DM opens and closes doors when you try them. A monster cannot open a shut door, so it waits at it unless the DM opens it."),
    note("On the asset bench you stand next to a door and press Use to open or close it, and the DM can also lock and unlock one. A locked door says \"Locked.\" and stays shut."),
    p("Leaving the room through an exit takes you to the next room. In the game, if nobody has built that room yet, the DM builds it as you arrive, and that step costs 1 credit. Stepping through an exit also ends the fight on your side: the creatures stay in the room you left, and a new fight starts if you come back. Rooms you have been in stay as you left them."),
    p("Search: use Search on a chest or anything else that might hold something. It is a Perception check against that prop's DC. In the game you can search any prop in the room from where you stand: there is no walking up to it, and in a fight it does not use your action. A success finds what is there, and a chest also rolls loot. A failure only means you did not find it: you can search again. A prop you have found something in has nothing more to give."),
    note("On the asset bench the chest simply opens when you use it, with no check. In the game, Search is the check above."),
    p("Sight is a rule, not decoration. Walls, shut doors, trees, buildings, pillars, stacked crates and pipe columns block sight. Water, chasms, chests, tables, beds, fences, open doors and stairs do not. Sight is symmetric: if you can see a creature, it can see you. A look cannot slip through a crack where two solid corners touch."),
    p("The fog of war follows from sight. A square you have never seen is mist. A square you have seen before stays on the map as a memory of its terrain and props, never of creatures. A square in sight right now is clear, and creatures show only there."),
    p("A ranged attack needs a clear line of sight to its target. A melee attack does not need one, because the target is next to you. A spell needs only its reach (see Magic), not a clear line."),
    note(`On the asset bench the goblin wakes when you and it see each other within ${BENCH_NOTICE_TILES} squares, or when a walking path to you is ${BENCH_HEARS_STEPS} squares or fewer, because it hears you. The fog is drawn on the bench. The game uses the same sight rule but does not draw the fog yet.`),
    p("Freehand: type what you try. The DM decides what happens. Something trivial just happens. Something impossible fails in the story. Something uncertain gets one check, and the dice settle it. Looking closer works the same way: on the asset bench, right-click or long-press a square."),
  ],
  seeAlso: ["checks", "the-dm", "equipment"],
};

const COMBAT: RuleSection = {
  id: "combat",
  title: "Combat",
  summary: "A fight is played in rounds. On your turn you move and act; then every creature in the fight takes its turn.",
  blocks: [
    p("Starting a fight: in the game a fight begins when a hostile creature is on the board. Everyone rolls initiative."),
    note(`On the asset bench the fight starts when the goblin notices you (it sees you within ${BENCH_NOTICE_TILES} squares, or hears you at ${BENCH_HEARS_STEPS} squares of walking or fewer). Attacking a goblin that has not noticed you starts it too, and you swing on your turn.`),
    // menu/combatRound.ts MONSTER_INITIATIVE_MODIFIER; rules/initiative.ts sortInitiative (stable)
    p(`Initiative: you roll a d20 and add your Dexterity modifier. Every monster adds a flat ${signed(MONSTER_INITIATIVE_MODIFIER)}. The highest total goes first, and a tie goes to whoever is listed first, which is you.`),
    p("Rounds and turns: each creature has one turn per round, in initiative order. When the last creature has gone, the round counter goes up and the order starts again."),
    p("On your turn you have:"),
    list(
      `Movement: your speed, ${SPEED_FT} ft, which is ${SPEED_SQUARES} squares. It is spent a square at a time and you can walk before or after you act.`,
      "One action: Attack or cast a spell. These two spend your action, and so does an attack the DM asks you to roll. A potion, a Search and a check or save the DM asks for do not use your action in the game. On the asset bench a potion does, and so does any check the DM asks for in a fight.",
      "A bonus action and a reaction. The engine keeps both on your turn record, but nothing you do spends them yet. Shield (a reaction) and Misty Step (a bonus action) are cast with your action and spend a slot, and have no number behind them. The DM rules on those moments in the story.",
    ),
    p("When your turn comes round again, your movement, action, bonus action and reaction all come back. Whatever you did not spend on your turn is lost. Press End turn when you are done."),
    p(`An attack: roll a d20 and add your attack bonus. If the total meets or beats the target's AC, you hit. Your attack bonus is your weapon's ability modifier plus your proficiency bonus, plus ${signed(ARCHERY_ATTACK_BONUS)} with the Archery style on a ranged weapon, plus a magic weapon's bonus. You get one attack per action.`),
    // session/combat.ts weaponFor (KIT_BY_ARCHETYPE), the default pick for each hero
    table(
      ["Hero", "Attacks with", "Damage die", "Adds", "Range"],
      HEROES.map(({ archetype, usual }) => {
        const weapon = weaponFor(usual);
        return [
          archetype.displayName,
          weapon.name,
          weapon.damageDie,
          ABILITY_NAME[weapon.ability],
          weapon.ranged ? `${RANGED_FT} ft` : `${MELEE_FT} ft`,
        ];
      }),
    ),
    p(`Reach and range: a melee attack reaches ${MELEE_FT} ft, which is the next square, diagonals included. A ranged attack reaches ${RANGED_FT} ft and needs a clear line of sight. The Attack button goes grey and says why when the target is too far or cannot be seen. A spell has its own reach, listed under Magic.`),
    p("The SRD's long range and its penalty for shooting at something next to you are not applied. Cover does not exist except as a wall that blocks sight. The DM rules on any of that in the story."),
    p(`A natural 20 always hits and is a critical hit. A natural 1 always misses. No bonus saves a 1 and no AC stops a 20. A Champion fighter scores a critical on a roll of ${DEFAULT_CRITICAL_ON - 1} or ${DEFAULT_CRITICAL_ON}; everyone else, and every monster, only on ${DEFAULT_CRITICAL_ON}.`),
    p(`Damage: roll your weapon's die and add the same ability modifier. Dueling adds ${signed(DUELING_DAMAGE_BONUS)} with a one-handed melee weapon (a shield in the other hand is fine). A magic weapon adds its bonus. A legendary weapon rolls its extra dice as well. On a critical hit every damage die is rolled twice as many times; the flat modifiers are added once.`),
    p("A creature that reaches 0 hit points is out of the fight and leaves the board. Monsters do not make death saves."),
    table(
      ["Creature", "AC", "Hit points", "To hit", "Damage", "Speed"],
      [GOBLIN, SKELETON, RAT, GIANT_RAT].map((m) => [m.name, String(m.armorClass), String(m.maxHp), signed(m.attackBonus), m.damageNotation, `${SPEED_FT} ft`]),
    ),
    p("A monster's turn: it walks toward you along the shortest route, around walls and through open doors, as far as its speed allows. If it ends next to you and still has its action, it makes one attack with its to-hit bonus against your AC. If it cannot reach you it walks as near as it can and stops. A monster never flees or surrenders on its own. Only the DM can make that happen, in the story."),
    p("There are no opportunity attacks. Walking away from a creature next to you does not give it a free swing, although it will follow you on its own turn. The SRD's other combat actions (Dash, Dodge, Disengage, Help and Ready) are not in the engine: nothing doubles your movement or gives anyone disadvantage. Type one and the DM rules on it in the story."),
    p("When the last hostile creature falls to your Attack button, the fight is over. You earn a milestone (until you reach the level cap), and the engine rolls loot. A last creature that falls to a spell, or to an attack the DM asked you to roll, ends the fight too but earns no milestone and no loot. Stepping through an exit ends it as well; see Exploring."),
    example(
      `The Knight attacks a goblin. The Knight's attack bonus is ${signed(KNIGHT_ATTACK)}, the goblin's AC is ${GOBLIN.armorClass}, so the Knight needs ${GOBLIN.armorClass - KNIGHT_ATTACK} or more on the d20. The roll is 13: 13 ${signed(KNIGHT_ATTACK)} = ${13 + KNIGHT_ATTACK}, a hit. Damage is ${KNIGHT_DAMAGE.count}d${KNIGHT_DAMAGE.sides}${signed(KNIGHT_DAMAGE.modifier)}. The die shows ${GOBLIN.maxHp - KNIGHT_DAMAGE.modifier}: ${GOBLIN.maxHp - KNIGHT_DAMAGE.modifier} ${signed(KNIGHT_DAMAGE.modifier)} = ${GOBLIN.maxHp}, which is all of the goblin's ${GOBLIN.maxHp} hit points, and it goes down.`,
    ),
    note("A creature's special traits and actions (a skeleton's vulnerability, a dragon's breath) are not applied by the engine unless this book says so. The Bestiary lists them as reference, and the DM rules on them."),
  ],
  seeAlso: ["dying", "magic", "equipment", "levels"],
};

const DYING: RuleSection = {
  id: "dying",
  title: "Damage, healing and dying",
  summary: "Hit points go down when you are hurt. At 0 you fall and roll death saves; healing brings you back.",
  blocks: [
    p("Damage takes hit points off. Your hit points never go below 0. A hit on a hero who is standing never kills outright: the SRD's instant death rule is not used here, so you always get your death saves."),
    p(`At 0 hit points you fall unconscious (and prone and incapacitated) and start rolling death saves. In a fight you roll one on each of your turns, and a death save ends the turn. Outside a fight there are no turns, so you can roll whenever you like. It is a flat d20 with no modifier at all. A ${DEATH_SAVE_DC} or higher is a success. Below ${DEATH_SAVE_DC} is a failure.`),
    list(
      "Three successes: you are stable. You are still at 0 hit points and out cold, but no longer dying.",
      "Three failures: you die.",
      "A natural 20: you come round at 1 hit point, with the tally cleared.",
      "A natural 1: it counts as two failures.",
      "Damage while you are at 0 hit points is a failed death save, and a critical hit counts as two. Any damage to a stable character is a failed death save and starts the dying again.",
    ),
    p("Healing: any healing at all brings you back to your feet at that many hit points, at least 1, and clears the death save tally. Healing never takes you above your maximum."),
    p(`A potion of healing (the Item button) heals ${POTION_DICE}, which is ${POTION_MIN} to ${POTION_MAX} hit points. You cannot use items while you are on the floor, so potions are for before you fall.`),
    note("On the asset bench there are no death saves yet: when you are down, the scene waits for Reset scene. The bench's Potion button works while you are down, takes your action in a fight, and is refused at full health. In the game the Item button is the other way round on all three: it is refused while you are down, it spends no action, and it works at any hit points (a potion drunk at full health heals nothing)."),
    p("Dying is the end of that hero and never the end of the campaign. Nothing is charged for losing."),
    p(`Conditions: the engine knows ${SRD_CONDITIONS.length} of the SRD's conditions (${SRD_CONDITIONS.join(", ")}); exhaustion is not one of them. It can hold any of them on your hero and tells them to the DM, but today the only one it sets is unconscious, with prone and incapacitated, while you are at 0 hit points (dying or stable). A landed Trip Attack tells the DM the target is prone; the board does not hold it. The game does not change anyone's rolls because of a condition: the DM rules on this.`),
    example(
      "You are at 0 hit points. Your first death save is a 12, a success (1 of 3). Next turn you roll a 4, a failure (1 of 3). The turn after, you roll a natural 20 and come round at 1 hit point. Had a goblin hit you while you were down instead, that would have been a failed death save.",
    ),
  ],
  seeAlso: ["resting", "combat", "equipment"],
};

const RESTING: RuleSection = {
  id: "resting",
  title: "Resting",
  summary: "A short rest is a breather that spends a hit die. A long rest is a night's sleep, once a day.",
  blocks: [
    p("You cannot rest with a hostile creature on the board (even one you have not seen), and you cannot rest while you are dying. Resting is free."),
    p(`A short rest (Catch your breath) takes an hour and spends one hit die each time you take it: roll it, add your Constitution modifier (never less than 1 hit point healed), and heal that much. You have one hit die per level. A short rest is refused at full health (unless you are stable at 0 hit points) or when you have no hit dice left; a long rest gives them back. A short rest also gives back a Battle Master's superiority dice.`),
    p("A long rest takes a night. It restores all your hit points, every hit die, every spell slot and your superiority dice, and a charged item rolls to get some of its charges back. It also gets a stable character off the floor and clears the death saves."),
    p("You can only benefit from one long rest in a day. A new day begins when something has happened: you win a fight with the Attack button, or the DM builds you a room to walk into. Until then, a second long rest is refused with the reason."),
    p("Items can change a rest: the Periapt of Wound Closure doubles what each hit die heals, and the Ring of Regeneration adds its dice at the end of each short rest. A Ring of Evasion gets back some of its charges at the end of a long rest."),
    note("The asset bench has no Rest buttons yet. The game does."),
  ],
  seeAlso: ["dying", "levels", "equipment"],
};

const gearHeroRows: string[][] = [];
for (const id of PLAYABLE_ARCHETYPE_IDS) {
  const archetype = getArchetype(id);
  const slots = SLOTS_BY_ARCHETYPE[id as ArchetypeId];
  for (const role of ["weapon", "outer", "crown"] as const) {
    const slot = slots[role];
    gearHeroRows.push([archetype.displayName, SLOT_WORDS[role], BONUS_KIND_WORDS[slot.bonusKind], slot.nameByTier.join(", ")]);
  }
}

const EQUIPMENT: RuleSection = {
  id: "equipment",
  title: "Equipment and loot",
  summary: "You wear six pieces of gear. Each has a rank, and each rank adds a fixed bonus. Loot is a die roll, never a gift.",
  blocks: [
    p("You have six slots: weapon, outer (a shield or a cloak), head or body, ring, amulet and boots. Weapon, outer, head or body and boots always hold something, and you start with plain common pieces in all four. Ring and amulet start empty."),
    // equipmentTypes.ts SLOTS_BY_ARCHETYPE and BONUS_BY_TIER
    table(["Hero", "Slot", "A bonus to", "From common up to legendary"], gearHeroRows),
    table(
      ["Rank", "Bonus"],
      EQUIPMENT_TIERS.map((tier) => [tierWord(tier), signed(BONUS_BY_TIER[tier])]),
    ),
    p(`A weapon's bonus adds to both its attack roll and its damage. An armor piece's bonus adds to your Armor Class. A saving-throw piece's bonus adds to every saving throw. All the bonuses to Armor Class from your gear together never add more than ${signed(MAX_TOTAL_AC_BONUS)}, and to saving throws never more than ${signed(MAX_TOTAL_SAVE_BONUS)}. Bonuses to skill checks never add more than ${signed(MAX_TOTAL_CHECK_BONUS)}. No magic bonus is above ${signed(MAGIC_ITEM_BONUS_MAX)}.`),
    p("A legendary weapon also rolls extra damage dice of its own type on every hit (radiant for the Knight's, poison for the Shadow's, fire for the Fireball Person's). The extra dice are doubled on a critical hit."),
    p("A shield needs a free hand. A two-handed weapon leaves none, so a shield's bonus does not apply with one. Heavy armor that needs more Strength than you have slows you."),
    p(`A hero can wear no armor at all, and an adventure can start them that way. With no armor and no shield, Armor Class is 10 plus your Dexterity modifier and nothing slows you: a Knight with Dexterity ${KNIGHT_BARE.abilities.dex} is Armor Class ${KNIGHT_BARE.armorClass} bare and ${KNIGHT_IN_MAIL.armorClass} in chain mail. The armor-kind gear rows (a shield, a cloak, body armor) then read Nothing worn, and a bare hero is not drawn wearing them. Armor you find goes in your pack: Equip puts it on and your Armor Class is worked out from it, Unequip takes it off again. Both are free, and like any gear change they are refused with something hostile in the room. A magic piece worn in an armor row is real and adds its bonus whether or not you wear armor. Defense, the fighting style, is a point of Armor Class only while you wear armor, so a hero who starts bare is not offered it.`),
    p("Ring, amulet and boots are shared by every hero. Each does one thing, from its SRD text, and the number is on the item:"),
    // equipmentTypes.ts ACCESSORY_ITEMS, fantasy names
    table(
      ["Item", "Slot", "Rank", "Attunement", "What it does"],
      ACCESSORY_ROLES.flatMap((role) =>
        EQUIPMENT_TIERS.flatMap((tier) => {
          const item = ACCESSORY_ITEMS[role][tier];
          if (!item) return [];
          return [[item.nameByTemplate.fantasy, SLOT_WORDS[role], tierWord(tier), item.requiresAttunement ? "Needs it" : "None", effectWords(item.effect)]];
        }),
      ),
    ),
    p(`Attunement: wearing an item that needs it is attuning to it. You can be attuned to ${MAX_ATTUNED_ITEMS} items at once. A fourth item that needs it is refused: take one off first. A plus-N weapon or armor needs none; a legendary weapon and a saving-throw piece above common do.`),
    p("You can only change your gear when nothing hostile is in the room and you are on your feet."),
    p(`The bag holds the magic items you own but do not wear: ${BAG_COLUMNS} columns by ${BAG_ROWS} rows, ${BAG_CAPACITY} places. It cannot fill. You can own at most ${MAX_DISTINCT_MAGIC_ITEMS} different magic items, because loot never gives you one you already own. Your own common pieces are never in the bag: taking off a magic piece puts your common one back. Potions are kept apart, and plain things you carry (a key, a rope) are story, with no number: the DM rules on them.`),
    p(`Loot: when you win a fight with your Attack button, or successfully search a chest, the engine rolls a d${LOOT_DIE_SIDES}.`),
    // equipmentTypes.ts LOOT_TIER_BANDS: each band's upper roll
    table(
      ["d100 roll", "You find", "Chance"],
      LOOT_TIER_BANDS.map((band, i) => {
        const from = i === 0 ? 1 : LOOT_TIER_BANDS[i - 1]!.upTo + 1;
        return [`${from} to ${band.upTo}`, band.tier ? tierWord(band.tier) : "Nothing", `${band.upTo - from + 1} in ${LOOT_DIE_SIDES}`];
      }),
    ),
    p("Then a second die picks which piece of that rank you find, from the pieces of it that you do not already own. If only one piece qualifies there is no second die, and if none does, you already have every piece of that rank. What you find goes in the bag."),
    p(`Each room allows at most ${LOOT_ROLLS_PER_CELL} loot rolls, fights and containers together. After that the log says: ${LOOT_CAP_LINE} A kill that does not come from the Attack button (a spell, or an attack the DM asked you to roll) earns no loot. The DM never picks, names or prices an item.`),
    example(
      "You search a chest and succeed. The engine rolls a d100 and gets 88: that is a rare find. You own none of the rare pieces yet, so it rolls a second die across all six slots, a d6, and gets 4. The fourth slot is the ring: the Ring of Protection goes in your bag.",
    ),
    note("On the asset bench the chest opens without a check and always rolls its loot (once). In the game it is a Search, and the loot only rolls on a success."),
  ],
  seeAlso: ["combat", "resting", "the-dm"],
};

const LEVELS: RuleSection = {
  id: "levels",
  title: "Levels",
  summary: `You earn levels from things that happen, not from a points total. The game stops at level ${LEVEL_CAP}.`,
  blocks: [
    // characters/leveling.ts MILESTONES_PER_LEVEL
    p(`A milestone is something the story actually did: you win a fight with the Attack button, or the DM builds you a new room. Every ${MILESTONES_PER_LEVEL} milestones earn a level. When you have enough, a Level up button appears, and the story tells you how many more you need.`),
    p(`Levels run from 1 to ${LEVEL_CAP}. Your proficiency bonus stays ${signed(proficiencyBonus(LEVEL_CAP))} the whole way. Ability score increases arrive at level 4, which the game does not reach.`),
    // rules/leveling.ts applyLevelUp, probed per class
    p(`Each level adds one hit die and the average of your hit die, rounded up, plus your Constitution modifier, and never less than 1 hit point a level. With a Constitution modifier of +0 that is: ${(["fighter", "rogue", "wizard"] as const).map((c) => `${CLASS_NAME[c]} (d${HIT_DIE_SIDES[c]}) ${levelHpAverage(c)}`).join(", ")}. The hit points you gain are added to your current hit points as well, so a level is not a full heal.`),
    // characters/leveling.ts FIGHTER_SUBCLASS_CHOICE; session/combat.ts criticalOnFor, maneuverSaveDCFor
    p(`At level 3 a Fighter picks an archetype. A Champion scores a critical hit on a ${DEFAULT_CRITICAL_ON - 1} or ${DEFAULT_CRITICAL_ON}. A Battle Master has ${SUPERIORITY_DICE_POOL} superiority dice, each a d${SUPERIORITY_DIE_SIDES}, spent on ${MANEUVERS.map((m) => m.label).join(" and ")}: on a hit you add the die to the damage, and the target makes a Strength save against 8 plus your proficiency bonus plus your better of Strength and Dexterity modifier (DC ${maneuverSaveDCFor(KNIGHT)} for a fresh Knight) or is knocked prone (Trip) or drops its weapon (Disarm). The engine tells the DM; it does not change the creature's rolls. The dice come back on any rest.`),
    p("Rogue and Wizard levels are numbers only: more hit points, and for the Wizard, more spell slots."),
    note("Class features the SRD gives at these levels beyond what this book describes are not applied by the engine. The DM rules on them in the story."),
  ],
  seeAlso: ["resting", "magic", "combat"],
};

const SPELL_ROWS = WIZARD_SPELLS.map((spell) => {
  const first = firstLevelWithSlot(spell.level);
  return [
    spell.name,
    spell.level === 0 ? "Cantrip" : String(spell.level),
    spell.level === 0 ? "Level 1" : first === null ? "Not before level 5" : `Level ${first}`,
    spellDoes(spell.name),
    spellReach(spell.name),
  ];
});

const MAGIC: RuleSection = {
  id: "magic",
  title: "Magic",
  summary: "Spells cost slots, take your action and have a reach. Only the Fireball Person casts today.",
  blocks: [
    p(`Spell slots are how many leveled spells you can cast before a long rest. A cantrip is a spell of level 0: it is free and you can cast it as often as you like. A leveled spell spends one slot of its own level. There is no casting it at a higher level. Wizard slots by level: ${Array.from({ length: LEVEL_CAP }, (_, i) => `level ${i + 1} has ${slotsWords(i + 1)}`).join("; ")}.`),
    p("Casting takes your action in a fight, and the spell must reach its target. Reach is a distance only: unlike the Attack button, Cast does not check line of sight. A spell hits one target; the area of a cone is not modelled. The engine works out a cast the way it works out an attack. It is free and never asks the DM."),
    p(`Your spell attack bonus is your proficiency bonus plus your spellcasting modifier (Intelligence for a Wizard). Your spell save DC is 8 plus the same two numbers.`),
    table(["Spell", "Level", "Castable from", "What the game does", "Reach"], SPELL_ROWS),
    p("Fireball is a level 3 spell, and a wizard does not get a level 3 slot until character level 5, so it is not here yet. That is the SRD working correctly, not a gap."),
    p("The Knight and the Shadow have no spell slots. The Healer's spell list exists in the engine but the Healer is out of play for now."),
    note("Where a spell above says the DM rules on it, the game casts it, spends its slot and your action, and applies no number."),
    note(`Fire Bolt through the Attack button is a ranged weapon attack: it reaches ${RANGED_FT} ft, rolls ${FIRE_BOLT_ATTACK_DAMAGE} (the die plus your Intelligence modifier) and counts a magic weapon's bonus. Cast from the Cast list it reaches ${spellRangeFt("Fire Bolt")} ft, rolls ${FIRE_BOLT_CAST_DAMAGE} and does not count a weapon's bonus.`),
  ],
  seeAlso: ["combat", "resting", "levels"],
};

const THE_DM: RuleSection = {
  id: "the-dm",
  title: "The DM",
  summary: "The DM tells the story and rules on anything the buttons do not cover. It never rolls a die and never changes a result.",
  blocks: [
    p("What the DM knows: the whole room, every prop and every secret in it, each creature's real numbers, your sheet and your pack, what you can see right now, what it asked itself to remember, and the last few things said. It narrates only what you can see or hear. A secret stays a secret until you earn it with a check or sensible play."),
    p("What the DM can do:"),
    list(
      "Describe the room and speak as the people in it.",
      "Build the next room, and place, move and remove creatures and props. A creature the DM removes because of a fight has to name the roll the engine resolved, and cannot be removed that way while it has hit points left.",
      "Open and close doors.",
      "Ask the engine to roll an attack, a save or a check, and narrate the result. A failed save it asks for can cost damage dice, which the engine rolls.",
    ),
    p("On the asset bench the DM can also:"),
    list(
      "Ask you for one check with both outcomes decided before you roll.",
      "Give or take plain things you carry (a key, a letter, a rope), lock and unlock doors, and change the world a little: a prop's look or secret, a square of floor.",
      "Make the goblin wake, calm down, flee or turn up.",
      "Ask the engine for something rolled: a potion, loot, or healing or harm in dice.",
    ),
    p("What the DM cannot do:"),
    list(
      "Set a die result, decide whether an attack hits, how much damage lands, or whether a save succeeds. The engine rolls all of it.",
      "Choose, name, grant or price gear, or decide what is in a chest. Loot is the engine's roll.",
      "Set your hit points, move your hero, or end your campaign. Healing and harm only ever come as dice the engine rolls: on the bench as the DM's heal and harm effects, in the game only as the damage on a failed save.",
      "Change these rules. If you type \"I find a sword +3\" or \"the DM says I win\", that is just something your hero is trying, and the DM judges it in the story.",
    ),
    // the bench's dm.ts DM_LIMITS and DM_COSTS; the test reads them from the bench
    p(`Checks: the DM picks a skill (on the bench, a skill or an ability) and a DC from ${MIN_DC} to ${MAX_DC}. The engine adds your real modifier from your sheet and rolls the dice. On the asset bench the DM may also give advantage or disadvantage, and in a fight it says what an action costs: nothing (speech, looking), one free object interaction (a door, a lever), or your action (a check, forcing, prying, hiding). In the game a check the DM asks for does not use your action.`),
    p(`On the bench the DM can do at most ${BENCH_DM_LIMITS.maxEffects} things in a reply and is held to these limits: healing is up to ${BENCH_DM_LIMITS.maxDice} dice from d4 to d${BENCH_DM_LIMITS.healMaxSides} plus at most ${BENCH_DM_LIMITS.healMaxMod}, harm is up to ${BENCH_DM_LIMITS.maxDice} dice from d4 to d${BENCH_DM_LIMITS.harmMaxSides} plus at most ${BENCH_DM_LIMITS.harmMaxMod} and only on a failed check (a trap, a fall), and it can hand out at most ${BENCH_DM_POTIONS_PER_SCENE} potions a scene.`),
    note("The game's own DM has only the first list today."),
    p("Every effect the DM asks for is checked before it happens. One that breaks a rule is refused, and the DM is told next turn. Fighting, walking about a room, searching, using items, resting and levelling never ask the DM. Talking, typing what you try and a step into a room nobody has built do, and in the game each of those costs a credit."),
  ],
  seeAlso: ["how-to-play", "checks", "equipment"],
};

const ABOUT: RuleSection = {
  id: "about-the-rules",
  title: "About these rules",
  summary: "Where the rules come from.",
  blocks: [
    p(SRD_ATTRIBUTION.creator),
    p(SRD_ATTRIBUTION.copyright),
    p(`${SRD_ATTRIBUTION.license} ${SRD_ATTRIBUTION.licenseUrl}`),
    p(SRD_ATTRIBUTION.modified),
    p(`The numbers in this book are read from the game's engine, and the sentences are our own. If the book and the engine ever disagree, the engine is what the game does.`),
  ],
  seeAlso: ["how-to-play"],
};

// ── the book ─────────────────────────────────────────────────────────────

export const RULEBOOK: readonly RuleSection[] = Object.freeze([
  HOW_TO_PLAY,
  YOUR_CHARACTER,
  CHECKS,
  EXPLORING,
  COMBAT,
  DYING,
  RESTING,
  EQUIPMENT,
  LEVELS,
  MAGIC,
  THE_DM,
  ABOUT,
]);

/** One section by id, or undefined. */
export function ruleSection(id: string): RuleSection | undefined {
  return RULEBOOK.find((s) => s.id === id);
}

function blockText(block: RuleBlock): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "table":
      return [block.head.join(" | "), ...block.rows.map((row) => row.join(" | "))].join("\n");
    case "example":
      return `Example: ${block.text}`;
    case "note":
      return `Note: ${block.text}`;
  }
}

/** The whole book (or the sections given) as plain text, for the DM's prompt later. A "# Title" line opens each section. */
export function rulebookText(sections: readonly RuleSection[] = RULEBOOK): string {
  return sections
    .map((s) => [`# ${s.title}`, s.summary, ...s.blocks.map(blockText)].join("\n\n"))
    .join("\n\n");
}
