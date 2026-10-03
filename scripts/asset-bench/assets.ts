/**
 * The Living Table asset bench registry.
 *
 * Seven panels: Play (the game in miniature, turn based; its Sheet button opens
 * the character sheet and the character creator, sheet.ts, inside the game
 * window), Rules and Bestiary (the books on the table, books.ts, built from
 * src/games/livingtable/rules/rulebook.ts and bestiary.ts), Characters (the
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
  MAGIC_TIERS,
  SLOTS_BY_ARCHETYPE,
  TEMPLATE_OF_ARCHETYPE,
  TIER_WORD,
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
import { describeBagItem, describeCarried, packInfo } from "../../src/games/livingtable/inventory/itemInfo";
import { destroyItem, dropItem, equipItem, itemActionsFor, itemStatusLine, itemUseSay, pickUp, unequipItem, type ItemActionContext, type ItemFlags, type ItemRef } from "../../src/games/livingtable/inventory/itemActions";
import { bodyFor, carriedBy, itemNotes as carriedNotes, pocketPick, takeFromBody, type BodyState, type CarriedItem } from "../../src/games/livingtable/rules/corpses";
import { BESTIARY, abilityMod, type Beast } from "../../src/games/livingtable/rules/bestiary";
import {
  canonicalAbility,
  canonicalSkill,
  forceDoor,
  monsterPassivePerception,
  monsterShoveProfile,
  monsterSkill,
  pickLock,
  proneAttackMode,
  proneEffects,
  pushDestination,
  shoveContest,
  skillCheck,
  sleightOfHand,
  standUpCostFt,
  stealthCheck,
  unarmedStrike,
  type RollMode,
} from "../../src/games/livingtable/session/maneuvers";
import { contextActionsFor, type ContextAction, type ContextSituation, type ContextTarget } from "../../src/games/livingtable/session/contextActions";
import { ADVENTURE_FORMAT, ADVENTURE_VERSION, adventureFiles, adventureZip, type AdventureBundle, type DmExchange, type RollRecord } from "../../src/games/livingtable/session/adventureExport";
import { APP_VERSION } from "../../src/version";
import { itemNameFor } from "../../src/games/livingtable/characters/equipment";
import { applyDamage, applyHealing, longRest, newAdventuringDay } from "../../src/games/livingtable/characters/health";
import { addSave, latestSave, makeSavePoint, parseSaves, restBlockedReason, saveLabel, serializeSaves, type SaveKind, type SavePoint } from "../../src/games/livingtable/session/savePoints";
import { parseDiceNotation, rollDice, rollDie } from "../../src/games/livingtable/rules/dice";
import { packItems, renderPlanFor, slotLabelFor } from "../../src/games/livingtable/menu/equipment";
import { ABILITY_NAME, attackLine, bonusSources, hitPoints, lootLine, sentenceCase, type TokenNamer } from "../../src/games/livingtable/menu/labels";
import {
  FEET_PER_TILE,
  MONSTER_INITIATIVE_MODIFIER,
  activeCombatant,
  attackBlockedReason,
  dropCombatant,
  endTurn,
  hasHostiles,
  isPlayersTurn,
  spendActiveAction,
  spendActiveMovement,
  startCombat,
  withActiveEconomy,
  type CombatRound,
} from "../../src/games/livingtable/menu/combatRound";
import { resolveAttack, resolveDamage, type AttackResult } from "../../src/games/livingtable/rules/combat";
import { commitLoadout, draftFromSheet, stageEquip, stageUnequip } from "../../src/games/livingtable/rules/inventory";
import { lootFor } from "../../src/games/livingtable/rules/loot";
import {
  attackBonusSourcesFor,
  attackerBonusFor,
  checkAdvantageFor,
  damageMonster,
  effectiveArmorClass,
  effectiveSpeedFt,
  monsterArmorClassFor,
  skillModifierFor,
  statblockFor,
  weaponDamageNotationFor,
  weaponFor,
  type MonsterStatblock,
} from "../../src/games/livingtable/session/combat";
import { renderDoll } from "../../src/games/livingtable/render/doll";
import { renderGearIcon } from "../../src/games/livingtable/render/gearIcon";
import { renderCell, spriteSizeOf, type RenderManifest } from "../../src/games/livingtable/render/canvasRenderer";
import { headAnchor } from "../../src/games/livingtable/render/anchors";
import { attackResultToReadout } from "../../src/games/livingtable/render/rollReadoutAdapter";
import { resolveMonsterTurn } from "../../src/games/livingtable/session/hostileTurns";
import { attackEvents, type CombatEvent } from "../../src/games/livingtable/session/combatEvents";
import { createHud, createOverlay, verdictWords, type ContextMenuEntry, type DialogueLine, type Hud, type HudAction, type HudBar, type HudOption, type HudSave, type InitiativeSide, type ItemCardContent, type LootWindow, type LootWindowItem, type NarrationHandle, type Overlay, type OverlayPoint, type PackSection, type TextStyle } from "./overlay";
import { foeDiceForToken } from "./foeDice";
import { askDm, normaliseSkill, validationContextFor, type DmAsk, type DmCheck, type DmEffect, type DmOption, type DmReply, type DmSceneView, type SampleFn } from "./dm";
import { createDiceTray, createSkinPicker, DICE_SKINS, type DiceTray, type DieKind, type RollRequest } from "./dice";
import { dropLowest, featureList, itemCount, itemTip, openCreation, openSheet, sheetItemKey, type CreationView, type SheetExtras, type SheetView } from "./sheet";
import { mountBestiaryPanel, mountRulesPanel } from "./books";
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
import { emptyWorld, getCell, setCell } from "../../src/games/livingtable/world/perception";
import { approachTile, fieldCostFt, lineOfSightFor, movementField, pathTo, reachableTiles, type MovementField } from "../../src/games/livingtable/world/pathing";
import {
  canSeeEachOther,
  emptyExplored,
  isOpaqueAssetId,
  mergeExplored,
  sightBlockers,
  visibilityStates,
  visibleFrom,
} from "../../src/games/livingtable/world/visibility";
import { SHROUD_TICK_MS, shroudAnimates, shroudPixels } from "../../src/games/livingtable/render/shroud";
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
// door, a chest and a goblin (or, with the Room setting, a goblin and a
// skeleton: any number of creatures work, each with its own statblock, hit
// points, wake rule, turn and dice). Click a square to walk there, a creature
// to attack THAT creature, the door or the chest to use it. When a hostile
// notices the hero (it sees the hero within MONSTER_WAKE_TILES, or could
// reach the hero by ear) everyone awake rolls initiative, and from then on
// each hostile takes its own turn in initiative order. The fight ends when no
// awake hostile is left.
//
// The game's own code, called by symbol:
//   turns     menu/combatRound.ts: startCombat, endTurn, the movement and
//             action economy, attackBlockedReason
//   moving    world/pathing.ts: movementField, pathTo, approachTile (the
//             reachable squares, the path, where to stand to strike)
//   sight     world/visibility.ts: sightBlockers, visibleFrom, canSeeEachOther,
//             mergeExplored, visibilityStates (what a closed door hides, the
//             fog of war's memory) and render/shroud.ts for the mist itself
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
  /** The creature the scene starts with. */
  monster: TileId;
  /** The second kind of creature, for the Room setting "two creatures" (it proves two hostiles with their own statblocks work). */
  second: TileId;
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
    second: "token_skeleton",
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
    second: "token_drone",
  },
};

// An outer wall and a dividing wall at DIVIDER_X with one door in it. The
// hero starts in the west room; the container and the monster are east.
const DIVIDER_X = 11;
const DOOR_AT: XY = { x: DIVIDER_X, y: 7 };
const CONTAINER_AT: XY = { x: 16, y: 3 };
const MONSTER_START: XY = { x: 16, y: 10 };
/** Where the second creature of the "two creatures" room starts (the east room, asleep like the first). */
const SECOND_START: XY = { x: 15, y: 5 };
const HERO_START: XY = { x: 4, y: 7 };
/** A hostile wakes when it and the hero see each other within this many squares... */
const MONSTER_WAKE_TILES = 6;
/** ...or when a walking path to the hero is this short (it hears you, door or no door). */
const MONSTER_HEARS_STEPS = 2;
/** The refusal for a click on a square the hero has never seen. */
const NOT_SEEN = "You have not seen that far.";
/** Where a drain grate sits in each room: walkable floor the DM can look into later. */
const DRAIN_AT: readonly XY[] = [
  { x: 7, y: 10 },
  { x: 14, y: 12 },
];
const DRAIN_TILE: Record<TemplateGenre, TileId> = { fantasy: "floor_stone_drain", scifi: "floor_grating" };
const HERO_ID = "hero";
/** The first creature of a scene is "monster"; the rest are "monster-2", "monster-3" and so on (see addCreature). */
const MONSTER_ID = "monster";
/** The most creatures the room holds alive at once (the DM's spawn is refused past it). */
const CREATURE_CAP = 8;
/** The Log tab's history: every roll, find and line of narration, newest last. */
const LOG_KEEP = 200;
/** The DM's own limits on what it may leave behind in the scene. */
const DM_MEMORY_KEEP = 12;
const DM_RECENT_KEEP = 16;
const DM_RECENT_SHOWN = 8;
const DM_POTION_CAP = 2;
const DM_PROPS_MAX = 8;
const DM_INVENTORY_MAX = 24;
/** The debug journals' limits (the export carries them; the saves do not). */
const DM_JOURNAL_KEEP = 100;
const ROLL_JOURNAL_KEEP = 500;
/** The lock DC of a door the DM locked without naming one. */
const DEFAULT_LOCK_DC = 15;
/** Lines of log that scrolled off the Log tab or belong to an earlier scene, kept for the debug export only. */
const SESSION_LOG_KEEP = 4000;
// Indoor floors for a walled room; the Floor control still offers the rest.
const ROOM_FLOOR: Record<TemplateGenre, TileId> = { fantasy: "floor_stone", scifi: "floor_deckplate" };
const DOWN_NOTE = "You are down. Load the last save, or press Reset scene.";

/** Every sprite's own `walkable` flag, the same one manifestCache.ts turns into the engine's tile walkability and prop `blocks`. */
const WALKABLE_BY_ID: Record<TemplateGenre, Map<string, boolean>> = {
  fantasy: new Map(SPRITES_BY_TEMPLATE.fantasy.map((s) => [s.assetId, s.walkable])),
  scifi: new Map(SPRITES_BY_TEMPLATE.scifi.map((s) => [s.assetId, s.walkable])),
};

interface LogLine {
  text: string;
  /** good: went your way. bad: went against you. plain: neither. dm: the DM's own narration (the Log tab sets it apart). */
  tone: "good" | "bad" | "plain" | "dm";
  /** A short "+ a tarnished silver ring" the Pack button's notice shows once, when the line is first flushed (see flushLog). The log keeps the full line. */
  notice?: string;
}

/** Which creatures the sandbox room starts with (the Room setting): one goblin, or a goblin and a skeleton. */
type RoomChoice = "one" | "two";
const ROOM_CHOICES: readonly RoomChoice[] = ["one", "two"];

/**
 * One creature on the board: hostile or not, awake or asleep, with its own statblock (by `token`), hit points, what it carries and
 * what it is doing in the picture. Everything the rules decide about a creature reads from here; nothing is a one-off "the monster".
 */
interface Creature {
  /** "monster" for the first creature of a scene, then "monster-2", "monster-3": the id the engine, the DM and the log use. */
  id: string;
  /** The token asset id; the statblock, the dice look, the bestiary entry and the drawing all come from it. */
  token: TileId;
  /** Which of its kind this is (the first goblin is 1, a second is 2): it is part of the name only while the scene has more than one of the kind. */
  n: number;
  at: XY;
  hp: number;
  /** Awake creatures are in the fight (or start one). A sleeping one waits until it notices the hero, is woken, or is struck. */
  awake: boolean;
  /** Whether the hero has ever had it in sight. Until then the readout calls it "???". */
  seen: boolean;
  /** Knocked down: the hero's attacks next to it have advantage, and it spends half its movement to stand at the start of its turn. */
  prone: boolean;
  /** What it is still carrying while it lives (a pickpocket takes from here). When it falls, this is what its body holds. */
  carried: CarriedItem[];
  /** A hostile fights the hero. A creature that is not (a villager, a shopkeeper) is never in the initiative order and is never attacked by a click. */
  hostile: boolean;
  /** Set on a creature that is somebody (a role the DM and the readout name: "the innkeeper"). Picture and words only; the rules read `hostile`. */
  npc?: { role: string };
  /** What it is doing in the animated picture (cast.ts). Picture only: the rules never read it, and a save does not keep it. */
  actor: Actor;
}

/** A creature as a save keeps it: everything but the picture. */
type SavedCreature = Omit<Creature, "actor">;

/** A body the hero's kills leave: the engine's BodyState plus which creature it was, so the picture draws the right figure lying there. */
type PlayBody = BodyState & { token: TileId };

interface PlayState {
  template: TemplateGenre;
  archetypeId: ArchetypeId;
  floorId: TileId;
  hero: CharacterSheet;
  /** The hero as it began (quick-picked or made in the creator): what Reset scene starts again from, hit points full. */
  start: CharacterSheet;
  /** What the DM said each thing it gave is (its `desc`), keyed by the item's name; the pack's hover tip reads it. Taking the item removes it. */
  itemNotes: Record<string, string>;
  heroAt: XY;
  /** Which creatures the scene began with (the Room setting); Reset scene starts them all again. */
  room: RoomChoice;
  /** Every creature alive on the board, in the order they were made. A slain one leaves a body and is removed. */
  creatures: Creature[];
  /** How many creatures of each token have been made in this scene (it numbers a kind that has more than one). */
  spawned: Record<string, number>;
  /** The next creature's number (see Creature.id). */
  creatureSeq: number;
  doorOpen: boolean;
  searched: boolean;
  log: LogLine[];
  /** Why the last press did nothing, in words. Cleared by the next press that does something. */
  note: string | null;
  /** The fight, from the game's own combatRound.ts; null while exploring. */
  round: CombatRound | null;
  /** Healing potions left (the bench's own stock). */
  potions: number;
  /** Where the last creature fell. Bodies are the full record (each lies where it fell); this is only where the last "DOWN" floats from. */
  fallenAt: XY | null;
  /** What the hero is doing in the animated picture (cast.ts); each creature's own is on it. Picture only: the rules never read this. */
  heroActor: Actor;
  /** What the hero has seen so far, one byte per square (1 seen), row-major: the fog of war's memory (world/visibility.ts). */
  explored: Uint8Array;
  /** Bumps whenever `explored` gains a square, so a drawing can tell it changed without comparing it. */
  exploredRev: number;
  /** Props the DM has put in the room, with a label and an optional secret only the DM knows. */
  extraProps: DmProp[];
  /** The DM's secrets on the room's own features (a drain grate, the door, the chest), keyed by feature id. The drains start with none. */
  propSecrets: Record<string, string>;
  /** Terrain the DM changed: a collapsed wall, a flooded corner. Later entries win. */
  tileOverrides: { x: number; y: number; tile: TileId }[];
  /** A locked door refuses Use ("Locked.") until the DM unlocks it. */
  doorLocked: boolean;
  /** Facts the DM asked to remember (at most DM_MEMORY_KEEP). */
  dmMemory: string[];
  /** The last exchanges with the DM, oldest first, refusals included (so it stays honest). */
  dmRecent: { who: "player" | "dm"; text: string }[];
  /** The DM's suggested next moves from its last answer (at most 4); empty when there are none. Never saved: it clears when the hero moves, acts or the next answer comes. */
  options: DmOption[];
  /** Healing potions the DM has handed out this scene (capped at DM_POTION_CAP). */
  potionsGranted: number;
  /** Bumps whenever the DM changes the tiles or props, so sight and the picture know to rebuild. */
  worldRev: number;
  /** The next DM prop number. */
  propSeq: number;
  /** What the hero has slain, where each lies (rules/corpses.ts). A body keeps what its creature carried until the hero takes it; the picture draws each one lying down. */
  bodies: PlayBody[];
  /** Things the hero dropped, one pile per square, in the order they were put down. Picking one up takes it from here. */
  piles: { at: XY; items: string[] }[];
  /** What the DM said about each thing it handed over, keyed by the item's name: a quest item cannot be dropped or destroyed, a usable one has a Use button that sends its words to the DM. */
  itemFlags: Record<string, ItemFlags>;
  /** The hero is hidden (a successful Hide, or a Sneak step it did not notice): a hostile does not wake by sight, and the hero's next attack has advantage and ends it. */
  heroHidden: boolean;
  /** Sneaking mode: every step that would let a hostile notice the hero rolls Stealth against its passive Perception instead. */
  sneaking: boolean;
  /** The DC of the door's lock when it is locked (the DM sets none, so it is 15). */
  doorLockDc: number;
  /** Every exchange with the DM, oldest first, at most DM_JOURNAL_KEEP: the full input, raw answers, errors, what was applied and refused. Kept out of saves; it goes in the debug export. */
  dmJournal: DmExchange[];
  /** Every roll thrown in the tray, oldest first, at most ROLL_JOURNAL_KEEP. Kept out of saves; it goes in the debug export. */
  rollJournal: RollRecord[];
}

interface DmProp {
  id: string;
  assetId: TileId;
  x: number;
  y: number;
  label: string;
  secret?: string;
}

function freshHero(archetypeId: ArchetypeId): CharacterSheet {
  return createCharacter({ archetypeId, name: ARCHETYPE_LABEL[archetypeId], appearanceAssetId: bodySpriteId(archetypeId) });
}

/**
 * A new scene. `start` is the hero to begin as (a character made in the creator);
 * without it, the archetype's ready-made one. `keepGearOf` carries worn gear and the
 * pack over (Reset scene), while hit points, the loot ledger, the door, the
 * container and the monster all start again. The picture and the animated figure
 * follow the archetype either way.
 */
function newPlay(template: TemplateGenre, archetypeId: ArchetypeId, floorId: TileId, keepGearOf?: CharacterSheet, start?: CharacterSheet, room: RoomChoice = roomChoice): PlayState {
  const fresh = start ?? freshHero(archetypeId);
  const hero = keepGearOf ? { ...fresh, equipment: keepGearOf.equipment, bag: keepGearOf.bag } : fresh;
  const p: PlayState = {
    template,
    archetypeId,
    floorId,
    hero,
    start: fresh,
    itemNotes: {},
    heroAt: { ...HERO_START },
    room,
    creatures: [],
    spawned: {},
    creatureSeq: 1,
    doorOpen: false,
    searched: false,
    log: [],
    note: null,
    round: null,
    potions: HERO_POTIONS,
    fallenAt: null,
    heroActor: newActor("down"),
    explored: emptyExplored(),
    exploredRev: 0,
    extraProps: [],
    propSecrets: {},
    tileOverrides: [],
    doorLocked: false,
    dmMemory: [],
    dmRecent: [],
    options: [],
    potionsGranted: 0,
    worldRev: 0,
    propSeq: 1,
    bodies: [],
    piles: [],
    itemFlags: {},
    heroHidden: false,
    sneaking: false,
    doorLockDc: DEFAULT_LOCK_DC,
    dmJournal: [],
    rollJournal: [],
  };
  // The scene's creatures, asleep in the east room.
  const kit = SCENE_KIT[template];
  addCreature(p, kit.monster, MONSTER_START);
  if (room === "two") addCreature(p, kit.second, SECOND_START);
  // The hero opens its eyes: the room it starts in is already seen.
  noteSight(p);
  return p;
}

/** The Room setting, shared across visits to the tab (and across a new hero or a reset) like the other settings. */
let roomChoice: RoomChoice = "one";

/** The Room setting's words: "One goblin", "Goblin and skeleton". */
function roomLabel(template: TemplateGenre, room: RoomChoice): string {
  const kit = SCENE_KIT[template];
  const first = statblockFor(kit.monster).name;
  return room === "one" ? `One ${first.toLowerCase()}` : `${first} and ${statblockFor(kit.second).name.toLowerCase()}`;
}

/**
 * Put a creature on the board (asleep, unseen, hostile, standing, carrying what its kind carries), and number it: the first of a scene is
 * "monster", the rest "monster-2", "monster-3". `over` changes any of it (an NPC is not hostile and is awake).
 */
function addCreature(p: PlayState, token: TileId, at: XY, over: Partial<Pick<Creature, "awake" | "hostile" | "npc" | "hp">> = {}): Creature {
  const id = p.creatureSeq === 1 ? MONSTER_ID : `${MONSTER_ID}-${p.creatureSeq}`;
  p.creatureSeq++;
  const n = (p.spawned[token] ?? 0) + 1;
  p.spawned[token] = n;
  const c: Creature = {
    id,
    token,
    n,
    at: { ...at },
    hp: over.hp ?? statblockFor(token).maxHp,
    awake: over.awake ?? false,
    seen: false,
    prone: false,
    carried: carriedBy(token),
    hostile: over.hostile ?? true,
    ...(over.npc ? { npc: over.npc } : {}),
    actor: newActor("left"),
  };
  p.creatures.push(c);
  return c;
}

// Module level, so leaving the tab and coming back finds the fight where it was.
let play: PlayState | null = null;

/** Lines that scrolled off the Log tab, or belong to a scene that has since been replaced: the debug export keeps them, the game does not. */
const sessionLog: LogLine[] = [];
function archiveLog(lines: readonly LogLine[]): void {
  sessionLog.push(...lines.map((l) => ({ text: l.text, tone: l.tone })));
  if (sessionLog.length > SESSION_LOG_KEEP) sessionLog.splice(0, sessionLog.length - SESSION_LOG_KEEP);
}

/**
 * A new PlayState takes the place of `from` (Reset scene, a new hero, a loaded save): the debug journals ride over to it, so the
 * export holds the whole adventure and not only the scene since the last reset, and the old scene's log is kept with a marker.
 */
function carryJournals(from: PlayState | null, to: PlayState, why: string): void {
  if (!from || from === to) return;
  to.dmJournal = from.dmJournal;
  to.rollJournal = from.rollJournal;
  archiveLog([...from.log, { text: `--- ${why} ---`, tone: "plain" }]);
}

// ---------------------------------------------------------------------------
// Save points (session/savePoints.ts decides what to keep and how it reads back;
// this is what the bench puts in one). A snapshot is the scene minus what only
// the picture needs (the two animated figures, the fight, the pending note, the
// DM's suggested moves) and with the explored squares written as text. Saves are
// only ever made while nothing is fighting (a long rest needs a calm scene, a
// checkpoint is a scene's start), so there is no fight to put back. They live in
// memory, and are mirrored to this browser's localStorage when it lets us.
// ---------------------------------------------------------------------------

/** 2 writes `creatures` (every creature, with its own seen, prone and carried). 1 is a save from before: one `monster` and the fields that went with it. */
const SNAPSHOT_VERSION = 2;
const LEGACY_SNAPSHOT_VERSION = 1;
const SAVES_STORAGE_KEY = "livingtable-bench-saves-v1";

type SnapshotBase = Omit<PlayState, "heroActor" | "creatures" | "room" | "spawned" | "creatureSeq" | "bodies" | "explored" | "exploredRev" | "round" | "note" | "options" | "dmJournal" | "rollJournal"> & {
  bodies: PlayBody[];
  /** One "1" (seen) or "0" per square, row-major: PlayState.explored as text. */
  explored: string;
};

type PlaySnapshot = SnapshotBase & {
  v: 2;
  room: RoomChoice;
  creatures: SavedCreature[];
  spawned: Record<string, number>;
  creatureSeq: number;
  /** The fight, when one is on: its order, whose turn it is and what each has left, so a save made mid-fight puts the fight back too. Left out (null) while exploring. */
  round?: CombatRound | null;
};

/** What a save from before creatures holds in their place (version 1): the one monster, whether it was seen, and what it carried. */
type LegacySnapshot = Omit<SnapshotBase, "bodies"> & {
  v: 1;
  bodies?: Omit<PlayBody, "token">[];
  monster: { at: XY; hp: number; awake: boolean; prone?: boolean } | null;
  monsterSeen: boolean;
  monsterCarried?: CarriedItem[];
};

/** Either shape: what a stored save may be. fromSnapshot puts both back as a scene with creatures. */
type StoredSnapshot = PlaySnapshot | LegacySnapshot;

const encodeExplored = (e: Uint8Array): string => Array.from(e, (b) => (b ? "1" : "0")).join("");
const decodeExplored = (s: string): Uint8Array => Uint8Array.from(s, (c) => (c === "1" ? 1 : 0));

