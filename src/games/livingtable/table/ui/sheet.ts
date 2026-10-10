/**
 * The character sheet and character creation, drawn as DOM inside the Play
 * tab's game window ("a character sheet like DnD that the user creates for
 * character creation. Plus we then need a character creation."). Two views:
 *
 *   openSheet(host, sheet, opts)      a D&D style sheet laid over the board
 *   openCreation(host, api, opts)     the stepper that makes a new hero
 *
 * Both are positioned absolutely inside `host` (a non-scrolling box that frames
 * the board, the same contract overlay.ts has), scroll inside themselves and
 * never add page scroll. Both look like the surface they sit on: storybook
 * (parchment and ink, serif, following the page theme) or pixel (the game's
 * navy frames and gold accents, a bitmap font for headings and a clean face for
 * reading).
 *
 * THE RULE OF THIS FILE (the owner's, "so the player is never confused"): every
 * number and every item has a hover tip, and the tip says exactly what it is and
 * how it was worked out. A tip never invents a number: it reads the engine's own
 * readers (session/combat.ts, menu/equipment.ts, inventory/itemInfo.ts) and
 * spells out the sum. And the game's honesty rule applies: a thing the engine
 * does not act on is labelled "The DM rules on this", never described as if it
 * worked.
 *
 * What is pure and unit tested (no DOM, so the bench registry can import this in
 * Node): every tip builder, the creation helpers (score methods, skill
 * reconciliation, error to step) and the sheet's feature list. Only the two
 * open* functions and the builders under "the DOM" touch the document, and only
 * when called.
 *
 * Contract with the Play lane:
 *   - the host passes portrait canvases in (the bench owns the art);
 *   - creation rolls the six ability scores through api.rollDice(6, 4, 6, ...)
 *     when the host gives one, so the dice tray can throw them, and falls back to
 *     rollAbilitySet (creation.ts) when it does not;
 *   - Begin hands back the sheet previewCharacter built and the exact input.
 */
import { abilityModifier } from "../../rules";
import type { AbilityScores } from "../../rules";
import {
  ABILITY_KEYS,
  ABILITY_SCORE_CAP,
  ALIGNMENTS,
  ANCESTRIES,
  BACKGROUND_NAME_MAX,
  BACKGROUND_TEXT_MAX,
  BACKSTORY_MAX,
  CLASS_SKILL_CHOICES,
  POINT_BUY_BUDGET,
  SKILL_ABILITY,
  STANDARD_ARRAY,
  creationChoicesFor,
  creationOptions,
  pointBuyCost,
  previewCharacter,
  rollAbilitySet,
  scoresFromDice,
  validateBaseScores,
  type AbilityMethod,
  type Ancestry,
  type Background,
  type CharacterSheet,
  type CreateCharacterInput,
  type RolledSet,
} from "../../characters/creation";
import { getAncestry } from "../../characters/ancestries";
import { PLAYABLE_ARCHETYPE_IDS, getArchetype } from "../../characters/templates";
import { MILESTONES_PER_LEVEL } from "../../characters/leveling";
import { APPLIES_LABEL, DM_RULES_LABEL, describeCarried, describeWorn, itemTipLines, packInfo, type ItemInfo } from "../../inventory/itemInfo";
import { ABILITY_NAME } from "../../menu/labels";
import {
  DEFAULT_SPEED_FT,
  attackBonusSourcesFor,
  attackerBonusFor,
  checkAdvantageFor,
  damageBonusSourcesFor,
  effectiveArmorClass,
  effectiveSpeedFt,
  saveModifierFor,
  skillModifierFor,
  speedBeforeBootsFt,
  weaponDamageNotationFor,
  weaponFor,
  weaponIdentityFor,
} from "../../session/combat";
import { armorDisplayLabel } from "../../menu/equipment";
import type { TextStyle } from "./overlay";
import { attachItemCard, attachTip, itemCardIsUp, type ItemCardContent, type TipContent } from "./tip";
import { pixelText } from "./pixelFont";

// ---- the public contract ----------------------------------------------------

export interface SheetExtras {
  /** Healing potions the host keeps itself; replaces the sheet's own Potion of healing uses in the equipment list. */
  potions?: number;
  /** The DM's own descriptions of things it handed over, by item name. */
  notes?: Readonly<Record<string, string>>;
  /** The hero's picture, drawn small in the header. Copied, never moved. */
  portrait?: HTMLCanvasElement | null;
}

/**
 * What the sheet hands `itemCard` and `onItemAction` for a thing in its equipment list: the section it is under ("Worn", "Bag",
 * "Carried", "Consumables"), a colon, and the item's name ("Worn:Chain shirt"). One name can appear under two sections, so the section
 * is part of the key.
 */
export function sheetItemKey(section: string, name: string): string {
  return `${section}:${name}`;
}

/** The part of openSheet's options that turns equipment chips into item cards. Without `itemCard` the chips keep their plain hover help. */
export interface SheetItemCards {
  /** The card for one chip (see sheetItemKey), read when the chip is drawn; null leaves that chip with plain hover help. The card's own content function is read each time it opens. */
  itemCard?: (key: string) => ItemCardContent | null;
  /** A button of a pinned card: the chip's key and the action's id. */
  onItemAction?: (key: string, actionId: string) => void;
}

export interface SheetView {
  update(sheet: CharacterSheet, extras?: SheetExtras): void;
  setStyle(style: TextStyle): void;
  close(): void;
  el: HTMLElement;
}

export interface CreationHost {
  style(): TextStyle;
  /** Throw `groups` sets of `count` dice with `sides` faces and resolve with every face. The host puts them in the dice tray. */
  rollDice?(groups: number, count: number, sides: number, label: string): Promise<number[][]>;
  /** A picture of a class, for its card. Copied, never moved. */
  portrait?(archetypeId: string): HTMLCanvasElement | null;
}

export interface CreationView {
  setStyle(style: TextStyle): void;
  close(): void;
  el: HTMLElement;
}

type AbilityKey = keyof AbilityScores;

// ---- words (own words, SRD 5.1 facts) ---------------------------------------

const ABILITY_ABBR: Record<AbilityKey, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

const ABILITY_USES: Record<AbilityKey, string> = {
  str: "Athletics, Strength saving throws, and the attack and damage of any weapon that runs on Strength.",
  dex: "Acrobatics, Sleight of Hand and Stealth, Dexterity saving throws, initiative, and your armor class where your armor allows it.",
  con: "Constitution saving throws and hit points: every hit die you have adds it.",
  int: "Arcana, History, Investigation, Nature and Religion, Intelligence saving throws, and a wizard's spells.",
  wis: "Animal Handling, Insight, Medicine, Perception and Survival, Wisdom saving throws, and a cleric's spells.",
  cha: "Deception, Intimidation, Performance and Persuasion, and Charisma saving throws.",
};

/** What each skill is for, one plain sentence each. */
export const SKILL_BLURB: Readonly<Record<string, string>> = Object.freeze({
  Acrobatics: "Staying on your feet on ice or a ledge, tumbling away, flipping past something.",
  "Animal Handling": "Calming a spooked horse, reading a beast's mood, steering a mount through trouble.",
  Arcana: "What you know about spells, magic items, strange symbols and the planes.",
  Athletics: "Climbing, swimming, jumping and heaving things around by strength.",
  Deception: "Lying convincingly, bluffing, keeping a disguise or a story straight.",
  History: "Recalling old wars, kings, lost cities and who built what.",
  Insight: "Telling when someone is lying, nervous or hiding something.",
  Intimidation: "Getting your way with a threat, a stare or a show of force.",
  Investigation: "Searching a room, piecing clues together, working out how a trap works.",
  Medicine: "Stabilising a dying friend, spotting a disease, reading a wound.",
  Nature: "What you know about terrain, plants, animals and the weather.",
  Perception: "Spotting, hearing or smelling what is there: an ambush, a hidden door, a footstep.",
  Performance: "Singing, acting, telling a story so a crowd listens.",
  Persuasion: "Winning someone over with honest argument, charm or good manners.",
  Religion: "What you know about gods, rites, holy symbols and the undead.",
  "Sleight of Hand": "Picking a pocket, planting a coin, palming a key, opening a lock quietly.",
  Stealth: "Moving unseen and unheard, hiding, slipping past a guard.",
  Survival: "Tracking, foraging, finding your way, reading the signs of a camp or a beast.",
});

/** Every skill the game knows, alphabetical. */
export const ALL_SKILLS: readonly string[] = Object.freeze(Object.keys(SKILL_ABILITY).sort());

const BACKGROUND_PREFERENCE = ["Perception", "Survival", "Persuasion", "Insight", "Investigation", "History", "Athletics", "Stealth", "Nature", "Religion"];

const ALIGNMENT_BLURB: Record<string, string> = {
  "Lawful Good": "Does the right thing and keeps the rules while doing it.",
  "Neutral Good": "Does good, and does not much mind who writes the rules.",
  "Chaotic Good": "Does good in their own way and answers to their own conscience.",
  "Lawful Neutral": "Follows the code, the law or the oath above all else.",
  Neutral: "Keeps balance, or simply stays out of the argument.",
  "Chaotic Neutral": "Follows a whim, and values freedom over everything.",
  "Lawful Evil": "Takes what they want by rules and bargains.",
  "Neutral Evil": "Looks after themselves, and cares little who pays for it.",
  "Chaotic Evil": "Takes what they want and breaks what is in the way.",
  Unaligned: "Has no settled leaning.",
};

const METHOD_WORDS: Record<AbilityMethod, string> = {
  archetype: "from your class's ready-made spread",
  standard: "from your standard array",
  pointBuy: "bought with point buy",
  rolled: "from your roll (four d6, the lowest die dropped)",
};

const METHOD_TITLE: Record<AbilityMethod, string> = {
  archetype: "Class default",
  standard: "Standard array",
  pointBuy: "Point buy",
  rolled: "Roll 4d6",
};

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n === 1 ? one : many;
}

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

function plainClassName(displayName: string): string {
  return displayName.replace(/^The\s+/i, "");
}

/** The class a sheet shows: the archetype's current name (a hero saved before the Shadow became the Rogue still reads Rogue), else the one stored with it. */
export function sheetClassName(sheet: Pick<CharacterSheet, "archetypeId" | "displayName">): string {
  try {
    return plainClassName(getArchetype(sheet.archetypeId).displayName);
  } catch {
    return plainClassName(sheet.displayName);
  }
}

function sources(parts: readonly { label: string; amount: number }[]): string {
  return parts.map((p) => `${signed(p.amount)} ${p.label}`).join(", ");
}

// ---- tips: every number says what it is and how it was worked out -----------

/** The 3 labels a tip's footer opens with. */
export function appliedLabel(applied: boolean): string {
  return applied ? APPLIES_LABEL : DM_RULES_LABEL;
}

/** "Strength 16: ..." where the score came from, the modifier sum and what it is used for. */
export function abilityTip(sheet: CharacterSheet, key: AbilityKey): TipContent {
  const score = sheet.abilities[key];
  const mod = sheet.modifiers[key];
  const base = sheet.baseScores?.[key];
  const method = sheet.abilityMethod;
  let origin: string;
  if (base === undefined) {
    origin = `Your class starts at ${score} here.`;
  } else if (score === base) {
    origin = `${base} ${method ? METHOD_WORDS[method] : "as made at creation"}.`;
  } else {
    const gain = score - base;
    origin = `${base} ${method ? METHOD_WORDS[method] : "as made at creation"}, ${signed(gain)} from ${sheet.ancestryName ?? "your ancestry or level-ups"}.`;
  }
  const lines = [`Where ${score} came from: ${origin}`, `Modifier ${signed(mod)} = (${score} - 10) / 2, rounded down. The modifier is the number that goes on your rolls; the score only makes it.`, `Used for: ${ABILITY_USES[key]}`];
  const weapon = weaponFor(sheet);
  if (weapon.ability === key) lines.push(`Your ${weaponIdentityFor(sheet).label} attack and damage run on this ability.`);
  return { title: `${ABILITY_NAME[key]} ${score}`, lines, footer: APPLIES_LABEL };
}

/** Where a trained skill came from, as far as the sheet can tell. */
function skillSource(sheet: CharacterSheet, skill: string): string {
  if (sheet.background?.skills.includes(skill)) return `your ${sheet.background.name} background`;
  const ancestry = sheet.ancestryId ? getAncestry(sheet.ancestryId) : undefined;
  if (ancestry?.skills?.includes(skill)) return `your ${ancestry.name} ancestry`;
  return "your class or ancestry choices";
}

export function skillTip(sheet: CharacterSheet, skill: string): TipContent {
  const ability = SKILL_ABILITY[skill];
  const total = skillModifierFor(sheet, skill);
  const trained = sheet.skills.find((s) => s.skill === skill);
  const mod = ability ? sheet.modifiers[ability] : 0;
  const lines: string[] = [SKILL_BLURB[skill] ?? "A skill the game knows."];
  const abilityWord = ability ? ABILITY_NAME[ability] : "its ability";
  if (trained) {
    const prof = trained.bonus - mod;
    lines.push(
      trained.expertise
        ? `${signed(trained.bonus)} = ${abilityWord} modifier ${signed(mod)} + ${prof} (your proficiency bonus counted twice: Expertise). Trained through ${skillSource(sheet, skill)}.`
        : `${signed(trained.bonus)} = ${abilityWord} modifier ${signed(mod)} + proficiency bonus ${signed(prof)}, because you are trained in it through ${skillSource(sheet, skill)}.`,
    );
  } else {
    lines.push(`${signed(mod)} = ${abilityWord} modifier ${signed(mod)}. You are not trained in it, so the proficiency bonus is not added.`);
  }
  const extra = total - (trained ? trained.bonus : mod);
  if (extra !== 0) lines.push(`A worn item adds ${signed(extra)} to every skill check, so the total is ${signed(total)}.`);
  const adv = checkAdvantageFor(sheet, skill);
  if (adv) lines.push(`Your ${adv} give you advantage on this skill: roll two d20 and keep the higher.`);
  lines.push("When the DM asks for a check you roll a d20 and add this number.");
  return { title: `${skill} ${signed(total)}`, lines, footer: APPLIES_LABEL };
}

export function saveTip(sheet: CharacterSheet, key: AbilityKey): TipContent {
  const total = saveModifierFor(sheet, key);
  const trained = sheet.saves.find((s) => s.ability === key);
  const mod = sheet.modifiers[key];
  const lines: string[] = [`A ${ABILITY_NAME[key]} saving throw is what you roll to resist something that forces you: a trap, a spell, a poison. You roll a d20 and add this number.`];
  if (trained) {
    lines.push(`${signed(trained.bonus)} = ${ABILITY_NAME[key]} modifier ${signed(mod)} + proficiency bonus ${signed(trained.bonus - mod)}, because your class trains this save.`);
  } else {
    lines.push(`${signed(mod)} = ${ABILITY_NAME[key]} modifier ${signed(mod)}. Your class does not train this save, so the proficiency bonus is not added.`);
  }
  const extra = total - (trained ? trained.bonus : mod);
  if (extra !== 0) lines.push(`Worn gear adds ${signed(extra)} to every saving throw, so the total is ${signed(total)}.`);
  return { title: `${ABILITY_NAME[key]} save ${signed(total)}`, lines, footer: APPLIES_LABEL };
}

export function armorClassTip(sheet: CharacterSheet): TipContent {
  const total = effectiveArmorClass(sheet);
  const base = sheet.armorClass;
  const gear = total - base;
  const lines = [`Armor class ${total}: an attack roll has to meet or beat this number to hit you.`];
  const defense = sheet.choices?.fightingStyle === "defense";
  lines.push(`${base} comes from your armor (${armorDisplayLabel(sheet)}) and your Dexterity modifier ${signed(sheet.modifiers.dex)} where that armor lets Dexterity count${defense ? ", plus 1 from the Defense fighting style" : ""}.`);
  if (gear !== 0) lines.push(`Worn magic gear adds ${signed(gear)}, which makes ${total}.`);
  return { title: `Armor class ${total}`, lines, footer: APPLIES_LABEL };
}

