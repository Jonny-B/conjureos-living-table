/**
 * The animated cast: every character the game uses, rendered by
 * scripts/kaykit/cast.py through the same pipeline as the KayKit Knight
 * (same camera, framing and styles), with each hero's gear as separate
 * animated layers so whatever is worn shows on the moving figure. The
 * exception is a figure kept hand-drawn (the goblin, or any creature not yet
 * rendered): it has no frames here and is posed from its one drawing by
 * spritePose, at the end of this file.
 *
 * Packed by scripts/kaykit/pack-cast.mjs and handed in by the host
 * (bindCastSource). Per clip: every frame's palette indices (255
 * transparent), concatenated, zlib, base64, decoded here with the browser's
 * DecompressionStream.
 *
 * This file is the Play tab's motion engine, with no DOM beyond the decoded
 * frame canvases, so a different front end (a point-and-move board, say) can
 * sit on it unchanged:
 *   - the frame cache, with a prioritised pre-decode queue (castPrefetch) so a
 *     figure never has to wait for a clip it is about to play;
 *   - the Actor: clips, facing, steps between tiles, and a walk cycle that
 *     carries from one step into the next (startStep, actorAt, actorClip,
 *     actorFrame);
 *   - camera maths (cameraTarget, easeToward) that follows a drawn position
 *     without jumps.
 */

export type CastDir = "down" | "right" | "up" | "left";
export const CAST_DIRS: readonly CastDir[] = ["down", "right", "up", "left"];
export const CAST_CLIPS = ["idle", "walk", "attack", "hit", "death", "interact", "cheer"] as const;
export type CastClipId = (typeof CAST_CLIPS)[number];

export interface CastSizeMeta {
  tokenW: number;
  tokenH: number;
  canvasW: number;
  canvasH: number;
  anchorX: number;
  anchorY: number;
}

export interface CastClip {
  size: string;
  clip: CastClipId;
  dir: CastDir;
  count: number;
  loop: boolean;
  fps: number;
  data: string;
  /**
   * Walk clips only: how many tile steps one pass of the cycle spans. A
   * rendered walk is two footfalls (left, right), so 2, and that is what a
   * clip without this means; a hand-drawn bob is one footfall, so 1. The
   * walk is played by distance walked, not by the clock: one step is
   * 1/stride of the cycle, so the feet land once per tile.
   */
  stride?: number;
}

export interface CastCharacter {
  id: string;
  label: string;
  kind: "hero" | "monster" | "npc";
  archetype: string | null;
  model: string;
  standIn: boolean;
  notes: string;
  sizes: Record<string, CastSizeMeta>;
  clips: CastClip[];
}

export interface CastGear {
  id: string;
  archetype: string;
  /** The cast character this piece is worn by (its body is the holdout). */
  character?: string;
  role: string;
  tier: string;
  label: string;
  clips: CastClip[];
}

export interface CastStyle {
  style: string;
  label: string;
  description: string;
  characters: CastCharacter[];
  gear: CastGear[];
  /** Draw order of gear roles per facing, bottom first: the Knight's. */
  layerOrder: Record<CastDir, string[]>;
  /** The same per hero archetype; wins over layerOrder when present. */
  layerOrderByArchetype?: Record<string, Record<CastDir, string[]>>;
}

export interface CastData {
  palette: [number, number, number][];
  cameraPitchDeg: number;
  styles: CastStyle[];
}

/** Where the cast comes from: the host's `art.cast()`, passed through as a function. */
export type CastSource = () => CastData | null;

let source: CastSource | null = null;
let cached: CastData | null = null;

/**
 * Point this module at the host's cast (`() => host.art.cast()?.data ?? null`).
 * Binding clears what was cached, so a rebind (a new host, a new art choice) is
 * seen at once. Returns an unbind function that is a token: unbinding after a
 * later bind has taken over does nothing. The cast is the host's to find or
 * fetch; this module never reads the page.
 */
