/**
 * The Bestiary: the generic fantasy staples, with their SRD 5.1 numbers.
 *
 * Reference data for the bench's Bestiary tab (and, later, the DM). About
 * forty creatures from CR 0 to CR 8, all from the System Reference Document
 * 5.1 (CC BY 4.0, see NOTICE.md and SRD_ATTRIBUTION in menu/labels.ts). The
 * numbers are the SRD's; the description, habitat and tactics lines are our
 * own words. No beholders, mind flayers or other non-SRD named content, and
 * legendary actions are left out on purpose.
 *
 * HONESTY (the game's own rule, equipmentTypes.ts rule 7): the game engine
 * applies only the combat numbers it reads from `MONSTER_STATBLOCKS` in
 * session/combat.ts (AC, max HP, to-hit, damage, six ability modifiers), and
 * only for the creatures that have a token. Every trait, special action and
 * reaction written here is SRD reference text: "The DM rules on this". The
 * goblin and skeleton entries carry `tokenAssetId` and are pinned to
 * MONSTER_STATBLOCKS by test/livingtable-bestiary.test.ts.
 *
 * No sprites or animation yet; that comes later.
 */
import { abilityModifier } from "./abilities";
import type { AbilityScores } from "./abilities";

export type CreatureSize = "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan";

export interface BeastAttack {
  name: string;
  kind: "melee" | "ranged" | "melee or ranged";
  /** The attack roll bonus, SRD "+N to hit". */
  toHit: number;
  reachFt?: number;
  /** [normal, long] range in feet, for a ranged or thrown attack. */
  rangeFt?: [number, number];
  target: string;
  /** One entry per damage type; `average` is the SRD's rounded-down average of `dice`. */
  damage: { dice: string; average: number; type: string }[];
  extra?: string;
}

export interface BeastFeature {
  name: string;
  text: string;
}

export interface Beast {
  id: string;
  name: string;
  size: CreatureSize;
  /** SRD creature type, with any subtype in parentheses, e.g. "humanoid (goblinoid)". */
  type: string;
  alignment: string;
  ac: number;
  acNote?: string;
  /** SRD "Hit Points": the average, which is the floor of the average of `hpDice`. */
  hp: number;
  hpDice: string;
  /** Feet per round. */
  speed: { walk: number; fly?: number; swim?: number; climb?: number; burrow?: number; hover?: boolean };
  scores: AbilityScores;
  saves?: Partial<Record<keyof AbilityScores, number>>;
  skills?: Record<string, number>;
  vulnerabilities?: string[];
  resistances?: string[];
  immunities?: string[];
  conditionImmunities?: string[];
  senses: string;
  passivePerception: number;
  languages: string;
  /** "0", "1/8", "1/4", "1/2", "1", "2", ... */
  cr: string;
  xp: number;
  traits: BeastFeature[];
  multiattack?: string;
  attacks: BeastAttack[];
  specials?: BeastFeature[];
  reactions?: BeastFeature[];
  /** Two or three sentences, our own words. */
  description: string;
  /** One line: where you find it. */
  habitat: string;
  /** One line telling a DM how it fights. */
  tactics: string;
  tags: string[];
  /** The manifest token that stands for this creature, when there is one. */
  tokenAssetId?: string;
}

/** SRD 5.1: floor((score - 10) / 2). The same derivation the rest of the rules use. */
export function abilityMod(score: number): number {
  return abilityModifier(score);
}

/** SRD 5.1 experience points by challenge rating, CR 0 to CR 30. */
export const XP_BY_CR: Readonly<Record<string, number>> = {
  "0": 10,
  "1/8": 25,
  "1/4": 50,
  "1/2": 100,
  "1": 200,
  "2": 450,
  "3": 700,
  "4": 1100,
  "5": 1800,
  "6": 2300,
  "7": 2900,
  "8": 3900,
  "9": 5000,
  "10": 5900,
  "11": 7200,
  "12": 8400,
  "13": 10000,
  "14": 11500,
  "15": 13000,
  "16": 15000,
  "17": 18000,
  "18": 20000,
  "19": 22000,
  "20": 25000,
  "21": 33000,
  "22": 41000,
  "23": 50000,
  "24": 62000,
  "25": 75000,
  "26": 90000,
  "27": 105000,
  "28": 120000,
  "29": 135000,
  "30": 155000,
};

/** Challenge ratings in ascending order, the key order for sorting. */
export const CR_ORDER: readonly string[] = [
  "0", "1/8", "1/4", "1/2",
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
];

// ── authoring helpers (module private) ─────────────────────────────────

/** Rounded-down average of "NdS", "NdS+M", "NdS-M" or a flat "N". */
function averageOf(dice: string): number {
  const flat = /^(\d+)$/.exec(dice);
  if (flat) return Number(flat[1]);
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(dice);
  if (!m) throw new Error(`bad dice notation: ${dice}`);
  const n = Number(m[1]);
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3]) : 0;
  return Math.floor((n * (sides + 1)) / 2 + mod);
}

function dmg(dice: string, type: string): { dice: string; average: number; type: string } {
  return { dice, average: averageOf(dice), type };
}

function scores(str: number, dex: number, con: number, int: number, wis: number, cha: number): AbilityScores {
  return { str, dex, con, int, wis, cha };
}

function melee(
  name: string,
  toHit: number,
  damage: { dice: string; average: number; type: string }[],
  extra?: string,
  reachFt = 5,
  target = "one target",
): BeastAttack {
  const a: BeastAttack = { name, kind: "melee", toHit, reachFt, target, damage };
  if (extra) a.extra = extra;
  return a;
}

function ranged(
  name: string,
  toHit: number,
  rangeFt: [number, number],
  damage: { dice: string; average: number; type: string }[],
  extra?: string,
  target = "one target",
): BeastAttack {
  const a: BeastAttack = { name, kind: "ranged", toHit, rangeFt, target, damage };
  if (extra) a.extra = extra;
  return a;
}

function thrown(
  name: string,
  toHit: number,
  rangeFt: [number, number],
  damage: { dice: string; average: number; type: string }[],
  extra?: string,
  target = "one target",
): BeastAttack {
  const a: BeastAttack = { name, kind: "melee or ranged", toHit, reachFt: 5, rangeFt, target, damage };
  if (extra) a.extra = extra;
  return a;
}

const SPECTRAL_IMMUNITIES = [
  "charmed", "exhaustion", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained", "unconscious",
];

// ── the creatures ──────────────────────────────────────────────────────

