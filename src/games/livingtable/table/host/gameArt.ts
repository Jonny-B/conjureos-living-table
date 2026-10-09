/**
 * The game's side of the table window's art (TableHost.art).
 *
 * The shipped game gets its pictures from games-db (`loadManifest`, which hands back
 * a LoadedManifest: the engine's view, the paint-ready view and the DM's id lists).
 * The table window wants a `TableArt`, which is synchronous, so this adapter loads
 * first and answers afterwards:
 *
 *   const art = createGameArt();
 *   await art.load();                  // before mounting: fetches, checks, settles
 *   host = { ...parts, art };
 *
 * Which library it settles on, per template:
 *
 *   1. The games-db manifest, when it has every id the table needs (the ids the
 *      adventures name plus the engine's own: the scene kit and the hero tokens).
 *   2. Otherwise the bundled hand-drawn library (bundledArt.ts, generated from
 *      scripts/assets/fantasy.ts), whole. The two are never mixed: a sprite is a
 *      grid of palette indices and each library has its own palette, so a single
 *      sprite cannot be lent from one to the other.
 *   3. If there is no bundled copy of that template (sci-fi has none) the manifest
 *      is used as it is and the gap is recorded in `status(t).missing`.
 *
 * The same happens when the fetch itself fails (offline, not signed in): the bundled
 * library is used and the error is recorded in `status(t).error`. Only when there is
 * neither a manifest nor a bundled copy does `load()` reject.
 *
 * `catalog(t)` and `render(t)` throw before `load()` has settled. That is a bug in the
 * caller (the window was mounted too early), and a clear error beats a blank board.
 *
 * Two things differ from what the game's own manifest cache hands over:
 *   - The wall-profile pieces (wall_stone_join_*, wall_stone_jambs_ns, door_closed_ns,
 *     door_open_ns) are kept out of `LoadedManifest.world` on purpose, so the campaign DM
 *     cannot name them. But a written adventure may: rat-cellar.md puts door_open_ns
 *     on a doorway. The table's catalog therefore lists them as the bench did (flags
 *     worked out from the wall-profile rules, see `gameCatalog`), and the DM's own
 *     list still skips them (catalog.ts DM_PROP_SKIP and DM_TILE_SKIP).
 *   - Display names come from the bundled library only. A games-db manifest has
 *     names on the wire, but `adaptManifest` drops them, so `names` is absent and
 *     the id with spaces stands in.
 *
 * The animated art (the cast, and the KayKit sprite library that goes with it) is too big for the app
 * package, so it ships as the app's ConjureOS asset files (assetFiles.ts; installing the game downloads
 * them) and is read AFTER the first paint:
 *
 *   await art.load();   // the hand-drawn art settles; the window mounts and paints with still figures
 *   // load() has already started art.loadAssets() in the background; when a file lands the art
 *   // changes (onChange fires, signature() differs) and the window repaints with it.
 *
 * Each file goes through `window.__conjureos.assets.load(name)` (the platform checks it against the hash
 * recorded at publish and keeps it on the device), is parsed and checked once, and kept. A file with no name
 * (assetFiles null), a bridge that is not there (outside the ConjureOS app) or that does not give a game its
 * files (an older ConjureOS, the phone today), a failed or mismatched load, or a file that does not
 * parse each leave that part on its fallback (still figures, the hand-drawn art) and say why in
 * `assetStatus()`. Nothing here throws or rejects because of an asset file.
 *
 * The cast is `cast()`: null until its file lands. The KayKit library, when it lands, replaces the
 * render half the window draws with (`render(t)`: the chosen ground, props and tokens at 32 px, the
 * hand-drawn art upscaled for any id it lacks); the catalog and the DM's id lists never change.
 * `setCast` stays as the hook for a host that has its own cast (an explicit cast wins over the file).
 */
import type { LoadedManifest } from "../../assets/manifestCache";
import { adaptManifest, adaptPalette, loadManifest } from "../../assets/manifestCache";
import type { LtAssetWire, LtTemplate } from "../../../../bridge/gamesApi";
import { PLAYABLE_ARCHETYPE_IDS } from "../../characters/templates";
import { parseAdventureMarkdown } from "../../adventures/markdown";
import { creatureTokenId } from "../../adventures/validate";
import type { Adventure } from "../../adventures/types";
import { catalogFromWorld } from "../catalog";
import { WALL_PROFILE_RULES, isRenderOnlyAssetId } from "../../render/wallProfiles";
import { isOpaqueAssetId } from "../../world/visibility";
import type { AssetManifest } from "../../world/cell";
import type { AdventureFile, ArtCatalog, CastData, CastStyle, RenderManifest, TableArt, TemplateGenre } from "../host";
import type { BundledLibrary, BundledSprite } from "./bundledArt";
import { ASSET_FILES, type AssetFiles, validAssetName } from "./assetFiles";

