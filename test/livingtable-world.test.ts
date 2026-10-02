/**
 * Tests for the Living Table's coordinate/perception/manipulation engine
 * (src/games/livingtable/world/). This is the module that has to make "no
 * floating props, no tokens in walls, exits that lead somewhere" true by
 * construction, so most of what's tested here is a rejection: the thing that
 * must NOT be allowed to happen quietly.
 *
 * Run: npx tsx --test test/livingtable-world.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL_HEIGHT,
  CELL_WIDTH,
  assembleCell,
  buildCombatGeometry,
  checkAttackReach,
  combatGeometryFrom,
  emptyWorld,
  exitToNeighbour,
  getCell,
  getOffscreenCells,
  getPlayspace,
  getVisible,
  markPropSearched,
  moveToken,
  placeToken,
  removeToken,
  setCell,
  setDoorState,
  setTokenHp,
  sightBlockers,
  tileFreeFor,
  tileDistance,
  type AssetManifest,
  type CellLayout,
  type World,
} from "../src/games/livingtable/world";
import { resetTurnEconomy } from "../src/games/livingtable/rules/actionEconomy";
import { applyWorldAction } from "../src/games/livingtable/session/applyWorldAction";
import type { WorldAction } from "../src/games/livingtable/dm/turnSchema";
import { validateGeneratedCampaign } from "../src/games/livingtable/campaignGenerator";
import { coerceRegionSketch, regionHints } from "../src/games/livingtable/types";

const MANIFEST: AssetManifest = {
  tiles: { floor: { walkable: true }, wall: { walkable: false } },
  tokens: { hero: {}, goblin: {} },
  // `blocks` is the per-prop flag walkableAt now consults: a closed door is a
  // real obstruction, an open one isn't, and a chest is something you stand
  // beside rather than on. Before this flag existed setDoorState was a sprite
  // swap with no mechanical effect at all.
  props: { chest: { blocks: true }, door_closed: { blocks: true }, door_open: {}, torch: {} },
};

/**
 * A blank, all-floor 20x15 layout with nothing on it -- the starting point
 * every test mutates from. `sealed` is set because a layout with no exits at
 * all is now a rejection (a room nothing can ever walk out of), and this
 * fixture deliberately declares none; the tests that care about exits push
 * their own, and `sealed` only ever waives the zero-exit check, it never adds
 * or removes an exit.
 */
function blankLayout(): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor"));
  return { tiles, props: [], tokens: [], exits: [], sealed: true };
}

/** A blank layout WITHOUT the sealed waiver -- for the tests that exercise the zero-exit rule itself. */
function unsealedLayout(): CellLayout {
  const layout = blankLayout();
  delete layout.sealed;
  return layout;
}

/** A 20x15 room with a solid wall border and floor inside: the shape a DM actually draws, and the shape that used to make a staked opening land on a wall. */
function borderedRoom(): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) =>
      x === 0 || x === CELL_WIDTH - 1 || y === 0 || y === CELL_HEIGHT - 1 ? "wall" : "floor",
    ),
  );
  return { tiles, props: [], tokens: [], exits: [] };
}

test("assembling a cell rejects a token standing on a non-walkable tile", () => {
  const layout = blankLayout();
  layout.tiles[3]![5] = "wall";
  layout.tokens.push({ id: "t1", assetId: "hero", x: 5, y: 3, kind: "pc" });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /not on a walkable tile/);
});

test("assembling a cell rejects a prop placed out of bounds", () => {
  const layout = blankLayout();
  layout.props.push({ id: "p1", assetId: "chest", x: CELL_WIDTH, y: 2 });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /out of bounds/);
});

test("assembling a cell rejects a prop at a FRACTIONAL coordinate (a literal floating prop)", () => {
  // A prop has no walkability check by design (a statue in a wall alcove is a
  // normal placement), so unlike a token or exit it isn't accidentally caught
  // by an array-index lookup returning undefined on a non-integer index.
  // inBounds() has to reject this on its own, or a prop renders between four
  // tiles instead of on one -- exactly the failure mode this module exists to
  // rule out.
  const layout = blankLayout();
  layout.props.push({ id: "p1", assetId: "chest", x: 5.5, y: 2.25 });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /out of bounds/);
});

test("assembling a cell rejects an exit whose position doesn't match its declared edge", () => {
  const layout = blankLayout();
  // Claims to be an east exit but sits nowhere near x=19.
  layout.exits.push({ at: { x: 4, y: 4 }, edge: "E", toCell: { cx: 1, cy: 0 } });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /boundary/);
});

test("assembling a cell rejects an exit whose toCell isn't the true geometric neighbour for its edge", () => {
  const layout = blankLayout();
  // Sits correctly on the east boundary (edge and position agree), but
  // toCell names the SOUTH neighbour of (0,0), not the east one.
  layout.exits.push({ at: { x: CELL_WIDTH - 1, y: 5 }, edge: "E", toCell: { cx: 0, cy: 1 } });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /true neighbour is \(1,0\)/);
});

test("assembling a cell rejects an exit whose toCell points at a non-adjacent, distant cell", () => {
  const layout = blankLayout();
  layout.exits.push({ at: { x: CELL_WIDTH - 1, y: 5 }, edge: "E", toCell: { cx: 7, cy: 7 } });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /true neighbour is \(1,0\)/);
});

