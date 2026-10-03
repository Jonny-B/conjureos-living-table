/**
 * Server saves for the table window: the games-db save calls in bridge/gamesApi.ts (against the in-memory mock, which keeps the
 * real contract and limits) and the game's storage that puts them behind the window's synchronous host.storage
 * (src/games/livingtable/table/host/gameStorage.ts). What it proves:
 *
 *  - the four calls round-trip, list newest first, keep each game apart, and refuse a bad key, a bad kind, an oversized payload and
 *    a sixty-first row exactly as the server will;
 *  - a save is in the cache before any network call, then goes up as one row per save point plus a "current" copy of the newest;
 *  - the per-kind trim removes the trimmed rows from the server too;
 *  - a second device that starts empty pulls the first device's saves and adventures (and the current copy), and tells the window
 *    through onChange;
 *  - an outage never loses a save: it stays in the cache, the status and lastError say so, and the next sync sends it;
 *  - a save or adventure the server refuses (too big) stays local, is not sent again, and does not stop the others;
 *  - a full account (too_many) is reported, keeps everything local, and recovers once there is room;
 *  - saves made before this change (only in the cache) are uploaded once, and not again on the next run;
 *  - a row this build cannot read is left alone, never deleted;
 *  - another player's cache is moved aside, not uploaded.
 *
 * Run: npx tsx --test test/livingtable-table-saves-server.test.ts
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  LT_SAVE_MAX_BYTES,
  LT_SAVE_MAX_ROWS,
  LtSaveError,
  ltSaveDelete,
  ltSaveGet,
  ltSaveList,
  ltSavePut,
  resetLtSavesMock,
} from "../src/bridge/gamesApi";
import { makeSavePoint, parseSaves, serializeSaves, type SavePoint } from "../src/games/livingtable/session/savePoints";
import { SAVES_SCOPE } from "../src/games/livingtable/table/snapshot";
import {
  AI_KEY_PREFIX,
  CURRENT_KEY,
  MESSAGES,
  SAVE_KEY_PREFIX,
  STORAGE_VERSION,
  SYNCED_SAVES_SCOPE,
  TABLE_KEYS,
  aiRowKey,
  createGameStorage,
  gamesSaveServer,
  saveRowKey,
  statusText,
  type KeyValueStore,
  type SaveServer,
  type StorageStatus,
} from "../src/games/livingtable/table/host/gameStorage";

beforeEach(() => resetLtSavesMock());

// ---- fixtures ------------------------------------------------------------------------

function memStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const T0 = Date.parse("2026-10-03T12:00:00Z");
const at = (n: number): Date => new Date(T0 + n * 60_000);
let ids = 0;
const point = (kind: "rest" | "checkpoint" | "manual", n: number, data: unknown = { n }): SavePoint => makeSavePoint(kind, `label ${n}`, data, at(n), `${kind}-${n}-${++ids}`);
const bookText = (list: SavePoint[]): string => serializeSaves(list);

/** The real server calls, counted, and able to go "offline" or to throw a chosen error. */
function countedServer(): SaveServer & { calls: { list: number; get: number; put: string[]; delete: string[] }; down: boolean; failPut?: (key: string) => LtSaveError | null } {
  const calls = { list: 0, get: 0, put: [] as string[], delete: [] as string[] };
  const s: SaveServer & { calls: typeof calls; down: boolean; failPut?: (key: string) => LtSaveError | null } = {
    calls,
    down: false,
    async list() {
      if (s.down) throw new LtSaveError("unavailable", "Failed to fetch");
      calls.list += 1;
      return gamesSaveServer.list();
    },
    async get(key) {
      if (s.down) throw new LtSaveError("unavailable", "Failed to fetch");
      calls.get += 1;
      return gamesSaveServer.get(key);
    },
    async put(key, kind, label, payload) {
      if (s.down) throw new LtSaveError("unavailable", "Failed to fetch");
      const bad = s.failPut?.(key);
      if (bad) throw bad;
      calls.put.push(key);
      return gamesSaveServer.put(key, kind, label, payload);
    },
    async delete(key) {
      if (s.down) throw new LtSaveError("unavailable", "Failed to fetch");
      calls.delete.push(key);
      return gamesSaveServer.delete(key);
    },
  };
  return s;
}

const NO_TIMERS = { retryMs: 0, readyTimeoutMs: 0 } as const;
const serverKeys = async (): Promise<string[]> => (await ltSaveList()).saves.map((s) => s.key).sort();

// ---- the calls and the mock ------------------------------------------------------------

