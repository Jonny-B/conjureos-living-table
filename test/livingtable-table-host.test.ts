/**
 * Tests for the game's side of the table window's host
 * (src/games/livingtable/table/host/: gameArt, gameStorage, gameFiles, gameSettings, and the
 * generated bundledArt module). Runs with no DOM: the browser pieces (localStorage, object
 * URLs, the download link) are passed in as fakes.
 *
 * The one that matters most is the coverage test: every picture id the shipped adventures
 * use must be in the catalog the game's art settles on, and when the games-db manifest is
 * behind the authoring library the adapter must fall back to the bundled copy rather than
 * hand the window a library with holes.
 *
 * Run: npx tsx --test test/livingtable-table-host.test.ts
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
// @ts-ignore (a plain .mjs: no types, and the test runner does not typecheck)
import { buildModule } from "../scripts/assets/build-bundled-art.mjs";
import { adaptManifest, type LoadedManifest } from "../src/games/livingtable/assets/manifestCache";
import { MOCK_LT_ASSETS } from "../src/bridge/gamesApi";
import { BESTIARY } from "../src/games/livingtable/rules/bestiary";
import { validateAdventure } from "../src/games/livingtable/adventures/validate";
import { parseAdventureMarkdown } from "../src/games/livingtable/adventures/markdown";
import type { AdventureAssets } from "../src/games/livingtable/adventures/types";
import { adventureAssets, bindCatalog, dmAssets, unbindCatalog, walkableById, worldManifest } from "../src/games/livingtable/table/catalog";
import type { AdventureFile, CastData, CastStyle, TableHost } from "../src/games/livingtable/table/host";
import { createMemoryHost } from "../src/games/livingtable/table/hostDefault";
import { BUNDLED_ART } from "../src/games/livingtable/table/host/bundledArt";
import {
  ENGINE_ASSET_IDS,
  adventureAssetIds,
  bundledToWire,
  createGameArt,
  decodeBundledPixels,
  gameCatalog,
  mergeAssetIds,
  missingAssetIds,
  type AssetIdSet,
} from "../src/games/livingtable/table/host/gameArt";
import { REVOKE_AFTER_MS, createGameFiles, mimeFor, safeFilename, type FilesEnv } from "../src/games/livingtable/table/host/gameFiles";
import { DEFAULT_SETTINGS, createGameSettings, validSettings } from "../src/games/livingtable/table/host/gameSettings";
import {
  STORAGE_VERSION,
  TABLE_KEYS,
  createGameStorage,
  readEnvelope,
  writeEnvelope,
  type KeyValueStore,
} from "../src/games/livingtable/table/host/gameStorage";

afterEach(() => unbindCatalog());

// ---- fixtures ------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The shipped adventures, read straight from adventures/*.md so this test does not care where the generated data module lives. */
function shippedAdventures(): AdventureFile[] {
  const dir = join(ROOT, "adventures");
  return readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".md") && n !== "README.md")
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n") }));
}

const wireOf = (template: "fantasy" | "scifi", palette: unknown, sprites: readonly { assetId: string; kind: string; name: string; size: number; walkable: boolean; pixels: number[][] }[]) =>
  ({ template, palette, assets: sprites.map((s) => ({ assetId: s.assetId, kind: s.kind, name: s.name, size: s.size, walkable: s.walkable, pixels: s.pixels })) }) as Parameters<typeof adaptManifest>[0];

/** What games-db serves when it is up to date: the authoring library, through the same adapter the game uses. */
const REAL_MANIFEST: LoadedManifest = adaptManifest(wireOf("fantasy", FANTASY_PALETTE, FANTASY_SPRITES));

/** A games-db that is behind: the library with some sprites left out. */
function behindManifest(drop: (id: string) => boolean): LoadedManifest {
  return adaptManifest(wireOf("fantasy", FANTASY_PALETTE, FANTASY_SPRITES.filter((s) => !drop(s.assetId))));
}

/** The dev placeholder (the four-colour mock the game uses outside ConjureOS when no dev manifest file is served). */
const MOCK_MANIFEST: LoadedManifest = adaptManifest({
  template: "fantasy",
  palette: [[0, 0, 0], [255, 255, 255]],
  assets: MOCK_LT_ASSETS.fantasy,
});

function memStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const none: AssetIdSet = { tiles: [], props: [], tokens: [] };
const total = (s: AssetIdSet): number => s.tiles.length + s.props.length + s.tokens.length;

// ---- the bundled library -----------------------------------------------------------------

