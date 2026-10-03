/**
 * The game's side of the table window's storage (TableHost.storage): quick saves and
 * the adventures the player has had the DM write. They live on the server (games-db,
 * through bridge/gamesApi.ts ltSave*) so a run resumes on any device, and the browser's
 * localStorage is only an offline cache and the place older saves are migrated from.
 *
 * The window's interface is synchronous (read, write), and stays that way. The server
 * sits behind it:
 *
 *   write(scope, text)   the cache takes the text at once, then a background push sends
 *                        what changed. The window never waits and nothing here throws.
 *   read(scope)          the cache. `ready()` is what fills it from the server, so the
 *                        host that builds the window awaits `storage.ready()` first
 *                        (it times out when offline and the game plays from the cache).
 *
 * What the server holds, one row per key (kinds and limits are the games-db contract):
 *
 *   s:<save id>   one row per save point, kind rest | checkpoint | manual, payload the SavePoint
 *   current       the newest save point again, kind "current", rewritten whenever a newer one exists
 *   ai:<hash>     one row per written adventure, kind ai-adventure, payload { text }
 *
 * Only the "saves" scope (SAVES_SCOPE in snapshot.ts) and the written adventures go to
 * the server. Any other scope stays in the cache alone.
 *
 * Nothing is ever lost quietly. A save lands in the cache before any network call. A
 * refusal or an outage keeps it there, retries when it can (the next write, `sync()`,
 * a timer, the browser coming back online) and says so through `status()` and
 * `lastError()`. The sync bookkeeping (what the server is believed to hold, rows the
 * server refused, the one-time migration of older local saves) is one more envelope in
 * the cache, TABLE_KEYS.sync.
 *
 * Reconciling is union, never overwrite: a save only on the server is pulled in, a save
 * only here is pushed up (that is also the migration of saves made before this change:
 * the first sync uploads them, and after that they count as held), and the per-kind
 * keep counts (savePoints.ts SAVES_KEEP) trim the union newest first. A server row this
 * build cannot read (another save version) is left alone, never deleted.
 *
 * Local keys, all the table's own (the manifest cache keeps `livingtable:manifest:v3:*`
 * and the bench keeps `livingtable-bench-*`, which this never reads):
 *
 *   livingtable:table:v1:saves:<scope>     one entry per save scope
 *   livingtable:table:v1:ai-adventures     the written adventures
 *   livingtable:table:v1:sync              the sync bookkeeping
 *   livingtable:table:v1:settings          (gameSettings.ts)
 *
 * Every value is a small JSON envelope with a version field, `{ "v": 1, ... }`. A value
 * with another version, or one that is not an envelope at all, reads as "nothing there"
 * and is left alone (a newer build's data is not clobbered by reading it).
 */
import {
  LtSaveError,
  isBackendAvailable,
  ltSaveDelete,
  ltSaveGet,
  ltSaveList,
  ltSavePut,
  type LtSaveKind,
  type LtSaveMeta,
  type LtSaveRow,
} from "../../../../bridge/gamesApi";
import { parseSaves, serializeSaves, type SavePoint } from "../../session/savePoints";
import type { TableStorage } from "../host";

/** The version of every envelope this module writes. Bump it when an envelope's shape changes. */
export const STORAGE_VERSION = 1;

/** The keys, in one place so a test or a reset can name them. */
export const TABLE_KEYS = {
  savesPrefix: "livingtable:table:v1:saves:",
  aiAdventures: "livingtable:table:v1:ai-adventures",
  settings: "livingtable:table:v1:settings",
  sync: "livingtable:table:v1:sync",
  /** What a different player's cache is moved to when another player signs in on this browser. */
  backupPrefix: "livingtable:table:v1:backup:",
} as const;

/** The scope the table keeps its book of saves under (the same text as snapshot.ts SAVES_SCOPE; a test holds them together). */
export const SYNCED_SAVES_SCOPE = "saves";
/** The server row holding the newest save point, so a run resumes on any device. */
export const CURRENT_KEY = "current";
export const SAVE_KEY_PREFIX = "s:";
export const AI_KEY_PREFIX = "ai:";

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

// ---- the server -------------------------------------------------------------

/** The four save calls the storage makes. The default is bridge/gamesApi.ts; a test passes its own (a counter, an outage). */
export interface SaveServer {
  list(): Promise<{ saves: LtSaveMeta[] }>;
  get(key: string): Promise<{ save: LtSaveRow | null }>;
  put(key: string, kind: LtSaveKind, label: string, payload: unknown): Promise<{ ok: true; updatedAt: string }>;
  delete(key: string): Promise<{ ok: true }>;
}

