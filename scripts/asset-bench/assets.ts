/**
 * The Living Table asset bench registry.
 *
 * Every sprite in scripts/assets/fantasy.ts and scripts/assets/scifi.ts, laid
 * out as a searchable library, plus five panels that call the game's own
 * render/character functions BY SYMBOL (renderPlanFor, compositeToken via
 * renderCell, renderDoll, renderGearIcon, applyDisplayTiles) so the bench
 * shows what ships, not a second drawing of it.
 *
 * Built with scripts/asset-bench/build-bench.mjs from the project root:
 *
 *   node scripts/asset-bench/build-bench.mjs \
 *     --assets scripts/asset-bench/assets.ts \
 *     --out .cache/asset-bench/living-table-bench.html \
 *     --artifact
 *
 * or `npm run bench`.
 */
import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "../assets/fantasy";
import { PALETTE as SCIFI_PALETTE, SPRITES as SCIFI_SPRITES } from "../assets/scifi";

import {
  ACCESSORY_ROLES,
  ACCESSORY_SLOT_WORD,
  ARCHETYPE_IDS,
  BAG_CAPACITY,
  CONTAINER_PROP_ASSET_IDS,
  DOLL_CANVAS_SIZE,
  DOLL_MAX_SCALE,
  DOLL_MIN_SCALE,
  EQUIPMENT_TIERS,
  GEAR_ROLES,
  GLOW_PULSE_PERIOD_MS,
  LOOT_CAP_LINE,
  MAX_ATTUNED_ITEMS,
  SLOTS_BY_ARCHETYPE,
  TEMPLATE_OF_ARCHETYPE,
  bodySpriteId,
  emptySlotIconSource,
  gearIconSource,
  gearItemExists,
  gearItemName,
  SHEET_ONLY_ROLES,
  type AccessoryRole,
  type ArchetypeId,
  type Equipment,
  type EquipmentTier,
  type GearRole,
  type GlowFrame,
  type LoadoutDraft,
  type MagicTier,
  type SheetOnlyRole,
  type SlotRole,
} from "../../src/games/livingtable/characters/equipmentTypes";
import { PLAYABLE_ARCHETYPE_IDS, PLAYABLE_TEMPLATES, type TemplateGenre } from "../../src/games/livingtable/characters/templates";
import { createCharacter, type CharacterSheet } from "../../src/games/livingtable/characters/creation";
import { applyDamage } from "../../src/games/livingtable/characters/health";
import { renderPlanFor, slotLabelFor } from "../../src/games/livingtable/menu/equipment";
import { attackLine, bonusSources, lootLine, sentenceCase } from "../../src/games/livingtable/menu/labels";
import { attackBlockedReason } from "../../src/games/livingtable/menu/combatRound";
import { resolveAttack, resolveDamage } from "../../src/games/livingtable/rules/combat";
import { attunedRoles } from "../../src/games/livingtable/rules/attunement";
import { commitLoadout, draftFromSheet, stageEquip, stageUnequip } from "../../src/games/livingtable/rules/inventory";
import { lootFor } from "../../src/games/livingtable/rules/loot";
import {
  attackBonusSourcesFor,
  attackerBonusFor,
  damageMonster,
  effectiveArmorClass,
  monsterArmorClassFor,
  monsterDamageNotationFor,
  statblockFor,
  weaponDamageNotationFor,
  weaponFor,
} from "../../src/games/livingtable/session/combat";
import { renderDoll } from "../../src/games/livingtable/render/doll";
import { renderGearIcon } from "../../src/games/livingtable/render/gearIcon";
import { renderCell, spriteSizeOf, type RenderManifest } from "../../src/games/livingtable/render/canvasRenderer";
import {
  K_CLIPS,
  K_DIRS,
  clipDurationMs,
  decodeLibrary,
  dirToward,
  findClip,
  frameIndex,
  framesNow,
  kaykitData,
  kaykitLibrary,
  partFile,
  sizeIdsFor,
  type KClip,
  type KClipId,
  type KData,
  type KDir,
} from "./kaykit";
import { applyDisplayTiles } from "../../src/games/livingtable/render/terrainEdges";
import { CELL_WIDTH, CELL_HEIGHT } from "../../src/games/livingtable/world/coordinates";
import type { CellLayout, PlacedProp, PlacedToken, TileId } from "../../src/games/livingtable/world/cell";
import { visibleTilesFrom, type Playspace } from "../../src/games/livingtable/world/perception";
import { DEFAULT_MELEE_REACH_TILES, DEFAULT_RANGED_REACH_TILES, tileDistance } from "../../src/games/livingtable/world/reach";

// ===========================================================================
// Shared shape: a sprite from either template's flat SPRITES array.
// ===========================================================================

interface LtSprite {
  assetId: string;
  kind: "tile" | "token" | "prop";
  name: string;
  size: 16;
  walkable: boolean;
  pixels: number[][];
}

const TEMPLATES: readonly TemplateGenre[] = ["fantasy", "scifi"];
const TEMPLATE_LABEL: Record<TemplateGenre, string> = { fantasy: "Fantasy", scifi: "Sci-fi" };
const FLOOR_TILE: Record<TemplateGenre, string> = { fantasy: "floor_grass", scifi: "floor_deckplate" };
const SPRITES_BY_TEMPLATE: Record<TemplateGenre, readonly LtSprite[]> = {
  fantasy: FANTASY_SPRITES as unknown as LtSprite[],
  scifi: SCIFI_SPRITES as unknown as LtSprite[],
};
const PALETTE_BY_TEMPLATE: Record<TemplateGenre, readonly (readonly [number, number, number])[]> = {
  fantasy: FANTASY_PALETTE,
  scifi: SCIFI_PALETTE,
};

const ARCHETYPES_BY_TEMPLATE: Record<TemplateGenre, ArchetypeId[]> = { fantasy: [], scifi: [] };
for (const id of ARCHETYPE_IDS) ARCHETYPES_BY_TEMPLATE[TEMPLATE_OF_ARCHETYPE[id]].push(id);

const ARCHETYPE_LABEL: Record<ArchetypeId, string> = {
  knight: "Knight",
  shadow: "Shadow",
  healer: "Healer",
  "fireball-person": "Fireball Person",
  trooper: "Trooper",
  infiltrator: "Infiltrator",
  medic: "Medic",
  psion: "Psion",
};

// ===========================================================================
// The library: every sprite from both templates, prefixed "<template>:" so
// the two id spaces can never collide.
// ===========================================================================

function groupFor(template: TemplateGenre, s: LtSprite): string {
  const t = TEMPLATE_LABEL[template];
  if (s.kind === "tile") return `${t} tiles`;
  if (s.kind === "prop") return `${t} props`;
  // kind === "token": archetype bodies/NPCs, or one of the equipment overlay
  // families. Sorted by the sprite id grammar in equipmentTypes.ts section 3.
  if (s.assetId.startsWith("gear_")) {
    if (/_(weapon|outer|crown)_(base|rare|legendary)$/.test(s.assetId)) return `${t} gear overlays`;
    if (/_boots_(base|rare)$/.test(s.assetId)) return `${t} boots`;
    if (/_(ring|amulet)_(base|rare|legendary)$/.test(s.assetId)) return `${t} ring & amulet icons`;
    if (/_empty$/.test(s.assetId)) return `${t} slot silhouettes`;
  }
  return `${t} tokens`;
}

interface BenchPixelAsset {
  id: string;
  label: string;
  group: string;
  tags: string[];
  w: number;
  h: number;
  meta: Record<string, unknown>;
  palette: TemplateGenre;
  pixels: number[][];
}

function benchAssetsFor(template: TemplateGenre): BenchPixelAsset[] {
  return SPRITES_BY_TEMPLATE[template].map((s) => {
    const w = s.pixels[0]?.length ?? s.size;
    const h = s.pixels.length;
    return {
      id: `${template}:${s.assetId}`,
      label: s.name,
      group: groupFor(template, s),
      tags: [template, s.kind, s.walkable ? "walkable" : "blocked"],
      w,
      h,
      meta: { assetId: s.assetId, kind: s.kind, walkable: s.walkable, size: s.size, width: w, height: h },
      palette: template,
      pixels: s.pixels,
    };
  });
}

const assets: BenchPixelAsset[] = [...benchAssetsFor("fantasy"), ...benchAssetsFor("scifi")];

// ===========================================================================
// The raw RenderManifest per template: unprefixed ids, exactly the shape
// manifestCache.ts hands the renderer, built straight off each template's own
// SPRITES + PALETTE with no reimplementation. This is what every panel below
// hands to the game's own render functions.
// ===========================================================================

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

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

const MANIFEST: Record<TemplateGenre, RenderManifest> = { fantasy: manifestFor("fantasy"), scifi: manifestFor("scifi") };

// ===========================================================================
// Art source, shared by every panel: the game's current hand-drawn library,
// or the KayKit conversion (scripts/kaykit/lib_*.py, one part per maker,
// size and style). The conversion keeps every asset id, so the game's own
// renderer draws it unchanged; at 32 px the manifest says spriteSize 32 and
// the renderer scales to match. An id no part covers falls back to the
// current art (2x upscaled at 32 px), and the Converted panel says which.
// ===========================================================================

type GroundStyle = "painted" | "lit";
type CharStyle = "bands" | "pixelart" | "toon" | "plain";
interface ArtChoice {
  source: "current" | "kaykit";
  ground: GroundStyle;
  chars: CharStyle;
  size: 16 | 32;
}

const art: ArtChoice = { source: "current", ground: "painted", chars: "bands", size: 32 };
let artDecoded: Map<string, Map<string, number[][]>> | null = null;
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
  if (!artDecoded) return [];
  return [partFile(`ground-${art.ground}`, art.size), partFile("props", art.size), partFile("tokens", art.size, art.chars)]
    .map((f) => artDecoded!.get(f))
    .filter((m): m is Map<string, number[][]> => m !== undefined);
}

/** The chosen KayKit parts (ground style, character style, size) hold this sprite, whichever art is on show. */
function kaykitHas(assetId: string): boolean {
  return artParts().some((p) => p.has(assetId));
}

/** The sprite the chosen KayKit parts draw for this id, or null. */
function kaykitPixels(assetId: string): number[][] | null {
  for (const p of artParts()) {
    const px = p.get(assetId);
    if (px) return px;
  }
  return null;
}

