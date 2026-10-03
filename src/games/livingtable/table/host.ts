/**
 * The table window's host contract.
 *
 * The table window (mountTable, in this folder) is the Living Table as one
 * self-contained piece: the board, the HUD, the dice tray, the sheet, the DM.
 * It reaches the outside world ONLY through a TableHost, so one copy of it
 * serves two places: the asset bench (which supplies its own art, a fake or
 * claude.ai DM and localStorage) and the shipped game (which supplies the
 * games-db art, the ai.complete bridge and the loaded character).
 *
 * This file is types only. Nothing here runs at import, so the build step that
 * bundles the registry and imports it in Node stays safe, and any module may
 * import it for the types.
 *
 * Four shapes below are declared here although their data comes from another
 * table module (CastData and friends, SampleFn, AdventureFile, TextStyle,
 * RoomChoice). They are the contract's own copies, structurally identical to
 * the originals, so this file depends on no sibling that may not exist yet. A
 * sibling may later re-export these instead of declaring its own.
 */
import type { TemplateGenre } from "../characters/templates";
import type { ArchetypeId } from "../characters/equipmentTypes";
import type { CharacterSheet } from "../characters/creation";
import type { RenderManifest } from "../render/canvasRenderer";
import type { AssetManifest } from "../world/cell";

export type { TemplateGenre, ArchetypeId, CharacterSheet, RenderManifest, AssetManifest };

// ---- art --------------------------------------------------------------------

/**
 * What the engine needs to know about a template's picture library: which ids
 * exist, which tiles can be walked, which props block a square, and how the
 * world sees each one (walkable, blocking, sight). The ids lists keep the
 * library's own order, because that order reaches the DM's prompt.
 *
 * Hosts should build one with `catalogFromSprites` or `catalogFromWorld`
 * (catalog.ts) rather than by hand, so the four fields cannot disagree.
 */
export interface ArtCatalog {
  /** The engine's view: tile walkability, prop `blocks`, and the sight flag `opaque` (world/cell.ts). */
  world: AssetManifest;
  ids: { tiles: readonly string[]; props: readonly string[]; tokens: readonly string[] };
  /** The tile ids that can be walked on. */
  walkableTiles: readonly string[];
  /** The prop ids that stop a foot (a closed door, a chest). */
  blockingProps: readonly string[];
  /** Display names by id. A missing id reads as the id with underscores as spaces. */
  names?: Readonly<Record<string, string>>;
}

export type CastDir = "down" | "right" | "up" | "left";
export type CastClipId = "idle" | "walk" | "attack" | "hit" | "death" | "interact" | "cheer";

export interface CastSizeMeta {
  tokenW: number;
  tokenH: number;
  canvasW: number;
  canvasH: number;
  anchorX: number;
  anchorY: number;
}

export interface CastClip {
  size: string;
  clip: CastClipId;
  dir: CastDir;
  count: number;
  loop: boolean;
  fps: number;
  /** Every frame's palette indices (255 transparent), concatenated, zlib, base64. */
  data: string;
  /** Walk clips only: how many tile steps one pass of the cycle spans (2 when absent). */
  stride?: number;
}

export interface CastCharacter {
  id: string;
  label: string;
  kind: "hero" | "monster" | "npc";
  archetype: string | null;
  model: string;
  standIn: boolean;
  notes: string;
  sizes: Record<string, CastSizeMeta>;
  clips: CastClip[];
}

export interface CastGear {
  id: string;
  archetype: string;
  /** The cast character this piece is worn by (its body is the holdout). */
  character?: string;
  role: string;
  tier: string;
  label: string;
  clips: CastClip[];
}

export interface CastStyle {
  style: string;
  label: string;
  description: string;
  characters: CastCharacter[];
  gear: CastGear[];
  /** Draw order of gear roles per facing, bottom first. */
  layerOrder: Record<CastDir, string[]>;
  /** The same per hero archetype; wins over layerOrder when present. */
  layerOrderByArchetype?: Record<string, Record<CastDir, string[]>>;
}

export interface CastData {
  palette: [number, number, number][];
  cameraPitchDeg: number;
  styles: CastStyle[];
}

export interface TableArt {
  /** The template's ids, walkability and sight flags. Bench: from the bench sprite arrays. Game: from the games-db manifest (names fall back to the id). */
  catalog(t: TemplateGenre): ArtCatalog;
  /** The paint-ready manifest (palette and pixels, spriteSize 16 or 32). Bench: the chosen art. Game: the loaded manifest's render half. */
  render(t: TemplateGenre): RenderManifest;
  /** The animated cast and the style in use, or null for static tokens. Bench: the embedded cast. Game: a lazy fetch, null until it lands. */
  cast(): { data: CastData; style: CastStyle } | null;
  /** Changes whenever what the board would draw changes (art choice, manifest version). The window repaints when it differs. */
  signature(): string;
  /** False while the art is still loading. The catalog is not cached until it is true. */
  ready(): boolean;
  /** Subscribe to "the art changed" (a library decoded, a cast prefetch landed). Returns the unsubscribe. */
  onChange(cb: () => void): () => void;
}

// ---- dm ---------------------------------------------------------------------

/** The DM's transport: one call that takes the prompt and returns the whole reply (dmCore's `SampleFn`). */
export interface SampleFn {
  (
    input: string | { role: "user" | "assistant"; content: string }[],
    opts?: {
      onText?: (u: { text: string; delta: string }) => void;
      signal?: AbortSignal;
      modelTier?: "quick" | "default" | "complex";
      cache?: boolean;
    },
  ): Promise<{ text: string; truncated?: boolean }>;
}

