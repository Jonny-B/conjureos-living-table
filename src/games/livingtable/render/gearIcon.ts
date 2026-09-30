/**
 * One item's icon, for a slot box or a bag cell on the inventory screen.
 * Contract: characters/equipmentTypes.ts section "11.9 icons, the doll and
 * the pedestal", "ICONS, the pinned crop rule".
 *
 * THE DESIGN THIS FILE SERVES: weapon, outer, crown and boots have no
 * separate icon art. `gearIconSource` (equipmentTypes.ts) points an icon
 * source at the very same overlay sprite the doll and the board draw on the
 * body, and this file CROPS an icon out of it rather than drawing a second,
 * smaller picture of the same sword. That is what lets the bag show exactly
 * what the doll will wear the moment it is equipped, with nothing to drift
 * between two drawings of one item, and it is 96 fewer sprites (8 archetypes
 * x 4 drawn roles x 3 variants) than a dedicated icon set would have cost.
 * Ring, amulet and the two empty-slot silhouettes DO have their own art
 * (they never draw on the body at all), and go through the same crop-and-
 * place pipeline unchanged: a 16x16 icon just crops to its own full box.
 *
 * Pure placement math (`iconPlacement`) is split from the one function that
 * touches a canvas (`renderGearIcon`), the same split every other drawing
 * surface in render/ keeps, so the crop/scale/centre arithmetic is checkable
 * under node with no 2D context.
 */
import {
  GEAR_ICON_MAX_SCALE,
  GLOW_MARGIN,
  LAYER_WEAPON,
  type DrawnGearSpriteId,
  type GearIconSource,
  type IconPlacement,
} from "../characters/equipmentTypes";
import { glowRaster, remappedIndex, type ResolvedLayer } from "./equipmentCompositor";
import { spriteDimensions, TRANSPARENT, type SpriteGrid } from "./spritePixels";
import type { RenderManifest } from "./canvasRenderer";

/**
 * THE CROP RULE, pure: the bounding box of every non-transparent pixel in
 * `pixels` (outline pixels included -- index 0 is opaque, only -1 is
 * transparent), grown by `glowBands` on every side so a rim that will be
 * rastered around the piece has somewhere to land, then scaled up to fill as
 * much of a `cellPx`-square box as an INTEGER scale allows and centred in it
 * with `floor` on both axes.
 *
 * `glowBands` here is the number of rim bands the ITEM'S OWN TIER draws (0,
 * 1 or 2), not the fixed `GLOW_MARGIN` the raster itself is always padded by
 * -- an uncommon icon only needs one pixel of growth to fit its one-band rim,
 * a legendary icon needs two. `renderGearIcon` below rasters the rim at the
 * fixed `GLOW_MARGIN` regardless (the same raster `glowRaster` always
 * produces), but a one-band item's raster is transparent past its own single
 * band, so the extra, unused margin the crop does not reserve for it simply
 * never has anything painted there.
 *
 * A sprite with no opaque pixel at all (not expected of real art, but not a
 * reason to divide by zero either) falls back to its own full grid, so there
 * is always something to place.
 */
export function iconPlacement(pixels: SpriteGrid, glowBands: 0 | 1 | 2, cellPx: number): IconPlacement {
  const { width, height } = spriteDimensions(pixels);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let sy = 0; sy < pixels.length; sy++) {
    const row = pixels[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      if ((row[sx] ?? TRANSPARENT) === TRANSPARENT) continue;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
  }
  if (maxX < minX || maxY < minY) {
    minX = 0;
    minY = 0;
    maxX = width - 1;
    maxY = height - 1;
  }

  const cropX = minX - glowBands;
  const cropY = minY - glowBands;
  const cropW = maxX - minX + 1 + 2 * glowBands;
  const cropH = maxY - minY + 1 + 2 * glowBands;

  // Scale is chosen from the sprite's OWN opaque bounding box (glowBands 0),
  // never from the glow-grown crop above. Growing the crop so a rim has
  // somewhere to land must not also shrink the item drawn inside it: at a
  // fixed cellPx, an identically-shaped rare or legendary piece (2 bands)
  // used to halve its scale next to the same piece at common or uncommon (0
  // or 1 band) -- confirmed against the shipped Knight Longsword/Sword of
  // the Vigil/Dawnbreaker art, which are the same ~7-wide silhouette at
  // every tier but rendered at scale 2 (common, uncommon) vs scale 1 (rare,
  // legendary) under the old formula. A rim that does not fit inside cellPx
  // at this scale lands in the crop's own margin or clips at the box edge,
  // which is the acceptable trade: the item stays the size its shape earns,
  // and the rim yields, not the other way around.
  const tightW = maxX - minX + 1;
  const tightH = maxY - minY + 1;
  const scale = Math.max(1, Math.min(GEAR_ICON_MAX_SCALE, Math.floor(cellPx / Math.max(tightW, tightH, 1))));
  const offsetX = Math.floor((cellPx - cropW * scale) / 2);
  const offsetY = Math.floor((cellPx - cropH * scale) / 2);

  return { cropX, cropY, cropW, cropH, scale, offsetX, offsetY };
}

