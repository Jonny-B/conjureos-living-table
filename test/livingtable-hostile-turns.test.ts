/**
 * Tests for the other side's turns (src/games/livingtable/session/hostileTurns.ts)
 * and the events they hand back (src/games/livingtable/session/combatEvents.ts).
 *
 * What this defends: a monster goes round a wall instead of standing at it, it
 * spends the round's real economy at its own speed, and a stretch of hostile
 * turns reports EVERYTHING that happened, in order, as data a screen can play
 * back (a floating number needs the amount, a walk needs the squares, and two
 * monsters need two readouts, not just the last).
 *
 * The pathfinder itself is tested in test/livingtable-pathing.test.ts.
 *
 * Run: npx tsx --test test/livingtable-hostile-turns.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveMonsterTurn, runHostileTurns } from "../src/games/livingtable/session/hostileTurns";
import { attackEvents, type CombatEvent, type ReadoutView } from "../src/games/livingtable/session/combatEvents";
import { activeCombatant, startCombat, type CombatRound } from "../src/games/livingtable/menu/combatRound";
import { createCharacter, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { resetTurnEconomy } from "../src/games/livingtable/rules/actionEconomy";
import type { AttackResult } from "../src/games/livingtable/rules/combat";
import { CELL_HEIGHT, CELL_WIDTH, emptyWorld, getCell, setCell, setDoorState, type AssetManifest, type CellCoord, type CellLayout, type TileCoord, type World } from "../src/games/livingtable/world";

const PC = "pc-1";
const CELL: CellCoord = { cx: 0, cy: 0 };

const MANIFEST: AssetManifest = {
  tiles: { floor: { walkable: true }, wall: { walkable: false } },
  tokens: { token_knight: {}, token_goblin: {} },
  props: { door_closed: { blocks: true }, door_open: {} },
};

type Token = CellLayout["tokens"][number];
const hero = (x: number, y: number): Token => ({ id: PC, assetId: "token_knight", x, y, kind: "pc" });
const goblin = (x: number, y: number, id = "gob"): Token => ({ id, assetId: "token_goblin", x, y, kind: "monster" });
const at = (x: number, y: number): TileCoord => ({ x, y });

function room(tokens: Token[], walls: ReadonlyArray<readonly [number, number]> = [], props: CellLayout["props"] = []): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) => (x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1 ? "wall" : "floor")),
  );
  for (const [x, y] of walls) tiles[y]![x] = "wall";
  return { tiles, props, tokens, exits: [], sealed: true };
}

/**
 * A layout drawn in text, 20 columns by 15 rows: `#` wall, `.` floor, `H` the
 * hero and `G` the goblin (each standing on floor). A row or column left out is
 * wall, so a drawing only has to show the floor it cares about.
 */
function drawn(rows: readonly string[]): CellLayout {
  const tokens: Token[] = [];
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) => {
      const c = rows[y]?.[x] ?? "#";
      if (c === "H") tokens.push(hero(x, y));
      if (c === "G") tokens.push(goblin(x, y));
      return c === "#" ? "wall" : "floor";
    }),
  );
  return { tiles, props: [], tokens, exits: [], sealed: true };
}

const DIVIDER_X = 11;
const GAP_Y = 7;

/** The investigation's scene: a wall across the room at x=11 with one gap at y=7. */
function divided(tokens: Token[], props: CellLayout["props"] = []): CellLayout {
  const walls: [number, number][] = [];
  for (let y = 1; y < CELL_HEIGHT - 1; y++) if (y !== GAP_Y) walls.push([DIVIDER_X, y]);
  return room(tokens, walls, props);
}

