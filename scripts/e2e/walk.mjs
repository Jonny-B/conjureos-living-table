// The responsive walk: the whole tour (lib/tour.mjs) at every window size, with a screenshot of every screen for the eyes, and the fit checks
// (reachable controls, scroll cues, dead band, clipped text, turn strip, text size, finger-sized targets) at every step.
//
//   node scripts/e2e/walk.mjs [--sizes 320x640,390x844,...|all] [--shots .cache/bench-shots] [--items] [--no-fit] [--root <checkout>] [--headed]
//
// Screenshots land in <shots>/bb-<step>-<width>x<height>.png. "--sizes all" walks every size the fit spec covers (lib/tour.mjs FIT_SIZES).
// A phone or tablet size gets touch, mobile emulation and a pixel ratio of 2 or 3; a desktop size ratio 1. At the end the problems are printed
// as one table (size, step, check, element). Exit code 0 when no size reported a problem.
import assert from "node:assert/strict";
import path from "node:path";
import { startHarness } from "./lib/harness.mjs";
import { tour, profileFor, FIT_SIZES } from "./lib/tour.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const asked = opt("--sizes", "320x640,390x844,768x1024,844x390,667x375,1024x768,1280x800,1280x900,1920x1080,2560x1440,3840x2160");
const sizes = asked === "all" ? FIT_SIZES.map(([w, h]) => [w, h]) : asked.split(",").map((s) => s.split("x").map(Number));
const fit = !args.includes("--no-fit");
const shots = path.resolve(opt("--shots", ".cache/bench-shots"));
const items = args.includes("--items");

const h = await startHarness({ root: path.resolve(opt("--root", process.cwd())), headed: args.includes("--headed"), log: () => {}, shotsDir: path.join(shots, "failures") });
let bad = 0;
const every = [];
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
    const { touch, dpr, mobile } = profileFor(width, height);
    found = await tour(newGame, { width, height, touch, dpr, mobile, shots, items, assert, fit });
  } catch (e) {
    found = [`${width}x${height} the tour stopped: ${String(e.message ?? e).split("\n")[0]}`];
    for (const [i, g] of opened.entries()) await g.screenshot(`walk-stopped-${width}x${height}-${i}`).catch(() => null);
  }
  for (const g of opened) await g.close().catch(() => {});
  console.log(`${width}x${height}: ${found.length === 0 ? "clean" : `${found.length} problem(s)`} (${Math.round((Date.now() - t0) / 1000)} s)`);
  for (const f of found) console.log(`  ${f}`);
  bad += found.length;
  every.push(...found);
}
await h.close();
if (every.length) {
  // One line per distinct failure: size, step, check, then the element and what is wrong (repeats are shown once with a count).
  const rows = new Map();
  for (const f of every) {
    const m = /^(\d+x\d+) ([\w-]+): (?:\[(reach|scroll-cue|dead-band|board-fill|text-clipped|turn-strip|text-size|touch)\] )?([\s\S]*)$/.exec(f) ?? [null, "?", "?", "page", f];
    const key = JSON.stringify([m[1], m[2], m[3] ?? "page", m[4]]);
    rows.set(key, (rows.get(key) ?? 0) + 1);
  }
  console.log("");
  console.log(`size | step | check | element: what is wrong (${rows.size} distinct)`);
  for (const [key, n] of rows) {
    const [size, step, check, what] = JSON.parse(key);
    console.log(`${size} | ${step} | ${check} | ${what.length > 220 ? `${what.slice(0, 217)}...` : what}${n > 1 ? ` (x${n})` : ""}`);
  }
}
process.exit(bad === 0 ? 0 : 1);