export type { BundledLibrary, BundledSprite };

// ---- what the table needs -------------------------------------------------------

/** Asset ids by kind. */
export interface AssetIdSet {
  tiles: string[];
  props: string[];
  tokens: string[];
}

const emptyIds = (): AssetIdSet => ({ tiles: [], props: [], tokens: [] });

/**
 * The picture ids the engine itself puts on the board whatever adventure is playing,
 * per template: the room kit (wall, door, chest, the two stock creatures, the drain
 * grate) and one body token per playable hero. Mirrors the table's SCENE_KIT; keep in
 * step with it. The sci-fi template has none because the launch game does not play it.
 */
export const ENGINE_ASSET_IDS: Record<TemplateGenre, AssetIdSet> = {
  fantasy: {
    tiles: ["floor_stone", "wall_stone", "floor_stone_drain"],
    props: ["door_closed", "door_open", "chest", "chest_open"],
    tokens: ["token_goblin", "token_skeleton", ...PLAYABLE_ARCHETYPE_IDS.map((id) => `token_${id.replace(/-/g, "_")}`)],
  },
  scifi: emptyIds(),
};

/**
 * Every tile, prop and token id a set of adventures names: legend floor tiles and props,
 * NPC tokens, and the token of every spawned creature (a bestiary id maps to its token).
 * Files that do not parse contribute nothing (they cannot be played, and the table lists
 * them as broken). Sorted and de-duplicated.
 */
export function adventureAssetIds(source: readonly (AdventureFile | Adventure)[]): AssetIdSet {
  const tiles = new Set<string>();
  const props = new Set<string>();
  const tokens = new Set<string>();
  for (const item of source) {
    let adventure: Adventure | null;
    if ("text" in item && typeof item.text === "string") {
      try {
        adventure = parseAdventureMarkdown(item.text, { file: item.file }).adventure;
      } catch {
        adventure = null;
      }
    } else {
      adventure = item as Adventure;
    }
    if (!adventure) continue;
    for (const loc of adventure.locations ?? []) {
      for (const entry of Object.values(loc.map?.legend ?? {})) {
        if (entry.tile) tiles.add(entry.tile);
        if (entry.prop) props.add(entry.prop);
      }
      for (const spawn of loc.spawns ?? []) tokens.add(creatureTokenId(spawn.creature));
    }
    for (const npc of adventure.npcs ?? []) if (npc.token) tokens.add(npc.token);
  }
  const sorted = (s: Set<string>): string[] => [...s].sort();
  return { tiles: sorted(tiles), props: sorted(props), tokens: sorted(tokens) };
}

/** Union of id sets, de-duplicated, in first-seen order. */
export function mergeAssetIds(...sets: readonly AssetIdSet[]): AssetIdSet {
  const out = emptyIds();
  for (const kind of ["tiles", "props", "tokens"] as const) {
    out[kind] = [...new Set(sets.flatMap((s) => s[kind]))];
  }
  return out;
}

/** The ids in `needed` that the engine view `world` does not have. Empty means it covers them all. */
export function missingAssetIds(world: AssetManifest, needed: AssetIdSet): AssetIdSet {
  return {
    tiles: needed.tiles.filter((id) => !(id in world.tiles)),
    props: needed.props.filter((id) => !(id in world.props)),
    tokens: needed.tokens.filter((id) => !(id in world.tokens)),
  };
}

const countIds = (s: AssetIdSet): number => s.tiles.length + s.props.length + s.tokens.length;

// ---- the catalog ------------------------------------------------------------------------

/**
 * The table's catalog for a loaded manifest: its engine view plus the render-only wall-profile
 * pieces, in the library's own order (the render half's key order, which is the wire's).
 *
 * The flags of the pieces the manifest keeps out of `world` come from the rules that draw them,
 * which is what the authoring library says too (the test compares every one): a join tile is as
 * walkable as its wall (not), the jamb overlay blocks, and a side-on door leaf is as walkable as
 * the door it replaces (the open leaf is, the closed one is not).
 */
