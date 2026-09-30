/**
 * Draws one assembled CellLayout to a 2D canvas: tiles, then props, then
 * tokens, in that order, because draw order IS occlusion here -- a token
 * standing on a floor tile has to paint over it, and a prop against a wall
 * has to paint over the wall behind it. There's no z-index, just "later
 * wins", so getting this order right is the whole correctness story for
 * what's on top of what.
 *
 * DESIGN.md ("Assets: a code-defined library") is explicit that sprites are
 * pixel-index bitmaps defined in code, a shared palette plus a grid of indices
 * per sprite, not painted PNGs. RenderManifest below is that shape. It's
 * deliberately a different, richer type than world/cell.ts's AssetManifest:
 * that one only carries enough (walkable, existence) to VALIDATE a layout;
 * this one carries enough to actually PAINT one. A world-cell AssetManifest
 * doesn't have a palette because nothing under world/ ever needs to draw.
 *
 * The layout math (where on the canvas a tile/prop/token lands, given a
 * pixel scale and the fixed 20x15 cell size) is kept in plain functions with
 * no `ctx` in their signature, so it's testable under node:test the same way
 * everything else in this repo is. Canvas itself isn't testable there --
 * jsdom/node has no real 2D context -- so the actual `ctx.fillRect` calls
 * stay thin wrappers around that math, never where a bug could hide.
 *
 * TILES ARE SQUARE; TOKENS ARE NOT ANY MORE. Every tile is 16x16 and always
 * will be, because 16 is the grid's pitch. A TOKEN is as tall as its own pixel
 * grid says it is, up to 24, and stands with its feet flush against the bottom
 * of its tile so the extra rows overhang UPWARD into the tile above. The
 * measured reason, from a veteran 16-bit console artist comparing our work
 * against real Final Fantasy art at matched scale: "Every token is exactly
 * 16x16 and snapped to the grid. FF field sprites are roughly 16x24 and stand
 * at sub-tile offsets. A judge who knows the era sorts on this before looking
 * at any craft." At height 16 the anchor reduces exactly to `tileOrigin`, so
 * the hundreds of shipped 16x16 sprites draw byte-identically.
 */
import { CELL_HEIGHT, CELL_WIDTH, type TileCoord } from "../world/coordinates";
import type { CellLayout, TileId } from "../world/cell";
import type { BonusSource, PaletteRemap, GlowFrame, TokenRenderPlans } from "../characters/equipmentTypes";
import { applyDisplayTiles } from "./terrainEdges";
import { propVariantAt } from "./tileVariants";
import { compositeToken, remappedIndex } from "./equipmentCompositor";
import { spriteDimensions, TRANSPARENT, type SpriteAsset, type SpriteGrid } from "./spritePixels";

// The pixel-grid primitives moved to spritePixels.ts so that the compositor
// could use them without importing the painter that calls it. They are
// re-exported here because they have been part of this file's public surface
// since the renderer existed, and half a dozen files import them from here.
export { spriteDimensions, TRANSPARENT };
export type { SpriteAsset, SpriteGrid };

/** The tile grid's native pixel pitch: every tile and every prop is exactly this square, and a token is exactly this wide. DESIGN.md pins it as part of "the actual target" the asset library hits. */
export const SPRITE_SIZE = 16;

/**
 * The render-time asset library: one shared palette (hex color strings,
 * indexed by a sprite pixel's value) plus a sprite per tile/prop/token asset
 * id. Matches the shape the tileset builders produce per DESIGN.md, not the
 * loose validation-only AssetManifest in world/cell.ts.
 */
