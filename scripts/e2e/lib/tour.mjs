// A tour of the whole game at one window size, the way a player meets it: the loading screen, the main menu, the adventure list, the hero
// choice, the character maker (name first), The Rat Cellar from home to a fight in the cellar with the rats dying and a body harvested, the
// actions menu with its text line, a DM answer, a DM call taken back, the game menu on all six tabs, and full screen. At every step it checks
// the page FITS (no sideways scroll, nothing cut off by the window, nothing the game prints covering the hero outside the story screen, a
// finger-sized target on a phone) and saves a screenshot to <shots>/bb-<step>-<width>x<height>.png.
//
// Used by specs/integration.spec.mjs (a few sizes, with the item checks) and by walk.mjs (every size, for the eyes).
import fs from "node:fs";
import path from "node:path";
import { dmReply } from "./fixtures.mjs";
import { COLS, ROWS, PIN_DICE, pin, readMenu, menuRow, clickRow, rightClickTile, leftClickTile, heroTile, readStory, homeToCellar, squaresOf, tilePoint, talkReply, waitUntil, walkTo } from "./journey.mjs";

const T = 15000;
const DM_ASK = (call) => !/You are writing ONE complete adventure/.test(call.messages[0]?.content ?? "");

/** The DM's script for the tour: Tobin and Marta talk, one question is held (to be taken back), anything else gets a plain answer. */
export function tourScript() {
  const talk = talkReply(dmReply);
  const lastAsk = (call) => call.messages[call.messages.length - 1]?.content ?? "";
  return [
    { match: (c) => DM_ASK(c) && /I listen at the door/.test(lastAsk(c)), hold: true, reply: JSON.stringify(dmReply({ narration: "You hear nothing." })) },
    {
      match: DM_ASK,
      reply: (call) => {
        // The newest question is the last one named in the prompt (the earlier ones ride along as reminders).
        const said = [...call.messages.map((x) => x.content).join(" ").matchAll(/I look at the walls|I talk to [A-Z][a-z]+(?: [A-Z][a-z]+)?/g)].pop()?.[0] ?? "";
        if (/I look at the walls/.test(said)) return JSON.stringify(dmReply({ narration: "The stone is old and cold, and the cobwebs in the corners have not been touched in years." }));
        return JSON.stringify(talk(call));
      },
    },
  ];
}

/** Everything the fit checks read, in one page call. */
async function measure(page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rectOf = (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
    };
    const shown = (n) => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      return !n.closest("[hidden]");
    };
    const pick = (sel) => [...document.querySelectorAll(sel)].filter(shown).map((n) => ({ sel, ...rectOf(n), text: (n.innerText || n.getAttribute("aria-label") || "").slice(0, 30) }));
    const hero = document.querySelector(".lt-viewport")?.getAttribute("data-lt-hero-rect");
    let heroRect = null;
    if (hero) {
      const [x, y, w, h] = hero.split(",").map(Number);
      if ([x, y, w, h].every(Number.isFinite)) heroRect = { x, y, w, h, r: x + w, b: y + h };
    }
    const fullscreen = document.fullscreenElement !== null;
    return {
      W,
      H,
      fullscreen,
      scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      scrollH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      heroRect,
      // The layers that must sit inside the window.
      layers: [
        ...pick(".lt-app-bar"),
        ...pick(".lt-arena"),
        ...pick(".lt-stage-wrap"),
        ...pick("[data-lto-hud]"),
        ...pick("[data-lto-dialogue]"),
        ...pick(".lto-story-panel"),
        ...pick("[data-game-menu]"),
        ...pick("[data-ltm-menu]"),
        ...pick('[data-lto-menu][role="menu"]'),
        ...pick("[data-lto-loot]"),
        ...pick("[data-lto-initiative]"),
        ...pick(".lt-dice-host"),
      ],
      // What the game prints over the board and must keep off the hero (the story screen may cover it: it is the whole story; the dice tray is the roll itself and rises over the board while a die is thrown).
      overlays: [...pick("[data-lto-dialogue]"), ...pick("[data-lto-initiative]"), ...pick("[data-lto-banner]")],
      // Things a finger has to hit.
      targets: [...pick('[data-lto-hud] button, [data-game-menu] button, [data-game-menu] [role="tab"], [data-ltm-menu] button, [data-lto-menu] [data-lto-menu-item], .lt-app-actions button, [data-lts] button, [data-lto-hero] button, [data-lto-screen] button, [data-lto-loot] button')]
        .filter((t) => t.w > 0)
        .map((t) => ({ sel: t.sel, w: t.w, h: t.h, text: t.text })),
      toasts: document.querySelectorAll(".lto-toast, [data-lto-toast], [data-lto-toasts]").length,
    };
  });
}