export function initiativeTip(sheet: CharacterSheet): TipContent {
  return {
    title: `Initiative ${signed(sheet.modifiers.dex)}`,
    lines: [`At the start of a fight everyone rolls a d20 and adds this number; the highest goes first. It is your Dexterity modifier (${signed(sheet.modifiers.dex)}), nothing more.`],
    footer: APPLIES_LABEL,
  };
}

export function speedTip(sheet: CharacterSheet): TipContent {
  const total = effectiveSpeedFt(sheet);
  const base = typeof sheet.speedFt === "number" && Number.isFinite(sheet.speedFt) && sheet.speedFt > 0 ? sheet.speedFt : DEFAULT_SPEED_FT;
  const before = speedBeforeBootsFt(sheet);
  const lines = [`Speed ${total} feet: how far you can walk on your turn.`];
  lines.push(`Base ${base} feet${sheet.ancestryName ? ` for a ${sheet.ancestryName}` : " (the game's default; this character has no ancestry)"}.`);
  if (base !== before) lines.push(`Your armor takes ${base - before} feet off, which leaves ${before}.`);
  if (total !== before) lines.push(`Your boots change ${before} feet into ${total}.`);
  return { title: `Speed ${total} ft`, lines, footer: APPLIES_LABEL };
}

export function proficiencyTip(sheet: CharacterSheet): TipContent {
  return {
    title: `Proficiency bonus ${signed(sheet.proficiencyBonus)}`,
    lines: [
      `A bonus added to every attack, saving throw and skill you are trained in. It depends only on your level: +2 at levels 1 to 4, +3 at 5 to 8, and so on. You are level ${sheet.level}.`,
    ],
    footer: APPLIES_LABEL,
  };
}

export function passivePerceptionTip(sheet: CharacterSheet): TipContent {
  const perception = skillModifierFor(sheet, "Perception");
  return {
    title: `Passive Perception ${10 + perception}`,
    lines: [`10 + your Perception bonus (${signed(perception)}) = ${10 + perception}. It is what you notice without trying, such as a hidden door or someone creeping up.`, "The game never rolls against this number."],
    footer: DM_RULES_LABEL,
  };
}

export function hitPointsTip(sheet: CharacterSheet): TipContent {
  const con = sheet.modifiers.con;
  const ancestry = sheet.ancestryId ? getAncestry(sheet.ancestryId) : undefined;
  const bonus = ancestry?.hpPerLevel ?? 0;
  const lines = [`Hit points ${sheet.currentHp} of ${sheet.maxHp}. Damage takes them away; healing and rest give them back, never past ${sheet.maxHp}.`];
  const levelOne = Math.max(1, sheet.hitDieSides + con + bonus);
  if (sheet.level === 1 && levelOne === sheet.maxHp) {
    lines.push(`Maximum ${sheet.maxHp} = your hit die's top face (d${sheet.hitDieSides}, so ${sheet.hitDieSides}) + Constitution modifier ${signed(con)}${bonus ? ` + ${bonus} from ${ancestry?.name}` : ""}.`);
  } else {
    const avg = Math.floor(sheet.hitDieSides / 2) + 1;
    lines.push(`Level 1 gave the top face of a d${sheet.hitDieSides} + Constitution modifier. Each level after that adds the die's average (${avg}) + Constitution modifier, never less than 1.`);
  }
  lines.push("At 0 hit points you fall unconscious and start rolling death saves.");
  return { title: `Hit points ${sheet.currentHp} / ${sheet.maxHp}`, lines, footer: APPLIES_LABEL };
}

export function hitDiceTip(sheet: CharacterSheet): TipContent {
  return {
    title: `Hit dice ${sheet.hitDiceRemaining}d${sheet.hitDieSides}`,
    lines: [
      `You have ${sheet.hitDiceRemaining} of ${sheet.level} hit ${plural(sheet.level, "die", "dice")} left, each a d${sheet.hitDieSides}.`,
      `When you catch your breath you spend one: roll it, add your Constitution modifier (${signed(sheet.modifiers.con)}) and heal that many hit points. A long rest gives them all back.`,
    ],
    footer: APPLIES_LABEL,
  };
}

export function deathSavesTip(sheet: CharacterSheet): TipContent {
  const { successes, failures } = sheet.deathSaves;
  return {
    title: "Death saves",
    lines: [
      `At 0 hit points you roll a d20 on your turn with no modifiers: 10 or more is a success, less is a failure. Three successes and you are stable; three failures and the character is gone. Taking damage while down is a failure too.`,
      `Now: ${successes} of 3 successes, ${failures} of 3 failures.`,
    ],
    footer: APPLIES_LABEL,
  };
}

export function attackNameTip(sheet: CharacterSheet): TipContent {
  const w = weaponFor(sheet);
  const id = weaponIdentityFor(sheet);
  const worn = describeWorn(sheet, "weapon");
  const lines = [`${w.ranged ? "A ranged" : "A melee"} attack, ${w.hands} ${plural(w.hands, "hand")} to use. Runs on ${ABILITY_NAME[w.ability]}.`];
  if (id.differs) lines.push(`The game rolls your ${w.name}; the item in your weapon slot is ${id.itemName}.`);
  if (worn) lines.push(`${worn.summary}`);
  return { title: id.label, lines, footer: APPLIES_LABEL };
}

export function toHitTip(sheet: CharacterSheet): TipContent {
  const total = attackerBonusFor(sheet);
  const parts = attackBonusSourcesFor(sheet);
  return {
    title: `To hit ${signed(total)}`,
    lines: [`${signed(total)} = ${sources(parts)}.`, "Roll a d20 and add it; if the total meets or beats the target's armor class, you hit. A natural 20 is a critical hit."],
    footer: APPLIES_LABEL,
  };
}

export function damageTip(sheet: CharacterSheet): TipContent {
  const w = weaponFor(sheet);
  const notation = weaponDamageNotationFor(sheet);
  const parts = damageBonusSourcesFor(sheet);
  return {
    title: `Damage ${notation}`,
    lines: [`Roll one ${w.damageDie} and add ${sources(parts)}.`, "A critical hit rolls the die twice."],
    footer: APPLIES_LABEL,
  };
}

export function spellSlotTip(spellLevel: number, max: number, used: number): TipContent {
  return {
    title: `${ordinal(spellLevel)} level slots ${max - used} of ${max}`,
    lines: [
      `You have ${max} ${ordinal(spellLevel)} level ${plural(max, "slot")} and ${used} ${plural(used, "is", "are")} spent. Casting a spell spends one slot of its level or higher. A long rest restores them all.`,
    ],
    footer: APPLIES_LABEL,
  };
}

/** One entry in the sheet's features list. */
export interface FeatureEntry {
  name: string;
  text: string;
  /** True when the engine applies it; false when the DM rules on it. */
  applied: boolean;
  source: string;
}

/**
 * The features and traits on a sheet: what the class choices did (read off
 * appliedEffects, which line up with the choices the sheet carries), then the
 * ancestry's traits, each with whether the engine applies it.
 */
export function featureList(sheet: CharacterSheet): FeatureEntry[] {
  const out: FeatureEntry[] = [];
  const effects = sheet.appliedEffects ?? [];
  const skillNames = sheet.skills.map((s) => s.skill);
  let options: ReturnType<typeof creationChoicesFor> = [];
  try {
    options = creationChoicesFor(sheet.archetypeId, skillNames);
  } catch {
    options = [];
  }
  const creationIds = ["fightingStyle", "expertiseSkill"].filter((id) => sheet.choices?.[id] !== undefined);
  effects.forEach((effect, i) => {
    const id = creationIds[i];
    if (id !== undefined) {
      const choice = options.find((c) => c.id === id);
      const option = choice?.options.find((o) => o.id === sheet.choices[id]);
      const kind = id === "fightingStyle" ? "Fighting style" : "Expertise";
      out.push({ name: `${kind}: ${option?.label ?? sheet.choices[id]}`, text: effect.plain, applied: !option?.notYet, source: "Class" });
      return;
    }
    const colon = effect.plain.indexOf(": ");
    const named = colon > 0 && colon < 40 ? effect.plain.slice(0, colon) : "Level feature";
    out.push({ name: named, text: colon > 0 && colon < 40 ? effect.plain.slice(colon + 2) : effect.plain, applied: true, source: "Level up" });
  });
  for (const t of sheet.traits ?? []) out.push({ name: t.name, text: t.text, applied: t.applied, source: t.source });
  return out;
}

export function featureTip(f: FeatureEntry): TipContent {
  return { title: f.name, lines: [f.text, `From: ${f.source}.`], footer: appliedLabel(f.applied) };
}

/** A hover tip for one entry of packInfo. */
export function itemTip(info: ItemInfo): TipContent {
  const lines = [...itemTipLines(info).slice(0, -1)];
  if (info.source) lines.push(`Source: ${info.source}.`);
  return { title: info.name, lines, footer: info.inGame };
}

/** "x2" or "3 left" style count for an item chip, read off its facts. */
export function itemCount(info: ItemInfo): string {
  for (const f of info.facts) {
    const carry = /^You carry (\d+)\./.exec(f);
    if (carry) return `x${carry[1]}`;
    const left = /^Uses left: (\d+)\./.exec(f);
    if (left) return `x${left[1]}`;
  }
  return "";
}

// ---- the creation helpers (pure) ---------------------------------------------

export type StepId = "class" | "ancestry" | "scores" | "skills" | "background" | "name" | "review";
export const CREATION_STEPS: readonly { id: StepId; label: string }[] = Object.freeze([
  { id: "name", label: "Name" },
  { id: "class", label: "Class" },
  { id: "ancestry", label: "Ancestry" },
  { id: "scores", label: "Scores" },
  { id: "skills", label: "Skills" },
  { id: "background", label: "Background" },
  { id: "review", label: "Review" },
]);

/** The line under the step tabs on a phone, where the tabs show only their numbers: "Step 2 of 7: Class". An index out of range is clamped. */
export function stepCaption(index: number): string {
  const i = Math.max(0, Math.min(CREATION_STEPS.length - 1, Math.floor(index)));
  return `Step ${i + 1} of ${CREATION_STEPS.length}: ${CREATION_STEPS[i]!.label}`;
}

/** True when the draft has a name once the spaces are gone: the one thing every other step waits for. */
export function hasName(input: Pick<CreateCharacterInput, "name">): boolean {
  return typeof input.name === "string" && input.name.trim().length > 0;
}

/** Which step an error from previewCharacter belongs to, so the words show next to the thing that caused them. */
export function stepForError(message: string): StepId {
  const m = message.toLowerCase();
  if (/appearance/.test(m)) return "class";
  if (/^a background/.test(m)) return "background";
  if (/needs a name|name is at most/.test(m)) return "name";
  if (/backstory/.test(m)) return "name";
  if (/alignment/.test(m)) return "background";
  if (/comes from both|picked twice|class skills|skill list|trains exactly \d+ skills|free skills|not one of this/.test(m)) return "skills";
  if (/background/.test(m)) return "background";
  if (/ability score|standard array|point buy|points and you|rolled|roll your|ways? to make/.test(m)) return "scores";
  if (/ancestry|free bonus|different abilities|free ability/.test(m)) return "ancestry";
  if (/archetype|fighting style|class choice/.test(m)) return "class";
  return "review";
}

/** The cost of one point-buy score, or null when it is outside 8 to 15. */
export function pointCost(score: number): number | null {
  return pointBuyCost({ str: score, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
}

/** The ancestry's increases for a creation input: the fixed ones plus the player's free picks. */
export function ancestryIncreaseFor(ancestry: Ancestry | undefined, picks: readonly AbilityKey[] | undefined): Partial<Record<AbilityKey, number>> {
  const inc: Partial<Record<AbilityKey, number>> = { ...(ancestry?.abilityIncreases ?? {}) };
  if (ancestry?.chooseIncreases && picks) for (const k of picks) inc[k] = (inc[k] ?? 0) + ancestry.chooseIncreases.amount;
  return inc;
}

/** The six final scores for base scores and an ancestry, with the same ceiling the engine uses. */
export function finalScores(base: AbilityScores, ancestry: Ancestry | undefined, picks?: readonly AbilityKey[]): AbilityScores {
  const inc = ancestryIncreaseFor(ancestry, picks);
  const out = { ...base };
  for (const k of ABILITY_KEYS) out[k] = Math.min(ABILITY_SCORE_CAP, base[k] + (inc[k] ?? 0));
  return out;
}

/** Standard array assignment by dropdown or swap: give `key` the value `value`; whoever held it gets the value `key` had. Always a legal permutation. */
export function swapScore(scores: AbilityScores, key: AbilityKey, value: number): AbilityScores {
  const out = { ...scores };
  const holder = ABILITY_KEYS.find((k) => k !== key && out[k] === value);
  const old = out[key];
  out[key] = value;
  if (holder) out[holder] = old;
  return out;
}

/** Point buy: change one score by +1 or -1 when the result stays within 8 to 15 and the budget. Otherwise the scores come back unchanged. */
export function adjustPointBuy(scores: AbilityScores, key: AbilityKey, delta: 1 | -1): AbilityScores {
  const next = { ...scores, [key]: scores[key] + delta };
  const cost = pointBuyCost(next);
  return cost !== null && cost <= POINT_BUY_BUDGET ? next : scores;
}

/** Hand six rolled totals out in the class's own priority order (its best ability gets the best roll). Returns, for each ability in ABILITY_KEYS order, the index into `scores` it got. */
export function assignRolledByPriority(archetypeId: string, scores: readonly number[]): number[] {
  const archetype = getArchetype(archetypeId);
  const order = [...ABILITY_KEYS].sort((a, b) => archetype.baseAbilityScores[b] - archetype.baseAbilityScores[a]);
  const idx = scores.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]! || a - b);
  const out = new Array<number>(6).fill(0);
  order.forEach((key, rank) => {
    out[ABILITY_KEYS.indexOf(key)] = idx[rank] ?? rank;
  });
  return out;
}

/** The six base scores an assignment makes: ability i gets scores[assign[i]]. */
export function scoresFromAssign(scores: readonly number[], assign: readonly number[]): AbilityScores {
  const out = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  ABILITY_KEYS.forEach((k, i) => {
    out[k] = scores[assign[i] ?? i] ?? 8;
  });
  return out;
}

/** Give ability `abilityIndex` the rolled value at `rolledIndex`; whoever held that one gets the one this ability had. */
export function swapAssign(assign: readonly number[], abilityIndex: number, rolledIndex: number): number[] {
  const out = [...assign];
  const holder = out.findIndex((r, i) => i !== abilityIndex && r === rolledIndex);
  const old = out[abilityIndex]!;
  out[abilityIndex] = rolledIndex;
  if (holder >= 0) out[holder] = old;
  return out;
}

/** One group of four dice: the total of the best three and the index of the die that is dropped (the first lowest). */
export function dropLowest(group: readonly number[]): { total: number; dropped: number } {
  let dropped = 0;
  group.forEach((d, i) => {
    if (d < group[dropped]!) dropped = i;
  });
  return { total: group.reduce((a, b) => a + b, 0) - (group[dropped] ?? 0), dropped };
}

/** A set of dice that is six groups of four faces from 1 to 6, whatever the host sent back. */
export function validDiceGroups(groups: unknown): groups is number[][] {
  return (
    Array.isArray(groups) &&
    groups.length === 6 &&
    groups.every((g) => Array.isArray(g) && g.length === 4 && g.every((d) => Number.isInteger(d) && d >= 1 && d <= 6))
  );
}

/** Where every trained skill of a draft comes from: skill to "class" | "ancestry" | "background". */
export function skillSourcesOf(input: CreateCharacterInput): Map<string, "class" | "ancestry" | "background"> {
  const map = new Map<string, "class" | "ancestry" | "background">();
  const ancestry = input.ancestryId !== undefined ? getAncestry(input.ancestryId) : undefined;
  for (const s of ancestry?.skills ?? []) map.set(s, "ancestry");
  for (const s of input.ancestrySkills ?? []) map.set(s, "ancestry");
  for (const s of input.classSkills ?? []) map.set(s, "class");
  for (const s of input.background?.skills ?? []) map.set(s, "background");
  return map;
}

