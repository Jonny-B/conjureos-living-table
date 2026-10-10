/**
 * Pure helpers of the HUD: pack items, the Settings tab's choices, the journal, the drawer tabs, suggested-move layout, the log window, notices.
 */
import { textWidth, wrapText, type PixelWeight } from "./pixelFont";
import type { PackSection, PackItem, HudSettings, DrawerTab, HudBar } from "./hudTypes";
import { tidy, JOURNAL_RECENT_MAX } from "./screenHelpers";

/**
 * The pack items in `next` whose text was not in `prev`, by text alone (an item that moves from the bag to being
 * worn is not new). `prev` null is the first look at the pack, where nothing counts as new.
 */
export function newPackItems(prev: readonly PackSection[] | null | undefined, next: readonly PackSection[] | null | undefined): Set<string> {
  const fresh = new Set<string>();
  if (!prev || !next) return fresh;
  const had = new Set<string>();
  for (const sec of prev) for (const it of sec.items) had.add(packItemText(it));
  for (const sec of next) for (const it of sec.items) if (!had.has(packItemText(it))) fresh.add(packItemText(it));
  return fresh;
}

/** The words a pack item shows: the item itself when it is a string, its `text` otherwise. */
export function packItemText(item: PackItem): string {
  return typeof item === "string" ? item : item.text;
}

/** How many columns the HUD's drawer tabs take: one each up to three, two columns beyond that (their labels need the room; a last odd one takes the whole row). */
export function drawerColumns(count: number): number {
  return count <= 3 ? Math.max(1, count) : 2;
}

/** The choices of each setting in the Settings tab, in order: its key, its heading and its (value, label) pairs. */
export const SETTING_CHOICES: readonly { key: "textSpeed" | "textStyle" | "rollMyself" | "zoom" | "autoEndTurn"; label: string; choices: readonly { value: string; label: string }[] }[] = [
  { key: "textSpeed", label: "Text speed", choices: [{ value: "slow", label: "Slow" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }, { value: "instant", label: "Instant" }] },
  { key: "textStyle", label: "Text style", choices: [{ value: "pixel", label: "Pixel" }, { value: "storybook", label: "Storybook" }] },
  { key: "rollMyself", label: "Roll my own dice", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }] },
  { key: "zoom", label: "Zoom", choices: [{ value: "auto", label: "Auto" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] },
  // On unless it says otherwise: the turn ends by itself when nothing is left to do.
  { key: "autoEndTurn", label: "End turn automatically", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }] },
];

/** The value of a setting as its choice is named (the "set:" id's last part): which choice of SETTING_CHOICES is the one in use. */
export function settingValue(settings: HudSettings, key: (typeof SETTING_CHOICES)[number]["key"]): string {
  if (key === "textSpeed") return settings.textSpeed;
  if (key === "textStyle") return settings.textStyle;
  if (key === "rollMyself") return String(settings.rollMyself);
  if (key === "autoEndTurn") return String(settings.autoEndTurn !== false);
  return settings.zoom === null ? "auto" : String(settings.zoom);
}

export interface JournalObjective {
  text: string;
  done: boolean;
}
/** The journal's objectives: blank ones dropped, words tidied. */
export function journalObjectives(list: readonly JournalObjective[] | undefined): JournalObjective[] {
  return (list ?? []).map((o) => ({ text: tidy(o.text), done: !!o.done })).filter((o) => o.text !== "");
}

/** "2 of 3 done", or "" with no objectives. */
export function journalProgress(list: readonly JournalObjective[] | undefined): string {
  const objs = journalObjectives(list);
  if (objs.length === 0) return "";
  return `${objs.filter((o) => o.done).length} of ${objs.length} done`;
}

/** The recent beats the journal prints: given oldest first (like the log), at most `max` of them, newest first. Blanks are dropped. */
export function journalRecent(recent: readonly string[] | undefined, max = JOURNAL_RECENT_MAX): string[] {
  return (recent ?? [])
    .map(tidy)
    .filter(Boolean)
    .slice(-Math.max(0, max))
    .reverse();
}

// ---- the HUD's pure helpers (unit tested) ------------------------------------

export const DRAWER_TABS: readonly DrawerTab[] = ["pack", "journal", "log", "saves", "settings"];

