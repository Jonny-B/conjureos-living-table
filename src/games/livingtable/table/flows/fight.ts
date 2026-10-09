/**
 * Fights: beginning one, the hostiles' turns, what follows a hero's action, and stealth.
 */
import { stealthCheck } from "../../session/maneuvers";
import { MONSTER_INITIATIVE_MODIFIER, activeCombatant, dropCombatant, endTurn, hasHostiles, isPlayersTurn } from "../../menu/combatRound";
import { skillModifierFor } from "../../session/combat";
import { type CombatEvent } from "../../session/combatEvents";
import { verdictWords } from "../ui/overlay";
import { STEP_MS, castDirToward, playClips } from "../ui/cast";
import { DOWN_NOTE, HERO_ID, awakeHostiles, creatureById, creatureLabel, creatureName, heroDown, hostilesOf, same, type Creature } from "../state";
import { creaturePassive, joinFight, monsterTurnRules, startFight, stealthy, tableRng } from "../fightRules";
import { exitOn } from "../adventureRun";
import { activeCreature, creatureInSight, heroesTurn, noteSight, noticers, seesTile } from "../sight";
import { autoEndTurnOn, noMoveLeft } from "../turnEnd";
import { bark, barksFor, signedNum } from "./tableKit";
import type { TableCtx } from "../tableCtx";

