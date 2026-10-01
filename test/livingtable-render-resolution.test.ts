/**
 * The renderer draws art at more than one SOURCE RESOLUTION.
 *
 * Until now every sprite was assumed to be 16 source pixels per tile edge:
 * `spritePixelSize(scale)` was `scale / 16`, a token was 16x24, the doll was a
 * 32 pixel square. The new library is rendered from 3D models and ships at 32
 * source pixels per tile edge (a 32x32 tile, a 32x48 token), so the renderer
 * now reads an optional `spriteSize` off the manifest (source pixels per tile
 * edge, default 16) and threads it through everything that turns sprite pixels
 * into canvas pixels.
 *
 * Two properties carry the whole change, and most tests here are one of them:
 *
 *   1. With no `spriteSize` (or 16) every draw call is byte-identical to
 *      before. The 968 tests that predate this file pin the detail; the ones
 *      here pin the equivalence directly.
 *   2. A scene drawn from art upscaled 2x, with `spriteSize: 32`, paints the
 *      SAME canvas as the original art at 16, pixel for pixel, at any scale
 *      where both land on whole canvas pixels. That is the test that says the
 *      geometry, the overhang clip, the gear overlays, the enchantment rim, the
 *      doll and the icons all agree about what "one tile" and "one logical
 *      pixel" mean at the new resolution, rather than each being individually
 *      plausible.
 *
 * Run: npx tsx --test test/livingtable-render-resolution.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstVisibleSpriteRow,
  renderCell,
  SPRITE_SIZE,
  spritePixelRect,
  spritePixelSize,
  spriteSizeOf,
  tileOrigin,
  tokenOrigin,
  type RenderManifest,
} from "../src/games/livingtable/render/canvasRenderer";
import { compositeToken, glowRaster, type ResolvedLayer } from "../src/games/livingtable/render/equipmentCompositor";
import { pedestalBands, renderDoll, PEDESTAL_INDEX_INNER, PEDESTAL_INDEX_OUTER } from "../src/games/livingtable/render/doll";
import { iconPlacement, renderGearIcon } from "../src/games/livingtable/render/gearIcon";
import { TRANSPARENT } from "../src/games/livingtable/render/spritePixels";
import { adaptManifest } from "../src/games/livingtable/assets/manifestCache";
import {
  DOLL_CANVAS_SIZE,
  DOLL_TOKEN_ORIGIN,
  GEAR_ICON_MAX_SCALE,
  GLOW_INDEX_A,
  GLOW_MARGIN,
  LAYER_WEAPON,
  type DrawnGearSpriteId,
  type GearIconSource,
  type TokenRenderPlan,
} from "../src/games/livingtable/characters/equipmentTypes";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world/coordinates";
import type { CellLayout } from "../src/games/livingtable/world/cell";

// ── helpers ───────────────────────────────────────────────────────────────

interface RecordedFill {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; fills: RecordedFill[] } {
  const fills: RecordedFill[] = [];
  const fake = {
    fillStyle: "",
    fillRect(x: number, y: number, width: number, height: number) {
      fills.push({ x, y, width, height, color: fake.fillStyle });
    },
  };
  return { ctx: fake as unknown as CanvasRenderingContext2D, fills };
}

const PALETTE_52 = Array.from({ length: 52 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);

type Grid = number[][];

/** A deterministic grid of palette indices 1..colors, with a share of transparent cells when `holes` is set. No clustering, which is the point: any misplaced pixel shows. */
function noise(seed: number, width: number, height: number, colors: number, holes = false): Grid {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 8;
  };
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => {
      if (holes && next() % 100 < 35) return TRANSPARENT;
      return 1 + (next() % colors);
    }),
  );
}

/** Every cell becomes a k x k block. The same picture at k times the resolution. */
function upscale(grid: Grid, k: number): Grid {
  const out: Grid = [];
  for (const row of grid) {
    const wide = row.flatMap((v) => Array.from({ length: k }, () => v));
    for (let i = 0; i < k; i++) out.push([...wide]);
  }
  return out;
}

function solid(index: number, width: number, height: number): Grid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => index));
}

function block(index: number, left: number, top: number, width: number, height: number, gridW: number, gridH: number): Grid {
  return Array.from({ length: gridH }, (_, y) =>
    Array.from({ length: gridW }, (_, x) => (x >= left && x < left + width && y >= top && y < top + height ? index : TRANSPARENT)),
  );
}

interface ManifestArt {
  tiles: Record<string, Grid>;
  props: Record<string, Grid>;
  tokens: Record<string, Grid>;
}

function manifestOf(art: ManifestArt, spriteSize?: number): RenderManifest {
  const wrap = (group: Record<string, Grid>) => Object.fromEntries(Object.entries(group).map(([id, pixels]) => [id, { pixels }]));
  const manifest: RenderManifest = { palette: PALETTE_52, tiles: wrap(art.tiles), props: wrap(art.props), tokens: wrap(art.tokens) };
  if (spriteSize !== undefined) manifest.spriteSize = spriteSize;
  return manifest;
}

