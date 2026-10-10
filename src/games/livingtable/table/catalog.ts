/**
 * The table's picture catalog, bound to a host.
 *
 * The engine code of the table window (state, snapshot, sight, fight rules, the
 * DM's scene, the adventure checks) needs to know which tile, prop and token ids
 * exist and which are walkable. In the bench that used to be module-level
 * constants built from the bench's own sprite arrays at import time (MANIFEST,
 * WALKABLE_BY_ID, WORLD_MANIFEST, DM_ASSETS, adventureAssets). Here they are
 * functions, built lazily from whatever host is bound, so the same modules serve
 * the bench (hand-drawn sprites) and the game (the games-db manifest).
 *
 *   bindCatalog(host.art)   once, before the first call below (mountTable does it; a host-less test does it itself)
 *   renderManifest(t)       was MANIFEST[t]
 *   worldManifest(t)        was WORLD_MANIFEST[t]
 *   walkableById(t)         was WALKABLE_BY_ID[t]
 *   dmAssets(t, monsters)   was DM_ASSETS[t]
 *   adventureAssets()       was adventureAssets()
 *
 * Calling any of them before a bind throws, naming the fix, rather than
 * answering from a stale or empty library.
 *
 * Caching: everything but `renderManifest` is cached per template, and only
 * once the art says it is ready. The cache is dropped when the art reports a
 * change and when a new host is bound. `renderManifest` is never cached here:
 * the host owns that (the bench's chosen art changes it).
 *
 * This module is import-pure: nothing runs until a function is called.
 */
import type { AdventureAssets } from "../adventures/types";
import type { TemplateGenre } from "../characters/templates";
import type { AssetManifest } from "../world/cell";
import { isOpaqueAssetId } from "../world/visibility";
import type { RenderManifest } from "../render/canvasRenderer";
import type { ArtCatalog, TableArt } from "./host";

export type { ArtCatalog };

/** The part of the host's art the catalog reads. Pass `host.art`. */
export type CatalogSource = Pick<TableArt, "catalog" | "render" | "ready" | "onChange">;

/** What the DM may place in a scene: prop ids, tile ids, and the monsters it may add. */
export interface DmAssets {
  props: string[];
  tiles: string[];
  monsters: string[];
}

// ---- building a catalog ---------------------------------------------------------

/** One sprite as a catalog needs it: the shape of scripts/assets' own sprite records, less the pixels. */
export interface CatalogSprite {
  assetId: string;
  kind: "tile" | "prop" | "token";
  /** Display name. Optional: the id with spaces stands in. */
  name?: string;
  walkable: boolean;
}

/**
 * A catalog from a list of sprites, in the list's order. The world half is built
 * the way manifestCache.ts builds it for the game: tiles keep `walkable`, props
 * `blocks` when not walkable, and both get the sight flag from isOpaqueAssetId.
 */
export function catalogFromSprites(sprites: readonly CatalogSprite[]): ArtCatalog {
  const world: AssetManifest = { tiles: {}, props: {}, tokens: {} };
  const ids = { tiles: [] as string[], props: [] as string[], tokens: [] as string[] };
  const walkableTiles: string[] = [];
  const blockingProps: string[] = [];
  const names: Record<string, string> = {};
  for (const s of sprites) {
    if (s.name !== undefined) names[s.assetId] = s.name;
    if (s.kind === "tile") {
      world.tiles[s.assetId] = { walkable: s.walkable, opaque: isOpaqueAssetId("tile", s.assetId, s.walkable) };
      ids.tiles.push(s.assetId);
      if (s.walkable) walkableTiles.push(s.assetId);
    } else if (s.kind === "prop") {
      world.props[s.assetId] = { blocks: !s.walkable, opaque: isOpaqueAssetId("prop", s.assetId, s.walkable) };
      ids.props.push(s.assetId);
      if (!s.walkable) blockingProps.push(s.assetId);
    } else {
      world.tokens[s.assetId] = {};
      ids.tokens.push(s.assetId);
    }
  }
  return { world, ids, walkableTiles, blockingProps, names };
}

/** A catalog from an engine manifest that already exists (the game's LoadedManifest.world), in the manifest's key order. */
export function catalogFromWorld(world: AssetManifest, names?: Readonly<Record<string, string>>): ArtCatalog {
  const tiles = Object.keys(world.tiles);
  const props = Object.keys(world.props);
  return {
    world,
    ids: { tiles, props, tokens: Object.keys(world.tokens) },
    walkableTiles: tiles.filter((id) => world.tiles[id]?.walkable === true),
    blockingProps: props.filter((id) => world.props[id]?.blocks === true),
    ...(names ? { names } : {}),
  };
}

// ---- the binding ------------------------------------------------------------------

interface Cache {
  catalog: Partial<Record<TemplateGenre, ArtCatalog>>;
  walkable: Partial<Record<TemplateGenre, Map<string, boolean>>>;
  dm: Map<string, DmAssets>;
  adventure: AdventureAssets | null;
}

const emptyCache = (): Cache => ({ catalog: {}, walkable: {}, dm: new Map(), adventure: null });

