// The game does not show anything until its art is in, and never draws the old hand-made picture of a thing that has a KayKit one.
//
// The art is two asset files (the animated figures and the board art) that ConjureOS hands over through window.__conjureos.assets; the harness
// stands that bridge in for every page (lib/assets.mjs), and `newGame({ art })` can withhold it ("none"), hold it ("hold"), make it fail
// ("fail") or slow it down ({ delayMs }). What these specs hold the game to:
//
//   the wait    after the splash and before the main menu, the splash says "Getting the art ready"; no menu, hero choice, maker or board is
//               on the page until both files are in
//   the retry   a file that cannot be had shows one plain sentence (never a status code or an error message) and a Retry button; Retry loads
//               again and goes on to the main menu; an app too old to hand over files says to update it and has no Retry button
//   the fit     the waiting and the failure screens fit every size from 320 px to 4K
//   no doll     no hand-made doll is ever on the page for the three playable classes, not even when the art is slow
//   the board   a converted tile or prop is drawn from the KayKit art; what has no KayKit version (wood floor, stool, goblin) keeps its hand-made one
import { WATCH_DOLLS } from "../lib/assets.mjs";
import { HASH_FN, hashBytes, hashed, loadArtPixels, over } from "../lib/artpixels.mjs";
import { fitChecks, fitProblems } from "../lib/tour.mjs";

const WITH_SERVER = { art: true };
const T = 20000;
const SIZES = [
  { width: 390, height: 844, touch: true },
  { width: 1280, height: 800, touch: false },
];
const shotName = (screen, size) => `no-old-art-${screen}-${size.width}x${size.height}`;
const viewportOf = (s) => ({ viewport: { width: s.width, height: s.height }, ...(s.touch ? { hasTouch: true } : {}) });

const SPLASH = "[data-splash]";
const MAIN_MENU = '[data-ltm-menu="main"]';
/** Words that would claim the old art is on show. */
const OLD_ART_WORDS = /table shows|hand-drawn|hand-made|still figures|KayKit/i;
/** What a player must never read on the failure screen: a status code, a parenthesised raw message, a reason code, an exception's words. */
const RAW_WORDS = /\bHTTP\b|\b[1-5]\d\d\b|[()]|_|kaboom|Unexpected token|CSP/i;

/** Nothing of the game itself is on the page: no window, no menu, no hero choice, no maker, no board. */
async function assertNoGame(page, assert, where) {
  assert.equal(await page.locator(MAIN_MENU).count(), 0, `${where}: no main menu`);
  assert.equal(await page.locator("[data-lto-quick], [data-lto-adventure], [data-lts]").count(), 0, `${where}: no start screen, hero choice or maker`);
  assert.equal(await page.locator("canvas.ltt-canvas").count(), 0, `${where}: no board`);
  assert.equal(await page.locator("[data-lto-hud]").count(), 0, `${where}: no window at all`);
}

