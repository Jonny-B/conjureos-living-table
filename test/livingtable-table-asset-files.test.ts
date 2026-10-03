/**
 * Tests for the animated art as ConjureOS asset files: host/assetFiles.ts (where the files are),
 * host/gameArt.ts (loading them through `window.__conjureos.assets.load`, falling back, caching),
 * and scripts/assets/export-asset-files.mjs (writing the files the owner uploads).
 *
 * Runs with no DOM and no network: the bridge, the object-URL reader and the inflate are fakes
 * (the real inflate is node's zlib). A last test reads the real packed files from .cache when they
 * are there and is skipped when they are not.
 *
 * Run: npx tsx --test test/livingtable-table-asset-files.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
// @ts-ignore (a plain .mjs: no types, and the test runner does not typecheck)
import { CAST_NAME, LIBRARY_NAME, buildAssetFiles } from "../scripts/assets/export-asset-files.mjs";
import { adaptManifest, type LoadedManifest } from "../src/games/livingtable/assets/manifestCache";
import type { CastData } from "../src/games/livingtable/table/host";
import { ASSET_FILES, ASSET_FILE_NAMES, validAssetRef, type AssetFiles } from "../src/games/livingtable/table/host/assetFiles";
import {
  DEFAULT_LOOK,
  assetReason,
  createGameArt,
  decodeLibraryPart,
  kaykitRender,
  libraryPartFiles,
  parseCastFile,
  parseLibraryFile,
  type AssetLoadResult,
  type AssetsBridge,
  type LibraryFile,
  type LibraryPart,
} from "../src/games/livingtable/table/host/gameArt";

// ---- fixtures ---------------------------------------------------------------------

const wireOf = (palette: unknown, sprites: typeof FANTASY_SPRITES) =>
  ({ template: "fantasy", palette, assets: sprites.map((s) => ({ assetId: s.assetId, kind: s.kind, name: s.name, size: s.size, walkable: s.walkable, pixels: s.pixels })) }) as Parameters<typeof adaptManifest>[0];

/** The hand-drawn art games-db serves, through the same adapter the game uses. */
const BASE: LoadedManifest = adaptManifest(wireOf(FANTASY_PALETTE, FANTASY_SPRITES));

const sha = (n: number): string => n.toString(16).padStart(64, "0");
const FILES: AssetFiles = {
  cast: { url: "https://assets.example/cast", sha256: sha(1) },
  library: { url: "https://assets.example/library", sha256: sha(2) },
};

const CAST: CastData = {
  palette: [[0, 0, 0]],
  cameraPitchDeg: 30,
  styles: [
    { style: "plain", label: "Plain", description: "", characters: [], gear: [], layerOrder: { down: [], right: [], up: [], left: [] } },
    { style: "bands", label: "Cel bands", description: "", characters: [], gear: [], layerOrder: { down: [], right: [], up: [], left: [] } },
  ],
};

/** A packed part: every sprite filled with one palette index (255 for transparent), zlib then base64, as pack-library.mjs writes it. */
function part(file: string, maker: string, style: string | null, size: 16 | 32, sprites: { assetId: string; w: number; h: number; fill: number }[]): LibraryPart {
  const raw = Buffer.concat(sprites.map((s) => Buffer.alloc(s.w * s.h, s.fill)));
  return { file, maker, size, style, sprites: sprites.map(({ assetId, w, h }) => ({ assetId, w, h })), data: deflateSync(raw).toString("base64") };
}

