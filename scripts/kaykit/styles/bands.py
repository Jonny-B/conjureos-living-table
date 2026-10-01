"""
Bands: cel-banded shading from two supersampled passes, then pixel cleanup.

Pass 1 (ALBEDO): Workbench, flat light, texture colour. KayKit textures are
colour swatches with a baked top-to-bottom gradient, which would turn every
block into a different colour, so the albedo pass samples a flattened copy of
each texture (every swatch replaced by one flat colour). What comes back is a
clean "which material is this" colour per sub-pixel.

Pass 2 (LIGHT): Workbench with a generated matcap that encodes the camera-space
normal in RGB. That is a lit pass with no light baked in, so the key light
(upper left, like classic JRPG sprites) is applied here in numpy and can be
banded exactly how we like.

Per output pixel: silhouette from sub-pixel coverage; the MAJORITY material in
the block (never an average, so no mud); the light averaged over that
material's sub-pixels only, cut into 3 bands; each material has a short
hue-family ramp (shadow, base, light) chosen from the 48 usable palette
colours. Then cleanup: orphan pixels, pinholes, band speckle, a 1px outline.
"""
import os

import bpy
import numpy as np

LABEL = "Cel bands"
DESCRIPTION = ("Supersampled albedo + light passes: majority material per pixel, key light cut into 3 palette-ramp "
               "bands, then orphan cleanup and a 1px outline.")

TRANSPARENT = 255

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------
SS = {"16x24": 12, "32x48": 8, "48x72": 8}   # supersample per size (same number of sub-pixels per block at 16x24 is cheap)
COVER_THRESHOLD = 0.36                        # block coverage needed to be solid (lower keeps thin blades)
# Inside a clip (ctx.mem.active, see harness.py) the decisions below have memory, so a pixel on a threshold does not
# flicker: solid from COVER_THRESHOLD + COVER_MARGIN, empty again only below COVER_THRESHOLD - COVER_MARGIN; the
# material a pixel had last frame stays while it holds KEEP_RATIO of the winner's weight; the band moves up past a cut
# only at cut + BAND_MARGIN and back down below cut - BAND_MARGIN (while the material is the same). Stills use the
# plain thresholds.
COVER_MARGIN = 0.08
BAND_MARGIN = 0.05
LIGHT_DIR = np.array([-0.45, 0.60, 0.66], dtype=np.float32)   # camera space: x right, y up, z toward the viewer
LIGHT_DIR = LIGHT_DIR / np.linalg.norm(LIGHT_DIR)
BAND_CUTS = (0.35, 0.80)                      # n.L below the first is shadow, above the second is light
OUTLINE_MODE = "selout"                       # "black" or "selout" (dark tint of the neighbouring material)
BLACK_INDEX = 0

# Hand-picked ramps (shadow, base, light) per flat albedo colour; anything not listed gets an automatic hue-family ramp.
MATERIAL_RAMPS = {
    (142, 153, 159): (33, 32, 8),      # steel plate: blue steel, the same family as the game's own Knight
    (79, 86, 90): (7, 33, 32),         # darker steel (joints, undersuit)
    (223, 64, 68): (10, 43, 15),       # red cape and medallion
    (162, 97, 73): (45, 37, 2),        # leather and the shield's inner face
    (247, 196, 161): (36, 4, 5),       # skin
    (222, 181, 133): (36, 4, 5),       # skin (bare-headed loadout)
}
GRADIENT_K = 1.5                              # weight of the texture's own baked top-to-bottom gradient in the light term
# Per-material nudge on the light term (positive = lit more): keeps the big red cape from reading as a dark slab.
MATERIAL_BIAS = {(223, 64, 68): 0.22}
SPECKLE_CONF = 0.7                            # a lone-material pixel that won its block by less than this share is re-voted
MINORITY_BOOST = 1.8                          # small near-black details (eyes, visor slits) win a block with less coverage

CELL_W, CELL_H = 128, 256                     # KayKit palette textures: 8 x 4 swatches, gradient top to bottom
GRADIENT_SAMPLE = 0.38                        # how far down the swatch to sample its representative colour


SCRATCH = os.path.join(os.getcwd(), ".cache", "kaykit", "scratch", "bands")

_state = {}


# ---------------------------------------------------------------------------
# Colour maths
# ---------------------------------------------------------------------------

