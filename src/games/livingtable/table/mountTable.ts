/**
 * The table window: the Living Table's board, HUD, dice tray, character sheet and DM, as one self-contained piece.
 *
 * `mountTable(el, host, opts)` draws it into `el` and returns a handle. The window reaches the outside world only through the
 * `TableHost` it is given (host.ts): the art, the DM, storage, files, the adventures, the heroes, the settings, the dice and the clock. So
 * one copy serves the asset bench (its own art, a stand-in or claude.ai DM, the browser's own storage) and the shipped game.
 *
 * This is the bench's Play panel moved as it was. What changed is what it keeps and what it asks for:
 *
 *   - The singletons the bench kept at module level (the scene, the start screen flag, the Room choice, the saves, the session log) live in
 *     a `TableSession`, one per place that hosts a window. A host that wants the game to survive the window (the bench's tab switch) keeps
 *     one session and hands it to every mount; a host that does not lets each mount make its own.
 *   - The bench's own controls (the Art row, Hero, Zoom, Text, Room, roll-my-own-dice, Reset, Start, the Worn, Pack and Armoury section, the
 *     dice-skin shop) are not here. They drive the window through the handle (`pickHero`, `setRoom`, `applySettings`, `reset`,
 *     `showStart`) and draw their own parts from `opts.onRefresh`, `opts.diceShop` and `gearResult`.
 *   - Every key listener, timer, frame loop and module binding is released by `dispose()`.
 *
 * Import-pure: nothing runs until `mountTable` is called.
 */
import { type ArchetypeId } from "../characters/equipmentTypes";
import { type TemplateGenre } from "../characters/templates";
import { type SaveKind } from "../session/savePoints";
import { spriteSizeOf } from "../render/canvasRenderer";
import { createHud, createOverlay, textSpeedOf, type Hud, type Overlay } from "./ui/overlay";
import { createDiceTray, createSkinPicker, type DiceTray } from "./ui/dice";
import { trackMore } from "./ui/menuHelpers";
import { visibilityStates } from "../world/visibility";
import { type AdventureEvent } from "../adventures/types";
import { ROOM_FLOOR, carryJournals, createSessionLog, newPlay, sandboxFromAddress, type PlayState, type RoomChoice, type SessionLog } from "./state";
import { createSaveBook, type SaveBook } from "./snapshot";
import { type TableHandle, type TableHost } from "./host";
import { type GearOutcome } from "./gearLoot";
import { BOARD_CANVAS_CLASS, TABLE_ROOT_CLASS, injectTableStyle } from "./tableStyle";
import { bindCatalog } from "./catalog";
import { bindAdventures } from "./adventureCatalog";
import { bindFightEnv } from "./fightRules";
import { bindCastSource } from "./ui/cast";
import { createFog } from "./fog";
import { advApply, advBoard, currentLocation, exitIsOpen, exitsHere, featureIsFound, featureSearchable } from "./adventureRun";
import { creaturesInSight, heroSees } from "./sight";
import { dmAdventureView } from "./dmScene";
import { createPlayStage } from "./stage";
import { createStageFit, pageZoom, type StageFit } from "./stageFit";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import type { TableCtx } from "./tableCtx";
import type { OverlayPoint } from "./ui/overlayTypes";
import { installRolls } from "./flows/rolls";
import { installSheetViews } from "./flows/sheetViews";
import { installAdventureStart } from "./flows/adventureStart";
import { installAdventureWorld } from "./flows/adventureWorld";
import { installBoard } from "./flows/board";
import { installAct } from "./flows/act";
import { installFight } from "./flows/fight";
import { installAttack } from "./flows/attack";
import { installLoot } from "./flows/loot";
import { installTurns } from "./flows/turns";
import { installDmFlow } from "./flows/dmFlow";
import { installDmReply } from "./flows/dmReply";
import { installMenuFlow } from "./flows/menuFlow";
import { installManeuvers } from "./flows/maneuvers";
import { installExportFlow } from "./flows/exportFlow";
import { installInput } from "./flows/input";
import { installHudWiring } from "./flows/hudWiring";
import { installMainMenu } from "./flows/mainMenu";
import { installGameMenu } from "./flows/gameMenuFlow";

// ---- what a host gives the window, and what the window gives back --------------------------------------------------------------------------