/** A library with one sprite of each kind in each part the default look needs. floor_stone is index 7, chest 8, token_goblin 9. */
function library(palette: unknown = FANTASY_PALETTE): LibraryFile {
  return {
    palette: palette as LibraryFile["palette"],
    parts: [
      part("ground-painted-32.json", "ground-painted", "painted", 32, [{ assetId: "floor_stone", w: 32, h: 32, fill: 7 }]),
      part("props-32.json", "props", "prop-30deg", 32, [{ assetId: "chest", w: 32, h: 32, fill: 8 }]),
      part("tokens-bands-32.json", "tokens", "bands", 32, [{ assetId: "token_goblin", w: 32, h: 48, fill: 9 }]),
      part("ground-lit-32.json", "ground-lit", "lit", 32, [{ assetId: "floor_stone", w: 32, h: 32, fill: 1 }]),
    ],
  };
}

/** objectUrl -> parsed file: what the page's fetch of a blob address would give. */
const reader = (byUrl: Record<string, unknown>) => async (objectUrl: string): Promise<unknown> => {
  if (!(objectUrl in byUrl)) throw new Error(`no such blob ${objectUrl}`);
  return byUrl[objectUrl];
};

const inflate = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(inflateSync(b));

interface Fake {
  bridge: AssetsBridge;
  calls: { url: string; sha256: string }[];
}

/** A bridge that answers each address from `answers` (ok by default), and records what it was asked. */
function fakeBridge(answers: Record<string, AssetLoadResult | "throw" | Promise<AssetLoadResult>> = {}): Fake {
  const calls: Fake["calls"] = [];
  const defaults: Record<string, AssetLoadResult> = {
    [FILES.cast!.url]: { ok: true, objectUrl: "blob:cast" },
    [FILES.library!.url]: { ok: true, objectUrl: "blob:library" },
  };
  return {
    calls,
    bridge: {
      async load(url, sha256) {
        calls.push({ url, sha256 });
        const a = answers[url] ?? defaults[url] ?? { ok: false, reason: "fetch_failed" };
        if (a === "throw") throw new Error("the bridge fell over");
        return a;
      },
    },
  };
}

const blobs = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ "blob:cast": CAST, "blob:library": library(), ...over });

function artWith(opts: Parameters<typeof createGameArt>[0] = {}) {
  return createGameArt({ load: async () => BASE, inflate, assetFiles: FILES, readJson: reader(blobs()), ...opts });
}

// ---- assetFiles.ts ---------------------------------------------------------------

test("assetFiles: nothing is uploaded yet, and the names match what the export script writes", () => {
  assert.deepEqual(ASSET_FILES, { cast: null, library: null }, "paste the uploaded address and hash here, in assetFiles.ts, once the owner has them");
  assert.equal(ASSET_FILE_NAMES.cast, CAST_NAME);
  assert.equal(ASSET_FILE_NAMES.library, LIBRARY_NAME);
});

test("assetFiles: validAssetRef wants an http(s) address and 64 lowercase hex", () => {
  assert.equal(validAssetRef(FILES.cast), true);
  assert.equal(validAssetRef(null), false);
  assert.equal(validAssetRef({ url: "https://x/y", sha256: "ABC" }), false);
  assert.equal(validAssetRef({ url: "https://x/y", sha256: "A".repeat(64) }), false, "uppercase hex is refused by the bridge too");
  assert.equal(validAssetRef({ url: "ftp://x/y", sha256: sha(3) }), false);
  assert.equal(validAssetRef({ url: "", sha256: sha(3) }), false);
});

// ---- the parsers and the decoder ---------------------------------------------------

test("parseCastFile and parseLibraryFile accept the real shapes and refuse the rest", () => {
  assert.equal(parseCastFile(CAST), CAST);
  assert.equal(parseCastFile({ styles: [] }), null);
  assert.equal(parseCastFile({ ...CAST, styles: [] }), null, "no styles means nothing to draw");
  assert.equal(parseCastFile({ ...CAST, styles: [{ style: "x" }] }), null);
  assert.equal(parseCastFile(null), null);
  assert.equal(parseCastFile([]), null);
  const lib = library();
  assert.equal(parseLibraryFile(lib), lib);
  assert.equal(parseLibraryFile({ palette: [], parts: [] }), null);
  assert.equal(parseLibraryFile({ ...lib, parts: [{ ...lib.parts[0], size: 24 }] }), null);
  assert.equal(parseLibraryFile({ ...lib, parts: [{ ...lib.parts[0], data: 5 }] }), null);
  assert.equal(parseLibraryFile("nope"), null);
});

