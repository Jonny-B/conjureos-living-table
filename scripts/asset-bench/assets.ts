/**
 * The Living Table asset bench registry.
 *
 * Five panels: Play (the game in miniature, turn based), Characters (the
 * animated cast), Pieces (every in-play sprite beside its KayKit version),
 * Gear (the paper doll and inventory icons) and Terrain (the autotiling).
 * The panels call the game's own render, rules and character functions BY
 * SYMBOL (renderPlanFor, renderCell, renderDoll,
 * renderGearIcon, applyDisplayTiles, the combat and inventory rules) so the
 * bench shows what ships, not a second drawing of it. The KayKit art rides in
 * as embedded data: the converted stills (kaykit.ts) and the animated cast
 * (cast.ts).
 *
 * Built with scripts/asset-bench/build-bench.mjs from the project root:
 *
 *   node scripts/asset-bench/build-bench.mjs \
 *     --assets scripts/asset-bench/assets.ts \
 *     --out .cache/asset-bench/living-table-bench.html \
 *     --artifact --data kaylib=... --data kaycast=...
 *
 * or `npm run bench`, which packs the KayKit data first.
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
  LOOT_CAP_LINE,
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
  type LoadoutDraft,
  type MagicTier,
  type SheetOnlyRole,
  type SlotRole,
} from "../../src/games/livingtable/characters/equipmentTypes";
import { PLAYABLE_ARCHETYPE_IDS, type TemplateGenre } from "../../src/games/livingtable/characters/templates";
import { createCharacter, type CharacterSheet } from "../../src/games/livingtable/characters/creation";
import { applyHealing } from "../../src/games/livingtable/characters/health";
import { parseDiceNotation, rollDice } from "../../src/games/livingtable/rules/dice";
import { renderPlanFor, slotLabelFor } from "../../src/games/livingtable/menu/equipment";
import { attackLine, bonusSources, lootLine, sentenceCase, type TokenNamer } from "../../src/games/livingtable/menu/labels";
import {
  FEET_PER_TILE,
  activeCombatant,
  attackBlockedReason,
  endTurn,
  isPlayersTurn,
  spendActiveAction,
  spendActiveMovement,
  startCombat,
  withActiveEconomy,
  type CombatRound,
} from "../../src/games/livingtable/menu/combatRound";
import { resolveAttack, resolveDamage } from "../../src/games/livingtable/rules/combat";
import { commitLoadout, draftFromSheet, stageEquip, stageUnequip } from "../../src/games/livingtable/rules/inventory";
import { lootFor } from "../../src/games/livingtable/rules/loot";
import {
  attackBonusSourcesFor,
  attackerBonusFor,
  damageMonster,
  effectiveArmorClass,
  effectiveSpeedFt,
  monsterArmorClassFor,
  statblockFor,
  weaponDamageNotationFor,
  weaponFor,
} from "../../src/games/livingtable/session/combat";
import { renderDoll } from "../../src/games/livingtable/render/doll";
import { renderGearIcon } from "../../src/games/livingtable/render/gearIcon";
import { renderCell, spriteSizeOf, type RenderManifest } from "../../src/games/livingtable/render/canvasRenderer";
import { headAnchor } from "../../src/games/livingtable/render/anchors";
import { attackResultToReadout } from "../../src/games/livingtable/render/rollReadoutAdapter";
import { resolveMonsterTurn } from "../../src/games/livingtable/session/hostileTurns";
import { attackEvents, type CombatEvent } from "../../src/games/livingtable/session/combatEvents";
import { createHud, createOverlay, verdictWords, type Hud, type HudAction, type HudBar, type InitiativeSide, type Overlay, type OverlayPoint, type TextStyle } from "./overlay";
import { createDiceTray, createSkinPicker, DICE_SKINS, type DiceTray, type DieKind } from "./dice";
import { decodeLibrary, kaykitLibrary, partFile } from "./kaykit";
import {
  CAST_CLIPS,
  CAST_DIRS,
  STEP_MS,
  actorAt,
  actorClip,
  actorFrame,
  castClipKey,
  castClipMs,
  castData,
  castDirToward,
  castFrameIndex,
  castFramesIfReady,
  castPrefetch,
  findCastClip,
  newActor,
  playClips,
  spriteClips,
  spritePose,
  startStep,
  stepBusy,
  type Actor,
  type CastCharacter,
  type CastClip,
  type CastClipId,
  type CastClipRequest,
  type CastDir,
  type CastGear,
  type CastSizeMeta,
  type CastStyle,
  type SpritePose,
} from "./cast";
import { applyDisplayTiles } from "../../src/games/livingtable/render/terrainEdges";
import { CELL_WIDTH, CELL_HEIGHT } from "../../src/games/livingtable/world/coordinates";
import type { CellLayout, PlacedProp, PlacedToken, TileId } from "../../src/games/livingtable/world/cell";
import { emptyWorld, getCell, setCell, visibleTilesFrom, type Playspace } from "../../src/games/livingtable/world/perception";
import { approachTile, fieldCostFt, movementField, pathTo, reachableTiles, type MovementField } from "../../src/games/livingtable/world/pathing";
import type { AssetManifest } from "../../src/games/livingtable/world/cell";
import type { CellCoord } from "../../src/games/livingtable/world/coordinates";
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
// current art (2x upscaled at 32 px), and the Pieces tab says which.
// ===========================================================================

type GroundStyle = "painted" | "lit";
type CharStyle = "bands" | "pixelart" | "toon" | "plain";
interface ArtChoice {
  source: "current" | "kaykit";
  ground: GroundStyle;
  chars: CharStyle;
  size: 16 | 32;
}

// KayKit first: it is the art under review. Without a converted library in the
// build, artManifest falls back to the current art on its own.
const art: ArtChoice = { source: "kaykit", ground: "painted", chars: "bands", size: 32 };
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
function buildArtControls(onChange: () => void, opts: { chars?: boolean } = {}): HTMLElement {
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

/**
 * The heroes a player can start as. The panels offer only these: the Healer
 * is out of play and sci-fi is paused (characters/templates.ts); their art
 * and rules stay in the game's files.
 */
function buildHeroSelect(value: ArchetypeId, onChange: (id: ArchetypeId) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "bn-select";
  for (const id of ARCHETYPES_BY_TEMPLATE.fantasy) {
    if (!PLAYABLE_ARCHETYPE_IDS.includes(id)) continue;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = ARCHETYPE_LABEL[id];
    select.appendChild(opt);
  }
  select.value = value;
  select.onchange = () => onChange(select.value as ArchetypeId);
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

// ===========================================================================
// Panel: Play. The game in miniature, turn based: a two-room scene with a
// door, a chest and a goblin. Click a square to walk there, the goblin to
// attack it, the door or the chest to use it. When the goblin notices the
// hero (it could reach the hero within MONSTER_WAKE_TILES steps) everyone
// rolls initiative, and from then on each side takes its turn.
//
// The game's own code, called by symbol:
//   turns     menu/combatRound.ts: startCombat, endTurn, the movement and
//             action economy, attackBlockedReason
//   moving    world/pathing.ts: movementField, pathTo, approachTile (the
//             reachable squares, the path, where to stand to strike)
//   monster   session/hostileTurns.ts resolveMonsterTurn on a World built from
//             the scene: it paths round walls and swings, and its events are
//             played back square by square
//   attacks   resolveAttack, resolveDamage, damageMonster, applyDamage,
//             attackLine, attackEvents (the floating numbers), headAnchor
//   healing   potionHealing + applyHealing (the hero carries two potions)
//   loot      lootFor + lootLine, on a kill and on opening the chest
//   gear      stageEquip / stageUnequip / commitLoadout
//   drawing   renderCell for the room; the animated cast (cast.ts) for the
//             figures; overlay.ts for every word on the board (banners, the
//             dialogue box, roll plates, floating numbers, the turn order)
//
// The bench's own: the room, the goblin's wake rule and its barks, door and
// chest use (free actions; the chest always opens, in the game it is a
// search check) and the potion stock.
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
  /** The fight, from the game's own combatRound.ts; null while exploring. */
  round: CombatRound | null;
  /** Healing potions left (the bench's own stock). */
  potions: number;
  /** Where the monster fell; the animated picture leaves its body there. */
  fallenAt: XY | null;
  /** What the hero and the monster are doing in the animated picture (cast.ts). Picture only: the rules never read these. */
  heroActor: Actor;
  monsterActor: Actor;
}

function freshHero(archetypeId: ArchetypeId): CharacterSheet {
  return createCharacter({ archetypeId, name: ARCHETYPE_LABEL[archetypeId], appearanceAssetId: bodySpriteId(archetypeId) });
}

/** A new scene. `keepGearOf` carries worn gear and the pack over (Reset scene), while hit points, the loot ledger, the door, the container and the monster all start again. */
function newPlay(template: TemplateGenre, archetypeId: ArchetypeId, floorId: TileId, keepGearOf?: CharacterSheet): PlayState {
  const fresh = freshHero(archetypeId);
  const hero = keepGearOf ? { ...fresh, equipment: keepGearOf.equipment, bag: keepGearOf.bag } : fresh;
  return {
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
    round: null,
    potions: HERO_POTIONS,
    fallenAt: null,
    heroActor: newActor("down"),
    monsterActor: newActor("left"),
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

function sceneLayout(p: PlayState, animated: boolean): CellLayout {
  // Animated, the panel draws the hero and the monster itself over the scene
  // (cast.ts); otherwise both are tokens the game's own renderCell composites.
  if (animated) return { tiles: sceneTiles(p), props: sceneProps(p), tokens: [], exits: [], sealed: true };
  const tokens: PlacedToken[] = [{ id: HERO_ID, assetId: bodySpriteId(p.archetypeId), x: p.heroAt.x, y: p.heroAt.y, kind: "pc" }];
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

// ---------------------------------------------------------------------------
// The turn rules. Everything with a number in it is the game's own: the round
// (menu/combatRound.ts), movement and paths (world/pathing.ts), the monster's
// whole turn (session/hostileTurns.ts resolveMonsterTurn, on a World built from
// this scene), attacks, damage, healing and loot. Each rule changes the scene
// at once and returns what happened as CombatEvents; the panel plays them back.
// ---------------------------------------------------------------------------

const SCENE_CELL: CellCoord = { cx: 0, cy: 0 };
/** The hero walks in with this many healing potions (the bench's own stock, so a heal has a source). */
const HERO_POTIONS = 2;
/** The game's monsters all move 30 ft (MonsterStatblock has no speed of its own yet). */
const MONSTER_SPEED_FT = 30;

interface TurnResult {
  events: CombatEvent[];
  /** Why nothing happened, in the player's words; null when it happened. */
  refused: string | null;
}
const refusedWith = (reason: string): TurnResult => ({ events: [], refused: reason });

/** The engine's view of a template's assets: tile walkability and blocking props from each sprite's own walkable flag, as manifestCache.ts builds it for the game. */
function worldManifestFor(template: TemplateGenre): AssetManifest {
  const m: AssetManifest = { tiles: {}, props: {}, tokens: {} };
  for (const s of SPRITES_BY_TEMPLATE[template]) {
    if (s.kind === "tile") m.tiles[s.assetId] = { walkable: s.walkable };
    else if (s.kind === "prop") m.props[s.assetId] = { blocks: !s.walkable };
    else m.tokens[s.assetId] = {};
  }
  return m;
}
const WORLD_MANIFEST: Record<TemplateGenre, AssetManifest> = { fantasy: worldManifestFor("fantasy"), scifi: worldManifestFor("scifi") };

/** The scene as the engine sees it: the room plus both figures as tokens. */
function engineLayout(p: PlayState): CellLayout {
  return sceneLayout(p, false);
}

function namerFor(p: PlayState): TokenNamer {
  return { playerTokenId: HERO_ID, playerName: p.hero.name, tokens: engineLayout(p).tokens };
}

function heroesTurn(p: PlayState): boolean {
  return p.round !== null && isPlayersTurn(p.round);
}

/** Feet the hero may still walk: unlimited while exploring, the turn's movement in a fight, nothing on someone else's turn. */
function heroBudgetFt(p: PlayState): number {
  if (!p.round) return Infinity;
  if (!isPlayersTurn(p.round)) return 0;
  return activeCombatant(p.round)?.economy.movementRemaining ?? 0;
}

function heroActionReady(p: PlayState): boolean {
  if (!p.round) return true;
  return isPlayersTurn(p.round) && activeCombatant(p.round)?.economy.action === true;
}

/** Every square the hero can walk to now, with what it costs. */
function heroField(p: PlayState): MovementField {
  return movementField(engineLayout(p), WORLD_MANIFEST[p.template], HERO_ID, p.heroAt, heroBudgetFt(p));
}

function heroReachTiles(p: PlayState): number {
  return weaponFor(p.hero).ranged ? DEFAULT_RANGED_REACH_TILES : DEFAULT_MELEE_REACH_TILES;
}

/** Why the hero cannot stand on `to`, in words. */
function blockedWords(p: PlayState, to: XY): string {
  const kit = SCENE_KIT[p.template];
  const blocked = terrainBlocks(p, sceneTiles(p), to);
  if (blocked === "door") return `${sentenceCase(kit.doorLabel)} is closed. Click it when you are next to it to open it.`;
  if (blocked === "container") return `${sentenceCase(kit.containerLabel)} is in the way.`;
  if (blocked) return "A wall. You cannot walk through it.";
  if (p.monster && same(p.monster.at, to)) return `${sentenceCase(monsterLabel(p))} is in the way.`;
  if (p.round && heroBudgetFt(p) < FEET_PER_TILE) return "No movement left this turn. Attack, or end your turn.";
  return p.round ? "Too far to walk this turn." : "You cannot get there from here.";
}

/** Whether the monster notices the hero: it could reach the hero within MONSTER_WAKE_TILES steps. That is when the fight starts. */
function monsterNotices(p: PlayState): boolean {
  const m = p.monster;
  if (!m || m.awake || heroDown(p)) return false;
  const path = pathToward(p, sceneTiles(p), m.at, p.heroAt);
  return path !== null && path.steps <= MONSTER_WAKE_TILES;
}

/** Roll initiative with the game's own startCombat: d20 plus Dexterity for the hero, the engine's fixed bonus for the monster. */
function startFight(p: PlayState): void {
  if (!p.monster) return;
  p.monster.awake = true;
  p.round = startCombat({
    player: { id: HERO_ID, label: p.hero.name, dexModifier: p.hero.modifiers.dex, speedFt: effectiveSpeedFt(p.hero) },
    hostiles: [{ id: MONSTER_ID, label: monsterLabel(p), speedFt: MONSTER_SPEED_FT }],
  });
  const order = p.round.order.map((c) => `${c.id === HERO_ID ? p.hero.name : sentenceCase(monsterLabel(p))} ${c.initiative}`).join(", ");
  p.log.push({ text: `Roll initiative! ${order}.`, tone: "plain" });
}

/** One square, as the engine allows it: next to the hero, open, within the turn's movement, and paid for in a fight. */
function heroStepTo(p: PlayState, to: XY): TurnResult {
  if (heroDown(p)) return refusedWith(DOWN_NOTE);
  if (p.round && !isPlayersTurn(p.round)) return refusedWith("Wait for your turn.");
  if (tileDistance(p.heroAt, to) !== 1) return refusedWith("One square at a time.");
  if (fieldCostFt(heroField(p), to) === undefined) return refusedWith(blockedWords(p, to));
  if (p.round) {
    const next = spendActiveMovement(p.round, FEET_PER_TILE);
    if (!next) return refusedWith(blockedWords(p, to));
    p.round = next;
  }
  const from = { ...p.heroAt };
  p.heroAt = { ...to };
  return { events: [{ kind: "move", tokenId: HERO_ID, from, path: [{ ...to }] }], refused: null };
}

/** The dice behind a swing, for the dice tray: the d20 and, on a hit, every damage die. */
interface SwingDice {
  roll: number;
  modifier: number;
  total: number;
  target: number;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  damage?: { rolls: number[]; sides: number; modifier: number; total: number };
}

/** Why the hero cannot swing at the monster right now (the game's reach, sight and turn rules), or null. */
function heroAttackRefusal(p: PlayState): string | null {
  if (heroDown(p)) return DOWN_NOTE;
  const m = p.monster;
  if (!m) return "Nothing left to fight. Press Reset scene to bring it back.";
  const blocked = attackBlockedReason({
    round: p.round,
    attackerAt: p.heroAt,
    targetAt: m.at,
    downed: false,
    reachTiles: heroReachTiles(p),
    hasLineOfSight: canSee(p, sceneTiles(p), p.heroAt, m.at),
  });
  return blocked ? sentence(blocked) : null;
}

/**
 * The hero's swing, rolled with the game's own dice but NOT yet applied, so
 * the dice tray can show the roll before the scene changes: `apply` lands the
 * blow (hit points, the log, a kill, the loot) and returns its events.
 */
function heroAttackRules(p: PlayState): { refused: string } | { refused: null; dice: SwingDice; apply: () => CombatEvent[] } {
  const refused = heroAttackRefusal(p);
  if (refused) return { refused };
  const m = p.monster!;
  const kit = SCENE_KIT[p.template];
  const label = monsterLabel(p);
  const bonus = attackerBonusFor(p.hero);
  const targetAC = monsterArmorClassFor(kit.monster);
  const sources = bonusSources(attackBonusSourcesFor(p.hero), bonus);
  const result = resolveAttack({ attackerBonus: bonus, targetAC });
  const notation = weaponDamageNotationFor(p.hero);
  const rolled = result.hit ? resolveDamage(notation, Math.random, result.critical) : null;
  const parsed = parseDiceNotation(notation);
  const dice: SwingDice = {
    roll: result.roll,
    modifier: bonus,
    total: result.total,
    target: targetAC,
    hit: result.hit,
    critical: result.critical,
    fumble: result.fumble,
    damage: rolled ? { rolls: rolled.rolls, sides: parsed.sides, modifier: parsed.modifier, total: rolled.total } : undefined,
  };
  const apply = (): CombatEvent[] => {
    const damage = rolled?.total;
    let down = false;
    const hpBefore = m.hp;
    if (damage !== undefined) {
      const hurt = damageMonster({ assetId: kit.monster, currentHp: m.hp }, damage);
      m.hp = hurt.currentHp;
      down = hurt.down;
    }
    if (p.round) p.round = spendActiveAction(p.round) ?? p.round;
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
        sources,
      }),
      tone: result.hit ? "good" : "bad",
    });
    const readout = { ...attackResultToReadout(result, bonus, targetAC, sources), caption: `${p.hero.name} attacks ${label}`, critical: result.critical, fumble: result.fumble };
    const events = attackEvents({ by: HERO_ID, against: MONSTER_ID, result, readout, damage, hpLost: hpBefore - m.hp, down });
    if (down) {
      p.fallenAt = { ...m.at };
      p.monster = null;
      p.round = null;
      rollLoot(p, "fight");
    }
    return events;
  };
  return { refused: null, dice, apply };
}

