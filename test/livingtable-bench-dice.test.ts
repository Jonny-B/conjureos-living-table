/**
 * Tests for the asset bench's dice tray (scripts/asset-bench/dice.ts): the pure
 * parts, which is nearly all the logic. The polyhedra (convex, planar, the right
 * counts, numbered with opposite faces adding up), the resting orientations (the
 * face showing the result is always the one most facing the viewer, upright), the
 * software renderer (deterministic, opaque or clear, numerals are the pixelFont
 * glyphs, rotated in quarter turns, never drawn on faces turned away), the skins
 * as data, and the throw plan (deterministic, bounces inside the tray, ends on its
 * slot at its resting orientation). The DOM tray and the skin picker are covered
 * by the browser harness; everything here runs in plain Node, which is also the
 * proof that the module touches no DOM at import time (the bench registry is
 * imported in Node for validation before it reaches a browser).
 *
 * Run: npx tsx --test test/livingtable-bench-dice.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getGlyph } from "../scripts/asset-bench/pixelFont";
import {
  DICE_SKINS,
  DIE_KINDS,
  FOE_DICE_SKINS,
  PLAYER_TRAY_ID,
  TRAY_LOOKS,
  composeTrayDice,
  composeTrayStill,
  paintTray,
  paintTrayEffects,
  renderWhoTag,
  skinById,
  trayLookById,
  trayLookProblems,
  type PixelBuffer,
  DIE_SIDES,
  IDENTITY,
  MIN_DIE_SIZE,
  ROLL_MS,
  WOBBLE_MAX_DEG,
  alignFace,
  contrastRatio,
  faceIndexOf,
  fold,
  frontFace,
  geometry,
  luminance,
  matMul,
  matVec,
  motionAt,
  pickScale,
  planRoll,
  registerDiceSkin,
  renderDie,
  restOrientation,
  rotAxis,
  skinProblems,
  transpose,
  wobbleAt,
  type DiceSkin,
  type DieKind,
  type Mat3,
  type RollLayout,
  type Vec3,
} from "../scripts/asset-bench/dice";

const EXPECTED: Record<DieKind, { v: number; e: number; f: number; sides: number }> = {
  d4: { v: 4, e: 6, f: 4, sides: 4 },
  d6: { v: 8, e: 12, f: 6, sides: 6 },
  d8: { v: 6, e: 12, f: 8, sides: 8 },
  d10: { v: 12, e: 20, f: 10, sides: 10 },
  d12: { v: 20, e: 30, f: 12, sides: 12 },
  d20: { v: 12, e: 30, f: 20, sides: 20 },
};

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function det(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** How far a matrix is from a proper rotation: its distance from the identity once multiplied by its own transpose, and from determinant +1. */
function rotationError(m: Mat3): number {
  const p = matMul(m, transpose(m));
  let worst = Math.abs(det(m) - 1);
  for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs((p[i] as number) - (i % 4 === 0 ? 1 : 0)));
  return worst;
}

/** The angle, in degrees, between two rotations. */
function angleBetween(a: Mat3, b: Mat3): number {
  const r = matMul(a, transpose(b));
  const cos = Math.min(1, Math.max(-1, (r[0] + r[4] + r[8] - 1) / 2));
  return (Math.acos(cos) * 180) / Math.PI;
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** The pixels of a sprite that are exactly this colour. */
function pixelsOf(data: Uint8ClampedArray, size: number, color: string): { x: number; y: number }[] {
  const [r, g, b] = hex(color);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4] === r && data[i * 4 + 1] === g && data[i * 4 + 2] === b && data[i * 4 + 3] === 255) out.push({ x: i % size, y: Math.floor(i / size) });
  }
  return out;
}

function bbox(px: readonly { x: number; y: number }[]): { x0: number; y0: number; x1: number; y1: number; w: number; h: number } {
  const xs = px.map((p) => p.x);
  const ys = px.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const IDENTITY_MAT: Mat3 = IDENTITY;
const bone = DICE_SKINS.find((s) => s.id === "bone") as DiceSkin;
const obsidian = DICE_SKINS.find((s) => s.id === "obsidian") as DiceSkin;

// ---- the solids -------------------------------------------------------------

test("every die has the right numbers of vertices, edges and faces, and satisfies Euler's formula", () => {
  assert.deepEqual([...DIE_KINDS], ["d4", "d6", "d8", "d10", "d12", "d20"]);
  for (const kind of DIE_KINDS) {
    const g = geometry(kind);
    const want = EXPECTED[kind];
    assert.equal(g.vertices.length, want.v, `${kind} vertices`);
    assert.equal(g.edges.length, want.e, `${kind} edges`);
    assert.equal(g.faces.length, want.f, `${kind} faces`);
    assert.equal(g.sides, want.sides);
    assert.equal(DIE_SIDES[kind], want.sides);
    assert.equal(g.vertices.length - g.edges.length + g.faces.length, 2, `${kind} Euler characteristic`);
  }
});

test("every die is convex, every face is flat, and every edge joins exactly two faces", () => {
  for (const kind of DIE_KINDS) {
    const g = geometry(kind);
    assert.ok(Math.abs(Math.max(...g.vertices.map(len)) - 1) < 1e-9, `${kind}: farthest vertex is on the unit sphere`);
    g.faces.forEach((f, i) => {
      assert.ok(Math.abs(len(f.normal) - 1) < 1e-9, `${kind} face ${i}: unit normal`);
      const offset = dot(f.normal, f.centre);
      assert.ok(offset > 0.1, `${kind} face ${i}: the normal points away from the middle`);
      for (const vi of f.verts) assert.ok(Math.abs(dot(f.normal, g.vertices[vi] as Vec3) - offset) < 1e-9, `${kind} face ${i}: flat`);
      for (const v of g.vertices) assert.ok(dot(f.normal, v) <= offset + 1e-9, `${kind} face ${i}: every vertex is behind its plane (convex)`);
      assert.ok(Math.abs(len(f.up) - 1) < 1e-9, `${kind} face ${i}: unit up`);
      assert.ok(Math.abs(dot(f.up, f.normal)) < 1e-9, `${kind} face ${i}: up lies in the face's plane`);
    });
    for (const e of g.edges) assert.notEqual(e.faces[0], e.faces[1], `${kind}: an edge joins two different faces`);
    const sides = g.faces.map((f) => f.verts.length);
    const counts: Record<DieKind, number> = { d4: 3, d6: 4, d8: 3, d10: 4, d12: 5, d20: 3 };
    for (const n of sides) assert.equal(n, counts[kind], `${kind}: face shape`);
  }
});

test("the d10's kite faces are flat because its ring sits at tan(18 degrees) squared of the apex height", () => {
  const g = geometry("d10");
  const ring = g.vertices.filter((v) => Math.abs(v[1]) < 0.5);
  assert.equal(ring.length, 10);
  const h = Math.tan((18 * Math.PI) / 180) ** 2;
  // Vertices were rescaled so the farthest is 1: the apex is at 1, so the ring heights are +-h of it.
  for (const v of ring) assert.ok(Math.abs(Math.abs(v[1]) - h) < 1e-9);
});

test("faces are numbered 1 to sides, once each, and opposite faces add up to sides + 1 (a d4 has none)", () => {
  for (const kind of DIE_KINDS) {
    const g = geometry(kind);
    const nums = g.faces.map((f) => f.number).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: g.sides }, (_, i) => i + 1), `${kind} numbering`);
    if (kind === "d4") continue;
    g.faces.forEach((f, i) => {
      const opposite = g.faces.find((o, j) => j !== i && dot(o.normal, f.normal) < -0.999) as (typeof g.faces)[number];
      assert.ok(opposite, `${kind} face ${i} has an opposite`);
      assert.equal(f.number + opposite.number, g.sides + 1, `${kind}: ${f.number} opposite ${opposite.number}`);
    });
  }
});

