/**
 * The context action catalog: what a right-click or long-press on a target
 * offers THIS character, right now.
 *
 * Pure data in, list out: no DOM, no dice, no world. It decides which actions
 * exist for a (target, situation) pair, whether each is available, and says in
 * plain words why not. It does not resolve anything. Each action names who
 * resolves it:
 *
 *  - "engine": the rules engine rolls it and applies the result to the board
 *    (damage, a push, hidden, a lock opening, a body's loot).
 *  - "dm": the DM rules on it as a check. The result is words only. A DM-
 *    resolved action never promises a board change, because the kick bug was
 *    exactly that: the DM narrated a knock-back the board never saw.
 *
 * Two kinds of gating, kept apart on purpose:
 *
 *  1. Eligibility: class and skill. An action your character cannot attempt at
 *     all (Pick the lock for a Knight, Pickpocket for an untrained wizard) is
 *     OMITTED, so the menu reflects YOUR character rather than a wall of
 *     greyed rows. Anyone-can-try actions are never omitted for lack of
 *     training; training only marks them (`good`, and the `why` line).
 *  2. Availability: the fight, the geometry. An action you could attempt but
 *     cannot right now (off turn, action spent, too far, cannot see it) is
 *     shown DISABLED with a `reason` in plain words.
 *
 * Honesty rule (equipmentTypes.ts rule 7): every `why`, `say` and `reason`
 * states its real number. `bonus` is the exact number the roll adds; whoever
 * resolves the action must use it rather than recompute it. Nothing here
 * implies an effect the engine does not apply.
 *
 * Class features the engine does NOT have are deliberately absent, and the
 * list matters: Second Wind, Sneak Attack and Turn Undead have no code behind
 * them (rules/rulebook.ts says so in as many words), so offering them would
 * be a promise with nothing behind it. The one real class feature wired in is
 * Cunning Action: from level 2 a rogue's Hide costs a bonus action, and Hide
 * is engine-resolved, so the cheaper cost is true.
 *
 * Rules content is SRD 5.1 (CC BY 4.0, see NOTICE.md); wording is ours. One
 * house rule, named: a conversation reaches 30 feet (TALK_RANGE_TILES), since
 * SRD 5.1 gives speech no range.
 */
import type { CharacterSheet } from "../characters/creation";
import { SKILL_ABILITY } from "../characters/creation";
import { getAncestry } from "../characters/ancestries";
import { equipmentCheckBonus } from "../characters/equipment";
import { castableSpells, castingAbilityFor, spellAttackBonus } from "../menu/casting";
import { FEET_PER_TILE } from "../menu/combatRound";
import { attackerBonusFor, skillModifierFor, weaponDamageNotationFor, weaponFor } from "./combat";
import { DEFAULT_MELEE_REACH_TILES } from "../world/reach";

// --- the public shapes -----------------------------------------------------

export type ContextTargetKind = "self" | "creature" | "body" | "door" | "chest" | "prop" | "floor";

export interface ContextTarget {
  kind: ContextTargetKind;
  id?: string;
  /** Reads inside a sentence: "the goblin", "the oak door". The caller passes the label the player already sees. */
  name: string;
  /** Chebyshev tiles from the hero, as the rest of the board measures it. 0 for yourself. */
  distanceTiles: number;
  inSight: boolean;
  creature?: {
    hostile: boolean;
    awake: boolean;
    awareOfHero: boolean;
    /** SRD creature type, with any subtype: "humanoid (goblinoid)", "beast". */
    type: string;
    /** SRD size: "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan". */
    size: string;
    down: boolean;
    humanoid: boolean;
    prone?: boolean;
    passivePerception: number;
  };
  door?: { open: boolean; locked: boolean; lockDc?: number };
  /** `harvestable`: the body is of something that yields a part (rules/corpses.ts harvestForToken is not null). A beast alone is not enough. */
  body?: { looted: boolean; harvested: boolean; beast: boolean; harvestable: boolean };
  searched?: boolean;
  /** A chest the Open line works on (a scene's own container). Doors are always openable; a searchable feature of an adventure is searched, not opened. */
  openable?: boolean;
}

export interface ContextSituation {
  sheet: CharacterSheet;
  inFight: boolean;
  heroTurn: boolean;
  actionReady: boolean;
  bonusReady: boolean;
  movementFt: number;
  heroHidden: boolean;
  heroDown: boolean;
  potions?: number;
}

