/**
 * Turns one character's equipment into an ordered list of things to paint.
 *
 * The problem it exists for, in the words of the veteran 16-bit console artist
 * who measured our tokens against real Final Fantasy art at matched scale:
 * "Every token is exactly 16x16 and snapped to the grid. FF field sprites are
 * roughly 16x24 and stand at sub-tile offsets." A character who is one flat
 * 16x16 stamp can never show that she is carrying a different sword than she
 * was an hour ago, so gear has to be a LAYER rather than a redraw: eight
 * archetypes times three slots times four tiers is 96 combinations, and nobody
 * is drawing 96 whole characters.
 *
 * This file decides; canvasRenderer.ts paints. Everything here is pure, takes
 * no `ctx`, and returns plain data, which is the same split the rest of the
 * renderer already uses so that node:test can check it with no 2D context in
 * the process. `compositeToken` takes a LOOKUP rather than a RenderManifest for
 * the same structural reason spritePixels.ts exists: the manifest type lives in
 * canvasRenderer.ts, canvasRenderer.ts calls this file, and a module graph that
 * is a DAG is worth one function argument.
 *
 * THE LOAD-BEARING RULE, and why it is safe for the renderer to touch
 * equipment at all: nothing in this file reads or produces a NUMBER that
 * affects play. It reads sprite ids, draw-order integers and palette-index
 * remaps off characters/equipmentTypes.ts, which is engine-owned data, and it
 * writes pixels. The bonus a piece of gear is worth never enters this file and
 * has no route through it. The AI dungeon master, which cannot supply a plan
 * either (a plan is built from the character sheet, not from a DM turn), is
 * even further away.
 */
// GLOW_INDEX_B, the dim pair at palette 50 and 51, is deliberately NOT imported
// any more: see the pulse comment in `glowRaster`. The two entries stay
// reserved and stay protected, so no art may borrow them and a later frame
// scheme can pick them up, but nothing in this file paints them today.
import {
  GLOW_INDEX_A,
  GLOW_MARGIN,
  LAYER_BODY,
  PROTECTED_PALETTE_INDICES,
  type EquipmentLayerPlan,
  type GlowFrame,
  type PaletteRemap,
  type TokenRenderPlan,
} from "../characters/equipmentTypes";
import { BASE_SPRITE_SIZE, glowUnit, spriteDimensions, TRANSPARENT, type SpriteGrid } from "./spritePixels";

/**
 * One thing to paint, in the order it must be painted.
 *
 * `offsetX` / `offsetY` are in SOURCE pixels, measured from the token sprite's
 * own top-left corner. They are 0/0 for the body and for every same-height gear
 * layer, which is the case the art contract promises; the glow raster is the
 * one draw that is deliberately bigger than the sprite and sits at
 * -GLOW_MARGIN on both axes (-GLOW_MARGIN source pixels per LOGICAL pixel, so
 * -2 at 16 px per tile and -4 at 32; see `spriteSize` on `compositeToken`).
 */
export interface CompositeDraw {
  pixels: SpriteGrid;
  offsetX: number;
  offsetY: number;
  /** Applied per pixel at draw time. `null` draws as authored, which is always the case for the body and for the glow. */
  remap: PaletteRemap | null;
}

/** How the compositor finds a sprite. In the app this is `(id) => manifest.tokens[id]?.pixels`; a missing id returns undefined and its layer is skipped. */
export type SpriteLookup = (spriteId: string) => SpriteGrid | undefined;

/**
 * Indices no remap may touch, as a Set because this is consulted per pixel per
 * frame and `PROTECTED_PALETTE_INDICES` is an array.
 */
const PROTECTED = new Set(PROTECTED_PALETTE_INDICES);

