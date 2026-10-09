/**
 * The turn rules of the table window. Everything with a number in it is the
 * game's own: the round (menu/combatRound.ts), movement and paths
 * (world/pathing.ts), the monster's whole turn (session/hostileTurns.ts
 * resolveMonsterTurn, on a World built from this scene), attacks, damage,
 * healing and loot. Each rule changes the scene at once and returns what
 * happened as CombatEvents; the window plays them back.
 *
 * Copied from the bench's Play panel. Two changes: the dice the engine rolls on
 * the table draw from the host (bindFightEnv, env.rng) instead of a bench test
 * hook, and the clock the cast's clips are timed against is injectable (env.now,
 * defaulting to performance.now).
 *
 * Call bindFightEnv(host.env) before the first roll. Rolling unbound throws,
 * naming the fix, rather than quietly using Math.random and ignoring the host's
 * seeded or scripted source. Import-pure: nothing runs until a function is called.
 */
import type { CharacterSheet } from "../characters/creation";
import { applyHealing, newAdventuringDay } from "../characters/health";
import {
  activeCombatant,
  attackBlockedReason,
  dropCombatant,
  FEET_PER_TILE,
  hasHostiles,
  isPlayersTurn,
  spendActiveAction,
  spendActiveMovement,
  startCombat,
  withActiveEconomy,
} from "../menu/combatRound";
import { attackLine, bonusSources, sentenceCase } from "../menu/labels";
import { attackResultToReadout } from "../render/rollReadoutAdapter";
import { abilityMod, type Beast, BESTIARY } from "../rules/bestiary";
import { type AttackResult, resolveAttack, resolveDamage } from "../rules/combat";
import { parseDiceNotation, rollDice } from "../rules/dice";
import {
  attackBonusSourcesFor,
  attackerBonusFor,
  damageMonster,
  effectiveSpeedFt,
  monsterArmorClassFor,
  type MonsterStatblock,
  statblockFor,
  weaponDamageNotationFor,
} from "../session/combat";
import { attackEvents, type CombatEvent } from "../session/combatEvents";
import { resolveMonsterTurn } from "../session/hostileTurns";
import { monsterPassivePerception, monsterShoveProfile, proneAttackMode, type RollMode, standUpCostFt, unarmedStrike } from "../session/maneuvers";
import { restBlockedReason } from "../session/savePoints";
import type { CellCoord } from "../world/coordinates";
import { fieldCostFt } from "../world/pathing";
import { emptyWorld, getCell, setCell } from "../world/perception";
import { tileDistance } from "../world/reach";
import { canSeeEachOther } from "../world/visibility";
import { advApply, containerAt, doorAt, exitIsOpen, exitLockedWords, exitOn, leaveBody, rollLoot } from "./adventureRun";
import { worldManifest } from "./catalog";
import { blockedWords, creatureInSight, engineLayout, heroActionReady, heroField, heroReachTiles, hostileInSight, namerFor, noteSight, sightKit } from "./sight";
import {
  awakeHostiles,
  type Creature,
  creatureAt,
  creatureById,
  creatureLabel,
  DOWN_NOTE,
  HERO_ID,
  heroDown,
  type LogLine,
  type PlayState,
  same,
  SCENE_KIT,
  sentence,
  type XY,
} from "./state";
import { playClips } from "./ui/cast";

const SCENE_CELL: CellCoord = { cx: 0, cy: 0 };
/** The game's monsters all move 30 ft (MonsterStatblock has no speed of its own yet). */
export const MONSTER_SPEED_FT = 30;

export interface TurnResult {
  events: CombatEvent[];
  /** Why nothing happened, in the player's words; null when it happened. */
  refused: string | null;
}
export const refusedWith = (reason: string): TurnResult => ({ events: [], refused: reason });

// ---------------------------------------------------------------------------
// The dice and the clock: the host's, not a global.
// ---------------------------------------------------------------------------

/** What the table's rolls and clock come from. `host.env` satisfies it (rng); `now` is optional and defaults to performance.now. */
export interface FightEnv {
  /** A number from 0 up to, not including, 1. */
  rng(): number;
  /** Milliseconds, for timing the cast's clips. */
  now?(): number;
}