test("assembling a cell rejects an exit whose toCell self-loops back to the assembling cell", () => {
  const layout = blankLayout();
  layout.exits.push({ at: { x: CELL_WIDTH - 1, y: 5 }, edge: "E", toCell: { cx: 0, cy: 0 } });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /true neighbour is \(1,0\)/);
});

test("assembling a cell rejects an unknown asset id", () => {
  const layout = blankLayout();
  layout.props.push({ id: "p1", assetId: "nonexistent-prop", x: 2, y: 2 });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /unknown asset/);
});

test("assembling a cell rejects an exit whose own tile is not walkable", () => {
  const layout = blankLayout();
  // Correctly positioned east exit, edge and toCell both right, but the tile
  // it sits on is a wall -- a doorway nothing could ever walk onto.
  layout.tiles[7]![CELL_WIDTH - 1] = "wall";
  layout.exits.push({ at: { x: CELL_WIDTH - 1, y: 7 }, edge: "E", toCell: { cx: 1, cy: 0 } });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.errors.join("; "), /non-walkable tile/);
});

test("assembleCell rejects a second assembly of an already-assembled cell, so a neighbour's mirrored exit can never be silently orphaned", () => {
  // A goes up first with an east exit; this stakes a "must connect" claim on
  // B's west edge.
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 7 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(emptyWorld(), 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, true);
  if (!afterA.ok) return;

  // B is assembled without its own west exit -- the engine auto-inserts the
  // mirror, exactly like the earlier auto-insert test.
  const afterB = assembleCell(afterA.world, 1, 0, blankLayout(), MANIFEST);
  assert.equal(afterB.ok, true);
  if (!afterB.ok) return;
  const storedB = afterB.world.cells.get("1,0")!;
  assert.equal(storedB.exits.length, 1);
  assert.deepEqual(storedB.exits[0], { at: { x: 0, y: 7 }, edge: "W", toCell: { cx: 0, cy: 0 } });

  // Re-assembling A with a wall now sitting under its own exit tile is
  // rejected outright by the own-tile walkability check above, so it can
  // never reach the point of leaving B's already-stored mirror exit
  // dangling. Confirm the rejection, and confirm B's stored layout (and
  // A's own stored layout) are both untouched.
  const cellAReplacement = blankLayout();
  cellAReplacement.tiles[7]![CELL_WIDTH - 1] = "wall";
  cellAReplacement.exits.push({ at: { x: CELL_WIDTH - 1, y: 7 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const reassembled = assembleCell(afterB.world, 0, 0, cellAReplacement, MANIFEST);
  assert.equal(reassembled.ok, false);
  if (reassembled.ok) return;
  assert.match(reassembled.errors.join("; "), /already assembled/);

  assert.deepEqual(afterB.world.cells.get("1,0")!.exits[0], { at: { x: 0, y: 7 }, edge: "W", toCell: { cx: 0, cy: 0 } });

  // Even a same-shaped re-assembly (no wall, identical layout) is rejected
  // the same way -- the guard is about re-assembly itself, not just about
  // this particular unsafe payload.
  const identicalReplay = assembleCell(afterB.world, 0, 0, cellA, MANIFEST);
  assert.equal(identicalReplay.ok, false);
});

test("a valid layout assembles cleanly", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "t1", assetId: "hero", x: 5, y: 3, kind: "pc" });
  layout.props.push({ id: "p1", assetId: "chest", x: 1, y: 1 });

  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, true);
});

test("an east exit auto-inserts a mirrored west opening when the neighbour doesn't declare one", () => {
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 7 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(emptyWorld(), 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, true);
  if (!afterA.ok) return;

  // Cell B declares no exits of its own at all.
  const cellB = blankLayout();
  const afterB = assembleCell(afterA.world, 1, 0, cellB, MANIFEST);
  assert.equal(afterB.ok, true);
  if (!afterB.ok) return;

  const storedB = afterB.world.cells.get("1,0");
  assert.ok(storedB);
  assert.equal(storedB!.exits.length, 1);
  const mirrored = storedB!.exits[0]!;
  assert.equal(mirrored.edge, "W");
  assert.deepEqual(mirrored.at, { x: 0, y: 7 });
  assert.deepEqual(mirrored.toCell, { cx: 0, cy: 0 });
});

test("a neighbour's own declared exit satisfies the stake without a duplicate insert", () => {
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 7 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(emptyWorld(), 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, true);
  if (!afterA.ok) return;

  const cellB = blankLayout();
  cellB.exits.push({ at: { x: 0, y: 7 }, edge: "W", toCell: { cx: 0, cy: 0 } });
  const afterB = assembleCell(afterA.world, 1, 0, cellB, MANIFEST);
  assert.equal(afterB.ok, true);
  if (!afterB.ok) return;

  assert.equal(afterB.world.cells.get("1,0")!.exits.length, 1);
});

test("assembling an exit toward an ALREADY-assembled neighbour patches that neighbour's stored layout retroactively", () => {
  // B goes up first, with no west exit -- nothing has staked one on it yet.
  const afterB = assembleCell(emptyWorld(), 1, 0, blankLayout(), MANIFEST);
  assert.equal(afterB.ok, true);
  if (!afterB.ok) return;
  assert.equal(afterB.world.cells.get("1,0")!.exits.length, 0);

  // A goes up second, with an east exit pointing at the already-built B.
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 9 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(afterB.world, 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, true);
  if (!afterA.ok) return;

  const storedB = afterA.world.cells.get("1,0")!;
  assert.equal(storedB.exits.length, 1);
  assert.deepEqual(storedB.exits[0], { at: { x: 0, y: 9 }, edge: "W", toCell: { cx: 0, cy: 0 } });
});

