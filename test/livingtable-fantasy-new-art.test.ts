import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, SPRITES, STRUCTURE_SEAMS, type Sprite } from "../scripts/assets/fantasy";

/**
 * The art the first adventure (The Rat Cellar) needs: two rats, a village
 * home, workshop, tavern and cellar's worth of props, and the floor and wall
 * tiles for them. test/livingtable-assets-fantasy.test.ts already holds every
 * one of these sprites to the roster-wide rules (token separation, colour,
 * eyes, silhouettes, glow clearance and the rest); this file holds the
 * contract that is specific to them: that each exists once, is the right
 * size and kind, is walkable or not as the adventure expects, and keeps the
 * choices its authoring comments promise.
 */

const RATS = ["token_rat", "token_giant_rat"] as const;

/** id -> walkable, exactly as the first adventure lists them. */
const PROPS: Record<string, boolean> = {
  barrel: false,
  crate: false,
  crate_stack: false,
  bar_counter_w: false,
  bar_counter_mid: false,
  bar_counter_e: false,
  stool: true,
  chair: true,
  workbench: false,
  anvil: false,
  hearth: false,
  shelf: false,
  rug: true,
  stairs_down: true,
  ladder_up: true,
  rat_hole: true,
  tunnel_mouth: true,
  sack: true,
  cobweb: true,
};

const TILES: Record<string, boolean> = {
  floor_wood: true,
  floor_wood_b: true,
  wall_earth: false,
  wall_earth_b: false,
};

/** Flat things: no black boundary is derived round them. */
const FLAT_PROPS = ["rug", "cobweb"] as const;

const ALL_NEW_IDS = [...RATS, ...Object.keys(PROPS), ...Object.keys(TILES)];

function byId(assetId: string): Sprite {
  const matches = SPRITES.filter((s) => s.assetId === assetId);
  assert.equal(matches.length, 1, `${assetId} ships ${matches.length} times, expected exactly once`);
  return matches[0]!;
}

function luma(index: number): number {
  const [r, g, b] = PALETTE[index]!;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mean(sprite: Sprite): number {
  const values = sprite.pixels.flat().filter((v) => v !== -1);
  return values.reduce((sum, v) => sum + luma(v), 0) / values.length;
}

function opaque(sprite: Sprite): number {
  return sprite.pixels.flat().filter((v) => v !== -1).length;
}

test("every new id ships exactly once, and the ids are unique across the whole roster", () => {
  for (const id of ALL_NEW_IDS) byId(id);
  const ids = SPRITES.map((s) => s.assetId);
  assert.equal(new Set(ids).size, ids.length, "duplicate assetId in SPRITES");
  assert.equal(new Set(ALL_NEW_IDS).size, ALL_NEW_IDS.length, "an id is listed twice in this test");
});

test("every new sprite is 16x16 with only valid, non-glow palette indices", () => {
  for (const id of ALL_NEW_IDS) {
    const sprite = byId(id);
    assert.equal(sprite.size, 16, `${id} declares size ${sprite.size}`);
    assert.equal(sprite.pixels.length, 16, `${id} has ${sprite.pixels.length} rows, expected 16`);
    for (const [y, row] of sprite.pixels.entries()) {
      assert.equal(row.length, 16, `${id} row ${y} has ${row.length} columns, expected 16`);
      for (const [x, v] of row.entries()) {
        const ok = v === -1 || (Number.isInteger(v) && v >= 0 && v < 48);
        assert.ok(ok, `${id} pixel (${x},${y}) is ${v}: not -1 and not a drawable index below the glow band`);
      }
    }
    assert.ok(opaque(sprite) > 0, `${id} is blank`);
    assert.ok(sprite.name.trim().length > 0, `${id} has no human name`);
  }
});

test("the kinds are right: rats are tokens, furniture is props, the floors and walls are tiles", () => {
  for (const id of RATS) assert.equal(byId(id).kind, "token", `${id} must be a token`);
  for (const id of Object.keys(PROPS)) assert.equal(byId(id).kind, "prop", `${id} must be a prop`);
  for (const id of Object.keys(TILES)) assert.equal(byId(id).kind, "tile", `${id} must be a tile`);
});

test("walkable flags are exactly the adventure's list", () => {
  for (const [id, walkable] of Object.entries(PROPS)) {
    assert.equal(byId(id).walkable, walkable, `${id} walkable should be ${walkable}`);
  }
  for (const [id, walkable] of Object.entries(TILES)) {
    assert.equal(byId(id).walkable, walkable, `${id} walkable should be ${walkable}`);
  }
  for (const id of RATS) assert.equal(byId(id).walkable, false, `${id}: a creature is never terrain`);
});

test("the things that block are the things a player cannot stand on: barrels, crates, counters, benches, anvils, hearths, shelves", () => {
  for (const id of ["barrel", "crate", "crate_stack", "bar_counter_w", "bar_counter_mid", "bar_counter_e", "workbench", "anvil", "hearth", "shelf"]) {
    assert.equal(byId(id).walkable, false, `${id} must block`);
  }
  for (const id of ["stool", "chair", "rug", "stairs_down", "ladder_up", "rat_hole", "tunnel_mouth", "sack", "cobweb"]) {
    assert.equal(byId(id).walkable, true, `${id} must not block`);
  }
});

test("a dug tunnel floor is the dirt that already exists, not a duplicate of it", () => {
  assert.ok(!SPRITES.some((s) => s.assetId === "floor_earth"), "floor_earth duplicates floor_dirt");
  assert.ok(SPRITES.some((s) => s.assetId === "floor_dirt"), "floor_dirt is the tunnel floor and must exist");
});

test("no two new props are the same picture", () => {
  const ids = Object.keys(PROPS);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId(ids[i]!).pixels.flat();
      const b = byId(ids[j]!).pixels.flat();
      let same = 0;
      for (let k = 0; k < a.length; k++) if (a[k] === b[k]) same += 1;
      assert.ok(same < 220, `${ids[i]} and ${ids[j]} agree on ${same}/256 pixels, which is not two different props`);
    }
  }
});

