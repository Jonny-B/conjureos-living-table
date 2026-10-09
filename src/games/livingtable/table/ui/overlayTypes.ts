/**
 * The overlay's public types: points, kinds, dialogue lines, the context menu, the loot window, the adventure screens, and the Overlay interface itself.
 */
import type { RollReadout } from "../../render/canvasRenderer";
import { type TipContent } from "./tip";
import type { HeroPreview } from "./heroPreview";

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
/**
 * One story message for the dialogue box. `speaker` is the tag in the box's corner ("DM" when absent): the DM, a person's name, a
 * place's name, a creature. A `sticky` entry never fades by itself (it waits to be clicked, or for dismissStory): "You are down".
 * A `repeat` entry is said again even when the same words closed a moment ago (a refusal answering a repeated click on a locked door).
 */
export interface DialogueLine {
  speaker?: string;
  text: string;
  tone?: DialogueTone;
  sticky?: boolean;
  repeat?: boolean;
}
/**
 * What the story screen is told: the words the DM tells the player unasked (a place's read-aloud, a scene's opening, a beat). `title`
 * is the heading on the ribbon ("The Copper Kettle"), `speaker` a small line under it (who is telling), `ribbon` the ribbon's colour
 * (gold for a place, the default; blue for a scene).
 */
export interface StoryOptions {
  title?: string;
  speaker?: string;
  text: string;
  ribbon?: BannerKind;
}
/** How fast story text prints: characters a second (TEXT_SPEED_CPS), or all at once. A game setting. */
export type TextSpeed = "slow" | "normal" | "fast" | "instant";
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
 * A DM narration entry in the dialogue box. update() replaces the whole text so far (a streaming reply passes the accumulated
 * text each time, and the typewriter follows it), done() says the text is complete, close() takes the entry away now, and
 * setSpeaker() changes the tag (the DM's reply turned out to be a person speaking). Once the entry is gone (dismissed, cleared,
 * or a duplicate of one already there) every call does nothing.
 */