/** The door or the chest next to the hero. Free in a fight, like any small object interaction. */
function heroInteractRules(p: PlayState): TurnResult {
  if (heroDown(p)) return refusedWith(DOWN_NOTE);
  if (p.round && !isPlayersTurn(p.round)) return refusedWith("Wait for your turn.");
  const kit = SCENE_KIT[p.template];
  const near = (at: XY) => tileDistance(p.heroAt, at) <= 1;
  if (near(DOOR_AT)) {
    if (!p.doorOpen) {
      p.doorOpen = true;
      p.log.push({ text: `You open ${kit.doorLabel}.`, tone: "plain" });
    } else if (same(p.heroAt, DOOR_AT)) {
      return refusedWith("You are standing in the doorway. Step out of it first.");
    } else if (p.monster && same(p.monster.at, DOOR_AT)) {
      return refusedWith(`${sentenceCase(monsterLabel(p))} is standing in the doorway.`);
    } else {
      p.doorOpen = false;
      p.log.push({ text: `You close ${kit.doorLabel}.`, tone: "plain" });
    }
  } else if (near(CONTAINER_AT)) {
    if (p.searched) return refusedWith(`You already emptied ${kit.containerLabel}.`);
    p.searched = true;
    p.log.push({ text: `You open ${kit.containerLabel}.`, tone: "plain" });
    rollLoot(p, "container");
  } else {
    return refusedWith(`Nothing to use here. Stand next to ${kit.doorLabel} or ${kit.containerLabel}.`);
  }
  return { events: [], refused: null };
}

const POTION_NOTATION = "2d4+2";
/** The d4s the last potion rolled, for the dice tray. */
let lastPotionDice: number[] = [];

/** A healing potion, with the game's own Potion of Healing dice and applyHealing. It takes the action in a fight. */
function drinkPotionRules(p: PlayState): TurnResult {
  if (p.hero.dead) return refusedWith(DOWN_NOTE);
  if (p.potions <= 0) return refusedWith("No potions left.");
  if (p.round && !heroActionReady(p)) return refusedWith(p.round && !isPlayersTurn(p.round) ? "Wait for your turn." : "You have already taken your action this turn.");
  if (!heroDown(p) && p.hero.currentHp >= p.hero.maxHp) return refusedWith("You are already at full health.");
  const before = p.hero.currentHp;
  // characters/health.ts potionHealing's own notation (SRD 5.1 Potion of Healing), rolled here so the tray can show each die.
  const heal = rollDice(POTION_NOTATION);
  lastPotionDice = heal.rolls;
  const outcome = applyHealing(p.hero, heal.total);
  p.hero = outcome.sheet;
  p.potions--;
  if (p.round) p.round = spendActiveAction(p.round) ?? p.round;
  p.log.push({ text: `${p.hero.name} drinks a potion of healing. ${outcome.note}`, tone: "good" });
  return { events: [{ kind: "heal", tokenId: HERO_ID, amount: p.hero.currentHp - before }], refused: null };
}

/**
 * The monster's whole turn, by the game's own resolveMonsterTurn on a World
 * built from this scene: it paths round walls, walks what its movement pays
 * for and swings if it can. Returns the events and the scene it ends in,
 * WITHOUT applying them, so the panel can walk the monster square by square
 * and land the blow when the swing plays.
 */
function monsterTurnRules(p: PlayState): { events: CombatEvent[]; endAt: XY | null; sheet: CharacterSheet; lines: LogLine[] } {
  const m = p.monster;
  if (!m || !p.round) return { events: [], endAt: null, sheet: p.hero, lines: [] };
  const world = setCell(emptyWorld(), SCENE_CELL, engineLayout(p));
  const out = resolveMonsterTurn({
    world,
    cell: SCENE_CELL,
    manifest: WORLD_MANIFEST[p.template],
    monsterId: MONSTER_ID,
    playerTokenId: HERO_ID,
    sheet: p.hero,
    namer: namerFor(p),
    economy: activeCombatant(p.round)?.economy,
  });
  p.round = withActiveEconomy(p.round, out.economy);
  const after = getCell(out.world, SCENE_CELL)?.tokens.find((t) => t.id === MONSTER_ID);
  const lines: LogLine[] = [];
  const seen = new Set<string>();
  for (const l of out.lines) {
    seen.add(l.text);
    lines.push({ text: l.text, tone: l.hit ? "good" : "bad" });
  }
  for (const s of out.story) if (!seen.has(s)) lines.push({ text: sentence(s), tone: "plain" });
  return { events: out.events, endAt: after ? { x: after.x, y: after.y } : null, sheet: out.sheet, lines };
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

// ---------------------------------------------------------------------------
// The animated cast (cast.ts): which style is on show, and one figure drawn
// as its body plus whatever it wears, every piece the same clip, facing and
// frame, so they register pixel for pixel.
// ---------------------------------------------------------------------------

/** The heroes a player can start as today (characters/templates.ts). */
const PLAYABLE_HEROES: ArchetypeId[] = ARCHETYPES_BY_TEMPLATE.fantasy.filter((id) => PLAYABLE_ARCHETYPE_IDS.includes(id));

/** The cast in the Art row's character style (or the first one rendered), or null when the build has none. */
function castStyleNow(): CastStyle | null {
  const cast = castData();
  if (!cast) return null;
  return cast.styles.find((s) => s.style === art.chars) ?? cast.styles[0] ?? null;
}

function castEntry(style: CastStyle, tokenId: string): CastCharacter | null {
  return style.characters.find((c) => c.id === tokenId) ?? null;
}

interface WornLayer {
  gear: CastGear;
  remap: Readonly<Record<number, number>> | null;
}

/** What a hero sheet wears, as cast layers: renderPlanFor's sprite ids (the cast's gear ids are the same) with each tier's recolour. */
function wornLayers(style: CastStyle, sheet: CharacterSheet): WornLayer[] {
  const plan = renderPlanFor(sheet);
  if (!plan) return [];
  const byId = new Map(style.gear.map((g) => [g.id, g]));
  return plan.layers.flatMap((l) => {
    const gear = byId.get(l.spriteId);
    return gear ? [{ gear, remap: l.remap }] : [];
  });
}

/** A hero's starting kit (every base-tier piece), for the Characters tab. */
function starterLayers(style: CastStyle, entry: CastCharacter): WornLayer[] {
  if (entry.kind !== "hero") return [];
  const prefix = `gear_${entry.id.replace(/^token_/, "")}_`;
  return style.gear
    .filter((g) => (g.character ? g.character === entry.id : g.id.startsWith(prefix)) && g.tier === "base")
    .map((gear) => ({ gear, remap: null }));
}

// ---------------------------------------------------------------------------
// Figures kept hand-drawn: ids the KayKit library leaves out on purpose (its
// parts list them as gaps whose reason starts "kept hand-drawn"), so the
// game's own drawing shows wherever the KayKit art is on. The owner's call
// for the goblin, 2026-10-01. The bench moves the one drawing with
// spritePose (cast.ts), driven by the same Actor as the cast.
// ---------------------------------------------------------------------------

const KEPT_HAND_DRAWN = /^kept hand-drawn/;

/** Ids the KayKit library keeps hand-drawn, with the reason it gives. */
function keptHandDrawn(): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of kaykitLibrary() ?? []) {
    for (const g of part.gaps) if (KEPT_HAND_DRAWN.test(g.reason)) out.set(g.assetId, g.reason);
  }
  return out;
}

/** Clip timings shared by every hand-drawn figure. */
const SPRITE_ENTRY = spriteClips(["16", "32"]);

const tokenCanvases = new WeakMap<RenderManifest, Map<string, HTMLCanvasElement>>();

