/**
 * The table's drawing engine. Everything that puts the scene on the canvas
 * lives here, apart from the window's controls, so a different front end (a
 * point-and-move board, say) can sit on it. In short:
 *
 *   ROOM    drawn once (the game's own renderCell, no tokens) into an
 *           offscreen canvas and rebuilt only when tiles, props, art, detail
 *           or zoom change. A frame is that bitmap with the figures over it;
 *           only the patches a figure left and entered are redone.
 *   FIGURE  never empty. Every clip it can play, in all four facings, is
 *           decoded ahead for the hero (body and whatever it wears) and the
 *           monster whenever the look changes (mount, gear, art, style,
 *           detail, hero). Until a clip is ready the figure keeps its last
 *           complete frame (or the old gear's animation, or a ready idle).
 *   CAMERA  follows the hero's DRAWN position, glides, never reads the
 *           logical tile, and does not scroll at all while the room fits.
 *   PAINT   once per animation frame, from one rAF loop, and only when the
 *           canvas would differ. Callers invalidate(); they never paint.
 *
 * Moved out of the asset bench's registry as it was. What changed is where it
 * reads the art from: the bench's module-level `art` choice, decoded library
 * and cast are gone, and the stage asks the host's art (`PlayStageHost.art`,
 * the window's `host.art`) once per frame instead. The reduced-motion flag is
 * handed in too, so the module holds no page state of its own and a second
 * window cannot disturb the first.
 */
import { GEAR_ROLES, bodySpriteId } from "../characters/equipmentTypes";
import type { CharacterSheet } from "../characters/creation";
import { renderCell, spriteSizeOf, type RenderManifest } from "../render/canvasRenderer";
import { renderPlanFor } from "../menu/equipment";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import type { TileId } from "../world/cell";
import { sceneLayout } from "./adventureRun";
import {
  SPRITE_ENTRY,
  buildFigureSet,
  castEntry,
  clipRequests,
  drawSpriteFigure,
  resolveCast,
  spriteGeometry,
  wornLayers,
  type Box,
  type FigureSet,
  type Shown,
} from "./figures";
import type { TableArt } from "./host";
import { creatureInSight, creaturesInSight, seesTile } from "./sight";
import { HERO_ID, heroDown, type PlayState, type XY } from "./state";
import {
  CAST_CLIPS,
  CAST_DIRS,
  actorAt,
  actorClip,
  actorFrame,
  castPrefetch,
  newActor,
  playClips,
  spritePose,
  type Actor,
  type CastClip,
  type CastClipId,
  type CastClipRequest,
  type CastData,
  type CastDir,
  type CastStyle,
  type SpritePose,
} from "./ui/cast";

export type { Box };

/** What one paint puts on the canvas for one figure. */
export type StageItem =
  | { kind: "cast"; canvases: HTMLCanvasElement[]; x: number; y: number; w: number; h: number }
  | { kind: "sprite"; manifest: RenderManifest; assetId: string; pose: SpritePose; feetX: number; feetY: number; px16: number; box: Box };

export function sameItems(a: readonly StageItem[], b: readonly StageItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.kind === "cast" && y.kind === "cast") {
      if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.canvases.length !== y.canvases.length) return false;
      for (let j = 0; j < x.canvases.length; j++) if (x.canvases[j] !== y.canvases[j]) return false;
    } else if (x.kind === "sprite" && y.kind === "sprite") {
      if (x.manifest !== y.manifest || x.assetId !== y.assetId || x.feetX !== y.feetX || x.feetY !== y.feetY || x.px16 !== y.px16) return false;
      if (x.pose.dx !== y.pose.dx || x.pose.dy !== y.pose.dy || x.pose.lie !== y.pose.lie || x.pose.fall !== y.pose.fall || x.pose.tint !== y.pose.tint) return false;
    } else {
      return false;
    }
  }
  return true;
}

export function boxOf(item: StageItem): Box {
  return item.kind === "cast" ? { x: item.x, y: item.y, w: item.w, h: item.h } : item.box;
}

let nextManifestId = 1;
const manifestIds = new WeakMap<RenderManifest, number>();
/** A number for a manifest object, the same each time: a cache key that changes when the art's object does. */
export function manifestId(m: RenderManifest): number {
  let id = manifestIds.get(m);
  if (id === undefined) manifestIds.set(m, (id = nextManifestId++));
  return id;
}

