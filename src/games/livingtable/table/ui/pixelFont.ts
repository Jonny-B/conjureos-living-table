/**
 * A bitmap pixel font for the asset bench's on-screen text, held as data.
 *
 * Why a bitmap and not a web font: ConjureOS core.css rule R8 forbids web
 * fonts, and the game has to be able to reuse this. Every glyph here is a grid
 * of on/off pixels, drawn onto a canvas at an INTEGER scale with smoothing off,
 * so the letters stay exactly as crisp as the sprites beside them at any zoom.
 *
 * The cell: glyphs are 5 columns by 7 rows of cap height on a 6 by 8 cell. Row
 * 7 (the eighth) is the descender row, used only by g j p q y and a few marks.
 * Spacing is proportional (an i is narrower than an m) except for digits, which
 * are fixed width so a column of numbers lines up.
 *
 * Variants: "regular", and "bold", which is the regular glyph smeared one pixel
 * to the right (6 columns wide). Bigger text is the same glyphs at a bigger
 * integer scale; there is no separate large face.
 *
 * Colour, a dark outline and a drop shadow are painted in the bitmap, not in
 * CSS: the outline is an 8-neighbour dilation of the ink, the shadow is the
 * ink-plus-outline shape shifted down and right by a pixel. A fill may be one
 * colour or a [top, bottom] pair that splits at row 4 of every line, the hard
 * two-tone step classic 16-bit RPGs use.
 *
 * Everything above renderPixelCanvas is pure (no DOM), so it runs in a unit
 * test. Only renderPixelCanvas and pixelText touch a canvas, and only when
 * called. Nothing here touches the DOM at import time: the bench registry is
 * bundled and imported in Node for validation before it ever reaches a browser.
 */

export const GLYPH_W = 5;
export const GLYPH_H = 8;
export const CAP_H = 7;
export const CELL_W = 6;
export const CELL_H = 8;
/** Blank font pixels between one line and the next. */
export const LINE_GAP = 2;
export const FIRST_CODE = 32;
export const LAST_CODE = 126;

export type PixelWeight = "regular" | "bold";
/** One colour, or [top, bottom]: the two tones split at TONE_SPLIT_ROW of every line. */
export type PixelColor = string | readonly [string, string];
export const TONE_SPLIT_ROW = 4;

const SPACE_ADVANCE = 3;
const DIGITS = "0123456789";

// ---- the data ---------------------------------------------------------------
//
// A font sheet: six bands of 16 glyphs, ASCII 32 to 126 in order. Each band is
// eight text rows. "#" is ink, "." is blank, glyphs are 5 wide and separated by
// one space, so you can read the font straight off the page.