export function bindCastSource(next: CastSource | null): () => void {
  source = next;
  cached = null;
  return () => {
    if (source === next) {
      source = null;
      cached = null;
    }
  };
}

/**
 * The host's cast, or null when it has none (the figures are then drawn as
 * static tokens). A found cast is kept until the next bind; null is asked for
 * again each time, so a cast that arrives late is picked up, which means the
 * host's cast() must be cheap to call.
 */
export function castData(): CastData | null {
  if (cached) return cached;
  if (!source) return null;
  let data: CastData | null = null;
  try {
    data = source();
  } catch {
    data = null;
  }
  cached = data && Array.isArray(data.styles) && data.styles.length > 0 ? data : null;
  return cached;
}

// One lookup per (entry, size, clip, facing), however often a draw loop asks.
const clipLookups = new WeakMap<object, Map<string, CastClip | null>>();

export function findCastClip(entry: { clips: CastClip[] }, size: string, clip: CastClipId, dir: CastDir): CastClip | null {
  let byKey = clipLookups.get(entry.clips);
  if (!byKey) clipLookups.set(entry.clips, (byKey = new Map()));
  const key = `${size}|${clip}|${dir}`;
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const found = entry.clips.find((c) => c.size === size && c.clip === clip && c.dir === dir) ?? null;
  byKey.set(key, found);
  return found;
}

async function inflate(b64: string): Promise<Uint8Array> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// The frame cache. A clip is decoded once into one canvas per frame (a canvas
// pixel per sprite pixel, through the palette and an optional tier recolour)
// and kept. Two ways in: castFrames, lazily, for a panel that just asks; and
// castPrefetch, in priority order and a couple at a time, for a scene that
// knows what it is about to play. Memory is bounded: past CACHE_FRAME_BUDGET
// the least recently used clips go, except the ones the latest prefetch named.
// ---------------------------------------------------------------------------

export type CastRemap = Readonly<Record<number, number>>;

/** One clip a scene wants decoded: which owner (a character or a gear piece, per style), which clip, and the tier recolour it is worn in. */
export interface CastClipRequest {
  ownerKey: string;
  clip: CastClip;
  meta: CastSizeMeta;
  remap: CastRemap | null;
}

interface CacheEntry {
  frames: HTMLCanvasElement[];
  used: number;
}

const CACHE_FRAME_BUDGET = 4000;
const PREFETCH_PARALLEL = 2;

const ready = new Map<string, CacheEntry>();
const pending = new Set<string>();
// One Set per clip, so a draw loop that asks every frame registers its stable
// callback once, not once per frame.
const listeners = new Map<string, Set<() => void>>();
let cachedFrames = 0;
let useTick = 0;
let pinned: ReadonlySet<string> = new Set();

const remapKeys = new WeakMap<object, string>();

function remapKeyOf(remap: CastRemap | null): string {
  if (!remap) return "";
  let k = remapKeys.get(remap);
  if (k === undefined) {
    k = Object.entries(remap)
      .map(([a, b]) => `${a}>${b}`)
      .join(",");
    remapKeys.set(remap, k);
  }
  return k;
}

/** The cache key of one clip as worn: the same string castFrames, castPrefetch and castFramesIfReady agree on. */
export function castClipKey(ownerKey: string, clip: CastClip, remap: CastRemap | null): string {
  return `${ownerKey}|${clip.size}|${clip.clip}|${clip.dir}|${remapKeyOf(remap)}`;
}

function evict(except: string): void {
  if (cachedFrames <= CACHE_FRAME_BUDGET) return;
  const victims = [...ready.entries()].filter(([k]) => k !== except && !pinned.has(k)).sort((a, b) => a[1].used - b[1].used);
  for (const [k, e] of victims) {
    if (cachedFrames <= CACHE_FRAME_BUDGET * 0.8) break;
    ready.delete(k);
    cachedFrames -= e.frames.length;
  }
}

