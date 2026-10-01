/**
 * The inventory screen's "doll": the real composited token -- the same
 * pixels, the same recolour, the same rim light the board draws -- standing
 * on a pixel pedestal, rasterised into a small square canvas at an integer
 * scale. Contract: characters/equipmentTypes.ts section "11.9 icons, the
 * doll and the pedestal".
 *
 * Two reasons this is a separate file from canvasRenderer.ts rather than a
 * new renderCell mode: the doll's own coordinate space is DOLL_CANVAS_SIZE
 * (32) SOURCE pixels square, not the 20x15 TILE grid canvasRenderer paints,
 * so `scale` here means canvas pixels per source pixel directly -- there is
 * no spritePixelSize conversion, no tileOrigin, no feet-on-a-tile anchor
 * math, because the doll is not standing on the board. And the pedestal is
 * procedural art (a raster ellipse, not a shipped sprite): DESIGN.md's
 * "Assets: a code-defined library" reaches players only after a games-db
 * redeploy, and a frame without its own pedestal would look unfinished the
 * moment this ships, so the pedestal is code, not a gear_* sprite id.
 *
 * `renderDoll` draws the pedestal FIRST (so the figure's feet and its own
 * contact shadow stand on it), then the STAGED token on top via the same
 * `compositeToken` the board uses. `frame` defaults to 0 and is passed
 * straight through to `compositeToken` (equipmentTypes.ts's own "IS
 * ANIMATION IN SCOPE" note: "the FRAMES are in scope, the LOOP is not" --
 * this file owns the plumbing, a caller owns any timer); at frame 0 nothing
 * pulses, which is every caller today, so this is additive. A null plan, or
 * a plan whose body sprite the manifest does not carry, draws the pedestal
 * alone -- never a crash, the same "a gap reads as missing art, not a broken
 * renderer" rule canvasRenderer.ts already keeps.
 *
 * SOURCE RESOLUTION. The doll's canvas is DOLL_CANVAS_SIZE * `scale` canvas
 * pixels whatever the art is drawn at, and `scale` stays canvas pixels per
 * LOGICAL pixel (one pixel of the 16 px grid), so the same screen code sizes the
 * same canvas. A manifest that declares a finer `spriteSize` (32 source pixels
 * per tile edge) is drawn into that canvas at `scale / 2` canvas pixels per
 * source pixel: the raster, the token's origin and the pedestal's ellipse are
 * all `spriteSize / 16` times larger in source pixels, and each pedestal ring is
 * that many source pixels thick, so the figure and its stage occupy the very
 * same canvas box they did at 16. With no `spriteSize` every number below is
 * the one it has always been.
 *
 * PEDESTAL COLOUR, why it is not the glow hue (see this file's own note
 * above `PEDESTAL_INDEX_OUTER` below): the first contract text painted both
 * bands from GLOW_INDEX_A, the exact palette entries the enchantment ring
 * itself uses. Close-out review
 * caught the result -- a rare Sword of the Vigil's rim and a legendary
 * Dawnbreaker's rim both run straight down into the same gold ring the
 * pedestal stands on, so the "enchantment" reads as trim on the stage rather
 * than a property of the item, and rare and legendary look alike on the
 * doll. Painted instead from the template's own neutral structural ramp
 * (index 24..27 in both fantasy.ts and scifi.ts: ROCK_DEEP/SHADE/BODY/LIT in
 * fantasy, the equivalent grey MESH ramp in scifi -- the third of the four
 * terrain ramps every template's PALETTE lays out at the same four indices),
 * the pedestal reads as a stone/deck disc in both hues and never collides
 * with a real enchantment ring, which is now the only gold (fantasy) or
 * green (sci-fi) on the panel. equipmentTypes.ts section 11.9 now states
 * this palette as the contract, so this is no longer a deviation from it.
 */
import { DOLL_CANVAS_SIZE, DOLL_TOKEN_ORIGIN, PEDESTAL, type GlowFrame, type PaletteRemap, type TokenRenderPlan } from "../characters/equipmentTypes";
import { compositeToken, remappedIndex } from "./equipmentCompositor";
import { BASE_SPRITE_SIZE, glowUnit, resolutionFactor, sourceCellRect, spriteSizeOf } from "./spritePixels";
import type { RenderManifest } from "./canvasRenderer";

/**
 * The pedestal's own two tones -- never GLOW_INDEX_A/B, which are reserved
 * for a worn item's enchantment ring. Both fantasy.ts and scifi.ts lay a
 * neutral structural ramp (rock; mesh) at indices 24..27 of their 52-entry
 * PALETTE, the third of the four terrain ramps described in each file's own
 * header. Read as plain numbers, not imported (rule: nothing under src/ may
 * import scripts/assets/*), the same way GLOW_INDEX_A/B are themselves
 * plain numbers rather than an import.
 */