test("assembling an exit toward an already-assembled neighbour is rejected, not silently stored, when the mirrored tile is a wall", () => {
  // B goes up first, with a wall sitting exactly where A's east exit will
  // mirror onto -- (0,9) on B's west edge.
  const cellB = blankLayout();
  cellB.tiles[9]![0] = "wall";
  const afterB = assembleCell(emptyWorld(), 1, 0, cellB, MANIFEST);
  assert.equal(afterB.ok, true);
  if (!afterB.ok) return;

  // A goes up second, with an east exit pointing at the already-built B.
  // Patching that exit straight into B's stored layout would land it on a
  // wall tile -- exactly the "doorway declared on a wall tile" dead exit
  // validateLayout exists to catch -- so the whole assembly must be
  // rejected, the same way a fresh assembleCell rejects an exit sitting on
  // its own non-walkable tile.
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 9 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(afterB.world, 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, false);
  if (afterA.ok) return;
  assert.match(afterA.errors.join("; "), /non-walkable tile/);

  // B's stored layout is untouched: still no exits, still a wall at (0,9),
  // and A was never stored at all -- no partial write on a rejected
  // assembly, same as every other rejection path.
  const storedB = afterB.world.cells.get("1,0")!;
  assert.equal(storedB.exits.length, 0);
  assert.equal(storedB.tiles[9]![0], "wall");
  assert.equal(afterB.world.cells.get("0,0"), undefined);
});

test("getPlayspace returns the documented shape: dense grids plus object lists", () => {
  const layout = blankLayout();
  layout.tiles[2]![2] = "wall";
  layout.tokens.push({ id: "t1", assetId: "hero", x: 0, y: 0, kind: "pc" });
  layout.props.push({ id: "p1", assetId: "chest", x: 1, y: 1 });
  layout.exits.push({ at: { x: 0, y: 4 }, edge: "W", toCell: { cx: -1, cy: 0 } });

  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  const view = getPlayspace(assembled.world, 0, 0, MANIFEST);
  assert.ok(view);
  assert.deepEqual(view!.cell, { cx: 0, cy: 0 });
  assert.equal(view!.tiles.length, CELL_HEIGHT);
  assert.equal(view!.tiles[0]!.length, CELL_WIDTH);
  assert.equal(view!.walkable.length, CELL_HEIGHT);
  // walkable is derived from the manifest, not hand-authored: the one wall tile
  // must show up as false and nothing else nearby should.
  assert.equal(view!.walkable[2]![2], false);
  assert.equal(view!.walkable[0]![0], true);
  assert.equal(view!.tokens.length, 1);
  assert.equal(view!.props.length, 1);
  assert.equal(view!.exits.length, 1);
});

test("getPlayspace returns undefined for a stub cell", () => {
  assert.equal(getPlayspace(emptyWorld(), 3, 3, MANIFEST), undefined);
});

test("getOffscreenCells reports all eight neighbours, assembled or hinted", () => {
  const world = emptyWorld();
  const eastAssembled = assembleCell(world, 1, 0, blankLayout(), MANIFEST);
  assert.equal(eastAssembled.ok, true);
  if (!eastAssembled.ok) return;

  const hints = { "0,-1": "a frozen lake glimpsed through the trees" };
  const offscreen = getOffscreenCells(eastAssembled.world, 0, 0, hints);

  assert.equal(Object.keys(offscreen).length, 8);
  assert.equal(offscreen.E.status, "assembled");
  assert.equal(offscreen.N.status, "unassembled");
  if (offscreen.N.status === "unassembled") {
    assert.equal(offscreen.N.hint, "a frozen lake glimpsed through the trees");
  }
  // No hint supplied for this direction: falls back to a generic one rather than nothing.
  assert.equal(offscreen.S.status, "unassembled");
  if (offscreen.S.status === "unassembled") {
    assert.ok(offscreen.S.hint.length > 0);
  }
});

test("moveToken rejects a move onto a wall tile, and the token stays put", () => {
  const layout = blankLayout();
  layout.tiles[6]![6] = "wall";
  layout.tokens.push({ id: "t1", assetId: "hero", x: 1, y: 1, kind: "pc" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  const res = moveToken(assembled.world, 0, 0, "t1", { x: 6, y: 6 }, MANIFEST, resetTurnEconomy(30));
  assert.equal(res.ok, false);

  const view = getPlayspace(assembled.world, 0, 0, MANIFEST);
  assert.deepEqual(view!.tokens[0], { id: "t1", assetId: "hero", x: 1, y: 1, kind: "pc" });
});

test("moveToken accepts a move onto a walkable tile within remaining movement, and returns the spent economy", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "t1", assetId: "hero", x: 1, y: 1, kind: "pc" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  // (1,1) -> (4,4) is 3 squares, Chebyshev, 15 ft. at 5 ft./square -- well
  // inside a 30 ft. speed's budget.
  const res = moveToken(assembled.world, 0, 0, "t1", { x: 4, y: 4 }, MANIFEST, resetTurnEconomy(30));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.economy.movementRemaining, 15);
  const view = getPlayspace(res.world, 0, 0, MANIFEST);
  assert.deepEqual(view!.tokens[0], { id: "t1", assetId: "hero", x: 4, y: 4, kind: "pc" });
});

