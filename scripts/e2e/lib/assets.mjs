// A stand-in for ConjureOS's asset-file bridge (window.__conjureos.assets).
//
// The shipped game reads its animated cast and KayKit library with `assets.load(name)` and does not start without them (it waits for both,
// or shows a Retry screen: src/games/livingtable/table/host/artGate.ts). Outside the ConjureOS app there is no such bridge, so this gives a
// page one, serving the committed files (asset-files/living-table-cast.json and living-table-library.json) from the test server
// (lib/serve.mjs serves them at /asset-files/<name>), in the shape the real one answers:
//
//   list()      -> the two names
//   load(name)  -> { ok: true, name, type, blob, objectUrl }   or   { ok: false, reason: "unknown_name" | "fetch_failed", error? }
//
// Every game the harness opens has it by default (lib/platform.mjs installs it first; `newGame({ art })` picks how, see `artInit`):
//
//   newGame({})                       the art is there as soon as the page asks (the default). Its idle loops are held on their first frame, so a
//                                     figure that stands still stays still and a still board hashes the same twice (serve.mjs, `?still=1`)
//   newGame({ art: { motion: true }}) the real cast, idle loops and all (a spec that checks a figure idles)
//   newGame({ art: "none" })          withhold it: no `assets` bridge, like a ConjureOS app too old to hand over files (the update screen, no Retry)
//   newGame({ art: "hold" })          the files are held back until window.__releaseAssets() (the game waits, the splash says so)
//   newGame({ art: "fail" })          every load answers a download failure until window.__failAssets(false) (the Retry screen)
//   newGame({ art: { delayMs: 1500 }}) every load takes that long (a slow connection: the game waits, the splash says so)
//   newGame({ art: { names: [] } })   the bridge options of assetBridge (here: a bridge that knows no files)
//
//   await g.page.evaluate(() => window.__releaseAssets());     // ...and the held files land now
//   await g.page.evaluate(() => window.__failAssets(false));   // ...and the next load works, so Retry succeeds
//
// A spec may also pass `assetBridge(...)` as its own `extraInit`; it runs after the default and replaces it.

export const ASSET_NAMES = ["living-table-cast.json", "living-table-library.json"];

/**
 * The init code (a function body, run with `bridge` = window.__conjureos) that gives the page the bridge.
 * @param {{ hold?: boolean, fail?: boolean, delayMs?: number, motion?: boolean, names?: string[] }} [o] hold: park every load() until window.__releaseAssets() is called.
 *   fail: answer every load with a download failure until window.__failAssets(false). delayMs: take this long over every load.
 *   motion: serve the cast as it is committed, idle loops running (default: idle held on the first frame). names: the files the bridge knows.
 */
export function assetBridge({ hold = false, fail = false, delayMs = 0, motion = false, names = ASSET_NAMES } = {}) {
  return `
    const known = ${JSON.stringify(names)};
    let release;
    const gate = ${hold ? "new Promise((r) => { release = r; })" : "Promise.resolve()"};
    window.__releaseAssets = () => { if (release) release(); };
    window.__assetsFail = ${fail ? "true" : "false"};
    window.__failAssets = (on) => { window.__assetsFail = on !== false; };
    window.__assetLoads = [];
    bridge.assets = {
      list: async () => known.slice(),
      load: async (name) => {
        window.__assetLoads.push(name);
        if (!known.includes(name)) return { ok: false, reason: "unknown_name" };
        await gate;
        ${delayMs > 0 ? `await new Promise((r) => setTimeout(r, ${Number(delayMs)}));` : ""}
        if (window.__assetsFail) return { ok: false, reason: "fetch_failed", error: "HTTP 503" };
        const res = await fetch("/asset-files/" + encodeURIComponent(name) + ${motion ? '""' : '"?still=1"'});
        if (!res.ok) return { ok: false, reason: "fetch_failed", error: "HTTP " + res.status };
        const blob = await res.blob();
        return { ok: true, name, type: "application/json", blob, objectUrl: URL.createObjectURL(blob) };
      },
    };
  `;
}

/**
 * Init code (give it as `extraInit`) that records every time a picture says it is the hand-made doll: the window.__dolls list gets a line for
 * each element that is, or becomes, `[data-art="doll"]` (a hero picture draws itself as the doll only for a class with no KayKit version).
 * The game puts the attribute on a canvas before the canvas is on the page, so this looks at what is added as well as at attribute changes.
 */
export const WATCH_DOLLS = `
  window.__dolls = [];
  const note = (el, how) => { try { window.__dolls.push(how + " " + el.tagName.toLowerCase() + "." + String(el.className || "")); } catch (e) {} };
  const scan = (root) => {
    if (!root || root.nodeType !== 1) return;
    if (root.getAttribute("data-art") === "doll") note(root, "added");
    if (root.querySelectorAll) root.querySelectorAll('[data-art="doll"]').forEach((e) => note(e, "inside"));
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") { if (m.target.getAttribute("data-art") === "doll") note(m.target, "set"); }
      else m.addedNodes.forEach(scan);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-art"] });
`;

/**
 * The init code for a `newGame({ art })` choice, or null for none. "ready" (the default) gives the working bridge; "none" gives no bridge at all;
 * "hold" and "fail" are described above; an object is the options of assetBridge.
 */
export function artInit(art = "ready") {
  if (art === "none" || art === false) return null;
  if (art === "ready" || art === true || art === undefined) return assetBridge();
  if (art === "hold") return assetBridge({ hold: true });
  if (art === "fail") return assetBridge({ fail: true });
  if (typeof art === "object" && art) return assetBridge(art);
  throw new Error(`e2e: unknown art option ${JSON.stringify(art)}`);
}
