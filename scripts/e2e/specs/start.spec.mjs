// The way in: the splash while the table is set, the main menu, and the adventure list behind it.
//
// Every spec here reaches the window through the main menu (data-ltm-*), never through the driver's start-screen helpers, so these
// checks hold whichever way the driver opens a game. The ConjureOS host is mocked as in table.spec.mjs.
import { dmReply, dmScript } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };
const T = 15000;

/** A whoami that answers late, as a slow platform does. */
const SLOW_WHOAMI = (ms) => `const real = bridge.auth && bridge.auth.whoami; if (real) bridge.auth.whoami = async () => { await new Promise((r) => setTimeout(r, ${ms})); return real(); };`;

const menu = (g) => g.page.locator('[data-ltm-menu="main"]');
const act = (g, id) => g.page.locator(`[data-ltm-act="${id}"]`);

/** Wait for the window and its main menu (the HUD column is hidden while the menu is up, so only the menu is waited for). */
async function menuUp(g) {
  await g.page.locator("[data-lto-hud]").waitFor({ state: "attached", timeout: T });
  await menu(g).waitFor({ timeout: T });
}

/** From the main menu to the adventure list. */
async function toList(g) {
  await act(g, "new").click({ timeout: T });
  await g.page.locator("[data-lto-adventure]").first().waitFor({ timeout: T });
}

/** The normal DM box, only when one is up (an arrival is a story screen now, so there is often none to clear): pressed until it is gone. */
async function clearDialogue(g) {
  const box = g.page.locator("[data-lto-dialogue]:not([hidden])");
  for (let i = 0; i < 30 && (await box.count()) > 0; i++) {
    await box.first().click({ timeout: 1500, force: true }).catch(() => {});
    await g.page.waitForTimeout(80);
  }
}

/** Read the story screens that open on an arrival: click through each until none is up. `wait` is how long to look for the first one. */
async function readStory(g, wait = 4000) {
  const story = g.page.locator("[data-lto-story]:not([hidden])");
  await story.first().waitFor({ timeout: wait }).catch(() => {});
  for (let i = 0; i < 14; i++) {
    if ((await story.count()) === 0) break;
    await story.first().click({ position: { x: 6, y: 6 }, force: true }).catch(() => {});
    await g.page.waitForTimeout(150);
  }
  await g.page.locator("[data-lto-story]:not([hidden])").waitFor({ state: "detached", timeout: T }).catch(() => {});
}

/** Play The Rat Cellar as the Knight from the main menu, past the opening, and make a save. */
async function playAndSave(g) {
  const d = g.driver;
  await menuUp(g);
  await toList(g);
  await g.page.locator('[data-lto-adventure="rat-cellar"]').click({ timeout: T });
  await d.playAs("fighter");
  await readStory(g, T);
  await clearDialogue(g);
  await d.rest();
  await readStory(g, 600);
  await clearDialogue(g);
}

