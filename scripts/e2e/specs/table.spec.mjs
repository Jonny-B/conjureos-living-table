// The Living Table as it ships: one app, opening straight into the table window.
//
// The ConjureOS host is mocked (lib/platform.mjs): the AI is scripted and counted, and with `server` games-db is
// played from Node, so the server saves survive a reload the way a real server's do. A spec also fails if its page
// logs a console error, throws, asks for a non-local host, or makes an AI call the spec did not script.
import { dmReply, dmScript, LONG_NARRATION } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };
/** No price, no credit, in any text a player can read or hover. */
const NO_PRICE = /(?<!Licence and )credit|\bcosts?\b.*\b\d|\b\d+\s*(credits?|coins?)\b/i;

export const specs = [
  {
    name: "opens on the adventure list: the adventures and the test rooms, no hub, no price text, no AI call",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      const adventures = await d.adventures();
      assert.equal(adventures.length, 2, `two adventures are listed (${adventures.map((a) => a.id).join(", ")})`);
      assert.ok(adventures.some((a) => /The Rat Cellar/.test(a.text)), "The Rat Cellar is listed");
      assert.ok(adventures.some((a) => /Template adventure/.test(a.text)), "the template adventure is listed");
      const rooms = await d.rooms();
      assert.equal(rooms.length, 2, "both test rooms are listed");
      const text = await d.text();
      assert.doesNotMatch(text, NO_PRICE, "the start screen states no price");
      assert.doesNotMatch(text, /Conjure Games|back to the games|\bhub\b/i, "nothing leads to another app");
      assert.doesNotMatch(await d.labels(), NO_PRICE);
      assert.equal(await g.page.getByRole("button", { name: "Fullscreen" }).count(), 1, "the Fullscreen button is there");
      assert.equal(await g.page.locator(".lt-app-menu").count(), 1, "the page bar's Menu button is there");
      assert.equal(await g.page.title(), "The Living Table");
      assert.equal(g.platform.calls.length, 0, "opening the game must not call the model");
      // The licence credit is two taps away: the main menu's Licence and credits.
      await g.page.locator("[data-lto-menu]").click();
      await g.page.locator('[data-ltm-act="credits"]').click();
      const credits = g.page.locator("[data-ltm-credits]");
      assert.match(await credits.innerText(), /System Reference Document 5\.1/);
      assert.match(await credits.innerText(), /Creative Commons Attribution 4\.0/);
    },
  },

  {
    name: "a quick start as the Knight has no armor and only the sword",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.quickStart("rat-cellar", "fighter");
      await d.dismissDialogue();
      await d.openMenu("inventory");
      const menu = g.page.locator("[data-game-menu]");
      assert.match(await menu.locator('[data-slot="weapon"]').getAttribute("aria-label"), /Longsword/, "the sword is worn");
      assert.equal(await menu.locator('[data-slot="weapon"]').getAttribute("data-tier"), "common", "a plain one");
      for (const role of ["outer", "crown", "armor"]) assert.equal(await menu.locator(`[data-slot="${role}"]`).getAttribute("data-empty"), "true", `nothing worn in the ${role} slot: no armor, no shield`);
      assert.equal(await menu.locator("[data-bag-index]").count(), 0, "nothing in the bag");
      assert.match(await menu.locator('[data-inv-section="Consumables"]').innerText(), /Nothing/, "no potions");
      assert.equal(await menu.locator('[data-stat="ac"] [data-stat-value]').innerText(), "11", "an unarmored Knight is AC 10 plus Dexterity");
      assert.match(await d.readout(), /AC 11/, "and the side panel says so");
      assert.equal(g.platform.calls.length, 0, "starting an adventure never calls the model");
    },
  },

  {
    name: "a step is free: a click on the floor moves the hero, and the Adventures button comes back to the start screen",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      const still = await d.settle();
      await g.page.waitForTimeout(400);
      assert.equal(await d.boardHash(), still, "an idle board does not change by itself");
      await d.clickBoard(240, 136);
      await g.page.waitForTimeout(250);
      const moved = await d.settle();
      assert.notEqual(moved, still, "the board redrew with the hero somewhere new");
      assert.equal(g.platform.calls.length, 0, "walking never calls the model");
      await d.adventuresButton();
      assert.equal((await d.adventures()).length, 2, "the start screen is back");
    },
  },

  {
    name: "asking the DM spends one scripted call and the answer is told in the dialogue box, with no price anywhere",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(dmReply({ narration: "You press your ear to the cellar door. Behind it, small claws scrabble." })) });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      const spent = await d.ask("I listen at the cellar door");
      assert.equal(spent, 1, "one ask is one call");
      const call = g.platform.calls[0];
      assert.equal(call.tier, "capable");
      assert.ok(call.maxTokens >= 8000, "a capable tier leaves room to think");
      assert.match(call.messages.map((m) => m.content).join("\n") + call.system, /I listen at the cellar door/, "the player's words reach the DM");
      const said = await d.waitDialogue((x) => /small claws scrabble/.test(x.text));
      assert.equal(said.speaker, "DM");
      await d.dismissDialogue();
      assert.equal(g.platform.calls.length, 1, "reading the answer asks for nothing more");
      for (const drawer of ["pack", "journal", "log", "saves", "settings"]) {
        await d.openDrawer(drawer);
        assert.doesNotMatch(await d.hudText(), NO_PRICE, `the ${drawer} tab states no price`);
        await d.closeDrawer(drawer);
      }
      assert.doesNotMatch(await d.text(), NO_PRICE, "the board page states no price after an ask");
      assert.doesNotMatch(await d.labels(), NO_PRICE);
    },
  },

  {
    name: "no screen of the game states a price: start, hero choice, character maker, board, sheet, every HUD tab, the writer and a DM answer",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      const clean = async (where) => {
        assert.doesNotMatch(await d.text(), NO_PRICE, `${where} states a price`);
        assert.doesNotMatch(await d.labels(), NO_PRICE, `${where} has a price in a label`);
      };
      await d.ready();
      await clean("the main menu");
      await d.toAdventureList();
      await clean("the start screen");
      await g.page.locator("[data-lto-ai]").first().click().catch(() => {});
      await clean("the writer card");
      await g.page.locator('[data-lto-adventure="rat-cellar"]').click();
      await g.page.locator('[data-lto-quick="fighter"]').waitFor();
      await clean("the hero choice");
      await g.page.locator("[data-lto-create]").click();
      await g.page.locator('[data-lts="creation"]').waitFor();
      await g.page.waitForTimeout(500);
      await clean("the character maker");
      await d.adventuresButton();
      await d.quickStart();
      await clean("the board");
      await d.dismissDialogue();
      await g.page.keyboard.press("c");
      await g.page.waitForTimeout(400);
      await clean("the sheet");
      await g.page.keyboard.press("Escape");
      for (const drawer of ["pack", "journal", "log", "saves", "settings"]) {
        await d.openDrawer(drawer);
        await clean(`the ${drawer} tab`);
        await d.closeDrawer(drawer);
      }
      await d.ask("I look around");
      await d.waitDialogue();
      await clean("a DM answer");
      assert.equal(g.platform.calls.length, 1);
    },
  },

  {
    name: "the dialogue box types a character at a time, pages a long answer, never scrolls, and a click finishes then moves on",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(dmReply({ narration: LONG_NARRATION })) });
      const d = g.driver;
      await d.ready();
      await d.setSetting("textSpeed", "slow");
      await d.quickStart();
      await d.dismissDialogue();
      await d.ask("I look into the well");
      const first = await d.waitDialogue((x) => x.speaker === "DM" && x.shown > 0);
      assert.ok(first.shown < first.text.length, `the text prints a character at a time (${first.shown} of ${first.text.length})`);
      assert.equal(first.scrolls, false, "the box never scrolls");
      const later = await d.waitDialogue((x) => x.shown > first.shown);
      assert.ok(later.shown > first.shown, "and keeps printing");
      assert.ok(later.pages >= 2, `a long answer is split into pages (${later.pages})`);
      // One click finishes the page.
      await d.pressDialogue();
      const done = await d.dialogue();
      assert.ok(done && done.complete && done.page === 1, "a click makes the whole page appear");
      assert.equal(done.scrolls, false);
      assert.equal(done.more, true, "the more marker shows when a page is waiting");
      // The next click goes to the next page, and it starts printing.
      await d.pressDialogue();
      const next = await d.dialogue();
      assert.ok(next && next.page === 2, `the next click turns the page (${next && next.page})`);
      assert.equal(next.scrolls, false);
      // Clicking through to the end closes the box.
      await d.dismissDialogue();
      assert.equal(await d.dialogue(), null, "the last click closes it");
      assert.equal(g.platform.calls.length, 1);
    },
  },

  {
    name: "the Settings tab changes the text speed, and the choice is kept across a reload",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      let pressed = await d.settingsPressed();
      assert.ok(pressed.includes("textSpeed:normal"), `normal is the default (${pressed.join(", ")})`);
      await d.setSetting("textSpeed", "fast");
      pressed = await d.settingsPressed();
      assert.ok(pressed.includes("textSpeed:fast") && !pressed.includes("textSpeed:normal"));
      await d.setSetting("textStyle", "storybook");
      assert.equal(await g.page.locator(".lto-root").first().getAttribute("data-style"), "storybook");
      await g.page.reload({ waitUntil: "load" });
      await d.ready();
      pressed = await d.settingsPressed();
      assert.ok(pressed.includes("textSpeed:fast"), `the speed is kept (${pressed.join(", ")})`);
      assert.ok(pressed.includes("textStyle:storybook"), "and so is the text style");
    },
  },

  {
    name: "a save then a reload puts the player back where they left off, from the server saves alone",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      await d.clickBoard(240, 136);
      await g.page.waitForTimeout(250);
      await d.settle();
      await d.openDrawer("saves");
      await d.rest();
      await d.dismissDialogue().catch(() => {});
      const rows = await d.saves();
      assert.ok(rows.length >= 1, "there is a save to restore");
      const keys = [...g.platform.saves.keys()];
      assert.ok(keys.some((k) => k.startsWith("s:")), `a save point went to the server (${keys.join(", ")})`);
      assert.ok(keys.includes("current"), "and the current copy");
      const before = await d.readout();
      await d.settle();
      // The whole board is compared, door by door and creature by creature, except the hero's own figure: it faces the way it last walked, and a
      // loaded game stands it facing the viewer again (the facing is not saved). Where the hero stands is compared on its own.
      const heroBefore = await d.heroRect();
      const boardBefore = await d.boardHashExcept(heroBefore);
      assert.notEqual(boardBefore, "", "there is a board to compare");
      // The device forgets everything: only the server has the game now.
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
      assert.equal(await g.page.locator("[data-lto-adventure]").count(), 0, "the game is back where it was, not on the start screen");
      const after = await d.readout();
      const head = (s) => s.split(/AC \d+/)[0];
      assert.equal(head(after), head(before), "the same scene is up");
      await d.settle();
      assert.deepEqual(await d.heroRect(), heroBefore, "with the hero standing where they were");
      assert.equal(await d.boardHashExcept(heroBefore), boardBefore, "and every other square of the board, and the fog over it, as it was");
      assert.ok((await d.saves()).length >= 1, "the saves came back from the server");
      assert.match(await d.footLine(), /account/i, "the line under the window says the saves are on the account");
      assert.equal(g.platform.calls.length, 0, "restoring a game never calls the model");
    },
  },

  {
    name: "a save that will not mount shows a plain message and Try again opens the start screen, with the saves kept",
    async run({ newGame, assert }) {
      // The window's first draw throws once per page load while the flag is set, as a save the window cannot stand up would.
      const boom =
        "try { if (sessionStorage.getItem('ltBoom') === '1') { let armed = true; const real = Element.prototype.appendChild; Element.prototype.appendChild = function (c) { if (armed && this.classList && this.classList.contains('lt-stage-wrap')) { armed = false; throw new Error('the scene would not draw'); } return real.call(this, c); }; } } catch (e) { /* no sessionStorage */ }";
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), extraInit: boom });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      await d.rest();
      await d.dismissDialogue().catch(() => {});
      assert.ok([...g.platform.saves.keys()].some((k) => k.startsWith("s:")), "a save point is on the server");
      await g.page.evaluate(() => sessionStorage.setItem("ltBoom", "1"));
      await g.page.reload({ waitUntil: "load" });
      const alert = g.page.locator('.lt-app-note[role="alert"]');
      await alert.waitFor({ timeout: 8000 });
      assert.match(await alert.innerText(), /Try again/);
      assert.equal(await g.page.getByText("Setting the table").count(), 0, "the page is not left loading");
      assert.doesNotMatch(await alert.innerText(), /would not draw|Error|undefined/, "the message is plain");
      await g.page.getByRole("button", { name: "Try again" }).click();
      await d.ready();
      assert.ok((await d.adventures()).length >= 1, "Try again opens on the start screen, not in the save that failed");
      assert.ok([...g.platform.saves.keys()].some((k) => k.startsWith("s:")), "the saves are kept");
      assert.equal(g.platform.calls.length, 0);
    },
  },

  {
    name: "while the server is down the save stays on the device and the page says so; it goes up when the server is back",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      g.platform.serverDown = "The save server could not be reached.";
      await d.quickStart();
      await d.dismissDialogue();
      await g.page.waitForTimeout(600);
      assert.equal(g.platform.saves.size, 0, "nothing reached the server");
      assert.match(await d.footLine(), /device/i, `the line says where the save is: ${await d.footLine()}`);
      assert.ok((await d.saves()).length >= 1, "the game still has its save");
      g.platform.serverDown = null;
      await d.rest();
      await d.dismissDialogue().catch(() => {});
      await g.page.waitForFunction(() => /account/i.test(document.querySelector(".lt-app-save")?.textContent ?? ""), null, { timeout: 8000 });
      assert.ok(g.platform.saves.size >= 2, "the saves went up once the server was back");
      g.consoleErrors.length = 0; // a failed call is logged by the browser; this spec expects it
    },
  },

  {
    name: "when games-db serves no art the bundled library paints the board",
    async run({ newGame, assert }) {
      const g = await newGame({ server: true, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      await d.settle();
      assert.ok((await d.boardColours()) > 12, "the board is painted");
      assert.ok(g.platform.serverCalls.some((c) => c.action === "ltAssetManifest"), "games-db was asked for the art first");
    },
  },

  {
    name: "without permission to use AI the DM says so and nothing is sent",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), extraInit: "delete bridge.ai;" });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      // Free text lives in the right click menu now: it is off, and the menu says why.
      const r = await d.heroRect();
      await g.page.mouse.click(r.x + r.w * 1.5, r.y + r.h / 2, { button: "right" });
      const input = g.page.locator("input[data-lto-cm-input]");
      await input.waitFor({ timeout: 8000 });
      assert.equal(await input.isDisabled(), true, "the ask line is off");
      assert.match(`${await d.text()} ${await g.page.evaluate(() => document.body.textContent)} ${await d.labels()}`, /permission to use AI/i, "the player is told the DM needs AI turned on");
      assert.equal(g.platform.calls.length, 0, "nothing was asked");
    },
  },

  {
    name: "another player's saves on the same device are put aside, never uploaded into this account",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      await g.page.waitForTimeout(400);
      assert.ok(g.platform.saves.size >= 2, "the first player's saves went to their account");
      // A second player signs in on this browser, with an account that holds nothing yet.
      await g.page.addInitScript(() => {
        window.__conjureos.auth = { whoami: async () => ({ signedIn: true, email: "someone-else@example.test" }) };
      });
      g.platform.saves.clear();
      await g.page.reload({ waitUntil: "load" });
      await d.ready();
      await g.page.waitForTimeout(600);
      assert.equal(await g.page.locator('[data-ltm-act="continue"]').isDisabled(), true, "the second player has nothing to continue");
      await d.toAdventureList();
      assert.equal(await g.page.locator("[data-lto-adventure]").count(), 2, "the second player starts at the start screen");
      assert.equal(g.platform.saves.size, 0, "nothing of the first player's reached the second player's account");
      const kept = await g.page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes(":backup:")));
      assert.ok(kept.length >= 1, "the first player's saves are kept aside on the device");
    },
  },

  {
    name: "the Fullscreen button goes full screen and the same button leaves it",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      const button = g.page.locator(".lt-app-full");
      assert.equal(await button.count(), 1);
      assert.match(await button.innerText(), /Fullscreen/);
      await button.click();
      await g.page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5000 });
      assert.match(await button.innerText(), /Exit full screen/);
      await button.click();
      await g.page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 5000 });
      assert.match(await button.innerText(), /Fullscreen/);
    },
  },

  {
    name: "a phone-width page does not scroll sideways on the start screen, the hero choice or the board",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: { width: 390, height: 844 }, hasTouch: true });
      const d = g.driver;
      await d.ready();
      assert.equal(await d.scrollsSideways(), false, "main menu");
      await d.toAdventureList();
      assert.equal(await d.scrollsSideways(), false, "start screen");
      await g.page.locator('[data-lto-adventure="rat-cellar"]').click();
      await g.page.locator('[data-lto-quick="fighter"]').waitFor();
      assert.equal(await d.scrollsSideways(), false, "hero choice");
      await d.playAs("fighter");
      assert.equal(await d.scrollsSideways(), false, "board with the opening on screen");
      await d.dismissDialogue();
      assert.equal(await d.scrollsSideways(), false, "board");
      for (const tab of ["character", "inventory", "journal", "log", "saves", "settings"]) {
        await d.openMenu(tab);
        assert.equal(await d.scrollsSideways(), false, `${tab} tab of the menu`);
      }
      await d.closeMenu();
      await g.screenshot("phone-board");
    },
  },
];