let env: FightEnv | null = null;
/** Identifies the current binding, so a window disposing late cannot unbind its successor. */
let envBinding: object | null = null;

/**
 * Bind the source of the table's dice and clock. Replaces any earlier binding.
 * Returns an unbind function that clears the binding only if it is still the
 * current one.
 */
export function bindFightEnv(e: FightEnv): () => void {
  const mine = {};
  envBinding = mine;
  env = e;
  return () => {
    if (envBinding !== mine) return;
    envBinding = null;
    env = null;
  };
}

/** Whether a source is bound. */
export function fightEnvBound(): boolean {
  return env !== null;
}

function bound(): FightEnv {
  if (!env) throw new Error("The table's dice are not bound to a host. Call bindFightEnv(host.env) first.");
  return env;
}

/**
 * Every die the engine rolls on the table (a kick, a shove, a Stealth check, a swing) draws from here, which is the host's
 * env.rng. The bench's host answers with its test hook when one is installed, so a test can make a roll land where it needs to.
 */
export const tableRng = (): number => bound().rng();

/** The clock the cast's clips are timed against. The host's env.now when it gives one, else performance.now. */
export const tableNow = (): number => {
  const e = bound();
  return e.now ? e.now() : performance.now();
};

// ---------------------------------------------------------------------------
// Hiding, and what a hostile notices. The engine's maneuvers (session/maneuvers.ts) roll the
// checks; these are the board's side of them.
// ---------------------------------------------------------------------------

/** Sneaking, or hidden: a step that would let a hostile notice the hero rolls Stealth against its passive Perception instead. */
export const stealthy = (p: PlayState): boolean => p.sneaking || p.heroHidden;

/** Whether this creature could see the hero right now: the two see each other (a wall or a shut door stops it). */
export const creatureCouldSee = (p: PlayState, c: Creature): boolean => canSeeEachOther(sightKit(p).opaque, c.at, p.heroAt);

/** A creature's passive Perception, the DC for Hide, Sneak and Pickpocket. */
export const creaturePassive = (c: Creature): number => monsterPassivePerception(c.token);

/** The creature's bestiary entry when it has one (the goblin, the skeleton), else its statblock: what a contest reads its skills from. */
export function creatureStats(c: Creature): Beast | MonsterStatblock {
  return BESTIARY.find((b) => b.tokenAssetId === c.token) ?? statblockFor(c.token);
}

/** What a context menu needs to know about a creature: its SRD type and size, and whether it is a person (pockets, speech). */
export function creatureKind(c: Creature): { type: string; size: string; humanoid: boolean } {
  const beast = BESTIARY.find((b) => b.tokenAssetId === c.token);
  const type = beast?.type ?? (c.token === "token_drone" ? "construct" : "humanoid");
  return { type, size: monsterShoveProfile(c.token).size, humanoid: (type.split("(")[0] ?? "").trim().toLowerCase() === "humanoid" };
}

/** A creature's modifier on an ability (a contest against "dex" reads its Dexterity), from its bestiary entry or statblock. */
export function creatureAbility(c: Creature, key: "str" | "dex" | "con" | "int" | "wis" | "cha"): number {
  const s = creatureStats(c);
  return "scores" in s ? abilityMod(s.scores[key]) : s.abilityModifiers[key];
}

/** What a fight lists for a creature in startCombat. */
const hostileEntry = (p: PlayState, c: Creature): { id: string; label: string; speedFt: number } => ({ id: c.id, label: creatureLabel(p, c), speedFt: MONSTER_SPEED_FT });

/** What a creature is called in a line that may be about something the hero has not seen: its label once seen, "something" before. */
const knownLabel = (p: PlayState, c: Creature): string => (c.seen ? creatureLabel(p, c) : "something");

/** A combatant's id as words for a line: the creature's label once seen, "something" before. */
function knownLabelOf(p: PlayState, id: string): string {
  const c = creatureById(p, id);
  return c ? knownLabel(p, c) : "something";
}

/**
 * Roll initiative with the game's own startCombat: d20 plus Dexterity for the hero, the engine's fixed bonus for each hostile. `wake` are
 * the creatures that started it (they notice the hero, or the hero struck them, or the DM woke them): they wake, and every hostile
 * that is awake is in the order.
 */