export type ContextResolver = "engine" | "dm";

export interface ContextAction {
  id: string;
  label: string;
  resolver: ContextResolver;
  /** The skill (or tool) the roll uses, when there is a roll. */
  skill?: string;
  ability?: string;
  /** The exact number the roll adds. The resolver uses this and does not recompute it. */
  bonus?: number;
  /** The SRD cost in a fight. Outside a fight nothing is spent. */
  cost: "free" | "object" | "action" | "bonus" | "move";
  /**
   * The plain numbers behind the line, when there are any: "Stealth +5, expertise", "Rogue, Stealth +5", "Longsword +4, 1d8+4".
   * Absent for a line with nothing to add (Look closer, Talk, Loot). Never explains that anyone may try it.
   */
  why?: string;
  /** You are especially good at this (expertise, or a bonus of GOOD_BONUS or more). */
  good?: boolean;
  /** First-person words for the DM or the log: "I try to pick the goblin's pocket". */
  say: string;
  enabled: boolean;
  /** Plain words, present exactly when `enabled` is false. */
  reason?: string;
  needsAdjacent?: boolean;
  /**
   * Set when the only thing in the way is distance: how many tiles beyond reach the target is. The menu may then offer to walk
   * there first (and run the action on arrival). Absent when anything else blocks it, since walking would not help.
   */
  farBy?: number;
}

// --- tuning ----------------------------------------------------------------

/** A bonus this high or higher on the roll marks an action as one you are good at. +5 is a trained level-1 character with a 16 in the ability. */
export const GOOD_BONUS = 5;

/** House rule: 30 feet, 6 tiles. SRD 5.1 gives speech no range. */
export const TALK_RANGE_TILES = 6;

/** SRD sizes in order: a Shove or Grapple reaches a target at most one size larger than you. */
const SIZE_ORDER = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"] as const;

/** Creature types that hold a conversation. Beasts, oozes, plants, constructs, elementals and undead are not among them. */
const TALKING_TYPES: readonly string[] = ["humanoid", "giant", "dragon", "fiend", "celestial", "fey"];

/** The skill that recalls lore about a creature type: SRD 5.1's skill descriptions, sorted by what each skill covers. */
const LORE_SKILL_BY_TYPE: Readonly<Record<string, string>> = {
  construct: "Arcana",
  elemental: "Arcana",
  aberration: "Arcana",
  fey: "Arcana",
  undead: "Religion",
  fiend: "Religion",
  celestial: "Religion",
  beast: "Nature",
  plant: "Nature",
  ooze: "Nature",
  monstrosity: "Nature",
  humanoid: "History",
  giant: "History",
  dragon: "History",
};

export const CONTEXT_ACTION_IDS: readonly string[] = Object.freeze([
  "look",
  "attack",
  "open",
  "drink-potion",
  "talk",
  "loot",
  "harvest",
  "search",
  "kick",
  "shove",
  "grapple",
  "hide",
  "sneak",
  "sneak-up",
  "pickpocket",
  "pick-lock",
  "force-door",
  "listen",
  "threaten",
  "parley",
  "bluff",
  "read-intent",
  "calm-beast",
  "recall-lore",
  "read-runes",
  "track",
  "stabilize",
  "cast",
]);

/** Menu order when a hostile creature is in your face: the fight first. */
const COMBAT_ORDER: readonly string[] = [
  "stabilize", "attack", "cast", "kick", "shove", "grapple", "hide", "bluff", "threaten", "parley", "read-intent",
  "calm-beast", "recall-lore", "talk", "pickpocket", "sneak-up",
];

/** Menu order for everything else: the quiet verbs first. */
const CALM_ORDER: readonly string[] = [
  "stabilize", "open", "drink-potion", "attack", "loot", "harvest", "pick-lock", "force-door", "listen", "search", "read-runes", "track", "talk",
  "pickpocket", "sneak-up", "parley", "bluff", "threaten", "read-intent", "calm-beast", "recall-lore", "cast",
  "kick", "shove", "grapple", "hide", "sneak",
];

// --- small helpers ---------------------------------------------------------

// Built from code points so this file never contains the glyphs itself.
const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, "g");
const CURLY_APOSTROPHE = String.fromCharCode(0x2019);
const THIEVES_TOOLS = new RegExp(`thieves['${CURLY_APOSTROPHE}]?\\s*tools`, "i");

