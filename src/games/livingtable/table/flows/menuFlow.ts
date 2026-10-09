/**
 * The context menu: what a right click (or a long press) offers for a square, and what picking an entry does.
 */
import { contextActionsFor, type ContextAction, type ContextSituation, type ContextTarget } from "../../session/contextActions";
import { sentenceCase } from "../../menu/labels";
import { FEET_PER_TILE, activeCombatant, spendActiveAction } from "../../menu/combatRound";
import { effectiveSpeedFt } from "../../session/combat";
import { type ContextMenuEntry } from "../ui/overlay";
import { tileDistance } from "../../world/reach";
import { harvestForToken } from "../../rules/corpses";
import { DOWN_NOTE, NOT_SEEN, SCENE_KIT, creatureAt, creatureById, creatureLabel, creatureName, heroDown, same, type PlayState, type XY } from "../state";
import { pileAt } from "../gearLoot";
import { creatureKind, creaturePassive } from "../fightRules";
import { adventureOf, advPropWords, containerAt, doorAt, featureAtSquare, featureIsFound, featureSearchable, npcOf, sceneTiles, terrainBlocks } from "../adventureRun";
import { creatureInSight, heroActionReady, heroBudgetFt, heroReachTiles, heroesTurn, seesTile, sightLevel } from "../sight";
import { grateId, isGrate, whatIsAt } from "../dmScene";
import type { TableCtx } from "../tableCtx";
import type { Plan } from "./board";

/** A menu line as the menu shows it: the catalog's action, plus what walking to it costs. */
export type MenuAction = ContextAction & {
  /** A small gold line under the label: "Walks 15 ft first". */
  note?: string;
  /** Set when picking it walks the hero up to the target first (feet), and the action then runs on arrival. */
  walkFt?: number;
};

/**
 * An action that only distance was holding back, given what walking there would cost. Reachable: it is on offer, with the walk named under it
 * (nothing to say when the hero is already beside it). Not reachable (a wall in the way, or more than this turn's movement): it stays greyed, with
 * the reason a player would say. An action with no `farBy` is returned as it was.
 */
export function walkAdjust(a: ContextAction, reach: { reachable: boolean; feet: number }, inFight: boolean): MenuAction {
  if (a.farBy === undefined) return a;
  if (!reach.reachable) return { ...a, enabled: false, reason: inFight ? "You cannot reach it this turn." : "You cannot get next to it from here." };
  const { reason: _gone, ...rest } = a;
  return { ...rest, enabled: true, ...(reach.feet > 0 ? { walkFt: reach.feet, note: `Walks ${reach.feet} ft first` } : {}) };
}

/** What the text line of the menu says before anything is typed in it. `who` is the name a person goes by (their own name in an adventure). */
export function askPlaceholder(target: ContextTarget, who?: string): string {
  if (target.kind === "creature") return `Say something to ${who ?? target.name}`;
  if (target.kind === "self") return "Do something";
  if (target.kind === "floor") return "Do something here";
  return `Do something with ${target.name}`;
}

/** The short words the menu's empty text line shows (18 characters at most; askPlaceholder's full words stay the screen reader's). */
export function askHint(target: ContextTarget): string {
  return target.kind === "creature" ? "Say something" : "Do something else";
}