/** The RenderManifest a panel should draw `template` with: the KayKit library for fantasy when chosen (and decoded), else the current art. */
function artManifest(template: TemplateGenre): RenderManifest {
  if (template !== "fantasy" || art.source === "current" || !artDecoded) return MANIFEST[template];
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
function artSpriteSize(template: TemplateGenre): number {
  return spriteSizeOf(artManifest(template));
}

/**
 * The shared Art row: Current or KayKit, and for KayKit the ground style,
 * the character style and the detail. One state for every panel, so a choice
 * made on one tab holds on the next. The first switch to KayKit decodes the
 * library (once) before redrawing.
 */
function buildArtControls(onChange: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "bn-controls lt-art-controls";
  const lib = kaykitLibrary();
  const status = document.createElement("span");
  status.className = "lt-note lt-art-status";
  const pick = (label: string, options: [string, string][], value: string, set: (v: string) => void): HTMLLabelElement => {
    const field = document.createElement("label");
    field.className = "bn-field";
    field.textContent = `${label} `;
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
  );
  extras.push(
    pick("Ground", [["painted", "Painted"], ["lit", "Lit"]], art.ground, (v) => (art.ground = v as GroundStyle)),
    pick("Characters", [["bands", "Cel bands"], ["pixelart", "Pixel artist"], ["toon", "Toon"], ["plain", "Plain"]], art.chars, (v) => (art.chars = v as CharStyle)),
    pick("Detail", [["32", "32 px"], ["16", "16 px (the game's size)"]], String(art.size), (v) => (art.size = Number(v) as 16 | 32)),
  );
  row.append(sourceField, ...extras, status);
  const sync = () => {
    for (const e of extras) e.hidden = art.source !== "kaykit";
    status.textContent =
      art.source === "kaykit" ? "KayKit packs by Kay Lousberg (CC0), rendered in Blender. Fantasy only; sci-fi is paused." : lib ? "" : "No converted library in this build.";
  };
  async function apply(): Promise<void> {
    sync();
    if (art.source === "kaykit" && !artDecoded) {
      status.textContent = "Loading the KayKit art...";
      artDecoded = await decodeLibrary();
      sync();
    }
    onChange();
  }
  sync();
  if (art.source === "kaykit" && !artDecoded) void apply();
  return row;
}

// A memoised base CharacterSheet per archetype (createCharacter is pure but
// not free; the pulse timer redraws every ~600ms and has no reason to
// recompute ability scores and spell slots every frame).
const BASE_SHEET = new Map<ArchetypeId, CharacterSheet>();
function baseSheetFor(archetypeId: ArchetypeId): CharacterSheet {
  let sheet = BASE_SHEET.get(archetypeId);
  if (!sheet) {
    sheet = createCharacter({
      archetypeId,
      name: "Bench Preview",
      appearanceAssetId: bodySpriteId(archetypeId),
    });
    BASE_SHEET.set(archetypeId, sheet);
  }
  return sheet;
}

/** Build a real CharacterSheet (via createCharacter, the game's own factory) with the given per-role tiers swapped in as `equipment`, exactly the shape a stored sheet has. */
function sheetWithEquipment(archetypeId: ArchetypeId, equipment: Equipment): CharacterSheet {
  return { ...baseSheetFor(archetypeId), equipment };
}

const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ===========================================================================
// Shared equipment-tier controls: six roles, each offering only the tiers
// gearItemExists() actually reports for that archetype/role, so the UI can
// never propose a tier the game itself would refuse to draw.
// ===========================================================================

const DRAWN_ROLES: GearRole[] = ["weapon", "outer", "crown", "boots"];
const SHEET_ONLY: GearRole[] = ["ring", "amulet"];

function tiersFor(archetypeId: ArchetypeId, role: GearRole): EquipmentTier[] {
  return EQUIPMENT_TIERS.filter((tier) => gearItemExists(archetypeId, role, tier));
}

function equipmentFrom(picked: Partial<Record<GearRole, EquipmentTier | "empty">>): Equipment {
  const eq: Equipment = {};
  for (const role of GEAR_ROLES) {
    const v = picked[role];
    if (!v || v === "empty") continue;
    eq[role] = { slot: role, tier: v };
  }
  return eq;
}

function isAccessoryRole(role: GearRole): role is AccessoryRole {
  return (ACCESSORY_ROLES as readonly GearRole[]).includes(role);
}

function isSheetOnlyRole(role: GearRole): role is SheetOnlyRole {
  return (SHEET_ONLY_ROLES as readonly GearRole[]).includes(role);
}

/**
 * What a gear role is called on THIS archetype, in the inventory screen's own
 * words. The role keys are storage keys in saved sheets, not names: a
 * Knight's `outer` is its Kite Shield and its `crown` is its Plate Harness,
 * which is why "Outer" and "Crown" read as nonsense on a label. `slot` comes
 * off slotLabelFor for the three drawn slots (inventoryView.ts's slotWordFor
 * does the same) and ACCESSORY_SLOT_WORD for the rest; `own` is the piece the
 * archetype starts in, null for ring and amulet, which start empty.
 */
function slotNaming(archetypeId: ArchetypeId, role: GearRole): { slot: string; own: string | null } {
  const slot = isAccessoryRole(role)
    ? ACCESSORY_SLOT_WORD[TEMPLATE_OF_ARCHETYPE[archetypeId]][role]
    : slotLabelFor(SLOTS_BY_ARCHETYPE[archetypeId][role as SlotRole]);
  return { slot, own: gearItemName(archetypeId, role, "common") };
}

/** "Armour: Plate Harness", "Ring": the slot and the piece it starts with, for a control label. */
function slotTitle(archetypeId: ArchetypeId, role: GearRole): string {
  const { slot, own } = slotNaming(archetypeId, role);
  return own ? `${slot}: ${own}` : slot;
}

/** One <label><select> pair per gear role, wired to call onChange(role, tier) whenever any of them changes. Returns the container element. */
function buildTierControls(
  archetypeId: ArchetypeId,
  picked: Partial<Record<GearRole, EquipmentTier | "empty">>,
  onChange: () => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "lt-tier-grid";
  for (const role of GEAR_ROLES) {
    const valid = tiersFor(archetypeId, role);
    const field = document.createElement("label");
    field.className = "bn-field";
    field.textContent = slotTitle(archetypeId, role) + " ";
    const select = document.createElement("select");
    select.className = "bn-select";
    if (SHEET_ONLY.includes(role)) {
      const empty = document.createElement("option");
      empty.value = "empty";
      empty.textContent = "(empty)";
      select.appendChild(empty);
    }
    for (const tier of valid) {
      const opt = document.createElement("option");
      opt.value = tier;
      opt.textContent = tier;
      select.appendChild(opt);
    }
    const fallback = SHEET_ONLY.includes(role) ? "empty" : valid[0] ?? "common";
    const current = picked[role] && (valid.includes(picked[role] as EquipmentTier) || picked[role] === "empty") ? picked[role]! : fallback;
    picked[role] = current;
    select.value = current;
    select.onchange = () => {
      picked[role] = select.value as EquipmentTier | "empty";
      onChange();
    };
    field.appendChild(select);
    wrap.appendChild(field);
  }
  return wrap;
}

function buildArchetypeSelect(template: TemplateGenre, onChange: (id: ArchetypeId) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "bn-select";
  for (const id of ARCHETYPES_BY_TEMPLATE[template]) {
    const opt = document.createElement("option");
    opt.value = id;
    // Out-of-play archetypes stay on the bench (their art and rules still exist), marked as such.
    opt.textContent = PLAYABLE_ARCHETYPE_IDS.includes(id) ? ARCHETYPE_LABEL[id] : `${ARCHETYPE_LABEL[id]} (not playable)`;
    select.appendChild(opt);
  }
  select.onchange = () => onChange(select.value as ArchetypeId);
  return select;
}

function buildTemplateSelect(onChange: (t: TemplateGenre) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "bn-select";
  for (const t of TEMPLATES) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = PLAYABLE_TEMPLATES.includes(t) ? TEMPLATE_LABEL[t] : `${TEMPLATE_LABEL[t]} (paused)`;
    select.appendChild(opt);
  }
  select.onchange = () => onChange(select.value as TemplateGenre);
  return select;
}

