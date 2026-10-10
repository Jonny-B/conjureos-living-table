// Every word the game says to the player (bug bash items 12, 13, 17, 18, 19 and 30):
//   - story the player did not ask for is told on a screen of its own, and the world waits;
//   - a refusal is the DM's own text, never a strip across the board;
//   - a question to the DM can be taken back, but only while the DM has not started to answer, and nothing says what it costs;
//   - nothing the game prints covers the hero.
//
// The DM is scripted (lib/platform.mjs); an AI call the spec did not plan fails the spec.
import { dmReply, dmScript } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };
const T = 15000;
/** No price, credit or refund in any text a player can read or hover. */
const NO_PRICE = /(?<!Licence and )credit|\bpric(e|es|ed|ing)\b|\brefund|\b\d+\s*coins?\b/i;
/** A DM turn (anything but the adventure writer). */
const DM_ASK = (call) => !/You are writing ONE complete adventure/.test(call.messages[0]?.content ?? "");

// ---- small verbs --------------------------------------------------------------------------------------------------------------

const storyUp = async (g) => (await g.page.locator("[data-lto-story]:not([hidden])").count()) > 0;

/** The story screen as the page shows it now, or null. */
async function story(g) {
  return g.page.evaluate(() => {
    const s = document.querySelector("[data-lto-story]");
    if (!s || s.hidden) return null;
    const panel = s.querySelector(".lto-story-panel");
    const b = panel?.getBoundingClientRect();
    return {
      title: s.dataset.title ?? "",
      speaker: s.dataset.speaker ?? "",
      text: s.dataset.text ?? "",
      page: Number(s.dataset.page ?? 1),
      pages: Number(s.dataset.pages ?? 1),
      shown: Number(s.dataset.shown ?? 0),
      complete: s.dataset.complete === "true",
      queued: Number(s.dataset.queued ?? 0),
      panel: b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null,
    };
  });
}

/** Pick The Rat Cellar and the Knight; wait for the first story (the place's words) to be on screen. */
async function startRatCellar(g) {
  await g.driver.ready();
  await g.driver.toAdventureList();
  await g.page.locator('[data-lto-adventure="rat-cellar"]').click({ timeout: T });
  await g.driver.playAs("fighter");
  await g.page.locator("[data-lto-story]:not([hidden])").waitFor({ timeout: T });
}

/** Press the story until there is none (a click finishes a page, the next turns it, the last closes it). Returns the presses it took. */
async function readThrough(g, max = 40) {
  for (let i = 0; i < max; i += 1) {
    if (!(await storyUp(g))) return i;
    await g.page.locator("[data-lto-story]").click({ timeout: 3000 }).catch(() => {});
    await g.page.waitForTimeout(70);
  }
  throw new Error("the story would not close");
}

/** Close the DM box if one is up (it fades by itself too). */
async function clearDialogue(g) {
  for (let i = 0; i < 12; i += 1) {
    if (!(await g.driver.dialogue())) return;
    await g.page.locator("[data-lto-dialogue]:not([hidden])").click({ timeout: 1500 }).catch(() => {});
    await g.page.waitForTimeout(80);
  }
}

/** The page's text without the screen-reader announcements and the boxes that are put away (they repeat what the DM said and are not a Log). */
const textWithoutAnnouncements = (g) =>
  g.page.evaluate(() => {
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll(".lto-sr, [hidden]").forEach((n) => n.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ");
  });

async function rectOf(g, selector) {
  return g.page.evaluate((sel) => {
    const n = document.querySelector(sel);
    if (!n || n.hidden) return null;
    const b = n.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return null;
    return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
  }, selector);
}

const overlaps = (a, b) => !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;

/** A rect written by the board's layout (data-lt-hero-rect on .lt-viewport): JSON, or four numbers x y w h in page pixels. */
function parseRect(text) {
  if (!text) return null;
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    v = text.split(/[\s,]+/).filter(Boolean).map(Number);
  }
  const [x, y, w, h] = Array.isArray(v) ? v : [v.x ?? v.left, v.y ?? v.top, v.w ?? v.width, v.h ?? v.height];
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  return { x, y, w, h, r: x + w, b: y + h };
}

async function heroRect(g) {
  return parseRect(await g.page.locator(".lt-viewport").getAttribute("data-lt-hero-rect"));
}

const hostProp = (g, name) => g.page.evaluate((n) => Number.parseFloat(document.querySelector(".lt-stage-wrap")?.style.getPropertyValue(n) || "NaN"), name);

/** Plain text style: the Log and the menus are then page text a spec can read (pixel text is drawn on canvases). */
const STORYBOOK = `try { localStorage.setItem("livingtable:table:v1:settings", JSON.stringify({ v: 1, settings: { textStyle: "storybook" } })); } catch (e) {}`;