test("decodeLibraryPart: palette indices back, 255 as transparent, and a short stream throws", async () => {
  const p = part("t.json", "t", null, 16, [{ assetId: "a", w: 2, h: 2, fill: 255 }, { assetId: "b", w: 2, h: 1, fill: 5 }]);
  const m = await decodeLibraryPart(p, inflate);
  assert.deepEqual(m.get("a"), [[-1, -1], [-1, -1]]);
  assert.deepEqual(m.get("b"), [[5, 5]]);
  const cut = { ...p, sprites: [...p.sprites, { assetId: "c", w: 4, h: 4 }] };
  await assert.rejects(decodeLibraryPart(cut, inflate), /shorter than its sprites/);
  const real = await decodeLibraryPart(p);
  assert.deepEqual(real.get("b"), [[5, 5]], "the default inflate is the platform's own DecompressionStream");
});

test("kaykitRender: library pixels where it has them, the hand-drawn art upscaled where it does not", async () => {
  const lib = library();
  const parts = await Promise.all(libraryPartFiles(DEFAULT_LOOK).map((f) => decodeLibraryPart(lib.parts.find((p) => p.file === f)!, inflate)));
  const made = kaykitRender(BASE.render, lib.palette, parts, 32);
  assert.ok("render" in made);
  const r = made.render;
  assert.equal(r.spriteSize, 32);
  assert.equal(r.palette, BASE.render.palette);
  assert.equal(r.tiles.floor_stone?.pixels.length, 32);
  assert.equal(r.tiles.floor_stone?.pixels[0]?.[0], 7, "from the ground part");
  assert.equal(r.props.chest?.pixels[0]?.[0], 8, "from the props part");
  assert.equal(r.tokens.token_goblin?.pixels.length, 48, "tokens are 32 by 48");
  assert.equal(r.tokens.token_goblin?.pixels[0]?.[0], 9);
  // An id the library lacks keeps the hand-drawn pixels, each one made 2 by 2.
  const other = Object.keys(BASE.render.tiles).find((id) => id !== "floor_stone")!;
  const src = BASE.render.tiles[other]!.pixels;
  assert.equal(r.tiles[other]!.pixels.length, src.length * 2);
  assert.equal(r.tiles[other]!.pixels[1]?.[1], src[0]?.[0]);
  assert.deepEqual(Object.keys(r.tiles), Object.keys(BASE.render.tiles), "every id of the base, in its order");
  // A different palette cannot be laid over: the indices would mean other colours.
  const odd = kaykitRender(BASE.render, FANTASY_PALETTE.slice(0, 10), parts, 32);
  assert.ok("reason" in odd && /palette/.test(odd.reason));
  const big = kaykitRender({ ...BASE.render, spriteSize: 32 }, lib.palette, parts, 32);
  assert.ok("reason" in big);
});

test("assetReason says each bridge reason in plain words", () => {
  assert.match(assetReason("cast", { reason: "bad_hash" }), /hash is not valid/);
  assert.match(assetReason("cast", { reason: "mismatch" }), /does not match its hash/);
  assert.match(assetReason("cast", { reason: "too_large" }), /size limit/);
  assert.match(assetReason("cast", { reason: "fetch_failed", error: "HTTP 404" }), /could not be downloaded \(HTTP 404\)/);
  assert.match(assetReason("cast", { reason: "weird" }), /\(weird\)/);
});

// ---- gameArt with no files uploaded -----------------------------------------------