const FONT_SHEET: readonly (readonly string[])[] = [
  [
    "..... ..#.. .#.#. .#.#. ..#.. ##..# .##.. ..#.. ...#. .#... ..... ..... ..... ..... ..... ....#",
    "..... ..#.. .#.#. .#.#. .#### ##..# #..#. ..#.. ..#.. ..#.. ..#.. ..#.. ..... ..... ..... ....#",
    "..... ..#.. .#.#. ##### #.#.. ...#. #.#.. .#... .#... ...#. #.#.# ..#.. ..... ..... ..... ...#.",
    "..... ..#.. ..... .#.#. .###. ..#.. .#... ..... .#... ...#. .###. ##### ..... ##### ..... ..#..",
    "..... ..#.. ..... ##### ..#.# .#... #.#.# ..... .#... ...#. #.#.# ..#.. ..... ..... ..... .#...",
    "..... ..... ..... .#.#. ####. #..## #..#. ..... ..#.. ..#.. ..#.. ..#.. ..#.. ..... .##.. #....",
    "..... ..#.. ..... .#.#. ..#.. #..## .##.# ..... ...#. .#... ..... ..... ..#.. ..... .##.. #....",
    "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .#... ..... ..... .....",
  ],
  [
    ".###. ..#.. .###. .###. ...#. ##### .###. ##### .###. .###. ..... ..... ...#. ..... .#... .###.",
    "#...# .##.. #...# #...# ..##. #.... #.... ....# #...# #...# ..... ..... ..#.. ..... ..#.. #...#",
    "#..## ..#.. ....# ....# .#.#. ####. #.... ...#. #...# #...# .##.. .##.. .#... ##### ...#. ....#",
    "#.#.# ..#.. ...#. ..##. #..#. ....# ####. ..#.. .###. .#### .##.. .##.. #.... ..... ....# ...#.",
    "##..# ..#.. ..#.. ....# ##### ....# #...# .#... #...# ....# ..... ..... .#... ##### ...#. ..#..",
    "#...# ..#.. .#... #...# ...#. #...# #...# .#... #...# ....# .##.. .##.. ..#.. ..... ..#.. .....",
    ".###. .###. ##### .###. ...#. .###. .###. .#... .###. .###. .##.. ..#.. ...#. ..... .#... ..#..",
    "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .#... ..... ..... ..... .....",
  ],
  [
    ".###. .###. ####. .###. ####. ##### ##### .###. #...# .###. ..### #...# #.... #...# #...# .###.",
    "#...# #...# #...# #...# #...# #.... #.... #...# #...# ..#.. ...#. #..#. #.... ##.## ##..# #...#",
    "#.### #...# #...# #.... #...# #.... #.... #.... #...# ..#.. ...#. #.#.. #.... #.#.# #.#.# #...#",
    "#.#.# ##### ####. #.... #...# ####. ####. #.### ##### ..#.. ...#. ##... #.... #.#.# #..## #...#",
    "#.### #...# #...# #.... #...# #.... #.... #...# #...# ..#.. ...#. #.#.. #.... #...# #...# #...#",
    "#.... #...# #...# #...# #...# #.... #.... #...# #...# ..#.. #..#. #..#. #.... #...# #...# #...#",
    ".###. #...# ####. .###. ####. ##### #.... .#### #...# .###. .##.. #...# ##### #...# #...# .###.",
    "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .....",
  ],
  [
    "####. .###. ####. .#### ##### #...# #...# #...# #...# #...# ##### .###. #.... .###. ..#.. .....",
    "#...# #...# #...# #.... ..#.. #...# #...# #...# #...# #...# ....# .#... #.... ...#. .#.#. .....",
    "#...# #...# #...# #.... ..#.. #...# #...# #...# .#.#. .#.#. ...#. .#... .#... ...#. #...# .....",
    "####. #...# ####. .###. ..#.. #...# #...# #.#.# ..#.. ..#.. ..#.. .#... ..#.. ...#. ..... .....",
    "#.... #.#.# #.#.. ....# ..#.. #...# #...# #.#.# .#.#. ..#.. .#... .#... ...#. ...#. ..... .....",
    "#.... #..#. #..#. ....# ..#.. #...# .#.#. ##.## #...# ..#.. #.... .#... ....# ...#. ..... .....",
    "#.... .##.# #...# ####. ..#.. .###. ..#.. #...# #...# ..#.. ##### .###. ....# .###. ..... .....",
    "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... #####",
  ],
  [
    ".#... ..... #.... ..... ....# ..... ..##. ..... #.... ..#.. ...#. #.... .##.. ..... ..... .....",
    "..#.. ..... #.... ..... ....# ..... .#..# ..... #.... ..... ..... #.... ..#.. ..... ..... .....",
    "...#. .###. ####. .###. .#### .###. .#... .#### #.##. .##.. ..##. #..#. ..#.. ##.#. #.##. .###.",
    "..... ....# #...# #...# #...# #...# ###.. #...# ##..# ..#.. ...#. #.#.. ..#.. #.#.# ##..# #...#",
    "..... .#### #...# #.... #...# ##### .#... #...# #...# ..#.. ...#. ##... ..#.. #.#.# #...# #...#",
    "..... #...# #...# #...# #...# #.... .#... .#### #...# ..#.. ...#. #.#.. ..#.. #...# #...# #...#",
    "..... .#### ####. .###. .#### .###. .#... ....# #...# .###. #..#. #..#. .###. #...# #...# .###.",
    "..... ..... ..... ..... ..... ..... ..... .###. ..... ..... .##.. ..... ..... ..... ..... .....",
  ],
  [
    "..... ..... ..... ..... .#... ..... ..... ..... ..... ..... ..... ..##. ..#.. .##.. .....",
    "..... ..... ..... ..... .#... ..... ..... ..... ..... ..... ..... .#... ..#.. ...#. .....",
    "####. .#### #.##. .#### ###.. #...# #...# #...# #...# #...# ##### .#... ..#.. ...#. .....",
    "#...# #...# ##..# #.... .#... #...# #...# #...# .#.#. #...# ...#. #.... ..#.. ....# .##.#",
    "#...# #...# #.... .###. .#... #...# #...# #.#.# ..#.. #...# ..#.. .#... ..#.. ...#. #.##.",
    "####. .#### #.... ....# .#..# #..## .#.#. #.#.# .#.#. .#### .#... .#... ..#.. ...#. .....",
    "#.... ....# #.... ####. ..##. .##.# ..#.. .#.#. #...# ....# ##### ..##. ..#.. .##.. .....",
    "#.... ....# ..... ..... ..... ..... ..... ..... ..... .###. ..... ..... ..#.. ..... .....",
  ],
];

