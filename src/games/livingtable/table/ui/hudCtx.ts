/**
 * The shared context of one HUD: everything the HUD's modules read or call across files. createHud builds it (`hc`), each installer fills in its own functions, and state that more than one module touches lives here as plain properties.
 */
import type { HudState, DrawerTab, PackSection } from "./hudTypes";
import type { HudTone } from "./hudHelpers";
import type { Notice } from "./hudNotices";
import type { ViewKit, TextKind } from "./menuViews";
import type { PixelTextOptions } from "./pixelFont";

export interface HudCtx {
  // ---- createHud.ts (the scaffolding, the text helpers, the drawer controls and the api)
  onAction: (id: string) => void;
  opts: {
    slot?: HTMLElement;
    /** A button of a pinned item card in the Pack tab: the item's key (PackItem.key) and the action's id. */
    onItemAction?: (itemKey: string, actionId: string) => void;
  };
  destroyed: boolean;
  last: HudState | null;
  freshNow: Set<string>;
  pendingNew: Set<string>;
  journalNew: boolean;
  root: HTMLDivElement;
  panel: HTMLDivElement;
  next: HTMLDivElement;
  nextLabel: HTMLDivElement;
  nextList: HTMLDivElement;
  actions: HTMLDivElement;
  tabs: HTMLDivElement;
  noticeBox: HTMLDivElement;
  drawerBox: HTMLDivElement;
  isPixel: () => boolean;
  tipOff: Array<() => void>;
  drawnPackSig: string;
  packSig: (s: HudState) => string;
  tipBoundary: () => HTMLElement;
  px: (text: string, o: PixelTextOptions) => HTMLCanvasElement;
  text: (words: string, kind: TextKind, inset?: number, tone?: HudTone) => HTMLElement;
  /** The shared views' kit (menuViews.ts): the look, the text helpers and where a press goes. */
  kit: ViewKit;
  /** Whether the panel draws its small-screen look now (it asked for it, is narrow and fills its row). */
  condensed: () => boolean;
  has: (s: HudState | null) => Record<DrawerTab, boolean>;
  openTab: () => DrawerTab | null;
  toggleTab: (tab: DrawerTab) => void;
  // ---- src/games/livingtable/table/ui/hudPanel.ts
  draw: () => void;
  // ---- src/games/livingtable/table/ui/drawerViews.ts
  packView: (sections: readonly PackSection[], prevScroll: number) => HTMLElement;
  // ---- src/games/livingtable/table/ui/hudNotices.ts
  notices: Notice[];
  fillNotice: (n: Notice) => void;
  dropNotice: (n: Notice) => void;
  noticeNow: (words: string, tone?: "good" | "bad" | "plain") => void;
}
