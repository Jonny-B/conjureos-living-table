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
 * them):
 *
 *   await art.load();         // the hand-drawn art settles (it stays only for the ids the library lacks)
 *   await art.loadAssets();   // the cast and the KayKit library; load() has already started it in the background
 *
 * The game does not mount its window until BOTH files are in (artGate.ts waits for them, and shows a
 * Retry screen when one cannot be had), so a player never sees the hand-drawn picture of anything that
 * has a KayKit one. A bench host that mounts at once still gets `onChange` when a file lands.
 *
 * Each file goes through `window.__conjureos.assets.load(name)` (the platform checks it against the hash
 * recorded at publish and keeps it on the device), is parsed and checked once, and kept. A file with no name
 * (assetFiles null), a bridge that is not there (outside the ConjureOS app) or that does not give a game its
 * files (an older ConjureOS app), a failed, mismatched or hung load (each file gets `loadTimeoutMs` to arrive),
 * or a file that does not parse leaves that part not loaded. `assetStatus()` says why with ONE fixed plain
 * sentence per kind of failure (artFailure.ts), which the game's art screen shows; the raw detail (a status
 * code, an exception's message, the platform's reason code) goes to `warn` (console.warn) and nowhere else.
 * Nothing here throws or rejects because of an asset file. `loadAssets()` tries a part that failed again, and
 * `load({ fresh: true })` is the whole thing again (the games-db manifest from the server, not from the cache,
 * and the parts that failed); parts that loaded are kept, so nothing is fetched twice.
 *
 * The cast is `cast()`: null until its file lands. The KayKit library, when it lands, replaces the
 * render half the window draws with (`render(t)`: the chosen ground, props and tokens at 32 px). The hand-drawn
 * picture, upscaled, remains for exactly the ids the library has no version of (`handMade(t)` lists them,
 * `converted(id)` asks about one; both are worked out from the loaded files, so the list shrinks by itself as
 * more are converted); the catalog and the DM's id lists never change.
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
import { ART_FAILURE_TEXT, bridgeFailure, type ArtFailure } from "./artFailure";
import { devAssetBridge } from "./devAssets";

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
  /** The manifest loader. Default: manifestCache's `loadManifest`. It gets `{ fresh: true }` on a Retry: the server's copy, not a cached one. */
  load?: (t: LtTemplate, o?: LoadOptions) => Promise<LoadedManifest>;
  /** The ids the table needs per template. Default: ENGINE_ASSET_IDS. Hosts add the adventures with `adventureAssetIds`. */
  required?: (t: TemplateGenre) => AssetIdSet;
  /** The bundled libraries. Default: the generated bundledArt module, imported on demand. */
  bundled?: () => Promise<Partial<Record<TemplateGenre, BundledLibrary>>> | Partial<Record<TemplateGenre, BundledLibrary>>;
  /** A cast the host already has. Default: none (the cast file is loaded instead). */
  cast?: () => { data: CastData; style: CastStyle } | null;
  /** The asset files to read, by name. Default: ASSET_FILES (assetFiles.ts, the two files package.json lists). */
  assetFiles?: AssetFiles;
  /** ConjureOS's asset loader. Default: `window.__conjureos.assets`, read when the load starts (absent outside the app; a local dev page with no ConjureOS at all reads the dev server's copy, devAssets.ts). */
  assets?: AssetsBridge | null | (() => AssetsBridge | null | undefined);
  /** Turns a loaded file's object URL into its parsed JSON. Default: fetch it, parse it, revoke the URL. */
  readJson?: (objectUrl: string) => Promise<unknown>;
  /** Inflates a zlib stream (the library's packed pixels). Default: the browser's DecompressionStream. */
  inflate?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** The look of the KayKit art and which cast style goes with it. Default: painted ground, cel-band figures, 32 px. */
  look?: Partial<ArtLook>;
  /**
   * How long one asset file gets to arrive before the load counts as a failed download. Default ASSET_LOAD_TIMEOUT_MS. A load that
   * finishes after that changes nothing (its object URL is let go and the answer dropped).
   */
  loadTimeoutMs?: number;
  /** Where the raw detail of a failure goes (it never reaches the screen). Default: console.warn. */
  warn?: (message: string) => void;
}

/** What a manifest load may be asked for. */
export interface LoadOptions {
  /** Bypass whatever the loader has cached and ask the server. A Retry sets it, so a corrected server library is seen. */
  fresh?: boolean;
}

/**
 * The time one asset file gets to arrive: two minutes, so the biggest file (about 6.3 MB) still makes it over a slow phone connection,
 * while a download that never ends reaches the Retry screen instead of waiting for ever.
 */
