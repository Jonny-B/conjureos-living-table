// Drives the Living Table as a player sees it: the page bar (Adventures, Fullscreen), the table window's own
// start screen, hero choice, board, dialogue box and HUD. The window marks its parts with data attributes
// (data-lto-adventure, data-lto-quick, data-lto-dialogue, data-hud-drawer, data-setting-choice, ...), which are
// the stable handles; button text is only used for the page bar.
//
// Every method waits for the thing it expects, so a spec never sleeps on a guess.

const T = 15000;

export class Driver {
  constructor(page, platform) {
    this.page = page;
    this.platform = platform;
  }

  /** Wait until the window has mounted (its HUD is on the page). */
  async ready() {
    await this.page.locator("[data-lto-hud]").waitFor({ timeout: T });
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

  /** The adventure cards on the start screen: [{ id, text }]. */
  async adventures() {
    await this.page.locator("[data-lto-adventure]").first().waitFor({ timeout: T });
    return this.page.locator("[data-lto-adventure]").evaluateAll((n) => n.map((x) => ({ id: x.dataset.ltoAdventure, text: x.innerText.replace(/\s+/g, " ").trim() })));
  }

  /** The test room cards: [{ id, text }]. */
  async rooms() {
    return this.page.locator("[data-lto-room]").evaluateAll((n) => n.map((x) => ({ id: x.dataset.ltoRoom, text: x.innerText.replace(/\s+/g, " ").trim() })));
  }

  /** Pick an adventure card, then a quick-start class ("fighter" is the Knight), and wait for the board to be there. */
  async quickStart(adventureId = "rat-cellar", chassis = "fighter") {
    await this.page.locator(`[data-lto-adventure="${adventureId}"]`).click({ timeout: T });
    await this.page.locator(`[data-lto-quick="${chassis}"]`).click({ timeout: T });
    await this.page.locator("[data-lto-dialogue]:not([hidden])").waitFor({ timeout: T });
  }

  /** The page bar's Adventures button: back to the start screen. */
  async adventuresButton() {
    await this.page.getByRole("button", { name: "Adventures", exact: true }).click({ timeout: T });
    await this.page.locator("[data-lto-adventure]").first().waitFor({ timeout: T });
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

  /** Press the box until it is gone (at most `max` presses). Returns how many presses it took. */
  async dismissDialogue(max = 40) {
    for (let i = 0; i < max; i += 1) {
      if (!(await this.dialogue())) return i;
      await this.pressDialogue().catch(() => {});
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

  // ---- the HUD -----------------------------------------------------------------------

  /** Open a HUD drawer by its tab ("pack", "journal", "log", "saves", "settings"). Does nothing when it is open already. */
  async openDrawer(name) {
    const tab = this.page.locator(`[data-lto-hud] button[data-hud-drawer="${name}"]`);
    await tab.waitFor({ timeout: T });
    if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
    await this.page.waitForTimeout(150);
  }

  async closeDrawer(name) {
    const tab = this.page.locator(`[data-lto-hud] button[data-hud-drawer="${name}"]`);
    if ((await tab.getAttribute("aria-pressed")) === "true") await tab.click();
    await this.page.waitForTimeout(100);
  }

  /** The HUD's own text (the readout, the open drawer). */
  async hudText() {
    return (await this.page.locator("[data-lto-hud]").innerText()).replace(/\s+/g, " ");
  }

  /** The readout's headline and the first lines, e.g. "Morning at home At Your Home ...". */
  async readout() {
    return this.hudText();
  }

  /** Choose a value in the Settings tab ("textSpeed", "fast"). */
  async setSetting(key, value) {
    await this.openDrawer("settings");
    await this.page.locator(`[data-setting-choice="${key}:${value}"]`).click({ timeout: T });
    await this.page.waitForTimeout(150);
  }

  /** The choices pressed in the Settings tab, as "key:value" strings. */
  async settingsPressed() {
    await this.openDrawer("settings");
    return this.page.locator('[data-hud-settings-view] [aria-pressed="true"]').evaluateAll((n) => n.map((x) => x.dataset.settingChoice));
  }

  /** The save rows in the Saves tab: [{ id, label, detail }]. */
  async saves() {
    await this.openDrawer("saves");
    return this.page.locator("[data-save-row]").evaluateAll((rows) => rows.map((r) => ({ id: r.dataset.saveRow, label: (r.querySelector(".lto-hud-save-info")?.innerText ?? "").replace(/\s+/g, " ").trim() })));
  }

  /** Rest (the HUD's Rest button) saves a point; it may ask nothing, or confirm, depending on the hero's state. */
  async rest() {
    await this.page.locator('[data-lto-hud] button[data-action="rest"]').click({ timeout: T });
    await this.page.waitForTimeout(300);
  }

  /** Ask the DM anything in the "What do you do?" line. Returns the AI calls the ask spent. */
  async ask(text) {
    const before = this.platform.calls.length;
    const input = this.page.locator("[data-lto-hud] input.lto-hud-input");
    await input.fill(text);
    await this.page.locator("[data-lto-hud] [data-hud-ask-send]").click();
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