test("floor_wood and wall_earth are opaque tiles with a second variant that is not a copy", () => {
  for (const id of Object.keys(TILES)) {
    assert.ok(byId(id).pixels.flat().every((v) => v !== -1), `${id} has a transparent pixel; a tile covers its whole cell`);
  }
  for (const [a, b] of [["floor_wood", "floor_wood_b"], ["wall_earth", "wall_earth_b"]] as const) {
    const pa = byId(a).pixels.flat();
    const pb = byId(b).pixels.flat();
    let same = 0;
    for (let k = 0; k < pa.length; k++) if (pa[k] === pb[k]) same += 1;
    assert.ok(same < 220, `${a} and ${b} agree on ${same}/256 pixels, which is not a variant`);
  }
});

test("floor_wood stays out of the indices the enchantment glow cannot be told from, and out of the dark band", () => {
  // WOOD (index 2, L130) is 4.6 from the glow's third entry in Rec709, which
  // would put a ring on a floor it could not be told from; the plank floor is
  // drawn in the earth ramp and WOOD_LIGHT instead.
  const allowed = new Set([28, 29, 30, 31, 44]);
  for (const id of ["floor_wood", "floor_wood_b"]) {
    const used = new Set(byId(id).pixels.flat());
    for (const v of used) assert.ok(allowed.has(v), `${id} uses index ${v}, outside the earth ramp and WOOD_LIGHT`);
    const m = mean(byId(id));
    assert.ok(m >= 80 && m <= 160, `${id} has mean luminance ${m.toFixed(1)}, expected 80 to 160 like every walkable floor`);
  }
});

test("a wall reads as a wall: wall_earth is darker than the dirt floor it stands on", () => {
  const dirt = mean(byId("floor_dirt"));
  for (const id of ["wall_earth", "wall_earth_b"]) {
    const m = mean(byId(id));
    assert.ok(m < dirt - 10, `${id} (L${m.toFixed(0)}) is not clearly darker than floor_dirt (L${dirt.toFixed(0)})`);
  }
});

test("every prop but the flat ones has a derived black boundary; the flat ones have none", () => {
  for (const id of Object.keys(PROPS)) {
    const hasBlack = byId(id).pixels.flat().includes(0);
    if ((FLAT_PROPS as readonly string[]).includes(id)) {
      assert.ok(!hasBlack, `${id} is flat and must carry no black rule`);
    } else {
      assert.ok(hasBlack, `${id} has no black boundary`);
    }
  }
});

