"""
KayKit library maker "ground-painted": every ground, wall and edge tile of the game's fantasy set, in the PAINTED style.

Scope (targets in .cache/kaykit/library/targets.json): group ground (40 ids), wall (5) and edge (190), at 16 and 32 px per tile.
The approach is env_painted.py's: the 3D render supplies the layout, a pixel artist's texture pass (plain NumPy) supplies the surface.
What each material takes from KayKit, and what it does not:

  stone floor    Dungeon floor_tile_large: the octagon paving with recessed corner diamonds (the lattice is the render's, checked against its
                 groove pixels), painted with a lit upper left rim, mortar, tonal patches and speckle. floor_stone_cracked takes the crack pixels
                 of the pack's floor_tile_small_broken_A (the pixels the broken piece darkens against the plain piece); floor_stone_drain is
                 an inset grate after floor_tile_grate (bars over darkness), the bar grid resized to fit the octagon
  dirt           Dungeon floor_dirt_small_A..D: the pebbles and cracks of each piece are placed first, recoloured to the earth ramp, then painted
  walls          the Dungeon wall module's structure (a dark top course, blocks a module wide, joints every 4 units) read by eye as two courses
                 of ashlar and painted; no pixels come from the render. wall_stone, _b, _c are faces (the three differ in where the joints
                 fall), wall_stone_top the lit coping, wall_stone_base a face with the graded cast shadow the game's test counts. The game's
                 ONE row convention
  forest canopy  Medieval Hexagon tree_single_B rendered from straight above (the crown's own facets and light), stamped on a periodic crown
                 lattice and painted leafy
  grass, pale grass, sand, water   painted: no KayKit piece is a tileable ground texture (the Hexagon grass and water are one flat colour)
  cliff top, cliff face   painted rock. Tried and rejected: the Hexagon mountains (one flat colour per facet, too small to tile) and the Space Base
                 Bits terrain blocks (plain slabs: they confirm the structure, a lit lip over a dark face, and carry no rock texture)
  edges          the game's own masks (EDGE_BITE, orthoMask, innerMask, ORTHO_VARIANTS, INNER_VARIANTS; checked against fantasy.ts at 16 px) made
                 from these base tiles, with a painted bank per family: turf with spilled tufts (grass over ground), a lit and a shaded lip with a
                 cast shadow (stone and cliff over ground), foam and a shadow with a dark bank (water over ground), a soft meander (pale grass).
                 At 32 px the same masks at double scale (the bite profile interpolated, one pixel steps)

Variants of a material share one template: the outermost ring of pixels is byte identical in every variant, so the game's per cell variant
scatter never shows a seam (stone, canopy, walls and cliffs are lattices whose structure is shared; grass, sand, dirt and water share a ring noise).
Every random choice is seeded (rng()), every texture is periodic, so the output is the same pixels on every run.

Run from the repo root. The render step needs Blender (about 10 s); the painting step is plain NumPy (about 3 s) and also runs under Blender's
bundled python.exe, reading the renders cached in .cache/kaykit/scratch/ground-painted/raw_*.npz:

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/lib_ground_painted.py -- [--sizes 16,32] [--paint-only]
  "C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe" scripts/kaykit/lib_ground_painted.py --paint-only

Inputs (under .cache/, gitignored): dungeon/ and scratch/env/hexagon/ (KayKit Dungeon Remastered, Medieval Hexagon Pack; CC0, Kay Lousberg),
palette-fantasy.json, library/targets.json. Outputs: .cache/kaykit/library/parts/ground-painted-16.json and -32.json (validate with
node scripts/kaykit/check-part.mjs), and under .cache/kaykit/scratch/ground-painted/: sheets/ (contact sheets, a scene, a room, the autotile
maps), report.json (coverage, luminance numbers, the game's own field and edge tests run on these tiles).
"""
import hashlib
import json
import math
import os
import struct
import sys
import time
import zlib

import numpy as np

try:
    import bpy
    from mathutils import Matrix, Vector
except ImportError:                    # the painting is plain NumPy; only the render step needs Blender
    bpy = None

ROOT = os.getcwd()
PACK = os.path.join(ROOT, ".cache", "kaykit", "dungeon", "addons", "kaykit_dungeon_remastered")
GLTF = os.path.join(PACK, "Assets", "gltf")
HEX = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env", "hexagon", "addons", "kaykit_medieval_hexagon_pack", "Assets", "gltf")
PALETTE_JSON = os.path.join(ROOT, ".cache", "kaykit", "palette-fantasy.json")
TARGETS_JSON = os.path.join(ROOT, ".cache", "kaykit", "library", "targets.json")
PARTS = os.path.join(ROOT, ".cache", "kaykit", "library", "parts")
WORK = os.path.join(ROOT, ".cache", "kaykit", "scratch", "ground-painted")
TMP_PNG = os.path.join(WORK, f"render_{os.getpid()}.png")

USABLE = 48
UNITS_PER_TILE = 2.0       # the pack's grid: a small floor tile is 2 x 2 units
MAKER = "ground-painted"
STYLE = "painted"

# ---------------------------------------------------------------------------
# The game's palette (indices) by role. Ramps are dark to light.
# ---------------------------------------------------------------------------
GRASS_RAMP = [9, 16, 17, 18, 19, 38]          # outline, deep, shade, mid, lit, bright
WATER_RAMP = [12, 20, 21, 22, 23]             # abyss, deep, dark, base, light
ROCK_RAMP = [0, 24, 25, 26, 27]               # outline, deep, shade, body, lit
EARTH_RAMP = [1, 28, 29, 30, 31]              # outline, deep, shade, body, lit
STONE = {"mortar": 24, "dark": 25, "base": 26, "lit": 27}
GRASS = {"deep": 16, "dark": 17, "base": 18, "light": 19, "bright": 38}
WATER = {"abyss": 12, "deep": 20, "dark": 21, "base": 22, "light": 23}
EARTH = {"deep": 28, "dark": 29, "base": 30, "light": 31}
PALE = {"deep": 16, "dark": 17, "base": 19, "light": 38, "bright": 47, "pbright": 38, "tdark": 18, "tdeep": 17}     # the pale meadow: the lit greens carry the field


def log(*a):
    print("[ground]", *a, flush=True)


# ---------------------------------------------------------------------------
# Palette, PNG and contact sheets (no Blender needed)
# ---------------------------------------------------------------------------
_PAL = None


def palette():
    global _PAL
    if _PAL is None:
        with open(PALETTE_JSON) as fh:
            _PAL = np.array(json.load(fh)["palette"], np.uint8)
    return _PAL


def luma(idx):
    p = palette().astype(np.float64)
    return (0.2126 * p[:, 0] + 0.7152 * p[:, 1] + 0.0722 * p[:, 2])[np.asarray(idx, np.int64)]


def write_png(path, rgba):
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(png)


def to_rgba(idx, bg=(72, 72, 80)):
    idx = np.asarray(idx)
    out = np.zeros(idx.shape + (4,), np.uint8)
    solid = (idx >= 0) & (idx < 255)
    out[solid, :3] = palette()[idx[solid].astype(np.int64)]
    out[..., 3] = 255
    out[~solid, :3] = bg
    return out


_FONT = None


def draw_text(canvas, text, x, y, color=(235, 235, 235)):
    """3 x 5 pixel font, enough for contact sheet labels (upper case, digits, a few marks)."""
    global _FONT
    if _FONT is None:
        glyphs = {
            "A": "010101111101101", "B": "110101110101110", "C": "011100100100011", "D": "110101101101110", "E": "111100110100111",
            "F": "111100110100100", "G": "011100101101011", "H": "101101111101101", "I": "111010010010111", "J": "001001001101010",
            "K": "101101110101101", "L": "100100100100111", "M": "101111111101101", "N": "110101101101101", "O": "010101101101010",
            "P": "110101110100100", "Q": "010101101110011", "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
            "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101", "Y": "101101010010010",
            "Z": "111001010100111", "0": "111101101101111", "1": "010110010010111", "2": "110001010100111", "3": "110001010001110",
            "4": "101101111001001", "5": "111100110001110", "6": "011100111101111", "7": "111001010010010", "8": "111101111101111",
            "9": "111101111001110", " ": "000000000000000", "-": "000000111000000", ".": "000000000000010", ":": "000010000010000",
            "_": "000000000000111", "/": "001001010100100", "(": "010100100100010", ")": "010001001001010", "+": "000010111010000",
            ",": "000000000010100", "x": "000101010101000"}
        _FONT = {k: np.array([int(c) for c in v], np.uint8).reshape(5, 3) for k, v in glyphs.items()}
    cx = x
    for ch in text:
        g = _FONT.get(ch if ch in _FONT else ch.upper(), _FONT[" "])
        ys, xs = np.nonzero(g)
        for yy, xx in zip(ys, xs):
            if 0 <= y + yy < canvas.shape[0] and 0 <= cx + xx < canvas.shape[1]:
                canvas[y + yy, cx + xx, :3] = color
        cx += 4


def sheet(items, path, zoom=4, width=900, pad=3, bg=(58, 58, 66), cols=None):
    """items: (label, palette-index array); (None, None) ends a row. Rows wrap at `width` output pixels. Label above each."""
    rows, cur, x = [], [], pad
    for lab, arr in items:
        if lab is None:
            if cur:
                rows.append(cur)
            cur, x = [], pad
            continue
        w = max(arr.shape[1] * zoom, 4 * len(lab) * 1)
        if cur and x + w + pad > width:
            rows.append(cur)
            cur, x = [], pad
        cur.append((lab, arr, x))
        x += w + pad
    if cur:
        rows.append(cur)
    heights = [max(a.shape[0] for _, a, _ in r) * zoom + 8 for r in rows]
    canvas = np.zeros((sum(heights) + pad * (len(rows) + 1), width, 4), np.uint8)
    canvas[..., :3] = bg
    canvas[..., 3] = 255
    y = pad
    for r, hh in zip(rows, heights):
        for lab, arr, x in r:
            draw_text(canvas, lab, x, y)
            im = np.repeat(np.repeat(to_rgba(arr), zoom, 0), zoom, 1)
            canvas[y + 7:y + 7 + im.shape[0], x:x + im.shape[1]] = im
        y += hh + pad
    write_png(path, canvas)


# ---------------------------------------------------------------------------
# Seeded helpers (all textures are periodic, every choice comes from rng())
# ---------------------------------------------------------------------------

def rng(*parts):
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return np.random.RandomState(np.frombuffer(digest[:16], dtype=np.uint32))


def put(a, x, y, v):
    a[int(y) % a.shape[0], int(x) % a.shape[1]] = v


def stamp(a, x, y, rows, colours):
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch in colours:
                put(a, x + dx, y + dy, colours[ch])


