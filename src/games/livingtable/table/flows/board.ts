/**
 * The board: where things are on screen, what a click on a square means (plans), and the marks drawn over the floor.
 *
 * ONE RULE FOR THE WHOLE BOARD. A left click or a tap SELECTS and WALKS, and never acts: it walks the hero to the square, or
 * to the square beside the thing standing there (a creature, a prop that blocks, a door), and puts one neutral ring on it.
 * Every other action (attack, talk, look closer, use, loot, search, free text) starts from the actions menu (a right click,
 * or a long press on a touch screen), which reuses this module's walk through `tc.walkThen`. So planFor answers only
 * "walk", "walk to a way out" or "you cannot go there"; the other plan kinds stay in the Plan type because runPlan still
 * runs them after a walk (the menu builds them).
 *
 * The board gives no hints about what a thing is or what can be done with it (this is D&D: the world is the player's
 * oyster, and the DM always knows what was pointed at). The marks are the walk path with its length, one neutral ring,
 * the one gold ring on a way out that can be entered (a door to another place), and a red outline on a square the hero
 * cannot go to.
 */
import { bodySpriteId } from "../../characters/equipmentTypes";
import { FEET_PER_TILE, activeCombatant, isPlayersTurn } from "../../menu/combatRound";
import { headAnchor } from "../../render/anchors";
import { type OverlayPoint } from "../ui/overlay";
import { CELL_WIDTH, CELL_HEIGHT } from "../../world/coordinates";
import type { CellLayout, TileId } from "../../world/cell";
import { approachFootprint, pathTo, reachableTiles } from "../../world/pathing";
import { tileDistance } from "../../world/reach";
import { DOWN_NOTE, NOT_SEEN, creatureAt, heroDown, same, type XY } from "../state";
import { drawLootMarks, drawProneMark } from "../fog";
import { exitIsOpen, exitLockedWords, exitOn, sceneProps, sceneTiles, terrainBlocks, type ExitHere } from "../adventureRun";
import { footprintAt } from "../propGroups";
import { blockedWords, creatureInSight, heroField, heroesTurn, sightLevel } from "../sight";
import type { TableCtx } from "../tableCtx";

// ---- plans: what a click on a square means -----------------------------------

export type Plan =
  /** A walk to a square, or to the square beside whatever stands on `tile`. `exit` is set when `tile` is a way out that can be entered. */
  | { kind: "walk"; path: XY[]; costFt: number; tile: XY; exit?: ExitHere }
  /** The following are not made by a click; the actions menu builds them, and runPlan runs them after the walk. */
  | { kind: "attack"; path: XY[]; costFt: number; tile: XY }
  | { kind: "loot"; path: XY[]; costFt: number; tile: XY }
  | { kind: "use"; path: XY[]; costFt: number; tile: XY }
  | { kind: "look"; path: XY[]; costFt: number; tile: XY }
  /** An adventure: walk up to a person and open the ask box on them. */
  | { kind: "talk"; path: XY[]; costFt: number; tile: XY }
  /** An adventure: walk up to a feature of the place and search it (or look at it). */
  | { kind: "feature"; path: XY[]; costFt: number; tile: XY }
  /** An adventure: the way out the hero stands on (a click on the hero's own square when it is a way out). */
  | { kind: "exit"; path: XY[]; costFt: number; tile: XY }
  | { kind: "none"; tile: XY; reason: string };