test("bundled art: every sprite decodes to exactly the authoring pixels, names and flags", () => {
  const lib = BUNDLED_ART.fantasy;
  assert.equal(lib.sprites.length, FANTASY_SPRITES.length);
  assert.deepEqual(lib.palette, FANTASY_PALETTE);
  FANTASY_SPRITES.forEach((src, i) => {
    const got = lib.sprites[i]!;
    assert.equal(got.assetId, src.assetId);
    assert.equal(got.kind, src.kind);
    assert.equal(got.name, src.name);
    assert.equal(got.size, src.size);
    assert.equal(got.walkable, src.walkable);
    assert.deepEqual(decodeBundledPixels(got.px), src.pixels, `pixels of ${src.assetId}`);
  });
});

test("bundled art: the committed module is the generator's current output (re-run build-bundled-art.mjs when fantasy.ts changes)", () => {
  const written = readFileSync(join(ROOT, "src/games/livingtable/table/host/bundledArt.ts"), "utf8").replace(/\r\n?/g, "\n");
  assert.equal(written, buildModule());
});

test("bundled art: the decoder refuses a character that is not in the format", () => {
  assert.throws(() => decodeBundledPixels("AB!A"), /bad pixel character/);
  assert.throws(() => decodeBundledPixels("A*x;"), /bad run/);
  assert.deepEqual(decodeBundledPixels("A*5;B|BA"), [[-1, -1, -1, -1, -1, 0], [0, -1]]);
});

test("bundled art: adapted like a games-db manifest it gives the same engine and render views", () => {
  const bundled = adaptManifest(bundledToWire("fantasy", BUNDLED_ART.fantasy));
  assert.deepEqual(bundled.world, REAL_MANIFEST.world);
  assert.deepEqual(bundled.render, REAL_MANIFEST.render);
  assert.deepEqual(bundled.availableAssetIds, REAL_MANIFEST.availableAssetIds);
});

// ---- coverage: what the adventures need -----------------------------------------------------

test("coverage: the shipped adventures exist and name pictures", () => {
  const files = shippedAdventures();
  assert.ok(files.length >= 1, "adventures/*.md is empty");
  const ids = adventureAssetIds(files);
  assert.ok(ids.tiles.length > 0 && ids.tokens.length > 0, "no ids were read out of the adventures");
});

test("coverage: every id the shipped adventures use is in the games-db manifest the authoring library produces", () => {
  const needed = adventureAssetIds(shippedAdventures());
  const gap = missingAssetIds(gameCatalog(REAL_MANIFEST).world, needed);
  assert.deepEqual(gap, none, `adventure ids missing from the library: ${JSON.stringify(gap)}`);
});

test("coverage: every id the shipped adventures use is in the bundled fallback too", () => {
  const needed = adventureAssetIds(shippedAdventures());
  const gap = missingAssetIds(gameCatalog(adaptManifest(bundledToWire("fantasy", BUNDLED_ART.fantasy))).world, needed);
  assert.deepEqual(gap, none);
});

test("coverage: the engine's own ids are in the library and the bundled copy", () => {
  assert.deepEqual(missingAssetIds(gameCatalog(REAL_MANIFEST).world, ENGINE_ASSET_IDS.fantasy), none);
  assert.ok(ENGINE_ASSET_IDS.fantasy.tokens.includes("token_knight"));
  assert.ok(ENGINE_ASSET_IDS.fantasy.tokens.includes("token_fireball_person"), "hyphens in hero ids become underscores");
});

test("coverage: the game's catalog validates every shipped adventure with the same verdict as the full authoring library", () => {
  const files = shippedAdventures();
  const gameWorld = gameCatalog(REAL_MANIFEST).world;
  const toAssets = (world: typeof gameWorld): AdventureAssets => ({
    tiles: Object.keys(world.tiles),
    props: Object.keys(world.props),
    tokens: Object.keys(world.tokens),
    walkableTiles: Object.keys(world.tiles).filter((id) => world.tiles[id]!.walkable),
    blockingProps: Object.keys(world.props).filter((id) => world.props[id]!.blocks === true),
  });
  // The bench checked against EVERY authoring sprite, wall-profile art included.
  const everySprite: AdventureAssets = {
    tiles: FANTASY_SPRITES.filter((s) => s.kind === "tile").map((s) => s.assetId),
    props: FANTASY_SPRITES.filter((s) => s.kind === "prop").map((s) => s.assetId),
    tokens: FANTASY_SPRITES.filter((s) => s.kind === "token").map((s) => s.assetId),
    walkableTiles: FANTASY_SPRITES.filter((s) => s.kind === "tile" && s.walkable).map((s) => s.assetId),
    blockingProps: FANTASY_SPRITES.filter((s) => s.kind === "prop" && !s.walkable).map((s) => s.assetId),
  };
  const creatures = BESTIARY.map((b) => b.id);
  let checked = 0;
  for (const f of files) {
    const adv = parseAdventureMarkdown(f.text, { file: f.file }).adventure;
    if (!adv) continue;
    checked += 1;
    const a = validateAdventure(adv, toAssets(gameWorld), creatures);
    const b = validateAdventure(adv, everySprite, creatures);
    assert.deepEqual(a.errors, b.errors, `${f.file}: errors differ between the game catalog and the authoring library`);
    assert.deepEqual(a.warnings, b.warnings, `${f.file}: warnings differ`);
  }
  assert.ok(checked >= 1);
});