// ---- glyphs -----------------------------------------------------------------

export interface Glyph {
  readonly ch: string;
  /** GLYPH_H strings of "#" and ".", all the same length (5, or 6 when bold). */
  readonly rows: readonly string[];
  /** First and last inked column. */
  readonly x0: number;
  readonly x1: number;
  /** How far the pen moves after this glyph, spacing included. */
  readonly advance: number;
}

function parseSheet(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  FONT_SHEET.forEach((band, b) => {
    const count = band[0] ? (band[0].length + 1) / (GLYPH_W + 1) : 0;
    for (let i = 0; i < count; i++) {
      const rows = band.map((line) => line.slice(i * (GLYPH_W + 1), i * (GLYPH_W + 1) + GLYPH_W));
      out.set(String.fromCharCode(FIRST_CODE + b * 16 + i), rows);
    }
  });
  return out;
}

function buildGlyph(ch: string, rows: readonly string[]): Glyph {
  let x0 = Infinity;
  let x1 = -1;
  for (const row of rows) {
    const a = row.indexOf("#");
    const b = row.lastIndexOf("#");
    if (a >= 0) x0 = Math.min(x0, a);
    if (b >= 0) x1 = Math.max(x1, b);
  }
  if (x1 < 0) return { ch, rows, x0: 0, x1: -1, advance: SPACE_ADVANCE + ((rows[0] ?? "").length > GLYPH_W ? 1 : 0) };
  // Digits keep their whole 5 (or 6) columns so they stay tabular.
  if (DIGITS.includes(ch)) {
    x0 = 0;
    x1 = (rows[0] ?? "").length - 1;
  }
  return { ch, rows, x0, x1, advance: x1 - x0 + 2 };
}

function smear(rows: readonly string[]): string[] {
  return rows.map((row) => {
    let out = "";
    for (let i = 0; i <= row.length; i++) out += row[i] === "#" || row[i - 1] === "#" ? "#" : ".";
    return out;
  });
}

let regularGlyphs: Map<string, Glyph> | null = null;
let boldGlyphs: Map<string, Glyph> | null = null;

function table(weight: PixelWeight): Map<string, Glyph> {
  if (!regularGlyphs) {
    regularGlyphs = new Map();
    for (const [ch, rows] of parseSheet()) regularGlyphs.set(ch, buildGlyph(ch, rows));
  }
  if (weight === "regular") return regularGlyphs;
  if (!boldGlyphs) {
    boldGlyphs = new Map();
    for (const [ch, rows] of parseSheet()) boldGlyphs.set(ch, buildGlyph(ch, smear(rows)));
  }
  return boldGlyphs;
}

/** True for the 95 printable ASCII characters, space included. */
export function hasGlyph(ch: string): boolean {
  return table("regular").has(ch);
}

