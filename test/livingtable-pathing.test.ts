/**
 * Tests for the Living Table's pathfinding (src/games/livingtable/world/pathing.ts)
 * and the anchor floating numbers hang from (src/games/livingtable/render/anchors.ts).
 *
 * The thing this file defends is the gap the turn-based investigation found in
 * moveToken: it checks the DESTINATION square and charges the straight-line
 * distance, so a far tile walks straight through a wall. Pathing is how a
 * caller moves more than one square without ever doing that, and most of what
 * is tested here is a refusal: the move that must NOT be allowed.
 *
 * Run: npx tsx --test test/livingtable-pathing.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  approachTile,
  emptyWorld,
  exploreEconomy,
  fieldCostFt,
  getCell,
  getVisible,
  isDiagonalSqueeze,
  lineOfSightFor,
  moveToken,
  movementField,
  pathTo,
  reachableTiles,
  setCell,
  setDoorState,
  tileFreeFor,
  walkPath,
  type AssetManifest,
  type CellCoord,
  type CellLayout,
  type TileCoord,
  type World,
} from "../src/games/livingtable/world";
import { approachFootprint } from "../src/games/livingtable/world/pathing";
import { resetTurnEconomy } from "../src/games/livingtable/rules/actionEconomy";
import { tokenOrigin, type RenderManifest } from "../src/games/livingtable/render/canvasRenderer";
import { headAnchor } from "../src/games/livingtable/render/anchors";

const CELL: CellCoord = { cx: 0, cy: 0 };

const MANIFEST: AssetManifest = {
  tiles: { floor: { walkable: true }, wall: { walkable: false } },
  tokens: { hero: {}, goblin: {} },
  props: { door_closed: { blocks: true }, door_open: {}, chest: {} },
};

type Token = CellLayout["tokens"][number];
const hero = (x: number, y: number): Token => ({ id: "hero", assetId: "hero", x, y, kind: "pc" });
const goblin = (x: number, y: number, id = "gob"): Token => ({ id, assetId: "goblin", x, y, kind: "monster" });

/** A walled 20x15 room, with `walls` standing inside it as extra wall tiles. */
function room(walls: ReadonlyArray<readonly [number, number]> = [], tokens: Token[] = [], props: CellLayout["props"] = []): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) => (x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1 ? "wall" : "floor")),
  );
  for (const [x, y] of walls) tiles[y]![x] = "wall";
  return { tiles, props, tokens, exits: [], sealed: true };
}

const DIVIDER_X = 11;
const GAP_Y = 7;

/** The investigation's scene: a wall across the room at x=11 with one gap at y=7. */
function divided(tokens: Token[] = [], props: CellLayout["props"] = []): CellLayout {
  const walls: [number, number][] = [];
  for (let y = 1; y < CELL_HEIGHT - 1; y++) if (y !== GAP_Y) walls.push([DIVIDER_X, y]);
  return room(walls, tokens, props);
}

