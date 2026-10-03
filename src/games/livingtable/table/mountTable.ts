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
import { bodySpriteId, type ArchetypeId } from "../characters/equipmentTypes";
import { getArchetype, type TemplateGenre } from "../characters/templates";
import { createCharacter, type CharacterSheet } from "../characters/creation";
import { packInfo } from "../inventory/itemInfo";
import { equipItem, itemActionsFor, itemUseSay, unequipItem } from "../inventory/itemActions";
import { pocketPick } from "../rules/corpses";
import { BESTIARY } from "../rules/bestiary";
import {
  canonicalAbility,
  canonicalSkill,
  forceDoor,
  monsterShoveProfile,
  monsterSkill,
  pickLock,
  proneEffects,
  pushDestination,
  shoveContest,
  skillCheck,
  sleightOfHand,
  standUpCostFt,
  stealthCheck,
} from "../session/maneuvers";
import { contextActionsFor, type ContextAction, type ContextSituation, type ContextTarget } from "../session/contextActions";
import { ADVENTURE_FORMAT, ADVENTURE_VERSION, adventureFilename, adventureFiles, type AdventureBundle, type DmExchange, type RollRecord } from "../session/adventureExport";
import { zipStore } from "../session/zip";
import { applyDamage, applyHealing, longRest } from "../characters/health";
import { saveLabel, type SaveKind } from "../session/savePoints";
import { parseDiceNotation, rollDice, rollDie } from "../rules/dice";
import { ABILITY_NAME, sentenceCase } from "../menu/labels";
import {
  FEET_PER_TILE,
  MONSTER_INITIATIVE_MODIFIER,
  activeCombatant,
  dropCombatant,
  endTurn,
  hasHostiles,
  isPlayersTurn,
  spendActiveAction,
} from "../menu/combatRound";
import {
  attackerBonusFor,
  checkAdvantageFor,
  effectiveArmorClass,
  effectiveSpeedFt,
  skillModifierFor,
  statblockFor,
  weaponDamageNotationFor,
} from "../session/combat";
import { spriteSizeOf } from "../render/canvasRenderer";
import { headAnchor } from "../render/anchors";
import { type CombatEvent } from "../session/combatEvents";
import {
  createHud,
  createOverlay,
  locationHoldMs,
  verdictWords,
  type ContextMenuEntry,
  type DialogueLine,
  type Hud,
  type HudAction,
  type HudBar,
  type HudOption,
  type HudSave,
  type InitiativeSide,
  type LootWindow,
  type LootWindowItem,
  type NarrationHandle,
  type Overlay,
  type OverlayPoint,
  type PackSection,
  type StartHero,
  type StartHeroHook,
  type StartScreen,
  type EndingCard,
  type TextStyle,
} from "./ui/overlay";
import { foeDiceForToken } from "./ui/foeDice";
import {
  askDm,
  normaliseSkill,
  validationContextFor,
  type DmAsk,
  type DmCheck,
  type DmEffect,
  type DmOption,
  type DmReply,
  type SampleFn,
} from "./dmCore";
import { createDiceTray, createSkinPicker, type DiceTray, type DieKind, type RollRequest } from "./ui/dice";
import {
  dropLowest,
  itemCount,
  itemTip,
  openCreation,
  openSheet,
  sheetItemKey,
  type CreationView,
  type SheetExtras,
  type SheetView,
} from "./ui/sheet";
import {
  STEP_MS,
  actorAt,
  castDirToward,
  playClips,
  startStep,
  stepBusy,
  type Actor,
} from "./ui/cast";
import { CELL_WIDTH, CELL_HEIGHT } from "../world/coordinates";
import type { CellLayout, TileId } from "../world/cell";
import { approachTile, pathTo, reachableTiles } from "../world/pathing";
import { visibilityStates } from "../world/visibility";
import { DEFAULT_MELEE_REACH_TILES, tileDistance } from "../world/reach";
import { type AdventureStepResult } from "../adventures/progress";
import { exitDestination } from "../adventures/validate";
import { AI_ADVENTURE_COST_NOTE, writeAdventure as writeAiAdventure, type AdventureWriterContext, type CompleteInput } from "../adventures/generate";
import {
  heroHook,
  itemOf,
  locationOf,
  sceneOf,
  startingKitFor,
  type Adventure,
  type AdventureEvent,
  type AdventureFeature,
  type AdventureNpc,
  type AdventureProgress,
} from "../adventures/types";
import { ARCHETYPE_LABEL, DIR_STEP, DIVIDER_X, DM_JOURNAL_KEEP, DM_MEMORY_KEEP, DM_RECENT_KEEP, DOWN_NOTE, HERO_ID, LOG_KEEP, NOT_SEEN, ROLL_JOURNAL_KEEP, ROOM_CHOICES, ROOM_FLOOR, SCENE_KIT, awakeHostiles, carryJournals, createSessionLog, creatureAt, creatureById, creatureLabel, creatureName, heroDown, hostilesOf, isRec, newPlay, pluralName, roomLabel, same, sandboxFromAddress, sentence, type Creature, type Dir, type PlayState, type RoomChoice, type SessionLog, type XY } from "./state";
import { createSaveBook, fromSnapshot, saveDetail, toSnapshot, type SaveBook } from "./snapshot";
import { type TableHandle, type TableHost } from "./host";
import { bodyAt, bodyLootItems, destroyFromPack, dropFromPack, ensureBodyLoot, foldItem, hostileNear, itemCardFor, itemCtx, itemRefFor, lootNear, pileAt, pileLootItems, takeFromBodyInto, takeFromPileInto, takeIntoPack, type GearOutcome, withoutCount } from "./gearLoot";
import { BOARD_CANVAS_CLASS, TABLE_ROOT_CLASS, injectTableStyle } from "./tableStyle";
import { adventureAssets, bindCatalog, worldManifest } from "./catalog";
import { TEMPLATE_FILE, adventureHero, adventureHeroFromCreator, benchAdventures, bindAdventures, creatorStartFor, kitWords, registerAiAdventure, startCardsFor, type BenchAdventure } from "./adventureCatalog";
import { MONSTER_SPEED_FT, bindFightEnv, creatureAbility, creatureCouldSee, creatureKind, creaturePassive, creatureStats, doorOrChestUsable, drinkPotionRules, heroAttackRules, heroInteractRules, heroStepTo, joinFight, landSwing, lastPotionDice, monsterTurnRules, restRefusal, revealHero, rollSwing, startFight, stealthy, tableRng, type Swing } from "./fightRules";
import { bindCastSource } from "./ui/cast";
import { createFog, drawLootMarks, drawProneMark, portraitCanvas } from "./fog";
import { advApply, advBoard, advPropWords, advUseFor, adventureOf, containerAt, currentLocation, doorAt, enterLocation, exitIsOpen, exitLockedWords, exitOn, exitsHere, featureAtSquare, featureIsFound, featureKey, featureSearchable, giveAdventureItem, journalFor, newAdventurePlay, npcOf, sceneLayout, sceneTiles, syncItems, terrainBlocks, type ExitHere } from "./adventureRun";
import { activeCreature, blockedWords, creatureInSight, creaturesInSight, engineLayout, foeName, heroActionReady, heroBudgetFt, heroField, heroReachTiles, heroSees, heroesTurn, noteSight, noticers, seesTile, sightKit, sightLevel } from "./sight";
import { LISTEN_DC, applyWorldEffect, describeEffect, dmAdventureView, dmViewFor, grateId, hurtCreatureBy, isGrate, lookableAt, whatIsAt } from "./dmScene";
import { createPlayStage } from "./stage";

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
}

/** The handle mountTable returns: TableHandle, and what a host with its own controls needs besides. */
export interface TableWindow extends TableHandle<PlayState> {
  /** The scene being played. */
  state(): PlayState;
  /** Whether the start screen is up (nothing chosen yet). */
  atStart(): boolean;
  /** The board's zoom now (1 to 4), for a control that shows it. */
  zoom(): number;
  /** The art changed: pick the zoom for a new detail size and draw everything again. (Also done on its own when `host.art.onChange` fires.) */
  artChanged(): void;
  /** Tell the player why something cannot be done (a toast). */
  refuse(reason: string): void;
  /** The result of a gear change made outside the window: a refusal is said, and the window redraws. */
  gearResult(outcome: GearOutcome): void;
}

