/**
 * The bench's on-screen text layer: banners, floating damage numbers, roll
 * plates, the story strip, the initiative strip and toasts, drawn as DOM over
 * the Play canvas. "The canvas paints sprites, DOM paints type": the game's own
 * rule (the LivingTable.tsx readout comment), so this layer never touches the
 * board's pixels.
 *
 * Two treatments, switchable live with setStyle, that share one semantic palette
 * (red damage, gold crits, green healing, grey misses):
 *
 *   pixel      a chunky bitmap font (pixelFont.ts) drawn onto canvases at
 *              integer scales, in nine-slice pixel windows. No web font.
 *   storybook  system serif stacks only (Georgia, Palatino Linotype, Book
 *              Antiqua), with the ConjureOS core.css treatments replicated in
 *              this file's own CSS because the bench loads none of it: .cg-t2
 *              (a hairline stroke, a hard lip and a soft shadow on small labels)
 *              and .cg-num (SVG text with paint-order stroke-then-fill, a dark
 *              stroke, a hard-stop two-tone face and a drop shadow, for numerals
 *              and titles).
 *
 * It reads on any floor art because nothing is bare text: titles sit on a dark
 * ribbon, plates are opaque, and the floating numbers carry a dark outline and a
 * shadow. Storybook plates follow the page theme (parchment in light, ink in
 * dark) with the same selector contract the bench uses; pixel windows are one
 * fixed navy-and-cream skin in both.
 *
 * Contract with the Play lane (coordinates are CSS px from the HOST's top-left
 * corner; the host should be a non-scrolling box that frames the board, because
 * the layer is absolutely positioned inside it). Hooks for tests: every element
 * carries data-lto-* attributes, the root carries data-busy (the number of
 * animations in flight, 0 when idle), and the visible text is also in data-text
 * because pixel text is canvas.
 *
 * Layout rules that are easy to break: floats landing on one spot stack by the
 * ink really stacked there (not by their own heights); a roll plate over a point
 * starts clear of an ordinary damage number and steps up out of the way of taller
 * ones, so a verdict is never printed under a number (on a host too short for both
 * the number wins); and pixel text is laid out at the CSS size it is really drawn
 * at (cssScale in pixelFont.ts), which is not the nominal scale at a fractional
 * device pixel ratio such as 1.25, 1.75 or 2.75.
 *
 * Nothing here touches the DOM at import time (the bench registry is imported in
 * Node for validation). It imports the game's engine for types only.
 */
import type { RollReadout } from "../../render/canvasRenderer";
import { CELL_H, LINE_GAP, cssScale, deviceScale, fitScale, pixelText, textWidth, wrapText, wrapWidth, type PixelColor, type PixelRun, type PixelTextOptions, type PixelWeight } from "./pixelFont";
import { attachItemCard, attachTip, cardNavIndex, type ItemCardContent, type TipContent } from "./tip";

export type { ItemCardAction, ItemCardContent, TipContent } from "./tip";

// ---- the public contract ----------------------------------------------------

export type TextStyle = "pixel" | "storybook";
/** CSS px relative to the overlay host. */
export interface OverlayPoint {
  x: number;
  y: number;
}
export type BannerKind = "turn" | "enemy" | "initiative" | "victory" | "defeat";
export type FloatKind = "damage" | "crit" | "heal" | "miss" | "down" | "info";
export type DialogueTone = "good" | "bad" | "plain";
export interface DialogueLine {
  speaker?: string;
  text: string;
  tone?: DialogueTone;
  /** Stays on the board until the next action (dismissStory) instead of fading after its reading time: "You are down". Default false. */
  sticky?: boolean;
}
/** Which team a combatant is on, for colour coding the turn-order strip. */
export type InitiativeSide = "hero" | "enemy";
export interface InitiativeEntry {
  id: string;
  label: string;
  total: number;
  /** Optional: with it the chip is coloured (blue for a hero, red for an enemy) in both styles; without it the chip is neutral. */
  side?: InitiativeSide;
}
/**
 * What rollPlate shows. A plain RollReadout (render/rollReadoutAdapter.ts) is
 * enough; the three optional fields are the ones LivingTable.tsx's ReadoutView
 * adds, so pass them through for the natural 20 and natural 1 lines the game's
 * own readout prints (attackResultToReadout drops them).
 */
export type PlateReadout = RollReadout & { caption?: string; critical?: boolean; fumble?: boolean };

/**
 * A DM narration box that is up. update() replaces the whole text so far (a streaming
 * reply passes the accumulated text each time), done() says the text is complete and
 * starts the reading time, close() dismisses it now. Once the box has been closed,
 * replaced by a newer narrate() or cleared, update() and close() do nothing.
 */
export interface NarrationHandle {
  update(text: string): void;
  done(): void;
  close(): void;
}

/** One line of a context menu: what it does, why it is offered, and whether it can be done now. */
export interface ContextMenuEntry {
  id: string;
  label: string;
  /** Why the game offers it to YOU here ("Your skill: Sneak +5"). Shown small under the label. */
  why?: string;
  /** Offered because of your class or a skill you are good at: drawn with a small gold star. */
  good?: boolean;
  enabled: boolean;
  /** Why it cannot be done now. Shown small under the label of a greyed entry. */
  reason?: string;
}
/** One thing in a loot window. `tip` is the hover help on its name. */
export interface LootWindowItem {
  key: string;
  name: string;
  tip?: TipContent;
}
export interface LootWindowOptions {
  title: string;
  items: readonly LootWindowItem[];
  /** The Take button of one item (its key), or Take all ("all"). The window does not remove anything itself: call update() with what is left. */
  onTake: (key: string | "all") => void;
  /** The player closed it (Close, Escape), or it closed itself once empty. Not called by close(). */
  onClose: () => void;
}
export interface LootWindow {
  /** Show what is left. An empty list shows "Nothing left." for a moment, then the window closes itself (and calls onClose). */
  update(items: readonly LootWindowItem[]): void;
  /** Close it now, without calling onClose. */
  close(): void;
}

// ---- the adventure screens: the contract ------------------------------------

/** One adventure on the start screen. */
export interface StartAdventure {
  id: string;
  title: string;
  summary: string;
  /** "owner" is a hand-written file; "ai" was written by the AI writer (the card says so). */
  author: "owner" | "ai";
  /** How many items the file marks for review: the card says "Draft: N items marked for review". */
  draftMarks?: number;
  /** Why the file does not validate. With any, the card is drawn with the problems listed and cannot be picked. */
  problems?: string[];
}
/** One sandbox room on the start screen ("Test rooms"). */
export interface StartRoom {
  id: string;
  title: string;
  summary: string;
}
/** What the AI writer is doing now: setWriting shows it in place of the premise form. */
export interface StartWriting {
  stage: string;
  canCancel: boolean;
}
export interface StartScreenOptions {
  adventures: readonly StartAdventure[];
  sandboxes: readonly StartRoom[];
  /** The plain-words cost note shown above the premise box (AI_ADVENTURE_COST_NOTE). */
  aiNote: string;
  /** An adventure card, or a test room card, was picked (its id). */
  onPick: (id: string) => void;
  /** The premise was written and confirmed. The screen then shows "writing" until setWriting is called. */
  onWrite: (premise: string) => void;
}
export interface StartScreen {
  /** Take the screen down. Does not call onPick. */
  close(): void;
  /**
   * Show what the writer is doing (a progress line and, with canCancel, a Cancel button that calls `onCancel`), or null when
   * it has stopped (the premise form comes back with the premise still in it, for another try). While it is up the adventure
   * and room cards cannot be picked.
   */
  setWriting(state: StartWriting | null, onCancel?: () => void): void;
  /**
   * Say in plain words why the writer did not make an adventure (the first few lines, then "and N more") above the premise form's buttons,
   * where it stays until the next try starts or this is called with null. Call it after setWriting(null) so the form is showing.
   */
  setProblems(lines: readonly string[] | null): void;
}
/** One quick-start hero: the class (chassis id), its label, the adventure's hook for it and its starting kit in words. */
export interface StartHeroHook {
  chassis: string;
  label: string;
  hook: string;
  kit: string;
}
export interface StartHeroOptions {
  adventureTitle: string;
  hooks: readonly StartHeroHook[];
  /** "Make your own hero": the character maker. */
  onCreate: () => void;
  /** A quick start for one class. */
  onQuick: (chassis: string) => void;
  /** Back, or Escape: to the start screen. */
  onBack: () => void;
}
export interface StartHero {
  close(): void;
}
export type EndingOutcome = "victory" | "defeat" | "continue";
export interface EndingCardOptions {
  title: string;
  text: string;
  outcome: EndingOutcome;
  /** With it there is a Continue button (and Escape does the same). */
  onContinue?: () => void;
  /** "Back to the start screen". */
  onMenu: () => void;
}
export interface EndingCard {
  close(): void;
}

export interface Overlay {
  setStyle(style: TextStyle): void;
  /** A big centred title for about 900 ms. Banners queue; resolves when this one is gone. */
  banner(text: string, kind: BannerKind): Promise<void>;
  /** A number that rises about 16 px over about 900 ms and fades over the last 300 ms. Floats on one spot within 300 ms stack upward. */
  float(at: OverlayPoint, text: string, kind: FloatKind): void;
  /** The d20 maths near a point. Plates queue and never overwrite one another. */
  rollPlate(at: OverlayPoint, readout: PlateReadout): void;
  /**
   * A line in the story strip at the bottom of the board: creature speech and the like, not results (the dice tray and the
   * HUD log carry those). Each line fades after a reading time (stripHoldMs), at most two show at once (one on a phone while the
   * DM narration is up; the oldest fades first), a click on the strip clears it, and the box goes away when it is empty.
   */
  say(line: DialogueLine): void;
  /** Fade the strip's lines now: all of them, or with `stickyOnly` just the ones that were kept ("You are down") for the next action. */
  dismissStory(opts?: { stickyOnly?: boolean }): void;
  /**
   * The DM's voice at the bottom of the board, above the dialogue box: a parchment box in storybook, a gold pixel frame
   * in pixel, tagged "DM" (or the speaker). It shows a "..." while there is no text yet, follows streamed text through
   * update(), and after done() stays for narrationHoldMs then fades; a click closes it early; a new narrate() replaces it.
   */
  narrate(opts: { speaker?: string; text: string; full?: boolean }): NarrationHandle;
  /** The turn-order strip above the board. An empty array hides it. */
  initiative(entries: readonly InitiativeEntry[], activeId: string | null, round: number): void;
  /** A short notice, for refused clicks. */
  toast(text: string): void;
  /**
   * A small menu of choices at a board point (the same space as float() and rollPlate(): CSS px from the host's top-left), clamped
   * inside the board (it flips to the other side of the point when there is no room). The first entry has the focus; Up, Down, Home,
   * End and Enter work, Escape or a click anywhere else closes it (that click is not passed on to the board). Disabled entries stay
   * in the list with their reason printed under them and do nothing when pressed. A press within 300 ms of opening is ignored, so the
   * finger lifting after a long press never picks the first entry. Only one menu is up at a time (a new one replaces it). Returns the
   * function that closes it. onPick runs after the menu has closed.
   */
  contextMenu(at: OverlayPoint, entries: readonly ContextMenuEntry[], onPick: (id: string) => void, opts?: { title?: string }): () => void;
  /**
   * A small panel at the top centre of the board that lists what can be taken, each with a Take button and hover help on its name,
   * plus Take all and Close. See LootWindowOptions. One at a time: a new window replaces the old one without calling its onClose.
   * clear() leaves it up; destroy() takes it down.
   */
  lootWindow(opts: LootWindowOptions): LootWindow;

  /**
   * The start screen, over the whole board: a title card, the adventures as cards (author badge, a draft note, and a problems list
   * on a file that does not validate, which then cannot be picked), the sandbox rooms in a smaller "Test rooms" group, and a "Write a
   * new adventure with AI" card that opens a premise box with the cost note and a Write button that asks to confirm before onWrite.
   * Modal: the keys do not reach the game, Tab stays inside, the arrow keys move between cards. One at a time (a new one replaces it).
   */
  startScreen(opts: StartScreenOptions): StartScreen;
  /** After an adventure is picked: "Make your own hero" or a quick start per class, each with that class's hook and starting kit in words. Escape is Back. */
  startHero(opts: StartHeroOptions): StartHero;
  /**
   * The arrival card: the place's name as a banner and its read-aloud in the narration box style, at the top of the board. It stays
   * for a reading time and fades, or a click (or Enter, Escape on it) dismisses it. A new one replaces the last location card.
   */
  locationCard(opts: { name: string; readAloud: string }): void;
  /** A scene change: the title as a banner and the opening text under it, shown and dismissed like locationCard (its own slot, so both can be up). */
  sceneCard(opts: { title: string; opening?: string }): void;
  /**
   * The ending: a full-board card with the title, the ending's text, Continue (only when onContinue is given) and Back to the start
   * screen. Modal like the start screen. Escape does what Continue does.
   */
  endingCard(opts: EndingCardOptions): EndingCard;

  /** Drop everything on screen (banners resolve at once), the story strip and the initiative strip included, and the context menu (not the loot window). */
  clear(): void;
  destroy(): void;
}

// ---- timing (ms) ------------------------------------------------------------

const BANNER_MS = 900;
const BANNER_REDUCED_MS = 500;
const FLOAT_MS = 900;
const FLOAT_FADE_MS = 300;
const FLOAT_RISE_PX = 16;
const FLOAT_STACK_MS = 300;
/** A float's bottom edge stands this far above its anchor. */
export const FLOAT_BASE_PX = 4;
/** Clear air kept between the inked glyphs of floats stacked on one spot, and between a float and a plate. */
export const FLOAT_GAP_PX = 6;
/** The least a roll plate stands over its point, where there is no room to clear a damage number. */
const PLATE_CLEAR_MIN_PX = 54;
/** How far a roll plate's pointer sticks out below it: the storybook diamond and the pixel caret. */
const PLATE_TAIL_PX = 10;
const PLATE_TAIL_PIXEL_PX = 13;
/** The share of a numeral's font size its capitals and figures rise above the baseline (a little generous, for the fonts that stand in). */
const NUMERAL_CAP = 0.72;
const PLATE_IN_MS = 170;
const PLATE_HOLD_MS = 2000;
const PLATE_HOLD_QUEUED_MS = 1100;
const PLATE_OUT_MS = 220;
const TOAST_MS = 1900;
const TOAST_FADE_MS = 200;
/** The story strip: a line stays about 3.5 s plus 40 ms a character (capped at 9 s), then fades and shrinks away. */
const STRIP_BASE_MS = 3500;
const STRIP_PER_CHAR_MS = 40;
const STRIP_MAX_MS = 9000;
/** Under reduced motion nothing animates, so the reading time is longer (it still clears). */
const STRIP_REDUCED_FACTOR = 1.5;
const STRIP_REDUCED_MAX_MS = 13500;
const STRIP_OUT_MS = 450;
const STRIP_EVICT_MS = 250;
export const STRIP_MAX_LINES = 2;
const NARRATION_BASE_MS = 2500;
const NARRATION_PER_CHAR_MS = 45;
const NARRATION_MAX_MS = 12000;
const NARRATION_IN_MS = 180;
const NARRATION_OUT_MS = 400;
const NARRATION_CLOSE_MS = 140;
const NARRATION_TAG_MAX = 16;

// ---- palettes ---------------------------------------------------------------

/** A numeral's face: light top, a mid tone at the cliff, a deep tone below it. */
interface Face {
  top: string;
  mid: string;
  deep: string;
  outline: string;
}

const FACES: Record<FloatKind | BannerKind, Face> = {
  damage: { top: "#ffb3a5", mid: "#ff5646", deep: "#d4302a", outline: "#2b0a0a" },
  crit: { top: "#fff4ae", mid: "#ffd34c", deep: "#e0891a", outline: "#3b1f00" },
  heal: { top: "#c8ffd6", mid: "#5be486", deep: "#1f9a49", outline: "#06260f" },
  miss: { top: "#f5f6fa", mid: "#c5c8d6", deep: "#868a9d", outline: "#15161f" },
  down: { top: "#ffffff", mid: "#fff1f1", deep: "#ff9c9c", outline: "#8f1024" },
  info: { top: "#e0f3ff", mid: "#84c9ff", deep: "#3a8de2", outline: "#08162f" },
  turn: { top: "#fff4ae", mid: "#ffd34c", deep: "#e0891a", outline: "#3b1f00" },
  enemy: { top: "#ffa293", mid: "#ff4e3f", deep: "#bd1f19", outline: "#2b0a0a" },
  initiative: { top: "#e8f6ff", mid: "#8fd0ff", deep: "#3f8fe0", outline: "#08162f" },
  victory: { top: "#fffbd0", mid: "#ffe061", deep: "#e8941a", outline: "#3b1f00" },
  defeat: { top: "#ff8f8f", mid: "#d93a48", deep: "#7c1020", outline: "#1f0409" },
};

type FrameKey = "win" | "gold" | "red" | "blue";
const BANNER_FRAME: Record<BannerKind, FrameKey> = { turn: "gold", enemy: "red", initiative: "blue", victory: "gold", defeat: "red" };

const PX = {
  ink: "#f4ecd0",
  muted: "#98a5d8",
  gold: ["#fff3ad", "#ffc72a"] as const,
  good: ["#c2ffd2", "#59dd82"] as const,
  bad: ["#ffb0a4", "#ff5a4a"] as const,
  dark: "#05061a",
  shade: "rgba(5, 6, 26, 0.6)",
};

const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif';
// Georgia's figures are old-style (a 4 sinks below the line), which reads oddly
// on a damage number, so numerals prefer the serifs whose figures are lining.
const SERIF_NUM = '"Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", Georgia, serif';

// ---- pure helpers (unit tested) --------------------------------------------

export interface RecentFloat {
  x: number;
  y: number;
  t: number;
  n: number;
  /** How high above the anchor the top of this float's inked glyphs reaches, in px. Absent counts as 0. */
  top?: number;
}

/**
 * How many floats already stand on this spot within the stacking window: 0 for
 * a lone float, otherwise one more than the highest rung in use, so numbers
 * landing together climb instead of overprinting each other.
 */
export function floatStackIndex(recent: readonly RecentFloat[], at: OverlayPoint, now: number, radius = 28): number {
  let top = -1;
  for (const r of recent) {
    if (now - r.t >= FLOAT_STACK_MS) continue;
    if (Math.hypot(r.x - at.x, r.y - at.y) >= radius) continue;
    top = Math.max(top, r.n);
  }
  return top + 1;
}

/**
 * How high above the anchor the tallest float already stacked on this spot
 * reaches, in px of ink (0 for a lone float). The next float stands its own
 * glyphs a gap above this, so a number landing on a number clears the pile by
 * what is really stacked and not by its own height.
 */
export function floatStackTop(recent: readonly RecentFloat[], at: OverlayPoint, now: number, radius = 28): number {
  let top = 0;
  for (const r of recent) {
    if (now - r.t >= FLOAT_STACK_MS) continue;
    if (Math.hypot(r.x - at.x, r.y - at.y) >= radius) continue;
    top = Math.max(top, r.top ?? 0);
  }
  return top;
}

/**
 * How far above its natural spot (FLOAT_BASE_PX over the anchor) a float's box
 * must stand for its inked glyphs to clear a stack reaching `stackTop`. `padBottom`
 * is the empty margin under the glyphs inside the box.
 */
export function floatLift(stackTop: number, padBottom: number): number {
  return stackTop > 0 ? Math.max(0, stackTop + FLOAT_GAP_PX - FLOAT_BASE_PX - padBottom) : 0;
}

/** Size tier from the host's width: phones, in between, wide. */
export function sizeTier(width: number): "s" | "m" | "l" {
  return width < 520 ? "s" : width < 900 ? "m" : "l";
}

/** The game's own wording for a roll's verdict (LivingTable.tsx RollReadoutOverlay). */
export function verdictWords(r: Pick<PlateReadout, "hit" | "critical" | "fumble">): string {
  return r.critical ? "NATURAL 20, CRITICAL HIT" : r.fumble ? "NATURAL 1, AUTOMATIC MISS" : r.hit ? "HIT" : "MISS";
}

/** How long a finished narration box stays up for reading: about 2.5 s plus 45 ms a character, never more than 12 s. */
export function narrationHoldMs(chars: number): number {
  return Math.min(NARRATION_MAX_MS, NARRATION_BASE_MS + NARRATION_PER_CHAR_MS * Math.max(0, chars));
}

/**
 * How long a story-strip line stays up before it fades: about 3.5 s plus 40 ms a character, never more than 9 s. Under reduced
 * motion (`still`) it is half as long again, up to 13.5 s, but it still clears.
 */
export function stripHoldMs(chars: number, still = false): number {
  const ms = Math.min(STRIP_MAX_MS, STRIP_BASE_MS + STRIP_PER_CHAR_MS * Math.max(0, chars));
  return still ? Math.min(STRIP_REDUCED_MAX_MS, Math.round(ms * STRIP_REDUCED_FACTOR)) : ms;
}

/** How many story lines the board shows at once: two, or one on a phone-width board while the DM narration is up. */
export function stripMaxLines(size: "s" | "m" | "l", narrating: boolean): number {
  return size === "s" && narrating ? 1 : STRIP_MAX_LINES;
}

/**
 * Which story lines must fade now so no more than `max` stay. `sticky` is per visible line, oldest first. The oldest go first, and a
 * kept (sticky) line outlasts an ordinary one. Returns indices into `sticky`, ascending.
 */
export function stripOverflow(sticky: readonly boolean[], max: number): number[] {
  let excess = sticky.length - Math.max(0, max);
  if (excess <= 0) return [];
  const drop: number[] = [];
  for (let i = 0; i < sticky.length && excess > 0; i++) {
    if (sticky[i]) continue;
    drop.push(i);
    excess--;
  }
  for (let i = 0; i < sticky.length && excess > 0; i++) {
    if (!sticky[i]) continue;
    drop.push(i);
    excess--;
  }
  return drop.sort((a, b) => a - b);
}

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

/** The widest a context menu grows, in CSS px. */
export const MENU_MAX_WIDTH = 272;
/** The least air kept between a menu and the edge of the board. */
export const MENU_MARGIN = 6;
/** A context menu ignores presses this soon after it opens (the finger lifting after a long press). */
export const MENU_GRACE_MS = 300;
/** How long a loot window shows "Nothing left." before it closes itself. */
export const LOOT_EMPTY_MS = 1200;

/** The width a context menu gets on a board `boardWidth` wide: the usual maximum, less the margins on a narrow board. */
export function menuWidth(boardWidth: number): number {
  return Math.max(140, Math.min(MENU_MAX_WIDTH, boardWidth - 16));
}

export interface MenuPlacement {
  left: number;
  top: number;
  /** The menu opened to the left of the point (no room on the right). */
  flipX: boolean;
  /** The menu opened above the point (no room below). */
  flipY: boolean;
  /** The tallest it may be: the board's height less the margins. Taller content scrolls. */
  maxHeight: number;
}

/**
 * Where a menu of `size` goes for a click at `at`, inside a board of `board` (all CSS px from the board's top-left): its top-left
 * corner on the point; when it would run past the right or the bottom edge it opens to the left of or above the point instead
 * (the point stays on a corner); and when it fits neither way it is clamped inside the board less `margin`. A menu bigger than the
 * board is pinned to the near edge.
 */
export function menuPlacement(at: OverlayPoint, size: { width: number; height: number }, board: { width: number; height: number }, margin = MENU_MARGIN): MenuPlacement {
  const maxHeight = Math.max(0, board.height - margin * 2);
  const h = Math.min(size.height, maxHeight);
  const span = (start: number, len: number, total: number): { pos: number; flip: boolean } => {
    const lo = margin;
    const hi = total - margin - len;
    if (hi < lo) return { pos: lo, flip: false };
    if (start + len <= total - margin) return { pos: Math.max(lo, start), flip: false };
    const back = start - len;
    if (back >= lo) return { pos: Math.min(hi, back), flip: true };
    return { pos: clamp(start, lo, hi), flip: false };
  };
  const x = span(at.x, size.width, board.width);
  const y = span(at.y, h, board.height);
  return { left: x.pos, top: y.pos, flipX: x.flip, flipY: y.flip, maxHeight };
}

/** The words a screen reader gets for a menu entry: its label, why it is offered, and the reason it is unavailable. */
export function menuEntryName(e: Pick<ContextMenuEntry, "label" | "why" | "enabled" | "reason">): string {
  return [e.label, e.why, !e.enabled && e.reason ? `unavailable: ${e.reason}` : ""].filter(Boolean).join(", ");
}

/** The entries a menu really shows: the ones with an id and a label (the rest are dropped), in their order. */
export function menuEntries(entries: readonly ContextMenuEntry[]): ContextMenuEntry[] {
  return entries.filter((e) => e.id && e.label.trim() !== "").map((e) => ({ ...e, label: e.label.replace(/\s+/g, " ").trim() }));
}

// ---- the adventure screens: pure helpers (unit tested) -----------------------

/** The longest premise the box takes. */
export const PREMISE_MAX = 1000;
/** The longest summary a card prints before it is cut at a sentence. */
export const CARD_SUMMARY_MAX = 260;
/** The longest hook a hero card prints. */
export const HOOK_MAX = 320;
/** The most problems a card lists before "and N more". */
export const PROBLEMS_SHOWN = 4;
/** How long a location or scene card stays: this plus 45 ms a character, never more than LOCATION_MAX_MS. */
export const LOCATION_BASE_MS = 3500;
export const LOCATION_MAX_MS = 14000;
/** The most recent beats the journal prints. */
export const JOURNAL_RECENT_MAX = 5;

/** "Draft: 3 items marked for review"; empty when there is nothing marked. */
export function draftNote(marks: number | undefined): string {
  const n = Math.max(0, Math.floor(Number.isFinite(marks) ? (marks as number) : 0));
  if (n === 0) return "";
  return `Draft: ${n} ${n === 1 ? "item" : "items"} marked for review`;
}

