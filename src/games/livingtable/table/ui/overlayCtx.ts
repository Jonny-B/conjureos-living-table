/**
 * The shared context of one overlay: everything the overlay's modules read or call across files. createOverlay builds it (`oc`), each installer fills in its own functions, and state that more than one module touches lives here as plain properties.
 */
import type { PixelRun, PixelTextOptions } from "./pixelFont";
import type {
  TextStyle,
  InitiativeEntry,
  FloatKind,
  OverlayPoint,
  BannerKind,
  PlateReadout,
  TextSpeed,
  DialogueLine,
  NarrationHandle,
  ContextMenuEntry,
  LootWindowOptions,
  LootWindow,
  StartScreenOptions,
  StartScreen,
  StartHeroOptions,
  StartHero,
  EndingCardOptions,
  EndingCard,
  StoryOptions,
} from "./overlayTypes";
import type { FrameKey } from "./overlayTheme";
import type { RecentFloat } from "./overlayMath";
import type { DialogueQueue } from "./dialogueQueue";
import type { FloatInk } from "./feedback";
import type { LivePlate } from "./plates";
import type { MenuState } from "./contextMenu";
import type { LootState } from "./lootWindow";
import type { TextSpec, Scr } from "./screenKit";

export interface OverlayCtx {
  // ---- createOverlay.ts (the scaffolding, the clock, the sizing and the control functions)
  host: HTMLElement;
  uid: string;
  style: TextStyle;
  destroyed: boolean;
  epoch: number;
  root: HTMLDivElement;
  platesLayer: HTMLDivElement;
  floatsLayer: HTMLDivElement;
  top: HTMLDivElement;
  initEl: HTMLDivElement;
  bottom: HTMLDivElement;
  dlg: HTMLDivElement;
  dlgTag: HTMLDivElement;
  dlgBox: HTMLDivElement;
  dlgBody: HTMLDivElement;
  dlgMore: HTMLSpanElement;
  bannersLayer: HTMLDivElement;
  /** How many banners are up now (the top band stays open for them). */
  bannersUp: number;
  initState: { entries: readonly InitiativeEntry[]; activeId: string | null; round: number };
  recent: RecentFloat[];
  tier: "s" | "m" | "l";
  width: number;
  reduced: () => boolean;
  wait: (ms: number) => Promise<void>;
  start: (node: Element, frames: Keyframe[], ms: number, easing?: string) => { anim: Animation | null; done: Promise<void>; };
  play: (node: Element, frames: Keyframe[], ms: number, easing?: string) => Promise<void>;
  setBusy: (delta: number, forEpoch: number) => void;
  announce: (text: string) => void;
  isPixel: () => boolean;
  px: (input: string | readonly PixelRun[], opts: PixelTextOptions) => HTMLCanvasElement;
  srText: (text: string) => HTMLElement;
  frame: (node: HTMLElement, key?: FrameKey, small?: boolean) => HTMLElement;
  // ---- src/games/livingtable/table/ui/feedback.ts
  liveFloats: Set<FloatInk>;
  damageReach: () => number;
  float: (at: OverlayPoint, text: string, kind: FloatKind) => void;
  banner: (text: string, kind: BannerKind) => Promise<void>;
  /** The height one banner takes in the current style and size: the slot the top band keeps for it. */
  bannerSlotPx: () => number;
  // ---- src/games/livingtable/table/ui/plates.ts
  platesWaiting: number;
  livePlates: Set<LivePlate>;
  safeTop: () => number;
  stepPlateUp: (plate: LivePlate, f: FloatInk) => void;
  rollPlate: (at: OverlayPoint, readout: PlateReadout) => void;
  // ---- src/games/livingtable/table/ui/dialogue.ts
  drawnLook: string;
  drawnPage: string;
  drawnShown: number;
  drawnMore: boolean | null;
  lineNodes: HTMLElement[];
  fade: Animation | null;
  dq: DialogueQueue;
  /** The dialogue's clock stops while the story screen covers it, so a box is not read out unseen. */
  dlgPaused: boolean;
  pauseDialogue: (paused: boolean) => void;
  /** The DM box's Cancel button: its handler (null when there is none). */
  dmCancel: (() => void) | null;
  onDmCancel: (handler: (() => void) | null) => void;
  /** Work out the room the full DM box takes and publish it as --lto-dock on the host. */
  publishDock: () => void;
  cancelLoop: () => void;
  relayoutDialogue: () => void;
  pressDialogue: () => boolean;
  say: (line: DialogueLine) => void;
  dismissStory: (opts?: { stickyOnly?: boolean; }) => void;
  setTextSpeed: (next: TextSpeed) => void;
  narrate: (opts: { speaker?: string; text: string; full?: boolean; }) => NarrationHandle;
  // ---- src/games/livingtable/table/ui/initiative.ts
  renderInitiative: () => void;
  /** Publish --lto-top-band on the host: the room the turn strip and its banner slot take while a fight is on, else 0. */
  updateBands: () => void;
  initiative: (entries: readonly InitiativeEntry[], activeId: string | null, round: number) => void;
  // ---- src/games/livingtable/table/ui/contextMenu.ts
  menu: MenuState | null;
  menuLayer: HTMLDivElement;
  renderMenu: (m: MenuState) => void;
  closeMenu: (refocus: boolean) => void;
  contextMenu: (at: OverlayPoint, entries: readonly ContextMenuEntry[], onPick: (id: string) => void, mopts?: { title?: string; }) => () => void;
  // ---- src/games/livingtable/table/ui/lootWindow.ts
  loot: LootState | null;
  lootHost: HTMLDivElement;
  layoutLoot: () => void;
  renderLoot: (l: LootState) => void;
  closeLoot: (l: LootState, notify: boolean) => void;
  lootWindow: (lopts: LootWindowOptions) => LootWindow;
  // ---- src/games/livingtable/table/ui/screenKit.ts
  roomOf: (node: HTMLElement, slack?: number) => number;
  stext: (parent: HTMLElement, words: string, spec: TextSpec) => HTMLElement;
  ribbon: (parent: HTMLElement, text: string, kind: BannerKind, o: { pxMax: number; sbMax: number; }) => HTMLElement;
  sbtn: (parent: HTMLElement, label: string, key: string, pri?: boolean) => HTMLButtonElement;
  sectionHead: (parent: HTMLElement, words: string) => void;
  pill: (parent: HTMLElement, words: string, tone: "plain" | "ai") => void;
  screens: Set<Scr>;
  screensLayer: HTMLDivElement;
  closeScreen: (s: Scr) => void;
  rebuildScreens: () => void;
  mountScreen: (kind: string, label: string, draw: (s: Scr) => void) => Scr;
  titleBlock: (parent: HTMLElement, title: string, sub: string) => void;
  // ---- src/games/livingtable/table/ui/startScreen.ts
  startScreen: (sopts: StartScreenOptions) => StartScreen;
  // ---- src/games/livingtable/table/ui/heroEnding.ts
  startHero: (hopts: StartHeroOptions) => StartHero;
  endingCard: (eopts: EndingCardOptions) => EndingCard;
  // ---- src/games/livingtable/table/ui/story.ts
  storyLayer: HTMLDivElement;
  storyScreen: (sopts: StoryOptions) => Promise<void>;
  storyOpen: () => boolean;
  whenStoryClosed: () => Promise<void>;
  onStoryChange: (handler: ((open: boolean) => void) | null) => void;
  relayoutStory: () => void;
  clearStory: () => void;
  // ---- src/games/livingtable/table/ui/arrivals.ts
  /** Always hidden and empty now (the arrival banners are the story screen); plates.ts still asks whether a card is up. */
  cardsHost: HTMLDivElement;
  locationCard: (o: { name: string; readAloud: string; }) => void;
  sceneCard: (o: { title: string; opening?: string; }) => void;
}
