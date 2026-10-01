/**
 * The wall and door profile pass (render/wallProfiles.ts): walls drawn as the
 * strip they are seen from above, with corners, junctions and wall ends worked
 * out from the neighbours, and a door in a north-south wall drawn side-on in
 * its gap.
 *
 * The properties under test, in the order the file takes them:
 *
 *   - the mask: which sides join, for a ring room, the bench's two rooms and a
 *     small dungeon laid the way the DM is taught (`_top` north, plain sides,
 *     `_base` south). A door joins the two walls either side of it; a bare gap
 *     joins nothing.
 *   - the gate: the pass is all or nothing per manifest. Any one of the nineteen
 *     required ids missing draws exactly what is drawn without the pass.
 *   - it is display only: the stored layout is never touched.
 *   - the door rule, and what renderCell paints for a profiled door.
 *   - the render-only ids against the real fantasy art (the last test).
 *
 * The last test needs the 23 sprites in scripts/assets/fantasy.ts. Everything
 * else runs on synthetic manifests with placeholder pixels, so it does not.
 *
 * Run: npx tsx --test test/livingtable-wall-profiles.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  WALL_E,
  WALL_JOIN_BY_MASK,
  WALL_JOIN_VARIANT_SUFFIXES,
  WALL_N,
  WALL_PROFILE_RULES,
  WALL_S,
  WALL_W,
  RENDER_ONLY_ASSET_IDS,
  applyWallProfiles,
  doorProfileFor,
  isRenderOnlyAssetId,
  wallMaskAt,
  wallProfileAt,
  wallProfilesActive,
} from "../src/games/livingtable/render/wallProfiles";
import { applyDisplayTiles } from "../src/games/livingtable/render/terrainEdges";
import { PROP_VARIANT_SETS, VARIANT_SETS, applyTileVariants } from "../src/games/livingtable/render/tileVariants";
import { renderCell, type RenderManifest } from "../src/games/livingtable/render/canvasRenderer";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world/coordinates";
import type { CellLayout, PlacedProp } from "../src/games/livingtable/world/cell";
import { SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";

// ── fixtures ──────────────────────────────────────────────────────────────

const W = CELL_WIDTH;
const H = CELL_HEIGHT;
const RULE = WALL_PROFILE_RULES[0]!;

type Tiles = string[][];

function prop(assetId: string, x: number, y: number, id = `${assetId}-${x}-${y}`): PlacedProp {
  return { id, assetId, x, y };
}

function floorGrid(): Tiles {
  return Array.from({ length: H }, () => Array.from({ length: W }, () => "floor_stone"));
}

function gridWith(walls: ReadonlyArray<readonly [number, number]>, wallId = "wall_stone"): Tiles {
  const tiles = floorGrid();
  for (const [x, y] of walls) tiles[y]![x] = wallId;
  return tiles;
}

/** The bench's two rooms (scripts/asset-bench/assets.ts sceneTiles): an outer wall, and a divider down column 11 with a one-square gap at row 7. */
function benchTiles(): Tiles {
  return Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      return edge || (x === 11 && y !== 7) ? "wall_stone" : "floor_stone";
    }),
  );
}

function benchProps(door: "door_closed" | "door_open" = "door_closed"): PlacedProp[] {
  return [prop(door, 11, 7, "door"), prop("chest", 16, 3, "container")];
}

/**
 * A small dungeon laid the way the DM is taught: `wall_stone_top` along the
 * north edge, `wall_stone_base` along the south, plain `wall_stone` down the
 * sides and for the interior walls. It holds L corners, T junctions, a
 * crossing, a free-standing pillar, an east-west wall with a door in it, a
 * north-south wall with a door in it, and doorless gaps.
 */
const DUNGEON = [
  // 0123456789012345678 9
  "TTTTTTTTTTTTTT.TTTTT", // 0  north edge (_top), a doorless exit at x=14
  "#........#.........#", // 1
  "#........#.........#", // 2
  "#........d.........#", // 3  door in the north-south wall at (9,3)
  "#........#....#....#", // 4  free-standing pillar at (14,4)
  "#........#.........#", // 5
  "####d#####.........#", // 6  east-west wall with a door at (4,6); T at (0,6) and (9,6)
  "#........#......#..#", // 7  a north-south stub starts at (16,7)
  "#........#......#..#", // 8
  "#........#...######X", // 9  east-west wall (13..18) meeting the east edge in a T; crossing at (16,9); L corner at (13,9)
  ".........#...#..#..#", // 10 a doorless exit at (0,10)
  "#............#..#..#", // 11 a doorless gap at (9,11)
  "#........#...#.....#", // 12
  "#........#.........#", // 13
  "BBBBBBBBBBBBBBBBBBBB", // 14 south edge (_base)
];

function dungeon(): { tiles: Tiles; props: PlacedProp[] } {
  const props: PlacedProp[] = [];
  const tiles = DUNGEON.map((row, y) =>
    [...row].map((c, x) => {
      if (c === "T") return "wall_stone_top";
      if (c === "B") return "wall_stone_base";
      if (c === "#" || c === "X") return "wall_stone";
      if (c === "d") props.push(prop("door_closed", x, y));
      return "floor_stone";
    }),
  );
  props.push(prop("chest", 17, 11));
  return { tiles, props };
}

