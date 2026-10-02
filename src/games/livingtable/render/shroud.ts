/**
 * The shroud: the "fog of war" overlay for the Living Table board, as pure
 * pixels. Player-facing words say "fog of war"; in code it is "shroud" so it
 * can never be confused with the game's existing "fog crossing" (walking into
 * a room that has not been built yet: `crossesIntoFog`).
 *
 * Input is one SightLevel per square (a plain Uint8Array, row-major; the
 * visibility module builds it, this file does not import it):
 *   0 never seen, 1 seen before (remembered), 2 in sight now.
 *
 * Output is an RGBA buffer at the art's own resolution (cols*tilePx by
 * rows*tilePx), meant for `new ImageData(...)` on a canvas that the caller
 * scales up with `image-rendering: pixelated`. Everything here is hard pixels:
 * no blur, no partial-alpha feathering. Soft edges are an ordered (Bayer)
 * dither, so the result stays crisp pixel art at any scale.
 *
 *   in sight (2)     alpha 0, always. A visible square is never darkened, not
 *                    even at its edges: every soft edge lives in the FOGGED
 *                    square next to it.
 *   remembered (1)   a cool blue-ink wash (about 60 percent), faint mist
 *                    texture, so walls and props still read through it.
 *   never seen (0)   deep ink (about 94 percent) with two tiling value-noise
 *                    layers in three ink shades drifting by whole source
 *                    pixels every SHROUD_TICK_MS, so it reads as slow mist.
 *
 * SOFT EDGES. Each fogged square looks at its eight neighbours; any neighbour
 * brighter than the square lifts the square's level toward that neighbour
 * along a ramp that dies out halfway across the square (so a square wholly
 * ringed by sight keeps a fogged middle instead of vanishing). The lifted
 * level is a continuous 0..2 value; a 4x4 Bayer threshold rounds it per pixel
 * to 0 (mist), 1 (remembered wash) or 2 (clear). That is the dissolve.
 *
 * Note this is the same rule the design states as "each corner takes the
 * lowest level of the squares around it", seen from the fogged side: the
 * visible side of the seam is never drawn on, so the gradient is spent
 * entirely inside the fog.
 *
 * REVEAL. A square that just came into sight can carry a reveal value below 1
 * (the caller animates it over about 250 ms). Its pixels dissolve from the
 * never-seen mist to clear through the same Bayer threshold.
 *
 * DETERMINISTIC. No Math.random: noise tiles are built once per module from a
 * fixed integer hash, and the drift offset is a pure function of timeMs. The
 * same (states, opts) always yield the same pixels. With reducedMotion the
 * drift offset is pinned to zero and reveal is treated as 1.
 *
 * No DOM at import time (the bench imports this in Node); only `drawShroud`
 * touches a context, and only the one passed in.
 */

export interface ShroudOptions {
  cols: number;
  rows: number;
  /** Source pixels per square, e.g. 16. */
  tilePx: number;
  timeMs: number;
  reducedMotion: boolean;
  /** Per square 0..1: how far a newly seen square has dissolved in. Absent means all 1. */
  reveal?: Float32Array;
}

/** Suggested drift tick: the caller redraws about 5 times a second while anything is shrouded. */
export const SHROUD_TICK_MS = 200;

// ---------------------------------------------------------------------------
// Palette. Ink, not black: a cool blue-violet so the board stays in key.
// ---------------------------------------------------------------------------

// Never seen: three ink shades picked by the drifting noise, alpha 0.92..0.97.
const MIST: ReadonlyArray<readonly [number, number, number, number]> = [
  [5, 7, 18, 248], // deepest
  [11, 14, 32, 241], // mid
  [17, 22, 45, 236], // lightest wisp
];

// Remembered: one cool wash, alpha about 0.6, with a faint +/- texture.
const MEMORY_RGB: readonly [number, number, number] = [13, 19, 44];
const MEMORY_ALPHA: readonly [number, number, number] = [160, 153, 146];

// ---------------------------------------------------------------------------
// Noise: two tileable value-noise layers, built once. Whole-pixel lookups
// only, so the drift is crisp.
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** size must be a multiple of cell; both are powers of two so lookups mask. */
function valueNoise(size: number, cell: number, seed: number): Uint8Array {
  const lattice = size / cell;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      const fx = smooth((x % cell) / cell);
      const fy = smooth((y % cell) / cell);
      const x0 = gx % lattice;
      const y0 = gy % lattice;
      const x1 = (gx + 1) % lattice;
      const y1 = (gy + 1) % lattice;
      const top = hash2(x0, y0, seed) * (1 - fx) + hash2(x1, y0, seed) * fx;
      const bot = hash2(x0, y1, seed) * (1 - fx) + hash2(x1, y1, seed) * fx;
      out[y * size + x] = Math.round((top * (1 - fy) + bot * fy) * 255);
    }
  }
  return out;
}

const A_SIZE = 64;
const B_SIZE = 128;
const NOISE_A = valueNoise(A_SIZE, 8, 11);
const NOISE_B = valueNoise(B_SIZE, 16, 29);

/**
 * The mist shade (0 deepest .. 2 lightest) at source pixel (x, y) for a drift
 * tick. The two layers move at different speeds and in different directions:
 * A one pixel right per tick; B one pixel left per two ticks and one pixel
 * down per three.
 */
