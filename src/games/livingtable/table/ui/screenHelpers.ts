/**
 * Pure helpers of the adventure screens: the start cards, the AI writer's stages, the ending, the arrival hold, title wrapping.
 */
import type { StartAdventure, StartRoom, EndingOutcome, BannerKind } from "./overlayTypes";

// ---- the adventure screens: pure helpers (unit tested) -----------------------

/** The longest premise the box takes. */
export const PREMISE_MAX = 1000;
/** The longest summary a card prints before it is cut at a sentence. */
export const CARD_SUMMARY_MAX = 260;
/** The longest hook a hero card prints. */
export const HOOK_MAX = 320;
/** The most problems a card lists before "and N more". */
export const PROBLEMS_SHOWN = 4;
/** How long a location or scene banner stays with text under it: this plus 45 ms a character, never more than LOCATION_MAX_MS. The banner now carries a title only (3 s). */
export const LOCATION_BASE_MS = 3500;
const LOCATION_PER_CHAR_MS = 45;
export const LOCATION_MAX_MS = 14000;
/** The most recent beats the journal prints. */
export const JOURNAL_RECENT_MAX = 5;

/**
 * The tag a card wears. The owner's own adventures wear none (every card is theirs, so the tag says nothing); an adventure the AI wrote
 * is tagged "AI written" so it is not taken for one of those. The draft count is for the author's checks and is never drawn.
 */
export function cardBadge(author: "owner" | "ai"): string {
  return author === "ai" ? "AI written" : "";
}

/** Whether the start screen lists the test rooms: yes unless the window's environment says no. */
export function roomsShown(env: { testRooms?: boolean }): boolean {
  return env.testRooms !== false;
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

export function tidy(s: string | undefined): string {
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

/** How long a location or scene banner stays up: 3 s for a title alone, else 3.5 s plus 45 ms a character, never more than 14 s. */
export function locationHoldMs(chars: number): number {
  if (chars <= 0) return 3000;
  return Math.min(LOCATION_MAX_MS, LOCATION_BASE_MS + LOCATION_PER_CHAR_MS * chars);
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
