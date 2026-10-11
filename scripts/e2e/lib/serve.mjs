// Builds the game the way `conj-pack dev` does (esbuild, jsx automatic, images
// as data URLs) into a PRIVATE temp directory and serves it from a small static
// server. Nothing is written into the repo except what `npm run dev` already
// writes (.devserve/livingtable-assets.json, gitignored).
//
// Why not `conj-pack dev` itself: it watches src/ and live-reloads, so another
// session editing a file mid-spec reloads the page under the test. This builds
// once and serves a frozen copy.
//
// root: the checkout to build (default: the cwd). Pass a clean snapshot to test
//       an older commit, or the working tree to test the port.
// The committed asset files (asset-files/*.json: the cast and the KayKit library) are served from the checkout's own folder at
// /asset-files/<name>, so a spec can give the page a ConjureOS asset bridge (lib/assets.mjs) that loads them from here.
// `/asset-files/living-table-cast.json?still=1` is the same cast with its idle loops held on their first frame (every clip named "idle" gets an
// fps so low that the frame never moves): a figure standing still stays still, so the board hash settles and the specs that wait for a still
// board (Driver.settle) do not wait out their limit. The bridge asks for it by default; `art: { motion: true }` asks for the real loops.
//
// mode: "dev"  esbuild bundle of src/main.tsx plus /livingtable-assets.json
//       "dist" the already built dist/living-table.html (npm run build). It
//              loads React from a CDN, so it needs network access.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function devIndexHtml(root) {
  const refs = `<link rel="stylesheet" href="/main.css" />\n    <script type="module" src="/main.js"></script>`;
  const idx = path.join(root, "index.html");
  if (fs.existsSync(idx)) {
    const raw = fs.readFileSync(idx, "utf8");
    const moduleScript = /<script\b[^>]*\btype=["']module["'][^>]*>\s*<\/script>/i;
    if (moduleScript.test(raw)) return raw.replace(moduleScript, refs);
    return raw.replace(/<\/body>/i, `${refs}\n  </body>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>dev</title></head><body class="cui-ui"><div id="root"></div>${refs}</body></html>`;
}

function findEntry(root) {
  for (const c of ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "src/index.tsx", "src/index.ts"]) {
    if (fs.existsSync(path.join(root, c))) return c;
  }
  throw new Error(`no entry point under ${root}/src`);
}

async function buildDev(root, outDir, log) {
  const req = createRequire(path.join(root, "package.json"));
  const esbuild = req("esbuild");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), devIndexHtml(root));
  const t0 = Date.now();
  await esbuild.build({
    entryPoints: [path.join(root, findEntry(root))],
    bundle: true,
    outdir: outDir,
    entryNames: "main",
    format: "esm",
    jsx: "automatic",
    loader: Object.fromEntries(IMAGE_EXTS.map((e) => [e, "dataurl"])),
    absWorkingDir: root,
    logLevel: "warning",
  });
  if (!fs.existsSync(path.join(outDir, "main.css"))) fs.writeFileSync(path.join(outDir, "main.css"), "");
  log(`built ${root} in ${Date.now() - t0} ms`);

  copyDevManifest(root, outDir, log);
}

/**
 * The real sprite library, so art loads exactly as `npm run dev` shows it.
 * Without it the app falls back to a four-colour placeholder manifest (and a
 * served 404 for the probe, which the browser logs as a console error).
 */
function copyDevManifest(root, outDir, log) {
  const manifestScript = path.join(root, "scripts/assets/build-dev-manifest.ts");
  if (!fs.existsSync(manifestScript)) {
    log("no scripts/assets/build-dev-manifest.ts: the app will use its placeholder art");
    return;
  }
  execFileSync("npx", ["-y", "tsx", "scripts/assets/build-dev-manifest.ts"], { cwd: root, shell: true, stdio: "pipe" });
  const made = path.join(root, ".devserve", "livingtable-assets.json");
  fs.copyFileSync(made, path.join(outDir, "livingtable-assets.json"));
  log(`dev manifest: ${(fs.statSync(made).size / 1024).toFixed(0)} KB`);
}

const ASSET_URL = "/asset-files/";

/** The cast with every idle clip held on its first frame (see the note at the top), made once per server. */
function stillCast(file) {
  const cast = JSON.parse(fs.readFileSync(file, "utf8"));
  const hold = (clips) => {
    for (const c of clips ?? []) if (c.clip === "idle") c.fps = 1e-9;
  };
  for (const style of cast.styles ?? []) {
    for (const ch of style.characters ?? []) hold(ch.clips);
    for (const gear of style.gear ?? []) hold(gear.clips);
  }
  return JSON.stringify(cast);
}

function serveDir(outDir, indexFile, assetDir = null) {
  let still = null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/" + indexFile;
    // The checkout's asset files, by name, from their own folder (not copied into the build).
    const fromAssets = assetDir !== null && rel.startsWith(ASSET_URL);
    const file = fromAssets ? path.normalize(path.join(assetDir, rel.slice(ASSET_URL.length))) : path.normalize(path.join(outDir, rel));
    if (!file.startsWith(fromAssets ? assetDir : outDir)) {
      res.writeHead(403).end();
      return;
    }
    if (rel === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (fromAssets && url.searchParams.has("still") && path.basename(file) === "living-table-cast.json" && fs.existsSync(file)) {
      still ??= stillCast(file);
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" }).end(still);
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Build and serve. Returns { url, mode, root, close() }. */
export async function startServer({ root = process.cwd(), mode = "dev", log = () => {} } = {}) {
  root = path.resolve(root);
  let outDir;
  let indexFile = "index.html";
  let temp = null;
  if (mode === "dist") {
    const html = path.join(root, "dist", "living-table.html");
    if (!fs.existsSync(html)) throw new Error(`${html} is missing: run npm run build first`);
    // A temp copy, so the dev manifest can sit beside the page without
    // touching dist/ (the shipped bundle never contains it; see gamesApi.ts).
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "lt-e2e-"));
    outDir = temp;
    fs.copyFileSync(html, path.join(temp, "living-table.html"));
    indexFile = "living-table.html";
    copyDevManifest(root, outDir, log);
  } else {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "lt-e2e-"));
    outDir = temp;
    await buildDev(root, outDir, log);
  }
  const assetDir = path.join(root, "asset-files");
  const server = await serveDir(path.resolve(outDir), indexFile, fs.existsSync(assetDir) ? path.resolve(assetDir) : null);
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    mode,
    root,
    /** The dev art manifest this server serves (the real library), or null when there is none. */
    manifestFile: fs.existsSync(path.join(outDir, "livingtable-assets.json")) ? path.join(outDir, "livingtable-assets.json") : null,
    close: async () => {
      await new Promise((r) => server.close(r));
      if (temp) fs.rmSync(temp, { recursive: true, force: true });
    },
  };
}