function buildScaleSelect(options: readonly number[], initial: number, onChange: (n: number) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "bn-select";
  for (const n of options) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n}x`;
    if (n === initial) opt.selected = true;
    select.appendChild(opt);
  }
  select.onchange = () => onChange(Number(select.value));
  return select;
}

function floorOptionsFor(template: TemplateGenre): string[] {
  return SPRITES_BY_TEMPLATE[template]
    .filter((s) => s.kind === "tile" && s.walkable && !/_edge_|_pale/.test(s.assetId))
    .map((s) => s.assetId)
    .slice(0, 8);
}

// ===========================================================================
// Panel: Character. A two-room scene to walk around in, with the game's own
// rules behind every button.
//
// The game's own code, called by symbol:
//   drawing   renderCell + renderPlanFor (the hero composited with whatever
//             is worn), renderGearIcon (slot and item icons)
//   gear      stageEquip / stageUnequip / commitLoadout, the inventory
//             screen's own staging rules, attunement cap included
//   attack    attackBlockedReason (reach, and line of sight through
//             visibleTilesFrom), resolveAttack, resolveDamage, damageMonster,
//             applyDamage, every dice line printed by attackLine
//   loot      lootFor + lootLine, on a kill and on opening the container
//
// The bench's own, and deliberately simple: the room, one tile per press, and
// the monster's turn (it wakes once it can reach you within
// MONSTER_WAKE_TILES steps, then steps toward you and attacks from adjacent).
// The game runs all of this inside an initiative round; here every press is
// one turn. Opening the container always succeeds; in the game it is a search
// check.
// ===========================================================================

interface XY {
  x: number;
  y: number;
}

type Dir = "up" | "down" | "left" | "right";
const DIR_STEP: Record<Dir, XY> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

interface SceneKit {
  wall: TileId;
  doorClosed: TileId;
  doorOpen: TileId;
  doorLabel: string;
  container: TileId;
  /** The opened sprite, when the template has one. The sci-fi crate has none, so it keeps its look and only the log says it was searched. */
  containerOpened: TileId | null;
  containerLabel: string;
  monster: TileId;
}

const SCENE_KIT: Record<TemplateGenre, SceneKit> = {
  fantasy: {
    wall: "wall_stone",
    doorClosed: "door_closed",
    doorOpen: "door_open",
    doorLabel: "the door",
    container: CONTAINER_PROP_ASSET_IDS.fantasy[0]!,
    containerOpened: "chest_open",
    containerLabel: "the chest",
    monster: "token_goblin",
  },
  scifi: {
    wall: "wall_bulkhead",
    doorClosed: "door_airlock_closed",
    doorOpen: "door_airlock_open",
    doorLabel: "the airlock",
    container: CONTAINER_PROP_ASSET_IDS.scifi[0]!,
    containerOpened: null,
    containerLabel: "the crate",
    monster: "token_raider",
  },
};

// An outer wall and a dividing wall at DIVIDER_X with one door in it. The
// hero starts in the west room; the container and the monster are east.
const DIVIDER_X = 11;
const DOOR_AT: XY = { x: DIVIDER_X, y: 7 };
const CONTAINER_AT: XY = { x: 16, y: 3 };
const MONSTER_START: XY = { x: 16, y: 10 };
const HERO_START: XY = { x: 4, y: 7 };
const MONSTER_WAKE_TILES = 6;
const HERO_ID = "hero";
const MONSTER_ID = "monster";
const LOG_KEEP = 60;
// Indoor floors for a walled room; the Floor control still offers the rest.
const ROOM_FLOOR: Record<TemplateGenre, TileId> = { fantasy: "floor_stone", scifi: "floor_deckplate" };
const DOWN_NOTE = "You are down. Press Reset scene to get back up.";

/** Every sprite's own `walkable` flag, the same one manifestCache.ts turns into the engine's tile walkability and prop `blocks`. */
const WALKABLE_BY_ID: Record<TemplateGenre, Map<string, boolean>> = {
  fantasy: new Map(SPRITES_BY_TEMPLATE.fantasy.map((s) => [s.assetId, s.walkable])),
  scifi: new Map(SPRITES_BY_TEMPLATE.scifi.map((s) => [s.assetId, s.walkable])),
};

interface LogLine {
  text: string;
  /** good: went your way. bad: went against you. plain: neither. */
  tone: "good" | "bad" | "plain";
}

interface PlayState {
  template: TemplateGenre;
  archetypeId: ArchetypeId;
  floorId: TileId;
  hero: CharacterSheet;
  heroAt: XY;
  monster: { at: XY; hp: number; awake: boolean } | null;
  doorOpen: boolean;
  searched: boolean;
  log: LogLine[];
  /** Why the last press did nothing, in words. Cleared by the next press that does something. */
  note: string | null;
  /** Set when the hero is the KayKit Knight: the rules are the Knight's, the picture is a Blender render. */
  kaykit: KayKitHero | null;
}

/**
 * The KayKit hero's picture state. Which render set, how much detail, which
 * weapons; and what it is doing: the clip playing, since when, what plays next,
 * and a short walk between tiles so a step reads as a step.
 */
interface KayKitHero {
  style: string;
  size: string;
  loadout: string;
  dir: KDir;
  clip: KClipId;
  clipStart: number;
  queue: KClipId[];
  tween: { from: XY; start: number } | null;
}

const KAYKIT_ARCHETYPE = "kaykit-knight";
const STEP_MS = 280;

function newKayKitHero(d: KData, prev?: KayKitHero | null): KayKitHero {
  const loadout = prev?.loadout ?? d.loadouts[0]!.id;
  const sizes = sizeIdsFor(d, loadout);
  return {
    style: prev?.style ?? d.styles[0]!.style,
    size: prev && sizes.includes(prev.size) ? prev.size : sizes.includes("32x48") ? "32x48" : sizes[0]!,
    loadout,
    dir: "down",
    clip: "idle",
    clipStart: performance.now(),
    queue: [],
    tween: null,
  };
}

function freshHero(archetypeId: ArchetypeId): CharacterSheet {
  return createCharacter({ archetypeId, name: ARCHETYPE_LABEL[archetypeId], appearanceAssetId: bodySpriteId(archetypeId) });
}

/** A new scene. `keepGearOf` carries worn gear and the pack over (Reset scene), while hit points, the loot ledger, the door, the container and the monster all start again. */
function newPlay(
  template: TemplateGenre,
  archetypeId: ArchetypeId,
  floorId: TileId,
  keepGearOf?: CharacterSheet,
  kaykit: KayKitHero | null = null,
): PlayState {
  const fresh = freshHero(archetypeId);
  const hero = keepGearOf ? { ...fresh, equipment: keepGearOf.equipment, bag: keepGearOf.bag } : fresh;
  return {
    kaykit,
    template,
    archetypeId,
    floorId,
    hero,
    heroAt: { ...HERO_START },
    monster: { at: { ...MONSTER_START }, hp: statblockFor(SCENE_KIT[template].monster).maxHp, awake: false },
    doorOpen: false,
    searched: false,
    log: [],
    note: null,
  };
}

// Module level, so leaving the tab and coming back finds the fight where it was.
let play: PlayState | null = null;

const same = (a: XY, b: XY): boolean => a.x === b.x && a.y === b.y;

function sentence(text: string): string {
  const s = sentenceCase(text.trim());
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function monsterLabel(p: PlayState): string {
  return `the ${statblockFor(SCENE_KIT[p.template].monster).name.toLowerCase()}`;
}

function heroDown(p: PlayState): boolean {
  return p.hero.downed || p.hero.stable || p.hero.dead;
}

function sceneTiles(p: PlayState): TileId[][] {
  const wall = SCENE_KIT[p.template].wall;
  return Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) => {
      const edge = x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1;
      const divider = x === DIVIDER_X && y !== DOOR_AT.y;
      return edge || divider ? wall : p.floorId;
    }),
  );
}

function sceneProps(p: PlayState): PlacedProp[] {
  const kit = SCENE_KIT[p.template];
  return [
    { id: "door", assetId: p.doorOpen ? kit.doorOpen : kit.doorClosed, x: DOOR_AT.x, y: DOOR_AT.y, label: kit.doorLabel },
    {
      id: "container",
      assetId: p.searched && kit.containerOpened ? kit.containerOpened : kit.container,
      x: CONTAINER_AT.x,
      y: CONTAINER_AT.y,
      label: kit.containerLabel,
    },
  ];
}

function sceneLayout(p: PlayState): CellLayout {
  // A KayKit hero is drawn over the scene by the panel itself (it animates);
  // every other hero is a token the game's own renderCell composites.
  const tokens: PlacedToken[] = p.kaykit ? [] : [{ id: HERO_ID, assetId: bodySpriteId(p.archetypeId), x: p.heroAt.x, y: p.heroAt.y, kind: "pc" }];
  if (p.monster) {
    tokens.push({ id: MONSTER_ID, assetId: SCENE_KIT[p.template].monster, x: p.monster.at.x, y: p.monster.at.y, kind: "monster", currentHp: p.monster.hp });
  }
  return { tiles: sceneTiles(p), props: sceneProps(p), tokens, exits: [], sealed: true };
}

/** What stops anyone standing on `at`: the room's edge, a wall tile, or a prop whose sprite is not walkable (a closed door, the container). Tokens are checked by the caller. */
function terrainBlocks(p: PlayState, tiles: TileId[][], at: XY): "edge" | "wall" | "door" | "container" | null {
  if (at.x < 0 || at.y < 0 || at.x >= CELL_WIDTH || at.y >= CELL_HEIGHT) return "edge";
  const walkable = WALKABLE_BY_ID[p.template];
  if (walkable.get(tiles[at.y]![at.x]!) !== true) return "wall";
  for (const prop of sceneProps(p)) {
    if (same(prop, at) && walkable.get(prop.assetId) === false) return prop.id === "door" ? "door" : "container";
  }
  return null;
}

/**
 * The first step of a shortest path from `from` to any tile next to `to`, and
 * how many steps that path takes, or null when there is no way through (a
 * closed door, say). Eight-way steps, the same Chebyshev distance
 * world/reach.ts measures reach in.
 */
function pathToward(p: PlayState, tiles: TileId[][], from: XY, to: XY): { steps: number; next: XY } | null {
  if (tileDistance(from, to) <= DEFAULT_MELEE_REACH_TILES) return { steps: 0, next: from };
  const key = (c: XY) => c.y * CELL_WIDTH + c.x;
  const prev = new Map<number, number>([[key(from), -1]]);
  const queue: XY[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nxt = { x: cur.x + dx, y: cur.y + dy };
        if (terrainBlocks(p, tiles, nxt) || same(nxt, to) || prev.has(key(nxt))) continue;
        prev.set(key(nxt), key(cur));
        if (tileDistance(nxt, to) <= DEFAULT_MELEE_REACH_TILES) {
          let k = key(nxt);
          let steps = 1;
          while (prev.get(k) !== key(from)) {
            k = prev.get(k)!;
            steps++;
          }
          return { steps, next: { x: k % CELL_WIDTH, y: Math.floor(k / CELL_WIDTH) } };
        }
        queue.push(nxt);
      }
    }
  }
  return null;
}

/** Line of sight exactly as the game computes it: a Playspace whose `walkable` comes off the tiles alone (world/perception.ts's getPlayspace), walked by visibleTilesFrom. */
function canSee(p: PlayState, tiles: TileId[][], from: XY, to: XY): boolean {
  const walkable = WALKABLE_BY_ID[p.template];
  const space: Playspace = {
    cell: { cx: 0, cy: 0 },
    tiles,
    walkable: tiles.map((row) => row.map((id) => walkable.get(id) === true)),
    props: sceneProps(p),
    tokens: [{ id: "viewer", assetId: bodySpriteId(p.archetypeId), x: from.x, y: from.y, kind: "pc" }],
    exits: [],
  };
  return visibleTilesFrom(space, "viewer").some((c) => same(c, to));
}

function rollLoot(p: PlayState, source: "fight" | "container"): void {
  const { sheet, roll } = lootFor(p.hero, { source, cx: 0, cy: 0 });
  p.hero = sheet;
  if (!roll) {
    p.log.push({ text: LOOT_CAP_LINE, tone: "plain" });
    return;
  }
  const name = roll.item ? gearItemName(p.archetypeId, roll.item.slot, roll.item.tier) : null;
  p.log.push({ text: lootLine(roll, name), tone: roll.item ? "good" : "plain" });
}

/** The monster's whole turn: wake, close in, and attack from adjacent. */
function monsterTurn(p: PlayState): void {
  const m = p.monster;
  if (!m || heroDown(p)) return;
  const kit = SCENE_KIT[p.template];
  const tiles = sceneTiles(p);
  const label = monsterLabel(p);
  const path = pathToward(p, tiles, m.at, p.heroAt);
  if (!m.awake) {
    if (!path || path.steps > MONSTER_WAKE_TILES) return;
    m.awake = true;
    p.log.push({ text: `${sentenceCase(label)} sees you.`, tone: "bad" });
  }
  if (tileDistance(m.at, p.heroAt) > DEFAULT_MELEE_REACH_TILES) {
    if (!path) return; // no way through; it waits
    m.at = path.next;
    if (tileDistance(m.at, p.heroAt) > DEFAULT_MELEE_REACH_TILES) {
      p.log.push({ text: `${sentenceCase(label)} closes in.`, tone: "plain" });
      return;
    }
  }
  const block = statblockFor(kit.monster);
  const playerAC = effectiveArmorClass(p.hero);
  const result = resolveAttack({ attackerBonus: block.attackBonus, targetAC: playerAC });
  let damage: number | undefined;
  let vitalsNote: string | null = null;
  if (result.hit) {
    const rolled = resolveDamage(monsterDamageNotationFor(kit.monster), Math.random, result.critical);
    damage = rolled.total;
    const outcome = applyDamage(p.hero, rolled.total, result.critical);
    p.hero = outcome.sheet;
    vitalsNote = outcome.note;
  }
  p.log.push({
    text: attackLine({
      attacker: label,
      target: p.hero.name,
      roll: result.roll,
      modifier: block.attackBonus,
      total: result.total,
      targetAC: playerAC,
      hit: result.hit,
      critical: result.critical,
      fumble: result.fumble,
      damage,
    }),
    tone: result.hit ? "bad" : "good",
  });
  if (vitalsNote) p.log.push({ text: vitalsNote, tone: "bad" });
}

function heroMove(p: PlayState, dir: Dir): void {
  if (heroDown(p)) {
    p.note = DOWN_NOTE;
    return;
  }
  const kit = SCENE_KIT[p.template];
  const to = { x: p.heroAt.x + DIR_STEP[dir].x, y: p.heroAt.y + DIR_STEP[dir].y };
  const blocked = terrainBlocks(p, sceneTiles(p), to);
  if (blocked === "door") {
    p.note = `${sentenceCase(kit.doorLabel)} is closed. Stand next to it and press Interact.`;
    return;
  }
  if (blocked === "container") {
    p.note = `${sentenceCase(kit.containerLabel)} is in the way. Stand next to it and press Interact to open it.`;
    return;
  }
  if (blocked) {
    p.note = "A wall. You cannot walk through it.";
    return;
  }
  if (p.monster && same(p.monster.at, to)) {
    p.note = `${sentenceCase(monsterLabel(p))} is in the way. Press Attack.`;
    return;
  }
  p.heroAt = to;
  p.note = null;
  monsterTurn(p);
}

function heroAttack(p: PlayState): void {
  if (heroDown(p)) {
    p.note = DOWN_NOTE;
    return;
  }
  const m = p.monster;
  if (!m) {
    p.note = "Nothing left to fight. Press Reset scene to bring it back.";
    return;
  }
  const kit = SCENE_KIT[p.template];
  const tiles = sceneTiles(p);
  const reachTiles = weaponFor(p.hero).ranged ? DEFAULT_RANGED_REACH_TILES : DEFAULT_MELEE_REACH_TILES;
  const blocked = attackBlockedReason({
    round: null,
    attackerAt: p.heroAt,
    targetAt: m.at,
    downed: false,
    reachTiles,
    hasLineOfSight: canSee(p, tiles, p.heroAt, m.at),
  });
  if (blocked) {
    p.note = blocked;
    return;
  }
  p.note = null;
  const label = monsterLabel(p);
  const bonus = attackerBonusFor(p.hero);
  const targetAC = monsterArmorClassFor(kit.monster);
  const result = resolveAttack({ attackerBonus: bonus, targetAC });
  let damage: number | undefined;
  let down = false;
  if (result.hit) {
    damage = resolveDamage(weaponDamageNotationFor(p.hero), Math.random, result.critical).total;
    const hurt = damageMonster({ assetId: kit.monster, currentHp: m.hp }, damage);
    m.hp = hurt.currentHp;
    down = hurt.down;
  }
  p.log.push({
    text: attackLine({
      attacker: p.hero.name,
      target: label,
      roll: result.roll,
      modifier: bonus,
      total: result.total,
      targetAC,
      hit: result.hit,
      critical: result.critical,
      fumble: result.fumble,
      damage,
      targetDown: down,
      targetHpLeft: result.hit && !down ? m.hp : undefined,
      sources: bonusSources(attackBonusSourcesFor(p.hero), bonus),
    }),
    tone: result.hit ? "good" : "bad",
  });
  if (down) {
    p.monster = null;
    rollLoot(p, "fight");
    return;
  }
  m.awake = true;
  monsterTurn(p);
}

function heroInteract(p: PlayState): void {
  if (heroDown(p)) {
    p.note = DOWN_NOTE;
    return;
  }
  const kit = SCENE_KIT[p.template];
  const near = (at: XY) => tileDistance(p.heroAt, at) <= 1;
  if (near(DOOR_AT)) {
    if (!p.doorOpen) {
      p.doorOpen = true;
      p.log.push({ text: `You open ${kit.doorLabel}.`, tone: "plain" });
    } else if (same(p.heroAt, DOOR_AT)) {
      p.note = "You are standing in the doorway. Step out of it first.";
      return;
    } else if (p.monster && same(p.monster.at, DOOR_AT)) {
      p.note = `${sentenceCase(monsterLabel(p))} is standing in the doorway.`;
      return;
    } else {
      p.doorOpen = false;
      p.log.push({ text: `You close ${kit.doorLabel}.`, tone: "plain" });
    }
  } else if (near(CONTAINER_AT)) {
    if (p.searched) {
      p.note = `You already emptied ${kit.containerLabel}.`;
      return;
    }
    p.searched = true;
    p.log.push({ text: `You open ${kit.containerLabel}.`, tone: "plain" });
    rollLoot(p, "container");
  } else {
    p.note = `Nothing to use here. Stand next to ${kit.doorLabel} or ${kit.containerLabel} and press Interact.`;
    return;
  }
  p.note = null;
  monsterTurn(p);
}

// ---------------------------------------------------------------------------
// Gear: every change goes through the inventory screen's own staging rules.
// ---------------------------------------------------------------------------

type GearOutcome = { ok: true } | { ok: false; reason: string };

function wornTier(p: PlayState, role: GearRole): EquipmentTier | null {
  return p.hero.equipment?.[role]?.tier ?? null;
}

function itemName(archetypeId: ArchetypeId, role: GearRole, tier: EquipmentTier): string {
  return gearItemName(archetypeId, role, tier) ?? `${slotNaming(archetypeId, role).slot} (${tier})`;
}

function commitDraft(p: PlayState, draft: LoadoutDraft): GearOutcome {
  const next = commitLoadout(p.hero, draft);
  // commitLoadout hands back the same sheet when it refuses a draft.
  if (next === p.hero) return { ok: false, reason: "The game refused that loadout." };
  p.hero = next;
  return { ok: true };
}

function equipFromPack(p: PlayState, index: number): GearOutcome {
  const item = p.hero.bag?.[index];
  if (!item) return { ok: false, reason: "That pack space is empty." };
  const staged = stageEquip(p.archetypeId, draftFromSheet(p.hero), index);
  if (!staged.ok) return { ok: false, reason: sentence(staged.reason) };
  const done = commitDraft(p, staged.draft);
  if (done.ok) p.log.push({ text: `Equipped: ${itemName(p.archetypeId, item.slot, item.tier)}.`, tone: "plain" });
  return done;
}

function takeOff(p: PlayState, role: GearRole): GearOutcome {
  const worn = wornTier(p, role);
  const { slot } = slotNaming(p.archetypeId, role);
  if (!worn) return { ok: false, reason: `The ${slot} slot is already empty.` };
  if (worn === "common") return { ok: false, reason: `Your own ${itemName(p.archetypeId, role, worn)} stays on when nothing better is worn.` };
  const staged = stageUnequip(p.archetypeId, draftFromSheet(p.hero), role);
  if (!staged.ok) return { ok: false, reason: sentence(staged.reason) };
  const done = commitDraft(p, staged.draft);
  if (done.ok) p.log.push({ text: `Took off: ${itemName(p.archetypeId, role, worn)}. It is in your pack.`, tone: "plain" });
  return done;
}

/**
 * The armoury hands an item over as if it had just been found: onto the end
 * of the pack (where lootFor puts a find), then equipped from there through
 * the same stageEquip the pack uses. A refusal (the attunement cap, say)
 * takes it back out of the pack, so trying something on leaves no trace.
 */
function equipFromArmoury(p: PlayState, role: GearRole, tier: EquipmentTier): GearOutcome {
  const name = itemName(p.archetypeId, role, tier);
  if (wornTier(p, role) === tier) return { ok: false, reason: `Already wearing the ${name}.` };
  if (tier === "common") return takeOff(p, role);
  const bag = p.hero.bag ?? [];
  const inPack = bag.findIndex((b) => b.slot === role && b.tier === tier);
  if (inPack >= 0) return equipFromPack(p, inPack);
  if (bag.length >= BAG_CAPACITY) return { ok: false, reason: "Your pack is full." };
  const before = p.hero;
  p.hero = { ...p.hero, bag: [...bag, { slot: role, tier: tier as MagicTier }] };
  const done = equipFromPack(p, bag.length);
  if (!done.ok) p.hero = before;
  return done;
}

// ---------------------------------------------------------------------------
// Dragging an item onto a slot. Pointer events rather than HTML5 drag and
// drop, because a phone never fires the latter; a tap does the same thing.
// ---------------------------------------------------------------------------

type DragPayload =
  | { from: "armoury"; role: GearRole; tier: EquipmentTier }
  | { from: "pack"; role: GearRole; index: number }
  | { from: "slot"; role: GearRole };

let dragJustEnded = false;

function makeDraggable(node: HTMLElement, payload: DragPayload, icon: HTMLCanvasElement, onDrop: (payload: DragPayload, target: HTMLElement | null) => void): void {
  node.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    let ghost: HTMLCanvasElement | null = null;
    let hover: HTMLElement | null = null;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("#bench-root [data-drop]"));
    const fits = (t: HTMLElement) => (t.dataset.drop === "slot" ? payload.from !== "slot" && t.dataset.role === payload.role : payload.from === "slot");
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < 6) return;
        ghost = document.createElement("canvas");
        ghost.width = icon.width;
        ghost.height = icon.height;
        ghost.getContext("2d")!.drawImage(icon, 0, 0);
        ghost.style.cssText =
          "position:fixed;z-index:9999;pointer-events:none;width:56px;height:56px;image-rendering:pixelated;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.35);opacity:.92";
        document.body.appendChild(ghost);
        for (const t of targets) t.classList.add(fits(t) ? "lt-drop-ok" : "lt-drop-dim");
      }
      ghost.style.left = `${ev.clientX - 28}px`;
      ghost.style.top = `${ev.clientY - 28}px`;
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop]") ?? null;
      if (over !== hover) {
        hover?.classList.remove("lt-drop-over");
        hover = over && fits(over) ? over : null;
        hover?.classList.add("lt-drop-over");
      }
    };
    const finish = (ev: PointerEvent, dropped: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      for (const t of targets) t.classList.remove("lt-drop-ok", "lt-drop-dim", "lt-drop-over");
      if (!ghost) return; // a tap: the click handler does the work
      ghost.remove();
      dragJustEnded = true;
      setTimeout(() => (dragJustEnded = false), 0);
      if (dropped) onDrop(payload, document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop]") ?? null);
    };
    const up = (ev: PointerEvent) => finish(ev, true);
    const cancel = (ev: PointerEvent) => finish(ev, false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  });
}

function iconCanvas(template: TemplateGenre, source: ReturnType<typeof gearIconSource> | ReturnType<typeof emptySlotIconSource> | null, px: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  canvas.className = "lt-item-icon";
  if (source) {
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    renderGearIcon(ctx, source, artManifest(template), px);
  }
  return canvas;
}

function tierWord(tier: EquipmentTier): string {
  return tier === "common" ? "your own" : tier;
}

// Font Awesome 6 solid caret-up (320x512), rotated per direction.
const CARET_PATH =
  "M182.6 137.4c-12.5-12.5-32.8-12.5-45.3 0l-128 128c-9.2 9.2-11.9 22.9-6.9 34.9s16.6 19.8 29.6 19.8H288c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-128-128z";
const CARET_TURN: Record<Dir, number> = { up: 0, right: 90, down: 180, left: 270 };

function mountCharacterPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  if (!play) play = newPlay("fantasy", ARCHETYPES_BY_TEMPLATE.fantasy[0]!, ROOM_FLOOR.fantasy);
  const st = (): PlayState => play!;

  // Per SOURCE pixel, integers only, the same convention the Library's own
  // scale control uses; renderCell's own unit is canvas px PER TILE
  // (scale x the art's sprite size), so 32 px art halves the default scale.
  const wide = typeof innerWidth === "number" && innerWidth >= 1100;
  const defaultScale = () => (artSpriteSize(st().template) >= 32 ? (wide ? 2 : 1) : wide ? 3 : 2);
  let scale = defaultScale();
  let frame: GlowFrame = 0;
  let pulse = false;
  let lastArtSize = artSpriteSize(st().template);

  el.appendChild(
    buildArtControls(() => {
      const size = artSpriteSize(st().template);
      if (size !== lastArtSize) {
        lastArtSize = size;
        scale = defaultScale();
        scaleSelect.value = String(scale);
      }
      renderAll();
    }),
  );

  const el_ = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- controls ------------------------------------------------------------

  const controls = el_("div", "bn-controls");
  el.appendChild(controls);

  const templateField = el_("label", "bn-field", "Template ");
  const templateSelect = buildTemplateSelect((t) => {
    play = newPlay(t, ARCHETYPES_BY_TEMPLATE[t][0]!, ROOM_FLOOR[t]);
    rebuildArchetypeSelect();
    rebuildFloorOptions();
    renderKayKitControls();
    renderAll();
  });
  templateField.appendChild(templateSelect);
  controls.appendChild(templateField);

  const archetypeField = el_("label", "bn-field", "Archetype ");
  controls.appendChild(archetypeField);

  const floorField = el_("label", "bn-field", "Floor ");
  const floorSelect = el_("select", "bn-select");
  floorSelect.onchange = () => {
    st().floorId = floorSelect.value;
    drawScene();
  };
  floorField.appendChild(floorSelect);
  controls.appendChild(floorField);

  const scaleField = el_("label", "bn-field", "Scale ");
  const scaleSelect = buildScaleSelect([1, 2, 3, 4], scale, (n) => { scale = n; drawScene(); });
  scaleField.appendChild(scaleSelect);
  controls.appendChild(scaleField);

  const frameField = el_("label", "bn-field", "Glow frame ");
  const frameSelect = el_("select", "bn-select");
  frameSelect.innerHTML = '<option value="0">A (bright)</option><option value="1">B (dim)</option>';
  frameSelect.onchange = () => {
    frame = Number(frameSelect.value) as GlowFrame;
    drawScene();
  };
  frameField.appendChild(frameSelect);
  controls.appendChild(frameField);

  const pulseField = el_("label", "bn-field");
  const pulseCheckbox = el_("input");
  pulseCheckbox.type = "checkbox";
  pulseCheckbox.disabled = REDUCED_MOTION;
  pulseCheckbox.onchange = () => {
    pulse = pulseCheckbox.checked;
  };
  pulseField.appendChild(pulseCheckbox);
  pulseField.appendChild(document.createTextNode(REDUCED_MOTION ? " Pulse (off: reduced motion)" : " Pulse glow (legendary)"));
  controls.appendChild(pulseField);

  // KayKit hero controls: shown only while the KayKit Knight is the hero.
  const kkRow = el_("div", "bn-controls lt-kk-controls");
  el.appendChild(kkRow);

  // ---- the scene, the pad, the readout ---------------------------------------

  const playArea = el_("div", "lt-play");
  el.appendChild(playArea);

  const viewport = el_("div", "lt-viewport");
  const canvas = el_("canvas", "lt-canvas");
  viewport.appendChild(canvas);
  playArea.appendChild(viewport);

  const padArea = el_("div", "lt-pad-area");
  playArea.appendChild(padArea);
  const dpad = el_("div", "lt-dpad");
  dpad.setAttribute("role", "group");
  dpad.setAttribute("aria-label", "Move");
  const DPAD_CELL: Record<Dir, string> = { up: "2 / 1", left: "1 / 2", right: "3 / 2", down: "2 / 3" };
  for (const dir of ["up", "left", "right", "down"] as Dir[]) {
    const b = el_("button", "lt-dpad-btn");
    b.type = "button";
    b.setAttribute("aria-label", `Move ${dir}`);
    const [col, row] = DPAD_CELL[dir].split(" / ");
    b.style.gridColumn = col!;
    b.style.gridRow = row!;
    b.innerHTML = `<svg viewBox="0 0 320 512" aria-hidden="true" style="transform:rotate(${CARET_TURN[dir]}deg)"><path d="${CARET_PATH}"/></svg>`;
    b.onclick = () => act(() => heroMove(st(), dir), "move");
    dpad.appendChild(b);
  }
  padArea.appendChild(dpad);

  const actions = el_("div", "lt-actions");
  const actionButton = (label: string, key: string, primary: boolean, run: () => void) => {
    const b = el_("button", primary ? "lt-act lt-act-primary" : "lt-act");
    b.type = "button";
    b.appendChild(el_("span", undefined, label));
    if (key) b.appendChild(el_("kbd", undefined, key));
    b.onclick = run;
    actions.appendChild(b);
  };
  actionButton("Attack", "F", true, () => act(() => heroAttack(st()), "attack"));
  actionButton("Interact", "E", false, () => act(() => heroInteract(st()), "interact"));
  actionButton("Reset scene", "", false, () => {
    const p = st();
    const d = kaykitData();
    play = newPlay(p.template, p.archetypeId, p.floorId, p.hero, p.kaykit && d ? newKayKitHero(d, p.kaykit) : null);
    renderAll();
  });
  padArea.appendChild(actions);
  padArea.appendChild(el_("p", "lt-note lt-keys", "Arrow keys or WASD move. E interacts, F attacks."));

  const info = el_("div", "lt-info");
  playArea.appendChild(info);
  const stats = el_("div", "lt-stats");
  const say = el_("p", "lt-say");
  say.setAttribute("role", "status");
  const logEl = el_("div", "lt-log");
  logEl.setAttribute("aria-label", "Dice log");
  info.append(stats, say, logEl);

  // ---- gear ----------------------------------------------------------------

  const gear = el_("section", "lt-gear");
  el.appendChild(gear);
  gear.appendChild(el_("h3", undefined, "Worn"));
  gear.appendChild(el_("p", "lt-note", "Drop an item on the slot it fits, or tap it. Tap a worn magic piece (or drag it to the pack) to take it off; your own piece comes back."));
  const slotsEl = el_("div", "lt-slots");
  gear.appendChild(slotsEl);
  gear.appendChild(el_("h3", undefined, "Pack"));
  const packEl = el_("div", "lt-tray");
  packEl.dataset.drop = "pack";
  gear.appendChild(packEl);
  gear.appendChild(el_("h3", undefined, "Armoury"));
  gear.appendChild(el_("p", "lt-note", "Every piece this archetype can wear, at every tier the game has. For trying things on; what you win in the scene lands in the pack."));
  const armouryEl = el_("div", "lt-armoury");
  gear.appendChild(armouryEl);

  // ---- behaviour -----------------------------------------------------------

  function act(run: () => void, kind?: "move" | "attack" | "interact"): void {
    const p0 = st();
    const before = { at: { ...p0.heroAt }, hp: p0.hero.currentHp, monsterAt: p0.monster ? { ...p0.monster.at } : null, bag: p0.hero.bag?.length ?? 0 };
    run();
    const p = st();
    if (p.log.length > LOG_KEEP) p.log.splice(0, p.log.length - LOG_KEEP);
    if (p.kaykit && kind) animateKayKit(p, p.kaykit, kind, before);
    renderAll();
  }

  function gearResult(outcome: GearOutcome): void {
    st().note = outcome.ok ? null : outcome.reason;
    renderAll();
  }

  function onDrop(payload: DragPayload, target: HTMLElement | null): void {
    if (!target) return;
    const p = st();
    if (target.dataset.drop === "pack") {
      if (payload.from === "slot") gearResult(takeOff(p, payload.role));
      return;
    }
    if (payload.from === "slot") return;
    const role = target.dataset.role as GearRole;
    if (role !== payload.role) {
      const tier = payload.from === "armoury" ? payload.tier : p.hero.bag![payload.index]!.tier;
      p.note = `The ${itemName(p.archetypeId, payload.role, tier)} goes in the ${slotNaming(p.archetypeId, payload.role).slot} slot, not ${slotNaming(p.archetypeId, role).slot}.`;
      renderAll();
      return;
    }
    gearResult(payload.from === "armoury" ? equipFromArmoury(p, payload.role, payload.tier) : equipFromPack(p, payload.index));
  }

  function rebuildArchetypeSelect(): void {
    archetypeField.querySelectorAll("select").forEach((s) => s.remove());
    const p = st();
    const select = buildArchetypeSelect(p.template, (id) => {
      const now = st();
      const d = kaykitData();
      play = (id as string) === KAYKIT_ARCHETYPE && d
        ? newPlay(now.template, "knight", now.floorId, undefined, newKayKitHero(d, now.kaykit))
        : newPlay(now.template, id, now.floorId);
      renderKayKitControls();
      renderAll();
    });
    // The KayKit Knight: a Blender render of a CC0 3D model, on trial against the hand-drawn tokens.
    if (p.template === "fantasy" && kaykitData()) {
      const opt = el_("option", undefined, "KayKit Knight (3D render)");
      opt.value = KAYKIT_ARCHETYPE;
      select.appendChild(opt);
    }
    select.value = p.kaykit ? KAYKIT_ARCHETYPE : p.archetypeId;
    archetypeField.appendChild(select);
  }

  function rebuildFloorOptions(): void {
    const p = st();
    floorSelect.innerHTML = "";
    const options = floorOptionsFor(p.template);
    if (!options.includes(p.floorId)) options.unshift(p.floorId);
    for (const id of options) {
      const opt = el_("option", undefined, id);
      opt.value = id;
      if (id === p.floorId) opt.selected = true;
      floorSelect.appendChild(opt);
    }
  }

  function drawScene(): void {
    const p = st();
    const manifest = artManifest(p.template);
    const tileScale = scale * spriteSizeOf(manifest);
    canvas.width = CELL_WIDTH * tileScale;
    canvas.height = CELL_HEIGHT * tileScale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const plan = renderPlanFor(p.hero);
    renderCell(ctx, sceneLayout(p), manifest, tileScale, 0, plan ? { [HERO_ID]: plan } : undefined, frame);
    if (p.kaykit) drawKayKitHero(ctx, p, p.kaykit, tileScale);
    // Keep the hero in the middle of the viewport (it matters at phone width),
    // but only when it has moved: an animating KayKit hero redraws every frame
    // and must not keep yanking a viewport the player scrolled.
    const centreKey = `${p.heroAt.x},${p.heroAt.y},${tileScale}`;
    if (centreKey !== lastCentre) {
      lastCentre = centreKey;
      viewport.scrollLeft = Math.max(0, p.heroAt.x * tileScale + tileScale / 2 - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, p.heroAt.y * tileScale + tileScale / 2 - viewport.clientHeight / 2);
    }
  }
  let lastCentre = "";

  // ---- the KayKit hero -----------------------------------------------------

  /** The clip showing now, after moving through anything queued. Walk plays only for the step; death holds its last frame. */
  function currentClip(p: PlayState, k: KayKitHero, now: number): KClip | null {
    const d = kaykitData();
    if (!d) return null;
    for (let guard = 0; guard < 8; guard++) {
      const c = findClip(d, k.style, k.loadout, k.size, k.clip, k.dir);
      if (!c) return null;
      const elapsed = now - k.clipStart;
      const done = k.clip === "walk" ? elapsed >= STEP_MS : !c.loop && elapsed >= clipDurationMs(c);
      if (!done || k.clip === "death" || (k.clip === "idle" && k.queue.length === 0)) return c;
      k.clip = k.queue.shift() ?? (heroDown(p) ? "death" : "idle");
      k.clipStart = now;
    }
    return findClip(d, k.style, k.loadout, k.size, k.clip, k.dir);
  }

  // Stable, so framesNow registers it once per clip however often the loop asks.
  const redrawScene = (): void => drawScene();

  function drawKayKitHero(ctx: CanvasRenderingContext2D, p: PlayState, k: KayKitHero, tileScale: number): void {
    const d = kaykitData();
    if (!d) return;
    const now = performance.now();
    const c = currentClip(p, k, now);
    if (!c) return;
    const frames = framesNow(d, k.style, c, redrawScene);
    if (!frames) return;
    const f = frames[frameIndex(c, now - k.clipStart)]!;
    const meta = d.sizes[k.size]!;
    let hx = p.heroAt.x;
    let hy = p.heroAt.y;
    if (k.tween) {
      const t = Math.min(1, (now - k.tween.start) / STEP_MS);
      hx = k.tween.from.x + (p.heroAt.x - k.tween.from.x) * t;
      hy = k.tween.from.y + (p.heroAt.y - k.tween.from.y) * t;
      if (t >= 1) k.tween = null;
    }
    // Every detail level stands in the game's own token footprint: one tile
    // wide, feet on the tile's bottom edge. At 16x24 a sprite pixel is a tile
    // pixel; at 32x48 and 48x72 the pixels are finer than the floor's.
    const spx = tileScale / meta.tokenW;
    const x = Math.round((hx + 0.5) * tileScale - meta.anchorX * spx);
    const y = Math.round((hy + 1) * tileScale - meta.anchorY * spx);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f, x, y, Math.round(meta.canvasW * spx), Math.round(meta.canvasH * spx));
  }

  /** Pick the clips a press produced, from what changed: a step walks, a landed press swings or uses, a hit flinches, a fall dies, a find cheers. */
  function animateKayKit(p: PlayState, k: KayKitHero, kind: "move" | "attack" | "interact", before: { at: XY; hp: number; monsterAt: XY | null; bag: number }): void {
    const now = performance.now();
    const queue: KClipId[] = [];
    if (kind === "move" && !same(before.at, p.heroAt)) {
      k.dir = dirToward(p.heroAt.x - before.at.x, p.heroAt.y - before.at.y);
      k.tween = { from: before.at, start: now };
      queue.push("walk");
    } else if (kind === "attack" && before.monsterAt && p.note === null) {
      k.dir = dirToward(before.monsterAt.x - p.heroAt.x, before.monsterAt.y - p.heroAt.y);
      queue.push("attack");
    } else if (kind === "interact" && p.note === null) {
      const target = tileDistance(p.heroAt, DOOR_AT) <= 1 ? DOOR_AT : CONTAINER_AT;
      if (!same(target, p.heroAt)) k.dir = dirToward(target.x - p.heroAt.x, target.y - p.heroAt.y);
      queue.push("interact");
    }
    if (p.hero.currentHp < before.hp) queue.push(heroDown(p) ? "death" : "hit");
    else if ((p.hero.bag?.length ?? 0) > before.bag || (before.monsterAt && !p.monster)) queue.push("cheer");
    if (queue.length === 0) return;
    k.clip = queue.shift()!;
    k.clipStart = now;
    k.queue = queue;
  }

  function kaykitSignature(): string {
    const p = st();
    const k = p.kaykit;
    if (!k) return "";
    const now = performance.now();
    const c = currentClip(p, k, now);
    const fi = c ? frameIndex(c, now - k.clipStart) : -1;
    const tw = k.tween ? Math.floor((now - k.tween.start) / 30) : -1;
    return `${k.style}|${k.size}|${k.loadout}|${k.clip}|${k.dir}|${fi}|${tw}`;
  }

  const DETAIL_LABEL: Record<string, string> = { "16x24": "16x24 (the game's size)", "32x48": "32x48 (2x detail)", "48x72": "48x72 (3x detail)" };

  function renderKayKitControls(): void {
    kkRow.innerHTML = "";
    const p = st();
    const d = kaykitData();
    kkRow.hidden = !p.kaykit || !d;
    if (!p.kaykit || !d) return;
    const k = p.kaykit;
    const pick = (label: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLElement => {
      const field = el_("label", "bn-field", `${label} `);
      const select = el_("select", "bn-select");
      for (const [v, text] of options) {
        const opt = el_("option", undefined, text);
        opt.value = v;
        select.appendChild(opt);
      }
      select.value = value;
      select.onchange = () => onChange(select.value);
      field.appendChild(select);
      return field;
    };
    kkRow.append(
      pick("Render style", d.styles.map((s) => [s.style, s.label]), k.style, (v) => {
        k.style = v;
        renderKayKitControls();
        drawScene();
      }),
      pick("Detail", sizeIdsFor(d, k.loadout).map((id) => [id, DETAIL_LABEL[id] ?? id]), k.size, (v) => {
        k.size = v;
        drawScene();
      }),
      pick("Weapons", d.loadouts.map((l) => [l.id, l.label]), k.loadout, (v) => {
        k.loadout = v;
        const sizes = sizeIdsFor(d, v);
        if (!sizes.includes(k.size)) k.size = sizes[0]!;
        renderKayKitControls();
        drawScene();
      }),
    );
    const style = d.styles.find((s) => s.style === k.style);
    kkRow.appendChild(
      el_(
        "p",
        "lt-note lt-kk-note",
        `${style ? `${style.label}: ${style.description} ` : ""}KayKit ${d.character} by Kay Lousberg (CC0), rendered in Blender. Every detail level stands in the game's one-tile token footprint. The rules are the Knight's: the Worn slots change the numbers, not this picture.`,
      ),
    );
  }

  function stat(label: string, value: string, bad = false): HTMLElement {
    const chip = el_("span", bad ? "lt-stat lt-stat-bad" : "lt-stat");
    chip.appendChild(el_("span", "lt-stat-label", `${label} `));
    chip.appendChild(el_("b", undefined, value));
    return chip;
  }

  function renderStats(): void {
    const p = st();
    const h = p.hero;
    const weapon = weaponFor(h);
    const reachFt = (weapon.ranged ? DEFAULT_RANGED_REACH_TILES : DEFAULT_MELEE_REACH_TILES) * 5;
    const bonus = attackerBonusFor(h);
    stats.innerHTML = "";
    stats.append(
      stat("HP", `${h.currentHp}/${h.maxHp}`, heroDown(p) || h.currentHp * 2 <= h.maxHp),
      stat("AC", String(effectiveArmorClass(h))),
      stat("Attack", `${bonus >= 0 ? "+" : ""}${bonus}`),
      stat("Damage", weaponDamageNotationFor(h)),
      stat(weapon.name, `${weapon.ranged ? "range" : "reach"} ${reachFt} ft`),
      stat("Attuned", `${attunedRoles(p.archetypeId, h.equipment ?? {}).length}/${MAX_ATTUNED_ITEMS}`),
    );
    const block = statblockFor(SCENE_KIT[p.template].monster);
    if (p.monster) {
      stats.append(stat(block.name, `${p.monster.hp}/${block.maxHp} HP, AC ${block.armorClass}, ${p.monster.awake ? "awake" : "asleep"}`, p.monster.awake));
    } else {
      stats.append(stat(block.name, "down"));
    }
  }

  function renderLog(): void {
    const p = st();
    say.textContent = p.note ?? "";
    say.hidden = !p.note;
    logEl.innerHTML = "";
    if (p.log.length === 0) {
      logEl.appendChild(el_("p", "lt-log-empty", `Walk to ${SCENE_KIT[p.template].doorLabel} and press Interact. Every roll lands here.`));
      return;
    }
    for (const line of p.log) logEl.appendChild(el_("p", `lt-log-line ${line.tone}`, line.text));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderSlots(): void {
    const p = st();
    slotsEl.innerHTML = "";
    for (const role of GEAR_ROLES) {
      const { slot } = slotNaming(p.archetypeId, role);
      const tier = wornTier(p, role);
      const b = el_("button", "lt-slot");
      b.type = "button";
      b.dataset.drop = "slot";
      b.dataset.role = role;
      const source = tier ? gearIconSource(p.archetypeId, role, tier) : isSheetOnlyRole(role) ? emptySlotIconSource(p.template, role) : null;
      const icon = iconCanvas(p.template, source, 48);
      const name = tier ? itemName(p.archetypeId, role, tier) : "Empty";
      b.setAttribute("aria-label", `${slot}: ${name}${tier ? `, ${tierWord(tier)}` : ""}`);
      b.append(icon, el_("span", "lt-slot-word", slot), el_("span", "lt-slot-name", name), el_("span", "lt-tier", tier ? tierWord(tier) : "nothing worn"));
      b.onclick = () => {
        if (dragJustEnded) return;
        gearResult(takeOff(st(), role));
      };
      if (tier && tier !== "common") makeDraggable(b, { from: "slot", role }, icon, onDrop);
      slotsEl.appendChild(b);
    }
  }

  function itemChip(role: GearRole, tier: EquipmentTier, state: string | null, payload: DragPayload, onTap: () => void): HTMLButtonElement {
    const p = st();
    const b = el_("button", state === "worn" ? "lt-chip is-worn" : "lt-chip");
    b.type = "button";
    const icon = iconCanvas(p.template, gearIconSource(p.archetypeId, role, tier), 40);
    const text = el_("span", "lt-chip-text");
    text.append(el_("span", "lt-chip-name", itemName(p.archetypeId, role, tier)), el_("span", "lt-tier", state ? `${tierWord(tier)}, ${state}` : tierWord(tier)));
    b.append(icon, text);
    b.onclick = () => {
      if (dragJustEnded) return;
      onTap();
    };
    makeDraggable(b, payload, icon, onDrop);
    return b;
  }

  function renderPack(): void {
    const p = st();
    packEl.innerHTML = "";
    const bag = p.hero.bag ?? [];
    if (bag.length === 0) {
      packEl.appendChild(el_("p", "lt-note lt-tray-empty", "Empty. What you win lands here: kill the monster or open the container. Drag a worn magic piece here to take it off."));
      return;
    }
    bag.forEach((item, index) => {
      packEl.appendChild(itemChip(item.slot, item.tier, null, { from: "pack", role: item.slot, index }, () => gearResult(equipFromPack(st(), index))));
    });
  }

  function renderArmoury(): void {
    const p = st();
    armouryEl.innerHTML = "";
    const bag = p.hero.bag ?? [];
    for (const role of GEAR_ROLES) {
      const row = el_("div", "lt-armoury-row");
      row.appendChild(el_("div", "lt-slot-word", slotNaming(p.archetypeId, role).slot));
      const chips = el_("div", "lt-armoury-chips");
      for (const tier of tiersFor(p.archetypeId, role)) {
        const state = wornTier(p, role) === tier ? "worn" : bag.some((b) => b.slot === role && b.tier === tier) ? "in pack" : null;
        chips.appendChild(itemChip(role, tier, state, { from: "armoury", role, tier }, () => gearResult(equipFromArmoury(st(), role, tier))));
      }
      row.appendChild(chips);
      armouryEl.appendChild(row);
    }
  }

  function renderAll(): void {
    drawScene();
    renderStats();
    renderLog();
    renderSlots();
    renderPack();
    renderArmoury();
  }

  // ---- keyboard, pulse, first paint ----------------------------------------

  const KEY_DIR: Record<string, Dir> = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("input, select, textarea, [contenteditable]")) return;
    const key = e.key.toLowerCase();
    if (target?.closest?.("button") && (key === " " || key === "enter")) return;
    const dir = KEY_DIR[key];
    if (dir) act(() => heroMove(st(), dir), "move");
    else if (key === "e") act(() => heroInteract(st()), "interact");
    else if (key === "f" || key === " ") act(() => heroAttack(st()), "attack");
    else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);

  let raf = 0;
  let lastFlip = 0;
  let lastSig = "";
  function loop(now: number) {
    if (pulse && !REDUCED_MOTION && now - lastFlip >= GLOW_PULSE_PERIOD_MS / 2) {
      lastFlip = now;
      frame = frame === 0 ? 1 : 0;
      frameSelect.value = String(frame);
      drawScene();
    }
    // The KayKit hero animates: redraw only when the frame it shows changes.
    if (st().kaykit && !REDUCED_MOTION) {
      const sig = kaykitSignature();
      if (sig !== lastSig) {
        lastSig = sig;
        drawScene();
      }
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  templateSelect.value = st().template;
  rebuildArchetypeSelect();
  rebuildFloorOptions();
  renderKayKitControls();
  renderAll();

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener("keydown", onKey);
  };
}

// ===========================================================================
// Panel: KayKit. The comparison surface for the 3D-to-pixel trial: every
// conversion style the Blender harness produced (scripts/kaykit/), side by
// side in all four facings, playing the chosen animation, beside the source
// render and the game's current hand-drawn Knight at the same zoom. Nothing is
// filtered or ranked here: the owner judges.
// ===========================================================================

const KK_CLIP_LABEL: Record<KClipId, string> = {
  idle: "Idle",
  walk: "Walk",
  attack: "Attack",
  hit: "Hit",
  death: "Death",
  interact: "Interact",
  cheer: "Cheer",
};
const KK_DIR_LABEL: Record<KDir, string> = { down: "Front", right: "Right", up: "Back", left: "Left" };
const KK_ONCE_PAUSE_MS = 700;

/** The game's current Knight token (body plus common gear, through renderPlanFor and renderCell) on a floor tile, cropped to one tile by 1.5. */
function drawGameKnight(target: HTMLCanvasElement, zoom: number, floorId: TileId | null): void {
  const tileScale = 16 * zoom;
  const full = document.createElement("canvas");
  full.width = CELL_WIDTH * tileScale;
  full.height = CELL_HEIGHT * tileScale;
  const fctx = full.getContext("2d")!;
  fctx.imageSmoothingEnabled = false;
  const tiles: TileId[][] = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => floorId ?? "__none__"));
  const layout: CellLayout = { tiles, props: [], tokens: [{ id: "knight", assetId: bodySpriteId("knight"), x: 2, y: 2, kind: "pc" }], exits: [], sealed: true };
  const plan = renderPlanFor(baseSheetFor("knight"));
  renderCell(fctx, layout, MANIFEST.fantasy, tileScale, 0, plan ? { knight: plan } : undefined, 0);
  // Same box the KayKit cells use: two token widths by 1.5 token heights, feet on the bottom edge.
  target.width = 32 * zoom;
  target.height = 36 * zoom;
  const ctx = target.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(full, 1.5 * tileScale, 3 * tileScale - 36 * zoom, 32 * zoom, 36 * zoom, 0, 0, 32 * zoom, 36 * zoom);
}

function paintFloor(ctx: CanvasRenderingContext2D, floorId: TileId | null, tilePx: number, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  if (!floorId) return;
  const sprite = MANIFEST.fantasy.tiles[floorId];
  if (!sprite) return;
  const px = tilePx / 16;
  for (let ty = h; ty > -tilePx; ty -= tilePx) {
    for (let tx = 0; tx < w; tx += tilePx) {
      for (let sy = 0; sy < sprite.pixels.length; sy++) {
        const row = sprite.pixels[sy]!;
        for (let sx = 0; sx < row.length; sx++) {
          const idx = row[sx]!;
          if (idx < 0) continue;
          ctx.fillStyle = MANIFEST.fantasy.palette[idx] ?? "#f0f";
          ctx.fillRect(Math.floor(tx + sx * px), Math.floor(ty - tilePx + sy * px), Math.ceil(px), Math.ceil(px));
        }
      }
    }
  }
}

function mountKayKitPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  const d = kaykitData();
  if (!d) {
    el.innerHTML =
      '<p class="lt-note">No KayKit renders in this build. Fetch the pack and run the Blender harness (scripts/kaykit/README.md), then rebuild with <code>npm run bench</code>.</p>';
    return () => {};
  }

  let loadout = d.loadouts[0]!.id;
  let size = sizeIdsFor(d, loadout).includes("32x48") ? "32x48" : sizeIdsFor(d, loadout)[0]!;
  let clip: KClipId = "walk";
  let zoom = 3;
  let floorId: TileId | null = "floor_stone";
  let speed = 1;
  let playing = !REDUCED_MOTION;

  const controls = document.createElement("div");
  controls.className = "bn-controls";
  el.appendChild(controls);
  const pick = (label: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement => {
    const field = document.createElement("label");
    field.className = "bn-field";
    field.textContent = `${label} `;
    const select = document.createElement("select");
    select.className = "bn-select";
    for (const [v, text] of options) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = text;
      select.appendChild(opt);
    }
    select.value = value;
    select.onchange = () => onChange(select.value);
    field.appendChild(select);
    controls.appendChild(field);
    return select;
  };
  pick("Weapons", d.loadouts.map((l) => [l.id, l.label]), loadout, (v) => {
    loadout = v;
    const sizes = sizeIdsFor(d, v);
    if (!sizes.includes(size)) size = sizes[0]!;
    rebuildSizeSelect();
    build();
  });
  let sizeSelect = pick("Detail", [], size, () => {});
  function rebuildSizeSelect(): void {
    sizeSelect.innerHTML = "";
    for (const id of sizeIdsFor(d!, loadout)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id === "16x24" ? "16x24 (the game's size)" : id;
      sizeSelect.appendChild(opt);
    }
    sizeSelect.value = size;
    sizeSelect.onchange = () => {
      size = sizeSelect.value;
      build();
    };
  }
  rebuildSizeSelect();
  pick("Animation", K_CLIPS.map((c) => [c, KK_CLIP_LABEL[c]]), clip, (v) => {
    clip = v as KClipId;
    build();
  });
  pick("Zoom", ["2", "3", "4", "6"].map((z) => [z, `${z}x`]), String(zoom), (v) => {
    zoom = Number(v);
    build();
  });
  pick("Floor", [["floor_stone", "Stone"], ["floor_grass", "Grass"], ["", "None"]], floorId ?? "", (v) => {
    floorId = v || null;
    build();
  });
  pick("Speed", [["1", "1x"], ["0.5", "0.5x"], ["0.25", "0.25x"]], "1", (v) => {
    speed = Number(v);
  });
  const playField = document.createElement("label");
  playField.className = "bn-field";
  const playBox = document.createElement("input");
  playBox.type = "checkbox";
  playBox.checked = playing;
  playBox.onchange = () => {
    playing = playBox.checked;
  };
  playField.append(playBox, document.createTextNode(" Play"));
  controls.appendChild(playField);

  const body = document.createElement("div");
  el.appendChild(body);

  interface Cell {
    canvas: HTMLCanvasElement;
    style: string;
    dir: KDir;
    shown: number;
  }
  let cells: Cell[] = [];
  let clock = 0;
  let last = performance.now();

  function build(): void {
    body.innerHTML = "";
    cells = [];
    const meta = d!.sizes[size]!;
    const tilePx = meta.tokenW * zoom; // the token footprint is one tile, as in the game

    const top = document.createElement("div");
    top.className = "lt-kk-top";
    const ref = document.createElement("figure");
    ref.className = "lt-kk-fig";
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${d!.reference}`;
    img.alt = "The KayKit Knight rendered straight from Blender, before any pixel conversion";
    img.className = "lt-kk-ref";
    const cap = document.createElement("figcaption");
    cap.textContent = "Source: the 3D model, lit and smoothed, before conversion.";
    ref.append(img, cap);
    const today = document.createElement("figure");
    today.className = "lt-kk-fig";
    const todayCanvas = document.createElement("canvas");
    todayCanvas.className = "lt-canvas";
    // Same footprint as the KayKit cells: at 32x48 a game pixel is drawn 2x as big as a KayKit pixel.
    drawGameKnight(todayCanvas, zoom * Math.max(1, Math.round(meta.tokenW / 16)), floorId);
    const cap2 = document.createElement("figcaption");
    cap2.textContent = `The game today: the hand-drawn 16x24 Knight token, drawn in the same footprint. One facing, no animation.`;
    today.append(todayCanvas, cap2);
    top.append(ref, today);
    body.appendChild(top);

    const note = document.createElement("p");
    note.className = "lt-note";
    note.textContent =
      `${d!.character} from ${d!.source}. Camera ${d!.cameraPitchDeg} degrees above level, orthographic. ` +
      `Every style below is the same poses, framing and palette; only the conversion differs. ` +
      `At ${size}, one floor tile is ${meta.tokenW} sprite pixels wide, so the figure stands in the same one-tile footprint as the game's tokens.`;
    body.appendChild(note);

    const grid = document.createElement("div");
    grid.className = "lt-kk-grid";
    grid.style.setProperty("--kk-cols", String(K_DIRS.length));
    body.appendChild(grid);
    grid.appendChild(document.createElement("div"));
    for (const dir of K_DIRS) {
      const h = document.createElement("div");
      h.className = "lt-kk-colhead";
      h.textContent = KK_DIR_LABEL[dir];
      grid.appendChild(h);
    }
    for (const s of d!.styles) {
      const label = document.createElement("div");
      label.className = "lt-kk-rowhead";
      const b = document.createElement("b");
      b.textContent = s.label;
      const p = document.createElement("span");
      p.textContent = s.description;
      label.append(b, p);
      grid.appendChild(label);
      for (const dir of K_DIRS) {
        const canvas = document.createElement("canvas");
        canvas.className = "lt-canvas lt-kk-cell";
        canvas.width = meta.canvasW * zoom;
        canvas.height = meta.canvasH * zoom;
        canvas.title = `${s.label}, ${KK_DIR_LABEL[dir]}, ${KK_CLIP_LABEL[clip]}`;
        grid.appendChild(canvas);
        cells.push({ canvas, style: s.style, dir, shown: -1 });
      }
    }
    void tilePx;
    draw(true);
  }

  const redrawAll = (): void => draw(true);

  function draw(force = false): void {
    const meta = d!.sizes[size]!;
    const tilePx = meta.tokenW * zoom;
    for (const cell of cells) {
      const c = findClip(d!, cell.style, loadout, size, clip, cell.dir);
      if (!c) continue;
      const frames = framesNow(d!, cell.style, c, redrawAll);
      if (!frames) continue;
      const span = c.loop ? clipDurationMs(c) : clipDurationMs(c) + KK_ONCE_PAUSE_MS;
      const i = frameIndex(c, clock % span);
      if (!force && i === cell.shown) continue;
      cell.shown = i;
      const ctx = cell.canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      paintFloor(ctx, floorId, tilePx, cell.canvas.width, cell.canvas.height);
      ctx.drawImage(frames[i]!, 0, 0, cell.canvas.width, cell.canvas.height);
    }
  }

  let raf = 0;
  function loop(now: number): void {
    if (playing) clock += (now - last) * speed;
    last = now;
    draw();
    raf = requestAnimationFrame(loop);
  }
  build();
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