// DESIGN.md's "The rules engine" lists action economy (action / bonus
// action / movement / reaction) as "enforced structurally," but before this
// gate a DM turn could move a token any number of tiles via moveToken with
// nothing checking it against the combatant's remaining movement for the
// round -- rules/actionEconomy.ts's spendMovement was fully unit-tested but
// had zero real call sites. This is that call site: a move that costs more
// feet than the combatant has left this turn is rejected, and the world
// stays exactly as it was, the same "no partial write" contract every other
// rejection in this file honours.
test("moveToken rejects a move that costs more feet than the combatant has left this turn", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "t1", assetId: "hero", x: 0, y: 0, kind: "pc" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  // (0,0) -> (10,0) is 10 squares, 50 ft. -- more than a 30 ft. speed allows.
  const res = moveToken(assembled.world, 0, 0, "t1", { x: 10, y: 0 }, MANIFEST, resetTurnEconomy(30));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /movement/i);

  // Rejected, so the token never moved -- same "no partial write" guarantee
  // the wall-tile rejection above checks.
  const view = getPlayspace(assembled.world, 0, 0, MANIFEST);
  assert.deepEqual(view!.tokens[0], { id: "t1", assetId: "hero", x: 0, y: 0, kind: "pc" });
});

test("moveToken spends movement across successive moves, leaving less each time, and rejects once it runs out", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "t1", assetId: "hero", x: 0, y: 0, kind: "pc" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  // 30 ft. speed: first move (0,0)->(3,0) costs 15 ft., leaving 15 ft.
  const first = moveToken(assembled.world, 0, 0, "t1", { x: 3, y: 0 }, MANIFEST, resetTurnEconomy(30));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.economy.movementRemaining, 15);

  // Second move (3,0)->(6,0) costs another 15 ft. -- exactly what's left, so it succeeds at 0 remaining.
  const second = moveToken(first.world, 0, 0, "t1", { x: 6, y: 0 }, MANIFEST, first.economy);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.economy.movementRemaining, 0);

  // A third move, even one tile, has nothing left to spend and is rejected.
  const third = moveToken(second.world, 0, 0, "t1", { x: 7, y: 0 }, MANIFEST, second.economy);
  assert.equal(third.ok, false);
});

// ── the staked-opening repair: a forgivable omission must not kill a paid turn
//
// DESIGN.md promises the engine "inserts a matching opening at the mirrored
// position rather than leaving a dead end." Before this repair, reconcileStakes
// only ever pushed an Exit RECORD onto the neighbour's layout without touching
// the tile underneath it, so a DM that drew an ordinary fully-bordered room,
// the normal thing to draw, got the whole assembly rejected with "exit sits on
// a non-walkable tile", burning the credit assembleCell costs. The repair has
// to change the tile too, not just the exit list.

test("a pending stake whose mirrored tile is a wall repairs the tile to walkable floor instead of killing the whole assembly", () => {
  // (0,0) goes up with an east exit at (19,6): that stakes a west opening at
  // (0,6) on cell (1,0).
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 6 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(emptyWorld(), 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, true);
  if (!afterA.ok) return;

  // The DM draws (1,0) as a normal room: solid border, no west exit declared.
  const afterB = assembleCell(afterA.world, 1, 0, borderedRoom(), MANIFEST);
  assert.equal(afterB.ok, true, afterB.ok ? "" : afterB.errors.join("; "));
  if (!afterB.ok) return;

  const storedB = afterB.world.cells.get("1,0")!;
  assert.equal(storedB.tiles[6]![0], "floor", "the staked tile must be repaired to a walkable floor id");
  assert.deepEqual(storedB.exits[0], { at: { x: 0, y: 6 }, edge: "W", toCell: { cx: 0, cy: 0 } });
  // The repair is surgical: every other border tile is untouched.
  assert.equal(storedB.tiles[5]![0], "wall");
  assert.equal(storedB.tiles[7]![0], "wall");
});

test("the staked-opening repair reuses a walkable floor id the layout already uses, so the patched tile matches the room around it", () => {
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 6 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(emptyWorld(), 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, true);
  if (!afterA.ok) return;

  // A room whose interior is a DIFFERENT walkable tile id than the one a
  // hardcoded repair would reach for: the patch has to read the layout.
  const manifest: AssetManifest = {
    tiles: { floor: { walkable: true }, mossy_floor: { walkable: true }, wall: { walkable: false } },
    tokens: MANIFEST.tokens,
    props: MANIFEST.props,
  };
  const room = borderedRoom();
  for (let y = 1; y < CELL_HEIGHT - 1; y++) {
    for (let x = 1; x < CELL_WIDTH - 1; x++) room.tiles[y]![x] = "mossy_floor";
  }

  const afterB = assembleCell(afterA.world, 1, 0, room, manifest);
  assert.equal(afterB.ok, true, afterB.ok ? "" : afterB.errors.join("; "));
  if (!afterB.ok) return;
  assert.equal(afterB.world.cells.get("1,0")!.tiles[6]![0], "mossy_floor");
});

// ── offscreen neighbours: coordinates and owed openings, not eight bare letters

test("getOffscreenCells reports each neighbour's real cell coordinates", () => {
  const offscreen = getOffscreenCells(emptyWorld(), 3, 4);
  assert.deepEqual(offscreen.N.cell, { cx: 3, cy: 3 });
  assert.deepEqual(offscreen.S.cell, { cx: 3, cy: 5 });
  assert.deepEqual(offscreen.E.cell, { cx: 4, cy: 4 });
  assert.deepEqual(offscreen.W.cell, { cx: 2, cy: 4 });
  assert.deepEqual(offscreen.NW.cell, { cx: 2, cy: 3 });
});