export function gameCatalog(m: LoadedManifest, names?: Readonly<Record<string, string>>): ArtCatalog {
  const world: AssetManifest = { tiles: {}, props: {}, tokens: {} };
  for (const id of Object.keys(m.render.tiles)) {
    const known = m.world.tiles[id];
    if (known) {
      world.tiles[id] = known;
    } else if (isRenderOnlyAssetId(id)) {
      const rule = WALL_PROFILE_RULES.find((r) => id.startsWith(r.prefix));
      const walkable = (rule ? m.world.tiles[rule.wall[0] ?? ""]?.walkable : undefined) ?? false;
      world.tiles[id] = { walkable, opaque: isOpaqueAssetId("tile", id, walkable) };
    }
  }
  for (const id of Object.keys(m.render.props)) {
    const known = m.world.props[id];
    if (known) {
      world.props[id] = known;
    } else if (isRenderOnlyAssetId(id)) {
      const leaf = WALL_PROFILE_RULES.flatMap((r) => Object.entries(r.doors)).find(([, side]) => side === id);
      const blocks = leaf ? m.world.props[leaf[0]]?.blocks === true : true;
      world.props[id] = { blocks, opaque: isOpaqueAssetId("prop", id, !blocks) };
    }
  }
  for (const id of Object.keys(m.render.tokens)) if (m.world.tokens[id]) world.tokens[id] = m.world.tokens[id];
  return catalogFromWorld(world, names);
}

// ---- the bundled library -----------------------------------------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The way back from the generator's packed grid (scripts/assets/build-bundled-art.mjs):
 * rows split on "|", each character a palette index plus one (the transparent -1 is the
 * first character), `<char>*<count>;` a run. Throws on a character that is not part of the format.
 */
export function decodeBundledPixels(px: string): number[][] {
  return px.split("|").map((row) => {
    const out: number[] = [];
    for (let i = 0; i < row.length; i += 1) {
      const idx = ALPHABET.indexOf(row[i] ?? "");
      if (idx < 0) throw new Error(`bundled art: bad pixel character "${row[i]}"`);
      if (row[i + 1] === "*") {
        const end = row.indexOf(";", i + 2);
        const n = Number(row.slice(i + 2, end));
        if (end < 0 || !Number.isInteger(n) || n < 1) throw new Error("bundled art: bad run");
        for (let k = 0; k < n; k += 1) out.push(idx - 1);
        i = end;
      } else {
        out.push(idx - 1);
      }
    }
    return out;
  });
}

/** A bundled library as the wire manifest games-db would hand over, so it goes through the same `adaptManifest`. */
export function bundledToWire(template: LtTemplate, lib: BundledLibrary): Parameters<typeof adaptManifest>[0] {
  const assets: LtAssetWire[] = lib.sprites.map((s) => ({
    assetId: s.assetId,
    kind: s.kind,
    name: s.name,
    size: s.size,
    walkable: s.walkable,
    pixels: decodeBundledPixels(s.px),
  }));
  return { template, palette: lib.palette, assets };
}

/** The bundled libraries, loaded on first use (a dynamic import, so a build may keep it out of the first paint). */
async function defaultBundled(): Promise<Partial<Record<TemplateGenre, BundledLibrary>>> {
  return (await import("./bundledArt")).BUNDLED_ART;
}

// ---- the adapter ----------------------------------------------------------------------

/** Where a template's pictures came from: the server's art library (the games-db manifest), or the hand-drawn library that ships with the game. */
export type ArtSource = "server" | "bundled";

/** What `load()` settled on for one template. */
export interface ArtStatus {
  source: ArtSource;
  /** Ids the table needs that the chosen library still lacks. Empty when it covers everything. */
  missing: AssetIdSet;
  /** Why the games-db manifest was not used, when it was not: the fetch error, or the coverage gap. */
  reason?: string;
  /** The games-db fetch error, when there was one. */
  error?: string;
}