const worldOf = (layout: CellLayout): World => setCell(emptyWorld(), CELL, layout);
const namerFor = (layout: CellLayout) => ({
  playerTokenId: PC,
  playerName: "Maddik",
  tokens: layout.tokens.map((t) => ({ id: t.id, assetId: t.assetId })),
});
const knight = (): CharacterSheet => createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
/** Hit points enough that a critical from a goblin cannot drop the hero, so a test about damage is not also a test about going down. */
const sturdy = (): CharacterSheet => ({ ...knight(), currentHp: 200, maxHp: 200 });
const tokenAt = (world: World, id: string): TileCoord => {
  const t = getCell(world, CELL)!.tokens.find((x) => x.id === id)!;
  return at(t.x, t.y);
};
const kinds = (events: readonly CombatEvent[]) => events.map((e) => e.kind);
const chebyshev = (a: TileCoord, b: TileCoord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function turn(world: World, layout: CellLayout, extra: Partial<Parameters<typeof resolveMonsterTurn>[0]> = {}) {
  return resolveMonsterTurn({
    world,
    cell: CELL,
    manifest: MANIFEST,
    monsterId: "gob",
    playerTokenId: PC,
    sheet: knight(),
    namer: namerFor(layout),
    rng: () => 0.5,
    ...extra,
  });
}

/** A round with the order spelled out and `activeIndex` acting (the first combatant by default). */
function roundOf(order: readonly string[], speeds: Record<string, number> = {}, activeIndex = 0): CombatRound {
  const started = startCombat({
    player: { id: PC, label: "Maddik", dexModifier: 3, speedFt: 30 },
    hostiles: order.filter((id) => id !== PC).map((id) => ({ id, label: "the goblin", speedFt: speeds[id] ?? 30 })),
    rng: () => 0.5,
  });
  const byId = new Map(started.order.map((c) => [c.id, c]));
  return { order: order.map((id) => byId.get(id)!), activeIndex, roundNumber: 1 };
}

// ── going round a wall (the investigation's probe 2) ────────────────────

test("a goblin behind a wall with a gap in it goes through the gap and gets at the hero", () => {
  // Probe 2: goblin at (14,3), hero at (8,3), a wall at x=11 with a gap at y=7.
  // The old turn stepped by Math.sign toward the hero, was refused by the wall
  // at (11,3), and ended at (12,3). Three more turns left it at (12,3).
  const layout = divided([hero(8, 3), goblin(14, 3)]);
  const first = turn(worldOf(layout), layout);
  assert.equal(first.moved, true);
  const after = tokenAt(first.world, "gob");
  assert.ok(after.x < DIVIDER_X, `through the gap and out the other side, not stuck at the wall: ended at ${JSON.stringify(after)}`);
  assert.ok(first.path.some((t) => t.x === DIVIDER_X && t.y === GAP_Y), "the route goes through the gap");
  assert.equal(first.path.length, 6, "all six squares of a 30 ft. turn");
  assert.deepEqual(first.path[first.path.length - 1], after, "path ends where the token ended");
  assert.deepEqual(first.story, ["the goblin closes in."]);
  assert.equal(first.readout, null, "still too far to swing");

  // The next turn finishes the walk and swings.
  const second = turn(first.world, layout);
  assert.ok(chebyshev(tokenAt(second.world, "gob"), at(8, 3)) <= 1, "adjacent now");
  assert.equal(second.lines.length, 1, "and it attacks in the same turn");
  assert.match(second.lines[0]!.text, /The goblin swings at Maddik/);
});

test("the same goblin never stands at the wall: within a few turns it has swung", () => {
  const layout = divided([hero(8, 3), goblin(14, 3)]);
  let world = worldOf(layout);
  let swung = -1;
  for (let i = 0; i < 4 && swung < 0; i++) {
    const out = turn(world, layout);
    world = out.world;
    if (out.lines.length > 0) swung = i;
  }
  assert.ok(swung >= 0 && swung <= 2, `it should have reached the hero by the third turn, swung on turn ${swung}`);
});

test("a hero behind a closed door: the goblin queues at the door, never wanders off, and goes through once it opens", () => {
  const layout = divided([hero(8, 7), goblin(14, 7)], [{ id: "door", assetId: "door_closed", x: DIVIDER_X, y: GAP_Y }]);
  const first = turn(worldOf(layout), layout);
  assert.deepEqual(tokenAt(first.world, "gob"), at(12, 7), "as close as the floor lets it get");
  assert.equal(first.moved, true);
  assert.equal(first.readout, null, "nothing to swing at through a door");
  assert.deepEqual(kinds(first.events), ["move"]);

  const second = turn(first.world, layout);
  assert.equal(second.moved, false, "already the nearest square it can reach: it stays, rather than shuffling about");
  assert.deepEqual(second.events, []);
  assert.deepEqual(second.path, []);

  const opened = setDoorState(first.world, 0, 0, "door", "door_open", MANIFEST);
  assert.ok(opened.ok);
  const third = turn((opened as { ok: true; world: World }).world, { ...layout, props: [] });
  assert.ok(third.path.some((t) => t.x === DIVIDER_X && t.y === GAP_Y), "through the open door");
});

// ── a hero it cannot reach: close in by the game's tiles, never back off ──

// The three fixtures below seal the hero in a one-square cell of its own, so
// the goblin can never get at it and its turn is the "walk toward the nearest
// square I CAN reach" fallback. The game measures distance in Chebyshev tiles
// (the larger of the two gaps), and these floors are drawn so that the
// straight-line measure the fallback used to rank squares by disagrees.

test("an unreachable hero: a goblin never ends its turn farther away, in tiles, than it began", () => {
  // The goblin at (9,9) is 6 tiles from the hero at (3,3) and 72 in squared
  // straight-line. The floor offers (10,7), 7 tiles away and only 65 squared,
  // so the old ranking called it the nearer square and walked the goblin out
  // to it: 6 tiles became 7. (The checker's scenario, 11 tiles becoming 12.)
  const layout = drawn([
    "####################",
    "####################",
    "####################",
    "###H################",
    "####################",
    "####################",
    "####################",
    "##########.#########",
    "##########.#########",
    "#########G.#########",
  ]);
  const out = turn(worldOf(layout), layout);
  const after = tokenAt(out.world, "gob");
  assert.ok(chebyshev(after, at(3, 3)) <= chebyshev(at(9, 9), at(3, 3)), `ended at ${JSON.stringify(after)}, farther than the 6 tiles it began at`);
  assert.deepEqual(after, at(9, 9), "nothing it can reach is nearer, so it holds its ground");
  assert.equal(out.moved, false);
  assert.deepEqual(out.events, []);
});

test("an unreachable hero: of the squares it can reach, the nearest by tiles wins, not the nearest in a straight line", () => {
  // Hero (4,2). Two squares on offer: (7,5), 3 tiles off on the diagonal (18
  // squared), and (8,2), 4 tiles off along the row (16 squared). By tiles the
  // diagonal one is nearer, and the 30 ft. turn is long enough to reach it.
  const layout = drawn([
    "####################",
    "####################",
    "####H###.###########",
    "########.###########",
    "########.###########",
    "#######..###########",
    "########.###########",
    "########.###########",
    "########..G#########",
  ]);
  const out = turn(worldOf(layout), layout);
  assert.deepEqual(tokenAt(out.world, "gob"), at(7, 5), "the 3 tile square, not the 4 tile one that only looks nearer by the ruler");
  assert.equal(out.path.length, 4);
});

test("an unreachable hero: squares equally near by tiles go to the cheaper one, not the one round the back", () => {
  // Hero (10,10). (8,11), one step from the goblin, is 2 tiles off and so are
  // (10,8) and its neighbours, a 14 step walk round the back that happens to be
  // a hair nearer in a straight line (4 squared against 5). A goblin should
  // take the step, not set off round the back and end its turn no nearer.
  const layout = drawn([
    "####################",
    "####################",
    "####################",
    "####################",
    "####################",
    "####################",
    "####################",
    "####################",
    "##########....######",
    "#############.######",
    "##########H##.######",
    "#######G.####.######",
    "#######.#####.######",
    "#######.......######",
  ]);
  const out = turn(worldOf(layout), layout);
  assert.deepEqual(tokenAt(out.world, "gob"), at(8, 11));
  assert.deepEqual(out.path, [at(8, 11)]);
});

test("an unreachable hero: a way round that leads away first is not walked half way and left there", () => {
  // The goblin at (8,5) is 5 tiles from the hero at (3,3). Its only way out is
  // east, up and back west along the top row, and the first squares of it are
  // 6 and 7 tiles off. A goblin that stops mid-way (the old turn walked the
  // route as far as its speed paid) ends the turn farther than it began.
  const layout = drawn([
    "####################",
    "####################",
    "#####......#########",
    "###H######.#########",
    "##########.#########",
    "########G..#########",
  ]);
  const slow = turn(worldOf(layout), layout, { economy: resetTurnEconomy(15) });
  assert.deepEqual(tokenAt(slow.world, "gob"), at(8, 5), "3 squares would end it at (10,3), 7 tiles off: it stays");
  assert.deepEqual(slow.path, []);
  assert.equal(slow.economy.movementRemaining, 15, "and keeps its movement");
  assert.deepEqual(slow.events, []);

  // Given the movement to come back the other side it takes the whole way: the
  // rule is about where the turn ENDS, not about every square it passes.
  const quick = turn(worldOf(layout), layout, { economy: resetTurnEconomy(30) });
  assert.deepEqual(tokenAt(quick.world, "gob"), at(7, 2), "6 squares, ending 4 tiles off, nearer than it began");
  assert.equal(quick.path.length, 6);
  assert.ok(chebyshev(at(7, 2), at(3, 3)) < chebyshev(at(8, 5), at(3, 3)));
});

test("an unreachable hero, fuzzed: across random walled rooms no turn ever ends farther away in tiles", () => {
  // A seeded sweep, because the fixed layouts above are the shapes that were
  // thought of. Hero walled in on every side; goblin anywhere else on the floor.
  let state = 0x9e3779b9;
  const rand = () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    return state / 0x100000000;
  };
  let turns = 0;
  for (let n = 0; n < 400; n++) {
    const density = 0.08 + rand() * 0.25;
    const rows: string[][] = Array.from({ length: CELL_HEIGHT }, (_, y) =>
      Array.from({ length: CELL_WIDTH }, (_, x) => (x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1 || rand() < density ? "#" : ".")),
    );
    const pick = () => at(1 + Math.floor(rand() * (CELL_WIDTH - 2)), 1 + Math.floor(rand() * (CELL_HEIGHT - 2)));
    const h = pick();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = h.x + dx;
      const y = h.y + dy;
      if ((dx || dy) && x > 0 && y > 0 && x < CELL_WIDTH - 1 && y < CELL_HEIGHT - 1) rows[y]![x] = "#";
    }
    rows[h.y]![h.x] = "H";
    const g = pick();
    if (rows[g.y]![g.x] !== "." || chebyshev(g, h) <= 1) continue;
    rows[g.y]![g.x] = "G";
    const layout = drawn(rows.map((r) => r.join("")));
    const out = turn(worldOf(layout), layout);
    turns++;
    assert.ok(
      chebyshev(tokenAt(out.world, "gob"), h) <= chebyshev(g, h),
      `layout ${n}: hero ${JSON.stringify(h)}, goblin ${JSON.stringify(g)} ended at ${JSON.stringify(tokenAt(out.world, "gob"))}`,
    );
  }
  assert.ok(turns > 300, `the sweep should have exercised plenty of turns, ran ${turns}`);
});

