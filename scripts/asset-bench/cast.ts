/**
 * The animated cast on the bench: every character the game uses, rendered by
 * scripts/kaykit/cast.py through the same pipeline as the KayKit Knight
 * (same camera, framing and styles), with each hero's gear as separate
 * animated layers so whatever is worn shows on the moving figure.
 *
 * Embedded with build-bench.mjs --data kaycast=.cache/kaykit/bench-cast.json
 * (scripts/kaykit/pack-cast.mjs). Per clip: every frame's palette indices
 * (255 transparent), concatenated, zlib, base64, decoded here with the
 * browser's DecompressionStream.
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

let cached: CastData | null | undefined;

/** The embedded cast, or null when this bench was built without one. */
export function castData(): CastData | null {
  if (cached !== undefined) return cached;
  try {
    const el = typeof document !== "undefined" ? document.getElementById("bench-data-kaycast") : null;
    const parsed = el?.textContent ? (JSON.parse(el.textContent) as CastData) : null;
    cached = parsed && Array.isArray(parsed.styles) && parsed.styles.length > 0 ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function findCastClip(entry: { clips: CastClip[] }, size: string, clip: CastClipId, dir: CastDir): CastClip | null {
  return entry.clips.find((c) => c.size === size && c.clip === clip && c.dir === dir) ?? null;
}

async function inflate(b64: string): Promise<Uint8Array> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ready = new Map<string, HTMLCanvasElement[]>();
const pending = new Set<string>();
// One Set per clip, so a draw loop that asks every frame registers its stable
// callback once, not once per frame (see kaykit.ts framesNow for why).
const listeners = new Map<string, Set<() => void>>();

/**
 * A clip's frames as canvases, one canvas pixel per sprite pixel, optionally
 * through a palette remap (the game's tier recolours), if decoded already;
 * otherwise null, and decoding starts (onReady fires once). Synchronous so a
 * draw loop never awaits.
 */
export function castFrames(
  palette: [number, number, number][],
  ownerKey: string,
  clip: CastClip,
  meta: CastSizeMeta,
  remap: Readonly<Record<number, number>> | null,
  onReady?: () => void,
): HTMLCanvasElement[] | null {
  const remapKey = remap ? Object.entries(remap).map(([a, b]) => `${a}>${b}`).join(",") : "";
  const key = `${ownerKey}|${clip.size}|${clip.clip}|${clip.dir}|${remapKey}`;
  const done = ready.get(key);
  if (done) return done;
  if (onReady) {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(onReady);
  }
  if (!pending.has(key)) {
    pending.add(key);
    void inflate(clip.data).then((raw) => {
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
      ready.set(key, frames);
      const waiting = listeners.get(key);
      listeners.delete(key);
      waiting?.forEach((fn) => fn());
    });
  }
  return null;
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
// ---------------------------------------------------------------------------

export interface Actor {
  dir: CastDir;
  clip: CastClipId;
  clipStart: number;
  queue: CastClipId[];
  /** A step in progress, so a move reads as a walk rather than a jump. */
  tween: { from: { x: number; y: number }; start: number } | null;
}

export const STEP_MS = 280;

export function newActor(dir: CastDir = "down"): Actor {
  return { dir, clip: "idle", clipStart: performance.now(), queue: [], tween: null };
}

/** Start a sequence of clips now (the first plays at once, the rest follow). */
export function playClips(actor: Actor, clips: CastClipId[], now: number = performance.now()): void {
  if (clips.length === 0) return;
  actor.clip = clips[0]!;
  actor.clipStart = now;
  actor.queue = clips.slice(1);
}

/**
 * The clip showing now, after moving through anything queued. Walk plays only
 * for one step; a finished once-clip hands over to the queue, then to idle
 * (or holds death when `down` is true).
 */
export function actorClip(actor: Actor, entry: { clips: CastClip[] }, size: string, down: boolean, now: number): CastClip | null {
  for (let guard = 0; guard < 8; guard++) {
    const c = findCastClip(entry, size, actor.clip, actor.dir);
    if (!c) return findCastClip(entry, size, "idle", actor.dir);
    const elapsed = now - actor.clipStart;
    const done = actor.clip === "walk" ? elapsed >= STEP_MS : !c.loop && elapsed >= castClipMs(c);
    if (!done || actor.clip === "death" || (actor.clip === "idle" && actor.queue.length === 0)) return c;
    actor.clip = actor.queue.shift() ?? (down ? "death" : "idle");
    actor.clipStart = now;
  }
  return findCastClip(entry, size, actor.clip, actor.dir);
}

/** Where the actor stands now: on its tile, or part-way through a step. */
export function actorAt(actor: Actor, at: { x: number; y: number }, now: number): { x: number; y: number } {
  if (!actor.tween) return at;
  // A step queued behind another clip (a flinch, say) has a start in the future: stay put until then.
  const t = Math.max(0, Math.min(1, (now - actor.tween.start) / STEP_MS));
  if (t >= 1) {
    actor.tween = null;
    return at;
  }
  return { x: actor.tween.from.x + (at.x - actor.tween.from.x) * t, y: actor.tween.from.y + (at.y - actor.tween.from.y) * t };
}
