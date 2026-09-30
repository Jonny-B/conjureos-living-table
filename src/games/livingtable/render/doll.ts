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

/** Whether (x, y) has a same-value neighbour in `mask` on one of its four orthogonal sides. An out-of-grid neighbour counts as "not set", the same as a neighbour that is simply false. */
function has4Neighbor(mask: DollMask, x: number, y: number, size: number): boolean {
  return (
    (x > 0 && mask[y]![x - 1] === true) ||
    (x < size - 1 && mask[y]![x + 1] === true) ||
    (y > 0 && mask[y - 1]![x] === true) ||
    (y < size - 1 && mask[y + 1]![x] === true)
  );
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
 */
export function pedestalBands(): { band1: DollMask; band2: DollMask } {
  const size = DOLL_CANVAS_SIZE;
  const inside = emptyMask(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - PEDESTAL.cx) / PEDESTAL.rx;
      const dy = (y + 0.5 - PEDESTAL.cy) / PEDESTAL.ry;
      if (dx * dx + dy * dy <= 1) inside[y]![x] = true;
    }
  }

  const band1 = emptyMask(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside[y]![x]) continue;
      const outsideNeighbor =
        (x === 0 || inside[y]![x - 1] !== true) ||
        (x === size - 1 || inside[y]![x + 1] !== true) ||
        (y === 0 || inside[y - 1]![x] !== true) ||
        (y === size - 1 || inside[y + 1]![x] !== true);
      if (outsideNeighbor) band1[y]![x] = true;
    }
  }

  const band2 = emptyMask(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside[y]![x] || band1[y]![x]) continue;
      if (has4Neighbor(band1, x, y, size)) band2[y]![x] = true;
    }
  }

  return { band1, band2 };
}

/** Paint every set cell of a boolean mask as one `scale`-sized square, in the reserved palette index for its band. A colour missing from the palette (an older manifest predating the glow entries) simply skips that cell, the same "a gap reads as missing art" rule drawSprite already follows for tiles. */
function paintMask(ctx: CanvasRenderingContext2D, palette: string[], mask: DollMask, paletteIndex: number, scale: number): void {
  const color = palette[paletteIndex];
  if (!color) return;
  ctx.fillStyle = color;
  for (let y = 0; y < mask.length; y++) {
    const row = mask[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      if (row[x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

/**
 * Draw one COMPOSITE DRAW's pixels at a source-space origin, `scale` canvas
 * pixels per source pixel. Applies `remap` the one way it is ever applied
 * anywhere in this feature: `equipmentCompositor.ts`'s own `remappedIndex`,
 * imported rather than re-derived, so a recolour or a protected-index
 * refusal can never drift between the board and the doll.
 */
function paintSprite(
  ctx: CanvasRenderingContext2D,
  palette: string[],
  pixels: readonly (readonly number[])[],
  origin: { x: number; y: number },
  scale: number,
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
      const x = (origin.x + sx) * scale;
      const y = (origin.y + sy) * scale;
      // The doll's own canvas is exactly DOLL_CANVAS_SIZE square and every
      // draw (token, glow margin included) lands well inside it -- see the
      // file header -- so this is a defensive skip, not a load-bearing clip:
      // nothing shipped ever reaches it, and nothing breaks if it never
      // fires.
      if (x < 0 || y < 0 || x >= DOLL_CANVAS_SIZE * scale || y >= DOLL_CANVAS_SIZE * scale) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, scale, scale);
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
 * `scale` is canvas pixels per SOURCE pixel (not per tile): the caller has
 * already picked it per INVENTORY_LAYOUT / DOLL_MIN_SCALE / DOLL_MAX_SCALE,
 * and the canvas's own width, height and CSS size are all
 * `DOLL_CANVAS_SIZE * scale`, with no devicePixelRatio multiplied in, the
 * same rule the board's own displayScale already follows.
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
  const { band1, band2 } = pedestalBands();
  paintMask(ctx, manifest.palette, band1, PEDESTAL_INDEX_OUTER, scale);
  paintMask(ctx, manifest.palette, band2, PEDESTAL_INDEX_INNER, scale);

  if (!plan) return;

  const lookup = (spriteId: string) => manifest.tokens[spriteId]?.pixels;
  for (const draw of compositeToken(plan, lookup, frame)) {
    const origin = { x: DOLL_TOKEN_ORIGIN.x + draw.offsetX, y: DOLL_TOKEN_ORIGIN.y + draw.offsetY };
    paintSprite(ctx, manifest.palette, draw.pixels, origin, scale, draw.remap);
  }
}