function buildFrames(raw: Uint8Array, palette: [number, number, number][], clip: CastClip, meta: CastSizeMeta, remap: CastRemap | null): HTMLCanvasElement[] {
  const per = meta.canvasW * meta.canvasH;
  const frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < clip.count; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = meta.canvasW;
    canvas.height = meta.canvasH;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(meta.canvasW, meta.canvasH);
    for (let p = 0; p < per; p++) {
      let idx = raw[i * per + p]!;
      if (idx === 255) continue;
      if (remap && remap[idx] !== undefined) idx = remap[idx]!;
      const rgb = palette[idx] ?? [255, 0, 255];
      img.data[p * 4] = rgb[0];
      img.data[p * 4 + 1] = rgb[1];
      img.data[p * 4 + 2] = rgb[2];
      img.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    frames.push(canvas);
  }
  return frames;
}

/** Decode one clip into the cache. Never rejects: a clip that cannot be decoded stays "pending" so nothing asks again in a loop. */
function startDecode(key: string, palette: [number, number, number][], clip: CastClip, meta: CastSizeMeta, remap: CastRemap | null): Promise<void> {
  pending.add(key);
  return inflate(clip.data)
    .then((raw) => {
      const frames = buildFrames(raw, palette, clip, meta, remap);
      pending.delete(key);
      ready.set(key, { frames, used: ++useTick });
      cachedFrames += frames.length;
      evict(key);
      const waiting = listeners.get(key);
      listeners.delete(key);
      waiting?.forEach((fn) => fn());
    })
    .catch((err: unknown) => {
      console.error("cast clip failed to decode", key, err);
    });
}

/**
 * A clip's frames as canvases, if decoded already; otherwise null, and
 * decoding starts (onReady fires once). Synchronous so a draw loop never
 * awaits. For a scene that knows what it needs, castPrefetch ahead of time
 * and read with castFramesIfReady.
 */
export function castFrames(
  palette: [number, number, number][],
  ownerKey: string,
  clip: CastClip,
  meta: CastSizeMeta,
  remap: CastRemap | null,
  onReady?: () => void,
): HTMLCanvasElement[] | null {
  const key = castClipKey(ownerKey, clip, remap);
  const done = ready.get(key);
  if (done) {
    done.used = ++useTick;
    return done.frames;
  }
  if (onReady) {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(onReady);
  }
  if (!pending.has(key)) void startDecode(key, palette, clip, meta, remap);
  return null;
}

/** A clip's frames if they are decoded now; never starts a decode and never waits. */
export function castFramesIfReady(key: string): HTMLCanvasElement[] | null {
  const done = ready.get(key);
  if (!done) return null;
  done.used = ++useTick;
  return done.frames;
}

interface Queued {
  key: string;
  palette: [number, number, number][];
  req: CastClipRequest;
  onDone?: () => void;
}

let queue: Queued[] = [];
let inflight = 0;

function pump(): void {
  while (inflight < PREFETCH_PARALLEL && queue.length > 0) {
    const q = queue.shift()!;
    if (ready.has(q.key) || pending.has(q.key)) continue;
    inflight++;
    void startDecode(q.key, q.palette, q.req.clip, q.req.meta, q.req.remap).then(() => {
      inflight--;
      q.onDone?.();
      pump();
    });
  }
}

/**
 * Decode these clips, in this order, a couple at a time (so the main thread
 * is never flooded and a frame is never starved). Whatever an earlier call
 * had not started yet is dropped: the newest request is the scene as it is
 * now. `onProgress` fires as each clip lands; the caller should only mark
 * itself dirty there, not draw. These clips are also protected from eviction
 * until the next call.
 */
export function castPrefetch(palette: [number, number, number][], requests: readonly CastClipRequest[], onProgress?: () => void): void {
  const wanted = new Set<string>();
  const fresh: Queued[] = [];
  for (const req of requests) {
    const key = castClipKey(req.ownerKey, req.clip, req.remap);
    if (wanted.has(key)) continue;
    wanted.add(key);
    const done = ready.get(key);
    if (done) {
      done.used = ++useTick;
      continue;
    }
    if (pending.has(key)) continue;
    fresh.push({ key, palette, req, onDone: onProgress });
  }
  pinned = wanted;
  queue = fresh;
  pump();
}

