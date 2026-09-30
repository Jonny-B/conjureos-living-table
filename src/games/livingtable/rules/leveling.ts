/**
 * Level-up: real SRD hit-point math, plus a plain-language explanation of
 * what changed for the character-creation / character-sheet UI to show
 * later. The plain side is not "restated jargon" (see task brief) - it has
 * to answer "what does this mean for how I play", not describe the rule.
 */
import { abilityModifier, proficiencyBonus, type AbilityScores } from "./abilities";

export type CharacterClass = "fighter" | "rogue" | "cleric" | "wizard";

/** SRD 5.1 hit die by class, for the four chassis the launch templates use (see DESIGN.md's archetype table). */
export const HIT_DIE_SIDES: Record<CharacterClass, number> = {
  fighter: 10,
  rogue: 8,
  cleric: 8,
  wizard: 6,
};

/**
 * The slice of a character's stat block leveling actually touches. The full
 * sheet (inventory, conditions, spell slots) lives wherever character
 * creation builds it; this type only needs to be a structural subset of
 * that, not the canonical Character type.
 */
export interface LevelableCharacter {
  characterClass: CharacterClass;
  level: number;
  abilities: AbilityScores;
  maxHp: number;
  currentHp: number;
  proficiencyBonus: number;
}

export interface LevelUpChange {
  technical: string;
  plain: string;
}

export interface LevelUpResult {
  character: LevelableCharacter;
  changes: LevelUpChange[];
}

/**
 * SRD 5.1 offers a choice at level-up: roll the hit die, or take its fixed
 * average (rounded up). This engine always takes the fixed value, the same
 * "average, rounded up" every published class table lists (d6->4, d8->5,
 * d10->6, d12->7) - deterministic HP totals are worth more here than the
 * chance of a lucky roll, and it's a legal SRD choice, not a house rule.
 */
function averageHitDieValue(sides: number): number {
  return Math.floor(sides / 2) + 1;
}

export function applyLevelUp(character: LevelableCharacter, newLevel: number): LevelUpResult {
  if (!Number.isInteger(newLevel) || newLevel <= character.level) {
    throw new Error(`newLevel (${newLevel}) must be a whole number greater than the character's current level (${character.level})`);
  }

  const conMod = abilityModifier(character.abilities.con);
  const hitDieSides = HIT_DIE_SIDES[character.characterClass];
  const rawHpPerLevel = averageHitDieValue(hitDieSides) + conMod;
  // SRD 5.1 floors the HP gained per level at 1: a low-enough CON modifier
  // (this engine allows scores down to 1, mod -5) can push the raw average
  // below zero, but leveling up is never a net loss. Floor per level, then
  // multiply, since conMod is constant across every level gained in one call.
  const hpPerLevel = Math.max(1, rawHpPerLevel);
  const floored = hpPerLevel !== rawHpPerLevel;
  const levelsGained = newLevel - character.level;
  const hpGained = levelsGained * hpPerLevel;

  const oldProficiency = character.proficiencyBonus;
  const newProficiency = proficiencyBonus(newLevel);

  const changes: LevelUpChange[] = [
    {
      technical: `Max HP +${hpGained} (${levelsGained} level${levelsGained === 1 ? "" : "s"} x (d${hitDieSides} avg ${averageHitDieValue(hitDieSides)} + CON ${conMod >= 0 ? "+" : ""}${conMod}${floored ? ", floored to the SRD minimum of +1 per level" : ""}))`,
      plain: `${hpGained} more health, so you can take more hits before going down.`,
    },
  ];

  // UNREACHABLE IN THIS BUILD, and left in rather than deleted. SRD 5.1's
  // proficiency bonus is +2 at every level from 1 to 4 and the play screen
  // caps at LAUNCH_MAX_LEVEL 3, so `newProficiency !== oldProficiency` cannot
  // be true today: no level-up ever prints this line. A cold reader who was
  // shown the copy in isolation read it as a benefit they were being offered,
  // which is why the guard is worth stating out loud. Deleting the branch
  // would be deleting correct general code to work around a temporary cap and
  // would have to be written again at level 5; keeping it silent is right,
  // keeping it silent by accident is not.
  if (newProficiency !== oldProficiency) {
    changes.push({
      technical: `Proficiency bonus +${oldProficiency} to +${newProficiency}`,
      plain: `+${newProficiency - oldProficiency} to hit with attacks, and to the skills you're trained in.`,
    });
  }

  const updated: LevelableCharacter = {
    ...character,
    level: newLevel,
    maxHp: character.maxHp + hpGained,
    // Current HP rises along with the new max, same as every current table
    // and VTT plays it: a level-up is not a full heal, but the HP you gained
    // is HP you have right now, not HP you have to wait to benefit from.
    currentHp: character.currentHp + hpGained,
    proficiencyBonus: newProficiency,
  };

  return { character: updated, changes };
}