export interface GameArtOptions {
  /** The templates to load. Default: fantasy (the launch game). */
  templates?: readonly TemplateGenre[];
  /** The manifest loader. Default: manifestCache's `loadManifest`. */
  load?: (t: LtTemplate) => Promise<LoadedManifest>;
  /** The ids the table needs per template. Default: ENGINE_ASSET_IDS. Hosts add the adventures with `adventureAssetIds`. */
  required?: (t: TemplateGenre) => AssetIdSet;
  /** The bundled libraries. Default: the generated bundledArt module, imported on demand. */
  bundled?: () => Promise<Partial<Record<TemplateGenre, BundledLibrary>>> | Partial<Record<TemplateGenre, BundledLibrary>>;
  /** A cast the host already has. Default: none (the cast file is loaded instead, or still figures). */
  cast?: () => { data: CastData; style: CastStyle } | null;
  /** The asset files to read, by name. Default: ASSET_FILES (assetFiles.ts, the two files package.json lists). */
  assetFiles?: AssetFiles;
  /** ConjureOS's asset loader. Default: `window.__conjureos.assets`, read when the load starts (absent outside the app). */
  assets?: AssetsBridge | null | (() => AssetsBridge | null | undefined);
  /** Turns a loaded file's object URL into its parsed JSON. Default: fetch it, parse it, revoke the URL. */
  readJson?: (objectUrl: string) => Promise<unknown>;
  /** Inflates a zlib stream (the library's packed pixels). Default: the browser's DecompressionStream. */
  inflate?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** The look of the KayKit art and which cast style goes with it. Default: painted ground, cel-band figures, 32 px. */
  look?: Partial<ArtLook>;
}

// ---- the animated art (asset files) ----------------------------------------------------

/** The result `assets.load` hands back; it never rejects. */
export type AssetLoadResult = { ok: true; objectUrl: string } | { ok: false; reason: string; error?: string };

/**
 * The part of `window.__conjureos.assets` this adapter uses. `load(name)` reads one of the app's own asset files;
 * `list` is present only on a ConjureOS that gives a game its files, which is how an older ConjureOS and the phone
 * are told apart.
 */
export interface AssetsBridge {
  load(name: string): Promise<AssetLoadResult>;
  list?: () => Promise<unknown>;
}

export type GroundStyle = "painted" | "lit";
export type CharStyle = "bands" | "pixelart" | "toon" | "plain";

/** Which KayKit art is drawn. The cast style follows `chars`. */
export interface ArtLook {
  ground: GroundStyle;
  chars: CharStyle;
  size: 16 | 32;
}

/** The look the bench played with: painted ground, cel bands, 32 px. */
export const DEFAULT_LOOK: ArtLook = { ground: "painted", chars: "bands", size: 32 };

/** Where one asset file is: not asked for yet, on its way, in use, or on its fallback (with the reason, in plain words). */
export interface AssetPartStatus {
  state: "waiting" | "loading" | "ready" | "fallback";
  reason?: string;
}

export interface AssetStatus {
  cast: AssetPartStatus;
  library: AssetPartStatus;
  /** One line for the window's art status: what is drawing and, if something fell back, why. */
  summary: string;
}

/** One part of the library file: the packed pixels of every sprite of one maker, style and size. */
export interface LibraryPart {
  file: string;
  maker: string;
  size: 16 | 32;
  style: string | null;
  sprites: { assetId: string; w: number; h: number }[];
  /** zlib then base64 of the palette indices, one byte each, 255 for transparent. */
  data: string;
}

/** The KayKit library file (living-table-library.json): the palette its sprites index, and the packed parts. */
export interface LibraryFile {
  palette: [number, number, number][];
  parts: LibraryPart[];
}

/** The part files a look draws with, in the order they are tried (the bench's `partFile`). */
export function libraryPartFiles(look: ArtLook): string[] {
  return [`ground-${look.ground}-${look.size}.json`, `props-${look.size}.json`, `tokens-${look.chars}-${look.size}.json`];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The cast file as CastData, or null when it is not one (checked loosely: the clips themselves are decoded later, by ui/cast.ts). */
export function parseCastFile(x: unknown): CastData | null {
  if (!isObj(x) || !Array.isArray(x.palette) || typeof x.cameraPitchDeg !== "number" || !Array.isArray(x.styles) || x.styles.length === 0) return null;
  for (const st of x.styles) {
    if (!isObj(st) || typeof st.style !== "string" || !Array.isArray(st.characters) || !Array.isArray(st.gear) || !isObj(st.layerOrder)) return null;
  }
  return x as unknown as CastData;
}

/** The library file as a LibraryFile, or null when it is not one. */
export function parseLibraryFile(x: unknown): LibraryFile | null {
  if (!isObj(x) || !Array.isArray(x.palette) || !Array.isArray(x.parts) || x.parts.length === 0) return null;
  for (const p of x.parts) {
    if (!isObj(p) || typeof p.file !== "string" || (p.size !== 16 && p.size !== 32) || typeof p.data !== "string" || !Array.isArray(p.sprites)) return null;
    for (const sp of p.sprites) {
      if (!isObj(sp) || typeof sp.assetId !== "string" || !Number.isInteger(sp.w) || !Number.isInteger(sp.h)) return null;
    }
  }
  return x as unknown as LibraryFile;
}

/** The browser's inflate for a zlib stream. */
async function browserInflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * One library part's sprites as palette-index grids (-1 transparent), by asset id. Throws when the data is
 * shorter than its sprites say (a cut-off or damaged file), so the caller falls back instead of drawing holes.
 */
export async function decodeLibraryPart(part: LibraryPart, inflate: (b: Uint8Array) => Promise<Uint8Array> = browserInflate): Promise<Map<string, number[][]>> {
  const bin = atob(part.data);
  const packed = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) packed[i] = bin.charCodeAt(i);
  const raw = await inflate(packed);
  const out = new Map<string, number[][]>();
  let o = 0;
  for (const s of part.sprites) {
    if (o + s.w * s.h > raw.length) throw new Error(`library part ${part.file} is shorter than its sprites`);
    const rows: number[][] = [];
    for (let y = 0; y < s.h; y += 1) {
      const row = new Array<number>(s.w);
      for (let x = 0; x < s.w; x += 1) {
        const v = raw[o++] as number;
        row[x] = v === 255 ? -1 : v;
      }
      rows.push(row);
    }
    out.set(s.assetId, rows);
  }
  return out;
}