/** What the worn gear looks like, as a string: changes exactly when a figure would be dressed differently. */
export function equipmentSig(hero: CharacterSheet): string {
  return GEAR_ROLES.map((r) => hero.equipment?.[r]?.tier ?? "-").join(",");
}

/** The cast style the scene animates with, or null for the static tokens (no cast on offer, or no cast entry for this hero). */
export function animatedStyle(p: Pick<PlayState, "archetypeId">, style: CastStyle | null): CastStyle | null {
  if (!style) return null;
  return castEntry(style, bodySpriteId(p.archetypeId)) ? style : null;
}

/** A creature's clip timings: its cast entry, or the hand-drawn figures' shared ones (a simple idle bob and step, whatever the token). */
export function creatureTimingFor(token: TileId, style: CastStyle | null): { clips: CastClip[] } {
  return (style ? castEntry(style, token) : null) ?? SPRITE_ENTRY;
}

/** Every kind of creature the picture needs figures for: the ones on the board and the ones lying where they fell. */
export function creatureTokensOf(p: PlayState): TileId[] {
  return [...new Set([...p.creatures.map((c) => c.token), ...p.bodies.map((b) => b.token)])].sort();
}

export interface PlayStageHost {
  viewport: HTMLElement;
  canvas: HTMLCanvasElement;
  state: () => PlayState;
  /**
   * The window's art (its `host.art`): the paint-ready manifest, the animated cast with the style in use (null
   * for static tokens), and whether the art has finished loading. Asked once per frame, so the three must be
   * cheap. `render(t)` must give the SAME object until the art changes: the room bitmap is rebuilt when it does.
   */
  art: Pick<TableArt, "render" | "cast" | "ready">;
  /** Reduced motion: a clip shows its first frame, a fallen body the last frame of its fall. */
  reducedMotion: boolean;
  /** Canvas pixels per SOURCE pixel: the Zoom control. */
  zoom: () => number;
  /** Runs first in every frame, before anything is drawn: the panel's input and turn clock. */
  beforeFrame?: (now: number, dtMs: number) => void;
  /** Runs last in every frame: where each creature is drawn (none that is hidden or gone), for the fog's headroom. */
  afterFrame?: (now: number, creatureTiles: readonly XY[]) => void;
}

export interface PlayStage {
  /** Something the picture shows has changed: it is drawn on the next frame, never now. */
  invalidate(): void;
  /** Put the camera on the hero this frame instead of gliding there (a new scene). A new zoom does this on its own. */
  snapCamera(): void;
  dispose(): void;
}

