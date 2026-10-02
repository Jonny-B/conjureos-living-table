/**
 * Tests for the asset bench's on-screen text layer: the bitmap pixel font
 * (scripts/asset-bench/pixelFont.ts) and the pure parts of the overlay
 * (scripts/asset-bench/overlay.ts). The DOM drawing is covered by the bench's
 * Play-tab browser checks; everything here runs in plain Node, which is also
 * the proof that neither module touches the DOM at import time (the bench
 * registry is imported in Node for validation before it reaches a browser).
 *
 * Run: npx tsx --test test/livingtable-bench-overlay.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CELL_H,
  FIRST_CODE,
  GLYPH_H,
  GLYPH_W,
  LAST_CODE,
  LINE_GAP,
  TONE_SPLIT_ROW,
  cssScale,
  deviceScale,
  fitScale,
  getGlyph,
  hasGlyph,
  layoutRuns,
  measureText,
  normalizeText,
  pixelText,
  rasterize,
  textWidth,
  wrapText,
  wrapWidth,
} from "../scripts/asset-bench/pixelFont";
import {
  FLOAT_BASE_PX,
  FLOAT_GAP_PX,
  createOverlay,
  floatLift,
  floatStackIndex,
  floatStackTop,
  narrationHoldMs,
  newPackItems,
  overlayDemo,
  sizeTier,
  verdictWords,
  type RecentFloat,
} from "../scripts/asset-bench/overlay";

const PRINTABLE = Array.from({ length: LAST_CODE - FIRST_CODE + 1 }, (_, i) => String.fromCharCode(FIRST_CODE + i));
const code = (n: number) => String.fromCodePoint(n);

// ---- the font data ----------------------------------------------------------

test("every printable ASCII character has a glyph of the right size", () => {
  assert.equal(PRINTABLE.length, 95);
  for (const ch of PRINTABLE) {
    assert.ok(hasGlyph(ch), `no glyph for ${JSON.stringify(ch)}`);
    const g = getGlyph(ch);
    assert.equal(g.ch, ch);
    assert.equal(g.rows.length, GLYPH_H, `${ch}: row count`);
    for (const row of g.rows) {
      assert.equal(row.length, GLYPH_W, `${ch}: row width`);
      assert.match(row, /^[#.]+$/);
    }
    const bold = getGlyph(ch, "bold");
    assert.equal(bold.rows.length, GLYPH_H);
    for (const row of bold.rows) assert.equal(row.length, GLYPH_W + 1, `${ch}: bold row width`);
  }
});

test("characters outside printable ASCII are not glyphs and fall back to the question mark", () => {
  for (const ch of [code(0xe9), code(0x2014), code(0x1f600), "\n"]) assert.equal(hasGlyph(ch), false);
  assert.equal(getGlyph(code(0xe9)).ch, "?");
  assert.deepEqual(getGlyph(code(0x1f600)).rows, getGlyph("?").rows);
});

test("only the space is blank, and no two glyphs share a shape", () => {
  const seen = new Map<string, string>();
  for (const ch of PRINTABLE) {
    const shape = getGlyph(ch).rows.join("/");
    if (ch === " ") {
      assert.equal(shape.includes("#"), false);
      continue;
    }
    assert.ok(shape.includes("#"), `${JSON.stringify(ch)} is blank`);
    const clash = seen.get(shape);
    assert.equal(clash, undefined, `${JSON.stringify(ch)} has the same shape as ${JSON.stringify(clash)}`);
    seen.set(shape, ch);
  }
});

test("capitals and digits stand on the baseline row; only descenders use the eighth row", () => {
  const baseline = GLYPH_H - 2; // row 6, the last row of the 7-row cap height
  const descender = GLYPH_H - 1; // row 7
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
    const rows = getGlyph(ch).rows;
    assert.ok(rows[baseline]?.includes("#"), `${ch} has no ink on the baseline row`);
    assert.equal(rows[descender]?.includes("#"), false, `${ch} drops below the baseline`);
  }
  for (const ch of "abcdefghijklmnopqrstuvwxyz") {
    const drops = (getGlyph(ch).rows[descender] ?? "").includes("#");
    assert.equal(drops, "gjpqy".includes(ch), `${ch}: descender row`);
  }
});

// ---- measuring --------------------------------------------------------------

test("textWidth: ink width, one pixel of spacing between glyphs, none trailing", () => {
  assert.equal(textWidth(""), 0);
  assert.equal(textWidth("A"), 5);
  assert.equal(textWidth("AB"), 11); // 5 + 1 + 5
  assert.equal(textWidth("A B"), 14); // A advances 6, the space 3, B 6, less the trailing spacing pixel
  assert.ok(textWidth("i") < textWidth("m"), "spacing is proportional");
  assert.ok(textWidth("l") < textWidth("W"));
});

test("textWidth: digits are tabular, bold is one pixel wider per glyph", () => {
  for (const d of "0123456789") assert.equal(textWidth(d), 5, `digit ${d}`);
  assert.equal(textWidth("11"), textWidth("88"));
  assert.equal(textWidth("A", "bold"), 6);
  assert.equal(textWidth("AB", "bold"), 13); // 6 + 1 spacing, plus the smear on each glyph's advance
  assert.ok(textWidth("Hello", "bold") > textWidth("Hello"));
});

test("measureText counts lines and heights the way the renderer lays them out", () => {
  assert.deepEqual(measureText("Hello"), { w: textWidth("Hello"), h: CELL_H, lines: 1 });
  assert.deepEqual(measureText("a\nb"), { w: 5, h: CELL_H + LINE_GAP + CELL_H, lines: 2 });
  assert.deepEqual(measureText(""), { w: 0, h: 0, lines: 0 });
  assert.deepEqual(measureText("   "), { w: 0, h: 0, lines: 0 });
  assert.equal(measureText("one two three", { maxWidth: textWidth("one two") }).lines, 2);
});

test("normalizeText maps typographic punctuation to ASCII and everything else unknown to ?", () => {
  assert.equal(normalizeText("plain text 123"), "plain text 123");
  assert.equal(normalizeText(`it${code(0x2019)}s`), "it's");
  assert.equal(normalizeText(`${code(0x201c)}hi${code(0x201d)}`), '"hi"');
  assert.equal(normalizeText(`a${code(0x2014)}b${code(0x2013)}c`), "a-b-c");
  assert.equal(normalizeText(`wait${code(0x2026)}`), "wait...");
  assert.equal(normalizeText(`${code(0x1f600)}${code(0xe9)}`), "??");
  assert.equal(normalizeText("a\r\nb\tc"), "a\nb c");
});

// ---- wrapping and runs ------------------------------------------------------

test("wrapText: lines never exceed the width and keep every word, in order", () => {
  const text = "You drink a healing potion and recover 5 hit points.";
  const longest = Math.max(...text.split(" ").map((w) => textWidth(w)));
  for (const max of [longest, longest + 20, 100, 160]) {
    const lines = wrapText(text, max);
    for (const line of lines) assert.ok(textWidth(line) <= max, `"${line}" is ${textWidth(line)} wide, over ${max}`);
    assert.equal(lines.join(" "), text);
  }
  assert.deepEqual(wrapText("aaa bbb ccc", textWidth("aaa bbb")), ["aaa bbb", "ccc"]);
  assert.deepEqual(wrapText("", 50), []);
});

test("wrapText breaks a word that is longer than a whole line, and honours newlines", () => {
  const long = wrapText("WWWWWWWWWW", textWidth("WWW"));
  assert.ok(long.length > 1);
  for (const line of long) assert.ok(textWidth(line) <= textWidth("WWW"));
  assert.equal(long.join(""), "WWWWWWWWWW");
  assert.deepEqual(wrapText("one\ntwo", 500), ["one", "two"]);
});

test("layoutRuns keeps each run's colour and the space between runs", () => {
  const layout = layoutRuns([
    { text: "Goblin:", color: "red" },
    { text: " Shinies", color: "green" },
  ]);
  assert.equal(layout.lines, 1);
  assert.equal(layout.w, textWidth("Goblin: Shinies"));
  const colours = layout.glyphs.map((g) => g.color);
  assert.equal(colours[0], "red");
  assert.equal(colours.at(-1), "green");
  assert.equal(layout.glyphs.map((g) => g.glyph.ch).join(""), "Goblin:Shinies");
});

test("layoutRuns: centre alignment pads the shorter line, and a bold run measures bold", () => {
  const c = layoutRuns([{ text: "WWWW\nW" }], { align: "center" });
  const first = c.glyphs.filter((g) => g.y === 0);
  const second = c.glyphs.filter((g) => g.y > 0);
  assert.equal(first[0]?.x, 0);
  assert.equal(second[0]?.x, Math.floor((c.w - 5) / 2));
  const mixed = layoutRuns([{ text: "A", weight: "bold" }, { text: "B" }]);
  assert.equal(mixed.w, 7 + 5); // bold A advance 7, then a regular B 5 wide
});

test("fitScale: the largest integer scale that fits, clamped, never fractional", () => {
  assert.equal(fitScale(100, 450, 1, 8), 4);
  assert.equal(fitScale(100, 99, 1, 8), 1);
  assert.equal(fitScale(100, 99, 2, 8), 2);
  assert.equal(fitScale(10, 1000, 1, 6), 6);
  assert.equal(fitScale(0, 100, 1, 5), 5);
  for (const w of [37, 91, 143]) for (const avail of [120, 333, 770]) assert.ok(Number.isInteger(fitScale(w, avail, 1, 8)));
});

// ---- device pixel ratios ----------------------------------------------------
//
// renderPixelCanvas rounds a font pixel to a whole number of device pixels, so at
// 1.25, 1.75 or 2.75 a font pixel is not the nominal scale in CSS pixels (2.4,
// 2.29 and 2.18 for a scale of 2). The overlay wraps and sizes in CSS pixels, so
// it has to ask for what the text really takes.

const RATIOS = [1, 1.25, 1.5, 1.75, 2, 2.625, 2.75, 3];

test("deviceScale is a whole number of device pixels, and cssScale is what that comes to in CSS pixels", () => {
  for (const dpr of RATIOS) {
    for (const scale of [1, 2, 3, 4, 5, 7]) {
      const k = deviceScale(scale, dpr);
      assert.ok(Number.isInteger(k) && k >= 1, `scale ${scale} at ${dpr}: ${k}`);
      assert.ok(Math.abs(cssScale(scale, dpr) * dpr - k) < 1e-9);
      assert.ok(Math.abs(cssScale(scale, dpr) - scale) <= 0.5 / dpr + 1e-9, `scale ${scale} at ${dpr} drifted to ${cssScale(scale, dpr)}`);
    }
  }
  // Whole ratios, and 1.5 at an even scale, are exact: the nominal scale is what you get.
  for (const dpr of [1, 2, 3]) for (const scale of [1, 2, 3, 4, 5]) assert.equal(cssScale(scale, dpr), scale);
  assert.equal(cssScale(2, 1.5), 2);
  // The ones the first version got wrong.
  assert.equal(cssScale(2, 1.25), 2.4);
  assert.equal(cssScale(2, 1.75), 4 / 1.75);
  assert.equal(cssScale(2, 2.75), 6 / 2.75);
  assert.notEqual(cssScale(3, 1.5), 3);
  // A ratio that is not a number or not positive counts as 1.
  for (const bad of [0, -2, Number.NaN]) assert.equal(cssScale(2, bad), 2);
});

test("wrapWidth: wrapped text never draws wider than the box it was wrapped for, at any ratio", () => {
  const text = "Shinies! Give! The quick brown fox jumps over 1234567890 lazy dogs and keeps on running through the hall until it is out of breath.";
  for (const dpr of RATIOS) {
    for (const scale of [1, 2, 3]) {
      for (const avail of [120, 326, 736]) {
        const layout = layoutRuns([{ text }], { maxWidth: wrapWidth(avail, scale, dpr) });
        assert.ok(layout.w * cssScale(scale, dpr) <= avail + 1e-9, `${scale}x at ${dpr} in ${avail}px: drew ${layout.w * cssScale(scale, dpr)}`);
        assert.ok(layout.lines >= 1);
      }
    }
  }
  // The old rule (wrap at avail over the nominal scale) overflows at a fractional ratio: this is the bug.
  const naive = layoutRuns([{ text }], { maxWidth: Math.floor(736 / 2) });
  assert.ok(naive.w * cssScale(2, 1.25) > 736, "wrapping at the nominal scale overflows at 1.25");
  assert.equal(wrapWidth(736, 2, 1), 368);
  assert.ok(wrapWidth(0, 2, 1.25) >= 1);
});

test("fitScale at a ratio: the biggest scale whose real width fits, and the same as before at ratio 1", () => {
  for (const w of [37, 91, 111, 143]) {
    for (const avail of [100, 278, 333, 906]) {
      for (const [lo, hi] of [[1, 8], [2, 7], [1, 3]] as const) {
        const old = Math.max(lo, Math.min(hi, Math.floor(avail / w)));
        assert.equal(fitScale(w, avail, lo, hi), old, `ratio 1: ${w} in ${avail} (${lo} to ${hi})`);
        assert.equal(fitScale(w, avail, lo, hi, 1), old);
        for (const dpr of RATIOS) {
          const s = fitScale(w, avail, lo, hi, dpr);
          assert.ok(s >= lo && s <= hi && Number.isInteger(s));
          if (s > lo) assert.ok(w * cssScale(s, dpr) <= avail + 1e-9, `${w} at scale ${s}, ratio ${dpr}, in ${avail}`);
          if (s < hi) assert.ok(w * cssScale(s + 1, dpr) > avail, `a bigger scale than ${s} would have fit`);
        }
      }
    }
  }
  // 111 font pixels in 266 CSS px: scale 2 fits at ratio 1 (222 wide), and at 1.25 it is drawn at 2.4 (266.4), so it does not.
  assert.equal(fitScale(111, 266, 1, 7, 1), 2);
  assert.equal(fitScale(111, 266, 1, 7, 1.25), 1);
});

test("pixelText sets the canvas to a whole number of device pixels per font pixel, sized to match in CSS", () => {
  type Fake = { width: number; height: number; style: Record<string, string>; dataset: Record<string, string>; getContext: () => null };
  const g = globalThis as unknown as { document?: unknown };
  const before = g.document;
  g.document = { createElement: (): Fake => ({ width: 0, height: 0, style: {}, dataset: {}, getContext: () => null }) };
  try {
    for (const dpr of RATIOS) {
      for (const scale of [1, 2, 4]) {
        const bmp = rasterize("Hi there", { shadow: "#000" });
        const canvas = pixelText("Hi there", { scale, dpr, shadow: "#000" });
        const k = deviceScale(scale, dpr);
        assert.equal(canvas.width, bmp.w * k, `device width at ${scale}x, ${dpr}`);
        assert.equal(canvas.height, bmp.h * k);
        assert.ok(Math.abs(parseFloat(canvas.style.width) - bmp.w * cssScale(scale, dpr)) < 1e-9, `css width at ${scale}x, ${dpr}`);
        assert.ok(Math.abs(parseFloat(canvas.style.height) - bmp.h * cssScale(scale, dpr)) < 1e-9);
        // and the CSS size is a whole number of device pixels, so no font pixel is smeared
        assert.ok(Math.abs(parseFloat(canvas.style.width) * dpr - canvas.width) < 1e-6);
      }
    }
  } finally {
    if (before === undefined) delete g.document;
    else g.document = before;
  }
});

// ---- rasterising ------------------------------------------------------------

function count(plane: Uint8Array): number {
  let n = 0;
  for (const v of plane) if (v) n++;
  return n;
}

test("rasterize: bare text is exactly the glyph, with margins only for an outline or a shadow", () => {
  const bare = rasterize("A");
  assert.equal(bare.w, 5);
  assert.equal(bare.h, GLYPH_H);
  assert.equal(count(bare.ink), getGlyph("A").rows.join("").split("#").length - 1);
  assert.equal(count(bare.outline), 0);
  assert.equal(count(bare.shadow), 0);

  const outlined = rasterize("A", { outline: "#000" });
  assert.equal(outlined.w, 7);
  assert.equal(outlined.h, GLYPH_H + 2);
  assert.equal(outlined.left, 1);
  const shadowed = rasterize("A", { shadow: "#000" });
  assert.equal(shadowed.w, 6);
  assert.equal(shadowed.h, GLYPH_H + 1);
  const thick = rasterize("A", { outline: "#000", outlinePx: 2 });
  assert.equal(thick.w, 9);
});

test("rasterize: the outline sits outside the ink and the shadow outside both", () => {
  const bmp = rasterize("Hi!", { outline: "#000", shadow: "#111", color: "#fff" });
  assert.ok(count(bmp.outline) > 0);
  assert.ok(count(bmp.shadow) > 0);
  for (let i = 0; i < bmp.ink.length; i++) {
    if (bmp.ink[i]) {
      assert.equal(bmp.outline[i], 0, "outline over ink");
      assert.equal(bmp.shadow[i], 0, "shadow over ink");
    }
    if (bmp.outline[i]) assert.equal(bmp.shadow[i], 0, "shadow over outline");
  }
  // every outline pixel touches some ink pixel
  for (let y = 0; y < bmp.h; y++) {
    for (let x = 0; x < bmp.w; x++) {
      if (!bmp.outline[y * bmp.w + x]) continue;
      let touches = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (bmp.ink[(y + dy) * bmp.w + (x + dx)]) touches = true;
      assert.ok(touches, `stray outline pixel at ${x},${y}`);
    }
  }
});

test("rasterize: a [top, bottom] fill splits at the tone row of every line", () => {
  const bmp = rasterize("H\nH", { color: ["#aaa", "#bbb"] });
  assert.deepEqual([...bmp.fills].sort(), ["#aaa", "#bbb"]);
  const top = bmp.fills.indexOf("#aaa") + 1;
  const bottom = bmp.fills.indexOf("#bbb") + 1;
  for (let line = 0; line < 2; line++) {
    for (let r = 0; r < GLYPH_H; r++) {
      const y = line * (CELL_H + LINE_GAP) + r;
      for (let x = 0; x < bmp.w; x++) {
        const v = bmp.ink[y * bmp.w + x] as number;
        if (v) assert.equal(v, r < TONE_SPLIT_ROW ? top : bottom, `line ${line} row ${r}`);
      }
    }
  }
});

test("rasterize: empty text is still a drawable 1 by 1 bitmap", () => {
  const bmp = rasterize("");
  assert.equal(bmp.w, 1);
  assert.equal(bmp.h, 1);
  assert.equal(bmp.lines, 0);
});

// ---- the overlay's pure parts ----------------------------------------------

test("the overlay and the font load in Node without a DOM, and export the contract", () => {
  assert.equal(typeof createOverlay, "function");
  assert.equal(typeof overlayDemo, "function");
  assert.equal(typeof document, "undefined");
});

test("floatStackIndex: floats on one spot within 300 ms climb, others do not", () => {
  const at = { x: 100, y: 100 };
  assert.equal(floatStackIndex([], at, 1000), 0);
  assert.equal(floatStackIndex([{ x: 100, y: 100, t: 900, n: 0 }], at, 1000), 1);
  assert.equal(
    floatStackIndex(
      [
        { x: 100, y: 100, t: 800, n: 0 },
        { x: 104, y: 98, t: 900, n: 1 },
      ],
      at,
      1000,
    ),
    2,
  );
  // far away, or too long ago: a fresh spot
  assert.equal(floatStackIndex([{ x: 300, y: 100, t: 900, n: 0 }], at, 1000), 0);
  assert.equal(floatStackIndex([{ x: 100, y: 100, t: 600, n: 0 }], at, 1000), 0);
});

test("floatStackTop: the highest ink reached by the floats on this spot in the window, 0 for a lone float", () => {
  const at = { x: 100, y: 100 };
  assert.equal(floatStackTop([], at, 1000), 0);
  assert.equal(floatStackTop([{ x: 100, y: 100, t: 900, n: 0, top: 57 }], at, 1000), 57);
  const pile: RecentFloat[] = [
    { x: 100, y: 100, t: 800, n: 0, top: 57 },
    { x: 104, y: 98, t: 900, n: 1, top: 130 },
    { x: 100, y: 100, t: 950, n: 2, top: 90 },
  ];
  assert.equal(floatStackTop(pile, at, 1000), 130);
  // far away, too long ago, or from a caller that did not record a top: no pile
  assert.equal(floatStackTop([{ x: 300, y: 100, t: 900, n: 0, top: 57 }], at, 1000), 0);
  assert.equal(floatStackTop([{ x: 100, y: 100, t: 600, n: 0, top: 57 }], at, 1000), 0);
  assert.equal(floatStackTop([{ x: 100, y: 100, t: 900, n: 0 }], at, 1000), 0);
});

test("floats stacked on one spot clear one another by what is stacked, not by their own height", () => {
  // Boxes as the storybook style draws them at the wide tier: [height, empty margin above the glyphs, empty margin below].
  const BOX = { damage: [66, 12.5, 16.5], crit: [96, 18.4, 25.6], heal: [66, 12.5, 16.5], down: [73, 14, 18.2] } as const;
  const sequences: (keyof typeof BOX)[][] = [
    ["damage", "damage", "crit", "heal"], // the checker's pile: the heal used to land on the crit
    ["crit", "down"], // the killing blow: DOWN used to sit on the upper half of the crit
    ["damage", "down"],
    ["heal", "heal", "heal", "heal", "heal"],
    ["crit", "crit", "crit"],
  ];
  const at = { x: 500, y: 300 };
  for (const kinds of sequences) {
    let recent: RecentFloat[] = [];
    const ink: [number, number][] = []; // [bottom, top] of each float's glyphs, in px above the anchor
    kinds.forEach((kind, i) => {
      const [h, padTop, padBottom] = BOX[kind];
      const lift = floatLift(floatStackTop(recent, at, 1000 + i), padBottom);
      const inkBottom = FLOAT_BASE_PX + lift + padBottom;
      const inkTop = FLOAT_BASE_PX + lift + h - padTop;
      recent = [...recent, { x: at.x, y: at.y, t: 1000 + i, n: i, top: inkTop }];
      ink.push([inkBottom, inkTop]);
    });
    for (let i = 1; i < ink.length; i++) {
      const prev = ink[i - 1] as [number, number];
      const cur = ink[i] as [number, number];
      assert.ok(cur[0] >= prev[1] + FLOAT_GAP_PX - 1e-9, `${kinds.join(", ")}: float ${i} starts at ${cur[0]} under the top ${prev[1]} of the one below`);
    }
  }
  // A lone float stands on the anchor, whatever its margins.
  assert.equal(floatLift(0, 25), 0);
  assert.equal(floatLift(0, 0), 0);
});

test("sizeTier: phones, in between, wide", () => {
  assert.equal(sizeTier(390), "s");
  assert.equal(sizeTier(519), "s");
  assert.equal(sizeTier(520), "m");
  assert.equal(sizeTier(899), "m");
  assert.equal(sizeTier(900), "l");
});

test("verdictWords uses the game's own sentences", () => {
  assert.equal(verdictWords({ hit: true }), "HIT");
  assert.equal(verdictWords({ hit: false }), "MISS");
  assert.equal(verdictWords({ hit: true, critical: true }), "NATURAL 20, CRITICAL HIT");
  assert.equal(verdictWords({ hit: false, fumble: true }), "NATURAL 1, AUTOMATIC MISS");
});

test("narrationHoldMs: about 2.5 s plus 45 ms a character, capped at 12 s", () => {
  assert.equal(narrationHoldMs(0), 2500);
  assert.equal(narrationHoldMs(100), 7000);
  assert.equal(narrationHoldMs(211), 11995);
  assert.equal(narrationHoldMs(212), 12000);
  assert.equal(narrationHoldMs(5000), 12000);
  assert.equal(narrationHoldMs(-4), 2500);
});

test("newPackItems: new by text, nothing new on the first look", () => {
  const before = [
    { label: "Worn", items: ["Leather armor"] },
    { label: "Bag", items: ["Rope", "Torch"] },
  ];
  const after = [
    { label: "Worn", items: ["Leather armor", "Rope"] },
    { label: "Bag", items: ["Torch", "Rusty key"] },
    { label: "Potions", items: ["Healing potion"] },
  ];
  assert.deepEqual([...newPackItems(before, after)].sort(), ["Healing potion", "Rusty key"]);
  assert.equal(newPackItems(null, after).size, 0);
  assert.equal(newPackItems(before, null).size, 0);
  assert.equal(newPackItems(after, before).size, 0);
  assert.equal(newPackItems(before, before).size, 0);
});

// ---- hygiene ----------------------------------------------------------------

test("the new bench files hold no em or en dash, and the overlay imports src for types only", () => {
  for (const file of ["pixelFont.ts", "overlay.ts"]) {
    const text = readFileSync(new URL(`../scripts/asset-bench/${file}`, import.meta.url), "utf8");
    assert.equal(text.includes(code(0x2014)), false, `${file} has an em dash`);
    assert.equal(text.includes(code(0x2013)), false, `${file} has an en dash`);
  }
  const overlay = readFileSync(new URL("../scripts/asset-bench/overlay.ts", import.meta.url), "utf8");
  assert.equal(/^import (?!type\b)[^\n]*"\.\.\/\.\.\/src\//m.test(overlay), false, "overlay.ts must not pull src/ into the bench at runtime");
});