export const PEDESTAL_INDEX_OUTER = 25; // ROCK_SHADE / MESH_SHADE: the outer ring, in shadow
export const PEDESTAL_INDEX_INNER = 27; // ROCK_LIT / MESH_LIT: the inner ring, catching light

/** A boolean grid exactly DOLL_CANVAS_SIZE square, one cell per source pixel. */
export type DollMask = boolean[][];

function emptyMask(size: number): DollMask {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => false));
}

/**
 * Every set cell of `mask` whose four orthogonal neighbours are all set too: the
 * mask shrunk by one pixel. A neighbour off the edge of the grid counts as "not
 * set", the same as a neighbour that is simply false.
 */
function erode(mask: DollMask, size: number): DollMask {
  const out = emptyMask(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y]![x]) continue;
      const solid =
        x > 0 && mask[y]![x - 1] === true &&
        x < size - 1 && mask[y]![x + 1] === true &&
        y > 0 && mask[y - 1]![x] === true &&
        y < size - 1 && mask[y + 1]![x] === true;
      if (solid) out[y]![x] = true;
    }
  }
  return out;
}

function erodeBy(mask: DollMask, size: number, steps: number): DollMask {
  let out = mask;
  for (let i = 0; i < steps; i++) out = erode(out, size);
  return out;
}

/**
 * THE PEDESTAL, precomputed as two boolean masks so the same shape backs
 * both this pure test surface and the paint loop below -- there is exactly
 * one place the ellipse math lives.
 *
 * Pinned formula (characters/equipmentTypes.ts, PEDESTAL): source pixel
 * (x, y) is INSIDE the ellipse when, over pixel centres,
 *
 *     ((x + 0.5 - cx) / rx)^2 + ((y + 0.5 - cy) / ry)^2 <= 1
 *
 * Band 1 is every inside pixel with a 4-neighbour OUTSIDE the ellipse (the
 * rim touching open floor). Band 2 is every OTHER inside pixel (not band 1)
 * with a 4-neighbour IN band 1 (one ring further toward the centre). Every
 * inside pixel that is neither stays the interior, which is left
 * transparent -- the pedestal is a two-pixel ring, not a filled disc, the
 * same "rim, not a halo" rule the enchantment glow in equipmentCompositor.ts
 * follows. Verified against the contract's own numbers: PEDESTAL's rx 12,
 * ry 3 at cx 16, cy 28 produces `inside` on rows 25..30 and columns 4..27
 * exactly, and this function is covered by a test that checks it.
 *
 * The bands are stated here by erosion, which is the same two rules: eroding
 * `inside` once removes exactly the pixels with an outside neighbour, so band 1
 * is `inside` minus one erosion, and band 2 (the inside pixels beside band 1)
 * is that erosion minus the next. At a finer resolution each band is that many
 * erosions thick instead of one, which is what keeps the ring one logical pixel
 * wide on screen.
 *
 * `spriteSize` is the library's source resolution (default 16). The raster and
 * the ellipse's centre and radii are `spriteSize / 16` times larger, so the
 * mask is DOLL_CANVAS_SIZE * spriteSize / 16 cells square: 32 cells at the
 * default, which is the shape the contract pins, and 64 at 32 px per tile.
 */
export function pedestalBands(spriteSize: number = BASE_SPRITE_SIZE): { band1: DollMask; band2: DollMask } {
  const factor = resolutionFactor(spriteSize);
  const size = Math.round(DOLL_CANVAS_SIZE * factor);
  const thickness = glowUnit(spriteSize);
  const cx = PEDESTAL.cx * factor;
  const cy = PEDESTAL.cy * factor;
  const rx = PEDESTAL.rx * factor;
  const ry = PEDESTAL.ry * factor;

  const inside = emptyMask(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) inside[y]![x] = true;
    }
  }

  const core1 = erodeBy(inside, size, thickness);
  const core2 = erodeBy(core1, size, thickness);
  const band1 = emptyMask(size);
  const band2 = emptyMask(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inside[y]![x] && !core1[y]![x]) band1[y]![x] = true;
      else if (core1[y]![x] && !core2[y]![x]) band2[y]![x] = true;
    }
  }

  return { band1, band2 };
}

/**
 * Paint every set cell of a boolean mask as one `cellPx`-sized square (canvas
 * pixels per source pixel), in the reserved palette index for its band. A colour
 * missing from the palette (an older manifest predating the glow entries) simply
 * skips that cell, the same "a gap reads as missing art" rule drawSprite already
 * follows for tiles. `snap` is for a finer library whose source pixel is not a
 * whole number of canvas pixels (see `sourceCellRect`); it is off at 16, where
 * `cellPx` is always the integer `scale` and every rect is what it always was.
 */