test("a prop stands on its tile: anything that casts a shadow has its lowest row filled, and nothing runs off the grid", () => {
  for (const id of ["barrel", "crate", "crate_stack", "stool", "chair", "workbench", "anvil", "shelf", "ladder_up", "sack"]) {
    const rows = byId(id).pixels;
    const lowest = rows.reduce((acc, row, y) => (row.some((v) => v !== -1) ? y : acc), -1);
    assert.equal(lowest, 15, `${id}'s lowest opaque row is ${lowest}; its contact shadow should be on row 15`);
  }
});

test("the bar counter is one object in three pieces: registered seams, no gap and no black rule through the join", () => {
  const joins = STRUCTURE_SEAMS.filter((s) => s.a.startsWith("bar_counter_") && s.b.startsWith("bar_counter_"));
  assert.equal(joins.length, 2, "the bar counter needs a left-to-middle and a middle-to-right seam registered");
  assert.deepEqual(
    joins.map((s) => [s.a, s.b, s.axis]),
    [["bar_counter_w", "bar_counter_mid", "h"], ["bar_counter_mid", "bar_counter_e", "h"]],
  );
  for (const seam of joins) {
    const a = byId(seam.a).pixels;
    const b = byId(seam.b).pixels;
    let touching = 0;
    let ruled = 0;
    for (let i = 0; i < 16; i++) {
      const av = a[i]![15]!;
      const bv = b[i]![0]!;
      if (av !== -1 && bv !== -1) touching += 1;
      if (av === 0 && bv === 0) ruled += 1;
    }
    assert.ok(touching >= 10, `${seam.a} and ${seam.b} only meet on ${touching}/16 pixels`);
    assert.ok(ruled <= 4, `${seam.a} and ${seam.b} share a ${ruled}px black rule down the join`);
  }
});

test("the plank seams of the bar counter line up across the pieces", () => {
  // The middle repeats, so its planks have to fall on the same columns as the
  // ends' or a long counter shows a stutter at every join. Row 9 is the first
  // row of panel.
  const w = byId("bar_counter_w").pixels[9]!;
  const m = byId("bar_counter_mid").pixels[9]!;
  const e = byId("bar_counter_e").pixels[9]!;
  const seam = (row: number[]) => row.map((v, x) => (v === 45 ? x : -1)).filter((x) => x >= 0);
  assert.deepEqual(seam(m), [3, 7, 11, 15]);
  for (const x of [3, 7, 11, 15]) assert.equal(w[x], 45, `bar_counter_w misses the plank seam at column ${x}`);
  for (const x of [3, 7, 11]) assert.equal(e[x], 45, `bar_counter_e misses the plank seam at column ${x}`);
});