const worldOf = (layout: CellLayout): World => setCell(emptyWorld(), CELL, layout);
const at = (x: number, y: number): TileCoord => ({ x, y });
const adjacent = (a: TileCoord, b: TileCoord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;

// ── the premise: why a path is walked one square at a time ──────────────

test("premise: moveToken alone walks straight through a wall when handed a far tile", () => {
  // The reason walkPath exists. moveToken validates the destination square and
  // charges Chebyshev distance to it, and looks at nothing in between. If
  // moveToken is ever taught to refuse this, delete THIS test, not the
  // walkPath checks below: they are still the right way to walk a route.
  const layout = divided([hero(9, 3)]);
  const result = moveToken(worldOf(layout), 0, 0, "hero", at(13, 3), MANIFEST, resetTurnEconomy(30));
  assert.equal(result.ok, true, "the far tile is accepted, across the wall at x=11");
  if (result.ok) assert.equal(result.economy.movementRemaining, 10, "and charged as four squares, not the eight the walk really is");
});

// ── movementField ───────────────────────────────────────────────────────

test("a step costs 5 ft whichever way it goes: a diagonal is the same as a straight step", () => {
  const field = movementField(room([], [hero(2, 2)]), MANIFEST, "hero", at(2, 2), Infinity);
  assert.equal(fieldCostFt(field, at(2, 2)), 0, "standing where you are costs nothing");
  assert.equal(fieldCostFt(field, at(3, 2)), 5);
  assert.equal(fieldCostFt(field, at(3, 3)), 5, "Chebyshev distance: the game's own rule, so a diagonal is one step");
  assert.equal(fieldCostFt(field, at(5, 5)), 15);
  assert.equal(fieldCostFt(field, at(5, 3)), 15);
  assert.equal(fieldCostFt(field, at(2, 2 + 6)), 30);
});

test("the budget is the movement left: 30 ft reaches six squares out and not a seventh", () => {
  const field = movementField(room([], [hero(2, 2)]), MANIFEST, "hero", at(2, 2), 30);
  assert.equal(fieldCostFt(field, at(8, 2)), 30);
  assert.equal(fieldCostFt(field, at(9, 2)), undefined, "the seventh square is 35 ft. away");
  assert.equal(pathTo(field, at(9, 2)), null);
  for (const tile of field.reached) assert.ok(field.cost.get(`${tile.x},${tile.y}`)! <= 30);
});

test("a budget under one step reaches nothing but where you stand, and nonsense does not throw", () => {
  for (const budget of [0, 4, -10, Number.NaN]) {
    const field = movementField(room([], [hero(2, 2)]), MANIFEST, "hero", at(2, 2), budget);
    assert.deepEqual(field.reached, [at(2, 2)], `budget ${budget}`);
  }
  assert.deepEqual(movementField(room([], [hero(2, 2)]), MANIFEST, "hero", at(2, 2), 5).reached.length, 9, "exactly one step: yourself and the eight around you");
});

test("Infinity is explore mode: every reachable square, and the field is nearest first", () => {
  const field = movementField(room([], [hero(2, 2)]), MANIFEST, "hero", at(2, 2), Infinity);
  const interior = (CELL_WIDTH - 2) * (CELL_HEIGHT - 2);
  assert.equal(field.reached.length, interior, "the whole floor of the room");
  let last = -1;
  for (const tile of field.reached) {
    const cost = field.cost.get(`${tile.x},${tile.y}`)!;
    assert.ok(cost >= last, "reached lists the nearest squares first, so a UI can iterate it");
    last = cost;
  }
  assert.deepEqual(reachableTiles(field).length, interior - 1, "reachableTiles leaves the start out");
});

test("a wall stops the field: the far side of the room is reached through the gap, not through the wall", () => {
  const layout = divided([hero(9, 3)]);
  const field = movementField(layout, MANIFEST, "hero", at(9, 3), Infinity);
  // Eight squares to the gap and out to (13,3): 4 to (11,7), 4 back up. The
  // straight line is 4, which is what moveToken would have charged.
  assert.equal(fieldCostFt(field, at(13, 3)), 40);
  const path = pathTo(field, at(13, 3))!;
  assert.equal(path.length, 8);
  assert.ok(path.some((t) => t.x === DIVIDER_X && t.y === GAP_Y), "the only way across is the gap");
  let prev = at(9, 3);
  for (const step of path) {
    assert.ok(adjacent(prev, step), `${JSON.stringify(prev)} to ${JSON.stringify(step)} is one square`);
    assert.ok(tileFreeFor(layout, MANIFEST, step.x, step.y, "hero"), `no step lands in a wall: ${JSON.stringify(step)}`);
    prev = step;
  }
  assert.deepEqual(prev, at(13, 3));
});

test("the same wall with a 30 ft budget: the far side is out of reach this turn", () => {
  const field = movementField(divided([hero(9, 3)]), MANIFEST, "hero", at(9, 3), 30);
  assert.equal(pathTo(field, at(13, 3)), null);
  assert.ok(pathTo(field, at(11, 7)), "the gap itself is in reach (four squares)");
});

test("a closed door blocks the way and an open one does not", () => {
  const closed = divided([hero(9, 7)], [{ id: "door", assetId: "door_closed", x: DIVIDER_X, y: GAP_Y }]);
  const shut = movementField(closed, MANIFEST, "hero", at(9, 7), Infinity);
  assert.equal(pathTo(shut, at(13, 7)), null, "the gap is plugged: nothing east of the wall is reachable");
  assert.equal(fieldCostFt(shut, at(DIVIDER_X, GAP_Y)), undefined, "not even the door's own square");
  assert.ok(shut.reached.every((t) => t.x < DIVIDER_X));

  // The game's own door mutation, not a hand-edited prop: this is the swap a DM
  // turn performs, so the field must follow it.
  const opened = setDoorState(worldOf(closed), 0, 0, "door", "door_open", MANIFEST);
  assert.ok(opened.ok);
  const layout = getCell((opened as { ok: true; world: World }).world, CELL)!;
  const open = movementField(layout, MANIFEST, "hero", at(9, 7), Infinity);
  assert.equal(fieldCostFt(open, at(13, 7)), 20, "straight through the open door");
  assert.ok(pathTo(open, at(13, 7))!.some((t) => t.x === DIVIDER_X && t.y === GAP_Y));
});

test("a diagonal step may not squeeze between two walls that only touch at a corner", () => {
  // Walls at (5,4) and (4,5): the squares (4,4) and (5,5) face each other
  // across the seam where those two corners meet.
  const layout = room([[5, 4], [4, 5]], [hero(4, 4)]);
  assert.equal(isDiagonalSqueeze(layout, MANIFEST, at(4, 4), at(5, 5)), true);
  assert.equal(isDiagonalSqueeze(layout, MANIFEST, at(4, 4), at(4, 3)), false, "a straight step is never a squeeze");
  const field = movementField(layout, MANIFEST, "hero", at(4, 4), Infinity);
  assert.equal(fieldCostFt(field, at(5, 5)), 15, "round the corner, not through it: three steps, where the squeeze would be one");
});

test("one wall at a corner is not a squeeze: cutting past a single corner is allowed", () => {
  const layout = room([[5, 4]], [hero(4, 4)]);
  assert.equal(isDiagonalSqueeze(layout, MANIFEST, at(4, 4), at(5, 5)), false);
  const field = movementField(layout, MANIFEST, "hero", at(4, 4), Infinity);
  assert.equal(fieldCostFt(field, at(5, 5)), 5);
});

test("a closed door counts as terrain for the squeeze rule, a creature does not", () => {
  const door = room([[4, 5]], [hero(4, 4)], [{ id: "door", assetId: "door_closed", x: 5, y: 4 }]);
  assert.equal(isDiagonalSqueeze(door, MANIFEST, at(4, 4), at(5, 5)), true, "a wall and a closed door seal the seam like two walls");
  const friend = room([[4, 5]], [hero(4, 4), goblin(5, 4)]);
  assert.equal(isDiagonalSqueeze(friend, MANIFEST, at(4, 4), at(5, 5)), false, "standing next to someone never seals a diagonal");
  assert.equal(fieldCostFt(movementField(friend, MANIFEST, "hero", at(4, 4), Infinity), at(5, 5)), 5);
});

test("other creatures are obstacles: a goblin in a one-wide corridor seals it, and its own square is not reachable", () => {
  // A corridor along y=7 from x=2 to x=9: walls above and below.
  const walls: [number, number][] = [];
  for (let x = 1; x <= 10; x++) {
    walls.push([x, 6], [x, 8]);
  }
  walls.push([10, 7]);
  const corridor = room(walls, [hero(2, 7), goblin(6, 7)]);
  const field = movementField(corridor, MANIFEST, "hero", at(2, 7), Infinity);
  assert.equal(fieldCostFt(field, at(5, 7)), 15, "up to the goblin");
  assert.equal(fieldCostFt(field, at(6, 7)), undefined, "not onto it");
  assert.equal(fieldCostFt(field, at(7, 7)), undefined, "and not past it: you cannot walk through an enemy");
});

test("the mover's own square is never an obstacle to itself, and the field reads its token id", () => {
  const layout = room([], [hero(5, 5), goblin(6, 5)]);
  const asHero = movementField(layout, MANIFEST, "hero", at(5, 5), 5);
  assert.equal(fieldCostFt(asHero, at(6, 5)), undefined, "the goblin is in the way");
  // The same field asked from the goblin's side: the hero blocks IT.
  const asGoblin = movementField(layout, MANIFEST, "gob", at(6, 5), 5);
  assert.equal(fieldCostFt(asGoblin, at(5, 5)), undefined);
  assert.equal(fieldCostFt(asGoblin, at(7, 5)), 5);
});

test("building a field does not touch the layout it was given", () => {
  const layout = divided([hero(9, 3), goblin(14, 3)]);
  const before = JSON.stringify(layout);
  movementField(layout, MANIFEST, "hero", at(9, 3), Infinity);
  assert.equal(JSON.stringify(layout), before);
});

// ── pathTo ──────────────────────────────────────────────────────────────

test("pathTo excludes the start, is empty for the start itself and null for what is not in the field", () => {
  const field = movementField(room([], [hero(2, 2)]), MANIFEST, "hero", at(2, 2), Infinity);
  assert.deepEqual(pathTo(field, at(2, 2)), []);
  assert.deepEqual(pathTo(field, at(3, 2)), [at(3, 2)]);
  const long = pathTo(field, at(8, 2))!;
  assert.equal(long.length, 6);
  assert.deepEqual(long[5], at(8, 2));
  assert.notDeepEqual(long[0], at(2, 2), "the start is never in the list");
  assert.equal(pathTo(field, at(0, 0)), null, "a wall square");
  assert.equal(pathTo(field, at(40, 40)), null, "off the grid");
});

test("a returned path is a copy: editing it does not corrupt the field", () => {
  const field = movementField(room([], [hero(2, 2)]), MANIFEST, "hero", at(2, 2), Infinity);
  const path = pathTo(field, at(5, 2))!;
  path[0]!.x = 99;
  assert.deepEqual(pathTo(field, at(5, 2))![0], at(3, 2));
});

// ── approachTile ────────────────────────────────────────────────────────

test("approachTile: already in reach gives your own square back, at no cost", () => {
  const layout = room([], [hero(5, 5), goblin(6, 5)]);
  const field = movementField(layout, MANIFEST, "hero", at(5, 5), 30);
  assert.deepEqual(approachTile(field, at(6, 5), 1), at(5, 5));
});

test("approachTile: the cheapest square next to the target, on the near side, never the target's own", () => {
  const layout = room([], [hero(2, 5), goblin(8, 5)]);
  const field = movementField(layout, MANIFEST, "hero", at(2, 5), 30);
  const tile = approachTile(field, at(8, 5), 1)!;
  assert.deepEqual(tile, at(7, 5), "5 squares to walk, straight at it: the orthogonal square beats the two diagonal ones at the same cost");
  assert.equal(fieldCostFt(field, tile), 25);
  assert.notDeepEqual(tile, at(8, 5));
});

test("approachTile never answers with the target's own square, even when that square is walkable and the cheapest", () => {
  // Every other test aims at a creature, whose square is occupied and so never
  // in the field. Here the target is an empty square and then a chest (a prop
  // that does not block), so its own square IS in the field, and with a reach
  // of 0 it is the only square within reach: the filter is all that stands
  // between this answer and null.
  const open = room([], [hero(2, 5)]);
  const chest = room([], [hero(2, 5)], [{ id: "box", assetId: "chest", x: 8, y: 5 }]);
  for (const layout of [open, chest]) {
    const field = movementField(layout, MANIFEST, "hero", at(2, 5), Infinity);
    assert.equal(fieldCostFt(field, at(8, 5)), 30, "the target square can be walked onto");
    assert.equal(approachTile(field, at(8, 5), 0), null, "within 0 squares of it is standing on it, which is never the answer");
    assert.deepEqual(approachTile(field, at(8, 5), 1), at(7, 5), "within 1 is the near side, as ever");
  }
  // Standing ON the target (planning from a hypothetical square is allowed):
  // the answer is a square beside it, 5 ft. away, not the square you are on.
  const onIt = movementField(open, MANIFEST, "hero", at(8, 5), Infinity);
  const beside = approachTile(onIt, at(8, 5), 1)!;
  assert.ok(beside && adjacent(beside, at(8, 5)), "a neighbouring square");
  assert.equal(fieldCostFt(onIt, beside), 5);
});

test("approachTile: null when the target is out of reach this turn, and null when it is walled off", () => {
  const far = room([], [hero(2, 5), goblin(15, 5)]);
  assert.equal(approachTile(movementField(far, MANIFEST, "hero", at(2, 5), 30), at(15, 5), 1), null, "13 squares away on a 30 ft. budget");
  assert.ok(approachTile(movementField(far, MANIFEST, "hero", at(2, 5), Infinity), at(15, 5), 1), "but fine with no budget");

  // The goblin sits in a pocket of its own: walls all round, no square beside it.
  const pocket = room(
    [[14, 4], [15, 4], [16, 4], [14, 5], [16, 5], [14, 6], [15, 6], [16, 6]],
    [hero(2, 5), goblin(15, 5)],
  );
  assert.equal(approachTile(movementField(pocket, MANIFEST, "hero", at(2, 5), Infinity), at(15, 5), 1), null);
});

test("approachTile: a ranged attacker wants a square it can SEE from, and gets the cheapest one", () => {
  // Hero west of the wall, goblin east of it. A 16 tile bow reaches across the
  // room, but not through the wall: from (9,3) there is no line to (13,3).
  const layout = divided([hero(9, 3), goblin(13, 3)]);
  const sees = lineOfSightFor(layout, MANIFEST);
  assert.equal(sees(at(9, 3), at(13, 3)), false, "the wall is in the way where the hero stands");

  const field = movementField(layout, MANIFEST, "hero", at(9, 3), Infinity);
  const tile = approachTile(field, at(13, 3), 16, sees)!;
  assert.ok(tile, "somewhere has a line to it");
  assert.equal(sees(tile, at(13, 3)), true);
  // Cheapest, by brute force: nothing in reach and in sight costs less.
  const cost = fieldCostFt(field, tile)!;
  for (const other of field.reached) {
    const c = fieldCostFt(field, other)!;
    if (c < cost) assert.ok(!sees(other, at(13, 3)), `${JSON.stringify(other)} is cheaper and also sees it`);
  }
  // Without the sight test the answer is the square you already stand on: the
  // difference IS the sight rule.
  assert.deepEqual(approachTile(field, at(13, 3), 16), at(9, 3));
});

// ── approachFootprint: one thing drawn in several squares (a well, a cottage) ──

const WELL = [at(8, 5), at(9, 5), at(8, 6), at(9, 6)];
const wellProps = WELL.map((t, i) => ({ id: `well-${i}`, assetId: "door_closed", x: t.x, y: t.y }));

test("approachFootprint: a single square is exactly approachTile", () => {
  const layout = room([], [hero(2, 5), goblin(8, 5)]);
  const field = movementField(layout, MANIFEST, "hero", at(2, 5), 30);
  assert.deepEqual(approachFootprint(field, [at(8, 5)], 1), approachTile(field, at(8, 5), 1));
});

test("approachFootprint: the nearest square of the whole footprint wins, on the near side, never inside it", () => {
  // The hero is west of a 2x2 well and level with its south half.
  const layout = room([], [hero(2, 6)], wellProps);
  const field = movementField(layout, MANIFEST, "hero", at(2, 6), Infinity);
  const spot = approachFootprint(field, WELL, 1)!;
  assert.deepEqual(spot, at(7, 6), "five squares east, beside the south-west part: the west edge is the near side");
  assert.ok(!WELL.some((t) => t.x === spot.x && t.y === spot.y), "never a square of the thing");
  assert.equal(fieldCostFt(field, spot), 25);
  // Coming from the east instead, the other side is nearer.
  const east = movementField(room([], [hero(14, 5)], wellProps), MANIFEST, "hero", at(14, 5), Infinity);
  assert.deepEqual(approachFootprint(east, WELL, 1), at(10, 5));
});

test("approachFootprint: already beside any part of it gives your own square back at no cost", () => {
  const layout = room([], [hero(7, 6)], wellProps);
  const field = movementField(layout, MANIFEST, "hero", at(7, 6), 30);
  assert.deepEqual(approachFootprint(field, WELL, 1), at(7, 6));
});

test("approachFootprint: null when no square beside it is in the field (out of budget, or walled in)", () => {
  const far = movementField(room([], [hero(1, 1)], wellProps), MANIFEST, "hero", at(1, 1), 10);
  assert.equal(approachFootprint(far, WELL, 1), null, "too far for 10 ft");
  const ring = [];
  for (let y = 4; y <= 7; y++) for (let x = 7; x <= 10; x++) if (x === 7 || x === 10 || y === 4 || y === 7) ring.push([x, y] as const);
  const sealed = movementField(room(ring, [hero(2, 5)], wellProps), MANIFEST, "hero", at(2, 5), Infinity);
  assert.equal(approachFootprint(sealed, WELL, 1), null);
  assert.equal(approachFootprint(far, [], 1), null, "an empty footprint has nowhere to approach");
});

test("approachFootprint: a ranged reach wants a line to the nearest part of the footprint", () => {
  const layout = divided([hero(9, 3)], [{ id: "t", assetId: "chest", x: 13, y: 3 }, { id: "t2", assetId: "chest", x: 13, y: 4 }]);
  const sees = lineOfSightFor(layout, MANIFEST);
  const field = movementField(layout, MANIFEST, "hero", at(9, 3), Infinity);
  const spot = approachFootprint(field, [at(13, 3), at(13, 4)], 16, sees)!;
  assert.ok(spot);
  assert.ok(sees(spot, at(13, 3)) || sees(spot, at(13, 4)));
});

test("lineOfSightFor agrees with the game's own getVisible, wall for wall", () => {
  const layout = divided([hero(9, 3), goblin(13, 3)], [{ id: "door", assetId: "door_closed", x: DIVIDER_X, y: GAP_Y }]);
  const world = worldOf(layout);
  const seen = new Set(getVisible(world, 0, 0, "hero", MANIFEST).map((t) => `${t.x},${t.y}`));
  const sees = lineOfSightFor(layout, MANIFEST);
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      assert.equal(sees(at(9, 3), at(x, y)), seen.has(`${x},${y}`), `(${x},${y})`);
    }
  }
});

