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
  CARD_SUMMARY_MAX,
  DRAWER_TABS,
  FLOAT_BASE_PX,
  FLOAT_GAP_PX,
  HOOK_MAX,
  HUD_OPTIONS_MAX,
  JOURNAL_RECENT_MAX,
  LOCATION_MAX_MS,
  LOG_RENDER_MAX,
  LOOT_EMPTY_MS,
  MENU_GRACE_MS,
  MENU_MARGIN,
  MENU_MAX_WIDTH,
  NOTICE_MAX,
  OPTION_LABEL_MAX,
  PREMISE_MAX,
  PROBLEMS_SHOWN,
  STRIP_MAX_LINES,
  authorBadge,
  clipOptionLabel,
  createHud,
  createOverlay,
  draftNote,
  drawerColumns,
  endingBannerKind,
  endingChoices,
  endingKicker,
  excerpt,
  floatLift,
  floatStackIndex,
  floatStackTop,
  journalObjectives,
  journalProgress,
  journalRecent,
  locationHoldMs,
  logWindow,
  menuEntries,
  menuEntryName,
  menuPlacement,
  menuWidth,
  narrationHoldMs,
  newPackItems,
  nextWriteStage,
  noticeOverflow,
  optionsLayout,
  overlayDemo,
  packItemText,
  premiseReady,
  problemLines,
  sizeTier,
  startCards,
  startRooms,
  stripHoldMs,
  stripMaxLines,
  stripOverflow,
  titleLines,
  toggleDrawerTab,
  usableDrawerTab,
  verdictWords,
  wrapClamp,
  writingLine,
  type DrawerTab,
  type WriteStage,
  type PackItem,
  type RecentFloat,
} from "../scripts/asset-bench/overlay";
import {
  CARD_CLOSED,
  TIP_GAP,
  TIP_MARGIN,
  TIP_MAX_WIDTH,
  attachItemCard,
  attachTip,
  cardNavIndex,
  cardStep,
  intersectBoxes,
  itemCardIsUp,
  placeTip,
  tipMaxWidth,
  tipTone,
  type Box,
  type CardEvent,
  type CardState,
} from "../scripts/asset-bench/tip";

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

test("newPackItems and packItemText: an item with a tip counts by its text", () => {
  const tip = { title: "Rope", lines: ["Fifty feet of hempen rope."] };
  const before = [{ label: "Bag", items: ["Torch", { text: "Rope", tip }] }];
  const after = [{ label: "Bag", items: ["Torch", { text: "Rope", tip }, { text: "Rusty key", tip: { title: "Rusty key", lines: ["Opens something."] } }, "Flint"] }];
  assert.deepEqual([...newPackItems(before, after)].sort(), ["Flint", "Rusty key"]);
  assert.equal(newPackItems(before, before).size, 0);
  assert.equal(packItemText("Torch"), "Torch");
  assert.equal(packItemText({ text: "Rope", tip }), "Rope");
  assert.equal(packItemText({ text: "Plain" }), "Plain");
});

// ---- hover help: where the tip stands ---------------------------------------

const VIEW: Box = { left: 0, top: 0, width: 1280, height: 800 };
const within = (p: { left: number; top: number }, size: { width: number; height: number }, b: Box, margin = TIP_MARGIN) => {
  assert.ok(p.left >= b.left + margin - 1e-9, `left ${p.left} under ${b.left + margin}`);
  assert.ok(p.top >= b.top + margin - 1e-9, `top ${p.top} under ${b.top + margin}`);
  assert.ok(p.left + size.width <= b.left + b.width - margin + 1e-9, `right edge ${p.left + size.width}`);
  assert.ok(p.top + size.height <= b.top + b.height - margin + 1e-9, `bottom edge ${p.top + size.height}`);
};

test("placeTip: beside the element, on the right when there is room", () => {
  const anchor: Box = { left: 100, top: 300, width: 120, height: 24 };
  const size = { width: 260, height: 90 };
  const p = placeTip(anchor, size, VIEW);
  assert.equal(p.side, "right");
  assert.equal(p.fits, true);
  assert.equal(p.left, 100 + 120 + TIP_GAP);
  within(p, size, VIEW);
});

test("placeTip: flips to the left when the right is cut off, below when neither side has room", () => {
  const size = { width: 260, height: 90 };
  const nearRight: Box = { left: 1100, top: 300, width: 120, height: 24 };
  const l = placeTip(nearRight, size, VIEW);
  assert.equal(l.side, "left");
  assert.equal(l.left, 1100 - TIP_GAP - 260);
  within(l, size, VIEW);
  // A phone: 390 wide, the element spans the column, neither side has room.
  const phone: Box = { left: 0, top: 0, width: 390, height: 844 };
  const row: Box = { left: 16, top: 400, width: 358, height: 22 };
  const b = placeTip(row, size, phone);
  assert.equal(b.side, "below");
  assert.equal(b.top, 400 + 22 + TIP_GAP);
  within(b, size, phone);
});