function uniqueFrom(list: readonly string[] | undefined, allowed: (s: string) => boolean, taken: Set<string>): string[] {
  const out: string[] = [];
  for (const s of list ?? []) {
    if (allowed(s) && !taken.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Make a draft valid: every collision between class, ancestry and background
 * skills resolved by moving the later pick to the next free skill, the free
 * ancestry picks filled in, the scores kept only while their method accepts
 * them, and the class choices kept only while they are still on offer. The
 * result always passes previewCharacter (a test holds it to that for every
 * playable class against every ancestry), so a click on the wizard can never
 * leave it in a state it cannot leave. Priority, highest first: the ancestry's
 * fixed skills, the class picks, the ancestry's free picks, the background.
 */
export function reconcileDraft(input: CreateCharacterInput): CreateCharacterInput {
  const archetype = getArchetype(input.archetypeId);
  const rule = CLASS_SKILL_CHOICES[archetype.chassis];
  const ancestry = input.ancestryId !== undefined ? getAncestry(input.ancestryId) : undefined;
  const out: CreateCharacterInput = { ...input };

  // scores
  const fallback: AbilityScores = { ...archetype.baseAbilityScores };
  let method: AbilityMethod = input.abilityMethod ?? "archetype";
  let base: AbilityScores = input.baseScores ? { ...input.baseScores } : { ...fallback };
  if (method === "archetype") base = fallback;
  else if (validateBaseScores(method, base, input.rolledScores) !== null) {
    method = "archetype";
    base = fallback;
  }
  out.abilityMethod = method;
  out.baseScores = base;
  out.rolledScores = method === "rolled" ? [...(input.rolledScores ?? [])] : undefined;

  // ancestry increases
  if (ancestry?.chooseIncreases) {
    const rule2 = ancestry.chooseIncreases;
    const picks = (input.ancestryIncreases ?? []).filter((k, i, a) => ABILITY_KEYS.includes(k) && !rule2.exclude.includes(k) && a.indexOf(k) === i);
    const rest = [...ABILITY_KEYS].filter((k) => !rule2.exclude.includes(k) && !picks.includes(k)).sort((a, b) => base[b] - base[a]);
    out.ancestryIncreases = [...picks, ...rest].slice(0, rule2.count);
  } else {
    out.ancestryIncreases = undefined;
  }

  // skills, in priority order
  const taken = new Set<string>(ancestry?.skills ?? []);
  const classPicks = uniqueFrom(input.classSkills, (s) => rule.from.includes(s), taken);
  // A pick that has to be filled in avoids the skills the background already holds, so adding an ancestry or switching class does not quietly move them.
  const reserved = new Set(uniqueFrom(input.background?.skills, (s) => ALL_SKILLS.includes(s), new Set<string>()).slice(0, 2));
  const pad = (picks: string[], count: number, candidates: readonly string[]): void => {
    for (const avoid of [true, false]) {
      for (const s of candidates) {
        if (picks.length >= count) return;
        if (taken.has(s) || picks.includes(s) || !ALL_SKILLS.includes(s)) continue;
        if (avoid && reserved.has(s)) continue;
        picks.push(s);
      }
    }
  };
  pad(classPicks, rule.count, [...archetype.startingProficiencies.skills, ...rule.from].filter((s) => rule.from.includes(s)));
  out.classSkills = classPicks.slice(0, rule.count);
  for (const s of out.classSkills) taken.add(s);

  if (ancestry?.chooseSkills) {
    const picks = uniqueFrom(input.ancestrySkills, (s) => ALL_SKILLS.includes(s), taken);
    pad(picks, ancestry.chooseSkills, [...BACKGROUND_PREFERENCE, ...ALL_SKILLS]);
    out.ancestrySkills = picks.slice(0, ancestry.chooseSkills);
    for (const s of out.ancestrySkills) taken.add(s);
  } else {
    out.ancestrySkills = undefined;
  }

  if (input.background) {
    const picks = uniqueFrom(input.background.skills, (s) => ALL_SKILLS.includes(s), taken).slice(0, 2);
    pad(picks, 2, [...BACKGROUND_PREFERENCE, ...ALL_SKILLS]);
    out.background = { ...input.background, skills: [picks[0]!, picks[1]!] };
  }

  // class choices
  const known = out.classSkills.concat(ancestry?.skills ?? [], out.ancestrySkills ?? [], out.background?.skills ?? []);
  const choices: Record<string, string> = {};
  for (const choice of creationChoicesFor(archetype.id, known, input.startingKit)) {
    const wanted = input.choices?.[choice.id];
    choices[choice.id] = choice.options.some((o) => o.id === wanted) ? wanted! : choice.options[0]!.id;
  }
  out.choices = choices;
  return out;
}

/**
 * The input a fresh wizard starts with: the class's defaults, Human, a "Wanderer" background and a neutral alignment, already reconciled.
 * The name starts empty on purpose: the player has to give one (previewCharacter refuses a draft without), and it is the first step.
 */
export function initialDraft(start?: Partial<CreateCharacterInput>): CreateCharacterInput {
  const wanted = start?.archetypeId;
  let archetypeId: string = PLAYABLE_ARCHETYPE_IDS[0] ?? "knight";
  if (wanted) {
    try {
      archetypeId = getArchetype(wanted).id;
    } catch {
      /* an unknown class: the first playable one */
    }
  }
  const defaults = creationOptions(archetypeId).defaults;
  const merged: CreateCharacterInput = {
    ...defaults,
    name: "",
    background: { name: "Wanderer", skills: ["Perception", "Survival"] },
    alignment: "Neutral",
    ...start,
    archetypeId,
  };
  return reconcileDraft(merged);
}

const BLANK_SCORES: AbilityScores = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };

/**
 * Start again from a class: its own scores, Human, a Wanderer background, its own skills and choices. The name and the backstory the player typed are kept.
 * Everything stays editable afterwards.
 */
export function startFromClass(input: CreateCharacterInput, archetypeId: string): CreateCharacterInput {
  const fresh = initialDraft({ archetypeId, name: input.name });
  const out: CreateCharacterInput = { ...fresh };
  if (input.backstory !== undefined) out.backstory = input.backstory;
  // The adventure's starting kit goes with the draft, whichever class it is.
  if (input.startingKit !== undefined) out.startingKit = input.startingKit;
  return reconcileDraft(out);
}

/**
 * A blank sheet of the draft's class: every score at 8 (point buy, nothing spent), no ancestry, no background, no alignment. The class is
 * still there for its hit die and gear, and its skill picks are filled in because the rules want them (the Skills step changes them).
 */
export function blankDraft(input: CreateCharacterInput): CreateCharacterInput {
  const out: CreateCharacterInput = {
    ...input,
    abilityMethod: "pointBuy",
    baseScores: { ...BLANK_SCORES },
    rolledScores: undefined,
    ancestryId: undefined,
    ancestrySkills: undefined,
    ancestryIncreases: undefined,
    background: undefined,
    alignment: undefined,
    classSkills: [],
    choices: {},
  };
  return reconcileDraft(out);
}

/** Whether a draft is still the blank sheet blankDraft makes (the Start from step shows the Blank card as picked while it is). */
export function looksBlank(input: CreateCharacterInput): boolean {
  const s = input.baseScores;
  return input.abilityMethod === "pointBuy" && !!s && ABILITY_KEYS.every((k) => s[k] === 8) && input.ancestryId === undefined && !input.background;
}

// ---- the DOM ----------------------------------------------------------------

interface Ctx {
  style(): TextStyle;
  /** What tips stay inside: the game window. */
  bound(): HTMLElement;
  /** The width the view has, for wrapping bitmap text. */
  width(): number;
  offs: Array<() => void>;
  /** Equipment chips become item cards when the host supplies them (openSheet only; the creation review leaves them plain). */
  cards?: SheetItemCards;
}

const STYLE_ID = "lt-sheet-style";
const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const SB_LIGHT = "--s-bg:#efe3c4;--s-panel:#f8f0da;--s-ink:#2a2016;--s-muted:#6a5a3f;--s-edge:#7c5c1e;--s-accent:#8a5208;--s-onaccent:#fff8e6;--s-good:#2a6a33;--s-bad:#a5281c;--s-warn:#94560b;--s-soft:#e8d8b0;--s-focus:#1d63e0";
const SB_DARK = "--s-bg:#181526;--s-panel:#25203a;--s-ink:#f3e9cf;--s-muted:#b6ab90;--s-edge:#c79d45;--s-accent:#ffd27a;--s-onaccent:#1d1608;--s-good:#86e096;--s-bad:#ff8c7a;--s-warn:#ffb454;--s-soft:#312b4d;--s-focus:#8db7ff";
const PX_VARS = "--s-bg:#0a0e2a;--s-panel:#141a3c;--s-ink:#f4ecd0;--s-muted:#98a5d8;--s-edge:#4d5da6;--s-accent:#ffc72a;--s-onaccent:#1b1300;--s-good:#59dd82;--s-bad:#ff5a4a;--s-warn:#ffb454;--s-soft:#1f2858;--s-focus:#8db7ff";

const CSS = `
.lts-root{${SB_LIGHT};position:absolute;inset:0;z-index:40;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;background:var(--s-bg);color:var(--s-ink);font:14px/1.4 ${SERIF};text-align:left;container-type:inline-size;scrollbar-width:thin}
.lts-root[data-style="storybook"]{font-family:${SERIF}}
.lts-root.lts-embed{position:relative;inset:auto;z-index:auto;overflow:visible;background:transparent}
.lts-root[data-style="pixel"]{${PX_VARS};font-family:${SANS};font-size:13.5px}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lts-root[data-style="storybook"]{${SB_DARK}}}
:root[data-theme="dark"] .lts-root[data-style="storybook"]{${SB_DARK}}
.lts-root *{box-sizing:border-box}
.lts-root button,.lts-root select,.lts-root input,.lts-root textarea{font:inherit;color:inherit}
.lts-root :focus-visible{outline:2px solid var(--s-focus);outline-offset:2px}
.lts-root canvas{max-width:100%}
.lts-root[data-style="storybook"] :is(.lts-rowl .v,.lts-atk .c,.lts-abil .s,.lts-table .c,.lts-table .v,.lts-ctl .v,.lts-pair b,.lts-hpnum,.lts-stat .v,.lts-roll,.lts-skill .b,.lts-item .k,.lts-sel,.lts-field .v,.lts-meter,.lts-budget b){font-family:"Palatino Linotype","Book Antiqua",Palatino,"Times New Roman",Georgia,serif}
.lts-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lts-muted{color:var(--s-muted)}
.lts-grow{flex:1;min-width:0}

.lts-btn{appearance:none;cursor:pointer;min-height:34px;padding:5px 12px;background:var(--s-soft);color:var(--s-ink);border:1px solid var(--s-edge);border-radius:7px;font-weight:700;line-height:1.2}
.lts-btn:hover:not(:disabled){filter:brightness(1.08)}
.lts-btn:disabled{opacity:.45;cursor:default}
.lts-btn.pri{background:var(--s-accent);color:var(--s-onaccent);border-color:var(--s-accent)}
.lts-btn.sq{min-width:34px;padding:5px 8px}
.lts-root[data-style="pixel"] .lts-btn{border-width:2px;border-radius:0;box-shadow:0 0 0 2px #05061a}
.lts-root[data-style="pixel"] .lts-btn.pri{border-color:#fff3ad}

.lts-card{background:var(--s-panel);border:1px solid var(--s-edge);border-radius:9px;padding:9px 11px;min-width:0}
.lts-root[data-style="pixel"] .lts-card{border:2px solid var(--s-edge);border-radius:0;box-shadow:0 0 0 2px #05061a,inset 0 0 0 1px #2c3874}
.lts-root[data-style="storybook"] .lts-card{box-shadow:inset 0 0 0 1px var(--s-panel),inset 0 0 0 2px color-mix(in srgb,var(--s-edge) 45%,transparent)}

.lts-h{margin:0 0 6px;font-weight:700;color:var(--s-accent);font-size:12px;letter-spacing:.09em;text-transform:uppercase;line-height:1.25}
.lts-root[data-style="pixel"] .lts-h{text-transform:none;letter-spacing:0;font-size:inherit}
.lts-title{margin:0 0 4px;font-weight:700;font-size:22px;line-height:1.15;color:var(--s-ink);overflow-wrap:anywhere}
.lts-root[data-style="pixel"] .lts-title{font-size:inherit}
.lts-h canvas,.lts-title canvas{display:block}
.lts-big{font-weight:700;font-variant-numeric:lining-nums tabular-nums;font-family:"Palatino Linotype","Book Antiqua",Palatino,"Times New Roman",serif}

.lts-topbar{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--s-bg);border-bottom:1px solid var(--s-edge)}
.lts-root[data-style="pixel"] .lts-topbar{border-bottom:2px solid var(--s-edge)}
.lts-topbar .lts-h{margin:0}
.lts-sheet{display:flex;flex-direction:column;gap:10px;padding:10px 10px 22px;max-width:760px;margin:0 auto}

.lts-head{display:flex;gap:10px;align-items:center}
.lts-portrait{flex:none;width:72px;height:72px;display:flex;align-items:center;justify-content:center;background:var(--s-soft);border:1px solid var(--s-edge);overflow:hidden}
.lts-portrait canvas{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
.lts-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:4px 10px;margin-top:6px}
.lts-field{min-width:0;padding:2px 0}
.lts-field .l{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--s-muted)}
.lts-field .v{display:block;font-weight:700;overflow-wrap:anywhere}

.lts-abils{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:6px}
.lts-abil{text-align:center;padding:6px 2px 8px}
.lts-abil .l{display:block;font-size:10px;letter-spacing:.02em;text-transform:uppercase;color:var(--s-muted);font-weight:700;overflow-wrap:normal;white-space:nowrap}
.lts-abil .m{display:block;font-size:28px;line-height:1.15;min-height:34px;display:flex;align-items:center;justify-content:center}
.lts-abil .s{display:inline-block;min-width:34px;padding:1px 8px;border:1px solid var(--s-edge);border-radius:99px;background:var(--s-soft);font-weight:700;font-variant-numeric:tabular-nums}
.lts-root[data-style="pixel"] .lts-abil .s{border-radius:0;border-width:2px}

.lts-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:6px}
.lts-stat{text-align:center;padding:6px 4px}
.lts-stat .l{display:block;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--s-muted)}
.lts-stat .v{display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1.15;min-height:30px;font-weight:700;font-variant-numeric:lining-nums tabular-nums}

.lts-vitals{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.lts-hpbar{height:10px;margin-top:6px;background:var(--s-soft);border:1px solid var(--s-edge);overflow:hidden}
.lts-hpbar i{display:block;height:100%;background:var(--s-good)}
.lts-hpnum{display:flex;align-items:baseline;gap:6px;font-weight:700}
.lts-hpnum .n{font-size:24px;font-variant-numeric:lining-nums tabular-nums}
.lts-dots{display:inline-flex;gap:5px;align-items:center;margin-left:6px;vertical-align:middle}
.lts-dot{width:12px;height:12px;border-radius:50%;border:2px solid var(--s-edge)}
.lts-dot.on.ok{background:var(--s-good);border-color:var(--s-good)}
.lts-dot.on.bad{background:var(--s-bad);border-color:var(--s-bad)}
.lts-root[data-style="pixel"] .lts-dot{border-radius:0}
.lts-pair{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0}
.lts-pair .l{color:var(--s-muted);font-size:12.5px}

.lts-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(262px,1fr));gap:10px;align-items:start}
.lts-col{display:flex;flex-direction:column;gap:10px;min-width:0}
.lts-rowl{display:flex;align-items:center;gap:8px;padding:3px 4px;border-radius:5px;min-width:0}
.lts-rowl:hover{background:var(--s-soft)}
.lts-rowl .n{overflow-wrap:anywhere}
.lts-rowl .a{color:var(--s-muted);font-size:11px;letter-spacing:.05em}
.lts-rowl .v{margin-left:auto;font-weight:700;font-variant-numeric:lining-nums tabular-nums;min-width:2.2em;text-align:right}
.lts-mark{flex:none;width:11px;height:11px;border-radius:50%;border:2px solid var(--s-edge)}
.lts-mark.on{background:var(--s-accent);border-color:var(--s-accent)}
.lts-mark.exp{box-shadow:0 0 0 2px var(--s-panel),0 0 0 4px var(--s-accent)}
.lts-root[data-style="pixel"] .lts-mark{border-radius:0}
.lts-badge{flex:none;font-size:10.5px;line-height:1.2;padding:1px 6px;border:1px solid currentColor;border-radius:99px;white-space:nowrap}
.lts-badge.game{color:var(--s-good)}
.lts-badge.dm{color:var(--s-warn)}
.lts-root[data-style="pixel"] .lts-badge{border-radius:0}

.lts-atk{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px 10px;align-items:center}
.lts-atk .hd{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--s-muted)}
.lts-atk .c{font-weight:700;font-variant-numeric:lining-nums tabular-nums;padding:2px 4px;border-radius:5px}
.lts-atk .c:hover{background:var(--s-soft)}

.lts-feat{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.lts-feat li{padding:3px 4px;border-radius:5px}
.lts-feat li:hover{background:var(--s-soft)}
.lts-feat .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lts-feat .top b{overflow-wrap:anywhere}
.lts-feat .tx{display:block;font-size:12.5px;color:var(--s-muted);margin-top:1px}

.lts-eqsec{margin-bottom:6px}
.lts-eqsec .lab{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--s-muted);margin-bottom:3px}
.lts-chips{display:flex;flex-wrap:wrap;gap:5px}
.lts-item{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:3px 9px;background:var(--s-soft);border:1px solid var(--s-edge);border-radius:99px;overflow-wrap:anywhere}
.lts-item .k{color:var(--s-muted);font-size:12px}
.lts-item[data-lt-card]{cursor:pointer}
.lts-root[data-style="pixel"] .lts-item{border-radius:0;border-width:2px}

.lts-pers{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.lts-pers p,.lts-story{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.lts-empty{color:var(--s-muted);font-style:italic}

/* creation */
.lts-root.lts-cre{display:flex;flex-direction:column;overflow:hidden}
.lts-cre-head{flex:none;padding:8px 10px 6px;border-bottom:1px solid var(--s-edge);background:var(--s-bg)}
.lts-root[data-style="pixel"] .lts-cre-head{border-bottom:2px solid var(--s-edge)}
.lts-cre-top{display:flex;align-items:center;gap:8px}
.lts-steps{display:flex;gap:4px;margin-top:6px}
.lts-step{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;padding:5px 3px;background:var(--s-panel);border:1px solid var(--s-edge);border-radius:6px;cursor:pointer;font-size:12.5px;line-height:1.1}
.lts-step .n{font-weight:700}
.lts-step .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lts-step.on{background:var(--s-accent);color:var(--s-onaccent);border-color:var(--s-accent);font-weight:700}
.lts-step.bad::after{content:"!";font-weight:700;color:var(--s-bad);background:var(--s-panel);border-radius:99px;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-size:11px}
.lts-root[data-style="pixel"] .lts-step{border-radius:0;border-width:2px}
@container (max-width:700px){.lts-step:not(.on) .t{display:none}.lts-step .n{display:inline}.lts-step.on{flex:3 1 0}}
@media (pointer:coarse),(max-width:720px){.lts-btn,.lts-step,.lts-tab{min-height:44px}.lts-btn.sq,.lts-step{min-width:44px}.lts-root .lts-sel,.lts-root .lts-input,.lts-root .lts-item[data-lt-card]{min-height:44px}}
.lts-step-cap{display:none;margin-top:4px;font-size:12.5px;line-height:1.2;color:var(--s-muted)}
/* a phone: seven numbered tabs in ONE row of 44 px targets (the name of the step is the line under them) */
@container (max-width:520px){
  .lts-root .lts-cre-head{padding-inline:4px}
  .lts-root .lts-cre-top{padding-inline:6px}
  .lts-root .lts-steps{display:grid;grid-template-columns:repeat(7,minmax(44px,1fr));gap:0}
  .lts-root .lts-step{min-width:44px;min-height:44px;padding:5px 0}
  .lts-root .lts-step+.lts-step{margin-left:-1px}
  .lts-step-cap{padding-inline:6px}
  .lts-root .lts-step .t{display:none}
  .lts-root .lts-step .n{display:inline}
  .lts-root .lts-step.bad::after{width:12px;height:12px;font-size:10px}
  .lts-step-cap{display:block}
}
.lts-cre-body{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;padding:10px 10px 14px;overscroll-behavior:contain;scrollbar-width:thin}
.lts-cre-inner{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
/* Back, Next and Begin sit under the content, not at the far edges of a wide window */
.lts-cre-head,.lts-cre-foot{padding-inline:max(10px,calc((100% - 760px)/2))}
@container (min-width:900px){
  .lts-cre-head,.lts-cre-foot{padding-inline:max(10px,calc((100% - 1100px)/2))}
  .lts-cre-inner{max-width:min(1100px,100%)}
}
/* scroll shadows (Lea Verou's): a shade at the edge a scroller still has content past */
.lts-cre-body,.lts-root:not(.lts-embed):not(.lts-cre){--s-shade:color-mix(in srgb,var(--s-ink) 26%,transparent);background-image:linear-gradient(var(--s-bg) 30%,transparent),linear-gradient(transparent,var(--s-bg) 70%),radial-gradient(farthest-side at 50% 0,var(--s-shade),transparent),radial-gradient(farthest-side at 50% 100%,var(--s-shade),transparent);background-position:top,bottom,top,bottom;background-size:100% 28px,100% 28px,100% 10px,100% 10px;background-repeat:no-repeat;background-attachment:local,local,scroll,scroll}
.lts-cre-foot{flex:none;display:flex;gap:6px;align-items:center;padding:8px 10px;background:var(--s-bg);border-top:1px solid var(--s-edge)}
/* a phone on its side: the head and foot are slim, and the heading and lede above the cards and each class's flavour line go (the step tab already names the step; the facts and kit stay), so the body has the room */
@media (max-height:500px){
  .lts-root .lts-cre-head{padding-block:2px}
  .lts-root .lts-cre-top{margin:0}
  .lts-root .lts-steps{margin-top:2px}
  .lts-root .lts-cre-foot{padding-block:3px}
  .lts-root .lts-cre-body{padding-block:6px}
  .lts-root .lts-cre-inner{gap:6px}
  .lts-root .lts-cre-inner>.lts-h,.lts-root .lts-cre-inner>.lts-lede{display:none}
  .lts-root .lts-pickbtn .ds{display:none}
  .lts-root .lts-cards>.lts-blank{align-self:start}
}
.lts-root[data-style="pixel"] .lts-cre-foot{border-top:2px solid var(--s-edge)}
.lts-lede{margin:0;color:var(--s-muted)}
.lts-errs{margin:0;padding:8px 10px 8px 26px;border:1px solid var(--s-bad);color:var(--s-bad);background:var(--s-panel);border-radius:8px}
.lts-root[data-style="pixel"] .lts-errs{border-radius:0;border-width:2px}
.lts-errs li{margin:2px 0}
.lts-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.lts-pick{appearance:none;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:6px;width:100%;padding:9px 10px;background:var(--s-panel);color:var(--s-ink);border:1px solid var(--s-edge);border-radius:9px;min-width:0}
.lts-pick:hover{filter:brightness(1.06)}
.lts-pick[aria-pressed="true"],.lts-pick[data-on="true"]{border-color:var(--s-accent);box-shadow:0 0 0 2px var(--s-accent)}
div.lts-pick{cursor:default}
.lts-pickbtn{appearance:none;cursor:pointer;background:none;border:0;padding:0;margin:0;text-align:left;width:100%;color:inherit}
.lts-root[data-style="pixel"] .lts-pick{border-radius:0;border-width:2px}
.lts-root[data-style="pixel"] .lts-pick[aria-pressed="true"],.lts-root[data-style="pixel"] .lts-pick[data-on="true"]{box-shadow:0 0 0 2px #05061a,0 0 0 4px var(--s-accent)}
.lts-pick .nm{font-weight:700;font-size:15px}
.lts-pick .ds{font-size:12.5px;color:var(--s-muted)}
.lts-pick .row{display:flex;gap:8px;align-items:flex-start}
.lts-facts{margin:0;padding:0;list-style:none;font-size:12.5px}
.lts-facts li{padding:1px 0}
.lts-facts b{color:var(--s-accent)}
.lts-cards.tight{grid-template-columns:repeat(auto-fit,minmax(138px,1fr))}
.lts-inc{display:flex;flex-wrap:wrap;gap:3px}
.lts-inc span{font-size:11.5px;padding:0 5px;border:1px solid var(--s-edge);background:var(--s-soft)}
.lts-tabs{display:flex;flex-wrap:wrap;gap:4px}
.lts-tab{flex:1 1 auto;min-width:0;padding:6px 8px;text-align:center;cursor:pointer;background:var(--s-panel);border:1px solid var(--s-edge);border-radius:6px;font-weight:700;font-size:13px}
.lts-tab[aria-selected="true"]{background:var(--s-accent);color:var(--s-onaccent);border-color:var(--s-accent)}
.lts-root[data-style="pixel"] .lts-tab{border-radius:0;border-width:2px}
.lts-table{display:grid;grid-template-columns:minmax(64px,auto) minmax(0,1fr) 34px 34px 34px;gap:5px 6px;align-items:center}
.lts-table .hd{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--s-muted)}
.lts-table .c{text-align:center;font-variant-numeric:lining-nums tabular-nums}
.lts-table .f{font-weight:700}
.lts-ctl{display:flex;align-items:center;gap:6px;min-width:0}
.lts-ctl .v{min-width:2ch;text-align:center;font-weight:700;font-variant-numeric:lining-nums tabular-nums}
.lts-sel,.lts-input,.lts-area{width:100%;min-height:34px;padding:5px 8px;background:var(--s-panel);color:var(--s-ink);border:1px solid var(--s-edge);border-radius:6px}
.lts-root[data-style="pixel"] .lts-sel,.lts-root[data-style="pixel"] .lts-input,.lts-root[data-style="pixel"] .lts-area{border-radius:0;border-width:2px}
.lts-sel{width:auto;min-width:0;max-width:100%}
.lts-area{min-height:68px;resize:vertical}
.lts-fld{display:flex;flex-direction:column;gap:3px}
.lts-fld>label,.lts-fld>.lab{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--s-muted)}
.lts-fld .ct{font-size:11.5px;color:var(--s-muted);text-align:right}
.lts-budget{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lts-meter{flex:1 1 120px;height:10px;background:var(--s-soft);border:1px solid var(--s-edge)}
.lts-meter i{display:block;height:100%;background:var(--s-accent)}
.lts-dice{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:6px}
.lts-roll{padding:5px 3px;text-align:center}
.lts-roll .d{display:inline-flex;gap:3px;justify-content:center}
.lts-roll .d i{font-style:normal;min-width:17px;height:21px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--s-edge);background:var(--s-soft);font-weight:700;font-variant-numeric:lining-nums}
.lts-roll .d i.x{opacity:.45;text-decoration:line-through}
.lts-roll .t{display:block;margin-top:3px;font-weight:700}
.lts-skillgrid{display:flex;flex-wrap:wrap;gap:5px}
.lts-skill{appearance:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 9px;background:var(--s-panel);color:var(--s-ink);border:1px solid var(--s-edge);border-radius:99px;font-size:13px}
.lts-skill .b{color:var(--s-muted);font-variant-numeric:lining-nums}
.lts-skill[aria-pressed="true"]{background:var(--s-accent);color:var(--s-onaccent);border-color:var(--s-accent)}
.lts-skill[aria-pressed="true"] .b{color:inherit}
.lts-skill:disabled{cursor:default;opacity:.5}
.lts-skill.locked{opacity:1;border-style:dashed}
.lts-root[data-style="pixel"] .lts-skill{border-radius:0;border-width:2px}
.lts-opt{display:flex;gap:8px;align-items:flex-start;padding:7px 9px;border:1px solid var(--s-edge);border-radius:8px;background:var(--s-panel);cursor:pointer;text-align:left;width:100%}
.lts-opt[aria-pressed="true"]{border-color:var(--s-accent);box-shadow:0 0 0 2px var(--s-accent)}
.lts-root[data-style="pixel"] .lts-opt{border-radius:0;border-width:2px}
.lts-opt .tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.lts-opt .tx span{font-size:12.5px;color:var(--s-muted)}
.lts-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.lts-kit{display:flex;flex-wrap:wrap;gap:4px}
.lts-kit .lts-item{font-size:12px;padding:1px 7px}
.lts-note{padding:7px 10px;border:1px dashed var(--s-edge);color:var(--s-muted);border-radius:8px;font-size:13px}
@media (prefers-reduced-motion: no-preference){.lts-root{animation:lts-in .14s ease-out}}
@keyframes lts-in{from{opacity:0}to{opacity:1}}
`;

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function dpr(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

function tipOn(ctx: Ctx, el: HTMLElement, content: TipContent | (() => TipContent)): HTMLElement {
  ctx.offs.push(attachTip(el, content, { boundary: ctx.bound(), style: () => ctx.style() }));
  return el;
}

function clearTips(ctx: Ctx): void {
  for (const off of ctx.offs) off();
  ctx.offs = [];
}

/** A heading: bitmap gold text in the pixel look (words kept for screen readers), small caps in storybook. `size` 1 is a section, 2 is a card title, 3 is the character's name. */
function heading(ctx: Ctx, text: string, size: 1 | 2 | 3 = 1): HTMLElement {
  const e = h("div", size === 1 ? "lts-h" : "lts-title");
  if (ctx.style() === "pixel") {
    try {
      const scale = size === 3 ? 3 : 2;
      const c = pixelText(text, { scale, dpr: dpr(), weight: "bold", color: ["#fff3ad", "#ffc72a"], outline: "#05061a", maxWidth: Math.max(8, Math.floor((ctx.width() - 40) / scale)) });
      c.setAttribute("aria-hidden", "true");
      e.append(c, h("span", "lts-sr", text));
      return e;
    } catch {
      /* fall through to plain text */
    }
  }
  e.textContent = text;
  if (size === 2) e.style.fontSize = "16px";
  return e;
}

/** A big numeral: a bitmap one in the pixel look, a lining-figure serif in storybook. */
function bigNum(ctx: Ctx, text: string, scale = 3, tone: "ink" | "accent" = "ink"): HTMLElement {
  const e = h("span", "lts-big");
  if (ctx.style() === "pixel") {
    try {
      const c = pixelText(text, { scale, dpr: dpr(), weight: "bold", color: tone === "accent" ? ["#fff3ad", "#ffc72a"] : "#f4ecd0", outline: "#05061a" });
      c.setAttribute("aria-hidden", "true");
      e.append(c, h("span", "lts-sr", text));
      return e;
    } catch {
      /* fall through */
    }
  }
  e.textContent = text;
  return e;
}

function badge(applied: boolean): HTMLElement {
  return h("span", `lts-badge ${applied ? "game" : "dm"}`, applied ? "Game applies" : "DM rules");
}

function copyCanvas(src: HTMLCanvasElement | null | undefined, size: number): HTMLCanvasElement | null {
  if (!src || !src.width || !src.height) return null;
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx2 = c.getContext("2d");
  if (!ctx2) return null;
  ctx2.drawImage(src, 0, 0);
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  c.setAttribute("aria-hidden", "true");
  return c;
}

// ---- the sheet content (shared by the sheet window and creation's review) ----

function fieldEl(ctx: Ctx, label: string, value: string, tip: TipContent, empty = false): HTMLElement {
  const f = h("div", "lts-field");
  f.append(h("span", "l", label), h("span", empty ? "v lts-empty" : "v", value));
  tipOn(ctx, f, tip);
  return f;
}

function headerBlock(ctx: Ctx, sheet: CharacterSheet, extras: SheetExtras): HTMLElement {
  const card = h("section", "lts-card");
  const top = h("div", "lts-head");
  const portrait = copyCanvas(extras.portrait, 64);
  if (portrait) {
    const box = h("div", "lts-portrait");
    box.append(portrait);
    top.append(box);
  }
  const main = h("div", "lts-grow");
  main.append(heading(ctx, sheet.name, 3));
  top.append(main);
  const fields = h("div", "lts-fields");
  const cls = sheetClassName(sheet);
  fields.append(
    fieldEl(ctx, "Class and level", `${cls}, level ${sheet.level}`, {
      title: `${cls}, level ${sheet.level}`,
      lines: [sheet.kitDescription, `Hit die d${sheet.hitDieSides}. Your level sets your proficiency bonus (${signed(sheet.proficiencyBonus)}) and how many hit dice you have.`],
      footer: APPLIES_LABEL,
    }),
  );
  const ancestry = sheet.ancestryId ? getAncestry(sheet.ancestryId) : undefined;
  fields.append(
    fieldEl(
      ctx,
      "Ancestry",
      sheet.ancestryName ?? "Not chosen",
      ancestry
        ? { title: ancestry.name, lines: [ancestry.description, `${ancestry.size} size, base speed ${ancestry.speedFt} feet. Its traits are listed under Features and traits.`], footer: APPLIES_LABEL }
        : { title: "Ancestry", lines: ["This character was made before ancestries existed, so it has none: no speed other than the default, no languages and no traits."], footer: APPLIES_LABEL },
      !sheet.ancestryName,
    ),
  );
  const bg = sheet.background;
  fields.append(
    fieldEl(
      ctx,
      "Background",
      bg?.name ?? "Not chosen",
      bg
        ? { title: bg.name, lines: [`Your own background. It trains you in ${bg.skills[0]} and ${bg.skills[1]}.`, "Its personality lines are on the bottom of the sheet."], footer: APPLIES_LABEL }
        : { title: "Background", lines: ["This character has no background, so the sheet has no two extra trained skills from one."], footer: APPLIES_LABEL },
      !bg,
    ),
  );
  const al = sheet.alignment;
  fields.append(
    fieldEl(
      ctx,
      "Alignment",
      al ?? "Not chosen",
      {
        title: al ?? "Alignment",
        lines: [al ? (ALIGNMENT_BLURB[al] ?? "") : "A short label for how a character tends to act.", "It changes no number on this sheet."].filter(Boolean),
        footer: DM_RULES_LABEL,
      },
      !al,
    ),
  );
  fields.append(
    fieldEl(ctx, "Milestones", `${sheet.milestones} of ${MILESTONES_PER_LEVEL}`, {
      title: `Milestones ${sheet.milestones} of ${MILESTONES_PER_LEVEL}`,
      lines: [`A milestone is a fight won or a new scene reached. Collect ${MILESTONES_PER_LEVEL} and the next level is earned; there is no experience point count.`],
      footer: APPLIES_LABEL,
    }),
  );
  card.append(top, fields);
  return card;
}

function abilityBlock(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const grid = h("div", "lts-abils");
  for (const key of ABILITY_KEYS) {
    const box = h("div", "lts-card lts-abil");
    box.dataset.ltsAbility = key;
    const label = h("span", "l", ABILITY_NAME[key]);
    label.title = ABILITY_ABBR[key];
    box.append(label);
    const m = h("span", "m");
    m.append(bigNum(ctx, signed(sheet.modifiers[key]), 3));
    box.append(m, h("span", "s", String(sheet.abilities[key])));
    tipOn(ctx, box, abilityTip(sheet, key));
    grid.append(box);
  }
  return grid;
}

function statChip(ctx: Ctx, label: string, value: string, tip: TipContent, key: string): HTMLElement {
  const c = h("div", "lts-card lts-stat");
  c.dataset.ltsStat = key;
  const v = h("span", "v");
  v.append(bigNum(ctx, value, 3));
  c.append(h("span", "l", label), v);
  tipOn(ctx, c, tip);
  return c;
}

function statsBlock(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const grid = h("div", "lts-stats");
  grid.append(
    statChip(ctx, "Armor class", String(effectiveArmorClass(sheet)), armorClassTip(sheet), "ac"),
    statChip(ctx, "Initiative", signed(sheet.modifiers.dex), initiativeTip(sheet), "initiative"),
    statChip(ctx, "Speed", `${effectiveSpeedFt(sheet)} ft`, speedTip(sheet), "speed"),
    statChip(ctx, "Proficiency", signed(sheet.proficiencyBonus), proficiencyTip(sheet), "proficiency"),
    statChip(ctx, "Passive Perception", String(10 + skillModifierFor(sheet, "Perception")), passivePerceptionTip(sheet), "passive"),
  );
  return grid;
}

function vitalsBlock(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const wrap = h("div", "lts-vitals");
  const hp = h("section", "lts-card");
  hp.dataset.ltsStat = "hp";
  hp.append(heading(ctx, "Hit points"));
  const num = h("div", "lts-hpnum");
  num.append(bigNum(ctx, String(sheet.currentHp), 3), h("span", "lts-muted", `of ${sheet.maxHp}`));
  hp.append(num);
  const bar = h("div", "lts-hpbar");
  const fill = h("i");
  fill.style.width = `${sheet.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((sheet.currentHp / sheet.maxHp) * 100))) : 0}%`;
  bar.append(fill);
  hp.append(bar);
  tipOn(ctx, hp, hitPointsTip(sheet));
  wrap.append(hp);

  const rest = h("section", "lts-card");
  rest.append(heading(ctx, "Dice and saves"));
  const dice = h("div", "lts-pair");
  dice.dataset.ltsStat = "hitdice";
  dice.append(h("span", "l", "Hit dice"), h("b", undefined, `${sheet.hitDiceRemaining}d${sheet.hitDieSides}`));
  tipOn(ctx, dice, hitDiceTip(sheet));
  const death = h("div", "lts-pair");
  death.dataset.ltsStat = "death";
  death.append(h("span", "l", "Death saves"));
  const dots = h("span", "lts-dots");
  dots.setAttribute("aria-label", `${sheet.deathSaves.successes} successes, ${sheet.deathSaves.failures} failures`);
  for (let i = 0; i < 3; i++) dots.append(h("i", `lts-dot ${i < sheet.deathSaves.successes ? "on ok" : ""}`));
  dots.append(h("span", "lts-muted", "/"));
  for (let i = 0; i < 3; i++) dots.append(h("i", `lts-dot ${i < sheet.deathSaves.failures ? "on bad" : ""}`));
  death.append(dots);
  tipOn(ctx, death, deathSavesTip(sheet));
  rest.append(dice, death);
  wrap.append(rest);
  return wrap;
}

function savesCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Saving throws"));
  for (const key of ABILITY_KEYS) {
    const trained = sheet.saves.some((s) => s.ability === key);
    const row = h("div", "lts-rowl");
    row.dataset.ltsSave = key;
    const mark = h("i", `lts-mark ${trained ? "on" : ""}`);
    row.append(mark, h("span", "n", ABILITY_NAME[key]), h("span", "v", signed(saveModifierFor(sheet, key))));
    if (trained) row.append(h("span", "lts-sr", "trained"));
    tipOn(ctx, row, saveTip(sheet, key));
    card.append(row);
  }
  return card;
}

function skillsCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Skills"));
  for (const skill of ALL_SKILLS) {
    const trained = sheet.skills.find((s) => s.skill === skill);
    const row = h("div", "lts-rowl");
    row.dataset.ltsSkill = skill;
    const ab = SKILL_ABILITY[skill];
    row.append(h("i", `lts-mark ${trained ? "on" : ""} ${trained?.expertise ? "exp" : ""}`), h("span", "n", skill), h("span", "a", ab ? ABILITY_ABBR[ab] : ""), h("span", "v", signed(skillModifierFor(sheet, skill))));
    if (trained) row.append(h("span", "lts-sr", trained.expertise ? "expertise" : "trained"));
    tipOn(ctx, row, skillTip(sheet, skill));
    card.append(row);
  }
  return card;
}

function attacksCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Attacks"));
  const grid = h("div", "lts-atk");
  grid.dataset.ltsAttack = "";
  grid.append(h("span", "hd", "Attack"), h("span", "hd", "To hit"), h("span", "hd", "Damage"));
  const name = h("span", "c", weaponIdentityFor(sheet).label);
  const hit = h("span", "c", signed(attackerBonusFor(sheet)));
  hit.dataset.ltsToHit = "";
  const dmg = h("span", "c", weaponDamageNotationFor(sheet));
  dmg.dataset.ltsDamage = "";
  tipOn(ctx, name, attackNameTip(sheet));
  tipOn(ctx, hit, toHitTip(sheet));
  tipOn(ctx, dmg, damageTip(sheet));
  grid.append(name, hit, dmg);
  card.append(grid);
  return card;
}

function spellsCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement | null {
  const slots = sheet.spellSlots;
  if (!slots) return null;
  const levels = Object.keys(slots).map(Number).sort((a, b) => a - b);
  if (levels.length === 0) return null;
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Spell slots"));
  for (const lv of levels) {
    const s = slots[lv]!;
    const row = h("div", "lts-rowl");
    row.dataset.ltsSlots = String(lv);
    row.append(h("span", "n", `${ordinal(lv)} level`));
    const dots = h("span", "lts-dots");
    for (let i = 0; i < s.max; i++) dots.append(h("i", `lts-dot ${i < s.max - s.used ? "on ok" : ""}`));
    row.append(dots, h("span", "v", `${s.max - s.used} of ${s.max}`));
    tipOn(ctx, row, spellSlotTip(lv, s.max, s.used));
    card.append(row);
  }
  return card;
}

function featuresCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Features and traits"));
  const list = featureList(sheet);
  if (list.length === 0) {
    card.append(h("p", "lts-empty", "Nothing yet."));
    return card;
  }
  const ul = h("ul", "lts-feat");
  for (const f of list) {
    const li = h("li");
    li.dataset.ltsFeature = f.name;
    const top = h("div", "top");
    top.append(h("b", undefined, f.name), badge(f.applied));
    li.append(top);
    if (f.source === "Class" || f.source === "Level up") li.append(h("span", "tx", f.text));
    tipOn(ctx, li, featureTip(f));
    ul.append(li);
  }
  card.append(ul);
  return card;
}

function proficienciesCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Proficiencies and languages"));
  const langs = h("div", "lts-pair");
  langs.append(h("span", "l", "Languages"), h("span", undefined, sheet.languages && sheet.languages.length ? sheet.languages.join(", ") : "Not recorded"));
  tipOn(ctx, langs, {
    title: "Languages",
    lines: ["The tongues your character speaks and reads. An entry like \"one extra language of your choice\" is for you and the DM to settle at the table."],
    footer: DM_RULES_LABEL,
  });
  card.append(langs);
  if (sheet.darkvisionFt) {
    const dv = h("div", "lts-pair");
    dv.append(h("span", "l", "Darkvision"), h("span", undefined, `${sheet.darkvisionFt} ft`));
    tipOn(ctx, dv, {
      title: `Darkvision ${sheet.darkvisionFt} ft`,
      lines: [`You see in dim light within ${sheet.darkvisionFt} feet as if it were bright, and in darkness as if it were dim, in shades of grey.`, "The game does not model light, so it does not change any roll."],
      footer: DM_RULES_LABEL,
    });
    card.append(dv);
  }
  const train = h("div", "lts-pair");
  train.append(h("span", "l", "Armor, weapons, tools"), h("span", undefined, "Not tracked"));
  tipOn(ctx, train, {
    title: "Armor, weapon and tool training",
    lines: ["The game picks your weapon and armor from your class and your gear slots and does not track which kinds you are trained in. Wear and wield what you carry; tell the DM about anything else."],
    footer: DM_RULES_LABEL,
  });
  card.append(train);
  return card;
}

function equipmentCard(ctx: Ctx, sheet: CharacterSheet, extras: SheetExtras): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Equipment"));
  let any = false;
  for (const section of packInfo(sheet, { potions: extras.potions, notes: extras.notes })) {
    if (section.items.length === 0) continue;
    any = true;
    const sec = h("div", "lts-eqsec");
    sec.dataset.ltsPack = section.label;
    sec.append(h("div", "lab", section.label));
    const chips = h("div", "lts-chips");
    for (const info of section.items) {
      const chip = h("span", "lts-item");
      chip.dataset.ltsItem = info.name;
      chip.append(h("span", undefined, info.name));
      const n = itemCount(info);
      if (n) chip.append(h("span", "k", n));
      const key = sheetItemKey(section.label, info.name);
      const card = ctx.cards?.itemCard?.(key) ?? null;
      if (card && ctx.cards?.itemCard) {
        const read = ctx.cards.itemCard;
        ctx.offs.push(attachItemCard(chip, () => read(key) ?? card, (id) => ctx.cards?.onItemAction?.(key, id), { boundary: ctx.bound(), style: () => ctx.style() }));
        chip.dataset.ltsItemKey = key;
      } else {
        tipOn(ctx, chip, itemTip(info));
      }
      chips.append(chip);
    }
    sec.append(chips);
    card.append(sec);
  }
  if (!any) card.append(h("p", "lts-empty", "Nothing carried."));
  return card;
}

function personalityCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Personality"));
  const bg = sheet.background;
  const grid = h("div", "lts-pers");
  const entries: [string, string | undefined, string][] = [
    ["Personality trait", bg?.personalityTrait, "How your character usually comes across: a habit, a manner, a quirk."],
    ["Ideal", bg?.ideal, "What your character believes in and strives for."],
    ["Bond", bg?.bond, "A person, a place or a promise your character is tied to."],
    ["Flaw", bg?.flaw, "A weakness or a vice that can get your character into trouble."],
  ];
  for (const [label, value, what] of entries) {
    const box = h("div");
    box.dataset.ltsPersonality = label;
    const f = h("div", "lts-field");
    f.append(h("span", "l", label), h("p", value ? undefined : "lts-empty", value ?? "Left blank."));
    box.append(f);
    tipOn(ctx, box, { title: label, lines: [what, "It is your own words. It changes no number; the DM may play to it."], footer: DM_RULES_LABEL });
    grid.append(box);
  }
  card.append(grid);
  return card;
}

function backstoryCard(ctx: Ctx, sheet: CharacterSheet): HTMLElement {
  const card = h("section", "lts-card");
  card.append(heading(ctx, "Backstory"));
  const p = h("p", sheet.backstory ? "lts-story" : "lts-story lts-empty", sheet.backstory ?? "No backstory written yet.");
  tipOn(ctx, p, { title: "Backstory", lines: ["Where your character came from, in your own words. The DM can read it and use it."], footer: DM_RULES_LABEL });
  card.append(p);
  return card;
}

/** The whole sheet as one element. Used by buildSheetContent below and by creation's review step. */
function sheetBody(ctx: Ctx, sheet: CharacterSheet, extras: SheetExtras): HTMLElement {
  const wrap = h("div", "lts-sheet");
  wrap.append(headerBlock(ctx, sheet, extras), abilityBlock(ctx, sheet), statsBlock(ctx, sheet), vitalsBlock(ctx, sheet));
  const cols = h("div", "lts-cols");
  const left = h("div", "lts-col");
  left.append(savesCard(ctx, sheet), skillsCard(ctx, sheet));
  const right = h("div", "lts-col");
  right.append(attacksCard(ctx, sheet));
  const spells = spellsCard(ctx, sheet);
  if (spells) right.append(spells);
  right.append(featuresCard(ctx, sheet), proficienciesCard(ctx, sheet));
  cols.append(left, right);
  wrap.append(cols, equipmentCard(ctx, sheet, extras), personalityCard(ctx, sheet), backstoryCard(ctx, sheet));
  return wrap;
}

function ensurePositioned(host: HTMLElement): () => void {
  if (getComputedStyle(host).position !== "static") return () => {};
  const before = host.style.position;
  host.style.position = "relative";
  return () => {
    host.style.position = before;
  };
}