export interface RenderManifest {
  palette: string[];
  tiles: Record<TileId, SpriteAsset>;
  props: Record<TileId, SpriteAsset>;
  tokens: Record<TileId, SpriteAsset>;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelRect extends PixelPoint {
  width: number;
  height: number;
}

// ── pure layout math ─────────────────────────────────────────────────────
// Every function below takes only numbers/coordinates and returns
// numbers/coordinates -- no canvas, no ctx, safe to unit test directly.

/**
 * The canvas pixel of a tile's top-left corner, at a given scale (canvas
 * pixels per tile). `scale` is the tile's on-screen size, not a multiplier
 * of the sprite's own 16x16 grid -- at scale 16 a sprite draws at its native
 * resolution, one canvas pixel per source pixel; at scale 32 it's doubled.
 */
export function tileOrigin(tile: TileCoord, scale: number): PixelPoint {
  return { x: tile.x * scale, y: tile.y * scale };
}

/** The full canvas size needed to draw one cell at a given scale -- the fixed 20x15 grid times the tile's on-screen size. */
export function canvasDimensions(scale: number): { width: number; height: number } {
  return { width: CELL_WIDTH * scale, height: CELL_HEIGHT * scale };
}

/**
 * How many canvas pixels one source pixel of a sprite's 16x16 grid covers,
 * at a given tile scale. Exact (an integer) only when `scale` is a multiple
 * of SPRITE_SIZE; a non-multiple still produces a valid (fractional) draw,
 * it just isn't pixel-perfect -- callers that care about crisp pixel art
 * should pick a multiple of 16.
 */
export function spritePixelSize(scale: number): number {
  return scale / SPRITE_SIZE;
}

/** Where one cell of a sprite's pixel-index grid lands on the canvas, given the origin it's being drawn from and the render scale. */
export function spritePixelRect(tileOriginPx: PixelPoint, spriteX: number, spriteY: number, scale: number): PixelRect {
  const size = spritePixelSize(scale);
  return { x: tileOriginPx.x + spriteX * size, y: tileOriginPx.y + spriteY * size, width: size, height: size };
}

/**
 * Where a sprite of a given HEIGHT starts, drawn on a given tile: feet on the
 * tile, excess overhanging upward.
 *
 *     originX = tile.x * scale
 *     originY = (tile.y + 1) * scale - height * spritePixelSize(scale)
 *
 * For height 16 the second line reduces to `tile.y * scale`, which is exactly
 * `tileOrigin`, so every 16x16 tile, prop and monster token draws on the pixels
 * it has always drawn on. That equality is a test of its own, because it is the
 * thing that makes a geometry change to the whole renderer safe to ship.
 *
 * The overhang goes UP rather than down for one reason: a character's feet are
 * where they stand, and standing is what a tile means. A token that hung
 * downward would be standing a half-tile in front of the square the engine
 * thinks it occupies, and every reach, range and line-of-sight read on screen
 * would be off by half a tile from the one the rules ran.
 */
export function tokenOrigin(tile: TileCoord, height: number, scale: number): PixelPoint {
  return { x: tile.x * scale, y: (tile.y + 1) * scale - height * spritePixelSize(scale) };
}

/**
 * The first source row of a sprite that actually lands on the canvas.
 *
 * A 24-tall token standing on tile row 0 wants 8 source rows above y = 0. Those
 * rows are SKIPPED here rather than left for the canvas to swallow, so the clip
 * is a property of the arithmetic and can be checked under node with no 2D
 * context. There is no horizontal case: a sprite is never wider than its tile.
 */
export function firstVisibleSpriteRow(originY: number, scale: number): number {
  if (originY >= 0) return 0;
  return Math.ceil(-originY / spritePixelSize(scale));
}

/**
 * Tokens in paint order: ascending y, ties broken by their position in the
 * layout's own array.
 *
 * This was harmless when every token was one 16x16 stamp inside its own tile
 * and nothing could overlap. A 24-tall token reaches into the tile above it, so
 * array order is now a visible defect: whoever happens to be listed last paints
 * over whoever is standing in front of them. Sorting by y makes the nearer
 * figure win, which is what "nearer" means on a top-down grid. `sort` is stable
 * in node and every current browser, so equal-y tokens keep array order and the
 * picture does not flicker between frames.
 */
export function tokenDrawOrder<T extends { y: number }>(tokens: readonly T[]): readonly T[] {
  return [...tokens].sort((a, b) => a.y - b.y);
}

// ── canvas-touching draws (thin; the math above did the real work) ──────

/**
 * Paint one sprite's pixel-index grid from a given origin.
 *
 * The grid is the only authority on the sprite's size, so this loops the rows
 * and columns that exist rather than a fixed 16. Skips: TRANSPARENT pixels, any
 * index missing from the palette (a partially-defined sprite degrades to "some
 * pixels missing" rather than throwing mid-frame, and an older manifest that
 * predates the reserved glow entries simply draws no glow), and any row that
 * would land above the top of the canvas.
 *
 * `remap` recolours gear at draw time, which is what makes a common and an
 * uncommon piece the same drawing in two colourways. It is `null` for every
 * tile, every prop and every body. `remappedIndex` is where the refusals live:
 * it will not remap transparency and it will not touch a protected index at
 * either end, so no table can dissolve a silhouette.
 */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  palette: string[],
  pixels: SpriteGrid,
  origin: PixelPoint,
  scale: number,
  remap: PaletteRemap | null = null,
): void {
  for (let sy = firstVisibleSpriteRow(origin.y, scale); sy < pixels.length; sy++) {
    const row = pixels[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      const index = row[sx];
      if (index === undefined) continue;
      const drawn = remappedIndex(index, remap);
      // TRANSPARENT is -1, and a remap that somehow produced any other negative
      // index means the same thing: nothing here, let what is underneath show.
      if (drawn < 0) continue;
      const color = palette[drawn];
      if (!color) continue;
      const rect = spritePixelRect(origin, sx, sy, scale);
      ctx.fillStyle = color;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
}

/**
 * Draw one assembled cell. Tiles first (the dense 20x15 grid, one draw per
 * populated cell), then props, then tokens -- see the file header for why
 * that order isn't optional. A tile/prop/token whose assetId isn't in the
 * manifest is skipped rather than thrown on: a manifest gap should read as a
 * blank tile during play, not a crashed renderer.
 *
 * The tile grid goes through terrainEdges.ts's `applyDisplayTiles` first,
 * which runs two display passes: tileVariants.ts scatters each base material
 * across its authored field tiles so a floor is not one sprite repeated three
 * hundred times, and then the autotiler swaps the patch's boundary cells for
 * their transition variants so grass and water stop ending in a straight seam.
 * Both are display-only and return a copy: `layout.tiles` is untouched, so
 * walkability and every validated world action still read the ids the DM
 * placed.
 *
 * Props go through the same per-coordinate variant pick, for the same reason:
 * a wood of six trees was six copies of one sprite in one panel, which is the
 * tile pass's own defect on the objects the eye actually tracks.
 *
 * `seed` varies the variant scatter between cells that hold the same material,
 * so a corridor of identical rooms does not repeat one field pixel for pixel.
 * It defaults to 0; a caller with a CellCoord in hand should hash it in, which
 * CellLayout itself cannot supply because it does not carry its own address.
 *
 * `plans` is how EQUIPMENT reaches the canvas, and it is optional so that every
 * existing call site and every existing render test keeps drawing exactly what
 * it draws today. Equipment is deliberately NOT on PlacedToken: the layout is
 * persisted to game_cells and shown to the DM, so anything carried on a token
 * is something the model can see and reason about supplying. A plan is built
 * from the character sheet instead, which the model never touches, and keyed by
 * the token's own id because two Knights on the board are two characters with
 * two different sets of gear. A token with no plan draws body-only from its own
 * assetId, as now.
 *
 * `frame` is the enchantment glow's two-frame palette pulse, and it is the
 * entire animation surface this feature has: 0 draws the bright pair of
 * reserved indices, 1 draws the dim pair. There is deliberately no loop here.
 * This canvas repaints when the world changes, and putting an always-on
 * animation loop on it is a performance and battery decision of its own; the
 * screen can flip a piece of state on a timer and pass it down the day it wants
 * one. Until then everything passes 0 and nothing pulses.
 */
export function renderCell(
  ctx: CanvasRenderingContext2D,
  layout: CellLayout,
  manifest: RenderManifest,
  scale: number,
  seed = 0,
  plans?: TokenRenderPlans,
  frame: GlowFrame = 0,
): void {
  const hasTile = (assetId: TileId) => manifest.tiles[assetId] !== undefined;
  const tiles = applyDisplayTiles(layout.tiles, hasTile, seed);

  for (let y = 0; y < CELL_HEIGHT; y++) {
    const row = tiles[y];
    if (!row) continue;
    for (let x = 0; x < CELL_WIDTH; x++) {
      const assetId = row[x];
      const sprite = assetId ? manifest.tiles[assetId] : undefined;
      if (sprite) drawSprite(ctx, manifest.palette, sprite.pixels, tileOrigin({ x, y }, scale), scale);
    }
  }

  const hasProp = (assetId: TileId) => manifest.props[assetId] !== undefined;
  for (const prop of layout.props) {
    const sprite = manifest.props[propVariantAt(prop.assetId, prop.x, prop.y, hasProp, seed)];
    if (!sprite) continue;
    // The feet anchor rather than tileOrigin: identical for the 16x16 every
    // prop is today, and correct rather than upside down if one is ever drawn
    // taller. `propVariantAt` returns the id the DM placed when it has nothing
    // to substitute, so a prop with no set is unchanged.
    const origin = tokenOrigin(prop, spriteDimensions(sprite.pixels).height, scale);
    drawSprite(ctx, manifest.palette, sprite.pixels, origin, scale);
  }

  const lookup = (spriteId: TileId): SpriteGrid | undefined => manifest.tokens[spriteId]?.pixels;
  for (const token of tokenDrawOrder(layout.tokens)) {
    const body = manifest.tokens[token.assetId];
    if (!body) continue;
    const origin = tokenOrigin(token, spriteDimensions(body.pixels).height, scale);

    // A plan whose body disagrees with the token's own assetId is not this
    // token's plan: the layout is what the DM placed and what was validated, so
    // the token wins and the gear is dropped rather than hung on the wrong
    // character.
    const plan = plans?.[token.id];
    if (!plan || plan.bodySpriteId !== token.assetId) {
      drawSprite(ctx, manifest.palette, body.pixels, origin, scale);
      continue;
    }

    const px = spritePixelSize(scale);
    for (const draw of compositeToken(plan, lookup, frame)) {
      const at = { x: origin.x + draw.offsetX * px, y: origin.y + draw.offsetY * px };
      drawSprite(ctx, manifest.palette, draw.pixels, at, scale, draw.remap);
    }
  }
}

// ── dice-roll readout overlay ─────────────────────────────────────────────

/**
 * What a resolved roll needs to show on screen, per DESIGN.md's "show the
 * dice" requirement: the math has to be visible, not summarized away into
 * prose. Neither rules/combat.ts's AttackResult nor rules/checks.ts's
 * CheckResult matches this shape directly (missing modifier/target, and
 * CheckResult's outcome field is named `success`, not `hit`) -- the honest
 * way to get from either one to a RollReadout is rollReadoutAdapter.ts's
 * `attackResultToReadout` / `checkResultToReadout`, not a hand rename at the
 * call site.
 */
export interface RollReadout {
  roll: number;
  modifier: number;
  total: number;
  target: number;
  hit: boolean;
  /**
   * What the modifier was MADE OF, in player-facing words: "+3 Dexterity and
   * training, +2 Keen Longsword".
   *
   * A player who hits on a 14 needs to be able to see why, and "+5" is an
   * unexplained lump the moment equipment can contribute to it. Optional, so a
   * readout built without it prints exactly the line it printed before
   * equipment existed. The sum of every `amount` MUST equal `modifier`: a
   * readout that disagrees with the number the engine actually rolled is the
   * same class of defect as a decorative AC, and it is worth an assertion
   * wherever these are built.
   */
  sources?: readonly BonusSource[];
}

/**
 * There is deliberately no canvas painter for a RollReadout any more. The one
 * that used to live here drew the formula as antialiased 14px text over a
 * translucent plate, which made it the only alpha and the only antialiased
 * type on a surface that is otherwise strictly indexed colour, and it was
 * dragged through the same nearest-neighbour upscale as the sprites. The play
 * screen renders the same numbers as a DOM overlay instead: the canvas paints
 * sprites, the DOM paints type. The interface above stays, because it is the
 * shape rollReadoutAdapter.ts produces and the screen's own overlay extends.
 */