test("placeTip: above when there is no room below", () => {
  const phone: Box = { left: 0, top: 0, width: 390, height: 600 };
  const row: Box = { left: 16, top: 560, width: 358, height: 22 };
  const size = { width: 260, height: 90 };
  const p = placeTip(row, size, phone);
  assert.equal(p.side, "above");
  assert.equal(p.top, 560 - TIP_GAP - 90);
  assert.equal(p.fits, true);
  within(p, size, phone);
});

test("placeTip: clamps across the other axis so the tip never leaves the bounds", () => {
  const size = { width: 260, height: 160 };
  // Beside an element at the very top and the very bottom of the bounds.
  const top = placeTip({ left: 100, top: 0, width: 80, height: 20 }, size, VIEW);
  assert.equal(top.side, "right");
  within(top, size, VIEW);
  const bottom = placeTip({ left: 100, top: 790, width: 80, height: 10 }, size, VIEW);
  within(bottom, size, VIEW);
  assert.equal(bottom.top, 800 - TIP_MARGIN - 160);
  // Below a small element hanging off the left edge: the tip does not start off screen.
  const narrow: Box = { left: 0, top: 0, width: 300, height: 700 };
  const e = placeTip({ left: -20, top: 100, width: 40, height: 20 }, { width: 200, height: 60 }, narrow);
  within(e, { width: 200, height: 60 }, narrow);
});

test("placeTip: a wide element prefers below or above to the sides", () => {
  const bounds: Box = { left: 0, top: 0, width: 800, height: 600 };
  const wide: Box = { left: 20, top: 200, width: 600, height: 24 };
  const p = placeTip(wide, { width: 200, height: 50 }, bounds);
  assert.equal(p.side, "below");
  assert.equal(p.left, 20);
});

test("placeTip: with no room anywhere it takes the roomiest side and still stays inside the bounds", () => {
  const bounds: Box = { left: 0, top: 0, width: 300, height: 120 };
  const anchor: Box = { left: 10, top: 40, width: 280, height: 40 };
  const size = { width: 280, height: 100 };
  const p = placeTip(anchor, size, bounds);
  assert.equal(p.fits, false);
  within(p, size, bounds);
});

test("placeTip: a tip bigger than the bounds pins to their top left", () => {
  const bounds: Box = { left: 50, top: 60, width: 100, height: 40 };
  const p = placeTip({ left: 60, top: 70, width: 20, height: 10 }, { width: 280, height: 90 }, bounds);
  assert.equal(p.left, 50 + TIP_MARGIN);
  assert.equal(p.top, 60 + TIP_MARGIN);
});

test("placeTip: bounds that do not start at the origin (a game window inside the page)", () => {
  const game: Box = { left: 300, top: 200, width: 700, height: 500 };
  const size = { width: 260, height: 90 };
  for (const anchor of [{ left: 310, top: 210, width: 100, height: 20 }, { left: 900, top: 650, width: 90, height: 40 }, { left: 600, top: 400, width: 80, height: 20 }]) {
    within(placeTip(anchor, size, game), size, game);
  }
});

test("placeTip: stays inside the bounds across a sweep of positions and sizes", () => {
  const bounds: Box = { left: 40, top: 30, width: 520, height: 380 };
  for (let ax = 40; ax <= 560; ax += 60) {
    for (let ay = 30; ay <= 410; ay += 50) {
      for (const size of [{ width: 120, height: 40 }, { width: 280, height: 200 }, { width: 200, height: 330 }]) {
        within(placeTip({ left: ax, top: ay, width: 70, height: 22 }, size, bounds), size, bounds);
      }
    }
  }
});

test("intersectBoxes and tipMaxWidth", () => {
  assert.deepEqual(intersectBoxes({ left: 0, top: 0, width: 100, height: 100 }, { left: 50, top: 60, width: 100, height: 100 }), { left: 50, top: 60, width: 50, height: 40 });
  assert.equal(intersectBoxes({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 10, height: 10 }), null);
  assert.equal(tipMaxWidth(VIEW), TIP_MAX_WIDTH);
  assert.equal(tipMaxWidth({ left: 0, top: 0, width: 320, height: 600 }), TIP_MAX_WIDTH);
  assert.equal(tipMaxWidth({ left: 0, top: 0, width: 200, height: 600 }), 200 - TIP_MARGIN * 2);
  assert.equal(tipMaxWidth({ left: 0, top: 0, width: 20, height: 600 }), 60);
});

test("tipTone defaults to plain; attachTip is inert without a DOM", () => {
  assert.equal(tipTone({}), "plain");
  assert.equal(tipTone({ tone: "magic" }), "magic");
  assert.equal(typeof attachTip({} as HTMLElement, { title: "x", lines: [] }), "function");
});

// ---- the calmer board: the story strip, the context-aware HUD, the drawer -----