/** The author badge words. */
export function authorBadge(author: "owner" | "ai"): string {
  return author === "ai" ? "AI written" : "Hand written";
}

/** A card as the start screen draws it: tidied, and whether it can be played. */
export interface StartCard {
  id: string;
  title: string;
  summary: string;
  author: "owner" | "ai";
  draftMarks: number;
  problems: string[];
  playable: boolean;
}

function tidy(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The adventure cards the start screen shows: entries without an id or a title are dropped, a repeated id keeps its first card, words are
 * tidied (runs of blanks become one space), the draft count is a whole number of at least 0, blank problems are dropped, and a card
 * with any problem left is not playable.
 */
export function startCards(list: readonly StartAdventure[]): StartCard[] {
  const seen = new Set<string>();
  const out: StartCard[] = [];
  for (const a of list) {
    const id = (a.id ?? "").trim();
    const title = tidy(a.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const problems = (a.problems ?? []).map(tidy).filter(Boolean);
    const marks = Math.max(0, Math.floor(Number.isFinite(a.draftMarks) ? (a.draftMarks as number) : 0));
    out.push({ id, title, summary: tidy(a.summary), author: a.author === "ai" ? "ai" : "owner", draftMarks: marks, problems, playable: problems.length === 0 });
  }
  return out;
}

/** The test rooms the start screen shows: the ones with an id and a title, words tidied. */
export function startRooms(list: readonly StartRoom[]): StartRoom[] {
  const seen = new Set<string>();
  const out: StartRoom[] = [];
  for (const r of list) {
    const id = (r.id ?? "").trim();
    const title = tidy(r.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, summary: tidy(r.summary) });
  }
  return out;
}

/**
 * A long blurb cut for a card: whole when it is at most `max` characters, otherwise cut after the last sentence that ends within `max`
 * (so a card never ends mid-thought), or at a word with ".." when the first sentence alone is longer than that.
 */
export function excerpt(text: string, max = CARD_SUMMARY_MAX): string {
  const words = tidy(text);
  if (words.length <= max) return words;
  const head = words.slice(0, max);
  const stops = [head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? ")];
  const stop = Math.max(...stops);
  if (stop >= Math.floor(max * 0.4)) return head.slice(0, stop + 1);
  const sp = head.lastIndexOf(" ");
  return `${(sp > 0 ? head.slice(0, sp) : head).replace(/[.,;:!?\s]+$/, "")}..`;
}

/** The lines a card lists for a file that does not validate: the first few, then "and N more". */
export function problemLines(problems: readonly string[], shown = PROBLEMS_SHOWN): string[] {
  const list = problems.map(tidy).filter(Boolean);
  if (list.length <= shown) return list;
  const rest = list.length - shown;
  return [...list.slice(0, shown), `and ${rest} more`];
}

/** The premise can be sent: it has words in it. */
export function premiseReady(premise: string): boolean {
  return tidy(premise).length > 0;
}

/** Where the "Write a new adventure with AI" card is: shut, the premise form, the confirm question, or writing. */
export type WriteStage = "closed" | "form" | "confirm" | "writing";
export type WriteEvent = "open" | "write" | "yes" | "back" | "busy" | "idle";

/**
 * The AI card's steps. open shows the form; write asks to confirm (only with a premise); yes starts it (fire: true, once: the
 * stage is "writing" at once, so a double press cannot send twice); back steps out (confirm to the form, the form to shut, and
 * nothing while writing); busy (the host says it is writing) and idle (it stopped) move to and from "writing".
 */
export function nextWriteStage(stage: WriteStage, event: WriteEvent, premise: string): { stage: WriteStage; fire: boolean } {
  const stay = { stage, fire: false };
  switch (event) {
    case "open":
      return stage === "closed" ? { stage: "form", fire: false } : stay;
    case "write":
      return stage === "form" && premiseReady(premise) ? { stage: "confirm", fire: false } : stay;
    case "yes":
      return stage === "confirm" && premiseReady(premise) ? { stage: "writing", fire: true } : stay;
    case "back":
      return stage === "confirm" ? { stage: "form", fire: false } : stage === "form" ? { stage: "closed", fire: false } : stay;
    case "busy":
      return { stage: "writing", fire: false };
    case "idle":
      return stage === "writing" ? { stage: "form", fire: false } : stay;
  }
}

/** The progress words: what the host said, or a plain default. */
export function writingLine(stage: string | undefined): string {
  return tidy(stage) || "Starting the writer";
}

/** The kicker over an ending's title. */
export function endingKicker(outcome: EndingOutcome): string {
  return outcome === "victory" ? "Victory" : outcome === "defeat" ? "Defeat" : "The story goes on";
}

/** The banner colour an ending's title takes. */
export function endingBannerKind(outcome: EndingOutcome): BannerKind {
  return outcome === "victory" ? "victory" : outcome === "defeat" ? "defeat" : "initiative";
}

/** The buttons of an ending, in order: Continue only when the host gave a way to continue. */
export function endingChoices(canContinue: boolean): ("continue" | "menu")[] {
  return canContinue ? ["continue", "menu"] : ["menu"];
}

/** How long a location or scene card stays up: 3.5 s plus 45 ms a character, never more than 14 s. No text means just the title: 3 s. */
export function locationHoldMs(chars: number): number {
  if (chars <= 0) return 3000;
  return Math.min(LOCATION_MAX_MS, LOCATION_BASE_MS + NARRATION_PER_CHAR_MS * chars);
}

/**
 * A title on one or two lines: the whole thing when it is one word or `oneLine` says it fits, otherwise cut at the space that
 * leaves the two lines closest in length.
 */
export function titleLines(text: string, oneLine: boolean): string[] {
  const words = tidy(text);
  if (oneLine || !words.includes(" ")) return [words];
  const parts = words.split(" ");
  let best = 1;
  let gap = Infinity;
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(" ").length;
    const b = parts.slice(i).join(" ").length;
    if (Math.abs(a - b) < gap) {
      gap = Math.abs(a - b);
      best = i;
    }
  }
  return [parts.slice(0, best).join(" "), parts.slice(best).join(" ")];
}

/** How many columns the HUD's drawer tabs take: one each up to three, two columns of two when there are four (their labels need the room). */
export function drawerColumns(count: number): number {
  return count <= 3 ? Math.max(1, count) : 2;
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

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- DOM helpers ------------------------------------------------------------

const SVGNS = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The device pixel ratio now, read each time so a zoom or a move to another screen is honoured. */
function deviceRatio(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of a line of serif text, for sizing an SVG numeral. Falls back to a rough estimate when there is no canvas. */
function serifWidth(text: string, px: number, weight = 800): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = `${weight} ${px}px ${SERIF_NUM}`;
    return measureCtx.measureText(text).width;
  }
  return text.length * px * 0.62;
}

// ---- the pixel windows: nine-slice frames drawn from data -------------------
//
// One 16x16 image per colour scheme, cut at 5 px, used as a border-image with
// the middle filled. The corner is the art; edges and middle repeat its last
// column and row. "o" outline, "L" light edge, "M" mid edge, "F" fill, "." clear.

const FRAME_CORNER = ["..ooo", ".oLLL", "oLMMM", "oLMFF", "oLMFF"];
const FRAME_SLICE = 5;
const FRAME_PX = 16;

const FRAMES: Record<FrameKey, { o: string; L: string; M: string; F: string }> = {
  win: { o: "#05061a", L: "#e6dcb4", M: "#4d5da6", F: "#141a3c" },
  gold: { o: "#1a0f00", L: "#ffe27a", M: "#b8801a", F: "#221a3a" },
  red: { o: "#1a0408", L: "#ffb4a8", M: "#b3281f", F: "#2a1226" },
  blue: { o: "#04102a", L: "#d2ecff", M: "#4a8fd8", F: "#122244" },
};

const frameUrls = new Map<FrameKey, string>();

function frameUrl(key: FrameKey): string | null {
  const cached = frameUrls.get(key);
  if (cached) return cached;
  try {
    const pal = FRAMES[key];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = FRAME_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (let y = 0; y < FRAME_PX; y++) {
      for (let x = 0; x < FRAME_PX; x++) {
        const cx = x < FRAME_SLICE ? x : x >= FRAME_PX - FRAME_SLICE ? FRAME_PX - 1 - x : FRAME_SLICE - 1;
        const cy = y < FRAME_SLICE ? y : y >= FRAME_PX - FRAME_SLICE ? FRAME_PX - 1 - y : FRAME_SLICE - 1;
        const code = (FRAME_CORNER[cy] ?? "")[cx];
        if (!code || code === ".") continue;
        ctx.fillStyle = pal[code as "o" | "L" | "M" | "F"];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const url = canvas.toDataURL("image/png");
    frameUrls.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/** A tiny sprite from character art: each character maps to a colour, "." is clear. */
function spriteCanvas(rows: readonly string[], colors: Record<string, string>, scale: number): HTMLCanvasElement {
  const dpr = deviceRatio();
  const k = deviceScale(scale, dpr);
  const w = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement("canvas");
  canvas.width = w * k;
  canvas.height = rows.length * k;
  canvas.style.width = `${(w * k) / dpr}px`;
  canvas.style.height = `${(rows.length * k) / dpr}px`;
  canvas.style.imageRendering = "pixelated";
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  if (ctx) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = colors[row[x] as string];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * k, y * k, k, k);
      }
    });
  }
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}

const CARET_DOWN = ["ooooooooo", "oCCCCCCCo", ".oCCCCCo.", "..oCCCo..", "...oCo...", "....o...."];

// ---- styles -----------------------------------------------------------------

const STYLE_ID = "lto-style";

const CSS = `
.lto-root{--lto-serif:${SERIF};--lto-num:${SERIF_NUM};
  --sb-paper:#f6edd6;--sb-paper2:#e8d8b0;--sb-ink:#2a2016;--sb-muted:#6a5a3f;--sb-rule:#7c5c1e;--sb-gold:#cf9f3b;--sb-shade:46 28 8;
  --sb-good:#2a6a33;--sb-bad:#a5281c;--sb-spk:#8a5208;--sb-badge:#251b30;--sb-badge-ink:#ffd86b;--sb-focus:var(--bn-focus,#1d63e0);
  --sb-hero:#2a5db0;--sb-hero-deep:#1d3f7a;--sb-enemy:#a5281c;--sb-enemy-deep:#7a1c14;
  position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:40;--fs:2;--lto-lines:3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lto-root{
  --sb-paper:#25203a;--sb-paper2:#181526;--sb-ink:#f3e9cf;--sb-muted:#b6ab90;--sb-rule:#c79d45;--sb-gold:#e6bf5e;--sb-shade:0 0 0;
  --sb-good:#86e096;--sb-bad:#ff8c7a;--sb-spk:#ffd27a;--sb-badge:#0f0c18;--sb-hero:#7fb0ff;--sb-enemy:#ff8c7a}}
:root[data-theme="dark"] .lto-root{
  --sb-paper:#25203a;--sb-paper2:#181526;--sb-ink:#f3e9cf;--sb-muted:#b6ab90;--sb-rule:#c79d45;--sb-gold:#e6bf5e;--sb-shade:0 0 0;
  --sb-good:#86e096;--sb-bad:#ff8c7a;--sb-spk:#ffd27a;--sb-badge:#0f0c18;--sb-hero:#7fb0ff;--sb-enemy:#ff8c7a}
.lto-root[data-size="s"]{--fs:1;--lto-lines:2}
.lto-root *,.lto-root *::before,.lto-root *::after{box-sizing:border-box}
.lto-root [hidden]{display:none!important}
.lto-layer{position:absolute;inset:0;pointer-events:none}
.lto-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lto-top{position:absolute;left:8px;right:8px;top:8px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
.lto-bottom{position:absolute;left:8px;right:8px;bottom:8px;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.lto-narr-host{display:flex;flex-direction:column;align-items:center;width:100%;min-width:0;pointer-events:none}
.lto-narr-host:not(:empty){margin-bottom:6px}
.lto-banners{position:absolute;left:0;right:0;top:48px;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.lto-float{position:absolute;transform:translate(-50%,-100%);pointer-events:none;white-space:nowrap;will-change:transform,opacity}
.lto-float-in{transform-origin:50% 100%}
.lto-num{display:block;overflow:visible;filter:drop-shadow(0 3px 5px rgb(0 0 0/.6))}
.lto-num text{font-family:var(--lto-num);font-weight:800;stroke-linejoin:round}
.lto-plate-pos{position:absolute;pointer-events:none;max-width:calc(100% - 16px);transition:top .16s ease-out}

/* ---- pixel: the nine-slice windows ---- */
.lto-fr{--frame:var(--fr-win);border:calc(5px*var(--fs)) solid #05061a;border-image:var(--frame) 5 fill/calc(5px*var(--fs))/0 stretch;image-rendering:pixelated;background:#141a3c;color:#f4ecd0}
.lto-fr.fr-gold{--frame:var(--fr-gold)}.lto-fr.fr-red{--frame:var(--fr-red)}.lto-fr.fr-blue{--frame:var(--fr-blue)}
.lto-fr.fs1{border-width:5px;border-image-width:5px}
.lto-px canvas{image-rendering:pixelated}
.lto-px .lto-init{position:relative;display:flex;align-items:flex-start;gap:4px;max-width:100%;overflow-x:auto;overflow-y:hidden;pointer-events:auto;scrollbar-width:none;padding:4px 4px 10px}
.lto-px .lto-init::-webkit-scrollbar{display:none}
.lto-px .lto-chip{display:flex;align-items:center;gap:6px;padding:0 3px;flex:none;position:relative}
.lto-px .lto-chip.is-active{transform:translateY(1px)}
.lto-px .lto-chip[data-side].is-active{box-shadow:0 0 0 2px #ffe27a,0 0 0 4px #1a0f00}
.lto-px .lto-chip .lto-caret{position:absolute;left:50%;bottom:-17px;transform:translateX(-50%)}
.lto-px .lto-round{flex:none;padding:0 3px;display:flex;align-items:center}
.lto-px .lto-toast{padding:0 3px}
.lto-px .lto-dlg{width:min(760px,100%);padding:0 2px;pointer-events:auto;cursor:pointer;transform-origin:50% 100%}
.lto-px .lto-dlg-scroll{max-height:calc(var(--lto-lines)*var(--lto-row,20px));overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#4d5da6 #05061a}
.lto-px .lto-line{overflow:hidden}
.lto-px .lto-roll{padding:2px 4px;display:flex;flex-direction:column;align-items:center;gap:5px}
.lto-px .lto-math{display:flex;align-items:flex-end;gap:12px}
.lto-px .lto-math.is-tight{gap:6px}
.lto-px .lto-math.is-wrap{flex-wrap:wrap;justify-content:center;row-gap:6px}
.lto-px .lto-cell{display:flex;flex-direction:column;align-items:center;gap:5px}
.lto-px .lto-op{padding-bottom:6px}
.lto-px .lto-srcs{display:flex;flex-direction:column;align-items:center;gap:2px}
.lto-px .lto-tail{position:absolute;transform:translateX(-50%)}
.lto-px .lto-banner{padding:2px 8px}

/* ---- storybook: parchment and ink, a rulebook ---- */
.lto-sb{font-family:var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-plate{background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));color:var(--sb-ink);border-radius:9px;border:1px solid var(--sb-rule);
  box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-t2{font-weight:700;letter-spacing:.05em;text-transform:uppercase;paint-order:stroke fill;-webkit-text-stroke:.6px rgb(0 0 0/.7);text-shadow:0 1px 0 rgb(0 0 0/.5),0 2px 4px rgb(var(--sb-shade)/.7)}
.lto-sb .lto-init{position:relative;display:flex;align-items:center;gap:6px;max-width:100%;overflow-x:auto;overflow-y:hidden;pointer-events:auto;scrollbar-width:none;padding:2px 2px 12px}
.lto-sb .lto-init::-webkit-scrollbar{display:none}
.lto-sb .lto-round,.lto-sb .lto-chip,.lto-sb .lto-verdict,.lto-sb .lto-toast{font-family:var(--lto-num)}
.lto-sb .lto-round{flex:none;padding:4px 10px;border-radius:999px;background:var(--sb-badge);color:var(--sb-badge-ink);font-size:11px;border:1px solid var(--sb-gold);box-shadow:0 2px 6px rgb(0 0 0/.4)}
.lto-sb .lto-chip{position:relative;flex:none;display:flex;align-items:center;gap:7px;padding:3px 4px 3px 11px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.02em}
.lto-sb .lto-chip.is-active{transform:scale(1.08);box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 0 3px var(--sb-gold),0 6px 14px rgb(0 0 0/.5),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-chip[data-side="hero"]{--side:var(--sb-hero);--side-deep:var(--sb-hero-deep)}
.lto-sb .lto-chip[data-side="enemy"]{--side:var(--sb-enemy);--side-deep:var(--sb-enemy-deep)}
.lto-sb .lto-chip[data-side]{color:var(--side);border-color:var(--side);box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--side)}
.lto-sb .lto-chip[data-side] .lto-badge{background:var(--side-deep)}
.lto-sb .lto-chip[data-side].is-active{box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 0 3px var(--sb-gold),0 6px 14px rgb(0 0 0/.5),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--side)}
.lto-sb .lto-chip.is-active::after{content:"";position:absolute;left:50%;bottom:-9px;width:9px;height:9px;transform:translateX(-50%) rotate(45deg);background:var(--sb-gold);border:1px solid rgb(var(--sb-shade)/.7);border-top:0;border-left:0}
.lto-sb .lto-badge{min-width:26px;height:26px;padding:0 5px;border-radius:999px;display:grid;place-items:center;background:var(--sb-badge);color:var(--sb-badge-ink);font:800 15px/1 var(--lto-num);
  paint-order:stroke fill;-webkit-text-stroke:.6px rgb(0 0 0/.7);text-shadow:0 1px 0 rgb(0 0 0/.5),0 2px 4px rgb(0 0 0/.5);font-variant-numeric:lining-nums tabular-nums}
.lto-sb .lto-toast{padding:6px 14px;font-size:14px;font-weight:700;border-radius:999px;border-color:var(--sb-bad);
  box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-bad)}
.lto-sb .lto-dlg{width:min(760px,100%);padding:6px 12px 6px 14px;pointer-events:auto;border-radius:10px;cursor:pointer;transform-origin:50% 100%}
.lto-sb .lto-dlg-scroll{max-height:calc(var(--lto-lines)*1.4em);font-size:15px;line-height:1.4;overflow-y:auto;overflow-x:hidden;padding-right:6px;scrollbar-width:thin;scrollbar-color:var(--sb-rule) transparent}
.lto-sb .lto-line{color:var(--sb-ink);overflow-wrap:anywhere;overflow:hidden}
.lto-sb .lto-line b{color:var(--sb-spk);font-variant:small-caps;letter-spacing:.06em;margin-right:.4em}
.lto-sb .lto-line[data-tone="good"]{color:var(--sb-good)}.lto-sb .lto-line[data-tone="bad"]{color:var(--sb-bad)}
.lto-sb .lto-roll{padding:9px 14px 10px;display:flex;flex-direction:column;align-items:center;gap:6px;max-width:100%}
.lto-sb .lto-plate.is-crit{box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 22px rgb(255 200 70/.6),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px #f0b52c}
.lto-sb .lto-cap{font-size:12px;font-style:italic;color:var(--sb-muted)}
.lto-sb .lto-math{display:flex;align-items:flex-end;gap:10px}
.lto-sb .lto-cell{display:flex;flex-direction:column;align-items:center;gap:1px}
.lto-sb .lto-cell b{font:800 30px/1 var(--lto-num);font-variant-numeric:lining-nums;text-shadow:0 1px 0 rgb(255 255 255/.5)}
.lto-sb .lto-cell.strong b{color:var(--sb-spk)}
.lto-sb .lto-cell i{font-size:11px;color:var(--sb-muted)}
.lto-sb .lto-op{font:700 18px/1 var(--lto-serif);color:var(--sb-muted);padding-bottom:13px}
.lto-sb .lto-srcs{display:flex;flex-wrap:wrap;justify-content:center;gap:2px 12px;font-size:12px;color:var(--sb-muted)}
.lto-sb .lto-verdict{padding:3px 14px 4px;border-radius:999px;font-size:13px;color:#fff}
.lto-sb .lto-verdict.hit{background:linear-gradient(#4cb862,#2a7a3a)}.lto-sb .lto-verdict.miss{background:linear-gradient(#c65a4c,#8a2a20)}.lto-sb .lto-verdict.crit{background:linear-gradient(#f5c64c,#b8790f)}
.lto-sb .lto-tail{position:absolute;width:13px;height:13px;transform:translateX(-50%) rotate(45deg);background:var(--sb-paper2);border:1px solid var(--sb-rule)}
.lto-sb .lto-tail.down{bottom:-7px;border-top:0;border-left:0}.lto-sb .lto-tail.up{top:-7px;border-bottom:0;border-right:0;background:var(--sb-paper)}
.lto-sb .lto-banner{position:relative;width:auto;padding:4px 36px 5px;display:flex;justify-content:center;
  background:linear-gradient(90deg,transparent 0,rgb(12 8 22/.8) 14%,rgb(12 8 22/.88) 50%,rgb(12 8 22/.8) 86%,transparent 100%)}
.lto-sb .lto-banner::before,.lto-sb .lto-banner::after{content:"";position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#d9ae4a 20%,#ffe9a0 50%,#d9ae4a 80%,transparent)}
.lto-sb .lto-banner::before{top:0}.lto-sb .lto-banner::after{bottom:0}
.lto-sb .lto-dlg:focus-visible,.lto-px .lto-dlg:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}

/* ---- the DM's narration box: a tag, then the framed text ---- */
.lto-narr{--nl:5;display:flex;flex-direction:column;width:min(760px,100%);min-width:0;pointer-events:auto;cursor:pointer;touch-action:manipulation}
.lto-root[data-size="s"] .lto-narr{--nl:4}
.lto-narr:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-narr-tag{position:relative;z-index:1;align-self:flex-start;margin-left:12px;width:max-content;max-width:calc(100% - 24px);overflow:hidden}
.lto-narr-box{min-width:0}
.lto-narr-body{overflow-y:auto;overflow-x:hidden;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-gutter:stable}
.lto-root:not([data-size="s"]) .lto-narr[data-full] .lto-narr-body{max-height:none;overflow:visible}
.lto-narr-dots{display:flex;align-items:center;gap:6px}
.lto-narr-dots i{display:block;width:6px;height:6px;background:currentColor;animation:lto-narr-dot 1.1s ease-in-out infinite}
.lto-narr-dots i:nth-child(2){animation-delay:.18s}.lto-narr-dots i:nth-child(3){animation-delay:.36s}
@keyframes lto-narr-dot{0%,75%,100%{opacity:.3;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
.lto-px .lto-narr-tag{margin-bottom:calc(-5px*var(--fs))}
.lto-px .lto-narr-box{padding:0 2px}
.lto-px .lto-narr-body{max-height:calc(var(--nl)*var(--lto-nrow,20px));scrollbar-color:#b8801a #05061a}
.lto-px .lto-narr-dots{height:var(--lto-nrow,20px);color:#ffc72a}
.lto-sb .lto-narr-tag{margin-bottom:-11px;padding:4px 11px;border-radius:999px;background:var(--sb-badge);color:var(--sb-badge-ink);border:1px solid var(--sb-gold);
  font:700 11px/1.1 var(--lto-num);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;text-overflow:ellipsis;box-shadow:0 2px 6px rgb(0 0 0/.4)}
.lto-sb .lto-narr-box{padding:14px 16px 10px 18px;border-radius:10px;border-left:4px solid var(--sb-gold)}
.lto-sb .lto-narr-body{max-height:calc(var(--nl)*1.45em);font:italic 15.5px/1.45 var(--lto-serif);color:var(--sb-ink);white-space:pre-wrap;scrollbar-color:var(--sb-rule) transparent}
.lto-sb .lto-narr-dots{height:1.45em;color:var(--sb-spk)}
.lto-sb .lto-narr-dots i{border-radius:50%}

/* ---- buttons, the context menu and the loot window (they take the pointer) ---- */
.lto-btn{appearance:none;font:inherit;color:inherit;margin:0;min-width:0;min-height:36px;padding:4px 12px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;pointer-events:auto}
.lto-btn:disabled{opacity:.45;cursor:default}
.lto-btn:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-btn canvas{display:block}
.lto-px .lto-btn.lto-fr{background:#141a3c}
.lto-px .lto-btn:not(:disabled):hover{--frame:var(--fr-blue)}
.lto-sb .lto-btn{border-radius:9px;background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));border:1px solid var(--sb-rule);box-shadow:inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold);font:700 14px/1 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-btn.is-pri{box-shadow:0 0 0 2px var(--sb-gold),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-root[data-size="s"] .lto-btn{min-height:44px}
@media (pointer: coarse){.lto-btn{min-height:44px}}
.lto-loot-host{position:absolute;left:0;right:0;top:0;display:flex;justify-content:center;pointer-events:none}
.lto-loot{display:flex;flex-direction:column;gap:6px;width:min(340px,calc(100% - 16px));min-height:0;padding:6px 8px;pointer-events:auto;margin-top:8px}
.lto-loot-title{padding:0 2px}
.lto-sb .lto-loot-title{font:700 12px/1.2 var(--lto-serif);letter-spacing:.07em;text-transform:uppercase;color:var(--sb-spk)}
.lto-loot-list{display:flex;flex-direction:column;gap:3px;min-height:0;padding:3px;margin:-3px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;overscroll-behavior:contain}
.lto-px .lto-loot-list{scrollbar-color:#4d5da6 #05061a}
.lto-sb .lto-loot-list{scrollbar-color:var(--sb-rule) transparent}
.lto-loot-row{flex:none;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:1px 2px;min-width:0}
.lto-loot-name{min-width:0;overflow-wrap:anywhere;padding:2px 2px;cursor:help;border-radius:3px}
.lto-loot-name:focus-visible{outline:2px solid var(--sb-focus);outline-offset:1px}
.lto-sb .lto-loot-name{font:15px/1.3 var(--lto-serif);color:var(--sb-ink)}
.lto-px .lto-loot-name[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(152 165 216/.28)}
.lto-sb .lto-loot-name[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(var(--sb-shade)/.18)}
.lto-loot-take{min-height:32px;padding:2px 10px}
.lto-root[data-size="s"] .lto-loot-take{min-height:44px}
@media (pointer: coarse){.lto-loot-take{min-height:44px}}
.lto-loot-empty{padding:4px 2px}
.lto-sb .lto-loot-empty{font:italic 14px/1.3 var(--lto-serif);color:var(--sb-muted)}
.lto-loot-foot{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.lto-root[data-size="s"] .lto-loot-foot{display:grid;grid-template-columns:1fr 1fr}
.lto-menu-layer{position:absolute;inset:0;pointer-events:none}
.lto-cm{position:absolute;display:flex;flex-direction:column;gap:1px;pointer-events:auto;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:3px;scrollbar-width:thin;touch-action:manipulation}
.lto-px .lto-cm.lto-fr{padding:3px}
.lto-cm-title{padding:3px 8px 4px}
.lto-sb .lto-cm-title{font:700 11px/1.2 var(--lto-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--sb-spk)}
.lto-cm-row{flex:none;display:grid;grid-template-columns:18px minmax(0,1fr);gap:8px;align-items:start;min-width:0;min-height:34px;padding:6px 8px;cursor:pointer;outline:0}
.lto-root[data-size="s"] .lto-cm-row{min-height:44px}
@media (pointer: coarse){.lto-cm-row{min-height:44px}}
.lto-cm-mark{display:grid;place-items:center;width:18px;height:18px}
.lto-cm-mark svg{display:block;width:14px;height:14px;fill:#ffc72a;stroke:#3b1f00;stroke-width:28px;paint-order:stroke fill;stroke-linejoin:round}
.lto-sb .lto-cm-mark svg{fill:#d99a1c}
.lto-cm-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.lto-cm-label canvas,.lto-cm-why canvas,.lto-cm-reason canvas{display:block}
.lto-cm-row[aria-disabled="true"]{cursor:default}
.lto-cm-row[aria-disabled="true"] .lto-cm-label{opacity:.55}
.lto-px .lto-cm-row:focus,.lto-px .lto-cm-row.is-hot{background:rgb(77 93 166/.5);box-shadow:inset 0 0 0 2px #ffc72a}
.lto-sb .lto-cm-row{border-radius:6px}
.lto-sb .lto-cm-row:focus,.lto-sb .lto-cm-row.is-hot{background:rgb(var(--sb-shade)/.14);box-shadow:inset 0 0 0 2px var(--sb-gold)}
.lto-sb .lto-cm-label{font:700 15px/1.25 var(--lto-serif);color:var(--sb-ink);overflow-wrap:anywhere}
.lto-sb .lto-cm-why{font:italic 12.5px/1.3 var(--lto-serif);color:var(--sb-muted);overflow-wrap:anywhere}
.lto-sb .lto-cm-reason{font:12.5px/1.3 var(--lto-serif);color:var(--sb-bad);overflow-wrap:anywhere}

/* ---- the adventure screens: start, hero, ending (they cover the whole board and take the pointer) ---- */
.lto-scr-layer{position:absolute;inset:0;pointer-events:none}
.lto-scr{position:absolute;inset:0;pointer-events:auto;display:flex;flex-direction:column;animation:lto-scr-in .22s ease-out}
@keyframes lto-scr-in{from{opacity:0}to{opacity:1}}
.lto-px .lto-scr{background:rgb(5 6 26/.94);color:#f4ecd0}
.lto-sb .lto-scr{background:rgb(var(--sb-shade)/.92)}
.lto-scr-scroll{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;padding:14px 12px 18px;overscroll-behavior:contain;scrollbar-width:thin}
.lto-px .lto-scr-scroll{scrollbar-color:#4d5da6 #05061a}
.lto-sb .lto-scr-scroll{scrollbar-color:var(--sb-rule) transparent}
.lto-scr-body{margin:auto;width:min(720px,100%);display:flex;flex-direction:column;gap:14px;min-width:0}
.lto-scr-title{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;text-align:center}
.lto-scr-title .lto-num{margin:-4px 0}
.lto-scr-sec{padding:0 2px;min-width:0}
.lto-sb .lto-scr-sec{font:700 12px/1.2 var(--lto-serif);letter-spacing:.12em;text-transform:uppercase;color:#ffd86b;text-shadow:0 1px 2px rgb(0 0 0/.6)}
.lto-sb .lto-scr-sub{font:italic 15px/1.35 var(--lto-serif);color:#eadfc2;text-shadow:0 1px 2px rgb(0 0 0/.6)}
.lto-st{min-width:0;overflow-wrap:anywhere}
.lto-st.is-center{display:flex;justify-content:center;text-align:center}
.lto-st canvas{display:block}
.lto-card-list{display:flex;flex-direction:column;gap:10px;min-width:0}
.lto-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}
.lto-root[data-size="s"] .lto-card-grid{grid-template-columns:minmax(0,1fr)}
.lto-card{appearance:none;font:inherit;color:inherit;text-align:left;margin:0;width:100%;min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:9px 11px;cursor:pointer;touch-action:manipulation;pointer-events:auto;position:relative}
.lto-card>*{min-width:0}
.lto-card[aria-disabled="true"]{cursor:default}
.lto-card:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-px .lto-card:focus-visible{outline-color:#ffc72a}
.lto-px .lto-card.lto-fr{padding:6px 8px}
.lto-px .lto-card.lto-fr.is-compact{padding:2px 4px}
.lto-px .lto-card:not([aria-disabled="true"]):hover{--frame:var(--fr-blue)}
.lto-sb .lto-card.is-compact{padding:7px 10px}
.lto-sb .lto-card:not([aria-disabled="true"]):hover{box-shadow:0 0 0 2px var(--sb-gold),0 4px 12px rgb(0 0 0/.35),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-card.is-bad{border-color:var(--sb-bad)}
.lto-sb .lto-card-title{font:700 18px/1.2 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-card.is-compact .lto-card-title{font-size:15px}
.lto-sb .lto-card-text{font:14.5px/1.4 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-card-quiet{font:13px/1.35 var(--lto-serif);color:var(--sb-muted)}
.lto-sb .lto-card-hook{font:italic 14.5px/1.4 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-card-draft{font:700 13px/1.3 var(--lto-serif);color:var(--sb-spk)}
.lto-sb .lto-card-bad{font:13.5px/1.35 var(--lto-serif);color:var(--sb-bad)}
.lto-sb .lto-card-badhead{font:700 13px/1.3 var(--lto-serif);color:var(--sb-bad)}
.lto-sb .lto-card-ask{font:700 14.5px/1.3 var(--lto-serif);color:var(--sb-spk)}
.lto-sb .lto-card.is-bad .lto-card-title{color:var(--sb-muted)}
.lto-card[data-ltoai]{gap:8px}
.lto-card-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px}
.lto-pill{display:inline-flex;align-items:center;padding:2px 9px;flex:none}
.lto-sb .lto-pill{border-radius:999px;font:700 11px/1.2 var(--lto-num);letter-spacing:.06em;text-transform:uppercase;background:var(--sb-badge);color:var(--sb-badge-ink);border:1px solid var(--sb-gold)}
.lto-sb .lto-pill[data-tone="ai"]{background:var(--sb-hero-deep);color:#e6f1ff;border-color:var(--sb-hero)}
.lto-px .lto-pill{padding:2px 5px;background:#2a2150;border:2px solid #05061a;box-shadow:inset 0 0 0 1px #8a6a1e}
.lto-px .lto-pill[data-tone="ai"]{background:#12306a;box-shadow:inset 0 0 0 1px #4a8fd8}
.lto-pill canvas{display:block}
.lto-play{display:inline-flex;align-items:center;gap:6px;margin-left:auto;flex:none}
.lto-sb .lto-play{font:700 13px/1 var(--lto-serif);letter-spacing:.06em;text-transform:uppercase;color:var(--sb-spk)}
.lto-sb .lto-play::after{content:"";width:0;height:0;border:5px solid transparent;border-left:8px solid currentColor;border-right:0}
.lto-play canvas{display:block}
.lto-sb .lto-card[data-ltoai]{border-style:dashed}
.lto-scr-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;min-width:0}
.lto-scr-actions.is-start{justify-content:flex-start}
.lto-root[data-size="s"] .lto-scr-actions{flex-direction:column;align-items:stretch}
.lto-root[data-size="s"] .lto-scr-actions.is-start{align-items:flex-start}
.lto-scr-actions .lto-btn{min-width:120px}
.lto-ta{appearance:none;display:block;width:100%;min-width:0;min-height:96px;margin:0;padding:8px 10px;resize:vertical;pointer-events:auto;font:16px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:inherit}
.lto-ta:disabled{opacity:.6;resize:none}
.lto-ta:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-px .lto-ta{color:#f4ecd0;background:#141a3c}
.lto-px .lto-ta.lto-fr{padding:2px 4px}
.lto-px .lto-ta::placeholder{color:#98a5d8;opacity:1}
.lto-px .lto-ta:focus-visible{outline-color:#ffc72a}
.lto-sb .lto-ta{font-family:var(--lto-serif);color:var(--sb-ink);background:var(--sb-paper);border:1px solid var(--sb-rule);border-radius:9px;box-shadow:inset 0 1px 3px rgb(var(--sb-shade)/.25)}
.lto-sb .lto-ta::placeholder{color:var(--sb-muted);opacity:1}
.lto-wprog{display:flex;align-items:center;gap:8px;min-width:0}
.lto-wdots{display:flex;align-items:center;gap:5px;flex:none;color:#ffc72a}
.lto-sb .lto-wdots{color:var(--sb-spk)}
.lto-wdots i{display:block;width:6px;height:6px;background:currentColor;animation:lto-narr-dot 1.1s ease-in-out infinite}
.lto-sb .lto-wdots i{border-radius:50%}
.lto-wdots i:nth-child(2){animation-delay:.18s}.lto-wdots i:nth-child(3){animation-delay:.36s}
.lto-wprog .lto-st{flex:1 1 auto}
.lto-card[data-ltoai]:focus{outline:none}
.lto-scr[data-busy="true"] .lto-card[data-lto-adventure],.lto-scr[data-busy="true"] .lto-card[data-lto-room]{opacity:.5}
.lto-endbox{display:flex;flex-direction:column;gap:10px;min-width:0}
.lto-px .lto-endbox .lto-narr-body,.lto-sb .lto-endbox .lto-narr-body{max-height:none;overflow:visible}
.lto-endbox .lto-narr-box{width:100%}
.lto-sb .lto-endbox .lto-narr-body{font-size:16.5px}
.lto-ribbon{width:100%;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;text-align:center}
.lto-px .lto-ribbon{padding:4px 8px}
.lto-sb .lto-ribbon .lto-num{margin:-3px 0}
.lto-cards{display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;min-width:0;pointer-events:none}
.lto-loc{--nl:6;width:min(600px,100%);gap:4px}
.lto-root[data-size="s"] .lto-loc{--nl:4}
.lto-loc .lto-narr-box{width:100%}
.lto-root:not([data-size="s"]) .lto-loc .lto-narr-body{max-height:none;overflow:visible}
.lto-px .lto-loc .lto-narr-box{padding:2px 5px}

@media (prefers-reduced-motion: reduce){.lto-root *{animation:none!important;transition:none!important}}
`;

function injectStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- the overlay ------------------------------------------------------------

interface Internals {
  host: HTMLElement;
  root: HTMLElement;
}
const internals = new WeakMap<Overlay, Internals>();
let uidCounter = 0;

export function createOverlay(host: HTMLElement, initialStyle: TextStyle): Overlay {
  injectStyle();
  const uid = String(++uidCounter);
  let style: TextStyle = initialStyle;
  let destroyed = false;
  let epoch = 0;
  let busy = 0;

  let restorePosition: string | null = null;
  const hostStyle = getComputedStyle(host);
  if (hostStyle.position === "static") {
    restorePosition = host.style.position;
    host.style.position = "relative";
  }
  if (/auto|scroll/.test(`${hostStyle.overflowX} ${hostStyle.overflowY}`)) {
    console.warn("overlay: the host scrolls, so banners and the dialogue box would scroll away with the board. Pass a non-scrolling wrapper that sits over it.");
  }

  // ---- scaffolding
  const root = el("div", "lto-root");
  root.dataset.ltoRoot = "";
  root.dataset.busy = "0";
  const defs = buildDefs(uid);
  const live = el("div", "lto-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "false");
  live.dataset.ltoLive = "";
  const platesLayer = el("div", "lto-layer");
  const floatsLayer = el("div", "lto-layer");
  const top = el("div", "lto-top");
  const initEl = el("div", "lto-init");
  initEl.dataset.ltoInitiative = "";
  initEl.hidden = true;
  initEl.setAttribute("role", "group");
  initEl.setAttribute("aria-label", "Turn order");
  const toasts = el("div", "lto-toasts");
  toasts.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px";
  top.append(initEl, toasts);
  const bottom = el("div", "lto-bottom");
  const dlg = el("div", "lto-dlg");
  dlg.dataset.ltoDialogue = "";
  dlg.hidden = true;
  dlg.tabIndex = 0;
  dlg.setAttribute("role", "group");
  dlg.setAttribute("aria-label", "Story, activate to dismiss");
  dlg.title = "Click to dismiss";
  const dlgScroll = el("div", "lto-dlg-scroll");
  dlg.append(dlgScroll);
  const narrHost = el("div", "lto-narr-host");
  bottom.append(narrHost, dlg);
  const bannersLayer = el("div", "lto-banners");
  // Stacking, bottom to top: the strip and toasts, the dialogue, roll plates (they cover the dialogue for
  // their two seconds rather than the other way round, so a verdict is never hidden), floats, banners.
  root.append(defs, live, top, bottom, platesLayer, floatsLayer, bannersLayer);
  host.appendChild(root);

  const frameVars = (): void => {
    for (const key of Object.keys(FRAMES) as FrameKey[]) {
      const url = frameUrl(key);
      if (url) root.style.setProperty(`--fr-${key}`, `url("${url}")`);
    }
  };
  frameVars();

  // ---- state
  /** The story strip: the lines on the board now, oldest first. A fading line stays in the list until it is gone. */
  interface StripEntry {
    line: DialogueLine;
    node: HTMLElement;
    fading: boolean;
    epoch: number;
  }
  const strip: StripEntry[] = [];
  /** The fade of the whole box, running while its last line leaves. */
  let boxFade: Animation | null = null;
  let initState: { entries: readonly InitiativeEntry[]; activeId: string | null; round: number } = { entries: [], activeId: null, round: 1 };
  let recent: RecentFloat[] = [];
  let tier: "s" | "m" | "l" = "l";
  let width = 0;

  // ---- time: every wait and animation is tracked so clear() can end them at once
  const waits = new Map<number, () => void>();
  const anims = new Set<Animation>();

  const reduced = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = window.setTimeout(() => {
        waits.delete(id);
        resolve();
      }, ms);
      waits.set(id, resolve);
    });
  }

  /** Start an animation; `anim` is the running one (null where there is no Web Animations API), `done` resolves when it ends or is cancelled. */
  function start(node: Element, frames: Keyframe[], ms: number, easing = "linear"): { anim: Animation | null; done: Promise<void> } {
    if (typeof node.animate !== "function") return { anim: null, done: wait(ms) };
    const anim = node.animate(frames, { duration: ms, easing, fill: "forwards" });
    anims.add(anim);
    const done = anim.finished.then(
      () => {
        anims.delete(anim);
      },
      () => {
        anims.delete(anim);
      },
    );
    return { anim, done };
  }

  function play(node: Element, frames: Keyframe[], ms: number, easing = "linear"): Promise<void> {
    return start(node, frames, ms, easing).done;
  }

  /** Count an animation in or out. A late finish from before a clear() must not touch the new count. */
  function setBusy(delta: number, forEpoch: number): void {
    if (forEpoch !== epoch) return;
    busy = Math.max(0, busy + delta);
    root.dataset.busy = String(busy);
  }

  function announce(text: string): void {
    const p = el("p", undefined, text);
    live.appendChild(p);
    while (live.childElementCount > 8) live.firstElementChild?.remove();
  }

  const isPixel = (): boolean => style === "pixel";

  const px = (input: string | readonly PixelRun[], opts: PixelTextOptions): HTMLCanvasElement => {
    const canvas = pixelText(input, { dpr: deviceRatio(), ...opts });
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  };

  const srText = (text: string): HTMLElement => el("span", "lto-sr", text);

  function frame(node: HTMLElement, key: FrameKey = "win", small = false): HTMLElement {
    node.classList.add("lto-fr", `fr-${key}`);
    if (small) node.classList.add("fs1");
    return node;
  }

  // ---- sizing
  function measure(): void {
    width = root.clientWidth;
    const next = sizeTier(width);
    root.dataset.size = next;
    const changed = next !== tier;
    tier = next;
    if (changed || isPixel()) scheduleRelayout();
  }
  let relayoutQueued = false;
  // Pixel text is drawn for one width and one device pixel ratio, so a change in either redraws it.
  const layoutKey = (): string => `${width}@${deviceRatio()}`;
  let lastLayoutKey = "";
  function scheduleRelayout(): void {
    if (relayoutQueued || layoutKey() === lastLayoutKey) return;
    relayoutQueued = true;
    const run = () => {
      relayoutQueued = false;
      if (destroyed) return;
      lastLayoutKey = layoutKey();
      renderDialogue();
      renderInitiative();
      if (narr && !narr.closed) renderNarration(narr);
      enforceStripMax();
      if (menu) renderMenu(menu);
      if (loot) renderLoot(loot);
      for (const c of arrivals) renderArrival(c);
      rebuildScreens();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else run();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  ro?.observe(root);

  function applyStyleClass(): void {
    root.classList.toggle("lto-px", style === "pixel");
    root.classList.toggle("lto-sb", style === "storybook");
    root.dataset.style = style;
  }

  // ---- floats

  /**
   * A float's node, its box height and the empty margins inside the box above and
   * below its inked glyphs, which is what stacking and the plates clear: the box of
   * a storybook numeral carries the outline's room and a descender's, a pixel
   * canvas is all ink.
   */
  function floatNode(text: string, kind: FloatKind): { node: HTMLElement; h: number; padTop: number; padBottom: number } {
    const node = el("div", "lto-float");
    node.dataset.ltoFloat = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    node.setAttribute("aria-hidden", "true");
    const inner = el("div", "lto-float-in");
    const face = FACES[kind];
    let h: number;
    let padTop = 0;
    let padBottom = 0;
    if (isPixel()) {
      const small = tier === "s";
      const scale = kind === "crit" ? (small ? 4 : 5) : kind === "miss" || kind === "info" ? (small ? 2 : 3) : small ? 3 : 4;
      const canvas = px(text, { scale, weight: "bold", color: [face.mid, face.deep], outline: face.outline, outlinePx: 1, shadow: PX.shade });
      inner.append(canvas);
      h = parseFloat(canvas.style.height);
    } else {
      const size = { damage: 36, crit: 52, heal: 36, miss: 26, down: 40, info: 26 }[kind] * (tier === "s" ? 0.86 : 1);
      inner.append(numeral(uid, kind, text, size));
      ({ h, padTop, padBottom } = numeralGeometry(size, serifWidth(text, size)));
    }
    node.append(inner);
    return { node, h, padTop, padBottom };
  }

  /** The ink of a float that is up, in host px, with its rise included: what a plate has to stay out of. */
  interface FloatInk {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
  const liveFloats = new Set<FloatInk>();

  /** How high above its anchor an ordinary damage number reaches at its highest, rise included: where a plate on the same point starts out of its way. */
  function damageReach(): number {
    const { h, padTop } = floatNode("-00", "damage");
    return FLOAT_BASE_PX + h - padTop + FLOAT_RISE_PX;
  }

  function float(at: OverlayPoint, text: string, kind: FloatKind): void {
    if (destroyed) return;
    const now = performance.now();
    recent = recent.filter((r) => now - r.t < FLOAT_STACK_MS);
    const rung = floatStackIndex(recent, at, now);
    const stackTop = floatStackTop(recent, at, now);

    const { node, padTop, padBottom } = floatNode(text, kind);
    node.dataset.rung = String(rung);
    floatsLayer.appendChild(node);
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const rootW = root.clientWidth || width;
    const x = clamp(at.x, w / 2 + 2, Math.max(w / 2 + 2, rootW - w / 2 - 2));
    // The node is lifted by its own height, so `top` is its bottom edge. A float landing on others stands its
    // glyphs clear of the highest of theirs; one on its own stands on the anchor.
    const bottom = Math.max(h + FLOAT_RISE_PX + 2, at.y - FLOAT_BASE_PX - floatLift(stackTop, padBottom));
    node.style.left = `${x}px`;
    node.style.top = `${bottom}px`;
    recent.push({ x: at.x, y: at.y, t: now, n: rung, top: at.y - bottom + h - padTop });
    const ink: FloatInk = { left: x - w / 2, right: x + w / 2, top: bottom - h + padTop - FLOAT_RISE_PX, bottom: bottom - padBottom };
    liveFloats.add(ink);
    for (const plate of livePlates) stepPlateUp(plate, ink);

    const base = "translate(-50%, -100%)";
    const still = reduced();
    const fadeAt = (FLOAT_MS - FLOAT_FADE_MS) / FLOAT_MS;
    const frames: Keyframe[] = still
      ? [{ opacity: 1 }, { opacity: 1, offset: fadeAt }, { opacity: 0 }]
      : [
          { transform: `${base} translateY(0)`, opacity: 1, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
          { transform: `${base} translateY(${-FLOAT_RISE_PX * 0.85}px)`, opacity: 1, offset: fadeAt },
          { transform: `${base} translateY(${-FLOAT_RISE_PX}px)`, opacity: 0 },
        ];
    const mine = epoch;
    setBusy(1, mine);
    const inner = node.firstElementChild as HTMLElement | null;
    if (inner && !still) {
      const pop = kind === "crit" || kind === "down";
      void play(
        inner,
        pop
          ? [{ transform: "scale(0.45)", opacity: 0 }, { transform: "scale(1.28)", opacity: 1, offset: 0.5 }, { transform: "scale(1)", opacity: 1 }]
          : [{ transform: "scale(0.75)", opacity: 0.2 }, { transform: "scale(1)", opacity: 1 }],
        pop ? 260 : 130,
        "ease-out",
      );
    }
    void play(node, frames, FLOAT_MS).then(() => {
      node.remove();
      liveFloats.delete(ink);
      setBusy(-1, mine);
    });
  }

  // ---- banners

  function bannerNode(text: string, kind: BannerKind): HTMLElement {
    const node = el("div", "lto-banner");
    node.dataset.ltoBanner = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    node.setAttribute("aria-hidden", "true");
    const face = FACES[kind];
    const avail = Math.max(120, (root.clientWidth || width) - (isPixel() ? 56 : 40));
    if (isPixel()) {
      frame(node, BANNER_FRAME[kind]);
      const label = text.toUpperCase();
      // A title strip, not a poster: the owner found full-width banners blocked the board. Two or three times the font, never more.
      const scale = fitScale(textWidth(label, "bold") + 6, Math.min(avail - 24, 420), 2, 3, deviceRatio());
      node.append(
        px(label, { scale, weight: "bold", color: [face.top, face.mid], outline: face.outline, outlinePx: 2, shadow: PX.shade, shadowDx: 2, shadowDy: 2 }),
      );
    } else {
      const label = text.toUpperCase();
      let size = clamp(Math.floor((root.clientWidth || width) * 0.045), 18, 30);
      const spacing = 0.08;
      const fits = (s: number) => serifWidth(label, s) + (label.length - 1) * spacing * s + s * 0.6 <= avail;
      while (size > 20 && !fits(size)) size -= 2;
      node.append(numeral(uid, kind, label, size, spacing));
    }
    return node;
  }

  let bannerChain: Promise<void> = Promise.resolve();
  function banner(text: string, kind: BannerKind): Promise<void> {
    if (destroyed) return Promise.resolve();
    const mine = epoch;
    const run = bannerChain.then(async () => {
      if (destroyed || mine !== epoch) return;
      announce(text);
      const node = bannerNode(text, kind);
      bannersLayer.appendChild(node);
      setBusy(1, mine);
      const still = reduced();
      if (still) {
        await play(node, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }], BANNER_REDUCED_MS);
      } else {
        await play(
          node,
          [
            { opacity: 0, transform: "scale(0.9)", easing: "ease-out" },
            { opacity: 1, transform: "scale(1.03)", offset: 0.17 },
            { opacity: 1, transform: "scale(1)", offset: 0.27 },
            { opacity: 1, transform: "scale(1)", offset: 0.8 },
            { opacity: 0, transform: "scale(1.05)" },
          ],
          BANNER_MS,
        );
      }
      node.remove();
      setBusy(-1, mine);
    });
    bannerChain = run.catch(() => {});
    return run;
  }

  // ---- roll plates

  function cellsOf(r: PlateReadout): { n: string; l: string; strong?: boolean }[] {
    return [
      { n: String(r.roll), l: "your roll" },
      { n: signed(r.modifier), l: "your bonus" },
      { n: String(r.total), l: "total", strong: true },
      { n: String(r.target), l: "you needed" },
    ];
  }

  function sourcesOf(r: PlateReadout): string[] {
    return (r.sources ?? []).map((s) => `${signed(s.amount)} ${s.label}`);
  }

  function verdictClass(r: PlateReadout): "crit" | "hit" | "miss" {
    return r.critical ? "crit" : r.hit ? "hit" : "miss";
  }

  /**
   * Builds a plate; returns it plus a hook that sets the d20 face (for the tumble). The last two are the pixel
   * style's fitting steps for a narrow host: `numScale`, the scale of the four big numbers, and `squeeze`, 1 to
   * close up the gaps in the maths row and 2 to let it wrap onto a second row.
   */
  function plateNode(r: PlateReadout, avail: number, numScale: number, squeeze: number): { node: HTMLElement; setRoll: (n: number) => void } {
    const node = el("div", "lto-plate lto-roll");
    node.dataset.ltoPlate = "";
    node.dataset.hit = String(r.hit);
    node.dataset.roll = String(r.roll);
    node.dataset.text = `${r.roll} ${signed(r.modifier)} = ${r.total} vs ${r.target}: ${verdictWords(r)}`;
    node.setAttribute("aria-hidden", "true");
    const cells = cellsOf(r);
    const srcs = sourcesOf(r);
    const verdict = verdictWords(r);
    const vClass = verdictClass(r);
    let renderRoll: (n: number) => void = () => {};

    if (isPixel()) {
      const ratio = deviceRatio();
      frame(node, r.critical ? "gold" : "win");
      if (r.caption) node.append(px(r.caption, { scale: 1, color: PX.muted, maxWidth: wrapWidth(avail - 40, 1, ratio) }));
      const math = el("div", "lto-math");
      if (squeeze > 0) math.classList.add("is-tight");
      if (squeeze > 1) math.classList.add("is-wrap");
      // Numerals big, the game's own words under them at 1x, so the numbers carry the plate.
      cells.forEach((c, i) => {
        if (i === 2 || i === 3) {
          const op = el("div", "lto-op");
          op.append(px(i === 2 ? "=" : "vs", { scale: 2, color: PX.muted, shadow: PX.shade }));
          math.append(op);
        }
        const cell = el("div", "lto-cell");
        const numColor: PixelColor = c.strong ? PX.gold : PX.ink;
        const numHolder = el("div");
        const draw = (text: string) => numHolder.replaceChildren(px(text, { scale: numScale, weight: "bold", color: numColor, outline: PX.dark, shadow: PX.shade }));
        draw(c.n);
        if (i === 0) renderRoll = (n) => draw(String(n));
        cell.append(numHolder, px(c.l, { scale: 1, color: PX.muted, shadow: PX.shade }));
        math.append(cell);
      });
      node.append(math);
      if (srcs.length) {
        const wrap = el("div", "lto-srcs");
        for (const s of srcs) wrap.append(px(s, { scale: 1, color: PX.muted, maxWidth: Math.max(30, wrapWidth(avail - 40, 1, ratio)) }));
        node.append(wrap);
      }
      const vColor: PixelColor = vClass === "hit" ? PX.good : vClass === "crit" ? PX.gold : PX.bad;
      const vFont = textWidth(verdict, "bold") + 4;
      const vMax = verdict.length > 6 ? 2 : 3;
      node.append(px(verdict, { scale: fitScale(vFont, avail - 40, 1, vMax, ratio), weight: "bold", color: vColor, outline: PX.dark, shadow: PX.shade }));
    } else {
      if (r.critical) node.classList.add("is-crit");
      if (r.caption) node.append(el("div", "lto-cap", r.caption));
      const math = el("div", "lto-math");
      cells.forEach((c, i) => {
        if (i === 2 || i === 3) math.append(el("div", "lto-op", i === 2 ? "=" : "vs"));
        const cell = el("div", c.strong ? "lto-cell strong" : "lto-cell");
        const b = el("b", undefined, c.n);
        if (i === 0) {
          renderRoll = (n) => {
            b.textContent = String(n);
          };
        }
        cell.append(b, el("i", undefined, c.l));
        math.append(cell);
      });
      node.append(math);
      if (srcs.length) {
        const wrap = el("div", "lto-srcs");
        for (const s of srcs) wrap.append(el("span", undefined, s));
        node.append(wrap);
      }
      node.append(el("div", `lto-verdict lto-t2 ${vClass}`, verdict));
    }
    return { node, setRoll: renderRoll };
  }

  let plateChain: Promise<void> = Promise.resolve();
  let platesWaiting = 0;

  /**
   * A plate that is up. `above` plates stand over their point with a pointer `tail` px long hanging off the bottom;
   * `top` is where it is heading (its style), which is not what it measures while it is still sliding there.
   */
  interface LivePlate {
    pos: HTMLElement;
    above: boolean;
    tail: number;
    top: number;
  }
  const livePlates = new Set<LivePlate>();

  /** The lowest a plate may stand: under the turn-order strip when it is showing. */
  const safeTop = (): number => (initEl.hidden && cardsHost.hidden ? 8 : top.offsetHeight + 12);

  /**
   * Lift a plate that stands over its point clear of a float's ink: a taller float
   * than the plate made room for, or a stack climbing past it. A plate never prints
   * under a number, so the verdict is never hidden; where there is no room left
   * above it stays under the strip and the number wins, because floats are the
   * upper layer.
   */
  function stepPlateUp(plate: LivePlate, f: FloatInk): void {
    if (!plate.above) return;
    const { offsetLeft: left, offsetWidth: w, offsetHeight: h } = plate.pos;
    const bottom = plate.top + h + plate.tail;
    if (f.right <= left || f.left >= left + w) return;
    if (f.bottom <= plate.top || f.top >= bottom + FLOAT_GAP_PX) return;
    const next = Math.max(safeTop(), f.top - FLOAT_GAP_PX - plate.tail - h);
    if (next < plate.top) {
      plate.top = next;
      plate.pos.style.top = `${next}px`;
    }
  }

  async function showPlate(at: OverlayPoint, readout: PlateReadout, mine: number): Promise<void> {
    // A plate queued before a clear() was already forgotten by it, so only this epoch's plates are counted down.
    if (mine === epoch) platesWaiting--;
    const alive = () => !destroyed && mine === epoch;
    if (!alive()) return;
    const rootW = root.clientWidth || width;
    const pos = el("div", "lto-plate-pos");
    platesLayer.appendChild(pos);
    const bigScale = tier === "s" ? 3 : 4;
    // Pixel plates are canvases, which cannot wrap, so on a narrow host (or at a ratio that rounds the text up) close up
    // the maths row, then let it wrap, then step the big numbers down, until the plate holds all of its content.
    const fits: [number, number][] = [[bigScale, 1], [bigScale, 2]];
    for (let scale = bigScale - 1; scale >= 1; scale--) fits.push([scale, 2]);
    let built = plateNode(readout, rootW - 24, bigScale, 0);
    pos.append(built.node);
    for (const [numScale, squeeze] of fits) {
      if (!isPixel() || pos.scrollWidth <= pos.clientWidth + 1) break;
      built = plateNode(readout, rootW - 24, numScale, squeeze);
      pos.replaceChildren(built.node);
    }
    const { setRoll } = built;
    setBusy(1, mine);

    // Above the point if there is room under the strip, else below it; never under the dialogue box if it can be helped.
    // Above, it starts clear of an ordinary damage number rising off the same point (stepPlateUp lifts it further for a taller one).
    const w = pos.offsetWidth;
    const h = pos.offsetHeight;
    const rootH = root.clientHeight;
    const tailPx = isPixel() ? PLATE_TAIL_PIXEL_PX : PLATE_TAIL_PX;
    const strip = safeTop();
    const safeBottom = dlg.hidden && narrHost.childElementCount === 0 ? rootH - 8 : rootH - bottom.offsetHeight - 16;
    const left = clamp(at.x - w / 2, 8, Math.max(8, rootW - w - 8));
    let above = true;
    let y = at.y - damageReach() - FLOAT_GAP_PX - tailPx - h;
    if (y < strip) y = at.y - PLATE_CLEAR_MIN_PX - h; // a small host: stand closer rather than flip
    if (y < strip) {
      above = false;
      y = at.y + 40;
    }
    y = clamp(y, strip, Math.max(strip, safeBottom - h));
    pos.style.left = `${left}px`;
    pos.style.top = `${y}px`;
    const plate: LivePlate = { pos, above, tail: tailPx, top: y };
    livePlates.add(plate);
    for (const f of liveFloats) stepPlateUp(plate, f);

    const tailX = clamp(at.x - left, 18, Math.max(18, w - 18));
    if (isPixel()) {
      const tail = spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.win.L }, 2);
      tail.classList.add("lto-tail");
      tail.style.left = `${tailX}px`;
      if (above) tail.style.bottom = "-13px";
      else {
        tail.style.top = "-13px";
        tail.style.transform = "translateX(-50%) scaleY(-1)";
      }
      pos.append(tail);
    } else {
      const tail = el("div", `lto-tail ${above ? "down" : "up"}`);
      tail.style.left = `${tailX}px`;
      pos.append(tail);
    }

    const still = reduced();
    if (still) {
      await play(pos, [{ opacity: 0 }, { opacity: 1 }], 120);
    } else {
      await play(
        pos,
        [{ opacity: 0, transform: "translateY(6px) scale(0.92)" }, { opacity: 1, transform: "translateY(0) scale(1.03)", offset: 0.7 }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        PLATE_IN_MS,
        "ease-out",
      );
      // The d20 tumbles through a few faces and settles. Deterministic, not random.
      for (let i = 0; i < 3 && alive(); i++) {
        setRoll(((readout.roll * 7 + i * 5 + 3) % 20) + 1);
        await wait(60);
      }
      setRoll(readout.roll);
    }
    if (alive()) await wait(platesWaiting > 0 ? PLATE_HOLD_QUEUED_MS : PLATE_HOLD_MS);
    if (alive()) await play(pos, [{ opacity: 1 }, { opacity: 0 }], still ? 120 : PLATE_OUT_MS);
    pos.remove();
    livePlates.delete(plate);
    setBusy(-1, mine);
  }

  function rollPlate(at: OverlayPoint, readout: PlateReadout): void {
    if (destroyed) return;
    const mine = epoch;
    platesWaiting++;
    plateChain = plateChain.then(() => showPlate(at, readout, mine)).catch(() => {});
  }

  // ---- dialogue

  function lineNode(line: DialogueLine): HTMLElement {
    const tone = line.tone ?? "plain";
    const node = el("div", "lto-line");
    node.dataset.ltoLine = "";
    node.dataset.tone = tone;
    if (line.speaker) node.dataset.speaker = line.speaker;
    node.dataset.text = line.text;
    if (isPixel()) {
      node.append(srText(line.speaker ? `${line.speaker}: ${line.text}` : line.text));
      const body = tone === "good" ? PX.good : tone === "bad" ? PX.bad : PX.ink;
      const runs: PixelRun[] = [];
      if (line.speaker) runs.push({ text: `${line.speaker}:`, color: PX.gold, weight: "bold" }, { text: " " });
      runs.push({ text: line.text, color: body });
      const ratio = deviceRatio();
      const inner = Math.max(80, (dlgScroll.clientWidth || width - 40) - 8);
      const canvas = px(runs, { scale: 2, shadow: PX.shade, maxWidth: wrapWidth(inner, 2, ratio) });
      // Every entry is a whole number of text rows tall, so the box scrolls on row boundaries and never shows half a line.
      // A row is what the text really takes: 20 CSS px only at whole ratios (see cssScale), and the scroll box's height follows it.
      const row = (CELL_H + LINE_GAP) * cssScale(2, ratio);
      root.style.setProperty("--lto-row", `${row}px`);
      node.style.height = `${Number(canvas.dataset.lines ?? "1") * row}px`;
      node.append(canvas);
    } else {
      if (line.speaker) node.append(el("b", undefined, line.speaker), srText(": "));
      node.append(document.createTextNode(line.text));
    }
    return node;
  }

  /** Rebuild the strip for the current style and width (a resize, a style switch). Lines that were already leaving are dropped. */
  function renderDialogue(): void {
    for (let i = strip.length - 1; i >= 0; i--) if (strip[i]?.fading) strip.splice(i, 1);
    boxFade?.cancel();
    boxFade = null;
    dlg.hidden = strip.length === 0;
    if (strip.length === 0) {
      dlgScroll.replaceChildren();
      return;
    }
    frameDialogue();
    for (const e of strip) e.node = lineNode(e.line);
    dlgScroll.replaceChildren(...strip.map((e) => e.node));
    dlgScroll.scrollTop = dlgScroll.scrollHeight;
  }

  function frameDialogue(): void {
    dlg.classList.remove("lto-fr", "fr-win", "fs1", "lto-plate");
    if (isPixel()) frame(dlg, "win", tier === "s");
    else dlg.classList.add("lto-plate");
  }

  /** Fade lines out until no more than the allowed number stay (see stripMaxLines): the oldest, ordinary ones first. */
  function enforceStripMax(): void {
    const live = strip.filter((e) => !e.fading);
    const max = stripMaxLines(tier, !!narr && !narr.closed);
    for (const i of stripOverflow(live.map((e) => !!e.line.sticky), max)) {
      const e = live[i];
      if (e) void retireLine(e, STRIP_EVICT_MS);
    }
  }

  /** Fade one line and shrink it away. When it is the last one on the board the whole box goes with it. */
  async function retireLine(entry: StripEntry, ms = STRIP_OUT_MS): Promise<void> {
    if (destroyed || entry.fading || entry.epoch !== epoch || !strip.includes(entry)) return;
    entry.fading = true;
    const still = reduced();
    const last = strip.every((e) => e.fading);
    const h = entry.node.offsetHeight;
    const out = still ? 120 : ms;
    const ends: Promise<void>[] = [
      play(
        entry.node,
        still ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, height: `${h}px` }, { opacity: 0, height: `${h}px`, offset: 0.7 }, { opacity: 0, height: "0px" }],
        out,
        "ease-in",
      ),
    ];
    if (last) {
      const fade = start(dlg, still ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.92)" }], out, "ease-in");
      boxFade = fade.anim;
      ends.push(fade.done);
    }
    await Promise.all(ends);
    // A clear(), a re-render or a newer line may have got there first.
    const at = strip.indexOf(entry);
    if (at < 0) return;
    strip.splice(at, 1);
    entry.node.remove();
    if (strip.length === 0) {
      boxFade?.cancel();
      boxFade = null;
      dlg.hidden = true;
    }
  }

  function say(line: DialogueLine): void {
    if (destroyed) return;
    announce(line.speaker ? `${line.speaker}: ${line.text}` : line.text);
    // A newer line saves the box from a fade that was only waiting on the old last line.
    boxFade?.cancel();
    boxFade = null;
    if (dlg.hidden) {
      dlg.hidden = false;
      frameDialogue();
    }
    const entry: StripEntry = { line, node: lineNode(line), fading: false, epoch };
    strip.push(entry);
    dlgScroll.appendChild(entry.node);
    dlgScroll.scrollTop = dlgScroll.scrollHeight;
    enforceStripMax();
    if (!reduced() && typeof entry.node.animate === "function") {
      void play(entry.node, [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], 160, "ease-out");
    }
    if (!line.sticky) {
      const chars = (line.speaker ? line.speaker.length + 2 : 0) + line.text.length;
      void wait(stripHoldMs(chars, reduced())).then(() => {
        if (!destroyed && entry.epoch === epoch) void retireLine(entry);
      });
    }
  }

  function dismissStory(opts: { stickyOnly?: boolean } = {}): void {
    if (destroyed) return;
    for (const e of strip.filter((x) => !x.fading && (!opts.stickyOnly || x.line.sticky))) void retireLine(e);
  }

  // A click (or Enter, Space, Escape on the focused strip) sends the lines away; the bench's own keys never see those presses.
  dlg.addEventListener("click", () => dismissStory());
  dlg.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    dismissStory();
  });

  // ---- initiative strip

  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}.` : s);

  function renderInitiative(): void {
    const { entries, activeId, round } = initState;
    initEl.replaceChildren();
    initEl.hidden = entries.length === 0;
    if (entries.length === 0) {
      layoutLoot();
      return;
    }
    const tab = el("div", "lto-round");
    tab.dataset.ltoRound = String(round);
    if (isPixel()) {
      frame(tab, "win", true);
      tab.append(px(`ROUND ${round}`, { scale: 2, color: PX.gold, shadow: PX.shade }));
    } else {
      tab.classList.add("lto-t2");
      tab.textContent = `Round ${round}`;
    }
    initEl.append(tab);
    for (const e of entries) {
      const active = e.id === activeId;
      const chip = el("div", `lto-chip${active ? " is-active" : ""}`);
      chip.dataset.ltoChip = "";
      chip.dataset.id = e.id;
      chip.dataset.active = String(active);
      chip.dataset.total = String(e.total);
      chip.dataset.text = `${e.label} ${e.total}`;
      if (e.side) chip.dataset.side = e.side;
      chip.append(srText(`${e.label}${e.side ? `, ${e.side}` : ""}, initiative ${e.total}${active ? ", taking a turn" : ""}`));
      if (isPixel()) {
        // A side colours the frame (blue hero, red enemy) and the active chip is marked by its ring and caret instead of a gold frame.
        frame(chip, e.side === "hero" ? "blue" : e.side === "enemy" ? "red" : active ? "gold" : "win", true);
        chip.append(
          px(clip(e.label, 10), { scale: 2, color: active ? PX.gold : PX.ink, shadow: PX.shade }),
          px(String(e.total), { scale: 2, weight: "bold", color: active ? PX.gold : PX.muted, shadow: PX.shade }),
        );
        if (active) {
          const caret = spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.gold.L }, 2);
          caret.classList.add("lto-caret");
          chip.append(caret);
        }
      } else {
        chip.classList.add("lto-plate");
        chip.append(el("span", undefined, clip(e.label, 14)), el("span", "lto-badge", String(e.total)));
        for (const child of Array.from(chip.children)) if (!child.classList.contains("lto-sr")) child.setAttribute("aria-hidden", "true");
      }
      initEl.append(chip);
    }
    const active = initEl.querySelector<HTMLElement>('[data-active="true"]');
    if (active) initEl.scrollLeft = active.offsetLeft - (initEl.clientWidth - active.offsetWidth) / 2;
    else initEl.scrollLeft = 0;
    layoutLoot();
  }

  function initiative(entries: readonly InitiativeEntry[], activeId: string | null, round: number): void {
    if (destroyed) return;
    initState = { entries: entries.map((e) => ({ ...e })), activeId, round };
    renderInitiative();
  }

  // ---- toasts

  function toast(text: string): void {
    if (destroyed) return;
    const existing = Array.from(toasts.children).find((c) => (c as HTMLElement).dataset.text === text) as HTMLElement | undefined;
    if (existing) {
      // Same notice again: keep the one on screen and give it a fresh lease. If it was already fading out, stop that: a
      // fade that has run holds the node at opacity 0 (fill forwards), so the new lease would show nothing.
      const n = Number(existing.dataset.lease ?? "0") + 1;
      existing.dataset.lease = String(n);
      fades.get(existing)?.cancel();
      fades.delete(existing);
      void play(existing, [{ transform: "scale(1.06)" }, { transform: "scale(1)" }], 140, "ease-out");
      void wait(TOAST_MS).then(() => retire(existing, n));
      return;
    }
    while (toasts.childElementCount >= 3) toasts.firstElementChild?.remove();
    const node = el("div", "lto-toast");
    node.dataset.ltoToast = "";
    node.dataset.text = text;
    node.dataset.lease = "0";
    node.setAttribute("aria-hidden", "true");
    if (isPixel()) {
      frame(node, "red", true);
      node.append(px(text, { scale: 2, color: PX.ink, shadow: PX.shade, maxWidth: wrapWidth(Math.max(120, (root.clientWidth || width) - 70), 2, deviceRatio()) }));
    } else {
      node.classList.add("lto-plate");
      node.textContent = text;
    }
    toasts.append(node);
    announce(text);
    if (!reduced()) void play(node, [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "translateY(0)" }], 150, "ease-out");
    void wait(TOAST_MS).then(() => retire(node, 0));
  }

  /** The fade-out each leaving toast is running, so a repeat of its text can stop it. */
  const fades = new WeakMap<HTMLElement, Animation>();

  async function retire(node: HTMLElement, lease: number): Promise<void> {
    if (destroyed || !node.isConnected || Number(node.dataset.lease ?? "0") !== lease) return;
    const { anim, done } = start(node, [{ opacity: 1 }, { opacity: 0 }], TOAST_FADE_MS);
    if (anim) fades.set(node, anim);
    await done;
    if (anim && fades.get(node) === anim) fades.delete(node);
    if (node.isConnected && Number(node.dataset.lease ?? "0") === lease) node.remove();
  }

  // ---- DM narration

  /** One narration box: the tag and the framed body are built once, and renderNarration fills them for the current style. */
  interface Narr {
    node: HTMLElement;
    tag: HTMLElement;
    box: HTMLElement;
    body: HTMLElement;
    speaker: string;
    text: string;
    /** done() was called: the text is complete. */
    done: boolean;
    /** Dismissed, replaced or cleared: nothing more is drawn. The text is still kept, so done() can announce it. */
    closed: boolean;
    announced: boolean;
    renderQueued: boolean;
    epoch: number;
  }
  let narr: Narr | null = null;
  const narrAlive = (n: Narr): boolean => !destroyed && n.epoch === epoch && !n.closed && narr === n;

  function renderNarration(n: Narr): void {
    const pixel = isPixel();
    // Keep the reader at the newest line while text streams in, unless they have scrolled up.
    const stick = n.body.childElementCount === 0 || n.body.scrollHeight - n.body.scrollTop - n.body.clientHeight < 14;
    n.node.dataset.text = n.text;
    n.node.dataset.speaker = n.speaker;
    n.node.dataset.thinking = String(n.text === "");
    n.node.setAttribute("aria-label", `${n.speaker} narration`);
    n.box.classList.remove("lto-fr", "fr-gold", "fs1", "lto-plate");
    n.tag.classList.remove("lto-fr", "fr-gold", "fs1");
    n.tag.replaceChildren();
    const label = n.speaker.length > NARRATION_TAG_MAX ? `${n.speaker.slice(0, NARRATION_TAG_MAX - 1)}.` : n.speaker;
    if (pixel) {
      frame(n.box, "gold", tier === "s");
      frame(n.tag, "gold", true);
      n.tag.append(px(label.toUpperCase(), { scale: 2, weight: "bold", color: PX.gold, shadow: PX.shade }));
    } else {
      n.box.classList.add("lto-plate");
      n.tag.textContent = label;
    }
    // A row is what the text really takes at this ratio (see cssScale), so the box shows whole rows and never half a line.
    if (pixel) n.node.style.setProperty("--lto-nrow", `${(CELL_H + LINE_GAP) * cssScale(2, deviceRatio())}px`);
    if (n.text === "") {
      const dots = el("span", "lto-narr-dots");
      dots.setAttribute("role", "img");
      dots.setAttribute("aria-label", `${n.speaker} is thinking`);
      dots.append(el("i"), el("i"), el("i"));
      n.body.replaceChildren(dots);
    } else if (pixel) {
      const ratio = deviceRatio();
      // The scrollbar gutter and a little air come off the width the text may use.
      const inner = Math.max(80, (n.body.clientWidth || (root.clientWidth || width) - 48) - 12);
      n.body.replaceChildren(srText(n.text), px(n.text, { scale: 2, color: PX.ink, shadow: PX.shade, maxWidth: wrapWidth(inner, 2, ratio) }));
    } else {
      n.body.textContent = n.text;
    }
    // Written text (`full`) is read from its first word; a reply that streams in is followed to its newest line.
    if (stick && n.node.dataset.full === undefined) n.body.scrollTop = n.body.scrollHeight;
  }

  function queueNarrationRender(n: Narr): void {
    if (n.renderQueued) return;
    if (typeof requestAnimationFrame !== "function") {
      renderNarration(n);
      return;
    }
    n.renderQueued = true;
    requestAnimationFrame(() => {
      n.renderQueued = false;
      if (narrAlive(n)) renderNarration(n);
    });
  }

  /** Take a narration box down: a quick fade, then gone. Does nothing if it is already closed or was replaced. */
  async function retireNarration(n: Narr, ms: number): Promise<void> {
    if (!narrAlive(n)) return;
    n.closed = true;
    await play(n.node, [{ opacity: 1 }, { opacity: 0 }], reduced() ? 120 : ms);
    if (narr === n) {
      narr = null;
      delete root.dataset.narrating;
    }
    n.node.remove();
  }

  function narrate(opts: { speaker?: string; text: string; full?: boolean }): NarrationHandle {
    const dead: NarrationHandle = { update() {}, done() {}, close() {} };
    if (destroyed) return dead;
    // A new narration replaces the old one at once (a fading one included).
    narrHost.replaceChildren();
    if (narr) narr.closed = true;
    const node = el("div", "lto-narr");
    node.dataset.ltoNarration = "";
    // `full`: written text that is read from its first word (an adventure's own beat), not a reply that streams in: the box grows to hold all of it.
    if (opts.full) node.dataset.full = "";
    node.tabIndex = 0;
    node.setAttribute("role", "group");
    node.title = "Click to dismiss";
    const tag = el("div", "lto-narr-tag");
    const box = el("div", "lto-narr-box");
    const body = el("div", "lto-narr-body");
    box.append(body);
    node.append(tag, box);
    const n: Narr = { node, tag, box, body, speaker: opts.speaker?.trim() || "DM", text: opts.text ?? "", done: false, closed: false, announced: false, renderQueued: false, epoch };
    narr = n;
    root.dataset.narrating = "1";
    narrHost.append(node);
    renderNarration(n);
    enforceStripMax();
    const closeNow = (): void => void retireNarration(n, NARRATION_CLOSE_MS);
    node.addEventListener("click", closeNow);
    node.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      closeNow();
    });
    if (reduced()) void play(node, [{ opacity: 0 }, { opacity: 1 }], 120);
    else void play(node, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], NARRATION_IN_MS, "ease-out");
    return {
      update(text: string): void {
        if (n.done) return;
        n.text = text;
        if (narrAlive(n)) queueNarrationRender(n);
      },
      done(): void {
        if (n.done) return;
        n.done = true;
        if (n.text !== "" && !n.announced && !destroyed && n.epoch === epoch) {
          n.announced = true;
          announce(`${n.speaker}: ${n.text}`);
        }
        if (!narrAlive(n)) return;
        // The text is complete: draw it now (a render may still be queued), then give the reader their time.
        renderNarration(n);
        if (n.text === "") {
          void retireNarration(n, NARRATION_CLOSE_MS);
          return;
        }
        void wait(narrationHoldMs(n.text.length)).then(() => retireNarration(n, NARRATION_OUT_MS));
      },
      close: closeNow,
    };
  }

  // ---- context menu

  /** The star of a "good" entry: Font Awesome's solid star outline, drawn inline so there is no icon font. */
  const STAR_PATH =
    "M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.7 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.8-19.9-25.7-21.7L381.2 150.3 316.9 18z";

  interface MenuState {
    at: OverlayPoint;
    entries: ContextMenuEntry[];
    onPick: (id: string) => void;
    title?: string;
    node: HTMLElement;
    rows: HTMLElement[];
    focus: number;
    openedAt: number;
    prevFocus: Element | null;
    off: () => void;
  }
  let menu: MenuState | null = null;
  const menuLayer = el("div", "lto-menu-layer");

  function starMark(): SVGSVGElement {
    const svg = svgEl("svg", { viewBox: "0 0 576 512", "aria-hidden": "true", focusable: "false" });
    svg.append(svgEl("path", { d: STAR_PATH }));
    return svg;
  }

  function setMenuFocus(m: MenuState, i: number): void {
    if (i < 0 || i >= m.rows.length) return;
    m.focus = i;
    m.rows[i]?.focus({ preventScroll: true });
  }

  function placeMenu(m: MenuState): void {
    const n = m.node;
    const board = { width: root.clientWidth || width, height: root.clientHeight };
    n.style.visibility = "hidden";
    n.style.left = "0px";
    n.style.top = "0px";
    n.style.maxHeight = `${Math.max(0, board.height - MENU_MARGIN * 2)}px`;
    const p = menuPlacement(m.at, { width: n.offsetWidth, height: n.offsetHeight }, board);
    n.style.left = `${Math.round(p.left)}px`;
    n.style.top = `${Math.round(p.top)}px`;
    n.style.maxHeight = `${p.maxHeight}px`;
    n.dataset.flipX = String(p.flipX);
    n.dataset.flipY = String(p.flipY);
    n.style.visibility = "";
  }

  /** Draw the menu's rows for the current style and width, keeping the focused row. */
  function renderMenu(m: MenuState): void {
    const pixel = isPixel();
    const n = m.node;
    n.className = "lto-cm";
    if (pixel) frame(n, "win", true);
    else n.classList.add("lto-plate");
    const W = menuWidth(root.clientWidth || width);
    n.style.width = `${W}px`;
    const room = Math.max(40, W - (pixel ? 10 : 2) - 6 - 16 - 26);
    const ratio = deviceRatio();
    const kids: HTMLElement[] = [];
    if (m.title) {
      const t = el("div", "lto-cm-title");
      t.setAttribute("aria-hidden", "true");
      if (pixel) t.append(px(m.title, { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark, maxWidth: wrapWidth(W - 30, 2, ratio) }));
      else t.textContent = m.title;
      kids.push(t);
    }
    m.rows = [];
    m.entries.forEach((e, i) => {
      const row = el("div", "lto-cm-row");
      row.setAttribute("role", "menuitem");
      row.tabIndex = -1;
      row.dataset.ltoMenuItem = e.id;
      row.dataset.enabled = String(e.enabled);
      row.dataset.good = String(!!e.good);
      row.dataset.text = e.label;
      if (!e.enabled) row.setAttribute("aria-disabled", "true");
      row.setAttribute("aria-label", menuEntryName(e));
      const mark = el("span", "lto-cm-mark");
      mark.setAttribute("aria-hidden", "true");
      if (e.good) mark.append(starMark());
      const text = el("div", "lto-cm-text");
      text.setAttribute("aria-hidden", "true");
      const line = (cls: string, words: string, color: PixelColor, bold = false): HTMLElement => {
        const d = el("div", cls);
        if (pixel) d.append(px(words, { scale: cls === "lto-cm-label" ? 2 : 1, weight: bold ? "bold" : "regular", color, outline: PX.dark, maxWidth: wrapWidth(room, cls === "lto-cm-label" ? 2 : 1, ratio) }));
        else d.textContent = words;
        return d;
      };
      text.append(line("lto-cm-label", e.label, e.good ? PX.gold : PX.ink, e.good));
      if (e.why) text.append(line("lto-cm-why", e.why, PX.muted));
      if (!e.enabled && e.reason) text.append(line("lto-cm-reason", e.reason, "#ff8c7a"));
      row.append(mark, text);
      row.addEventListener("pointerenter", (ev) => {
        if (ev.pointerType === "mouse") setMenuFocus(m, i);
      });
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pickMenu(m, i, "pointer");
      });
      m.rows.push(row);
      kids.push(row);
    });
    n.replaceChildren(...kids);
    placeMenu(m);
    setMenuFocus(m, m.focus);
  }

  function closeMenu(refocus: boolean): void {
    const m = menu;
    if (!m) return;
    menu = null;
    m.off();
    m.node.remove();
    if (refocus && m.prevFocus instanceof HTMLElement && m.prevFocus.isConnected) m.prevFocus.focus({ preventScroll: true });
  }

  function pickMenu(m: MenuState, i: number, via: "pointer" | "key"): void {
    if (menu !== m) return;
    const e = m.entries[i];
    if (!e) return;
    if (via === "pointer" && performance.now() - m.openedAt < MENU_GRACE_MS) return;
    if (!e.enabled) {
      if (e.reason) announce(`${e.label}: ${e.reason}`);
      return;
    }
    const pick = m.onPick;
    closeMenu(via === "key");
    pick(e.id);
  }

  function contextMenu(at: OverlayPoint, entries: readonly ContextMenuEntry[], onPick: (id: string) => void, mopts: { title?: string } = {}): () => void {
    if (destroyed) return () => {};
    closeMenu(false);
    const list = menuEntries(entries);
    if (list.length === 0) return () => {};
    const node = el("div");
    node.dataset.ltoMenu = "";
    node.setAttribute("role", "menu");
    node.setAttribute("aria-label", mopts.title ?? "Actions");
    const m: MenuState = { at: { x: at.x, y: at.y }, entries: list, onPick, title: mopts.title, node, rows: [], focus: 0, openedAt: performance.now(), prevFocus: document.activeElement, off: () => {} };
    // The board and the page must not act on what is done in the menu.
    for (const type of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu", "wheel"]) {
      node.addEventListener(type, (ev) => {
        ev.stopPropagation();
        if (type === "contextmenu") ev.preventDefault();
      });
    }
    const onDown = (ev: PointerEvent): void => {
      const t = ev.target as Node | null;
      if (t && node.contains(t)) return;
      closeMenu(false);
      // The click that dismisses it is not also a walk or an attack on the board underneath.
      if (ev.button === 0 && t && host.contains(t)) {
        const eat = (c: MouseEvent): void => {
          c.stopPropagation();
          c.preventDefault();
        };
        document.addEventListener("click", eat, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener("click", eat, true), 600);
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu(true);
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Home" || ev.key === "End") {
        ev.preventDefault();
        ev.stopPropagation();
        setMenuFocus(m, cardNavIndex(m.rows.length, m.focus, ev.key));
      } else if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        pickMenu(m, m.focus, "key");
      } else if (ev.key === "Tab") {
        closeMenu(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    m.off = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    menu = m;
    menuLayer.append(node);
    renderMenu(m);
    return () => {
      if (menu === m) closeMenu(false);
    };
  }

  // ---- loot window

  interface LootState {
    opts: LootWindowOptions;
    items: LootWindowItem[];
    node: HTMLElement;
    tipOff: Array<() => void>;
    emptyTimer: number;
    /** The first draw puts the focus on a Take button; later ones only keep it where it was. */
    drawn: boolean;
  }
  let loot: LootState | null = null;
  const lootHost = el("div", "lto-loot-host");

  function layoutLoot(): void {
    if (!loot) return;
    lootHost.style.top = `${safeTop()}px`;
    const list = loot.node.querySelector<HTMLElement>(".lto-loot-list");
    if (!list) return;
    // The list takes what the panel leaves of the board (its own title and buttons are measured, not guessed) and scrolls past that.
    list.style.maxHeight = "";
    const chrome = loot.node.offsetHeight - list.offsetHeight;
    list.style.maxHeight = `${Math.max(80, root.clientHeight - safeTop() - bottom.offsetHeight - 16 - chrome)}px`;
  }

  function renderLoot(l: LootState): void {
    const pixel = isPixel();
    const n = l.node;
    const was = document.activeElement as HTMLElement | null;
    const focusKey = was && n.contains(was) ? (was.dataset.lootTake ?? (was.dataset.lootAll !== undefined ? "@all" : was.dataset.lootClose !== undefined ? "@close" : null)) : null;
    for (const off of l.tipOff) off();
    l.tipOff = [];
    n.className = "lto-loot";
    if (pixel) frame(n, "win", true);
    else n.classList.add("lto-plate");
    const ratio = deviceRatio();
    const W = Math.min(340, (root.clientWidth || width) - 16);
    const takeW = pixel ? Math.ceil(textWidth("Take", "bold") * 2) + 34 : 64;
    const room = Math.max(40, W - (pixel ? 10 : 2) - 16 - 8 - takeW);
    const empty = l.items.length === 0;
    n.dataset.empty = String(empty);
    n.dataset.count = String(l.items.length);
    const btn = (label: string, cls: string, pri = false): HTMLButtonElement => {
      const b = el("button", `lto-btn ${cls}${pri ? " is-pri" : ""}`);
      b.type = "button";
      b.setAttribute("aria-label", label);
      if (pixel) {
        b.classList.add("lto-fr", "fs1", pri ? "fr-gold" : "fr-win");
        b.append(px(label, { scale: 2, weight: "bold", color: pri ? PX.gold : PX.ink, outline: PX.dark }));
      } else {
        b.append(el("span", undefined, label));
      }
      return b;
    };
    const head = el("div", "lto-loot-title");
    head.setAttribute("role", "heading");
    head.setAttribute("aria-level", "2");
    if (pixel) head.append(px(l.opts.title, { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark, maxWidth: wrapWidth(W - 30, 2, ratio) }), srText(l.opts.title));
    else head.textContent = l.opts.title;
    n.setAttribute("aria-label", l.opts.title);
    const list = el("div", "lto-loot-list");
    list.setAttribute("role", "list");
    if (empty) {
      const e = el("div", "lto-loot-empty");
      e.setAttribute("role", "status");
      if (pixel) e.append(px("Nothing left.", { scale: 2, color: PX.muted, outline: PX.dark }), srText("Nothing left."));
      else e.textContent = "Nothing left.";
      list.append(e);
    }
    for (const it of l.items) {
      const row = el("div", "lto-loot-row");
      row.setAttribute("role", "listitem");
      row.dataset.ltoLootItem = it.key;
      row.dataset.text = it.name;
      const name = el("div", "lto-loot-name");
      if (pixel) name.append(px(it.name, { scale: 2, color: PX.ink, outline: PX.dark, maxWidth: wrapWidth(room, 2, ratio) }), srText(it.name));
      else name.textContent = it.name;
      if (it.tip) l.tipOff.push(attachTip(name, it.tip, { boundary: host.closest<HTMLElement>(".lt-game") ?? host, style: () => (isPixel() ? "pixel" : "storybook") }));
      const take = btn("Take", "lto-loot-take");
      take.dataset.lootTake = it.key;
      take.setAttribute("aria-label", `Take ${it.name}`);
      take.addEventListener("click", () => l.opts.onTake(it.key));
      row.append(name, take);
      list.append(row);
    }
    const foot = el("div", "lto-loot-foot");
    if (!empty) {
      const all = btn("Take all", "lto-loot-all", true);
      all.dataset.lootAll = "";
      all.addEventListener("click", () => l.opts.onTake("all"));
      foot.append(all);
    }
    const close = btn("Close", "lto-loot-close");
    close.dataset.lootClose = "";
    close.addEventListener("click", () => closeLoot(l, true));
    foot.append(close);
    n.replaceChildren(head, list, foot);
    layoutLoot();
    // Focus: where it was, else (first draw) the first Take button.
    let target: HTMLElement | null = null;
    if (focusKey !== null) {
      target = focusKey === "@all" ? n.querySelector("[data-loot-all]") : focusKey === "@close" ? n.querySelector("[data-loot-close]") : (Array.from(n.querySelectorAll<HTMLElement>("[data-loot-take]")).find((b) => b.dataset.lootTake === focusKey) ?? null);
      target ??= n.querySelector<HTMLElement>("[data-loot-take]") ?? n.querySelector<HTMLElement>("[data-loot-all]") ?? n.querySelector<HTMLElement>("[data-loot-close]");
    } else if (!l.drawn) {
      target = n.querySelector<HTMLElement>("[data-loot-take]") ?? n.querySelector<HTMLElement>("[data-loot-close]");
    }
    l.drawn = true;
    target?.focus({ preventScroll: true });
  }

  function closeLoot(l: LootState, notify: boolean): void {
    if (loot !== l) return;
    loot = null;
    window.clearTimeout(l.emptyTimer);
    for (const off of l.tipOff) off();
    l.tipOff = [];
    l.node.remove();
    if (notify) l.opts.onClose();
  }

  function setLootItems(l: LootState, items: readonly LootWindowItem[]): void {
    if (loot !== l) return;
    l.items = items.map((i) => ({ ...i }));
    window.clearTimeout(l.emptyTimer);
    if (l.items.length === 0) l.emptyTimer = window.setTimeout(() => closeLoot(l, true), LOOT_EMPTY_MS);
    renderLoot(l);
  }

  function lootWindow(lopts: LootWindowOptions): LootWindow {
    const dead: LootWindow = { update() {}, close() {} };
    if (destroyed) return dead;
    if (loot) closeLoot(loot, false);
    const node = el("div");
    node.dataset.ltoLoot = "";
    node.setAttribute("role", "dialog");
    node.addEventListener("keydown", (e) => {
      // Typing in the window is the window's own: the game behind it never sees it (Tab and Enter still work on the buttons).
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        if (loot === l) closeLoot(l, true);
      }
    });
    for (const type of ["keyup", "keypress", "pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) node.addEventListener(type, (e) => e.stopPropagation());
    const l: LootState = { opts: lopts, items: [], node, tipOff: [], emptyTimer: 0, drawn: false };
    loot = l;
    lootHost.append(node);
    setLootItems(l, lopts.items);
    return {
      update: (items) => setLootItems(l, items),
      close: () => closeLoot(l, false),
    };
  }

  // ---- the adventure screens: start, hero, ending, and the arrival cards

  /** The width a text block has, in CSS px, for pixel wrapping: its own box when it is laid out, else the board less a margin. */
  const roomOf = (node: HTMLElement, slack = 0): number => Math.max(40, (node.clientWidth || (root.clientWidth || width) - 48) - slack);

  interface TextSpec {
    /** The storybook class (it carries the font) and, with it, the hook the tests read. */
    cls: string;
    scale?: number;
    weight?: PixelWeight;
    color?: PixelColor;
    /** Ink with a dark outline (text that sits on the scrim, not on a card). */
    outline?: boolean;
    center?: boolean;
    /** Width the pixel text is NOT to use, in CSS px (a sibling beside it). */
    slack?: number;
  }

  /** A block of words in the current treatment: a canvas wrapped to the block's width in pixel (with the words kept for screen readers), plain text in storybook. */
  function stext(parent: HTMLElement, words: string, spec: TextSpec): HTMLElement {
    const d = el("div", `lto-st ${spec.cls}${spec.center ? " is-center" : ""}`);
    d.dataset.text = words;
    parent.append(d);
    if (isPixel()) {
      const scale = spec.scale ?? 2;
      const ratio = deviceRatio();
      const margin = spec.outline ? 3 * cssScale(scale, ratio) : 2;
      d.append(
        srText(words),
        px(words, {
          scale,
          weight: spec.weight ?? "regular",
          color: spec.color ?? PX.ink,
          outline: spec.outline ? PX.dark : null,
          shadow: spec.outline ? PX.shade : null,
          maxWidth: wrapWidth(roomOf(d, (spec.slack ?? 0) + margin), scale, ratio),
          align: spec.center ? "center" : "left",
        }),
      );
    } else {
      d.textContent = words;
    }
    return d;
  }

  /** The width of an SVG numeral for `text` at `size` with the banner's letter spacing, frame included (see numeralGeometry). */
  const numeralWidth = (text: string, size: number, spacing: number): number =>
    Math.ceil(serifWidth(text, size) + Math.max(0, text.length - 1) * spacing * size + Math.max(3, Math.round(size * 0.3)) * 2 + 4);

  /**
   * A big title inside `node`, in the current treatment, on one line when it fits and on two when it does not: pixel text at a scale
   * between 2 and `pxMax`, wrapped; storybook numerals between 16 px and `sbMax`.
   */
  function titleInto(node: HTMLElement, text: string, kind: BannerKind, o: { avail: number; pxMax: number; sbMax: number }): void {
    const label = text.toUpperCase();
    const face = FACES[kind];
    const ratio = deviceRatio();
    if (isPixel()) {
      const scale = fitScale(textWidth(label, "bold") + 6, o.avail, 2, o.pxMax, ratio);
      node.append(
        srText(text),
        px(label, {
          scale,
          weight: "bold",
          color: [face.top, face.mid],
          outline: face.outline,
          outlinePx: 2,
          shadow: PX.shade,
          shadowDx: 2,
          shadowDy: 2,
          maxWidth: wrapWidth(o.avail - 6 * cssScale(scale, ratio), scale, ratio),
          align: "center",
        }),
      );
      return;
    }
    const spacing = 0.08;
    const fitsAt = (lines: string[], size: number) => lines.every((l) => numeralWidth(l, size, spacing) <= o.avail);
    let lines = [label];
    let size = o.sbMax;
    while (size > 20 && !fitsAt(lines, size)) size -= 2;
    if (!fitsAt(lines, size)) {
      lines = titleLines(label, false);
      size = o.sbMax;
      while (size > 16 && !fitsAt(lines, size)) size -= 2;
    }
    node.append(srText(text));
    for (const line of lines) node.append(numeral(uid, kind, line, size, spacing));
  }

  /** A framed title strip (the banner's look, kept in the page rather than flashed): pixel frame or storybook ribbon. */
  function ribbon(parent: HTMLElement, text: string, kind: BannerKind, o: { pxMax: number; sbMax: number }): HTMLElement {
    const node = el("div", "lto-banner lto-ribbon");
    node.dataset.ltoRibbon = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    parent.append(node);
    if (isPixel()) frame(node, BANNER_FRAME[kind]);
    titleInto(node, text, kind, { avail: Math.max(100, roomOf(node, isPixel() ? 16 : 72)), ...o });
    return node;
  }

  /** A button for the screens: the loot window's look, with a key for keeping the focus across a redraw. */
  function sbtn(parent: HTMLElement, label: string, key: string, pri = false): HTMLButtonElement {
    const b = el("button", `lto-btn${pri ? " is-pri" : ""}`);
    b.type = "button";
    b.dataset.scrKey = key;
    b.dataset.scrNav = "";
    b.setAttribute("aria-label", label);
    if (isPixel()) {
      b.classList.add("lto-fr", "fs1", pri ? "fr-gold" : "fr-win");
      // A long label (Back to the start screen) wraps on a phone instead of running past the button's edge.
      b.append(px(label, { scale: 2, weight: "bold", color: pri ? PX.gold : PX.ink, outline: PX.dark, maxWidth: wrapWidth(Math.max(100, (root.clientWidth || width) - 96), 2, deviceRatio()) }));
    } else {
      b.append(el("span", undefined, label));
    }
    parent.append(b);
    return b;
  }

  /** A section heading on the scrim. */
  function sectionHead(parent: HTMLElement, words: string): void {
    const d = stext(parent, words, { cls: "lto-scr-sec", scale: 2, weight: "bold", color: PX.gold, outline: true });
    d.setAttribute("role", "heading");
    d.setAttribute("aria-level", "2");
  }

  /** A small tag: the author badge. */
  function pill(parent: HTMLElement, words: string, tone: "plain" | "ai"): void {
    const p = el("span", "lto-pill");
    p.dataset.tone = tone;
    p.dataset.text = words;
    if (isPixel()) p.append(srText(words), px(words.toUpperCase(), { scale: 1, weight: "bold", color: tone === "ai" ? ["#e6f1ff", "#8fc4ff"] : PX.gold }));
    else p.textContent = words;
    parent.append(p);
  }

  interface Scr {
    kind: string;
    node: HTMLElement;
    scroll: HTMLElement;
    body: HTMLElement;
    closed: boolean;
    /** Draw it again (a resize, a style switch, a state change), keeping the scroll and the focus. */
    rebuild: () => void;
    /** What Escape does. */
    onEscape?: () => void;
  }
  const screens = new Set<Scr>();
  const closers = new WeakMap<Scr, () => void>();
  const screensLayer = el("div", "lto-scr-layer");

  function focusableIn(node: HTMLElement): HTMLElement[] {
    return Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((n) => n.getClientRects().length > 0);
  }

  function closeScreen(s: Scr): void {
    if (s.closed) return;
    closers.get(s)?.();
  }
  function rebuildScreens(): void {
    for (const s of screens) s.rebuild();
  }

  /** A full-board screen: modal (its keys are its own, Tab stays inside, the arrows move between cards). A new screen replaces the ones up. */
  function mountScreen(kind: string, label: string, draw: (s: Scr) => void): Scr {
    for (const old of Array.from(screens)) closeScreen(old);
    const node = el("div", "lto-scr");
    node.dataset.ltoScreen = kind;
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("aria-label", label);
    const scroll = el("div", "lto-scr-scroll");
    const body = el("div", "lto-scr-body");
    scroll.append(body);
    node.append(scroll);
    const prevFocus = document.activeElement;
    const s: Scr = { kind, node, scroll, body, closed: false, rebuild: () => {} };
    s.rebuild = () => {
      if (s.closed || destroyed) return;
      const at = document.activeElement as HTMLElement | null;
      const key = at && node.contains(at) ? (at.dataset.scrKey ?? null) : null;
      const caret = at instanceof HTMLTextAreaElement && node.contains(at) ? [at.selectionStart, at.selectionEnd] : null;
      const was = scroll.scrollTop;
      body.replaceChildren();
      draw(s);
      scroll.scrollTop = was;
      if (key !== null) {
        const again = Array.from(node.querySelectorAll<HTMLElement>("[data-scr-key]")).find((n) => n.dataset.scrKey === key);
        if (again) {
          again.focus({ preventScroll: true });
          if (caret && again instanceof HTMLTextAreaElement) again.setSelectionRange(caret[0] ?? 0, caret[1] ?? 0);
        }
      }
    };
    // The board and the game must not act on what is done here.
    for (const type of ["keyup", "keypress", "pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) node.addEventListener(type, (e) => e.stopPropagation());
    node.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        s.onEscape?.();
        return;
      }
      if (e.key === "Tab") {
        const list = focusableIn(node);
        if (list.length === 0) {
          e.preventDefault();
          return;
        }
        const i = list.indexOf(document.activeElement as HTMLElement);
        const first = list[0] as HTMLElement;
        const last = list[list.length - 1] as HTMLElement;
        if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) {
          e.preventDefault();
          (e.shiftKey && i >= 0 ? last : first).focus();
        }
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && t.dataset.scrNav !== undefined && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const navs = Array.from(node.querySelectorAll<HTMLElement>("[data-scr-nav]:not(:disabled)")).filter((n) => n.getClientRects().length > 0);
        const next = navs[cardNavIndex(navs.length, navs.indexOf(t), e.key)];
        if (next) {
          e.preventDefault();
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest" });
        }
      }
    });
    closers.set(s, () => {
      const had = node.contains(document.activeElement);
      s.closed = true;
      screens.delete(s);
      node.remove();
      if ((had || document.activeElement === document.body) && prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    });
    screens.add(s);
    screensLayer.append(node);
    s.rebuild();
    return s;
  }

  /** The title block of a screen: the big title, and under it a quiet line. */
  function titleBlock(parent: HTMLElement, title: string, sub: string): void {
    const t = el("div", "lto-scr-title");
    t.dataset.ltoTitle = title;
    parent.append(t);
    const big = el("div", "lto-ribbon");
    t.append(big);
    titleInto(big, title, "victory", { avail: Math.max(100, roomOf(t, 8)), pxMax: tier === "s" ? 3 : 4, sbMax: tier === "s" ? 32 : 42 });
    stext(t, sub, { cls: "lto-scr-sub", scale: 2, color: PX.muted, center: true, outline: true });
  }

  // ---- the start screen

  function startScreen(sopts: StartScreenOptions): StartScreen {
    const dead: StartScreen = { close() {}, setWriting() {}, setProblems() {} };
    if (destroyed) return dead;
    let writeProblems: string[] = [];
    const adventures = startCards(sopts.adventures);
    const rooms = startRooms(sopts.sandboxes);
    let stage: WriteStage = "closed";
    let writing: StartWriting | null = null;
    let cancelFn: (() => void) | undefined;
    let cancelling = false;
    const ta = el("textarea", "lto-ta");
    ta.rows = 4;
    ta.maxLength = PREMISE_MAX;
    ta.placeholder = "A haunted lighthouse and a missing keeper...";
    ta.dataset.scrKey = "premise";
    ta.dataset.ltoPremise = "";
    ta.setAttribute("aria-label", "What the adventure is about");
    ta.setAttribute("autocapitalize", "sentences");
    let writeBtn: HTMLButtonElement | null = null;
    const sync = (): void => {
      if (writeBtn) writeBtn.disabled = !premiseReady(ta.value);
    };
    ta.addEventListener("input", sync);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        step("write");
      }
    });
    const busy = (): boolean => stage === "writing";

    const s = mountScreen("start", "The Living Table: choose an adventure", (sc) => {
      sc.node.dataset.busy = String(busy());
      const body = sc.body;
      titleBlock(body, "The Living Table", "Choose an adventure");

      // the owner's adventures
      sectionHead(body, "Adventures");
      const list = el("div", "lto-card-list");
      list.dataset.ltoAdventures = "";
      body.append(list);
      if (adventures.length === 0) stext(list, "No adventures are installed yet.", { cls: "lto-scr-sub", scale: 2, color: PX.muted, outline: true });
      for (const c of adventures) adventureCard(list, c);

      // the test rooms
      if (rooms.length > 0) {
        sectionHead(body, "Test rooms");
        const grid = el("div", "lto-card-grid");
        grid.dataset.ltoRooms = "";
        body.append(grid);
        for (const r of rooms) roomCard(grid, r);
      }

      // the AI writer
      sectionHead(body, "Something new");
      aiCard(body);
    });
    s.onEscape = () => step("back");

    function adventureCard(list: HTMLElement, c: StartCard): void {
      const playable = c.playable;
      const node = playable ? el("button", "lto-card") : el("div", "lto-card");
      if (node instanceof HTMLButtonElement) node.type = "button";
      node.dataset.ltoAdventure = c.id;
      node.dataset.author = c.author;
      node.dataset.playable = String(playable);
      node.dataset.draft = String(c.draftMarks);
      node.dataset.scrKey = `adv:${c.id}`;
      node.dataset.scrNav = "";
      const note = draftNote(c.draftMarks);
      const name = [c.title, authorBadge(c.author), note].filter(Boolean).join(", ");
      if (playable) {
        node.setAttribute("aria-label", `${name}. ${c.summary}`);
        node.addEventListener("click", () => {
          if (!busy()) sopts.onPick(c.id);
        });
        if (busy()) node.setAttribute("aria-disabled", "true");
      } else {
        node.tabIndex = 0;
        node.setAttribute("role", "group");
        node.setAttribute("aria-label", `${name}, cannot be played yet. ${c.problems.join(". ")}`);
        node.setAttribute("aria-disabled", "true");
      }
      list.append(node);
      if (isPixel()) frame(node, playable ? "gold" : "red", true);
      else {
        node.classList.add("lto-plate");
        if (!playable) node.classList.add("is-bad");
      }
      stext(node, c.title, { cls: "lto-card-title", scale: 2, weight: "bold", color: playable ? PX.gold : PX.muted });
      const meta = el("div", "lto-card-meta");
      node.append(meta);
      pill(meta, authorBadge(c.author), c.author === "ai" ? "ai" : "plain");
      if (playable) {
        const play = el("span", "lto-play");
        play.setAttribute("aria-hidden", "true");
        if (isPixel()) play.append(px("PLAY", { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark }), spriteCanvas(["o...", "oo..", "ooo.", "oooo", "ooo.", "oo..", "o..."], { o: "#ffc72a" }, 2));
        else play.textContent = "Play";
        meta.append(play);
      }
      if (c.summary) stext(node, excerpt(c.summary), { cls: "lto-card-text", scale: 2, color: PX.ink });
      if (note) stext(node, note, { cls: "lto-card-draft", scale: 2, weight: "bold", color: ["#ffd9a0", "#ff9a3a"] }).dataset.ltoDraft = "";
      if (!playable) {
        stext(node, "This file has problems and cannot be played yet:", { cls: "lto-card-badhead", scale: 2, weight: "bold", color: PX.bad });
        const probs = el("div", "lto-problems");
        probs.dataset.ltoProblems = "";
        probs.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0";
        node.append(probs);
        for (const line of problemLines(c.problems)) stext(probs, /^and \d+ more$/.test(line) ? line : `- ${line}`, { cls: "lto-card-bad", scale: 2, color: PX.bad });
      }
    }

    function roomCard(grid: HTMLElement, r: StartRoom): void {
      const node = el("button", "lto-card is-compact");
      node.type = "button";
      node.dataset.ltoRoom = r.id;
      node.dataset.scrKey = `room:${r.id}`;
      node.dataset.scrNav = "";
      node.setAttribute("aria-label", r.summary ? `${r.title}. ${r.summary}` : r.title);
      node.addEventListener("click", () => {
        if (!busy()) sopts.onPick(r.id);
      });
      if (busy()) node.setAttribute("aria-disabled", "true");
      grid.append(node);
      if (isPixel()) frame(node, "win", true);
      else node.classList.add("lto-plate");
      stext(node, r.title, { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.ink });
      if (r.summary) stext(node, r.summary, { cls: "lto-card-quiet", scale: 1, color: PX.muted });
    }

    function aiCard(parent: HTMLElement): void {
      writeBtn = null;
      if (stage === "closed") {
        const node = el("button", "lto-card");
        node.type = "button";
        node.dataset.ltoAi = "";
        node.dataset.scrKey = "ai";
        node.dataset.scrNav = "";
        node.setAttribute("aria-label", "Write a new adventure with AI. Describe an idea and the AI writes one for you. Optional.");
        node.addEventListener("click", () => step("open"));
        parent.append(node);
        if (isPixel()) frame(node, "blue", true);
        else node.classList.add("lto-plate");
        stext(node, "Write a new adventure with AI", { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.ink });
        stext(node, "Describe an idea and the AI writes one for you. Optional.", { cls: "lto-card-quiet", scale: 2, color: PX.muted });
        return;
      }
      const node = el("div", "lto-card");
      node.dataset.ltoAi = "";
      node.dataset.stage = stage;
      node.tabIndex = -1;
      node.setAttribute("role", "group");
      node.setAttribute("aria-label", "Write a new adventure with AI");
      node.dataset.scrKey = "ai";
      parent.append(node);
      if (isPixel()) frame(node, "blue", true);
      else node.classList.add("lto-plate");
      stext(node, "Write a new adventure with AI", { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.ink });
      stext(node, sopts.aiNote, { cls: "lto-card-text", scale: 2, color: PX.ink }).dataset.ltoCost = "";
      stext(node, "What is the adventure about?", { cls: "lto-card-quiet", scale: 2, weight: "bold", color: PX.muted });
      ta.disabled = busy();
      ta.classList.toggle("lto-fr", isPixel());
      ta.classList.toggle("fs1", isPixel());
      ta.classList.toggle("fr-win", isPixel());
      node.append(ta);
      if (stage === "confirm") {
        const q = stext(node, "Start writing now?", { cls: "lto-card-ask", scale: 2, weight: "bold", color: PX.gold });
        q.dataset.ltoConfirm = "";
      } else if (stage === "form" && writeProblems.length > 0) {
        stext(node, "No adventure was made. Why:", { cls: "lto-card-badhead", scale: 2, weight: "bold", color: PX.bad }).dataset.ltoWriteFailed = "";
        const probs = el("div", "lto-problems");
        probs.dataset.ltoWriteProblems = "";
        probs.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0";
        node.append(probs);
        for (const line of problemLines(writeProblems)) stext(probs, /^and \d+ more$/.test(line) ? line : `- ${line}`, { cls: "lto-card-bad", scale: 2, color: PX.bad });
      } else if (stage === "writing") {
        const prog = el("div", "lto-wprog");
        prog.dataset.ltoWriting = "";
        prog.setAttribute("role", "status");
        prog.setAttribute("aria-live", "polite");
        const dots = el("span", "lto-wdots");
        dots.setAttribute("aria-hidden", "true");
        dots.append(el("i"), el("i"), el("i"));
        node.append(prog);
        prog.append(dots);
        stext(prog, cancelling ? "Cancelling" : writingLine(writing?.stage), { cls: "lto-card-ask", scale: 2, weight: "bold", color: PX.gold, slack: 30 });
      }
      const row = el("div", "lto-scr-actions is-start");
      node.append(row);
      if (stage === "form") {
        writeBtn = sbtn(row, "Write it", "write", true);
        writeBtn.dataset.ltoWrite = "";
        writeBtn.addEventListener("click", () => step("write"));
        sync();
        sbtn(row, "Cancel", "back").addEventListener("click", () => step("back"));
      } else if (stage === "confirm") {
        const yes = sbtn(row, "Yes, write it", "yes", true);
        yes.dataset.ltoYes = "";
        yes.addEventListener("click", () => step("yes"));
        sbtn(row, "Not yet", "back").addEventListener("click", () => step("back"));
      } else if (writing?.canCancel) {
        const cancel = sbtn(row, "Cancel", "cancel");
        cancel.dataset.ltoCancel = "";
        cancel.disabled = cancelling;
        cancel.addEventListener("click", () => {
          if (cancelling) return;
          cancelling = true;
          s.rebuild();
          cancelFn?.();
        });
      }
    }

    /** Bring the AI card into view: all of it when it fits the screen (so its buttons show), else down to what has the focus. */
    function reveal(card: HTMLElement | undefined, focused: HTMLElement | undefined): void {
      if (!card) return;
      const sr = s.scroll.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      if (cr.height + 12 <= sr.height) {
        if (cr.bottom > sr.bottom - 8) s.scroll.scrollTop += cr.bottom - sr.bottom + 12;
        else if (cr.top < sr.top) s.scroll.scrollTop -= sr.top - cr.top + 8;
      } else focused?.scrollIntoView({ block: "nearest" });
    }

    function pick(key: string): HTMLElement | undefined {
      return Array.from(s.node.querySelectorAll<HTMLElement>("[data-scr-key]")).find((n) => n.dataset.scrKey === key);
    }

    function step(ev: WriteEvent): void {
      if (s.closed) return;
      const r = nextWriteStage(stage, ev, ta.value);
      const was = stage;
      stage = r.stage;
      // A new try, or stepping out of the form, drops what the last try said.
      if (r.fire || stage !== "form") writeProblems = [];
      if (r.fire) sopts.onWrite(ta.value.trim());
      if (stage === was) return;
      s.rebuild();
      const target = stage === "form" ? pick("premise") : stage === "confirm" ? pick("back") : stage === "closed" ? pick("ai") : (pick("cancel") ?? pick("ai"));
      target?.focus({ preventScroll: true });
      reveal(pick("ai"), target);
    }

    // The first focus: the first card.
    queueMicrotask(() => {
      if (s.closed) return;
      s.node.querySelector<HTMLElement>("[data-scr-nav]")?.focus({ preventScroll: true });
    });

    return {
      close: () => closeScreen(s),
      setWriting(state: StartWriting | null, onCancel?: () => void): void {
        if (s.closed) return;
        writing = state;
        if (state) writeProblems = [];
        cancelFn = onCancel;
        cancelling = false;
        const was = stage;
        stage = nextWriteStage(stage, state ? "busy" : "idle", ta.value).stage;
        s.rebuild();
        if (stage !== was && stage === "form") ta.focus({ preventScroll: true });
      },
      setProblems(lines: readonly string[] | null): void {
        if (s.closed) return;
        writeProblems = lines ? lines.map(tidy).filter(Boolean) : [];
        s.rebuild();
        if (writeProblems.length > 0) reveal(pick("ai"), pick("premise"));
      },
    };
  }

  // ---- the hero screen

  function startHero(hopts: StartHeroOptions): StartHero {
    const dead: StartHero = { close() {} };
    if (destroyed) return dead;
    const hooks = hopts.hooks.filter((h) => h.chassis && tidy(h.label));
    const s = mountScreen("hero", `${hopts.adventureTitle}: choose your hero`, (sc) => {
      const body = sc.body;
      const back = el("div", "lto-scr-actions is-start");
      body.append(back);
      const b = sbtn(back, "Back", "back");
      b.dataset.ltoBack = "";
      b.addEventListener("click", () => hopts.onBack());
      titleBlock(body, tidy(hopts.adventureTitle) || "A new adventure", "Who will you be?");

      const mine = el("button", "lto-card");
      mine.type = "button";
      mine.dataset.ltoCreate = "";
      mine.dataset.scrKey = "create";
      mine.dataset.scrNav = "";
      mine.setAttribute("aria-label", "Make your own hero. Open the character maker.");
      mine.addEventListener("click", () => hopts.onCreate());
      body.append(mine);
      if (isPixel()) frame(mine, "gold", true);
      else mine.classList.add("lto-plate");
      stext(mine, "Make your own hero", { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.gold });
      stext(mine, "Open the character maker.", { cls: "lto-card-quiet", scale: 2, color: PX.muted });

      if (hooks.length > 0) {
        sectionHead(body, "Or start right away");
        const list = el("div", "lto-card-list");
        list.dataset.ltoHooks = "";
        body.append(list);
        for (const h of hooks) {
          const card = el("button", "lto-card");
          card.type = "button";
          card.dataset.ltoQuick = h.chassis;
          card.dataset.scrKey = `quick:${h.chassis}`;
          card.dataset.scrNav = "";
          const kit = tidy(h.kit).replace(/^you start with\s+/i, "");
          card.setAttribute("aria-label", `${h.label}. ${tidy(h.hook)}${kit ? ` You start with ${kit}.` : ""}`);
          card.addEventListener("click", () => hopts.onQuick(h.chassis));
          list.append(card);
          if (isPixel()) frame(card, "win", true);
          else card.classList.add("lto-plate");
          stext(card, tidy(h.label), { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.gold });
          if (tidy(h.hook)) stext(card, excerpt(h.hook, HOOK_MAX), { cls: "lto-card-hook", scale: 2, color: PX.ink });
          if (kit) stext(card, `You start with ${kit}`, { cls: "lto-card-quiet", scale: 2, color: PX.muted }).dataset.ltoKit = "";
        }
      }
    });
    s.onEscape = () => hopts.onBack();
    queueMicrotask(() => {
      if (!s.closed) s.node.querySelector<HTMLElement>("[data-lto-create]")?.focus({ preventScroll: true });
    });
    return { close: () => closeScreen(s) };
  }

  // ---- the ending

  function endingCard(eopts: EndingCardOptions): EndingCard {
    const dead: EndingCard = { close() {} };
    if (destroyed) return dead;
    const outcome = eopts.outcome;
    const title = tidy(eopts.title) || endingKicker(outcome);
    const s = mountScreen("ending", `${endingKicker(outcome)}: ${title}`, (sc) => {
      sc.node.dataset.outcome = outcome;
      const body = sc.body;
      const box = el("div", "lto-endbox");
      box.dataset.ltoEnding = outcome;
      body.append(box);
      stext(box, endingKicker(outcome), { cls: "lto-scr-sec", scale: 2, weight: "bold", color: outcome === "defeat" ? PX.bad : PX.gold, outline: true, center: true });
      ribbon(box, title, endingBannerKind(outcome), { pxMax: tier === "s" ? 3 : 4, sbMax: tier === "s" ? 28 : 36 });
      const text = (eopts.text ?? "").trim();
      if (text) {
        const tb = el("div", "lto-narr-box");
        tb.dataset.ltoEndingText = "";
        box.append(tb);
        if (isPixel()) frame(tb, outcome === "defeat" ? "red" : outcome === "continue" ? "blue" : "gold", tier === "s");
        else tb.classList.add("lto-plate");
        const tbody = el("div", "lto-narr-body");
        tb.append(tbody);
        if (isPixel()) tbody.append(srText(text), px(text, { scale: 2, color: PX.ink, shadow: PX.shade, maxWidth: wrapWidth(roomOf(tbody, 8), 2, deviceRatio()) }));
        else tbody.textContent = text;
      }
      const row = el("div", "lto-scr-actions");
      box.append(row);
      for (const c of endingChoices(!!eopts.onContinue)) {
        if (c === "continue") {
          const b = sbtn(row, "Continue", "continue", true);
          b.dataset.ltoContinue = "";
          b.addEventListener("click", () => eopts.onContinue?.());
        } else {
          const b = sbtn(row, "Back to the start screen", "menu", !eopts.onContinue);
          b.dataset.ltoMenuBack = "";
          b.addEventListener("click", () => eopts.onMenu());
        }
      }
    });
    s.onEscape = () => eopts.onContinue?.();
    announce(`${endingKicker(outcome)}: ${title}. ${eopts.text ?? ""}`);
    queueMicrotask(() => {
      if (!s.closed) s.node.querySelector<HTMLElement>("[data-lto-continue], [data-lto-menu-back]")?.focus({ preventScroll: true });
    });
    return { close: () => closeScreen(s) };
  }

  // ---- the arrival cards: a location's name and read-aloud, a scene's title and opening

  interface ArrivalCard {
    kind: "location" | "scene";
    node: HTMLElement;
    title: string;
    text: string;
    closed: boolean;
    epoch: number;
  }
  const arrivals: ArrivalCard[] = [];
  const cardsHost = el("div", "lto-cards");
  cardsHost.dataset.ltoCards = "";
  cardsHost.hidden = true;
  top.insertBefore(cardsHost, toasts);

  function renderArrival(c: ArrivalCard): void {
    const pixel = isPixel();
    c.node.replaceChildren();
    if (pixel) c.node.style.setProperty("--lto-nrow", `${(CELL_H + LINE_GAP) * cssScale(2, deviceRatio())}px`);
    ribbon(c.node, c.title, c.kind === "location" ? "turn" : "initiative", { pxMax: 3, sbMax: tier === "s" ? 24 : 30 });
    if (c.text) {
      const box = el("div", "lto-narr-box");
      c.node.append(box);
      if (pixel) frame(box, c.kind === "location" ? "gold" : "blue", tier === "s");
      else box.classList.add("lto-plate");
      const body = el("div", "lto-narr-body");
      box.append(body);
      if (pixel) body.append(srText(c.text), px(c.text, { scale: 2, color: PX.ink, shadow: PX.shade, maxWidth: wrapWidth(roomOf(body, 14), 2, deviceRatio()) }));
      else body.textContent = c.text;
    }
  }

  function dropArrival(c: ArrivalCard): void {
    c.closed = true;
    const at = arrivals.indexOf(c);
    if (at >= 0) arrivals.splice(at, 1);
    c.node.remove();
    cardsHost.hidden = arrivals.length === 0;
  }

  async function retireArrival(c: ArrivalCard, ms: number): Promise<void> {
    if (destroyed || c.closed || c.epoch !== epoch) return;
    c.closed = true;
    await play(c.node, [{ opacity: 1 }, { opacity: 0 }], reduced() ? 120 : ms);
    const at = arrivals.indexOf(c);
    if (at >= 0) arrivals.splice(at, 1);
    c.node.remove();
    cardsHost.hidden = arrivals.length === 0;
    layoutLoot();
  }

  function showArrival(kind: "location" | "scene", titleIn: string, textIn: string | undefined): void {
    if (destroyed) return;
    const title = tidy(titleIn);
    const text = (textIn ?? "").trim();
    if (!title && !text) return;
    for (const old of arrivals.filter((a) => a.kind === kind)) dropArrival(old);
    const node = el("div", "lto-narr lto-loc");
    node.dataset.ltoCard = kind;
    node.dataset.text = title;
    node.dataset.readAloud = text;
    node.tabIndex = 0;
    node.setAttribute("role", "group");
    node.setAttribute("aria-label", `${title}, activate to dismiss`);
    node.title = "Click to dismiss";
    const c: ArrivalCard = { kind, node, title: title || (kind === "scene" ? "A new scene" : "A new place"), text, closed: false, epoch };
    // A scene card stands above a location card: the new scene is what is happening.
    if (kind === "scene") cardsHost.prepend(node);
    else cardsHost.append(node);
    arrivals.push(c);
    cardsHost.hidden = false;
    renderArrival(c);
    announce(text ? `${c.title}. ${text}` : c.title);
    const closeNow = (): void => void retireArrival(c, NARRATION_CLOSE_MS);
    node.addEventListener("click", closeNow);
    node.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      closeNow();
    });
    if (reduced()) void play(node, [{ opacity: 0 }, { opacity: 1 }], 120);
    else void play(node, [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }], NARRATION_IN_MS, "ease-out");
    layoutLoot();
    void wait(locationHoldMs(text.length)).then(() => retireArrival(c, NARRATION_OUT_MS));
  }

  function locationCard(o: { name: string; readAloud: string }): void {
    showArrival("location", o.name, o.readAloud);
  }
  function sceneCard(o: { title: string; opening?: string }): void {
    showArrival("scene", o.title, o.opening);
  }

  root.insertBefore(lootHost, platesLayer);
  root.insertBefore(screensLayer, lootHost);
  root.append(menuLayer);

  // ---- control

  function clear(): void {
    closeMenu(false);
    epoch++;
    for (const [id, resolve] of waits) {
      window.clearTimeout(id);
      resolve();
    }
    waits.clear();
    for (const a of Array.from(anims)) a.cancel();
    anims.clear();
    platesLayer.replaceChildren();
    livePlates.clear();
    floatsLayer.replaceChildren();
    liveFloats.clear();
    bannersLayer.replaceChildren();
    toasts.replaceChildren();
    for (const c of arrivals) c.closed = true;
    arrivals.length = 0;
    cardsHost.replaceChildren();
    cardsHost.hidden = true;
    narrHost.replaceChildren();
    if (narr) narr.closed = true;
    narr = null;
    delete root.dataset.narrating;
    dlgScroll.replaceChildren();
    dlg.hidden = true;
    strip.length = 0;
    boxFade = null;
    initState = { entries: [], activeId: null, round: 1 };
    renderInitiative();
    live.replaceChildren();
    recent = [];
    platesWaiting = 0;
    busy = 0;
    root.dataset.busy = "0";
  }

  function setStyle(next: TextStyle): void {
    if (destroyed || next === style) return;
    style = next;
    applyStyleClass();
    renderDialogue();
    renderInitiative();
    if (narr && !narr.closed) renderNarration(narr);
    if (menu) renderMenu(menu);
    if (loot) renderLoot(loot);
    for (const c of arrivals) renderArrival(c);
    rebuildScreens();
  }

  function destroy(): void {
    if (destroyed) return;
    clear();
    if (loot) closeLoot(loot, false);
    for (const sc of Array.from(screens)) closeScreen(sc);
    destroyed = true;
    ro?.disconnect();
    root.remove();
    if (restorePosition !== null) host.style.position = restorePosition;
    internals.delete(api);
  }

  const api: Overlay = { setStyle, banner, float, rollPlate, say, dismissStory, narrate, initiative, toast, contextMenu, lootWindow, startScreen, startHero, locationCard, sceneCard, endingCard, clear, destroy };
  internals.set(api, { host, root });
  applyStyleClass();
  measure();
  return api;
}

// ---- SVG numerals: the .cg-num treatment -----------------------------------

function buildDefs(uid: string): SVGSVGElement {
  const svg = svgEl("svg", { width: 0, height: 0, "aria-hidden": "true", focusable: "false" });
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  const defs = svgEl("defs");
  for (const [key, f] of Object.entries(FACES) as [string, Face][]) {
    const g = svgEl("linearGradient", { id: `lto${uid}-${key}`, x1: 0, y1: 0, x2: 0, y2: 1 });
    // The hard pair at .46 and .47 is on purpose: a one-percent value cliff
    // mid-glyph is what makes the numeral read as moulded metal, not a gradient.
    for (const [offset, color] of [[0, f.top], [0.46, f.mid], [0.47, f.deep], [1, f.mid]] as const) {
      g.append(svgEl("stop", { offset, "stop-color": color }));
    }
    defs.append(g);
  }
  svg.append(defs);
  return svg;
}

/**
 * The box of an SVG numeral at a font size, and where its inked glyphs sit in it:
 * `padTop` and `padBottom` are the empty margins above the capitals' top edge and
 * below the baseline, the outline's half stroke included.
 */
function numeralGeometry(px: number, textW: number): { stroke: number; w: number; h: number; baseline: number; padTop: number; padBottom: number } {
  const stroke = Math.max(3, Math.round(px * 0.3));
  const w = Math.ceil(textW + stroke * 2 + 4);
  const h = Math.ceil(px * 1.22 + stroke * 2);
  const baseline = stroke + px * 0.92;
  return {
    stroke,
    w,
    h,
    baseline,
    padTop: Math.max(0, baseline - px * NUMERAL_CAP - stroke / 2),
    padBottom: Math.max(0, h - baseline - stroke / 2),
  };
}

/**
 * Display text as an SVG numeral: paint-order stroke-then-fill so the dark
 * outline sits behind the face instead of eating it (the reason .cg-num is SVG
 * text and not -webkit-text-stroke on HTML), a hard-stop gradient face, and a
 * drop shadow from the .lto-num class.
 */
function numeral(uid: string, key: FloatKind | BannerKind, text: string, px: number, spacing = 0): SVGSVGElement {
  const f = FACES[key];
  const textW = serifWidth(text, px) + Math.max(0, text.length - 1) * spacing * px;
  const { stroke, w, h, baseline } = numeralGeometry(px, textW);
  const svg = svgEl("svg", { class: "lto-num", width: w, height: h, viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true", focusable: "false" });
  const t = svgEl("text", {
    x: w / 2,
    y: baseline,
    "text-anchor": "middle",
    "font-size": px,
    fill: `url(#lto${uid}-${key})`,
    stroke: f.outline,
    "stroke-width": stroke,
    "paint-order": "stroke fill",
    "stroke-linejoin": "round",
  });
  if (spacing) t.setAttribute("letter-spacing", String(spacing * px));
  t.textContent = text;
  svg.append(t);
  return svg;
}

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
   * The freehand line under the buttons ("What do you do?" and a Do it button). Without it, or without an onAsk,
   * the field is not shown. `enabled: false` greys it out and `status` can say why; `busy` greys it out while the
   * DM answers and shows `status` (default "The DM is thinking...") under it.
   */
  ask?: { enabled: boolean; placeholder?: string; status?: string; busy?: boolean };
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
  /** A small line under the export button in the Saves drawer: "Saved.", "Copied to the clipboard.", or why it did not work. */
  exportStatus?: string;
  /** Show a second button, "Copy adventure JSON", beside the export one (the fallback when the file cannot be saved). Pressing it calls onAction("export-copy"). */
  exportCopy?: boolean;
}
export type DrawerTab = "pack" | "journal" | "log" | "saves";
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