/** The same art at k times the resolution, with the manifest saying so. */
function upscaledArt(art: ManifestArt, k: number): ManifestArt {
  const up = (group: Record<string, Grid>) => Object.fromEntries(Object.entries(group).map(([id, g]) => [id, upscale(g, k)]));
  return { tiles: up(art.tiles), props: up(art.props), tokens: up(art.tokens) };
}

/** Paint recorded fills onto a flat canvas, later wins, anything off-canvas dropped, exactly as a real canvas would. */
function rasterize(fills: readonly RecordedFill[], width: number, height: number): (string | undefined)[] {
  const canvas = new Array<string | undefined>(width * height).fill(undefined);
  for (const f of fills) {
    assert.ok(Number.isInteger(f.x) && Number.isInteger(f.y) && Number.isInteger(f.width) && Number.isInteger(f.height), `fill (${f.x},${f.y},${f.width},${f.height}) is not on whole canvas pixels`);
    for (let y = Math.max(0, f.y); y < Math.min(height, f.y + f.height); y++) {
      for (let x = Math.max(0, f.x); x < Math.min(width, f.x + f.width); x++) canvas[y * width + x] = f.color;
    }
  }
  return canvas;
}

function extent(fills: readonly RecordedFill[]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const f of fills) {
    left = Math.min(left, f.x);
    top = Math.min(top, f.y);
    right = Math.max(right, f.x + f.width);
    bottom = Math.max(bottom, f.y + f.height);
  }
  return { left, top, right, bottom };
}

/**
 * Assert two flat canvases match, naming the first differing pixel. Not
 * deepEqual on purpose: a failing deepEqual over tens of thousands of cells
 * spends minutes and gigabytes building its diff, which turns a readable
 * failure into an out-of-memory crash.
 */
function assertSameCanvas(actual: readonly (string | undefined)[], expected: readonly (string | undefined)[], width: number, label: string): void {
  assert.equal(actual.length, expected.length, `${label}: canvas sizes differ`);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) assert.fail(`${label}: first difference at (${i % width},${Math.floor(i / width)}): got ${String(actual[i])}, expected ${String(expected[i])}`);
  }
}

/** The same, for a grid of palette indices such as a glow raster. */
function assertSameGrid(actual: Grid, expected: Grid, label: string): void {
  assert.equal(actual.length, expected.length, `${label}: heights differ`);
  for (let y = 0; y < expected.length; y++) {
    assert.equal(actual[y]!.length, expected[y]!.length, `${label}: row ${y} widths differ`);
    for (let x = 0; x < expected[y]!.length; x++) {
      if (actual[y]![x] !== expected[y]![x]) assert.fail(`${label}: first difference at (${x},${y}): got ${actual[y]![x]}, expected ${expected[y]![x]}`);
    }
  }
}

/** Canvas pixels painted, counting an overlap twice: for a sprite that paints each of its pixels once, the area it covers. */
function area(fills: readonly RecordedFill[]): number {
  return fills.reduce((sum, f) => sum + f.width * f.height, 0);
}

function emptyTiles(): string[][] {
  return Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => ""));
}

function layoutOf(over: Partial<CellLayout>): CellLayout {
  return { tiles: emptyTiles(), props: [], tokens: [], exits: [], ...over };
}

// ── 1. the manifest's own resolution ──────────────────────────────────────

test("spriteSizeOf reads the manifest's resolution and falls back to 16 on anything that is not a usable size", () => {
  assert.equal(SPRITE_SIZE, 16, "the tile grid's native pitch is unchanged");
  assert.equal(spriteSizeOf({}), 16, "no field: today's art");
  assert.equal(spriteSizeOf({ spriteSize: 16 }), 16);
  assert.equal(spriteSizeOf({ spriteSize: 32 }), 32);
  for (const bad of [0, -32, Number.NaN, Number.POSITIVE_INFINITY, "32" as unknown as number, null as unknown as number]) {
    assert.equal(spriteSizeOf({ spriteSize: bad }), 16, `${String(bad)} must not reach the draw maths`);
  }
});

test("the layout maths takes an optional spriteSize, and its default is the old behaviour to the last digit", () => {
  // Default: exactly what the 968 older tests pin.
  assert.equal(spritePixelSize(16), 1);
  assert.equal(spritePixelSize(32), 2);
  assert.equal(spritePixelSize(32, 16), 2);

  // 32 source pixels per tile edge: half the canvas pixels per source pixel.
  assert.equal(spritePixelSize(32, 32), 1);
  assert.equal(spritePixelSize(16, 32), 0.5);
  assert.equal(spritePixelSize(64, 32), 2);

  const origin = tileOrigin({ x: 2, y: 1 }, 32);
  assert.deepEqual(spritePixelRect(origin, 3, 5, 32), { x: 70, y: 42, width: 2, height: 2 });
  assert.deepEqual(spritePixelRect(origin, 3, 5, 32, 32), { x: 67, y: 37, width: 1, height: 1 });
});

// ── 2. a 32 px tile fills exactly one tile of canvas ──────────────────────