// ── walkPath ────────────────────────────────────────────────────────────

test("walkPath walks a found path to the end, spending 5 ft a step", () => {
  const layout = divided([hero(9, 3)]);
  const field = movementField(layout, MANIFEST, "hero", at(9, 3), Infinity);
  const path = pathTo(field, at(13, 3))!;
  const result = walkPath(worldOf(layout), "hero", path, CELL, MANIFEST, resetTurnEconomy(60));
  assert.equal(result.complete, true);
  assert.equal(result.refusal, null);
  assert.deepEqual(result.steps, path, "every square, in order");
  assert.equal(result.economy.movementRemaining, 60 - 5 * path.length);
  const here = getCell(result.world, CELL)!.tokens.find((t) => t.id === "hero")!;
  assert.deepEqual({ x: here.x, y: here.y }, at(13, 3));
});

test("walkPath stops at a wall: what was walked stays walked, and the wall is reported", () => {
  const layout = divided([hero(9, 3)]);
  const result = walkPath(worldOf(layout), "hero", [at(10, 3), at(11, 3), at(12, 3)], CELL, MANIFEST, resetTurnEconomy(30));
  assert.equal(result.complete, false);
  assert.deepEqual(result.steps, [at(10, 3)]);
  assert.match(result.refusal!, /not walkable/);
  const here = getCell(result.world, CELL)!.tokens.find((t) => t.id === "hero")!;
  assert.deepEqual({ x: here.x, y: here.y }, at(10, 3), "stopped in front of the wall, not behind it");
  assert.equal(result.economy.movementRemaining, 25, "one step paid for, no more");
});

