/**
 * The stage fit (src/games/livingtable/table/stageFit.ts): how big the board is drawn for the room the page gives it.
 * The scale picker is pure, so it is checked here with no page: it grows with the stage, never exceeds it, keeps the
 * board's shape, honours an explicit zoom without ever overflowing, and the layout rules it leans on are in the CSS.
 * Run: npx -y tsx --test test/livingtable-stagefit.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_CANVAS_W, STACK_AT, autoScale, fitBoard, stackedAt, type FitBoard } from "../src/games/livingtable/table/stageFit";
import { tableStyleCss } from "../src/games/livingtable/table/tableStyle";

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");

const BOARD32: FitBoard = { cols: 20, rows: 15, artPx: 32 };
const BOARD16: FitBoard = { cols: 20, rows: 15, artPx: 16 };

const WIDTHS = [1, 40, 160, 300, 320, 390, 640, 641, 700, 768, 1000, 1280, 1281, 1920, 2560, 3840, 5000];
const HEIGHTS = [1, 40, 120, 240, 320, 480, 481, 600, 720, 900, 1080, 1440, 2160, 4000];

test("the scale never drops below 1 and follows the smaller of the two axes", () => {
  assert.equal(autoScale({ availW: 1280, availH: 960 }, BOARD32), 2, "1280 wide is two boards of 640");
  assert.equal(autoScale({ availW: 1280, availH: 480 }, BOARD32), 1, "the height alone holds it to 1");
  assert.equal(autoScale({ availW: 1919, availH: 1440 }, BOARD32), 2, "one short of 3 stays 2");
  assert.equal(autoScale({ availW: 1920, availH: 1440 }, BOARD32), 3);
  assert.equal(autoScale({ availW: 100, availH: 100 }, BOARD32), 1, "a tiny stage still draws at 1");
  assert.equal(autoScale({ availW: 640, availH: 480 }, BOARD16), 2, "16 px art halves the maths");
});

test("the scale is monotonic in the stage size and the board it draws never exceeds the stage", () => {
  for (const board of [BOARD32, BOARD16]) {
    for (const h of HEIGHTS) {
      let prevScale = 0;
      let prevW = 0;
      let prevH = 0;
      for (const w of WIDTHS) {
        const s = autoScale({ availW: w, availH: h }, board);
        const f = fitBoard({ availW: w, availH: h }, board, null);
        assert.ok(s >= prevScale, `scale falls going wider (${w}x${h}, art ${board.artPx}): ${s} < ${prevScale}`);
        assert.ok(f.cssW >= prevW && f.cssH >= prevH, `the board shrinks going wider (${w}x${h})`);
        assert.ok(f.cssW <= w && f.cssH <= h, `the board overflows the stage (${w}x${h}): ${f.cssW}x${f.cssH}`);
        prevScale = s;
        prevW = f.cssW;
        prevH = f.cssH;
      }
    }
    for (const w of WIDTHS) {
      let prevScale = 0;
      let prevW = 0;
      let prevH = 0;
      for (const h of HEIGHTS) {
        const s = autoScale({ availW: w, availH: h }, board);
        const f = fitBoard({ availW: w, availH: h }, board, null);
        assert.ok(s >= prevScale, `scale falls going taller (${w}x${h}): ${s} < ${prevScale}`);
        assert.ok(f.cssW >= prevW && f.cssH >= prevH, `the board shrinks going taller (${w}x${h})`);
        prevScale = s;
        prevW = f.cssW;
        prevH = f.cssH;
      }
    }
  }
});

test("the board keeps its shape and fills the stage along the tighter axis (to within a pixel)", () => {
  for (const [w, h] of [[390, 400], [1280, 900], [1920, 1080], [3840, 2160], [2000, 300]] as const) {
    const f = fitBoard({ availW: w, availH: h }, BOARD32, null);
    assert.ok(Math.abs(f.cssW * 15 - f.cssH * 20) <= 20, `${w}x${h}: ${f.cssW}x${f.cssH} is not 4:3`);
    const widthLimited = w * 15 <= h * 20;
    if (widthLimited) assert.ok(f.cssW >= w - 1, `${w}x${h}: the width is not used (${f.cssW})`);
    else assert.ok(f.cssH >= h - 1, `${w}x${h}: the height is not used (${f.cssH})`);
  }
});

test("between whole steps the canvas is CSS-sized to fit; at a whole step it is drawn one to one", () => {
  const exact = fitBoard({ availW: 1280, availH: 960 }, BOARD32, null);
  assert.equal(exact.scale, 2);
  assert.equal(exact.canvasW, 1280);
  assert.equal(exact.cssW, 1280);
  const between = fitBoard({ availW: 1000, availH: 900 }, BOARD32, null);
  assert.equal(between.scale, 1, "1000 wide holds one 640 board");
  assert.equal(between.canvasW, 640);
  assert.equal(between.cssW, 1000, "and is stretched to the stage");
  const phone = fitBoard({ availW: 300, availH: 700 }, BOARD32, null);
  assert.equal(phone.scale, 1);
  assert.equal(phone.cssW, 300, "a phone shrinks the 1x canvas to the screen");
  assert.ok(phone.cssW < phone.canvasW);
});

test("a big screen goes above 4, but a canvas is never made wider than the cap", () => {
  const big = fitBoard({ availW: 3840, availH: 2160 }, BOARD16, null);
  assert.ok(big.scale > 4, `4K with 16 px art reaches ${big.scale}`);
  for (const w of WIDTHS)
    for (const h of HEIGHTS)
      for (const b of [BOARD16, BOARD32]) {
        const f = fitBoard({ availW: w, availH: h }, b, null);
        assert.ok(f.canvasW <= Math.max(MAX_CANVAS_W, b.cols * b.artPx), `${w}x${h}: canvas ${f.canvasW} wide`);
        assert.equal(f.canvasW, f.scale * b.cols * b.artPx);
        assert.equal(f.canvasH, f.scale * b.rows * b.artPx);
      }
});

test("an explicit zoom stays whole, is never above what fits, and is drawn one to one unless the stage is smaller", () => {
  const roomy = { availW: 3840, availH: 2160 };
  assert.equal(fitBoard(roomy, BOARD32, 1).scale, 1);
  assert.equal(fitBoard(roomy, BOARD32, 1).cssW, 640, "a 1x board on a huge stage stays 640 wide");
  assert.equal(fitBoard(roomy, BOARD32, 2).cssW, 1280);
  const tight = { availW: 700, availH: 600 };
  const capped = fitBoard(tight, BOARD32, 4);
  assert.equal(capped.scale, 1, "zoom 4 cannot overflow a 700 px stage");
  assert.ok(capped.cssW <= 700 && capped.cssH <= 600);
  for (const w of WIDTHS)
    for (const h of HEIGHTS)
      for (const z of [1, 2, 3, 4]) {
        const f = fitBoard({ availW: w, availH: h }, BOARD32, z);
        assert.ok(f.scale <= z && f.scale <= autoScale({ availW: w, availH: h }, BOARD32), `${w}x${h} zoom ${z} -> ${f.scale}`);
        assert.ok(Number.isInteger(f.scale) && f.scale >= 1);
        assert.ok(f.cssW <= w && f.cssH <= h, `${w}x${h} zoom ${z} overflows: ${f.cssW}x${f.cssH}`);
      }
});

test("density: a zoomed page draws a denser canvas, but the box stays in CSS pixels", () => {
  const room = { availW: 1280, availH: 720 };
  const plain = fitBoard(room, BOARD16, null);
  const dense = fitBoard(room, BOARD16, null, 2);
  assert.equal(plain.scale, 3, "1280 by 720 holds a 3x board of 16 px art (960 by 720)");
  assert.equal(dense.scale, 6, "at density 2 the same CSS room holds twice the pixels: 6x");
  assert.equal(dense.cssW, plain.cssW, "the CSS box is the same");
  assert.equal(dense.cssH, plain.cssH);
  assert.equal(dense.canvasW, dense.scale * 320);
  assert.equal(fitBoard(room, BOARD16, null, 1).scale, fitBoard(room, BOARD16, null).scale, "density 1 is the default");
  assert.equal(autoScale(room, BOARD16, 2), dense.scale);
  assert.equal(autoScale(room, BOARD16), plain.scale);
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(fitBoard(room, BOARD16, null, bad).scale, plain.scale, `density ${bad} falls back to 1`);
  // never more than the cap, and an explicit zoom is one canvas pixel to one device pixel
  assert.ok(fitBoard({ availW: 5000, availH: 4000 }, BOARD16, null, 3).canvasW <= MAX_CANVAS_W);
  const z = fitBoard({ availW: 3000, availH: 2000 }, BOARD32, 1, 2);
  assert.equal(z.scale, 1);
  assert.equal(z.cssW, 320, "a 640 px canvas on a 2x page is 320 CSS px");
  for (const d of [1, 1.25, 1.5, 2, 3])
    for (const [w, h] of [[300, 700], [1280, 900], [1920, 1080]] as const) {
      const f = fitBoard({ availW: w, availH: h }, BOARD32, null, d);
      assert.ok(f.cssW <= w && f.cssH <= h, `${w}x${h} density ${d} overflows`);
      assert.ok(f.scale >= 1);
    }
});

test("an empty stage (not laid out yet) is answered with a zero board, not a bad scale", () => {
  const f = fitBoard({ availW: 0, availH: 500 }, BOARD32, null);
  assert.equal(f.cssW, 0);
  assert.equal(f.cssH, 0);
  assert.ok(f.scale >= 1);
  assert.ok(Number.isFinite(autoScale({ availW: Number.NaN, availH: 5 }, BOARD32)));
});

test("the tray column stacks under the stage at 720 px and narrower, and sits beside it above", () => {
  assert.equal(STACK_AT, 720);
  assert.equal(stackedAt(720), true);
  assert.equal(stackedAt(721), false);
  assert.equal(stackedAt(320), true);
  assert.equal(stackedAt(1920), false);
  const css = tableStyleCss();
  assert.match(css, /@media \(max-width:720px\)/);
  assert.match(css, /\.lt-arena\[data-screens\] \.lt-tray-col\{display:none\}/, "screens hide the tray column");
});

test("the stage reserves the DM dock and the initiative band as padding, and the board fills what is left", () => {
  const css = tableStyleCss();
  assert.match(css, /\.lt-stage-wrap\{[^}]*padding-bottom:var\(--lto-dock,0px\)/);
  assert.match(css, /\.lt-stage-wrap\{[^}]*padding-top:var\(--lto-top-band,0px\)/);
  assert.match(css, /\.lt-stage-wrap\{[^}]*box-sizing:border-box/);
});

test("the page is selection-proof and gesture-proof where the game is played, but text fields and credits stay copyable", () => {
  const css = tableStyleCss();
  assert.match(css, /\.ltt-root\{[^}]*user-select:none/);
  assert.match(css, /-webkit-touch-callout:none/);
  assert.match(css, /-webkit-tap-highlight-color:transparent/);
  assert.match(css, /\.ltt-root (input|textarea)[^{]*\{[^}]*user-select:text/);
  const app = read("src/app.css");
  assert.match(app, /\.lt-app\s*\{[^}]*touch-action:\s*manipulation/);
  assert.match(app, /overscroll-behavior:\s*none/);
  assert.match(app, /\.lt-app:fullscreen\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/, "full screen fills the screen");
  assert.doesNotMatch(app, /100dvh - 140px/, "the old height cap is gone");
  assert.doesNotMatch(css.replace(/\.ltt-root:not\(\[data-fit\]\) \.lt-viewport\{max-height:min\(66vh,620px\)\}/, ""), /max-height:min\(66vh,620px\)/, "the window's own cap is only for a host that does not size the board");
  assert.match(css, /\.ltt-root\[data-fit\] \.lt-viewport\{[^}]*max-height:none/, "and a page-fit window has no cap");
});

test("the ResizeObserver callbacks defer to an animation frame, and the dice tray cancels its pending frame", () => {
  const dice = read("src/games/livingtable/table/ui/dice.ts");
  const ro = /new ResizeObserver\(\(\) => \{([\s\S]*?)\n    \}\);/.exec(dice)?.[1] ?? "";
  assert.match(ro, /requestAnimationFrame/, "the tray relayouts a frame later, never inside the observer");
  assert.match(dice, /cancelAnimationFrame\(roFrame\)/, "destroy() cancels the pending frame");
  const fit = read("src/games/livingtable/table/stageFit.ts");
  assert.match(fit, /new ResizeObserver\(/);
  assert.match(fit, /requestAnimationFrame/);
  const main = read("src/main.tsx");
  assert.match(main, /ResizeObserver loop completed with undelivered notifications/);
  assert.match(main, /stopImmediatePropagation/);
});

test("no player-facing string in the dice shop or the window talks about buying, builds or the bench", () => {
  const dice = read("src/games/livingtable/table/ui/dice.ts");
  const note = /const SHOP_NOTE = "([^"]*)"/.exec(dice)?.[1] ?? "";
  assert.ok(note.length > 0);
  assert.doesNotMatch(note, /buy|price|credit|cost|\bbench\b|\bbuild\b|\bstub\b|games-db|engine/i);
});

test("the files of this lane use no dash character", () => {
  const bad = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const f of ["src/games/livingtable/table/stageFit.ts", "src/games/livingtable/table/tableStyle.ts", "src/app.css", "src/main.tsx", "scripts/e2e/specs/layout.spec.mjs"]) {
    assert.equal(bad.test(read(f)), false, `${f} has an en or em dash`);
  }
});
