/**
 * Where on the canvas to hang something over a creature's head: a floating
 * damage number, a "DOWN", a speech line.
 *
 * Its own file, built on canvasRenderer.ts's `tokenOrigin` rather than added
 * beside it, for two reasons. The renderer already owns where a figure's feet
 * go and everything here must agree with it, so this reuses that arithmetic
 * instead of restating it; and nothing here paints, so it has no business in
 * the file that does. Pure numbers, no ctx, testable under node like the rest
 * of render/'s maths.
 *
 * The DOM paints type over the canvas (the game's own rule: the canvas paints
 * sprites, the DOM paints type), so the answer is in CANVAS pixels at the tile
 * scale it was asked for. A caller that displays the canvas at another size
 * multiplies by its own CSS ratio.
 */
import type { CellLayout } from "../world/cell";
import type { PixelPoint, RenderManifest } from "./canvasRenderer";
import { tokenOrigin } from "./canvasRenderer";
import { spriteDimensions, spriteSizeOf } from "./spritePixels";

/**
 * The canvas point just above the head of `tokenId`: the horizontal centre of
 * its tile, at the top row of its sprite. A figure taller than its tile
 * overhangs upward (canvasRenderer.ts's file header), so a 24 tall hero's
 * anchor sits half a tile above the tile it stands on, and a one-tile goblin's
 * sits at the top of its own.
 *
 * `tileScale` is canvas pixels per TILE, the same `scale` `renderCell` takes.
 * The figure's height is its body sprite's own (`manifest.tokens[assetId]`),
 * read at the manifest's resolution so 16 px and 32 px libraries land on the
 * same place. A token whose sprite is missing from the manifest draws nothing
 * (`renderCell` skips it), so it gets the top of its tile; an id that is not on
 * the layout gets null.
 *
 * NOT CLAMPED. A tall figure on row 0 reports a point above the canvas
 * (negative y). That is the honest arithmetic, and whether to clip the number
 * or nudge it inside is the caller's call.
 */
export function headAnchor(
  layout: CellLayout,
  tokenId: string,
  manifest: Pick<RenderManifest, "tokens" | "spriteSize">,
  tileScale: number,
): PixelPoint | null {
  const token = layout.tokens.find((t) => t.id === tokenId);
  if (!token) return null;
  const size = spriteSizeOf(manifest);
  const body = manifest.tokens[token.assetId];
  const height = body ? spriteDimensions(body.pixels).height : size;
  const origin = tokenOrigin(token, height, tileScale, size);
  return { x: origin.x + tileScale / 2, y: origin.y };
}