test("walkPath never hands moveToken a far tile: a square that is not next to the last is refused", () => {
  const layout = divided([hero(9, 3)]);
  const result = walkPath(worldOf(layout), "hero", [at(13, 3)], CELL, MANIFEST, resetTurnEconomy(30));
  assert.equal(result.complete, false);
  assert.deepEqual(result.steps, []);
  assert.match(result.refusal!, /not next to/);
  const here = getCell(result.world, CELL)!.tokens.find((t) => t.id === "hero")!;
  assert.deepEqual({ x: here.x, y: here.y }, at(9, 3), "the hero did not cross the wall");
  assert.equal(result.economy.movementRemaining, 30);
  // A repeated square is refused for the same reason: it is not one step away.
  assert.match(walkPath(worldOf(layout), "hero", [at(9, 3)], CELL, MANIFEST, resetTurnEconomy(30)).refusal!, /not next to/);
  // And a path with a hole in it stops at the hole.
  const gap = walkPath(worldOf(layout), "hero", [at(10, 3), at(10, 5)], CELL, MANIFEST, resetTurnEconomy(30));
  assert.deepEqual(gap.steps, [at(10, 3)]);
});

test("walkPath stops when the movement runs out, and says so", () => {
  const layout = room([], [hero(2, 2)]);
  const result = walkPath(worldOf(layout), "hero", [at(3, 2), at(4, 2), at(5, 2), at(6, 2)], CELL, MANIFEST, resetTurnEconomy(10));
  assert.deepEqual(result.steps, [at(3, 2), at(4, 2)]);
  assert.equal(result.complete, false);
  assert.match(result.refusal!, /movement/);
  assert.equal(result.economy.movementRemaining, 0);
});

