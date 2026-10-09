/**
 * Steps and attacks: taking a step, the frame pump, the hero's swings, running a plan, and attacking the nearest foe.
 */
import { type CombatEvent } from "../../session/combatEvents";
import { verdictWords } from "../ui/overlay";
import { type DieKind } from "../ui/dice";
import { castDirToward, playClips, stepBusy } from "../ui/cast";
import { FEET_PER_TILE, isPlayersTurn } from "../../menu/combatRound";
import { approachTile, pathTo } from "../../world/pathing";
import { tileDistance } from "../../world/reach";
import { DOWN_NOTE, NOT_SEEN, creatureAt, creatureName, heroDown, hostilesOf, type Creature, type PlayState, type XY } from "../state";
import { heroAttackRules, heroInteractRules, heroStepTo, stealthy, type Swing } from "../fightRules";
import { exitOn } from "../adventureRun";
import { creatureInSight, heroActionReady, heroField, heroReachTiles, heroesTurn, noticers, sightKit } from "../sight";
import { bark, barksFor, dieOf, signedNum } from "./tableKit";
import type { TableCtx } from "../tableCtx";
import type { Plan } from "./board";

export function installAttack(tc: TableCtx): void {
  /** The way out the hero's last step landed on (adventure only): taken once the walk is over, never as a square passed through. */
  tc.steppedOnExit = null;

  /** One square of a walk (a click's path, or a key). False when it was refused, which ends the walk. */
  function takeStep(to: XY): boolean {
    const p = tc.st();
    const from = { ...p.heroAt };
    tc.steppedOnExit = null;
    const r = heroStepTo(p, to);
    if (r.refused) {
      tc.refuse(r.refused);
      return false;
    }
    if (exitOn(p, to)) tc.steppedOnExit = { ...to };
    tc.stepAnim(p.heroActor, from, to);
    // Walking away leaves the DM's suggestions behind.
    tc.clearOptions();
    tc.stage.invalidate();
    return true;
  }

  // A story screen opening drops any walk under way for good (a beat flushed mid-walk, a scene card): the player reads it, then chooses
  // again, so the hero does not wander on, and the Attack or Look closer that was queued does not fire when the story closes.
  tc.overlay.onStoryChange((open) => {
    if (!open) return;
    tc.walkQueue.length = 0;
    tc.onArrive = null;
  });

  /** Every frame, before drawing: the next square of a walk once the last has landed, then whatever waited for arrival. */
  function pump(now: number): void {
    tc.drawMarks();
    // The HUD follows every change of turn state (it redraws only when what it shows changed).
    tc.renderHud();
    // A loot window belongs to a body or pile within reach on a quiet board: a step away, a fight or a DM turn closes it.
    if (tc.lootWin && tc.lootTarget) {
      const p = tc.st();
      const at = tc.lootTarget.kind === "body" ? p.bodies.find((b) => b.id === (tc.lootTarget as { id: string }).id)?.at : tc.lootTarget.at;
      if (tc.busy || p.round !== null || heroDown(p) || !at || tileDistance(p.heroAt, at) > 1) tc.closeLoot();
    }
    // The story hears about items that came or went, and plays out what it did (cards, the dialogue box, the journal) once the table is free.
    if (!tc.busy && tc.st().adventureId) tc.flushAdventure();
    if (tc.busy) return;
    // The world is locked while a screen is over the board (a story, the game menu, a start or hero screen): a walk already under way
    // waits, and its arrival (the dice tray, a DM turn) does not fire beneath it. This sits after the flush above, which can open a story.
    if (tc.overlayOpen()) return;
    const h = tc.st().heroActor;
    if (stepBusy(h, now)) return;
    if (tc.walkQueue.length > 0) {
      const next = tc.walkQueue.shift()!;
      if (!takeStep(next)) {
        tc.walkQueue.length = 0;
        tc.onArrive = null;
      }
      // A step that brings a hostile's notice ends the walk where it stands. A hero who is sneaking or hidden rolls Stealth for the step instead.
      const p = tc.st();
      if (!p.round && noticers(p).length > 0 && stealthy(p)) {
        void tc.stealthStep();
      } else if (!p.round && noticers(p).length > 0) {
        tc.walkQueue.length = 0;
        tc.onArrive = null;
        void tc.afterHeroAction();
      } else if (tc.walkQueue.length === 0) {
        tc.refreshAll();
      }
      return;
    }
    if (tc.onArrive) {
      const run = tc.onArrive;
      tc.onArrive = null;
      void run();
    }
  }

  /** The attack roll of a swing in the tray (every d20 of it: two with advantage or disadvantage), then the hero turns and swings. */
  async function throwSwingAttack(sw: Swing, target: XY): Promise<void> {
    const p = tc.st();
    const d = sw.dice;
    // A kick has no damage dice, so its number rides on this line; a critical's full verdict is too long beside it for the tray.
    const flat = sw.kick && d.hit && d.damage ? `, ${d.damage.total} DAMAGE` : "";
    await tc.rollStep(
      `Tap to roll your ${sw.kick ? "kick" : "attack"}${d.mode ? ` with ${d.mode}` : ""}`,
      d.d20s.map((result) => ({ kind: "d20" as DieKind, result })),
      `${d.roll} ${signedNum(d.modifier)} = ${d.total} vs ${d.target}`,
      flat && d.critical ? `CRITICAL${flat}` : `${verdictWords(d)}${flat}`,
      d.hit ? "good" : "bad",
      { modifier: d.modifier, total: d.total, target: d.target },
    );
    p.heroActor.dir = castDirToward(target.x - p.heroAt.x, target.y - p.heroAt.y);
    if (!tc.reducedMotion) playClips(p.heroActor, ["attack"], performance.now());
    await tc.wait(300);
  }

  /** The damage dice of a hit (a kick has none: its damage is a flat number the log line states). */
  async function throwSwingDamage(sw: Swing): Promise<void> {
    const dmg = sw.dice.damage;
    if (!dmg || dmg.rolls.length === 0) return;
    await tc.rollStep(
      sw.dice.critical ? "Critical! Tap to roll double damage" : "Tap to roll damage",
      dmg.rolls.map((v) => ({ kind: dieOf(dmg.sides), result: v })),
      `${dmg.rolls.join(" + ")} ${signedNum(dmg.modifier)} = ${dmg.total}`,
      sw.dice.critical ? "CRITICAL DAMAGE" : "DAMAGE",
      "good",
    );
  }

  /** What a swing leaves on the board: the creature flinches (a slain one falls where its body lies), it barks, the hero cheers over a kill. */
  function swingAftermath(p: PlayState, m: Creature, events: readonly CombatEvent[]): void {
    const hit = events.some((e) => e.kind === "damage");
    const alive = p.creatures.includes(m);
    const now = performance.now();
    if (!tc.reducedMotion && alive && hit) playClips(m.actor, m.prone ? ["hit", "death"] : ["hit"], now);
    const talk = barksFor(m.token);
    if (alive && talk && hit && Math.random() < 0.6) tc.story({ speaker: creatureName(p, m), text: bark(talk.hurt), tone: "good" });
    if (alive && talk && !hit && Math.random() < 0.6) tc.story({ speaker: creatureName(p, m), text: bark(talk.dodge), tone: "bad" });
    if (!alive && !tc.reducedMotion) playClips(p.heroActor, ["cheer"], now + 400);
  }

  async function heroAttackFlow(target: Creature): Promise<void> {
    const p = tc.st();
    if (!p.creatures.includes(target)) return tc.refuse("Nothing left to fight.");
    if (!creatureInSight(p, target)) return tc.refuse("You do not see anything to attack.");
    if (!tc.inOrder(p, target)) {
      // Attacking a creature that has not noticed you still starts the fight (or brings it into the one that is on); you swing on your turn (from hiding, if you were hidden).
      await tc.beginFight(true, [target, ...noticers(p)]);
      if (!heroesTurn(tc.st())) return;
      if (!p.creatures.includes(target)) return;
    }
    const at = { ...target.at };
    const r = heroAttackRules(p, target);
    if (r.refused !== null) return tc.refuse(r.refused);
    tc.clearOptions();
    tc.fightWasOn = true;
    tc.busy = true;
    // The attack roll: the engine has rolled it; the player throws the die and sees it land (both d20, with advantage or disadvantage).
    await throwSwingAttack(r.swing, at);
    await throwSwingDamage(r.swing);
    const events = r.apply();
    tc.showAttack(events, target.token, at);
    swingAftermath(p, target, events);
    tc.busy = false;
    await tc.afterHeroAction();
  }
  /** The walk to a creature and the blow that follows (the actions menu's Attack, the F key): never made by a click, which only walks. */
  function attackPlanFor(tile: XY): Plan {
    const p = tc.st();
    if (heroDown(p)) return { kind: "none", tile, reason: DOWN_NOTE };
    if (p.round && !isPlayersTurn(p.round)) return { kind: "none", tile, reason: "Wait for your turn." };
    const there = creatureAt(p, tile);
    if (!there || !creatureInSight(p, there)) return { kind: "none", tile, reason: p.round ? NOT_SEEN : "You do not see anything to attack." };
    if (!heroActionReady(p)) return { kind: "none", tile, reason: "Your action is used. Press End turn (T)." };
    const field = heroField(p);
    const spot = approachTile(field, there.at, heroReachTiles(p), sightKit(p).los);
    const path = spot ? pathTo(field, spot) : null;
    if (!path) return { kind: "none", tile, reason: p.round ? "You cannot reach it this turn." : "You cannot reach it from here." };
    return { kind: "attack", path, costFt: path.length * FEET_PER_TILE, tile };
  }

  /** Walk a plan's path, then do what it was for. A plain walk to the square already stood on is only a selection. */
  function runPlan(plan: Plan): void {
    if (plan.kind === "none") return tc.refuse(plan.reason);
    if (plan.kind === "walk" && plan.path.length === 0) return;
    tc.walkQueue.length = 0;
    tc.walkQueue.push(...plan.path);
    const struck = plan.kind === "attack" ? creatureAt(tc.st(), plan.tile) : undefined;
    tc.onArrive =
      plan.kind === "attack"
        ? async () => {
            // The creature it was for (it may have moved or fallen while the hero walked: then it is whoever stands there now, or nothing).
            const now = struck && tc.st().creatures.includes(struck) ? struck : creatureAt(tc.st(), plan.tile);
            if (!now) return tc.refuse("Nothing left to fight.");
            await heroAttackFlow(now);
          }
        : plan.kind === "loot"
          ? async () => {
              tc.openLootAt(plan.tile);
            }
        : plan.kind === "look"
          ? async () => {
              tc.examineAt(plan.tile);
            }
          : plan.kind === "talk"
            ? async () => {
                const who = creatureAt(tc.st(), plan.tile);
                if (who) tc.talkTo(who);
              }
          : plan.kind === "feature"
            ? async () => {
                await tc.featureFlow(plan.tile);
              }
          : plan.kind === "exit"
            ? async () => {
                const way = exitOn(tc.st(), plan.tile);
                if (way) await tc.useExit(way);
              }
          : plan.kind === "use"
            ? async () => {
                const r = heroInteractRules(tc.st());
                if (r.refused) return tc.refuse(r.refused);
                tc.clearOptions();
                if (!tc.reducedMotion) playClips(tc.st().heroActor, ["interact"], performance.now());
                tc.stage.invalidate();
                await tc.afterHeroAction();
              }
            : async () => {
                await tc.afterHeroAction();
              };
  }

  /**
   * The creature the Attack button (and F) strikes: the nearest hostile the hero sees, one in reach before one that needs a walk. With the
   * action spent, or nothing in sight, it says why. The actions menu's Attack strikes THE creature it was opened on instead (attackPlanFor).
   */
  function nearestFoe(p: PlayState): Creature | undefined {
    const seen = hostilesOf(p).filter((c) => creatureInSight(p, c));
    const dist = (c: Creature): number => tileDistance(p.heroAt, c.at);
    const byDistance = [...seen].sort((a, b) => dist(a) - dist(b));
    return byDistance.find((c) => dist(c) <= heroReachTiles(p)) ?? byDistance[0];
  }

  async function attackNearest(): Promise<void> {
    if (tc.busy) return;
    const p = tc.st();
    if (hostilesOf(p).length === 0) return tc.refuse("Nothing left to fight. Press Reset scene to bring it back.");
    const foe = nearestFoe(p);
    if (!foe) return tc.refuse("You do not see anything to attack.");
    runPlan(attackPlanFor(foe.at));
  }

  // What the other modules call or read.
  tc.pump = pump;
  tc.throwSwingAttack = throwSwingAttack;
  tc.throwSwingDamage = throwSwingDamage;
  tc.swingAftermath = swingAftermath;
  tc.runPlan = runPlan;
  tc.attackPlanFor = attackPlanFor;
  tc.attackNearest = attackNearest;
}
