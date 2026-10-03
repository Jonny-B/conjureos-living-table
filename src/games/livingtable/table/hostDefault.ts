/**
 * An in-memory TableHost for tests and for any code that needs a window host
 * without a page: a small built-in picture library, saves and settings kept in
 * plain objects, no DM unless one is passed, files collected in a list.
 *
 * It is NOT a runtime host. Nothing in the game or the bench mounts it; they
 * bring their own. It reaches no global (no window, localStorage, Math.random
 * unless asked), so it runs under plain Node.
 *
 * Everything a test might want to look at or drive is on the returned object
 * next to the TableHost parts: `store` (saves), `downloads`, `sheets`, and
 * `fireArtChange()`.
 */
import { ARCHETYPE_IDS, TEMPLATE_OF_ARCHETYPE } from "../characters/equipmentTypes";
import { PLAYABLE_ARCHETYPE_IDS } from "../characters/templates";
import type { RenderManifest } from "../render/canvasRenderer";
import { catalogFromSprites, type CatalogSprite } from "./catalog";
import type {
  AdventureFile,
  ArchetypeId,
  ArtCatalog,
  CharacterSheet,
  SampleFn,
  TableHost,
  TableSettings,
  TemplateGenre,
} from "./host";

/**
 * A small library with the ids the table's rooms and scene kits name (the
 * fantasy and sci-fi floors, walls, doors and chest, the goblin, skeleton,
 * raider and drone tokens, one body token per hero). Walkability follows the
 * real art: floors walk, walls and water do not, a closed door and the chest
 * block, an open door does not. A test that needs the real library passes its
 * own `sprites` (scripts/assets/fantasy.ts and scifi.ts have the right shape).
 */
export const DEFAULT_SPRITES: Record<TemplateGenre, readonly CatalogSprite[]> = {
  fantasy: [
    { assetId: "floor_grass", kind: "tile", name: "Grass", walkable: true },
    { assetId: "floor_stone", kind: "tile", name: "Stone floor", walkable: true },
    { assetId: "floor_stone_cracked", kind: "tile", name: "Cracked stone floor", walkable: true },
    { assetId: "wall_stone", kind: "tile", name: "Stone wall", walkable: false },
    { assetId: "wall_stone_top", kind: "tile", name: "Stone wall top", walkable: false },
    { assetId: "wall_stone_base", kind: "tile", name: "Stone wall base", walkable: false },
    { assetId: "water_deep", kind: "tile", name: "Deep water", walkable: false },
    { assetId: "door_closed", kind: "prop", name: "Door", walkable: false },
    { assetId: "door_open", kind: "prop", name: "Open door", walkable: true },
    { assetId: "chest", kind: "prop", name: "Chest", walkable: false },
    { assetId: "chest_open", kind: "prop", name: "Open chest", walkable: false },
    { assetId: "torch", kind: "prop", name: "Torch", walkable: true },
    { assetId: "barrel", kind: "prop", name: "Barrel", walkable: false },
    { assetId: "token_knight", kind: "token", name: "Knight", walkable: true },
    { assetId: "token_shadow", kind: "token", name: "Shadow", walkable: true },
    { assetId: "token_fireball_person", kind: "token", name: "Fireball Person", walkable: true },
    { assetId: "token_goblin", kind: "token", name: "Goblin", walkable: true },
    { assetId: "token_skeleton", kind: "token", name: "Skeleton", walkable: true },
  ],
  scifi: [
    { assetId: "floor_deckplate", kind: "tile", name: "Deckplate", walkable: true },
    { assetId: "wall_bulkhead", kind: "tile", name: "Bulkhead", walkable: false },
    { assetId: "door_airlock_closed", kind: "prop", name: "Airlock", walkable: false },
    { assetId: "door_airlock_open", kind: "prop", name: "Open airlock", walkable: true },
    { assetId: "crate", kind: "prop", name: "Crate", walkable: false },
    { assetId: "token_raider", kind: "token", name: "Raider", walkable: true },
    { assetId: "token_drone", kind: "token", name: "Drone", walkable: true },
  ],
};

export interface MemoryHostOptions {
  /** The picture library per template. Defaults to DEFAULT_SPRITES. */
  sprites?: Partial<Record<TemplateGenre, readonly CatalogSprite[]>>;
  /** The DM's sampler. Omit for "no DM here" (`sample()` resolves null). */
  sample?: SampleFn | null;
  /** The sheet `heroes.initial()` returns. Default null (a fresh hero). */
  initialSheet?: CharacterSheet | null;
  /** The shipped adventures. Default none. */
  adventures?: readonly AdventureFile[];
  settings?: Partial<TableSettings>;
  /** The roll source. Default Math.random, read at call time. */
  rng?: () => number;
  reducedMotion?: boolean;
  address?: string;
  sandboxRooms?: boolean;
  debugExport?: boolean;
  /** Start with the art not ready, to test code that must wait for the library. Use `setReady`. */
  ready?: boolean;
}