// ── exploring: a walk that is longer than one turn's speed ──────────────

test("explore mode: a 12 square walk completes with exploreEconomy, and the movement never runs out", () => {
  const layout = room([], [hero(2, 7)]);
  const field = movementField(layout, MANIFEST, "hero", at(2, 7), Infinity);
  const path = pathTo(field, at(14, 7))!;
  assert.equal(path.length, 12, "twice what a 30 ft. turn pays for");
  const result = walkPath(worldOf(layout), "hero", path, CELL, MANIFEST, exploreEconomy());
  assert.equal(result.complete, true);
  assert.equal(result.refusal, null);
  assert.deepEqual(result.steps, path, "every square, in order");
  assert.equal(result.economy.movementRemaining, Infinity, "still unlimited at the far end");
  const here = getCell(result.world, CELL)!.tokens.find((t) => t.id === "hero")!;
  assert.deepEqual({ x: here.x, y: here.y }, at(14, 7));
});

test("explore mode: the long way round a wall, 16 squares through the gap, is walked in one go", () => {
  const layout = divided([hero(2, 3)]);
  const field = movementField(layout, MANIFEST, "hero", at(2, 3), Infinity);
  const path = pathTo(field, at(18, 3))!;
  assert.equal(path.length, 16, "9 squares to the gap and 7 back up the far side");
  const result = walkPath(worldOf(layout), "hero", path, CELL, MANIFEST, exploreEconomy());
  assert.equal(result.complete, true);
  assert.deepEqual(result.steps, path);
});

