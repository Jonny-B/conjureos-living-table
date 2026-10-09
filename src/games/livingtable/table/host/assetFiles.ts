/**
 * Where the Living Table's big art files live on ConjureOS.
 *
 * The animated cast (about 6.3 MB of JSON) and the KayKit library (about 0.2 MB) are too big for the app
 * package's 5 MB limit (the cast) or not worth carrying in the page itself (the library), so they ship as
 * the app's ASSET FILES: package.json lists them under `conjureos.assetFiles`, publishing uploads them, and
 * installing the game from Discover downloads them to the player's device. The game reads each one by its
 * name with `window.__conjureos.assets.load(name)`, which checks the bytes against the hash recorded at
 * publish. The files are committed under `asset-files/` and are left out of the page's own bundle.
 *
 * Outside ConjureOS, on a ConjureOS that does not give a game its files (the phone today), or when a load
 * fails, the table draws still figures and the hand-drawn art, and says why in the art status
 * (gameArt.ts `assetStatus()`).
 *
 * The files are written by `node scripts/assets/export-asset-files.mjs`, which prints each one's name, size
 * and sha256. A changed file is a new publish; the platform records the new hash itself.
 */

export interface AssetFiles {
  /** living-table-cast.json: the animated figures (CastData). A file name, or null for none. */
  cast: string | null;
  /** living-table-library.json: the KayKit sprite library, `{ palette, parts }`. A file name, or null for none. */
  library: string | null;
}

/**
 * The file names scripts/assets/export-asset-files.mjs writes and package.json `conjureos.assetFiles` lists
 * (keep the three in step; a test checks it).
 */
export const ASSET_FILE_NAMES = { cast: "living-table-cast.json", library: "living-table-library.json" } as const;

/** The files this build asks for. */
export const ASSET_FILES: AssetFiles = {
  cast: ASSET_FILE_NAMES.cast,
  library: ASSET_FILE_NAMES.library,
};

/** What ConjureOS accepts as an asset file name (the same rule it applies at publish). */
export const ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** True when a name is one `assets.load(name)` could be given. */
export function validAssetName(name: string | null | undefined): name is string {
  return typeof name === "string" && ASSET_NAME_RE.test(name);
}
