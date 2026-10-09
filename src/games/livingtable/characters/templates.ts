/**
 * The eight launch archetypes: four fantasy, four sci-fi, sharing one of four
 * mechanical chassis two at a time (DESIGN.md, "Characters"). Reskinned, not
 * duplicated -- same hit die, same saving-throw proficiencies, same class
 * math from rules/leveling.ts -- but each archetype still gets its own
 * ability-score allocation, skill list, and gear, because two real 5e
 * characters of the same class are never numerically identical either: a
 * melee-first Knight and a ranged-first Trooper both play "Fighter," but they
 * don't roll the same character sheet.
 */
import type { AbilityScores } from "../rules";
import { HIT_DIE_SIDES, type CharacterClass } from "../rules";

export type TemplateGenre = "fantasy" | "scifi";

/** Re-exported under the characters/ module's own name so callers here don't reach into rules/leveling.ts just for this. */
export type Chassis = CharacterClass;

export interface ArchetypeProficiencies {
  /** SRD skill names this archetype starts trained in. */
  skills: string[];
  /** The two ability saves this chassis is proficient in, per SRD 5.1's class table. */
  saves: (keyof AbilityScores)[];
}

/**
 * A thing in the pack that actually does something when the player presses
 * Item, as structured data rather than a name the engine has to guess about.
 *
 * This field exists because of a real, reproducible failure: the Item verb
 * decided what an item did by matching substrings against its NAME
 * ("kit", "potion", "poultice", "salve"), so a Holo-disguise kit restored hit
 * points while a Longsword, a Shield and an Explorer's pack all printed "the
 * <item> doesn't do anything on its own", and five of the eight archetypes
 * carried nothing the check could match at all. One of the five command-menu
 * verbs was therefore guaranteed to fail for the entire Fantasy template, and
 * the failure message advised using a potion that could not exist in the
 * player's game. Naming what heals, per item, on the archetype that grants it,
 * is the fix; guessing from a name never was.
 */
export interface Consumable {
  name: string;
  /** How many are in the pack at creation. Item spends one per press and the button disappears at zero. */
  uses: number;
  /** What one does. Only "heal" exists at launch scope; the field is here so a second effect is data rather than a new branch. */
  effect: "heal";
  /** One sentence, for the button's own hover/tap explanation. */
  description: string;
}

/** SRD 5.1's Potion of Healing (2d4+2), reskinned per genre. Two per pack, which is enough to survive a bad first fight without making the fight meaningless. */
const HEALING_DRAUGHT: Consumable = {
  name: "Potion of healing",
  uses: 2,
  effect: "heal",
  description: "Drink it and some of the damage stops mattering: 2d4+2 hit points back.",
};

const MEDFOAM: Consumable = {
  name: "Medfoam injector",
  uses: 2,
  effect: "heal",
  description: "Punch it against your leg and the wound seals: 2d4+2 hit points back.",
};

export interface Archetype {
  id: string;
  template: TemplateGenre;
  displayName: string;
  chassis: Chassis;
  /** A level-1 SRD standard-array (15/14/13/12/10/8) allocation, distinct per archetype even within a shared chassis. */
  baseAbilityScores: AbilityScores;
  startingHitDie: number;
  startingProficiencies: ArchetypeProficiencies;
  /** Plain item names, no mechanical stat block of their own yet -- see DESIGN.md's "Item" command menu entry. This is the flavour gear the character sheet lists, NOT what the Item verb spends; that's `startingConsumables`. */
  startingInventory: string[];
  /**
   * Which `startingInventory` entries the character sheet's LOADOUT already
   * names: the three drawn gear slots, and the armour the AC line names.
   *
   * This list exists because `startingInventory` predates the gear slots and
   * still names the same objects in its own words. A Knight's panel printed
   * "AC 16 (chain mail)", a gear row reading "Plate Harness", and then
   * "Carrying: Longsword, Shield, Chain mail, ..." -- one suit of armour under
   * three names, with only one of them the object the rarity ladder acts on.
   * The Carrying line is meant to be the pack; `packItems` in menu/equipment.ts
   * subtracts this list to make it one.
   *
   * Exact strings, never substrings: an item the player picks up mid-campaign
   * must never be filtered off the sheet by a loose match. It is data here
   * rather than a name-matching heuristic for the same reason `Consumable`
   * is: guessing what an item is from its name is a defect this game has
   * already shipped once.
   */
  loadoutInventory: string[];
  /** What the Item verb can actually spend. Every archetype has at least one, so no archetype can reach the table with a command-menu verb that is guaranteed to do nothing. */
  startingConsumables: Consumable[];
  /** One or two plain-language sentences: what playing this feels like, not jargon. */
  kitDescription: string;
  /**
   * Fighter chassis only: which of creation.ts's FIGHTING_STYLE_OPTIONS
   * ("defense" | "dueling" | "archery") this archetype's own startingInventory
   * can actually back up. Omit to allow all three (the safe default for a
   * kit that plausibly covers every style). Set explicitly when a kit can't
   * -- e.g. a fighter carrying no one-handed melee weapon at all has no gear
   * "Dueling" could ever apply to, so offering it would be a real-sounding
   * choice that's mechanically dead for that character. This is what keeps
   * the creation-time picker honest per archetype instead of per chassis.
   */
  fightingStyles?: string[];
}