/** How much is decoded and what is still to come: for the bench's own diagnostics. */
export function castCacheStats(): { clips: number; frames: number; queued: number; decoding: number } {
  return { clips: ready.size, frames: cachedFrames, queued: queue.length, decoding: pending.size };
}

/** Which frame of a clip shows `ms` after it started. A once-clip holds its last frame. */
export function castFrameIndex(c: CastClip, ms: number): number {
  const i = Math.floor((Math.max(0, ms) / 1000) * c.fps);
  return c.loop ? i % c.count : Math.min(i, c.count - 1);
}

export function castClipMs(c: CastClip): number {
  return (c.count / c.fps) * 1000;
}

/** Facing for a step or a target offset: the larger axis wins, horizontal on a tie. */
export function castDirToward(dx: number, dy: number): CastDir {
  if (dx === 0 && dy === 0) return "down";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

// ---------------------------------------------------------------------------
// Actor: what one figure on the board is doing. Pure bookkeeping; drawing
// lives with the panel.
//
// Walking is played by distance, not by the clock. A step takes STEP_MS and
// covers 1/stride of the walk cycle (a rendered walk is two footfalls, so one
// footfall per tile), and the cycle CARRIES from one step into the next: the
// second tile starts on the other foot, not back at frame 0. Walking only
// ends when a short grace (WALK_GRACE_MS) passes with no further step, so
// back-to-back steps never flash the idle in between.
// ---------------------------------------------------------------------------

export interface Actor {
  dir: CastDir;
  clip: CastClipId;
  clipStart: number;
  queue: CastClipId[];
  /**
   * A step in progress, so a move reads as a walk rather than a jump: where
   * it set off from (the DRAWN position at the time, so a step begun mid-step
   * continues from where the figure is) and when it starts (in the future
   * when queued behind a flinch). Where it is heading is the figure's logical
   * tile, passed to actorAt.
   */
  tween: { from: { x: number; y: number }; start: number } | null;
  /** The walk cycle's place: steps landed since the figure last stood still, and when the last one landed. */
  gait: { steps: number; lastEnd: number } | null;
}

/** One tile, in ms. Half a walk cycle per tile, so a rendered walk plays at 14.3 fps against its authored 7.5. */
export const STEP_MS = 280;
/** How long a walker keeps its stride after a step lands, waiting for the next, before it settles to idle. */
export const WALK_GRACE_MS = 150;

export function newActor(dir: CastDir = "down"): Actor {
  return { dir, clip: "idle", clipStart: performance.now(), queue: [], tween: null, gait: null };
}

function landStep(actor: Actor, endsAt: number): void {
  actor.tween = null;
  if (actor.gait) {
    actor.gait.steps++;
    actor.gait.lastEnd = endsAt;
  }
}

function strideHeld(actor: Actor, now: number): boolean {
  return actor.tween !== null || (actor.gait !== null && now - actor.gait.lastEnd < WALK_GRACE_MS);
}

/** Is a step still playing at `now`? A step begins no earlier than its start, so one queued for later counts as busy too. */
export function stepBusy(actor: Actor, now: number): boolean {
  return actor.tween !== null && now < actor.tween.start + STEP_MS;
}

/**
 * Begin a step from `from` (where the figure is DRAWN right now, never its
 * old logical tile) at `start`. A step that begins within the grace of the
 * last one continues the walk cycle; a step begun while another is still
 * running counts that one as taken and carries on from where the figure is.
 */
export function startStep(actor: Actor, from: { x: number; y: number }, start: number): void {
  if (actor.tween) landStep(actor, Math.min(start, actor.tween.start + STEP_MS));
  const g = actor.gait;
  if (!g || start - g.lastEnd > WALK_GRACE_MS) actor.gait = { steps: 0, lastEnd: start };
  actor.tween = { from: { x: from.x, y: from.y }, start };
}

/**
 * Start a sequence of clips now (the first plays at once, the rest follow). A
 * walk asked for while one is under way is NOT restarted: the stride carries
 * on and only what follows it changes.
 */
export function playClips(actor: Actor, clips: CastClipId[], now: number = performance.now()): void {
  if (clips.length === 0) return;
  if (clips[0] === "walk" && actor.clip === "walk" && strideHeld(actor, now)) {
    actor.queue = clips.slice(1);
    return;
  }
  actor.clip = clips[0]!;
  actor.clipStart = now;
  actor.queue = clips.slice(1);
}

/**
 * The clip showing now, after moving through anything queued. Walking lasts
 * while a step is playing and a grace after it (none when another clip is
 * queued behind it); a finished once-clip hands over to the queue, then to
 * idle (or holds death when `down` is true). Call actorAt first in a frame,
 * so a step that has landed is known to have.
 */
export function actorClip(actor: Actor, entry: { clips: CastClip[] }, size: string, down: boolean, now: number): CastClip | null {
  for (let guard = 0; guard < 8; guard++) {
    const c = findCastClip(entry, size, actor.clip, actor.dir);
    if (!c) return findCastClip(entry, size, "idle", actor.dir);
    const elapsed = now - actor.clipStart;
    let done: boolean;
    if (actor.clip === "walk") {
      const stepping = actor.tween !== null;
      const lingering = !stepping && actor.queue.length === 0 && actor.gait !== null && now - actor.gait.lastEnd < WALK_GRACE_MS;
      done = !stepping && !lingering;
    } else {
      done = !c.loop && elapsed >= castClipMs(c);
    }
    if (!done || actor.clip === "death" || (actor.clip === "idle" && actor.queue.length === 0)) return c;
    actor.clip = actor.queue.shift() ?? (down ? "death" : "idle");
    actor.clipStart = now;
  }
  return findCastClip(entry, size, actor.clip, actor.dir);
}

/** Where the actor stands now: on its tile, or part-way through a step. Lands a finished step. */
export function actorAt(actor: Actor, at: { x: number; y: number }, now: number): { x: number; y: number } {
  const tw = actor.tween;
  if (!tw) return at;
  // A step queued behind another clip (a flinch, say) has a start in the future: stay put until then.
  const t = Math.max(0, Math.min(1, (now - tw.start) / STEP_MS));
  if (t >= 1) {
    landStep(actor, tw.start + STEP_MS);
    return at;
  }
  return { x: tw.from.x + (at.x - tw.from.x) * t, y: tw.from.y + (at.y - tw.from.y) * t };
}

/**
 * Which frame of `clip` the actor shows at `now`. A walk is placed by
 * distance covered (see the section header), everything else by the clock.
 */
export function actorFrame(actor: Actor, clip: CastClip, now: number): number {
  if (clip.clip === "walk" && actor.clip === "walk" && actor.gait) {
    const stride = clip.stride ?? 2;
    const tw = actor.tween;
    const into = tw ? Math.max(0, Math.min(1, (now - tw.start) / STEP_MS)) : 0;
    const phase = ((actor.gait.steps + into) / stride) % 1;
    return Math.min(clip.count - 1, Math.floor(phase * clip.count));
  }
  return castFrameIndex(clip, now - actor.clipStart);
}

// ---------------------------------------------------------------------------
// Camera: pure maths for following a DRAWN position. The panel owns the
// viewport; these only say where it should be.
// ---------------------------------------------------------------------------

/**
 * Where a viewport of `view` px should start so `focus` sits in its middle, in
 * a world `world` px long, never past either end. Null when the whole world
 * fits: nothing to scroll, so nothing should be.
 */
export function cameraTarget(focus: number, view: number, world: number): number | null {
  if (world <= view) return null;
  return Math.max(0, Math.min(world - view, focus - view / 2));
}

/** One frame of a critically damped glide toward `target`: frame-rate independent, never overshoots. */
export function easeToward(current: number, target: number, dtMs: number, tauMs: number): number {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));
}

