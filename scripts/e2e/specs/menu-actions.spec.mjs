// The right-click menu (a long press on a touch screen) and everything it does: the plain small lines under each entry, walking up to a
// thing before looking at it, Talk that starts the talk by itself, the text line that replaces the old "What do you do?" box, and Harvest.
//
// The Rat Cellar's first place is "Your Home", a 20 x 15 board: the hero starts at (3,3); the bed is at (1,1) and (1,2); a wall at x = 7 splits the
// bedroom from the workshop, with an open doorway at (7,7); Tobin Hale stands at (14,6). Tiles below are those board coordinates.
import { dmReply, dmScript } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };
const T = 15000;
/** The context menu itself (the HUD's Main menu button also carries data-lto-menu, so the role picks the right one). */
const MENU = '[data-lto-menu][role="menu"]';
const COLS = 20;
const ROWS = 15;

// ---- the board and the menu, as a player uses them -------------------------------------------------------

/** The screen point at the middle of a board tile. */
async function tilePoint(page, x, y) {
  const box = await page.locator("canvas.ltt-canvas").boundingBox();
  if (!box) throw new Error("no board on the page");
  return { x: box.x + ((x + 0.5) * box.width) / COLS, y: box.y + ((y + 0.5) * box.height) / ROWS };
}

async function rightClickTile(page, x, y) {
  const p = await tilePoint(page, x, y);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.locator(MENU).waitFor({ timeout: T });
  // The menu ignores presses for a moment after it opens (a finger lifting after a long press).
  await page.waitForTimeout(350);
}