// ---- resting orientations ---------------------------------------------------

test("rotation helpers make proper rotations", () => {
  for (const kind of DIE_KINDS) {
    for (let r = 1; r <= DIE_SIDES[kind]; r++) {
      assert.ok(rotationError(restOrientation(kind, r)) < 1e-9, `${kind} ${r}: rest orientation is a rotation`);
      assert.ok(rotationError(alignFace(kind, faceIndexOf(kind, r))) < 1e-9);
    }
  }
  assert.ok(rotationError(rotAxis([0, 0, 1], 1.234)) < 1e-12);
});

test("a settled die shows the requested result: for every die and every result, that face is the one most facing the viewer, upright", () => {
  for (const kind of DIE_KINDS) {
    const g = geometry(kind);
    for (let result = 1; result <= DIE_SIDES[kind]; result++) {
      const rot = restOrientation(kind, result);
      const front = frontFace(kind, rot);
      const face = g.faces[front.index];
      assert.equal(face?.number, result, `${kind}: rolled ${result}, the front face reads ${face?.number}`);
      assert.equal(faceIndexOf(kind, result), front.index);
      assert.ok(front.margin > 0.02, `${kind} ${result}: the front face is clearly ahead of the next (margin ${front.margin.toFixed(3)})`);
      assert.ok(front.facing > 0.8, `${kind} ${result}: it faces the viewer squarely enough to read (${front.facing.toFixed(2)})`);
      // Upright: its up vector, seen on screen, points up to within a quarter turn's rounding (no tipping a numeral sideways).
      const up = matVec(rot, (face as (typeof g.faces)[number]).up);
      assert.equal(Math.abs(Math.round(Math.atan2(up[0], up[1]) / (Math.PI / 2))), 0, `${kind} ${result}: numeral is upright`);
      assert.ok(Math.abs(up[0]) < 0.35, `${kind} ${result}: and not nearly sideways`);
    }
  }
});

test("every die has more headroom than the idle wobble can use, so a waiting die never shows another face", () => {
  for (const kind of DIE_KINDS) {
    const g = geometry(kind);
    let worst = Infinity;
    for (let result = 1; result <= DIE_SIDES[kind]; result++) {
      const zs = g.faces.map((f) => matVec(restOrientation(kind, result), f.normal)[2]).sort((a, b) => b - a);
      const deg = (z: number) => (Math.acos(Math.min(1, z)) * 180) / Math.PI;
      // Turning a die by t degrees moves any face's angle to the viewer by at most t, so half the gap is how far it may be turned.
      worst = Math.min(worst, (deg(zs[1] as number) - deg(zs[0] as number)) / 2);
    }
    assert.ok(worst > WOBBLE_MAX_DEG, `${kind}: headroom ${worst.toFixed(1)} degrees against a wobble of up to ${WOBBLE_MAX_DEG}`);
  }
  // And the wobble really stays inside that: the angle it adds never exceeds WOBBLE_MAX_DEG.
  for (let t = 0; t < 20000; t += 53) for (const phase of [0, 1.1, 2.2, 3.3, 4.4, 5.5]) assert.ok(angleBetween(wobbleAt(IDENTITY_MAT, t, phase).rot, IDENTITY_MAT) <= WOBBLE_MAX_DEG + 1e-9);
});

test("a waiting die's wobble never changes which face is in front", () => {
  for (const kind of DIE_KINDS) {
    for (let result = 1; result <= DIE_SIDES[kind]; result++) {
      const rest = restOrientation(kind, result);
      const want = faceIndexOf(kind, result);
      for (let t = 0; t < 6000; t += 97) {
        for (const phase of [0, 1.3, 2.6, 3.9, 5.2]) {
          assert.equal(frontFace(kind, wobbleAt(rest, t, phase).rot).index, want, `${kind} ${result} wobble at t=${t} phase=${phase}`);
        }
      }
    }
  }
});

// ---- the renderer -----------------------------------------------------------

test("a die renders the same every time, with every pixel opaque or clear and a clear border", () => {
  for (const kind of DIE_KINDS) {
    const rot = restOrientation(kind, DIE_SIDES[kind]);
    for (const skin of DICE_SKINS) {
      const a = renderDie(kind, rot, skin, 52);
      const b = renderDie(kind, rot, skin, 52);
      assert.deepEqual(a.data, b.data, `${kind} ${skin.id}: deterministic`);
      assert.equal(a.data.length, 52 * 52 * 4);
      let opaque = 0;
      for (let i = 0; i < 52 * 52; i++) {
        const alpha = a.data[i * 4 + 3];
        assert.ok(alpha === 0 || alpha === 255, `${kind} ${skin.id}: alpha is ${alpha}`);
        if (alpha === 255) opaque++;
        const x = i % 52;
        const y = Math.floor(i / 52);
        if (x === 0 || y === 0 || x === 51 || y === 51) assert.equal(alpha, 0, `${kind} ${skin.id}: the sprite's border is clear`);
      }
      assert.ok(opaque > 52 * 52 * 0.2, `${kind} ${skin.id}: a die fills a fair share of its sprite`);
    }
  }
});

