// Drives the Living Table as a player sees it: the page bar (Menu, Fullscreen), the table window's own main menu,
// start screen, hero choice, board, dialogue box, HUD and game menu. The window marks its parts with data attributes
// (data-lto-adventure, data-lto-quick, data-lto-dialogue, data-game-menu, data-menu-tab, data-setting-choice, ...), which
// are the stable handles; button text is only used for the page bar.
//
// Every method waits for the thing it expects, so a spec never sleeps on a guess.

const T = 15000;

export class Driver {
  constructor(page, platform) {
    this.page = page;
    this.platform = platform;
  }

  /** Wait until the window has mounted (its HUD is on the page; the HUD is hidden while a screen is up, so it is attached, not visible). */
  async ready() {
    await this.page.locator("[data-lto-hud]").waitFor({ state: "attached", timeout: T });
    return this;
  }

  /** Everything a player can read on the page, as one string. */
  async text() {
    return (await this.page.locator("body").innerText()).replace(/\s+/g, " ");
  }

  /** Same, for the HTML attributes a player could also see: titles, labels, placeholders. */
  async labels() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll("[title],[aria-label],[placeholder],[alt]")]
        .map((e) => [e.getAttribute("title"), e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("alt")].filter(Boolean).join(" | "))
        .join(" | "),
    );
  }

  // ---- the start screen -----------------------------------------------------------------

  /**
   * Get to the adventure list from wherever the window is: already there, the main menu (New game), or a game being played (the page
   * bar's Menu button opens the main menu first).
   */
  async toAdventureList() {
    const cards = this.page.locator("[data-lto-adventure]");
    const main = this.page.locator('[data-ltm-menu="main"]');
    const t0 = Date.now();
    while (Date.now() - t0 < T) {
      if ((await cards.count()) > 0) return;
      if ((await main.count()) > 0) {
        await this.page.locator('[data-ltm-act="new"]').click({ timeout: T });
        await cards.first().waitFor({ timeout: T });
        return;
      }
      // A game is up (the HUD has its Menu button and nothing covers it): back out through the page bar's Menu.
      if ((await this.page.locator("[data-game-menu]").count()) === 0 && (await this.page.locator("[data-lto-dialogue]:not([hidden]), [data-lto-hud]").count()) > 0 && Date.now() - t0 > 1500) {
        await this.page.locator(".lt-app-menu").click({ timeout: T });
        await main.waitFor({ timeout: T });
        continue;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error("the adventure list never came up");
  }

  /**
   * After a reload the saved game is one press away: the main menu's Continue puts the player back in it (the window opens on the main
   * menu, or on the adventure list with the Main menu button on top). Does nothing when the window opened straight into the game.
   */
  async continueGame() {
    const t0 = Date.now();
    const main = this.page.locator('[data-ltm-menu="main"]');
    while (Date.now() - t0 < 4000) {
      if ((await main.count()) > 0) {
        await this.page.locator('[data-ltm-act="continue"]').click({ timeout: T });
        await main.waitFor({ state: "detached", timeout: T });
        break;
      }
      const fromScreen = this.page.locator("[data-lto-menu]");
      if ((await fromScreen.count()) > 0 && (await fromScreen.first().isVisible().catch(() => false))) {
        await fromScreen.first().click({ timeout: T });
        continue;
      }
      if ((await this.page.locator("[data-lto-hud]").isVisible().catch(() => false)) && (await this.page.locator("[data-lto-adventure]").count()) === 0) break;
      await this.page.waitForTimeout(100);
    }
    await this.page.waitForTimeout(250);
  }

  /** The adventure cards on the start screen: [{ id, text }]. */
  async adventures() {
    await this.toAdventureList();
    await this.page.locator("[data-lto-adventure]").first().waitFor({ timeout: T });
    return this.page.locator("[data-lto-adventure]").evaluateAll((n) => n.map((x) => ({ id: x.dataset.ltoAdventure, text: x.innerText.replace(/\s+/g, " ").trim() })));
  }

  /** The test room cards: [{ id, text }]. */
  async rooms() {
    return this.page.locator("[data-lto-room]").evaluateAll((n) => n.map((x) => ({ id: x.dataset.ltoRoom, text: x.innerText.replace(/\s+/g, " ").trim() })));
  }

  /**
   * From the hero choice: press "Play as the X" (`chassis`: "fighter" is the Knight). That opens the character maker on its required Name
   * step, with Begin disabled until a name is typed; fill `name` and press Begin. Waits for the story screen or the dialogue box.
   * Pass `name: null` to stop at the maker with the name left empty.
   */
  async playAs(chassis = "fighter", name = "Mira") {
    await this.page.locator(`[data-lto-quick="${chassis}"]`).click({ timeout: T });
    await this.page.locator('[data-lts="creation"]').waitFor({ timeout: T });
    if (name === null) return;
    await this.page.locator('[data-lts-field="Name"]').fill(name, { timeout: T });
    await this.page.locator('[data-lts-act="begin"]').click({ timeout: T });
    // The way in is told in the dialogue box or, for story the player did not ask for, on the story screen.
    await this.page.locator("[data-lto-dialogue]:not([hidden]), [data-lto-story]:not([hidden])").first().waitFor({ timeout: T });
  }

  /** Pick an adventure card, then a quick-start class ("fighter" is the Knight) with a name (default "Mira"), and wait for the opening. */
  async quickStart(adventureId = "rat-cellar", chassis = "fighter", name = "Mira") {
    await this.toAdventureList();
    await this.page.locator(`[data-lto-adventure="${adventureId}"]`).click({ timeout: T });
    await this.playAs(chassis, name);
  }

  /** The page bar's Menu button, then New game: back to the adventure list. */
  async adventuresButton() {
    if ((await this.page.locator("[data-ltm-menu]").count()) === 0) {
      await this.page.locator(".lt-app-menu").click({ timeout: T });
      await this.page.locator('[data-ltm-menu="main"]').waitFor({ timeout: T });
    }
    await this.toAdventureList();
  }

  // ---- the dialogue box -----------------------------------------------------------------

  /** What the dialogue box says now, or null when it is down. */
  async dialogue() {
    return this.page.evaluate(() => {
      const d = document.querySelector("[data-lto-dialogue]");
      if (!d || d.hidden) return null;
      const body = d.querySelector(".lto-dlg-body");
      return {
        speaker: d.dataset.speaker ?? "",
        text: d.dataset.text ?? "",
        shown: Number(d.dataset.shown ?? 0),
        complete: d.dataset.complete === "true",
        more: d.dataset.more === "true",
        page: Number(d.dataset.page ?? 1),
        pages: Number(d.dataset.pages ?? 1),
        queued: Number(d.dataset.queued ?? 0),
        thinking: d.dataset.thinking === "true",
        scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
      };
    });
  }

  /** Wait for the box to say something satisfying `fn`. */
  async waitDialogue(fn = () => true, ms = 12000) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < ms) {
      last = await this.dialogue();
      if (last && fn(last)) return last;
      await this.page.waitForTimeout(40);
    }
    throw new Error(`the dialogue box never reached the wanted state; last: ${JSON.stringify(last)}`);
  }

  /** Press the box (finish the page, then the next page, then the next entry, then it closes). */
  async pressDialogue() {
    await this.page.locator("[data-lto-dialogue]:not([hidden])").click({ timeout: 2000 });
    await this.page.waitForTimeout(80);
  }

  /** True while a story screen (the DM telling what the player did not ask for) is up. */
  async storyOpen() {
    return (await this.page.locator("[data-lto-story]:not([hidden])").count()) > 0;
  }

  /** Press the story screen (finish the page, then the next, then it closes). */
  async pressStory() {
    await this.page.locator("[data-lto-story]:not([hidden])").first().click({ timeout: 2000 });
    await this.page.waitForTimeout(80);
  }

  /** Press the story screen and the dialogue box until both are gone (at most `max` presses). Returns how many presses it took. */
  async dismissDialogue(max = 40) {
    for (let i = 0; i < max; i += 1) {
      const story = await this.storyOpen();
      if (!story && !(await this.dialogue())) return i;
      if (story) await this.pressStory().catch(() => {});
      else await this.pressDialogue().catch(() => {});
    }
    throw new Error("the dialogue box would not close");
  }

  // ---- the board ---------------------------------------------------------------------

  /** A fingerprint of what the board canvas shows now (it is still when nothing moves). */
  async boardHash() {
    return this.page.evaluate(() => {
      const c = document.querySelector("canvas.ltt-canvas");
      if (!c) return "";
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      for (let i = 0; i < data.length; i += 7) h = Math.imul(h ^ data[i], 16777619) >>> 0;
      return String(h);
    });
  }

  /** How many different colours the board canvas holds (a blank or failed paint has one or two). */
  async boardColours() {
    return this.page.evaluate(() => {
      const c = document.querySelector("canvas.ltt-canvas");
      if (!c) return 0;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 16) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    });
  }

  /** Click the board at a point measured from its top left corner, in screen pixels. */
  async clickBoard(x, y) {
    const box = await this.page.locator("canvas.ltt-canvas").boundingBox();
    if (!box) throw new Error("no board on the page");
    await this.page.mouse.click(box.x + x, box.y + y);
  }

  /** Wait until the board has been still for `ms`. Returns the hash it settled on. */
  async settle(ms = 500, max = 8000) {
    const t0 = Date.now();
    let prev = await this.boardHash();
    let since = Date.now();
    while (Date.now() - t0 < max) {
      await this.page.waitForTimeout(80);
      const now = await this.boardHash();
      if (now !== prev) {
        prev = now;
        since = Date.now();
      } else if (Date.now() - since >= ms) return now;
    }
    return prev;
  }

  // ---- the HUD and the game menu -------------------------------------------------------

  /** The names the old drawer used, mapped to the game menu's tabs (the pack is the Inventory now). */
  static tabFor(name) {
    return name === "pack" ? "inventory" : name === "sheet" ? "character" : name;
  }

  /** True when the game menu is up. */
  async menuIsOpen() {
    return (await this.page.locator("[data-game-menu]").count()) > 0;
  }

  /**
   * Open the game menu on a tab ("character", "inventory", "journal", "log", "saves", "settings"; the old drawer names work too).
   * In play it is the HUD's Menu button; over the main menu or a start screen only Saves and Settings can be reached, through the main menu's
   * Load and Settings. Does nothing more when the tab is showing already.
   */
  async openMenu(name = "character") {
    const tab = Driver.tabFor(name);
    const menu = this.page.locator("[data-game-menu]");
    if ((await menu.count()) === 0) {
      const button = this.page.locator('[data-lto-hud] button[data-action="menu"]');
      const reachable = (await button.count()) > 0 && (await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false));
      if (reachable) {
        await button.click({ timeout: T });
      } else {
        // Over a screen: the main menu (opened from the start screen's Main menu button, or the page bar) has Load and Settings.
        if ((await this.page.locator('[data-ltm-menu="main"]').count()) === 0) {
          const fromScreen = this.page.locator("[data-lto-menu]");
          if ((await fromScreen.count()) > 0 && (await fromScreen.first().isVisible().catch(() => false))) await fromScreen.first().click({ timeout: T });
          else await this.page.locator(".lt-app-menu").click({ timeout: T });
          await this.page.locator('[data-ltm-menu="main"]').waitFor({ timeout: T });
        }
        await this.page.locator(`[data-ltm-act="${tab === "settings" ? "settings" : "load"}"]`).click({ timeout: T });
      }
      await menu.waitFor({ timeout: T });
    }
    const t = menu.locator(`[data-menu-tab="${tab}"]`);
    await t.waitFor({ timeout: T });
    if ((await t.getAttribute("aria-selected")) !== "true") await t.click({ timeout: T });
    await this.page.waitForTimeout(150);
  }

  /** Close the game menu with its close button. Does nothing when it is shut. */
  async closeMenu() {
    const menu = this.page.locator("[data-game-menu]");
    if ((await menu.count()) === 0) return;
    await menu.locator("[data-menu-close]").click({ timeout: T });
    await menu.waitFor({ state: "detached", timeout: T });
    await this.page.waitForTimeout(100);
  }

  /** The names the specs used for the drawer, kept: they open the game menu now. */
  async openDrawer(name) {
    return this.openMenu(name);
  }

  async closeDrawer() {
    return this.closeMenu();
  }

  /** The game menu's own text (the open tab), or "" when it is shut. */
  async menuText() {
    const menu = this.page.locator("[data-game-menu]");
    if ((await menu.count()) === 0) return "";
    return (await menu.innerText()).replace(/\s+/g, " ");
  }

  /** The HUD's own text (the readout and its buttons), and the open game menu's. */
  async hudText() {
    const hud = (await this.page.locator("[data-lto-hud]").innerText()).replace(/\s+/g, " ");
    return `${hud} ${await this.menuText()}`.trim();
  }

  /** The readout's headline and the first lines, e.g. "Morning at home At Your Home ...". */
  async readout() {
    return (await this.page.locator("[data-lto-hud] .lto-hud-panel").innerText()).replace(/\s+/g, " ");
  }

  /** The game menu's tabs, in order: [{ id, label, selected, disabled }]. */
  async menuTabs() {
    return this.page.locator("[data-game-menu] [data-menu-tab]").evaluateAll((n) =>
      n.map((x) => ({ id: x.dataset.menuTab, label: (x.getAttribute("aria-label") ?? "").replace(/\s*\(.\)$/, ""), selected: x.getAttribute("aria-selected") === "true", disabled: x.disabled })),
    );
  }

  /** Choose a value in the Settings tab ("textSpeed", "fast"), then close the menu so the game is in reach again. */
  async setSetting(key, value) {
    await this.openMenu("settings");
    await this.page.locator(`[data-setting-choice="${key}:${value}"]`).click({ timeout: T });
    await this.page.waitForTimeout(150);
    await this.closeMenu();
  }

  /** The choices pressed in the Settings tab, as "key:value" strings (the menu is closed again after). */
  async settingsPressed() {
    await this.openMenu("settings");
    const pressed = await this.page.locator('[data-hud-settings-view] [aria-pressed="true"]').evaluateAll((n) => n.map((x) => x.dataset.settingChoice));
    await this.closeMenu();
    return pressed;
  }

  /** The save rows in the Saves tab: [{ id, label, detail }] (the menu is closed again after). */
  async saves() {
    await this.openMenu("saves");
    const rows = await this.page.locator("[data-save-row]").evaluateAll((rows) => rows.map((r) => ({ id: r.dataset.saveRow, label: (r.querySelector(".lto-hud-save-info")?.innerText ?? "").replace(/\s+/g, " ").trim() })));
    await this.closeMenu();
    return rows;
  }

  /** Rest (the HUD's Rest button) saves a point; it may ask nothing, or confirm, depending on the hero's state. */
  async rest() {
    await this.closeMenu();
    await this.page.locator('[data-lto-hud] button[data-action="rest"]').click({ timeout: T });
    await this.page.waitForTimeout(300);
  }

  /** The hero's square, in client pixels: { x, y, w, h }, from the mark the stage keeps on the viewport. */
  async heroRect() {
    const text = await this.page.locator(".lt-viewport").first().getAttribute("data-lt-hero-rect");
    if (!text) throw new Error("the stage keeps no hero rectangle");
    const [x, y, w, h] = text.split(",").map(Number);
    return { x, y, w, h };
  }

  /**
   * Ask the DM anything: right click a floor square (by default the one beside the hero) and type the words into the menu's text line. A
   * right click opens the actions menu; free text is its last entry. Returns the AI calls the ask spent.
   */
  async ask(text, at) {
    const before = this.platform.calls.length;
    const r = await this.heroRect();
    const board = await this.page.locator("canvas.ltt-canvas").boundingBox();
    // One square to the right of the hero when there is room on the board, else to the left.
    let x = at?.x ?? r.x + r.w * 1.5;
    const y = at?.y ?? r.y + r.h / 2;
    if (!at && board && x > board.x + board.width - r.w / 2) x = r.x - r.w / 2;
    await this.page.mouse.click(x, y, { button: "right" });
    const input = this.page.locator("input[data-lto-cm-input]");
    await input.waitFor({ timeout: T });
    await input.fill(text);
    await input.press("Enter");
    await this.platform.waitForCalls(before + 1);
    return this.platform.calls.length - before;
  }

  // ---- the page bar ------------------------------------------------------------------

  /** True when the page scrolls sideways. */
  async scrollsSideways() {
    return this.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  }

  /** The line under the window (where the saves are). */
  async footLine() {
    return ((await this.page.locator(".lt-app-save").innerText()) ?? "").trim();
  }
}
