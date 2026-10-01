/**
 * KayKit on the bench: the Blender renders from scripts/kaykit/ (one set per
 * conversion style), decoded in the browser and drawn as sprite animations.
 *
 * The frames ride in the page as a JSON block (build-bench.mjs --data
 * kaykit=.cache/kaykit/bench-data.json, written by scripts/kaykit/pack.mjs):
 * per clip, every frame's palette indices (255 = transparent) concatenated,
 * zlib-compressed and base64-encoded. Decoding uses the browser's own
 * DecompressionStream, so nothing here is a second copy of the renderer: the
 * pixels are exactly what the harness wrote.
 */

export type KDir = "down" | "right" | "up" | "left";
export const K_DIRS: readonly KDir[] = ["down", "right", "up", "left"];
export const K_CLIPS = ["idle", "walk", "attack", "hit", "death", "interact", "cheer"] as const;
export type KClipId = (typeof K_CLIPS)[number];

export interface KSizeMeta {
  tokenW: number;
  tokenH: number;
  canvasW: number;
  canvasH: number;
  anchorX: number;
  anchorY: number;
}

export interface KClip {
  loadout: string;
  size: string;
  clip: KClipId;
  dir: KDir;
  count: number;
  loop: boolean;
  fps: number;
  data: string;
}

export interface KStyle {
  style: string;
  label: string;
  description: string;
  clips: KClip[];
}

export interface KData {
  character: string;
  source: string;
  palette: [number, number, number][];
  sizes: Record<string, KSizeMeta>;
  loadouts: { id: string; label: string }[];
  reference: string;
  cameraPitchDeg: number;
  styles: KStyle[];
}

let cached: KData | null | undefined;

