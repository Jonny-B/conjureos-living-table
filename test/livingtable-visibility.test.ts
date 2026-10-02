/**
 * Line of sight and explored memory (world/visibility.ts), and the proof that
 * the game's own engine uses it: a closed door stops a look, a chest, a river
 * and an open door do not, and `getPlayspace` + `visibleTilesFrom` agree.
 *
 * Run: npx tsx --test test/livingtable-visibility.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL_HEIGHT,
  CELL_WIDTH,
  canSeeEachOther,
  decodeExplored,
  emptyExplored,
  emptyWorld,
  encodeExplored,
  getPlayspace,
  hasClearLine,
  isOpaqueAssetId,
  lineOfSightFor,
  mergeExplored,
  setCell,
  sightBlockers,
  visibilityStates,
  visibleFrom,
  visibleTilesFrom,
  type AssetManifest,
  type CellLayout,
} from "../src/games/livingtable/world";
import { adaptManifest } from "../src/games/livingtable/assets/manifestCache";
import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { PALETTE as SCIFI_PALETTE, SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";

const MANIFEST: AssetManifest = {
  tiles: { floor: { walkable: true }, wall: { walkable: false }, water: { walkable: false } },
  tokens: { hero: {}, goblin: {} },
  props: {
    door_closed: { blocks: true },
    door_open: { blocks: false },
    chest: { blocks: true },
    torch: { blocks: false },
  },
};

type Token = CellLayout["tokens"][number];
const hero = (x: number, y: number): Token => ({ id: "hero", assetId: "hero", x, y, kind: "pc" });

/** A walled 20x15 room, with `inner` extra tile ids standing inside it. */
function room(inner: ReadonlyArray<readonly [number, number, string]> = [], props: CellLayout["props"] = [], tokens: Token[] = []): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) => (x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1 ? "wall" : "floor")),
  );
  for (const [x, y, id] of inner) tiles[y]![x] = id;
  return { tiles, props, tokens, exits: [], sealed: true };
}

/** A wall across the room at x=10 (rows 1 to 13), the door square at (10,7) left floor for a prop. */
function divided(door: "door_closed" | "door_open" | null): CellLayout {
  const inner: [number, number, string][] = [];
  for (let y = 1; y < CELL_HEIGHT - 1; y++) inner.push([10, y, y === 7 ? "floor" : "wall"]);
  const props = door ? [{ id: "door-1", assetId: door, x: 10, y: 7 }] : [];
  return room(inner, props, [hero(4, 7)]);
}

const CELL = { cx: 0, cy: 0 };
function spaceOf(layout: CellLayout) {
  return getPlayspace(setCell(emptyWorld(), CELL, layout), CELL.cx, CELL.cy, MANIFEST)!;
}

/** An all-clear grid with `blocked` cells opaque. */
function grid(cols: number, rows: number, blocked: ReadonlyArray<readonly [number, number]> = []): boolean[][] {
  const g = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  for (const [x, y] of blocked) g[y]![x] = true;
  return g;
}

// ── what blocks sight ────────────────────────────────────────────────────

test("isOpaqueAssetId: walls, closed doors of both art sets and orientations, trees, buildings, pillars, crate stacks and pipe columns block", () => {
  for (const id of ["wall_stone", "wall_stone_top", "wall_bulkhead", "forest_canopy", "cliff_face", "wall_stone_join_nesw"]) {
    assert.equal(isOpaqueAssetId("tile", id, false), true, id);
  }
  for (const id of [
    "door_closed",
    "door_closed_ns",
    "door_airlock_closed",
    "wall_stone_jambs_ns",
    "tree",
    "tree_left",
    "cottage_nw",
    "cottage_s",
    "arch_jamb_w",
    "pillar_top",
    "pillar_base",
    "crate_stack_tl",
    "pipe_column_mid",
    "blast_door_ml",
  ]) {
    assert.equal(isOpaqueAssetId("prop", id, false), true, id);
  }
});

