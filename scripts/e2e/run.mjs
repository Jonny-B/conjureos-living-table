// The e2e runner.
//
//   node scripts/e2e/run.mjs [--root <checkout>] [--mode dev|dist] [--only <text>]
//        [--headed] [--shots <dir>] [--json <file>] [--list]
//
//   --root   the checkout to build and test (default: the cwd)
//   --mode   dev (default): esbuild bundle of src/main.tsx, like `npm run dev`
//            dist: the built dist/living-table.html (needs network: React loads
//            from a CDN, so the "no foreign host" rule is relaxed for it)
//   --only   run specs whose name contains this text
//   --shots  save a screenshot per game on failure (default: <tmp>/lt-e2e-shots)
//
// Specs live in scripts/e2e/specs/*.spec.mjs and export `specs`, an array of
// { name, run({ h, newGame, assert }) }. After every spec the runner checks
// that no page it opened logged a console error, threw, asked for a non-local
// host, or made an AI call the spec had not scripted. A spec that expects one
// of those clears it first (game.consoleErrors.length = 0 and so on).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startHarness } from "./lib/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const flag = (k) => args.includes(k);

const root = path.resolve(opt("--root", process.cwd()));
const mode = opt("--mode", "dev");
const only = opt("--only", "");
const shotsDir = path.resolve(opt("--shots", path.join(os.tmpdir(), "lt-e2e-shots")));
const jsonOut = opt("--json", "");

const specDir = path.join(HERE, "specs");
const files = fs.readdirSync(specDir).filter((f) => f.endsWith(".spec.mjs")).sort();
const all = [];
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(specDir, f)).href);
  for (const s of mod.specs) all.push({ file: f, ...s });
}
const picked = all.filter((s) => !only || s.name.includes(only) || s.file.includes(only));

if (flag("--list")) {
  for (const s of all) console.log(`${s.file}: ${s.name}`);
  process.exit(0);
}

const h = await startHarness({ root, mode, headed: flag("--headed"), log: (m) => console.log(`[e2e] ${m}`), shotsDir });
const results = [];
for (const spec of picked) {
  const opened = [];
  const newGame = async (o = {}) => {
    const g = await h.newGame({ ...(mode === "dist" ? { allowHosts: ["ga.jspm.io", "esm.sh", "cdn.jsdelivr.net", "unpkg.com"] } : {}), ...o });
    opened.push(g);
    return g;
  };
  const t0 = Date.now();
  let error = null;
  try {
    await spec.run({ h, newGame, assert, mode });
    for (const g of opened) {
      const p = g.problems();
      if (p.length) throw new Error(`the page was not clean:\n  ${p.join("\n  ")}`);
    }
  } catch (e) {
    error = e;
    for (const [i, g] of opened.entries()) {
      const shot = await g.screenshot(`${spec.file}-${spec.name}-${i}`).catch(() => null);
      if (shot) console.log(`  screenshot: ${shot}`);
    }
  } finally {
    for (const g of opened) await g.close().catch(() => {});
  }
  const ms = Date.now() - t0;
  results.push({ file: spec.file, name: spec.name, pass: !error, ms, error: error ? String(error.message ?? error).split("\n").slice(0, 8).join("\n") : null });
  console.log(`${error ? "FAIL" : "ok  "} ${spec.name} (${ms} ms)`);
  if (error) console.log(String(error.message ?? error).split("\n").map((l) => `     ${l}`).join("\n"));
}
await h.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} specs passed`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ root, mode, at: new Date().toISOString(), results }, null, 2));
void assert;
process.exit(failed.length ? 1 : 0);
