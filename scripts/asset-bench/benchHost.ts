/**
 * The asset bench's side of the table window: the TableHost the Play tab hands to mountTable
 * (src/games/livingtable/table/mountTable.ts), and the art choice every bench tab shares.
 *
 *   ART     The Art row's choice (hand-drawn art or the KayKit conversion, ground, character style, detail), the decoded
 *           KayKit library, and the RenderManifest the chosen art makes. The window asks `host.art` for the picture
 *           catalog, the paint-ready manifest and the animated cast; the other bench tabs read the same choice directly.
 *   DM      The `__ltBenchSample` test hook, else the viewer's claude.use("sample") capability (claude.ai only).
 *   STORAGE localStorage, under the bench's own keys (livingtable-bench-saves-v1, livingtable-bench-ai-adventures-v1).
 *   FILES   The viewer's downloads capability, else a plain browser download.
 *   ENV     `__ltBenchRng` (a test can make a roll land where it needs to), reduced motion, the #sandbox address.
 *
 * The bench keeps the scene across tab visits, so it keeps one TableSession (benchSession) and hands it to every mount.
 * `installBenchHooks` puts the globalThis.__ltBench* handles the headless play scripts read.
 *
 * Import-pure: nothing here touches the page until a function is called (the registry is imported in Node by build-bench.mjs and by
 * the creatures and adventures tests).
 */
import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../assets/fantasy";
import { PALETTE as SCIFI_PALETTE, SPRITES as SCIFI_SPRITES } from "../assets/scifi";
import type { TemplateGenre } from "../../src/games/livingtable/characters/templates";
import { spriteSizeOf, type RenderManifest } from "../../src/games/livingtable/render/canvasRenderer";
import type { TileId } from "../../src/games/livingtable/world/cell";
import { APP_VERSION } from "../../src/version";
import { PLAYABLE_HEROES, type PlayState } from "../../src/games/livingtable/table/state";
import { ADVENTURE_FILES } from "../../src/games/livingtable/table/adventures/data";
import { bindCatalog, catalogFromSprites } from "../../src/games/livingtable/table/catalog";
import { bindAdventures } from "../../src/games/livingtable/table/adventureCatalog";
import { bindFightEnv } from "../../src/games/livingtable/table/fightRules";
import { createTableSession, type TableSession, type TableWindow } from "../../src/games/livingtable/table/mountTable";
import { DICE_SKINS } from "../../src/games/livingtable/table/ui/dice";
import { bindCastSource, castData, type CastData, type CastStyle } from "../../src/games/livingtable/table/ui/cast";
import type { ArtCatalog, SampleFn, TableHost, TableSettings } from "../../src/games/livingtable/table/host";
import { decodeLibrary, kaykitLibrary, partFile } from "./kaykit";

// ===========================================================================
// The sprites: a sprite from either template's flat SPRITES array.
// ===========================================================================

export interface LtSprite {
  assetId: string;
  kind: "tile" | "token" | "prop";
  name: string;
  size: 16;
  walkable: boolean;
  pixels: number[][];
}

export const SPRITES_BY_TEMPLATE: Record<TemplateGenre, readonly LtSprite[]> = {
  fantasy: FANTASY_SPRITES as unknown as LtSprite[],
  scifi: SCIFI_SPRITES as unknown as LtSprite[],
};
const PALETTE_BY_TEMPLATE: Record<TemplateGenre, readonly (readonly [number, number, number])[]> = {
  fantasy: FANTASY_PALETTE,
  scifi: SCIFI_PALETTE,
};

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * The raw RenderManifest per template: unprefixed ids, exactly the shape manifestCache.ts hands the renderer, built straight off each
 * template's own SPRITES + PALETTE with no reimplementation.
 */