/** games-db's save calls, as a SaveServer. Outside ConjureOS they land in gamesApi's in-memory mock. */
export const gamesSaveServer: SaveServer = { list: ltSaveList, get: ltSaveGet, put: ltSavePut, delete: ltSaveDelete };

// ---- status -----------------------------------------------------------------

/**
 * Where the player's saves stand:
 *   local-only  no server to talk to (not inside ConjureOS): saved on this device only
 *   syncing     a push or pull is running
 *   synced      the server holds everything
 *   pending     the server could not be reached; everything is on this device and will be sent when it can
 *   error       something is refused (too big, the account is full) or the device itself would not keep a save
 */
export type SyncState = "local-only" | "syncing" | "synced" | "pending" | "error";

export interface StorageStatus {
  state: SyncState;
  /** What to tell the player, or null when there is nothing to say. */
  message: string | null;
  /** Rows still to send to the server (puts and deletes). */
  pending: number;
  /** When a sync last finished with nothing left to send, or null. */
  lastSyncedAt: string | null;
}

export interface SyncResult {
  ok: boolean;
  /** Rows pulled in from the server. */
  pulled: number;
  /** Rows sent up (puts). */
  pushed: number;
  /** Rows removed from the server. */
  deleted: number;
  pending: number;
  message: string | null;
  /** `ready()` only: it gave up waiting. The sync carries on in the background and `onChange` fires if it brings anything in. */
  timedOut?: boolean;
}

/** One short line for the window's save status. */
export function statusText(s: StorageStatus): string {
  if (s.message) return s.message;
  switch (s.state) {
    case "local-only":
      return "Saved on this device.";
    case "syncing":
      return "Saving...";
    case "pending":
      return "Saved on this device. It will go to your account when the connection is back.";
    case "error":
      return "Some saves are only on this device.";
    default:
      return "Saved to your account.";
  }
}

export const MESSAGES = {
  offline: "Could not reach the save server. Your game is saved on this device and will go to your account when it can.",
  tooLarge: "A save or adventure is too big for the save server, so it stays on this device only.",
  tooMany: "Your account is holding as many saves as it can, so the newest ones are only on this device for now.",
  badKey: "The save server turned down a save, so it stays on this device only.",
  /** Saves are kept on this device only until the game knows who is playing, so one player's saves never go into another's account. */
  ownerUnknown: "Saved on this device. Saving to your account starts once the game knows who is playing.",
} as const;

/** Why the server turned a save down, in plain words, by the reason code the server gave. */
const REFUSAL_REASONS: Record<string, string> = {
  unavailable: "the server kept failing on it",
  wrong_app: "this app is not allowed to keep saves yet",
  unknown_action: "the save service is not switched on yet",
  bad_label: "the save's name was not accepted",
  bad_payload: "the save's contents were not accepted",
  bad_game: "the game name was not accepted",
  rejected: "the request was not accepted",
};

/** The line for a save the server refused for good (not too large, not a bad key: those have their own). It stays on the device. */
export function refusedMessage(code: string): string {
  return `The server refused this save: ${REFUSAL_REASONS[code] ?? "the request was not accepted"}. It stays on this device.`;
}

/** The reasons a server turns a row down for good: it is kept on the device and not sent again. */
const PERMANENT_CODES: ReadonlySet<string> = new Set(["too_large", "bad_key", "bad_kind", "bad_label", "bad_payload", "bad_game", "wrong_app", "unknown_action", "rejected"]);
/**
 * The refusals that say something about the deployment, not about the row (the save service not switched on, this app not allowed yet).
 * They are remembered for this visit only, so the next visit tries again once it has been fixed.
 */
const PER_VISIT_CODES: ReadonlySet<string> = new Set(["wrong_app", "unknown_action", "bad_game", "rejected", "unavailable"]);
/** How many syncs in a row may fail as unavailable on one key, while the server answers the rest, before that key counts as refused. */
const UNAVAILABLE_LIMIT = 3;
/** How many unavailable failures in a row, with no success between, mean the server is out of reach and the push stops. */
const OUTAGE_STREAK = 3;

/** The one line for what the server refused: the most telling reason among them. */
function rejectionMessage(codes: string[]): string {
  if (codes.includes("too_large")) return MESSAGES.tooLarge;
  const other = codes.find((c) => c !== "bad_key" && c !== "bad_kind");
  if (other !== undefined) return refusedMessage(other);
  return MESSAGES.badKey;
}

// ---- options and the object -------------------------------------------------

