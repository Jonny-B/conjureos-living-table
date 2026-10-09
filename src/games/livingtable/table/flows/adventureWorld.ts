/**
 * Moving about an adventure: the ending card, exits between places, features (doors, chests, props), searching, and talking to people.
 */
import { skillCheck } from "../../session/maneuvers";
import { skillModifierFor } from "../../session/combat";
import { tileDistance } from "../../world/reach";
import { type AdventureStepResult } from "../../adventures/progress";
import { exitDestination } from "../../adventures/validate";
import { itemOf, locationOf, sceneOf, type Adventure, type AdventureFeature, type AdventureNpc } from "../../adventures/types";
import { DOWN_NOTE, creatureName, heroDown, sentence, type Creature, type PlayState, type XY } from "../state";
import { foldItem, withoutCount } from "../gearLoot";
import { tableRng } from "../fightRules";
import {
  advApply,
  adventureOf,
  enterLocation,
  exitIsOpen,
  exitLockedWords,
  featureAtSquare,
  featureIsFound,
  featureKey,
  featureSearchable,
  giveAdventureItem,
  npcOf,
  type ExitHere,
} from "../adventureRun";
import type { DmAsk } from "../dmCore";
import { signedNum } from "./tableKit";
import type { TableCtx } from "../tableCtx";

/**
 * The ask a talk makes: "I talk to Tobin Hale." For a person of the adventure it carries their id, so the DM answers in their voice and says it
 * set talkedTo. `at` and `what` tell the DM which square was chosen.
 */
export function talkAsk(name: string, npc?: { id: string; name: string }, at?: XY): DmAsk {
  const ask = { kind: "freehand" as const, text: `I talk to ${name}.`, ...(at ? { at: { x: at.x, y: at.y }, what: name } : {}), ...(npc ? { npc: { id: npc.id, name: npc.name } } : {}) };
  return ask;
}