test("gameArt: with assetFiles empty it asks the bridge for nothing, shows still figures and says why", async () => {
  const f = fakeBridge();
  const art = createGameArt({ load: async () => BASE, assetFiles: { cast: null, library: null }, assets: f.bridge });
  let n = 0;
  art.onChange(() => void (n += 1));
  await art.load();
  await art.loadAssets();
  assert.equal(f.calls.length, 0);
  assert.equal(art.cast(), null);
  assert.equal(art.render("fantasy"), BASE.render, "the hand-drawn art, untouched");
  assert.equal(n, 1, "load() announced once; nothing else changed");
  const s = art.assetStatus();
  assert.equal(s.cast.state, "fallback");
  assert.match(s.cast.reason ?? "", /not uploaded yet.*still figures/);
  assert.equal(s.library.state, "fallback");
  assert.match(s.library.reason ?? "", /not uploaded yet.*hand-drawn art/);
  assert.match(s.summary, /still figures/);
  assert.doesNotMatch(art.signature(), /kaykit/);
});

test("gameArt: the default ASSET_FILES is the empty set, so a build with nothing uploaded behaves the same", async () => {
  const art = createGameArt({ load: async () => BASE });
  await art.load();
  await art.loadAssets();
  assert.equal(art.cast(), null);
  assert.equal(art.assetStatus().cast.state, "fallback");
});

// ---- gameArt with files -----------------------------------------------------------

test("gameArt: the first paint does not wait for the files; when they land the art changes and subscribers hear it", async () => {
  let release!: (r: AssetLoadResult) => void;
  const slow = new Promise<AssetLoadResult>((res) => (release = res));
  const calls: string[] = [];
  const bridge: AssetsBridge = {
    async load(url, sha256) {
      calls.push(`${url} ${sha256}`);
      return url === FILES.cast!.url ? slow : { ok: true, objectUrl: "blob:library" };
    },
  };
  const art = artWith({ assets: bridge });
  let n = 0;
  art.onChange(() => void (n += 1));
  await art.load(); // resolves while the cast download is still pending
  assert.equal(art.ready(), true);
  assert.equal(n, 1);
  assert.equal(art.cast(), null, "still figures at first paint");
  assert.equal(art.assetStatus().cast.state, "loading");
  const before = art.signature();
  release({ ok: true, objectUrl: "blob:cast" });
  await art.loadAssets();
  assert.ok(n >= 2, "the cast and the library each told the window");
  assert.notEqual(art.signature(), before);
  assert.deepEqual(calls.sort(), [`${FILES.cast!.url} ${FILES.cast!.sha256}`, `${FILES.library!.url} ${FILES.library!.sha256}`].sort(), "the exact address and hash from assetFiles");
});

test("gameArt: both files in: the cast in the bands style, the KayKit render at 32 px, a signature that says so", async () => {
  const f = fakeBridge();
  const art = artWith({ assets: f.bridge });
  await art.load();
  const plain = art.signature();
  await art.loadAssets();
  const cast = art.cast();
  assert.ok(cast);
  assert.equal(cast.style.style, "bands", "the look's character style");
  assert.equal(cast.data.styles.length, 2);
  const r = art.render("fantasy");
  assert.notEqual(r, BASE.render);
  assert.equal(r.spriteSize, 32);
  assert.equal(r.tiles.floor_stone?.pixels[0]?.[0], 7);
  assert.equal(art.render("fantasy"), r, "the same object until something changes");
  assert.equal(art.manifest("fantasy"), BASE, "the engine's view and the DM's id lists are not touched");
  assert.deepEqual(art.catalog("fantasy").ids, art.catalog("fantasy").ids);
  assert.match(art.signature(), /cast:bands\|kaykit:painted-bands-32$/);
  assert.notEqual(art.signature(), plain);
  const s = art.assetStatus();
  assert.equal(s.cast.state, "ready");
  assert.equal(s.library.state, "ready");
  assert.match(s.summary, /Animated figures are on\. KayKit art is on\./);
});

