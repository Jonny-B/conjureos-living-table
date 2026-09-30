/**
 * Spell slots and the named spell lists for the two caster chassis this
 * launch supports (see DESIGN.md's "Characters: templates first" table:
 * Healer/Medic = Cleric, Fireball Person/Psion = Wizard).
 *
 * Scope is levels 1-3, matching the rest of `rules/`. That range matters
 * more here than anywhere else in the engine: SRD 5.1's full-caster slot
 * table does not grant a 3rd-level spell slot until character level 5, so a
 * level-3 "Fireball Person" cannot cast Fireball yet. That's not a gap in
 * this module, it's the SRD progression working correctly; see the note by
 * WIZARD_SPELLS below rather than "fixing" it by handing out an early slot.
 */

export type CasterClass = "cleric" | "wizard";

export interface SpellSlots {
  [spellLevel: number]: { max: number; used: number };
}

type SlotTable = Record<number, number>;

// SRD 5.1 full-caster slot progression, character levels 1-3.
const CLERIC_SLOTS: Record<1 | 2 | 3, SlotTable> = {
  1: { 1: 2 },
  2: { 1: 3 },
  3: { 1: 4, 2: 2 },
};

// Wizard happens to share Cleric's exact progression at these levels (both
// are SRD full casters). Kept as its own table, not an alias, so the day one
// of them diverges (a level range past 3, a different chassis) is a one-line
// edit here instead of an untangling.
const WIZARD_SLOTS: Record<1 | 2 | 3, SlotTable> = {
  1: { 1: 2 },
  2: { 1: 3 },
  3: { 1: 4, 2: 2 },
};

export function spellSlotsForLevel(casterClass: CasterClass, level: number): SpellSlots {
  if (!Number.isInteger(level) || level < 1 || level > 3) {
    throw new Error(`spellSlotsForLevel only covers character levels 1-3 at launch, got ${level}`);
  }
  const table = (casterClass === "cleric" ? CLERIC_SLOTS : WIZARD_SLOTS)[level as 1 | 2 | 3];
  const slots: SpellSlots = {};
  for (const [spellLevelStr, max] of Object.entries(table)) {
    slots[Number(spellLevelStr)] = { max, used: 0 };
  }
  return slots;
}

/**
 * Spend one slot of the given spell level. Returns a new slots object (the
 * caller's is never mutated, matching how the rest of a character's stat
 * block flows through the engine as immutable snapshots) or null when there
 * is nothing left to spend, which the caller reports back to the player as
 * "no slots of that level remaining" rather than silently doing nothing.
 */
export function castSpell(slots: SpellSlots, spellLevel: number): SpellSlots | null {
  const bucket = slots[spellLevel];
  if (!bucket || bucket.used >= bucket.max) return null;
  return { ...slots, [spellLevel]: { max: bucket.max, used: bucket.used + 1 } };
}

export interface SpellInfo {
  name: string;
  level: number; // 0 = cantrip
  description: string;
}

export const CLERIC_SPELLS: SpellInfo[] = [
  { name: "Sacred Flame", level: 0, description: "Radiant damage in a flame that curls around the target; a Dexterity save, not an attack roll." },
  { name: "Cure Wounds", level: 1, description: "Touch heals a creature for a roll plus your spellcasting modifier." },
  { name: "Bless", level: 1, description: "Up to three creatures add a d4 to their attack rolls and saving throws for the duration." },
  { name: "Guiding Bolt", level: 1, description: "A ranged spell attack that deals radiant damage and lights the target up, giving the next attack against it advantage." },
  { name: "Spiritual Weapon", level: 2, description: "A bonus action summons a spectral weapon that attacks on your turn for the duration." },
  { name: "Lesser Restoration", level: 2, description: "Touch ends one disease or one of a listed set of conditions (blinded, deafened, paralyzed, or poisoned) afflicting a creature." },
];

/**
 * NOTE ON "Fireball Person": Fireball is a 3rd-level spell in SRD 5.1, and
 * the full-caster slot table above does not grant a 3rd-level slot until
 * character level 5. A level-1 to 3 Wizard character genuinely cannot cast
 * Fireball yet under standard progression; this list only includes what a
 * level 1-3 Wizard can actually cast, matching CASTER slots above. Character
 * creation / marketing copy for that archetype should say "will learn
 * Fireball" rather than imply it's available at launch level, so the name
 * does not silently promise a broken rule.
 */
export const WIZARD_SPELLS: SpellInfo[] = [
  { name: "Fire Bolt", level: 0, description: "A ranged spell attack that hurls a mote of fire, dealing fire damage on a hit." },
  { name: "Magic Missile", level: 1, description: "Three darts of force damage that automatically hit, no attack roll and no save." },
  { name: "Shield", level: 1, description: "A reaction that adds to your AC until the start of your next turn, cast the instant you're targeted or hit." },
  { name: "Burning Hands", level: 1, description: "A 15-foot cone of fire damage; a Dexterity save halves it, closest this list gets to a Fireball at these levels." },
  { name: "Scorching Ray", level: 2, description: "Three separate ranged spell attacks, each its own roll, each its own fire damage." },
  { name: "Misty Step", level: 2, description: "A bonus action short teleport, no action economy cost to reposition out of danger." },
];
