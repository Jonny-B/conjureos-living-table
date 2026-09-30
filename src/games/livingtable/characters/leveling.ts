/**
 * Level-up, presented in plain language. All the actual numbers (max HP,
 * proficiency bonus) come straight from rules/leveling.ts's `applyLevelUp` --
 * this module never recomputes HP or proficiency bonus itself, it only
 * reacts to what the rules engine already decided: refreshing the skill and
 * save bonuses that are derived from proficiency bonus, and (for the one
 * chassis with a real SRD branch point in the 1-3 launch range) presenting
 * that choice instead of silently picking for the player.
 *
 * Ability scores never change on level-up at this launch scope (no ability
 * score improvements until level 4, past the 1-3 range rules/ covers), so
 * skill and save bonuses only need to react to the new proficiency bonus,
 * never to a changed modifier.
 */
import { applyLevelUp, spellSlotsForLevel } from "../rules";
import type { CasterClass, LevelableCharacter, LevelUpChange, SpellSlots } from "../rules";
import { appliedEffectFor } from "./creation";
import type { CharacterSheet, ChoiceOption, SaveProficiency, SkillProficiency } from "./creation";
import type { Chassis } from "./templates";

export interface LevelUpChoice {
  id: string;
  prompt: string;
  options: ChoiceOption[];
}

export interface LevelUpOutcome {
  character: CharacterSheet;
  /** Straight from rules/leveling.ts: the HP and (when it changed) proficiency bonus explanation. */
  changes: LevelUpChange[];
  /** A real branch point at this level for this chassis, or null when there isn't one -- see SUBCLASS_LEVEL_BY_CHASSIS. */
  choice: LevelUpChoice | null;
}

/**
 * SRD 5.1's Martial Archetype, chosen at Fighter level 3, and a branch that
 * genuinely changes a number. Champion's widened critical range is real:
 * rules/combat.ts's `resolveAttack` takes a `criticalOn` (default 20), and
 * session/combat.ts's `criticalOnFor` reads `choices.martialArchetype` off the
 * sheet this module writes and hands the engine 19 for a Champion. The crit
 * rule is still computed in exactly one place, so the on-screen readout and
 * the engine cannot disagree. Battle Master is real on both sides too now:
 * rules/maneuvers.ts holds the superiority dice and the two maneuvers,
 * session/combat.ts's `maneuversFor` reads the same `choices` key off this
 * sheet, and the play screen renders a Maneuver row from it.
 *
 * Both options therefore state a NUMBER, which is the rule every choice in
 * this game is now held to. Two cold readers made four build decisions off
 * the old copy and got zero right, and both said the same thing: with no
 * number anywhere they were choosing between vibes.
 */
const FIGHTER_SUBCLASS_CHOICE: LevelUpChoice = {
  id: "martialArchetype",
  prompt: "Pick a fighting archetype.",
  options: [
    {
      id: "champion",
      label: "Champion",
      technical: "Attack rolls score a critical hit on a roll of 19 or 20, not only a natural 20.",
      plain: "Critical hit on 19 or 20 instead of only 20, so your double-damage hits come around twice as often.",
    },
    {
      id: "battle-master",
      label: "Battle Master",
      technical: "Gain a pool of superiority dice and a set of combat maneuvers (trip, disarm, extra damage), spent and recovered on a rest.",
      // Four d8 superiority dice, spent on Trip and Disarm, back on any rest:
      // rules/maneuvers.ts holds the rule, session/combat.ts reads the sheet
      // for it, and the play screen renders a Maneuver row from
      // `maneuversFor`. Both cold readers went looking for exactly those
      // buttons and found none, which is why the numbers are in the copy now
      // and the buttons are on the screen.
      plain: "Four d8 dice you spend on combat tricks: +1d8 damage plus a chance to knock it flat or knock its weapon away. Back after any rest.",
    },
  ],
};

/** Which level, if any, presents a real branch point for a given chassis. Only Fighter has one in the 1-3 launch range; Rogue/Cleric/Wizard level-ups are numbers-only. */
const SUBCLASS_LEVEL_BY_CHASSIS: Partial<Record<Chassis, number>> = {
  fighter: 3,
};

const SUBCLASS_CHOICE_BY_CHASSIS: Partial<Record<Chassis, LevelUpChoice>> = {
  fighter: FIGHTER_SUBCLASS_CHOICE,
};

function refreshSkills(character: CharacterSheet, newProficiencyBonus: number): SkillProficiency[] {
  return character.skills.map((s) => ({
    ...s,
    bonus: character.modifiers[s.ability] + newProficiencyBonus * (s.expertise ? 2 : 1),
  }));
}

function refreshSaves(character: CharacterSheet, newProficiencyBonus: number): SaveProficiency[] {
  return character.saves.map((s) => ({
    ...s,
    bonus: character.modifiers[s.ability] + newProficiencyBonus,
  }));
}

function isCasterChassis(chassis: Chassis): chassis is CasterClass {
  return chassis === "cleric" || chassis === "wizard";
}

