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
 * The cast (the animated figures) is not here yet: `cast()` answers null, so the
 * window draws static tokens. `setCast` is the hook for when it is hosted.
 */
import type { LoadedManifest } from "../../assets/manifestCache";
import { adaptManifest, loadManifest } from "../../assets/manifestCache";
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

export type ArtSource = "games-db" | "bundled";

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
  /** The cast, once hosted. Default: none (static tokens). */
  cast?: () => { data: CastData; style: CastStyle } | null;
}

export interface GameArt extends TableArt {
  /** Fetch and settle every template. Safe to call again: it returns the same promise while one is running, and reloads after. */
  load(): Promise<void>;
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

const errText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error");

export function createGameArt(opts: GameArtOptions = {}): GameArt {
  const templates = opts.templates ?? (["fantasy"] as const);
  const loadOne = opts.load ?? loadManifest;
  const required = opts.required ?? ((t: TemplateGenre) => ENGINE_ASSET_IDS[t]);
  const getBundled = opts.bundled ?? defaultBundled;
  let cast: { data: CastData; style: CastStyle } | null = opts.cast?.() ?? null;

  const listeners = new Set<() => void>();
  const settled = new Map<TemplateGenre, Settled>();
  let running: Promise<void> | null = null;
  let ready = false;

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
      return { source: "games-db", manifest, catalog: own, status: { source: "games-db", missing: gap } };
    }
    const reason = error ? `games-db manifest not loaded: ${error}` : `games-db manifest lacks ${countIds(gap)} id(s) the table needs`;
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
      return { source: "games-db", manifest, catalog: own, status: { source: "games-db", missing: gap, reason } };
    }
    throw new Error(`The ${t} art could not be loaded and there is no bundled copy: ${error ?? "unknown error"}`);
  }

  function load(): Promise<void> {
    if (running) return running;
    running = (async () => {
      try {
        const results = await Promise.all(templates.map(async (t) => [t, await settle(t)] as const));
        settled.clear();
        for (const [t, s] of results) settled.set(t, s);
        ready = true;
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
    status: (t) => get(t).status,
    manifest: (t) => get(t).manifest,
    catalog: (t) => get(t).catalog,
    render: (t): RenderManifest => get(t).manifest.render,
    cast: () => cast,
    setCast(next) {
      cast = next;
      fire();
    },
    signature() {
      const parts = templates.map((t) => {
        const s = settled.get(t);
        return s ? `${t}:${s.source}:${fingerprint(s.manifest)}` : `${t}:none`;
      });
      return `${parts.join(";")}|cast:${cast ? cast.style.style : "none"}`;
    },
    ready: () => ready,
    onChange(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    dispose() {
      listeners.clear();
      settled.clear();
      ready = false;
    },
  };
}
