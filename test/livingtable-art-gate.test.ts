/**
 * The art gate and the converted-or-not decision (table/host/artGate.ts, table/host/artFailure.ts, table/host/gameArt.ts, table/host/devAssets.ts).
 *
 * The game waits for both KayKit art files before it shows a window, and shows a Retry screen when one cannot be had, so the old
 * hand-drawn pictures never stand in for a picture that has a KayKit version:
 *
 *  - the wait: pending while a file is on its way, ready once both are in, failed with a plain sentence when one cannot be had;
 *  - the retry: the WHOLE art load again (the games-db art asked for afresh, then the parts that failed), the parts that loaded kept and
 *    never fetched twice, so a server library that was refused for its palette and has been fixed is picked up by the same Retry the screen uses;
 *  - the words: every failure is one fixed plain sentence (no status code, no exception text, no reason code); the raw detail goes to the log;
 *  - the time limit: a download that never ends counts as a failed download, and a load that finishes late changes nothing;
 *  - an app too old to hand over files says to update it and offers no Retry; a page outside ConjureOS says to open it in the app;
 *  - the converted-or-not decision, worked out from the real committed files: the ids still drawn from the hand-drawn set are exactly those
 *    the library has no picture of, and it shrinks by itself when the library gains one;
 *  - the dev stand-in for the assets bridge answers only on a local page with no ConjureOS.
 *
 * Runs with no DOM and no network: the bridge, the reader and the inflate are fakes (the real inflate is node's zlib); the last tests read
 * the real files in asset-files/.
 *
 * Run: npx tsx --test test/livingtable-art-gate.test.ts
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { adaptManifest, clearManifestCacheForTests, loadManifest, type LoadedManifest } from "../src/games/livingtable/assets/manifestCache";
import type { CastData } from "../src/games/livingtable/table/host";
import type { AssetFiles } from "../src/games/livingtable/table/host/assetFiles";
import { ART_FAILURE_TEXT, PHONE_APP_WITH_ASSETS } from "../src/games/livingtable/table/host/artFailure";
import { ART_FAILED_FALLBACK, artGateOf, artIsReady, retryArt, waitForArt } from "../src/games/livingtable/table/host/artGate";
import { devAssetBridge } from "../src/games/livingtable/table/host/devAssets";
import {
  createGameArt,
  decodeLibraryPart,
  isConvertedId,
  libraryPartFiles,
  parseLibraryFile,
  unconvertedIds,
  ASSET_LOAD_TIMEOUT_MS,
  DEFAULT_LOOK,
  type AssetLoadResult,
  type AssetStatus,
  type AssetsBridge,
  type GameArtOptions,
  type LibraryFile,
  type LibraryPart,
} from "../src/games/livingtable/table/host/gameArt";

// ---- fixtures (the same shapes the asset-files test uses) ---------------------------------

const wireOf = (palette: unknown, sprites: typeof FANTASY_SPRITES) =>
  ({ template: "fantasy", palette, assets: sprites.map((s) => ({ assetId: s.assetId, kind: s.kind, name: s.name, size: s.size, walkable: s.walkable, pixels: s.pixels })) }) as Parameters<typeof adaptManifest>[0];

const BASE: LoadedManifest = adaptManifest(wireOf(FANTASY_PALETTE, FANTASY_SPRITES));
/** The games-db art as a server with the wrong palette would hand it over: the KayKit library cannot be laid over it. */
const WRONG_PALETTE: LoadedManifest = adaptManifest(wireOf(FANTASY_PALETTE.slice(0, 20), FANTASY_SPRITES));
const FILES: AssetFiles = { cast: "living-table-cast.json", library: "living-table-library.json" };

const CAST: CastData = {
  palette: [[0, 0, 0]],
  cameraPitchDeg: 30,
  styles: [{ style: "bands", label: "Cel bands", description: "", characters: [], gear: [], layerOrder: { down: [], right: [], up: [], left: [] } }],
};

function part(file: string, maker: string, style: string | null, size: 16 | 32, sprites: { assetId: string; w: number; h: number; fill: number }[]): LibraryPart {
  const raw = Buffer.concat(sprites.map((s) => Buffer.alloc(s.w * s.h, s.fill)));
  return { file, maker, size, style, sprites: sprites.map(({ assetId, w, h }) => ({ assetId, w, h })), data: deflateSync(raw).toString("base64") };
}

/** A library with one sprite of each kind in each part the default look needs. */
function library(): LibraryFile {
  return {
    palette: FANTASY_PALETTE as LibraryFile["palette"],
    parts: [
      part("ground-painted-32.json", "ground-painted", "painted", 32, [{ assetId: "floor_stone", w: 32, h: 32, fill: 7 }]),
      part("props-32.json", "props", "prop-30deg", 32, [{ assetId: "chest", w: 32, h: 32, fill: 8 }]),
      part("tokens-bands-32.json", "tokens", "bands", 32, [{ assetId: "token_knight", w: 32, h: 48, fill: 9 }]),
    ],
  };
}

const inflate = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(inflateSync(b));
const blobs: Record<string, unknown> = { "blob:cast": CAST, "blob:library": library() };
const reader = async (url: string): Promise<unknown> => {
  if (!(url in blobs)) throw new Error(`no such blob ${url}`);
  return blobs[url];
};

