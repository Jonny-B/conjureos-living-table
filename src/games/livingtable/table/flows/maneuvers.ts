/**
 * The engine maneuvers a context action starts: kick, shove, hide, sneak, pickpocket, lock and listen.
 */
import { harvestForToken, pocketPick, type CarriedItem } from "../../rules/corpses";
import {
  forceDoor,
  monsterShoveProfile,
  pickLock,
  proneEffects,
  pushDestination,
  shoveContest,
  skillCheck,
  type SkillCheckResult,
  sleightOfHand,
  standUpCostFt,
  stealthCheck,
} from "../../session/maneuvers";
import { type ContextAction } from "../../session/contextActions";
import { type CharacterSheet } from "../../characters/creation";
import { sentenceCase } from "../../menu/labels";
import { FEET_PER_TILE } from "../../menu/combatRound";
import { skillModifierFor } from "../../session/combat";
import { STEP_MS, castDirToward, playClips } from "../ui/cast";
import { approachTile, pathTo } from "../../world/pathing";
import { DEFAULT_MELEE_REACH_TILES, tileDistance } from "../../world/reach";
import { DIVIDER_X, creatureAt, creatureLabel, creatureName, hostilesOf, same, sentence, type Creature, type PlayState, type XY } from "../state";
import { takeIntoPack } from "../gearLoot";
import { worldManifest } from "../catalog";
import { MONSTER_SPEED_FT, creatureCouldSee, creaturePassive, creatureStats, landSwing, revealHero, rollSwing, tableRng } from "../fightRules";
import { creatureInSight, engineLayout, heroActionReady, heroField, heroesTurn, noteSight, noticers, sightKit } from "../sight";
import { LISTEN_DC } from "../dmScene";
import { bark, barksFor, signedNum } from "./tableKit";
import type { TableCtx } from "../tableCtx";

/**
 * A harvest: the skill check the body's entry asks for (a flat DC, rolled with the hero's real modifier). A success yields the item; a failure
 * yields nothing, and the carcass is spoiled either way (the flow marks it), so there is no free retry. Pure: the rng is the caller's.
 */
export function resolveHarvest(sheet: CharacterSheet, harvest: { item: CarriedItem; skill: "Survival" | "Nature"; dc: number }, rng: () => number): { check: SkillCheckResult; item: CarriedItem | null } {
  const check = skillCheck({ sheet, skill: harvest.skill, dc: harvest.dc, rng });
  return { check, item: check.success ? { ...harvest.item } : null };
}

