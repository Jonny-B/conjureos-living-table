/**
 * Tests for the table window's host contract and catalog
 * (src/games/livingtable/table/host.ts, catalog.ts, hostDefault.ts): that the
 * catalog constants the bench built at import (MANIFEST, WORLD_MANIFEST,
 * WALKABLE_BY_ID, DM_ASSETS, adventureAssets) come out the same from the real
 * art once bound to a host, that they are lazy, cached only while the art is
 * ready, dropped on an art change, and refuse to answer when nothing is bound,
 * and that the in-memory host does what a test needs of it. Runs with no DOM.
 *
 * Run: npx tsx --test test/livingtable-table-host-core.test.ts
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { PALETTE as SCIFI_PALETTE, SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";
import { isOpaqueAssetId } from "../src/games/livingtable/world/visibility";
import type { AssetManifest } from "../src/games/livingtable/world/cell";
import {
  DM_PROP_SKIP,
  DM_TILE_SKIP,
  adventureAssets,
  artCatalog,
  bindCatalog,
  catalogBound,
  catalogFromSprites,
  catalogFromWorld,
  dmAssets,
  renderManifest,
  spriteName,
  unbindCatalog,
  walkableById,
  worldManifest,
  type CatalogSprite,
} from "../src/games/livingtable/table/catalog";
import { DEFAULT_SPRITES, createMemoryHost, playableHeroIds } from "../src/games/livingtable/table/hostDefault";
import type { TableHost, TemplateGenre } from "../src/games/livingtable/table/host";

void FANTASY_PALETTE;
void SCIFI_PALETTE;

const REAL: Record<TemplateGenre, readonly CatalogSprite[]> = {
  fantasy: FANTASY_SPRITES as unknown as CatalogSprite[],
  scifi: SCIFI_SPRITES as unknown as CatalogSprite[],
};

afterEach(() => unbindCatalog());

// The bench's own definitions, copied here as the reference the catalog must equal.
function refWorld(t: TemplateGenre): AssetManifest {
  const m: AssetManifest = { tiles: {}, props: {}, tokens: {} };
  for (const s of REAL[t]) {
    if (s.kind === "tile") m.tiles[s.assetId] = { walkable: s.walkable, opaque: isOpaqueAssetId("tile", s.assetId, s.walkable) };
    else if (s.kind === "prop") m.props[s.assetId] = { blocks: !s.walkable, opaque: isOpaqueAssetId("prop", s.assetId, s.walkable) };
    else m.tokens[s.assetId] = {};
  }
  return m;
}
const refWalkable = (t: TemplateGenre): Map<string, boolean> => new Map(REAL[t].map((s) => [s.assetId, s.walkable]));
function refAdventureAssets() {
  const sprites = REAL.fantasy;
  const tiles = sprites.filter((s) => s.kind === "tile");
  const props = sprites.filter((s) => s.kind === "prop");
  return {
    tiles: tiles.map((s) => s.assetId),
    props: props.map((s) => s.assetId),
    tokens: sprites.filter((s) => s.kind === "token").map((s) => s.assetId),
    walkableTiles: tiles.filter((s) => s.walkable).map((s) => s.assetId),
    blockingProps: props.filter((s) => !s.walkable).map((s) => s.assetId),
  };
}
function refDm(t: TemplateGenre, monsters: string[]) {
  const sprites = REAL[t];
  return {
    props: sprites.filter((s) => s.kind === "prop" && !/^(door_|chest|cottage_|arch_|wall_)/.test(s.assetId)).map((s) => s.assetId),
    tiles: sprites.filter((s) => s.kind === "tile" && !/_edge_|_join_|_(b|c|d)$|_pale|^wall_stone_(top|base)$/.test(s.assetId)).map((s) => s.assetId),
    monsters,
  };
}

function realHost(): ReturnType<typeof createMemoryHost> {
  return createMemoryHost({ sprites: REAL });
}

test("calling a catalog function with nothing bound throws a message that names the fix", () => {
  assert.equal(catalogBound(), false);
  for (const call of [() => artCatalog("fantasy"), () => worldManifest("fantasy"), () => walkableById("fantasy"), () => adventureAssets(), () => renderManifest("fantasy"), () => dmAssets("fantasy", [])]) {
    assert.throws(call, /bindCatalog\(host\.art\)/);
  }
});

test("bound to the real art, the catalog equals what the bench built at import", () => {
  const host = realHost();
  bindCatalog(host.art);
  assert.equal(catalogBound(), true);
  for (const t of ["fantasy", "scifi"] as const) {
    assert.deepEqual(worldManifest(t), refWorld(t), `${t} world manifest`);
    assert.deepEqual(Object.keys(worldManifest(t).tiles), Object.keys(refWorld(t).tiles), `${t} tile order`);
    const got = walkableById(t);
    const want = refWalkable(t);
    assert.equal(got.size, want.size, `${t} walkable size`);
    for (const [id, w] of want) {
      // Tokens answer true by construction (the world manifest has no flag for them); tiles and props match the sprite.
      const kind = REAL[t].find((s) => s.assetId === id)!.kind;
      assert.equal(got.get(id), kind === "token" ? true : w, `${t} ${id}`);
    }
  }
  assert.deepEqual(adventureAssets(), refAdventureAssets());
  assert.deepEqual(dmAssets("fantasy", ["token_goblin", "token_skeleton"]), refDm("fantasy", ["token_goblin", "token_skeleton"]));
  assert.deepEqual(dmAssets("scifi", ["token_raider", "token_drone"]), refDm("scifi", ["token_raider", "token_drone"]));
});

test("walkableById answers what the engine asks: floors walk, walls and a closed door do not, an open door does", () => {
  bindCatalog(createMemoryHost().art);
  const w = walkableById("fantasy");
  assert.equal(w.get("floor_stone"), true);
  assert.equal(w.get("wall_stone_top"), false);
  assert.equal(w.get("door_closed"), false);
  assert.equal(w.get("door_open"), true);
  assert.equal(w.get("chest"), false);
  assert.equal(w.has("token_goblin"), true);
  assert.equal(w.has("nope"), false);
  assert.equal(w.get("nope") === true, false);
});

test("renderManifest is the host's, not cached by the catalog", () => {
  const host = createMemoryHost();
  bindCatalog(host.art);
  const a = renderManifest("fantasy");
  const b = renderManifest("fantasy");
  assert.notEqual(a, b, "the host builds it each time; caching it is the host's call");
  assert.deepEqual(Object.keys(a.tiles), DEFAULT_SPRITES.fantasy.filter((s) => s.kind === "tile").map((s) => s.assetId));
});

test("the catalog is cached once the art is ready", () => {
  const host = createMemoryHost();
  bindCatalog(host.art);
  const a = worldManifest("fantasy");
  walkableById("fantasy");
  adventureAssets();
  dmAssets("fantasy", ["token_goblin", "token_skeleton"]);
  assert.equal(worldManifest("fantasy"), a, "same object the second time");
  assert.equal(host.catalogCalls.fantasy, 1, "the host was asked once");
  assert.equal(host.catalogCalls.scifi, 0, "the other template is never built until asked");
});

test("nothing is cached while the art is not ready", () => {
  const host = createMemoryHost({ ready: false });
  bindCatalog(host.art);
  worldManifest("fantasy");
  worldManifest("fantasy");
  assert.equal(host.catalogCalls.fantasy, 2, "asked again each time");
  host.setReady(true);
  worldManifest("fantasy");
  const after = host.catalogCalls.fantasy;
  worldManifest("fantasy");
  assert.equal(host.catalogCalls.fantasy, after, "cached from the first ready call");
});

test("an art change drops the cache; a replaced library shows through", () => {
  const host = createMemoryHost();
  bindCatalog(host.art);
  assert.equal(walkableById("fantasy").has("floor_lava"), false);
  host.setSprites("fantasy", [...DEFAULT_SPRITES.fantasy, { assetId: "floor_lava", kind: "tile", walkable: true }]);
  assert.equal(walkableById("fantasy").get("floor_lava"), true);
  assert.ok(adventureAssets().walkableTiles!.includes("floor_lava"));
});

test("rebinding replaces the host, and a stale unbind cannot unbind its successor", () => {
  const first = createMemoryHost();
  const second = createMemoryHost({ sprites: { fantasy: [{ assetId: "floor_only", kind: "tile", walkable: true }] } });
  const unbindFirst = bindCatalog(first.art);
  assert.equal(walkableById("fantasy").has("floor_stone"), true);
  const unbindSecond = bindCatalog(second.art);
  assert.deepEqual([...walkableById("fantasy").keys()], ["floor_only"]);
  unbindFirst();
  assert.equal(catalogBound(), true, "the first window disposing late leaves the second bound");
  assert.deepEqual([...walkableById("fantasy").keys()], ["floor_only"]);
  // The first host's change events no longer reach the catalog.
  first.fireArtChange();
  const again = bindCatalog(second.art);
  unbindSecond();
  assert.equal(catalogBound(), true, "a stale unbind of the same art object does nothing either");
  again();
  assert.equal(catalogBound(), false);
});

test("dmAssets leaves out doors, chests, cottage and wall pieces and edge, join and variant tiles", () => {
  assert.ok(DM_PROP_SKIP.test("door_closed") && DM_PROP_SKIP.test("chest_open") && DM_PROP_SKIP.test("cottage_wall") && DM_PROP_SKIP.test("arch_jamb_l") && DM_PROP_SKIP.test("wall_stone_jambs_ns"));
  assert.ok(!DM_PROP_SKIP.test("torch") && !DM_PROP_SKIP.test("barrel"));
  assert.ok(DM_TILE_SKIP.test("floor_grass_edge_stone") && DM_TILE_SKIP.test("floor_stone_b") && DM_TILE_SKIP.test("wall_stone_top"));
  assert.ok(!DM_TILE_SKIP.test("floor_stone") && !DM_TILE_SKIP.test("floor_grass"));
  bindCatalog(createMemoryHost().art);
  const a = dmAssets("fantasy", ["token_goblin", "token_skeleton"]);
  assert.deepEqual(a.props, ["torch", "barrel"]);
  assert.ok(!a.tiles.includes("wall_stone_top") && a.tiles.includes("floor_stone"));
  assert.deepEqual(a.monsters, ["token_goblin", "token_skeleton"]);
  const monsters = ["token_goblin"];
  const b = dmAssets("fantasy", monsters);
  monsters.push("changed");
  assert.deepEqual(b.monsters, ["token_goblin"], "the caller's array is copied");
  assert.notEqual(dmAssets("fantasy", ["token_goblin"]), a, "a different monster pair is a different entry");
});

test("catalogFromSprites keeps order, names, walkable tiles and blocking props", () => {
  const c = catalogFromSprites([
    { assetId: "floor_a", kind: "tile", name: "A floor", walkable: true },
    { assetId: "wall_a", kind: "tile", walkable: false },
    { assetId: "door_closed", kind: "prop", name: "Door", walkable: false },
    { assetId: "torch", kind: "prop", walkable: true },
    { assetId: "token_x", kind: "token", walkable: true },
  ]);
  assert.deepEqual(c.ids, { tiles: ["floor_a", "wall_a"], props: ["door_closed", "torch"], tokens: ["token_x"] });
  assert.deepEqual(c.walkableTiles, ["floor_a"]);
  assert.deepEqual(c.blockingProps, ["door_closed"]);
  assert.deepEqual(c.world.tiles["floor_a"], { walkable: true, opaque: false });
  assert.deepEqual(c.world.tiles["wall_a"], { walkable: false, opaque: true });
  assert.deepEqual(c.world.props["door_closed"], { blocks: true, opaque: true });
  assert.deepEqual(c.world.props["torch"], { blocks: false, opaque: false });
  assert.deepEqual(c.world.tokens["token_x"], {});
  assert.equal(c.names?.["floor_a"], "A floor");
  assert.equal(c.names?.["wall_a"], undefined);
});

test("catalogFromWorld, given a world built from sprites, gives back the same ids and flags", () => {
  const sprites = REAL.fantasy;
  const viaSprites = catalogFromSprites(sprites);
  const viaWorld = catalogFromWorld(viaSprites.world);
  assert.deepEqual(viaWorld.ids, viaSprites.ids);
  assert.deepEqual(viaWorld.walkableTiles, viaSprites.walkableTiles);
  assert.deepEqual(viaWorld.blockingProps, viaSprites.blockingProps);
  assert.equal(viaWorld.names, undefined);
  assert.deepEqual(catalogFromWorld(viaSprites.world, { tree: "Tree" }).names, { tree: "Tree" });
});

test("spriteName uses the library's name, else the id with spaces", () => {
  bindCatalog(createMemoryHost().art);
  assert.equal(spriteName("fantasy", "door_closed"), "Door");
  assert.equal(spriteName("fantasy", "mossy_old_stump"), "mossy old stump");
});

test("the memory host keeps saves, AI adventures, files, sheets and settings", async () => {
  const host: TableHost & ReturnType<typeof createMemoryHost> = createMemoryHost({ settings: { diceSkin: "ember" } });
  assert.equal(host.storage.saves.read("a"), null);
  host.storage.saves.write("a", "one");
  host.storage.saves.write("a", "two");
  assert.equal(host.storage.saves.read("a"), "two");
  assert.equal(host.store.get("a"), "two");
  host.storage.aiAdventures.write(["x", "y"]);
  const read = host.storage.aiAdventures.read();
  read.push("z");
  assert.deepEqual(host.storage.aiAdventures.read(), ["x", "y"], "reads are copies");

  const out = await host.files.save("run.zip", new Uint8Array([1, 2, 3]));
  assert.equal(out.via, "none");
  assert.deepEqual(host.downloads.map((d) => [d.filename, [...d.bytes]]), [["run.zip", [1, 2, 3]]]);

  assert.equal(host.settings.get().diceSkin, "ember");
  assert.equal(host.settings.get().textStyle, "pixel");
  host.settings.set({ textStyle: "storybook", zoom: 3 });
  assert.deepEqual(host.settings.get(), { textStyle: "storybook", textSpeed: "normal", rollMyself: true, diceSkin: "ember", zoom: 3 });
  const snap = host.settings.get();
  snap.zoom = 1;
  assert.equal(host.settings.get().zoom, 3, "get returns a copy");
  assert.deepEqual(host.settings.ownedDiceSkins(), ["bone"]);

  assert.equal(host.heroes.initial(), null);
  assert.deepEqual(host.heroes.playable(), ["knight", "shadow", "fireball-person"]);
  assert.deepEqual(playableHeroIds(), host.heroes.playable());
  assert.equal(await host.dm.sample(), null);
  assert.ok(host.dm.unavailable.length > 0);
  assert.deepEqual(host.adventures.files(), []);
  assert.equal(host.art.cast(), null);
});

test("the memory host's roll source and environment can be set, and a sampler passes through", async () => {
  const sample = async () => ({ text: "{}" });
  const host = createMemoryHost({ rng: () => 0.25, sample, reducedMotion: true, address: "#sandbox", sandboxRooms: true, adventures: [{ file: "a.md", text: "# A" }] });
  assert.equal(host.env.rng(), 0.25);
  assert.equal(host.env.reducedMotion, true);
  assert.equal(host.env.address(), "#sandbox");
  assert.equal(host.env.sandboxRooms, true);
  assert.equal(host.env.debugExport, false);
  assert.equal(await host.dm.sample(), sample);
  assert.deepEqual(host.adventures.files(), [{ file: "a.md", text: "# A" }]);
});

test("the memory host's art signature moves on a change, and unsubscribing stops the calls", () => {
  const host = createMemoryHost();
  const before = host.art.signature();
  let calls = 0;
  const off = host.art.onChange(() => (calls += 1));
  host.fireArtChange();
  assert.equal(calls, 1);
  assert.notEqual(host.art.signature(), before);
  off();
  host.fireArtChange();
  assert.equal(calls, 1);
  assert.equal(host.art.ready(), true);
  host.setReady(false);
  assert.equal(host.art.ready(), false);
});