export function startFight(p: PlayState, fromHiding = false, wake: readonly Creature[] = []): void {
  for (const c of wake) if (c.hostile) c.awake = true;
  const foes = awakeHostiles(p);
  if (foes.length === 0) return;
  // A fight starts in the open: whatever hiding the hero had is over. The exception is the hero starting it with a strike from hiding
  // (an attack, a kick, a shove): that strike has advantage and is what ends the hiding (landSwing), unless a hostile's turn comes first.
  if (!fromHiding) {
    if (p.heroHidden) p.log.push({ text: "You are no longer hidden.", tone: "plain" });
    p.heroHidden = false;
    p.sneaking = false;
  }
  p.round = startCombat({
    player: { id: HERO_ID, label: p.hero.name, dexModifier: p.hero.modifiers.dex, speedFt: effectiveSpeedFt(p.hero) },
    hostiles: foes.map((c) => hostileEntry(p, c)),
  });
  const order = p.round.order.map((cb) => `${cb.id === HERO_ID ? p.hero.name : sentenceCase(knownLabelOf(p, cb.id))} ${cb.initiative}`).join(", ");
  p.log.push({ text: `Roll initiative! ${order}.`, tone: "plain" });
}

/**
 * A sleeping hostile joins a fight that is already on (it noticed the hero, was struck, or the DM woke it): it wakes and rolls its own
 * initiative with startCombat's own bonus and dice, and takes its place in the order. Nobody's turn moves: if it sorts before whoever
 * is acting it first acts next round, otherwise later this round. Returns its initiative, or null when it was not a hostile or is already in.
 */
export function joinFight(p: PlayState, c: Creature): number | null {
  const round = p.round;
  if (!round || !c.hostile || round.order.some((cb) => cb.id === c.id)) return null;
  c.awake = true;
  // startCombat rolls and sorts; ask it for just this creature (a throwaway hero beside it) and take the creature's combatant.
  const rolled = startCombat({ player: { id: HERO_ID, label: p.hero.name, dexModifier: 0, speedFt: 0 }, hostiles: [hostileEntry(p, c)] }).order.find((cb) => cb.id === c.id)!;
  let at = round.order.findIndex((cb) => cb.initiative < rolled.initiative);
  if (at < 0) at = round.order.length;
  const order = [...round.order.slice(0, at), rolled, ...round.order.slice(at)];
  p.round = { ...round, order, activeIndex: at <= round.activeIndex ? round.activeIndex + 1 : round.activeIndex };
  p.log.push({ text: `${sentenceCase(knownLabel(p, c))} joins the fight. Initiative ${rolled.initiative}.`, tone: "plain" });
  return rolled.initiative;
}

/** One square, as the engine allows it: next to the hero, open, within the turn's movement, and paid for in a fight. */
export function heroStepTo(p: PlayState, to: XY): TurnResult {
  if (heroDown(p)) return refusedWith(DOWN_NOTE);
  if (p.round && !isPlayersTurn(p.round)) return refusedWith("Wait for your turn.");
  if (tileDistance(p.heroAt, to) !== 1) return refusedWith("One square at a time.");
  // A way out that is shut (a door held shut until the story says so) is not stepped onto: the adventure's own words say why.
  const shut = exitOn(p, to);
  if (shut && !exitIsOpen(p, shut.exit)) return refusedWith(exitLockedWords(shut.exit));
  if (fieldCostFt(heroField(p), to) === undefined) return refusedWith(blockedWords(p, to));
  if (p.round) {
    const next = spendActiveMovement(p.round, FEET_PER_TILE);
    if (!next) return refusedWith(blockedWords(p, to));
    p.round = next;
  }
  const from = { ...p.heroAt };
  p.heroAt = { ...to };
  noteSight(p);
  return { events: [{ kind: "move", tokenId: HERO_ID, from, path: [{ ...to }] }], refused: null };
}

/** The dice behind a swing, for the dice tray: every d20 thrown and, on a hit, every damage die. */
export interface SwingDice {
  /** The d20 that counted. */
  roll: number;
  /** Every d20 thrown, in order: two when advantage or disadvantage applied. */
  d20s: number[];
  /** "advantage" or "disadvantage" when the roll had one. */
  mode: RollMode | null;
  /** Why it had one, in words for the log. */
  modeWhy: string[];
  modifier: number;
  total: number;
  target: number;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  /** Damage dice. A kick has none (1 plus Strength, a flat number): `rolls` is empty and `total` is the number. */
  damage?: { rolls: number[]; sides: number; modifier: number; total: number };
}