export function installManeuvers(tc: TableCtx): void {
  /**
   * The start of a hostile maneuver (a kick, a shove): the creature is in sight, the fight is on (it starts one, or brings the creature into
   * the one that is, as an attack does), it is the hero's turn with the action ready, and the creature is within reach. Null when ready, else the refusal ("" for none).
   */
  async function startHostileManeuver(target: Creature | undefined, reach: number, what: string): Promise<string | null> {
    if (!target || !tc.st().creatures.includes(target) || !creatureInSight(tc.st(), target)) return `You do not see anything to ${what}.`;
    if (!target.hostile) return `${sentenceCase(creatureLabel(tc.st(), target))} is not hostile. You can only ${what} an enemy.`;
    if (!tc.inOrder(tc.st(), target)) {
      await tc.beginFight(true, [target, ...noticers(tc.st())]);
      if (!heroesTurn(tc.st())) return "";
    }
    const p = tc.st();
    if (!p.creatures.includes(target)) return "";
    if (!heroActionReady(p)) return "You have already used your action this turn.";
    if (tileDistance(p.heroAt, target.at) > reach) return `${sentenceCase(creatureLabel(p, target))} is out of your reach now. Step next to it first.`;
    return null;
  }

  /** Slide a creature along the engine's pushDestination (it stops before a wall, a prop, a token or the edge), square by square. Returns how many squares it moved. */
  async function pushCreatureBy(p: PlayState, m: Creature, squares: number): Promise<number> {
    if (!p.creatures.includes(m)) return 0;
    const path = pushDestination(engineLayout(p), worldManifest(p.template), m.at, p.heroAt, squares);
    for (const sq of path) {
      if (tc.st() !== p || !p.creatures.includes(m)) return 0;
      tc.stepAnim(m.actor, { ...m.at }, sq);
      m.at = { ...sq };
      noteSight(p);
      tc.refreshAll();
      await tc.wait(STEP_MS);
    }
    if (p.creatures.includes(m)) m.actor.dir = castDirToward(p.heroAt.x - m.at.x, p.heroAt.y - m.at.y);
    // A prone creature that was slid across the floor is still lying down.
    if (m.prone) playClips(m.actor, ["death"], performance.now());
    return path.length;
  }

  /** Knock a creature prone, by the engine's prone rules (SRD 5.1) and its condition immunities. Returns why not, or null. */
  function proneCreature(p: PlayState, m: Creature): string | null {
    if (!p.creatures.includes(m)) return "there is no creature there to knock down";
    const c = creatureStats(m);
    const label = creatureLabel(p, m);
    if ("conditionImmunities" in c && c.conditionImmunities?.some((x) => /prone/i.test(x))) return `${label} cannot be knocked prone`;
    if (m.prone) return `${label} is already prone`;
    const fx = proneEffects();
    m.prone = true;
    const parts = [fx.meleeAttackersHaveAdvantage ? "your attacks from next to it have advantage" : "", fx.standUpCostsHalfMovement ? `it will spend ${standUpCostFt(MONSTER_SPEED_FT)} feet of its movement to stand up` : ""].filter(Boolean);
    p.log.push({ text: `${sentenceCase(label)} is knocked prone: ${parts.join(", and ")}.`, tone: "good" });
    tc.overlay.float(tc.headOf(m.token, m.at), "PRONE", "info");
    // The animated figure falls and lies there (the death clip holds its last frame) until it stands up on its turn.
    playClips(m.actor, ["death"], performance.now());
    return null;
  }

  async function runEngineAction(act: ContextAction, tile: XY): Promise<void> {
    // The creature the menu was opened on (kick, shove, sneak up and pickpocket are about it).
    const on = creatureAt(tc.st(), tile);
    switch (act.id) {
      case "kick":
        return kickFlow(on);
      case "shove":
        return shoveFlow(on, "push");
      case "shove-prone":
        return shoveFlow(on, "prone");
      case "hide":
        return hideFlow(act);
      case "sneak":
        return sneakFlow(tile);
      case "sneak-up":
        return sneakUpFlow(on);
      case "pickpocket":
        return pickpocketFlow(act, on);
      case "pick-lock":
      case "force-door":
        return lockFlow(act);
      case "listen":
        return listenFlow(act);
      case "loot":
      case "loot-pile":
        return tc.openLootAt(tile);
      case "harvest":
        return harvestFlow(act, tile);
      default:
        return tc.refuse(`${act.label} is not something you can do here.`);
    }
  }

  /** Kick: an unarmed strike (d20 + Strength + proficiency against its AC; a hit deals 1 + Strength bludgeoning), both rolled in the tray, landed on the board. */
  async function kickFlow(m: Creature | undefined): Promise<void> {
    const why = await startHostileManeuver(m, DEFAULT_MELEE_REACH_TILES, "kick");
    if (why !== null) return tc.refuse(why);
    const p = tc.st();
    const target = { ...m!.at };
    tc.clearOptions();
    tc.fightWasOn = true;
    tc.busy = true;
    const sw = rollSwing(p, m!, "kick");
    await tc.throwSwingAttack(sw, target);
    if (!tc.alive || tc.st() !== p) return;
    await tc.throwSwingDamage(sw);
    const events = landSwing(p, m!, sw, { spend: true });
    tc.showAttack(events, m!.token, target);
    tc.swingAftermath(p, m!, events);
    await tc.afterManeuver();
  }

  /**
   * Shove: the hero's Athletics against the better of its Athletics and Acrobatics, a tie to the creature. Win, and it moves one
   * square straight away from the hero (the engine's pushDestination: it stops at a wall, a prop, a token) or falls prone.
   */
  async function shoveFlow(m: Creature | undefined, mode: "push" | "prone"): Promise<void> {
    const why = await startHostileManeuver(m, DEFAULT_MELEE_REACH_TILES, "shove");
    if (why !== null) return tc.refuse(why);
    const p = tc.st();
    const foe = m!;
    const out = shoveContest({ attacker: p.hero, target: { ...monsterShoveProfile(foe.token), name: creatureLabel(p, foe) }, mode, rng: tableRng });
    if (!out.allowed) return tc.refuse(out.reason ?? "You cannot shove that.");
    const target = { ...foe.at };
    tc.clearOptions();
    tc.fightWasOn = true;
    tc.busy = true;
    const mine = out.dice.filter((d) => d.label === "You")[0]!;
    const theirs = out.dice.filter((d) => d.label !== "You")[0]!;
    const myMod = out.attackerTotal - mine.result;
    const theirMod = out.targetTotal - theirs.result;
    await tc.rollStep(`Tap to roll your ${mode === "prone" ? "knock down" : "shove"}`, [{ kind: "d20", result: mine.result }], `Athletics ${mine.result} ${signedNum(myMod)} = ${out.attackerTotal}`, mode === "prone" ? "KNOCK DOWN" : "SHOVE", "plain", { modifier: myMod, total: out.attackerTotal });
    if (!tc.alive || tc.st() !== p) return;
    p.heroActor.dir = castDirToward(target.x - p.heroAt.x, target.y - p.heroAt.y);
    if (!tc.reducedMotion) playClips(p.heroActor, ["attack"], performance.now());
    await tc.foeThrow(p, foe, [{ kind: "d20", result: theirs.result }], `${theirs.result} ${signedNum(theirMod)} = ${out.targetTotal} vs ${out.attackerTotal}`, out.success ? "YOU WIN" : out.attackerTotal === out.targetTotal ? "A TIE HOLDS" : "IT HOLDS", out.success ? "good" : "bad", { modifier: theirMod, total: out.targetTotal, target: out.attackerTotal });
    if (!tc.alive || tc.st() !== p) return;
    tc.spendCost(p, "action");
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    revealHero(p);
    if (out.success && out.effect === "prone") {
      const refused = proneCreature(p, foe);
      if (refused) p.log.push({ text: sentence(`Nothing happens: ${refused}`), tone: "plain" });
    } else if (out.success) {
      const moved = await pushCreatureBy(p, foe, 1);
      if (!tc.alive || tc.st() !== p) return;
      p.log.push({ text: moved > 0 ? `${sentenceCase(creatureLabel(p, foe))} slides back ${moved * FEET_PER_TILE} feet.` : `${sentenceCase(creatureLabel(p, foe))} is pinned: a wall, a prop or another creature is right behind it, so it does not move.`, tone: moved > 0 ? "good" : "plain" });
    } else {
      tc.overlay.float(tc.headOf(foe.token, target), "HOLDS", "miss");
    }
    await tc.afterManeuver();
  }

  /**
   * Hide: one Stealth check against the passive Perception of each hostile that could see you (nobody can see you through a wall or a shut
   * door, so you are simply hidden). While hidden a hostile does not wake by sight; each step it could notice is another check.
   */
  async function hideFlow(act: ContextAction): Promise<void> {
    const p = tc.st();
    const seers = hostilesOf(p).filter((c) => creatureCouldSee(p, c));
    const dcs = seers.map((c) => creaturePassive(c));
    const watchers = seers.map((c) => ({ id: c.id, passivePerception: creaturePassive(c), name: creatureLabel(p, c) }));
    const out = stealthCheck({ sheet: p.hero, observers: watchers, rng: tableRng });
    const mod = skillModifierFor(p.hero, "Stealth");
    const hidden = out.spottedBy.length === 0;
    tc.clearOptions();
    tc.busy = true;
    await tc.rollStep("Tap to roll Stealth", out.dice, `Stealth ${out.total - mod} ${signedNum(mod)} = ${out.total}${watchers.length ? ` vs ${dcs.join("/")}` : ""}`, hidden ? "HIDDEN" : "SPOTTED", hidden ? "good" : "bad", { modifier: mod, total: out.total, ...(watchers.length ? { target: Math.max(...dcs) } : {}) });
    if (!tc.alive || tc.st() !== p) return;
    tc.spendCost(p, act.cost);
    p.heroHidden = hidden;
    p.log.push({ text: hidden ? `${out.line} You stay hidden until you attack, are noticed, or a fight starts.` : out.line, tone: hidden ? "good" : "bad" });
    if (hidden) tc.story({ text: "You slip out of sight.", tone: "good" }, false);
    await tc.afterManeuver();
  }

  /** Sneak: a mode, not a roll. Every step a hostile could notice is a Stealth check against its passive Perception (stealthStep). On a square, it also walks you there. */
  function sneakFlow(tile: XY): void {
    const p = tc.st();
    if (same(tile, p.heroAt)) {
      p.sneaking = !p.sneaking;
      if (!p.sneaking) p.heroHidden = false;
      p.log.push({ text: p.sneaking ? "You move quietly. Each step a creature could notice is a Stealth check." : "You stop sneaking.", tone: "plain" });
      tc.flushLog();
      tc.refreshAll();
      return;
    }
    const plan = tc.planFor(tile);
    if (plan.kind === "none") return tc.refuse(plan.reason);
    p.sneaking = true;
    p.log.push({ text: "You move quietly. Each step a creature could notice is a Stealth check.", tone: "plain" });
    tc.runPlan(plan);
  }

  /** Sneak up: sneaking mode on, and a walk to the square next to it. Each step it could notice is a Stealth check. */
  function sneakUpFlow(m: Creature | undefined): void {
    const p = tc.st();
    if (!m || !p.creatures.includes(m)) return tc.refuse("There is nothing to sneak up on.");
    const spot = approachTile(heroField(p), m.at, 1, sightKit(p).los);
    const path = spot ? pathTo(heroField(p), spot) : null;
    if (!path) return tc.refuse(p.round ? "You cannot get next to it this turn." : "You cannot get next to it from here.");
    p.sneaking = true;
    p.log.push({ text: "You creep toward it. Each step it could notice is a Stealth check.", tone: "plain" });
    tc.clearOptions();
    tc.walkQueue.length = 0;
    tc.walkQueue.push(...path);
    tc.onArrive = async () => {
      await tc.afterHeroAction();
    };
  }

  /** Pickpocket: Sleight of Hand against its passive Perception. A hit lifts one small thing off it (and it is gone from the body later); a miss wakes it and the fight starts. */
  async function pickpocketFlow(act: ContextAction, m: Creature | undefined): Promise<void> {
    const p = tc.st();
    if (!m || !p.creatures.includes(m)) return tc.refuse("There is nothing to pick.");
    const pick = pocketPick(m.carried, tableRng);
    if (!pick.item) return tc.refuse("It has nothing in its pockets you could lift.");
    const pp = creaturePassive(m);
    const out = sleightOfHand({ sheet: p.hero, targetPassivePerception: pp, rng: tableRng });
    const mod = skillModifierFor(p.hero, "Sleight of Hand");
    tc.clearOptions();
    tc.busy = true;
    await tc.rollStep("Tap to roll Sleight of Hand", out.dice, `Sleight of Hand ${out.total - mod} ${signedNum(mod)} = ${out.total} vs ${pp}`, out.success ? "UNNOTICED" : "NOTICED", out.success ? "good" : "bad", { modifier: mod, total: out.total, target: pp });
    if (!tc.alive || tc.st() !== p) return;
    tc.spendCost(p, act.cost);
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    if (out.success) {
      const why = takeIntoPack(p, pick.item.name, pick.item.note);
      if (why) p.log.push({ text: `You get hold of ${pick.item.name.toLowerCase()} but cannot carry it: ${why}`, tone: "plain" });
      else {
        m.carried = pick.rest;
        tc.story({ text: `You lift ${pick.item.name.toLowerCase()} from ${creatureLabel(p, m)}.`, tone: "good" });
      }
      await tc.afterManeuver();
      return;
    }
    const talk = barksFor(m.token);
    if (talk) tc.story({ speaker: creatureName(p, m), text: bark(talk.thief), tone: "bad" });
    tc.busy = false;
    tc.flushLog();
    tc.refreshAll();
    // The one it was lifted from notices (and starts the fight, or joins it); anyone else notices as they would.
    await tc.beginFight(false, m.hostile ? [m] : []);
  }

  /** Pick the lock (thieves' tools, a rogue's training) or force the door (Athletics), against the lock's DC. A success unlocks it; forcing it also opens it. */
  async function lockFlow(act: ContextAction): Promise<void> {
    const p = tc.st();
    if (!p.doorLocked) return tc.refuse("The door is not locked.");
    const dc = p.doorLockDc;
    const force = act.id === "force-door";
    const out = force ? forceDoor({ sheet: p.hero, dc, rng: tableRng }) : pickLock({ sheet: p.hero, dc, rng: tableRng });
    if ("allowed" in out && !out.allowed) return tc.refuse(out.reason ?? "You cannot do that.");
    const die = out.dice[0]!.result;
    tc.clearOptions();
    tc.busy = true;
    await tc.rollStep(force ? "Tap to roll Athletics" : "Tap to roll the lock", out.dice, `${force ? "Athletics" : "Thieves' tools"} ${die} ${signedNum(out.total - die)} = ${out.total} vs DC ${dc}`, out.success ? (force ? "IT GIVES WAY" : "IT CLICKS OPEN") : "IT HOLDS", out.success ? "good" : "bad", { modifier: out.total - die, total: out.total, target: dc });
    if (!tc.alive || tc.st() !== p) return;
    tc.spendCost(p, act.cost);
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    if (out.success) {
      p.doorLocked = false;
      if (force) p.doorOpen = true;
      noteSight(p);
      tc.stage.invalidate();
      tc.story({ text: force ? "The door gives way." : "The lock clicks open.", tone: "good" }, false);
    }
    await tc.afterManeuver();
  }

  /** Listen at the door: Perception against DC 10. A success says whether something is moving beyond it, and whether it is awake, never where. */
  async function listenFlow(act: ContextAction): Promise<void> {
    const p = tc.st();
    const out = skillCheck({ sheet: p.hero, skill: "Perception", dc: LISTEN_DC, rng: tableRng });
    tc.clearOptions();
    tc.busy = true;
    await tc.rollStep("Tap to roll Perception", out.dice, `Perception ${out.roll} ${signedNum(out.modifier)} = ${out.total} vs DC ${LISTEN_DC}`, out.success ? "YOU HEAR" : "NOTHING CLEAR", out.success ? "good" : "bad", { modifier: out.modifier, total: out.total, target: LISTEN_DC });
    if (!tc.alive || tc.st() !== p) return;
    tc.spendCost(p, act.cost);
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    // Beyond the door is the other room from the one the hero stands in. It says whether something is moving there and whether it is awake, never where or how many.
    const beyond = hostilesOf(p).filter((c) => c.at.x < DIVIDER_X !== p.heroAt.x < DIVIDER_X);
    let heard: string;
    if (!out.success) heard = "You cannot make anything out through the door.";
    else if (beyond.length > 0) heard = beyond.some((c) => c.awake) ? "Something is moving about beyond the door, wide awake." : "Something is breathing slowly beyond the door, as if asleep.";
    else heard = "Silence. Nothing is moving beyond the door.";
    tc.story({ text: heard, tone: "plain" });
    await tc.afterManeuver();
  }

  /**
   * Harvest: Survival (or Nature) against the body's own DC, beside the body, out of a fight. A success takes its part into the pack; a failure spoils the
   * carcass. Either way the body is harvested and cannot be tried again. The result is told in the DM's words, and the check line goes in the Log.
   */
  async function harvestFlow(act: ContextAction, tile: XY): Promise<void> {
    const p = tc.st();
    const at = p.bodies.findIndex((b) => same(b.at, tile));
    const body = at >= 0 ? p.bodies[at]! : undefined;
    if (!body) return tc.refuse("There is nothing here to harvest.");
    if (body.harvested) return tc.refuse(`The ${body.name.toLowerCase()} has already been harvested.`);
    const harvest = body.token ? harvestForToken(body.token) : null;
    if (!harvest) return tc.refuse(`There is nothing worth taking from the ${body.name.toLowerCase()}.`);
    if (p.round) return tc.refuse("That takes more than a moment. Finish the fight first.");
    if (tileDistance(p.heroAt, tile) > DEFAULT_MELEE_REACH_TILES) return tc.refuse("Too far away. Step next to it.");
    const out = resolveHarvest(p.hero, harvest, tableRng);
    const check = out.check;
    tc.clearOptions();
    tc.busy = true;
    await tc.rollStep(`Tap to roll ${harvest.skill}`, check.dice, `${harvest.skill} ${check.roll} ${signedNum(check.modifier)} = ${check.total} vs DC ${harvest.dc}`, check.success ? "YOU GET IT" : "SPOILED", check.success ? "good" : "bad", { modifier: check.modifier, total: check.total, target: harvest.dc });
    if (!tc.alive || tc.st() !== p) return;
    tc.spendCost(p, act.cost);
    p.log.push({ text: check.line, tone: check.success ? "good" : "bad" });
    const now = p.bodies.findIndex((b) => b.id === body.id);
    const label = body.name.toLowerCase();
    if (out.item) {
      const why = takeIntoPack(p, out.item.name, out.item.note);
      if (why) {
        // The part came away clean but there is nowhere to put it: the body is left as it was, to be tried again with room in the pack.
        tc.story({ text: `You cut away the ${out.item.name.toLowerCase()} but cannot carry it: ${why.charAt(0).toLowerCase()}${why.slice(1)} Make room and try again.`, tone: "plain" });
        return await tc.afterManeuver();
      }
      if (now >= 0) p.bodies[now] = { ...p.bodies[now]!, harvested: true };
      tc.story({ text: `You skin the ${label} and keep the ${out.item.name.toLowerCase()}.`, tone: "good" });
    } else {
      if (now >= 0) p.bodies[now] = { ...p.bodies[now]!, harvested: true };
      tc.story({ text: `Your knife slips and spoils the ${label}. There is nothing to take.`, tone: "bad" });
    }
    await tc.afterManeuver();
  }

  // What the other modules call or read.
  tc.pushCreatureBy = pushCreatureBy;
  tc.proneCreature = proneCreature;
  tc.runEngineAction = runEngineAction;
}