test("exploreEconomy is a full economy with endless movement, and walks do not spend its actions", () => {
  assert.deepEqual(exploreEconomy(), { action: true, bonusAction: true, reaction: true, movementRemaining: Infinity });
  const layout = room([], [hero(2, 7)]);
  const result = walkPath(worldOf(layout), "hero", [at(3, 7), at(4, 7)], CELL, MANIFEST, exploreEconomy());
  assert.deepEqual(result.economy, exploreEconomy());
  assert.notEqual(exploreEconomy(), exploreEconomy(), "a new object each time, so nobody shares one");
});

test("explore mode still stops at a wall: only the movement limit is lifted", () => {
  const layout = divided([hero(9, 3)]);
  const result = walkPath(worldOf(layout), "hero", [at(10, 3), at(11, 3), at(12, 3)], CELL, MANIFEST, exploreEconomy());
  assert.deepEqual(result.steps, [at(10, 3)]);
  assert.match(result.refusal!, /not walkable/);
});

test("why exploreEconomy exists: resetTurnEconomy refuses Infinity, and a finite economy ends the walk at its speed", () => {
  assert.throws(() => resetTurnEconomy(Infinity), /non-negative number of feet/, "a speed is a real figure, so this stays strict");
  const layout = room([], [hero(2, 7)]);
  const path = pathTo(movementField(layout, MANIFEST, "hero", at(2, 7), Infinity), at(14, 7))!;
  const result = walkPath(worldOf(layout), "hero", path, CELL, MANIFEST, resetTurnEconomy(30));
  assert.equal(result.complete, false);
  assert.equal(result.steps.length, 6, "30 ft. is six squares");
  assert.match(result.refusal!, /movement/);
});