test("catalog: the render-only wall-profile pieces are listed with exactly the authoring library's flags (door_open_ns is the one rat-cellar.md uses)", () => {
  const c = gameCatalog(REAL_MANIFEST);
  for (const sp of FANTASY_SPRITES) {
    if (sp.kind === "tile") assert.equal(c.world.tiles[sp.assetId]?.walkable, sp.walkable, `tile ${sp.assetId}`);
    else if (sp.kind === "prop") assert.equal(c.world.props[sp.assetId]?.blocks, !sp.walkable, `prop ${sp.assetId}`);
    else assert.ok(sp.assetId in c.world.tokens, `token ${sp.assetId}`);
  }
  assert.equal(c.world.props["door_open_ns"]?.blocks, false);
  assert.equal(c.world.props["door_closed_ns"]?.blocks, true);
  assert.equal(c.world.props["wall_stone_jambs_ns"]?.blocks, true);
  assert.equal(c.world.tiles["wall_stone_join_ns"]?.walkable, false);
  assert.ok(c.walkableTiles.includes("floor_stone") && !c.walkableTiles.includes("wall_stone_join_ns"));
  assert.ok(c.blockingProps.includes("door_closed_ns") && !c.blockingProps.includes("door_open_ns"));
  // The sight flag is the same one the game's manifest cache stamps on the pieces it does keep.
  for (const sp of FANTASY_SPRITES) {
    if (sp.kind === "tile") assert.equal(c.world.tiles[sp.assetId]?.opaque, REAL_MANIFEST.world.tiles[sp.assetId]?.opaque ?? c.world.tiles[sp.assetId]?.opaque);
  }
});

test("catalog: the same from the games-db manifest and from the bundled copy, apart from the display names", () => {
  const a = gameCatalog(REAL_MANIFEST);
  const b = gameCatalog(adaptManifest(bundledToWire("fantasy", BUNDLED_ART.fantasy)));
  assert.deepEqual(a, b);
});

test("coverage helpers: adventureAssetIds takes parsed adventures too, mergeAssetIds unions, missingAssetIds names the gap", () => {
  const files = shippedAdventures();
  const parsed = files.flatMap((f) => {
    const a = parseAdventureMarkdown(f.text, { file: f.file }).adventure;
    return a ? [a] : [];
  });
  assert.deepEqual(adventureAssetIds(parsed), adventureAssetIds(files.filter((f) => parseAdventureMarkdown(f.text, { file: f.file }).adventure)));
  assert.deepEqual(adventureAssetIds([{ file: "broken.md", text: "not an adventure" }]), none);
  const merged = mergeAssetIds({ tiles: ["a", "b"], props: [], tokens: ["t"] }, { tiles: ["b", "c"], props: ["p"], tokens: ["t"] });
  assert.deepEqual(merged, { tiles: ["a", "b", "c"], props: ["p"], tokens: ["t"] });
  const world = { tiles: { a: { walkable: true } }, props: {}, tokens: {} };
  assert.deepEqual(missingAssetIds(world, { tiles: ["a", "z"], props: ["p"], tokens: ["t"] }), { tiles: ["z"], props: ["p"], tokens: ["t"] });
});

// ---- gameArt: settling ---------------------------------------------------------------------

const withAdventures = (): ((t: "fantasy" | "scifi") => AssetIdSet) => {
  const ids = mergeAssetIds(ENGINE_ASSET_IDS.fantasy, adventureAssetIds(shippedAdventures()));
  return (t) => (t === "fantasy" ? ids : none);
};

