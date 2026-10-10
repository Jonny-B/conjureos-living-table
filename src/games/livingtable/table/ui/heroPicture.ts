/**
 * A picture of a playable hero for the screens outside the board: the hero choice, the maker's class cards, the character sheet's
 * header. It draws the KayKit cast figure (the board's own figure, style and worn gear, standing still in its idle animation and
 * facing the viewer) when the cast is loaded, and the screen's still picture (the hand-made pixel doll, or the class token) when it is
 * not: outside ConjureOS, on the phone app, after a failed load, or before the cast has arrived.
 *
 * The cast is one of the app's asset files and lands AFTER the first paint (host/gameArt.ts), so a screen can be open when it does.
 * A picture subscribes to the art's `onChange` and switches in place, on the same canvas, with no change to its box. The subscription
 * is held only while a picture is alive: `dispose()` ends it, and a picture whose canvas has left the page is let go by itself, so a
 * screen that is replaced or redrawn never leaves one behind.
 *
 * Everything the board does is reused, none of it is written a second time: the entry and the worn layers (figures.ts castEntry,
 * wornLayers), the figure set and its decode requests (buildFigureSet, clipRequests), the frame cache (cast.ts castFrames), the frame
 * stack (setFrames) and the idle clock (castFrameIndex). What is new is only choosing, fitting the figure in its box and the loop.
 *
 * The choosing and the fitting are pure (no page): chooseHeroArt, figureCrop, fitFigure. The service touches the page
 * only when a picture is made, so this file loads in Node.
 */
import { bodySpriteId, type ArchetypeId } from "../../characters/equipmentTypes";
import type { CharacterSheet } from "../../characters/creation";
import { buildFigureSet, castEntry, clipRequests, setFrames, wornLayers, type FigureSet } from "../figures";
import { castFrameIndex, castFrames, findCastClip, type CastCharacter, type CastData, type CastSizeMeta, type CastStyle } from "./cast";

// ---- choosing --------------------------------------------------------------------

/** What a hero picture is drawn from: the cast's figure for the hero, or the still stand-in. */
export type HeroArtChoice = { kind: "doll" } | { kind: "cast"; set: FigureSet; size: string };

/** Which art is on a picture's canvas right now. `cast` is the animated KayKit figure; `doll` is the still stand-in. */
export type HeroArtKind = "cast" | "doll";

/** The clip and the facing every portrait plays: standing in the idle animation, looking at the player. */
export const PICTURE_CLIP = "idle" as const;
export const PICTURE_FACING = "down" as const;

const DOLL: HeroArtChoice = { kind: "doll" };

/**
 * The size to draw a portrait at: the finest one the cast has for this figure's idle clip facing the viewer (a portrait is shown
 * large, so the 32 px render, not the board's 16 px one). Null when the figure has no such clip at any size.
 */
export function pictureSize(entry: CastCharacter): string | null {
  const sizes = Object.keys(entry.sizes)
    .filter((s) => /^\d+$/.test(s))
    .sort((a, b) => Number(b) - Number(a));
  return sizes.find((s) => findCastClip(entry, s, PICTURE_CLIP, PICTURE_FACING) !== null) ?? null;
}

/**
 * The art for this hero: the cast figure when the cast is on offer and has this hero's class (the same lookup the board makes:
 * the class's body token in the cast's style) with the gear the sheet wears, else the doll. A cast that lacks the class, or lacks its
 * idle clip, is the doll; so is no cast.
 */
export function chooseHeroArt(cast: { style: CastStyle } | null | undefined, sheet: CharacterSheet): HeroArtChoice {
  if (!cast || !cast.style) return DOLL;
  const entry = castEntry(cast.style, bodySpriteId(sheet.archetypeId as ArchetypeId));
  if (!entry) return DOLL;
  const size = pictureSize(entry);
  if (!size) return DOLL;
  const set = buildFigureSet(cast.style, entry, size, wornLayers(cast.style, sheet));
  return set ? { kind: "cast", set, size } : DOLL;
}

/** A short string that changes exactly when `chooseHeroArt` would pick a different figure or dress it differently. */
export function choiceKey(choice: HeroArtChoice): string {
  if (choice.kind === "doll") return "doll";
  const worn = choice.set.layers.map((l) => `${l.gear.id}:${l.remap ? Object.entries(l.remap).join(",") : ""}`).join("+");
  return `cast|${choice.set.style.style}|${choice.set.entry.id}|${choice.size}|${worn}`;
}

