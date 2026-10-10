// The hero pictures off the board: the hero choice ("Who will you be?") and the character maker's class cards draw the KayKit cast figure
// (the board's own, idling and facing the viewer) when the cast is loaded, and the hand-made pixel art when it is not. The page marks the
// picture it drew with data-art on its canvas ("cast" or "doll").
//
// The cast is one of the app's asset files. The ConjureOS bridge is stood in for by lib/assets.mjs, which serves the committed
// asset-files/*.json from the test server; without it the page runs as it does outside ConjureOS (the doll).
import { dmScript } from "../lib/fixtures.mjs";
import { assetBridge } from "../lib/assets.mjs";

const WITH_SERVER = { art: true };
const T = 20000;
const SIZES = [
  { width: 390, height: 844, touch: true },
  { width: 1280, height: 800, touch: false },
];
const CLASSES = ["fighter", "rogue", "wizard"];
const dollOf = (chassis) => `[data-lto-doll="${chassis}"] canvas`;
const shotName = (screen, size, art) => `art-everywhere-${screen}-${size.width}x${size.height}-${art}`;

/** The Rat Cellar's hero choice at a window size, with or without the cast bridge. */
async function openHeroChoice(newGame, size, extraInit) {
  const g = await newGame({
    server: WITH_SERVER,
    script: dmScript(),
    viewport: { width: size.width, height: size.height },
    ...(size.touch ? { hasTouch: true } : {}),
    ...(extraInit ? { extraInit } : {}),
  });
  const d = g.driver;
  await d.ready();
  await d.toAdventureList();
  await g.page.locator('[data-lto-adventure="rat-cellar"]').click();
  await g.page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: T });
  return { g, d };
}

/** Wait until every hero slide's picture says it is `art`. */
async function allPictures(page, art, where) {
  await page.waitForFunction(
    ([sels, want]) => sels.every((s) => document.querySelector(s)?.getAttribute("data-art") === want),
    [CLASSES.map(dollOf), art],
    { timeout: T },
  ).catch(async (e) => {
    const seen = await page.locator("[data-lto-doll] canvas").evaluateAll((cs) => cs.map((c) => c.getAttribute("data-art")));
    throw new Error(`${where}: the pictures never became ${art} (they are ${JSON.stringify(seen)}): ${e.message}`);
  });
}

/** Painted pixels in a canvas, and the box they stand in (to see that a figure is drawn whole, inside the canvas, away from its edges). */
function inkOf(canvas) {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let n = 0;
  let x0 = canvas.width;
  let y0 = canvas.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { n, x0, y0, x1, y1, w: canvas.width, h: canvas.height };
}

/** The character maker on its Class step, started from the hero choice (the name typed, since the maker asks for it first). */
async function openClassStep(g, d) {
  await d.playAs("fighter", null);
  await g.page.locator('[data-lts-field="Name"]').fill("Mira", { timeout: T });
  await g.page.locator('[data-lts-step="class"]').click({ timeout: T });
  await g.page.locator("[data-lts-class-card]").first().waitFor({ timeout: T });
}

const cardCanvas = (id) => `[data-lts-class-card="${id}"] canvas`;
const CARDS = ["knight", "shadow", "fireball-person"];