/** The sixteen base joins, spelled out here rather than read from the module under test. */
const JOINS = ["none", "n", "e", "ne", "s", "ns", "es", "nes", "w", "nw", "ew", "new", "sw", "nsw", "esw", "nesw"];

const JOIN_TILES = JOINS.map((j) => `wall_stone_join_${j}`);
const RUN_VARIANTS = ["wall_stone_join_ew_b", "wall_stone_join_ew_c", "wall_stone_join_ns_b", "wall_stone_join_ns_c"];
const JAMBS = "wall_stone_jambs_ns";
const LEAVES = ["door_closed_ns", "door_open_ns"];
/** The nineteen ids the gate requires. */
const REQUIRED = [...JOIN_TILES, JAMBS, ...LEAVES];

const FIELD_TILES = [
  "floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d",
  "wall_stone", "wall_stone_b", "wall_stone_c", "wall_stone_top", "wall_stone_base",
];
const PLAIN_PROPS = ["door_closed", "door_open", "chest"];

/** A manifest's membership tests: the ordinary art, the nineteen required ids, and the four run variants unless asked not to. */
function membership(drop: readonly string[] = [], variants = true) {
  const gone = new Set(drop);
  const tiles = new Set([...FIELD_TILES, ...JOIN_TILES, ...(variants ? RUN_VARIANTS : [])].filter((id) => !gone.has(id)));
  const props = new Set([...PLAIN_PROPS, JAMBS, ...LEAVES].filter((id) => !gone.has(id)));
  return { hasTile: (id: string) => tiles.has(id), hasProp: (id: string) => props.has(id) };
}

/** The join name an id stands for, with any run variant suffix stripped, or undefined for an id that is not a join. */
function joinNameOf(id: string): string | undefined {
  return id.startsWith("wall_stone_join_") ? id.slice("wall_stone_join_".length).replace(/_[bc]$/, "") : undefined;
}

/** `doorAt` for a props list, the way the pass builds it (ignoring the rule that a door standing on a wall tile does not count, which no cell here exercises). */
function doorAtFor(props: readonly PlacedProp[]): (x: number, y: number) => boolean {
  const cells = new Set(props.filter((p) => Object.hasOwn(RULE.doors, p.assetId)).map((p) => `${p.x},${p.y}`));
  return (x, y) => cells.has(`${x},${y}`);
}

function joinAt(tiles: Tiles, props: readonly PlacedProp[], x: number, y: number): string | undefined {
  return WALL_JOIN_BY_MASK[wallMaskAt(tiles, x, y, RULE, doorAtFor(props))];
}

function isWallId(id: string): boolean {
  return RULE.wall.includes(id);
}

/** Every join name drawn at a wall cell of a layout, by mask. */
function joinsOf(tiles: Tiles, props: readonly PlacedProp[]): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[y]!.length; x++) {
      if (isWallId(tiles[y]![x]!)) out.add(joinAt(tiles, props, x, y)!);
    }
  }
  return out;
}

function showWith(tiles: Tiles, props: readonly PlacedProp[], m = membership(), seed = 0): string[][] {
  return applyDisplayTiles(tiles, m.hasTile, seed, { props, hasProp: m.hasProp });
}

// ── 1. the mask table ─────────────────────────────────────────────────────

test("WALL_JOIN_BY_MASK names every one of the sixteen masks once, in n, e, s, w order", () => {
  assert.equal(WALL_JOIN_BY_MASK.length, 16);
  assert.equal(new Set(WALL_JOIN_BY_MASK).size, 16, "no two masks share a name");
  assert.equal(WALL_JOIN_BY_MASK[0], "none");
  assert.deepEqual([...WALL_JOIN_BY_MASK], JOINS, "the names the art is authored against");
  assert.deepEqual([WALL_N, WALL_E, WALL_S, WALL_W], [1, 2, 4, 8], "the same bit values terrainEdges uses");
  for (let mask = 1; mask < 16; mask++) {
    const sides = [WALL_N & mask ? "n" : "", WALL_E & mask ? "e" : "", WALL_S & mask ? "s" : "", WALL_W & mask ? "w" : ""].join("");
    assert.equal(WALL_JOIN_BY_MASK[mask], sides, `mask ${mask} is its joined sides`);
  }
  assert.deepEqual(
    Object.keys(WALL_JOIN_VARIANT_SUFFIXES).sort(),
    ["ew", "ns"],
    "only the two long-run shapes carry variants",
  );
});

// ── 2. what counts as wall ────────────────────────────────────────────────

test("the stone rule's wall list is every wall_stone variant plus the two courses, and no floor, cliff or bulkhead", () => {
  const set = VARIANT_SETS.find((s) => s.base === "wall_stone")!;
  for (const id of [...set.variants, "wall_stone", "wall_stone_top", "wall_stone_base"]) {
    assert.ok(RULE.wall.includes(id), `${id} is a stone wall`);
  }
  assert.equal(new Set(RULE.wall).size, RULE.wall.length, "no id listed twice");
  assert.deepEqual([...RULE.wall].sort(), ["wall_stone", "wall_stone_b", "wall_stone_base", "wall_stone_c", "wall_stone_top"]);
  for (const id of RULE.wall) assert.ok(!/^(floor_|cliff_|wall_bulkhead)/.test(id), `${id} is not a wall this rule may draw`);
});