test("ltSave calls: put, list (newest first), get, replace and delete round-trip, and each game is kept apart", async () => {
  assert.deepEqual(await ltSaveList(), { saves: [] });
  const a = await ltSavePut("s:one", "manual", "first", { hp: 5 });
  assert.equal(a.ok, true);
  await ltSavePut("s:two", "checkpoint", "second", { hp: 6 });
  const list = (await ltSaveList()).saves;
  assert.deepEqual(list.map((s) => s.key), ["s:two", "s:one"], "newest first, even inside one millisecond");
  assert.equal(list[0].kind, "checkpoint");
  assert.equal(list[0].label, "second");
  assert.ok(list[0].bytes > 0 && !("payload" in list[0]), "the list carries sizes, not payloads");
  assert.deepEqual((await ltSaveGet("s:one")).save?.payload, { hp: 5 });
  assert.equal((await ltSaveGet("s:none")).save, null);
  await ltSavePut("s:one", "manual", "first again", { hp: 9 });
  assert.equal((await ltSaveList()).saves.length, 2, "the same key replaces, it does not add");
  assert.deepEqual((await ltSaveList()).saves.map((s) => s.key), ["s:one", "s:two"], "a replaced row is the newest");
  assert.deepEqual((await ltSaveGet("s:one")).save?.payload, { hp: 9 });
  await ltSaveDelete("s:one");
  assert.deepEqual((await ltSaveList()).saves.map((s) => s.key), ["s:two"]);
  assert.deepEqual(await ltSaveDelete("s:one"), { ok: true }, "removing what is not there is fine");
});

test("ltSave calls: the mock refuses what the server refuses, with the server's codes", async () => {
  const code = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return "ok";
    } catch (e) {
      assert.ok(e instanceof LtSaveError, "a refusal is an LtSaveError");
      return e.code;
    }
  };
  for (const key of ["", "Has Capital", "has space", "a/b", "x".repeat(81), "dot.dot"]) assert.equal(await code(ltSavePut(key, "manual", "", {})), "bad_key", JSON.stringify(key));
  for (const key of ["a", "x".repeat(80), "s:abc_1-2", "0:9"]) assert.equal(await code(ltSavePut(key, "manual", "", {})), "ok", key);
  assert.equal(await code(ltSavePut("k", "slot" as never, "", {})), "bad_kind");
  for (const kind of ["rest", "checkpoint", "manual", "current", "ai-adventure"] as const) assert.equal(await code(ltSavePut(`k-${kind}`, kind, "", {})), "ok", kind);
  assert.equal(await code(ltSavePut("l", "manual", "x".repeat(120), {})), "ok");
  assert.equal(await code(ltSavePut("l", "manual", "x".repeat(121), {})), "too_large", "a label over 120 characters");
  // The payload limit is 256 KiB of serialised JSON: a string adds two quote characters.
  assert.equal(await code(ltSavePut("big", "manual", "", "x".repeat(LT_SAVE_MAX_BYTES - 2))), "ok", "exactly at the limit");
  assert.equal(await code(ltSavePut("big", "manual", "", "x".repeat(LT_SAVE_MAX_BYTES - 1))), "too_large", "one byte over");
  assert.equal(await code(ltSavePut("big", "manual", "", "é".repeat(LT_SAVE_MAX_BYTES / 2))), "too_large", "bytes, not characters");
});

test("ltSave calls: the sixty-first row is too_many, a replacement at sixty is fine, a delete makes room", async () => {
  for (let i = 0; i < LT_SAVE_MAX_ROWS; i++) await ltSavePut(`row-${i}`, "manual", "", { i });
  await assert.rejects(ltSavePut("one-more", "manual", "", {}), (e: unknown) => e instanceof LtSaveError && e.code === "too_many");
  await ltSavePut("row-3", "manual", "again", { i: 3, again: true });
  assert.equal((await ltSaveList()).saves.length, LT_SAVE_MAX_ROWS);
  await ltSaveDelete("row-0");
  await ltSavePut("one-more", "manual", "", {});
  assert.equal((await ltSaveList()).saves.length, LT_SAVE_MAX_ROWS);
});

test("ltSave calls: they go over the gamesDb remote action with the contract's names and fields, and every failure is an LtSaveError", async () => {
  const sent: unknown[] = [];
  let reply: () => unknown = () => ({ ok: true, updatedAt: "2026-10-03T00:00:00Z" });
  (globalThis as { __conjureos?: unknown }).__conjureos = {
    actions: {
      invoke: async (appPath: string, action: string, params: unknown) => {
        assert.ok(appPath.startsWith("/apps/"), appPath);
        assert.equal(action, "gamesDb");
        sent.push(params);
        return reply();
      },
    },
  };
  try {
    await ltSavePut("s:abc", "manual", "a label", { n: 1 });
    await ltSaveList();
    await ltSaveGet("s:abc");
    await ltSaveDelete("s:abc");
    assert.deepEqual(sent, [
      { action: "ltSavePut", game: "livingtable", key: "s:abc", kind: "manual", label: "a label", payload: { n: 1 } },
      { action: "ltSaveList", game: "livingtable" },
      { action: "ltSaveGet", game: "livingtable", key: "s:abc" },
      { action: "ltSaveDelete", game: "livingtable", key: "s:abc" },
    ]);
    const code = async (): Promise<string> => {
      try {
        await ltSavePut("s:abc", "manual", "", {});
        return "ok";
      } catch (e) {
        assert.ok(e instanceof LtSaveError);
        return e.code;
      }
    };
    reply = () => ({ error: "too_large" });
    assert.equal(await code(), "too_large", "a reply that carries an error code");
    reply = () => ({ error: "too_many" });
    assert.equal(await code(), "too_many");
    reply = () => ({ error: "something odd" });
    assert.equal(await code(), "unavailable", "an unnamed refusal is retryable");
    reply = () => {
      throw new Error("games-db 400: bad_key");
    };
    assert.equal(await code(), "bad_key", "a thrown message that names a code");
    reply = () => {
      throw new Error("HTTP 500");
    };
    assert.equal(await code(), "unavailable");
  } finally {
    delete (globalThis as { __conjureos?: unknown }).__conjureos;
  }
});

