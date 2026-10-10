/**
 * The main menu's flow: what Continue, New game, Load, Settings and Licence and credits do, and the rule that a new game never costs the
 * player the one they are in.
 *
 *   Continue   a game in front of the player (the menu was opened from it, or from the adventure list it was left for) goes back to it;
 *              otherwise the newest save is loaded, when the host allows one; otherwise the button is off.
 *   New game   the adventure list. A game in progress is saved first (a manual-kind save "before a new game", which the adventure's own automatic checkpoints cannot push out), so nothing is lost.
 *   Load       the game menu's Saves tab, Settings its Settings tab (opened over this menu; Escape comes back here).
 *   Credits    the licence text that has to travel with the game.
 *
 * The screen itself is ui/mainMenu.ts; this file decides and acts. `tc.openMainMenu` opens it, `tc.menuScr` is the open one (the
 * screens count it, and closeScreens in adventureStart.ts takes it down).
 */
import { saveLabel } from "../../session/savePoints";
import { SRD_ATTRIBUTION } from "../../menu/labels";
import { fromSnapshot, toSnapshot } from "../snapshot";
import { openMainMenu, type CreditLine } from "../ui/mainMenu";
import type { TableCtx } from "../tableCtx";
import type { TableSession } from "../mountTable";


/** Where Continue goes. */
export type ContinueTarget = { kind: "game" } | { kind: "save"; id: string } | { kind: "none" };

/** Whether a game is in front of the player: one is being played, or it was left for the adventure list. Pure. */
export function liveGame(s: Pick<TableSession, "play" | "atStart" | "paused">): boolean {
  return s.play !== null && (!s.atStart || s.paused === true);
}

/**
 * Where Continue goes. `readable` says whether a save id can be loaded (it exists and reads); a save that does not is as good as none. Pure.
 */
export function continueTarget(s: Pick<TableSession, "play" | "atStart" | "paused" | "continueId">, newestId: string | null, readable: (id: string) => boolean): ContinueTarget {
  if (liveGame(s)) return { kind: "game" };
  const id = s.continueId === undefined ? newestId : s.continueId;
  return id !== null && readable(id) ? { kind: "save", id } : { kind: "none" };
}

/** The licence text, as the credits page prints it. */
export function creditLines(): CreditLine[] {
  const a = SRD_ATTRIBUTION;
  return [{ text: a.creator }, { text: a.copyright }, { text: a.license, href: a.licenseUrl }, { text: a.modified }, { text: a.disclaimer }];
}

/** The label of the automatic save a new game starts with. */
export const NEW_GAME_CHECKPOINT = "before a new game";

/** What the game menu (lane: the in-game menu) offers to open on a tab; reached through a narrow view so this file needs only that. */
interface GameMenuApi {
  openGameMenu?: (tab: "saves" | "settings") => void;
}

export function installMainMenu(tc: TableCtx, ui: { open: typeof openMainMenu } = { open: openMainMenu }): void {
  tc.menuScr = null;

  function target(): ContinueTarget {
    const s = tc.session;
    const newest = s.saves.list()[0];
    return continueTarget(s, newest ? newest.id : null, (id) => {
      const save = s.saves.find(id);
      return save !== undefined && fromSnapshot(save.data) !== null;
    });
  }

  function hintFor(t: ContinueTarget): string {
    if (t.kind === "game") return "Back to your game";
    if (t.kind === "save") {
      const save = tc.session.saves.find(t.id);
      return save ? `Your newest save: ${saveLabel(save)}` : "";
    }
    return "";
  }

  function doContinue(t: ContinueTarget): void {
    if (t.kind === "none") return;
    tc.closeScreens();
    if (t.kind === "game") {
      tc.session.atStart = false;
      tc.session.paused = false;
      tc.viewsChanged();
      tc.refreshAll();
      return;
    }
    try {
      tc.loadSave(t.id);
    } catch {
      // A save that cannot be stood up leaves the player on the adventure list, with the save kept.
      tc.showStart();
    }
  }

  /** The newest "before a new game" save is this very game, unchanged (Continue, then New game again): a second copy would only push a real save out. */
  function alreadySaved(): boolean {
    const last = tc.session.saves.list().find((s) => s.kind === "manual" && s.label === NEW_GAME_CHECKPOINT);
    return last !== undefined && JSON.stringify(last.data) === JSON.stringify(toSnapshot(tc.st()));
  }

  function doNew(): void {
    // A game being played right now is saved first: the player who pressed New game by mistake gets it back from Load. It is a MANUAL
    // save, not a checkpoint: the adventure they pick next writes "start of the adventure" and an "arrived: X" at every door, and three
    // of those would push a checkpoint-kind save out of its three slots within minutes. Manual is a kind no automatic write touches.
    if (liveGame(tc.session) && !tc.session.atStart && !alreadySaved()) tc.addSavePoint(tc.st(), "manual", NEW_GAME_CHECKPOINT);
    tc.showStart();
  }

  function open(): void {
    tc.closeViews();
    tc.closeScreens();
    const t = target();
    const gm = tc as unknown as GameMenuApi;
    tc.menuScr = ui.open(tc.stageWrap, {
      style: tc.textStyle,
      canContinue: t.kind !== "none",
      continueHint: hintFor(t),
      credits: creditLines(),
      onContinue: () => doContinue(target()),
      onNew: doNew,
      onLoad: () => gm.openGameMenu?.("saves"),
      onSettings: () => gm.openGameMenu?.("settings"),
      onEscape: () => {
        const now = target();
        if (now.kind === "game") doContinue(now);
      },
    });
    tc.viewsChanged();
  }

  // What the other modules call or read.
  tc.openMainMenu = open;
}