test("a monster with a clear run does what it always did: closes the distance and swings", () => {
  const layout = room([hero(10, 7), goblin(4, 7)]);
  const out = turn(worldOf(layout), layout, { rng: () => 0.99 });
  assert.equal(out.moved, true);
  assert.equal(out.path.length, 5, "from 6 squares away to the square beside the hero");
  assert.deepEqual(tokenAt(out.world, "gob"), at(9, 7));
  assert.equal(out.lines.length, 1, "and swings with the movement it had left");
  assert.match(out.lines[0]!.text, /NATURAL 20, CRITICAL HIT/);
  assert.ok(out.sheet.currentHp < knight().currentHp);
});

test("a monster whose hero is missing, or already dead, does nothing at all", () => {
  const layout = room([goblin(4, 7)]);
  const lonely = worldOf(layout);
  const none = turn(lonely, layout);
  assert.equal(none.world, lonely, "no hero on the board: the world is handed back untouched");
  assert.deepEqual([none.moved, none.path, none.events, none.lines], [false, [], [], []]);

  const both = room([hero(10, 7), goblin(4, 7)]);
  const world = worldOf(both);
  const dead = turn(world, both, { sheet: { ...knight(), dead: true } });
  assert.equal(dead.world, world);
  assert.deepEqual(dead.events, []);
});