/** Commas only: a name can come from anywhere and no dash glyph may reach a menu. */
function clean(text: string): string {
  return text.replace(LONG_DASHES, ", ").replace(/\s+/g, " ").trim();
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `-${Math.abs(n)}`;
}

function baseType(type: string): string {
  return (type.split("(")[0] ?? "").trim().toLowerCase();
}

function canTalk(c: NonNullable<ContextTarget["creature"]>): boolean {
  return c.humanoid || TALKING_TYPES.includes(baseType(c.type));
}

function className(sheet: CharacterSheet): string {
  return sheet.chassis.charAt(0).toUpperCase() + sheet.chassis.slice(1);
}

function isCaster(sheet: CharacterSheet): boolean {
  return sheet.chassis === "cleric" || sheet.chassis === "wizard";
}

function heroSize(sheet: CharacterSheet): string {
  return (sheet.ancestryId ? getAncestry(sheet.ancestryId)?.size : undefined) ?? "Medium";
}

function sizeIndex(size: string): number {
  const i = (SIZE_ORDER as readonly string[]).indexOf(size);
  return i === -1 ? 2 : i;
}

function hasThievesTools(sheet: CharacterSheet): boolean {
  return sheet.inventory.some((item) => THIEVES_TOOLS.test(item));
}

interface SkillFacts {
  skill: string;
  bonus: number;
  trained: boolean;
  expertise: boolean;
  good: boolean;
  ability: string;
}

function skillFacts(sheet: CharacterSheet, skill: string): SkillFacts {
  const entry = sheet.skills.find((s) => s.skill === skill);
  const bonus = skillModifierFor(sheet, skill);
  const expertise = entry?.expertise === true;
  return {
    skill,
    bonus,
    trained: entry !== undefined,
    expertise,
    good: expertise || bonus >= GOOD_BONUS,
    ability: SKILL_ABILITY[skill] ?? "",
  };
}

/** "Stealth +5, expertise" / "Athletics +4, trained" / "Persuasion +1". With a class tag in front when the class is why you see it. Just the number a roll will add; nothing about who may try it. */
function whyFor(f: SkillFacts, classTag?: string): string {
  const core = `${f.skill} ${signed(f.bonus)}`;
  const training = f.expertise ? ", expertise" : f.trained ? ", trained" : "";
  if (classTag) return `${classTag}, ${core}${training}`;
  return `${core}${training}`;
}

// --- the gate every action passes through ---------------------------------

interface Def {
  id: string;
  label: string;
  resolver: ContextResolver;
  cost: ContextAction["cost"];
  why?: string;
  say: string;
  skill?: string;
  ability?: string;
  bonus?: number;
  good?: boolean;
  needsAdjacent?: boolean;
  /** Needs a clear look at the target, even from a distance. */
  needsSight?: boolean;
  /** Needs the target within talking distance (and in sight). */
  needsVoice?: boolean;
  /** Takes minutes, not a moment: not in a fight. */
  noFight?: boolean;
  /** A reason specific to this action and this target, checked last. */
  blocked?: string | null;
}

function tooFar(target: ContextTarget): string {
  const feet = target.distanceTiles * FEET_PER_TILE;
  return `Too far away: ${feet} feet. Move next to it first.`;
}