test("the rats are two sizes of one animal: both 16x16 tokens, the Giant Rat bigger, neither a copy of the other", () => {
  const rat = byId("token_rat");
  const giant = byId("token_giant_rat");
  assert.equal(rat.pixels.length, 16);
  assert.equal(giant.pixels.length, 16);
  assert.ok(opaque(giant) > opaque(rat) * 1.4, `the Giant Rat (${opaque(giant)}px) is not clearly bigger than the Rat (${opaque(rat)}px)`);
  const bbox = (s: Sprite) => {
    let x0 = 16, x1 = -1, y0 = 16, y1 = -1;
    s.pixels.forEach((row, y) => row.forEach((v, x) => { if (v !== -1) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const rb = bbox(rat);
  const gb = bbox(giant);
  assert.ok(gb.w > rb.w && gb.h > rb.h, `the Giant Rat's ${gb.w}x${gb.h} does not exceed the Rat's ${rb.w}x${rb.h} both ways`);
  assert.ok(rb.w <= 13 && rb.h <= 11, `the Rat is ${rb.w}x${rb.h}: a rat is small`);
});

test("the rats' boundary is the fur's own dark step, never black, and under the dark cut", () => {
  // EARTH_DARK (1) on the lit sides and the contact shadow, CRIMSON_DEEP (10)
  // on the shaded ones. See ratOutlined for why: a black rim made a small dark
  // animal fail the token colour rule.
  for (const id of RATS) {
    const sprite = byId(id);
    assert.ok(!sprite.pixels.flat().includes(0), `${id} contains the black outline index, which its rim is not drawn in`);
    for (let y = 0; y < 16; y++) {
      const xs = sprite.pixels[y]!.map((v, x) => (v !== -1 ? x : -1)).filter((x) => x >= 0);
      if (xs.length === 0) continue;
      for (const x of [xs[0]!, xs[xs.length - 1]!]) {
        const v = sprite.pixels[y]![x]!;
        assert.ok(v === 1 || v === 10, `${id} row ${y} ends on index ${v}, expected EARTH_DARK or CRIMSON_DEEP`);
      }
    }
  }
});

test("the rats' eyes are a pair of 1x2 EMBER marks, which is what makes them rats in a dark cellar", () => {
  for (const id of RATS) {
    const sprite = byId(id);
    let eyes = 0;
    for (let y = 2; y <= 9; y++) {
      for (let x = 1; x < 15; x++) {
        if (sprite.pixels[y]![x] !== 15 || sprite.pixels[y + 1]![x] !== 15) continue;
        if (sprite.pixels[y - 1]![x] === 15 || sprite.pixels[y + 2]![x] === 15) continue;
        eyes += 1;
      }
    }
    assert.equal(eyes, 2, `${id} has ${eyes} vertical 1x2 eye marks, expected exactly 2`);
  }
});

test("the Giant Rat shows teeth and the Rat does not, so the two read apart at true size", () => {
  const teeth = (id: string) => byId(id).pixels.flat().filter((v) => v === 5).length;
  assert.ok(teeth("token_giant_rat") >= 2, "the Giant Rat shows no teeth");
  assert.equal(teeth("token_rat"), 0, "the Rat should not bare teeth; that is the Giant Rat's menace");
});

test("the rats stand on the tile floor and keep the roster's contact-shadow grammar", () => {
  for (const id of RATS) {
    const sprite = byId(id);
    const lowest = sprite.pixels.reduce((acc, row, y) => (row.some((v) => v !== -1) ? y : acc), -1);
    assert.equal(lowest, 15, `${id}'s lowest opaque row is ${lowest}, expected 15`);
    const stance = sprite.pixels[14]!.filter((v) => v !== -1).length;
    const shadow = sprite.pixels[15]!.filter((v) => v !== -1).length;
    assert.ok(shadow > 0 && shadow <= stance, `${id}'s shadow is ${shadow}px under a ${stance}px stance`);
  }
});

test("the rats do not overlap any other token's silhouette by more than 0.70, nor each other", () => {
  const tokens = SPRITES.filter((s) => s.kind === "token" && !s.assetId.startsWith("gear_"));
  const mask = (s: Sprite) => [...Array((24 - s.pixels.length) * 16).fill(false), ...s.pixels.flatMap((row) => row.map((v) => v !== -1))];
  for (const id of RATS) {
    const a = mask(byId(id));
    for (const other of tokens) {
      if (other.assetId === id) continue;
      const b = mask(other);
      let inter = 0;
      let union = 0;
      for (let k = 0; k < a.length; k++) {
        if (a[k] && b[k]) inter += 1;
        if (a[k] || b[k]) union += 1;
      }
      assert.ok(inter / union <= 0.7, `${id} vs ${other.assetId}: IoU ${(inter / union).toFixed(2)}`);
    }
  }
});

test("the tunnel mouth and the rat hole are dark openings, not decorations: each has a deep-black centre", () => {
  for (const id of ["tunnel_mouth", "rat_hole"]) {
    const sprite = byId(id);
    const black = sprite.pixels.flat().filter((v) => v === 0).length;
    assert.ok(black >= 20, `${id} has only ${black} black pixels, so it does not read as a hole`);
  }
});

test("the stairs get darker as they go down, ending in black", () => {
  const stairs = byId("stairs_down").pixels;
  const rowMean = (y: number) => {
    const row = stairs[y]!.slice(3, 13).filter((v) => v !== -1);
    return row.reduce((sum, v) => sum + luma(v), 0) / row.length;
  };
  assert.ok(rowMean(2) > rowMean(6), "the first tread is not brighter than the middle of the flight");
  assert.ok(rowMean(6) > rowMean(11), "the middle of the flight is not brighter than its black end");
  assert.ok(rowMean(12) < 30, "the foot of the stairs is not black");
});

test("the hearth has a live fire in it, in the ember ramp", () => {
  const flame = byId("hearth").pixels.flat().filter((v) => v === 15 || v === 42 || v === 13 || v === 5).length;
  assert.ok(flame >= 15, `the hearth shows only ${flame} flame pixels`);
});
