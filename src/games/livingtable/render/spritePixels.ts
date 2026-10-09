/**
 * The pixel-grid primitives every drawing surface in render/ shares: what a
 * sprite's pixels ARE, what "transparent" means, and how big a sprite is.
 *
 * This is a separate file for one structural reason. canvasRenderer.ts paints,
 * equipmentCompositor.ts decides what to paint, and the painter has to call the
 * decider. If the decider also had to reach back into the painter for the
 * transparency sentinel and the grid types, the two would import each other and
 * the module graph would stop being a DAG. Splitting the primitives out makes
 * the dependency one-way: spritePixels <- equipmentCompositor <- canvasRenderer.
 *
 * canvasRenderer.ts re-exports everything here under its own name, because
 * `TRANSPARENT`, `SpriteGrid` and `SpriteAsset` have been part of its public
 * surface since the renderer existed and half a dozen files import them from
 * there. Moving them was never worth a rename across the codebase.
 */

/** One pixel of a sprite's grid: an index into RenderManifest.palette, or -1 for "nothing here, let whatever's underneath show through" (how a prop sprite leaves most of its grid empty). */
export const TRANSPARENT = -1;

/** `pixels[y][x]`, top row first. Rows are the authority on height, a row's length is the authority on width. */
export type SpriteGrid = number[][];

export interface SpriteAsset {
  pixels: SpriteGrid;
}

/**
 * A sprite's size, derived from its own art and from nothing else.
 *
 * There is deliberately no dimension FIELD anywhere in this pipeline, not on
 * the asset library's Sprite, not on the wire type, not on SpriteAsset. A
 * declared size that can disagree with the pixels is a size that eventually
 * will, and the disagreement shows up as art clipped or padded at draw time,
 * which is the hardest kind of bug to see in a screenshot. Reading the array
 * makes disagreement impossible.
 *
 * A tile is 16x16, a monster token may be anywhere from 16 to 24 tall, a player
 * archetype's body and its worn gear are 16x24. All four go through here.
 */
export function spriteDimensions(pixels: readonly (readonly number[])[]): { width: number; height: number } {
  return { width: pixels[0]?.length ?? 0, height: pixels.length };
}

// ── source resolution ─────────────────────────────────────────────────────
//
// A sprite's dimensions come from its own grid (above), but HOW MANY SOURCE
// PIXELS MAKE ONE TILE is a property of the whole library, not of any one
// sprite: a 32x48 token is 1.5 tiles tall at 32 source pixels per tile edge and
// 3 tiles tall at 16. So it lives on the manifest as `spriteSize`, and a
// sprite's own size can never stand in for it.
//
// Everything here is ctx-free and takes plain numbers, for the reason the rest
// of render/ keeps its maths apart from its canvas calls: node:test has no 2D
// context, and a resolution bug is exactly the kind that hides in a screenshot.

/** Source pixels per tile edge in every library drawn before the resolution field existed, and still the default. */
export const BASE_SPRITE_SIZE = 16;

/** Whether `value` can be a resolution at all: a finite number above zero. Anything else is read as "the manifest said nothing". */
export function isUsableSpriteSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * A manifest's source resolution, in source pixels per tile edge. A missing,
 * zero, negative, non-finite or non-numeric field reads as 16, so a bad value
 * degrades to today's drawing rather than to a divide by zero mid-frame.
 */
export function spriteSizeOf(manifest: { readonly spriteSize?: number }): number {
  return isUsableSpriteSize(manifest.spriteSize) ? manifest.spriteSize : BASE_SPRITE_SIZE;
}

/** How many times finer than the 16 pixel grid the art is. The doll and the icons size their own rasters in these "logical pixels" (one 16 px pixel), so a 32 px sprite has 2 source pixels to a logical pixel. */
export function resolutionFactor(spriteSize: number): number {
  return spriteSize / BASE_SPRITE_SIZE;
}

/**
 * Source pixels that make up one LOGICAL pixel, as a whole number of at least
 * one. The enchantment rim is a two-band gradient measured in logical pixels
 * (one band, one pixel of the 16 px grid), so at 32 px each band is two source
 * pixels thick and the rim keeps the same weight on screen instead of thinning
 * to a hairline. Rounded because a band is built by whole-pixel dilation.
 */
export function glowUnit(spriteSize: number): number {
  return Math.max(1, Math.round(resolutionFactor(spriteSize)));
}

/**
 * Where source cell (`sx`, `sy`) lands on the canvas when one source pixel is
 * `pixelSize` canvas pixels and the sprite starts at (`originX`, `originY`).
 *
 * Unsnapped, this is the exact arithmetic the renderer has always used, which
 * is what keeps every 16 px draw byte-identical. Snapped, each edge is rounded
 * to a whole canvas pixel, and both neighbours compute the SHARED edge from the
 * same expression so two adjacent cells can never disagree about it by a
 * rounding bit and leave a one pixel gap. Snapping exists for one case: a
 * sprite whose pixel is not a whole number of canvas pixels (32 px art at a
 * 16 px tile scale is half a canvas pixel per source pixel). A half pixel
 * `fillRect` composites as a partly transparent seam on a real canvas, so the
 * tile would come out see-through; snapped, it covers exactly its own box and
 * keeps every other source pixel, which is nearest-neighbour. A cell that
 * collapses to nothing comes back with a zero width or height and the caller
 * skips it.
 */
export function sourceCellRect(
  originX: number,
  originY: number,
  sx: number,
  sy: number,
  pixelSize: number,
  snap: boolean,
): { x: number; y: number; width: number; height: number } {
  if (!snap) return { x: originX + sx * pixelSize, y: originY + sy * pixelSize, width: pixelSize, height: pixelSize };
  const left = Math.round(originX + sx * pixelSize);
  const top = Math.round(originY + sy * pixelSize);
  const right = Math.round(originX + (sx + 1) * pixelSize);
  const bottom = Math.round(originY + (sy + 1) * pixelSize);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