// ---- the storage ---------------------------------------------------------------------

test("storage: the window's scope is the synced one", () => {
  assert.equal(SYNCED_SAVES_SCOPE, SAVES_SCOPE);
});

test("storage: a save is in the cache before any call, then goes up as one row per save plus the current copy", async () => {
  const remote = countedServer();
  const store = memStore();
  const s = createGameStorage({ store, remote, ...NO_TIMERS });
  const list = [point("manual", 3), point("checkpoint", 2), point("rest", 1)];
  s.saves.write(SYNCED_SAVES_SCOPE, bookText(list));
  assert.equal(remote.calls.put.length, 0, "nothing has gone out yet when write returns");
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), bookText(list), "the cache has it already");
  assert.equal(JSON.parse(store.data.get(TABLE_KEYS.savesPrefix + SYNCED_SAVES_SCOPE)!).v, STORAGE_VERSION);
  const result = await s.flush();
  assert.equal(result.ok, true);
  assert.equal(result.pushed, 4);
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, ...list.map((p) => saveRowKey(p.id))].sort());
  const rows = (await ltSaveList()).saves;
  const byKey = new Map(rows.map((r) => [r.key, r] as const));
  assert.equal(byKey.get(saveRowKey(list[0].id))!.kind, "manual");
  assert.equal(byKey.get(saveRowKey(list[1].id))!.kind, "checkpoint");
  assert.equal(byKey.get(saveRowKey(list[2].id))!.kind, "rest");
  assert.equal(byKey.get(CURRENT_KEY)!.kind, "current");
  assert.deepEqual((await ltSaveGet(CURRENT_KEY)).save?.payload, list[0], "the current row is the newest save point");
  assert.equal(rows[0].key, CURRENT_KEY, "it was written last");
  assert.deepEqual(s.status(), { state: "synced", message: null, pending: 0, lastSyncedAt: s.status().lastSyncedAt });
  assert.equal(s.lastError(), null);
  // Nothing changed: nothing goes out.
  const before = remote.calls.put.length;
  await s.flush();
  assert.equal(remote.calls.put.length, before);
});

test("storage: every key is one the server accepts, whatever the save id looks like", () => {
  for (const id of ["manual-abc-123", "Odd ID with spaces/and.dots", "é".repeat(200), "x".repeat(200)]) {
    const key = saveRowKey(id);
    assert.match(key, /^[a-z0-9:_-]{1,80}$/, id);
    assert.ok(key.startsWith(SAVE_KEY_PREFIX));
  }
  const ai = aiRowKey("# An adventure\n\ntext");
  assert.match(ai, /^[a-z0-9:_-]{1,80}$/);
  assert.ok(ai.startsWith(AI_KEY_PREFIX));
  assert.notEqual(aiRowKey("a"), aiRowKey("b"));
  assert.equal(aiRowKey("same"), aiRowKey("same"));
});

test("storage: the per-kind trim removes the trimmed saves from the server too, and the current copy follows the newest", async () => {
  const remote = countedServer();
  const s = createGameStorage({ store: memStore(), remote, ...NO_TIMERS });
  let list: SavePoint[] = [];
  const made: SavePoint[] = [];
  for (let i = 1; i <= 5; i++) {
    const p = point("checkpoint", i);
    made.push(p);
    list = parseSaves(serializeSaves([p, ...list])); // newest first, three of a kind kept (the window's own book does the same)
    s.saves.write(SYNCED_SAVES_SCOPE, bookText(list));
    await s.flush();
  }
  assert.equal(list.length, 3);
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, ...made.slice(2).map((p) => saveRowKey(p.id))].sort());
  assert.equal(((await ltSaveGet(CURRENT_KEY)).save?.payload as SavePoint).id, made[4].id);
  assert.equal(remote.calls.delete.length, 2);
});

