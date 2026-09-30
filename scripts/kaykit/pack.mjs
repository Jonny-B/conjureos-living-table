/**
 * Gathers every finished KayKit style render (.cache/kaykit/out/<style>/frames.json,
 * full runs only) into one file the asset bench embeds:
 * .cache/kaykit/bench-data.json. The palette, sizes, loadouts and the reference
 * render are identical across styles (the harness owns them), so they are kept
 * once; each style keeps its label, description and clips.
 *
 * With no renders yet it writes an empty set, so the bench still builds on a
 * machine without Blender.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = ".cache/kaykit/out";
const TARGET = ".cache/kaykit/bench-data.json";
const ORDER = ["plain"]; // the control first; the rest alphabetically

const docs = [];
if (existsSync(OUT_DIR)) {
  for (const name of readdirSync(OUT_DIR)) {
    const file = join(OUT_DIR, name, "frames.json");
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (doc.quick) {
      console.warn(`kaykit pack: skipping ${name} (a --quick run; run the full harness for the bench)`);
      continue;
    }
    docs.push(doc);
  }
}
docs.sort((a, b) => {
  const ia = ORDER.indexOf(a.style);
  const ib = ORDER.indexOf(b.style);
  if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.style.localeCompare(b.style);
});

const first = docs[0];
const data = first
  ? {
      character: first.character,
      source: first.source,
      palette: first.palette,
      sizes: first.sizes,
      loadouts: first.loadouts,
      reference: first.reference,
      cameraPitchDeg: first.cameraPitchDeg,
      styles: docs.map((d) => ({ style: d.style, label: d.label, description: d.description, clips: d.clips })),
    }
  : { styles: [] };

mkdirSync(".cache/kaykit", { recursive: true });
writeFileSync(TARGET, JSON.stringify(data));
const bytes = Buffer.byteLength(JSON.stringify(data));
console.log(`kaykit pack: ${data.styles.length} style(s) [${data.styles.map((s) => s.style).join(", ")}], ${bytes} bytes -> ${TARGET}`);