export interface TableDm {
  /** The sampler, or null when there is none to give (not allowed, not signed in). Bench: the test hook, else claude.use("sample"). Game: an adapter over bridge/ai.ts. */
  sample(): Promise<SampleFn | null>;
  /** What the player is told when `sample()` is null. Bench: "lives on claude.ai". Game: asks for the ai.complete permission. */
  unavailable: string;
  /** A line about what a DM turn costs, shown beside the ask. The game sets it; the bench has none. */
  costNote?: string;
  /**
   * A stand-in sampler that can be read at once, without waiting: when it answers, it is used before `sample()` on every ask.
   * Bench: the `__ltBenchSample` test hook, which a script may install at any time. Game: none.
   */
  peek?(): SampleFn | null;
  /** What the AI adventure writer tells the player when `sample()` is null. When absent, `unavailable` followed by "Nothing was sent." stands in. */
  writerUnavailable?: string;
}

// ---- storage ----------------------------------------------------------------

export interface TableStorage {
  /** The quick saves, one text per scope (a scope is the table's own save key). Both hosts use localStorage for now. */
  saves: { read(scope: string): string | null; write(scope: string, text: string): void };
  /** The adventures the player has written with the DM, as their Markdown texts. */
  aiAdventures: { read(): string[]; write(texts: string[]): void };
}

// ---- files ------------------------------------------------------------------

export interface TableFiles {
  /**
   * Hand the player a file (the adventure export). Bench: the downloads capability, then an object URL. Game: an object URL only.
   * What the window says about the result: `via: "capability"` is saved (`status: "delivered"` says it was sent), `declined` is the
   * player's own no. `via: "browser"` is a plain download offered (`status: "capability_failed"` when a capability existed and did not
   * go through). `status: "rate_limited"` (any `via`) is another save prompt still being open. `via: "none"` is nothing could be offered.
   */
  save(filename: string, bytes: Uint8Array): Promise<{ via: "capability" | "browser" | "none"; status?: string; declined?: boolean }>;
}

// ---- adventures -------------------------------------------------------------

export interface AdventureFile {
  /** The file name under adventures/. */
  file: string;
  /** The whole file, LF line endings. */
  text: string;
}

export interface TableAdventures {
  /** The written adventures shipped with the build. Both hosts: the generated data module. */
  files(): readonly AdventureFile[];
}

// ---- heroes -----------------------------------------------------------------

export interface TableHeroes {
  /** The archetypes a player can start as. Both hosts: the playable ones. */
  playable(): ArchetypeId[];
  /** The sheet to start with, or null for a fresh hero. Bench: null. Game: the loaded character. */
  initial(): CharacterSheet | null;
  /** Called whenever the hero's sheet changes. Bench: none. Game: write it back through the write queue. */
  onSheet?(s: CharacterSheet): void;
  /** Called when the creator makes a new hero, with the creator's own input (opaque here). */
  onCreated?(s: CharacterSheet, input: unknown): void;
}

// ---- settings ---------------------------------------------------------------

export type TextStyle = "pixel" | "storybook";
export type RoomChoice = "one" | "two";

export interface TableSettings {
  textStyle: TextStyle;
  /** True: the player throws their own dice. False: the tray rolls for them. */
  rollMyself: boolean;
  diceSkin: string;
  /** Board zoom 1 to 4, or null to let the window pick from the screen. */
  zoom: number | null;
}

export interface TableSettingsHost {
  get(): TableSettings;
  /** Merge a partial change in and keep it. */
  set(p: Partial<TableSettings>): void;
  /** The dice skins the player owns. */
  ownedDiceSkins(): string[];
}

// ---- env --------------------------------------------------------------------

export interface TableEnv {
  /** A number from 0 up to, not including, 1. Bench: its test hook, else Math.random. Game: Math.random. */
  rng(): number;
  reducedMotion: boolean;
  /** The page address (its hash), read for the sandbox rooms. Bench: location.hash. Game: "". */
  address(): string;
  /** Whether #sandbox in the address starts a sandbox room. Bench: true. Game: false. */
  sandboxRooms: boolean;
  /** Whether the export includes the debug exchange log. Bench: true. Game: false. */
  debugExport: boolean;
  build: { app: string; bench?: string };
}

// ---- the host ---------------------------------------------------------------

export interface TableHost {
  art: TableArt;
  dm: TableDm;
  storage: TableStorage;
  files: TableFiles;
  adventures: TableAdventures;
  heroes: TableHeroes;
  settings: TableSettingsHost;
  env: TableEnv;
}

// ---- the handle mountTable returns -------------------------------------------

/**
 * What a mounted window gives back. `Play` is the window's PlayState (state.ts);
 * it is a type parameter so this file needs no import of it, and defaults to
 * `unknown`. mountTable returns `TableHandle<PlayState>`.
 */
export interface TableHandle<Play = unknown> {
  /** Remove the window's listeners, timers, frame loop and DOM. Safe to call twice. */
  dispose(): void;
  /** The hooks the bench's play scripts read; the game never calls these. */
  debug(): { play(): Play; adventure: object; sight(): object; save(label: string): void };
  showStart(): void;
  reset(): void;
  /** Re-read the settings from the host and apply them (text style, dice, zoom). */
  applySettings(): void;
  pickHero(id: ArchetypeId): void;
  setRoom(r: RoomChoice): void;
}