/** The raw detail of every failure lands here (the art's `warn` option), as console.warn would get it. */
const warnings: string[] = [];
const warn = (m: string): void => void warnings.push(m);

/**
 * A bridge whose answers a test steers: a name can be parked until released, made to fail, or made to work again. `calls` records every load.
 * It has `list`, like a ConjureOS that gives a game its files.
 */
function steered() {
  const calls: string[] = [];
  const failing = new Set<string>();
  const parked = new Map<string, { release: () => void; promise: Promise<void> }>();
  const park = (name: string): void => {
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    parked.set(name, { release, promise });
  };
  const bridge: AssetsBridge = {
    async load(name): Promise<AssetLoadResult> {
      calls.push(name);
      await parked.get(name)?.promise;
      if (failing.has(name)) return { ok: false, reason: "fetch_failed", error: "HTTP 503" };
      return name === FILES.cast ? { ok: true, objectUrl: "blob:cast" } : { ok: true, objectUrl: "blob:library" };
    },
    async list() {
      return [];
    },
  };
  return { bridge, calls, failing, park, release: (name: string) => parked.get(name)?.release() };
}

const artOn = (bridge: AssetsBridge | null, extra: Partial<GameArtOptions> = {}) =>
  createGameArt({ load: async () => BASE, inflate, assetFiles: FILES, readJson: reader, assets: bridge, warn, ...extra });

const status = (cast: AssetStatus["cast"], lib: AssetStatus["library"]): AssetStatus => ({ cast, library: lib, summary: "" });

/** No sentence a player reads may say the old art is on show. */
const OLD_ART_CLAIM = /table shows|hand-drawn|still figures/i;

/** What a player must never read: a status code, a parenthesised raw message, a reason code (they have underscores), an exception's words. */
const RAW_TEXT = /\bHTTP\b|\bstatus\b|\b[1-5]\d\d\b|[()]|_|kaboom|weird|Unexpected token|CSP|blob:|undefined|\[object|Error\b/i;

afterEach(() => {
  delete (globalThis as { __conjureos?: unknown }).__conjureos;
  delete (globalThis as { location?: unknown }).location;
  warnings.length = 0;
});

// ---- the gate over a status ------------------------------------------------------------------

test("artGateOf: ready only when both parts are ready; failed (each sentence once) when any did not load; else waiting", () => {
  const ready = { state: "ready" } as const;
  const down = { state: "fallback", failure: "download" } as const;
  const damaged = { state: "fallback", failure: "damaged" } as const;
  assert.deepEqual(artGateOf(status(ready, ready)), { state: "ready" });
  for (const waiting of ["waiting", "loading"] as const) {
    assert.deepEqual(artGateOf(status({ state: waiting }, ready)), { state: "waiting" }, `cast ${waiting}`);
    assert.deepEqual(artGateOf(status(ready, { state: waiting })), { state: "waiting" }, `library ${waiting}`);
  }
  assert.deepEqual(artGateOf(status(down, ready)), { state: "failed", reasons: [ART_FAILURE_TEXT.download], retry: true });
  assert.deepEqual(artGateOf(status({ state: "loading" }, damaged)), { state: "failed", reasons: [ART_FAILURE_TEXT.damaged], retry: true }, "a failure ends the wait even while the other part is still on its way");
  assert.deepEqual(artGateOf(status(down, down)), { state: "failed", reasons: [ART_FAILURE_TEXT.download], retry: true }, "one sentence, not two");
  assert.deepEqual(artGateOf(status(down, damaged)), { state: "failed", reasons: [ART_FAILURE_TEXT.download, ART_FAILURE_TEXT.damaged], retry: true });
});

test("artGateOf: the words a part gives about itself are never shown, only the fixed sentence of its kind of failure", () => {
  const ready = { state: "ready" } as const;
  const raw = { state: "fallback", reason: "could not be downloaded (HTTP 503) kaboom fetch_failed" } as const;
  assert.deepEqual(artGateOf(status(raw, ready)), { state: "failed", reasons: [ART_FAILED_FALLBACK], retry: true }, "no kind, so the plain fallback");
  assert.deepEqual(artGateOf(status({ ...raw, failure: "download" }, ready)), { state: "failed", reasons: [ART_FAILURE_TEXT.download], retry: true }, "a kind, so its sentence, not the part's own text");
  assert.deepEqual(artGateOf(status({ state: "fallback" }, { state: "fallback", reason: "  " })), { state: "failed", reasons: [ART_FAILED_FALLBACK], retry: true });
  assert.doesNotMatch(ART_FAILED_FALLBACK, RAW_TEXT);
});

test("artGateOf: a Retry is offered unless a failed part could never be fixed by one (an app too old to hand over files)", () => {
  const ready = { state: "ready" } as const;
  assert.equal((artGateOf(status({ state: "fallback", failure: "update" }, ready)) as { retry: boolean }).retry, false);
  assert.equal((artGateOf(status({ state: "fallback", failure: "update" }, { state: "fallback", failure: "download" })) as { retry: boolean }).retry, false, "one part that Retry cannot fix is enough");
  for (const failure of ["download", "damaged", "unavailable", "mismatch", "outside", "unknown"] as const) {
    assert.equal((artGateOf(status({ state: "fallback", failure }, ready)) as { retry: boolean }).retry, true, failure);
  }
});

// ---- the wait --------------------------------------------------------------------------------

test("waitForArt: both files load, so the game may go on to its main menu", async () => {
  const s = steered();
  const art = artOn(s.bridge);
  await art.load();
  const res = await waitForArt(art);
  assert.deepEqual(res, { state: "ready" });
  assert.equal(artIsReady(art), true);
  assert.deepEqual([...s.calls].sort(), [FILES.cast, FILES.library].sort());
  assert.ok(art.cast(), "the cast is in");
  assert.equal(art.render("fantasy").spriteSize, 32, "and the KayKit board art is laid over the hand-drawn base");
  assert.deepEqual(warnings, [], "nothing to log when nothing went wrong");
});

test("waitForArt: the game waits while a file is on its way, and goes on the moment it lands", async () => {
  const s = steered();
  s.park(FILES.library!);
  const art = artOn(s.bridge);
  await art.load(); // load() starts the files in the background but does not wait for them
  assert.equal(artIsReady(art), false, "the library is still on its way");
  let settled: unknown = null;
  const waiting = waitForArt(art).then((r) => (settled = r));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, null, "still waiting: the window must not mount on the hand-drawn art");
  assert.equal(artGateOf(art.assetStatus()).state, "waiting");
  s.release(FILES.library!);
  await waiting;
  assert.deepEqual(settled, { state: "ready" });
  assert.equal(artIsReady(art), true);
});