/** The glyph for one printable ASCII character; anything else is the "?" glyph. */
export function getGlyph(ch: string, weight: PixelWeight = "regular"): Glyph {
  const t = table(weight);
  return t.get(ch) ?? (t.get("?") as Glyph);
}

// ---- text normalising -------------------------------------------------------
//
// The dialogue and the engine's sentences can carry typographic punctuation the
// font does not have. Map the common ones onto their ASCII look-alikes (listed
// by code point, so this file never holds the characters themselves), and
// anything else onto "?".

const ASCII_ALIAS_CODES: readonly (readonly [number, string])[] = [
  [0x2018, "'"], // left single quote
  [0x2019, "'"], // right single quote, apostrophe
  [0x201a, ","],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x2010, "-"], // hyphen and the dash family
  [0x2011, "-"],
  [0x2012, "-"],
  [0x2013, "-"],
  [0x2014, "-"],
  [0x2212, "-"], // minus sign
  [0x2026, "..."], // ellipsis
  [0x00b7, "."], // middle dot
  [0x2022, "*"], // bullet
  [0x00d7, "x"], // multiplication sign
  [0x00a0, " "], // no-break space
  [0x09, " "], // tab
  [0x0d, ""], // carriage return
];

let aliases: Map<number, string> | null = null;

/** Printable ASCII and newlines only: look-alikes mapped, everything else "?". */
export function normalizeText(text: string): string {
  if (!aliases) aliases = new Map(ASCII_ALIAS_CODES);
  let out = "";
  for (const ch of text) {
    const alias = aliases.get(ch.codePointAt(0) as number);
    if (alias !== undefined) out += alias;
    else if (ch === "\n" || hasGlyph(ch)) out += ch;
    else out += "?";
  }
  return out;
}

// ---- measuring --------------------------------------------------------------

/**
 * The ink width, in font pixels, of one line of text. The last glyph's trailing
 * spacing pixel is not counted, so "A" is 5 wide and "AB" is 11 (5 + 1 + 5).
 * Newlines are not honoured here: use measureText for multi-line text.
 */
export function textWidth(text: string, weight: PixelWeight = "regular"): number {
  let x = 0;
  for (const ch of normalizeText(text)) {
    if (ch === "\n") continue;
    x += getGlyph(ch, weight).advance;
  }
  return Math.max(0, x - 1);
}

export interface PixelRun {
  text: string;
  color?: PixelColor;
  weight?: PixelWeight;
}

export interface PlacedGlyph {
  readonly glyph: Glyph;
  /** Font pixels from the text block's left edge to the glyph's pen position. */
  readonly x: number;
  /** Font pixels from the text block's top to the glyph's top row. */
  readonly y: number;
  readonly color: PixelColor | undefined;
}

export interface TextLayout {
  readonly glyphs: readonly PlacedGlyph[];
  /** Number of lines; 0 for text with nothing in it. */
  readonly lines: number;
  /** Ink width of each line. */
  readonly lineWidths: readonly number[];
  /** The text of each line, spaces between words kept, after normalising. */
  readonly lineTexts: readonly string[];
  /** Widest line, in font pixels. */
  readonly w: number;
  /** Lines, plus the gaps between them, in font pixels. 0 when there are no lines. */
  readonly h: number;
}

export interface LayoutOptions {
  weight?: PixelWeight;
  /** Wrap at this many font pixels. Omit for a single unwrapped line (newlines still break). */
  maxWidth?: number;
  lineGap?: number;
  align?: "left" | "center" | "right";
}

/**
 * Lay out coloured runs of text on a grid of font pixels: greedy word wrap at
 * maxWidth (a word longer than a whole line is broken between letters),
 * newlines break, spaces at the start or end of a line are dropped. Pure.
 */
