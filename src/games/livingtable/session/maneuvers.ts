/**
 * Maneuvers that change the board: the pure rules behind Kick, Shove, Hide,
 * Pickpocket, Pick the lock and Force the door.
 *
 * The gap this closes: a player told the DM "I kick the goblin", the DM
 * narrated a kick that landed and knocked him back, and nothing on the board
 * changed: no damage, no movement. Narration cannot change the board; only an
 * EFFECT the engine applies can. These resolvers are the rules those effects
 * call. Each one is pure (data in, answer out, injectable rng), returns the
 * dice for the tray, the outcome, and a log line in plain words that names
 * the real dice and the real numbers. None of them touches the world: the
 * caller applies the result (`pushDestination` says where a pushed token
 * goes; the damage number goes through `damageMonster`).
 *
 * SRD 5.1 (CC BY 4.0, see NOTICE.md) for every rule here:
 *
 * - Unarmed strike: an attack roll with Strength and proficiency; on a hit,
 *   1 + Strength modifier bludgeoning damage. It has no damage die, so a
 *   critical hit has no dice to double and adds nothing.
 * - Shove: a Strength (Athletics) check contested by the target's Strength
 *   (Athletics) or Dexterity (Acrobatics), the target choosing. The target
 *   must be no more than one size larger than the shover. A tie leaves things
 *   as they were, so a tie goes to the target. A win pushes 5 feet or knocks
 *   prone.
 * - Hide: a Dexterity (Stealth) check against each observer's passive
 *   Wisdom (Perception). Meeting or beating the passive score hides you from
 *   that observer (the passive score is the DC).
 * - Pickpocket: a Dexterity (Sleight of Hand) check against the target's
 *   passive Perception, same meets-or-beats rule. A failure means the target
 *   notices.
 * - Pick a lock: Dexterity check with thieves' tools proficiency.
 * - Force a door: Strength (Athletics).
 *
 * WHAT THE ENGINE DOES NOT MODEL, so no line here pretends otherwise:
 * tool proficiency is not on the sheet, so "trained with thieves' tools"
 * means the rogue chassis (SRD: rogues start with that proficiency). Armor
 * stealth penalties are not modelled. Expertise is modelled per skill only,
 * so a rogue's thieves' tools expertise is not a thing here.
 */
import { resolveAttack } from "../rules/combat";
import { rollD20 } from "../rules/dice";
import { abilityMod, BESTIARY, type Beast, type CreatureSize } from "../rules/bestiary";
import type { AbilityScores } from "../rules/abilities";
import { equipmentCheckBonus } from "../characters/equipment";
import { SKILL_ABILITY, type CharacterSheet } from "../characters/creation";
import { getAncestry } from "../characters/ancestries";
import { checkAdvantageFor, skillModifierFor, statblockFor, type MonsterStatblock } from "./combat";
import type { AssetManifest, CellLayout } from "../world/cell";
import { isDiagonalSqueeze } from "../world/pathing";
import { tileFreeFor } from "../world/manipulation";

// ── shared shapes and helpers ──────────────────────────────────────────

/**
 * One die for the dice tray. `label` is optional and only set where a roll
 * has two sides (a contest names whose die it is, "You" or the target).
 */
export interface DiceShown {
  kind: "d20" | "d4" | "d6" | "d8" | "d10" | "d12";
  result: number;
  label?: string;
}

export type RollMode = "advantage" | "disadvantage";

/** "+ 4" or "- 1", so a line reads "14 + 4" and "14 - 1" and never "14 + -1". */
function plus(n: number): string {
  return n < 0 ? `- ${Math.abs(n)}` : `+ ${n}`;
}

/** "5" or "-1" for a bare modifier shown on its own. */
function signed(n: number): string {
  return n < 0 ? `-${Math.abs(n)}` : `+${n}`;
}

interface D20Roll {
  /** The d20 that counted, after advantage or disadvantage. */
  roll: number;
  /** Every d20 actually rolled, in order (two when advantage or disadvantage applied). */
  dice: DiceShown[];
  mode: RollMode | null;
}

/**
 * Roll a d20 through the engine's own `rollD20`, recording every die it
 * draws so the tray can show both dice of an advantage roll and the line can
 * say which one was kept. The wrapper only observes the rng; it changes no
 * result.
 */
