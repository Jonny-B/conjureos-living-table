/**
 * Packs the converted KayKit library parts (.cache/kaykit/library/parts/*.json,
 * each validated by check-part.mjs) into one compact file the asset bench
 * embeds: .cache/kaykit/bench-library.json.
 *
 * Per sprite the palette indices become one byte each (255 = transparent),
 * concatenated per part, zlib-compressed and base64-encoded, the same scheme
 * the character clips use. The bench decodes with DecompressionStream and
 * falls back to the game's current art for any id a part does not cover.
 *
 * With no parts yet it writes an empty set, so the bench still builds.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const DIR = ".cache/kaykit/library/parts";
const OUT = ".cache/kaykit/bench-library.json";

const parts = [];
if (existsSync(DIR)) {
  for (const name of readdirSync(DIR).filter((n) => n.endsWith(".json")).sort()) {
    const part = JSON.parse(readFileSync(join(DIR, name), "utf8"));
    const index = [];
    const chunks = [];
    for (const s of part.sprites ?? []) {
      const h = s.pixels.length;
      const w = s.pixels[0]?.length ?? 0;
      const bytes = Buffer.alloc(w * h);
      let o = 0;
      for (const row of s.pixels) for (const v of row) bytes[o++] = v < 0 ? 255 : v;
      index.push({ assetId: s.assetId, w, h });
      chunks.push(bytes);
    }
    parts.push({
      file: name,
      maker: part.maker,
      size: part.size,
      style: part.style ?? null,
      sprites: index,
      gaps: part.gaps ?? [],
      data: deflateSync(Buffer.concat(chunks), { level: 9 }).toString("base64"),
    });
  }
}
mkdirSync(".cache/kaykit", { recursive: true });
const doc = { parts };
writeFileSync(OUT, JSON.stringify(doc));
console.log(`kaykit pack-library: ${parts.length} part(s), ${parts.reduce((n, p) => n + p.sprites.length, 0)} sprites, ${Buffer.byteLength(JSON.stringify(doc))} bytes -> ${OUT}`);
