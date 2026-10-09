// The game menu and the side panel: one Menu opens inside the game space with Character, Inventory, Journal, Log, Saves and Settings; the
// side panel keeps Rest, End turn and Menu, and is cut down to a title and hit points on a phone; there is no ask box and no Attack, Use,
// Potion or Cancel button. Bug bash items 14, 13, 20, 21 and 27.
//
// The ConjureOS host is mocked as in table.spec.mjs. A spec also fails if its page logs a console error, raises a window error, asks for a
// non-local host, or makes an AI call it did not script.
import { dmScript } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };
const T = 15000;
const NO_PRICE = /(?<!Licence and )credit|\bcosts?\b.*\b\d|\b\d+\s*(credits?|coins?)\b/i;
const TAB_IDS = ["character", "inventory", "journal", "log", "saves", "settings"];
const TAB_LABELS = ["Character", "Inventory", "Journal", "Log", "Saves", "Settings"];

/** Start The Rat Cellar as the Knight, read the opening, and stand in the first room. */
async function inGame(newGame, o = {}) {
  const g = await newGame({ server: WITH_SERVER, script: dmScript(), ...o });
  const d = g.driver;
  await d.ready();
  await d.quickStart();
  await d.dismissDialogue();
  await d.settle(300);
  return { g, d };
}

/**
 * Give the hero a bag and worn pieces by editing the server's "current" save and reloading from it alone (the device forgets everything),
 * the way a game in progress with loot comes back.
 */