test("stripHoldMs: 3.5 s plus 40 ms a character, capped at 9 s; longer under reduced motion, and still capped", () => {
  assert.equal(stripHoldMs(0), 3500);
  assert.equal(stripHoldMs(50), 5500);
  assert.equal(stripHoldMs(137), 8980);
  assert.equal(stripHoldMs(138), 9000);
  assert.equal(stripHoldMs(2000), 9000);
  assert.equal(stripHoldMs(-3), 3500);
  assert.equal(stripHoldMs(0, true), 5250);
  assert.equal(stripHoldMs(2000, true), 13500);
  for (const n of [0, 10, 60, 120, 500]) {
    assert.ok(stripHoldMs(n, true) >= stripHoldMs(n), "reduced motion never reads shorter");
    assert.ok(Number.isFinite(stripHoldMs(n, true)) && stripHoldMs(n, true) <= 13500, "it still clears");
  }
});

test("stripMaxLines: two story lines, one on a phone while the DM narration is up", () => {
  assert.equal(STRIP_MAX_LINES, 2);
  assert.equal(stripMaxLines("l", false), 2);
  assert.equal(stripMaxLines("l", true), 2);
  assert.equal(stripMaxLines("m", true), 2);
  assert.equal(stripMaxLines("s", false), 2);
  assert.equal(stripMaxLines("s", true), 1);
});

test("stripOverflow: the oldest fades first, and a kept line outlasts an ordinary one", () => {
  assert.deepEqual(stripOverflow([], 2), []);
  assert.deepEqual(stripOverflow([false, false], 2), []);
  assert.deepEqual(stripOverflow([false, false, false], 2), [0]);
  assert.deepEqual(stripOverflow([false, false, false, false], 2), [0, 1]);
  assert.deepEqual(stripOverflow([true, false, false], 2), [1], "the sticky line stays, the oldest ordinary one goes");
  assert.deepEqual(stripOverflow([true, true, false], 2), [2], "a sticky line is never chosen while an ordinary one is left");
  assert.deepEqual(stripOverflow([true, true, true], 2), [0], "all sticky: the oldest still goes");
  assert.deepEqual(stripOverflow([false, false], 1), [0], "one line on a phone under the narration");
  assert.deepEqual(stripOverflow([false], 0), [0]);
});

test("toggleDrawerTab and usableDrawerTab: one tab at a time, the open one closes it, a missing part shows nothing", () => {
  assert.deepEqual(DRAWER_TABS, ["pack", "journal", "log", "saves"]);
  assert.equal(toggleDrawerTab(null, "pack"), "pack");
  assert.equal(toggleDrawerTab("pack", "pack"), null);
  assert.equal(toggleDrawerTab("pack", "log"), "log");
  assert.equal(toggleDrawerTab("log", "saves"), "saves");
  assert.equal(toggleDrawerTab("saves", "saves"), null);
  const all = { pack: true, journal: true, log: true, saves: true };
  assert.equal(usableDrawerTab("log", all), "log");
  assert.equal(usableDrawerTab(null, all), null);
  assert.equal(usableDrawerTab("log", { pack: true, journal: true, log: false, saves: true }), null);
  assert.equal(usableDrawerTab("journal", { pack: true, journal: false, log: true, saves: true }), null);
  assert.equal(usableDrawerTab("journal", all), "journal");
  assert.equal(usableDrawerTab("saves", { pack: false, journal: false, log: false, saves: false }), null);
  // Pressing every tab twice in turn walks open, closed, open, closed.
  let open: DrawerTab | null = null;
  const seen: (DrawerTab | null)[] = [];
  for (const t of DRAWER_TABS) {
    for (let i = 0; i < 2; i++) {
      open = toggleDrawerTab(open, t);
      seen.push(open);
    }
  }
  assert.deepEqual(seen, ["pack", null, "journal", null, "log", null, "saves", null]);
});

test("clipOptionLabel: one run of words, at most 32 characters, cut with two dots", () => {
  assert.equal(OPTION_LABEL_MAX, 32);
  assert.equal(clipOptionLabel("Pull the stone loose"), "Pull the stone loose");
  assert.equal(clipOptionLabel("  Leave   it \n alone "), "Leave it alone");
  const exactly = "x".repeat(32);
  assert.equal(clipOptionLabel(exactly), exactly);
  const clipped = clipOptionLabel("Pull the loose stone out of the wall and look behind it");
  assert.equal(clipped.length, 32);
  assert.ok(clipped.endsWith(".."));
  assert.equal(clipped, "Pull the loose stone out of th..");
  assert.equal(clipOptionLabel("abcdef", 4), "ab..");
  assert.equal(clipOptionLabel(""), "");
});

