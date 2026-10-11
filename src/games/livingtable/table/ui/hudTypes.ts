/**
 * The HUD's public types: actions, bars, pack sections, the log, saves, the journal, settings, HudState and the Hud interface.
 */
import { type ItemCardContent, type TipContent } from "./tip";
import type { InitiativeSide, TextSpeed, TextStyle } from "./overlayTypes";

// ---- the demo ---------------------------------------------------------------

// ---- the in-game HUD: the dock beside the board ------------------------------
//
// Everything the player plays with that is not on the board itself: whose turn
// it is and what is left of it, everyone's hit points, and the action buttons,
// drawn in the same two treatments as the board's text. A slot between the
// status and the buttons takes the dice tray. It sits in the page flow (not
// over the board), so it never covers the fight.

export interface HudAction {
  id: string;
  label: string;
  /** The keyboard shortcut, shown on the button. */
  key?: string;
  enabled: boolean;
  /** Draw attention: the thing to press now (End turn once nothing else is left). */
  emphasis?: boolean;
  /** Not drawn at all (an Attack with nothing in reach). The buttons left close up over it; this is not the greyed-out look, that is `enabled: false`. */
  hidden?: boolean;
  /**
   * "builtin" (the default) is one of the game's own buttons, in the grid. "suggestion" is drawn in the DM's row of next moves,
   * the same as an entry of HudState.options.
   */
  kind?: "builtin" | "suggestion";
}
export interface HudBar {
  id: string;
  label: string;
  hp: number;
  max: number;
  side: InitiativeSide;
  /** Out of the fight (dead, or the hero at 0 and making death saves). */
  down?: boolean;
}
/** One heading in the pack view and what is under it ("Worn", "Bag", "Carried", "Potions"). */
export interface PackSection {
  label: string;
  items: readonly PackItem[];
}
/**
 * One thing in the pack: its line, and optionally the hover help that says exactly what it is (shown on hover, keyboard
 * focus or a tap, in the HUD's current text style, inside the game window). A plain string has no help.
 *
 * With `card` the row is an item card instead (attachItemCard): hover or focus shows the facts with the status line on top, and a
 * click, tap or Enter pins the card with its action buttons, each press going to createHud's `onItemAction(key, actionId)`. `key` is
 * the host's name for the item (default: its text) and is what onItemAction gets back. `card` is read each time the card opens.
 */