test("storage: a second device that starts empty pulls the saves and the current copy, and says so through onChange", async () => {
  const a = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  const list = [point("rest", 3), point("checkpoint", 2), point("manual", 1)];
  a.saves.write(SYNCED_SAVES_SCOPE, bookText(list));
  a.aiAdventures.write(["# Written one\n\nBody"]);
  await a.flush();

  const store = memStore();
  const b = createGameStorage({ store, remote: countedServer(), ...NO_TIMERS });
  assert.equal(b.saves.read(SYNCED_SAVES_SCOPE), null, "nothing here until it has asked the server");
  let changes = 0;
  b.onChange(() => (changes += 1));
  const r = await b.ready();
  assert.equal(r.ok, true);
  assert.equal(r.pulled, 4, "three saves and one adventure");
  assert.equal(changes, 1);
  assert.deepEqual(parseSaves(b.saves.read(SYNCED_SAVES_SCOPE)).map((p) => p.id), list.map((p) => p.id), "newest first");
  assert.deepEqual(b.aiAdventures.read(), ["# Written one\n\nBody"]);
  assert.ok(store.data.has(TABLE_KEYS.savesPrefix + SYNCED_SAVES_SCOPE), "and it is in this device's cache for the next offline visit");
  // Nothing was sent back up: it all came from there.
  const again = await b.sync();
  assert.equal(again.pushed, 0);
  assert.equal(again.pulled, 0);
  assert.equal(changes, 1, "nothing new, no change event");
});

test("storage: the current copy alone is enough to resume (the newest save, when its own row is gone)", async () => {
  const a = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  const p = point("checkpoint", 1);
  a.saves.write(SYNCED_SAVES_SCOPE, bookText([p]));
  await a.flush();
  await ltSaveDelete(saveRowKey(p.id));
  const b = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  await b.ready();
  assert.deepEqual(parseSaves(b.saves.read(SYNCED_SAVES_SCOPE)).map((x) => x.id), [p.id]);
});

test("storage: two devices' saves are unioned and trimmed newest first, and the server follows", async () => {
  const a = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  const b = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  const aList = [point("checkpoint", 4), point("checkpoint", 2), point("checkpoint", 1)];
  const bList = [point("checkpoint", 5), point("checkpoint", 3)];
  a.saves.write(SYNCED_SAVES_SCOPE, bookText(aList));
  await a.flush();
  b.saves.write(SYNCED_SAVES_SCOPE, bookText(bList));
  await b.sync();
  const merged = parseSaves(b.saves.read(SYNCED_SAVES_SCOPE));
  assert.deepEqual(merged.map((p) => p.id), [bList[0].id, aList[0].id, bList[1].id], "the three newest checkpoints of the five");
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, ...merged.map((p) => saveRowKey(p.id))].sort(), "the two oldest are gone from the server");
  assert.equal(((await ltSaveGet(CURRENT_KEY)).save?.payload as SavePoint).id, bList[0].id);
  await a.sync();
  assert.deepEqual(parseSaves(a.saves.read(SYNCED_SAVES_SCOPE)).map((p) => p.id), merged.map((p) => p.id), "the first device agrees after its next sync");
});

// ---- offline, refusals, migration ------------------------------------------------------

test("storage: an outage keeps the save in the cache, says so, and the next sync sends it", async () => {
  const remote = countedServer();
  const seen: string[] = [];
  const store = memStore();
  const s = createGameStorage({ store, remote, onError: (m) => seen.push(m), ...NO_TIMERS });
  const states: StorageStatus["state"][] = [];
  s.onStatus((st) => states.push(st.state));
  remote.down = true;
  const p = point("manual", 1);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([p]));
  const r = await s.flush();
  assert.equal(r.ok, false);
  assert.equal(r.message, MESSAGES.offline);
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), bookText([p]), "still there");
  assert.equal(JSON.parse(store.data.get(TABLE_KEYS.savesPrefix + SYNCED_SAVES_SCOPE)!).text, bookText([p]), "and in the browser's storage");
  assert.equal(s.status().state, "pending");
  assert.equal(s.status().pending, 2, "the save and the current copy are waiting");
  assert.equal(s.lastError(), MESSAGES.offline);
  assert.deepEqual(seen, [MESSAGES.offline]);
  assert.match(statusText(s.status()), /could not reach/i);
  assert.deepEqual(states.slice(0, 2), ["syncing", "pending"]);

  // A second failed push says nothing new (the player is not nagged), and a later write is still kept.
  const p2 = point("manual", 2);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([p2, p]));
  await s.flush();
  assert.equal(seen.length, 1);
  assert.equal(parseSaves(s.saves.read(SYNCED_SAVES_SCOPE)).length, 2);

  remote.down = false;
  const back = await s.sync();
  assert.equal(back.ok, true);
  assert.equal(s.status().state, "synced");
  assert.equal(s.lastError(), null);
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, saveRowKey(p.id), saveRowKey(p2.id)].sort());
  assert.equal(((await ltSaveGet(CURRENT_KEY)).save?.payload as SavePoint).id, p2.id);
});

test("storage: a retry timer sends the save once the server is back, with nobody calling sync", async () => {
  const remote = countedServer();
  const s = createGameStorage({ store: memStore(), remote, retryMs: 15, readyTimeoutMs: 0 });
  remote.down = true;
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([point("manual", 1)]));
  await s.flush();
  assert.equal(s.status().state, "pending");
  remote.down = false;
  for (let i = 0; i < 50 && s.status().state !== "synced"; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.status().state, "synced");
  assert.equal((await ltSaveList()).saves.length, 2);
  s.dispose();
});