test("optionsLayout: four at most, blanks dropped, keys by position, one column unless every label is short", () => {
  assert.equal(HUD_OPTIONS_MAX, 4);
  assert.deepEqual(optionsLayout([]), { columns: 1, items: [] });
  const long = optionsLayout([
    { id: "a", label: "Pull the stone loose" },
    { id: "b", label: "Leave it" },
    { id: "c", label: "Tap it with your sword" },
    { id: "d", label: "Ask the goblin what it knows about the wall and the stone" },
    { id: "e", label: "A fifth one that never shows" },
  ]);
  assert.equal(long.columns, 1);
  assert.deepEqual(
    long.items.map((i) => [i.id, i.key]),
    [["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"]],
  );
  assert.equal(long.items[3]?.label.length, 32);
  assert.equal(long.items[3]?.full, "Ask the goblin what it knows about the wall and the stone");
  const short = optionsLayout([{ id: "a", label: "Leave it" }, { id: "b", label: "Look" }]);
  assert.equal(short.columns, 2);
  assert.equal(optionsLayout([{ id: "a", label: "Leave it" }]).columns, 1, "a lone button takes the row");
  const gaps = optionsLayout([{ id: "x", label: "   " }, { id: "", label: "No id" }, { id: "a", label: "Open it", key: "F" }, { id: "b", label: "Shut it" }]);
  assert.deepEqual(
    gaps.items.map((i) => [i.id, i.key, i.enabled]),
    [["a", "F", true], ["b", "2", true]],
    "blanks never take a number; a given key stays",
  );
  assert.equal(optionsLayout([{ id: "a", label: "Twelve chars", enabled: false }, { id: "b", label: "Thirteen char" }]).columns, 1);
  assert.equal(optionsLayout([{ id: "a", label: "Leave it", enabled: false }]).items[0]?.enabled, false);
});

test("wrapClamp: wrapped to the width, never more than the lines allowed, the last line cut with two dots", () => {
  const width = 21 * 6;
  const lines = wrapClamp("Pull the loose stone out of the wall", width, 2);
  assert.ok(lines.length <= 2);
  assert.deepEqual(wrapClamp("Leave it", width, 2), ["Leave it"]);
  const clamped = wrapClamp("Ask the goblin what it knows about the wall and the stone", width, 2);
  assert.equal(clamped.length, 2);
  assert.ok(clamped[1]?.endsWith(".."));
  for (const l of clamped) assert.ok(textWidth(l) <= width, `"${l}" fits ${width}`);
  const one = wrapClamp("Ask the goblin what it knows about the wall", width, 1);
  assert.equal(one.length, 1);
  assert.ok(textWidth(one[0] ?? "") <= width);
  assert.equal(wrapClamp("short", width, 0).length, 1, "at least one line");
  // Every clipped label is two lines at most at the narrowest column (the pixel font, scale 2, regular).
  const room = Math.floor((320 - 30 - 12 - 8 - 2) / 2);
  assert.ok(wrapClamp(clipOptionLabel("W".repeat(40)), room, 2).length <= 2);
});

test("logWindow: the newest lines, and how many older ones are left out", () => {
  const log = Array.from({ length: 5 }, (_, i) => ({ text: `line ${i}` }));
  assert.deepEqual(logWindow(log, 10), { shown: log, hidden: 0 });
  assert.deepEqual(logWindow(log, 5), { shown: log, hidden: 0 });
  const cut = logWindow(log, 3);
  assert.equal(cut.hidden, 2);
  assert.deepEqual(cut.shown.map((l) => l.text), ["line 2", "line 3", "line 4"], "oldest first, newest last");
  assert.equal(logWindow([], 3).hidden, 0);
  assert.ok(LOG_RENDER_MAX >= 100);
  assert.equal(logWindow(Array.from({ length: LOG_RENDER_MAX + 7 }, () => 1)).hidden, 7);
});

test("noticeOverflow: the stack holds two, so the third pushes the oldest out", () => {
  assert.equal(NOTICE_MAX, 2);
  assert.equal(noticeOverflow(0), 0);
  assert.equal(noticeOverflow(1), 0);
  assert.equal(noticeOverflow(2), 1);
  assert.equal(noticeOverflow(3), 2);
});

test("the HUD exports its calmer contract and loads without a DOM", () => {
  assert.equal(typeof createHud, "function");
  assert.equal(typeof document, "undefined");
});

// ---- the item card ----------------------------------------------------------

const ACTS = [
  { id: "equip", enabled: true },
  { id: "use", enabled: false },
  { id: "drop", enabled: true },
  { id: "destroy", enabled: true, confirm: "Destroy it? It is gone for good." },
];
const OPEN: CardState = { open: true, confirming: null };

test("cardStep: a click pins the card and a second click unpins it", () => {
  const a = cardStep(CARD_CLOSED, { type: "toggle" }, ACTS);
  assert.deepEqual(a, { state: OPEN, fire: null });
  assert.deepEqual(cardStep(a.state, { type: "toggle" }, ACTS), { state: CARD_CLOSED, fire: null });
});

test("cardStep: a plain button fires and closes the card", () => {
  assert.deepEqual(cardStep(OPEN, { type: "press", id: "equip" }, ACTS), { state: CARD_CLOSED, fire: "equip" });
  assert.deepEqual(cardStep(OPEN, { type: "press", id: "drop" }, ACTS), { state: CARD_CLOSED, fire: "drop" });
});

test("cardStep: a disabled, unknown or unpinned press does nothing at all", () => {
  assert.deepEqual(cardStep(OPEN, { type: "press", id: "use" }, ACTS), { state: OPEN, fire: null });
  assert.deepEqual(cardStep(OPEN, { type: "press", id: "nope" }, ACTS), { state: OPEN, fire: null });
  assert.deepEqual(cardStep(CARD_CLOSED, { type: "press", id: "equip" }, ACTS), { state: CARD_CLOSED, fire: null });
});