test("a 32x32 tile drawn at scale 32 fills exactly one tile of canvas, one canvas pixel per source pixel", () => {
  const manifest = manifestOf({ tiles: { floor: noise(7, 32, 32, 9) }, props: {}, tokens: {} }, 32);
  const tiles = emptyTiles();
  tiles[3]![4] = "floor";
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutOf({ tiles }), manifest, 32);

  assert.equal(area(fills), 32 * 32, "every source pixel of a tile is opaque and is painted once: one canvas pixel each");
  assert.ok(fills.every((f) => f.height === 1 && Number.isInteger(f.width)), "rows of whole canvas pixels, one source row each");
  assert.deepEqual(extent(fills), { left: 4 * 32, top: 3 * 32, right: 5 * 32, bottom: 4 * 32 }, "exactly the tile's own box, not a pixel more");

  // Run merging is a saving in calls, not a change in picture: the canvas is
  // the tile's own pixels, each in its own place.
  const canvas = rasterize(fills, CELL_WIDTH * 32, CELL_HEIGHT * 32);
  const art = manifest.tiles.floor!.pixels;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) assert.equal(canvas[(3 * 32 + y) * CELL_WIDTH * 32 + 4 * 32 + x], PALETTE_52[art[y]![x]!], `source pixel (${x},${y})`);
  }
});

test("a 32 px tile drawn at scale 16 still covers exactly one tile, once, with no gap or overlap", () => {
  // Half a canvas pixel per source pixel: a half-pixel rect composites as a
  // translucent seam on a real canvas, so a non-integer source pixel snaps to
  // whole canvas pixels. The contract is coverage: every canvas pixel of the
  // tile box painted exactly once.
  const manifest = manifestOf({ tiles: { floor: noise(9, 32, 32, 9) }, props: {}, tokens: {} }, 32);
  const tiles = emptyTiles();
  tiles[2]![2] = "floor";
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutOf({ tiles }), manifest, 16);

  const covered = new Uint8Array(CELL_WIDTH * 16 * CELL_HEIGHT * 16);
  for (const f of fills) {
    assert.ok(Number.isInteger(f.x) && Number.isInteger(f.y) && Number.isInteger(f.width) && Number.isInteger(f.height), "snapped to whole canvas pixels");
    assert.ok(f.width > 0 && f.height > 0, "a snapped rect that collapses to nothing is skipped, not painted empty");
    for (let y = f.y; y < f.y + f.height; y++) for (let x = f.x; x < f.x + f.width; x++) covered[y * CELL_WIDTH * 16 + x]! += 1;
  }
  for (let y = 0; y < CELL_HEIGHT * 16; y++) {
    for (let x = 0; x < CELL_WIDTH * 16; x++) {
      const inside = x >= 2 * 16 && x < 3 * 16 && y >= 2 * 16 && y < 3 * 16;
      assert.equal(covered[y * CELL_WIDTH * 16 + x], inside ? 1 : 0, `canvas pixel (${x},${y})`);
    }
  }
});

test("every tile of a 20x15 grid lands inside its own tile box at 32 px", () => {
  // Two tile ids on a checkerboard, so a stray pixel in the neighbour's box is
  // a wrong colour in that box and cannot hide.
  const manifest = manifestOf({ tiles: { a: solid(1, 32, 32), b: solid(2, 32, 32) }, props: {}, tokens: {} }, 32);
  const tiles = emptyTiles().map((row, y) => row.map((_, x) => ((x + y) % 2 === 0 ? "a" : "b")));
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutOf({ tiles }), manifest, 32);

  // No paint may leave the tile it belongs to. Checked per fill, because two
  // tiles of 64 canvas pixels painted in order would still look right on the
  // final canvas (the later tile covers the spill) and hide a wrong size.
  for (const f of fills) {
    const tx = Math.floor(f.x / 32);
    const ty = Math.floor(f.y / 32);
    assert.ok(f.x + f.width <= (tx + 1) * 32 && f.y + f.height <= (ty + 1) * 32, `fill (${f.x},${f.y},${f.width},${f.height}) spills out of tile (${tx},${ty})`);
    assert.equal(f.color, PALETTE_52[(tx + ty) % 2 === 0 ? 1 : 2], `fill (${f.x},${f.y})`);
  }
  assert.equal(area(fills), CELL_WIDTH * CELL_HEIGHT * 32 * 32, "and every canvas pixel is painted exactly once");
});

// ── 3. a 32x48 token stands feet on its tile, one and a half tiles tall ───

test("tokenOrigin anchors a 48-tall sprite at 32 px with its feet on the tile and half a tile of overhang", () => {
  // height 48 source rows at 32 per tile edge is 1.5 tiles.
  assert.deepEqual(tokenOrigin({ x: 2, y: 3 }, 48, 32, 32), { x: 64, y: 80 });
  assert.deepEqual(tokenOrigin({ x: 2, y: 3 }, 48, 64, 32), { x: 128, y: 160 });
  for (const scale of [16, 32, 64]) {
    const origin = tokenOrigin({ x: 1, y: 5 }, 48, scale, 32);
    assert.equal(origin.y + 48 * spritePixelSize(scale, 32), 6 * scale, `the bottom row sits on the tile's bottom edge at scale ${scale}`);
    assert.equal(origin.y, 6 * scale - 1.5 * scale, `1.5 tiles tall at scale ${scale}`);
  }
  // A full-tile sprite at any resolution is still exactly tileOrigin.
  for (const [size, scale] of [[16, 32], [32, 32], [32, 64]] as const) {
    assert.deepEqual(tokenOrigin({ x: 3, y: 4 }, size, scale, size), tileOrigin({ x: 3, y: 4 }, scale), `size ${size} at scale ${scale}`);
  }
});

