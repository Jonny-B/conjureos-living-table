/**
 * Guard test for the Living Table asset bench (scripts/asset-bench/),
 * adapted from the asset-bench skill's template guard
 * (.claude/skills/asset-bench/template/bench.guard.test.mjs in the ConjureOS
 * repo). Checks the things that are cheap to get wrong and expensive to
 * notice late:
 *
 *   1. No asset or panel id starts with "EXAMPLE_": the template's own
 *      placeholder prefix never belongs in a real registry.
 *   2. Every in-play fantasy sprite (all of scripts/assets/fantasy.ts's
 *      SPRITES but the Healer's, who is out of play) is on the bench's Pieces
 *      tab, so a new sprite can never be silently missing from the bench.
 *      Sci-fi is paused and the bench no longer has a sprite library.
 *   3. The built bench's output path (package.json's "bench" script) is
 *      under .cache/, not under src/ or public/, and IS matched by
 *      .gitignore: a bench inlines a full copy of every asset it shows, so
 *      if its output can be committed or served, that copy escapes whatever
 *      reach rule the real assets have.
 *   4. Nothing under src/ imports scripts/asset-bench: the bench only READS
 *      the game's render/character functions, it must never be a runtime
 *      dependency of the shipped client.
 *
 * Run: npx tsx --test test/livingtable-asset-bench.test.ts
 * (part of the full suite via `npm test`, which runs test/*.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";

const ASSETS_MODULE = new URL("../scripts/asset-bench/assets.ts", import.meta.url);
const BUILT_BENCH_OUT = ".cache/asset-bench/living-table-bench.html"; // repo-root-relative; matches package.json's "bench" script

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

async function loadBench() {
  const mod = await import(ASSETS_MODULE.href);
  return mod.default;
}

test("registry has no EXAMPLE_ ids left", async () => {
  const bench = await loadBench();
  assert.ok(bench, "assets module must have a default export");
  const exampleAssets = (bench.assets || []).filter((a: { id: string }) => a.id.startsWith("EXAMPLE_"));
  const examplePanels = (bench.panels || []).filter((p: { id: string }) => p.id.startsWith("EXAMPLE_"));
  assert.deepEqual(
    [...exampleAssets.map((a: { id: string }) => a.id), ...examplePanels.map((p: { id: string }) => p.id)],
    [],
    "delete every EXAMPLE_ asset and panel; they are the template's placeholders, not this project's",
  );
});

async function loadPieces(): Promise<readonly string[]> {
  const mod = await import(ASSETS_MODULE.href);
  return mod.PIECES_ASSET_IDS;
}

test("every in-play fantasy SPRITES id is on the Pieces tab", async () => {
  const pieces = new Set(await loadPieces());
  const missing = FANTASY_SPRITES.filter((s) => !/healer/.test(s.assetId))
    .map((s) => s.assetId)
    .filter((id) => !pieces.has(id));
  assert.deepEqual(missing, [], `sprite id(s) missing from the Pieces tab: ${missing.join(", ")}`);
});

test("the Pieces tab carries no id that is not a fantasy sprite", async () => {
  const known = new Set(FANTASY_SPRITES.map((s) => s.assetId));
  const extra = (await loadPieces()).filter((id) => !known.has(id));
  assert.deepEqual(extra, [], `Pieces id(s) with no matching SPRITES entry: ${extra.join(", ")}`);
});

test("built bench output is not under src/ or public/", () => {
  const root = repoRoot();
  const out = resolve(root, BUILT_BENCH_OUT);
  for (const shipped of ["src", "public"]) {
    const dir = resolve(root, shipped);
    const rel = relative(dir, out);
    const under = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    assert.ok(!under, `BUILT_BENCH_OUT (${BUILT_BENCH_OUT}) resolves under ${shipped}/, which this project ships or serves`);
  }
});

test("built bench output path is under .cache/", () => {
  assert.ok(
    BUILT_BENCH_OUT.startsWith(".cache/"),
    `BUILT_BENCH_OUT (${BUILT_BENCH_OUT}) should live under .cache/, this project's gitignored scratch build directory`,
  );
});

test("built bench output path is gitignored", () => {
  const root = repoRoot();
  let ignored = false;
  try {
    // Exit code 0 means git-ignored; check-ignore exits 1 for a path that is
    // NOT ignored, which execFileSync throws on, so that path is the "false".
    execFileSync("git", ["check-ignore", "-q", BUILT_BENCH_OUT], { cwd: root });
    ignored = true;
  } catch {
    ignored = false;
  }
  assert.ok(
    ignored,
    `${BUILT_BENCH_OUT} is not matched by .gitignore. A bench inlines a full copy of every asset it shows, ` +
      "so its output must never be committable.",
  );
});

test("nothing under src/ imports scripts/asset-bench", () => {
  const root = repoRoot();
  const srcDir = resolve(root, "src");
  const offenders: string[] = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
      const text = readFileSync(abs, "utf8");
      if (/asset-bench/.test(text)) offenders.push(relative(root, abs));
    }
  }
  walk(srcDir);

  assert.deepEqual(
    offenders,
    [],
    `src/ file(s) referencing scripts/asset-bench: ${offenders.join(", ")}. The bench only READS the game's ` +
      "render/character functions; it must never be a runtime dependency of the shipped client.",
  );
});

test("ASSETS_MODULE resolves under this repo's scripts/asset-bench/", () => {
  const path = fileURLToPath(ASSETS_MODULE);
  assert.ok(path.replace(/\\/g, "/").endsWith("scripts/asset-bench/assets.ts"));
});
