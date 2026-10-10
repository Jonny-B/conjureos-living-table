/**
 * The in-game menu: one panel that opens inside the game space (over the board, under the page bar) and holds everything that used to crowd
 * the side panel. Six tabs, in this order: Character, Inventory, Journal, Log, Saves, Settings.
 *
 *   - Character is the character sheet (sheet.ts, buildSheetContent).
 *   - Inventory is a paper doll: the stats on the left, the hero in the middle with the slots around, the bag below, and under that what
 *     is carried and the consumables. Pointing at a bagged piece (a mouse hover, keyboard focus, or a first tap on a touch screen) shows
 *     the stats as if it were worn, in green for better and red for worse, read off the engine (menu/statPreview.ts). A pressed piece pins
 *     its item card, whose Equip button is the one place gear changes.
 *   - Journal, Log, Saves and Settings are the views the side panel's drawer uses (menuViews.ts).
 *
 * While it is open the game waits; Escape closes it, Left and Right move between tabs, Tab stays inside it, and every target is at least
 * 44 px. It lays out by the room the stage gives it (a container query), so it fits from a 320 px phone to a wide desktop.
 *
 * Import-pure: the pure helpers below (tab order, the slots, the bag cells) run in Node; the document is only touched by openGameMenu.
 */
import type { CharacterSheet } from "../../characters/creation";
import { isUnarmored, itemNameFor, tierInSlot } from "../../characters/equipment";
import {
  ACCESSORY_SLOT_WORD,
  BAG_CAPACITY,
  DOLL_CANVAS_SIZE,
  DOLL_MAX_SCALE,
  DOLL_MIN_SCALE,
  INVENTORY_LAYOUT,
  RARITY_PIPS,
  SLOTS_BY_ARCHETYPE,
  TEMPLATE_OF_ARCHETYPE,
  TIER_WORD,
  emptySlotIconSource,
  gearIconSource,
  type AccessoryRole,
  type BagItem,
  type EquipmentTier,
  type GearIconSource,
  type GearRole,
  type SlotRole,
} from "../../characters/equipmentTypes";
import { describeBagItem, describeWorn, packInfo, type ItemInfo } from "../../inventory/itemInfo";
import { renderPlanFor, slotLabelFor } from "../../menu/equipment";
import { deltaTone, deltaWords, previewEquip, previewTakeOff, signedNumber, statsOf, type StatBlock, type StatDelta, type StatPreview } from "../../menu/statPreview";
import { knownArchetypeId } from "../../rules/attunement";
import { renderDoll } from "../../render/doll";
import { renderGearIcon } from "../../render/gearIcon";
import type { RenderManifest } from "../../render/canvasRenderer";
import type { TextStyle } from "./overlayTypes";
import type { HudJournal, HudLogLine, HudSave, HudSettings } from "./hudTypes";
import { attachItemCard, attachTip, itemCardIsUp, type ItemCardContent, type TipContent } from "./tip";
import { armorClassTip, buildSheetContent, damageTip, itemCount, itemTip, sheetItemKey, speedTip, toHitTip, type SheetContent, type SheetExtras } from "./sheet";
import { createTextKit, journalView, logView, menuIcon, savesView, settingsView, type ViewKit } from "./menuViews";
import { el, FRAMES, frameUrl, deviceRatio } from "./domKit";
import { fitScale, textWidth } from "./pixelFont";
import type { FrameKey } from "./overlayTheme";
import { PX } from "./overlayTheme";
import { injectStyle } from "./overlayStyle";
import { HUD_CSS, HUD_STYLE_ID, MENU_CSS, MENU_STYLE_ID } from "./hudStyle";

// ---- the tabs (pure) ----------------------------------------------------------

export type MenuTab = "character" | "inventory" | "journal" | "log" | "saves" | "settings";

/** The tabs, in the order they are drawn. `live` ones need a game in play; Saves and Settings work anywhere, even over the main menu. */
export const MENU_TABS: readonly { id: MenuTab; label: string; key?: string; live: boolean }[] = [
  { id: "character", label: "Character", key: "C", live: true },
  { id: "inventory", label: "Inventory", key: "I", live: true },
  { id: "journal", label: "Journal", key: "J", live: true },
  { id: "log", label: "Log", key: "L", live: true },
  { id: "saves", label: "Saves", live: false },
  { id: "settings", label: "Settings", live: false },
];

export function isMenuTab(v: unknown): v is MenuTab {
  return MENU_TABS.some((t) => t.id === v);
}

/** The room, in CSS px, a tab's label has beside its 20 px icon: the tab less the icon, the gap, the padding and the border. */
export function tabLabelRoom(tabPx: number): number {
  return Math.max(0, tabPx - 20 - 8 - 4 - 2);
}

/**
 * The ONE pixel scale for the whole tab row: the smallest scale any label needs to fit its tab (so Log and Saves never draw bigger than
 * Character and Inventory). 2 where the longest label fits at 2, else 1.
 */
export function menuTabScale(tabPx: number, dpr = 1, labels: readonly string[] = MENU_TABS.map((t) => t.label)): number {
  const room = tabLabelRoom(tabPx);
  let scale = 2;
  for (const l of labels) scale = Math.min(scale, fitScale(textWidth(l, "bold"), room, 1, 2, dpr));
  return scale;
}

/** Whether a tab can be used: the live ones need a game in play. */
export function tabUsable(tab: MenuTab, live: boolean): boolean {
  const t = MENU_TABS.find((x) => x.id === tab);
  return !!t && (live || !t.live);
}