export function layoutRuns(runs: readonly PixelRun[], opts: LayoutOptions = {}): TextLayout {
  const base = opts.weight ?? "regular";
  const gap = opts.lineGap ?? LINE_GAP;
  const maxWidth = opts.maxWidth ?? Infinity;

  interface Row {
    items: { glyph: Glyph; x: number; color: PixelColor | undefined }[];
    width: number;
    text: string;
  }
  const rows: Row[] = [{ items: [], width: 0, text: "" }];
  let row = rows[0] as Row;
  let pen = 0;
  let pendingSpace = 0;
  let pendingChars = 0;

  const newLine = () => {
    row = { items: [], width: 0, text: "" };
    rows.push(row);
    pen = 0;
    pendingSpace = 0;
    pendingChars = 0;
  };
  const place = (glyph: Glyph, color: PixelColor | undefined) => {
    row.items.push({ glyph, x: pen, color });
    row.text += glyph.ch;
    pen += glyph.advance;
    row.width = pen - 1;
  };

  for (const run of runs) {
    const weight = run.weight ?? base;
    const text = normalizeText(run.text);
    const parts = text.split(/(\n| +)/);
    for (const part of parts) {
      if (part === "") continue;
      if (part === "\n") {
        newLine();
        continue;
      }
      if (part[0] === " ") {
        if (row.items.length > 0) {
          pendingSpace += getGlyph(" ", weight).advance * part.length;
          pendingChars += part.length;
        }
        continue;
      }
      const wordW = textWidth(part, weight);
      if (row.items.length > 0 && pen + pendingSpace + wordW > maxWidth) newLine();
      pen += pendingSpace;
      row.text += " ".repeat(pendingChars);
      pendingSpace = 0;
      pendingChars = 0;
      for (const ch of part) {
        const glyph = getGlyph(ch, weight);
        if (row.items.length > 0 && pen + glyph.advance - 1 > maxWidth) newLine();
        place(glyph, run.color);
      }
    }
  }

  const used = rows.filter((r) => r.items.length > 0);
  if (used.length === 0) return { glyphs: [], lines: 0, lineWidths: [], lineTexts: [], w: 0, h: 0 };
  const w = Math.max(...used.map((r) => r.width));
  const glyphs: PlacedGlyph[] = [];
  used.forEach((r, i) => {
    const shift = opts.align === "center" ? Math.floor((w - r.width) / 2) : opts.align === "right" ? w - r.width : 0;
    for (const it of r.items) glyphs.push({ glyph: it.glyph, x: it.x + shift, y: i * (CELL_H + gap), color: it.color });
  });
  return {
    glyphs,
    lines: used.length,
    lineWidths: used.map((r) => r.width),
    lineTexts: used.map((r) => r.text),
    w,
    h: used.length * CELL_H + (used.length - 1) * gap,
  };
}

/** Wrap plain text to a width in font pixels. Returns the lines as strings. */
export function wrapText(text: string, maxWidth: number, weight: PixelWeight = "regular"): string[] {
  return [...layoutRuns([{ text }], { weight, maxWidth }).lineTexts];
}

/** Size of some text, in font pixels, with the same layout rules renderPixelCanvas uses (outline and shadow excluded). */
export function measureText(
  text: string,
  opts: { weight?: PixelWeight; maxWidth?: number; lineGap?: number } = {},
): { w: number; h: number; lines: number } {
  const l = layoutRuns([{ text }], opts);
  return { w: l.w, h: l.h, lines: l.lines };
}

/**
 * Device pixels per font pixel for a nominal CSS `scale` at a device pixel ratio:
 * a whole number, never below 1, so a font pixel is never smeared across device
 * pixels. renderPixelCanvas draws with exactly this.
 */
export function deviceScale(scale: number, dpr = 1): number {
  const ratio = dpr > 0 ? dpr : 1;
  return Math.max(1, Math.round(Math.max(1, Math.floor(scale)) * ratio));
}

/**
 * CSS pixels one font pixel really takes once drawn: deviceScale / dpr. It is the
 * nominal `scale` only when scale * dpr is already whole (dpr 1, 2 or 3, or 1.5
 * at an even scale). At 1.25, 1.75 or 2.75 it is a little over or under (2.4 for
 * a scale of 2 at 1.25), so anything that wraps or sizes pixel text in CSS pixels
 * has to use this and not the nominal scale.
 */