test("waitForArt: a file that cannot be had ends the wait with one plain sentence, never the status code, and never claims the old art is shown", async () => {
  const s = steered();
  s.failing.add(FILES.cast!);
  s.failing.add(FILES.library!);
  const art = artOn(s.bridge);
  await art.load();
  const res = await waitForArt(art);
  assert.deepEqual(res, { state: "failed", reasons: [ART_FAILURE_TEXT.download], retry: true }, "both files failed the same way: said once");
  assert.doesNotMatch(ART_FAILURE_TEXT.download, OLD_ART_CLAIM);
  assert.doesNotMatch(ART_FAILURE_TEXT.download, RAW_TEXT);
  assert.equal(artIsReady(art), false);
  assert.ok(warnings.some((w) => /HTTP 503/.test(w)), "the status code went to the log");
});

test("waitForArt: no assets bridge at all (the game outside the ConjureOS app) is a failure with one plain sentence that says to open it in the app", async () => {
  const art = artOn(null);
  await art.load();
  const res = await waitForArt(art);
  assert.deepEqual(res, { state: "failed", reasons: [ART_FAILURE_TEXT.outside], retry: true });
  assert.match(ART_FAILURE_TEXT.outside, /Open the game in the ConjureOS app/);
  assert.doesNotMatch(ART_FAILURE_TEXT.outside, OLD_ART_CLAIM);
});