/** The tab asked for if it can be used, else the first one that can (Character in play, Saves over the main menu). */
export function firstUsableTab(want: MenuTab | undefined, live: boolean): MenuTab {
  if (want && tabUsable(want, live)) return want;
  return (MENU_TABS.find((t) => tabUsable(t.id, live)) ?? MENU_TABS[4]!).id;
}

/** The tab after (1) or before (-1) `from` that can be used, wrapping round the row. */
export function menuTabStep(from: MenuTab, dir: 1 | -1, live: boolean): MenuTab {
  const at = MENU_TABS.findIndex((t) => t.id === from);
  for (let i = 1; i <= MENU_TABS.length; i++) {
    const t = MENU_TABS[(at + dir * i + MENU_TABS.length * 2) % MENU_TABS.length]!;
    if (tabUsable(t.id, live)) return t.id;
  }
  return from;
}

// ---- the paper doll and the bag (pure) ----------------------------------------

/** One slot around the doll. The engine has six gear roles; the seventh is the body armour the hero starts in. Nothing else is invented. */
export interface DollSlot {
  id: string;
  role: GearRole | "armor";
  area: "left" | "right" | "bottom";
  /** What the slot is for on this class, in the game's own words ("Weapon", "Shield or cloak", "Headwear (saving throws)"). */
  label: string;
  /** The piece worn, or null for an empty one. */
  item: string | null;
  tier: EquipmentTier | null;
}

function slotWord(archetypeId: string, role: GearRole): string {
  const known = knownArchetypeId(archetypeId);
  if (!known) return role;
  if (role === "weapon" || role === "outer" || role === "crown") return slotLabelFor(SLOTS_BY_ARCHETYPE[known][role as SlotRole]);
  return ACCESSORY_SLOT_WORD[TEMPLATE_OF_ARCHETYPE[known]][role as AccessoryRole];
}

/** The slots around the doll, left column then right column, then the body armour under the doll. Empty for a class the gear table does not cover. */
export function dollSlots(sheet: CharacterSheet): DollSlot[] {
  if (!knownArchetypeId(sheet.archetypeId)) return [];
  const make = (role: GearRole, area: "left" | "right"): DollSlot => ({ id: role, role, area, label: slotWord(sheet.archetypeId, role), item: itemNameFor(sheet, role), tier: tierInSlot(sheet, role) });
  const slots: DollSlot[] = [
    ...INVENTORY_LAYOUT.leftColumn.map((r) => make(r, "left")),
    ...INVENTORY_LAYOUT.rightColumn.map((r) => make(r, "right")),
  ];
  const body = isUnarmored(sheet) ? null : sheet.armorLabel.charAt(0).toUpperCase() + sheet.armorLabel.slice(1);
  slots.push({ id: "armor", role: "armor", area: "bottom", label: "Base armour", item: body, tier: null });
  return slots;
}

/** The bag as its grid: BAG_CAPACITY cells in reading order, a piece or null for an empty cell. */
export function bagCells(bag: readonly BagItem[] | undefined): (BagItem | null)[] {
  return Array.from({ length: BAG_CAPACITY }, (_, i) => bag?.[i] ?? null);
}

/** Canvas pixels per logical pixel for the doll in a section `width` CSS px wide: whole numbers from DOLL_MIN_SCALE to DOLL_MAX_SCALE, leaving room for a slot column on each side. */
export function dollScale(width: number): number {
  const room = width - 2 * (INVENTORY_LAYOUT.slotBoxCssPx + 4 + INVENTORY_LAYOUT.columnGapCssPx);
  return Math.max(DOLL_MIN_SCALE, Math.min(DOLL_MAX_SCALE, Math.floor(room / DOLL_CANVAS_SIZE)));
}

/** The stat rows, in order: key, label and the tip builder that explains the number. */
export const STAT_ROWS: readonly { key: "ac" | "toHit" | "damage" | "saves" | "speedFt" | "attuned"; label: string }[] = [
  { key: "ac", label: "Armour class" },
  { key: "toHit", label: "To hit" },
  { key: "damage", label: "Damage" },
  { key: "saves", label: "Saving throws" },
  { key: "speedFt", label: "Speed" },
  { key: "attuned", label: "Attuned" },
];

/** What a stat reads as: "16", "+5", "1d8+3", "30 ft", "1 of 3". */
export function statValue(key: (typeof STAT_ROWS)[number]["key"], s: StatBlock): string {
  switch (key) {
    case "ac":
      return String(s.ac);
    case "toHit":
      return signedNumber(s.toHit);
    case "damage":
      return s.damage;
    case "saves":
      return `${signedNumber(s.saves)} from gear`;
    case "speedFt":
      return `${s.speedFt} ft`;
    case "attuned":
      return `${s.attuned} of ${s.attunedMax}`;
  }
}

/** The change in one stat, as the number the column colours (the attunement spots used have no good or bad). */
export function statDelta(key: (typeof STAT_ROWS)[number]["key"], d: StatDelta): number {
  return d[key];
}