function paintMask(
  ctx: CanvasRenderingContext2D,
  palette: string[],
  mask: DollMask,
  paletteIndex: number,
  cellPx: number,
  snap: boolean,
): void {
  const color = palette[paletteIndex];
  if (!color) return;
  ctx.fillStyle = color;
  for (let y = 0; y < mask.length; y++) {
    const row = mask[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const rect = sourceCellRect(0, 0, x, y, cellPx, snap);
      if (rect.width > 0 && rect.height > 0) ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
}

/**
 * Draw one COMPOSITE DRAW's pixels at a source-space origin, `cellPx` canvas
 * pixels per source pixel, on a canvas `canvasSide` pixels square. Applies
 * `remap` the one way it is ever applied
 * anywhere in this feature: `equipmentCompositor.ts`'s own `remappedIndex`,
 * imported rather than re-derived, so a recolour or a protected-index
 * refusal can never drift between the board and the doll.
 */
function paintSprite(
  ctx: CanvasRenderingContext2D,
  palette: string[],
  pixels: readonly (readonly number[])[],
  origin: { x: number; y: number },
  cellPx: number,
  canvasSide: number,
  snap: boolean,
  remap: PaletteRemap | null,
): void {
  for (let sy = 0; sy < pixels.length; sy++) {
    const row = pixels[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      const index = row[sx];
      if (index === undefined) continue;
      const drawn = remappedIndex(index, remap);
      if (drawn < 0) continue;
      const color = palette[drawn];
      if (!color) continue;
      const { x, y, width, height } = sourceCellRect(0, 0, origin.x + sx, origin.y + sy, cellPx, snap);
      // The doll's own canvas is exactly DOLL_CANVAS_SIZE square and every
      // draw (token, glow margin included) lands well inside it -- see the
      // file header -- so this is a defensive skip, not a load-bearing clip:
      // nothing shipped ever reaches it, and nothing breaks if it never
      // fires.
      if (x < 0 || y < 0 || x >= canvasSide || y >= canvasSide) continue;
      if (width <= 0 || height <= 0) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
    }
  }
}

/**
 * Draw the doll: the pedestal, then the STAGED token on top of it.
 *
 * `plan` is built by the screen from the LoadoutDraft, not from the
 * committed sheet, so a staged Equip shows on the doll before Ok. `null`
 * (nothing to show yet, or the character has no plan) draws the pedestal
 * alone. A plan whose body sprite the manifest does not carry draws the
 * pedestal alone too, because `compositeToken` returns no draws at all for a
 * missing body -- there is no such thing as a floating suit of armour with
 * nobody in it.
 *
 * `scale` is canvas pixels per LOGICAL pixel (one pixel of the 16 px grid; not
 * per tile): the caller has already picked it per INVENTORY_LAYOUT /
 * DOLL_MIN_SCALE / DOLL_MAX_SCALE, and the canvas's own width, height and CSS
 * size are all `DOLL_CANVAS_SIZE * scale`, with no devicePixelRatio multiplied
 * in, the same rule the board's own displayScale already follows. With the
 * default 16 px library a logical pixel IS a source pixel, which is the
 * relationship this comment used to state; at 32 px per tile a source pixel is
 * `scale / 2` canvas pixels and the canvas does not change size.
 *
 * `frame` (default 0) is forwarded to `compositeToken` unchanged: at 0
 * nothing pulses, matching every caller today; a caller that later flips it
 * between 0 and 1 on a timer (equipmentTypes.ts's own deferred-but-in-scope
 * "FRAMES are in scope, the LOOP is not") makes a legendary piece's own
 * glow ring pulse on the doll exactly as it already can on the board,
 * without this file owning or starting any timer itself.
 */
export function renderDoll(
  ctx: CanvasRenderingContext2D,
  plan: TokenRenderPlan | null,
  manifest: RenderManifest,
  scale: number,
  frame: GlowFrame = 0,
): void {
  const size = spriteSizeOf(manifest);
  const factor = resolutionFactor(size);
  // Canvas pixels per SOURCE pixel. At the default this is `scale / 1`, the
  // integer it always was; a finer library's fraction snaps to whole pixels.
  const cellPx = scale / factor;
  const snap = size !== BASE_SPRITE_SIZE;
  const canvasSide = DOLL_CANVAS_SIZE * scale;

  const { band1, band2 } = pedestalBands(size);
  paintMask(ctx, manifest.palette, band1, PEDESTAL_INDEX_OUTER, cellPx, snap);
  paintMask(ctx, manifest.palette, band2, PEDESTAL_INDEX_INNER, cellPx, snap);

  if (!plan) return;

  const lookup = (spriteId: string) => manifest.tokens[spriteId]?.pixels;
  // The token's origin is a logical-pixel constant; the draws' own offsets are
  // in source pixels already.
  const tokenX = DOLL_TOKEN_ORIGIN.x * factor;
  const tokenY = DOLL_TOKEN_ORIGIN.y * factor;
  for (const draw of compositeToken(plan, lookup, frame, size)) {
    const origin = { x: tokenX + draw.offsetX, y: tokenY + draw.offsetY };
    paintSprite(ctx, manifest.palette, draw.pixels, origin, cellPx, canvasSide, snap, draw.remap);
  }
}
