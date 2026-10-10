/**
 * The bench shell: vanilla DOM plus canvas, no framework, no build step of
 * its own (build-bench.mjs bundles this file together with a project's
 * registry into one script).
 *
 * Exports a single function, mountBench(bench, rootElement), which builds
 * the whole page into rootElement: header, tab bar (Library plus one tab per
 * custom panel), the library grid with filters, and the per-asset detail
 * view with its scrubber.
 *
 * See SKILL.md for the registry contract this file consumes.
 */

// ---- seeded randomness ----------------------------------------------------
//
// Every asset renders from a PRNG seeded by a hash of its own id, never from
// Math.random or Date.now. That is what makes "the same asset renders
// identically every time" true: a card redrawn on scroll, a detail view
// reopened later, and a screenshot taken twice all agree.

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRng(seed) {
  const n = typeof seed === "string" ? hashStr(seed) : seed >>> 0;
  return mulberry32(n);
}

// ---- drawing ----------------------------------------------------------

/**
 * Draw one asset into ctx at the given integer scale. Handles all three
 * asset kinds (pixels+palette, draw, anim) the same way regardless of
 * caller, so a card and a detail view can share this one function.
 */
function drawAsset(bench, ctx, asset, { scale = 1, t = 0, rng } = {}) {
  const seed = rng || seededRng(asset.id);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  if (asset.pixels) {
    const pal = (bench.palettes && bench.palettes[asset.palette]) || [];
    for (let y = 0; y < asset.h; y++) {
      const row = asset.pixels[y] || [];
      for (let x = 0; x < asset.w; x++) {
        const idx = row[x];
        if (idx === -1 || idx == null) continue;
        const rgb = pal[idx];
        if (!rgb) continue;
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  } else if (asset.draw) {
    asset.draw(ctx, { rng: seed, scale });
  } else if (asset.anim) {
    const state = asset.anim.blankState();
    asset.anim.fn(t, state);
    asset.anim.draw(ctx, state, { rng: seed, scale });
  }
  ctx.restore();
}

function makeCanvas(w, h, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return canvas;
}

function tileDataUrl(bench, assetId) {
  const asset = bench.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  const canvas = makeCanvas(asset.w, asset.h, 1);
  drawAsset(bench, canvas.getContext("2d"), asset, { scale: 1, t: 0 });
  return { url: canvas.toDataURL("image/png"), w: asset.w, h: asset.h };
}

// ---- API handed to panels -----------------------------------------------

function createApi(bench) {
  return {
    bench,
    drawAsset: (ctx, asset, opts) => drawAsset(bench, ctx, asset, opts),
    makeCanvas,
    seededRng,
    assetById: (id) => bench.assets.find((a) => a.id === id),
  };
}

// ---- styling ---------------------------------------------------------
//
// Tokens on :root (the light set), redefined for dark under a media query
// guarded by :not([data-theme="light"]), and again under [data-theme="dark"]
// so an Artifact host can force either theme regardless of OS setting.
// Every component below reads a token; none hardcodes a color that only
// works in one theme.

const STYLE = `
:root{
  color-scheme:light;
  --bn-bg:#f6f4ef; --bn-panel:#ffffff; --bn-panel-alt:#efece4; --bn-line:#ddd7c9;
  --bn-text:#1d1b16; --bn-muted:#6c6656; --bn-accent:#6d4fe0; --bn-accent-ink:#ffffff;
  --bn-focus:#1d63e0; --bn-danger:#b3311d; --bn-code-bg:#eee9db;
  --bn-checker-a:#e4e0d3; --bn-checker-b:#f6f4ef; --bn-dark-bg:#17161c; --bn-light-bg:#ffffff;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme:dark;
    --bn-bg:#131319; --bn-panel:#1b1b23; --bn-panel-alt:#22222c; --bn-line:#31313d;
    --bn-text:#eceaf5; --bn-muted:#9c98ad; --bn-accent:#a48af9; --bn-accent-ink:#1a1330;
    --bn-focus:#8ab4ff; --bn-danger:#ff7a68; --bn-code-bg:#26262f;
    --bn-checker-a:#232330; --bn-checker-b:#1b1b23; --bn-dark-bg:#0c0c10; --bn-light-bg:#2a2a34;
  }
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bn-bg:#131319; --bn-panel:#1b1b23; --bn-panel-alt:#22222c; --bn-line:#31313d;
  --bn-text:#eceaf5; --bn-muted:#9c98ad; --bn-accent:#a48af9; --bn-accent-ink:#1a1330;
  --bn-focus:#8ab4ff; --bn-danger:#ff7a68; --bn-code-bg:#26262f;
  --bn-checker-a:#232330; --bn-checker-b:#1b1b23; --bn-dark-bg:#0c0c10; --bn-light-bg:#2a2a34;
}
html,body{margin:0;padding:0;background:var(--bn-bg);color:var(--bn-text)}
#bench-root,#bench-root *,#bench-root *::before,#bench-root *::after{box-sizing:border-box}
#bench-root{
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color:var(--bn-text); background:var(--bn-bg); min-height:100vh;
  padding-inline:16px; padding-block:18px 28px;
}
#bench-root .bn-wrap{max-width:1180px;margin:0 auto}
#bench-root *:focus-visible{outline:2px solid var(--bn-focus);outline-offset:2px;border-radius:4px}
#bench-root h1{font-size:18px;margin:0 0 2px;letter-spacing:-.01em}
#bench-root .bn-counts{color:var(--bn-muted);font-size:12.5px;margin:0 0 16px}
#bench-root .bn-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--bn-line);margin-bottom:14px}
#bench-root .bn-tab{font:inherit;font-size:13px;background:transparent;border:0;
  padding:8px 12px;cursor:pointer;color:var(--bn-muted);border-bottom:2px solid transparent;margin-bottom:-1px}
#bench-root .bn-tab:hover{color:var(--bn-text)}
#bench-root .bn-tab.on{color:var(--bn-text);border-bottom-color:var(--bn-accent);font-weight:600}
#bench-root .bn-panel{display:none}
#bench-root .bn-panel.on{display:block}
#bench-root .bn-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
#bench-root .bn-chips{display:inline-flex;gap:6px;flex-wrap:wrap}
#bench-root .bn-chip{font:inherit;font-size:12.5px;background:var(--bn-panel);border:1px solid var(--bn-line);
  color:var(--bn-text);border-radius:999px;padding:5px 11px;cursor:pointer}
#bench-root .bn-chip:hover{border-color:var(--bn-accent)}
#bench-root .bn-chip.on{background:var(--bn-accent);color:var(--bn-accent-ink);border-color:var(--bn-accent);font-weight:600}
#bench-root input.bn-search{font:inherit;font-size:13px;background:var(--bn-panel);border:1px solid var(--bn-line);
  color:var(--bn-text);border-radius:8px;padding:7px 10px;min-width:0;flex:1 1 160px}
#bench-root select.bn-select{font:inherit;font-size:13px;background:var(--bn-panel);border:1px solid var(--bn-line);
  color:var(--bn-text);border-radius:8px;padding:7px 8px}
#bench-root label.bn-field{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--bn-muted);white-space:nowrap}
#bench-root .bn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
#bench-root .bn-card{font:inherit;background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:10px;
  padding:8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;color:var(--bn-text)}
#bench-root .bn-card:hover{border-color:var(--bn-accent)}
#bench-root .bn-card-stage{width:100%;aspect-ratio:1;border-radius:6px;overflow:hidden;display:flex;
  align-items:center;justify-content:center;background-color:var(--bn-checker-a);
  background-image:linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%),
    linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%);
  background-size:14px 14px;background-position:0 0,7px 7px}
#bench-root .bn-card-stage.bg-dark{background:var(--bn-dark-bg);background-image:none}
#bench-root .bn-card-stage.bg-light{background:var(--bn-light-bg);background-image:none}
#bench-root .bn-card canvas{image-rendering:pixelated;max-width:100%;max-height:100%}
#bench-root .bn-card-id{font-size:11px;color:var(--bn-muted);word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
#bench-root .bn-empty{color:var(--bn-muted);padding:24px 4px;font-size:13px}
#bench-root .bn-detail{background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:12px;padding:14px;margin-bottom:16px}
#bench-root .bn-detail-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
#bench-root .bn-detail-title{font-size:14px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
#bench-root button.bn-close{font:inherit;font-size:12.5px;background:var(--bn-panel-alt);border:1px solid var(--bn-line);
  color:var(--bn-text);border-radius:7px;padding:6px 10px;cursor:pointer}
#bench-root button.bn-close:hover{border-color:var(--bn-accent)}
#bench-root .bn-detail-body{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
#bench-root .bn-detail-stage{flex:0 0 auto;border-radius:8px;overflow:hidden;display:inline-flex;
  align-items:flex-start;justify-content:flex-start;
  background-color:var(--bn-checker-a);
  background-image:linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%),
    linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%);
  background-size:16px 16px;background-position:0 0,8px 8px}
#bench-root .bn-detail-stage.bg-dark{background:var(--bn-dark-bg);background-image:none}
#bench-root .bn-detail-stage.bg-light{background:var(--bn-light-bg);background-image:none}
#bench-root .bn-detail-stage canvas{image-rendering:pixelated;display:block}
#bench-root .bn-meta{flex:1 1 220px;min-width:0}
#bench-root table.bn-meta-table{border-collapse:collapse;width:100%;font-size:12.5px;table-layout:fixed}
#bench-root table.bn-meta-table td{padding:4px 6px;border-bottom:1px solid var(--bn-line);vertical-align:top}
#bench-root table.bn-meta-table td:first-child{color:var(--bn-muted);white-space:nowrap;padding-right:10px}
#bench-root table.bn-meta-table code{background:var(--bn-code-bg);padding:1px 5px;border-radius:4px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}
#bench-root .bn-anim-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
#bench-root button.bn-btn{font:inherit;font-size:12.5px;background:var(--bn-panel-alt);border:1px solid var(--bn-line);
  color:var(--bn-text);border-radius:7px;padding:6px 11px;cursor:pointer}
#bench-root button.bn-btn:hover{border-color:var(--bn-accent)}
#bench-root input.bn-scrub{accent-color:var(--bn-accent);width:180px}
#bench-root .bn-time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--bn-muted);min-width:90px}
#bench-root footer.bn-footer{color:var(--bn-muted);font-size:12px;margin-top:24px;padding-top:14px;border-top:1px solid var(--bn-line)}
#bench-root footer.bn-footer p{margin:0 0 8px;max-width:86ch}
#bench-root footer.bn-footer code{background:var(--bn-code-bg);padding:1px 5px;border-radius:4px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
@media (max-width:480px){
  #bench-root .bn-detail-body{flex-direction:column}
  #bench-root .bn-meta{flex-basis:auto;width:100%}
}
`;

function injectStyle() {
  if (document.getElementById("bench-style")) return;
  const style = document.createElement("style");
  style.id = "bench-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

// ---- library filtering -------------------------------------------------

function matchesQuery(asset, q) {
  if (!q) return true;
  q = q.toLowerCase();
  if (asset.id.toLowerCase().includes(q)) return true;
  if (asset.label && asset.label.toLowerCase().includes(q)) return true;
  if (asset.tags && asset.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- mount --------------------------------------------------------------

export function mountBench(bench, root) {
  injectStyle();
  const api = createApi(bench);
  const groups = [...new Set(bench.assets.map((a) => a.group))].sort();
  const panels = bench.panels || [];
  const tileCache = new Map();
  // This project's addition: bench.library === false drops the sprite library tab (the panels are the bench).
  const hasLibrary = bench.library !== false;

  document.title = bench.title;

  root.innerHTML = `
    <div class="bn-wrap">
      <h1>${escapeHtml(bench.title)}</h1>
      <p class="bn-counts"${hasLibrary ? "" : " hidden"}>${bench.assets.length} asset${bench.assets.length === 1 ? "" : "s"} across ${groups.length} group${groups.length === 1 ? "" : "s"}${panels.length ? ` &middot; ${panels.length} panel${panels.length === 1 ? "" : "s"}` : ""}</p>
      <div class="bn-tabs" role="tablist"></div>
      <div class="bn-panels"></div>
      <footer class="bn-footer"></footer>
    </div>
  `;

  const tabsEl = root.querySelector(".bn-tabs");
  const panelsEl = root.querySelector(".bn-panels");
  const footerEl = root.querySelector(".bn-footer");

  for (const note of bench.notes || []) {
    const p = document.createElement("p");
    p.textContent = note;
    footerEl.appendChild(p);
  }
  const sourceP = document.createElement("p");
  sourceP.innerHTML = `Source: <code>${escapeHtml(bench.source)}</code>`;
  footerEl.appendChild(sourceP);

  // ---- Library tab/panel -------------------------------------------------

  const libraryTab = document.createElement("button");
  libraryTab.className = "bn-tab";
  libraryTab.type = "button";
  libraryTab.textContent = bench.libraryLabel || "Library";
  libraryTab.setAttribute("role", "tab");
  // This project's addition: bench.libraryLast puts the Library tab after the
  // panels (appended below, once they exist) for a bench whose panels are the
  // main thing; by default it comes first, as in the template.
  if (hasLibrary && !bench.libraryLast) tabsEl.appendChild(libraryTab);

  const libraryPanel = document.createElement("section");
  libraryPanel.className = "bn-panel";
  libraryPanel.innerHTML = `
    <div class="bn-controls">
      <span class="bn-chips" id="bn-groups"></span>
      <input class="bn-search" type="search" placeholder="Search id, label, tags" aria-label="Search assets">
      <label class="bn-field">Scale
        <select class="bn-select" id="bn-scale"></select>
      </label>
      <label class="bn-field">Background
        <select class="bn-select" id="bn-bg"></select>
      </label>
    </div>
    <div class="bn-detail" id="bn-detail" hidden></div>
    <div class="bn-grid" id="bn-grid"></div>
  `;
  if (hasLibrary) panelsEl.appendChild(libraryPanel);

  const groupChipsEl = libraryPanel.querySelector("#bn-groups");
  const searchEl = libraryPanel.querySelector(".bn-search");
  const scaleEl = libraryPanel.querySelector("#bn-scale");
  const bgEl = libraryPanel.querySelector("#bn-bg");
  const gridEl = libraryPanel.querySelector("#bn-grid");
  const detailEl = libraryPanel.querySelector("#bn-detail");

  let activeGroup = "All";
  let query = "";
  let scale = 4;
  let bgId = "checker";

  for (const g of ["All", ...groups]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bn-chip" + (g === activeGroup ? " on" : "");
    chip.textContent = g;
    chip.onclick = () => {
      activeGroup = g;
      [...groupChipsEl.children].forEach((c) => c.classList.toggle("on", c === chip));
      renderGrid();
    };
    groupChipsEl.appendChild(chip);
  }

  for (const s of [1, 2, 3, 4, 6, 8]) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s}x`;
    if (s === scale) opt.selected = true;
    scaleEl.appendChild(opt);
  }
  scaleEl.onchange = () => {
    scale = Number(scaleEl.value);
    renderGrid();
    if (currentDetailAsset) openDetail(currentDetailAsset);
  };

  const builtinBackgrounds = [
    { id: "checker", label: "Checker" },
    { id: "dark", label: "Dark" },
    { id: "light", label: "Light" },
  ];
  for (const bg of [...builtinBackgrounds, ...(bench.backgrounds || [])]) {
    const opt = document.createElement("option");
    opt.value = bg.id;
    opt.textContent = bg.label;
    if (bg.id === bgId) opt.selected = true;
    bgEl.appendChild(opt);
  }
  bgEl.onchange = () => {
    bgId = bgEl.value;
    applyBackground(gridEl);
    if (currentDetailAsset) openDetail(currentDetailAsset);
  };

  function backgroundStyle(el) {
    const custom = (bench.backgrounds || []).find((b) => b.id === bgId);
    el.classList.remove("bg-dark", "bg-light");
    el.style.backgroundImage = "";
    el.style.backgroundColor = "";
    el.style.backgroundSize = "";
    if (bgId === "dark") {
      el.classList.add("bg-dark");
    } else if (bgId === "light") {
      el.classList.add("bg-light");
    } else if (bgId === "checker") {
      // default CSS classes already draw the checker
    } else if (custom) {
      if (custom.css) {
        el.style.backgroundImage = "none";
        el.style.background = custom.css;
      } else if (custom.tile) {
        if (!tileCache.has(custom.tile)) tileCache.set(custom.tile, tileDataUrl(bench, custom.tile));
        const tile = tileCache.get(custom.tile);
        if (tile) {
          el.style.backgroundImage = `url(${tile.url})`;
          el.style.backgroundSize = `${tile.w}px ${tile.h}px`;
          el.style.backgroundRepeat = "repeat";
        }
      }
    }
  }
  function applyBackground(scopeEl) {
    scopeEl.querySelectorAll(".bn-card-stage").forEach(backgroundStyle);
  }

  searchEl.oninput = () => {
    query = searchEl.value;
    renderGrid();
  };

  let observer = null;
  function renderGrid() {
    if (observer) observer.disconnect();
    gridEl.innerHTML = "";
    const filtered = bench.assets.filter((a) => (activeGroup === "All" || a.group === activeGroup) && matchesQuery(a, query));
    if (filtered.length === 0) {
      gridEl.innerHTML = '<p class="bn-empty">No assets match.</p>';
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target;
          observer.unobserve(card);
          const id = card.dataset.id;
          const asset = bench.assets.find((a) => a.id === id);
          if (!asset || card.dataset.drawn) continue;
          card.dataset.drawn = "1";
          const stage = card.querySelector(".bn-card-stage");
          const cardScale = Math.max(1, Math.min(scale, Math.floor(112 / Math.max(asset.w, asset.h))));
          const canvas = makeCanvas(asset.w, asset.h, cardScale);
          drawAsset(bench, canvas.getContext("2d"), asset, { scale: cardScale, t: 0 });
          stage.appendChild(canvas);
        }
      },
      { rootMargin: "200px" },
    );
    for (const asset of filtered) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "bn-card";
      card.dataset.id = asset.id;
      card.innerHTML = `<span class="bn-card-stage"></span><span class="bn-card-id">${escapeHtml(asset.label || asset.id)}</span>`;
      backgroundStyle(card.querySelector(".bn-card-stage"));
      card.onclick = () => openDetail(asset);
      gridEl.appendChild(card);
      observer.observe(card);
    }
  }

  // ---- detail view --------------------------------------------------------

  let currentDetailAsset = null;
  let animState = { playing: false, t: 0, raf: 0, lastTime: 0 };

  function stopAnimLoop() {
    if (animState.raf) cancelAnimationFrame(animState.raf);
    animState.raf = 0;
  }

  function closeDetail() {
    stopAnimLoop();
    currentDetailAsset = null;
    detailEl.hidden = true;
    detailEl.innerHTML = "";
  }

  function paletteIndicesUsed(asset) {
    const seen = new Set();
    for (const row of asset.pixels) for (const idx of row) if (idx !== -1 && idx != null) seen.add(idx);
    return [...seen].sort((a, b) => a - b);
  }

  function openDetail(asset) {
    stopAnimLoop();
    currentDetailAsset = asset;
    detailEl.hidden = false;

    const rows = [
      ["id", `<code>${escapeHtml(asset.id)}</code>`],
      ["group", escapeHtml(asset.group)],
      ["size", `${asset.w} &times; ${asset.h}`],
    ];
    if (asset.meta) rows.push(["meta", `<code>${escapeHtml(JSON.stringify(asset.meta))}</code>`]);
    if (asset.pixels) rows.push(["palette indices", paletteIndicesUsed(asset).join(", ") || "(none used)"]);
    if (asset.anim) rows.push(["duration", `${asset.anim.dur.toFixed(2)}s`]);

    detailEl.innerHTML = `
      <div class="bn-detail-head">
        <span class="bn-detail-title">${escapeHtml(asset.label || asset.id)}</span>
        <button type="button" class="bn-close">Close</button>
      </div>
      <div class="bn-detail-body">
        <span class="bn-detail-stage"></span>
        <div class="bn-meta">
          <table class="bn-meta-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
          ${asset.anim ? '<div class="bn-anim-controls" id="bn-anim-controls"></div>' : ""}
        </div>
      </div>
    `;
    detailEl.querySelector(".bn-close").onclick = closeDetail;

    const stage = detailEl.querySelector(".bn-detail-stage");
    backgroundStyle(stage);
    const canvas = makeCanvas(asset.w, asset.h, scale);
    stage.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    if (!asset.anim) {
      drawAsset(bench, ctx, asset, { scale, t: 0 });
      return;
    }

    // Anim assets: start paused always, this is what "no autoplay" means in
    // practice, and keep the render loop running even while paused so a
    // resize or a scale change never leaves a stale frame on screen.
    animState = { playing: false, t: 0, raf: 0, lastTime: performance.now() };
    const dur = asset.anim.dur;
    const controls = detailEl.querySelector("#bn-anim-controls");
    controls.innerHTML = `
      <button type="button" class="bn-btn" id="bn-play">Play</button>
      <button type="button" class="bn-btn" id="bn-back">&lsaquo; frame</button>
      <button type="button" class="bn-btn" id="bn-fwd">frame &rsaquo;</button>
      <input type="range" class="bn-scrub" id="bn-scrub" min="0" max="${dur}" step="${1 / 60}" value="0">
      <span class="bn-time" id="bn-time">0.00s / ${dur.toFixed(2)}s</span>
    `;
    const playBtn = controls.querySelector("#bn-play");
    const backBtn = controls.querySelector("#bn-back");
    const fwdBtn = controls.querySelector("#bn-fwd");
    const scrub = controls.querySelector("#bn-scrub");
    const timeEl = controls.querySelector("#bn-time");
    let scrubbing = false;

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawAsset(bench, ctx, asset, { scale, t: animState.t });
      timeEl.textContent = `${animState.t.toFixed(2)}s / ${dur.toFixed(2)}s`;
      if (!scrubbing) scrub.value = String(animState.t);
    }
    function step(dt) {
      animState.t += dt;
      if (animState.t >= dur) animState.t -= dur; // loop, a bench is for repeated review
    }
    function frame(now) {
      const dt = Math.min(0.1, (now - animState.lastTime) / 1000);
      animState.lastTime = now;
      if (animState.playing && !scrubbing) step(dt);
      render();
      animState.raf = requestAnimationFrame(frame);
    }
    animState.raf = requestAnimationFrame(frame);

    playBtn.onclick = () => {
      animState.playing = !animState.playing;
      animState.lastTime = performance.now();
      playBtn.textContent = animState.playing ? "Pause" : "Play";
    };
    function pauseForStep() {
      animState.playing = false;
      playBtn.textContent = "Play";
    }
    backBtn.onclick = () => {
      pauseForStep();
      animState.t = Math.max(0, animState.t - 1 / 60);
    };
    fwdBtn.onclick = () => {
      pauseForStep();
      animState.t = Math.min(dur, animState.t + 1 / 60);
    };
    scrub.oninput = () => {
      scrubbing = true;
      pauseForStep();
      animState.t = Number(scrub.value);
    };
    scrub.onchange = () => {
      scrubbing = false;
    };
    render();
  }

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentDetailAsset) closeDetail();
  });

  // ---- panel tabs ---------------------------------------------------------

  const panelState = new Map(); // id -> { el, cleanup, mounted }

  function activate(id) {
    tabsEl.querySelectorAll(".bn-tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === id));
    panelsEl.querySelectorAll(".bn-panel").forEach((p) => p.classList.toggle("on", p.dataset.tab === id));
    for (const [pid, state] of panelState) {
      if (pid === id && !state.mounted) {
        const cleanup = panel(pid).mount(state.el, api);
        state.cleanup = typeof cleanup === "function" ? cleanup : null;
        state.mounted = true;
      } else if (pid !== id && state.mounted) {
        if (state.cleanup) state.cleanup();
        state.el.innerHTML = "";
        state.mounted = false;
      }
    }
  }
  function panel(id) {
    return panels.find((p) => p.id === id);
  }

  libraryTab.dataset.tab = "__library";
  libraryPanel.dataset.tab = "__library";
  libraryTab.onclick = () => activate("__library");

  for (const p of panels) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "bn-tab";
    tab.textContent = p.label;
    tab.dataset.tab = p.id;
    tab.setAttribute("role", "tab");
    tab.onclick = () => activate(p.id);
    tabsEl.appendChild(tab);

    const section = document.createElement("section");
    section.className = "bn-panel";
    section.dataset.tab = p.id;
    panelsEl.appendChild(section);
    panelState.set(p.id, { el: section, cleanup: null, mounted: false });
  }

  if (hasLibrary && bench.libraryLast) tabsEl.appendChild(libraryTab);
  if (hasLibrary) renderGrid();
  // bench.defaultPanel (this project's addition) opens a panel first instead of the Library.
  const first = bench.defaultPanel && panel(bench.defaultPanel) ? bench.defaultPanel : hasLibrary || panels.length === 0 ? "__library" : panels[0].id;
  activate(first);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