function rollTrackedD20(advantage: boolean, disadvantage: boolean, rng: () => number, label?: string): D20Roll {
  const draws: number[] = [];
  const watching = (): number => {
    const v = rng();
    draws.push(v);
    return v;
  };
  const roll = rollD20(advantage, disadvantage, watching);
  const dice: DiceShown[] = draws.map((v) => {
    const shown: DiceShown = { kind: "d20", result: Math.floor(v * 20) + 1 };
    if (label) shown.label = label;
    return shown;
  });
  const mode: RollMode | null = advantage === disadvantage ? null : advantage ? "advantage" : "disadvantage";
  return { roll, dice, mode };
}

/** "(advantage: 14 and 9, kept 14)" or "" when only one die was rolled. */
function modeNote(r: D20Roll): string {
  if (!r.mode || r.dice.length < 2) return "";
  return ` (${r.mode}: ${r.dice.map((d) => d.result).join(" and ")}, kept ${r.roll})`;
}

function modeFlags(mode: RollMode | undefined, extraAdvantage = false): { advantage: boolean; disadvantage: boolean } {
  return { advantage: mode === "advantage" || extraAdvantage, disadvantage: mode === "disadvantage" };
}

// ── skills and abilities by name ───────────────────────────────────────

const ABILITY_BY_NAME: Record<string, keyof AbilityScores> = {
  str: "str",
  strength: "str",
  dex: "dex",
  dexterity: "dex",
  con: "con",
  constitution: "con",
  int: "int",
  intelligence: "int",
  wis: "wis",
  wisdom: "wis",
  cha: "cha",
  charisma: "cha",
};

const ABILITY_LABEL: Record<keyof AbilityScores, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

/** The engine's own spelling of a skill ("sleight of hand" becomes "Sleight of Hand"), or undefined when it is not an SRD skill the engine knows. Callers validate a DM-supplied name with this before `skillCheck`, which throws on an unknown one. */
export function canonicalSkill(name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  return Object.keys(SKILL_ABILITY).find((s) => s.toLowerCase() === wanted);
}

/** The ability key for "str", "Strength", "STRENGTH" and so on, or undefined. */
export function canonicalAbility(name: string): keyof AbilityScores | undefined {
  return ABILITY_BY_NAME[name.trim().toLowerCase()];
}

// ── sizes ──────────────────────────────────────────────────────────────