/**
 * SRD 5.1 saving-throw proficiencies by class, fixed per chassis (this is a
 * class-table fact, not an archetype choice, so both reskins of one chassis
 * share it -- exactly the "same chassis" property the launch is meant to
 * prove holds).
 */
const SAVES_BY_CHASSIS: Record<Chassis, (keyof AbilityScores)[]> = {
  fighter: ["str", "con"],
  rogue: ["dex", "int"],
  cleric: ["wis", "cha"],
  wizard: ["int", "wis"],
};

/**
 * SRD 5.1's class skill lists: how many skills each class picks at level 1 and
 * the list it picks them from. A class-table fact, so it is keyed by chassis
 * like SAVES_BY_CHASSIS above (both reskins of one chassis share it).
 *
 * Every archetype's own starting skills in ARCHETYPES below are drawn from its
 * chassis's list, which a test pins, so "keep the archetype's skills" is always
 * a legal pick. The Rogue's count is 4 in the SRD while the three Rogue
 * archetypes ship with 3; creation fills the gap from this list.
 */
export const CLASS_SKILL_CHOICES: Readonly<Record<Chassis, { count: number; from: string[] }>> = Object.freeze({
  fighter: {
    count: 2,
    from: ["Acrobatics", "Animal Handling", "Athletics", "History", "Insight", "Intimidation", "Perception", "Survival"],
  },
  rogue: {
    count: 4,
    from: [
      "Acrobatics",
      "Athletics",
      "Deception",
      "Insight",
      "Intimidation",
      "Investigation",
      "Perception",
      "Performance",
      "Persuasion",
      "Sleight of Hand",
      "Stealth",
    ],
  },
  wizard: { count: 2, from: ["Arcana", "History", "Insight", "Investigation", "Medicine", "Religion"] },
  cleric: { count: 2, from: ["History", "Insight", "Medicine", "Persuasion", "Religion"] },
});

function proficiencies(skills: string[], chassis: Chassis): ArchetypeProficiencies {
  return { skills, saves: SAVES_BY_CHASSIS[chassis] };
}