test("storage: saves made before this change are uploaded once, and not again on the next run", async () => {
  // A cache from the old build: the saves text and nothing else (no sync envelope).
  const legacy = [point("rest", 2), point("manual", 1)];
  const store = memStore({ [TABLE_KEYS.savesPrefix + SYNCED_SAVES_SCOPE]: JSON.stringify({ v: 1, text: bookText(legacy) }), [TABLE_KEYS.aiAdventures]: JSON.stringify({ v: 1, texts: ["# Old adventure"] }) });
  const remote = countedServer();
  const first = createGameStorage({ store, remote, ...NO_TIMERS });
  assert.equal(first.saves.read(SYNCED_SAVES_SCOPE), bookText(legacy), "the old saves read as they did");
  const r = await first.ready();
  assert.equal(r.ok, true);
  assert.equal(r.pushed, 4, "two saves, the current copy and the adventure");
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, aiRowKey("# Old adventure"), ...legacy.map((p) => saveRowKey(p.id))].sort());
  assert.equal(JSON.parse(store.data.get(TABLE_KEYS.sync)!).migrated, true);
  assert.equal(first.saves.read(SYNCED_SAVES_SCOPE), bookText(legacy), "the cache is untouched");

  // The next run: a new object over the same cache, the same account.
  const remote2 = countedServer();
  const second = createGameStorage({ store, remote: remote2, ...NO_TIMERS });
  const r2 = await second.ready();
  assert.equal(r2.pushed, 0);
  assert.deepEqual(remote2.calls.put, []);
  assert.deepEqual(remote2.calls.delete, []);
  assert.equal(remote2.calls.get, 0, "and the server's rows are not downloaded again either (they are held and the current copy is unchanged)");
});

test("storage: a migration that could not finish is tried again, and the saves are never dropped meanwhile", async () => {
  const legacy = [point("manual", 1)];
  const store = memStore({ [TABLE_KEYS.savesPrefix + SYNCED_SAVES_SCOPE]: JSON.stringify({ v: 1, text: bookText(legacy) }) });
  const remote = countedServer();
  remote.down = true;
  const first = createGameStorage({ store, remote, ...NO_TIMERS });
  const r = await first.ready();
  assert.equal(r.ok, false);
  assert.equal(JSON.parse(store.data.get(TABLE_KEYS.sync) ?? '{"migrated":false}').migrated, false);
  assert.equal(first.saves.read(SYNCED_SAVES_SCOPE), bookText(legacy));
  remote.down = false;
  const retry = createGameStorage({ store, remote, ...NO_TIMERS });
  assert.equal((await retry.ready()).ok, true);
  assert.equal(JSON.parse(store.data.get(TABLE_KEYS.sync)!).migrated, true);
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, saveRowKey(legacy[0].id)].sort());
});

test("storage: an adventure too big for the server stays local, is not sent again, and the other rows still go", async () => {
  const remote = countedServer();
  const seen: string[] = [];
  const s = createGameStorage({ store: memStore(), remote, onError: (m) => seen.push(m), ...NO_TIMERS });
  const huge = "# Huge\n" + "x".repeat(LT_SAVE_MAX_BYTES + 10);
  const p = point("manual", 1);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([p]));
  s.aiAdventures.write(["# Small one", huge]);
  const r = await s.flush();
  assert.equal(r.ok, false);
  assert.equal(r.message, MESSAGES.tooLarge);
  assert.equal(s.status().state, "error");
  assert.equal(s.lastError(), MESSAGES.tooLarge);
  assert.deepEqual(s.aiAdventures.read(), ["# Small one", huge], "both are still here");
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, aiRowKey("# Small one"), saveRowKey(p.id)].sort(), "the others went up");
  assert.equal(s.status().pending, 0, "a refused row is not waiting");
  const puts = remote.calls.put.length;
  await s.flush();
  await s.sync();
  assert.equal(remote.calls.put.length, puts, "not sent again");
  assert.deepEqual(seen, [MESSAGES.tooLarge], "and the player is told once");
  // Take it out and the refusal clears.
  s.aiAdventures.write(["# Small one"]);
  const clear = await s.sync();
  assert.equal(clear.ok, true);
  assert.equal(s.lastError(), null);
  assert.equal(s.status().state, "synced");
});

test("storage: a full account is reported, keeps everything local, and recovers when there is room", async () => {
  for (let i = 0; i < LT_SAVE_MAX_ROWS; i++) await ltSavePut(`other-${i}`, "manual", "", { i });
  const remote = countedServer();
  const s = createGameStorage({ store: memStore(), remote, ...NO_TIMERS });
  const p = point("manual", 1);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([p]));
  const r = await s.flush();
  assert.equal(r.ok, false);
  assert.equal(r.message, MESSAGES.tooMany);
  assert.equal(s.status().state, "error");
  assert.ok(s.status().pending > 0);
  assert.equal(s.lastError(), MESSAGES.tooMany);
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), bookText([p]));
  for (let i = 0; i < 5; i++) await ltSaveDelete(`other-${i}`);
  const ok = await s.sync();
  assert.equal(ok.ok, true);
  assert.equal(s.status().pending, 0);
  assert.ok((await serverKeys()).includes(saveRowKey(p.id)));
});

