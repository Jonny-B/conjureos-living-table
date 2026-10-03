// Drives TODAY's game screens by what a player sees: button text and the
// game's own class names (lt-*, cui-*). When the port replaces a screen, only
// this file changes; the specs keep reading the same verbs.
//
// Every method waits for the thing it expects, so a spec never sleeps.

const T = 15000;

export class Driver {
  constructor(page, platform) {
    this.page = page;
    this.platform = platform;
  }

  /** The visible headline of the screen: the game header's title. */
  async title() {
    return ((await this.page.locator("h2.cui-heading").first().textContent({ timeout: T })) ?? "").trim();
  }

  /** Wait for the campaign list (the app's first screen). */
  async openList() {
    await this.page.locator(".lt-campaign-grid").waitFor({ timeout: T });
  }

  /** The campaign cards on the list: [{ title, genre, status }] (the "New campaign" card is not one). */
  async campaigns() {
    await this.openList();
    return this.page.locator(".lt-campaign-card:not(.lt-new-card)").evaluateAll((cards) =>
      cards.map((c) => {
        const bits = [...c.children].map((e) => (e.textContent || "").trim());
        return { title: bits[0], genre: bits[1], status: bits[2] };
      }),
    );
  }

  /** From the list, open the New campaign screen. */
  async openNewCampaign() {
    if (await this.page.locator(".lt-template-row").count()) return;
    await this.openList();
    await this.page.locator(".lt-new-card").click();
    await this.page.locator(".lt-template-row").waitFor({ timeout: T });
  }

  /** Text of the price line under "Plan this campaign". */
  async planPriceNote() {
    return (await this.page.locator(".lt-price-note").textContent({ timeout: T }))?.trim() ?? "";
  }

  /**
   * New campaign -> arc call -> the character screen. The arc reply comes from
   * the platform script. Returns the AI calls the click spent.
   */
  async createCampaign({ theme } = {}) {
    await this.openNewCampaign();
    if (theme) await this.page.locator("input.cui-input").fill(theme);
    const before = this.platform.calls.length;
    await this.page.getByRole("button", { name: /Plan this campaign/ }).click();
    await this.page.locator(".lt-archetype-row").waitFor({ timeout: T });
    return this.platform.calls.length - before;
  }

  /** Archetype cards on the character screen, by their heading. */
  async archetypes() {
    return this.page.locator(".lt-archetype-card strong").allTextContents();
  }

  /** Character screen -> the Begin the scene screen (creating a character is free and makes no AI call). */
  async createCharacter({ name = "Tess", archetype } = {}) {
    if (archetype) await this.page.locator(".lt-archetype-card", { hasText: archetype }).click();
    await this.page.locator('input[placeholder="Their name"]').fill(name);
    await this.page.getByRole("button", { name: "Begin", exact: true }).click();
    await this.page.getByRole("button", { name: /Begin the scene/ }).waitFor({ timeout: T });
  }

  /** The Begin the scene button's text and price line (the screen between the character and the board). */
  async beginSceneScreen() {
    const btn = this.page.getByRole("button", { name: /Begin the scene/ });
    await btn.waitFor({ timeout: T });
    return {
      button: ((await btn.textContent()) ?? "").trim(),
      price: ((await this.page.locator(".lt-price-note").textContent()) ?? "").trim(),
      free: ((await this.page.locator(".lt-free-note").textContent()) ?? "").trim(),
    };
  }

  /** Click Begin the scene: one DM call builds the first room. Resolves when the board is up. */
  async beginScene() {
    await this.page.getByRole("button", { name: /Begin the scene/ }).click();
    await this.page.locator(".lt-play-layout").waitFor({ timeout: T });
    await this.page.locator("canvas.lt-canvas").waitFor({ timeout: T });
  }

  /** Character screen -> Begin the scene screen -> the board. Returns nothing; the spec reads platform.calls. */
  async createCharacterAndBegin(opts) {
    await this.createCharacter(opts);
    await this.beginScene();
  }

  /** The play screen's header: { title, subtitle, hp }. */
  async hud() {
    const head = this.page.locator("header.game-head");
    return {
      title: ((await head.locator("h2").textContent({ timeout: T })) ?? "").trim(),
      subtitle: ((await head.locator(".game-head-text p").textContent({ timeout: T })) ?? "").trim(),
      hp: ((await head.locator(".cui-pill").textContent({ timeout: T })) ?? "").trim(),
    };
  }

  /** The d-pad button for a direction: N, W, E or S. */
  move(dir) {
    return this.page.locator(".lt-menu-move button", { hasText: new RegExp("^\\s*" + dir + "(?![A-Za-z])") });
  }

  /** True when this direction's button shows a price (stepping builds a new room). */
  async movePaid(dir) {
    const label = (await this.move(dir).getAttribute("aria-label")) ?? "";
    return /nobody has built/.test(label);
  }

  /**
   * Press a d-pad button once and wait for the board to settle: the canvas
   * redraws, or (for a paid step) the DM answers and the header's place changes.
   */
  async step(dir) {
    const before = await this.boardHash();
    await this.move(dir).click();
    await this.page.waitForFunction(
      ([prev]) => {
        const c = document.querySelector("canvas.lt-canvas");
        if (!c) return false;
        const d = c.toDataURL();
        let h = 5381;
        for (let i = 0; i < d.length; i++) h = ((h << 5) + h + d.charCodeAt(i)) | 0;
        return `${c.width}x${c.height}:${h}` !== prev;
      },
      [before],
      { timeout: T },
    );
  }

  /** Several steps the same way. */
  async walk(dir, n) {
    for (let i = 0; i < n; i++) await this.step(dir);
  }

  /** The flash note (a refusal or an error line) on the play screen, or null. */
  async flash() {
    const f = this.page.locator("p.flash").first();
    return (await f.count()) ? ((await f.textContent()) ?? "").trim() : null;
  }

  /** The story panel's bubbles, oldest first. */
  async story() {
    return this.page.locator(".lt-narration .bubble:not(.thinking)").allTextContents();
  }

  /** Type a line to the DM and send it with Talk (one paid call). */
  async talk(text) {
    await this.page.locator("textarea.cui-input").fill(text);
    await this.page.locator(".composer-bar").getByRole("button", { name: /^Talk/ }).click();
  }

  /** Leave with the header's back arrow. */
  async back() {
    await this.page.getByRole("button", { name: "Back to the games" }).click();
  }

  /** A hash of the board canvas, to see whether anything on it moved. */
  async boardHash() {
    return this.page.locator("canvas.lt-canvas").evaluate((c) => {
      const data = c.toDataURL();
      let h = 5381;
      for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) | 0;
      return `${c.width}x${c.height}:${h}`;
    });
  }
}
