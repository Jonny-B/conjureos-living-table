/**
 * createHud: the dock beside the board (status, hit points, action buttons, and the drawer tabs the asset bench uses).
 */
import { textWidth } from "./pixelFont";
import type { TextStyle } from "./overlayTypes";
import type { Hud, HudState, DrawerTab, PackSection } from "./hudTypes";
import { injectStyle } from "./overlayStyle";
import { HUD_STYLE_ID, HUD_CSS } from "./hudStyle";
import { el, FRAMES, frameUrl } from "./domKit";
import type { FrameKey } from "./overlayTheme";
import { condensedHud, usableDrawerTab, journalObjectives, journalRecent, toggleDrawerTab, newPackItems } from "./hudHelpers";
import type { HudCtx } from "./hudCtx";
import { installHudPanel } from "./hudPanel";
import { installDrawerViews } from "./drawerViews";
import { installHudNotices } from "./hudNotices";
import { createTextKit, type ViewKit } from "./menuViews";

export function createHud(
  host: HTMLElement,
  initialStyle: TextStyle,
  /** Every HUD button: the game's actions and options by id, "load:<save id>", "export" and "export-copy". */
  onAction: (id: string) => void,
  opts: {
    slot?: HTMLElement;
    /** A button of a pinned item card in the Pack tab: the item's key (PackItem.key) and the action's id. */
    onItemAction?: (itemKey: string, actionId: string) => void;
  } = {},
): Hud {
  const hc = {} as HudCtx;
  hc.onAction = onAction;
  hc.opts = opts;
  injectStyle();
  if (typeof document !== "undefined" && !document.getElementById(HUD_STYLE_ID)) {
    const s = document.createElement("style");
    s.id = HUD_STYLE_ID;
    s.textContent = HUD_CSS;
    document.head.appendChild(s);
  }
  let style: TextStyle = initialStyle;
  hc.destroyed = false;
  hc.last = null;
  let lastKey = "";
  /** The drawer tab asked for: it shows while the state has that tab's part. */
  let drawer: DrawerTab | null = null;
  /** The pack as the last render saw it, to tell what is new; null before the first look. */
  let prevPack: readonly PackSection[] | null = null;
  /** New items to light up in the next pack draw, and ones that arrived while the pack was shut (they light up when it opens). */
  hc.freshNow = new Set<string>();
  hc.pendingNew = new Set<string>();
  /** The journal as the last render saw it, to tell when it changed while shut (the tab then wears a dot until it is opened). */
  let prevJournal: string | null = null;
  hc.journalNew = false;
  const root = el("div", "lto-root lto-hud");
  root.dataset.ltoHud = "";
  for (const key of Object.keys(FRAMES) as FrameKey[]) {
    const url = frameUrl(key);
    if (url) root.style.setProperty(`--fr-${key}`, `url("${url}")`);
  }
  const panel = el("div", "lto-hud-panel");
  panel.setAttribute("role", "status");
  // The DM's suggested next moves, above the game's own buttons. Not there at all when there are none.
  const next = el("div", "lto-hud-next");
  next.dataset.hudOptions = "";
  next.hidden = true;
  next.setAttribute("role", "group");
  next.setAttribute("aria-label", "Suggested next moves");
  const nextLabel = el("div", "lto-hud-next-label");
  nextLabel.setAttribute("aria-hidden", "true");
  const nextList = el("div", "lto-hud-next-list");
  next.append(nextLabel, nextList);
  const actions = el("div", "lto-hud-actions");
  actions.setAttribute("role", "toolbar");
  actions.setAttribute("aria-label", "Actions");
  // Pack, Log and Saves: the drawer's tabs. Notices sit right under them.
  const tabs = el("div", "lto-hud-drawer-btns");
  tabs.dataset.hudTabs = "";
  tabs.hidden = true;
  tabs.setAttribute("role", "toolbar");
  tabs.setAttribute("aria-label", "Pack, journal, log, saves and settings");
  const noticeBox = el("div", "lto-hud-notices");
  noticeBox.dataset.hudNotices = "";
  noticeBox.hidden = true;
  noticeBox.setAttribute("aria-live", "polite");
  noticeBox.setAttribute("aria-atomic", "false");
  const drawerBox = el("div", "lto-hud-drawer");
  drawerBox.dataset.hudDrawer = "";
  drawerBox.hidden = true;
  drawerBox.setAttribute("role", "group");
  root.append(panel);
  if (opts.slot) root.append(opts.slot);
  root.append(next, actions, tabs, noticeBox, drawerBox);
  host.appendChild(root);

  const isPixel = (): boolean => style === "pixel";
  /** The pack's hover helps, detached whenever the drawer is rebuilt (their rows are replaced). */
  hc.tipOff = [];
  /** What the pack rows on screen were drawn from (look, width, items): while a card is pinned on one of them, a redraw for some other reason leaves them be. */
  hc.drawnPackSig = "";
  const packSig = (s: HudState): string => `${isPixel()}|${root.clientWidth}|${JSON.stringify(s.pack?.sections ?? null)}`;
  /** What a tip stays inside: the game window the HUD sits in, or the HUD itself. */
  const tipBoundary = (): HTMLElement => host.closest<HTMLElement>(".lt-game") ?? root;
  /**
   * A name that has to fit on one line of the pixel bar: cut with ".." when it would run into the meter
   * (a made character's name can be 60 characters long). The screen reader text keeps the whole name.
   */
  const fitName = (words: string): string => {
    const room = Math.max(60, (root.clientWidth || 300) - 44 - 128);
    if (textWidth(words) * 2 <= room) return words;
    let cut = words.length;
    while (cut > 1 && textWidth(`${words.slice(0, cut).trimEnd()}..`) * 2 > room) cut--;
    return `${words.slice(0, cut).trimEnd()}..`;
  };
  /** The panel's text: bitmap in the pixel look (font pixels are 2 CSS px), plain in storybook; a name is cut with ".." to stay on its line. */
  const tk = createTextKit({ style: () => style, width: () => (root.clientWidth || 300) - 44, name: fitName });
  const text = tk.text;
  const kit: ViewKit = { style: () => style, text: tk.text, px: tk.px, onAction, width: () => root.clientWidth || 300 };
  /** The small-screen look: asked for by the state, narrower than CONDENSED_MAX_PX, and the dock fills its whole row (it sits under the board). */
  const condensed = (): boolean => !!hc.last?.condense && condensedHud(root.clientWidth, (host.parentElement ?? host).clientWidth);

  const has = (s: HudState | null): Record<DrawerTab, boolean> => ({ pack: !!s?.pack, journal: !!s?.journal, log: !!s?.log, saves: !!s?.saves, settings: !!s?.settings });
  /** The tab that really shows now. */
  const openTab = (): DrawerTab | null => usableDrawerTab(drawer, has(hc.last));

  // What the modules below read or call.
  hc.root = root;
  hc.panel = panel;
  hc.next = next;
  hc.nextLabel = nextLabel;
  hc.nextList = nextList;
  hc.actions = actions;
  hc.tabs = tabs;
  hc.noticeBox = noticeBox;
  hc.drawerBox = drawerBox;
  hc.isPixel = isPixel;
  hc.packSig = packSig;
  hc.tipBoundary = tipBoundary;
  hc.px = tk.px;
  hc.text = text;
  hc.kit = kit;
  hc.condensed = condensed;
  hc.has = has;
  hc.openTab = openTab;

  installHudPanel(hc);
  installDrawerViews(hc);

  function setDrawer(want: DrawerTab | null): void {
    const before = openTab();
    drawer = want;
    // Opening the pack lights up what arrived while it was shut.
    if (openTab() === "pack" && before !== "pack") {
      hc.freshNow = hc.pendingNew;
      hc.pendingNew = new Set();
    }
    if (openTab() === "journal") hc.journalNew = false;
    redraw();
  }

  function toggleTab(tab: DrawerTab): void {
    if (!has(hc.last)[tab]) return;
    setDrawer(toggleDrawerTab(openTab(), tab));
  }
  hc.toggleTab = toggleTab;

  /** Redraw while keeping keyboard focus on the same button. */
  function redraw(): void {
    const at = document.activeElement as HTMLElement | null;
    let focusKey: [string, string] | null = null;
    if (at && root.contains(at)) {
      for (const k of ["action", "option", "hudDrawer", "save", "export", "exportCopy", "settingChoice"]) {
        const v = at.dataset[k];
        if (v !== undefined) {
          focusKey = [k, v];
          break;
        }
      }
    }
    // A pack item holding keyboard focus (for its hover help) keeps it across the rebuild, by its words.
    const rowItem = at && drawerBox.contains(at) && at.classList.contains("lto-hud-row") ? at.dataset.item : undefined;
    hc.draw();
    if (focusKey) {
      for (const b of root.querySelectorAll<HTMLElement>("button")) {
        if (b.dataset[focusKey[0]] === focusKey[1]) {
          b.focus();
          break;
        }
      }
    } else if (rowItem !== undefined) {
      for (const r of drawerBox.querySelectorAll<HTMLElement>(".lto-hud-row[data-item]")) {
        if (r.dataset.item === rowItem) {
          r.focus({ preventScroll: true });
          break;
        }
      }
    }
  }

  // Pixel text is drawn for one width (and the small-screen look depends on it), so a change in the column's width (a resize, the HUD shown after being hidden) redraws it.
  let seenWidth = 0;
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          const w = root.clientWidth;
          if (w === seenWidth) return;
          seenWidth = w;
          if (w > 0 && hc.last && (isPixel() || hc.last.condense) && !hc.destroyed) redraw();
        })
      : null;
  ro?.observe(root);
  installHudNotices(hc);

  const api: Hud = {
    setStyle(to: TextStyle): void {
      if (to === style) return;
      style = to;
      for (const n of hc.notices) hc.fillNotice(n);
      redraw();
    },
    render(state: HudState): void {
      // Rebuilt only when what it shows changed: a turn is a handful of changes, not one per frame.
      const key = JSON.stringify(state) + style;
      if (key === lastKey) return;
      lastKey = key;
      // What is new in the pack since the last look lights up if the pack is open, and otherwise waits for it to be opened.
      const added = newPackItems(prevPack, state.pack?.sections);
      prevPack = state.pack?.sections ?? null;
      if (drawer === "pack" && state.pack) hc.freshNow = added;
      else for (const item of added) hc.pendingNew.add(item);
      const jsig = state.journal ? JSON.stringify([state.journal.scene, journalObjectives(state.journal.objectives), journalRecent(state.journal.recent)]) : null;
      if (jsig !== null && prevJournal !== null && jsig !== prevJournal && drawer !== "journal") hc.journalNew = true;
      if (jsig === null) hc.journalNew = false;
      prevJournal = jsig;
      hc.last = state;
      redraw();
    },
    togglePack(): void {
      toggleTab("pack");
    },
    toggleLog(): void {
      toggleTab("log");
    },
    toggleSaves(): void {
      toggleTab("saves");
    },
    toggleJournal(): void {
      toggleTab("journal");
    },
    openDrawer(tab: DrawerTab): void {
      if (!has(hc.last)[tab]) return;
      setDrawer(tab);
    },
    closeDrawer(): void {
      if (openTab() === null) return;
      setDrawer(null);
    },
    isPackOpen(): boolean {
      return openTab() === "pack";
    },
    isDrawerOpen(): boolean {
      return openTab() !== null;
    },
    drawerTab(): DrawerTab | null {
      return openTab();
    },
    notice: hc.noticeNow,
    destroy(): void {
      hc.destroyed = true;
      for (const off of hc.tipOff) off();
      hc.tipOff = [];
      for (const n of Array.from(hc.notices)) hc.dropNotice(n);
      ro?.disconnect();
      root.remove();
    },
  };
  return api;
}
