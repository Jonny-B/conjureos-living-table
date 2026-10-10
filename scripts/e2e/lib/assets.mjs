// A stand-in for ConjureOS's asset-file bridge (window.__conjureos.assets), for the specs that need the cast.
//
// The shipped game reads its animated cast and KayKit library with `assets.load(name)`; outside the ConjureOS app there is no such bridge and
// the game draws the hand-made art. This gives a page the bridge, serving the committed files (asset-files/living-table-cast.json and
// living-table-library.json) from the test server (lib/serve.mjs serves them at /asset-files/<name>), in the shape the real one answers:
//
//   list()      -> the two names
//   load(name)  -> { ok: true, name, type, blob, objectUrl }   or   { ok: false, reason: "unknown_name" }
//
// Pass the string as `extraInit` to newGame (platform.mjs runs it before the page's own scripts, with `bridge` = window.__conjureos).
//
//   const g = await newGame({ extraInit: assetBridge() });                 // the cast is there as soon as the page asks
//   const g = await newGame({ extraInit: assetBridge({ hold: true }) });   // the files are held back until window.__releaseAssets()
//   await g.page.evaluate(() => window.__releaseAssets());                 // ...and the cast lands now, with the page already open

export const ASSET_NAMES = ["living-table-cast.json", "living-table-library.json"];

/** @param {{ hold?: boolean, names?: string[] }} [o] hold: park every load() until window.__releaseAssets() is called. names: the files the bridge knows. */
export function assetBridge({ hold = false, names = ASSET_NAMES } = {}) {
  return `
    const known = ${JSON.stringify(names)};
    let release;
    const gate = ${hold ? "new Promise((r) => { release = r; })" : "Promise.resolve()"};
    window.__releaseAssets = () => { if (release) release(); };
    window.__assetLoads = [];
    bridge.assets = {
      list: async () => known.slice(),
      load: async (name) => {
        window.__assetLoads.push(name);
        if (!known.includes(name)) return { ok: false, reason: "unknown_name" };
        await gate;
        const res = await fetch("/asset-files/" + encodeURIComponent(name));
        if (!res.ok) return { ok: false, reason: "fetch_failed", error: "HTTP " + res.status };
        const blob = await res.blob();
        return { ok: true, name, type: "application/json", blob, objectUrl: URL.createObjectURL(blob) };
      },
    };
  `;
}