function manifestFor(template: TemplateGenre): RenderManifest {
  const palette = PALETTE_BY_TEMPLATE[template].map(([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`);
  const tiles: Record<TileId, { pixels: number[][] }> = {};
  const props: Record<TileId, { pixels: number[][] }> = {};
  const tokens: Record<TileId, { pixels: number[][] }> = {};
  for (const s of SPRITES_BY_TEMPLATE[template]) {
    const entry = { pixels: s.pixels };
    if (s.kind === "tile") tiles[s.assetId] = entry;
    else if (s.kind === "prop") props[s.assetId] = entry;
    else tokens[s.assetId] = entry;
  }
  return { palette, tiles, props, tokens };
}

/** The game's own hand-drawn art, whichever art is on show. */
export const MANIFEST: Record<TemplateGenre, RenderManifest> = { fantasy: manifestFor("fantasy"), scifi: manifestFor("scifi") };

// ===========================================================================
// Art source, shared by every panel: the game's current hand-drawn library,
// or the KayKit conversion (scripts/kaykit/lib_*.py, one part per maker,
// size and style). The conversion keeps every asset id, so the game's own
// renderer draws it unchanged; at 32 px the manifest says spriteSize 32 and
// the renderer scales to match. An id no part covers falls back to the
// current art (2x upscaled at 32 px), and the Pieces tab says which.
// ===========================================================================

export type GroundStyle = "painted" | "lit";
export type CharStyle = "bands" | "pixelart" | "toon" | "plain";
export interface ArtChoice {
  source: "current" | "kaykit";
  ground: GroundStyle;
  chars: CharStyle;
  size: 16 | 32;
}

// KayKit first: it is the art under review. Without a converted library in the build, artManifest falls back to the current art on its own.
export const art: ArtChoice = { source: "kaykit", ground: "painted", chars: "bands", size: 32 };
/** The decoded KayKit library (null until it is): shared by every tab, so a tab that decodes it makes it known to the rest. */
export const artState: { decoded: Map<string, Map<string, number[][]>> | null } = { decoded: null };
const artManifests = new Map<string, RenderManifest>();

function upscalePixels(pixels: number[][], k: number): number[][] {
  if (k === 1) return pixels;
  const out: number[][] = [];
  for (const row of pixels) {
    const wide: number[] = [];
    for (const v of row) for (let i = 0; i < k; i++) wide.push(v);
    for (let i = 0; i < k; i++) out.push(wide.slice());
  }
  return out;
}

function artParts(): Map<string, number[][]>[] {
  const decoded = artState.decoded;
  if (!decoded) return [];
  return [partFile(`ground-${art.ground}`, art.size), partFile("props", art.size), partFile("tokens", art.size, art.chars)]
    .map((f) => decoded.get(f))
    .filter((m): m is Map<string, number[][]> => m !== undefined);
}

/** The chosen KayKit parts (ground style, character style, size) hold this sprite, whichever art is on show. */
export function kaykitHas(assetId: string): boolean {
  return artParts().some((p) => p.has(assetId));
}

/** The sprite the chosen KayKit parts draw for this id, or null. */
export function kaykitPixels(assetId: string): number[][] | null {
  for (const p of artParts()) {
    const px = p.get(assetId);
    if (px) return px;
  }
  return null;
}

/** The RenderManifest a panel should draw `template` with: the KayKit library for fantasy when chosen (and decoded), else the current art. The same object until the choice changes. */
export function artManifest(template: TemplateGenre): RenderManifest {
  if (template !== "fantasy" || art.source === "current" || !artState.decoded) return MANIFEST[template];
  const key = `${art.ground}|${art.chars}|${art.size}`;
  const hit = artManifests.get(key);
  if (hit) return hit;
  const parts = artParts();
  const k = art.size / 16;
  const pick = (id: string, current: number[][]) => {
    for (const p of parts) {
      const px = p.get(id);
      if (px) return px;
    }
    return upscalePixels(current, k);
  };
  const base = MANIFEST.fantasy;
  const m: RenderManifest = { palette: base.palette, tiles: {}, props: {}, tokens: {}, spriteSize: art.size };
  for (const [id, s] of Object.entries(base.tiles)) m.tiles[id] = { pixels: pick(id, s.pixels) };
  for (const [id, s] of Object.entries(base.props)) m.props[id] = { pixels: pick(id, s.pixels) };
  for (const [id, s] of Object.entries(base.tokens)) m.tokens[id] = { pixels: pick(id, s.pixels) };
  artManifests.set(key, m);
  return m;
}

/** Source pixels per tile edge for what `template` draws with right now. */
export function artSpriteSize(template: TemplateGenre): number {
  return spriteSizeOf(artManifest(template));
}

/** The cast in the Art row's character style (or the first one rendered), or null when the build has none. */
export function castStyleNow(): CastStyle | null {
  const cast = castData();
  if (!cast) return null;
  return cast.styles.find((s) => s.style === art.chars) ?? cast.styles[0] ?? null;
}

// ---- the art change signal ----

const artListeners = new Set<() => void>();

/** Tell everything that listens (a mounted window) that the art choice, or the decoded library, changed. Synchronous. */
export function notifyArtChange(): void {
  for (const cb of [...artListeners]) cb();
}

// What each Art row choice means, in plain words: shown under the row for the
// current choices only (and in full on hover over a choice's label).
const ART_EXPLAIN: Record<ArtChoice["source"], string> = {
  current: "Art: Current = the game's hand-drawn art today.",
  kaykit: "Art: KayKit = Kay Lousberg's free 3D models rendered into pixels in Blender.",
};
const GROUND_EXPLAIN: Record<GroundStyle, string> = {
  painted: "Ground: Painted = Kay's dungeon pieces for the layout, surface painted in code (mortar, speckle, a lit rim).",
  lit: "Ground: Lit = every floor built as a bumpy 3D surface and lit from the upper left (real bevels and shadows).",
};
const CHAR_EXPLAIN: Record<CharStyle, string> = {
  bands: "Characters: Cel bands = material per pixel, three flat light bands and a dark outline (classic JRPG).",
  pixelart: "Characters: Pixel artist = hand pixel-art rules: clean silhouette, coloured outlines, edge highlights, stray pixels cleaned.",
  toon: "Characters: Toon = a cartoon shader in Blender: three bands, an outline and a shine spot on metal.",
  plain: "Characters: Plain = a straight shrink of the 3D render snapped to the game's colours (the baseline).",
};
const DETAIL_EXPLAIN: Record<16 | 32, string> = {
  16: "Detail: 16 px is the game's tile size today.",
  32: "Detail: 32 px has twice the detail of the game's 16 px tile.",
};

/**
 * The shared Art row: Current or KayKit, and for KayKit the ground style,
 * the character style and the detail. One state for every panel, so a choice
 * made on one tab holds on the next. The first switch to KayKit decodes the
 * library (once) before redrawing. A tab with no characters on it passes
 * { chars: false } and the Characters choice is left off. Under the row, one
 * muted line per current choice says what it means (ART_EXPLAIN and friends).
 */
export function buildArtControls(onChange: () => void, opts: { chars?: boolean } = {}): HTMLElement {
  const row = document.createElement("div");
  row.className = "bn-controls lt-art-controls";
  const lib = kaykitLibrary();
  const status = document.createElement("span");
  status.className = "lt-note lt-art-status";
  const explain = document.createElement("div");
  explain.className = "lt-art-explain";
  const pick = (label: string, options: [string, string][], value: string, set: (v: string) => void, hint?: string): HTMLLabelElement => {
    const field = document.createElement("label");
    field.className = "bn-field";
    field.textContent = `${label} `;
    if (hint) field.title = hint;
    const select = document.createElement("select");
    select.className = "bn-select";
    for (const [v, text] of options) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = text;
      select.appendChild(opt);
    }
    select.value = value;
    select.onchange = () => {
      set(select.value);
      void apply();
    };
    field.appendChild(select);
    return field;
  };
  const extras: HTMLLabelElement[] = [];
  const sourceField = pick(
    "Art",
    lib ? [["current", "Current (hand-drawn)"], ["kaykit", "KayKit (converted)"]] : [["current", "Current (hand-drawn)"]],
    art.source,
    (v) => (art.source = v as ArtChoice["source"]),
    Object.values(ART_EXPLAIN).join("\n"),
  );
  extras.push(pick("Ground", [["painted", "Painted"], ["lit", "Lit"]], art.ground, (v) => (art.ground = v as GroundStyle), Object.values(GROUND_EXPLAIN).join("\n")));
  if (opts.chars !== false) {
    extras.push(
      pick(
        "Characters",
        [["bands", "Cel bands"], ["pixelart", "Pixel artist"], ["toon", "Toon"], ["plain", "Plain"]],
        art.chars,
        (v) => (art.chars = v as CharStyle),
        Object.values(CHAR_EXPLAIN).join("\n"),
      ),
    );
  }
  extras.push(pick("Detail", [["32", "32 px"], ["16", "16 px (the game's size)"]], String(art.size), (v) => (art.size = Number(v) as 16 | 32), Object.values(DETAIL_EXPLAIN).join("\n")));
  row.append(sourceField, ...extras, status, explain);
  const sync = () => {
    for (const e of extras) e.hidden = art.source !== "kaykit";
    status.textContent =
      art.source === "kaykit" || lib ? "" : "No converted library in this build.";
    // One short line per choice in force, so the row never grows a wall of text.
    const lines = [ART_EXPLAIN[art.source]];
    if (art.source === "kaykit") {
      lines.push(GROUND_EXPLAIN[art.ground]);
      if (opts.chars !== false) lines.push(CHAR_EXPLAIN[art.chars]);
      lines.push(DETAIL_EXPLAIN[art.size]);
    }
    explain.replaceChildren(
      ...lines.map((text) => {
        const line = document.createElement("div");
        line.className = "lt-note";
        line.textContent = text;
        return line;
      }),
    );
  };
  async function apply(): Promise<void> {
    sync();
    if (art.source === "kaykit" && !artState.decoded) {
      status.textContent = "Loading the KayKit art...";
      artState.decoded = await decodeLibrary();
      sync();
    }
    onChange();
  }
  sync();
  if (art.source === "kaykit" && !artState.decoded) void apply();
  return row;
}

// ===========================================================================
// The host's parts.
// ===========================================================================

const benchCatalogs: Partial<Record<TemplateGenre, ArtCatalog>> = {};

/** What the bench's art says of itself to the window and to the engine modules. */
const benchArt: TableHost["art"] = {
  catalog(t) {
    return (benchCatalogs[t] ??= catalogFromSprites(SPRITES_BY_TEMPLATE[t]));
  },
  render: artManifest,
  cast() {
    // The animated cast only while KayKit is the chosen art; the current art draws static tokens.
    if (art.source !== "kaykit") return null;
    const data: CastData | null = castData();
    const style = castStyleNow();
    return data && style ? { data, style } : null;
  },
  signature: () => `${art.source}|${art.ground}|${art.chars}|${art.size}|${artState.decoded ? 1 : 0}`,
  // Not ready while the chosen KayKit library is still being decoded: the window draws at the current art's size until it is. A build with no
  // library (and Node, where the rules run with no page) has nothing to wait for. The catalog itself never depends on this: it is memoized above.
  ready: () => art.source !== "kaykit" || artState.decoded !== null || !kaykitLibrary(),
  onChange(cb) {
    artListeners.add(cb);
    return () => {
      artListeners.delete(cb);
    };
  },
};

type ClaudeUse = { use?: (name: string) => Promise<unknown> };
const claudeUse = (): ClaudeUse | undefined => (globalThis as { claude?: ClaudeUse }).claude;

/** A test hook: a function on globalThis stands in for the sample capability. */
function benchSampleHook(): SampleFn | null {
  const hook = (globalThis as { __ltBenchSample?: unknown }).__ltBenchSample;
  return typeof hook === "function" ? (hook as SampleFn) : null;
}

const SAVES_STORAGE_KEY = "livingtable-bench-saves-v1";
const AI_ADVENTURES_KEY = "livingtable-bench-ai-adventures-v1";

type Downloads = { save(req: { filename: string; data: Uint8Array }): Promise<{ status?: string }> };

/** The viewer's downloads capability (the artifact runtime), or null off claude.ai or when this view cannot save. */
async function downloadsCapability(): Promise<Downloads | null> {
  try {
    const found = await claudeUse()?.use?.("downloads");
    return found && typeof (found as { save?: unknown }).save === "function" ? (found as Downloads) : null;
  } catch {
    return null;
  }
}

/** A plain browser download of the zip (an object URL and a download link). Whether the browser lets it through cannot be seen from here. */
function browserDownload(filename: string, bytes: Uint8Array): boolean {
  try {
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The on-screen text, the roll-my-own-dice choice, the dice skin and the zoom: set by the bench's controls row, kept across tab visits. */
const settingsNow: TableSettings = { textStyle: "pixel", rollMyself: true, diceSkin: "bone", zoom: null };
/** Skins the player owns. Buying is not wired (a later product decision), so it is the free one. */
const OWNED_SKINS: readonly string[] = DICE_SKINS.filter((s) => s.priceCredits === 0).map((s) => s.id);

const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const benchHost: TableHost = {
  art: benchArt,
  dm: {
    async sample() {
      try {
        const found = await claudeUse()?.use?.("sample");
        return typeof found === "function" ? (found as SampleFn) : null;
      } catch {
        return null;
      }
    },
    unavailable: "The DM lives on claude.ai: open the published bench to play with it.",
    writerUnavailable: "The AI writer lives on claude.ai: open the published bench to use it. Nothing was sent.",
    peek: benchSampleHook,
  },
  storage: {
    saves: {
      read: (scope) => globalThis.localStorage?.getItem(scope === "saves" ? SAVES_STORAGE_KEY : `livingtable-bench-${scope}-v1`) ?? null,
      write: (scope, text) => globalThis.localStorage?.setItem(scope === "saves" ? SAVES_STORAGE_KEY : `livingtable-bench-${scope}-v1`, text),
    },
    aiAdventures: {
      /** AI-written adventures kept in this browser: [{ markdown }], read again and checked on every load. Never throws. */
      read() {
        try {
          const raw = globalThis.localStorage?.getItem(AI_ADVENTURES_KEY);
          const list: unknown = raw ? JSON.parse(raw) : [];
          return Array.isArray(list) ? list.flatMap((x) => (isRecord(x) && typeof x.markdown === "string" ? [x.markdown] : [])) : [];
        } catch {
          return [];
        }
      },
      write(texts) {
        try {
          globalThis.localStorage?.setItem(AI_ADVENTURES_KEY, JSON.stringify(texts.map((markdown) => ({ markdown }))));
        } catch {
          // Storage can be blocked or full: the adventure still plays this visit.
        }
      },
    },
  },
  files: {
    async save(filename, bytes) {
      const dl = await downloadsCapability();
      if (dl) {
        try {
          const res = await dl.save({ filename, data: bytes });
          return { via: "capability", ...(res.status !== undefined ? { status: res.status } : {}) };
        } catch (err) {
          const code = isRecord(err) && typeof err.code === "string" ? err.code : "";
          if (code === "declined") return { via: "capability", declined: true };
          if (code === "rate_limited") return { via: "none", status: "rate_limited" };
          // Anything else (the capability failed): the plain download below is the next best thing.
        }
      }
      if (browserDownload(filename, bytes)) return { via: "browser", ...(dl ? { status: "capability_failed" } : {}) };
      return { via: "none" };
    },
  },
  adventures: { files: () => ADVENTURE_FILES },
  heroes: { playable: () => PLAYABLE_HEROES, initial: () => null },
  settings: {
    get: () => ({ ...settingsNow }),
    set(p) {
      Object.assign(settingsNow, p);
    },
    ownedDiceSkins: () => [...OWNED_SKINS],
  },
  env: {
    /**
     * Every die the engine rolls on the table (a kick, a shove, a Stealth check, a swing) draws from here. A test installs
     * globalThis.__ltBenchRng (a function returning a number from 0 up to, not including, 1) to make a roll land where it needs to.
     */
    rng() {
      const hook = (globalThis as { __ltBenchRng?: unknown }).__ltBenchRng;
      if (typeof hook === "function") {
        const v = (hook as () => unknown)();
        if (typeof v === "number" && v >= 0 && v < 1) return v;
      }
      return Math.random();
    },
    reducedMotion: REDUCED_MOTION,
    address: () => (typeof location === "undefined" ? "" : location.hash),
    sandboxRooms: true,
    debugExport: true,
    build: { app: `Living Table ${APP_VERSION}`, bench: `${APP_VERSION} (the Play tab of the bench)` },
  },
};

// ===========================================================================
// The session, the bindings and the test hooks.
// ===========================================================================

let session: TableSession | null = null;

/** The one session of the bench page: made on the first visit to the Play tab (the saves are read then), kept across visits. */
export function benchSession(): TableSession {
  return (session ??= createTableSession(benchHost));
}

/** The embedded cast (bench-cast.json, from --data kaycast=...), read once. */
let embeddedCast: CastData | null | undefined;
function readEmbeddedCast(): CastData | null {
  if (embeddedCast !== undefined) return embeddedCast;
  try {
    const el = typeof document !== "undefined" ? document.getElementById("bench-data-kaycast") : null;
    embeddedCast = el?.textContent ? (JSON.parse(el.textContent) as CastData) : null;
  } catch {
    embeddedCast = null;
  }
  return embeddedCast;
}

/**
 * Bind the engine modules to the bench host, so the table's rules answer with no window mounted (the creatures, adventures and wall-profiles
 * tests, the Characters tab). The cast is bound to the embedded data whichever art is chosen, because the Characters tab shows it either way
 * (the window itself asks for the cast only while KayKit is chosen: benchArt.cast). Called when the registry loads, and again whenever a
 * window is disposed, because a window unbinds what it bound.
 */
export function bindBenchDefaults(): void {
  bindCatalog(benchHost.art);
  bindAdventures(benchHost);
  bindFightEnv(benchHost.env);
  bindCastSource(readEmbeddedCast);
}

/**
 * The handles the headless play scripts read, from the window's own debug(). Installed after every mount (the last window wins):
 *   __ltBenchPlay()        the scene state, never written through
 *   __ltBenchAdventure     the adventure's handle (startScreen, event, dmView, lastBrief, exportFiles, state)
 *   __ltBenchSave(label)   a save at any moment, mid-fight included
 *   __ltBenchSight()       what the hero sees: the level of every square and which creatures are in sight
 * The inputs the scripts install (__ltBenchSample, __ltBenchRng) are read by benchHost.dm.peek and benchHost.env.rng.
 */
export function installBenchHooks(win: TableWindow): void {
  const d = win.debug();
  const g = globalThis as {
    __ltBenchPlay?: () => PlayState;
    __ltBenchAdventure?: object;
    __ltBenchSave?: (label: string) => void;
    __ltBenchSight?: () => object;
  };
  g.__ltBenchPlay = d.play;
  g.__ltBenchAdventure = d.adventure;
  g.__ltBenchSave = d.save;
  g.__ltBenchSight = d.sight;
}