def srgb_to_lab(rgb01):
    rgb01 = np.asarray(rgb01, dtype=np.float64)
    c = np.where(rgb01 <= 0.04045, rgb01 / 12.92, ((rgb01 + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    return np.stack([116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])], -1)


def build_ramp(rgb255, pal_lab, usable):
    """(shadow, base, light) palette indices for one flat albedo colour."""
    lab = srgb_to_lab(np.asarray(rgb255, dtype=np.float64) / 255.0)
    pl = pal_lab[:usable]
    w = np.array([1.0, 1.2, 1.2])
    d = np.sqrt((((pl - lab) * w) ** 2).sum(-1))
    base = int(d.argmin())
    lb, ab, bb = pl[base]
    if lb < 16:  # near-black material: nothing darker exists, lift the light band instead
        order = [i for i in np.argsort(pl[:, 0]) if pl[i, 0] > lb + 4]
        return (base, base, int(order[0]) if order else base)

    def pick(dl, hue_shift_b, hue_shift_a, want_lighter):
        ta, tb = ab * 1.0 + hue_shift_a, bb * 1.0 + hue_shift_b
        best, best_s = None, 1e9
        for i in range(usable):
            if i == base:
                continue
            ld = pl[i, 0] - lb
            if want_lighter and ld < 5:
                continue
            if not want_lighter and ld > -5:
                continue
            s = abs(ld - dl) * 1.0 + 1.15 * np.hypot(pl[i, 1] - ta, pl[i, 2] - tb)
            if s < best_s:
                best, best_s = i, s
        return base if best is None else best

    shadow = pick(-17.0, -7.0, -1.0, False)
    light = pick(+15.0, +5.0, 0.0, True)
    return (shadow, base, light)


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------

def _image_pixels(img):
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(img.size[1], img.size[0], 4)[::-1].copy()   # row 0 = TOP of the picture


def flatten_texture(rgba):
    """Replace every swatch by flat colours. Returns (flat image array, list of rgb255 colours used)."""
    h, w, _ = rgba.shape
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
    return out, cols


def make_matcap(path):
    n = 256
    yy, xx = np.mgrid[0:n, 0:n]
    x = (xx + 0.5) / n * 2 - 1
    y = 1 - (yy + 0.5) / n * 2
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    img = np.zeros((n, n, 4), np.float32)
    img[..., 0], img[..., 1], img[..., 2], img[..., 3] = x * 0.5 + 0.5, y * 0.5 + 0.5, z * 0.5 + 0.5, 1
    im = bpy.data.images.new("bands_matcap", n, n, alpha=True)
    im.pixels.foreach_set(img[::-1].ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    return bpy.context.preferences.studio_lights.load(path, "MATCAP")


def prepare(ctx):
    os.makedirs(SCRATCH, exist_ok=True)
    s = ctx.scene
    s.render.engine = "BLENDER_WORKBENCH"
    s.display.render_aa = "OFF"
    s.view_settings.view_transform = "Standard"

    # flattened albedo copies of every texture the knight, and the extra weapons, use
    nodes = []
    all_cols = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image is not None:
                orig = node.image
                flat_px, cols = flatten_texture(_image_pixels(orig))
                flat = bpy.data.images.new(orig.name + "_flat", orig.size[0], orig.size[1], alpha=True)
                flat.pixels.foreach_set(flat_px[::-1].ravel())
                flat.update()
                node.interpolation = "Closest"
                nodes.append((node, orig, flat))
                all_cols.extend(cols)
    uniq = np.unique(np.array(all_cols, dtype=np.int32), axis=0)
    _state["nodes"] = nodes
    _state["mat_rgb"] = uniq                                             # (M, 3) int
    _state["mat_key"] = (uniq[:, 0] << 16) | (uniq[:, 1] << 8) | uniq[:, 2]

    pal_lab = srgb_to_lab(ctx.palette.astype(np.float64) / 255.0)
    _state["pal_lab"] = pal_lab
    lab_m = srgb_to_lab(uniq.astype(np.float64) / 255.0)
    accent = lab_m[:, 0] < 30
    bias = np.zeros(len(uniq), dtype=np.float32)
    for rgb, b in MATERIAL_BIAS.items():
        bias[int(((uniq - np.array(rgb)) ** 2).sum(1).argmin())] = b
    _state["bias"] = bias
    _state["weight"] = np.where(accent, MINORITY_BOOST, 1.0).astype(np.float32)
    ramps = np.array([build_ramp(c, pal_lab, ctx.usable) for c in uniq], dtype=np.uint8)   # (M, 3)
    ramps = apply_ramp_overrides(ramps, uniq, ctx)
    _state["ramps"] = ramps
    # selective outline: a dark colour in the family of each material
    _state["outline"] = np.array([pick_outline(r, pal_lab, ctx.usable) for r in ramps], dtype=np.uint8)

    sl = make_matcap(os.path.join(SCRATCH, "matcap_nrm.png"))
    _state["matcap"] = sl.name


def apply_ramp_overrides(ramps, uniq, ctx):
    ramps = ramps.copy()
    for rgb, ramp in MATERIAL_RAMPS.items():
        d = ((uniq - np.array(rgb)) ** 2).sum(1)
        ramps[int(d.argmin())] = ramp
    return ramps


def pick_outline(ramp, pal_lab, usable):
    """Darkest palette colour that still leans toward the material's shadow hue."""
    sh = pal_lab[ramp[0]]
    best, best_s = BLACK_INDEX, 1e9
    for i in range(usable):
        if pal_lab[i, 0] > 22:
            continue
        s = np.hypot(pal_lab[i, 1] - sh[1], pal_lab[i, 2] - sh[2]) + abs(pal_lab[i, 0] - 8) * 0.6
        if s < best_s:
            best, best_s = i, s
    return best


# ---------------------------------------------------------------------------
# Passes
# ---------------------------------------------------------------------------

def _albedo_pass(ctx, ss):
    sh = ctx.scene.display.shading
    sh.light = "FLAT"
    sh.color_type = "TEXTURE"
    for node, orig, flat in _state["nodes"]:
        node.image = flat
    return ctx.render_rgba(ss=ss)


def _orig_pass(ctx, ss):
    sh = ctx.scene.display.shading
    sh.light = "FLAT"
    sh.color_type = "TEXTURE"
    for node, orig, flat in _state["nodes"]:
        node.image = orig
    return ctx.render_rgba(ss=ss)


def _light_pass(ctx, ss):
    sh = ctx.scene.display.shading
    sh.light = "MATCAP"
    sh.studio_light = _state["matcap"]
    sh.color_type = "SINGLE"
    sh.single_color = (1.0, 1.0, 1.0)
    return ctx.render_rgba(ss=ss)


def _blk(a, h, w, ss):
    return a.reshape(h, ss, w, ss).sum(axis=(1, 3))


def _shift(a, dy, dx, fill):
    """out[y, x] = a[y+dy, x+dx], `fill` outside."""
    out = np.full_like(a, fill)
    h, w = a.shape
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[yd, xd] = a[ys, xs]
    return out


def _mode_of_neighbours(mat_id, present):
    """Most common material among the four neighbours, and how many neighbours share it."""
    nbrs = [_shift(mat_id, dy, dx, -1) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    best = np.full(mat_id.shape, -1, dtype=np.int32)
    best_n = np.zeros(mat_id.shape, dtype=np.int32)
    for m in present:
        c = sum((nb == m).astype(np.int32) for nb in nbrs)
        better = c > best_n
        best = np.where(better, m, best)
        best_n = np.where(better, c, best_n)
    return best, best_n


def render_frame(ctx, size):
    ss = SS[size.id]
    H, W = size.canvas_h, size.canvas_w
    alb = _albedo_pass(ctx, ss)
    nrm = _light_pass(ctx, ss)

    opaque = alb[..., 3] > 0.5
    # material id per sub-pixel
    rgb8 = np.rint(alb[..., :3] * 255).astype(np.int32)
    key = np.where(opaque, (rgb8[..., 0] << 16) | (rgb8[..., 1] << 8) | rgb8[..., 2], -1)
    uk, inv = np.unique(key.ravel(), return_inverse=True)
    mk = _state["mat_key"]
    mrgb = _state["mat_rgb"]
    lut = np.full(len(uk), -1, dtype=np.int32)
    for i, k in enumerate(uk):
        if k < 0:
            continue
        hit = np.nonzero(mk == k)[0]
        if len(hit):
            lut[i] = hit[0]
        else:
            r, g, b = (k >> 16) & 255, (k >> 8) & 255, k & 255
            lut[i] = int(((mrgb - np.array([r, g, b])) ** 2).sum(1).argmin())
    mat = lut[inv].reshape(opaque.shape)

    # key light per sub-pixel
    n = nrm[..., :3] * 2.0 - 1.0
    lam = (n * LIGHT_DIR).sum(-1)
    if GRADIENT_K:
        orig = _orig_pass(ctx, ss)
        lum = np.array([0.30, 0.59, 0.11], dtype=np.float32)
        lam = lam + GRADIENT_K * ((orig[..., :3] - alb[..., :3]) * lum).sum(-1)

    mem = getattr(ctx, "mem", None)
    on = mem is not None and mem.active
    cover = _blk(opaque.astype(np.float32), H, W, ss) / float(ss * ss)
    if on:
        solid = mem.level("solid", cover, (COVER_THRESHOLD,), COVER_MARGIN) > 0
    else:
        solid = cover >= COVER_THRESHOLD

    present = [int(m) for m in np.unique(mat) if m >= 0]
    counts = np.zeros((len(present), H, W), dtype=np.float32)
    lsum = np.zeros((len(present), H, W), dtype=np.float32)
    for j, m in enumerate(present):
        msk = mat == m
        counts[j] = _blk(msk.astype(np.float32), H, W, ss)
        lsum[j] = _blk(np.where(msk, lam, 0.0).astype(np.float32), H, W, ss) + _state["bias"][m] * counts[j]
    weights = np.array([_state["weight"][m] for m in present], dtype=np.float32)[:, None, None]
    if on:
        prev_lab = mem.get("mat")
        lab, win = mem.hold("mat", np.asarray(present), counts * weights)
    else:
        win = (counts * weights).argmax(0)
    wcount = np.take_along_axis(counts, win[None], 0)[0]
    wlight = np.take_along_axis(lsum, win[None], 0)[0] / np.maximum(wcount, 1.0)
    mat_id = np.asarray(present, dtype=np.int32)[win]
    conf = wcount / np.maximum(cover * ss * ss, 1.0)          # how much of the block's solid area is the winner

    if on:
        band = mem.level("band", wlight, BAND_CUTS, BAND_MARGIN, None if prev_lab is None else prev_lab == lab).astype(np.int32)
    else:
        band = np.where(wlight < BAND_CUTS[0], 0, np.where(wlight < BAND_CUTS[1], 1, 2)).astype(np.int32)
    mat_id = np.where(solid, mat_id, -1)

    solid, mat_id, band = cleanup(solid, mat_id, band, conf, present)

    ramps = _state["ramps"]
    out = np.full((H, W), TRANSPARENT, dtype=np.uint8)
    out[solid] = ramps[mat_id[solid], band[solid]]

    # 1px outline, outside the silhouette (4-neighbour)
    nb = np.zeros_like(solid)
    src = np.full(solid.shape, -1, dtype=np.int32)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        sh_solid = _shift(solid, dy, dx, False)
        sh_mat = _shift(mat_id, dy, dx, -1)
        take = sh_solid & ~solid & ~nb
        src[take] = sh_mat[take]
        nb |= sh_solid & ~solid
    ol = nb
    if OUTLINE_MODE == "selout":
        out[ol] = _state["outline"][src[ol]]
    else:
        out[ol] = BLACK_INDEX
    return out


def cleanup(solid, mat_id, band, conf, present):
    four = ((-1, 0), (1, 0), (0, -1), (0, 1))

    # pinholes: an empty pixel with solid on all four sides takes the neighbours' material
    around = sum(_shift(solid, dy, dx, False).astype(np.int32) for dy, dx in four)
    hole = ~solid & (around == 4)
    if hole.any():
        best, _ = _mode_of_neighbours(mat_id, present)
        mat_id = np.where(hole, best, mat_id)
        band = np.where(hole, 1, band)
        solid = solid | hole

    # orphan pixels: solid with no 8-neighbour solid
    nbr = np.zeros(solid.shape, dtype=np.int32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                nbr += _shift(solid, dy, dx, False)
    solid = solid & (nbr > 0)
    mat_id = np.where(solid, mat_id, -1)

    # material speckle: a pixel whose material matches none of its neighbours while three of them agree on another,
    # and which only narrowly won its block, takes the neighbours' material
    best, best_n = _mode_of_neighbours(mat_id, present)
    same = sum((_shift(mat_id, dy, dx, -2) == mat_id).astype(np.int32) for dy, dx in four)
    flip = solid & (same == 0) & (best_n >= 3) & (conf < SPECKLE_CONF) & (best >= 0)
    mat_id = np.where(flip, best, mat_id)

    # band speckle: a pixel none of whose same-material neighbours share its band, while three or more of them agree
    # on another band, takes that band
    same_mat = [(_shift(mat_id, dy, dx, -2) == mat_id) for dy, dx in four]
    nbands = [_shift(band, dy, dx, -1) for dy, dx in four]
    same_band = sum((m & (b == band)).astype(np.int32) for m, b in zip(same_mat, nbands))
    new_band = band.copy()
    for target in (0, 1, 2):
        votes = sum((m & (b == target)).astype(np.int32) for m, b in zip(same_mat, nbands))
        new_band = np.where(solid & (same_band == 0) & (votes >= 3) & (band != target), target, new_band)
    return solid, mat_id, new_band