function boundaryFor(host: HTMLElement): HTMLElement {
  return host.closest<HTMLElement>(".lt-game") ?? host;
}

function tipIsUp(): boolean {
  const t = document.getElementById("lt-tip");
  return (!!t && !t.hidden) || itemCardIsUp();
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
}

// ---- buildSheetContent ------------------------------------------------------

/** The sheet as an element a host can put anywhere (the in-game menu's Character tab): no close button and no frame of its own. */
export interface SheetContent {
  el: HTMLElement;
  update(sheet: CharacterSheet, extras?: SheetExtras): void;
  setStyle(style: TextStyle): void;
  /** Take the sheet off the page and let go of its tips and listeners. */
  destroy(): void;
}

/**
 * The whole character sheet (header, abilities, vitals, saves, skills, attacks, features, gear, personality, backstory) as one element,
 * with the sheet's own colours, so it reads the same inside the menu as in the old window. The host scrolls it. Item chips become item
 * cards when `itemCard` is given (see SheetItemCards).
 */
export function buildSheetContent(sheet: CharacterSheet, opts: { style: TextStyle; extras?: SheetExtras } & SheetItemCards): SheetContent {
  injectStyle();
  let style = opts.style;
  let current = sheet;
  let extras: SheetExtras = opts.extras ?? {};
  let dead = false;
  const el = h("div", "lts-root lts-embed");
  el.dataset.lts = "content";
  el.dataset.style = style;
  const ctx: Ctx = {
    style: () => style,
    bound: () => el.closest<HTMLElement>(".lt-game") ?? el,
    width: () => el.clientWidth || 358,
    offs: [],
    cards: { itemCard: opts.itemCard, onItemAction: opts.onItemAction },
  };
  function render(): void {
    clearTips(ctx);
    el.dataset.style = style;
    el.replaceChildren(sheetBody(ctx, current, extras));
  }
  render();
  return {
    el,
    update(next, nextExtras) {
      if (dead) return;
      current = next;
      if (nextExtras) extras = nextExtras;
      render();
    },
    setStyle(next) {
      if (dead || next === style) return;
      style = next;
      render();
    },
    destroy() {
      if (dead) return;
      dead = true;
      clearTips(ctx);
      el.remove();
    },
  };
}

// ---- openSheet --------------------------------------------------------------

export function openSheet(
  host: HTMLElement,
  sheet: CharacterSheet,
  opts: { style: TextStyle; extras?: SheetExtras; onClose: () => void } & SheetItemCards,
): SheetView {
  injectStyle();
  const restorePosition = ensurePositioned(host);
  let style = opts.style;
  let closed = false;
  const root = h("div", "lts-root");
  root.dataset.lts = "sheet";
  root.dataset.style = style;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Character sheet");
  const ctx: Ctx = { style: () => style, bound: () => boundaryFor(host), width: () => root.clientWidth || 358, offs: [] };
  const content = buildSheetContent(sheet, { style, extras: opts.extras, itemCard: opts.itemCard, onItemAction: opts.onItemAction });

  /** The title bar. The sheet itself is the content's. */
  function renderBar(): void {
    clearTips(ctx);
    root.dataset.style = style;
    const bar = h("div", "lts-topbar");
    const title = h("div", "lts-grow");
    title.append(heading(ctx, "Character sheet"));
    bar.append(title);
    const cb = h("button", "lts-btn pri", "Close");
    cb.type = "button";
    cb.dataset.ltsAct = "close";
    cb.setAttribute("aria-label", "Close the character sheet");
    cb.addEventListener("click", () => view.close());
    bar.append(cb);
    root.replaceChildren(bar, content.el);
  }

  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    if (e.key === "Escape") {
      if (tipIsUp()) return;
      e.stopPropagation();
      view.close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  // Keys typed inside the sheet are the sheet's own: the game behind it never sees them. C closes it again, as it opened it.
  const stopKeys = (e: KeyboardEvent): void => {
    if (e.type === "keydown" && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c" && !isTextTarget(e.target)) {
      e.stopPropagation();
      view.close();
      return;
    }
    e.stopPropagation();
  };
  root.addEventListener("keydown", stopKeys);
  root.addEventListener("keyup", stopKeys);
  root.addEventListener("keypress", stopKeys);

  const view: SheetView = {
    el: root,
    update(next, nextExtras) {
      if (closed) return;
      const keepScroll = root.scrollTop;
      content.update(next, nextExtras);
      root.scrollTop = keepScroll;
    },
    setStyle(next) {
      if (closed || next === style) return;
      style = next;
      const keepScroll = root.scrollTop;
      content.setStyle(next);
      renderBar();
      root.scrollTop = keepScroll;
    },
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      clearTips(ctx);
      content.destroy();
      root.remove();
      restorePosition();
      opts.onClose();
    },
  };
  renderBar();
  host.appendChild(root);
  root.focus({ preventScroll: true });
  return view;
}

// ---- openCreation -----------------------------------------------------------

function skillBonusPreview(input: CreateCharacterInput, skill: string, expertise = false): string {
  const ability = SKILL_ABILITY[skill];
  if (!ability) return "";
  const ancestry = input.ancestryId !== undefined ? getAncestry(input.ancestryId) : undefined;
  const scores = finalScores(input.baseScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, ancestry, input.ancestryIncreases);
  return signed(abilityModifier(scores[ability]) + 2 * (expertise ? 2 : 1));
}

const SKILL_SOURCE_WORD = { class: "class", ancestry: "ancestry", background: "background" } as const;