const overlap = (a, b) => !!a && !!b && a.x < b.r - 0.5 && a.r > b.x + 0.5 && a.y < b.b - 0.5 && a.b > b.y + 0.5;

/**
 * Check the page fits and return a list of what does not. `story` says a story screen is up (it may cover the hero); `touch` that fingers
 * are the pointer (targets must be 44 px).
 */
export async function fitProblems(page, { story = false, touch = false, vertical = true } = {}) {
  const m = await measure(page);
  const bad = [];
  // The side panel stacks under the board on a page 720 px wide or narrower and on an upright one (stageFit.ts stackedAt).
  const stacked = m.W <= 720 || m.H >= m.W * 1.2;
  if (m.scrollW > m.W + 1) bad.push(`the page scrolls sideways (${m.scrollW} > ${m.W})`);
  // On a narrow page the side panel stacks under the board and the page scrolls up and down by design; only a wide page must fit its height.
  if (vertical && !stacked && m.scrollH > m.H + 1) bad.push(`the page scrolls up and down (${m.scrollH} > ${m.H})`);
  for (const l of m.layers) {
    // The page's own scrolling holds the side panel under the board on a narrow page, so the arena and the panel may run past the bottom there.
    const scrolls = stacked && (l.sel === ".lt-arena" || l.sel === "[data-lto-hud]");
    if (l.x < -1 || l.y < -1 || l.r > m.W + 1 || (!scrolls && l.b > m.H + 1)) bad.push(`${l.sel} is cut off by the window: ${Math.round(l.x)},${Math.round(l.y)} to ${Math.round(l.r)},${Math.round(l.b)} in ${m.W}x${m.H}`);
  }
  if (!story && m.heroRect) {
    for (const o of m.overlays) if (overlap(o, m.heroRect)) bad.push(`${o.sel} covers the hero (${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}x${Math.round(o.h)} over ${Math.round(m.heroRect.x)},${Math.round(m.heroRect.y)})`);
  }
  if (touch) {
    for (const t of m.targets) if (Math.min(t.w, t.h) < 43.5) bad.push(`target "${t.text}" is ${Math.round(t.w)}x${Math.round(t.h)}: too small for a finger`);
  }
  if (m.toasts > 0) bad.push("a notice strip is on the page");
  return bad;
}

/** Whether the board canvas is painted (not blank), as a sanity check that a screen was really drawn. */
async function boardPainted(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.ltt-canvas");
    if (!c) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 64) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return seen.size > 8;
  });
}

/** The size of the board and of the room the stage gives it, to say the board fills its window (item 3). */
export async function boardFill(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.ltt-canvas")?.getBoundingClientRect();
    const s = document.querySelector(".lt-stage-wrap")?.getBoundingClientRect();
    if (!c || !s) return null;
    return { board: { w: c.width, h: c.height }, stage: { w: s.width, h: s.height }, ratio: Math.max(c.width / s.width, c.height / s.height) };
  });
}

/**
 * Run the tour. `opts`: { width, height, touch, shots (a directory, or null for no screenshots), checks (the item assertions on or off) }.
 * Returns the problems it found as a list of "step: what" strings (an empty list is a clean tour).
 */
