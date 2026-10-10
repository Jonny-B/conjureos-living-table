/**
 * Props drawn in several squares (propGroups.ts) are one thing: a click on any part, the name the DM is told and the feature
 * all agree. Bug bash item 15: the village well is four props (well_nw, well_ne, well_sw, well_se) with its feature on the
 * north-west square only, so three of its squares read as plain scenery and the DM was told "the well ne".
 *
 * Run: npx tsx --test test/livingtable-prop-groups.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { bindBenchDefaults } from "../scripts/asset-bench/benchHost";
import { adventureById, adventureHero } from "../src/games/livingtable/table/adventureCatalog";
import { advBoard, advPropWords, enterLocation, featureAtSquare, newAdventurePlay } from "../src/games/livingtable/table/adventureRun";
import { lookableAt, whatIsAt } from "../src/games/livingtable/table/dmScene";
import { blockedWords } from "../src/games/livingtable/table/sight";
import { footprintAt, groupNameOf, groupWords, propGroupAt } from "../src/games/livingtable/table/propGroups";
import type { XY } from "../src/games/livingtable/table/state";

const prop = (assetId: string, x: number, y: number) => ({ assetId, x, y });
const key = (t: XY): string => `${t.x},${t.y}`;

test("the part word is taken off the end of a name; a name with none stands alone", () => {
  assert.equal(groupNameOf("well_nw"), "well");
  assert.equal(groupNameOf("bar_counter_mid"), "bar_counter");
  assert.equal(groupNameOf("stair_up_e"), "stair_up");
  assert.equal(groupNameOf("bed_head"), "bed");
  assert.equal(groupNameOf("barrel"), null);
  assert.equal(groupNameOf("cottage_door"), null, "a door is not a part word");
  assert.equal(groupWords("well_se"), "well");
  assert.equal(groupWords("bar_counter_w"), "bar counter");
  assert.equal(groupWords("barrel"), "barrel");
});

test("propGroupAt: the four squares of a well are one group, whichever is asked", () => {
  const well = [prop("well_nw", 5, 5), prop("well_ne", 6, 5), prop("well_sw", 5, 6), prop("well_se", 6, 6)];
  const all = [...well, prop("barrel", 7, 5), prop("cottage_nw", 2, 2)];
  for (const part of well) {
    const group = propGroupAt(all, part);
    assert.deepEqual(group.map(key).sort(), ["5,5", "5,6", "6,5", "6,6"], `from ${key(part)}`);
  }
  assert.deepEqual(propGroupAt(all, { x: 0, y: 0 }), [], "nothing placed there");
});

test("propGroupAt: only touching parts of the same thing join; a lone prop and two side-by-side barrels stay single", () => {
  const props = [prop("barrel", 3, 3), prop("barrel", 4, 3), prop("fence_w", 8, 1), prop("fence_mid", 9, 1), prop("fence_e", 10, 1), prop("fence_w", 8, 3)];
  assert.equal(propGroupAt(props, { x: 3, y: 3 }).length, 1, "a barrel has no part word");
  assert.deepEqual(propGroupAt(props, { x: 10, y: 1 }).map(key).sort(), ["10,1", "8,1", "9,1"]);
  assert.equal(propGroupAt(props, { x: 8, y: 3 }).length, 1, "a fence two rows down does not touch the first");
  // A different thing next door is not part of it.
  const mixed = [prop("well_nw", 1, 1), prop("table_w", 2, 1)];
  assert.equal(propGroupAt(mixed, { x: 1, y: 1 }).length, 1);
  // Corners do not join (4 neighbours only).
  assert.equal(propGroupAt([prop("well_nw", 1, 1), prop("well_se", 2, 2)], { x: 1, y: 1 }).length, 1);
});

test("footprintAt: the squares of the thing, or just the square asked when nothing stands there", () => {
  const props = [prop("bed_head", 4, 4), prop("bed_foot", 4, 5)];
  assert.deepEqual(footprintAt(props, { x: 4, y: 5 }).map(key).sort(), ["4,4", "4,5"]);
  assert.deepEqual(footprintAt(props, { x: 9, y: 9 }), [{ x: 9, y: 9 }]);
});

// ---- the real village ------------------------------------------------------------------------------------------------

function village() {
  bindBenchDefaults();
  const a = adventureById("rat-cellar")!;
  const p = newAdventurePlay(a, adventureHero(a, "knight" as never));
  assert.equal(enterLocation(p, "village", { x: 20, y: 12 }), true);
  return p;
}

test("the village well: all four squares resolve to the one feature and the one name", () => {
  const p = village();
  const board = advBoard(p)!;
  const parts = board.props.filter((q) => /^well_/.test(q.assetId));
  assert.equal(parts.length, 4, "the well is four props");
  const seen = new Set<string>();
  for (const part of parts) {
    const f = featureAtSquare(p, part);
    assert.ok(f, `${part.assetId} at ${key(part)} resolves to a feature`);
    assert.equal(f.id, "village_well");
    assert.equal(advPropWords(p, part), "the village well");
    assert.equal(whatIsAt(p, part), "the village well", "the DM is told one name for every part");
    assert.equal(lookableAt(p, part), "prop");
    seen.add(`${f.id}|${whatIsAt(p, part)}`);
  }
  assert.equal(seen.size, 1);
});

test("a barrier made of parts is named for the whole (\"the cottage\", never \"the cottage ne\") in the DM's words and in the way-blocked line", () => {
  const p = village();
  const board = advBoard(p)!;
  const parts = board.props.filter((q) => /^cottage_(nw|n|ne|w|e|sw|s|se)$/.test(q.assetId));
  assert.ok(parts.length >= 8, "the tavern cottage is drawn in parts");
  for (const part of parts) {
    assert.equal(whatIsAt(p, part), "the cottage", key(part));
  }
  const first = parts[0]!;
  p.explored.fill(1);
  assert.match(blockedWords(p, first), /^The cottage is in the way\.$/);
});

test("a single prop keeps its own name (the barrel)", () => {
  const p = village();
  const barrel = advBoard(p)!.props.find((q) => q.assetId === "barrel")!;
  assert.ok(barrel);
  assert.equal(whatIsAt(p, barrel), "the barrel");
});

// ---- what a click does on the board (flows/board.ts) --------------------------------------------------------------------
//
// A left click or a tap SELECTS and WALKS: to the square, or to the square beside whatever stands there. It never acts (the actions
// menu does that), and the board gives no hints: one neutral ring, the walk, a gold ring on a way out that can be entered, and red on
// a square the hero cannot go to.

import { installBoard, type Plan } from "../src/games/livingtable/table/flows/board";
import type { TableCtx } from "../src/games/livingtable/table/tableCtx";
import { addCreature, MONSTER_START, newPlay, type PlayState } from "../src/games/livingtable/table/state";
import { exitIsOpen, exitsHere } from "../src/games/livingtable/table/adventureRun";
import { noteSight } from "../src/games/livingtable/table/sight";
import { tileDistance } from "../src/games/livingtable/world/reach";

type Call = [string, ...unknown[]];

/** A table context with only what the board reads: the scene, a 640 x 480 canvas at 32 px a square, and a canvas that records what is drawn on it. */
function boardOver(p: PlayState): { tc: TableCtx; calls: Call[]; styles: string[]; refused: string[] } {
  const calls: Call[] = [];
  const styles: string[] = [];
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push([k, ...args])),
    set: (t, k: string, v) => {
      t[k] = v;
      if (k === "strokeStyle" || k === "fillStyle") styles.push(String(v));
      return true;
    },
  });
  const refused: string[] = [];
  const tc = {
    st: () => p,
    canvas: { width: 640, height: 480, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) },
    marks: { width: 640, height: 480, getContext: () => ctx },
    tileScale: () => 32,
    busy: false,
    walkQueue: [],
    onArrive: null,
    refuse: (s: string) => void refused.push(s),
    clearOptions: () => {},
  } as unknown as TableCtx;
  installBoard(tc);
  return { tc, calls, styles, refused };
}