/** One plain sentence on what a preview changes: "armour class +1, to hit +2", or that nothing moves. */
export function previewSummary(d: StatDelta): string {
  const parts: string[] = [];
  if (d.ac) parts.push(`armour class ${signedNumber(d.ac)}`);
  if (d.toHit) parts.push(`to hit ${signedNumber(d.toHit)}`);
  if (d.damage) parts.push(`damage ${signedNumber(d.damage)}`);
  if (d.saves) parts.push(`saving throws ${signedNumber(d.saves)}`);
  if (d.speedFt) parts.push(`speed ${signedNumber(d.speedFt)} ft`);
  if (d.attuned) parts.push(`${d.attuned > 0 ? "uses" : "frees"} ${Math.abs(d.attuned)} attunement spot${Math.abs(d.attuned) === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "none of these numbers change";
}

// ---- the public contract ------------------------------------------------------

/** Everything the menu shows. The host builds it from the game and hands a fresh one to `update` whenever the game changes. */
export interface GameMenuData {
  /** A game is in play (not the main menu or a start screen): Character, Inventory, Journal and Log can be used. */
  live: boolean;
  sheet: CharacterSheet | null;
  extras: SheetExtras;
  /** The hero's name and class for the line under the doll ("Tester, level 1 Knight"). */
  heroLine: string;
  /** Something hostile is awake or in sight, so gear cannot change. */
  hostilesPresent: boolean;
  /** The art the doll and the slot icons are drawn from; null before it has loaded (the slots then show names). */
  manifest: RenderManifest | null;
  /** Changes whenever the art does (a library that finished decoding), so the icons are drawn again. */
  artSig: string;
  /** The adventure's journal, or null when no adventure is running. */
  journal: HudJournal | null;
  log: readonly HudLogLine[];
  saves: readonly HudSave[];
  settings: HudSettings;
  exportStatus?: string;
  exportCopy?: boolean;
}

export interface GameMenuOptions {
  style: TextStyle;
  data: GameMenuData;
  /** The tab to open on (the first usable one if it cannot be used). */
  tab?: MenuTab;
  /** The item card for a thing in the pack or on the sheet (sheetItemKey), read when it is drawn; null leaves plain hover help. */
  itemCard?: (key: string) => ItemCardContent | null;
  /** A button of a pinned item card: the item's key and the action's id ("equip", "unequip", "drop", ...). */
  onItemAction?: (key: string, actionId: string) => void;
  /** A button of the Saves and Settings views: the HUD's action ids ("load:<id>", "set:<key>:<value>", "export"). */
  onAction: (id: string) => void;
  /** The menu has closed (Escape, the close button, or `close()`). */
  onClose: () => void;
  /** The tab changed. */
  onTab?: (tab: MenuTab) => void;
}

export interface GameMenuView {
  el: HTMLElement;
  tab(): MenuTab;
  setTab(tab: MenuTab): void;
  update(data: GameMenuData): void;
  setStyle(style: TextStyle): void;
  close(): void;
}

// ---- the DOM ------------------------------------------------------------------

function injectStyles(): void {
  injectStyle();
  if (!document.getElementById(HUD_STYLE_ID)) {
    const s = document.createElement("style");
    s.id = HUD_STYLE_ID;
    s.textContent = HUD_CSS;
    document.head.appendChild(s);
  }
  if (!document.getElementById(MENU_STYLE_ID)) {
    const s = document.createElement("style");
    s.id = MENU_STYLE_ID;
    s.textContent = MENU_CSS;
    document.head.appendChild(s);
  }
}

function ensurePositioned(host: HTMLElement): () => void {
  if (getComputedStyle(host).position !== "static") return () => {};
  const before = host.style.position;
  host.style.position = "relative";
  return () => {
    host.style.position = before;
  };
}

function tipIsUp(): boolean {
  const t = document.getElementById("lt-tip");
  return (!!t && !t.hidden) || itemCardIsUp();
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
}

const X_PATH = "M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z";

/** Focusable things inside the menu, in order, for the Tab trap. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null || n === document.activeElement);
}

/** What keeps keyboard focus on the same control across a redraw. */
const FOCUS_KEYS = ["menuTab", "settingChoice", "save", "export", "exportCopy", "bagIndex", "slot", "invAct"] as const;

export function openGameMenu(host: HTMLElement, opts: GameMenuOptions): GameMenuView {
  injectStyles();
  const restorePosition = ensurePositioned(host);
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  /** The panel redraws its buttons, so the one that opened the menu may be a new element by the time it closes: found again by its action. */
  const returnAction = returnFocus?.dataset.action;
  let style = opts.style;
  let data = opts.data;
  let closed = false;
  let current: MenuTab = firstUsableTab(opts.tab, data.live);
  let lastSig = "";
  let lastWidth = 0;
  let lastTabWidth = 0;
  let offs: Array<() => void> = [];
  let sheetContent: SheetContent | null = null;

  const root = el("div", "lto-root lto-gm");
  root.dataset.gameMenu = "";
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Game menu");
  for (const key of Object.keys(FRAMES) as FrameKey[]) {
    const url = frameUrl(key);
    if (url) root.style.setProperty(`--fr-${key}`, `url("${url}")`);
  }
  const head = el("div", "lto-gm-head");
  const tabs = el("div", "lto-gm-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Menu");
  // One close button: a bar along the bottom where the room is narrow (the thumb reaches it, and the six tabs keep the whole top row), and a
  // cross in the top corner where there is room for it.
  const foot = el("div", "lto-gm-foot");
  const closeBtn = el("button", "lto-gm-close");
  closeBtn.type = "button";
  closeBtn.dataset.menuClose = "";
  closeBtn.setAttribute("aria-label", "Close the menu");
  closeBtn.title = "Close (Esc)";
  const closeSvg = el("span");
  closeSvg.innerHTML = `<svg viewBox="0 0 384 512" aria-hidden="true" focusable="false"><path d="${X_PATH}"/></svg>`;
  closeBtn.append(closeSvg.firstElementChild as Element, el("span", "lto-gm-close-label", "Close"));
  closeBtn.addEventListener("click", () => view.close());
  foot.append(closeBtn);
  head.append(tabs);
  const body = el("div", "lto-gm-body");
  body.id = "lto-gm-panel";
  body.setAttribute("role", "tabpanel");
  body.tabIndex = -1;
  root.append(head, body, foot);

  const isPixel = (): boolean => style === "pixel";
  const bodyWidth = (): number => Math.min(body.clientWidth || root.clientWidth || 320, 900);
  const tk = createTextKit({ style: () => style, width: () => bodyWidth() - 24 });
  const kit: ViewKit = { style: () => style, text: tk.text, px: tk.px, onAction: (id) => opts.onAction(id), width: bodyWidth };
  const boundary = (): HTMLElement => host.closest<HTMLElement>(".lt-game") ?? root;
  const tipStyle = () => (isPixel() ? ("pixel" as const) : ("storybook" as const));

  function applyLook(): void {
    root.classList.toggle("lto-px", isPixel());
    root.classList.toggle("lto-sb", !isPixel());
    root.dataset.style = style;
  }

  function clearBody(): void {
    for (const off of offs) off();
    offs = [];
    sheetContent?.destroy();
    sheetContent = null;
  }

  // ---- the tab row

  /** The width of one tab, from the row as laid out (or, before it is, from the menu's width). */
  function tabWidth(): number {
    const row = tabs.clientWidth || Math.min(900, Math.max(0, (root.clientWidth || 320) - 24));
    return Math.max(44, (row - 5 * 6) / 6);
  }

  function renderTabs(): void {
    const labelScale = isPixel() ? menuTabScale(tabWidth(), deviceRatio()) : 2;
    lastTabWidth = tabs.clientWidth;
    const at = document.activeElement;
    const hadFocus = at instanceof HTMLElement && tabs.contains(at);
    tabs.replaceChildren();
    for (const t of MENU_TABS) {
      const on = t.id === current;
      const btn = el("button", "lto-gm-tab");
      btn.type = "button";
      btn.dataset.menuTab = t.id;
      btn.id = `lto-gm-tab-${t.id}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(on));
      btn.setAttribute("aria-controls", "lto-gm-panel");
      btn.setAttribute("aria-label", t.key ? `${t.label} (${t.key})` : t.label);
      btn.title = t.key ? `${t.label} (${t.key})` : t.label;
      btn.tabIndex = on ? 0 : -1;
      btn.disabled = !tabUsable(t.id, data.live);
      btn.append(menuIcon(t.id));
      const label = el("span", "lto-gm-tab-label");
      if (isPixel()) {
        label.append(kit.px(t.label, { scale: labelScale, weight: "bold", color: on ? PX.gold : PX.ink, outline: PX.dark }), el("span", "lto-sr", t.label));
      } else {
        label.textContent = t.label;
      }
      btn.append(label);
      btn.addEventListener("click", () => view.setTab(t.id));
      tabs.append(btn);
    }
    if (hadFocus) tabs.querySelector<HTMLElement>(`[data-menu-tab="${current}"]`)?.focus({ preventScroll: true });
  }

  // ---- the tab bodies

  function note(words: string): HTMLElement {
    const n = el("p", "lto-gm-note", words);
    n.dataset.menuNote = "";
    return n;
  }

  function renderBody(): void {
    const prevList = body.querySelector<HTMLElement>(".lto-hud-list");
    const sameTab = body.dataset.tab === current;
    const keep = {
      sameTab,
      scroll: sameTab ? (prevList?.scrollTop ?? 0) : 0,
      atBottom: !prevList || prevList.scrollHeight - prevList.scrollTop - prevList.clientHeight < 14,
    };
    const scroll = sameTab ? body.scrollTop : 0;
    const at = document.activeElement;
    let focusKey: [string, string] | null = null;
    if (at instanceof HTMLElement && body.contains(at)) {
      for (const k of FOCUS_KEYS) {
        const v = at.dataset[k];
        if (v !== undefined) {
          focusKey = [k, v];
          break;
        }
      }
    }
    clearBody();
    lastWidth = body.clientWidth;
    body.dataset.tab = current;
    body.setAttribute("aria-labelledby", `lto-gm-tab-${current}`);
    body.replaceChildren(buildTab(keep));
    body.scrollTop = scroll;
    if (focusKey) {
      for (const b of body.querySelectorAll<HTMLElement>("button")) {
        if (b.dataset[focusKey[0]] === focusKey[1]) {
          b.focus({ preventScroll: true });
          break;
        }
      }
    }
  }

  function buildTab(keep: { sameTab: boolean; scroll: number; atBottom: boolean }): HTMLElement {
    const d = data;
    switch (current) {
      case "character": {
        if (!d.sheet) return note("Start a game to see your character.");
        const c = buildSheetContent(d.sheet, { style, extras: d.extras, itemCard: opts.itemCard, onItemAction: opts.onItemAction });
        sheetContent = c;
        return c.el;
      }
      case "inventory": {
        if (!d.sheet) return note("Start a game to see your inventory.");
        return buildInventory(d.sheet);
      }
      case "journal":
        return d.journal ? journalView(kit, d.journal, keep.sameTab ? keep.scroll : 0) : note("The journal belongs to an adventure. Pick one from the main menu.");
      case "log":
        return logView(kit, d.log, keep);
      case "saves":
        return savesView(kit, d.saves, keep.sameTab ? keep.scroll : 0, { status: d.exportStatus, copy: d.exportCopy });
      case "settings":
        return settingsView(kit, d.settings);
    }
  }

  // ---- the inventory tab

  type Target = { id: string; kind: "bag"; index: number } | { id: string; kind: "worn"; role: GearRole };

  function buildInventory(sheet: CharacterSheet): HTMLElement {
    const arch = knownArchetypeId(sheet.archetypeId);
    const manifest = data.manifest;
    const hostiles = data.hostilesPresent;
    const wrap = el("div", "lto-inv");
    wrap.dataset.inventory = "";
    if (!arch) {
      wrap.append(note("This character has no gear to show."));
      return wrap;
    }
    const sec = (cls: string, title: string): HTMLElement => {
      const s = el("section", `lto-inv-sec ${cls}`);
      const h = el("h3", "lto-inv-h");
      h.append(kit.text(title, "seclabel"));
      s.append(h);
      return s;
    };

    let hover: Target | null = null;
    let selected: Target | null = null;
    let lastPointer = "mouse";

    // -- the stat column
    const stats = sec("lto-inv-stats", "Stats");
    stats.dataset.invStats = "";
    const list = el("div", "lto-stats");
    const before0 = statsOf(sheet);
    const rows: Record<string, { value: HTMLElement; delta: HTMLElement; extra: HTMLElement }> = {};
    const tips: Record<string, () => TipContent> = {
      ac: () => armorClassTip(sheet),
      toHit: () => toHitTip(sheet),
      damage: () => damageTip(sheet),
      speedFt: () => speedTip(sheet),
    };
    for (const r of STAT_ROWS) {
      const row = el("div", "lto-stat");
      row.dataset.stat = r.key;
      const l = el("span", "lto-stat-l", r.label);
      const right = el("span", "lto-stat-r");
      const value = el("span", "lto-stat-v", statValue(r.key, before0));
      value.dataset.statValue = "";
      const delta = el("span", "lto-delta");
      delta.dataset.delta = "";
      delta.hidden = true;
      const extra = el("span", "lto-stat-extra");
      extra.hidden = true;
      right.append(value, delta);
      row.append(l, right, extra);
      const tip = tips[r.key];
      if (tip) offs.push(attachTip(row, tip, { boundary: boundary(), style: tipStyle }));
      rows[r.key] = { value, delta, extra };
      list.append(row);
    }
    stats.append(list);
    const noteBox = el("div", "lto-inv-note");
    noteBox.dataset.invNote = "";
    noteBox.setAttribute("aria-live", "polite");
    const pick = el("div", "lto-inv-pick");
    pick.dataset.invPick = "";
    pick.hidden = true;
    stats.append(noteBox, pick);

    // -- the doll and its slots
    const dollSec = sec("lto-inv-doll", "Equipped");
    const grid = el("div", "lto-doll-grid");
    const mid = el("div", "lto-doll-mid");
    const canvas = el("canvas", "lto-doll");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${sheet.name}, as equipped`);
    canvas.dataset.invDoll = "";
    let scale = dollScale(Math.max(bodyWidth() - 24, 200));
    const sizeDoll = (): void => {
      canvas.width = canvas.height = DOLL_CANVAS_SIZE * scale;
      canvas.style.width = canvas.style.height = `${DOLL_CANVAS_SIZE * scale}px`;
    };
    sizeDoll();
    const cap = el("div", "lto-doll-cap", data.heroLine);
    mid.append(canvas, cap);
    grid.append(mid);

    const drawDoll = (shown: CharacterSheet): void => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !manifest) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderDoll(ctx, renderPlanFor(shown), manifest, scale);
    };

    const iconFor = (source: GearIconSource | null, cellPx: number): HTMLCanvasElement | null => {
      if (!source || !manifest) return null;
      const c = el("canvas", "lto-icon");
      c.width = c.height = cellPx;
      c.style.width = c.style.height = `${cellPx}px`;
      c.setAttribute("aria-hidden", "true");
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      return renderGearIcon(ctx, source, manifest, cellPx) ? c : null;
    };

    // -- targets: what a hover, a focus or a tap points at
    const sameTarget = (a: Target | null, b: Target | null): boolean => !!a && !!b && a.id === b.id;
    const previewFor = (t: Target | null): StatPreview | null => {
      if (!t) return null;
      return t.kind === "bag" ? previewEquip(sheet, t.index, { hostilesPresent: hostiles }) : previewTakeOff(sheet, t.role, { hostilesPresent: hostiles });
    };
    const nameOf = (t: Target): string => {
      if (t.kind === "bag") {
        const b = sheet.bag?.[t.index];
        return b ? describeBagItem(sheet, b).name : "";
      }
      return itemNameFor(sheet, t.role) ?? "";
    };
    const keyOf = (t: Target): string => sheetItemKey(t.kind === "bag" ? "Bag" : "Worn", nameOf(t));

    const setRow = (key: string, text: string, d: number | null, extraWords?: string): void => {
      const r = rows[key]!;
      r.value.textContent = text;
      const has = d !== null && d !== 0;
      r.delta.hidden = !has;
      if (has) r.delta.dataset.tone = key === "attuned" ? "note" : deltaTone(d!);
      else delete r.delta.dataset.tone;
      r.delta.replaceChildren(...(has ? [document.createTextNode(deltaWords(d!)), el("span", "lto-sr", " with this piece")] : []));
      r.extra.hidden = !extraWords;
      r.extra.textContent = extraWords ?? "";
    };

    const refresh = (): void => {
      const t = hover ?? selected;
      const pv = previewFor(t);
      stats.dataset.previewing = String(!!pv?.ok);
      if (pv?.ok) {
        for (const r of STAT_ROWS) {
          const extra =
            r.key === "damage" && (pv.after.rider !== pv.before.rider || pv.after.rider)
              ? pv.after.rider
                ? `Plus ${pv.after.rider.slice(1)}${pv.before.rider ? "" : " (new)"}`
                : "Loses its extra damage"
              : undefined;
          setRow(r.key, statValue(r.key, pv.after), statDelta(r.key, pv.delta), extra);
        }
        noteBox.textContent = `${nameOf(t!)}: ${previewSummary(pv.delta)}.`;
        noteBox.dataset.tone = "plain";
        drawDoll(pv.next);
      } else {
        for (const r of STAT_ROWS) setRow(r.key, statValue(r.key, before0), null, r.key === "damage" && before0.rider ? `Plus ${before0.rider.slice(1)}` : undefined);
        if (t && pv && !pv.ok) {
          noteBox.textContent = `${nameOf(t)} cannot be changed now: ${pv.reason}`;
          noteBox.dataset.tone = "bad";
        } else {
          noteBox.textContent = "Point at a piece to see what it would change.";
          noteBox.dataset.tone = "plain";
        }
        drawDoll(sheet);
      }
    };

    const renderPick = (): void => {
      pick.replaceChildren();
      const t = selected;
      pick.hidden = !t;
      if (!t) return;
      const name = nameOf(t);
      const nameEl = el("div", "lto-inv-pick-name", name);
      pick.append(nameEl);
      const pv = previewFor(t);
      const canAct = t.kind === "bag" || (t.kind === "worn" && !!pv);
      if (!canAct) return;
      const btn = el("button", "lto-inv-btn", t.kind === "bag" ? "Equip" : "Take off");
      btn.type = "button";
      btn.dataset.invAct = t.kind === "bag" ? "equip" : "unequip";
      btn.disabled = !pv || !pv.ok;
      btn.setAttribute("aria-label", `${t.kind === "bag" ? "Equip" : "Take off"} ${name}`);
      btn.addEventListener("click", () => opts.onItemAction?.(keyOf(t), t.kind === "bag" ? "equip" : "unequip"));
      pick.append(btn);
    };

    const select = (t: Target): void => {
      selected = t;
      for (const n of wrap.querySelectorAll<HTMLElement>("[data-target]")) n.setAttribute("aria-pressed", String(n.dataset.target === t.id));
      // The pick bar is built only when the choice changes, never by a hover: a button rebuilt between the press and the release loses its click.
      renderPick();
      refresh();
    };

    /** The pointer and focus wiring every pointable piece shares, then its item card (or plain hover help). */
    const wire = (node: HTMLElement, t: Target, tip: () => TipContent): void => {
      node.dataset.target = t.id;
      node.setAttribute("aria-pressed", "false");
      node.addEventListener("pointerdown", (e) => {
        lastPointer = e.pointerType || "mouse";
      });
      node.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        hover = t;
        refresh();
      });
      node.addEventListener("pointerleave", () => {
        if (!sameTarget(hover, t)) return;
        hover = null;
        refresh();
      });
      node.addEventListener("focus", () => {
        hover = t;
        refresh();
      });
      node.addEventListener("blur", () => {
        if (!sameTarget(hover, t)) return;
        hover = null;
        refresh();
      });
      // On a touch screen the first tap selects and previews; the next one on the same piece pins its card. A mouse click does both at once.
      node.addEventListener(
        "click",
        (e) => {
          const touch = lastPointer === "touch" || lastPointer === "pen";
          const was = sameTarget(selected, t);
          select(t);
          if (touch && !was) {
            e.stopImmediatePropagation();
            e.stopPropagation();
          }
        },
        true,
      );
      const key = keyOf(t);
      const card = opts.itemCard?.(key) ?? null;
      if (card && opts.itemCard) {
        const read = opts.itemCard;
        offs.push(attachItemCard(node, () => read(key) ?? card, (id) => opts.onItemAction?.(key, id), { boundary: boundary(), style: tipStyle }));
      } else {
        offs.push(attachTip(node, tip, { boundary: boundary(), style: tipStyle }));
      }
    };

    // -- the slots
    const cellPx = 40;
    for (const s of dollSlots(sheet)) {
      const w = el("div", "lto-slot-wrap");
      w.dataset.area = s.area;
      const isBody = s.role === "armor";
      const btn = el("button", "lto-slot");
      btn.type = "button";
      btn.dataset.slot = s.role;
      btn.dataset.empty = String(s.item === null);
      if (s.tier) btn.dataset.tier = s.tier;
      btn.setAttribute("aria-label", `${s.label}: ${s.item ?? "nothing worn"}${s.tier && s.tier !== "common" ? `, ${TIER_WORD[s.tier]}` : ""}`);
      let icon: HTMLCanvasElement | null = null;
      if (!isBody) {
        const role = s.role as GearRole;
        const source = s.tier ? gearIconSource(arch, role, s.tier) : role === "ring" || role === "amulet" ? emptySlotIconSource(TEMPLATE_OF_ARCHETYPE[arch], role) : null;
        icon = iconFor(source, cellPx);
      }
      if (icon) btn.append(icon);
      else btn.append(el("span", "lto-slot-name", s.item ?? "Empty"));
      if (s.tier && RARITY_PIPS[s.tier] > 0) btn.append(el("span", "lto-pips", "*".repeat(RARITY_PIPS[s.tier])));
      const capEl = el("span", "lto-slot-cap", isBody && s.item ? `${s.label}: ${s.item}` : s.label);
      w.append(btn, capEl);
      if (isBody) {
        // The body armour is read-only here (it is put on and taken off from the pack); it has hover help and no card.
        offs.push(attachTip(btn, () => armorClassTip(sheet), { boundary: boundary(), style: tipStyle }));
      } else {
        const role = s.role as GearRole;
        const info: ItemInfo | null = describeWorn(sheet, role);
        const target: Target = { id: `worn:${role}`, kind: "worn", role };
        if (info) wire(btn, target, () => itemTip(info));
        else offs.push(attachTip(btn, { title: s.label, lines: ["Nothing is worn here."] }, { boundary: boundary(), style: tipStyle }));
      }
      if (s.area === "bottom") grid.append(w);
      else {
        // Left column top to bottom, right column top to bottom, beside the doll.
        const rowIndex = (s.area === "left" ? INVENTORY_LAYOUT.leftColumn : INVENTORY_LAYOUT.rightColumn).indexOf(s.role as GearRole) + 1;
        w.style.gridColumn = s.area === "left" ? "1" : "3";
        w.style.gridRow = String(rowIndex);
        grid.append(w);
      }
    }
    dollSec.append(grid);

    // -- the bag
    const bagSec = sec("lto-inv-bag", "Bag");
    const bagGrid = el("div", "lto-bag-grid");
    bagGrid.dataset.invBag = "";
    const cells = bagCells(sheet.bag);
    cells.forEach((item, i) => {
      if (!item) {
        const empty = el("div", "lto-cell");
        empty.dataset.empty = "true";
        empty.setAttribute("aria-hidden", "true");
        bagGrid.append(empty);
        return;
      }
      const info = describeBagItem(sheet, item);
      const btn = el("button", "lto-cell");
      btn.type = "button";
      btn.dataset.bagIndex = String(i);
      btn.dataset.tier = item.tier;
      btn.dataset.empty = "false";
      btn.setAttribute("aria-label", `${info.name}, ${TIER_WORD[item.tier]}`);
      const icon = iconFor(gearIconSource(arch, item.slot, item.tier), cellPx);
      if (icon) btn.append(icon);
      else btn.append(el("span", "lto-slot-name", info.name));
      btn.append(el("span", "lto-pips", "*".repeat(Math.max(1, RARITY_PIPS[item.tier]))));
      wire(btn, { id: `bag:${i}`, kind: "bag", index: i }, () => itemTip(info));
      bagGrid.append(btn);
    });
    bagSec.append(bagGrid);
    const count = el("div", "lto-bag-count", `${sheet.bag?.length ?? 0} of ${BAG_CAPACITY} places used`);
    bagSec.append(count);

    // -- carried and consumables
    const more = el("section", "lto-inv-sec lto-inv-more");
    const sections = packInfo(sheet, { potions: data.extras.potions, notes: data.extras.notes });
    for (const label of ["Carried", "Consumables"]) {
      const s = sections.find((x) => x.label === label);
      const part = el("div", "lto-inv-more-sec");
      part.dataset.invSection = label;
      const h = el("h3", "lto-inv-h");
      h.append(kit.text(label, "seclabel"));
      part.append(h);
      if (!s || s.items.length === 0) {
        part.append(el("div", "lto-inv-none", "Nothing."));
      } else {
        const chips = el("div", "lto-chips");
        for (const info of s.items) {
          const chip = el("button", "lto-chip-item");
          chip.type = "button";
          chip.dataset.item = info.name;
          chip.append(el("span", undefined, info.name));
          const n = itemCount(info);
          if (n) chip.append(el("span", "lto-chip-k", n));
          const key = sheetItemKey(label, info.name);
          const card = opts.itemCard?.(key) ?? null;
          if (card && opts.itemCard) {
            const read = opts.itemCard;
            offs.push(attachItemCard(chip, () => read(key) ?? card, (id) => opts.onItemAction?.(key, id), { boundary: boundary(), style: tipStyle }));
          } else {
            offs.push(attachTip(chip, itemTip(info), { boundary: boundary(), style: tipStyle }));
          }
          chips.append(chip);
        }
        part.append(chips);
      }
      more.append(part);
    }

    wrap.append(stats, dollSec, bagSec, more);
    refresh();
    // The doll's section is only as wide as its column (the layout is by the room the stage gives), which is known once it is on the page.
    const fitDoll = (): void => {
      const room = dollSec.clientWidth - 2 * 11;
      if (room <= 0) return;
      const next = dollScale(room);
      if (next === scale) return;
      scale = next;
      sizeDoll();
      refresh();
    };
    const fitFrame = requestAnimationFrame(fitDoll);
    offs.push(() => cancelAnimationFrame(fitFrame));
    return wrap;
  }

  // ---- signatures: what each tab is drawn from, so a refresh that changed nothing it shows leaves it be

  function sigFor(tab: MenuTab, d: GameMenuData): string {
    const look = `${style}|${d.live}`;
    switch (tab) {
      case "character":
      case "inventory":
        return JSON.stringify([look, d.sheet, d.extras.potions, d.extras.notes, d.heroLine, d.hostilesPresent, d.artSig, tab === "inventory" ? Math.round(bodyWidth() / 40) : 0]);
      case "journal":
        return JSON.stringify([look, d.journal]);
      case "log":
        return `${look}|${d.log.length}|${d.log[d.log.length - 1]?.text ?? ""}`;
      case "saves":
        return JSON.stringify([look, d.saves, d.exportStatus, d.exportCopy]);
      case "settings":
        return JSON.stringify([look, d.settings]);
    }
  }

  // ---- keys

  /** C, I, J and L again: the tab they name opens, or the menu closes when it is the one showing. True when the key was one of them. */
  const tabKey = (e: KeyboardEvent): boolean => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTextTarget(e.target)) return false;
    const hit = MENU_TABS.find((x) => x.key && x.key.toLowerCase() === e.key.toLowerCase());
    if (!hit || !tabUsable(hit.id, data.live)) return false;
    e.preventDefault();
    if (hit.id === current) view.close();
    else view.setTab(hit.id);
    return true;
  };

  const onDocKey = (e: KeyboardEvent): void => {
    if (closed) return;
    if (e.key === "Escape") {
      // A tip or a pinned card is up: Escape belongs to it first.
      if (tipIsUp()) return;
      e.stopPropagation();
      e.preventDefault();
      view.close();
      return;
    }
    // Focus slipped out of the menu (a click on the page): its keys still reach it, and the game behind never sees them.
    if (!root.contains(e.target as Node) && !(e.target instanceof HTMLElement && e.target.closest("#lt-card, #lt-tip")) && tabKey(e)) e.stopPropagation();
  };
  document.addEventListener("keydown", onDocKey, true);

  const onRootKey = (e: KeyboardEvent): void => {
    // Whatever is typed in the menu is the menu's own: the game behind it never sees it.
    e.stopPropagation();
    if (e.type !== "keydown" || closed) return;
    const t = e.target as HTMLElement | null;
    if (e.key === "Tab") {
      const list = focusables(root);
      if (list.length === 0) return;
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && at <= 0) {
        e.preventDefault();
        list[list.length - 1]!.focus();
      } else if (!e.shiftKey && (at === list.length - 1 || at < 0)) {
        e.preventDefault();
        list[0]!.focus();
      }
      return;
    }
    if (t?.dataset.menuTab && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      const next = e.key === "Home" ? firstUsableTab(undefined, data.live) : e.key === "End" ? menuTabStep("character", -1, data.live) : menuTabStep(current, e.key === "ArrowRight" ? 1 : -1, data.live);
      view.setTab(next);
      tabs.querySelector<HTMLElement>(`[data-menu-tab="${next}"]`)?.focus({ preventScroll: true });
      return;
    }
    // The tab keys again close or switch, as they opened it.
    tabKey(e);
  };
  root.addEventListener("keydown", onRootKey);
  root.addEventListener("keyup", onRootKey);
  root.addEventListener("keypress", onRootKey);

  // A change in the width redraws the pixel text and the doll for it; deferred a frame so the observer never loops.
  let frame = 0;
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (closed || frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (closed) return;
            // The tab labels are drawn for one tab width: a new width draws them again.
            if (tabs.clientWidth > 0 && tabs.clientWidth !== lastTabWidth && isPixel()) renderTabs();
            const w = body.clientWidth;
            if (w > 0 && w !== lastWidth) {
              lastWidth = w;
              lastSig = sigFor(current, data);
              renderBody();
            }
          });
        })
      : null;

  const view: GameMenuView = {
    el: root,
    tab: () => current,
    setTab(tab) {
      if (closed || !tabUsable(tab, data.live) || tab === current) return;
      current = tab;
      lastSig = sigFor(current, data);
      renderTabs();
      renderBody();
      body.scrollTop = 0;
      opts.onTab?.(tab);
    },
    update(next) {
      if (closed) return;
      const liveChanged = next.live !== data.live;
      data = next;
      if (!tabUsable(current, data.live)) {
        current = firstUsableTab(current, data.live);
        lastSig = sigFor(current, data);
        renderTabs();
        renderBody();
        opts.onTab?.(current);
        return;
      }
      if (liveChanged) renderTabs();
      const sig = sigFor(current, data);
      if (sig === lastSig) return;
      lastSig = sig;
      renderBody();
    },
    setStyle(next) {
      if (closed || next === style) return;
      style = next;
      applyLook();
      renderTabs();
      lastSig = sigFor(current, data);
      renderBody();
    },
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onDocKey, true);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearBody();
      root.remove();
      restorePosition();
      const back = returnFocus?.isConnected ? returnFocus : returnAction ? document.querySelector<HTMLElement>(`[data-lto-hud] [data-action="${returnAction}"]`) : null;
      back?.focus({ preventScroll: true });
      opts.onClose();
    },
  };

  applyLook();
  renderTabs();
  host.appendChild(root);
  lastSig = sigFor(current, data);
  renderBody();
  ro?.observe(body);
  tabs.querySelector<HTMLElement>(`[data-menu-tab="${current}"]`)?.focus({ preventScroll: true });
  return view;
}