test("walkPath stops at a closed door, a creature, and a diagonal squeeze", () => {
  const door = room([], [hero(9, 7)], [{ id: "door", assetId: "door_closed", x: 10, y: 7 }]);
  const atDoor = walkPath(worldOf(door), "hero", [at(10, 7)], CELL, MANIFEST, resetTurnEconomy(30));
  assert.match(atDoor.refusal!, /blocked by prop/);

  const crowd = room([], [hero(9, 7), goblin(10, 7)]);
  const atGoblin = walkPath(worldOf(crowd), "hero", [at(10, 7)], CELL, MANIFEST, resetTurnEconomy(30));
  assert.match(atGoblin.refusal!, /occupied/);

  const seam = room([[5, 4], [4, 5]], [hero(4, 4)]);
  const squeeze = walkPath(worldOf(seam), "hero", [at(5, 5)], CELL, MANIFEST, resetTurnEconomy(30));
  assert.match(squeeze.refusal!, /squeeze/);
  assert.deepEqual(squeeze.steps, []);
  // moveToken alone would have allowed that one (it only looks at (5,5)): the
  // diagonal rule lives in the pathing layer, and walkPath is where it bites.
  assert.equal(moveToken(worldOf(seam), 0, 0, "hero", at(5, 5), MANIFEST, resetTurnEconomy(30)).ok, true);
});