test("isOpaqueAssetId: water, the hazard field, chasms, chests, tables, open doors and the like do not block", () => {
  for (const id of ["water", "water_b", "water_edge_ns", "water_edge_grass_ise", "hazard_vent", "deckplate_hazard_edge_nesw", "chasm", "spike_pit"]) {
    assert.equal(isOpaqueAssetId("tile", id, false), false, id);
  }
  for (const id of ["floor_grass", "floor_stone", "cliff_top"]) assert.equal(isOpaqueAssetId("tile", id, true), false, id);
  for (const id of [
    "door_open",
    "door_open_ns",
    "door_airlock_open",
    "chest",
    "chest_open",
    "crate",
    "console",
    "console_bank_tl",
    "table_w",
    "bed_head",
    "bunk_tl",
    "fence_mid",
    "well_nw",
    "railing_mid",
    "torch",
    "cottage_door",
    "arch_passage",
    "stair_up_w",
  ]) {
    assert.equal(isOpaqueAssetId("prop", id, false), false, id);
  }
});

test("isOpaqueAssetId: a tile the list has no opinion on falls back to not-walkable, and a prop's walkable flag is ignored", () => {
  assert.equal(isOpaqueAssetId("tile", "mystery_slab", false), true);
  assert.equal(isOpaqueAssetId("tile", "mystery_slab", true), false);
  assert.equal(isOpaqueAssetId("prop", "chest", false), false, "a chest is not walkable and is not a screen");
});

test("sightBlockers: a closed door blocks, an open door does not, a chest does not, water does not, a wall does", () => {
  const layout = room(
    [[3, 3, "water"], [5, 5, "wall"]],
    [
      { id: "d1", assetId: "door_closed", x: 7, y: 2 },
      { id: "d2", assetId: "door_open", x: 8, y: 2 },
      { id: "c1", assetId: "chest", x: 9, y: 2 },
      { id: "t1", assetId: "torch", x: 10, y: 2 },
    ],
  );
  const opaque = sightBlockers(layout, MANIFEST);
  assert.equal(opaque.length, CELL_HEIGHT);
  assert.equal(opaque[0]!.length, CELL_WIDTH);
  assert.equal(opaque[2]![7], true, "closed door");
  assert.equal(opaque[2]![8], false, "open door");
  assert.equal(opaque[2]![9], false, "chest");
  assert.equal(opaque[2]![10], false, "torch");
  assert.equal(opaque[3]![3], false, "water");
  assert.equal(opaque[5]![5], true, "wall");
  assert.equal(opaque[0]![0], true, "the room's own wall ring");
  assert.equal(opaque[7]![7], false, "plain floor");
});

test("sightBlockers: a verdict the manifest carries wins over the id list, and a prop off the grid is ignored", () => {
  const manifest: AssetManifest = {
    tiles: { floor: { walkable: true }, wall: { walkable: false, opaque: false }, glass: { walkable: true, opaque: true } },
    tokens: {},
    props: { chest: { blocks: true, opaque: true } },
  };
  const layout = room([[3, 3, "wall"], [4, 3, "glass"]], [
    { id: "c1", assetId: "chest", x: 6, y: 3 },
    { id: "off", assetId: "chest", x: 99, y: 99 },
  ]);
  const opaque = sightBlockers(layout, manifest);
  assert.equal(opaque[3]![3], false, "a wall the manifest calls see-through");
  assert.equal(opaque[3]![4], true, "a walkable pane the manifest calls opaque");
  assert.equal(opaque[3]![6], true, "a chest the manifest calls opaque");
});

// ── the line itself ───────────────────────────────────────────────────────

test("hasClearLine: a wall row blocks, the wall itself is visible, an endpoint never blocks", () => {
  const g = grid(9, 9, [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4]]);
  assert.equal(hasClearLine(g, { x: 4, y: 1 }, { x: 4, y: 7 }), false, "a full wall row hides the far side");
  assert.equal(hasClearLine(g, { x: 4, y: 1 }, { x: 4, y: 4 }), true, "the wall square itself is seen");
  assert.equal(hasClearLine(g, { x: 4, y: 4 }, { x: 4, y: 1 }), true, "and standing in it is allowed");
  assert.equal(hasClearLine(g, { x: 2, y: 2 }, { x: 2, y: 2 }), true, "a square sees itself");
  assert.equal(hasClearLine(g, { x: 1, y: 1 }, { x: 7, y: 2 }), true, "same side of the wall");
});

test("hasClearLine: a diagonal step between two opaque squares is a crack, not a gap", () => {
  const crack = grid(7, 7, [[3, 2], [2, 3]]);
  assert.equal(hasClearLine(crack, { x: 2, y: 2 }, { x: 3, y: 3 }), false, "adjacent through the crack");
  assert.equal(hasClearLine(crack, { x: 1, y: 1 }, { x: 5, y: 5 }), false, "far through the crack");
  assert.equal(hasClearLine(crack, { x: 5, y: 5 }, { x: 1, y: 1 }), false, "and back the other way");

  const oneSide = grid(7, 7, [[3, 2]]);
  assert.equal(hasClearLine(oneSide, { x: 2, y: 2 }, { x: 3, y: 3 }), true, "one open side square is a real gap");
});

