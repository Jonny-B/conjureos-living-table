/**
 * Client-side cache for the Living Table's asset manifest (DESIGN.md,
 * "Assets: a code-defined library, not painted files"). Fetches a whole
 * template's manifest ONCE via games-db's `ltAssetManifest` action ("small
 * at launch scale, no per-scene streaming needed yet") and adapts its wire
 * shape into the two engine-facing shapes that already exist:
 *
 *   - world/cell.ts's AssetManifest: loose, validation-only ("does this id
 *     exist, is it walkable"), consumed by world/connectivity.ts and
 *     world/manipulation.ts.
 *   - render/canvasRenderer.ts's RenderManifest: the full paint-ready shape,
 *     a shared hex palette plus a SpriteAsset per tile/token/prop.
 *
 * Cached in memory (survives a repeat campaign in the same tab, the literal
 * "a repeat campaign in the same session" case) and in localStorage
 * (survives a reload too). localStorage rather than DESIGN.md's mention of
 * IndexedDB: at launch scale (a few dozen sprites, tens of KB per template,
 * per DESIGN.md's own "Assets" section) that's comfortably inside
 * localStorage's per-origin budget and needs no async DB setup; IndexedDB is
 * the right call once the library grows into the hundreds-of-assets
 * streaming path DESIGN.md names as future work, not before.
 */
import * as api from "../../../bridge/gamesApi";
import type { LtAssetWire, LtTemplate } from "../../../bridge/gamesApi";
import type { AssetManifest } from "../world/cell";
import type { RenderManifest, SpriteAsset } from "../render/canvasRenderer";
import { isUsableSpriteSize } from "../render/spritePixels";
import { isRenderOnlyAssetId } from "../render/wallProfiles";
import { isOpaqueAssetId } from "../world/visibility";

/** Every tile, token and prop id a library has, as flat lists (the ids a written adventure or the DM may name). */
export interface AvailableAssetIds {
  tiles: string[];
  tokens: string[];
  props: string[];
}

export interface LoadedManifest {
  template: LtTemplate;
  /** Feeds world/connectivity.ts and world/manipulation.ts's validation calls. */
  world: AssetManifest;
  /** Feeds render/canvasRenderer.ts's renderCell. */
  render: RenderManifest;
  /** The flat id lists the DM is offered. */
  availableAssetIds: AvailableAssetIds;
}

interface WireManifest {
  template: LtTemplate;
  palette: unknown;
  assets: LtAssetWire[];
  /**
   * Source pixels per tile edge, when the library is drawn at something other
   * than 16 (a 32 means 32x32 tiles and 32x48 tokens). Absent on every
   * manifest served before the field existed, which therefore still reads as
   * 16. Typed `unknown` because nothing shares a type with games-db across the
   * wire; `adaptManifest` keeps it only when it is a usable size.
   */
  spriteSize?: unknown;
}

const memoryCache = new Map<LtTemplate, LoadedManifest>();
// Bumped v1 -> v2 when the sprite library was redrawn (16x16 flat tokens to
// 16x24 layered ones, 16-colour palettes to 52). A cached v1 manifest is a
// different art generation, and because the cache survives a reload it would
// otherwise keep serving the old sprites to anyone who had already played,
// which looks exactly like the redraw never shipped.
// Bumped v2 -> v3 for contract v2 (equipmentTypes.ts section 11): 15 new
// gear_* sprites per template (boots overlays, ring/amulet icons, the two
// empty-slot silhouettes) and a wider palette entry count are not additions
// an already-cached v2 manifest would ever pick up on its own, so a
// returning player would keep the pre-loot art generation until the cache
// happened to expire, which reads exactly like this feature never shipped.
// NOT bumped for the source-resolution field: `adaptManifest` reads an
// optional `spriteSize` off the wire, and a cached manifest without one is a
// self-consistent 16 px library. Bump this (v3 -> v4) in the same release that
// starts serving a 32 px library, or returning players keep the cached 16 px
// art and it reads exactly like the new art never shipped.
const STORAGE_PREFIX = "livingtable:manifest:v3:";