function upscale(pixels: number[][], k: number): number[][] {
  if (k === 1) return pixels;
  const out: number[][] = [];
  for (const row of pixels) {
    const wide: number[] = [];
    for (const v of row) for (let i = 0; i < k; i += 1) wide.push(v);
    for (let i = 0; i < k; i += 1) out.push(wide.slice());
  }
  return out;
}

/**
 * The render half to draw with when the KayKit library is in: every id of `base`, drawn from the look's parts
 * where they have it and from `base` (upscaled to the look's size) where they do not. Returns the reason instead
 * when the two cannot be combined: the base is not 16 px art, or its palette is not the one the library was
 * converted to (a sprite is palette indices, so the palettes must be the same colours).
 */
export function kaykitRender(
  base: RenderManifest,
  libraryPalette: unknown,
  parts: readonly Map<string, number[][]>[],
  size: 16 | 32,
): { render: RenderManifest } | { reason: string } {
  if ((base.spriteSize ?? 16) !== 16) return { reason: "the hand-drawn art is not 16 px, so the KayKit art cannot be laid over it" };
  const want = adaptPalette(libraryPalette).map((c) => c.toLowerCase());
  const have = base.palette.map((c) => c.toLowerCase());
  if (want.length !== have.length || want.some((c, i) => c !== have[i])) return { reason: "its colours are not the game's palette" };
  const k = size / 16;
  const pick = (id: string, current: number[][]): number[][] => {
    for (const p of parts) {
      const px = p.get(id);
      if (px) return px;
    }
    return upscale(current, k);
  };
  const render: RenderManifest = { palette: base.palette, tiles: {}, props: {}, tokens: {}, spriteSize: size };
  for (const [id, a] of Object.entries(base.tiles)) render.tiles[id] = { pixels: pick(id, a.pixels) };
  for (const [id, a] of Object.entries(base.props)) render.props[id] = { pixels: pick(id, a.pixels) };
  for (const [id, a] of Object.entries(base.tokens)) render.tokens[id] = { pixels: pick(id, a.pixels) };
  return { render };
}

/** The plain words for a failed `assets.load`. */
export function assetReason(what: string, r: { reason: string; error?: string }): string {
  switch (r.reason) {
    case "unknown_name":
      return `The ${what} file is not one this copy of the game came with, so it was not loaded.`;
    case "mismatch":
      return `The ${what} file does not match its hash (it was changed or cut short), so it was not used.`;
    case "too_large":
      return `The ${what} file is over the size limit, so it was not loaded.`;
    case "fetch_failed":
      return `The ${what} file could not be downloaded${r.error ? ` (${r.error})` : ""}.`;
    default:
      return `The ${what} file could not be loaded (${r.reason}).`;
  }
}