test("no variant set names a render-only id, because a variant is something the DM could have placed", () => {
  for (const set of [...VARIANT_SETS, ...PROP_VARIANT_SETS]) {
    assert.ok(!isRenderOnlyAssetId(set.base), `${set.base} is a base the DM places`);
    for (const v of set.variants) assert.ok(!isRenderOnlyAssetId(v), `${set.base} must not scatter into ${v}`);
  }
});

// ── 3 to 5. the mask on real rooms ────────────────────────────────────────

test("a ring room: corners es, sw, ne, nw, ew along top and bottom, ns down the sides, and no arm leaves the grid", () => {
  const ring = (left: number, top: number, width: number, height: number) => {
    const walls: Array<[number, number]> = [];
    for (let x = left; x < left + width; x++) walls.push([x, top], [x, top + height - 1]);
    for (let y = top; y < top + height; y++) walls.push([left, y], [left + width - 1, y]);
    return gridWith(walls);
  };

  // A 6x5 ring drawn into a grid of exactly its own size, so every border cell
  // has nothing past it.
  const small = ring(0, 0, 6, 5).slice(0, 5).map((row) => row.slice(0, 6));
  const at = (x: number, y: number) => joinAt(small, [], x, y);
  assert.deepEqual([at(0, 0), at(5, 0), at(0, 4), at(5, 4)], ["es", "sw", "ne", "nw"], "the four corners");
  for (let x = 1; x <= 4; x++) assert.deepEqual([at(x, 0), at(x, 4)], ["ew", "ew"], `top and bottom at x=${x}`);
  for (let y = 1; y <= 3; y++) assert.deepEqual([at(0, y), at(5, y)], ["ns", "ns"], `sides at y=${y}`);
  for (let y = 0; y < 5; y++) assert.equal(wallMaskAt(small, 0, y, RULE, () => false) & WALL_W, 0, "the border column has no west arm");
  for (let x = 0; x < 6; x++) assert.equal(wallMaskAt(small, x, 0, RULE, () => false) & WALL_N, 0, "the top row has no north arm");

  // The same ring flush against the far corner of a full 20x15 grid: nothing
  // joins past the east or south edge either.
  const far = ring(W - 6, H - 5, 6, 5);
  const farAt = (x: number, y: number) => joinAt(far, [], x, y);
  assert.deepEqual([farAt(W - 6, H - 5), farAt(W - 1, H - 5), farAt(W - 6, H - 1), farAt(W - 1, H - 1)], ["es", "sw", "ne", "nw"]);
  for (let y = H - 5; y < H; y++) assert.equal(wallMaskAt(far, W - 1, y, RULE, () => false) & WALL_E, 0, "the east border has no east arm");
  for (let x = W - 6; x < W; x++) assert.equal(wallMaskAt(far, x, H - 1, RULE, () => false) & WALL_S, 0, "the bottom row has no south arm");
});

test("the bench resolves exactly as designed, and its door is side-on in the gap", () => {
  const tiles = benchTiles();
  const props = benchProps();
  const expected: Array<[number, number, string]> = [
    [0, 0, "es"], [5, 0, "ew"], [11, 0, "esw"], [19, 0, "sw"],
    [0, 7, "ns"], [11, 1, "ns"], [11, 6, "ns"], [11, 8, "ns"], [11, 13, "ns"],
    [0, 14, "ne"], [11, 14, "new"], [19, 14, "nw"],
  ];
  for (const [x, y, join] of expected) assert.equal(joinAt(tiles, props, x, y), join, `(${x},${y})`);

  const m = membership();
  assert.deepEqual(doorProfileFor(tiles, props[0]!, props, m.hasTile, m.hasProp), { jambs: JAMBS, leaf: "door_closed_ns" });

  // The pass draws what the mask says, cell by cell, and the single-cell
  // accessor agrees with the grid pass everywhere.
  const shown = showWith(tiles, props, m);
  const walls = { props, hasProp: m.hasProp };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isWallId(tiles[y]![x]!)) {
        assert.equal(wallProfileAt(tiles, x, y, m.hasTile, walls), undefined, `(${x},${y}) is not a wall`);
        continue;
      }
      assert.equal(joinNameOf(shown[y]![x]!), joinAt(tiles, props, x, y), `(${x},${y}) draws its join`);
      assert.equal(wallProfileAt(tiles, x, y, m.hasTile, walls), shown[y]![x], `(${x},${y}) single-cell accessor`);
    }
  }
});