test("gameArt: throws before load, and says to await it", () => {
  const art = createGameArt({ load: async () => REAL_MANIFEST });
  assert.equal(art.ready(), false);
  assert.throws(() => art.catalog("fantasy"), /Await art\.load\(\)/);
  assert.throws(() => art.render("fantasy"), /not loaded/);
  assert.throws(() => art.status("fantasy"), /not loaded/);
});

test("gameArt: a manifest that covers everything is used as is", async () => {
  const art = createGameArt({ load: async () => REAL_MANIFEST, required: withAdventures() });
  await art.load();
  assert.equal(art.ready(), true);
  const s = art.status("fantasy");
  assert.equal(s.source, "server");
  assert.deepEqual(s.missing, none);
  assert.equal(art.manifest("fantasy"), REAL_MANIFEST);
  assert.equal(art.render("fantasy"), REAL_MANIFEST.render);
  const c = art.catalog("fantasy");
  assert.deepEqual(c.world, gameCatalog(REAL_MANIFEST).world);
  assert.deepEqual(c.ids.tiles, FANTASY_SPRITES.filter((x) => x.kind === "tile").map((x) => x.assetId), "the library's own order, wall-profile art included");
  assert.deepEqual(c.ids.tokens, FANTASY_SPRITES.filter((x) => x.kind === "token").map((x) => x.assetId));
  assert.equal(c.names, undefined, "games-db names are dropped by adaptManifest, so the catalog has none");
  assert.equal(art.cast(), null);
});

test("gameArt: the default load path asks loadManifest for each template once", async () => {
  const asked: string[] = [];
  const art = createGameArt({
    templates: ["fantasy", "scifi"],
    load: async (t) => {
      asked.push(t);
      return t === "fantasy" ? REAL_MANIFEST : MOCK_MANIFEST;
    },
  });
  await art.load();
  assert.deepEqual(asked.sort(), ["fantasy", "scifi"]);
  assert.equal(art.status("scifi").source, "server");
});

test("gameArt: a manifest with holes falls back to the whole bundled library, never a mix", async () => {
  const behind = behindManifest((id) => id === "barrel" || id === "token_rat" || id === "rat_hole");
  const art = createGameArt({ load: async () => behind, required: withAdventures() });
  await art.load();
  const s = art.status("fantasy");
  const needed = withAdventures()("fantasy");
  assert.ok(total(missingAssetIds(behind.world, needed)) > 0, "fixture: the behind manifest must actually lack something the adventures use");
  assert.equal(s.source, "bundled");
  assert.match(s.reason ?? "", /lacks \d+ id/);
  assert.deepEqual(s.missing, none);
  assert.deepEqual(missingAssetIds(art.catalog("fantasy").world, needed), none);
  assert.equal(art.render("fantasy").palette.length, FANTASY_PALETTE.length, "the render half is the bundled library's own palette");
  assert.equal(art.catalog("fantasy").names?.["token_goblin"], FANTASY_SPRITES.find((x) => x.assetId === "token_goblin")!.name);
});

test("gameArt: a manifest from before the wall-profile art (no door_open_ns) is behind for Rat Cellar, so the bundled art draws", async () => {
  const old = behindManifest((id) => id === "door_open_ns" || id === "door_closed_ns" || id === "wall_stone_jambs_ns" || id.startsWith("wall_stone_join_"));
  const art = createGameArt({ load: async () => old, required: withAdventures() });
  await art.load();
  assert.equal(art.status("fantasy").source, "bundled");
  assert.ok("door_open_ns" in art.catalog("fantasy").world.props);
});

test("gameArt: the dev placeholder manifest (four colours, a dot per token) has every id, so it is used as is and the table sees placeholder art", async () => {
  // Outside ConjureOS with no .devserve/livingtable-assets.json this is what the game draws; the fallback is for MISSING ids, not for ugly ones.
  const art = createGameArt({ load: async () => MOCK_MANIFEST, required: withAdventures() });
  await art.load();
  assert.equal(art.status("fantasy").source, "server");
  assert.deepEqual(art.status("fantasy").missing, none);
});

test("gameArt: a failed fetch falls back to the bundled library and records why", async () => {
  const art = createGameArt({
    load: async () => {
      throw new Error("network down");
    },
    required: withAdventures(),
  });
  await art.load();
  const s = art.status("fantasy");
  assert.equal(s.source, "bundled");
  assert.equal(s.error, "network down");
  assert.match(s.reason ?? "", /network down/);
  assert.equal(art.ready(), true);
});

