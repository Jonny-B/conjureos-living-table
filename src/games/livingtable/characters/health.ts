/**
 * Damage, healing, death saves and rest: everything that moves a character's
 * hit points, in one place, as pure functions over a CharacterSheet.
 *
 * Why this module exists at all. Hit points used to be a one-way ratchet.
 * `Math.max(0, Math.min(maxHp, currentHp + delta))` in the play screen was the
 * entire zero-HP story: a character driven to 0 kept attacking, kept moving,
 * and could be topped back up by an item; grepping for `deathSave`,
 * `unconscious` or `stabilise` across `src/` found nothing but an unused
 * entry in `rules/conditions.ts`'s list. There was no rest surface of any
 * kind. DESIGN.md commits to the opposite twice, listing HP plus hit dice as
 * in scope and stating "A character going down doesn't cost anything and
 * doesn't end the campaign; SRD death saves apply" -- a promise that was only
 * satisfied vacuously, because losing was not implementable.
 *
 * Everything here is free, per the cost model: no AI call, no credit, ever.
 * "Never charge for losing" means a hurt newcomer's way back up cannot be a
 * paid surface.
 *
 * One deliberate SRD 5.1 omission, named rather than hidden: instant death
 * (damage whose remainder past 0 equals or exceeds the character's hit point
 * maximum kills outright, skipping death saves) is not implemented. At levels
 * 1 to 3 a single hit can plausibly clear that bar, and a newcomer's first
 * fight ending in "you are simply dead, no roll" is a worse first hour than
 * the tension of a death-save tracker. Stated here as a choice, not a gap.
 */
import { rollDice, rollDie } from "../rules/dice";
import type { CheckResult } from "../rules/checks";
import type { SpellSlots } from "../rules/spells";
import type { CharacterSheet } from "./creation";
import { accessoryStatus } from "./equipment";
import { GEAR_ROLES, MAGIC_TIERS, accessoryEffect, gearItemKey, gearItemName, type ArchetypeId } from "./equipmentTypes";

/** SRD 5.1: a death saving throw is a flat d20 against DC 10, with no modifier of any kind. */
export const DEATH_SAVE_DC = 10;

/** How a change to hit points came out, with the one plain-English line the story log and the dice log both render. */
export interface VitalsOutcome {
  sheet: CharacterSheet;
  note: string;
  /** True on the transition into 0 HP, so the caller can zero the action economy exactly once. */
  wentDown?: boolean;
  /** True on the transition out of 0 HP. */
  backUp?: boolean;
  /** True on the transition into dead. */
  died?: boolean;
}

const NO_SAVES = { successes: 0, failures: 0 };

/**
 * Apply damage. Three different things happen depending on where the
 * character already is, and all three are SRD 5.1:
 *
 *  - Standing: hit points come off, and reaching exactly 0 knocks them
 *    unconscious and starts the death saves.
 *  - Dying: damage taken at 0 HP is itself a failed death save, and a critical
 *    hit counts as two.
 *  - Stable at 0 HP: any damage starts them dying again.
 */
export function applyDamage(sheet: CharacterSheet, amount: number, critical = false): VitalsOutcome {
  if (sheet.dead) return { sheet, note: `${sheet.name} is beyond hurting.` };

  if (sheet.downed || sheet.stable) {
    const added = critical ? 2 : 1;
    const failures = sheet.deathSaves.failures + added;
    if (failures >= 3) {
      return {
        sheet: { ...sheet, downed: false, stable: false, dead: true, deathSaves: { ...sheet.deathSaves, failures: 3 } },
        note: `${sheet.name} is hit while down. That is the third failure. ${sheet.name} does not get back up.`,
        died: true,
      };
    }
    return {
      sheet: { ...sheet, downed: true, stable: false, deathSaves: { successes: sheet.deathSaves.successes, failures } },
      note: `${sheet.name} is hit while down: ${added === 2 ? "a critical hit, two failed death saves" : "a failed death save"} (${failures} of 3).`,
    };
  }

  const nextHp = Math.max(0, sheet.currentHp - Math.max(0, amount));
  if (nextHp > 0) {
    return { sheet: { ...sheet, currentHp: nextHp }, note: `${sheet.name} takes ${amount} damage (${nextHp}/${sheet.maxHp} left).` };
  }
  return {
    sheet: { ...sheet, currentHp: 0, downed: true, stable: false, deathSaves: { ...NO_SAVES } },
    note: `${sheet.name} takes ${amount} damage and goes down. Roll a death save on each of your turns.`,
    wentDown: true,
  };
}

