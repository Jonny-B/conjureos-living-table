// The responsive walk: the whole tour (lib/tour.mjs) at every window size, with a screenshot of every screen for the eyes.
//
//   node scripts/e2e/walk.mjs [--sizes 320x640,390x844,...] [--shots .cache/bench-shots] [--items] [--headed]
//
// Screenshots land in <shots>/bb-<step>-<width>x<height>.png. Exit code 0 when no size reported a problem.
import assert from "node:assert/strict";
import path from "node:path";
import { startHarness } from "./lib/harness.mjs";
import { tour } from "./lib/tour.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const sizes = opt("--sizes", "320x640,390x844,768x1024,1024x768,1280x800,1920x1080,2560x1440,3840x2160")
  .split(",")
  .map((s) => s.split("x").map(Number));
const shots = path.resolve(opt("--shots", ".cache/bench-shots"));
const items = args.includes("--items");

const h = await startHarness({ root: process.cwd(), headed: args.includes("--headed"), log: () => {}, shotsDir: path.join(shots, "failures") });
let bad = 0;
for (const [width, height] of sizes) {
  const opened = [];
  const newGame = async (o = {}) => {
    const g = await h.newGame(o);
    opened.push(g);
    return g;
  };
  const t0 = Date.now();
  let found;
  try {
    found = await tour(newGame, { width, height, touch: width <= 820, shots, items, assert });
  } catch (e) {
    found = [`${width}x${height} the tour stopped: ${String(e.message ?? e).split("\n")[0]}`];
    for (const [i, g] of opened.entries()) await g.screenshot(`walk-stopped-${width}x${height}-${i}`).catch(() => null);
  }
  for (const g of opened) await g.close().catch(() => {});
  console.log(`${width}x${height}: ${found.length === 0 ? "clean" : `${found.length} problem(s)`} (${Math.round((Date.now() - t0) / 1000)} s)`);
  for (const f of found) console.log(`  ${f}`);
  bad += found.length;
}
await h.close();
process.exit(bad === 0 ? 0 : 1);