export const specs = [
  {
    name: "the splash covers the page while the platform is slow, shows the title and a turning die, and is gone once the table is set",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), extraInit: SLOW_WHOAMI(1200) });
      const splash = g.page.locator("[data-splash]");
      await splash.waitFor({ state: "visible", timeout: 3000 });
      assert.match(await splash.innerText(), /Setting the table/);
      const box = await splash.boundingBox();
      const view = g.page.viewportSize();
      assert.ok(box && Math.abs(box.width - view.width) <= 1 && Math.abs(box.height - view.height) <= 1, "it covers the whole page");
      assert.equal(await splash.locator(".ltp-title canvas").count(), 1, "the title is drawn in the pixel letters");
      assert.equal(await splash.locator(".ltp-die svg").count(), 1, "and there is a die");
      assert.notEqual(await splash.locator(".ltp-die svg").evaluate((n) => getComputedStyle(n).animationName), "none", "the die turns");
      // The wait is the platform's: the window is not up yet, and the page behind the splash is not usable.
      assert.equal(await g.page.locator("[data-lto-hud]").count(), 0, "the window is not there while whoami is pending");
      await menu(g).waitFor({ timeout: T });
      await splash.waitFor({ state: "detached", timeout: 5000 });
      assert.equal(await g.page.getByText("Setting the table").count(), 0, "nothing is left saying it is loading");
      assert.equal(g.platform.calls.length, 0);
    },
  },

  {
    name: "a fast load still shows the splash for its minimum, so it does not flash",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const t0 = Date.now();
      await g.page.locator("[data-splash]").waitFor({ state: "visible", timeout: 3000 });
      await g.page.locator("[data-splash]").waitFor({ state: "detached", timeout: 5000 });
      assert.ok(Date.now() - t0 >= 300, "the splash was up for a moment");
      assert.equal(await menu(g).isVisible(), true);
    },
  },

  {
    name: "the splash holds still for a player who asks for less motion, and fits a 320 px phone without scrolling sideways",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), extraInit: SLOW_WHOAMI(1200), reducedMotion: "reduce", viewport: { width: 320, height: 568 }, hasTouch: true });
      const splash = g.page.locator("[data-splash]");
      await splash.waitFor({ state: "visible", timeout: 3000 });
      assert.equal(await splash.locator(".ltp-die svg").evaluate((n) => getComputedStyle(n).animationName), "none", "the die holds still");
      const title = await splash.locator(".ltp-title canvas").boundingBox();
      assert.ok(title && title.x >= 0 && title.x + title.width <= 320, `the title fits 320 px (${JSON.stringify(title)})`);
      assert.equal(await g.driver.scrollsSideways(), false);
      await menu(g).waitFor({ timeout: T });
    },
  },

  {
    name: "a launch with no save opens on the main menu: Continue is off, every other button works, and the licence text is in Licence and credits",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      await menuUp(g);
      assert.equal(await g.page.locator("[data-lto-adventure]").count(), 0, "the adventure list is behind New game, not the first thing");
      for (const id of ["continue", "new", "load", "settings", "credits"]) assert.equal(await act(g, id).count(), 1, `${id} is there`);
      assert.equal(await act(g, "continue").isDisabled(), true, "nothing to go back to");
      assert.deepEqual(
        await g.page.locator("[data-ltm-act]").evaluateAll((n) => n.map((x) => x.querySelector(".ltm-label").textContent)),
        ["Continue", "New game", "Load", "Settings", "Licence and credits"],
      );
      const heights = await g.page.locator("[data-ltm-act]").evaluateAll((n) => n.map((x) => x.getBoundingClientRect().height));
      assert.ok(heights.every((h) => h >= 44), `every button is at least 44 px tall (${heights.join(", ")})`);
      // The licence credit is one press away, and Escape comes back.
      await act(g, "credits").click();
      const credits = g.page.locator("[data-ltm-credits]");
      await credits.waitFor({ timeout: T });
      assert.match(await credits.innerText(), /System Reference Document 5\.1/);
      assert.match(await credits.innerText(), /Creative Commons Attribution 4\.0/);
      assert.equal(await g.page.locator('[data-ltm-menu="credits"]').count(), 1);
      await g.page.keyboard.press("Escape");
      await menu(g).waitFor({ timeout: T });
      // Escape on the main page with no game does nothing.
      await g.page.keyboard.press("Escape");
      assert.equal(await menu(g).count(), 1, "a menu with no game behind it stays up");
      // New game is the adventure list, and it has a way back.
      await toList(g);
      await g.page.locator("[data-lto-menu]").click({ timeout: T });
      await menu(g).waitFor({ timeout: T });
      assert.equal(g.platform.calls.length, 0, "the menu never calls the model");
    },
  },

  {
    name: "the adventure list shows no hand written tag and no draft line, and the two test rooms are readable (on a local page)",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      await menuUp(g);
      await toList(g);
      const text = await g.driver.text();
      assert.doesNotMatch(text, /hand written|marked for review|draft:/i, "the start screen does not carry the author's notes");
      assert.doesNotMatch(await g.driver.labels(), /hand written|marked for review|draft:/i, "nor do its labels");
      assert.equal(await g.page.locator(".lto-pill").count(), 0, "the owner's adventures wear no tag");
      assert.equal(await g.page.locator("[data-lto-draft]").count(), 0);
      // 127.0.0.1 is a local page, so the rooms are listed, with their words at the size of the rest of the screen.
      const rooms = await g.driver.rooms();
      assert.equal(rooms.length, 2, "both test rooms are listed on a local page");
      assert.equal(await g.page.locator("[data-lto-room] .lto-card-quiet").count(), 0, "no tiny dim text on a room card");
      assert.equal(await g.page.locator("[data-lto-room] .lto-card-text").count(), 2, "each room's summary is drawn like an adventure's");
      const tall = await g.page.locator("[data-lto-room] .lto-card-text canvas").evaluateAll((n) => n.map((c) => c.getBoundingClientRect().height));
      assert.ok(tall.every((h) => h >= 14), `the room summaries are not tiny (${tall.join(", ")})`);
      assert.match(rooms.map((r) => r.text).join(" "), /goblin/i);
    },
  },

  {
    name: "a launch with a save shows the main menu with Continue on, and Continue lands in the same game",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await playAndSave(g);
      assert.ok([...g.platform.saves.keys()].some((k) => k.startsWith("s:")), "a save point is on the server");
      const before = await d.readout();
      const boardBefore = await d.settle();
      await g.page.reload({ waitUntil: "load" });
      await menuUp(g);
      assert.equal(await g.page.locator("[data-lto-adventure]").count(), 0, "not the adventure list");
      assert.equal(await act(g, "continue").isEnabled(), true, "Continue is on");
      assert.match(await act(g, "continue").innerText(), /newest save/i, "and says where it goes");
      await act(g, "continue").click();
      await menu(g).waitFor({ state: "detached", timeout: T });
      assert.equal(await g.page.locator("[data-lto-adventure]").count(), 0);
      const after = await d.readout();
      const head = (s) => s.split(/AC \d+/)[0];
      assert.equal(head(after), head(before), "the same scene is up");
      assert.equal(await d.settle(), boardBefore, "with the hero standing where they were");
      assert.equal(g.platform.calls.length, 0, "continuing never calls the model");
    },
  },

  {
    name: "New game with a game running writes a checkpoint first, the list can go back to the menu, and Continue returns to the running game",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await playAndSave(g);
      const before = await d.readout();
      const savesBefore = (await d.saves()).length;
      await d.closeDrawer("saves");
      // The page bar's Menu button opens the main menu over the running game.
      await g.page.locator(".lt-app-menu").click({ timeout: T });
      await menu(g).waitFor({ timeout: T });
      assert.equal(await act(g, "continue").isEnabled(), true);
      assert.match(await act(g, "continue").innerText(), /your game/i);
      await act(g, "new").click();
      await g.page.locator("[data-lto-adventure]").first().waitFor({ timeout: T });
      // A checkpoint of the live play was written before the list opened.
      await g.page.locator("[data-lto-menu]").click({ timeout: T });
      await menu(g).waitFor({ timeout: T });
      await act(g, "load").click();
      await g.page.waitForTimeout(300);
      const rows = await g.page.locator("[data-save-row]").evaluateAll((r) => r.map((x) => x.innerText.replace(/\s+/g, " ")));
      assert.ok(rows.some((t) => /before a new game/i.test(t)), `the Saves list holds the automatic checkpoint (${rows.join(" | ")})`);
      assert.ok(rows.length > savesBefore, "one more save than there was");
      await g.page.keyboard.press("Escape");
      await menu(g).waitFor({ timeout: T });
      // The adventure list was an errand: Continue still goes back to the game that was running.
      await act(g, "continue").click();
      await menu(g).waitFor({ state: "detached", timeout: T });
      const after = await d.readout();
      const head = (s) => s.split(/AC \d+/)[0];
      assert.equal(head(after), head(before), "back in the same game");
      assert.equal(g.platform.calls.length, 0);
    },
  },

  {
    name: "there is no New character anywhere in a running game",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await playAndSave(g);
      assert.equal(await g.page.locator('[data-lts-act="new"]').count(), 0, "the sheet has no New character button");
      assert.doesNotMatch(await d.text(), /new character/i);
      await g.page.keyboard.press("c");
      await g.page.waitForTimeout(400);
      assert.equal(await g.page.locator('[data-lts-act="new"]').count(), 0, "not with the character open either");
      assert.doesNotMatch(await d.text(), /new character/i);
    },
  },

  {
    name: "the main menu fits a 320 px phone and a wide screen with no sideways scroll, and its buttons stay reachable",
    async run({ newGame, assert }) {
      for (const view of [{ width: 320, height: 568 }, { width: 1920, height: 1080 }]) {
        const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: view, hasTouch: view.width < 500 });
        await menuUp(g);
        assert.equal(await g.driver.scrollsSideways(), false, `${view.width}px: no sideways scroll`);
        for (const id of ["new", "credits"]) {
          const b = await act(g, id).boundingBox();
          assert.ok(b && b.x >= 0 && b.x + b.width <= view.width + 1, `${view.width}px: ${id} is inside the page`);
        }
        await toList(g);
        assert.equal(await g.driver.scrollsSideways(), false, `${view.width}px: the list does not scroll sideways`);
        await g.screenshot(`menu-list-${view.width}`);
      }
    },
  },
];