/**
 * The one line that recolours a pixel, and the three refusals that keep a
 * recolour from destroying the art it is recolouring.
 *
 * Common and uncommon gear are THE SAME PIXELS with a palette remap, which is
 * what makes the project owner's "common and uncommon are simple colour swaps,
 * so they cost no new sprites" literally true rather than aspirational. An
 * index with no entry in the table passes through unchanged, which is what lets
 * a piece of gear carry leather straps, a gem or a wood haft that the recolour
 * leaves alone.
 *
 * The refusals:
 *   - transparency is never remapped, so a colour swap can never fill in a
 *     sprite's empty space;
 *   - a PROTECTED index as the KEY is ignored, so no table can recolour the
 *     outline out of a silhouette;
 *   - a PROTECTED index as the VALUE is ignored, so no table can paint a gear
 *     pixel in the outline colour or borrow one of the four reserved glow
 *     entries.
 *
 * That last pair is enforced twice on purpose: characters/equipmentTypes.ts's
 * shipped tables are checked by a test, and this runtime skip means even a
 * hand-edited table cannot dissolve an outline in a running game. A dissolved
 * silhouette is the single most damaging thing a bad remap can do, because the
 * character stops reading as a character at all.
 */
export function remappedIndex(index: number, remap: PaletteRemap | null): number {
  if (remap === null || index < 0 || PROTECTED.has(index)) return index;
  const to = remap[index];
  if (to === undefined || PROTECTED.has(to)) return index;
  return to;
}

/**
 * A gear layer with its art resolved and its position in the body's box
 * worked out. Exported (contract v2) so render/gearIcon.ts can hand
 * `glowRaster` a single resolved layer for one bag or slot icon -- the exact
 * same rim the board draws for a worn piece, not a second copy of the mask
 * math beside it.
 */
export interface ResolvedLayer extends EquipmentLayerPlan {
  pixels: SpriteGrid;
  /** Rows down from the body's own top row. 0 whenever the layer is the body's height, which is the case the art contract promises. */
  offsetY: number;
}

/**
 * The composite draw for one planned token, in paint order:
 *
 *   1. the glow ring, under everything always
 *   2. every layer behind the body, ascending (a cloak at 10, a barrier field)
 *   3. the body
 *   4. every layer over the body, ascending (plate 30, shield 35, weapon 40, hood 50)
 *
 * A missing sprite id SKIPS its layer, exactly as a missing tile id already
 * skips a tile: a manifest gap must read as a missing hat during play, never as
 * a crashed renderer. A missing BODY returns nothing at all, because there is
 * no such thing as a floating suit of armour with nobody in it, and the caller
 * has already decided not to draw the token in that case anyway.
 *
 * Layers are sorted by their `layer` integer, which is DATA on the slot rather
 * than derived from the slot's role. That is exactly what lets the Knight's
 * shield sit in FRONT of him at 35 while the Shadow's cloak sits BEHIND her at
 * 10 even though both are the `outer` role. The sort is stable and the array is
 * built in plan order, so a tie (which the shipped table never produces) is
 * broken by the order the slots were listed in.
 *
 * `spriteSize` is the library's source resolution (source pixels per tile edge,
 * default 16) and matters to exactly one thing here: the glow. Every layer is
 * aligned by its own grid size and so is resolution-blind, but the rim is
 * authored as a two-band gradient one LOGICAL pixel per band, so it is built
 * `spriteSize / 16` source pixels thick, and its raster margin grows with it.
 * At the default this is the ring it has always been.
 */
