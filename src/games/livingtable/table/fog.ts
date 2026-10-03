/**
 * The fog of war and the marks the ground carries, drawn over the board.
 *
 * The shroud canvas is cols*size by rows*size SOURCE pixels (render/shroud.ts
 * builds the pixels from one sight level per square) and is stretched by CSS to
 * sit exactly over the board, pixelated, at every zoom and in both Art modes.
 * It redraws only when something changed: the sight levels, a square dissolving
 * in, a figure's headroom, or (while anything is shrouded) once per
 * SHROUD_TICK_MS for the mist's drift. There is no timer of its own: it rides
 * the stage's animation frame (stage.ts, `afterFrame`), which sleeps while the
 * tab is hidden and stops when the stage is disposed, so nothing keeps running.
 *
 * Moved out of the asset bench's registry as it was. `createFog` is the bench's
 * `shroudFrame` closure with its state made the object's own (so a second
 * window keeps its own dissolves), and it reads the art size and the reduced
 * motion flag from what it is given instead of from bench globals.
 * `portraitCanvas` takes the manifest to draw from for the same reason.
 */
import { bodySpriteId, type ArchetypeId } from "../characters/equipmentTypes";
import { spriteSizeOf, type RenderManifest } from "../render/canvasRenderer";
import { SHROUD_TICK_MS, shroudAnimates, shroudPixels } from "../render/shroud";
import { CELL_HEIGHT, CELL_WIDTH } from "../world/coordinates";
import { visibilityStates } from "../world/visibility";
import type { TableArt } from "./host";
import { heroSees, sightLevel } from "./sight";
import type { PlayState, XY } from "./state";

/** 4x4 Bayer thresholds, row-major, the same ordered dither render/shroud.ts uses for its soft edges. */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Take the fog off the half square above a figure standing on `tile`, so a head
 * that reaches into the square above it (the goblin's does) is not shrouded
 * over. The edge is dithered upward: clear against the figure, mist again half
 * a square up. Pixel coordinates are the shroud canvas's own (source pixels).
 */
export function clearHeadroom(px: Uint8ClampedArray, states: Uint8Array, tile: XY, size: number): void {
  const above = tile.y - 1;
  if (above < 0 || (states[above * CELL_WIDTH + tile.x] ?? 2) >= 2) return;
  const band = Math.max(1, Math.floor(size / 2));
  const w = CELL_WIDTH * size;
  for (let dy = 1; dy <= band; dy++) {
    const y = tile.y * size - dy;
    const keep = dy / (band + 1);
    for (let x = tile.x * size; x < (tile.x + 1) * size; x++) {
      if (keep <= (BAYER_4[((y & 3) << 2) | (x & 3)]! + 0.5) / 16) px[(y * w + x) * 4 + 3] = 0;
    }
  }
}

/** How long a square the hero has never seen takes to dissolve in. */
export const SHROUD_REVEAL_MS = 250;

export interface FogHost {
  /** The shroud canvas (cols*size by rows*size source pixels; this sizes it and its CSS box). */
  shroud: HTMLCanvasElement;
  /** The board canvas the shroud sits exactly over: the CSS box follows its pixel size. */
  canvas: HTMLCanvasElement;
  state: () => PlayState;
  /** The window's art; the shroud is drawn at the art's own resolution. */
  art: Pick<TableArt, "render">;
  reducedMotion: boolean;
}

export interface Fog {
  /** Redraw the shroud if anything it shows has changed. Called every frame, after the stage has drawn (stage.ts `afterFrame`). */
  frame(now: number, creatureTiles: readonly XY[]): void;
}

export function createFog(host: FogHost): Fog {
  const { shroud, canvas } = host;
  const shroudCtx = shroud.getContext("2d")!;
  const shroudReveal = new Float32Array(CELL_WIDTH * CELL_HEIGHT).fill(1);
  const shroudRevealAt = new Float64Array(CELL_WIDTH * CELL_HEIGHT);
  let shroudPrev: Uint8Array | null = null;
  let shroudScene: PlayState | null = null;
  let shroudEpoch = -1;
  let shroudKey = "";
  let shroudTickAt = -Infinity;

  function frame(now: number, creatureTiles: readonly XY[]): void {
    const p = host.state();
    const size = spriteSizeOf(host.art.render(p.template));
    const w = CELL_WIDTH * size;
    const h = CELL_HEIGHT * size;
    let dirty = false;
    if (shroud.width !== w || shroud.height !== h) {
      shroud.width = w;
      shroud.height = h;
      dirty = true;
    }
    const cssW = `${canvas.width}px`;
    const cssH = `${canvas.height}px`;
    if (shroud.style.width !== cssW) shroud.style.width = cssW;
    if (shroud.style.height !== cssH) shroud.style.height = cssH;

    const states = visibilityStates(heroSees(p), p.explored);
    if (shroudScene !== p || !shroudPrev || shroudEpoch !== p.boardEpoch) {
      shroudEpoch = p.boardEpoch;
      // A new scene starts clear of any dissolve in progress.
      shroudReveal.fill(1);
      shroudScene = p;
      dirty = true;
    } else {
      for (let i = 0; i < states.length; i++) {
        if (states[i] !== shroudPrev[i]) dirty = true;
        // Ground the hero has never seen dissolves in; ground it only remembered just clears.
        if (states[i] === 2 && shroudPrev[i] === 0 && !host.reducedMotion) {
          shroudReveal[i] = 0;
          shroudRevealAt[i] = now;
        } else if (states[i] !== 2) {
          shroudReveal[i] = 1;
        }
      }
    }
    shroudPrev = states;
    let revealing = false;
    for (let i = 0; i < shroudReveal.length; i++) {
      if (shroudReveal[i]! >= 1) continue;
      shroudReveal[i] = Math.min(1, (now - shroudRevealAt[i]!) / SHROUD_REVEAL_MS);
      revealing = true;
    }
    const key = `${p.heroAt.x},${p.heroAt.y}|${creatureTiles.map((t) => `${t.x},${t.y}`).join(";") || "-"}`;
    if (key !== shroudKey) {
      shroudKey = key;
      dirty = true;
    }
    const tick = shroudAnimates(states, host.reducedMotion) && now - shroudTickAt >= SHROUD_TICK_MS;
    if (!dirty && !revealing && !tick) return;
    shroudTickAt = now;

    const px = shroudPixels(states, {
      cols: CELL_WIDTH,
      rows: CELL_HEIGHT,
      tilePx: size,
      timeMs: now,
      reducedMotion: host.reducedMotion,
      reveal: revealing ? shroudReveal : undefined,
    });
    // A visible figure keeps its head: half a square of the fog above it is cleared (dithered, so it fades into the mist).
    clearHeadroom(px, states, p.heroAt, size);
    for (const t of creatureTiles) clearHeadroom(px, states, t, size);
    shroudCtx.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  }

  return { frame };
}

/** A sack, 8 by 8 source pixels, set in the bottom right of its square so a hero standing on it is not hidden: what a pile of dropped things looks like on the ground. */
const SACK_ROWS = ["...oo...", "..obbo..", "..otto..", ".obbbbo.", "obhbbbso", "obhbbsso", "obbbssso", ".oooooo."] as const;
const SACK_COLOURS: Readonly<Record<string, string>> = { o: "#3a2414", b: "#b98d52", h: "#dcb877", s: "#8a6232", t: "#b0382f" };

/**
 * What lies on the ground, drawn over the board on the marks canvas: a sack on every square with a pile, and a small gold
 * glint on a body that has not been searched yet. Only squares the hero has seen (the fog is under this canvas, not over it).
 */
export function drawLootMarks(ctx: CanvasRenderingContext2D, p: PlayState, ts: number): void {
  const u = ts / 16;
  const px = (x: number, y: number, w: number, h: number, colour: string, at: XY): void => {
    ctx.fillStyle = colour;
    ctx.fillRect(Math.round(at.x * ts + x * u), Math.round(at.y * ts + y * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u)));
  };
  for (const q of p.piles) {
    if (q.items.length === 0 || sightLevel(p, q.at) === 0) continue;
    SACK_ROWS.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const colour = SACK_COLOURS[row[rx]!];
        if (colour) px(7 + rx, 8 + ry, 1, 1, colour, q.at);
      }
    });
  }
  for (const b of p.bodies) {
    if (b.looted || sightLevel(p, b.at) === 0) continue;
    // A four-point glint in the top right corner of the square.
    px(12, 1, 1, 3, "#ffd34c", b.at);
    px(11, 2, 3, 1, "#ffd34c", b.at);
    px(12, 2, 1, 1, "#fff6dc", b.at);
  }
}