/** What one place that hosts a window keeps between windows: the game in progress, and what it needs around it. */
export interface TableSession {
  /** The scene being played, or null before the first window has started one. */
  play: PlayState | null;
  /** True while the start screen is wanted (nothing has been chosen yet in this session). */
  atStart: boolean;
  /** The Room setting last chosen (one goblin, or a goblin and a skeleton). */
  roomChoice: RoomChoice;
  /** The quick saves, read from the host's storage when the session began. */
  saves: SaveBook;
  /** The lines that scrolled off the Log, kept for the debug export. */
  log: SessionLog;
  /** A game in progress was left for the adventure list; the main menu's Continue goes back to it. */
  paused?: boolean;
  /**
   * The save Continue loads, or null for none. Absent: the newest save in the book. A host that must hold saves back (the game host,
   * while it does not know whose they are) sets it.
   */
  continueId?: string | null;
}

/** A new session. The saves are read from the host's storage now, once, as the bench read them once per page load. */
export function createTableSession(host: Pick<TableHost, "storage">): TableSession {
  return { play: null, atStart: true, roomChoice: "one", saves: createSaveBook(host.storage.saves), log: createSessionLog() };
}

export interface TableOptions {
  /** The session to play in. Without one the window makes its own, and the game ends with the window. */
  session?: TableSession;
  /** Where to put the dice-skin shop preview (the bench's). Without it there is none. */
  diceShop?: HTMLElement;
  /**
   * Whether the window feeds the cast to the animation engine from `host.art.cast()` (default true). A host whose other screens need the cast
   * even when the window draws static tokens (the bench's Characters tab) binds it itself and passes false.
   */
  bindCast?: boolean;
  /** Called after every readout refresh ("refresh") and every full redraw ("all": a new scene, a new hero, a loaded save). The bench draws its gear section from here. */
  onRefresh?: (win: TableWindow, kind: "refresh" | "all") => void;
  /**
   * How the window sits in its page. "page" fills the box it is mounted in and draws the board at the largest size that fits it (stageFit.ts),
   * again whenever the box changes; "none" leaves the board at the fixed size the zoom setting gives (the bench's panel). Default: "page" when the
   * window is mounted inside the game's page (an ancestor with the class lt-app), else "none".
   */
  fit?: "page" | "none";
}

/** The handle mountTable returns: TableHandle, and what a host with its own controls needs besides. */
export interface TableWindow extends TableHandle<PlayState> {
  /** The scene being played. */
  state(): PlayState;
  /** Whether the start screen is up (nothing chosen yet). */
  atStart(): boolean;
  /** The board's zoom now (whole pixels per art pixel; 4 or more on a big screen), for a control that shows it. */
  zoom(): number;
  /** The art changed: pick the zoom for a new detail size and draw everything again. (Also done on its own when `host.art.onChange` fires.) */
  artChanged(): void;
  /** Open the main menu (the page's Menu button). Absent when the host has none. */
  openMainMenu?(): void;
  /** Tell the player why something cannot be done (said by the DM box). */
  refuse(reason: string): void;
  /** The result of a gear change made outside the window: a refusal is said, and the window redraws. */
  gearResult(outcome: GearOutcome): void;
}