// ── the round's real economy, at the monster's own speed ────────────────

test("a monster spends the movement its economy has: 10 ft. is two squares, not a fresh six", () => {
  const layout = room([hero(2, 7), goblin(14, 7)]);
  const out = turn(worldOf(layout), layout, { economy: resetTurnEconomy(10) });
  assert.equal(out.path.length, 2);
  assert.deepEqual(tokenAt(out.world, "gob"), at(12, 7));
  assert.equal(out.economy.movementRemaining, 0);
  assert.equal(out.economy.action, true, "it did not get near enough to use its action");
});

test("a monster handed only a speed builds its economy from it", () => {
  const layout = room([hero(2, 7), goblin(14, 7)]);
  assert.equal(turn(worldOf(layout), layout, { speedFt: 10 }).path.length, 2);
  assert.equal(turn(worldOf(layout), layout, { speedFt: 0 }).path.length, 0, "a creature that cannot move does not");
  assert.equal(turn(worldOf(layout), layout).path.length, 6, "the engine's 30 ft. when told nothing");
});

test("swinging spends the action, and movement it did not use is left over", () => {
  const layout = room([hero(10, 7), goblin(9, 7)]);
  const out = turn(worldOf(layout), layout);
  assert.equal(out.economy.action, false);
  assert.equal(out.economy.movementRemaining, 30);
});

