/**
 * Wiring the HUD to the window: handling HUD actions, building the HUD state, redrawing everything, settings, picking a hero, and new scenes.
 */
import { type ArchetypeId } from "../../characters/equipmentTypes";
import { sentenceCase } from "../../menu/labels";
import { FEET_PER_TILE, activeCombatant } from "../../menu/combatRound";
import { attackerBonusFor, effectiveArmorClass, statblockFor, weaponDamageNotationFor } from "../../session/combat";
import { textSpeedOf, type HudAction, type HudBar, type HudOption, type InitiativeSide } from "../ui/overlay";
import { sceneOf } from "../../adventures/types";
import { HERO_ID, ROOM_FLOOR, creatureById, creatureName, heroDown, hostilesOf, newPlay, pluralName, type PlayState, type RoomChoice } from "../state";
import { lootNear, type GearOutcome } from "../gearLoot";
import { adventureHero, benchAdventures } from "../adventureCatalog";
import { doorOrChestUsable, restRefusal } from "../fightRules";
import { advUseFor, adventureOf, currentLocation } from "../adventureRun";
import { activeCreature, foeName, heroActionReady, heroesTurn } from "../sight";
import type { TableCtx } from "../tableCtx";

export function installHudWiring(tc: TableCtx): void {
  // ---- the readout -------------------------------------------------------------

  async function onHudAction(id: string): Promise<void> {
    if (id.startsWith("opt:")) return tc.pickOption(Number(id.slice(4)));
    if (id.startsWith("load:")) return tc.loadSave(id.slice(5));
    if (id.startsWith("set:")) return chooseSetting(id);
    if (id === "rest") return tc.restFlow();
    if (id === "reset") return tc.busy ? undefined : tc.resetScene();
    if (id === "end") return tc.endTurnFlow();
    if (id === "menu") return tc.openGameMenu("character");
    if (id === "mainmenu") return tc.openMainMenu();
    if (id === "export") return tc.exportAdventure();
    if (id === "export-copy") return tc.copyAdventureJson();
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
    const live = hostilesOf(p).filter((m) => m.seen || tc.inOrder(p, m));
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
    const p = tc.st();
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
    // Something to use or search beside the hero (a way out underfoot, a chest, a body or a pile): while there is, a turn with no move left is not yet over.
    const advUse = adv ? advUseFor(p) : null;
    const useDoor = adv ? advUse !== null : doorOrChestUsable(p);
    const near = useDoor || lootNear(p) !== null;
    const actionLeft = heroActionReady(p);
    const moveLeft = (c?.economy.movementRemaining ?? 0) >= FEET_PER_TILE;
    // While the menu or the creator is open (or a story screen is up) the game waits: only what is safe stays live.
    const free = !tc.overlayOpen();
    const down = heroDown(p);
    // The HUD keeps three buttons: Rest, End turn and Menu (and the main menu, where the host has one). Every other action starts from a
    // right click (or a long press) on the board, and the keys still work.
    const actions: HudAction[] = [];
    if (down) {
      // Down: go back to a save, or start the scene again, as the two next moves (keys 1 and 2, full width: the labels are long for the dock's
      // two-column grid).
      actions.push({ id: "load:last", label: "Load last save", key: "1", kind: "suggestion", enabled: free && !tc.busy && tc.session.saves.list().length > 0 });
      actions.push({ id: "reset", label: "Reset scene", key: "2", kind: "suggestion", enabled: free && !tc.busy });
    } else {
      actions.push(
        // The thing to press once the action is spent, or nothing is left to do.
        { id: "end", label: "End turn", key: "T", enabled: free && !tc.busy && mine, hidden: !mine, emphasis: free && !tc.busy && mine && (!actionLeft || (!moveLeft && !near)) },
        { id: "rest", label: "Rest", key: "R", enabled: free && !tc.busy, hidden: restRefusal(p) !== null },
      );
    }
    // One Menu button holds the character, the inventory, the journal, the log, the saves and the settings. It waits while a story screen is read.
    const storyUp = (tc.overlay as unknown as { storyOpen?: () => boolean }).storyOpen?.() === true;
    actions.push({ id: "menu", label: "Menu", enabled: tc.creationView === null && !storyUp });
    if (tc.host.env.mainMenu) actions.push({ id: "mainmenu", label: "Main menu", enabled: tc.creationView === null && !storyUp && !tc.busy });
    // The DM's suggested next moves show only while the table is free (they are buttons that act when pressed).
    const options: HudOption[] = free && !tc.busy && !down ? p.options.map((o, i) => ({ id: `opt:${i}`, label: o.label, key: String(i + 1) })) : [];
    // On a phone the dock is cut to its title, the move left and the hit points; the other lines are for the room beside the board.
    const short = mine && c ? [`Move ${c.economy.movementRemaining} ft, action ${c.economy.action ? "ready" : "used"}`] : [];
    tc.hud.render({ title, lines, short, condense: true, bars, actions, options });
    // The game menu follows the hero live (hit points, potions, anything the DM hands over, the log, the saves).
    tc.syncGameMenu();
    // The dock steps aside while a screen is up (the main menu, the adventure list, the hero choice, an ending): the screens style the mark.
    tc.stageWrap.closest(".lt-arena")?.toggleAttribute("data-screens", tc.screenOpen() || tc.creationView !== null);
    const entries = p.round
      ? p.round.order.map((cb) => {
          const m = creatureById(p, cb.id);
          return { id: cb.id, label: cb.id === HERO_ID ? p.hero.name : m ? foeName(p, m) : "???", total: cb.initiative, side: (cb.side === "player" ? "hero" : "enemy") as InitiativeSide };
        })
      : [];
    tc.overlay.initiative(entries, p.round ? (activeCombatant(p.round)?.id ?? null) : null, p.round?.roundNumber ?? 0);
  }

  /** A gear change made outside the window (the bench's Worn, Pack and Armoury section): say why it was refused, and redraw. */
  function gearResult(outcome: GearOutcome): void {
    if (!outcome.ok) tc.refuse(outcome.reason);
    tc.flushLog();
    renderAll();
  }

  function refreshAll(): void {
    const p = tc.st();
    renderHud();
    tc.stage.invalidate();
    // The host hears of every new sheet (a hit, a potion, a find, a new hero) as it lands.
    if (p.hero !== tc.lastHero) {
      tc.lastHero = p.hero;
      tc.host.heroes.onSheet?.(p.hero);
    }
    tc.opts.onRefresh?.(tc.win, "refresh");
  }

  function renderAll(): void {
    tc.opts.onRefresh?.(tc.win, "all");
    refreshAll();
  }

  /** The art changed (the Art row, a library that finished decoding): a new detail size picks its own zoom, and everything is drawn again. */
  function artChanged(): void {
    const size = tc.artSize("fantasy");
    if (size !== tc.lastArtSize) {
      tc.lastArtSize = size;
      tc.scale = tc.defaultScale();
      tc.host.settings.set({ zoom: null });
    }
    renderAll();
  }
  tc.unbinds.push(tc.host.art.onChange(artChanged));

  /** The host's settings changed (the controls row, a settings screen): read them again. */
  function applySettings(): void {
    const s = tc.host.settings.get();
    if (s.textStyle !== tc.textStyle) {
      tc.textStyle = s.textStyle;
      tc.overlay.setStyle(tc.textStyle);
      tc.hud.setStyle(tc.textStyle);
      tc.creationView?.setStyle(tc.textStyle);
    }
    tc.rollMyself = s.rollMyself;
    const speed = textSpeedOf(s.textSpeed);
    if (speed !== tc.textSpeed) {
      tc.textSpeed = speed;
      tc.applyTextSpeed();
    }
    const z = s.zoom ?? tc.defaultScale();
    if (z !== tc.scale) {
      tc.scale = z;
      tc.stage.invalidate();
      tc.marksKey = "";
    }
    renderHud();
  }

  /** A choice made in the HUD's Settings tab (an id like "set:textSpeed:fast"): kept by the host, then applied. */
  function chooseSetting(id: string): void {
    const [, key, value = ""] = id.split(":");
    if (key === "textSpeed") tc.host.settings.set({ textSpeed: textSpeedOf(value) });
    else if (key === "textStyle") tc.host.settings.set({ textStyle: value === "storybook" ? "storybook" : "pixel" });
    else if (key === "rollMyself") tc.host.settings.set({ rollMyself: value === "true" });
    else if (key === "autoEndTurn") tc.host.settings.set({ autoEndTurn: value === "true" });
    else if (key === "zoom") {
      const n = Math.round(Number(value));
      tc.host.settings.set({ zoom: value !== "auto" && n >= 1 && n <= 4 ? n : null });
    } else return;
    applySettings();
  }

  /** A different class: in an adventure it starts the adventure again as that class (the adventure's own kit for it); in a test room it is a new hero there. */
  function pickHero(id: ArchetypeId): void {
    const running = adventureOf(tc.st());
    if (running) {
      const entry = benchAdventures().find((e) => e.adventure === running);
      if (entry) return tc.beginAdventure(entry, adventureHero(running, id));
    }
    tc.closeScreens();
    tc.session.atStart = false;
    const old = tc.session.play;
    tc.session.play = newPlay("fantasy", id, ROOM_FLOOR.fantasy, undefined, undefined, tc.st().room);
    tc.carry(old, tc.session.play, "a different hero was picked");
    newScene();
  }

  /** The Room setting: which creatures the sandbox starts with. Changing it starts the scene again (the hero as it began, gear and pack kept). */
  function setRoom(room: RoomChoice): void {
    tc.closeScreens();
    tc.session.atStart = false;
    tc.session.roomChoice = room;
    const old = tc.st();
    tc.session.play = newPlay(old.template, old.archetypeId, old.floorId, old.hero, old.start, room);
    tc.carry(old, tc.session.play, "the room was changed");
    newScene();
  }

  /** A new hero, a reset, a loaded save: nothing pending carries over, and the camera jumps to the hero. A new scene is also a checkpoint (a load is not: it is going back to one). */
  function newScene(checkpoint = true): void {
    // The sheet and the creator belong to the old hero.
    tc.closeViews();
    // A DM call still out belongs to the old scene: let it go.
    const pending = tc.dmCtl;
    tc.dmCtl = null;
    tc.dmThinking = false;
    pending?.abort();
    tc.walkQueue.length = 0;
    tc.onArrive = null;
    tc.busy = false;
    tc.skipping = false;
    tc.fightWasOn = false;
    tc.hover = null;
    tc.said = tc.st().log.length;
    // Nobody has been asked in this game yet.
    tc.lastBrief = null;
    tc.closeLoot();
    tc.overlay.clear();
    tc.tray.clear();
    tc.stage.snapCamera();
    if (checkpoint) tc.addSavePoint(tc.st(), "checkpoint", tc.st().adventureId ? "start of the adventure" : "start of the scene");
    renderAll();
  }

  // What the other modules call or read.
  tc.onHudAction = onHudAction;
  tc.renderHud = renderHud;
  tc.gearResult = gearResult;
  tc.refreshAll = refreshAll;
  tc.renderAll = renderAll;
  tc.artChanged = artChanged;
  tc.applySettings = applySettings;
  tc.pickHero = pickHero;
  tc.setRoom = setRoom;
  tc.newScene = newScene;
}