// ===========================================================================
// Panel: Converted. Every in-play fantasy sprite the game uses, the current
// hand-drawn one beside the KayKit conversion chosen in the Art row (ground
// style, character style, detail), grouped the way the conversion was
// split. An id the chosen parts do not cover says so. The Healer's pieces are
// out of play and not listed; sci-fi is paused.
// ===========================================================================

const CONVERTED_GROUPS: { id: string; label: string; test: (s: LtSprite) => boolean; collapsed?: boolean }[] = [
  { id: "token", label: "Characters and monsters", test: (s) => s.kind === "token" && !s.assetId.startsWith("gear_") },
  { id: "gear", label: "Gear overlays", test: (s) => s.assetId.startsWith("gear_") && !/_(ring|amulet)_/.test(s.assetId) },
  { id: "icon", label: "Ring and amulet icons", test: (s) => /^gear_.*_(ring|amulet)_/.test(s.assetId) },
  { id: "prop", label: "Props", test: (s) => s.kind === "prop" },
  { id: "ground", label: "Ground, water, forest and cliffs", test: (s) => s.kind === "tile" && !/_edge_|^water_edge|^cliff_edge/.test(s.assetId) && !s.assetId.startsWith("wall_") },
  { id: "wall", label: "Walls", test: (s) => s.kind === "tile" && s.assetId.startsWith("wall_") },
  { id: "edge", label: "Edges (shorelines and borders, 10 families x 19 shapes)", test: (s) => s.kind === "tile" && /_edge_|^water_edge|^cliff_edge/.test(s.assetId), collapsed: true },
];