test("the dungeon: junctions, a crossing, a pillar, and walls that run through a door", () => {
  const { tiles, props } = dungeon();
  const expected: Array<[number, number, string]> = [
    [16, 9, "nesw"], [0, 6, "nes"], [9, 6, "nsw"], [9, 0, "esw"], [13, 9, "es"], [14, 4, "none"],
    [16, 7, "s"], [16, 11, "n"], [0, 9, "n"], [0, 11, "s"],
    [9, 2, "ns"], // the wall above the door at (9,3) runs on into it
    [9, 4, "ns"], // and the one below it runs up to it
  ];
  for (const [x, y, join] of expected) assert.equal(joinAt(tiles, props, x, y), join, `(${x},${y})`);

  // The two doors: the one in the north-south wall is side-on, the one in the
  // east-west wall keeps today's front-view sprite.
  const m = membership();
  const door = (x: number, y: number) => props.find((p) => p.x === x && p.y === y)!;
  assert.deepEqual(doorProfileFor(tiles, door(9, 3), props, m.hasTile, m.hasProp), { jambs: JAMBS, leaf: "door_closed_ns" });
  assert.equal(doorProfileFor(tiles, door(4, 6), props, m.hasTile, m.hasProp), undefined);

  // Between the two fixtures every one of the sixteen shapes occurs, so none
  // of the sixteen sprites can be dropped.
  const seen = new Set([...joinsOf(benchTiles(), benchProps()), ...joinsOf(tiles, props)]);
  assert.deepEqual([...seen].sort(), [...JOINS].sort());
});

// ── 6. what a door joins ──────────────────────────────────────────────────

test("a door joins the walls either side of it; a bare gap and a one-sided door join nothing", () => {
  const north = [0, 1, 2, 3].map((y) => [5, y] as const);
  const south = [5, 6, 7, 8, 9].map((y) => [5, y] as const);
  const tiles = gridWith([...north, ...south]);
  const door = [prop("door_closed", 5, 4)];

  assert.equal(joinAt(tiles, door, 5, 3), "ns", "the wall above runs on into the door");
  assert.equal(joinAt(tiles, door, 5, 5), "ns", "and the wall below runs up to it");
  assert.equal(joinAt(tiles, [], 5, 3), "n", "with no door the same gap is a real end, facing south");
  assert.equal(joinAt(tiles, [], 5, 5), "s", "and the other side is the north end of its run");

  // A door with wall on only one side: nothing to join to.
  const oneSided = gridWith(north);
  assert.equal(joinAt(oneSided, door, 5, 3), "n", "the wall stops at a door with no wall beyond it");

  // Open or closed, a door joins alike.
  assert.equal(joinAt(tiles, [prop("door_open", 5, 4)], 5, 3), "ns");

  // Double doors: the second door counts as being on the wall line.
  const two = [prop("door_closed", 5, 4), prop("door_closed", 5, 5)];
  const doubled = gridWith([...north, ...[6, 7, 8, 9].map((y) => [5, y] as const)]);
  assert.equal(joinAt(doubled, two, 5, 3), "ns", "through a stacked pair");
  assert.equal(joinAt(doubled, two, 5, 6), "ns");
});

// ── 7 and 8. the gate, and what it may touch ──────────────────────────────

test("with all nineteen ids every wall cell becomes a join; with any ONE missing the walls draw as they did without the pass", () => {
  const scenes: Array<[string, Tiles, PlacedProp[]]> = [
    ["bench", benchTiles(), benchProps()],
    ["dungeon", dungeon().tiles, dungeon().props],
  ];
  for (const [name, tiles, props] of scenes) {
    const full = membership();
    const shown = showWith(tiles, props, full);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isWallId(tiles[y]![x]!)) assert.ok(shown[y]![x]!.startsWith("wall_stone_join_"), `${name} (${x},${y}) is a join`);
      }
    }

    assert.equal(REQUIRED.length, 19);
    for (const id of REQUIRED) {
      const m = membership([id]);
      assert.equal(wallProfilesActive(RULE, m.hasTile, m.hasProp), false, `the gate is off without ${id}`);
      assert.deepEqual(
        showWith(tiles, props, m),
        applyDisplayTiles(tiles, m.hasTile, 0),
        `${name}: without ${id} the pass draws exactly what the three-argument call draws`,
      );
    }

    // The variants are optional: losing one keeps the gate on and falls back to the base join.
    const noEwB = membership(["wall_stone_join_ew_b"]);
    assert.equal(wallProfilesActive(RULE, noEwB.hasTile, noEwB.hasProp), true);
    const shownNoEwB = showWith(tiles, props, noEwB);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isWallId(tiles[y]![x]!)) assert.ok(joinNameOf(shownNoEwB[y]![x]!) !== undefined, `${name} (${x},${y}) is still a join`);
        assert.notEqual(shownNoEwB[y]![x], "wall_stone_join_ew_b", "the missing sprite is never drawn");
      }
    }
  }
});

test("without the fourth argument the output is the old two-pass result, whatever the manifest holds", () => {
  const { tiles } = dungeon();
  const m = membership();
  assert.deepEqual(applyDisplayTiles(tiles, m.hasTile, 3), applyDisplayTiles(tiles, m.hasTile, 3, undefined));
  const bare = applyDisplayTiles(tiles, m.hasTile, 3);
  for (const row of bare) for (const id of row) assert.ok(!id.startsWith("wall_stone_join_"), "no join without the wall pass");
});

