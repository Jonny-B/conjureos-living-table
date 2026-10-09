// The hero choice (a swipeable strip of Knight, Rogue and Mage, each drawn in basic gear with its default stats)
// and the character maker (the name first, then a class or a blank sheet). Bug bash items 6 and 25.
import { dmScript } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };
const OLD_NAMES = /Shadow|Fireball/;

/** The hero choice of the Rat Cellar, at a given window size. */
async function openHeroChoice(newGame, viewport, touch) {
  const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport, ...(touch ? { hasTouch: true } : {}) });
  const d = g.driver;
  await d.ready();
  await d.toAdventureList();
  await g.page.locator('[data-lto-adventure="rat-cellar"]').click();
  await g.page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: 15000 });
  return { g, d };
}

/** The index of the slide the strip is showing, by the dot that is marked. */
async function currentDot(page) {
  return page.locator("[data-lto-hero-dot]").evaluateAll((dots) => dots.findIndex((x) => x.getAttribute("aria-current") === "true"));
}

export const specs = [
  {
    name: "the hero choice is a strip of Knight, Rogue and Mage with a doll and default stats, then the maker (390 and 1280)",
    async run({ newGame, assert }) {
      for (const [viewport, touch] of [[{ width: 390, height: 844 }, true], [{ width: 1280, height: 900 }, false]]) {
        const where = `${viewport.width}px`;
        const { g, d } = await openHeroChoice(newGame, viewport, touch);
        const page = g.page;
        const slides = await page.locator("[data-lto-slide]").evaluateAll((n) => n.map((x) => x.dataset.ltoSlide));
        assert.deepEqual(slides, ["fighter", "rogue", "wizard", "create"], `${where}: three classes then the maker`);
        const titles = await page.locator("[data-lto-slide] .lto-card-title").evaluateAll((n) => n.map((x) => x.dataset.text));
        assert.deepEqual(titles.slice(0, 3), ["Knight", "Rogue", "Mage"], `${where}: the classes are called Knight, Rogue and Mage`);
        assert.equal(await page.locator("[data-lto-doll] canvas").count(), 3, `${where}: a doll for each class`);
        const inked = await page.locator("[data-lto-doll] canvas").evaluateAll((cs) =>
          cs.map((c) => {
            const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
            return n;
          }),
        );
        for (const n of inked) assert.ok(n > 500, `${where}: the doll is drawn (${n} painted pixels)`);
        assert.equal(await currentDot(page), 0, `${where}: starts on the Knight`);
        // Right, Right: the Mage.
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => document.querySelector('[data-lto-hero-dot="1"]')?.getAttribute("aria-current") === "true");
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => document.querySelector('[data-lto-hero-dot="2"]')?.getAttribute("aria-current") === "true");
        await page.waitForFunction(() => {
          const strip = document.querySelector(".lto-hero-strip").getBoundingClientRect();
          const slide = document.querySelector('[data-lto-slide="wizard"]').getBoundingClientRect();
          return Math.abs(slide.left - strip.left) < 4;
        }, null, { timeout: 4000 });
        const inView = await page.evaluate(() => {
          const strip = document.querySelector(".lto-hero-strip").getBoundingClientRect();
          const slide = document.querySelector('[data-lto-slide="wizard"]').getBoundingClientRect();
          return { ok: Math.abs(slide.left - strip.left) < 4 && Math.abs(slide.right - strip.right) < 4, strip: [strip.left, strip.right], slide: [slide.left, slide.right], scrollLeft: document.querySelector(".lto-hero-strip").scrollLeft, clientWidth: document.querySelector(".lto-hero-strip").clientWidth, scrollWidth: document.querySelector(".lto-hero-strip").scrollWidth, slides: [...document.querySelectorAll(".lto-hero-slide")].map((s) => [s.offsetLeft, s.offsetWidth]) };
        });
        assert.ok(inView.ok, `${where}: the Mage slide fills the strip ${JSON.stringify(inView)}`);
        // Left comes back.
        await page.keyboard.press("ArrowLeft");
        await page.waitForFunction(() => document.querySelector('[data-lto-hero-dot="1"]')?.getAttribute("aria-current") === "true");
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => document.querySelector('[data-lto-hero-dot="2"]')?.getAttribute("aria-current") === "true");
        // Default stats.
        const toggle = page.locator('[data-lto-stats-toggle="wizard"]');
        await toggle.click();
        const stats = page.locator('[data-lto-stats="wizard"]');
        await stats.waitFor({ state: "visible" });
        const statsText = (await stats.innerText()).replace(/\s+/g, " ");
        assert.match(statsText, /\bAC\b.*\b\d+\b/, `${where}: default stats show AC`);
        assert.match(statsText, /\bHP\b.*\b\d+\b/, `${where}: default stats show HP`);
        assert.match(statsText, /To hit/, `${where}: and the to-hit bonus`);
        assert.match(statsText, /Damage/, `${where}: and the damage`);
        assert.match(statsText, /INT/, `${where}: and the abilities`);
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        // No old names anywhere a player can read.
        assert.doesNotMatch(await d.text(), OLD_NAMES, `${where}: no Shadow or Fireball on the page`);
        assert.doesNotMatch(await d.labels(), OLD_NAMES, `${where}: nor in a label`);
        // Touch targets and no sideways page scroll.
        for (const sel of ['[data-lto-hero-arrow="prev"]', '[data-lto-hero-arrow="next"]', '[data-lto-stats-toggle="wizard"]', '[data-lto-quick="wizard"]']) {
          const box = await page.locator(sel).boundingBox();
          assert.ok(box && box.height >= 44 && box.width >= 44, `${where}: ${sel} is at least 44 px (${JSON.stringify(box)})`);
        }
        assert.equal(await d.scrollsSideways(), false, `${where}: the page does not scroll sideways`);
        await g.screenshot(`hero-choice-${viewport.width}`).then((p) => console.log(`  shot: ${p}`));
        // The last slide is the maker.
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => document.querySelector('[data-lto-hero-dot="3"]')?.getAttribute("aria-current") === "true");
        assert.equal(await page.locator("[data-lto-create]").isVisible(), true, `${where}: the maker is the last slide`);
        await g.close();
      }
    },
  },

  {
    name: "Play as the Knight opens the maker on its Name step: Begin stays disabled and the game does not start until a name is typed",
    async run({ newGame, assert }) {
      const { g, d } = await openHeroChoice(newGame, { width: 1280, height: 900 }, false);
      const page = g.page;
      await d.playAs("fighter", null);
      const begin = page.locator('[data-lts-act="begin"]');
      const field = page.locator('[data-lts-field="Name"]');
      assert.equal(await begin.isDisabled(), true, "Begin is disabled with the name empty");
      await page.waitForTimeout(600);
      assert.equal(await page.locator("[data-lto-story]:not([hidden]), [data-lto-dialogue]:not([hidden])").count(), 0, "the game has not started");
      assert.equal(await page.locator("[data-lto-hud]").isVisible().catch(() => false), false, "no board yet");
      await field.fill("   ");
      assert.equal(await begin.isDisabled(), true, "spaces are not a name");
      await field.fill("Mira");
      assert.equal(await begin.isDisabled(), false, "a name unlocks Begin");
      assert.equal(await page.locator("[data-lto-story]:not([hidden]), [data-lto-dialogue]:not([hidden])").count(), 0, "typing a name alone does not start the game");
      await begin.click();
      await page.locator("[data-lto-dialogue]:not([hidden]), [data-lto-story]:not([hidden])").first().waitFor({ timeout: 15000 });
      await d.dismissDialogue();
      assert.match(await d.text(), /Mira/, "the hero carries the typed name");
    },
  },

  {
    name: "a Rogue or a Mage can be started from the strip, and the hero carries the typed name and the class",
    async run({ newGame, assert }) {
      const { g, d } = await openHeroChoice(newGame, { width: 1280, height: 900 }, false);
      await d.playAs("rogue", "Mira");
      await d.dismissDialogue();
      await d.openMenu("character");
      const text = await d.text();
      assert.match(text, /Mira/, "the hero carries the name the player typed");
      assert.match(text, /Rogue/, "and is a Rogue by class");
      assert.doesNotMatch(text, OLD_NAMES, "and never the old name");
    },
  },

  {
    name: "the hero choice fits a 320 px phone: one slide wide, 44 px buttons, no sideways scroll",
    async run({ newGame, assert }) {
      const { g, d } = await openHeroChoice(newGame, { width: 320, height: 640 }, true);
      const page = g.page;
      assert.equal(await d.scrollsSideways(), false, "the page does not scroll sideways");
      const strip = await page.locator(".lto-hero-strip").boundingBox();
      const first = await page.locator('[data-lto-slide="fighter"]').boundingBox();
      assert.ok(strip && first && Math.abs(first.width - strip.width) < 2, `one slide is as wide as the strip (${first?.width} / ${strip?.width})`);
      assert.ok(strip.width <= 320, "the strip fits the phone");
      for (const sel of ['[data-lto-hero-arrow="prev"]', '[data-lto-hero-arrow="next"]', '[data-lto-quick="fighter"]', '[data-lto-stats-toggle="fighter"]', "[data-lto-back]"]) {
        const box = await page.locator(sel).boundingBox();
        assert.ok(box && box.height >= 44 - 1 && box.width >= 44, `${sel} is at least 44 px (${JSON.stringify(box)})`);
      }
      await page.locator('[data-lto-stats-toggle="fighter"]').click();
      await page.locator('[data-lto-stats="fighter"]').waitFor({ state: "visible" });
      assert.equal(await d.scrollsSideways(), false, "still no sideways scroll with the stats open");
      await g.screenshot("hero-choice-320").then((p) => console.log(`  shot: ${p}`));
    },
  },

  {
    name: "the character maker asks for the name first and waits for it; then a class or a blank sheet",
    async run({ newGame, assert }) {
      const { g, d } = await openHeroChoice(newGame, { width: 1280, height: 900 }, false);
      const page = g.page;
      await page.keyboard.press("End");
      await page.locator("[data-lto-create]").click();
      await page.locator('[data-lts="creation"]').waitFor({ timeout: 15000 });
      const begin = page.locator('[data-lts-act="begin"]');
      const next = page.locator('[data-lts-act="next"]');
      assert.equal(await page.locator('[data-lts-step="name"]').getAttribute("aria-selected"), "true", "the first step is the name");
      assert.equal(await page.locator('[data-lts-field="Name"]').inputValue(), "", "no name is filled in");
      assert.equal(await begin.isDisabled(), true, "Begin waits for a name");
      assert.equal(await next.isDisabled(), true, "so does Next");
      assert.equal(await page.locator('[data-lts-step="class"]').isDisabled(), true, "and so does every other step");
      await page.locator('[data-lts-field="Name"]').fill("   ");
      assert.equal(await begin.isDisabled(), true, "spaces are not a name");
      await page.locator('[data-lts-field="Name"]').fill("Mira");
      assert.equal(await begin.isDisabled(), false, "a name unlocks Begin");
      assert.equal(await next.isDisabled(), false, "and Next");
      await next.click();
      // Step two: a class or a blank sheet.
      assert.equal(await page.locator('[data-lts-step="class"]').getAttribute("aria-selected"), "true");
      const cards = await page.locator("[data-lts-class-card]").evaluateAll((n) => n.map((x) => x.querySelector(".nm")?.textContent));
      assert.deepEqual(cards, ["Knight", "Rogue", "Mage"], "three classes");
      assert.equal(await page.locator("[data-lts-blank]").count(), 1, "and a blank sheet");
      assert.doesNotMatch(await d.text(), OLD_NAMES);
      await page.locator('[data-lts-class="fireball-person"]').click();
      assert.equal(await page.locator('[data-lts-class="fireball-person"]').getAttribute("aria-pressed"), "true");
      // Blank: every score 8, no ancestry, no background; the class stays for hit die and gear.
      await page.locator("[data-lts-blank]").click();
      assert.equal(await page.locator("[data-lts-blank]").getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-lts-class="fireball-person"]').getAttribute("aria-pressed"), "true", "the class is kept");
      await page.locator('[data-lts-step="review"]').click();
      const review = (await page.locator('[data-lts="creation"]').innerText()).replace(/\s+/g, " ");
      assert.match(review, /Mira/, "the review shows the name");
      assert.equal(await begin.isDisabled(), false);
      // Leaving blank returns to the class's own numbers.
      await page.locator('[data-lts-step="class"]').click();
      await page.locator("[data-lts-blank]").click();
      assert.equal(await page.locator("[data-lts-blank]").getAttribute("aria-pressed"), "false");
      await g.screenshot("maker-class-step").then((p) => console.log(`  shot: ${p}`));
      await begin.click();
      await page.locator("[data-lto-dialogue]:not([hidden]), [data-lto-story]:not([hidden])").first().waitFor({ timeout: 15000 });
      await d.dismissDialogue();
      assert.match(await d.text(), /Mira/, "the hero is the one named Mira");
      assert.doesNotMatch(await d.text(), OLD_NAMES);
    },
  },
];