export function compositeToken(
  plan: TokenRenderPlan,
  lookup: SpriteLookup,
  frame: GlowFrame = 0,
  spriteSize: number = BASE_SPRITE_SIZE,
): readonly CompositeDraw[] {
  const body = lookup(plan.bodySpriteId);
  if (!body) return [];
  const { width, height } = spriteDimensions(body);

  const resolved: ResolvedLayer[] = [];
  for (const layerPlan of plan.layers) {
    const pixels = lookup(layerPlan.spriteId);
    if (!pixels) continue;
    // Every gear sprite is authored at the body's own size, so this is 0 in
    // practice. It is computed rather than assumed because the art lanes and
    // the renderer ship independently: if a body grows to 24 before its gear
    // does, aligning at the FEET leaves the hat on the head, where aligning at
    // the top row would leave it round the character's knees.
    resolved.push({ ...layerPlan, pixels, offsetY: height - spriteDimensions(pixels).height });
  }
  resolved.sort((a, b) => a.layer - b.layer);

  const draws: CompositeDraw[] = [];

  // ONLY GEAR DRAWN IN FRONT OF THE BODY MAY CATCH THE LIGHT. A rim rastered
  // from a layer BEHIND the body (the Shadow's cloak at 10, the Psion's barrier
  // field) is grown from a full-body silhouette, so it comes out as a closed
  // outline round the whole figure, which is what a strategy game of this era
  // used to mean "this unit is selected" and not what it used to mean
  // "enchanted". A weapon is held in the main hand at LAYER_WEAPON and every
  // other worn piece that can be lit is at 30 or above, so the single test
  // `layer >= LAYER_BODY` covers every one of them without this file having to
  // know what a role is.
  const glowing = resolved.filter((layer) => layer.glowBands > 0 && layer.layer >= LAYER_BODY);
  if (glowing.length > 0) {
    const ring = glowRaster(glowing, width, height, frame, spriteSize);
    const margin = GLOW_MARGIN * glowUnit(spriteSize);
    draws.push({ pixels: ring, offsetX: -margin, offsetY: -margin, remap: null });
  }

  const toDraw = (layer: ResolvedLayer): CompositeDraw => ({
    pixels: layer.pixels,
    offsetX: 0,
    offsetY: layer.offsetY,
    remap: layer.remap,
  });

  for (const layer of resolved) if (layer.layer < LAYER_BODY) draws.push(toDraw(layer));
  // The body is never remapped. It shares a palette with the gear and often
  // shares the gear ramp, so remapping it would recolour the character every
  // time they found a new hat.
  draws.push({ pixels: body, offsetX: 0, offsetY: 0, remap: null });
  // Anything that is not strictly behind the body goes in front of it. Nothing
  // in the shipped table claims 20, and a layer that somehow did should be
  // drawn rather than silently dropped.
  for (const layer of resolved) if (layer.layer >= LAYER_BODY) draws.push(toDraw(layer));

  return draws;
}

// ── the enchantment glow ─────────────────────────────────────────────────
//
// There is no alpha here. The pipeline is indexed colour painted as opaque
// rects, so a soft bloom is not available and this file does not pretend
// otherwise. What ships is a RIM LIGHT in reserved palette entries, drawn
// under everything, plus a two-frame palette cycle that reverses the rim's
// own gradient. Palette cycling on a fixed mask is how a 16-bit game made
// something shimmer, and it costs nothing at draw time.
//
// IT USED TO BE A CLOSED RING AND THAT WAS THE DEFECT. The first version
// dilated every glowing layer's whole silhouette in both bands, so a legendary
// Fireball Person painted 175 ring pixels round a 139 pixel body: an unbroken
// hard-edged saturated oval, larger than the character, which at phone scale
// read as a gold letter O with a dark smear inside it. The era signalled
// enchantment with a sparkle over the item, a rim light along one edge of the
// blade, or a colour cycle inside the item's own pixels. A closed halo round a
// walking figure meant "this unit is selected".
//
// Two rules keep it a rim rather than a halo, and both are measured by a test:
// only layers in FRONT of the body contribute at all (see `compositeToken`),
// and only the band pixels on the LIT side of the shape survive (see
// `lowerRightRim`). Together they drop the ring to roughly a third of its
// pixels and it stops enclosing anything.

/** A boolean grid the size of the glow raster. */
type Mask = boolean[][];

function emptyMask(width: number, height: number): Mask {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => false));
}

/**
 * Every cell within Chebyshev distance 1 of a set cell: the 8-neighbourhood,
 * not the 4-neighbourhood, so the ring closes on the diagonals instead of
 * leaving a gap at every corner of the silhouette.
 *
 * Dilating twice gives distance <= 2, so the two bands fall straight out:
 * band 1 is `dilate(occupied)` minus `occupied`, band 2 is
 * `dilate(dilate(occupied))` minus `dilate(occupied)`.
 */
function dilate(mask: Mask, width: number, height: number): Mask {
  const out = emptyMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y]![x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          out[ny]![nx] = true;
        }
      }
    }
  }
  return out;
}