async function withGear(g, { bag, equipment }) {
  const d = g.driver;
  await d.rest();
  await d.dismissDialogue().catch(() => {});
  if (!g.platform.saves.has("current")) throw new Error("no current save to edit");
  // Every save of the game carries the gear, so whichever one the window comes back to (Continue loads the newest) has it.
  for (const row of g.platform.saves.values()) {
    const hero = row.payload?.data?.hero;
    if (!hero) continue;
    if (bag) hero.bag = bag;
    if (equipment) hero.equipment = equipment;
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
  await g.page.waitForTimeout(400);
}

/** The text of a stat's change chip in the Inventory tab, or "" when it shows none. */
async function deltaOf(g, stat) {
  const chip = g.page.locator(`[data-game-menu] [data-stat="${stat}"] [data-delta]`);
  if ((await chip.count()) === 0 || !(await chip.isVisible())) return "";
  // The visible number is the first text node; the rest is words kept for a screen reader.
  return (await chip.evaluate((n) => n.firstChild?.textContent ?? "")).trim();
}

export const specs = [
  {
    name: "the Menu opens inside the stage with six tabs in order, Escape closes it, and Sheet is gone from the side panel",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      // The story screen holds the world: the Menu button waits until it has been read.
      const menuBtn = g.page.locator('[data-lto-hud] button[data-action="menu"]');
      assert.equal(await menuBtn.isDisabled(), true, "the Menu button is off while a story screen is up");
      await d.dismissDialogue();
      await d.settle(300);
      assert.equal(await g.page.locator('[data-lto-hud] [data-action="sheet"]').count(), 0, "there is no Sheet button");
      assert.equal(await menuBtn.isEnabled(), true);
      await menuBtn.click();
      const menu = g.page.locator("[data-game-menu]");
      await menu.waitFor({ timeout: T });
      assert.deepEqual((await d.menuTabs()).map((t) => t.id), TAB_IDS, "six tabs, in order");
      assert.deepEqual((await d.menuTabs()).map((t) => t.label), TAB_LABELS, "named Character, Inventory, Journal, Log, Saves, Settings");
      assert.equal((await d.menuTabs())[0].selected, true, "the Menu opens on Character");
      // It opens in the game space: inside the stage, not over the page.
      const box = await menu.boundingBox();
      const stage = await g.page.locator(".lt-stage-wrap").boundingBox();
      assert.ok(box && stage, "both are on the page");
      assert.ok(box.x >= stage.x - 2 && box.y >= stage.y - 2 && box.x + box.width <= stage.x + stage.width + 2 && box.y + box.height <= stage.y + stage.height + 2, `the menu ${JSON.stringify(box)} is inside the stage ${JSON.stringify(stage)}`);
      for (const tab of TAB_IDS) {
        await d.openMenu(tab);
        assert.equal(await g.page.locator(`[data-game-menu] [data-menu-tab="${tab}"]`).getAttribute("aria-selected"), "true", `${tab} is the open tab`);
        assert.doesNotMatch(await d.menuText(), NO_PRICE, `the ${tab} tab states no price`);
      }
      await g.page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached", timeout: T });
      assert.equal(await d.menuIsOpen(), false, "Escape closes it");
      // The keys that opened the sheet, the pack, the journal and the log open it on their tabs, and press again to close.
      for (const [key, tab] of [["c", "character"], ["i", "inventory"], ["j", "journal"], ["l", "log"]]) {
        await g.page.keyboard.press(key);
        await menu.waitFor({ timeout: T });
        assert.equal(await g.page.locator(`[data-game-menu] [data-menu-tab="${tab}"]`).getAttribute("aria-selected"), "true", `${key} opens ${tab}`);
        await g.page.keyboard.press(key);
        await menu.waitFor({ state: "detached", timeout: T });
      }
      // Left and Right move between the tabs.
      await menuBtn.click();
      await menu.waitFor({ timeout: T });
      await g.page.locator('[data-game-menu] [data-menu-tab="character"]').focus();
      await g.page.keyboard.press("ArrowRight");
      assert.equal((await d.menuTabs()).findIndex((t) => t.selected), 1, "Right goes to Inventory");
      await g.page.keyboard.press("ArrowLeft");
      assert.equal((await d.menuTabs()).findIndex((t) => t.selected), 0, "Left goes back");
      assert.equal(g.platform.calls.length, 0, "opening a menu never calls the model");
    },
  },

  {
    name: "the game waits while the menu is open: the hero stays put and Rest is off, and it all works again once it closes",
    async run({ newGame, assert }) {
      const { g, d } = await inGame(newGame);
      const before = await d.heroRect();
      const hash = await d.settle(200);
      await d.openMenu("inventory");
      assert.equal(await g.page.locator('[data-lto-hud] button[data-action="rest"]').isDisabled(), true, "Rest is greyed while the menu is open");
      // A click on the game space lands on the menu, and the game keys are the menu's own.
      const stage = await g.page.locator(".lt-stage-wrap").boundingBox();
      await g.page.mouse.click(stage.x + stage.width * 0.7, stage.y + stage.height * 0.5);
      await g.page.keyboard.press("d");
      await g.page.waitForTimeout(300);
      const after = await d.heroRect();
      assert.deepEqual(after, before, "the hero did not move");
      await d.closeMenu();
      assert.equal(await g.page.locator('[data-lto-hud] button[data-action="rest"]').isEnabled(), true, "Rest is back");
      assert.equal(await d.settle(200), hash, "the board is as it was");
    },
  },

  {
    name: "the side panel has no ask box and no Attack, Use, Potion or Cancel button, and a question goes through the right click menu",
    async run({ newGame, assert }) {
      const { g, d } = await inGame(newGame);
      const hud = g.page.locator("[data-lto-hud]");
      assert.equal(await hud.locator("input").count(), 0, "no text field in the side panel");
      assert.equal(await hud.locator("[data-hud-ask], [data-hud-ask-send]").count(), 0, "no ask box");
      assert.doesNotMatch(await d.hudText(), /What do you do\?|Do it/, "nothing says what do you do");
      const gone = ["attack", "use", "potion", "cancel", "sheet"];
      const have = await hud.locator("button[data-action]").evaluateAll((n) => n.map((x) => x.dataset.action));
      for (const id of gone) assert.ok(!have.includes(id), `no ${id} button (${have.join(", ")})`);
      assert.ok(have.includes("menu"), "the Menu button is there");
      // While the DM thinks there is still no Cancel in the side panel (it lives in the DM's box).
      g.platform.script([{ match: () => true, reply: JSON.stringify({ narration: "Nothing.", cost: "free", effects: [], options: [] }), hold: true }]);
      const asked = d.ask("I listen at the door");
      await g.platform.waitForCalls(1);
      assert.equal(await hud.locator('button[data-action="cancel"]').count(), 0, "no Cancel in the side panel while the DM thinks");
      g.platform.release();
      await asked;
      await d.waitDialogue((x) => /Nothing/.test(x.text)).catch(() => {});
    },
  },

  {
    name: "Settings has End turn automatically, on by default, and the choice is kept",
    async run({ newGame, assert }) {
      const { g, d } = await inGame(newGame);
      await d.openMenu("settings");
      const pressed = await d.settingsPressed();
      assert.ok(pressed.includes("autoEndTurn:true"), `on by default (${pressed.join(", ")})`);
      await d.setSetting("autoEndTurn", "false");
      assert.ok((await d.settingsPressed()).includes("autoEndTurn:false"), "turned off");
      await d.closeMenu();
      await g.page.reload({ waitUntil: "load" });
      await d.ready();
      assert.ok((await d.settingsPressed()).includes("autoEndTurn:false"), "and kept across a reload");
    },
  },

  {
    name: "pointing at a bagged piece shows the stats as if it were worn: green and red changes, the engine's refusal in words, and nothing is changed by looking",
    async run({ newGame, assert }) {
      const { g, d } = await inGame(newGame);
      await withGear(g, { bag: [{ slot: "weapon", tier: "rare" }, { slot: "boots", tier: "rare" }] });
      await d.openMenu("inventory");
      const cell = g.page.locator('[data-game-menu] [data-bag-index="0"]');
      await cell.waitFor({ timeout: T });
      assert.equal(await g.page.locator("[data-game-menu] [data-bag-index]").count(), 2, "two pieces in the bag");
      assert.equal(await g.page.locator('[data-game-menu] [data-inv-bag] [data-empty="true"]').count(), 16, "sixteen empty places of the eighteen");
      const toHitBefore = await g.page.locator('[data-game-menu] [data-stat="toHit"] [data-stat-value]').innerText();
      assert.equal(await deltaOf(g, "toHit"), "", "no change shown before pointing");
      await cell.hover();
      assert.equal(await deltaOf(g, "toHit"), "+2", "a rare weapon is +2 to hit");
      assert.equal(await deltaOf(g, "damage"), "+2", "and +2 damage");
      assert.equal(await g.page.locator('[data-game-menu] [data-stat="toHit"] [data-delta]').getAttribute("data-tone"), "up", "better is marked up");
      assert.equal(await deltaOf(g, "ac"), "", "armour class does not move");
      assert.notEqual(await g.page.locator('[data-game-menu] [data-stat="toHit"] [data-stat-value]').innerText(), toHitBefore, "the to hit number shows the new value");
      assert.match(await g.page.locator("[data-game-menu] [data-inv-note]").innerText(), /to hit \+2/, "and says it in words");
      // Boots of Speed double the speed: a change the column shows too.
      await g.page.locator('[data-game-menu] [data-bag-index="1"]').hover();
      assert.match(await deltaOf(g, "speedFt"), /\+30/, "the boots add their speed");
      assert.equal(await deltaOf(g, "toHit"), "", "the weapon's change is gone");
      // Moving away puts the numbers back; nothing was equipped by looking.
      await g.page.locator('[data-game-menu] [data-inv-stats]').hover();
      assert.equal(await deltaOf(g, "toHit"), "", "no change once the pointer leaves");
      assert.equal(await g.page.locator('[data-game-menu] [data-slot="weapon"]').getAttribute("data-tier"), "common", "the weapon slot still holds the plain sword");
      assert.equal(await g.page.locator("[data-game-menu] [data-bag-index]").count(), 2, "and the bag is as it was");
      await g.screenshot("menu-inventory-1280");
      assert.equal(g.platform.calls.length, 0);
    },
  },

  {
    name: "with every attunement spot used a fourth piece shows the game's reason in words, and Equip is off",
    async run({ newGame, assert }) {
      const { g, d } = await inGame(newGame);
      await withGear(g, {
        bag: [{ slot: "boots", tier: "rare" }],
        equipment: { weapon: { slot: "weapon", tier: "legendary" }, ring: { slot: "ring", tier: "rare" }, amulet: { slot: "amulet", tier: "rare" } },
      });
      await d.openMenu("inventory");
      assert.match(await g.page.locator('[data-game-menu] [data-stat="attuned"] [data-stat-value]').innerText(), /3 of 3/, "three of three used");
      await g.page.locator('[data-game-menu] [data-bag-index="0"]').click();
      const note = g.page.locator("[data-game-menu] [data-inv-note]");
      assert.equal(await note.getAttribute("data-tone"), "bad");
      assert.match(await note.innerText(), /attun/i, `the reason names attunement (${await note.innerText()})`);
      assert.equal(await g.page.locator('[data-game-menu] [data-inv-act="equip"]').isDisabled(), true, "Equip is off");
    },
  },

  {
    name: "on a touch screen a tap selects and previews, and Equip puts the piece on: the doll and the slot change, the bag loses it",
    async run({ newGame, assert }) {
      const { g, d } = await inGame(newGame, { viewport: { width: 390, height: 844 }, hasTouch: true });
      await withGear(g, { bag: [{ slot: "weapon", tier: "rare" }] });
      await d.openMenu("inventory");
      const cell = g.page.locator('[data-game-menu] [data-bag-index="0"]');
      await cell.scrollIntoViewIfNeeded();
      await cell.tap();
      assert.equal(await deltaOf(g, "toHit"), "+2", "the first tap previews");
      assert.equal(await g.page.locator("#lt-card").isVisible().catch(() => false), false, "and does not pin the card yet");
      const equip = g.page.locator('[data-game-menu] [data-inv-act="equip"]');
      assert.equal(await equip.isEnabled(), true, "the Equip button is live");
      const box = await equip.boundingBox();
      assert.ok(box.height >= 44 && box.width >= 44, `the button is a fingertip (${box.width}x${box.height})`);
      await equip.tap();
      await g.page.waitForFunction(() => document.querySelector('[data-game-menu] [data-slot="weapon"]')?.getAttribute("data-tier") === "rare", null, { timeout: 5000 });
      assert.equal(await g.page.locator("[data-game-menu] [data-bag-index]").count(), 0, "the bag is empty again");
      assert.equal(g.platform.calls.length, 0, "equipping is free");
      await g.screenshot("menu-inventory-390");
    },
  },

  {
    name: "on a phone the side panel is a title and hit points, under about 100 px; beside the board it keeps every line",
    async run({ newGame, assert }) {
      const { g } = await inGame(newGame, { viewport: { width: 390, height: 844 }, hasTouch: true });
      const panel = g.page.locator("[data-lto-hud] .lto-hud-panel");
      assert.equal(await panel.getAttribute("data-condensed"), "true", "the panel is condensed at 390 wide");
      assert.equal(await panel.locator("[data-hud-lines]").count(), 0, "no location, hint or armour class lines");
      const box = await panel.boundingBox();
      assert.ok(box.height <= 104, `the panel is ${Math.round(box.height)} px tall`);
      assert.match(await panel.innerText(), /Mira\s+\d+\/\d+/, "the hero's name (the one typed in the maker) and hit points are there");
      await g.screenshot("hud-condensed-390");
      await g.page.setViewportSize({ width: 1280, height: 900 });
      await g.page.waitForTimeout(500);
      assert.equal(await panel.getAttribute("data-condensed"), null, "beside the board it is whole again");
      assert.ok((await panel.locator("[data-hud-lines]").count()) > 0, "with its lines");
      assert.match(await panel.innerText(), /AC \d+/);
    },
  },

  {
    name: "the menu fits a 320 px phone: no sideways scroll in any tab, and every target is at least 44 px",
    async run({ newGame, assert }) {
      const { g, d } = await inGame(newGame, { viewport: { width: 320, height: 568 }, hasTouch: true });
      await withGear(g, { bag: [{ slot: "weapon", tier: "rare" }, { slot: "outer", tier: "uncommon" }] });
      await d.openMenu("character");
      for (const tab of TAB_IDS) {
        await d.openMenu(tab);
        await g.page.waitForTimeout(150);
        const m = await g.page.evaluate(() => {
          const root = document.querySelector("[data-game-menu]");
          const body = root.querySelector(".lto-gm-body");
          const small = [...root.querySelectorAll("button, [role=tab]")]
            .filter((b) => b.offsetParent !== null)
            .map((b) => ({ n: b.dataset.menuTab || b.dataset.slot || b.dataset.bagIndex || b.className, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }))
            .filter((b) => b.w < 43.5 || b.h < 43.5);
          const over = [...root.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > root.getBoundingClientRect().right + 1 && getComputedStyle(e).position !== "fixed").map((e) => e.className || e.tagName).slice(0, 5);
          return { rootW: root.clientWidth, rootScroll: root.scrollWidth, bodyW: body.clientWidth, bodyScroll: body.scrollWidth, page: document.documentElement.scrollWidth - window.innerWidth, small, over };
        });
        assert.ok(m.rootScroll <= m.rootW + 1, `${tab}: the menu scrolls sideways (${m.rootScroll} > ${m.rootW})`);
        assert.ok(m.bodyScroll <= m.bodyW + 1, `${tab}: the body scrolls sideways (${m.bodyScroll} > ${m.bodyW}); over: ${m.over.join(", ")}`);
        assert.ok(m.page <= 1, `${tab}: the page scrolls sideways`);
        assert.deepEqual(m.small, [], `${tab}: targets under 44 px`);
        if (tab === "inventory") await g.screenshot("menu-inventory-320");
        if (tab === "character") await g.screenshot("menu-character-320");
      }
      assert.equal(await d.scrollsSideways(), false);
    },
  },

  {
    name: "Saves and Settings open over the main menu, and Escape comes back to it",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.openMenu("settings");
      const tabs = await d.menuTabs();
      assert.deepEqual(tabs.map((t) => t.disabled), [true, true, true, true, false, false], "no game yet: only Saves and Settings can be used");
      assert.equal(tabs.find((t) => t.selected).id, "settings");
      await g.page.keyboard.press("Escape");
      await g.page.locator("[data-game-menu]").waitFor({ state: "detached", timeout: T });
      assert.ok((await g.page.locator('[data-ltm-menu="main"], [data-lto-adventure]').count()) > 0, "the screen under it is still there");
      await d.openMenu("saves");
      assert.equal((await d.menuTabs()).find((t) => t.selected).id, "saves");
    },
  },
];
