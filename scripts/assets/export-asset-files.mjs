/**
 * Writes the Living Table's big art as the two files the owner uploads to ConjureOS
 * (Settings, Apps, Asset files), and prints each one's name, size and sha256.
 *
 *   node scripts/assets/export-asset-files.mjs [--out <dir>] [--regenerate]
 *
 * Reads what the KayKit pack scripts already wrote:
 *   .cache/kaykit/bench-cast.json      (scripts/kaykit/pack-cast.mjs)     the animated figures, ~6 MB
 *   .cache/kaykit/bench-library.json   (scripts/kaykit/pack-library.mjs)  the sprite library, ~0.2 MB
 *   .cache/kaykit/palette-fantasy.json (scripts/kaykit/export-palette.ts) the palette the library indexes
 * and writes, by default into .cache/asset-files/ (never into the repo's tracked files):
 *   living-table-cast.json      the bench cast, byte for byte (so its hash is the pack's own)
 *   living-table-library.json   { palette, parts } (the library plus the palette it was converted to)
 *
 * --regenerate runs the three pack scripts first (they need the Blender renders under .cache/kaykit/out
 * and the converted parts under .cache/kaykit/library/parts; without them the cast comes out empty and
 * this script refuses to write it). --out <dir> picks another folder.
 *
 * The hash is over the exact bytes written, which is what `window.__conjureos.assets.load(url, sha256)`
 * checks. Writing the same inputs twice gives the same files and the same hashes, so running it again
 * is harmless; a changed input is a new hash and so a new upload.
 *
 * The file names are the ones src/games/livingtable/table/host/assetFiles.ts lists.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CAST_NAME = "living-table-cast.json";
export const LIBRARY_NAME = "living-table-library.json";
/** ConjureOS refuses one asset file over this many bytes. */
export const MAX_BYTES = 50 * 1024 * 1024;
/** The part files the table's default look draws with (gameArt.ts DEFAULT_LOOK). */
export const REQUIRED_PARTS = ["ground-painted-32.json", "props-32.json", "tokens-bands-32.json"];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function readJson(path, hint) {
  if (!existsSync(path)) throw new Error(`${path} is missing. ${hint}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
}

/**
 * Check the inputs and write the two files. Returns [{ name, path, bytes, sha256 }].
 * Throws with a plain message when an input is missing, empty, or not what the table expects.
 */
export function buildAssetFiles({
  castPath = ".cache/kaykit/bench-cast.json",
  libraryPath = ".cache/kaykit/bench-library.json",
  palettePath = ".cache/kaykit/palette-fantasy.json",
  outDir = ".cache/asset-files",
} = {}) {
  const cast = readJson(castPath, "Run: node scripts/kaykit/pack-cast.mjs (or this script with --regenerate).");
  const castBytes = readFileSync(castPath);
  if (!Array.isArray(cast.styles) || cast.styles.length === 0) {
    throw new Error(`${castPath} has no cast styles (the Blender renders are not there). Render the cast, then run: node scripts/kaykit/pack-cast.mjs`);
  }
  if (!Array.isArray(cast.palette) || typeof cast.cameraPitchDeg !== "number") throw new Error(`${castPath} is not a cast file (no palette or camera pitch).`);

  const lib = readJson(libraryPath, "Run: node scripts/kaykit/pack-library.mjs (or this script with --regenerate).");
  if (!Array.isArray(lib.parts) || lib.parts.length === 0) throw new Error(`${libraryPath} has no parts (the converted library is not there). Run the lib_*.py makers, then node scripts/kaykit/pack-library.mjs`);
  const have = new Set(lib.parts.map((p) => p.file));
  const lacking = REQUIRED_PARTS.filter((f) => !have.has(f));
  if (lacking.length) throw new Error(`${libraryPath} lacks ${lacking.join(", ")}, which the table's default look draws with.`);

  const pal = readJson(palettePath, "Run: npx tsx scripts/kaykit/export-palette.ts (or this script with --regenerate).");
  if (!Array.isArray(pal.palette) || pal.palette.length === 0) throw new Error(`${palettePath} has no palette.`);

  const libraryBytes = Buffer.from(JSON.stringify({ palette: pal.palette, parts: lib.parts }), "utf8");

  mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const [name, bytes] of [[CAST_NAME, castBytes], [LIBRARY_NAME, libraryBytes]]) {
    if (bytes.length > MAX_BYTES) throw new Error(`${name} is ${bytes.length} bytes, over the ${MAX_BYTES} byte limit for one asset file.`);
    const path = join(outDir, name);
    writeFileSync(path, bytes);
    out.push({ name, path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1] : ".cache/asset-files";
  if (argv.includes("--regenerate")) {
    for (const cmd of [
      ["npx", ["tsx", "scripts/kaykit/export-palette.ts"]],
      ["node", ["scripts/kaykit/pack-library.mjs"]],
      ["node", ["scripts/kaykit/pack-cast.mjs"]],
    ]) {
      const r = spawnSync(cmd[0], cmd[1], { stdio: "inherit", shell: process.platform === "win32" });
      if (r.status !== 0) throw new Error(`${cmd.join(" ")} failed`);
    }
  }
  const files = buildAssetFiles({ outDir });
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(`Wrote ${files.length} asset files to ${resolve(outDir)}\n`);
  for (const f of files) console.log(`${f.name}\n  size    ${f.bytes} bytes (${mb(f.bytes)})\n  sha256  ${f.sha256}\n  path    ${resolve(f.path)}\n`);
  console.log("After uploading both in Settings, Apps, Asset files, paste each address and its sha256 into");
  console.log("src/games/livingtable/table/host/assetFiles.ts (or hand them to the session that commits it):\n");
  const key = { [CAST_NAME]: "cast", [LIBRARY_NAME]: "library" };
  for (const f of files) console.log(`  ${key[f.name]}: { url: "<the address ConjureOS gave ${f.name}>", sha256: "${f.sha256}" },`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error(`export-asset-files: ${e.message}`);
    process.exit(1);
  }
}