export function openCreation(
  host: HTMLElement,
  api: CreationHost,
  opts: { start?: Partial<CreateCharacterInput>; onBegin: (sheet: CharacterSheet, input: CreateCharacterInput) => void; onCancel: () => void },
): CreationView {
  injectStyle();
  const restorePosition = ensurePositioned(host);
  let style = api.style();
  let closed = false;
  let step: StepId = "name";
  let input: CreateCharacterInput = initialDraft(opts.start);
  /** The four d6 as rolled, and which rolled total each ability took (index into rolled.scores). */
  let rolled: RolledSet | null = null;
  let assign: number[] = [0, 1, 2, 3, 4, 5];
  let rollBusy = false;
  /** The Roll tab is open but nothing has been rolled yet. */
  let rollTab = false;
  let showSkippedBackground = false;

  const root = h("div", "lts-root lts-cre");
  root.dataset.lts = "creation";
  root.dataset.style = style;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Create a character");
  const ctx: Ctx = { style: () => style, bound: () => boundaryFor(host), width: () => root.clientWidth || 358, offs: [] };

  const headEl = h("div", "lts-cre-head");
  const bodyEl = h("div", "lts-cre-body");
  const footEl = h("div", "lts-cre-foot");
  root.append(headEl, bodyEl, footEl);

  const stepIndex = (): number => CREATION_STEPS.findIndex((s) => s.id === step);

  function preview(): { sheet: CharacterSheet | null; errors: string[] } {
    return previewCharacter(input);
  }

  function errorSteps(errors: readonly string[]): Map<StepId, string[]> {
    const m = new Map<StepId, string[]>();
    for (const e of errors) {
      const s = stepForError(e);
      m.set(s, [...(m.get(s) ?? []), e]);
    }
    return m;
  }

  function set(patch: Partial<CreateCharacterInput>, rerender = true): void {
    input = reconcileDraft({ ...input, ...patch });
    if (rerender) render();
    else renderChrome();
  }

  // ---- chrome: header, steps, footer ----

  function renderChrome(): void {
    const pv = preview();
    const bad = errorSteps(pv.errors);
    const named = hasName(input);
    // The header
    headEl.replaceChildren();
    const top = h("div", "lts-cre-top");
    const t = h("div", "lts-grow");
    t.append(heading(ctx, "New character"));
    const cancel = h("button", "lts-btn", "Cancel");
    cancel.type = "button";
    cancel.dataset.ltsAct = "cancel";
    cancel.setAttribute("aria-label", "Cancel and go back to the game");
    cancel.addEventListener("click", () => view.close(true));
    top.append(t, cancel);
    const steps = h("div", "lts-steps");
    steps.setAttribute("role", "tablist");
    CREATION_STEPS.forEach((s, i) => {
      const b = h("button", `lts-step${s.id === step ? " on" : ""}${bad.has(s.id) && (s.id !== "name" || named) ? " bad" : ""}`);
      b.type = "button";
      // Nothing past the name opens until the hero has one.
      b.disabled = !named && s.id !== "name";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(s.id === step));
      b.dataset.ltsStep = s.id;
      b.dataset.fk = `step-${s.id}`;
      b.setAttribute("aria-label", `Step ${i + 1}: ${s.label}${bad.has(s.id) ? " (needs attention)" : ""}`);
      b.append(h("span", "n", String(i + 1)), h("span", "t", s.label));
      b.addEventListener("click", () => go(s.id));
      steps.append(b);
    });
    // On a phone the tabs show only their numbers, so the step's name is the line under them.
    const cap = h("div", "lts-step-cap", stepCaption(stepIndex()));
    cap.dataset.ltsStepCaption = "";
    headEl.append(top, steps, cap);
    // The footer
    footEl.replaceChildren();
    const i = stepIndex();
    const back = h("button", "lts-btn", "Back");
    back.type = "button";
    back.disabled = i === 0;
    back.dataset.ltsAct = "back";
    back.addEventListener("click", () => go(CREATION_STEPS[Math.max(0, i - 1)]!.id));
    const grow = h("span", "lts-grow");
    const next = h("button", "lts-btn", "Next");
    next.type = "button";
    next.dataset.ltsAct = "next";
    next.disabled = !named;
    if (!named) next.title = "Give your hero a name first";
    next.addEventListener("click", () => go(CREATION_STEPS[Math.min(CREATION_STEPS.length - 1, i + 1)]!.id));
    const begin = h("button", "lts-btn pri", "Begin");
    begin.type = "button";
    begin.dataset.ltsAct = "begin";
    begin.setAttribute("aria-label", "Begin the adventure with this character");
    begin.disabled = !named;
    if (!named) begin.title = "Give your hero a name first";
    begin.addEventListener("click", () => doBegin());
    footEl.append(back, grow);
    if (i < CREATION_STEPS.length - 1) footEl.append(next);
    footEl.append(begin);
  }

  function go(id: StepId): void {
    if (id !== "name" && !hasName(input)) return;
    step = id;
    render(true);
  }

  function doBegin(): void {
    if (closed) return;
    if (!hasName(input)) {
      step = "name";
      render(true);
      return;
    }
    const pv = preview();
    if (!pv.sheet) {
      const first = pv.errors[0];
      if (first) step = stepForError(first);
      render(true);
      return;
    }
    const sheet = pv.sheet;
    const snapshot = input;
    view.close(false);
    opts.onBegin(sheet, snapshot);
  }

  function render(resetScroll = false): void {
    if (closed) return;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.fk ?? null;
    const keep = bodyEl.scrollTop;
    clearTips(ctx);
    root.dataset.style = style;
    renderChrome();
    bodyEl.replaceChildren();
    const inner = h("div", "lts-cre-inner");
    const pv = preview();
    // An empty name is not an error to shout about on the first step: the page says what to do, and Next waits.
    const mine = (errorSteps(pv.errors).get(step) ?? []).filter((e) => step !== "name" || hasName(input) || !/needs a name/i.test(e));
    if (mine.length && step !== "review") {
      const ul = h("ul", "lts-errs");
      ul.setAttribute("role", "alert");
      for (const e of mine) ul.append(h("li", undefined, e.endsWith(".") ? e : `${e}.`));
      inner.append(ul);
    }
    switch (step) {
      case "class":
        buildClass(inner);
        break;
      case "ancestry":
        buildAncestry(inner);
        break;
      case "scores":
        buildScores(inner);
        break;
      case "skills":
        buildSkills(inner);
        break;
      case "background":
        buildBackground(inner);
        break;
      case "name":
        buildName(inner);
        break;
      case "review":
        buildReview(inner, pv);
        break;
    }
    bodyEl.append(inner);
    bodyEl.scrollTop = resetScroll ? 0 : keep;
    // The name is the first thing asked for: put the cursor in it.
    if (step === "name" && !hasName(input)) {
      queueMicrotask(() => {
        if (!closed) root.querySelector<HTMLElement>('[data-lts-field="Name"]')?.focus({ preventScroll: true });
      });
    }
    if (focusKey) {
      const again = root.querySelector<HTMLElement>(`[data-fk="${focusKey}"]`);
      if (again && !again.hasAttribute("disabled")) again.focus({ preventScroll: true });
    }
  }

  // ---- step 2: start from a class or a blank sheet ----

  const defaultSheets = new Map<string, CharacterSheet | null>();
  function defaultSheetOf(id: string): CharacterSheet | null {
    if (!defaultSheets.has(id)) defaultSheets.set(id, previewCharacter(creationOptions(id).defaults).sheet);
    return defaultSheets.get(id) ?? null;
  }

  function classIds(): string[] {
    const ids = [...PLAYABLE_ARCHETYPE_IDS];
    if (!ids.includes(input.archetypeId)) ids.push(input.archetypeId);
    return ids;
  }

  function pickClass(id: string): void {
    if (id === input.archetypeId) return;
    const def = creationOptions(id).defaults;
    input = reconcileDraft({ ...input, archetypeId: id, appearanceAssetId: def.appearanceAssetId, classSkills: def.classSkills, choices: {} });
    render();
  }

  /** Leave a blank sheet for the class's own numbers, or turn the class's numbers into a blank sheet. */
  function setBlank(on: boolean): void {
    input = on ? blankDraft(input) : startFromClass(input, input.archetypeId);
    render();
  }

  function buildClass(into: HTMLElement): void {
    into.append(heading(ctx, "Start from"));
    into.append(h("p", "lts-lede", "Pick a class and its numbers are filled in for you; change any of them on the next steps. Or start from a blank sheet. Hover or tap any number or item to see exactly what it is."));
    const cards = h("div", "lts-cards");
    cards.setAttribute("role", "group");
    cards.setAttribute("aria-label", "Class");
    for (const id of classIds()) {
      const a = getArchetype(id);
      const def = defaultSheetOf(id);
      // The card is a plain box: the select button is its heading, so the facts and kit chips below it (which carry their own tips) are never buttons inside a button.
      const b = h("div", "lts-pick");
      b.dataset.ltsClassCard = id;
      b.dataset.on = String(input.archetypeId === id);
      const sel = h("button", "lts-pickbtn");
      sel.type = "button";
      sel.dataset.ltsClass = id;
      sel.dataset.fk = `class-${id}`;
      sel.setAttribute("aria-pressed", String(input.archetypeId === id));
      sel.addEventListener("click", () => pickClass(id));
      const row = h("div", "row");
      const pic = copyCanvas(api.portrait?.(id), 56);
      if (pic) {
        const box = h("div", "lts-portrait");
        box.style.width = "56px";
        box.style.height = "56px";
        box.append(pic);
        row.append(box);
      }
      const tx = h("div", "lts-grow");
      tx.append(h("div", "nm", plainClassName(a.displayName)), h("div", "ds", a.kitDescription));
      row.append(tx);
      sel.append(row);
      b.append(sel);
      const facts = h("ul", "lts-facts");
      const saves = a.startingProficiencies.saves.map((s) => ABILITY_NAME[s]).join(" and ");
      const rule = CLASS_SKILL_CHOICES[a.chassis];
      const add = (label: string, value: string, tip: TipContent): void => {
        const li = h("li");
        li.append(h("b", undefined, `${label}: `), document.createTextNode(value));
        // Hover and tap only: a card is a long list of these, and the select button above is the stop that matters for the keyboard.
        li.tabIndex = -1;
        tipOn(ctx, li, tip);
        facts.append(li);
      };
      add("Hit die", `d${a.startingHitDie}`, {
        title: `Hit die d${a.startingHitDie}`,
        lines: [`At level 1 your hit points are ${a.startingHitDie} plus your Constitution modifier. Each hit die you spend to catch your breath heals a d${a.startingHitDie} plus that modifier.`],
        footer: APPLIES_LABEL,
      });
      if (def) {
        add("Armor", `${armorDisplayLabel(def)}, AC ${effectiveArmorClass(def)}`, {
          title: armorDisplayLabel(def),
          lines: [`Armor class ${effectiveArmorClass(def)} with this class's own ready-made scores; yours depends on the Dexterity you end up with.`],
          footer: APPLIES_LABEL,
        });
        add("Attack", `${weaponIdentityFor(def).label}, ${weaponFor(def).damageDie}`, {
          title: weaponIdentityFor(def).label,
          lines: [`The one attack the game rolls for this class: a ${weaponFor(def).damageDie} die, on ${ABILITY_NAME[weaponFor(def).ability]}.`],
          footer: APPLIES_LABEL,
        });
        if (def.spellSlots) {
          const total = Object.values(def.spellSlots).reduce((n, s) => n + s.max, 0);
          add("Spell slots", `${total} at level 1`, {
            title: "Spell slots",
            lines: [`A caster spends a slot to cast a spell and gets them all back on a long rest. This class starts with ${total}.`],
            footer: APPLIES_LABEL,
          });
        }
      }
      add("Saves", saves, {
        title: `${saves} saving throws`,
        lines: ["These two saving throws get your proficiency bonus added; the other four use the bare ability modifier."],
        footer: APPLIES_LABEL,
      });
      add("Skills", `pick ${rule.count}`, {
        title: `Pick ${rule.count} class skills`,
        lines: [`You choose ${rule.count} of: ${rule.from.join(", ")}. You do it in the Skills step.`],
        footer: APPLIES_LABEL,
      });
      b.append(facts);
      if (def) {
        const kit = h("div", "lts-kit");
        for (const name of a.startingInventory) {
          const chip = h("span", "lts-item", name);
          chip.tabIndex = -1;
          tipOn(ctx, chip, () => itemTip(describeCarried(def, name)));
          kit.append(chip);
        }
        b.append(kit);
      }
      cards.append(b);
    }
    // The blank sheet: nothing filled in. The class picked above still gives its hit die and gear.
    const blankOn = looksBlank(input);
    const bl = h("button", "lts-pick lts-blank");
    bl.type = "button";
    bl.dataset.ltsBlank = "";
    bl.dataset.fk = "class-blank";
    bl.setAttribute("aria-pressed", String(blankOn));
    bl.append(
      h("div", "nm", "Blank sheet"),
      h("div", "ds", "Every score at 8, no ancestry, no background. Build everything yourself. The class picked here still gives your hit die and gear."),
    );
    bl.addEventListener("click", () => setBlank(!blankOn));
    cards.append(bl);
    into.append(cards);

    // The class's own choice, where it has one at level 1.
    const choices = creationChoicesFor(input.archetypeId, input.classSkills, input.startingKit);
    const fighting = choices.find((c) => c.id === "fightingStyle");
    if (fighting) {
      const box = h("section", "lts-card");
      box.append(heading(ctx, "Fighting style"), h("p", "lts-lede", fighting.prompt));
      const list = h("div", "lts-col");
      list.style.gap = "6px";
      for (const o of fighting.options) {
        const b = h("button", "lts-opt");
        b.type = "button";
        b.dataset.ltsChoice = `fightingStyle:${o.id}`;
        b.dataset.fk = `fs-${o.id}`;
        b.setAttribute("aria-pressed", String(input.choices?.fightingStyle === o.id));
        const tx = h("span", "tx");
        tx.append(h("b", undefined, o.label), h("span", undefined, o.plain));
        b.append(tx);
        b.addEventListener("click", () => set({ choices: { ...input.choices, fightingStyle: o.id } }));
        tipOn(ctx, b, { title: o.label, lines: [o.technical, o.plain], footer: appliedLabel(!o.notYet) });
        list.append(b);
      }
      box.append(list);
      into.append(box);
    } else if (choices.some((c) => c.id === "expertiseSkill")) {
      into.append(h("p", "lts-note", "This class picks one skill to be exceptional at (Expertise). You choose it in the Skills step, once you know which skills you have."));
    } else {
      into.append(h("p", "lts-note", "This class has no choice to make at level 1."));
    }
  }

  // ---- step 3: ancestry ----

  function incChips(a: Ancestry, picks?: readonly AbilityKey[]): string[] {
    const inc = ancestryIncreaseFor(a, a.id === input.ancestryId ? picks : undefined);
    const chips = ABILITY_KEYS.filter((k) => inc[k]).map((k) => `${signed(inc[k]!)} ${ABILITY_ABBR[k]}`);
    if (a.chooseIncreases && a.id !== input.ancestryId) chips.push(`+${a.chooseIncreases.amount} x${a.chooseIncreases.count} free`);
    return chips;
  }

  function buildAncestry(into: HTMLElement): void {
    into.append(h("p", "lts-lede", "Where your hero comes from. It adds to your ability scores, sets your speed and gives a few traits."));
    const cards = h("div", "lts-cards tight");
    cards.setAttribute("role", "group");
    cards.setAttribute("aria-label", "Ancestry");
    for (const a of ANCESTRIES) {
      const b = h("button", "lts-pick");
      b.type = "button";
      b.dataset.ltsAncestry = a.id;
      b.dataset.fk = `anc-${a.id}`;
      b.setAttribute("aria-pressed", String(input.ancestryId === a.id));
      b.addEventListener("click", () => set({ ancestryId: a.id, ancestrySkills: undefined, ancestryIncreases: undefined }));
      b.append(h("div", "nm", a.name), h("div", "ds", `${a.size}, speed ${a.speedFt} ft`));
      const inc = h("div", "lts-inc");
      for (const c of incChips(a, input.ancestryIncreases)) inc.append(h("span", undefined, c));
      b.append(inc);
      tipOn(ctx, b, {
        title: a.name,
        lines: [a.description, `${a.size} size, base speed ${a.speedFt} feet. Languages: ${a.languages.join(", ")}.`],
        footer: `${a.traits.filter((t) => t.applied).length} of ${a.traits.length} traits are applied by the game`,
      });
      cards.append(b);
    }
    into.append(cards);

    const a = input.ancestryId !== undefined ? getAncestry(input.ancestryId) : undefined;
    if (!a) return;
    const detail = h("section", "lts-card");
    detail.dataset.ltsAncestryDetail = a.id;
    detail.append(heading(ctx, a.name, 2), h("p", "lts-lede", a.description));
    const ul = h("ul", "lts-feat");
    for (const t of a.traits) {
      const li = h("li");
      const top = h("div", "top");
      top.append(h("b", undefined, t.name), badge(t.applied));
      li.append(top, h("span", "tx", t.text));
      tipOn(ctx, li, { title: t.name, lines: [t.text], footer: appliedLabel(t.applied) });
      ul.append(li);
    }
    detail.append(ul);
    if (a.chooseIncreases) {
      const rule = a.chooseIncreases;
      const sel = new Set(input.ancestryIncreases ?? []);
      const box = h("div", "lts-fld");
      box.style.marginTop = "8px";
      box.append(h("span", "lab", `Your free bonus: +${rule.amount} to ${rule.count} abilities`));
      const grid = h("div", "lts-skillgrid");
      for (const k of ABILITY_KEYS) {
        if (rule.exclude.includes(k)) continue;
        const b = h("button", "lts-skill");
        b.type = "button";
        b.dataset.ltsIncrease = k;
        b.dataset.fk = `inc-${k}`;
        const on = sel.has(k);
        b.setAttribute("aria-pressed", String(on));
        b.append(h("span", undefined, ABILITY_NAME[k]));
        b.addEventListener("click", () => {
          // Always exactly the count: a new pick pushes the oldest one out.
          if (!on) set({ ancestryIncreases: [...sel, k].slice(-rule.count) });
        });
        tipOn(ctx, b, { title: `${ABILITY_NAME[k]} ${signed(rule.amount)}`, lines: [`Adds ${rule.amount} to your ${ABILITY_NAME[k]} score. Pick ${rule.count}, none of them Charisma. To change one, press another ability; the oldest pick makes room.`], footer: APPLIES_LABEL });
        grid.append(b);
      }
      box.append(grid);
      detail.append(box);
    }
    into.append(detail);
  }

  // ---- step 4: ability scores ----

  const SCORE_METHODS: AbilityMethod[] = ["archetype", "standard", "pointBuy", "rolled"];

  function setMethod(m: AbilityMethod): void {
    const archetype = getArchetype(input.archetypeId);
    if (m === "rolled") {
      rollTab = true;
      if (rolled) applyRolled();
      else render();
      return;
    }
    rollTab = false;
    const keepable = input.baseScores && validateBaseScores(m, input.baseScores, input.rolledScores) === null ? input.baseScores : { ...archetype.baseAbilityScores };
    set({ abilityMethod: m, baseScores: keepable, rolledScores: undefined });
  }

  function applyRolled(): void {
    if (!rolled) return;
    rollTab = true;
    set({ abilityMethod: "rolled", rolledScores: [...rolled.scores], baseScores: scoresFromAssign(rolled.scores, assign) });
  }

  async function doRoll(): Promise<void> {
    if (rollBusy || closed) return;
    rollBusy = true;
    render();
    let set6: RolledSet | null = null;
    try {
      const groups = api.rollDice ? await api.rollDice(6, 4, 6, "Ability scores: 4d6, drop the lowest") : null;
      if (validDiceGroups(groups)) set6 = { dice: groups, scores: scoresFromDice(groups) };
    } catch {
      set6 = null;
    }
    if (closed) return;
    rollBusy = false;
    rolled = set6 ?? rollAbilitySet();
    assign = assignRolledByPriority(input.archetypeId, rolled.scores);
    applyRolled();
  }

  function buildScores(into: HTMLElement): void {
    into.append(h("p", "lts-lede", "Six numbers decide what your hero is good at. Pick how you make them; your ancestry's bonus is added on top. Every method is fair, and any of them is fine."));
    const active: AbilityMethod = rollTab ? "rolled" : (input.abilityMethod ?? "archetype");
    const tabs = h("div", "lts-tabs");
    tabs.setAttribute("role", "tablist");
    for (const m of SCORE_METHODS) {
      const t = h("button", "lts-tab", METHOD_TITLE[m]);
      t.type = "button";
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(active === m));
      t.dataset.ltsMethod = m;
      t.dataset.fk = `method-${m}`;
      t.addEventListener("click", () => setMethod(m));
      tipOn(ctx, t, {
        title: METHOD_TITLE[m],
        lines: [
          m === "archetype"
            ? "The class's ready-made spread: the standard array (15, 14, 13, 12, 10, 8) handed out in the order this class likes. Nothing to decide."
            : m === "standard"
              ? "Take 15, 14, 13, 12, 10 and 8 and place each one on an ability yourself. Each number is used once."
              : m === "pointBuy"
                ? `Every score starts at 8 and you spend ${POINT_BUY_BUDGET} points to raise them, up to 15. Going from 13 to 14 or 14 to 15 costs 2 points a step; every step before that costs 1.`
                : "Throw four six-sided dice for each ability and keep the best three. It can come out better or worse than the others. Rolling again throws a fresh set.",
        ],
        footer: APPLIES_LABEL,
      });
      tabs.append(t);
    }
    into.append(tabs);

    const archetype = getArchetype(input.archetypeId);
    const ancestry = input.ancestryId !== undefined ? getAncestry(input.ancestryId) : undefined;
    const base = input.baseScores ?? { ...archetype.baseAbilityScores };
    const inc = ancestryIncreaseFor(ancestry, input.ancestryIncreases);
    const fin = finalScores(base, ancestry, input.ancestryIncreases);

    if (active === "pointBuy") {
      const spent = pointBuyCost(base) ?? 0;
      const bud = h("div", "lts-budget");
      bud.dataset.ltsBudget = "";
      const meter = h("div", "lts-meter");
      const mi = h("i");
      mi.style.width = `${Math.min(100, Math.round((spent / POINT_BUY_BUDGET) * 100))}%`;
      meter.append(mi);
      bud.append(h("b", undefined, `${POINT_BUY_BUDGET - spent} of ${POINT_BUY_BUDGET} points left`), meter);
      tipOn(ctx, bud, { title: "Point buy budget", lines: [`You have ${POINT_BUY_BUDGET} points. Raising a score from 8 to 13 costs 1 point a step; 13 to 14 and 14 to 15 cost 2 a step. You have spent ${spent}.`], footer: APPLIES_LABEL });
      into.append(bud);
    }

    if (active === "rolled") {
      const box = h("section", "lts-card");
      box.append(heading(ctx, "Roll 4d6, drop the lowest"));
      const btn = h("button", "lts-btn pri", rollBusy ? "Rolling..." : rolled ? "Roll again" : "Roll the dice");
      btn.type = "button";
      btn.disabled = rollBusy;
      btn.dataset.ltsAct = "roll";
      btn.dataset.fk = "roll";
      btn.addEventListener("click", () => void doRoll());
      box.append(btn);
      if (!rolled) {
        box.append(h("p", "lts-lede", `Until you roll, your scores stay as they are (${METHOD_TITLE[input.abilityMethod ?? "archetype"].toLowerCase()}). Rolling throws six groups of four dice${api.rollDice ? " in the dice tray" : ""}.`));
      } else {
        const grid = h("div", "lts-dice");
        grid.style.marginTop = "8px";
        rolled.dice.forEach((group, i) => {
          const { total, dropped } = dropLowest(group);
          const cell = h("div", "lts-card lts-roll");
          cell.dataset.ltsRolled = String(i);
          const d = h("span", "d");
          group.forEach((v, j) => d.append(h("i", j === dropped ? "x" : "", String(v))));
          cell.append(d, h("span", "t", String(total)));
          tipOn(ctx, cell, { title: `Roll ${i + 1}: ${total}`, lines: [`Four dice came up ${group.join(", ")}. The lowest (${group[dropped]}) is dropped and the other three add up to ${total}.`], footer: APPLIES_LABEL });
          grid.append(cell);
        });
        box.append(grid);
      }
      into.append(box);
    }

    // The table: base (the control), ancestry, final, modifier.
    const card = h("section", "lts-card");
    card.append(heading(ctx, "Your scores"));
    const table = h("div", "lts-table");
    table.dataset.ltsScores = "";
    table.append(h("span", "hd", "Ability"), h("span", "hd", active === "pointBuy" ? "Buy" : "Base"), h("span", "hd c", "Anc."), h("span", "hd c", "Final"), h("span", "hd c", "Mod"));
    ABILITY_KEYS.forEach((k, i) => {
      const name = h("span", undefined, ABILITY_NAME[k].slice(0, 12));
      const ctl = h("div", "lts-ctl");
      ctl.dataset.ltsBase = k;
      if (active === "standard") {
        const sel = h("select", "lts-sel");
        sel.dataset.fk = `std-${k}`;
        sel.setAttribute("aria-label", `${ABILITY_NAME[k]} base score`);
        for (const v of STANDARD_ARRAY) {
          const o = h("option", undefined, String(v));
          o.value = String(v);
          o.selected = base[k] === v;
          sel.append(o);
        }
        sel.addEventListener("change", () => set({ abilityMethod: "standard", baseScores: swapScore(base, k, Number(sel.value)) }));
        ctl.append(sel);
      } else if (active === "pointBuy") {
        const minus = h("button", "lts-btn sq", "-");
        minus.type = "button";
        minus.setAttribute("aria-label", `Lower ${ABILITY_NAME[k]}`);
        minus.dataset.fk = `pb-minus-${k}`;
        minus.disabled = adjustPointBuy(base, k, -1) === base;
        minus.addEventListener("click", () => set({ abilityMethod: "pointBuy", baseScores: adjustPointBuy(base, k, -1) }));
        const plus = h("button", "lts-btn sq", "+");
        plus.type = "button";
        plus.setAttribute("aria-label", `Raise ${ABILITY_NAME[k]}`);
        plus.dataset.fk = `pb-plus-${k}`;
        plus.disabled = adjustPointBuy(base, k, 1) === base;
        plus.addEventListener("click", () => set({ abilityMethod: "pointBuy", baseScores: adjustPointBuy(base, k, 1) }));
        const cost = pointCost(base[k]);
        const val = h("span", "v", String(base[k]));
        tipOn(ctx, val, { title: `${ABILITY_NAME[k]} ${base[k]}`, lines: [`This score costs ${cost ?? 0} ${plural(cost ?? 0, "point")} in total (8 is free, 13 is 5, 14 is 7, 15 is 9).`], footer: APPLIES_LABEL });
        ctl.append(minus, val, plus);
      } else if (active === "rolled" && rolled) {
        const sel = h("select", "lts-sel");
        sel.dataset.fk = `rolled-${k}`;
        sel.setAttribute("aria-label", `${ABILITY_NAME[k]} rolled score`);
        rolled.scores.forEach((s, j) => {
          const o = h("option", undefined, `${s} (roll ${j + 1})`);
          o.value = String(j);
          o.selected = assign[i] === j;
          sel.append(o);
        });
        sel.addEventListener("change", () => {
          assign = swapAssign(assign, i, Number(sel.value));
          applyRolled();
        });
        ctl.append(sel);
      } else {
        ctl.append(h("span", "v", String(base[k])));
      }
      const ancTxt = h("span", "c lts-muted", inc[k] ? signed(inc[k]!) : "0");
      tipOn(ctx, ancTxt, {
        title: `${ABILITY_NAME[k]} from ${ancestry?.name ?? "no ancestry"}`,
        lines: [inc[k] ? `${ancestry?.name} adds ${signed(inc[k]!)} to ${ABILITY_NAME[k]}.` : `${ancestry?.name ?? "No ancestry"} adds nothing to ${ABILITY_NAME[k]}.`],
        footer: APPLIES_LABEL,
      });
      const fnl = h("span", "c f", String(fin[k]));
      fnl.dataset.ltsFinal = k;
      tipOn(ctx, fnl, { title: `${ABILITY_NAME[k]} ${fin[k]}`, lines: [`${base[k]} base ${inc[k] ? `${signed(inc[k]!)} ancestry ` : ""}= ${fin[k]}${base[k] + (inc[k] ?? 0) > ABILITY_SCORE_CAP ? `, held at the ceiling of ${ABILITY_SCORE_CAP}` : ""}.`], footer: APPLIES_LABEL });
      const md = h("span", "c f", signed(abilityModifier(fin[k])));
      tipOn(ctx, md, { title: `${ABILITY_NAME[k]} modifier ${signed(abilityModifier(fin[k]))}`, lines: [`(${fin[k]} - 10) / 2, rounded down. It is the number that goes on your rolls.`], footer: APPLIES_LABEL });
      table.append(name, ctl, ancTxt, fnl, md);
    });
    card.append(table);
    into.append(card);
    if (active === "archetype") into.append(h("p", "lts-note", "These are the class's own ready-made scores. Switch to another method above to place them yourself."));
  }

  // ---- step 5: skills ----

  function skillChip(skill: string, state: { on: boolean; disabled: boolean; locked?: string; onClick?: () => void; expertise?: boolean }): HTMLElement {
    const b = h("button", `lts-skill${state.locked ? " locked" : ""}`);
    b.type = "button";
    b.dataset.ltsSkill = skill;
    b.dataset.fk = `skill-${skill}`;
    b.setAttribute("aria-pressed", String(state.on));
    b.disabled = state.disabled;
    b.append(h("span", undefined, skill), h("span", "b", skillBonusPreview(input, skill, state.expertise)));
    if (state.onClick) b.addEventListener("click", state.onClick);
    const ab = SKILL_ABILITY[skill];
    tipOn(ctx, b, {
      title: skill,
      lines: [SKILL_BLURB[skill] ?? "", `Runs on ${ab ? ABILITY_NAME[ab] : "an ability"}. The number beside it is what you would add to the roll at level 1.`, ...(state.locked ? [state.locked] : [])].filter(Boolean),
      footer: APPLIES_LABEL,
    });
    return b;
  }

  function buildSkills(into: HTMLElement): void {
    const archetype = getArchetype(input.archetypeId);
    const rule = CLASS_SKILL_CHOICES[archetype.chassis];
    const ancestry = input.ancestryId !== undefined ? getAncestry(input.ancestryId) : undefined;
    const sourceOf = skillSourcesOf(input);
    const classSel = new Set(input.classSkills ?? []);
    into.append(h("p", "lts-lede", "Being trained in a skill adds your proficiency bonus (+2) to it. A skill can only be trained once, so ones taken by another part of your hero are greyed out."));

    const cls = h("section", "lts-card");
    cls.append(heading(ctx, `Class skills: pick ${rule.count}`), h("p", "lts-lede", `${classSel.size} of ${rule.count} chosen from the ${plainClassName(archetype.displayName)} list.`));
    const grid = h("div", "lts-skillgrid");
    for (const s of rule.from) {
      const on = classSel.has(s);
      const other = sourceOf.get(s);
      const takenElsewhere = other !== undefined && other !== "class";
      grid.append(
        skillChip(s, {
          on,
          disabled: takenElsewhere,
          locked: takenElsewhere ? `Already trained through your ${SKILL_SOURCE_WORD[other!]}.` : undefined,
          onClick: () => {
            if (on) return;
            // At the count, pressing another skill replaces the oldest pick.
            const next = [...classSel, s];
            set({ classSkills: next.slice(-rule.count) });
          },
        }),
      );
    }
    cls.append(grid);
    if (classSel.size >= rule.count) cls.append(h("p", "lts-lede", "To swap one, press the skill you want instead: the oldest pick makes room."));
    into.append(cls);

    if (ancestry && (ancestry.skills?.length || ancestry.chooseSkills)) {
      const box = h("section", "lts-card");
      box.append(heading(ctx, `${ancestry.name} skills`));
      const g = h("div", "lts-skillgrid");
      for (const s of ancestry.skills ?? []) g.append(skillChip(s, { on: true, disabled: true, locked: `Always trained by being a ${ancestry.name}.` }));
      if (ancestry.chooseSkills) {
        const sel = new Set(input.ancestrySkills ?? []);
        box.append(h("p", "lts-lede", `Pick ${ancestry.chooseSkills} of any skill. ${sel.size} of ${ancestry.chooseSkills} chosen.`));
        for (const s of ALL_SKILLS) {
          const on = sel.has(s);
          const other = sourceOf.get(s);
          const takenElsewhere = other !== undefined && other !== "ancestry";
          g.append(
            skillChip(s, {
              on,
              disabled: takenElsewhere,
              locked: takenElsewhere ? `Already trained through your ${SKILL_SOURCE_WORD[other!]}.` : undefined,
              onClick: () => {
                if (on) return;
                set({ ancestrySkills: [...sel, s].slice(-ancestry.chooseSkills!) });
              },
            }),
          );
        }
      }
      box.append(g);
      into.append(box);
    }

    const bg = input.background;
    if (bg) into.append(h("p", "lts-note", `Your background (${bg.name}) trains ${bg.skills[0]} and ${bg.skills[1]}. Change them in the Background step.`));

    const expertise = creationChoicesFor(input.archetypeId, [...(input.classSkills ?? []), ...(ancestry?.skills ?? []), ...(input.ancestrySkills ?? []), ...(bg?.skills ?? [])]).find((c) => c.id === "expertiseSkill");
    if (expertise) {
      const box = h("section", "lts-card");
      box.append(heading(ctx, "Expertise"), h("p", "lts-lede", expertise.prompt));
      const g = h("div", "lts-skillgrid");
      for (const o of expertise.options) {
        g.append(
          skillChip(o.id, {
            on: input.choices?.expertiseSkill === o.id,
            disabled: false,
            expertise: true,
            onClick: () => set({ choices: { ...input.choices, expertiseSkill: o.id } }),
          }),
        );
      }
      box.append(g);
      into.append(box);
    }
  }

  // ---- step 6: background ----

  function textField(label: string, value: string | undefined, placeholder: string, max: number, apply: (v: string) => void, long = false): HTMLElement {
    const f = h("div", "lts-fld");
    const id = `lts-f-${label.replace(/\W+/g, "-").toLowerCase()}`;
    const lab = h("label", undefined, label);
    lab.htmlFor = id;
    const el: HTMLInputElement | HTMLTextAreaElement = long ? h("textarea", "lts-area") : h("input", "lts-input");
    el.id = id;
    el.value = value ?? "";
    el.placeholder = placeholder;
    el.maxLength = max;
    el.dataset.ltsField = label;
    if (el instanceof HTMLInputElement) el.autocomplete = "off";
    const count = h("span", "ct", `${(value ?? "").length} of ${max}`);
    el.addEventListener("input", () => {
      apply(el.value);
      count.textContent = `${el.value.length} of ${max}`;
      renderChrome();
    });
    f.append(lab, el, count);
    return f;
  }

  function setBackground(patch: Partial<Background>): void {
    const bg = input.background ?? { name: "Wanderer", skills: ["Perception", "Survival"] as [string, string] };
    // Text changes must not rebuild the page under the caret: only keep the draft up to date.
    input = { ...input, background: { ...bg, ...patch } as Background };
  }

  function buildBackground(into: HTMLElement): void {
    into.append(h("p", "lts-lede", "Who your hero was before the adventure. Every line is optional and in your own words; a background trains two skills."));
    if (!input.background) {
      const b = h("button", "lts-btn", "Give my hero a background");
      b.type = "button";
      b.dataset.ltsAct = "add-background";
      b.addEventListener("click", () => {
        showSkippedBackground = false;
        set({ background: { name: "Wanderer", skills: ["Perception", "Survival"] } });
      });
      into.append(b);
    } else {
      const bg = input.background;
      const card = h("section", "lts-card");
      card.append(heading(ctx, "Background"));
      const col = h("div", "lts-col");
      col.append(
        textField("Name", bg.name, "Soldier, Hermit, Street urchin...", BACKGROUND_NAME_MAX, (v) => setBackground({ name: v })),
      );
      const two = h("div", "lts-two");
      const sourceOf = skillSourcesOf(input);
      for (const slot of [0, 1] as const) {
        const f = h("div", "lts-fld");
        const lab = h("label", undefined, `Skill ${slot + 1}`);
        const sel = h("select", "lts-sel");
        sel.dataset.fk = `bg-skill-${slot}`;
        sel.dataset.ltsBgSkill = String(slot);
        sel.id = `lts-bg-skill-${slot}`;
        lab.htmlFor = sel.id;
        for (const s of ALL_SKILLS) {
          const o = h("option", undefined, s);
          o.value = s;
          const held = sourceOf.get(s);
          const mine = bg.skills[slot] === s;
          o.disabled = !mine && held !== undefined;
          if (!mine && held !== undefined) o.textContent = `${s} (already trained: ${SKILL_SOURCE_WORD[held]})`;
          o.selected = mine;
          sel.append(o);
        }
        sel.addEventListener("change", () => {
          const pair: [string, string] = [bg.skills[0], bg.skills[1]];
          pair[slot] = sel.value;
          set({ background: { ...bg, skills: pair } });
        });
        tipOn(ctx, sel, { title: `Background skill ${slot + 1}`, lines: ["A background trains two skills. A skill your class or ancestry already trains cannot be taken again, so it is greyed out."], footer: APPLIES_LABEL });
        f.append(lab, sel);
        two.append(f);
      }
      col.append(two);
      const words = h("div", "lts-two");
      words.append(
        textField("Personality trait", bg.personalityTrait, "I always have a plan for what to do when things go wrong.", BACKGROUND_TEXT_MAX, (v) => setBackground({ personalityTrait: v }), true),
        textField("Ideal", bg.ideal, "Freedom. Chains are meant to be broken.", BACKGROUND_TEXT_MAX, (v) => setBackground({ ideal: v }), true),
        textField("Bond", bg.bond, "I would do anything for the people who took me in.", BACKGROUND_TEXT_MAX, (v) => setBackground({ bond: v }), true),
        textField("Flaw", bg.flaw, "I cannot walk away from a dare.", BACKGROUND_TEXT_MAX, (v) => setBackground({ flaw: v }), true),
      );
      col.append(words);
      card.append(col);
      into.append(card);
      const skip = h("button", "lts-btn", "Leave out the background");
      skip.type = "button";
      skip.dataset.ltsAct = "skip-background";
      skip.addEventListener("click", () => {
        showSkippedBackground = true;
        set({ background: undefined });
      });
      into.append(skip);
    }
    if (showSkippedBackground && !input.background) into.append(h("p", "lts-note", "No background: your hero keeps only the skills from class and ancestry."));

    const al = h("section", "lts-card");
    al.append(heading(ctx, "Alignment"));
    const f = h("div", "lts-fld");
    const lab = h("label", undefined, "How your hero tends to act");
    const sel = h("select", "lts-sel");
    sel.id = "lts-alignment";
    sel.dataset.ltsField = "Alignment";
    sel.dataset.fk = "alignment";
    lab.htmlFor = sel.id;
    for (const a of ALIGNMENTS) {
      const o = h("option", undefined, a);
      o.value = a;
      o.selected = input.alignment === a;
      sel.append(o);
    }
    sel.addEventListener("change", () => set({ alignment: sel.value }));
    tipOn(ctx, sel, { title: "Alignment", lines: ["A short label: lawful to chaotic, good to evil. It changes no number on your sheet; the DM may play to it."], footer: DM_RULES_LABEL });
    f.append(lab, sel, h("span", "lts-muted", ALIGNMENT_BLURB[input.alignment ?? ""] ?? ""));
    al.append(f);
    into.append(al);
  }

  // ---- step 1: name and backstory ----

  function buildName(into: HTMLElement): void {
    into.append(h("p", "lts-lede", "Every hero starts with a name. Type one to go on."));
    const card = h("section", "lts-card");
    card.append(heading(ctx, "Name and backstory"));
    const col = h("div", "lts-col");
    const nameField = textField("Name", input.name, "What do people call your hero?", 60, (v) => {
      input = { ...input, name: v };
    });
    nameField.querySelector("input")?.setAttribute("aria-required", "true");
    col.append(
      nameField,
      textField("Backstory", input.backstory, "Raised on a salt farm, left after the flood, owes a boatman a favor...", BACKSTORY_MAX, (v) => {
        input = { ...input, backstory: v };
      }, true),
    );
    card.append(col);
    into.append(card);
  }

  // ---- step 7: review ----

  function buildReview(into: HTMLElement, pv: { sheet: CharacterSheet | null; errors: string[] }): void {
    if (pv.errors.length) {
      const ul = h("ul", "lts-errs");
      ul.setAttribute("role", "alert");
      for (const e of pv.errors) {
        const li = h("li");
        const go1 = h("button", "lts-btn", `Fix on the ${CREATION_STEPS.find((s) => s.id === stepForError(e))?.label ?? "Review"} step`);
        go1.type = "button";
        go1.addEventListener("click", () => go(stepForError(e)));
        li.append(document.createTextNode(`${e.endsWith(".") ? e : `${e}.`} `), go1);
        ul.append(li);
      }
      into.append(ul);
    }
    if (pv.sheet) {
      into.append(h("p", "lts-lede", "This is your sheet. Hover or tap any number to see where it came from, then press Begin."));
      const content = sheetBody(ctx, pv.sheet, { portrait: api.portrait?.(input.archetypeId) ?? null });
      content.style.padding = "0";
      content.style.maxWidth = "none";
      // Auto side margins would shrink it to its content inside this flex column.
      content.style.margin = "0";
      into.append(content);
    }
  }

  // ---- keys and lifecycle ----

  const stopKeys = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && tipIsUp()) return;
    e.stopPropagation();
  };
  root.addEventListener("keydown", stopKeys);
  root.addEventListener("keyup", stopKeys);
  root.addEventListener("keypress", stopKeys);

  const view: CreationView & { close(cancelled?: boolean): void } = {
    el: root,
    setStyle(next) {
      if (closed || next === style) return;
      style = next;
      render();
    },
    close(cancelled = false) {
      if (closed) return;
      closed = true;
      clearTips(ctx);
      root.remove();
      restorePosition();
      if (cancelled) opts.onCancel();
    },
  };

  render(true);
  host.appendChild(root);
  root.focus({ preventScroll: true });
  return view;
}