export function cssScale(scale: number, dpr = 1): number {
  return deviceScale(scale, dpr) / (dpr > 0 ? dpr : 1);
}

/** How many font pixels fit across `availableCssPx` once drawn at `scale`: the width to wrap at. */
export function wrapWidth(availableCssPx: number, scale: number, dpr = 1): number {
  return Math.max(1, Math.floor(availableCssPx / cssScale(scale, dpr)));
}

/**
 * The largest integer scale in [minScale, maxScale] at which `widthFontPx` fits
 * in `availableCssPx` as drawn at `dpr` (see cssScale). Never fractional: that is
 * the whole point of the font.
 */
export function fitScale(widthFontPx: number, availableCssPx: number, minScale = 1, maxScale = 8, dpr = 1): number {
  const lo = Math.max(1, Math.floor(minScale));
  const hi = Math.max(lo, Math.floor(maxScale));
  if (widthFontPx <= 0) return hi;
  for (let scale = hi; scale > lo; scale--) if (widthFontPx * cssScale(scale, dpr) <= availableCssPx) return scale;
  return lo;
}

// ---- rasterising ------------------------------------------------------------

export interface RasterOptions extends LayoutOptions {
  /** Fill colour: one, or [top, bottom]. Default white. */
  color?: PixelColor;
  /** Outline colour, or null for none. Default none. */
  outline?: string | null;
  /** Outline thickness in font pixels. Default 1. */
  outlinePx?: number;
  /** Drop shadow colour, or null for none. Default none. */
  shadow?: string | null;
  shadowDx?: number;
  shadowDy?: number;
}

export interface PixelBitmap {
  /** Size in font pixels, margins for the outline and shadow included. */
  readonly w: number;
  readonly h: number;
  /** Where the text block sits inside the bitmap. */
  readonly left: number;
  readonly top: number;
  /** Size of the text block itself. */
  readonly textW: number;
  readonly textH: number;
  /** How many lines of text the block holds. */
  readonly lines: number;
  /** w by h: 0 for empty, otherwise 1 + an index into `fills`. */
  readonly ink: Uint8Array;
  readonly fills: readonly string[];
  /** w by h: 1 where the outline is. */
  readonly outline: Uint8Array;
  readonly outlineColor: string | null;
  /** w by h: 1 where the shadow shows. */
  readonly shadow: Uint8Array;
  readonly shadowColor: string | null;
}

/** Rasterise coloured runs into a bitmap: ink, then the outline around it, then the shadow behind. Pure. */
export function rasterize(input: string | readonly PixelRun[], opts: RasterOptions = {}): PixelBitmap {
  const runs: readonly PixelRun[] = typeof input === "string" ? [{ text: input }] : input;
  const layout = layoutRuns(runs, opts);
  const defaultColor = opts.color ?? "#ffffff";
  const outlineColor = opts.outline ?? null;
  const outlinePx = outlineColor ? Math.max(1, Math.floor(opts.outlinePx ?? 1)) : 0;
  const shadowColor = opts.shadow ?? null;
  const sdx = shadowColor ? Math.trunc(opts.shadowDx ?? 1) : 0;
  const sdy = shadowColor ? Math.trunc(opts.shadowDy ?? 1) : 0;

  const left = outlinePx + Math.max(0, -sdx);
  const top = outlinePx + Math.max(0, -sdy);
  const right = outlinePx + Math.max(0, sdx);
  const bottom = outlinePx + Math.max(0, sdy);
  const w = Math.max(1, layout.w + left + right);
  const h = Math.max(1, layout.h + top + bottom);

  const ink = new Uint8Array(w * h);
  const fills: string[] = [];
  const fillIndex = (c: string) => {
    let i = fills.indexOf(c);
    if (i < 0) {
      fills.push(c);
      i = fills.length - 1;
    }
    return i + 1;
  };

  for (const g of layout.glyphs) {
    const color = g.color ?? defaultColor;
    const [topTone, bottomTone] = typeof color === "string" ? [color, color] : color;
    const topIdx = fillIndex(topTone);
    const bottomIdx = fillIndex(bottomTone);
    g.glyph.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== "#") continue;
        const x = left + g.x + (c - g.glyph.x0);
        const y = top + g.y + r;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        ink[y * w + x] = r < TONE_SPLIT_ROW ? topIdx : bottomIdx;
      }
    });
  }

  const outline = new Uint8Array(w * h);
  if (outlinePx > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (ink[y * w + x]) continue;
        let near = false;
        for (let dy = -outlinePx; dy <= outlinePx && !near; dy++) {
          for (let dx = -outlinePx; dx <= outlinePx; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && ink[ny * w + nx]) {
              near = true;
              break;
            }
          }
        }
        if (near) outline[y * w + x] = 1;
      }
    }
  }

  const shadow = new Uint8Array(w * h);
  if (shadowColor) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!ink[y * w + x] && !outline[y * w + x]) continue;
        const nx = x + sdx;
        const ny = y + sdy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!ink[ny * w + nx] && !outline[ny * w + nx]) shadow[ny * w + nx] = 1;
      }
    }
  }

  return { w, h, left, top, textW: layout.w, textH: layout.h, lines: layout.lines, ink, fills, outline, outlineColor, shadow, shadowColor };
}