test("only wall cells change: everything else is what the three-argument call draws", () => {
  const scenes: Array<[Tiles, PlacedProp[]]> = [[benchTiles(), benchProps()], [dungeon().tiles, dungeon().props]];
  for (const [tiles, props] of scenes) {
    const m = membership();
    const withWalls = showWith(tiles, props, m, 5);
    const without = applyDisplayTiles(tiles, m.hasTile, 5);
    let changed = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isWallId(tiles[y]![x]!)) {
          changed++;
          assert.notEqual(withWalls[y]![x], without[y]![x], `(${x},${y}) is a wall and was redrawn`);
        } else {
          assert.equal(withWalls[y]![x], without[y]![x], `(${x},${y}) is not a wall and was left alone`);
        }
      }
    }
    assert.ok(changed > 0);
  }
});

test("applyWallProfiles reads the STORED grid for its masks, not the display grid it is handed", () => {
  const tiles = benchTiles();
  const m = membership();
  const walls = { props: benchProps(), hasProp: m.hasProp };
  // A display grid that has been scrambled: the answer must still follow `tiles`.
  const scrambled = tiles.map((row) => row.map(() => "floor_stone"));
  const out = applyWallProfiles(scrambled, tiles, m.hasTile, walls);
  assert.equal(joinNameOf(out[0]![0]!), "es");
  assert.equal(joinNameOf(out[7]![0]!), "ns");
  assert.equal(out[5]![5], "floor_stone", "a non-wall cell keeps the display grid's id");
  assert.notEqual(out, scrambled, "a copy, not the grid it was given");
});

// ── 9. variants along a run ───────────────────────────────────────────────

test("an east-west run scatters across its variants, stably, and falls back to the base join when they are absent", () => {
  const row = 7;
  const tiles = gridWith(Array.from({ length: W }, (_, x) => [x, row] as const));
  const m = membership();
  const shown = showWith(tiles, [], m);
  const run = Array.from({ length: 18 }, (_, i) => shown[row]![i + 1]!);

  assert.ok(run.every((id) => joinNameOf(id) === "ew"), "the interior of the run is all east-west joins");
  assert.ok(new Set(run).size >= 2, `an 18 long run must not be one sprite repeated: ${[...new Set(run)].join(", ")}`);
  assert.ok(run.every((id) => ["wall_stone_join_ew", "wall_stone_join_ew_b", "wall_stone_join_ew_c"].includes(id)));
  assert.deepEqual(showWith(tiles, [], m), shown, "the same cells pick the same variants on every call");
  assert.notDeepEqual(showWith(tiles, [], m, 1)[row], shown[row], "and the seed moves them");

  // The same hash over a list of the same length as the wall scatter: each cell
  // lands on the same index the wall face's own scatter would have chosen.
  const scattered = applyTileVariants(tiles, m.hasTile, 0);
  for (let x = 1; x <= 18; x++) {
    const faceSuffix = scattered[row]![x]!.replace("wall_stone", "");
    assert.equal(shown[row]![x], `wall_stone_join_ew${faceSuffix}`, `(${x},${row}) picks the face's own index`);
  }

  const bare = showWith(tiles, [], membership([], false));
  for (let x = 1; x <= 18; x++) assert.equal(bare[row]![x], "wall_stone_join_ew", "no variants in the manifest: every cell is the base join");

  // A north-south run does the same.
  const column = gridWith(Array.from({ length: H }, (_, y) => [4, y] as const));
  const down = showWith(column, [], m);
  const ids = new Set(Array.from({ length: H - 2 }, (_, i) => down[i + 1]![4]!));
  assert.ok(ids.size >= 2 && [...ids].every((id) => joinNameOf(id) === "ns"));
});

// ── 10. display only ──────────────────────────────────────────────────────

test("the pass never touches the stored layout", () => {
  const { tiles, props } = dungeon();
  const layout: CellLayout = { tiles, props, tokens: [], exits: [] };
  const before = JSON.stringify({ tiles: layout.tiles, props: layout.props });
  const m = membership();

  showWith(layout.tiles, layout.props, m);
  for (const p of layout.props) doorProfileFor(layout.tiles, p, layout.props, m.hasTile, m.hasProp);
  wallProfileAt(layout.tiles, 9, 2, m.hasTile, { props: layout.props, hasProp: m.hasProp });
  renderCell(recordingCtx().ctx, layout, manifestFor([]), 16);

  assert.equal(JSON.stringify({ tiles: layout.tiles, props: layout.props }), before);
});

// ── 11. the door rule ─────────────────────────────────────────────────────