test("storage: a row this build cannot read is left on the server, not deleted, and not merged", async () => {
  const future = { ...point("manual", 9), version: 2 };
  await ltSavePut(saveRowKey(future.id), "manual", "from a newer build", future);
  const s = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  const mine = point("checkpoint", 1);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([mine]));
  const r = await s.ready();
  assert.equal(r.ok, true);
  assert.deepEqual(parseSaves(s.saves.read(SYNCED_SAVES_SCOPE)).map((p) => p.id), [mine.id]);
  assert.ok((await serverKeys()).includes(saveRowKey(future.id)), "still on the server");
  await s.sync();
  assert.ok((await serverKeys()).includes(saveRowKey(future.id)), "after another sync too");
});

test("storage: written adventures follow the player, and removing one removes its row", async () => {
  const a = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  a.aiAdventures.write(["# One\n\nx", "# Two\n\ny"]);
  await a.flush();
  const rows = (await ltSaveList()).saves.filter((r) => r.kind === "ai-adventure");
  assert.deepEqual(rows.map((r) => r.label).sort(), ["One", "Two"], "labelled by the heading");
  const b = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  await b.ready();
  assert.deepEqual([...b.aiAdventures.read()].sort(), ["# One\n\nx", "# Two\n\ny"]);
  a.aiAdventures.write(["# Two\n\ny"]);
  await a.flush();
  assert.deepEqual((await serverKeys()), [aiRowKey("# Two\n\ny")]);
  await b.sync();
  assert.deepEqual(b.aiAdventures.read(), ["# Two\n\ny"].length ? b.aiAdventures.read() : []);
  assert.ok(b.aiAdventures.read().includes("# Two\n\ny"));
});

test("storage: ready() does not hold the game when the server never answers, and the sync lands later through onChange", async () => {
  const slow: SaveServer = {
    ...gamesSaveServer,
    list: () => new Promise((resolve) => setTimeout(() => resolve({ saves: [] }), 80)),
  };
  const s = createGameStorage({ store: memStore(), remote: slow, readyTimeoutMs: 15, retryMs: 0 });
  const t0 = Date.now();
  const r = await s.ready();
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 70);
  assert.equal(await s.ready(), r, "later calls give the same answer");
  await s.sync();
});

test("storage: with the browser's storage blocked the saves live in memory for the visit and still reach the server", async () => {
  const blocked: KeyValueStore = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const seen: string[] = [];
  const s = createGameStorage({ store: blocked, remote: countedServer(), onError: (m) => seen.push(m), ...NO_TIMERS });
  const p = point("manual", 1);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([p]));
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), bookText([p]), "read back from memory");
  const r = await s.flush();
  assert.equal(r.pushed, 2);
  assert.ok(seen.includes("blocked"));
  assert.equal(s.lastError(), "blocked", "the device would not keep it, and the player can be told");
  assert.equal(s.status().state, "error");
});

test("storage: no server (outside ConjureOS) behaves as before: local only, no calls", async () => {
  const store = memStore();
  const s = createGameStorage({ store, remote: null, ...NO_TIMERS });
  s.saves.write(SYNCED_SAVES_SCOPE, "x");
  s.aiAdventures.write(["# a"]);
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), "x");
  assert.equal(s.status().state, "local-only");
  assert.equal(statusText(s.status()), "Saved on this device.");
  assert.equal((await s.ready()).ok, true);
  assert.equal((await s.flush()).ok, true);
  assert.deepEqual(await serverKeys(), []);
  // The default (no remote option) is also none under Node, where there is no ConjureOS bridge.
  const dflt = createGameStorage({ store: memStore(), ...NO_TIMERS });
  dflt.saves.write(SYNCED_SAVES_SCOPE, "y");
  await dflt.flush();
  assert.deepEqual(await serverKeys(), []);
});

test("storage: other scopes stay in the cache alone", async () => {
  const s = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  s.saves.write("rat-cellar", "text");
  await s.flush();
  assert.equal(s.saves.read("rat-cellar"), "text");
  assert.deepEqual(await serverKeys(), []);
});