test("gameArt: no manifest and no bundled copy rejects, and the art is not ready", async () => {
  const art = createGameArt({
    templates: ["scifi"],
    load: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(art.load(), /scifi art could not be loaded.*offline/);
  assert.equal(art.ready(), false);
  assert.throws(() => art.catalog("scifi"));
});

test("gameArt: a template with no bundled copy uses its manifest even with gaps, and records them", async () => {
  const art = createGameArt({
    templates: ["scifi"],
    load: async () => MOCK_MANIFEST,
    required: () => ({ tiles: ["no_such_tile"], props: [], tokens: [] }),
  });
  await art.load();
  const s = art.status("scifi");
  assert.equal(s.source, "server");
  assert.deepEqual(s.missing.tiles, ["no_such_tile"]);
});

test("gameArt: a bundled library that cannot be imported counts as no bundled copy", async () => {
  const art = createGameArt({
    load: async () => behindManifest((id) => id === "barrel"),
    required: withAdventures(),
    bundled: async () => {
      throw new Error("chunk failed");
    },
  });
  await art.load();
  const s = art.status("fantasy");
  assert.equal(s.source, "server", "the manifest is all there is");
  assert.ok(total(s.missing) > 0);
});

test("gameArt: load() while loading shares one run; a later load() runs again", async () => {
  let calls = 0;
  const art = createGameArt({
    load: async () => {
      calls += 1;
      return REAL_MANIFEST;
    },
  });
  const a = art.load();
  const b = art.load();
  assert.equal(a, b);
  await a;
  assert.equal(calls, 1);
  await art.load();
  assert.equal(calls, 2);
});

test("gameArt: onChange fires when loading settles and on setCast, and unsubscribes", async () => {
  const art = createGameArt({ load: async () => REAL_MANIFEST });
  let n = 0;
  const off = art.onChange(() => void (n += 1));
  await art.load();
  assert.equal(n, 1);
  const cast = { data: { palette: [], cameraPitchDeg: 0, styles: [] } as CastData, style: { style: "kay", label: "", description: "", characters: [], gear: [], layerOrder: { down: [], right: [], up: [], left: [] } } as CastStyle };
  art.setCast(cast);
  assert.equal(n, 2);
  assert.equal(art.cast(), cast);
  off();
  art.setCast(null);
  assert.equal(n, 2);
  assert.equal(art.cast(), null);
});

test("gameArt: the signature tells games-db art from bundled art, tracks the cast, and is stable otherwise", async () => {
  const fromDb = createGameArt({ load: async () => REAL_MANIFEST });
  const fromBundle = createGameArt({ load: async () => behindManifest((id) => id === "barrel"), required: withAdventures() });
  assert.match(fromDb.signature(), /fantasy:none/);
  await fromDb.load();
  await fromBundle.load();
  const a = fromDb.signature();
  assert.match(a, /^fantasy:server:/);
  assert.match(fromBundle.signature(), /^fantasy:bundled:/);
  assert.notEqual(a, fromBundle.signature());
  assert.equal(fromDb.signature(), a, "stable between calls");
  await fromDb.load();
  assert.equal(fromDb.signature(), a, "stable across a reload of the same library");
  fromDb.setCast({ data: { palette: [], cameraPitchDeg: 0, styles: [] }, style: { style: "kay" } as unknown as CastStyle });
  assert.notEqual(fromDb.signature(), a);
});

test("gameArt: dispose drops subscribers and the settled libraries", async () => {
  const art = createGameArt({ load: async () => REAL_MANIFEST });
  let n = 0;
  art.onChange(() => void (n += 1));
  await art.load();
  art.dispose();
  assert.equal(art.ready(), false);
  assert.throws(() => art.catalog("fantasy"));
  await art.load();
  assert.equal(n, 1, "the subscriber was dropped");
});

test("gameArt: bound to the catalog it answers the lazy constants the engine needs, from either source", async () => {
  for (const manifest of [REAL_MANIFEST, behindManifest((id) => id === "barrel")]) {
    const art = createGameArt({ load: async () => manifest, required: withAdventures() });
    await art.load();
    bindCatalog(art);
    const adv = adventureAssets();
    assert.deepEqual(missingAssetIds(worldManifest("fantasy"), adventureAssetIds(shippedAdventures())), none);
    assert.ok(adv.tiles.includes("floor_stone"));
    assert.ok(adv.blockingProps?.includes("door_closed"));
    assert.equal(walkableById("fantasy").get("floor_stone"), true);
    assert.equal(walkableById("fantasy").get("wall_stone"), false);
    assert.equal(walkableById("fantasy").get("door_closed"), false);
    assert.equal(walkableById("fantasy").get("door_open"), true);
    const dm = dmAssets("fantasy", ["token_goblin", "token_skeleton"]);
    assert.ok(dm.tiles.includes("floor_stone"));
    assert.ok(!dm.props.includes("door_closed") && !dm.props.includes("chest"), "the DM may not place doors or chests");
    assert.deepEqual(dm.monsters, ["token_goblin", "token_skeleton"]);
    unbindCatalog();
  }
});

test("gameArt: fits in a TableHost beside the memory host's other parts", async () => {
  const art = createGameArt({ load: async () => REAL_MANIFEST });
  await art.load();
  const base = createMemoryHost();
  const host: TableHost = { ...base, art, storage: createGameStorage({ store: memStore() }), files: createGameFiles({}), settings: createGameSettings({ store: memStore() }) };
  assert.equal(host.art.ready(), true);
  assert.equal(host.settings.get().textStyle, "pixel");
});

// ---- gameStorage -----------------------------------------------------------------------------

test("gameStorage: saves round-trip per scope, under the table's own keys, in a versioned envelope", () => {
  const store = memStore();
  const s = createGameStorage({ store });
  assert.equal(s.saves.read("rat-cellar"), null);
  s.saves.write("rat-cellar", '{"saves":[1,2,3]}');
  s.saves.write("other", "x");
  assert.equal(s.saves.read("rat-cellar"), '{"saves":[1,2,3]}');
  assert.equal(s.saves.read("other"), "x");
  const raw = JSON.parse(store.data.get(TABLE_KEYS.savesPrefix + "rat-cellar")!);
  assert.equal(raw.v, STORAGE_VERSION);
  assert.equal(raw.text, '{"saves":[1,2,3]}');
  for (const key of store.data.keys()) {
    assert.ok(key.startsWith("livingtable:table:v1:"), key);
    assert.ok(!key.startsWith("livingtable:manifest:") && !key.startsWith("livingtable-bench"), `${key} collides with another owner's keys`);
  }
});

test("gameStorage: another version, a bare string or corrupt JSON reads as nothing and is not erased by reading", () => {
  const key = TABLE_KEYS.savesPrefix + "s";
  for (const stored of ['{"v":2,"text":"future"}', '"just a string"', "[1,2]", "{not json", '{"v":1}', '{"v":1,"text":5}', ""]) {
    const store = memStore({ [key]: stored });
    const s = createGameStorage({ store });
    assert.equal(s.saves.read("s"), null, stored);
    assert.equal(store.data.get(key), stored, "reading must not touch what it cannot understand");
  }
  const store = memStore({ [key]: '{"v":2,"text":"future"}' });
  const s = createGameStorage({ store });
  s.saves.write("s", "mine");
  assert.equal(s.saves.read("s"), "mine", "a write replaces it");
});

test("gameStorage: the written adventures round-trip, and non-strings in the stored list are dropped", () => {
  const store = memStore();
  const s = createGameStorage({ store });
  assert.deepEqual(s.aiAdventures.read(), []);
  s.aiAdventures.write(["# One", "# Two"]);
  assert.deepEqual(s.aiAdventures.read(), ["# One", "# Two"]);
  store.data.set(TABLE_KEYS.aiAdventures, JSON.stringify({ v: 1, texts: ["ok", 3, null, { markdown: "x" }, "also ok"] }));
  assert.deepEqual(s.aiAdventures.read(), ["ok", "also ok"]);
  store.data.set(TABLE_KEYS.aiAdventures, JSON.stringify({ v: 1, texts: "nope" }));
  assert.deepEqual(s.aiAdventures.read(), []);
});

test("gameStorage: a store that refuses writes never throws; the failure is kept and reported", () => {
  const seen: string[] = [];
  const full: KeyValueStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const s = createGameStorage({ store: full, onError: (m) => seen.push(m) });
  assert.doesNotThrow(() => s.saves.write("a", "x"));
  assert.doesNotThrow(() => s.aiAdventures.write(["y"]));
  assert.equal(s.lastError(), "QuotaExceededError");
  assert.deepEqual(seen, ["QuotaExceededError", "QuotaExceededError"]);
  const ok = memStore();
  const s2 = createGameStorage({ store: ok });
  s2.saves.write("a", "x");
  assert.equal(s2.lastError(), null);
});

test("gameStorage: no storage at all (a private window, or none under Node) reads empty and writes quietly", () => {
  const s = createGameStorage({ store: null });
  assert.equal(s.saves.read("a"), null);
  assert.deepEqual(s.aiAdventures.read(), []);
  assert.doesNotThrow(() => s.saves.write("a", "x"));
  assert.match(s.lastError() ?? "", /not keeping data/);
  // Under plain Node there is no localStorage: the default store resolves to nothing and behaves the same.
  const dflt = createGameStorage();
  assert.equal(dflt.saves.read("a"), null);
});

test("gameStorage: a store whose reads throw reads as empty", () => {
  const bad: KeyValueStore = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => undefined,
  };
  const s = createGameStorage({ store: bad });
  assert.equal(s.saves.read("a"), null);
  assert.deepEqual(s.aiAdventures.read(), []);
  assert.equal(readEnvelope(bad, "k"), null);
  assert.equal(writeEnvelope(null, "k", {}), "This browser is not keeping data for the game.");
});

// ---- gameFiles -------------------------------------------------------------------------------

function fakeFilesEnv(opts: { click?: boolean; failCreate?: boolean } = {}) {
  const log: string[] = [];
  const scheduled: { fn: () => void; ms: number }[] = [];
  const blobs: Blob[] = [];
  const env: FilesEnv = {
    createObjectURL(blob) {
      if (opts.failCreate) throw new Error("no URL");
      blobs.push(blob);
      log.push("create");
      return "blob:fake/1";
    },
    revokeObjectURL(url) {
      log.push(`revoke ${url}`);
    },
    click(url, filename) {
      log.push(`click ${url} ${filename}`);
      return opts.click ?? true;
    },
    later(fn, ms) {
      scheduled.push({ fn, ms });
    },
  };
  return { env, log, scheduled, blobs };
}

test("gameFiles: a download makes an object URL, clicks a link with the file name, and revokes later", async () => {
  const f = fakeFilesEnv();
  const files = createGameFiles(f.env);
  const res = await files.save("rat-cellar.zip", new Uint8Array([80, 75, 3, 4]));
  assert.deepEqual(res, { via: "browser" });
  assert.deepEqual(f.log, ["create", "click blob:fake/1 rat-cellar.zip"]);
  assert.equal(f.blobs[0]!.type, "application/zip");
  assert.equal(f.blobs[0]!.size, 4);
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0]!.ms, REVOKE_AFTER_MS);
  f.scheduled[0]!.fn();
  assert.equal(f.log.at(-1), "revoke blob:fake/1");
});