let source: CatalogSource | null = null;
/** Identifies the current binding, so a stale unbind of a replaced binding (even of the same art object) does nothing. */
let binding: object | null = null;
let cache: Cache = emptyCache();
let unsubscribe: (() => void) | null = null;

/**
 * Bind the catalog to a host's art. Replaces any earlier binding and drops the
 * cache. Returns an unbind function that clears the binding only if it is still
 * the current one, so a window disposing late cannot unbind its successor.
 */
export function bindCatalog(art: CatalogSource): () => void {
  unsubscribe?.();
  const mine = {};
  binding = mine;
  source = art;
  cache = emptyCache();
  unsubscribe = art.onChange(() => {
    if (binding === mine) cache = emptyCache();
  });
  return () => {
    if (binding !== mine) return;
    unbindCatalog();
  };
}

/** Whether a host is bound. */
export function catalogBound(): boolean {
  return source !== null;
}

/** Drop any binding. For tests that need to prove the unbound state. */
export function unbindCatalog(): void {
  unsubscribe?.();
  unsubscribe = null;
  binding = null;
  source = null;
  cache = emptyCache();
}

function bound(): CatalogSource {
  if (!source) throw new Error("The table catalog is not bound to a host. Call bindCatalog(host.art) first.");
  return source;
}

/** Keep a computed value only while the art says it is ready, so a half-loaded library is never remembered. */
function remember<T>(art: CatalogSource, put: () => void, value: T): T {
  if (art.ready()) put();
  return value;
}

// ---- the lazy constants -------------------------------------------------------------

/** The host's catalog for a template. */
export function artCatalog(t: TemplateGenre): ArtCatalog {
  const art = bound();
  const held = cache.catalog[t];
  if (held) return held;
  const made = art.catalog(t);
  return remember(art, () => (cache.catalog[t] = made), made);
}

/** The paint-ready manifest, straight from the host (never cached here). Was MANIFEST[t]; the bench kept it as the hand-drawn art. */
export function renderManifest(t: TemplateGenre): RenderManifest {
  return bound().render(t);
}

/** The engine's view of a template's assets: tile walkability, blocking props, the sight flag. Was WORLD_MANIFEST[t]. */
export function worldManifest(t: TemplateGenre): AssetManifest {
  return artCatalog(t).world;
}

/**
 * Whether each asset id can be walked on: a tile by its walkable flag, a prop by
 * not blocking, a token as true. An id the library does not have is absent, so
 * `.has(id)` is "the library knows it". Was WALKABLE_BY_ID[t].
 */
export function walkableById(t: TemplateGenre): ReadonlyMap<string, boolean> {
  const art = bound();
  const held = cache.walkable[t];
  if (held) return held;
  const { world } = artCatalog(t);
  const m = new Map<string, boolean>();
  for (const [id, tile] of Object.entries(world.tiles)) m.set(id, tile.walkable);
  for (const [id, prop] of Object.entries(world.props)) m.set(id, prop.blocks !== true);
  for (const id of Object.keys(world.tokens)) m.set(id, true);
  return remember(art, () => (cache.walkable[t] = m), m);
}

/** What the DM may not place: doors, chests (the chest is the engine's own loot roll) and the pieces of a cottage or an archway. */
export const DM_PROP_SKIP = /^(door_|chest|cottage_|arch_|wall_)/;
/** Tiles the DM may not paint: the edge, join and variant pieces the renderer picks on its own. */
export const DM_TILE_SKIP = /_edge_|_join_|_(b|c|d)$|_pale|^wall_stone_(top|base)$/;

/**
 * What the DM may place in a scene, in library order. `monsters` is the scene's
 * own pair (the kit's monster and second), which the table knows and the
 * library does not. Was DM_ASSETS[t].
 */
export function dmAssets(t: TemplateGenre, monsters: readonly string[]): DmAssets {
  const art = bound();
  const key = `${t}|${monsters.join(",")}`;
  const held = cache.dm.get(key);
  if (held) return held;
  const { ids } = artCatalog(t);
  const made: DmAssets = {
    props: ids.props.filter((id) => !DM_PROP_SKIP.test(id)),
    tiles: ids.tiles.filter((id) => !DM_TILE_SKIP.test(id)),
    monsters: [...monsters],
  };
  return remember(art, () => cache.dm.set(key, made), made);
}

/** The picture ids and walkability the game really has (the fantasy template): what every adventure is checked against. Was adventureAssets(). */
export function adventureAssets(): AdventureAssets {
  const art = bound();
  if (cache.adventure) return cache.adventure;
  const c = artCatalog("fantasy");
  const made: AdventureAssets = {
    tiles: [...c.ids.tiles],
    props: [...c.ids.props],
    tokens: [...c.ids.tokens],
    walkableTiles: [...c.walkableTiles],
    blockingProps: [...c.blockingProps],
  };
  return remember(art, () => (cache.adventure = made), made);
}

/** A readable name for an asset id: the library's own, else the id with spaces for underscores. */
export function spriteName(t: TemplateGenre, id: string): string {
  return artCatalog(t).names?.[id] ?? id.replace(/_/g, " ");
}
