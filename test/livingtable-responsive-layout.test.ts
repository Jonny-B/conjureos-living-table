/**
 * Tests for the responsive pass (the HUD, the menu, the overlay and the front screens at every window size): the pure helpers behind the
 * condensed status box, the label room of a hit point bar, the menu's tab scale, the turn strip's chips, the dialogue box's rows, the
 * context menu's placement around the hero, the small texts' scale, the maker's step caption, and a few source checks that the rules the
 * brief asks for are in the style sheets. The drawing itself is covered by the walk (scripts/e2e/walk.mjs).
 *
 * Run: npx -y tsx --test test/livingtable-responsive-layout.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BAR_METER_MIN_PX,
  CONDENSED_MAX_PX,
  STACKED_MAX_PX,
  barLabelWraps,
  cutToWidth,
  hudLayout,
  noticesFloat,
  shortTurnTitle,
  stackedHud,
} from "../src/games/livingtable/table/ui/hudHelpers";
import { MENU_TABS, menuTabScale, tabLabelRoom } from "../src/games/livingtable/table/ui/gameMenu";
import { chipLabel, chipMax } from "../src/games/livingtable/table/ui/initiative";
import { DIALOGUE_TALL_PX, dialogueLines } from "../src/games/livingtable/table/ui/dialogueQueue";
import { MENU_MARGIN, menuPlacement, rectsMeet } from "../src/games/livingtable/table/ui/menuHelpers";
import { textScaleFor } from "../src/games/livingtable/table/ui/overlayMath";
import { promptScale } from "../src/games/livingtable/table/ui/dice";
import { askHint, askPlaceholder } from "../src/games/livingtable/table/flows/menuFlow";
import { CREATION_STEPS, stepCaption } from "../src/games/livingtable/table/ui/sheet";
import { textWidth } from "../src/games/livingtable/table/ui/pixelFont";

const read = (p: string): string => readFileSync(new URL("../" + p, import.meta.url), "utf8");

// ---- the HUD: layout, short title, bar labels ------------------------------------------------------------------------------------------

test("hudLayout: condensed under 520 when it fills its row, stacked from 520 to 760, wide beside the board or without the ask", () => {
  assert.equal(hudLayout(320, 320, true), "condensed");
  assert.equal(hudLayout(CONDENSED_MAX_PX - 1, CONDENSED_MAX_PX - 1, true), "condensed");
  assert.equal(hudLayout(CONDENSED_MAX_PX, CONDENSED_MAX_PX, true), "stacked");
  assert.equal(hudLayout(740, 740, true), "stacked");
  assert.equal(hudLayout(STACKED_MAX_PX + 1, STACKED_MAX_PX + 1, true), "wide");
  // A 320 px column beside the board has the room of a column to itself; so does a 700 px one inside a wider row.
  assert.equal(hudLayout(320, 1280, true), "wide");
  assert.equal(hudLayout(700, 1000, true), "wide");
  assert.equal(hudLayout(320, 320, false), "wide", "no ask for the small-screen look, no condensed layout");
  assert.equal(hudLayout(0, 0, true), "wide", "not laid out yet");
  assert.equal(stackedHud(519, 519), false);
});

test("hudLayout: a phone on its side (a short window) condenses the column beside the board; a tall window does not", () => {
  assert.equal(hudLayout(320, 844, true, true), "condensed");
  assert.equal(hudLayout(320, 844, true, false), "wide");
  assert.equal(hudLayout(320, 844, false, true), "wide", "no ask, no condensed layout");
  assert.equal(hudLayout(0, 0, true, true), "wide", "not laid out yet");
  assert.equal(hudLayout(CONDENSED_MAX_PX, 844, true, true), "wide", "520 and wider keeps its lines");
});

test("noticesFloat: notices float over the status box on a phone only", () => {
  assert.equal(noticesFloat("condensed"), true);
  assert.equal(noticesFloat("stacked"), false);
  assert.equal(noticesFloat("wide"), false);
});

test("shortTurnTitle: one short line, and it fits 320 px in the pixel font", () => {
  assert.equal(shortTurnTitle(1, "rat 2"), "Rd 1: rat 2");
  assert.equal(shortTurnTitle(12, "you"), "Your turn (rd 12)");
  assert.equal(shortTurnTitle(3, null), "Rd 3: something");
  // The room inside the thin frame and padding at 320 (a 308 px panel less 26): the long names stay on one line at font scale 2.
  for (const t of [shortTurnTitle(12, "you"), shortTurnTitle(1, "giant rat 3"), shortTurnTitle(10, "something")]) {
    assert.ok(textWidth(t, "bold") * 2 <= 308 - 26, t + " is " + textWidth(t, "bold") * 2 + " px");
  }
});

test("barLabelWraps: a label that squeezes its meter takes a row to itself, so 'Giant Rats 2 left' is never cut", () => {
  const inner = 282;
  const label = textWidth("Giant Rats 2 left") * 2;
  const nums = textWidth("14/14", "bold") * 2;
  assert.equal(barLabelWraps(label, nums, inner), true, "176 + 68 + 24 + 16 does not fit 282");
  assert.equal(barLabelWraps(textWidth("Mira") * 2, textWidth("12/12", "bold") * 2, inner), false);
  assert.equal(barLabelWraps(100, 60, 100 + 60 + BAR_METER_MIN_PX + 16 + 6), false, "fits exactly with the slack");
  assert.equal(barLabelWraps(100, 60, 100 + 60 + BAR_METER_MIN_PX + 16), true, "a hair short of the slack wraps on purpose");
});

test("cutToWidth: whole when it fits; cut with .. only when wider than the whole row (a 60 character name)", () => {
  assert.equal(cutToWidth("Giant Rats 2 left", 141), "Giant Rats 2 left");
  const long = "Sir Reginald Fitzwilliam-Montgomery the Third of Westmarch";
  const cut = cutToWidth(long, 100);
  assert.ok(cut.endsWith("..") && textWidth(cut) <= 100 && cut.length < long.length);
});

// ---- the menu: one tab scale ----------------------------------------------------------------------------------------------------------

test("menuTabScale: one scale for the whole row, the smallest any label needs", () => {
  const widest = Math.max(...MENU_TABS.map((t) => textWidth(t.label, "bold")));
  assert.ok(widest * 2 <= tabLabelRoom(170), "Character fits a 170 px tab at scale 2");
  assert.equal(menuTabScale(170), 2);
  assert.equal(menuTabScale(1000), 2);
  assert.equal(menuTabScale(100), 1, "Character at scale 2 does not fit a 100 px tab, so Log and Saves do not get it either");
  // The short labels fit at 2 on their own; the row still takes the one the longest needs.
  assert.equal(menuTabScale(120, 1, ["Log", "Saves"]), 2);
  assert.equal(menuTabScale(120, 1, ["Log", "Saves", "Character"]), 1);
});

// ---- the turn strip ---------------------------------------------------------------------------------------------------------------------

test("chipLabel: whole when it fits; a trailing number is kept so two of a kind stay apart", () => {
  assert.equal(chipLabel("Mira", 6), "Mira");
  assert.equal(chipLabel("Rat 1", 6), "Rat 1");
  assert.ok(chipLabel("Giant Rat 2", 6).length <= 6 && chipLabel("Giant Rat 2", 6).endsWith(" 2"));
  assert.notEqual(chipLabel("Giant Rat 1", 6), chipLabel("Giant Rat 2", 6));
  assert.equal(chipLabel("Goblin Archer", 6), "Gobli.");
  assert.ok(chipLabel("Sir Reginald Fitzwilliam", 10).length <= 10);
});

test("chipMax: a phone's chips are short (6 in pixel), the rest keep their length", () => {
  assert.equal(chipMax("s", true), 6);
  assert.equal(chipMax("m", true), 10);
  assert.equal(chipMax("l", true), 10);
  assert.ok(chipMax("s", false) < chipMax("l", false));
});

// ---- the dialogue box --------------------------------------------------------------------------------------------------------------------

test("dialogueLines: 3 on a phone; 3 where the overlay is under 640 px tall; 4 elsewhere", () => {
  assert.equal(dialogueLines("s"), 3);
  assert.equal(dialogueLines("s", 2000), 3);
  assert.equal(dialogueLines("m", DIALOGUE_TALL_PX - 1), 3);
  assert.equal(dialogueLines("l", DIALOGUE_TALL_PX - 1), 3);
  assert.equal(dialogueLines("m", DIALOGUE_TALL_PX), 4);
  assert.equal(dialogueLines("l", 900), 4);
  assert.equal(dialogueLines("m"), 4, "height not known");
});

// ---- the context menu --------------------------------------------------------------------------------------------------------------------

const MENU = { width: 272, height: 200 };
const BOARD = { width: 800, height: 600 };

test("menuPlacement with avoid: the usual corner when it clears the rectangle; else the first flip that does", () => {
  const far = { x: 600, y: 500, w: 40, h: 40 };
  assert.deepEqual(menuPlacement({ x: 100, y: 80 }, MENU, BOARD, MENU_MARGIN, far), menuPlacement({ x: 100, y: 80 }, MENU, BOARD));
  // The hero is right of and below the click: the usual corner (right and down) would cover it; above is tried first.
  const hero = { x: 450, y: 320, w: 40, h: 40 };
  const p = menuPlacement({ x: 400, y: 300 }, MENU, BOARD, MENU_MARGIN, hero);
  assert.equal(rectsMeet({ x: p.left, y: p.top, w: MENU.width, h: MENU.height }, hero), false);
  assert.equal(p.flipY, true, "above the click is the first thing tried");
  assert.equal(p.flipX, false);
});

test("menuPlacement with avoid: every result stays inside the board", () => {
  // Above and to the right is covered too, so it opens to the left of the click.
  const hero = { x: 450, y: 320, w: 40, h: 40 };
  const blockTop = { x: 400, y: 100, w: 272, h: 200 };
  const p = menuPlacement({ x: 400, y: 300 }, MENU, BOARD, MENU_MARGIN, hero);
  assert.equal(rectsMeet({ x: p.left, y: p.top, w: MENU.width, h: MENU.height }, hero), false);
  assert.equal(blockTop.w, 272);
  for (const at of [{ x: 5, y: 5 }, { x: 400, y: 300 }, { x: 790, y: 590 }]) {
    for (const hr of [{ x: at.x + 10, y: at.y + 10, w: 40, h: 40 }, { x: at.x - 50, y: at.y - 50, w: 40, h: 40 }]) {
      const q = menuPlacement(at, MENU, BOARD, MENU_MARGIN, hr);
      assert.ok(q.left >= MENU_MARGIN && q.top >= MENU_MARGIN && q.left + MENU.width <= BOARD.width - MENU_MARGIN && q.top + MENU.height <= BOARD.height - MENU_MARGIN);
    }
  }
});

test("menuPlacement with avoid: when nothing clears it, the old placement is used", () => {
  // The rectangle is the whole board: no flip can miss it.
  const all = { x: 0, y: 0, w: 800, h: 600 };
  assert.deepEqual(menuPlacement({ x: 100, y: 80 }, MENU, BOARD, MENU_MARGIN, all), menuPlacement({ x: 100, y: 80 }, MENU, BOARD));
  // Without the rectangle nothing changes.
  assert.deepEqual(menuPlacement({ x: 600, y: 380 }, MENU, BOARD, MENU_MARGIN, undefined), menuPlacement({ x: 600, y: 380 }, MENU, BOARD));
});

test("rectsMeet: overlap, touching edges and containment", () => {
  assert.equal(rectsMeet({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(rectsMeet({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
  assert.equal(rectsMeet({ x: 0, y: 0, w: 100, h: 100 }, { x: 40, y: 40, w: 5, h: 5 }), true);
});

test("askHint: a fixed short phrase of at most 18 characters; askPlaceholder keeps the full words for the screen reader", () => {
  const goblin = { kind: "creature", name: "the goblin", distanceTiles: 1, inSight: true } as const;
  const floor = { kind: "floor", name: "the floor wood", distanceTiles: 3, inSight: true } as const;
  const prop = { kind: "prop", name: "the barrel with the long name", distanceTiles: 3, inSight: true } as const;
  assert.equal(askHint(goblin), "Say something");
  assert.equal(askHint(floor), "Do something else");
  assert.equal(askHint(prop), "Do something else");
  for (const t of [goblin, floor, prop]) assert.ok(askHint(t).length <= 18);
  assert.equal(askPlaceholder(prop), "Do something with the barrel with the long name");
});

// ---- small texts -------------------------------------------------------------------------------------------------------------------------

test("textScaleFor: 2 when the text fits in two lines at that size, else 1", () => {
  assert.equal(textScaleFor("Survival check", 230), 2);
  assert.equal(textScaleFor("Survival check", 40), 1, "too narrow even for two lines");
  assert.equal(textScaleFor("", 100), 2);
  assert.equal(textScaleFor("one two three four five six seven eight nine ten", 200, 1, 2), 1);
  assert.equal(textScaleFor("one two three four five six seven eight nine ten", 200, 1, 6), 2);
});

test("promptScale: the dice tray's waiting prompt is drawn at 2 only when it fits one line and the band", () => {
  assert.equal(promptScale(100, 10, 220, 22), 2);
  assert.equal(promptScale(120, 10, 220, 22), 1, "twice the width passes the felt");
  assert.equal(promptScale(100, 12, 220, 22), 1, "twice the height passes the band");
});

// ---- the maker ---------------------------------------------------------------------------------------------------------------------------

test("stepCaption: 'Step 2 of 7: Class', clamped to the steps there are", () => {
  assert.equal(stepCaption(1), "Step 2 of 7: Class");
  assert.equal(stepCaption(0), "Step 1 of 7: Name");
  assert.equal(stepCaption(6), "Step 7 of 7: Review");
  assert.equal(stepCaption(-3), "Step 1 of 7: Name");
  assert.equal(stepCaption(99), "Step " + CREATION_STEPS.length + " of " + CREATION_STEPS.length + ": Review");
});

// ---- the style sheets carry the rules ----------------------------------------------------------------------------------------------------

test("the style sheets: one condensed look, scroll shadows, a sticky pager and footer, the board-wide DM box, and nothing leaks", () => {
  const hud = read("src/games/livingtable/table/ui/hudStyle.ts");
  assert.match(hud, /\.lto-hud-panel\[data-condensed="true"\]\{padding:3px 8px;gap:2px\}/);
  assert.match(hud, /data-layout="stacked"\]\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(hud, /data-layout="condensed"\]>\.lto-hud-notices\{position:absolute;top:0/);
  assert.match(hud, /\.lto-gm-body\{[^}]*no-repeat local/, "the menu body shows scroll shadows");
  assert.match(hud, /\.lto-hud-pack-list\{background:[^}]*local/, "the pack list shows scroll shadows");
  const overlay = read("src/games/livingtable/table/ui/overlayStyle.ts");
  assert.match(overlay, /\.lto-top\{[^}]*width:min\(calc\(100% - 16px\),max\(var\(--lto-board-w,100%\),440px\)\)/);
  assert.match(overlay, /\.lto-bottom\{[^}]*width:min\(calc\(100% - 16px\),var\(--lto-board-w,100%\)\)/);
  assert.match(overlay, /\.lto-px \.lto-init\{[^}]*flex-wrap:wrap/);
  assert.match(overlay, /\.lto-sb \.lto-init\{[^}]*flex-wrap:wrap/);
  assert.doesNotMatch(overlay, /\.lto-init\{[^}]*overflow-x:auto/, "the strip never scrolls sideways");
  assert.match(overlay, /\[data-size="s"\] \.lto-dlg-cancel\{min-height:44px\}/);
  const hero = read("src/games/livingtable/table/ui/heroEnding.ts");
  assert.match(hero, /\.lto-hero-nav\{position:sticky;bottom:calc\(-1\*var\(--scr-pb,18px\)\);z-index:2/);
  const screens = read("src/games/livingtable/table/ui/screenStyle.ts");
  const css = screens.slice(screens.indexOf("SCREEN_CSS = `"), screens.indexOf("`;", screens.indexOf("SCREEN_CSS = `")));
  for (const line of css.split("\n")) {
    const sel = /^([^{@\s/*][^{]*)\{/.exec(line)?.[1];
    if (sel) assert.match(sel, /\.lto-/, "a screen rule outside .lto-: " + sel);
  }
  assert.match(screens, /min-width:900px/);
  assert.match(screens, /minmax\(360px,1fr\)/);
  const sheet = read("src/games/livingtable/table/ui/sheet.ts");
  assert.match(sheet, /repeat\(7,minmax\(44px,1fr\)\)/);
  assert.match(sheet, /padding-inline:max\(10px,calc\(\(100% - 1100px\)\/2\)\)/);
  const menu = read("src/games/livingtable/table/ui/mainMenu.ts");
  assert.match(menu, /\.ltm-foot\{position:sticky;bottom:/);
});