export const ARCHETYPES: Archetype[] = [
  // ── Fighter chassis: wade in, take the hits, swing hard ────────────────
  {
    id: "knight",
    template: "fantasy",
    displayName: "The Knight",
    chassis: "fighter",
    // Melee-first build: STR to hit and damage, CON to soak hits.
    baseAbilityScores: { str: 15, con: 14, dex: 13, wis: 12, cha: 10, int: 8 },
    startingHitDie: HIT_DIE_SIDES.fighter,
    startingProficiencies: proficiencies(["Athletics", "Intimidation"], "fighter"),
    startingInventory: ["Longsword", "Shield", "Chain mail", "Handaxe x2", "Explorer's pack"],
    // Longsword is the weapon slot, Shield is the Kite Shield, Chain mail is
    // the Plate Harness the AC line now names.
    loadoutInventory: ["Longsword", "Shield", "Chain mail"],
    startingConsumables: [HEALING_DRAUGHT],
    kitDescription:
      "Wade in, take the hits, swing hard. The most hit points and the best armour in the game, so you are the one who can afford to be wrong about a fight.",
    // Longsword + shield backs Dueling directly, thrown handaxes back
    // Archery, chain mail backs Defense: this kit genuinely supports all three.
    fightingStyles: ["defense", "dueling", "archery"],
  },
  {
    id: "trooper",
    template: "scifi",
    displayName: "The Trooper",
    chassis: "fighter",
    // Same chassis, ranged-first build: DEX overtakes CON as the secondary stat.
    baseAbilityScores: { str: 14, dex: 15, con: 13, wis: 10, int: 12, cha: 8 },
    startingHitDie: HIT_DIE_SIDES.fighter,
    startingProficiencies: proficiencies(["Athletics", "Perception"], "fighter"),
    startingInventory: ["Plasma rifle", "Combat vest", "Frag grenade x2", "Field kit"],
    loadoutInventory: ["Plasma rifle", "Combat vest"],
    startingConsumables: [MEDFOAM],
    kitDescription:
      "Shoot it before it reaches you, and hold up when it does. Rifle range plus armour: the same toughness as the Knight, spent from further away.",
    // No one-handed melee weapon in this kit at all, so Dueling has nothing
    // to ever apply to; the plasma rifle backs Archery and the combat vest
    // backs Defense.
    fightingStyles: ["defense", "archery"],
  },

  // ── Rogue chassis: get in, get the thing, don't get seen ───────────────
  {
    id: "shadow",
    template: "fantasy",
    displayName: "The Rogue",
    chassis: "rogue",
    // Stealth-and-cunning build: DEX and INT lead, CHA is a distant third tool.
    baseAbilityScores: { dex: 15, int: 14, con: 13, wis: 12, cha: 10, str: 8 },
    startingHitDie: HIT_DIE_SIDES.rogue,
    startingProficiencies: proficiencies(["Stealth", "Sleight of Hand", "Deception"], "rogue"),
    startingInventory: ["Shortsword", "Shortbow, 20 arrows", "Thieves' tools", "Dark cloak", "Burglar's pack"],
    loadoutInventory: ["Shortsword", "Dark cloak"],
    startingConsumables: [HEALING_DRAUGHT],
    kitDescription:
      "Get in, get the thing, get out before anything knows you were there. You pick one skill to be genuinely exceptional at, and fights are what happen when the plan didn't.",
  },
  {
    id: "infiltrator",
    template: "scifi",
    displayName: "The Infiltrator",
    chassis: "rogue",
    // Same chassis, social-engineering build: CHA overtakes INT as the secondary stat.
    baseAbilityScores: { dex: 15, cha: 14, con: 13, int: 12, wis: 10, str: 8 },
    startingHitDie: HIT_DIE_SIDES.rogue,
    startingProficiencies: proficiencies(["Stealth", "Deception", "Investigation"], "rogue"),
    startingInventory: ["Sidearm (suppressed)", "Hacking rig", "Holo-disguise kit", "Grapnel line"],
    loadoutInventory: ["Sidearm (suppressed)"],
    startingConsumables: [MEDFOAM],
    kitDescription:
      "Talk your way past the guard you didn't need to fight. You pick one skill to be genuinely exceptional at, and you are most dangerous in the thirty seconds nothing has noticed you yet.",
  },

  // ── Cleric chassis: keep the party standing ─────────────────────────────
  {
    id: "healer",
    template: "fantasy",
    displayName: "The Healer",
    chassis: "cleric",
    // Faith-and-frontline build: WIS to cast, STR to stand in the fight while doing it.
    baseAbilityScores: { wis: 15, con: 14, str: 13, cha: 12, dex: 10, int: 8 },
    startingHitDie: HIT_DIE_SIDES.cleric,
    startingProficiencies: proficiencies(["Medicine", "Religion"], "cleric"),
    startingInventory: ["Mace", "Scale mail", "Shield", "Holy symbol", "Priest's pack"],
    // The scale mail and the shield are the armour the AC line names ("chain
    // shirt and shield" is the chassis figure both of them add up to), and the
    // Vestments are drawn in the gear row above.
    loadoutInventory: ["Mace", "Scale mail", "Shield"],
    // The Healer carries the field kit as well as the draught: three uses, because
    // patching people up is the whole reason this archetype exists.
    startingConsumables: [HEALING_DRAUGHT, { name: "Healer's kit", uses: 3, effect: "heal", description: "Bandages, a needle and a steady hand: 2d4+2 hit points back." }],
    kitDescription:
      "The hardest character here to actually put down: five uses of healing in your pack, more than double what any other archetype starts with, plus a mace and a shield for when they run out.",
  },
  {
    id: "medic",
    template: "scifi",
    displayName: "The Medic",
    chassis: "cleric",
    // Same chassis, precision-and-tech build: DEX overtakes STR as the secondary stat.
    baseAbilityScores: { wis: 15, dex: 14, con: 13, int: 12, cha: 10, str: 8 },
    startingHitDie: HIT_DIE_SIDES.cleric,
    startingProficiencies: proficiencies(["Medicine", "Insight"], "cleric"),
    startingInventory: ["Stun baton", "Ceramic-plate vest", "Trauma kit", "Diagnostic scanner"],
    loadoutInventory: ["Stun baton", "Ceramic-plate vest"],
    startingConsumables: [MEDFOAM, { name: "Trauma kit", uses: 3, effect: "heal", description: "Clamps, sealant and a steady hand: 2d4+2 hit points back." }],
    kitDescription:
      "You do not stay down. Five uses of field medicine in your kit, more than double what any other archetype starts with, and you read a wound or a lie with the same look.",
  },

  // ── Wizard chassis: reshape the fight before it's fair ──────────────────
  {
    id: "fireball-person",
    template: "fantasy",
    displayName: "The Mage",
    chassis: "wizard",
    // Classic glass-cannon build: INT to cast, CON to survive being the priority target.
    baseAbilityScores: { int: 15, con: 14, dex: 13, wis: 12, cha: 10, str: 8 },
    startingHitDie: HIT_DIE_SIDES.wizard,
    startingProficiencies: proficiencies(["Arcana", "Investigation"], "wizard"),
    startingInventory: ["Quarterstaff", "Spellbook", "Component pouch", "Scholar's pack"],
    loadoutInventory: ["Quarterstaff"],
    startingConsumables: [HEALING_DRAUGHT],
    kitDescription:
      "You end a fight early or you lose it. The hardest-hitting attack in the game and the fewest hit points to survive being wrong, so pick your ground and make the first one count.",
  },
  {
    id: "psion",
    template: "scifi",
    displayName: "The Psion",
    chassis: "wizard",
    // Same chassis, resilience-of-mind build: WIS overtakes CON as the secondary stat.
    baseAbilityScores: { int: 15, wis: 14, con: 13, dex: 12, cha: 10, str: 8 },
    startingHitDie: HIT_DIE_SIDES.wizard,
    startingProficiencies: proficiencies(["Arcana", "Insight"], "wizard"),
    startingInventory: ["Neural focus", "Light shield generator", "Data slate", "Ration pack"],
    loadoutInventory: ["Neural focus", "Light shield generator"],
    startingConsumables: [MEDFOAM],
    kitDescription:
      "You never want anything within arm's reach, and you have the range not to need it. The hardest-hitting attack in the game and the fewest hit points behind it.",
  },
];

