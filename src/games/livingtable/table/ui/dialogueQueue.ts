/**
 * The dialogue box's queue: text speeds, word wrapping, pagination, and createDialogueQueue (pure; the overlay draws it and runs its clock).
 */
import type { TextSpeed, DialogueTone } from "./overlayTypes";
import { stripHoldMs } from "./overlayMath";

// ---- the dialogue box: one queue for all story text (pure, unit tested) ------

export const TEXT_SPEEDS: readonly TextSpeed[] = ["slow", "normal", "fast", "instant"];
/** Characters printed a second at each speed ("instant" prints a whole page at once). */
export const TEXT_SPEED_CPS: Readonly<Record<TextSpeed, number>> = { slow: 22, normal: 45, fast: 90, instant: Number.POSITIVE_INFINITY };
export const DEFAULT_TEXT_SPEED: TextSpeed = "normal";

/** A text speed from anything a host may hand over (a saved setting): the speed itself, or the default for anything else. */
export function textSpeedOf(value: unknown): TextSpeed {
  return typeof value === "string" && (TEXT_SPEEDS as readonly string[]).includes(value) ? (value as TextSpeed) : DEFAULT_TEXT_SPEED;
}

/** How many characters of a page show after `elapsedMs` of printing at a speed (all of them at once for "instant"). */
export function typedChars(elapsedMs: number, speed: TextSpeed): number {
  const cps = TEXT_SPEED_CPS[speed];
  if (!Number.isFinite(cps)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Math.max(0, elapsedMs) / 1000) * cps));
}

/** An overlay shorter than this (CSS px) holds three rows in its dialogue box, not four: the dock would eat a fifth of the board. */
export const DIALOGUE_TALL_PX = 640;

/**
 * The text rows the dialogue box holds: 3 on a phone-width board, and 3 where the overlay is shorter than DIALOGUE_TALL_PX (`height`, left
 * out when it is not known); 4 elsewhere. It never holds more, and it never scrolls.
 */
export function dialogueLines(size: "s" | "m" | "l", height = Number.POSITIVE_INFINITY): number {
  if (size === "s") return 3;
  return height < DIALOGUE_TALL_PX ? 3 : 4;
}

/**
 * Greedy word wrap: the lines of `text` (spaces collapsed, a newline always breaks, blank lines dropped), each no wider than
 * `maxWidth` by `measure`. A word is never split to make a line fit, except one wider than a whole line, which has to break
 * between letters or it would run out of the box.
 */
export function wrapWords(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  const room = Math.max(1, maxWidth);
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      if (word === "") continue;
      const tryLine = cur === "" ? word : `${cur} ${word}`;
      if (measure(tryLine) <= room) {
        cur = tryLine;
        continue;
      }
      if (cur !== "") {
        lines.push(cur);
        cur = "";
      }
      if (measure(word) <= room) {
        cur = word;
        continue;
      }
      let piece = "";
      for (const ch of word) {
        if (piece !== "" && measure(piece + ch) > room) {
          lines.push(piece);
          piece = "";
        }
        piece += ch;
      }
      cur = piece;
    }
    if (cur !== "") lines.push(cur);
  }
  return lines;
}

/** Lines cut into pages of at most `perPage` lines each (at least one line a page). */
export function paginateLines(lines: readonly string[], perPage: number): string[][] {
  const n = Math.max(1, Math.floor(perPage));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += n) pages.push(lines.slice(i, i + n));
  return pages;
}

/** Text as pages that fit the box: wrapped to `maxWidth` by `measure`, then cut into pages of `perPage` lines. */
export function dialoguePages(text: string, measure: (s: string) => number, maxWidth: number, perPage: number): string[][] {
  return paginateLines(wrapWords(text, measure, maxWidth), perPage);
}

const storyWords = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Whether two story texts say the same thing: equal once case and punctuation are ignored, or (for texts of some length) one is
 * wholly inside the other, which is how the DM restating a place's read-aloud shows up.
 */
export function sameStory(a: string, b: string): boolean {
  const x = storyWords(a);
  const y = storyWords(b);
  if (x === "" || y === "") return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 24 && long.includes(short);
}

/** What goes into the queue. `open` is a text that may still grow (a streaming reply); finish() closes it. */
export interface DialogueInput {
  speaker?: string;
  text: string;
  tone?: DialogueTone;
  sticky?: boolean;
  open?: boolean;
  /** Say it again even if the same words closed a moment ago (a refusal answering a repeated click). Words still waiting are never doubled. */
  repeat?: boolean;
}

/** The entry on show, as the box draws it. */
export interface DialogueView {
  id: number;
  speaker: string;
  tone: DialogueTone;
  sticky: boolean;
  /** The whole entry text so far (the typewriter shows only part of it). */
  text: string;
  open: boolean;
  /** The entry cut into pages of lines. Empty while there is nothing to draw yet (the "..." of a reply that has not started). */
  pages: readonly (readonly string[])[];
  page: number;
  /** How many characters of this page show now (the page's lines joined by newlines). */
  shown: number;
  /** How many characters this page has in all. */
  pageChars: number;
  /** Everything on this page is printed. */
  complete: boolean;
  /** No text to draw yet. */
  thinking: boolean;
  /** Another page or entry is waiting (only once this page is complete). */
  more: boolean;
  /** Entries waiting behind this one. */
  queued: number;
}

