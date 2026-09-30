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