export function installFight(tc: TableCtx): void {
  /** A creature's own initiative die, thrown in its own tray: the total startCombat rolled, less the fixed bonus it adds. */
  async function foeInitiative(c: Creature): Promise<void> {
    const theirs = tc.st().round?.order.find((cb) => cb.id === c.id);
    if (!theirs) return;
    const d20 = theirs.initiative - MONSTER_INITIATIVE_MODIFIER;
    await tc.foeThrow(tc.st(), c, [{ kind: "d20", result: d20 }], `${d20} ${signedNum(MONSTER_INITIATIVE_MODIFIER)} = ${theirs.initiative}`, "INITIATIVE", "plain", { modifier: MONSTER_INITIATIVE_MODIFIER, total: theirs.initiative });
  }

  /**
   * The fight begins, or grows. `wake` are the creatures that cause it (they notice the hero, were struck, or the DM woke them; by default,
   * everyone who notices the hero now). With no fight on, everyone awake rolls initiative, each hostile's die in its own tray and look, and
   * the hostiles take their turns where they sort. With one on, each of them joins it, rolling its own initiative.
   */
  async function beginFight(fromHiding = false, wake?: readonly Creature[]): Promise<void> {
    const p = tc.st();
    const woken = (wake ?? noticers(p)).filter((c) => c.hostile && p.creatures.includes(c));
    if (p.round) {
      const joiners = woken.filter((c) => !tc.inOrder(p, c));
      if (joiners.length === 0) return;
      tc.busy = true;
      tc.walkQueue.length = 0;
      tc.onArrive = null;
      tc.clearOptions();
      for (const c of joiners) {
        if (tc.st() !== p || !p.round) break;
        c.actor.dir = castDirToward(p.heroAt.x - c.at.x, p.heroAt.y - c.at.y);
        if (joinFight(p, c) === null) continue;
        tc.wakeBark(p, [c]);
        tc.flushLog();
        tc.refreshAll();
        await foeInitiative(c);
      }
      tc.busy = false;
      tc.refreshAll();
      return;
    }
    if (!p.creatures.some((c) => c.hostile && (c.awake || woken.includes(c)))) return;
    tc.busy = true;
    tc.walkQueue.length = 0;
    tc.onArrive = null;
    tc.clearOptions();
    startFight(p, fromHiding, woken);
    if (!p.round) {
      tc.busy = false;
      return;
    }
    for (const c of awakeHostiles(p)) c.actor.dir = castDirToward(p.heroAt.x - c.at.x, p.heroAt.y - c.at.y);
    tc.wakeBark(p, woken.length > 0 ? woken : awakeHostiles(p));
    tc.flushLog();
    tc.refreshAll();
    void tc.overlay.banner("ROLL INITIATIVE", "initiative");
    // The hero's own initiative die: the total startCombat rolled, less the Dexterity it added.
    // startFight just set the round (read it fresh: TypeScript still sees it as null from the check above).
    const mine = tc.st().round?.order.find((c) => c.id === HERO_ID);
    if (mine) {
      const d20 = mine.initiative - p.hero.modifiers.dex;
      await tc.rollStep("Tap to roll initiative", [{ kind: "d20", result: d20 }], `${d20} ${signedNum(p.hero.modifiers.dex)} = ${mine.initiative}`, "INITIATIVE", "plain", { modifier: p.hero.modifiers.dex, total: mine.initiative });
    }
    // Each hostile's own initiative die, in its own tray, in the order the round sorted them.
    for (const cb of [...(tc.st().round?.order ?? [])]) {
      const c = cb.side === "hostile" ? creatureById(tc.st(), cb.id) : undefined;
      if (c) await foeInitiative(c);
    }
    tc.busy = false;
    await runHostiles();
  }

  /** Every turn that is not the hero's, played back (each hostile in initiative order), until it is the hero's turn again or the fight is over. */
  async function runHostiles(): Promise<void> {
    let p = tc.st();
    if (!p.round) return;
    if (isPlayersTurn(p.round)) {
      tc.refreshAll();
      await tc.overlay.banner("YOUR TURN", "turn");
      return;
    }
    tc.busy = true;
    tc.skipping = false;
    tc.refreshAll();
    while (p.round && !isPlayersTurn(p.round)) {
      const m = activeCreature(p);
      if (!m) {
        // A combatant with no creature on the board (it fled, or was removed): it simply drops out of the order.
        const gone = activeCombatant(p.round);
        if (!gone) break;
        const rest = dropCombatant(p.round, gone.id);
        p.round = hasHostiles(rest) ? rest : null;
        continue;
      }
      // A turn the hero cannot see is a neutral banner and no waiting: it hears that something moved, and sees the creature only from the first square in sight.
      let anySeen = creatureInSight(p, m);
      if (anySeen) await tc.overlay.banner(`${creatureName(p, m).toUpperCase()}'S TURN`, "enemy");
      else void tc.overlay.banner("SOMETHING MOVES", "enemy");
      const start = { ...m.at };
      // Its turn: it knows where the hero is, hidden or not.
      if (p.heroHidden || p.sneaking) {
        if (p.heroHidden) p.log.push({ text: "It is on its feet and knows where you are. You are no longer hidden.", tone: "plain" });
        p.heroHidden = false;
        p.sneaking = false;
      }
      const turn = monsterTurnRules(p, m);
      // Walk it square by square along the engine's own path.
      const move = turn.events.find((e): e is Extract<CombatEvent, { kind: "move" }> => e.kind === "move");
      let from = start;
      for (const sq of move?.path ?? []) {
        tc.stepAnim(m.actor, from, sq);
        const cameFromSight = seesTile(p, from);
        m.at = { ...sq };
        noteSight(p);
        const inSight = creatureInSight(p, m);
        anySeen = anySeen || inSight;
        tc.refreshAll();
        if (inSight || cameFromSight) await tc.wait(STEP_MS);
        from = sq;
      }
      if (turn.endAt) m.at = turn.endAt;
      noteSight(p);
      anySeen = anySeen || creatureInSight(p, m);
      // Then the swing, and the blow lands when it plays.
      const swing = turn.events.filter((e) => e.kind !== "move" && e.kind !== "turnStart");
      if (swing.length > 0) {
        const atk = swing.find((e): e is Extract<CombatEvent, { kind: "attack" }> => e.kind === "attack");
        const dmg = swing.find((e): e is Extract<CombatEvent, { kind: "damage" }> => e.kind === "damage");
        if (atk) {
          const r0 = atk.readout;
          // The better the enemy, the fancier its dice and the tray they land in (foeDice.ts): each creature rolls in its own, with its name on the rim.
          await tc.foeThrow(
            p,
            m,
            [{ kind: "d20", result: r0.roll }],
            `${creatureName(p, m)}: ${r0.roll} ${signedNum(r0.modifier)} = ${r0.total} vs ${r0.target}`,
            // A critical's full verdict is too long for the tray's line and would cut the damage off: say CRITICAL and the number.
            dmg ? `${dmg.critical ? "CRITICAL" : verdictWords({ hit: true, critical: false, fumble: false })}, ${dmg.amount} DAMAGE` : verdictWords({ hit: false, critical: false, fumble: !!r0.fumble }),
            r0.hit ? "bad" : "good",
            { modifier: r0.modifier, total: r0.total, target: r0.target },
          );
        }
        m.actor.dir = castDirToward(p.heroAt.x - m.at.x, p.heroAt.y - m.at.y);
        if (!tc.reducedMotion) playClips(m.actor, ["attack"], performance.now());
        await tc.wait(320);
        const hpBefore = p.hero.currentHp;
        p.hero = turn.sheet;
        tc.showAttack(swing, "hero");
        const now = performance.now();
        if (!tc.reducedMotion && p.hero.currentHp < hpBefore) playClips(p.heroActor, [heroDown(p) ? "death" : "hit"], now);
        if (swing.some((e) => e.kind === "miss")) {
          const talk = barksFor(m.token);
          if (talk) tc.story({ speaker: creatureName(p, m), text: bark(talk.miss), tone: "plain" });
        }
      } else {
        p.hero = turn.sheet;
      }
      // Out of sight the whole turn, the log says only that something moved.
      p.log.push(...(anySeen || swing.length > 0 ? turn.lines : [{ text: "Something moves nearby.", tone: "plain" as const }]));
      tc.flushLog();
      tc.refreshAll();
      if (anySeen) await tc.wait(650);
      if (heroDown(p)) {
        p.round = null;
        tc.refreshAll();
        await tc.overlay.banner("DEFEAT", "defeat");
        tc.story({ text: DOWN_NOTE, tone: "bad", sticky: true });
        break;
      }
      p.round = endTurn(p.round!);
      p = tc.st();
    }
    tc.busy = false;
    tc.skipping = false;
    tc.refreshAll();
    if (p.round && isPlayersTurn(p.round)) await tc.overlay.banner("YOUR TURN", "turn");
  }

  /** After anything the hero does: a kill may end the fight, a step may wake a sleeper (it starts the fight, or joins the one that is on). */
  async function afterHeroAction(): Promise<void> {
    const p = tc.st();
    tc.flushLog();
    tc.refreshAll();
    // The fight is won when no hostile is left on the board at all (a sleeper left alone keeps it open).
    if (hostilesOf(p).length === 0 && p.fallenAt && !p.round && tc.fightWasOn) {
      tc.fightWasOn = false;
      await tc.overlay.banner("VICTORY", "victory");
    }
    // A hero who is sneaking or hidden is not noticed by sight: each step that would be is a Stealth check (stealthStep), not a wake.
    if (!p.round && noticers(p).length > 0 && !stealthy(p)) await beginFight();
    // A fight already on: a sleeper that notices the hero now joins it.
    else if (p.round && heroesTurn(p) && !heroDown(p) && noticers(p).length > 0) await beginFight();
    // The walk ended on a way out (and nothing woke): the hero goes through it.
    if (tc.steppedOnExit && !tc.st().round && same(tc.steppedOnExit, tc.st().heroAt)) {
      const way = exitOn(tc.st(), tc.st().heroAt);
      tc.steppedOnExit = null;
      if (way) await tc.useExit(way);
    }
    // Nothing left to do with this turn: say so in the dialogue box and end it after a beat, unless the player turned that off.
    // The action still ready never ends a turn (free text is always possible), and the End turn button is always there.
    const now = tc.st();
    if (now === p && !tc.busy && autoEndTurnOn(tc.host.settings.get()) && noMoveLeft(now)) {
      tc.story({ text: "You have nothing left to do this turn, so it ends here.", tone: "plain" });
      await tc.wait(700);
      if (tc.st() === p && !tc.busy && noMoveLeft(p)) await tc.endTurnFlow();
    }
  }
  tc.fightWasOn = false;

  /**
   * One step the hostiles could have noticed, taken sneaking or hidden: a Stealth check against each one's passive Perception, thrown in
   * the tray. Success keeps the hero unseen (hidden) and the walk goes on; failure is whoever spotted the hero noticing, and the fight starts.
   * Every such step is its own check. The table is busy until the check is thrown.
   */
  async function stealthStep(): Promise<void> {
    tc.busy = true;
    const p = tc.st();
    const watchers = noticers(p);
    const dcs = watchers.map((c) => creaturePassive(c));
    const out = stealthCheck({ sheet: p.hero, observers: watchers.map((c) => ({ id: c.id, passivePerception: creaturePassive(c), name: creatureLabel(p, c) })), rng: tableRng });
    const mod = skillModifierFor(p.hero, "Stealth");
    const unseen = out.spottedBy.length === 0;
    await tc.rollStep("Tap to roll Stealth", out.dice, `Stealth ${out.total - mod} ${signedNum(mod)} = ${out.total} vs ${dcs.join("/")}`, unseen ? "UNSEEN" : "SPOTTED", unseen ? "good" : "bad", { modifier: mod, total: out.total, target: Math.max(...dcs) });
    if (!tc.alive || tc.st() !== p) return;
    p.log.push({ text: out.line, tone: unseen ? "good" : "bad" });
    if (unseen) {
      // Unseen: hidden from here on, and the walk (still queued) carries on.
      p.heroHidden = true;
      tc.busy = false;
      tc.flushLog();
      tc.refreshAll();
      return;
    }
    p.heroHidden = false;
    p.sneaking = false;
    tc.walkQueue.length = 0;
    tc.onArrive = null;
    tc.busy = false;
    tc.flushLog();
    tc.refreshAll();
    // Whoever spotted the hero starts the fight; the others join it when they notice, as anyone does with the hero in the open.
    const spotters = out.spottedBy.flatMap((id) => creatureById(p, id) ?? []);
    await beginFight(false, spotters);
    await afterHeroAction();
  }

  // What the other modules call or read.
  tc.beginFight = beginFight;
  tc.runHostiles = runHostiles;
  tc.afterHeroAction = afterHeroAction;
  tc.stealthStep = stealthStep;
}