export interface MemoryHost extends TableHost {
  /** The saves, by scope, exactly as written. */
  store: Map<string, string>;
  /** The AI adventures as last written. */
  aiAdventures: string[];
  /** Every file `files.save` was given, in order. */
  downloads: { filename: string; bytes: Uint8Array }[];
  /** Every sheet `heroes.onSheet` was given, in order. */
  sheets: CharacterSheet[];
  /** Tell the art's subscribers the library changed. */
  fireArtChange(): void;
  /** Flip `art.ready()`. */
  setReady(ready: boolean): void;
  /** Swap one template's sprites (the next `catalog` and `render` call sees them) and tell subscribers. */
  setSprites(t: TemplateGenre, sprites: readonly CatalogSprite[]): void;
  /** How many times `art.catalog` was called, per template (to prove caching). */
  catalogCalls: Record<TemplateGenre, number>;
}

/** The archetypes a player can start as, in library order: the fantasy ones the game has turned on. */
export function playableHeroIds(): ArchetypeId[] {
  return ARCHETYPE_IDS.filter((id) => TEMPLATE_OF_ARCHETYPE[id] === "fantasy" && PLAYABLE_ARCHETYPE_IDS.includes(id));
}

/** A render manifest for a sprite list: a two-colour palette and a flat 16 by 16 drawing per sprite. Enough for code that checks which ids exist. */
function renderOf(sprites: readonly CatalogSprite[]): RenderManifest {
  const flat = (): { pixels: number[][] } => ({ pixels: Array.from({ length: 16 }, () => new Array<number>(16).fill(1)) });
  const m: RenderManifest = { palette: ["#000000", "#c8c8c8"], tiles: {}, props: {}, tokens: {} };
  for (const s of sprites) (s.kind === "tile" ? m.tiles : s.kind === "prop" ? m.props : m.tokens)[s.assetId] = flat();
  return m;
}

export function createMemoryHost(opts: MemoryHostOptions = {}): MemoryHost {
  const sprites: Record<TemplateGenre, readonly CatalogSprite[]> = {
    fantasy: opts.sprites?.fantasy ?? DEFAULT_SPRITES.fantasy,
    scifi: opts.sprites?.scifi ?? DEFAULT_SPRITES.scifi,
  };
  const listeners = new Set<() => void>();
  let ready = opts.ready ?? true;
  let version = 0;
  const catalogCalls: Record<TemplateGenre, number> = { fantasy: 0, scifi: 0 };
  const settings: TableSettings = { textStyle: "pixel", rollMyself: true, diceSkin: "bone", zoom: null, ...opts.settings };
  const sample = opts.sample ?? null;
  const fire = (): void => {
    version += 1;
    for (const cb of [...listeners]) cb();
  };

  const host: MemoryHost = {
    store: new Map<string, string>(),
    aiAdventures: [],
    downloads: [],
    sheets: [],
    catalogCalls,
    fireArtChange: fire,
    setReady(r) {
      ready = r;
      fire();
    },
    setSprites(t, list) {
      sprites[t] = list;
      fire();
    },
    art: {
      catalog(t): ArtCatalog {
        catalogCalls[t] += 1;
        return catalogFromSprites(sprites[t]);
      },
      render: (t) => renderOf(sprites[t]),
      cast: () => null,
      signature: () => `memory|${version}`,
      ready: () => ready,
      onChange(cb) {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      },
    },
    dm: {
      sample: () => Promise.resolve(sample),
      unavailable: "There is no DM in this host.",
    },
    storage: {
      saves: {
        read: (scope) => host.store.get(scope) ?? null,
        write: (scope, text) => void host.store.set(scope, text),
      },
      aiAdventures: {
        read: () => [...host.aiAdventures],
        write: (texts) => {
          host.aiAdventures = [...texts];
        },
      },
    },
    files: {
      save(filename, bytes) {
        host.downloads.push({ filename, bytes });
        return Promise.resolve({ via: "none" as const, status: "kept in memory" });
      },
    },
    adventures: { files: () => opts.adventures ?? [] },
    heroes: {
      playable: playableHeroIds,
      initial: () => opts.initialSheet ?? null,
      onSheet(s) {
        host.sheets.push(s);
      },
    },
    settings: {
      get: () => ({ ...settings }),
      set(p) {
        Object.assign(settings, p);
      },
      ownedDiceSkins: () => ["bone"],
    },
    env: {
      rng: opts.rng ?? (() => Math.random()),
      reducedMotion: opts.reducedMotion ?? false,
      address: () => opts.address ?? "",
      sandboxRooms: opts.sandboxRooms ?? false,
      debugExport: opts.debugExport ?? false,
      build: { app: "Living Table (memory host)" },
    },
  };
  return host;
}