test("gameArt: another look picks its own parts and cast style", async () => {
  const lib = library();
  lib.parts.push(part("tokens-toon-16.json", "tokens", "toon", 16, [{ assetId: "token_goblin", w: 16, h: 24, fill: 3 }]), part("ground-lit-16.json", "ground-lit", "lit", 16, [{ assetId: "floor_stone", w: 16, h: 16, fill: 2 }]), part("props-16.json", "props", "prop-30deg", 16, [{ assetId: "chest", w: 16, h: 16, fill: 4 }]));
  const cast = { ...CAST, styles: [...CAST.styles, { ...CAST.styles[0]!, style: "toon" }] };
  const art = createGameArt({ load: async () => BASE, inflate, assetFiles: FILES, assets: fakeBridge().bridge, readJson: reader(blobs({ "blob:library": lib, "blob:cast": cast })), look: { ground: "lit", chars: "toon", size: 16 } });
  await art.load();
  await art.loadAssets();
  assert.equal(art.cast()?.style.style, "toon");
  assert.equal(art.render("fantasy").spriteSize, 16);
  assert.equal(art.render("fantasy").tiles.floor_stone?.pixels[0]?.[0], 2);
  assert.match(art.signature(), /kaykit:lit-toon-16/);
});

test("gameArt: a cast style the file lacks falls to the first one", async () => {
  const cast = { ...CAST, styles: [CAST.styles[0]!] };
  const art = artWith({ assets: fakeBridge().bridge, readJson: reader(blobs({ "blob:cast": cast })) });
  await art.load();
  await art.loadAssets();
  assert.equal(art.cast()?.style.style, "plain");
});

// ---- the ways it falls back --------------------------------------------------------

for (const [reason, pattern] of [
  ["bad_hash", /hash is not valid/],
  ["mismatch", /does not match its hash/],
  ["fetch_failed", /could not be downloaded/],
  ["too_large", /size limit/],
] as const) {
  test(`gameArt: assets.load says ${reason}: still figures and hand-drawn art, a plain reason, no throw`, async () => {
    const f = fakeBridge({
      [FILES.cast!.url]: { ok: false, reason, error: "HTTP 404" },
      [FILES.library!.url]: { ok: false, reason },
    });
    const art = artWith({ assets: f.bridge });
    let n = 0;
    art.onChange(() => void (n += 1));
    await art.load();
    await art.loadAssets();
    assert.equal(art.cast(), null);
    assert.equal(art.render("fantasy"), BASE.render);
    const s = art.assetStatus();
    assert.equal(s.cast.state, "fallback");
    assert.match(s.cast.reason ?? "", pattern);
    assert.match(s.cast.reason ?? "", /The table shows still figures\.$/);
    assert.match(s.library.reason ?? "", /The table shows the hand-drawn art\.$/);
    assert.ok(n >= 2, "a failed download is announced, so a status line can update");
    assert.doesNotMatch(art.signature(), /kaykit/);
  });
}

test("gameArt: a bridge that throws or answers nothing is the same as a failed load", async () => {
  for (const answer of ["throw", undefined] as const) {
    const bridge: AssetsBridge = {
      async load() {
        if (answer === "throw") throw new Error("the bridge fell over");
        return undefined as unknown as AssetLoadResult;
      },
    };
    const art = artWith({ assets: bridge });
    await art.load();
    await art.loadAssets();
    assert.equal(art.cast(), null);
    assert.equal(art.assetStatus().cast.state, "fallback");
  }
});

test("gameArt: no bridge at all (the game outside the ConjureOS app) falls back and says so", async () => {
  for (const assets of [null, () => undefined] as const) {
    const art = artWith({ assets: assets === null ? null : (assets as () => undefined) });
    // A function that answers undefined means "use the default", which is the global; make sure there is none.
    delete (globalThis as { __conjureos?: unknown }).__conjureos;
    await art.load();
    await art.loadAssets();
    assert.equal(art.cast(), null);
    assert.match(art.assetStatus().cast.reason ?? "", /not running inside the ConjureOS app/);
    assert.match(art.assetStatus().library.reason ?? "", /not running inside the ConjureOS app/);
  }
});