test("getOffscreenCells reports the openings an already-built neighbour has staked on an unbuilt one", () => {
  const cellA = blankLayout();
  cellA.exits.push({ at: { x: CELL_WIDTH - 1, y: 6 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  const afterA = assembleCell(emptyWorld(), 0, 0, cellA, MANIFEST);
  assert.equal(afterA.ok, true);
  if (!afterA.ok) return;

  const offscreen = getOffscreenCells(afterA.world, 0, 0);
  assert.equal(offscreen.E.status, "unassembled");
  if (offscreen.E.status === "unassembled") {
    assert.deepEqual(offscreen.E.owedOpenings, [{ edge: "W", at: { x: 0, y: 6 } }]);
  }
  if (offscreen.N.status === "unassembled") {
    assert.deepEqual(offscreen.N.owedOpenings, []);
  }
});

// ── doors, walls and occupancy: the world model has to mean something ───

test("a closed door prop blocks its tile, and opening it unblocks it", () => {
  const layout = blankLayout();
  layout.props.push({ id: "door-1", assetId: "door_closed", x: 6, y: 6 });
  layout.tokens.push({ id: "t1", assetId: "hero", x: 5, y: 6, kind: "pc" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  const blocked = moveToken(assembled.world, 0, 0, "t1", { x: 6, y: 6 }, MANIFEST, resetTurnEconomy(30));
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.match(blocked.error, /door-1|blocked|not walkable/i);

  const opened = setDoorState(assembled.world, 0, 0, "door-1", "door_open", MANIFEST);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const through = moveToken(opened.world, 0, 0, "t1", { x: 6, y: 6 }, MANIFEST, resetTurnEconomy(30));
  assert.equal(through.ok, true, through.ok ? "" : through.error);
});

test("tileFreeFor treats the moving token's own square as free, and another token's square as taken", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "t1", assetId: "hero", x: 4, y: 4, kind: "pc" });
  layout.tokens.push({ id: "g1", assetId: "goblin", x: 5, y: 5, kind: "monster" });
  assert.equal(tileFreeFor(layout, MANIFEST, 4, 4, "t1"), true);
  assert.equal(tileFreeFor(layout, MANIFEST, 5, 5, "t1"), false);
  assert.equal(tileFreeFor(layout, MANIFEST, 6, 6, "t1"), true);
});

test("validateLayout rejects a layout with no exits at all, a sealed room nothing could ever leave", () => {
  const res = assembleCell(emptyWorld(), 0, 0, unsealedLayout(), MANIFEST);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join("; "), /no exits|at least one exit/i);
});

test("a layout that explicitly flags itself sealed is accepted with no exits", () => {
  const res = assembleCell(emptyWorld(), 0, 0, blankLayout(), MANIFEST);
  assert.equal(res.ok, true);
});

test("validateLayout rejects two tokens sharing one id", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "pc-1", assetId: "hero", x: 5, y: 5, kind: "pc" });
  layout.tokens.push({ id: "pc-1", assetId: "goblin", x: 9, y: 9, kind: "monster" });
  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join("; "), /pc-1/);
});

test("validateLayout rejects two tokens standing in the same square", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "g1", assetId: "goblin", x: 5, y: 5, kind: "monster" });
  layout.tokens.push({ id: "g2", assetId: "goblin", x: 5, y: 5, kind: "monster" });
  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join("; "), /\(5,5\)/);
});

test("validateLayout rejects two props sharing one id", () => {
  const layout = blankLayout();
  layout.props.push({ id: "chest-1", assetId: "chest", x: 2, y: 2 });
  layout.props.push({ id: "chest-1", assetId: "chest", x: 3, y: 3 });
  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join("; "), /chest-1/);
});

test("placeToken rejects a token whose id already exists in the cell", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "pc-1", assetId: "hero", x: 5, y: 5, kind: "pc" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  const res = placeToken(assembled.world, 0, 0, { id: "pc-1", assetId: "goblin", x: 9, y: 9, kind: "monster" }, MANIFEST);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /pc-1/);
});

test("placeToken rejects a square another token is already standing in", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "g1", assetId: "goblin", x: 5, y: 5, kind: "monster" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  const res = placeToken(assembled.world, 0, 0, { id: "g2", assetId: "goblin", x: 5, y: 5, kind: "monster" }, MANIFEST);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /occupied|g1/i);
});

test("moveToken rejects a move into a square another token is standing in", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "t1", assetId: "hero", x: 4, y: 4, kind: "pc" });
  layout.tokens.push({ id: "g1", assetId: "goblin", x: 5, y: 5, kind: "monster" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  const res = moveToken(assembled.world, 0, 0, "t1", { x: 5, y: 5 }, MANIFEST, resetTurnEconomy(30));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /occupied|g1/i);
});