export function createPlayStage(host: PlayStageHost): PlayStage {
  const { viewport, canvas } = host;
  const ctx = canvas.getContext("2d")!;
  let room: HTMLCanvasElement | null = null;
  let roomKey = "";
  /** Every pixel of the canvas needs redoing (new size, new room), not just the patches the figures moved over. */
  let full = true;
  let dirty = true;
  let items: StageItem[] = [];
  let boxes: Box[] = [];
  // What each figure last showed in full: the hero's, each creature's by id, each body's by "body:id".
  const memory = new Map<string, { shown: Shown | null }>();
  const memoryOf = (key: string): { shown: Shown | null } => {
    let m = memory.get(key);
    if (!m) memory.set(key, (m = { shown: null }));
    return m;
  };
  let lookKey = "";
  let heroSet: FigureSet | null = null;
  /** One figure set per kind of creature (by token); null for a kind with no cast entry (kept hand-drawn). */
  let creatureSets = new Map<string, FigureSet | null>();
  // The camera: where the hero was last kept in view, and whether the next frame jumps straight to it.
  const lastFocus = { x: Number.NaN, y: Number.NaN };
  let snap = true;
  let lastT = performance.now();
  let raf = 0;
  let alive = true;

  const invalidate = (): void => {
    dirty = true;
  };

  /** Re-decode what the figures need whenever the look changes: hero, gear, art, style, detail or the kinds of creature on the board. Self-detecting, so no caller has to remember to. */
  function syncLook(p: PlayState, style: CastStyle | null, cast: CastData | null, size: number): void {
    if (!style) {
      lookKey = "";
      heroSet = null;
      creatureSets = new Map();
      return;
    }
    // Until the art is decoded the scene draws at the current art's size; the real size comes next, so only the first clips are worth decoding now.
    const loading = !host.art.ready();
    const tokens = creatureTokensOf(p);
    const key = [loading ? "loading" : "ready", style.style, size, p.archetypeId, p.template, equipmentSig(p.hero), tokens.join(",")].join("|");
    if (key === lookKey) return;
    lookKey = key;
    const sz = String(size);
    const heroEntry = castEntry(style, bodySpriteId(p.archetypeId));
    heroSet = heroEntry ? buildFigureSet(style, heroEntry, sz, wornLayers(style, p.hero)) : null;
    creatureSets = new Map(
      tokens.map((t) => {
        const entry = castEntry(style, t);
        return [t, entry ? buildFigureSet(style, entry, sz, []) : null] as const;
      }),
    );
    if (!cast) return;
    const first: CastClipId[] = ["idle", "walk"];
    const rest = CAST_CLIPS.filter((c) => c !== "idle" && c !== "walk");
    const facingFirst = (d: CastDir): CastDir[] => [d, ...CAST_DIRS.filter((x) => x !== d)];
    const heroDirs = facingFirst(p.heroActor.dir);
    const requests: CastClipRequest[] = [];
    // What moves first, for the facing it is in; then everything else it can do.
    if (heroSet) requests.push(...clipRequests(heroSet, first, heroDirs));
    for (const [token, set] of creatureSets) {
      const c = p.creatures.find((x) => x.token === token);
      if (set) requests.push(...clipRequests(set, first, facingFirst(c?.actor.dir ?? "left")));
    }
    if (!loading) {
      if (heroSet) requests.push(...clipRequests(heroSet, rest, heroDirs));
      for (const [token, set] of creatureSets) {
        const c = p.creatures.find((x) => x.token === token);
        if (set) requests.push(...clipRequests(set, rest, facingFirst(c?.actor.dir ?? "left")));
      }
    }
    castPrefetch(cast.palette, requests, invalidate);
  }

  function buildRoom(p: PlayState, manifest: RenderManifest, tileScale: number, isAnimated: boolean, w: number, h: number): void {
    const layer = room ?? (room = document.createElement("canvas"));
    layer.width = w;
    layer.height = h;
    const rctx = layer.getContext("2d")!;
    rctx.imageSmoothingEnabled = false;
    const plan = renderPlanFor(p.hero);
    renderCell(rctx, sceneLayout(p, isAnimated, true), manifest, tileScale, 0, !isAnimated && plan ? { [HERO_ID]: plan } : undefined, 0);
  }

  /** Everything the room bitmap depends on. With the animated figures drawn over it that is the tiles, the props and the art; with static tokens it also holds them. */
  function roomKeyFor(p: PlayState, manifest: RenderManifest, tileScale: number, isAnimated: boolean): string {
    const scene = `${tileScale}|${p.template}|${p.floorId}|${p.doorOpen ? 1 : 0}|${p.searched ? 1 : 0}|${p.worldRev}|${p.boardEpoch}`;
    // Animated, the room is only tiles and props: the art (the manifest's own object, so its ground, detail and decoding) and the scene.
    if (isAnimated) return `a|${manifestId(manifest)}|${spriteSizeOf(manifest)}|${scene}`;
    return `${manifestId(manifest)}|${scene}|${p.archetypeId}|${p.heroAt.x},${p.heroAt.y}|${p.creatures.map((c) => `${c.id}:${c.at.x},${c.at.y},${c.hp},${creatureInSight(p, c) ? 1 : 0}`).join(";") || "-"}|${equipmentSig(p.hero)}`;
  }

  /**
   * The hero, every creature and every body (each where it fell), back to front, each standing
   * in the game's one-tile footprint with its feet on the tile's bottom edge.
   * A creature with no cast entry (kept hand-drawn) is its own drawing, posed
   * by the same clips. Returns the hero's DRAWN position, which the camera follows,
   * and where each creature in sight is drawn (the fog leaves its headroom clear).
   */
  function placeFigures(p: PlayState, now: number, style: CastStyle, manifest: RenderManifest, tileScale: number): { items: StageItem[]; hero: XY; creatureTiles: XY[] } {
    const size = String(spriteSizeOf(manifest));
    interface Fig {
      /** "hero", a creature's id, or "body:<id>:<token>:<x>,<y>": what its last full frame is remembered under. */
      key: string;
      isCreature: boolean;
      /** Lying where it fell: drawn at the end of its fall, however long ago that was. */
      isBody?: boolean;
      token: TileId;
      set: FigureSet | null;
      sprite: boolean;
      timing: { clips: CastClip[] };
      actor: Actor;
      at: XY;
      down: boolean;
    }
    const figFor = (key: string, isCreature: boolean, token: TileId, actor: Actor, at: XY, down: boolean): Fig => {
      const cast = castEntry(style, token) !== null;
      return { key, isCreature, token, set: creatureSets.get(token) ?? null, sprite: !cast, timing: creatureTimingFor(token, style), actor, at, down };
    };
    // A knocked-down creature lies in its down pose until it stands up on its turn.
    const figs: Fig[] = p.creatures.map((c) => figFor(c.id, true, c.token, c.actor, c.at, c.prone));
    const heroFig: Fig | null = heroSet ? { key: "hero", isCreature: false, token: bodySpriteId(p.archetypeId), set: heroSet, sprite: false, timing: heroSet.entry, actor: p.heroActor, at: p.heroAt, down: heroDown(p) } : null;
    if (heroFig) figs.push(heroFig);
    // Positions first, for all of them: actorAt lands a finished step, which actorClip then relies on.
    const placed = figs.map((f) => ({ f, pos: actorAt(f.actor, f.at, now) })).sort((a, b) => a.pos.y - b.pos.y);
    // The fog of war: a creature the hero cannot see is not drawn. It shows from the first square in sight, either end of its current step
    // (so it appears on the way in and is not cut off on the way out); remembered squares never show creatures.
    const creatureTiles: XY[] = [];
    for (let i = placed.length - 1; i >= 0; i--) {
      const { f, pos } = placed[i]!;
      if (!f.isCreature) continue;
      const drawn = { x: Math.round(pos.x), y: Math.round(pos.y) };
      const at = seesTile(p, f.at) ? f.at : seesTile(p, drawn) ? drawn : null;
      if (at) creatureTiles.push(at);
      else placed.splice(i, 1);
    }
    // Every body lies under everything, where it fell, until it is searched and long after (the picture does not forget).
    for (const b of p.bodies) {
      const key = `body:${b.id}:${b.token}:${b.at.x},${b.at.y}`;
      placed.unshift({ f: { ...figFor(key, false, b.token, bodyActor(key), b.at, true), isBody: true }, pos: b.at });
    }
    const out: StageItem[] = [];
    let hero: XY = p.heroAt;
    for (const { f, pos } of placed) {
      if (f.key === "hero") hero = pos;
      const c = actorClip(f.actor, f.timing, size, f.down, now);
      if (!c) continue;
      // Reduced motion shows the first frame of a clip; a body lying there is the last frame of its fall.
      const frame = host.reducedMotion ? (f.isBody ? c.count - 1 : 0) : actorFrame(f.actor, c, now);
      if (f.sprite) {
        const pose = spritePose(c.clip, frame, c.dir);
        const feetX = (pos.x + 0.5) * tileScale;
        const feetY = (pos.y + 1) * tileScale;
        const px16 = tileScale / 16;
        const g = spriteGeometry(manifest, f.token, pose, feetX, feetY, px16);
        if (g) out.push({ kind: "sprite", manifest, assetId: f.token, pose, feetX, feetY, px16, box: g.box });
        continue;
      }
      const shown = resolveCast(memoryOf(f.key), f.set, c, frame);
      if (!shown) continue;
      // The frames are in their own resolution; a stale set from another detail still lands at the right size.
      const spx = tileScale / Number(shown.set.size);
      const m = shown.set.meta;
      out.push({
        kind: "cast",
        canvases: shown.canvases,
        x: Math.round((pos.x + 0.5) * tileScale - m.anchorX * spx),
        y: Math.round((pos.y + 1) * tileScale - m.anchorY * spx),
        w: Math.round(m.canvasW * spx),
        h: Math.round(m.canvasH * spx),
      });
    }
    return { items: out, hero, creatureTiles };
  }

  /** The actor a body is drawn with: one per body, facing left, its fall played once and then held (so a kill shows the creature going down where it stood). */
  const bodyActors = new Map<string, Actor>();
  function bodyActor(key: string): Actor {
    let a = bodyActors.get(key);
    if (!a) {
      a = newActor("left");
      playClips(a, ["death"], performance.now());
      bodyActors.set(key, a);
    }
    return a;
  }

  function restore(b: Box): void {
    const x0 = Math.max(0, Math.floor(b.x) - 1);
    const y0 = Math.max(0, Math.floor(b.y) - 1);
    const x1 = Math.min(canvas.width, Math.ceil(b.x + b.w) + 1);
    const y1 = Math.min(canvas.height, Math.ceil(b.y + b.h) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(room!, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }

  function drawItem(it: StageItem): void {
    if (it.kind === "cast") {
      for (const c of it.canvases) ctx.drawImage(c, it.x, it.y, it.w, it.h);
    } else {
      drawSpriteFigure(ctx, it.manifest, it.assetId, it.pose, it.feetX, it.feetY, it.px16);
    }
  }

  /**
   * Keep the hero's DRAWN position inside the middle of the view: the view
   * moves only when the hero walks out of the middle 40 percent, and then by
   * exactly as far as the hero went, so it never lags, glides on after the
   * hero stops, or moves backward. An axis where the room fits never scrolls,
   * and while the hero stands still the player's own scrolling is left alone.
   */
  function follow(hero: XY, tileScale: number, w: number, h: number): void {
    const fx = (hero.x + 0.5) * tileScale;
    const fy = (hero.y + 0.5) * tileScale;
    if (!snap && fx === lastFocus.x && fy === lastFocus.y) return;
    lastFocus.x = fx;
    lastFocus.y = fy;
    const axis = (focus: number, view: number, world: number, current: number): number => {
      if (world <= view) return 0;
      const clamp = (v: number) => Math.max(0, Math.min(world - view, v));
      if (snap) return clamp(focus - view / 2);
      const margin = view * 0.3;
      if (focus - current < margin) return clamp(focus - margin);
      if (focus - current > view - margin) return clamp(focus - (view - margin));
      return current;
    };
    const nx = Math.round(axis(fx, viewport.clientWidth, w, viewport.scrollLeft));
    const ny = Math.round(axis(fy, viewport.clientHeight, h, viewport.scrollTop));
    snap = false;
    if (nx !== viewport.scrollLeft) viewport.scrollLeft = nx;
    if (ny !== viewport.scrollTop) viewport.scrollTop = ny;
  }

  function frame(): void {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(100, now - lastT);
    lastT = now;
    host.beforeFrame?.(now, dt);

    const p = host.state();
    const manifest = host.art.render(p.template);
    const size = spriteSizeOf(manifest);
    const tileScale = host.zoom() * size;
    const w = CELL_WIDTH * tileScale;
    const h = CELL_HEIGHT * tileScale;
    const cast = host.art.cast();
    const style = animatedStyle(p, cast?.style ?? null);
    syncLook(p, style, cast?.data ?? null, size);

    // The visible canvas keeps its size (and its pixels) unless the room changed size.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      full = true;
      snap = true;
    }
    const key = roomKeyFor(p, manifest, tileScale, style !== null);
    if (!room || key !== roomKey) {
      buildRoom(p, manifest, tileScale, style !== null, w, h);
      roomKey = key;
      full = true;
    }

    const placed: { items: StageItem[]; hero: XY; creatureTiles: XY[] } = style
      ? placeFigures(p, now, style, manifest, tileScale)
      : { items: [], hero: p.heroAt, creatureTiles: creaturesInSight(p).map((c) => c.at) };
    if (full || dirty || !sameItems(items, placed.items)) {
      ctx.imageSmoothingEnabled = false;
      if (full) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(room!, 0, 0);
      } else {
        for (const b of boxes) restore(b);
      }
      for (const it of placed.items) drawItem(it);
      items = placed.items;
      boxes = placed.items.map(boxOf);
      full = false;
      dirty = false;
    }
    follow(placed.hero, tileScale, w, h);
    host.afterFrame?.(now, placed.creatureTiles);
  }
  raf = requestAnimationFrame(frame);

  return {
    invalidate,
    snapCamera: () => {
      snap = true;
    },
    dispose: () => {
      alive = false;
      cancelAnimationFrame(raf);
    },
  };
}