/** One sprite into a canvas at its own resolution, sized on screen by CSS so 16 and 32 px versions show at the same size. */
function spriteCanvas(pixels: number[][], palette: string[], cssPxPer16: number, w16: number, h16: number): HTMLCanvasElement {
  const h = pixels.length;
  const w = pixels[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.className = "lt-icon-canvas lt-conv-canvas";
  canvas.style.width = `${w16 * cssPxPer16}px`;
  canvas.style.height = `${h16 * cssPxPer16}px`;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = pixels[y]![x]!;
      if (idx < 0) continue;
      const hex = palette[idx] ?? "#ff00ff";
      const o = (y * w + x) * 4;
      img.data[o] = parseInt(hex.slice(1, 3), 16);
      img.data[o + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[o + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function mountConvertedPanel(el: HTMLElement, _api: unknown): void {
  injectPanelStyle();
  el.innerHTML = "";
  if (!kaykitLibrary()) {
    el.innerHTML = '<p class="lt-note">No converted library in this build. Run the scripts/kaykit/lib_*.py makers, then <code>npm run bench</code>.</p>';
    return;
  }
  el.appendChild(buildArtControls(() => mountConvertedPanel(el, _api)));
  const body = document.createElement("div");
  el.appendChild(body);
  const render = () => {
    body.innerHTML = "";
    const palette = MANIFEST.fantasy.palette;
    const inPlay = SPRITES_BY_TEMPLATE.fantasy.filter((s) => !/healer/.test(s.assetId));
    const covered = inPlay.filter((s) => kaykitHas(s.assetId)).length;
    const summary = document.createElement("p");
    summary.className = "lt-note";
    summary.textContent =
      `${inPlay.length} in-play fantasy pieces: ${covered} converted from KayKit, ${inPlay.length - covered} still the hand-drawn art. ` +
      `Showing ground "${art.ground}", characters "${art.chars}", ${art.size} px. Left of each pair is the game today, right is the conversion.`;
    body.appendChild(summary);
    for (const group of CONVERTED_GROUPS) {
      const members = inPlay.filter(group.test);
      if (members.length === 0) continue;
      const section = document.createElement(group.collapsed ? "details" : "section");
      section.className = "lt-conv-group";
      const head = document.createElement(group.collapsed ? "summary" : "h3");
      head.textContent = `${group.label} (${members.filter((s) => kaykitHas(s.assetId)).length} of ${members.length} converted)`;
      section.appendChild(head);
      const grid = document.createElement("div");
      grid.className = "lt-conv-grid";
      for (const s of members) {
        const w16 = s.pixels[0]?.length ?? 16;
        const h16 = s.pixels.length;
        const card = document.createElement("div");
        card.className = "lt-conv-card";
        const label = document.createElement("div");
        label.className = "lt-icon-label";
        label.textContent = s.assetId;
        label.title = s.name;
        const pair = document.createElement("div");
        pair.className = "lt-conv-pair";
        const zoom = group.id === "edge" ? 2 : 3;
        pair.appendChild(spriteCanvas(s.pixels, palette, zoom, w16, h16));
        const conv = kaykitPixels(s.assetId);
        if (conv) pair.appendChild(spriteCanvas(conv, palette, zoom, w16, h16));
        else {
          const gap = document.createElement("span");
          gap.className = "lt-conv-gap";
          gap.textContent = "not converted";
          pair.appendChild(gap);
        }
        card.append(label, pair);
        grid.appendChild(card);
      }
      section.appendChild(grid);
      body.appendChild(section);
    }
  };
  if (artDecoded) render();
  else {
    body.innerHTML = '<p class="lt-note">Loading the KayKit art...</p>';
    void decodeLibrary().then((d) => {
      artDecoded = d;
      render();
    });
  }
}

// ===========================================================================
// Panel: Doll. The inventory screen's paper-doll figure, via render/doll.ts's
// renderDoll, at its real DOLL_MIN_SCALE..DOLL_MAX_SCALE range.
// ===========================================================================

function mountDollPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  el.appendChild(buildArtControls(() => draw()));
  const controls = document.createElement("div");
  controls.className = "bn-controls";
  el.appendChild(controls);
  const tierHost = document.createElement("div");
  el.appendChild(tierHost);
  const stage = document.createElement("div");
  stage.className = "lt-stage";
  const canvas = document.createElement("canvas");
  canvas.className = "lt-canvas";
  stage.appendChild(canvas);
  el.appendChild(stage);

  let template: TemplateGenre = "fantasy";
  let archetypeId: ArchetypeId = ARCHETYPES_BY_TEMPLATE.fantasy[0]!;
  let scale = DOLL_MAX_SCALE;
  let frame: GlowFrame = 0;
  const picked: Partial<Record<GearRole, EquipmentTier | "empty">> = {};

  const templateField = document.createElement("label");
  templateField.className = "bn-field";
  templateField.textContent = "Template ";
  templateField.appendChild(
    buildTemplateSelect((t) => {
      template = t;
      archetypeId = ARCHETYPES_BY_TEMPLATE[t][0]!;
      rebuildArchetype();
    }),
  );
  controls.appendChild(templateField);

  const archetypeField = document.createElement("label");
  archetypeField.className = "bn-field";
  archetypeField.textContent = "Archetype ";
  controls.appendChild(archetypeField);

  const scaleField = document.createElement("label");
  scaleField.className = "bn-field";
  scaleField.textContent = "Scale ";
  const scaleOptions: number[] = [];
  for (let s = DOLL_MIN_SCALE; s <= DOLL_MAX_SCALE; s++) scaleOptions.push(s);
  scaleField.appendChild(buildScaleSelect(scaleOptions, scale, (n) => { scale = n; draw(); }));
  controls.appendChild(scaleField);

  const frameField = document.createElement("label");
  frameField.className = "bn-field";
  frameField.textContent = "Glow frame ";
  const frameSelect = document.createElement("select");
  frameSelect.className = "bn-select";
  frameSelect.innerHTML = '<option value="0">A (bright)</option><option value="1">B (dim)</option>';
  frameSelect.onchange = () => {
    frame = Number(frameSelect.value) as GlowFrame;
    draw();
  };
  frameField.appendChild(frameSelect);
  controls.appendChild(frameField);

  function rebuildArchetype() {
    archetypeField.querySelectorAll("select").forEach((s) => s.remove());
    const archSelect = buildArchetypeSelect(template, (id) => {
      archetypeId = id;
      rebuildTiers();
    });
    archSelect.value = archetypeId;
    archetypeField.appendChild(archSelect);
    rebuildTiers();
  }

  function rebuildTiers() {
    tierHost.innerHTML = "";
    tierHost.appendChild(buildTierControls(archetypeId, picked, draw));
    draw();
  }

  function draw() {
    const manifest = artManifest(template);
    canvas.width = DOLL_CANVAS_SIZE * scale;
    canvas.height = DOLL_CANVAS_SIZE * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const equipment = equipmentFrom(picked);
    const sheet = sheetWithEquipment(archetypeId, equipment);
    const plan = renderPlanFor(sheet);
    renderDoll(ctx, plan, manifest, scale, frame);
  }

  rebuildArchetype();
  return () => {};
}

// ===========================================================================
// Panel: Icons. Every gear item's inventory icon at every tier, via
// render/gearIcon.ts's renderGearIcon, plus the empty-slot silhouettes; at
// the size the phone inventory shows them (48 CSS px, InventoryScreen.tsx's
// SLOT_ICON_PX) and at 4x (192px, so the icon's own internal scale cap of 4
// is actually reachable).
// ===========================================================================

const ICON_NATIVE_PX = 48;
const ICON_ZOOM_PX = ICON_NATIVE_PX * 4;

interface IconEntry {
  label: string;
  source: NonNullable<ReturnType<typeof gearIconSource>> | ReturnType<typeof emptySlotIconSource>;
  template: TemplateGenre;
}

function collectIcons(): IconEntry[] {
  const out: IconEntry[] = [];
  for (const template of TEMPLATES) {
    for (const archetypeId of ARCHETYPES_BY_TEMPLATE[template]) {
      for (const role of DRAWN_ROLES) {
        for (const tier of EQUIPMENT_TIERS) {
          const source = gearIconSource(archetypeId, role, tier);
          if (!source) continue;
          const name = gearItemName(archetypeId, role, tier) ?? role;
          out.push({ label: `${ARCHETYPE_LABEL[archetypeId]}, ${slotNaming(archetypeId, role).slot.toLowerCase()}: ${name} (${tier})`, source, template });
        }
      }
    }
    // Ring/amulet icons are shared per template (not per archetype); one
    // representative archetype is enough to enumerate every tier's item.
    const rep = ARCHETYPES_BY_TEMPLATE[template][0]!;
    for (const role of SHEET_ONLY_ROLES) {
      for (const tier of EQUIPMENT_TIERS) {
        const source = gearIconSource(rep, role, tier);
        if (!source) continue;
        const name = gearItemName(rep, role, tier) ?? role;
        out.push({ label: `${TEMPLATE_LABEL[template]} ${ACCESSORY_SLOT_WORD[template][role].toLowerCase()}: ${name} (${tier})`, source, template });
      }
      out.push({ label: `${TEMPLATE_LABEL[template]} ${ACCESSORY_SLOT_WORD[template][role].toLowerCase()}: empty slot`, source: emptySlotIconSource(template, role), template });
    }
  }
  return out;
}

function mountIconsPanel(el: HTMLElement, _api: unknown): void {
  injectPanelStyle();
  el.innerHTML = '<p class="lt-note">Every gear item\'s inventory icon at every tier it exists at (render/gearIcon.ts), plus the four empty-slot silhouettes. Native size is InventoryScreen.tsx\'s 48px slot icon; the second canvas is 4x that box so the icon\'s own internal scale cap is reachable.</p>';
  el.insertBefore(buildArtControls(() => mountIconsPanel(el, _api)), el.firstChild);
  const grid = document.createElement("div");
  grid.className = "lt-icon-grid";
  el.appendChild(grid);

  for (const entry of collectIcons()) {
    const manifest = artManifest(entry.template);
    const card = document.createElement("div");
    card.className = "lt-icon-card";
    const label = document.createElement("div");
    label.className = "lt-icon-label";
    label.textContent = entry.label;
    card.appendChild(label);
    const row = document.createElement("div");
    row.className = "lt-icon-row";
    for (const px of [ICON_NATIVE_PX, ICON_ZOOM_PX]) {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      canvas.className = "lt-icon-canvas";
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const drew = renderGearIcon(ctx, entry.source, manifest, px);
      if (!drew) canvas.title = "missing sprite: draws nothing, same as the phone screen's text fallback";
      row.appendChild(canvas);
    }
    card.appendChild(row);
    grid.appendChild(card);
  }
}

// ===========================================================================
// Panel: Terrain. A preset 20x15 scene per template, raw versus run through
// the real applyDisplayTiles (variant scatter + edge substitution), with a
// seed control and an autotiling on/off toggle so before and after sit side
// by side.
// ===========================================================================

function presetTiles(template: TemplateGenre): TileId[][] {
  const base = FLOOR_TILE[template];
  const feature = template === "fantasy" ? "water" : "floor_grating";
  const secondary = template === "fantasy" ? "floor_stone" : "hazard_vent";
  const tiles: TileId[][] = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => base));
  // A pond/vent patch, roughly centred-left.
  for (let y = 4; y < 9; y++) for (let x = 3; x < 9; x++) if (tiles[y]) tiles[y]![x] = feature;
  // A stone/hazard patch, upper-right.
  for (let y = 1; y < 5; y++) for (let x = 13; x < 18; x++) if (tiles[y]) tiles[y]![x] = secondary;
  // A strip along the bottom.
  for (let x = 0; x < CELL_WIDTH; x++) if (tiles[CELL_HEIGHT - 1]) tiles[CELL_HEIGHT - 1]![x] = secondary;
  return tiles;
}

/** `pxScale` is canvas px PER SOURCE PIXEL, integer, same convention the Library uses. Tiles are 16 source px, so a tile occupies pxScale*16 canvas px. */
function paintRawTiles(ctx: CanvasRenderingContext2D, tiles: TileId[][], manifest: RenderManifest, pxScale: number): void {
  ctx.imageSmoothingEnabled = false;
  const pitch = spriteSizeOf(manifest); // source px per tile edge: 16 today, 32 for KayKit at 32 px
  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const sprite = manifest.tiles[row[x]!];
      if (!sprite) continue;
      for (let sy = 0; sy < sprite.pixels.length; sy++) {
        const prow = sprite.pixels[sy];
        if (!prow) continue;
        for (let sx = 0; sx < prow.length; sx++) {
          const idx = prow[sx];
          if (idx === undefined || idx === -1) continue;
          const color = manifest.palette[idx];
          if (!color) continue;
          ctx.fillStyle = color;
          ctx.fillRect((x * pitch + sx) * pxScale, (y * pitch + sy) * pxScale, pxScale, pxScale);
        }
      }
    }
  }
}

function mountTerrainPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  el.appendChild(buildArtControls(() => draw()));
  const controls = document.createElement("div");
  controls.className = "bn-controls";
  el.appendChild(controls);

  let template: TemplateGenre = "fantasy";
  let seed = 0;
  let autotile = true;
  // Per SOURCE pixel, integers only (see paintRawTiles).
  let scale = 2;

  const templateField = document.createElement("label");
  templateField.className = "bn-field";
  templateField.textContent = "Template ";
  templateField.appendChild(buildTemplateSelect((t) => { template = t; draw(); }));
  controls.appendChild(templateField);

  const seedField = document.createElement("label");
  seedField.className = "bn-field";
  seedField.textContent = "Seed ";
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = "0";
  seedInput.className = "bn-select";
  seedInput.style.width = "70px";
  seedInput.onchange = () => { seed = Number(seedInput.value) || 0; draw(); };
  seedField.appendChild(seedInput);
  controls.appendChild(seedField);

  const scaleField = document.createElement("label");
  scaleField.className = "bn-field";
  scaleField.textContent = "Scale ";
  scaleField.appendChild(buildScaleSelect([1, 2, 3], scale, (n) => { scale = n; draw(); }));
  controls.appendChild(scaleField);

  const toggleField = document.createElement("label");
  toggleField.className = "bn-field";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = true;
  toggle.onchange = () => { autotile = toggle.checked; draw(); };
  toggleField.appendChild(toggle);
  toggleField.appendChild(document.createTextNode(" Show autotiled ('after') alongside raw"));
  controls.appendChild(toggleField);

  const stage = document.createElement("div");
  stage.className = "lt-terrain-stage";
  el.appendChild(stage);

  const beforeWrap = document.createElement("div");
  beforeWrap.innerHTML = '<p class="lt-note">Raw (before)</p>';
  const beforeCanvas = document.createElement("canvas");
  beforeCanvas.className = "lt-canvas";
  beforeWrap.appendChild(beforeCanvas);
  stage.appendChild(beforeWrap);

  const afterWrap = document.createElement("div");
  afterWrap.innerHTML = '<p class="lt-note">applyDisplayTiles (after)</p>';
  const afterCanvas = document.createElement("canvas");
  afterCanvas.className = "lt-canvas";
  afterWrap.appendChild(afterCanvas);
  stage.appendChild(afterWrap);

  function draw() {
    const manifest = artManifest(template);
    const pitch = spriteSizeOf(manifest);
    const tiles = presetTiles(template);
    const w = CELL_WIDTH * pitch * scale;
    const h = CELL_HEIGHT * pitch * scale;

    beforeCanvas.width = w;
    beforeCanvas.height = h;
    const bctx = beforeCanvas.getContext("2d")!;
    bctx.clearRect(0, 0, w, h);
    paintRawTiles(bctx, tiles, manifest, scale);

    afterWrap.style.display = autotile ? "" : "none";
    if (autotile) {
      afterCanvas.width = w;
      afterCanvas.height = h;
      const actx = afterCanvas.getContext("2d")!;
      actx.clearRect(0, 0, w, h);
      const hasTile = (id: TileId) => manifest.tiles[id] !== undefined;
      const displayTiles = applyDisplayTiles(tiles, hasTile, seed);
      paintRawTiles(actx, displayTiles, manifest, scale);
    }
  }

  draw();
  return () => {};
}