/** The drawer after a tab's button is pressed: the open tab closes it, any other tab opens (switching from the one showing). */
export function toggleDrawerTab(open: DrawerTab | null, tab: DrawerTab): DrawerTab | null {
  return open === tab ? null : tab;
}

/** The tab that really shows: the one asked for, if the state still has that part, otherwise none. */
export function usableDrawerTab(open: DrawerTab | null, has: Readonly<Record<DrawerTab, boolean>>): DrawerTab | null {
  return open !== null && has[open] ? open : null;
}

/** The panel counts as small (a phone) under this width, when it fills its row. */
export const CONDENSED_MAX_PX = 520;

/**
 * Whether the dock draws its small-screen look: it is under CONDENSED_MAX_PX wide AND fills its row (so it sits under the board, not
 * beside it; a 320 px column on a desktop is narrow too, but it has the room of a whole column to itself). Widths of 0 (not laid out) never condense.
 */
export function condensedHud(width: number, rowWidth: number, short = false): boolean {
  // `short`: the window is a phone on its side (500 px high or less). The column beside the board has no height to spare there, so it condenses too.
  return width > 0 && width < CONDENSED_MAX_PX && (short || rowWidth - width < 24);
}

/** A HUD this wide or narrower, filling its row (a tablet held upright), lays out in two columns. */
export const STACKED_MAX_PX = 760;

/** The HUD's layout: "condensed" (a phone), "stacked" (two columns, an upright tablet) or "wide" (the column beside the board). */
export type HudLayout = "condensed" | "stacked" | "wide";

/**
 * Whether the dock lays out in two columns: it is from CONDENSED_MAX_PX up to STACKED_MAX_PX wide and fills its row (it sits under the board).
 * Under CONDENSED_MAX_PX is the phone's condensed look, and a column beside the board never fills its row.
 */
export function stackedHud(width: number, rowWidth: number): boolean {
  return width >= CONDENSED_MAX_PX && width <= STACKED_MAX_PX && rowWidth - width < 24;
}

/** The layout for a HUD `width` wide in a row `rowWidth` wide, when the state asked for the small-screen looks (`condense`). */
export function hudLayout(width: number, rowWidth: number, condense: boolean, short = false): HudLayout {
  if (!condense) return "wide";
  if (condensedHud(width, rowWidth, short)) return "condensed";
  return stackedHud(width, rowWidth) ? "stacked" : "wide";
}

/** Notices float over the HUD's top row on a phone (nothing moves, nothing is pushed under the fold); everywhere else they sit in the flow. */
export function noticesFloat(layout: HudLayout): boolean {
  return layout === "condensed";
}

/**
 * The title the condensed panel draws, one short line: "Your turn (rd 2)" or "Rd 2: rat 2" (whose turn it is, lower case, or "something" for an
 * unseen creature). The full title is "Round 2: your turn" and "Round 2: rat 2's turn".
 */
export function shortTurnTitle(round: number, who: "you" | string | null): string {
  if (who === "you") return `Your turn (rd ${round})`;
  return `Rd ${round}: ${who ?? "something"}`;
}

/** A hit point bar's label sits on the same row as its meter and numbers while it leaves this much meter. */
export const BAR_METER_MIN_PX = 24;
/** The gap between a bar's label, meter and numbers, in CSS px. */
export const BAR_GAP_PX = 8;
/** A few px of slack, so a row that fits by a hair is wrapped on purpose and not left to the browser to break. */
const BAR_SLACK_PX = 6;

/**
 * Whether a bar's label needs a row to itself (the meter and numbers wrap under it): the label, the numbers and BAR_METER_MIN_PX of
 * meter, with the two gaps, are wider than `rowPx`. All widths are in CSS px.
 */
export function barLabelWraps(labelPx: number, numbersPx: number, rowPx: number): boolean {
  return labelPx + numbersPx + BAR_METER_MIN_PX + 2 * BAR_GAP_PX + BAR_SLACK_PX > rowPx;
}

/** Pixel text cut with ".." to at most `maxFontPx` font pixels wide (a made character's name can be 60 characters long); whole when it fits. */
export function cutToWidth(words: string, maxFontPx: number, weight: PixelWeight = "regular"): string {
  if (textWidth(words, weight) <= maxFontPx) return words;
  let cut = words.length;
  while (cut > 1 && textWidth(`${words.slice(0, cut).trimEnd()}..`, weight) > maxFontPx) cut--;
  return `${words.slice(0, cut).trimEnd()}..`;
}