export const specs = [
  {
    name: "with the cast loaded, the hero choice and the maker's class cards draw the KayKit figure (390 and 1280)",
    async run({ newGame, assert }) {
      for (const size of SIZES) {
        const where = `${size.width}px`;
        const { g, d } = await openHeroChoice(newGame, size, assetBridge());
        const page = g.page;
        await allPictures(page, "cast", where);
        const ink = await page.locator("[data-lto-doll] canvas").evaluateAll((cs, fn) => cs.map((c) => new Function(`return (${fn})`)()(c)), inkOf.toString());
        assert.equal(ink.length, 3, `${where}: a picture for each class`);
        for (const [i, m] of ink.entries()) {
          assert.ok(m.n > 600, `${where}: the ${CLASSES[i]} figure is drawn (${m.n} painted pixels)`);
          assert.ok(m.x0 > 0 && m.y0 > 0 && m.x1 < m.w - 1 && m.y1 < m.h - 1, `${where}: the ${CLASSES[i]} figure is whole inside its canvas ${JSON.stringify(m)}`);
        }
        await page.waitForTimeout(1200); // the screen has finished fading in
        await g.screenshot(shotName("hero", size, "cast"));
        // The slide for each class stands in the same box the doll did.
        for (const c of CLASSES) {
          const box = await page.locator(`[data-lto-doll="${c}"]`).boundingBox();
          assert.ok(box && box.width >= 70 && Math.abs(box.width - box.height) < 1, `${where}: the ${c} picture box is a square (${JSON.stringify(box)})`);
        }
        await openClassStep(g, d);
        await page.waitForFunction((sels) => sels.every((s) => document.querySelector(s)?.getAttribute("data-art") === "cast"), CARDS.map(cardCanvas), { timeout: T });
        const cards = await page.locator("[data-lts-class-card] canvas").evaluateAll((cs, fn) => cs.map((c) => new Function(`return (${fn})`)()(c)), inkOf.toString());
        assert.equal(cards.length, 3, `${where}: a picture on each class card`);
        for (const m of cards) assert.ok(m.n > 150, `${where}: a class card figure is drawn (${m.n} painted pixels)`);
        await page.waitForTimeout(1200);
        await g.screenshot(shotName("maker", size, "cast"));
        await g.close();
      }
    },
  },

  {
    name: "without the cast, the hero choice and the maker's class cards draw the hand-made art (390 and 1280)",
    async run({ newGame, assert }) {
      for (const size of SIZES) {
        const where = `${size.width}px`;
        // Once with no bridge at all (outside ConjureOS), once with a bridge that has no such files (a failed load).
        for (const [label, bridge] of [["no bridge", undefined], ["no files", assetBridge({ names: [] })]]) {
          const { g, d } = await openHeroChoice(newGame, size, bridge);
          const page = g.page;
          await allPictures(page, "doll", `${where}, ${label}`);
          const ink = await page.locator("[data-lto-doll] canvas").evaluateAll((cs, fn) => cs.map((c) => new Function(`return (${fn})`)()(c)), inkOf.toString());
          for (const m of ink) assert.ok(m.n > 500, `${where}, ${label}: the doll is drawn (${m.n} painted pixels)`);
          // The cast would have landed by now; give it the time, then see the doll is still there.
          await page.waitForTimeout(1500);
          await allPictures(page, "doll", `${where}, ${label}, later`);
          if (label === "no bridge") await g.screenshot(shotName("hero", size, "doll"));
          await openClassStep(g, d);
          const arts = await page.locator("[data-lts-class-card] canvas").evaluateAll((cs) => cs.map((c) => c.getAttribute("data-art")));
          assert.deepEqual(arts, ["doll", "doll", "doll"], `${where}, ${label}: the class cards draw the hand-made art`);
          if (label === "no bridge") {
            await page.waitForTimeout(1200); // the screen has finished fading in
            await g.screenshot(shotName("maker", size, "doll"));
          }
          await g.close();
        }
      }
    },
  },

  {
    name: "a cast that lands while the hero choice is open switches each picture in place: same canvas, same box",
    async run({ newGame, assert }) {
      const size = SIZES[0];
      const { g, d } = await openHeroChoice(newGame, size, assetBridge({ hold: true }));
      const page = g.page;
      await allPictures(page, "doll", "before the cast");
      // Mark each canvas and note its box, so "in place" is checked against the very same elements.
      const before = await page.evaluate((classes) => {
        const out = {};
        for (const c of classes) {
          const canvas = document.querySelector(`[data-lto-doll="${c}"] canvas`);
          canvas.__mark = c;
          const r = document.querySelector(`[data-lto-doll="${c}"]`).getBoundingClientRect();
          const cr = canvas.getBoundingClientRect();
          out[c] = { box: [r.x, r.y, r.width, r.height], canvas: [cr.x, cr.y, cr.width, cr.height] };
        }
        return out;
      }, CLASSES);
      await page.evaluate(() => window.__releaseAssets());
      await allPictures(page, "cast", "after the cast landed");
      const after = await page.evaluate((classes) => {
        const out = {};
        for (const c of classes) {
          const canvas = document.querySelector(`[data-lto-doll="${c}"] canvas`);
          const r = document.querySelector(`[data-lto-doll="${c}"]`).getBoundingClientRect();
          const cr = canvas.getBoundingClientRect();
          out[c] = { mark: canvas.__mark, box: [r.x, r.y, r.width, r.height], canvas: [cr.x, cr.y, cr.width, cr.height] };
        }
        return out;
      }, CLASSES);
      for (const c of CLASSES) {
        assert.equal(after[c].mark, c, `${c}: the same canvas element is showing the cast`);
        assert.deepEqual(after[c].box, before[c].box, `${c}: the picture box did not move or change size`);
        assert.deepEqual(after[c].canvas, before[c].canvas, `${c}: the canvas did not move or change size`);
      }
      // The figure idles: its pixels change over a second or two (a frame of its loop turns over).
      const first = await page.locator(dollOf("fighter")).evaluate((c) => c.toDataURL());
      await page.waitForFunction(([sel, was]) => document.querySelector(sel).toDataURL() !== was, [dollOf("fighter"), first], { timeout: 4000 });
      void d;
    },
  },

  {
    name: "in a game, the character sheet's portrait and the inventory's doll draw the cast figure when it is loaded and the hand-made art when it is not",
    async run({ newGame, assert }) {
      for (const [label, bridge, want] of [["with the cast", assetBridge(), "cast"], ["without it", undefined, "doll"]]) {
        const { g, d } = await openHeroChoice(newGame, SIZES[1], bridge);
        const page = g.page;
        await d.playAs("fighter", "Mira");
        await d.dismissDialogue();
        const art = (sel) => page.waitForFunction(([s, w]) => document.querySelector(s)?.getAttribute("data-art") === w, [sel, want], { timeout: T });
        await d.openMenu("character");
        await art("[data-game-menu] .lts-portrait canvas");
        const portrait = await page.locator("[data-game-menu] .lts-portrait").boundingBox();
        assert.ok(portrait && portrait.width >= 60, `${label}: the sheet's portrait box is there (${JSON.stringify(portrait)})`);
        await d.openMenu("inventory");
        await art("[data-game-menu] canvas[data-inv-doll]");
        const doll = await page.locator("[data-game-menu] canvas[data-inv-doll]").boundingBox();
        assert.ok(doll && doll.width >= 100 && Math.abs(doll.width - doll.height) < 1, `${label}: the doll is a square box (${JSON.stringify(doll)})`);
        const inked = await page.locator("[data-game-menu] canvas[data-inv-doll]").evaluate((c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
        assert.equal(inked, true, `${label}: the doll is drawn`);
        await g.close();
      }
    },
  },

  {
    name: "a class card switches to the cast in place when it lands under the open maker",
    async run({ newGame, assert }) {
      const size = SIZES[1];
      const { g, d } = await openHeroChoice(newGame, size, assetBridge({ hold: true }));
      const page = g.page;
      await openClassStep(g, d);
      await page.waitForFunction((sels) => sels.every((s) => document.querySelector(s)?.getAttribute("data-art") === "doll"), CARDS.map(cardCanvas), { timeout: T });
      const boxes = await page.evaluate((sels) => sels.map((s) => {
        const c = document.querySelector(s);
        c.__mark = "kept";
        const r = c.parentElement.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }), CARDS.map(cardCanvas));
      await page.evaluate(() => window.__releaseAssets());
      await page.waitForFunction((sels) => sels.every((s) => document.querySelector(s)?.getAttribute("data-art") === "cast"), CARDS.map(cardCanvas), { timeout: T });
      const after = await page.evaluate((sels) => sels.map((s) => {
        const c = document.querySelector(s);
        const r = c.parentElement.getBoundingClientRect();
        return { mark: c.__mark, box: [r.x, r.y, r.width, r.height] };
      }), CARDS.map(cardCanvas));
      for (const [i, a] of after.entries()) {
        assert.equal(a.mark, "kept", `${CARDS[i]}: the same canvas element is showing the cast`);
        assert.deepEqual(a.box, boxes[i], `${CARDS[i]}: the card's picture box did not move or change size`);
      }
    },
  },
];