test("hasClearLine: the inside corner of a room is visible, though the only way to it is diagonal between two walls", () => {
  const walls: [number, number][] = [];
  for (let i = 0; i < 9; i++) walls.push([i, 0], [0, i]);
  const g = grid(9, 9, walls);
  assert.equal(hasClearLine(g, { x: 1, y: 1 }, { x: 0, y: 0 }), true);
  assert.equal(hasClearLine(g, { x: 5, y: 5 }, { x: 0, y: 0 }), true);
  assert.equal(visibleFrom(g, { x: 4, y: 4 })[0]![0], true);
});

test("sight is symmetric: no square is seen one way and not the other, across a cluttered room", () => {
  // A deterministic scatter of pillars, a short wall and a diagonal run.
  const blocked: [number, number][] = [[4, 4], [9, 3], [12, 8], [6, 10], [15, 5], [3, 9]];
  for (let i = 0; i < 6; i++) blocked.push([8 + i, 6 + i > 13 ? 13 : 6 + i]);
  for (let y = 2; y < 8; y++) blocked.push([17, y]);
  const g = grid(CELL_WIDTH, CELL_HEIGHT, blocked);
  let pairs = 0;
  for (let ay = 0; ay < CELL_HEIGHT; ay++) {
    for (let ax = 0; ax < CELL_WIDTH; ax++) {
      const fromA = visibleFrom(g, { x: ax, y: ay });
      for (let by = 0; by < CELL_HEIGHT; by++) {
        for (let bx = 0; bx < CELL_WIDTH; bx++) {
          pairs++;
          const forward = fromA[by]![bx]!;
          const backward = visibleFrom(g, { x: bx, y: by })[ay]![ax]!;
          assert.equal(forward, backward, `(${ax},${ay}) and (${bx},${by}) must agree`);
          assert.equal(canSeeEachOther(g, { x: ax, y: ay }, { x: bx, y: by }), forward);
        }
      }
    }
  }
  assert.equal(pairs, (CELL_WIDTH * CELL_HEIGHT) ** 2);
});

test("symmetry actually widens sight: a plain one-way Bresenham line has pairs it sees only one way, and the union covers them", () => {
  // Isolated pillars (no two touch, so the corner rule never fires and the only difference is the line itself).
  const g = grid(CELL_WIDTH, CELL_HEIGHT, [[4, 4], [9, 3], [12, 8], [6, 10], [15, 5], [3, 9], [8, 6], [10, 11], [13, 2], [17, 9]]);
  const oneWay = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
    const dx = Math.abs(b.x - a.x);
    const dy = -Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let err = dx + dy;
    let x = a.x;
    let y = a.y;
    while (x !== b.x || y !== b.y) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      if (x === b.x && y === b.y) break;
      if (g[y]![x]) return false;
    }
    return true;
  };
  let asymmetric = 0;
  for (let ay = 0; ay < CELL_HEIGHT; ay++) {
    for (let ax = 0; ax < CELL_WIDTH; ax++) {
      for (let by = 0; by < CELL_HEIGHT; by++) {
        for (let bx = 0; bx < CELL_WIDTH; bx++) {
          const a = { x: ax, y: ay };
          const b = { x: bx, y: by };
          const one = oneWay(a, b);
          const other = oneWay(b, a);
          if (one !== other) {
            asymmetric++;
            assert.equal(hasClearLine(g, a, b), true, "seen when either line is clear");
          }
          if (!one && !other) assert.equal(hasClearLine(g, a, b), false);
        }
      }
    }
  }
  assert.ok(asymmetric > 0, "the room has pairs a one-way line gets wrong, which is why the rule exists");
});

// ── explored memory ───────────────────────────────────────────────────────

test("emptyExplored defaults to the cell size and every square unseen", () => {
  const e = emptyExplored();
  assert.equal(e.length, CELL_WIDTH * CELL_HEIGHT);
  assert.ok(e.every((v) => v === 0));
  assert.equal(emptyExplored(4, 3).length, 12);
});

