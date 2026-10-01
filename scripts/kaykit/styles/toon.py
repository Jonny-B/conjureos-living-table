"""
Toon: a real cel shader plus an inverted-hull outline, rendered in EEVEE at a
small supersample and majority-voted down to the sprite grid.

prepare() rebuilds every material as a banded toon shader:
  * the KayKit colour atlas is flattened to one colour per swatch (the atlas
    has a baked vertical gradient in each swatch, which would fight the bands),
  * every swatch gets a four step ramp (outline, shadow, mid, light) picked
    from the game palette in OKLab, so the renderer only ever emits exact
    palette colours and no hue drift can happen after the fact,
  * a sun lamp lights a Diffuse BSDF, Shader to RGB turns that into a number,
    and a CONSTANT colour ramp plus two greater-than tests pick which of the
    three lit bands a pixel belongs to; a Glossy BSDF through the same trick
    adds a one pixel glint colour on metal,
  * the band thresholds, outline width and glint are set per sprite size.
An outline comes from a Solidify modifier with flipped normals and a back face
culled material that shows the swatch's own darkest ramp colour. Its thickness
is set per sprite size in world units, a bit under one output pixel wide.
Frames are rendered with no anti-aliasing at 4x and reduced by a weighted
majority vote per output pixel (deterministic: no noise, ties go to the lowest
palette index).
"""
import os

import bpy
import numpy as np
from mathutils import Vector

LABEL = "Toon"
DESCRIPTION = ("EEVEE cel shading (three palette bands plus a metal glint) with an inverted-hull outline, "
               "rendered at 4x and majority-voted down to the sprite grid.")

TRANSPARENT = 255

# ---- tuning ---------------------------------------------------------------
SS = 4                      # supersample factor before the majority vote
SPEC_ROUGHNESS = 0.35
SPEC_T = 0.6                # glossy value above which a metal pixel gets its glint colour (per size: "spec_t")
# Per sprite size: outline width in output pixels, the diffuse thresholds for the mid and light bands, the glossy
# threshold for the glint, and how much the outline colours count in the majority vote (above 1 a thin outline
# stays a continuous line; "interior_weight", if present, is used inside the figure instead, and below 1 it drops
# faint creases that would otherwise turn a 16x24 body into ink).
SIZE_PARAMS = {
    "16x24": {"spec_t": 0.8, "outline_px": 0.65, "t_mid": 0.10, "t_light": 0.62, "outline_weight": 1.3, "interior_weight": 0.6},
    "32x48": {"spec_t": SPEC_T, "outline_px": 0.85, "t_mid": 0.22, "t_light": 0.68, "outline_weight": 1.3},
    "48x72": {"spec_t": SPEC_T, "outline_px": 1.0, "t_mid": 0.22, "t_light": 0.68, "outline_weight": 1.2},
}
LIGHT_DIR = (-0.62, -0.42, 0.66)   # direction TO the light, in world (x right, y away from camera, z up)
SUN_ANGLE = 0.0
SUN_STRENGTH = 3.14159      # so a face square to the sun reads about 1.0 after Shader to RGB
AMBIENT = 0.0

# Texture atlas layout shared by every KayKit Adventurers texture.
ATLAS = 1024
CELL_W, CELL_H = 128, 256
STRIP_X0 = 104              # the narrow edge strip starts here inside a swatch


# ---- colour maths ----------------------------------------------------------

def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_oklab(rgb):
    lin = srgb_to_linear(rgb)
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.stack([
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ], axis=-1)


# Hand-built ramps from the game palette, dark to light. A swatch is assigned to the nearest family by hue
# and chroma, then three consecutive steps around its own lightness become the shadow, mid and light bands.
FAMILIES = {
    "steel": [7, 33, 41, 32, 8, 5],
    "sky": [20, 21, 22, 23, 14],
    "grey": [24, 25, 26, 27],
    "ink": [0, 6, 24, 25],
    "green": [16, 39, 38, 11],
    "rust": [1, 45, 37, 2, 36],
    "tan": [28, 29, 30, 31, 3],
    "skin": [37, 36, 4, 5],
    "gold": [35, 47, 13, 46],
    "red": [10, 43, 15, 42],
}
# Outline colour per family: the dark end of the same hue.
OUTLINE_FOR = {"steel": 12, "sky": 12, "grey": 0, "ink": 0, "green": 9, "rust": 1, "tan": 1, "skin": 1,
               "gold": 1, "red": 10}
# Steps below the nearest member to start the mid band (skin reads better a notch down).
SHINY = {"steel", "sky"}
MID_BIAS = {"skin": 0, "red": 1}