export type PackItem = string | { text: string; tip?: TipContent; key?: string; card?: () => ItemCardContent };
/** One of the DM's suggested next moves: a button that, pressed, is the same as typing the label. Its key is shown on it (default 1 to 4 by position). */
export interface HudOption {
  id: string;
  label: string;
  key?: string;
}
export type LogTone = "good" | "bad" | "plain" | "dm";
/** One line of the log drawer: a roll, a find, a line of narration. */
export interface HudLogLine {
  text: string;
  tone?: LogTone;
}
/** One entry of the saves drawer. Pressing Load calls onAction("load:" + id). */
export interface HudSave {
  id: string;
  label: string;
  detail?: string;
  canLoad: boolean;
}
/** What the Journal tab shows. */
export interface HudJournal {
  /** The adventure's title. */
  title: string;
  /** The scene now. */
  scene: string;
  /** The adventure's day, present only in an adventure that keeps time. */
  day?: number;
  objectives: readonly { text: string; done: boolean }[];
  /** The last beats of the story, oldest first. */
  recent?: readonly string[];
}
export interface HudState {
  /** One line on top: "Round 2, your turn", "Exploring". */
  title: string;
  /** Short lines under it: what is left of the turn, the hero's numbers. */
  lines: readonly string[];
  bars: readonly HudBar[];
  actions: readonly HudAction[];
  /**
   * Ask for the small-screen look. When the panel is narrower than CONDENSED_MAX_PX and fills its whole row (a phone, where the dock sits
   * under the board), it draws only the title, `short` and the hit point bars, in under about 100 px. Without it, or beside the board,
   * every line is drawn.
   */
  condense?: boolean;
  /** The title for the small-screen look, short enough to stay on one line at 320 px ("Rd 1: rat 2"). Without it the full `title` is drawn there too. */
  shortTitle?: string;
  /** The lines the small-screen look keeps (the move and action left in a fight). The other `lines` are left out there. */
  short?: readonly string[];
  /** The hero's things. With it the HUD has a "Pack (I)" button that shows or hides them in the drawer. */
  pack?: { sections: readonly PackSection[] };
  /**
   * The DM's suggested next moves, as a row of buttons above the built-in ones (labels up to 32 characters, at most 4 shown, keys 1 to 4).
   * Empty or absent: the row is not there at all. Pressing one calls onAction(option.id).
   */
  options?: readonly HudOption[];
  /** Everything that happened, oldest first. With it the HUD has a "Log (L)" button; the drawer shows the newest at the bottom. */
  log?: readonly HudLogLine[];
  /** The save points. With it the HUD has a "Saves" button; the drawer lists them, each with a Load button, and under them the debug export button. */
  saves?: readonly HudSave[];
  /**
   * The story so far. With it the HUD has a "Journal (J)" tab (and without it there is none): the adventure's title, the scene, the
   * objectives with a tick on the done ones, and the last few beats. `recent` is oldest first, like the log; the tab shows the newest first.
   */
  journal?: HudJournal;
  /** The game's settings. With it the HUD has a "Settings" tab (text speed, text style, who rolls the dice, zoom); see HudSettings. */
  settings?: HudSettings;
  /** A small line under the export button in the Saves drawer: "Saved.", "Copied to the clipboard.", or why it did not work. */
  exportStatus?: string;
  /** Show a second button, "Copy adventure JSON", beside the export one (the fallback when the file cannot be saved). Pressing it calls onAction("export-copy"). */
  exportCopy?: boolean;
}
/**
 * What the Settings tab shows and sets. Pressing a choice calls onAction("set:<key>:<value>"): set:textSpeed:slow|normal|fast|instant,
 * set:textStyle:pixel|storybook, set:rollMyself:true|false, set:zoom:auto|1|2|3|4, set:autoEndTurn:true|false. The HUD changes nothing itself: the host applies
 * the setting and renders the state again.
 */
export interface HudSettings {
  textSpeed: TextSpeed;
  textStyle: TextStyle;
  rollMyself: boolean;
  /** The board zoom 1 to 4, or null for "Auto" (the window picks from the screen). */
  zoom: number | null;
  /** End the turn by itself when the hero has no move left. On unless this is false. */
  autoEndTurn?: boolean;
}
export type DrawerTab = "pack" | "journal" | "log" | "saves" | "settings";
export interface Hud {
  setStyle(style: TextStyle): void;
  render(state: HudState): void;
  /** Show or hide the pack list. Does nothing while the state has no `pack`. */
  togglePack(): void;
  /** Show or hide the log. Does nothing while the state has no `log`. */
  toggleLog(): void;
  /** Show or hide the saves list. Does nothing while the state has no `saves`. */
  toggleSaves(): void;
  /** Show or hide the journal. Does nothing while the state has no `journal`. */
  toggleJournal(): void;
  /** Open the drawer on a tab (switching from another). Does nothing while the state has none of that tab's part. */
  openDrawer(tab: DrawerTab): void;
  closeDrawer(): void;
  isPackOpen(): boolean;
  isDrawerOpen(): boolean;
  /** The tab showing, or null when the drawer is shut. */
  drawerTab(): DrawerTab | null;
  /** A small note under the drawer buttons ("+ a few tarnished copper coins") that fades after about 3 s. At most two show; the oldest goes first. */
  notice(text: string, tone?: "good" | "bad" | "plain"): void;
  destroy(): void;
}
