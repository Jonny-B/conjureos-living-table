/**
 * Save points: a small, pure, versioned store of "go back to here" snapshots.
 *
 * Generic on purpose. The payload (`data`) is the caller's own snapshot (the
 * bench saves its whole play state, the game will save a character's sheet,
 * position and the DM's memory) and is opaque here: this module never looks
 * inside it. It only decides which saves to keep, how to write them to text
 * and read them back safely, and how to describe them in words. No DOM, no
 * storage access, no clock reads except the optional `now` arguments, so every
 * rule below runs in plain Node.
 *
 * Three kinds, each trimmed on its own so a run of automatic checkpoints can
 * never push out the long-rest saves a player is relying on:
 *   - "rest": written by a long rest (the once-a-day rest in the SRD).
 *   - "checkpoint": written automatically when a scene starts.
 *   - "manual": written on request.
 *
 * The long-rest gate for the bench and the game is `restBlockedReason` here:
 * the sheet's own rule first (health.ts), then the table-side refusals the
 * sheet cannot know about (a fight on, enemies awake or in sight).
 */
import type { CharacterSheet } from "../characters/creation";
import { longRestBlockedReason } from "../characters/health";

export type SaveKind = "rest" | "checkpoint" | "manual";

export interface SavePoint<T = unknown> {
  id: string;
  kind: SaveKind;
  /** Short words for the Saves list, e.g. "start of the scene". May be empty. */
  label: string;
  /** ISO 8601 timestamp of when the save was made. */
  savedAt: string;
  /** SAVE_FORMAT_VERSION at write time. A save of any other version is dropped on load, never half-read. */
  version: number;
  /** The caller's snapshot. Opaque to this module. */
  data: T;
}

/** Bump when the SavePoint envelope changes shape. The payload's own shape is the caller's to version. */
export const SAVE_FORMAT_VERSION = 1;

/** How many saves of each kind are kept. The oldest of a kind falls off first. */
export const SAVES_KEEP: Readonly<Record<SaveKind, number>> = Object.freeze({
  rest: 3,
  checkpoint: 3,
  manual: 3,
});

/** The largest single save (its JSON text, in UTF-8 bytes) parseSaves will accept. */
export const SAVE_MAX_BYTES = 200 * 1024;

/** The largest stored text parseSaves will even try to read: every kept save at its size limit, plus slack. */
const MAX_TEXT_BYTES = (SAVES_KEEP.rest + SAVES_KEEP.checkpoint + SAVES_KEEP.manual) * SAVE_MAX_BYTES + 64 * 1024;

const KINDS: readonly SaveKind[] = Object.freeze(["rest", "checkpoint", "manual"] as const);