test("walkPath on a token that is not there, or an empty path, changes nothing", () => {
  const layout = room([], [hero(2, 2)]);
  const world = worldOf(layout);
  const missing = walkPath(world, "nobody", [at(3, 2)], CELL, MANIFEST, resetTurnEconomy(30));
  assert.equal(missing.complete, false);
  assert.match(missing.refusal!, /no token/);
  const none = walkPath(world, "hero", [], CELL, MANIFEST, resetTurnEconomy(30));
  assert.equal(none.complete, true, "no squares to walk is walked");
  assert.equal(none.world, world);
  assert.equal(walkPath(emptyWorld(), "hero", [at(3, 2)], CELL, MANIFEST, resetTurnEconomy(30)).complete, false, "no such cell");
});

test("walkPath does not mutate the world it was given", () => {
  const layout = room([], [hero(2, 2)]);
  const world = worldOf(layout);
  walkPath(world, "hero", [at(3, 2), at(4, 2)], CELL, MANIFEST, resetTurnEconomy(30));
  const here = getCell(world, CELL)!.tokens.find((t) => t.id === "hero")!;
  assert.deepEqual({ x: here.x, y: here.y }, at(2, 2));
});

// ── render/anchors.ts ───────────────────────────────────────────────────

/** A render manifest with only the bits headAnchor reads: three tokens of three heights. */
function renderManifest(spriteSize?: number): Pick<RenderManifest, "tokens" | "spriteSize"> {
  const grid = (w: number, h: number) => Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
  const s = spriteSize ?? 16;
  return {
    ...(spriteSize !== undefined ? { spriteSize } : {}),
    tokens: {
      goblin: { pixels: grid(s, s) }, // one tile tall
      hero: { pixels: grid(s, s + s / 2) }, // a tile and a half tall: the 24 on a 16 grid, the 48 on a 32 one
    },
  };
}

test("headAnchor: the top centre of a figure, above the head", () => {
  const layout = room([], [hero(3, 4), goblin(7, 4)]);
  // 16 px art at 32 px a tile: a 24 tall hero stands 48 canvas px tall, feet on the tile.
  const manifest = renderManifest();
  const h = headAnchor(layout, "hero", manifest, 32)!;
  assert.deepEqual(h, { x: 3 * 32 + 16, y: (4 + 1) * 32 - 48 }, "centred on the tile, at the top of the sprite");
  assert.equal(h.y, tokenOrigin(at(3, 4), 24, 32, 16).y, "built on tokenOrigin, so it moves when the renderer's anchor does");
  // A figure exactly one tile tall is anchored at the top of its own tile.
  assert.deepEqual(headAnchor(layout, "gob", manifest, 32), { x: 7 * 32 + 16, y: 4 * 32 });
});

test("headAnchor reads the library's resolution: 32 px art is the same figure at the same place", () => {
  const layout = room([], [hero(3, 4)]);
  assert.deepEqual(headAnchor(layout, "hero", renderManifest(32), 32), headAnchor(layout, "hero", renderManifest(), 32));
  // At a different tile scale it scales with the board.
  assert.deepEqual(headAnchor(layout, "hero", renderManifest(32), 64), { x: 3 * 64 + 32, y: 5 * 64 - 96 });
});

test("headAnchor: an unknown token is null, a token with no sprite falls back to the top of its tile", () => {
  const layout = room([], [hero(3, 4), goblin(7, 4, "gob")]);
  assert.equal(headAnchor(layout, "nobody", renderManifest(), 32), null);
  const noArt = { tokens: {} };
  assert.deepEqual(headAnchor(layout, "hero", noArt, 32), { x: 3 * 32 + 16, y: 4 * 32 });
});

test("headAnchor is not clamped: a tall figure on the top row reports a point above the canvas", () => {
  // Honest arithmetic, and the caller's call whether to clip or to nudge the
  // number inside (the overlay does the clipping).
  const layout = room([], [hero(3, 0)]);
  const anchor = headAnchor(layout, "hero", renderManifest(), 32)!;
  assert.equal(anchor.y, 32 - 48);
  assert.ok(anchor.y < 0);
});
