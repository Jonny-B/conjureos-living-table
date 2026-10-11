// The game's pictures as pixels, worked out in Node, so a spec can say which art a square of the board was drawn from.
//
// Two sources, the same 52-colour palette:
//   the KayKit library   asset-files/living-table-library.json: packed parts (ground, props, tokens at 32 px), zlib then base64, one byte a pixel
//                        (255 transparent), the way the game decodes them (src/games/livingtable/table/host/gameArt.ts decodeLibraryPart)
//   the hand-made art    the dev manifest the server serves (.devserve/livingtable-assets.json, written by scripts/assets/build-dev-manifest.ts): 16 px
//                        palette-index grids, which the game shows upscaled by two where the library has nothing (kaykitRender)
//
// A sprite here is { w, h, rgba: Uint8Array } (RGBA, transparent pixels are 0,0,0,0), the same bytes a canvas holds after the game paints it.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** FNV-1a over the bytes. The pages use the same one (see `HASH_FN`), so a hash made there is comparable with one made here. */
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The same hash as source text, for page.evaluate: `new Function("return " + HASH_FN)()(uint8ArrayOrArray)`. */
export const HASH_FN = `(bytes) => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }`;

const toRgba = (idx, w, h, palette) => {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = idx[i];
    if (v === 255 || v < 0 || v === undefined) continue;
    const c = palette[v];
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    rgba[i * 4 + 3] = 255;
  }
  return { w, h, rgba };
};

/** Every sprite of one library part, by asset id. */
function decodePart(lib, file, palette) {
  const part = lib.parts.find((p) => p.file === file);
  if (!part) throw new Error(`the library has no ${file}`);
  const raw = zlib.inflateSync(Buffer.from(part.data, "base64"));
  const out = new Map();
  let o = 0;
  for (const s of part.sprites) {
    out.set(s.assetId, toRgba(raw.subarray(o, o + s.w * s.h), s.w, s.h, palette));
    o += s.w * s.h;
  }
  return out;
}

/** A 16 px palette-index grid as a sprite drawn two screen pixels to each (what the game shows for an id the library lacks). */
function upscaled(grid, palette) {
  const h = grid.length * 2;
  const w = (grid[0]?.length ?? 0) * 2;
  const idx = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) idx[y * w + x] = grid[y >> 1][x >> 1];
  return toRgba(idx, w, h, palette);
}

/**
 * @param {string} root        the checkout (asset-files/ is read from it)
 * @param {string} manifestFile the dev manifest the test server serves (server.manifestFile)
 */
export function loadArtPixels(root, manifestFile) {
  const lib = JSON.parse(fs.readFileSync(path.join(root, "asset-files", "living-table-library.json"), "utf8"));
  const dev = JSON.parse(fs.readFileSync(manifestFile, "utf8")).fantasy;
  const palette = lib.palette;
  const same = palette.length === dev.palette.length && palette.every((c, i) => c.every((v, k) => v === dev.palette[i][k]));
  if (!same) throw new Error("the library and the hand-made art do not share a palette");
  const kay = {
    tiles: decodePart(lib, "ground-painted-32.json", palette),
    props: decodePart(lib, "props-32.json", palette),
    tokens: decodePart(lib, "tokens-bands-32.json", palette),
  };
  const hand = { tiles: new Map(), props: new Map(), tokens: new Map() };
  for (const a of dev.assets) hand[a.kind === "tile" ? "tiles" : a.kind === "prop" ? "props" : "tokens"].set(a.assetId, upscaled(a.pixels, palette));
  return { kay, hand };
}

/** `top` laid over `bottom`: a pixel of `top` that is not transparent wins. */
export function over(bottom, top) {
  const rgba = new Uint8Array(bottom.rgba);
  for (let i = 0; i < top.w * top.h; i++) {
    if (top.rgba[i * 4 + 3] === 0) continue;
    for (let k = 0; k < 4; k++) rgba[i * 4 + k] = top.rgba[i * 4 + k];
  }
  return { w: bottom.w, h: bottom.h, rgba };
}

/** A Map hash -> label for a set of sprites (`entries`: [label, sprite]). */
export function hashed(entries) {
  const m = new Map();
  for (const [label, sprite] of entries) if (!m.has(hashBytes(sprite.rgba))) m.set(hashBytes(sprite.rgba), label);
  return m;
}