/**
 * Apply a level-up and report it in plain language. `newLevel` must be
 * greater than the character's current level, same rule as
 * rules/leveling.ts's `applyLevelUp` (which this calls straight through and
 * lets throw on an invalid target rather than duplicating that check here).
 */
export function levelUpChoices(character: CharacterSheet, newLevel: number): LevelUpOutcome {
  const levelable: LevelableCharacter = {
    characterClass: character.chassis,
    level: character.level,
    abilities: character.abilities,
    maxHp: character.maxHp,
    currentHp: character.currentHp,
    proficiencyBonus: character.proficiencyBonus,
  };

  const { character: updated, changes } = applyLevelUp(levelable, newLevel);

  const spellSlots: SpellSlots | null = isCasterChassis(character.chassis)
    ? spellSlotsForLevel(character.chassis, newLevel)
    : null;

  const updatedCharacter: CharacterSheet = {
    ...character,
    level: updated.level,
    maxHp: updated.maxHp,
    currentHp: updated.currentHp,
    proficiencyBonus: updated.proficiencyBonus,
    skills: refreshSkills(character, updated.proficiencyBonus),
    saves: refreshSaves(character, updated.proficiencyBonus),
    spellSlots,
  };

  const choice = SUBCLASS_LEVEL_BY_CHASSIS[character.chassis] === newLevel
    ? SUBCLASS_CHOICE_BY_CHASSIS[character.chassis]!
    : null;

  return { character: updatedCharacter, changes, choice };
}

// ── earning it ───────────────────────────────────────────────────────────

/**
 * How many milestones one level costs.
 *
 * The Level up button used to be always available, gated on nothing at all: a
 * newcomer could press it three times in ten seconds without leaving the first
 * room and exhaust the entire 1-to-3 progression before their second scene, so
 * it read as a debug control rather than an achievement. DESIGN.md frames
 * levelling as "a reward, not homework", and a reward with no earning
 * condition is neither.
 *
 * Milestone levelling, not XP: 5e supports it as a first-class alternative
 * (the DM and player decide when a level has been earned), and the sheet
 * carries no XP field. A milestone is something the campaign actually did --
 * a fight won, a new scene the DM built -- counted on the sheet by the play
 * screen. Three of them per level is roughly a scene and a fight, which is
 * about how long a real table takes to hand out a level at these levels.
 */
export const MILESTONES_PER_LEVEL = 3;

/** How many more milestones this character needs before the next level is available. Zero means it is earned right now. */
export function milestonesRemaining(character: CharacterSheet): number {
  return Math.max(0, MILESTONES_PER_LEVEL - character.milestones);
}

/** Whether the campaign has earned this character their next level yet. The Level up button renders only when this is true. */
export function canLevelUp(character: CharacterSheet, maxLevel: number): boolean {
  return character.level < maxLevel && milestonesRemaining(character) === 0;
}

/** Record one earned milestone (a fight won, a scene built). Pure, like everything else here. */
export function addMilestone(character: CharacterSheet, count = 1): CharacterSheet {
  return { ...character, milestones: character.milestones + count };
}

/**
 * Lock in a level-up, including the branch choice when the level has one.
 *
 * `levelUpChoices` deliberately returns a preview whose `character` has the
 * numbers applied but not the choice: the play screen used to call
 * `updateSheet(preview.character)` unchanged, which meant the single branch
 * point in the whole 1-to-3 progression was rendered as two paragraphs of
 * prose and then discarded whichever the player "picked". This is the missing
 * second half: it spends the milestones, records the pick in `choices`, and
 * pushes its plain-language line into `appliedEffects` so the sheet can show,
 * permanently and after the fact, what the choice actually did.
 *
 * `optionId` may be null only when the outcome has no choice; passing null
 * against a real choice throws rather than silently levelling with no pick,
 * because "the player levelled up and nothing recorded which option they
 * chose" is precisely the bug this function exists to make impossible.
 */
export function applyLevelUpChoice(outcome: LevelUpOutcome, optionId: string | null): CharacterSheet {
  const base: CharacterSheet = {
    ...outcome.character,
    milestones: Math.max(0, outcome.character.milestones - MILESTONES_PER_LEVEL),
    // SRD 5.1: a character has one hit die per level. Gaining a level hands
    // one more back without refilling the ones already spent, which is what
    // keeps a short rest a resource decision rather than a free heal button.
    hitDiceRemaining: Math.min(outcome.character.level, outcome.character.hitDiceRemaining + 1),
  };
  if (!outcome.choice) return base;

  if (!optionId) throw new Error(`level ${outcome.character.level} presents a choice ("${outcome.choice.id}") that has to be made before it can be applied`);
  const option = outcome.choice.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`"${optionId}" is not an option for ${outcome.choice.id}`);

  return {
    ...base,
    choices: { ...base.choices, [outcome.choice.id]: option.id },
    appliedEffects: [...base.appliedEffects, appliedEffectFor(option, `${option.label}: `)],
  };
}
