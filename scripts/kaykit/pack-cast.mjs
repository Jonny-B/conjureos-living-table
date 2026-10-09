/**
 * Gathers the animated cast (.cache/kaykit/out/cast-<style>/cast.json, written
 * by cast.py) into one file the asset bench embeds:
 * .cache/kaykit/bench-cast.json. The palette and camera are the same for
 * every style, so they are kept once.
 *
 * --styles a,b  keeps only those styles (the artifact has a 16 MB ceiling).
 *
 * With no renders yet it writes an empty set, so the bench still builds on a
 * machine without Blender.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = ".cache/kaykit/out";
const TARGET = ".cache/kaykit/bench-cast.json";
const ORDER = ["bands", "pixelart", "toon", "plain"];

const argStyles = (() => {
  const i = process.argv.indexOf("--styles");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",") : null;
})();

const docs = [];
if (existsSync(OUT_DIR)) {
  for (const name of readdirSync(OUT_DIR)) {
    if (!name.startsWith("cast-")) continue;
    const file = join(OUT_DIR, name, "cast.json");
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (argStyles && !argStyles.includes(doc.style)) continue;
    docs.push(doc);
  }
}
docs.sort((a, b) => {
  const ia = ORDER.indexOf(a.style);
  const ib = ORDER.indexOf(b.style);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.style.localeCompare(b.style);
});

const first = docs[0];
const data = first
  ? {
      palette: first.palette,
      cameraPitchDeg: first.cameraPitchDeg,
      styles: docs.map((d) => ({
        style: d.style,
        label: d.label,
        description: d.description,
        characters: d.characters,
        gear: d.gear,
        layerOrder: d.layerOrder,
        layerOrderByArchetype: d.layerOrderByArchetype,
      })),
    }
  : { styles: [] };

mkdirSync(".cache/kaykit", { recursive: true });
const text = JSON.stringify(data);
writeFileSync(TARGET, text);
console.log(`kaykit cast pack: ${data.styles.length} style(s) [${data.styles.map((s) => s.style).join(", ")}], ${Buffer.byteLength(text)} bytes -> ${TARGET}`);