const GOLD = "rgba(255, 205, 90, 0.95)";
const RED = /^rgba\(235, 70, 60/;

function villageAt(heroAt: XY) {
  const p = village();
  p.heroAt = { ...heroAt };
  p.explored.fill(1);
  noteSight(p);
  return p;
}

test("a click on any square of the well walks to the square beside the well, never into it, and never acts", () => {
  const p = villageAt({ x: 3, y: 5 });
  const { tc } = boardOver(p);
  const parts = advBoard(p)!.props.filter((q) => /^well_/.test(q.assetId));
  const well = parts.map(key);
  for (const part of parts) {
    const plan: Plan = tc.planFor({ x: part.x, y: part.y });
    assert.equal(plan.kind, "walk", `${part.assetId}: a click only walks`);
    if (plan.kind !== "walk") continue;
    assert.deepEqual(plan.tile, { x: part.x, y: part.y }, "the ring goes on the square that was clicked");
    const end = plan.path[plan.path.length - 1] ?? p.heroAt;
    assert.ok(!well.includes(key(end)), "it stops outside the well");
    assert.ok(parts.some((w) => tileDistance(end, w) === 1), "beside it");
    assert.equal(plan.costFt, plan.path.length * 5);
  }
  // Every part gives the walk to the same square (the whole well is one footprint).
  const ends = new Set(parts.map((part) => { const pl = tc.planFor({ x: part.x, y: part.y }); return pl.kind === "walk" ? key(pl.path.at(-1) ?? p.heroAt) : "x"; }));
  assert.equal(ends.size, 1, "one thing, one approach");
});

test("the same hover marks for every part of the well: a ring and a walk, no verb, no target colour", () => {
  const p = villageAt({ x: 3, y: 5 });
  const parts = advBoard(p)!.props.filter((q) => /^well_/.test(q.assetId));
  const seen: string[][] = [];
  for (const part of parts) {
    const { tc, calls, styles } = boardOver(p);
    tc.hover = { x: part.x, y: part.y };
    tc.drawMarks();
    const words = calls.filter((c) => c[0] === "fillText").map((c) => String(c[1]));
    for (const w of words) assert.match(w, /^\d+ ft$/, "the only words are the walk's length");
    assert.ok(!styles.some((s) => RED.test(s) || s === GOLD), `${part.assetId}: no red, no gold`);
    seen.push([...new Set(styles)].sort());
  }
  for (const s of seen) assert.deepEqual(s, seen[0], "every part draws in the same colours");
});

test("the barrel and a cottage are walked up to the same way (they used to show red)", () => {
  const p = villageAt({ x: 3, y: 5 });
  const { tc } = boardOver(p);
  const barrel = advBoard(p)!.props.find((q) => q.assetId === "barrel")!;
  const cottage = advBoard(p)!.props.find((q) => q.assetId === "cottage_n")!;
  for (const at of [barrel, cottage]) {
    const plan = tc.planFor({ x: at.x, y: at.y });
    assert.equal(plan.kind, "walk", at.assetId);
  }
});

test("a wall and a square never seen are the hero's one 'cannot go there': none, with the reason, drawn red", () => {
  const p = villageAt({ x: 3, y: 5 });
  const { tc, styles } = boardOver(p);
  const wall = { x: 0, y: 0 };
  const plan = tc.planFor(wall);
  assert.equal(plan.kind, "none");
  tc.hover = wall;
  tc.drawMarks();
  assert.ok(styles.some((s) => RED.test(s)), "hovering a wall is red");
  p.explored.fill(0);
  assert.equal(tc.planFor({ x: 9, y: 9 }).kind, "none");
});

test("a way out that can be entered is the one gold mark: its ring and its name; a plain prop has neither", () => {
  const p = villageAt({ x: 3, y: 5 });
  const home = exitsHere(p).find((e) => e.exit.id === "home_door")!;
  assert.ok(home && exitIsOpen(p, home.exit), "the home door is open");
  const { tc, calls, styles } = boardOver(p);
  const plan = tc.planFor(home.at);
  assert.equal(plan.kind, "walk");
  assert.equal(plan.kind === "walk" ? plan.exit?.exit.id : null, "home_door", "tagged as the way out");
  tc.hover = home.at;
  tc.drawMarks();
  assert.ok(styles.includes(GOLD), "the gold ring");
  assert.deepEqual(calls.filter((c) => c[0] === "fillText").map((c) => c[1]), [home.exit.label], "and its name");
  // A plain prop: no gold, no name.
  const plain = boardOver(p);
  plain.tc.hover = { x: 8, y: 6 };
  plain.tc.drawMarks();
  assert.ok(!plain.styles.includes(GOLD));
  assert.ok(!plain.calls.some((c) => c[0] === "fillText" && c[1] === home.exit.label));
});

test("a way out that is shut stays 'you cannot go here': red, with the story's own words, and no gold", () => {
  const p = villageAt({ x: 3, y: 5 });
  const home = exitsHere(p).find((e) => e.exit.id === "home_door")!;
  // Shut it for the test: it asks the story for a condition no one has met.
  home.exit.requires = { flag: "never_set" } as never;
  try {
    const { tc, styles } = boardOver(p);
    const plan = tc.planFor(home.at);
    assert.equal(plan.kind, "none");
    assert.ok(plan.kind === "none" && plan.reason.length > 0);
    tc.hover = home.at;
    tc.drawMarks();
    assert.ok(styles.some((s) => RED.test(s)));
    assert.ok(!styles.includes(GOLD));
  } finally {
    delete home.exit.requires;
  }
});

test("a click on a hostile creature only walks beside it (the swing is the menu's), and the same square is approachCost's answer", () => {
  const p = newPlay("fantasy", "knight" as never, "floor_stone" as never);
  p.heroAt = { x: 13, y: 10 };
  p.creatures = [];
  const goblin = addCreature(p, "token_goblin", MONSTER_START);
  goblin.awake = true;
  p.explored.fill(1);
  noteSight(p);
  const { tc } = boardOver(p);
  const plan = tc.planFor(MONSTER_START);
  assert.equal(plan.kind, "walk");
  if (plan.kind !== "walk") return;
  assert.equal(plan.path.length, 2, "two squares along, then beside it");
  assert.equal(tileDistance(plan.path.at(-1)!, MONSTER_START), 1);
  assert.deepEqual(tc.approachCost(MONSTER_START), { reachable: true, feet: 10 });
  // Beside it already: nothing to walk, so the click is only a selection.
  p.heroAt = { x: 15, y: 10 };
  const near = tc.planFor(MONSTER_START);
  assert.deepEqual(near.kind === "walk" ? near.path : null, []);
  assert.deepEqual(tc.approachCost(MONSTER_START), { reachable: true, feet: 0 });
});

test("approachCost: the nearest part of a thing drawn in several squares wins, and out of reach says so", () => {
  const p = villageAt({ x: 3, y: 5 });
  const { tc } = boardOver(p);
  const near = tc.approachCost({ x: 8, y: 6 });
  const far = tc.approachCost({ x: 9, y: 7 });
  assert.equal(near.reachable, true);
  assert.deepEqual(far, near, "one footprint: every part costs the same walk");
  assert.ok(near.feet > 0);
  p.explored.fill(0);
  assert.deepEqual(tc.approachCost({ x: 8, y: 6 }), { reachable: false, feet: 0 }, "never seen: not reachable");
});