/** Healing. Any healing at all brings a downed or stable character back to consciousness at that many hit points, per SRD 5.1, and wipes the death-save tally. */
export function applyHealing(sheet: CharacterSheet, amount: number): VitalsOutcome {
  if (sheet.dead) return { sheet, note: `Nothing here can help ${sheet.name} now.` };
  const healed = Math.max(0, amount);
  if (sheet.downed || sheet.stable) {
    const hp = Math.min(sheet.maxHp, Math.max(1, healed));
    return {
      sheet: { ...sheet, currentHp: hp, downed: false, stable: false, deathSaves: { ...NO_SAVES } },
      note: `${sheet.name} is back on their feet at ${hp}/${sheet.maxHp}.`,
      backUp: true,
    };
  }
  const hp = Math.min(sheet.maxHp, sheet.currentHp + healed);
  return { sheet: { ...sheet, currentHp: hp }, note: `${sheet.name} recovers ${hp - sheet.currentHp} hit points (${hp}/${sheet.maxHp}).` };
}

/**
 * Resolve one death saving throw against an already-rolled `CheckResult` (the
 * caller rolls it with the same `resolveSavingThrow({ modifier: 0, dc: 10 })`
 * every other save in this game goes through, so there is still exactly one
 * d20 implementation).
 *
 * SRD 5.1, in full: 10 or higher is a success and below it is a failure; a
 * natural 20 puts the character back up at 1 hit point immediately; a natural
 * 1 counts as two failures; three successes stabilise; three failures do not.
 */
export function applyDeathSave(sheet: CharacterSheet, result: CheckResult): VitalsOutcome {
  if (!sheet.downed) return { sheet, note: `${sheet.name} is not dying right now.` };

  if (result.roll === 20) {
    return {
      sheet: { ...sheet, currentHp: 1, downed: false, stable: false, deathSaves: { ...NO_SAVES } },
      note: `Natural 20. ${sheet.name} comes round at 1 hit point.`,
      backUp: true,
    };
  }

  if (result.roll === 1) {
    const failures = sheet.deathSaves.failures + 2;
    if (failures >= 3) {
      return {
        sheet: { ...sheet, downed: false, dead: true, deathSaves: { ...sheet.deathSaves, failures: 3 } },
        note: `Natural 1, and that is two failures at once. ${sheet.name} does not get back up.`,
        died: true,
      };
    }
    return {
      sheet: { ...sheet, deathSaves: { successes: sheet.deathSaves.successes, failures } },
      note: `Natural 1: two failed death saves (${failures} of 3).`,
    };
  }

  if (result.success) {
    const successes = sheet.deathSaves.successes + 1;
    if (successes >= 3) {
      return {
        sheet: { ...sheet, downed: false, stable: true, deathSaves: { successes: 3, failures: sheet.deathSaves.failures } },
        note: `Third success. ${sheet.name} is stable: still out cold at 0 hit points, but no longer dying. Rest or healing brings them round.`,
      };
    }
    return {
      sheet: { ...sheet, deathSaves: { successes, failures: sheet.deathSaves.failures } },
      note: `Death save succeeded (${successes} of 3).`,
    };
  }

  const failures = sheet.deathSaves.failures + 1;
  if (failures >= 3) {
    return {
      sheet: { ...sheet, downed: false, dead: true, deathSaves: { successes: sheet.deathSaves.successes, failures: 3 } },
      note: `Third failed death save. ${sheet.name} does not get back up.`,
      died: true,
    };
  }
  return {
    sheet: { ...sheet, deathSaves: { successes: sheet.deathSaves.successes, failures } },
    note: `Death save failed (${failures} of 3).`,
  };
}

// ── rest ─────────────────────────────────────────────────────────────────

/** Why a short rest is unavailable right now, in words, or null when it can be taken. */
export function shortRestBlockedReason(sheet: CharacterSheet): string | null {
  if (sheet.dead) return "There is nobody left to rest.";
  if (sheet.downed) return "You are dying. Somebody has to bring you round first.";
  if (sheet.hitDiceRemaining <= 0) return "No hit dice left. A long rest gives them back.";
  if (sheet.currentHp >= sheet.maxHp && !sheet.stable) return "You are already at full health.";
  return null;
}