export function installMenuFlow(tc: TableCtx): void {
  // ---- the context menu ------------------------------------------------------------------------
  //
  // Right-click, or a long press on a touch screen, opens it on any square the hero has seen. A left click or a tap only selects and walks, so
  // EVERY other thing a player does starts here. contextActions.ts decides what is on offer to THIS character there (class and skills put
  // things on it or leave them off) and the plain numbers behind each line; Look closer is always the first line, and the last is a text line
  // for anything else the player wants to say or do. An action the DM rules on is sent as a freehand ask. An action the engine rules on runs in
  // maneuvers.ts (session/maneuvers.ts rolls it), with every die thrown in the tray (the hero's in the player's tray, the creature's in its own),
  // and CHANGES THE BOARD: the damage lands, the push moves the figure, prone and hidden are states the rules read. A line that is only out of reach
  // walks the hero up to it first and does its work on arrival.

  /** What the DM can answer right now, or why not: a menu line that needs it says so instead of failing on the click. */
  function dmUnavailable(): string | null {
    if (tc.peekSample() || tc.sampleState === "ready") return null;
    return tc.sampleState === "pending" ? "The DM is still waking. Try again in a moment." : (tc.dmStatus ?? tc.NO_DM);
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
    if (body) {
      return {
        target: {
          kind: "body",
          id: body.id,
          name: `the ${body.name.toLowerCase()}'s body`,
          distanceTiles,
          inSight,
          // A beast with a part to take (the rat's pelt, the wolf's): the catalog offers Harvest only where it will really yield something.
          body: { looted: body.looted, harvested: body.harvested, beast: body.beast, harvestable: body.token ? harvestForToken(body.token) !== null : false },
        },
      };
    }
    if (pileAt(p, at)) return { target: { kind: "prop", name: "the things lying here", distanceTiles, inSight }, pile: true };
    if (same(at, doorAt(p))) return { target: { kind: "door", id: "door", name: kit.doorLabel, distanceTiles, inSight, door: { open: p.doorOpen, locked: p.doorLocked, lockDc: p.doorLockDc } } };
    if (same(at, containerAt(p))) return { target: { kind: "chest", id: "container", name: kit.containerLabel, distanceTiles, inSight, searched: p.searched, openable: true } };
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
    const blocked = terrainBlocks(p, sceneTiles(p), at) !== null;
    // A piece of the adventure's own scenery that stands in the way (the bed, a barrel, a shelf) is a thing to walk up to and look at, not a bare patch of floor.
    const placed = p.adventureId && blocked ? advPropWords(p, at) : null;
    if (placed) return { target: { kind: "prop", name: placed, distanceTiles, inSight }, wall: true };
    return { target: { kind: "floor", name: whatIsAt(p, at), distanceTiles, inSight }, wall: blocked };
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

  const withReason = (a: MenuAction, reason: string): MenuAction => (a.enabled ? { ...a, enabled: false, reason } : a);

  /** Everything the menu on a square offers, in order: the catalog's list for this character, then the table's own honest adjustments (below). */
  function menuFor(p: PlayState, at: XY): { title: string; target: ContextTarget; actions: MenuAction[] } {
    const { target, pile, wall } = contextTargetFor(p, at);
    const noDm = dmUnavailable();
    const marked = target.kind === "creature" && target.id ? creatureById(p, target.id) : undefined;
    // Each line of the catalog, adjusted for this table before the list is put in order (so a far line that can be walked to ranks as the line it is).
    const adjust = (line: ContextAction): MenuAction => {
      let a: MenuAction = line;
      if (a.id === "attack") {
        // A weapon reaches as far as it reaches (a bow across the room, a sword beside it): only beyond that does the hero walk up first.
        if (a.enabled && tileDistance(p.heroAt, at) > heroReachTiles(p)) {
          const walk = tc.approachCost(at);
          a = walk.reachable ? (walk.feet > 0 ? { ...a, note: `Walks ${walk.feet} ft first` } : a) : withReason(a, p.round ? "You cannot reach it this turn." : "You cannot get next to it from here.");
        }
      } else if (a.farBy !== undefined) {
        // Out of reach and nothing else in the way: the hero can walk up to it first.
        a = walkAdjust(a, tc.approachCost(at), p.round !== null);
      }
      // The DM answers these, and cannot just now.
      if (a.resolver === "dm" && noDm) a = withReason(a, noDm);
      // Spells are picked from the Cast menu, which a right click does not open yet.
      if (a.id === "cast") a = withReason(a, "You cannot cast from here yet.");
      // The loot window closes when a fight starts, so looting in one would do nothing.
      if (a.id === "loot" && p.round) a = withReason(a, "Not in the middle of a fight. Finish it first.");
      if (a.id === "pickpocket" && !(marked?.carried ?? []).some((c) => c.pocketable)) a = withReason(a, "It has nothing in its pockets you could lift.");
      // Hiding and sneaking decide whether a creature WAKES. Once it is fighting it knows where you are, and the engine's turn for it does not look at them.
      if (p.round && (a.id === "hide" || a.id === "sneak" || a.id === "sneak-up")) a = withReason(a, "The fight is on: it already knows where you are. Hiding and sneaking are for before it wakes.");
      if (a.id === "sneak" && p.sneaking) a = { ...a, label: "Stop sneaking" };
      return a;
    };
    let actions: MenuAction[];
    if (pile) {
      // Things lying on the ground: the catalog has no kind for a heap, so the one line is made here.
      const dist = tileDistance(p.heroAt, at);
      const fight = p.round ? "Not in the middle of a fight. Finish it first." : undefined;
      const far = !fight && dist > 1;
      const reason = fight ?? (far ? `Too far away: ${dist * FEET_PER_TILE} feet. Move next to it first.` : undefined);
      const [look] = contextActionsFor(target, situationFor(p), adjust);
      const heap: ContextAction = { id: "loot-pile", label: "Pick through it", resolver: "engine", cost: "free", say: "I look through what is lying here.", needsAdjacent: true, enabled: reason === undefined, ...(reason ? { reason } : {}), ...(far ? { farBy: dist - 1 } : {}) };
      actions = [look!, adjust(heap)];
    } else {
      actions = contextActionsFor(target, situationFor(p), adjust);
    }
    if (wall) actions = actions.slice(0, 1);
    const out: MenuAction[] = [];
    for (const a of actions) {
      out.push(a);
      // A shove is SRD 5.1's two options: push it 5 feet, or knock it prone. The catalog lists one line; the menu offers both.
      if (a.id === "shove") out.push({ ...a, id: "shove-prone", label: "Knock down", say: `I try to knock ${target.name} down.` });
    }
    return { title: sentenceCase(target.name), target, actions: out };
  }

  /** The name a person on the board goes by when they are spoken to: their own in an adventure, else what they are. */
  function personNameAt(p: PlayState, at: XY): string | undefined {
    const c = creatureAt(p, at);
    if (!c || !creatureInSight(p, c)) return undefined;
    const a = adventureOf(p);
    return (a ? npcOf(a, c.adv?.npc)?.name : undefined) ?? creatureName(p, c);
  }

  /** The text line of the menu, the last: anything else the player wants to say or do, sent to the DM with what was clicked. */
  function askEntry(p: PlayState, at: XY, target: ContextTarget): ContextMenuEntry {
    const s = tc.askStateFor(p) as { enabled: boolean; status?: string; busy?: boolean };
    const myMove = !p.round || heroesTurn(p);
    const reason = s.enabled
      ? undefined
      : s.status ?? (s.busy ? "The DM is thinking." : heroDown(p) ? DOWN_NOTE : !myMove ? "Wait for your turn." : "Wait until the table is free.");
    return {
      id: "ask",
      label: target.kind === "creature" ? `Say something to ${personNameAt(p, at) ?? target.name}` : "Do something",
      kind: "text",
      placeholder: askPlaceholder(target, personNameAt(p, at)),
      hint: askHint(target),
      enabled: s.enabled,
      ...(reason ? { reason } : {}),
      onSubmit: (text) => submitAsk(at, text),
    };
  }

  /** Words typed in the menu: one freehand ask, for the person standing there when there is one, naming the square that was clicked. */
  function submitAsk(at: XY, text: string): void {
    if (tc.busy || tc.overlayOpen()) return tc.refuse("Wait until the table is free.");
    const p = tc.st();
    const c = creatureAt(p, at);
    const a = adventureOf(p);
    const npc = c && a ? npcOf(a, c.adv?.npc) : undefined;
    tc.clearOptions();
    const ask = { kind: "freehand" as const, text, at: { ...at }, what: same(at, p.heroAt) ? "yourself" : whatIsAt(p, at), ...(npc ? { npc: { id: npc.id, name: npc.name } } : {}) };
    void tc.runDm(ask);
  }

  /** The hero's square as a rectangle in the overlay's pixels, with the head: the figure stands taller than its square, so the rectangle reaches up three quarters of one. */
  function heroRect(sq: XY, ts: number): { x: number; y: number; w: number; h: number } {
    const a = tc.toHost(sq.x * ts, sq.y * ts);
    const b = tc.toHost((sq.x + 1) * ts, (sq.y + 1) * ts);
    const w = b.x - a.x;
    const h = b.y - a.y;
    return { x: a.x, y: a.y - h * 0.75, w, h: h * 1.75 };
  }

  /** Open the menu on the square under a pointer. */
  function openMenu(clientX: number, clientY: number): void {
    const t = tc.tileAt(clientX, clientY);
    if (!t || tc.busy || tc.overlayOpen()) return;
    const p = tc.st();
    if (sightLevel(p, t) === 0) return tc.refuse(NOT_SEEN);
    const m = menuFor(p, t);
    const entries: ContextMenuEntry[] = m.actions.map((a) => ({
      id: a.id,
      label: a.label,
      ...(a.why ? { why: a.why } : {}),
      ...(a.note ? { note: a.note } : {}),
      ...(a.good ? { good: true } : {}),
      enabled: a.enabled,
      ...(a.reason ? { reason: a.reason } : {}),
    }));
    entries.push(askEntry(p, t, m.target));
    const ts = tc.tileScale();
    // The hero's own square stays in view: the menu opens on a side of the click that does not cover it (unless the click IS the hero).
    const avoid = same(t, p.heroAt) ? undefined : heroRect(p.heroAt, ts);
    tc.overlay.contextMenu(tc.toHost((t.x + 0.5) * ts, (t.y + 0.5) * ts), entries, (id) => pickContext(t, id), { title: m.title, ...(avoid ? { avoid } : {}) });
  }

  /** What picking a line does once the hero is where it needs them to be. */
  function doAction(found: MenuAction, tile: XY): void {
    const p = tc.st();
    switch (found.id) {
      case "look":
        return tc.examineAt(tile);
      case "attack": {
        // Swing at whoever is there: at once when the weapon reaches, else after a walk up to it.
        const plan: Plan = { kind: "attack", path: [], costFt: 0, tile: { ...tile } };
        if (tileDistance(p.heroAt, tile) <= heroReachTiles(p)) return tc.runPlan(plan);
        return tc.walkThen(tile, () => tc.runPlan(plan));
      }
      case "open":
        // The door or the chest beside the hero: the engine's own interaction (it refuses a locked door in words).
        return tc.runPlan({ kind: "use", path: [], costFt: 0, tile: { ...tile } });
      case "drink-potion":
        return void tc.drinkPotion();
      case "talk": {
        // In an adventure: talking to a person is a talk with them, and the DM answers in their voice.
        const who = creatureAt(p, tile);
        if (who && !who.hostile && p.adventureId) return tc.talkTo(who);
        break;
      }
      case "search":
        // Search on a feature of an adventure's place is the engine's own check, not a DM answer.
        if (p.adventureId && featureAtSquare(p, tile)) return void tc.featureFlow(tile);
        break;
      default:
        break;
    }
    if (found.resolver === "dm") {
      const ask = { kind: "freehand" as const, text: found.say, at: { ...tile }, what: same(tile, p.heroAt) ? "yourself" : whatIsAt(p, tile) };
      void tc.runDm(ask);
      return;
    }
    void tc.runEngineAction(found, tile);
  }

  /** A line of the menu was picked. The list is read fresh (the table may have moved on while the menu was open). */
  function pickContext(tile: XY, id: string): void {
    if (tc.busy || tc.overlayOpen()) return tc.refuse("Wait until the table is free.");
    const found = menuFor(tc.st(), tile).actions.find((a) => a.id === id);
    if (!found) return tc.refuse("That is not on offer any more.");
    if (!found.enabled) return tc.refuse(found.reason ?? "You cannot do that now.");
    tc.clearOptions();
    // Out of reach: walk up to it first, and do it on arrival (a walk that is cut short does nothing, and spends no DM call).
    if (found.walkFt !== undefined && found.walkFt > 0) return tc.walkThen(tile, () => doAction(found, tile));
    doAction(found, tile);
  }

  /** What an action costs, taken in a fight (outside one nothing is spent). Movement is paid by walking, so it costs nothing here. */
  function spendCost(p: PlayState, cost: ContextAction["cost"]): void {
    if (!p.round) return;
    if (cost === "action") p.round = spendActiveAction(p.round) ?? p.round;
    else if (cost === "bonus") p.round = spendActiveAction(p.round, "bonusAction") ?? p.round;
  }

  /** The end of an engine action: the table is free, the log and picture catch up, and the goblin may notice what happened. */
  async function afterManeuver(): Promise<void> {
    tc.busy = false;
    tc.flushLog();
    tc.refreshAll();
    await tc.afterHeroAction();
  }

  // What the other modules call or read.
  tc.openMenu = openMenu;
  tc.spendCost = spendCost;
  tc.afterManeuver = afterManeuver;
}