function isSaveKind(value: unknown): value is SaveKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Build a save. `now` and `id` are for tests and for callers that need a stable id. */
export function makeSavePoint<T>(kind: SaveKind, label: string, data: T, now: Date = new Date(), id?: string): SavePoint<T> {
  return {
    id: id ?? `${kind}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    label,
    savedAt: now.toISOString(),
    version: SAVE_FORMAT_VERSION,
    data,
  };
}

/** Keep the first SAVES_KEEP[kind] of each kind, in the order given. */
function trimPerKind<T>(saves: readonly SavePoint<T>[]): SavePoint<T>[] {
  const seen: Record<SaveKind, number> = { rest: 0, checkpoint: 0, manual: 0 };
  const out: SavePoint<T>[] = [];
  for (const s of saves) {
    if (seen[s.kind] >= SAVES_KEEP[s.kind]) continue;
    seen[s.kind] += 1;
    out.push(s);
  }
  return out;
}

/**
 * Put a save at the front (newest first), replace any older save with the same
 * id, then trim each kind to SAVES_KEEP. The newest save is first of its kind
 * and every keep count is at least 1, so it is never the one dropped. Returns a
 * new array and never mutates the input.
 */
export function addSave<T>(saves: readonly SavePoint<T>[], save: SavePoint<T>): SavePoint<T>[] {
  return trimPerKind([save, ...saves.filter((s) => s.id !== save.id)]);
}

/** The newest save, optionally only among the given kinds. The list is newest first, so this is the first match. */
export function latestSave<T>(saves: readonly SavePoint<T>[], kinds?: readonly SaveKind[]): SavePoint<T> | undefined {
  return saves.find((s) => !kinds || kinds.includes(s.kind));
}

/** The text a store writes (localStorage on the bench). A JSON array of SavePoints, newest first. */
export function serializeSaves<T>(saves: readonly SavePoint<T>[]): string {
  return JSON.stringify(saves);
}

/**
 * Read what serializeSaves wrote. Never throws. A bad store is a store with
 * fewer saves, never a crash: garbage text, a non-array, or text over the size
 * budget gives []; inside an array, each entry that is malformed, of another
 * format version, over SAVE_MAX_BYTES, a repeat id, or rejected by the optional
 * `validate` (a guard for the caller's own payload) is dropped on its own and
 * the rest are kept. Kept entries are trimmed per kind like addSave does.
 */
export function parseSaves<T>(text: string | null | undefined, validate?: (data: unknown) => data is T): SavePoint<T>[] {
  if (typeof text !== "string" || text.length === 0) return [];
  // length is UTF-16 units, at most bytes, so this is a cheap pre-check that never rejects a legal store.
  if (text.length > MAX_TEXT_BYTES) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const kept: SavePoint<T>[] = [];
  for (const entry of raw) {
    const save = readEntry<T>(entry, validate);
    if (!save || ids.has(save.id)) continue;
    ids.add(save.id);
    kept.push(save);
  }
  return trimPerKind(kept);
}

function readEntry<T>(entry: unknown, validate?: (data: unknown) => data is T): SavePoint<T> | null {
  try {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) return null;
    if (!isSaveKind(e.kind)) return null;
    if (typeof e.label !== "string") return null;
    if (typeof e.savedAt !== "string" || Number.isNaN(Date.parse(e.savedAt))) return null;
    if (e.version !== SAVE_FORMAT_VERSION) return null;
    if (e.data === undefined) return null;
    if (byteLength(JSON.stringify(entry)) > SAVE_MAX_BYTES) return null;
    if (validate && !validate(e.data)) return null;
    return { id: e.id, kind: e.kind, label: e.label, savedAt: e.savedAt, version: e.version, data: e.data as T };
  } catch {
    return null;
  }
}

function ageWords(savedAt: string, now: Date): string | null {
  const then = Date.parse(savedAt);
  if (Number.isNaN(then)) return null;
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 60) return "just now"; // also covers a save stamped slightly in the future by clock skew
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, "day");
  return `on ${savedAt.slice(0, 10)}`;
}

/** The Saves list line: "Long rest, 2 minutes ago", "Checkpoint: start of the scene, just now". */
export function saveLabel(save: SavePoint, now: Date = new Date()): string {
  const label = save.label.trim();
  let what: string;
  if (save.kind === "rest") {
    what = label && label.toLowerCase() !== "long rest" ? `Long rest: ${label}` : "Long rest";
  } else if (save.kind === "checkpoint") {
    what = label ? `Checkpoint: ${label}` : "Checkpoint";
  } else {
    what = label || "Saved game";
  }
  const age = ageWords(save.savedAt, now);
  return age ? `${what}, ${age}` : what;
}

/**
 * Why a long rest (and so a rest save) is refused right now, in plain words, or
 * null when it is allowed. The sheet's own rule comes first (dead, dying, this
 * day's sleep already spent), then what the sheet cannot know: a fight on,
 * enemies awake and nearby, or an enemy in sight. `hostileInSight` is for any
 * enemy the player can see, asleep or not, so nobody camps in front of one.
 */
export function restBlockedReason(
  sheet: CharacterSheet,
  ctx: { inFight: boolean; hostileAwake: boolean; hostileInSight: boolean },
): string | null {
  const own = longRestBlockedReason(sheet);
  if (own) return own;
  if (ctx.inFight) return "Not in the middle of a fight.";
  if (ctx.hostileAwake) return "Not with enemies awake and nearby.";
  if (ctx.hostileInSight) return "Not with an enemy in sight. Deal with it or get out of its view first.";
  return null;
}