test("cardStep: a confirm button asks first and only Yes fires it", () => {
  const asked = cardStep(OPEN, { type: "press", id: "destroy" }, ACTS);
  assert.deepEqual(asked, { state: { open: true, confirming: "destroy" }, fire: null });
  assert.deepEqual(cardStep(asked.state, { type: "yes" }, ACTS), { state: CARD_CLOSED, fire: "destroy" });
  // No goes back to the buttons and fires nothing.
  assert.deepEqual(cardStep(asked.state, { type: "no" }, ACTS), { state: OPEN, fire: null });
  // Yes and No with nothing being asked are inert.
  assert.deepEqual(cardStep(OPEN, { type: "yes" }, ACTS), { state: OPEN, fire: null });
  assert.deepEqual(cardStep(OPEN, { type: "no" }, ACTS), { state: OPEN, fire: null });
});

test("cardStep: Yes cannot fire an action that went disabled while the question was up", () => {
  const asked: CardState = { open: true, confirming: "destroy" };
  const now = ACTS.map((a) => (a.id === "destroy" ? { ...a, enabled: false } : a));
  assert.deepEqual(cardStep(asked, { type: "yes" }, now), { state: OPEN, fire: null });
});

test("cardStep: Escape or a click elsewhere closes the card from any state and fires nothing", () => {
  for (const s of [OPEN, { open: true, confirming: "destroy" } as CardState, CARD_CLOSED]) assert.deepEqual(cardStep(s, { type: "dismiss" }, ACTS), { state: CARD_CLOSED, fire: null });
});

test("cardStep never fires anything but an enabled action of the list, whatever the sequence", () => {
  const ids = new Set(ACTS.filter((a) => a.enabled).map((a) => a.id));
  const events: CardEvent[] = [{ type: "toggle" }, { type: "yes" }, { type: "no" }, { type: "dismiss" }, ...ACTS.map((a) => ({ type: "press", id: a.id }) as CardEvent), { type: "press", id: "ghost" }];
  let seed = 7;
  for (let run = 0; run < 40; run++) {
    let state: CardState = CARD_CLOSED;
    for (let i = 0; i < 25; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const r = cardStep(state, events[seed % events.length]!, ACTS);
      if (r.fire !== null) assert.ok(ids.has(r.fire), `fired ${r.fire}`);
      if (r.fire !== null) assert.equal(r.state.open, false, "a fired action closes the card");
      state = r.state;
    }
  }
});

test("cardNavIndex: arrows wrap around the buttons and Home and End jump", () => {
  assert.equal(cardNavIndex(0, -1, "ArrowDown"), -1);
  assert.equal(cardNavIndex(4, -1, "ArrowDown"), 0);
  assert.equal(cardNavIndex(4, -1, "ArrowUp"), 3);
  assert.equal(cardNavIndex(4, 3, "ArrowDown"), 0);
  assert.equal(cardNavIndex(4, 0, "ArrowUp"), 3);
  assert.equal(cardNavIndex(4, 1, "ArrowDown"), 2);
  assert.equal(cardNavIndex(4, 2, "Home"), 0);
  assert.equal(cardNavIndex(4, 0, "End"), 3);
  assert.equal(cardNavIndex(4, 2, "x"), 2);
});

test("attachItemCard is inert without a DOM, and a pack item may carry a card and a key", () => {
  const off = attachItemCard({} as HTMLElement, () => ({ tip: { title: "x", lines: [] }, status: "s", actions: [] }), () => {});
  assert.equal(typeof off, "function");
  off();
  assert.equal(itemCardIsUp(), false);
  const item: PackItem = { text: "Ring", key: "bag:0", card: () => ({ tip: { title: "Ring", lines: [] }, status: "Cannot be used", actions: [{ id: "drop", label: "Drop", enabled: true }] }) };
  assert.equal(packItemText(item), "Ring");
  // A card on a row does not make it "new" under another name.
  assert.equal(newPackItems([{ label: "Bag", items: [item] }], [{ label: "Bag", items: [item] }]).size, 0);
});

// ---- the context menu and the loot window ------------------------------------

const BOARD = { width: 640, height: 420 };
const MENU = { width: 272, height: 200 };

test("menuPlacement: the menu's corner goes on the point when there is room", () => {
  assert.deepEqual(menuPlacement({ x: 100, y: 80 }, MENU, BOARD), { left: 100, top: 80, flipX: false, flipY: false, maxHeight: 408 });
});

test("menuPlacement: no room on the right opens it to the left of the point, no room below opens it above", () => {
  const p = menuPlacement({ x: 600, y: 380 }, MENU, BOARD);
  assert.equal(p.flipX, true);
  assert.equal(p.flipY, true);
  assert.equal(p.left, 600 - MENU.width);
  assert.equal(p.top, 380 - MENU.height);
  const right = menuPlacement({ x: 600, y: 50 }, MENU, BOARD);
  assert.equal(right.flipX, true);
  assert.equal(right.flipY, false);
  assert.equal(right.top, 50);
});

