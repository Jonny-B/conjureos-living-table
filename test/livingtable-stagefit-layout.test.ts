/**
 * The stage fit's layout choices (src/games/livingtable/table/stageFit.ts): when the tray column goes under the board, and how far
 * it is scaled up on a big screen. Pure, so no page is needed; the real page is held to it by scripts/e2e/specs/stagefit.spec.mjs.
 * Run: npx -y tsx --test test/livingtable-stagefit-layout.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PORTRAIT_STACK_RATIO, STACK_AT, STACK_QUERY, TABLET_PANEL_ROOM, hudZoomAt, stackCss, stackedAt } from "../src/games/livingtable/table/stageFit";
import { tableStyleCss } from "../src/games/livingtable/table/tableStyle";

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

test("a phone paints the DM's dock band only while the box is up, and the dice tray follows; a tablet keeps it reserved", () => {
  const css = stackCss("ltt-root");
  const R = ".ltt-root[data-fit][data-lt-stack]";
  const phone = css.slice(css.indexOf("@media (max-width:720px){"));
  assert.ok(phone.includes(`${R} .lt-stage-wrap{padding-bottom:0}`), "idle: no band");
  assert.ok(phone.includes(`${R} .lt-stage-wrap:has(.lto-dlg:not([hidden])){padding-bottom:var(--lto-dock,0px)}`), "box up: the band returns");
  assert.match(phone, /\.lt-dice-host\.lt-dice-over\{bottom:8px\}/);
  assert.match(phone, /:has\(\.lto-dlg:not\(\[hidden\]\)\)>\.lt-dice-host\.lt-dice-over\{bottom:calc\(var\(--lto-dock,0px\) \+ 8px\)\}/);
  assert.ok(phone.includes(`${R}{padding:2px}`) && phone.includes(`${R} .lt-game{padding:3px}`), "a phone gives up its gutters");
  assert.equal(css.slice(0, css.indexOf("@media")).includes("padding-bottom:0"), false, "outside the phone block the band stays reserved (tablet)");
  const page = tableStyleCss();
  assert.match(page, /@media \(max-width:720px\)\{[\s\S]*\.lt-stage-wrap\{flex:none;width:100%;padding-bottom:0\}[\s\S]*:has\(\.lto-dlg:not\(\[hidden\]\)\)\{padding-bottom:var\(--lto-dock,0px\)\}/);
  assert.match(page, /@media \(max-height:500px\)\{[\s\S]*padding-bottom:0\}/, "a phone on its side drops the idle band too");
  assert.match(page, /\.lt-stage-wrap\{[^}]*padding-bottom:var\(--lto-dock,0px\)/, "a wide page still reserves it so the board never jumps");
});

test("the tray column's width follows the page zoom, and the tablet keeps a fixed room for its panel", () => {
  assert.match(tableStyleCss(), /clamp\(320px,calc\(16vw \/ var\(--lt-zoom,1\)\),440px\)/);
  // The HUD (206) with the notice strip under it (8 + 30) and the gap above the panel (8): a notice arriving must not make the table taller than its window.
  assert.equal(TABLET_PANEL_ROOM, 206 + 8 + 30 + 8);
  assert.ok(TABLET_PANEL_ROOM <= 300);
});

test("the window part publishes the board's width, measures the page zoom, and no longer scales the column itself", () => {
  const src = readFileSync(new URL("../src/games/livingtable/table/stageFit.ts", import.meta.url), "utf8");
  assert.match(src, /setProperty\("--lto-board-w"/);
  assert.match(src, /getBoundingClientRect\(\)\.width \/ w/);
  assert.doesNotMatch(src, /hudZoomAt\(window/, "hudZoomAt is exported but not called");
  const app = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
  for (const z of ["1.5", "2", "3"]) assert.match(app, new RegExp(`--lt-zoom: ${z};`));
  assert.match(app, /min-width: 2400px\) and \(min-height: 1300px/);
  assert.match(app, /min-width: 3500px\) and \(min-height: 1900px/);
  assert.match(app, /min-width: 5400px\) and \(min-height: 2900px/);
  assert.match(app, /@media \(pointer: fine\) and \(min-width: 721px\) \{\s*\.lt-app-stage \{\s*scrollbar-gutter: stable/);
});