/** A manifest's token sprite as a canvas at its own resolution, washed with `tint` when given. Cached per manifest, id and tint. */
function tokenCanvas(manifest: RenderManifest, assetId: string, tint: string | null): HTMLCanvasElement | null {
  let cache = tokenCanvases.get(manifest);
  if (!cache) tokenCanvases.set(manifest, (cache = new Map()));
  const key = `${assetId}|${tint ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sprite = manifest.tokens[assetId];
  if (!sprite) return null;
  const h = sprite.pixels.length;
  const w = sprite.pixels[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = sprite.pixels[y]![x]!;
      if (idx < 0) continue;
      ctx.fillStyle = manifest.palette[idx] ?? "#ff00ff";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  if (tint) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
  }
  cache.set(key, canvas);
  return canvas;
}

/**
 * A hand-drawn figure in a pose, standing with its feet centred on
 * (feetX, feetY). `px16` is canvas pixels per 16 px sprite pixel, so a 16 px
 * drawing and its 2x upscale stand the same size. Lying down turns it about
 * its middle, so the body stays on its own tile.
 */
function drawSpriteFigure(ctx: CanvasRenderingContext2D, manifest: RenderManifest, assetId: string, pose: SpritePose, feetX: number, feetY: number, px16: number): boolean {
  const g = spriteGeometry(manifest, assetId, pose, feetX, feetY, px16);
  if (!g) return false;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(g.tx, g.ty);
  if (pose.lie > 0) ctx.rotate((pose.fall * pose.lie * Math.PI) / 2);
  ctx.drawImage(g.sprite, -g.w / 2, -g.h / 2, g.w, g.h);
  ctx.restore();
  return true;
}

/** Where drawSpriteFigure puts a hand-drawn figure (its centre, and its size on the canvas), and a box that holds it at any angle, so a panel can repaint just that patch. */
function spriteGeometry(
  manifest: RenderManifest,
  assetId: string,
  pose: SpritePose,
  feetX: number,
  feetY: number,
  px16: number,
): { sprite: HTMLCanvasElement; w: number; h: number; tx: number; ty: number; box: Box } | null {
  const sprite = tokenCanvas(manifest, assetId, pose.tint);
  if (!sprite) return null;
  const k = (px16 * 16) / spriteSizeOf(manifest);
  const w = sprite.width * k;
  const h = sprite.height * k;
  const tx = Math.round(feetX + pose.dx * px16);
  const ty = Math.round(feetY + pose.dy * px16 - h / 2 + (pose.lie * (h - w)) / 2);
  const reach = pose.lie > 0 ? Math.hypot(w, h) / 2 : null;
  const box = reach === null ? { x: tx - w / 2, y: ty - h / 2, w, h } : { x: tx - reach, y: ty - reach, w: reach * 2, h: reach * 2 };
  return { sprite, w, h, tx, ty, box };
}

// ===========================================================================
// The Play tab's drawing engine. Everything that puts the scene on the canvas
// lives here, apart from the panel's controls, so a different front end (a
// point-and-move board, say) can sit on it. In short:
//
//   ROOM    drawn once (the game's own renderCell, no tokens) into an
//           offscreen canvas and rebuilt only when tiles, props, art, detail
//           or zoom change. A frame is that bitmap with the figures over it;
//           only the patches a figure left and entered are redone.
//   FIGURE  never empty. Every clip it can play, in all four facings, is
//           decoded ahead for the hero (body and whatever it wears) and the
//           monster whenever the look changes (mount, gear, art, style,
//           detail, hero). Until a clip is ready the figure keeps its last
//           complete frame (or the old gear's animation, or a ready idle).
//   CAMERA  follows the hero's DRAWN position, glides, never reads the
//           logical tile, and does not scroll at all while the room fits.
//   PAINT   once per animation frame, from one rAF loop, and only when the
//           canvas would differ. Callers invalidate(); they never paint.
// ===========================================================================

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One figure's look: a style at a size, its body, and every piece it wears. */
interface FigureSet {
  style: CastStyle;
  entry: CastCharacter;
  size: string;
  meta: CastSizeMeta;
  layers: WornLayer[];
  /** Worn pieces in the cast's draw order for each facing, bottom first (the body is under them all). */
  byDir: Record<CastDir, WornLayer[]>;
  bodyOwner: string;
  /** Cache keys of a clip's pieces, body first, memoised per clip and facing; empty when the body lacks the clip. */
  keys: Map<string, string[]>;
}

function buildFigureSet(style: CastStyle, entry: CastCharacter, size: string, layers: WornLayer[]): FigureSet | null {
  const meta = entry.sizes[size];
  if (!meta) return null;
  const byDir = {} as Record<CastDir, WornLayer[]>;
  for (const dir of CAST_DIRS) {
    const order = (entry.archetype ? style.layerOrderByArchetype?.[entry.archetype]?.[dir] : undefined) ?? style.layerOrder[dir] ?? [];
    const rank = (role: string) => {
      const i = order.indexOf(role);
      return i < 0 ? order.length : i;
    };
    byDir[dir] = [...layers].sort((a, b) => rank(a.gear.role) - rank(b.gear.role));
  }
  return { style, entry, size, meta, layers, byDir, bodyOwner: `${style.style}|${entry.id}`, keys: new Map() };
}

function pieceKeys(set: FigureSet, clip: CastClipId, dir: CastDir): string[] {
  const id = `${clip}|${dir}`;
  let keys = set.keys.get(id);
  if (!keys) {
    keys = [];
    const body = findCastClip(set.entry, set.size, clip, dir);
    if (body) {
      keys.push(castClipKey(set.bodyOwner, body, null));
      for (const l of set.byDir[dir]) {
        const lc = findCastClip(l.gear, set.size, clip, dir);
        if (lc) keys.push(castClipKey(`${set.style.style}|${l.gear.id}`, lc, l.remap));
      }
    }
    set.keys.set(id, keys);
  }
  return keys;
}

/** One frame of a figure, body then each worn piece, as the canvases to stack; null unless every piece is decoded now. Never starts a decode. */
function setFrames(set: FigureSet, clip: CastClipId, dir: CastDir, frame: number): HTMLCanvasElement[] | null {
  const keys = pieceKeys(set, clip, dir);
  if (keys.length === 0) return null;
  const out: HTMLCanvasElement[] = [];
  for (const key of keys) {
    const frames = castFramesIfReady(key);
    if (!frames) return null;
    if (frames.length > 0) out.push(frames[Math.min(frame, frames.length - 1)]!);
  }
  return out;
}

/** The decode requests for these clips and facings, facings outermost so one facing's pieces arrive together. */
function clipRequests(set: FigureSet, clips: readonly CastClipId[], dirs: readonly CastDir[]): CastClipRequest[] {
  const out: CastClipRequest[] = [];
  for (const dir of dirs) {
    for (const clip of clips) {
      const body = findCastClip(set.entry, set.size, clip, dir);
      if (!body) continue;
      out.push({ ownerKey: set.bodyOwner, clip: body, meta: set.meta, remap: null });
      for (const l of set.byDir[dir]) {
        const lc = findCastClip(l.gear, set.size, clip, dir);
        if (lc) out.push({ ownerKey: `${set.style.style}|${l.gear.id}`, clip: lc, meta: set.meta, remap: l.remap });
      }
    }
  }
  return out;
}

/** What a figure last showed in full: the set it was drawn from and the exact canvases stacked. */
interface Shown {
  set: FigureSet;
  canvases: HTMLCanvasElement[];
}

/**
 * The frame to draw for a figure that wants `clip` at `frame` from `want`.
 * Never nothing once it has shown anything: the wanted look if its clip is
 * decoded; else the look it showed before (a gear or style change still
 * decoding keeps animating the old one); else the frozen last frame; and a
 * figure that has shown nothing yet takes any ready idle of the wanted look.
 */
function resolveCast(mem: { shown: Shown | null }, want: FigureSet | null, clip: CastClip, frame: number): Shown | null {
  if (want) {
    const canvases = setFrames(want, clip.clip, clip.dir, frame);
    if (canvases) return (mem.shown = { set: want, canvases });
  }
  const prev = mem.shown?.set;
  if (prev && prev !== want) {
    const canvases = setFrames(prev, clip.clip, clip.dir, frame);
    if (canvases) return (mem.shown = { set: prev, canvases });
  }
  if (mem.shown) return mem.shown;
  if (want) {
    for (const dir of [clip.dir, ...CAST_DIRS]) {
      const canvases = setFrames(want, "idle", dir, 0);
      if (canvases) return (mem.shown = { set: want, canvases });
    }
  }
  return null;
}

/** What one paint puts on the canvas for one figure. */
type StageItem =
  | { kind: "cast"; canvases: HTMLCanvasElement[]; x: number; y: number; w: number; h: number }
  | { kind: "sprite"; manifest: RenderManifest; assetId: string; pose: SpritePose; feetX: number; feetY: number; px16: number; box: Box };

function sameItems(a: readonly StageItem[], b: readonly StageItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.kind === "cast" && y.kind === "cast") {
      if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.canvases.length !== y.canvases.length) return false;
      for (let j = 0; j < x.canvases.length; j++) if (x.canvases[j] !== y.canvases[j]) return false;
    } else if (x.kind === "sprite" && y.kind === "sprite") {
      if (x.manifest !== y.manifest || x.assetId !== y.assetId || x.feetX !== y.feetX || x.feetY !== y.feetY || x.px16 !== y.px16) return false;
      if (x.pose.dx !== y.pose.dx || x.pose.dy !== y.pose.dy || x.pose.lie !== y.pose.lie || x.pose.fall !== y.pose.fall || x.pose.tint !== y.pose.tint) return false;
    } else {
      return false;
    }
  }
  return true;
}

function boxOf(item: StageItem): Box {
  return item.kind === "cast" ? { x: item.x, y: item.y, w: item.w, h: item.h } : item.box;
}

let nextManifestId = 1;
const manifestIds = new WeakMap<RenderManifest, number>();
function manifestId(m: RenderManifest): number {
  let id = manifestIds.get(m);
  if (id === undefined) manifestIds.set(m, (id = nextManifestId++));
  return id;
}

/** What the worn gear looks like, as a string: changes exactly when a figure would be dressed differently. */
function equipmentSig(hero: CharacterSheet): string {
  return GEAR_ROLES.map((r) => hero.equipment?.[r]?.tier ?? "-").join(",");
}

/** The cast style the scene animates with, or null for the static tokens (the current art, or no cast for this hero). */
function animatedStyle(p: PlayState): CastStyle | null {
  if (art.source !== "kaykit") return null;
  const style = castStyleNow();
  if (!style) return null;
  return castEntry(style, bodySpriteId(p.archetypeId)) ? style : null;
}

/** The monster's clip timings: its cast entry, or the hand-drawn figures' shared ones. */
function monsterTimingFor(p: PlayState, style: CastStyle | null): { clips: CastClip[] } {
  return (style ? castEntry(style, SCENE_KIT[p.template].monster) : null) ?? SPRITE_ENTRY;
}

interface PlayStageHost {
  viewport: HTMLElement;
  canvas: HTMLCanvasElement;
  state: () => PlayState;
  /** Canvas pixels per SOURCE pixel: the Zoom control. */
  zoom: () => number;
  /** Runs first in every frame, before anything is drawn: the panel's input and turn clock. */
  beforeFrame?: (now: number, dtMs: number) => void;
}

interface PlayStage {
  /** Something the picture shows has changed: it is drawn on the next frame, never now. */
  invalidate(): void;
  /** Put the camera on the hero this frame instead of gliding there (a new scene). A new zoom does this on its own. */
  snapCamera(): void;
  dispose(): void;
}

function createPlayStage(host: PlayStageHost): PlayStage {
  const { viewport, canvas } = host;
  const ctx = canvas.getContext("2d")!;
  let room: HTMLCanvasElement | null = null;
  let roomKey = "";
  /** Every pixel of the canvas needs redoing (new size, new room), not just the patches the figures moved over. */
  let full = true;
  let dirty = true;
  let items: StageItem[] = [];
  let boxes: Box[] = [];
  const memory = { hero: { shown: null as Shown | null }, monster: { shown: null as Shown | null } };
  let lookKey = "";
  let heroSet: FigureSet | null = null;
  let monsterSet: FigureSet | null = null;
  // The camera: where the hero was last kept in view, and whether the next frame jumps straight to it.
  const lastFocus = { x: Number.NaN, y: Number.NaN };
  let snap = true;
  let lastT = performance.now();
  let raf = 0;
  let alive = true;

  const invalidate = (): void => {
    dirty = true;
  };

  /** Re-decode what the figures need whenever the look changes: hero, gear, art, style or detail. Self-detecting, so no caller has to remember to. */
  function syncLook(p: PlayState, style: CastStyle | null, size: number): void {
    if (!style) {
      lookKey = "";
      heroSet = monsterSet = null;
      return;
    }
    // Until the KayKit library is decoded the scene draws at the current art's size; the real size comes next, so only the first clips are worth decoding now.
    const loading = art.source === "kaykit" && !artDecoded;
    const key = [loading ? "loading" : "ready", style.style, size, p.archetypeId, p.template, equipmentSig(p.hero)].join("|");
    if (key === lookKey) return;
    lookKey = key;
    const sz = String(size);
    const heroEntry = castEntry(style, bodySpriteId(p.archetypeId));
    const monEntry = castEntry(style, SCENE_KIT[p.template].monster);
    heroSet = heroEntry ? buildFigureSet(style, heroEntry, sz, wornLayers(style, p.hero)) : null;
    monsterSet = monEntry ? buildFigureSet(style, monEntry, sz, []) : null;
    const cast = castData();
    if (!cast) return;
    const first: CastClipId[] = ["idle", "walk"];
    const rest = CAST_CLIPS.filter((c) => c !== "idle" && c !== "walk");
    const facingFirst = (d: CastDir): CastDir[] => [d, ...CAST_DIRS.filter((x) => x !== d)];
    const heroDirs = facingFirst(p.heroActor.dir);
    const monDirs = facingFirst(p.monsterActor.dir);
    const requests: CastClipRequest[] = [];
    // What moves first, for the facing it is in; then everything else it can do.
    if (heroSet) requests.push(...clipRequests(heroSet, first, heroDirs));
    if (monsterSet) requests.push(...clipRequests(monsterSet, first, monDirs));
    if (!loading) {
      if (heroSet) requests.push(...clipRequests(heroSet, rest, heroDirs));
      if (monsterSet) requests.push(...clipRequests(monsterSet, rest, monDirs));
    }
    castPrefetch(cast.palette, requests, invalidate);
  }

  function buildRoom(p: PlayState, manifest: RenderManifest, tileScale: number, isAnimated: boolean, w: number, h: number): void {
    const layer = room ?? (room = document.createElement("canvas"));
    layer.width = w;
    layer.height = h;
    const rctx = layer.getContext("2d")!;
    rctx.imageSmoothingEnabled = false;
    const plan = renderPlanFor(p.hero);
    renderCell(rctx, sceneLayout(p, isAnimated), manifest, tileScale, 0, !isAnimated && plan ? { [HERO_ID]: plan } : undefined, 0);
  }

  /** Everything the room bitmap depends on. With the animated figures drawn over it that is the tiles, the props and the art; with static tokens it also holds them. */
  function roomKeyFor(p: PlayState, manifest: RenderManifest, tileScale: number, isAnimated: boolean): string {
    const scene = `${tileScale}|${p.template}|${p.floorId}|${p.doorOpen ? 1 : 0}|${p.searched ? 1 : 0}`;
    // Animated, the room is only tiles and props, which do not depend on the character style: switching it must not repaint the room.
    if (isAnimated) return `a|${art.ground}|${spriteSizeOf(manifest)}|${artDecoded ? 1 : 0}|${scene}`;
    return `${manifestId(manifest)}|${scene}|${p.archetypeId}|${p.heroAt.x},${p.heroAt.y}|${p.monster ? `${p.monster.at.x},${p.monster.at.y},${p.monster.hp}` : "-"}|${equipmentSig(p.hero)}`;
  }

  /**
   * The hero and the monster (or where it fell), back to front, each standing
   * in the game's one-tile footprint with its feet on the tile's bottom edge.
   * A monster with no cast entry (kept hand-drawn) is its own drawing, posed
   * by the same clips. Returns the hero's DRAWN position, which the camera follows.
   */
  function placeFigures(p: PlayState, now: number, style: CastStyle, manifest: RenderManifest, tileScale: number): { items: StageItem[]; hero: XY } {
    const size = String(spriteSizeOf(manifest));
    const monsterId = SCENE_KIT[p.template].monster;
    const monCast = castEntry(style, monsterId) !== null;
    interface Fig {
      id: "hero" | "monster";
      set: FigureSet | null;
      sprite: boolean;
      timing: { clips: CastClip[] };
      actor: Actor;
      at: XY;
      down: boolean;
    }
    const monster = (at: XY, down: boolean): Fig => ({ id: "monster", set: monsterSet, sprite: !monCast, timing: monsterTimingFor(p, style), actor: p.monsterActor, at, down });
    const figs: Fig[] = [];
    if (p.monster) figs.push(monster(p.monster.at, false));
    const heroFig: Fig | null = heroSet ? { id: "hero", set: heroSet, sprite: false, timing: heroSet.entry, actor: p.heroActor, at: p.heroAt, down: heroDown(p) } : null;
    if (heroFig) figs.push(heroFig);
    // Positions first, for all of them: actorAt lands a finished step, which actorClip then relies on.
    const placed = figs.map((f) => ({ f, pos: actorAt(f.actor, f.at, now) })).sort((a, b) => a.pos.y - b.pos.y);
    // The fallen monster lies under everything.
    if (!p.monster && p.fallenAt) placed.unshift({ f: monster(p.fallenAt, true), pos: p.fallenAt });
    const out: StageItem[] = [];
    let hero: XY = p.heroAt;
    for (const { f, pos } of placed) {
      if (f.id === "hero") hero = pos;
      const c = actorClip(f.actor, f.timing, size, f.down, now);
      if (!c) continue;
      const frame = REDUCED_MOTION ? 0 : actorFrame(f.actor, c, now);
      if (f.sprite) {
        const pose = spritePose(c.clip, frame, c.dir);
        const feetX = (pos.x + 0.5) * tileScale;
        const feetY = (pos.y + 1) * tileScale;
        const px16 = tileScale / 16;
        const g = spriteGeometry(manifest, monsterId, pose, feetX, feetY, px16);
        if (g) out.push({ kind: "sprite", manifest, assetId: monsterId, pose, feetX, feetY, px16, box: g.box });
        continue;
      }
      const shown = resolveCast(memory[f.id], f.set, c, frame);
      if (!shown) continue;
      // The frames are in their own resolution; a stale set from another detail still lands at the right size.
      const spx = tileScale / Number(shown.set.size);
      const m = shown.set.meta;
      out.push({
        kind: "cast",
        canvases: shown.canvases,
        x: Math.round((pos.x + 0.5) * tileScale - m.anchorX * spx),
        y: Math.round((pos.y + 1) * tileScale - m.anchorY * spx),
        w: Math.round(m.canvasW * spx),
        h: Math.round(m.canvasH * spx),
      });
    }
    return { items: out, hero };
  }

  function restore(b: Box): void {
    const x0 = Math.max(0, Math.floor(b.x) - 1);
    const y0 = Math.max(0, Math.floor(b.y) - 1);
    const x1 = Math.min(canvas.width, Math.ceil(b.x + b.w) + 1);
    const y1 = Math.min(canvas.height, Math.ceil(b.y + b.h) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(room!, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }

  function drawItem(it: StageItem): void {
    if (it.kind === "cast") {
      for (const c of it.canvases) ctx.drawImage(c, it.x, it.y, it.w, it.h);
    } else {
      drawSpriteFigure(ctx, it.manifest, it.assetId, it.pose, it.feetX, it.feetY, it.px16);
    }
  }

  /**
   * Keep the hero's DRAWN position inside the middle of the view: the view
   * moves only when the hero walks out of the middle 40 percent, and then by
   * exactly as far as the hero went, so it never lags, glides on after the
   * hero stops, or moves backward. An axis where the room fits never scrolls,
   * and while the hero stands still the player's own scrolling is left alone.
   */
  function follow(hero: XY, tileScale: number, w: number, h: number): void {
    const fx = (hero.x + 0.5) * tileScale;
    const fy = (hero.y + 0.5) * tileScale;
    if (!snap && fx === lastFocus.x && fy === lastFocus.y) return;
    lastFocus.x = fx;
    lastFocus.y = fy;
    const axis = (focus: number, view: number, world: number, current: number): number => {
      if (world <= view) return 0;
      const clamp = (v: number) => Math.max(0, Math.min(world - view, v));
      if (snap) return clamp(focus - view / 2);
      const margin = view * 0.3;
      if (focus - current < margin) return clamp(focus - margin);
      if (focus - current > view - margin) return clamp(focus - (view - margin));
      return current;
    };
    const nx = Math.round(axis(fx, viewport.clientWidth, w, viewport.scrollLeft));
    const ny = Math.round(axis(fy, viewport.clientHeight, h, viewport.scrollTop));
    snap = false;
    if (nx !== viewport.scrollLeft) viewport.scrollLeft = nx;
    if (ny !== viewport.scrollTop) viewport.scrollTop = ny;
  }

  function frame(): void {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(100, now - lastT);
    lastT = now;
    host.beforeFrame?.(now, dt);

    const p = host.state();
    const manifest = artManifest(p.template);
    const size = spriteSizeOf(manifest);
    const tileScale = host.zoom() * size;
    const w = CELL_WIDTH * tileScale;
    const h = CELL_HEIGHT * tileScale;
    const style = animatedStyle(p);
    syncLook(p, style, size);

    // The visible canvas keeps its size (and its pixels) unless the room changed size.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      full = true;
      snap = true;
    }
    const key = roomKeyFor(p, manifest, tileScale, style !== null);
    if (!room || key !== roomKey) {
      buildRoom(p, manifest, tileScale, style !== null, w, h);
      roomKey = key;
      full = true;
    }

    const placed = style ? placeFigures(p, now, style, manifest, tileScale) : { items: [] as StageItem[], hero: p.heroAt };
    if (full || dirty || !sameItems(items, placed.items)) {
      ctx.imageSmoothingEnabled = false;
      if (full) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(room!, 0, 0);
      } else {
        for (const b of boxes) restore(b);
      }
      for (const it of placed.items) drawItem(it);
      items = placed.items;
      boxes = placed.items.map(boxOf);
      full = false;
      dirty = false;
    }
    follow(placed.hero, tileScale, w, h);
  }
  raf = requestAnimationFrame(frame);

  return {
    invalidate,
    snapCamera: () => {
      snap = true;
    },
    dispose: () => {
      alive = false;
      cancelAnimationFrame(raf);
    },
  };
}

/** The on-screen text treatment, shared across visits to the tab: the owner is comparing the two. */
let textStyle: TextStyle = "pixel";
/** The dice skin on the tray, and whether the player taps to roll their own dice (on) or the tray rolls for them. */
let diceSkin = "bone";
let rollMyself = true;
/** Skins the player owns. Buying is not wired (a later product decision), so it is the free one. */
const OWNED_SKINS: readonly string[] = DICE_SKINS.filter((s) => s.priceCredits === 0).map((s) => s.id);

const signedNum = (n: number): string => (n >= 0 ? `+ ${n}` : `- ${-n}`);
const dieOf = (sides: number): DieKind => `d${sides}` as DieKind;

/** Things the goblin says, bench-only flavour (the game's DM has narration only). */
const GOBLIN_BARKS = {
  wake: ["Shinies! Give us the shinies!", "Intruder! Mine, mine, all mine!", "Hee hee. Fresh meat."],
  hurt: ["Ow! Nasty!", "Yaaagh!", "Not the face!"],
  dodge: ["Hah! Too slow!", "Missed me!"],
} as const;
const bark = (list: readonly string[]): string => list[Math.floor(Math.random() * list.length)]!;

function mountPlayPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  if (!play || !PLAYABLE_HEROES.includes(play.archetypeId)) play = newPlay("fantasy", PLAYABLE_HEROES[0]!, ROOM_FLOOR.fantasy);
  const st = (): PlayState => play!;

  // Per SOURCE pixel, integers only; renderCell's own unit is canvas px PER
  // TILE (scale x the art's sprite size), so 32 px art halves the default.
  const wide = typeof innerWidth === "number" && innerWidth >= 1100;
  const defaultScale = () => (artSpriteSize("fantasy") >= 32 ? (wide ? 2 : 1) : wide ? 3 : 2);
  let scale = defaultScale();
  let lastArtSize = artSpriteSize("fantasy");
  const tileScale = (): number => scale * artSpriteSize("fantasy");

  el.appendChild(
    buildArtControls(() => {
      const size = artSpriteSize("fantasy");
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
  const field = (label: string, control: HTMLElement): void => {
    const f = el_("label", "bn-field", `${label} `);
    f.appendChild(control);
    controls.appendChild(f);
  };
  const heroSelect = buildHeroSelect(st().archetypeId, (id) => {
    play = newPlay("fantasy", id, ROOM_FLOOR.fantasy);
    newScene();
  });
  field("Hero", heroSelect);
  const scaleSelect = buildScaleSelect([1, 2, 3, 4], scale, (n) => {
    scale = n;
    stage.invalidate();
    marksKey = "";
  });
  field("Zoom", scaleSelect);
  const textSelect = el_("select", "bn-select");
  for (const [v, label] of [["pixel", "Pixel"], ["storybook", "Storybook"]] as const) {
    const o = el_("option", undefined, label);
    o.value = v;
    textSelect.appendChild(o);
  }
  textSelect.value = textStyle;
  textSelect.onchange = () => {
    textStyle = textSelect.value as TextStyle;
    overlay.setStyle(textStyle);
    hud.setStyle(textStyle);
  };
  field("Text", textSelect);
  const rollBox = el_("input");
  rollBox.type = "checkbox";
  rollBox.checked = rollMyself;
  rollBox.onchange = () => {
    rollMyself = rollBox.checked;
  };
  const rollField = el_("label", "bn-field");
  rollField.append(rollBox, document.createTextNode(" I roll my own dice"));
  controls.appendChild(rollField);
  const resetBtn = el_("button", "bn-btn lt-reset", "Reset scene");
  resetBtn.type = "button";
  resetBtn.onclick = () => {
    const p = st();
    play = newPlay(p.template, p.archetypeId, p.floorId, p.hero);
    newScene();
  };
  controls.appendChild(resetBtn);
  // A chosen option must not keep the arrow keys: they walk the hero.
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === "SELECT") (t as HTMLSelectElement).blur();
  });

  el.appendChild(
    el_(
      "p",
      "lt-note lt-howto",
      "Click a square to walk there, the goblin to attack it, the door or the chest to use it. On a phone, tap once to see the path and again to go. Keys: arrows or WASD step, F attack, E use, Q potion, T end turn, Space skips the goblin's turn.",
    ),
  );

  // ---- the stage: the board, the marks over it, and the text overlay ---------

  const stageWrap = el_("div", "lt-stage-wrap");
  const viewport = el_("div", "lt-viewport");
  const board = el_("div", "lt-board");
  const canvas = el_("canvas", "lt-canvas");
  const marks = el_("canvas", "lt-marks");
  marks.setAttribute("aria-hidden", "true");
  board.append(canvas, marks);
  viewport.appendChild(board);
  stageWrap.appendChild(viewport);
  const arena = el_("div", "lt-arena lt-game");
  arena.setAttribute("aria-label", "The game");
  const trayCol = el_("div", "lt-tray-col");
  const trayHost = el_("div", "lt-dice-host");
  arena.append(stageWrap, trayCol);
  el.appendChild(arena);
  const shop = el_("details", "lt-dice-shop");
  shop.appendChild(el_("summary", undefined, "Dice skins (shop preview)"));
  const shopHost = el_("div");
  shop.appendChild(shopHost);
  el.appendChild(shop);
  const overlay: Overlay = createOverlay(stageWrap, textStyle);
  const tray: DiceTray = createDiceTray(trayHost, diceSkin);
  const hud: Hud = createHud(trayCol, textStyle, (id) => void onHudAction(id), { slot: trayHost });
  const picker = createSkinPicker(shopHost, tray, { owned: OWNED_SKINS, onTry: (id) => (diceSkin = id) });

  /** Wait for the player's tap on the tray (unless the tray rolls for them), then throw. */
  async function rollStep(prompt: string, dice: readonly { kind: DieKind; result: number }[], label: string, detail: string, tone: "good" | "bad" | "plain"): Promise<void> {
    if (rollMyself) await tray.awaitRoll(prompt, dice.map((d) => d.kind));
    await tray.roll({ dice, label, detail, tone });
  }

  // ---- gear ----------------------------------------------------------------

  const gear = el_("section", "lt-gear");
  el.appendChild(gear);
  gear.appendChild(el_("h3", undefined, "Worn"));
  gear.appendChild(el_("p", "lt-note", "Drop an item on its slot, or tap it, and the hero wears it. Tap a worn magic piece (or drag it to the pack) to take it off."));
  const slotsEl = el_("div", "lt-slots");
  gear.appendChild(slotsEl);
  gear.appendChild(el_("h3", undefined, "Pack"));
  const packEl = el_("div", "lt-tray");
  packEl.dataset.drop = "pack";
  gear.appendChild(packEl);
  gear.appendChild(el_("h3", undefined, "Armoury"));
  gear.appendChild(el_("p", "lt-note", "Every piece this hero can wear, at every tier. What you win in the scene lands in the pack."));
  const armouryEl = el_("div", "lt-armoury");
  gear.appendChild(armouryEl);

  // ---- where things are on screen --------------------------------------------

  /** The square under a pointer, or null off the board. */
  function tileAt(clientX: number, clientY: number): XY | null {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return null;
    const ts = tileScale();
    const x = Math.floor(((clientX - r.left) * (canvas.width / r.width)) / ts);
    const y = Math.floor(((clientY - r.top) * (canvas.height / r.height)) / ts);
    return x >= 0 && y >= 0 && x < CELL_WIDTH && y < CELL_HEIGHT ? { x, y } : null;
  }

  /** A point on the canvas, in the overlay host's CSS pixels (the board scrolls under the host). */
  function toHost(px: number, py: number): OverlayPoint {
    const r = canvas.getBoundingClientRect();
    const h = stageWrap.getBoundingClientRect();
    const k = r.width > 0 ? r.width / canvas.width : 1;
    return { x: r.left - h.left + px * k, y: r.top - h.top + py * k };
  }

  /** Over a figure's head, from the game's own headAnchor (the token's sprite height at the art's resolution). */
  function headOf(who: "hero" | "monster", tile?: XY): OverlayPoint {
    const p = st();
    const at = tile ?? (who === "hero" ? p.heroAt : (p.monster?.at ?? p.fallenAt ?? p.heroAt));
    const assetId = who === "hero" ? bodySpriteId(p.archetypeId) : SCENE_KIT[p.template].monster;
    const layout: CellLayout = { tiles: [], props: [], tokens: [{ id: who, assetId, x: at.x, y: at.y, kind: who === "hero" ? "pc" : "monster" }], exits: [], sealed: true };
    const a = headAnchor(layout, who, artManifest(p.template), tileScale());
    const ts = tileScale();
    return a ? toHost(a.x, a.y) : toHost((at.x + 0.5) * ts, at.y * ts);
  }

  // ---- plans: what a click on a square means -----------------------------------

  type Plan =
    | { kind: "walk"; path: XY[]; costFt: number; tile: XY }
    | { kind: "attack"; path: XY[]; costFt: number; tile: XY }
    | { kind: "use"; path: XY[]; costFt: number; tile: XY }
    | { kind: "none"; tile: XY; reason: string };

  function planFor(tile: XY): Plan {
    const p = st();
    if (heroDown(p)) return { kind: "none", tile, reason: DOWN_NOTE };
    if (p.round && !isPlayersTurn(p.round)) return { kind: "none", tile, reason: "Wait for your turn." };
    const field = heroField(p);
    const cost = (path: XY[]) => path.length * FEET_PER_TILE;
    if (p.monster && same(tile, p.monster.at)) {
      if (!heroActionReady(p)) return { kind: "none", tile, reason: "Your action is used. Press End turn (T)." };
      const sight = (from: XY, to: XY) => canSee(p, sceneTiles(p), from, to);
      const spot = approachTile(field, p.monster.at, heroReachTiles(p), sight);
      const path = spot ? pathTo(field, spot) : null;
      if (!path) return { kind: "none", tile, reason: p.round ? "You cannot reach it this turn." : "You cannot reach it from here." };
      return { kind: "attack", path, costFt: cost(path), tile };
    }
    const isDoor = same(tile, DOOR_AT);
    const isChest = same(tile, CONTAINER_AT);
    if (isChest || (isDoor && !p.doorOpen)) {
      const spot = approachTile(field, tile, 1);
      const path = spot ? pathTo(field, spot) : null;
      if (!path) return { kind: "none", tile, reason: p.round ? "Too far to reach this turn." : "You cannot get next to it from here." };
      return { kind: "use", path, costFt: cost(path), tile };
    }
    if (same(tile, p.heroAt)) return { kind: "none", tile, reason: "" };
    const path = pathTo(field, tile);
    if (!path) return { kind: "none", tile, reason: blockedWords(p, tile) };
    return { kind: "walk", path, costFt: cost(path), tile };
  }

  // ---- the marks: reachable squares, the path, the target ---------------------

  let hover: XY | null = null;
  /** On a touch screen the first tap only previews; this is the square it previewed. */
  let previewed: XY | null = null;
  let marksKey = "";

  function drawMarks(): void {
    const p = st();
    const ts = tileScale();
    const plan = !busy && hover ? planFor(hover) : null;
    const key = [canvas.width, canvas.height, ts, busy, walkQueue.length, p.heroAt.x, p.heroAt.y, p.monster ? `${p.monster.at.x},${p.monster.at.y}` : "-", p.doorOpen, p.searched, p.round ? `${p.round.activeIndex},${p.round.roundNumber},${activeCombatant(p.round)?.economy.movementRemaining},${activeCombatant(p.round)?.economy.action}` : "x", hover ? `${hover.x},${hover.y}` : "-", heroDown(p)].join("|");
    if (key === marksKey) return;
    marksKey = key;
    if (marks.width !== canvas.width || marks.height !== canvas.height) {
      marks.width = canvas.width;
      marks.height = canvas.height;
    }
    const ctx = marks.getContext("2d")!;
    ctx.clearRect(0, 0, marks.width, marks.height);
    if (busy || walkQueue.length > 0 || heroDown(p)) return;
    // The squares this turn's movement reaches, in a fight.
    if (heroesTurn(p)) {
      ctx.fillStyle = "rgba(110, 170, 255, 0.16)";
      ctx.strokeStyle = "rgba(150, 200, 255, 0.35)";
      ctx.lineWidth = 1;
      for (const t of reachableTiles(heroField(p))) {
        ctx.fillRect(t.x * ts + 1, t.y * ts + 1, ts - 2, ts - 2);
      }
    }
    // The goblin, outlined when the hero could hit it this turn.
    if (p.monster && heroActionReady(p)) {
      const reach = tileDistance(p.heroAt, p.monster.at) <= heroReachTiles(p);
      ctx.strokeStyle = reach ? "rgba(235, 70, 60, 0.95)" : "rgba(235, 70, 60, 0.45)";
      ctx.lineWidth = Math.max(2, ts / 16);
      ctx.setLineDash(reach ? [] : [ts / 6, ts / 8]);
      ctx.strokeRect(p.monster.at.x * ts + 2, p.monster.at.y * ts + 2, ts - 4, ts - 4);
      ctx.setLineDash([]);
    }
    if (!plan || plan.kind === "none") {
      if (plan && plan.reason && hover) {
        ctx.strokeStyle = "rgba(235, 70, 60, 0.7)";
        ctx.lineWidth = 2;
        ctx.strokeRect(hover.x * ts + 3, hover.y * ts + 3, ts - 6, ts - 6);
      }
      return;
    }
    // The path as dots, its end as a ring, and its length in feet.
    const colour = plan.kind === "attack" ? "rgba(255, 120, 90, 0.95)" : plan.kind === "use" ? "rgba(255, 205, 90, 0.95)" : "rgba(255, 245, 210, 0.95)";
    ctx.fillStyle = colour;
    for (const t of plan.path) {
      ctx.beginPath();
      ctx.arc((t.x + 0.5) * ts, (t.y + 0.5) * ts, Math.max(2, ts / 10), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(2, ts / 14);
    ctx.strokeRect(plan.tile.x * ts + 3, plan.tile.y * ts + 3, ts - 6, ts - 6);
    const words = plan.kind === "attack" ? (plan.costFt ? `${plan.costFt} ft, attack` : "Attack") : plan.kind === "use" ? (plan.costFt ? `${plan.costFt} ft, use` : "Use") : `${plan.costFt} ft`;
    const end = plan.path[plan.path.length - 1] ?? plan.tile;
    const fontPx = Math.max(11, Math.round(ts / 4));
    ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const tx = (end.x + 0.5) * ts;
    const ty = end.y * ts + 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(20, 16, 24, 0.9)";
    ctx.strokeText(words, tx, ty);
    ctx.fillStyle = "#fff6dc";
    ctx.fillText(words, tx, ty);
  }

  // ---- doing things --------------------------------------------------------

  /** Squares still to walk, and what to do on arrival. */
  const walkQueue: XY[] = [];
  let onArrive: (() => Promise<void>) | null = null;
  /** True while the game is playing something back (a monster's turn, a banner): input waits. */
  let busy = false;
  let skipping = false;

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (skipping || REDUCED_MOTION) return resolve();
      const t0 = performance.now();
      const tick = () => (skipping || performance.now() - t0 >= ms ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });

  /** Show every new line of the story in the dialogue box. */
  let said = 0;
  function flushLog(): void {
    const p = st();
    if (said > p.log.length) said = 0;
    for (const line of p.log.slice(said)) overlay.say({ text: line.text, tone: line.tone });
    said = p.log.length;
    if (p.log.length > LOG_KEEP) {
      p.log.splice(0, p.log.length - LOG_KEEP);
      said = p.log.length;
    }
  }

  function refuse(reason: string): void {
    if (reason) overlay.toast(reason);
  }

  function stepAnim(actor: Actor, from: XY, to: XY): void {
    const now = performance.now();
    actor.dir = castDirToward(to.x - from.x, to.y - from.y);
    if (REDUCED_MOTION) return;
    startStep(actor, actorAt(actor, from, now), now);
    playClips(actor, ["walk"], now);
  }

  /** Float an attack's outcome over the target's head (the dice themselves are in the tray). */
  function showAttack(events: readonly CombatEvent[], target: "hero" | "monster", targetTile?: XY): void {
    for (const ev of events) {
      if (ev.kind === "damage") {
        if (ev.hpLost > 0) overlay.float(headOf(target, targetTile), ev.critical ? `-${ev.hpLost} CRIT!` : `-${ev.hpLost}`, ev.critical ? "crit" : "damage");
        else overlay.float(headOf(target, targetTile), "DEATH SAVE", "info");
      } else if (ev.kind === "miss") overlay.float(headOf(target, targetTile), "MISS", "miss");
      else if (ev.kind === "down") overlay.float(headOf(target, targetTile), "DOWN", "down");
      else if (ev.kind === "heal") overlay.float(headOf(target), `+${ev.amount}`, "heal");
    }
  }

  async function beginFight(): Promise<void> {
    const p = st();
    if (p.round || !p.monster) return;
    busy = true;
    walkQueue.length = 0;
    onArrive = null;
    startFight(p);
    p.monsterActor.dir = castDirToward(p.heroAt.x - p.monster.at.x, p.heroAt.y - p.monster.at.y);
    overlay.say({ speaker: "Goblin", text: bark(GOBLIN_BARKS.wake), tone: "bad" });
    flushLog();
    refreshAll();
    void overlay.banner("ROLL INITIATIVE", "initiative");
    // The hero's own initiative die: the total startCombat rolled, less the Dexterity it added.
    // startFight just set the round (read it fresh: TypeScript still sees it as null from the check above).
    const mine = st().round?.order.find((c) => c.id === HERO_ID);
    if (mine) {
      const d20 = mine.initiative - p.hero.modifiers.dex;
      await rollStep("Tap to roll initiative", [{ kind: "d20", result: d20 }], `${d20} ${signedNum(p.hero.modifiers.dex)} = ${mine.initiative}`, "INITIATIVE", "plain");
    }
    busy = false;
    await runHostiles();
  }

  /** Every turn that is not the hero's, played back, until it is the hero's turn again or the fight is over. */
  async function runHostiles(): Promise<void> {
    let p = st();
    if (!p.round) return;
    if (isPlayersTurn(p.round)) {
      refreshAll();
      await overlay.banner("YOUR TURN", "turn");
      return;
    }
    busy = true;
    skipping = false;
    refreshAll();
    while (p.round && !isPlayersTurn(p.round) && p.monster) {
      await overlay.banner(`${statblockFor(SCENE_KIT[p.template].monster).name.toUpperCase()}'S TURN`, "enemy");
      const start = { ...p.monster.at };
      const turn = monsterTurnRules(p);
      // Walk it square by square along the engine's own path.
      const move = turn.events.find((e): e is Extract<CombatEvent, { kind: "move" }> => e.kind === "move");
      let from = start;
      for (const sq of move?.path ?? []) {
        if (!p.monster) break;
        stepAnim(p.monsterActor, from, sq);
        p.monster.at = { ...sq };
        refreshAll();
        await wait(STEP_MS);
        from = sq;
      }
      if (p.monster && turn.endAt) p.monster.at = turn.endAt;
      // Then the swing, and the blow lands when it plays.
      const swing = turn.events.filter((e) => e.kind !== "move" && e.kind !== "turnStart");
      if (swing.length > 0 && p.monster) {
        const atk = swing.find((e): e is Extract<CombatEvent, { kind: "attack" }> => e.kind === "attack");
        const dmg = swing.find((e): e is Extract<CombatEvent, { kind: "damage" }> => e.kind === "damage");
        if (atk) {
          const r0 = atk.readout;
          await tray.roll({
            dice: [{ kind: "d20", result: r0.roll }],
            label: `Goblin: ${r0.roll} ${signedNum(r0.modifier)} = ${r0.total} vs ${r0.target}`,
            detail: dmg ? `${verdictWords({ hit: true, critical: dmg.critical, fumble: false })}, ${dmg.amount} DAMAGE` : verdictWords({ hit: false, critical: false, fumble: !!r0.fumble }),
            tone: r0.hit ? "bad" : "good",
          });
        }
        p.monsterActor.dir = castDirToward(p.heroAt.x - p.monster.at.x, p.heroAt.y - p.monster.at.y);
        if (!REDUCED_MOTION) playClips(p.monsterActor, ["attack"], performance.now());
        await wait(320);
        const hpBefore = p.hero.currentHp;
        p.hero = turn.sheet;
        showAttack(swing, "hero");
        const now = performance.now();
        if (!REDUCED_MOTION && p.hero.currentHp < hpBefore) playClips(p.heroActor, [heroDown(p) ? "death" : "hit"], now);
        if (swing.some((e) => e.kind === "miss")) overlay.say({ speaker: "Goblin", text: "Grr! Hold still!", tone: "plain" });
      } else {
        p.hero = turn.sheet;
      }
      p.log.push(...turn.lines);
      flushLog();
      refreshAll();
      await wait(650);
      if (heroDown(p)) {
        p.round = null;
        refreshAll();
        await overlay.banner("DEFEAT", "defeat");
        overlay.say({ text: DOWN_NOTE, tone: "bad" });
        break;
      }
      p.round = endTurn(p.round!);
      p = st();
    }
    busy = false;
    skipping = false;
    refreshAll();
    if (p.round && isPlayersTurn(p.round)) await overlay.banner("YOUR TURN", "turn");
  }

  /** After anything the hero does: a kill ends the fight, a step may wake the goblin. */
  async function afterHeroAction(): Promise<void> {
    const p = st();
    flushLog();
    refreshAll();
    if (!p.monster && p.fallenAt && !p.round && fightWasOn) {
      fightWasOn = false;
      await overlay.banner("VICTORY", "victory");
    }
    if (!p.round && monsterNotices(p)) await beginFight();
  }
  let fightWasOn = false;

  /** One square of a walk (a click's path, or a key). False when it was refused, which ends the walk. */
  function takeStep(to: XY): boolean {
    const p = st();
    const from = { ...p.heroAt };
    const r = heroStepTo(p, to);
    if (r.refused) {
      refuse(r.refused);
      return false;
    }
    stepAnim(p.heroActor, from, to);
    stage.invalidate();
    return true;
  }

  /** Every frame, before drawing: the next square of a walk once the last has landed, then whatever waited for arrival. */
  function pump(now: number): void {
    drawMarks();
    // The HUD follows every change of turn state (it redraws only when what it shows changed).
    renderHud();
    if (busy) return;
    const h = st().heroActor;
    if (stepBusy(h, now)) return;
    if (walkQueue.length > 0) {
      const next = walkQueue.shift()!;
      if (!takeStep(next)) {
        walkQueue.length = 0;
        onArrive = null;
      }
      // A step that brings the goblin's notice ends the walk where it stands.
      const p = st();
      if (!p.round && monsterNotices(p)) {
        walkQueue.length = 0;
        onArrive = null;
        void afterHeroAction();
      } else if (walkQueue.length === 0) {
        refreshAll();
      }
      return;
    }
    if (onArrive) {
      const run = onArrive;
      onArrive = null;
      void run();
    }
  }

  async function heroAttackFlow(): Promise<void> {
    const p = st();
    if (!p.monster) return refuse("Nothing left to fight.");
    if (!p.round) {
      // Attacking a goblin that has not noticed you still starts the fight; you swing on your turn.
      await beginFight();
      if (!heroesTurn(st())) return;
    }
    const target = { ...p.monster.at };
    const r = heroAttackRules(p);
    if (r.refused !== null) return refuse(r.refused);
    fightWasOn = true;
    busy = true;
    const d = r.dice;
    // The attack roll: the engine has rolled it; the player throws the die and sees it land.
    await rollStep("Tap to roll your attack", [{ kind: "d20", result: d.roll }], `${d.roll} ${signedNum(d.modifier)} = ${d.total} vs ${d.target}`, verdictWords(d), d.hit ? "good" : "bad");
    p.heroActor.dir = castDirToward(target.x - p.heroAt.x, target.y - p.heroAt.y);
    if (!REDUCED_MOTION) playClips(p.heroActor, ["attack"], performance.now());
    await wait(300);
    if (d.damage) {
      const dmg = d.damage;
      await rollStep(
        d.critical ? "Critical! Tap to roll double damage" : "Tap to roll damage",
        dmg.rolls.map((v) => ({ kind: dieOf(dmg.sides), result: v })),
        `${dmg.rolls.join(" + ")} ${signedNum(dmg.modifier)} = ${dmg.total}`,
        d.critical ? "CRITICAL DAMAGE" : "DAMAGE",
        "good",
      );
    }
    const events = r.apply();
    showAttack(events, "monster", target);
    const hit = events.some((e) => e.kind === "damage");
    const now = performance.now();
    if (!REDUCED_MOTION) {
      if (!p.monster) playClips(p.monsterActor, ["death"], now);
      else if (hit) playClips(p.monsterActor, ["hit"], now);
    }
    if (p.monster && hit && Math.random() < 0.6) overlay.say({ speaker: "Goblin", text: bark(GOBLIN_BARKS.hurt), tone: "good" });
    if (p.monster && !hit && Math.random() < 0.6) overlay.say({ speaker: "Goblin", text: bark(GOBLIN_BARKS.dodge), tone: "bad" });
    if (!p.monster && !REDUCED_MOTION) playClips(p.heroActor, ["cheer"], now + 400);
    busy = false;
    await afterHeroAction();
  }

  /** Walk a plan's path, then do what it was for. */
  function runPlan(plan: Plan): void {
    if (plan.kind === "none") return refuse(plan.reason);
    walkQueue.length = 0;
    walkQueue.push(...plan.path);
    onArrive =
      plan.kind === "attack"
        ? heroAttackFlow
        : plan.kind === "use"
          ? async () => {
              const r = heroInteractRules(st());
              if (r.refused) return refuse(r.refused);
              if (!REDUCED_MOTION) playClips(st().heroActor, ["interact"], performance.now());
              stage.invalidate();
              await afterHeroAction();
            }
          : async () => {
              await afterHeroAction();
            };
  }

  async function attackGoblin(): Promise<void> {
    if (busy) return;
    const p = st();
    if (!p.monster) return refuse("Nothing left to fight. Press Reset scene to bring it back.");
    runPlan(planFor(p.monster.at));
  }

  async function useNearby(): Promise<void> {
    if (busy) return;
    const p = st();
    const r = heroInteractRules(p);
    if (r.refused) return refuse(r.refused);
    if (!REDUCED_MOTION) playClips(p.heroActor, ["interact"], performance.now());
    stage.invalidate();
    await afterHeroAction();
  }

  async function drinkPotion(): Promise<void> {
    if (busy) return;
    const p = st();
    const r = drinkPotionRules(p);
    if (r.refused) return refuse(r.refused);
    busy = true;
    const heal = r.events.find((e): e is Extract<CombatEvent, { kind: "heal" }> => e.kind === "heal");
    const rolls = lastPotionDice;
    await rollStep("Tap to roll healing", rolls.map((v) => ({ kind: "d4" as DieKind, result: v })), `${rolls.join(" + ")} + 2 = ${rolls.reduce((a, b) => a + b, 2)}`, heal ? `+${heal.amount} HP` : "HEALED", "good");
    busy = false;
    if (!REDUCED_MOTION) playClips(p.heroActor, ["cheer"], performance.now());
    showAttack(r.events, "hero");
    await afterHeroAction();
  }

  async function endTurnFlow(): Promise<void> {
    const p = st();
    if (busy || !p.round || !isPlayersTurn(p.round)) return refuse(p.round ? "Wait for your turn." : "There is no fight on. Your turn ends when the goblin notices you.");
    walkQueue.length = 0;
    onArrive = null;
    p.round = endTurn(p.round);
    await runHostiles();
  }

  // ---- pointer ---------------------------------------------------------------

  viewport.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const t = tileAt(e.clientX, e.clientY);
    if ((t?.x ?? -1) !== (hover?.x ?? -1) || (t?.y ?? -1) !== (hover?.y ?? -1)) hover = t;
    const plan = t && !busy ? planFor(t) : null;
    viewport.style.cursor = !plan ? "default" : plan.kind === "attack" ? "crosshair" : plan.kind === "none" ? "not-allowed" : "pointer";
  });
  viewport.addEventListener("pointerleave", () => {
    hover = null;
  });
  viewport.addEventListener("click", (e) => {
    if (busy) {
      skipping = true;
      tray.skip();
      return;
    }
    const t = tileAt(e.clientX, e.clientY);
    if (!t) return;
    const touch = (e as PointerEvent).pointerType === "touch";
    if (touch && !(previewed && same(previewed, t))) {
      // First tap on a phone: show the path; the second tap on the same square goes.
      previewed = t;
      hover = t;
      return;
    }
    previewed = null;
    hover = touch ? null : t;
    runPlan(planFor(t));
  });

  // ---- the readout -------------------------------------------------------------

  async function onHudAction(id: string): Promise<void> {
    if (id === "attack") return attackGoblin();
    if (id === "use") return useNearby();
    if (id === "potion") return drinkPotion();
    if (id === "end") return endTurnFlow();
  }

  /** Whose turn it is, what is left of it, everyone's hit points and the buttons: the game window's own readout. */
  function renderHud(): void {
    const p = st();
    const h = p.hero;
    const block = statblockFor(SCENE_KIT[p.template].monster);
    const c = p.round ? activeCombatant(p.round) : undefined;
    const mine = heroesTurn(p);
    let title: string;
    const lines: string[] = [];
    if (heroDown(p)) title = "You are down";
    else if (!p.round) title = p.monster ? "Exploring" : `The ${block.name.toLowerCase()} is down`;
    else if (mine) title = `Round ${p.round.roundNumber}: your turn`;
    else title = `Round ${p.round.roundNumber}: ${block.name.toLowerCase()}'s turn`;
    if (mine && c) {
      lines.push(`Move: ${c.economy.movementRemaining} ft left`, `Action: ${c.economy.action ? "ready" : "used"}`);
    } else if (!p.round && !heroDown(p)) {
      lines.push(p.monster ? "Click a square to walk" : "Open the chest, or Reset scene");
    } else if (p.round && !mine) {
      lines.push("Space or a click skips");
    }
    const bonus = attackerBonusFor(h);
    lines.push(`AC ${effectiveArmorClass(h)}, hit ${bonus >= 0 ? "+" : ""}${bonus}, ${weaponDamageNotationFor(h)}`);
    const bars: HudBar[] = [{ id: HERO_ID, label: h.name, hp: h.currentHp, max: h.maxHp, side: "hero", down: heroDown(p) }];
    if (p.monster) bars.push({ id: MONSTER_ID, label: block.name, hp: p.monster.hp, max: block.maxHp, side: "enemy" });
    else if (p.fallenAt) bars.push({ id: MONSTER_ID, label: block.name, hp: 0, max: block.maxHp, side: "enemy", down: true });
    const near = tileDistance(p.heroAt, DOOR_AT) <= 1 || (tileDistance(p.heroAt, CONTAINER_AT) <= 1 && !p.searched);
    const myMove = !p.round || mine;
    const actionLeft = heroActionReady(p);
    const moveLeft = (c?.economy.movementRemaining ?? 0) >= FEET_PER_TILE;
    const actions: HudAction[] = [
      { id: "attack", label: "Attack", key: "F", enabled: !busy && !heroDown(p) && !!p.monster && actionLeft },
      { id: "use", label: "Use", key: "E", enabled: !busy && !heroDown(p) && myMove && near },
      { id: "potion", label: `Potion x${p.potions}`, key: "Q", enabled: !busy && p.potions > 0 && actionLeft && (heroDown(p) || h.currentHp < h.maxHp) },
      // The thing to press once the action is spent, or nothing is left to do.
      { id: "end", label: "End turn", key: "T", enabled: !busy && mine, emphasis: !busy && mine && (!actionLeft || (!moveLeft && !near)) },
    ];
    hud.render({ title, lines, bars, actions });
    const entries =
      p.round && p.monster
        ? p.round.order.map((cb) => ({ id: cb.id, label: cb.id === HERO_ID ? p.hero.name : block.name, total: cb.initiative, side: (cb.side === "player" ? "hero" : "enemy") as InitiativeSide }))
        : [];
    overlay.initiative(entries, p.round ? (activeCombatant(p.round)?.id ?? null) : null, p.round?.roundNumber ?? 0);
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
      packEl.appendChild(el_("p", "lt-note lt-tray-empty", "Empty. Kill the goblin or open the chest to win something. Drag a worn magic piece here to take it off."));
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

  function gearResult(outcome: GearOutcome): void {
    if (!outcome.ok) refuse(outcome.reason);
    flushLog();
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
      return refuse(`The ${itemName(p.archetypeId, payload.role, tier)} goes in the ${slotNaming(p.archetypeId, payload.role).slot} slot, not ${slotNaming(p.archetypeId, role).slot}.`);
    }
    gearResult(payload.from === "armoury" ? equipFromArmoury(p, payload.role, payload.tier) : equipFromPack(p, payload.index));
  }

  // Each part of the readout is rebuilt only when what it shows has changed.
  const shownSig = new Map<string, string>();
  const refresh = (part: string, sig: string, build: () => void): void => {
    if (shownSig.get(part) === sig) return;
    shownSig.set(part, sig);
    build();
  };

  function refreshAll(): void {
    const p = st();
    const h = p.hero;
    const look = `${art.source}|${art.ground}|${art.chars}|${art.size}|${artDecoded ? 1 : 0}`;
    const worn = GEAR_ROLES.map((r) => wornTier(p, r) ?? "-").join(",");
    const bag = (h.bag ?? []).map((b) => `${b.slot}:${b.tier}`).join(",");
    renderHud();
    refresh("slots", `${p.archetypeId}|${worn}|${look}`, renderSlots);
    refresh("pack", `${p.archetypeId}|${bag}|${look}`, renderPack);
    refresh("armoury", `${p.archetypeId}|${worn}|${bag}|${look}`, renderArmoury);
    stage.invalidate();
  }

  function renderAll(): void {
    heroSelect.value = st().archetypeId;
    refreshAll();
  }

  /** A new hero, a reset: nothing pending carries over, and the camera jumps to the hero. */
  function newScene(): void {
    walkQueue.length = 0;
    onArrive = null;
    busy = false;
    skipping = false;
    fightWasOn = false;
    hover = null;
    said = 0;
    overlay.clear();
    tray.clear();
    stage.snapCamera();
    renderAll();
  }

  // ---- keyboard ----------------------------------------------------------------

  const KEY_DIR: Record<string, Dir> = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!el.isConnected || el.offsetParent === null) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, [contenteditable]")) return;
    const key = e.key.toLowerCase();
    if (target?.closest?.("button") && (key === " " || key === "enter")) return;
    if (target?.tagName === "SELECT" && !KEY_DIR[key]) return;
    if (key === " " || key === "escape") {
      if (busy) {
        skipping = true;
        tray.skip();
      } else {
        walkQueue.length = 0;
        onArrive = null;
      }
      e.preventDefault();
      return;
    }
    if (busy) return;
    const dir = KEY_DIR[key];
    if (dir) {
      (target as HTMLElement | null)?.blur?.();
      // One square per press; a held key's repeats keep exactly one square waiting, so letting go stops within a square.
      if (walkQueue.length === 0 && !onArrive) {
        const p = st();
        walkQueue.push({ x: p.heroAt.x + DIR_STEP[dir].x, y: p.heroAt.y + DIR_STEP[dir].y });
        onArrive = async () => {
          await afterHeroAction();
        };
      }
    } else if (key === "f") {
      if (!e.repeat) void attackGoblin();
    } else if (key === "e") {
      if (!e.repeat) void useNearby();
    } else if (key === "q") {
      if (!e.repeat) void drinkPotion();
    } else if (key === "t") {
      if (!e.repeat) void endTurnFlow();
    } else {
      return;
    }
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  const onBlur = () => {
    walkQueue.length = 0;
  };
  window.addEventListener("blur", onBlur);

  // One animation-frame loop paints the scene, and runs the walk first.
  const stage = createPlayStage({ viewport, canvas, state: st, zoom: () => scale, beforeFrame: (now) => pump(now) });

  renderAll();
  said = st().log.length;
  if (st().round) void runHostiles();
  // A read-only handle for the bench's own headless checks: the scene state, never written through.
  (globalThis as { __ltBenchPlay?: () => PlayState }).__ltBenchPlay = st;

  return () => {
    diceSkin = tray.skin().id;
    hud.destroy();
    stage.dispose();
    overlay.destroy();
    picker.destroy();
    tray.destroy();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("blur", onBlur);
  };
}