/** `layer` is required by ResolvedLayer's shape but is never read by `glowRaster` itself (see its own comment); LAYER_WEAPON is simply a valid, in-front-of-the-body value to satisfy the type. */
const ICON_GLOW_LAYER = LAYER_WEAPON;

/**
 * Draw one item's icon into a `cellPx`-square box, top-left at the canvas's
 * current origin (the caller positions the box; this function does not
 * translate the context).
 *
 * `source.kind`:
 *   "overlay" / "icon"  looked up in `manifest.tokens` (every v1 and v2 gear
 *                       sprite ships `kind: "token"`, per the contract).
 *                       Missing from the manifest -> draws nothing, returns
 *                       false, so the caller can fall back to the item's
 *                       name as text; this is the expected state until
 *                       games-db serves the v2 sprites, and it must read as
 *                       a finished screen, not a broken one.
 *   "silhouette"        the empty-slot art. No remap, no glow -- "a
 *                       silhouette gets neither" -- just cropped and placed
 *                       like any other icon.
 *
 * Paint order for a glowing item is the rim UNDER the sprite, "exactly as
 * the board would draw it": `compositeToken` always paints its glow ring
 * before the layers it belongs to, and this is the one-icon case of the same
 * rule, sharing the very same `glowRaster` function rather than a second
 * copy of the mask math.
 */
export function renderGearIcon(
  ctx: CanvasRenderingContext2D,
  source: GearIconSource,
  manifest: RenderManifest,
  cellPx: number,
): boolean {
  const sprite = manifest.tokens[source.spriteId]?.pixels;
  if (!sprite) return false;

  const remap = source.kind === "silhouette" ? null : source.remap;
  const glowBands = source.kind === "silhouette" ? 0 : source.glowBands;
  const placement = iconPlacement(sprite, glowBands, cellPx);

  const toCanvas = (sx: number, sy: number): { x: number; y: number } => ({
    x: placement.offsetX + (sx - placement.cropX) * placement.scale,
    y: placement.offsetY + (sy - placement.cropY) * placement.scale,
  });

  if (glowBands > 0) {
    const { width, height } = spriteDimensions(sprite);
    const layer: ResolvedLayer = {
      // ResolvedLayer's `spriteId` field is typed DrawnGearSpriteId because
      // equipmentCompositor.ts only ever built one for a body overlay; an
      // "icon" or "silhouette" source's own id is a different, narrower
      // sprite-id type (AccessoryIconSpriteId / SlotSilhouetteSpriteId).
      // glowRaster itself never reads `.spriteId` (see its own signature --
      // only `.pixels`, `.offsetY`, `.remap`, `.glowBands` and `.glowPulses`
      // matter), so this cast is sound: the value is carried only to satisfy
      // the shared shape, never inspected.
      spriteId: source.spriteId as DrawnGearSpriteId,
      layer: ICON_GLOW_LAYER,
      remap,
      glowBands,
      // The icon is a still panel with no repaint loop of its own, the same
      // reason renderDoll always passes frame 0: nothing here ever animates.
      glowPulses: false,
      pixels: sprite,
      offsetY: 0,
    };
    const ring = glowRaster([layer], width, height, 0);
    for (let gy = 0; gy < ring.length; gy++) {
      const row = ring[gy];
      if (!row) continue;
      for (let gx = 0; gx < row.length; gx++) {
        const index = row[gx];
        // glowRaster's own pixels are already resolved palette indices (48..51
        // for a fresh manifest); TRANSPARENT marks "no rim here", the same
        // sentinel every other grid in this pipeline uses.
        if (index === undefined || index === TRANSPARENT) continue;
        const color = manifest.palette[index];
        if (!color) continue;
        // The raster is offset by GLOW_MARGIN from the sprite's own origin on
        // both axes (equipmentCompositor.ts's own convention); undo that here
        // to land back in the sprite's coordinate space before placing.
        const { x, y } = toCanvas(gx - GLOW_MARGIN, gy - GLOW_MARGIN);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, placement.scale, placement.scale);
      }
    }
  }

  for (let sy = 0; sy < sprite.length; sy++) {
    const row = sprite[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      const index = row[sx];
      if (index === undefined) continue;
      const drawn = remappedIndex(index, remap);
      if (drawn < 0) continue;
      const color = manifest.palette[drawn];
      if (!color) continue;
      const { x, y } = toCanvas(sx, sy);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, placement.scale, placement.scale);
    }
  }

  return true;
}