export function installBoard(tc: TableCtx): void {
  // ---- where things are on screen --------------------------------------------

  /** The square under a pointer, or null off the board. */
  function tileAt(clientX: number, clientY: number): XY | null {
    const r = tc.canvas.getBoundingClientRect();
    if (r.width === 0) return null;
    const ts = tc.tileScale();
    const x = Math.floor(((clientX - r.left) * (tc.canvas.width / r.width)) / ts);
    const y = Math.floor(((clientY - r.top) * (tc.canvas.height / r.height)) / ts);
    return x >= 0 && y >= 0 && x < CELL_WIDTH && y < CELL_HEIGHT ? { x, y } : null;
  }

  /** A point on the canvas, in the overlay host's CSS pixels (the board scrolls under the host). */
  function toHost(px: number, py: number): OverlayPoint {
    const r = tc.canvas.getBoundingClientRect();
    const h = tc.stageWrap.getBoundingClientRect();
    const k = r.width > 0 ? r.width / tc.canvas.width : 1;
    return { x: r.left - h.left + px * k, y: r.top - h.top + py * k };
  }

  /** Over a figure's head, from the game's own headAnchor (the token's sprite height at the art's resolution). `who` is "hero" or a creature's token asset id. */
  function headOf(who: "hero" | TileId, tile?: XY): OverlayPoint {
    const p = tc.st();
    const at = tile ?? (who === "hero" ? p.heroAt : (p.fallenAt ?? p.heroAt));
    const assetId = who === "hero" ? bodySpriteId(p.archetypeId) : who;
    const layout: CellLayout = { tiles: [], props: [], tokens: [{ id: "who", assetId, x: at.x, y: at.y, kind: who === "hero" ? "pc" : "monster" }], exits: [], sealed: true };
    const a = headAnchor(layout, "who", tc.host.art.render(p.template), tc.tileScale());
    const ts = tc.tileScale();
    return a ? toHost(a.x, a.y) : toHost((at.x + 0.5) * ts, at.y * ts);
  }

  // ---- what stands on a square, and the walk to it -------------------------------

  /**
   * The squares of whatever the hero cannot step onto at `tile`: a creature in sight, a door, the chest, or a prop that blocks
   * (every square of it when it is drawn in several). Null when nothing like that stands there (a wall, water or open floor).
   */
  function standingAt(tile: XY): XY[] | null {
    const p = tc.st();
    const there = creatureAt(p, tile);
    if (there && creatureInSight(p, there)) return [{ ...tile }];
    const blocked = terrainBlocks(p, sceneTiles(p), tile);
    if (blocked === "door" || blocked === "container") return [{ ...tile }];
    if (blocked === "prop") return footprintAt(sceneProps(p), tile);
    return null;
  }

  /** The squares a thing at `tile` fills: its footprint, or just the square when nothing is placed there. */
  function footprintOf(tile: XY): XY[] {
    const p = tc.st();
    const there = creatureAt(p, tile);
    if (there && creatureInSight(p, there)) return [{ ...tile }];
    return footprintAt(sceneProps(p), tile);
  }

  /** The walk to the square beside a footprint: empty when the hero is already beside (or on) it, null when no such square can be reached now. */
  function pathBeside(footprint: readonly XY[]): XY[] | null {
    const p = tc.st();
    if (footprint.some((t) => tileDistance(p.heroAt, t) <= 1)) return [];
    const field = heroField(p);
    const spot = approachFootprint(field, footprint, 1);
    return spot ? pathTo(field, spot) : null;
  }

  /** Whether the hero can walk at all right now (it is its turn, standing), and the square has been seen. */
  function canWalkTo(tile: XY): boolean {
    const p = tc.st();
    return !heroDown(p) && !(p.round && !isPlayersTurn(p.round)) && sightLevel(p, tile) > 0;
  }

  function approachCost(tile: XY): { reachable: boolean; feet: number } {
    if (!canWalkTo(tile)) return { reachable: false, feet: 0 };
    const path = pathBeside(footprintOf(tile));
    return path ? { reachable: true, feet: path.length * FEET_PER_TILE } : { reachable: false, feet: 0 };
  }

  function select(tile: XY | null): void {
    tc.selected = tile ? { ...tile } : null;
  }

  function walkThen(tile: XY, act: () => void | Promise<void>): void {
    const p = tc.st();
    if (tc.busy) return;
    if (!canWalkTo(tile)) return tc.refuse(heroDown(p) ? DOWN_NOTE : p.round && !isPlayersTurn(p.round) ? "Wait for your turn." : NOT_SEEN);
    const footprint = footprintOf(tile);
    const path = pathBeside(footprint);
    if (!path) return tc.refuse(p.round ? "Too far to reach this turn." : "You cannot get next to it from here.");
    select(tile);
    tc.clearOptions();
    tc.walkQueue.length = 0;
    tc.walkQueue.push(...path);
    // The pump drops this when the walk is cut short (a refused step, a notice, the Space key): then nothing is spent.
    tc.onArrive = async () => {
      const now = tc.st();
      if (now !== p || !footprint.some((t) => tileDistance(now.heroAt, t) <= 1)) return;
      await act();
    };
  }

  function planFor(tile: XY): Plan {
    const p = tc.st();
    if (heroDown(p)) return { kind: "none", tile, reason: DOWN_NOTE };
    if (p.round && !isPlayersTurn(p.round)) return { kind: "none", tile, reason: "Wait for your turn." };
    // Fog: a square the hero has never seen cannot be clicked, and a monster it cannot see is just another square.
    if (sightLevel(p, tile) === 0) return { kind: "none", tile, reason: NOT_SEEN };
    const field = heroField(p);
    const walkTo = (to: XY, exit?: ExitHere): Plan | null => {
      const path = pathTo(field, to);
      return path ? { kind: "walk", path, costFt: path.length * FEET_PER_TILE, tile, ...(exit ? { exit } : {}) } : null;
    };
    // A way out (an adventure's door to another place): open, it is walked onto (and taken when the walk ends); shut, it says why.
    if (p.adventureId) {
      const way = exitOn(p, tile);
      if (way) {
        if (!exitIsOpen(p, way.exit)) return { kind: "none", tile, reason: exitLockedWords(way.exit) };
        if (same(tile, p.heroAt)) return { kind: "exit", path: [], costFt: 0, tile };
        // Only outside a fight is a way out taken (afterHeroAction), so only then is it marked as one.
        const go = walkTo(tile, p.round ? undefined : way);
        if (go) return go;
      }
    }
    if (same(tile, p.heroAt)) return { kind: "none", tile, reason: "" };
    // The square itself, when it can be stood on.
    const direct = walkTo(tile);
    if (direct) return direct;
    // Something stands there: walk to the square beside it (the whole thing, when it is drawn in several squares).
    const stands = standingAt(tile);
    if (stands) {
      const path = pathBeside(stands);
      if (!path) return { kind: "none", tile, reason: p.round ? "Too far to reach this turn." : "You cannot get next to it from here." };
      return { kind: "walk", path, costFt: path.length * FEET_PER_TILE, tile };
    }
    return { kind: "none", tile, reason: blockedWords(p, tile) };
  }

  // ---- the marks: the path, one ring, a way out, and where the hero cannot go ---------

  tc.hover = null;
  tc.selected = null;
  tc.marksKey = "";
  /** The board the selection was made on: a new place clears it. */
  let selectedOn = { at: null as XY | null, epoch: -1 };

  function drawMarks(): void {
    const p = tc.st();
    const ts = tc.tileScale();
    // The selection belongs to the board it was made on, and ends where the hero stands on it.
    if (tc.selected !== selectedOn.at) selectedOn = { at: tc.selected, epoch: p.boardEpoch };
    if (tc.selected && (selectedOn.epoch !== p.boardEpoch || same(tc.selected, p.heroAt))) tc.selected = null;
    const plan = !tc.busy && tc.hover ? planFor(tc.hover) : null;
    const lootSig = `${p.piles.map((q) => `${q.at.x},${q.at.y},${q.items.length}`).join(";")}|${p.bodies.map((b) => `${b.at.x},${b.at.y},${b.looted ? 1 : 0}`).join(";")}`;
    const key = [tc.canvas.width, tc.canvas.height, ts, tc.busy, tc.walkQueue.length, p.heroAt.x, p.heroAt.y, p.creatures.map((c) => `${c.at.x},${c.at.y},${creatureInSight(p, c) ? 1 : 0},${c.prone ? 1 : 0},${c.hostile ? 1 : 0}`).join(";") || "-", p.exploredRev, p.worldRev, p.boardEpoch, p.doorOpen, p.doorLocked, p.searched, p.round ? `${p.round.activeIndex},${p.round.roundNumber},${activeCombatant(p.round)?.economy.movementRemaining},${activeCombatant(p.round)?.economy.action}` : "x", tc.hover ? `${tc.hover.x},${tc.hover.y}` : "-", tc.selected ? `${tc.selected.x},${tc.selected.y}` : "-", heroDown(p), lootSig].join("|");
    if (key === tc.marksKey) return;
    tc.marksKey = key;
    if (tc.marks.width !== tc.canvas.width || tc.marks.height !== tc.canvas.height) {
      tc.marks.width = tc.canvas.width;
      tc.marks.height = tc.canvas.height;
    }
    const ctx = tc.marks.getContext("2d")!;
    ctx.clearRect(0, 0, tc.marks.width, tc.marks.height);
    drawLootMarks(ctx, p, ts);
    for (const c of p.creatures) if (c.prone && creatureInSight(p, c)) drawProneMark(ctx, c.at, ts);
    if (heroDown(p)) return;
    const NEUTRAL = "rgba(255, 245, 210, 0.95)";
    const ring = (at: XY, colour: string, width = Math.max(2, ts / 14)): void => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.strokeRect(at.x * ts + 3, at.y * ts + 3, ts - 6, ts - 6);
    };
    // The selected square keeps its ring while the hero walks there.
    if (tc.selected && sightLevel(p, tc.selected) > 0) ring(tc.selected, NEUTRAL);
    if (tc.busy || tc.walkQueue.length > 0) return;
    // The squares this turn's movement reaches, in a fight.
    if (heroesTurn(p)) {
      ctx.fillStyle = "rgba(110, 170, 255, 0.16)";
      for (const t of reachableTiles(heroField(p))) {
        ctx.fillRect(t.x * ts + 1, t.y * ts + 1, ts - 2, ts - 2);
      }
    }
    if (!plan || plan.kind === "none") {
      // The one hint the board gives: a square the hero has seen and cannot go to.
      if (plan && plan.reason && tc.hover && sightLevel(p, tc.hover) > 0) ring(tc.hover, "rgba(235, 70, 60, 0.7)", 2);
      return;
    }
    // The path as dots, a ring on the square, and the walk's length in feet. A way out that can be entered gets the one gold ring and its name.
    const exit = plan.kind === "walk" ? plan.exit : undefined;
    ctx.fillStyle = NEUTRAL;
    for (const t of plan.path) {
      ctx.beginPath();
      ctx.arc((t.x + 0.5) * ts, (t.y + 0.5) * ts, Math.max(2, ts / 10), 0, Math.PI * 2);
      ctx.fill();
    }
    ring(plan.tile, exit ? "rgba(255, 205, 90, 0.95)" : NEUTRAL);
    const words = exit ? exit.exit.label : plan.costFt > 0 ? `${plan.costFt} ft` : "";
    if (!words) return;
    const end = exit ? plan.tile : (plan.path[plan.path.length - 1] ?? plan.tile);
    const fontPx = Math.max(11, Math.round(ts / 4));
    ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const tx = (end.x + 0.5) * ts;
    const ty = end.y * ts + 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(20, 16, 24, 0.9)";
    ctx.strokeText(words, tx, ty);
    ctx.fillStyle = exit ? "#ffe3a3" : "#fff6dc";
    ctx.fillText(words, tx, ty);
  }

  // What the other modules call or read.
  tc.tileAt = tileAt;
  tc.toHost = toHost;
  tc.headOf = headOf;
  tc.planFor = planFor;
  tc.drawMarks = drawMarks;
  tc.approachCost = approachCost;
  tc.walkThen = walkThen;
}