async function leftClickTile(page, x, y) {
  const p = await tilePoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** What the open menu shows: its title, each line's id, spoken label, whether it is on offer, and how tall its small lines are drawn. */
async function readMenu(page) {
  return page.evaluate((sel) => {
    const m = document.querySelector(sel);
    if (!m) return null;
    const h = (sel) => [...m.querySelectorAll(sel)].map((n) => n.getBoundingClientRect().height);
    return {
      title: m.getAttribute("aria-label") ?? "",
      text: m.innerText.replace(/\s+/g, " "),
      rows: [...m.querySelectorAll("[data-lto-menu-item]")].map((r) => ({
        id: r.dataset.ltoMenuItem,
        label: r.getAttribute("aria-label") ?? "",
        enabled: r.dataset.enabled === "true",
        height: r.getBoundingClientRect().height,
      })),
      whyCanvasHeights: h(".lto-cm-why canvas"),
      labelCanvasHeights: h(".lto-cm-label canvas"),
      whyFontPx: [...m.querySelectorAll(".lto-cm-why")].map((n) => parseFloat(getComputedStyle(n).fontSize)),
      labelFontPx: [...m.querySelectorAll(".lto-cm-label")].map((n) => parseFloat(getComputedStyle(n).fontSize)),
      box: (() => {
        const r = m.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      })(),
      focusIsInput: document.activeElement?.matches?.("input[data-lto-cm-input]") ?? false,
    };
  }, MENU);
}

const row = (menu, id) => menu.rows.find((r) => r.id === id);

async function clickRow(page, id) {
  await page.locator(`${MENU} [data-lto-menu-item="${id}"]`).click({ timeout: T });
}

async function waitUntil(fn, ms = 12000, what = "the condition") {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Pin the dice: Math.random answers `value` until it is set back to null (a d20 of floor(value * 20) + 1). */
const PIN_DICE = "(() => { const real = Math.random.bind(Math); window.__pin = null; Math.random = () => (window.__pin === null ? real() : window.__pin); })();";
const pin = (page, value) => page.evaluate((v) => { window.__pin = v; }, value);

/** Through the bedroom doorway into the workshop, where Tobin is: a left click only walks, and only to a square the hero has seen. */
async function intoWorkshop(page, d) {
  await leftClickTile(page, 7, 7);
  await d.settle(700, 20000);
  await leftClickTile(page, 10, 7);
  await d.settle(700, 20000);
}

async function startRatCellar(g) {
  const d = g.driver;
  await d.ready();
  await d.quickStart();
  await d.dismissDialogue();
  await d.settle();
  return d;
}

export const specs = [
  {
    name: "menu: the small lines under an entry are plain numbers, drawn at the label's size in both text styles, and never say 'Anyone can'",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = await startRatCellar(g);
      for (const style of ["pixel", "storybook"]) {
        await d.setSetting("textStyle", style);
        await d.closeMenu();
        await rightClickTile(g.page, 4, 6);
        const m = await readMenu(g.page);
        assert.ok(m, `the menu opened (${style})`);
        const ids = m.rows.map((r) => r.id);
        for (const want of ["look", "search", "hide", "sneak", "ask"]) assert.ok(ids.includes(want), `${style}: the floor menu has ${want} (${ids.join(", ")})`);
        for (const r of m.rows) assert.doesNotMatch(r.label, /Anyone can|passive Perception|Cunning/i, `${style}: ${r.id}: ${r.label}`);
        assert.doesNotMatch(m.text, /Anyone can/i, `${style}: no menu text says "Anyone can"`);
        assert.equal(row(m, "look").label, "Look closer", `${style}: Look closer has no line under it`);
        assert.match(row(m, "hide").label, /^Hide, Stealth [+-]\d+$/, `${style}: Hide shows its plain number`);
        assert.match(row(m, "search").label, /^Search, (Perception|Investigation) [+-]\d+/, `${style}: Search shows its plain number`);
        if (style === "pixel") {
          assert.ok(m.whyCanvasHeights.length >= 3, "the small lines are drawn");
          for (const h of m.whyCanvasHeights) assert.ok(h >= 16, `a small line is drawn at least 16 px tall (got ${h})`);
          assert.ok(Math.min(...m.whyCanvasHeights) >= Math.min(...m.labelCanvasHeights) - 1, "as tall as the labels");
        } else {
          for (const px of m.whyFontPx) assert.ok(px >= 14, `a small line is at least 14 px (got ${px})`);
          assert.ok(m.labelFontPx.every((px) => px >= 14));
        }
        await g.page.keyboard.press("Escape");
        await g.page.locator(MENU).waitFor({ state: "detached", timeout: T });
      }
      // The bed in the owner's screenshot: one line, and nothing under it.
      await rightClickTile(g.page, 1, 1);
      const bed = await readMenu(g.page);
      assert.equal(bed.rows[0].id, "look");
      assert.doesNotMatch(bed.text, /Anyone can/i);
      assert.equal(g.platform.calls.length, 0, "opening a menu never calls the model");
    },
  },

  {
    name: "menu: Look closer on a far thing walks the hero to it first, and only then asks the DM (one call, not at the click)",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(dmReply({ narration: "The bed is neatly made, the pillow still dented from a good night's sleep." })) });
      const d = await startRatCellar(g);
      const still = await d.boardHash();
      await rightClickTile(g.page, 1, 1);
      const m = await readMenu(g.page);
      assert.match(row(m, "look").label, /Walks \d+ ft first/, `the menu says it walks first (${row(m, "look").label})`);
      assert.equal(row(m, "look").enabled, true);
      await clickRow(g.page, "look");
      assert.equal(g.platform.calls.length, 0, "no AI call at the click");
      await waitUntil(async () => (await d.boardHash()) !== still, 8000, "the hero to start walking");
      await g.platform.waitForCalls(1);
      await d.settle();
      assert.equal(g.platform.calls.length, 1, "exactly one call, after arriving");
      assert.match(g.platform.calls[0].messages.map((x) => x.content).join("\n"), /bed/i, "the DM is told which thing was looked at");
      const said = await d.waitDialogue((x) => /neatly made/.test(x.text));
      assert.equal(said.speaker, "DM");
    },
  },

  {
    name: "menu: Talk starts the talk by itself (no Do it), in the person's name, and the story hears of it",
    async run({ newGame, assert }) {
      const reply = (call) => {
        const said = call.messages.map((x) => x.content).join("\n");
        return /I talk to Tobin Hale/.test(said)
          ? { ...dmReply({ narration: "Tobin looks up from his bench and grunts. Good morning, then. Mind the cellar." }), speaker: "Tobin Hale", talkedTo: "tobin" }
          : dmReply();
      };
      const g = await newGame({ server: WITH_SERVER, script: dmScript(reply) });
      const d = await startRatCellar(g);
      // Into the workshop: a left click only walks.
      await intoWorkshop(g.page, d);
      assert.equal(g.platform.calls.length, 0, "walking costs nothing");
      await rightClickTile(g.page, 14, 6);
      const m = await readMenu(g.page);
      assert.ok(row(m, "talk")?.enabled, `Talk is on offer (${m.rows.map((r) => r.id).join(", ")})`);
      assert.match(m.title, /Tobin|Villager/i);
      assert.ok(row(m, "ask"), "and so is the text line");
      await clickRow(g.page, "talk");
      await g.platform.waitForCalls(1);
      assert.equal(g.platform.calls.length, 1, "one click on Talk is one call");
      assert.equal(await g.page.locator("input.lto-hud-input").count(), 0, "there is no ask box to fill");
      assert.equal(await g.page.getByRole("button", { name: /^Do it$/ }).count(), 0, "and no Do it button");
      assert.match(g.platform.calls[0].messages.map((x) => x.content).join("\n"), /I talk to Tobin Hale/, "the DM is told the talk");
      const said = await d.waitDialogue((x) => x.speaker === "Tobin Hale" && /Mind the cellar/.test(x.text));
      assert.equal(said.speaker, "Tobin Hale");
      await d.dismissDialogue();
      // The story heard it: the front door is no longer held shut, so walking out of it leaves for the village.
      await leftClickTile(g.page, 13, 14);
      await waitUntil(async () => /Wick End Square/.test(await d.text()), 25000, "the village after the front door");
      assert.equal(g.platform.calls.length, 1, "walking out spent nothing more");
    },
  },

  {
    name: "menu: the last line is a text box that replaces 'What do you do?': Space types, Enter sends one call that names the square, Esc closes",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(dmReply({ narration: "You rap on the boards. They answer with a dull, honest thud." })) });
      const d = await startRatCellar(g);
      assert.equal(await g.page.locator("input.lto-hud-input").count(), 0, "no ask box in the side panel");
      assert.equal(await g.page.getByRole("button", { name: /^Do it$/ }).count(), 0, "no Do it button");
      await rightClickTile(g.page, 4, 6);
      const input = g.page.locator("input[data-lto-cm-input]");
      assert.equal(await input.count(), 1, "the menu ends with a text line");
      assert.equal(await input.getAttribute("placeholder"), "Do something here");
      assert.equal(await g.page.locator("button[data-lto-cm-send]").count(), 1, "with a Send button");
      // Typing: Space is a space and does not pick a line; the menu stays open.
      await input.click();
      await g.page.keyboard.type("I rap on the boards");
      assert.equal(await input.inputValue(), "I rap on the boards", "Space typed a space");
      assert.equal(g.platform.calls.length, 0, "typing sent nothing");
      assert.ok(await g.page.locator(MENU).count(), "the menu is still open");
      // Tab walks to Send, it does not close the menu.
      await g.page.keyboard.press("Tab");
      assert.ok(await g.page.locator(MENU).count(), "Tab leaves the menu open");
      await input.click();
      // Esc closes it, and nothing is sent.
      await g.page.keyboard.press("Escape");
      await g.page.locator(MENU).waitFor({ state: "detached", timeout: T });
      assert.equal(g.platform.calls.length, 0, "Esc sent nothing");
      // Again, and send with Enter.
      await rightClickTile(g.page, 4, 6);
      await input.click();
      await g.page.keyboard.type("I rap on the boards twice");
      await g.page.keyboard.press("Enter");
      await g.platform.waitForCalls(1);
      await g.page.locator(MENU).waitFor({ state: "detached", timeout: T });
      await d.settle();
      assert.equal(g.platform.calls.length, 1, "Enter sends exactly one ask");
      const brief = g.platform.calls[0].messages.map((x) => x.content).join("\n") + g.platform.calls[0].system;
      assert.match(brief, /I rap on the boards twice/, "the words reach the DM");
      assert.match(brief, /floor/i, "and so does what was clicked");
      await d.waitDialogue((x) => /dull, honest thud/.test(x.text));
    },
  },

  {
    name: "menu: right-click a person and the text line is for them; the Send button sends too",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript((call) => (/Tobin Hale/.test(call.messages.map((x) => x.content).join("\n")) ? { ...dmReply({ narration: "Dry as ever: I would, if I were you." }), speaker: "Tobin Hale", talkedTo: "tobin" } : dmReply())) });
      const d = await startRatCellar(g);
      await intoWorkshop(g.page, d);
      await rightClickTile(g.page, 14, 6);
      const input = g.page.locator("input[data-lto-cm-input]");
      assert.equal(await input.getAttribute("placeholder"), "Say something to Tobin Hale");
      await input.fill("Should I take the job at the Kettle?");
      await g.page.locator("button[data-lto-cm-send]").click();
      await g.platform.waitForCalls(1);
      const brief = g.platform.calls[0].messages.map((x) => x.content).join("\n") + g.platform.calls[0].system;
      assert.match(brief, /Should I take the job/);
      assert.match(brief, /Tobin Hale/, "the ask names the person it is for");
      assert.equal(g.platform.calls.length, 1);
      await d.waitDialogue((x) => x.speaker === "Tobin Hale");
    },
  },

  {
    name: "menu: on a 320 px touch screen the menu fits, its lines are 44 px tall, and the text line does not grab the keyboard",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
      const d = await startRatCellar(g);
      await rightClickTile(g.page, 4, 6);
      const m = await readMenu(g.page);
      assert.ok(m.box.left >= 0 && m.box.right <= 320, `the menu is inside the screen (${m.box.left} to ${m.box.right})`);
      assert.ok(m.box.top >= 0 && m.box.bottom <= 640, `and inside it vertically (${m.box.top} to ${m.box.bottom})`);
      for (const r of m.rows.filter((x) => x.id !== "ask")) assert.ok(r.height >= 44, `${r.id} is at least 44 px tall (${r.height})`);
      assert.equal(m.focusIsInput, false, "nothing opened the keyboard");
      assert.equal(await d.scrollsSideways(), false, "the page does not scroll sideways");
      const ask = await g.page.locator("input[data-lto-cm-input]").boundingBox();
      assert.ok(ask && ask.height >= 44, "the text line is at least 44 px tall");
    },
  },

  {
    name: "menu: Harvest on a rat's body walks up, rolls Survival, and a pelt lands in the pack; a failed roll spoils the carcass and offers no second try",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), extraInit: PIN_DICE });
      const d = await startRatCellar(g);
      // Two rat bodies lie in the bedroom: they are put in every server copy of the game, which is reloaded, as if the rats had been killed there.
      await d.rest();
      await d.dismissDialogue().catch(() => {});
      const body = (id, x, y) => ({ id, name: "Rat", at: { x, y }, items: [], looted: false, harvested: false, beast: true, engineLootRolled: true, token: "token_rat" });
      // Every copy of the game on the server has them, so Continue finds them whichever copy it opens.
      for (const save of g.platform.saves.values()) save.payload.data.bodies = [body("rat_body_1", 4, 5), body("rat_body_2", 5, 6)];
      // The device forgets what it kept, so the game comes back from the server copies and nothing else.
      await g.page.evaluate(() => {
        try {
          localStorage.clear();
        } catch {
          /* blocked */
        }
      });
      await g.page.reload({ waitUntil: "load" });
      await d.ready();
      await d.continueGame();
      await d.settle();
      // The tray rolls for the player; the pinned dice decide.
      await d.setSetting("rollMyself", "false");
      await d.closeMenu();
      // The first rat: a high roll.
      await rightClickTile(g.page, 4, 5);
      let m = await readMenu(g.page);
      assert.match(m.title, /rat/i);
      assert.ok(row(m, "harvest"), `Harvest is on the rat's menu (${m.rows.map((r) => r.id).join(", ")})`);
      assert.match(row(m, "harvest").label, /Survival [+-]\d+/);
      assert.ok(row(m, "harvest").enabled, "and it can be done (the hero walks up first)");
      await pin(g.page, 0.97);
      await clickRow(g.page, "harvest");
      const said = await d.waitDialogue((x) => /rat pelt/i.test(x.text), 20000);
      assert.match(said.text, /keep the rat pelt/i);
      await pin(g.page, null);
      await d.dismissDialogue();
      await d.openDrawer("pack");
      assert.match(await d.hudText(), /Rat pelt/, "the pelt is in the pack");
      await d.closeDrawer("pack");
      // Harvested once: the line is gone from that body.
      await rightClickTile(g.page, 4, 5);
      m = await readMenu(g.page);
      assert.ok(!row(m, "harvest"), "no second Harvest on the same body");
      await g.page.keyboard.press("Escape");
      // The second rat: a low roll spoils it.
      await rightClickTile(g.page, 5, 6);
      m = await readMenu(g.page);
      assert.ok(row(m, "harvest"));
      await pin(g.page, 0.0);
      await clickRow(g.page, "harvest");
      const spoiled = await d.waitDialogue((x) => /spoil/i.test(x.text), 20000);
      assert.match(spoiled.text, /nothing to take/i);
      await pin(g.page, null);
      await d.dismissDialogue();
      await rightClickTile(g.page, 5, 6);
      m = await readMenu(g.page);
      assert.ok(!row(m, "harvest"), "a spoiled carcass cannot be tried again");
      assert.equal(g.platform.calls.length, 0, "harvesting is the engine's, never the DM's");
      await d.openDrawer("pack");
      assert.equal((await d.hudText()).match(/Rat pelt/g)?.length ?? 0, 1, "only the one pelt");
    },
  },
];

