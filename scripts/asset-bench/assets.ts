/**
 * The Living Table asset bench registry.
 *
 * Seven panels: Play (the game in miniature, turn based: the game's own table window,
 * src/games/livingtable/table/mountTable.ts, with the bench's controls around it; its Sheet
 * button opens the character sheet and the character creator inside the window), Rules and
 * Bestiary (the books on the table, books.ts, built from src/games/livingtable/rules/rulebook.ts
 * and bestiary.ts), Characters (the animated cast), Pieces (every in-play sprite beside its
 * KayKit version), Gear (the paper doll and inventory icons) and Terrain (the autotiling).
 * The panels call the game's own render, rules and character functions BY SYMBOL (renderPlanFor,
 * renderCell, renderDoll, renderGearIcon, applyDisplayTiles, the combat and inventory rules) so
 * the bench shows what ships, not a second drawing of it. The bench's own side of the table
 * window (the art choice, the KayKit art, the DM hook, localStorage) is benchHost.ts. The KayKit
 * art rides in as embedded data: the converted stills (kaykit.ts) and the animated cast
 * (the game's cast.ts, read from the page by benchHost.ts).
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
import {
  ACCESSORY_SLOT_WORD,
  ARCHETYPE_IDS,
  DOLL_CANVAS_SIZE,
  DOLL_MAX_SCALE,
  DOLL_MIN_SCALE,
  EQUIPMENT_TIERS,
  GEAR_ROLES,
  TEMPLATE_OF_ARCHETYPE,
  bodySpriteId,
  emptySlotIconSource,
  gearIconSource,
  gearItemExists,
  gearItemName,
  SHEET_ONLY_ROLES,
  type ArchetypeId,
  type Equipment,
  type EquipmentTier,
  type GearRole,
  type SheetOnlyRole,
} from "../../src/games/livingtable/characters/equipmentTypes";
import { PLAYABLE_ARCHETYPE_IDS, type TemplateGenre } from "../../src/games/livingtable/characters/templates";
import { createCharacter, type CharacterSheet } from "../../src/games/livingtable/characters/creation";
import { renderPlanFor } from "../../src/games/livingtable/menu/equipment";
import { renderDoll } from "../../src/games/livingtable/render/doll";
import { renderGearIcon } from "../../src/games/livingtable/render/gearIcon";
import { spriteSizeOf, type RenderManifest } from "../../src/games/livingtable/render/canvasRenderer";
import { type TextStyle } from "../../src/games/livingtable/table/ui/overlay";
import { mountBestiaryPanel, mountRulesPanel } from "./books";
import { decodeLibrary, kaykitLibrary } from "./kaykit";
import {
  CAST_CLIPS,
  CAST_DIRS,
  castClipMs,
  castData,
  castFrameIndex,
  castPrefetch,
  findCastClip,
  spritePose,
  type CastCharacter,
  type CastClipId,
  type CastDir,
  type CastStyle,
} from "../../src/games/livingtable/table/ui/cast";
import { applyDisplayTiles } from "../../src/games/livingtable/render/terrainEdges";
import { CELL_WIDTH, CELL_HEIGHT } from "../../src/games/livingtable/world/coordinates";
import type { TileId } from "../../src/games/livingtable/world/cell";
import { fromSnapshot, isSnapshot, toSnapshot } from "../../src/games/livingtable/table/snapshot";
import { heroAttackRefusal, heroAttackRules, heroStepTo, joinFight, monsterTurnRules, slayCreature, startFight } from "../../src/games/livingtable/table/fightRules";
import { creatureNotices, engineLayout, noteSight, noticers } from "../../src/games/livingtable/table/sight";
import { advApply, advBoard, advUseFor, adventureOf, currentLocation, enterLocation, exitIsOpen, exitLockedWords, exitOn, exitsHere, featureAtSquare, featureIsFound, featureKey, featureSearchable, giveAdventureItem, journalFor, locationBoard, newAdventurePlay, populateLocation, sceneLayout, sceneProps, sceneTiles, syncItems } from "../../src/games/livingtable/table/adventureRun";
import { adventureById, adventureHero, adventureHeroFromCreator, benchAdventures, checkAdventureText, kitWords, registerAiAdventure, startCardsFor } from "../../src/games/livingtable/table/adventureCatalog";
import { applyWorldEffect, dmAdventureView, dmGivableItemIds, dmViewFor } from "../../src/games/livingtable/table/dmScene";
import { equipFromArmoury, equipFromPack, itemName, slotNaming, takeOff, wornTier } from "../../src/games/livingtable/table/gearLoot";
import { ARCHETYPE_LABEL, DOOR_AT, HERO_START, MONSTER_START, PLAYABLE_HEROES, ROOM_CHOICES, SECOND_START, addCreature, awakeHostiles, creatureLabel, creatureName, hostilesOf, newPlay, roomLabel, type RoomChoice } from "../../src/games/livingtable/table/state";
import { SPRITE_ENTRY, buildFigureSet, castEntry, clipRequests, drawSpriteFigure, setFrames, starterLayers, type FigureSet } from "../../src/games/livingtable/table/figures";
import { art, artManifest, artState, benchHost, benchSession, bindBenchDefaults, buildArtControls, castStyleNow, installBenchHooks, kaykitHas, kaykitPixels, notifyArtChange, MANIFEST, SPRITES_BY_TEMPLATE, type CharStyle, type LtSprite } from "./benchHost";
import { mountTable, type TableWindow } from "../../src/games/livingtable/table/mountTable";

// Bring up the table's rules on the bench's art, dice and adventures with no window mounted: the creatures, adventures and wall-profiles
// tests run them with no page, and the Characters tab asks for the cast. A window unbinds what it bound, so the Play panel binds these again when it goes.
bindBenchDefaults();

// ===========================================================================
// Shared bench helpers.
// ===========================================================================

const FLOOR_TILE: Record<TemplateGenre, string> = { fantasy: "floor_grass", scifi: "floor_deckplate" };

const ARCHETYPES_BY_TEMPLATE: Record<TemplateGenre, ArchetypeId[]> = { fantasy: [], scifi: [] };
for (const id of ARCHETYPE_IDS) ARCHETYPES_BY_TEMPLATE[TEMPLATE_OF_ARCHETYPE[id]].push(id);

const REDUCED_MOTION = benchHost.env.reducedMotion;

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

function isSheetOnlyRole(role: GearRole): role is SheetOnlyRole {
  return (SHEET_ONLY_ROLES as readonly GearRole[]).includes(role);
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
// Dragging an item onto a slot (the Worn, Pack and Armoury section under the Play window).
// ===========================================================================

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

// ===========================================================================
// Panel: Play. The table window (src/games/livingtable/table/mountTable.ts, the
// game's own code) with the bench's controls around it: the Art row, the Hero,
// Zoom, Text and Room settings, Reset and Start screen, the dice-skin shop
// preview, and under the window the Worn, Pack and Armoury section. The window
// reaches the art, the DM, storage and files through benchHost.ts. The scene
// survives a visit to another tab (benchSession); the window itself does not.
// ===========================================================================

function mountPlayPanel(el: HTMLElement, _api: unknown): () => void {
  injectPanelStyle();
  el.innerHTML = "";
  const settings = benchHost.settings;
  /** The window, once it is mounted (the controls below are built first, so the window can sit under them). */
  let win: TableWindow | null = null;
  const el_ = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- the Art row ------------------------------------------------------------
  // A change tells the window (its art listens), and the Zoom select follows the zoom a new detail size picks.
  el.appendChild(
    buildArtControls(() => {
      notifyArtChange();
      if (win) scaleSelect.value = String(win.zoom());
    }),
  );

  // ---- controls ------------------------------------------------------------

  const controls = el_("div", "bn-controls");
  el.appendChild(controls);
  const field = (label: string, control: HTMLElement): void => {
    const f = el_("label", "bn-field", `${label} `);
    f.appendChild(control);
    controls.appendChild(f);
  };
  const heroSelect = buildHeroSelect(benchSession().play?.archetypeId ?? PLAYABLE_HEROES[0]!, (id) => win?.pickHero(id));
  field("Hero", heroSelect);
  // The Room: which creatures the sandbox starts with. Changing it starts the scene again (the hero as it began, gear and pack kept).
  const roomSelect = el_("select", "bn-select");
  roomSelect.setAttribute("aria-label", "Room");
  for (const r of ROOM_CHOICES) {
    const o = el_("option", undefined, roomLabel("fantasy", r));
    o.value = r;
    roomSelect.appendChild(o);
  }
  roomSelect.value = benchSession().roomChoice;
  roomSelect.onchange = () => win?.setRoom(roomSelect.value as RoomChoice);
  const scaleSelect = buildScaleSelect([1, 2, 3, 4], 2, (n) => {
    settings.set({ zoom: n });
    win?.applySettings();
  });
  field("Zoom", scaleSelect);
  const textSelect = el_("select", "bn-select");
  for (const [v, label] of [["pixel", "Pixel"], ["storybook", "Storybook"]] as const) {
    const o = el_("option", undefined, label);
    o.value = v;
    textSelect.appendChild(o);
  }
  textSelect.value = settings.get().textStyle;
  textSelect.onchange = () => {
    settings.set({ textStyle: textSelect.value as TextStyle });
    win?.applySettings();
  };
  field("Text", textSelect);
  // After Text, so the selects the other checks pick by position (Hero, Zoom, Text) keep their places.
  field("Room", roomSelect);
  const rollBox = el_("input");
  rollBox.type = "checkbox";
  rollBox.checked = settings.get().rollMyself;
  rollBox.onchange = () => {
    settings.set({ rollMyself: rollBox.checked });
    win?.applySettings();
  };
  const rollField = el_("label", "bn-field");
  rollField.append(rollBox, document.createTextNode(" I roll my own dice"));
  controls.appendChild(rollField);
  const resetBtn = el_("button", "bn-btn lt-reset", "Reset scene");
  resetBtn.type = "button";
  resetBtn.onclick = () => win?.reset();
  controls.appendChild(resetBtn);
  // Back to the start screen. Leaving a game in progress asks first (a second press within three seconds): the saves stay, but the place you stood in is lost.
  const startBtn = el_("button", "bn-btn lt-start", "Start screen");
  startBtn.type = "button";
  let startArmed: ReturnType<typeof setTimeout> | null = null;
  startBtn.onclick = () => {
    if (!win) return;
    if (!win.atStart() && win.state().adventureId && startArmed === null) {
      startBtn.textContent = "Leave this adventure?";
      startArmed = setTimeout(() => {
        startArmed = null;
        startBtn.textContent = "Start screen";
      }, 3000);
      return;
    }
    if (startArmed !== null) clearTimeout(startArmed);
    startArmed = null;
    startBtn.textContent = "Start screen";
    win.showStart();
  };
  controls.appendChild(startBtn);
  // A chosen option must not keep the arrow keys: they walk the hero.
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === "SELECT") (t as HTMLSelectElement).blur();
  });

  el.appendChild(el_("p", "lt-note lt-howto", "Click a square to walk there, a creature to attack that creature, the door or the chest to use it. Walls and shut doors hide what is behind them: you see only what is in line of sight, remember what you have seen, and cannot click what you have not. On a phone, tap once to see the path and again to go. Right-click or long-press any square for what you can do there (Look closer is the first line; a kick, a shove, hiding, a pickpocket and more show up for the characters that can); type what you do in the box. Hover anything in the pack, or any number on the sheet, to read exactly what it is; click an item for what you can do with it (equip, use, drop, destroy), or why you cannot. A fallen creature stays where it fell: click it, or stand next to it and press E, to search it. Things you drop lie in a sack on your square. Sheet (C) opens your character sheet and makes your own hero; the Hero setting here quick-picks a ready-made one. The DM's answers come with two to four suggested next moves (keys 1 to 4, or press them); Attack, Use, Potion and End turn show only when they would do something. Rest (R) makes camp once a day and saves; the Saves tab goes back to any save, and a checkpoint is made when a scene starts. The Log tab (L) keeps every roll, find and line of narration; the board shows only the story, and it fades. Keys: arrows or WASD step, F attacks the nearest creature in reach, E use, Q potion, R rest, 1 to 4 suggested moves, I pack, L log, C sheet, T end turn, Space skips a creature's turn, Esc stops the DM. The Room setting chooses who is in the east room of a test room: one goblin, or a goblin and a skeleton (each its own hit points, dice and turn). The Play tab opens on the start screen: pick one of the owner's adventures (a hand-written story the game follows, place by place, and the DM may not change), or a test room. In an adventure, walk onto a doorway or stairs to move to the next place, press E (or click) next to something to search or look at it, and click a person to talk to them; the Journal tab (J) keeps the objectives."));

  // ---- the window, the dice-skin shop and the gear under it ----------------------

  const windowHost = el_("div");
  el.appendChild(windowHost);
  const shop = el_("details", "lt-dice-shop");
  shop.appendChild(el_("summary", undefined, "Dice skins (shop preview)"));
  const shopHost = el_("div");
  shop.appendChild(shopHost);
  el.appendChild(shop);

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

  const gearOf = (): TableWindow => win!;

  function renderSlots(w: TableWindow): void {
    const p = w.state();
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
        gearOf().gearResult(takeOff(gearOf().state(), role));
      };
      if (tier && tier !== "common") makeDraggable(b, { from: "slot", role }, icon, onDrop);
      slotsEl.appendChild(b);
    }
  }

  function itemChip(w: TableWindow, role: GearRole, tier: EquipmentTier, state: string | null, payload: DragPayload, onTap: () => void): HTMLButtonElement {
    const p = w.state();
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

  function renderPack(w: TableWindow): void {
    const p = w.state();
    packEl.innerHTML = "";
    const bag = p.hero.bag ?? [];
    if (bag.length === 0) {
      packEl.appendChild(el_("p", "lt-note lt-tray-empty", "Empty. Defeat a creature or open the chest to win something. Drag a worn magic piece here to take it off."));
      return;
    }
    bag.forEach((item, index) => {
      packEl.appendChild(itemChip(w, item.slot, item.tier, null, { from: "pack", role: item.slot, index }, () => w.gearResult(equipFromPack(w.state(), index))));
    });
  }

  function renderArmoury(w: TableWindow): void {
    const p = w.state();
    armouryEl.innerHTML = "";
    // An adventure gives what it says and nothing else (the first one: no armor at all): the free armoury is for the test rooms.
    if (p.adventureId) {
      armouryEl.appendChild(el_("p", "lt-note", "The armoury is for the test rooms. In an adventure you have only what the story gives you."));
      return;
    }
    const bag = p.hero.bag ?? [];
    for (const role of GEAR_ROLES) {
      const row = el_("div", "lt-armoury-row");
      row.appendChild(el_("div", "lt-slot-word", slotNaming(p.archetypeId, role).slot));
      const chips = el_("div", "lt-armoury-chips");
      for (const tier of tiersFor(p.archetypeId, role)) {
        const state = wornTier(p, role) === tier ? "worn" : bag.some((b) => b.slot === role && b.tier === tier) ? "in pack" : null;
        chips.appendChild(itemChip(w, role, tier, state, { from: "armoury", role, tier }, () => w.gearResult(equipFromArmoury(w.state(), role, tier))));
      }
      row.appendChild(chips);
      armouryEl.appendChild(row);
    }
  }

  function onDrop(payload: DragPayload, target: HTMLElement | null): void {
    if (!target) return;
    const w = gearOf();
    const p = w.state();
    if (target.dataset.drop === "pack") {
      if (payload.from === "slot") w.gearResult(takeOff(p, payload.role));
      return;
    }
    if (payload.from === "slot") return;
    const role = target.dataset.role as GearRole;
    if (role !== payload.role) {
      const tier = payload.from === "armoury" ? payload.tier : p.hero.bag![payload.index]!.tier;
      return w.refuse(`The ${itemName(p.archetypeId, payload.role, tier)} goes in the ${slotNaming(p.archetypeId, payload.role).slot} slot, not ${slotNaming(p.archetypeId, role).slot}.`);
    }
    w.gearResult(payload.from === "armoury" ? equipFromArmoury(p, payload.role, payload.tier) : equipFromPack(p, payload.index));
  }

  // Each part of the readout is rebuilt only when what it shows has changed.
  const shownSig = new Map<string, string>();
  const refresh = (part: string, sig: string, build: () => void): void => {
    if (shownSig.get(part) === sig) return;
    shownSig.set(part, sig);
    build();
  };

  /** The window redrew: the Hero and Room controls follow the scene (after a new scene), and the gear section follows the hero and the art. */
  const onRefresh = (w: TableWindow, kind: "refresh" | "all"): void => {
    const p = w.state();
    if (kind === "all") {
      heroSelect.value = p.archetypeId;
      roomSelect.value = p.room;
      // A test room's setting: it has no meaning inside an adventure (the start screen is the way to another game).
      roomSelect.disabled = p.adventureId !== null;
      return;
    }
    const h = p.hero;
    const look = `${art.source}|${art.ground}|${art.chars}|${art.size}|${artState.decoded ? 1 : 0}`;
    const worn = GEAR_ROLES.map((r) => wornTier(p, r) ?? "-").join(",");
    const bag = (h.bag ?? []).map((b) => `${b.slot}:${b.tier}`).join(",");
    refresh("slots", `${p.archetypeId}|${worn}|${look}`, () => renderSlots(w));
    refresh("pack", `${p.archetypeId}|${bag}|${look}`, () => renderPack(w));
    refresh("armoury", `${p.archetypeId}|${worn}|${bag}|${look}|${p.adventureId ?? ""}`, () => renderArmoury(w));
  };

  win = mountTable(windowHost, benchHost, { session: benchSession(), diceShop: shopHost, bindCast: false, onRefresh });
  scaleSelect.value = String(win.zoom());
  // The window's board canvas is .ltt-canvas (the game's own stylesheet has an .lt-canvas of its own); the bench's play scripts and its
  // other tabs know the board by the old name, so it wears both here.
  windowHost.querySelector(".ltt-canvas")?.classList.add("lt-canvas");
  installBenchHooks(win);

  return () => {
    if (startArmed !== null) clearTimeout(startArmed);
    startArmed = null;
    win?.dispose();
    win = null;
    // The window unbinds what it bound; the rules (and the Characters tab) still need the bench's own.
    bindBenchDefaults();
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
  if (kaykitLibrary() && !artState.decoded) {
    void decodeLibrary().then((d) => {
      artState.decoded = d;
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
  if (artState.decoded) render();
  else {
    body.innerHTML = '<p class="lt-note">Loading the KayKit art...</p>';
    void decodeLibrary().then((d) => {
      artState.decoded = d;
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
#bench-root .lt-reset{font:inherit;font-size:12.5px;padding:6px 10px;border:1px solid var(--bn-line);border-radius:8px;background:var(--bn-panel);color:var(--bn-text);cursor:pointer}
#bench-root .lt-dice-shop>summary{cursor:pointer;font-size:12.5px;color:var(--bn-muted)}
#bench-root .lt-howto{margin:0 0 6px}
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

/**
 * The Play tab's adventure rules with no DOM (the checked adventures, a new game of one, the places and their exits, creatures from spawns,
 * features, the story's events, items, the Journal, saves), for test/livingtable-bench-adventures.test.ts. The panel is the only other
 * caller; nothing here draws.
 */
export const ADVENTURE_RULES = {
  benchAdventures,
  adventureById,
  checkAdventureText,
  registerAiAdventure,
  startCardsFor,
  kitWords,
  adventureHero,
  adventureHeroFromCreator,
  newAdventurePlay,
  adventureOf,
  currentLocation,
  locationBoard,
  advBoard,
  populateLocation,
  enterLocation,
  advApply,
  syncItems,
  giveAdventureItem,
  exitsHere,
  exitOn,
  exitIsOpen,
  exitLockedWords,
  featureAtSquare,
  featureSearchable,
  featureIsFound,
  featureKey,
  advUseFor,
  journalFor,
  dmViewFor,
  dmAdventureView,
  dmGivableItemIds,
  applyWorldEffect,
  heroStepTo,
  slayCreature,
  toSnapshot,
  fromSnapshot,
  isSnapshot,
  sceneTiles,
  sceneProps,
  engineLayout,
  noteSight,
  addCreature,
  creatureName,
  creatureLabel,
};
