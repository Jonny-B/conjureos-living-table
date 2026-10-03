/**
 * The table's figures: one creature drawn as a body plus whatever it wears, or
 * as a hand-drawn token, and the lookups that find its animation frames.
 *
 * A cast figure is a body clip with a stack of gear clips over it, every piece
 * the same clip, facing and frame, so they register pixel for pixel. A
 * hand-drawn figure is one token sprite moved by a pose (cast.ts: spritePose).
 * This file holds the pure parts of that: the layer lists, the cache keys of a
 * clip's pieces, the frames to stack, the decode requests, "what did this
 * figure last show", and the token canvases. Nothing here keeps a module-level
 * clock or touches the page at import; the canvases are made on demand.
 *
 * Moved out of the asset bench's registry as it was, with two changes. The
 * bench's `castStyleNow()` (the style the Art row picked) is gone from here:
 * the stage asks the host (`host.art.cast()`), and a figure takes the style it
 * is given. And `keptHandDrawn()` (which reads the bench's KayKit library) stays
 * with the bench.
 */
import { renderPlanFor } from "../menu/equipment";
import { spriteSizeOf, type RenderManifest } from "../render/canvasRenderer";
import type { CharacterSheet } from "../characters/creation";
import {
  CAST_DIRS,
  castClipKey,
  castFramesIfReady,
  findCastClip,
  spriteClips,
  type CastCharacter,
  type CastClip,
  type CastClipId,
  type CastClipRequest,
  type CastDir,
  type CastGear,
  type CastSizeMeta,
  type CastStyle,
  type SpritePose,
} from "./ui/cast";

/** A rectangle on the board canvas, in canvas pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The cast's entry for a token (a hero's body, a monster), or null when the style has none (a figure kept hand-drawn). */
export function castEntry(style: CastStyle, tokenId: string): CastCharacter | null {
  return style.characters.find((c) => c.id === tokenId) ?? null;
}

export interface WornLayer {
  gear: CastGear;
  remap: Readonly<Record<number, number>> | null;
}

/** What a hero sheet wears, as cast layers: renderPlanFor's sprite ids (the cast's gear ids are the same) with each tier's recolour. */
export function wornLayers(style: CastStyle, sheet: CharacterSheet): WornLayer[] {
  const plan = renderPlanFor(sheet);
  if (!plan) return [];
  const byId = new Map(style.gear.map((g) => [g.id, g]));
  return plan.layers.flatMap((l) => {
    const gear = byId.get(l.spriteId);
    return gear ? [{ gear, remap: l.remap }] : [];
  });
}

/** A hero's starting kit (every base-tier piece), for the bench's Characters tab. */
export function starterLayers(style: CastStyle, entry: CastCharacter): WornLayer[] {
  if (entry.kind !== "hero") return [];
  const prefix = `gear_${entry.id.replace(/^token_/, "")}_`;
  return style.gear
    .filter((g) => (g.character ? g.character === entry.id : g.id.startsWith(prefix)) && g.tier === "base")
    .map((gear) => ({ gear, remap: null }));
}

/** Clip timings shared by every hand-drawn figure (a simple idle bob and step, whatever the token). */
export const SPRITE_ENTRY = spriteClips(["16", "32"]);

const tokenCanvases = new WeakMap<RenderManifest, Map<string, HTMLCanvasElement>>();