// ===========================================================================
// Panel: Characters. Every figure the game uses, as the animated KayKit cast:
// four facings, any animation, in one style or every style side by side.
// Heroes wear their starting gear (the same layers the Play tab dresses them
// in). A figure kept hand-drawn (the goblin) sits among them as the game's own
// drawing, posed by the same clips. Nothing is filtered or ranked here: the
// owner judges.
// ===========================================================================

const CLIP_LABEL: Record<CastClipId, string> = {
  idle: "Idle",
  walk: "Walk",
  attack: "Attack",
  hit: "Hit",
  death: "Death",
  interact: "Interact",
  cheer: "Cheer",
};
const DIR_LABEL: Record<CastDir, string> = { down: "Front", right: "Right", up: "Back", left: "Left" };
const KIND_LABEL: Record<CastCharacter["kind"], string> = { hero: "Hero", monster: "Monster", npc: "Townsfolk" };
const ONCE_PAUSE_MS = 700;

/** Floor tiles behind a figure, from the art the Art row has chosen, tiled up from the bottom edge so the feet stand on a tile's edge. */
function paintFloor(ctx: CanvasRenderingContext2D, floorId: TileId | null, tilePx: number, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  if (!floorId) return;
  const manifest = artManifest("fantasy");
  const sprite = manifest.tiles[floorId];
  if (!sprite) return;
  const n = sprite.pixels.length;
  const px = tilePx / n;
  for (let ty = h; ty > -tilePx; ty -= tilePx) {
    for (let tx = 0; tx < w; tx += tilePx) {
      for (let sy = 0; sy < n; sy++) {
        const row = sprite.pixels[sy]!;
        for (let sx = 0; sx < row.length; sx++) {
          const idx = row[sx]!;
          if (idx < 0) continue;
          ctx.fillStyle = manifest.palette[idx] ?? "#f0f";
          ctx.fillRect(Math.floor(tx + sx * px), Math.floor(ty - tilePx + sy * px), Math.ceil(px), Math.ceil(px));
        }
      }
    }
  }
}

function mountCharactersPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  const cast = castData();
  if (!cast) {
    el.innerHTML =
      '<p class="lt-note">No animated cast in this build. Render it with <code>scripts/kaykit/cast.py</code> (see scripts/kaykit/README.md), then <code>npm run bench</code>.</p>';
    return () => {};
  }

  let styleId = castStyleNow()?.style ?? cast.styles[0]!.style;
  let clip: CastClipId = "walk";
  let zoom = art.size === 32 ? 2 : 4;
  let floorId: TileId | null = "floor_stone";
  let withGear = true;
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
  const check = (label: string, value: boolean, onChange: (v: boolean) => void): void => {
    const field = document.createElement("label");
    field.className = "bn-field";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = value;
    box.onchange = () => onChange(box.checked);
    field.append(box, document.createTextNode(` ${label}`));
    controls.appendChild(field);
  };
  // Style and detail are the Art row's own choices, so the Play tab follows.
  pick("Style", [...cast.styles.map((s): [string, string] => [s.style, s.label]), ["all", "All styles, side by side"]], styleId, (v) => {
    styleId = v;
    if (v !== "all") art.chars = v as CharStyle;
    build();
  });
  pick("Animation", CAST_CLIPS.map((c): [string, string] => [c, CLIP_LABEL[c]]), clip, (v) => {
    clip = v as CastClipId;
    build();
  });
  const zoomSelect = pick("Zoom", [], String(zoom), (v) => {
    zoom = Number(v);
    build();
  });
  pick("Detail", [["32", "32 px"], ["16", "16 px (the game's size)"]], String(art.size), (v) => {
    art.size = Number(v) as 16 | 32;
    zoom = art.size === 32 ? 2 : 4;
    fillZoom();
    build();
  });
  pick("Floor", [["floor_stone", "Stone"], ["floor_grass", "Grass"], ["", "None"]], floorId ?? "", (v) => {
    floorId = v || null;
    build();
  });
  check("Heroes wear their starting gear", withGear, (v) => {
    withGear = v;
    build();
  });
  check("Play", playing, (v) => {
    playing = v;
  });
  function fillZoom(): void {
    zoomSelect.innerHTML = "";
    for (const z of art.size === 32 ? [1, 2, 3] : [2, 4, 6]) {
      const opt = document.createElement("option");
      opt.value = String(z);
      opt.textContent = `${z}x`;
      zoomSelect.appendChild(opt);
    }
    zoomSelect.value = String(zoom);
  }
  fillZoom();

  const body = document.createElement("div");
  el.appendChild(body);

  interface Cell {
    canvas: HTMLCanvasElement;
    style: CastStyle;
    /** A cast member, or null for a figure kept hand-drawn (spriteId). */
    entry: CastCharacter | null;
    /** The cast member's look (body plus starting kit when worn), or null. */
    set: FigureSet | null;
    spriteId: string | null;
    dir: CastDir;
    shown: number;
  }
  let cells: Cell[] = [];
  let clock = 0;
  let last = performance.now();

  function build(): void {
    body.innerHTML = "";
    cells = [];
    const size = String(art.size);
    const styles = styleId === "all" ? cast!.styles : cast!.styles.filter((s) => s.style === styleId);
    const note = document.createElement("p");
    note.className = "lt-note";
    const kept = [...keptHandDrawn().keys()].filter((id) => MANIFEST.fantasy.tokens[id] && !castEntry(styles[0]!, id));
    note.textContent =
      `Every character is a KayKit model by Kay Lousberg (CC0), rendered in Blender through the same camera (${cast!.cameraPitchDeg} degrees down), ` +
      `framing and palette as the Knight${kept.length ? ", except where a row says it is kept hand-drawn" : ""}. Each stands in the game's one-tile footprint.`;
    body.appendChild(note);

    const grid = document.createElement("div");
    grid.className = "lt-kk-grid";
    grid.style.setProperty("--kk-cols", String(CAST_DIRS.length));
    body.appendChild(grid);
    grid.appendChild(document.createElement("div"));
    for (const dir of CAST_DIRS) {
      const h = document.createElement("div");
      h.className = "lt-kk-colhead";
      h.textContent = DIR_LABEL[dir];
      grid.appendChild(h);
    }
    // Kept hand-drawn figures sit after the cast's monsters, where the goblin always was.
    type Row = { cast: CastCharacter } | { sprite: string };
    const rows: Row[] = (styles[0]?.characters ?? []).map((c) => ({ cast: c }));
    let lastMonster = -1;
    rows.forEach((r, i) => {
      if ("cast" in r && r.cast.kind === "monster") lastMonster = i;
    });
    rows.splice(lastMonster + 1, 0, ...kept.map((id) => ({ sprite: id })));
    for (const row of rows) {
      if ("sprite" in row) {
        addSpriteRow(grid, row.sprite, styles[0]!, size);
        continue;
      }
      const first = row.cast;
      for (const style of styles) {
        const entry = castEntry(style, first.id);
        const meta = entry?.sizes[size];
        if (!entry || !meta) continue;
        const label = document.createElement("div");
        label.className = "lt-kk-rowhead";
        const b = document.createElement("b");
        b.textContent = styles.length > 1 ? `${entry.label}, ${style.label}` : entry.label;
        const sub = document.createElement("span");
        const notes = entry.notes.replace(/\.+$/, "");
        const standIn = entry.standIn ? ` Stand-in: ${notes || "no free Kay model"}.` : notes ? ` ${notes}.` : "";
        sub.textContent = `${KIND_LABEL[entry.kind]}, KayKit ${entry.model}.${standIn}`;
        label.append(b, sub);
        grid.appendChild(label);
        for (const dir of CAST_DIRS) {
          const canvas = document.createElement("canvas");
          canvas.className = "lt-canvas lt-kk-cell";
          canvas.width = meta.canvasW * zoom;
          canvas.height = meta.canvasH * zoom;
          canvas.title = `${entry.label}, ${DIR_LABEL[dir]}, ${CLIP_LABEL[clip]}`;
          grid.appendChild(canvas);
          cells.push({ canvas, style, entry, set: buildFigureSet(style, entry, size, withGear ? starterLayers(style, entry) : []), spriteId: null, dir, shown: -1 });
        }
      }
    }
    // Decode in the background, two clips at a time, in the order the rows appear; nothing blocks the page.
    const requests = cells.flatMap((cell) => (cell.set ? clipRequests(cell.set, [clip, "idle"], [cell.dir]) : []));
    castPrefetch(cast!.palette, requests, redrawAll);
    draw(true);
  }

  /** One row for a figure kept hand-drawn: the same drawing in every style, so one row whatever the Style choice. */
  function addSpriteRow(grid: HTMLElement, spriteId: string, style: CastStyle, size: string): void {
    const pixels = MANIFEST.fantasy.tokens[spriteId]?.pixels;
    if (!pixels) return;
    const k = Number(size) / 16;
    const name = SPRITES_BY_TEMPLATE.fantasy.find((s) => s.assetId === spriteId)?.name ?? spriteId;
    const label = document.createElement("div");
    label.className = "lt-kk-rowhead";
    const b = document.createElement("b");
    b.textContent = name;
    const sub = document.createElement("span");
    sub.textContent = `Hand-drawn: the game's own ${name.toLowerCase()}, kept by your call. One drawing (no facings), moved by the bench.`;
    label.append(b, sub);
    grid.appendChild(label);
    for (const dir of CAST_DIRS) {
      const canvas = document.createElement("canvas");
      canvas.className = "lt-canvas lt-kk-cell";
      canvas.width = 2 * (pixels[0]?.length ?? 16) * k * zoom;
      canvas.height = 1.5 * pixels.length * k * zoom;
      canvas.title = `${name}, ${DIR_LABEL[dir]}, ${CLIP_LABEL[clip]}`;
      grid.appendChild(canvas);
      cells.push({ canvas, style, entry: null, set: null, spriteId, dir, shown: -1 });
    }
  }

  const redrawAll = (): void => draw(true);

  function draw(force = false): void {
    const size = String(art.size);
    for (const cell of cells) {
      const timing = cell.entry ?? SPRITE_ENTRY;
      const c = findCastClip(timing, size, clip, cell.dir) ?? findCastClip(timing, size, "idle", cell.dir);
      if (!c) continue;
      const span = c.loop ? castClipMs(c) : castClipMs(c) + ONCE_PAUSE_MS;
      const i = castFrameIndex(c, clock % span);
      if (!force && i === cell.shown) continue;
      const ctx = cell.canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      if (!cell.entry) {
        // One tile is `size` sprite pixels, drawn `zoom` canvas pixels each.
        paintFloor(ctx, floorId, Number(size) * zoom, cell.canvas.width, cell.canvas.height);
        const pose = spritePose(c.clip, i, cell.dir);
        cell.shown = drawSpriteFigure(ctx, artManifest("fantasy"), cell.spriteId!, pose, cell.canvas.width / 2, cell.canvas.height, (Number(size) / 16) * zoom) ? i : -1;
        continue;
      }
      const meta = cell.entry.sizes[size];
      const canvases = cell.set ? setFrames(cell.set, c.clip, cell.dir, i) : null;
      // Not decoded yet: leave the cell as it is and try again next frame.
      if (!meta || !canvases) {
        cell.shown = -1;
        continue;
      }
      paintFloor(ctx, floorId, meta.tokenW * zoom, cell.canvas.width, cell.canvas.height);
      for (const frame of canvases) ctx.drawImage(frame, 0, 0, cell.canvas.width, cell.canvas.height);
      cell.shown = i;
    }
  }

  let raf = 0;
  function loop(now: number): void {
    if (playing) clock += now - last;
    last = now;
    draw();
    raf = requestAnimationFrame(loop);
  }
  // The floor comes from the converted ground once it is decoded.
  if (kaykitLibrary() && !artDecoded) {
    void decodeLibrary().then((d) => {
      artDecoded = d;
      draw(true);
    });
  }
  build();
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