/** A small tag at the foot of a square: the creature standing there has been knocked down. (Drawn in both art modes; the animated figure also lies down.) */
export function drawProneMark(ctx: CanvasRenderingContext2D, at: XY, ts: number): void {
  const w = Math.round(ts * 0.86);
  const h = Math.max(11, Math.round(ts * 0.22));
  const x = Math.round(at.x * ts + (ts - w) / 2);
  const y = Math.round((at.y + 1) * ts - h - 1);
  ctx.fillStyle = "rgba(20, 16, 24, 0.85)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#ffb86c";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "#ffb86c";
  ctx.font = `700 ${Math.max(8, Math.round(h * 0.72))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PRONE", x + w / 2, y + h / 2 + 1);
}

/**
 * A small picture of a class for the sheet's header and the creator's class cards:
 * the archetype's own token sprite from `manifest` (the fantasy art the window is
 * showing), scaled by a whole number. Null when the art has no such token.
 */
export function portraitCanvas(manifest: RenderManifest, archetypeId: string): HTMLCanvasElement | null {
  const sprite = manifest.tokens[bodySpriteId(archetypeId as ArchetypeId)];
  const rows = sprite?.pixels;
  if (!rows || rows.length === 0) return null;
  const w = Math.max(...rows.map((r) => r.length));
  const k = Math.max(1, Math.round(72 / rows.length));
  const canvas = document.createElement("canvas");
  canvas.width = w * k;
  canvas.height = rows.length * k;
  canvas.className = "lt-item-icon";
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  rows.forEach((row, y) => {
    row.forEach((idx, x) => {
      if (idx < 0) return;
      ctx.fillStyle = manifest.palette[idx] ?? "#f0f";
      ctx.fillRect(x * k, y * k, k, k);
    });
  });
  return canvas;
}
