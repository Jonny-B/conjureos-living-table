/**
 * The DM, answering: playing a DM reply (narration, rolls, world effects, spawns) onto the table.
 */
import { canonicalAbility, canonicalSkill, monsterSkill, skillCheck } from "../../session/maneuvers";
import { type DmExchange } from "../../session/adventureExport";
import { applyDamage, applyHealing } from "../../characters/health";
import { parseDiceNotation, rollDice, rollDie } from "../../rules/dice";
import { ABILITY_NAME, sentenceCase } from "../../menu/labels";
import { FEET_PER_TILE, spendActiveAction } from "../../menu/combatRound";
import { checkAdvantageFor, skillModifierFor } from "../../session/combat";
import { type CombatEvent } from "../../session/combatEvents";
import { type NarrationHandle } from "../ui/overlay";
import { normaliseSkill, type DmAsk, type DmCheck, type DmEffect, type DmOption, type DmReply } from "../dmCore";
import { type DieKind } from "../ui/dice";
import { playClips } from "../ui/cast";
import { DEFAULT_MELEE_REACH_TILES, tileDistance } from "../../world/reach";
import { DM_MEMORY_KEEP, DM_RECENT_KEEP, DOWN_NOTE, creatureById, creatureLabel, heroDown, sentence, type Creature, type PlayState } from "../state";
import { creatureAbility, creatureStats, landSwing, rollSwing, tableRng, type Swing } from "../fightRules";
import { advApply, adventureOf } from "../adventureRun";
import { heroActionReady, heroReachTiles, noteSight, sightKit } from "../sight";
import { applyWorldEffect, describeEffect, hurtCreatureBy } from "../dmScene";
import { dieOf, signedNum } from "./tableKit";
import type { TableCtx } from "../tableCtx";

