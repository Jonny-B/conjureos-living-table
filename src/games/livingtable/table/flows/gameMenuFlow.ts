/**
 * The in-game menu's flow: opening it on a tab, keeping it current, and closing it again.
 *
 * The menu itself is ui/gameMenu.ts (Character, Inventory, Journal, Log, Saves, Settings). This file hosts it on the stage like the sheet
 * was, gives it the game to show (and a fresh copy whenever the readout redraws), and sends its buttons back into the game: item cards
 * to the engine's own equip, unequip, drop and use; Saves and Settings buttons to the HUD's action ids. While it is up the game waits
 * (`overlayOpen`). It closes by itself when a story screen opens, which is the DM taking the floor.
 *
 * What it adds to the table context is below. `openGameMenu(tab)` is also the toggle the C, I, J and L keys use: asking for the tab that
 * is already showing closes the menu. Saves and Settings work with no game in play and above the main menu and the start screens; the other
 * four tabs need a game in play.
 */
import { saveLabel } from "../../session/savePoints";
import { journalFor, adventureOf } from "../adventureRun";
import { saveDetail } from "../snapshot";
import { hostileNear, itemCardFor } from "../gearLoot";
import { ARCHETYPE_LABEL } from "../state";
import type { TableCtx } from "../tableCtx";
import { firstUsableTab, openGameMenu, type GameMenuData, type GameMenuView, type MenuTab } from "../ui/gameMenu";

/** "Marta, level 2 Rogue"; a hero still called by the class name is "Knight, level 1". */
export function heroLineOf(name: string, level: number, label: string): string {
  return name.trim().toLowerCase() === label.trim().toLowerCase() ? `${name}, level ${level}` : `${name}, level ${level} ${label}`;
}

/** The part of the overlay a story screen answers through (the overlay builds the screen; the menu only needs to know one is up). */
interface StoryView {
  storyOpen?: () => boolean;
}

export function installGameMenu(tc: TableCtx): void {
  let view: GameMenuView | null = null;
  let watch: ReturnType<typeof setInterval> | undefined;

  const storyUp = (): boolean => (tc.overlay as unknown as StoryView).storyOpen?.() === true;

  /** The game as the menu shows it. */
  function dataNow(): GameMenuData {
    const p = tc.st();
    const live = !tc.screenOpen();
    const adv = adventureOf(p);
    const s = tc.host.settings.get();
    const free = !tc.busy;
    return {
      live,
      sheet: live ? p.hero : null,
      extras: tc.sheetExtras(p),
      heroLine: heroLineOf(p.hero.name, p.hero.level, ARCHETYPE_LABEL[p.archetypeId] ?? p.archetypeId),
      hostilesPresent: hostileNear(p),
      manifest: tc.host.art.render(p.template),
      artSig: tc.host.art.signature(),
      journal: adv ? (journalFor(p) ?? null) : null,
      log: p.log.map((l) => ({ text: l.text, tone: l.tone })),
      saves: tc.session.saves.list().map((sv) => ({ id: sv.id, label: saveLabel(sv), detail: saveDetail(sv), canLoad: free })),
      settings: { textSpeed: tc.textSpeed, textStyle: tc.textStyle, rollMyself: tc.rollMyself, zoom: s.zoom ?? null, autoEndTurn: s.autoEndTurn !== false },
      ...(tc.exportStatus ? { exportStatus: tc.exportStatus } : {}),
      ...(tc.exportCopyShown ? { exportCopy: true } : {}),
    };
  }

  function stopWatching(): void {
    if (watch !== undefined) clearInterval(watch);
    watch = undefined;
  }

  function closeGameMenu(): void {
    view?.close();
  }

  function open(tab?: MenuTab): void {
    // The DM has the floor: a story screen is read before anything else is opened.
    if (storyUp() || tc.creationView) return;
    if (view) {
      const want = tab ?? view.tab();
      if (want === view.tab()) closeGameMenu();
      else view.setTab(want);
      return;
    }
    tc.closeLoot();
    const data = dataNow();
    view = openGameMenu(tc.stageWrap, {
      style: tc.textStyle,
      data,
      tab: firstUsableTab(tab ?? "character", data.live),
      // The same item cards as the pack used to have: what each thing can do, and why not when it cannot.
      itemCard: (key) => itemCardFor(tc.st(), key),
      pictures: tc.pictures,
      onItemAction: (key, id) => void tc.runItemAction(key, id),
      onAction: (id) => void tc.onHudAction(id),
      onClose: () => {
        view = null;
        stopWatching();
        tc.stageWrap.closest(".lt-arena")?.removeAttribute("data-menu-open");
        tc.viewsChanged();
      },
    });
    tc.stageWrap.closest(".lt-arena")?.setAttribute("data-menu-open", "");
    // A story screen that opens under it takes the menu down.
    watch = setInterval(() => {
      if (view && storyUp()) closeGameMenu();
    }, 200);
    tc.viewsChanged();
  }

  function sync(): void {
    if (!view) return;
    view.setStyle(tc.textStyle);
    view.update(dataNow());
  }

  // What the other modules call or read.
  tc.openGameMenu = open;
  tc.closeGameMenu = closeGameMenu;
  tc.gameMenuOpen = () => view !== null;
  tc.syncGameMenu = sync;
}