def pv_noise(h, w, cell_y, cell_x, seed):
    """Smooth value noise in 0..1 that tiles with period (h, w)."""
    gy, gx = max(1, h // cell_y), max(1, w // cell_x)
    g = rng("pv", seed).rand(gy, gx)
    ys, xs = np.mgrid[0:h, 0:w]
    fy, fx = ys * (gy / float(h)), xs * (gx / float(w))
    y0, x0 = np.floor(fy).astype(int), np.floor(fx).astype(int)
    ty, tx = fy - y0, fx - x0
    ty, tx = ty * ty * (3 - 2 * ty), tx * tx * (3 - 2 * tx)
    a, b = g[y0 % gy, x0 % gx], g[y0 % gy, (x0 + 1) % gx]
    c, d = g[(y0 + 1) % gy, x0 % gx], g[(y0 + 1) % gy, (x0 + 1) % gx]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def despeckle(a):
    """Wrapping cleanup: a pixel none of whose four neighbours match it takes the commonest neighbour (no salt and pepper)."""
    n = [np.roll(a, s, ax) for ax, s in ((0, 1), (0, -1), (1, 1), (1, -1))]
    iso = sum((x == a).astype(np.int32) for x in n) == 0
    best, best_c = n[0], sum((x == n[0]).astype(np.int32) for x in n)
    for k in n[1:]:
        c = sum((x == k).astype(np.int32) for x in n)
        better = c > best_c
        best, best_c = np.where(better, k, best), np.where(better, c, best_c)
    return np.where(iso, best, a)


def clump_shapes():
    return [["xx"], ["xxx"], ["x", "x"], ["xx", ".x"], ["x.", "xx"], ["x.", ".x"], ["xxx", ".x."]]


def crack_path(r, n):
    """A jagged 1 px line of n steps as (dx, dy) offsets from its start, walking one way with the odd sidestep."""
    x = y = 0
    dirx, diry = int(r.choice([-1, 1])), int(r.choice([-1, 1]))
    pts = [(0, 0)]
    for _ in range(n):
        t = r.rand()
        if t < 0.45:
            x += dirx
        elif t < 0.72:
            y += diry
        elif t < 0.9:
            x += dirx
            y += diry
        else:
            x += dirx
            y -= diry
        pts.append((x, y))
    return pts


def edge_dist(T):
    y, x = np.mgrid[0:T, 0:T]
    return np.minimum(np.minimum(x, y), np.minimum(T - 1 - x, T - 1 - y))


def wrap_delta(T, cx, cy):
    """Signed distances (dx, dy) of every pixel centre from (cx, cy) on a torus of period T."""
    y, x = np.mgrid[0:T, 0:T].astype(np.float64)
    dx = (x - cx + T / 2.0) % T - T / 2.0
    dy = (y - cy + T / 2.0) % T - T / 2.0
    return dx, dy


def dilate(m, dy, dx):
    """m moved by (dy, dx): out[y, x] = m[y - dy, x - dx], with the edge pixels repeated outside (the neighbour tile is the same material)."""
    h, w = m.shape
    p = np.pad(m, 1, mode="edge")
    return p[1 - dy:1 - dy + h, 1 - dx:1 - dx + w]


def roll2(m, dy, dx):
    return np.roll(np.roll(m, dy, 0), dx, 1)


# ---------------------------------------------------------------------------
# Shared-ring variants. The game scatters a material's four field tiles per cell, so any variant may sit beside any other. Every
# variant is therefore its template plus detail kept clear of the tile's outermost ring (and a few pixels beyond it where the pattern
# crosses the border), so the ring is byte-identical in every variant and the tiles meet exactly as the template meets itself.
# ---------------------------------------------------------------------------

def ring_mask(T, w=1):
    return edge_dist(T) < w


def with_ring(variant, template, w=1):
    out = variant.copy()
    m = ring_mask(T=variant.shape[0], w=w)
    out[m] = template[m]
    return out


# ---------------------------------------------------------------------------
# Stone floor: the Dungeon's octagon paving, one octagon and four corner diamonds per tile
# ---------------------------------------------------------------------------
STONE_CUT = {16: 4, 32: 10}         # corner cut of each octagon, read off the render's groove pixels (env_painted.py)


def stone_geometry(T):
    """The lattice of the rendered floor_tile_large, in a window whose mortar lines run along the tile's row 0 and column 0, so the
    tile holds one octagon (columns 1..T-1) and a quarter of a recessed diamond at each corner. u, v count pixels from the mortar
    line; m is the depth of a pixel inside its octagon (0 on the lit and shaded rim rows, negative outside)."""
    Y, X = np.mgrid[0:T, 0:T]
    u, v = X, Y
    q = STONE_CUT.get(T, int(round(0.3 * T)))
    a, b = np.minimum(u, T - u), np.minimum(v, T - v)
    s = a + b
    m = np.minimum.reduce([u - 1, T - 1 - u, v - 1, T - 1 - v, u + v - q - 1, (T - u) + v - q - 1, u + (T - v) - q - 1, 2 * T - u - v - q - 1])
    return dict(u=u, v=v, a=a, b=b, s=s, q=q, m=m, octa=(a > 0) & (b > 0) & (s > q))


def stone_template(T):
    g = stone_geometry(T)
    u, v, a, b, s, q, octa = (g[k] for k in ("u", "v", "a", "b", "s", "q", "octa"))
    base = STONE["base"]
    out = np.full((T, T), base, np.int32)
    lit = octa & ((u == 1) | (v == 1) | (u + v == q + 1))
    dark = octa & ((u == T - 1) | (v == T - 1) | ((T - u) + (T - v) == q + 1)) & (T >= 32)      # the small tile has no room for a shaded rim
    out = np.where(lit, STONE["lit"], out)
    out = np.where(dark, STONE["dark"], out)
    straight = ((a == 0) | (b == 0)) & (s >= q)
    diag = (a > 0) & (b > 0) & (s == q)
    out = np.where(straight | diag, STONE["mortar"], out)
    # the diamond insets sit lower than the stones: shadow up left, a lit lip down right
    dx, dy = np.where(u <= T // 2, u, u - T), np.where(v <= T // 2, v, v - T)
    dia = s < q
    rim = dia & (s == q - 1)
    out = np.where(dia, STONE["dark"], out)
    out = np.where(rim & (dx <= 0) & (dy <= 0), STONE["mortar"], out)
    out = np.where(rim & (dx >= 0) & (dy >= 0), STONE["base"], out)
    return out.astype(np.uint8), g, lit | dark


def stone_clumps(out, g, T, r, n, margin=2, vals=None):
    """Clustered speckle inside the octagon: dark pits and light flecks two to four pixels each."""
    m = g["m"]
    base = STONE["base"]
    placed, tries = 0, 0
    while placed < n and tries < 400:
        tries += 1
        lu, lv = int(r.randint(2, T - 3)), int(r.randint(2, T - 3))
        shape = clump_shapes()[int(r.randint(0, 7))]
        cells = [(lu + dx_, lv + dy_) for dy_, row in enumerate(shape) for dx_, ch in enumerate(row) if ch == "x"]
        if not all(0 <= x < T and 0 <= y < T and m[y, x] >= margin for x, y in cells):
            continue
        if not all(out[y, x] in (base, base - 1, base + 1) for x, y in cells):
            continue
        val = (base - 1, base + 1)[int(r.rand() < 0.45)] if vals is None else vals[int(r.randint(len(vals)))]
        for x, y in cells:
            out[y, x] = val
        placed += 1


def stone_tone(out, g, T, seed, lit_share, dark_share):
    """Soft tonal patches across each stone: lighter toward the upper left (the key light), darker toward the lower right, broken up by
    tile-periodic noise. A step lighter or darker than the body, no more."""
    m, u, v = g["m"], g["u"], g["v"]
    cell = max(3, T // 6)
    nz = pv_noise(T, T, cell, cell, ("stone-tone", T, seed))
    grad = 1.0 - ((u + v) / (2.0 * T))                          # 1 at the upper left, 0 at the lower right
    t = 0.68 * nz + 0.32 * grad
    lo, hi = np.quantile(t[m >= 2], dark_share), np.quantile(t[m >= 2], 1.0 - lit_share)
    lev = np.where(t < lo, -1, np.where(t > hi, 1, 0)).astype(np.int32)
    lev = despeckle(despeckle(lev))
    ok = (m >= 2) & (out == STONE["base"])
    return np.where(ok, out + lev, out)


def stone_crack(out, g, T, r, frac, margin=2, light=True):
    m = g["m"]
    n = int(T * frac)
    for _ in range(60):
        lu, lv = int(r.randint(T // 4, T - T // 4)), int(r.randint(T // 4, T - T // 4))
        pts = crack_path(r, n)
        pix = [(lu + cx, lv + cy) for cx, cy in pts]
        if sum(1 for x, y in pix if 0 <= x < T and 0 <= y < T and m[y, x] >= margin) >= len(pix) * 0.85:
            break
    for k, (x, y) in enumerate(pix):
        if 0 <= x < T and 0 <= y < T and m[y, x] >= margin:
            out[y, x] = STONE["mortar"]
            if light and T >= 32 and k % 3 == 1 and 0 <= y + 1 < T and 0 <= x + 1 < T and m[y + 1, x + 1] >= margin and out[y + 1, x + 1] == STONE["base"]:
                out[y + 1, x + 1] = STONE["lit"]


def components(mask):
    """8-connected components of a boolean mask, largest first, as lists of (y, x)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, bool)
    out = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not seen[y, x]:
                stack, comp = [(y, x)], []
                seen[y, x] = True
                while stack:
                    cy, cx = stack.pop()
                    comp.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                                seen[ny, nx] = True
                                stack.append((ny, nx))
                out.append(comp)
    out.sort(key=len, reverse=True)
    return out


def stone_render_coverage(T, src):
    """How much of the rendered floor_tile_large's groove (the pixels that are not the plain stone colour) this tile's lattice covers, in the
    render's own window (mortar lines on column and row T/2 - 1, a 2 x 2 tile module)."""
    if src is None or "stone_large" not in src:
        return None
    raw = src["stone_large"]
    vals, cnt = np.unique(raw, return_counts=True)
    groove = raw != vals[cnt.argmax()]
    g = stone_geometry(T)
    q = g["q"]
    off = T // 2 - 1
    W = 2 * T
    Y, X = np.mgrid[0:W, 0:W]
    u, v = (X - off) % T, (Y - off) % T
    a, b = np.minimum(u, T - u), np.minimum(v, T - v)
    s_ = a + b
    mine = (((a == 0) | (b == 0)) & (s_ >= q)) | ((a > 0) & (b > 0) & (s_ == q)) | (s_ < q)
    return {"renderGroovePixels": int(groove.sum()), "coveredByLattice": int((groove & mine).sum())}


def paint_stone(T, src=None):
    """Four field tiles, a cracked one and a drain, all sharing one ring (mortar, rims, diamonds). Returns ({name: tile}, template)."""
    tmpl, g, rim = stone_template(T)
    m = g["m"]
    variants = {}
    specs = {"a": dict(n=1 + T // 16, lit=0.16, dark=0.10, crack=0.0), "b": dict(n=1 + T // 16, lit=0.10, dark=0.22, crack=0.0),
             "c": dict(n=2 + T // 16, lit=0.14, dark=0.12, crack=0.4), "d": dict(n=3 + T // 8, lit=0.20, dark=0.14, crack=0.0)}
    for k, sp in specs.items():
        out = tmpl.astype(np.int32).copy()
        r = rng("stone", T, k)
        out = stone_tone(out, g, T, k, sp["lit"], sp["dark"])
        stone_clumps(out, g, T, r, sp["n"])
        if sp["crack"]:
            stone_crack(out, g, T, r, sp["crack"])
        variants[k] = with_ring(out.astype(np.uint8), tmpl)
    # cracked: the crack of the pack's broken tiles (the pixels the broken piece darkens against the plain one, both pieces), moved onto this
    # tile's octagon; a lit lip beside the groove at 32 px
    out = stone_tone(tmpl.astype(np.int32).copy(), g, T, "x", 0.14, 0.14)
    r = rng("stone", T, "cracked")
    placed = False
    if src is not None and "stone_broken_a" in src:
        small = src["stone_small"]
        lum = luma(np.arange(len(palette())))
        vals, cnt = np.unique(small, return_counts=True)
        mode = vals[cnt.argmax()]
        dark = (src["stone_broken_a"] != small) & (lum[src["stone_broken_a"].astype(np.int64)] < lum[mode])
        ys, xs = np.nonzero(dark)
        if len(ys) >= 8:
            cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
            for y, x in zip(ys, xs):
                ty, tx = int(y - cy + T // 2), int(x - cx + T // 2)
                if 0 <= ty < T and 0 <= tx < T and m[ty, tx] >= 2:
                    out[ty, tx] = STONE["mortar"]
            for y, x in zip(ys, xs):
                ty, tx = int(y - cy + T // 2) + 1, int(x - cx + T // 2) + 1
                if T >= 32 and 0 <= ty < T and 0 <= tx < T and m[ty, tx] >= 2 and out[ty, tx] == STONE["base"]:
                    out[ty, tx] = STONE["lit"]
            placed = True
    if not placed:
        stone_crack(out, g, T, r, 0.9)
    stone_clumps(out, g, T, r, 2 + T // 16)
    variants["cracked"] = with_ring(out.astype(np.uint8), tmpl)
    # drain: a recessed grate, lit lip up left, bars over darkness (the bar pitch is the pack's grate, 3 px per bar cell at 16 px)
    out = tmpl.astype(np.int32).copy()
    pitch = 3 if T == 16 else 6
    half = (T // 2 - 3) if T == 16 else (T // 2 - 6)
    c0 = T // 2
    x0, x1, y0, y1 = c0 - half, c0 + half, c0 - half, c0 + half
    out[y0:y1 + 1, x0:x1 + 1] = 0
    for yy in range(y0 + 1, y1):
        for xx in range(x0 + 1, x1):
            if (xx - x0) % pitch == 0 or (yy - y0) % pitch == 0:
                out[yy, xx] = STONE["dark"] if ((xx + yy) % 2 or T == 16) else STONE["base"]
    out[y0, x0:x1 + 1] = STONE["lit"]
    out[y0:y1 + 1, x0] = STONE["lit"]
    out[y1, x0:x1 + 1] = STONE["mortar"]
    out[y0:y1 + 1, x1] = STONE["mortar"]
    # a thin shadow beside the lip on the stone
    out[y1 + 1, x0 + 1:x1 + 2] = STONE["dark"]
    out[y0 + 1:y1 + 2, x1 + 1] = STONE["dark"]
    variants["drain"] = with_ring(out.astype(np.uint8), tmpl)
    return variants, tmpl


# ---------------------------------------------------------------------------
# Meadow: grass and pale grass. Clumps of three greens a few pixels across, tufts, and a shared outermost ring.
# ---------------------------------------------------------------------------

def _tufts(T):
    if T >= 32:
        return [["L.L", "LDL", ".D."], ["L..L", ".LD.", ".XD."], [".L.L.", "LDLDL", ".X.X."], ["..L", ".LD", "LD.", "D.."], ["L..", "DL.", ".DL"],
                [".L.", "LDL", "XDX"]]
    return [["L.L", ".D."], [".L", "LD", ".D"], ["L.", "DL", "D."], ["L.L", ".X."]]


def paint_meadow(T, cols, kinds, key, blend=3.0, base_cell=3, ring_lo=None, ring_hi=None, cores=True):
    """cols: dict deep/dark/base/light/bright. kinds: list of (name, dict(tufts=share, flowers=n, big=bool)). Returns {name: tile}.
    Every variant takes its outermost ring from one shared periodic base texture; inside, its own noise takes over from the base's over
    three pixels (the two fields are blended, variance kept), and tufts and flowers sit clear of the edge."""
    big = T >= 32
    cell = 4 if big else 3
    ed = edge_dist(T)
    # the shared ring is classified with the kinds' average thresholds, so it is as light and as dark as the inside of the tile
    ring_lo = float(np.mean([kd.get('lo', 0.30) for _, kd in kinds])) - 0.04 if ring_lo is None else ring_lo
    ring_hi = float(np.mean([kd.get('hi', 0.70) for _, kd in kinds])) - 0.04 if ring_hi is None else ring_hi
    win = np.clip(ed / blend, 0.0, 1.0)
    ring = ed == 0
    tufts = _tufts(T)
    tc = {"L": cols["light"], "D": cols.get("tdark", cols["dark"]), "X": cols.get("tdeep", cols["deep"]), "B": cols["bright"]}

    def classify(nz, lo=0.30, hi=0.70):
        # the thresholds narrow toward the ring: a dark or light run lying along a tile border would repeat in every tile as a stripe
        lo_a, hi_a = ring_lo + (lo - ring_lo) * win, ring_hi - (ring_hi - hi) * win
        a = np.where(nz < lo_a, cols["dark"], np.where(nz > hi_a, cols["light"], cols["base"])).astype(np.uint8)
        a = despeckle(despeckle(a))
        if cores:
            # the heart of a dark patch is a step deeper, the heart of a light patch a step brighter (painted depth, never on the ring)
            deep_c = np.where((nz < lo_a * 0.45) & (win >= 1.0) & (a == cols["dark"]), 1, 0)
            bright_c = np.where((nz > 1.0 - (1.0 - hi_a) * 0.45) & (win >= 1.0) & (a == cols["light"]), 1, 0)
            a = np.where(despeckle(deep_c) == 1, cols["deep"], a)
            a = np.where(despeckle(bright_c) == 1, cols.get("pbright", cols["bright"]), a).astype(np.uint8)
        return a

    bc = base_cell
    nz0 = pv_noise(T, T, bc, bc, (key, "patch", T, "shared"))
    base = classify(nz0)
    norm = np.sqrt(win * win + (1 - win) * (1 - win))
    out = {}
    for name, kd in kinds:
        r = rng(key, "var", T, name)
        nzk = pv_noise(T, T, cell, cell, (key, "patch", T, name))
        t = classify(0.5 + (win * (nzk - 0.5) + (1 - win) * (nz0 - 0.5)) / norm, kd.get("lo", 0.30), kd.get("hi", 0.70))
        n = (3 if not big else 5)
        for gy in range(n):
            for gx in range(n):
                if r.rand() < kd["tufts"]:
                    shape = tufts[int(r.randint(0, len(tufts)))]
                    x = int((gx + 0.1 + 0.8 * r.rand()) * T / n)
                    y = int((gy + 0.1 + 0.8 * r.rand()) * T / n)
                    if 1 <= x and 1 <= y and x + max(len(s) for s in shape) <= T - 1 and y + len(shape) <= T - 1:
                        stamp(t, x, y, shape, tc)
        for _ in range(kd.get("flecks", 0)):
            for _try in range(40):
                x, y = int(r.randint(2, T - 4)), int(r.randint(2, T - 3))
                shape = ["xx"] if T < 32 else ["xxx", ".x."]
                if 2 <= x and 2 <= y and x + 3 <= T - 2 and y + 2 <= T - 2:
                    stamp(t, x, y, shape, {"x": cols["bright"]})
                    break
        if not (t == cols.get("tdeep", cols["deep"])).any():          # every variant carries its deepest tone: one more tuft
            shape = tufts[-1] if T < 32 else tufts[2]
            for _try in range(40):
                x, y = int(r.randint(2, T - 6)), int(r.randint(2, T - 5))
                if x + max(len(s_) for s_ in shape) <= T - 2 and y + len(shape) <= T - 2:
                    stamp(t, x, y, shape, tc)
                    break
        nf = kd.get("flowers", 0)
        for i in range(nf):
            shape = [".w.", "wYw", ".w."]
            band = (T - 7) / float(nf)
            y = 2 + int((i + 0.15 + 0.7 * r.rand()) * band)
            x = int(r.randint(2, T - 5))
            if 2 <= x and 2 <= y and x + 3 <= T - 2 and y + 3 <= T - 2:
                stamp(t, x, y, shape, {"w": 5, "Y": 46})
        t[ring] = base[ring]
        out[name] = t
    return out


GRASS_KINDS = [("a", dict(tufts=0.45, lo=0.36, hi=0.64)), ("b", dict(tufts=0.6, lo=0.36, hi=0.64)), ("c", dict(tufts=0.55, lo=0.40, hi=0.66)),
               ("d", dict(tufts=0.6, lo=0.35, hi=0.60)), ("tufted", dict(tufts=0.95, lo=0.38, hi=0.64)),
               ("flowers", dict(tufts=0.4, lo=0.36, hi=0.64, flowers=3))]
PALE_KINDS = [("a", dict(tufts=0.4, lo=0.24, hi=0.60)), ("b", dict(tufts=0.5, lo=0.26, hi=0.58)),
              ("c", dict(tufts=0.45, lo=0.28, hi=0.62)), ("d", dict(tufts=0.5, lo=0.30, hi=0.55))]


# ---------------------------------------------------------------------------
# Water: short horizontal ripples (a light line and its shadow) and dashes of a darker step, four variants
# ---------------------------------------------------------------------------

def paint_water(T, nvar=4):
    """Water: slow swells (patches a step darker), short horizontal ripples (a light line with its shadow one row down and one across),
    troughs (dashes of a deeper step) and a glint now and then. Shared ring and swell field, so any variant meets any variant."""
    big = T >= 32
    cols = {"dark": WATER["dark"], "base": WATER["base"], "light": WATER["base"]}
    ring_noise = pv_noise(T, T, 4, 4, ("water", "swell", T, "shared"))
    cell = 6 if big else 4

    def rip(t, x, y, r):
        n = int(r.randint(5, 10)) if big else int(r.randint(3, 6))
        if x + n + 1 > T - 2 or y + 1 > T - 2:
            return False
        t[y, x:x + n] = WATER["light"]
        t[y + 1, x + 1:x + 1 + n] = WATER["dark"] if (big or r.rand() < 0.45) else WATER["deep"]
        return True

    def trough(t, x, y, r):
        n = int(r.randint(4, 9)) if big else int(r.randint(3, 6))
        if x + n + 1 > T - 2 or y + 1 > T - 2:
            return False
        t[y + 1, x + 1:x + 1 + n] = WATER["deep"]
        return True

    def glint(t, x, y, r):
        if x + 3 > T - 2 or y + 2 > T - 2:
            return False
        t[y, x:x + 2] = WATER["light"]
        return True

    variants = {}
    for k in range(nvar):
        r = rng("water-var", T, k)
        t, _ = _patch_field(T, "water", "abcd"[k], cols, ring_noise, 0.14 if big else 0.2, 2.0, cell, ring_lo=0.0, ring_hi=2.0)
        grid_decals(t, r, T, 4 if not big else 7, [(0.5, rip), (0.3, trough), (0.08, glint)], margin=1)
        for fn in (rip, trough, glint):                     # every variant carries all four tones: a ripple, its shadow, a trough, a glint
            for _try in range(30):
                if fn(t, int(r.randint(2, T - 10)), int(r.randint(2, T - 4)), r):
                    break
        variants["abcd"[k]] = t
    return variants


# ---------------------------------------------------------------------------
# Sand and dirt: patchy ground with ripples (sand) or clods, pebbles and cracks (dirt). Same shared ring as the meadow.
# ---------------------------------------------------------------------------

def _patch_field(T, key, name, cols, ring_noise, lo, hi, cell, blend=3.0, ring_lo=None, ring_hi=None):
    """Three-tone patch field (dark / base / light). Inside, clustered patches from the variant's own tile-periodic noise; toward the tile's
    outermost ring the field is blended into one shared tile-periodic noise (the same in every variant), so the ring is identical in every
    variant and continues across a border as the shared noise continues across its own wrap. Returns (tile, win)."""
    ed = edge_dist(T)
    win = np.clip(ed / blend, 0.0, 1.0)
    norm = np.sqrt(win * win + (1 - win) * (1 - win))
    nzk = pv_noise(T, T, cell, cell, (key, "patch", T, name))
    nz = 0.5 + (win * (nzk - 0.5) + (1 - win) * (ring_noise - 0.5)) / norm
    rlo = lo if ring_lo is None else ring_lo
    rhi = hi if ring_hi is None else ring_hi
    lo_a, hi_a = rlo + (lo - rlo) * win, rhi - (rhi - hi) * win
    a = np.where(nz < lo_a, cols["dark"], np.where(nz > hi_a, cols["light"], cols["base"])).astype(np.uint8)
    return despeckle(despeckle(a)), win


def _stamp_safe(t, x, y, shape, colours, margin=2):
    T = t.shape[0]
    w, h = max(len(s) for s in shape), len(shape)
    if x < margin or y < margin or x + w > T - margin or y + h > T - margin:
        return False
    stamp(t, x, y, shape, colours)
    return True


def _scatter(t, r, T, shapes, colours, n, margin=2, tries=40):
    placed = 0
    for _ in range(n):
        for _try in range(tries):
            shape = shapes[int(r.randint(0, len(shapes)))]
            x, y = int(r.randint(margin, T - margin)), int(r.randint(margin, T - margin))
            if _stamp_safe(t, x, y, shape, colours, margin):
                placed += 1
                break
    return placed


def grid_decals(t, r, T, cell, rules, margin=2):
    """Spread decals evenly: a jittered grid of `cell` px cells clear of the tile's ring; each cell draws at most one decal, picked by the
    probabilities in `rules` = [(probability, fn(t, x, y, r) -> drawn?)]. Returns how many were drawn."""
    n = max(1, (T - 2 * margin) // cell)
    span = (T - 2 * margin) / float(n)
    drawn = 0
    for gy in range(n):
        for gx in range(n):
            u = r.rand()
            acc = 0.0
            for prob, fn in rules:
                acc += prob
                if u < acc:
                    x = margin + int((gx + 0.05 + 0.9 * r.rand()) * span)
                    y = margin + int((gy + 0.05 + 0.9 * r.rand()) * span)
                    if fn(t, x, y, r):
                        drawn += 1
                    break
    return drawn


def draw_shape(t, x, y, shape, colours, margin=2):
    T = t.shape[0]
    w, h = max(len(s_) for s_ in shape), len(shape)
    if x < margin or y < margin or x + w > T - margin or y + h > T - margin:
        return False
    stamp(t, x, y, shape, colours)
    return True


def ripple(t, x, y, n, crest, shade, sag=0.18, margin=2):
    """A wind ripple: a crest run that sags a pixel every few steps, its shade one row down and one across."""
    T = t.shape[0]
    pix = []
    for k in range(n):
        yy = y + int(round(k * sag))
        pix.append((x + k, yy, crest))
        pix.append((x + k + 1, yy + 1, shade))
    if any(not (margin <= px < T - margin and margin <= py < T - margin) for px, py, _ in pix):
        return False
    for px, py, c in pix:
        t[py, px] = c
    return True


def paint_sand(T):
    """Fine grained sand: soft patches a step lighter or darker, wind ripples (a lit crest over a shaded lee), grain clumps, a pebble now and then."""
    big = T >= 32
    cols = {"dark": 30, "base": 31, "light": 3}
    cell = 5 if big else 4
    ring_noise = pv_noise(T, T, 3, 3, ("sand", "patch", T, "shared"))
    out = {}
    lens = (5, 11) if big else (3, 6)

    def rip(t, x, y, r):
        n = int(r.randint(*lens))
        return ripple(t, x, y, n, 3, 29 if r.rand() < 0.4 else 30, sag=float(r.choice([0.0, 0.0, 0.2, -0.2])))

    def grain_l(t, x, y, r):
        return draw_shape(t, x, y, [["xx"], ["x", "x"], ["xx", ".x"]][int(r.randint(0, 3))], {"x": 3})

    def grain_d(t, x, y, r):
        return draw_shape(t, x, y, [["xx"], ["xxx"], ["x", "x"]][int(r.randint(0, 3))], {"x": 30})

    def pebble(t, x, y, r):
        return draw_shape(t, x, y, [".ll.", "lLLd", ".dd."] if big else ["lL", "dd"], {"l": 3, "L": 44, "d": 29}, margin=3)

    for name in "abcd":
        r = rng("sand", T, name)
        t, _ = _patch_field(T, "sand", name, cols, ring_noise, 0.20 if big else 0.26, 0.82 if big else 0.78, cell, ring_lo=0.0, ring_hi=1.0)
        grid_decals(t, r, T, 4 if not big else 6, [(0.55, rip), (0.15, grain_l), (0.15, grain_d), (0.06 if name in "bd" else 0.0, pebble)])
        for _try in range(30):                                  # every variant carries all four sand tones: one ripple with the deep lee
            x, y = int(r.randint(2, T - 9)), int(r.randint(2, T - 4))
            if ripple(t, x, y, lens[0], 3, 29, sag=0.0):
                break
        out[name] = t
    return out


def dirt_seeds(src, T, name):
    """The pebbles and cracks of the pack's dirt piece (floor_dirt_small_A..D) as lists of (pixels, darker?) per 8-connected component."""
    if src is None or f"dirt_{name}" not in src:
        return []
    a = src[f"dirt_{name}"].astype(np.int64)
    vals, cnt = np.unique(a, return_counts=True)
    mode = vals[cnt.argmax()]
    lum = luma(np.arange(len(palette())))
    comps = components(a != mode)
    out = []
    for comp in comps:
        ys = [c[0] for c in comp]
        xs = [c[1] for c in comp]
        if min(ys) < 2 or max(ys) >= T - 2 or min(xs) < 2 or max(xs) >= T - 2:
            continue
        dark = float(np.mean([lum[a[y, x]] for y, x in comp])) < lum[mode]
        out.append((comp, dark))
    return out


def paint_dirt(T, src=None):
    """Packed earth: sparse clods a step darker or lighter, pebbles with a shadow, cracks; the pebbles and cracks of the pack's dirt pieces
    are placed first."""
    big = T >= 32
    cols = {"dark": EARTH["dark"], "base": EARTH["base"], "light": EARTH["light"]}
    cell = 4 if big else 3
    ring_noise = pv_noise(T, T, 3, 3, ("dirt", "patch", T, "shared"))
    out = {}

    def pebble(t, x, y, r):
        return draw_shape(t, x, y, [".ll.", "lLLd", ".dd."] if big else ["lL", "dd"], {"l": EARTH["light"], "L": EARTH["light"], "d": EARTH["deep"]}, margin=3)

    def clod(t, x, y, r):
        shapes = [["xxx", "xxx"], [".xxx", "xxxx", ".xx."], ["xxxx"], ["xxx", ".xx"]] if big else [["xx", "xx"], [".xx", "xxx"], ["xxx"], ["xx", ".x"]]
        shape = shapes[int(r.randint(0, len(shapes)))]
        ok = draw_shape(t, x, y, shape, {"x": EARTH["dark"]}, margin=3)
        if ok:
            for k in range(len(shape[0])):
                if shape[0][k] == "x":
                    t[y, x + k] = EARTH["base"]
        return ok

    def speck(t, x, y, r):
        return draw_shape(t, x, y, [["xx"], ["xxx"], ["x", "x"], ["xx", ".x"]][int(r.randint(0, 4))], {"x": EARTH["deep"]})

    def lite(t, x, y, r):
        return draw_shape(t, x, y, [["xx"], ["x", "x"], ["xx", "x."]][int(r.randint(0, 3))], {"x": EARTH["light"]})

    for name in "abcd":
        r = rng("dirt", T, name)
        t, _ = _patch_field(T, "dirt", name, cols, ring_noise, 0.22 if big else 0.30, 0.80 if big else 0.74, cell, ring_lo=0.0, ring_hi=1.0)
        for comp, dark in dirt_seeds(src, T, name):
            for y, x in comp:
                t[y, x] = EARTH["deep"] if dark else EARTH["light"]
        grid_decals(t, r, T, 5 if not big else 7, [(0.22, pebble), (0.2, clod), (0.2, speck), (0.15, lite)])
        if name in "bc":
            n = int(T * 0.4)
            for _try in range(40):
                lu, lv = int(r.randint(3, T - 3)), int(r.randint(3, T - 3))
                pts = crack_path(r, n)
                pix = [(lu + cx, lv + cy) for cx, cy in pts]
                if all(2 <= x < T - 2 and 2 <= y < T - 2 for x, y in pix):
                    for x, y in pix:
                        t[y, x] = EARTH["deep"]
                    break
        out[name] = t
    return out


# ===========================================================================
# RENDER SECTION (Blender): the KayKit pieces the painting is laid over. Copied from env_painted.py (same stage, same light, same
# quantiser), so the layout the painting reads is the approved prototype's. Nothing in it runs without bpy.
# ===========================================================================
TRANSPARENT = 255
RENDERS = [0]

# ---------------------------------------------------------------------------
# Tunables (the conversion)
# ---------------------------------------------------------------------------
SS = 8                      # supersample per output pixel
LIGHT = np.array([-0.45, 0.60, 0.66], np.float32)   # camera space, upper left and toward the viewer, same as the characters
LIGHT /= np.linalg.norm(LIGHT)
LEVEL_K = 3.0               # ramp steps per unit of light, around a flat face (n.L of a face toward the viewer)
LAM_FLAT = 0.665            # n.L of a face that looks straight at the camera
FLAT_COS = 0.93             # a sub-pixel whose normal is within ~21 degrees of a reference face counts as flat
EDGE_MIN = 0.10             # a pixel at least this sloped is a candidate line pixel (bevel, groove, brick edge)
EDGE_SOLID = 0.45           # ... and one this sloped is a line pixel whatever its neighbours do
GRADIENT_K = 1.0            # weight of the atlas's baked top-to-bottom gradient (Kay's cheap ambient occlusion)
COVER_T = 0.40              # prop silhouettes: block coverage needed to be solid
CELL_W, CELL_H = 128, 256   # the KayKit atlas: 8 x 4 swatches, gradient top to bottom
GRADIENT_SAMPLE = 0.38

# Ramps are six steps, dark to light, as palette indices (game palette, 0..47 only).
# Flat lit surfaces land on step 3. Step 0 is the outline-dark used for crevices only.
RAMPS = {
    "stone": [0, 24, 25, 26, 27, 27],        # the game's ROCK ramp (floor_stone, wall_stone use exactly these)
    "dark": [0, 0, 6, 24, 25, 26],           # iron, near black swatches
    "wood": [1, 45, 35, 37, 2, 44],          # WOOD_DEEP .. WOOD_LIGHT
    "ember": [10, 43, 15, 42, 46, 5],        # flame
    "gold": [1, 28, 35, 13, 46, 5],
    "grass": [9, 16, 17, 18, 19, 19],         # the game's GRASS ramp
    "water": [12, 20, 21, 22, 23, 23],
    "earth": [1, 28, 29, 30, 31, 31],
}
OUTLINE_OF = {"stone": 0, "dark": 0, "wood": 1, "ember": 10, "gold": 1, "grass": 9, "water": 12, "earth": 1}

def base_level(cls, lum):
    """Which ramp step a flat, lit-from-the-front face of this swatch sits on (0..5). Lighter swatches sit higher."""
    if cls == "stone":
        return 3.0 + (lum - 0.59) / 0.26
    if cls == "wood":
        return 3.0 + (lum - 0.45) / 0.10
    if cls == "dark":
        return 2.0 + (lum - 0.12) / 0.15
    if cls == "gold":
        return 3.0 + (lum - 0.65) / 0.15
    return 3.0


# ---------------------------------------------------------------------------
# Plain helpers
# ---------------------------------------------------------------------------
def srgb_to_lab(rgb01):
    rgb01 = np.asarray(rgb01, dtype=np.float64)
    c = np.where(rgb01 <= 0.04045, rgb01 / 12.92, ((rgb01 + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    return np.stack([116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])], -1)


def classify(rgb255):
    """Swatch colour -> material class. The Dungeon atlas is slate and grey stone, brown wood, near-black iron,
    orange flame, a few accents (banners, glass, cloth) that fall through to an automatic hue-family ramp."""
    r, g, b = [c / 255.0 for c in rgb255]
    mx, mn = max(r, g, b), min(r, g, b)
    v = mx
    sat = 0.0 if mx <= 0 else (mx - mn) / mx
    if mx == mn:
        hue = 0.0
    elif mx == r:
        hue = (60 * ((g - b) / (mx - mn))) % 360
    elif mx == g:
        hue = 60 * ((b - r) / (mx - mn)) + 120
    else:
        hue = 60 * ((r - g) / (mx - mn)) + 240
    if v < 0.25:
        return "dark"
    if sat < 0.20:
        return "stone"
    if 8 <= hue <= 40 and sat >= 0.68 and v >= 0.85:
        return "ember"
    if 8 <= hue <= 38 and sat >= 0.26:
        return "wood"
    if 40 < hue <= 52 and sat >= 0.45 and v >= 0.75:
        return "gold"
    if 52 < hue <= 170 and sat >= 0.30:
        return "grass"
    if 190 <= hue <= 250 and sat >= 0.45:
        return "water"
    if 190 <= hue <= 260 and sat < 0.32:
        return "stone"          # blue-grey slate
    return None


def auto_ramp(rgb255, pal_lab):
    lab = srgb_to_lab(np.asarray(rgb255, np.float64) / 255.0)
    pl = pal_lab[:USABLE]
    d = np.sqrt((((pl - lab) * np.array([1.0, 1.2, 1.2])) ** 2).sum(-1))
    base = int(d.argmin())
    lb, ab, bb = pl[base]

    def pick(dl, lighter):
        best, best_s = base, 1e9
        for i in range(USABLE):
            ld = pl[i, 0] - lb
            if lighter and ld < 5:
                continue
            if (not lighter) and ld > -5:
                continue
            s = abs(ld - dl) + 1.15 * np.hypot(pl[i, 1] - ab, pl[i, 2] - bb)
            if s < best_s:
                best, best_s = i, s
        return best

    sh2, sh1, li1, li2 = pick(-34, False), pick(-17, False), pick(15, True), pick(30, True)
    return [sh2, sh1, sh1, base, li1, li2]


def block_sum(a, h, w, ss):
    return a.reshape(h, ss, w, ss).sum(axis=(1, 3))


def shift(a, dy, dx, fill):
    out = np.full_like(a, fill)
    h, w = a.shape
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[yd, xd] = a[ys, xs]
    return out



class RenderPal:
    """The game palette in Lab, for the quantiser's automatic ramps."""

    def __init__(self):
        self.rgb = palette()
        self.lab = srgb_to_lab(self.rgb.astype(np.float64) / 255.0)


def dungeon_path(name):
    path = os.path.join(GLTF, name + ".gltf.glb")
    return path if os.path.exists(path) else os.path.join(GLTF, name + ".glb")


def hex_finder():
    idx = {}
    for dp, _, fn in os.walk(HEX):
        for f in fn:
            if f.endswith(".gltf"):
                idx[f[:-5]] = os.path.join(dp, f)
    return lambda name: idx[name]


class Part:
    def __init__(self, name, mesh, matrix):
        self.name, self.mesh, self.matrix = name, mesh, matrix


class Library:
    def __init__(self, finder=dungeon_path):
        self.finder = finder
        self.parts = {}
        self.mat = None
        self.img = None
        self.node = None
        self.flat_img = None
        self.mat_rgb = None      # (M,3) unique flat swatch colours
        self.mat_key = None
        self.mat_class = None
        self.mat_ramp = None     # (M,6)
        self.mat_outline = None
        self.mat_base = None
        self.mat_weight = None
        self.bounds = {}

    def load(self, name):
        if name in self.parts:
            return self.parts[name]
        path = self.finder(name)
        b_o, b_m, b_i = set(bpy.data.objects), set(bpy.data.materials), set(bpy.data.images)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in b_o]
        parts = [Part(o.name, o.data, o.matrix_world.copy()) for o in new if o.type == "MESH"]
        new_mats = [m for m in bpy.data.materials if m not in b_m]
        if self.mat is None:
            self.mat = new_mats[0]
            for n in self.mat.node_tree.nodes:
                if n.type == "TEX_IMAGE":
                    self.node, self.img = n, n.image
            self.node.interpolation = "Closest"
        for p in parts:
            for i in range(max(1, len(p.mesh.materials))):
                if i < len(p.mesh.materials):
                    p.mesh.materials[i] = self.mat
                else:
                    p.mesh.materials.append(self.mat)
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        for m in new_mats:
            if m is not self.mat and m.users == 0:
                bpy.data.materials.remove(m)
        for im in [i for i in bpy.data.images if i not in b_i]:
            if im is not self.img and im.users == 0:
                bpy.data.images.remove(im)
        self.parts[name] = parts
        mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
        for p in parts:
            for c in p.mesh.vertices:
                w = p.matrix @ c.co
                mn = Vector((min(mn[i], w[i]) for i in range(3)))
                mx = Vector((max(mx[i], w[i]) for i in range(3)))
        self.bounds[name] = (mn, mx)
        return parts

    def prepare_materials(self, pal):
        """Flatten the atlas (every swatch one flat colour), then build material id -> class -> ramp tables."""
        w, h = self.img.size
        px = np.empty(w * h * 4, np.float32)
        self.img.pixels.foreach_get(px)
        rgba = px.reshape(h, w, 4)[::-1].copy()
        out = rgba.copy()
        cols = []
        for cy in range(h // CELL_H):
            for cx in range(w // CELL_W):
                x0, y0 = cx * CELL_W, cy * CELL_H
                ys = int(y0 + GRADIENT_SAMPLE * CELL_H)
                main = rgba[ys - 6:ys + 6, x0 + 4:x0 + 100, :3].reshape(-1, 3).mean(0)
                stripe = rgba[ys - 6:ys + 6, x0 + 110:x0 + 126, :3].reshape(-1, 3).mean(0)
                out[y0:y0 + CELL_H, x0:x0 + CELL_W, :3] = main
                out[y0 + 16:y0 + CELL_H - 16, x0 + 104:x0 + CELL_W, :3] = stripe
                cols.append(np.rint(main * 255).astype(int))
                cols.append(np.rint(stripe * 255).astype(int))
        self.flat_img = bpy.data.images.new("dungeon_flat", w, h, alpha=True)
        self.flat_img.pixels.foreach_set(out[::-1].ravel())
        self.flat_img.update()
        uniq = np.unique(np.array(cols, np.int32), axis=0)
        self.mat_rgb = uniq
        self.mat_key = (uniq[:, 0] << 16) | (uniq[:, 1] << 8) | uniq[:, 2]
        classes, ramps, outl, base, weight = [], [], [], [], []
        lum = np.array([0.30, 0.59, 0.11])
        for c in uniq:
            cls = classify(c)
            classes.append(cls or "auto")
            L = float((c / 255.0) @ lum)
            if cls:
                ramps.append(RAMPS[cls])
                outl.append(OUTLINE_OF[cls])
                base.append(base_level(cls, L))
            else:
                r = auto_ramp(c, pal.lab)
                ramps.append(r)
                outl.append(r[0])
                base.append(3.0)
            weight.append(1.5 if L < 0.12 else 1.0)
        self.mat_class = classes
        self.mat_ramp = np.array(ramps, np.uint8)
        self.mat_outline = np.array(outl, np.uint8)
        self.mat_base = np.array(base, np.float32)
        self.mat_weight = np.array(weight, np.float32)
        log("atlas: %d unique swatch colours; classes %s" % (len(uniq), {k: classes.count(k) for k in set(classes)}))

    def swap(self, which):
        self.node.image = self.flat_img if which == "flat" else self.img


# ---------------------------------------------------------------------------
# Scene: placements, camera, passes
# ---------------------------------------------------------------------------

class Stage:
    def __init__(self, lib, pal):
        self.lib, self.pal = lib, pal
        self.scene = bpy.context.scene
        s = self.scene
        s.render.engine = "BLENDER_WORKBENCH"
        s.render.film_transparent = True
        s.render.image_settings.file_format = "PNG"
        s.render.image_settings.color_mode = "RGBA"
        s.render.image_settings.color_depth = "8"
        s.render.image_settings.compression = 0
        s.render.dither_intensity = 0.0
        s.render.resolution_percentage = 100
        s.display.render_aa = "OFF"
        s.view_settings.view_transform = "Standard"
        s.view_settings.look = "None"
        sh = s.display.shading
        sh.show_object_outline = False
        sh.show_cavity = False
        sh.show_shadows = False
        sh.show_specular_highlight = False
        data = bpy.data.cameras.new("EnvCam")
        data.type = "ORTHO"
        data.sensor_fit = "HORIZONTAL"
        data.clip_start = 0.01
        data.clip_end = 400.0
        self.cam = bpy.data.objects.new("EnvCam", data)
        s.collection.objects.link(self.cam)
        s.camera = self.cam
        self.objs = []
        self.render_count = 0
        self.world = np.array([1.0, 1.0, 1.0])       # world scale applied to everything (unused here, kept from the prototype)
        self.matcap = self._make_matcap()
        self.basis = None

    def _make_matcap(self):
        n = 256
        yy, xx = np.mgrid[0:n, 0:n]
        x = (xx + 0.5) / n * 2 - 1
        y = 1 - (yy + 0.5) / n * 2
        z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
        img = np.zeros((n, n, 4), np.float32)
        img[..., 0], img[..., 1], img[..., 2], img[..., 3] = x * 0.5 + 0.5, y * 0.5 + 0.5, z * 0.5 + 0.5, 1
        im = bpy.data.images.new("env_matcap", n, n, alpha=True)
        im.pixels.foreach_set(img[::-1].ravel())
        path = os.path.join(WORK, "matcap_nrm.png")
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
        bpy.data.images.remove(im)
        return bpy.context.preferences.studio_lights.load(path, "MATCAP").name

    # -- placement -----------------------------------------------------------
    def clear(self):
        for o in self.objs:
            bpy.data.objects.remove(o, do_unlink=True)
        self.objs = []

    def place(self, name, loc=(0, 0, 0), rotz=0.0, scale=(1, 1, 1), skip=()):
        sw = Matrix.Diagonal((*self.world, 1.0))
        m = sw @ Matrix.Translation(loc) @ Matrix.Rotation(math.radians(rotz), 4, "Z") @ Matrix.Diagonal((*scale, 1.0))
        for p in self.lib.load(name):
            if p.name in skip:
                continue
            o = bpy.data.objects.new(p.name, p.mesh)
            self.scene.collection.objects.link(o)
            o.matrix_world = m @ p.matrix
            self.objs.append(o)

    def place_all(self, placements):
        for pl in placements:
            self.place(**pl)

    # -- camera --------------------------------------------------------------
    def aim(self, pitch, anchor, anchor_px, w, h, ppu, yaw=0.0):
        """Orthographic camera looking down `pitch` degrees below the horizon, turned `yaw` about z (0 looks toward +y,
        screen right is +x, screen up at pitch 90 is +y). The world point `anchor` lands on pixel (ax, ay) of a w x h image
        at `ppu` pixels per world unit."""
        p, yv = math.radians(pitch), math.radians(yaw)
        rz = Matrix.Rotation(yv, 3, "Z")
        r = rz @ Vector((1, 0, 0))
        u = rz @ Vector((0, math.sin(p), math.cos(p)))
        f = rz @ Vector((0, math.cos(p), -math.sin(p)))
        a = Vector(anchor) * 1.0
        a = Vector((a.x * self.world[0], a.y * self.world[1], a.z * self.world[2]))
        ax, ay = anchor_px
        dx, dy = (ax - w / 2.0) / ppu, (h / 2.0 - ay) / ppu
        centre = a - r * dx - u * dy
        self.cam.rotation_euler = (math.radians(90.0 - pitch), 0.0, yv)
        self.cam.location = centre - f * 60.0
        self.cam.data.ortho_scale = w / ppu
        self.basis = (np.array(r, np.float32), np.array(u, np.float32), np.array(f, np.float32))

    # -- passes --------------------------------------------------------------
    def _render(self, w, h):
        s = self.scene
        s.camera = self.cam
        s.render.resolution_x, s.render.resolution_y = w, h
        s.render.filepath = TMP_PNG
        bpy.ops.render.render(write_still=True)
        self.render_count += 1
        RENDERS[0] += 1
        img = bpy.data.images.load(TMP_PNG, check_existing=False)
        try:
            px = np.empty(w * h * 4, np.float32)
            img.pixels.foreach_get(px)
        finally:
            bpy.data.images.remove(img)
        return px.reshape(h, w, 4)[::-1].copy()

    def passes(self, w, h, ss=SS):
        sh = self.scene.display.shading
        sh.light, sh.color_type = "FLAT", "TEXTURE"
        self.lib.swap("flat")
        alb = self._render(w * ss, h * ss)
        self.lib.swap("orig")
        org = self._render(w * ss, h * ss)
        sh.light, sh.studio_light, sh.color_type, sh.single_color = "MATCAP", self.matcap, "SINGLE", (1.0, 1.0, 1.0)
        nrm = self._render(w * ss, h * ss)
        return alb, org, nrm

    # -- conversion ----------------------------------------------------------
    def quantise(self, ps, h, w, refs, prop=False, ss=SS, bias=0.0, void=6, light=None, lam_ref=None, ramp_override=None, level_k=None,
                 lines=True):
        """(alb, org, nrm) at ss x -> uint8 (h, w) palette indices, 255 transparent (props) or `void` (tiles).
        `bias` shifts the whole shot up or down the ramp: a pixel artist lights planes by value (tops lightest, fronts
        mid), and a flat face looks the same n.L from every camera, so the plane's value is applied here."""
        alb, org, nrm = ps
        lib = self.lib
        opaque = alb[..., 3] > 0.5
        n = nrm[..., :3] * 2.0 - 1.0
        n /= (np.sqrt((n ** 2).sum(-1)) + 1e-6)[..., None]
        r, u, f = self.basis
        nw = n[..., 0:1] * r + n[..., 1:2] * u + n[..., 2:3] * (-f)
        flat = np.zeros(opaque.shape, bool)
        for ref in refs:
            flat |= (nw @ np.asarray(ref, np.float32)) > FLAT_COS
        lum = np.array([0.30, 0.59, 0.11], np.float32)
        lam = n @ (LIGHT if light is None else light) + GRADIENT_K * ((org[..., :3] - alb[..., :3]) @ lum)
        rgb8 = np.rint(alb[..., :3] * 255).astype(np.int32)
        key = np.where(opaque, (rgb8[..., 0] << 16) | (rgb8[..., 1] << 8) | rgb8[..., 2], -1)
        uk, inv = np.unique(key.ravel(), return_inverse=True)
        lut = np.full(len(uk), -1, np.int32)
        for i, k in enumerate(uk):
            if k >= 0:
                hit = np.nonzero(lib.mat_key == k)[0]
                lut[i] = hit[0] if len(hit) else int(((lib.mat_rgb - np.array([(k >> 16) & 255, (k >> 8) & 255, k & 255])) ** 2).sum(1).argmin())
        mat = lut[inv].reshape(opaque.shape)

        cover = block_sum(opaque.astype(np.float32), h, w, ss) / float(ss * ss)
        present = [int(m) for m in np.unique(mat) if m >= 0]
        if not present:
            return np.full((h, w), TRANSPARENT if prop else void, np.uint8)
        cnt = np.zeros((len(present), h, w), np.float32)
        fcnt, lf, ls = cnt.copy(), cnt.copy(), cnt.copy()
        for j, m in enumerate(present):
            msk = mat == m
            fm = msk & flat
            cnt[j] = block_sum(msk.astype(np.float32), h, w, ss)
            fcnt[j] = block_sum(fm.astype(np.float32), h, w, ss)
            lf[j] = block_sum(np.where(fm, lam, 0.0).astype(np.float32), h, w, ss)
            ls[j] = block_sum(np.where(msk & ~flat, lam, 0.0).astype(np.float32), h, w, ss)
        wts = lib.mat_weight[present][:, None, None]
        win = (cnt * wts).argmax(0)
        pick = lambda a: np.take_along_axis(a, win[None], 0)[0]
        c, fc, lfw, lsw = pick(cnt), pick(fcnt), pick(lf), pick(ls)
        sc = c - fc
        sf = sc / np.maximum(c, 1.0)
        # line pixels: the sloped share of a block, thinned to a one pixel ridge (a hairline bevel never fills a pixel)
        up, dn, lf_, rt = shift(sf, -1, 0, 0.0), shift(sf, 1, 0, 0.0), shift(sf, 0, -1, 0.0), shift(sf, 0, 1, 0.0)
        ridge = ((sf > lf_) & (sf >= rt)) | ((sf > up) & (sf >= dn))
        edge = (c > 0) & ((sf >= EDGE_SOLID) | ((sf >= EDGE_MIN) & ridge)) & lines
        lam_b = np.where(edge, lsw / np.maximum(sc, 1.0), lfw / np.maximum(fc, 1.0))
        ref = LAM_FLAT if lam_ref is None else lam_ref
        lam_b = np.where(c > 0, lam_b, ref)
        mat_id = np.asarray(present, np.int32)[win]
        base = lib.mat_base[mat_id]
        level = np.clip(np.rint(base + bias + (LEVEL_K if level_k is None else level_k) * (lam_b - ref)), 0, 5).astype(np.int32)
        solid = cover >= COVER_T
        mat_id = np.where(solid, mat_id, -1)

        if prop:
            solid, mat_id, level = self._cleanup_prop(solid, mat_id, level, present)
        else:
            level = self._cleanup_tile(level, edge, mat_id)
        ramp_tab, outline_tab = lib.mat_ramp, lib.mat_outline
        if ramp_override:
            ramp_tab, outline_tab = ramp_tab.copy(), outline_tab.copy()
            for m, cls in enumerate(lib.mat_class):
                if cls in ramp_override:
                    ramp_tab[m] = RAMPS[ramp_override[cls]]
                    outline_tab[m] = OUTLINE_OF[ramp_override[cls]]
        out = np.full((h, w), TRANSPARENT if prop else void, np.uint8)
        out[solid] = ramp_tab[mat_id[solid], level[solid]]
        if prop:
            nb = np.zeros_like(solid)
            src = np.full(solid.shape, -1, np.int32)
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ss_ = shift(solid, dy, dx, False)
                sm = shift(mat_id, dy, dx, -1)
                take = ss_ & ~solid & ~nb
                src[take] = sm[take]
                nb |= ss_ & ~solid
            out[nb] = outline_tab[src[nb]]
        self.last_edge = edge
        return out

    @staticmethod
    def _cleanup_tile(level, edge, mat_id):
        """A flat pixel whose four neighbours all agree on another step takes it (speckle), lines are left alone."""
        four = ((-1, 0), (1, 0), (0, -1), (0, 1))
        nb = [shift(level, dy, dx, -1) for dy, dx in four]
        for target in range(6):
            votes = sum((x == target).astype(np.int32) for x in nb)
            flip = (~edge) & (votes >= 3) & (level != target)
            level = np.where(flip, target, level)
        return level

    @staticmethod
    def _cleanup_prop(solid, mat_id, level, present):
        four = ((-1, 0), (1, 0), (0, -1), (0, 1))
        around = sum(shift(solid, dy, dx, False).astype(np.int32) for dy, dx in four)
        hole = ~solid & (around == 4)
        if hole.any():
            best = np.full(mat_id.shape, -1, np.int32)
            best_n = np.zeros(mat_id.shape, np.int32)
            nbrs = [shift(mat_id, dy, dx, -1) for dy, dx in four]
            for m in present:
                cn = sum((x == m).astype(np.int32) for x in nbrs)
                better = cn > best_n
                best = np.where(better, m, best)
                best_n = np.where(better, cn, best_n)
            mat_id = np.where(hole, best, mat_id)
            level = np.where(hole, 3, level)
            solid = solid | hole
        nbr = np.zeros(solid.shape, np.int32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    nbr += shift(solid, dy, dx, False)
        solid = solid & (nbr > 0)
        mat_id = np.where(solid, mat_id, -1)
        return solid, mat_id, level

# ---------------------------------------------------------------------------
# Shots: what to render for each kind of tile
# ---------------------------------------------------------------------------
FACE_BIAS = -0.5    # wall faces sit a half step darker than the floor, and caps a step lighter (see CAP_BIAS)
CAP_BIAS = 0.9
UP = (0.0, 0.0, 1.0)
FRONT = (0.0, -1.0, 0.0)
AXES = [UP, FRONT, (1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]

class Kit:
    """Everything that depends on the tile size: ppu = pixels per world unit, T = tile pixels."""

    def __init__(self, stage, ppu):
        self.st, self.ppu = stage, ppu
        self.T = int(round(UNITS_PER_TILE * ppu))

    def top_down(self, placements, cx, cy, tiles_w, tiles_h, refs=(UP,), bias=0.0, **qkw):
        """Straight-down shot of tiles_w x tiles_h tiles centred on world (cx, cy)."""
        st, T = self.st, self.T
        st.clear()
        st.place_all(placements)
        w, h = tiles_w * T, tiles_h * T
        st.aim(90.0, (cx, cy, 0.0), (w / 2.0, h / 2.0), w, h, self.ppu)
        return st.quantise(st.passes(w, h), h, w, refs, bias=bias, **qkw)

    def face(self, placements, cx, cz, tiles_w, tiles_h, refs=(FRONT,), bias=FACE_BIAS):
        """Front-on shot (pitch 0, looking toward +y) of a wall face, centred on x=cx and height z=cz."""
        st, T = self.st, self.T
        st.clear()
        st.place_all(placements)
        w, h = tiles_w * T, tiles_h * T
        st.aim(0.0, (cx, 0.0, cz), (w / 2.0, h / 2.0), w, h, self.ppu)
        return st.quantise(st.passes(w, h), h, w, refs, bias=bias)

    def prop(self, name, scale=1.0, yaw=0.0, extra=(), margin=2, refs=AXES, placements=None):
        """A standing object from the character camera (pitch 30), bottom-anchored on its footprint's front edge like a token."""
        st, T, ppu = self.st, self.T, self.ppu
        st.clear()
        if placements is None:
            placements = [dict(name=name, scale=(scale,) * 3, rotz=yaw)] + list(extra)
        st.place_all(placements)
        mn, mx = st.lib.bounds[name]
        wu, du, hu = (mx.x - mn.x) * scale, (mx.y - mn.y) * scale, (mx.z - mn.z) * scale
        if abs(yaw) > 1:
            wu, du = du, wu
        cx = (mn.x + mx.x) / 2 * scale if abs(yaw) < 1 else 0.0
        c30, s30 = math.cos(math.radians(30)), math.sin(math.radians(30))
        w = max(1, int(round(wu / UNITS_PER_TILE))) * T
        h = int(math.ceil((hu * c30 + du * s30) * ppu)) + margin + 2
        ymin = mn.y * scale if abs(yaw) < 1 else -du / 2
        st.aim(30.0, (cx, ymin, 0.0), (w / 2.0, h - 1.0), w, h, ppu)
        return st.quantise(st.passes(w, h), h, w, refs, prop=True)


# ---------------------------------------------------------------------------
# What is rendered: the layout sources. One npz per tile size, read back by the painting step.
# ---------------------------------------------------------------------------
WALL_THICK = 2.0    # the pack's walls are 1 unit thick; the game's are a full tile, so the cap is stretched to 2


def wall_run(names, y=0.0, rotz=0.0, kz=1.0, thick=WALL_THICK):
    out = []
    for i, n in enumerate(names):
        x = (i - (len(names) - 1) / 2.0) * 4.0
        out.append(dict(name=n, loc=(x, y, 0.0), rotz=rotz, scale=(1.0, thick, kz)))
    return out


def raw_path(T):
    return os.path.join(WORK, f"raw_{T}.npz")


def top_view(stage, kit, piece, tiles, ramp_override=None, prop=False, scale=1.0, ss=None):
    """One piece from straight above, `tiles` x `tiles` tiles centred on the origin."""
    st, T = stage, kit.T
    st.clear()
    st.place(piece, scale=(scale, scale, scale))
    w = h = tiles * T
    st.aim(90.0, (0, 0, 0), (w / 2.0, h / 2.0), w, h, kit.ppu)
    kw = {} if ss is None else {"ss": ss}
    return st.quantise(st.passes(w, h, **kw), h, w, (UP,), prop=prop, ramp_override=ramp_override, **kw)


def render_sources(T):
    """Render the layout sources the painting reads, for tile size T (pixels), with Blender; returns {name: uint8 array}.
    stone_large (2 x 2 tiles of the paving, used to check the lattice), stone_small and stone_broken_a (the crack of the broken tile),
    dirt_a..d (the pebbles and cracks of the four small dirt pieces, earth ramp) and crown_b, crown_b_small (tree crowns from straight above)."""
    t0 = time.time()
    pal = RenderPal()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(WORK, exist_ok=True)
    out = {}
    ppu = T / UNITS_PER_TILE
    # -- Dungeon: floors from above
    lib = Library(dungeon_path)
    lib.load("floor_tile_large")
    lib.prepare_materials(pal)
    st = Stage(lib, pal)
    kit = Kit(st, ppu)
    out["stone_large"] = kit.top_down([dict(name="floor_tile_large")], 0, 0, 2, 2)
    for key, piece in (("stone_small", "floor_tile_small"), ("stone_broken_a", "floor_tile_small_broken_A")):
        out[key] = kit.top_down([dict(name=piece)], 0, 0, 1, 1)
    earth = {"stone": "earth"}
    for k in "ABCD":
        out["dirt_" + k.lower()] = kit.top_down([dict(name=f"floor_dirt_small_{k}")], 0, 0, 1, 1, ramp_override=earth)
    st.clear()
    log(f"T={T}: dungeon sources {time.time() - t0:.1f}s")
    # -- Medieval Hexagon: tree crowns from straight above
    lib2 = Library(hex_finder())
    lib2.load("hex_grass")
    lib2.prepare_materials(pal)
    st2 = Stage(lib2, pal)
    kit2 = Kit(st2, ppu)
    for key, piece, sc in (("crown_b", "tree_single_B", 2.2), ("crown_b_small", "tree_single_B", 1.4)):
        out[key] = top_view(st2, kit2, piece, 1, prop=True, scale=sc)
    st2.clear()
    log(f"T={T}: sources done {time.time() - t0:.1f}s, {RENDERS[0]} renders")
    return out


def load_sources(T):
    path = raw_path(T)
    if not os.path.exists(path):
        return None
    with np.load(path) as z:
        return {k: z[k] for k in z.files}



# ---------------------------------------------------------------------------
# Forest canopy: tree crowns seen from above (the Hexagon pack's tree_single_B / _A, rendered straight down) stamped on a periodic lattice
# ---------------------------------------------------------------------------

def crop_stamp(a):
    ys, xs = np.nonzero(a != TRANSPARENT)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def blit_wrap(dst, stampa, cx, cy):
    """Paint a stamp (255 transparent) centred on (cx, cy), wrapping around the tile (every texture is periodic)."""
    h, w = stampa.shape
    T = dst.shape[0]
    y0, x0 = int(round(cy - h / 2.0)), int(round(cx - w / 2.0))
    for dy in range(h):
        for dx in range(w):
            v = stampa[dy, dx]
            if v != TRANSPARENT:
                dst[(y0 + dy) % T, (x0 + dx) % T] = v


def leafy(stampa, r, T, seed, amp):
    """Break a smooth crown into leaf clusters: each crown pixel moves a step up or down the green ramp by clustered noise (the crown's
    own shading stays the trend), the silhouette outline stays as rendered."""
    ramp = [16, 17, 18, 19, 38]
    out = stampa.copy()
    h, w = stampa.shape
    nz = pv_noise(max(h, 8), max(w, 8), 3, 3, ("leaf", T, seed))[:h, :w]
    step = np.where(nz < 0.30, -1, np.where(nz > 0.72, 1, 0))
    step = despeckle(despeckle(step.astype(np.int32)))
    for y in range(h):
        for x in range(w):
            v = stampa[y, x]
            if v in ramp and step[y, x]:
                i = ramp.index(v) + step[y, x] * amp
                out[y, x] = ramp[max(0, min(len(ramp) - 1, i))]
    return out


def lift_shadow(stampa):
    """The renderer paints a crown's shaded side in the outline colour (ramp step 0). Inside the silhouette that becomes deep green, so
    only the outermost ring of a crown stays dark."""
    out = stampa.copy()
    solid = stampa != TRANSPARENT
    edge = np.zeros_like(solid)
    p = np.pad(solid, 1, constant_values=False)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        edge |= ~p[1 + dy:1 + dy + solid.shape[0], 1 + dx:1 + dx + solid.shape[1]]
    out[solid & ~edge & (stampa == 9)] = 16
    return out


def paint_canopy(T, src):
    """Four forest canopy tiles. The lattice: one big crown in the middle of each tile and a small crown on every corner (a quarter in each
    of four tiles), dark canopy between. The ring (the gutters and the corner crowns) is shared by every variant; the big crown inside is
    each variant's own."""
    bg_deep, bg_dark = 9, 16
    nz = pv_noise(T, T, 3, 3, ("canopy-bg", T))
    bg = np.where(nz > 0.62, bg_dark, bg_deep).astype(np.uint8)
    bg = despeckle(despeckle(bg))
    tmpl = bg.copy()
    small = lift_shadow(crop_stamp(src["crown_b_small"]))
    sm = leafy(small, None, T, "small", 1)
    blit_wrap(tmpl, sm, 0, 0)
    variants = {}
    kinds = {"a": ("crown_b", 0, 0), "b": ("crown_b", -1, 1), "c": ("small2", 0, 0), "d": ("crown_b", 1, -1)}
    for name, (key, jx, jy) in kinds.items():
        t = tmpl.copy()
        r = rng("canopy", T, name)
        if key == "small2":
            st1 = leafy(lift_shadow(crop_stamp(src["crown_b_small"])), r, T, name + "1", 1)
            st2 = leafy(lift_shadow(crop_stamp(src["crown_b_small"])), r, T, name + "2", 1)
            blit_wrap(t, st1, T * 0.32, T * 0.36)
            blit_wrap(t, st2, T * 0.68, T * 0.66)
        else:
            stampa = leafy(lift_shadow(crop_stamp(src[key])), r, T, name, 1)
            blit_wrap(t, stampa, T / 2.0 + jx - 0.5, T / 2.0 + jy - 0.5)
        variants[name] = with_ring(t, tmpl)
    return variants, tmpl


# ---------------------------------------------------------------------------
# Cliff top: weathered rock plates (a jittered, tile-periodic Voronoi), each lit up left and shaded down right, hairline seams between
# ---------------------------------------------------------------------------

def voronoi_ids(T, nx, seed, ny=None, ax=1.0, ay=1.3):
    """Plate ids of a tile-periodic Voronoi with nx x ny jittered seeds; ax, ay weigh the distance (ay > ax: plates wider than tall)."""
    ny = ny or nx
    r = rng("vor", T, nx, ny, seed)
    pts = []
    for gy in range(ny):
        for gx in range(nx):
            pts.append(((gx + 0.15 + 0.7 * r.rand()) * T / nx, (gy + 0.15 + 0.7 * r.rand()) * T / ny))
    best = np.full((T, T), 1e18)
    ids = np.zeros((T, T), np.int32)
    for i, (cx, cy) in enumerate(pts):
        dx, dy = wrap_delta(T, cx, cy)
        d = dx * dx * ax + dy * dy * ay
        upd = d < best
        best = np.where(upd, d, best)
        ids = np.where(upd, i, ids)
    return ids, pts


def seam_and_bevel(ids, from_above_only=False):
    """Seams (1 px, on the lower right side of a plate boundary), lit pixels beside a seam up left and shaded ones down right (wrapping).
    from_above_only: only the pixel straight under a seam is lit and only the one straight over it is shaded (a vertical face)."""
    up, lf = np.roll(ids, 1, 0), np.roll(ids, 1, 1)
    seam = (ids != up) | (ids != lf)
    s_up, s_lf = np.roll(seam, 1, 0), np.roll(seam, 1, 1)
    s_dn, s_rt = np.roll(seam, -1, 0), np.roll(seam, -1, 1)
    if from_above_only:
        lit = ~seam & s_up
        shade = ~seam & ~lit & s_dn
    else:
        lit = ~seam & (s_up | s_lf)
        shade = ~seam & ~lit & (s_dn | s_rt)
    return seam, lit, shade


def paint_cliff_top(T):
    """A rocky plateau: a few big rock plates, lit up left, shaded down right, dark and hairline seams, pits, the odd crack and moss."""
    big = T >= 32
    ids, pts = voronoi_ids(T, 3 if not big else 4, "cliff-top", ay=1.15)
    r0 = rng("cliff-top-plates", T)
    plate_tone = r0.rand(len(pts))
    # seams between plates: some hard and dark, some soft, some absent (the two plates are one rock), decided per pair of plates
    up, lf = np.roll(ids, 1, 0), np.roll(ids, 1, 1)
    other = np.where(ids != up, up, lf)
    pair = np.minimum(ids, other) * 64 + np.maximum(ids, other)
    pair_u = np.array([rng("cliff-top-pair", T, int(k)).rand() for k in range(64 * 64)])[pair]
    raw_seam = (ids != up) | (ids != lf)
    seam = raw_seam & (pair_u < 0.85)
    hard = seam & (pair_u < 0.55)
    s_up, s_lf = np.roll(seam, 1, 0), np.roll(seam, 1, 1)
    s_dn, s_rt = np.roll(seam, -1, 0), np.roll(seam, -1, 1)
    lit = ~seam & (s_up | s_lf)
    shade = ~seam & ~lit & (s_dn | s_rt)
    tmpl = np.where(plate_tone[ids] < 0.35, 26, 27).astype(np.int32)
    tmpl = np.where(lit, 27, tmpl)
    tmpl = np.where(shade, 25 if big else 26, tmpl)
    tmpl = np.where(seam, np.where(hard, 24, 25), tmpl)
    ed = edge_dist(T)
    variants = {}
    specs = {"a": dict(mot=0.0, sp=1, crack=0.0, moss=0), "b": dict(mot=0.2, sp=2, crack=0.0, moss=0),
             "c": dict(mot=0.1, sp=1, crack=0.5, moss=0), "d": dict(mot=0.08, sp=3, crack=0.0, moss=0)}
    interior = (ed >= 2) & ~seam & ~lit & ~shade
    for name, sp in specs.items():
        t = tmpl.copy()
        r = rng("cliff-top", T, name)
        cell = max(3, T // 6)
        nz = pv_noise(T, T, cell, cell, ("cliff-top-tone", T, name))
        lev = despeckle(despeckle(np.where(nz < 0.25, -1, np.where(nz > 0.78, 1, 0)).astype(np.int32)))
        t = np.where(interior & (t == 27) & (lev < 0), 26, t)
        t = np.where(interior & (t == 26) & (lev > 0), 27, t)
        if sp["mot"]:
            nz2 = pv_noise(T, T, cell, cell, ("cliff-top-mot", T, name))
            t = np.where(interior & (nz2 < sp["mot"]), np.maximum(t - 1, 24), t)
        shapes = [["xx"], ["xxx"], ["x", "x"], ["xx", ".x"]]
        for _ in range(sp["sp"] * (1 + big)):
            for _try in range(40):
                shape = shapes[int(r.randint(0, 4))]
                x, y = int(r.randint(2, T - 3)), int(r.randint(2, T - 3))
                cells = [(x + dx, y + dy) for dy, row in enumerate(shape) for dx, ch in enumerate(row) if ch == "x"]
                if all(0 <= cx < T and 0 <= cy < T and interior[cy, cx] for cx, cy in cells):
                    val = 25 if r.rand() < 0.6 else 27
                    for cx, cy in cells:
                        t[cy, cx] = val
                    break
        if sp["crack"]:
            pts_c = crack_path(r, int(T * sp["crack"]))
            for _try in range(60):
                lu, lv = int(r.randint(3, T - 3)), int(r.randint(3, T - 3))
                pix = [(lu + cx, lv + cy) for cx, cy in pts_c]
                if all(2 <= x < T - 2 and 2 <= y < T - 2 and interior[y, x] for x, y in pix):
                    for x, y in pix:
                        t[y, x] = 24
                    break
        if sp["moss"]:
            for _try in range(60):
                x, y = int(r.randint(3, T - 6)), int(r.randint(3, T - 6))
                shape = ["mmm", "mMm", ".m."] if big else ["mm", ".m"]
                cells = [(x + dx, y + dy) for dy, row in enumerate(shape) for dx, ch in enumerate(row) if ch != "."]
                if all(interior[cy, cx] for cx, cy in cells):
                    stamp(t, x, y, shape, {"m": 39, "M": 18})
                    break
        variants[name] = with_ring(t.astype(np.uint8), tmpl)
    return variants, tmpl.astype(np.uint8)


# ---------------------------------------------------------------------------
# Cliff face: a vertical rock face of jagged columns (lit on the left, shaded on the right, dark cracks between) with ledges and chips
# ---------------------------------------------------------------------------

def paint_cliff_face(T):
    big = T >= 32
    ncol = 2 if not big else 4
    amp = 1.0 if not big else 2.4
    r0 = rng("cliff-face-cols", T)
    xs = np.arange(T)
    tmpl = np.full((T, T), 25, np.int32)
    crack = np.zeros((T, T), bool)
    lit = np.zeros((T, T), bool)
    shade = np.zeros((T, T), bool)
    for i in range(ncol):
        x0 = int(round(i * T / ncol + (r0.rand() - 0.5) * T / ncol * 0.35))
        wob = pv_noise(T, 1, max(4, T // 4), 1, ("cliff-wob", T, i))[:, 0]
        wob = np.rint((wob - 0.5) * 2 * amp).astype(int)
        for y in range(T):
            x = (x0 + wob[y]) % T
            crack[y, x] = True
            lit[y, (x + 1) % T] = True
            shade[y, (x - 1) % T] = True
            if big:
                lit[y, (x + 2) % T] = lit[y, (x + 2) % T] or (y % 3 != 0)
    shade &= ~crack
    lit &= ~crack & ~shade
    # ledges: a dark step across part of a column with a lit lip under it
    ledge_dark = np.zeros((T, T), bool)
    ledge_lit = np.zeros((T, T), bool)
    for k in range(2 + 2 * big):
        y = int(r0.randint(3, T - 3))
        x = int(r0.randint(0, T))
        n = int(r0.randint(T // 4, T // 2))
        for d in range(n):
            ledge_dark[y, (x + d) % T] = True
            ledge_lit[(y + 1) % T, (x + d) % T] = True
    body_hi = despeckle(despeckle(np.where(pv_noise(T, T, 5, 4, ("cliff-face-body", T)) > 0.80, 1, 0).astype(np.int32)))
    tmpl = np.where(body_hi > 0, 26, tmpl)
    tmpl = np.where(lit, 26, tmpl)
    tmpl = np.where(shade, 24, tmpl)
    tmpl = np.where(ledge_lit & ~crack, 26, tmpl)
    tmpl = np.where(ledge_dark | crack, 24, tmpl)
    ed = edge_dist(T)
    structure = crack | lit | shade | ledge_dark | ledge_lit
    interior = (ed >= 2) & ~structure
    variants = {}
    specs = {"a": dict(chips=2, mot=0.22, ledges=1), "b": dict(chips=3, mot=0.30, ledges=2), "c": dict(chips=2, mot=0.15, ledges=1),
             "d": dict(chips=3, mot=0.26, ledges=2)}
    for name, sp in specs.items():
        t = tmpl.copy()
        r = rng("cliff-face", T, name)
        cell = 3 if not big else 4
        nz = pv_noise(T, T, cell + 1, cell, ("cliff-face-mot", T, name))
        mot = despeckle(despeckle(np.where(nz < sp["mot"], -1, np.where(nz > 0.86, 1, 0)).astype(np.int32)))
        t = np.where(interior & (t == 25), t + mot, t)
        for _ in range(sp["ledges"]):
            for _try in range(40):
                y = int(r.randint(3, T - 4))
                x = int(r.randint(3, T - 8))
                n = int(r.randint(3, max(4, T // 3)))
                if all(interior[y, x + d] and interior[y + 1, x + d] for d in range(n) if x + d < T - 2):
                    for d in range(n):
                        if x + d < T - 2:
                            t[y, x + d] = 24
                            t[y + 1, x + d] = 26
                    break
        for _ in range(sp["chips"] * (1 + big)):
            for _try in range(30):
                shape = [["xx"], ["xxx"], ["xx", ".x"], ["x", "x"]][int(r.randint(0, 4))]
                x, y = int(r.randint(2, T - 4)), int(r.randint(2, T - 3))
                cells = [(x + dx, y + dy) for dy, row in enumerate(shape) for dx, ch in enumerate(row) if ch == "x"]
                if all(0 <= cx < T and 0 <= cy < T and interior[cy, cx] for cx, cy in cells):
                    u = r.rand()
                    val = 27 if u < 0.3 else (26 if u < 0.75 else 24)
                    for cx, cy in cells:
                        t[cy, cx] = val
                    break
        for _try in range(60):                                  # one lit chip at least, so every face carries all four rock tones
            x, y = int(r.randint(2, T - 4)), int(r.randint(2, T - 3))
            cells = [(x, y), (x + 1, y)]
            if all(0 <= cx < T and 0 <= cy < T and interior[cy, cx] for cx, cy in cells):
                for cx, cy in cells:
                    t[cy, cx] = 27
                break
        variants[name] = with_ring(t.astype(np.uint8), tmpl)
    return variants, tmpl.astype(np.uint8)


# ---------------------------------------------------------------------------
# Walls: the game's ONE row convention. wall_stone is a face (two courses of ashlar), wall_stone_top the lit coping along a room's north
# edge, wall_stone_base a face whose last rows fall into shadow. The course band and the block joints are read off the Dungeon wall
# module's render (a dark top course, blocks a module wide, joints every 4 units); the surface is painted.
# ---------------------------------------------------------------------------
BOND = {      # joints per course at 16 px (scaled at 32): course 0 always has one on the tile ring (column 0), so any face meets any face
    "a": ([0, 8], [4, 12]),
    "b": ([0, 6], [3, 11]),
    "c": ([0, 10], [5, 13]),
}


def bricks_of(joints, T):
    """(first column, length) of every brick between consecutive joints (wrapping); the brick after the last joint runs to the first + T."""
    out = []
    js = sorted(joints)
    for i, j in enumerate(js):
        nxt = js[i + 1] if i + 1 < len(js) else js[0] + T
        out.append((j, nxt - j))
    return out


def face_tile(T, variant, name):
    """One face tile: two courses, each a row of bricks lit on their top and left edge, shaded on the bottom and right, mortar between."""
    k = T // 16
    H = T // 2
    big = T >= 32
    out = np.full((T, T), STONE["base"], np.int32)
    r = rng("wall-face", T, name)
    bond = BOND[variant]
    for c in range(2):
        y0 = c * H
        joints = [(j * k) % T for j in bond[c]]
        for (j0, ln) in bricks_of(joints, T):
            xs = [(j0 + d) % T for d in range(ln)]
            spans_ring = 0 in xs[1:] or (T - 1) in xs or 0 in xs
            dark_brick = (not spans_ring) and r.rand() < 0.30
            body = STONE["dark"] if dark_brick else STONE["base"]
            top = STONE["base"] if dark_brick else STONE["lit"]
            bot = STONE["mortar"] if dark_brick else STONE["dark"]
            lit_c = STONE["base"] if dark_brick else STONE["lit"]
            shd_c = STONE["mortar"] if dark_brick else STONE["dark"]
            for d, x in enumerate(xs):
                for y in range(y0, y0 + H):
                    out[y, x] = body
                out[y0, x] = top
                # shaded bottom rows (two at 32 px, one at 16) and the mortar row under them
                for q in range(1, (2 if big else 1) + 1):
                    out[y0 + H - 1 - q, x] = bot
                out[y0 + H - 1, x] = STONE["mortar"]
                if d == 0:
                    for y in range(y0, y0 + H):
                        out[y, x] = STONE["mortar"]
                elif d == 1:
                    for y in range(y0 + 1, y0 + H - 1 - (2 if big else 1)):
                        out[y, x] = lit_c
                    if big and ln > 4:
                        pass
                elif d == ln - 1 and ln > 3:
                    for y in range(y0 + 1, y0 + H - 1 - (2 if big else 1)):
                        out[y, x] = shd_c
                elif big and d == ln - 2 and ln > 6:
                    for y in range(y0 + 1, y0 + H - 1 - 2):
                        out[y, x] = shd_c
            # the top left of the brick: the mortar joint's lit corner
    return out


def wall_structure_mask(T, variant):
    """Pixels that belong to the bond (joints, lit and shaded edges, mortar rows): decoration stays off them."""
    k = T // 16
    H = T // 2
    big = T >= 32
    m = np.zeros((T, T), bool)
    bond = BOND[variant]
    for c in range(2):
        y0 = c * H
        m[y0:y0 + 2, :] = True
        m[y0 + H - (4 if big else 2):y0 + H, :] = True
        for j in bond[c]:
            for d in (-2, -1, 0, 1, 2):
                m[y0:y0 + H, (j * k + d) % T] = True
    return m


def decorate_face(out, T, variant, name, extra_dark=0.0):
    H = T // 2
    big = T >= 32
    r = rng("wall-deco", T, name)
    ed = edge_dist(T)
    interior = ~wall_structure_mask(T, variant) & (ed >= 2) & (out == STONE["base"])
    cell = max(3, T // 8)
    nz = pv_noise(T, T, cell, cell + 1, ("wall-tone", T, name))
    lev = despeckle(despeckle(np.where(nz < 0.16 + extra_dark, -1, np.where(nz > 0.86, 1, 0)).astype(np.int32)))
    out = np.where(interior & (out == STONE["base"]), out + lev, out)
    interior = interior & (out == STONE["base"])
    for _ in range(2 + 2 * big):
        for _try in range(40):
            shape = clump_shapes()[int(r.randint(0, 6))]
            x, y = int(r.randint(2, T - 4)), int(r.randint(2, T - 3))
            cells = [(x + dx, y + dy) for dy, row in enumerate(shape) for dx, ch in enumerate(row) if ch == "x"]
            if all(0 <= cx < T and 0 <= cy < T and interior[cy, cx] for cx, cy in cells):
                val = STONE["dark"] if r.rand() < 0.55 else STONE["lit"]
                for cx, cy in cells:
                    out[cy, cx] = val
                break
    return out


def paint_walls(T, src=None):
    """wall_stone, _b, _c, wall_stone_top and wall_stone_base. Returns {name: tile}."""
    H = T // 2
    big = T >= 32
    tiles = {}
    faces = {}
    for k, nm in (("a", "wall_stone"), ("b", "wall_stone_b"), ("c", "wall_stone_c")):
        f = face_tile(T, k, k)
        f = decorate_face(f, T, k, k, {"a": 0.0, "b": 0.05, "c": 0.0}[k])
        faces[k] = f
    ref = faces["a"]
    m = ring_mask(T)
    for k, nm in (("a", "wall_stone"), ("b", "wall_stone_b"), ("c", "wall_stone_c")):
        f = faces[k].copy()
        f[m] = ref[m]
        faces[k] = f
    r = rng("wall-cracks", T)
    # a crack through one brick of b, moss on c, so the three are not the same wall
    pts = crack_path(r, int(T * 0.35))
    for _try in range(60):
        lu, lv = int(r.randint(4, T - 4)), int(r.randint(2, H - 4))
        pix = [(lu + cx, lv + cy) for cx, cy in pts]
        if all(3 <= x < T - 3 and 3 <= y < H - 4 and faces["b"][y, x] in (STONE["base"], STONE["dark"]) for x, y in pix):
            for x, y in pix:
                faces["b"][y, x] = STONE["mortar"]
            break
    shape = ["mmm", "mMm", ".m."] if big else ["mm", ".m"]
    for _try in range(60):
        x, y = int(r.randint(4, T - 7)), int(r.randint(2, H - 5)) + H
        cells = [(x + dx, y + dy) for dy, row in enumerate(shape) for dx, ch in enumerate(row) if ch != "."]
        if all(faces["c"][cy, cx] == STONE["base"] and 3 <= cx < T - 3 and cy < T - 5 for cx, cy in cells):
            stamp(faces["c"], x, y, shape, {"m": 39, "M": 18})
            break
    tiles["wall_stone"], tiles["wall_stone_b"], tiles["wall_stone_c"] = (faces[k].astype(np.uint8) for k in "abc")
    # base: the plain face with a cast shadow growing toward the floor: outline pixels (index 0) in strictly rising numbers row by row. Each row's
    # outline columns are the first c_i of one fixed shuffle, so the shadow is nested and grows evenly; the rest of a shadow row is the deep mortar tone
    base = faces["a"].astype(np.int32).copy()
    n = 3 if not big else 6
    fractions = [0.12, 0.6, 1.0] if not big else [0.06, 0.22, 0.42, 0.62, 0.84, 1.0]
    perm = rng("wall-base", T).permutation(T)
    for i in range(n):
        y = T - n + i
        c = int(round(T * fractions[i]))
        row = np.full(T, STONE["mortar"], np.int32) if i > 0 else base[y, :].copy()
        row[perm[:c]] = 0
        base[y, :] = row
    tiles["wall_stone_base"] = base.astype(np.uint8)
    # top: the lit coping seen from above. Slabs 10 and 6 px long (scaled), a lit back edge, a shaded front lip
    top = np.full((T, T), STONE["lit"], np.int32)
    rt = rng("wall-top", T)
    cell = max(3, T // 8)
    nz = pv_noise(T, T, cell, cell + 1, ("wall-top-tone", T))
    lev = despeckle(despeckle(np.where(nz < 0.09, -1, 0).astype(np.int32)))
    top = np.where(lev < 0, STONE["base"], top)
    lip = 3 if big else 2
    k = T // 16
    for j in (0, 10 * k):
        top[:T - lip - 1, j] = STONE["mortar"]
        top[:T - lip - 1, (j + 1) % T] = STONE["lit"]
        if big:
            top[:T - lip - 1, (j - 1) % T] = STONE["dark"]
            top[:T - lip - 1, (j - 2) % T] = STONE["base"]
    for _ in range(1 + 2 * big):
        for _try in range(40):
            shape = clump_shapes()[int(rt.randint(0, 6))]
            x, y = int(rt.randint(3, T - 5)), int(rt.randint(3, T - 5 - lip))
            cells = [(x + dx, y + dy) for dy, row in enumerate(shape) for dx, ch in enumerate(row) if ch == "x"]
            if all(0 <= cx < T and 0 <= cy < T and top[cy, cx] in (STONE["lit"], STONE["base"]) and min(abs(cx - j) for j in (0, 10 * k, T)) > 2 for cx, cy in cells):
                val = STONE["dark"] if rt.rand() < 0.4 else STONE["base"]
                for cx, cy in cells:
                    top[cy, cx] = val
                break
    top[0, :] = STONE["lit"]                                   # lit back edge
    top[T - lip - 1, :] = STONE["base"]
    top[T - lip:T - 1, :] = STONE["dark"]                      # shaded front lip
    top[T - 1, :] = STONE["mortar"]
    tiles["wall_stone_top"] = top.astype(np.uint8)
    return tiles


# ---------------------------------------------------------------------------
# Edges: the game's own transition tiles (scripts/assets/fantasy.ts: EDGE_PAIRS, ORTHO_VARIANTS, INNER_VARIANTS, orthoMask, innerMask)
# made from this library's base tiles, with a painted bank (a lit lip, a shadow, turf, foam) instead of the game's drawn one.
#
# A transition tile is the OVER material's base tile with some sides eaten into by the UNDER material's base tile along a wandering line
# (EDGE_BITE: 1 to 5 px deep at 16 px, the same shape scaled at 32 px). The mask is the game's formula exactly; the bank is painted.
# ---------------------------------------------------------------------------
EDGE_BITE = [1, 2, 3, 4, 5, 5, 4, 3, 2, 2, 3, 3, 2, 1, 1, 1]
ORTHO_VARIANTS = [
    ("n", "n"), ("e", "e"), ("s", "s"), ("w", "w"),
    ("ne", "ne"), ("nw", "nw"), ("se", "se"), ("sw", "sw"),
    ("ns", "ns"), ("ew", "ew"),
    ("nes", "nes"), ("wne", "wne"), ("swn", "swn"), ("esw", "esw"),
    ("nesw", "nesw"),
]
INNER_VARIANTS = ["inw", "ine", "isw", "ise"]
VARIANT_NAMES = {
    "n": "North", "s": "South", "e": "East", "w": "West", "nw": "Northwest", "ne": "Northeast", "sw": "Southwest", "se": "Southeast",
    "ns": "North and South", "ew": "East and West", "nes": "Three Sides, West Open", "wne": "Three Sides, South Open",
    "swn": "Three Sides, East Open", "esw": "Three Sides, North Open", "nesw": "Island",
    "inw": "Inner Northwest", "ine": "Inner Northeast", "isw": "Inner Southwest", "ise": "Inner Southeast"}


def bite_profile(T):
    """EDGE_BITE at tile size T: the game's own 16 entries at 16 px; at 32 px the same hill, interpolated between entries (periodic) and doubled."""
    k = T // 16
    if k == 1:
        return np.array(EDGE_BITE, np.int64)
    pos = (np.arange(T) + 0.5) / k - 0.5
    i0 = np.floor(pos).astype(int)
    f = pos - i0
    eb = np.array(EDGE_BITE, np.float64)
    v = eb[i0 % 16] * (1 - f) + eb[(i0 + 1) % 16] * f
    return np.floor(v * k + 0.5).astype(np.int64)        # half up: one pixel steps, not the 2 px stairs of a plain upscale


def ortho_sides(suffix):
    """The sides a suffix names, in the game's ORTHO_VARIANTS order: the letters of the suffix are the sides (nes = n, e, s)."""
    return list(suffix)


def ortho_mask(T, suffix):
    bite = bite_profile(T)
    Y, X = np.mgrid[0:T, 0:T]
    out = np.zeros((T, T), bool)
    for side in ortho_sides(suffix):
        depth = Y if side == "n" else (T - 1 - Y) if side == "s" else X if side == "w" else (T - 1 - X)
        along = X if side in ("n", "s") else Y
        out |= depth < bite[along]
    return out


def inner_mask(T, corner):
    bite = bite_profile(T)
    Y, X = np.mgrid[0:T, 0:T]
    north, west = "n" in corner, "w" in corner
    dy = Y if north else (T - 1 - Y)
    dx = X if west else (T - 1 - X)
    return (dx < bite[dy]) & (dy < bite[dx])


def ring_depth(m, limit):
    """For each True pixel of m, how many pixels in from its edge it is (1 = touching the outside), capped at limit + 1 (4-neighbour steps)."""
    depth = np.zeros(m.shape, np.int32)
    cur = m.copy()
    for d in range(1, limit + 1):
        touch = cur & ~(dilate(cur, 1, 0) & dilate(cur, -1, 0) & dilate(cur, 0, 1) & dilate(cur, 0, -1))
        depth[touch] = d
        cur = cur & ~touch
    depth[cur] = limit + 1
    return depth


DARKER = {27: 26, 26: 25, 25: 24, 24: 24, 2: 37, 37: 35, 35: 45, 45: 1, 44: 2, 19: 18, 18: 17, 17: 16, 16: 9, 38: 19, 23: 22, 22: 21, 21: 20, 20: 12,
          31: 30, 30: 29, 29: 28, 28: 1, 3: 31, 39: 16}


def darker(a, steps=1):
    lut = np.arange(52, dtype=np.uint8)
    for k, v in DARKER.items():
        lut[k] = v
    for _ in range(steps):
        a = lut[a]
    return a


def dress_edge(over_t, under_t, E, T, style, family, spec=None):
    """Combine the two base tiles under the eaten mask E and paint the bank. Light comes from the upper left.
    spec: per family colours (lip_l, lip_d: the lit and shaded lip of a raised surface; steps: how many ramp steps the ground darkens in the
    bank's shadow and in its second ring)."""
    spec = spec or {}
    k = T // 16
    O = ~E
    out = np.where(E, under_t, over_t).astype(np.uint8)
    dO, dE = ring_depth(O, 4 * k), ring_depth(E, 4 * k)
    E_up, E_dn, E_lf, E_rt = dilate(E, 1, 0), dilate(E, -1, 0), dilate(E, 0, 1), dilate(E, 0, -1)
    O_up, O_lf = dilate(O, 1, 0), dilate(O, 0, 1)
    rim = O & (dO <= k)                                                   # over pixels touching the eaten region (k px wide)
    lit_side = E_up | E_lf | (dilate(E_up, 0, 1) if k > 1 else False) | (dilate(E_lf, 1, 0) if k > 1 else False)
    face_light = rim & lit_side
    face_dark = rim & ~face_light
    cast = E & (dE <= k) & (O_up | O_lf)                                  # under pixels the over material shades (up or left of them)
    cast2 = (E & ~cast & (dE <= 2 * k) & (dilate(cast, 1, 0) | dilate(cast, 0, 1))) if k > 1 else np.zeros_like(E)
    F = rng("edge-field", family, T).rand(T, T)
    s1, s2 = spec.get("steps", (2, 2))
    if style == "turf":
        # grass over paving, dirt or sand: a dark outline on the turf, a lit blade edge facing the light, tufts spilling onto the ground
        g = GRASS
        out = np.where(rim, g["deep"], out)
        inner = O & (dO > k) & (dO <= 2 * k)
        lit_inner = inner & (E_up | E_lf | dilate(E_up, 0, 1) | dilate(E_lf, 1, 0) | dilate(dilate(E_up, 0, 1), 0, 1) | dilate(dilate(E_lf, 1, 0), 1, 0))
        out = np.where(lit_inner & (over_t == g["base"]), g["light"], out)
        out = np.where(cast, darker(out, s1), out)
        out = np.where(cast2, darker(out, s2), out)
        spill1 = E & (dE <= k) & ~cast & (F < 0.5)
        spill2 = E & (dE > k) & (dE <= 2 * k) & (F < 0.22) & (dilate(spill1, 1, 0) | dilate(spill1, -1, 0) | dilate(spill1, 0, 1) | dilate(spill1, 0, -1))
        sp1, sp2 = spec.get("spill", (g["dark"], g["deep"]))
        out = np.where(spill1, sp1, out)
        out = np.where(spill2, sp2, out)
    elif style == "raised":
        # cobble or cliff plateau over grass, water or earth: lit lip up left, shaded lip down right, its shadow on the ground
        lit_c, dark_c = spec.get("lip_l", STONE["lit"]), spec.get("lip_d", STONE["mortar"])
        out = np.where(face_light, lit_c, out)
        out = np.where(face_dark, dark_c, out)
        out = np.where(cast, darker(out, s1), out)
        out = np.where(cast2, darker(out, s2), out)
        if k > 1:
            face2 = O & (dO > k) & (dO <= 2 * k) & (E_dn | E_rt | dilate(E_dn, 0, 1) | dilate(E_rt, 1, 0))
            out = np.where(face2 & ~face_light, STONE["dark"], out)
    elif style == "shore":
        # water over a bank: foam lip where the bank lies below or right, shadow where it lies above or left, a dark bank outline
        W = WATER
        shadow = rim & (E_up | E_lf)
        lip = rim & ~shadow
        out = np.where(lip, spec.get("foam", W["light"]), out)
        out = np.where(shadow, W["deep"], out)
        sh2 = O & ~rim & (dO <= 2 * k) & (dilate(shadow, 1, 0) | dilate(shadow, 0, 1) | (dilate(shadow, 1, 1) if k > 1 else np.zeros_like(E)))
        out = np.where(sh2, W["abyss"] if k > 1 else W["deep"], out)
        outline = E & (dE <= k)
        out = np.where(outline, darker(out, s1), out)
        out2 = E & (dE > k) & (dE <= 2 * k) & (k > 1)
        out = np.where(out2, darker(out, s2), out)
    elif style == "soft":
        # pale grass into ordinary grass: one material at two shades, so no bank and no outline, only a meander of the in-between step
        rimp = O & (dO <= k)
        out = np.where(rimp & (F < 0.5), GRASS["base"], out)
        spill = E & (dE <= k) & (F > 0.62)
        out = np.where(spill, PALE["base"], out)
    return out


# ---------------------------------------------------------------------------
# The library: every target id of the maker's scope, the parts, the contact sheets and the numbers
# ---------------------------------------------------------------------------
# (prefix, over material, under material, bank style, walkable)
FAMILIES = [
    ("floor_grass_edge_", "grass", "stone", "turf", {"steps": (2, 2)}),
    ("floor_grass_edge_dirt_", "grass", "dirt", "turf", {"steps": (2, 2)}),
    ("floor_grass_edge_sand_", "grass", "sand", "turf", {"steps": (3, 3)}),
    ("floor_stone_edge_grass_", "stone", "grass", "raised", {"lip_l": 27, "lip_d": 24, "steps": (2, 2)}),
    ("floor_stone_edge_water_", "stone", "water", "raised", {"lip_l": 8, "lip_d": 24, "steps": (2, 3)}),
    ("water_edge_", "water", "stone", "shore", {"steps": (2, 2)}),
    ("water_edge_grass_", "water", "grass", "shore", {"steps": (2, 1)}),
    ("water_edge_sand_", "water", "sand", "shore", {"steps": (2, 2), "foam": 14}),
    ("cliff_edge_", "cliff_top", "grass", "raised", {"lip_l": 27, "lip_d": 24, "steps": (2, 2)}),
    ("floor_grass_pale_edge_", "pale", "grass", "soft", {}),
]


def build_materials(T, src):
    """{material: {variant: tile}} for every ground, wall and canopy material at tile size T."""
    m = {}
    m["stone"], m["stone_template"] = paint_stone(T, src)
    kinds = paint_meadow(T, GRASS, GRASS_KINDS, "grass")
    m["grass"] = kinds
    m["pale"] = paint_meadow(T, PALE, PALE_KINDS, "pale")
    m["dirt"] = paint_dirt(T, src)
    m["sand"] = paint_sand(T)
    m["water"] = paint_water(T)
    m["canopy"], _ = paint_canopy(T, src)
    m["cliff_top"], _ = paint_cliff_top(T)
    m["cliff_face"], _ = paint_cliff_face(T)
    m["walls"] = paint_walls(T, src)
    return m


def asset_tiles(T, src):
    """{assetId: (T, T) uint8} for everything in the maker's scope."""
    m = build_materials(T, src)
    tiles = {}

    def four(base_id, mat, keys="abcd"):
        for i, k in enumerate(keys):
            tiles[base_id + ("" if i == 0 else "_" + "bcd"[i - 1])] = m[mat][k]

    four("floor_grass", "grass")
    tiles["floor_grass_tufted"] = m["grass"]["tufted"]
    tiles["floor_grass_flowers"] = m["grass"]["flowers"]
    four("floor_grass_pale", "pale")
    four("floor_dirt", "dirt")
    four("floor_sand", "sand")
    four("floor_stone", "stone")
    tiles["floor_stone_cracked"] = m["stone"]["cracked"]
    tiles["floor_stone_drain"] = m["stone"]["drain"]
    four("water", "water")
    four("forest_canopy", "canopy")
    four("cliff_top", "cliff_top")
    four("cliff_face", "cliff_face")
    for k, v in m["walls"].items():
        tiles[k] = v
    base = {"grass": m["grass"]["a"], "pale": m["pale"]["a"], "dirt": m["dirt"]["a"], "sand": m["sand"]["a"], "stone": m["stone"]["a"],
            "water": m["water"]["a"], "cliff_top": m["cliff_top"]["a"]}
    for prefix, over, under, style, spec in FAMILIES:
        for suffix, _ in ORTHO_VARIANTS:
            tiles[prefix + suffix] = dress_edge(base[over], base[under], ortho_mask(T, suffix), T, style, prefix, spec)
        for corner in INNER_VARIANTS:
            tiles[prefix + corner] = dress_edge(base[over], base[under], inner_mask(T, corner), T, style, prefix, spec)
    return tiles, m


def load_targets():
    with open(TARGETS_JSON) as fh:
        return json.load(fh)["targets"]


def write_part(T, tiles):
    targets = [t for t in load_targets() if t["group"] in ("ground", "wall", "edge")]
    sprites, gaps = [], []
    for t in targets:
        if t.get("outOfPlay"):
            continue
        a = tiles.get(t["assetId"])
        if a is None:
            gaps.append({"assetId": t["assetId"], "reason": "not produced"})
            continue
        k = T // 16
        assert a.shape == (t["h16"] * k, t["w16"] * k), (t["assetId"], a.shape)
        sprites.append({"assetId": t["assetId"], "kind": t["kind"], "name": t["name"], "walkable": t["walkable"],
                        "pixels": [[int(v) for v in row] for row in a]})
    part = {"maker": MAKER, "size": T, "style": STYLE, "sprites": sprites, "gaps": gaps}
    os.makedirs(PARTS, exist_ok=True)
    path = os.path.join(PARTS, f"{MAKER}-{T}.json")
    with open(path, "w") as fh:
        json.dump(part, fh, separators=(",", ":"))
    return path, len(sprites), gaps


# -- contact sheets -------------------------------------------------------------------------------------------------------------

SUFFIX_BY_SIDES = {frozenset(s): s for s, _ in ORTHO_VARIANTS}


def edge_suffix(sides):
    """The suffix the game's autotiler draws for a set of under-material sides (terrainEdges.ts edgeVariantFor)."""
    return SUFFIX_BY_SIDES[frozenset(sides)]


def autotile_map(T, tiles, m, over_mat, under_mat, prefix, shape, seed):
    """A map where the over material (cells marked 1 in `shape`) sits in the under material, with every cell drawn the way the game's
    autotiler draws it: an over cell takes its edge tile from its under neighbours (orthogonal sides first, then the first notch), the
    rest take a random field variant. Returns (image, list of cell ids)."""
    rows, cols = len(shape), len(shape[0])
    g = np.array([[1 if ch == "#" else 0 for ch in row] for row in shape], np.uint8)
    r = rng("autotile", T, prefix, seed)
    names = {"grass": ["floor_grass", "floor_grass_b", "floor_grass_c", "floor_grass_d"], "pale": ["floor_grass_pale", "floor_grass_pale_b", "floor_grass_pale_c", "floor_grass_pale_d"],
             "dirt": ["floor_dirt", "floor_dirt_b", "floor_dirt_c", "floor_dirt_d"], "sand": ["floor_sand", "floor_sand_b", "floor_sand_c", "floor_sand_d"],
             "stone": ["floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d"], "water": ["water", "water_b", "water_c", "water_d"],
             "cliff_top": ["cliff_top", "cliff_top_b", "cliff_top_c", "cliff_top_d"]}
    img = np.zeros((rows * T, cols * T), np.uint8)
    used = set()

    def at(y, x):
        return int(g[y, x]) if 0 <= y < rows and 0 <= x < cols else -1        # outside counts as neither

    for y in range(rows):
        for x in range(cols):
            over = g[y, x] == 1
            if over:
                sides = [s for s, (dy, dx) in (("n", (-1, 0)), ("e", (0, 1)), ("s", (1, 0)), ("w", (0, -1))) if at(y + dy, x + dx) == 0]
                tid = None
                if sides:
                    tid = prefix + edge_suffix(sides)
                else:
                    for corner, (dy, dx) in (("inw", (-1, -1)), ("ine", (-1, 1)), ("isw", (1, -1)), ("ise", (1, 1))):
                        if at(y + dy, x + dx) == 0:
                            tid = prefix + corner
                            break
                if tid is None:
                    tid = names[over_mat][int(r.randint(4))]
            else:
                tid = names[under_mat][int(r.randint(4))]
            used.add(tid)
            img[y * T:(y + 1) * T, x * T:(x + 1) * T] = tiles[tid]
    return img, used


AUTOTILE_SHAPES = {
    "a": ["...........", ".####......", ".######.#..", ".#####..##.", "..###...#..", "...........", "..#.#...###", "..........."],
}


# A scene that uses everything the way the game does: variants scattered per cell, edges chosen from the neighbours.
SCENE = [
    "ffffffffggggggggggggppppppggggccccccccCC",
    "ffffffgggggggggggggppppppppgggcccccccccC",
    "fffffgggggggggggggggppppppgggggccccccccC",
    "ffffggggggggwwwwggggggggggggggggcccccccC",
    "fffgggggggwwwwwwwwgggggggdddggggggccccCC",
    "gggggggggwwwwwwwwwwggggggdddddggggggggCC",
    "ggggssssswwwwwwwwwssssggggdddddgggggggCC",
    "gggsssssswwwwwwwwsssssggggggdddggggggggg",
    "ggggssssssswwwwsssssssgggggggdddddgggggg",
    "ggggggsssssssssssssgggggSSSSSSSSdddggggg",
    "ggggggggggggggggggggggSSSSSSSSSSSdddgggg",
    "gggggggggggggggggggggSSSSSSSSSSSSSgggggg",
    "ggggggppppggggggggggggSSSSSSSSSSSSgggwwg",
    "gggggppppppgggggggggggggSSSSSSSSSgggwwwg",
]
SCENE_ID = {"g": "grass", "p": "pale", "d": "dirt", "s": "sand", "S": "stone", "w": "water", "f": "canopy", "c": "cliff_top", "C": "cliff_face"}
SCENE_NAMES = {"grass": ["floor_grass", "floor_grass_b", "floor_grass_c", "floor_grass_d", "floor_grass", "floor_grass_b", "floor_grass_c", "floor_grass_d",
                         "floor_grass", "floor_grass_b", "floor_grass_tufted", "floor_grass_flowers"],   # tileVariants.ts: ten field slots, two decals
               "pale": ["floor_grass_pale", "floor_grass_pale_b", "floor_grass_pale_c", "floor_grass_pale_d"],
               "dirt": ["floor_dirt", "floor_dirt_b", "floor_dirt_c", "floor_dirt_d"], "sand": ["floor_sand", "floor_sand_b", "floor_sand_c", "floor_sand_d"],
               "stone": ["floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d", "floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d",
                         "floor_stone", "floor_stone_b", "floor_stone_cracked", "floor_stone_drain"],
               "water": ["water", "water_b", "water_c", "water_d"], "canopy": ["forest_canopy", "forest_canopy_b", "forest_canopy_c", "forest_canopy_d"],
               "cliff_top": ["cliff_top", "cliff_top_b", "cliff_top_c", "cliff_top_d"], "cliff_face": ["cliff_face", "cliff_face_b", "cliff_face_c", "cliff_face_d"]}
# the game's edge rules (terrainEdges.ts TERRAIN_EDGE_RULES) for the pairs this library draws: (over material, under materials, prefix)
SCENE_RULES = [("cliff_top", None, "cliff_edge_"), ("water", ("grass",), "water_edge_grass_"), ("water", ("sand",), "water_edge_sand_"),
               ("water", ("stone",), "water_edge_"), ("grass", ("stone",), "floor_grass_edge_"), ("grass", ("dirt",), "floor_grass_edge_dirt_"),
               ("grass", ("sand",), "floor_grass_edge_sand_"), ("stone", ("grass",), "floor_stone_edge_grass_"), ("stone", ("water",), "floor_stone_edge_water_"),
               ("pale", ("grass",), "floor_grass_pale_edge_")]


def scene_image(T, tiles, scene=None, seed=11):
    scene = scene or SCENE
    rows, cols = len(scene), len(scene[0])
    mat = [[SCENE_ID[ch] for ch in row] for row in scene]
    r = rng("scene", T, seed)
    img = np.zeros((rows * T, cols * T), np.uint8)

    def at(y, x):
        return mat[y][x] if 0 <= y < rows and 0 <= x < cols else None

    for y in range(rows):
        for x in range(cols):
            m = mat[y][x]
            names = SCENE_NAMES[m]
            tid = names[int(r.randint(len(names)))]
            cands = []
            for over, unders, prefix in SCENE_RULES:
                if over != m:
                    continue
                is_other = (lambda n: n is not None and n != "cliff_top" and n != "cliff_face") if unders is None else (lambda n, u=unders: n in u)
                sides = [s for s, (dy, dx) in (("n", (-1, 0)), ("e", (0, 1)), ("s", (1, 0)), ("w", (0, -1))) if is_other(at(y + dy, x + dx))]
                corner = None
                if not sides:
                    for c, (dy, dx) in (("inw", (-1, -1)), ("ine", (-1, 1)), ("isw", (1, -1)), ("ise", (1, 1))):
                        if is_other(at(y + dy, x + dx)):
                            corner = c
                            break
                if sides:
                    cands.append((len(sides), prefix + edge_suffix(sides)))
                elif corner:
                    cands.append((0, prefix + corner))
            if cands:
                cands.sort(key=lambda c: -c[0])
                tid = cands[0][1]
            img[y * T:(y + 1) * T, x * T:(x + 1) * T] = tiles[tid]
    return img



def room_image(T, tiles, cols=12, rows=8, seed=5):
    """A room the way the DM lays one (promptBuilder.ts): wall_stone_top along the north edge, wall_stone down the east and west, wall_stone_base
    along the south, the floor scattered over its variants; a wooden rug is not in this scope."""
    r = rng("room", T, seed)
    img = np.zeros((rows * T, cols * T), np.uint8)
    floor = SCENE_NAMES["stone"]
    faces = ["wall_stone", "wall_stone_b", "wall_stone_c"]
    for y in range(rows):
        for x in range(cols):
            if y == 0:
                tid = "wall_stone_top"
            elif y == rows - 1:
                tid = "wall_stone_base"
            elif x in (0, cols - 1):
                tid = faces[int(r.randint(3))]
            else:
                tid = floor[int(r.randint(len(floor)))]
            img[y * T:(y + 1) * T, x * T:(x + 1) * T] = tiles[tid]
    return img


def jump_share(a, b, axis, lum):
    """Share of boundary pixel pairs between two abutting tiles whose luminance jumps by more than 14 (of 255)."""
    la, lb = lum[a.astype(np.int64)], lum[b.astype(np.int64)]
    if axis == 1:
        return float((np.abs(la[:, -1] - lb[:, 0]) > 14).mean())
    return float((np.abs(la[-1, :] - lb[0, :]) > 14).mean())


def tile_stats(a):
    lum = luma(np.arange(len(palette())))
    v = lum[a.astype(np.int64)]
    return {"meanL": round(float(v.mean()), 1), "sdL": round(float(v.std()), 1), "distinct": int(len(np.unique(a)))}


BASE_ID = {"grass": "floor_grass", "pale": "floor_grass_pale", "dirt": "floor_dirt", "sand": "floor_sand", "stone": "floor_stone", "water": "water",
           "cliff_top": "cliff_top"}


FIELD_BOUNDS = {"cliff_face": (0.7, 0.5), "wall_stone": (0.75, 0.72)}       # the game's FIELD_TILES bounds (lag one, other lags); everything else 0.6 / 0.35


def autocorrelation(a, dx, dy, lum):
    g = lum[a.astype(np.int64)]
    b = np.roll(np.roll(g, -dy, 0), -dx, 1)
    ga, gb = g - g.mean(), b - b.mean()
    da, db = float((ga ** 2).sum()), float((gb ** 2).sum())
    if da == 0 or db == 0:
        return 1.0
    return float((ga * gb).sum() / np.sqrt(da * db))


def field_checks(T, tiles):
    """The game's field tile tests (test/livingtable-assets-fantasy.test.ts), run on these tiles at their own size (lags scale with T): at least
    four distinct values and a luminance sd of 18, no autocorrelation above the bound at any lag, a wrap step no more than 1.3x the inner step."""
    lum = luma(np.arange(len(palette())))
    k = T // 16
    out = {"sdBelow18": [], "autocorrOver": {}, "wrapOver": []}
    ids = [i for i in tiles if i.startswith(("floor_grass", "floor_dirt", "floor_sand", "floor_stone", "water", "forest_canopy", "cliff_top", "cliff_face", "wall_stone"))
           and "edge" not in i and i not in ("floor_grass_tufted", "floor_grass_flowers", "floor_stone_cracked", "floor_stone_drain", "wall_stone_top", "wall_stone_base")]
    for i in ids:
        a = tiles[i]
        v = lum[a.astype(np.int64)]
        if v.std() < 18.0:
            out["sdBelow18"].append(f"{i} ({v.std():.1f})")
        base = "wall_stone" if i.startswith("wall_stone") else "cliff_face" if i.startswith("cliff_face") else ""
        b1, bo = FIELD_BOUNDS.get(base, (0.6, 0.35))
        worst, where = 0.0, ""
        for lag in range(1, T):
            limit = b1 if lag in (1, T - 1) else bo
            for dx, dy, tag in ((lag, 0, "x"), (0, lag, "y"), (lag, lag, "diag")):
                c = abs(autocorrelation(a, dx, dy, lum))
                over = c - limit
                if over > worst:
                    worst, where = over, f"lag {lag} {tag} {c:.2f} > {limit}"
        if worst > 0:
            out["autocorrOver"][i] = where
        if base not in ("wall_stone", "cliff_face"):
            inner = (np.abs(np.diff(v, axis=1)).sum() + np.abs(np.diff(v, axis=0)).sum()) / (v.shape[0] * (v.shape[1] - 1) + v.shape[1] * (v.shape[0] - 1))
            col = np.abs(v[:, -1] - v[:, 0]).mean()
            row = np.abs(v[-1, :] - v[0, :]).mean()
            if col > inner * 1.3 or row > inner * 1.3:
                out["wrapOver"].append(f"{i} (col {col / inner:.2f}x row {row / inner:.2f}x)")
    return out


VARIANT_GROUPS = {
    "grass": ["floor_grass", "floor_grass_b", "floor_grass_c", "floor_grass_d", "floor_grass_tufted", "floor_grass_flowers"],
    "pale grass": ["floor_grass_pale", "floor_grass_pale_b", "floor_grass_pale_c", "floor_grass_pale_d"],
    "dirt": ["floor_dirt", "floor_dirt_b", "floor_dirt_c", "floor_dirt_d"], "sand": ["floor_sand", "floor_sand_b", "floor_sand_c", "floor_sand_d"],
    "stone": ["floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d", "floor_stone_cracked", "floor_stone_drain"],
    "water": ["water", "water_b", "water_c", "water_d"], "forest canopy": ["forest_canopy", "forest_canopy_b", "forest_canopy_c", "forest_canopy_d"],
    "cliff top": ["cliff_top", "cliff_top_b", "cliff_top_c", "cliff_top_d"], "cliff face": ["cliff_face", "cliff_face_b", "cliff_face_c", "cliff_face_d"],
    "wall face": ["wall_stone", "wall_stone_b", "wall_stone_c"],
}


def isolated_share(a):
    """Share of pixels with no same valued 4-neighbour (wrapping): the single pixel salt and pepper measure."""
    n = [np.roll(a, sh, ax) for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1))]
    return float((sum((x == a).astype(np.int32) for x in n) == 0).mean())


def variant_checks(tiles):
    """Every variant of a material beside every other (the game scatters them per cell): the outermost ring of pixels must be byte identical, so
    the pair meets as the template meets itself across its own wrap. Plus the single pixel share of each material."""
    ring = lambda a: np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]])
    out = {"ringIdentical": {}, "isolatedPixelShare": {}}
    for name, ids in VARIANT_GROUPS.items():
        out["ringIdentical"][name] = bool(all((ring(tiles[i]) == ring(tiles[ids[0]])).all() for i in ids))
        out["isolatedPixelShare"][name] = round(float(np.mean([isolated_share(tiles[i]) for i in ids])), 3)
    return out


def edge_checks(T, tiles):
    """The game's own edge tests (test/livingtable-assets-fantasy.test.ts), run on these tiles: every tile draws a bank (at least 8 pixels that
    are neither material) and 60 percent of it is 20 L clear of both materials' mean luminance (the soft pair is exempt); the sides a tile does not
    bite are byte identical to the over base tile (columns 4..11 of the opposite side); the boundary wanders at least 5 px (scaled)."""
    lum = luma(np.arange(len(palette())))
    res = {}
    k = T // 16
    for prefix, over, under, style, spec in FAMILIES:
        o, u = tiles[BASE_ID[over]], tiles[BASE_ID[under]]
        om, um = float(lum[o].mean()), float(lum[u].mean())
        worst_pct, least_bank, bad_side = 100.0, 10 ** 9, 0
        for suffix in [sfx for sfx, _ in ORTHO_VARIANTS] + INNER_VARIANTS:
            t = tiles[prefix + suffix]
            diff = (t != o) & (t != u)
            bank = t[diff]
            least_bank = min(least_bank, int(diff.sum()))
            if style != "soft" and len(bank):
                vis = ((np.abs(lum[bank] - om) >= 20) & (np.abs(lum[bank] - um) >= 20)).mean() * 100.0
                worst_pct = min(worst_pct, float(vis))
        for suffix, opposite in (("n", "s"), ("s", "n"), ("e", "w"), ("w", "e")):
            t = tiles[prefix + suffix]
            lo, hi = 4 * k, 12 * k
            edge = {"n": (t[0, lo:hi], o[0, lo:hi]), "s": (t[T - 1, lo:hi], o[T - 1, lo:hi]), "w": (t[lo:hi, 0], o[lo:hi, 0]), "e": (t[lo:hi, T - 1], o[lo:hi, T - 1])}[opposite]
            bad_side += int((edge[0] != edge[1]).sum())
        tn = tiles[prefix + "n"]
        deepest = 0
        for x in range(T):
            d = 0
            for y in range(T):
                if tn[y, x] == o[y, x] and (style != "soft" or True):
                    break
                d += 1
            deepest = max(deepest, d)
        res[prefix] = {"leastBankPixels": least_bank, "worstBankVisiblePct": round(worst_pct, 1), "unbittenSideMismatch": bad_side, "deepestBite": deepest}
    return res


def run(T, src, report):
    t0 = time.time()
    tiles, m = asset_tiles(T, src)
    report["paintSeconds"][str(T)] = round(time.time() - t0, 2)
    path, n, gaps = write_part(T, tiles)
    zoom = 4 if T == 16 else 2
    out = os.path.join(WORK, "sheets")
    os.makedirs(out, exist_ok=True)
    targets = {t["assetId"]: t for t in load_targets()}
    # ground and walls
    groups = [("GRASS", ["floor_grass", "floor_grass_b", "floor_grass_c", "floor_grass_d", "floor_grass_tufted", "floor_grass_flowers"]),
              ("PALE", ["floor_grass_pale", "floor_grass_pale_b", "floor_grass_pale_c", "floor_grass_pale_d"]),
              ("DIRT", ["floor_dirt", "floor_dirt_b", "floor_dirt_c", "floor_dirt_d"]),
              ("SAND", ["floor_sand", "floor_sand_b", "floor_sand_c", "floor_sand_d"]),
              ("STONE", ["floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d", "floor_stone_cracked", "floor_stone_drain"]),
              ("WATER", ["water", "water_b", "water_c", "water_d"]),
              ("CANOPY", ["forest_canopy", "forest_canopy_b", "forest_canopy_c", "forest_canopy_d"]),
              ("CLIFF TOP", ["cliff_top", "cliff_top_b", "cliff_top_c", "cliff_top_d"]),
              ("CLIFF FACE", ["cliff_face", "cliff_face_b", "cliff_face_c", "cliff_face_d"]),
              ("WALL", ["wall_stone", "wall_stone_b", "wall_stone_c", "wall_stone_top", "wall_stone_base"])]
    items = []
    for title, ids in groups:
        for i in ids:
            items.append((i.replace("floor_", "").replace("wall_stone", "wall") if len(i) < 40 else i, tiles[i]))
        items.append((None, None))
    sheet(items, os.path.join(out, f"ground-{T}.png"), zoom=zoom, width=(8 * (T + 4) * zoom))
    # mixed fields, each material scattered the way the game's variant picker scatters it
    mix_items = []
    for title, names in (("GRASS", ["floor_grass", "floor_grass_b", "floor_grass_c", "floor_grass_d", "floor_grass", "floor_grass_b", "floor_grass_tufted", "floor_grass_flowers"]),
                         ("STONE", ["floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d", "floor_stone", "floor_stone_b", "floor_stone_cracked", "floor_stone_drain"]),
                         ("PALE", ["floor_grass_pale", "floor_grass_pale_b", "floor_grass_pale_c", "floor_grass_pale_d"]),
                         ("DIRT", ["floor_dirt", "floor_dirt_b", "floor_dirt_c", "floor_dirt_d"]),
                         ("SAND", ["floor_sand", "floor_sand_b", "floor_sand_c", "floor_sand_d"]),
                         ("WATER", ["water", "water_b", "water_c", "water_d"]),
                         ("CANOPY", ["forest_canopy", "forest_canopy_b", "forest_canopy_c", "forest_canopy_d"]),
                         ("CLIFF TOP", ["cliff_top", "cliff_top_b", "cliff_top_c", "cliff_top_d"]),
                         ("CLIFF FACE", ["cliff_face", "cliff_face_b", "cliff_face_c", "cliff_face_d"])):
        rr = rng("mix", T, title)
        rows = [np.concatenate([tiles[names[int(rr.randint(len(names)))]] for _ in range(7)], 1) for _ in range(3)]
        mix_items.append((title + " MIXED", np.concatenate(rows, 0)))
    sheet(mix_items, os.path.join(out, f"mixed-{T}.png"), zoom=zoom if T == 16 else 2, width=2 * 7 * T * (zoom if T == 16 else 2) + 40)
    # a room strip of walls
    w = lambda n: tiles[n]
    room = np.concatenate([np.concatenate([w("wall_stone_top")] * 8, 1),
                           np.concatenate([w(n) for n in ["wall_stone", "wall_stone_b", "wall_stone_c", "wall_stone_b", "wall_stone", "wall_stone_c", "wall_stone_b", "wall_stone"]], 1),
                           np.concatenate([tiles[n] for n in ["floor_stone", "floor_stone_b", "floor_stone_cracked", "floor_stone_d", "floor_stone", "floor_stone_drain", "floor_stone_b", "floor_stone_c"]], 1),
                           np.concatenate([w("wall_stone_base")] * 8, 1)], 0)
    sheet([("ROOM STRIP", room)], os.path.join(out, f"walls-{T}.png"), zoom=zoom, width=8 * T * zoom + 10)
    # edges: one sheet per family (19 tiles) and its autotile map
    stats = {}
    seam = {}
    overview = []
    lum = luma(np.arange(len(palette())))
    for prefix, over, under, style, spec in FAMILIES:
        items = []
        for suffix, _ in ORTHO_VARIANTS:
            items.append((suffix, tiles[prefix + suffix]))
            if suffix in ("w", "sw", "ew", "nesw"):
                items.append((None, None))
        for corner in INNER_VARIANTS:
            items.append((corner, tiles[prefix + corner]))
        sheet(items, os.path.join(out, f"edges-{T}-{prefix.strip('_')}.png"), zoom=zoom, width=6 * (T + 4) * zoom)
        img, used = autotile_map(T, tiles, m, over, under, prefix, AUTOTILE_SHAPES["a"], 1)
        sheet([(prefix.strip("_").upper(), img)], os.path.join(out, f"autotile-{T}-{prefix.strip('_')}.png"), zoom=zoom, width=img.shape[1] * zoom + 10)
        overview.append((prefix.strip("_").upper(), img))
        # seams: boundary jump share between abutting tiles on the demo map, against the same share inside the field tiles
        rows, cols = len(AUTOTILE_SHAPES["a"]), len(AUTOTILE_SHAPES["a"][0])
        across, inner = [], []
        for y in range(rows):
            for x in range(cols):
                cur = img[y * T:(y + 1) * T, x * T:(x + 1) * T]
                if x + 1 < cols:
                    across.append(jump_share(cur, img[y * T:(y + 1) * T, (x + 1) * T:(x + 2) * T], 1, lum))
                if y + 1 < rows:
                    across.append(jump_share(cur, img[(y + 1) * T:(y + 2) * T, x * T:(x + 1) * T], 0, lum))
        seam[prefix] = {"meanJump": round(float(np.mean(across)), 3), "maxJump": round(float(np.max(across)), 3)}
    # every edge tile of every family in one sheet: a row per family, the 19 shapes across
    order = [sfx for sfx, _ in ORTHO_VARIANTS] + INNER_VARIANTS
    allrows = [np.concatenate([np.pad(tiles[prefix + sfx], 1, constant_values=255) for sfx in order], 1) for prefix, _, _, _, _ in FAMILIES]
    sheet([("ALL EDGES " + " ".join(order), np.concatenate(allrows, 0))], os.path.join(out, f"edges-all-{T}.png"), zoom=3 if T == 16 else 2,
          width=len(order) * (T + 2) * (3 if T == 16 else 2) + 10)
    oz = 3 if T == 16 else 2
    for half in (0, 1):
        sheet(overview[half * 5:half * 5 + 5], os.path.join(out, f"overview-{T}-{half}.png"), zoom=oz, width=2 * (11 * T * oz + 12))
    report.setdefault("stoneFromRender", {})[str(T)] = stone_render_coverage(T, src)
    report.setdefault("variantChecks", {})[str(T)] = variant_checks(tiles)
    report.setdefault("edgeChecks", {})[str(T)] = edge_checks(T, tiles)
    report.setdefault("fieldChecks", {})[str(T)] = field_checks(T, tiles)
    room = room_image(T, tiles)
    sheet([("ROOM", room)], os.path.join(out, f"room-{T}.png"), zoom=4 if T == 16 else 2, width=room.shape[1] * (4 if T == 16 else 2) + 10)
    scene = scene_image(T, tiles)
    zs = 3 if T == 16 else 2
    sheet([("SCENE LEFT", scene[:, :20 * T])], os.path.join(out, f"scene-{T}-left.png"), zoom=zs, width=20 * T * zs + 10)
    sheet([("SCENE RIGHT", scene[:, 20 * T:])], os.path.join(out, f"scene-{T}-right.png"), zoom=zs, width=20 * T * zs + 10)
    # numbers: every tile's luminance stats against the game's own test thresholds
    flags = []
    for aid, a in tiles.items():
        s = tile_stats(a)
        stats[aid] = s
        t = targets[aid]
        if t["group"] == "ground" and t["walkable"] and aid not in ("floor_stone_cracked", "floor_stone_drain") and not (80 <= s["meanL"] <= 160):
            flags.append(f"{aid}: walkable floor mean L {s['meanL']} outside 80..160")
        if t["group"] in ("ground", "wall") and s["distinct"] < 4:
            flags.append(f"{aid}: only {s['distinct']} distinct indices")
    report["flags"][str(T)] = flags
    report["stats"][str(T)] = stats
    report["seams"][str(T)] = seam
    report["parts"][str(T)] = {"path": path, "sprites": n, "gaps": len(gaps)}
    log(f"{T}px: {n} sprites, {len(gaps)} gaps, {len(flags)} flags, paint {report['paintSeconds'][str(T)]}s")
    return tiles


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    sizes = [int(x) for x in (argv[argv.index("--sizes") + 1] if "--sizes" in argv else "16,32").split(",")]
    paint_only = "--paint-only" in argv or "--no-render" in argv
    os.makedirs(WORK, exist_ok=True)
    report = {"maker": MAKER, "style": STYLE, "paintSeconds": {}, "renderSeconds": {}, "flags": {}, "stats": {}, "seams": {}, "parts": {}}
    t_all = time.time()
    if bpy is not None and not paint_only:
        for T in sizes:
            t0 = time.time()
            src = render_sources(T)
            np.savez_compressed(raw_path(T), **src)
            report["renderSeconds"][str(T)] = round(time.time() - t0, 1)
    for T in sizes:
        src = load_sources(T)
        if src is None:
            raise SystemExit(f"lib_ground_painted: no renders for {T} px at {raw_path(T)}; run it under Blender once (see the docstring)")
        run(T, src, report)
    report["totalSeconds"] = round(time.time() - t_all, 1)
    with open(os.path.join(WORK, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    log("done in %.1fs" % report["totalSeconds"])


if __name__ == "__main__":
    main()