test("waitForArt: a library the game cannot lay over its base art (another palette) is a failure, not a quiet fall back", async () => {
  const s = steered();
  const art = artOn(s.bridge, { load: async () => WRONG_PALETTE });
  await art.load();
  const res = await waitForArt(art);
  assert.deepEqual(res, { state: "failed", reasons: [ART_FAILURE_TEXT.mismatch], retry: true });
  assert.doesNotMatch(res.state === "failed" ? res.reasons.join(" ") : "", OLD_ART_CLAIM);
  assert.ok(warnings.some((w) => /colours are not the game's palette/.test(w)), "the detail is in the log");
});

test("waitForArt never rejects: an art whose loadAssets throws is a failure with the fallback sentence", async () => {
  const art = {
    loadAssets: () => Promise.reject(new Error("boom")),
    assetStatus: (): AssetStatus => status({ state: "waiting" }, { state: "waiting" }),
  };
  assert.deepEqual(await waitForArt(art), { state: "failed", reasons: [ART_FAILED_FALLBACK], retry: true });
});

test("waitForArt: the art let go under the wait (the screen is leaving) ends it as a failure, not a hang", async () => {
  const s = steered();
  s.park(FILES.cast!);
  const art = artOn(s.bridge);
  await art.load();
  const waiting = waitForArt(art);
  art.dispose();
  s.release(FILES.cast!);
  assert.deepEqual(await waiting, { state: "failed", reasons: [ART_FAILED_FALLBACK], retry: true });
});

// ---- the words: no raw text reaches the screen ---------------------------------------------------

/** A bridge that answers every load the same way. */
const answering = (answer: AssetLoadResult | undefined | "throw"): AssetsBridge => ({
  async load() {
    if (answer === "throw") throw new Error("kaboom");
    return answer as AssetLoadResult;
  },
  async list() {
    return [];
  },
});

test("every way the files can fail is one of the fixed plain sentences: no status code, no parenthesised raw message, no reason code, and the detail is logged", async () => {
  const badLibrary = (mutate: (l: LibraryFile) => unknown) => async (u: string): Promise<unknown> => (u === "blob:cast" ? CAST : mutate(library()));
  const cases: { label: string; kind: keyof typeof ART_FAILURE_TEXT; logged: RegExp | null; make: () => ReturnType<typeof artOn> }[] = [
    { label: "download failed, HTTP 503", kind: "download", logged: /HTTP 503/, make: () => artOn(answering({ ok: false, reason: "fetch_failed", error: "HTTP 503" })) },
    { label: "download failed with an exception's words", kind: "download", logged: /kaboom/, make: () => artOn(answering({ ok: false, reason: "fetch_failed", error: "kaboom" })) },
    { label: "download failed with no words", kind: "download", logged: /fetch_failed/, make: () => artOn(answering({ ok: false, reason: "fetch_failed" })) },
    { label: "the bridge itself threw", kind: "download", logged: /kaboom/, make: () => artOn(answering("throw")) },
    { label: "a reason code nobody knows", kind: "unknown", logged: /weird_code/, make: () => artOn(answering({ ok: false, reason: "weird_code" })) },
    { label: "the bridge gave no answer", kind: "unknown", logged: /no answer/, make: () => artOn(answering(undefined)) },
    { label: "the platform says the file's hash does not match", kind: "damaged", logged: /mismatch/, make: () => artOn(answering({ ok: false, reason: "mismatch" })) },
    { label: "the platform says the file is over the size limit", kind: "unavailable", logged: /too_large/, make: () => artOn(answering({ ok: false, reason: "too_large" })) },
    { label: "the platform does not know the file", kind: "unavailable", logged: /unknown_name/, make: () => artOn(answering({ ok: false, reason: "unknown_name" })) },
    { label: "the file is text that is not JSON", kind: "damaged", logged: /Unexpected token/, make: () => artOn(steered().bridge, { readJson: async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); } }) },
    { label: "the file cannot be read (a CSP refusal)", kind: "unknown", logged: /CSP blocked/, make: () => artOn(steered().bridge, { readJson: async () => { throw new Error("CSP blocked connect-src (blob)"); } }) },
    { label: "the file is JSON but not what the table expects", kind: "damaged", logged: /not in the format/, make: () => artOn(steered().bridge, { readJson: async () => ({}) }) },
    { label: "no file name in this build", kind: "unavailable", logged: /no file of this name/, make: () => artOn(steered().bridge, { assetFiles: { cast: null, library: null } }) },
    { label: "a malformed file name", kind: "unavailable", logged: /not valid/, make: () => artOn(steered().bridge, { assetFiles: { cast: "../cast.json", library: "has space.json" } }) },
    { label: "outside ConjureOS", kind: "outside", logged: /no window\.__conjureos/, make: () => artOn(null) },
    { label: "an app with no list", kind: "update", logged: /no list/, make: () => artOn({ load: async () => ({ ok: false, reason: "fetch_failed" }) } as AssetsBridge) },
    { label: "a library for other colours than the game's", kind: "mismatch", logged: /colours are not the game's palette/, make: () => artOn(steered().bridge, { load: async () => WRONG_PALETTE }) },
    { label: "a library with a part missing", kind: "damaged", logged: /has no props-32\.json/, make: () => artOn(steered().bridge, { readJson: badLibrary((l) => ({ ...l, parts: l.parts.filter((p) => p.file !== "props-32.json") })) }) },
    { label: "a library part cut short", kind: "damaged", logged: /shorter than its sprites/, make: () => artOn(steered().bridge, { readJson: badLibrary((l) => ({ ...l, parts: l.parts.map((p) => (p.file === "tokens-bands-32.json" ? { ...p, data: deflateSync(Buffer.alloc(10)).toString("base64") } : p)) })) }) },
    { label: "a download that never ends", kind: "download", logged: /no answer within 20 ms/, make: () => artOn({ load: () => new Promise<AssetLoadResult>(() => {}), list: async () => [] }, { loadTimeoutMs: 20 }) },
  ];
  const allSentences = new Set(Object.values(ART_FAILURE_TEXT));
  for (const c of cases) {
    warnings.length = 0;
    const art = c.make();
    await art.load();
    const res = await waitForArt(art);
    assert.equal(res.state, "failed", c.label);
    if (res.state !== "failed") continue;
    assert.deepEqual(res.reasons, [ART_FAILURE_TEXT[c.kind]], `${c.label}: the sentence of its kind`);
    for (const sentence of res.reasons) {
      assert.ok(allSentences.has(sentence), `${c.label}: a fixed sentence`);
      assert.doesNotMatch(sentence, RAW_TEXT, `${c.label}: no status code, no parenthesised message, no reason code`);
    }
    const s = art.assetStatus();
    for (const p of [s.cast, s.library]) assert.doesNotMatch(p.reason ?? "", RAW_TEXT, `${c.label}: the part's own words are plain too`);
    assert.doesNotMatch(s.summary, RAW_TEXT, `${c.label}: and so is the summary`);
    assert.ok(c.logged && warnings.some((w) => c.logged!.test(w)), `${c.label}: the raw detail is in the log (${warnings.join(" | ")})`);
  }
  for (const sentence of allSentences) assert.doesNotMatch(sentence, RAW_TEXT, `the table of sentences: ${sentence}`);
  assert.equal(allSentences.size, Object.keys(ART_FAILURE_TEXT).length, "no two kinds share a sentence");
});

// ---- the retry -------------------------------------------------------------------------------

test("Retry is the art load again: only the part that failed is downloaded again, and the game goes on when it works", async () => {
  const s = steered();
  s.failing.add(FILES.library!);
  const art = artOn(s.bridge);
  await art.load();
  const first = await waitForArt(art);
  assert.equal(first.state, "failed");
  if (first.state !== "failed") return;
  assert.deepEqual(first.reasons, [ART_FAILURE_TEXT.download], "the cast loaded; only the board art is in trouble");
  assert.equal(art.cast() !== null, true, "the figures are kept");
  assert.equal(art.assetStatus().cast.state, "ready");
  const before = s.calls.length;

  s.failing.delete(FILES.library!); // the connection is back
  const second = await retryArt(art);
  assert.deepEqual(second, { state: "ready" });
  assert.deepEqual(s.calls.slice(before), [FILES.library], "Retry asked for the board art alone: the figures were not downloaded twice");
  assert.equal(art.render("fantasy").spriteSize, 32);
});

test("Retry that fails again says why again, and a third try can still work", async () => {
  const s = steered();
  s.failing.add(FILES.cast!);
  s.failing.add(FILES.library!);
  const art = artOn(s.bridge);
  await art.load();
  assert.equal((await waitForArt(art)).state, "failed");
  assert.equal((await retryArt(art)).state, "failed", "still down");
  s.failing.clear();
  assert.deepEqual(await retryArt(art), { state: "ready" });
  assert.equal(s.calls.filter((n) => n === FILES.cast).length, 3, "each try asked again");
});

test("Retry whose games-db call never answers goes on with what it has after its limit, so the screen is not held forever", async () => {
  const s = steered();
  s.failing.add(FILES.library!);
  let hang = false;
  const art = artOn(s.bridge, {
    load: async () => {
      if (hang) return new Promise<LoadedManifest>(() => {}); // the games-db call that never answers
      return BASE;
    },
  });
  await art.load();
  assert.equal((await waitForArt(art)).state, "failed");
  hang = true;
  s.failing.clear(); // the board art could be had now; only the games-db call is stuck
  const started = Date.now();
  const result = await retryArt(art, { reloadTimeoutMs: 50 });
  assert.ok(Date.now() - started < 5_000, "Retry came back instead of waiting on the stuck call");
  assert.deepEqual(result, { state: "ready" }, "the kept games-db art was used and the board art loaded");
});

test("Retry after a palette mismatch: the games-db art is asked for afresh and the kept library is laid over it, so a fixed server recovers, and nothing is downloaded again", async () => {
  const s = steered();
  const asked: (boolean | undefined)[] = [];
  let serverFixed = false;
  // A cached copy (the first, plain ask) keeps being the wrong one; only a fresh ask sees the server's corrected art.
  const art = artOn(s.bridge, {
    load: async (_t, o) => {
      asked.push(o?.fresh);
      return o?.fresh && serverFixed ? BASE : WRONG_PALETTE;
    },
  });
  await art.load();
  const first = await waitForArt(art);
  assert.deepEqual(first, { state: "failed", reasons: [ART_FAILURE_TEXT.mismatch], retry: true });
  const downloads = s.calls.length;
  assert.equal(downloads, 2, "both files were downloaded once");

  // Waiting again alone cannot fix it: the library is kept and nothing lays it over the corrected art.
  assert.equal((await waitForArt(art)).state, "failed");

  // Still wrong on the server: Retry fails the same way, and still downloads nothing.
  assert.deepEqual(await retryArt(art), { state: "failed", reasons: [ART_FAILURE_TEXT.mismatch], retry: true });
  assert.equal(art.render("fantasy").spriteSize ?? 16, 16, "the hand-drawn art is not dressed up as the board art");

  serverFixed = true;
  assert.deepEqual(await retryArt(art), { state: "ready" }, "the corrected art is picked up by the same Retry the screen uses");
  assert.deepEqual(asked, [undefined, true, true], "the first load used the cache; each Retry asked for a fresh copy");
  assert.equal(s.calls.length, downloads, "the kept files were not fetched again");
  assert.equal(art.render("fantasy").spriteSize, 32, "and the board art is laid over the corrected base");
  assert.equal(art.assetStatus().library.state, "ready");
  assert.equal(art.assetStatus().cast.state, "ready");
});

test("Retry when the games-db art cannot be had this time still waits for the files, and never rejects", async () => {
  const s = steered();
  s.failing.add(FILES.library!);
  let n = 0;
  const art = artOn(s.bridge, {
    load: async (_t, o) => {
      n += 1;
      if (o?.fresh) throw new Error("kaboom");
      return BASE;
    },
  });
  await art.load();
  assert.equal((await waitForArt(art)).state, "failed");
  s.failing.delete(FILES.library!);
  const res = await retryArt(art); // the fresh ask throws; the bundled art serves, and the files still load
  assert.equal(n >= 2, true);
  assert.deepEqual(res, { state: "ready" });
});

test("loadManifest with fresh: true skips the memory and storage copies, asks again, and replaces them (a Retry sees a corrected server library)", async () => {
  const g = globalThis as { localStorage?: unknown };
  const realStorage = g.localStorage;
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    clearManifestCacheForTests();
    const key = "livingtable:manifest:v3:fantasy";
    store.set(key, JSON.stringify({ template: "fantasy", palette: [[1, 2, 3]], assets: [] })); // the copy a player's device kept
    const cached = await loadManifest("fantasy");
    assert.equal(cached.render.palette.length, 1, "a plain load serves the kept copy");
    assert.equal(await loadManifest("fantasy"), cached, "and then the one in memory");
    const fresh = await loadManifest("fantasy", { fresh: true });
    assert.notEqual(fresh, cached, "fresh asks again");
    assert.notEqual(fresh.render.palette.length, 1, "and gets the server's own library");
    assert.equal(await loadManifest("fantasy"), fresh, "which is what a plain load serves from then on");
    assert.notEqual(JSON.parse(store.get(key)!).palette.length, 1, "and what the device keeps");
  } finally {
    clearManifestCacheForTests();
    g.localStorage = realStorage;
  }
});