test("a resting die is centred in its sprite and a d20 reads as the biggest of the set", () => {
  const spans: Record<string, number> = {};
  for (const kind of DIE_KINDS) {
    let cx = 0;
    let cy = 0;
    let n = 0;
    let span = 0;
    for (let result = 1; result <= DIE_SIDES[kind]; result++) {
      const px: { x: number; y: number }[] = [];
      const s = renderDie(kind, restOrientation(kind, result), bone, 52, { numerals: false });
      for (let i = 0; i < 52 * 52; i++) if (s.data[i * 4 + 3]) px.push({ x: i % 52, y: Math.floor(i / 52) });
      const b = bbox(px);
      cx += (b.x0 + b.x1 + 1) / 2;
      cy += (b.y0 + b.y1 + 1) / 2;
      n++;
      span = Math.max(span, b.w, b.h);
    }
    spans[kind] = span;
    assert.ok(Math.abs(cx / n - 26) < 1.5 && Math.abs(cy / n - 26) < 1.5, `${kind}: centred (${(cx / n).toFixed(1)}, ${(cy / n).toFixed(1)})`);
    assert.ok(span >= 38 && span <= 51, `${kind}: fills 38 to 51 px of a 52 px sprite (${span})`);
  }
  assert.equal(Math.max(...Object.values(spans)), spans.d20);
});

test("the front numeral is a pixelFont glyph, upright and crisp: a face-on d6 shows the 5 by 7 glyph pixel for pixel", () => {
  for (const result of [1, 2, 3, 4, 5, 6]) {
    const rot = alignFace("d6", faceIndexOf("d6", result));
    const s = renderDie("d6", rot, obsidian, 52);
    const ink = pixelsOf(s.data, 52, obsidian.numeral);
    const b = bbox(ink);
    const glyph = getGlyph(String(result)).rows.slice(0, 7);
    // The glyph's own inked columns (a digit keeps its whole 5).
    const want = new Set<string>();
    glyph.forEach((row, y) => [...row].forEach((c, x) => c === "#" && want.add(`${x},${y}`)));
    const got = new Set(ink.map((p) => `${p.x - b.x0},${p.y - b.y0}`));
    const wantBox = bbox([...want].map((k) => ({ x: Number(k.split(",")[0]), y: Number(k.split(",")[1]) })));
    // Compare relative to the ink's own top-left, so a digit's blank columns do not matter.
    const norm = (set: Set<string>, ox: number, oy: number) => new Set([...set].map((k) => `${Number(k.split(",")[0]) - ox},${Number(k.split(",")[1]) - oy}`));
    assert.deepEqual(norm(got, 0, 0), norm(want, wantBox.x0, wantBox.y0), `d6 ${result}: the numeral is the font's glyph`);
    assert.equal(s.faces[0]?.number, result);
    assert.equal(s.faces[0]?.shown, true);
  }
});

test("numerals turn in quarter steps only: a die turned a quarter turn about the view axis shows the glyph on its side, not skewed", () => {
  const base = alignFace("d6", faceIndexOf("d6", 4));
  const upright = bbox(pixelsOf(renderDie("d6", base, obsidian, 52).data, 52, obsidian.numeral));
  assert.equal(upright.w, 5);
  assert.equal(upright.h, 7);
  for (const turns of [1, 2, 3]) {
    const rot = matMul(rotAxis([0, 0, 1], (turns * Math.PI) / 2), base);
    const s = renderDie("d6", rot, obsidian, 52);
    const b = bbox(pixelsOf(s.data, 52, obsidian.numeral));
    assert.deepEqual([b.w, b.h], turns % 2 === 1 ? [7, 5] : [5, 7], `quarter turns ${turns}`);
  }
  // Nearly a quarter turn rounds to the same quarter: the numeral does not rotate freely with the die.
  const a = renderDie("d6", matMul(rotAxis([0, 0, 1], 0.3), base), obsidian, 52);
  const b = bbox(pixelsOf(a.data, 52, obsidian.numeral));
  assert.deepEqual([b.w, b.h], [5, 7]);
});

test("a d10 shows 10 as '10' (two glyphs wide), and a 6 or a 9 is underlined where the die has both", () => {
  const width = (kind: DieKind, result: number, skin = obsidian): { w: number; h: number } => {
    const s = renderDie(kind, alignFace(kind, faceIndexOf(kind, result)), skin, 56, { numerals: "front" });
    return bbox(pixelsOf(s.data, 56, skin.numeral));
  };
  // The glyph "1" leaves its first column blank, so "10" is 10 inked columns inside two 5 column cells.
  assert.equal(width("d10", 10).w, 10);
  assert.equal(width("d10", 10).h, 7);
  for (const kind of ["d10", "d12", "d20"] as const) {
    assert.equal(width(kind, 6).h, 9, `${kind} 6 is underlined`);
    assert.equal(width(kind, 9).h, 9, `${kind} 9 is underlined`);
    assert.equal(width(kind, 7).h, 7, `${kind} 7 is not`);
  }
  assert.equal(width("d6", 6).h, 7, "a d6 has no 9 to confuse a 6 with");
  assert.equal(width("d8", 6).h, 7);
});

test("every resting die draws its result numeral, in every skin, and numerals can be switched off", () => {
  for (const kind of DIE_KINDS) {
    for (let result = 1; result <= DIE_SIDES[kind]; result++) {
      for (const skin of DICE_SKINS) {
        const s = renderDie(kind, restOrientation(kind, result), skin, 56);
        const front = s.faces[0];
        assert.equal(front?.number, result, `${kind} ${skin.id} ${result}: nearest face is the result`);
        assert.equal(front?.shown, true, `${kind} ${skin.id} ${result}: its numeral is drawn`);
        assert.ok(pixelsOf(s.data, 56, skin.numeral).length >= 5, `${kind} ${skin.id} ${result}: numeral pixels are on screen`);
      }
    }
  }
  const off = renderDie("d20", restOrientation("d20", 20), obsidian, 56, { numerals: false });
  assert.equal(pixelsOf(off.data, 56, obsidian.numeral).length, 0);
  assert.ok(off.faces.every((f) => !f.shown));
});