test("the top-of-canvas clip counts source rows at the manifest's resolution", () => {
  // A 48-tall token on tile row 0 wants 16 source rows above the canvas at 32
  // px per tile, where a 24-tall one wanted 8 at 16.
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 0 }, 48, 32, 32).y, 32, 32), 16);
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 0 }, 48, 64, 32).y, 64, 32), 16);
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 1 }, 48, 32, 32).y, 32, 32), 0, "row 1 has a tile above to hang into");
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 0 }, 32, 32, 32).y, 32, 32), 0, "a one-tile sprite never overhangs");
  assert.equal(firstVisibleSpriteRow(-16, 32), 8, "default resolution unchanged");
});

test("a 32x48 token stands feet-on-tile, 1.5 tiles tall, through renderCell", () => {
  const manifest = manifestOf({ tiles: {}, props: {}, tokens: { hero: noise(3, 32, 48, 9) } }, 32);
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutOf({ tokens: [{ id: "h", assetId: "hero", x: 2, y: 3, kind: "pc" }] }), manifest, 32);
  assert.equal(area(fills), 32 * 48, "every pixel of the body paints once");
  assert.deepEqual(extent(fills), { left: 64, top: 80, right: 96, bottom: 128 }, "x is its own tile, the bottom is its tile's bottom, the top is half a tile into the tile above");

  const big = recordingCtx();
  renderCell(big.ctx, layoutOf({ tokens: [{ id: "h", assetId: "hero", x: 2, y: 3, kind: "pc" }] }), manifest, 64);
  assert.ok(big.fills.every((f) => f.height === 2 && f.width % 2 === 0), "two canvas pixels per source pixel at scale 64");
  assert.equal(area(big.fills), 32 * 48 * 4);
  assert.deepEqual(extent(big.fills), { left: 128, top: 160, right: 192, bottom: 256 });
});

test("a 32x48 token on tile row 0 skips its 16 overhanging rows and paints nothing above the canvas", () => {
  const manifest = manifestOf({ tiles: {}, props: {}, tokens: { hero: noise(3, 32, 48, 9) } }, 32);
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutOf({ tokens: [{ id: "h", assetId: "hero", x: 4, y: 0, kind: "pc" }] }), manifest, 32);
  assert.equal(area(fills), 32 * 32, "the 16 clipped rows are skipped, the 32 on-screen rows are drawn");
  for (const f of fills) assert.ok(f.y >= 0, `painted at y ${f.y}, above the canvas`);
  assert.equal(extent(fills).top, 0);
});

test("a tall prop at 32 px is feet-anchored exactly like a token", () => {
  const manifest = manifestOf({ tiles: {}, props: { tree: noise(4, 32, 48, 9) }, tokens: {} }, 32);
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutOf({ props: [{ id: "p", assetId: "tree", x: 6, y: 5 }] }), manifest, 32);
  assert.deepEqual(extent(fills), { left: 6 * 32, top: 5 * 32 + 32 - 48, right: 7 * 32, bottom: 6 * 32 });
});

// ── 4. resolution 16 is byte-identical to before ──────────────────────────

const ART_16: ManifestArt = {
  tiles: { flat: noise(11, 16, 16, 12), other: noise(12, 16, 16, 12) },
  props: { tree: noise(13, 16, 24, 12, true), chest: noise(14, 16, 16, 12, true) },
  tokens: {
    hero: noise(15, 16, 24, 9, true),
    gear_hero_weapon: noise(16, 16, 24, 9, true),
    gear_hero_outer: noise(17, 16, 24, 9, true),
    gear_hero_crown: noise(18, 16, 24, 9, true),
    imp: noise(19, 16, 16, 9, true),
  },
};

const PLAN: TokenRenderPlan = {
  bodySpriteId: "hero" as never,
  layers: [
    { spriteId: "gear_hero_outer" as DrawnGearSpriteId, layer: 10, remap: { 4: 31, 5: 32 }, glowBands: 0, glowPulses: false },
    { spriteId: "gear_hero_weapon" as DrawnGearSpriteId, layer: 40, remap: null, glowBands: 2, glowPulses: true },
    { spriteId: "gear_hero_crown" as DrawnGearSpriteId, layer: 50, remap: { 6: 33 }, glowBands: 1, glowPulses: false },
  ],
};

function sceneTiles(): string[][] {
  const tiles = emptyTiles();
  for (let y = 1; y < 6; y++) for (let x = 0; x < 9; x++) tiles[y]![x] = (x * 3 + y) % 4 === 0 ? "other" : "flat";
  return tiles;
}