test("gameArt: the default bridge is window.__conjureos.assets, read when the load starts", async () => {
  const f = fakeBridge();
  (globalThis as { __conjureos?: unknown }).__conjureos = { assets: f.bridge };
  try {
    const art = artWith();
    await art.load();
    await art.loadAssets();
    assert.equal(f.calls.length, 2);
    assert.ok(art.cast());
  } finally {
    delete (globalThis as { __conjureos?: unknown }).__conjureos;
  }
});

test("gameArt: a malformed reference never reaches the bridge", async () => {
  const f = fakeBridge();
  const art = artWith({ assets: f.bridge, assetFiles: { cast: { url: "https://x/y", sha256: "not-a-hash" }, library: { url: "/relative", sha256: sha(2) } } });
  await art.load();
  await art.loadAssets();
  assert.equal(f.calls.length, 0);
  assert.match(art.assetStatus().cast.reason ?? "", /address or hash is not valid/);
  assert.match(art.assetStatus().library.reason ?? "", /address or hash is not valid/);
});

test("gameArt: a file that arrives but is not what the table expects, or cannot be read, falls back", async () => {
  const art = artWith({ assets: fakeBridge().bridge, readJson: reader(blobs({ "blob:cast": { styles: [] }, "blob:library": { parts: "x" } })) });
  await art.load();
  await art.loadAssets();
  assert.equal(art.cast(), null);
  assert.match(art.assetStatus().cast.reason ?? "", /not in the format the table expects/);
  assert.match(art.assetStatus().library.reason ?? "", /not in the format the table expects/);

  const unreadable = artWith({ assets: fakeBridge().bridge, readJson: async () => { throw new Error("Unexpected token"); } });
  await unreadable.load();
  await unreadable.loadAssets();
  assert.match(unreadable.assetStatus().cast.reason ?? "", /could not be read \(Unexpected token\)/);
});