test("waiting again once the art is in is a no-op: nothing is loaded twice", async () => {
  const s = steered();
  const art = artOn(s.bridge);
  await art.load();
  await waitForArt(art);
  const n = s.calls.length;
  assert.deepEqual(await waitForArt(art), { state: "ready" });
  assert.equal(s.calls.length, n);
});

// ---- a download that never ends ----------------------------------------------------------------

test("a file that never arrives counts as a failed download after its time limit, and the Retry screen can come up", async () => {
  assert.equal(ASSET_LOAD_TIMEOUT_MS, 120_000, "two minutes: a 6.3 MB file on a slow phone connection still makes it");
  const s = steered();
  s.park(FILES.library!); // never released during the wait
  const art = artOn(s.bridge, { loadTimeoutMs: 40 });
  await art.load();
  const t0 = Date.now();
  const res = await waitForArt(art);
  assert.deepEqual(res, { state: "failed", reasons: [ART_FAILURE_TEXT.download], retry: true });
  assert.ok(Date.now() - t0 < 2000, "it did not wait for ever");
  assert.equal(art.assetStatus().cast.state, "ready", "the figures were not held up by the board art");
  assert.equal(art.assetStatus().library.state, "fallback");
  assert.ok(warnings.some((w) => /no answer within 40 ms/.test(w)), "the log says it timed out");
  assert.doesNotMatch(res.reasons.join(" "), /40|ms|timed|timeout/i, "the screen does not");
});