const HUD_STYLE_ID = "lto-hud-style";
const HUD_CSS = `
.lto-root.lto-hud{position:relative;inset:auto;overflow:visible;pointer-events:auto;z-index:auto;display:flex;flex-direction:column;gap:8px;width:100%}
.lto-hud-panel{display:flex;flex-direction:column;gap:6px;padding:8px 10px}
.lto-hud-lines{display:flex;flex-direction:column;gap:3px}
.lto-hud-bars{display:flex;flex-direction:column;gap:5px;margin-top:2px}
.lto-hud-bar{display:grid;grid-template-columns:minmax(0,auto) minmax(40px,1fr) auto;align-items:center;gap:8px}
.lto-hud-meter{position:relative;height:10px;overflow:hidden}
.lto-hud-meter>i{position:absolute;left:0;top:0;bottom:0;background:var(--hp)}
.lto-hud-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.lto-hud-btn{appearance:none;font:inherit;color:inherit;margin:0;min-width:0;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:42px;padding:6px 10px;cursor:pointer;text-align:left;touch-action:manipulation}
.lto-hud-btn:disabled{cursor:default;opacity:.42}
.lto-hud-btn:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-hud-key{opacity:.75}
.lto-hud-pack,.lto-hud-logview,.lto-hud-savesview{display:flex;flex-direction:column;gap:6px;min-width:0}
.lto-hud-pack-list{position:relative;max-height:176px;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:7px;padding-right:4px;scrollbar-width:thin}
.lto-hud-sec{display:flex;flex-direction:column;gap:2px;min-width:0}
.lto-hud-row{min-width:0;padding:1px 4px;overflow-wrap:anywhere}
.lto-hud-seclabel,.lto-hud-item{display:block;min-width:0}
.lto-hud-row[data-lt-tip]{cursor:help;border-radius:3px}
.lto-px .lto-hud-row[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(152 165 216/.28)}
.lto-sb .lto-hud-row[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(var(--sb-shade)/.18)}
.lto-px .lto-hud-row[data-lt-tip]:hover,.lto-px .lto-hud-row[data-lt-tip]:focus-visible{background:rgb(77 93 166/.3)}
.lto-sb .lto-hud-row[data-lt-tip]:hover,.lto-sb .lto-hud-row[data-lt-tip]:focus-visible{background:rgb(var(--sb-shade)/.1)}
.lto-hud-row[data-lt-tip]:focus-visible{outline:2px solid var(--sb-focus);outline-offset:1px}
.lto-hud-row.is-new{animation:lto-hud-new 1.8s ease-out}
@keyframes lto-hud-new{0%,35%{background:rgb(255 205 70/.55);box-shadow:inset 3px 0 0 #ffc72a}100%{background:rgb(255 205 70/0);box-shadow:inset 3px 0 0 rgb(255 199 42/0)}}
@media (prefers-reduced-motion: reduce){.lto-hud-row.is-new{background:rgb(255 205 70/.28);box-shadow:inset 3px 0 0 #ffc72a}}
.lto-hud-btn[data-new="true"]::after{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:#ffc72a;box-shadow:0 0 0 2px rgb(0 0 0/.5)}
.lto-hud-ask{display:flex;flex-direction:column;gap:4px}
.lto-hud-ask-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}
.lto-hud-ask-row .lto-hud-btn{justify-content:center}
.lto-hud-ask-status{min-width:0;padding:0 2px}
.lto-hud-input{appearance:none;display:block;margin:0;width:100%;min-width:0;min-height:42px;padding:6px 10px;font:16px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:inherit}
.lto-hud-input:disabled{opacity:.55}
.lto-hud-input:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-px .lto-hud-pack-list{scrollbar-color:#4d5da6 #05061a}
.lto-px .lto-hud-seclabel canvas,.lto-px .lto-hud-item canvas{display:block}
.lto-px .lto-hud-input{color:#f4ecd0;background:#141a3c}
.lto-px .lto-hud-input.lto-fr{padding:2px 4px}
.lto-px .lto-hud-input::placeholder{color:#98a5d8;opacity:1}
.lto-px .lto-hud-btn[data-new="true"]::after{border-radius:0}
.lto-sb .lto-hud-pack-list{scrollbar-color:var(--sb-rule) transparent}
.lto-sb .lto-hud-seclabel{font:700 12px/1.2 var(--lto-serif);letter-spacing:.07em;text-transform:uppercase;color:var(--sb-spk)}
.lto-sb .lto-hud-item{font:14px/1.3 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-hud-input{font-family:var(--lto-serif);color:var(--sb-ink);background:var(--sb-paper);border:1px solid var(--sb-rule);border-radius:9px;box-shadow:inset 0 1px 3px rgb(var(--sb-shade)/.25)}
.lto-sb .lto-hud-input::placeholder{color:var(--sb-muted);opacity:1}
@keyframes lto-hud-pulse{0%,100%{filter:none}50%{filter:brightness(1.35) drop-shadow(0 0 6px rgb(255 205 70/.9))}}
.lto-hud-btn.is-now:not(:disabled){animation:lto-hud-pulse 1.1s ease-in-out infinite}
.lto-px .lto-hud-meter{background:#0b0d22;box-shadow:0 0 0 2px #05061a}
.lto-px .lto-hud-btn.lto-fr{background:#141a3c}
.lto-px .lto-hud-btn:not(:disabled):hover{--frame:var(--fr-blue)}
.lto-sb .lto-hud-title{font:700 16px/1.2 var(--lto-serif);color:var(--sb-ink);letter-spacing:.02em}
.lto-sb .lto-hud-line{font:14px/1.35 var(--lto-serif);color:var(--sb-muted)}
.lto-sb .lto-hud-name{font:600 14px/1.2 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-hud-num{font:700 14px/1 var(--lto-num);color:var(--sb-ink);font-variant-numeric:tabular-nums}
.lto-sb .lto-hud-meter{height:9px;border-radius:999px;background:var(--sb-paper2);box-shadow:inset 0 0 0 1px var(--sb-rule)}
.lto-sb .lto-hud-btn{border-radius:9px;background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));border:1px solid var(--sb-rule);box-shadow:inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold);font:700 15px/1 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-hud-btn.is-now:not(:disabled){box-shadow:0 0 0 3px var(--sb-gold),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-hud-key{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2px 5px;border:1px solid currentColor;border-radius:4px}
.lto-hud-next{display:flex;flex-direction:column;gap:4px;min-width:0}
.lto-hud-next-label{padding:0 2px}
.lto-sb .lto-hud-next-label{font:700 11px/1.1 var(--lto-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--sb-spk)}
.lto-hud-next-list{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));gap:6px}
.lto-hud-next-list>.lto-hud-btn:last-child:nth-child(odd){grid-column:1/-1}
.lto-hud-opt{justify-content:flex-start;gap:8px;text-align:left;align-items:center}
.lto-hud-opt .lto-hud-key{flex:none}
.lto-hud-opt-label{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}
.lto-hud-opt-label canvas{display:block}
.lto-sb .lto-hud-opt{font:600 14px/1.2 var(--lto-serif);border-color:var(--sb-gold);padding-left:14px;box-shadow:inset 5px 0 0 var(--sb-gold),inset 0 0 0 1px var(--sb-paper),0 0 0 1px rgb(var(--sb-shade)/.3)}
.lto-sb .lto-hud-opt-label{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.lto-hud-actions>.lto-hud-btn:last-child:nth-child(odd){grid-column:1/-1}
.lto-hud-drawer-btns{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:6px}
.lto-hud-tab{position:relative;min-height:36px;padding:4px 8px}
.lto-px .lto-hud-tab{padding:4px 6px}
.lto-hud-tab[data-new="true"]::after{position:absolute;top:2px;right:2px;width:7px;height:7px}
.lto-px .lto-hud-tab[data-new="true"]::after{top:0;right:0;width:6px;height:6px}
.lto-sb .lto-hud-btn.is-open{box-shadow:0 0 0 3px var(--sb-gold),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-hud-drawer{display:flex;flex-direction:column;gap:6px;padding:8px 10px;min-width:0}
.lto-hud-notices{display:flex;flex-direction:column;gap:4px;align-items:flex-start;min-width:0}
.lto-hud-notice{max-width:100%;min-width:0;padding:2px 10px;overflow-wrap:anywhere}
.lto-px .lto-hud-notice{padding:0 3px}
.lto-px .lto-hud-notice canvas{display:block}
.lto-sb .lto-hud-notice{border-radius:999px;box-shadow:0 0 0 1px rgb(var(--sb-shade)/.4),0 3px 8px rgb(0 0 0/.3),inset 0 0 0 1px var(--sb-gold)}
.lto-hud-logrow{min-width:0;padding:1px 4px;overflow-wrap:anywhere}
.lto-hud-logrow[data-tone="dm"]{padding-left:8px;box-shadow:inset 2px 0 0 #ffc72a}
.lto-hud-save{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:2px 4px}
.lto-hud-save-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.lto-hud-load{min-height:34px;padding:4px 12px;justify-content:center}
.lto-hud-row[data-lt-card]{cursor:pointer}
.lto-hud-exportrow{display:flex;flex-wrap:wrap;gap:6px}
.lto-hud-export{flex:1 1 auto;justify-content:center;min-height:38px;padding:4px 12px;text-align:center}
.lto-px .lto-hud-export canvas{display:block}
.lto-hud-export-status{min-width:0;padding:0 2px}
.lto-px .lto-hud-load canvas{display:block}
.lto-hud-tab canvas,.lto-hud-opt canvas{flex:none}
.lto-hud-pack-list.lto-hud-journal{max-height:300px}
.lto-hud-journalview{display:flex;flex-direction:column;gap:6px;min-width:0}
.lto-hud-obj{display:grid;grid-template-columns:20px minmax(0,1fr);gap:6px;align-items:start;padding:1px 4px;min-width:0}
.lto-hud-obj canvas{display:block}
.lto-hud-box{display:grid;place-items:center;width:18px;height:18px}
.lto-hud-box canvas{display:block}
.lto-sb .lto-hud-box{width:16px;height:16px;margin-top:2px;border:2px solid var(--sb-rule);border-radius:4px;background:var(--sb-paper)}
.lto-sb .lto-hud-box.is-done{background:var(--sb-good);border-color:var(--sb-good)}
.lto-hud-box svg{display:block;width:10px;height:10px;fill:#fff}
.lto-hud-beat{min-width:0;padding:1px 4px;overflow-wrap:anywhere}
.lto-sb .lto-hud-tone-good{color:var(--sb-good)}
.lto-sb .lto-hud-tone-bad{color:var(--sb-bad)}
.lto-sb .lto-hud-tone-dm{color:var(--sb-spk);font-style:italic}
`;