/** What a press did: finished the page, turned to the next page, moved to the next entry, closed the box, or nothing (still waiting on a stream). */
export type DialoguePress = "finish" | "page" | "next" | "close" | "none";

export interface DialogueQueueOptions {
  /** An entry's text as pages of lines that fit the box (it measures; the queue never does). */
  layout(text: string): string[][];
  /** How long the last entry waits once it is all printed before it closes, by the characters on its last page. Default stripHoldMs. Infinity never closes it by itself (the story screen). */
  reading?(chars: number): number;
  now?(): number;
  /** Entries kept waiting; the oldest waiting ones go first past it (the Log has them all). Default 12. */
  maxQueued?: number;
  speed?: TextSpeed;
}

export interface DialogueQueue {
  /** Queue an entry. Returns its id, or null when it was dropped (nothing to say, or it repeats one waiting or just closed). */
  push(input: DialogueInput): number | null;
  setText(id: number, text: string): void;
  setSpeaker(id: number, speaker: string): void;
  /** The text is complete. An entry that ended with nothing in it goes away. */
  finish(id: number): void;
  drop(id: number): void;
  /** Remove entries: all of them, or only the sticky ones. Returns how many went. */
  dismiss(opts?: { stickyOnly?: boolean }): number;
  clear(): void;
  /** Advance the typewriter and the reading time by `dtMs`. `changed` is whether anything on screen differs; `closed` is the last entry timing out. */
  tick(dtMs: number): { changed: boolean; closed: boolean };
  press(): DialoguePress;
  /** Whether the clock has anything to do: text still printing, or the last entry counting down its reading time. A box waiting for a click needs none. */
  needsTick(): boolean;
  view(): DialogueView | null;
  size(): number;
  setSpeed(speed: TextSpeed): void;
  /** The layout changed (a resize, another text style): pages are cut again and the reader keeps their place. */
  relayout(): void;
}

interface QueueEntry {
  id: number;
  speaker: string;
  text: string;
  tone: DialogueTone;
  sticky: boolean;
  open: boolean;
  pages: string[][] | null;
}

const DEDUPE_RECENT_MS = 3000;