/** One scripted DM reply for the next ask. */
const answer = (narration) => dmScript(dmReply({ narration }));

/** Click a board tile (column, row of the 20 by 15 grid) at its centre. */
async function clickTile(g, col, row, button = "left") {
  const box = await g.page.locator("canvas.ltt-canvas").boundingBox();
  if (!box) throw new Error("no board");
  await g.page.mouse.click(box.x + ((col + 0.5) * box.width) / 20, box.y + ((row + 0.5) * box.height) / 15, { button });
}

/** The One goblin test room, walk to its door, open it: the goblin wakes and the fight starts. Waits for the turn strip. */
async function startFight(g) {
  await g.driver.ready();
  await g.driver.toAdventureList();
  await g.page.locator("[data-lto-room]").first().click({ timeout: T });
  await g.page.waitForTimeout(1200);
  await clickTile(g, 11, 7);
  await g.page.waitForTimeout(2500);
  await g.page.keyboard.press("e");
  await g.page.locator("[data-lto-initiative]:not([hidden])").waitFor({ timeout: T });
}

export const specs = [
  {
    name: "arriving in a place opens the story screen: centred on a screen of its own, the DM box out of sight, the world locked, and only the player closes it",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await startRatCellar(g);
      const s = await story(g);
      assert.ok(s.title.length > 0, "the place has a title");
      assert.ok(s.text.length > 20, "and its words");
      assert.equal(await g.page.locator("[data-lto-dialogue]").isVisible(), false, "the normal DM box is not shown while the story is up");
      // The panel is in the middle of the game space.
      const wrap = await rectOf(g, ".lt-stage-wrap");
      assert.ok(Math.abs(s.panel.x + s.panel.w / 2 - (wrap.x + wrap.w / 2)) < 6, "centred across the board");
      assert.ok(Math.abs(s.panel.y + s.panel.h / 2 - (wrap.y + wrap.h / 2)) < 40, "and about halfway down it");
      // The world waits: clicks and keys do nothing to the board or the game.
      const still = await d.settle();
      for (const key of ["w", "a", "s", "d", "e", "c", "i", "l", "j", "r", "t"]) await g.page.keyboard.press(key);
      await g.page.waitForTimeout(300);
      assert.equal(await d.boardHash(), still, "keys do not move the hero");
      assert.equal(await storyUp(g), true, "and none of them closes the story");
      assert.equal(await g.page.locator("[data-lto-dialogue]").isVisible(), false, "nor shows the DM box");
      // It never closes by itself: wait longer than the DM box would ever show a line.
      await g.page.waitForTimeout(11000);
      assert.equal(await storyUp(g), true, "an unread story waits for as long as it takes");
      // A click finishes the page that is printing.
      const before = await story(g);
      if (!before.complete) {
        await g.page.locator("[data-lto-story]").click();
        assert.equal((await story(g)).complete, true, "a click makes the whole page appear");
      }
      // Read on through the place and the scene: every one is a press, and the world comes back.
      const presses = await readThrough(g);
      assert.ok(presses >= 2, `the stories took presses to read (${presses})`);
      assert.equal(await storyUp(g), false);
      assert.equal(g.platform.calls.length, 0, "a story the DM tells costs no ask");
      await clearDialogue(g);
      const idle = await d.settle();
      await d.clickBoard(240, 136);
      await g.page.waitForTimeout(300);
      assert.notEqual(await d.settle(), idle, "a click walks the hero again once the story is read");
    },
  },

  {
    name: "the story screen draws in both text styles and fits a phone 320 px wide",
    async run({ newGame, assert }) {
      for (const style of ["pixel", "storybook"]) {
        const g = await newGame({
          server: WITH_SERVER,
          script: dmScript(),
          viewport: { width: 320, height: 640 },
          extraInit: `try { localStorage.setItem("livingtable:table:v1:settings", JSON.stringify({ v: 1, settings: { textStyle: "${style}" } })); } catch (e) {}`,
        });
        await startRatCellar(g);
        assert.equal(await g.page.locator(".lto-root").first().getAttribute("data-style"), style);
        const s = await story(g);
        const layer = await rectOf(g, "[data-lto-story]");
        assert.ok(s.panel.x >= layer.x && s.panel.x + s.panel.w <= layer.r + 0.5, `${style}: the panel is inside the board`);
        assert.ok(s.panel.y >= layer.y - 0.5 && s.panel.y + s.panel.h <= layer.b + 0.5, `${style}: and inside it from top to bottom`);
        assert.equal(await g.driver.scrollsSideways(), false, `${style}: the page does not scroll sideways`);
        await readThrough(g);
      }
    },
  },

  {
    name: "a refusal is the DM's own words in the DM box: no strip across the board, said again on a repeat, never in the Log",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), extraInit: STORYBOOK });
      const d = g.driver;
      await startRatCellar(g);
      await readThrough(g);
      await clearDialogue(g);
      // Nothing to use here.
      await g.page.keyboard.press("e");
      const said = await d.waitDialogue((x) => x.text.length > 0);
      assert.equal(said.speaker, "DM", "the DM says it");
      assert.match(said.text, /^[A-Z]/, "in a sentence");
      for (let i = 0; i < 6; i += 1) {
        assert.equal(await g.page.locator("[data-lto-toast], .lto-toast, [data-lto-toasts], .lto-toasts").count(), 0, "no notice strip ever exists");
        await g.page.waitForTimeout(250);
      }
      // The same click again, right after the box closed, is answered again.
      await clearDialogue(g);
      await g.page.keyboard.press("e");
      const again = await d.waitDialogue((x) => x.text.length > 0);
      assert.equal(again.text, said.text, "a repeated click gets its answer again");
      assert.equal(g.platform.calls.length, 0, "a refusal never asks the model");
      // It is not in the Log: the Log keeps what happened.
      await clearDialogue(g);
      const closed = await textWithoutAnnouncements(g);
      await g.page.keyboard.press("l");
      await g.page.waitForTimeout(400);
      const log = await textWithoutAnnouncements(g);
      assert.notEqual(log, closed, "the Log is open");
      assert.ok(!log.includes(said.text.slice(0, 30)), "the refusal is not a Log line");
      await g.page.keyboard.press("Escape");
    },
  },

  {
    name: "Cancel stands beside the DM's dots, takes the question back, changes nothing, and says nothing about money",
    async run({ newGame, assert }) {
      const g = await newGame({
        server: WITH_SERVER,
        extraInit: STORYBOOK,
        script: [
          { match: DM_ASK, once: true, reply: JSON.stringify(dmReply({ narration: "You knock. Something small scurries away." })) },
          { match: DM_ASK, reply: JSON.stringify(dmReply({ narration: "You listen. Nothing." })), hold: true },
        ],
      });
      const d = g.driver;
      await startRatCellar(g);
      await readThrough(g);
      await clearDialogue(g);
      // A question that is answered, for company in the Log.
      await d.ask("I knock on the wall");
      await d.waitDialogue((x) => /scurries/.test(x.text));
      await clearDialogue(g);
      const idle = await d.settle();
      // A question that is taken back.
      g.platform.reset();
      await d.ask("I listen at the door");
      const cancel = g.page.locator("[data-lto-dialogue] [data-lto-cancel]");
      await cancel.waitFor({ state: "visible", timeout: T });
      const thinking = await d.dialogue();
      assert.equal(thinking.thinking, true, "the box shows the DM's dots");
      assert.equal(thinking.speaker, "DM");
      assert.match((await cancel.getAttribute("aria-label")) ?? "", /^Cancel$/);
      assert.doesNotMatch(await d.text(), NO_PRICE, "the waiting state states no price");
      assert.doesNotMatch(await d.labels(), NO_PRICE, "nor does a label or a hover");
      assert.doesNotMatch((await cancel.innerText()) + ((await cancel.getAttribute("title")) ?? ""), NO_PRICE, "nor does the Cancel button");
      await cancel.click();
      await g.page.locator("[data-lto-dialogue]:not([hidden])").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
      await g.page.waitForFunction(() => !document.querySelector("[data-lto-dialogue]:not([hidden]) [data-lto-cancel]"), null, { timeout: 4000 });
      assert.equal(g.platform.calls.length, 1, "the call was made, so it is spent: Cancel is not a refund");
      assert.equal(await d.settle(), idle, "the board is as it was");
      // The held call ends later; its reply is dropped and nothing of it shows.
      g.platform.release();
      await g.page.waitForTimeout(600);
      assert.equal(await d.dialogue(), null, "the dropped answer is not told");
      // The Log has the first question and not the one that was taken back.
      await g.page.keyboard.press("l");
      await g.page.waitForTimeout(400);
      const log = await textWithoutAnnouncements(g);
      assert.match(log, /I knock on the wall/, "the answered question is in the Log");
      assert.doesNotMatch(log, /I listen at the door/, "the question that was taken back is not");
      assert.doesNotMatch(log, NO_PRICE);
    },
  },

  {
    name: "Cancel is gone once the DM's first word is typing, and Escape no longer takes the question back",
    async run({ newGame, assert }) {
      const narration = "You lean in and hold your breath. Far below, something small and wet taps the stone, once, twice, and stops to listen back.";
      const g = await newGame({
        server: WITH_SERVER,
        script: [{ match: DM_ASK, reply: JSON.stringify(dmReply({ narration })), stream: { size: 10, ms: 10, until: 70 }, hold: true }],
      });
      const d = g.driver;
      await startRatCellar(g);
      await readThrough(g);
      await clearDialogue(g);
      await d.ask("I lean over the well");
      // The first words stream in while the call is still open.
      await d.waitDialogue((x) => !x.thinking && x.text.length > 3);
      assert.equal(await g.page.locator("[data-lto-cancel]").count(), 0, "no Cancel once the reply has started to type");
      assert.doesNotMatch(await d.text(), NO_PRICE);
      await g.page.keyboard.press("Escape");
      await g.page.waitForTimeout(200);
      g.platform.release();
      const full = await d.waitDialogue((x) => x.text.includes("listen back"));
      assert.equal(full.speaker, "DM", "the answer was not cancelled; it is told in full");
      assert.equal(g.platform.calls.length, 1);
    },
  },

  {
    name: "no price, credit or refund in the menu either",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await startRatCellar(g);
      await readThrough(g);
      await clearDialogue(g);
      await clickTile(g, 4, 6, "right");
      await g.page.locator(".lto-cm, [data-lto-menu]").first().waitFor({ timeout: T });
      assert.doesNotMatch(await d.text(), NO_PRICE, "the menu states no price");
      assert.doesNotMatch(await d.labels(), NO_PRICE);
      await g.page.keyboard.press("Escape");
    },
  },

  {
    name: "text never covers the hero: the DM box has a band of its own below the board, at every screen size",
    async run({ newGame, assert }) {
      for (const [width, height] of [
        [1280, 900],
        [820, 1180],
        [390, 844],
        [320, 640],
      ]) {
        const label = `${width}x${height}`;
        const g = await newGame({
          server: WITH_SERVER,
          script: answer("You look around the room slowly, and take in the old beams, the barrels, the dust and the low door in the far wall, and the thin line of light that falls across the floor."),
          viewport: { width, height },
          extraInit: `try { localStorage.setItem("livingtable:table:v1:settings", JSON.stringify({ v: 1, settings: { textSpeed: "instant" } })); } catch (e) {}`,
        });
        const d = g.driver;
        await startRatCellar(g);
        await readThrough(g);
        await clearDialogue(g);
        await d.ask("I look around");
        await d.waitDialogue((x) => !x.thinking && x.text.length > 20);
        await g.page.waitForTimeout(250);
        const dock = await hostProp(g, "--lto-dock");
        assert.ok(dock > 60, `${label}: the dock band is published (${dock})`);
        const wrap = await rectOf(g, ".lt-stage-wrap");
        const box = await rectOf(g, "[data-lto-dialogue]");
        assert.ok(box, `${label}: the DM box is showing`);
        // The box sits inside the band: the band reaches from the foot of the stage up to its top edge, with the box's own margin to spare.
        assert.ok(box.y >= wrap.b - dock - 1, `${label}: the DM box (top ${Math.round(box.y)}) lies inside the dock band (${Math.round(wrap.b - dock)} down)`);
        assert.ok(box.b <= wrap.b + 1, `${label}: and does not run off the foot of the stage`);
        // Nothing of it is over the board or the hero.
        const view = await rectOf(g, ".lt-viewport");
        assert.equal(overlaps(box, view), false, `${label}: the DM box does not overlap the board's viewport`);
        const hero = await heroRect(g);
        assert.ok(hero, `${label}: the board reports where the hero is (data-lt-hero-rect on .lt-viewport)`);
        assert.equal(overlaps(box, hero), false, `${label}: the DM box does not cover the hero`);
        assert.equal(await d.scrollsSideways(), false, `${label}: the page does not scroll sideways`);
      }
    },
  },

  {
    name: "in a fight the turn strip and its banners have a band of their own above the board, and the band is gone when the fight is not on",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      assert.equal(await hostProp(g, "--lto-top-band"), 0, "no band before a fight");
      await startFight(g);
      const band = await hostProp(g, "--lto-top-band");
      assert.ok(band > 30, `the top band is open while the fight is on (${band})`);
      const wrap = await rectOf(g, ".lt-stage-wrap");
      const strip = await rectOf(g, "[data-lto-initiative]");
      assert.ok(strip && strip.y >= wrap.y && strip.b <= wrap.y + band + 1, "the turn strip lies inside the top band");
      // A banner (Roll initiative, Your turn) stands in the same band, under the strip.
      const banner = await g.page.evaluate(() => {
        const n = document.querySelector("[data-lto-banner]");
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return { y: b.y, b: b.bottom };
      });
      if (banner) assert.ok(banner.b <= wrap.y + band + 1, "a banner lies inside the top band, never over the board");
      const view = await rectOf(g, ".lt-viewport");
      assert.ok(view.y >= wrap.y + band - 1, "the board's viewport starts below the band");
      const hero = await heroRect(g);
      assert.ok(hero, "the board reports where the hero is");
      assert.equal(overlaps(strip, hero), false, "the strip does not cover the hero");
    },
  },
];