export const ASSET_LOAD_TIMEOUT_MS = 120_000;

// ---- the animated art (asset files) ----------------------------------------------------

/** The result `assets.load` hands back; it never rejects. */
export type AssetLoadResult = { ok: true; objectUrl: string; blob?: Blob } | { ok: false; reason: string; error?: string };

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

/**
 * Where one asset file is: not asked for yet, on its way, in use, or not loaded ("fallback"). A part not loaded says why as a kind
 * (`failure`) and that kind's fixed sentence (`reason`, from ART_FAILURE_TEXT); the game's art screen shows the sentence.
 */
export interface AssetPartStatus {
  state: "waiting" | "loading" | "ready" | "fallback";
  failure?: ArtFailure;
  reason?: string;
}

export interface AssetStatus {
  cast: AssetPartStatus;
  library: AssetPartStatus;
  /** One line for diagnostics: what loaded and, if something did not, why. */
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

/** The picture the KayKit parts have for an id (the first part that has one, in the order the look tries them), or null when none has. */
function libraryPicture(id: string, parts: readonly Map<string, number[][]>[]): number[][] | null {
  for (const p of parts) {
    const px = p.get(id);
    if (px) return px;
  }
  return null;
}

/**
 * Whether the KayKit parts have a picture of this id. This is THE converted-or-not decision: a converted id is drawn from the
 * library and never from the hand-drawn set; an id the library lacks keeps its hand-drawn picture (upscaled by `kaykitRender`).
 * Worked out from the loaded parts, so it changes by itself when the library gains an id.
 */
export function isConvertedId(id: string, parts: readonly Map<string, number[][]>[]): boolean {
  return libraryPicture(id, parts) !== null;
}

/**
 * The ids of `base` the KayKit parts have no picture of: exactly the ones still drawn from the hand-drawn set. Computed from
 * the files (the base render and the decoded parts), never listed by hand, so it shrinks as more art is converted.
 */
export function unconvertedIds(base: RenderManifest, parts: readonly Map<string, number[][]>[]): AssetIdSet {
  const left = (ids: string[]): string[] => ids.filter((id) => !isConvertedId(id, parts));
  return { tiles: left(Object.keys(base.tiles)), props: left(Object.keys(base.props)), tokens: left(Object.keys(base.tokens)) };
}

/**
 * The render half to draw with when the KayKit library is in: every id of `base`, drawn from the look's parts
 * where they have it and from `base` (upscaled to the look's size) where they do not (`unconvertedIds` says which).
 * Returns the reason instead when the two cannot be combined: the base is not 16 px art, or its palette is not the
 * one the library was converted to (a sprite is palette indices, so the palettes must be the same colours).
 */
export function kaykitRender(
  base: RenderManifest,
  libraryPalette: unknown,
  parts: readonly Map<string, number[][]>[],
  size: 16 | 32,
): { render: RenderManifest } | { reason: string } {
  if ((base.spriteSize ?? 16) !== 16) return { reason: "the base art is not 16 px, so the board art cannot be laid over it" };
  const want = adaptPalette(libraryPalette).map((c) => c.toLowerCase());
  const have = base.palette.map((c) => c.toLowerCase());
  if (want.length !== have.length || want.some((c, i) => c !== have[i])) return { reason: "its colours are not the game's palette" };
  const k = size / 16;
  const pick = (id: string, current: number[][]): number[][] => libraryPicture(id, parts) ?? upscale(current, k);
  const render: RenderManifest = { palette: base.palette, tiles: {}, props: {}, tokens: {}, spriteSize: size };
  for (const [id, a] of Object.entries(base.tiles)) render.tiles[id] = { pixels: pick(id, a.pixels) };
  for (const [id, a] of Object.entries(base.props)) render.props[id] = { pixels: pick(id, a.pixels) };
  for (const [id, a] of Object.entries(base.tokens)) render.tokens[id] = { pixels: pick(id, a.pixels) };
  return { render };
}

/**
 * The plain words for a failed `assets.load`: the fixed sentence of the kind the platform's reason code means. The code itself and the
 * error text are never part of it (they are for the log).
 */
export function assetReason(r: { reason: string; error?: string }): string {
  return ART_FAILURE_TEXT[bridgeFailure(r.reason)];
}

export interface GameArt extends TableArt {
  /**
   * Fetch and settle every template. Safe to call again: it returns the same promise while one is running, and reloads after.
   * `{ fresh: true }` (a Retry) asks the loader for the server's copy instead of a cached one, and lays the loaded KayKit library
   * over it again, so a manifest that was wrong and has been fixed is seen. Parts already loaded are kept.
   */
  load(opts?: LoadOptions): Promise<void>;
  /**
   * Load the cast and the KayKit library from their asset files (once; a settled load is kept, a failed one is tried
   * again on the next call). Never rejects. `load()` starts it in the background, so a host only calls this to wait
   * for it (a test, or a retry button).
   */
  loadAssets(): Promise<void>;
  /** Where the cast and the library are, with the plain reason for any that did not load. Safe at any time. */
  assetStatus(): AssetStatus;
  /**
   * The ids of a template still drawn from the hand-drawn art: those of the settled art the loaded KayKit library has no
   * picture of. Null until the library is in (before that every id is hand-drawn, and the game does not play then).
   * Throws before `load()` has settled the template.
   */
  handMade(t: TemplateGenre): AssetIdSet | null;
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
/**
 * The file's JSON from the Blob `assets.load` handed over, read in place. Preferred over fetching the blob: address,
 * which a runner whose CSP `connect-src` does not list blob: refuses ("CSP blocked connect-src (blob)", ConjureOS
 * apphost before 0.1.8): that refusal is what kept every web build on the old art. The address is let go either way.
 */
async function readBlobJson(blob: Blob, objectUrl: string): Promise<unknown> {
  try {
    return JSON.parse(await blob.text());
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // nothing to free outside a browser
    }
  }
}

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
  const loadTimeoutMs = opts.loadTimeoutMs ?? ASSET_LOAD_TIMEOUT_MS;
  const warn =
    opts.warn ??
    ((message: string): void => {
      try {
        console.warn(message);
      } catch {
        // no console: nothing to tell
      }
    });
  /** The raw detail of a failure goes here and only here; the player reads the fixed sentence of the kind (artFailure.ts). */
  const note = (what: string, failure: ArtFailure, detail: unknown): void => warn(`The Living Table art: ${what}: ${failure}: ${errText(detail)}`);
  /** A part that did not load: its kind and the kind's fixed sentence. */
  const notLoaded = (failure: ArtFailure): AssetPartStatus => ({ state: "fallback", failure, reason: ART_FAILURE_TEXT[failure] });

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