export function createDialogueQueue(o: DialogueQueueOptions): DialogueQueue {
  const reading = o.reading ?? ((chars: number) => stripHoldMs(chars));
  const now = o.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const maxQueued = Math.max(1, o.maxQueued ?? 12);
  let speed: TextSpeed = o.speed ?? DEFAULT_TEXT_SPEED;
  const entries: QueueEntry[] = [];
  let nextId = 1;
  let page = 0;
  let shownF = 0;
  let holdMs = 0;
  let lastClosed: { text: string; at: number } | null = null;

  const pageLen = (pg: readonly string[] | undefined): number => (pg ? pg.join("\n").length : 0);
  /** An entry still growing is laid out only as far as its last whole word, so a word being typed never jumps lines. */
  const laidText = (e: QueueEntry): string => (e.open && !/\s$/.test(e.text) ? e.text.replace(/\S+$/, "") : e.text);
  const pagesOf = (e: QueueEntry): string[][] => (e.pages ??= o.layout(laidText(e)));
  const resetProgress = (): void => {
    page = 0;
    shownF = 0;
    holdMs = 0;
  };
  /** After the head's pages changed: keep the page in range and the printed count inside the page. */
  const settleHead = (): void => {
    const e = entries[0];
    if (!e) return;
    const pgs = pagesOf(e);
    page = Math.max(0, Math.min(page, pgs.length - 1));
    shownF = Math.min(shownF, pageLen(pgs[page]));
  };
  const closeHead = (): void => {
    const e = entries.shift();
    if (e) lastClosed = { text: e.text, at: now() };
    resetProgress();
  };
  const find = (id: number): QueueEntry | undefined => entries.find((e) => e.id === id);
  const drop = (id: number): void => {
    const at = entries.findIndex((e) => e.id === id);
    if (at < 0) return;
    entries.splice(at, 1);
    if (at === 0) resetProgress();
  };

  return {
    push(input) {
      const text = input.text ?? "";
      const open = !!input.open;
      if (!open && text.trim() === "") return null;
      if (text.trim() !== "") {
        if (entries.some((e) => sameStory(e.text, text))) return null;
        if (!input.repeat && lastClosed && now() - lastClosed.at < DEDUPE_RECENT_MS && sameStory(lastClosed.text, text)) return null;
      }
      const e: QueueEntry = { id: nextId++, speaker: input.speaker?.trim() || "DM", text, tone: input.tone ?? "plain", sticky: !!input.sticky, open, pages: null };
      entries.push(e);
      // Too many waiting: the oldest of the waiting go (never the one on show, never one still streaming).
      while (entries.length > maxQueued) {
        const at = entries.findIndex((x, i) => i > 0 && !x.open);
        if (at < 0) break;
        entries.splice(at, 1);
      }
      return e.id;
    },
    setText(id, text) {
      const e = find(id);
      if (!e || e.text === text) return;
      e.text = text;
      e.pages = null;
      if (e === entries[0]) settleHead();
    },
    setSpeaker(id, speaker) {
      const e = find(id);
      if (e) e.speaker = speaker.trim() || "DM";
    },
    finish(id) {
      const e = find(id);
      if (!e) return;
      e.open = false;
      e.pages = null;
      if (e.text.trim() === "") return drop(id);
      // A streamed reply is only known to repeat something once it is whole: the same words waiting ahead of it, or shown a moment ago, and it goes.
      const at = entries.indexOf(e);
      const repeats = entries.slice(0, at).some((x) => sameStory(x.text, e.text)) || (at === 0 && !!lastClosed && now() - lastClosed.at < DEDUPE_RECENT_MS && sameStory(lastClosed.text, e.text));
      if (repeats) return drop(id);
      if (at === 0) settleHead();
    },
    drop,
    dismiss(opts = {}) {
      const before = entries.length;
      const headId = entries[0]?.id;
      for (let i = entries.length - 1; i >= 0; i--) if (!opts.stickyOnly || entries[i]!.sticky) entries.splice(i, 1);
      if (entries[0]?.id !== headId) resetProgress();
      return before - entries.length;
    },
    clear() {
      entries.length = 0;
      resetProgress();
      lastClosed = null;
    },
    tick(dtMs) {
      const e = entries[0];
      if (!e) return { changed: false, closed: false };
      const pgs = pagesOf(e);
      const pg = pgs[page];
      if (!pg) return { changed: false, closed: false };
      const total = pageLen(pg);
      if (shownF < total) {
        const before = Math.floor(shownF);
        const cps = TEXT_SPEED_CPS[speed];
        shownF = Number.isFinite(cps) ? Math.min(total, shownF + (Math.max(0, dtMs) / 1000) * cps) : total;
        holdMs = 0;
        return { changed: Math.floor(shownF) !== before, closed: false };
      }
      // All of this page is printed. The last entry, with nothing behind it and nothing more to come, may time out; anything else waits for a press.
      if (page === pgs.length - 1 && !e.open && !e.sticky && entries.length === 1) {
        const hold = reading(total);
        if (!Number.isFinite(hold)) return { changed: false, closed: false };
        holdMs += Math.max(0, dtMs);
        if (holdMs >= hold) {
          closeHead();
          return { changed: true, closed: true };
        }
      } else holdMs = 0;
      return { changed: false, closed: false };
    },
    press() {
      const e = entries[0];
      if (!e) return "none";
      const pgs = pagesOf(e);
      const pg = pgs[page];
      if (!pg) return "none";
      if (shownF < pageLen(pg)) {
        shownF = pageLen(pg);
        return "finish";
      }
      if (page + 1 < pgs.length) {
        page++;
        shownF = 0;
        holdMs = 0;
        return "page";
      }
      if (e.open) return "none";
      closeHead();
      return entries.length > 0 ? "next" : "close";
    },
    needsTick() {
      const e = entries[0];
      if (!e) return false;
      const pgs = pagesOf(e);
      const pg = pgs[page];
      if (!pg) return false;
      if (shownF < pageLen(pg)) return true;
      return page === pgs.length - 1 && !e.open && !e.sticky && entries.length === 1 && Number.isFinite(reading(pageLen(pg)));
    },
    view() {
      const e = entries[0];
      if (!e) return null;
      const pgs = pagesOf(e);
      const pg = pgs[page];
      const total = pageLen(pg);
      const shown = Math.min(Math.floor(shownF), total);
      const complete = !!pg && shown >= total;
      return {
        id: e.id,
        speaker: e.speaker,
        tone: e.tone,
        sticky: e.sticky,
        text: e.text,
        open: e.open,
        pages: pgs,
        page,
        shown,
        pageChars: total,
        complete,
        thinking: !pg,
        more: complete && (page + 1 < pgs.length || entries.length > 1),
        queued: entries.length - 1,
      };
    },
    size: () => entries.length,
    setSpeed(next) {
      speed = next;
    },
    relayout() {
      const head = entries[0];
      let abs = 0;
      if (head?.pages) {
        for (let i = 0; i < page; i++) abs += pageLen(head.pages[i]);
        abs += shownF;
      }
      for (const e of entries) e.pages = null;
      if (!head) return;
      const pgs = pagesOf(head);
      let i = 0;
      let left = abs;
      while (i < pgs.length - 1 && left > pageLen(pgs[i])) {
        left -= pageLen(pgs[i]);
        i++;
      }
      page = i;
      shownF = Math.min(left, pageLen(pgs[i]));
    },
  };
}