test("gameFiles: when the page cannot click, the URL is revoked at once and the answer is none", async () => {
  const f = fakeFilesEnv({ click: false });
  const res = await createGameFiles(f.env).save("a.zip", new Uint8Array(1));
  assert.equal(res.via, "none");
  assert.match(res.status ?? "", /would not start a download/);
  assert.deepEqual(f.log, ["create", "click blob:fake/1 a.zip", "revoke blob:fake/1"]);
  assert.equal(f.scheduled.length, 0);
});

test("gameFiles: an error making the URL is the same none answer, not a throw", async () => {
  const f = fakeFilesEnv({ failCreate: true });
  const res = await createGameFiles(f.env).save("a.zip", new Uint8Array(1));
  assert.equal(res.via, "none");
  assert.deepEqual(f.log, []);
});

test("gameFiles: under Node (no page) the default environment answers none instead of throwing", async () => {
  const res = await createGameFiles().save("a.zip", new Uint8Array(1));
  assert.equal(res.via, "none");
});

test("gameFiles: content types by extension, and a safe file name", () => {
  assert.equal(mimeFor("x.zip"), "application/zip");
  assert.equal(mimeFor("adventure.JSON"), "application/json");
  assert.equal(mimeFor("a.md"), "text/markdown");
  assert.equal(mimeFor("a.bin"), "application/octet-stream");
  assert.equal(mimeFor("noext"), "application/octet-stream");
  assert.equal(safeFilename("a/b\\c:d*.zip"), "a-b-c-d-.zip");
  assert.equal(safeFilename("   "), "download");
  assert.equal(safeFilename("ok name (1).zip"), "ok name (1).zip");
});

