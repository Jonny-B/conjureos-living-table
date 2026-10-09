/**
 * The stage fit's layout choices (src/games/livingtable/table/stageFit.ts): when the tray column goes under the board, and how far
 * it is scaled up on a big screen. Pure, so no page is needed; the real page is held to it by scripts/e2e/specs/stagefit.spec.mjs.
 * Run: npx -y tsx --test test/livingtable-stagefit-layout.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PORTRAIT_STACK_RATIO, STACK_AT, STACK_QUERY, hudZoomAt, stackCss, stackedAt } from "../src/games/livingtable/table/stageFit";

test("a phone stacks, as before, whatever its height", () => {
  for (const [w, h] of [[320, 640], [390, 844], [720, 400], [700, 300], [720, 1]] as const) assert.equal(stackedAt(w, h), true, `${w}x${h}`);
  assert.equal(stackedAt(STACK_AT), true, "the old one-argument call still answers by width");
  assert.equal(stackedAt(721), false);
});

test("an upright tablet or a tall window stacks (it used to leave a half width board in a tall void), a landscape one does not", () => {
  for (const [w, h] of [[768, 1024], [820, 1180], [1024, 1366], [834, 1194], [1080, 1920]] as const) assert.equal(stackedAt(w, h), true, `${w}x${h} is upright`);
  for (const [w, h] of [[1024, 768], [1180, 820], [1280, 900], [1920, 1080], [3840, 2160], [844, 390], [1000, 1000], [1000, 1150]] as const) assert.equal(stackedAt(w, h), false, `${w}x${h} keeps the column beside the board`);
  assert.equal(stackedAt(1000, 1000 * PORTRAIT_STACK_RATIO), true, "exactly at the ratio stacks");
});

test("the media query the window listens to agrees with stackedAt (width at most 720, or width over height at most 5 to 6)", () => {
  assert.match(STACK_QUERY, /max-width:720px/);
  assert.match(STACK_QUERY, /max-aspect-ratio:5\/6/);
  assert.ok(Math.abs(1 / (5 / 6) - PORTRAIT_STACK_RATIO) < 1e-9, "5/6 is the same ratio as 1.2 tall to 1 wide");
});

test("the tray column is scaled up on a large page and left alone on an ordinary one", () => {
  assert.equal(hudZoomAt(1280, 800), 1);
  assert.equal(hudZoomAt(1920, 1080), 1);
  assert.equal(hudZoomAt(2560, 1440), 1, "1440p keeps the column as is");
  assert.equal(hudZoomAt(2880, 1620), 1.5);
  assert.equal(hudZoomAt(3840, 2160), 2, "4K doubles it");
  assert.equal(hudZoomAt(5760, 3240), 3);
  assert.equal(hudZoomAt(3840, 800), 1, "a very wide but short page is held by its tighter axis");
  assert.equal(hudZoomAt(0, 0), 1);
  assert.equal(hudZoomAt(Number.NaN, 2160), 1);
  let prev = 0;
  for (const w of [320, 800, 1280, 1920, 2560, 2880, 3840, 5000, 7680]) {
    const z = hudZoomAt(w, Math.round((w * 9) / 16));
    assert.ok(z >= prev, `the zoom falls going wider at ${w}`);
    prev = z;
  }
});

test("stackCss carries the narrow page's rules under data-lt-stack, beating the base rules", () => {
  const css = stackCss("ltt-root");
  assert.match(css, /\.ltt-root\[data-fit\]\[data-lt-stack\] \.lt-arena\{[^}]*flex-direction:column/);
  assert.match(css, /\.lt-stage-wrap\{[^}]*flex:none;width:100%/);
  assert.match(css, /\.lt-tray-col\{[^}]*width:100%;overflow:visible/);
  assert.match(css, /\[data-lt-stack\] \.lt-arena\[data-menu-open\] \.lt-tray-col\{display:none\}/);
  const dash = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  assert.equal(dash.test(css), false);
});

test("the window part keys the stacked layout on the attribute and the media query, and cleans up after itself", () => {
  const src = readFileSync(new URL("../src/games/livingtable/table/stageFit.ts", import.meta.url), "utf8");
  assert.match(src, /matchMedia\(STACK_QUERY\)/);
  assert.match(src, /setAttribute\("data-lt-stack", ""\)/);
  assert.match(src, /removeAttribute\("data-lt-stack"\)/);
  assert.match(src, /style\.zoom/);
});