/**
 * A short rest: spend one hit die, heal that die plus your Constitution
 * modifier (SRD 5.1, floored at 1 so a negative CON can never make resting
 * hurt). This is the free, non-AI way back up that the game had no surface for
 * at all before now.
 */
export function shortRest(sheet: CharacterSheet, rng: () => number = Math.random): VitalsOutcome {
  const blocked = shortRestBlockedReason(sheet);
  if (blocked) return { sheet, note: blocked };
  const rolled = rollDie(sheet.hitDieSides, rng);
  const base = Math.max(1, rolled + sheet.modifiers.con);
  // Contract v2, SRD Periapt of Wound Closure: "whenever you roll a Hit Die to
  // regain hit points, double the number of hit points it restores". Only a
  // worn, attuned amulet counts (accessoryStatus is the live engine read).
  const amulet = accessoryStatus(sheet, "amulet");
  const factor = amulet.active && amulet.effect?.kind === "hitDieHealingMultiplier" ? amulet.effect.factor : 1;
  const healed = base * factor;
  const spent: CharacterSheet = { ...sheet, hitDiceRemaining: sheet.hitDiceRemaining - 1 };
  const outcome = applyHealing(spent, healed);
  const doubled = factor > 1 && amulet.name ? `, ${factor === 2 ? "doubled" : `times ${factor}`} by the ${amulet.name}` : "";
  let note = `You sit down and catch your breath. One hit die spent (d${sheet.hitDieSides} rolled ${rolled}, ${sheet.modifiers.con >= 0 ? "+" : ""}${sheet.modifiers.con} Constitution${doubled}): ${healed} hit points back. ${outcome.sheet.currentHp}/${outcome.sheet.maxHp}, ${spent.hitDiceRemaining} hit ${spent.hitDiceRemaining === 1 ? "die" : "dice"} left.`;
  let rested = outcome;

  // Contract v2, SRD Ring of Regeneration: 1d6 every 10 minutes while on at
  // least 1 hit point. A short rest is an hour, six intervals, so a worn,
  // attuned ring rolls its dice (6d6) once here, AFTER the hit die. The note
  // names what was actually gained first and the roll second, so a roll the
  // hit point maximum caps is never reported as healing that did not happen.
  const ring = accessoryStatus(sheet, "ring");
  if (ring.active && ring.effect?.kind === "restRegeneration" && rested.sheet.currentHp >= 1 && !rested.sheet.dead) {
    const regen = rollDice(ring.effect.dice, rng).total;
    const before = rested.sheet.currentHp;
    const hp = Math.min(rested.sheet.maxHp, before + regen);
    rested = { ...rested, sheet: { ...rested.sheet, currentHp: hp } };
    note += ` ${ring.name}: ${hp - before} more hit points (${ring.effect.dice} rolled ${regen}). ${hp}/${rested.sheet.maxHp}.`;
  }

  return { ...rested, note };
}

function refreshedSlots(slots: SpellSlots | null): SpellSlots | null {
  if (!slots) return null;
  const next: SpellSlots = {};
  for (const [level, bucket] of Object.entries(slots)) next[Number(level)] = { max: bucket.max, used: 0 };
  return next;
}

/**
 * Why a long rest is unavailable right now, in words, or null when it can be
 * taken.
 *
 * The third clause is the one that matters. Before it, this function returned
 * non-null only for a dead or downed character: there was no per-day cap, no
 * time cost, no location restriction and no risk, so Make camp was an
 * unlimited free full heal that voided the potion, hit-die and spell-slot
 * economies at once. A cold reader who has never played a tabletop game
 * derived the exploit from one screen of text: "Make camp is an infinite free
 * heal, Catch your breath is strictly worse and pointless, and healing potions
 * are worthless. I'd rest to full after every single fight and never buy an
 * item again." Every part of that was true. Note that this game's own written
 * model of its economy claimed hit dice were "what stops resting being a free
 * full heal", which was false in the other direction too: a long rest refills
 * those as well.
 *
 * SRD 5.1 already has the rule ("a character can't benefit from more than one
 * long rest in a 24-hour period"), so this is the SRD being enforced rather
 * than a house rule invented to patch a hole. The in-fiction day turns over
 * when the campaign actually moves on; see `newAdventuringDay`.
 */