test("a load that finishes after its time limit changes nothing", async () => {
  const s = steered();
  s.park(FILES.cast!);
  s.park(FILES.library!);
  let reads = 0;
  const art = artOn(s.bridge, {
    loadTimeoutMs: 30,
    readJson: async (u) => {
      reads += 1;
      return reader(u);
    },
  });
  let changes = 0;
  art.onChange(() => void (changes += 1));
  await art.load();
  const res = await waitForArt(art);
  assert.equal(res.state, "failed");
  const settledStatus = JSON.stringify(art.assetStatus());
  const settledChanges = changes;
  const signature = art.signature();

  s.release(FILES.cast!);
  s.release(FILES.library!);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(JSON.stringify(art.assetStatus()), settledStatus, "the status is as it was");
  assert.equal(changes, settledChanges, "nobody was told of anything");
  assert.equal(art.signature(), signature);
  assert.equal(art.cast(), null, "the late figures were dropped");
  assert.equal(art.render("fantasy"), BASE.render, "and the late board art");
  assert.equal(reads, 0, "a late file is not even read");

  // The next try is a new download, and it works (the parked files are released now).
  assert.deepEqual(await retryArt(art), { state: "ready" });
  assert.equal(reads, 2);
});

test("a file that arrives within its time limit is not touched by the limit (the timer is let go)", async () => {
  const s = steered();
  const art = artOn(s.bridge, { loadTimeoutMs: 25 });
  await art.load();
  assert.deepEqual(await waitForArt(art), { state: "ready" });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(artGateOf(art.assetStatus()), { state: "ready" }, "the limit passing later does not turn it into a failure");
  assert.deepEqual(warnings, []);
});

// ---- an app too old to hand over files, and no app at all --------------------------------------------

test("a ConjureOS app with no assets bridge, or one without list, says to update the app and offers no Retry; outside ConjureOS says to open it in the app", async () => {
  const g = globalThis as { __conjureos?: unknown };
  const noop = { load: async () => ({ ok: false, reason: "fetch_failed" }) };
  const hosts: [string, unknown][] = [
    ["a host with no assets object", { ai: {} }],
    ["a host whose assets object has no list", { assets: noop }],
    ["a host whose assets object has neither load nor list", { assets: {} }],
  ];
  for (const [label, host] of hosts) {
    g.__conjureos = host;
    const art = createGameArt({ load: async () => BASE, inflate, assetFiles: FILES, readJson: reader, warn }); // the default bridge: window.__conjureos.assets
    await art.load();
    const res = await waitForArt(art);
    assert.deepEqual(res, { state: "failed", reasons: [ART_FAILURE_TEXT.update], retry: false }, label);
    assert.deepEqual(await retryArt(art), { state: "failed", reasons: [ART_FAILURE_TEXT.update], retry: false }, `${label}: and Retry would say the same`);
  }
  assert.match(ART_FAILURE_TEXT.update, /Update the app/);
  assert.match(ART_FAILURE_TEXT.update, /ConjureOS app/);
  assert.ok(ART_FAILURE_TEXT.update.includes(PHONE_APP_WITH_ASSETS), "and says which phone app has it");
  assert.equal(PHONE_APP_WITH_ASSETS, "0.59.1");
  assert.doesNotMatch(ART_FAILURE_TEXT.update, RAW_TEXT);

  // No window.__conjureos at all, and not a local development page: open it in the app. Retry stays (a host may be attached late).
  delete g.__conjureos;
  const outside = createGameArt({ load: async () => BASE, inflate, assetFiles: FILES, readJson: reader, warn });
  await outside.load();
  assert.deepEqual(await waitForArt(outside), { state: "failed", reasons: [ART_FAILURE_TEXT.outside], retry: true });
  assert.notEqual(ART_FAILURE_TEXT.outside, ART_FAILURE_TEXT.update);
});