// ===========================================================================
// Panel: Pieces. Every in-play fantasy sprite the game uses, as a still: the
// current hand-drawn one beside the KayKit conversion chosen in the Art row
// (ground style, character style, detail), grouped the way the conversion was
// split. An id the chosen parts do not cover says so. The Healer's pieces are
// out of play and not listed; sci-fi is paused.
// ===========================================================================

/** A sprite the Pieces tab shows: every fantasy sprite but the Healer's, who is out of play. */
function inPlayPiece(s: LtSprite): boolean {
  return !/healer/.test(s.assetId);
}

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

function mountPiecesPanel(el: HTMLElement, _api: unknown): void {
  injectPanelStyle();
  el.innerHTML = "";
  if (!kaykitLibrary()) {
    el.innerHTML = '<p class="lt-note">No converted library in this build. Run the scripts/kaykit/lib_*.py makers, then <code>npm run bench</code>.</p>';
    return;
  }
  el.appendChild(buildArtControls(() => mountPiecesPanel(el, _api)));
  const body = document.createElement("div");
  el.appendChild(body);
  const render = () => {
    body.innerHTML = "";
    const palette = MANIFEST.fantasy.palette;
    const inPlay = SPRITES_BY_TEMPLATE.fantasy.filter(inPlayPiece);
    const covered = inPlay.filter((s) => kaykitHas(s.assetId)).length;
    const kept = keptHandDrawn();
    const keptCount = inPlay.filter((s) => kept.has(s.assetId) && !kaykitHas(s.assetId)).length;
    const summary = document.createElement("p");
    summary.className = "lt-note";
    summary.textContent =
      `${inPlay.length} in-play fantasy pieces, ${covered} converted from KayKit${keptCount ? `, ${keptCount} kept hand-drawn by your call` : ""}. ` +
      `Left of each pair is the game today, right is the conversion. Characters and gear here are the stills the game would load; the Characters tab shows them moving.`;
    body.appendChild(summary);
    for (const group of CONVERTED_GROUPS) {
      const members = inPlay.filter(group.test);
      if (members.length === 0) continue;
      const section = document.createElement(group.collapsed ? "details" : "section");
      section.className = "lt-conv-group";
      const head = document.createElement(group.collapsed ? "summary" : "h3");
      const groupKept = members.filter((s) => kept.has(s.assetId) && !kaykitHas(s.assetId)).length;
      head.textContent = `${group.label} (${members.filter((s) => kaykitHas(s.assetId)).length} of ${members.length} converted${groupKept ? `, ${groupKept} kept hand-drawn` : ""})`;
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
          // Left out on purpose (the owner's call) reads differently from a piece the conversion missed.
          const keep = kept.get(s.assetId);
          gap.className = keep ? "lt-conv-kept" : "lt-conv-gap";
          gap.textContent = keep ? "kept hand-drawn (your call)" : "not converted";
          if (keep) gap.title = keep;
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
// Panel: Gear. One hero's equipment, two ways the game draws it: the
// inventory screen's paper doll (render/doll.ts's renderDoll, at its real
// DOLL_MIN_SCALE..DOLL_MAX_SCALE range), and every item's inventory icon at
// every tier it exists at (render/gearIcon.ts's renderGearIcon), at the
// phone's 48 px slot size and at 4x, plus the empty-slot silhouettes.
// ===========================================================================

const ICON_NATIVE_PX = 48;
const ICON_ZOOM_PX = ICON_NATIVE_PX * 4;

interface IconEntry {
  label: string;
  source: NonNullable<ReturnType<typeof gearIconSource>> | ReturnType<typeof emptySlotIconSource>;
}

function collectIcons(archetypeId: ArchetypeId): IconEntry[] {
  const template = TEMPLATE_OF_ARCHETYPE[archetypeId];
  const out: IconEntry[] = [];
  for (const role of DRAWN_ROLES) {
    for (const tier of EQUIPMENT_TIERS) {
      const source = gearIconSource(archetypeId, role, tier);
      if (!source) continue;
      out.push({ label: `${slotNaming(archetypeId, role).slot}: ${gearItemName(archetypeId, role, tier) ?? role} (${tier})`, source });
    }
  }
  for (const role of SHEET_ONLY_ROLES) {
    for (const tier of EQUIPMENT_TIERS) {
      const source = gearIconSource(archetypeId, role, tier);
      if (!source) continue;
      out.push({ label: `${ACCESSORY_SLOT_WORD[template][role]}: ${gearItemName(archetypeId, role, tier) ?? role} (${tier})`, source });
    }
    out.push({ label: `${ACCESSORY_SLOT_WORD[template][role]}: empty slot`, source: emptySlotIconSource(template, role) });
  }
  return out;
}

function mountGearPanel(el: HTMLElement, _api: unknown): () => void {
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
  const iconHead = document.createElement("h3");
  iconHead.className = "lt-section-head";
  iconHead.textContent = "Inventory icons";
  el.appendChild(iconHead);
  const iconNote = document.createElement("p");
  iconNote.className = "lt-note";
  iconNote.textContent = "Every piece this hero can own, at every tier, at the phone's 48 px slot size and at 4x.";
  el.appendChild(iconNote);
  const iconGrid = document.createElement("div");
  iconGrid.className = "lt-icon-grid";
  el.appendChild(iconGrid);

  let archetypeId: ArchetypeId = PLAYABLE_HEROES[0]!;
  let scale = DOLL_MAX_SCALE;
  const picked: Partial<Record<GearRole, EquipmentTier | "empty">> = {};

  const heroField = document.createElement("label");
  heroField.className = "bn-field";
  heroField.textContent = "Hero ";
  heroField.appendChild(
    buildHeroSelect(archetypeId, (id) => {
      archetypeId = id;
      rebuildTiers();
    }),
  );
  controls.appendChild(heroField);

  const scaleField = document.createElement("label");
  scaleField.className = "bn-field";
  scaleField.textContent = "Doll size ";
  const scaleOptions: number[] = [];
  for (let s = DOLL_MIN_SCALE; s <= DOLL_MAX_SCALE; s++) scaleOptions.push(s);
  scaleField.appendChild(
    buildScaleSelect(scaleOptions, scale, (n) => {
      scale = n;
      draw();
    }),
  );
  controls.appendChild(scaleField);

  function rebuildTiers(): void {
    tierHost.innerHTML = "";
    tierHost.appendChild(buildTierControls(archetypeId, picked, draw));
    draw();
  }

  function draw(): void {
    const manifest = artManifest("fantasy");
    canvas.width = DOLL_CANVAS_SIZE * scale;
    canvas.height = DOLL_CANVAS_SIZE * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderDoll(ctx, renderPlanFor(sheetWithEquipment(archetypeId, equipmentFrom(picked))), manifest, scale, 0);

    iconGrid.innerHTML = "";
    for (const entry of collectIcons(archetypeId)) {
      const card = document.createElement("div");
      card.className = "lt-icon-card";
      const label = document.createElement("div");
      label.className = "lt-icon-label";
      label.textContent = entry.label;
      card.appendChild(label);
      const row = document.createElement("div");
      row.className = "lt-icon-row";
      for (const px of [ICON_NATIVE_PX, ICON_ZOOM_PX]) {
        const icon = document.createElement("canvas");
        icon.width = px;
        icon.height = px;
        icon.className = "lt-icon-canvas";
        const ictx = icon.getContext("2d")!;
        ictx.imageSmoothingEnabled = false;
        if (!renderGearIcon(ictx, entry.source, manifest, px)) icon.title = "missing sprite: draws nothing, same as the phone screen's text fallback";
        row.appendChild(icon);
      }
      card.appendChild(row);
      iconGrid.appendChild(card);
    }
  }

  rebuildTiers();
  return () => {};
}

// ===========================================================================
// Panel: Terrain. A preset 20x15 fantasy scene, raw versus run through
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

/** `pxScale` is canvas px PER SOURCE PIXEL, integer, like every zoom on the bench. Tiles are 16 source px, so a tile occupies pxScale*16 canvas px. */
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
  el.appendChild(buildArtControls(() => draw(), { chars: false }));
  const controls = document.createElement("div");
  controls.className = "bn-controls";
  el.appendChild(controls);

  const template: TemplateGenre = "fantasy";
  let seed = 0;
  let autotile = true;
  // Per SOURCE pixel, integers only (see paintRawTiles).
  let scale = 2;

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
#bench-root .lt-art-controls{padding:8px 10px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);margin-bottom:10px}
#bench-root .lt-art-controls [hidden]{display:none}
#bench-root .lt-art-status{margin:0;flex-basis:100%}
#bench-root .lt-art-explain{flex-basis:100%;display:flex;flex-direction:column;gap:2px}
#bench-root .lt-art-explain .lt-note{margin:0;max-width:none}
#bench-root .lt-conv-group{margin:12px 0}
#bench-root .lt-conv-group>h3,#bench-root .lt-conv-group>summary{font-size:13px;margin:0 0 8px;cursor:default}
#bench-root .lt-conv-group>summary{cursor:pointer}
#bench-root .lt-conv-grid{display:flex;flex-wrap:wrap;gap:8px}
#bench-root .lt-conv-card{background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px;max-width:100%}
#bench-root .lt-conv-pair{display:flex;gap:6px;align-items:flex-end}
#bench-root .lt-conv-canvas{image-rendering:pixelated}
#bench-root .lt-conv-gap{font-size:11px;color:var(--bn-danger);align-self:center}
#bench-root .lt-conv-kept{font-size:11px;color:var(--bn-muted);align-self:center;max-width:9em}
#bench-root .lt-section-head{font-size:13px;margin:18px 0 4px}
#bench-root .lt-kk-grid{display:grid;grid-template-columns:minmax(120px,220px) repeat(var(--kk-cols),auto);gap:10px 12px;align-items:end;overflow-x:auto;max-width:100%;padding-bottom:6px}
#bench-root .lt-kk-colhead{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--bn-muted)}
#bench-root .lt-kk-rowhead{display:flex;flex-direction:column;gap:2px;font-size:12px;align-self:center}
#bench-root .lt-kk-rowhead span{color:var(--bn-muted);font-size:11.5px}
#bench-root .lt-kk-cell{border:1px solid var(--bn-line);border-radius:6px;background:var(--bn-panel-alt)}
@media (max-width:720px){#bench-root .lt-kk-grid{grid-template-columns:repeat(var(--kk-cols),auto)}#bench-root .lt-kk-grid>div:first-child{display:none}#bench-root .lt-kk-rowhead{grid-column:1 / -1}}
#bench-root .lt-arena{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;margin:4px 0 8px}
#bench-root .lt-game{padding:10px;border-radius:12px;background:#0c0e1d;box-shadow:inset 0 0 0 1px rgb(255 255 255/.06),0 6px 18px rgb(0 0 0/.25)}
#bench-root .lt-game .lt-viewport{border-color:#262a47}
#bench-root .lt-reset{font:inherit;font-size:12.5px;padding:6px 10px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);color:var(--bn-text);cursor:pointer}
#bench-root .lt-stage-wrap{position:relative;width:fit-content;max-width:100%}
#bench-root .lt-tray-col{flex:0 0 320px;width:320px;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:8px}
#bench-root .lt-tray-col>*{max-width:100%}
#bench-root .lt-dice-shop>summary{cursor:pointer;font-size:12.5px;color:var(--bn-muted)}
@media (min-width:721px){#bench-root .lt-stage-wrap{max-width:calc(100% - 344px)}}
@media (max-width:720px){#bench-root .lt-tray-col{flex:1 1 100%;width:auto}}
#bench-root .lt-viewport{overflow:auto;max-width:100%;max-height:min(66vh,620px);border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel-alt);touch-action:manipulation}
#bench-root .lt-board{position:relative;width:max-content}
#bench-root .lt-marks{position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated}
#bench-root .lt-howto{margin:0 0 6px}
#bench-root .lt-act:disabled{opacity:.45;cursor:default;border-color:var(--bn-line)}
#bench-root .lt-act{font:inherit;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);color:var(--bn-text);cursor:pointer;touch-action:manipulation}
#bench-root .lt-act:hover{border-color:var(--bn-accent)}
#bench-root .lt-act-primary{background:var(--bn-accent);border-color:var(--bn-accent);color:var(--bn-accent-ink)}
#bench-root .lt-act kbd{font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:1px 6px;border:1px solid currentColor;border-radius:4px;opacity:.7}
#bench-root .lt-stats{display:flex;flex-wrap:wrap;gap:6px}
#bench-root .lt-stat{font-size:12px;padding:3px 9px;border:1px solid var(--bn-line);border-radius:999px;background:var(--bn-panel);font-variant-numeric:tabular-nums}
#bench-root .lt-stat-label{color:var(--bn-muted)}
#bench-root .lt-stat b{font-weight:600}
#bench-root .lt-stat-bad{border-color:var(--bn-danger)}
#bench-root .lt-stat-bad b{color:var(--bn-danger)}
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
#bench-root .lt-reset:focus-visible,#bench-root .lt-gear button:focus-visible{outline:2px solid var(--bn-focus);outline-offset:2px}
@media (max-width:720px){
#bench-root .lt-viewport{max-height:52vh}
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
  source: "scripts/asset-bench/assets.ts, the game's code under src/games/livingtable, KayKit renders from scripts/kaykit/",
  notes: [
    "Play is the game in miniature, turn based: click to walk, click the goblin to attack, the door or the chest to use it; " +
      "initiative, movement and the dice are the game's own. Characters shows the whole animated cast, Pieces every still " +
      "sprite beside its KayKit version, Gear the paper doll and inventory icons, Terrain the autotiling.",
    "The Art row switches between the game's current hand-drawn art and the KayKit art (Kay Lousberg, CC0); the choice " +
      "holds across tabs. Fantasy only: sci-fi is paused and the Healer is out of play.",
  ],
  // This project's additions to the shell (shell.js): no sprite library, and the bench opens on Play.
  library: false,
  assets: [],
  panels: [
    { id: "play", label: "Play", mount: mountPlayPanel },
    { id: "characters", label: "Characters", mount: mountCharactersPanel },
    { id: "pieces", label: "Pieces", mount: mountPiecesPanel },
    { id: "gear", label: "Gear", mount: mountGearPanel },
    { id: "terrain", label: "Terrain", mount: mountTerrainPanel },
  ],
  defaultPanel: "play",
};

/** Every sprite id the Pieces tab shows (every in-play fantasy sprite), for the guard test. Pure: no DOM. */
export const PIECES_ASSET_IDS: readonly string[] = SPRITES_BY_TEMPLATE.fantasy.filter(inPlayPiece).map((s) => s.assetId);
