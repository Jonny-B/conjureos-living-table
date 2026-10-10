/**
 * The shared context of one table window: everything the window's flow modules read or call across files. mountTable builds it (`tc`), each installer in flows/ fills in its own functions, and state that more than one flow touches lives here as plain properties.
 */
import type { ArchetypeId } from "../characters/equipmentTypes";
import type { TemplateGenre } from "../characters/templates";
import type { CharacterSheet } from "../characters/creation";
import type { ContextAction } from "../session/contextActions";
import type { DmExchange } from "../session/adventureExport";
import type { SaveKind } from "../session/savePoints";
import type { CombatEvent } from "../session/combatEvents";
import type {
  DialogueLine,
  Hud,
  LootWindow,
  NarrationHandle,
  Overlay,
  OverlayPoint,
  PackSection,
  StartHero,
  StartScreen,
  EndingCard,
  TextSpeed,
  TextStyle,
} from "./ui/overlay";
import type { DmAsk, DmReply, SampleFn } from "./dmCore";
import type { DiceTray, DieKind, RollRequest } from "./ui/dice";
import type { CreationView, SheetExtras, SheetView } from "./ui/sheet";
import type { Actor } from "./ui/cast";
import type { TileId } from "../world/cell";
import type { AdventureStepResult } from "../adventures/progress";
import type { Adventure, AdventureFeature } from "../adventures/types";
import type { Creature, PlayState, RoomChoice, XY } from "./state";
import type { TableHost } from "./host";
import type { GearOutcome } from "./gearLoot";
import type { BenchAdventure } from "./adventureCatalog";
import type { Swing } from "./fightRules";
import type { ExitHere } from "./adventureRun";
import type { RollMeta } from "./flows/rolls";
import type { Plan } from "./flows/board";
import type { SampleState } from "./flows/dmFlow";
import type { BenchBundle } from "./flows/exportFlow";
import type { TableOptions, TableSession, TableWindow } from "./mountTable";
import type { PlayStage } from "./stage";
import type { MenuTab } from "./ui/gameMenu";
import type { HeroPictures } from "./ui/heroPicture";
import type { AskState } from "./flows/dmFlow";

