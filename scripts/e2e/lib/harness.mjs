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
  const srv = await startServer({ root, mode, log });
  const browser = await chromium.launch({ headless: !headed });
  const games = [];

  /**
   * Open a fresh page on the game.
   *   script:   the AI script (see platform.mjs); default none, so any AI call is "unmatched" and rejected
   *   viewport: { width, height }, default 1280 x 900
   *   allowHosts: hostnames besides localhost that may be requested (default none)
   *   url:      path or query to open, default "/"
   *   server:   play games-db from Node (server saves that survive a reload, the art manifest, auth.whoami); see platform.mjs
   *   saves:    a Map to share server saves between games (default: one per game)
   *   who:      what auth.whoami answers (default a signed-in tester)
   *   art:      the game's art files, which it cannot start without: "ready" (default), "none" (no assets bridge at all), "hold" (parked until
   *             window.__releaseAssets()), "fail" (download failures until window.__failAssets(false)); see lib/assets.mjs
   *   permissions, storageState: passed to the browser context
   */
  async function newGame({ script = [], viewport = { width: 1280, height: 900 }, allowHosts = [], url = "/", latencyMs = 0, extraInit, art = "ready", server = false, saves, who, ...ctxOpts } = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, ...ctxOpts });
    const page = await context.newPage();
    let manifest = null;
    const assetManifest = (template) => {
      if (!server.art || !srv.manifestFile) return null;
      manifest ??= JSON.parse(fs.readFileSync(srv.manifestFile, "utf8"));
      const m = manifest[template];
      return m ? { template, palette: m.palette, assets: m.assets } : null;
    };
    // Window "error" events never reach Playwright's pageerror (a ResizeObserver loop error is one), yet the ConjureOS shell shows each as a red
    // banner over the game. Record them in the page (window.__ltErrors) and here, so problems() fails any spec that raises one.
    const windowErrors = [];
    await page.exposeFunction("__ltReportError", (text) => {
      windowErrors.push(String(text));
    });
    await page.addInitScript(() => {
      const seen = (window.__ltErrors = window.__ltErrors || []);
      window.addEventListener(
        "error",
        (ev) => {
          const text = String((ev && ev.message) || (ev && ev.error && ev.error.message) || "error event");
          seen.push(text);
          try {
            if (typeof window.__ltReportError === "function") window.__ltReportError(text);
          } catch {
            /* the page is going away */
          }
        },
        true,
      );
    });
    const platform = await installPlatform(page, { latencyMs, extraInit, art, server: !!server, saves, who, assetManifest });
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

    await page.goto(srv.url + url, { waitUntil: "load" });
    const game = {
      page,
      context,
      platform,
      consoleErrors,
      pageErrors,
      windowErrors,
      foreign,
      downloads,
      driver: new Driver(page, platform),
      /** Everything wrong so far, as strings; empty when the run was clean. */
      problems() {
        return [
          ...consoleErrors.map((t) => `console.error: ${t}`),
          ...pageErrors.map((t) => `pageerror: ${t}`),
          ...windowErrors.map((t) => `window error event: ${t}`),
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
    server: srv,
    browser,
    newGame,
    close: async () => {
      for (const g of games) await g.close().catch(() => {});
      await browser.close().catch(() => {});
      await srv.close().catch(() => {});
    },
  };
}
