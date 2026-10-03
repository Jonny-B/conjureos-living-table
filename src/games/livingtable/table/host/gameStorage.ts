/**
 * The game's side of the table window's storage (TableHost.storage): quick saves and
 * the adventures the player has had the DM write, kept in the browser's localStorage.
 *
 * Phase 1 keeps these on the device. They do not follow the player to another browser,
 * and clearing site data loses them. Cross-device saves need a games-db change that
 * this repo cannot make (DECISIONS, D5).
 *
 * The keys are the table's own, and none of them is a key the rest of the game uses
 * (the manifest cache keeps `livingtable:manifest:v3:*`, and the bench keeps its own
 * `livingtable-bench-*` keys, which this never reads):
 *
 *   livingtable:table:v1:saves:<scope>     one entry per save scope
 *   livingtable:table:v1:ai-adventures     the written adventures
 *   livingtable:table:v1:settings          (gameSettings.ts)
 *
 * Every value is a small JSON envelope with a version field, `{ "v": 1, ... }`. A value
 * with another version, or one that is not an envelope at all, reads as "nothing there"
 * and is left alone (a newer build's data is not clobbered by reading it). The next
 * write replaces it. Nothing here throws: storage can be blocked, full or absent (a
 * private window), and the game still plays that visit. The last failure is kept in
 * `lastError()` so a host can say "your saves are not being kept".
 */
import type { TableStorage } from "../host";

/** The version of every envelope this module writes. Bump it when an envelope's shape changes. */
export const STORAGE_VERSION = 1;

/** The keys, in one place so a test or a reset can name them. */
export const TABLE_KEYS = {
  savesPrefix: "livingtable:table:v1:saves:",
  aiAdventures: "livingtable:table:v1:ai-adventures",
  settings: "livingtable:table:v1:settings",
} as const;

/** The part of localStorage the table uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** The browser's localStorage, or null when there is none or touching it throws (some privacy modes). */
export function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read a versioned envelope: the parsed object when it is one at this version, else null. Never throws. */
export function readEnvelope(store: KeyValueStore | null, key: string): Record<string, unknown> | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const env = parsed as Record<string, unknown>;
    return env.v === STORAGE_VERSION ? env : null;
  } catch {
    return null;
  }
}

/** Write a versioned envelope. Returns an error message when it did not go in (blocked, full, no storage), else null. */
export function writeEnvelope(store: KeyValueStore | null, key: string, body: Record<string, unknown>): string | null {
  if (!store) return "This browser is not keeping data for the game.";
  try {
    store.setItem(key, JSON.stringify({ v: STORAGE_VERSION, ...body }));
    return null;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : "The browser would not keep the data.";
  }
}

export interface GameStorageOptions {
  /** Where to keep things. Default: the browser's localStorage (resolved on each use, so it can appear late). */
  store?: KeyValueStore | null;
  /** Told every time a write fails (and not on success). */
  onError?: (message: string) => void;
}

export interface GameStorage extends TableStorage {
  /** The message of the most recent failed write, or null when the last write went in. */
  lastError(): string | null;
}

export function createGameStorage(opts: GameStorageOptions = {}): GameStorage {
  const store = (): KeyValueStore | null => (opts.store !== undefined ? opts.store : browserStore());
  let failure: string | null = null;
  const put = (key: string, body: Record<string, unknown>): void => {
    failure = writeEnvelope(store(), key, body);
    if (failure) opts.onError?.(failure);
  };

  return {
    saves: {
      read(scope) {
        const env = readEnvelope(store(), TABLE_KEYS.savesPrefix + scope);
        return env && typeof env.text === "string" ? env.text : null;
      },
      write(scope, text) {
        put(TABLE_KEYS.savesPrefix + scope, { text });
      },
    },
    aiAdventures: {
      read() {
        const env = readEnvelope(store(), TABLE_KEYS.aiAdventures);
        return env && Array.isArray(env.texts) ? env.texts.filter((t): t is string => typeof t === "string") : [];
      },
      write(texts) {
        put(TABLE_KEYS.aiAdventures, { texts: [...texts] });
      },
    },
    lastError: () => failure,
  };
}