test("a monster whose action is already spent does not swing a second time", () => {
  const layout = room([hero(10, 7), goblin(9, 7)]);
  const spent = { ...resetTurnEconomy(30), action: false };
  const out = turn(worldOf(layout), layout, { economy: spent });
  assert.deepEqual(out.lines, []);
  assert.deepEqual(out.events, []);
  assert.equal(out.readout, null);
  assert.equal(out.sheet.currentHp, knight().currentHp);
});

test("runHostileTurns hands each hostile ITS OWN speed and economy, and keeps the spent economy on the round", () => {
  // Before this the round's hostile economy was decorative: resolveMonsterTurn
  // built a fresh 30 ft. one of its own and runHostileTurns dropped `speedFt`,
  // so a 10 ft. creature walked 30.
  const layout = room([hero(2, 7), goblin(14, 7)]);
  const round = roundOf([PC, "gob"], { gob: 10 }, 1);
  const out = runHostileTurns({
    round,
    world: worldOf(layout),
    cell: CELL,
    manifest: MANIFEST,
    playerTokenId: PC,
    sheet: knight(),
    namer: namerFor(layout),
    rng: () => 0.5,
  });
  assert.deepEqual(tokenAt(out.world, "gob"), at(12, 7), "two squares, at its 10 ft. speed");
  assert.equal(activeCombatant(out.round)?.id, PC, "control comes back to the player");
  assert.equal(out.round.roundNumber, 2, "and the order wrapped");
  const gob = out.round.order.find((c) => c.id === "gob")!;
  assert.equal(gob.economy.movementRemaining, 0, "the round remembers the movement it spent");
  assert.equal(activeCombatant(out.round)!.economy.movementRemaining, 30, "the player's turn starts fresh");
});

