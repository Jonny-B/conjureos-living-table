"""
Pixel artist: treat the 3D render as a sketch and apply the rules a pixel artist
would.

Two passes per frame at 8x the sprite size (Workbench, no anti-aliasing):

  ID pass      every object's texture is swapped for an ID texture, so each
               sub-pixel says which swatch of the KayKit palette texture it
               belongs to (steel, skin, leather, cape red...), where it sits in
               that swatch's baked top-to-bottom gradient, and which mesh part
               it is (helmet, arm, sword...).
  Normal pass  a custom "matcap" that paints the view-space surface normal as a
               colour, so lighting can be computed in numpy with a fixed
               upper-left light, the way SNES sprites are lit.

Everything after that is numpy, at sprite resolution:
  silhouette   coverage threshold (weapons count double, so a blade or haft
               under a pixel wide survives), a ridge rule that keeps 1px thin
               lines, hole and notch filling, orphan and spur removal, and a
               pixel-perfect pass that drops the corner of L-shaped doubles.
  material     the dominant swatch class per pixel (steel, skin, leather,
               cape red, gold, dark), priority weighted so eyes and buckles
               survive, then single-pixel class islands are tidied away.
  shading      a fixed upper-left light on the view-space normal (camera pitch
               undone), plus the texture's baked gradient, quantised to three
               tones of a short palette ramp, median filtered per mesh part.
  lines        crease lines where two mesh parts meet, one-pixel cream
               highlights on the light-facing silhouette edge of metal (runs
               capped at three), and a selective outline: outside the
               silhouette, two steps darker than the pixel it borders on the
               lit side and three on the shadow side, never flat black.

The processing (process()) is pure numpy so it can be tuned offline on dumped
passes; only prepare() and the render helpers touch Blender.
"""
import os

import numpy as np

LABEL = "Pixel artist"
DESCRIPTION = ("8x supersampled, lit in numpy, then pixel-art rules: clean silhouette keeping thin weapons, "
               "sel-out outline, short palette ramps per material, edge highlights, cleanup of stray pixels.")

TRANSPARENT = 255
SS = 8

_STATE = {}
HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# Palette ramps. Each is [highlight, light, mid, dark, deep] (palette indices).
# ---------------------------------------------------------------------------
# name: (ramp, line_lit, line_shadow)
RAMPS = {
    "steel":   ([5, 8, 32, 33, 7], 7, 12),
    "skin":    ([4, 4, 36, 37, 37], 37, 1),
    "leather": ([44, 2, 35, 45, 1], 45, 1),
    "red":     ([42, 15, 43, 10, 10], 10, 10),
    "gold":    ([46, 13, 13, 35, 1], 35, 1),
    "dark":    ([6, 6, 0, 0, 0], 6, 0),
}
CLASS_NAMES = ["steel", "skin", "leather", "red", "gold", "dark"]


def classify_color(rgb):
    """Map a swatch's mean colour (0..1 rgb) to a material class name."""
    r, g, b = [float(x) for x in rgb]
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
    if v < 0.22:
        return "dark"
    if sat < 0.16:
        return "steel"            # grey, white, taupe-grey: all read as steel
    if hue >= 340 or hue < 8:
        return "red"
    if 38 <= hue <= 62 and sat > 0.55:
        return "gold"
    if sat < 0.38 and v > 0.8:
        return "skin"             # pale peach
    if 12 <= hue < 38 and sat < 0.5 and v >= 0.78:
        return "skin"
    return "leather"


# ---------------------------------------------------------------------------
# Blender side
# ---------------------------------------------------------------------------

def _cell_table(img_pixels):
    """img_pixels: (1024,1024,4) float, bottom-up. Returns per cell (col + row*8, row 0 at the top):
    mean colour of the swatch body and its mean luminance."""
    h = img_pixels.shape[0]
    top_down = img_pixels[::-1]
    cw, ch = h // 8, h // 4
    out = []
    for row in range(4):
        for col in range(8):
            cell = top_down[row * ch:(row + 1) * ch, col * cw + 4:col * cw + int(cw * 0.78), :3]
            out.append(cell.reshape(-1, 3).mean(0))
    return out


