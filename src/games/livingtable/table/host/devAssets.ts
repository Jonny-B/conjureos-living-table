/**
 * The game's art files on a local development page.
 *
 * The shipped game reads its two art files (assetFiles.ts) through `window.__conjureos.assets`, which only the ConjureOS app
 * provides. A page opened from `npm run dev` has no ConjureOS around it, and the game does not start without its art, so
 * this stands in for the bridge there: it reads the same two files from the dev server's own `/asset-files/<name>`
 * (scripts/assets/build-dev-manifest.ts copies them into `.devserve/asset-files/`, which `conj-pack dev` serves).
 *
 * It answers only when ALL of these hold, so it can never take the place of the real thing:
 *   - there is no `window.__conjureos` at all (inside ConjureOS, and in the e2e harness, which defines one, the real or mock bridge is used);
 *   - the page is served from this machine (localhost or 127.0.0.1);
 *   - the page can fetch.
 * The published bundle leaves `.devserve` out (scripts/build-bundle.mjs STRIP), so on any other page the files are simply not there.
 *
 * Import-pure: nothing runs until `devAssetBridge()` is called.
 */
import type { AssetLoadResult, AssetsBridge } from "./gameArt";
import { ASSET_FILE_NAMES } from "./assetFiles";

/** The page names that mean "served from this machine" (the same rule gameHost.ts applies to the test rooms). */
const LOCAL_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1"];

/** Where the dev server keeps the files. */
export const DEV_ASSET_PATH = "/asset-files/";

/** A stand-in for `window.__conjureos.assets` on a local page with no ConjureOS, or null everywhere else. */
export function devAssetBridge(): AssetsBridge | null {
  try {
    const g = globalThis as { __conjureos?: unknown; location?: { hostname?: unknown }; fetch?: unknown };
    if (g.__conjureos !== undefined) return null;
    const host = typeof g.location?.hostname === "string" ? g.location.hostname : "";
    if (!LOCAL_HOSTNAMES.includes(host) || typeof g.fetch !== "function") return null;
  } catch {
    return null;
  }
  const names: string[] = Object.values(ASSET_FILE_NAMES);
  return {
    async list() {
      return names.slice();
    },
    async load(name: string): Promise<AssetLoadResult> {
      if (!names.includes(name)) return { ok: false, reason: "unknown_name" };
      try {
        const res = await fetch(`${DEV_ASSET_PATH}${encodeURIComponent(name)}`);
        if (!res.ok) return { ok: false, reason: "fetch_failed", error: `HTTP ${res.status}` };
        const blob = await res.blob();
        return { ok: true, objectUrl: URL.createObjectURL(blob), blob };
      } catch (e) {
        return { ok: false, reason: "fetch_failed", error: e instanceof Error ? e.message : "unknown error" };
      }
    },
  };
}