// ---- the test room: a closed door, a chest, a goblin asleep in the east room (the hero starts at (4,7); the door is at (11,7)) -------------------

async function heroTile(page) {
  const [rect, box] = await Promise.all([page.locator("[data-lt-hero-rect]").first().getAttribute("data-lt-hero-rect"), page.locator("canvas.ltt-canvas").boundingBox()]);
  const [x, y, w, h] = String(rect).split(",").map(Number);
  return { x: Math.round((x - box.x) / w), y: Math.round((y - box.y) / h) };
}

async function startRoom(g) {
  await g.driver.ready();
  await g.driver.toAdventureList();
  await g.page.locator("[data-lto-room]").first().click({ timeout: T });
  await g.page.locator("canvas.ltt-canvas").waitFor({ timeout: T });
  await g.page.locator("[data-lt-hero-rect]").first().waitFor({ state: "attached", timeout: T });
  await g.page.waitForTimeout(500);
}

/** Tap through whatever is playing (dice, the dialogue box) until it is the hero's turn. */
async function untilMyTurn(g, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hud = await g.driver.hudText();
    if (/your turn/i.test(hud) && !/Tap to roll/i.test(hud)) return hud;
    await g.page.keyboard.press("Space");
    await g.page.locator(".lt-dice-host").click({ timeout: 1500, force: true }).catch(() => {});
    await g.page.waitForTimeout(350);
  }
  throw new Error(`it never became the hero's turn: ${await g.driver.hudText()}`);
}