export interface GameArt extends TableArt {
  /** Fetch and settle every template. Safe to call again: it returns the same promise while one is running, and reloads after. */
  load(): Promise<void>;
  /**
   * Load the cast and the KayKit library from their asset files (once; a settled load is kept, a failed one is tried
   * again on the next call). Never rejects. `load()` starts it in the background, so a host only calls this to wait
   * for it (a test, or a retry button).
   */
  loadAssets(): Promise<void>;
  /** Where the cast and the library are, with the plain reason for any that fell back. Safe at any time. */
  assetStatus(): AssetStatus;
  /** What a template settled on. Throws before `load()` has settled it. */
  status(t: TemplateGenre): ArtStatus;
  /** The loaded manifest the window draws (for the DM's id lists and the like). Throws before `load()` has settled it. */
  manifest(t: TemplateGenre): LoadedManifest;
  /** Offer the cast when it arrives (or take it away with null). Tells subscribers. */
  setCast(cast: { data: CastData; style: CastStyle } | null): void;
  /** Drop every subscriber and the settled libraries. */
  dispose(): void;
}

interface Settled {
  source: ArtSource;
  manifest: LoadedManifest;
  catalog: ArtCatalog;
  status: ArtStatus;
}

/** A short stable fingerprint of a library: its ids, the palette and the sprite size. Pixels are left out (cheap, and an id or palette change is what a new version looks like). */
function fingerprint(m: LoadedManifest): string {
  const text = [
    m.render.spriteSize ?? 16,
    m.render.palette.join(","),
    Object.keys(m.render.tiles).join(","),
    Object.keys(m.render.props).join(","),
    Object.keys(m.render.tokens).join(","),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Fetch a loaded file's object URL and parse it, then give the URL back (the bytes are in memory by then). */
async function defaultReadJson(objectUrl: string): Promise<unknown> {
  try {
    const res = await fetch(objectUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* not a blob URL, or no URL API: nothing to give back */
    }
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error");

export function createGameArt(opts: GameArtOptions = {}): GameArt {
  const templates = opts.templates ?? (["fantasy"] as const);
  const loadOne = opts.load ?? loadManifest;
  const required = opts.required ?? ((t: TemplateGenre) => ENGINE_ASSET_IDS[t]);
  const getBundled = opts.bundled ?? defaultBundled;
  let cast: { data: CastData; style: CastStyle } | null = opts.cast?.() ?? null;
  /** A cast the host set itself (the option or setCast): the cast file does not replace it. */
  let castExplicit = cast !== null;
  const files = opts.assetFiles ?? ASSET_FILES;
  const look: ArtLook = { ...DEFAULT_LOOK, ...opts.look };
  const readJson = opts.readJson ?? defaultReadJson;
  const inflate = opts.inflate ?? browserInflate;

  const listeners = new Set<() => void>();
  const settled = new Map<TemplateGenre, Settled>();
  let running: Promise<void> | null = null;
  let ready = false;

  // The animated art. `epoch` moves on dispose, so a file that lands afterwards is dropped.
  let epoch = 0;
  let assetsRun: Promise<void> | null = null;
  let castStatus: AssetPartStatus = { state: "waiting" };
  let libStatus: AssetPartStatus = { state: "waiting" };
  let libParts: Map<string, number[][]>[] | null = null;
  let libPalette: unknown = null;
  /** The KayKit render half per template, with the hand-drawn render half it was laid over (kept while that stays the same object). */
  const overlays = new Map<TemplateGenre, { base: RenderManifest; render: RenderManifest }>();

  const fire = (): void => {
    for (const cb of [...listeners]) cb();
  };


  const names = (lib: BundledLibrary): Record<string, string> => Object.fromEntries(lib.sprites.map((s) => [s.assetId, s.name]));

  async function settle(t: TemplateGenre): Promise<Settled> {
    const need = required(t);
    let manifest: LoadedManifest | null = null;
    let error: string | undefined;
    try {
      manifest = await loadOne(t);
    } catch (e) {
      error = errText(e);
    }
    const own = manifest ? gameCatalog(manifest) : null;
    const gap = own ? missingAssetIds(own.world, need) : need;
    if (manifest && own && countIds(gap) === 0) {
      return { source: "server", manifest, catalog: own, status: { source: "server", missing: gap } };
    }
    const reason = error ? `The art library from the server was not loaded: ${error}` : `The art library from the server lacks ${countIds(gap)} id(s) the table needs`;
    let lib: BundledLibrary | undefined;
    try {
      lib = (await getBundled())[t];
    } catch (e) {
      error = error ?? errText(e);
    }
    if (lib) {
      const fromBundle = adaptManifest(bundledToWire(t, lib));
      const bundledCatalog = gameCatalog(fromBundle, names(lib));
      return {
        source: "bundled",
        manifest: fromBundle,
        catalog: bundledCatalog,
        status: { source: "bundled", missing: missingAssetIds(bundledCatalog.world, need), reason, ...(error ? { error } : {}) },
      };
    }
    if (manifest && own) {
      return { source: "server", manifest, catalog: own, status: { source: "server", missing: gap, reason } };
    }
    throw new Error(`The ${t} art could not be loaded and there is no bundled copy: ${error ?? "unknown error"}`);
  }

  // ---- the animated art: asset files, loaded after the first paint ----

  const bridge = (): AssetsBridge | null => {
    try {
      const given = typeof opts.assets === "function" ? opts.assets() : opts.assets;
      if (given !== undefined) return given;
      const found = (globalThis as { __conjureos?: { assets?: AssetsBridge } }).__conjureos?.assets;
      return found ?? null;
    } catch {
      return null;
    }
  };

  /**
   * What stops an asset file loading before any work is done (no name, a malformed name, no bridge, a ConjureOS that does
   * not give a game its files), as a plain reason, or the bridge and name to go ahead with. Synchronous, so a part that
   * cannot load settles at once.
   */
  function preflight(what: string, name: string | null, instead: string): { reason: string } | { b: AssetsBridge; name: string } {
    const no = (why: string): { reason: string } => ({ reason: `${why} The table shows ${instead}.` });
    if (!name) return no(`The ${what} file is not part of this build.`);
    if (!validAssetName(name)) return no(`The ${what} file's name is not valid.`);
    const b = bridge();
    if (!b || typeof b.load !== "function") return no("Asset files are not available here (the game is not running inside the ConjureOS app).");
    if (typeof b.list !== "function") return no("This ConjureOS does not give a game its asset files yet (the phone app and older versions do not).");
    return { b, name };
  }

  /** One asset file, through the bridge, parsed and checked. Never throws. `what` and `instead` are plain words for the reason. */
  async function fetchAsset<T>(what: string, go: { b: AssetsBridge; name: string }, parse: (x: unknown) => T | null, instead: string): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    const no = (why: string): { ok: false; reason: string } => ({ ok: false, reason: `${why} The table shows ${instead}.` });
    const { b, name } = go;
    let r: AssetLoadResult;
    try {
      r = await b.load(name);
    } catch (e) {
      r = { ok: false, reason: "fetch_failed", error: errText(e) };
    }
    if (!r || r.ok !== true) return no(assetReason(what, r ?? { reason: "no answer" }));
    let json: unknown;
    try {
      json = await readJson(r.objectUrl);
    } catch (e) {
      return no(`The ${what} file could not be read (${errText(e)}).`);
    }
    const value = parse(json);
    return value ? { ok: true, value } : no(`The ${what} file is not in the format the table expects.`);
  }

  function chooseStyle(data: CastData): CastStyle {
    return data.styles.find((s) => s.style === look.chars) ?? (data.styles[0] as CastStyle);
  }

  async function loadCast(): Promise<void> {
    if (castStatus.state === "ready") return;
    if (castExplicit || cast) {
      castStatus = { state: "ready" };
      return;
    }
    const mine = epoch;
    const go = preflight("animated figures", files.cast, "still figures");
    if ("reason" in go) {
      castStatus = { state: "fallback", reason: go.reason };
      return;
    }
    castStatus = { state: "loading" };
    const res = await fetchAsset("animated figures", go, parseCastFile, "still figures");
    if (mine !== epoch) return;
    if (castExplicit) {
      castStatus = { state: "ready" }; // the host set its own cast while the file was on its way: that one stays
    } else if (res.ok) {
      cast = { data: res.value, style: chooseStyle(res.value) };
      castStatus = { state: "ready" };
    } else {
      castStatus = { state: "fallback", reason: res.reason };
    }
    fire();
  }

  /** Lay the decoded library over each settled fantasy art (or say why it cannot be). Does not announce. */
  function refreshOverlays(): void {
    if (!libParts) return;
    const before = new Map(overlays);
    overlays.clear();
    let reason: string | null = null;
    for (const [t, s] of settled) {
      if (t !== "fantasy") continue;
      const kept = before.get(t);
      if (kept && kept.base === s.manifest.render) {
        overlays.set(t, kept);
        continue;
      }
      const made = kaykitRender(s.manifest.render, libPalette, libParts, look.size);
      if ("render" in made) overlays.set(t, { base: s.manifest.render, render: made.render });
      else reason = made.reason;
    }
    libStatus = reason ? { state: "fallback", reason: `The KayKit art was not used: ${reason}. The table shows the hand-drawn art.` } : { state: "ready" };
  }

  async function loadLibrary(): Promise<void> {
    if (libStatus.state === "ready" || libParts) return;
    const mine = epoch;
    const go = preflight("KayKit art", files.library, "the hand-drawn art");
    if ("reason" in go) {
      libStatus = { state: "fallback", reason: go.reason };
      return;
    }
    libStatus = { state: "loading" };
    const fail = (reason: string): void => {
      libStatus = { state: "fallback", reason };
      fire();
    };
    const res = await fetchAsset("KayKit art", go, parseLibraryFile, "the hand-drawn art");
    if (mine !== epoch) return;
    if (!res.ok) return fail(res.reason);
    const decoded: Map<string, number[][]>[] = [];
    for (const name of libraryPartFiles(look)) {
      const part = res.value.parts.find((p) => p.file === name);
      if (!part) return fail(`The KayKit art file has no ${name}. The table shows the hand-drawn art.`);
      try {
        decoded.push(await decodeLibraryPart(part, inflate));
      } catch (e) {
        if (mine !== epoch) return;
        return fail(`The KayKit art file could not be read (${errText(e)}). The table shows the hand-drawn art.`);
      }
    }
    if (mine !== epoch) return;
    libParts = decoded;
    libPalette = res.value.palette;
    refreshOverlays();
    fire();
  }

  function loadAssets(): Promise<void> {
    if (assetsRun) return assetsRun;
    // Each loader reports its own failures; the catches are for the day one forgets to.
    const both = Promise.all([
      loadCast().catch((e) => void (castStatus = { state: "fallback", reason: `The animated figures could not be loaded (${errText(e)}). The table shows still figures.` })),
      loadLibrary().catch((e) => void (libStatus = { state: "fallback", reason: `The KayKit art could not be loaded (${errText(e)}). The table shows the hand-drawn art.` })),
    ]);
    const mine = (assetsRun = both.then(() => undefined));
    void mine.then(() => {
      if (assetsRun === mine) assetsRun = null;
    });
    return mine;
  }

  const assetStatus = (): AssetStatus => {
    const text = (on: string, p: AssetPartStatus): string => (p.state === "ready" ? on : p.state === "fallback" ? (p.reason ?? "") : "");
    const bits = [text("Animated figures are on.", castStatus), text("KayKit art is on.", libStatus)].filter(Boolean);
    const pending = castStatus.state === "loading" || libStatus.state === "loading" || castStatus.state === "waiting";
    return { cast: { ...castStatus }, library: { ...libStatus }, summary: bits.length ? bits.join(" ") : pending ? "Loading the animated art." : "" };
  };

  function load(): Promise<void> {
    if (running) return running;
    running = (async () => {
      try {
        const results = await Promise.all(templates.map(async (t) => [t, await settle(t)] as const));
        settled.clear();
        for (const [t, s] of results) settled.set(t, s);
        refreshOverlays();
        ready = true;
        // The first paint does not wait for the animated art: it starts here, and a file that lands tells the window itself.
        void loadAssets();
        fire();
      } finally {
        running = null;
      }
    })();
    return running;
  }

  const get = (t: TemplateGenre): Settled => {
    const s = settled.get(t);
    if (!s) throw new Error(`The ${t} art is not loaded. Await art.load() before the table window uses it.`);
    return s;
  };

  return {
    load,
    loadAssets,
    assetStatus,
    status: (t) => get(t).status,
    manifest: (t) => get(t).manifest,
    catalog: (t) => get(t).catalog,
    render: (t): RenderManifest => {
      const s = get(t);
      const over = overlays.get(t);
      return over && over.base === s.manifest.render ? over.render : s.manifest.render;
    },
    cast: () => cast,
    setCast(next) {
      cast = next;
      castExplicit = next !== null;
      fire();
    },
    signature() {
      const parts = templates.map((t) => {
        const s = settled.get(t);
        return s ? `${t}:${s.source}:${fingerprint(s.manifest)}` : `${t}:none`;
      });
      const lib = overlays.size > 0 ? `|kaykit:${look.ground}-${look.chars}-${look.size}` : "";
      return `${parts.join(";")}|cast:${cast ? cast.style.style : "none"}${lib}`;
    },
    ready: () => ready,
    onChange(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    dispose() {
      listeners.clear();
      settled.clear();
      overlays.clear();
      epoch += 1;
      assetsRun = null;
      libParts = null;
      libPalette = null;
      castStatus = { state: "waiting" };
      libStatus = { state: "waiting" };
      if (!castExplicit) cast = null;
      ready = false;
    },
  };
}
