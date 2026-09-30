/**
 * Contact sheets from harness output, for looking at KayKit renders without
 * the bench.
 *
 *   node scripts/kaykit/sheet.mjs <style>[,<style>...] [--size 32x48] [--dir down] [--zoom 4] [--out file.png]
 *
 * One style: a row per loadout, a column per clip (first, middle and last
 * frame). Several styles: a row per style (default loadout), so conversions
 * sit side by side. Writes .cache/kaykit/sheets/<name>.png by default and
 * prints the path.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { encodePng } from "../assets/png.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const styles = (args[0] ?? "plain").split(",");
const sizeId = opt("size", "32x48");
const dir = opt("dir", "down");
const zoom = Number(opt("zoom", "4"));
const out = opt("out", `.cache/kaykit/sheets/${styles.join("+")}-${sizeId}-${dir}.png`);
const BG = [96, 96, 96];
const GAP = 6;

function load(style) {
  return JSON.parse(readFileSync(`.cache/kaykit/out/${style}/frames.json`, "utf8"));
}

function frames(doc, clip) {
  const size = doc.sizes[clip.size];
  const raw = inflateSync(Buffer.from(clip.data, "base64"));
  const per = size.canvasW * size.canvasH;
  return Array.from({ length: clip.count }, (_, i) => ({ w: size.canvasW, h: size.canvasH, px: raw.subarray(i * per, (i + 1) * per) }));
}

function pick(list) {
  if (list.length <= 2) return list;
  return [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]];
}

const rows = [];
if (styles.length === 1) {
  const doc = load(styles[0]);
  for (const lo of doc.loadouts) {
    const cells = [];
    for (const clip of doc.clips.filter((c) => c.loadout === lo.id && c.size === sizeId && c.dir === dir)) {
      for (const f of pick(frames(doc, clip))) cells.push({ f, pal: doc.palette });
    }
    if (cells.length) rows.push(cells);
  }
} else {
  for (const style of styles) {
    const doc = load(style);
    const cells = [];
    for (const clip of doc.clips.filter((c) => c.loadout === doc.loadouts[0].id && c.size === sizeId && c.dir === dir)) {
      for (const f of pick(frames(doc, clip))) cells.push({ f, pal: doc.palette });
    }
    rows.push(cells);
  }
}
if (!rows.length) throw new Error(`no clips for size ${sizeId}, dir ${dir}`);

const cellW = Math.max(...rows.flat().map((c) => c.f.w)) * zoom + GAP;
const cellH = Math.max(...rows.flat().map((c) => c.f.h)) * zoom + GAP;
const cols = Math.max(...rows.map((r) => r.length));
const W = cols * cellW + GAP;
const H = rows.length * cellH + GAP;
const img = Array.from({ length: H }, () => Array.from({ length: W }, () => BG));
rows.forEach((row, ri) => {
  row.forEach(({ f, pal }, ci) => {
    const ox = GAP + ci * cellW;
    const oy = GAP + ri * cellH + (cellH - GAP - f.h * zoom);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const idx = f.px[y * f.w + x];
        if (idx === 255) continue;
        const rgb = pal[idx];
        for (let dy = 0; dy < zoom; dy++) for (let dx = 0; dx < zoom; dx++) img[oy + y * zoom + dy][ox + x * zoom + dx] = rgb;
      }
    }
  });
});
mkdirSync(out.replace(/[\\/][^\\/]*$/, ""), { recursive: true });
writeFileSync(out, encodePng(img));
console.log(out);