export const specs = [
  {
    name: "the art arrives, then the main menu (both files are asked for, and the splash is gone)",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER });
      const page = g.page;
      await page.locator(MAIN_MENU).waitFor({ timeout: T });
      await page.locator(SPLASH).waitFor({ state: "detached", timeout: T });
      const loads = await page.evaluate(() => window.__assetLoads);
      assert.deepEqual([...new Set(loads)].sort(), ["living-table-cast.json", "living-table-library.json"], "the game asked the bridge for both art files");
      assert.equal(await page.locator("[data-art-retry]").count(), 0, "no Retry screen when the art came");
      assert.equal(await page.getByText("Getting the art ready").count(), 0, "nothing is left saying the art is coming");
      const size = await page.evaluate(() => document.querySelector("canvas.ltt-canvas")?.width ?? 0);
      assert.ok(size > 0 && size % (20 * 32) === 0, `the board is drawn from the 32 px KayKit art (canvas ${size} px wide)`);
    },
  },

  {
    name: "art held, then released: the splash says it is getting the art ready, nothing else is on the page, and the main menu comes when it lands (390 and 1280)",
    async run({ newGame, assert }) {
      for (const size of SIZES) {
        const where = `${size.width}px`;
        const g = await newGame({ server: WITH_SERVER, art: "hold", ...viewportOf(size) });
        const page = g.page;
        const waiting = page.locator(`${SPLASH}[data-step="art"]`);
        await waiting.waitFor({ timeout: T });
        assert.match(await waiting.innerText(), /Getting the art ready/, `${where}: the splash says what it waits for`);
        await assertNoGame(page, assert, where);
        assert.equal(await page.locator(".lt-app-menu").isDisabled(), true, `${where}: the page bar's Menu button waits too`);
        await page.waitForTimeout(1200);
        assert.equal(await waiting.count(), 1, `${where}: still waiting after a while: the game does not go on without its art`);
        await assertNoGame(page, assert, `${where} later`);
        assert.equal(await page.locator("[data-art-retry]").count(), 0, `${where}: waiting is not failing`);
        await g.screenshot(shotName("waiting", size));
        await page.evaluate(() => window.__releaseAssets());
        await page.locator(MAIN_MENU).waitFor({ timeout: T });
        await page.locator(SPLASH).waitFor({ state: "detached", timeout: T });
        assert.equal(await page.locator(".lt-app-menu").isDisabled(), false, `${where}: the Menu button is live again`);
        await g.close();
      }
    },
  },

  {
    name: "a slow connection: the hero choice cannot be reached on the old art while the files are on their way",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, art: { delayMs: 2500 } });
      const page = g.page;
      await page.locator(`${SPLASH}[data-step="art"]`).waitFor({ timeout: T });
      await page.waitForTimeout(800);
      await assertNoGame(page, assert, "while the files are slow");
      await page.locator(MAIN_MENU).waitFor({ timeout: T });
      await g.driver.toAdventureList();
      await page.locator('[data-lto-adventure="rat-cellar"]').click();
      await page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: T });
      await page.waitForFunction(() => document.querySelector('[data-lto-doll="fighter"] canvas')?.getAttribute("data-art") === "cast", null, { timeout: T });
    },
  },

  {
    name: "art that fails shows the plain reason and a Retry button; Retry loads again, stays put while it still fails, and goes on to the main menu when it works (390 and 1280)",
    async run({ newGame, assert }) {
      for (const size of SIZES) {
        const where = `${size.width}px`;
        const g = await newGame({ server: WITH_SERVER, art: "fail", ...viewportOf(size) });
        const page = g.page;
        const failed = page.locator(`${SPLASH}[data-step="failed"]`);
        await failed.waitFor({ timeout: T });
        const text = await failed.innerText();
        assert.match(text, /The art did not load/, `${where}: it says so in plain words`);
        assert.match(text, /The game's art could not be downloaded\. Check your connection and try again\./, `${where}: and why, once for both files`);
        assert.equal(await page.locator("[data-art-reason]").count(), 1, `${where}: one sentence, not one per file`);
        assert.doesNotMatch(text, RAW_WORDS, `${where}: with no status code and no error text (the bridge answered HTTP 503)`);
        assert.doesNotMatch(text, OLD_ART_WORDS, `${where}: and does not say the old art is on show`);
        assert.doesNotMatch(text, /credit|price|\$|cost|pay/i, `${where}: nothing about money`);
        const retry = page.locator("[data-art-retry]");
        assert.equal((await retry.textContent()).trim(), "Retry");
        const box = await retry.boundingBox();
        assert.ok(box && box.height >= 44 && box.width >= 100, `${where}: Retry is a finger-sized button (${JSON.stringify(box)})`);
        assert.equal(await retry.evaluate((n) => document.activeElement === n), true, `${where}: the keyboard is on Retry`);
        await assertNoGame(page, assert, where);
        assert.equal(await page.locator(".lt-app-menu").isDisabled(), true, `${where}: the Menu button is off`);
        await g.screenshot(shotName("failure", size));

        // Retry while it still fails: each file is asked for again, and the screen stays.
        const before = (await page.evaluate(() => window.__assetLoads)).length;
        await retry.click();
        await page.waitForFunction((n) => window.__assetLoads.length >= n + 2, before, { timeout: T });
        await failed.waitFor({ timeout: T });
        await assertNoGame(page, assert, `${where} after a failed Retry`);

        // The connection is back: Retry goes on to the main menu.
        await page.evaluate(() => window.__failAssets(false));
        await page.locator("[data-art-retry]").click();
        await page.locator(MAIN_MENU).waitFor({ timeout: T });
        await page.locator(SPLASH).waitFor({ state: "detached", timeout: T });
        assert.equal(await page.locator("[data-art-retry]").count(), 0, `${where}: the Retry screen is gone`);
        assert.equal(await page.locator(".lt-app-menu").isDisabled(), false, `${where}: the Menu button is live`);
        await g.close();
      }
    },
  },

  {
    name: "a ConjureOS app with no assets bridge, or one that does not give a game its files, says to update the app and shows no Retry button, never the game on old art",
    async run({ newGame, assert }) {
      // The harness always defines window.__conjureos (a host), so "none" is a ConjureOS app too old to have an assets object. A page with no
      // window.__conjureos at all is not testable here: on a local page the game reads the dev server's own copy (devAssets.ts); the unit
      // test (livingtable-art-gate.test.ts) holds the "open it in the ConjureOS app" sentence.
      for (const [label, opts] of [
        ["no assets object", { art: "none" }],
        ["no list (an older ConjureOS)", { extraInit: "delete bridge.assets.list;" }],
      ]) {
        const g = await newGame({ server: WITH_SERVER, ...opts });
        const page = g.page;
        const failed = page.locator(`${SPLASH}[data-step="failed"]`);
        await failed.waitFor({ timeout: T });
        const text = await failed.innerText();
        assert.match(text, /The art did not load/, `${label}: it says so`);
        assert.match(text, /This version of the ConjureOS app cannot download the game's art\. Update the app to play\./, `${label}: and tells the player to update the app`);
        assert.match(text, /0\.59\.1/, `${label}: and which phone app has it`);
        assert.doesNotMatch(text, OLD_ART_WORDS, `${label}: no claim about old art`);
        assert.doesNotMatch(text, RAW_WORDS, `${label}: no raw text`);
        assert.equal(await page.locator("[data-art-reason]").count(), 1, `${label}: the same sentence for both files is said once`);
        assert.equal(await page.locator("[data-art-retry]").count(), 0, `${label}: no Retry button, because Retry could never work`);
        assert.equal(await page.locator(".lt-app-menu").isDisabled(), true, `${label}: the Menu button is off`);
        await assertNoGame(page, assert, label);
        await page.waitForTimeout(500);
        await failed.waitFor({ timeout: T });
        await assertNoGame(page, assert, `${label} later`);
        await g.close();
      }
    },
  },

  {
    name: "the waiting, the failure and the update-the-app screens fit 320, 360, 390, 667x375, 768, 1280 and 3840 wide (no sideways scroll, Retry whole and reachable, text not cut)",
    async run({ newGame, assert }) {
      const sizes = [
        [320, 568, true],
        [360, 740, true],
        [390, 844, true],
        [667, 375, true],
        [768, 1024, true],
        [1280, 800, false],
        [3840, 2160, false],
      ];
      const found = [];
      for (const [width, height, touch] of sizes) {
        const where = `${width}x${height}`;
        // "none" is a ConjureOS app too old to hand over files: the longest sentence, and no Retry button.
        for (const mode of ["hold", "fail", "none"]) {
          const g = await newGame({ server: WITH_SERVER, art: mode, viewport: { width, height }, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
          const page = g.page;
          await page.locator(`${SPLASH}[data-step="${mode === "hold" ? "art" : "failed"}"]`).waitFor({ timeout: T });
          await page.waitForTimeout(400);
          const step = mode === "hold" ? "art-wait" : mode === "fail" ? "art-failed" : "art-update";
          for (const p of await fitProblems(page, { touch })) found.push(`${where} ${step}: ${p}`);
          for (const p of await fitChecks(page, { step, touch })) found.push(`${where} ${step}: ${p}`);
          const m = await page.evaluate(() => {
            const splash = document.querySelector("[data-splash]");
            const clipped = [...splash.querySelectorAll(".ltp-line, .ltp-why, .ltp-retry")].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.className);
            const r = document.querySelector("[data-art-retry]");
            let retry = null;
            if (r) {
              r.scrollIntoView({ block: "nearest" });
              const b = r.getBoundingClientRect();
              const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
              retry = { x: b.left, y: b.top, r: b.right, b: b.bottom, h: b.height, reachable: r === hit || r.contains(hit) };
            }
            return { W: innerWidth, H: innerHeight, sideways: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1, clipped, retry };
          });
          if (m.sideways) found.push(`${where} ${step}: the page scrolls sideways`);
          if (m.clipped.length) found.push(`${where} ${step}: text is cut off in ${m.clipped.join(", ")}`);
          if (mode === "fail") {
            if (!m.retry) found.push(`${where} ${step}: no Retry button`);
            else {
              if (m.retry.x < -1 || m.retry.r > m.W + 1 || m.retry.b > m.H + 1 || m.retry.y < -1) found.push(`${where} ${step}: Retry is not whole inside the window ${JSON.stringify(m.retry)}`);
              if (!m.retry.reachable) found.push(`${where} ${step}: something covers Retry`);
              if (touch && m.retry.h < 43.5) found.push(`${where} ${step}: Retry is ${m.retry.h} px high on a touch screen`);
            }
          }
          if (mode === "none" && m.retry) found.push(`${where} ${step}: a Retry button that could never work`);
          if (width === 3840 || width === 320) await g.screenshot(`no-old-art-${mode === "hold" ? "waiting" : mode === "fail" ? "failure" : "update"}-${where}`);
          await g.close();
        }
      }
      assert.equal(found.length, 0, `the art screens do not fit:\n  ${found.join("\n  ")}`);
    },
  },

  {
    name: "no hand-made doll is ever on the page for the Knight, the Rogue or the Wizard, even when the art is slow to come (the screens wait for it)",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, art: { delayMs: 1500 }, extraInit: WATCH_DOLLS, script: [] });
      const page = g.page;
      const d = g.driver;
      // Straight to the hero choice as soon as there is anything to press: on the old behaviour this is before the figures have landed.
      await d.ready();
      await d.toAdventureList();
      await page.locator('[data-lto-adventure="rat-cellar"]').click();
      await page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: T });
      for (const chassis of ["fighter", "rogue", "wizard"]) {
        await page.waitForFunction((c) => document.querySelector(`[data-lto-doll="${c}"] canvas`)?.getAttribute("data-art") === "cast", chassis, { timeout: T });
      }
      assert.deepEqual(await page.evaluate(() => window.__dolls), [], "no doll on the hero choice, ever");
      // The maker's class cards too.
      await d.playAs("fighter", null);
      await page.locator('[data-lts-field="Name"]').fill("Mira", { timeout: T });
      await page.locator('[data-lts-step="class"]').click({ timeout: T });
      await page.waitForFunction(() => [...document.querySelectorAll("[data-lts-class-card] canvas")].length === 3 && [...document.querySelectorAll("[data-lts-class-card] canvas")].every((c) => c.getAttribute("data-art") === "cast"), null, { timeout: T });
      assert.deepEqual(await page.evaluate(() => window.__dolls), [], "no doll on the maker's class cards, ever");
    },
  },

  {
    name: "on the board in the Rat Cellar's first room, a converted tile is drawn from the KayKit art and the wood floor and stool, which have none, keep their hand-made art (390 and 1280)",
    async run({ h, newGame, assert }) {
      assert.ok(h.server.manifestFile, "the test server has the hand-made art to compare with");
      const { kay, hand } = loadArtPixels(h.server.root, h.server.manifestFile);
      const HOME = { w: 20, h: 15 }; // the board is this many squares across and down
      // Ids by what the owner has converted: these have a KayKit version (the library has them), these do not.
      const kayTiles = (re) => [...kay.tiles].filter(([id]) => re.test(id));
      const handTiles = (re) => [...hand.tiles].filter(([id]) => re.test(id));
      const stoneFloorKay = hashed(kayTiles(/^floor_stone/));
      const stoneWallKay = hashed(kayTiles(/^wall_stone/));
      const woodFloorHand = [...hand.tiles].filter(([id]) => /^floor_wood/.test(id));
      const woodFloorHandHashes = hashed(woodFloorHand);
      const anyKayTile = hashed([...kay.tiles]);
      // Hand-made pictures of ids the library DOES have: these must never reach the board.
      const handOfConverted = hashed([...hand.tiles].filter(([id]) => kay.tiles.has(id)));
      const handPropOfConverted = [...hand.props].filter(([id]) => kay.props.has(id));
      const floorsAnyKind = [...kay.tiles, ...hand.tiles].filter(([id]) => /^floor_/.test(id));
      const handConvertedOnFloor = hashed(handPropOfConverted.flatMap(([pid, p]) => floorsAnyKind.map(([fid, f]) => [`${fid}+hand ${pid}`, over(f, p)])));
      const onWood = (propSprite) => hashed(woodFloorHand.map(([id, f]) => [`${id}+prop`, over(f, propSprite)]));
      const onStone = (propSprite) => hashed(kayTiles(/^floor_stone/).map(([id, f]) => [`${id}+prop`, over(f, propSprite)]));

      for (const size of SIZES) {
        const where = `${size.width}px`;
        const g = await newGame({ server: WITH_SERVER, script: [], ...viewportOf(size) });
        const page = g.page;
        const d = g.driver;
        await d.ready();
        await d.quickStart("rat-cellar", "fighter", "Mira");
        await d.dismissDialogue().catch(() => {});
        await d.settle();
        await page.waitForTimeout(800);
        const sample = await page.evaluate(
          ({ w, h, hashFn }) => {
            const hash = new Function(`return ${hashFn}`)();
            const c = document.querySelector("canvas.ltt-canvas");
            const k = c.width / (w * 32);
            if (!Number.isInteger(k) || k < 1) return { error: `the board is ${c.width} px wide: not a whole number of pixels per art pixel of a 32 px tile` };
            const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            const hashes = [];
            for (let ty = 0; ty < h; ty++) {
              for (let tx = 0; tx < w; tx++) {
                const px = new Uint8Array(32 * 32 * 4);
                for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
                  const s = ((ty * 32 * k + j * k) * c.width + (tx * 32 * k + i * k)) * 4;
                  const o = (j * 32 + i) * 4;
                  px[o] = data[s];
                  px[o + 1] = data[s + 1];
                  px[o + 2] = data[s + 2];
                  px[o + 3] = data[s + 3];
                }
                hashes.push(hash(px));
              }
            }
            return { k, hashes };
          },
          { w: HOME.w, h: HOME.h, hashFn: HASH_FN },
        );
        assert.ok(!sample.error, `${where}: ${sample.error}`);
        const at = (x, y) => sample.hashes[y * HOME.w + x];
        const is = (map, x, y) => map.has(at(x, y));
        // The map of "Your Home" (adventures/rat-cellar.md): wood floor and a bed, chest, rug, stool and shelf on the left; stone floor, a hearth, a workbench,
        // an anvil, barrels and crates in the workshop on the right; walls all round.
        assert.ok(is(stoneFloorKay, 9, 5), `${where}: the workshop's stone floor (9,5) is drawn from the KayKit art`);
        assert.ok(is(stoneFloorKay, 12, 10), `${where}: and so is another stone square (12,10)`);
        assert.ok(is(stoneWallKay, 0, 6) || is(anyKayTile, 0, 6), `${where}: the wall (0,6) is drawn from the KayKit art`);
        assert.ok(is(woodFloorHandHashes, 2, 8), `${where}: the bedroom's wood floor (2,8) has no KayKit version and keeps its hand-made picture`);
        assert.ok(!is(anyKayTile, 2, 8), `${where}: and is not any KayKit tile`);
        assert.ok(is(onWood(kay.props.get("bed_head")), 1, 1), `${where}: the bed's head (1,1) is the KayKit bed on the hand-made wood floor`);
        assert.ok(is(onWood(kay.props.get("bed_foot")), 1, 2), `${where}: and its foot (1,2)`);
        assert.ok(is(onWood(kay.props.get("chest")), 6, 1), `${where}: the chest (6,1) is the KayKit chest`);
        assert.ok(is(onWood(hand.props.get("stool")), 6, 5), `${where}: the stool (6,5) has no KayKit version and keeps its hand-made picture`);
        assert.ok(is(onWood(hand.props.get("shelf")), 6, 9), `${where}: so does the shelf (6,9)`);
        assert.ok(is(onStone(hand.props.get("barrel")), 18, 1), `${where}: the barrel (18,1) is hand-made on a KayKit stone floor`);
        // And nowhere on the board is the hand-made picture of something the library has: not a tile, not a prop on a floor.
        const old = [];
        for (let y = 0; y < HOME.h; y++) {
          for (let x = 0; x < HOME.w; x++) {
            if (is(anyKayTile, x, y)) continue;
            const hit = handOfConverted.get(at(x, y)) ?? handConvertedOnFloor.get(at(x, y));
            if (hit) old.push(`(${x},${y}) is the hand-made ${hit}`);
          }
        }
        assert.deepEqual(old, [], `${where}: the old picture of a converted tile or prop is on the board`);
        const tileCount = sample.hashes.filter((x) => anyKayTile.has(x)).length;
        assert.ok(tileCount >= 40, `${where}: most of the room's tiles are KayKit ones (${tileCount} of ${HOME.w * HOME.h})`);
        await page.waitForTimeout(400);
        await g.screenshot(shotName("board", size));
        await g.close();
      }
    },
  },

  {
    name: "a goblin on the board is still drawn from its hand-made token (it has no KayKit version) while the converted figures come from the cast",
    async run({ h, newGame, assert }) {
      const { kay, hand } = loadArtPixels(h.server.root, h.server.manifestFile);
      const CAPTURE = `
        window.__tokens = [];
        const seen = new WeakSet();
        const real = CanvasRenderingContext2D.prototype.drawImage;
        const hash = ${HASH_FN};
        CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
          try {
            if (src instanceof HTMLCanvasElement && src.width === 32 && (src.height === 32 || src.height === 48) && !seen.has(src)) {
              seen.add(src);
              const px = src.getContext("2d").getImageData(0, 0, 32, src.height).data;
              window.__tokens.push(hash(px));
            }
          } catch (e) {}
          return real.call(this, src, ...rest);
        };
      `;
      const g = await newGame({ server: WITH_SERVER, script: [], extraInit: `window.__rnd = 0.5; Math.random = () => window.__rnd; ${CAPTURE}` });
      const page = g.page;
      const d = g.driver;
      await d.ready();
      await d.toAdventureList();
      await page.locator("[data-lto-room]").first().click({ timeout: T });
      await page.locator("canvas.ltt-canvas").waitFor({ timeout: T });
      await page.locator("[data-lt-hero-rect]").first().waitFor({ state: "attached", timeout: T });
      await page.waitForTimeout(500);
      // Open the door to the east room, where the goblin sleeps: it comes into sight and is drawn.
      const box = await page.locator("canvas.ltt-canvas").boundingBox();
      await page.mouse.click(box.x + ((11 + 0.5) * box.width) / 20, box.y + ((7 + 0.5) * box.height) / 15);
      await page.waitForFunction(() => {
        const [x, , w] = String(document.querySelector("[data-lt-hero-rect]")?.getAttribute("data-lt-hero-rect")).split(",").map(Number);
        const c = document.querySelector("canvas.ltt-canvas").getBoundingClientRect();
        return Math.round((x - c.x) / w) === 10;
      }, null, { timeout: 8000 });
      await page.keyboard.press("e");
      await page.waitForTimeout(1500);
      const drawn = await page.evaluate(() => window.__tokens);
      const goblin = hand.tokens.get("token_goblin");
      assert.ok(drawn.includes(hashBytes(goblin.rgba)), `the goblin's token was drawn from the hand-made art (${drawn.length} hand-drawn figure canvases seen)`);
      // No hand-made picture of a token the library has was drawn as a figure.
      const handOfConverted = hashed([...hand.tokens].filter(([id]) => kay.tokens.has(id)));
      const kayTokens = hashed([...kay.tokens]);
      const old = drawn.filter((x) => handOfConverted.has(x) && !kayTokens.has(x)).map((x) => handOfConverted.get(x));
      assert.deepEqual(old, [], "no converted figure was drawn from its hand-made token");
    },
  },
];