  async function settle(t: TemplateGenre, fresh: boolean): Promise<Settled> {
    const need = required(t);
    let manifest: LoadedManifest | null = null;
    let error: string | undefined;
    try {
      manifest = await (fresh ? loadOne(t, { fresh: true }) : loadOne(t));
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
      return found ?? devAssetBridge();
    } catch {
      return null;
    }
  };

  /** Whether the page is inside a ConjureOS host at all (it defines `window.__conjureos`), as opposed to a plain web page. */
  const conjureosHere = (): boolean => {
    try {
      return (globalThis as { __conjureos?: unknown }).__conjureos != null;
    } catch {
      return false;
    }
  };

  /**
   * What stops an asset file loading before any work is done (no name, a malformed name, no bridge, a ConjureOS app too old
   * to give a game its files), as a kind of failure, or the bridge and name to go ahead with. Synchronous, so a part that
   * cannot load settles at once. A ConjureOS host with no assets bridge (or one without `list`) is an app to update; no host at all
   * is a page to open in the app.
   */
  function preflight(what: string, name: string | null): { failure: ArtFailure } | { b: AssetsBridge; name: string } {
    const no = (failure: ArtFailure, detail: string): { failure: ArtFailure } => {
      note(what, failure, detail);
      return { failure };
    };
    if (!name) return no("unavailable", "no file of this name is part of this build");
    if (!validAssetName(name)) return no("unavailable", `the file name ${JSON.stringify(name)} is not valid`);
    const b = bridge();
    if (!b) return conjureosHere() ? no("update", "window.__conjureos has no assets bridge") : no("outside", "there is no window.__conjureos");
    if (typeof b.load !== "function" || typeof b.list !== "function") return no("update", "the assets bridge has no list(), so this ConjureOS does not give a game its files");
    return { b, name };
  }

  /**
   * The bridge's answer to `load(name)`, or a download failure when it has not answered within `loadTimeoutMs`. Never rejects.
   * An answer that comes after the limit changes nothing: it is dropped, and the object address it made is given back.
   */
  function loadWithin(b: AssetsBridge, name: string): Promise<AssetLoadResult> {
    const asked = (async (): Promise<AssetLoadResult> => {
      try {
        return await b.load(name);
      } catch (e) {
        return { ok: false, reason: "fetch_failed", error: errText(e) };
      }
    })();
    return new Promise<AssetLoadResult>((resolve) => {
      let over = false;
      const timer = setTimeout(() => {
        over = true;
        resolve({ ok: false, reason: "fetch_failed", error: `no answer within ${loadTimeoutMs} ms` });
      }, loadTimeoutMs);
      void asked.then((r) => {
        if (!over) {
          clearTimeout(timer);
          resolve(r);
        } else if (r && r.ok === true) {
          try {
            URL.revokeObjectURL(r.objectUrl);
          } catch {
            // nothing to give back outside a browser
          }
        }
      });
    });
  }