test("storage: another player's cache is moved aside and never uploaded into this account", async () => {
  const store = memStore();
  let who: string | null = "player-a";
  const mk = (remote: SaveServer): ReturnType<typeof createGameStorage> => createGameStorage({ store, remote, account: () => who, ...NO_TIMERS });
  const a = mk(countedServer());
  const aSave = point("manual", 1);
  a.saves.write(SYNCED_SAVES_SCOPE, bookText([aSave]));
  await a.flush();
  resetLtSavesMock(); // a different account has its own rows: the mock is "that player's" now
  who = "player-b";
  const b = mk(countedServer());
  assert.equal(b.saves.read(SYNCED_SAVES_SCOPE), bookText([aSave]), "before the check it is still the cache");
  await b.ready();
  assert.equal(b.saves.read(SYNCED_SAVES_SCOPE), null, "player b does not see player a's save");
  assert.deepEqual(await serverKeys(), [], "and it was not uploaded");
  const backup = [...store.data.keys()].find((k) => k.startsWith(TABLE_KEYS.backupPrefix));
  assert.ok(backup, "it was kept aside, not deleted");
  assert.equal(JSON.parse(store.data.get(backup!)!).saves, bookText([aSave]));
});

test("storage: the window's own interface still reads and writes exactly as before (sync reads, texts in, texts out)", () => {
  const s = createGameStorage({ store: memStore(), remote: null, ...NO_TIMERS });
  assert.equal(s.saves.read("a"), null);
  s.saves.write("a", "one");
  s.saves.write("a", "two");
  assert.equal(s.saves.read("a"), "two");
  assert.deepEqual(s.aiAdventures.read(), []);
  const list = ["x", "y"];
  s.aiAdventures.write(list);
  list.push("z");
  assert.deepEqual(s.aiAdventures.read(), ["x", "y"], "stored as a copy");
});

// ---- wave 3 review fixes: a stale pull, permanent refusals, an unknown owner ------------------

test("storage: a save written while a pull is still running is kept and sent, not overwritten by the pull", async () => {
  const a = createGameStorage({ store: memStore(), remote: countedServer(), ...NO_TIMERS });
  const theirs = point("rest", 1);
  a.saves.write(SYNCED_SAVES_SCOPE, bookText([theirs]));
  await a.flush();

  const inner = countedServer();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const slow: SaveServer = { ...inner, get: async (key) => (await gate, inner.get(key)), list: () => inner.list(), put: inner.put, delete: inner.delete };
  const b = createGameStorage({ store: memStore(), remote: slow, ...NO_TIMERS });
  const pulling = b.sync();
  await new Promise((r) => setTimeout(r, 20)); // the pull has listed and is waiting on get
  const mine = point("checkpoint", 2);
  b.saves.write(SYNCED_SAVES_SCOPE, bookText([mine]));
  release();
  await pulling;
  await b.flush();
  const ids = parseSaves(b.saves.read(SYNCED_SAVES_SCOPE)).map((p) => p.id);
  assert.ok(ids.includes(mine.id), "the save written during the pull is still in the cache");
  assert.ok(ids.includes(theirs.id), "and the pulled one is there too");
  assert.ok((await serverKeys()).includes(saveRowKey(mine.id)), "and it reached the server");
});

test("ltSave calls: permanent refusals map to their own codes, a timeout or a server fault stays unavailable", async () => {
  const code = async (reply: () => unknown): Promise<string> => {
    (globalThis as { __conjureos?: unknown }).__conjureos = { actions: { invoke: async () => reply() } };
    try {
      await ltSavePut("s:abc", "manual", "", {});
      return "ok";
    } catch (e) {
      assert.ok(e instanceof LtSaveError);
      return e.code;
    }
  };
  const boom = (text: string) => (): never => {
    throw new Error(text);
  };
  try {
    for (const name of ["wrong_app", "unknown_action", "bad_label", "bad_payload", "bad_game"]) {
      assert.equal(await code(() => ({ error: name })), name, `a reply naming ${name}`);
      assert.equal(await code(boom(`games-db 400: ${name}`)), name, `a thrown message naming ${name}`);
    }
    assert.equal(await code(boom("games-db 422: nope")), "rejected", "any other 4xx is a refusal for good");
    assert.equal(await code(boom("HTTP 408")), "unavailable", "a timeout is retryable");
    assert.equal(await code(boom("HTTP 429")), "unavailable", "rate limited is retryable");
    assert.equal(await code(boom("HTTP 503")), "unavailable", "a 5xx is retryable");
    assert.equal(await code(boom("Couldn't reach the game. [diag: kernel fail(400ms) fail(410ms)]")), "unavailable", "timings in a message are not a status");
  } finally {
    delete (globalThis as { __conjureos?: unknown }).__conjureos;
  }
});