/** A copy that later play cannot reach into. */
function toSnapshot(p: PlayState): PlaySnapshot {
  const { heroActor: _hero, creatures, explored, exploredRev: _rev, round, note: _note, options: _options, dmJournal: _dm, rollJournal: _rolls, ...rest } = p;
  // A creature's actor is the picture, not the scene.
  const saved: SavedCreature[] = creatures.map(({ actor: _actor, ...c }) => c);
  return JSON.parse(JSON.stringify({ ...rest, creatures: saved, round, v: SNAPSHOT_VERSION, explored: encodeExplored(explored) })) as PlaySnapshot;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const inRoom = (v: unknown): boolean => isRec(v) && isNum(v.x) && isNum(v.y) && Number.isInteger(v.x) && Number.isInteger(v.y) && v.x >= 0 && v.y >= 0 && v.x < CELL_WIDTH && v.y < CELL_HEIGHT;
const isSheetLike = (v: unknown): boolean => isRec(v) && isStr(v.name) && isStr(v.archetypeId) && isNum(v.currentHp) && isNum(v.maxHp) && Array.isArray(v.inventory) && isRec(v.modifiers);

/** Whether a stored payload is one this bench wrote and can put back whole. The envelope is savePoints.ts's; this guards the data inside. */
function isSnapshot(d: unknown): d is StoredSnapshot {
  if (!isRec(d) || (d.v !== SNAPSHOT_VERSION && d.v !== LEGACY_SNAPSHOT_VERSION)) return false;
  if (d.template !== "fantasy" && d.template !== "scifi") return false;
  const known = WALKABLE_BY_ID[d.template];
  if (!isStr(d.archetypeId) || !PLAYABLE_HEROES.includes(d.archetypeId as ArchetypeId)) return false;
  if (!isStr(d.floorId) || !known.has(d.floorId)) return false;
  if (!isSheetLike(d.hero) || !isSheetLike(d.start) || !isRec(d.itemNotes) || !Object.values(d.itemNotes).every(isStr)) return false;
  if (!inRoom(d.heroAt)) return false;
  if (d.v === SNAPSHOT_VERSION) {
    if (!ROOM_CHOICES.includes(d.room as RoomChoice) || !isNum(d.creatureSeq) || !isRec(d.spawned) || !Object.values(d.spawned).every(isNum)) return false;
    if (!Array.isArray(d.creatures) || !d.creatures.every((c) => isCreatureLike(c, known))) return false;
  } else {
    const m = d.monster;
    if (m !== null && !(isRec(m) && inRoom(m.at) && isNum(m.hp) && typeof m.awake === "boolean" && (m.prone === undefined || typeof m.prone === "boolean"))) return false;
    if (typeof d.monsterSeen !== "boolean") return false;
  }
  if (d.fallenAt !== null && !inRoom(d.fallenAt)) return false;
  if (typeof d.doorOpen !== "boolean" || typeof d.searched !== "boolean" || typeof d.doorLocked !== "boolean") return false;
  if (!isNum(d.potions) || !isNum(d.potionsGranted) || !isNum(d.worldRev) || !isNum(d.propSeq)) return false;
  if (!isStr(d.explored) || d.explored.length !== CELL_WIDTH * CELL_HEIGHT || !/^[01]+$/.test(d.explored)) return false;
  if (!Array.isArray(d.log) || !d.log.every((l) => isRec(l) && isStr(l.text) && (l.tone === "good" || l.tone === "bad" || l.tone === "plain" || l.tone === "dm"))) return false;
  if (!Array.isArray(d.extraProps) || !d.extraProps.every((e) => isRec(e) && isStr(e.id) && isStr(e.assetId) && known.has(e.assetId) && inRoom(e) && isStr(e.label) && (e.secret === undefined || isStr(e.secret)))) return false;
  if (!isRec(d.propSecrets) || !Object.values(d.propSecrets).every(isStr)) return false;
  if (!Array.isArray(d.tileOverrides) || !d.tileOverrides.every((o) => isRec(o) && inRoom(o) && isStr(o.tile) && known.has(o.tile))) return false;
  if (!Array.isArray(d.dmMemory) || !d.dmMemory.every(isStr)) return false;
  if (!Array.isArray(d.dmRecent) || !d.dmRecent.every((r) => isRec(r) && (r.who === "player" || r.who === "dm") && isStr(r.text))) return false;
  // Saves from before bodies, piles and item flags have none of these: they are optional here and filled in on load.
  if (d.bodies !== undefined && !(Array.isArray(d.bodies) && d.bodies.every(isBodyLike))) return false;
  if (d.v === LEGACY_SNAPSHOT_VERSION && d.monsterCarried !== undefined && !(Array.isArray(d.monsterCarried) && d.monsterCarried.every(isCarriedLike))) return false;
  if (d.piles !== undefined && !(Array.isArray(d.piles) && d.piles.every((q) => isRec(q) && inRoom(q.at) && Array.isArray(q.items) && q.items.every(isStr)))) return false;
  if (d.itemFlags !== undefined && !(isRec(d.itemFlags) && Object.values(d.itemFlags).every(isRec))) return false;
  // Hiding, sneaking and the lock's DC came later: an older save has none of them.
  if ((d.heroHidden !== undefined && typeof d.heroHidden !== "boolean") || (d.sneaking !== undefined && typeof d.sneaking !== "boolean") || (d.doorLockDc !== undefined && !isNum(d.doorLockDc))) return false;
  return true;
}

const isCarriedLike = (c: unknown): boolean => isRec(c) && isStr(c.name) && isStr(c.note) && isStr(c.kind) && typeof c.pocketable === "boolean";
const isBodyLike = (b: unknown): boolean =>
  isRec(b) && isStr(b.id) && isStr(b.name) && inRoom(b.at) && Array.isArray(b.items) && b.items.every(isCarriedLike) && typeof b.looted === "boolean" && typeof b.harvested === "boolean" && typeof b.beast === "boolean" && typeof b.engineLootRolled === "boolean" && (b.token === undefined || isStr(b.token));
const isCreatureLike = (c: unknown, known: Map<string, boolean>): boolean =>
  isRec(c) &&
  isStr(c.id) &&
  isStr(c.token) &&
  isNum(c.n) &&
  inRoom(c.at) &&
  isNum(c.hp) &&
  typeof c.awake === "boolean" &&
  typeof c.seen === "boolean" &&
  typeof c.prone === "boolean" &&
  typeof c.hostile === "boolean" &&
  Array.isArray(c.carried) &&
  c.carried.every(isCarriedLike) &&
  (c.npc === undefined || (isRec(c.npc) && isStr(c.npc.role))) &&
  known.has(c.token);

/**
 * The fight a snapshot holds, or null when it holds none or it does not fit the scene (a combatant with no creature, no hero, an index out of
 * range): a save is never refused for it, it just comes back as a scene with nobody fighting.
 */
function roundFromSnapshot(raw: unknown, creatures: readonly SavedCreature[]): CombatRound | null {
  if (!isRec(raw) || !Array.isArray(raw.order) || !isNum(raw.activeIndex) || !isNum(raw.roundNumber)) return null;
  const order = raw.order;
  const fits = order.every(
    (cb) => isRec(cb) && isStr(cb.id) && isStr(cb.label) && (cb.side === "player" || cb.side === "hostile") && isNum(cb.initiative) && isNum(cb.speedFt) && isRec(cb.economy) && (cb.side === "player" ? cb.id === HERO_ID : creatures.some((c) => c.id === cb.id && c.hostile)),
  );
  if (!fits || order.length === 0 || !order.some((cb) => (cb as Record<string, unknown>).id === HERO_ID) || raw.activeIndex < 0 || raw.activeIndex >= order.length) return null;
  return raw as unknown as CombatRound;
}

/** The scene a snapshot holds, as a fresh PlayState: new animated figures, the fight if one was on, no suggested moves. Null when it is not a snapshot. Reads both the shape with creatures and a save from before them (one monster). */
function fromSnapshot(data: unknown): PlayState | null {
  if (!isSnapshot(data)) return null;
  const s = JSON.parse(JSON.stringify(data)) as StoredSnapshot;
  const { explored, ...rest } = s;
  const kit = SCENE_KIT[rest.template];
  const old = rest as Partial<Pick<SnapshotBase, "piles" | "itemFlags" | "heroHidden" | "sneaking" | "doorLockDc">>;
  let creatures: Creature[];
  let room: RoomChoice;
  let spawned: Record<string, number>;
  let creatureSeq: number;
  let bodies: PlayBody[];
  if (s.v === SNAPSHOT_VERSION) {
    creatures = s.creatures.map((c) => ({ ...c, actor: newActor("left") }));
    room = s.room;
    spawned = s.spawned;
    creatureSeq = s.creatureSeq;
    // A body names its creature; one that does not (an older save) is the scene's first kind.
    bodies = (s.bodies as (BodyState & { token?: TileId })[]).map((b) => ({ ...b, token: b.token ?? kit.monster }));
  } else {
    // A save from before creatures: one monster (or none), whether it was seen, what it carried; its id is the one it always had.
    const m = s.monster;
    creatures = m
      ? [
          {
            id: MONSTER_ID,
            token: kit.monster,
            n: 1,
            at: { ...m.at },
            hp: m.hp,
            awake: m.awake,
            seen: s.monsterSeen,
            prone: m.prone === true,
            carried: s.monsterCarried ?? carriedBy(kit.monster),
            hostile: true,
            actor: newActor("left"),
          },
        ]
      : [];
    room = "one";
    spawned = { [kit.monster]: 1 };
    creatureSeq = 2;
    // A save from before bodies: a slain monster's loot went straight to the pack then, so its body is already searched.
    const legacyBodies = s.bodies ?? (s.fallenAt ? [{ ...bodyFor("body-1", kit.monster, s.fallenAt, []), looted: true, engineLootRolled: true }] : []);
    bodies = legacyBodies.map((b) => ({ ...b, token: kit.monster }));
  }
  const { v: _v, monster: _monster, monsterSeen: _seen, monsterCarried: _carried, creatures: _creatures, spawned: _spawned, creatureSeq: _seq, room: _room, bodies: _bodies, round: _round, ...scene } = rest as typeof rest & Record<string, unknown>;
  const p: PlayState = {
    ...(scene as Omit<SnapshotBase, "bodies" | "explored">),
    room,
    creatures,
    spawned,
    creatureSeq,
    bodies,
    piles: old.piles ?? [],
    itemFlags: old.itemFlags ?? {},
    heroHidden: old.heroHidden ?? false,
    sneaking: old.sneaking ?? false,
    doorLockDc: old.doorLockDc ?? DEFAULT_LOCK_DC,
    dmJournal: [],
    rollJournal: [],
    note: null,
    round: s.v === SNAPSHOT_VERSION ? roundFromSnapshot(s.round, s.creatures) : null,
    options: [],
    heroActor: newActor("down"),
    explored: decodeExplored(explored),
    exploredRev: 1,
  };
  noteSight(p);
  // A knocked-down creature is drawn lying there, as it was.
  for (const c of p.creatures) if (c.prone) playClips(c.actor, ["death"], performance.now());
  return p;
}

type SavedGame = SavePoint<StoredSnapshot>;
/** Newest first (savePoints.ts addSave). Module level, so leaving the tab and coming back keeps them. */
let saves: SavedGame[] = [];
let savesLoaded = false;

/** What is in this browser's storage; nothing when it is empty, unreadable or blocked. Never throws. */
function readStoredSaves(): SavedGame[] {
  try {
    return parseSaves<StoredSnapshot>(globalThis.localStorage?.getItem(SAVES_STORAGE_KEY), isSnapshot);
  } catch {
    return [];
  }
}

function writeStoredSaves(list: readonly SavedGame[]): void {
  try {
    globalThis.localStorage?.setItem(SAVES_STORAGE_KEY, serializeSaves(list));
  } catch {
    // Storage can be blocked, full or absent (a private window): the saves still work for this visit.
  }
}

/** Make a save of the scene as it is now (newest first, each kind trimmed on its own) and mirror it to storage. */
function addSavePoint(p: PlayState, kind: SaveKind, label: string): void {
  saves = addSave(saves, makeSavePoint(kind, label, toSnapshot(p)));
  writeStoredSaves(saves);
}

/** A line under a save in the Saves tab: who, how hurt, what is in the pack. */
function saveDetail(save: SavedGame): string {
  const h = save.data.hero;
  return `${h.name}, ${h.currentHp}/${h.maxHp} HP, ${save.data.potions} potion${save.data.potions === 1 ? "" : "s"}`;
}

const same = (a: XY, b: XY): boolean => a.x === b.x && a.y === b.y;

function sentence(text: string): string {
  const s = sentenceCase(text.trim());
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

// ---- creatures: finding them and naming them -------------------------------------

const creatureById = (p: PlayState, id: string): Creature | undefined => p.creatures.find((c) => c.id === id);
const creatureAt = (p: PlayState, at: XY): Creature | undefined => p.creatures.find((c) => same(c.at, at));
const hostilesOf = (p: PlayState): Creature[] => p.creatures.filter((c) => c.hostile);
const awakeHostiles = (p: PlayState): Creature[] => p.creatures.filter((c) => c.hostile && c.awake);

/** A creature's name: its statblock's ("Goblin"), the role of one that is somebody, and a number after it ("Rat 2") while the scene has more than one of its kind. */
function creatureName(p: PlayState, c: Creature): string {
  const base = c.npc ? sentenceCase(c.npc.role) : statblockFor(c.token).name;
  return !c.npc && (p.spawned[c.token] ?? 0) > 1 ? `${base} ${c.n}` : base;
}

/** "the goblin", "the rat 2", "the innkeeper": a creature in a sentence. */
const creatureLabel = (p: PlayState, c: Creature): string => `the ${creatureName(p, c).toLowerCase()}`;

/** The plural of a kind's name, for a group ("Rats"). */
const pluralName = (name: string): string => (/(s|x|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`);

function heroDown(p: PlayState): boolean {
  return p.hero.downed || p.hero.stable || p.hero.dead;
}

function sceneTiles(p: PlayState): TileId[][] {
  const wall = SCENE_KIT[p.template].wall;
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) => {
      const edge = x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1;
      const divider = x === DIVIDER_X && y !== DOOR_AT.y;
      if (edge || divider) return wall;
      return DRAIN_AT.some((d) => same(d, { x, y })) ? DRAIN_TILE[p.template] : p.floorId;
    }),
  );
  // What the DM changed rides on top; it can never reach the border (the effect is refused there).
  for (const o of p.tileOverrides) {
    const row = tiles[o.y];
    if (row && o.x >= 0 && o.x < row.length) row[o.x] = o.tile;
  }
  return tiles;
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
    // Props the DM placed: the engine, the picture, sight and walking all read them from here.
    ...p.extraProps.map((e) => ({ id: e.id, assetId: e.assetId, x: e.x, y: e.y, label: e.label })),
  ];
}

/**
 * The scene as a layout. `forDisplay` is the picture the player gets: a creature
 * the hero cannot see this moment is left out (remembered squares never show
 * creatures). The engine's own view (engineLayout) always has every one.
 */
function sceneLayout(p: PlayState, animated: boolean, forDisplay = false): CellLayout {
  // Animated, the panel draws the hero and the creatures itself over the scene
  // (cast.ts); otherwise all of them are tokens the game's own renderCell composites.
  if (animated) return { tiles: sceneTiles(p), props: sceneProps(p), tokens: [], exits: [], sealed: true };
  const tokens: PlacedToken[] = [{ id: HERO_ID, assetId: bodySpriteId(p.archetypeId), x: p.heroAt.x, y: p.heroAt.y, kind: "pc" }];
  for (const c of p.creatures) {
    if (forDisplay && !creatureInSight(p, c)) continue;
    tokens.push({ id: c.id, assetId: c.token, x: c.at.x, y: c.at.y, kind: c.hostile ? "monster" : "npc", currentHp: c.hp });
  }
  return { tiles: sceneTiles(p), props: sceneProps(p), tokens, exits: [], sealed: true };
}

/** What stops anyone standing on `at`: the room's edge, a wall tile, or a prop whose sprite is not walkable (a closed door, the container). Tokens are checked by the caller. */
function terrainBlocks(p: PlayState, tiles: TileId[][], at: XY): "edge" | "wall" | "door" | "container" | "prop" | null {
  if (at.x < 0 || at.y < 0 || at.x >= CELL_WIDTH || at.y >= CELL_HEIGHT) return "edge";
  const walkable = WALKABLE_BY_ID[p.template];
  if (walkable.get(tiles[at.y]![at.x]!) !== true) return "wall";
  for (const prop of sceneProps(p)) {
    if (same(prop, at) && walkable.get(prop.assetId) === false) return prop.id === "door" ? "door" : prop.id === "container" ? "container" : "prop";
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

/**
 * A slain creature leaves its body where it fell: everything it still carried (what a pickpocket left it with), nothing else.
 * The engine's own loot roll is made when the body is first searched (ensureBodyLoot), so a body nobody opens costs no roll.
 * Any kill (the Attack button, or a DM effect) goes through here.
 */
function leaveBody(p: PlayState, c: Creature): PlayBody {
  const body: PlayBody = { ...bodyFor(`body-${p.bodies.length + 1}`, c.token, c.at, c.carried), token: c.token };
  p.bodies.push(body);
  c.carried = [];
  p.log.push({ text: `${sentenceCase(creatureLabel(p, c))} lies where it fell. Click the body, or stand next to it and press E, to search it.`, tone: "plain" });
  return body;
}

/** Rolls the game's own loot; false when the cell's loot ledger is spent (the log says so). */
function rollLoot(p: PlayState, source: "fight" | "container"): boolean {
  const { sheet, roll } = lootFor(p.hero, { source, cx: 0, cy: 0 });
  p.hero = sheet;
  if (!roll) {
    p.log.push({ text: LOOT_CAP_LINE, tone: "plain" });
    return false;
  }
  const name = roll.item ? gearItemName(p.archetypeId, roll.item.slot, roll.item.tier) : null;
  p.log.push({ text: lootLine(roll, name), tone: roll.item ? "good" : "plain", ...(roll.item && name ? { notice: `+ ${name}` } : {}) });
  return true;
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

/**
 * The engine's view of a template's assets: tile walkability and blocking props
 * from each sprite's own walkable flag, plus the sight flag (`opaque`), as
 * manifestCache.ts builds it for the game, through the same isOpaqueAssetId.
 */
function worldManifestFor(template: TemplateGenre): AssetManifest {
  const m: AssetManifest = { tiles: {}, props: {}, tokens: {} };
  for (const s of SPRITES_BY_TEMPLATE[template]) {
    if (s.kind === "tile") m.tiles[s.assetId] = { walkable: s.walkable, opaque: isOpaqueAssetId("tile", s.assetId, s.walkable) };
    else if (s.kind === "prop") m.props[s.assetId] = { blocks: !s.walkable, opaque: isOpaqueAssetId("prop", s.assetId, s.walkable) };
    else m.tokens[s.assetId] = {};
  }
  return m;
}
const WORLD_MANIFEST: Record<TemplateGenre, AssetManifest> = { fantasy: worldManifestFor("fantasy"), scifi: worldManifestFor("scifi") };

/** The scene as the engine sees it: the room plus both figures as tokens. */
function engineLayout(p: PlayState): CellLayout {
  return sceneLayout(p, false);
}

// ---------------------------------------------------------------------------
// Sight and the fog of war: all of it the engine's world/visibility.ts, so the
// bench and the game cannot disagree about what a closed door hides. Three
// levels per square: 2 in sight now, 1 seen before, 0 never seen.
// ---------------------------------------------------------------------------

interface SightKit {
  /** The sight grid, [y][x]: true where a square stops a look. */
  opaque: boolean[][];
  /** Whether two squares can see each other (lineOfSightFor: the attack check's own rule). */
  los: (from: XY, to: XY) => boolean;
}

/** Everything the grid depends on: the tiles (template and floor), the door, and whatever the DM changed (worldRev). Nothing else in the scene stops a look. */
const sightKey = (p: PlayState): string => `${p.template}|${p.floorId}|${p.doorOpen ? 1 : 0}|${p.worldRev}`;

let kitCache: { key: string; kit: SightKit } | null = null;
function sightKit(p: PlayState): SightKit {
  const key = sightKey(p);
  if (kitCache?.key === key) return kitCache.kit;
  const layout = engineLayout(p);
  const manifest = WORLD_MANIFEST[p.template];
  const kit: SightKit = { opaque: sightBlockers(layout, manifest), los: lineOfSightFor(layout, manifest) };
  kitCache = { key, kit };
  return kit;
}

let visibleCache: { key: string; visible: boolean[][] } | null = null;
/** What the hero sees right now, [y][x]. */
function heroSees(p: PlayState): boolean[][] {
  const key = `${sightKey(p)}|${p.heroAt.x},${p.heroAt.y}`;
  if (visibleCache?.key === key) return visibleCache.visible;
  const visible = visibleFrom(sightKit(p).opaque, p.heroAt);
  visibleCache = { key, visible };
  return visible;
}

/** Whether the hero sees this square now. */
const seesTile = (p: PlayState, at: XY): boolean => heroSees(p)[at.y]?.[at.x] === true;
/** Whether the hero has this creature in sight now. A creature out of sight is never drawn, outlined, clicked or attacked. */
const creatureInSight = (p: PlayState, c: Creature): boolean => seesTile(p, c.at);
/** The creatures the hero sees now. */
const creaturesInSight = (p: PlayState): Creature[] => p.creatures.filter((c) => seesTile(p, c.at));
/** Any hostile in sight, asleep or not. */
const hostileInSight = (p: PlayState): boolean => p.creatures.some((c) => c.hostile && seesTile(p, c.at));

/** 2 in sight now, 1 seen before, 0 never seen. */
function sightLevel(p: PlayState, at: XY): 0 | 1 | 2 {
  if (seesTile(p, at)) return 2;
  return p.explored[at.y * CELL_WIDTH + at.x] ? 1 : 0;
}

/** After anything that changes what the hero can see (a step, a door, a creature moving, a new scene): remember what is in sight now, and note which creatures have been seen. */
function noteSight(p: PlayState): void {
  const visible = heroSees(p);
  let gained = false;
  for (let y = 0; y < visible.length && !gained; y++) {
    const row = visible[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x] && !p.explored[y * CELL_WIDTH + x]) {
        gained = true;
        break;
      }
    }
  }
  if (gained) {
    p.explored = mergeExplored(p.explored, visible);
    p.exploredRev++;
  }
  for (const c of p.creatures) if (!c.seen && seesTile(p, c.at)) c.seen = true;
}

/** What the readout calls a creature: its name once the hero has seen it, "???" before. */
const foeName = (p: PlayState, c: Creature): string => (c.seen ? creatureName(p, c) : "???");

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

/** The creature whose turn it is, or undefined while it is the hero's (or no fight is on). */
function activeCreature(p: PlayState): Creature | undefined {
  const a = p.round ? activeCombatant(p.round) : undefined;
  return a && a.side === "hostile" ? creatureById(p, a.id) : undefined;
}

/**
 * Every square the hero can walk to now, with what it costs. A walk goes only
 * through squares the hero has seen: the others are walled off for the search,
 * so a path never runs into fog (and never gives away what is in it).
 */
function heroField(p: PlayState): MovementField {
  const layout = engineLayout(p);
  const wall = SCENE_KIT[p.template].wall;
  const known = { ...layout, tiles: layout.tiles.map((row, y) => row.map((id, x) => (p.explored[y * CELL_WIDTH + x] ? id : wall))) };
  return movementField(known, WORLD_MANIFEST[p.template], HERO_ID, p.heroAt, heroBudgetFt(p));
}

function heroReachTiles(p: PlayState): number {
  return weaponFor(p.hero).ranged ? DEFAULT_RANGED_REACH_TILES : DEFAULT_MELEE_REACH_TILES;
}

/** Why the hero cannot stand on `to`, in words. */
function blockedWords(p: PlayState, to: XY): string {
  const kit = SCENE_KIT[p.template];
  if (sightLevel(p, to) === 0) return NOT_SEEN;
  const blocked = terrainBlocks(p, sceneTiles(p), to);
  if (blocked === "door") return p.doorLocked ? `${sentenceCase(kit.doorLabel)} is locked.` : `${sentenceCase(kit.doorLabel)} is closed. Click it when you are next to it to open it.`;
  if (blocked === "container") return `${sentenceCase(kit.containerLabel)} is in the way.`;
  if (blocked === "prop") return `${sentence(p.extraProps.find((e) => same(e, to))?.label ?? "something")} is in the way.`;
  if (blocked) return "A wall. You cannot walk through it.";
  const there = creatureAt(p, to);
  if (there && creatureInSight(p, there)) return `${sentenceCase(creatureLabel(p, there))} is in the way.`;
  if (p.round && heroBudgetFt(p) < FEET_PER_TILE) return "No movement left this turn. Attack, or end your turn.";
  return p.round ? "Too far to walk this turn." : "You cannot get there from here.";
}

/**
 * Whether this sleeping hostile notices the hero, which is when it joins a fight (or starts one): the two
 * see each other within MONSTER_WAKE_TILES (the engine's own sight, so a closed
 * door hides the hero), or a walking path to the hero is MONSTER_HEARS_STEPS or
 * fewer (it hears you). Each creature asks for itself.
 */
function creatureNotices(p: PlayState, c: Creature): boolean {
  if (!c.hostile || c.awake || heroDown(p)) return false;
  if (tileDistance(c.at, p.heroAt) <= MONSTER_WAKE_TILES && canSeeEachOther(sightKit(p).opaque, c.at, p.heroAt)) return true;
  const path = pathToward(p, sceneTiles(p), c.at, p.heroAt);
  return path !== null && path.steps <= MONSTER_HEARS_STEPS;
}

/** The sleeping hostiles that notice the hero now. */
const noticers = (p: PlayState): Creature[] => p.creatures.filter((c) => creatureNotices(p, c));

// ---------------------------------------------------------------------------
// Hiding, and what a hostile notices. The engine's maneuvers (session/maneuvers.ts) roll the
// checks; these are the board's side of them.
// ---------------------------------------------------------------------------

/**
 * Every die the engine rolls on the table (a kick, a shove, a Stealth check, a swing) draws from here. A test installs
 * globalThis.__ltBenchRng (a function returning a number from 0 up to, not including, 1) to make a roll land where it needs to.
 */
const benchRng = (): number => {
  const hook = (globalThis as { __ltBenchRng?: unknown }).__ltBenchRng;
  if (typeof hook === "function") {
    const v = (hook as () => unknown)();
    if (typeof v === "number" && v >= 0 && v < 1) return v;
  }
  return Math.random();
};

/** Sneaking, or hidden: a step that would let a hostile notice the hero rolls Stealth against its passive Perception instead. */
const stealthy = (p: PlayState): boolean => p.sneaking || p.heroHidden;

/** Whether this creature could see the hero right now: the two see each other (a wall or a shut door stops it). */
const creatureCouldSee = (p: PlayState, c: Creature): boolean => canSeeEachOther(sightKit(p).opaque, c.at, p.heroAt);

/** A creature's passive Perception, the DC for Hide, Sneak and Pickpocket. */
const creaturePassive = (c: Creature): number => monsterPassivePerception(c.token);

/** The creature's bestiary entry when it has one (the goblin, the skeleton), else its statblock: what a contest reads its skills from. */
function creatureStats(c: Creature): Beast | MonsterStatblock {
  return BESTIARY.find((b) => b.tokenAssetId === c.token) ?? statblockFor(c.token);
}

/** What a context menu needs to know about a creature: its SRD type and size, and whether it is a person (pockets, speech). */
function creatureKind(c: Creature): { type: string; size: string; humanoid: boolean } {
  const beast = BESTIARY.find((b) => b.tokenAssetId === c.token);
  const type = beast?.type ?? (c.token === "token_drone" ? "construct" : "humanoid");
  return { type, size: monsterShoveProfile(c.token).size, humanoid: (type.split("(")[0] ?? "").trim().toLowerCase() === "humanoid" };
}

/** A creature's modifier on an ability (a contest against "dex" reads its Dexterity), from its bestiary entry or statblock. */
function creatureAbility(c: Creature, key: "str" | "dex" | "con" | "int" | "wis" | "cha"): number {
  const s = creatureStats(c);
  return "scores" in s ? abilityMod(s.scores[key]) : s.abilityModifiers[key];
}

/** What a fight lists for a creature in startCombat. */
const hostileEntry = (p: PlayState, c: Creature): { id: string; label: string; speedFt: number } => ({ id: c.id, label: creatureLabel(p, c), speedFt: MONSTER_SPEED_FT });

/** What a creature is called in a line that may be about something the hero has not seen: its label once seen, "something" before. */
const knownLabel = (p: PlayState, c: Creature): string => (c.seen ? creatureLabel(p, c) : "something");

/** A combatant's id as words for a line: the creature's label once seen, "something" before. */
function knownLabelOf(p: PlayState, id: string): string {
  const c = creatureById(p, id);
  return c ? knownLabel(p, c) : "something";
}

/**
 * Roll initiative with the game's own startCombat: d20 plus Dexterity for the hero, the engine's fixed bonus for each hostile. `wake` are
 * the creatures that started it (they notice the hero, or the hero struck them, or the DM woke them): they wake, and every hostile
 * that is awake is in the order.
 */
function startFight(p: PlayState, fromHiding = false, wake: readonly Creature[] = []): void {
  for (const c of wake) if (c.hostile) c.awake = true;
  const foes = awakeHostiles(p);
  if (foes.length === 0) return;
  // A fight starts in the open: whatever hiding the hero had is over. The exception is the hero starting it with a strike from hiding
  // (an attack, a kick, a shove): that strike has advantage and is what ends the hiding (landSwing), unless a hostile's turn comes first.
  if (!fromHiding) {
    if (p.heroHidden) p.log.push({ text: "You are no longer hidden.", tone: "plain" });
    p.heroHidden = false;
    p.sneaking = false;
  }
  p.round = startCombat({
    player: { id: HERO_ID, label: p.hero.name, dexModifier: p.hero.modifiers.dex, speedFt: effectiveSpeedFt(p.hero) },
    hostiles: foes.map((c) => hostileEntry(p, c)),
  });
  const order = p.round.order.map((cb) => `${cb.id === HERO_ID ? p.hero.name : sentenceCase(knownLabelOf(p, cb.id))} ${cb.initiative}`).join(", ");
  p.log.push({ text: `Roll initiative! ${order}.`, tone: "plain" });
}

/**
 * A sleeping hostile joins a fight that is already on (it noticed the hero, was struck, or the DM woke it): it wakes and rolls its own
 * initiative with startCombat's own bonus and dice, and takes its place in the order. Nobody's turn moves: if it sorts before whoever
 * is acting it first acts next round, otherwise later this round. Returns its initiative, or null when it was not a hostile or is already in.
 */
function joinFight(p: PlayState, c: Creature): number | null {
  const round = p.round;
  if (!round || !c.hostile || round.order.some((cb) => cb.id === c.id)) return null;
  c.awake = true;
  // startCombat rolls and sorts; ask it for just this creature (a throwaway hero beside it) and take the creature's combatant.
  const rolled = startCombat({ player: { id: HERO_ID, label: p.hero.name, dexModifier: 0, speedFt: 0 }, hostiles: [hostileEntry(p, c)] }).order.find((cb) => cb.id === c.id)!;
  let at = round.order.findIndex((cb) => cb.initiative < rolled.initiative);
  if (at < 0) at = round.order.length;
  const order = [...round.order.slice(0, at), rolled, ...round.order.slice(at)];
  p.round = { ...round, order, activeIndex: at <= round.activeIndex ? round.activeIndex + 1 : round.activeIndex };
  p.log.push({ text: `${sentenceCase(knownLabel(p, c))} joins the fight. Initiative ${rolled.initiative}.`, tone: "plain" });
  return rolled.initiative;
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
  noteSight(p);
  return { events: [{ kind: "move", tokenId: HERO_ID, from, path: [{ ...to }] }], refused: null };
}

/** The dice behind a swing, for the dice tray: every d20 thrown and, on a hit, every damage die. */
interface SwingDice {
  /** The d20 that counted. */
  roll: number;
  /** Every d20 thrown, in order: two when advantage or disadvantage applied. */
  d20s: number[];
  /** "advantage" or "disadvantage" when the roll had one. */
  mode: RollMode | null;
  /** Why it had one, in words for the log. */
  modeWhy: string[];
  modifier: number;
  total: number;
  target: number;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  /** Damage dice. A kick has none (1 plus Strength, a flat number): `rolls` is empty and `total` is the number. */
  damage?: { rolls: number[]; sides: number; modifier: number; total: number };
}

/** A swing at a creature, rolled but not yet landed, so the tray can show it before the scene changes. */
interface Swing {
  dice: SwingDice;
  result: AttackResult;
  bonus: number;
  targetAC: number;
  sources: ReturnType<typeof bonusSources>;
  /** A kick (an unarmed strike) rather than the weapon in the hero's hand. */
  kick: boolean;
  /** The maneuver's own log line, for a kick. A weapon swing builds its line when it lands. */
  kickLine?: string;
}

/**
 * The roll mode a swing at this creature has, and why, from the SRD's own rules: advantage when the hero is hidden (an unseen
 * attacker) and when the target is prone and within 5 feet; disadvantage when it is prone and farther off. `asked` is the mode
 * a DM check carries. Advantage and disadvantage cancel.
 */
function swingMode(p: PlayState, m: Creature, asked?: "advantage" | "disadvantage"): { advantage: boolean; disadvantage: boolean; mode: RollMode | null; why: string[] } {
  const why: string[] = [];
  let adv = asked === "advantage";
  let dis = asked === "disadvantage";
  if (asked) why.push(asked === "advantage" ? "the DM gave you advantage" : "the DM gave you disadvantage");
  if (p.heroHidden) {
    adv = true;
    why.push("you were hidden");
  }
  if (m.prone) {
    const feet = tileDistance(p.heroAt, m.at) * FEET_PER_TILE;
    if (proneAttackMode(feet) === "advantage") {
      adv = true;
      why.push("it is prone and you are next to it");
    } else {
      dis = true;
      why.push("it is prone and you are not next to it");
    }
  }
  if (adv && dis) return { advantage: false, disadvantage: false, mode: null, why: ["advantage and disadvantage cancel out"] };
  return { advantage: adv, disadvantage: dis, mode: adv ? "advantage" : dis ? "disadvantage" : null, why };
}

/** The hero's swing at a creature, rolled with the game's own dice but NOT applied: the weapon in hand, or a kick (an unarmed strike, with its own damage and no weapon bonuses). */
function rollSwing(p: PlayState, m: Creature, kind: "weapon" | "kick", asked?: "advantage" | "disadvantage"): Swing {
  const targetAC = monsterArmorClassFor(m.token);
  const mode = swingMode(p, m, asked);
  if (kind === "kick") {
    const k = unarmedStrike({ attacker: p.hero, targetAC, ...(mode.mode ? { advantage: mode.mode } : {}), rng: benchRng, label: "Kick" });
    const bonus = p.hero.modifiers.str + p.hero.proficiencyBonus;
    const fumble = k.roll === 1;
    const dice: SwingDice = {
      roll: k.roll,
      d20s: k.dice.map((d) => d.result),
      mode: mode.mode,
      modeWhy: mode.why,
      modifier: bonus,
      total: k.total,
      target: targetAC,
      hit: k.hit,
      critical: k.critical,
      fumble,
      ...(k.hit ? { damage: { rolls: [], sides: 0, modifier: k.damage, total: k.damage } } : {}),
    };
    return { dice, result: { roll: k.roll, total: k.total, hit: k.hit, critical: k.critical, fumble }, bonus, targetAC, sources: undefined, kick: true, kickLine: k.line };
  }
  const bonus = attackerBonusFor(p.hero);
  const sources = bonusSources(attackBonusSourcesFor(p.hero), bonus);
  // The engine rolls the d20 once or twice; watching its draws puts every die in the tray.
  const draws: number[] = [];
  const watching = (): number => {
    const v = benchRng();
    draws.push(v);
    return v;
  };
  const result = resolveAttack({ attackerBonus: bonus, targetAC, advantage: mode.advantage, disadvantage: mode.disadvantage, rng: watching });
  const notation = weaponDamageNotationFor(p.hero);
  const rolled = result.hit ? resolveDamage(notation, benchRng, result.critical) : null;
  const parsed = parseDiceNotation(notation);
  const dice: SwingDice = {
    roll: result.roll,
    d20s: draws.map((v) => Math.floor(v * 20) + 1),
    mode: mode.mode,
    modeWhy: mode.why,
    modifier: bonus,
    total: result.total,
    target: targetAC,
    hit: result.hit,
    critical: result.critical,
    fumble: result.fumble,
    ...(rolled ? { damage: { rolls: rolled.rolls, sides: parsed.sides, modifier: parsed.modifier, total: rolled.total } } : {}),
  };
  return { dice, result, bonus, targetAC, sources, kick: false };
}

/**
 * A slain creature: it leaves the board and the fight, and the body lies where it fell. The fight goes on while any hostile is left in it,
 * and ends with the last; when no hostile is awake any more the day turns over so the hero can make camp (health.ts newAdventuringDay).
 */
function slayCreature(p: PlayState, c: Creature): void {
  if (!p.creatures.includes(c)) return;
  p.fallenAt = { ...c.at };
  p.creatures = p.creatures.filter((x) => x !== c);
  if (p.round) {
    const rest = dropCombatant(p.round, c.id);
    p.round = hasHostiles(rest) ? rest : null;
  }
  // The kill drops nothing in the pack: the body lies where it fell, and the loot is found by searching it (leaveBody).
  leaveBody(p, c);
  if (awakeHostiles(p).length === 0) {
    p.round = null;
    p.hero = newAdventuringDay(p.hero);
  }
}

/** Attacking from hiding gives the hero away. */
function revealHero(p: PlayState): void {
  if (p.heroHidden) p.log.push({ text: "Attacking gives you away: you are no longer hidden.", tone: "plain" });
  p.heroHidden = false;
  p.sneaking = false;
}

/**
 * Land a rolled swing: the damage (the swing's own, or `opts.damage` when something else decided it), the log line, a kill and the
 * events the board floats. `spend` takes the hero's action in a fight (a DM check has already paid for it).
 */
function landSwing(p: PlayState, m: Creature, sw: Swing, opts: { spend: boolean; damage?: number }): CombatEvent[] {
  const label = creatureLabel(p, m);
  const d = sw.dice;
  const damage = opts.damage ?? (d.hit ? d.damage?.total : undefined);
  let down = false;
  const hpBefore = m.hp;
  if (damage !== undefined) {
    const hurt = damageMonster({ assetId: m.token, currentHp: m.hp }, damage);
    m.hp = hurt.currentHp;
    down = hurt.down;
  }
  if (opts.spend && p.round) p.round = spendActiveAction(p.round) ?? p.round;
  const base = sw.kick
    ? `${sw.kickLine ?? "Kick."}${down ? ` ${sentenceCase(label)} goes down.` : ""}`
    : attackLine({
        attacker: p.hero.name,
        target: label,
        roll: d.roll,
        modifier: d.modifier,
        total: d.total,
        targetAC: sw.targetAC,
        hit: d.hit,
        critical: d.critical,
        fumble: d.fumble,
        damage,
        targetDown: down,
        targetHpLeft: d.hit && !down ? m.hp : undefined,
        sources: sw.sources,
      });
  const modeNote = d.mode ? ` Rolled with ${d.mode} (${d.modeWhy.join(", ")}): ${d.d20s.join(" and ")}, kept ${d.roll}.` : "";
  p.log.push({ text: `${base}${modeNote}`, tone: d.hit ? "good" : "bad" });
  const readout = { ...attackResultToReadout(sw.result, sw.bonus, sw.targetAC, sw.sources), caption: `${p.hero.name} ${sw.kick ? "kicks" : "attacks"} ${label}`, critical: d.critical, fumble: d.fumble };
  const events = attackEvents({ by: HERO_ID, against: m.id, result: sw.result, readout, damage, hpLost: hpBefore - m.hp, down });
  if (down) slayCreature(p, m);
  revealHero(p);
  return events;
}
/** Why the hero cannot swing at this creature right now (the game's reach, sight and turn rules), or null. */
function heroAttackRefusal(p: PlayState, m: Creature | undefined): string | null {
  if (heroDown(p)) return DOWN_NOTE;
  if (!m || !m.hostile) return "Nothing left to fight. Press Reset scene to bring it back.";
  if (!creatureInSight(p, m)) return "You do not see anything to attack.";
  const blocked = attackBlockedReason({
    round: p.round,
    attackerAt: p.heroAt,
    targetAt: m.at,
    downed: false,
    reachTiles: heroReachTiles(p),
    hasLineOfSight: sightKit(p).los(p.heroAt, m.at),
  });
  return blocked ? sentence(blocked) : null;
}

/**
 * The hero's swing at one creature, rolled with the game's own dice but NOT yet applied, so
 * the dice tray can show the roll before the scene changes: `apply` lands the
 * blow (hit points, the log, a kill) and returns its events.
 */
function heroAttackRules(p: PlayState, m: Creature): { refused: string } | { refused: null; dice: SwingDice; swing: Swing; apply: () => CombatEvent[] } {
  const refused = heroAttackRefusal(p, m);
  if (refused) return { refused };
  const swing = rollSwing(p, m, "weapon");
  return { refused: null, dice: swing.dice, swing, apply: () => landSwing(p, m, swing, { spend: true }) };
}
/** The door or the chest next to the hero. Free in a fight, like any small object interaction. */
function heroInteractRules(p: PlayState): TurnResult {
  if (heroDown(p)) return refusedWith(DOWN_NOTE);
  if (p.round && !isPlayersTurn(p.round)) return refusedWith("Wait for your turn.");
  const kit = SCENE_KIT[p.template];
  const near = (at: XY) => tileDistance(p.heroAt, at) <= 1;
  if (near(DOOR_AT)) {
    if (!p.doorOpen) {
      if (p.doorLocked) return refusedWith("Locked.");
      p.doorOpen = true;
      p.log.push({ text: `You open ${kit.doorLabel}.`, tone: "plain" });
    } else if (same(p.heroAt, DOOR_AT)) {
      return refusedWith("You are standing in the doorway. Step out of it first.");
    } else if (creatureAt(p, DOOR_AT)) {
      return refusedWith(`${sentenceCase(creatureLabel(p, creatureAt(p, DOOR_AT)!))} is standing in the doorway.`);
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
  // A door opened or shut changes what the hero sees.
  noteSight(p);
  return { events: [], refused: null };
}

/** Whether the door or the chest is next to the hero and can be used now (the Use button's own test for them). */
function doorOrChestUsable(p: PlayState): boolean {
  const doorUsable = tileDistance(p.heroAt, DOOR_AT) <= 1 && !p.doorLocked && !same(p.heroAt, DOOR_AT) && !creatureAt(p, DOOR_AT);
  return doorUsable || (tileDistance(p.heroAt, CONTAINER_AT) <= 1 && !p.searched);
}

/** Why the hero cannot make camp right now, in words: the sheet's own day rule, then the table's (no fight, nothing hostile awake or in sight). Null when it can. */
function restRefusal(p: PlayState): string | null {
  if (heroDown(p)) return DOWN_NOTE;
  return restBlockedReason(p.hero, { inFight: p.round !== null, hostileAwake: awakeHostiles(p).length > 0, hostileInSight: hostileInSight(p) });
}

const POTION_NOTATION = "2d4+2";
/** The d4s the last potion rolled, for the dice tray. */
let lastPotionDice: number[] = [];

/**
 * A healing potion, with the game's own Potion of Healing dice and applyHealing. It takes the action in a fight.
 * `kit` names one of the sheet's other healing consumables (a Healer's kit, a Medfoam injector): the same 2d4+2 every
 * consumable heals (inventory/itemInfo.ts), and it spends one of that item's own uses instead of a potion.
 */
function drinkPotionRules(p: PlayState, kit?: string): TurnResult {
  if (p.hero.dead) return refusedWith(DOWN_NOTE);
  const kitAt = kit ? (p.hero.consumables ?? []).findIndex((c) => c.name === kit) : -1;
  if (kit && (kitAt < 0 || p.hero.consumables[kitAt]!.uses <= 0)) return refusedWith("None left.");
  if (!kit && p.potions <= 0) return refusedWith("No potions left.");
  if (p.round && !heroActionReady(p)) return refusedWith(p.round && !isPlayersTurn(p.round) ? "Wait for your turn." : "You have already taken your action this turn.");
  if (!heroDown(p) && p.hero.currentHp >= p.hero.maxHp) return refusedWith("You are already at full health.");
  const before = p.hero.currentHp;
  // characters/health.ts potionHealing's own notation (SRD 5.1 Potion of Healing), rolled here so the tray can show each die.
  const heal = rollDice(POTION_NOTATION);
  lastPotionDice = heal.rolls;
  const outcome = applyHealing(p.hero, heal.total);
  p.hero = outcome.sheet;
  if (kit) p.hero = { ...p.hero, consumables: p.hero.consumables.map((c, i) => (i === kitAt ? { ...c, uses: c.uses - 1 } : c)) };
  else p.potions--;
  if (p.round) p.round = spendActiveAction(p.round) ?? p.round;
  p.log.push({ text: `${p.hero.name} ${kit ? `uses the ${kit}` : "drinks a potion of healing"}. ${outcome.note}`, tone: "good" });
  return { events: [{ kind: "heal", tokenId: HERO_ID, amount: p.hero.currentHp - before }], refused: null };
}

/**
 * One creature's whole turn, by the game's own resolveMonsterTurn on a World
 * built from this scene (every creature a token in it): it paths round walls,
 * and other creatures, walks what its movement pays for and swings if it can.
 * Returns the events and the scene it ends in, WITHOUT applying them, so the
 * panel can walk the creature square by square and land the blow when the swing plays.
 */
function monsterTurnRules(p: PlayState, m: Creature): { events: CombatEvent[]; endAt: XY | null; sheet: CharacterSheet; lines: LogLine[] } {
  if (!p.round) return { events: [], endAt: null, sheet: p.hero, lines: [] };
  // A creature that was knocked prone spends half its movement standing up before anything else (SRD 5.1): the engine's own
  // resolveMonsterTurn is simply given less movement, so it walks less far (or not at all) and still swings if it can reach.
  let economy = activeCombatant(p.round)?.economy;
  let standLine: LogLine | null = null;
  if (m.prone && economy) {
    const cost = Math.min(economy.movementRemaining, standUpCostFt(MONSTER_SPEED_FT));
    economy = { ...economy, movementRemaining: economy.movementRemaining - cost };
    m.prone = false;
    playClips(m.actor, ["idle"], performance.now());
    standLine = { text: `${sentenceCase(creatureLabel(p, m))} spends ${cost} feet of its movement to stand up.`, tone: "plain" };
  }
  const world = setCell(emptyWorld(), SCENE_CELL, engineLayout(p));
  const out = resolveMonsterTurn({
    world,
    cell: SCENE_CELL,
    manifest: WORLD_MANIFEST[p.template],
    monsterId: m.id,
    playerTokenId: HERO_ID,
    sheet: p.hero,
    namer: namerFor(p),
    economy,
  });
  p.round = withActiveEconomy(p.round, out.economy);
  const after = getCell(out.world, SCENE_CELL)?.tokens.find((t) => t.id === m.id);
  const lines: LogLine[] = standLine ? [standLine] : [];
  const seen = new Set<string>();
  for (const l of out.lines) {
    seen.add(l.text);
    lines.push({ text: l.text, tone: l.hit ? "good" : "bad" });
  }
  for (const s of out.story) if (!seen.has(s)) lines.push({ text: sentence(s), tone: "plain" });
  return { events: out.events, endAt: after ? { x: after.x, y: after.y } : null, sheet: out.sheet, lines };
}

// ---------------------------------------------------------------------------
// The DM's side of the scene (dm.ts is the model and the validation; this is
// the room). The DM knows everything, so the view below is the whole scene
// as a char grid plus every feature with its secret. What it may CHANGE is a
// closed list of effects, each applied by the engine and each refusable: a
// refusal never throws and never pops up, it is a plain log line and a note the
// DM reads next turn. Dice (a check, a heal, a harm) are rolled in the tray by
// the panel, never here.
// ---------------------------------------------------------------------------

/** What the DM may place: not doors or chests (the chest is the engine's own loot roll) and not the pieces of a cottage or an archway. */
const DM_PROP_SKIP = /^(door_|chest|cottage_|arch_|wall_)/;
/** Tiles the DM may paint: the base materials, not the edge, join and variant pieces the renderer picks on its own. */
const DM_TILE_SKIP = /_edge_|_join_|_(b|c|d)$|_pale|^wall_stone_(top|base)$/;

const DM_ASSETS: Record<TemplateGenre, DmSceneView["assets"]> = {
  fantasy: dmAssetsFor("fantasy"),
  scifi: dmAssetsFor("scifi"),
};

function dmAssetsFor(template: TemplateGenre): DmSceneView["assets"] {
  const sprites = SPRITES_BY_TEMPLATE[template];
  return {
    props: sprites.filter((s) => s.kind === "prop" && !DM_PROP_SKIP.test(s.assetId)).map((s) => s.assetId),
    tiles: sprites.filter((s) => s.kind === "tile" && !DM_TILE_SKIP.test(s.assetId)).map((s) => s.assetId),
    // The kinds the bench has a statblock and a sprite for: the scene's own pair.
    monsters: [SCENE_KIT[template].monster, SCENE_KIT[template].second],
  };
}

/** The tiles as the player SEES them (the renderer's own display pass, seed 0), so a grate that is only a scattered variant is still a grate the DM knows about. */
let displayCache: { key: string; tiles: TileId[][] } | null = null;
function displayTiles(p: PlayState): TileId[][] {
  const key = `${p.template}|${p.floorId}|${p.worldRev}`;
  if (displayCache?.key === key) return displayCache.tiles;
  const m = MANIFEST[p.template];
  const tiles = applyDisplayTiles(sceneTiles(p), (id) => m.tiles[id] !== undefined, 0, { props: sceneProps(p), hasProp: (id) => m.props[id] !== undefined });
  displayCache = { key, tiles };
  return tiles;
}

/** Whether the square is a drain grate, by the stored tile or by what is drawn there. */
function isGrate(p: PlayState, at: XY): boolean {
  const grate = DRAIN_TILE[p.template];
  return sceneTiles(p)[at.y]?.[at.x] === grate || displayTiles(p)[at.y]?.[at.x] === grate;
}

const grateId = (at: XY): string => `drain-${at.x}-${at.y}`;
const tileChangeId = (at: XY): string => `tile-${at.x}-${at.y}`;

/** A tile in the player's words ("the stone wall"). */
function tileWords(id: TileId): string {
  if (/^wall_stone/.test(id)) return "the stone wall";
  if (/^wall_bulkhead/.test(id)) return "the bulkhead";
  if (/^water/.test(id)) return "the water";
  if (/^floor_stone_drain|^floor_grating/.test(id)) return "the drain grate";
  if (/^floor_stone_cracked/.test(id)) return "the cracked flagstones";
  if (/^floor_stone/.test(id)) return "the stone floor";
  if (/^floor_grass/.test(id)) return "the grass";
  if (/^floor_dirt/.test(id)) return "the packed dirt";
  if (/^floor_sand/.test(id)) return "the sand";
  if (/^floor_deckplate/.test(id)) return "the deck plating";
  if (/^forest_canopy/.test(id)) return "the thick canopy";
  if (/^cliff_face/.test(id)) return "the cliff face";
  if (/^cliff_top/.test(id)) return "the cliff top";
  return `the ${id.replace(/_/g, " ")}`;
}

/** What is on a square, in the words an examine sends: the hero, a creature (only while it is in sight), the door, the chest, a DM prop, a grate, then the ground. */
function whatIsAt(p: PlayState, at: XY): string {
  const kit = SCENE_KIT[p.template];
  if (same(at, p.heroAt)) return "yourself";
  const there = creatureAt(p, at);
  if (there && creatureInSight(p, there)) return creatureLabel(p, there);
  if (same(at, DOOR_AT)) return kit.doorLabel;
  if (same(at, CONTAINER_AT)) return kit.containerLabel;
  const body = p.bodies.find((b) => same(b.at, at));
  if (body) return `the ${body.name.toLowerCase()}'s body`;
  if (pileAt(p, at)) return "the things lying on the ground";
  const prop = p.extraProps.find((e) => same(e, at));
  if (prop) return prop.label;
  if (isGrate(p, at)) return "the drain grate";
  const tile = sceneTiles(p)[at.y]?.[at.x];
  if (tile && WALKABLE_BY_ID[p.template].get(tile) === true) return tile === p.floorId || /^floor_stone/.test(tile) ? "the floor" : tileWords(tile);
  return tile ? tileWords(tile) : "the floor";
}

/** The feature the examine/left-click shortcut treats as lookable: a grate or a DM prop (the door and chest keep their Use). */
function lookableAt(p: PlayState, at: XY): "grate" | "prop" | null {
  if (p.extraProps.some((e) => same(e, at))) return "prop";
  if (isGrate(p, at) && !same(at, DOOR_AT) && !same(at, CONTAINER_AT)) return "grate";
  return null;
}

/** A tile change's own feature, grates and the rest in one list, for the DM. */
function dmFeatures(p: PlayState): DmSceneView["features"] {
  const kit = SCENE_KIT[p.template];
  const seen = (at: XY): boolean => sightLevel(p, at) > 0;
  const out: DmSceneView["features"] = [];
  const add = (f: DmSceneView["features"][number]): void => {
    out.push(f);
  };
  const withSecret = <T extends object>(id: string, base: T): T & { secret?: string } => (p.propSecrets[id] ? { ...base, secret: p.propSecrets[id]! } : base);
  add(withSecret("door", { id: "door", x: DOOR_AT.x, y: DOOR_AT.y, what: kit.doorLabel, asset: p.doorOpen ? kit.doorOpen : kit.doorClosed, state: p.doorOpen ? "open" : p.doorLocked ? "closed and locked" : "closed", seen: seen(DOOR_AT) }));
  add(
    withSecret("container", {
      id: "container",
      x: CONTAINER_AT.x,
      y: CONTAINER_AT.y,
      what: kit.containerLabel,
      asset: p.searched && kit.containerOpened ? kit.containerOpened : kit.container,
      state: p.searched ? "already opened and emptied" : "unopened (the engine rolls what is inside when the hero opens it; never invent its contents)",
      seen: seen(CONTAINER_AT),
    }),
  );
  for (let y = 1; y < CELL_HEIGHT - 1; y++) {
    for (let x = 1; x < CELL_WIDTH - 1; x++) {
      const at = { x, y };
      if (!isGrate(p, at) || same(at, DOOR_AT) || same(at, CONTAINER_AT)) continue;
      const id = grateId(at);
      add(withSecret(id, { id, x, y, what: "a drain grate in the floor", asset: DRAIN_TILE[p.template], seen: seen(at) }));
    }
  }
  for (const e of p.extraProps) add({ id: e.id, x: e.x, y: e.y, what: e.label, asset: e.assetId, seen: seen(e), ...(e.secret ? { secret: e.secret } : {}) });
  for (const o of p.tileOverrides) {
    const at = { x: o.x, y: o.y };
    add({ id: tileChangeId(at), x: o.x, y: o.y, what: `changed terrain: ${tileWords(o.tile)}`, asset: o.tile, seen: seen(at) });
  }
  return out;
}

/**
 * Who the hero is, for the DM (character creation): ancestry, background,
 * alignment, personality, backstory, traits (with whether the engine applies
 * each) and languages, plus what each thing carried is, in the same words the
 * player reads on hover. Only what the sheet actually has: a quick-picked hero
 * has no ancestry or background and adds nothing, so its prompt is unchanged
 * except for the item lines.
 */
function heroIdentityFor(p: PlayState): Partial<DmSceneView["hero"]> {
  const h = p.hero;
  const out: Partial<DmSceneView["hero"]> = {};
  if (h.ancestryName) out.ancestry = h.ancestryName;
  if (h.background?.name) out.background = h.background.name;
  if (h.alignment) out.alignment = h.alignment;
  if (h.background) {
    const personality: NonNullable<DmSceneView["hero"]["personality"]> = {};
    if (h.background.personalityTrait) personality.trait = h.background.personalityTrait;
    if (h.background.ideal) personality.ideal = h.background.ideal;
    if (h.background.bond) personality.bond = h.background.bond;
    if (h.background.flaw) personality.flaw = h.background.flaw;
    if (Object.keys(personality).length > 0) out.personality = personality;
  }
  if (h.backstory) out.backstory = h.backstory;
  const traits = featureList(h).map((f) => ({ name: f.name, text: f.text, applied: f.applied }));
  if (traits.length > 0) out.traits = traits;
  if (h.languages && h.languages.length > 0) out.languages = [...h.languages];
  const items: { name: string; what: string }[] = [];
  for (const section of packInfo(h, { potions: p.potions, notes: p.itemNotes })) {
    for (const info of section.items) items.push({ name: info.name, what: info.summary });
  }
  if (items.length > 0) out.items = items;
  return out;
}

/** The whole scene for one DM call, rebuilt from the state every time. */
function dmViewFor(p: PlayState): DmSceneView {
  const kit = SCENE_KIT[p.template];
  const walkable = WALKABLE_BY_ID[p.template];
  const tiles = sceneTiles(p);
  const features = dmFeatures(p);
  const used = new Set<string>();
  const changed = new Set(p.tileOverrides.map((o) => `${o.x},${o.y}`));
  const propDigit = new Map<string, string>();
  p.extraProps.forEach((e, i) => propDigit.set(`${e.x},${e.y}`, i < 9 ? String(i + 1) : "*"));
  // One letter per kind of creature on the board, in the order they were made: M first, as it always was, then N, O and so on.
  const kindLetter = new Map<string, string>();
  for (const c of p.creatures) {
    const key = c.npc ? `npc:${c.npc.role}` : c.token;
    if (!kindLetter.has(key)) kindLetter.set(key, "MNOPQRSTUVWXYZ"[kindLetter.size] ?? "M");
  }
  const letterOf = (c: Creature): string => kindLetter.get(c.npc ? `npc:${c.npc.role}` : c.token)!;
  const grid = tiles.map((row, y) =>
    row
      .map((id, x) => {
        const at = { x, y };
        let ch: string;
        if (same(at, p.heroAt)) ch = "@";
        else if (creatureAt(p, at)) ch = letterOf(creatureAt(p, at)!);
        else if (same(at, DOOR_AT)) ch = p.doorOpen ? "d" : "D";
        else if (same(at, CONTAINER_AT)) ch = p.searched ? "c" : "C";
        else if (propDigit.has(`${x},${y}`)) ch = propDigit.get(`${x},${y}`)!;
        else if (isGrate(p, at)) ch = "o";
        else if (changed.has(`${x},${y}`)) ch = walkable.get(id) === true ? "," : "%";
        else ch = walkable.get(id) === true ? "." : "#";
        used.add(ch);
        return ch;
      })
      .join(""),
  );
  const words: Record<string, string> = {
    // Each creature kind's letter (a second of a kind shares it; the monster list below tells them apart by id).
    ...Object.fromEntries(p.creatures.map((c) => [letterOf(c), `${c.npc ? creatureLabel(p, c) : `the ${statblockFor(c.token).name.toLowerCase()}`}${c.hostile ? "" : " (not hostile)"}`])),
    "#": "solid terrain you cannot walk through (stone wall)",
    ".": "open floor",
    "@": "the hero",
    D: `${kit.doorLabel}, closed${p.doorLocked ? " and locked" : ""}`,
    d: `${kit.doorLabel}, open`,
    C: `${kit.containerLabel}, unopened`,
    c: `${kit.containerLabel}, opened`,
    o: "a drain grate set in the floor (walkable)",
    ",": "terrain you changed (walkable)",
    "%": "terrain you changed (solid)",
    "*": "a DM prop (see the feature list)",
  };
  const legend: Record<string, string> = {};
  for (const ch of used) {
    if (/^\d$/.test(ch)) legend[ch] = `DM prop ${ch}: ${p.extraProps[Number(ch) - 1]?.label ?? "a prop"}`;
    else if (words[ch]) legend[ch] = words[ch]!;
  }
  const h = p.hero;
  const c = p.round ? activeCombatant(p.round) : undefined;
  const mine = heroesTurn(p);
  const inSight = features.filter((f) => f.seen && seesTile(p, f)).map((f) => f.id);
  for (const c of creaturesInSight(p)) inSight.push(c.id);
  const conditions: string[] = [];
  if (h.dead) conditions.push("dead");
  else if (h.downed) conditions.push("down at 0 hit points, making death saves");
  else if (h.stable) conditions.push("stable at 0 hit points");
  const potions = p.potions;
  return {
    template: p.template,
    cols: CELL_WIDTH,
    rows: CELL_HEIGHT,
    grid,
    legend,
    features,
    hero: {
      name: h.name,
      archetype: h.displayName,
      level: h.level,
      hp: h.currentHp,
      maxHp: h.maxHp,
      ac: effectiveArmorClass(h),
      at: { ...p.heroAt },
      speedFt: effectiveSpeedFt(h),
      abilities: { ...h.modifiers },
      skills: Object.fromEntries(h.skills.map((s) => [s.skill, skillModifierFor(h, s.skill)])),
      conditions,
      worn: GEAR_ROLES.map((role) => {
        const tier = wornTier(p, role);
        return tier ? itemName(p.archetypeId, role, tier) : null;
      }).filter((n): n is string => n !== null),
      bag: (h.bag ?? []).map((b) => itemName(p.archetypeId, b.slot, b.tier)),
      carried: [...packItems(h)],
      potions,
      consumables: (h.consumables ?? []).filter((x) => !/potion/i.test(x.name)).map((x) => `${x.name} x${x.uses}`),
      ...heroIdentityFor(p),
      ...(p.heroHidden ? { hidden: true } : {}),
    },
    monsters: p.creatures.map((m) => ({
      id: m.id,
      // Who it is, for the DM: its name (numbered while the scene has several of its kind), and the role of one that is somebody and not hostile.
      name: m.npc ? `${creatureName(p, m)} (not hostile)` : creatureName(p, m),
      hp: m.hp,
      maxHp: statblockFor(m.token).maxHp,
      ac: monsterArmorClassFor(m.token),
      at: { ...m.at },
      awake: m.awake,
      seenByHero: creatureInSight(p, m),
      // A hostile that is up has noticed the hero; one asleep has not. A creature that is not hostile says nothing about it.
      ...(m.hostile ? { awareOfHero: m.awake } : {}),
      ...(m.prone ? { prone: true } : {}),
    })),
    fight: p.round
      ? { round: p.round.roundNumber, whoseTurn: mine ? h.name : (activeCreature(p) ? creatureLabel(p, activeCreature(p)!) : "a creature"), heroMovementFt: mine ? (c?.economy.movementRemaining ?? 0) : 0, heroActionReady: heroActionReady(p) }
      : null,
    visibleToHero: `${inSight.length ? `ids in sight now: ${inSight.join(", ")}` : "no feature or creature in particular"}; the hero stands in the ${p.heroAt.x < DIVIDER_X ? "west" : "east"} room`,
    memory: [...p.dmMemory],
    recent: p.dmRecent.slice(-DM_RECENT_SHOWN),
    log: p.log.slice(-6).map((l) => l.text),
    assets: DM_ASSETS[p.template],
    // Only when there are any, so a scene without them reads exactly as it did.
    ...(p.bodies.length > 0 ? { bodies: p.bodies.map((b) => ({ id: b.id, name: b.name, at: { ...b.at }, looted: b.looted, items: b.items.map((i) => i.name) })) } : {}),
    ...(p.piles.some((q) => q.items.length > 0) ? { piles: p.piles.filter((q) => q.items.length > 0).map((q) => ({ at: { ...q.at }, items: [...q.items] })) } : {}),
  };
}

/** The DC of a Perception check to listen at a door (SRD 5.1 gives hearing a DC of 10 for ordinary sounds). */
const LISTEN_DC = 10;

/** The effect in plain words, for the debug journal's applied and refused lists. */
function describeEffect(e: DmEffect): string {
  switch (e.type) {
    case "give": return `give ${e.item}${e.quest ? " (quest item)" : ""}${e.usable ? " (usable)" : ""}`;
    case "take": return `take ${e.item}`;
    case "potion": return `potion x${e.count}`;
    case "loot": return "loot roll";
    case "heal": return `heal ${e.dice}`;
    case "harm": return `harm ${e.dice} (${e.why})`;
    case "place": return `place ${e.asset} "${e.label}" at (${e.x},${e.y})`;
    case "remove": return `remove ${e.id}`;
    case "alter": return `alter ${e.id}`;
    case "tile": return `tile ${e.tile} at (${e.x},${e.y})`;
    case "door": return `door ${e.state}`;
    case "monster": return `monster ${e.act}`;
    case "push": return `push ${e.id} ${e.squares} square${e.squares === 1 ? "" : "s"}`;
    case "hurt": return `hurt ${e.id}${e.dice ? ` ${e.dice}` : " (the attack's own damage)"}${e.damageType ? ` ${e.damageType}` : ""}`;
    case "prone": return `prone ${e.id}`;
  }
}

/** Damage a creature takes from something that is not a swing (a DM hurt with its own dice): hit points, the log, a kill. Returns the events the board floats. */
function hurtCreatureBy(p: PlayState, m: Creature, amount: number, type?: string): CombatEvent[] {
  const hurt = damageMonster({ assetId: m.token, currentHp: m.hp }, amount);
  const lost = m.hp - hurt.currentHp;
  m.hp = hurt.currentHp;
  p.log.push({ text: `${sentenceCase(creatureLabel(p, m))} takes ${amount} ${type ? `${type} ` : ""}damage${hurt.down ? " and goes down" : `, ${hitPoints(m.hp)} left`}.`, tone: "good" });
  const events: CombatEvent[] = lost > 0 ? [{ kind: "damage", tokenId: m.id, amount, hpLost: lost, critical: false }] : [];
  if (hurt.down) {
    events.push({ kind: "down", tokenId: m.id });
    slayCreature(p, m);
  }
  return events;
}

type EffectOutcome = { ok: true; line?: LogLine; wake?: Creature } | { ok: false; why: string; logged?: boolean };
const fail = (why: string, logged = false): EffectOutcome => ({ ok: false, why, logged });

/** Compare two item names the way a person would: case, punctuation and a leading article forgiven. */
const foldItem = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/^(an?|the|some)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

/** Why a prop or a creature cannot stand on this square, in words; null when it is free. */
function squareBlockedWords(p: PlayState, at: XY): string | null {
  const tile = sceneTiles(p)[at.y]?.[at.x];
  if (!tile || WALKABLE_BY_ID[p.template].get(tile) !== true) return "that square is solid terrain";
  if (same(at, p.heroAt)) return "the hero is standing there";
  const there = creatureAt(p, at);
  if (there) return `${creatureLabel(p, there)} is standing there`;
  if (same(at, DOOR_AT)) return "the door is there";
  if (same(at, CONTAINER_AT)) return "the chest is there";
  if (p.extraProps.some((e) => same(e, at))) return "another prop is already there";
  return null;
}

/**
 * One DM effect that needs no dice, applied to the scene. Never throws: a
 * refusal comes back as { ok: false, why } for the caller to log. The tile,
 * prop and door effects bump worldRev so sight and the picture rebuild. heal
 * and harm are not here (the panel rolls them in the tray).
 */
function applyWorldEffect(p: PlayState, e: DmEffect): EffectOutcome {
  const kit = SCENE_KIT[p.template];
  switch (e.type) {
    case "give": {
      if (p.hero.inventory.length >= DM_INVENTORY_MAX) return fail("the pack is full");
      p.hero = { ...p.hero, inventory: [...p.hero.inventory, e.item] };
      // What the DM says it is: the pack's hover tip shows it (and says the game does not use it by itself).
      if (typeof e.desc === "string" && e.desc.trim()) p.itemNotes[e.item] = e.desc.trim();
      // Its flags (quest, usable, what Use says) ride with its name; the item card and the engine's item rules read them.
      if (e.quest === true || e.usable === true || e.useSay !== undefined) {
        p.itemFlags[e.item] = { ...(p.itemFlags[e.item] ?? {}), ...(e.quest === true ? { quest: true } : {}), ...(e.usable === true ? { usable: true } : {}), ...(e.useSay !== undefined ? { useSay: e.useSay } : {}) };
      }
      return { ok: true, line: { text: `You now carry ${e.item}.`, tone: "good", notice: `+ ${e.item}` } };
    }
    case "take": {
      const want = foldItem(e.item);
      const carried = new Set(packItems(p.hero));
      const at = p.hero.inventory.findIndex((it) => carried.has(it) && (foldItem(it) === want || foldItem(it).includes(want) || want.includes(foldItem(it))));
      if (!want || at < 0) return fail(`the hero is not carrying "${e.item}" (only carried items can be taken)`);
      const gone = p.hero.inventory[at]!;
      p.hero = { ...p.hero, inventory: p.hero.inventory.filter((_, i) => i !== at) };
      if (!p.hero.inventory.includes(gone)) forgetItem(p, gone);
      return { ok: true, line: { text: `You no longer have ${gone}.`, tone: "plain" } };
    }
    case "potion": {
      const grant = Math.min(e.count, DM_POTION_CAP - p.potionsGranted);
      if (grant <= 0) return fail(`no more healing potions can be handed out in this scene (the limit is ${DM_POTION_CAP})`);
      p.potions += grant;
      p.potionsGranted += grant;
      return { ok: true, line: { text: grant === 1 ? "You gain a potion of healing." : `You gain ${grant} potions of healing.`, tone: "good", notice: `+${grant} potion${grant === 1 ? "" : "s"}` } };
    }
    case "loot":
      // The game's own roll, capped by the cell's ledger (it logs its own line either way).
      return rollLoot(p, "container") ? { ok: true } : fail(LOOT_CAP_LINE, true);
    case "place": {
      if (p.extraProps.length >= DM_PROPS_MAX) return fail(`the room already holds ${DM_PROPS_MAX} props of yours`);
      const blocked = squareBlockedWords(p, { x: e.x, y: e.y });
      if (blocked) return fail(`a prop cannot go at (${e.x},${e.y}): ${blocked}`);
      p.extraProps.push({ id: `prop-${p.propSeq++}`, assetId: e.asset, x: e.x, y: e.y, label: e.label, ...(e.secret ? { secret: e.secret } : {}) });
      p.worldRev++;
      return { ok: true };
    }
    case "remove": {
      const i = p.extraProps.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        p.extraProps.splice(i, 1);
        p.worldRev++;
        return { ok: true };
      }
      if (e.id === "door" || e.id === "container") return fail(`${e.id === "door" ? kit.doorLabel : kit.containerLabel} is part of the room and cannot be removed`);
      if (e.id.startsWith("drain-") || e.id.startsWith("tile-")) return fail("terrain cannot be removed; change the floor with a tile effect");
      return fail(`there is no prop "${e.id}" to remove`);
    }
    case "alter": {
      const prop = p.extraProps.find((x) => x.id === e.id);
      if (prop) {
        if (e.asset !== undefined && !DM_ASSETS[p.template].props.includes(e.asset)) return fail(`"${e.asset}" is not a prop a prop can become`);
        if (e.asset !== undefined && e.asset !== prop.assetId) {
          prop.assetId = e.asset;
          p.worldRev++;
        }
        if (e.label !== undefined) prop.label = e.label;
        if (e.secret === null) delete prop.secret;
        else if (e.secret !== undefined) prop.secret = e.secret;
        return { ok: true };
      }
      const builtIn = e.id === "door" || e.id === "container" || e.id.startsWith("drain-");
      if (!builtIn) return fail(e.id.startsWith("tile-") ? "terrain is changed with a tile effect, not alter" : `there is no prop "${e.id}" to change`);
      if (e.asset !== undefined || e.label !== undefined) return fail("the door, the chest and the grates keep their look and their name; only their secret can change");
      if (e.secret === null) delete p.propSecrets[e.id];
      else if (e.secret !== undefined) p.propSecrets[e.id] = e.secret;
      return { ok: true };
    }
    case "tile": {
      const at = { x: e.x, y: e.y };
      if (e.x <= 0 || e.y <= 0 || e.x >= CELL_WIDTH - 1 || e.y >= CELL_HEIGHT - 1) return fail("the outer wall of the room cannot be changed");
      if (same(at, p.heroAt)) return fail("the hero is standing there");
      const standing = creatureAt(p, at);
      if (standing) return fail(`${creatureLabel(p, standing)} is standing there`);
      if (same(at, DOOR_AT) || same(at, CONTAINER_AT)) return fail(`${same(at, DOOR_AT) ? kit.doorLabel : kit.containerLabel} is on that square`);
      const now = sceneTiles(p)[e.y]![e.x]!;
      if (now === e.tile) return { ok: true };
      const prop = p.extraProps.find((x) => same(x, at));
      if (prop && WALKABLE_BY_ID[p.template].get(e.tile) !== true) return fail(`${prop.label} stands on that square, which cannot turn solid`);
      p.tileOverrides = [...p.tileOverrides.filter((o) => !same(o, at)), { x: e.x, y: e.y, tile: e.tile }];
      p.worldRev++;
      return { ok: true };
    }
    case "door": {
      const inDoorway = same(p.heroAt, DOOR_AT) || creatureAt(p, DOOR_AT) !== undefined;
      if (e.state === "unlocked") {
        p.doorLocked = false;
        return { ok: true };
      }
      if (e.state === "open") {
        p.doorLocked = false;
        p.doorOpen = true;
        return { ok: true };
      }
      if (inDoorway) return fail(`someone is standing in the doorway, so ${kit.doorLabel} cannot shut`);
      p.doorOpen = false;
      if (e.state === "locked") p.doorLocked = true;
      return { ok: true };
    }
    case "monster": {
      if (e.act === "spawn") {
        if (p.creatures.length >= CREATURE_CAP) return fail(`the room already holds ${CREATURE_CAP} creatures`);
        const at = { x: e.x ?? 0, y: e.y ?? 0 };
        const blocked = squareBlockedWords(p, at);
        if (blocked) return fail(`a monster cannot appear at (${at.x},${at.y}): ${blocked}`);
        // A new creature is asleep and unseen; it joins a fight when it notices the hero, like any other.
        addCreature(p, e.asset ?? kit.monster, at);
        return { ok: true };
      }
      const m = e.id ? creatureById(p, e.id) : undefined;
      if (!m) return fail(`there is no creature "${e.id ?? ""}" in the room`);
      if (e.act === "wake") return { ok: true, wake: m };
      if (e.act === "calm") {
        if (p.round) return fail("a monster cannot be calmed in the middle of a fight");
        m.awake = false;
        return { ok: true };
      }
      // flee
      const wasSeen = creatureInSight(p, m);
      const label = creatureLabel(p, m);
      p.creatures = p.creatures.filter((x) => x !== m);
      if (p.round) {
        const rest = dropCombatant(p.round, m.id);
        p.round = hasHostiles(rest) ? rest : null;
      }
      return { ok: true, line: { text: wasSeen ? `${sentenceCase(label)} flees.` : "Something moves away out of sight.", tone: "good" } };
    }
    default:
      return fail("that effect is not one the engine knows");
  }
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
// Item cards, piles and bodies. The rules are the engine's (inventory/itemActions.ts
// decides what each item offers and applies it, rules/corpses.ts says what a body
// holds); this is the scene around them: where a dropped thing lies, what a search
// of a body turns up, and the words the card shows.
// ---------------------------------------------------------------------------

/** Something hostile is awake or in sight: the game's own gate on changing gear, with the same test the rest rule uses (a sleeping goblin behind a shut door does not stop you). */
function hostileNear(p: PlayState): boolean {
  return p.round !== null || p.creatures.some((c) => c.hostile && (c.awake || creatureInSight(p, c)));
}

/** What the engine needs to know about the hero's moment to say what an item can do. */
function itemCtx(p: PlayState): ItemActionContext {
  return {
    inFight: hostileNear(p),
    // Outside a round nobody is waiting for a turn.
    heroTurn: !p.round || heroesTurn(p),
    actionReady: heroActionReady(p),
    heroDown: heroDown(p),
    flags: p.itemFlags,
    // The bench keeps its own potion stock and has no death saves, so a downed hero can still drink.
    potions: p.potions,
    potionWhileDown: true,
  };
}

/** The item a pack or sheet key stands for (sheetItemKey: the section, a colon, the name), or null when it is not there any more. */
function itemRefFor(p: PlayState, key: string): ItemRef | null {
  const at = key.indexOf(":");
  if (at < 0) return null;
  const section = key.slice(0, at);
  const name = key.slice(at + 1);
  if (section === "Worn") {
    const role = GEAR_ROLES.find((r) => itemNameFor(p.hero, r) === name);
    return role ? { where: "worn", slot: role } : null;
  }
  if (section === "Bag") {
    const index = (p.hero.bag ?? []).findIndex((b) => gearItemName(p.archetypeId, b.slot, b.tier) === name);
    return index >= 0 ? { where: "bag", index } : null;
  }
  if (section === "Carried") return { where: "carried", name };
  if (section === "Consumables") return { where: "consumable", name };
  return null;
}

/** The card an item shows: the hover facts, the engine's one-line status on top, and a button for everything it offers (greyed, with its reason, when it cannot be done now). */
function itemCardFor(p: PlayState, key: string): ItemCardContent | null {
  const ref = itemRefFor(p, key);
  if (!ref) return null;
  const at = key.indexOf(":");
  const label = key.slice(0, at);
  const name = key.slice(at + 1);
  const info = packInfo(p.hero, { potions: p.potions, notes: p.itemNotes })
    .find((s) => s.label === label)
    ?.items.find((i) => i.name === name);
  if (!info) return null;
  const ctx = itemCtx(p);
  return {
    tip: itemTip(info),
    status: itemStatusLine(p.hero, ref, ctx),
    actions: itemActionsFor(p.hero, ref, ctx).map((a) => ({ id: a.id, label: a.label, enabled: a.enabled, ...(a.reason ? { reason: a.reason } : {}), ...(a.confirm ? { confirm: a.confirm } : {}) })),
  };
}

const withoutCount = (s: string): string => s.replace(/\s+x\d+$/i, "");

/** Whether a pack still holds, or a pile still lies with, a thing of this name (case and a leading article forgiven). */
function itemStillAround(p: PlayState, name: string): boolean {
  const want = foldItem(withoutCount(name));
  return p.hero.inventory.some((s) => foldItem(withoutCount(s)) === want) || p.piles.some((q) => q.items.some((s) => foldItem(withoutCount(s)) === want));
}

/** An item that has left the hero's hands for good: the DM's note and flags on it go too, unless another copy is still around. */
function forgetItem(p: PlayState, name: string): void {
  if (itemStillAround(p, name)) return;
  const want = foldItem(name);
  for (const k of Object.keys(p.itemNotes)) if (foldItem(k) === want) delete p.itemNotes[k];
  for (const k of Object.keys(p.itemFlags)) if (foldItem(k) === want) delete p.itemFlags[k];
}

/** Put a thing on the ground at `at`. */
function addToPile(p: PlayState, at: XY, name: string): void {
  const pile = p.piles.find((q) => same(q.at, at));
  if (pile) pile.items.push(name);
  else p.piles.push({ at: { ...at }, items: [name] });
}

/** The pile on a square, when anything lies there. */
const pileAt = (p: PlayState, at: XY): { at: XY; items: string[] } | undefined => p.piles.find((q) => same(q.at, at) && q.items.length > 0);

/** The body on a square that still has something to search or take. */
const bodyAt = (p: PlayState, at: XY): BodyState | undefined => p.bodies.find((b) => same(b.at, at) && !b.looted);

/** The nearest searchable body or pile within one square of the hero (the hero's own square counts), a body first. */
function lootNear(p: PlayState): { kind: "body"; body: BodyState } | { kind: "pile"; at: XY } | null {
  const reach = (at: XY): boolean => tileDistance(p.heroAt, at) <= 1;
  const body = p.bodies.find((b) => !b.looted && reach(b.at));
  if (body) return { kind: "body", body };
  const pile = p.piles.find((q) => q.items.length > 0 && reach(q.at));
  return pile ? { kind: "pile", at: { ...pile.at } } : null;
}

/** The magic piece of gear a name stands for on this hero's gear table, or null (the engine's one namer is gearItemName). */
function magicBagItemNamed(p: PlayState, name: string): { slot: GearRole; tier: MagicTier } | null {
  for (const slot of GEAR_ROLES) {
    for (const tier of MAGIC_TIERS) {
      if (gearItemExists(p.archetypeId, slot, tier) && gearItemName(p.archetypeId, slot, tier) === name) return { slot, tier };
    }
  }
  return null;
}

/**
 * The first search of a body rolls the engine's own loot (the fight source, one roll of the cell's ledger), and a find waits
 * on the body to be taken, not in the pack. When the ledger is spent the log says so, as it does for the chest.
 */
function ensureBodyLoot(p: PlayState, body: BodyState): void {
  if (body.engineLootRolled) return;
  body.engineLootRolled = true;
  const out = lootFor(p.hero, { source: "fight", cx: 0, cy: 0 });
  if (!out.roll) {
    p.log.push({ text: LOOT_CAP_LINE, tone: "plain" });
    return;
  }
  const roll = out.roll;
  // lootFor puts a find straight into the bag; here it has to wait on the body, so only the ledger comes back to the hero.
  p.hero = { ...p.hero, lootLedger: out.sheet.lootLedger };
  const name = roll.item ? gearItemName(p.archetypeId, roll.item.slot, roll.item.tier) : null;
  if (roll.item && name && roll.tier) {
    body.items.push({ name, note: "A magic piece from the engine's loot roll.", kind: "trinket", pocketable: false });
    const slotDie = roll.slotDie >= 2 && roll.slotRoll !== null ? ` d${roll.slotDie} = ${roll.slotRoll}:` : "";
    p.log.push({ text: `Loot: d100 = ${roll.tierRoll}, ${TIER_WORD[roll.tier].toLowerCase()}.${slotDie} ${name}, on the body.`, tone: "good" });
  } else {
    p.log.push({ text: lootLine(roll, null), tone: "plain" });
  }
  // Nothing at all on it (a creature that carries nothing, and no find): it counts as searched.
  if (body.items.length === 0) body.looted = true;
}

/** What a loot window lists for a body: each thing with its real facts on hover (a magic piece reads the engine's own numbers). */
function bodyLootItems(p: PlayState, body: BodyState): LootWindowItem[] {
  const notes = carriedNotes(body.items);
  return body.items.map((it, i) => {
    const bag = magicBagItemNamed(p, it.name);
    return { key: String(i), name: it.name, tip: itemTip(bag ? describeBagItem(p.hero, bag) : describeCarried(p.hero, it.name, notes)) };
  });
}

/** What a loot window lists for a pile. */
function pileLootItems(p: PlayState, at: XY): LootWindowItem[] {
  const pile = p.piles.find((q) => same(q.at, at));
  return (pile?.items ?? []).map((name, i) => {
    const bag = magicBagItemNamed(p, name);
    return { key: String(i), name, tip: itemTip(bag ? describeBagItem(p.hero, bag) : describeCarried(p.hero, name, p.itemNotes)) };
  });
}

/** Why a taken thing did not come, or null when it did. A flavour item goes to the carried list, magic gear to the bag (pickUp keeps the bag's rules), and the line goes in the log. */
function takeIntoPack(p: PlayState, name: string, note: string | null): string | null {
  const magic = magicBagItemNamed(p, name) !== null;
  if (!magic && p.hero.inventory.length >= DM_INVENTORY_MAX) return "Your pack is full.";
  const r = pickUp(p.hero, name, { potions: p.potions });
  if (r.refused) return r.refused;
  p.hero = r.sheet;
  if (r.potions !== undefined) p.potions = r.potions;
  if (note && !magic && !p.itemNotes[name]) p.itemNotes[name] = note;
  p.log.push({ text: r.line, tone: "good", notice: `+ ${name}` });
  return null;
}

/** Take one thing, or "all", from a body. Returns the refusals (what stayed behind and why). */
function takeFromBodyInto(p: PlayState, bodyId: string, key: string | "all"): string[] {
  const at = p.bodies.findIndex((b) => b.id === bodyId);
  if (at < 0) return ["That body is gone."];
  const refusals: string[] = [];
  const wanted = key === "all" ? p.bodies[at]!.items.map((i) => i.name) : [p.bodies[at]!.items[Number(key)]?.name].filter((n): n is string => !!n);
  for (const name of wanted) {
    const item = p.bodies[at]!.items.find((i) => i.name === name);
    if (!item) continue;
    const why = takeIntoPack(p, item.name, item.note);
    if (why) {
      refusals.push(`${item.name}: ${why}`);
      continue;
    }
    p.bodies[at] = { ...takeFromBody(p.bodies[at]!, item.name).body, token: p.bodies[at]!.token };
  }
  return refusals;
}

/** Take one thing, or "all", off a pile. Returns the refusals. */
function takeFromPileInto(p: PlayState, at: XY, key: string | "all"): string[] {
  const pile = p.piles.find((q) => same(q.at, at));
  if (!pile) return ["There is nothing there."];
  const refusals: string[] = [];
  const names = key === "all" ? [...pile.items] : [pile.items[Number(key)]].filter((n): n is string => !!n);
  for (const name of names) {
    const act = itemActionsFor(p.hero, { where: "pile", name }, itemCtx(p)).find((a) => a.id === "pickup");
    if (act && !act.enabled) {
      refusals.push(`${name}: ${act.reason ?? "You cannot pick that up."}`);
      continue;
    }
    const why = takeIntoPack(p, name, null);
    if (why) {
      refusals.push(`${name}: ${why}`);
      continue;
    }
    pile.items.splice(pile.items.indexOf(name), 1);
  }
  p.piles = p.piles.filter((q) => q.items.length > 0);
  return refusals;
}

/** Drop one of an item onto the hero's square. Returns the refusal, or null. */
function dropFromPack(p: PlayState, ref: ItemRef): string | null {
  const r = dropItem(p.hero, ref, itemCtx(p));
  if (r.refused) return r.refused;
  p.hero = r.sheet;
  if (r.potions !== undefined) p.potions = r.potions;
  if (r.dropped) addToPile(p, p.heroAt, r.dropped);
  p.log.push({ text: r.line, tone: "plain" });
  return null;
}

/** Destroy one of an item for good. Returns the refusal, or null. */
function destroyFromPack(p: PlayState, ref: ItemRef, name: string): string | null {
  const r = destroyItem(p.hero, ref, itemCtx(p));
  if (r.refused) return r.refused;
  p.hero = r.sheet;
  if (r.potions !== undefined) p.potions = r.potions;
  forgetItem(p, name);
  p.log.push({ text: r.line, tone: "plain" });
  return null;
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

/** How long a rolled ability score stays on the tray before the next one is thrown, in the creator. */
const SCORE_READ_MS = 700;

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

/** A creature's clip timings: its cast entry, or the hand-drawn figures' shared ones (a simple idle bob and step, whatever the token). */
function creatureTimingFor(token: TileId, style: CastStyle | null): { clips: CastClip[] } {
  return (style ? castEntry(style, token) : null) ?? SPRITE_ENTRY;
}

/** Every kind of creature the picture needs figures for: the ones on the board and the ones lying where they fell. */
function creatureTokensOf(p: PlayState): TileId[] {
  return [...new Set([...p.creatures.map((c) => c.token), ...p.bodies.map((b) => b.token)])].sort();
}

interface PlayStageHost {
  viewport: HTMLElement;
  canvas: HTMLCanvasElement;
  state: () => PlayState;
  /** Canvas pixels per SOURCE pixel: the Zoom control. */
  zoom: () => number;
  /** Runs first in every frame, before anything is drawn: the panel's input and turn clock. */
  beforeFrame?: (now: number, dtMs: number) => void;
  /** Runs last in every frame: where each creature is drawn (none that is hidden or gone), for the fog's headroom. */
  afterFrame?: (now: number, creatureTiles: readonly XY[]) => void;
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
  // What each figure last showed in full: the hero's, each creature's by id, each body's by "body:id".
  const memory = new Map<string, { shown: Shown | null }>();
  const memoryOf = (key: string): { shown: Shown | null } => {
    let m = memory.get(key);
    if (!m) memory.set(key, (m = { shown: null }));
    return m;
  };
  let lookKey = "";
  let heroSet: FigureSet | null = null;
  /** One figure set per kind of creature (by token); null for a kind with no cast entry (kept hand-drawn). */
  let creatureSets = new Map<string, FigureSet | null>();
  // The camera: where the hero was last kept in view, and whether the next frame jumps straight to it.
  const lastFocus = { x: Number.NaN, y: Number.NaN };
  let snap = true;
  let lastT = performance.now();
  let raf = 0;
  let alive = true;

  const invalidate = (): void => {
    dirty = true;
  };

  /** Re-decode what the figures need whenever the look changes: hero, gear, art, style, detail or the kinds of creature on the board. Self-detecting, so no caller has to remember to. */
  function syncLook(p: PlayState, style: CastStyle | null, size: number): void {
    if (!style) {
      lookKey = "";
      heroSet = null;
      creatureSets = new Map();
      return;
    }
    // Until the KayKit library is decoded the scene draws at the current art's size; the real size comes next, so only the first clips are worth decoding now.
    const loading = art.source === "kaykit" && !artDecoded;
    const tokens = creatureTokensOf(p);
    const key = [loading ? "loading" : "ready", style.style, size, p.archetypeId, p.template, equipmentSig(p.hero), tokens.join(",")].join("|");
    if (key === lookKey) return;
    lookKey = key;
    const sz = String(size);
    const heroEntry = castEntry(style, bodySpriteId(p.archetypeId));
    heroSet = heroEntry ? buildFigureSet(style, heroEntry, sz, wornLayers(style, p.hero)) : null;
    creatureSets = new Map(
      tokens.map((t) => {
        const entry = castEntry(style, t);
        return [t, entry ? buildFigureSet(style, entry, sz, []) : null] as const;
      }),
    );
    const cast = castData();
    if (!cast) return;
    const first: CastClipId[] = ["idle", "walk"];
    const rest = CAST_CLIPS.filter((c) => c !== "idle" && c !== "walk");
    const facingFirst = (d: CastDir): CastDir[] => [d, ...CAST_DIRS.filter((x) => x !== d)];
    const heroDirs = facingFirst(p.heroActor.dir);
    const requests: CastClipRequest[] = [];
    // What moves first, for the facing it is in; then everything else it can do.
    if (heroSet) requests.push(...clipRequests(heroSet, first, heroDirs));
    for (const [token, set] of creatureSets) {
      const c = p.creatures.find((x) => x.token === token);
      if (set) requests.push(...clipRequests(set, first, facingFirst(c?.actor.dir ?? "left")));
    }
    if (!loading) {
      if (heroSet) requests.push(...clipRequests(heroSet, rest, heroDirs));
      for (const [token, set] of creatureSets) {
        const c = p.creatures.find((x) => x.token === token);
        if (set) requests.push(...clipRequests(set, rest, facingFirst(c?.actor.dir ?? "left")));
      }
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
    renderCell(rctx, sceneLayout(p, isAnimated, true), manifest, tileScale, 0, !isAnimated && plan ? { [HERO_ID]: plan } : undefined, 0);
  }

  /** Everything the room bitmap depends on. With the animated figures drawn over it that is the tiles, the props and the art; with static tokens it also holds them. */
  function roomKeyFor(p: PlayState, manifest: RenderManifest, tileScale: number, isAnimated: boolean): string {
    const scene = `${tileScale}|${p.template}|${p.floorId}|${p.doorOpen ? 1 : 0}|${p.searched ? 1 : 0}|${p.worldRev}`;
    // Animated, the room is only tiles and props, which do not depend on the character style: switching it must not repaint the room.
    if (isAnimated) return `a|${art.ground}|${spriteSizeOf(manifest)}|${artDecoded ? 1 : 0}|${scene}`;
    return `${manifestId(manifest)}|${scene}|${p.archetypeId}|${p.heroAt.x},${p.heroAt.y}|${p.creatures.map((c) => `${c.id}:${c.at.x},${c.at.y},${c.hp},${creatureInSight(p, c) ? 1 : 0}`).join(";") || "-"}|${equipmentSig(p.hero)}`;
  }

  /**
   * The hero, every creature and every body (each where it fell), back to front, each standing
   * in the game's one-tile footprint with its feet on the tile's bottom edge.
   * A creature with no cast entry (kept hand-drawn) is its own drawing, posed
   * by the same clips. Returns the hero's DRAWN position, which the camera follows,
   * and where each creature in sight is drawn (the fog leaves its headroom clear).
   */
  function placeFigures(p: PlayState, now: number, style: CastStyle, manifest: RenderManifest, tileScale: number): { items: StageItem[]; hero: XY; creatureTiles: XY[] } {
    const size = String(spriteSizeOf(manifest));
    interface Fig {
      /** "hero", a creature's id, or "body:<id>:<token>:<x>,<y>": what its last full frame is remembered under. */
      key: string;
      isCreature: boolean;
      /** Lying where it fell: drawn at the end of its fall, however long ago that was. */
      isBody?: boolean;
      token: TileId;
      set: FigureSet | null;
      sprite: boolean;
      timing: { clips: CastClip[] };
      actor: Actor;
      at: XY;
      down: boolean;
    }
    const figFor = (key: string, isCreature: boolean, token: TileId, actor: Actor, at: XY, down: boolean): Fig => {
      const cast = castEntry(style, token) !== null;
      return { key, isCreature, token, set: creatureSets.get(token) ?? null, sprite: !cast, timing: creatureTimingFor(token, style), actor, at, down };
    };
    // A knocked-down creature lies in its down pose until it stands up on its turn.
    const figs: Fig[] = p.creatures.map((c) => figFor(c.id, true, c.token, c.actor, c.at, c.prone));
    const heroFig: Fig | null = heroSet ? { key: "hero", isCreature: false, token: bodySpriteId(p.archetypeId), set: heroSet, sprite: false, timing: heroSet.entry, actor: p.heroActor, at: p.heroAt, down: heroDown(p) } : null;
    if (heroFig) figs.push(heroFig);
    // Positions first, for all of them: actorAt lands a finished step, which actorClip then relies on.
    const placed = figs.map((f) => ({ f, pos: actorAt(f.actor, f.at, now) })).sort((a, b) => a.pos.y - b.pos.y);
    // The fog of war: a creature the hero cannot see is not drawn. It shows from the first square in sight, either end of its current step
    // (so it appears on the way in and is not cut off on the way out); remembered squares never show creatures.
    const creatureTiles: XY[] = [];
    for (let i = placed.length - 1; i >= 0; i--) {
      const { f, pos } = placed[i]!;
      if (!f.isCreature) continue;
      const drawn = { x: Math.round(pos.x), y: Math.round(pos.y) };
      const at = seesTile(p, f.at) ? f.at : seesTile(p, drawn) ? drawn : null;
      if (at) creatureTiles.push(at);
      else placed.splice(i, 1);
    }
    // Every body lies under everything, where it fell, until it is searched and long after (the picture does not forget).
    for (const b of p.bodies) {
      const key = `body:${b.id}:${b.token}:${b.at.x},${b.at.y}`;
      placed.unshift({ f: { ...figFor(key, false, b.token, bodyActor(key), b.at, true), isBody: true }, pos: b.at });
    }
    const out: StageItem[] = [];
    let hero: XY = p.heroAt;
    for (const { f, pos } of placed) {
      if (f.key === "hero") hero = pos;
      const c = actorClip(f.actor, f.timing, size, f.down, now);
      if (!c) continue;
      // Reduced motion shows the first frame of a clip; a body lying there is the last frame of its fall.
      const frame = REDUCED_MOTION ? (f.isBody ? c.count - 1 : 0) : actorFrame(f.actor, c, now);
      if (f.sprite) {
        const pose = spritePose(c.clip, frame, c.dir);
        const feetX = (pos.x + 0.5) * tileScale;
        const feetY = (pos.y + 1) * tileScale;
        const px16 = tileScale / 16;
        const g = spriteGeometry(manifest, f.token, pose, feetX, feetY, px16);
        if (g) out.push({ kind: "sprite", manifest, assetId: f.token, pose, feetX, feetY, px16, box: g.box });
        continue;
      }
      const shown = resolveCast(memoryOf(f.key), f.set, c, frame);
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
    return { items: out, hero, creatureTiles };
  }

  /** The actor a body is drawn with: one per body, facing left, its fall played once and then held (so a kill shows the creature going down where it stood). */
  const bodyActors = new Map<string, Actor>();
  function bodyActor(key: string): Actor {
    let a = bodyActors.get(key);
    if (!a) {
      a = newActor("left");
      playClips(a, ["death"], performance.now());
      bodyActors.set(key, a);
    }
    return a;
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

    const placed: { items: StageItem[]; hero: XY; creatureTiles: XY[] } = style
      ? placeFigures(p, now, style, manifest, tileScale)
      : { items: [], hero: p.heroAt, creatureTiles: creaturesInSight(p).map((c) => c.at) };
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
    host.afterFrame?.(now, placed.creatureTiles);
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
  miss: ["Grr! Hold still!"],
  thief: ["Hey! Thief!"],
} as const;
const bark = (list: readonly string[]): string => list[Math.floor(Math.random() * list.length)]!;
/** Which creatures talk: the goblin has barks; a skeleton or a rat does not, and the board stays quiet for them. */
const barksFor = (token: TileId): typeof GOBLIN_BARKS | null => (token === "token_goblin" ? GOBLIN_BARKS : null);

/** 4x4 Bayer thresholds, row-major, the same ordered dither render/shroud.ts uses for its soft edges. */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Take the fog off the half square above a figure standing on `tile`, so a head
 * that reaches into the square above it (the goblin's does) is not shrouded
 * over. The edge is dithered upward: clear against the figure, mist again half
 * a square up. Pixel coordinates are the shroud canvas's own (source pixels).
 */
function clearHeadroom(px: Uint8ClampedArray, states: Uint8Array, tile: XY, size: number): void {
  const above = tile.y - 1;
  if (above < 0 || (states[above * CELL_WIDTH + tile.x] ?? 2) >= 2) return;
  const band = Math.max(1, Math.floor(size / 2));
  const w = CELL_WIDTH * size;
  for (let dy = 1; dy <= band; dy++) {
    const y = tile.y * size - dy;
    const keep = dy / (band + 1);
    for (let x = tile.x * size; x < (tile.x + 1) * size; x++) {
      if (keep <= (BAYER_4[((y & 3) << 2) | (x & 3)]! + 0.5) / 16) px[(y * w + x) * 4 + 3] = 0;
    }
  }
}

/** A sack, 8 by 8 source pixels, set in the bottom right of its square so a hero standing on it is not hidden: what a pile of dropped things looks like on the ground. */
const SACK_ROWS = ["...oo...", "..obbo..", "..otto..", ".obbbbo.", "obhbbbso", "obhbbsso", "obbbssso", ".oooooo."] as const;
const SACK_COLOURS: Readonly<Record<string, string>> = { o: "#3a2414", b: "#b98d52", h: "#dcb877", s: "#8a6232", t: "#b0382f" };

/**
 * What lies on the ground, drawn over the board on the marks canvas: a sack on every square with a pile, and a small gold
 * glint on a body that has not been searched yet. Only squares the hero has seen (the fog is under this canvas, not over it).
 */
function drawLootMarks(ctx: CanvasRenderingContext2D, p: PlayState, ts: number): void {
  const u = ts / 16;
  const px = (x: number, y: number, w: number, h: number, colour: string, at: XY): void => {
    ctx.fillStyle = colour;
    ctx.fillRect(Math.round(at.x * ts + x * u), Math.round(at.y * ts + y * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u)));
  };
  for (const q of p.piles) {
    if (q.items.length === 0 || sightLevel(p, q.at) === 0) continue;
    SACK_ROWS.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const colour = SACK_COLOURS[row[rx]!];
        if (colour) px(7 + rx, 8 + ry, 1, 1, colour, q.at);
      }
    });
  }
  for (const b of p.bodies) {
    if (b.looted || sightLevel(p, b.at) === 0) continue;
    // A four-point glint in the top right corner of the square.
    px(12, 1, 1, 3, "#ffd34c", b.at);
    px(11, 2, 3, 1, "#ffd34c", b.at);
    px(12, 2, 1, 1, "#fff6dc", b.at);
  }
}

/** A small tag at the foot of a square: the creature standing there has been knocked down. (Drawn in both art modes; the animated figure also lies down.) */
function drawProneMark(ctx: CanvasRenderingContext2D, at: XY, ts: number): void {
  const w = Math.round(ts * 0.86);
  const h = Math.max(11, Math.round(ts * 0.22));
  const x = Math.round(at.x * ts + (ts - w) / 2);
  const y = Math.round((at.y + 1) * ts - h - 1);
  ctx.fillStyle = "rgba(20, 16, 24, 0.85)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#ffb86c";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "#ffb86c";
  ctx.font = `700 ${Math.max(8, Math.round(h * 0.72))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PRONE", x + w / 2, y + h / 2 + 1);
}

/**
 * A small picture of a class for the sheet's header and the creator's class cards:
 * the archetype's own token sprite from the art the bench is showing, scaled by a
 * whole number. Null when the art has no such token.
 */
function portraitCanvas(archetypeId: string): HTMLCanvasElement | null {
  const sprite = artManifest("fantasy").tokens[bodySpriteId(archetypeId as ArchetypeId)];
  const rows = sprite?.pixels;
  if (!rows || rows.length === 0) return null;
  const manifest = artManifest("fantasy");
  const w = Math.max(...rows.map((r) => r.length));
  const k = Math.max(1, Math.round(72 / rows.length));
  const canvas = document.createElement("canvas");
  canvas.width = w * k;
  canvas.height = rows.length * k;
  canvas.className = "lt-item-icon";
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  rows.forEach((row, y) => {
    row.forEach((idx, x) => {
      if (idx < 0) return;
      ctx.fillStyle = manifest.palette[idx] ?? "#f0f";
      ctx.fillRect(x * k, y * k, k, k);
    });
  });
  return canvas;
}

function mountPlayPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  // A scene that starts here (first visit, or a hero the bench no longer offers) gets its checkpoint below; coming back to one in progress does not.
  const startedNew = !play || !PLAYABLE_HEROES.includes(play.archetypeId);
  if (startedNew) play = newPlay("fantasy", PLAYABLE_HEROES[0]!, ROOM_FLOOR.fantasy);
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
    const old = play;
    play = newPlay("fantasy", id, ROOM_FLOOR.fantasy, undefined, undefined, st().room);
    carryJournals(old, play, "a different hero was picked");
    newScene();
  });
  field("Hero", heroSelect);
  // The Room: which creatures the sandbox starts with. Changing it starts the scene again (the hero as it began, gear and pack kept).
  const roomSelect = el_("select", "bn-select");
  roomSelect.setAttribute("aria-label", "Room");
  for (const r of ROOM_CHOICES) {
    const o = el_("option", undefined, roomLabel(st().template, r));
    o.value = r;
    roomSelect.appendChild(o);
  }
  roomSelect.value = st().room;
  roomSelect.onchange = () => {
    roomChoice = roomSelect.value as RoomChoice;
    const old = play!;
    play = newPlay(old.template, old.archetypeId, old.floorId, old.hero, old.start, roomChoice);
    carryJournals(old, play, "the room was changed");
    newScene();
  };
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
    sheetView?.setStyle(textStyle);
    creationView?.setStyle(textStyle);
  };
  field("Text", textSelect);
  // After Text, so the selects the other checks pick by position (Hero, Zoom, Text) keep their places.
  field("Room", roomSelect);
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
  resetBtn.onclick = () => resetScene();
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
      "Click a square to walk there, a creature to attack that creature, the door or the chest to use it. Walls and shut doors hide what is behind them: you see only what is in line of sight, remember what you have seen, and cannot click what you have not. On a phone, tap once to see the path and again to go. Right-click or long-press any square for what you can do there (Look closer is the first line; a kick, a shove, hiding, a pickpocket and more show up for the characters that can); type what you do in the box. Hover anything in the pack, or any number on the sheet, to read exactly what it is; click an item for what you can do with it (equip, use, drop, destroy), or why you cannot. A fallen creature stays where it fell: click it, or stand next to it and press E, to search it. Things you drop lie in a sack on your square. Sheet (C) opens your character sheet and makes your own hero; the Hero setting here quick-picks a ready-made one. The DM's answers come with two to four suggested next moves (keys 1 to 4, or press them); Attack, Use, Potion and End turn show only when they would do something. Rest (R) makes camp once a day and saves; the Saves tab goes back to any save, and a checkpoint is made when a scene starts. The Log tab (L) keeps every roll, find and line of narration; the board shows only the story, and it fades. Keys: arrows or WASD step, F attacks the nearest creature in reach, E use, Q potion, R rest, 1 to 4 suggested moves, I pack, L log, C sheet, T end turn, Space skips a creature's turn, Esc stops the DM. The Room setting chooses who is in the east room: one goblin, or a goblin and a skeleton (each its own hit points, dice and turn).",
    ),
  );

  // ---- the stage: the board, the marks over it, and the text overlay ---------

  const stageWrap = el_("div", "lt-stage-wrap");
  const viewport = el_("div", "lt-viewport");
  const board = el_("div", "lt-board");
  const canvas = el_("canvas", "lt-canvas");
  // The fog of war sits between the board and the marks: at the art's own resolution, scaled up exactly over the board.
  const shroud = el_("canvas", "lt-shroud");
  shroud.setAttribute("aria-hidden", "true");
  const marks = el_("canvas", "lt-marks");
  marks.setAttribute("aria-hidden", "true");
  board.append(canvas, shroud, marks);
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
  const hud: Hud = createHud(trayCol, textStyle, (id) => void onHudAction(id), {
    slot: trayHost,
    onAsk: (text) => void runDm({ kind: "freehand", text }),
    onItemAction: (key, id) => void runItemAction(key, id),
  });
  const picker = createSkinPicker(shopHost, tray, { owned: OWNED_SKINS, onTry: (id) => (diceSkin = id) });

  /** The numbers a roll's journal entry carries beside its dice (the export lists every roll: who, the dice, the numbers, the verdict). */
  interface RollMeta {
    modifier?: number;
    total?: number;
    target?: number;
  }

  /** Throw dice in the tray, and write the throw in the roll journal. Every throw on the table goes through here. */
  function throwDice(req: RollRequest, who: string, meta: RollMeta = {}): Promise<void> {
    const rec: RollRecord = {
      at: new Date().toISOString(),
      who,
      label: req.label ?? "",
      dice: req.dice.map((d) => ({ kind: d.kind, result: d.result })),
      ...(meta.modifier !== undefined ? { modifier: meta.modifier } : {}),
      ...(meta.total !== undefined ? { total: meta.total } : {}),
      ...(meta.target !== undefined ? { target: meta.target } : {}),
      ...(req.detail ? { verdict: req.detail } : {}),
    };
    const journal = st().rollJournal;
    journal.push(rec);
    if (journal.length > ROLL_JOURNAL_KEEP) journal.splice(0, journal.length - ROLL_JOURNAL_KEEP);
    return tray.roll(req);
  }

  /** Wait for the player's tap on the tray (unless the tray rolls for them), then throw. */
  async function rollStep(prompt: string, dice: readonly { kind: DieKind; result: number }[], label: string, detail: string, tone: "good" | "bad" | "plain", meta?: RollMeta): Promise<void> {
    if (rollMyself) await tray.awaitRoll(prompt, dice.map((d) => d.kind));
    await throwDice({ dice, label, detail, tone }, st().hero.name, meta);
  }

  /** A creature's throw: in ITS tray, with its own dice and its name on the rim (foeDice.ts: the better the enemy, the fancier the die and the tray). It rolls itself; nobody taps. */
  function foeThrow(p: PlayState, c: Creature, dice: readonly { kind: DieKind; result: number }[], label: string, detail: string, tone: "good" | "bad" | "plain", meta?: RollMeta): Promise<void> {
    const foe = foeDiceForToken(c.token);
    const who = c.seen ? creatureLabel(p, c) : "";
    return throwDice({ dice, label, detail, tone, skin: foe.skinId, tray: foe.trayId, who: c.seen ? `${sentenceCase(who)} rolls` : "Something rolls" }, c.seen ? sentenceCase(who) : "Something", meta);
  }

  // ---- the character sheet and character creation (sheet.ts) --------------------
  //
  // Both open over the board (the stage), so the HUD and the dice tray stay in view
  // beside them on a wide screen. While one is open the game waits: board clicks and
  // game keys do nothing, the HUD's action buttons and the DM field are greyed, and
  // Escape (or the view's own buttons) gets back to the board. The sheet follows the
  // hero live (hit points, potions, what the DM hands over).

  let sheetView: SheetView | null = null;
  let creationView: CreationView | null = null;
  /** The debug export's outcome, in plain words, under its button in the Saves tab; and whether the clipboard fallback button shows. */
  let exportStatus: string | undefined;
  let exportCopyShown = false;
  /** The loot window on the board (a body being searched, or a pile), and what it is for. */
  let lootWin: LootWindow | null = null;
  let lootTarget: { kind: "body"; id: string } | { kind: "pile"; at: XY } | null = null;
  let sheetSig = "";
  const overlayOpen = (): boolean => sheetView !== null || creationView !== null;
  const sheetExtras = (p: PlayState): SheetExtras => ({ potions: p.potions, notes: p.itemNotes, portrait: portraitCanvas(p.archetypeId) });
  const sheetSigFor = (p: PlayState): string => JSON.stringify([p.hero, p.potions, p.itemNotes, art.source, art.chars, art.size]);

  /** The stage is only as tall as the board, which can be short; a sheet needs room to read. */
  function syncStageRoom(): void {
    stageWrap.style.minHeight = overlayOpen() ? `${Math.min(560, Math.max(380, Math.round(innerHeight * 0.7)))}px` : "";
  }

  function viewsChanged(): void {
    closeLoot();
    hover = null;
    previewed = null;
    marksKey = "";
    syncStageRoom();
    renderHud();
  }

  function closeSheet(): void {
    sheetView?.close();
  }

  function closeCreation(): void {
    const c = creationView;
    creationView = null;
    c?.close();
    viewsChanged();
  }

  function closeViews(): void {
    closeSheet();
    if (creationView) closeCreation();
  }

  function openSheetView(): void {
    if (overlayOpen()) return;
    const p = st();
    closeLoot();
    sheetView = openSheet(stageWrap, p.hero, {
      style: textStyle,
      extras: sheetExtras(p),
      // The same item cards as the pack: what each thing can do, and why not when it cannot.
      itemCard: (key) => itemCardFor(st(), key),
      onItemAction: (key, id) => void runItemAction(key, id),
      onNewCharacter: () => {
        closeSheet();
        openCreationView();
      },
      onClose: () => {
        sheetView = null;
        sheetSig = "";
        viewsChanged();
      },
    });
    sheetSig = sheetSigFor(p);
    viewsChanged();
  }

  function toggleSheet(): void {
    if (sheetView) closeSheet();
    else openSheetView();
  }

  /**
   * The creator's ability dice, thrown in the real tray one score at a time (four d6
   * each, so every number is on a die the player can see). With "I roll my own dice"
   * on, the player taps once for the whole set; a tap on the tray while it throws
   * jumps to the end of that throw.
   */
  async function rollScoreDice(groups: number, count: number, sides: number, label: string): Promise<number[][]> {
    const kind = dieOf(sides);
    const out: number[][] = [];
    const skipThrow = (): void => tray.skip();
    trayHost.addEventListener("click", skipThrow);
    // On a phone the tray sits under the stage: bring it into view for the throw (a no-op beside it).
    const scrollTo = (node: HTMLElement): void => node.scrollIntoView?.({ block: "nearest", behavior: REDUCED_MOTION ? "auto" : "smooth" });
    scrollTo(trayHost);
    try {
      for (let g = 0; g < groups; g++) {
        const faces = Array.from({ length: count }, () => rollDie(sides));
        if (g === 0 && rollMyself) await tray.awaitRoll(`Tap to roll your ${groups} scores`, faces.map(() => kind));
        const kept = dropLowest(faces);
        await throwDice(
          {
            dice: faces.map((result) => ({ kind, result })),
            label: `Score ${g + 1} of ${groups}: ${faces.join(" ")}`,
            // dropped is the lowest die's index; the player reads its face.
            detail: `KEEP ${kept.total}, DROP THE ${faces[kept.dropped]}`,
            tone: "plain",
          },
          `${st().hero.name} (character creation)`,
        );
        // Cancelled, or the scene went away, while it rolled: stop throwing.
        if (!alive || !creationView) throw new Error(label);
        out.push(faces);
        // A beat to read this score before the next throw clears it (a tap on the tray moves on).
        if (g < groups - 1 && !REDUCED_MOTION) {
          await new Promise<void>((resolve) => {
            const done = (): void => {
              clearTimeout(timer);
              trayHost.removeEventListener("click", done);
              resolve();
            };
            const timer = setTimeout(done, SCORE_READ_MS);
            trayHost.addEventListener("click", done);
          });
        }
      }
    } finally {
      trayHost.removeEventListener("click", skipThrow);
      if (alive) scrollTo(stageWrap);
    }
    return out;
  }

  /** The new hero: the sheet the creator built, in a fresh scene with the DM's memory and recent talk cleared. */
  function beginCharacter(made: CharacterSheet): void {
    const p = st();
    const id = made.archetypeId as ArchetypeId;
    const sheet = made.appearanceAssetId === bodySpriteId(id) ? made : { ...made, appearanceAssetId: bodySpriteId(id) };
    play = newPlay(p.template, id, ROOM_FLOOR[p.template], undefined, sheet, p.room);
    carryJournals(p, play, "a new character began");
    newScene();
    story({ text: `${sheet.name} steps into the room.`, tone: "plain" });
  }

  function openCreationView(): void {
    if (overlayOpen()) return;
    const p = st();
    creationView = openCreation(
      stageWrap,
      { style: () => textStyle, rollDice: rollScoreDice, portrait: portraitCanvas },
      {
        start: { archetypeId: p.archetypeId },
        onBegin: (sheet) => {
          creationView = null;
          beginCharacter(sheet);
        },
        onCancel: () => {
          creationView = null;
          viewsChanged();
        },
      },
    );
    viewsChanged();
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

  /** Over a figure's head, from the game's own headAnchor (the token's sprite height at the art's resolution). `who` is "hero" or a creature's token asset id. */
  function headOf(who: "hero" | TileId, tile?: XY): OverlayPoint {
    const p = st();
    const at = tile ?? (who === "hero" ? p.heroAt : (p.fallenAt ?? p.heroAt));
    const assetId = who === "hero" ? bodySpriteId(p.archetypeId) : who;
    const layout: CellLayout = { tiles: [], props: [], tokens: [{ id: "who", assetId, x: at.x, y: at.y, kind: who === "hero" ? "pc" : "monster" }], exits: [], sealed: true };
    const a = headAnchor(layout, "who", artManifest(p.template), tileScale());
    const ts = tileScale();
    return a ? toHost(a.x, a.y) : toHost((at.x + 0.5) * ts, at.y * ts);
  }

  // ---- plans: what a click on a square means -----------------------------------

  type Plan =
    | { kind: "walk"; path: XY[]; costFt: number; tile: XY }
    | { kind: "attack"; path: XY[]; costFt: number; tile: XY }
    | { kind: "loot"; path: XY[]; costFt: number; tile: XY }
    | { kind: "use"; path: XY[]; costFt: number; tile: XY }
    | { kind: "look"; path: XY[]; costFt: number; tile: XY }
    | { kind: "none"; tile: XY; reason: string };

  function planFor(tile: XY): Plan {
    const p = st();
    if (heroDown(p)) return { kind: "none", tile, reason: DOWN_NOTE };
    if (p.round && !isPlayersTurn(p.round)) return { kind: "none", tile, reason: "Wait for your turn." };
    // Fog: a square the hero has never seen cannot be clicked, and a monster it cannot see is just another square.
    if (sightLevel(p, tile) === 0) return { kind: "none", tile, reason: NOT_SEEN };
    const field = heroField(p);
    const cost = (path: XY[]) => path.length * FEET_PER_TILE;
    const there = creatureAt(p, tile);
    if (there && creatureInSight(p, there) && there.hostile) {
      if (!heroActionReady(p)) return { kind: "none", tile, reason: "Your action is used. Press End turn (T)." };
      const spot = approachTile(field, there.at, heroReachTiles(p), sightKit(p).los);
      const path = spot ? pathTo(field, spot) : null;
      if (!path) return { kind: "none", tile, reason: p.round ? "You cannot reach it this turn." : "You cannot reach it from here." };
      return { kind: "attack", path, costFt: cost(path), tile };
    }
    // A creature that is not hostile (a villager, a shopkeeper): a click walks up to it and looks closer (the DM answers).
    if (there && creatureInSight(p, there)) {
      if (tileDistance(p.heroAt, tile) <= 1) return { kind: "look", path: [], costFt: 0, tile };
      const spot = approachTile(field, tile, 1);
      const path = spot ? pathTo(field, spot) : null;
      if (!path) return { kind: "none", tile, reason: p.round ? "Too far to reach this turn." : "You cannot get next to it from here." };
      return { kind: "look", path, costFt: cost(path), tile };
    }
    // A body that has not been searched, or things lying on the ground: a click walks up and opens what is there.
    if (bodyAt(p, tile) || pileAt(p, tile)) {
      if (tileDistance(p.heroAt, tile) <= 1) return { kind: "loot", path: [], costFt: 0, tile };
      const spot = approachTile(field, tile, 1);
      const path = spot ? pathTo(field, spot) : null;
      if (!path) return { kind: "none", tile, reason: p.round ? "Too far to reach this turn." : "You cannot get next to it from here." };
      return { kind: "loot", path, costFt: cost(path), tile };
    }
    // A prop the DM placed: a click walks up to it and looks closer (the DM answers). A grate is
    // floor, so a click walks onto it; looking at one is a right-click or a long press, because
    // every DM answer is a paid call and the floor is full of grates.
    const look = lookableAt(p, tile);
    if (look === "prop") {
      if (tileDistance(p.heroAt, tile) <= 1) return { kind: "look", path: [], costFt: 0, tile };
      const spot = approachTile(field, tile, 1);
      const path = spot ? pathTo(field, spot) : null;
      if (!path) return { kind: "none", tile, reason: p.round ? "Too far to reach this turn." : blockedWords(p, tile) };
      return { kind: "look", path, costFt: cost(path), tile };
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
    const lootSig = `${p.piles.map((q) => `${q.at.x},${q.at.y},${q.items.length}`).join(";")}|${p.bodies.map((b) => `${b.at.x},${b.at.y},${b.looted ? 1 : 0}`).join(";")}`;
    const key = [canvas.width, canvas.height, ts, busy, walkQueue.length, p.heroAt.x, p.heroAt.y, p.creatures.map((c) => `${c.at.x},${c.at.y},${creatureInSight(p, c) ? 1 : 0},${c.prone ? 1 : 0},${c.hostile ? 1 : 0}`).join(";") || "-", p.exploredRev, p.worldRev, p.doorOpen, p.doorLocked, p.searched, p.round ? `${p.round.activeIndex},${p.round.roundNumber},${activeCombatant(p.round)?.economy.movementRemaining},${activeCombatant(p.round)?.economy.action}` : "x", hover ? `${hover.x},${hover.y}` : "-", heroDown(p), lootSig].join("|");
    if (key === marksKey) return;
    marksKey = key;
    if (marks.width !== canvas.width || marks.height !== canvas.height) {
      marks.width = canvas.width;
      marks.height = canvas.height;
    }
    const ctx = marks.getContext("2d")!;
    ctx.clearRect(0, 0, marks.width, marks.height);
    drawLootMarks(ctx, p, ts);
    for (const c of p.creatures) if (c.prone && creatureInSight(p, c)) drawProneMark(ctx, c.at, ts);
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
    // Each hostile creature, outlined when the hero could hit it this turn (and only while the hero can see it).
    if (heroActionReady(p)) {
      for (const c of p.creatures) {
        if (!c.hostile || !creatureInSight(p, c)) continue;
        const reach = tileDistance(p.heroAt, c.at) <= heroReachTiles(p);
        ctx.strokeStyle = reach ? "rgba(235, 70, 60, 0.95)" : "rgba(235, 70, 60, 0.45)";
        ctx.lineWidth = Math.max(2, ts / 16);
        ctx.setLineDash(reach ? [] : [ts / 6, ts / 8]);
        ctx.strokeRect(c.at.x * ts + 2, c.at.y * ts + 2, ts - 4, ts - 4);
        ctx.setLineDash([]);
      }
    }
    if (!plan || plan.kind === "none") {
      if (plan && plan.reason && hover && sightLevel(p, hover) > 0) {
        ctx.strokeStyle = "rgba(235, 70, 60, 0.7)";
        ctx.lineWidth = 2;
        ctx.strokeRect(hover.x * ts + 3, hover.y * ts + 3, ts - 6, ts - 6);
      }
      return;
    }
    // The path as dots, its end as a ring, and its length in feet.
    const colour = plan.kind === "attack" ? "rgba(255, 120, 90, 0.95)" : plan.kind === "use" || plan.kind === "loot" ? "rgba(255, 205, 90, 0.95)" : plan.kind === "look" ? "rgba(170, 215, 255, 0.95)" : "rgba(255, 245, 210, 0.95)";
    ctx.fillStyle = colour;
    for (const t of plan.path) {
      ctx.beginPath();
      ctx.arc((t.x + 0.5) * ts, (t.y + 0.5) * ts, Math.max(2, ts / 10), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(2, ts / 14);
    ctx.strokeRect(plan.tile.x * ts + 3, plan.tile.y * ts + 3, ts - 6, ts - 6);
    const words = plan.kind === "attack" ? (plan.costFt ? `${plan.costFt} ft, attack` : "Attack") : plan.kind === "loot" ? (plan.costFt ? `${plan.costFt} ft, search` : "Search") : plan.kind === "use" ? (plan.costFt ? `${plan.costFt} ft, use` : "Use") : plan.kind === "look" ? (plan.costFt ? `${plan.costFt} ft, look` : "Look closer") : `${plan.costFt} ft`;
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

  /**
   * The log is the full history (the Log tab). The board's story strip gets only story: creature speech and the big moments,
   * through story(). Here, every line the log gained since the last call that carries a short notice (an item or a potion
   * gained) flashes it beside the Pack button once, and the history is trimmed to LOG_KEEP.
   */
  let said = 0;
  function flushLog(): void {
    const p = st();
    if (said > p.log.length) said = p.log.length;
    for (const line of p.log.slice(said)) if (line.notice) hud.notice(line.notice, "good");
    said = p.log.length;
    if (p.log.length > LOG_KEEP) {
      archiveLog(p.log.slice(0, p.log.length - LOG_KEEP));
      p.log.splice(0, p.log.length - LOG_KEEP);
      said = p.log.length;
    }
  }

  /** A line for the board's story strip (a creature's words, a big moment). It goes in the Log as well; everything mechanical goes only there. */
  function story(line: DialogueLine, alsoLog = true): void {
    overlay.say(line);
    if (alsoLog) st().log.push({ text: line.speaker ? `${line.speaker}: ${line.text}` : line.text, tone: "plain" });
  }

  /** The DM's suggested moves go away when the hero moves, acts, or the next answer arrives. */
  function clearOptions(): void {
    const p = st();
    if (p.options.length > 0) p.options = [];
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

  /** Float an attack's outcome over the target's head (the dice themselves are in the tray). `target` is "hero" or the creature's token asset id. */
  function showAttack(events: readonly CombatEvent[], target: "hero" | TileId, targetTile?: XY): void {
    for (const ev of events) {
      if (ev.kind === "damage") {
        if (ev.hpLost > 0) overlay.float(headOf(target, targetTile), ev.critical ? `-${ev.hpLost} CRIT!` : `-${ev.hpLost}`, ev.critical ? "crit" : "damage");
        else overlay.float(headOf(target, targetTile), "DEATH SAVE", "info");
      } else if (ev.kind === "miss") overlay.float(headOf(target, targetTile), "MISS", "miss");
      else if (ev.kind === "down") overlay.float(headOf(target, targetTile), "DOWN", "down");
      else if (ev.kind === "heal") overlay.float(headOf(target), `+${ev.amount}`, "heal");
    }
  }

  /** Whether a creature is in the order of the fight that is on. */
  const inOrder = (p: PlayState, c: Creature): boolean => p.round?.order.some((cb) => cb.id === c.id) === true;

  /** A hostile that is not yet in a fight (asleep, or awake with no round): what a strike, a shove or the DM's word brings in. */
  const needsFight = (p: PlayState, c: Creature): boolean => c.hostile && p.creatures.includes(c) && !inOrder(p, c);

  /** What a creature says as it wakes (the goblin has barks; others stay quiet). */
  function wakeBark(p: PlayState, woke: readonly Creature[]): void {
    const talker = woke.find((c) => barksFor(c.token) !== null);
    if (!talker) return;
    story({ speaker: talker.seen ? creatureName(p, talker) : "Something", text: bark(barksFor(talker.token)!.wake), tone: "bad" });
  }

  /** A creature's own initiative die, thrown in its own tray: the total startCombat rolled, less the fixed bonus it adds. */
  async function foeInitiative(c: Creature): Promise<void> {
    const theirs = st().round?.order.find((cb) => cb.id === c.id);
    if (!theirs) return;
    const d20 = theirs.initiative - MONSTER_INITIATIVE_MODIFIER;
    await foeThrow(st(), c, [{ kind: "d20", result: d20 }], `${d20} ${signedNum(MONSTER_INITIATIVE_MODIFIER)} = ${theirs.initiative}`, "INITIATIVE", "plain", { modifier: MONSTER_INITIATIVE_MODIFIER, total: theirs.initiative });
  }

  /**
   * The fight begins, or grows. `wake` are the creatures that cause it (they notice the hero, were struck, or the DM woke them; by default,
   * everyone who notices the hero now). With no fight on, everyone awake rolls initiative, each hostile's die in its own tray and look, and
   * the hostiles take their turns where they sort. With one on, each of them joins it, rolling its own initiative.
   */
  async function beginFight(fromHiding = false, wake?: readonly Creature[]): Promise<void> {
    const p = st();
    const woken = (wake ?? noticers(p)).filter((c) => c.hostile && p.creatures.includes(c));
    if (p.round) {
      const joiners = woken.filter((c) => !inOrder(p, c));
      if (joiners.length === 0) return;
      busy = true;
      walkQueue.length = 0;
      onArrive = null;
      clearOptions();
      for (const c of joiners) {
        if (st() !== p || !p.round) break;
        c.actor.dir = castDirToward(p.heroAt.x - c.at.x, p.heroAt.y - c.at.y);
        if (joinFight(p, c) === null) continue;
        wakeBark(p, [c]);
        flushLog();
        refreshAll();
        await foeInitiative(c);
      }
      busy = false;
      refreshAll();
      return;
    }
    if (!p.creatures.some((c) => c.hostile && (c.awake || woken.includes(c)))) return;
    busy = true;
    walkQueue.length = 0;
    onArrive = null;
    clearOptions();
    startFight(p, fromHiding, woken);
    if (!p.round) {
      busy = false;
      return;
    }
    for (const c of awakeHostiles(p)) c.actor.dir = castDirToward(p.heroAt.x - c.at.x, p.heroAt.y - c.at.y);
    wakeBark(p, woken.length > 0 ? woken : awakeHostiles(p));
    flushLog();
    refreshAll();
    void overlay.banner("ROLL INITIATIVE", "initiative");
    // The hero's own initiative die: the total startCombat rolled, less the Dexterity it added.
    // startFight just set the round (read it fresh: TypeScript still sees it as null from the check above).
    const mine = st().round?.order.find((c) => c.id === HERO_ID);
    if (mine) {
      const d20 = mine.initiative - p.hero.modifiers.dex;
      await rollStep("Tap to roll initiative", [{ kind: "d20", result: d20 }], `${d20} ${signedNum(p.hero.modifiers.dex)} = ${mine.initiative}`, "INITIATIVE", "plain", { modifier: p.hero.modifiers.dex, total: mine.initiative });
    }
    // Each hostile's own initiative die, in its own tray, in the order the round sorted them.
    for (const cb of [...(st().round?.order ?? [])]) {
      const c = cb.side === "hostile" ? creatureById(st(), cb.id) : undefined;
      if (c) await foeInitiative(c);
    }
    busy = false;
    await runHostiles();
  }

  /** Every turn that is not the hero's, played back (each hostile in initiative order), until it is the hero's turn again or the fight is over. */
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
    while (p.round && !isPlayersTurn(p.round)) {
      const m = activeCreature(p);
      if (!m) {
        // A combatant with no creature on the board (it fled, or was removed): it simply drops out of the order.
        const gone = activeCombatant(p.round);
        if (!gone) break;
        const rest = dropCombatant(p.round, gone.id);
        p.round = hasHostiles(rest) ? rest : null;
        continue;
      }
      // A turn the hero cannot see is a neutral banner and no waiting: it hears that something moved, and sees the creature only from the first square in sight.
      let anySeen = creatureInSight(p, m);
      if (anySeen) await overlay.banner(`${creatureName(p, m).toUpperCase()}'S TURN`, "enemy");
      else void overlay.banner("SOMETHING MOVES", "enemy");
      const start = { ...m.at };
      // Its turn: it knows where the hero is, hidden or not.
      if (p.heroHidden || p.sneaking) {
        if (p.heroHidden) p.log.push({ text: "It is on its feet and knows where you are. You are no longer hidden.", tone: "plain" });
        p.heroHidden = false;
        p.sneaking = false;
      }
      const turn = monsterTurnRules(p, m);
      // Walk it square by square along the engine's own path.
      const move = turn.events.find((e): e is Extract<CombatEvent, { kind: "move" }> => e.kind === "move");
      let from = start;
      for (const sq of move?.path ?? []) {
        stepAnim(m.actor, from, sq);
        const cameFromSight = seesTile(p, from);
        m.at = { ...sq };
        noteSight(p);
        const inSight = creatureInSight(p, m);
        anySeen = anySeen || inSight;
        refreshAll();
        if (inSight || cameFromSight) await wait(STEP_MS);
        from = sq;
      }
      if (turn.endAt) m.at = turn.endAt;
      noteSight(p);
      anySeen = anySeen || creatureInSight(p, m);
      // Then the swing, and the blow lands when it plays.
      const swing = turn.events.filter((e) => e.kind !== "move" && e.kind !== "turnStart");
      if (swing.length > 0) {
        const atk = swing.find((e): e is Extract<CombatEvent, { kind: "attack" }> => e.kind === "attack");
        const dmg = swing.find((e): e is Extract<CombatEvent, { kind: "damage" }> => e.kind === "damage");
        if (atk) {
          const r0 = atk.readout;
          // The better the enemy, the fancier its dice and the tray they land in (foeDice.ts): each creature rolls in its own, with its name on the rim.
          await foeThrow(
            p,
            m,
            [{ kind: "d20", result: r0.roll }],
            `${creatureName(p, m)}: ${r0.roll} ${signedNum(r0.modifier)} = ${r0.total} vs ${r0.target}`,
            // A critical's full verdict is too long for the tray's line and would cut the damage off: say CRITICAL and the number.
            dmg ? `${dmg.critical ? "CRITICAL" : verdictWords({ hit: true, critical: false, fumble: false })}, ${dmg.amount} DAMAGE` : verdictWords({ hit: false, critical: false, fumble: !!r0.fumble }),
            r0.hit ? "bad" : "good",
            { modifier: r0.modifier, total: r0.total, target: r0.target },
          );
        }
        m.actor.dir = castDirToward(p.heroAt.x - m.at.x, p.heroAt.y - m.at.y);
        if (!REDUCED_MOTION) playClips(m.actor, ["attack"], performance.now());
        await wait(320);
        const hpBefore = p.hero.currentHp;
        p.hero = turn.sheet;
        showAttack(swing, "hero");
        const now = performance.now();
        if (!REDUCED_MOTION && p.hero.currentHp < hpBefore) playClips(p.heroActor, [heroDown(p) ? "death" : "hit"], now);
        if (swing.some((e) => e.kind === "miss")) {
          const talk = barksFor(m.token);
          if (talk) story({ speaker: creatureName(p, m), text: bark(talk.miss), tone: "plain" });
        }
      } else {
        p.hero = turn.sheet;
      }
      // Out of sight the whole turn, the log says only that something moved.
      p.log.push(...(anySeen || swing.length > 0 ? turn.lines : [{ text: "Something moves nearby.", tone: "plain" as const }]));
      flushLog();
      refreshAll();
      if (anySeen) await wait(650);
      if (heroDown(p)) {
        p.round = null;
        refreshAll();
        await overlay.banner("DEFEAT", "defeat");
        story({ text: DOWN_NOTE, tone: "bad", sticky: true });
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

  /** After anything the hero does: a kill may end the fight, a step may wake a sleeper (it starts the fight, or joins the one that is on). */
  async function afterHeroAction(): Promise<void> {
    const p = st();
    flushLog();
    refreshAll();
    // The fight is won when no hostile is left on the board at all (a sleeper left alone keeps it open).
    if (hostilesOf(p).length === 0 && p.fallenAt && !p.round && fightWasOn) {
      fightWasOn = false;
      await overlay.banner("VICTORY", "victory");
    }
    // A hero who is sneaking or hidden is not noticed by sight: each step that would be is a Stealth check (stealthStep), not a wake.
    if (!p.round && noticers(p).length > 0 && !stealthy(p)) await beginFight();
    // A fight already on: a sleeper that notices the hero now joins it.
    else if (p.round && heroesTurn(p) && !heroDown(p) && noticers(p).length > 0) await beginFight();
  }
  let fightWasOn = false;

  /**
   * One step the hostiles could have noticed, taken sneaking or hidden: a Stealth check against each one's passive Perception, thrown in
   * the tray. Success keeps the hero unseen (hidden) and the walk goes on; failure is whoever spotted the hero noticing, and the fight starts.
   * Every such step is its own check. The table is busy until the check is thrown.
   */
  async function stealthStep(): Promise<void> {
    busy = true;
    const p = st();
    const watchers = noticers(p);
    const dcs = watchers.map((c) => creaturePassive(c));
    const out = stealthCheck({ sheet: p.hero, observers: watchers.map((c) => ({ id: c.id, passivePerception: creaturePassive(c), name: creatureLabel(p, c) })), rng: benchRng });
    const mod = skillModifierFor(p.hero, "Stealth");
    const unseen = out.spottedBy.length === 0;
    await rollStep("Tap to roll Stealth", out.dice, `Stealth ${out.total - mod} ${signedNum(mod)} = ${out.total} vs ${dcs.join("/")}`, unseen ? "UNSEEN" : "SPOTTED", unseen ? "good" : "bad", { modifier: mod, total: out.total, target: Math.max(...dcs) });
    if (!alive || st() !== p) return;
    p.log.push({ text: out.line, tone: unseen ? "good" : "bad" });
    if (unseen) {
      // Unseen: hidden from here on, and the walk (still queued) carries on.
      p.heroHidden = true;
      busy = false;
      flushLog();
      refreshAll();
      return;
    }
    p.heroHidden = false;
    p.sneaking = false;
    walkQueue.length = 0;
    onArrive = null;
    busy = false;
    flushLog();
    refreshAll();
    // Whoever spotted the hero starts the fight; the others join it when they notice, as anyone does with the hero in the open.
    const spotters = out.spottedBy.flatMap((id) => creatureById(p, id) ?? []);
    await beginFight(false, spotters);
    await afterHeroAction();
  }

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
    // Walking away leaves the DM's suggestions behind.
    clearOptions();
    stage.invalidate();
    return true;
  }

  /** Every frame, before drawing: the next square of a walk once the last has landed, then whatever waited for arrival. */
  function pump(now: number): void {
    drawMarks();
    // The HUD follows every change of turn state (it redraws only when what it shows changed).
    renderHud();
    // A loot window belongs to a body or pile within reach on a quiet board: a step away, a fight or a DM turn closes it.
    if (lootWin && lootTarget) {
      const p = st();
      const at = lootTarget.kind === "body" ? p.bodies.find((b) => b.id === (lootTarget as { id: string }).id)?.at : lootTarget.at;
      if (busy || p.round !== null || heroDown(p) || !at || tileDistance(p.heroAt, at) > 1) closeLoot();
    }
    if (busy) return;
    const h = st().heroActor;
    if (stepBusy(h, now)) return;
    if (walkQueue.length > 0) {
      const next = walkQueue.shift()!;
      if (!takeStep(next)) {
        walkQueue.length = 0;
        onArrive = null;
      }
      // A step that brings a hostile's notice ends the walk where it stands. A hero who is sneaking or hidden rolls Stealth for the step instead.
      const p = st();
      if (!p.round && noticers(p).length > 0 && stealthy(p)) {
        void stealthStep();
      } else if (!p.round && noticers(p).length > 0) {
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

  /** The attack roll of a swing in the tray (every d20 of it: two with advantage or disadvantage), then the hero turns and swings. */
  async function throwSwingAttack(sw: Swing, target: XY): Promise<void> {
    const p = st();
    const d = sw.dice;
    // A kick has no damage dice, so its number rides on this line; a critical's full verdict is too long beside it for the tray.
    const flat = sw.kick && d.hit && d.damage ? `, ${d.damage.total} DAMAGE` : "";
    await rollStep(
      `Tap to roll your ${sw.kick ? "kick" : "attack"}${d.mode ? ` with ${d.mode}` : ""}`,
      d.d20s.map((result) => ({ kind: "d20" as DieKind, result })),
      `${d.roll} ${signedNum(d.modifier)} = ${d.total} vs ${d.target}`,
      flat && d.critical ? `CRITICAL${flat}` : `${verdictWords(d)}${flat}`,
      d.hit ? "good" : "bad",
      { modifier: d.modifier, total: d.total, target: d.target },
    );
    p.heroActor.dir = castDirToward(target.x - p.heroAt.x, target.y - p.heroAt.y);
    if (!REDUCED_MOTION) playClips(p.heroActor, ["attack"], performance.now());
    await wait(300);
  }

  /** The damage dice of a hit (a kick has none: its damage is a flat number the log line states). */
  async function throwSwingDamage(sw: Swing): Promise<void> {
    const dmg = sw.dice.damage;
    if (!dmg || dmg.rolls.length === 0) return;
    await rollStep(
      sw.dice.critical ? "Critical! Tap to roll double damage" : "Tap to roll damage",
      dmg.rolls.map((v) => ({ kind: dieOf(dmg.sides), result: v })),
      `${dmg.rolls.join(" + ")} ${signedNum(dmg.modifier)} = ${dmg.total}`,
      sw.dice.critical ? "CRITICAL DAMAGE" : "DAMAGE",
      "good",
    );
  }

  /** What a swing leaves on the board: the creature flinches (a slain one falls where its body lies), it barks, the hero cheers over a kill. */
  function swingAftermath(p: PlayState, m: Creature, events: readonly CombatEvent[]): void {
    const hit = events.some((e) => e.kind === "damage");
    const alive = p.creatures.includes(m);
    const now = performance.now();
    if (!REDUCED_MOTION && alive && hit) playClips(m.actor, m.prone ? ["hit", "death"] : ["hit"], now);
    const talk = barksFor(m.token);
    if (alive && talk && hit && Math.random() < 0.6) story({ speaker: creatureName(p, m), text: bark(talk.hurt), tone: "good" });
    if (alive && talk && !hit && Math.random() < 0.6) story({ speaker: creatureName(p, m), text: bark(talk.dodge), tone: "bad" });
    if (!alive && !REDUCED_MOTION) playClips(p.heroActor, ["cheer"], now + 400);
  }

  async function heroAttackFlow(target: Creature): Promise<void> {
    const p = st();
    if (!p.creatures.includes(target)) return refuse("Nothing left to fight.");
    if (!creatureInSight(p, target)) return refuse("You do not see anything to attack.");
    if (!inOrder(p, target)) {
      // Attacking a creature that has not noticed you still starts the fight (or brings it into the one that is on); you swing on your turn (from hiding, if you were hidden).
      await beginFight(true, [target, ...noticers(p)]);
      if (!heroesTurn(st())) return;
      if (!p.creatures.includes(target)) return;
    }
    const at = { ...target.at };
    const r = heroAttackRules(p, target);
    if (r.refused !== null) return refuse(r.refused);
    clearOptions();
    fightWasOn = true;
    busy = true;
    // The attack roll: the engine has rolled it; the player throws the die and sees it land (both d20, with advantage or disadvantage).
    await throwSwingAttack(r.swing, at);
    await throwSwingDamage(r.swing);
    const events = r.apply();
    showAttack(events, target.token, at);
    swingAftermath(p, target, events);
    busy = false;
    await afterHeroAction();
  }
  /** Walk a plan's path, then do what it was for. */
  function runPlan(plan: Plan): void {
    if (plan.kind === "none") return refuse(plan.reason);
    walkQueue.length = 0;
    walkQueue.push(...plan.path);
    const struck = plan.kind === "attack" ? creatureAt(st(), plan.tile) : undefined;
    onArrive =
      plan.kind === "attack"
        ? async () => {
            // The creature it was for (it may have moved or fallen while the hero walked: then it is whoever stands there now, or nothing).
            const now = struck && st().creatures.includes(struck) ? struck : creatureAt(st(), plan.tile);
            if (!now) return refuse("Nothing left to fight.");
            await heroAttackFlow(now);
          }
        : plan.kind === "loot"
          ? async () => {
              openLootAt(plan.tile);
            }
        : plan.kind === "look"
          ? async () => {
              examineAt(plan.tile);
            }
          : plan.kind === "use"
            ? async () => {
                const r = heroInteractRules(st());
                if (r.refused) return refuse(r.refused);
                clearOptions();
                if (!REDUCED_MOTION) playClips(st().heroActor, ["interact"], performance.now());
                stage.invalidate();
                await afterHeroAction();
              }
            : async () => {
                await afterHeroAction();
              };
  }

  /**
   * The creature the Attack button (and F) strikes: the nearest hostile the hero sees, one in reach before one that needs a walk. With the
   * action spent, or nothing in sight, it says why. A click on a creature attacks THAT creature instead (planFor).
   */
  function nearestFoe(p: PlayState): Creature | undefined {
    const seen = hostilesOf(p).filter((c) => creatureInSight(p, c));
    const dist = (c: Creature): number => tileDistance(p.heroAt, c.at);
    const byDistance = [...seen].sort((a, b) => dist(a) - dist(b));
    return byDistance.find((c) => dist(c) <= heroReachTiles(p)) ?? byDistance[0];
  }

  async function attackNearest(): Promise<void> {
    if (busy) return;
    const p = st();
    if (hostilesOf(p).length === 0) return refuse("Nothing left to fight. Press Reset scene to bring it back.");
    const foe = nearestFoe(p);
    if (!foe) return refuse("You do not see anything to attack.");
    runPlan(planFor(foe.at));
  }

  // ---- bodies, piles and item cards ----------------------------------------------

  function closeLoot(): void {
    lootWin?.close();
    lootWin = null;
    lootTarget = null;
  }

  /** What the open window lists now. */
  function lootItemsNow(): LootWindowItem[] {
    const p = st();
    const t = lootTarget;
    if (!t) return [];
    if (t.kind === "body") {
      const b = p.bodies.find((x) => x.id === t.id);
      return b ? bodyLootItems(p, b) : [];
    }
    return pileLootItems(p, t.at);
  }

  function showLoot(target: NonNullable<typeof lootTarget>, title: string): void {
    closeLoot();
    lootTarget = target;
    lootWin = overlay.lootWindow({
      title,
      items: lootItemsNow(),
      onTake: (key) => takeLoot(key),
      onClose: () => {
        lootWin = null;
        lootTarget = null;
        refreshAll();
      },
    });
    refreshAll();
  }

  /** Search what lies on a square next to the hero: an unsearched body first (its first search rolls the engine's loot), then a pile. */
  function openLootAt(tile: XY): void {
    if (busy || overlayOpen()) return;
    const p = st();
    if (heroDown(p)) return refuse(DOWN_NOTE);
    if (p.round && !isPlayersTurn(p.round)) return refuse("Wait for your turn.");
    if (tileDistance(p.heroAt, tile) > 1) return refuse("Too far away. Step next to it.");
    const body = p.bodies.find((b) => same(b.at, tile) && !b.looted);
    if (body) {
      clearOptions();
      ensureBodyLoot(p, body);
      flushLog();
      if (body.looted) {
        refreshAll();
        return refuse(`There is nothing on the ${body.name.toLowerCase()}'s body.`);
      }
      return showLoot({ kind: "body", id: body.id }, `The ${body.name.toLowerCase()}'s body`);
    }
    if (pileAt(p, tile)) return showLoot({ kind: "pile", at: { ...tile } }, "On the ground");
    refuse(p.bodies.some((b) => same(b.at, tile)) ? "You have already searched that body." : "There is nothing to take here.");
  }

  /** A Take button of the open window (an item's key), or Take all. Whatever stays behind, and why, is said in a notice. */
  function takeLoot(key: string | "all"): void {
    const p = st();
    const t = lootTarget;
    if (!t || !lootWin) return;
    if (busy) return refuse("Wait until the table is free.");
    if (heroDown(p)) {
      closeLoot();
      return refuse(DOWN_NOTE);
    }
    const at = t.kind === "body" ? p.bodies.find((b) => b.id === t.id)?.at : t.at;
    if (!at || tileDistance(p.heroAt, at) > 1) {
      closeLoot();
      return refuse("Too far away. Step next to it.");
    }
    const refusals = t.kind === "body" ? takeFromBodyInto(p, t.id, key) : takeFromPileInto(p, t.at, key);
    clearOptions();
    flushLog();
    lootWin.update(lootItemsNow());
    if (refusals.length > 0) refuse(refusals.length === 1 ? refusals[0]! : `${refusals[0]!} (${refusals.length - 1} more stayed behind.)`);
    refreshAll();
  }

  /** A button on an item card, in the pack or on the sheet: the engine's own equip, unequip, drop and destroy, or Use. */
  async function runItemAction(key: string, id: string): Promise<void> {
    if (busy) return refuse("Wait until the table is free.");
    const p = st();
    const ref = itemRefFor(p, key);
    if (!ref) return refuse("You do not have that any more.");
    const name = key.slice(key.indexOf(":") + 1);
    const act = itemActionsFor(p.hero, ref, itemCtx(p)).find((a) => a.id === id);
    if (!act) return;
    if (!act.enabled) return refuse(act.reason ?? "You cannot do that now.");
    clearOptions();
    if (id === "equip") {
      const r = equipItem(p.hero, ref, { hostilesPresent: hostileNear(p) });
      if (r.refused) return refuse(r.refused);
      p.hero = r.sheet;
      p.log.push({ text: r.line, tone: "plain" });
    } else if (id === "unequip" && ref.where === "worn") {
      const r = unequipItem(p.hero, ref.slot, { hostilesPresent: hostileNear(p) });
      if (r.refused) return refuse(r.refused);
      p.hero = r.sheet;
      p.log.push({ text: r.line, tone: "plain" });
    } else if (id === "drop") {
      const why = dropFromPack(p, ref);
      if (why) return refuse(why);
    } else if (id === "destroy") {
      const why = destroyFromPack(p, ref, name);
      if (why) return refuse(why);
    } else if (id === "use") {
      // The board and the dice tray are where a use plays out: the sheet gets out of the way.
      closeSheet();
      const kit = (p.hero.consumables ?? []).some((c) => c.name === name);
      if (ref.where === "consumable" || kit) {
        await (/^potion of healing$/i.test(name) ? drinkPotion() : drinkPotion(name));
        return;
      }
      const say = itemUseSay(p.hero, ref, itemCtx(p));
      if (say) await runDm({ kind: "freehand", text: say });
      return;
    }
    flushLog();
    refreshAll();
  }

  async function useNearby(): Promise<void> {
    if (busy) return;
    const p = st();
    // Something to search beside you, and no door or chest to use: E searches it.
    const loot = lootNear(p);
    if (loot && !doorOrChestUsable(p)) return openLootAt(loot.kind === "body" ? loot.body.at : loot.at);
    const r = heroInteractRules(p);
    if (r.refused) {
      // Nothing to use, but a body you have already been through is right there: say so.
      const searched = p.bodies.find((b) => b.looted && tileDistance(p.heroAt, b.at) <= 1);
      return refuse(searched && /^Nothing to use here/.test(r.refused) ? `You have already searched the ${searched.name.toLowerCase()}'s body.` : r.refused);
    }
    clearOptions();
    if (!REDUCED_MOTION) playClips(p.heroActor, ["interact"], performance.now());
    stage.invalidate();
    await afterHeroAction();
  }

  /** The potion, or (with a name) one of the sheet's other healing consumables. */
  async function drinkPotion(kit?: string): Promise<void> {
    if (busy) return;
    const p = st();
    const r = drinkPotionRules(p, kit);
    if (r.refused) return refuse(r.refused);
    clearOptions();
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
    if (busy || !p.round || !isPlayersTurn(p.round)) return refuse(p.round ? "Wait for your turn." : "There is no fight on. Your turn ends when something notices you.");
    walkQueue.length = 0;
    onArrive = null;
    clearOptions();
    p.round = endTurn(p.round);
    await runHostiles();
  }

  /**
   * Make camp: the game's own longRest on the sheet (full hit points, hit dice and spell slots, once a day; the potions are
   * items and are not refilled), then a "rest" save point. Refused, in the sheet's or the table's words, in a fight, with
   * anything hostile awake or in sight, or once today's sleep is spent (a won fight turns the day over).
   */
  async function restFlow(): Promise<void> {
    if (busy) return;
    const p = st();
    const why = restRefusal(p);
    if (why) return refuse(why);
    const out = longRest(p.hero);
    p.hero = out.sheet;
    clearOptions();
    p.log.push({ text: out.note, tone: "good" });
    p.dmRecent.push({ who: "player", text: "I make camp and sleep until morning." });
    if (p.dmRecent.length > DM_RECENT_KEEP) p.dmRecent.splice(0, p.dmRecent.length - DM_RECENT_KEEP);
    story({ text: "You make camp and sleep. Morning comes.", tone: "plain" }, false);
    addSavePoint(p, "rest", "");
    hud.notice("Rested. Game saved.", "good");
    flushLog();
    refreshAll();
  }

  /** Put a save back: the scene, the sheet and the DM's memory as they were. "last" is the newest of any kind. */
  function loadSave(id: string): void {
    if (overlayOpen()) return refuse("Close the sheet first.");
    if (busy) return refuse("Wait until the table is free.");
    const save = id === "last" ? latestSave(saves) : saves.find((s) => s.id === id);
    if (!save) return refuse("There is no save to load.");
    const restored = fromSnapshot(save.data);
    if (!restored) return refuse("That save could not be read.");
    // A number the sight and tile caches have never seen under this scene's name (they key on it).
    restored.worldRev = Math.max(st().worldRev, restored.worldRev) + 1;
    const words = saveLabel(save);
    carryJournals(st(), restored, `loaded: ${words}`);
    play = restored;
    newScene(false);
    hud.closeDrawer();
    restored.log.push({ text: `Loaded: ${words}`, tone: "plain" });
    said = restored.log.length;
    hud.notice(`Loaded: ${words}`, "plain");
    refreshAll();
    // A save made in the middle of a fight puts the fight back: whoever's turn it was plays on from there.
    if (restored.round) void runHostiles();
  }

  /** Start the scene again from the hero as it began (gear and pack kept). */
  function resetScene(): void {
    const p = st();
    play = newPlay(p.template, p.archetypeId, p.floorId, p.hero, p.start, p.room);
    carryJournals(p, play, "the scene was reset");
    newScene();
  }

  /** The DM's suggested move number `i`: one of the game's own buttons when it says so, otherwise the same as typing its words. */
  function pickOption(i: number): void {
    const p = st();
    const o = p.options[i];
    if (!o || busy || overlayOpen() || heroDown(p)) return;
    // Each built-in refuses with its own reason when it cannot be done right now (and keeps the suggestions then).
    if (o.act === "attack") void attackNearest();
    else if (o.act === "use") void useNearby();
    else if (o.act === "potion") void drinkPotion();
    else if (o.act === "rest") void restFlow();
    else if (o.act === "end") void endTurnFlow();
    else void runDm({ kind: "freehand", text: o.say });
  }

  // ---- the DM ------------------------------------------------------------------
  //
  // dm.ts asks the model (one plain-text sample call, checked and repaired by our
  // own code); this is the table around it. The model's reply is a narration,
  // what the action costs, effects the engine applies, and at most one check with
  // BOTH outcomes already written: the tray rolls, the engine plays the branch the
  // dice pick. So one action is one DM call.

  type SampleState = "pending" | "ready" | "none";
  let sampleState: SampleState = "pending";
  let sampleFn: SampleFn | null = null;
  let dmStatus: string | undefined;
  let alive = true;
  /** The call in progress (a turn that is being asked for or played); null when the table is free. */
  let dmCtl: AbortController | null = null;
  /** True only while waiting on the model: the Cancel button shows. `busy` covers the whole turn. */
  let dmThinking = false;
  const NO_DM = "The DM lives on claude.ai: open the published bench to play with it.";

  /** A test hook: a function on globalThis stands in for the sample capability. */
  function benchHook(): SampleFn | null {
    const hook = (globalThis as { __ltBenchSample?: unknown }).__ltBenchSample;
    return typeof hook === "function" ? (hook as SampleFn) : null;
  }

  /** Once per mount, after the first paint: claude.use resolves null (or never exists) off claude.ai, and the ask field says so. */
  async function loadSample(): Promise<void> {
    const hook = benchHook();
    if (hook) {
      sampleFn = hook;
      sampleState = "ready";
      return;
    }
    try {
      const claude = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
      const found = await claude?.use?.("sample");
      if (!alive) return;
      if (typeof found === "function") {
        sampleFn = found as SampleFn;
        sampleState = "ready";
      } else {
        sampleState = "none";
        dmStatus = NO_DM;
      }
    } catch {
      sampleState = "none";
      dmStatus = NO_DM;
    }
  }

  function cancelDm(): void {
    dmCtl?.abort();
  }

  /** What the HUD's freehand field shows right now. */
  function askStateFor(p: PlayState): NonNullable<Parameters<Hud["render"]>[0]["ask"]> {
    if (dmThinking) return { enabled: false, busy: true };
    if (overlayOpen()) return { enabled: false, status: "Close the sheet to act." };
    if (sampleState === "pending") return { enabled: false, status: "Waking the DM..." };
    if (sampleState === "none") return { enabled: false, status: dmStatus ?? NO_DM };
    const myMove = !p.round || heroesTurn(p);
    return { enabled: !busy && !heroDown(p) && myMove };
  }

  /**
   * The pack view inside the game window: what the hero wears, the bag, what is carried
   * and the consumables (the bench's own potion count included). Every row carries the
   * hover tip from inventory/itemInfo.ts: what it is, its real numbers, and whether the
   * game applies it or the DM rules on it. The DM's own words for things it handed over
   * ride in through itemNotes.
   */
  function packSections(p: PlayState): PackSection[] {
    return packInfo(p.hero, { potions: p.potions, notes: p.itemNotes }).map((section) => ({
      label: section.label,
      items: section.items.map((info) => {
        const count = itemCount(info);
        const key = sheetItemKey(section.label, info.name);
        // A card, not just a tip: click or tap pins it with the buttons the engine says this item has (read fresh each time it opens).
        return { text: count ? `${info.name} ${count}` : info.name, tip: itemTip(info), key, card: () => itemCardFor(st(), key) ?? { tip: itemTip(info), status: "You do not have that any more.", actions: [] } };
      }),
    }));
  }

  /** Look closely at a square the hero has seen. */
  function examineAt(at: XY): void {
    if (busy || overlayOpen()) return;
    const p = st();
    if (sightLevel(p, at) === 0) return refuse(NOT_SEEN);
    void runDm({ kind: "examine", at: { ...at }, what: whatIsAt(p, at) });
  }

  /** One DM turn: ask, then play the reply. The table is busy from the ask to the last effect. */
  async function runDm(ask: DmAsk): Promise<void> {
    if (dmCtl || busy) return;
    const p = st();
    if (heroDown(p)) return refuse(DOWN_NOTE);
    if (p.round && !isPlayersTurn(p.round)) return refuse("Wait for your turn.");
    const sample = benchHook() ?? sampleFn;
    if (!sample) return refuse(NO_DM);
    clearOptions();
    p.log.push({ text: ask.kind === "freehand" ? `You: ${ask.text.slice(0, 300)}` : `You look closely at ${ask.what}.`, tone: "plain" });
    const ctl = new AbortController();
    dmCtl = ctl;
    dmThinking = true;
    busy = true;
    skipping = false;
    walkQueue.length = 0;
    onArrive = null;
    // The box shows "..." until the model's narration starts to stream in.
    const handle = overlay.narrate({ text: "" });
    renderHud();
    const view = dmViewFor(p);
    // Every ask goes in the debug journal, whichever way it ends; what the engine applied and refused is added when the reply has played.
    const exchange: { current: DmExchange | null } = { current: null };
    const outcome = await askDm(sample, view, ask, validationContextFor(view), {
      signal: ctl.signal,
      onNarration: (t) => handle.update(t),
      onExchange: (x) => {
        exchange.current = { ...x };
        const journal = st().dmJournal;
        journal.push(exchange.current);
        if (journal.length > DM_JOURNAL_KEEP) journal.splice(0, journal.length - DM_JOURNAL_KEEP);
      },
    });
    // A new scene or a closed tab while it thought: nothing of this turn may touch the new one.
    if (!alive || dmCtl !== ctl) return;
    dmThinking = false;
    if (!outcome.ok) {
      handle.close();
      dmCtl = null;
      busy = false;
      skipping = false;
      if (outcome.code === "not_granted" || outcome.code === "sampling_disabled") {
        sampleState = "none";
        dmStatus = outcome.message;
      }
      if (outcome.code !== "cancelled") {
        // The Log says it too, so a reply that was thrown away (and why the board did not change) is on the record.
        p.log.push({ text: outcome.code === "invalid_reply" ? "The DM's answer could not be used, so nothing changed." : outcome.message, tone: "plain" });
        refuse(outcome.message);
      }
      refreshAll();
      return;
    }
    let woken: string[] = [];
    try {
      woken = await playReply(p, ctl, ask, outcome.reply, handle, exchange.current);
    } catch (err) {
      console.error("DM turn failed", err);
    }
    if (!alive || dmCtl !== ctl) return;
    dmCtl = null;
    busy = false;
    skipping = false;
    refreshAll();
    // Whoever the DM woke (or struck, or shoved) starts the fight, or joins the one that is on.
    const wake = woken.flatMap((id) => creatureById(p, id) ?? []).filter((c) => needsFight(p, c));
    if (wake.length > 0) await beginFight(false, wake);
    await afterHeroAction();
  }

  /**
   * Play one validated reply into the scene: the cost, the narration, the
   * effects, then the check (rolled in the tray) and the branch the dice pick.
   * Every refused effect is a plain log line and a note the DM reads next turn.
   * Returns the ids of the creatures the DM woke or that were struck (the fight starts, or they join it, after the turn).
   */
  async function playReply(p: PlayState, ctl: AbortController, ask: DmAsk, reply: DmReply, streaming: NarrationHandle, journal: DmExchange | null): Promise<string[]> {
    const stale = (): boolean => !alive || dmCtl !== ctl || st() !== p;
    const refusedNotes: string[] = [];
    const dmWords: string[] = [];
    const wake = new Set<string>();
    let defeated = false;
    /** What the engine did with each effect, in plain words: the debug journal's applied and refused lists for this exchange. */
    const appliedLog: string[] = [];
    const refusedLog: string[] = [];
    const record = (): void => {
      if (!journal) return;
      journal.applied = [...appliedLog];
      journal.refused = [...refusedLog];
    };
    /** What the success branch of an attack check hands its effects: the swing the engine rolled, and whether its damage has landed yet. */
    interface BranchCtx {
      swing: Swing;
      /** The creature the check is against. */
      target: Creature;
      landed: boolean;
    }

    /** A line in the bench log that the dialogue box does not repeat (the narration box already shows it). */
    const logQuiet = (text: string): void => {
      flushLog();
      p.log.push({ text, tone: "dm" });
      said = p.log.length;
    };
    /** The DM's suggested next moves: a check's own branch carries them (the branch the dice picked); without a check, the reply does. */
    let nextOptions: DmOption[] | undefined = reply.check ? undefined : reply.options;

    // The cost, enforced by the engine: in a fight a check always costs the action, and an action that is spent is refused.
    const cost = p.round && reply.check ? "action" : reply.cost;
    if (p.round && cost === "action") {
      if (!heroActionReady(p)) {
        streaming.close();
        refuse("You have already used your action this turn.");
        refusedLog.push("the whole reply: the hero had already used their action this turn");
        record();
        return [];
      }
      p.round = spendActiveAction(p.round) ?? p.round;
    }

    const narrate = (text: string, speaker: string | undefined, current: NarrationHandle | null): NarrationHandle => {
      let h = current;
      if (!h || speaker) h = overlay.narrate({ speaker, text });
      else h.update(text);
      h.done();
      logQuiet(speaker ? `${speaker}: ${text}` : text);
      dmWords.push(speaker ? `${speaker}: ${text}` : text);
      return h;
    };

    /** Heal and harm are dice: the tray rolls them, then the game's own applyHealing and applyDamage land them. */
    const rollVitals = async (e: Extract<DmEffect, { type: "heal" | "harm" }>): Promise<void> => {
      const parsed = parseDiceNotation(e.dice);
      const rolled = rollDice(e.dice);
      const label = `${rolled.rolls.join(" + ")}${parsed.modifier ? ` ${signedNum(parsed.modifier)}` : ""} = ${rolled.total}`;
      const dice = rolled.rolls.map((v) => ({ kind: dieOf(parsed.sides), result: v }));
      if (e.type === "heal") {
        if (p.hero.dead) {
          refusedNotes.push("nothing can heal the dead");
          return;
        }
        await rollStep("Tap to roll healing", dice, label, `+${rolled.total} HP`, "good");
        if (stale()) return;
        const before = p.hero.currentHp;
        const out = applyHealing(p.hero, rolled.total);
        p.hero = out.sheet;
        const gained = p.hero.currentHp - before;
        if (gained > 0) overlay.float(headOf("hero"), `+${gained}`, "heal");
        p.log.push({ text: out.note, tone: "good" });
        return;
      }
      await rollStep("Tap to roll damage", dice, label, `${rolled.total} DAMAGE`, "bad");
      if (stale()) return;
      const before = p.hero.currentHp;
      const out = applyDamage(p.hero, rolled.total);
      p.hero = out.sheet;
      const lost = before - p.hero.currentHp;
      overlay.float(headOf("hero"), lost > 0 ? `-${lost}` : "DEATH SAVE", lost > 0 ? "damage" : "info");
      if (!REDUCED_MOTION) playClips(p.heroActor, [heroDown(p) ? "death" : "hit"], performance.now());
      p.log.push({ text: sentence(`${e.why}. ${out.note}`), tone: "bad" });
      if (heroDown(p)) defeated = true;
    };

    /**
     * The three effects that move or hurt a creature on the board. The engine does the moving and the hurting (the push is
     * pushDestination, which stops at walls, props and tokens; the damage is the attack's own or dice thrown in the tray; prone is the
     * prone rules), so a DM that narrates a kick can no longer leave the goblin standing there unhurt. Returns why it was refused, or null.
     */
    const boardEffect = async (e: Extract<DmEffect, { type: "push" | "prone" | "hurt" }>, ctx?: BranchCtx): Promise<string | null> => {
      const m = creatureById(p, e.id);
      if (!m) return `there is no creature "${e.id}" here to ${e.type === "hurt" ? "hurt" : e.type === "push" ? "push" : "knock down"} (it may already be gone)`;
      const target = { ...m.at };
      if (e.type === "push") {
        const label = creatureLabel(p, m);
        const moved = await pushCreatureBy(p, m, e.squares);
        if (stale()) return null;
        if (moved === 0) return `${label} cannot be pushed that way: a wall, a prop or another creature is right behind it`;
        p.log.push({ text: `${sentenceCase(label)} is pushed ${moved} square${moved === 1 ? "" : "s"} (${moved * FEET_PER_TILE} feet) away from you${moved < e.squares ? ", and no farther: something solid is in the way" : ""}.`, tone: "good" });
        if (needsFight(p, m)) wake.add(m.id);
        return null;
      }
      if (e.type === "prone") {
        const why = proneCreature(p, m);
        if (why) return why;
        if (needsFight(p, m)) wake.add(m.id);
        return null;
      }
      // hurt: the attack's own damage when the check was an attack and no dice are named, else the dice, thrown in the tray.
      fightWasOn = true;
      if (e.dice === undefined) {
        if (!ctx) return "a hurt with no dice takes its damage from an attack check, and there is none here";
        await throwSwingDamage(ctx.swing);
        if (stale()) return null;
        const events = landSwing(p, m, ctx.swing, { spend: false });
        ctx.landed = true;
        showAttack(events, m.token, target);
        swingAftermath(p, m, events);
        return null;
      }
      const parsed = parseDiceNotation(e.dice);
      const rolled = rollDice(e.dice, benchRng);
      const dice = rolled.rolls.map((v) => ({ kind: dieOf(parsed.sides), result: v }));
      await rollStep("Tap to roll damage", dice, `${rolled.rolls.join(" + ")}${parsed.modifier ? ` ${signedNum(parsed.modifier)}` : ""} = ${rolled.total}`, `${rolled.total} DAMAGE`, "good", { total: rolled.total });
      if (stale()) return null;
      let events: CombatEvent[];
      if (ctx && !ctx.landed) {
        // The attack's own line, with the damage the DM's dice decided.
        events = landSwing(p, ctx.target, ctx.swing, { spend: false, damage: rolled.total });
        ctx.landed = true;
      } else {
        events = hurtCreatureBy(p, m, rolled.total, e.damageType);
      }
      showAttack(events, m.token, target);
      swingAftermath(p, m, events);
      if (needsFight(p, m)) wake.add(m.id);
      return null;
    };

    const runEffects = async (effects: readonly DmEffect[], ctx?: BranchCtx): Promise<void> => {
      for (const e of effects) {
        if (stale()) return;
        const words = describeEffect(e);
        if (e.type === "heal" || e.type === "harm") {
          const before = refusedNotes.length;
          await rollVitals(e);
          if (refusedNotes.length > before) refusedLog.push(`${words}: ${refusedNotes[refusedNotes.length - 1]}`);
          else appliedLog.push(words);
          continue;
        }
        if (e.type === "push" || e.type === "prone" || e.type === "hurt") {
          const why = await boardEffect(e, ctx);
          if (stale()) return;
          if (why) {
            refusedNotes.push(why);
            refusedLog.push(`${words}: ${why}`);
            p.log.push({ text: sentence(`Not applied: ${why}`), tone: "plain" });
          } else {
            appliedLog.push(words);
          }
          flushLog();
          continue;
        }
        const r = applyWorldEffect(p, e);
        if (!r.ok) {
          refusedNotes.push(r.why);
          refusedLog.push(`${words}: ${r.why}`);
          if (!r.logged) p.log.push({ text: sentence(`Not applied: ${r.why}`), tone: "plain" });
          continue;
        }
        appliedLog.push(words);
        if (r.line) p.log.push(r.line);
        if (r.wake) wake.add(r.wake.id);
        // Doors, tiles and props change what the hero can see.
        noteSight(p);
        stage.invalidate();
        // An item gained flashes its notice now, not when the whole answer is over.
        flushLog();
      }
    };

    /** A check the engine cannot roll (the creature is gone, out of reach, behind something solid): logged and sent back to the DM, and it counts as failed. */
    const unrolled = (what: string, why: string): { success: false } => {
      refusedNotes.push(why);
      refusedLog.push(`${what}: ${why}`);
      p.log.push({ text: sentence(`Not rolled: ${why}`), tone: "plain" });
      return { success: false };
    };

    /**
     * An attack check: the engine rolls the hero's attack (a kick when the DM says unarmed, else the weapon in hand) against the
     * creature's AC, both d20s in the tray with advantage or disadvantage from hiding, a prone target or the DM. A miss lands here;
     * a hit's damage lands when the success branch's hurt effect runs (the validator always puts one there).
     */
    const rollAttackCheck = async (c: DmCheck): Promise<{ success: boolean; swing?: Swing; target?: Creature }> => {
      const m = c.attack?.against ? creatureById(p, c.attack.against) : undefined;
      const unarmed = c.attack?.weapon === "unarmed";
      if (!m) return unrolled("attack check", "there is no such creature here to attack");
      if (!m.hostile) return unrolled("attack check", `${creatureLabel(p, m)} is not hostile, and the bench has no rules yet for striking someone who is not`);
      const reach = unarmed ? DEFAULT_MELEE_REACH_TILES : heroReachTiles(p);
      const dist = tileDistance(p.heroAt, m.at);
      if (dist > reach) return unrolled("attack check", `${creatureLabel(p, m)} is ${dist * FEET_PER_TILE} feet away and your reach is ${reach * FEET_PER_TILE} feet`);
      if (!sightKit(p).los(p.heroAt, m.at)) return unrolled("attack check", `something solid is between you and ${creatureLabel(p, m)}`);
      const target = { ...m.at };
      const sw = rollSwing(p, m, unarmed ? "kick" : "weapon", c.advantage);
      fightWasOn = true;
      await throwSwingAttack(sw, target);
      if (stale()) return { success: sw.dice.hit };
      if (!sw.dice.hit) {
        const events = landSwing(p, m, sw, { spend: false });
        showAttack(events, m.token, target);
        swingAftermath(p, m, events);
      }
      if (needsFight(p, m)) wake.add(m.id);
      return { success: sw.dice.hit, swing: sw, target: m };
    };

    /**
     * A contest check: the hero's skill against the creature's (a skill name, an ability key, or by default the better of its
     * Athletics and Acrobatics), both rolled by the engine, the hero's d20 in the hero's tray and the creature's in its own. A tie
     * goes to the creature.
     */
    const rollContestCheck = async (c: DmCheck): Promise<boolean> => {
      const m = c.contest?.against ? creatureById(p, c.contest.against) : undefined;
      if (!m || !c.contest) return unrolled("contest check", "there is no such creature here to contest").success;
      const mySkill = canonicalSkill(c.contest.skill);
      if (!mySkill) return unrolled("contest check", `"${c.contest.skill}" is not a skill the engine knows`).success;
      const creature = creatureStats(m);
      const asked = c.contest.versus;
      const vSkill = asked ? canonicalSkill(asked) : undefined;
      const vAbility = asked && !vSkill ? canonicalAbility(asked) : undefined;
      if (asked && !vSkill && !vAbility) return unrolled("contest check", `"${asked}" is neither a skill nor an ability`).success;
      let versus: string;
      let theirMod: number;
      if (vSkill) {
        versus = vSkill;
        theirMod = monsterSkill(creature, vSkill);
      } else if (vAbility) {
        versus = ABILITY_NAME[vAbility];
        theirMod = creatureAbility(m, vAbility);
      } else {
        const ath = monsterSkill(creature, "Athletics");
        const acr = monsterSkill(creature, "Acrobatics");
        versus = acr > ath ? "Acrobatics" : "Athletics";
        theirMod = Math.max(ath, acr);
      }
      const mine = skillCheck({ sheet: p.hero, skill: mySkill, dc: 0, ...(c.advantage ? { advantage: c.advantage } : {}), rng: benchRng });
      const theirRoll = rollDie(20, benchRng);
      const theirTotal = theirRoll + theirMod;
      const success = mine.total > theirTotal;
      const label = creatureLabel(p, m);
      await rollStep(`Tap to roll ${mySkill}`, mine.dice, `${mySkill} ${mine.roll} ${signedNum(mine.modifier)} = ${mine.total}`, "CONTEST", "plain", { modifier: mine.modifier, total: mine.total });
      if (stale()) return success;
      await foeThrow(p, m, [{ kind: "d20", result: theirRoll }], `${theirRoll} ${signedNum(theirMod)} = ${theirTotal} vs ${mine.total}`, success ? "YOU WIN" : theirTotal === mine.total ? "A TIE HOLDS" : "IT WINS", success ? "good" : "bad", { modifier: theirMod, total: theirTotal, target: mine.total });
      if (stale()) return success;
      const adv = mine.dice.length > 1 ? ` (${c.advantage}: ${mine.dice.map((d) => d.result).join(" and ")}, kept ${mine.roll})` : "";
      p.log.push({ text: `Contest: your ${mySkill} ${mine.roll} ${signedNum(mine.modifier)} = ${mine.total}${adv} against ${label}'s ${versus} ${theirRoll} ${signedNum(theirMod)} = ${theirTotal}. ${success ? "You win." : theirTotal === mine.total ? "A tie goes to it: you lose." : "You lose."}`, tone: success ? "good" : "bad" });
      return success;
    };
    /** The check, thrown in the tray: d20 (two for advantage or disadvantage) plus the sheet's real modifier against the DM's DC. */
    const rollCheck = async (c: NonNullable<DmReply["check"]>): Promise<boolean> => {
      // Only a plain check carries a DC: an attack or a contest check is rolled by rollAttackCheck or rollContestCheck, so this fallback is never read.
      const dc = c.dc ?? 10;
      const skill = c.skill ? normaliseSkill(c.skill) : null;
      const name = skill ?? (c.ability ? ABILITY_NAME[c.ability] : "Check");
      const mod = skill ? skillModifierFor(p.hero, skill) : c.ability ? p.hero.modifiers[c.ability] : 0;
      let adv = c.advantage === "advantage";
      const dis = c.advantage === "disadvantage";
      if (skill && checkAdvantageFor(p.hero, skill)) adv = true;
      const two = adv !== dis;
      const a = rollDie(20);
      const b = two ? rollDie(20) : null;
      const used = b === null ? a : adv ? Math.max(a, b) : Math.min(a, b);
      const total = used + mod;
      const success = total >= dc;
      const shown = b === null ? `${used}` : `${used} (${adv ? "best" : "worst"} of ${a}, ${b})`;
      const dice: { kind: DieKind; result: number }[] = [{ kind: "d20", result: a }];
      if (b !== null) dice.push({ kind: "d20", result: b });
      // The tray's text lines are narrow: the sum on the first, the verdict and the DC on the second (the log keeps the long form).
      await rollStep(`Tap to roll ${name}`, dice, `${name} ${used} ${signedNum(mod)} = ${total}`, `${success ? "SUCCESS" : "FAILURE"} vs DC ${dc}`, success ? "good" : "bad", { modifier: mod, total, target: dc });
      if (stale()) return success;
      p.log.push({ text: `${name} check: ${shown} ${signedNum(mod)} = ${total} against DC ${dc}. ${success ? "Success." : "Failure."}`, tone: success ? "good" : "bad" });
      return success;
    };

    narrate(reply.narration, reply.speaker, streaming);
    await runEffects(reply.effects);
    if (!stale() && reply.check) {
      const check = reply.check;
      let success: boolean;
      let attack: BranchCtx | undefined;
      if (check.kind === "attack") {
        const r = await rollAttackCheck(check);
        success = r.success;
        if (r.swing && r.target) attack = { swing: r.swing, target: r.target, landed: false };
      } else if (check.kind === "contest") {
        success = await rollContestCheck(check);
      } else {
        success = await rollCheck(check);
      }
      if (!stale()) {
        const branch = success ? check.success : check.failure;
        narrate(branch.narration, reply.speaker, null);
        nextOptions = branch.options;
        await runEffects(branch.effects, success ? attack : undefined);
        // A hit whose damage the engine did not land (its hurt was refused) still shows as a hit, with no damage.
        if (attack && success && !attack.landed && p.creatures.includes(attack.target) && !stale()) {
          const events = landSwing(p, attack.target, attack.swing, { spend: false, damage: 0 });
          showAttack(events, attack.target.token, { ...attack.target.at });
        }
      }
    }
    record();
    if (stale()) return [];
    for (const fact of reply.remember ?? []) {
      if (!p.dmMemory.includes(fact)) p.dmMemory.push(fact);
    }
    if (p.dmMemory.length > DM_MEMORY_KEEP) p.dmMemory.splice(0, p.dmMemory.length - DM_MEMORY_KEEP);
    p.dmRecent.push({ who: "player", text: ask.kind === "freehand" ? ask.text.slice(0, 300) : `I look closely at ${ask.what}.` }, { who: "dm", text: dmWords.join(" ") });
    for (const why of refusedNotes) p.dmRecent.push({ who: "dm", text: `[The engine refused one of your effects and did NOT apply it: ${why}.]` });
    if (p.dmRecent.length > DM_RECENT_KEEP) p.dmRecent.splice(0, p.dmRecent.length - DM_RECENT_KEEP);
    noteSight(p);
    stage.invalidate();
    // The narration box stays up for its reading time (done() was called); a hero who went down ends the fight.
    if (defeated) {
      p.round = null;
      refreshAll();
      await overlay.banner("DEFEAT", "defeat");
      story({ text: DOWN_NOTE, tone: "bad", sticky: true });
      return [];
    }
    // A hero who is about to be in a fight has no use for suggestions made for the calm before it.
    p.options = wake.size > 0 ? [] : (nextOptions ?? []).slice(0, 4).map((o) => ({ ...o }));
    return [...wake];
  }

  // ---- the context menu ------------------------------------------------------------------------
  //
  // Right-click, or a half-second press on a touch screen, opens it on any square the hero has seen. contextActions.ts decides what
  // is on offer to THIS character there (class and skills put things on it or leave them off) and says why each is offered; Look
  // closer is always the first line. An action the DM rules on is sent as a freehand ask. An action the engine rules on runs below
  // (session/maneuvers.ts rolls it), with every die thrown in the tray (the hero's in the player's tray, the creature's in its own),
  // and CHANGES THE BOARD: the damage lands, the push moves the figure, prone and hidden are states the rules read. A left click
  // keeps its meaning (walk, attack, use).

  /** What the DM can answer right now, or why not: a menu line that needs it says so instead of failing on the click. */
  function dmUnavailable(): string | null {
    if (benchHook() || sampleState === "ready") return null;
    return sampleState === "pending" ? "The DM is still waking. Try again in a moment." : (dmStatus ?? NO_DM);
  }

  /** What is on a square, in the catalog's terms. `pile` is a heap of dropped things (the catalog has no kind for one), `wall` a square nothing can be done to but look at. */
  function contextTargetFor(p: PlayState, at: XY): { target: ContextTarget; pile?: boolean; wall?: boolean } {
    const kit = SCENE_KIT[p.template];
    const distanceTiles = tileDistance(p.heroAt, at);
    const inSight = seesTile(p, at);
    if (same(at, p.heroAt)) return { target: { kind: "self", name: "yourself", distanceTiles: 0, inSight: true } };
    const there = creatureAt(p, at);
    if (there && creatureInSight(p, there)) {
      const k = creatureKind(there);
      return {
        target: {
          kind: "creature",
          id: there.id,
          name: creatureLabel(p, there),
          distanceTiles,
          inSight,
          creature: { hostile: there.hostile, awake: there.awake, awareOfHero: there.awake, type: k.type, size: k.size, down: false, humanoid: k.humanoid, prone: there.prone, passivePerception: creaturePassive(there) },
        },
      };
    }
    const body = p.bodies.find((b) => same(b.at, at));
    if (body) return { target: { kind: "body", id: body.id, name: `the ${body.name.toLowerCase()}'s body`, distanceTiles, inSight, body: { looted: body.looted, harvested: body.harvested, beast: body.beast } } };
    if (pileAt(p, at)) return { target: { kind: "prop", name: "the things lying here", distanceTiles, inSight }, pile: true };
    if (same(at, DOOR_AT)) return { target: { kind: "door", id: "door", name: kit.doorLabel, distanceTiles, inSight, door: { open: p.doorOpen, locked: p.doorLocked, lockDc: p.doorLockDc } } };
    if (same(at, CONTAINER_AT)) return { target: { kind: "chest", id: "container", name: kit.containerLabel, distanceTiles, inSight, searched: p.searched } };
    const prop = p.extraProps.find((e) => same(e, at));
    if (prop) return { target: { kind: "prop", id: prop.id, name: prop.label, distanceTiles, inSight } };
    if (isGrate(p, at)) return { target: { kind: "prop", id: grateId(at), name: "the drain grate", distanceTiles, inSight } };
    return { target: { kind: "floor", name: whatIsAt(p, at), distanceTiles, inSight }, wall: terrainBlocks(p, sceneTiles(p), at) !== null };
  }

  /** The hero's moment, as the catalog wants it. */
  function situationFor(p: PlayState): ContextSituation {
    const inFight = p.round !== null;
    const c = p.round ? activeCombatant(p.round) : undefined;
    return {
      sheet: p.hero,
      inFight,
      heroTurn: !inFight || heroesTurn(p),
      actionReady: heroActionReady(p),
      bonusReady: !inFight || (heroesTurn(p) && c?.economy.bonusAction === true),
      movementFt: inFight ? heroBudgetFt(p) : effectiveSpeedFt(p.hero),
      heroHidden: p.heroHidden,
      heroDown: heroDown(p),
      potions: p.potions,
    };
  }

  const withReason = (a: ContextAction, reason: string): ContextAction => (a.enabled ? { ...a, enabled: false, reason } : a);

  /** Everything the menu on a square offers, in order: the catalog's list for this character, then the bench's own honest adjustments (below). */
  function menuFor(p: PlayState, at: XY): { title: string; target: ContextTarget; actions: ContextAction[] } {
    const { target, pile, wall } = contextTargetFor(p, at);
    let actions = contextActionsFor(target, situationFor(p));
    if (wall) actions = actions.slice(0, 1);
    if (pile) {
      const dist = tileDistance(p.heroAt, at);
      const reason = dist > 1 ? `Too far away: ${dist * FEET_PER_TILE} feet. Move next to it first.` : p.round ? "Not in the middle of a fight. Finish it first." : undefined;
      actions = [actions[0]!, { id: "loot-pile", label: "Pick through it", resolver: "engine", cost: "free", why: "Anyone can look through what lies on the ground", say: "I look through what is lying here.", needsAdjacent: true, enabled: reason === undefined, ...(reason ? { reason } : {}) }];
    }
    const noDm = dmUnavailable();
    const out: ContextAction[] = [];
    for (let a of actions) {
      // The DM answers these, and cannot just now.
      if (a.resolver === "dm" && noDm) a = withReason(a, noDm);
      // The bench has no spell menu: the game's Cast menu is where a spell is chosen.
      if (a.id === "cast") a = withReason(a, "Spells are chosen from the game's Cast menu; the bench has none yet.");
      // The loot window closes when a fight starts, so looting in one would do nothing.
      if (a.id === "loot" && p.round) a = withReason(a, "Not in the middle of a fight. Finish it first.");
      const marked = target.kind === "creature" && target.id ? creatureById(p, target.id) : undefined;
      if (a.id === "pickpocket" && !(marked?.carried ?? []).some((c) => c.pocketable)) a = withReason(a, "It has nothing in its pockets you could lift.");
      // Hiding and sneaking decide whether a creature WAKES. Once it is fighting it knows where you are, and the engine's turn for it does not look at them.
      if (p.round && (a.id === "hide" || a.id === "sneak" || a.id === "sneak-up")) a = withReason(a, "The fight is on: it already knows where you are. Hiding and sneaking are for before it wakes.");
      if (a.id === "sneak" && p.sneaking) a = { ...a, label: "Stop sneaking" };
      out.push(a);
      // A shove is SRD 5.1's two options: push it 5 feet, or knock it prone. The catalog lists one line; the menu offers both.
      if (a.id === "shove") out.push({ ...a, id: "shove-prone", label: "Knock down", say: `I try to knock ${target.name} down.` });
    }
    return { title: sentenceCase(target.name), target, actions: out };
  }

  /** Open the menu on the square under a pointer. */
  function openMenu(clientX: number, clientY: number): void {
    const t = tileAt(clientX, clientY);
    if (!t || busy || overlayOpen()) return;
    const p = st();
    if (sightLevel(p, t) === 0) return refuse(NOT_SEEN);
    const m = menuFor(p, t);
    const entries: ContextMenuEntry[] = m.actions.map((a) => ({ id: a.id, label: a.label, why: a.why, ...(a.good ? { good: true } : {}), enabled: a.enabled, ...(a.reason ? { reason: a.reason } : {}) }));
    const ts = tileScale();
    overlay.contextMenu(toHost((t.x + 0.5) * ts, (t.y + 0.5) * ts), entries, (id) => pickContext(t, id), { title: m.title });
  }

  /** A line of the menu was picked. The list is read fresh (the table may have moved on while the menu was open). */
  function pickContext(tile: XY, id: string): void {
    if (busy || overlayOpen()) return refuse("Wait until the table is free.");
    const found = menuFor(st(), tile).actions.find((a) => a.id === id);
    if (!found) return refuse("That is not on offer any more.");
    if (!found.enabled) return refuse(found.reason ?? "You cannot do that now.");
    clearOptions();
    if (id === "look") return examineAt(tile);
    if (found.resolver === "dm") {
      void runDm({ kind: "freehand", text: found.say });
      return;
    }
    void runEngineAction(found, tile);
  }

  /** What an action costs, taken in a fight (outside one nothing is spent). Movement is paid by walking, so it costs nothing here. */
  function spendCost(p: PlayState, cost: ContextAction["cost"]): void {
    if (!p.round) return;
    if (cost === "action") p.round = spendActiveAction(p.round) ?? p.round;
    else if (cost === "bonus") p.round = spendActiveAction(p.round, "bonusAction") ?? p.round;
  }

  /** The end of an engine action: the table is free, the log and picture catch up, and the goblin may notice what happened. */
  async function afterManeuver(): Promise<void> {
    busy = false;
    flushLog();
    refreshAll();
    await afterHeroAction();
  }

  /**
   * The start of a hostile maneuver (a kick, a shove): the creature is in sight, the fight is on (it starts one, or brings the creature into
   * the one that is, as an attack does), it is the hero's turn with the action ready, and the creature is within reach. Null when ready, else the refusal ("" for none).
   */
  async function startHostileManeuver(target: Creature | undefined, reach: number, what: string): Promise<string | null> {
    if (!target || !st().creatures.includes(target) || !creatureInSight(st(), target)) return `You do not see anything to ${what}.`;
    if (!target.hostile) return `${sentenceCase(creatureLabel(st(), target))} is not hostile, and the bench has no rules yet for ${what === "kick" ? "kicking" : "shoving"} someone who is not.`;
    if (!inOrder(st(), target)) {
      await beginFight(true, [target, ...noticers(st())]);
      if (!heroesTurn(st())) return "";
    }
    const p = st();
    if (!p.creatures.includes(target)) return "";
    if (!heroActionReady(p)) return "You have already used your action this turn.";
    if (tileDistance(p.heroAt, target.at) > reach) return `${sentenceCase(creatureLabel(p, target))} is out of your reach now. Step next to it first.`;
    return null;
  }

  /** Slide a creature along the engine's pushDestination (it stops before a wall, a prop, a token or the edge), square by square. Returns how many squares it moved. */
  async function pushCreatureBy(p: PlayState, m: Creature, squares: number): Promise<number> {
    if (!p.creatures.includes(m)) return 0;
    const path = pushDestination(engineLayout(p), WORLD_MANIFEST[p.template], m.at, p.heroAt, squares);
    for (const sq of path) {
      if (st() !== p || !p.creatures.includes(m)) return 0;
      stepAnim(m.actor, { ...m.at }, sq);
      m.at = { ...sq };
      noteSight(p);
      refreshAll();
      await wait(STEP_MS);
    }
    if (p.creatures.includes(m)) m.actor.dir = castDirToward(p.heroAt.x - m.at.x, p.heroAt.y - m.at.y);
    // A prone creature that was slid across the floor is still lying down.
    if (m.prone) playClips(m.actor, ["death"], performance.now());
    return path.length;
  }

  /** Knock a creature prone, by the engine's prone rules (SRD 5.1) and its condition immunities. Returns why not, or null. */
  function proneCreature(p: PlayState, m: Creature): string | null {
    if (!p.creatures.includes(m)) return "there is no creature there to knock down";
    const c = creatureStats(m);
    const label = creatureLabel(p, m);
    if ("conditionImmunities" in c && c.conditionImmunities?.some((x) => /prone/i.test(x))) return `${label} cannot be knocked prone`;
    if (m.prone) return `${label} is already prone`;
    const fx = proneEffects();
    m.prone = true;
    const parts = [fx.meleeAttackersHaveAdvantage ? "your attacks from next to it have advantage" : "", fx.standUpCostsHalfMovement ? `it will spend ${standUpCostFt(MONSTER_SPEED_FT)} feet of its movement to stand up` : ""].filter(Boolean);
    p.log.push({ text: `${sentenceCase(label)} is knocked prone: ${parts.join(", and ")}.`, tone: "good" });
    overlay.float(headOf(m.token, m.at), "PRONE", "info");
    // The animated figure falls and lies there (the death clip holds its last frame) until it stands up on its turn.
    playClips(m.actor, ["death"], performance.now());
    return null;
  }

  async function runEngineAction(act: ContextAction, tile: XY): Promise<void> {
    // The creature the menu was opened on (kick, shove, sneak up and pickpocket are about it).
    const on = creatureAt(st(), tile);
    switch (act.id) {
      case "kick":
        return kickFlow(on);
      case "shove":
        return shoveFlow(on, "push");
      case "shove-prone":
        return shoveFlow(on, "prone");
      case "hide":
        return hideFlow(act);
      case "sneak":
        return sneakFlow(tile);
      case "sneak-up":
        return sneakUpFlow(on);
      case "pickpocket":
        return pickpocketFlow(act, on);
      case "pick-lock":
      case "force-door":
        return lockFlow(act);
      case "listen":
        return listenFlow(act);
      case "loot":
      case "loot-pile":
        return openLootAt(tile);
      case "harvest":
        return refuse("There is nothing to harvest here: the bench has no beast yet.");
      default:
        return refuse(`${act.label} is not something the bench can do yet.`);
    }
  }

  /** Kick: an unarmed strike (d20 + Strength + proficiency against its AC; a hit deals 1 + Strength bludgeoning), both rolled in the tray, landed on the board. */
  async function kickFlow(m: Creature | undefined): Promise<void> {
    const why = await startHostileManeuver(m, DEFAULT_MELEE_REACH_TILES, "kick");
    if (why !== null) return refuse(why);
    const p = st();
    const target = { ...m!.at };
    clearOptions();
    fightWasOn = true;
    busy = true;
    const sw = rollSwing(p, m!, "kick");
    await throwSwingAttack(sw, target);
    if (!alive || st() !== p) return;
    await throwSwingDamage(sw);
    const events = landSwing(p, m!, sw, { spend: true });
    showAttack(events, m!.token, target);
    swingAftermath(p, m!, events);
    await afterManeuver();
  }

  /**
   * Shove: the hero's Athletics against the better of its Athletics and Acrobatics, a tie to the creature. Win, and it moves one
   * square straight away from the hero (the engine's pushDestination: it stops at a wall, a prop, a token) or falls prone.
   */
  async function shoveFlow(m: Creature | undefined, mode: "push" | "prone"): Promise<void> {
    const why = await startHostileManeuver(m, DEFAULT_MELEE_REACH_TILES, "shove");
    if (why !== null) return refuse(why);
    const p = st();
    const foe = m!;
    const out = shoveContest({ attacker: p.hero, target: { ...monsterShoveProfile(foe.token), name: creatureLabel(p, foe) }, mode, rng: benchRng });
    if (!out.allowed) return refuse(out.reason ?? "You cannot shove that.");
    const target = { ...foe.at };
    clearOptions();
    fightWasOn = true;
    busy = true;
    const mine = out.dice.filter((d) => d.label === "You")[0]!;
    const theirs = out.dice.filter((d) => d.label !== "You")[0]!;
    const myMod = out.attackerTotal - mine.result;
    const theirMod = out.targetTotal - theirs.result;
    await rollStep(`Tap to roll your ${mode === "prone" ? "knock down" : "shove"}`, [{ kind: "d20", result: mine.result }], `Athletics ${mine.result} ${signedNum(myMod)} = ${out.attackerTotal}`, mode === "prone" ? "KNOCK DOWN" : "SHOVE", "plain", { modifier: myMod, total: out.attackerTotal });
    if (!alive || st() !== p) return;
    p.heroActor.dir = castDirToward(target.x - p.heroAt.x, target.y - p.heroAt.y);
    if (!REDUCED_MOTION) playClips(p.heroActor, ["attack"], performance.now());
    await foeThrow(p, foe, [{ kind: "d20", result: theirs.result }], `${theirs.result} ${signedNum(theirMod)} = ${out.targetTotal} vs ${out.attackerTotal}`, out.success ? "YOU WIN" : out.attackerTotal === out.targetTotal ? "A TIE HOLDS" : "IT HOLDS", out.success ? "good" : "bad", { modifier: theirMod, total: out.targetTotal, target: out.attackerTotal });
    if (!alive || st() !== p) return;
    spendCost(p, "action");
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    revealHero(p);
    if (out.success && out.effect === "prone") {
      const refused = proneCreature(p, foe);
      if (refused) p.log.push({ text: sentence(`Nothing happens: ${refused}`), tone: "plain" });
    } else if (out.success) {
      const moved = await pushCreatureBy(p, foe, 1);
      if (!alive || st() !== p) return;
      p.log.push({ text: moved > 0 ? `${sentenceCase(creatureLabel(p, foe))} slides back ${moved * FEET_PER_TILE} feet.` : `${sentenceCase(creatureLabel(p, foe))} is pinned: a wall, a prop or another creature is right behind it, so it does not move.`, tone: moved > 0 ? "good" : "plain" });
    } else {
      overlay.float(headOf(foe.token, target), "HOLDS", "miss");
    }
    await afterManeuver();
  }

  /**
   * Hide: one Stealth check against the passive Perception of each hostile that could see you (nobody can see you through a wall or a shut
   * door, so you are simply hidden). While hidden a hostile does not wake by sight; each step it could notice is another check.
   */
  async function hideFlow(act: ContextAction): Promise<void> {
    const p = st();
    const seers = hostilesOf(p).filter((c) => creatureCouldSee(p, c));
    const dcs = seers.map((c) => creaturePassive(c));
    const watchers = seers.map((c) => ({ id: c.id, passivePerception: creaturePassive(c), name: creatureLabel(p, c) }));
    const out = stealthCheck({ sheet: p.hero, observers: watchers, rng: benchRng });
    const mod = skillModifierFor(p.hero, "Stealth");
    const hidden = out.spottedBy.length === 0;
    clearOptions();
    busy = true;
    await rollStep("Tap to roll Stealth", out.dice, `Stealth ${out.total - mod} ${signedNum(mod)} = ${out.total}${watchers.length ? ` vs ${dcs.join("/")}` : ""}`, hidden ? "HIDDEN" : "SPOTTED", hidden ? "good" : "bad", { modifier: mod, total: out.total, ...(watchers.length ? { target: Math.max(...dcs) } : {}) });
    if (!alive || st() !== p) return;
    spendCost(p, act.cost);
    p.heroHidden = hidden;
    p.log.push({ text: hidden ? `${out.line} You stay hidden until you attack, are noticed, or a fight starts.` : out.line, tone: hidden ? "good" : "bad" });
    if (hidden) story({ text: "You slip out of sight.", tone: "good" }, false);
    await afterManeuver();
  }

  /** Sneak: a mode, not a roll. Every step a hostile could notice is a Stealth check against its passive Perception (stealthStep). On a square, it also walks you there. */
  function sneakFlow(tile: XY): void {
    const p = st();
    if (same(tile, p.heroAt)) {
      p.sneaking = !p.sneaking;
      if (!p.sneaking) p.heroHidden = false;
      p.log.push({ text: p.sneaking ? "You move quietly. Each step a creature could notice is a Stealth check." : "You stop sneaking.", tone: "plain" });
      flushLog();
      refreshAll();
      return;
    }
    const plan = planFor(tile);
    if (plan.kind === "none") return refuse(plan.reason);
    p.sneaking = true;
    p.log.push({ text: "You move quietly. Each step a creature could notice is a Stealth check.", tone: "plain" });
    runPlan(plan);
  }

  /** Sneak up: sneaking mode on, and a walk to the square next to it. Each step it could notice is a Stealth check. */
  function sneakUpFlow(m: Creature | undefined): void {
    const p = st();
    if (!m || !p.creatures.includes(m)) return refuse("There is nothing to sneak up on.");
    const spot = approachTile(heroField(p), m.at, 1, sightKit(p).los);
    const path = spot ? pathTo(heroField(p), spot) : null;
    if (!path) return refuse(p.round ? "You cannot get next to it this turn." : "You cannot get next to it from here.");
    p.sneaking = true;
    p.log.push({ text: "You creep toward it. Each step it could notice is a Stealth check.", tone: "plain" });
    clearOptions();
    walkQueue.length = 0;
    walkQueue.push(...path);
    onArrive = async () => {
      await afterHeroAction();
    };
  }

  /** Pickpocket: Sleight of Hand against its passive Perception. A hit lifts one small thing off it (and it is gone from the body later); a miss wakes it and the fight starts. */
  async function pickpocketFlow(act: ContextAction, m: Creature | undefined): Promise<void> {
    const p = st();
    if (!m || !p.creatures.includes(m)) return refuse("There is nothing to pick.");
    const pick = pocketPick(m.carried, benchRng);
    if (!pick.item) return refuse("It has nothing in its pockets you could lift.");
    const pp = creaturePassive(m);
    const out = sleightOfHand({ sheet: p.hero, targetPassivePerception: pp, rng: benchRng });
    const mod = skillModifierFor(p.hero, "Sleight of Hand");
    clearOptions();
    busy = true;
    await rollStep("Tap to roll Sleight of Hand", out.dice, `Sleight of Hand ${out.total - mod} ${signedNum(mod)} = ${out.total} vs ${pp}`, out.success ? "UNNOTICED" : "NOTICED", out.success ? "good" : "bad", { modifier: mod, total: out.total, target: pp });
    if (!alive || st() !== p) return;
    spendCost(p, act.cost);
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    if (out.success) {
      const why = takeIntoPack(p, pick.item.name, pick.item.note);
      if (why) p.log.push({ text: `You get hold of ${pick.item.name.toLowerCase()} but cannot carry it: ${why}`, tone: "plain" });
      else {
        m.carried = pick.rest;
        story({ text: `You lift ${pick.item.name.toLowerCase()} from ${creatureLabel(p, m)}.`, tone: "good" });
      }
      await afterManeuver();
      return;
    }
    const talk = barksFor(m.token);
    if (talk) story({ speaker: creatureName(p, m), text: bark(talk.thief), tone: "bad" });
    busy = false;
    flushLog();
    refreshAll();
    // The one it was lifted from notices (and starts the fight, or joins it); anyone else notices as they would.
    await beginFight(false, m.hostile ? [m] : []);
  }

  /** Pick the lock (thieves' tools, a rogue's training) or force the door (Athletics), against the lock's DC. A success unlocks it; forcing it also opens it. */
  async function lockFlow(act: ContextAction): Promise<void> {
    const p = st();
    if (!p.doorLocked) return refuse("The door is not locked.");
    const dc = p.doorLockDc;
    const force = act.id === "force-door";
    const out = force ? forceDoor({ sheet: p.hero, dc, rng: benchRng }) : pickLock({ sheet: p.hero, dc, rng: benchRng });
    if ("allowed" in out && !out.allowed) return refuse(out.reason ?? "You cannot do that.");
    const die = out.dice[0]!.result;
    clearOptions();
    busy = true;
    await rollStep(force ? "Tap to roll Athletics" : "Tap to roll the lock", out.dice, `${force ? "Athletics" : "Thieves' tools"} ${die} ${signedNum(out.total - die)} = ${out.total} vs DC ${dc}`, out.success ? (force ? "IT GIVES WAY" : "IT CLICKS OPEN") : "IT HOLDS", out.success ? "good" : "bad", { modifier: out.total - die, total: out.total, target: dc });
    if (!alive || st() !== p) return;
    spendCost(p, act.cost);
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    if (out.success) {
      p.doorLocked = false;
      if (force) p.doorOpen = true;
      noteSight(p);
      stage.invalidate();
      story({ text: force ? "The door gives way." : "The lock clicks open.", tone: "good" }, false);
    }
    await afterManeuver();
  }

  /** Listen at the door: Perception against DC 10. A success says whether something is moving beyond it, and whether it is awake, never where. */
  async function listenFlow(act: ContextAction): Promise<void> {
    const p = st();
    const out = skillCheck({ sheet: p.hero, skill: "Perception", dc: LISTEN_DC, rng: benchRng });
    clearOptions();
    busy = true;
    await rollStep("Tap to roll Perception", out.dice, `Perception ${out.roll} ${signedNum(out.modifier)} = ${out.total} vs DC ${LISTEN_DC}`, out.success ? "YOU HEAR" : "NOTHING CLEAR", out.success ? "good" : "bad", { modifier: out.modifier, total: out.total, target: LISTEN_DC });
    if (!alive || st() !== p) return;
    spendCost(p, act.cost);
    p.log.push({ text: out.line, tone: out.success ? "good" : "bad" });
    // Beyond the door is the other room from the one the hero stands in. It says whether something is moving there and whether it is awake, never where or how many.
    const beyond = hostilesOf(p).filter((c) => c.at.x < DIVIDER_X !== p.heroAt.x < DIVIDER_X);
    let heard: string;
    if (!out.success) heard = "You cannot make anything out through the door.";
    else if (beyond.length > 0) heard = beyond.some((c) => c.awake) ? "Something is moving about beyond the door, wide awake." : "Something is breathing slowly beyond the door, as if asleep.";
    else heard = "Silence. Nothing is moving beyond the door.";
    story({ text: heard, tone: "plain" });
    await afterManeuver();
  }

  // ---- the debug export ----------------------------------------------------------------------------

  /** The whole adventure so far, as the export's bundle: the state, the sheet, the scene, every save, the full log, every DM exchange and every roll. */
  function adventureBundle(): AdventureBundle {
    const p = st();
    return {
      format: ADVENTURE_FORMAT,
      version: ADVENTURE_VERSION,
      exportedAt: new Date().toISOString(),
      build: { app: `Living Table ${APP_VERSION}`, bench: `${APP_VERSION} (the Play tab of the bench)`, userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent },
      settings: { art: { ...art }, textStyle, zoom: scale, rollMyself, diceSkin: tray.skin().id, reducedMotion: REDUCED_MOTION, template: p.template },
      character: p.hero,
      scene: {
        template: p.template,
        floorId: p.floorId,
        layout: sceneLayout(p, false),
        heroAt: p.heroAt,
        room: p.room,
        creatures: p.creatures.map(({ actor: _actor, ...c }) => c),
        doorOpen: p.doorOpen,
        doorLocked: p.doorLocked,
        doorLockDc: p.doorLockDc,
        searched: p.searched,
        extraProps: p.extraProps,
        tileOverrides: p.tileOverrides,
        bodies: p.bodies,
        piles: p.piles,
      },
      state: toSnapshot(p),
      saves,
      log: [...sessionLog, ...p.log].map((l) => ({ text: l.text, tone: l.tone })),
      dm: p.dmJournal,
      rolls: p.rollJournal,
    };
  }

  /** The viewer's downloads capability (the artifact runtime), or null off claude.ai or when this view cannot save. */
  async function downloadsCapability(): Promise<{ save(req: { filename: string; data: Uint8Array }): Promise<{ status?: string }> } | null> {
    try {
      const claude = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
      const found = await claude?.use?.("downloads");
      return found && typeof (found as { save?: unknown }).save === "function" ? (found as { save(req: { filename: string; data: Uint8Array }): Promise<{ status?: string }> }) : null;
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

  function setExportStatus(text: string | undefined, copy: boolean): void {
    exportStatus = text;
    exportCopyShown = copy;
    renderHud();
  }

  const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))} KB`;
  let exporting = false;

  /**
   * Save the whole adventure as one zip (the DM transcript, the log, every roll, the sheet, the saves and the state), with the
   * artifact runtime's downloads capability. If the viewer has none, a plain browser download, and a "Copy adventure JSON" button
   * for when even that is blocked. The status line under the button says in words which of these happened.
   */
  async function exportAdventure(): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      let built: { filename: string; bytes: Uint8Array };
      try {
        built = adventureZip(adventureBundle());
      } catch (err) {
        setExportStatus(`Could not build the export: ${err instanceof Error ? err.message : "unknown error"}. Try Copy adventure JSON.`, true);
        return;
      }
      const { filename, bytes } = built;
      const dl = await downloadsCapability();
      if (dl) {
        try {
          const res = await dl.save({ filename, data: bytes });
          setExportStatus(res.status === "delivered" ? `Sent ${filename} (${kb(bytes.length)}).` : `Saved ${filename} (${kb(bytes.length)}).`, false);
          return;
        } catch (err) {
          const code = typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "";
          if (code === "declined") return setExportStatus("Not saved: you declined. Press Export again when you are ready.", false);
          if (code === "rate_limited") return setExportStatus("Another save prompt is still open. Answer it, then press Export again.", false);
          // Anything else (the capability failed): the plain download below is the next best thing.
        }
      }
      const started = browserDownload(filename, bytes);
      setExportStatus(
        started
          ? `${dl ? "The save did not go through, so " : "Saving files is not available here, so "}${filename} (${kb(bytes.length)}) was offered as a plain browser download. If nothing was saved, press Copy adventure JSON.`
          : "The browser would not start a download. Press Copy adventure JSON.",
        true,
      );
    } finally {
      exporting = false;
    }
  }

  /** The fallback of last resort: adventure.json (the whole adventure in one file) on the clipboard. */
  async function copyAdventureJson(): Promise<void> {
    const json = adventureFiles(adventureBundle()).find((f) => f.name === "adventure.json")?.data ?? "";
    try {
      await navigator.clipboard.writeText(json);
      return setExportStatus(`Copied adventure.json (${kb(json.length)}) to the clipboard.`, true);
    } catch {
      // The async clipboard can be blocked in a frame: the old way, through a hidden text box.
    }
    try {
      const box = document.createElement("textarea");
      box.value = json;
      box.setAttribute("readonly", "");
      box.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      if (ok) return setExportStatus(`Copied adventure.json (${kb(json.length)}) to the clipboard.`, true);
    } catch {
      // fall through
    }
    setExportStatus("The browser blocked the clipboard, so nothing was copied.", true);
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
  // Right-click, or a half-second press on a touch screen, opens the context menu on any square the hero has seen (Look closer is its first line).
  let touchExaminedAt = -Infinity;
  let longPressed = false;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressFrom: { x: number; y: number } | null = null;
  const endPress = (): void => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
    pressFrom = null;
  };
  viewport.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // A long press on a phone can fire this as well as the timer below: one examine, not two.
    if (performance.now() - touchExaminedAt < 900) return;
    openMenu(e.clientX, e.clientY);
  });
  viewport.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    longPressed = false;
    endPress();
    pressFrom = { x: e.clientX, y: e.clientY };
    const at = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      const t = tileAt(at.x, at.y);
      if (!t) return;
      longPressed = true;
      touchExaminedAt = performance.now();
      openMenu(at.x, at.y);
    }, 500);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (pressFrom && Math.hypot(e.clientX - pressFrom.x, e.clientY - pressFrom.y) > 10) endPress();
  });
  viewport.addEventListener("pointerup", endPress);
  viewport.addEventListener("pointercancel", endPress);
  viewport.addEventListener("click", (e) => {
    if (longPressed) {
      // The press already looked closer; the tap that ends it is not a click on the square.
      longPressed = false;
      return;
    }
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
    if (id.startsWith("opt:")) return pickOption(Number(id.slice(4)));
    if (id.startsWith("load:")) return loadSave(id.slice(5));
    if (id === "rest") return restFlow();
    if (id === "reset") return busy ? undefined : resetScene();
    if (id === "attack") return attackNearest();
    if (id === "use") return useNearby();
    if (id === "potion") return drinkPotion();
    if (id === "end") return endTurnFlow();
    if (id === "cancel") return cancelDm();
    if (id === "sheet") return toggleSheet();
    if (id === "export") return exportAdventure();
    if (id === "export-copy") return copyAdventureJson();
  }

  /** The title once every hostile is down: "The goblin is down", "The rats are down" (one kind), or "The creatures are down". */
  function downTitle(p: PlayState): string {
    const names = [...new Set(p.bodies.map((b) => b.name.toLowerCase()))];
    if (p.bodies.length === 0) return "Nothing is left to fight";
    if (p.bodies.length === 1) return `The ${names[0]} is down`;
    return names.length === 1 ? `The ${pluralName(names[0]!)} are down` : "The creatures are down";
  }

  /**
   * One hit point bar for each hostile the hero has seen (a fight that began on a sound alone lists them all, as "???" until seen), then a
   * DOWN bar for each that has fallen. Past three, the readout groups a kind that has several: "Rats 3 left" holds the group's hit points.
   */
  function foeBars(p: PlayState): HudBar[] {
    // A creature the hero has never seen is listed only once it is in the fight (then as "???"), never while it sleeps unseen.
    const live = hostilesOf(p).filter((m) => m.seen || inOrder(p, m));
    const fallen = p.bodies;
    const bars: HudBar[] = [];
    if (live.length + fallen.length <= 3) {
      for (const m of live) bars.push({ id: m.id, label: foeName(p, m), hp: m.hp, max: statblockFor(m.token).maxHp, side: "enemy" });
      for (const b of fallen) bars.push({ id: b.id, label: sentenceCase(b.name), hp: 0, max: statblockFor(b.token).maxHp, side: "enemy", down: true });
      return bars;
    }
    // Grouped: one bar per kind; the unseen are one group of "???".
    const kinds = [...new Set([...live.map((m) => (m.seen ? m.token : "?")), ...fallen.map((b) => b.token)])];
    for (const kind of kinds) {
      const here = live.filter((m) => (m.seen ? m.token : "?") === kind);
      const dead = fallen.filter((b) => b.token === kind);
      const name = kind === "?" ? "???" : statblockFor(kind).name;
      const max = kind === "?" ? here.reduce((n, m) => n + statblockFor(m.token).maxHp, 0) : (here.length + dead.length) * statblockFor(kind).maxHp;
      if (here.length === 0) {
        bars.push({ id: `down:${kind}`, label: dead.length > 1 ? pluralName(name) : name, hp: 0, max, side: "enemy", down: true });
        continue;
      }
      const label = here.length + dead.length === 1 ? name : kind === "?" ? `??? ${here.length} left` : `${pluralName(name)} ${here.length} left`;
      bars.push({ id: `group:${kind}`, label, hp: here.reduce((n, m) => n + m.hp, 0), max, side: "enemy" });
    }
    return bars;
  }

  /** Whose turn it is, what is left of it, everyone's hit points and the buttons: the game window's own readout. */
  function renderHud(): void {
    const p = st();
    const h = p.hero;
    const c = p.round ? activeCombatant(p.round) : undefined;
    const mine = heroesTurn(p);
    const foeTurn = activeCreature(p);
    const foesLeft = hostilesOf(p).length > 0;
    let title: string;
    const lines: string[] = [];
    if (heroDown(p)) title = "You are down";
    else if (!p.round) title = foesLeft ? "Exploring" : downTitle(p);
    else if (mine) title = `Round ${p.round.roundNumber}: your turn`;
    else title = `Round ${p.round.roundNumber}: ${foeTurn?.seen ? `${creatureName(p, foeTurn).toLowerCase()}'s turn` : "something moves"}`;
    if (mine && c) {
      lines.push(`Move: ${c.economy.movementRemaining} ft left`, `Action: ${c.economy.action ? "ready" : "used"}`);
    } else if (!p.round && !heroDown(p)) {
      lines.push(foesLeft ? "Click a square to walk" : "Open the chest, or Reset scene");
    } else if (p.round && !mine) {
      lines.push("Space or a click skips");
    } else if (heroDown(p)) {
      lines.push("Load your last save, or reset");
    }
    const bonus = attackerBonusFor(h);
    lines.push(`AC ${effectiveArmorClass(h)}, hit ${bonus >= 0 ? "+" : ""}${bonus}, ${weaponDamageNotationFor(h)}`);
    // Hiding and sneaking are modes the table honours (the wake rule rolls Stealth), so the dock says so.
    if (p.heroHidden) lines.push("Hidden (steps it could notice are Stealth checks)");
    else if (p.sneaking) lines.push("Sneaking (steps it could notice are Stealth checks)");
    const bars: HudBar[] = [{ id: HERO_ID, label: h.name, hp: h.currentHp, max: h.maxHp, side: "hero", down: heroDown(p) }, ...foeBars(p)];
    // The door when it can be used (shut or open, not locked, nobody standing in it), or the chest when it is still shut.
    const useDoor = doorOrChestUsable(p);
    // A body to search or a pile to look through beside you (and no door or chest to use) is what the Use button, E, does: it says Search.
    const searchable = !useDoor && lootNear(p) !== null;
    const near = useDoor || searchable;
    const myMove = !p.round || mine;
    const actionLeft = heroActionReady(p);
    const moveLeft = (c?.economy.movementRemaining ?? 0) >= FEET_PER_TILE;
    // While the sheet or the creator is open the game waits: only Sheet itself (to close it) stays live.
    const free = !overlayOpen();
    const down = heroDown(p);
    // The built-in buttons show only when they would do something right now (hidden, not greyed out); busy and the open sheet only grey them.
    const foes = hostilesOf(p).filter((m) => creatureInSight(p, m));
    const canAttack = !down && foes.length > 0 && actionLeft && (p.round !== null || foes.some((m) => tileDistance(p.heroAt, m.at) <= heroReachTiles(p)));
    const canPotion = p.potions > 0 && !p.hero.dead && actionLeft && (down || h.currentHp < h.maxHp);
    const actions: HudAction[] = [];
    if (down) {
      // Down: go back to a save, or start the scene again, as the two next moves (keys 1 and 2, full width: the labels are long for the dock's
      // two-column grid). A downed hero who is not dead can still be given a potion.
      actions.push({ id: "load:last", label: "Load last save", key: "1", kind: "suggestion", enabled: free && !busy && saves.length > 0 });
      actions.push({ id: "reset", label: "Reset scene", key: "2", kind: "suggestion", enabled: free && !busy });
      actions.push({ id: "potion", label: `Potion x${p.potions}`, key: "Q", enabled: free && !busy, hidden: !canPotion });
    } else {
      actions.push(
        { id: "attack", label: "Attack", key: "F", enabled: free && !busy, hidden: !canAttack },
        { id: "use", label: searchable ? "Search" : "Use", key: "E", enabled: free && !busy && myMove, hidden: !(near && myMove) },
        { id: "potion", label: `Potion x${p.potions}`, key: "Q", enabled: free && !busy, hidden: !canPotion },
        // The thing to press once the action is spent, or nothing is left to do.
        { id: "end", label: "End turn", key: "T", enabled: free && !busy && mine, hidden: !mine, emphasis: free && !busy && mine && (!actionLeft || (!moveLeft && !near)) },
        { id: "rest", label: "Rest", key: "R", enabled: free && !busy, hidden: restRefusal(p) !== null },
      );
    }
    actions.push({ id: "sheet", label: "Sheet", key: "C", enabled: creationView === null });
    // While the DM thinks, the one live button is Cancel (Escape does the same).
    if (dmThinking) actions.push({ id: "cancel", label: "Cancel", key: "Esc", enabled: true });
    // The DM's suggested next moves show only while the table is free (they are buttons that act when pressed).
    const options: HudOption[] = free && !busy && !down ? p.options.map((o, i) => ({ id: `opt:${i}`, label: o.label, key: String(i + 1) })) : [];
    const saveRows: HudSave[] = saves.map((s) => ({ id: s.id, label: saveLabel(s), detail: saveDetail(s), canLoad: free && !busy }));
    hud.render({ title, lines, bars, actions, ask: askStateFor(p), pack: { sections: packSections(p) }, options, log: p.log.map((l) => ({ text: l.text, tone: l.tone })), saves: saveRows, ...(exportStatus ? { exportStatus } : {}), ...(exportCopyShown ? { exportCopy: true } : {}) });
    // The open sheet follows the hero: hit points, potions and anything the DM hands over.
    if (sheetView) {
      const sig = sheetSigFor(p);
      if (sig !== sheetSig) {
        sheetSig = sig;
        sheetView.update(p.hero, sheetExtras(p));
      }
    }
    const entries = p.round
      ? p.round.order.map((cb) => {
          const m = creatureById(p, cb.id);
          return { id: cb.id, label: cb.id === HERO_ID ? p.hero.name : m ? foeName(p, m) : "???", total: cb.initiative, side: (cb.side === "player" ? "hero" : "enemy") as InitiativeSide };
        })
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
      packEl.appendChild(el_("p", "lt-note lt-tray-empty", "Empty. Defeat a creature or open the chest to win something. Drag a worn magic piece here to take it off."));
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
    roomSelect.value = st().room;
    refreshAll();
  }

  /** A new hero, a reset, a loaded save: nothing pending carries over, and the camera jumps to the hero. A new scene is also a checkpoint (a load is not: it is going back to one). */
  function newScene(checkpoint = true): void {
    // The sheet and the creator belong to the old hero.
    closeViews();
    // A DM call still out belongs to the old scene: let it go.
    const pending = dmCtl;
    dmCtl = null;
    dmThinking = false;
    pending?.abort();
    walkQueue.length = 0;
    onArrive = null;
    busy = false;
    skipping = false;
    fightWasOn = false;
    hover = null;
    said = st().log.length;
    closeLoot();
    overlay.clear();
    tray.clear();
    stage.snapCamera();
    if (checkpoint) addSavePoint(st(), "checkpoint", "start of the scene");
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
    // The sheet and the creator pause the game: their own keys are theirs (they handle Escape themselves), and C closes the sheet again.
    if (overlayOpen()) {
      if (key === "c" && !e.repeat && sheetView) {
        closeSheet();
        e.preventDefault();
      }
      return;
    }
    if (key === "c" && !e.repeat) {
      openSheetView();
      e.preventDefault();
      return;
    }
    if (key === "escape" && dmThinking) {
      cancelDm();
      e.preventDefault();
      return;
    }
    if (key === "i" && !e.repeat) {
      hud.togglePack();
      e.preventDefault();
      return;
    }
    if (key === "l" && !e.repeat) {
      hud.toggleLog();
      e.preventDefault();
      return;
    }
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
    // 1 to 4 pick the DM's suggested moves. With the hero down the two next moves are Load last save (1, or Enter) and Reset scene (2).
    if (heroDown(st()) && (key === "enter" || key === "1" || key === "2")) {
      if (!e.repeat) {
        if (key === "2") resetScene();
        else loadSave("last");
      }
      e.preventDefault();
      return;
    }
    if (key >= "1" && key <= "4" && key.length === 1) {
      if (!e.repeat) pickOption(Number(key) - 1);
      e.preventDefault();
      return;
    }
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
      if (!e.repeat) void attackNearest();
    } else if (key === "e") {
      if (!e.repeat) void useNearby();
    } else if (key === "q") {
      if (!e.repeat) void drinkPotion();
    } else if (key === "t") {
      if (!e.repeat) void endTurnFlow();
    } else if (key === "r") {
      if (!e.repeat) void restFlow();
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

  // ---- the fog of war ----------------------------------------------------------
  //
  // The shroud canvas is cols*size by rows*size SOURCE pixels (render/shroud.ts
  // builds the pixels from one sight level per square) and is stretched by CSS to
  // sit exactly over the board, pixelated, at every zoom and in both Art modes.
  // It redraws only when something changed: the sight levels, a square dissolving
  // in, a figure's headroom, or (while anything is shrouded) once per
  // SHROUD_TICK_MS for the mist's drift. There is no timer of its own: it rides
  // the stage's animation frame, which sleeps while the tab is hidden and is
  // cancelled when the panel unmounts, so nothing keeps running.

  const SHROUD_REVEAL_MS = 250;
  const shroudCtx = shroud.getContext("2d")!;
  const shroudReveal = new Float32Array(CELL_WIDTH * CELL_HEIGHT).fill(1);
  const shroudRevealAt = new Float64Array(CELL_WIDTH * CELL_HEIGHT);
  let shroudPrev: Uint8Array | null = null;
  let shroudScene: PlayState | null = null;
  let shroudKey = "";
  let shroudTickAt = -Infinity;

  function shroudFrame(now: number, creatureTiles: readonly XY[]): void {
    const p = st();
    const size = artSpriteSize(p.template);
    const w = CELL_WIDTH * size;
    const h = CELL_HEIGHT * size;
    let dirty = false;
    if (shroud.width !== w || shroud.height !== h) {
      shroud.width = w;
      shroud.height = h;
      dirty = true;
    }
    const cssW = `${canvas.width}px`;
    const cssH = `${canvas.height}px`;
    if (shroud.style.width !== cssW) shroud.style.width = cssW;
    if (shroud.style.height !== cssH) shroud.style.height = cssH;

    const states = visibilityStates(heroSees(p), p.explored);
    if (shroudScene !== p || !shroudPrev) {
      // A new scene starts clear of any dissolve in progress.
      shroudReveal.fill(1);
      shroudScene = p;
      dirty = true;
    } else {
      for (let i = 0; i < states.length; i++) {
        if (states[i] !== shroudPrev[i]) dirty = true;
        // Ground the hero has never seen dissolves in; ground it only remembered just clears.
        if (states[i] === 2 && shroudPrev[i] === 0 && !REDUCED_MOTION) {
          shroudReveal[i] = 0;
          shroudRevealAt[i] = now;
        } else if (states[i] !== 2) {
          shroudReveal[i] = 1;
        }
      }
    }
    shroudPrev = states;
    let revealing = false;
    for (let i = 0; i < shroudReveal.length; i++) {
      if (shroudReveal[i]! >= 1) continue;
      shroudReveal[i] = Math.min(1, (now - shroudRevealAt[i]!) / SHROUD_REVEAL_MS);
      revealing = true;
    }
    const key = `${p.heroAt.x},${p.heroAt.y}|${creatureTiles.map((t) => `${t.x},${t.y}`).join(";") || "-"}`;
    if (key !== shroudKey) {
      shroudKey = key;
      dirty = true;
    }
    const tick = shroudAnimates(states, REDUCED_MOTION) && now - shroudTickAt >= SHROUD_TICK_MS;
    if (!dirty && !revealing && !tick) return;
    shroudTickAt = now;

    const px = shroudPixels(states, {
      cols: CELL_WIDTH,
      rows: CELL_HEIGHT,
      tilePx: size,
      timeMs: now,
      reducedMotion: REDUCED_MOTION,
      reveal: revealing ? shroudReveal : undefined,
    });
    // A visible figure keeps its head: half a square of the fog above it is cleared (dithered, so it fades into the mist).
    clearHeadroom(px, states, p.heroAt, size);
    for (const t of creatureTiles) clearHeadroom(px, states, t, size);
    shroudCtx.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  }

  // One animation-frame loop paints the scene, and runs the walk first.
  const stage = createPlayStage({ viewport, canvas, state: st, zoom: () => scale, beforeFrame: (now) => pump(now), afterFrame: shroudFrame });

  // The saves this browser kept, read once per page load; a scene that starts here is a checkpoint.
  if (!savesLoaded) {
    saves = readStoredSaves();
    savesLoaded = true;
  }
  if (startedNew) addSavePoint(st(), "checkpoint", "start of the scene");
  renderAll();
  said = st().log.length;
  if (st().round) void runHostiles();
  // The DM's transport, asked for once, after the first paint.
  void loadSample();
  // A read-only handle for the bench's own headless checks: the scene state, never written through.
  (globalThis as { __ltBenchPlay?: () => PlayState }).__ltBenchPlay = st;
  // And a way to make a save at any moment, mid-fight included (the buttons only save while nothing is fighting): for the same checks.
  (globalThis as { __ltBenchSave?: (label: string) => void }).__ltBenchSave = (label) => addSavePoint(st(), "checkpoint", label);
  // And what the hero sees, for the same checks: the sight level of every square (0 never seen, 1 remembered, 2 in sight) and which creatures are in sight.
  // monsterInSight is whether any creature is (the one-goblin room's old question); creaturesInSight names each.
  (globalThis as { __ltBenchSight?: () => { levels: number[]; monsterInSight: boolean; creaturesInSight: string[] } }).__ltBenchSight = () => {
    const p = st();
    const seen = creaturesInSight(p).map((c) => c.id);
    return { levels: Array.from(visibilityStates(heroSees(p), p.explored)), monsterInSight: seen.length > 0, creaturesInSight: seen };
  };

  return () => {
    alive = false;
    dmCtl?.abort();
    diceSkin = tray.skin().id;
    closeViews();
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
#bench-root .lt-shroud{position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated}
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
    "Play is the game in miniature, turn based: click to walk, click a creature to attack it, the door or the chest to use it; " +
      "initiative, movement and the dice are the game's own. Its Sheet button (C) opens your character sheet and the character " +
      "creator; hover anything in the pack or on the sheet to read exactly what it is. Rules is the rulebook and Bestiary the " +
      "creatures (SRD 5.1 numbers, no animation yet). Characters shows the whole animated cast, Pieces every still " +
      "sprite beside its KayKit version, Gear the paper doll and inventory icons, Terrain the autotiling.",
    "The Art row switches between the game's current hand-drawn art and the KayKit art (Kay Lousberg, CC0); the choice " +
      "holds across tabs. Fantasy only: sci-fi is paused and the Healer is out of play.",
  ],
  // This project's additions to the shell (shell.js): no sprite library, and the bench opens on Play.
  library: false,
  assets: [],
  panels: [
    { id: "play", label: "Play", mount: mountPlayPanel },
    { id: "rules", label: "Rules", mount: mountRulesPanel },
    { id: "bestiary", label: "Bestiary", mount: mountBestiaryPanel },
    { id: "characters", label: "Characters", mount: mountCharactersPanel },
    { id: "pieces", label: "Pieces", mount: mountPiecesPanel },
    { id: "gear", label: "Gear", mount: mountGearPanel },
    { id: "terrain", label: "Terrain", mount: mountTerrainPanel },
  ],
  defaultPanel: "play",
};

/** Every sprite id the Pieces tab shows (every in-play fantasy sprite), for the guard test. Pure: no DOM. */
export const PIECES_ASSET_IDS: readonly string[] = SPRITES_BY_TEMPLATE.fantasy.filter(inPlayPiece).map((s) => s.assetId);

/**
 * The Play tab's scene rules with no DOM (creatures, the fight, saves), for test/livingtable-bench-creatures.test.ts. The panel itself
 * is the only other caller; nothing here draws.
 */
export const PLAY_RULES = {
  newPlay,
  toSnapshot,
  fromSnapshot,
  isSnapshot,
  addCreature,
  startFight,
  joinFight,
  slayCreature,
  noticers,
  creatureNotices,
  hostilesOf,
  awakeHostiles,
  creatureName,
  creatureLabel,
  heroAttackRules,
  heroAttackRefusal,
  monsterTurnRules,
  roomLabel,
  sceneLayout,
  engineLayout,
  noteSight,
  ROOM_CHOICES,
  MONSTER_START,
  SECOND_START,
  HERO_START,
  DOOR_AT,
};