test("doorProfileFor: side-on in a north-south wall, today's sprite everywhere else", () => {
  const m = membership();
  const profile = (tiles: Tiles, p: PlacedProp, props: readonly PlacedProp[] = [p]) =>
    doorProfileFor(tiles, p, props, m.hasTile, m.hasProp);

  // The bench's door, closed and open.
  const bench = benchTiles();
  assert.deepEqual(profile(bench, prop("door_closed", 11, 7)), { jambs: JAMBS, leaf: "door_closed_ns" });
  assert.deepEqual(profile(bench, prop("door_open", 11, 7)), { jambs: JAMBS, leaf: "door_open_ns" });

  // A door in an east-west wall keeps the front-view sprite.
  const eastWest = gridWith([[3, 5], [4, 5], [6, 5], [7, 5]]);
  assert.equal(profile(eastWest, prop("door_closed", 5, 5)), undefined);

  // At the very edge of the grid, between walls: side-on, with nothing past the edge.
  const edge = gridWith([[0, 3], [0, 5]]);
  assert.deepEqual(profile(edge, prop("door_closed", 0, 4)), { jambs: JAMBS, leaf: "door_closed_ns" });

  // A door nothing stands beside.
  assert.equal(profile(floorGrid(), prop("door_closed", 5, 5)), undefined, "free-standing");
  assert.equal(profile(gridWith([[5, 4]]), prop("door_closed", 5, 5)), undefined, "wall on one side only");

  // Walls on all four sides: not an opening in a run.
  const boxed = gridWith([[5, 4], [5, 6], [4, 5], [6, 5]]);
  assert.equal(profile(boxed, prop("door_closed", 5, 5)), undefined, "walls on four sides");

  // Wall on three sides is a T: still side-on, because east and west are not BOTH wall.
  const tee = gridWith([[5, 4], [5, 6], [6, 5]]);
  assert.deepEqual(profile(tee, prop("door_closed", 5, 5)), { jambs: JAMBS, leaf: "door_closed_ns" });

  // A door prop standing on a wall tile is a mistake, not a doorway.
  const onWall = gridWith([[5, 4], [5, 5], [5, 6]]);
  assert.equal(profile(onWall, prop("door_closed", 5, 5)), undefined, "standing on a wall tile");

  // A chest, and a prop whose name happens to be an Object property.
  assert.equal(profile(bench, prop("chest", 11, 7)), undefined);
  assert.equal(profile(bench, prop("constructor", 11, 7)), undefined);
  assert.equal(profile(bench, prop("toString", 11, 7)), undefined);

  // A stacked north-south double door: both are side-on.
  const pair = [prop("door_closed", 5, 4), prop("door_closed", 5, 5)];
  const stacked = gridWith([[5, 3], [5, 6]]);
  assert.deepEqual(profile(stacked, pair[0]!, pair), { jambs: JAMBS, leaf: "door_closed_ns" });
  assert.deepEqual(profile(stacked, pair[1]!, pair), { jambs: JAMBS, leaf: "door_closed_ns" });

  // A side-by-side pair in an east-west wall stays front-view.
  const sideBySide = [prop("door_closed", 5, 5), prop("door_closed", 6, 5)];
  const wide = gridWith([[4, 5], [7, 5]]);
  assert.equal(profile(wide, sideBySide[0]!, sideBySide), undefined);
});

test("doorProfileFor is undefined when ANY of the jambs, a leaf or a join is missing", () => {
  const bench = benchTiles();
  for (const id of REQUIRED) {
    const m = membership([id]);
    for (const door of ["door_closed", "door_open"]) {
      const p = prop(door, 11, 7);
      assert.equal(doorProfileFor(bench, p, [p], m.hasTile, m.hasProp), undefined, `${door} without ${id}`);
    }
  }
  // But the run variants are not part of the gate.
  const m = membership(RUN_VARIANTS);
  const p = prop("door_closed", 11, 7);
  assert.deepEqual(doorProfileFor(bench, p, [p], m.hasTile, m.hasProp), { jambs: JAMBS, leaf: "door_closed_ns" });
});

// ── 12. what renderCell paints ────────────────────────────────────────────

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