// ---- the converted-or-not decision ---------------------------------------------------------------

test("isConvertedId and unconvertedIds: an id is converted when a part has it, and the rest are the ones still drawn by hand", () => {
  const parts = [new Map([["floor_a", [[1]]]]), new Map([["token_x", [[2]]]])];
  assert.equal(isConvertedId("floor_a", parts), true);
  assert.equal(isConvertedId("token_x", parts), true, "any part counts");
  assert.equal(isConvertedId("barrel", parts), false);
  assert.equal(isConvertedId("floor_a", []), false, "before the library is in nothing is converted");
  const base = { palette: [], tiles: { floor_a: { pixels: [[0]] }, floor_wood: { pixels: [[0]] } }, props: { barrel: { pixels: [[0]] } }, tokens: { token_x: { pixels: [[0]] }, token_rat: { pixels: [[0]] } } };
  assert.deepEqual(unconvertedIds(base, parts), { tiles: ["floor_wood"], props: ["barrel"], tokens: ["token_rat"] });
  // It shrinks by itself: the owner converts the barrel, the id leaves the list with no edit anywhere.
  assert.deepEqual(unconvertedIds(base, [...parts, new Map([["barrel", [[3]]]])]), { tiles: ["floor_wood"], props: [], tokens: ["token_rat"] });
});

/** The ids the owner has said have no KayKit version today (the 3D packs on hand have none). The computed list may only shrink from this. */
const KNOWN_WITHOUT_KAYKIT = {
  tiles: ["floor_wood", "floor_wood_b", "wall_earth", "wall_earth_b"],
  props: ["barrel", "crate", "crate_stack", "bar_counter_w", "bar_counter_mid", "bar_counter_e", "stool", "chair", "workbench", "anvil", "hearth", "shelf", "rug", "stairs_down", "ladder_up", "rat_hole", "tunnel_mouth", "sack", "cobweb"],
  tokens: [
    "token_goblin", "token_rat", "token_giant_rat", "token_healer",
    "gear_healer_weapon_base", "gear_healer_weapon_rare", "gear_healer_weapon_legendary",
    "gear_healer_outer_base", "gear_healer_outer_rare", "gear_healer_outer_legendary",
    "gear_healer_crown_base", "gear_healer_crown_rare", "gear_healer_crown_legendary",
    "gear_healer_boots_base", "gear_healer_boots_rare",
  ],
};

async function realArt() {
  const cast = JSON.parse(readFileSync("asset-files/living-table-cast.json", "utf8"));
  const lib = JSON.parse(readFileSync("asset-files/living-table-library.json", "utf8"));
  const s = steered();
  const art = createGameArt({ load: async () => BASE, assetFiles: FILES, assets: s.bridge, readJson: async (u) => (u === "blob:cast" ? cast : lib) });
  return { art, lib: parseLibraryFile(lib)! };
}

test("the real files: the ids still drawn by hand are computed from them, are no more than the owner's list, and none of them is in the library", async () => {
  const { art, lib } = await realArt();
  await art.load();
  assert.equal(art.handMade("fantasy"), null, "before the library is in, nothing can be said to be converted");
  assert.equal(art.converted("token_knight"), false);
  assert.deepEqual(await waitForArt(art), { state: "ready" });

  const left = art.handMade("fantasy")!;
  assert.ok(left, "known once the library is in");
  for (const kind of ["tiles", "props", "tokens"] as const) {
    for (const id of left[kind]) assert.ok(KNOWN_WITHOUT_KAYKIT[kind].includes(id), `${id} is drawn by hand but the owner has not said it has no KayKit version`);
  }
  // Today the computed list is exactly the owner's. When more is converted the line above still holds and this one is updated.
  const sorted = (s: { tiles: string[]; props: string[]; tokens: string[] }) => ({ tiles: [...s.tiles].sort(), props: [...s.props].sort(), tokens: [...s.tokens].sort() });
  assert.deepEqual(sorted(left), sorted(KNOWN_WITHOUT_KAYKIT), "the computed list is the owner's list");

  const inLibrary = new Set<string>();
  for (const name of libraryPartFiles(DEFAULT_LOOK)) for (const sp of lib.parts.find((p) => p.file === name)!.sprites) inLibrary.add(sp.assetId);
  for (const id of [...left.tiles, ...left.props, ...left.tokens]) assert.equal(inLibrary.has(id), false, `${id} is in the library, so it is converted`);
  for (const id of inLibrary) assert.equal(art.converted(id), true, `${id}: the library has it`);
  for (const id of [...left.tiles, ...left.props, ...left.tokens]) assert.equal(art.converted(id), false, `${id}: nothing converted it`);
  assert.equal(art.converted("token_knight"), true);
  assert.equal(art.converted("token_shadow"), true);
  assert.equal(art.converted("token_fireball_person"), true);
  assert.equal(art.converted("token_goblin"), false);
  assert.equal(art.converted("token_not_a_thing"), false);
});