function finish(def: Def, target: ContextTarget, sit: ContextSituation): ContextAction {
  let reason: string | undefined;
  let farBy: number | undefined;
  if (sit.heroDown) reason = "You are down. You cannot act until you are back on your feet.";
  else if (sit.inFight && !sit.heroTurn) reason = "Not your turn.";
  else if (sit.inFight && def.cost === "action" && !sit.actionReady) reason = "You have already used your action this turn.";
  else if (sit.inFight && def.cost === "bonus" && !sit.bonusReady) reason = "You have already used your bonus action this turn.";
  else if (sit.inFight && def.cost === "move" && sit.movementFt <= 0) reason = "You have no movement left this turn.";
  else if (sit.inFight && def.noFight) reason = "That takes more than a moment. Finish the fight first.";
  else if (def.needsAdjacent && target.distanceTiles > DEFAULT_MELEE_REACH_TILES) {
    reason = tooFar(target);
    farBy = target.distanceTiles - DEFAULT_MELEE_REACH_TILES;
  } else if (def.needsVoice && target.distanceTiles > TALK_RANGE_TILES) {
    reason = `Too far away to talk: ${target.distanceTiles * FEET_PER_TILE} feet, and a conversation reaches ${TALK_RANGE_TILES * FEET_PER_TILE} feet.`;
    farBy = target.distanceTiles - TALK_RANGE_TILES;
  } else if ((def.needsSight || def.needsVoice) && !target.inSight) reason = "You cannot see it from here.";
  else if (def.blocked) reason = def.blocked;
  // Distance only counts as the way in if nothing else would still block the action once the hero had walked up to it.
  if (farBy !== undefined && (((def.needsSight || def.needsVoice) && !target.inSight) || def.blocked)) farBy = undefined;

  const action: ContextAction = {
    id: def.id,
    label: def.label,
    resolver: def.resolver,
    cost: def.cost,
    say: def.say,
    enabled: reason === undefined,
  };
  if (def.why !== undefined) action.why = def.why;
  if (farBy !== undefined) action.farBy = farBy;
  if (def.skill !== undefined) action.skill = def.skill;
  if (def.ability !== undefined) action.ability = def.ability;
  if (def.bonus !== undefined) action.bonus = def.bonus;
  if (def.good) action.good = true;
  if (def.needsAdjacent) action.needsAdjacent = true;
  if (reason !== undefined) action.reason = reason;
  return action;
}

// --- the catalog, per target ----------------------------------------------

/** Targets a character walks up to before looking closer: a thing, not a person and not the open floor. */
const LOOK_WALKS_UP: readonly ContextTargetKind[] = ["body", "door", "chest", "prop"];

function lookCloser(target: ContextTarget, sit: ContextSituation): ContextAction {
  const self = target.kind === "self";
  const action: ContextAction = {
    id: "look",
    label: "Look closer",
    resolver: "dm",
    cost: "free",
    say: self ? `I check myself over, ${clean(sit.sheet.name)}.` : `I take a closer look at ${clean(target.name)}.`,
    enabled: true,
  };
  // A thing is looked at from beside it: the menu walks the hero there first when it is further off than that.
  if (LOOK_WALKS_UP.includes(target.kind) && target.distanceTiles > DEFAULT_MELEE_REACH_TILES) action.farBy = target.distanceTiles - DEFAULT_MELEE_REACH_TILES;
  return action;
}

/** Athletics contests (Shove, Grapple) share their size rule. */
function sizeBlock(sheet: CharacterSheet, c: NonNullable<ContextTarget["creature"]>, name: string, verb: string): string | null {
  if (sizeIndex(c.size) > sizeIndex(heroSize(sheet)) + 1) {
    return `${name} is too big to ${verb}: ${c.size}. You can only ${verb} something at most one size larger than you.`;
  }
  return null;
}

function loreDef(sheet: CharacterSheet, type: string, name: string): Def | null {
  const skill = LORE_SKILL_BY_TYPE[baseType(type)] ?? "History";
  const lore = skillFacts(sheet, skill);
  if (!lore.trained) return null;
  return {
    id: "recall-lore",
    label: "Recall lore",
    resolver: "dm",
    cost: "free",
    skill,
    ability: lore.ability,
    bonus: lore.bonus,
    good: lore.good,
    why: whyFor(lore),
    say: `I try to recall what I know about ${name}.`,
  };
}

