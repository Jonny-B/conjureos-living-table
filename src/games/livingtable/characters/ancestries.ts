/**
 * The nine SRD 5.1 ancestries a new character can be, as data.
 *
 * SRD 5.1 content is CC BY 4.0 (NOTICE.md); the numbers here are the SRD's and
 * the sentences are our own. Only ancestries in the SRD are listed: no
 * subrace or heritage the SRD does not carry.
 *
 * THE HONESTY RULE (equipmentTypes.ts, rule 7): a trait states its real number,
 * and says plainly whether the engine applies it. Every trait carries
 * `applied`:
 *   true  - creation.ts folds it into the sheet's numbers (an ability increase,
 *           a granted skill, base walking speed, Dwarven Toughness's hit point).
 *   false - nothing in the engine reads it. It is on the sheet and in the DM's
 *           brief, and the DM rules on it. The UI labels these "The DM rules
 *           on this" and the applied ones "The game applies this".
 * Darkvision, resistances, the Dragonborn breath, Lucky and Relentless
 * Endurance are all in the second group today.
 */
import type { AbilityScores } from "../rules";

export type AbilityKey = keyof AbilityScores;

export interface AncestryTrait {
  name: string;
  text: string;
  /** True when the engine applies this trait's numbers; false when it is only told to the DM ("The DM rules on this"). */
  applied: boolean;
}

export interface Ancestry {
  id: string;
  name: string;
  size: "Small" | "Medium";
  /** Base walking speed in feet. 30 for most, 25 for dwarves, halflings and gnomes. */
  speedFt: number;
  /** The fixed ability score increases, added to the base scores at creation. */
  abilityIncreases: Partial<AbilityScores>;
  /** Free increases the player assigns (Half-Elf: +1 to two abilities other than Charisma). */
  chooseIncreases?: { count: number; amount: number; exclude: AbilityKey[] };
  /** Skills this ancestry always grants. */
  skills?: string[];
  /** How many extra skills the player picks (Half-Elf Skill Versatility). */
  chooseSkills?: number;
  languages: string[];
  darkvisionFt?: number;
  /** Extra hit points per level (Hill Dwarf's Dwarven Toughness). */
  hpPerLevel?: number;
  traits: AncestryTrait[];
  description: string;
}

const APPLIED_RULE_NOTE = "The DM rules on this; the engine does not apply it.";

