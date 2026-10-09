/**
 * The basics of doing things: the walk queue, waiting, the log and the story line, refusing, and attack animations.
 */
import { type CombatEvent } from "../../session/combatEvents";
import { type DialogueLine } from "../ui/overlay";
import { actorAt, castDirToward, playClips, startStep, type Actor } from "../ui/cast";
import type { TileId } from "../../world/cell";
import { LOG_KEEP, creatureName, type Creature, type PlayState, type XY } from "../state";
import { sentenceCase } from "../../menu/labels";
import { bark, barksFor } from "./tableKit";
import type { TableCtx } from "../tableCtx";

export function installAct(tc: TableCtx): void {
  // ---- doing things --------------------------------------------------------

  /** Squares still to walk, and what to do on arrival. */
  const walkQueue: XY[] = [];
  tc.onArrive = null;
  /** True while the game is playing something back (a monster's turn, a banner): input waits. */
  tc.busy = false;
  tc.skipping = false;

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (tc.skipping || tc.reducedMotion) return resolve();
      const t0 = performance.now();
      const tick = () => (tc.skipping || performance.now() - t0 >= ms ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });

  /**
   * The log is the full history (the Log tab). The board's dialogue box gets only story: creature speech and the big moments,
   * through story(). Here, every line the log gained since the last call that carries a short notice (an item or a potion
   * gained) flashes it beside the Pack button once, and the history is trimmed to LOG_KEEP.
   */
  tc.said = 0;
  function flushLog(): void {
    const p = tc.st();
    if (tc.said > p.log.length) tc.said = p.log.length;
    for (const line of p.log.slice(tc.said)) if (line.notice) tc.hud.notice(line.notice, "good");
    tc.said = p.log.length;
    if (p.log.length > LOG_KEEP) {
      tc.session.log.archive(p.log.slice(0, p.log.length - LOG_KEEP));
      p.log.splice(0, p.log.length - LOG_KEEP);
      tc.said = p.log.length;
    }
  }

  /** A line for the board's dialogue box (a creature's words, a big moment); it queues behind whatever is being read. It goes in the Log as well; everything mechanical goes only there. */
  function story(line: DialogueLine, alsoLog = true): void {
    tc.overlay.say(line);
    if (alsoLog) tc.st().log.push({ text: line.speaker ? `${line.speaker}: ${line.text}` : line.text, tone: "plain" });
  }

  /** The DM's suggested moves go away when the hero moves, acts, or the next answer arrives. */
  function clearOptions(): void {
    const p = tc.st();
    if (p.options.length > 0) p.options = [];
  }

  /**
   * Why something cannot be done, said by the DM in the dialogue box (no strip across the board, no second kind of text): the same
   * sentence answers a repeated click on a locked door every time. It is not logged; the Log keeps what happened, not what was refused.
   */
  function refuse(reason: string): void {
    const words = (reason ?? "").trim();
    if (words) tc.overlay.say({ speaker: "DM", text: sentenceCase(words), repeat: true });
  }

  function stepAnim(actor: Actor, from: XY, to: XY): void {
    const now = performance.now();
    actor.dir = castDirToward(to.x - from.x, to.y - from.y);
    if (tc.reducedMotion) return;
    startStep(actor, actorAt(actor, from, now), now);
    playClips(actor, ["walk"], now);
  }

  /** Float an attack's outcome over the target's head (the dice themselves are in the tray). `target` is "hero" or the creature's token asset id. */
  function showAttack(events: readonly CombatEvent[], target: "hero" | TileId, targetTile?: XY): void {
    for (const ev of events) {
      if (ev.kind === "damage") {
        if (ev.hpLost > 0) tc.overlay.float(tc.headOf(target, targetTile), ev.critical ? `-${ev.hpLost} CRIT!` : `-${ev.hpLost}`, ev.critical ? "crit" : "damage");
        else tc.overlay.float(tc.headOf(target, targetTile), "DEATH SAVE", "info");
      } else if (ev.kind === "miss") tc.overlay.float(tc.headOf(target, targetTile), "MISS", "miss");
      else if (ev.kind === "down") tc.overlay.float(tc.headOf(target, targetTile), "DOWN", "down");
      else if (ev.kind === "heal") tc.overlay.float(tc.headOf(target), `+${ev.amount}`, "heal");
    }
  }

  /** Whether a creature is in the order of the fight that is on. */
  const inOrder = (p: PlayState, c: Creature): boolean => p.round?.order.some((cb) => cb.id === c.id) === true;

  /** A hostile that is not yet in a fight (asleep, or awake with no round): what a strike, a shove or the DM's word brings in. */
  const needsFight = (p: PlayState, c: Creature): boolean => c.hostile && p.creatures.includes(c) && !inOrder(p, c);

  /** What a creature says as it wakes (the goblin has barks; others stay quiet). */
  function wakeBark(p: PlayState, woke: readonly Creature[]): void {
    const talker = woke.find((c) => barksFor(c.token) !== null);
    if (!talker) return;
    story({ speaker: talker.seen ? creatureName(p, talker) : "Something", text: bark(barksFor(talker.token)!.wake), tone: "bad" });
  }

  // What the other modules call or read.
  tc.walkQueue = walkQueue;
  tc.wait = wait;
  tc.flushLog = flushLog;
  tc.story = story;
  tc.clearOptions = clearOptions;
  tc.refuse = refuse;
  tc.stepAnim = stepAnim;
  tc.showAttack = showAttack;
  tc.inOrder = inOrder;
  tc.needsFight = needsFight;
  tc.wakeBark = wakeBark;
}