export async function tour(newGame, opts) {
  const { width, height, touch = false, shots = null, items = false, assert } = opts;
  const size = `${width}x${height}`;
  const found = [];
  const note = (step, list) => {
    for (const s of list) found.push(`${size} ${step}: ${s}`);
  };
  const server = { art: true };
  const shotDir = shots ? path.resolve(shots) : null;
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

  // ---- the loading screen: the platform answers slowly, so the splash is up long enough to look at
  {
    const slow = await newGame({ server, viewport: { width, height }, latencyMs: 2500, ...(touch ? { hasTouch: true } : {}) });
    try {
      await slow.page.locator("[data-splash]").waitFor({ state: "visible", timeout: 5000 });
      note("splash", await fitProblems(slow.page, { touch }));
      if (shotDir) await slow.page.screenshot({ path: path.join(shotDir, `bb-splash-${size}.png`) });
    } catch (e) {
      note("splash", [String(e.message).split("\n")[0]]);
    }
    await slow.close();
  }

  const g = await newGame({ server, script: tourScript(), extraInit: PIN_DICE, viewport: { width, height }, ...(touch ? { hasTouch: true } : {}) });
  const d = g.driver;
  const page = g.page;
  const shot = async (step) => {
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `bb-${step}-${size}.png`) });
  };
  /** Check the page fits, and take the picture. */
  const check = async (step, o = {}) => {
    if (process.env.LT_TRACE) console.log(`  [${size}] ${step}`);
    note(step, await fitProblems(page, { touch, ...o }));
    await shot(step);
  };

  // ---- the main menu
  await d.ready();
  await page.locator('[data-ltm-menu="main"]').waitFor({ timeout: T });
  await page.locator("[data-splash]").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await check("main-menu");
  if (items) {
    assert.equal(await page.locator('[data-ltm-act="continue"]').isDisabled(), true, "a first visit has nothing to continue");
    for (const act of ["new", "load", "settings", "credits"]) assert.equal(await page.locator(`[data-ltm-act="${act}"]`).count(), 1, `the main menu has ${act}`);
  }
  await page.locator('[data-ltm-act="credits"]').click();
  await page.waitForTimeout(300);
  await check("credits");
  await page.keyboard.press("Escape");
  await page.locator('[data-ltm-act="settings"]').click();
  await page.locator("[data-game-menu]").waitFor({ timeout: T });
  await check("main-settings");
  await d.closeMenu();
  await page.locator('[data-ltm-act="load"]').click();
  await page.locator("[data-game-menu]").waitFor({ timeout: T });
  await check("main-load");
  await d.closeMenu();

  // ---- the adventure list, the hero choice, the character maker
  await d.toAdventureList();
  await page.waitForTimeout(300);
  await check("adventures");
  if (items) assert.ok((await page.locator("[data-lto-room]").count()) === 2, "the two test rooms show on a local page");
  await page.locator('[data-lto-adventure="rat-cellar"]').click();
  await page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: T });
  await page.waitForTimeout(300);
  await check("hero-choice");
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
  await check("hero-choice-last");
  await page.locator("[data-lto-create]").click();
  await page.locator('[data-lts="creation"]').waitFor({ timeout: T });
  await page.waitForTimeout(300);
  await check("maker-name");
  if (items) assert.equal(await page.locator('[data-lts-act="begin"]').isDisabled(), true, "the maker waits for a name");
  await page.locator('[data-lts-field="Name"]').fill("Mira");
  await page.locator('[data-lts-act="next"]').click();
  await page.waitForTimeout(300);
  await check("maker-class");
  // Back out to the hero choice and play the Knight.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if ((await page.locator('[data-lto-quick="fighter"]').count()) === 0) {
    await d.toAdventureList();
    await page.locator('[data-lto-adventure="rat-cellar"]').click();
    await page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: T });
  }
  await d.playAs("fighter", "Mira");

  // ---- the story screen on arrival: it holds the world, and the normal DM box stays away
  await page.locator("[data-lto-story]:not([hidden])").waitFor({ timeout: T });
  await page.waitForTimeout(1200);
  await check("story", { story: true });
  if (items) {
    assert.equal(await page.locator("[data-lto-dialogue]").isVisible(), false, "the DM box is out of sight while the story is up");
    const before = await heroTile(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(400);
    assert.deepEqual(await heroTile(page), before, "the world is locked while the story is up");
    assert.equal(await page.locator("[data-lto-story]:not([hidden])").count(), 1, "keys do not read the story for the player");
  }
  await readStory(g);
  await d.dismissDialogue().catch(() => {});
  await page.waitForTimeout(400);
  await check("home");
  if (items) {
    const fill = await boardFill(page);
    assert.ok(fill && fill.ratio >= 0.8, `the board fills its window (${JSON.stringify(fill)})`);
    assert.ok(await boardPainted(page), "the board is painted");
  }

  // ---- left click walks only, right click opens the menu with its text line
  const start = await heroTile(page);
  await leftClickTile(page, start.x + 2, start.y + 1);
  await waitUntil(async () => {
    const h = await heroTile(page);
    return h.x !== start.x || h.y !== start.y;
  }, 8000, "the hero to walk on a left click");
  await d.settle(500, 15000);
  if (items) assert.equal(g.platform.calls.length, 0, "walking asks nothing of the DM");
  const me = await heroTile(page);
  await rightClickTile(page, me.x - 1 < 0 ? me.x + 1 : me.x - 1, me.y);
  const menu = await readMenu(page);
  await check("context-menu");
  if (items) {
    assert.ok(menuRow(menu, "ask"), `the actions menu ends in the text line (${menu.rows.map((r) => r.id).join(", ")})`);
    assert.doesNotMatch(menu.text, /Anyone can/, "no 'Anyone can'");
    assert.ok(menuRow(menu, "look"), "Look closer is on the menu");
  }

  // ---- a DM answer in the normal box: it never covers the hero
  const input = page.locator("input[data-lto-cm-input]");
  await input.fill("I look at the walls");
  await input.press("Enter");
  await g.platform.waitForCalls(1);
  const said = await d.waitDialogue((x) => /cobwebs/.test(x.text), 25000);
  if (items) assert.equal(said.speaker, "DM");
  await page.waitForTimeout(500);
  await check("dm-answer");
  if (items) assert.equal(await page.locator("[data-lto-toast], .lto-toast").count(), 0, "no pop-up strip");
  await d.dismissDialogue();

  // ---- a refusal is said by the DM box (nothing to use here)
  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  await check("refusal");
  if (items) assert.equal(await page.locator(".lto-toast, [data-lto-toast]").count(), 0, "a refusal is not a strip across the board");
  await d.dismissDialogue().catch(() => {});

  // ---- the game menu: six tabs
  await d.openMenu("character");
  if (items) assert.deepEqual((await d.menuTabs()).map((t) => t.id), ["character", "inventory", "journal", "log", "saves", "settings"], "one menu, six tabs");
  for (const tab of ["character", "inventory", "journal", "log", "saves", "settings"]) {
    await d.openMenu(tab);
    await page.waitForTimeout(250);
    await check(`menu-${tab}`);
  }
  if (items) {
    await d.openMenu("inventory");
    assert.ok((await page.locator("[data-game-menu] canvas").count()) > 0, "the inventory draws the paper doll");
    assert.equal(await page.locator("[data-game-menu]").getByText(/New character/i).count(), 0, "no New character in the game");
  }
  await d.setSetting("rollMyself", "true");

  // ---- on to the cellar (the roll is the player's: the tray is on show)
  const calls = await homeToCellar(g);
  if (items) assert.equal(calls, 2, "Tobin and Marta are two asks");
  await page.waitForTimeout(800);
  const tray = page.locator('[data-ltd-root][data-state="waiting"]');
  await tray.waitFor({ timeout: 20000 });
  await check("initiative-tray");
  await page.locator("[data-ltd-root]").click({ force: true });
  await page.waitForTimeout(1500);
  await check("fight-start");
  await d.setSetting("rollMyself", "false");
  await check("fight");

  // ---- the rats die and a body is searched and harvested: the hero swings on every turn (the dice are pinned high on the hero's turn and low
  // on a creature's, so the hero always hits and the rats always miss), and the turn is ended by hand when it is not over by itself. The
  // side panel is condensed on a phone, so only its title tells whose turn it is.
  const t0 = Date.now();
  for (let i = 0; i < 400 && Date.now() - t0 < 240000; i += 1) {
    const hud = await d.readout();
    if (!/Round \d/.test(hud) && i > 2) break;
    const mine = /your turn/.test(hud);
    await pin(page, mine ? 0.97 : 0.0);
    if (mine) {
      await page.keyboard.press("f");
      await page.waitForTimeout(900);
      if (/your turn/.test(await d.readout())) await page.keyboard.press("t");
    }
    await page.waitForTimeout(700);
  }
  await pin(page, 0.0);
  await waitUntil(async () => !/Round \d/.test(await d.readout()), 40000, "the fight to end");
  await d.dismissDialogue().catch(() => {});
  await d.settle(600, 8000);
  await check("fight-won");

  // A giant rat's body: the menu offers Search and Harvest. (The pelt is the engine's, so no DM call.)
  const here = await heroTile(page);
  let bodyAt = null;
  for (let r = 1; r <= 6 && !bodyAt; r += 1) {
    for (let dx = -r; dx <= r && !bodyAt; dx += 1) {
      for (let dy = -r; dy <= r && !bodyAt; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = here.x + dx;
        const y = here.y + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        try {
          await rightClickTile(page, x, y);
        } catch {
          await page.keyboard.press("Escape");
          continue;
        }
        const m = await readMenu(page);
        if (menuRow(m, "harvest")) bodyAt = { x, y, menu: m };
        else {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(80);
        }
      }
    }
  }
  if (!bodyAt) note("body", ["no creature body with a Harvest line was found near the hero"]);
  else {
    await check("body-menu");
    await page.keyboard.press("Escape");
    // A body lies where it fell: its square on the board is drawn (not bare floor).
    if (items) assert.ok(menuRow(bodyAt.menu, "loot"), "the body can be searched");
    await rightClickTile(page, bodyAt.x, bodyAt.y);
    await pin(page, 0.97);
    await clickRow(page, "harvest");
    await d.waitDialogue((x) => /pelt|nothing to take|spoil/i.test(x.text), 30000);
    await pin(page, null);
    await check("harvest");
    await d.dismissDialogue().catch(() => {});
    await d.settle(500, 10000);
    // Search the other giant rat: the loot window.
    const second = bodyAt;
    await rightClickTile(page, second.x, second.y).catch(() => {});
    await page.keyboard.press("Escape");
    await d.openMenu("inventory");
    await page.waitForTimeout(250);
    await check("inventory-after");
    if (items) assert.match(await d.hudText(), /pelt/i, "the pelt is in the pack");
    await d.closeMenu();
  }

  // ---- a question taken back: Cancel stands beside the DM's dots
  const cancel = page.locator("[data-lto-dialogue] [data-lto-cancel]");
  // The table must be free to be asked: no fight on, no box up. (A giant rat may have woken.)
  await d.dismissDialogue().catch(() => {});
  await waitUntil(async () => !/Round \d/.test(await d.readout()), 40000, "the table to be free");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await d.ask("I listen at the door");
      await cancel.waitFor({ state: "visible", timeout: 6000 });
      break;
    } catch (e) {
      if (attempt >= 2) {
        const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 240));
        throw new Error(`the held ask never showed Cancel (calls ${g.platform.calls.length}): ${String(e.message).split("\n")[0]} | page: ${seen}`);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  }
  await check("dm-waiting");
  if (items) assert.doesNotMatch(await d.text(), /(?<!Licence and )credit|\brefund|\bprice/i, "the waiting state states no price");
  const asked = g.platform.calls.length;
  await cancel.click();
  await page.waitForFunction(() => !document.querySelector("[data-lto-dialogue]:not([hidden]) [data-lto-cancel]"), null, { timeout: 4000 });
  if (items) assert.equal(g.platform.calls.length, asked, "Cancel makes no new call and the call made is still spent");
  g.platform.release();
  await page.waitForTimeout(500);

  // ---- full screen
  const full = page.locator(".lt-app-full");
  await full.click();
  try {
    await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5000 });
    await page.waitForTimeout(700);
    await check("fullscreen");
    if (items) {
      const fill = await boardFill(page);
      assert.ok(fill && fill.ratio >= 0.8, `full screen: the board fills the stage (${JSON.stringify(fill)})`);
    }
    await full.click();
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 5000 });
  } catch (e) {
    note("fullscreen", [String(e.message).split("\n")[0]]);
  }
  note("clean", g.problems().map((p) => `page problem: ${p}`));
  return found;
}