export const ANCESTRIES: readonly Ancestry[] = Object.freeze([
  {
    id: "human",
    name: "Human",
    size: "Medium",
    speedFt: 30,
    abilityIncreases: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    languages: ["Common", "One extra language of your choice"],
    traits: [
      { name: "Ability Score Increase", text: "+1 to every ability score.", applied: true },
      { name: "Speed", text: "Walking speed 30 feet.", applied: true },
      { name: "Languages", text: "You speak Common and one more language you pick. The DM rules on which one comes up.", applied: false },
    ],
    description: "The most common folk of the world, quick to learn and quick to try something new. No single gift, but a little of everything.",
  },
  {
    id: "hill-dwarf",
    name: "Hill Dwarf",
    size: "Medium",
    speedFt: 25,
    abilityIncreases: { con: 2, wis: 1 },
    languages: ["Common", "Dwarvish"],
    darkvisionFt: 60,
    hpPerLevel: 1,
    traits: [
      { name: "Ability Score Increase", text: "+2 Constitution, +1 Wisdom.", applied: true },
      { name: "Speed", text: "Walking speed 25 feet. The SRD says heavy armor never slows a dwarf; the engine still applies its own Strength penalty, so the DM rules on that.", applied: true },
      { name: "Dwarven Toughness", text: "+1 hit point at level 1. The level-up engine does not add the extra point at later levels yet; the DM rules on that.", applied: true },
      { name: "Darkvision", text: `See in dim light within 60 feet as if it were bright, and in darkness as if it were dim, in shades of grey. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Dwarven Resilience", text: `Advantage on saving throws against poison and resistance to poison damage. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Dwarven Combat Training", text: `Trained with the battleaxe, handaxe, light hammer and warhammer. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Tool Proficiency", text: `Trained with one of smith's tools, brewer's supplies or mason's tools. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Stonecunning", text: `Double your proficiency bonus on History checks about the origin of stonework. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Stocky, stubborn and hard to move, raised in the hills and halls of the old stone clans. Tougher than their size suggests and slow to forget a debt.",
  },
  {
    id: "high-elf",
    name: "High Elf",
    size: "Medium",
    speedFt: 30,
    abilityIncreases: { dex: 2, int: 1 },
    skills: ["Perception"],
    languages: ["Common", "Elvish", "One extra language of your choice"],
    darkvisionFt: 60,
    traits: [
      { name: "Ability Score Increase", text: "+2 Dexterity, +1 Intelligence.", applied: true },
      { name: "Speed", text: "Walking speed 30 feet.", applied: true },
      { name: "Keen Senses", text: "Trained in Perception.", applied: true },
      { name: "Darkvision", text: `See in dim light within 60 feet as if it were bright, and in darkness as if it were dim, in shades of grey. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Fey Ancestry", text: `Advantage on saving throws against being charmed, and magic cannot put you to sleep. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Trance", text: `You meditate for 4 hours instead of sleeping 8, and still count it as a long rest. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Elf Weapon Training", text: `Trained with the longsword, shortsword, shortbow and longbow. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Cantrip", text: `Know one wizard cantrip of your choice, cast with Intelligence. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Tall, graceful and long-lived, with a scholar's patience and an archer's eye. They remember things the rest of the world has forgotten.",
  },
  {
    id: "lightfoot-halfling",
    name: "Lightfoot Halfling",
    size: "Small",
    speedFt: 25,
    abilityIncreases: { dex: 2, cha: 1 },
    languages: ["Common", "Halfling"],
    traits: [
      { name: "Ability Score Increase", text: "+2 Dexterity, +1 Charisma.", applied: true },
      { name: "Speed", text: "Walking speed 25 feet.", applied: true },
      { name: "Lucky", text: `When you roll a natural 1 on an attack roll, ability check or saving throw, you reroll it and must use the new roll. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Brave", text: `Advantage on saving throws against being frightened. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Halfling Nimbleness", text: `You can move through the space of any creature larger than you. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Naturally Stealthy", text: `You can try to hide behind a creature at least one size larger than you. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Small, cheerful and unreasonably lucky, happiest with a warm meal and a way out. Easy to underestimate, which they rely on.",
  },
  {
    id: "dragonborn",
    name: "Dragonborn",
    size: "Medium",
    speedFt: 30,
    abilityIncreases: { str: 2, cha: 1 },
    languages: ["Common", "Draconic"],
    traits: [
      { name: "Ability Score Increase", text: "+2 Strength, +1 Charisma.", applied: true },
      { name: "Speed", text: "Walking speed 30 feet.", applied: true },
      { name: "Draconic Ancestry", text: `Pick a dragon kind (black, blue, brass, bronze, copper, gold, green, red, silver or white); it sets the damage type of your breath and your resistance. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Breath Weapon", text: `Once per short or long rest, breathe out a 15 foot cone or a 5 by 30 foot line: 2d6 damage at level 1, saving throw DC 8 + your Constitution modifier + your proficiency bonus, half damage on a success. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Damage Resistance", text: `Resistance to the damage type of your draconic ancestry. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Scaled, proud and built like a drawn bow, carrying the blood of dragons in a breath they can actually use. They hold honor close and hide very little.",
  },
  {
    id: "rock-gnome",
    name: "Rock Gnome",
    size: "Small",
    speedFt: 25,
    abilityIncreases: { int: 2, con: 1 },
    languages: ["Common", "Gnomish"],
    darkvisionFt: 60,
    traits: [
      { name: "Ability Score Increase", text: "+2 Intelligence, +1 Constitution.", applied: true },
      { name: "Speed", text: "Walking speed 25 feet.", applied: true },
      { name: "Darkvision", text: `See in dim light within 60 feet as if it were bright, and in darkness as if it were dim, in shades of grey. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Gnome Cunning", text: `Advantage on Intelligence, Wisdom and Charisma saving throws against magic. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Artificer's Lore", text: `Double your proficiency bonus on History checks about magic items, alchemical objects or technological devices. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Tinker", text: `With tinker's tools and 1 hour you can build a tiny clockwork device (AC 5, 1 hit point) that runs for 24 hours. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Small, endlessly curious and never without a gadget half taken apart. Their cleverness comes with a stubborn streak and a lot of spare screws.",
  },
  {
    id: "half-elf",
    name: "Half-Elf",
    size: "Medium",
    speedFt: 30,
    abilityIncreases: { cha: 2 },
    chooseIncreases: { count: 2, amount: 1, exclude: ["cha"] },
    chooseSkills: 2,
    languages: ["Common", "Elvish", "One extra language of your choice"],
    darkvisionFt: 60,
    traits: [
      { name: "Ability Score Increase", text: "+2 Charisma, and +1 to two other abilities of your choice.", applied: true },
      { name: "Speed", text: "Walking speed 30 feet.", applied: true },
      { name: "Skill Versatility", text: "Trained in two skills of your choice.", applied: true },
      { name: "Darkvision", text: `See in dim light within 60 feet as if it were bright, and in darkness as if it were dim, in shades of grey. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Fey Ancestry", text: `Advantage on saving throws against being charmed, and magic cannot put you to sleep. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Walks between two worlds and is at home in both, with a charm that opens doors. Adaptable almost to a fault.",
  },
  {
    id: "half-orc",
    name: "Half-Orc",
    size: "Medium",
    speedFt: 30,
    abilityIncreases: { str: 2, con: 1 },
    skills: ["Intimidation"],
    languages: ["Common", "Orc"],
    darkvisionFt: 60,
    traits: [
      { name: "Ability Score Increase", text: "+2 Strength, +1 Constitution.", applied: true },
      { name: "Speed", text: "Walking speed 30 feet.", applied: true },
      { name: "Menacing", text: "Trained in Intimidation.", applied: true },
      { name: "Darkvision", text: `See in dim light within 60 feet as if it were bright, and in darkness as if it were dim, in shades of grey. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Relentless Endurance", text: `Once per long rest, when damage would drop you to 0 hit points you drop to 1 instead. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Savage Attacks", text: `When you score a critical hit with a melee weapon, roll one extra damage die of the weapon. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Strong, scarred and hard to put down, with a stare that settles arguments. People expect the worst of them and are often corrected.",
  },
  {
    id: "tiefling",
    name: "Tiefling",
    size: "Medium",
    speedFt: 30,
    abilityIncreases: { cha: 2, int: 1 },
    languages: ["Common", "Infernal"],
    darkvisionFt: 60,
    traits: [
      { name: "Ability Score Increase", text: "+2 Charisma, +1 Intelligence.", applied: true },
      { name: "Speed", text: "Walking speed 30 feet.", applied: true },
      { name: "Darkvision", text: `See in dim light within 60 feet as if it were bright, and in darkness as if it were dim, in shades of grey. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Hellish Resistance", text: `Resistance to fire damage. ${APPLIED_RULE_NOTE}`, applied: false },
      { name: "Infernal Legacy", text: `Know the thaumaturgy cantrip. From level 3 cast hellish rebuke once per long rest as a 2nd level spell, and from level 5 cast darkness once per long rest, using Charisma. ${APPLIED_RULE_NOTE}`, applied: false },
    ],
    description: "Marked by an old bargain in their bloodline: horns, a tail and eyes that catch the light. Wary of strangers because strangers are wary of them.",
  },
] satisfies Ancestry[]);

export function getAncestry(id: string): Ancestry | undefined {
  return ANCESTRIES.find((a) => a.id === id);
}