// ---- fitting ---------------------------------------------------------------------

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of a cast frame a portrait shows: the figure's own footprint (the token's height, which the cast was rendered into) with a margin
 * of an eighth of the token's width above and below it and the same either side of its middle, so a sword held out or a wide hat is inside
 * and the feet stand a little above the bottom of the box. Square, to fill a square box. It is worked out from the cast's size metadata
 * alone, never from the pixels, so it is the same for every hero and every set of gear: a figure does not move or change size when what it
 * wears changes. (Every piece of every hero's gear, at every tier, lies inside it.) The bottom margin is below the frame, so the crop can
 * reach past the frame's edge; `cropToFrame` cuts it back to what there is to draw.
 */
export function figureCrop(meta: CastSizeMeta): Bounds {
  const pad = Math.max(1, Math.round(meta.tokenW / 8));
  const side = meta.tokenH + 2 * pad;
  return { x: meta.anchorX - Math.round(side / 2), y: meta.anchorY - meta.tokenH - pad, w: side, h: side };
}

/** The part of `crop` that lies inside a frame of `frameW` by `frameH`: the source rectangle to copy, and how far into the crop it starts (the rest is empty margin). */
export function cropToFrame(crop: Bounds, frameW: number, frameH: number): { sx: number; sy: number; sw: number; sh: number; ox: number; oy: number } {
  const sx = Math.max(0, crop.x);
  const sy = Math.max(0, crop.y);
  return { sx, sy, sw: Math.max(0, Math.min(frameW, crop.x + crop.w) - sx), sh: Math.max(0, Math.min(frameH, crop.y + crop.h) - sy), ox: sx - crop.x, oy: sy - crop.y };
}

/**
 * Where to draw a figure of `fig` source pixels in a box of `boxW` by `boxH` device pixels: the largest WHOLE number of device pixels
 * per source pixel that fits (so every source pixel is the same size and the edges stay hard), centred. The crop already has room round the
 * figure, so none is added here. A box smaller than the figure at one to one gets the figure scaled down to fit instead of cut off.
 * `k` is device pixels per source pixel.
 */
export function fitFigure(boxW: number, boxH: number, fig: { w: number; h: number }): { k: number; x: number; y: number; w: number; h: number } {
  const ratio = Math.min(boxW / Math.max(1, fig.w), boxH / Math.max(1, fig.h));
  const k = ratio >= 1 ? Math.floor(ratio) : Math.max(0.05, ratio);
  const w = Math.round(fig.w * k);
  const h = Math.round(fig.h * k);
  return { k, x: Math.round((boxW - w) / 2), y: Math.round((boxH - h) / 2), w, h };
}

// ---- the pictures ----------------------------------------------------------------

/** What a hero picture asks for. */
export interface HeroPictureRequest {
  /** Whose picture: the class, and the gear worn (the cast's gear layers are worked out from it exactly as the board does). */
  sheet: CharacterSheet;
  /** The still stand-in for a sheet: a canvas to copy when the cast cannot be drawn. Null when there is none. */
  still: (sheet: CharacterSheet) => HTMLCanvasElement | null;
  /** The picture's size in CSS pixels, when the screen has no style rule for it (the canvas is then given this width and height). */
  box?: number;
}

export interface HeroPicture {
  /** The canvas to put on the screen. It keeps its box: only its pixels change when the art does. `data-art` says "cast" or "doll". */
  readonly canvas: HTMLCanvasElement;
  /** Which art is on the canvas now. */
  art(): HeroArtKind;
  /** Show another sheet in the same canvas (a gear preview): the cast figure re-dressed, or the still redrawn. */
  setSheet(sheet: CharacterSheet): void;
  /** Stop: give back the art subscription and the animation. Safe to call twice. */
  dispose(): void;
}

export interface HeroPictures {
  /** A live picture, or null when neither the cast nor the still can be drawn for this hero (the screen then shows its words alone). */
  picture(req: HeroPictureRequest): HeroPicture | null;
  /** End every picture and the subscription. */
  dispose(): void;
}

/** The part of the table's art a picture reads. */
export interface HeroPictureArt {
  cast(): { data: CastData; style: CastStyle } | null;
  onChange(cb: () => void): () => void;
}

/** What the service needs from the cast engine; the defaults are cast.ts and figures.ts. A test hands in stand-ins for the decoding. */
export interface HeroPictureDeps {
  /** Start decoding the idle clips of a figure and call `onReady` when one lands. */
  request(set: FigureSet, palette: CastData["palette"], onReady: () => void): void;
  /** One frame of the figure as the canvases to stack, or null until every piece is decoded. */
  frames(set: FigureSet, frame: number): HTMLCanvasElement[] | null;
}

export interface HeroPictureOptions {
  art: HeroPictureArt;
  /** Show the first frame only (the player asked for less motion). */
  reducedMotion?: boolean | (() => boolean);
  /** The page's clock in ms. Default performance.now. */
  now?: () => number;
  /** Ask for a call on the next frame; returns a way to cancel it. Default requestAnimationFrame. */
  schedule?: (cb: () => void) => () => void;
  /** A new canvas. Default document.createElement("canvas"). */
  makeCanvas?: () => HTMLCanvasElement;
  /** Device pixels per CSS pixel. Default window.devicePixelRatio. */
  pixelRatio?: () => number;
  deps?: Partial<HeroPictureDeps>;
}

/** The decode requests for a portrait's clip, started through the lazy frame cache (the board's queue is left alone). */
const defaultRequest: HeroPictureDeps["request"] = (set, palette, onReady) => {
  for (const r of clipRequests(set, [PICTURE_CLIP], [PICTURE_FACING])) castFrames(palette, r.ownerKey, r.clip, r.meta, r.remap, onReady);
};

const defaultFrames: HeroPictureDeps["frames"] = (set, frame) => setFrames(set, PICTURE_CLIP, PICTURE_FACING, frame);

/** A picture that is not on the page by this long after it was made is not coming, and is let go. */
const UNATTACHED_MS = 3000;

interface Live {
  pic: HeroPicture;
  canvas: HTMLCanvasElement;
  req: HeroPictureRequest;
  sheet: CharacterSheet;
  choice: HeroArtChoice;
  key: string;
  shown: HeroArtKind;
  /** The still, drawn once per sheet. */
  stillCanvas: HTMLCanvasElement | null;
  born: number;
  t0: number;
  wasOnPage: boolean;
  /** Something changed that needs a redraw even if the frame has not moved. */
  dirty: boolean;
  /** What the canvas last showed as a cast: the figure, the frame and the box, so an unchanged frame is not drawn again. */
  drawn: { set: FigureSet; frame: number; w: number; h: number } | null;
  onReady: () => void;
}

export function createHeroPictures(opts: HeroPictureOptions): HeroPictures {
  const now = opts.now ?? ((): number => performance.now());
  const schedule =
    opts.schedule ??
    ((cb: () => void): (() => void) => {
      const id = requestAnimationFrame(() => cb());
      return () => cancelAnimationFrame(id);
    });
  const makeCanvas = opts.makeCanvas ?? ((): HTMLCanvasElement => document.createElement("canvas"));
  const ratio = opts.pixelRatio ?? ((): number => (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1));
  const deps: HeroPictureDeps = { request: opts.deps?.request ?? defaultRequest, frames: opts.deps?.frames ?? defaultFrames };
  const reduced = (): boolean => (typeof opts.reducedMotion === "function" ? opts.reducedMotion() : opts.reducedMotion === true);

  const live = new Set<Live>();
  let unsubscribe: (() => void) | null = null;
  let cancelFrame: (() => void) | null = null;
  let disposed = false;

  const castNow = (): { data: CastData; style: CastStyle } | null => {
    try {
      return opts.art.cast();
    } catch {
      return null;
    }
  };

  /** Work out what a picture should be drawn from now, and start decoding when that is a cast figure. */
  function choose(l: Live): void {
    const cast = castNow();
    const choice = chooseHeroArt(cast, l.sheet);
    const key = choiceKey(choice);
    if (key === l.key) return;
    l.key = key;
    l.choice = choice;
    l.dirty = true;
    l.drawn = null;
    if (choice.kind === "cast" && cast) deps.request(choice.set, cast.data.palette, l.onReady);
  }

  function setArt(l: Live, kind: HeroArtKind): void {
    l.shown = kind;
    l.canvas.dataset.art = kind;
  }

  /** The doll (or the class token): the still's own pixels, one to one, in the canvas. */
  function drawStill(l: Live): void {
    const src = (l.stillCanvas ??= l.req.still(l.sheet));
    const ctx = l.canvas.getContext("2d");
    if (!ctx) return;
    if (src && src.width > 0 && src.height > 0) {
      if (l.canvas.width !== src.width || l.canvas.height !== src.height) {
        l.canvas.width = src.width;
        l.canvas.height = src.height;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
      ctx.drawImage(src, 0, 0);
    } else {
      ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    }
    setArt(l, "doll");
    l.drawn = null;
    l.dirty = false;
  }

  /** The cast figure at this moment, in whole device pixels per source pixel, centred in the canvas. False when it cannot be drawn yet. */
  function drawCast(l: Live, t: number): boolean {
    const choice = l.choice;
    if (choice.kind !== "cast") return false;
    const set = choice.set;
    const clip = findCastClip(set.entry, set.size, PICTURE_CLIP, PICTURE_FACING);
    if (!clip) return false;
    const rect = l.canvas.getBoundingClientRect();
    const dpr = ratio();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (!(w > 0 && h > 0)) return false;
    const frame = reduced() ? 0 : castFrameIndex(clip, t - l.t0);
    if (l.shown === "cast" && !l.dirty && l.drawn && l.drawn.set === set && l.drawn.frame === frame && l.drawn.w === w && l.drawn.h === h) return true;
    const stack = deps.frames(set, frame);
    if (!stack) return false;
    const box = figureCrop(set.meta);
    const ctx = l.canvas.getContext("2d");
    if (!ctx) return false;
    if (l.canvas.width !== w || l.canvas.height !== h) {
      l.canvas.width = w;
      l.canvas.height = h;
    }
    const at = fitFigure(w, h, box);
    const part = cropToFrame(box, set.meta.canvasW, set.meta.canvasH);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    for (const c of stack) ctx.drawImage(c, part.sx, part.sy, part.sw, part.sh, Math.round(at.x + part.ox * at.k), Math.round(at.y + part.oy * at.k), Math.round(part.sw * at.k), Math.round(part.sh * at.k));
    setArt(l, "cast");
    l.drawn = { set, frame, w, h };
    l.dirty = false;
    return true;
  }

  function draw(l: Live, t: number): void {
    if (l.choice.kind === "cast") {
      if (drawCast(l, t)) return;
      // Not decoded or not laid out yet. Keep what is there (the doll, or the last cast frame); ask again in case the cache let it go.
      const cast = castNow();
      if (cast) deps.request(l.choice.set, cast.data.palette, l.onReady);
      // Decoded already and only waiting to be on the page: no doll for the one frame before the figure is drawn.
      const decoded = deps.frames(l.choice.set, 0) !== null;
      if (!decoded && l.shown === "doll" && l.dirty) drawStill(l);
      return;
    }
    if (l.dirty || l.shown !== "doll") drawStill(l);
  }

  function release(l: Live): void {
    if (!live.delete(l)) return;
    if (live.size === 0) stop();
  }

  function stop(): void {
    cancelFrame?.();
    cancelFrame = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  function loop(): void {
    cancelFrame = null;
    if (live.size === 0 || disposed) return;
    const t = now();
    for (const l of [...live]) {
      if (!l.canvas.isConnected) {
        // It was on the page and left it (its screen was drawn again or closed), or it never got there: let it go.
        if (l.wasOnPage || t - l.born > UNATTACHED_MS) release(l);
        continue;
      }
      l.wasOnPage = true;
      draw(l, t);
    }
    if (live.size > 0 && !disposed) cancelFrame = schedule(loop);
  }

  function start(): void {
    if (!unsubscribe) {
      unsubscribe = opts.art.onChange(() => {
        for (const l of live) choose(l);
        if (!cancelFrame && live.size > 0 && !disposed) cancelFrame = schedule(loop);
      });
    }
    if (!cancelFrame) cancelFrame = schedule(loop);
  }

  return {
    picture(req) {
      if (disposed) return null;
      const sheet = req.sheet;
      const canvas = makeCanvas();
      canvas.setAttribute("aria-hidden", "true");
      if (req.box) {
        canvas.style.width = `${req.box}px`;
        canvas.style.height = `${req.box}px`;
      }
      const t = now();
      const l: Live = {
        pic: null as unknown as HeroPicture,
        canvas,
        req,
        sheet,
        choice: DOLL,
        key: "",
        shown: "doll",
        stillCanvas: null,
        born: t,
        t0: t,
        wasOnPage: false,
        dirty: true,
        drawn: null,
        onReady: () => {
          l.dirty = true;
        },
      };
      choose(l);
      // Nothing to draw at all: no cast figure and no still. The screen shows its words alone.
      if (l.choice.kind === "doll") {
        l.stillCanvas = req.still(sheet);
        if (!l.stillCanvas) return null;
      }
      canvas.dataset.art = "doll";
      // The first picture is on the canvas before the screen shows it: the still at once, the cast figure the moment its frames are in.
      draw(l, t);
      l.pic = {
        canvas,
        art: () => l.shown,
        setSheet(next) {
          if (!live.has(l)) return;
          l.sheet = next;
          l.stillCanvas = null;
          // A new look for the cast (other gear) is a new key, and is drawn once its pieces are decoded; the still is redrawn at once.
          choose(l);
          if (l.choice.kind === "doll") l.dirty = true;
          draw(l, now());
        },
        dispose() {
          release(l);
        },
      };
      live.add(l);
      start();
      return l.pic;
    },
    dispose() {
      disposed = true;
      live.clear();
      stop();
    },
  };
}
