// The e2e harness: one server, one browser, a fresh page per spec.
//
//   const h = await startHarness({ root, mode });
//   const game = await h.newGame({ script: campaignScript() });
//   await game.driver.createCampaign();
//   ...
//   game.problems();   // console errors, page errors, foreign requests so far
//   await h.close();
//
// Playwright is resolved from the ConjureOS checkout (the repo has no
// playwright dependency of its own, like the .cache bench scripts); set
// PLAYWRIGHT_PATH to point elsewhere.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./serve.mjs";
import { installPlatform } from "./platform.mjs";
import { Driver } from "./driver.mjs";

const PLAYWRIGHT_PATH = process.env.PLAYWRIGHT_PATH || "C:/Users/blewi/Shelf/ConjureOS/node_modules/playwright";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function startHarness({ root = process.cwd(), mode = "dev", headed = false, log = () => {}, shotsDir = null } = {}) {
  const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_PATH);
  const server = await startServer({ root, mode, log });
  const browser = await chromium.launch({ headless: !headed });
  const games = [];

  /**
   * Open a fresh page on the game.
   *   script:   the AI script (see platform.mjs); default none, so any AI call is "unmatched" and rejected
   *   viewport: { width, height }, default 1280 x 900
   *   allowHosts: hostnames besides localhost that may be requested (default none)
   *   url:      path or query to open, default "/"
   *   permissions, storageState: passed to the browser context
   */
  async function newGame({ script = [], viewport = { width: 1280, height: 900 }, allowHosts = [], url = "/", latencyMs = 0, extraInit, ...ctxOpts } = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, ...ctxOpts });
    const page = await context.newPage();
    const platform = await installPlatform(page, { latencyMs, extraInit });
    platform.script(script);

    const consoleErrors = [];
    const pageErrors = [];
    const foreign = [];
    const downloads = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e)));
    page.on("download", (d) => downloads.push(d));
    page.on("request", (r) => {
      let u;
      try {
        u = new URL(r.url());
      } catch {
        return;
      }
      if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return;
      if (LOCAL_HOSTS.has(u.hostname) || allowHosts.includes(u.hostname)) return;
      foreign.push(r.url());
    });

    await page.goto(server.url + url, { waitUntil: "load" });
    const game = {
      page,
      context,
      platform,
      consoleErrors,
      pageErrors,
      foreign,
      downloads,
      driver: new Driver(page, platform),
      /** Everything wrong so far, as strings; empty when the run was clean. */
      problems() {
        return [
          ...consoleErrors.map((t) => `console.error: ${t}`),
          ...pageErrors.map((t) => `pageerror: ${t}`),
          ...foreign.map((u) => `request to a non-local host: ${u}`),
          ...platform.unmatched.map((c) => `unscripted AI call #${c.n}: ${c.system.slice(0, 80).replace(/\s+/g, " ")}`),
        ];
      },
      async screenshot(name) {
        if (!shotsDir) return null;
        fs.mkdirSync(shotsDir, { recursive: true });
        const file = path.join(shotsDir, `${name.replace(/[^\w.-]+/g, "_")}.png`);
        await page.screenshot({ path: file });
        return file;
      },
      close: () => context.close(),
    };
    games.push(game);
    return game;
  }

  return {
    server,
    browser,
    newGame,
    close: async () => {
      for (const g of games) await g.close().catch(() => {});
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}