/** A swing at a creature, rolled but not yet landed, so the tray can show it before the scene changes. */
export interface Swing {
  dice: SwingDice;
  result: AttackResult;
  bonus: number;
  targetAC: number;
  sources: ReturnType<typeof bonusSources>;
  /** A kick (an unarmed strike) rather than the weapon in the hero's hand. */
  kick: boolean;
  /** The maneuver's own log line, for a kick. A weapon swing builds its line when it lands. */
  kickLine?: string;
}

/**
 * The roll mode a swing at this creature has, and why, from the SRD's own rules: advantage when the hero is hidden (an unseen
 * attacker) and when the target is prone and within 5 feet; disadvantage when it is prone and farther off. `asked` is the mode
 * a DM check carries. Advantage and disadvantage cancel.
 */
function swingMode(p: PlayState, m: Creature, asked?: "advantage" | "disadvantage"): { advantage: boolean; disadvantage: boolean; mode: RollMode | null; why: string[] } {
  const why: string[] = [];
  let adv = asked === "advantage";
  let dis = asked === "disadvantage";
  if (asked) why.push(asked === "advantage" ? "the DM gave you advantage" : "the DM gave you disadvantage");
  if (p.heroHidden) {
    adv = true;
    why.push("you were hidden");
  }
  if (m.prone) {
    const feet = tileDistance(p.heroAt, m.at) * FEET_PER_TILE;
    if (proneAttackMode(feet) === "advantage") {
      adv = true;
      why.push("it is prone and you are next to it");
    } else {
      dis = true;
      why.push("it is prone and you are not next to it");
    }
  }
  if (adv && dis) return { advantage: false, disadvantage: false, mode: null, why: ["advantage and disadvantage cancel out"] };
  return { advantage: adv, disadvantage: dis, mode: adv ? "advantage" : dis ? "disadvantage" : null, why };
}

/** The hero's swing at a creature, rolled with the game's own dice but NOT applied: the weapon in hand, or a kick (an unarmed strike, with its own damage and no weapon bonuses). */
export function rollSwing(p: PlayState, m: Creature, kind: "weapon" | "kick", asked?: "advantage" | "disadvantage"): Swing {
  const targetAC = monsterArmorClassFor(m.token);
  const mode = swingMode(p, m, asked);
  if (kind === "kick") {
    const k = unarmedStrike({ attacker: p.hero, targetAC, ...(mode.mode ? { advantage: mode.mode } : {}), rng: tableRng, label: "Kick" });
    const bonus = p.hero.modifiers.str + p.hero.proficiencyBonus;
    const fumble = k.roll === 1;
    const dice: SwingDice = {
      roll: k.roll,
      d20s: k.dice.map((d) => d.result),
      mode: mode.mode,
      modeWhy: mode.why,
      modifier: bonus,
      total: k.total,
      target: targetAC,
      hit: k.hit,
      critical: k.critical,
      fumble,
      ...(k.hit ? { damage: { rolls: [], sides: 0, modifier: k.damage, total: k.damage } } : {}),
    };
    return { dice, result: { roll: k.roll, total: k.total, hit: k.hit, critical: k.critical, fumble }, bonus, targetAC, sources: undefined, kick: true, kickLine: k.line };
  }
  const bonus = attackerBonusFor(p.hero);
  const sources = bonusSources(attackBonusSourcesFor(p.hero), bonus);
  // The engine rolls the d20 once or twice; watching its draws puts every die in the tray.
  const draws: number[] = [];
  const watching = (): number => {
    const v = tableRng();
    draws.push(v);
    return v;
  };
  const result = resolveAttack({ attackerBonus: bonus, targetAC, advantage: mode.advantage, disadvantage: mode.disadvantage, rng: watching });
  const notation = weaponDamageNotationFor(p.hero);
  const rolled = result.hit ? resolveDamage(notation, tableRng, result.critical) : null;
  const parsed = parseDiceNotation(notation);
  const dice: SwingDice = {
    roll: result.roll,
    d20s: draws.map((v) => Math.floor(v * 20) + 1),
    mode: mode.mode,
    modeWhy: mode.why,
    modifier: bonus,
    total: result.total,
    target: targetAC,
    hit: result.hit,
    critical: result.critical,
    fumble: result.fumble,
    ...(rolled ? { damage: { rolls: rolled.rolls, sides: parsed.sides, modifier: parsed.modifier, total: rolled.total } } : {}),
  };
  return { dice, result, bonus, targetAC, sources, kick: false };
}