// ── every event, in order ───────────────────────────────────────────────

test("a move event carries where the token started and every square it entered", () => {
  const layout = divided([hero(8, 3), goblin(14, 3)]);
  const out = turn(worldOf(layout), layout);
  assert.equal(out.events.length, 1);
  const move = out.events[0]!;
  assert.equal(move.kind, "move");
  if (move.kind !== "move") return;
  assert.equal(move.tokenId, "gob");
  assert.deepEqual(move.from, at(14, 3));
  assert.deepEqual(move.path, out.path);
  let prev = move.from;
  for (const step of move.path) {
    assert.equal(chebyshev(prev, step), 1, "a walk the animation can step through one square at a time");
    prev = step;
  }
});

test("a walk then a swing: move, attack, then damage or miss, in that order", () => {
  const layout = room([hero(10, 7), goblin(4, 7)]);
  const hit = turn(worldOf(layout), layout, { rng: () => 0.99, sheet: sturdy() });
  assert.deepEqual(kinds(hit.events), ["move", "attack", "damage"]);
  const miss = turn(worldOf(layout), layout, { rng: () => 0 });
  assert.deepEqual(kinds(miss.events), ["move", "attack", "miss"], "a natural 1 misses");
  const attack = miss.events[1]!;
  assert.equal(attack.kind === "attack" && attack.result.fumble, true);
  assert.equal(attack.kind === "attack" && attack.by, "gob");
  assert.equal(attack.kind === "attack" && attack.against, PC);
});

test("the damage event is the number the log sentence prints, and the engine's own roll", () => {
  const layout = room([hero(10, 7), goblin(9, 7)]);
  const out = turn(worldOf(layout), layout, { rng: () => 0.99, sheet: sturdy() });
  const damage = out.events.find((e) => e.kind === "damage");
  assert.ok(damage && damage.kind === "damage");
  if (!damage || damage.kind !== "damage") return;
  assert.equal(damage.tokenId, PC);
  assert.equal(damage.critical, true, "a natural 20");
  assert.match(out.lines[0]!.text, new RegExp(`\\b${damage.amount} damage\\b`), "the sentence and the float say the same number");
  assert.equal(sturdy().currentHp - out.sheet.currentHp, damage.amount, "and it is what came off the sheet");
  assert.equal(damage.hpLost, damage.amount, "a hero with hit points to spare loses all of it");
});

test("a hit on a hero already at 0: the rolled amount is reported, hpLost is 0, and it is a death save that fails", () => {
  // applyDamage records a failed death save for a hero who is down, and takes
  // no hit points off. The sentence still prints the rolled number, so `amount`
  // keeps matching it; `hpLost` is what a screen floats, and here it is 0.
  const layout = room([hero(10, 7), goblin(9, 7)]);
  const downed: CharacterSheet = { ...knight(), currentHp: 0, downed: true };
  const out = turn(worldOf(layout), layout, { rng: () => 0.99, sheet: downed });
  const damage = out.events.find((e): e is Extract<CombatEvent, { kind: "damage" }> => e.kind === "damage");
  assert.ok(damage, "the hit is still an event");
  assert.ok(damage.amount > 0, "with the roll the sentence prints");
  assert.match(out.lines[0]!.text, new RegExp(`\\b${damage.amount} damage\\b`));
  assert.equal(damage.hpLost, 0, "but no hit points came off");
  assert.equal(damage.critical, true);
  assert.equal(out.sheet.currentHp, 0);
  assert.equal(out.sheet.deathSaves.failures, 2, "a critical on a downed hero is two failed death saves");
  assert.ok(!kinds(out.events).includes("down"), "and the hero does not go down a second time");
});