test("faces turned away carry no numeral, and a face is listed only if it can be seen", () => {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0.64, 0.48], [-0.48, 0.6, -0.64]];
  for (const kind of DIE_KINDS) {
    for (const axis of axes) {
      for (const angle of [0.4, 1.1, 2.2, 3.5, 5]) {
        const rot = matMul(rotAxis(axis, angle), restOrientation(kind, 1));
        const g = geometry(kind);
        const s = renderDie(kind, rot, bone, 52);
        assert.ok(s.faces.length >= 1 && s.faces.length <= g.faces.length);
        s.faces.forEach((f, rank) => {
          assert.ok(f.facing > 0, `${kind}: only front-facing faces are listed`);
          if (f.shown && rank > 0) assert.ok(f.facing >= 0.5, `${kind}: a numeral on a face turned only ${f.facing.toFixed(2)} toward you`);
          if (rank > 0) assert.ok(f.facing <= (s.faces[rank - 1]?.facing ?? 1) + 1e-12, "nearest first");
        });
        const hidden = g.faces.filter((_, i) => matVec(rot, g.faces[i]?.normal as Vec3)[2] <= 0.01).length;
        assert.equal(s.faces.length + hidden, g.faces.length);
      }
    }
  }
});

test("a pattern sticks to the die as it turns, and a plain skin has none", () => {
  const arcane = DICE_SKINS.find((s) => s.id === "arcane") as DiceSkin;
  const speck = hex(arcane.pattern?.color ?? "#000000");
  // Count the pixels the pattern changed: the same die with the pattern taken off, compared pixel by pixel.
  const plain: DiceSkin = { ...arcane, pattern: undefined };
  const count = (rot: Mat3) => {
    const a = renderDie("d20", rot, arcane, 56, { numerals: false }).data;
    const b = renderDie("d20", rot, plain, 56, { numerals: false }).data;
    let n = 0;
    for (let i = 0; i < 56 * 56 * 4; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
    return n;
  };
  assert.ok(speck.length === 3);
  const rest = restOrientation("d20", 20);
  assert.ok(count(rest) > 10, "speckle shows");
  assert.ok(count(matMul(rotAxis([0, 0, 1], 0.5), rest)) > 10, "and still shows after a turn");
  // Marble differs between two orientations (it is a texture in the die's own space, not on the screen).
  const magma = DICE_SKINS.find((s) => s.id === "magma") as DiceSkin;
  const a = renderDie("d12", restOrientation("d12", 3), magma, 52, { numerals: false });
  const b = renderDie("d12", restOrientation("d12", 8), magma, 52, { numerals: false });
  assert.notDeepEqual(a.data, b.data);
});

test("the finishes show: gloss and metal add their highlight colour, matte does not", () => {
  const rest = restOrientation("d20", 20);
  for (const skin of DICE_SKINS) {
    const shine = skin.shine ?? "#000000";
    const n = pixelsOf(renderDie("d20", rest, skin, 56, { numerals: false }).data, 56, shine).length;
    if (skin.finish === "matte") assert.equal(skin.shine, undefined, `${skin.id}: a matte skin needs no shine`);
    else assert.ok(n >= 3, `${skin.id}: the ${skin.finish} finish paints its highlight (${n} px)`);
  }
});

// ---- the skins --------------------------------------------------------------

test("the shipped skins are well formed, with a free default and at least five premium ones", () => {
  assert.ok(DICE_SKINS.length >= 6);
  assert.equal(DICE_SKINS[0]?.id, "bone");
  assert.equal(DICE_SKINS[0]?.priceCredits, 0);
  assert.ok(DICE_SKINS.filter((s) => s.priceCredits > 0).length >= 5);
  assert.equal(new Set(DICE_SKINS.map((s) => s.id)).size, DICE_SKINS.length, "ids are unique");
  assert.equal(new Set(DICE_SKINS.map((s) => s.name)).size, DICE_SKINS.length, "names are unique");
  for (const skin of DICE_SKINS) {
    assert.deepEqual(skinProblems(skin), [], skin.id);
    // The ramp runs light to dark, the edge is darker than all of it.
    const lum = skin.ramp.map(luminance);
    for (let i = 1; i < lum.length; i++) assert.ok((lum[i] as number) < (lum[i - 1] as number), `${skin.id}: ramp step ${i} is darker than step ${i - 1}`);
    assert.ok(luminance(skin.edge) < (lum[lum.length - 1] as number), `${skin.id}: the edge is darker than the darkest body step`);
    // The numeral reads on the three faces that usually carry it, or has a halo that separates it.
    for (const tone of skin.ramp.slice(0, 3)) {
      const against = skin.numeralOutline ? Math.max(contrastRatio(skin.numeral, skin.numeralOutline), contrastRatio(skin.numeral, tone)) : contrastRatio(skin.numeral, tone);
      assert.ok(against >= 3, `${skin.id}: numeral against ${tone} is only ${against.toFixed(2)}:1`);
    }
    if (skin.numeralOutline) assert.ok(contrastRatio(skin.numeral, skin.numeralOutline) >= 3, `${skin.id}: numeral against its own halo`);
  }
  assert.deepEqual([...new Set(DICE_SKINS.map((s) => s.finish))].sort(), ["gloss", "matte", "metal"], "all three finishes ship");
  assert.ok(DICE_SKINS.some((s) => s.pattern?.kind === "speckle") && DICE_SKINS.some((s) => s.pattern?.kind === "marble"), "speckle and marble both ship");
});

test("a skin is data: a new one registers and renders with no code, a bad or duplicate one is refused", () => {
  const fresh: DiceSkin = { id: "test-jade", name: "Test Jade", priceCredits: 99, ramp: ["#cfe8d0", "#9ec9a4", "#6a9a74"], edge: "#1a2e20", numeral: "#10281a", numeralOutline: null, finish: "gloss" };
  assert.deepEqual(skinProblems(fresh), []);
  assert.ok(skinProblems({ ...fresh, ramp: ["#ffffff", "#000000"] }).length > 0, "two-step ramp");
  assert.ok(skinProblems({ ...fresh, edge: "red" }).length > 0, "named colour");
  assert.ok(skinProblems({ ...fresh, id: "Bad Id" }).length > 0);
  assert.ok(skinProblems({ ...fresh, priceCredits: -1 }).length > 0);
  assert.equal(registerDiceSkin({ ...fresh, id: "bone" }), false, "duplicate id");
  assert.equal(registerDiceSkin({ ...fresh, ramp: ["#fff"] }), false, "bad ramp");
  const before = DICE_SKINS.length;
  assert.equal(registerDiceSkin(fresh), true);
  assert.equal(DICE_SKINS.length, before + 1);
  const s = renderDie("d8", restOrientation("d8", 5), fresh, 48);
  assert.equal(s.faces[0]?.number, 5);
  assert.ok(pixelsOf(s.data, 48, fresh.numeral).length > 0, "a three-step ramp renders");
});

// ---- the tray's scale -------------------------------------------------------

test("the tray is drawn at a whole number of device pixels per tray pixel, about 2 CSS pixels, with enough pixels across for its dice", () => {
  assert.equal(pickScale(300, 1), 2);
  assert.equal(pickScale(358, 1), 2);
  assert.equal(pickScale(300, 1.5), 3);
  assert.equal(pickScale(300, 2), 4);
  assert.equal(pickScale(358, 3), 6);
  assert.equal(pickScale(300, 1.25), 2, "at 1.25 a tray pixel is 1.6 CSS px; 3 device px (2.4) would leave under 140 tray pixels across");
  assert.equal(pickScale(240, 1), 1, "a tray too narrow for 140 pixels at 2x is drawn at 1x");
  for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    for (const css of [240, 300, 320, 358, 360]) {
      const k = pickScale(css, dpr);
      assert.ok(Number.isInteger(k) && k >= 1, `${css}px at ${dpr}: a whole device pixel count`);
      if (css >= 280) assert.ok(Math.floor(css / (k / dpr)) >= 140, `${css}px at ${dpr}: at least 140 tray pixels across (${k})`);
    }
  }
});

