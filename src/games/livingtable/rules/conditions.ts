/**
 * The SRD 5.1 condition list, plus a plain-language one-liner per condition,
 * plus the small set algebra a caller needs to actually TRACK which of them
 * are on a creature right now.
 *
 * The descriptions are deliberately paraphrased, not quoted verbatim from the
 * SRD text: they're short enough to read on hover in the UI, which the exact
 * rules-lawyer wording is not (a paralyzed creature's SRD entry alone is four
 * sentences). Mechanical enforcement of a condition's effects (disadvantage
 * on an attack, auto-fail on a save, etc.) is still the caller's job at the
 * point a condition is checked; this module owns the list and the set, not a
 * combat resolver of its own.
 *
 * Why the set algebra is here rather than left to each caller: for two
 * rounds this file was a reference list nothing imported. `grep` for it found
 * exactly one hit, the barrel re-export in index.ts, and zero real callers --
 * so a character who was prone, grappled, blinded, poisoned or unconscious
 * presented to the DM as perfectly fine, forever, and no SRD condition name
 * appeared anywhere on the play screen. A list with no way to hold state is a
 * list nobody can wire up in one sitting; `session/characterState.ts` stores
 * a `Condition[]` on the character now and these functions are what read and
 * mutate it.
 */

export type Condition =
  | "blinded"
  | "charmed"
  | "deafened"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "petrified"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "unconscious";

export const CONDITION_DESCRIPTIONS: Record<Condition, string> = {
  blinded: "Can't see. Automatically fails anything that needs sight. Attacks against you have advantage; yours have disadvantage.",
  charmed: "Can't attack the charmer or target them with harmful effects, and the charmer gets the better of any social attempt against you.",
  deafened: "Can't hear, and automatically fails anything that needs hearing.",
  frightened: "Disadvantage on checks and attacks while the source of your fear is in sight, and you can't willingly move closer to it.",
  grappled: "Your speed drops to 0. Ends if the grappler is incapacitated or you're forced out of their reach.",
  incapacitated: "Can't take actions or reactions.",
  invisible: "Can't be seen without magical help. Attacks against you have disadvantage; yours have advantage.",
  paralyzed: "Incapacitated and can't move or speak. Automatically fails Strength and Dexterity saves. Attacks against you have advantage, and any hit from within 5 feet is a critical.",
  petrified: "Turned to stone: incapacitated, can't move or speak, unaware of your surroundings. Resistant to all damage, and immune to poison and disease.",
  poisoned: "Disadvantage on attack rolls and ability checks.",
  prone: "Can only crawl or spend movement to stand up. Disadvantage on attack rolls. Attacks against you have advantage from within 5 feet, disadvantage from farther away.",
  restrained: "Your speed drops to 0. Disadvantage on attack rolls and Dexterity saves. Attacks against you have advantage.",
  stunned: "Incapacitated, can't move, and can speak only falteringly. Automatically fails Strength and Dexterity saves. Attacks against you have advantage.",
  unconscious: "Incapacitated, can't move or speak, unaware of your surroundings. Drops what you're holding and falls prone. Automatically fails Strength and Dexterity saves. Attacks against you have advantage, and any hit from within 5 feet is a critical.",
};

// ── the condition set: what a creature is actually suffering right now ──

/**
 * Every SRD 5.1 condition, in the order the descriptions above list them
 * (alphabetical, as the SRD prints them). Derived from that record rather
 * than written out a second time, so a condition can never exist in one list
 * and not the other.
 */
export const SRD_CONDITIONS: readonly Condition[] = Object.keys(CONDITION_DESCRIPTIONS) as Condition[];

/**
 * A creature's active conditions. Readonly and array-shaped rather than a
 * `Set`: this value round-trips through `game_characters.stats`, the jsonb
 * bag games-db stores verbatim (see session/characterState.ts), and an array
 * is what JSON already has. Every function below returns a new array rather
 * than mutating in place, matching how characters/leveling.ts and
 * characters/health.ts already treat a sheet.
 */
export type ConditionSet = readonly Condition[];

/**
 * SRD 5.1's own "a creature with this condition also has these" clauses,
 * written out because they are rules text, not bookkeeping: an unconscious
 * creature "is incapacitated ... and drops prone", and paralyzed, petrified
 * and stunned each say "is incapacitated" in their first line. Applying them
 * is what makes a downed character read to the DM as unconscious AND prone
 * AND incapacitated, which is what the SRD says they are, rather than as one
 * label that a caller then has to remember to unpack.
 */
const IMPLIED_CONDITIONS: Partial<Record<Condition, readonly Condition[]>> = {
  unconscious: ["incapacitated", "prone"],
  paralyzed: ["incapacitated"],
  petrified: ["incapacitated"],
  stunned: ["incapacitated"],
};

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && value in CONDITION_DESCRIPTIONS;
}

/** Sort into SRD_CONDITIONS order and drop duplicates, so two sets holding the same conditions always render and compare identically regardless of the order they were applied in. */
function canonical(conditions: Iterable<Condition>): Condition[] {
  const held = new Set(conditions);
  return SRD_CONDITIONS.filter((c) => held.has(c));
}

/**
 * Clean whatever came back out of the stats blob into a real condition set:
 * unknown strings dropped, duplicates collapsed, SRD implications applied,
 * canonical order restored. The blob is this client's own prior write rather
 * than adversarial input (migration 116's stated trust model), but a campaign
 * saved before this field existed comes back with `undefined` here, and a DM
 * that once wrote "bleeding" should not put a condition on the sheet that no
 * rule in the engine knows how to read.
 */
export function normalizeConditions(value: unknown): Condition[] {
  if (!Array.isArray(value)) return [];
  return expandConditions(value.filter(isCondition));
}

/** Add the conditions the SRD says come with the ones already held, then canonicalise. */
export function expandConditions(conditions: Iterable<Condition>): Condition[] {
  const held = new Set<Condition>(conditions);
  // One pass over a snapshot is enough for the table above (nothing implied
  // implies anything further), but the loop re-checks what it added so a new
  // entry with a two-step implication can't silently half-apply.
  const queue = [...held];
  while (queue.length > 0) {
    const condition = queue.pop()!;
    for (const implied of IMPLIED_CONDITIONS[condition] ?? []) {
      if (held.has(implied)) continue;
      held.add(implied);
      queue.push(implied);
    }
  }
  return canonical(held);
}

export function hasCondition(set: ConditionSet, condition: Condition): boolean {
  return set.includes(condition);
}

/** Apply one or more conditions, with their SRD implications. Already-held conditions are a no-op rather than a duplicate. */
export function addCondition(set: ConditionSet, ...conditions: Condition[]): Condition[] {
  return expandConditions([...set, ...conditions]);
}

/**
 * Clear one or more conditions. Deliberately does NOT clear what they
 * implied: a creature that wakes up is no longer unconscious but is still
 * lying on the floor, and SRD 5.1 makes standing up cost movement. Clearing
 * `prone` too would hand back a free stand-up nobody paid for.
 */
export function removeCondition(set: ConditionSet, ...conditions: Condition[]): Condition[] {
  const dropped = new Set(conditions);
  return canonical(set.filter((c) => !dropped.has(c)));
}

/** The one-line rendering the DM's prompt and the character sheet both want: "prone, unconscious", or "(none)". */
export function describeConditions(set: ConditionSet): string {
  return set.length > 0 ? set.join(", ") : "(none)";
}