/** The most suggested moves shown at once, and the longest label a button carries (longer ones are cut with "..", the full words stay in its name). */
export const HUD_OPTIONS_MAX = 4;
export const OPTION_LABEL_MAX = 32;
/** Labels this short, all of them, go two to a row; any longer and the buttons take a row each. */
export const OPTION_SHORT_MAX = 12;
/** The newest log lines the drawer draws; older ones are counted, not drawn. */
export const LOG_RENDER_MAX = 300;
export const NOTICE_MS = 3000;
export const NOTICE_OUT_MS = 400;
export const NOTICE_MAX = 2;

/** A button label on one run of words, no more than `max` characters, cut with ".." when longer. */
export function clipOptionLabel(label: string, max = OPTION_LABEL_MAX): string {
  const words = label.replace(/\s+/g, " ").trim();
  return words.length > max ? `${words.slice(0, Math.max(1, max - 2)).trimEnd()}..` : words;
}

export interface OptionChoice {
  id: string;
  /** What the button shows (clipped). */
  label: string;
  /** The whole words, for the button's name. */
  full: string;
  key: string;
  enabled: boolean;
}

/**
 * The suggested moves as buttons: blanks dropped, the first four kept, labels clipped, keys filled in from the position (1 to 4)
 * where there is none, and one column unless every label is short enough for two.
 */
export function optionsLayout(options: readonly { id: string; label: string; key?: string; enabled?: boolean }[]): { columns: 1 | 2; items: OptionChoice[] } {
  const items: OptionChoice[] = [];
  for (const o of options) {
    const full = o.label.replace(/\s+/g, " ").trim();
    if (!o.id || !full) continue;
    items.push({ id: o.id, label: clipOptionLabel(full), full, key: o.key || String(items.length + 1), enabled: o.enabled !== false });
    if (items.length >= HUD_OPTIONS_MAX) break;
  }
  const columns = items.length >= 2 && items.every((i) => i.label.length <= OPTION_SHORT_MAX) ? 2 : 1;
  return { columns, items };
}

/**
 * Pixel text wrapped to `maxWidth` (font pixels) and kept to `maxLines` lines: what does not fit is cut and the last line ends in "..".
 * Each entry is one line.
 */
export function wrapClamp(text: string, maxWidth: number, maxLines: number, weight: PixelWeight = "regular"): string[] {
  const lines = wrapText(text, maxWidth, weight);
  const keep = Math.max(1, maxLines);
  if (lines.length <= keep) return lines;
  const head = lines.slice(0, keep - 1);
  let rest = lines.slice(keep - 1).join(" ");
  while (rest.length > 1 && textWidth(`${rest}..`, weight) > maxWidth) rest = rest.slice(0, -1).trimEnd();
  return [...head, `${rest}..`];
}

/** The lines the log drawer draws (the newest `max`) and how many older ones are left out. */
export function logWindow<T>(log: readonly T[], max = LOG_RENDER_MAX): { shown: readonly T[]; hidden: number } {
  const hidden = Math.max(0, log.length - Math.max(0, max));
  return { shown: hidden > 0 ? log.slice(hidden) : log, hidden };
}

/** How many of the oldest notices must go for a new one to fit: the stack holds NOTICE_MAX. */
export function noticeOverflow(count: number, max = NOTICE_MAX): number {
  return Math.max(0, count + 1 - max);
}

export type HudTone = "good" | "bad" | "dm";

/** The tick box of a journal objective in pixel art: a plain box, or a green one with a white tick. */
export const BOX_ROWS = ["MMMMMMM", "M.....M", "M.....M", "M.....M", "M.....M", "M.....M", "MMMMMMM"];
export const BOX_DONE_ROWS = ["LLLLLLL", "LGGGGWL", "LGGGWGL", "LWGWGGL", "LGWGGGL", "LGGGGGL", "LLLLLLL"];
/** Font Awesome's solid check, drawn inline so there is no icon font. */
export const CHECK_PATH = "M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z";

/** Hit point colours: hero blue, enemy red, both amber when low, grey when down. */
export function hpColour(bar: HudBar): string {
  if (bar.down || bar.hp <= 0) return "#6b6f86";
  if (bar.hp * 3 <= bar.max) return "#ffb02a";
  return bar.side === "hero" ? "#59a8ff" : "#ff5a4a";
}
