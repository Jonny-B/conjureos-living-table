// The hero pictures off the board: the hero choice ("Who will you be?"), the character maker's class cards, the character sheet's portrait and the
// inventory's picture draw the KayKit cast figure (the board's own, idling and facing the viewer). The game does not show any of them until
// its art files are in (specs/artgate.spec.mjs), so there is no hand-made doll for the three playable classes. The page marks the picture it
// drew with data-art on its canvas ("cast", or "wait" for the empty moment while the figure's frames are decoded; "doll" is only for a class with
// no KayKit version, and none of the three is one).
//
// The cast is one of the app's asset files. The ConjureOS bridge is stood in for by lib/assets.mjs, which every page has by default and which serves
// the committed asset-files/*.json from the test server.
import { dmScript } from "../lib/fixtures.mjs";
import { WATCH_DOLLS } from "../lib/assets.mjs";

const WITH_SERVER = { art: true };
const T = 20000;
const SIZES = [
  { width: 390, height: 844, touch: true },
  { width: 1280, height: 800, touch: false },
];
const CLASSES = ["fighter", "rogue", "wizard"];
const dollOf = (chassis) => `[data-lto-doll="${chassis}"] canvas`;
const shotName = (screen, size) => `no-old-art-${screen}-${size.width}x${size.height}`;

/** The Rat Cellar's hero choice at a window size. */
async function openHeroChoice(newGame, size, opts = {}) {
  const g = await newGame({
    server: WITH_SERVER,
    script: dmScript(),
    viewport: { width: size.width, height: size.height },
    ...(size.touch ? { hasTouch: true } : {}),
    ...opts,
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
    name: "the hero choice and the maker's class cards draw the KayKit figure for every class, and never the hand-made doll (390 and 1280)",
    async run({ newGame, assert }) {
      for (const size of SIZES) {
        const where = `${size.width}px`;
        const { g, d } = await openHeroChoice(newGame, size, { extraInit: WATCH_DOLLS });
        const page = g.page;
        await allPictures(page, "cast", where);
        const ink = await page.locator("[data-lto-doll] canvas").evaluateAll((cs, fn) => cs.map((c) => new Function(`return (${fn})`)()(c)), inkOf.toString());
        assert.equal(ink.length, 3, `${where}: a picture for each class`);
        for (const [i, m] of ink.entries()) {
          assert.ok(m.n > 600, `${where}: the ${CLASSES[i]} figure is drawn (${m.n} painted pixels)`);
          assert.ok(m.x0 > 0 && m.y0 > 0 && m.x1 < m.w - 1 && m.y1 < m.h - 1, `${where}: the ${CLASSES[i]} figure is whole inside its canvas ${JSON.stringify(m)}`);
        }
        await page.waitForTimeout(1200); // the screen has finished fading in
        await g.screenshot(shotName("hero", size));
        // The slide for each class stands in a square box.
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
        await g.screenshot(shotName("maker", size));
        assert.deepEqual(await page.evaluate(() => window.__dolls), [], `${where}: the doll was never on the page, not even for a moment`);
        await g.close();
      }
    },
  },

  {
    name: "with the art's real motion the hero choice's figure idles (its pixels change over a second or two), and with the default art it holds still",
    async run({ newGame, assert }) {
      const moving = await openHeroChoice(newGame, SIZES[0], { art: { motion: true } });
      await allPictures(moving.g.page, "cast", "with motion");
      const first = await moving.g.page.locator(dollOf("fighter")).evaluate((c) => c.toDataURL());
      await moving.g.page.waitForFunction(([sel, was]) => document.querySelector(sel).toDataURL() !== was, [dollOf("fighter"), first], { timeout: 4000 });
      await moving.g.close();
      const still = await openHeroChoice(newGame, SIZES[0]);
      await allPictures(still.g.page, "cast", "default art");
      const a = await still.g.page.locator(dollOf("fighter")).evaluate((c) => c.toDataURL());
      await still.g.page.waitForTimeout(2200);
      assert.equal(await still.g.page.locator(dollOf("fighter")).evaluate((c) => c.toDataURL()), a, "the default art's idle loop is held on its first frame");
      await still.g.close();
    },
  },

  {
    name: "in a game, the character sheet's portrait and the inventory's picture draw the cast figure for each class, and no doll is ever on the page",
    async run({ newGame, assert }) {
      for (const chassis of CLASSES) {
        const { g, d } = await openHeroChoice(newGame, SIZES[1], { extraInit: WATCH_DOLLS });
        const page = g.page;
        await d.playAs(chassis, "Mira");
        await d.dismissDialogue();
        const art = (sel) => page.waitForFunction(([s, w]) => document.querySelector(s)?.getAttribute("data-art") === w, [sel, "cast"], { timeout: T });
        await d.openMenu("character");
        await art("[data-game-menu] .lts-portrait canvas");
        const portrait = await page.locator("[data-game-menu] .lts-portrait").boundingBox();
        assert.ok(portrait && portrait.width >= 60, `${chassis}: the sheet's portrait box is there (${JSON.stringify(portrait)})`);
        await d.openMenu("inventory");
        await art("[data-game-menu] canvas[data-inv-doll]");
        const doll = await page.locator("[data-game-menu] canvas[data-inv-doll]").boundingBox();
        assert.ok(doll && doll.width >= 100 && Math.abs(doll.width - doll.height) < 1, `${chassis}: the inventory's picture is a square box (${JSON.stringify(doll)})`);
        const inked = await page.locator("[data-game-menu] canvas[data-inv-doll]").evaluate((c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
        assert.equal(inked, true, `${chassis}: the inventory's picture is drawn`);
        assert.deepEqual(await page.evaluate(() => window.__dolls), [], `${chassis}: no doll on the hero choice, the maker, the sheet or the inventory`);
        await g.close();
      }
    },
  },
];