// ---- the HUD's pure helpers (unit tested) ------------------------------------

export const DRAWER_TABS: readonly DrawerTab[] = ["pack", "journal", "log", "saves"];

/** The drawer after a tab's button is pressed: the open tab closes it, any other tab opens (switching from the one showing). */
export function toggleDrawerTab(open: DrawerTab | null, tab: DrawerTab): DrawerTab | null {
  return open === tab ? null : tab;
}

/** The tab that really shows: the one asked for, if the state still has that part, otherwise none. */
export function usableDrawerTab(open: DrawerTab | null, has: Readonly<Record<DrawerTab, boolean>>): DrawerTab | null {
  return open !== null && has[open] ? open : null;
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

type HudTone = "good" | "bad" | "dm";

/** The tick box of a journal objective in pixel art: a plain box, or a green one with a white tick. */
const BOX_ROWS = ["MMMMMMM", "M.....M", "M.....M", "M.....M", "M.....M", "M.....M", "MMMMMMM"];
const BOX_DONE_ROWS = ["LLLLLLL", "LGGGGWL", "LGGGWGL", "LWGWGGL", "LGWGGGL", "LGGGGGL", "LLLLLLL"];
/** Font Awesome's solid check, drawn inline so there is no icon font. */
const CHECK_PATH = "M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z";

/** Hit point colours: hero blue, enemy red, both amber when low, grey when down. */
function hpColour(bar: HudBar): string {
  if (bar.down || bar.hp <= 0) return "#6b6f86";
  if (bar.hp * 3 <= bar.max) return "#ffb02a";
  return bar.side === "hero" ? "#59a8ff" : "#ff5a4a";
}

export function createHud(
  host: HTMLElement,
  initialStyle: TextStyle,
  /** Every HUD button: the game's actions and options by id, "load:<save id>", "export" and "export-copy". */
  onAction: (id: string) => void,
  opts: {
    slot?: HTMLElement;
    onAsk?: (text: string) => void;
    /** A button of a pinned item card in the Pack tab: the item's key (PackItem.key) and the action's id. */
    onItemAction?: (itemKey: string, actionId: string) => void;
  } = {},
): Hud {
  injectStyle();
  if (typeof document !== "undefined" && !document.getElementById(HUD_STYLE_ID)) {
    const s = document.createElement("style");
    s.id = HUD_STYLE_ID;
    s.textContent = HUD_CSS;
    document.head.appendChild(s);
  }
  let style: TextStyle = initialStyle;
  let destroyed = false;
  let last: HudState | null = null;
  let lastKey = "";
  /** The drawer tab asked for: it shows while the state has that tab's part. */
  let drawer: DrawerTab | null = null;
  /** The pack as the last render saw it, to tell what is new; null before the first look. */
  let prevPack: readonly PackSection[] | null = null;
  /** New items to light up in the next pack draw, and ones that arrived while the pack was shut (they light up when it opens). */
  let freshNow = new Set<string>();
  let pendingNew = new Set<string>();
  /** The journal as the last render saw it, to tell when it changed while shut (the tab then wears a dot until it is opened). */
  let prevJournal: string | null = null;
  let journalNew = false;
  const root = el("div", "lto-root lto-hud");
  root.dataset.ltoHud = "";
  for (const key of Object.keys(FRAMES) as FrameKey[]) {
    const url = frameUrl(key);
    if (url) root.style.setProperty(`--fr-${key}`, `url("${url}")`);
  }
  const panel = el("div", "lto-hud-panel");
  panel.setAttribute("role", "status");
  // The DM's suggested next moves, above the game's own buttons. Not there at all when there are none.
  const next = el("div", "lto-hud-next");
  next.dataset.hudOptions = "";
  next.hidden = true;
  next.setAttribute("role", "group");
  next.setAttribute("aria-label", "Suggested next moves");
  const nextLabel = el("div", "lto-hud-next-label");
  nextLabel.setAttribute("aria-hidden", "true");
  const nextList = el("div", "lto-hud-next-list");
  next.append(nextLabel, nextList);
  const actions = el("div", "lto-hud-actions");
  actions.setAttribute("role", "toolbar");
  actions.setAttribute("aria-label", "Actions");
  // Pack, Log and Saves: the drawer's tabs. Notices sit right under them.
  const tabs = el("div", "lto-hud-drawer-btns");
  tabs.dataset.hudTabs = "";
  tabs.hidden = true;
  tabs.setAttribute("role", "toolbar");
  tabs.setAttribute("aria-label", "Pack, journal, log and saves");
  const noticeBox = el("div", "lto-hud-notices");
  noticeBox.dataset.hudNotices = "";
  noticeBox.hidden = true;
  noticeBox.setAttribute("aria-live", "polite");
  noticeBox.setAttribute("aria-atomic", "false");
  const drawerBox = el("div", "lto-hud-drawer");
  drawerBox.dataset.hudDrawer = "";
  drawerBox.hidden = true;
  drawerBox.setAttribute("role", "group");
  // The freehand line is built once and kept across redraws, so a half-typed sentence and its focus survive a state change.
  const askBox = el("div", "lto-hud-ask");
  askBox.dataset.hudAsk = "";
  askBox.hidden = true;
  const askRow = el("div", "lto-hud-ask-row");
  const askInput = el("input", "lto-hud-input");
  askInput.type = "text";
  askInput.autocomplete = "off";
  askInput.maxLength = 500;
  askInput.enterKeyHint = "send";
  askInput.setAttribute("autocapitalize", "sentences");
  askInput.setAttribute("aria-label", "What do you do? Type any action and the DM will respond");
  askInput.placeholder = "What do you do?";
  const askSend = el("button", "lto-hud-btn");
  askSend.type = "button";
  askSend.dataset.hudAskSend = "";
  askSend.setAttribute("aria-label", "Do it");
  const askStatus = el("div", "lto-hud-ask-status");
  askStatus.setAttribute("aria-live", "polite");
  askStatus.hidden = true;
  askRow.append(askInput, askSend);
  askBox.append(askRow, askStatus);
  root.append(panel);
  if (opts.slot) root.append(opts.slot);
  root.append(next, actions, tabs, noticeBox, drawerBox, askBox);
  host.appendChild(root);

  const isPixel = (): boolean => style === "pixel";
  /** The pack's hover helps, detached whenever the drawer is rebuilt (their rows are replaced). */
  let tipOff: Array<() => void> = [];
  /** What the pack rows on screen were drawn from (look, width, items): while a card is pinned on one of them, a redraw for some other reason leaves them be. */
  let drawnPackSig = "";
  const packSig = (s: HudState): string => `${isPixel()}|${root.clientWidth}|${JSON.stringify(s.pack?.sections ?? null)}`;
  /** What a tip stays inside: the game window the HUD sits in, or the HUD itself. */
  const tipBoundary = (): HTMLElement => host.closest<HTMLElement>(".lt-game") ?? root;
  const px = (text: string, o: PixelTextOptions): HTMLCanvasElement => {
    const c = pixelText(text, { dpr: deviceRatio(), ...o });
    c.setAttribute("aria-hidden", "true");
    return c;
  };
  /**
   * A name that has to fit on one line of the pixel bar: cut with ".." when it would run into the meter
   * (a made character's name can be 60 characters long). The screen reader text keeps the whole name.
   */
  const fitName = (words: string): string => {
    const room = Math.max(60, (root.clientWidth || 300) - 44 - 128);
    if (textWidth(words) * 2 <= room) return words;
    let cut = words.length;
    while (cut > 1 && textWidth(`${words.slice(0, cut).trimEnd()}..`) * 2 > room) cut--;
    return `${words.slice(0, cut).trimEnd()}..`;
  };
  const toneColour: Record<HudTone, PixelColor> = { good: PX.good, bad: PX.bad, dm: PX.gold };
  /** A line of HUD text in the current treatment, with the words kept for screen readers. A tone colours it (green, red, or the DM's gold). */
  const text = (words: string, kind: "title" | "line" | "name" | "num" | "seclabel" | "item", inset = 0, tone?: HudTone): HTMLElement => {
    const node = el("span", `lto-hud-${kind}`);
    if (tone) node.classList.add(`lto-hud-tone-${tone}`);
    if (isPixel()) {
      const gold = kind === "title" || kind === "seclabel";
      const colour = tone ? toneColour[tone] : gold ? PX.gold : kind === "line" ? PX.muted : PX.ink;
      // Titles, lines and pack items wrap to the panel (font pixels are 2 CSS px); names and numbers stay on one line.
      const wrap = kind === "name" || kind === "num" ? undefined : Math.max(40, Math.floor(((root.clientWidth || 300) - 44 - inset) / 2));
      node.append(px(kind === "name" ? fitName(words) : words, { scale: 2, weight: gold || kind === "num" ? "bold" : "regular", color: colour, outline: PX.dark, maxWidth: wrap }), el("span", "lto-sr", words));
    } else {
      node.textContent = words;
    }
    return node;
  };

  const has = (s: HudState | null): Record<DrawerTab, boolean> => ({ pack: !!s?.pack, journal: !!s?.journal, log: !!s?.log, saves: !!s?.saves });
  /** The tab that really shows now. */
  const openTab = (): DrawerTab | null => usableDrawerTab(drawer, has(last));

  function draw(): void {
    const s = last;
    if (!s) return;
    root.classList.toggle("lto-px", isPixel());
    root.classList.toggle("lto-sb", !isPixel());
    // The drawer's list scrolls inside a box that is rebuilt below: note where the reader was.
    const prevList = drawerBox.querySelector<HTMLElement>(".lto-hud-list");
    const tab = openTab();
    const sameTab = !!prevList && prevList.dataset.tab === tab;
    const keep = {
      sameTab,
      scroll: prevList?.scrollTop ?? 0,
      atBottom: !prevList || prevList.scrollHeight - prevList.scrollTop - prevList.clientHeight < 14,
    };
    // A pinned item card stays up through a redraw that did not change the pack (the DM answering, a notice, the turn passing).
    const pinned = tab === "pack" && sameTab && !!s.pack && packSig(s) === drawnPackSig && !!drawerBox.querySelector('.lto-hud-row[aria-expanded="true"]');
    if (!pinned) {
      for (const off of tipOff) off();
      tipOff = [];
    }
    panel.className = "lto-hud-panel";
    if (isPixel()) panel.classList.add("lto-fr", "fr-win");
    else panel.classList.add("lto-plate");
    panel.replaceChildren();
    panel.append(text(s.title, "title"));
    if (s.lines.length) {
      const lines = el("div", "lto-hud-lines");
      for (const l of s.lines) lines.append(text(l, "line"));
      panel.append(lines);
    }
    if (s.bars.length) {
      const bars = el("div", "lto-hud-bars");
      for (const b of s.bars) {
        const row = el("div", "lto-hud-bar");
        row.dataset.side = b.side;
        const meter = el("div", "lto-hud-meter");
        const fill = el("i");
        fill.style.setProperty("--hp", hpColour(b));
        fill.style.width = `${b.max > 0 ? Math.max(0, Math.min(100, (b.hp / b.max) * 100)) : 0}%`;
        meter.append(fill);
        meter.setAttribute("aria-hidden", "true");
        row.append(text(b.label, "name"), meter, text(b.down ? "DOWN" : `${b.hp}/${b.max}`, "num"));
        bars.append(row);
      }
      panel.append(bars);
    }
    drawNext(s);
    drawActions(s);
    drawTabs(s, tab);
    if (!pinned) {
      drawDrawer(s, tab, keep);
      drawnPackSig = tab === "pack" ? packSig(s) : "";
    }
    applyAsk(s.ask);
  }

  // ---- the DM's suggested next moves

  /** The width, in CSS px, a suggestion button's label has: the column, less the frame, the padding, the key and the gap. */
  function optionRoom(columns: 1 | 2, key: string): number {
    const rootW = root.clientWidth || 300;
    const col = columns === 2 ? (rootW - 6) / 2 : rootW;
    return Math.max(40, col - 30 - textWidth(key, "bold") * 2 - 8 - 2);
  }

  function drawNext(s: HudState): void {
    const choices = [
      ...(s.options ?? []).map((o) => ({ id: o.id, label: o.label, key: o.key, enabled: true })),
      ...s.actions.filter((a) => !a.hidden && a.kind === "suggestion").map((a) => ({ id: a.id, label: a.label, key: a.key, enabled: a.enabled })),
    ];
    const { columns, items } = optionsLayout(choices);
    nextLabel.replaceChildren();
    nextList.replaceChildren();
    next.hidden = items.length === 0;
    if (items.length === 0) return;
    nextList.style.setProperty("--cols", String(columns));
    if (isPixel()) nextLabel.append(px("What next?", { scale: 2, color: PX.gold, outline: PX.dark }));
    else nextLabel.textContent = "What next?";
    for (const o of items) {
      const btn = el("button", "lto-hud-btn lto-hud-opt");
      btn.type = "button";
      btn.dataset.option = o.id;
      btn.dataset.key = o.key;
      btn.disabled = !o.enabled;
      btn.setAttribute("aria-label", `${o.full} (${o.key})`);
      if (o.full !== o.label) btn.title = o.full;
      const label = el("span", "lto-hud-opt-label");
      if (isPixel()) {
        btn.classList.add("lto-fr", "fs1", "fr-gold");
        // Wrapped and cut to two lines here, since a canvas cannot wrap itself.
        const lines = wrapClamp(o.label, wrapWidth(optionRoom(columns, o.key), 2, deviceRatio()), 2);
        label.append(px(lines.join("\n"), { scale: 2, color: PX.ink, outline: PX.dark }));
        btn.append(px(o.key, { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark }), label);
      } else {
        label.textContent = o.label;
        btn.append(el("span", "lto-hud-key", o.key), label);
      }
      btn.onclick = () => onAction(o.id);
      nextList.append(btn);
    }
  }

  // ---- the game's own buttons: only the ones that do something now

  function drawActions(s: HudState): void {
    const shown = s.actions.filter((a) => !a.hidden && a.kind !== "suggestion");
    actions.hidden = shown.length === 0;
    actions.replaceChildren();
    for (const a of shown) {
      const btn = el("button", "lto-hud-btn");
      btn.type = "button";
      btn.dataset.action = a.id;
      btn.disabled = !a.enabled;
      if (a.emphasis) btn.classList.add("is-now");
      // The thin frame: a button needs its width for the label and the key.
      if (isPixel()) btn.classList.add("lto-fr", "fs1", a.emphasis ? "fr-gold" : "fr-win");
      btn.setAttribute("aria-label", a.key ? `${a.label} (${a.key})` : a.label);
      if (isPixel()) {
        btn.append(px(a.label, { scale: 2, weight: "bold", color: a.emphasis ? PX.gold : PX.ink, outline: PX.dark }));
        if (a.key) btn.append(px(a.key, { scale: 2, color: PX.muted, outline: PX.dark }));
      } else {
        btn.append(el("span", undefined, a.label));
        if (a.key) btn.append(el("span", "lto-hud-key", a.key));
      }
      btn.onclick = () => onAction(a.id);
      actions.append(btn);
    }
  }

  // ---- the drawer: Pack, Log, Saves

  const TAB_WORDS: Record<DrawerTab, { label: string; key?: string }> = { pack: { label: "Pack", key: "I" }, journal: { label: "Journal", key: "J" }, log: { label: "Log", key: "L" }, saves: { label: "Saves" } };

  function drawTabs(s: HudState, tab: DrawerTab | null): void {
    const have = has(s);
    const shown = DRAWER_TABS.filter((t) => have[t]);
    tabs.hidden = shown.length === 0;
    tabs.style.setProperty("--n", String(drawerColumns(shown.length)));
    tabs.replaceChildren();
    for (const t of shown) {
      const { label, key } = TAB_WORDS[t];
      const open = tab === t;
      const btn = el("button", "lto-hud-btn lto-hud-tab");
      btn.type = "button";
      btn.dataset.hudDrawer = t;
      if (t === "pack") btn.dataset.hudPack = "";
      btn.setAttribute("aria-label", key ? `${label} (${key})` : label);
      btn.setAttribute("aria-pressed", String(open));
      btn.setAttribute("aria-expanded", String(open));
      if (t === "pack" && !open && pendingNew.size > 0) btn.dataset.new = "true";
      if (t === "journal" && !open && journalNew) btn.dataset.new = "true";
      if (isPixel()) {
        btn.classList.add("lto-fr", "fs1", open ? "fr-gold" : "fr-win");
        btn.append(px(label, { scale: 2, weight: "bold", color: open ? PX.gold : PX.ink, outline: PX.dark }));
        if (key) btn.append(px(key, { scale: 2, color: PX.muted, outline: PX.dark }));
      } else {
        btn.append(el("span", undefined, label));
        if (key) btn.append(el("span", "lto-hud-key", key));
        if (open) btn.classList.add("is-open");
      }
      btn.onclick = () => toggleTab(t);
      tabs.append(btn);
    }
  }

  function drawDrawer(s: HudState, tab: DrawerTab | null, keep: { sameTab: boolean; scroll: number; atBottom: boolean }): void {
    drawerBox.className = "lto-hud-drawer";
    drawerBox.hidden = tab === null;
    drawerBox.replaceChildren();
    if (tab === null) {
      delete drawerBox.dataset.tab;
      return;
    }
    drawerBox.dataset.tab = tab;
    drawerBox.setAttribute("aria-label", TAB_WORDS[tab].label);
    if (isPixel()) drawerBox.classList.add("lto-fr", "fr-win");
    else drawerBox.classList.add("lto-plate");
    if (tab === "pack" && s.pack) drawerBox.append(packView(s.pack.sections, keep.sameTab ? keep.scroll : 0));
    else if (tab === "journal" && s.journal) drawerBox.append(journalView(s.journal, keep.sameTab ? keep.scroll : 0));
    else if (tab === "log" && s.log) drawerBox.append(logView(s.log, keep));
    else if (tab === "saves" && s.saves) drawerBox.append(savesView(s.saves, keep.sameTab ? keep.scroll : 0, { status: s.exportStatus, copy: s.exportCopy }));
  }

  /** The pack list: a heading per section, its items under it, scrolling inside when long. Items in `freshNow` get a brief highlight. */
  function packView(sections: readonly PackSection[], prevScroll: number): HTMLElement {
    const fresh = freshNow;
    freshNow = new Set();
    const wrap = el("div", "lto-hud-pack");
    wrap.dataset.hudPackView = "";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Pack");
    const list = el("div", "lto-hud-pack-list lto-hud-list");
    list.dataset.tab = "pack";
    let firstFresh: HTMLElement | null = null;
    for (const sec of sections) {
      const box = el("div", "lto-hud-sec");
      box.dataset.section = sec.label;
      const head = el("div", "lto-hud-row");
      head.append(text(sec.label, "seclabel", 18));
      box.append(head);
      if (sec.items.length === 0) {
        const none = el("div", "lto-hud-row");
        none.append(text("Nothing", "line", 18));
        box.append(none);
      }
      for (const it of sec.items) {
        const item = packItemText(it);
        const row = el("div", "lto-hud-row");
        row.dataset.item = item;
        if (fresh.has(item)) {
          row.classList.add("is-new");
          row.dataset.new = "true";
          firstFresh ??= row;
        }
        row.append(text(item, "item", 18));
        // An item card (hover facts, a click pins the buttons), or plain hover help: on the row, in the HUD's own style, kept inside the game window.
        if (typeof it !== "string" && it.card) {
          const key = it.key ?? item;
          row.dataset.itemKey = key;
          tipOff.push(attachItemCard(row, it.card, (actionId) => opts.onItemAction?.(key, actionId), { boundary: tipBoundary(), style: () => (isPixel() ? "pixel" : "storybook") }));
        } else if (typeof it !== "string" && it.tip) {
          tipOff.push(attachTip(row, it.tip, { boundary: tipBoundary(), style: () => (isPixel() ? "pixel" : "storybook") }));
        }
        box.append(row);
      }
      list.append(box);
    }
    wrap.append(list);
    if (firstFresh) {
      // Show what just arrived, by scrolling the list itself and never the page. It is measured once the panel is in the page.
      const row: HTMLElement = firstFresh;
      queueMicrotask(() => {
        const bottom = row.offsetTop + row.offsetHeight;
        if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      });
    }
    queueMicrotask(() => {
      if (!firstFresh) list.scrollTop = prevScroll;
    });
    return wrap;
  }

  /** The journal: the adventure and scene, the objectives with their ticks, and the last few beats (newest first). */
  function journalView(j: HudJournal, prevScroll: number): HTMLElement {
    const wrap = el("div", "lto-hud-journalview");
    wrap.dataset.hudJournalView = "";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Journal");
    const list = el("div", "lto-hud-pack-list lto-hud-list lto-hud-journal");
    list.dataset.tab = "journal";
    const row = (node: HTMLElement): HTMLElement => {
      const r = el("div", "lto-hud-row");
      r.append(node);
      return r;
    };
    const story = el("div", "lto-hud-sec");
    story.dataset.section = "Story";
    story.append(row(text(j.title, "seclabel", 18)));
    if (j.scene.trim()) {
      const scene = row(text(`Scene: ${j.scene.trim()}`, "item", 18));
      scene.dataset.journalScene = "";
      story.append(scene);
    }
    list.append(story);
    const objs = journalObjectives(j.objectives);
    const sec = el("div", "lto-hud-sec");
    sec.dataset.section = "Objectives";
    const progress = journalProgress(j.objectives);
    sec.append(row(text("Objectives", "seclabel", 18)));
    if (progress) {
      const pr = row(text(progress, "line", 18));
      pr.dataset.journalProgress = progress;
      sec.append(pr);
    }
    if (objs.length === 0) sec.append(row(text("Nothing to do yet.", "line", 18)));
    for (const o of objs) {
      const r = el("div", "lto-hud-obj");
      r.dataset.objective = o.text;
      r.dataset.done = String(o.done);
      const box = el("span", "lto-hud-box");
      box.setAttribute("aria-hidden", "true");
      if (isPixel()) {
        box.append(spriteCanvas(o.done ? BOX_DONE_ROWS : BOX_ROWS, { M: "#98a5d8", L: "#e6dcb4", G: "#2f9e55", W: "#ffffff" }, 2));
      } else if (o.done) {
        box.classList.add("is-done");
        const svg = svgEl("svg", { viewBox: "0 0 448 512", "aria-hidden": "true", focusable: "false" });
        svg.append(svgEl("path", { d: CHECK_PATH }));
        box.append(svg);
      }
      const words = text(o.text, "item", 18 + 26, o.done ? "good" : undefined);
      r.append(box, words, el("span", "lto-sr", o.done ? " (done)" : " (not done)"));
      sec.append(r);
    }
    list.append(sec);
    const beats = journalRecent(j.recent);
    if (beats.length > 0) {
      const lately = el("div", "lto-hud-sec");
      lately.dataset.section = "Lately";
      lately.append(row(text("Lately", "seclabel", 18)));
      for (const b of beats) {
        const r = el("div", "lto-hud-beat");
        r.dataset.beat = b;
        r.append(text(b, "line", 18));
        lately.append(r);
      }
      list.append(lately);
    }
    wrap.append(list);
    queueMicrotask(() => {
      list.scrollTop = prevScroll;
    });
    return wrap;
  }

  /** The log: every line so far, the newest at the bottom, kept at the bottom unless the reader has scrolled up. */
  function logView(log: readonly HudLogLine[], keep: { sameTab: boolean; scroll: number; atBottom: boolean }): HTMLElement {
    const wrap = el("div", "lto-hud-logview");
    wrap.dataset.hudLogView = "";
    const list = el("div", "lto-hud-pack-list lto-hud-list lto-hud-log");
    list.dataset.tab = "log";
    list.setAttribute("role", "list");
    const { shown, hidden } = logWindow(log);
    if (hidden > 0) {
      const row = el("div", "lto-hud-logrow");
      row.append(text(`${hidden} older lines are not shown.`, "line", 18));
      list.append(row);
    }
    if (shown.length === 0) {
      const row = el("div", "lto-hud-logrow");
      row.append(text("Nothing has happened yet.", "line", 18));
      list.append(row);
    }
    for (const l of shown) {
      const tone = l.tone ?? "plain";
      const row = el("div", "lto-hud-logrow");
      row.setAttribute("role", "listitem");
      row.dataset.tone = tone;
      row.append(text(l.text, "item", 18, tone === "plain" ? undefined : tone));
      list.append(row);
    }
    wrap.append(list);
    queueMicrotask(() => {
      list.scrollTop = keep.sameTab && !keep.atBottom ? keep.scroll : list.scrollHeight;
    });
    return wrap;
  }

  /** The save points, each with a Load button (greyed where it cannot be loaded), or the empty-state line; under them the export row. */
  function savesView(saves: readonly HudSave[], prevScroll: number, exp: { status?: string; copy?: boolean }): HTMLElement {
    const wrap = el("div", "lto-hud-savesview");
    wrap.dataset.hudSavesView = "";
    const list = el("div", "lto-hud-pack-list lto-hud-list lto-hud-saves");
    list.dataset.tab = "saves";
    if (saves.length === 0) {
      const row = el("div", "lto-hud-logrow");
      row.append(text("No saves yet. Rest to save, and every scene start is a checkpoint.", "line", 18));
      list.append(row);
    }
    for (const sv of saves) {
      const row = el("div", "lto-hud-save");
      row.dataset.saveRow = sv.id;
      const info = el("div", "lto-hud-save-info");
      info.append(text(sv.label, "item", 100));
      if (sv.detail) info.append(text(sv.detail, "line", 100));
      const btn = el("button", "lto-hud-btn lto-hud-load");
      btn.type = "button";
      btn.dataset.save = sv.id;
      btn.disabled = !sv.canLoad;
      btn.setAttribute("aria-label", `Load ${sv.label}`);
      if (isPixel()) {
        btn.classList.add("lto-fr", "fs1", "fr-win");
        btn.append(px("Load", { scale: 2, weight: "bold", color: PX.ink, outline: PX.dark }));
      } else {
        btn.append(el("span", undefined, "Load"));
      }
      btn.onclick = () => onAction(`load:${sv.id}`);
      row.append(info, btn);
      list.append(row);
    }
    wrap.append(list);
    // The debug export: everything about this adventure in one file, for finding what went wrong.
    const foot = el("div", "lto-hud-exportrow");
    foot.dataset.hudExportRow = "";
    foot.setAttribute("role", "group");
    foot.setAttribute("aria-label", "Debugging");
    const exportBtn = (label: string, key: string, id: string): HTMLButtonElement => {
      const btn = el("button", "lto-hud-btn lto-hud-export");
      btn.type = "button";
      btn.dataset[key] = "";
      btn.setAttribute("aria-label", label);
      if (isPixel()) {
        btn.classList.add("lto-fr", "fs1", "fr-win");
        const room = Math.max(40, Math.floor(((root.clientWidth || 300) - 76) / 2));
        btn.append(px(label, { scale: 2, weight: "bold", color: PX.ink, outline: PX.dark, maxWidth: room }));
      } else {
        btn.append(el("span", undefined, label));
      }
      btn.onclick = () => onAction(id);
      return btn;
    };
    foot.append(exportBtn("Export adventure (debug)", "export", "export"));
    if (exp.copy) foot.append(exportBtn("Copy adventure JSON", "exportCopy", "export-copy"));
    wrap.append(foot);
    const status = el("div", "lto-hud-export-status");
    status.dataset.hudExportStatus = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = !exp.status;
    if (exp.status) status.append(text(exp.status, "line", 18));
    wrap.append(status);
    queueMicrotask(() => {
      list.scrollTop = prevScroll;
    });
    return wrap;
  }

  function setDrawer(want: DrawerTab | null): void {
    const before = openTab();
    drawer = want;
    // Opening the pack lights up what arrived while it was shut.
    if (openTab() === "pack" && before !== "pack") {
      freshNow = pendingNew;
      pendingNew = new Set();
    }
    if (openTab() === "journal") journalNew = false;
    redraw();
  }

  function toggleTab(tab: DrawerTab): void {
    if (!has(last)[tab]) return;
    setDrawer(toggleDrawerTab(openTab(), tab));
  }

  /** Redraw while keeping keyboard focus on the same button. */
  function redraw(): void {
    const at = document.activeElement as HTMLElement | null;
    let focusKey: [string, string] | null = null;
    if (at && root.contains(at)) {
      for (const k of ["action", "option", "hudDrawer", "save", "export", "exportCopy"]) {
        const v = at.dataset[k];
        if (v !== undefined) {
          focusKey = [k, v];
          break;
        }
      }
    }
    // A pack item holding keyboard focus (for its hover help) keeps it across the rebuild, by its words.
    const rowItem = at && drawerBox.contains(at) && at.classList.contains("lto-hud-row") ? at.dataset.item : undefined;
    draw();
    if (focusKey) {
      for (const b of root.querySelectorAll<HTMLElement>("button")) {
        if (b.dataset[focusKey[0]] === focusKey[1]) {
          b.focus();
          break;
        }
      }
    } else if (rowItem !== undefined) {
      for (const r of drawerBox.querySelectorAll<HTMLElement>(".lto-hud-row[data-item]")) {
        if (r.dataset.item === rowItem) {
          r.focus({ preventScroll: true });
          break;
        }
      }
    }
  }

  // Pixel text is drawn for one width, so a change in the column's width (a resize, the HUD shown after being hidden) redraws it.
  let seenWidth = 0;
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          const w = root.clientWidth;
          if (w === seenWidth) return;
          seenWidth = w;
          if (w > 0 && last && isPixel() && !destroyed) redraw();
        })
      : null;
  ro?.observe(root);

  // ---- notices: small notes that fade (loot, mostly)

  interface Notice {
    node: HTMLElement;
    text: string;
    tone: "good" | "bad" | "plain";
    lease: number;
    timer: number;
    fade: Animation | null;
  }
  const notices: Notice[] = [];

  function fillNotice(n: Notice): void {
    // A note is a chip that sizes to its words, so it wraps only at the column's width less its frame (inset -28 undoes the 44 the panel keeps).
    n.node.replaceChildren(text(n.text, "line", -28, n.tone === "plain" ? undefined : n.tone));
    n.node.classList.remove("lto-fr", "fr-win", "fs1", "lto-plate");
    if (isPixel()) n.node.classList.add("lto-fr", "fr-win", "fs1");
    else n.node.classList.add("lto-plate");
  }

  function dropNotice(n: Notice): void {
    window.clearTimeout(n.timer);
    n.fade?.cancel();
    n.node.remove();
    const at = notices.indexOf(n);
    if (at >= 0) notices.splice(at, 1);
    noticeBox.hidden = notices.length === 0;
  }

  function armNotice(n: Notice): void {
    const lease = ++n.lease;
    window.clearTimeout(n.timer);
    n.timer = window.setTimeout(() => {
      if (destroyed || n.lease !== lease || !notices.includes(n)) return;
      const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof n.node.animate !== "function") return dropNotice(n);
      n.fade = n.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: still ? 120 : NOTICE_OUT_MS, fill: "forwards" });
      n.fade.finished.then(
        () => {
          if (n.lease === lease) dropNotice(n);
        },
        () => {},
      );
    }, NOTICE_MS);
  }

  function noticeNow(words: string, tone: "good" | "bad" | "plain" = "plain"): void {
    const said = words.replace(/\s+/g, " ").trim();
    if (destroyed || !said) return;
    const again = notices.find((n) => n.text === said && n.tone === tone);
    if (again) {
      // The same note again: keep the one showing and give it a fresh stay (a fade already running is stopped).
      again.fade?.cancel();
      again.fade = null;
      armNotice(again);
      return;
    }
    for (let i = noticeOverflow(notices.length); i > 0 && notices[0]; i--) dropNotice(notices[0]);
    const node = el("div", "lto-hud-notice");
    node.dataset.hudNotice = "";
    node.dataset.tone = tone;
    node.dataset.text = said;
    const n: Notice = { node, text: said, tone, lease: 0, timer: 0, fade: null };
    fillNotice(n);
    notices.push(n);
    noticeBox.append(node);
    noticeBox.hidden = false;
    armNotice(n);
  }

  // ---- the freehand line

  let askKey = "";
  /** Set when a line is sent from the field: it is disabled while the DM answers, which drops focus, so the field takes it back after. */
  let refocusAsk = false;

  function sendAsk(): void {
    if (askInput.disabled) return;
    const words = askInput.value.trim();
    if (!words) return;
    const at = document.activeElement;
    refocusAsk = at === askInput || (at === askSend && typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches);
    askInput.value = "";
    opts.onAsk?.(words);
  }
  // Typing must never reach the bench's own keys (arrows, WASD, F, E, Q, T, I, L, 1 to 4), so every key event stops here.
  askInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      sendAsk();
    } else if (e.key === "Escape") {
      e.preventDefault();
      askInput.blur();
    }
  });
  askInput.addEventListener("keyup", (e) => e.stopPropagation());
  askInput.addEventListener("keypress", (e) => e.stopPropagation());
  askSend.addEventListener("click", sendAsk);

  function applyAsk(a: HudState["ask"]): void {
    const show = !!a && !!opts.onAsk;
    askBox.hidden = !show;
    if (!a || !show) return;
    const off = !a.enabled || !!a.busy;
    askInput.disabled = off;
    askSend.disabled = off;
    askInput.placeholder = a.placeholder ?? "What do you do?";
    const words = a.busy ? (a.status ?? "The DM is thinking...") : (a.status ?? "");
    // The status redraws only when the look or the words change, so the live region does not repeat itself.
    const key = `${isPixel()}|${words}|${root.clientWidth}`;
    if (key !== askKey) {
      askKey = key;
      askStatus.hidden = words === "";
      askStatus.replaceChildren(...(words ? [text(words, "line")] : []));
    }
    for (const node of [askInput, askSend]) {
      node.classList.toggle("lto-fr", isPixel());
      node.classList.toggle("fs1", isPixel());
      node.classList.toggle("fr-win", isPixel());
    }
    askSend.replaceChildren(isPixel() ? px("Do it", { scale: 2, weight: "bold", color: PX.ink, outline: PX.dark }) : el("span", undefined, "Do it"));
    if (!off && refocusAsk) {
      refocusAsk = false;
      const at = document.activeElement;
      if (!at || at === document.body) askInput.focus({ preventScroll: true });
    }
  }

  const api: Hud = {
    setStyle(to: TextStyle): void {
      if (to === style) return;
      style = to;
      for (const n of notices) fillNotice(n);
      redraw();
    },
    render(state: HudState): void {
      // Rebuilt only when what it shows changed: a turn is a handful of changes, not one per frame.
      const key = JSON.stringify(state) + style;
      if (key === lastKey) return;
      lastKey = key;
      // What is new in the pack since the last look lights up if the pack is open, and otherwise waits for it to be opened.
      const added = newPackItems(prevPack, state.pack?.sections);
      prevPack = state.pack?.sections ?? null;
      if (drawer === "pack" && state.pack) freshNow = added;
      else for (const item of added) pendingNew.add(item);
      const jsig = state.journal ? JSON.stringify([state.journal.scene, journalObjectives(state.journal.objectives), journalRecent(state.journal.recent)]) : null;
      if (jsig !== null && prevJournal !== null && jsig !== prevJournal && drawer !== "journal") journalNew = true;
      if (jsig === null) journalNew = false;
      prevJournal = jsig;
      last = state;
      redraw();
    },
    togglePack(): void {
      toggleTab("pack");
    },
    toggleLog(): void {
      toggleTab("log");
    },
    toggleSaves(): void {
      toggleTab("saves");
    },
    toggleJournal(): void {
      toggleTab("journal");
    },
    openDrawer(tab: DrawerTab): void {
      if (!has(last)[tab]) return;
      setDrawer(tab);
    },
    closeDrawer(): void {
      if (openTab() === null) return;
      setDrawer(null);
    },
    isPackOpen(): boolean {
      return openTab() === "pack";
    },
    isDrawerOpen(): boolean {
      return openTab() !== null;
    },
    drawerTab(): DrawerTab | null {
      return openTab();
    },
    notice: noticeNow,
    destroy(): void {
      destroyed = true;
      for (const off of tipOff) off();
      tipOff = [];
      for (const n of Array.from(notices)) dropNotice(n);
      ro?.disconnect();
      root.remove();
    },
  };
  return api;
}

