#!/usr/bin/env node
/**
 * Build a self-contained asset bench HTML page from a project's asset
 * registry module (see example-assets.js for the shape).
 *
 *   node build-bench.mjs --assets <module> --out <file.html> [--artifact] [--allow-examples]
 *                        [--data <id>=<file.json> ...]
 *
 * --data (this project's addition) embeds a JSON file as
 * <script type="application/json" id="bench-data-<id>"> for a panel to read at
 * mount time; see dataBlocks() below.
 *
 * Run this from a PROJECT ROOT: a folder that has esbuild installed (or one
 * from which esbuild otherwise resolves). This file has no node_modules of
 * its own, since it ships inside a skill folder, so it looks for esbuild at
 * the caller's cwd first, then falls back to its own folder.
 *
 * What it does, in order:
 *   1. Bundles the assets module alone (Node-side, via esbuild) so it can be
 *      validated without a browser: every rule in `validate()` below.
 *   2. Refuses to build (exit 1) if any asset or panel id still starts with
 *      "EXAMPLE_", unless --allow-examples is passed.
 *   3. Bundles the assets module together with shell.js into one browser
 *      IIFE with esbuild, and inlines it into a single HTML page.
 *   4. Writes the file, re-reads it, sanity-checks its size, and prints
 *      { out, bytes, assets, groups, panels }.
 *
 * Never writes under src/ or public/: a bench inlines a full copy of every
 * asset it shows, so writing one into a shipped or served tree hands every
 * asset in it to whoever can reach that tree. Write it somewhere gitignored
 * (dist-bench/, .bench-out/, a scratch dir) and add a guard test, see
 * bench.guard.test.mjs, so a future commit cannot put it back there by
 * accident.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- args -------------------------------------------------------------

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

const assetsArg = arg("assets");
const outArg = arg("out");
const ARTIFACT = flag("artifact");
const ALLOW_EXAMPLES = flag("allow-examples");

if (!assetsArg || !outArg) {
  console.error("usage: node build-bench.mjs --assets <module> --out <file.html> [--artifact] [--allow-examples]");
  process.exit(1);
}

const ASSETS_PATH = resolve(process.cwd(), assetsArg);
const OUT_PATH = resolve(process.cwd(), outArg);
const SHELL_PATH = join(HERE, "shell.js");

function die(message) {
  console.error(`asset bench: ${message}`);
  process.exit(1);
}

function isUnder(child, parentDir) {
  const rel = relative(parentDir, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

for (const shipped of ["src", "public"]) {
  const dir = resolve(process.cwd(), shipped);
  if (isUnder(OUT_PATH, dir)) {
    die(
      `refusing to write under ${shipped}/ (${OUT_PATH}).\n` +
        `A bench inlines a copy of every asset it shows. ${shipped}/ is what this project ships or ` +
        `serves, so a bench written there hands every one of those assets to it through the back door. ` +
        `Point --out somewhere gitignored instead (for example dist-bench/bench.html) and add a guard ` +
        `test, see bench.guard.test.mjs.`,
    );
  }
}

// ---- resolve esbuild from the caller's project, not from this skill ---

function loadEsbuild() {
  const tried = [];
  for (const base of [process.cwd(), HERE]) {
    try {
      const req = createRequire(join(base, "noop.cjs"));
      return req("esbuild");
    } catch (e) {
      tried.push(`  ${base}: ${e.message}`);
    }
  }
  die(
    `could not resolve esbuild.\nTried:\n${tried.join("\n")}\n` +
      `Run this from a project root that has esbuild installed (npm i -D esbuild).`,
  );
}
const esbuild = loadEsbuild();

// ---- 1. bundle the registry alone (Node-side) for validation ----------

async function loadRegistry(assetsPath) {
  let bundled;
  try {
    bundled = await esbuild.build({
      entryPoints: [assetsPath],
      bundle: true,
      format: "esm",
      platform: "neutral",
      write: false,
      logLevel: "silent",
    });
  } catch (e) {
    die(`could not bundle ${assetsPath}:\n${e.message}`);
  }
  const tmp = join(tmpdir(), `bench-registry-${process.pid}-${Date.now()}.mjs`);
  await writeFile(tmp, bundled.outputFiles[0].text, "utf8");
  try {
    const mod = await import(pathToFileURL(tmp).href);
    if (!mod.default) die(`${assetsPath}: no default export. The registry must be the module's default export.`);
    return mod.default;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// ---- 2. validate ---------------------------------------------------------

function validate(bench) {
  if (typeof bench !== "object" || bench === null) die("the assets module's default export is not an object");
  if (!bench.title) die('registry.title is required (a 2-4 word name, used as the page <title>)');
  if (!bench.source) die("registry.source is required (a footer line: where the assets live and which script built the page)");
  if (!Array.isArray(bench.assets) || bench.assets.length === 0) die("registry.assets must be a non-empty array");

  const seenAssetIds = new Set();
  for (const a of bench.assets) {
    const tag = a && a.id ? `asset "${a.id}"` : "an asset";
    if (!a || !a.id) die(`${tag} is missing an id`);
    if (seenAssetIds.has(a.id)) die(`duplicate asset id: "${a.id}"`);
    seenAssetIds.add(a.id);
    if (!a.group) die(`${tag}: missing "group"`);
    if (!Number.isInteger(a.w) || a.w <= 0) die(`${tag}: "w" must be a positive integer`);
    if (!Number.isInteger(a.h) || a.h <= 0) die(`${tag}: "h" must be a positive integer`);

    const kinds = ["pixels", "draw", "anim"].filter((k) => a[k] != null);
    if (kinds.length === 0) die(`${tag}: needs exactly one of pixels, draw or anim, has none`);
    if (kinds.length > 1) die(`${tag}: needs exactly one of pixels, draw or anim, has ${kinds.join(" + ")}`);

    if (a.pixels) {
      if (!a.palette || !bench.palettes || !bench.palettes[a.palette]) {
        die(`${tag}: pixels needs "palette" naming a key in registry.palettes (got ${JSON.stringify(a.palette)})`);
      }
      const pal = bench.palettes[a.palette];
      if (!Array.isArray(a.pixels) || a.pixels.length !== a.h) {
        die(`${tag}: pixels must have exactly ${a.h} rows (h), has ${a.pixels?.length ?? 0}`);
      }
      a.pixels.forEach((row, y) => {
        if (!Array.isArray(row) || row.length !== a.w) {
          die(`${tag}: pixels row ${y} must have exactly ${a.w} entries (w), has ${row?.length ?? 0}`);
        }
        row.forEach((idx, x) => {
          if (idx !== -1 && (!Number.isInteger(idx) || idx < 0 || idx >= pal.length)) {
            die(`${tag}: pixels[${y}][${x}] = ${idx} is out of range for palette "${a.palette}" (0..${pal.length - 1}, or -1 for transparent)`);
          }
        });
      });
    }

    if (a.draw && typeof a.draw !== "function") die(`${tag}: draw must be a function`);

    if (a.anim) {
      for (const k of ["dur", "blankState", "fn", "draw"]) {
        if (a.anim[k] == null) die(`${tag}: anim is missing "${k}"`);
      }
      if (typeof a.anim.dur !== "number" || a.anim.dur <= 0) die(`${tag}: anim.dur must be a positive number`);
      for (const k of ["blankState", "fn", "draw"]) {
        if (typeof a.anim[k] !== "function") die(`${tag}: anim.${k} must be a function`);
      }
    }
  }

  const seenPanelIds = new Set();
  for (const p of bench.panels ?? []) {
    const tag = p && p.id ? `panel "${p.id}"` : "a panel";
    if (!p || !p.id) die(`${tag} is missing an id`);
    if (seenPanelIds.has(p.id)) die(`duplicate panel id: "${p.id}"`);
    seenPanelIds.add(p.id);
    if (typeof p.mount !== "function") die(`${tag}: mount must be a function`);
  }

  if (!ALLOW_EXAMPLES) {
    const examples = [
      ...bench.assets.filter((a) => a.id.startsWith("EXAMPLE_")).map((a) => `asset "${a.id}"`),
      ...(bench.panels ?? []).filter((p) => p.id.startsWith("EXAMPLE_")).map((p) => `panel "${p.id}"`),
    ];
    if (examples.length > 0) {
      die(
        `${examples.length} example id(s) still in the registry: ${examples.join(", ")}.\n` +
          `The examples are there to show the shape; delete them and add your own assets.\n` +
          `Pass --allow-examples to build anyway (for previewing the template itself).`,
      );
    }
  }

  return bench;
}

// ---- 3. bundle the shell + registry for the browser --------------------

async function bundleForBrowser() {
  const entry = [
    `import bench from ${JSON.stringify(ASSETS_PATH)};`,
    `import { mountBench } from ${JSON.stringify(SHELL_PATH)};`,
    `mountBench(bench, document.getElementById("bench-root"));`,
  ].join("\n");
  let result;
  try {
    result = await esbuild.build({
      stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "bench-entry.js", loader: "js" },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      logLevel: "silent",
    });
  } catch (e) {
    die(`could not bundle the bench for the browser:\n${e.message}`);
  }
  return result.outputFiles[0].text;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- extra data blocks (--data <id>=<file.json>, repeatable) -------------
//
// Bulk data a panel needs (for example pre-rendered sprite frames) rides in the
// page as <script type="application/json" id="bench-data-<id>"> blocks, read by
// the registry at mount time with document.getElementById. Kept out of the
// registry module on purpose: importing it there would make the registry (and
// every test that imports it) depend on a generated, gitignored file.
async function dataBlocks() {
  const blocks = [];
  process.argv.forEach((a, i) => {
    if (a !== "--data") return;
    const spec = process.argv[i + 1] ?? "";
    const eq = spec.indexOf("=");
    if (eq <= 0) die(`--data expects <id>=<file.json>, got ${JSON.stringify(spec)}`);
    blocks.push({ id: spec.slice(0, eq), file: resolve(process.cwd(), spec.slice(eq + 1)) });
  });
  const out = [];
  for (const { id, file } of blocks) {
    if (!/^[a-z0-9-]+$/.test(id)) die(`--data id ${JSON.stringify(id)} must be lowercase letters, digits and dashes`);
    let text;
    try {
      text = await readFile(file, "utf8");
      JSON.parse(text);
    } catch (e) {
      die(`--data ${id}: could not read ${file} as JSON: ${e.message}`);
    }
    // `<` escaped so no string inside the JSON can close the script tag.
    out.push(`<script type="application/json" id="bench-data-${id}">${text.replace(/</g, "\\u003c")}</script>`);
  }
  return out.join("\n");
}

function page(bench, browserCode, data = "") {
  // `</script` inside the inlined bundle would otherwise close our own
  // <script> tag early and truncate the page mid-file.
  const safeCode = browserCode.replace(/<\/script/gi, "<\\/script");
  const body = `<title>${escapeHtml(bench.title)}</title>\n<div id="bench-root"></div>\n${data ? `${data}\n` : ""}<script>\n${safeCode}\n</script>`;
  if (ARTIFACT) return body; // the Artifact host supplies <!doctype>/<html>/<head>/<body>
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head><body>\n${body}\n</body></html>`;
}

// ---- run -----------------------------------------------------------------

const registryRaw = await loadRegistry(ASSETS_PATH);
const bench = validate(registryRaw);
const browserCode = await bundleForBrowser();
const html = page(bench, browserCode, await dataBlocks());

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, html, "utf8");

const written = await readFile(OUT_PATH, "utf8");
if (written.length < 2000) {
  die(`wrote ${OUT_PATH} but it is only ${written.length} bytes, implausibly small for a bench. Something upstream failed silently.`);
}

const groups = new Set(bench.assets.map((a) => a.group));
console.log(
  JSON.stringify(
    {
      out: OUT_PATH,
      bytes: written.length,
      artifact: ARTIFACT,
      assets: bench.assets.length,
      groups: groups.size,
      panels: (bench.panels ?? []).length,
    },
    null,
    1,
  ),
);