/**
 * What a player can start today, a subset of everything defined above.
 *
 * Owner decision, 2026-09-30: the game's art is moving to Kay Lousberg's free
 * KayKit packs (CC0), which have a knight, a rogue and a mage but no cleric and
 * no sci-fi characters. So the sci-fi template is PAUSED and the Healer is OUT
 * OF PLAY. Both stay defined (rules, gear tables, sprites, tests) and simply
 * cannot be picked: un-pausing is an edit to these two lists, and a stored
 * sheet or campaign that names one still loads.
 */
export const PLAYABLE_TEMPLATES: readonly TemplateGenre[] = Object.freeze(["fantasy"] as const);
export const PLAYABLE_ARCHETYPE_IDS: readonly string[] = Object.freeze(["knight", "shadow", "fireball-person"]);

/** The archetypes a player may pick for a campaign in `template`, in ARCHETYPES order. */
export function playableArchetypes(template: TemplateGenre): Archetype[] {
  if (!PLAYABLE_TEMPLATES.includes(template)) return [];
  return ARCHETYPES.filter((a) => a.template === template && PLAYABLE_ARCHETYPE_IDS.includes(a.id));
}

export function getArchetype(archetypeId: string): Archetype {
  const found = ARCHETYPES.find((a) => a.id === archetypeId);
  if (!found) throw new Error(`unknown archetype id "${archetypeId}"`);
  return found;
}

/**
 * What the loadout already names for this archetype, or nothing at all for an
 * archetype this table has never heard of.
 *
 * Deliberately does NOT throw the way `getArchetype` does: this is read while
 * drawing a character sheet, and an unknown archetype must degrade to showing
 * the whole inventory (every item once, nothing hidden) rather than to a blank
 * panel. Hiding is the risky direction, so the unknown case hides nothing.
 */
export function loadoutInventoryFor(archetypeId: string): readonly string[] {
  return ARCHETYPES.find((a) => a.id === archetypeId)?.loadoutInventory ?? [];
}