// ---------------------------------------------------------------------------
// A figure with no rendered animation: a single hand-drawn sprite, whatever
// the token (the goblin, which the owner chose to keep on 2026-10-01, and any
// creature that has no KayKit render yet). It plays the same clips as the cast
// so the Actor drives it unchanged, but each clip is a pose of the one
// drawing (a bob, a hop, a lunge, a flinch, a fall) rather than drawn frames:
// every hand-drawn token gets a simple idle and step, and a token the art has
// no sprite for is simply not drawn. Each creature on the board has its own
// Actor, so two of them move, step and fall independently.
// spritePose is a pure function of the clip and frame, so the same frame
// always shows the same pose.
// ---------------------------------------------------------------------------

export const SPRITE_FPS = 10;

const SPRITE_FRAMES: Record<CastClipId, { count: number; loop: boolean }> = {
  idle: { count: 10, loop: true },
  walk: { count: 3, loop: true },
  attack: { count: 4, loop: false },
  hit: { count: 3, loop: false },
  death: { count: 4, loop: false },
  interact: { count: 4, loop: false },
  cheer: { count: 6, loop: false },
};

/** Clip timings for a hand-drawn figure, in the cast's clip shape (no frame data), so actorClip and castFrameIndex treat it like any cast member. */
export function spriteClips(sizes: readonly string[]): { clips: CastClip[] } {
  const clips: CastClip[] = [];
  for (const size of sizes) {
    for (const clip of CAST_CLIPS) {
      for (const dir of CAST_DIRS) {
        // The bob is one beat per tile.
        const stride = clip === "walk" ? 1 : undefined;
        clips.push({ size, clip, dir, count: SPRITE_FRAMES[clip].count, loop: SPRITE_FRAMES[clip].loop, fps: SPRITE_FPS, data: "", ...(stride ? { stride } : {}) });
      }
    }
  }
  return { clips };
}