/**
 * A slain creature: it leaves the board and the fight, and the body lies where it fell. The fight goes on while any hostile is left in it,
 * and ends with the last; when no hostile is awake any more the day turns over so the hero can make camp (health.ts newAdventuringDay).
 */
export function slayCreature(p: PlayState, c: Creature): void {
  if (!p.creatures.includes(c)) return;
  p.fallenAt = { ...c.at };
  p.creatures = p.creatures.filter((x) => x !== c);
  if (p.round) {
    const rest = dropCombatant(p.round, c.id);
    p.round = hasHostiles(rest) ? rest : null;
  }
  // The kill drops nothing in the pack: the body lies where it fell, and the loot is found by searching it (leaveBody).
  leaveBody(p, c);
  // In an adventure the story is told which of its creatures fell (by instance id: "cellar_rats_2"), and may fire a beat or finish an objective.
  if (p.adventureId && c.adv) advApply(p, { type: "kill", spawn: c.adv.instance });
  if (awakeHostiles(p).length === 0) {
    p.round = null;
    p.hero = newAdventuringDay(p.hero);
  }
}

/** Attacking from hiding gives the hero away. */
export function revealHero(p: PlayState): void {
  if (p.heroHidden) p.log.push({ text: "Attacking gives you away: you are no longer hidden.", tone: "plain" });
  p.heroHidden = false;
  p.sneaking = false;
}

/**
 * Land a rolled swing: the damage (the swing's own, or `opts.damage` when something else decided it), the log line, a kill and the
 * events the board floats. `spend` takes the hero's action in a fight (a DM check has already paid for it).
 */
export function landSwing(p: PlayState, m: Creature, sw: Swing, opts: { spend: boolean; damage?: number }): CombatEvent[] {
  const label = creatureLabel(p, m);
  const d = sw.dice;
  const damage = opts.damage ?? (d.hit ? d.damage?.total : undefined);
  let down = false;
  const hpBefore = m.hp;
  if (damage !== undefined) {
    const hurt = damageMonster({ assetId: m.token, currentHp: m.hp }, damage);
    m.hp = hurt.currentHp;
    down = hurt.down;
  }
  if (opts.spend && p.round) p.round = spendActiveAction(p.round) ?? p.round;
  const base = sw.kick
    ? `${sw.kickLine ?? "Kick."}${down ? ` ${sentenceCase(label)} goes down.` : ""}`
    : attackLine({
        attacker: p.hero.name,
        target: label,
        roll: d.roll,
        modifier: d.modifier,
        total: d.total,
        targetAC: sw.targetAC,
        hit: d.hit,
        critical: d.critical,
        fumble: d.fumble,
        damage,
        targetDown: down,
        targetHpLeft: d.hit && !down ? m.hp : undefined,
        sources: sw.sources,
      });
  const modeNote = d.mode ? ` Rolled with ${d.mode} (${d.modeWhy.join(", ")}): ${d.d20s.join(" and ")}, kept ${d.roll}.` : "";
  p.log.push({ text: `${base}${modeNote}`, tone: d.hit ? "good" : "bad" });
  const readout = { ...attackResultToReadout(sw.result, sw.bonus, sw.targetAC, sw.sources), caption: `${p.hero.name} ${sw.kick ? "kicks" : "attacks"} ${label}`, critical: d.critical, fumble: d.fumble };
  const events = attackEvents({ by: HERO_ID, against: m.id, result: sw.result, readout, damage, hpLost: hpBefore - m.hp, down });
  if (down) slayCreature(p, m);
  revealHero(p);
  return events;
}
/** Why the hero cannot swing at this creature right now (the game's reach, sight and turn rules), or null. */
export function heroAttackRefusal(p: PlayState, m: Creature | undefined): string | null {
  if (heroDown(p)) return DOWN_NOTE;
  if (!m || !m.hostile) return "Nothing left to fight. Press Reset scene to bring it back.";
  if (!creatureInSight(p, m)) return "You do not see anything to attack.";
  const blocked = attackBlockedReason({
    round: p.round,
    attackerAt: p.heroAt,
    targetAt: m.at,
    downed: false,
    reachTiles: heroReachTiles(p),
    hasLineOfSight: sightKit(p).los(p.heroAt, m.at),
  });
  return blocked ? sentence(blocked) : null;
}