test("the real files: every converted id is drawn from the library and every other one from the hand-drawn picture, upscaled", async () => {
  const { art, lib } = await realArt();
  await art.load();
  await waitForArt(art);
  const render = art.render("fantasy");
  const left = art.handMade("fantasy")!;
  const handMade = new Set([...left.tiles, ...left.props, ...left.tokens]);
  // The library's own pixels, decoded the way the art decodes them.
  const parts = await Promise.all(libraryPartFiles(DEFAULT_LOOK).map((name) => decodeLibraryPart(lib.parts.find((p) => p.file === name)!)));
  const fromLibrary = (id: string): number[][] | undefined => parts.map((p) => p.get(id)).find(Boolean);
  const upscaled = (px: number[][]): number[][] => px.flatMap((row) => { const wide = row.flatMap((v) => [v, v]); return [wide, wide.slice()]; });
  let converted = 0;
  for (const [kind, ids] of [["tiles", Object.keys(BASE.render.tiles)], ["props", Object.keys(BASE.render.props)], ["tokens", Object.keys(BASE.render.tokens)]] as const) {
    for (const id of ids) {
      const drawn = render[kind][id]!.pixels;
      if (handMade.has(id)) {
        assert.deepEqual(drawn, upscaled(BASE.render[kind][id]!.pixels), `${id} keeps its hand-drawn picture, as it was`);
      } else {
        assert.deepEqual(drawn, fromLibrary(id), `${id} is drawn from the library, never from the hand-drawn set`);
        converted += 1;
      }
    }
  }
  assert.ok(converted > 300, `most of the art is converted (${converted})`);
  assert.equal(handMade.size, 38, "and 38 ids remain by hand");
});

// ---- the dev stand-in for the bridge ----------------------------------------------------------------

test("devAssetBridge: answers only on a local page with no ConjureOS at all", () => {
  const g = globalThis as { location?: unknown; __conjureos?: unknown };
  assert.equal(devAssetBridge(), null, "no page, no stand-in (Node)");
  g.location = { hostname: "127.0.0.1" };
  assert.ok(devAssetBridge(), "a local page with no ConjureOS gets one");
  g.location = { hostname: "localhost" };
  assert.ok(devAssetBridge());
  g.location = { hostname: "example.test" };
  assert.equal(devAssetBridge(), null, "not on any other host");
  g.location = { hostname: "127.0.0.1" };
  g.__conjureos = {};
  assert.equal(devAssetBridge(), null, "not when ConjureOS (or a mock of it) is there: its own bridge, or none, is what the game uses");
});

test("devAssetBridge: lists the two files and loads them from the dev server's own /asset-files/, with plain failures", async () => {
  const g = globalThis as { location?: unknown; fetch?: unknown };
  g.location = { hostname: "127.0.0.1" };
  const realFetch = g.fetch;
  const asked: string[] = [];
  g.fetch = async (url: string) => {
    asked.push(url);
    return url.endsWith("living-table-cast.json") ? { ok: true, status: 200, blob: async () => new Blob(["{}"]) } : { ok: false, status: 404, blob: async () => new Blob([]) };
  };
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = () => "blob:dev";
  try {
    const b = devAssetBridge()!;
    assert.deepEqual(await b.list!(), ["living-table-cast.json", "living-table-library.json"]);
    const ok = await b.load("living-table-cast.json");
    assert.equal(ok.ok, true);
    assert.deepEqual(asked, ["/asset-files/living-table-cast.json"]);
    assert.deepEqual(await b.load("living-table-library.json"), { ok: false, reason: "fetch_failed", error: "HTTP 404" });
    assert.deepEqual(await b.load("not-a-file.json"), { ok: false, reason: "unknown_name" });
    g.fetch = async () => {
      throw new Error("offline");
    };
    assert.deepEqual(await b.load("living-table-cast.json"), { ok: false, reason: "fetch_failed", error: "offline" });
  } finally {
    g.fetch = realFetch;
    URL.createObjectURL = realCreate;
  }
});

test("gameArt on a local dev page with no ConjureOS reads the dev server's files, so local play gets the art", async () => {
  const g = globalThis as { location?: unknown; fetch?: unknown };
  g.location = { hostname: "localhost" };
  const realFetch = g.fetch;
  const asked: string[] = [];
  g.fetch = async (url: string) => {
    asked.push(url);
    return { ok: true, status: 200, blob: async () => new Blob([JSON.stringify(url.includes("cast") ? CAST : library())]) };
  };
  try {
    const art = createGameArt({ load: async () => BASE, inflate, assetFiles: FILES });
    await art.load();
    assert.deepEqual(await waitForArt(art), { state: "ready" });
    assert.ok(art.cast());
    assert.deepEqual(asked.sort(), ["/asset-files/living-table-cast.json", "/asset-files/living-table-library.json"]);
  } finally {
    g.fetch = realFetch;
  }
});