// ---- drawing (browser only) -------------------------------------------------

function fillSpans(
  ctx: CanvasRenderingContext2D,
  plane: Uint8Array,
  w: number,
  h: number,
  k: number,
  pick: (v: number) => string | null,
): void {
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const v = plane[y * w + x] as number;
      const color = v ? pick(v) : null;
      if (!color) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < w && plane[y * w + end] === v) end++;
      ctx.fillStyle = color;
      ctx.fillRect(x * k, y * k, (end - x) * k, k);
      x = end;
    }
  }
}

/** Paint a bitmap at k device pixels per font pixel, with its top-left at (ox, oy). */
export function paintBitmap(ctx: CanvasRenderingContext2D, bmp: PixelBitmap, k: number, ox = 0, oy = 0): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.imageSmoothingEnabled = false;
  fillSpans(ctx, bmp.shadow, bmp.w, bmp.h, k, () => bmp.shadowColor);
  fillSpans(ctx, bmp.outline, bmp.w, bmp.h, k, () => bmp.outlineColor);
  fillSpans(ctx, bmp.ink, bmp.w, bmp.h, k, (v) => bmp.fills[v - 1] ?? null);
  ctx.restore();
}

/**
 * Draw a bitmap onto a new canvas, crisp. `scale` is CSS pixels per font pixel;
 * the backing store is scaled by the device pixel ratio and then rounded to a
 * whole number of device pixels per font pixel (deviceScale), so a font pixel is
 * never smeared across device pixels. The canvas's CSS size is set to match, which
 * makes a font pixel cssScale(scale, dpr) CSS pixels: only the nominal `scale` at
 * whole ratios.
 */
export function renderPixelCanvas(bmp: PixelBitmap, scale: number, dpr?: number): HTMLCanvasElement {
  const ratio = dpr && dpr > 0 ? dpr : typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const k = deviceScale(scale, ratio);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.w * k;
  canvas.height = bmp.h * k;
  canvas.style.width = `${(bmp.w * k) / ratio}px`;
  canvas.style.height = `${(bmp.h * k) / ratio}px`;
  canvas.style.imageRendering = "pixelated";
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  if (ctx) paintBitmap(ctx, bmp, k);
  return canvas;
}

export interface PixelTextOptions extends RasterOptions {
  /** CSS pixels per font pixel; an integer, default 2. */
  scale?: number;
  dpr?: number;
}

/** Rasterise text and draw it onto a new canvas in one step. */
export function pixelText(input: string | readonly PixelRun[], opts: PixelTextOptions = {}): HTMLCanvasElement {
  const bmp = rasterize(input, opts);
  const canvas = renderPixelCanvas(bmp, opts.scale ?? 2, opts.dpr);
  canvas.dataset.text = typeof input === "string" ? input : input.map((r) => r.text).join("");
  canvas.dataset.lines = String(bmp.lines);
  return canvas;
}