/** Everything in `mask` that is not in `hole`. The band at Chebyshev distance exactly N is the dilation N times minus the dilation N-1 times. */
function subtract(mask: Mask, hole: Mask, width: number, height: number): Mask {
  const out = emptyMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y]![x] = mask[y]![x] === true && hole[y]![x] !== true;
  }
  return out;
}

/**
 * THE LIT SIDE OF A BAND, and the one line that stops the glow enclosing the
 * character.
 *
 * A dilated band wraps a shape on all four sides, which is a halo. A rim light
 * only appears where the surface faces the light, so this keeps a band pixel
 * only when the thing it was grown from lies toward its LOWER RIGHT: the pixel
 * at (x+1, y) or the pixel at (x, y+1) is inside `inside`. The surviving pixels
 * are exactly the ones along the top and the left of the shape, which is a
 * light source at the upper left, which is the light every sprite in both asset
 * files is already shaded for.
 *
 * Diagonal-only corners fall away with it, which is deliberate: they are the
 * pixels that close a ring into an unbroken oval, and an open rim is the whole
 * point. Band 2 passes the band-1 SET as `inside` rather than the silhouette,
 * so the two bands stay parallel and the rim is two pixels of gradient rather
 * than two disconnected arcs.
 *
 * `reach` is how far, in source pixels, to look along the row and down the
 * column for the shape the pixel was grown from. It is 1 at 16 px per tile,
 * which is the test above, and `glowUnit(spriteSize)` at a finer resolution,
 * where a band is that many source pixels thick: the outer pixel of a thick
 * band has its shape `reach` pixels away, not one. The straight-line test is
 * what keeps diagonal-only corners falling away at any thickness, and it makes
 * the rim of art upscaled by k exactly the k-times upscale of the original's.
 */
function lowerRightRim(band: Mask, inside: Mask, width: number, height: number, reach = 1): Mask {
  const out = emptyMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!band[y]![x]) continue;
      for (let k = 1; k <= reach; k++) {
        const right = x + k < width && inside[y]![x + k] === true;
        const below = y + k < height && inside[y + k]![x] === true;
        if (right || below) {
          out[y]![x] = true;
          break;
        }
      }
    }
  }
  return out;
}

/** `steps` successive 8-neighbour dilations: every cell within Chebyshev distance `steps` of a set cell. One step is `dilate`. */
function dilateBy(mask: Mask, width: number, height: number, steps: number): Mask {
  let out = mask;
  for (let i = 0; i < steps; i++) out = dilate(out, width, height);
  return out;
}

/**
 * The ring, as one pixel grid the caller paints like any other sprite.
 *
 * Rastered on a grid inset by GLOW_MARGIN on all four sides, because a rim
 * necessarily leaves the sprite's own box: a lit pixel in the sprite's left
 * column puts band 2 two columns outside it. The caller draws the result at
 * (-GLOW_MARGIN, -GLOW_MARGIN) from the token's own origin. The rim forms above
 * and to the left of the lit piece, so those are the two margins that actually
 * fill; the other two stay all but empty (band 2 can just reach the
 * second-to-last row, under a shape that runs to the sprite's own bottom edge,
 * and nothing can reach the last row or the last column at all). The grid keeps
 * all four sides anyway, so the caller's offset stays one constant and the
 * caller keeps doing no arithmetic.
 *
 * A token standing in column 0 therefore puts up to two columns of rim off the
 * side of the canvas. That one is left to the canvas to clip, unlike the
 * vertical case, which is arithmetic in canvasRenderer.ts: the vertical
 * overhang is eight rows of an actual character and worth a test, and the
 * horizontal overhang is two columns of a rim that nobody can tell is missing.
 *
 * The rim is NOT subtracted against the body. It is painted first, under
 * everything, so any rim pixel that lands on the figure is simply painted
 * over; computing an occlusion mask for a result that gets covered anyway would
 * be work done twice.
 *
 * Where two lit pieces overlap, BAND 1 WINS: the index nearest the metal,
 * because a rim that dims where two enchantments meet reads as a hole punched
 * in itself. Among two pieces contributing the same band, the first in draw
 * order wins, which is arbitrary but stable.
 *
 * Exported (contract v2) for render/gearIcon.ts, which rasters the identical
 * rim for a single icon sprite -- `compositeToken`'s own multi-layer union is
 * simply the one-layer case of the same function.
 *
 * `spriteSize` is the library's source resolution (default 16). A band is one
 * LOGICAL pixel, so at 32 px per tile it is two source pixels thick and the
 * margin is `GLOW_MARGIN * 2` source pixels a side: the rim keeps its weight on
 * screen instead of shrinking to a hairline beside the art it lights. The shape
 * rule is resolution-independent, so the raster of art upscaled by k is exactly
 * the k-times upscale of the original's raster (a test holds it to that). At
 * the default every line below computes what it always did.
 */