export interface GameStorageOptions {
  /** Where to keep things. Default: the browser's localStorage (resolved on each use, so it can appear late). */
  store?: KeyValueStore | null;
  /** Told every time a write fails, here or on the server (and not on success). */
  onError?: (message: string) => void;
  /**
   * The server. Default: games-db when the app runs inside ConjureOS, none otherwise (npm run dev and the bench keep
   * saves on the device only). Pass null for none, or a SaveServer. Resolved on each use.
   */
  remote?: SaveServer | null;
  /** How long `ready()` waits for the server before it lets the game start from the cache. Default 4000. */
  readyTimeoutMs?: number;
  /** How long after a failed push to try again. Default 30000; 0 turns the timer off (the next write, sync() or coming back online still retry). */
  retryMs?: number;
  /**
   * Who is signed in, or null when that is not known yet. When it is given and the cache belongs to someone else, that cache is
   * moved aside (TABLE_KEYS.backupPrefix) and this player starts with the server's saves, so one browser never uploads another
   * player's saves into this account. When this option is given and there is a server, an answer of nothing means the owner is
   * unknown and sync is local-only (see GameStorage.waitingForOwner) until it answers and the host calls ownerKnown(). Leave the
   * option out for a storage that has no notion of an owner.
   */
  account?: () => string | null | undefined;
}

export interface GameStorage extends TableStorage {
  /** The message of the most recent failure (the device would not keep a write, or the server refused or was out of reach), or null when the last write and the last sync went through. */
  lastError(): string | null;
  /**
   * Fill the cache from the server and send up whatever is only here (the migration of older local saves on the first run).
   * Await it before building the window so the book of saves reads the merged list. Runs once; later calls give the same answer.
   * Never rejects.
   */
  ready(): Promise<SyncResult>;
  /** Pull and push again now (a "sync now", or after coming back online). Never rejects. */
  sync(): Promise<SyncResult>;
  /**
   * True while a server exists but the game does not know who is playing (GameStorageOptions.account gives nothing). Everything stays
   * on this device in that time: nothing is pulled, nothing is pushed, and the cache is not taken as the signed-in player's. A host
   * should not resume into the newest save on its own while this is true.
   */
  waitingForOwner(): boolean;
  /**
   * The host calls this once `account()` can answer (it asked who is signed in again and got an answer). It runs a full sync, which
   * checks whose cache this is first. While the owner is still unknown it does nothing and says so. Never rejects.
   */
  ownerKnown(): Promise<SyncResult>;
  /** Send what changed since the last push, no pull. Writes call this themselves; it is here so a caller can wait for it. Never rejects. */
  flush(): Promise<SyncResult>;
  status(): StorageStatus;
  /** Called whenever the status changes. Returns the unsubscribe. */
  onStatus(cb: (s: StorageStatus) => void): () => void;
  /** Called after a pull changed the cache (a save or adventure that came from another device). Returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Stop the retry timer and the online listener. Safe to call twice. */
  dispose(): void;
}

interface SyncEnv {
  /** The rows (s: and ai:) the server is believed to hold. */
  known: Set<string>;
  /** The id of the save point the "current" row holds, and its time on the server. */
  currentId: string | null;
  currentStamp: string | null;
  /** Rows the server refused for good (too big, bad key), by key, with the reason code. They stay local and are not sent again. */
  rejected: Record<string, string>;
  /** True once a sync has gone through once: the older local saves have been offered to the server. */
  migrated: boolean;
  lastSyncedAt: string | null;
  owner: string | null;
}

const emptyEnv = (): SyncEnv => ({ known: new Set(), currentId: null, currentStamp: null, rejected: {}, migrated: false, lastSyncedAt: null, owner: null });

/** A fast 53-bit string hash (cyrb53), base 36. Names a written adventure's row from its text. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The server key of a save point: `s:` and its id with anything outside a-z, 0-9, _ and - made an underscore, within the 80-character limit. */
export function saveRowKey(id: string): string {
  return SAVE_KEY_PREFIX + id.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80 - SAVE_KEY_PREFIX.length);
}

/** The server key of a written adventure. */
export function aiRowKey(text: string): string {
  return `${AI_KEY_PREFIX}${hashText(text)}-${text.length.toString(36)}`;
}