const SCENE: CellLayout = layoutOf({
  tiles: sceneTiles(),
  props: [
    { id: "p1", assetId: "tree", x: 3, y: 0 },
    { id: "p2", assetId: "chest", x: 6, y: 3 },
    { id: "p3", assetId: "tree", x: 1, y: 4 },
  ],
  tokens: [
    { id: "hero-top", assetId: "hero", x: 5, y: 0, kind: "pc" },
    { id: "hero-left", assetId: "hero", x: 0, y: 2, kind: "pc" },
    { id: "hero-mid", assetId: "hero", x: 4, y: 4, kind: "pc" },
    { id: "imp", assetId: "imp", x: 7, y: 2, kind: "monster" },
  ],
});
const PLANS = { "hero-top": PLAN, "hero-left": PLAN, "hero-mid": PLAN };

test("a manifest with no spriteSize and one that says 16 draw byte-identical fills", () => {
  for (const scale of [16, 32, 48]) {
    for (const frame of [0, 1] as const) {
      const bare = recordingCtx();
      renderCell(bare.ctx, SCENE, manifestOf(ART_16), scale, 5, PLANS, frame);
      const explicit = recordingCtx();
      renderCell(explicit.ctx, SCENE, manifestOf(ART_16, 16), scale, 5, PLANS, frame);
      assert.ok(bare.fills.length > 1000, "a scene that actually paints");
      assert.deepEqual(explicit.fills, bare.fills, `scale ${scale} frame ${frame}`);
    }
  }
});

test("at 16 the first tile pixels land where the pre-resolution maths put them, unsnapped at every scale", () => {
  // The independent expectation: tile (1,1) at scale 24 is 1.5 canvas pixels
  // per source pixel, which the old renderer drew as fractional rects. Byte
  // identical means it still does, rather than newly snapping to whole pixels.
  const manifest = manifestOf(ART_16);
  const tiles = emptyTiles();
  tiles[1]![1] = "flat";
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutOf({ tiles }), manifest, 24);
  assert.deepEqual(fills[0], { x: 24, y: 24, width: 1.5, height: 1.5, color: PALETTE_52[ART_16.tiles.flat![0]![0]!] });
  assert.deepEqual(fills[17], { x: 24 + 1 * 1.5, y: 24 + 1 * 1.5, width: 1.5, height: 1.5, color: PALETTE_52[ART_16.tiles.flat![1]![1]!] });
});

// ── 5. the same scene at 2x resolution paints the same canvas ─────────────

test("a scene of 2x art with spriteSize 32 paints the same canvas as the 16 px original, tiles props tokens gear and rim", () => {
  const art32 = upscaledArt(ART_16, 2);
  for (const scale of [32, 64]) {
    const width = 10 * scale;
    const height = 8 * scale;
    for (const frame of [0, 1] as const) {
      const lo = recordingCtx();
      renderCell(lo.ctx, SCENE, manifestOf(ART_16), scale, 5, PLANS, frame);
      const hi = recordingCtx();
      renderCell(hi.ctx, SCENE, manifestOf(art32, 32), scale, 5, PLANS, frame);

      const a = rasterize(lo.fills, width, height);
      const b = rasterize(hi.fills, width, height);
      let painted = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== undefined) painted++;
      assert.ok(painted > width * height * 0.3, "a scene with real coverage");
      // Not vacuous: the picture being compared really contains the recoloured
      // gear and both rim bands, so equality covers them.
      const colours = new Set(a);
      for (const index of [31, 33, GLOW_INDEX_A[0], GLOW_INDEX_A[1]]) assert.ok(colours.has(PALETTE_52[index]), `palette ${index} is on the canvas`);
      assertSameCanvas(b, a, width, `scale ${scale} frame ${frame}`);
    }
  }
});

test("the enchantment rim at 32 px is as thick on screen as at 16, and reaches the same canvas pixels", () => {
  // A single lit block. At 16 the rim is 2 source pixels of band, at 32 it has
  // to be 4, or it would be a hairline next to the same item at the old size.
  const body16 = solid(2, 16, 24);
  const weapon16 = block(3, 6, 8, 4, 10, 16, 24);
  const art16: ManifestArt = { tiles: {}, props: {}, tokens: { hero: body16, gear_hero_weapon: weapon16 } };
  const plan: TokenRenderPlan = {
    bodySpriteId: "hero" as never,
    layers: [{ spriteId: "gear_hero_weapon" as DrawnGearSpriteId, layer: LAYER_WEAPON, remap: null, glowBands: 2, glowPulses: false }],
  };
  const layout = layoutOf({ tokens: [{ id: "t", assetId: "hero", x: 5, y: 4, kind: "pc" }] });
  const scale = 32;
  const lo = recordingCtx();
  renderCell(lo.ctx, layout, manifestOf(art16), scale, 0, { t: plan });
  const hi = recordingCtx();
  renderCell(hi.ctx, layout, manifestOf(upscaledArt(art16, 2), 32), scale, 0, { t: plan });

  const isRim = (f: RecordedFill) => f.color === PALETTE_52[GLOW_INDEX_A[0]] || f.color === PALETTE_52[GLOW_INDEX_A[1]];
  const loRim = lo.fills.filter(isRim);
  const hiRim = hi.fills.filter(isRim);
  assert.ok(loRim.length > 0 && hiRim.length > 0, "both draw a rim");
  assert.equal(loRim.reduce((sum, f) => sum + f.width * f.height, 0), hiRim.reduce((sum, f) => sum + f.width * f.height, 0), "the same rim area on the canvas");
  assert.deepEqual(extent(hiRim), extent(loRim), "and the same extent");
});