export function glowRaster(
  layers: readonly ResolvedLayer[],
  width: number,
  height: number,
  frame: GlowFrame,
  spriteSize: number = BASE_SPRITE_SIZE,
): SpriteGrid {
  const unit = glowUnit(spriteSize);
  const margin = GLOW_MARGIN * unit;
  const gw = width + 2 * margin;
  const gh = height + 2 * margin;

  const band1: (number | undefined)[][] = Array.from({ length: gh }, () => new Array<number | undefined>(gw).fill(undefined));
  const band2: (number | undefined)[][] = Array.from({ length: gh }, () => new Array<number | undefined>(gw).fill(undefined));

  for (const layer of layers) {
    // The silhouette is read AFTER the remap, per the contract. It matters for
    // exactly one case: a table that maps an index to a negative one erases
    // those pixels, and the ring has to follow the art rather than the file.
    const occupied = emptyMask(gw, gh);
    for (let sy = 0; sy < layer.pixels.length; sy++) {
      const row = layer.pixels[sy];
      if (!row) continue;
      const gy = sy + layer.offsetY + margin;
      if (gy < 0 || gy >= gh) continue;
      for (let sx = 0; sx < row.length; sx++) {
        const index = row[sx];
        if (index === undefined || remappedIndex(index, layer.remap) < 0) continue;
        const gx = sx + margin;
        if (gx < 0 || gx >= gw) continue;
        occupied[gy]![gx] = true;
      }
    }

    const within1 = dilateBy(occupied, gw, gh, unit);
    const within2 = layer.glowBands >= 2 ? dilateBy(within1, gw, gh, unit) : null;

    // Band N is the shell at Chebyshev distance exactly N; the rim is the part
    // of that shell facing the light. Band 2 is rimmed against the whole of
    // band 1's shell rather than against band 1's own rim, so the two bands run
    // parallel and read as one two-pixel gradient instead of two arcs.
    const rim1 = lowerRightRim(subtract(within1, occupied, gw, gh), occupied, gw, gh, unit);
    const rim2 = within2 === null ? null : lowerRightRim(subtract(within2, within1, gw, gh), within1, gw, gh, unit);

    // THE PULSE TRAVELS, IT DOES NOT BLINK. Frame 1 swaps the two band indices
    // rather than dropping both to a dimmer pair. Dimming everything at once is
    // one flat ring flipping colour, which in a still frame (and a still frame
    // is what this canvas draws, since it repaints when the world changes and
    // not on a timer) is indistinguishable from no animation at all. Swapping
    // them moves the bright index one pixel outward and the dim index one pixel
    // inward, which is a two-pixel gradient reversing: a palette cycle, which
    // is the effect the era actually shipped.
    const cycled: readonly [number, number] = [GLOW_INDEX_A[1], GLOW_INDEX_A[0]];
    const [index1, index2] = layer.glowPulses && frame === 1 ? cycled : GLOW_INDEX_A;

    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (rim1[gy]![gx]) {
          band1[gy]![gx] ??= index1;
        } else if (rim2 !== null && rim2[gy]![gx]) {
          band2[gy]![gx] ??= index2;
        }
      }
    }
  }

  return Array.from({ length: gh }, (_, gy) =>
    Array.from({ length: gw }, (_, gx) => band1[gy]![gx] ?? band2[gy]![gx] ?? TRANSPARENT),
  );
}