function creatureDefs(target: ContextTarget, sit: ContextSituation): Def[] {
  const c = target.creature;
  if (!c) return [];
  const { sheet } = sit;
  const name = clean(target.name);
  const out: Def[] = [];
  const rogue = sheet.chassis === "rogue";
  const watching = c.awake && c.awareOfHero;

  // A creature that is down (dying) is helped, not fought.
  if (c.down) {
    const med = skillFacts(sheet, "Medicine");
    out.push({
      id: "stabilize",
      label: "Stabilize",
      resolver: "engine",
      cost: "action",
      skill: "Medicine",
      ability: "wis",
      bonus: med.bonus,
      good: med.good,
      why: `${whyFor(med)}, DC 10`,
      say: `I kneel and try to stabilize ${name}.`,
      needsAdjacent: true,
    });
    return out;
  }

  // Talk and the social checks: an awake creature that can answer.
  if (c.awake && canTalk(c)) {
    out.push({
      id: "talk",
      label: "Talk",
      resolver: "dm",
      cost: "free",
      say: `I speak to ${name}.`,
      needsVoice: true,
    });
    const per = skillFacts(sheet, "Persuasion");
    out.push({
      id: "parley",
      label: "Parley",
      resolver: "dm",
      cost: "action",
      skill: "Persuasion",
      ability: "cha",
      bonus: per.bonus,
      good: per.good,
      why: whyFor(per),
      say: `I try to talk ${name} round.`,
      needsVoice: true,
    });
    const dec = skillFacts(sheet, "Deception");
    out.push({
      id: "bluff",
      label: sit.inFight ? "Feint" : "Bluff",
      resolver: "dm",
      cost: "action",
      skill: "Deception",
      ability: "cha",
      bonus: dec.bonus,
      good: dec.good,
      why: whyFor(dec),
      say: sit.inFight ? `I feint at ${name} to throw it off.` : `I bluff ${name}.`,
      needsVoice: true,
    });
    const intim = skillFacts(sheet, "Intimidation");
    out.push({
      id: "threaten",
      label: "Threaten",
      resolver: "dm",
      cost: "action",
      skill: "Intimidation",
      ability: "cha",
      bonus: intim.bonus,
      good: intim.good,
      why: whyFor(intim),
      say: `I threaten ${name}.`,
      needsVoice: true,
    });
  }

  // Insight reads any awake creature, talker or not.
  if (c.awake) {
    const ins = skillFacts(sheet, "Insight");
    out.push({
      id: "read-intent",
      label: "Read its intent",
      resolver: "dm",
      cost: "action",
      skill: "Insight",
      ability: "wis",
      bonus: ins.bonus,
      good: ins.good,
      why: whyFor(ins),
      say: `I study ${name} to work out what it wants.`,
      needsSight: true,
    });
  }

  // Calm the beast: Animal Handling, trained only.
  if (c.awake && baseType(c.type) === "beast") {
    const ah = skillFacts(sheet, "Animal Handling");
    if (ah.trained) {
      out.push({
        id: "calm-beast",
        label: "Calm the beast",
        resolver: "dm",
        cost: "action",
        skill: "Animal Handling",
        ability: "wis",
        bonus: ah.bonus,
        good: ah.good,
        why: whyFor(ah),
        say: `I try to calm ${name}.`,
        needsVoice: true,
      });
    }
  }

  // Recall lore: the skill that matches what it is, trained only.
  const lore = loreDef(sheet, c.type, name);
  if (lore) out.push(lore);

  // Spellcasting routes to the existing Cast menu.
  if (isCaster(sheet)) out.push(castDef(sheet, name, target));

  // Hands-on: only against creatures that are a threat to you.
  if (c.hostile) {
    out.push(attackDef(sheet, name));
    const ath = skillFacts(sheet, "Athletics");
    const str = sheet.modifiers.str;
    const kickBonus = str + sheet.proficiencyBonus;
    const kickDamage = Math.max(0, 1 + str);
    out.push({
      id: "kick",
      label: "Kick",
      resolver: "engine",
      cost: "action",
      ability: "str",
      bonus: kickBonus,
      good: kickBonus >= GOOD_BONUS,
      why: `Unarmed strike: ${signed(kickBonus)} to hit, ${kickDamage} bludgeoning damage`,
      say: `I kick ${name}.`,
      needsAdjacent: true,
    });
    out.push({
      id: "shove",
      label: "Shove",
      resolver: "engine",
      cost: "action",
      skill: "Athletics",
      ability: "str",
      bonus: ath.bonus,
      good: ath.good,
      why: `${whyFor(ath)} against its Athletics or Acrobatics`,
      say: `I shove ${name}.`,
      needsAdjacent: true,
      blocked: sizeBlock(sheet, c, name, "shove"),
    });
    out.push({
      id: "grapple",
      label: "Grapple",
      resolver: "dm",
      cost: "action",
      skill: "Athletics",
      ability: "str",
      bonus: ath.bonus,
      good: ath.good,
      // Monsters carry no condition list on the board, so a grapple cannot be
      // applied honestly yet. Say so rather than let the DM narrate one.
      why: `${whyFor(ath)} against its Athletics or Acrobatics. The DM decides what a grab does`,
      say: `I grapple ${name}.`,
      needsAdjacent: true,
      blocked: sizeBlock(sheet, c, name, "grapple"),
    });
  }

  // Hide from it.
  if (c.hostile && c.awake) {
    out.push(hideDef(sheet, sit, watching && target.inSight ? `${name} is looking right at you. Break its line of sight first.` : null, true));
  }

  // Pickpocket: a rogue, or anyone trained in Sleight of Hand, on something with pockets.
  if (c.humanoid) {
    const soh = skillFacts(sheet, "Sleight of Hand");
    if (rogue || soh.trained) {
      out.push({
        id: "pickpocket",
        label: "Pickpocket",
        resolver: "engine",
        cost: "action",
        skill: "Sleight of Hand",
        ability: "dex",
        bonus: soh.bonus,
        good: soh.good,
        why: `${whyFor(soh, rogue ? "Rogue" : undefined)} against its Perception`,
        say: `I try to pick ${name}'s pocket.`,
        needsAdjacent: true,
        blocked: watching ? `${name} is watching you. Hide, or wait until it looks away.` : null,
      });
    }
  }

  // Sneak up on something that has not noticed you.
  if (!c.awareOfHero && target.distanceTiles > DEFAULT_MELEE_REACH_TILES) {
    const st = skillFacts(sheet, "Stealth");
    out.push({
      id: "sneak-up",
      label: "Sneak up",
      resolver: "engine",
      cost: "move",
      skill: "Stealth",
      ability: "dex",
      bonus: st.bonus,
      good: st.good,
      why: `${whyFor(st, rogue ? "Rogue" : undefined)} against its Perception`,
      say: `I sneak up on ${name}.`,
    });
  }

  return out;
}