// ---- the throw --------------------------------------------------------------

const LAYOUT: RollLayout = {
  bounds: { x0: 30, y0: 36, x1: 112, y1: 56 },
  slots: [{ x: 50, y: 46 }, { x: 72, y: 46 }, { x: 94, y: 46 }, { x: 108, y: 40 }],
  hop: 9,
};

test("fold bounces a straight run off two walls and is exact on a slot", () => {
  assert.equal(fold(5, 0, 10), 5);
  assert.equal(fold(12, 0, 10), 8);
  assert.equal(fold(25, 0, 10), 5);
  assert.equal(fold(-3, 0, 10), 3);
  assert.equal(fold(20, 0, 10), 0);
  for (let u = -200; u <= 200; u += 0.37) {
    const f = fold(u, 30, 112);
    assert.ok(f >= 30 && f <= 112, `${u} folds inside`);
  }
  assert.equal(fold(7, 3, 3), 3, "a zero-width box has one place");
});

test("a throw is deterministic for a seed and different for another", () => {
  const dice = [{ kind: "d20" as const, result: 18 }, { kind: "d6" as const, result: 4 }];
  const a = planRoll(dice, LAYOUT, 42);
  const b = planRoll(dice, LAYOUT, 42);
  const c = planRoll(dice, LAYOUT, 43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (let t = 0; t <= ROLL_MS; t += 40) assert.deepEqual(motionAt(a.dice[0] as (typeof a.dice)[number], t), motionAt(b.dice[0] as (typeof b.dice)[number], t));
});

test("every die ends exactly on its slot at its resting orientation, ~1.2 s after the throw, showing the result", () => {
  assert.ok(ROLL_MS >= 1100 && ROLL_MS <= 1300);
  for (const kind of DIE_KINDS) {
    for (let result = 1; result <= DIE_SIDES[kind]; result++) {
      for (const seed of [1, 7, 99]) {
        const plan = planRoll([{ kind, result }, { kind: "d6", result: 3 }], LAYOUT, seed * 1000 + result);
        assert.equal(plan.duration, ROLL_MS);
        plan.dice.forEach((m, i) => {
          const end = motionAt(m, ROLL_MS);
          assert.equal(end.done, true);
          assert.equal(end.x, LAYOUT.slots[i]?.x);
          assert.equal(end.y, LAYOUT.slots[i]?.y);
          assert.equal(end.z, 0);
          assert.deepEqual(end.rot, m.rest);
          // The folded run really does land on the slot (the plan does not rely on the final snap).
          assert.ok(Math.abs(fold(m.xs.to, m.xs.lo, m.xs.hi) - m.slot.x) < 1e-6, `${kind} ${result}: x run lands on its slot`);
          assert.ok(Math.abs(fold(m.ys.to, m.ys.lo, m.ys.hi) - m.slot.y) < 1e-6, `${kind} ${result}: y run lands on its slot`);
          const front = frontFace(m.kind, end.rot);
          assert.equal(geometry(m.kind).faces[front.index]?.number, m.result);
          assert.ok(motionAt(m, ROLL_MS + 5000).done);
        });
      }
    }
  }
});

test("while it tumbles a die stays inside the tray, never dips below the felt, spins as a rotation, and its spin dies away", () => {
  const plan = planRoll([{ kind: "d20", result: 20 }, { kind: "d8", result: 5 }, { kind: "d6", result: 2 }, { kind: "d4", result: 1 }], LAYOUT, 2024);
  plan.dice.forEach((m) => {
    let lastAngle = Infinity;
    for (let t = 0; t <= ROLL_MS; t += 8) {
      const s = motionAt(m, t);
      assert.ok(s.x >= LAYOUT.bounds.x0 - 1e-9 && s.x <= LAYOUT.bounds.x1 + 1e-9, `x ${s.x} at ${t}`);
      assert.ok(s.y >= LAYOUT.bounds.y0 - 1e-9 && s.y <= LAYOUT.bounds.y1 + 1e-9, `y ${s.y} at ${t}`);
      assert.ok(s.z >= 0 && s.z <= LAYOUT.hop * 1.3, `z ${s.z} at ${t}`);
      assert.ok(rotationError(s.rot) < 1e-9, `rotation at ${t}`);
      if (t >= ROLL_MS * 0.85) {
        const a = angleBetween(s.rot, m.rest);
        assert.ok(a < 12, `at ${t} ms the die is within 12 degrees of rest (${a.toFixed(1)})`);
        assert.ok(a <= lastAngle + 1e-6, "and settling, not wobbling out again");
        lastAngle = a;
      }
    }
    // Early on it is well away from rest nearly all the time (a spin can pass through rest by chance, so not at every instant): it really tumbles.
    let away = 0;
    let samples = 0;
    for (let p = 0.04; p <= 0.5; p += 0.01) {
      samples++;
      if (angleBetween(motionAt(m, m.delay + (ROLL_MS - m.delay) * p).rot, m.rest) > 20) away++;
    }
    assert.ok(away / samples > 0.85, `tumbling for ${away} of ${samples} early samples`);
  });
});

test("dice are thrown a moment apart, a die thrown from the corner is hidden until its turn, one picked up from where it waited is not", () => {
  const dice = [{ kind: "d6" as const, result: 1 }, { kind: "d6" as const, result: 2 }, { kind: "d6" as const, result: 3 }];
  const thrown = planRoll(dice, LAYOUT, 5);
  assert.deepEqual(thrown.dice.map((m) => m.delay), [0, 60, 120]);
  assert.equal(motionAt(thrown.dice[2] as (typeof thrown.dice)[number], 10).visible, false);
  assert.equal(motionAt(thrown.dice[2] as (typeof thrown.dice)[number], 200).visible, true);
  const waited = planRoll(dice, LAYOUT, 5, [{ x: 50, y: 46 }, { x: 72, y: 46 }, { x: 94, y: 46 }]);
  assert.equal(motionAt(waited.dice[2] as (typeof waited.dice)[number], 10).visible, true);
  assert.equal(motionAt(waited.dice[2] as (typeof waited.dice)[number], 10).x, 94, "it has not moved yet");
  for (const m of thrown.dice) assert.ok(m.delay < ROLL_MS * 0.5, "everyone has time to settle");
  // A die picked up from where it waited sits as it was (not showing its result) until its own throw begins.
  const idle = restOrientation("d6", 6);
  const held = planRoll(dice, LAYOUT, 5, [{ x: 50, y: 46, rot: idle }, { x: 72, y: 46, rot: idle }, { x: 94, y: 46, rot: idle }]);
  for (const m of held.dice) {
    assert.deepEqual(motionAt(m, 0).rot, idle, "at the moment of the tap it still shows the waiting face");
    assert.deepEqual(motionAt(m, m.delay - 1).rot, idle);
    assert.deepEqual(motionAt(m, ROLL_MS).rot, m.rest, "and it ends on its result");
  }
  assert.notDeepEqual(motionAt(held.dice[1] as (typeof held.dice)[number], 30).rot, held.dice[1]?.rest, "a die waiting its turn does not show its result");
});

test("an out-of-range result is clamped into the die, so a die can never show a face it does not have", () => {
  const plan = planRoll([{ kind: "d6", result: 99 }, { kind: "d20", result: 0 }], LAYOUT, 1);
  assert.equal(plan.dice[0]?.result, 6);
  assert.equal(plan.dice[1]?.result, 1);
  assert.equal(geometry("d6").faces[faceIndexOf("d6", 99)]?.number, 6);
  assert.equal(geometry("d20").faces[faceIndexOf("d20", -4)]?.number, 1);
});

// ---- numerals show wherever a digit can fit --------------------------------

/** How many pixels a render's numerals changed: the render against the same render with numerals off. */
function numeralPixels(kind: DieKind, rot: Mat3, skin: DiceSkin, size: number): number {
  const on = renderDie(kind, rot, skin, size).data;
  const off = renderDie(kind, rot, skin, size, { numerals: false }).data;
  let n = 0;
  for (let i = 0; i < size * size; i++) if (on[i * 4] !== off[i * 4] || on[i * 4 + 1] !== off[i * 4 + 1] || on[i * 4 + 2] !== off[i * 4 + 2]) n++;
  return n;
}

/** The tray's smallest die, its starting size, and its biggest. */
const TRAY_SIZES = [MIN_DIE_SIZE, 40, 56] as const;

test("a waiting die shows numerals at every tray size: every kind, every result, the whole wobble", () => {
  for (const kind of DIE_KINDS) {
    for (const size of TRAY_SIZES) {
      for (let result = 1; result <= DIE_SIDES[kind]; result++) {
        const rest = restOrientation(kind, result);
        for (const t of [0, 400, 900, 1700]) {
          const { rot } = wobbleAt(rest, t, 1.3);
          const s = renderDie(kind, rot, bone, size);
          assert.equal(s.faces[0]?.number, result, `${kind} ${size} ${result} t=${t}: the wobble keeps the result in front`);
          assert.equal(s.faces[0]?.shown, true, `${kind} ${size} ${result} t=${t}: the front numeral is drawn`);
          assert.ok(numeralPixels(kind, rot, bone, size) >= 5, `${kind} ${size} ${result} t=${t}: numeral pixels on screen`);
        }
      }
    }
  }
});

test("a settled die shows its result at every tray size, in every skin", () => {
  for (const kind of DIE_KINDS) {
    for (const size of TRAY_SIZES) {
      for (const skin of DICE_SKINS) {
        for (let result = 1; result <= DIE_SIDES[kind]; result++) {
          const s = renderDie(kind, restOrientation(kind, result), skin, size);
          assert.equal(s.faces[0]?.number, result);
          assert.equal(s.faces[0]?.shown, true, `${kind} ${size} ${skin.id} ${result}`);
          assert.ok(numeralPixels(kind, restOrientation(kind, result), skin, size) >= 5, `${kind} ${size} ${skin.id} ${result}: numeral pixels`);
        }
      }
    }
  }
});

test("a tumbling die always carries a numeral on the face nearest you, at every size, in every frame", () => {
  const layout: RollLayout = { bounds: { x0: 20, y0: 20, x1: 120, y1: 80 }, slots: [{ x: 70, y: 50 }], hop: 8 };
  for (const kind of DIE_KINDS) {
    for (const size of TRAY_SIZES) {
      for (const seed of [3, 11, 29]) {
        const plan = planRoll([{ kind, result: DIE_SIDES[kind] }], layout, seed);
        const m = plan.dice[0] as (typeof plan.dice)[number];
        for (let t = 0; t < ROLL_MS; t += 60) {
          const { rot } = motionAt(m, t);
          const s = renderDie(kind, rot, bone, size);
          assert.equal(s.faces[0]?.shown, true, `${kind} ${size} seed ${seed} t=${t}`);
          assert.ok(numeralPixels(kind, rot, bone, size) >= 4, `${kind} ${size} seed ${seed} t=${t}: numeral pixels`);
        }
      }
    }
  }
});

test("a small die swaps to the compact digits rather than clip the big ones: a d20 at the smallest size shows a 3 by 5 pair", () => {
  for (const skin of [bone, obsidian]) {
    const small = renderDie("d20", restOrientation("d20", 20), skin, MIN_DIE_SIZE);
    const box = bbox(pixelsOf(small.data, MIN_DIE_SIZE, skin.numeral));
    assert.ok(box.h <= 5, `d20 ${skin.id}: numeral ${box.h} rows tall`);
    assert.ok(box.w >= 7 && box.w <= 9, `d20 ${skin.id}: two digits ${box.w} wide`);
  }
  // Where the big glyph fits it is still the big glyph.
  const big = renderDie("d20", restOrientation("d20", 20), obsidian, 56);
  assert.equal(bbox(pixelsOf(big.data, 56, obsidian.numeral)).h >= 7, true);
  // The compact digits let a neighbouring face keep its number at the small size too.
  let neighbours = 0;
  for (const kind of DIE_KINDS) for (let r = 1; r <= DIE_SIDES[kind]; r++) neighbours += renderDie(kind, restOrientation(kind, r), bone, 40).faces.filter((f, i) => i > 0 && f.shown).length;
  assert.ok(neighbours > 0, "some neighbouring faces show their numbers at the default size");
});

test("the skin picker's preview is a d20 showing its 20, in every skin", () => {
  // createSkinPicker draws renderDie("d20", restOrientation("d20", 20), skin, 48).
  for (const skin of DICE_SKINS) {
    const s = renderDie("d20", restOrientation("d20", 20), skin, 48);
    assert.equal(s.faces[0]?.number, 20);
    assert.equal(s.faces[0]?.shown, true);
    assert.ok(numeralPixels("d20", restOrientation("d20", 20), skin, 48) >= 8, `${skin.id}: the 20 is on screen`);
  }
});

test("the tray never switches numerals off, and the only place the renderer can is an explicit option", () => {
  const src = readFileSync(new URL("../scripts/asset-bench/dice.ts", import.meta.url), "utf8");
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
  assert.equal(code.some((l) => /numerals:\s*false/.test(l)), false, "no call in dice.ts passes numerals: false");
});

// ---- the tray looks (foe dice and foe trays) ----------------------------------

function fnv(d: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (const b of d) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function blank(w: number, h: number): PixelBuffer {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

test("the player's tray paints exactly as it did before the foe looks existed (pinned by hash at four sizes)", () => {
  // These hashes were taken from the painter as it stood at commit 52833f6c, before any tray look existed: wood rim, green felt.
  const pinned: [number, number, string][] = [
    [180, 100, "f3811e40"],
    [140, 80, "e3e639bc"],
    [96, 60, "d7ea2455"],
    [121, 73, "7950ebbc"],
  ];
  const player = trayLookById(PLAYER_TRAY_ID) as NonNullable<ReturnType<typeof trayLookById>>;
  for (const [w, h, want] of pinned) {
    const buf = blank(w, h);
    paintTray(buf, player);
    assert.equal(fnv(buf.data), want, `${w}x${h}`);
  }
  // The player's tray has no motion, so reduced motion and the clock change nothing.
  const a = blank(180, 100);
  paintTray(a, player);
  const before = fnv(a.data);
  paintTrayEffects(a, player, 12345, false);
  assert.equal(fnv(a.data), before);
});

test("the player's look is first in TRAY_LOOKS, ids are unique and valid, and every look is fit to use", () => {
  assert.equal(TRAY_LOOKS[0]?.id, PLAYER_TRAY_ID);
  const ids = TRAY_LOOKS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const look of TRAY_LOOKS) assert.deepEqual(trayLookProblems(look), [], look.id);
  assert.equal(trayLookById("nope"), undefined);
  assert.equal(trayLookById(undefined), undefined);
  const broken = { ...(TRAY_LOOKS[0] as (typeof TRAY_LOOKS)[number]), id: "Bad Id", accent: "red" };
  assert.ok(trayLookProblems(broken).length >= 2);
});

test("every tray look paints opaque inside its rounded rectangle and clear outside, deterministically, at any size", () => {
  for (const look of TRAY_LOOKS) {
    for (const [w, h] of [[180, 100], [140, 80], [121, 73]] as const) {
      const a = blank(w, h);
      const b = blank(w, h);
      // Poison one buffer first: the painter must overwrite every byte, not rely on a zeroed buffer.
      b.data.fill(77);
      paintTray(a, look);
      paintTray(b, look);
      assert.deepEqual(a.data, b.data, `${look.id} ${w}x${h} deterministic and does not depend on what was there`);
      // The four extreme corner pixels are outside the rounded corner; the middle is felt.
      for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) assert.equal(a.data[(y * w + x) * 4 + 3], 0, `${look.id} corner clear`);
      assert.equal(a.data[((h >> 1) * w + (w >> 1)) * 4 + 3], 255);
      let opaque = 0;
      for (let i = 0; i < w * h; i++) {
        const al = a.data[i * 4 + 3] as number;
        assert.ok(al === 0 || al === 255, `${look.id}: pixels are opaque or clear`);
        if (al) opaque++;
      }
      assert.ok(opaque > w * h * 0.95, `${look.id}: the tray fills its rectangle`);
    }
  }
});

test("no two tray looks paint the same tray (tiers, accents and dragon colours are all different)", () => {
  const seen = new Map<string, string>();
  for (const look of TRAY_LOOKS) {
    const buf = blank(180, 100);
    paintTray(buf, look);
    const h = fnv(buf.data);
    assert.equal(seen.get(h), undefined, `${look.id} paints the same as ${seen.get(h)}`);
    seen.set(h, look.id);
  }
});

test("effects: only the pixels they name change, never an outside pixel or an alpha, and the still frame ignores the clock", () => {
  const moving = TRAY_LOOKS.filter((l) => l.effects.length > 0);
  assert.ok(moving.length >= 10, "tiers 4 and 5 and the undead glow all move");
  for (const look of moving) {
    const base = blank(180, 100);
    paintTray(base, look);
    const a = blank(180, 100);
    a.data.set(base.data);
    paintTrayEffects(a, look, 5000, false);
    let changed = 0;
    for (let i = 0; i < 180 * 100; i++) {
      assert.equal(a.data[i * 4 + 3], base.data[i * 4 + 3], `${look.id}: alpha untouched`);
      if (base.data[i * 4 + 3] === 0) assert.equal(a.data[i * 4], 0, `${look.id}: outside untouched`);
      if (a.data[i * 4] !== base.data[i * 4] || a.data[i * 4 + 1] !== base.data[i * 4 + 1] || a.data[i * 4 + 2] !== base.data[i * 4 + 2]) changed++;
    }
    assert.ok(changed > 20, `${look.id}: its motion is visible (${changed} pixels)`);
    // Reduced motion: one fixed frame whatever the clock says.
    const s1 = blank(180, 100);
    s1.data.set(base.data);
    paintTrayEffects(s1, look, 100, true);
    const s2 = blank(180, 100);
    s2.data.set(base.data);
    paintTrayEffects(s2, look, 987654, true);
    assert.deepEqual(s1.data, s2.data, `${look.id}: the still frame does not move`);
    // And the moving frame does move.
    const m1 = blank(180, 100);
    m1.data.set(base.data);
    paintTrayEffects(m1, look, 0, false);
    const m2 = blank(180, 100);
    m2.data.set(base.data);
    paintTrayEffects(m2, look, 1700, false);
    assert.notDeepEqual(m1.data, m2.data, `${look.id}: it animates`);
  }
});

test("foe skins are separate from the shop: none is in DICE_SKINS, all are free, valid and unique, and skinById finds both lists", () => {
  const shop = new Set(DICE_SKINS.map((s) => s.id));
  const ids = FOE_DICE_SKINS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of FOE_DICE_SKINS) {
    assert.equal(shop.has(s.id), false, `${s.id} must not be in the shop`);
    assert.deepEqual(skinProblems(s), [], s.id);
    assert.equal(s.priceCredits, 0);
    assert.equal(skinById(s.id), s);
  }
  for (const s of DICE_SKINS) assert.equal(skinById(s.id), s);
  assert.equal(skinById("nope"), undefined);
});