test("mergeExplored returns a NEW array and only ever adds", () => {
  const before = emptyExplored(4, 3);
  const visible = grid(4, 3).map((row) => row.map(() => false));
  visible[0]![1] = true;
  visible[2]![3] = true;
  const after = mergeExplored(before, visible);
  assert.notEqual(after, before);
  assert.ok(before.every((v) => v === 0), "the input is untouched");
  assert.equal(after[1], 1);
  assert.equal(after[2 * 4 + 3], 1);
  assert.equal(after.reduce((a, b) => a + b, 0), 2);

  const none = grid(4, 3).map((row) => row.map(() => false));
  assert.deepEqual([...mergeExplored(after, none)], [...after], "merging nothing forgets nothing");
});

test("visibilityStates: 2 in sight now, 1 seen before, 0 never seen", () => {
  const explored = emptyExplored(3, 2);
  explored[0] = 1; // (0,0) seen before
  explored[1] = 1; // (1,0) seen before and in sight now
  const visible = [
    [false, true, false],
    [false, false, true],
  ];
  const states = visibilityStates(visible, explored);
  assert.deepEqual([...states], [1, 2, 0, 0, 0, 2]);
});

test("encodeExplored and decodeExplored round-trip, and the string is compact", () => {
  const explored = emptyExplored();
  for (let i = 0; i < explored.length; i += 3) explored[i] = 1;
  explored[explored.length - 1] = 1;
  const text = encodeExplored(explored);
  assert.ok(text.length <= 52, `a 300 square room encodes in ${text.length} characters`);
  assert.deepEqual([...decodeExplored(text)], [...explored]);

  assert.deepEqual([...decodeExplored(encodeExplored(emptyExplored()))], [...emptyExplored()]);
  const small = emptyExplored(5, 3);
  small[0] = 1;
  small[14] = 1;
  assert.deepEqual([...decodeExplored(encodeExplored(small), 5, 3)], [...small]);
});

test("decodeExplored never throws: garbage is an empty memory, a short string leaves the rest unseen", () => {
  assert.deepEqual([...decodeExplored("%%% not base64 %%%")], [...emptyExplored()]);
  assert.deepEqual([...decodeExplored("")], [...emptyExplored()]);
  const one = decodeExplored(encodeExplored(Uint8Array.of(1, 0, 1)), 3, 1);
  assert.deepEqual([...one], [1, 0, 1]);
});

// ── the engine, end to end ────────────────────────────────────────────────

test("through getPlayspace and visibleTilesFrom: with the door CLOSED nothing past the divider shows except the door square", () => {
  const space = spaceOf(divided("door_closed"));
  assert.equal(space.opaque[7]![10], true, "the closed door is on the sight grid");
  assert.equal(space.walkable[7]![10], true, "while the tile under it stays walkable (the prop blocks the foot)");

  const seen = visibleTilesFrom(space, "hero");
  assert.ok(seen.some((t) => t.x === 10 && t.y === 7), "the door itself is seen");
  assert.ok(seen.some((t) => t.x === 10 && t.y === 3), "so is the face of the divider wall");
  assert.ok(seen.some((t) => t.x === 7 && t.y === 7), "and this side of the room");
  const beyond = seen.filter((t) => t.x > 10);
  assert.deepEqual(beyond, [], "nothing at all past the divider");
});

test("through getPlayspace and visibleTilesFrom: with the door OPEN the far room shows", () => {
  const space = spaceOf(divided("door_open"));
  assert.equal(space.opaque[7]![10], false);
  const seen = visibleTilesFrom(space, "hero");
  assert.ok(seen.some((t) => t.x === 15 && t.y === 7), "straight through the open door");
  assert.ok(seen.filter((t) => t.x > 10).length >= 5, "a wedge of the far room, not a single square");
  assert.ok(!seen.some((t) => t.x === 12 && t.y === 1), "but the wall still hides what the door's angle does not reach");
});

test("a doorway with no door at all is open, and the divider alone hides everything else", () => {
  const seen = visibleTilesFrom(spaceOf(divided(null)), "hero");
  assert.ok(seen.some((t) => t.x === 15 && t.y === 7));
});

test("a chest and a river in the way do not hide what is behind them", () => {
  const layout = room(
    [[8, 5, "water"], [8, 6, "water"], [8, 7, "water"], [8, 8, "water"], [8, 9, "water"]],
    [{ id: "c1", assetId: "chest", x: 6, y: 7 }],
    [hero(4, 7)],
  );
  const seen = visibleTilesFrom(spaceOf(layout), "hero");
  assert.ok(seen.some((t) => t.x === 14 && t.y === 7), "across the chest and the river");
});