/** "#rrggbb" from an [r,g,b] byte triple, each channel clamped so a stray out-of-range value can't produce invalid CSS. */
function hexFromTriple(triple: unknown): string {
  const [r, g, b] = Array.isArray(triple) ? triple : [0, 0, 0];
  const channel = (n: unknown) => {
    const v = typeof n === "number" ? n : 0;
    return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  };
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * The palette as games-db actually hands it over: an array of [r,g,b] byte
 * triples, the exact shape scripts/assets/{fantasy,scifi}.ts's own PALETTE
 * constant is authored in and build-seed-code.mjs embeds verbatim.
 * Normalised here into the hex strings RenderManifest.palette expects.
 * Defensive about an already-hex-string entry too (checked first): nothing
 * pins the wire contract down with a shared type between this repo and
 * games-db, so if the server ever starts sending hex directly this still
 * works rather than double-encoding it.
 */
export function adaptPalette(wirePalette: unknown): string[] {
  if (!Array.isArray(wirePalette)) return [];
  return wirePalette.map((entry) => {
    if (typeof entry === "string") return entry.startsWith("#") ? entry : `#${entry}`;
    return hexFromTriple(entry);
  });
}

/**
 * Turn `ltAssetManifest`'s flat `assets` array (one entry per sprite,
 * `kind` telling tile/token/prop apart) plus its palette into the three
 * things the rest of the game actually consumes: the two manifest shapes
 * above, and the flat id lists (AvailableAssetIds) the DM
 * needs (the DM is only allowed to reference an id that's actually here).
 */
export function adaptManifest(wire: WireManifest): LoadedManifest {
  const world: AssetManifest = { tiles: {}, tokens: {}, props: {} };
  const render: RenderManifest = { palette: adaptPalette(wire.palette), tiles: {}, tokens: {}, props: {} };
  // The resolution rides on the wire manifest, not on any one asset (a sprite's
  // own pixel grid is its size; how many source pixels make a TILE is a
  // property of the whole library). Left OFF when absent or unusable rather than
  // written as 16, so a manifest from before the field existed adapts to exactly
  // the object it always did.
  if (isUsableSpriteSize(wire.spriteSize)) render.spriteSize = wire.spriteSize;
  const availableAssetIds: AvailableAssetIds = { tiles: [], tokens: [], props: [] };

  for (const asset of wire.assets) {
    const sprite: SpriteAsset = { pixels: asset.pixels };
    // The wall-profile art is the renderer's and nobody else's: the joins, the
    // jamb overlay and the side-on door leaves go into `render` and NOWHERE
    // ELSE. Left out of `world`, naming one is rejected as an unknown asset
    // (validateLayout, setDoorState, placeProp); left out of
    // `availableAssetIds`, the prompt never lists one. That closes the hole at
    // both ends, the same way the gear sprites are kept out of what the DM may
    // place. They only ever arrive as tiles or props; any other kind is dropped.
    if (isRenderOnlyAssetId(asset.assetId)) {
      if (asset.kind === "tile") render.tiles[asset.assetId] = sprite;
      else if (asset.kind === "prop") render.props[asset.assetId] = sprite;
      continue;
    }
    if (asset.kind === "tile") {
      // `opaque` is the sight flag, apart from walking (world/visibility.ts):
      // the backend does not send one yet, so it is stamped from the asset id,
      // which is why water is see-through here and a wall is not.
      world.tiles[asset.assetId] = { walkable: asset.walkable, opaque: isOpaqueAssetId("tile", asset.assetId, asset.walkable) };
      render.tiles[asset.assetId] = sprite;
      availableAssetIds.tiles.push(asset.assetId);
    } else if (asset.kind === "token") {
      // world/cell.ts's AssetManifest only ever reads `.walkable` off
      // `tiles` (see connectivity.ts's validateLayout and
      // manipulation.ts's walkableAt): a token's own walkability isn't a
      // concept the engine checks, only the tile underneath it is, so
      // tokens/props here carry an empty record, matching the loose
      // `Record<string, unknown>` that type declares for them.
      world.tokens[asset.assetId] = {};
      render.tokens[asset.assetId] = sprite;
      availableAssetIds.tokens.push(asset.assetId);
    } else if (asset.kind === "prop") {
      // A prop's `walkable:false` on the wire is what makes a door a door
      // rather than a sprite swap: manipulation.ts's `walkableAt` consults
      // this `blocks` flag, so a `door_closed` genuinely stops a token
      // standing on its tile and `door_open` doesn't. The wire already
      // carries the right answer (scripts/assets/fantasy.ts marks
      // door_closed, tree and chest walkable:false, door_open and torch
      // true); without this line the flag was never set in the running game
      // and `setDoorState` changed a picture and nothing else.
      // `opaque` is separate from `blocks`: a chest blocks walking, not sight;
      // a closed door blocks both.
      world.props[asset.assetId] = { blocks: asset.walkable === false, opaque: isOpaqueAssetId("prop", asset.assetId, asset.walkable) };
      render.props[asset.assetId] = sprite;
      availableAssetIds.props.push(asset.assetId);
    }
  }

  return { template: wire.template, world, render, availableAssetIds };
}

function readFromStorage(template: LtTemplate): LoadedManifest | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + template);
    if (!raw) return null;
    return adaptManifest(JSON.parse(raw) as WireManifest);
  } catch {
    return null; // a corrupt or stale cache entry is just a cache miss, never a crash
  }
}

function writeToStorage(template: LtTemplate, wire: WireManifest): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + template, JSON.stringify(wire));
  } catch {
    // localStorage can throw (quota, private browsing); losing the cache is
    // fine, losing the manifest itself is not, so this never bubbles up.
  }
}

/**
 * Fetch a template's manifest once and cache it. An in-memory hit
 * short-circuits everything; a localStorage hit survives a page reload;
 * only a genuine miss calls games-db at all, exactly the "fetch once, cache
 * client-side" DESIGN.md's Assets section asks for.
 *
 * `fresh: true` skips both caches and asks games-db, then replaces what was cached with the answer. The game's Retry after the art
 * could not be had uses it: a cached copy is exactly what was refused (for instance a palette the KayKit board art does not fit), so
 * a server library that has been fixed is only seen by asking. A failed fresh load throws and leaves the caches as they were.
 */
export async function loadManifest(template: LtTemplate, opts: { fresh?: boolean } = {}): Promise<LoadedManifest> {
  if (opts.fresh !== true) {
    const cached = memoryCache.get(template);
    if (cached) return cached;

    const fromStorage = readFromStorage(template);
    if (fromStorage) {
      memoryCache.set(template, fromStorage);
      return fromStorage;
    }
  }

  const wire = await api.ltAssetManifest(template);
  writeToStorage(template, wire);
  const loaded = adaptManifest(wire);
  memoryCache.set(template, loaded);
  return loaded;
}

/** Test-only escape hatch: clears both cache layers so a test can start from a known-empty state. */
export function clearManifestCacheForTests(): void {
  memoryCache.clear();
  try {
    globalThis.localStorage?.removeItem(STORAGE_PREFIX + "fantasy");
    globalThis.localStorage?.removeItem(STORAGE_PREFIX + "scifi");
  } catch {
    /* nothing to clear */
  }
}