specs.push(
  {
    name: "menu: Open walks up to the door and opens it, then Attack swings at the goblin that comes for the hero",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: [], extraInit: "window.__rnd = 0.5; Math.random = () => window.__rnd;" });
      const d = g.driver;
      await startRoom(g);
      await d.setSetting("rollMyself", "false");
      await d.closeMenu();
      await rightClickTile(g.page, 11, 7);
      let m = await readMenu(g.page);
      assert.match(m.title, /door/i);
      assert.ok(row(m, "open")?.enabled, `Open is on the door's menu (${m.rows.map((r) => r.id).join(", ")})`);
      assert.match(row(m, "open").label, /Walks \d+ ft first/, "from across the room it says it walks first");
      await clickRow(g.page, "open");
      // Hands off while the hero walks up and opens it (Space would skip the walk); the goblin wakes and the fight begins on its own.
      await waitUntil(async () => /Goblin\s*\d+\/\d+/.test(await d.hudText()), 20000, "the door to open and the goblin to wake");
      assert.equal((await heroTile(g.page)).x, 10, "the hero stands beside the door");
      await untilMyTurn(g);
      assert.match(await d.hudText(), /Goblin\s*\d+\/\d+/, "the door is open and the goblin is awake");
      // Find the goblin beside the hero by what the menu calls it, then Attack it from the menu.
      const me = await heroTile(g.page);
      let found = null;
      for (const [dx, dy] of [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1], [-1, 0], [-1, 1], [-1, -1]]) {
        await rightClickTile(g.page, me.x + dx, me.y + dy);
        m = await readMenu(g.page);
        if (/goblin/i.test(m.title)) {
          found = { x: me.x + dx, y: me.y + dy };
          break;
        }
        await g.page.keyboard.press("Escape");
        await g.page.locator(MENU).waitFor({ state: "detached", timeout: T });
      }
      assert.ok(found, "the goblin stands beside the hero");
      const attack = row(m, "attack");
      assert.ok(attack?.enabled, `Attack is on its menu (${m.rows.map((r) => r.id).join(", ")})`);
      assert.match(attack.label, /^Attack, Longsword \+\d+, 1d8\+\d+/, "with the sword's own numbers");
      assert.doesNotMatch(await g.page.locator(MENU).innerText(), /Anyone can/);
      await clickRow(g.page, "attack");
      await waitUntil(async () => !/Goblin\s*7\/7/.test(await d.hudText()), 20000, "the swing to land (the goblin is hurt or gone)");
      assert.equal(g.platform.calls.length, 0, "an attack is the engine's, never a call to the model");
    },
  },

  {
    name: "menu: Drink a potion is on your own menu, and heals a hurt hero",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: [], extraInit: PIN_DICE });
      const d = g.driver;
      await startRoom(g);
      await d.rest();
      await d.dismissDialogue().catch(() => {});
      for (const save of g.platform.saves.values()) {
        save.payload.data.hero.currentHp = 3;
        save.payload.data.potions = Math.max(1, save.payload.data.potions ?? 0);
      }
      await g.page.evaluate(() => {
        try {
          localStorage.clear();
        } catch {
          /* blocked */
        }
      });
      await g.page.reload({ waitUntil: "load" });
      await d.ready();
      await d.continueGame();
      await d.settle();
      await d.setSetting("rollMyself", "false");
      await d.closeMenu();
      assert.match(await d.readout(), /3\s*\/\s*12/, "the hero is hurt");
      const me = await heroTile(g.page);
      await rightClickTile(g.page, me.x, me.y);
      const m = await readMenu(g.page);
      assert.ok(row(m, "drink-potion")?.enabled, `Drink a potion is on the hero's own menu (${m.rows.map((r) => r.id).join(", ")})`);
      assert.match(row(m, "drink-potion").label, /Heals 2d4\+2/);
      await clickRow(g.page, "drink-potion");
      await waitUntil(async () => {
        const hp = /(\d+)\s*\/\s*12/.exec(await d.readout());
        return hp && Number(hp[1]) > 3;
      }, 15000, "the potion to heal");
      assert.equal(g.platform.calls.length, 0);
    },
  },
);
