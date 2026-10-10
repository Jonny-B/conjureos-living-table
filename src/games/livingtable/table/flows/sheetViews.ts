/**
 * The screens and windows that sit over the board and pause the game: which of them is open, the character creator's ability dice, and the
 * hooks the other flows call to open or close the game menu (the sheet's old home, now a tab of the menu: gameMenuFlow.ts).
 */
import { rollDie } from "../../rules/dice";
import { dropLowest } from "../ui/sheet";
import { type PlayState } from "../state";
import { SCORE_READ_MS, dieOf } from "./tableKit";
import { portraitCanvas } from "../fog";
import type { SheetExtras } from "../ui/sheet";
import type { TableCtx } from "../tableCtx";

/** The part of the overlay a story screen answers through (the overlay builds the screen; this file only asks whether one is up). */
interface StoryView {
  storyOpen?: () => boolean;
}

export function installSheetViews(tc: TableCtx): void {
  // ---- what is over the board --------------------------------------------------
  //
  // The game menu (Character, Inventory, Journal, Log, Saves, Settings), the character creator, the adventure screens (the start screen, the
  // hero screen, an ending, the main menu) and a story screen each pause the game: board clicks and game keys do nothing, the HUD's action
  // buttons are greyed, and Escape (or the view's own buttons) gets back. The menu follows the hero live (hit points, potions, what the DM
  // hands over).

  /** Kept for the keys that still look for a sheet window: the sheet is a tab of the game menu now, so there is no window of its own. */
  tc.sheetView = null;
  tc.creationView = null;
  /** The adventure screens over the board (the start screen, the hero screen, an ending): each pauses the game. */
  tc.startScr = null;
  tc.heroScr = null;
  tc.endScr = null;
  const screenOpen = (): boolean => tc.startScr !== null || tc.heroScr !== null || tc.endScr !== null || tc.menuScr !== null;
  /** A story screen (the DM telling what the player did not ask for) holds the world until it is read. */
  const storyUp = (): boolean => (tc.overlay as unknown as StoryView).storyOpen?.() === true;
  /** The debug export's outcome, in plain words, under its button in the Saves tab; and whether the clipboard fallback button shows. */
  tc.exportCopyShown = false;
  /** The loot window on the board (a body being searched, or a pile), and what it is for. */
  tc.lootWin = null;
  tc.lootTarget = null;
  const overlayOpen = (): boolean => tc.gameMenuOpen() || tc.creationView !== null || screenOpen() || storyUp();
  const portrait = (archetypeId: string): HTMLCanvasElement | null => portraitCanvas(tc.host.art.render("fantasy"), archetypeId);
  const sheetExtras = (p: PlayState): SheetExtras => ({
    potions: p.potions,
    notes: p.itemNotes,
    portrait: portrait(p.archetypeId),
    // The header's picture is the cast figure in the gear the hero wears when the cast is loaded; it is made when the sheet draws its header.
    picture: () => tc.pictures.picture({ sheet: p.hero, still: () => portrait(p.archetypeId) }),
  });

  /** Something over the board opened or closed: loose marks go, the stage measures its room again, and the readout redraws. */
  function viewsChanged(): void {
    tc.closeLoot();
    tc.hover = null;
    tc.marksKey = "";
    tc.stageRefresh();
    tc.renderHud();
  }

  function closeSheet(): void {
    tc.closeGameMenu();
  }

  function closeCreation(): void {
    const c = tc.creationView;
    tc.creationView = null;
    c?.close();
    viewsChanged();
  }

  function closeViews(): void {
    tc.closeGameMenu();
    if (tc.creationView) closeCreation();
  }

  /** The character sheet is the menu's Character tab. */
  function openSheetView(): void {
    tc.openGameMenu("character");
  }

  function toggleSheet(): void {
    tc.openGameMenu("character");
  }

  /**
   * The creator's ability dice, thrown in the real tray one score at a time (four d6
   * each, so every number is on a die the player can see). With "I roll my own dice"
   * on, the player taps once for the whole set; a tap on the tray while it throws
   * jumps to the end of that throw.
   */
  async function rollScoreDice(groups: number, count: number, sides: number, label: string): Promise<number[][]> {
    const kind = dieOf(sides);
    const out: number[][] = [];
    const skipThrow = (): void => tc.tray.skip();
    tc.trayHost.addEventListener("click", skipThrow);
    // On a phone the tray sits under the stage: bring it into view for the throw (a no-op beside it).
    const scrollTo = (node: HTMLElement): void => node.scrollIntoView?.({ block: "nearest", behavior: tc.reducedMotion ? "auto" : "smooth" });
    scrollTo(tc.trayHost);
    try {
      for (let g = 0; g < groups; g++) {
        const faces = Array.from({ length: count }, () => rollDie(sides));
        if (g === 0 && tc.rollMyself) await tc.tray.awaitRoll(`Tap to roll your ${groups} scores`, faces.map(() => kind));
        const kept = dropLowest(faces);
        await tc.throwDice(
          {
            dice: faces.map((result) => ({ kind, result })),
            label: `Score ${g + 1} of ${groups}: ${faces.join(" ")}`,
            // dropped is the lowest die's index; the player reads its face.
            detail: `KEEP ${kept.total}, DROP THE ${faces[kept.dropped]}`,
            tone: "plain",
          },
          `${tc.st().hero.name} (character creation)`,
        );
        // Cancelled, or the scene went away, while it rolled: stop throwing.
        if (!tc.alive || !tc.creationView) throw new Error(label);
        out.push(faces);
        // A beat to read this score before the next throw clears it (a tap on the tray moves on).
        if (g < groups - 1 && !tc.reducedMotion) {
          await new Promise<void>((resolve) => {
            const done = (): void => {
              clearTimeout(timer);
              tc.trayHost.removeEventListener("click", done);
              resolve();
            };
            const timer = setTimeout(done, SCORE_READ_MS);
            tc.trayHost.addEventListener("click", done);
          });
        }
      }
    } finally {
      tc.trayHost.removeEventListener("click", skipThrow);
      if (tc.alive) scrollTo(tc.stageWrap);
    }
    return out;
  }

  // What the other modules call or read.
  tc.screenOpen = screenOpen;
  tc.overlayOpen = overlayOpen;
  tc.portrait = portrait;
  tc.sheetExtras = sheetExtras;
  tc.viewsChanged = viewsChanged;
  tc.closeSheet = closeSheet;
  tc.closeViews = closeViews;
  tc.openSheetView = openSheetView;
  tc.toggleSheet = toggleSheet;
  tc.rollScoreDice = rollScoreDice;
}