def choose_family(lab, pal_lab):
    L, a, b = lab
    chroma = float(np.hypot(a, b))
    hue = float(np.degrees(np.arctan2(b, a)) % 360)
    if chroma < 0.030:                      # near neutral: keep metal cool, keep darks dark
        if L < 0.27:
            return "ink"
        if 30 < hue < 100 and chroma > 0.012:
            return "grey"
        return "steel"
    best, best_d = None, 1e9
    for name, members in FAMILIES.items():
        if name in ("ink", "grey"):
            continue
        d = pal_lab[members] - lab
        dist = (0.3 * d[:, 0] ** 2 + 2.0 * (d[:, 1] ** 2 + d[:, 2] ** 2)).min()
        if dist < best_d:
            best, best_d = name, dist
    return best


def ramp_for(albedo_rgb, pal_lab):
    """(outline, shadow, mid, light) palette indices for one flat swatch colour (sRGB 0..1)."""
    lab = to_oklab(np.asarray(albedo_rgb))
    fam = choose_family(lab, pal_lab)
    members = sorted(FAMILIES[fam], key=lambda i: pal_lab[i, 0])
    Ls = np.array([pal_lab[i, 0] for i in members])
    i = int(np.abs(Ls - lab[0]).argmin())
    i -= MID_BIAS.get(fam, 0)
    i = max(1, min(len(members) - 2, i))
    light = members[i + 1]
    # Metals get a fifth, brightest step for the glint; everything else just repeats its light step.
    spec = members[i + 2] if fam in SHINY and i + 2 < len(members) else light
    return OUTLINE_FOR[fam], members[i - 1], members[i], light, spec


# ---- atlas flattening ------------------------------------------------------

def flatten_atlas(px):
    """px: (ATLAS, ATLAS, 3) float sRGB, row 0 at the TOP. Returns (cells, strips): per-cell mean colours
    (rows, cols, 3) for the body of each swatch and for its edge strip."""
    cols, rows = ATLAS // CELL_W, ATLAS // CELL_H
    body = np.zeros((rows, cols, 3))
    strip = np.zeros((rows, cols, 3))
    for cy in range(rows):
        for cx in range(cols):
            x0, y0 = cx * CELL_W, cy * CELL_H
            body[cy, cx] = px[y0 + 24:y0 + 232, x0 + 8:x0 + STRIP_X0 - 6].reshape(-1, 3).mean(0)
            strip[cy, cx] = px[y0 + 40:y0 + 216, x0 + STRIP_X0 + 6:x0 + CELL_W - 6].reshape(-1, 3).mean(0)
    return body, strip


def paint_atlas(body_idx, strip_idx, palette_u8):
    """body_idx / strip_idx: (rows, cols) palette indices. Returns a (ATLAS, ATLAS, 3) float32 image, row 0 top."""
    rows, cols = body_idx.shape
    img = np.zeros((ATLAS, ATLAS, 3), np.float32)
    for cy in range(rows):
        for cx in range(cols):
            x0, y0 = cx * CELL_W, cy * CELL_H
            img[y0:y0 + CELL_H, x0:x0 + CELL_W] = palette_u8[body_idx[cy, cx]] / 255.0
            img[y0 + 16:y0 + CELL_H - 16, x0 + STRIP_X0:x0 + CELL_W] = palette_u8[strip_idx[cy, cx]] / 255.0
    return img


def make_image(name, rgb_top_first):
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "sRGB"
    rgba = np.ones((ATLAS, ATLAS, 4), np.float32)
    rgba[..., :3] = rgb_top_first[::-1]          # Blender images are bottom row first
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    return img


# ---- node plumbing ---------------------------------------------------------

def image_node(nt, img, ext, loc):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    n.interpolation = "Closest"
    n.extension = ext
    n.location = loc
    return n


def mix_node(nt, loc):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = "MIX"
    n.clamp_factor = True
    n.location = loc
    return n