test("storage: a permanent refusal (not too_large) is its own message, stays local, and does not stop the other saves", async () => {
  const remote = countedServer();
  const seen: string[] = [];
  const s = createGameStorage({ store: memStore(), remote, onError: (m) => seen.push(m), ...NO_TIMERS });
  const a = point("manual", 1);
  const b = point("checkpoint", 2);
  const c = point("rest", 3);
  remote.failPut = (key) => (key === saveRowKey(b.id) ? new LtSaveError("bad_payload", "games-db 400: bad_payload") : null);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([c, b, a]));
  const r = await s.flush();
  assert.equal(r.ok, false);
  assert.notEqual(r.message, MESSAGES.offline, "not claimed as offline");
  assert.match(r.message ?? "", /refused this save/i);
  assert.match(r.message ?? "", /stays on this device/i);
  assert.equal(s.status().state, "error");
  const keys = await serverKeys();
  assert.ok(keys.includes(saveRowKey(a.id)) && keys.includes(saveRowKey(c.id)) && keys.includes(CURRENT_KEY), "the others went up");
  assert.ok(!keys.includes(saveRowKey(b.id)));
  assert.equal(s.status().pending, 0, "a refused row is not waiting");
  const puts = remote.calls.put.length;
  await s.flush();
  assert.equal(remote.calls.put.length, puts, "not sent again");
  assert.equal(seen.length, 1, "the player is told once");
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), bookText([c, b, a]), "all still here");
});

test("storage: a key that keeps failing as unavailable while the server answers the rest is rejected after a few tries", async () => {
  const remote = countedServer();
  const s = createGameStorage({ store: memStore(), remote, ...NO_TIMERS });
  const a = point("manual", 1);
  const b = point("checkpoint", 2);
  remote.failPut = (key) => (key === saveRowKey(a.id) ? new LtSaveError("unavailable", "HTTP 500") : null);
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([b, a]));
  const first = await s.flush();
  assert.equal(first.ok, false);
  assert.ok((await serverKeys()).includes(saveRowKey(b.id)), "the healthy row went up on the first try");
  for (let i = 0; i < 3; i++) await s.sync();
  assert.equal(s.status().pending, 0, "after a few tries the key is rejected, not waiting");
  assert.equal(s.status().state, "error");
  assert.doesNotMatch(statusText(s.status()), /connection is back|could not reach/i);
});

test("storage: a real outage never turns into a rejection, however many times it fails", async () => {
  const remote = countedServer();
  const s = createGameStorage({ store: memStore(), remote, ...NO_TIMERS });
  const list = [point("manual", 3), point("checkpoint", 2), point("rest", 1)];
  s.saves.write(SYNCED_SAVES_SCOPE, bookText(list));
  remote.down = true;
  for (let i = 0; i < 8; i++) await s.flush();
  assert.equal(s.status().state, "pending");
  remote.down = false;
  const back = await s.sync();
  assert.equal(back.ok, true);
  assert.equal(s.status().pending, 0);
  assert.deepEqual(await serverKeys(), [CURRENT_KEY, ...list.map((p) => saveRowKey(p.id))].sort());
});

test("storage: with a server but no known owner, nothing is pulled or pushed until the host says who is playing", async () => {
  const store = memStore();
  const old = createGameStorage({ store, remote: countedServer(), account: () => "player-a", ...NO_TIMERS });
  const aSave = point("manual", 1);
  old.saves.write(SYNCED_SAVES_SCOPE, bookText([aSave]));
  await old.flush();
  resetLtSavesMock(); // player b has their own account rows

  const remote = countedServer();
  let who: string | null = null;
  const s = createGameStorage({ store, remote, account: () => who, ...NO_TIMERS });
  const r = await s.ready();
  assert.equal(remote.calls.list + remote.calls.put.length + remote.calls.delete.length, 0, "no server call at all");
  assert.deepEqual(await serverKeys(), [], "the cache was not uploaded");
  assert.equal(r.pushed, 0);
  assert.equal(s.status().state, "local-only");
  assert.equal(s.waitingForOwner(), true);
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), bookText([aSave]), "the cache is untouched");
  s.saves.write(SYNCED_SAVES_SCOPE, bookText([point("rest", 2), aSave]));
  await s.flush();
  assert.deepEqual(await serverKeys(), [], "a write while the owner is unknown stays local too");

  who = "player-b";
  const known = await s.ownerKnown();
  assert.equal(known.ok, true);
  assert.equal(s.waitingForOwner(), false);
  assert.equal(s.saves.read(SYNCED_SAVES_SCOPE), null, "player b does not get player a's saves");
  assert.deepEqual(await serverKeys(), [], "and they were never uploaded");
  assert.ok([...store.data.keys()].some((k) => k.startsWith(TABLE_KEYS.backupPrefix)), "player a's cache was kept aside");
});

test("storage: when the owner becomes known and it is the same player, the held saves go up", async () => {
  const store = memStore();
  const remote = countedServer();
  let who: string | null = "player-a";
  const first = createGameStorage({ store, remote: null, account: () => who, ...NO_TIMERS });
  const p = point("manual", 1);
  first.saves.write(SYNCED_SAVES_SCOPE, bookText([p]));
  await first.flush();
  who = null;
  const s = createGameStorage({ store, remote, account: () => who, ...NO_TIMERS });
  await s.ready();
  assert.deepEqual(await serverKeys(), []);
  who = "player-a";
  const r = await s.ownerKnown();
  assert.equal(r.ok, true);
  assert.ok((await serverKeys()).includes(saveRowKey(p.id)));
  assert.equal(s.status().state, "synced");
});