export interface OverlayDemoOptions {
  /** Multiplies every pause. Default 1; 0 runs the whole thing back to back. */
  pace?: number;
  /** Called (and awaited) as each step begins, so a harness can screenshot it. */
  onStep?: (name: string) => void | Promise<void>;
}

/**
 * Cycles every element once: the initiative strip, each banner, floating
 * numbers of every kind, two stacked roll plates, dialogue in each tone, a
 * toast. It leaves the story lines (until they fade) and the strip on screen (call clear()
 * to wipe them). Resolves when the last banner is gone.
 */
export async function overlayDemo(overlay: Overlay, opts: OverlayDemoOptions = {}): Promise<void> {
  const inner = internals.get(overlay);
  const W = inner?.root.clientWidth || 480;
  const H = inner?.root.clientHeight || 320;
  const pace = opts.pace ?? 1;
  const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * pace));
  const step = async (name: string) => {
    await opts.onStep?.(name);
  };

  const hero = { x: Math.round(W * 0.3), y: Math.round(H * 0.62) };
  const goblin = { x: Math.round(W * 0.68), y: Math.round(H * 0.5) };
  const entries: InitiativeEntry[] = [
    { id: "hero", label: "Aldric", total: 17, side: "hero" },
    { id: "goblin", label: "Goblin", total: 12, side: "enemy" },
  ];

  await step("say");
  overlay.say({ text: "A goblin spots you across the room." });
  await pause(300);
  await step("banner-initiative");
  const b1 = overlay.banner("Roll initiative", "initiative");
  await pause(500);
  overlay.initiative(entries, null, 1);
  await b1;

  await step("banner-turn");
  overlay.initiative(entries, "hero", 1);
  await overlay.banner("Your turn", "turn");

  await step("plate-hit");
  overlay.rollPlate(goblin, {
    roll: 14,
    modifier: 5,
    total: 19,
    target: 15,
    hit: true,
    sources: [
      { label: "Strength and training", amount: 3 },
      { label: "Keen Longsword", amount: 2 },
    ],
    caption: "Aldric attacks the goblin",
  });
  overlay.rollPlate(goblin, { roll: 20, modifier: 5, total: 25, target: 15, hit: true, critical: true, caption: "Aldric attacks the goblin" });
  await pause(900);
  await step("floats");
  overlay.say({ speaker: "Aldric", text: "Longsword attack: 14 + 5 = 19 against AC 15. Hit!" });
  overlay.float({ x: goblin.x, y: goblin.y }, "-6", "damage");
  await pause(350);
  overlay.float({ x: goblin.x, y: goblin.y }, "-6", "damage");
  overlay.float({ x: goblin.x, y: goblin.y }, "-3", "damage");
  await pause(500);
  overlay.float({ x: goblin.x, y: goblin.y }, "-14 CRIT!", "crit");
  overlay.float({ x: hero.x, y: hero.y }, "MISS", "miss");
  overlay.float({ x: hero.x + 90, y: hero.y }, "+5", "heal");
  overlay.float({ x: goblin.x - 120, y: goblin.y + 20 }, "Poisoned", "info");
  await pause(700);
  overlay.float({ x: goblin.x, y: goblin.y }, "DOWN", "down");
  overlay.say({ speaker: "Goblin", text: "Shinies! Give!", tone: "bad" });
  overlay.say({ text: "You drink a healing potion and recover 5 hit points.", tone: "good" });
  await pause(600);
  await step("toast");
  overlay.toast("The goblin is too far away to reach this turn.");
  await pause(900);
  await step("banner-enemy");
  overlay.initiative(entries, "goblin", 1);
  await overlay.banner("Goblin's turn", "enemy");
  await step("banner-victory");
  await overlay.banner("Victory", "victory");
  await step("banner-defeat");
  await overlay.banner("Defeat", "defeat");
  // Let the last plate and floats finish too, so "done" means the screen is quiet.
  for (let i = 0; i < 160 && inner && inner.root.dataset.busy !== "0"; i++) await new Promise<void>((r) => setTimeout(r, 50));
  await step("done");
}
