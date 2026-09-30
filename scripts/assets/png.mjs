/**
 * A minimal PNG encoder, dependency-free (Node's built-in `zlib` and `crypto`
 * only, both raw pixels in). It exists for exactly one purpose: letting a
 * critic agent actually SEE a sprite as a real image, since there is no
 * canvas/image package installed here and none should be added just to
 * render a preview strip that no player ever sees. Not used at runtime; the
 * real client renders straight to a `<canvas>` (see src/games/livingtable/render/).
 *
 * PNG's IDAT chunk is literally a zlib stream of filtered scanlines, so
 * `zlib.deflateSync` does the actual compression; this file only has to frame
 * the chunks (IHDR/IDAT/IEND) and compute each one's CRC32.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Encode an RGB pixel grid to a PNG buffer.
 * `pixels` is `rows[y][x] = [r,g,b]` (0-255 each), all rows the same length.
 */
export function encodePng(pixels) {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  if (!width || !height) throw new Error("encodePng: empty pixel grid");

  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter type 0 (none) per scanline
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels[y][x];
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB (truecolor, no alpha)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const idat = deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Render a set of code-defined sprites (palette-index grids) to one labelled
 * contact sheet PNG, scaled up so a critic can actually judge legibility and
 * palette discipline at a glance rather than squinting at 16 real pixels.
 *
 * `sprites`: [{ name, size, pixels: number[size][size] (palette indices) }]
 * `palette`: number[][3] (RGB 0-255), indexed by the values in `pixels`.
 * A palette index of -1 (or out of range) renders as magenta so an
 * out-of-bounds index is loudly visible instead of silently wrong.
 */
export function renderContactSheet(sprites, palette, { scale = 8, cols = 6, gap = 2, labelRows = 10 } = {}) {
  // Dimensions come off the pixel GRID, never off `size`. Every archetype body
  // and every gear overlay is 16 wide and 24 tall while `size` stays 16, so a
  // sheet measured by `size` clips each of them to its top two thirds: legs
  // missing, cloaks missing, in the one preview an art lane reviews its own
  // work in.
  const cellW = Math.max(...sprites.map((s) => s.pixels[0].length)) * scale + gap * 2;
  const cellH = Math.max(...sprites.map((s) => s.pixels.length)) * scale + gap * 2 + labelRows;
  const rows = Math.ceil(sprites.length / cols);
  const width = cellW * cols;
  const height = cellH * rows;

  const BG = [30, 30, 36];
  const MISSING = [255, 0, 255];
  const GRID = [58, 58, 68];

  const canvas = Array.from({ length: height }, () => Array.from({ length: width }, () => BG));

  sprites.forEach((sprite, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * cellW + gap;
    const oy = row * cellH + gap + labelRows;

    for (let y = 0; y < sprite.pixels.length; y++) {
      for (let x = 0; x < sprite.pixels[y].length; x++) {
        const idx = sprite.pixels[y][x];
        const rgb = idx >= 0 && idx < palette.length ? palette[idx] : MISSING;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const py = oy + y * scale + dy;
            const px = ox + x * scale + dx;
            if (py < height && px < width) canvas[py][px] = rgb;
          }
        }
      }
    }

    // A faint pixel-scale grid every tile boundary makes it obvious at a
    // glance whether art is genuinely tile-aligned or drifting.
    for (let x = 0; x <= sprite.pixels[0].length; x++) {
      const px = ox + x * scale;
      for (let y = 0; y < sprite.pixels.length * scale; y++) {
        const py = oy + y;
        if (px < width && py < height) canvas[py][px] = GRID;
      }
    }
    for (let y = 0; y <= sprite.pixels.length; y++) {
      const py = oy + y * scale;
      for (let x = 0; x < sprite.pixels[0].length * scale; x++) {
        const px = ox + x;
        if (px < width && py < height) canvas[py][px] = GRID;
      }
    }

    // Tiny bitmap label (3x5 glyphs, digits/uppercase/few symbols only) so a
    // sheet full of sprites is still identifiable without external tooling.
    drawLabel(canvas, sprite.name.slice(0, Math.floor(cellW / 4)).toUpperCase(), ox, row * cellH + gap, GRID.map((c) => Math.min(255, c + 140)));
  });

  return encodePng(canvas);
}

// A deliberately tiny 3x5 bitmap font, just enough characters for asset ids
// (A-Z, 0-9, dash, underscore, space). Good enough for a build-log contact
// sheet, not meant to be a general text renderer.
const FONT_3X5 = {
  " ": ["000", "000", "000", "000", "000"],
  "-": ["000", "000", "111", "000", "000"],
  _: ["000", "000", "000", "000", "111"],
};
const A_Z = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GLYPHS_AZ = [
  "010111101101101", "110101110101110", "011100100100011", "110101101101110",
  "111100110100111", "111100110100100", "011100101101011", "101101111101101",
  "111010010010111", "001001001101011", "101110100110101", "100100100100111",
  "101111111101101", "101111111111101", "010101101101010", "110101110100100",
  "010101101011101", "110101110110101", "011100010001110", "111010010010010",
  "101101101101011", "101101101110100", "101101111111101", "101101010101101",
  "101101010010010", "111001010100111",
];
A_Z.split("").forEach((ch, i) => {
  const bits = GLYPHS_AZ[i];
  FONT_3X5[ch] = [0, 1, 2, 3, 4].map((r) => bits.slice(r * 3, r * 3 + 3));
});
const DIGITS = "0123456789";
const GLYPHS_09 = [
  "111101101101111", "010110010010111", "111001111100111", "111001111001111",
  "101101111001001", "111100111001111", "111100111101111", "111001001001001",
  "111101111101111", "111101111001111",
];
DIGITS.split("").forEach((ch, i) => {
  const bits = GLYPHS_09[i];
  FONT_3X5[ch] = [0, 1, 2, 3, 4].map((r) => bits.slice(r * 3, r * 3 + 3));
});

function drawLabel(canvas, text, ox, oy, color) {
  let x = ox;
  for (const ch of text) {
    const glyph = FONT_3X5[ch] ?? FONT_3X5[" "];
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] === "1") {
          const py = oy + gy;
          const px = x + gx;
          if (py < canvas.length && px < canvas[0].length) canvas[py][px] = color;
        }
      }
    }
    x += 4;
  }
}
