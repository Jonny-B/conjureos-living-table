/**
 * Where the Living Table's big art files live on ConjureOS.
 *
 * The animated cast (about 6.3 MB of JSON) and the KayKit library (about 0.2 MB) are too big for the app
 * package's 5 MB limit (the cast) or not worth carrying in every download (the library), so they are
 * uploaded once as ConjureOS asset files (Settings, Apps, Asset files) and loaded at run time with
 * `window.__conjureos.assets.load(url, sha256)`, which refuses any file whose bytes do not match the hash.
 *
 * Each entry is null until the owner has uploaded the file and its address and hash are pasted in here.
 * While it is null (or when the load fails, or outside ConjureOS) the table draws still figures and the
 * hand-drawn art, and says so in the art status (gameArt.ts `assetStatus()`).
 *
 * The files are written by `node scripts/assets/export-asset-files.mjs`, which prints each one's name,
 * size and sha256. The hash is 64 lowercase hex characters; the url is the address "Copy address" gives.
 * A changed file has a new hash, so a new upload means new values here.
 */

export interface AssetFileRef {
  /** The public address of the uploaded file. */
  url: string;
  /** The file's SHA-256, 64 lowercase hex characters. */
  sha256: string;
}

export interface AssetFiles {
  /** living-table-cast.json: the animated figures (CastData). */
  cast: AssetFileRef | null;
  /** living-table-library.json: the KayKit sprite library, `{ palette, parts }`. */
  library: AssetFileRef | null;
}

/** The file names scripts/assets/export-asset-files.mjs writes (keep the two in step). */
export const ASSET_FILE_NAMES = { cast: "living-table-cast.json", library: "living-table-library.json" } as const;

/** What the owner has uploaded so far. Both null until the upload is done. */
export const ASSET_FILES: AssetFiles = {
  cast: null,
  library: null,
};

/** True when a reference has the shape `assets.load` accepts (an http(s) address and 64 lowercase hex). */
export function validAssetRef(ref: AssetFileRef | null | undefined): ref is AssetFileRef {
  return !!ref && typeof ref.url === "string" && /^https?:\/\//.test(ref.url) && typeof ref.sha256 === "string" && /^[0-9a-f]{64}$/.test(ref.sha256);
}