test("menuPlacement: always inside the board less the margin, wherever the point is", () => {
  for (const [w, h] of [[640, 420], [370, 340], [280, 200]]) {
    const board = { width: w!, height: h! };
    for (let x = -20; x <= w! + 20; x += 23) {
      for (let y = -20; y <= h! + 20; y += 19) {
        const size = { width: menuWidth(w!), height: 150 };
        const p = menuPlacement({ x, y }, size, board);
        assert.ok(p.left >= MENU_MARGIN, `left ${p.left} at ${x},${y} on ${w}x${h}`);
        assert.ok(p.top >= MENU_MARGIN, `top ${p.top} at ${x},${y} on ${w}x${h}`);
        assert.ok(p.left + size.width <= w! - MENU_MARGIN + 0.001, `right edge at ${x},${y} on ${w}x${h}`);
        assert.ok(p.top + Math.min(size.height, p.maxHeight) <= h! - MENU_MARGIN + 0.001, `bottom edge at ${x},${y} on ${w}x${h}`);
      }
    }
  }
});

test("menuPlacement: a point near the left or top edge clamps to the margin, and a menu taller than the board scrolls", () => {
  const p = menuPlacement({ x: 1, y: 2 }, MENU, BOARD);
  assert.deepEqual([p.left, p.top, p.flipX, p.flipY], [MENU_MARGIN, MENU_MARGIN, false, false]);
  const tall = menuPlacement({ x: 100, y: 300 }, { width: 272, height: 900 }, BOARD);
  assert.equal(tall.maxHeight, BOARD.height - MENU_MARGIN * 2);
  assert.equal(tall.top, MENU_MARGIN);
  const wide = menuPlacement({ x: 10, y: 10 }, { width: 900, height: 100 }, { width: 300, height: 300 });
  assert.equal(wide.left, MENU_MARGIN);
});

test("menuWidth: the usual width on a wide board, less the margins on a phone", () => {
  assert.equal(menuWidth(1000), MENU_MAX_WIDTH);
  assert.equal(menuWidth(370), 272);
  assert.equal(menuWidth(260), 244);
  assert.equal(menuWidth(100), 140);
});

test("menuEntries drops blank ones and tidies labels; menuEntryName says why it is offered and why it cannot be done", () => {
  const list = menuEntries([
    { id: "a", label: "  Look   closer ", enabled: true },
    { id: "", label: "No id", enabled: true },
    { id: "b", label: "   ", enabled: true },
    { id: "c", label: "Pickpocket", why: "Rogue: Sleight of Hand +7", good: true, enabled: false, reason: "It is watching you." },
  ]);
  assert.deepEqual(list.map((e) => e.id), ["a", "c"]);
  assert.equal(list[0]!.label, "Look closer");
  assert.equal(menuEntryName(list[0]!), "Look closer");
  assert.equal(menuEntryName(list[1]!), "Pickpocket, Rogue: Sleight of Hand +7, unavailable: It is watching you.");
  // A reason on an enabled entry is not "unavailable".
  assert.equal(menuEntryName({ label: "Kick it", enabled: true, reason: "Hurts" }), "Kick it");
});

test("the menu and loot timings are the ones the contract states", () => {
  assert.equal(MENU_GRACE_MS, 300);
  assert.ok(LOOT_EMPTY_MS >= 800 && LOOT_EMPTY_MS <= 2000);
  assert.equal(typeof createOverlay, "function");
});

// ---- the adventure screens: pure helpers ----------------------------------------

test("draftNote and authorBadge: the words on an adventure card", () => {
  assert.equal(draftNote(undefined), "");
  assert.equal(draftNote(0), "");
  assert.equal(draftNote(-3), "");
  assert.equal(draftNote(NaN), "");
  assert.equal(draftNote(1), "Draft: 1 item marked for review");
  assert.equal(draftNote(6), "Draft: 6 items marked for review");
  assert.equal(draftNote(2.9), "Draft: 2 items marked for review");
  assert.equal(authorBadge("owner"), "Hand written");
  assert.equal(authorBadge("ai"), "AI written");
});