/** Swing the weapon in hand at it. The numbers are the ones the swing rolls: the weapon's name, what it adds to the d20, and its damage. */
function attackDef(sheet: CharacterSheet, name: string): Def {
  const weapon = weaponFor(sheet);
  const bonus = attackerBonusFor(sheet);
  return {
    id: "attack",
    label: "Attack",
    resolver: "engine",
    cost: "action",
    ability: weapon.ability,
    bonus,
    why: `${weapon.name} ${signed(bonus)}, ${weaponDamageNotationFor(sheet)}`,
    say: `I attack ${name}.`,
  };
}

function castDef(sheet: CharacterSheet, name: string, target: ContextTarget): Def {
  const ability = castingAbilityFor(sheet);
  const anyReady = castableSpells(sheet).some((s) => s.available);
  const atBonus = spellAttackBonus(sheet);
  const aimed = target.kind === "creature";
  return {
    id: "cast",
    label: "Cast a spell",
    resolver: "engine",
    cost: "action",
    ...(ability ? { ability } : {}),
    bonus: atBonus,
    why: `${className(sheet)}: spell attack ${signed(atBonus)}, save DC ${8 + atBonus}`,
    say: aimed ? `I cast a spell at ${name}.` : "I cast a spell.",
    needsSight: aimed,
    blocked: anyReady ? null : "You have no spell you can cast right now.",
  };
}

function hideDef(sheet: CharacterSheet, sit: ContextSituation, watchedReason: string | null, from = false): Def {
  const st = skillFacts(sheet, "Stealth");
  const cunning = sheet.chassis === "rogue" && sheet.level >= 2;
  const against = from ? " against its Perception" : "";
  return {
    id: "hide",
    label: "Hide",
    resolver: "engine",
    cost: cunning ? "bonus" : "action",
    skill: "Stealth",
    ability: "dex",
    bonus: st.bonus,
    good: st.good,
    why: `${cunning ? whyFor(st, "Rogue trick") : whyFor(st)}${against}`,
    say: "I try to hide.",
    blocked: sit.heroHidden ? "You are already hidden." : watchedReason,
  };
}

function sneakDef(sheet: CharacterSheet, target: ContextTarget): Def {
  const st = skillFacts(sheet, "Stealth");
  const rogue = sheet.chassis === "rogue";
  return {
    id: "sneak",
    label: "Sneak",
    resolver: "engine",
    cost: "move",
    skill: "Stealth",
    ability: "dex",
    bonus: st.bonus,
    good: st.good,
    why: whyFor(st, rogue ? "Rogue" : undefined),
    say: target.kind === "floor" ? "I sneak over there, quietly." : "I move quietly.",
  };
}