export interface SpritePose {
  /** Offset in 16 px sprite pixels (scale by tile size / 16 to draw). */
  dx: number;
  dy: number;
  /** 0 standing, 1 lying on its side. */
  lie: number;
  /** Which way it falls: 1 clockwise, -1 the other way. */
  fall: 1 | -1;
  /** A colour wash over the drawing for this frame, or null. */
  tint: string | null;
}

const DIR_UNIT: Record<CastDir, { x: number; y: number }> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, left: { x: -1, y: 0 } };

export function spritePose(clip: CastClipId, frame: number, dir: CastDir): SpritePose {
  const pose: SpritePose = { dx: 0, dy: 0, lie: 0, fall: dir === "left" ? 1 : -1, tint: null };
  const at = <T>(values: readonly T[]): T => values[Math.min(frame, values.length - 1)]!;
  const u = DIR_UNIT[dir];
  switch (clip) {
    case "idle":
      pose.dy = frame >= 5 ? -1 : 0;
      break;
    case "walk":
      pose.dy = at([-1, -2, -1]);
      break;
    case "attack": {
      const reach = at([1, 3, 2, 0]);
      pose.dx = u.x * reach;
      pose.dy = u.y * reach;
      break;
    }
    case "hit":
      pose.dx = at([-1, 1, 0]);
      pose.tint = frame < 2 ? "rgba(214,48,48,0.55)" : null;
      break;
    case "death":
      pose.lie = at([0.25, 0.5, 0.85, 1]);
      pose.tint = frame >= 3 ? "rgba(20,16,24,0.25)" : null;
      break;
    case "interact":
      pose.dy = at([0, 1, 1, 0]);
      break;
    case "cheer":
      pose.dy = at([-1, -3, -1, 0, -2, 0]);
      break;
  }
  return pose;
}