test("startCards: tidy, drop the nameless, keep the first of a repeated id, and only a file without problems is playable", () => {
  const cards = startCards([
    { id: "rat-cellar", title: "  The   Rat Cellar ", summary: "A  small\nvillage.", author: "owner", draftMarks: 6.7 },
    { id: "", title: "No id", summary: "", author: "owner" },
    { id: "blank", title: "   ", summary: "", author: "owner" },
    { id: "rat-cellar", title: "A copy", summary: "", author: "owner" },
    { id: "bad", title: "Broken", summary: "x", author: "ai", problems: ["  Scene has no exit.  ", "   ", "Start missing."] },
    { id: "ai", title: "Written", summary: "y", author: "ai", draftMarks: -2 },
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["rat-cellar", "bad", "ai"]);
  assert.equal(cards[0]!.title, "The Rat Cellar");
  assert.equal(cards[0]!.summary, "A small village.");
  assert.equal(cards[0]!.draftMarks, 6);
  assert.equal(cards[0]!.playable, true);
  assert.deepEqual(cards[1]!.problems, ["Scene has no exit.", "Start missing."]);
  assert.equal(cards[1]!.playable, false);
  assert.equal(cards[1]!.author, "ai");
  assert.equal(cards[2]!.draftMarks, 0);
  assert.equal(cards[2]!.playable, true);
  assert.deepEqual(startRooms([{ id: "a", title: " One  goblin ", summary: " x " }, { id: "a", title: "dup", summary: "" }, { id: "", title: "no id", summary: "" }]), [{ id: "a", title: "One goblin", summary: "x" }]);
});

test("excerpt cuts a long blurb at a sentence, or at a word with two dots", () => {
  assert.equal(excerpt("Short and sweet."), "Short and sweet.");
  const long = "Wick End is a small village where everyone knows everyone. You wake in your home, a young apprentice to your father. Wanting more than his workshop, you take extra jobs on the side. Today the job is the Copper Kettle's cellar: the landlady has a rodent problem in her basement.";
  const cut = excerpt(long, 190);
  assert.ok(cut.length <= 190);
  assert.ok(cut.endsWith("."), cut);
  assert.ok(long.startsWith(cut));
  assert.equal(cut, "Wick End is a small village where everyone knows everyone. You wake in your home, a young apprentice to your father. Wanting more than his workshop, you take extra jobs on the side.");
  // One long sentence: cut at a word, never mid-word, ended with two dots.
  const one = "word ".repeat(100).trim();
  const e = excerpt(one, 50);
  assert.ok(e.endsWith(".."));
  assert.ok(e.length <= 52);
  assert.equal(e.replace(/\.\.$/, "").split(" ").every((w) => w === "word"), true);
  assert.equal(excerpt("a".repeat(300), 20), "a".repeat(20) + "..");
  assert.equal(CARD_SUMMARY_MAX, 260);
  assert.ok(HOOK_MAX >= CARD_SUMMARY_MAX);
});

test("problemLines lists the first few problems and then how many more", () => {
  assert.deepEqual(problemLines([]), []);
  assert.deepEqual(problemLines(["a", " b "]), ["a", "b"]);
  const six = ["1", "2", "3", "4", "5", "6"];
  assert.equal(PROBLEMS_SHOWN, 4);
  assert.deepEqual(problemLines(six), ["1", "2", "3", "4", "and 2 more"]);
  assert.deepEqual(problemLines(["1", "2", "3", "4"]), ["1", "2", "3", "4"]);
  assert.deepEqual(problemLines(["1", "2", "3", "4", "5"]), ["1", "2", "3", "4", "and 1 more"]);
});

test("nextWriteStage: the AI card asks before it writes, sends once, and only steps back when it can", () => {
  const step = (stage: WriteStage, ev: Parameters<typeof nextWriteStage>[1], premise = "a lighthouse") => nextWriteStage(stage, ev, premise);
  assert.deepEqual(step("closed", "open"), { stage: "form", fire: false });
  assert.deepEqual(step("form", "open"), { stage: "form", fire: false });
  // Write needs words, and only asks.
  assert.deepEqual(step("form", "write"), { stage: "confirm", fire: false });
  assert.deepEqual(step("form", "write", "   "), { stage: "form", fire: false });
  assert.deepEqual(step("closed", "write"), { stage: "closed", fire: false });
  // Yes is the one thing that sends, once.
  assert.deepEqual(step("confirm", "yes"), { stage: "writing", fire: true });
  assert.deepEqual(step("writing", "yes"), { stage: "writing", fire: false });
  assert.deepEqual(step("form", "yes"), { stage: "form", fire: false });
  assert.deepEqual(step("confirm", "yes", ""), { stage: "confirm", fire: false });
  // Back: confirm to the form, the form to shut, nothing while writing.
  assert.deepEqual(step("confirm", "back"), { stage: "form", fire: false });
  assert.deepEqual(step("form", "back"), { stage: "closed", fire: false });
  assert.deepEqual(step("closed", "back"), { stage: "closed", fire: false });
  assert.deepEqual(step("writing", "back"), { stage: "writing", fire: false });
  // The host says it is writing (from any stage) or has stopped (only a writing card goes back to the form).
  for (const st of ["closed", "form", "confirm", "writing"] as WriteStage[]) assert.deepEqual(step(st, "busy"), { stage: "writing", fire: false });
  assert.deepEqual(step("writing", "idle"), { stage: "form", fire: false });
  assert.deepEqual(step("closed", "idle"), { stage: "closed", fire: false });
  // A walk through the whole flow fires exactly twice: the retry after a stop sends again, a double press does not.
  let stage: WriteStage = "closed";
  let fired = 0;
  for (const ev of ["open", "write", "yes", "yes", "busy", "idle", "write", "yes"] as const) {
    const r = nextWriteStage(stage, ev, "x");
    stage = r.stage;
    if (r.fire) fired++;
  }
  assert.equal(fired, 2);
  assert.equal(premiseReady(" \n "), false);
  assert.equal(premiseReady("a"), true);
  assert.ok(PREMISE_MAX >= 500);
  assert.equal(writingLine(undefined), "Starting the writer");
  assert.equal(writingLine("  Writing   the cellar "), "Writing the cellar");
});

test("ending words: kicker, banner colour and the buttons", () => {
  assert.equal(endingKicker("victory"), "Victory");
  assert.equal(endingKicker("defeat"), "Defeat");
  assert.equal(endingKicker("continue"), "The story goes on");
  assert.equal(endingBannerKind("victory"), "victory");
  assert.equal(endingBannerKind("defeat"), "defeat");
  assert.equal(endingBannerKind("continue"), "initiative");
  assert.deepEqual(endingChoices(true), ["continue", "menu"]);
  assert.deepEqual(endingChoices(false), ["menu"]);
});

test("locationHoldMs: a title alone is brief, a read-aloud is given reading time, never more than 14 s", () => {
  assert.equal(locationHoldMs(0), 3000);
  assert.equal(locationHoldMs(100), 3500 + 45 * 100);
  assert.ok(locationHoldMs(100) > locationHoldMs(50));
  assert.equal(locationHoldMs(100000), LOCATION_MAX_MS);
  assert.equal(LOCATION_MAX_MS, 14000);
});

test("titleLines: one line when it fits, otherwise the two closest halves", () => {
  assert.deepEqual(titleLines("The Rat Cellar", true), ["The Rat Cellar"]);
  assert.deepEqual(titleLines("Cellar", false), ["Cellar"]);
  assert.deepEqual(titleLines("The Haunted Lighthouse of Gull Point", false), ["The Haunted Lighthouse", "of Gull Point"]);
  assert.deepEqual(titleLines("one two three four", false), ["one two", "three four"]);
  assert.deepEqual(titleLines("  spaced   out  ", true), ["spaced out"]);
});

test("drawerColumns: a tab each up to three, two columns of two for four", () => {
  assert.equal(drawerColumns(0), 1);
  assert.equal(drawerColumns(1), 1);
  assert.equal(drawerColumns(3), 3);
  assert.equal(drawerColumns(4), 2);
});

test("journal helpers: objectives tidied, progress counted, recent beats newest first and capped", () => {
  const objs = journalObjectives([{ text: "  Talk to  Marta ", done: true }, { text: "   ", done: false }, { text: "Clear the cellar", done: false }]);
  assert.deepEqual(objs, [{ text: "Talk to Marta", done: true }, { text: "Clear the cellar", done: false }]);
  assert.deepEqual(journalObjectives(undefined), []);
  assert.equal(journalProgress(undefined), "");
  assert.equal(journalProgress([]), "");
  assert.equal(journalProgress([{ text: "a", done: true }, { text: "b", done: false }, { text: "c", done: false }]), "1 of 3 done");
  assert.equal(journalProgress([{ text: "a", done: true }, { text: " ", done: true }]), "1 of 1 done");
  assert.deepEqual(journalRecent(undefined), []);
  assert.deepEqual(journalRecent(["one", "", "two", "three"]), ["three", "two", "one"]);
  const many = ["1", "2", "3", "4", "5", "6", "7"];
  assert.equal(JOURNAL_RECENT_MAX, 5);
  assert.deepEqual(journalRecent(many), ["7", "6", "5", "4", "3"]);
  assert.deepEqual(journalRecent(many, 2), ["7", "6"]);
});

test("the adventure screens are part of the Overlay and the Hud, and need no DOM to import", () => {
  assert.equal(typeof createOverlay, "function");
  assert.equal(typeof createHud, "function");
  const text = readFileSync(new URL("../scripts/asset-bench/overlay.ts", import.meta.url), "utf8");
  for (const name of ["startScreen", "startHero", "locationCard", "sceneCard", "endingCard", "toggleJournal"]) assert.ok(text.includes(name), name);
});

// ---- hygiene ----------------------------------------------------------------

test("the new bench files hold no em or en dash, and the overlay imports src for types only", () => {
  for (const file of ["pixelFont.ts", "overlay.ts", "tip.ts"]) {
    const text = readFileSync(new URL(`../scripts/asset-bench/${file}`, import.meta.url), "utf8");
    assert.equal(text.includes(code(0x2014)), false, `${file} has an em dash`);
    assert.equal(text.includes(code(0x2013)), false, `${file} has an en dash`);
  }
  const overlay = readFileSync(new URL("../scripts/asset-bench/overlay.ts", import.meta.url), "utf8");
  assert.equal(/^import (?!type\b)[^\n]*"\.\.\/\.\.\/src\//m.test(overlay), false, "overlay.ts must not pull src/ into the bench at runtime");
  const tip = readFileSync(new URL("../scripts/asset-bench/tip.ts", import.meta.url), "utf8");
  assert.equal(/^import [^\n]*"\.\.\/\.\.\/src\//m.test(tip), false, "tip.ts must not import from src/");
});