/** How long a rolled ability score stays on the tray before the next one is thrown, in the creator. */
const SCORE_READ_MS = 700;
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


export function mountTable(el: HTMLElement, host: TableHost, opts: TableOptions = {}): TableWindow {
  injectTableStyle();
  el.innerHTML = "";
  el.classList.add(TABLE_ROOT_CLASS);
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
  let textStyle: TextStyle = host.settings.get().textStyle;
  let rollMyself = host.settings.get().rollMyself;
  let diceSkin = host.settings.get().diceSkin;
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
  let lastHero: CharacterSheet = st().hero;

  // Per SOURCE pixel, integers only; renderCell's own unit is canvas px PER
  // TILE (scale x the art's sprite size), so 32 px art halves the default.
  const wide = typeof innerWidth === "number" && innerWidth >= 1100;
  const defaultScale = () => (artSize("fantasy") >= 32 ? (wide ? 2 : 1) : wide ? 3 : 2);
  let scale = host.settings.get().zoom ?? defaultScale();
  let lastArtSize = artSize("fantasy");
  const tileScale = (): number => scale * artSize("fantasy");

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
  el.appendChild(arena);
  const overlay: Overlay = createOverlay(stageWrap, textStyle);
  const tray: DiceTray = createDiceTray(trayHost, diceSkin);
  const hud: Hud = createHud(trayCol, textStyle, (id) => void onHudAction(id), {
    slot: trayHost,
    onAsk: (text) => void runDm({ kind: "freehand", text }),
    onItemAction: (key, id) => void runItemAction(key, id),
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
  /** The adventure screens over the board (the start screen, the hero screen, an ending): each pauses the game like the sheet does. */
  let startScr: StartScreen | null = null;
  let heroScr: StartHero | null = null;
  let endScr: EndingCard | null = null;
  const screenOpen = (): boolean => startScr !== null || heroScr !== null || endScr !== null;
  /** The debug export's outcome, in plain words, under its button in the Saves tab; and whether the clipboard fallback button shows. */
  let exportStatus: string | undefined;
  let exportCopyShown = false;
  /** The loot window on the board (a body being searched, or a pile), and what it is for. */
  let lootWin: LootWindow | null = null;
  let lootTarget: { kind: "body"; id: string } | { kind: "pile"; at: XY } | null = null;
  let sheetSig = "";
  const overlayOpen = (): boolean => sheetView !== null || creationView !== null || screenOpen();
  const portrait = (archetypeId: string): HTMLCanvasElement | null => portraitCanvas(host.art.render("fantasy"), archetypeId);
  const sheetExtras = (p: PlayState): SheetExtras => ({ potions: p.potions, notes: p.itemNotes, portrait: portrait(p.archetypeId) });
  const sheetSigFor = (p: PlayState): string => JSON.stringify([p.hero, p.potions, p.itemNotes, host.art.signature()]);

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
    const scrollTo = (node: HTMLElement): void => node.scrollIntoView?.({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
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
        if (g < groups - 1 && !reducedMotion) {
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
  function beginCharacter(made: CharacterSheet, input?: Parameters<typeof createCharacter>[0]): void {
    host.heroes.onCreated?.(made, input);
    const p = st();
    // In an adventure a made hero starts the adventure again, with the kit the adventure gives that class.
    const running = adventureOf(p);
    const entry = running ? benchAdventures().find((e) => e.adventure === running) : undefined;
    if (running && entry) return beginAdventure(entry, input ? adventureHeroFromCreator(running, made, input) : made);
    const id = made.archetypeId as ArchetypeId;
    const sheet = made.appearanceAssetId === bodySpriteId(id) ? made : { ...made, appearanceAssetId: bodySpriteId(id) };
    session.play = newPlay(p.template, id, ROOM_FLOOR[p.template], undefined, sheet, p.room);
    carry(p, session.play, "a new character began");
    newScene();
    story({ text: `${sheet.name} steps into the room.`, tone: "plain" });
  }

  function openCreationView(): void {
    if (overlayOpen()) return;
    const p = st();
    const running = adventureOf(p);
    creationView = openCreation(
      stageWrap,
      { style: () => textStyle, rollDice: rollScoreDice, portrait },
      {
        start: running ? creatorStartFor(running, p.archetypeId) : { archetypeId: p.archetypeId },
        onBegin: (sheet, input) => {
          creationView = null;
          beginCharacter(sheet, input);
        },
        onCancel: () => {
          creationView = null;
          viewsChanged();
        },
      },
    );
    viewsChanged();
  }

  // ---- the adventure: the start screen, its heroes, moving between places, the story's cards ----------------------
  //
  // The Play tab opens on the start screen (overlay.ts startScreen): the owner's adventures, the test rooms, and the AI writer. An adventure
  // goes to the hero screen (a quick start for a class, or the character creator with the adventure's kit), then the game begins at the
  // adventure's start. The story is progress.ts (the adventure is gospel): the game tells it what happened, it says what that did.

  function closeScreens(): void {
    const screens = [startScr, heroScr, endScr];
    startScr = null;
    heroScr = null;
    endScr = null;
    for (const s of screens) s?.close();
  }

  const ROOM_SUMMARY: Record<RoomChoice, string> = {
    one: "A two-room test scene: a door, a chest and one goblin asleep in the east room. No story, for trying the rules.",
    two: "The same two rooms with a goblin and a skeleton, each with its own hit points, dice and turn. No story.",
  };

  function showStart(): void {
    closeViews();
    closeScreens();
    session.atStart = true;
    startScr = overlay.startScreen({
      adventures: startCardsFor(benchAdventures()),
      sandboxes: ROOM_CHOICES.map((r) => ({ id: `room:${r}`, title: roomLabel(st().template, r), summary: ROOM_SUMMARY[r] })),
      aiNote: AI_ADVENTURE_COST_NOTE,
      onPick: (id) => pickStart(id),
      onWrite: (premise) => void writeNewAdventure(premise),
    });
    viewsChanged();
  }

  function pickStart(id: string): void {
    if (id.startsWith("room:")) {
      const room = id.slice(5) as RoomChoice;
      if (ROOM_CHOICES.includes(room)) startSandbox(room);
      return;
    }
    const entry = benchAdventures().find((e) => e.id === id && e.adventure);
    if (entry) showHero(entry);
  }

  /**
   * The AI writer. Called only by the start screen's "Yes, write it" (the confirm is the screen's own), once per press. It asks the model through
   * the sample capability (the complex tier: a whole adventure is long and costs a lot; no cache, a repeat must be fresh), with the engine's
   * writeAdventure checking every answer and sending the problems back for a repair. Cancel (or leaving the tab) stops the call in flight. A
   * finished adventure joins the start screen as "AI written" and is kept in this browser; a failure says why, in plain words, and keeps nothing.
   */
  async function writeNewAdventure(premise: string): Promise<void> {
    const screen = startScr;
    if (!screen) return;
    const sample = peekSample() ?? sampleFn;
    if (!sample) {
      screen.setWriting(null);
      if (sampleState === "pending") overlay.toast("The DM is still waking. Try again in a moment.");
      else screen.setProblems([host.dm.writerUnavailable ?? `${host.dm.unavailable} Nothing was sent.`]);
      return;
    }
    const ctl = new AbortController();
    writerCtl?.abort();
    writerCtl = ctl;
    const cancel = (): void => ctl.abort();
    const complete = (input: CompleteInput): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        if (ctl.signal.aborted) return reject(new Error("The writer was stopped."));
        const onAbort = (): void => reject(new Error("The writer was stopped."));
        ctl.signal.addEventListener("abort", onAbort, { once: true });
        const done = (): void => ctl.signal.removeEventListener("abort", onAbort);
        try {
          sample(input, { modelTier: "complex", cache: false, signal: ctl.signal }).then(
            (r) => {
              done();
              resolve(typeof r?.text === "string" ? r.text : "");
            },
            (e: unknown) => {
              done();
              reject(new Error(writerFailureWords(e)));
            },
          );
        } catch (e) {
          done();
          reject(new Error(writerFailureWords(e)));
        }
      });
    screen.setWriting({ stage: "Starting the writer", canCancel: true }, cancel);
    let result: Awaited<ReturnType<typeof writeAiAdventure>>;
    try {
      result = await writeAiAdventure(complete, { premise, length: "short" }, writerContext(), {
        onProgress: (stage) => {
          if (alive && startScr && !ctl.signal.aborted) startScr.setWriting({ stage, canCancel: true }, cancel);
        },
      });
    } catch (e) {
      result = { ok: false, errors: [`The writer could not finish: ${writerFailureWords(e)}`] };
    }
    if (writerCtl === ctl) writerCtl = null;
    if (!alive) return;
    const now = startScr;
    if (ctl.signal.aborted) {
      now?.setWriting(null);
      overlay.toast("Stopped. Nothing was kept.");
      return;
    }
    if (!result.ok) {
      now?.setWriting(null);
      now?.setProblems([...result.errors, "Nothing was kept. You can try again, or change the idea."]);
      return;
    }
    const entry = registerAiAdventure(result.markdown);
    if (!entry.adventure) {
      now?.setWriting(null);
      now?.setProblems([...entry.problems, "Nothing was kept. You can try again, or change the idea."]);
      return;
    }
    // The new card is on the list (the AI written pill) and stays there on later visits; the start screen is built again to show it.
    if (now) showStart();
    overlay.toast(`"${entry.title}" is ready, written by the AI. It is on the list and kept in this browser.`);
  }

  /** What the AI writer needs to know: the pictures and creatures the game has, and the format by example (adventures/TEMPLATE.md). */
  function writerContext(): AdventureWriterContext {
    const template = host.adventures.files().find((f) => f.file === TEMPLATE_FILE)?.text ?? "";
    return { assets: adventureAssets(), creatures: BESTIARY.map((b) => b.id), template };
  }

  /** A sample failure in plain words (raw provider text is never shown). */
  function writerFailureWords(e: unknown): string {
    const code = isRec(e) && typeof e.code === "string" ? e.code : "";
    if (code === "not_granted") return "Claude has not been allowed to write for you here.";
    if (code === "rate_limited") return "Claude needs a moment. Try again shortly.";
    if (code === "cancelled") return "The writer was stopped.";
    return "Claude could not answer.";
  }

  /** After an adventure is picked: a quick start for each class that can be played (the adventure's own hook and kit for it), or the creator. */
  function showHero(entry: BenchAdventure): void {
    const a = entry.adventure;
    if (!a) return;
    closeViews();
    closeScreens();
    heroScr = overlay.startHero({
      adventureTitle: a.title,
      hooks: heroIds.map((id): StartHeroHook => {
        const chassis = getArchetype(id).chassis;
        return { chassis, label: ARCHETYPE_LABEL[id], hook: heroHook(a, chassis) ?? a.summary, kit: kitWords(startingKitFor(a, chassis)) };
      }),
      onCreate: () => openAdventureCreation(entry),
      onQuick: (chassis) => {
        const id = heroIds.find((h) => getArchetype(h).chassis === chassis);
        if (id) beginAdventure(entry, adventureHero(a, id));
      },
      onBack: () => showStart(),
    });
    viewsChanged();
  }

  /** The character creator, started from the adventure's kit for the first class (it is built again with the kit of the class that was picked). */
  function openAdventureCreation(entry: BenchAdventure): void {
    const a = entry.adventure;
    if (!a) return;
    closeScreens();
    creationView = openCreation(
      stageWrap,
      { style: () => textStyle, rollDice: rollScoreDice, portrait },
      {
        start: creatorStartFor(a, heroIds[0]!),
        onBegin: (sheet, input) => {
          creationView = null;
          beginAdventure(entry, adventureHeroFromCreator(a, sheet, input));
        },
        onCancel: () => {
          creationView = null;
          viewsChanged();
          showHero(entry);
        },
      },
    );
    viewsChanged();
  }

  /** A test room: nothing but the rules. The hero stays the one picked in the bench's Hero setting. */
  function startSandbox(room: RoomChoice): void {
    closeViews();
    closeScreens();
    session.roomChoice = room;
    const old = st();
    session.play = newPlay("fantasy", old.archetypeId, ROOM_FLOOR.fantasy, undefined, undefined, room);
    carry(old, session.play, "a test room was started");
    session.atStart = false;
    newScene();
  }

  // The place's card and the scene's card come one after the other (each is up for a reading time), never over each other.
  let locationUntil = 0;
  let sceneTimer: ReturnType<typeof setTimeout> | null = null;
  function dropPendingCards(): void {
    if (sceneTimer !== null) clearTimeout(sceneTimer);
    sceneTimer = null;
    locationUntil = 0;
  }
  function showLocationCard(card: { name: string; readAloud: string }): void {
    overlay.locationCard(card);
    // The scene's card follows once the place's has had a reading (at most seven seconds); the first stays up its own time, so both are on the board for a while.
    locationUntil = performance.now() + Math.min(7000, locationHoldMs(card.readAloud.length));
  }
  function showSceneCard(card: { title: string; opening?: string }): void {
    if (sceneTimer !== null) clearTimeout(sceneTimer);
    sceneTimer = null;
    const wait = locationUntil - performance.now();
    if (wait <= 0) return overlay.sceneCard(card);
    sceneTimer = setTimeout(() => {
      sceneTimer = null;
      if (alive) overlay.sceneCard(card);
    }, wait + 200);
  }

  /** A new game of an adventure with this hero: a checkpoint, the place's name and read-aloud, the first scene's opening, and a fight at once when something awake and hostile is there. */
  function beginAdventure(entry: BenchAdventure, sheet: CharacterSheet): void {
    const a = entry.adventure;
    if (!a) return;
    closeViews();
    closeScreens();
    const old = session.play;
    session.play = newAdventurePlay(a, sheet);
    // The scene keeps the Room setting as it was (the Room control is off in an adventure, but a save and the export carry it).
    session.play.room = session.roomChoice;
    session.atStart = false;
    carry(old, session.play, `began ${a.title}`);
    const p = st();
    const hook = heroHook(a, sheet.chassis);
    if (hook) {
      p.storyRecent = [hook];
      p.log.push({ text: hook, tone: "plain" });
    }
    newScene();
    const loc = currentLocation(p);
    const scene = p.progress ? sceneOf(a, p.progress.sceneId) : undefined;
    if (loc) showLocationCard({ name: loc.name, readAloud: loc.readAloud });
    if (scene) showSceneCard({ title: scene.title, ...(scene.opening ? { opening: scene.opening } : {}) });
    flushAdventure();
    void arrivalFight();
  }

  /** Anything awake and hostile where the hero has just arrived starts the fight at once; a sleeper that notices them joins it. */
  async function arrivalFight(): Promise<void> {
    const p = st();
    if (!p.round && awakeHostiles(p).length > 0) await beginFight(false, []);
    await afterHeroAction();
  }

  /** What the story did since it was last shown: beats on the strip, objectives in the notice and the Log, a new scene's card, an ending. */
  function flushAdventure(): void {
    const p = st();
    const a = adventureOf(p);
    if (!a) return;
    syncItems(p);
    // What the story tells the player now, in one box (a find's secret first, then each beat that fired, in order).
    const told: string[] = [...pendingTell];
    pendingTell.length = 0;
    while (p.adventurePending.length > 0) {
      const r = p.adventurePending.shift()!;
      for (const b of r.fired) if (b.narrate) told.push(b.narrate);
      for (const o of r.completed) {
        p.log.push({ text: `Objective done: ${o.text}`, tone: "good" });
        hud.notice(`Done: ${o.text}`, "good");
      }
      if (r.sceneChanged) {
        if (r.ended) showEnding(a, r.sceneChanged.to, r.ended);
        else {
          const scene = sceneOf(a, r.sceneChanged.to);
          showSceneCard({ title: scene?.title ?? "", ...(r.sceneChanged.opening ? { opening: r.sceneChanged.opening } : {}) });
        }
      }
    }
    if (told.length > 0) {
      overlay.narrate({ text: told.join(" "), full: true }).done();
      for (const line of told) p.log.push({ text: line, tone: "dm" });
    }
    flushLog();
  }

  /** The adventure's own words waiting to be told with the next flush (the secret of something just searched). */
  const pendingTell: string[] = [];

  /** The ending's text over the board: Continue keeps playing in place (the story is over, the world is still there), Back to the start screen leaves. */
  function showEnding(a: Adventure, sceneId: string, ending: NonNullable<AdventureStepResult["ended"]>): void {
    endScr?.close();
    endScr = overlay.endingCard({
      title: sceneOf(a, sceneId)?.title ?? a.title,
      text: ending.text,
      outcome: ending.outcome,
      onContinue: () => {
        endScr?.close();
        endScr = null;
        renderHud();
      },
      onMenu: () => {
        closeScreens();
        showStart();
      },
    });
    renderHud();
  }

  /** Go through a way out: only on a quiet board and when the story lets it be taken (otherwise its own words say why). The place is built, the hero arrives, a checkpoint is saved and the place's card is shown. */
  async function useExit(here: ExitHere): Promise<void> {
    const p = st();
    const a = adventureOf(p);
    if (!a || !p.progress) return;
    if (heroDown(p)) return refuse(DOWN_NOTE);
    if (p.round) return refuse("You cannot leave in the middle of a fight.");
    if (!exitIsOpen(p, here.exit)) return refuse(exitLockedWords(here.exit));
    const dest = exitDestination(a, p.progress.locationId, here.exit.id);
    const target = dest ? locationOf(a, dest.locationId) : undefined;
    if (!dest || !target) return refuse("That way leads nowhere the adventure has a place for.");
    busy = true;
    walkQueue.length = 0;
    onArrive = null;
    steppedOnExit = null;
    clearOptions();
    closeLoot();
    p.log.push({ text: `You go through: ${here.exit.label}.`, tone: "plain" });
    if (!enterLocation(p, dest.locationId, dest.at)) {
      busy = false;
      return refuse("The story has no such place.");
    }
    overlay.clear();
    dropPendingCards();
    hover = null;
    previewed = null;
    marksKey = "";
    stage.snapCamera();
    stage.invalidate();
    addSavePoint(p, "checkpoint", `arrived: ${target.name}`);
    showLocationCard({ name: target.name, readAloud: target.readAloud });
    busy = false;
    skipping = false;
    flushAdventure();
    refreshAll();
    await arrivalFight();
  }

  /** The adventure's own words for a feature of the place: its name and what anyone sees (a found secret is said once, when it is found). */
  function showFeature(f: AdventureFeature): void {
    const p = st();
    const searched = featureSearchable(f) && featureIsFound(p, f);
    story({ speaker: f.name, text: `${f.description}${searched ? " You have already searched it." : ""}`, tone: "plain" });
    refreshAll();
  }

  /** What Use, a click or the menu's Search does to a feature beside the hero: look at it, or search it (the check is thrown in the tray). */
  async function featureFlow(at: XY): Promise<void> {
    const p = st();
    const f = featureAtSquare(p, at);
    if (!f) return;
    if (tileDistance(p.heroAt, at) > 1) return refuse("Too far away. Step next to it.");
    if (!featureSearchable(f) || featureIsFound(p, f)) return showFeature(f);
    await searchFeature(f);
  }

  /** Hand a feature's find to the hero: an adventure item as the adventure describes it (quest flag and all), anything else as a plain thing in the pack. */
  function handOver(p: PlayState, f: AdventureFeature, give: string): void {
    const a = adventureOf(p)!;
    const item = itemOf(a, give);
    if (item) return giveAdventureItem(p, item);
    if (p.hero.inventory.some((n) => foldItem(withoutCount(n)) === foldItem(give))) return;
    p.hero = { ...p.hero, inventory: [...p.hero.inventory, give] };
    const money = /coin|copper|silver|gold|pieces|purse/i.test(give);
    p.itemNotes[give] = `Found in ${f.name.toLowerCase()}.${money ? " The game does not track money yet, so it is only something you carry." : ""}`;
    p.log.push({ text: `You now carry ${give}.`, tone: "good", notice: `+ ${give}` });
  }

  /**
   * Search a feature. With a DC the engine rolls the better of Perception and Investigation in the tray (the hero's real modifier against the
   * adventure's number); without one the secret is simply found. A failure says so and can be tried again. A find is said once on the strip,
   * the items it gives go in the pack, and the story hears of them (a quest item can finish an objective or fire a beat).
   */
  async function searchFeature(f: AdventureFeature): Promise<void> {
    const p = st();
    if (heroDown(p)) return refuse(DOWN_NOTE);
    if (p.round) return refuse("Not in the middle of a fight. Finish it first.");
    clearOptions();
    busy = true;
    let found = true;
    if (f.searchDc !== undefined) {
      const dc = f.searchDc;
      const skill = skillModifierFor(p.hero, "Investigation") > skillModifierFor(p.hero, "Perception") ? "Investigation" : "Perception";
      const out = skillCheck({ sheet: p.hero, skill, dc, rng: tableRng });
      await rollStep(`Tap to roll ${skill}`, out.dice, `${skill} ${out.roll} ${signedNum(out.modifier)} = ${out.total} vs DC ${dc}`, out.success ? "YOU FIND SOMETHING" : "NOTHING YET", out.success ? "good" : "bad", { modifier: out.modifier, total: out.total, target: dc });
      if (!alive || st() !== p) return;
      p.log.push({ text: `Searching ${f.name.toLowerCase()}: ${out.line}`, tone: out.success ? "good" : "bad" });
      found = out.success;
    }
    if (!found) {
      story({ text: `You search ${f.name.toLowerCase()} and find nothing yet. You can search it again.`, tone: "plain" });
      busy = false;
      flushLog();
      refreshAll();
      return;
    }
    p.featuresFound.push(featureKey(p, f));
    pendingTell.push(f.secret ?? `You find something in ${f.name.toLowerCase()}.`);
    for (const g of f.gives ?? []) handOver(p, f, g);
    busy = false;
    flushLog();
    flushAdventure();
    refreshAll();
    await afterHeroAction();
  }

  /** The text the ask box opens with. Returns false (and says why) when the box is off: no DM here, or the sheet is open. */
  function prefillAsk(text: string): boolean {
    const input = trayCol.querySelector<HTMLInputElement>("input.lto-hud-input");
    if (!input) return false;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (input.disabled) {
      refuse(dmStatus ?? NO_DM);
      return false;
    }
    input.focus({ preventScroll: true });
    input.setSelectionRange(text.length, text.length);
    return true;
  }

  /**
   * A person of the adventure: the ask box opens on "I talk to <name>: ". What is said goes to the DM as a freehand ask for THAT person (their id
   * rides in the ask), so the DM answers in their voice from their entry and says it set talkedTo; the engine then records the talk event.
   * With no DM to ask (off claude.ai) the person says only what the adventure says they know, and the talk is recorded the same way.
   */
  function talkTo(c: Creature): void {
    const p = st();
    const a = adventureOf(p);
    const npc = a ? npcOf(a, c.adv?.npc) : undefined;
    const name = npc?.name ?? creatureName(p, c);
    if (npc && sampleState === "none" && !peekSample()) return talkWithoutDm(p, npc);
    if (prefillAsk(`I talk to ${name}: `) && npc) talkTarget = npc.id;
  }

  /**
   * No DM here: the person tells the party what the adventure lists under "knows", word for word and said to be that (not a voice the DM gave
   * them), and the talk is recorded, so the adventure can be finished without the DM. What they keep secret stays secret.
   */
  function talkWithoutDm(p: PlayState, npc: AdventureNpc): void {
    const told = npc.knows.length > 0 ? npc.knows.join(" ") : "They have nothing to tell you.";
    const words = `${npc.name}, ${npc.role}. There is no DM to give them a voice here, so this is only what the adventure says they will tell you: ${told}`;
    overlay.narrate({ text: words, full: true }).done();
    p.log.push({ text: words, tone: "plain" });
    const r = advApply(p, { type: "talk", npc: npc.id });
    if (r?.refused) p.log.push({ text: sentence(`Not recorded: ${r.refused}`), tone: "plain" });
    flushAdventure();
    refreshAll();
  }

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
    const a = headAnchor(layout, "who", host.art.render(p.template), tileScale());
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
    /** An adventure: walk up to a person and open the ask box on them. */
    | { kind: "talk"; path: XY[]; costFt: number; tile: XY }
    /** An adventure: walk up to a feature of the place and search it (or look at it). */
    | { kind: "feature"; path: XY[]; costFt: number; tile: XY }
    /** An adventure: the way out the hero stands on. */
    | { kind: "exit"; path: XY[]; costFt: number; tile: XY }
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
    // A creature that is not hostile (a villager, a shopkeeper): a click walks up to it and looks closer (the DM answers). In an adventure it is a person to talk to.
    if (there && creatureInSight(p, there)) {
      const kind = p.adventureId ? "talk" : "look";
      if (tileDistance(p.heroAt, tile) <= 1) return { kind, path: [], costFt: 0, tile };
      const spot = approachTile(field, tile, 1);
      const path = spot ? pathTo(field, spot) : null;
      if (!path) return { kind: "none", tile, reason: p.round ? "Too far to reach this turn." : "You cannot get next to it from here." };
      return { kind, path, costFt: cost(path), tile };
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
    // An adventure's place: a feature to search (until its secret is found) or look at, and the exits.
    if (p.adventureId) {
      const feature = featureAtSquare(p, tile);
      const way = exitOn(p, tile);
      // A feature is looked at or searched; on a square that is also a way out (the sacks over the tunnel mouth) it is searched until its secret is found, then walked onto.
      if (feature && (!way || (featureSearchable(feature) && !featureIsFound(p, feature)))) {
        if (tileDistance(p.heroAt, tile) <= 1) return { kind: "feature", path: [], costFt: 0, tile };
        const spot = approachTile(field, tile, 1);
        const path = spot ? pathTo(field, spot) : null;
        if (!path) return { kind: "none", tile, reason: p.round ? "Too far to reach this turn." : "You cannot get next to it from here." };
        return { kind: "feature", path, costFt: cost(path), tile };
      }
      if (way) {
        if (!exitIsOpen(p, way.exit)) return { kind: "none", tile, reason: exitLockedWords(way.exit) };
        if (same(tile, p.heroAt)) return { kind: "exit", path: [], costFt: 0, tile };
      }
    }
    const isDoor = same(tile, doorAt(p));
    const isChest = same(tile, containerAt(p));
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
    const key = [canvas.width, canvas.height, ts, busy, walkQueue.length, p.heroAt.x, p.heroAt.y, p.creatures.map((c) => `${c.at.x},${c.at.y},${creatureInSight(p, c) ? 1 : 0},${c.prone ? 1 : 0},${c.hostile ? 1 : 0}`).join(";") || "-", p.exploredRev, p.worldRev, p.boardEpoch, p.doorOpen, p.doorLocked, p.searched, p.round ? `${p.round.activeIndex},${p.round.roundNumber},${activeCombatant(p.round)?.economy.movementRemaining},${activeCombatant(p.round)?.economy.action}` : "x", hover ? `${hover.x},${hover.y}` : "-", heroDown(p), lootSig].join("|");
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
    const colour = plan.kind === "attack" ? "rgba(255, 120, 90, 0.95)" : plan.kind === "use" || plan.kind === "loot" || plan.kind === "feature" || plan.kind === "exit" ? "rgba(255, 205, 90, 0.95)" : plan.kind === "look" || plan.kind === "talk" ? "rgba(170, 215, 255, 0.95)" : "rgba(255, 245, 210, 0.95)";
    ctx.fillStyle = colour;
    for (const t of plan.path) {
      ctx.beginPath();
      ctx.arc((t.x + 0.5) * ts, (t.y + 0.5) * ts, Math.max(2, ts / 10), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(2, ts / 14);
    ctx.strokeRect(plan.tile.x * ts + 3, plan.tile.y * ts + 3, ts - 6, ts - 6);
    const featureVerb = plan.kind === "feature" ? (() => { const f = featureAtSquare(p, plan.tile); return f && featureSearchable(f) && !featureIsFound(p, f) ? "search" : "look"; })() : "";
    const words =
      plan.kind === "attack" ? (plan.costFt ? `${plan.costFt} ft, attack` : "Attack")
      : plan.kind === "loot" ? (plan.costFt ? `${plan.costFt} ft, search` : "Search")
      : plan.kind === "use" ? (plan.costFt ? `${plan.costFt} ft, use` : "Use")
      : plan.kind === "look" ? (plan.costFt ? `${plan.costFt} ft, look` : "Look closer")
      : plan.kind === "talk" ? (plan.costFt ? `${plan.costFt} ft, talk` : "Talk")
      : plan.kind === "feature" ? (plan.costFt ? `${plan.costFt} ft, ${featureVerb}` : featureVerb === "search" ? "Search" : "Look")
      : plan.kind === "exit" ? "Go through"
      : `${plan.costFt} ft`;
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
      if (skipping || reducedMotion) return resolve();
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
      session.log.archive(p.log.slice(0, p.log.length - LOG_KEEP));
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
    if (reducedMotion) return;
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
        if (!reducedMotion) playClips(m.actor, ["attack"], performance.now());
        await wait(320);
        const hpBefore = p.hero.currentHp;
        p.hero = turn.sheet;
        showAttack(swing, "hero");
        const now = performance.now();
        if (!reducedMotion && p.hero.currentHp < hpBefore) playClips(p.heroActor, [heroDown(p) ? "death" : "hit"], now);
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
    // The walk ended on a way out (and nothing woke): the hero goes through it.
    if (steppedOnExit && !st().round && same(steppedOnExit, st().heroAt)) {
      const way = exitOn(st(), st().heroAt);
      steppedOnExit = null;
      if (way) await useExit(way);
    }
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
    const out = stealthCheck({ sheet: p.hero, observers: watchers.map((c) => ({ id: c.id, passivePerception: creaturePassive(c), name: creatureLabel(p, c) })), rng: tableRng });
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

  /** The way out the hero's last step landed on (adventure only): taken once the walk is over, never as a square passed through. */
  let steppedOnExit: XY | null = null;

  /** One square of a walk (a click's path, or a key). False when it was refused, which ends the walk. */
  function takeStep(to: XY): boolean {
    const p = st();
    const from = { ...p.heroAt };
    steppedOnExit = null;
    const r = heroStepTo(p, to);
    if (r.refused) {
      refuse(r.refused);
      return false;
    }
    if (exitOn(p, to)) steppedOnExit = { ...to };
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
    // The story hears about items that came or went, and plays out what it did (cards, the strip, the journal) once the table is free.
    if (!busy && st().adventureId) flushAdventure();
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
    if (!reducedMotion) playClips(p.heroActor, ["attack"], performance.now());
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
    if (!reducedMotion && alive && hit) playClips(m.actor, m.prone ? ["hit", "death"] : ["hit"], now);
    const talk = barksFor(m.token);
    if (alive && talk && hit && Math.random() < 0.6) story({ speaker: creatureName(p, m), text: bark(talk.hurt), tone: "good" });
    if (alive && talk && !hit && Math.random() < 0.6) story({ speaker: creatureName(p, m), text: bark(talk.dodge), tone: "bad" });
    if (!alive && !reducedMotion) playClips(p.heroActor, ["cheer"], now + 400);
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
          : plan.kind === "talk"
            ? async () => {
                const who = creatureAt(st(), plan.tile);
                if (who) talkTo(who);
              }
          : plan.kind === "feature"
            ? async () => {
                await featureFlow(plan.tile);
              }
          : plan.kind === "exit"
            ? async () => {
                const way = exitOn(st(), plan.tile);
                if (way) await useExit(way);
              }
          : plan.kind === "use"
            ? async () => {
                const r = heroInteractRules(st());
                if (r.refused) return refuse(r.refused);
                clearOptions();
                if (!reducedMotion) playClips(st().heroActor, ["interact"], performance.now());
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
    // An adventure's place: go through the way out underfoot, search or look at what is beside the hero, else search a body or a pile.
    if (p.adventureId) {
      const u = advUseFor(p);
      if (u?.kind === "exit") return useExit(u.exit);
      if (u?.kind === "feature") return featureFlow(u.at);
      const loot = lootNear(p);
      if (loot) return openLootAt(loot.kind === "body" ? loot.body.at : loot.at);
      return refuse("Nothing to use here. Stand on a way out, or next to something you can search.");
    }
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
    if (!reducedMotion) playClips(p.heroActor, ["interact"], performance.now());
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
    if (!reducedMotion) playClips(p.heroActor, ["cheer"], performance.now());
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
    const save = session.saves.find(id);
    if (!save) return refuse("There is no save to load.");
    const restored = fromSnapshot(save.data);
    if (!restored) return refuse("That save could not be read.");
    closeScreens();
    session.atStart = false;
    // A number the sight and tile caches have never seen under this scene's name (they key on it).
    restored.worldRev = Math.max(st().worldRev, restored.worldRev) + 1;
    const words = saveLabel(save);
    carry(st(), restored, `loaded: ${words}`);
    session.play = restored;
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
    // An adventure starts again from its beginning, as the hero began.
    const running = adventureOf(p);
    const entry = running ? benchAdventures().find((e) => e.adventure === running) : undefined;
    if (running && entry) return beginAdventure(entry, p.start);
    closeScreens();
    session.atStart = false;
    session.play = newPlay(p.template, p.archetypeId, p.floorId, p.hero, p.start, p.room);
    carry(p, session.play, "the scene was reset");
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
  /** The person of the adventure the hero walked up to and chose to talk to (their adventure id): the next freehand ask is for them. */
  let talkTarget: string | null = null;
  /** The adventure brief the DM was last given (the debug export keeps it); null before the first ask of a game. */
  let lastBrief: string | null = null;
  /** The AI writer's call in progress, so Cancel (and leaving the tab) can stop it. */
  let writerCtl: AbortController | null = null;
  /** The call in progress (a turn that is being asked for or played); null when the table is free. */
  let dmCtl: AbortController | null = null;
  /** True only while waiting on the model: the Cancel button shows. `busy` covers the whole turn. */
  let dmThinking = false;
  const NO_DM = host.dm.unavailable;

  /** A stand-in sampler the host can answer at once (the bench's test hook): asked before the capability on every ask. */
  const peekSample = (): SampleFn | null => host.dm.peek?.() ?? null;

  /** Once per mount, after the first paint: the host says whether there is a DM to ask, and the ask field says so when there is not. */
  async function loadSample(): Promise<void> {
    const hook = peekSample();
    if (hook) {
      sampleFn = hook;
      sampleState = "ready";
      return;
    }
    try {
      const found = await host.dm.sample();
      if (!alive) return;
      if (found) {
        sampleFn = found;
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
    if (overlayOpen()) return { enabled: false, status: screenOpen() ? "Choose how to begin." : "Close the sheet to act." };
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
    // A feature of an adventure's place is described by the adventure, in its own words; the DM is for what the adventure does not say.
    const feature = p.adventureId ? featureAtSquare(p, at) : undefined;
    if (feature) return showFeature(feature);
    void runDm({ kind: "examine", at: { ...at }, what: whatIsAt(p, at) });
  }

  /** The adventure's people standing on this board: their ids, their adventure names and where they are. */
  function npcsOnBoard(p: PlayState): { id: string; name: string; at: XY }[] {
    return dmAdventureView(p)?.npcsHere ?? [];
  }

  /** Whether a name is spoken in some words: the whole name, or its first word when that is a name (Tobin Hale: "Tobin"), as a word of its own. */
  function mentions(text: string, name: string): boolean {
    const t = text.toLowerCase();
    const parts = [name.toLowerCase(), name.toLowerCase().split(/\s+/)[0] ?? ""].filter((w) => w.length >= 3);
    return parts.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[^a-z0-9 ]/g, "")}([^a-z]|$)`).test(t));
  }

  /**
   * An ask in an adventure, with the person it is for: the one the hero walked up to and chose to talk to (the ask box was opened on them), else
   * the only person of the adventure whose name the words use. The DM then answers in that person's voice and says it set talkedTo. Words that
   * speak to nobody go as they are.
   */
  function askWithPerson(p: PlayState, ask: DmAsk): DmAsk {
    if (ask.kind !== "freehand" || ask.npc || !adventureOf(p)) return ask;
    const here = npcsOnBoard(p);
    const target = talkTarget ? here.find((n) => n.id === talkTarget) : undefined;
    talkTarget = null;
    const named = here.filter((n) => mentions(ask.text, n.name));
    // The person the box was opened on, as long as the words are still for them ("I talk to ..." kept, or their name used) and do not name somebody
    // else; failing that, the one person the words name. Words about something else (the box was cleared and the hero searches a barrel) are for nobody.
    const stillTalking = /^\s*I (talk|speak) (to|with)\b/i.test(ask.text);
    const who = target && ((named.length === 0 && stillTalking) || named.some((n) => n.id === target.id)) ? target : named.length === 1 ? named[0] : undefined;
    return who ? { ...ask, npc: { id: who.id, name: who.name } } : ask;
  }

  /** One DM turn: ask, then play the reply. The table is busy from the ask to the last effect. */
  async function runDm(first: DmAsk): Promise<void> {
    if (dmCtl || busy) return;
    const p = st();
    const ask = askWithPerson(p, first);
    if (heroDown(p)) return refuse(DOWN_NOTE);
    if (p.round && !isPlayersTurn(p.round)) return refuse("Wait for your turn.");
    const sample = peekSample() ?? sampleFn;
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
    lastBrief = view.adventure?.brief ?? null;
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
    // The story may have brought something awake and hostile onto the board (a beat's spawn): the fight starts at once, as on arrival.
    else if (adventureOf(p) && !p.round && awakeHostiles(p).length > 0) await beginFight(false, []);
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
      if (!reducedMotion) playClips(p.heroActor, [heroDown(p) ? "death" : "hit"], performance.now());
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
      const rolled = rollDice(e.dice, tableRng);
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
        // A story step, or an adventure item handed over: whatever the story did with it (a beat, an objective, a new scene, an ending) is shown now.
        if (p.adventureId) flushAdventure();
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
      const mine = skillCheck({ sheet: p.hero, skill: mySkill, dc: 0, ...(c.advantage ? { advantage: c.advantage } : {}), rng: tableRng });
      const theirRoll = rollDie(20, tableRng);
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
    // The hero spoke with somebody of the adventure: the story hears of it (the engine records it, never the DM's say-so alone: the id was checked
    // against the people standing here when the DM was asked, and the story refuses a person it does not have).
    if (!stale() && reply.talkedTo !== undefined) {
      const r = advApply(p, { type: "talk", npc: reply.talkedTo });
      const who = adventureOf(p)?.npcs.find((n) => n.id === reply.talkedTo)?.name ?? reply.talkedTo;
      if (!r || r.refused) {
        const why = r?.refused ?? "there is no adventure running";
        refusedNotes.push(why);
        refusedLog.push(`talked to ${who}: ${why}`);
      } else {
        appliedLog.push(`talked to ${who}`);
        flushAdventure();
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
    if (peekSample() || sampleState === "ready") return null;
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
    if (same(at, doorAt(p))) return { target: { kind: "door", id: "door", name: kit.doorLabel, distanceTiles, inSight, door: { open: p.doorOpen, locked: p.doorLocked, lockDc: p.doorLockDc } } };
    if (same(at, containerAt(p))) return { target: { kind: "chest", id: "container", name: kit.containerLabel, distanceTiles, inSight, searched: p.searched } };
    // A feature of the adventure's place: one with a secret to find is a thing to search (the Search line), any other only to look at.
    const feature = featureAtSquare(p, at);
    if (feature) {
      const name = advPropWords(p, at) ?? feature.name;
      return featureSearchable(feature)
        ? { target: { kind: "chest", id: feature.id, name, distanceTiles, inSight, searched: featureIsFound(p, feature) } }
        : { target: { kind: "prop", id: feature.id, name, distanceTiles, inSight } };
    }
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
    // In an adventure: talking to a person opens the ask box on them, and Search on a feature is the engine's own check, not a DM answer.
    if (id === "talk" && st().adventureId) {
      const who = creatureAt(st(), tile);
      if (who && !who.hostile) return talkTo(who);
    }
    if (id === "search" && st().adventureId && featureAtSquare(st(), tile)) return void featureFlow(tile);
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
    const path = pushDestination(engineLayout(p), worldManifest(p.template), m.at, p.heroAt, squares);
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
    const out = shoveContest({ attacker: p.hero, target: { ...monsterShoveProfile(foe.token), name: creatureLabel(p, foe) }, mode, rng: tableRng });
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
    if (!reducedMotion) playClips(p.heroActor, ["attack"], performance.now());
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
    const out = stealthCheck({ sheet: p.hero, observers: watchers, rng: tableRng });
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
    const pick = pocketPick(m.carried, tableRng);
    if (!pick.item) return refuse("It has nothing in its pockets you could lift.");
    const pp = creaturePassive(m);
    const out = sleightOfHand({ sheet: p.hero, targetPassivePerception: pp, rng: tableRng });
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
    const out = force ? forceDoor({ sheet: p.hero, dc, rng: tableRng }) : pickLock({ sheet: p.hero, dc, rng: tableRng });
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
    const out = skillCheck({ sheet: p.hero, skill: "Perception", dc: LISTEN_DC, rng: tableRng });
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

  /**
   * The adventure part of the export: which adventure (id, title, version, author, the file it came from), where the story stands (the
   * progress record, the scene, the place), the whole Markdown the adventure was read from (so a debug export can reproduce the run) and the
   * brief the DM was last given. Null in a test room.
   */
  function exportedAdventure(p: PlayState): BenchBundle["adventure"] {
    const a = adventureOf(p);
    if (!a || !p.progress) return null;
    const entry = benchAdventures().find((e) => e.adventure === a);
    return {
      id: a.id,
      title: a.title,
      version: a.version,
      author: a.author,
      file: entry?.file ?? "",
      progress: JSON.parse(JSON.stringify(p.progress)) as AdventureProgress,
      sceneId: p.progress.sceneId,
      locationId: p.progress.locationId,
      source: entry?.source ?? "",
      lastBrief: host.env.debugExport ? lastBrief : null,
    };
  }

  /** The bundle plus the adventure: the zip's adventure.json carries every field (the engine's file list is written from the bundle as it is). */
  type BenchBundle = AdventureBundle & {
    adventure: {
      id: string;
      title: string;
      version: number;
      author: "owner" | "ai";
      file: string;
      progress: AdventureProgress;
      sceneId: string;
      locationId: string;
      source: string;
      lastBrief: string | null;
    } | null;
  };

  /** The files of the zip: the engine's own list, and for an adventure its Markdown and the last brief on their own as readable text. */
  function exportFiles(bundle: BenchBundle): { name: string; data: string }[] {
    const files = adventureFiles(bundle);
    const ad = bundle.adventure;
    if (ad) {
      files.push({ name: "adventure-source.md", data: ad.source });
      files.push({ name: "dm-brief.txt", data: ad.lastBrief ?? "The DM has not been asked anything in this game yet.\n" });
    }
    return files;
  }

  function exportZip(bundle: BenchBundle, now: Date = new Date()): { filename: string; bytes: Uint8Array } {
    return { filename: adventureFilename(now), bytes: zipStore(exportFiles(bundle).map((f) => ({ name: f.name, data: f.data, modified: now }))) };
  }

  /** The whole adventure so far, as the export's bundle: the state, the sheet, the scene, every save, the full log, every DM exchange and every roll. */
  function adventureBundle(): BenchBundle {
    const p = st();
    const adventure = exportedAdventure(p);
    return {
      ...(adventure ? { notes: `Adventure: ${adventure.title} (${adventure.id}, version ${adventure.version}). adventure-source.md is the Markdown it was played from, dm-brief.txt is the brief the DM was last given, and adventure.json has the story's progress.` } : {}),
      adventure,
      format: ADVENTURE_FORMAT,
      version: ADVENTURE_VERSION,
      exportedAt: new Date().toISOString(),
      build: { ...host.env.build, userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent },
      settings: { art: host.art.signature(), textStyle, zoom: scale, rollMyself, diceSkin: tray.skin().id, reducedMotion, template: p.template },
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
      saves: [...session.saves.list()],
      log: [...session.log.lines, ...p.log].map((l) => ({ text: l.text, tone: l.tone })),
      dm: host.env.debugExport ? p.dmJournal : [],
      rolls: p.rollJournal,
    };
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
        built = exportZip(adventureBundle());
      } catch (err) {
        setExportStatus(`Could not build the export: ${err instanceof Error ? err.message : "unknown error"}. Try Copy adventure JSON.`, true);
        return;
      }
      const { filename, bytes } = built;
      const res = await host.files.save(filename, bytes);
      if (res.via === "capability") {
        if (res.declined) return setExportStatus("Not saved: you declined. Press Export again when you are ready.", false);
        return setExportStatus(res.status === "delivered" ? `Sent ${filename} (${kb(bytes.length)}).` : `Saved ${filename} (${kb(bytes.length)}).`, false);
      }
      if (res.status === "rate_limited") return setExportStatus("Another save prompt is still open. Answer it, then press Export again.", false);
      // A plain browser download (an object URL and a link) is the next best thing; whether the browser lets it through cannot be seen from here.
      setExportStatus(
        res.via === "browser"
          ? `${res.status === "capability_failed" ? "The save did not go through, so " : "Saving files is not available here, so "}${filename} (${kb(bytes.length)}) was offered as a plain browser download. If nothing was saved, press Copy adventure JSON.`
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
    const adv = adventureOf(p);
    const sceneName = adv && p.progress ? (sceneOf(adv, p.progress.sceneId)?.title ?? adv.title) : "";
    if (adv) lines.push(`At ${currentLocation(p)?.name ?? "the place"}`);
    if (heroDown(p)) title = "You are down";
    else if (!p.round) title = adv ? (p.progress?.ended ? `${adv.title}: finished` : sceneName) : foesLeft ? "Exploring" : downTitle(p);
    else if (mine) title = `Round ${p.round.roundNumber}: your turn`;
    else title = `Round ${p.round.roundNumber}: ${foeTurn?.seen ? `${creatureName(p, foeTurn).toLowerCase()}'s turn` : "something moves"}`;
    if (mine && c) {
      lines.push(`Move: ${c.economy.movementRemaining} ft left`, `Action: ${c.economy.action ? "ready" : "used"}`);
    } else if (!p.round && !heroDown(p)) {
      lines.push(foesLeft || adv ? "Click a square to walk" : "Open the chest, or Reset scene");
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
    const advUse = adv ? advUseFor(p) : null;
    const useDoor = adv ? advUse !== null : doorOrChestUsable(p);
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
      actions.push({ id: "load:last", label: "Load last save", key: "1", kind: "suggestion", enabled: free && !busy && session.saves.list().length > 0 });
      actions.push({ id: "reset", label: "Reset scene", key: "2", kind: "suggestion", enabled: free && !busy });
      actions.push({ id: "potion", label: `Potion x${p.potions}`, key: "Q", enabled: free && !busy, hidden: !canPotion });
    } else {
      actions.push(
        { id: "attack", label: "Attack", key: "F", enabled: free && !busy, hidden: !canAttack },
        { id: "use", label: advUse ? advUse.label : searchable ? "Search" : "Use", key: "E", enabled: free && !busy && myMove, hidden: !(near && myMove) },
        { id: "potion", label: `Potion x${p.potions}`, key: "Q", enabled: free && !busy, hidden: !canPotion },
        // The thing to press once the action is spent, or nothing is left to do.
        { id: "end", label: "End turn", key: "T", enabled: free && !busy && mine, hidden: !mine, emphasis: free && !busy && mine && (!actionLeft || (!moveLeft && !near)) },
        { id: "rest", label: "Rest", key: "R", enabled: free && !busy, hidden: restRefusal(p) !== null },
      );
    }
    actions.push({ id: "sheet", label: "Sheet", key: "C", enabled: creationView === null && !screenOpen() });
    // While the DM thinks, the one live button is Cancel (Escape does the same).
    if (dmThinking) actions.push({ id: "cancel", label: "Cancel", key: "Esc", enabled: true });
    // The DM's suggested next moves show only while the table is free (they are buttons that act when pressed).
    const options: HudOption[] = free && !busy && !down ? p.options.map((o, i) => ({ id: `opt:${i}`, label: o.label, key: String(i + 1) })) : [];
    const saveRows: HudSave[] = session.saves.list().map((s) => ({ id: s.id, label: saveLabel(s), detail: saveDetail(s), canLoad: free && !busy }));
    hud.render({ title, lines, bars, actions, ask: askStateFor(p), pack: { sections: packSections(p) }, options, log: p.log.map((l) => ({ text: l.text, tone: l.tone })), saves: saveRows, ...(adv ? { journal: journalFor(p) } : {}), ...(exportStatus ? { exportStatus } : {}), ...(exportCopyShown ? { exportCopy: true } : {}) });
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

  /** A gear change made outside the window (the bench's Worn, Pack and Armoury section): say why it was refused, and redraw. */
  function gearResult(outcome: GearOutcome): void {
    if (!outcome.ok) refuse(outcome.reason);
    flushLog();
    renderAll();
  }

  function refreshAll(): void {
    const p = st();
    renderHud();
    stage.invalidate();
    // The host hears of every new sheet (a hit, a potion, a find, a new hero) as it lands.
    if (p.hero !== lastHero) {
      lastHero = p.hero;
      host.heroes.onSheet?.(p.hero);
    }
    opts.onRefresh?.(win, "refresh");
  }

  function renderAll(): void {
    opts.onRefresh?.(win, "all");
    refreshAll();
  }

  /** The art changed (the Art row, a library that finished decoding): a new detail size picks its own zoom, and everything is drawn again. */
  function artChanged(): void {
    const size = artSize("fantasy");
    if (size !== lastArtSize) {
      lastArtSize = size;
      scale = defaultScale();
      host.settings.set({ zoom: null });
    }
    renderAll();
  }
  unbinds.push(host.art.onChange(artChanged));

  /** The host's settings changed (the controls row, a settings screen): read them again. */
  function applySettings(): void {
    const s = host.settings.get();
    if (s.textStyle !== textStyle) {
      textStyle = s.textStyle;
      overlay.setStyle(textStyle);
      hud.setStyle(textStyle);
      sheetView?.setStyle(textStyle);
      creationView?.setStyle(textStyle);
    }
    rollMyself = s.rollMyself;
    const z = s.zoom ?? defaultScale();
    if (z !== scale) {
      scale = z;
      stage.invalidate();
      marksKey = "";
    }
  }

  /** A different class: in an adventure it starts the adventure again as that class (the adventure's own kit for it); in a test room it is a new hero there. */
  function pickHero(id: ArchetypeId): void {
    const running = adventureOf(st());
    if (running) {
      const entry = benchAdventures().find((e) => e.adventure === running);
      if (entry) return beginAdventure(entry, adventureHero(running, id));
    }
    closeScreens();
    session.atStart = false;
    const old = session.play;
    session.play = newPlay("fantasy", id, ROOM_FLOOR.fantasy, undefined, undefined, st().room);
    carry(old, session.play, "a different hero was picked");
    newScene();
  }

  /** The Room setting: which creatures the sandbox starts with. Changing it starts the scene again (the hero as it began, gear and pack kept). */
  function setRoom(room: RoomChoice): void {
    closeScreens();
    session.atStart = false;
    session.roomChoice = room;
    const old = st();
    session.play = newPlay(old.template, old.archetypeId, old.floorId, old.hero, old.start, room);
    carry(old, session.play, "the room was changed");
    newScene();
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
    // Nobody has been asked in this game yet.
    lastBrief = null;
    talkTarget = null;
    closeLoot();
    overlay.clear();
    dropPendingCards();
    tray.clear();
    stage.snapCamera();
    if (checkpoint) addSavePoint(st(), "checkpoint", st().adventureId ? "start of the adventure" : "start of the scene");
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
    if (key === "j" && !e.repeat) {
      hud.toggleJournal();
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

  // One animation-frame loop paints the scene and runs the walk first; the fog of war (fog.ts) rides its frame.
  const fog = createFog({ shroud, canvas, state: st, art: host.art, reducedMotion });
  const stage = createPlayStage({ viewport, canvas, state: st, art: host.art, reducedMotion, zoom: () => scale, beforeFrame: (now) => pump(now), afterFrame: (now, tiles) => fog.frame(now, tiles) });

  // The adventure's own handle for the bench's headless checks (the DM is what talks to people and decides judgment calls: until it tells the
  // story, a check does):
  //   startScreen()   the start screen, as the button does
  //   event(e)        tell the story something happened ({ type: "talk", npc: "tobin" }, a flag, a kill...), exactly as the game would; returns the refusal, or null
  //   state()         what the story says now: adventure id, scene, place, flags, kills, items held, what is waiting to be shown
  //   dmView()        what the DM is told about the adventure now; lastBrief() the brief it was last given; exportFiles() the debug zip's files as text
  const adventureHandle = {
    startScreen: () => showStart(),
    event: (e: AdventureEvent) => {
      const r = advApply(st(), e);
      flushAdventure();
      refreshAll();
      return r?.refused ?? null;
    },
    // What the DM is told about the adventure right now (the brief, the steps it may propose, the people here, the item ids), and the brief it was last given.
    dmView: () => {
      const v = dmAdventureView(st());
      return v ? JSON.parse(JSON.stringify(v)) : null;
    },
    lastBrief: () => lastBrief,
    // The files the Saves tab's Export would put in the zip, as text.
    exportFiles: () => exportFiles(adventureBundle()).map((f) => ({ name: f.name, data: f.data })),
    state: () => {
      const p = st();
      return {
        adventureId: p.adventureId,
        // The table is busy (a DM turn, a walk, a roll): clicks on the board only skip.
        busy,
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
    alive = false;
    dmCtl?.abort();
    // The AI writer costs real usage and its Cancel button goes with the window: leaving stops it.
    writerCtl?.abort();
    host.settings.set({ diceSkin: tray.skin().id });
    dropPendingCards();
    endPress();
    closeViews();
    closeScreens();
    hud.destroy();
    stage.dispose();
    overlay.destroy();
    picker?.destroy();
    tray.destroy();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("blur", onBlur);
    for (const unbind of unbinds) unbind();
    el.innerHTML = "";
    el.classList.remove(TABLE_ROOT_CLASS);
  }

  const win: TableWindow = {
    dispose,
    debug: () => ({ play: st, adventure: adventureHandle, sight: sightHandle, save: (label) => addSavePoint(st(), "checkpoint", label) }),
    showStart,
    reset: resetScene,
    applySettings,
    pickHero,
    setRoom,
    state: st,
    atStart: () => session.atStart,
    zoom: () => scale,
    artChanged,
    refuse,
    gearResult,
  };

  // A scene that starts here is a checkpoint (the saves were read when the session began).
  if (startedNew && !session.atStart) addSavePoint(st(), "checkpoint", "start of the scene");
  renderAll();
  said = st().log.length;
  if (st().round) void runHostiles();
  // The window opens on its start screen until something is chosen (coming back to a game in progress does not).
  if (session.atStart) showStart();
  // The DM's transport, asked for once, after the first paint.
  void loadSample();
  return win;
}
