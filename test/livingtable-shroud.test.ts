/**
 * The shroud (fog of war) overlay: pure pixels, no canvas.
 * Run: npx -y tsx --test test/livingtable-shroud.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SHROUD_TICK_MS,
  shroudAnimates,
  shroudPixels,
  type ShroudOptions,
} from "../src/games/livingtable/render/shroud";

const COLS = 20;
const ROWS = 15;
const P = 16;

function opts(over: Partial<ShroudOptions> = {}): ShroudOptions {
  return { cols: COLS, rows: ROWS, tilePx: P, timeMs: 0, reducedMotion: false, ...over };
}

/** All never seen, with an inclusive rectangle of `level` squares. */
function board(rect: { c0: number; r0: number; c1: number; r1: number; level: number }, base = 0): Uint8Array {
  const s = new Uint8Array(COLS * ROWS).fill(base);
  for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) s[r * COLS + c] = rect.level;
  return s;
}

function alphaAt(px: Uint8ClampedArray, x: number, y: number): number {
  return px[(y * COLS * P + x) * 4 + 3];
}

/** Every alpha value inside the square (c, r). */
function squareAlphas(px: Uint8ClampedArray, c: number, r: number): number[] {
  const out: number[] = [];
  for (let y = r * P; y < (r + 1) * P; y++) for (let x = c * P; x < (c + 1) * P; x++) out.push(alphaAt(px, x, y));
  return out;
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

test("output is RGBA at cols*tilePx by rows*tilePx", () => {
  const px = shroudPixels(new Uint8Array(COLS * ROWS), opts());
  assert.equal(px.length, COLS * P * ROWS * P * 4);
  assert.ok(px instanceof Uint8ClampedArray);
});

test("an all-visible board is fully transparent", () => {
  const px = shroudPixels(new Uint8Array(COLS * ROWS).fill(2), opts());
  assert.ok(px.every((v) => v === 0));
});

test("visible squares are fully transparent, including right next to fog", () => {
  const s = board({ c0: 8, r0: 6, c1: 11, r1: 8, level: 2 });
  const px = shroudPixels(s, opts());
  for (let r = 6; r <= 8; r++) {
    for (let c = 8; c <= 11; c++) {
      assert.ok(squareAlphas(px, c, r).every((a) => a === 0), `square ${c},${r} must be clear`);
    }
  }
  // And the same against remembered neighbours.
  const s2 = board({ c0: 8, r0: 6, c1: 11, r1: 8, level: 2 }, 1);
  const px2 = shroudPixels(s2, opts());
  for (let r = 6; r <= 8; r++) {
    for (let c = 8; c <= 11; c++) assert.ok(squareAlphas(px2, c, r).every((a) => a === 0));
  }
});

test("corner rule: a visible square bordered by fog on every side and corner stays alpha 0", () => {
  const s = board({ c0: 5, r0: 5, c1: 5, r1: 5, level: 2 });
  const px = shroudPixels(s, opts());
  assert.ok(squareAlphas(px, 5, 5).every((a) => a === 0));
  // The fog beside it is softened, not drawn over it: the pixel column just
  // outside the square is mostly clear, the far side of that square is not.
  const near = [];
  const far = [];
  for (let y = 5 * P; y < 6 * P; y++) {
    near.push(alphaAt(px, 5 * P - 1, y)); // last column of the fogged square to the left
    far.push(alphaAt(px, 4 * P, y)); // first column of it
  }
  assert.ok(mean(near) < mean(far), "fog thins toward the visible square");
});

test("a lone fogged square ringed by sight keeps a fogged middle", () => {
  const s = new Uint8Array(COLS * ROWS).fill(2);
  s[7 * COLS + 9] = 0;
  const px = shroudPixels(s, opts());
  const cx = 9 * P + P / 2;
  const cy = 7 * P + P / 2;
  assert.ok(alphaAt(px, cx, cy) >= 0.9 * 255);
  assert.ok(alphaAt(px, cx - 1, cy) >= 0.9 * 255);
});

test("never-seen interior is near opaque", () => {
  const px = shroudPixels(new Uint8Array(COLS * ROWS), opts());
  const a = squareAlphas(px, 10, 7);
  assert.ok(Math.min(...a) >= 0.9 * 255, `min alpha ${Math.min(...a)}`);
  assert.ok(Math.max(...a) <= 0.98 * 255, `max alpha ${Math.max(...a)}`);
});

test("never-seen mist is textured, not flat black", () => {
  const px = shroudPixels(new Uint8Array(COLS * ROWS), opts());
  const shades = new Set<number>();
  for (let y = 0; y < ROWS * P; y++) for (let x = 0; x < COLS * P; x++) shades.add(px[(y * COLS * P + x) * 4 + 2]);
  assert.ok(shades.size >= 2 && shades.size <= 3, `${shades.size} ink shades`);
});

test("remembered interior is mid alpha, and clearly lighter than never seen", () => {
  const remembered = shroudPixels(new Uint8Array(COLS * ROWS).fill(1), opts());
  const never = shroudPixels(new Uint8Array(COLS * ROWS), opts());
  const m = mean(squareAlphas(remembered, 10, 7));
  assert.ok(m > 0.45 * 255 && m < 0.75 * 255, `remembered mean alpha ${m}`);
  assert.ok(m < mean(squareAlphas(never, 10, 7)) - 40);
});

test("deterministic for the same timeMs", () => {
  const s = board({ c0: 8, r0: 6, c1: 11, r1: 8, level: 2 });
  const a = shroudPixels(s, opts({ timeMs: 12345 }));
  const b = shroudPixels(s, opts({ timeMs: 12345 }));
  assert.deepEqual(a, b);
});

test("drift changes pixels between ticks but not within one tick", () => {
  const s = new Uint8Array(COLS * ROWS);
  const t0 = shroudPixels(s, opts({ timeMs: 0 }));
  const same = shroudPixels(s, opts({ timeMs: SHROUD_TICK_MS - 1 }));
  const next = shroudPixels(s, opts({ timeMs: SHROUD_TICK_MS }));
  assert.deepEqual(t0, same);
  assert.notDeepEqual(t0, next);
});

test("reducedMotion ignores timeMs", () => {
  const s = new Uint8Array(COLS * ROWS);
  const a = shroudPixels(s, opts({ timeMs: 0, reducedMotion: true }));
  const b = shroudPixels(s, opts({ timeMs: 987654, reducedMotion: true }));
  assert.deepEqual(a, b);
});

test("drift moves in whole source pixels: the mist is a shifted copy, not a re-roll", () => {
  // Layer A moves one pixel per tick, but layer B moves too, so only the
  // rough shape is shared: most pixels near a one-tick shift stay the same.
  const s = new Uint8Array(COLS * ROWS);
  const a = shroudPixels(s, opts({ timeMs: 0 }));
  const b = shroudPixels(s, opts({ timeMs: SHROUD_TICK_MS }));
  let same = 0;
  const n = COLS * P * ROWS * P;
  for (let i = 0; i < n; i++) if (a[i * 4 + 2] === b[i * 4 + 2]) same++;
  assert.ok(same / n > 0.6, `only ${(same / n).toFixed(2)} unchanged after one tick`);
});

test("reveal 0 vs 1 differs on a newly seen square, and reveal never touches the others", () => {
  const s = board({ c0: 8, r0: 6, c1: 8, r1: 6, level: 2 });
  const rev = (v: number): Float32Array => {
    const f = new Float32Array(COLS * ROWS).fill(1);
    f[6 * COLS + 8] = v;
    return f;
  };
  const full = shroudPixels(s, opts({ reveal: rev(1) }));
  const none = shroudPixels(s, opts({ reveal: rev(0) }));
  const half = shroudPixels(s, opts({ reveal: rev(0.5) }));
  assert.notDeepEqual(full, none);
  assert.ok(squareAlphas(full, 8, 6).every((a) => a === 0));
  assert.ok(squareAlphas(none, 8, 6).every((a) => a >= 0.9 * 255), "reveal 0 is fully shrouded");
  const covered = squareAlphas(half, 8, 6).filter((a) => a > 0).length;
  assert.ok(covered > 60 && covered < 196, `half reveal covers ${covered} of 256 pixels`);
  // Absent reveal equals all ones.
  assert.deepEqual(shroudPixels(s, opts()), full);
});

test("reducedMotion treats reveal as 1", () => {
  const s = board({ c0: 8, r0: 6, c1: 8, r1: 6, level: 2 });
  const rev = new Float32Array(COLS * ROWS).fill(0);
  const px = shroudPixels(s, opts({ reducedMotion: true, reveal: rev }));
  assert.ok(squareAlphas(px, 8, 6).every((a) => a === 0));
});

test("shroudAnimates: true when any square is 0 or 1 and motion is allowed", () => {
  const all2 = new Uint8Array(COLS * ROWS).fill(2);
  assert.equal(shroudAnimates(all2, false), false);
  const some = all2.slice();
  some[3] = 1;
  assert.equal(shroudAnimates(some, false), true);
  some[3] = 0;
  assert.equal(shroudAnimates(some, false), true);
  assert.equal(shroudAnimates(some, true), false);
});

test("SHROUD_TICK_MS is in the suggested range", () => {
  assert.ok(SHROUD_TICK_MS >= 150 && SHROUD_TICK_MS <= 250);
});

test("20x15 at 16px builds in a few milliseconds", () => {
  const s = board({ c0: 6, r0: 4, c1: 12, r1: 9, level: 2 }, 0);
  s[0] = 1;
  shroudPixels(s, opts()); // warm up
  const t0 = performance.now();
  const runs = 20;
  for (let i = 0; i < runs; i++) shroudPixels(s, opts({ timeMs: i * 200 }));
  const per = (performance.now() - t0) / runs;
  assert.ok(per < 25, `${per.toFixed(2)} ms per build`);
});