export function longRestBlockedReason(sheet: CharacterSheet): string | null {
  if (sheet.dead) return "There is nobody left to rest.";
  if (sheet.downed) return "You are dying. Somebody has to bring you round first.";
  if (sheet.longRestUsed) {
    return "You have already slept through this day. Win a fight or get somewhere new, and you can make camp again tomorrow night.";
  }
  return null;
}

/**
 * The in-fiction day turns over: this character can make camp again.
 *
 * Deliberately keyed to the same two events the game already counts as a
 * milestone (a fight won, a room the DM built), because those are exactly the
 * things that make a day's adventuring a day's adventuring, and because it
 * means the rule a player learns is one rule: something has to happen between
 * one night's sleep and the next. Pure, and a no-op when the character has not
 * slept, so callers can fire it on every milestone without checking first.
 */
export function newAdventuringDay(sheet: CharacterSheet): CharacterSheet {
  return sheet.longRestUsed ? { ...sheet, longRestUsed: false } : sheet;
}

/**
 * A long rest: full hit points, every hit die back, every spell slot back, once per in-fiction day. Free, per the cost model, and the only thing that refills a caster's slots.
 *
 * Contract v2: this is the game's dawn. Every charged item the character has
 * spent from and that is below its maximum (SRD Ring of Evasion: "regains
 * 1d3 expended charges daily at dawn", worn or not) rolls its recharge dice
 * through `rng`, capped at the maximum. An absent `itemCharges` key already
 * means full, so an item that never spent a charge rolls nothing and the
 * rng is not called.
 */
export function longRest(sheet: CharacterSheet, rng: () => number = Math.random): VitalsOutcome {
  const blocked = longRestBlockedReason(sheet);
  if (blocked) return { sheet, note: blocked };
  const recharge = rechargeAtDawn(sheet, rng);
  return {
    sheet: {
      ...sheet,
      currentHp: sheet.maxHp,
      hitDiceRemaining: sheet.level,
      spellSlots: refreshedSlots(sheet.spellSlots),
      downed: false,
      stable: false,
      deathSaves: { ...NO_SAVES },
      longRestUsed: true,
      ...(recharge ? { itemCharges: recharge.itemCharges } : {}),
    },
    note:
      `You make camp and sleep the night through. Full health (${sheet.maxHp}/${sheet.maxHp}), every hit die back` +
      `${sheet.spellSlots ? ", every spell slot back" : ""}. That is this day's sleep spent: the next one waits until something has happened.` +
      (recharge ? recharge.note : ""),
    backUp: sheet.downed || sheet.stable,
  };
}

/** The saveRescue recharge a long rest rolls, or null when every charged item is already full. */
function rechargeAtDawn(
  sheet: CharacterSheet,
  rng: () => number,
): { itemCharges: NonNullable<CharacterSheet["itemCharges"]>; note: string } | null {
  const stored = sheet.itemCharges;
  if (!stored) return null;
  const itemCharges = { ...stored };
  let note = "";
  for (const role of GEAR_ROLES) {
    for (const tier of MAGIC_TIERS) {
      const effect = accessoryEffect(role, tier);
      if (effect?.kind !== "saveRescue") continue;
      const key = gearItemKey(role, tier);
      const stale = stored[key];
      if (stale === undefined) continue;
      const current = Math.max(0, Math.floor(stale));
      if (current >= effect.charges) continue;
      const rolled = rollDice(effect.rechargeDice, rng).total;
      const next = Math.min(effect.charges, current + rolled);
      const gained = next - current;
      itemCharges[key] = next;
      const name = gearItemName(sheet.archetypeId as ArchetypeId, role, tier) ?? "A charged item";
      note += ` ${name} regains ${gained} ${gained === 1 ? "charge" : "charges"} (${effect.rechargeDice} rolled ${rolled}): ${next} of ${effect.charges}.`;
    }
  }
  return note ? { itemCharges, note } : null;
}

/**
 * The healing an inventory consumable does: 2d4 + 2, SRD 5.1's own Potion of
 * Healing. Kept here beside the rest of the hit-point math rather than in
 * session/combat.ts's name-keyword heuristic, so "how much does this heal"
 * has one answer in one place.
 */
export function potionHealing(rng: () => number = Math.random): number {
  return rollDice("2d4+2", rng).total;
}