/** Palette index to colour: sixteen flat greys, so an index names a sprite unambiguously. */
const PALETTE = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).padStart(2, "0").repeat(3)}`);
const color = (index: number) => PALETTE[index]!;

// The placeholder art of the profiled scene. Each id gets its own palette index
// so the fills say which sprite painted them.
const FLOOR = 2;
const WALL = 3;
const JOIN = 4;
const DOOR_STORED = 5;
const DOOR_OPEN_STORED = 6;
const JAMB = 7;
const LEAF_CLOSED = 8;
const LEAF_OPEN = 9;
const CHEST = 10;

function solid(index: number): number[][] {
  return Array.from({ length: 16 }, () => Array<number>(16).fill(index));
}

function patch(index: number, rows: readonly [number, number], cols: readonly [number, number]): number[][] {
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (y >= rows[0] && y <= rows[1] && x >= cols[0] && x <= cols[1] ? index : -1)),
  );
}

/** Jambs: rows 0 to 1 and 14 to 15 opaque, the gap between them clear. */
function jambGrid(): number[][] {
  return Array.from({ length: 16 }, (_, y) => Array<number>(16).fill(y <= 1 || y >= 14 ? JAMB : -1));
}

/** A render manifest carrying the profiled art, less the ids in `drop`. */
function manifestFor(drop: readonly string[]): RenderManifest {
  const gone = new Set(drop);
  const tiles: Record<string, { pixels: number[][] }> = {};
  const props: Record<string, { pixels: number[][] }> = {};
  for (const id of ["floor_stone"]) tiles[id] = { pixels: solid(FLOOR) };
  for (const id of ["wall_stone", "wall_stone_b", "wall_stone_c", "wall_stone_top", "wall_stone_base"]) tiles[id] = { pixels: solid(WALL) };
  for (const id of [...JOIN_TILES, ...RUN_VARIANTS]) if (!gone.has(id)) tiles[id] = { pixels: solid(JOIN) };
  props.door_closed = { pixels: solid(DOOR_STORED) };
  props.door_open = { pixels: solid(DOOR_OPEN_STORED) };
  props.chest = { pixels: solid(CHEST) };
  if (!gone.has(JAMBS)) props[JAMBS] = { pixels: jambGrid() };
  if (!gone.has("door_closed_ns")) props.door_closed_ns = { pixels: patch(LEAF_CLOSED, [2, 13], [5, 10]) };
  if (!gone.has("door_open_ns")) props.door_open_ns = { pixels: patch(LEAF_OPEN, [9, 12], [6, 15]) };
  return { palette: PALETTE, tiles, props, tokens: {} };
}

const inTile = (f: RecordedFill, tx: number, ty: number) => f.x >= tx * 16 && f.x < (tx + 1) * 16 && f.y >= ty * 16 && f.y < (ty + 1) * 16;
const area = (fills: readonly RecordedFill[]) => fills.reduce((sum, f) => sum + f.width * f.height, 0);

test("renderCell paints a side-on door as its jambs on its own tile, rows 0 to 1 and 14 to 15, and THEN the leaf over them", () => {
  const layout: CellLayout = { tiles: benchTiles(), props: benchProps("door_closed"), tokens: [], exits: [] };
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layout, manifestFor([]), 16);

  const jambs = fills.filter((f) => f.color === color(JAMB));
  assert.ok(jambs.length > 0, "the jambs are painted");
  assert.ok(jambs.every((f) => inTile(f, 11, 7)), "and only on the door's own tile");
  assert.ok(jambs.every((f) => f.y - 7 * 16 <= 1 || f.y - 7 * 16 >= 14), "in their own rows, leaving the gap clear");
  assert.equal(area(jambs.filter((f) => f.y - 7 * 16 <= 1)), 2 * 16, "rows 0 and 1 are fully covered");

  const leaf = fills.filter((f) => f.color === color(LEAF_CLOSED));
  assert.ok(leaf.length > 0, "the leaf is painted");
  assert.ok(leaf.every((f) => inTile(f, 11, 7) && f.x - 11 * 16 >= 5 && f.x - 11 * 16 <= 10), "inside its own tile, in columns 5 to 10");
  assert.equal(area(leaf), 12 * 6, "rows 2 to 13 by columns 5 to 10");

  const lastJamb = Math.max(...jambs.map((f) => fills.indexOf(f)));
  const firstLeaf = Math.min(...leaf.map((f) => fills.indexOf(f)));
  assert.ok(lastJamb < firstLeaf, "the jambs go down first, the leaf over them");

  assert.equal(fills.filter((f) => f.color === color(DOOR_STORED)).length, 0, "the stored front-view door is not drawn as well");
  assert.equal(fills.filter((f) => f.color === color(WALL)).length, 0, "no wall cell is drawn as a front-face block");
  assert.ok(fills.some((f) => f.color === color(JOIN)), "they are all joins");
  assert.ok(fills.some((f) => f.color === color(CHEST)), "and the other props are untouched");
});

test("renderCell draws the open leaf folded against the south jamb, inside its own tile", () => {
  const layout: CellLayout = { tiles: benchTiles(), props: benchProps("door_open"), tokens: [], exits: [] };
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layout, manifestFor([]), 16);

  const leaf = fills.filter((f) => f.color === color(LEAF_OPEN));
  assert.ok(leaf.every((f) => inTile(f, 11, 7) && f.y - 7 * 16 >= 9 && f.y - 7 * 16 <= 12), "rows 9 to 12 of its own tile, the passage above it clear");
  assert.equal(area(leaf), 4 * 10, "rows 9 to 12 by columns 6 to 15");
  assert.equal(fills.filter((f) => f.color === color(DOOR_OPEN_STORED)).length, 0);
});

test("a door in an east-west wall still draws its stored sprite, and so does any door the pass cannot profile", () => {
  const { tiles, props } = dungeon();
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, { tiles, props, tokens: [], exits: [] }, manifestFor([]), 16);
  // (4,6) is in an east-west wall: front view. (9,3) is in a north-south wall: side-on.
  assert.ok(fills.filter((f) => f.color === color(DOOR_STORED)).every((f) => inTile(f, 4, 6)), "the stored door sprite is drawn only at (4,6)");
  assert.ok(fills.some((f) => f.color === color(DOOR_STORED) && inTile(f, 4, 6)));
  assert.ok(fills.some((f) => f.color === color(LEAF_CLOSED) && inTile(f, 9, 3)));
});

// The scene and the sprites of the snapshot below. The art is hashed from each
// id so every sprite is different and a swapped sprite shows.
function hashId(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function snapshotArt(id: string, transparent: boolean): number[][] {
  const h = hashId(id);
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (transparent && (x + y + h) % 3 === 0 ? -1 : 1 + ((x * 7 + y * 13 + h) % 9))),
  );
}

/** The old art, plus whichever render-only ids are asked for: with any one of the nineteen missing the pass must draw nothing new. */
function snapshotManifest(extraTiles: readonly string[], extraProps: readonly string[]): RenderManifest {
  const tileIds = ["floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d", "wall_stone", "wall_stone_b", "wall_stone_c", "wall_stone_top", "wall_stone_base"];
  const propIds = ["door_closed", "door_open", "chest"];
  const knight = snapshotArt("token_knight", true);
  return {
    palette: Array.from({ length: 12 }, (_, i) => `#${(i * 20).toString(16).padStart(2, "0")}${(i * 11).toString(16).padStart(2, "0")}${(i * 5).toString(16).padStart(2, "0")}`),
    tiles: Object.fromEntries([...tileIds, ...extraTiles].map((id) => [id, { pixels: snapshotArt(id, false) }])),
    props: Object.fromEntries([...propIds, ...extraProps].map((id) => [id, { pixels: snapshotArt(id, true) }])),
    tokens: { token_knight: { pixels: knight.concat(knight.slice(0, 8)) } },
  };
}