test("a blow that takes more than the hero has left reports the whole roll and only the points that were there", () => {
  const layout = room([hero(10, 7), goblin(9, 7)]);
  const out = turn(worldOf(layout), layout, { rng: () => 0.99, sheet: { ...knight(), currentHp: 3 } });
  const damage = out.events.find((e): e is Extract<CombatEvent, { kind: "damage" }> => e.kind === "damage");
  assert.ok(damage);
  assert.ok(damage.amount > 3, "the roll overkills");
  assert.equal(damage.hpLost, 3, "3 points were left to lose");
  assert.equal(out.sheet.currentHp, 0);
  assert.ok(kinds(out.events).includes("down"));
});

test("two monsters: both swings come back, in turn order, each with its own readout", () => {
  // runHostileTurns used to keep only the LAST readout, so with two monsters
  // only the second swing's popup ever showed.
  const layout = room([hero(10, 7), goblin(9, 7, "gob-a"), goblin(11, 7, "gob-b")]);
  const out = runHostileTurns({
    round: roundOf(["gob-a", "gob-b", PC]),
    world: worldOf(layout),
    cell: CELL,
    manifest: MANIFEST,
    playerTokenId: PC,
    sheet: sturdy(),
    namer: namerFor(layout),
    rng: () => 0.99,
  });
  assert.deepEqual(kinds(out.events), ["turnStart", "attack", "damage", "turnStart", "attack", "damage", "turnStart"]);
  const attacks = out.events.filter((e): e is Extract<CombatEvent, { kind: "attack" }> => e.kind === "attack");
  assert.deepEqual(attacks.map((a) => a.by), ["gob-a", "gob-b"]);
  assert.equal(out.dice.length, 2);
  assert.equal(out.resolved.length, 2);
  assert.equal(attacks[1]!.readout, out.readout, "the `readout` field is still the last plate, for the callers that show one");
  assert.notEqual(attacks[0]!.readout, attacks[1]!.readout, "and the first one is not lost");
  const starts = out.events.filter((e) => e.kind === "turnStart");
  assert.deepEqual(starts.map((e) => e.kind === "turnStart" && e.combatantId), ["gob-a", "gob-b", PC]);
  assert.ok(starts.every((e) => e.kind === "turnStart" && e.round === 1));
});

test("the turn handed back to the player is an event, carrying the round it starts", () => {
  const layout = room([hero(2, 7), goblin(14, 7)]);
  const out = runHostileTurns({
    round: roundOf([PC, "gob"], {}, 1),
    world: worldOf(layout),
    cell: CELL,
    manifest: MANIFEST,
    playerTokenId: PC,
    sheet: knight(),
    namer: namerFor(layout),
    rng: () => 0.5,
  });
  assert.deepEqual(kinds(out.events), ["turnStart", "move", "turnStart"]);
  const last = out.events[out.events.length - 1]!;
  assert.deepEqual(last, { kind: "turnStart", combatantId: PC, round: 2 }, "the order wrapped, so it is round 2");
});

test("the hero dropping to 0 is one down event, and a second hit on the downed hero does not repeat it", () => {
  const layout = room([hero(10, 7), goblin(9, 7, "gob-a"), goblin(11, 7, "gob-b")]);
  const fragile = { ...knight(), currentHp: 1 };
  const out = runHostileTurns({
    round: roundOf(["gob-a", "gob-b", PC]),
    world: worldOf(layout),
    cell: CELL,
    manifest: MANIFEST,
    playerTokenId: PC,
    sheet: fragile,
    namer: namerFor(layout),
    rng: () => 0.99,
  });
  assert.equal(out.sheet.downed, true);
  const downs = out.events.filter((e) => e.kind === "down");
  assert.equal(downs.length, 1);
  assert.deepEqual(downs[0], { kind: "down", tokenId: PC });
  // Order: the damage that did it comes first.
  const i = kinds(out.events).indexOf("down");
  assert.equal(out.events[i - 1]!.kind, "damage");
  // The first blow took the hero's one hit point; the second landed on a hero
  // already down, which is a death save failing and no hit points.
  const hits = out.events.filter((e): e is Extract<CombatEvent, { kind: "damage" }> => e.kind === "damage");
  assert.deepEqual(hits.map((h) => h.hpLost), [1, 0]);
  assert.ok(hits.every((h) => h.amount > 1), "both report the damage rolled");
  assert.equal(out.sheet.deathSaves.failures, 2);
});