/**
 * The hero's swing at one creature, rolled with the game's own dice but NOT yet applied, so
 * the dice tray can show the roll before the scene changes: `apply` lands the
 * blow (hit points, the log, a kill) and returns its events.
 */
export function heroAttackRules(p: PlayState, m: Creature): { refused: string } | { refused: null; dice: SwingDice; swing: Swing; apply: () => CombatEvent[] } {
  const refused = heroAttackRefusal(p, m);
  if (refused) return { refused };
  const swing = rollSwing(p, m, "weapon");
  return { refused: null, dice: swing.dice, swing, apply: () => landSwing(p, m, swing, { spend: true }) };
}
/** The door or the chest next to the hero. Free in a fight, like any small object interaction. */
export function heroInteractRules(p: PlayState): TurnResult {
  if (heroDown(p)) return refusedWith(DOWN_NOTE);
  if (p.round && !isPlayersTurn(p.round)) return refusedWith("Wait for your turn.");
  const kit = SCENE_KIT[p.template];
  const near = (at: XY) => tileDistance(p.heroAt, at) <= 1;
  const door = doorAt(p);
  if (near(door)) {
    if (!p.doorOpen) {
      if (p.doorLocked) return refusedWith("Locked.");
      p.doorOpen = true;
      p.log.push({ text: `You open ${kit.doorLabel}.`, tone: "plain" });
    } else if (same(p.heroAt, door)) {
      return refusedWith("You are standing in the doorway. Step out of it first.");
    } else if (creatureAt(p, door)) {
      return refusedWith(`${sentenceCase(creatureLabel(p, creatureAt(p, door)!))} is standing in the doorway.`);
    } else {
      p.doorOpen = false;
      p.log.push({ text: `You close ${kit.doorLabel}.`, tone: "plain" });
    }
  } else if (near(containerAt(p))) {
    if (p.searched) return refusedWith(`You already emptied ${kit.containerLabel}.`);
    p.searched = true;
    p.log.push({ text: `You open ${kit.containerLabel}.`, tone: "plain" });
    rollLoot(p, "container");
  } else {
    return refusedWith(`Nothing to use here. Stand next to ${kit.doorLabel} or ${kit.containerLabel}.`);
  }
  // A door opened or shut changes what the hero sees.
  noteSight(p);
  return { events: [], refused: null };
}

/** Whether the door or the chest is next to the hero and can be used now (the Use button's own test for them). */
export function doorOrChestUsable(p: PlayState): boolean {
  const door = doorAt(p);
  const doorUsable = tileDistance(p.heroAt, door) <= 1 && !p.doorLocked && !same(p.heroAt, door) && !creatureAt(p, door);
  return doorUsable || (tileDistance(p.heroAt, containerAt(p)) <= 1 && !p.searched);
}

/** Why the hero cannot make camp right now, in words: the sheet's own day rule, then the table's (no fight, nothing hostile awake or in sight). Null when it can. */
export function restRefusal(p: PlayState): string | null {
  if (heroDown(p)) return DOWN_NOTE;
  return restBlockedReason(p.hero, { inFight: p.round !== null, hostileAwake: awakeHostiles(p).length > 0, hostileInSight: hostileInSight(p) });
}

const POTION_NOTATION = "2d4+2";
/** The d4s the last potion rolled, for the dice tray. */
export let lastPotionDice: number[] = [];

/**
 * A healing potion, with the game's own Potion of Healing dice and applyHealing. It takes the action in a fight.
 * `kit` names one of the sheet's other healing consumables (a Healer's kit, a Medfoam injector): the same 2d4+2 every
 * consumable heals (inventory/itemInfo.ts), and it spends one of that item's own uses instead of a potion.
 */