test("gameArt: a library with another palette, or with a part missing, or with cut-off pixels, is not used but the cast still is", async () => {
  const cases: [string, unknown, RegExp][] = [
    ["palette", library(FANTASY_PALETTE.slice(0, 20)), /colours are not the game's palette/],
    ["missing part", { ...library(), parts: library().parts.filter((p) => p.file !== "props-32.json") }, /has no props-32\.json/],
    ["cut off", { ...library(), parts: library().parts.map((p) => (p.file === "tokens-bands-32.json" ? { ...p, data: deflateSync(Buffer.alloc(10)).toString("base64") } : p)) }, /could not be read.*shorter than its sprites/],
  ];
  for (const [name, lib, pattern] of cases) {
    const art = artWith({ assets: fakeBridge().bridge, readJson: reader(blobs({ "blob:library": lib })) });
    await art.load();
    await art.loadAssets();
    assert.equal(art.render("fantasy"), BASE.render, `${name}: the hand-drawn art stays`);
    assert.equal(art.assetStatus().library.state, "fallback", name);
    assert.match(art.assetStatus().library.reason ?? "", pattern, name);
    assert.equal(art.assetStatus().cast.state, "ready", `${name}: the cast does not depend on the library`);
    assert.ok(art.cast(), name);
  }
});

test("gameArt: a library that is the wrong palette for a later reload is dropped on that reload, not kept", async () => {
  const f = fakeBridge();
  let base = BASE;
  const art = artWith({ assets: f.bridge, load: async () => base });
  await art.load();
  await art.loadAssets();
  assert.equal(art.assetStatus().library.state, "ready");
  base = adaptManifest(wireOf(FANTASY_PALETTE.slice(0, 30), FANTASY_SPRITES.map((s) => ({ ...s, pixels: s.pixels.map((row) => row.map((v) => (v >= 30 ? 0 : v))) }))));
  await art.load();
  assert.equal(art.assetStatus().library.state, "fallback");
  assert.equal(art.render("fantasy"), base.render);
});

// ---- caching, explicit casts, dispose ----------------------------------------------

test("gameArt: a good load is kept (asked once however often it is called); a failed one is tried again", async () => {
  const f = fakeBridge();
  const art = artWith({ assets: f.bridge });
  await art.load();
  await Promise.all([art.loadAssets(), art.loadAssets()]);
  await art.loadAssets();
  await art.load();
  await art.loadAssets();
  assert.equal(f.calls.length, 2, "one ask per file, the second reload included");
  const r = art.render("fantasy");
  await art.load();
  assert.equal(art.render("fantasy"), r, "the decoded KayKit render is not rebuilt for the same art on a reload of the same library");

  let down = true;
  const flaky: AssetsBridge = {
    async load(url) {
      return down ? { ok: false, reason: "fetch_failed", error: "offline" } : { ok: true, objectUrl: url === FILES.cast!.url ? "blob:cast" : "blob:library" };
    },
  };
  const again = artWith({ assets: flaky });
  await again.load();
  await again.loadAssets();
  assert.equal(again.cast(), null);
  down = false;
  await again.loadAssets();
  assert.ok(again.cast(), "back online: the next call gets it");
  assert.equal(again.assetStatus().cast.state, "ready");
});

test("gameArt: a cast the host set wins; the file is not asked for", async () => {
  const mine = { data: CAST, style: CAST.styles[0]! };
  const f = fakeBridge();
  const art = artWith({ assets: f.bridge, cast: () => mine });
  await art.load();
  await art.loadAssets();
  assert.equal(art.cast(), mine);
  assert.deepEqual(f.calls.map((c) => c.url), [FILES.library!.url], "only the library went to the bridge");
  const viaSet = artWith({ assets: fakeBridge().bridge });
  await viaSet.load();
  viaSet.setCast(mine);
  await viaSet.loadAssets();
  assert.equal(viaSet.cast(), mine, "a cast set before the file lands is not replaced by it");
});

test("gameArt: a file that lands after dispose is dropped", async () => {
  let release!: (r: AssetLoadResult) => void;
  const late = new Promise<AssetLoadResult>((res) => (release = res));
  const bridge: AssetsBridge = { load: async (url) => (url === FILES.cast!.url ? late : { ok: false, reason: "fetch_failed" }) };
  const art = artWith({ assets: bridge });
  await art.load();
  const pending = art.loadAssets();
  art.dispose();
  release({ ok: true, objectUrl: "blob:cast" });
  await pending;
  assert.equal(art.cast(), null);
  assert.equal(art.assetStatus().cast.state, "waiting", "reset by dispose, not filled by the late file");
});

// ---- the export script ---------------------------------------------------------------

function withTemp(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "lt-assets-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hashOf = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

test("export-asset-files: writes the cast byte for byte and the library with its palette, and reports each hash", () => {
  withTemp((dir) => {
    const castPath = join(dir, "cast.json");
    const castText = JSON.stringify(CAST);
    writeFileSync(castPath, castText);
    const libPath = join(dir, "lib.json");
    writeFileSync(libPath, JSON.stringify({ parts: library().parts }));
    const palPath = join(dir, "pal.json");
    writeFileSync(palPath, JSON.stringify({ palette: FANTASY_PALETTE, usable: 48 }));
    const out = join(dir, "out");
    const files = buildAssetFiles({ castPath, libraryPath: libPath, palettePath: palPath, outDir: out });
    assert.deepEqual(files.map((f: { name: string }) => f.name), [CAST_NAME, LIBRARY_NAME]);
    assert.equal(readFileSync(files[0].path, "utf8"), castText, "the cast is copied, not re-encoded");
    for (const f of files as { path: string; bytes: number; sha256: string }[]) {
      assert.equal(f.sha256, hashOf(f.path));
      assert.equal(f.bytes, readFileSync(f.path).length);
      assert.match(f.sha256, /^[0-9a-f]{64}$/, "the form assets.load wants");
    }
    const lib = JSON.parse(readFileSync(files[1].path, "utf8"));
    assert.deepEqual(lib.palette, FANTASY_PALETTE);
    assert.ok(parseLibraryFile(lib), "what the game's parser accepts");
    assert.ok(parseCastFile(JSON.parse(readFileSync(files[0].path, "utf8"))));
    const again = buildAssetFiles({ castPath, libraryPath: libPath, palettePath: palPath, outDir: out });
    assert.deepEqual(again.map((f: { sha256: string }) => f.sha256), files.map((f: { sha256: string }) => f.sha256), "the same inputs give the same hashes");
  });
});

test("export-asset-files: refuses an empty cast, a library without the default look's parts, and a missing palette", () => {
  withTemp((dir) => {
    const write = (name: string, v: unknown): string => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(v));
      return p;
    };
    const castPath = write("cast.json", CAST);
    const libPath = write("lib.json", { parts: library().parts });
    const palPath = write("pal.json", { palette: FANTASY_PALETTE });
    const base = { castPath, libraryPath: libPath, palettePath: palPath, outDir: join(dir, "out") };
    assert.throws(() => buildAssetFiles({ ...base, castPath: write("empty-cast.json", { styles: [] }) }), /no cast styles/);
    assert.throws(() => buildAssetFiles({ ...base, libraryPath: write("thin.json", { parts: library().parts.slice(0, 1) }) }), /lacks props-32\.json/);
    assert.throws(() => buildAssetFiles({ ...base, libraryPath: write("no-parts.json", { parts: [] }) }), /has no parts/);
    assert.throws(() => buildAssetFiles({ ...base, palettePath: join(dir, "missing.json") }), /is missing/);
    assert.throws(() => buildAssetFiles({ ...base, castPath: join(dir, "nope.json") }), /is missing.*pack-cast/);
  });
});