  /** One asset file, through the bridge, parsed and checked. Never throws. `what` is the plain word for the file in the log. */
  async function fetchAsset<T>(what: string, go: { b: AssetsBridge; name: string }, parse: (x: unknown) => T | null): Promise<{ ok: true; value: T } | { ok: false; failure: ArtFailure }> {
    const no = (failure: ArtFailure, detail: unknown): { ok: false; failure: ArtFailure } => {
      note(what, failure, detail);
      return { ok: false, failure };
    };
    const r = await loadWithin(go.b, go.name);
    if (!r || r.ok !== true) return no(bridgeFailure(r?.reason), r ? `${String(r.reason)}${r.error ? `: ${r.error}` : ""}` : "the bridge gave no answer");
    let json: unknown;
    try {
      json = r.blob && typeof r.blob.text === "function" ? await readBlobJson(r.blob, r.objectUrl) : await readJson(r.objectUrl);
    } catch (e) {
      return no(e instanceof SyntaxError ? "damaged" : "unknown", e);
    }
    const value = parse(json);
    return value ? { ok: true, value } : no("damaged", "the file is not in the format the table expects");
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
    const go = preflight("animated figures", files.cast);
    if ("failure" in go) {
      castStatus = notLoaded(go.failure);
      return;
    }
    castStatus = { state: "loading" };
    const res = await fetchAsset("animated figures", go, parseCastFile);
    if (mine !== epoch) return;
    if (castExplicit) {
      castStatus = { state: "ready" }; // the host set its own cast while the file was on its way: that one stays
    } else if (res.ok) {
      cast = { data: res.value, style: chooseStyle(res.value) };
      castStatus = { state: "ready" };
    } else {
      castStatus = notLoaded(res.failure);
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
    if (reason) {
      note("board art", "mismatch", reason);
      libStatus = notLoaded("mismatch");
    } else {
      libStatus = { state: "ready" };
    }
  }

  async function loadLibrary(): Promise<void> {
    // Decoded parts are kept across a Retry (nothing is fetched twice). If the library was refused for not fitting the games-db art
    // (status "fallback", mismatch), the Retry's `load({ fresh: true })` lays the kept parts over the corrected art (refreshOverlays).
    if (libStatus.state === "ready" || libParts) return;
    const mine = epoch;
    const go = preflight("board art", files.library);
    if ("failure" in go) {
      libStatus = notLoaded(go.failure);
      return;
    }
    libStatus = { state: "loading" };
    const fail = (failure: ArtFailure, detail: unknown): void => {
      note("board art", failure, detail);
      libStatus = notLoaded(failure);
      fire();
    };
    const res = await fetchAsset("board art", go, parseLibraryFile);
    if (mine !== epoch) return;
    if (!res.ok) {
      libStatus = notLoaded(res.failure); // fetchAsset has logged the detail
      fire();
      return;
    }
    const decoded: Map<string, number[][]>[] = [];
    for (const name of libraryPartFiles(look)) {
      const part = res.value.parts.find((p) => p.file === name);
      if (!part) return fail("damaged", `the file has no ${name}`);
      try {
        decoded.push(await decodeLibraryPart(part, inflate));
      } catch (e) {
        if (mine !== epoch) return;
        return fail("damaged", e);
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
      loadCast().catch((e) => void (note("animated figures", "unknown", e), (castStatus = notLoaded("unknown")))),
      loadLibrary().catch((e) => void (note("board art", "unknown", e), (libStatus = notLoaded("unknown")))),
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

  function load(o: LoadOptions = {}): Promise<void> {
    if (running) return running;
    const fresh = o.fresh === true;
    running = (async () => {
      try {
        const results = await Promise.all(templates.map(async (t) => [t, await settle(t, fresh)] as const));
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
    handMade(t) {
      const s = get(t);
      const over = overlays.get(t);
      return over && over.base === s.manifest.render && libParts ? unconvertedIds(s.manifest.render, libParts) : null;
    },
    converted: (id) => libStatus.state === "ready" && libParts !== null && isConvertedId(id, libParts),
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