// ===========================================================================
// Panel: Palette. Every entry, index/hex/luminance, glow band marked
// reserved.
// ===========================================================================

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

function mountPalettePanel(el: HTMLElement, _api: unknown): void {
  injectPanelStyle();
  el.innerHTML = "";
  for (const template of TEMPLATES) {
    const section = document.createElement("section");
    section.className = "lt-palette-section";
    const h = document.createElement("h3");
    h.textContent = `${TEMPLATE_LABEL[template]} palette (${PALETTE_BY_TEMPLATE[template].length} entries)`;
    section.appendChild(h);
    const table = document.createElement("table");
    table.className = "bn-meta-table lt-palette-table";
    const rows = PALETTE_BY_TEMPLATE[template]
      .map(([r, g, b], i) => {
        const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
        const lum = luminance(r, g, b);
        const reserved = i >= 48 && i <= 51;
        return `<tr${reserved ? ' class="lt-reserved"' : ""}><td>${i}</td><td><span class="lt-swatch" style="background:${hex}"></span> ${hex}</td><td>${lum}</td><td>${reserved ? "reserved (enchantment glow)" : ""}</td></tr>`;
      })
      .join("");
    table.innerHTML = `<thead><tr><td>index</td><td>hex</td><td>luminance</td><td></td></tr></thead><tbody>${rows}</tbody>`;
    section.appendChild(table);
    el.appendChild(section);
  }
}