test("removeToken removes exactly one token even when two share an id, so one cited hit can never take two creatures off the board", () => {
  // The weaponised version of duplicate ids: two goblins sharing "mon-gob-1",
  // one attack roll cited once, and the old filter-based removeToken deleted
  // both, straight past turnSchema's "one resolved roll decides one outcome"
  // guarantee, which is unconditional on token ids being unique. placeToken
  // now refuses to create the duplicate at all, so this builds one by hand to
  // prove the mutator itself is safe even if one ever exists.
  const layout = blankLayout();
  layout.tokens.push({ id: "mon-gob-1", assetId: "goblin", x: 5, y: 5, kind: "monster" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;
  const stored = assembled.world.cells.get("0,0")!;
  stored.tokens.push({ id: "mon-gob-1", assetId: "goblin", x: 9, y: 9, kind: "monster" });

  const res = removeToken(assembled.world, 0, 0, "mon-gob-1");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.world.cells.get("0,0")!.tokens.length, 1, "exactly one token comes off the board");
});

test("exitToNeighbour finds the boundary exit for a cardinal direction, and returns undefined for a wall run or a diagonal", () => {
  const layout = blankLayout();
  layout.exits.push({ at: { x: CELL_WIDTH - 1, y: 6 }, edge: "E", toCell: { cx: 1, cy: 0 } });
  assert.deepEqual(exitToNeighbour(layout, "E")?.at, { x: CELL_WIDTH - 1, y: 6 });
  assert.equal(exitToNeighbour(layout, "W"), undefined);
  assert.equal(exitToNeighbour(layout, "NE"), undefined);
});

// ── reach, range and line of sight ──────────────────────────────────────
//
// Before this, nothing anywhere checked distance: a goblin at (9,6) attacked
// a PC at (9,0), six tiles away, and the engine resolved it without comment.
// A tactical grid whose only spatial rule is "is the tile walkable" is a
// picture, not a battlefield.

/** A Playspace built straight from a layout, for the geometry helpers that take one. */
function playspaceOf(layout: CellLayout) {
  return {
    cell: { cx: 0, cy: 0 },
    tiles: layout.tiles,
    walkable: layout.tiles.map((row) => row.map((id) => MANIFEST.tiles[id]?.walkable === true)),
    opaque: sightBlockers(layout, MANIFEST),
    props: layout.props,
    tokens: layout.tokens,
    exits: layout.exits,
  };
}

test("tileDistance is Chebyshev, so a diagonal step is one tile", () => {
  assert.equal(tileDistance({ x: 4, y: 4 }, { x: 5, y: 5 }), 1);
  assert.equal(tileDistance({ x: 9, y: 0 }, { x: 9, y: 6 }), 6);
});

test("checkAttackReach rejects a melee attack six tiles away, naming both positions and the distance", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "pc-kira", assetId: "hero", x: 9, y: 0, kind: "pc" });
  layout.tokens.push({ id: "mon-gob-1", assetId: "goblin", x: 9, y: 6, kind: "monster" });

  const res = checkAttackReach(combatGeometryFrom(playspaceOf(layout)), "mon-gob-1", "pc-kira", "melee");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /\(9,6\)/);
  assert.match(res.error, /\(9,0\)/);
  assert.match(res.error, /6 tiles/);
});

test("checkAttackReach accepts an adjacent melee attack, including a diagonal one", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "pc-kira", assetId: "hero", x: 5, y: 5, kind: "pc" });
  layout.tokens.push({ id: "mon-gob-1", assetId: "goblin", x: 6, y: 6, kind: "monster" });
  assert.equal(checkAttackReach(combatGeometryFrom(playspaceOf(layout)), "mon-gob-1", "pc-kira", "melee").ok, true);
});

test("checkAttackReach rejects a ranged shot with a wall between attacker and target, and getVisible is what decides that", () => {
  const layout = blankLayout();
  // A full-height wall column at x=10 between the two of them.
  for (let y = 0; y < CELL_HEIGHT; y++) layout.tiles[y]![10] = "wall";
  layout.tokens.push({ id: "pc-kira", assetId: "hero", x: 4, y: 7, kind: "pc" });
  layout.tokens.push({ id: "mon-gob-1", assetId: "goblin", x: 15, y: 7, kind: "monster" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  // getVisible is the world-level line-of-sight entry point, and this is a
  // real caller of it: buildCombatGeometry asks it per token.
  const visible = getVisible(assembled.world, 0, 0, "mon-gob-1", MANIFEST);
  assert.ok(!visible.some((t) => t.x === 4 && t.y === 7), "the wall column must hide the PC from the goblin");

  const geometry = buildCombatGeometry(assembled.world, 0, 0, MANIFEST)!;
  const res = checkAttackReach(geometry, "mon-gob-1", "pc-kira", "ranged");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /line of sight|cannot see/i);
});

test("checkAttackReach accepts a ranged shot down a clear lane", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "pc-kira", assetId: "hero", x: 4, y: 7, kind: "pc" });
  layout.tokens.push({ id: "mon-gob-1", assetId: "goblin", x: 15, y: 7, kind: "monster" });
  const assembled = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  const geometry = buildCombatGeometry(assembled.world, 0, 0, MANIFEST)!;
  assert.equal(checkAttackReach(geometry, "mon-gob-1", "pc-kira", "ranged").ok, true);
});

test("checkAttackReach fails open when it has no position for one of the two tokens, since an attack on something not on the board yet is not a reach violation", () => {
  const layout = blankLayout();
  layout.tokens.push({ id: "pc-kira", assetId: "hero", x: 5, y: 5, kind: "pc" });
  assert.equal(checkAttackReach(combatGeometryFrom(playspaceOf(layout)), "something-offscreen", "pc-kira", "melee").ok, true);
});

// ── searchable props: the data model DESIGN.md's Search verb needs ──────

test("validateLayout accepts a prop carrying a search label, DC and found-text", () => {
  const layout = blankLayout();
  layout.props.push({
    id: "chest-1",
    assetId: "chest",
    x: 2,
    y: 2,
    label: "the iron-bound chest",
    dc: 14,
    onFound: "A false bottom hides a folded chart of the marsh causeways.",
    grantsItem: "Marsh chart",
  });
  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, true, res.ok ? "" : res.errors.join("; "));
});