def build_toon_material(src, imgs):
    """src: the glTF material; imgs: dict band -> image. Returns (toon_mat, hull_mat)."""
    ext = "REPEAT"
    for n in src.node_tree.nodes:
        if n.bl_idname == "ShaderNodeTexImage":
            ext = n.extension
    toon = bpy.data.materials.new(src.name + "_toon")
    toon.use_nodes = True
    nt = toon.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (1200, 0)
    emis = nt.nodes.new("ShaderNodeEmission")
    emis.location = (1000, 0)

    t_shadow = image_node(nt, imgs["shadow"], ext, (200, 300))
    t_mid = image_node(nt, imgs["mid"], ext, (200, 0))
    t_light = image_node(nt, imgs["light"], ext, (200, -300))

    diffuse = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (1, 1, 1, 1)
    diffuse.inputs["Roughness"].default_value = 0.0
    diffuse.location = (-600, 600)
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    s2r.location = (-400, 600)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-200, 600)
    ramp = nt.nodes.new("ShaderNodeValToRGB")          # the banding step: a CONSTANT colour ramp
    ramp.location = (0, 600)
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    e1 = ramp.color_ramp.elements.new(0.22)
    e1.color = (0.5, 0.5, 0.5, 1)
    e2 = ramp.color_ramp.elements.new(0.68)
    e2.color = (1, 1, 1, 1)
    _ramp_elements.append((ramp.color_ramp.elements[0], e1, e2))
    sep2 = nt.nodes.new("ShaderNodeSeparateColor")
    sep2.location = (200, 600)
    g1 = nt.nodes.new("ShaderNodeMath")
    g1.operation = "GREATER_THAN"
    g1.inputs[1].default_value = 0.25
    g1.location = (400, 700)
    g2 = nt.nodes.new("ShaderNodeMath")
    g2.operation = "GREATER_THAN"
    g2.inputs[1].default_value = 0.75
    g2.location = (400, 500)
    m1 = mix_node(nt, (600, 200))
    m2 = mix_node(nt, (800, 0))
    t_spec = image_node(nt, imgs["spec"], ext, (600, -500))
    glossy = nt.nodes.new("ShaderNodeBsdfGlossy")
    glossy.inputs["Color"].default_value = (1, 1, 1, 1)
    glossy.inputs["Roughness"].default_value = SPEC_ROUGHNESS
    glossy.location = (-600, -400)
    gs2r = nt.nodes.new("ShaderNodeShaderToRGB")
    gs2r.location = (-400, -400)
    gsep = nt.nodes.new("ShaderNodeSeparateColor")
    gsep.location = (-200, -400)
    gg = nt.nodes.new("ShaderNodeMath")
    gg.operation = "GREATER_THAN"
    gg.inputs[1].default_value = SPEC_T
    gg.location = (0, -400)
    _spec_nodes.append(gg)
    m3 = mix_node(nt, (1000, -100))
    emis.location = (1200, 0)
    out.location = (1400, 0)

    nt.links.new(diffuse.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Red"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], sep2.inputs["Color"])
    nt.links.new(sep2.outputs["Red"], g1.inputs[0])
    nt.links.new(sep2.outputs["Red"], g2.inputs[0])
    nt.links.new(g1.outputs["Value"], m1.inputs[0])
    nt.links.new(t_shadow.outputs["Color"], m1.inputs[6])
    nt.links.new(t_mid.outputs["Color"], m1.inputs[7])
    nt.links.new(g2.outputs["Value"], m2.inputs[0])
    nt.links.new(m1.outputs[2], m2.inputs[6])
    nt.links.new(t_light.outputs["Color"], m2.inputs[7])
    nt.links.new(glossy.outputs["BSDF"], gs2r.inputs["Shader"])
    nt.links.new(gs2r.outputs["Color"], gsep.inputs["Color"])
    nt.links.new(gsep.outputs["Red"], gg.inputs[0])
    nt.links.new(gg.outputs["Value"], m3.inputs[0])
    nt.links.new(m2.outputs[2], m3.inputs[6])
    nt.links.new(t_spec.outputs["Color"], m3.inputs[7])
    nt.links.new(m3.outputs[2], emis.inputs["Color"])
    nt.links.new(emis.outputs["Emission"], out.inputs["Surface"])

    hull = bpy.data.materials.new(src.name + "_hull")
    hull.use_nodes = True
    hn = hull.node_tree
    hn.nodes.clear()
    hout = hn.nodes.new("ShaderNodeOutputMaterial")
    hemis = hn.nodes.new("ShaderNodeEmission")
    himg = image_node(hn, imgs["outline"], ext, (-300, 0))
    hn.links.new(himg.outputs["Color"], hemis.inputs["Color"])
    hn.links.new(hemis.outputs["Emission"], hout.inputs["Surface"])
    hull.use_backface_culling = True
    for attr in ("use_backface_culling_shadow",):
        if hasattr(hull, attr):
            setattr(hull, attr, True)
    return toon, hull


# ---- prepare / render ------------------------------------------------------

_hull_mods = []
_ramp_elements = []
_spec_nodes = []
_applied_size = None


def prepare(ctx):
    global _hull_mods, _ramp_elements, _spec_nodes, _applied_size
    _hull_mods, _ramp_elements, _spec_nodes, _applied_size = [], [], [], None
    s = ctx.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.filter_size = 0.0
    s.render.dither_intensity = 0.0
    s.eevee.taa_render_samples = 1
    s.eevee.use_shadows = False
    s.eevee.use_raytracing = False
    if hasattr(s.eevee, "use_fast_gi"):
        s.eevee.use_fast_gi = False
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.view_settings.exposure = 0.0
    s.view_settings.gamma = 1.0
    s.display_settings.display_device = "sRGB"

    # world: a flat dark ambient, film stays transparent
    world = bpy.data.worlds.new("ToonWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (AMBIENT, AMBIENT, AMBIENT, 1)
    bg.inputs["Strength"].default_value = 1.0
    s.world = world

    # key light, upper left and a little in front of the figure
    sun_data = bpy.data.lights.new("Key", "SUN")
    sun_data.energy = SUN_STRENGTH
    sun_data.angle = SUN_ANGLE
    sun = bpy.data.objects.new("Key", sun_data)
    s.collection.objects.link(sun)
    to_light = Vector(LIGHT_DIR).normalized()
    sun.rotation_euler = (-to_light).to_track_quat("-Z", "Y").to_euler()

    # palette lab
    pal_u8 = ctx.palette[:ctx.usable]
    pal_lab = to_oklab(pal_u8.astype(np.float64) / 255.0)

    # per source material: flatten atlas, build ramps, build the four band images
    built = {}
    for m in list(bpy.data.materials):
        tex = next((n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeTexImage"), None) if m.use_nodes else None
        if tex is None or tex.image is None:
            continue
        src = tex.image
        w, h = src.size
        if (w, h) != (ATLAS, ATLAS):
            raise RuntimeError(f"toon: unexpected atlas size {w}x{h} for {src.name}")
        px = np.empty(w * h * 4, np.float32)
        src.pixels.foreach_get(px)
        rgb = px.reshape(h, w, 4)[::-1, :, :3].astype(np.float64)      # row 0 at the top
        body, strip = flatten_atlas(rgb)
        rows, cols = body.shape[:2]
        band_body = {k: np.zeros((rows, cols), int) for k in ("outline", "shadow", "mid", "light", "spec")}
        band_strip = {k: np.zeros((rows, cols), int) for k in band_body}
        for cy in range(rows):
            for cx in range(cols):
                for src_arr, dst in ((body, band_body), (strip, band_strip)):
                    o, sh, mi, li, sp = ramp_for(src_arr[cy, cx], pal_lab)
                    dst["outline"][cy, cx], dst["shadow"][cy, cx] = o, sh
                    dst["mid"][cy, cx], dst["light"][cy, cx], dst["spec"][cy, cx] = mi, li, sp
        imgs = {k: make_image(f"toon_{src.name}_{k}", paint_atlas(band_body[k], band_strip[k], pal_u8)) for k in band_body}
        if os.environ.get("TOON_DEBUG"):
            dbg = np.concatenate([paint_atlas(band_body[k], band_strip[k], pal_u8) for k in ("light", "mid", "shadow", "outline")], axis=1)
            _save_debug(ctx, dbg, f"ramps_{src.name}.png")
        built[m.name] = build_toon_material(m, imgs)

    seen = set()
    for o in list(bpy.data.objects):
        if o.type != "MESH" or not o.data.materials:
            continue
        if o.data.name in seen:
            continue
        seen.add(o.data.name)
        src_name = o.data.materials[0].name
        if src_name not in built:
            continue
        toon, hull = built[src_name]
        o.data.materials[0] = toon
        o.data.materials.append(hull)
        mod = o.modifiers.new("Hull", "SOLIDIFY")
        mod.solidify_mode = "EXTRUDE"
        mod.thickness = 0.02
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.use_rim = True
        mod.use_even_offset = False
        mod.material_offset = 1
        mod.material_offset_rim = 1
        _hull_mods.append(mod)
    # originals that nothing rebuilt keep glTF materials; the harness hides the stray helper sphere already


def _save_debug(ctx, rgb_top_first, name):
    d = os.path.join(os.getcwd(), ".cache", "kaykit", "scratch", "toon")
    os.makedirs(d, exist_ok=True)
    h, w, _ = rgb_top_first.shape
    img = bpy.data.images.new("dbg", w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = rgb_top_first[::-1]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(d, name)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def majority_downscale(idx_ss, ss, is_outline, w_out, mem=None):
    """idx_ss: (h*ss, w*ss) uint8 with 255 transparent. A pixel is opaque if at least half its block is opaque.
    Its colour is the palette index with the largest weighted count among the opaque samples. Outline colours
    (is_outline, a 256 bool table) are scaled by w_out, a per-pixel (h, w) float weight: above 1 it keeps a
    sub-pixel outline a continuous line, below 1 it drops faint creases. Ties go to the lowest index, so the
    same block always gives the same pixel.

    Inside a clip (mem.active, see harness.py) the vote has memory: a pixel keeps last frame's colour while that
    colour still holds KEEP_RATIO of the winner's weight, and opacity is a dead band (opaque from 5/8 of the block,
    transparent again below 3/8) instead of a hard half. The first frame of a clip, and any still, vote as before."""
    H, W = idx_ss.shape
    h, w = H // ss, W // ss
    blocks = idx_ss.reshape(h, ss, w, ss).transpose(0, 2, 1, 3).reshape(h, w, ss * ss)
    n_opaque = (blocks != TRANSPARENT).sum(-1)
    if mem is not None and mem.active:
        labels = np.array([v for v in np.unique(blocks) if v != TRANSPARENT], np.uint8)
        out = np.full((h, w), TRANSPARENT, np.uint8)
        if len(labels):
            weights = np.stack([(blocks == v).sum(-1).astype(np.float32) * (w_out if is_outline[v] else 1.0)
                                for v in labels])
            lab, _ = mem.hold("col", labels, weights)
            out = np.where(lab >= 0, lab, TRANSPARENT).astype(np.uint8)
        prev_op = mem.get("opaque")
        n = ss * ss
        if prev_op is None:
            opaque = n_opaque * 2 >= n
        else:
            opaque = np.where(prev_op, n_opaque * 8 >= 3 * n, n_opaque * 8 >= 5 * n)
        mem.put("opaque", opaque)
        out[~opaque] = TRANSPARENT
        return out
    out = np.full((h, w), TRANSPARENT, np.uint8)
    best = np.zeros((h, w), np.float32)
    for v in np.unique(blocks):
        if v == TRANSPARENT:
            continue
        cnt = (blocks == v).sum(-1).astype(np.float32)
        if is_outline[v]:
            cnt = cnt * w_out
        better = cnt > best
        out[better] = v
        best[better] = cnt[better]
    out[n_opaque * 2 < ss * ss] = TRANSPARENT
    return out


def apply_size(size):
    global _applied_size
    if _applied_size == size.id:
        return SIZE_PARAMS[size.id]
    prm = SIZE_PARAMS[size.id]
    lo, hi = prm["t_mid"], prm["t_light"]
    two_tone = lo <= 0.0                    # no shadow band: the unlit side uses the mid colour
    for e0, e1, e2 in _ramp_elements:
        g = 0.5 if two_tone else 0.0
        e0.color = (g, g, g, 1)
        e1.position = max(lo, 0.001)
        e2.position = min(hi, 0.999)
    for gg in _spec_nodes:
        gg.inputs[1].default_value = prm["spec_t"]
    _applied_size = size.id
    return prm


def _render_idx(ctx):
    rgba = ctx.render_rgba(ss=SS)
    H, W = rgba.shape[:2]
    idx = np.full((H, W), TRANSPARENT, np.uint8)
    solid = rgba[..., 3] >= 0.5
    if solid.any():
        idx[solid] = ctx.nearest_palette(rgba[solid][:, :3])
    return idx


def render_frame(ctx, size):
    prm = apply_size(size)
    px = prm["outline_px"] * size.world_per_px
    for mod in _hull_mods:
        mod.thickness = px
        mod.show_render = True
    idx = _render_idx(ctx)
    H, W = idx.shape
    w_out = np.full((H // SS, W // SS), prm["outline_weight"], np.float32)
    if "interior_weight" in prm:
        # A second pass without the hull tells interior blocks (inside the figure) from edge blocks. Outline
        # colours in the interior count less, so only the heavy creases survive at tiny sizes.
        for mod in _hull_mods:
            mod.show_render = False
        body = _render_idx(ctx)
        for mod in _hull_mods:
            mod.show_render = True
        cover = (body != TRANSPARENT).reshape(H // SS, SS, W // SS, SS).mean(axis=(1, 3))
        w_out = np.where(cover >= 0.999, prm["interior_weight"], prm["outline_weight"]).astype(np.float32)
    is_outline = np.zeros(256, bool)
    for i in set(OUTLINE_FOR.values()):
        is_outline[i] = True
    return majority_downscale(idx, SS, is_outline, w_out, getattr(ctx, "mem", None))