/** A written adventure's label: its first heading or first line, within the label limit. */
function aiLabel(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.replace(/^#+\s*/, "").trim().slice(0, 120);
}

const newestFirst = (a: SavePoint, b: SavePoint): number => Date.parse(b.savedAt) - Date.parse(a.savedAt);

function errorCode(e: unknown): string {
  return e instanceof LtSaveError ? e.code : "unavailable";
}

interface EventHost {
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
}

interface Desired {
  saves: SavePoint[];
  ai: string[];
}

export function createGameStorage(opts: GameStorageOptions = {}): GameStorage {
  const store = (): KeyValueStore | null => (opts.store !== undefined ? opts.store : browserStore());
  const server = (): SaveServer | null => {
    if (opts.remote !== undefined) return opts.remote;
    return isBackendAvailable() ? gamesSaveServer : null;
  };

  // The cache: every text written or pulled is also held here, so a blocked or full localStorage does not lose it for this visit.
  const mem = new Map<string, string>();
  const unsaved = new Set<string>(); // the keys whose last localStorage write failed: the memory copy is the newer one
  const statusListeners = new Set<(s: StorageStatus) => void>();
  const changeListeners = new Set<() => void>();
  let localFailure: string | null = null;
  let serverFailure: string | null = null;
  let envMem: SyncEnv | null = null;
  let state: SyncState = "local-only";
  let message: string | null = null;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let onlineHooked = false;
  let readyPromise: Promise<SyncResult> | null = null;
  let queuedPush: Promise<SyncResult> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const unavailableCount = new Map<string, number>(); // per key, the syncs in a row that failed as unavailable (this visit only)

  const fail = (msg: string): void => {
    opts.onError?.(msg);
  };

  // ---- the local cache

  const readLocal = (key: string, field: string): unknown => {
    if (unsaved.has(key) && mem.has(key)) return mem.get(key);
    const env = readEnvelope(store(), key);
    if (env && env[field] !== undefined) return env[field];
    return mem.get(key) ?? null;
  };

  /** Keep a local value. Returns the error message when localStorage would not take it (the memory copy still holds). */
  const writeLocal = (key: string, field: string, value: unknown): string | null => {
    mem.set(key, value as never);
    const err = writeEnvelope(store(), key, { [field]: value });
    if (err) unsaved.add(key);
    else unsaved.delete(key);
    return err;
  };

  /** Record how the last local write went: the message when localStorage refused it, null when it took it. */
  const noteLocal = (err: string | null): void => {
    localFailure = err;
    if (err) fail(err);
  };

  const savesKey = TABLE_KEYS.savesPrefix + SYNCED_SAVES_SCOPE;
  const savesText = (): string | null => {
    const t = readLocal(savesKey, "text");
    return typeof t === "string" ? t : null;
  };
  const aiTexts = (): string[] => {
    const t = readLocal(TABLE_KEYS.aiAdventures, "texts");
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
  };
  const desired = (): Desired => ({ saves: parseSaves(savesText()), ai: aiTexts() });

  // ---- the bookkeeping

  const loadEnv = (): SyncEnv => {
    if (envMem) return envMem;
    const raw = readEnvelope(store(), TABLE_KEYS.sync);
    const env = emptyEnv();
    if (raw) {
      if (Array.isArray(raw.known)) for (const k of raw.known) if (typeof k === "string") env.known.add(k);
      if (typeof raw.currentId === "string") env.currentId = raw.currentId;
      if (typeof raw.currentStamp === "string") env.currentStamp = raw.currentStamp;
      if (typeof raw.rejected === "object" && raw.rejected !== null && !Array.isArray(raw.rejected)) {
        // Refusals that speak of the deployment, not the row, are not carried to the next visit (it may be fixed by then).
        for (const [k, v] of Object.entries(raw.rejected)) if (typeof v === "string" && !PER_VISIT_CODES.has(v)) env.rejected[k] = v;
      }
      env.migrated = raw.migrated === true;
      if (typeof raw.lastSyncedAt === "string") env.lastSyncedAt = raw.lastSyncedAt;
      if (typeof raw.owner === "string") env.owner = raw.owner;
    }
    envMem = env;
    return env;
  };
  const saveEnv = (): void => {
    const env = loadEnv();
    // A failure here costs nothing but a repeat put (puts are idempotent); the saves themselves are reported when they fail.
    writeEnvelope(store(), TABLE_KEYS.sync, {
      known: [...env.known],
      currentId: env.currentId,
      currentStamp: env.currentStamp,
      rejected: env.rejected,
      migrated: env.migrated,
      lastSyncedAt: env.lastSyncedAt,
      owner: env.owner,
    });
  };

  /** Whether the game knows who is playing. A storage given no `account` option has no notion of an owner, so it always does. */
  const ownerIsKnown = (): boolean => {
    if (opts.account === undefined) return true;
    const who = opts.account();
    return typeof who === "string" && who.length > 0;
  };
  /** A server exists but the cache owner cannot be told apart from the signed-in player: stay on this device. */
  const awaitingOwner = (): boolean => server() !== null && !ownerIsKnown();

  /** Another player signed in on this browser: put their cache aside and start clean, so it is never uploaded into this account. */
  const checkOwner = (): void => {
    const who = opts.account?.();
    if (typeof who !== "string" || who.length === 0) return;
    const env = loadEnv();
    if (env.owner === null || env.owner === who) {
      if (env.owner !== who) {
        env.owner = who;
        saveEnv();
      }
      return;
    }
    const backup = TABLE_KEYS.backupPrefix + env.owner.replace(/[^A-Za-z0-9_-]/g, "_");
    writeEnvelope(store(), backup, { saves: savesText(), texts: aiTexts() });
    for (const k of [savesKey, TABLE_KEYS.aiAdventures]) {
      mem.delete(k);
      unsaved.delete(k);
      try {
        store()?.removeItem?.(k);
      } catch {
        // Nothing to do: the next write replaces it.
      }
    }
    envMem = emptyEnv();
    envMem.owner = who;
    saveEnv();
  };

  /** What still has to go to the server, by key, from the cache and the bookkeeping alone. */
  const outstanding = (): { puts: string[]; deletes: string[]; current: boolean } => {
    const env = loadEnv();
    const d = desired();
    const want = new Set<string>();
    const puts: string[] = [];
    for (const s of d.saves) {
      const k = saveRowKey(s.id);
      want.add(k);
      if (!env.known.has(k) && !(k in env.rejected)) puts.push(k);
    }
    for (const t of d.ai) {
      const k = aiRowKey(t);
      want.add(k);
      if (!env.known.has(k) && !(k in env.rejected)) puts.push(k);
    }
    const deletes = [...env.known].filter((k) => !want.has(k));
    const newest = d.saves[0];
    return { puts, deletes, current: newest !== undefined && env.currentId !== newest.id && !(CURRENT_KEY in env.rejected) };
  };

  const pendingCount = (): number => {
    const o = outstanding();
    return o.puts.length + o.deletes.length + (o.current ? 1 : 0);
  };

  // ---- status

  const snapshotStatus = (): StorageStatus => ({ state, message, pending: server() && !awaitingOwner() ? pendingCount() : 0, lastSyncedAt: loadEnv().lastSyncedAt });
  const publish = (next: SyncState, text: string | null): void => {
    if (next === "syncing" && state === "syncing") return;
    state = next;
    message = text;
    const s = snapshotStatus();
    for (const cb of [...statusListeners]) {
      try {
        cb(s);
      } catch {
        // A listener's fault is not the storage's.
      }
    }
  };
  const idleStatus = (): void => {
    if (!server()) publish(localFailure ? "error" : "local-only", localFailure);
    else if (awaitingOwner()) publish(localFailure ? "error" : "local-only", localFailure ?? MESSAGES.ownerUnknown);
    else if (localFailure) publish("error", localFailure);
    else publish("synced", null);
  };

  const notifyChange = (): void => {
    for (const cb of [...changeListeners]) {
      try {
        cb();
      } catch {
        // As above.
      }
    }
  };

  // ---- the sync itself

  const scheduleRetry = (): void => {
    if (disposed) return;
    const ms = opts.retryMs ?? 30_000;
    if (ms > 0 && retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void requestFlush();
      }, ms);
      (retryTimer as { unref?: () => void }).unref?.();
    }
    const target = globalThis as unknown as EventHost;
    if (!onlineHooked && typeof target.addEventListener === "function") {
      onlineHooked = true;
      target.addEventListener("online", onOnline);
    }
  };
  const onOnline = (): void => {
    void sync();
  };

  /** Pull the server's rows into the cache. Throws on any server failure (nothing is applied until every row has been read). */
  const pull = async (remote: SaveServer, result: SyncResult): Promise<void> => {
    const listed = await remote.list();
    if (!listed || !Array.isArray(listed.saves)) throw new LtSaveError("unavailable", "The save server sent back something unreadable.");
    const env = loadEnv();
    const meta = new Map(listed.saves.map((m) => [m.key, m] as const));
    // What to fetch is decided from the cache as it is now; the merge below re-reads it after the last await.
    const early = desired();
    const earlySaveKeys = new Set(early.saves.map((s) => saveRowKey(s.id)));
    const earlyAiKeys = new Set(early.ai.map(aiRowKey));
    const fetchKeys: string[] = [];
    for (const k of meta.keys()) {
      if (k.startsWith(SAVE_KEY_PREFIX) && !earlySaveKeys.has(k) && !env.known.has(k)) fetchKeys.push(k);
      else if (k.startsWith(AI_KEY_PREFIX) && !earlyAiKeys.has(k) && !env.known.has(k)) fetchKeys.push(k);
    }
    const cur = meta.get(CURRENT_KEY);
    const fetchCurrent = cur !== undefined && cur.updatedAt !== env.currentStamp;
    const rows = await Promise.all([...fetchKeys, ...(fetchCurrent ? [CURRENT_KEY] : [])].map(async (k) => [k, (await remote.get(k)).save] as const));

    // No await from here to the end: a save written while the gets were in flight is in the cache now, and the merge is made against it
    // (a snapshot taken before the awaits would overwrite that save, and it would never be pushed).
    const d = desired();
    const localSaveKeys = new Set(d.saves.map((s) => saveRowKey(s.id)));
    const localAiKeys = new Set(d.ai.map(aiRowKey));

    // Saves: the union of what is here and what came, trimmed per kind, newest first.
    const fetchedSaveKeys = new Map<string, SavePoint>();
    let currentPoint: SavePoint | null = null;
    const aiNew: { text: string; stamp: string; key: string }[] = [];
    for (const [k, row] of rows) {
      if (!row) continue;
      if (k.startsWith(AI_KEY_PREFIX)) {
        const text = (row.payload as { text?: unknown } | null)?.text;
        if (typeof text === "string" && text.length > 0) aiNew.push({ text, stamp: row.updatedAt, key: k });
        continue;
      }
      // A row this build cannot read (another save version) comes back as nothing here and is left on the server untouched.
      const point = parseSaves(JSON.stringify([row.payload]))[0];
      if (!point) continue;
      if (k === CURRENT_KEY) currentPoint = point;
      else fetchedSaveKeys.set(k, point);
    }
    const fetched = new Set<string>();
    const incoming = [...fetchedSaveKeys.values()];
    if (currentPoint && !d.saves.some((s) => s.id === (currentPoint as SavePoint).id) && !incoming.some((s) => s.id === (currentPoint as SavePoint).id)) incoming.push(currentPoint);
    let changed = false;
    if (incoming.length > 0) {
      const all = [...d.saves, ...incoming].sort(newestFirst);
      const merged = parseSaves(serializeSaves(all));
      const sameList = merged.length === d.saves.length && merged.every((x, i) => x.id === d.saves[i]?.id);
      if (!sameList) {
        noteLocal(writeLocal(savesKey, "text", serializeSaves(merged)));
        changed = true;
        result.pulled += merged.filter((x) => !d.saves.some((y) => y.id === x.id)).length;
      }
    }
    for (const k of fetchedSaveKeys.keys()) fetched.add(k);
    if (currentPoint) {
      env.currentId = (currentPoint as SavePoint).id;
      env.currentStamp = cur?.updatedAt ?? null;
    }

    // Adventures: the ones only the server has come after the local ones, oldest first.
    if (aiNew.length > 0) {
      aiNew.sort((a, b) => a.stamp.localeCompare(b.stamp));
      const have = new Set(d.ai);
      const add = aiNew.filter((a) => !have.has(a.text));
      if (add.length > 0) {
        noteLocal(writeLocal(TABLE_KEYS.aiAdventures, "texts", [...d.ai, ...add.map((a) => a.text)]));
        changed = true;
        result.pulled += add.length;
      }
      for (const a of aiNew) fetched.add(a.key);
    }

    // What this device believes the server holds is now what the server lists, among the keys this device has a claim on (held before,
    // held here, or just read). A key the server lost (removed elsewhere) drops out, so a copy kept here is sent up again.
    const next = new Set<string>();
    for (const k of meta.keys()) {
      if (!k.startsWith(SAVE_KEY_PREFIX) && !k.startsWith(AI_KEY_PREFIX)) continue;
      if (env.known.has(k) || localSaveKeys.has(k) || localAiKeys.has(k) || fetched.has(k)) next.add(k);
    }
    env.known = next;
    if (!meta.has(CURRENT_KEY) && env.currentId !== null) {
      env.currentId = null;
      env.currentStamp = null;
    }
    saveEnv();
    if (changed) notifyChange();
  };

  /** Send what changed: removals first (so a full account has room), then new rows oldest first, the "current" copy last. */
  const push = async (remote: SaveServer, result: SyncResult, reachedServer: boolean): Promise<string | null> => {
    const env = loadEnv();
    const d = desired();
    const want = new Set<string>([...d.saves.map((s) => saveRowKey(s.id)), ...d.ai.map(aiRowKey)]);
    for (const k of Object.keys(env.rejected)) if (k !== CURRENT_KEY && !want.has(k)) delete env.rejected[k];
    let problem: string | null = null;
    let stop = false;
    let answered = reachedServer; // the server answered something in this run (the pull counts)
    let streak = 0; // unavailable failures in a row, with no answer between
    let outage = false;
    const flaky: string[] = []; // the keys that failed as unavailable in this run
    const answeredOk = (key: string): void => {
      answered = true;
      streak = 0;
      unavailableCount.delete(key);
    };
    /** One key failed. A refusal for good parks that key alone; running out of room or an outage stops the push; anything else is counted against the key. */
    const refuse = (key: string, e: unknown): void => {
      const code = errorCode(e);
      if (code === "too_many") {
        answered = true;
        streak = 0;
        problem = MESSAGES.tooMany;
        stop = true;
      } else if (PERMANENT_CODES.has(code)) {
        answered = true;
        streak = 0;
        env.rejected[key] = code;
        unavailableCount.delete(key);
        if (problem === null) problem = rejectionMessage([code]);
      } else {
        flaky.push(key);
        streak += 1;
        if (problem !== MESSAGES.tooMany) problem = MESSAGES.offline;
        if (streak >= OUTAGE_STREAK) {
          stop = true;
          outage = true;
        }
      }
    };

    for (const k of [...env.known].filter((x) => !want.has(x))) {
      if (stop) break;
      try {
        await remote.delete(k);
        env.known.delete(k);
        result.deleted += 1;
        answeredOk(k);
        saveEnv();
      } catch (e) {
        refuse(k, e);
      }
    }
    const rows: { key: string; kind: LtSaveKind; label: string; payload: unknown }[] = [];
    // Oldest first, so the server's newest-first order matches the saves'.
    for (const s of [...d.saves].reverse()) rows.push({ key: saveRowKey(s.id), kind: s.kind, label: s.label.slice(0, 120), payload: s });
    for (const t of d.ai) rows.push({ key: aiRowKey(t), kind: "ai-adventure", label: aiLabel(t), payload: { text: t } });
    for (const r of rows) {
      if (stop) break;
      if (env.known.has(r.key) || r.key in env.rejected) continue;
      try {
        await remote.put(r.key, r.kind, r.label, r.payload);
        env.known.add(r.key);
        result.pushed += 1;
        answeredOk(r.key);
        saveEnv();
      } catch (e) {
        refuse(r.key, e);
      }
    }
    const newest = d.saves[0];
    if (!stop && newest && env.currentId !== newest.id && !(CURRENT_KEY in env.rejected)) {
      try {
        const put = await remote.put(CURRENT_KEY, "current", newest.label.slice(0, 120), newest);
        env.currentId = newest.id;
        env.currentStamp = put.updatedAt;
        result.pushed += 1;
        answeredOk(CURRENT_KEY);
        saveEnv();
      } catch (e) {
        refuse(CURRENT_KEY, e);
      }
    }
    // A key that fails as unavailable again and again while the server answers everything else is that key's own trouble, not an outage:
    // after a few tries it is parked like any other refusal, so it stops holding the status at "offline". A real outage (nothing
    // answered, or a streak of failures) never counts.
    if (answered && !outage && flaky.length > 0) {
      for (const k of flaky) {
        const n = (unavailableCount.get(k) ?? 0) + 1;
        if (n >= UNAVAILABLE_LIMIT) {
          env.rejected[k] = "unavailable";
          unavailableCount.delete(k);
        } else unavailableCount.set(k, n);
      }
      if (problem === MESSAGES.offline && flaky.every((k) => k in env.rejected)) problem = rejectionMessage(["unavailable"]);
    }
    saveEnv();
    return problem;
  };

  const runSyncUnsafe = async (doPull: boolean): Promise<SyncResult> => {
    const result: SyncResult = { ok: true, pulled: 0, pushed: 0, deleted: 0, pending: 0, message: null };
    const remote = server();
    // No server, or one but nobody known to send for: the device holds everything, and nothing leaves it.
    if (!remote || awaitingOwner()) {
      idleStatus();
      result.pending = 0;
      result.message = localFailure ?? (remote ? MESSAGES.ownerUnknown : null);
      result.ok = localFailure === null;
      return result;
    }
    checkOwner();
    publish("syncing", null);
    let problem: string | null = null;
    try {
      let pulled = false;
      let pullRefusal: string | null = null;
      if (doPull) {
        try {
          await pull(remote, result);
          pulled = true;
        } catch (e) {
          // A server that answers "no" for good (not switched on, not allowed) is not an outage: say so, and still let each row be offered.
          const code = errorCode(e);
          if (code === "too_many" || !PERMANENT_CODES.has(code)) throw e;
          pullRefusal = code;
        }
      }
      problem = await push(remote, result, pulled);
      if (problem === null && pullRefusal !== null) problem = rejectionMessage([pullRefusal]);
    } catch (e) {
      const code = errorCode(e);
      problem = code === "too_many" ? MESSAGES.tooMany : MESSAGES.offline;
    }
    const env = loadEnv();
    result.pending = pendingCount();
    const refused = Object.values(env.rejected);
    const failure = problem ?? (refused.length > 0 ? rejectionMessage(refused) : null);
    if (failure && failure !== serverFailure) fail(failure);
    serverFailure = failure;
    // Every row has been offered once, so the older local saves are migrated; "synced" is only claimed when nothing is refused or waiting.
    if (problem === null) env.migrated = true;
    if (failure === null && result.pending === 0) env.lastSyncedAt = new Date().toISOString();
    saveEnv();
    if (failure) {
      result.ok = false;
      result.message = failure;
    }
    if (localFailure) {
      result.ok = false;
      result.message = result.message ?? localFailure;
    }
    if (problem === MESSAGES.offline) {
      publish("pending", MESSAGES.offline);
      scheduleRetry();
    } else if (serverFailure) {
      publish("error", serverFailure);
      if (problem === MESSAGES.tooMany) scheduleRetry();
    } else if (localFailure) {
      publish("error", localFailure);
    } else {
      publish("synced", null);
    }
    return result;
  };

  /** A sync that cannot reject: anything unexpected becomes a failed result, so the queue never breaks. */
  const runSync = async (doPull: boolean): Promise<SyncResult> => {
    try {
      return await runSyncUnsafe(doPull);
    } catch (e) {
      const text = e instanceof Error && e.message ? e.message : MESSAGES.offline;
      serverFailure = text;
      publish("error", text);
      return { ok: false, pulled: 0, pushed: 0, deleted: 0, pending: pendingCount(), message: text };
    }
  };

  /** Run jobs one at a time, in the order asked. A job never rejects, so the chain never breaks. */
  const enqueue = (job: () => Promise<SyncResult>): Promise<SyncResult> => {
    const p = chain.then(job, job);
    chain = p;
    return p;
  };

  const requestFlush = (): Promise<SyncResult> => {
    if (queuedPush) return queuedPush;
    const p = enqueue(() => {
      queuedPush = null;
      return runSync(false);
    });
    queuedPush = p;
    return p;
  };

  const sync = (): Promise<SyncResult> => enqueue(() => runSync(true));

  const ready = (): Promise<SyncResult> => {
    if (readyPromise) return readyPromise;
    const work = sync();
    const limit = opts.readyTimeoutMs ?? 4000;
    readyPromise =
      limit > 0 && server()
        ? new Promise<SyncResult>((resolve) => {
            const timer = setTimeout(
              () => resolve({ ok: false, pulled: 0, pushed: 0, deleted: 0, pending: pendingCount(), message: MESSAGES.offline, timedOut: true }),
              limit,
            );
            (timer as { unref?: () => void }).unref?.();
            void work.then((r) => {
              clearTimeout(timer);
              resolve(r);
            });
          })
        : work;
    return readyPromise;
  };

  // ---- the table's interface

  const writeBook = (key: string, field: string, value: unknown, scope: boolean): void => {
    noteLocal(writeLocal(key, field, value));
    if (scope && server() && !awaitingOwner()) {
      publish("syncing", null);
      void requestFlush();
    } else if (!server() || awaitingOwner()) {
      idleStatus();
    }
  };

  return {
    saves: {
      read(scope) {
        const key = TABLE_KEYS.savesPrefix + scope;
        const t = readLocal(key, "text");
        return typeof t === "string" ? t : null;
      },
      write(scope, text) {
        writeBook(TABLE_KEYS.savesPrefix + scope, "text", text, scope === SYNCED_SAVES_SCOPE);
      },
    },
    aiAdventures: {
      read() {
        return aiTexts();
      },
      write(texts) {
        writeBook(TABLE_KEYS.aiAdventures, "texts", [...texts], true);
      },
    },
    lastError: () => localFailure ?? serverFailure,
    ready,
    sync,
    waitingForOwner: awaitingOwner,
    ownerKnown: sync,
    flush: requestFlush,
    status: snapshotStatus,
    onStatus(cb) {
      statusListeners.add(cb);
      return () => void statusListeners.delete(cb);
    },
    onChange(cb) {
      changeListeners.add(cb);
      return () => void changeListeners.delete(cb);
    },
    dispose() {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      const target = globalThis as unknown as EventHost;
      if (onlineHooked && typeof target.removeEventListener === "function") target.removeEventListener("online", onOnline);
      onlineHooked = false;
    },
  };
}