// ── 6. overlays composite at 32 ───────────────────────────────────────────

test("compositeToken composites 32x48 overlays in the same order, feet-aligned, with the rim margin scaled to the resolution", () => {
  const lookup = (id: string): Grid | undefined =>
    ({ body: solid(2, 32, 48), cloak: solid(3, 32, 48), blade: solid(4, 32, 48), hood: solid(5, 32, 32) })[id];
  const plan: TokenRenderPlan = {
    bodySpriteId: "body" as never,
    layers: [
      { spriteId: "cloak" as DrawnGearSpriteId, layer: 10, remap: null, glowBands: 0, glowPulses: false },
      { spriteId: "blade" as DrawnGearSpriteId, layer: 40, remap: null, glowBands: 2, glowPulses: false },
      { spriteId: "hood" as DrawnGearSpriteId, layer: 50, remap: { 5: 9 }, glowBands: 0, glowPulses: false },
    ],
  };
  const draws = compositeToken(plan, lookup, 0, 32);
  // glow ring, cloak, body, blade, hood
  assert.equal(draws.length, 5);
  assert.deepEqual(draws.slice(1).map((d) => d.pixels[0]![0]), [3, 2, 4, 5], "cloak, body, blade, hood");
  const ring = draws[0]!;
  const margin = GLOW_MARGIN * 2;
  assert.equal(ring.offsetX, -margin, "the rim leaves the sprite by 2 bands of 2 source pixels each");
  assert.equal(ring.offsetY, -margin);
  assert.equal(ring.pixels.length, 48 + 2 * margin);
  assert.equal(ring.pixels[0]!.length, 32 + 2 * margin);
  assert.equal(draws[4]!.offsetY, 16, "a 32-tall hood on a 48-tall body aligns at the feet, 16 source rows down");
  assert.deepEqual(draws[4]!.remap, { 5: 9 });

  // The default resolution is the old margin.
  const old = compositeToken(plan, (id) => ({ body: solid(2, 16, 24), cloak: solid(3, 16, 24), blade: solid(4, 16, 24), hood: solid(5, 16, 16) } as Record<string, Grid>)[id], 0);
  assert.equal(old[0]!.offsetX, -GLOW_MARGIN);
  assert.equal(old[0]!.pixels.length, 24 + 2 * GLOW_MARGIN);
});

function layerOf(pixels: Grid, glowBands: 0 | 1 | 2, glowPulses: boolean): ResolvedLayer {
  return { spriteId: "x" as DrawnGearSpriteId, layer: LAYER_WEAPON, remap: null, glowBands, glowPulses, pixels, offsetY: 0 };
}

test("glowRaster at 32 px is exactly the 16 px rim upscaled 2x, for any art, both frames and every band count", () => {
  // The property that makes the rim a rim at the new resolution: same shape,
  // same lit side, twice as many source pixels thick.
  const shapes: Grid[] = [
    block(3, 7, 7, 1, 1, 16, 24),
    block(3, 4, 6, 7, 12, 16, 24),
    noise(21, 16, 24, 6, true),
    noise(22, 16, 24, 6, true),
    block(3, 0, 0, 16, 24, 16, 24),
  ];
  for (const shape of shapes) {
    for (const bands of [1, 2] as const) {
      for (const frame of [0, 1] as const) {
        const lo = glowRaster([layerOf(shape, bands, true)], 16, 24, frame);
        const hi = glowRaster([layerOf(upscale(shape, 2), bands, true)], 32, 48, frame, 32);
        assert.equal(hi.length, 2 * lo.length, "the raster's own margin doubles with the resolution");
        assertSameGrid(hi, upscale(lo, 2), `bands ${bands} frame ${frame}`);
      }
    }
  }
});

test("glowRaster with no resolution is today's raster", () => {
  const shape = noise(23, 16, 24, 6, true);
  assert.deepEqual(glowRaster([layerOf(shape, 2, false)], 16, 24, 0), glowRaster([layerOf(shape, 2, false)], 16, 24, 0, 16));
});

// ── 7. the doll ───────────────────────────────────────────────────────────