/** A manifest's token sprite as a canvas at its own resolution, washed with `tint` when given. Cached per manifest, id and tint. */
export function tokenCanvas(manifest: RenderManifest, assetId: string, tint: string | null): HTMLCanvasElement | null {
  let cache = tokenCanvases.get(manifest);
  if (!cache) tokenCanvases.set(manifest, (cache = new Map()));
  const key = `${assetId}|${tint ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sprite = manifest.tokens[assetId];
  if (!sprite) return null;
  const h = sprite.pixels.length;
  const w = sprite.pixels[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = sprite.pixels[y]![x]!;
      if (idx < 0) continue;
      ctx.fillStyle = manifest.palette[idx] ?? "#ff00ff";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  if (tint) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
  }
  cache.set(key, canvas);
  return canvas;
}

/**
 * A hand-drawn figure in a pose, standing with its feet centred on
 * (feetX, feetY). `px16` is canvas pixels per 16 px sprite pixel, so a 16 px
 * drawing and its 2x upscale stand the same size. Lying down turns it about
 * its middle, so the body stays on its own tile.
 */
export function drawSpriteFigure(ctx: CanvasRenderingContext2D, manifest: RenderManifest, assetId: string, pose: SpritePose, feetX: number, feetY: number, px16: number): boolean {
  const g = spriteGeometry(manifest, assetId, pose, feetX, feetY, px16);
  if (!g) return false;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(g.tx, g.ty);
  if (pose.lie > 0) ctx.rotate((pose.fall * pose.lie * Math.PI) / 2);
  ctx.drawImage(g.sprite, -g.w / 2, -g.h / 2, g.w, g.h);
  ctx.restore();
  return true;
}

/** Where drawSpriteFigure puts a hand-drawn figure (its centre, and its size on the canvas), and a box that holds it at any angle, so a panel can repaint just that patch. */
export function spriteGeometry(
  manifest: RenderManifest,
  assetId: string,
  pose: SpritePose,
  feetX: number,
  feetY: number,
  px16: number,
): { sprite: HTMLCanvasElement; w: number; h: number; tx: number; ty: number; box: Box } | null {
  const sprite = tokenCanvas(manifest, assetId, pose.tint);
  if (!sprite) return null;
  const k = (px16 * 16) / spriteSizeOf(manifest);
  const w = sprite.width * k;
  const h = sprite.height * k;
  const tx = Math.round(feetX + pose.dx * px16);
  const ty = Math.round(feetY + pose.dy * px16 - h / 2 + (pose.lie * (h - w)) / 2);
  const reach = pose.lie > 0 ? Math.hypot(w, h) / 2 : null;
  const box = reach === null ? { x: tx - w / 2, y: ty - h / 2, w, h } : { x: tx - reach, y: ty - reach, w: reach * 2, h: reach * 2 };
  return { sprite, w, h, tx, ty, box };
}

/** One figure's look: a style at a size, its body, and every piece it wears. */
export interface FigureSet {
  style: CastStyle;
  entry: CastCharacter;
  size: string;
  meta: CastSizeMeta;
  layers: WornLayer[];
  /** Worn pieces in the cast's draw order for each facing, bottom first (the body is under them all). */
  byDir: Record<CastDir, WornLayer[]>;
  bodyOwner: string;
  /** Cache keys of a clip's pieces, body first, memoised per clip and facing; empty when the body lacks the clip. */
  keys: Map<string, string[]>;
}

export function buildFigureSet(style: CastStyle, entry: CastCharacter, size: string, layers: WornLayer[]): FigureSet | null {
  const meta = entry.sizes[size];
  if (!meta) return null;
  const byDir = {} as Record<CastDir, WornLayer[]>;
  for (const dir of CAST_DIRS) {
    const order = (entry.archetype ? style.layerOrderByArchetype?.[entry.archetype]?.[dir] : undefined) ?? style.layerOrder[dir] ?? [];
    const rank = (role: string) => {
      const i = order.indexOf(role);
      return i < 0 ? order.length : i;
    };
    byDir[dir] = [...layers].sort((a, b) => rank(a.gear.role) - rank(b.gear.role));
  }
  return { style, entry, size, meta, layers, byDir, bodyOwner: `${style.style}|${entry.id}`, keys: new Map() };
}

export function pieceKeys(set: FigureSet, clip: CastClipId, dir: CastDir): string[] {
  const id = `${clip}|${dir}`;
  let keys = set.keys.get(id);
  if (!keys) {
    keys = [];
    const body = findCastClip(set.entry, set.size, clip, dir);
    if (body) {
      keys.push(castClipKey(set.bodyOwner, body, null));
      for (const l of set.byDir[dir]) {
        const lc = findCastClip(l.gear, set.size, clip, dir);
        if (lc) keys.push(castClipKey(`${set.style.style}|${l.gear.id}`, lc, l.remap));
      }
    }
    set.keys.set(id, keys);
  }
  return keys;
}

/** One frame of a figure, body then each worn piece, as the canvases to stack; null unless every piece is decoded now. Never starts a decode. */
export function setFrames(set: FigureSet, clip: CastClipId, dir: CastDir, frame: number): HTMLCanvasElement[] | null {
  const keys = pieceKeys(set, clip, dir);
  if (keys.length === 0) return null;
  const out: HTMLCanvasElement[] = [];
  for (const key of keys) {
    const frames = castFramesIfReady(key);
    if (!frames) return null;
    if (frames.length > 0) out.push(frames[Math.min(frame, frames.length - 1)]!);
  }
  return out;
}

/** The decode requests for these clips and facings, facings outermost so one facing's pieces arrive together. */
export function clipRequests(set: FigureSet, clips: readonly CastClipId[], dirs: readonly CastDir[]): CastClipRequest[] {
  const out: CastClipRequest[] = [];
  for (const dir of dirs) {
    for (const clip of clips) {
      const body = findCastClip(set.entry, set.size, clip, dir);
      if (!body) continue;
      out.push({ ownerKey: set.bodyOwner, clip: body, meta: set.meta, remap: null });
      for (const l of set.byDir[dir]) {
        const lc = findCastClip(l.gear, set.size, clip, dir);
        if (lc) out.push({ ownerKey: `${set.style.style}|${l.gear.id}`, clip: lc, meta: set.meta, remap: l.remap });
      }
    }
  }
  return out;
}

/** What a figure last showed in full: the set it was drawn from and the exact canvases stacked. */
export interface Shown {
  set: FigureSet;
  canvases: HTMLCanvasElement[];
}

/**
 * The frame to draw for a figure that wants `clip` at `frame` from `want`.
 * Never nothing once it has shown anything: the wanted look if its clip is
 * decoded; else the look it showed before (a gear or style change still
 * decoding keeps animating the old one); else the frozen last frame; and a
 * figure that has shown nothing yet takes any ready idle of the wanted look.
 */
export function resolveCast(mem: { shown: Shown | null }, want: FigureSet | null, clip: CastClip, frame: number): Shown | null {
  if (want) {
    const canvases = setFrames(want, clip.clip, clip.dir, frame);
    if (canvases) return (mem.shown = { set: want, canvases });
  }
  const prev = mem.shown?.set;
  if (prev && prev !== want) {
    const canvases = setFrames(prev, clip.clip, clip.dir, frame);
    if (canvases) return (mem.shown = { set: prev, canvases });
  }
  if (mem.shown) return mem.shown;
  if (want) {
    for (const dir of [clip.dir, ...CAST_DIRS]) {
      const canvases = setFrames(want, "idle", dir, 0);
      if (canvases) return (mem.shown = { set: want, canvases });
    }
  }
  return null;
}