// ===========================================================================
// Panel CSS. Injected once by the shell's own style tag convention isn't
// available to a registry module, so this panel-local stylesheet is added
// the same way the template's own EXAMPLE_ panel would: inline, scoped under
// #bench-root, tokens only.
// ===========================================================================

function injectPanelStyle(): void {
  if (document.getElementById("lt-bench-style")) return;
  const style = document.createElement("style");
  style.id = "lt-bench-style";
  style.textContent = `
#bench-root .lt-tier-grid{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
#bench-root .lt-stage{background-color:var(--bn-checker-a);background-image:linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%),linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%);background-size:16px 16px;background-position:0 0,8px 8px;border:1px solid var(--bn-line);border-radius:8px;padding:10px;display:inline-block;overflow:auto;max-width:100%}
#bench-root .lt-canvas{image-rendering:pixelated;display:block}
#bench-root .lt-note{color:var(--bn-muted);font-size:12.5px;max-width:74ch}
#bench-root .lt-icon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,264px),1fr));gap:10px;margin-top:10px}
#bench-root .lt-icon-card{background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:8px;padding:8px}
#bench-root .lt-icon-label{font-size:11.5px;color:var(--bn-muted);margin-bottom:6px;word-break:break-word}
#bench-root .lt-icon-row{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap}
#bench-root .lt-icon-canvas{image-rendering:pixelated;background-color:var(--bn-checker-a);background-image:linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%),linear-gradient(45deg,var(--bn-checker-b) 25%,transparent 25%,transparent 75%,var(--bn-checker-b) 75%);background-size:10px 10px;background-position:0 0,5px 5px;border:1px solid var(--bn-line);border-radius:4px}
#bench-root .lt-terrain-stage{display:flex;gap:14px;flex-wrap:wrap}
#bench-root .lt-terrain-stage>div{max-width:100%;overflow:auto}
#bench-root .lt-palette-section{margin-bottom:20px}
#bench-root .lt-palette-section h3{font-size:13px;margin:0 0 8px}
#bench-root .lt-palette-table{max-width:420px}
#bench-root .lt-swatch{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--bn-line);vertical-align:-2px}
#bench-root tr.lt-reserved{opacity:.75;font-style:italic}
#bench-root .lt-art-controls{padding:8px 10px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);margin-bottom:10px}
#bench-root .lt-art-controls [hidden]{display:none}
#bench-root .lt-art-status{margin:0;flex-basis:100%}
#bench-root .lt-conv-group{margin:12px 0}
#bench-root .lt-conv-group>h3,#bench-root .lt-conv-group>summary{font-size:13px;margin:0 0 8px;cursor:default}
#bench-root .lt-conv-group>summary{cursor:pointer}
#bench-root .lt-conv-grid{display:flex;flex-wrap:wrap;gap:8px}
#bench-root .lt-conv-card{background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px;max-width:100%}
#bench-root .lt-conv-pair{display:flex;gap:6px;align-items:flex-end}
#bench-root .lt-conv-canvas{image-rendering:pixelated}
#bench-root .lt-conv-gap{font-size:11px;color:var(--bn-danger);align-self:center}
#bench-root .lt-kk-controls{margin-top:-4px}
#bench-root .lt-kk-controls[hidden]{display:none}
#bench-root .lt-kk-note{flex-basis:100%;margin:0}
#bench-root .lt-kk-top{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;margin:4px 0 8px}
#bench-root .lt-kk-fig{margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:100%}
#bench-root .lt-kk-fig figcaption{font-size:12px;color:var(--bn-muted);max-width:34ch}
#bench-root .lt-kk-ref{display:block;width:192px;max-width:100%;height:auto;background:var(--bn-panel-alt);border:1px solid var(--bn-line);border-radius:8px}
#bench-root .lt-kk-grid{display:grid;grid-template-columns:minmax(120px,220px) repeat(var(--kk-cols),auto);gap:10px 12px;align-items:end;overflow-x:auto;max-width:100%;padding-bottom:6px}
#bench-root .lt-kk-colhead{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--bn-muted)}
#bench-root .lt-kk-rowhead{display:flex;flex-direction:column;gap:2px;font-size:12px;align-self:center}
#bench-root .lt-kk-rowhead span{color:var(--bn-muted);font-size:11.5px}
#bench-root .lt-kk-cell{border:1px solid var(--bn-line);border-radius:6px;background:var(--bn-panel-alt)}
@media (max-width:720px){#bench-root .lt-kk-grid{grid-template-columns:repeat(var(--kk-cols),auto)}#bench-root .lt-kk-grid>div:first-child{display:none}#bench-root .lt-kk-rowhead{grid-column:1 / -1}}
#bench-root .lt-play{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"view pad" "info pad";gap:12px 16px;align-items:start;margin:4px 0 8px}
#bench-root .lt-viewport{grid-area:view;overflow:auto;max-width:100%;max-height:min(64vh,560px);border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel-alt)}
#bench-root .lt-pad-area{grid-area:pad;display:flex;flex-direction:column;align-items:center;gap:12px;width:176px}
#bench-root .lt-info{grid-area:info;display:flex;flex-direction:column;gap:8px;min-width:0}
#bench-root .lt-dpad{display:grid;grid-template-columns:repeat(3,52px);grid-template-rows:repeat(3,52px);gap:4px}
#bench-root .lt-dpad-btn{display:grid;place-items:center;border:1px solid var(--bn-line);border-radius:10px;background:var(--bn-panel);color:var(--bn-text);cursor:pointer;touch-action:manipulation}
#bench-root .lt-dpad-btn:hover{border-color:var(--bn-accent)}
#bench-root .lt-dpad-btn:active{background:var(--bn-panel-alt)}
#bench-root .lt-dpad-btn svg{width:16px;height:22px;fill:currentColor}
#bench-root .lt-actions{display:flex;flex-direction:column;gap:6px;width:100%}
#bench-root .lt-act{font:inherit;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);color:var(--bn-text);cursor:pointer;touch-action:manipulation}
#bench-root .lt-act:hover{border-color:var(--bn-accent)}
#bench-root .lt-act-primary{background:var(--bn-accent);border-color:var(--bn-accent);color:var(--bn-accent-ink)}
#bench-root .lt-act kbd{font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:1px 6px;border:1px solid currentColor;border-radius:4px;opacity:.7}
#bench-root .lt-keys{margin:0;text-align:center}
#bench-root .lt-stats{display:flex;flex-wrap:wrap;gap:6px}
#bench-root .lt-stat{font-size:12px;padding:3px 9px;border:1px solid var(--bn-line);border-radius:999px;background:var(--bn-panel);font-variant-numeric:tabular-nums}
#bench-root .lt-stat-label{color:var(--bn-muted)}
#bench-root .lt-stat b{font-weight:600}
#bench-root .lt-stat-bad{border-color:var(--bn-danger)}
#bench-root .lt-stat-bad b{color:var(--bn-danger)}
#bench-root .lt-say{margin:0;font-size:13px;font-weight:600}
#bench-root .lt-log{max-height:210px;overflow:auto;padding:8px 10px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);display:flex;flex-direction:column;gap:4px;font-size:12.5px;line-height:1.45}
#bench-root .lt-log p{margin:0}
#bench-root .lt-log-empty{color:var(--bn-muted)}
#bench-root .lt-log-line.good{color:var(--bn-accent)}
#bench-root .lt-log-line.bad{color:var(--bn-danger)}
#bench-root .lt-gear{border-top:1px solid var(--bn-line);margin-top:14px;padding-top:4px}
#bench-root .lt-gear h3{font-size:13px;margin:14px 0 4px}
#bench-root .lt-gear .lt-note{margin:0 0 8px}
#bench-root .lt-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:8px}
#bench-root .lt-slot{font:inherit;text-align:left;display:grid;grid-template-columns:48px minmax(0,1fr);grid-template-rows:auto auto auto;column-gap:10px;align-items:center;padding:8px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);color:var(--bn-text);cursor:pointer;touch-action:none}
#bench-root .lt-slot>canvas{grid-row:1 / 4}
#bench-root .lt-slot-word{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--bn-muted)}
#bench-root .lt-slot-name{font-size:12.5px;font-weight:600;overflow-wrap:anywhere}
#bench-root .lt-tier{font-size:11px;color:var(--bn-muted)}
#bench-root .lt-tray{display:flex;flex-wrap:wrap;gap:6px;min-height:60px;padding:8px;border:1px dashed var(--bn-line);border-radius:8px}
#bench-root .lt-tray-empty{margin:0;align-self:center}
#bench-root .lt-chip{font:inherit;display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);color:var(--bn-text);cursor:grab;touch-action:none;text-align:left;max-width:100%}
#bench-root .lt-chip:hover{border-color:var(--bn-accent)}
#bench-root .lt-chip.is-worn{border-color:var(--bn-accent);box-shadow:inset 0 0 0 1px var(--bn-accent)}
#bench-root .lt-chip-text{display:flex;flex-direction:column;min-width:0}
#bench-root .lt-chip-name{font-size:12px;font-weight:600;overflow-wrap:anywhere}
#bench-root .lt-armoury-row{display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px;align-items:start;margin-bottom:8px}
#bench-root .lt-armoury-row>.lt-slot-word{padding-top:12px}
#bench-root .lt-armoury-chips{display:flex;flex-wrap:wrap;gap:6px}
#bench-root .lt-item-icon{image-rendering:pixelated;display:block;background:var(--bn-panel-alt);border-radius:6px}
#bench-root .lt-drop-ok{border-color:var(--bn-accent);box-shadow:0 0 0 2px var(--bn-accent)}
#bench-root .lt-drop-over{background:var(--bn-panel-alt)}
#bench-root .lt-drop-dim{opacity:.4}
#bench-root .lt-play button:focus-visible,#bench-root .lt-gear button:focus-visible{outline:2px solid var(--bn-focus);outline-offset:2px}
@media (max-width:720px){
#bench-root .lt-play{grid-template-columns:minmax(0,1fr);grid-template-areas:"view" "pad" "info"}
#bench-root .lt-viewport{max-height:38vh}
#bench-root .lt-pad-area{width:auto;flex-direction:row;flex-wrap:wrap;justify-content:center;align-items:flex-start}
#bench-root .lt-actions{width:150px}
#bench-root .lt-keys{display:none}
#bench-root .lt-armoury-row{grid-template-columns:minmax(0,1fr)}
#bench-root .lt-armoury-row>.lt-slot-word{padding-top:0}
}
`;
  document.head.appendChild(style);
}

// ===========================================================================
// The registry.
// ===========================================================================

export default {
  title: "Living Table Bench",
  source: "scripts/assets/fantasy.ts + scripts/assets/scifi.ts, built by scripts/asset-bench/build-bench.mjs",
  notes: [
    "Every sprite in both templates' SPRITES arrays, prefixed \"fantasy:\" or \"scifi:\" so the two id spaces " +
      "can never collide. Library groups follow the sprite id grammar in characters/equipmentTypes.ts: tiles, " +
      "props, tokens, gear overlays (weapon/outer/crown), boots, ring & amulet icons, and the four slot " +
      "silhouettes.",
    "The Character, Doll and Icons panels call the game's own renderPlanFor (menu/equipment.ts), renderCell " +
      "and compositeToken (render/canvasRenderer.ts, render/equipmentCompositor.ts), renderDoll (render/doll.ts) " +
      "and renderGearIcon (render/gearIcon.ts) directly, against a RenderManifest built straight from each " +
      "template's SPRITES + PALETTE. The Terrain panel calls the real applyDisplayTiles (render/terrainEdges.ts). " +
      "Nothing here redraws game logic; only the trivial indexed-pixel-to-canvas blit (paintRawTiles, for the " +
      "Terrain panel's 'raw' half, which has no real function to call since applyDisplayTiles IS the substitution " +
      "step) is local, and it mirrors the same one-line fillRect loop canvasRenderer.ts's own private drawSprite " +
      "and this template's shell.js drawAsset both already use.",
    "Every equipment tier offered in a control is one gearItemExists() reports as real for that archetype and " +
      "role; boots never offers legendary and ring/amulet always offer an explicit empty option, because that " +
      "is what the game itself allows. Slots are named the way the inventory screen names them (slotLabelFor, " +
      "ACCESSORY_SLOT_WORD), never by their storage keys: a Knight's `outer` is its shield and its `crown` is its " +
      "armour.",
    "The Character panel is playable. Walking, the room and the monster's turn are the bench's own and kept " +
      "simple (one tile per press, no initiative round, the container always opens). Everything with a number in " +
      "it is the game's: equipping goes through stageEquip / stageUnequip / commitLoadout (attunement cap " +
      "included); attacks through attackBlockedReason, resolveAttack, resolveDamage, damageMonster and " +
      "applyDamage, printed by attackLine; loot through lootFor and lootLine, two rolls per room as in play.",
  ],
  palettes: {
    fantasy: FANTASY_PALETTE,
    scifi: SCIFI_PALETTE,
  },
  backgrounds: [
    { id: "fantasy-grass", label: "Fantasy: grass floor", tile: "fantasy:floor_grass" },
    { id: "scifi-deckplate", label: "Sci-fi: deck plate floor", tile: "scifi:floor_deckplate" },
  ],
  assets,
  panels: [
    { id: "character", label: "Character", mount: mountCharacterPanel },
    { id: "kaykit", label: "KayKit", mount: mountKayKitPanel },
    { id: "converted", label: "Converted", mount: mountConvertedPanel },
    { id: "doll", label: "Doll", mount: mountDollPanel },
    { id: "icons", label: "Icons", mount: mountIconsPanel },
    { id: "terrain", label: "Terrain", mount: mountTerrainPanel },
    { id: "palette", label: "Palette", mount: mountPalettePanel },
  ],
};