test("composeTrayStill is the asked size, shows the die and its numeral, and the who plaque", () => {
  const skin = FOE_DICE_SKINS.find((s) => s.id === "foe-die-t1") as DiceSkin;
  const look = "foe-tray-t1";
  const bare = blank(96, 60);
  paintTray(bare, trayLookById(look) as NonNullable<ReturnType<typeof trayLookById>>);
  const still = composeTrayStill(look, skin.id, "d20", 20);
  assert.equal(still.width, 96);
  assert.equal(still.height, 60);
  assert.equal(still.data.length, 96 * 60 * 4);
  assert.notDeepEqual(still.data, bare.data);
  const [nr, ng, nb] = hex(skin.numeral);
  let numeral = 0;
  for (let i = 0; i < 96 * 60; i++) if (still.data[i * 4] === nr && still.data[i * 4 + 1] === ng && still.data[i * 4 + 2] === nb) numeral++;
  assert.ok(numeral >= 8, `the 20 is on screen (${numeral} numeral pixels)`);
  const big = composeTrayStill(look, skin.id, "d6", 6, { width: 180, height: 100 });
  assert.equal(big.width, 180);
  assert.equal(big.height, 100);
  assert.equal(composeTrayStill(look, skin.id, "d6", 6, { width: 10, height: 10 }).width, 48, "tiny sizes are raised to the smallest that holds a die");
  // The plaque changes the pixels along the top and nothing outside the tray.
  const withWho = composeTrayStill(look, skin.id, "d20", 20, { width: 180, height: 100, who: "The goblin rolls" });
  const without = composeTrayStill(look, skin.id, "d20", 20, { width: 180, height: 100 });
  let top = 0;
  for (let x = 0; x < 180; x++) if (withWho.data[(2 * 180 + x) * 4] !== without.data[(2 * 180 + x) * 4]) top++;
  assert.ok(top > 20, "the plaque is on the top rim");
  // Unknown ids fall back rather than throw.
  assert.equal(composeTrayStill("nope", "nope", "d6", 3).width, 96);
  // Four dice at most.
  const five = composeTrayDice(look, skin.id, [1, 2, 3, 4, 5].map((r) => ({ kind: "d6" as const, result: r })), { width: 180, height: 100 });
  assert.equal(five.data.length, 180 * 100 * 4);
});

test("the who plaque is lettered in the look's accent colour, fits the width it is given, and is pure", () => {
  const look = trayLookById("foe-tray-t4") as NonNullable<ReturnType<typeof trayLookById>>;
  const a = renderWhoTag("The troll rolls", look, 160);
  const b = renderWhoTag("The troll rolls", look, 160);
  assert.deepEqual(a.data, b.data);
  assert.ok(a.w <= 160 && a.h <= 16, `${a.w}x${a.h}`);
  const narrow = renderWhoTag("The extremely long named thing rolls and rolls", look, 60);
  assert.ok(narrow.w <= 60, `cut to fit: ${narrow.w}`);
  // Some of the lettering is the accent colour itself (the lower tone of the two-tone ink).
  const [r, g, bl] = hex(look.accent);
  let accent = 0;
  for (let i = 0; i < a.w * a.h; i++) if (a.data[i * 4] === r && a.data[i * 4 + 1] === g && a.data[i * 4 + 2] === bl) accent++;
  assert.ok(accent > 10, `accent pixels: ${accent}`);
});