test("pedestalBands at 32 px per tile is the same ring on a raster twice as fine, its bands twice as thick", () => {
  const lo = pedestalBands();
  const hi = pedestalBands(32);
  assert.equal(lo.band1.length, DOLL_CANVAS_SIZE, "default unchanged");
  assert.equal(hi.band1.length, DOLL_CANVAS_SIZE * 2);
  assert.equal(hi.band1[0]!.length, DOLL_CANVAS_SIZE * 2);

  let minY = 999, maxY = -999, minX = 999, maxX = -999;
  for (let y = 0; y < hi.band1.length; y++) {
    for (let x = 0; x < hi.band1.length; x++) {
      if (hi.band1[y]![x] || hi.band2[y]![x]) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  assert.deepEqual({ minY, maxY, minX, maxX }, { minY: 50, maxY: 61, minX: 8, maxX: 55 }, "the same ellipse, in doubled coordinates");

  // Down the centre column: outer ring 2, inner ring 2, interior 4, inner 2, outer 2.
  const column = (mask: boolean[][]) => mask.map((row) => row[32]);
  const rows = (mask: boolean[][]) => column(mask).flatMap((v, y) => (v ? [y] : []));
  assert.deepEqual(rows(hi.band1), [50, 51, 60, 61], "the outer ring is 2 source pixels thick, as 1 logical pixel was");
  assert.deepEqual(rows(hi.band2), [52, 53, 58, 59], "and so is the inner ring");
  for (let y = 0; y < hi.band1.length; y++) for (let x = 0; x < hi.band1.length; x++) assert.ok(!(hi.band1[y]![x] && hi.band2[y]![x]), `(${x},${y}) in both bands`);
});

test("renderDoll draws a 32 px body into the same canvas box as the 16 px one, at half the canvas pixels per source pixel", () => {
  const art16: ManifestArt = {
    tiles: {},
    props: {},
    tokens: { hero: noise(31, 16, 24, 9, true), gear_hero_weapon: noise(32, 16, 24, 9, true) },
  };
  const plan: TokenRenderPlan = {
    bodySpriteId: "hero" as never,
    layers: [{ spriteId: "gear_hero_weapon" as DrawnGearSpriteId, layer: LAYER_WEAPON, remap: { 4: 31 }, glowBands: 2, glowPulses: false }],
  };
  const scale = 6;
  const size = DOLL_CANVAS_SIZE * scale;
  const lo = recordingCtx();
  renderDoll(lo.ctx, plan, manifestOf(art16), scale);
  const hi = recordingCtx();
  renderDoll(hi.ctx, plan, manifestOf(upscaledArt(art16, 2), 32), scale);

  const pedestal = new Set([PALETTE_52[PEDESTAL_INDEX_OUTER], PALETTE_52[PEDESTAL_INDEX_INNER]]);
  const tokenOnly = (fills: RecordedFill[]) => fills.filter((f) => !pedestal.has(f.color));
  assert.ok(tokenOnly(hi.fills).every((f) => f.width === scale / 2 && f.height === scale / 2), "each 32 px source pixel is half a logical pixel");
  assertSameCanvas(rasterize(tokenOnly(hi.fills), size, size), rasterize(tokenOnly(lo.fills), size, size), size, "the figure, its gear and its rim");
  assert.ok(extent(tokenOnly(hi.fills)).left >= 0 && extent(tokenOnly(hi.fills)).right <= size, "nothing leaves the doll's own canvas");


  // The pedestal exists, is painted first, and stays inside the canvas.
  const pedestalFills = hi.fills.filter((f) => pedestal.has(f.color));
  assert.ok(pedestalFills.length > 0);
  assert.ok(pedestal.has(hi.fills[0]!.color), "the pedestal comes first");
  assert.ok(extent(pedestalFills).right <= size && extent(pedestalFills).bottom <= size);
});

test("renderDoll stands a 32x48 body at DOLL_TOKEN_ORIGIN, 16 by 24 logical pixels of canvas, whatever the resolution", () => {
  const manifest = manifestOf({ tiles: {}, props: {}, tokens: { hero: solid(2, 32, 48) } }, 32);
  const plan: TokenRenderPlan = { bodySpriteId: "hero" as never, layers: [] };
  for (const scale of [4, 6, 8]) {
    const { ctx, fills } = recordingCtx();
    renderDoll(ctx, plan, manifest, scale);
    const body = fills.filter((f) => f.color === PALETTE_52[2]);
    assert.equal(body.length, 32 * 48);
    assert.deepEqual(extent(body), {
      left: DOLL_TOKEN_ORIGIN.x * scale,
      top: DOLL_TOKEN_ORIGIN.y * scale,
      right: (DOLL_TOKEN_ORIGIN.x + 16) * scale,
      bottom: (DOLL_TOKEN_ORIGIN.y + 24) * scale,
    }, `scale ${scale}`);
  }
});

test("renderDoll with no spriteSize is exactly what it drew before", () => {
  const art16: ManifestArt = { tiles: {}, props: {}, tokens: { hero: noise(33, 16, 24, 9, true) } };
  const plan: TokenRenderPlan = { bodySpriteId: "hero" as never, layers: [] };
  const a = recordingCtx();
  renderDoll(a.ctx, plan, manifestOf(art16), 6);
  const b = recordingCtx();
  renderDoll(b.ctx, plan, manifestOf(art16, 16), 6);
  assert.deepEqual(b.fills, a.fills);
  const bodyFill = a.fills.find((f) => !(f.color === PALETTE_52[PEDESTAL_INDEX_OUTER] || f.color === PALETTE_52[PEDESTAL_INDEX_INNER]))!;
  assert.equal(bodyFill.width, 6, "one logical pixel, `scale` canvas pixels");
});

// ── 8. the gear icon ──────────────────────────────────────────────────────

test("iconPlacement at 32 px crops the same item, in twice the source pixels, to the same box on the canvas", () => {
  const lo = block(5, 5, 5, 3, 3, 16, 16);
  const hi = upscale(lo, 2);
  const at16 = iconPlacement(lo, 0, 52);
  const at32 = iconPlacement(hi, 0, 52, 32);
  assert.deepEqual({ cropX: at32.cropX, cropY: at32.cropY, cropW: at32.cropW, cropH: at32.cropH }, { cropX: 10, cropY: 10, cropW: 6, cropH: 6 });
  assert.equal(at16.scale, GEAR_ICON_MAX_SCALE);
  assert.equal(at32.scale, GEAR_ICON_MAX_SCALE / 2, "the icon's size cap is in logical pixels, so it halves per source pixel at 32");
  assert.equal(at32.cropW * at32.scale, at16.cropW * at16.scale, "the same icon, the same size on screen");
  assert.equal(at32.offsetX, at16.offsetX);
  assert.equal(at32.offsetY, at16.offsetY);

  // A rim band is one logical pixel, so it grows the crop by two source pixels.
  const grown = iconPlacement(hi, 1, 52, 32);
  assert.deepEqual({ cropX: grown.cropX, cropW: grown.cropW }, { cropX: 8, cropW: 10 });
});

test("iconPlacement at 32 px never drops below one canvas pixel per source pixel, and never exceeds the cap", () => {
  const whole = solid(5, 32, 32);
  assert.equal(iconPlacement(whole, 0, 4, 32).scale, 1);
  assert.equal(iconPlacement(whole, 0, 400, 32).scale, GEAR_ICON_MAX_SCALE / 2);
  assert.equal(iconPlacement(whole, 0, 52, 32).scale, 1, "a cell too small for the capped size shrinks to fit");
  const empty = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => TRANSPARENT));
  const placement = iconPlacement(empty, 0, 52, 32);
  assert.deepEqual({ cropW: placement.cropW, cropH: placement.cropH }, { cropW: 32, cropH: 32 }, "an empty sprite falls back to its whole grid");
});