test("lineOfSightFor agrees with visibleTilesFrom: a ranged shot through a closed door is refused, an open one is not", () => {
  const closed = lineOfSightFor(divided("door_closed"), MANIFEST);
  assert.equal(closed({ x: 4, y: 7 }, { x: 15, y: 7 }), false);
  assert.equal(closed({ x: 15, y: 7 }, { x: 4, y: 7 }), false, "and the other way round");
  assert.equal(closed({ x: 4, y: 7 }, { x: 10, y: 7 }), true, "the door square itself is in sight");

  const open = lineOfSightFor(divided("door_open"), MANIFEST);
  assert.equal(open({ x: 4, y: 7 }, { x: 15, y: 7 }), true);
  assert.equal(open({ x: 15, y: 7 }, { x: 4, y: 7 }), true);
});

// ── the real library, stamped by adaptManifest ────────────────────────────

test("adaptManifest stamps the sight flag on the real fantasy and sci-fi libraries", () => {
  const wireOf = (template: "fantasy" | "scifi", palette: unknown, sprites: readonly { assetId: string; kind: string; name: string; size: number; walkable: boolean; pixels: number[][] }[]) =>
    adaptManifest({
      template,
      palette,
      assets: sprites.map((s) => ({ assetId: s.assetId, kind: s.kind as "tile" | "token" | "prop", name: s.name, size: s.size, walkable: s.walkable, pixels: s.pixels })),
    } as Parameters<typeof adaptManifest>[0]);

  const fantasy = wireOf("fantasy", FANTASY_PALETTE, FANTASY_SPRITES).world;
  assert.equal(fantasy.tiles.wall_stone?.opaque, true);
  assert.equal(fantasy.tiles.forest_canopy?.opaque, true);
  assert.equal(fantasy.tiles.cliff_face?.opaque, true);
  assert.equal(fantasy.tiles.water?.opaque, false, "water is not walkable and is see-through");
  assert.equal(fantasy.tiles.water_edge_n?.opaque, false);
  assert.equal(fantasy.tiles.floor_grass?.opaque, false);
  assert.equal(fantasy.props.door_closed?.opaque, true);
  assert.equal(fantasy.props.door_open?.opaque, false);
  assert.equal(fantasy.props.chest?.opaque, false);
  assert.equal(fantasy.props.chest?.blocks, true, "a chest still stops a foot");
  assert.equal(fantasy.props.tree?.opaque, true);
  assert.equal(fantasy.props.cottage_nw?.opaque, true);
  assert.equal(fantasy.props.cottage_door?.opaque, false);
  assert.equal(fantasy.props.table_w?.opaque, false);
  assert.equal(fantasy.props.pillar_top?.opaque, true);

  const scifi = wireOf("scifi", SCIFI_PALETTE, SCIFI_SPRITES).world;
  assert.equal(scifi.tiles.wall_bulkhead?.opaque, true);
  assert.equal(scifi.tiles.hazard_vent?.opaque, false);
  assert.equal(scifi.props.door_airlock_closed?.opaque, true);
  assert.equal(scifi.props.door_airlock_open?.opaque, false);
  assert.equal(scifi.props.crate?.opaque, false);
  assert.equal(scifi.props.crate_stack_tl?.opaque, true);
  assert.equal(scifi.props.pipe_column_mid?.opaque, true);
  assert.equal(scifi.props.console?.opaque, false);
});

test("every tile in the real libraries is opaque exactly when it is not walkable, bar the named see-through ones", () => {
  const seeThrough = /^(water(_|$)|hazard_vent$|deckplate_hazard_edge_)/;
  for (const [template, palette, sprites] of [
    ["fantasy", FANTASY_PALETTE, FANTASY_SPRITES],
    ["scifi", SCIFI_PALETTE, SCIFI_SPRITES],
  ] as const) {
    const world = adaptManifest({
      template,
      palette,
      assets: sprites.map((s) => ({ assetId: s.assetId, kind: s.kind as "tile" | "token" | "prop", name: s.name, size: s.size, walkable: s.walkable, pixels: s.pixels })),
    } as Parameters<typeof adaptManifest>[0]).world;
    for (const [id, tile] of Object.entries(world.tiles)) {
      const expected = !tile.walkable && !seeThrough.test(id);
      assert.equal(tile.opaque, expected, `${template} tile ${id}`);
    }
  }
});