export interface TableCtx {
  // ---- mountTable.ts (the setup before the flows and the window handle after them)
  el: HTMLElement;
  host: TableHost;
  opts: TableOptions;
  session: TableSession;
  reducedMotion: boolean;
  heroIds: ArchetypeId[];
  unbinds: Array<() => void>;
  carry: (from: PlayState | null, to: PlayState, why: string) => void;
  addSavePoint: (p: PlayState, kind: SaveKind, label: string) => void;
  artSize: (template: TemplateGenre) => number;
  textStyle: TextStyle;
  rollMyself: boolean;
  textSpeed: TextSpeed;
  st: () => PlayState;
  lastHero: CharacterSheet;
  defaultScale: () => number;
  scale: number;
  lastArtSize: number;
  tileScale: () => number;
  /** Measure the stage again and redraw the board at the size that fits. Call after a view opens or closes or anything else that changes the stage's room. Safe at any time. */
  stageRefresh: () => void;
  stageWrap: HTMLDivElement;
  viewport: HTMLDivElement;
  canvas: HTMLCanvasElement;
  marks: HTMLCanvasElement;
  trayCol: HTMLDivElement;
  trayHost: HTMLDivElement;
  overlay: Overlay;
  applyTextSpeed: () => void;
  tray: DiceTray;
  hud: Hud;
  stage: PlayStage;
  win: TableWindow;
  // ---- src/games/livingtable/table/flows/mainMenu.ts
  /** Open the main menu over the board (replacing whatever screen is up). */
  openMainMenu: () => void;
  /** The open main menu, or null. The screens count it as open. */
  menuScr: { close(): void } | null;
  // ---- src/games/livingtable/table/flows/gameMenuFlow.ts
  /** Open the game menu on a tab (Character when none is asked for). The tab already showing closes it again; a story screen refuses it. */
  openGameMenu: (tab?: MenuTab) => void;
  closeGameMenu: () => void;
  gameMenuOpen: () => boolean;
  /** Give the open menu the game as it is now (the readout calls this on every redraw). Does nothing while it is shut. */
  syncGameMenu: () => void;
  // ---- src/games/livingtable/table/flows/rolls.ts
  throwDice: (req: RollRequest, who: string, meta?: RollMeta) => Promise<void>;
  rollStep: (prompt: string, dice: readonly { kind: DieKind; result: number; }[], label: string, detail: string, tone: "good" | "bad" | "plain", meta?: RollMeta) => Promise<void>;
  foeThrow: (p: PlayState, c: Creature, dice: readonly { kind: DieKind; result: number; }[], label: string, detail: string, tone: "good" | "bad" | "plain", meta?: RollMeta) => Promise<void>;
  // ---- src/games/livingtable/table/flows/sheetViews.ts
  sheetView: SheetView | null;
  creationView: CreationView | null;
  startScr: StartScreen | null;
  heroScr: StartHero | null;
  endScr: EndingCard | null;
  screenOpen: () => boolean;
  exportStatus: string | undefined;
  exportCopyShown: boolean;
  lootWin: LootWindow | null;
  lootTarget: { kind: "body"; id: string } | { kind: "pile"; at: XY } | null;
  sheetSig: string;
  overlayOpen: () => boolean;
  portrait: (archetypeId: string) => HTMLCanvasElement | null;
  /** Live pictures of a hero for the screens off the board (the hero choice, the maker, the character sheet): the cast figure when it is loaded, the still art otherwise. */
  pictures: HeroPictures;
  sheetExtras: (p: PlayState) => SheetExtras;
  sheetSigFor: (p: PlayState) => string;
  viewsChanged: () => void;
  closeSheet: () => void;
  closeViews: () => void;
  openSheetView: () => void;
  toggleSheet: () => void;
  rollScoreDice: (groups: number, count: number, sides: number, label: string) => Promise<number[][]>;
  // ---- src/games/livingtable/table/flows/adventureStart.ts
  closeScreens: () => void;
  showStart: () => void;
  showLocationCard: (card: { name: string; readAloud: string; }) => void;
  beginAdventure: (entry: BenchAdventure, sheet: CharacterSheet) => void;
  arrivalFight: () => Promise<void>;
  flushAdventure: () => void;
  // ---- src/games/livingtable/table/flows/adventureWorld.ts
  pendingTell: string[];
  showEnding: (a: Adventure, sceneId: string, ending: NonNullable<AdventureStepResult["ended"]>) => void;
  useExit: (here: ExitHere) => Promise<void>;
  showFeature: (f: AdventureFeature) => void;
  featureFlow: (at: XY) => Promise<void>;
  talkTo: (c: Creature) => void;
  // ---- src/games/livingtable/table/flows/board.ts
  tileAt: (clientX: number, clientY: number) => XY | null;
  toHost: (px: number, py: number) => OverlayPoint;
  headOf: (who: "hero" | TileId, tile?: XY) => OverlayPoint;
  planFor: (tile: XY) => Plan;
  hover: XY | null;
  /** The square last selected by a click, a tap or the actions menu (one neutral ring marks it), or null. */
  selected: XY | null;
  /**
   * What it costs to walk to whatever stands at `tile`: to the square beside it, treating a thing drawn in several squares
   * (a well, a cottage) as one footprint where the nearest part wins. `feet` is the walk's length (in a fight, the movement
   * it spends); `reachable` is false when no such square can be reached now (out of movement, walled in, not the hero's turn).
   * Already beside it costs 0 feet and is reachable.
   */
  approachCost: (tile: XY) => { reachable: boolean; feet: number };
  /**
   * Walk to the square beside whatever stands at `tile`, then run `act`. If the walk is interrupted (something noticed the hero,
   * a step was refused, the player pressed Space) or the movement runs out, `act` is dropped and nothing is spent. `act` is
   * responsible for its own cost and for calling afterHeroAction.
   */
  walkThen: (tile: XY, act: () => void | Promise<void>) => void;
  marksKey: string;
  drawMarks: () => void;
  // ---- src/games/livingtable/table/flows/act.ts
  walkQueue: XY[];
  onArrive: (() => Promise<void>) | null;
  busy: boolean;
  skipping: boolean;
  wait: (ms: number) => Promise<void>;
  said: number;
  flushLog: () => void;
  story: (line: DialogueLine, alsoLog?: boolean) => void;
  clearOptions: () => void;
  refuse: (reason: string) => void;
  stepAnim: (actor: Actor, from: XY, to: XY) => void;
  showAttack: (events: readonly CombatEvent[], target: "hero" | TileId, targetTile?: XY) => void;
  inOrder: (p: PlayState, c: Creature) => boolean;
  needsFight: (p: PlayState, c: Creature) => boolean;
  wakeBark: (p: PlayState, woke: readonly Creature[]) => void;
  // ---- src/games/livingtable/table/flows/fight.ts
  beginFight: (fromHiding?: boolean, wake?: readonly Creature[]) => Promise<void>;
  runHostiles: () => Promise<void>;
  afterHeroAction: () => Promise<void>;
  fightWasOn: boolean;
  stealthStep: () => Promise<void>;
  // ---- src/games/livingtable/table/flows/attack.ts
  steppedOnExit: XY | null;
  pump: (now: number) => void;
  throwSwingAttack: (sw: Swing, target: XY) => Promise<void>;
  throwSwingDamage: (sw: Swing) => Promise<void>;
  swingAftermath: (p: PlayState, m: Creature, events: readonly CombatEvent[]) => void;
  runPlan: (plan: Plan) => void;
  /** The plan to walk up to the creature on `tile` and strike it (within the weapon's reach, in sight of it): what the actions menu's Attack and the F key run. A click never makes one. */
  attackPlanFor: (tile: XY) => Plan;
  attackNearest: () => Promise<void>;
  // ---- src/games/livingtable/table/flows/loot.ts
  closeLoot: () => void;
  openLootAt: (tile: XY) => void;
  runItemAction: (key: string, id: string) => Promise<void>;
  useNearby: () => Promise<void>;
  drinkPotion: (kit?: string) => Promise<void>;
  // ---- src/games/livingtable/table/flows/turns.ts
  endTurnFlow: () => Promise<void>;
  restFlow: () => Promise<void>;
  loadSave: (id: string) => void;
  resetScene: () => void;
  pickOption: (i: number) => void;
  // ---- src/games/livingtable/table/flows/dmFlow.ts
  sampleState: SampleState;
  sampleFn: SampleFn | null;
  dmStatus: string | undefined;
  alive: boolean;
  lastBrief: string | null;
  writerCtl: AbortController | null;
  dmCtl: AbortController | null;
  dmThinking: boolean;
  NO_DM: string;
  peekSample: () => SampleFn | null;
  loadSample: () => Promise<void>;
  cancelDm: () => void;
  askStateFor: (p: PlayState) => AskState;
  packSections: (p: PlayState) => PackSection[];
  examineAt: (at: XY) => void;
  runDm: (first: DmAsk) => Promise<void>;
  // ---- src/games/livingtable/table/flows/dmReply.ts
  playReply: (p: PlayState, ctl: AbortController, ask: DmAsk, reply: DmReply, streaming: NarrationHandle, journal: DmExchange | null) => Promise<string[]>;
  // ---- src/games/livingtable/table/flows/menuFlow.ts
  openMenu: (clientX: number, clientY: number) => void;
  spendCost: (p: PlayState, cost: ContextAction["cost"]) => void;
  afterManeuver: () => Promise<void>;
  // ---- src/games/livingtable/table/flows/maneuvers.ts
  pushCreatureBy: (p: PlayState, m: Creature, squares: number) => Promise<number>;
  proneCreature: (p: PlayState, m: Creature) => string | null;
  runEngineAction: (act: ContextAction, tile: XY) => Promise<void>;
  // ---- src/games/livingtable/table/flows/exportFlow.ts
  exportFiles: (bundle: BenchBundle) => { name: string; data: string; }[];
  adventureBundle: () => BenchBundle;
  exportAdventure: () => Promise<void>;
  copyAdventureJson: () => Promise<void>;
  // ---- src/games/livingtable/table/flows/input.ts
  endPress: () => void;
  onKey: (e: KeyboardEvent) => void;
  onBlur: () => void;
  // ---- src/games/livingtable/table/flows/hudWiring.ts
  onHudAction: (id: string) => Promise<void>;
  renderHud: () => void;
  gearResult: (outcome: GearOutcome) => void;
  refreshAll: () => void;
  renderAll: () => void;
  artChanged: () => void;
  applySettings: () => void;
  pickHero: (id: ArchetypeId) => void;
  setRoom: (room: RoomChoice) => void;
  newScene: (checkpoint?: boolean) => void;
}