// ---- the real files, when they are on this machine ----------------------------------

const REAL_CAST = ".cache/kaykit/bench-cast.json";
const REAL_LIB = ".cache/kaykit/bench-library.json";
const REAL_PAL = ".cache/kaykit/palette-fantasy.json";

test("the real packed files load through the same path, against the real hand-drawn art", { skip: !(existsSync(REAL_CAST) && existsSync(REAL_LIB) && existsSync(REAL_PAL)) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "lt-real-"));
  try {
    const [castFile, libFile] = buildAssetFiles({ outDir: dir }) as { path: string }[];
    const cast = JSON.parse(readFileSync(castFile!.path, "utf8"));
    const lib = JSON.parse(readFileSync(libFile!.path, "utf8"));
    const f = fakeBridge();
    const art = createGameArt({ load: async () => BASE, assetFiles: FILES, assets: f.bridge, readJson: reader({ "blob:cast": cast, "blob:library": lib }) });
    await art.load();
    await art.loadAssets();
    const s = art.assetStatus();
    assert.equal(s.cast.state, "ready", s.summary);
    assert.equal(s.library.state, "ready", s.summary);
    assert.equal(art.cast()?.style.style, "bands");
    assert.ok((art.cast()?.style.characters.length ?? 0) >= 7);
    const r = art.render("fantasy");
    assert.equal(r.spriteSize, 32);
    assert.equal(r.tiles.floor_stone?.pixels.length, 32);
    // Every id the hand-drawn art has is still there, whichever source drew it.
    assert.deepEqual(Object.keys(r.tiles), Object.keys(BASE.render.tiles));
    assert.deepEqual(Object.keys(r.tokens), Object.keys(BASE.render.tokens));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