const RAW: Beast[] = [
  // ── CR 0 ──
  {
    id: "rat", name: "Rat", size: "Tiny", type: "beast", alignment: "unaligned",
    ac: 10, hp: 1, hpDice: "1d4-1", speed: { walk: 20 },
    scores: scores(2, 11, 9, 2, 10, 4),
    senses: "darkvision 30 ft.", passivePerception: 10, languages: "None", cr: "0", xp: 10,
    traits: [{ name: "Keen Smell", text: "Advantage on Wisdom (Perception) checks that rely on smell." }],
    attacks: [melee("Bite", 0, [dmg("1", "piercing")], undefined, 5, "one target")],
    description: "A scrawny, quick scavenger that lives wherever people leave scraps. Alone it is a nuisance; a hungry swarm in a cellar is a bigger worry for the unwary.",
    habitat: "Cellars, sewers, granaries, ruined keeps and any larder.",
    tactics: "Runs from a fight at the first sign of trouble. It bites only when cornered, and one hit from anything usually ends it.",
    tags: ["beast", "vermin", "dungeon", "city"],
  },

  // ── CR 1/8 ──
  {
    id: "giant-rat", name: "Giant Rat", size: "Small", type: "beast", alignment: "unaligned",
    ac: 12, hp: 7, hpDice: "2d6", speed: { walk: 30 },
    scores: scores(7, 15, 11, 2, 10, 4),
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "None", cr: "1/8", xp: 25,
    traits: [
      { name: "Keen Smell", text: "Advantage on Wisdom (Perception) checks that rely on smell." },
      { name: "Pack Tactics", text: "Advantage on an attack roll against a creature if at least one of the rat's allies is within 5 ft. of that creature and the ally is not incapacitated." },
    ],
    attacks: [melee("Bite", 4, [dmg("1d4+2", "piercing")])],
    description: "A rat the size of a hound, bold from a lifetime of eating whatever it likes. They swarm sewers and crypts and are rarely found alone.",
    habitat: "Sewers, flooded cellars, tombs and the lower levels of old ruins.",
    tactics: "Comes in numbers and piles onto one target so Pack Tactics gives each bite advantage. A few are easy; a dozen is a real fight.",
    tags: ["beast", "vermin", "dungeon", "city"],
  },
  {
    id: "kobold", name: "Kobold", size: "Small", type: "humanoid (kobold)", alignment: "lawful evil",
    ac: 12, hp: 5, hpDice: "2d6-2", speed: { walk: 30 },
    scores: scores(7, 15, 9, 8, 7, 8),
    senses: "darkvision 60 ft.", passivePerception: 8, languages: "Common, Draconic", cr: "1/8", xp: 25,
    traits: [
      { name: "Sunlight Sensitivity", text: "While in sunlight, the kobold has disadvantage on attack rolls, and on Wisdom (Perception) checks that rely on sight." },
      { name: "Pack Tactics", text: "Advantage on an attack roll against a creature if at least one of the kobold's allies is within 5 ft. of that creature and the ally is not incapacitated." },
    ],
    attacks: [
      melee("Dagger", 4, [dmg("1d4+2", "piercing")]),
      ranged("Sling", 4, [30, 120], [dmg("1d4+2", "bludgeoning")]),
    ],
    description: "A small, scaly, cowardly scavenger that worships dragons and makes up for its fragility with traps and numbers. Kobolds hate fair fights and love ambushes.",
    habitat: "Warrens under hills and ruins, often the lair of a larger boss.",
    tactics: "Lures the party into traps and pit-falls, then swarms one target. Breaks and flees when the group thins out.",
    tags: ["humanoid", "kobold", "dungeon"],
  },
  {
    id: "bandit", name: "Bandit", size: "Medium", type: "humanoid (any race)", alignment: "any non-lawful alignment",
    ac: 12, acNote: "leather armor", hp: 11, hpDice: "2d8+2", speed: { walk: 30 },
    scores: scores(11, 12, 12, 10, 10, 10),
    senses: "none special", passivePerception: 10, languages: "any one language (usually Common)", cr: "1/8", xp: 25,
    traits: [],
    attacks: [
      melee("Scimitar", 3, [dmg("1d6+1", "slashing")]),
      ranged("Light Crossbow", 3, [80, 320], [dmg("1d8+1", "piercing")]),
    ],
    description: "A highway robber or camp raider who would rather take your purse than risk a real fight. Bandits work in gangs under a bolder leader.",
    habitat: "Roads, forest trails, border hills and abandoned farms.",
    tactics: "Fires crossbows from cover to scare a victim into surrendering the goods, and runs if the odds turn.",
    tags: ["humanoid", "road", "forest"],
  },
  {
    id: "cultist", name: "Cultist", size: "Medium", type: "humanoid (any race)", alignment: "any non-good alignment",
    ac: 12, acNote: "leather armor", hp: 9, hpDice: "2d8", speed: { walk: 30 },
    scores: scores(11, 12, 10, 10, 11, 10),
    skills: { Deception: 2, Religion: 2 },
    senses: "none special", passivePerception: 10, languages: "any one language (usually Common)", cr: "1/8", xp: 25,
    traits: [{ name: "Dark Devotion", text: "Advantage on saving throws against being charmed or frightened." }],
    attacks: [melee("Scimitar", 3, [dmg("1d6+1", "slashing")], undefined, 5, "one creature")],
    description: "A devoted follower of some dark power, hooded and murmuring. Cultists do the dirty work of a hidden master and fight with a zeal that makes up for their lack of skill.",
    habitat: "Hidden shrines, cellars beneath respectable houses and remote ritual sites.",
    tactics: "Holds a doorway or stairwell while a leader finishes a ritual. Has advantage on saves against being charmed or frightened, so those spells are a poor choice against it.",
    tags: ["humanoid", "cult", "dungeon"],
  },
  {
    id: "stirge", name: "Stirge", size: "Tiny", type: "beast", alignment: "unaligned",
    ac: 14, acNote: "natural armor", hp: 2, hpDice: "1d4", speed: { walk: 10, fly: 40 },
    scores: scores(4, 16, 11, 2, 8, 6),
    senses: "darkvision 60 ft.", passivePerception: 9, languages: "None", cr: "1/8", xp: 25,
    traits: [],
    attacks: [melee("Blood Drain", 5, [dmg("1d4+3", "piercing")], "The stirge attaches to the target. While attached it does not attack; instead, at the start of each of its turns the target loses 5 (1d4 + 3) hit points to blood loss. It detaches itself (spending 5 ft. of movement) after draining 10 hit points or when the target dies. Any creature, including the target, can use an action to detach it.", 5, "one creature")],
    description: "A bat-winged, mosquito-snouted horror the size of a cat that seeks warm blood. It hits fast, latches on, and drinks until it is bloated or dead.",
    habitat: "Caves, swamps and dark ruins, roosting in clusters.",
    tactics: "Swoops at the lightest-armoured target and sticks. Dies to a single good hit, so a flurry of them is more dangerous than any one.",
    tags: ["beast", "swamp", "dungeon"],
  },

  // ── CR 1/4 ──
  {
    id: "goblin", name: "Goblin", size: "Small", type: "humanoid (goblinoid)", alignment: "neutral evil",
    ac: 15, acNote: "leather armor, shield", hp: 7, hpDice: "2d6", speed: { walk: 30 },
    scores: scores(8, 14, 10, 10, 8, 8),
    skills: { Stealth: 6 },
    senses: "darkvision 60 ft.", passivePerception: 9, languages: "Common, Goblin", cr: "1/4", xp: 50,
    traits: [{ name: "Nimble Escape", text: "The goblin can take the Disengage or Hide action as a bonus action on each of its turns." }],
    attacks: [
      melee("Scimitar", 4, [dmg("1d6+2", "slashing")]),
      ranged("Shortbow", 4, [80, 320], [dmg("1d6+2", "piercing")]),
    ],
    description: "A small, sharp-eared, mean-spirited raider that runs in packs and survives by striking first and leaving fast. Goblins love loot, hate being hurt, and follow whoever is strongest.",
    habitat: "Caves, ruined forts, forest camps and the shadows beside trade roads.",
    tactics: "Skirmishes with bows and ambushes, then uses Nimble Escape to slip out of reach. Flees when the leader falls.",
    tags: ["humanoid", "goblinoid", "dungeon", "forest"],
    tokenAssetId: "token_goblin",
  },
  {
    id: "skeleton", name: "Skeleton", size: "Medium", type: "undead", alignment: "lawful evil",
    ac: 13, acNote: "armor scraps", hp: 13, hpDice: "2d8+4", speed: { walk: 30 },
    scores: scores(10, 14, 15, 6, 8, 5),
    vulnerabilities: ["bludgeoning"], immunities: ["poison"], conditionImmunities: ["exhaustion", "poisoned"],
    senses: "darkvision 60 ft.", passivePerception: 9, languages: "understands the languages it knew in life but cannot speak", cr: "1/4", xp: 50,
    traits: [],
    attacks: [
      melee("Shortsword", 4, [dmg("1d6+2", "piercing")]),
      ranged("Shortbow", 4, [80, 320], [dmg("1d6+2", "piercing")]),
    ],
    description: "The animated bones of a long-dead warrior, still carrying its rusted gear and still obeying the last order it was given. It does not tire, speak or bargain.",
    habitat: "Crypts, battlefields, graveyards and the halls of a necromancer.",
    tactics: "Marches straight at the nearest living target and keeps hacking until destroyed. It is vulnerable to bludgeoning, so a mace or hammer deals double damage.",
    tags: ["undead", "dungeon", "graveyard"],
    tokenAssetId: "token_skeleton",
  },
  {
    id: "zombie", name: "Zombie", size: "Medium", type: "undead", alignment: "neutral evil",
    ac: 8, hp: 22, hpDice: "3d8+9", speed: { walk: 20 },
    scores: scores(13, 6, 16, 3, 6, 5),
    saves: { wis: 0 }, immunities: ["poison"], conditionImmunities: ["poisoned"],
    senses: "darkvision 60 ft.", passivePerception: 8, languages: "understands the languages it knew in life but cannot speak", cr: "1/4", xp: 50,
    traits: [{ name: "Undead Fortitude", text: "If damage reduces the zombie to 0 hit points, it makes a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, it drops to 1 hit point instead." }],
    attacks: [melee("Slam", 3, [dmg("1d6+1", "bludgeoning")])],
    description: "A shambling corpse driven by a dark will, slow and stubborn and not very bright. It keeps coming long after a living creature would have fallen.",
    habitat: "Graveyards, plague pits, necromancers' lairs and drowned ruins.",
    tactics: "Lurches toward the nearest living target in a straight line. Hard to put down for good, so finish it with radiant damage or a critical hit.",
    tags: ["undead", "dungeon", "graveyard"],
  },
  {
    id: "wolf", name: "Wolf", size: "Medium", type: "beast", alignment: "unaligned",
    ac: 13, acNote: "natural armor", hp: 11, hpDice: "2d8+2", speed: { walk: 40 },
    scores: scores(12, 15, 12, 3, 12, 6),
    skills: { Perception: 3, Stealth: 4 },
    senses: "none special", passivePerception: 13, languages: "None", cr: "1/4", xp: 50,
    traits: [
      { name: "Keen Hearing and Smell", text: "Advantage on Wisdom (Perception) checks that rely on hearing or smell." },
      { name: "Pack Tactics", text: "Advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 ft. of that creature and the ally is not incapacitated." },
    ],
    attacks: [melee("Bite", 4, [dmg("2d4+2", "piercing")], "If the target is a creature, it must succeed on a DC 11 Strength saving throw or be knocked prone.")],
    description: "A lean grey hunter that runs down prey in coordinated packs. Wolves seldom attack a healthy group unless they are starving, but a wounded straggler is another matter.",
    habitat: "Forests, hills, tundra and open plains.",
    tactics: "Circles a target and bites to knock it prone so its packmates gain advantage. Retreats if half the pack falls.",
    tags: ["beast", "forest", "hills"],
  },
  {
    id: "giant-bat", name: "Giant Bat", size: "Large", type: "beast", alignment: "unaligned",
    ac: 13, hp: 22, hpDice: "4d10", speed: { walk: 10, fly: 60 },
    scores: scores(15, 16, 11, 2, 12, 6),
    senses: "blindsight 60 ft.", passivePerception: 11, languages: "None", cr: "1/4", xp: 50,
    traits: [
      { name: "Echolocation", text: "The bat cannot use its blindsight while deafened." },
      { name: "Keen Hearing", text: "Advantage on Wisdom (Perception) checks that rely on hearing." },
    ],
    attacks: [melee("Bite", 4, [dmg("1d6+2", "piercing")], undefined, 5, "one creature")],
    description: "A bat with a wingspan wider than a man is tall, hunting by sound in total darkness. It darts in to bite and out again.",
    habitat: "Deep caves, abandoned mines and dark towers, roosting in colonies.",
    tactics: "Dives from the dark and bites. Its blindsight works in total darkness, but anything that deafens it (a thunder spell, say) shuts that sense off.",
    tags: ["beast", "cave", "dungeon"],
  },

  // ── CR 1/2 ──
  {
    id: "orc", name: "Orc", size: "Medium", type: "humanoid (orc)", alignment: "chaotic evil",
    ac: 13, acNote: "hide armor", hp: 15, hpDice: "2d8+6", speed: { walk: 30 },
    scores: scores(16, 12, 16, 7, 11, 10),
    skills: { Intimidation: 2 },
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "Common, Orc", cr: "1/2", xp: 100,
    traits: [{ name: "Aggressive", text: "As a bonus action, the orc can move up to its speed toward a hostile creature that it can see." }],
    attacks: [
      melee("Greataxe", 5, [dmg("1d12+3", "slashing")]),
      thrown("Javelin", 5, [30, 120], [dmg("1d6+3", "piercing")]),
    ],
    description: "A broad, tusked raider who lives for the charge and the plunder that follows. Orc war bands follow the strongest chief and cannot stand to be left behind.",
    habitat: "Hill strongholds, mountain caves, and war camps along the borderlands.",
    tactics: "Uses Aggressive to close the gap and swings a greataxe at the closest fighter. Overwhelms rather than outwits.",
    tags: ["humanoid", "orc", "hills", "dungeon"],
  },
  {
    id: "hobgoblin", name: "Hobgoblin", size: "Medium", type: "humanoid (goblinoid)", alignment: "lawful evil",
    ac: 18, acNote: "chain mail, shield", hp: 11, hpDice: "2d8+2", speed: { walk: 30 },
    scores: scores(13, 12, 12, 10, 10, 9),
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "Common, Goblin", cr: "1/2", xp: 100,
    traits: [{ name: "Martial Advantage", text: "Once per turn, the hobgoblin can deal an extra 7 (2d6) damage to a creature it hits with a weapon attack, if that creature is within 5 ft. of an ally of the hobgoblin that is not incapacitated." }],
    attacks: [
      melee("Longsword", 3, [dmg("1d8+1", "slashing")], "6 (1d10 + 1) slashing damage if used with two hands."),
      ranged("Longbow", 3, [150, 600], [dmg("1d8+1", "piercing")]),
    ],
    description: "A disciplined, armoured goblinoid soldier that treats war as a trade. Hobgoblins fight in ranks, obey orders and respect only strength and discipline.",
    habitat: "Fortified camps, conquered strongholds and drilling grounds.",
    tactics: "Forms a shield line and focuses fire. Martial Advantage adds 2d6 against a target within 5 ft. of another hobgoblin, so it fights beside its allies.",
    tags: ["humanoid", "goblinoid", "dungeon", "hills"],
  },
  {
    id: "gnoll", name: "Gnoll", size: "Medium", type: "humanoid (gnoll)", alignment: "chaotic evil",
    ac: 15, acNote: "hide armor, shield", hp: 22, hpDice: "5d8", speed: { walk: 30 },
    scores: scores(14, 12, 11, 6, 10, 7),
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "Gnoll", cr: "1/2", xp: 100,
    traits: [{ name: "Rampage", text: "When the gnoll reduces a creature to 0 hit points with a melee attack on its turn, it can take a bonus action to move up to half its speed and make a bite attack." }],
    attacks: [
      melee("Bite", 4, [dmg("1d4+2", "piercing")], undefined, 5, "one creature"),
      thrown("Spear", 4, [20, 60], [dmg("1d6+2", "piercing")], "1d8 + 2 (average 6) piercing if used with two hands in melee."),
      ranged("Longbow", 3, [150, 600], [dmg("1d8+1", "piercing")]),
    ],
    description: "A hyena-headed raider that follows its hunger across the plains. Gnolls attack in a frenzy and are always hungry for more.",
    habitat: "Open plains, scrubland, and the ruins left behind by a raid.",
    tactics: "Rushes the weakest target; every kill lets it surge forward and bite again. Dropping them early breaks the frenzy.",
    tags: ["humanoid", "gnoll", "plains"],
  },
  {
    id: "lizardfolk", name: "Lizardfolk", size: "Medium", type: "humanoid (lizardfolk)", alignment: "neutral",
    ac: 15, acNote: "natural armor, shield", hp: 22, hpDice: "4d8+4", speed: { walk: 30, swim: 30 },
    scores: scores(15, 10, 13, 7, 12, 7),
    skills: { Perception: 3, Stealth: 4, Survival: 5 },
    senses: "none special", passivePerception: 13, languages: "Draconic", cr: "1/2", xp: 100,
    traits: [{ name: "Hold Breath", text: "The lizardfolk can hold its breath for 15 minutes." }],
    multiattack: "The lizardfolk makes two melee attacks, each one with a different weapon.",
    attacks: [
      melee("Bite", 4, [dmg("1d6+2", "piercing")]),
      melee("Heavy Club", 4, [dmg("1d6+2", "bludgeoning")]),
      thrown("Javelin", 4, [30, 120], [dmg("1d6+2", "piercing")]),
      melee("Spiked Shield", 4, [dmg("1d6+2", "piercing")]),
    ],
    description: "A scaled, cold-eyed hunter of the swamps that thinks in terms of food, territory and survival rather than law or cruelty. Tribes fish, hunt and defend a hidden home.",
    habitat: "Swamps, marshes, rivers and flooded ruins.",
    tactics: "Strikes from the water or the reeds with a club and a spiked shield, then slips back under. Fights to defend its territory and withdraws when it is clearly beaten.",
    tags: ["humanoid", "lizardfolk", "swamp"],
  },
  {
    id: "black-bear", name: "Black Bear", size: "Medium", type: "beast", alignment: "unaligned",
    ac: 11, acNote: "natural armor", hp: 19, hpDice: "3d8+6", speed: { walk: 40, climb: 30 },
    scores: scores(15, 10, 14, 2, 12, 7),
    skills: { Perception: 3 },
    senses: "none special", passivePerception: 13, languages: "None", cr: "1/2", xp: 100,
    traits: [{ name: "Keen Smell", text: "Advantage on Wisdom (Perception) checks that rely on smell." }],
    multiattack: "The bear makes two attacks: one with its bite and one with its claws.",
    attacks: [
      melee("Bite", 3, [dmg("1d6+2", "piercing")]),
      melee("Claws", 3, [dmg("2d4+2", "slashing")]),
    ],
    description: "A strong, shaggy forager that avoids people if it can. A sow with cubs or a bear caught at a kill will defend its meal with fearsome speed.",
    habitat: "Temperate forests, mountains and berry thickets.",
    tactics: "Usually bluffs and backs off. When it fights, it bites and claws at the nearest target and flees once badly hurt.",
    tags: ["beast", "forest", "hills"],
  },
  {
    id: "rust-monster", name: "Rust Monster", size: "Medium", type: "monstrosity", alignment: "unaligned",
    ac: 14, acNote: "natural armor", hp: 27, hpDice: "5d8+5", speed: { walk: 40 },
    scores: scores(13, 12, 13, 2, 13, 6),
    senses: "darkvision 60 ft.", passivePerception: 11, languages: "None", cr: "1/2", xp: 100,
    traits: [
      { name: "Iron Scent", text: "The rust monster can pinpoint, by scent, the location of ferrous metal within 30 ft. of it." },
      { name: "Rust Metal", text: "Any nonmagical weapon made of metal that hits the rust monster corrodes. After dealing damage, the weapon takes a permanent and cumulative -1 penalty to damage rolls. If its penalty drops to -5, the weapon is destroyed. Nonmagical ammunition made of metal that hits the rust monster is destroyed after dealing damage." },
    ],
    attacks: [
      melee("Bite", 3, [dmg("1d8+1", "piercing")], undefined, 5, "one target"),
    ],
    specials: [
      { name: "Antennae", text: "Not an attack roll. The rust monster corrodes a nonmagical ferrous metal object it can see within 5 ft. If the object is not worn or carried, it destroys a 1-foot cube of it. If worn or carried, the creature can make a DC 11 Dexterity saving throw to avoid the touch. Metal armor or a metal shield takes a permanent, cumulative -1 penalty to the AC it offers (destroyed at AC 10 or a +0 shield). A held metal weapon rusts as described in Rust Metal." },
    ],
    description: "A bristling, armoured bug the size of a hound that lives for the taste of iron. It rarely wants flesh; it wants your sword, your mail and your coins' worth of steel.",
    habitat: "Caves, mines and dungeons that hold ore, tools or dropped weapons.",
    tactics: "Charges the best-armoured fighter and touches the steel. Players should put the sword away and fight with fists, wood or magic, as its touch ruins metal.",
    tags: ["monstrosity", "dungeon", "cave"],
  },

  // ── CR 1 ──
  {
    id: "dire-wolf", name: "Dire Wolf", size: "Large", type: "beast", alignment: "unaligned",
    ac: 14, acNote: "natural armor", hp: 37, hpDice: "5d10+10", speed: { walk: 50 },
    scores: scores(17, 15, 15, 3, 12, 7),
    skills: { Perception: 3, Stealth: 4 },
    senses: "none special", passivePerception: 13, languages: "None", cr: "1", xp: 200,
    traits: [
      { name: "Keen Hearing and Smell", text: "Advantage on Wisdom (Perception) checks that rely on hearing or smell." },
      { name: "Pack Tactics", text: "Advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 ft. of that creature and the ally is not incapacitated." },
    ],
    attacks: [melee("Bite", 5, [dmg("2d6+3", "piercing")], "If the target is a creature, it must succeed on a DC 13 Strength saving throw or be knocked prone.")],
    description: "A wolf the size of a pony, with a skull-crushing bite and a pack's cunning. It stalks farms and travellers alike across the cold wilds.",
    habitat: "Deep forests, northern hills and snowy plains.",
    tactics: "Hunts in packs; one wolf pins a target prone while the rest tear into it. A strong fighter in a doorway can hold a whole pack.",
    tags: ["beast", "forest", "hills"],
  },
  {
    id: "brown-bear", name: "Brown Bear", size: "Large", type: "beast", alignment: "unaligned",
    ac: 11, acNote: "natural armor", hp: 34, hpDice: "4d10+12", speed: { walk: 40, climb: 30 },
    scores: scores(19, 10, 16, 2, 13, 7),
    skills: { Perception: 3 },
    senses: "none special", passivePerception: 13, languages: "None", cr: "1", xp: 200,
    traits: [{ name: "Keen Smell", text: "Advantage on Wisdom (Perception) checks that rely on smell." }],
    multiattack: "The bear makes two attacks: one with its bite and one with its claws.",
    attacks: [
      melee("Bite", 5, [dmg("1d8+4", "piercing")]),
      melee("Claws", 5, [dmg("2d6+4", "slashing")]),
    ],
    description: "A huge, dangerous forager that weighs as much as a horse and hits harder than most knights. It is usually shy, but it is deadly when protecting a kill or cubs.",
    habitat: "Mountain forests, river valleys and alpine meadows.",
    tactics: "Goes straight for one target with bite and claws and keeps at it until badly hurt. Loud noise and fire can drive it off.",
    tags: ["beast", "forest", "hills"],
  },
  {
    id: "bugbear", name: "Bugbear", size: "Medium", type: "humanoid (goblinoid)", alignment: "chaotic evil",
    ac: 16, acNote: "hide armor, shield", hp: 27, hpDice: "5d8+5", speed: { walk: 30 },
    scores: scores(15, 14, 13, 8, 11, 9),
    skills: { Stealth: 6, Survival: 2 },
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "Common, Goblin", cr: "1", xp: 200,
    traits: [
      { name: "Brute", text: "A melee weapon deals one extra die of its damage when the bugbear hits with it (already included in the attacks below)." },
      { name: "Surprise Attack", text: "If the bugbear surprises a creature and hits it with an attack during the first round of combat, the target takes an extra 7 (2d6) damage from the attack." },
    ],
    attacks: [
      melee("Morningstar", 4, [dmg("2d8+2", "piercing")]),
      thrown("Javelin", 4, [30, 120], [dmg("2d6+2", "piercing")], "Deals 5 (1d6 + 2) piercing damage when thrown at range instead of 2d6 + 2 in melee."),
    ],
    description: "A hairy, hulking goblinoid that moves with an unnerving silence for its size. Bugbears are ambushers and bullies that love to grab the leader first.",
    habitat: "Caves and dark woods, often leading goblin warbands.",
    tactics: "Lurks out of sight and strikes the first target from hiding for a big Surprise Attack, then keeps swinging. Weak against a party that is already alert.",
    tags: ["humanoid", "goblinoid", "dungeon", "forest"],
  },
  {
    id: "ghoul", name: "Ghoul", size: "Medium", type: "undead", alignment: "chaotic evil",
    ac: 12, hp: 22, hpDice: "5d8", speed: { walk: 30 },
    scores: scores(13, 15, 10, 7, 10, 6),
    immunities: ["poison"], conditionImmunities: ["charmed", "exhaustion", "poisoned"],
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "Common", cr: "1", xp: 200,
    traits: [],
    attacks: [
      melee("Bite", 2, [dmg("2d6+2", "piercing")], undefined, 5, "one creature"),
      melee("Claws", 4, [dmg("2d4+2", "slashing")], "If the target is a creature other than an elf or undead, it must succeed on a DC 10 Constitution saving throw or be paralyzed for 1 minute. It can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.", 5, "one target"),
    ],
    description: "A gaunt, hungry corpse-eater driven by a taste for flesh. Its claws carry a numbing, paralysing taint, and it works in packs near graves.",
    habitat: "Graveyards, battlefields, crypts and the edge of any recent massacre.",
    tactics: "Paralyses one target with its claws and drags it away to feed. A cleric or a rope-and-torch plan helps; those paralysed are in real danger.",
    tags: ["undead", "graveyard", "dungeon"],
  },
  {
    id: "giant-spider", name: "Giant Spider", size: "Large", type: "beast", alignment: "unaligned",
    ac: 14, acNote: "natural armor", hp: 26, hpDice: "4d10+4", speed: { walk: 30, climb: 30 },
    scores: scores(14, 16, 12, 2, 11, 4),
    skills: { Stealth: 7 },
    senses: "blindsight 10 ft., darkvision 60 ft.", passivePerception: 10, languages: "None", cr: "1", xp: 200,
    traits: [
      { name: "Spider Climb", text: "The spider can climb difficult surfaces, including upside down on ceilings, without needing to make an ability check." },
      { name: "Web Sense", text: "While in contact with a web, the spider knows the exact location of any other creature in contact with the same web." },
      { name: "Web Walker", text: "The spider ignores movement restrictions caused by webbing." },
    ],
    attacks: [
      melee("Bite", 5, [dmg("1d8+3", "piercing"), dmg("2d8", "poison")], "The target must make a DC 11 Constitution saving throw, taking the poison damage on a failed save, or half as much on a success. If the poison damage reduces the target to 0 hit points, the target is stable but poisoned for 1 hour, even after regaining hit points, and is paralyzed while poisoned this way.", 5, "one creature"),
    ],
    specials: [
      { name: "Web (Recharge 5-6)", text: "Ranged weapon attack, +5 to hit, range 30/60 ft., one creature. Hit: the target is restrained by webbing. As an action, the restrained target can make a DC 12 Strength check, bursting the webbing on a success. The webbing can also be attacked and destroyed (AC 10, 5 hit points, vulnerability to fire damage, immunity to bludgeoning, poison and psychic damage)." },
    ],
    description: "A horse-sized spider that waits in a web across a passage and drops on whatever walks into it. Its venom paralyses; it carries off meals to eat later.",
    habitat: "Caves, ruins, forest canopy and dungeon corridors strung with webs.",
    tactics: "Webs the most dangerous target, then bites from above or behind. Fire burns through its webbing, which is vulnerable to fire.",
    tags: ["beast", "dungeon", "forest", "cave"],
  },
  {
    id: "harpy", name: "Harpy", size: "Medium", type: "monstrosity", alignment: "chaotic evil",
    ac: 11, hp: 38, hpDice: "7d8+7", speed: { walk: 20, fly: 40 },
    scores: scores(12, 13, 12, 7, 10, 13),
    senses: "none special", passivePerception: 10, languages: "Common", cr: "1", xp: 200,
    traits: [],
    multiattack: "The harpy makes two attacks: one with its claws and one with its club.",
    attacks: [
      melee("Claws", 3, [dmg("2d4+1", "slashing")]),
      melee("Club", 3, [dmg("1d4+1", "bludgeoning")]),
    ],
    specials: [
      { name: "Luring Song", text: "The harpy sings a magical melody. Every humanoid and giant within 300 ft. that can hear it must succeed on a DC 11 Wisdom saving throw or be charmed until the song ends (the harpy must use a bonus action each turn to keep singing). A charmed target is incapacitated and walks toward the harpy by the most direct route. The target can repeat the save at the end of each of its turns, and whenever it takes damage from any source other than the harpy or before it moves into damaging terrain. The song ends if the harpy is incapacitated. A target that succeeds is immune to that harpy's song for 24 hours." },
    ],
    description: "A vulture-winged woman-shaped predator whose voice is the most dangerous thing about her. She lures travellers into ravines, bogs and cliffs, then finishes them with her talons.",
    habitat: "Cliffs, coastal crags, ruined towers and mountain passes.",
    tactics: "Sings from a perch to draw victims toward a drop, then dives at the helpless. A deaf character cannot hear the song, so it cannot charm them.",
    tags: ["monstrosity", "hills", "coast"],
  },
  {
    id: "specter", name: "Specter", size: "Medium", type: "undead", alignment: "chaotic evil",
    ac: 12, hp: 22, hpDice: "5d8", speed: { walk: 0, fly: 50, hover: true },
    scores: scores(1, 14, 11, 10, 10, 11),
    resistances: ["acid", "cold", "fire", "lightning", "thunder", "bludgeoning, piercing and slashing from nonmagical attacks"],
    immunities: ["necrotic", "poison"], conditionImmunities: SPECTRAL_IMMUNITIES,
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "understands the languages it knew in life but cannot speak", cr: "1", xp: 200,
    traits: [
      { name: "Incorporeal Movement", text: "The specter can move through other creatures and objects as if they were difficult terrain. It takes 5 (1d10) force damage if it ends its turn inside an object." },
      { name: "Sunlight Sensitivity", text: "While in sunlight, the specter has disadvantage on attack rolls, and on Wisdom (Perception) checks that rely on sight." },
    ],
    attacks: [melee("Life Drain", 4, [dmg("3d6", "necrotic")], "This is a melee spell attack. The target must succeed on a DC 10 Constitution saving throw or its hit point maximum is reduced by an amount equal to the damage taken. This reduction lasts until the target finishes a long rest. The target dies if this reduces its hit point maximum to 0.", 5, "one creature")],
    description: "A screaming, translucent spirit of someone who died violently and cannot rest. It envies the living and drains the life out of them with a touch.",
    habitat: "Haunted houses, battlefields, murder sites and old dungeons.",
    tactics: "Glides through walls to reach a target from an unexpected side. It resists nonmagical weapons (half damage), so magical weapons and spells work best.",
    tags: ["undead", "haunted", "dungeon"],
  },

  // ── CR 2 ──
  {
    id: "ogre", name: "Ogre", size: "Large", type: "giant", alignment: "chaotic evil",
    ac: 11, acNote: "hide armor", hp: 59, hpDice: "7d10+21", speed: { walk: 40 },
    scores: scores(19, 8, 16, 5, 7, 7),
    senses: "darkvision 60 ft.", passivePerception: 8, languages: "Common, Giant", cr: "2", xp: 450,
    traits: [],
    attacks: [
      melee("Greatclub", 6, [dmg("2d8+4", "bludgeoning")]),
      thrown("Javelin", 6, [30, 120], [dmg("2d6+4", "piercing")]),
    ],
    description: "A bulky, slow-witted brute that stands twice the height of a man and wields a tree trunk. Ogres bully, steal and eat anything, and will follow any bigger monster who feeds them.",
    habitat: "Hills, caves, ruined villages and wherever the pickings are easy.",
    tactics: "Walks up to the closest foe and swings. Not clever, but it takes a lot of hits to bring down.",
    tags: ["giant", "hills", "dungeon"],
  },
  {
    id: "gelatinous-cube", name: "Gelatinous Cube", size: "Large", type: "ooze", alignment: "unaligned",
    ac: 6, hp: 84, hpDice: "8d10+40", speed: { walk: 15 },
    scores: scores(14, 3, 20, 1, 6, 1),
    conditionImmunities: ["blinded", "charmed", "deafened", "exhaustion", "frightened", "prone"],
    senses: "blindsight 60 ft. (blind beyond this radius)", passivePerception: 8, languages: "None", cr: "2", xp: 450,
    traits: [
      { name: "Ooze Cube", text: "The cube takes up its entire space. Other creatures can enter the space, but a creature that does so is subjected to the cube's Engulf and has disadvantage on the saving throw. Creatures inside the cube can be seen but have total cover. A creature within 5 ft. can use an action to pull a creature or object out of the cube, which takes a successful DC 12 Strength check and costs the puller 10 (3d6) acid damage. The cube can hold one Large creature or up to four Medium or smaller creatures." },
      { name: "Transparent", text: "Even when the cube is in plain sight, it takes a successful DC 15 Wisdom (Perception) check to spot it if it has neither moved nor attacked. A creature that tries to enter its space while unaware of it is surprised by the cube." },
    ],
    attacks: [melee("Pseudopod", 4, [dmg("3d6", "acid")], undefined, 5, "one creature")],
    specials: [
      { name: "Engulf", text: "The cube moves up to its speed. While doing so, it can enter Large or smaller creatures' spaces. Whenever it enters a creature's space, the creature makes a DC 12 Dexterity saving throw. On a success, the creature can choose to be pushed 5 ft. back or to the side of the cube; a creature that chooses not to be pushed suffers the consequences of a failed save. On a failure, the cube enters its space and the creature takes 10 (3d6) acid damage and is engulfed. An engulfed creature is restrained, cannot breathe, and takes 21 (6d6) acid damage at the start of each of the cube's turns. It moves with the cube and can escape with an action and a successful DC 12 Strength check." },
    ],
    description: "A quivering, almost invisible block of jelly that scours a dungeon corridor clean, dissolving everything in its path. Bones and coins float inside it, the leavings of earlier meals.",
    habitat: "Dungeon corridors and ruined halls, patrolling slowly along a set route.",
    tactics: "Slides forward along a corridor and engulfs whoever is in its way. Its AC is only 6 and it has no resistances, so it is easy to hit; the danger is Engulf, which restrains and burns whoever is inside.",
    tags: ["ooze", "dungeon"],
  },
  {
    id: "mimic", name: "Mimic", size: "Medium", type: "monstrosity (shapechanger)", alignment: "neutral",
    ac: 12, acNote: "natural armor", hp: 58, hpDice: "9d8+18", speed: { walk: 15 },
    scores: scores(17, 12, 15, 5, 13, 8),
    skills: { Stealth: 5 },
    immunities: ["acid"], conditionImmunities: ["prone"],
    senses: "darkvision 60 ft.", passivePerception: 11, languages: "None", cr: "2", xp: 450,
    traits: [
      { name: "Shapechanger", text: "The mimic can use its action to polymorph into an object or back into its true, amorphous form. Its statistics are the same in each form. Any equipment it is wearing or carrying is not transformed. It reverts to its true form if it dies." },
      { name: "Adhesive (Object Form Only)", text: "The mimic adheres to anything that touches it. A Huge or smaller creature adhered to the mimic is also grappled by it (escape DC 13). Ability checks made to escape this grapple have disadvantage." },
      { name: "False Appearance (Object Form Only)", text: "While the mimic remains motionless, it is indistinguishable from an ordinary object." },
      { name: "Grappler", text: "The mimic has advantage on attack rolls against any creature grappled by it." },
    ],
    attacks: [
      melee("Pseudopod", 5, [dmg("1d8+3", "bludgeoning")], "If the mimic is in object form, the target is subjected to its Adhesive trait."),
      melee("Bite", 5, [dmg("1d8+3", "piercing"), dmg("1d8", "acid")]),
    ],
    description: "A lump of shape-shifting flesh that pretends to be a chest, a door or a barrel and waits for something to touch it. Once something sticks, the mimic eats it.",
    habitat: "Dungeons and ruins, posing as treasure or furniture in a likely room.",
    tactics: "Stays still until touched, then sticks and grapples. Probing a chest with a pole is the cheap answer; players who open every chest by hand learn.",
    tags: ["monstrosity", "dungeon"],
  },
  {
    id: "gargoyle", name: "Gargoyle", size: "Medium", type: "elemental", alignment: "chaotic evil",
    ac: 15, acNote: "natural armor", hp: 52, hpDice: "7d8+21", speed: { walk: 30, fly: 60 },
    scores: scores(15, 11, 16, 6, 11, 7),
    resistances: ["bludgeoning, piercing and slashing from nonmagical attacks that are not adamantine"],
    immunities: ["poison"], conditionImmunities: ["exhaustion", "petrified", "poisoned"],
    senses: "darkvision 60 ft.", passivePerception: 10, languages: "Terran", cr: "2", xp: 450,
    traits: [{ name: "False Appearance", text: "While the gargoyle remains motionless, it is indistinguishable from an inanimate statue." }],
    multiattack: "The gargoyle makes two attacks: one with its bite and one with its claws.",
    attacks: [
      melee("Bite", 4, [dmg("1d6+2", "piercing")]),
      melee("Claws", 4, [dmg("1d6+2", "slashing")]),
    ],
    description: "A winged stone creature that perches among real statuary until something walks beneath it. It is patient, cruel and takes only half damage from ordinary weapons.",
    habitat: "Rooftops, ruined cathedrals, mausoleums and the gates of cursed places.",
    tactics: "Waits motionless as a statue, then drops on the party. Nonmagical weapons deal only half damage to it unless they are adamantine, so it may be the first enemy to make magic weapons matter.",
    tags: ["elemental", "dungeon", "ruins"],
  },
  {
    id: "ettercap", name: "Ettercap", size: "Medium", type: "monstrosity", alignment: "neutral evil",
    ac: 13, acNote: "natural armor", hp: 44, hpDice: "8d8+8", speed: { walk: 30, climb: 30 },
    scores: scores(14, 15, 13, 7, 12, 8),
    skills: { Perception: 3, Stealth: 4, Survival: 3 },
    senses: "darkvision 60 ft.", passivePerception: 13, languages: "None", cr: "2", xp: 450,
    traits: [
      { name: "Spider Climb", text: "The ettercap can climb difficult surfaces, including upside down on ceilings, without needing to make an ability check." },
      { name: "Web Sense", text: "While in contact with a web, the ettercap knows the exact location of any other creature in contact with the same web." },
      { name: "Web Walker", text: "The ettercap ignores movement restrictions caused by webbing." },
    ],
    multiattack: "The ettercap makes two attacks: one with its bite and one with its claws.",
    attacks: [
      melee("Bite", 4, [dmg("1d8+2", "piercing"), dmg("1d8", "poison")], "The target must succeed on a DC 11 Constitution saving throw or be poisoned for 1 minute. It can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.", 5, "one creature"),
      melee("Claws", 4, [dmg("2d4+2", "slashing")]),
    ],
    specials: [
      { name: "Web (Recharge 5-6)", text: "Ranged weapon attack, +4 to hit, range 30/60 ft., one Large or smaller creature. Hit: the creature is restrained by webbing. As an action, it can make a DC 11 Strength check, bursting the webbing on a success. The webbing can also be attacked and destroyed (AC 10, 5 hit points, vulnerability to fire damage, immunity to bludgeoning, poison and psychic damage)." },
    ],
    description: "A sallow, pot-bellied spider-man that traps prey in webs strung through dark woods. It tames giant spiders and treats them as guard-beasts.",
    habitat: "Deep forests and cave mouths, usually with giant spiders nearby.",
    tactics: "Webs the party's strongest fighter from the trees, then bites its way through the rest. Fire destroys its webbing, which is vulnerable to fire.",
    tags: ["monstrosity", "forest", "cave"],
  },

  // ── CR 3 ──
  {
    id: "owlbear", name: "Owlbear", size: "Large", type: "monstrosity", alignment: "unaligned",
    ac: 13, acNote: "natural armor", hp: 59, hpDice: "7d10+21", speed: { walk: 40 },
    scores: scores(20, 12, 17, 3, 12, 7),
    skills: { Perception: 3 },
    senses: "darkvision 60 ft.", passivePerception: 13, languages: "None", cr: "3", xp: 700,
    traits: [{ name: "Keen Sight and Smell", text: "Advantage on Wisdom (Perception) checks that rely on sight or smell." }],
    multiattack: "The owlbear makes two attacks: one with its beak and one with its claws.",
    attacks: [
      melee("Beak", 7, [dmg("1d10+5", "piercing")], undefined, 5, "one creature"),
      melee("Claws", 7, [dmg("2d8+5", "slashing")]),
    ],
    description: "A bear-bodied, owl-headed beast with feathers, talons and a temper to match. It is bad-tempered, territorial and ferocious in a fight.",
    habitat: "Old forests and dense wilderness where it can claim a wide range.",
    tactics: "Rushes the closest enemy and keeps clawing and pecking until one of them drops. It does not retreat easily.",
    tags: ["monstrosity", "forest"],
  },
  {
    id: "wight", name: "Wight", size: "Medium", type: "undead", alignment: "neutral evil",
    ac: 14, acNote: "studded leather", hp: 45, hpDice: "6d8+18", speed: { walk: 30 },
    scores: scores(15, 14, 16, 10, 13, 15),
    skills: { Perception: 3, Stealth: 4 },
    resistances: ["necrotic", "bludgeoning, piercing and slashing from nonmagical attacks that are not silvered"],
    immunities: ["poison"], conditionImmunities: ["exhaustion", "poisoned"],
    senses: "darkvision 60 ft.", passivePerception: 13, languages: "the languages it knew in life", cr: "3", xp: 700,
    traits: [{ name: "Sunlight Sensitivity", text: "While in sunlight, the wight has disadvantage on attack rolls, and on Wisdom (Perception) checks that rely on sight." }],
    multiattack: "The wight makes two longsword attacks or two longbow attacks. It can use its Life Drain in place of one longsword attack.",
    attacks: [
      melee("Life Drain", 4, [dmg("1d6+2", "necrotic")], "The target must succeed on a DC 13 Constitution saving throw or its hit point maximum is reduced by an amount equal to the damage taken. This reduction lasts until the target finishes a long rest. The target dies if this reduces its hit point maximum to 0. A humanoid slain by this attack rises 24 hours later as a zombie under the wight's control, unless the humanoid is restored to life or its body is destroyed. The wight can have no more than twelve zombies under its control at one time.", 5, "one creature"),
      melee("Longsword", 4, [dmg("1d8+2", "slashing")], "7 (1d10 + 2) slashing damage if used with two hands."),
      ranged("Longbow", 4, [150, 600], [dmg("1d8+2", "piercing")]),
    ],
    description: "A cold, armoured corpse animated by hatred and a hunger for life. A wight commands the zombies it makes and still remembers how to fight.",
    habitat: "Barrow mounds, ancient tombs and fortresses of the dead.",
    tactics: "Fights beside the zombies it makes and uses Life Drain in place of a sword swing. Silvered or magical weapons avoid its resistance, and sunlight gives it disadvantage on attacks.",
    tags: ["undead", "dungeon", "graveyard"],
  },
  {
    id: "werewolf", name: "Werewolf", size: "Medium", type: "humanoid (human, shapechanger)", alignment: "chaotic evil",
    ac: 11, acNote: "12 in wolf or hybrid form (natural armor)", hp: 58, hpDice: "9d8+18", speed: { walk: 30 },
    scores: scores(15, 13, 14, 10, 11, 10),
    skills: { Perception: 4, Stealth: 3 },
    immunities: ["bludgeoning, piercing and slashing from nonmagical attacks that are not silvered"],
    senses: "none special", passivePerception: 14, languages: "Common (cannot speak in wolf form)", cr: "3", xp: 700,
    traits: [
      { name: "Shapechanger", text: "The werewolf can use its action to polymorph into a wolf-humanoid hybrid or into a wolf (speed 40 ft. in wolf form), or back into its true humanoid form. Its statistics, other than AC, are the same in each form. Its equipment is not transformed. It reverts to its true form if it dies." },
      { name: "Keen Hearing and Smell", text: "Advantage on Wisdom (Perception) checks that rely on hearing or smell." },
    ],
    multiattack: "Humanoid or Hybrid Form Only. Makes two attacks: one with its bite and one with its claws or spear. Bite is wolf or hybrid form only, Claws hybrid form only and Spear humanoid form only, so the DM rules on how this fits a humanoid-form werewolf. The usual reading is two spear attacks in humanoid form and bite plus claws in hybrid form. There is no Multiattack in wolf form.",
    attacks: [
      melee("Bite (wolf or hybrid form only)", 4, [dmg("1d8+2", "piercing")], "If the target is a humanoid, it must succeed on a DC 12 Constitution saving throw or be cursed with werewolf lycanthropy.", 5, "one target"),
      melee("Claws (hybrid form only)", 4, [dmg("2d4+2", "slashing")], undefined, 5, "one creature"),
      thrown("Spear (humanoid form only)", 4, [20, 60], [dmg("1d6+2", "piercing")], "1d8 + 2 (average 6) piercing if used with two hands in melee.", "one creature"),
    ],
    description: "A cursed human who turns into a wolf-beast under the moon or at will. By day it looks like an ordinary person; by night it hunts in a fury.",
    habitat: "Small towns, woodland villages and forests where it can hide among people.",
    tactics: "Rends with bite and claws in hybrid form, spreading the curse. Only silvered or magical weapons can hurt it.",
    tags: ["humanoid", "shapechanger", "forest"],
  },
  {
    id: "minotaur", name: "Minotaur", size: "Large", type: "monstrosity", alignment: "chaotic evil",
    ac: 14, acNote: "natural armor", hp: 76, hpDice: "9d10+27", speed: { walk: 40 },
    scores: scores(18, 11, 16, 6, 16, 9),
    skills: { Perception: 7 },
    senses: "darkvision 60 ft.", passivePerception: 17, languages: "Abyssal", cr: "3", xp: 700,
    traits: [
      { name: "Charge", text: "If the minotaur moves at least 10 ft. straight toward a target and then hits it with a gore attack on the same turn, the target takes an extra 9 (2d8) piercing damage. If the target is a creature, it must succeed on a DC 14 Strength saving throw or be pushed up to 10 ft. away and knocked prone." },
      { name: "Labyrinthine Recall", text: "The minotaur can perfectly recall any path it has travelled." },
      { name: "Reckless", text: "At the start of its turn, the minotaur can gain advantage on all melee weapon attack rolls it makes during that turn, but attack rolls against it have advantage until the start of its next turn." },
    ],
    attacks: [
      melee("Greataxe", 6, [dmg("2d12+4", "slashing")]),
      melee("Gore", 6, [dmg("2d8+4", "piercing")]),
    ],
    description: "A towering bull-headed brute with a bad temper and a sense of direction that never fails it. It lairs in mazes and treats the corridors as its hunting ground.",
    habitat: "Mazes, labyrinthine dungeons and the twisting passages beneath cursed cities.",
    tactics: "Charges down a long corridor to gore and knock a target down, then goes reckless with its axe. Keep the party out of a straight line.",
    tags: ["monstrosity", "dungeon"],
  },
  {
    id: "basilisk", name: "Basilisk", size: "Medium", type: "monstrosity", alignment: "unaligned",
    ac: 15, acNote: "natural armor", hp: 52, hpDice: "8d8+16", speed: { walk: 20 },
    scores: scores(16, 8, 15, 2, 8, 7),
    senses: "darkvision 60 ft.", passivePerception: 9, languages: "None", cr: "3", xp: 700,
    traits: [
      { name: "Petrifying Gaze", text: "If a creature starts its turn within 30 ft. of the basilisk and the two can see each other, the basilisk can force it to make a DC 12 Constitution saving throw if the basilisk is not incapacitated. On a failure, the creature magically begins to turn to stone and is restrained; it repeats the save at the end of its next turn. On a success, the effect ends. On a failure, the creature is petrified until freed by greater restoration or similar magic. Unless surprised, a creature can avert its eyes at the start of its turn to avoid the save, but then it cannot see the basilisk until the start of its next turn; if it looks in the meantime, it must save immediately. If the basilisk sees its own reflection within 30 ft. in bright light, it mistakes it for a rival and targets itself with its gaze." },
    ],
    attacks: [melee("Bite", 5, [dmg("2d6+3", "piercing"), dmg("2d6", "poison")])],
    description: "A heavy, eight-legged reptile whose stare turns living things to stone. Statues of past victims are often posed around its lair.",
    habitat: "Caves, ruins and rocky hollows scattered with lifelike statues.",
    tactics: "Waits for prey to look at it, then gazes. Fighting it blindfolded, or with a mirror, changes the odds.",
    tags: ["monstrosity", "cave", "dungeon"],
  },
  {
    id: "manticore", name: "Manticore", size: "Large", type: "monstrosity", alignment: "lawful evil",
    ac: 14, acNote: "natural armor", hp: 68, hpDice: "8d10+24", speed: { walk: 30, fly: 50 },
    scores: scores(17, 16, 17, 7, 12, 8),
    senses: "darkvision 60 ft.", passivePerception: 11, languages: "Common", cr: "3", xp: 700,
    traits: [{ name: "Tail Spike Regrowth", text: "The manticore has twenty-four tail spikes. Used spikes regrow when it finishes a long rest." }],
    multiattack: "The manticore makes three attacks: either three with its tail spikes, or one with its bite and two with its claws.",
    attacks: [
      melee("Bite", 5, [dmg("1d8+3", "piercing")]),
      melee("Claw", 5, [dmg("1d6+3", "slashing")]),
      ranged("Tail Spike", 5, [100, 200], [dmg("1d8+3", "piercing")]),
    ],
    description: "A winged, lion-bodied monster with a human face and a spiked tail it can throw. It is cruel, boastful and fond of tormenting a victim before it kills.",
    habitat: "Craggy hills, mountain tops and wasteland ruins.",
    tactics: "Stays aloft out of melee reach and showers a target with tail spikes, then drops down to rend a wounded foe. Hard to pin down without ranged weapons.",
    tags: ["monstrosity", "hills", "mountain"],
  },

  // ── CR 4 ──
  {
    id: "red-dragon-wyrmling", name: "Red Dragon Wyrmling", size: "Medium", type: "dragon", alignment: "chaotic evil",
    ac: 17, acNote: "natural armor", hp: 75, hpDice: "10d8+30", speed: { walk: 30, climb: 30, fly: 60 },
    scores: scores(19, 10, 17, 12, 11, 15),
    saves: { dex: 2, con: 5, wis: 2, cha: 4 },
    skills: { Perception: 4, Stealth: 2 },
    immunities: ["fire"],
    senses: "blindsight 10 ft., darkvision 60 ft.", passivePerception: 14, languages: "Draconic", cr: "4", xp: 1100,
    traits: [],
    attacks: [melee("Bite", 6, [dmg("1d10+4", "piercing"), dmg("1d6", "fire")])],
    specials: [
      { name: "Fire Breath (Recharge 5-6)", text: "The dragon exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much on a success." },
    ],
    description: "A young red dragon, no bigger than a horse but already proud, greedy and vicious. Its scales are bright, its breath scorches and it is certain it will grow up to rule everything.",
    habitat: "Volcanic caves, mountain lairs and the hoards of whatever it has stolen.",
    tactics: "Opens with Fire Breath on a clustered party, then bites the nearest. Gets sloppy when hurt and flees upward if its breath is spent.",
    tags: ["dragon", "mountain", "dungeon"],
  },

  // ── CR 5 ──
  {
    id: "wraith", name: "Wraith", size: "Medium", type: "undead", alignment: "neutral evil",
    ac: 13, hp: 67, hpDice: "9d8+27", speed: { walk: 0, fly: 60, hover: true },
    scores: scores(6, 16, 16, 12, 14, 15),
    resistances: ["acid", "cold", "fire", "lightning", "thunder", "bludgeoning, piercing and slashing from nonmagical attacks that are not silvered"],
    immunities: ["necrotic", "poison"], conditionImmunities: ["charmed", "exhaustion", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained"],
    senses: "darkvision 60 ft.", passivePerception: 12, languages: "the languages it knew in life", cr: "5", xp: 1800,
    traits: [
      { name: "Incorporeal Movement", text: "The wraith can move through other creatures and objects as if they were difficult terrain. It takes 5 (1d10) force damage if it ends its turn inside an object." },
      { name: "Sunlight Sensitivity", text: "While in sunlight, the wraith has disadvantage on attack rolls, and on Wisdom (Perception) checks that rely on sight." },
    ],
    attacks: [melee("Life Drain", 6, [dmg("4d8+3", "necrotic")], "The target must succeed on a DC 14 Constitution saving throw or its hit point maximum is reduced by an amount equal to the damage taken. This reduction lasts until the target finishes a long rest. The target dies if this reduces its hit point maximum to 0.", 5, "one creature")],
    specials: [
      { name: "Create Specter", text: "The wraith targets a humanoid within 10 ft. that has been dead for no longer than 1 minute and died violently. The target's spirit rises as a specter in the space of its corpse or the nearest unoccupied space. The specter is under the wraith's control. The wraith can have no more than seven specters under its control at one time." },
    ],
    description: "A black-robed spirit of a tyrant or butcher, bound to the world by hatred. It commands lesser spirits and drains the life from anything that crosses it.",
    habitat: "Cursed castles, battlefields and the vaults of fallen kingdoms.",
    tactics: "Floats through walls and drains one target at a time while its specters swarm the rest. Nonmagical, unsilvered weapons deal only half damage to it, and sunlight gives it disadvantage on attacks.",
    tags: ["undead", "haunted", "dungeon"],
  },
  {
    id: "troll", name: "Troll", size: "Large", type: "giant", alignment: "chaotic evil",
    ac: 15, acNote: "natural armor", hp: 84, hpDice: "8d10+40", speed: { walk: 30 },
    scores: scores(18, 13, 20, 7, 9, 7),
    skills: { Perception: 2 },
    senses: "darkvision 60 ft.", passivePerception: 12, languages: "Giant", cr: "5", xp: 1800,
    traits: [
      { name: "Keen Smell", text: "Advantage on Wisdom (Perception) checks that rely on smell." },
      { name: "Regeneration", text: "The troll regains 10 hit points at the start of its turn. If the troll takes acid or fire damage, this trait does not function at the start of its next turn. The troll dies only if it starts its turn with 0 hit points and does not regenerate." },
    ],
    multiattack: "The troll makes three attacks: one with its bite and two with its claws.",
    attacks: [
      melee("Bite", 7, [dmg("1d6+4", "piercing")]),
      melee("Claw", 7, [dmg("2d6+4", "slashing")]),
    ],
    description: "A gangly, green-skinned giant with long claws and a gut that never fills. Its flesh knits back together within moments, so the wounds you deal are only a delay.",
    habitat: "Bogs, caves, bridges and ruined towers, often under a stone it uses as a lair.",
    tactics: "Pounds the closest fighter with three attacks a round and shrugs off wounds. Acid and fire stop its regeneration for a turn; finish it then.",
    tags: ["giant", "swamp", "hills", "dungeon"],
  },
  {
    id: "hill-giant", name: "Hill Giant", size: "Huge", type: "giant", alignment: "chaotic evil",
    ac: 13, acNote: "natural armor", hp: 105, hpDice: "10d12+40", speed: { walk: 40 },
    scores: scores(21, 8, 19, 5, 9, 6),
    skills: { Perception: 2 },
    senses: "none special", passivePerception: 12, languages: "Giant", cr: "5", xp: 1800,
    traits: [],
    multiattack: "The giant makes two greatclub attacks.",
    attacks: [
      melee("Greatclub", 8, [dmg("3d8+5", "bludgeoning")], undefined, 10),
      ranged("Rock", 8, [60, 240], [dmg("3d10+5", "bludgeoning")]),
    ],
    description: "A dim, hungry giant who is as tall as a house and a good deal less careful. It lives by looting farms, herding stolen livestock and hurling boulders at anyone who objects.",
    habitat: "Hill country, high pastures and a stolen steading or ruined fort.",
    tactics: "Throws rocks at the party while they approach, then swings the greatclub with reach 10 ft. Not clever; will chase a bait of food.",
    tags: ["giant", "hills"],
  },

  // ── CR 8 ──
  {
    id: "young-green-dragon", name: "Young Green Dragon", size: "Large", type: "dragon", alignment: "lawful evil",
    ac: 18, acNote: "natural armor", hp: 136, hpDice: "16d10+48", speed: { walk: 40, fly: 80, swim: 40 },
    scores: scores(19, 12, 17, 16, 13, 15),
    saves: { dex: 4, con: 6, wis: 4, cha: 5 },
    skills: { Deception: 5, Perception: 7, Stealth: 4 },
    immunities: ["poison"], conditionImmunities: ["poisoned"],
    senses: "blindsight 30 ft., darkvision 120 ft.", passivePerception: 17, languages: "Common, Draconic", cr: "8", xp: 3900,
    traits: [{ name: "Amphibious", text: "The dragon can breathe air and water." }],
    multiattack: "The dragon makes three attacks: one with its bite and two with its claws.",
    attacks: [
      melee("Bite", 7, [dmg("2d10+4", "piercing"), dmg("2d6", "poison")], undefined, 10),
      melee("Claw", 7, [dmg("2d6+4", "slashing")]),
    ],
    specials: [
      { name: "Poison Breath (Recharge 5-6)", text: "The dragon exhales poisonous gas in a 30-foot cone. Each creature in that area must make a DC 14 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much on a success." },
    ],
    description: "A scheming forest dragon that lies, bargains and manipulates before it ever fights. It collects secrets and servants as eagerly as it collects gold.",
    habitat: "Ancient forests, overgrown ruins and a lair hidden under the roots of the oldest trees.",
    tactics: "Talks first and strikes at the weakest link. Opens with Poison Breath on a huddled group, then flies off if the fight turns.",
    tags: ["dragon", "forest"],
  },
];

/** Every creature, sorted by challenge rating, then name. */
export const BESTIARY: readonly Beast[] = [...RAW].sort((a, b) => {
  const ca = CR_ORDER.indexOf(a.cr);
  const cb = CR_ORDER.indexOf(b.cr);
  if (ca !== cb) return ca - cb;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
});

const BY_ID: ReadonlyMap<string, Beast> = new Map(BESTIARY.map((b) => [b.id, b]));

/** The creature with this id, or undefined. */
export function beastById(id: string): Beast | undefined {
  return BY_ID.get(id);
}