export interface NarrationHandle {
  update(text: string): void;
  done(): void;
  close(): void;
  setSpeaker(name: string): void;
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
  /** A line can be a text field instead of a button: "Say something to Tobin Hale" with a Send. */
  kind?: "text";
  placeholder?: string;
  onSubmit?: (text: string) => void;
  /** A small gold line for what picking it costs before it happens ("Walks 15 ft first"). */
  note?: string;
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
  /** How many items the file marks for review; kept for the author, never drawn on the card. */
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
  /** A neutral plain-words note shown above the premise box ("a long AI job and takes a few minutes"). It states no price, number or credits. */
  aiNote: string;
  /** An adventure card, or a test room card, was picked (its id). */
  onPick: (id: string) => void;
  /** The premise was written and confirmed. The screen then shows "writing" until setWriting is called. */
  onWrite: (premise: string) => void;
  /** The way back to the main menu (a button at the top, and Escape when the writer card is shut). Absent: no such button. */
  onMenu?: () => void;
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
  /**
   * A short plain-words note shown on the start screen itself (the writer waking, stopped, or done). It stays until the next call;
   * an empty text clears it.
   */
  setNote(text: string): void;
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
  /** The picture and default stats of one class (by chassis), shown on its slide. Without it a slide is words only. */
  preview?: (chassis: string) => HeroPreview;
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
  /**
   * A slim title strip for about 900 ms ("Your turn"), in the top band under the turn strip: the board keeps clear of that band while a
   * fight is on, so a banner never covers the hero. Banners queue; resolves when this one is gone.
   */
  banner(text: string, kind: BannerKind): Promise<void>;
  /** A number that rises about 16 px over about 900 ms and fades over the last 300 ms. Floats on one spot within 300 ms stack upward. */
  float(at: OverlayPoint, text: string, kind: FloatKind): void;
  /** The d20 maths near a point. Plates queue and never overwrite one another. */
  rollPlate(at: OverlayPoint, readout: PlateReadout): void;
  /**
   * Queue a message for the dialogue box at the bottom of the board: where the DM answers the player and creatures and people speak
   * (a place's read-aloud and a scene's opening are story the player did not ask for: they go to storyScreen). Results are not story: the dice tray and the HUD log carry
   * those. One entry shows at a time with its speaker in the corner; the text prints one character at a time (setTextSpeed), is
   * split into pages that fit the box (3 lines on a phone, 4 elsewhere; it never scrolls), and a click (or Space or Enter on the box)
   * finishes the page, then goes to the next page, then the next entry, then closes the box. It never moves past an unread page by
   * itself; the last entry may fade after its reading time. An entry that repeats one already waiting or just shown is dropped.
   */
  say(line: DialogueLine): void;
  /**
   * Story the player did not ask for, on its own screen in the middle of the board: a scrim, a parchment panel with a title ribbon, and
   * the words printed a character at a time (setTextSpeed) in pages of about eight rows. The world is locked while it is up (the
   * dialogue box is hidden, the board takes no click and no key); a click, Enter or Space finishes the page, then turns it, then closes
   * the story. It never closes by itself. A second story told while one is open waits behind it. Resolves when the player has read it.
   * The same words told twice at once are one screen (both tellers are released together).
   */
  storyScreen(opts: StoryOptions): Promise<void>;
  /** Whether a story screen is up (or waiting behind the one that is): the world is locked while it is. */
  storyOpen(): boolean;
  /** Resolves at once when no story is open or waiting, otherwise after the last one has been read. */
  whenStoryClosed(): Promise<void>;
  /** Told with true when the first story opens and false when the last one closes. One handler; null takes it away. */
  onStoryChange(handler: ((open: boolean) => void) | null): void;
  /**
   * The Cancel button of the DM box. While the box shows its dots (the DM is thinking, no word of the reply has come), a small
   * Cancel button stands beside them and calls `handler`; once the first word types, or with a null handler, there is none.
   */
  onDmCancel(handler: (() => void) | null): void;
  /** Take entries out of the dialogue box now: all of them, or with `stickyOnly` just the ones that were kept ("You are down") for the next action. */
  dismissStory(opts?: { stickyOnly?: boolean }): void;
  /**
   * The same box for the DM's voice: an entry (tagged "DM", or the speaker) that shows "..." while it has no text yet and whose text
   * the typewriter follows as it streams in through update(). `full` is accepted and ignored (every entry is paged to fit).
   */
  narrate(opts: { speaker?: string; text: string; full?: boolean }): NarrationHandle;
  /** How fast story text prints. Under reduced motion it is always "instant". Default "normal". */
  setTextSpeed(speed: TextSpeed): void;
  /**
   * The press the dialogue box takes on a click: finish the page, or the next page, or the next entry, or close. Returns whether a
   * box was showing (so the board's skip key can leave its own job alone when this took the press).
   */
  advanceStory(): boolean;
  /** The turn-order strip above the board. An empty array hides it. */
  initiative(entries: readonly InitiativeEntry[], activeId: string | null, round: number): void;
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
   * new adventure with AI" card that opens a premise box with the note and a Write button that asks to confirm before onWrite.
   * Modal: the keys do not reach the game, Tab stays inside, the arrow keys move between cards. One at a time (a new one replaces it).
   */
  startScreen(opts: StartScreenOptions): StartScreen;
  /** After an adventure is picked: "Make your own hero" or a quick start per class, each with that class's hook and starting kit in words. Escape is Back. */
  startHero(opts: StartHeroOptions): StartHero;
  /** The arrival at a place: its name and read-aloud on the story screen (a gold ribbon). The player reads it through before the world unlocks. */
  locationCard(opts: { name: string; readAloud: string }): void;
  /** A scene change: the title and the opening on the story screen (a blue ribbon). */
  sceneCard(opts: { title: string; opening?: string }): void;
  /**
   * The ending: a full-board card with the title, the ending's text, Continue (only when onContinue is given) and Back to the start
   * screen. Modal like the start screen. Escape does what Continue does.
   */
  endingCard(opts: EndingCardOptions): EndingCard;

  /** Drop everything on screen (banners resolve at once), the dialogue box and the initiative strip included, and the context menu (not the loot window). */
  clear(): void;
  destroy(): void;
}