function snapshotDigest(manifest: RenderManifest): string {
  const tiles = benchTiles();
  const layout: CellLayout = {
    tiles,
    props: [prop("door_closed", 11, 7, "door"), prop("chest", 16, 3, "chest")],
    tokens: [{ id: "k", assetId: "token_knight", x: 4, y: 7, kind: "pc" }],
    exits: [],
  };
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layout, manifest, 16, 0);
  const rows = fills.map((f) => [f.x, f.y, f.width, f.height, f.color]);
  return `${fills.length}:${createHash("sha1").update(JSON.stringify(rows)).digest("hex")}`;
}

// Recorded from the renderer BEFORE the wall pass existed: 77398 fills of the
// bench with a manifest that has no wall profiles. If this fails, renderCell now
// draws something different for a manifest without the set, which is the one
// thing the gate promises it never does.
const NO_PROFILES_SNAPSHOT = "77398:82cdd2614e1690e9c45e4eb2e666520bee0be863";

test("a manifest without the set records exactly the fills the renderer recorded before the pass existed", () => {
  assert.equal(snapshotDigest(snapshotManifest([], [])), NO_PROFILES_SNAPSHOT);
});

test("and so does a manifest carrying every required id but one, however much of the rest it holds", () => {
  for (const missing of REQUIRED) {
    const tiles = [...JOIN_TILES, ...RUN_VARIANTS].filter((id) => id !== missing);
    const props = [JAMBS, ...LEAVES].filter((id) => id !== missing);
    assert.equal(snapshotDigest(snapshotManifest(tiles, props)), NO_PROFILES_SNAPSHOT, `without ${missing}`);
  }
  // The control: with all nineteen the bench draws something else, so the digest can tell.
  const full = snapshotDigest(snapshotManifest([...JOIN_TILES, ...RUN_VARIANTS], [JAMBS, ...LEAVES]));
  assert.notEqual(full, NO_PROFILES_SNAPSHOT);
});

// ── 13. the render-only ids, against the real art ─────────────────────────

test("RENDER_ONLY_ASSET_IDS is exactly the 23 profile ids, every one in the fantasy art with the right kind and walkability", () => {
  const expected = [...JOIN_TILES, ...RUN_VARIANTS, JAMBS, ...LEAVES];
  assert.equal(expected.length, 23);
  assert.deepEqual([...RENDER_ONLY_ASSET_IDS].sort(), [...expected].sort());
  for (const id of expected) assert.ok(isRenderOnlyAssetId(id), `${id} is render only`);
  for (const id of ["wall_stone", "wall_stone_top", "door_closed", "door_open", "floor_stone"]) assert.ok(!isRenderOnlyAssetId(id), `${id} is the DM's`);

  const art = new Map(FANTASY_SPRITES.map((s) => [s.assetId, s]));
  const missing = expected.filter((id) => !art.has(id));
  assert.deepEqual(missing, [], `fantasy.ts is missing profile sprites: ${missing.join(", ")}`);
  for (const id of [...JOIN_TILES, ...RUN_VARIANTS]) {
    assert.equal(art.get(id)!.kind, "tile", `${id} is a tile`);
    assert.equal(art.get(id)!.walkable, false, `${id} is not walkable`);
  }
  for (const id of [JAMBS, ...LEAVES]) assert.equal(art.get(id)!.kind, "prop", `${id} is a prop`);
  assert.equal(art.get(JAMBS)!.walkable, false);
  assert.equal(art.get("door_closed_ns")!.walkable, false, "a closed leaf blocks, like door_closed");
  assert.equal(art.get("door_open_ns")!.walkable, true, "an open leaf does not, like door_open");
  assert.equal(art.get("door_closed_ns")!.walkable, art.get("door_closed")!.walkable, "walkability parity with the stored door");
  assert.equal(art.get("door_open_ns")!.walkable, art.get("door_open")!.walkable);

  // The shipped art alone is a complete set: the gate is on for it.
  const hasTile = (id: string) => art.get(id)?.kind === "tile";
  const hasProp = (id: string) => art.get(id)?.kind === "prop";
  assert.equal(wallProfilesActive(RULE, hasTile, hasProp), true);
});