test("validateLayout rejects a search DC outside the SRD 5 to 30 scale", () => {
  const layout = blankLayout();
  layout.props.push({ id: "chest-1", assetId: "chest", x: 2, y: 2, dc: 47 });
  const res = assembleCell(emptyWorld(), 0, 0, layout, MANIFEST);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join("; "), /dc/i);
});

// ── the campaign's region sketch, and the hints it feeds getOffscreenCells
//
// Every prompt in a hand-authored 14-turn run showed all eight neighbours as
// "not built yet -- unexplored", because both getOffscreenCells call sites
// omitted the hints parameter and there was nothing to pass anyway: the arc
// outline was throughline plus beats plus npcs, with no geography in it at
// all. This is the geography, generated on the campaign-planning credit that
// was already spent.

test("the campaign validator accepts an arc carrying a region sketch and keeps it on the outline", () => {
  const campaign = validateGeneratedCampaign({
    title: "The Salt-Blighted Coast",
    throughline: "A creeping blight is poisoning the coastline.",
    beats: ["A village has already lost someone.", "A half-sunken shrine out in the marsh.", "What is actually behind the blight."],
    npcs: [{ name: "Maren Hollowell", role: "the herbalist who raised the alarm" }],
    regionSketch: [
      { cx: 0, cy: 0, hint: "the village of Fenwick, half its boats hauled up and rotting" },
      { cx: 1, cy: 0, hint: "the marsh causeway; the half-sunken shrine is visible from here" },
      { cx: 0, cy: -1, hint: "the salt flats, white and cracked" },
      { cx: -1, cy: 0, hint: "the drowned orchard" },
      { cx: 0, cy: 1, hint: "the tideline, and whatever the tide left" },
    ],
  });
  assert.equal(campaign.arcOutline.regionSketch?.length, 5);
  assert.deepEqual(campaign.arcOutline.regionSketch![1], {
    cx: 1,
    cy: 0,
    hint: "the marsh causeway; the half-sunken shrine is visible from here",
  });
});

test("the campaign validator rejects a region sketch too thin to hint a neighbourhood", () => {
  assert.throws(
    () =>
      validateGeneratedCampaign({
        title: "T",
        throughline: "A thing.",
        beats: ["a", "b", "c"],
        npcs: [{ name: "N", role: "r" }],
        regionSketch: [{ cx: 0, cy: 0, hint: "here" }],
      }),
    /regionSketch/,
  );
});

test("the campaign validator rejects a region sketch cell too far from the origin to ever be reached", () => {
  assert.throws(
    () =>
      validateGeneratedCampaign({
        title: "T",
        throughline: "A thing.",
        beats: ["a", "b", "c"],
        npcs: [{ name: "N", role: "r" }],
        regionSketch: [
          { cx: 0, cy: 0, hint: "here" },
          { cx: 1, cy: 0, hint: "there" },
          { cx: 0, cy: 1, hint: "below" },
          { cx: -1, cy: 0, hint: "left" },
          { cx: 40, cy: 40, hint: "somewhere nobody will ever walk to" },
        ],
      }),
    /40/,
  );
});

test("regionHints keys a sketch by cell so getOffscreenCells can look a neighbour's hint straight up", () => {
  const hints = regionHints({
    throughline: "t",
    beats: [],
    npcs: [],
    regionSketch: [
      { cx: 0, cy: 0, hint: "the village" },
      { cx: 1, cy: 0, hint: "the marsh causeway" },
    ],
  });
  assert.deepEqual(hints, { "0,0": "the village", "1,0": "the marsh causeway" });

  const offscreen = getOffscreenCells(emptyWorld(), 0, 0, hints);
  assert.equal(offscreen.E.status, "unassembled");
  if (offscreen.E.status === "unassembled") assert.equal(offscreen.E.hint, "the marsh causeway");
});

test("coerceRegionSketch survives a legacy campaign row that has no sketch at all", () => {
  assert.deepEqual(coerceRegionSketch(undefined), []);
  assert.deepEqual(coerceRegionSketch([{ cx: 2, cy: -1, hint: "a ridge" }, { cx: "x", hint: "junk" }]), [
    { cx: 2, cy: -1, hint: "a ridge" },
  ]);
});

// -- setTokenHp / markPropSearched: the two engine-only mutators -----------
//
// Both exist because a resolved mechanical outcome had nowhere to be written.
// Monster HP lived in a React record that never reached games-db and never
// reached the DM's perception of the board, and `PlacedProp.searched` was a
// field the DM could author and the engine could read but nothing ever wrote.
// Neither has a WorldAction variant, deliberately: the model must not be able
// to set a creature's hit points or declare a chest already looted.

test("setTokenHp writes hit points onto the token and leaves everything else alone", () => {
  let world = setCell(emptyWorld(), { cx: 0, cy: 0 }, blankLayout());
  const placed = placeToken(world, 0, 0, { id: "goblin1", assetId: "goblin", x: 4, y: 4, kind: "monster" }, MANIFEST);
  assert.ok(placed.ok);
  world = placed.world;

  const hurt = setTokenHp(world, 0, 0, "goblin1", 3);
  assert.ok(hurt.ok);
  const token = getCell(hurt.world, { cx: 0, cy: 0 })!.tokens.find((t) => t.id === "goblin1")!;
  assert.equal(token.currentHp, 3);
  assert.equal(token.x, 4);
  assert.equal(token.y, 4);
  assert.equal(token.assetId, "goblin");
  assert.equal(token.kind, "monster");
});