const SIZE_ORDER: readonly CreatureSize[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

/** Rank of a size name, case-insensitive. An unrecognised size reads as Medium (the default creature), never as a refusal. */
function sizeRank(size: string | undefined): number {
  const i = SIZE_ORDER.findIndex((s) => s.toLowerCase() === (size ?? "").trim().toLowerCase());
  return i >= 0 ? i : SIZE_ORDER.indexOf("Medium");
}

function sizeName(size: string | undefined): CreatureSize {
  return SIZE_ORDER[sizeRank(size)]!;
}

/** The size of a character: their ancestry's size when the sheet has one, else Medium. */
export function sheetSize(sheet: CharacterSheet): CreatureSize {
  const ancestry = sheet.ancestryId ? getAncestry(sheet.ancestryId) : undefined;
  return sizeName(ancestry?.size);
}

// ── unarmed strike (the kick) ──────────────────────────────────────────

export interface UnarmedStrikeResult {
  dice: DiceShown[];
  /** The d20 that counted. */
  roll: number;
  total: number;
  hit: boolean;
  critical: boolean;
  /** Bludgeoning damage dealt: 1 + Strength modifier on a hit, never below 0, and 0 on a miss. */
  damage: number;
  line: string;
}

/**
 * SRD 5.1 unarmed strike (a punch, a kick, a head-butt): an attack roll with
 * your Strength modifier and proficiency bonus (you are proficient with your
 * own fists and feet). On a hit it deals bludgeoning damage equal to 1 + your
 * Strength modifier. A critical hit doubles damage DICE and an unarmed strike
 * has none, so a critical still deals 1 + Strength and the line says so.
 *
 * Deliberately NOT added: a worn weapon's magic bonus, Archery, Dueling, a
 * Champion's wider crit range. All of those are about weapons and a kick is
 * not one. `label` only changes the word in the log line ("Kick", "Punch").
 */
export function unarmedStrike(args: {
  attacker: CharacterSheet;
  targetAC: number;
  advantage?: RollMode;
  rng?: () => number;
  label?: string;
}): UnarmedStrikeResult {
  const { attacker, targetAC, advantage, rng = Math.random, label = "Unarmed strike" } = args;
  const bonus = attacker.modifiers.str + attacker.proficiencyBonus;

  const draws: number[] = [];
  const watching = (): number => {
    const v = rng();
    draws.push(v);
    return v;
  };
  const flags = modeFlags(advantage);
  const attack = resolveAttack({
    attackerBonus: bonus,
    targetAC,
    advantage: flags.advantage,
    disadvantage: flags.disadvantage,
    rng: watching,
  });
  const dice: DiceShown[] = draws.map((v) => ({ kind: "d20", result: Math.floor(v * 20) + 1 }));
  const tracked: D20Roll = {
    roll: attack.roll,
    dice,
    mode: flags.advantage === flags.disadvantage ? null : flags.advantage ? "advantage" : "disadvantage",
  };

  const damage = attack.hit ? Math.max(0, 1 + attacker.modifiers.str) : 0;
  const head = `${label}: ${attack.roll} ${plus(bonus)} = ${attack.total} vs AC ${targetAC}${modeNote(tracked)}.`;
  const dmgMath = `1 ${plus(attacker.modifiers.str)} = ${damage}`;

  let line: string;
  if (attack.critical) {
    line = `${label}: natural ${attack.roll}${modeNote(tracked)}, a critical hit. An unarmed strike has no damage dice to double, so it deals ${dmgMath} bludgeoning.`;
  } else if (attack.fumble) {
    line = `${label}: natural 1${modeNote(tracked)}. A miss, whatever the bonus.`;
  } else if (attack.hit) {
    line = `${head} Hit: ${dmgMath} bludgeoning.`;
  } else {
    line = `${head} Miss.`;
  }
  return { dice, roll: attack.roll, total: attack.total, hit: attack.hit, critical: attack.critical, damage, line };
}

// ── shove ──────────────────────────────────────────────────────────────

export interface ShoveResult {
  allowed: boolean;
  reason?: string;
  /** Your d20 first, then the target's, each labelled. */
  dice: DiceShown[];
  attackerTotal: number;
  targetTotal: number;
  success: boolean;
  /** What a win does: "push" (5 feet, apply with `pushDestination`), "prone" (the board must hold the condition), or "none" on a loss or a refusal. */
  effect: "push" | "prone" | "none";
  line: string;
}

/**
 * SRD 5.1 shove: your Strength (Athletics) check against the target's
 * Strength (Athletics) or Dexterity (Acrobatics), whichever the target is
 * better at (the target chooses, and nobody chooses the worse one). Refused
 * outright when the target is more than one size larger than you. A tie
 * leaves the situation as it was, which is a failed shove.
 *
 * `target.athletics` and `target.acrobatics` are the target's skill
 * MODIFIERS (use `monsterSkill`). `attackerSize` defaults to the sheet's
 * ancestry size (Medium without one).
 */
export function shoveContest(args: {
  attacker: CharacterSheet;
  target: { athletics: number; acrobatics: number; size: string; name?: string };
  attackerSize?: string;
  mode: "push" | "prone";
  rng?: () => number;
}): ShoveResult {
  const { attacker, target, mode, rng = Math.random } = args;
  const mine = sizeName(args.attackerSize ?? sheetSize(attacker));
  const theirs = sizeName(target.size);
  const who = target.name ?? "the target";

  if (sizeRank(theirs) > sizeRank(mine) + 1) {
    const reason = `Cannot shove: ${who} is ${theirs} and you are ${mine}. A shove only works on a creature no more than one size larger than you.`;
    return { allowed: false, reason, dice: [], attackerTotal: 0, targetTotal: 0, success: false, effect: "none", line: reason };
  }

  const myMod = skillModifierFor(attacker, "Athletics");
  const useAcrobatics = target.acrobatics > target.athletics;
  const theirMod = useAcrobatics ? target.acrobatics : target.athletics;
  const theirSkill = useAcrobatics ? "Acrobatics" : "Athletics";

  const mineRoll = rollTrackedD20(false, false, rng, "You");
  const theirRoll = rollTrackedD20(false, false, rng, who);
  const attackerTotal = mineRoll.roll + myMod;
  const targetTotal = theirRoll.roll + theirMod;
  const success = attackerTotal > targetTotal;

  const verb = mode === "prone" ? "knock down" : "shove";
  const contest = `Shove: your Athletics ${mineRoll.roll} ${plus(myMod)} = ${attackerTotal} against ${who}'s ${theirSkill} ${theirRoll.roll} ${plus(theirMod)} = ${targetTotal}.`;
  let line: string;
  if (success) {
    line = mode === "prone" ? `${contest} You win: ${who} is knocked prone.` : `${contest} You win: ${who} is pushed 5 feet away from you.`;
  } else if (attackerTotal === targetTotal) {
    line = `${contest} A tie goes to ${who}: you cannot ${verb} them.`;
  } else {
    line = `${contest} You lose: you cannot ${verb} ${who}.`;
  }
  return {
    allowed: true,
    dice: [...mineRoll.dice, ...theirRoll.dice],
    attackerTotal,
    targetTotal,
    success,
    effect: success ? mode : "none",
    line,
  };
}

// ── push destination ───────────────────────────────────────────────────

/**
 * The squares a pushed token moves through, in order, one per square, ending
 * where it stops. It travels straight away from `awayFrom` (diagonally when
 * the shove is diagonal) for up to `squares` squares and stops BEFORE the
 * first square that is a wall, a blocking prop (a closed door), another
 * token, or off the board. A diagonal step also stops where it would squeeze
 * between two blocked corners, the same rule walking uses. Empty when the
 * very first square is blocked (pinned against a wall) or when `from` and
 * `awayFrom` are the same square (there is no "away").
 *
 * Callers move the token to the LAST square of the result, with the token's
 * own `x` and `y` on the layout, via `placeToken`/`moveToken`-style mutation
 * that does not charge movement (a shove is not the victim's own move).
 */
export function pushDestination(
  layout: CellLayout,
  manifest: AssetManifest,
  from: { x: number; y: number },
  awayFrom: { x: number; y: number },
  squares: number,
): { x: number; y: number }[] {
  const dx = Math.sign(from.x - awayFrom.x);
  const dy = Math.sign(from.y - awayFrom.y);
  if (dx === 0 && dy === 0) return [];

  const path: { x: number; y: number }[] = [];
  let cur = { x: from.x, y: from.y };
  for (let i = 0; i < Math.max(0, Math.floor(squares)); i++) {
    const next = { x: cur.x + dx, y: cur.y + dy };
    if (!tileFreeFor(layout, manifest, next.x, next.y)) break;
    if (isDiagonalSqueeze(layout, manifest, cur, next)) break;
    path.push(next);
    cur = next;
  }
  return path;
}

// ── prone ──────────────────────────────────────────────────────────────

/**
 * The SRD 5.1 prone condition as data for the bench to apply. What each
 * field means, and who must apply it (the engine does not change any roll
 * because of a condition on its own, see the rulebook):
 *
 * - `meleeAttackersHaveAdvantage`: an attack roll AGAINST a prone creature has
 *   advantage when the attacker is within 5 feet of it. Strictly the rule is
 *   about distance, not weapon type: a ranged attack from an adjacent square
 *   also has advantage. Use `proneAttackMode` rather than this flag when you
 *   have the distance.
 * - `rangedAttackersHaveDisadvantage`: an attack roll against it from farther
 *   than 5 feet has disadvantage.
 * - `proneAttacksHaveDisadvantage`: the prone creature's own attack rolls
 *   have disadvantage.
 * - `standUpCostsHalfMovement`: standing up spends half the creature's
 *   speed; until then its only movement is to crawl (each foot costs one
 *   extra foot).
 */
export function proneEffects(): {
  meleeAttackersHaveAdvantage: true;
  rangedAttackersHaveDisadvantage: true;
  proneAttacksHaveDisadvantage: true;
  standUpCostsHalfMovement: true;
} {
  return {
    meleeAttackersHaveAdvantage: true,
    rangedAttackersHaveDisadvantage: true,
    proneAttacksHaveDisadvantage: true,
    standUpCostsHalfMovement: true,
  };
}

/** The roll mode an attack against a PRONE creature gets: advantage from within 5 feet, disadvantage from farther. */
export function proneAttackMode(distanceFt: number): RollMode {
  return distanceFt <= 5 ? "advantage" : "disadvantage";
}

/** Feet of movement it costs a prone creature with this speed to stand up: half its speed, rounded down. */
export function standUpCostFt(speedFt: number): number {
  return Math.floor(Math.max(0, speedFt) / 2);
}

// ── hiding ─────────────────────────────────────────────────────────────

export interface StealthResult {
  dice: DiceShown[];
  total: number;
  /** Observer ids whose passive Perception your check met or beat. */
  hiddenFrom: string[];
  /** Observer ids whose passive Perception beat your check. */
  spottedBy: string[];
  line: string;
}

/**
 * Hide or sneak: one Dexterity (Stealth) check, compared against each
 * observer's passive Perception. Your total meeting or beating the passive
 * score hides you from that observer; below it, that observer spots you.
 * Worn boots that grant Stealth advantage apply, and cancel against an
 * imposed disadvantage as advantage and disadvantage always do.
 */
export function stealthCheck(args: {
  sheet: CharacterSheet;
  observers: { id: string; passivePerception: number; name?: string }[];
  rng?: () => number;
  advantage?: RollMode;
}): StealthResult {
  const { sheet, observers, rng = Math.random, advantage } = args;
  const mod = skillModifierFor(sheet, "Stealth");
  const boots = checkAdvantageFor(sheet, "Stealth");
  const flags = modeFlags(advantage, boots !== null);
  const r = rollTrackedD20(flags.advantage, flags.disadvantage, rng);
  const total = r.roll + mod;

  const hiddenFrom: string[] = [];
  const spottedBy: string[] = [];
  const hiddenNames: string[] = [];
  const spottedNames: string[] = [];
  for (const o of observers) {
    const name = `${o.name ?? o.id} (passive ${o.passivePerception})`;
    if (total >= o.passivePerception) {
      hiddenFrom.push(o.id);
      hiddenNames.push(name);
    } else {
      spottedBy.push(o.id);
      spottedNames.push(name);
    }
  }

  const head = `Stealth: ${r.roll} ${plus(mod)} = ${total}${modeNote(r)}.`;
  const bootNote = boots && flags.advantage && !flags.disadvantage ? ` Advantage from ${boots}.` : "";
  let tail: string;
  if (observers.length === 0) tail = "No one is watching, so you are hidden.";
  else if (spottedNames.length === 0) tail = `Hidden from ${hiddenNames.join(", ")}.`;
  else if (hiddenNames.length === 0) tail = `Spotted by ${spottedNames.join(", ")}.`;
  else tail = `Hidden from ${hiddenNames.join(", ")}; spotted by ${spottedNames.join(", ")}.`;
  return { dice: r.dice, total, hiddenFrom, spottedBy, line: `${head}${bootNote} ${tail}` };
}

// ── pickpocket ─────────────────────────────────────────────────────────

export interface SleightOfHandResult {
  dice: DiceShown[];
  total: number;
  success: boolean;
  /** True exactly when the check failed: the target catches you in the act. */
  noticed: boolean;
  line: string;
}

/**
 * Dexterity (Sleight of Hand) against the target's passive Perception, the
 * passive score acting as the DC (meet or beat to succeed). A failure means
 * the target notices. Anyone may try; the caller decides who is offered the
 * action (training, or the rogue chassis, per the menu rules).
 */
export function sleightOfHand(args: {
  sheet: CharacterSheet;
  targetPassivePerception: number;
  rng?: () => number;
}): SleightOfHandResult {
  const { sheet, targetPassivePerception, rng = Math.random } = args;
  const mod = skillModifierFor(sheet, "Sleight of Hand");
  const r = rollTrackedD20(false, false, rng);
  const total = r.roll + mod;
  const success = total >= targetPassivePerception;
  const line = `Sleight of Hand: ${r.roll} ${plus(mod)} = ${total} vs passive Perception ${targetPassivePerception}. ${
    success ? "Success: they do not notice." : "Failure: they notice."
  }`;
  return { dice: r.dice, total, success, noticed: !success, line };
}

// ── lock and door ──────────────────────────────────────────────────────

export interface PickLockResult {
  allowed: boolean;
  reason?: string;
  dice: DiceShown[];
  total: number;
  success: boolean;
  line: string;
}

/**
 * True when the character is trained with thieves' tools. The engine does
 * not model tool proficiency on the sheet, so this is the rogue chassis
 * (SRD 5.1: a rogue starts proficient with thieves' tools) and nothing else.
 */
export function hasThievesToolsTraining(sheet: CharacterSheet): boolean {
  return sheet.chassis === "rogue";
}

/**
 * Pick a lock: Dexterity check plus your proficiency bonus (thieves' tools
 * training), against the lock's DC. Refused without rolling for anyone not
 * trained: with no tool proficiency on the sheet that means every chassis but
 * rogue, and the reason says so in plain words. A worn amulet of luck's check
 * bonus applies as it does to any ability check.
 */
export function pickLock(args: { sheet: CharacterSheet; dc: number; rng?: () => number }): PickLockResult {
  const { sheet, dc, rng = Math.random } = args;
  if (!hasThievesToolsTraining(sheet)) {
    const reason =
      "Cannot pick this lock: you are not trained with thieves' tools. In this game only a rogue is. Try Force the door, or tell the DM another way in.";
    return { allowed: false, reason, dice: [], total: 0, success: false, line: reason };
  }
  const mod = sheet.modifiers.dex + sheet.proficiencyBonus + equipmentCheckBonus(sheet);
  const r = rollTrackedD20(false, false, rng);
  const total = r.roll + mod;
  const success = total >= dc;
  const line = `Pick the lock (Dexterity ${signed(sheet.modifiers.dex)}, thieves' tools ${signed(sheet.proficiencyBonus)}): ${r.roll} ${plus(mod)} = ${total} vs DC ${dc}. ${
    success ? "Success: the lock clicks open." : "Failure: the lock holds."
  }`;
  return { allowed: true, dice: r.dice, total, success, line };
}

export interface ForceDoorResult {
  dice: DiceShown[];
  roll: number;
  total: number;
  success: boolean;
  line: string;
}

/** Force a door (or a lid, or a jammed gate): a Strength (Athletics) check against the DC. */
export function forceDoor(args: { sheet: CharacterSheet; dc: number; rng?: () => number }): ForceDoorResult {
  const { sheet, dc, rng = Math.random } = args;
  const mod = skillModifierFor(sheet, "Athletics");
  const r = rollTrackedD20(false, false, rng);
  const total = r.roll + mod;
  const success = total >= dc;
  const line = `Force it (Athletics): ${r.roll} ${plus(mod)} = ${total} vs DC ${dc}. ${success ? "Success: it gives way." : "Failure: it holds."}`;
  return { dice: r.dice, roll: r.roll, total, success, line };
}

// ── skill check ────────────────────────────────────────────────────────

export interface SkillCheckResult {
  dice: DiceShown[];
  /** The d20 that counted. */
  roll: number;
  total: number;
  modifier: number;
  success: boolean;
  line: string;
}

/**
 * A skill or ability check with the engine's own modifier. `skill` is
 * case-insensitive ("sleight of hand", "ATHLETICS"). With only `ability`
 * it is a raw ability check. With both, it is the skill rolled with that
 * ability instead (SRD: Strength (Intimidation)): a trained skill keeps its
 * proficiency, expertise included. Boots that grant advantage on Stealth
 * apply to a Stealth check.
 *
 * Throws on an unknown skill or ability, or when neither is given: that is a
 * caller bug, and the engine will not invent a modifier. Validate a
 * DM-supplied name with `canonicalSkill` / `canonicalAbility` first.
 */
export function skillCheck(args: {
  sheet: CharacterSheet;
  skill?: string;
  ability?: string;
  dc: number;
  advantage?: RollMode;
  rng?: () => number;
}): SkillCheckResult {
  const { sheet, dc, advantage, rng = Math.random } = args;

  const skill = args.skill !== undefined ? canonicalSkill(args.skill) : undefined;
  if (args.skill !== undefined && skill === undefined) throw new Error(`not a skill the engine knows: "${args.skill}"`);
  const abilityOverride = args.ability !== undefined ? canonicalAbility(args.ability) : undefined;
  if (args.ability !== undefined && abilityOverride === undefined) throw new Error(`not an ability: "${args.ability}"`);
  if (skill === undefined && abilityOverride === undefined) throw new Error("skillCheck needs a skill or an ability");

  let modifier: number;
  let name: string;
  if (skill !== undefined) {
    const natural = SKILL_ABILITY[skill]!;
    const ability = abilityOverride ?? natural;
    const base = skillModifierFor(sheet, skill);
    // Swap the ability the skill is rolled with: the trained bonus embeds the
    // skill's own ability modifier, so replace that part and keep the rest.
    modifier = base - sheet.modifiers[natural] + sheet.modifiers[ability];
    name = ability === natural ? skill : `${ABILITY_LABEL[ability]} (${skill})`;
  } else {
    const ability = abilityOverride!;
    modifier = sheet.modifiers[ability] + equipmentCheckBonus(sheet);
    name = `${ABILITY_LABEL[ability]} check`;
  }

  const boots = skill !== undefined ? checkAdvantageFor(sheet, skill) : null;
  const flags = modeFlags(advantage, boots !== null);
  const r = rollTrackedD20(flags.advantage, flags.disadvantage, rng);
  const total = r.roll + modifier;
  const success = total >= dc;
  const line = `${name}: ${r.roll} ${plus(modifier)} = ${total}${modeNote(r)} vs DC ${dc}. ${success ? "Success." : "Failure."}`;
  return { dice: r.dice, roll: r.roll, total, modifier, success, line };
}

// ── creatures ──────────────────────────────────────────────────────────

/** Size of the engine's statblock-only creatures (no bestiary entry carries their token). Reskins keep their SRD source's size. */
const STATBLOCK_SIZE: Record<string, CreatureSize> = {
  token_raider: "Medium",
  token_drone: "Small",
};

function isBeast(c: Beast | MonsterStatblock): c is Beast {
  return "scores" in c;
}

/**
 * A creature's skill modifier: the bestiary's listed skill bonus when it has
 * one (a goblin's Stealth +6), else the ability modifier the skill runs on
 * (SRD: a creature with no listed skill uses its bare ability modifier).
 * Accepts a bestiary `Beast` or the engine's `MonsterStatblock`; a skill name
 * is case-insensitive and an unknown one reads as 0.
 */
export function monsterSkill(creature: Beast | MonsterStatblock, skill: string): number {
  const canon = canonicalSkill(skill);
  if (!canon) return 0;
  if (isBeast(creature)) {
    const listed = Object.entries(creature.skills ?? {}).find(([k]) => k.toLowerCase() === canon.toLowerCase());
    if (listed) return listed[1];
    return abilityMod(creature.scores[SKILL_ABILITY[canon]!]);
  }
  return creature.abilityModifiers[SKILL_ABILITY[canon]!];
}

/** The bestiary entry whose token is this asset id (goblin, skeleton), or undefined. */
function beastForToken(assetId: string | null | undefined): Beast | undefined {
  if (!assetId) return undefined;
  return BESTIARY.find((b) => b.tokenAssetId === assetId);
}

/** What the engine needs to know about a token to shove it: its two contest skills, its size and its name. Bestiary numbers when the token has an entry, else the statblock's. */
export function monsterShoveProfile(assetId: string | null | undefined): { athletics: number; acrobatics: number; size: CreatureSize; name: string } {
  const beast = beastForToken(assetId);
  if (beast) {
    return { athletics: monsterSkill(beast, "Athletics"), acrobatics: monsterSkill(beast, "Acrobatics"), size: beast.size, name: beast.name };
  }
  const block = statblockFor(assetId);
  const size = (assetId && STATBLOCK_SIZE[assetId]) || "Medium";
  return { athletics: monsterSkill(block, "Athletics"), acrobatics: monsterSkill(block, "Acrobatics"), size, name: block.name };
}

/** A token's passive Perception: the bestiary's printed figure, else the SRD formula 10 + Wisdom modifier off its statblock. */
export function monsterPassivePerception(assetId: string | null | undefined): number {
  const beast = beastForToken(assetId);
  if (beast) return beast.passivePerception;
  return 10 + monsterSkill(statblockFor(assetId), "Perception");
}