// ---- gameSettings ----------------------------------------------------------------------------

test("gameSettings: nothing stored gives the defaults", () => {
  const s = createGameSettings({ store: memStore() });
  assert.deepEqual(s.get(), DEFAULT_SETTINGS);
  assert.equal(s.get().zoom, null);
  assert.deepEqual(s.ownedDiceSkins(), ["bone"]);
});

test("gameSettings: a change is kept across instances, merged into what was there", () => {
  const store = memStore();
  const a = createGameSettings({ store });
  a.set({ textStyle: "storybook" });
  a.set({ zoom: 3, rollMyself: false });
  const b = createGameSettings({ store });
  assert.deepEqual(b.get(), { textStyle: "storybook", textSpeed: "normal", rollMyself: false, diceSkin: "bone", zoom: 3, autoEndTurn: true });
  b.set({ zoom: null });
  assert.equal(createGameSettings({ store }).get().zoom, null);
  const raw = JSON.parse(store.data.get(TABLE_KEYS.settings)!);
  assert.equal(raw.v, STORAGE_VERSION);
  assert.ok(raw.settings);
});

test("gameSettings: invalid fields are ignored one by one, in what is stored and in what is set", () => {
  const store = memStore({ [TABLE_KEYS.settings]: JSON.stringify({ v: 1, settings: { textStyle: "comic", rollMyself: "yes", diceSkin: "", zoom: 9 } }) });
  const s = createGameSettings({ store });
  assert.deepEqual(s.get(), DEFAULT_SETTINGS);
  s.set({ textStyle: "comic" as never, zoom: 2.5, diceSkin: "oak" });
  assert.deepEqual(s.get().textStyle, "pixel");
  assert.equal(s.get().zoom, null);
  const half = memStore({ [TABLE_KEYS.settings]: JSON.stringify({ v: 1, settings: { textStyle: "storybook", zoom: 99 } }) });
  assert.deepEqual(createGameSettings({ store: half }).get(), { ...DEFAULT_SETTINGS, textStyle: "storybook" }, "the good field survives the bad one");
  assert.deepEqual(validSettings(null), {});
  assert.deepEqual(validSettings({ zoom: 1 }), { zoom: 1 });
  assert.deepEqual(validSettings({ zoom: 0 }), {});
});