test("setTokenHp floors at 0 rather than storing negative hit points", () => {
  let world = setCell(emptyWorld(), { cx: 0, cy: 0 }, blankLayout());
  world = (placeToken(world, 0, 0, { id: "goblin1", assetId: "goblin", x: 4, y: 4, kind: "monster" }, MANIFEST) as { ok: true; world: World }).world;
  const hurt = setTokenHp(world, 0, 0, "goblin1", -9);
  assert.ok(hurt.ok);
  assert.equal(getCell(hurt.world, { cx: 0, cy: 0 })!.tokens[0]!.currentHp, 0);
});

test("setTokenHp rejects a token that is not in the cell instead of inventing one", () => {
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, blankLayout());
  const result = setTokenHp(world, 0, 0, "nobody", 5);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no token "nobody"/);
});

test("a moved token keeps the hit points it was already down to", () => {
  let world = setCell(emptyWorld(), { cx: 0, cy: 0 }, blankLayout());
  world = (placeToken(world, 0, 0, { id: "goblin1", assetId: "goblin", x: 4, y: 4, kind: "monster" }, MANIFEST) as { ok: true; world: World }).world;
  world = (setTokenHp(world, 0, 0, "goblin1", 2) as { ok: true; world: World }).world;

  const moved = moveToken(world, 0, 0, "goblin1", { x: 5, y: 4 }, MANIFEST, resetTurnEconomy(30));
  assert.ok(moved.ok);
  const token = getCell(moved.world, { cx: 0, cy: 0 })!.tokens.find((t) => t.id === "goblin1")!;
  assert.equal(token.currentHp, 2, "a wounded creature that walks two feet is still wounded");
  assert.equal(token.x, 5);
});

test("markPropSearched flags exactly the prop it names", () => {
  const layout = blankLayout();
  layout.props = [
    { id: "chest1", assetId: "chest", x: 3, y: 3, dc: 14 },
    { id: "chest2", assetId: "chest", x: 9, y: 3, dc: 14 },
  ];
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);

  const marked = markPropSearched(world, 0, 0, "chest2");
  assert.ok(marked.ok);
  const props = getCell(marked.world, { cx: 0, cy: 0 })!.props;
  assert.equal(props.find((p) => p.id === "chest1")!.searched, undefined);
  assert.equal(props.find((p) => p.id === "chest2")!.searched, true);
  assert.equal(props.find((p) => p.id === "chest2")!.dc, 14, "marking it searched must not drop its authored DC");
});

test("markPropSearched rejects a prop that is not there", () => {
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, blankLayout());
  const result = markPropSearched(world, 0, 0, "ghost-chest");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no prop "ghost-chest"/);
});

// ── the player's own token is not the DM's to move ───────────────────────
//
// session/applyWorldAction.ts hands every DM-narrated reposition a 9,999 ft.
// movement budget, documented as a deliberate simplification for shuffling
// NPCs around a scene -- and it applied to the player character too. An
// adversary read the board straight off the DM's own prompt and issued one
// moveToken on the pc token, reason "staging", no roll cited: the player was
// dragged sixteen tiles across the room to stand beside a skeleton, with no
// note and no rejection. On its own that is a nuisance; next to the reach gate
// in dm/turnSchema.ts it is a supported way around it, since a creature that
// cannot legally swing from six tiles away can simply have the player brought
// to it and swing legally next turn.

/** A world with the player standing at (2,2) and a skeleton across the room at (18,13), which is the exact board the adversary exploited. */
function boardWithPlayer(): World {
  const layout = blankLayout();
  layout.tokens = [
    { id: "pc-kira", assetId: "hero", x: 2, y: 2, kind: "pc" },
    { id: "mon-skel-1", assetId: "goblin", x: 18, y: 13, kind: "monster" },
  ];
  return setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);
}

test("applyWorldAction refuses a DM moveToken naming the player's own token, however it is labelled", () => {
  const action: WorldAction = { type: "moveToken", cx: 0, cy: 0, tokenId: "pc-kira", to: { x: 17, y: 13 }, reason: "staging" };
  const result = applyWorldAction(boardWithPlayer(), action, MANIFEST);
  assert.ok(result.error, "moving the player character must be rejected, not applied");
  assert.match(result.error!, /pc-kira/);
  assert.match(result.error!, /player moves it themselves|player's own character token/i);
  assert.deepEqual(result.touchedCells, []);
  const token = getCell(result.world, { cx: 0, cy: 0 })!.tokens.find((t) => t.id === "pc-kira")!;
  assert.deepEqual({ x: token.x, y: token.y }, { x: 2, y: 2 }, "the player has not moved a tile");
});

test("applyWorldAction still repositions a monster token on the generous budget, which is what that budget is for", () => {
  const action: WorldAction = { type: "moveToken", cx: 0, cy: 0, tokenId: "mon-skel-1", to: { x: 3, y: 2 }, reason: "staging" };
  const result = applyWorldAction(boardWithPlayer(), action, MANIFEST);
  assert.equal(result.error, undefined);
  const token = getCell(result.world, { cx: 0, cy: 0 })!.tokens.find((t) => t.id === "mon-skel-1")!;
  assert.deepEqual({ x: token.x, y: token.y }, { x: 3, y: 2 });
});