function searchDef(sheet: CharacterSheet, target: ContextTarget): Def {
  const inv = skillFacts(sheet, "Investigation");
  const per = skillFacts(sheet, "Perception");
  const best = per.bonus > inv.bonus ? per : inv;
  const name = clean(target.name);
  return {
    id: "search",
    label: "Search",
    resolver: "dm",
    cost: "action",
    skill: best.skill,
    ability: best.ability,
    bonus: best.bonus,
    good: best.good,
    why: whyFor(best),
    say: `I search ${name} carefully.`,
    needsAdjacent: true,
    blocked: target.searched ? "You have already searched this. Nothing new turns up." : null,
  };
}

function bodyDefs(target: ContextTarget, sit: ContextSituation): Def[] {
  const b = target.body;
  if (!b) return [];
  const { sheet } = sit;
  const name = clean(target.name);
  const out: Def[] = [];
  if (!b.looted) {
    out.push({
      id: "loot",
      label: "Loot",
      resolver: "engine",
      cost: "action",
      say: `I search ${name} for anything useful.`,
      needsAdjacent: true,
    });
  }
  if (b.beast && b.harvestable && !b.harvested) {
    const sur = skillFacts(sheet, "Survival");
    out.push({
      id: "harvest",
      label: "Harvest",
      resolver: "engine",
      cost: "action",
      skill: "Survival",
      ability: "wis",
      bonus: sur.bonus,
      good: sur.good,
      why: whyFor(sur),
      say: `I try to harvest what I can from ${name}.`,
      needsAdjacent: true,
      noFight: true,
    });
  }
  if (target.creature) {
    const lore = loreDef(sheet, target.creature.type, name);
    if (lore) out.push(lore);
  }
  return out;
}

function doorDefs(target: ContextTarget, sit: ContextSituation): Def[] {
  const d = target.door;
  if (!d || d.open) return [];
  const { sheet } = sit;
  const name = clean(target.name);
  const out: Def[] = [];

  out.push({
    id: "open",
    label: "Open",
    resolver: "engine",
    cost: "object",
    say: `I open ${name}.`,
    needsAdjacent: true,
    blocked: d.locked ? "It is locked." : null,
  });

  const per = skillFacts(sheet, "Perception");
  out.push({
    id: "listen",
    label: "Listen at the door",
    resolver: "engine",
    cost: "action",
    skill: "Perception",
    ability: "wis",
    bonus: per.bonus,
    good: per.good,
    why: whyFor(per),
    say: `I press an ear to ${name} and listen.`,
    needsAdjacent: true,
  });

  if (d.locked) {
    const ath = skillFacts(sheet, "Athletics");
    out.push({
      id: "force-door",
      label: "Force the door",
      resolver: "engine",
      cost: "action",
      skill: "Athletics",
      ability: "str",
      bonus: ath.bonus,
      good: ath.good,
      why: whyFor(ath),
      say: `I put my shoulder to ${name} and force it.`,
      needsAdjacent: true,
    });

    // Lockpicking: a rogue (thieves' tools proficiency is a rogue class
    // feature in SRD 5.1; the sheet has no tool proficiency field, so the
    // class IS the proof) who has the tools in the pack.
    if (sheet.chassis === "rogue") {
      const bonus = sheet.modifiers.dex + sheet.proficiencyBonus + equipmentCheckBonus(sheet);
      out.push({
        id: "pick-lock",
        label: "Pick the lock",
        resolver: "engine",
        cost: "action",
        skill: "Thieves' tools",
        ability: "dex",
        bonus,
        good: bonus >= GOOD_BONUS,
        why: `Rogue, thieves' tools ${signed(bonus)}`,
        say: `I get out my tools and pick the lock on ${name}.`,
        needsAdjacent: true,
        blocked: hasThievesTools(sheet) ? null : "You have no thieves' tools to pick it with.",
      });
    }
  }
  return out;
}

function chestDefs(target: ContextTarget, sit: ContextSituation): Def[] {
  const out: Def[] = [];
  if (target.openable && !target.searched) {
    out.push({
      id: "open",
      label: "Open",
      resolver: "engine",
      cost: "object",
      say: `I open ${clean(target.name)}.`,
      needsAdjacent: true,
    });
  }
  out.push(searchDef(sit.sheet, target));
  return out;
}