/** The embedded KayKit renders, or null when this bench was built without any. */
export function kaykitData(): KData | null {
  if (cached !== undefined) return cached;
  try {
    const el = typeof document !== "undefined" ? document.getElementById("bench-data-kaykit") : null;
    const parsed = el?.textContent ? (JSON.parse(el.textContent) as KData) : null;
    cached = parsed && Array.isArray(parsed.styles) && parsed.styles.length > 0 ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function sizeIdsFor(d: KData, loadout: string): string[] {
  const ids = new Set(d.styles[0]?.clips.filter((c) => c.loadout === loadout).map((c) => c.size) ?? []);
  return Object.keys(d.sizes).filter((id) => ids.has(id));
}

export function findClip(d: KData, style: string, loadout: string, size: string, clip: KClipId, dir: KDir): KClip | null {
  return d.styles.find((s) => s.style === style)?.clips.find((c) => c.loadout === loadout && c.size === size && c.clip === clip && c.dir === dir) ?? null;
}

async function inflate(b64: string): Promise<Uint8Array> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const pending = new Map<string, Promise<HTMLCanvasElement[]>>();
const ready = new Map<string, HTMLCanvasElement[]>();
// One Set per clip, so a draw loop that asks every frame while a clip is still
// decoding registers its (stable) callback once, not once per frame. Per-frame
// registration snowballed: each resolved clip re-ran every draw, and each draw
// queued more callbacks on the clips still pending, until the page froze.
const listeners = new Map<string, Set<() => void>>();

function clipKey(style: string, c: KClip): string {
  return `${style}|${c.loadout}|${c.size}|${c.clip}|${c.dir}`;
}

/**
 * The clip's frames as canvases at one canvas pixel per sprite pixel, if they
 * are decoded already; otherwise null, and decoding starts (onReady fires once
 * they are). Synchronous on purpose so a draw loop never awaits.
 */
export function framesNow(d: KData, style: string, c: KClip, onReady?: () => void): HTMLCanvasElement[] | null {
  const key = clipKey(style, c);
  const done = ready.get(key);
  if (done) return done;
  if (!pending.has(key)) {
    const meta = d.sizes[c.size]!;
    const p = inflate(c.data).then((raw) => {
      const per = meta.canvasW * meta.canvasH;
      const frames: HTMLCanvasElement[] = [];
      for (let i = 0; i < c.count; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = meta.canvasW;
        canvas.height = meta.canvasH;
        const ctx = canvas.getContext("2d")!;
        const img = ctx.createImageData(meta.canvasW, meta.canvasH);
        for (let p2 = 0; p2 < per; p2++) {
          const idx = raw[i * per + p2]!;
          if (idx === 255) continue;
          const rgb = d.palette[idx] ?? [255, 0, 255];
          img.data[p2 * 4] = rgb[0];
          img.data[p2 * 4 + 1] = rgb[1];
          img.data[p2 * 4 + 2] = rgb[2];
          img.data[p2 * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        frames.push(canvas);
      }
      ready.set(key, frames);
      const waiting = listeners.get(key);
      listeners.delete(key);
      waiting?.forEach((fn) => fn());
      return frames;
    });
    pending.set(key, p);
  }
  if (onReady) {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(onReady);
  }
  return null;
}

/** Which frame of a clip shows `ms` after it started. A once-clip holds its last frame. */
export function frameIndex(c: KClip, ms: number): number {
  const i = Math.floor((Math.max(0, ms) / 1000) * c.fps);
  return c.loop ? i % c.count : Math.min(i, c.count - 1);
}

export function clipDurationMs(c: KClip): number {
  return (c.count / c.fps) * 1000;
}

/** Facing for a step or a target offset: the larger axis wins, horizontal on a tie. */
export function dirToward(dx: number, dy: number): KDir {
  if (dx === 0 && dy === 0) return "down";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

// ---------------------------------------------------------------------------
// The converted art library (scripts/kaykit/lib_*.py parts, packed by
// scripts/kaykit/pack-library.mjs, embedded with --data kaylib=...).
// ---------------------------------------------------------------------------

export interface KLibPart {
  file: string;
  maker: string;
  size: 16 | 32;
  style: string | null;
  sprites: { assetId: string; w: number; h: number }[];
  gaps: { assetId: string; reason: string }[];
  data: string;
}

let libCached: KLibPart[] | null | undefined;

/** The packed library parts, or null when this bench was built without any. */
export function kaykitLibrary(): KLibPart[] | null {
  if (libCached !== undefined) return libCached;
  try {
    const el = typeof document !== "undefined" ? document.getElementById("bench-data-kaylib") : null;
    const parsed = el?.textContent ? (JSON.parse(el.textContent) as { parts: KLibPart[] }) : null;
    libCached = parsed && parsed.parts.length > 0 ? parsed.parts : null;
  } catch {
    libCached = null;
  }
  return libCached;
}

let libDecoded: Promise<Map<string, Map<string, number[][]>>> | null = null;

/** Every part's sprites as palette-index grids (-1 transparent), keyed by part file then asset id. Decoded once. */
export function decodeLibrary(): Promise<Map<string, Map<string, number[][]>>> {
  if (libDecoded) return libDecoded;
  const parts = kaykitLibrary() ?? [];
  libDecoded = Promise.all(
    parts.map(async (part) => {
      const raw = await inflate(part.data);
      const sprites = new Map<string, number[][]>();
      let o = 0;
      for (const s of part.sprites) {
        const rows: number[][] = [];
        for (let y = 0; y < s.h; y++) {
          const row = new Array<number>(s.w);
          for (let x = 0; x < s.w; x++) {
            const v = raw[o++]!;
            row[x] = v === 255 ? -1 : v;
          }
          rows.push(row);
        }
        sprites.set(s.assetId, rows);
      }
      return [part.file, sprites] as const;
    }),
  ).then((entries) => new Map(entries));
  return libDecoded;
}

/** The part file for a maker, size and (optional) style, as pack-library names them. */
export function partFile(maker: string, size: 16 | 32, style?: string): string {
  return style ? `${maker}-${style}-${size}.json` : `${maker}-${size}.json`;
}