function shadeAt(x: number, y: number, tick: number): number {
  const ax = (x + tick) & (A_SIZE - 1);
  const ay = y & (A_SIZE - 1);
  const bx = (x - Math.floor(tick / 2)) & (B_SIZE - 1);
  const by = (y + Math.floor(tick / 3)) & (B_SIZE - 1);
  const v = NOISE_A[ay * A_SIZE + ax]! * 0.55 + NOISE_B[by * B_SIZE + bx]! * 0.45;
  return v < 112 ? 0 : v < 146 ? 1 : 2;
}

// 4x4 Bayer matrix, thresholds in (0, 1).
const BAYER = new Float32Array(16);
{
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let i = 0; i < 16; i++) BAYER[i] = (m[i]! + 0.5) / 16;
}

/** How far into a fogged square (as a fraction of the square) a lift reaches. */
const RAMP = 0.5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** True when anything is shrouded and motion is allowed: the caller then ticks every SHROUD_TICK_MS. */
export function shroudAnimates(states: Uint8Array, reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  for (let i = 0; i < states.length; i++) if (states[i]! < 2) return true;
  return false;
}

/** Build the shroud overlay: RGBA, width cols*tilePx, height rows*tilePx. */
export function shroudPixels(states: Uint8Array, opts: ShroudOptions): Uint8ClampedArray {
  const { cols, rows, tilePx: P } = opts;
  const W = cols * P;
  const H = rows * P;
  const out = new Uint8ClampedArray(W * H * 4); // zero = transparent
  const still = opts.reducedMotion;
  const tick = still ? 0 : Math.floor(opts.timeMs / SHROUD_TICK_MS) | 0;
  const reveal = still ? undefined : opts.reveal;

  const level = (c: number, r: number, fallback: number): number =>
    c < 0 || r < 0 || c >= cols || r >= rows ? fallback : (states[r * cols + c] ?? 0);

  // Reused per tile: the neighbours that are brighter than the square.
  const lifts = new Float32Array(8 * 4); // [dx, dy, lift, _] per entry
  const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  const put = (x: number, y: number, lv: number, shadeLevel: number): void => {
    // lv 2 is clear (already zero); 1 remembered wash; 0 mist.
    if (lv >= 2) return;
    const o = (y * W + x) * 4;
    if (lv === 1) {
      out[o] = MEMORY_RGB[0];
      out[o + 1] = MEMORY_RGB[1];
      out[o + 2] = MEMORY_RGB[2];
      out[o + 3] = MEMORY_ALPHA[shadeLevel]!;
    } else {
      const m = MIST[shadeLevel]!;
      out[o] = m[0];
      out[o + 1] = m[1];
      out[o + 2] = m[2];
      out[o + 3] = m[3];
    }
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = states[r * cols + c] ?? 0;
      const x0 = c * P;
      const y0 = r * P;

      if (s >= 2) {
        // Visible: clear unless it is still dissolving in.
        const rv = reveal ? (reveal[r * cols + c] ?? 1) : 1;
        if (rv >= 1) continue;
        for (let y = y0; y < y0 + P; y++) {
          for (let x = x0; x < x0 + P; x++) {
            if (BAYER[((y & 3) << 2) | (x & 3)]! >= rv) put(x, y, 0, shadeAt(x, y, tick));
          }
        }
        continue;
      }

      // Fogged: gather the brighter neighbours that can lift this square.
      let n = 0;
      for (let k = 0; k < 8; k++) {
        const [dx, dy] = NEIGHBOURS[k]!;
        const nl = level(c + dx, r + dy, s);
        if (nl > s) {
          lifts[n * 4] = dx;
          lifts[n * 4 + 1] = dy;
          lifts[n * 4 + 2] = nl - s;
          n++;
        }
      }

      for (let y = y0; y < y0 + P; y++) {
        const v = (y - y0 + 0.5) / P;
        for (let x = x0; x < x0 + P; x++) {
          let lv = s;
          if (n > 0) {
            const u = (x - x0 + 0.5) / P;
            let lift = 0;
            for (let i = 0; i < n; i++) {
              const dx = lifts[i * 4]!;
              const dy = lifts[i * 4 + 1]!;
              // Distance from the shared edge or corner, as a fraction of a square.
              const du = dx < 0 ? u : dx > 0 ? 1 - u : 0;
              const dv = dy < 0 ? v : dy > 0 ? 1 - v : 0;
              const d = Math.sqrt(du * du + dv * dv);
              const t = 1 - d / RAMP;
              if (t > 0) {
                const l = lifts[i * 4 + 2]! * t;
                if (l > lift) lift = l;
              }
            }
            lv = Math.min(2, Math.floor(s + lift + BAYER[((y & 3) << 2) | (x & 3)]!));
          }
          put(x, y, lv, shadeAt(x, y, tick));
        }
      }
    }
  }
  return out;
}

/** Thin wrapper: paint the shroud at 0,0. The canvas is sized cols*tilePx by rows*tilePx by the caller. */
export function drawShroud(ctx: CanvasRenderingContext2D, states: Uint8Array, opts: ShroudOptions): void {
  const px = shroudPixels(states, opts);
  ctx.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, opts.cols * opts.tilePx, opts.rows * opts.tilePx), 0, 0);
}