export function mountTable(el: HTMLElement, host: TableHost, opts: TableOptions = {}): TableWindow {
  const tc = {} as TableCtx;
  tc.el = el;
  tc.host = host;
  tc.opts = opts;
  injectTableStyle();
  el.innerHTML = "";
  el.classList.add(TABLE_ROOT_CLASS);
  // On the game's page the window fills its box and the board is sized from the room it has (stageFit.ts); the bench's panel keeps the fixed board.
  const managed = opts.fit ? opts.fit === "page" : el.closest(".lt-app") !== null;
  if (managed) el.setAttribute("data-fit", "page");
  const session = opts.session ?? createTableSession(host);
  const reducedMotion = host.env.reducedMotion;
  const heroIds = host.heroes.playable();
  // What the engine modules read from the host: the picture catalog, the adventure list, the dice and the cast. The unbinds are tokens, so
  // a window that is disposed late cannot unbind the one that replaced it.
  const unbinds: Array<() => void> = [bindCatalog(host.art), bindAdventures(host), bindFightEnv(host.env)];
  if (opts.bindCast !== false) unbinds.push(bindCastSource(() => host.art.cast()?.data ?? null));
  const carry = (from: PlayState | null, to: PlayState, why: string): void => carryJournals(from, to, why, session.log);
  const addSavePoint = (p: PlayState, kind: SaveKind, label: string): void => session.saves.add(p, kind, label);
  const artSize = (template: TemplateGenre): number => spriteSizeOf(host.art.render(template));
  /** The on-screen text treatment, the roll-my-own-dice choice and the dice skin: the host keeps them, applySettings() reads them again. */
  tc.textStyle = host.settings.get().textStyle;
  tc.rollMyself = host.settings.get().rollMyself;
  let diceSkin = host.settings.get().diceSkin;
  tc.textSpeed = textSpeedOf(host.settings.get().textSpeed);
  // A scene that starts here (first visit, or a hero the window no longer offers) gets its checkpoint below; coming back to one in progress does not.
  const startedNew = !session.play || !heroIds.includes(session.play.archetypeId);
  if (startedNew) {
    const fromAddress = sandboxFromAddress(host.env);
    if (fromAddress) session.roomChoice = fromAddress;
    const initial = host.heroes.initial();
    const archetypeId = (initial?.archetypeId as ArchetypeId | undefined) ?? heroIds[0]!;
    session.play = newPlay("fantasy", archetypeId, ROOM_FLOOR.fantasy, undefined, initial ?? undefined, session.roomChoice);
    session.atStart = fromAddress === null;
  }
  const st = (): PlayState => session.play!;
  /** The hero sheet the host was last told about (host.heroes.onSheet), so it hears of a change once. */
  tc.lastHero = st().hero;

  // Per SOURCE pixel, integers only; renderCell's own unit is canvas px PER
  // TILE (scale x the art's sprite size), so 32 px art halves the default.
  // A window that sizes itself (managed) asks the stage fit for the largest whole zoom that fits the room it has; any other picks once, from the screen.
  const wide = typeof innerWidth === "number" && innerWidth >= 1100;
  const screenScale = (): number => (artSize("fantasy") >= 32 ? (wide ? 2 : 1) : wide ? 3 : 2);
  let fit: StageFit | null = null;
  const defaultScale = (): number => (fit && managed ? fit.auto() : screenScale());
  tc.scale = host.settings.get().zoom ?? screenScale();
  tc.lastArtSize = artSize("fantasy");
  const tileScale = (): number => tc.scale * artSize("fantasy");

  const el_ = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- the stage: the board, the marks over it, and the text overlay ---------

  const stageWrap = el_("div", "lt-stage-wrap");
  const viewport = el_("div", "lt-viewport");
  const board = el_("div", "lt-board");
  const canvas = el_("canvas", BOARD_CANVAS_CLASS);
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
  // The side panel scrolls on a short window (a phone on its side): data-more on it says which edge has more (tableStyle fades that edge).
  const trayMore = trackMore(trayCol);
  const trayMoreLook = (): void => trayMore.update();
  const trayMoreWatch = typeof ResizeObserver === "function" ? new ResizeObserver(() => requestAnimationFrame(trayMoreLook)) : null;
  trayMoreWatch?.observe(trayCol);
  const trayMoreMutations = typeof MutationObserver === "function" ? new MutationObserver(() => requestAnimationFrame(trayMoreLook)) : null;
  trayMoreMutations?.observe(trayCol, { childList: true, subtree: true, characterData: true });
  el.appendChild(arena);
  const overlay: Overlay = createOverlay(stageWrap, tc.textStyle);
  /** Reduced motion prints a page at once; otherwise the text speed setting rules. */
  const applyTextSpeed = (): void => overlay.setTextSpeed(reducedMotion ? "instant" : tc.textSpeed);
  applyTextSpeed();
  const tray: DiceTray = createDiceTray(trayHost, diceSkin);
  const hud: Hud = createHud(trayCol, tc.textStyle, (id) => void tc.onHudAction(id), {
    slot: trayHost,
    onItemAction: (key, id) => void tc.runItemAction(key, id),
  });
  // The dice-skin shop preview is the bench's: it hands in a place to put it.
  const picker = opts.diceShop
    ? createSkinPicker(opts.diceShop, tray, {
        owned: host.settings.ownedDiceSkins(),
        onTry: (id) => {
          diceSkin = id;
          host.settings.set({ diceSkin: id });
        },
      })
    : null;

  // What the modules below read or call.
  tc.session = session;
  tc.reducedMotion = reducedMotion;
  tc.heroIds = heroIds;
  tc.unbinds = unbinds;
  tc.carry = carry;
  tc.addSavePoint = addSavePoint;
  tc.artSize = artSize;
  tc.st = st;
  tc.defaultScale = defaultScale;
  tc.stageRefresh = () => fit?.refresh();
  tc.tileScale = tileScale;
  tc.stageWrap = stageWrap;
  tc.viewport = viewport;
  tc.canvas = canvas;
  tc.marks = marks;
  tc.trayCol = trayCol;
  tc.trayHost = trayHost;
  tc.overlay = overlay;
  tc.applyTextSpeed = applyTextSpeed;
  tc.tray = tray;
  tc.hud = hud;

  installRolls(tc);
  installSheetViews(tc);
  installAdventureStart(tc);
  installMainMenu(tc);
  installGameMenu(tc);
  installAdventureWorld(tc);
  installBoard(tc);
  // On a big screen the page is zoomed (app.css --lt-zoom), and board.ts measures in screen pixels (getBoundingClientRect) while the overlay places its menus,
  // plates and floats with style.left and top, which are in the page's own pixels: divide by the zoom here, so they land on the square they belong to.
  const screenToHost = (p: OverlayPoint): OverlayPoint => {
    const z = pageZoom(stageWrap);
    return z === 1 ? p : { ...p, x: p.x / z, y: p.y / z };
  };
  const toHostPx = tc.toHost;
  const headOfTile = tc.headOf;
  tc.toHost = (px, py) => screenToHost(toHostPx(px, py));
  tc.headOf = (who, tile) => screenToHost(headOfTile(who, tile));
  installAct(tc);
  installFight(tc);
  installAttack(tc);
  installLoot(tc);
  installTurns(tc);
  installDmFlow(tc);
  installDmReply(tc);
  installMenuFlow(tc);
  installManeuvers(tc);
  installExportFlow(tc);
  installInput(tc);
  installHudWiring(tc);

  // One animation-frame loop paints the scene and runs the walk first; the fog of war (fog.ts) rides its frame.
  const fog = createFog({ shroud, canvas, state: st, art: host.art, reducedMotion });
  const stage = createPlayStage({ viewport, canvas, state: st, art: host.art, reducedMotion, zoom: () => tc.scale, beforeFrame: (now) => tc.pump(now), afterFrame: (now, tiles) => fog.frame(now, tiles) });
  tc.stage = stage;

  // The board is sized from the room the stage has, now and whenever the room changes (a resize, a turn of the phone, full screen, a screen opening).
  fit = createStageFit({
    root: el,
    arena,
    stageWrap,
    viewport,
    board,
    canvas,
    trayHost,
    managed,
    cols: CELL_WIDTH,
    rows: CELL_HEIGHT,
    artPx: () => artSize("fantasy"),
    zoom: () => host.settings.get().zoom ?? null,
    scale: () => tc.scale,
    setScale: (n) => {
      tc.scale = n;
    },
    invalidate: () => {
      tc.stage.invalidate();
      tc.marksKey = "";
    },
    heroAt: () => st().heroAt,
  });
  fit.refresh();
  // The game page is a play surface: no browser menu on a press or a right click, and no drag of a picture. A text field keeps its own.
  const keepNative = (e: Event): void => {
    if (!(e.target instanceof Element) || !e.target.closest("input, textarea, [contenteditable], [data-lt-copy]")) e.preventDefault();
  };
  el.addEventListener("contextmenu", keepNative);
  el.addEventListener("dragstart", keepNative);

  // The adventure's own handle for the bench's headless checks (the DM is what talks to people and decides judgment calls: until it tells the
  // story, a check does):
  //   startScreen()   the start screen, as the button does
  //   event(e)        tell the story something happened ({ type: "talk", npc: "tobin" }, a flag, a kill...), exactly as the game would; returns the refusal, or null
  //   state()         what the story says now: adventure id, scene, place, flags, kills, items held, what is waiting to be shown
  //   dmView()        what the DM is told about the adventure now; lastBrief() the brief it was last given; exportFiles() the debug zip's files as text
  const adventureHandle = {
    startScreen: () => tc.showStart(),
    event: (e: AdventureEvent) => {
      const r = advApply(st(), e);
      tc.flushAdventure();
      tc.refreshAll();
      return r?.refused ?? null;
    },
    // What the DM is told about the adventure right now (the brief, the steps it may propose, the people here, the item ids), and the brief it was last given.
    dmView: () => {
      const v = dmAdventureView(st());
      return v ? JSON.parse(JSON.stringify(v)) : null;
    },
    lastBrief: () => tc.lastBrief,
    // The files the Saves tab's Export would put in the zip, as text.
    exportFiles: () => tc.exportFiles(tc.adventureBundle()).map((f) => ({ name: f.name, data: f.data })),
    state: () => {
      const p = st();
      return {
        adventureId: p.adventureId,
        // The table is busy (a DM turn, a walk, a roll): clicks on the board only skip.
        busy: tc.busy,
        progress: p.progress ? JSON.parse(JSON.stringify(p.progress)) : null,
        pending: p.adventurePending.length,
        places: Object.keys(p.places),
        found: [...p.featuresFound],
        exits: exitsHere(p).map((e) => ({ id: e.exit.id, to: e.exit.to, label: e.exit.label, at: { ...e.at }, open: exitIsOpen(p, e.exit) })),
        features: (currentLocation(p)?.features ?? []).map((f) => ({ id: f.id, at: advBoard(p)?.featuresAt[f.id] ?? null, searchable: featureSearchable(f), found: featureIsFound(p, f) })),
      };
    },
  };
  // What the hero sees, for the same checks: the sight level of every square (0 never seen, 1 remembered, 2 in sight) and which creatures are in sight.
  // monsterInSight is whether any creature is (the one-goblin room's old question); creaturesInSight names each.
  const sightHandle = (): { levels: number[]; monsterInSight: boolean; creaturesInSight: string[] } => {
    const p = st();
    const seen = creaturesInSight(p).map((c) => c.id);
    return { levels: Array.from(visibilityStates(heroSees(p), p.explored)), monsterInSight: seen.length > 0, creaturesInSight: seen };
  };

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    tc.alive = false;
    tc.dmCtl?.abort();
    // The AI writer is a long call and its Cancel button goes with the window: leaving stops it.
    tc.writerCtl?.abort();
    host.settings.set({ diceSkin: tray.skin().id });
    tc.endPress();
    tc.closeViews();
    tc.closeScreens();
    trayMoreWatch?.disconnect();
    trayMoreMutations?.disconnect();
    trayMore.off();
    hud.destroy();
    stage.dispose();
    fit?.dispose();
    el.removeEventListener("contextmenu", keepNative);
    el.removeEventListener("dragstart", keepNative);
    overlay.destroy();
    picker?.destroy();
    tray.destroy();
    document.removeEventListener("keydown", tc.onKey);
    window.removeEventListener("blur", tc.onBlur);
    for (const unbind of unbinds) unbind();
    el.innerHTML = "";
    el.classList.remove(TABLE_ROOT_CLASS);
    el.removeAttribute("data-fit");
  }

  const win: TableWindow = {
    dispose,
    debug: () => ({ play: st, adventure: adventureHandle, sight: sightHandle, save: (label) => addSavePoint(st(), "checkpoint", label) }),
    showStart: tc.showStart,
    openMainMenu: tc.openMainMenu,
    reset: tc.resetScene,
    applySettings: tc.applySettings,
    pickHero: tc.pickHero,
    setRoom: tc.setRoom,
    state: st,
    atStart: () => session.atStart,
    zoom: () => tc.scale,
    artChanged: tc.artChanged,
    refuse: tc.refuse,
    gearResult: tc.gearResult,
  };
  tc.win = win;

  // A scene that starts here is a checkpoint (the saves were read when the session began).
  if (startedNew && !session.atStart) addSavePoint(st(), "checkpoint", "start of the scene");
  tc.renderAll();
  tc.said = st().log.length;
  if (st().round) void tc.runHostiles();
  // The window opens on its start screen until something is chosen (coming back to a game in progress does not).
  if (session.atStart) {
    if (host.env.mainMenu) tc.openMainMenu();
    else tc.showStart();
  }
  // The DM's transport, asked for once, after the first paint.
  void tc.loadSample();
  return win;
}