test("runHostileTurns finding the player already acting is a no-op with no events", () => {
  const layout = room([hero(10, 7), goblin(9, 7)]);
  const round = roundOf([PC, "gob"]);
  const sheet = knight();
  const out = runHostileTurns({
    round,
    world: worldOf(layout),
    cell: CELL,
    manifest: MANIFEST,
    playerTokenId: PC,
    sheet,
    namer: namerFor(layout),
    rng: () => 0.99,
  });
  assert.equal(out.round, round);
  assert.equal(out.sheet, sheet);
  assert.deepEqual(out.events, []);
  assert.equal(out.readout, null);
});

// ── attackEvents: one source of truth for what a swing looks like ───────

const result = (over: Partial<AttackResult> = {}): AttackResult => ({ roll: 12, total: 15, hit: true, critical: false, fumble: false, ...over });
const readout: ReadoutView = { roll: 12, modifier: 3, total: 15, target: 13, hit: true, caption: "Maddik attacks the goblin" };

test("attackEvents: a hit is attack then damage; a miss is attack then miss", () => {
  const hit = attackEvents({ by: PC, against: "gob", result: result(), readout, damage: 6 });
  assert.deepEqual(hit, [
    { kind: "attack", by: PC, against: "gob", result: result(), readout },
    { kind: "damage", tokenId: "gob", amount: 6, hpLost: 6, critical: false },
  ]);
  const miss = attackEvents({ by: PC, against: "gob", result: result({ hit: false, total: 9 }), readout });
  assert.deepEqual(kinds(miss), ["attack", "miss"]);
  assert.deepEqual(miss[1], { kind: "miss", tokenId: "gob" });
});

test("attackEvents: a critical says so on the damage, and a killing blow ends with down", () => {
  const crit = attackEvents({ by: PC, against: "gob", result: result({ critical: true, roll: 20 }), readout, damage: 14, down: true });
  assert.deepEqual(kinds(crit), ["attack", "damage", "down"]);
  assert.deepEqual(crit[1], { kind: "damage", tokenId: "gob", amount: 14, hpLost: 14, critical: true });
  assert.deepEqual(crit[2], { kind: "down", tokenId: "gob" });
});

test("attackEvents: hpLost is the caller's figure, kept apart from the damage rolled", () => {
  // Overkill: 14 rolled, 5 hit points were there.
  const overkill = attackEvents({ by: "gob", against: PC, result: result(), readout, damage: 14, hpLost: 5, down: true });
  assert.deepEqual(overkill[1], { kind: "damage", tokenId: PC, amount: 14, hpLost: 5, critical: false });
  // A hit on a creature already at 0: the event is still there (the screen
  // shows the death save), and it says no hit points moved.
  const downed = attackEvents({ by: "gob", against: PC, result: result({ critical: true, roll: 20 }), readout, damage: 9, hpLost: 0 });
  assert.deepEqual(downed[1], { kind: "damage", tokenId: PC, amount: 9, hpLost: 0, critical: true });
  // Left out, it is the whole of the damage: right for a target with points to spare.
  const plain = attackEvents({ by: PC, against: "gob", result: result(), readout, damage: 6 });
  assert.equal(plain[1]!.kind === "damage" && plain[1]!.hpLost, 6);
});

test("attackEvents: a hit that rolled 0 reports no damage number, and the attack still says it landed", () => {
  const nothing = attackEvents({ by: PC, against: "gob", result: result(), readout, damage: 0 });
  assert.deepEqual(kinds(nothing), ["attack"]);
  assert.deepEqual(kinds(attackEvents({ by: PC, against: "gob", result: result(), readout })), ["attack"], "no damage given at all is the same");
});