def prepare(ctx):
    import bpy
    s = ctx.scene
    s.render.engine = "BLENDER_WORKBENCH"
    s.display.render_aa = "OFF"
    s.render.image_settings.compression = 0
    s.render.dither_intensity = 0.0  # dither noise would corrupt the ID pass
    s.display.shading.show_object_outline = False
    s.display.shading.show_cavity = False
    s.display.shading.show_shadows = False
    s.display.shading.show_specular_highlight = False

    # -- swatch classes per source texture -----------------------------------
    src_images = {}
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                src_images[n.image.name] = n.image
    names = sorted(src_images)
    tex_classes = {}
    for ti, name in enumerate(names):
        im = src_images[name]
        w, h = im.size
        px = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        cells = _cell_table(px)
        tex_classes[ti] = [(classify_color(c), float(c @ np.array([0.299, 0.587, 0.114]))) for c in cells]
    _STATE["tex_classes"] = tex_classes
    _STATE["tex_names"] = names

    # -- ID textures, one per mesh object (B channel carries the object id) --
    size = 1024
    yy, xx = np.mgrid[0:size, 0:size]
    top_y = (size - 1) - yy                      # image row from the top
    cell = (xx // (size // 8)) + (top_y // (size // 4)) * 8
    y_in_cell = top_y % (size // 4)
    obj_ids = {}
    mesh_objs = [o for o in ctx.objects.values() if o.type == "MESH" and len(o.data.materials) > 0]
    mesh_objs.sort(key=lambda o: o.name)
    for oi, ob in enumerate(mesh_objs, start=1):
        obj_ids[oi] = ob.name
        for si, mat in enumerate(list(ob.data.materials)):
            if mat is None or not mat.use_nodes:
                continue
            tex_nodes = [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image is not None]
            if not tex_nodes:
                continue
            ti = names.index(tex_nodes[0].image.name)
            arr = np.zeros((size, size, 4), np.float32)
            arr[..., 0] = (ti * 32 + cell) / 255.0
            arr[..., 1] = y_in_cell / 255.0
            arr[..., 2] = oi / 255.0
            arr[..., 3] = 1.0
            img = bpy.data.images.new(f"pa_id_{ob.name}_{si}", size, size, alpha=True)
            img.colorspace_settings.name = "Non-Color"
            img.pixels.foreach_set(arr.ravel())
            img.update()
            m2 = mat.copy()
            m2.name = f"pa_{ob.name}_{si}"
            for n in m2.node_tree.nodes:
                if n.type == "TEX_IMAGE":
                    n.image = img
                    n.interpolation = "Closest"
            ob.data.materials[si] = m2
    _STATE["obj_names"] = obj_ids

    # -- normal matcap ---------------------------------------------------------
    n = 512
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    nx = (xx + 0.5) / n * 2 - 1
    ny = (yy + 0.5) / n * 2 - 1
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
    rgba = np.ones((n, n, 4), np.float32)
    rgba[..., 0] = nx * 0.5 + 0.5
    rgba[..., 1] = ny * 0.5 + 0.5
    rgba[..., 2] = nz
    mimg = bpy.data.images.new("pa_normal_matcap", n, n, alpha=True)
    mimg.colorspace_settings.name = "sRGB"
    mimg.pixels.foreach_set(rgba.ravel())
    scratch = os.path.join(os.getcwd(), ".cache", "kaykit", "scratch", "pixelart")
    os.makedirs(scratch, exist_ok=True)
    mpath = os.path.join(scratch, "normal_matcap.png")
    mimg.filepath_raw = mpath
    mimg.file_format = "PNG"
    mimg.save()
    sl = bpy.context.preferences.studio_lights.load(mpath, "MATCAP")
    _STATE["matcap"] = sl.name


def _set_pass(ctx, which):
    s = ctx.scene
    sh = s.display.shading
    if which == "id":
        sh.light = "FLAT"
        sh.color_type = "TEXTURE"
        s.view_settings.view_transform = "Raw"
    else:
        sh.light = "MATCAP"
        sh.studio_light = _STATE["matcap"]
        sh.color_type = "SINGLE"
        sh.single_color = (1.0, 1.0, 1.0)
        s.view_settings.view_transform = "Standard"


def render_passes(ctx, ss=SS):
    """Returns dict of arrays at ss x canvas resolution, row 0 at the top."""
    _set_pass(ctx, "id")
    a = ctx.render_rgba(ss)
    idp = np.rint(a * 255.0).astype(np.int16)
    _set_pass(ctx, "normal")
    b = ctx.render_rgba(ss)
    alpha = a[..., 3] >= 0.5
    tex = (idp[..., 0] >> 5) & 3
    cell = idp[..., 0] & 31
    return {
        "alpha": alpha,
        "tex": tex.astype(np.uint8),
        "cell": cell.astype(np.uint8),
        "gy": idp[..., 1].astype(np.uint8),
        "obj": idp[..., 2].astype(np.uint8),
        "n": b[..., :3].astype(np.float16),
    }


def render_frame(ctx, size):
    p = render_passes(ctx)
    cls = _class_tables()
    return process(p, size.canvas_h, size.canvas_w, ctx.palette, cls, facing=ctx.facing)


def _class_tables():
    if "cls" in _STATE:
        return _STATE["cls"]
    tc = _STATE["tex_classes"]
    n_tex = max(tc) + 1 if tc else 1
    cls_id = np.zeros((4, 32), np.uint8)
    lum = np.zeros((4, 32), np.float32)
    for ti in range(n_tex):
        for c, (name, l) in enumerate(tc[ti]):
            cls_id[ti, c] = CLASS_NAMES.index(name)
            lum[ti, c] = l
    _STATE["cls"] = {"cls_id": cls_id, "lum": lum, "obj_names": _STATE["obj_names"]}
    return _STATE["cls"]


# ---------------------------------------------------------------------------
# Pure numpy processing (tunable offline)
# ---------------------------------------------------------------------------

# Tunables
T_COVER = 0.46          # coverage needed for a pixel to be solid
T_THIN = 0.13           # coverage needed for a thin-line ridge pixel
WEAPON_BOOST = 2.0      # weapon coverage counts double so 1px blades and hafts survive the threshold
WEAPON_WORDS = ("sword", "axe", "crossbow", "staff")
PITCH = np.radians(30.0)   # the harness camera looks down this far; lighting is done in the upright frame
LIGHT = np.array([-0.70, 0.50, 0.50], np.float32)
LIGHT /= np.linalg.norm(LIGHT)
CLASS_PRIO = np.array([1.0, 1.5, 0.8, 1.0, 1.3, 2.4], np.float32)   # CLASS_NAMES order: steel skin leather red gold dark
CLASS_BIAS = np.array([0.0, 0.20, 0.0, 0.0, 0.05, 0.0], np.float32)  # skin is kept light so faces read
LEVEL_T = (0.76, 0.46, 0.30)   # val thresholds for light / mid / dark (else deep)
W_LIT, W_AO, W_TONE = 0.72, 0.22, 0.9
HILITE_LIT = 0.84
MEDIAN_PASSES = 1
HILITE_RUN = 3          # longest straight run of highlight pixels
OUTLINE_LIT_STEPS, OUTLINE_SHADE_STEPS = 2, 3

STEEL, SKIN, LEATHER, RED, GOLD, DARK = range(6)


def sh(a, dy, dx, fill=0):
    """out[y, x] = a[y + dy, x + dx], with `fill` outside."""
    h, w = a.shape[:2]
    out = np.full_like(a, fill)
    ys0, ys1 = max(0, -dy), min(h, h - dy)
    xs0, xs1 = max(0, -dx), min(w, w - dx)
    if ys1 > ys0 and xs1 > xs0:
        out[ys0:ys1, xs0:xs1] = a[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx]
    return out


def nb4(a, fill=0):
    return sh(a, -1, 0, fill), sh(a, 1, 0, fill), sh(a, 0, -1, fill), sh(a, 0, 1, fill)   # up, down, left, right


def count8(m):
    c = np.zeros(m.shape, np.int16)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                c += sh(m, dy, dx, False)
    return c


def count4(m):
    u, d, l, r = nb4(m, False)
    return u.astype(np.int16) + d + l + r


def cap_runs(mask, n):
    """Keep at most n pixels of any straight (vertical or horizontal) run, so a rim light breaks up instead of
    becoming a solid white stripe."""
    out = mask.copy()
    for axis in (0, 1):
        m = mask if axis == 0 else mask.T
        o = out if axis == 0 else out.T
        run = np.zeros(m.shape[1], np.int16)
        for y in range(m.shape[0]):
            run = np.where(m[y], run + 1, 0)
            o[y] &= ~(run > n)
    return out


def pixel_perfect(mask):
    """Thin 1px diagonal lines: drop the corner pixel of an L-shaped double (a pixel with exactly two solid
    4-neighbours at a right angle whose inside diagonal is empty). Raster order, so a long staircase thins evenly."""
    m = mask.copy()
    H, W = m.shape
    pad = np.zeros((H + 2, W + 2), bool)
    pad[1:-1, 1:-1] = m
    cnt = count4(m)
    ys, xs = np.nonzero(m & (cnt == 2))
    for y, x in zip(ys.tolist(), xs.tolist()):
        py, px = y + 1, x + 1
        u, d, l, r = pad[py - 1, px], pad[py + 1, px], pad[py, px - 1], pad[py, px + 1]
        if (u or d) and (l or r) and (u + d + l + r) == 2:
            dy = -1 if u else 1
            dx = -1 if l else 1
            if not pad[py + dy, px + dx]:
                pad[py, px] = False
    return pad[1:-1, 1:-1]


def block_sum(a, H, W, ss):
    return a.reshape(H, ss, W, ss, *a.shape[2:]).sum(axis=(1, 3))


def aggregate(p, H, W, cls):
    """Per-sprite-pixel facts from the 8x passes."""
    alpha = p["alpha"]
    ss = alpha.shape[0] // H
    cid = cls["cls_id"][p["tex"], p["cell"]]
    cell_lum = cls["lum"][p["tex"], p["cell"]]
    nraw = p["n"].astype(np.float32)
    nx, ny, nz = nraw[..., 0] * 2 - 1, nraw[..., 1] * 2 - 1, nraw[..., 2]
    nl = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
    nx, ny, nz = nx / nl, ny / nl, nz / nl
    n_sub = float(ss * ss)
    a_f = alpha.astype(np.float32)
    cnt = block_sum(a_f, H, W, ss)
    safe = np.maximum(cnt, 1.0)
    cc = np.stack([block_sum((alpha & (cid == k)).astype(np.float32), H, W, ss) for k in range(6)], -1)
    objs = np.unique(p["obj"][alpha])
    oc = np.stack([block_sum((alpha & (p["obj"] == o)).astype(np.float32), H, W, ss) for o in objs], -1)
    weapon_ids = [int(k) for k, v in cls["obj_names"].items() if any(w in v.lower() for w in WEAPON_WORDS)]
    wcnt = block_sum((alpha & np.isin(p["obj"], weapon_ids)).astype(np.float32), H, W, ss)
    a = {
        "cnt": cnt,
        "cov": np.minimum(1.0, np.maximum(cnt, WEAPON_BOOST * wcnt) / n_sub),
        "cls": np.argmax(cc * CLASS_PRIO, -1).astype(np.uint8),
        "obj": objs[np.argmax(oc, -1)].astype(np.int16),
        "gy": block_sum(p["gy"].astype(np.float32) * a_f, H, W, ss) / safe / 255.0,
        "lum": block_sum(cell_lum * a_f, H, W, ss) / safe,
    }
    mnx = block_sum(nx * a_f, H, W, ss) / safe
    mny = block_sum(ny * a_f, H, W, ss) / safe
    mnz = block_sum(nz * a_f, H, W, ss) / safe
    mn = np.sqrt(mnx ** 2 + mny ** 2 + mnz ** 2) + 1e-6
    mnx, mny, mnz = mnx / mn, mny / mn, mnz / mn
    # undo the camera pitch so a wall facing the viewer has normal (0, 0, 1)
    uy = mny * np.cos(PITCH) + mnz * np.sin(PITCH)
    uz = -mny * np.sin(PITCH) + mnz * np.cos(PITCH)
    a["lit"] = mnx * LIGHT[0] + uy * LIGHT[1] + uz * LIGHT[2]
    return a


def silhouette(a):
    cov = a["cov"]
    up, dn, lf, rt = nb4(cov)
    base = cov >= T_COVER
    cand = (cov >= T_THIN) & ~base
    ridge = ((cov > lf) & (cov >= rt)) | ((cov > up) & (cov >= dn))
    thin = cand & ridge
    solid = base | thin
    for _ in range(2):
        # notches: an empty pixel hemmed in on three or four sides
        notch = ~solid & (count4(solid) >= 3)
        solid = solid | notch
        # spurs and specks: a weak pixel with at most one solid neighbour, unless it is a deliberate thin line
        weak = solid & ~thin & (cov < 0.75) & (count4(solid) <= 1)
        solid = solid & ~weak
    orphan = solid & (count8(solid) == 0)
    solid = solid & ~orphan
    solid = pixel_perfect(solid)
    return solid, thin


def inherit(a, solid, keys):
    """Pixels the silhouette added (no sub-pixel samples) take their attributes from a neighbour that has them."""
    have = solid & (a["cnt"] > 0)
    need = solid & (a["cnt"] == 0)
    for (dy, dx) in ((0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (-1, 1), (1, -1), (1, 1)):
        if not need.any():
            break
        take = need & sh(have, dy, dx, False)
        for k in keys:
            a[k][take] = sh(a[k], dy, dx)[take]
        need = need & ~take


def tidy_classes(cls_map, obj_map, solid, passes=2):
    """No single-pixel islands of steel, skin or leather inside a bigger region of something else."""
    removable = np.isin(cls_map, (STEEL, SKIN, LEATHER))
    for _ in range(passes):
        counts = []
        for k in range(6):
            counts.append(count4(solid & (cls_map == k)))
        counts = np.stack(counts, 0)
        own = np.take_along_axis(counts, cls_map[None].astype(np.int64), 0)[0]
        other = counts.copy()
        for k in range(6):
            other[k][cls_map == k] = 0
        best = other.argmax(0)
        bestn = other.max(0)
        flip = solid & removable & (((own == 0) & (bestn >= 2)) | ((own == 1) & (bestn >= 3))) & np.isin(best, (STEEL, SKIN, LEATHER, RED))
        cls_map = np.where(flip, best, cls_map).astype(np.uint8)
    return cls_map


def process(p, H, W, palette, cls, facing="down"):
    if not p["alpha"].any():
        return np.full((H, W), TRANSPARENT, np.uint8)
    a = aggregate(p, H, W, cls)
    solid, thin = silhouette(a)
    inherit(a, solid, ("cls", "obj", "lit", "gy", "lum"))
    pix_cls = tidy_classes(a["cls"], a["obj"], solid)
    pix_obj = a["obj"]

    # -- shade value and ramp level (1 light, 2 mid, 3 dark, 4 deep; 0 is the highlight, placed later)
    lit01 = np.clip((a["lit"] + 0.35) / 1.15, 0, 1)
    ref_lum = np.array([0.62, 0.85, 0.5, 0.4, 0.65, 0.1], np.float32)[pix_cls]
    val = W_LIT * lit01 + W_AO * (1 - a["gy"]) + W_TONE * (a["lum"] - ref_lum) * 0.5 + CLASS_BIAS[pix_cls]
    # soften: blend with same-object neighbours so the form shading wins over facet noise
    acc = val * 2.0
    wsum = np.full(val.shape, 2.0, np.float32)
    for v_n, o_n, s_n in zip(nb4(val), nb4(pix_obj, -1), nb4(solid, False)):
        ok = s_n & (o_n == pix_obj)
        acc += np.where(ok, v_n, 0)
        wsum += ok
    val = 0.5 * val + 0.5 * acc / wsum
    level = np.full(val.shape, 3, np.int16)      # the deep step (4) is only for crease lines; fills use three tones
    level[val >= LEVEL_T[1]] = 2
    level[val >= LEVEL_T[0]] = 1

    # median of self and same-object neighbours: removes facet noise, smooths level contours
    for _ in range(MEDIAN_PASSES):
        ups, dns, lfs, rts = nb4(level, -1)
        uo, do, lo, ro = nb4(pix_obj, -1)
        stack = [level]
        for l_n, o_n in ((ups, uo), (dns, do), (lfs, lo), (rts, ro)):
            stack.append(np.where((o_n == pix_obj) & (l_n > 0), l_n, level))
        level = np.sort(np.stack(stack, 0), 0)[2].astype(np.int16)

    # -- crease lines: where two mesh parts meet, the darker side gets the deep step (sel-out inside the figure)
    crease = np.zeros(solid.shape, bool)
    for v_n, o_n, s_n in zip(nb4(val), nb4(pix_obj, -1), nb4(solid, False)):
        crease |= s_n & (o_n != pix_obj) & (val < v_n - 0.04)
    crease &= np.isin(pix_cls, (STEEL, LEATHER, RED)) & ~thin
    level = np.where(crease, np.maximum(level, 4), level)

    # -- colours
    out = np.full((H, W), TRANSPARENT, np.uint8)
    ramp_tab = np.array([RAMPS[n][0] for n in CLASS_NAMES], np.uint8)      # (6,5)
    lit_line = np.array([RAMPS[n][1] for n in CLASS_NAMES], np.uint8)
    sh_line = np.array([RAMPS[n][2] for n in CLASS_NAMES], np.uint8)
    col = ramp_tab[pix_cls, level]
    out[solid] = col[solid]

    # -- highlights: one pixel on light-facing edges of metal
    u4, d4, l4, r4 = nb4(solid, False)
    ou, od, ol, orr = nb4(pix_obj, -1)
    edge_tl = (~u4) | (~l4)
    hi = solid & (pix_cls == STEEL) & (level <= 2) & (a["lit"] > HILITE_LIT) & edge_tl & ~crease
    hu, hd, hl, hr = nb4(hi, False)
    hi = hi & ~(hl & hu)
    hi = cap_runs(hi, HILITE_RUN)
    out[hi] = ramp_tab[STEEL, 0]

    # -- outline (outside the silhouette), selective: darker shade of what it borders
    ring = ~solid & (u4 | d4 | l4 | r4)
    oline = np.zeros((H, W), np.uint8)
    best = np.full((H, W), -9.0, np.float32)
    for (dy, dx, lit_side) in ((1, 0, True), (0, 1, True), (-1, 0, False), (0, -1, False)):
        nsol = sh(solid, dy, dx, False)
        ncls = sh(pix_cls, dy, dx, 0)
        nlev = sh(level, dy, dx, 4)
        # two steps darker than the pixel it borders on the lit side, three on the shadow side
        idx = nlev + (OUTLINE_LIT_STEPS if lit_side else OUTLINE_SHADE_STEPS)
        line = np.where(idx <= 4, ramp_tab[ncls, np.minimum(idx, 4)], sh_line[ncls])
        rank = 1.0 if lit_side else 0.5
        take = ring & nsol & (best < rank)
        oline[take] = line[take]
        best[take] = rank
    out[ring] = oline[ring]

    # sole: the bottom row of the canvas is the ground line, so the outline goes inside
    bottom = solid.copy()
    bottom[:-1] = False
    out[bottom] = sh_line[pix_cls][bottom]
    return out