export function installAdventureWorld(tc: TableCtx): void {
  /** The adventure's own words waiting to be told with the next flush (the secret of something just searched). */
  const pendingTell: string[] = [];

  /** The ending's text over the board: Continue keeps playing in place (the story is over, the world is still there), Back to the start screen leaves. */
  function showEnding(a: Adventure, sceneId: string, ending: NonNullable<AdventureStepResult["ended"]>): void {
    tc.endScr?.close();
    tc.endScr = tc.overlay.endingCard({
      title: sceneOf(a, sceneId)?.title ?? a.title,
      text: ending.text,
      outcome: ending.outcome,
      onContinue: () => {
        tc.endScr?.close();
        tc.endScr = null;
        tc.renderHud();
      },
      onMenu: () => {
        tc.closeScreens();
        tc.showStart();
      },
    });
    tc.renderHud();
  }

  /** Go through a way out: only on a quiet board and when the story lets it be taken (otherwise its own words say why). The place is built, the hero arrives, a checkpoint is saved and the place's card is shown. */
  async function useExit(here: ExitHere): Promise<void> {
    const p = tc.st();
    const a = adventureOf(p);
    if (!a || !p.progress) return;
    if (heroDown(p)) return tc.refuse(DOWN_NOTE);
    if (p.round) return tc.refuse("You cannot leave in the middle of a fight.");
    if (!exitIsOpen(p, here.exit)) return tc.refuse(exitLockedWords(here.exit));
    const dest = exitDestination(a, p.progress.locationId, here.exit.id);
    const target = dest ? locationOf(a, dest.locationId) : undefined;
    if (!dest || !target) return tc.refuse("That way leads nowhere the adventure has a place for.");
    tc.busy = true;
    tc.walkQueue.length = 0;
    tc.onArrive = null;
    tc.steppedOnExit = null;
    tc.clearOptions();
    tc.closeLoot();
    p.log.push({ text: `You go through: ${here.exit.label}.`, tone: "plain" });
    if (!enterLocation(p, dest.locationId, dest.at)) {
      tc.busy = false;
      return tc.refuse("The story has no such place.");
    }
    tc.overlay.clear();
    tc.hover = null;
    tc.marksKey = "";
    tc.stage.snapCamera();
    tc.stage.invalidate();
    tc.addSavePoint(p, "checkpoint", `arrived: ${target.name}`);
    tc.showLocationCard({ name: target.name, readAloud: target.readAloud });
    tc.busy = false;
    tc.skipping = false;
    tc.flushAdventure();
    tc.refreshAll();
    await tc.arrivalFight();
  }

  /** The adventure's own words for a feature of the place: its name and what anyone sees (a found secret is said once, when it is found). */
  function showFeature(f: AdventureFeature): void {
    const p = tc.st();
    const searched = featureSearchable(f) && featureIsFound(p, f);
    tc.story({ speaker: f.name, text: `${f.description}${searched ? " You have already searched it." : ""}`, tone: "plain" });
    tc.refreshAll();
  }

  /** What Use, a click or the menu's Search does to a feature beside the hero: look at it, or search it (the check is thrown in the tray). */
  async function featureFlow(at: XY): Promise<void> {
    const p = tc.st();
    const f = featureAtSquare(p, at);
    if (!f) return;
    if (tileDistance(p.heroAt, at) > 1) return tc.refuse("Too far away. Step next to it.");
    if (!featureSearchable(f) || featureIsFound(p, f)) return showFeature(f);
    await searchFeature(f);
  }

  /** Hand a feature's find to the hero: an adventure item as the adventure describes it (quest flag and all), anything else as a plain thing in the pack. */
  function handOver(p: PlayState, f: AdventureFeature, give: string): void {
    const a = adventureOf(p)!;
    const item = itemOf(a, give);
    if (item) return giveAdventureItem(p, item);
    if (p.hero.inventory.some((n) => foldItem(withoutCount(n)) === foldItem(give))) return;
    p.hero = { ...p.hero, inventory: [...p.hero.inventory, give] };
    const money = /coin|copper|silver|gold|pieces|purse/i.test(give);
    p.itemNotes[give] = `Found in ${f.name.toLowerCase()}.${money ? " There is nothing to spend it on yet, so it is only something you carry." : ""}`;
    p.log.push({ text: `You now carry ${give}.`, tone: "good", notice: `+ ${give}` });
  }

  /**
   * Search a feature. With a DC the engine rolls the better of Perception and Investigation in the tray (the hero's real modifier against the
   * adventure's number); without one the secret is simply found. A failure says so and can be tried again. A find is said once in the dialogue box,
   * the items it gives go in the pack, and the story hears of them (a quest item can finish an objective or fire a beat).
   */
  async function searchFeature(f: AdventureFeature): Promise<void> {
    const p = tc.st();
    if (heroDown(p)) return tc.refuse(DOWN_NOTE);
    if (p.round) return tc.refuse("Not in the middle of a fight. Finish it first.");
    tc.clearOptions();
    tc.busy = true;
    let found = true;
    if (f.searchDc !== undefined) {
      const dc = f.searchDc;
      const skill = skillModifierFor(p.hero, "Investigation") > skillModifierFor(p.hero, "Perception") ? "Investigation" : "Perception";
      const out = skillCheck({ sheet: p.hero, skill, dc, rng: tableRng });
      await tc.rollStep(`Tap to roll ${skill}`, out.dice, `${skill} ${out.roll} ${signedNum(out.modifier)} = ${out.total} vs DC ${dc}`, out.success ? "YOU FIND SOMETHING" : "NOTHING YET", out.success ? "good" : "bad", { modifier: out.modifier, total: out.total, target: dc });
      if (!tc.alive || tc.st() !== p) return;
      p.log.push({ text: `Searching ${f.name.toLowerCase()}: ${out.line}`, tone: out.success ? "good" : "bad" });
      found = out.success;
    }
    if (!found) {
      tc.story({ text: `You search ${f.name.toLowerCase()} and find nothing yet. You can search it again.`, tone: "plain" });
      tc.busy = false;
      tc.flushLog();
      tc.refreshAll();
      return;
    }
    p.featuresFound.push(featureKey(p, f));
    pendingTell.push(f.secret ?? `You find something in ${f.name.toLowerCase()}.`);
    for (const g of f.gives ?? []) handOver(p, f, g);
    tc.busy = false;
    tc.flushLog();
    tc.flushAdventure();
    tc.refreshAll();
    await tc.afterHeroAction();
  }

  /**
   * A person of the adventure: choosing Talk starts the talk. What the hero says first is "I talk to <name>.", sent to the DM as a freehand ask for
   * THAT person (their id rides in the ask), so the DM answers in their voice from their entry and says it set talkedTo; the engine then records the
   * talk event. With no DM to ask (off claude.ai) the person says only what the adventure says they know, and the talk is recorded the same way.
   */
  function talkTo(c: Creature): void {
    const p = tc.st();
    const a = adventureOf(p);
    const npc = a ? npcOf(a, c.adv?.npc) : undefined;
    const name = npc?.name ?? creatureName(p, c);
    if (npc && tc.sampleState === "none" && !tc.peekSample()) return talkWithoutDm(p, npc);
    void tc.runDm(talkAsk(name, npc ? { id: npc.id, name: npc.name } : undefined, c.at));
  }

  /**
   * No DM here: the person tells the party what the adventure lists under "knows", word for word and said to be that (not a voice the DM gave
   * them), and the talk is recorded, so the adventure can be finished without the DM. What they keep secret stays secret.
   */
  function talkWithoutDm(p: PlayState, npc: AdventureNpc): void {
    const told = npc.knows.length > 0 ? npc.knows.join(" ") : "They have nothing to tell you.";
    const words = `${npc.name}, ${npc.role}. There is no DM to give them a voice here, so this is only what the adventure says they will tell you: ${told}`;
    tc.overlay.narrate({ text: words, full: true }).done();
    p.log.push({ text: words, tone: "plain" });
    const r = advApply(p, { type: "talk", npc: npc.id });
    if (r?.refused) p.log.push({ text: sentence(`Not recorded: ${r.refused}`), tone: "plain" });
    tc.flushAdventure();
    tc.refreshAll();
  }

  // What the other modules call or read.
  tc.pendingTell = pendingTell;
  tc.showEnding = showEnding;
  tc.useExit = useExit;
  tc.showFeature = showFeature;
  tc.featureFlow = featureFlow;
  tc.talkTo = talkTo;
}