export function installDmReply(tc: TableCtx): void {
  /**
   * Play one validated reply into the scene: the cost, the narration, the
   * effects, then the check (rolled in the tray) and the branch the dice pick.
   * Every refused effect is a plain log line and a note the DM reads next turn.
   * Returns the ids of the creatures the DM woke or that were struck (the fight starts, or they join it, after the turn).
   */
  async function playReply(p: PlayState, ctl: AbortController, ask: DmAsk, reply: DmReply, streaming: NarrationHandle, journal: DmExchange | null): Promise<string[]> {
    const stale = (): boolean => !tc.alive || tc.dmCtl !== ctl || tc.st() !== p;
    const refusedNotes: string[] = [];
    const dmWords: string[] = [];
    const wake = new Set<string>();
    let defeated = false;
    /** What the engine did with each effect, in plain words: the debug journal's applied and refused lists for this exchange. */
    const appliedLog: string[] = [];
    const refusedLog: string[] = [];
    const record = (): void => {
      if (!journal) return;
      journal.applied = [...appliedLog];
      journal.refused = [...refusedLog];
    };
    /** What the success branch of an attack check hands its effects: the swing the engine rolled, and whether its damage has landed yet. */
    interface BranchCtx {
      swing: Swing;
      /** The creature the check is against. */
      target: Creature;
      landed: boolean;
    }

    /** A line in the bench log that the dialogue box does not repeat (the narration box already shows it). */
    const logQuiet = (text: string): void => {
      tc.flushLog();
      p.log.push({ text, tone: "dm" });
      tc.said = p.log.length;
    };
    /** The DM's suggested next moves: a check's own branch carries them (the branch the dice picked); without a check, the reply does. */
    let nextOptions: DmOption[] | undefined = reply.check ? undefined : reply.options;

    // The cost, enforced by the engine: in a fight a check always costs the action, and an action that is spent is refused.
    const cost = p.round && reply.check ? "action" : reply.cost;
    if (p.round && cost === "action") {
      if (!heroActionReady(p)) {
        streaming.close();
        tc.refuse("You have already used your action this turn.");
        refusedLog.push("the whole reply: the hero had already used their action this turn");
        record();
        return [];
      }
      p.round = spendActiveAction(p.round) ?? p.round;
    }

    const narrate = (text: string, speaker: string | undefined, current: NarrationHandle | null): NarrationHandle => {
      // The streamed entry is the reply's own text: it takes the speaker's name and the final words instead of a second entry being queued.
      const h = current ?? tc.overlay.narrate({ speaker, text });
      if (current) {
        if (speaker) current.setSpeaker(speaker);
        current.update(text);
      }
      h.done();
      logQuiet(speaker ? `${speaker}: ${text}` : text);
      dmWords.push(speaker ? `${speaker}: ${text}` : text);
      return h;
    };

    /** Heal and harm are dice: the tray rolls them, then the game's own applyHealing and applyDamage land them. */
    const rollVitals = async (e: Extract<DmEffect, { type: "heal" | "harm" }>): Promise<void> => {
      const parsed = parseDiceNotation(e.dice);
      const rolled = rollDice(e.dice);
      const label = `${rolled.rolls.join(" + ")}${parsed.modifier ? ` ${signedNum(parsed.modifier)}` : ""} = ${rolled.total}`;
      const dice = rolled.rolls.map((v) => ({ kind: dieOf(parsed.sides), result: v }));
      if (e.type === "heal") {
        if (p.hero.dead) {
          refusedNotes.push("nothing can heal the dead");
          return;
        }
        await tc.rollStep("Tap to roll healing", dice, label, `+${rolled.total} HP`, "good");
        if (stale()) return;
        const before = p.hero.currentHp;
        const out = applyHealing(p.hero, rolled.total);
        p.hero = out.sheet;
        const gained = p.hero.currentHp - before;
        if (gained > 0) tc.overlay.float(tc.headOf("hero"), `+${gained}`, "heal");
        p.log.push({ text: out.note, tone: "good" });
        return;
      }
      await tc.rollStep("Tap to roll damage", dice, label, `${rolled.total} DAMAGE`, "bad");
      if (stale()) return;
      const before = p.hero.currentHp;
      const out = applyDamage(p.hero, rolled.total);
      p.hero = out.sheet;
      const lost = before - p.hero.currentHp;
      tc.overlay.float(tc.headOf("hero"), lost > 0 ? `-${lost}` : "DEATH SAVE", lost > 0 ? "damage" : "info");
      if (!tc.reducedMotion) playClips(p.heroActor, [heroDown(p) ? "death" : "hit"], performance.now());
      p.log.push({ text: sentence(`${e.why}. ${out.note}`), tone: "bad" });
      if (heroDown(p)) defeated = true;
    };

    /**
     * The three effects that move or hurt a creature on the board. The engine does the moving and the hurting (the push is
     * pushDestination, which stops at walls, props and tokens; the damage is the attack's own or dice thrown in the tray; prone is the
     * prone rules), so a DM that narrates a kick can no longer leave the goblin standing there unhurt. Returns why it was refused, or null.
     */
    const boardEffect = async (e: Extract<DmEffect, { type: "push" | "prone" | "hurt" }>, ctx?: BranchCtx): Promise<string | null> => {
      const m = creatureById(p, e.id);
      if (!m) return `there is no creature "${e.id}" here to ${e.type === "hurt" ? "hurt" : e.type === "push" ? "push" : "knock down"} (it may already be gone)`;
      const target = { ...m.at };
      if (e.type === "push") {
        const label = creatureLabel(p, m);
        const moved = await tc.pushCreatureBy(p, m, e.squares);
        if (stale()) return null;
        if (moved === 0) return `${label} cannot be pushed that way: a wall, a prop or another creature is right behind it`;
        p.log.push({ text: `${sentenceCase(label)} is pushed ${moved} square${moved === 1 ? "" : "s"} (${moved * FEET_PER_TILE} feet) away from you${moved < e.squares ? ", and no farther: something solid is in the way" : ""}.`, tone: "good" });
        if (tc.needsFight(p, m)) wake.add(m.id);
        return null;
      }
      if (e.type === "prone") {
        const why = tc.proneCreature(p, m);
        if (why) return why;
        if (tc.needsFight(p, m)) wake.add(m.id);
        return null;
      }
      // hurt: the attack's own damage when the check was an attack and no dice are named, else the dice, thrown in the tray.
      tc.fightWasOn = true;
      if (e.dice === undefined) {
        if (!ctx) return "a hurt with no dice takes its damage from an attack check, and there is none here";
        await tc.throwSwingDamage(ctx.swing);
        if (stale()) return null;
        const events = landSwing(p, m, ctx.swing, { spend: false });
        ctx.landed = true;
        tc.showAttack(events, m.token, target);
        tc.swingAftermath(p, m, events);
        return null;
      }
      const parsed = parseDiceNotation(e.dice);
      const rolled = rollDice(e.dice, tableRng);
      const dice = rolled.rolls.map((v) => ({ kind: dieOf(parsed.sides), result: v }));
      await tc.rollStep("Tap to roll damage", dice, `${rolled.rolls.join(" + ")}${parsed.modifier ? ` ${signedNum(parsed.modifier)}` : ""} = ${rolled.total}`, `${rolled.total} DAMAGE`, "good", { total: rolled.total });
      if (stale()) return null;
      let events: CombatEvent[];
      if (ctx && !ctx.landed) {
        // The attack's own line, with the damage the DM's dice decided.
        events = landSwing(p, ctx.target, ctx.swing, { spend: false, damage: rolled.total });
        ctx.landed = true;
      } else {
        events = hurtCreatureBy(p, m, rolled.total, e.damageType);
      }
      tc.showAttack(events, m.token, target);
      tc.swingAftermath(p, m, events);
      if (tc.needsFight(p, m)) wake.add(m.id);
      return null;
    };

    const runEffects = async (effects: readonly DmEffect[], ctx?: BranchCtx): Promise<void> => {
      for (const e of effects) {
        if (stale()) return;
        const words = describeEffect(e);
        if (e.type === "heal" || e.type === "harm") {
          const before = refusedNotes.length;
          await rollVitals(e);
          if (refusedNotes.length > before) refusedLog.push(`${words}: ${refusedNotes[refusedNotes.length - 1]}`);
          else appliedLog.push(words);
          continue;
        }
        if (e.type === "push" || e.type === "prone" || e.type === "hurt") {
          const why = await boardEffect(e, ctx);
          if (stale()) return;
          if (why) {
            refusedNotes.push(why);
            refusedLog.push(`${words}: ${why}`);
            p.log.push({ text: sentence(`Not applied: ${why}`), tone: "plain" });
          } else {
            appliedLog.push(words);
          }
          tc.flushLog();
          continue;
        }
        const r = applyWorldEffect(p, e);
        if (!r.ok) {
          refusedNotes.push(r.why);
          refusedLog.push(`${words}: ${r.why}`);
          if (!r.logged) p.log.push({ text: sentence(`Not applied: ${r.why}`), tone: "plain" });
          continue;
        }
        appliedLog.push(words);
        if (r.line) p.log.push(r.line);
        if (r.wake) wake.add(r.wake.id);
        // Doors, tiles and props change what the hero can see.
        noteSight(p);
        tc.stage.invalidate();
        // An item gained flashes its notice now, not when the whole answer is over.
        tc.flushLog();
        // A story step, or an adventure item handed over: whatever the story did with it (a beat, an objective, a new scene, an ending) is shown now.
        if (p.adventureId) tc.flushAdventure();
      }
    };

    /** A check the engine cannot roll (the creature is gone, out of reach, behind something solid): logged and sent back to the DM, and it counts as failed. */
    const unrolled = (what: string, why: string): { success: false } => {
      refusedNotes.push(why);
      refusedLog.push(`${what}: ${why}`);
      p.log.push({ text: sentence(`Not rolled: ${why}`), tone: "plain" });
      return { success: false };
    };

    /**
     * An attack check: the engine rolls the hero's attack (a kick when the DM says unarmed, else the weapon in hand) against the
     * creature's AC, both d20s in the tray with advantage or disadvantage from hiding, a prone target or the DM. A miss lands here;
     * a hit's damage lands when the success branch's hurt effect runs (the validator always puts one there).
     */
    const rollAttackCheck = async (c: DmCheck): Promise<{ success: boolean; swing?: Swing; target?: Creature }> => {
      const m = c.attack?.against ? creatureById(p, c.attack.against) : undefined;
      const unarmed = c.attack?.weapon === "unarmed";
      if (!m) return unrolled("attack check", "there is no such creature here to attack");
      if (!m.hostile) return unrolled("attack check", `${creatureLabel(p, m)} is not hostile, and the game has no rules yet for striking someone who is not`);
      const reach = unarmed ? DEFAULT_MELEE_REACH_TILES : heroReachTiles(p);
      const dist = tileDistance(p.heroAt, m.at);
      if (dist > reach) return unrolled("attack check", `${creatureLabel(p, m)} is ${dist * FEET_PER_TILE} feet away and your reach is ${reach * FEET_PER_TILE} feet`);
      if (!sightKit(p).los(p.heroAt, m.at)) return unrolled("attack check", `something solid is between you and ${creatureLabel(p, m)}`);
      const target = { ...m.at };
      const sw = rollSwing(p, m, unarmed ? "kick" : "weapon", c.advantage);
      tc.fightWasOn = true;
      await tc.throwSwingAttack(sw, target);
      if (stale()) return { success: sw.dice.hit };
      if (!sw.dice.hit) {
        const events = landSwing(p, m, sw, { spend: false });
        tc.showAttack(events, m.token, target);
        tc.swingAftermath(p, m, events);
      }
      if (tc.needsFight(p, m)) wake.add(m.id);
      return { success: sw.dice.hit, swing: sw, target: m };
    };

    /**
     * A contest check: the hero's skill against the creature's (a skill name, an ability key, or by default the better of its
     * Athletics and Acrobatics), both rolled by the engine, the hero's d20 in the hero's tray and the creature's in its own. A tie
     * goes to the creature.
     */
    const rollContestCheck = async (c: DmCheck): Promise<boolean> => {
      const m = c.contest?.against ? creatureById(p, c.contest.against) : undefined;
      if (!m || !c.contest) return unrolled("contest check", "there is no such creature here to contest").success;
      const mySkill = canonicalSkill(c.contest.skill);
      if (!mySkill) return unrolled("contest check", `"${c.contest.skill}" is not a skill the game knows`).success;
      const creature = creatureStats(m);
      const asked = c.contest.versus;
      const vSkill = asked ? canonicalSkill(asked) : undefined;
      const vAbility = asked && !vSkill ? canonicalAbility(asked) : undefined;
      if (asked && !vSkill && !vAbility) return unrolled("contest check", `"${asked}" is neither a skill nor an ability`).success;
      let versus: string;
      let theirMod: number;
      if (vSkill) {
        versus = vSkill;
        theirMod = monsterSkill(creature, vSkill);
      } else if (vAbility) {
        versus = ABILITY_NAME[vAbility];
        theirMod = creatureAbility(m, vAbility);
      } else {
        const ath = monsterSkill(creature, "Athletics");
        const acr = monsterSkill(creature, "Acrobatics");
        versus = acr > ath ? "Acrobatics" : "Athletics";
        theirMod = Math.max(ath, acr);
      }
      const mine = skillCheck({ sheet: p.hero, skill: mySkill, dc: 0, ...(c.advantage ? { advantage: c.advantage } : {}), rng: tableRng });
      const theirRoll = rollDie(20, tableRng);
      const theirTotal = theirRoll + theirMod;
      const success = mine.total > theirTotal;
      const label = creatureLabel(p, m);
      await tc.rollStep(`Tap to roll ${mySkill}`, mine.dice, `${mySkill} ${mine.roll} ${signedNum(mine.modifier)} = ${mine.total}`, "CONTEST", "plain", { modifier: mine.modifier, total: mine.total });
      if (stale()) return success;
      await tc.foeThrow(p, m, [{ kind: "d20", result: theirRoll }], `${theirRoll} ${signedNum(theirMod)} = ${theirTotal} vs ${mine.total}`, success ? "YOU WIN" : theirTotal === mine.total ? "A TIE HOLDS" : "IT WINS", success ? "good" : "bad", { modifier: theirMod, total: theirTotal, target: mine.total });
      if (stale()) return success;
      const adv = mine.dice.length > 1 ? ` (${c.advantage}: ${mine.dice.map((d) => d.result).join(" and ")}, kept ${mine.roll})` : "";
      p.log.push({ text: `Contest: your ${mySkill} ${mine.roll} ${signedNum(mine.modifier)} = ${mine.total}${adv} against ${label}'s ${versus} ${theirRoll} ${signedNum(theirMod)} = ${theirTotal}. ${success ? "You win." : theirTotal === mine.total ? "A tie goes to it: you lose." : "You lose."}`, tone: success ? "good" : "bad" });
      return success;
    };
    /** The check, thrown in the tray: d20 (two for advantage or disadvantage) plus the sheet's real modifier against the DM's DC. */
    const rollCheck = async (c: NonNullable<DmReply["check"]>): Promise<boolean> => {
      // Only a plain check carries a DC: an attack or a contest check is rolled by rollAttackCheck or rollContestCheck, so this fallback is never read.
      const dc = c.dc ?? 10;
      const skill = c.skill ? normaliseSkill(c.skill) : null;
      const name = skill ?? (c.ability ? ABILITY_NAME[c.ability] : "Check");
      const mod = skill ? skillModifierFor(p.hero, skill) : c.ability ? p.hero.modifiers[c.ability] : 0;
      let adv = c.advantage === "advantage";
      const dis = c.advantage === "disadvantage";
      if (skill && checkAdvantageFor(p.hero, skill)) adv = true;
      const two = adv !== dis;
      const a = rollDie(20);
      const b = two ? rollDie(20) : null;
      const used = b === null ? a : adv ? Math.max(a, b) : Math.min(a, b);
      const total = used + mod;
      const success = total >= dc;
      const shown = b === null ? `${used}` : `${used} (${adv ? "best" : "worst"} of ${a}, ${b})`;
      const dice: { kind: DieKind; result: number }[] = [{ kind: "d20", result: a }];
      if (b !== null) dice.push({ kind: "d20", result: b });
      // The tray's text lines are narrow: the sum on the first, the verdict and the DC on the second (the log keeps the long form).
      await tc.rollStep(`Tap to roll ${name}`, dice, `${name} ${used} ${signedNum(mod)} = ${total}`, `${success ? "SUCCESS" : "FAILURE"} vs DC ${dc}`, success ? "good" : "bad", { modifier: mod, total, target: dc });
      if (stale()) return success;
      p.log.push({ text: `${name} check: ${shown} ${signedNum(mod)} = ${total} against DC ${dc}. ${success ? "Success." : "Failure."}`, tone: success ? "good" : "bad" });
      return success;
    };

    narrate(reply.narration, reply.speaker, streaming);
    await runEffects(reply.effects);
    if (!stale() && reply.check) {
      const check = reply.check;
      let success: boolean;
      let attack: BranchCtx | undefined;
      if (check.kind === "attack") {
        const r = await rollAttackCheck(check);
        success = r.success;
        if (r.swing && r.target) attack = { swing: r.swing, target: r.target, landed: false };
      } else if (check.kind === "contest") {
        success = await rollContestCheck(check);
      } else {
        success = await rollCheck(check);
      }
      if (!stale()) {
        const branch = success ? check.success : check.failure;
        narrate(branch.narration, reply.speaker, null);
        nextOptions = branch.options;
        await runEffects(branch.effects, success ? attack : undefined);
        // A hit whose damage the engine did not land (its hurt was refused) still shows as a hit, with no damage.
        if (attack && success && !attack.landed && p.creatures.includes(attack.target) && !stale()) {
          const events = landSwing(p, attack.target, attack.swing, { spend: false, damage: 0 });
          tc.showAttack(events, attack.target.token, { ...attack.target.at });
        }
      }
    }
    // The hero spoke with somebody of the adventure: the story hears of it (the engine records it, never the DM's say-so alone: the id was checked
    // against the people standing here when the DM was asked, and the story refuses a person it does not have).
    if (!stale() && reply.talkedTo !== undefined) {
      const r = advApply(p, { type: "talk", npc: reply.talkedTo });
      const who = adventureOf(p)?.npcs.find((n) => n.id === reply.talkedTo)?.name ?? reply.talkedTo;
      if (!r || r.refused) {
        const why = r?.refused ?? "there is no adventure running";
        refusedNotes.push(why);
        refusedLog.push(`talked to ${who}: ${why}`);
      } else {
        appliedLog.push(`talked to ${who}`);
        tc.flushAdventure();
      }
    }
    record();
    if (stale()) return [];
    for (const fact of reply.remember ?? []) {
      if (!p.dmMemory.includes(fact)) p.dmMemory.push(fact);
    }
    if (p.dmMemory.length > DM_MEMORY_KEEP) p.dmMemory.splice(0, p.dmMemory.length - DM_MEMORY_KEEP);
    p.dmRecent.push({ who: "player", text: ask.kind === "freehand" ? ask.text.slice(0, 300) : `I look closely at ${ask.what}.` }, { who: "dm", text: dmWords.join(" ") });
    for (const why of refusedNotes) p.dmRecent.push({ who: "dm", text: `[The engine refused one of your effects and did NOT apply it: ${why}.]` });
    if (p.dmRecent.length > DM_RECENT_KEEP) p.dmRecent.splice(0, p.dmRecent.length - DM_RECENT_KEEP);
    noteSight(p);
    tc.stage.invalidate();
    // The narration box stays up for its reading time (done() was called); a hero who went down ends the fight.
    if (defeated) {
      p.round = null;
      tc.refreshAll();
      await tc.overlay.banner("DEFEAT", "defeat");
      tc.story({ text: DOWN_NOTE, tone: "bad", sticky: true });
      return [];
    }
    // A hero who is about to be in a fight has no use for suggestions made for the calm before it.
    p.options = wake.size > 0 ? [] : (nextOptions ?? []).slice(0, 4).map((o) => ({ ...o }));
    return [...wake];
  }

  // What the other modules call or read.
  tc.playReply = playReply;
}
