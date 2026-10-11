/**
 * Ending the turn, resting, loading a save, resetting the scene, and picking a DM suggestion.
 */
import { longRest } from "../../characters/health";
import { saveLabel } from "../../session/savePoints";
import { endTurn, isPlayersTurn } from "../../menu/combatRound";
import { DM_RECENT_KEEP, heroDown, newPlay } from "../state";
import { fromSnapshot } from "../snapshot";
import { benchAdventures } from "../adventureCatalog";
import { restRefusal } from "../fightRules";
import { advApply, adventureOf } from "../adventureRun";
import type { TableCtx } from "../tableCtx";

export function installTurns(tc: TableCtx): void {
  async function endTurnFlow(): Promise<void> {
    const p = tc.st();
    if (tc.busy || !p.round || !isPlayersTurn(p.round)) return tc.refuse(p.round ? "Wait for your turn." : "There is no fight on. Your turn ends when something notices you.");
    tc.walkQueue.length = 0;
    tc.onArrive = null;
    tc.clearOptions();
    p.round = endTurn(p.round);
    await tc.runHostiles();
  }

  /**
   * Make camp: the game's own longRest on the sheet (full hit points, hit dice and spell slots, once a day; the potions are
   * items and are not refilled), then a "rest" save point. Refused, in the sheet's or the table's words, in a fight, with
   * anything hostile awake or in sight, or once today's sleep is spent (a won fight turns the day over).
   *
   * In an adventure the night is also a day of the story: the rest is reported (adventures/progress.ts), so the world
   * clock moves and whatever it fires plays out before the save, which then holds the new day.
   */
  async function restFlow(): Promise<void> {
    if (tc.busy) return;
    const p = tc.st();
    const why = restRefusal(p);
    if (why) return tc.refuse(why);
    const out = longRest(p.hero);
    p.hero = out.sheet;
    tc.clearOptions();
    p.log.push({ text: out.note, tone: "good" });
    p.dmRecent.push({ who: "player", text: "I make camp and sleep until morning." });
    if (p.dmRecent.length > DM_RECENT_KEEP) p.dmRecent.splice(0, p.dmRecent.length - DM_RECENT_KEEP);
    tc.story({ text: "You make camp and sleep. Morning comes.", tone: "plain" }, false);
    if (adventureOf(p)) {
      advApply(p, { type: "rest" });
      tc.flushAdventure();
    }
    tc.addSavePoint(p, "rest", "");
    tc.hud.notice("Rested. Game saved.", "good");
    tc.flushLog();
    tc.refreshAll();
  }

  /** Put a save back: the scene, the sheet and the DM's memory as they were. "last" is the newest of any kind. */
  function loadSave(id: string): void {
    // No "close the menu first": the Saves tab lives in the game menu, which is open while a save is being loaded from it.
    // A load closes every view and screen itself (closeScreens, newScene).
    if (tc.busy) return tc.refuse("Wait until the table is free.");
    const save = tc.session.saves.find(id);
    if (!save) return tc.refuse("There is no save to load.");
    const restored = fromSnapshot(save.data);
    if (!restored) return tc.refuse("That save could not be read.");
    tc.closeScreens();
    tc.session.atStart = false;
    // A number the sight and tile caches have never seen under this scene's name (they key on it).
    restored.worldRev = Math.max(tc.st().worldRev, restored.worldRev) + 1;
    const words = saveLabel(save);
    tc.carry(tc.st(), restored, `loaded: ${words}`);
    tc.session.play = restored;
    tc.newScene(false);
    tc.hud.closeDrawer();
    restored.log.push({ text: `Loaded: ${words}`, tone: "plain" });
    tc.said = restored.log.length;
    tc.hud.notice(`Loaded: ${words}`, "plain");
    tc.refreshAll();
    // A save made in the middle of a fight puts the fight back: whoever's turn it was plays on from there.
    if (restored.round) void tc.runHostiles();
  }

  /** Start the scene again from the hero as it began (gear and pack kept). */
  function resetScene(): void {
    const p = tc.st();
    // An adventure starts again from its beginning, as the hero began.
    const running = adventureOf(p);
    const entry = running ? benchAdventures().find((e) => e.adventure === running) : undefined;
    if (running && entry) return tc.beginAdventure(entry, p.start);
    tc.closeScreens();
    tc.session.atStart = false;
    tc.session.play = newPlay(p.template, p.archetypeId, p.floorId, p.hero, p.start, p.room);
    tc.carry(p, tc.session.play, "the scene was reset");
    tc.newScene();
  }

  /** The DM's suggested move number `i`: one of the game's own buttons when it says so, otherwise the same as typing its words. */
  function pickOption(i: number): void {
    const p = tc.st();
    const o = p.options[i];
    if (!o || tc.busy || tc.overlayOpen() || heroDown(p)) return;
    // Each built-in refuses with its own reason when it cannot be done right now (and keeps the suggestions then).
    if (o.act === "attack") void tc.attackNearest();
    else if (o.act === "use") void tc.useNearby();
    else if (o.act === "potion") void tc.drinkPotion();
    else if (o.act === "rest") void restFlow();
    else if (o.act === "end") void endTurnFlow();
    else void tc.runDm({ kind: "freehand", text: o.say });
  }

  // What the other modules call or read.
  tc.endTurnFlow = endTurnFlow;
  tc.restFlow = restFlow;
  tc.loadSave = loadSave;
  tc.resetScene = resetScene;
  tc.pickOption = pickOption;
}