test("renderGearIcon draws a 32 px icon and its rim to the same canvas pixels as the 16 px one", () => {
  const lo = block(5, 6, 6, 3, 4, 16, 16);
  const hi = upscale(lo, 2);
  for (const glowBands of [0, 1, 2] as const) {
    const source: GearIconSource = { kind: "icon", spriteId: "gear_fantasy_ring_rare", remap: { 5: 31 }, glowBands };
    const a = recordingCtx();
    assert.equal(renderGearIcon(a.ctx, source, manifestOf({ tiles: {}, props: {}, tokens: { gear_fantasy_ring_rare: lo } }), 52), true);
    const b = recordingCtx();
    assert.equal(renderGearIcon(b.ctx, source, manifestOf({ tiles: {}, props: {}, tokens: { gear_fantasy_ring_rare: hi } }, 32), 52), true);
    assert.ok(a.fills.length > 0 && b.fills.length > 0);
    assertSameCanvas(rasterize(b.fills, 52, 52), rasterize(a.fills, 52, 52), 52, `glowBands ${glowBands}`);
    if (glowBands > 0) {
      const rim = (fills: RecordedFill[]) => fills.filter((f) => f.color === PALETTE_52[GLOW_INDEX_A[0]] || f.color === PALETTE_52[GLOW_INDEX_A[1]]);
      assert.ok(rim(b.fills).length > 0, "a rim was painted at 32");
    }
  }
});

test("renderGearIcon at 32 px still reports a missing sprite as false and draws nothing", () => {
  const { ctx, fills } = recordingCtx();
  const source: GearIconSource = { kind: "silhouette", spriteId: "gear_fantasy_ring_empty" };
  assert.equal(renderGearIcon(ctx, source, manifestOf({ tiles: {}, props: {}, tokens: {} }, 32), 52), false);
  assert.equal(fills.length, 0);
});

// ── 9. the wire ───────────────────────────────────────────────────────────

const WIRE_ASSETS = [
  { assetId: "floor", kind: "tile" as const, name: "Floor", size: 32, walkable: true, pixels: [[0]] },
  { assetId: "hero", kind: "token" as const, name: "Hero", size: 32, walkable: false, pixels: [[-1]] },
];

test("adaptManifest takes the resolution from the wire manifest when present", () => {
  const adapted = adaptManifest({ template: "fantasy", palette: [[0, 0, 0]], assets: WIRE_ASSETS, spriteSize: 32 });
  assert.equal(adapted.render.spriteSize, 32);
  assert.equal(spriteSizeOf(adapted.render), 32);
});

test("adaptManifest leaves the field off when the wire says nothing, so an older manifest is exactly what it was", () => {
  const adapted = adaptManifest({ template: "fantasy", palette: [[0, 0, 0]], assets: WIRE_ASSETS });
  assert.equal("spriteSize" in adapted.render, false);
  assert.deepEqual(Object.keys(adapted.render).sort(), ["palette", "props", "tiles", "tokens"]);
  assert.equal(spriteSizeOf(adapted.render), 16);
});

test("adaptManifest ignores a resolution that is not a usable size rather than trusting it", () => {
  for (const bad of [0, -16, Number.NaN, Number.POSITIVE_INFINITY, "32", null, {}, [32]]) {
    const adapted = adaptManifest({ template: "fantasy", palette: [[0, 0, 0]], assets: WIRE_ASSETS, spriteSize: bad as never });
    assert.equal("spriteSize" in adapted.render, false, `${JSON.stringify(bad)} must be ignored`);
    assert.equal(spriteSizeOf(adapted.render), 16);
  }
});