function propDefs(target: ContextTarget, sit: ContextSituation): Def[] {
  const { sheet } = sit;
  const name = clean(target.name);
  const out: Def[] = [searchDef(sheet, target)];
  const arc = skillFacts(sheet, "Arcana");
  if (sheet.chassis === "wizard" || arc.trained) {
    out.push({
      id: "read-runes",
      label: "Read the runes",
      resolver: "dm",
      cost: "action",
      skill: "Arcana",
      ability: "int",
      bonus: arc.bonus,
      good: arc.good,
      why: whyFor(arc, sheet.chassis === "wizard" ? "Wizard" : undefined),
      say: `I study ${name} for magic and markings.`,
      needsAdjacent: true,
      noFight: true,
    });
  }
  out.push(hideDef(sheet, sit, null));
  return out;
}

function floorDefs(target: ContextTarget, sit: ContextSituation): Def[] {
  const { sheet } = sit;
  const out: Def[] = [searchDef(sheet, target), sneakDef(sheet, target)];
  const sur = skillFacts(sheet, "Survival");
  if (sur.trained) {
    out.push({
      id: "track",
      label: "Track",
      resolver: "dm",
      cost: "action",
      skill: "Survival",
      ability: "wis",
      bonus: sur.bonus,
      good: sur.good,
      why: whyFor(sur),
      say: "I look for tracks on the ground.",
      noFight: true,
    });
  }
  out.push(hideDef(sheet, sit, null));
  return out;
}

function selfDefs(target: ContextTarget, sit: ContextSituation): Def[] {
  const { sheet } = sit;
  const out: Def[] = [hideDef(sheet, sit, null), sneakDef(sheet, target)];
  if (isCaster(sheet)) out.push(castDef(sheet, "yourself", target));
  const potions = sit.potions ?? 0;
  if (potions > 0) {
    out.push({
      id: "drink-potion",
      label: "Drink a potion",
      resolver: "engine",
      cost: "action",
      why: `Heals 2d4+2, you have ${potions}`,
      say: "I drink a healing potion.",
      blocked: sheet.currentHp >= sheet.maxHp && !sheet.dead ? "You are already at full health." : null,
    });
  }
  return out;
}

// --- the entry point -------------------------------------------------------

function orderIndex(order: readonly string[], id: string): number {
  const i = order.indexOf(id);
  return i === -1 ? order.length : i;
}

/**
 * Every action this character can attempt on `target`, in the order a menu
 * should show them. "Look closer" is always first and always enabled. The
 * rest are ordered by relevance (the fight first when something hostile is in
 * your face, the quiet verbs otherwise), with anything unavailable right now
 * sinking below what you can do this instant. Actions your class or training
 * rules out are not in the list at all.
 *
 * `adjust` lets the caller change a finished action before the list is ordered (the table makes a far action reachable by walking, or
 * greys one the DM cannot answer just now), so the order always follows what is really on offer.
 */
export function contextActionsFor<A extends ContextAction = ContextAction>(target: ContextTarget, situation: ContextSituation, adjust?: (a: ContextAction) => A): A[] {
  let defs: Def[];
  switch (target.kind) {
    case "self": defs = selfDefs(target, situation); break;
    case "creature": defs = creatureDefs(target, situation); break;
    case "body": defs = bodyDefs(target, situation); break;
    case "door": defs = doorDefs(target, situation); break;
    case "chest": defs = chestDefs(target, situation); break;
    case "prop": defs = propDefs(target, situation); break;
    case "floor": defs = floorDefs(target, situation); break;
    default: defs = [];
  }

  const fix = (a: ContextAction): A => (adjust ? adjust(a) : (a as A));
  const c = target.creature;
  const combatMode = target.kind === "creature" && !!c && c.hostile && c.awake && (situation.inFight || c.awareOfHero);
  const order = combatMode ? COMBAT_ORDER : CALM_ORDER;

  const rest = defs
    .map((def, index) => ({ action: fix(finish(def, target, situation)), index }))
    .sort((a, b) => {
      if (a.action.enabled !== b.action.enabled) return a.action.enabled ? -1 : 1;
      const byRank = orderIndex(order, a.action.id) - orderIndex(order, b.action.id);
      return byRank !== 0 ? byRank : a.index - b.index;
    })
    .map((x) => x.action);

  return [fix(lookCloser(target, situation)), ...rest];
}