test("gameSettings: autoEndTurn is on by default, can be turned off and on, is kept, and a bad value is ignored", () => {
  assert.equal(DEFAULT_SETTINGS.autoEndTurn, true, "a turn ends by itself unless the player turns it off");
  const store = memStore();
  const a = createGameSettings({ store });
  assert.equal(a.get().autoEndTurn, true);
  a.set({ autoEndTurn: false });
  assert.equal(createGameSettings({ store }).get().autoEndTurn, false, "off is kept across instances");
  a.set({ autoEndTurn: "no" as never });
  assert.equal(a.get().autoEndTurn, false, "a value that is not a true or false is ignored");
  a.set({ autoEndTurn: true });
  assert.equal(createGameSettings({ store }).get().autoEndTurn, true);
  assert.deepEqual(validSettings({ autoEndTurn: false }), { autoEndTurn: false });
  assert.deepEqual(validSettings({ autoEndTurn: 1 }), {});
  const old = memStore({ [TABLE_KEYS.settings]: JSON.stringify({ v: 1, settings: { textStyle: "storybook" } }) });
  assert.equal(createGameSettings({ store: old }).get().autoEndTurn, true, "settings saved before the option existed read as on");
});

test("gameSettings: another version or corrupt data gives the defaults and is not erased by reading", () => {
  for (const stored of ['{"v":9,"settings":{"zoom":2}}', "{broken"]) {
    const store = memStore({ [TABLE_KEYS.settings]: stored });
    assert.deepEqual(createGameSettings({ store }).get(), DEFAULT_SETTINGS);
    assert.equal(store.data.get(TABLE_KEYS.settings), stored);
  }
});

test("gameSettings: a dice skin the player does not own falls back to one they do, without forgetting the choice", () => {
  const store = memStore();
  let owned = ["bone", "oak"];
  const s = createGameSettings({ store, ownedDiceSkins: () => owned });
  s.set({ diceSkin: "oak" });
  assert.equal(s.get().diceSkin, "oak");
  owned = ["bone"];
  assert.equal(s.get().diceSkin, "bone");
  owned = ["bone", "oak"];
  assert.equal(s.get().diceSkin, "oak", "the stored choice came back when the skin was owned again");
  assert.deepEqual(s.ownedDiceSkins(), ["bone", "oak"]);
  owned = [];
  assert.deepEqual(s.ownedDiceSkins(), ["bone"], "an empty list still leaves the default");
});

test("gameSettings: without storage the settings still hold for the visit and nothing throws", () => {
  const refuse: KeyValueStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error("full");
    },
  };
  for (const store of [null, refuse]) {
    const s = createGameSettings({ store });
    assert.doesNotThrow(() => s.set({ zoom: 4 }));
    assert.equal(s.get().zoom, 4);
  }
});