export function drinkPotionRules(p: PlayState, kit?: string): TurnResult {
  if (p.hero.dead) return refusedWith(DOWN_NOTE);
  const kitAt = kit ? (p.hero.consumables ?? []).findIndex((c) => c.name === kit) : -1;
  if (kit && (kitAt < 0 || p.hero.consumables[kitAt]!.uses <= 0)) return refusedWith("None left.");
  if (!kit && p.potions <= 0) return refusedWith("No potions left.");
  if (p.round && !heroActionReady(p)) return refusedWith(p.round && !isPlayersTurn(p.round) ? "Wait for your turn." : "You have already taken your action this turn.");
  if (!heroDown(p) && p.hero.currentHp >= p.hero.maxHp) return refusedWith("You are already at full health.");
  const before = p.hero.currentHp;
  // characters/health.ts potionHealing's own notation (SRD 5.1 Potion of Healing), rolled here so the tray can show each die.
  const heal = rollDice(POTION_NOTATION);
  lastPotionDice = heal.rolls;
  const outcome = applyHealing(p.hero, heal.total);
  p.hero = outcome.sheet;
  if (kit) p.hero = { ...p.hero, consumables: p.hero.consumables.map((c, i) => (i === kitAt ? { ...c, uses: c.uses - 1 } : c)) };
  else p.potions--;
  if (p.round) p.round = spendActiveAction(p.round) ?? p.round;
  p.log.push({ text: `${p.hero.name} ${kit ? `uses the ${kit}` : "drinks a potion of healing"}. ${outcome.note}`, tone: "good" });
  return { events: [{ kind: "heal", tokenId: HERO_ID, amount: p.hero.currentHp - before }], refused: null };
}

/**
 * One creature's whole turn, by the game's own resolveMonsterTurn on a World
 * built from this scene (every creature a token in it): it paths round walls,
 * and other creatures, walks what its movement pays for and swings if it can.
 * Returns the events and the scene it ends in, WITHOUT applying them, so the
 * panel can walk the creature square by square and land the blow when the swing plays.
 */
export function monsterTurnRules(p: PlayState, m: Creature): { events: CombatEvent[]; endAt: XY | null; sheet: CharacterSheet; lines: LogLine[] } {
  if (!p.round) return { events: [], endAt: null, sheet: p.hero, lines: [] };
  // A creature that was knocked prone spends half its movement standing up before anything else (SRD 5.1): the engine's own
  // resolveMonsterTurn is simply given less movement, so it walks less far (or not at all) and still swings if it can reach.
  let economy = activeCombatant(p.round)?.economy;
  let standLine: LogLine | null = null;
  if (m.prone && economy) {
    const cost = Math.min(economy.movementRemaining, standUpCostFt(MONSTER_SPEED_FT));
    economy = { ...economy, movementRemaining: economy.movementRemaining - cost };
    m.prone = false;
    playClips(m.actor, ["idle"], tableNow());
    standLine = { text: `${sentenceCase(creatureLabel(p, m))} spends ${cost} feet of its movement to stand up.`, tone: "plain" };
  }
  const world = setCell(emptyWorld(), SCENE_CELL, engineLayout(p));
  const out = resolveMonsterTurn({
    world,
    cell: SCENE_CELL,
    manifest: worldManifest(p.template),
    monsterId: m.id,
    playerTokenId: HERO_ID,
    sheet: p.hero,
    namer: namerFor(p),
    economy,
  });
  p.round = withActiveEconomy(p.round, out.economy);
  const after = getCell(out.world, SCENE_CELL)?.tokens.find((t) => t.id === m.id);
  const lines: LogLine[] = standLine ? [standLine] : [];
  const seen = new Set<string>();
  for (const l of out.lines) {
    seen.add(l.text);
    lines.push({ text: l.text, tone: l.hit ? "good" : "bad" });
  }
  for (const s of out.story) if (!seen.has(s)) lines.push({ text: sentence(s), tone: "plain" });
  return { events: out.events, endAt: after ? { x: after.x, y: after.y } : null, sheet: out.sheet, lines };
}
