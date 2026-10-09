"""
KayKit environment, "lit" approach: depth from the 3D itself (Blender 5.2, headless).

Derived from env_probe.py (same Dungeon and Medieval Hexagon packs, same palette, same room layout). The prototype rendered floors,
wall caps and ground with flat light, so stone, planks, grass and water came out as flat colour. This script gets the relief from
geometry and light, the way the approved door gets it:

  * every ground surface (stone floor, wood floor, wall cap, grass, water) is a HEIGHTFIELD that is built into a real dense mesh
    in Blender: the KayKit floor and wall meshes are rendered top down once to read their true heights (a depth pass written as a
    vertex colour), the relief is exaggerated (their grooves are only 0.03 units deep), and seeded, tile-periodic geometry is added
    (plank tilt and grain, stone tilt and chips, grass clumps, water ripples). The hex grass and water meshes are genuinely flat, so
    their geometry is new.
  * each heightfield is rendered with the renderer's own normal pass and depth pass (Workbench, orthographic, straight down), then
    lit in numpy by a raking key light from the upper left: n.L for bevels, a cast shadow marched across the depth pass (shadow
    edges on the lower right of every raised shape), cavity darkening from the depth pass in grooves and seams, and a specular
    glint on water crests. Three or four palette tones per material.
  * the shore and the stone/wood edge are still generated from the rendered tiles by blend_layers, which now also shades the bank:
    a lit lip on the edge that faces the light, a shadowed lip on the edge that faces away, and a cast shadow on the lower surface.

Everything the owner approved (door, wall faces, trees, rocks, props) goes through the prototype's code path unchanged.

Run from the repo root (a few minutes):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/env_lit.py [-- --sizes 16,32]

Inputs (all under .cache/, gitignored): as env_probe.py (dungeon pack, hexagon pack under scratch/env/hexagon, palette-fantasy.json,
out/bands/frames.json for the Knight, scratch/env/current.json for the optional side by side).
Outputs: .cache/kaykit/out/env-lit/*.png (name.png at native size, name@Nx.png enlarged for looking at) and report.json.
"""
import base64
import hashlib
import json
import math
import os
import sys
import time
import zlib

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.getcwd()
PACK = os.path.join(ROOT, ".cache", "kaykit", "dungeon", "addons", "kaykit_dungeon_remastered")
GLTF = os.path.join(PACK, "Assets", "gltf")
PALETTE_JSON = os.path.join(ROOT, ".cache", "kaykit", "palette-fantasy.json")
FRAMES_JSON = os.path.join(ROOT, ".cache", "kaykit", "out", "bands", "frames.json")
CURRENT_JSON = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env", "current.json")
OUT = os.path.join(ROOT, ".cache", "kaykit", "out", "env-lit")
SCRATCH = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env-lit")
TMP_PNG = os.path.join(SCRATCH, f"render_{os.getpid()}.png")

TRANSPARENT = 255
RENDERS = [0]
UNITS_PER_TILE = 2.0       # the pack's grid: a small floor tile is 2 x 2 units, a wall module 4 x 1 x 4
USABLE = 48

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

def log(*a):
    print("[env]", *a, flush=True)


def require(path, how):
    if not os.path.exists(path):
        raise SystemExit(f"env_probe: missing {path}\n  {how}")


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


def write_png(path, rgba_u8):
    h, w, _ = rgba_u8.shape
    img = bpy.data.images.new("out", w, h, alpha=True)
    img.pixels.foreach_set((rgba_u8[::-1].astype(np.float32) / 255.0).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


class Pal:
    """The game palette and the conversions around it."""

    def __init__(self):
        with open(PALETTE_JSON) as fh:
            self.rgb = np.array(json.load(fh)["palette"], np.uint8)
        self.lab = srgb_to_lab(self.rgb.astype(np.float64) / 255.0)

    def rgba(self, idx, bg=None):
        out = np.zeros(idx.shape + (4,), np.uint8)
        solid = idx != TRANSPARENT
        out[solid, :3] = self.rgb[idx[solid]]
        out[solid, 3] = 255
        if bg is not None:
            out[~solid, :3] = bg
            out[~solid, 3] = 255
        return out

    def save(self, name, idx, zoom=1, bg=(96, 96, 96)):
        rgba = self.rgba(idx, bg)
        if zoom > 1:
            rgba = np.repeat(np.repeat(rgba, zoom, 0), zoom, 1)
        write_png(os.path.join(OUT, name), rgba)


# ---------------------------------------------------------------------------
# The pack: one shared atlas, one shared material, every piece a list of parts
# ---------------------------------------------------------------------------

DEPTH_SCALE = 8.0    # the depth pass stores z / DEPTH_SCALE + 0.5 in a vertex colour, so pack heights -4 .. +4 fit 0..1


def add_depth_attr(mesh, matrix):
    """A point colour attribute 'dz' holding each vertex's pack-space height (after the part's own matrix), for the depth pass."""
    n = len(mesh.vertices)
    co = np.empty(n * 3, np.float32)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    m = np.array(matrix, np.float32)
    z = co @ m[2, :3] + m[2, 3]
    col = np.zeros((n, 4), np.float32)
    col[:, 0] = col[:, 1] = col[:, 2] = z / DEPTH_SCALE + 0.5
    col[:, 3] = 1.0
    if "dz" in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes["dz"])
    attr = mesh.color_attributes.new("dz", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", col.ravel())


class Part:
    def __init__(self, name, mesh, matrix):
        self.name, self.mesh, self.matrix = name, mesh, matrix


def dungeon_path(name):
    path = os.path.join(GLTF, name + ".gltf.glb")
    return path if os.path.exists(path) else os.path.join(GLTF, name + ".glb")


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
        for p in parts:
            add_depth_attr(p.mesh, p.matrix)
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
        self.world = np.array([1.0, 1.0, 1.0])       # world scale applied to everything (approach C)
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
        path = os.path.join(SCRATCH, "matcap_nrm.png")
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
        for m in [m for m in bpy.data.meshes if m.name.startswith("hf_") and m.users == 0]:
            bpy.data.meshes.remove(m)

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
            img.colorspace_settings.name = "Non-Color"      # a 16 bit file would otherwise be linearised on the way in
            px = np.empty(w * h * 4, np.float32)
            img.pixels.foreach_get(px)
        finally:
            bpy.data.images.remove(img)
        return px.reshape(h, w, 4)[::-1].copy()

    def _render16(self, w, h):
        """Like _render but the file is 16 bit, so a depth or normal pass keeps its precision. Returns float (h, w, 4)."""
        s = self.scene
        s.render.image_settings.color_depth = "16"
        try:
            return self._render(w, h)
        finally:
            s.render.image_settings.color_depth = "8"

    def depth_pass(self, w, h):
        """Straight read of the geometry: every mesh is shown in FLAT light with its 'dz' vertex colour (pack-space height / 8 + 0.5),
        raw colour management, so the pixel value is the surface height under that pixel. Returns (z in pack units, opaque mask)."""
        s = self.scene
        sh = s.display.shading
        vt = s.view_settings.view_transform
        s.view_settings.view_transform = "Raw"
        sh.light, sh.color_type = "FLAT", "VERTEX"
        for o in self.objs:
            ca = o.data.color_attributes
            if "dz" in ca:
                ca.active_color = ca["dz"]
                try:
                    ca.default_color_name = "dz"
                except Exception:
                    pass
        try:
            px = self._render16(w, h)
        finally:
            s.view_settings.view_transform = vt
        return (px[..., 0] - 0.5) * DEPTH_SCALE, px[..., 3] > 0.5

    def normal_pass(self, w, h):
        """The renderer's own normals, through the matcap that encodes a camera-space normal as a colour. Returns unit vectors (h, w, 3)
        in camera space (x right, y up, z toward the viewer) and the opaque mask."""
        sh = self.scene.display.shading
        sh.light, sh.studio_light, sh.color_type, sh.single_color = "MATCAP", self.matcap, "SINGLE", (1.0, 1.0, 1.0)
        px = self._render16(w, h)
        n = px[..., :3] * 2.0 - 1.0
        n /= (np.sqrt((n ** 2).sum(-1)) + 1e-6)[..., None]
        return n, px[..., 3] > 0.5

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


# <<LIT_HF>>
# ---------------------------------------------------------------------------
# Heightfields: a ground surface is an array of heights (world units) at sub-pixel spacing. It becomes a real dense mesh, is read back
# through the renderer's normal pass and depth pass, and is lit in numpy by a raking key light from the upper left.
# ---------------------------------------------------------------------------
TAN_ELEV = 0.80             # the key light's height in the image plane: the light is 39 degrees above the floor
LZ = math.sin(math.atan(TAN_ELEV))                      # z component of the light vector (toward the light), 0.625
LXY = math.sqrt((1.0 - LZ * LZ) / 2.0)                  # x and y component: light comes from the upper left, exactly diagonal
LITE = np.array([-LXY, LXY, LZ], np.float32)            # camera space (x right, y up, z toward the viewer)


def hf_object(stage, H, ppu, ss, name="hf_surface"):
    """Build the heightfield H (rows x cols of sub-pixel samples, row 0 at the top, centred on world (0, 0)) as a dense smooth mesh.
    One extra ring of samples is added so the mesh covers the whole frame. The per-vertex colour 'dz' carries the height for the depth
    pass. Returns the object."""
    dx = 1.0 / (ppu * ss)
    Hp = np.pad(H, 1, mode="edge").astype(np.float32)
    py, px = Hp.shape
    xs = (np.arange(px) - (px - 1) / 2.0) * dx
    ys = -(np.arange(py) - (py - 1) / 2.0) * dx
    X, Y = np.meshgrid(xs, ys)
    co = np.stack([X, Y, Hp], -1).reshape(-1, 3).astype(np.float32)
    r, c = np.mgrid[0:py - 1, 0:px - 1]
    v00 = (r * px + c).ravel().astype(np.int32)
    faces = np.stack([v00 + px, v00 + px + 1, v00 + 1, v00], 1).astype(np.int32)
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(co))
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.loops.add(faces.size)
    mesh.loops.foreach_set("vertex_index", faces.ravel())
    mesh.polygons.add(len(faces))
    mesh.polygons.foreach_set("loop_start", (np.arange(len(faces)) * 4).astype(np.int32))
    mesh.polygons.foreach_set("use_smooth", np.ones(len(faces), bool))
    mesh.update(calc_edges=True)
    col = np.zeros((len(co), 4), np.float32)
    col[:, 0] = col[:, 1] = col[:, 2] = co[:, 2] / DEPTH_SCALE + 0.5
    col[:, 3] = 1.0
    attr = mesh.color_attributes.new("dz", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", col.ravel())
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def render_hf(stage, H, px_w, px_h, ppu, ss):
    """Render a heightfield of px_h x px_w pixels (H has px_h*ss rows). Returns (normals (rows, cols, 3), depth in world units)."""
    stage.clear()
    stage.objs.append(hf_object(stage, H, ppu, ss))
    stage.aim(90.0, (0.0, 0.0, 0.0), (px_w / 2.0, px_h / 2.0), px_w, px_h, ppu)
    n, _ = stage.normal_pass(px_w * ss, px_h * ss)
    D, _ = stage.depth_pass(px_w * ss, px_h * ss)
    stage.clear()
    return n, D


def blur_h(a, r, wrap=False):
    """Box blur of radius r samples (edge padded, or wrapped for a periodic module)."""
    k = 2 * r + 1
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        p = np.pad(a, pad, mode="wrap" if wrap else "edge")
        c = np.cumsum(p, axis=axis, dtype=np.float64)
        a = (np.take(c, np.arange(k, c.shape[axis]), axis=axis) - np.take(c, np.arange(0, c.shape[axis] - k), axis=axis)) / float(k)
    return a.astype(np.float32)


def shift_edge(a, dy, dx):
    """out[y, x] = a[y + dy, x + dx], clamped at the edges."""
    h, w = a.shape
    ys = np.clip(np.arange(h) + dy, 0, h - 1)
    xs = np.clip(np.arange(w) + dx, 0, w - 1)
    return a[ys][:, xs]


def cast_shadow(D, dx, reach, soft=0.012):
    """Shadow of the heightfield D (world units, sub-pixel spacing dx) under the raking light: a sample is in shadow when a sample
    `t` diagonal steps toward the light (up and left) is higher than the ray climbing toward the light. `reach` is how many
    steps to look. 1 is fully shadowed, 0 lit, with a soft edge of `soft` world units."""
    sh = np.zeros(D.shape, np.float32)
    rise = dx * math.sqrt(2.0) * TAN_ELEV
    for t in range(1, reach + 1):
        over = shift_edge(D, -t, -t) - D - t * rise
        sh = np.maximum(sh, np.clip(over / soft, 0.0, 1.0))
    return sh


HALF = LITE + np.array([0.0, 0.0, 1.0], np.float32)       # half vector between the light and a viewer straight above
HALF = HALF / np.linalg.norm(HALF)


def shade_hf(n, D, dx, reach, ao_r, ao_k, shadow_k=0.9, wrap=False, spec_k=0.0, spec_p=24.0):
    """Light value per sub-pixel: n.L, cast shadow, cavity (how far the sample sits below its surroundings), and an optional
    specular glint (Blinn, for water). ao_r is the cavity radius in samples, ao_k the darkening per world unit of depth below the
    average. Returns (V, shadow, cavity)."""
    lam = np.clip(n @ LITE, 0.0, 1.0)
    sh = cast_shadow(D, dx, reach)
    cav = np.clip(blur_h(D, ao_r, wrap) - D, 0.0, None)
    V = lam * (1.0 - shadow_k * sh) - ao_k * cav
    if spec_k > 0.0:
        V = V + spec_k * np.clip(n @ HALF, 0.0, 1.0) ** spec_p * (1.0 - sh)
    return V, sh, cav


def to_pixels(a, h, w, ss):
    return a.reshape(h, ss, w, ss).mean(axis=(1, 3))


def quant_levels(V, tones, base, gain, lo=0):
    """Light value (pixel res) -> palette index. A flat surface lit by the key (V == LZ) sits on step `base` of the tone list;
    `gain` steps per unit of light."""
    lv = np.clip(np.rint(base + gain * (V - LZ)), lo, len(tones) - 1).astype(np.int32)
    return np.asarray(tones, np.uint8)[lv], lv


def declump(level, passes=2):
    """Clustered texture, not salt and pepper: a pixel whose four neighbours mostly agree on another step takes it."""
    four = ((-1, 0), (1, 0), (0, -1), (0, 1))
    lv = level.copy()
    for _ in range(passes):
        nb = [shift(lv, dy, dx, -1) for dy, dx in four]
        for target in np.unique(lv):
            votes = sum((x == target).astype(np.int32) for x in nb)
            lv = np.where((votes >= 3) & (lv != target), target, lv)
    return lv


def fft_noise(shape, seed, f0, bw=None, aniso=(1.0, 1.0)):
    """Seeded noise that is periodic over the whole array: white noise band-passed around f0 cycles per array (bw wide; low pass when
    bw is None). aniso stretches the features (rows, columns): 6 along columns makes them six times longer in x. Zero mean, unit deviation."""
    rng = np.random.RandomState(seed)
    F = np.fft.fft2(rng.standard_normal(shape))
    fy = np.fft.fftfreq(shape[0])[:, None] * shape[0] * aniso[0]
    fx = np.fft.fftfreq(shape[1])[None, :] * shape[1] * aniso[1]
    k = np.sqrt(fx * fx + fy * fy)
    filt = np.exp(-(k / f0) ** 2) if bw is None else np.exp(-((k - f0) / bw) ** 2)
    out = np.fft.ifft2(F * filt).real
    return (out / (out.std() + 1e-9)).astype(np.float32)


def label_periodic(mask):
    """Connected components (4-connectivity) of a boolean mask on a periodic array, by min-label propagation. Returns ints, 0 = off."""
    h, w = mask.shape
    lab = np.where(mask, np.arange(1, h * w + 1, dtype=np.int64).reshape(h, w), 0)
    big = h * w + 1
    for _ in range(h + w):
        cur = np.where(lab > 0, lab, big)
        nb = np.minimum(np.minimum(np.roll(cur, 1, 0), np.roll(cur, -1, 0)), np.minimum(np.roll(cur, 1, 1), np.roll(cur, -1, 1)))
        new = np.where(mask, np.minimum(cur, nb), 0)
        if np.array_equal(new, lab):
            break
        lab = new
    uniq, inv = np.unique(lab, return_inverse=True)
    return inv.reshape(lab.shape).astype(np.int32)


def dist_to_edge(mask, limit):
    """Distance (in samples, 4-connected) from each True sample to the nearest False sample on a periodic array, capped at `limit`."""
    d = np.zeros(mask.shape, np.float32)
    cur = mask.copy()
    for _ in range(limit):
        d += cur
        er = cur.copy()
        for ax in (0, 1):
            for sgn in (1, -1):
                er &= np.roll(cur, sgn, ax)
        cur = er
        if not cur.any():
            break
    return d
# <<END LIT_HF>>


# <<LIT_SURF>>
def chamfer_dist(src, limit):
    """Distance in samples (8-neighbour chamfer, weights 1 and sqrt 2, within a few percent of Euclidean) from every sample to the
    nearest True sample of `src`, on a periodic array, capped at `limit`."""
    pad = int(limit) + 2
    a = np.pad(src, pad, mode="wrap")
    H, W = a.shape
    d = np.where(a, 0.0, 1e6).astype(np.float32)
    xs = np.arange(W, dtype=np.float32)
    r2 = 1.41421356
    for y in range(H):
        if y:
            p = d[y - 1]
            d[y] = np.minimum(d[y], np.minimum(p + 1.0, np.minimum(np.roll(p, 1) + r2, np.roll(p, -1) + r2)))
        d[y] = np.minimum.accumulate(d[y] - xs) + xs
    for y in range(H - 1, -1, -1):
        if y < H - 1:
            p = d[y + 1]
            d[y] = np.minimum(d[y], np.minimum(p + 1.0, np.minimum(np.roll(p, 1) + r2, np.roll(p, -1) + r2)))
        d[y] = np.minimum.accumulate((d[y] + xs)[::-1])[::-1] - xs
    return np.minimum(d[pad:-pad, pad:-pad], float(limit))


def signed_dist(inside, limit):
    """Signed distance in samples to the boundary of a mask on a periodic array: positive inside, negative outside, 0 at the edge."""
    din = chamfer_dist(~inside, limit)       # distance of inside samples to the nearest outside sample
    dout = chamfer_dist(inside, limit)
    return np.where(inside, din - 0.5, -(dout - 0.5)).astype(np.float32)


def circ_centroid(mask, h, w):
    """Centre of a blob on a periodic array (circular mean), in samples (row, col)."""
    ys, xs = np.nonzero(mask)
    ay, ax = ys * 2 * np.pi / h, xs * 2 * np.pi / w
    cy = (np.arctan2(np.sin(ay).mean(), np.cos(ay).mean()) % (2 * np.pi)) * h / (2 * np.pi)
    cx = (np.arctan2(np.sin(ax).mean(), np.cos(ax).mean()) % (2 * np.pi)) * w / (2 * np.pi)
    return cy, cx


def wrap_delta(a, c, n):
    """Signed distance of coordinates a from c on a circle of n samples, in (-n/2, n/2]."""
    return (a - c + n / 2.0) % n - n / 2.0


def kk_depth(st, placements, w_px, h_px, ppu, ss, cx=0.0, cy=0.0):
    """Render KayKit pieces straight down and return their height map in pack units (w_px x h_px pixels, ss samples per pixel),
    centred on world (cx, cy)."""
    st.clear()
    st.place_all(placements)
    st.aim(90.0, (cx, cy, 0.0), (w_px / 2.0, h_px / 2.0), w_px, h_px, ppu)
    d, m = st.depth_pass(w_px * ss, h_px * ss)
    st.clear()
    return d, m


def pixel_layer(S, layer):
    """A module-resolution layer (samples) -> the padded region at pixel resolution, taking the sample at each pixel centre."""
    Lr = np.pad(layer, S.m * S.ss, mode="wrap")
    c = S.ss // 2
    return Lr[c::S.ss, c::S.ss]


class Surf:
    """A periodic module of one material: its heights, how to light it, and how to read it back as pixels."""

    def __init__(self, st, T, ss, tiles_w, tiles_h):
        self.st, self.T, self.ss = st, T, ss
        self.ppu = T / UNITS_PER_TILE
        self.tw, self.th = tiles_w, tiles_h
        self.W, self.Hh = tiles_w * T, tiles_h * T        # module size in pixels
        self.m = max(6, T // 2)                               # margin rendered around the module, in pixels
        self.dx = 1.0 / (self.ppu * ss)                       # world size of a sample
        self.pxu = 1.0 / self.ppu                             # world size of a pixel (the unit all relief is measured in)

    def light(self, H, reach_px=3.2, ao_px=1.3, ao_k=0.5, shadow_k=0.9, wrap=True, low=0.0, spec_k=0.0, spec_p=24.0):
        """Render a heightfield (module at sample resolution) with a margin around it and light it. The margin wraps for a periodic
        module, or is flat ground at height `low` for an island (a single block). Returns the light value V per pixel of the padded
        region (floats, LZ is a flat surface) and the margin width in pixels."""
        st, ss, m = self.st, self.ss, self.m
        if wrap:
            Hr = np.pad(H, m * ss, mode="wrap")
        else:
            Hr = np.pad(H, m * ss, mode="constant", constant_values=low)
        pw, ph = H.shape[1] // ss + 2 * m, H.shape[0] // ss + 2 * m
        n, D = render_hf(st, Hr, pw, ph, self.ppu, ss)
        V, sh, cav = shade_hf(n, D, self.dx, int(round(reach_px * ss)), max(1, int(round(ao_px * ss))), ao_k * self.ppu, shadow_k, False, spec_k, spec_p)
        Vp = to_pixels(V, ph, pw, ss)
        self.last = dict(n=n, D=D, sh=sh, cav=cav, V=V, ph=ph, pw=pw)
        return Vp, m


def tone_and_clean(Vp, tones, base, gain, passes=2, off=None):
    """Pixel light values -> palette indices, with lone pixels absorbed into their neighbours. `off` is an optional per-pixel shift in
    tone steps (a darker or lighter swatch of the same material). Works on the margin-padded array, so the caller crops the module
    afterwards."""
    lvf = base + gain * (Vp - LZ) + (0.0 if off is None else off)
    lv = np.clip(np.rint(lvf), 0, len(tones) - 1).astype(np.int32)
    lv = declump(lv, passes)
    return np.asarray(tones, np.uint8)[lv], lv


# -- stone floor ------------------------------------------------------------------------------------------------------------------
STONE_TONES = [24, 25, 26, 27]


def stone_heights(S, seed=11, bevel_px=1.0, drop_px=0.7, groove_px=0.7, deep_px=1.4, tilt=0.008, mottle_px=0.02, crack=True):
    """Stone floor module (2 x 2 tiles). The KayKit floor_tile_large supplies the layout and the true profile of the joints; here the
    tops are labelled into separate stones, each one is given a chamfered edge, a tilt and a gentle dome, the joint is cut as a V
    groove, and a few hairline cracks are carved. Units are pixels (1 px = 1/ppu world) so 16 and 32 pixel versions share one look."""
    st, ss, ppu, dx, pxu = S.st, S.ss, S.ppu, S.dx, S.pxu
    D0, _ = kk_depth(st, [dict(name="floor_tile_large")], S.W, S.Hh, ppu, ss)
    r = D0 - 0.05                                            # 0 on the stone tops, about -0.03 in the joints
    tops = r > -0.004
    nyx = tops.shape
    pxs = float(ss)                                          # samples per pixel
    sd = signed_dist(tops, int(6 * pxs)) / pxs               # signed distance to the stone edge, in pixels (+ inside)
    # the KayKit joint is about a pixel wide at 16 px; widen it to groove_px by moving the edge
    trans = np.abs(np.diff(tops.astype(np.int8), axis=1)).sum() + np.abs(np.diff(tops.astype(np.int8), axis=0)).sum()
    meas = (~tops).sum() / max(1.0, trans / 2.0) / pxs
    sd = sd - 0.5 * (groove_px - meas)
    S.joint_measured_px = float(meas)
    lab = label_periodic(sd > 0)
    H = np.zeros(nyx, np.float32)
    rng = np.random.RandomState(seed)
    yy, xx = np.mgrid[0:nyx[0], 0:nyx[1]].astype(np.float32)
    # bevel: a chamfer of bevel_px from the edge drops drop_px; joint: V groove to deep_px
    bev = np.where(sd >= bevel_px, 0.0, np.where(sd >= 0, -drop_px * (1.0 - sd / bevel_px), 0.0))
    gw = groove_px * 0.5
    groove = np.where(sd < 0, -drop_px - (deep_px - drop_px) * np.clip(-sd / gw, 0.0, 1.0), 0.0)
    H = bev + groove
    # per stone: tilt plane, dome, and a small height offset
    for k in range(1, lab.max() + 1):
        mk = lab == k
        if mk.sum() < 40:
            continue
        cy, cx = circ_centroid(mk, nyx[0], nyx[1])
        dy, dxp = wrap_delta(yy, cy, nyx[0]) / pxs, wrap_delta(xx, cx, nyx[1]) / pxs
        a, b = rng.normal(0, tilt), rng.normal(0, tilt)
        rad = np.sqrt(mk.sum()) / pxs / 1.6 + 1e-3
        dome = 0.70 * (S.T / 16.0) * np.clip(1.0 - (dy * dy + dxp * dxp) / (rad * rad), 0.0, 1.0)
        H = H + np.where(mk, a * dxp + b * dy + dome + rng.normal(0, 0.03), 0.0)
    # stone grain: soft mottling in two sizes (periodic)
    H = H + np.where(sd > 0, mottle_px * fft_noise(nyx, seed + 1, 3.5), 0.0)
    # grit: a few pits and pebbles (a lit and a shaded pixel each once lit from the upper left)
    tys, txs = np.nonzero(sd > 1.6)
    Y, X = np.mgrid[0:nyx[0], 0:nyx[1]].astype(np.float32)
    for i in range(int(0.02 * (2 * S.T) ** 2)):
        j = rng.randint(len(tys))
        cy, cx = tys[j] / pxs, txs[j] / pxs
        rr = rng.uniform(0.7, 1.0)
        amp = (0.5 if rng.rand() < 0.5 else -0.5) * rng.uniform(0.7, 1.1)
        dyw, dxw = wrap_delta(Y / pxs, cy, nyx[0] / pxs), wrap_delta(X / pxs, cx, nyx[1] / pxs)
        H = H + amp * np.clip(1.0 - (dyw * dyw + dxw * dxw) / (rr * rr), 0.0, 1.0) * (sd > 1.0)
    if crack:
        H = carve_cracks(H, sd > 0, rng, pxs, n=4, depth_px=0.9, span_px=(5.0 * (S.T / 16.0) ** 0.7, 9.0 * (S.T / 16.0) ** 0.7))
    return (H * pxu).astype(np.float32), sd


def carve_cracks(H, tops, rng, pxs, n=3, depth_px=0.9, span_px=(5.0, 9.0)):
    """Hairline cracks: short zigzag runs carved into the tops (a V about one sample wide, in pixels `depth_px` deep)."""
    h, w = H.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    out = H.copy()
    tys, txs = np.nonzero(tops)
    for _ in range(n):
        i = rng.randint(len(tys))
        y, x = float(tys[i]), float(txs[i])
        ang = rng.uniform(0, 2 * np.pi)
        for seg in range(2):
            ln = rng.uniform(*span_px) * pxs / 2.0
            ang += rng.uniform(-0.4, 0.4)
            y2, x2 = y + np.sin(ang) * ln, x + np.cos(ang) * ln
            # distance of every sample in a window to the segment
            y0, y1 = int(min(y, y2)) - 3, int(max(y, y2)) + 4
            x0, x1 = int(min(x, x2)) - 3, int(max(x, x2)) + 4
            ys_ = np.arange(y0, y1) % h
            xs_ = np.arange(x0, x1) % w
            Y, X = np.meshgrid(np.arange(y0, y1, dtype=np.float32), np.arange(x0, x1, dtype=np.float32), indexing="ij")
            vx, vy = x2 - x, y2 - y
            t = np.clip(((X - x) * vx + (Y - y) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
            dist = np.sqrt((X - (x + t * vx)) ** 2 + (Y - (y + t * vy)) ** 2) / pxs
            cut = -depth_px * np.clip(1.0 - dist / 0.45, 0.0, 1.0)
            sub = out[np.ix_(ys_, xs_)]
            mk = tops[np.ix_(ys_, xs_)]
            out[np.ix_(ys_, xs_)] = np.where(mk, np.minimum(sub, sub + cut), sub)
            y, x = y2, x2
    return out


# -- wood floor -------------------------------------------------------------------------------------------------------------------
WOOD_TONES = [1, 45, 37, 2]


def fft_noise_px(shape, module_px, seed, wavelength_px, aniso=(1.0, 1.0)):
    """fft_noise with the feature size given in pixels: wavelength_px is the wavelength across (rows), stretched by aniso along."""
    return fft_noise(shape, seed, module_px / float(wavelength_px), aniso=aniso)


def block_profile(sd, bevel_px, drop_px, groove_px, deep_px):
    """Height (in pixels) of a chamfered raised block with a V groove around it, from the signed distance to its edge."""
    bev = np.where(sd >= bevel_px, 0.0, np.where(sd >= 0, -drop_px * (1.0 - sd / bevel_px), 0.0))
    groove = np.where(sd < 0, -drop_px - (deep_px - drop_px) * np.clip(-sd / (groove_px * 0.5), 0.0, 1.0), 0.0)
    return bev + groove


def widen_joints(sd, tops, groove_px, pxs):
    """The KayKit joints are under a pixel wide at 16 px: move the block edge so the joint is about groove_px wide."""
    trans = np.abs(np.diff(tops.astype(np.int8), axis=1)).sum() + np.abs(np.diff(tops.astype(np.int8), axis=0)).sum()
    meas = (~tops).sum() / max(1.0, trans / 2.0) / pxs
    return sd - 0.5 * (groove_px - meas), float(meas)


def wood_heights(S, seed=23, bevel_px=1.0, drop_px=0.6, groove_px=1.0, deep_px=1.3, grain_px=0.12, bow_px=0.2):
    """Wood floor module (2 x 2 tiles) from KayKit's floor_wood_large: rows of planks laid in a brick bond. The planks are a quarter tile
    tall, so the module is moved half a pixel to put every joint on whole pixel rows and columns. Every plank is labelled, given a
    chamfered edge, a slight bow along its length and its own tilt; grain is noise stretched along the plank, cut as short fine
    grooves."""
    st, ss, ppu, pxu = S.st, S.ss, S.ppu, S.pxu
    D0, _ = kk_depth(st, [dict(name="floor_wood_large")], S.W, S.Hh, ppu, ss)
    D0 = np.roll(D0, (ss // 2, ss // 2), (0, 1))
    tops = D0 > 0.039
    nyx = tops.shape
    pxs = float(ss)
    sd = signed_dist(tops, int(6 * pxs)) / pxs
    sd, meas = widen_joints(sd, tops, groove_px, pxs)
    S.joint_measured_px = meas
    lab = label_periodic(sd > 0)
    rng = np.random.RandomState(seed)
    yy, xx = np.mgrid[0:nyx[0], 0:nyx[1]].astype(np.float32)
    H = block_profile(sd, bevel_px, drop_px, groove_px, deep_px)
    S.tone_shift = np.zeros(nyx, np.float32)          # per plank: some planks are the darker swatch of the same wood
    for k in range(1, lab.max() + 1):
        mk = lab == k
        if mk.sum() < 40:
            continue
        S.tone_shift[mk] = -1.0 if rng.rand() < 0.22 else 0.0
        cy, cx = circ_centroid(mk, nyx[0], nyx[1])
        dy, dxp = wrap_delta(yy, cy, nyx[0]) / pxs, wrap_delta(xx, cx, nyx[1]) / pxs
        half = np.abs(dxp[mk]).max() + 1e-3
        bow = bow_px * (1.0 - np.clip(dxp / half, -1, 1) ** 2)
        H = H + np.where(mk, rng.normal(0, 0.04) * dy + rng.normal(0, 0.015) * dxp + bow + rng.normal(0, 0.04), 0.0)
    # grain: fine grooves along the plank, short (4 to 11 px), a pixel thick; a nail head near each end on the bigger size
    plank_h = 0.0
    for k in range(1, lab.max() + 1):
        mk = lab == k
        if mk.sum() < 40:
            continue
        cy, cx = circ_centroid(mk, nyx[0], nyx[1])
        half_y = np.abs(wrap_delta(yy, cy, nyx[0])[mk]).max() / pxs
        half_x = np.abs(wrap_delta(xx, cx, nyx[1])[mk]).max() / pxs
        nlines = 1 + int(rng.rand() < (0.45 if S.T <= 16 else 0.6)) + (1 if S.T >= 32 and rng.rand() < 0.7 else 0)
        for _ in range(nlines):
            gy = cy / pxs + rng.uniform(-1, 1) * max(0.0, half_y - 1.7)
            ln = rng.uniform(4.0, 11.0) if S.T >= 32 else rng.uniform(3.0, 6.0)
            gx = cx / pxs + rng.uniform(-1, 1) * max(0.0, half_x - ln / 2 - 1.5)
            dyg = wrap_delta(yy / pxs, gy, nyx[0] / pxs)
            dxg = wrap_delta(xx / pxs, gx, nyx[1] / pxs)
            along = np.clip(1.0 - np.abs(dxg) / (ln / 2.0), 0.0, 1.0) ** 0.5
            cut = 1.0 * along * np.clip(1.0 - np.abs(dyg) / 0.6, 0.0, 1.0)
            H = H - np.where(mk & (sd > 0.9), cut, 0.0)
        if S.T >= 32:
            for sx in (-1, 1):
                nx_ = cx / pxs + sx * (half_x - 2.0)
                dyn = wrap_delta(yy / pxs, cy / pxs, nyx[0] / pxs)
                dxn = wrap_delta(xx / pxs, nx_, nyx[1] / pxs)
                r2 = (dyn * dyn + dxn * dxn) / (0.85 * 0.85)
                H = H + np.where(mk, 0.55 * np.clip(1.0 - r2, 0.0, 1.0), 0.0)
    return (H * pxu).astype(np.float32), sd


# -- wall cap ---------------------------------------------------------------------------------------------------------------------
CAP_TONES = [24, 26, 27, 32]


def island_sd(mask, pxs, limit_px=4.0):
    """Signed distance in pixels to the edge of a block that sits alone on low ground (the space outside the array is outside)."""
    pad = int(limit_px * pxs) + 4
    big = np.pad(mask, pad, mode="constant", constant_values=False)
    sd = signed_dist(big, int(limit_px * pxs)) / pxs
    return sd[pad:-pad, pad:-pad]


def cap_heights(S, seed, footprint=None, joint_px=1.0, bevel_px=1.0, drop_px=0.8, deep_px=1.5, mottle_px=0.16, dome_px=1.0, wobble_px=0.45, chip=True, crack=False):
    """One wall-cap block, a tile square whose last column and row are the joint to the next block (so the joint groove is a whole
    pixel and the block's own left and top edges are lit). A footprint (from the KayKit wall corner) trims it. Chamfered edges, its
    own height, tilt and dome, soft mottling, and a chipped corner or a hairline crack."""
    ss, T, pxu = S.ss, S.T, S.pxu
    pxs = float(ss)
    n = T * ss
    k = T / 16.0
    bevel_px, drop_px, dome_px = bevel_px * k ** 0.6, drop_px * k ** 0.6, dome_px * k
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) / pxs        # sample centres in pixels
    body = (xx < T - joint_px) & (yy < T - joint_px)
    if footprint is not None:
        body &= footprint
    sd = island_sd(body, pxs)
    rng = np.random.RandomState(seed)
    sd = np.where(sd > -0.3, sd + wobble_px * fft_noise((n, n), seed + 7, T / 11.0), sd)
    H = block_profile(sd, bevel_px, drop_px, joint_px, deep_px)
    cx, cy = (T - joint_px) / 2.0, (T - joint_px) / 2.0
    dx_, dy_ = xx - cx, yy - cy
    rad = T * 0.6
    H = H + np.where(body, rng.normal(0, 0.12) + rng.normal(0, 0.012) * dx_ + rng.normal(0, 0.012) * dy_
                     + dome_px * np.clip(1.0 - (dx_ * dx_ + dy_ * dy_) / (rad * rad), 0, 1), 0.0)
    nz = fft_noise((n, n), seed + 1, T / 7.5)
    H = H + np.where(body, mottle_px * nz, 0.0)
    if chip:
        for _ in range(1 + int(rng.rand() < 0.4)):
            corner = rng.randint(4)
            cxp = (2.0 if corner in (0, 2) else T - joint_px - 2.0)
            cyp = (2.0 if corner in (0, 1) else T - joint_px - 2.0)
            d = np.sqrt((xx - cxp) ** 2 + (yy - cyp) ** 2)
            H = H - np.where(body, 0.9 * np.clip(1.0 - d / (1.3 + rng.rand() * 0.9), 0, 1), 0.0)
    if crack and T >= 16:
        ys, xs = np.nonzero(sd > 1.5)
        if len(ys):
            H = carve_cracks_island(H, sd > 1.5, rng, pxs, depth_px=0.9)
    return (H * pxu).astype(np.float32), sd, body


def carve_cracks_island(H, tops, rng, pxs, depth_px=0.9, span_px=(4.0, 7.0)):
    """One hairline crack on an island block (no wrapping): two short straightish segments."""
    h, w = H.shape
    out = H.copy()
    tys, txs = np.nonzero(tops)
    i = rng.randint(len(tys))
    y, x = float(tys[i]), float(txs[i])
    ang = rng.uniform(0, 2 * np.pi)
    Y, X = np.mgrid[0:h, 0:w].astype(np.float32)
    for seg in range(2):
        ln = rng.uniform(*span_px) * pxs / 2.0
        ang += rng.uniform(-0.4, 0.4)
        y2, x2 = y + np.sin(ang) * ln, x + np.cos(ang) * ln
        vx, vy = x2 - x, y2 - y
        t = np.clip(((X - x) * vx + (Y - y) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
        dist = np.sqrt((X - (x + t * vx)) ** 2 + (Y - (y + t * vy)) ** 2) / pxs
        out = np.where(tops, np.minimum(out, out - depth_px * np.clip(1.0 - dist / 0.45, 0.0, 1.0)), out)
        y, x = y2, x2
    return out


# -- grass ------------------------------------------------------------------------------------------------------------------------
GRASS_TONES = [16, 17, 18, 19]
GRASS_SHARE = [0.13, 0.24, 0.38, 0.25]      # the game's current grass: 12 / 23 / 40 / 25 percent of the four greens


def tone_dominant(S, tones, base, gain, thr=0.3, passes=2, off=None):
    """Sub-pixel light value (from the last Surf.light) -> palette indices, keeping thin features. Each sample is given a tone step
    (flat surface = step `base`, `gain` steps per unit of light); a pixel takes the most extreme step that covers at least `thr` of it,
    else its commonest step. A one pixel bevel, a blade or a ripple crest therefore survives the downsample instead of being
    averaged back into the flat tone."""
    V, ph, pw, ss = S.last["V"], S.last["ph"], S.last["pw"], S.ss
    lv = np.clip(np.rint(base + gain * (V - LZ)), 0, len(tones) - 1).astype(np.int32)
    cov = np.stack([to_pixels((lv == L).astype(np.float32), ph, pw, ss) for L in range(len(tones))])
    b = int(round(base))
    score = cov * (1.0 + 0.35 * np.abs(np.arange(len(tones))[:, None, None] - base))
    score = np.where(cov >= thr, score, -1.0)
    score[b] = np.where(cov[b] >= thr, -0.5, -1.0)           # the base step only wins when nothing else reaches thr
    pick = score.argmax(0)
    none = score.max(0) < 0
    pick = np.where(none, cov.argmax(0), pick).astype(np.int32)
    if off is not None:
        pick = np.clip(np.rint(pick + off), 0, len(tones) - 1).astype(np.int32)
    pick = declump(pick, passes)
    return np.asarray(tones, np.uint8)[pick], pick


def tone_quantile(Vp, tones, share, region, passes=2):
    """Pixel light values -> palette indices by rank: the darkest `share[0]` of the pixels in `region` (a (y0, y1, x0, x1) crop, the
    module proper) take the first tone, and so on. One threshold set for the whole module, so every tile cut from it is on the same
    scale. Lone pixels are absorbed afterwards."""
    y0, y1, x0, x1 = region
    ref = Vp[y0:y1, x0:x1].ravel()
    cuts = np.quantile(ref, np.cumsum(share)[:-1])
    lv = np.digitize(Vp, cuts).astype(np.int32)
    lv = declump(lv, passes)
    return np.asarray(tones, np.uint8)[lv], lv


def add_tuft(H, cy, cx, ry, rx, amp, lean, pxs, wrap=True):
    """Add one grass tuft (an anisotropic, leaning bump) to H at (cy, cx) pixels. Radii and amplitude in pixels."""
    h, w = H.shape
    y0, y1 = int(np.floor((cy - ry * 1.2) * pxs)), int(np.ceil((cy + ry * 1.2) * pxs))
    x0, x1 = int(np.floor((cx - rx * 1.2 - abs(lean) * ry) * pxs)), int(np.ceil((cx + rx * 1.2 + abs(lean) * ry) * pxs))
    ys, xs = np.arange(y0, y1), np.arange(x0, x1)
    Y, X = np.meshgrid((ys + 0.5) / pxs, (xs + 0.5) / pxs, indexing="ij")
    u = (X - cx - lean * (Y - cy)) / rx
    v = (Y - cy) / ry
    bump = amp * np.clip(1.0 - (u * u + v * v), 0.0, 1.0) ** 1.25
    iy, ix = ys % h, xs % w
    H[np.ix_(iy, ix)] += bump.astype(np.float32)


def add_blade(H, y0, x0, ang, length, w, amp, pxs):
    """Add one blade of grass to H: a thin ridge from its base (y0, x0) pixels up and over at angle `ang` (radians from straight
    up), tapering to a point. Sloped sides give a lit left edge and a shaded right edge."""
    h, wd = H.shape
    y1, x1 = y0 - np.cos(ang) * length, x0 + np.sin(ang) * length
    ya, yb = int(np.floor((min(y0, y1) - w - 0.5) * pxs)), int(np.ceil((max(y0, y1) + w + 0.5) * pxs))
    xa, xb = int(np.floor((min(x0, x1) - w - 0.5) * pxs)), int(np.ceil((max(x0, x1) + w + 0.5) * pxs))
    ys, xs = np.arange(ya, yb), np.arange(xa, xb)
    Y, X = np.meshgrid((ys + 0.5) / pxs, (xs + 0.5) / pxs, indexing="ij")
    vx, vy = x1 - x0, y1 - y0
    t = np.clip(((X - x0) * vx + (Y - y0) * vy) / (vx * vx + vy * vy + 1e-9), 0.0, 1.0)
    dist = np.sqrt((X - (x0 + t * vx)) ** 2 + (Y - (y0 + t * vy)) ** 2)
    wt = w * (1.0 - 0.75 * t)
    bump = amp * (0.55 + 0.45 * t) * np.clip(1.0 - dist / np.maximum(wt, 1e-3), 0.0, 1.0)
    iy, ix = ys % h, xs % wd
    cur = H[np.ix_(iy, ix)]
    H[np.ix_(iy, ix)] = np.maximum(cur, bump.astype(np.float32) + 0.0 * cur)


def add_tufts(H, r2, n, lo, hi, k, pxs, extra_lean=0.0):
    """n tufts of grass blades (three to five blades fanned from one root) at random roots in [lo, hi) pixels."""
    for _ in range(n):
        cy, cx = r2.uniform(lo[0], hi[0]), r2.uniform(lo[1], hi[1])
        nb = r2.randint(3, 5)
        base_ang = r2.uniform(-0.25, 0.25) + extra_lean
        for j in range(nb):
            ang = base_ang + (j - (nb - 1) / 2.0) * r2.uniform(0.32, 0.5)
            add_blade(H, cy + r2.uniform(-0.3, 0.3) * k, cx + (j - (nb - 1) / 2.0) * 0.5 * k, ang, r2.uniform(2.6, 4.2) * k, 0.95 * k ** 0.5, 1.25 * k ** 0.6, pxs)


def grass_heights(S, seed=41, detail_b=None):
    """Grass module of 2 x 2 tiles. Every tile is the same periodic BASE (ground swell and a few blades that run across the tile
    edges, period one tile) plus its own DETAIL (tufts and swell that fade to nothing within `detail_b` pixels of the tile edge).
    Because the edge strips are base only, any tile can sit next to any tile, itself included, and the texture simply continues.
    Returns (H for the module in world units, info)."""
    ss, T, pxu = S.ss, S.T, S.pxu
    pxs = float(ss)
    n = T * ss
    k = (T / 16.0) ** 0.8
    b = detail_b if detail_b is not None else (3.0 if T <= 16 else 4.5)
    rng = np.random.RandomState(seed)
    Bs = np.zeros((n, n), np.float32)
    Bs += 0.42 * fft_noise((n, n), seed + 1, T / 6.0)
    add_tufts(Bs, rng, 1 if T <= 16 else 2, (0.0, 0.0), (T, T), k, pxs)
    c = (np.arange(n) + 0.5) / pxs
    edge = np.minimum(c, T - c)
    w1 = np.clip((edge - b) / 1.5, 0.0, 1.0)
    W = np.minimum(w1[:, None], w1[None, :])
    H = np.zeros((2 * n, 2 * n), np.float32)
    for vy in range(2):
        for vx in range(2):
            r2 = np.random.RandomState(seed + 100 + 7 * vy + vx)
            Dv = np.zeros((n, n), np.float32)
            Dv += 0.30 * fft_noise((n, n), seed + 10 + 3 * vy + vx, T / 6.5)
            add_tufts(Dv, r2, (2 + int(r2.rand() < 0.6)) if T <= 16 else 7, (b + 1.0, b + 3.5), (T - b - 1.0, T - b), k, pxs)
            Dv = np.where(W > 0.999, Dv, np.where(W > 0, Dv * W, 0.0))
            H[vy * n:(vy + 1) * n, vx * n:(vx + 1) * n] = Bs + Dv
    return (H * pxu).astype(np.float32), dict(b=b)


# -- water ------------------------------------------------------------------------------------------------------------------------
WATER_TONES = [20, 21, 22, 23]


def add_ripple(H, y0, x0, length, width, amp, curve, pxs):
    """Add one ripple: a low ridge along x, `length` pixels long, `width` pixels half wide, bowed by `curve` pixels, fading to nothing
    at both ends. Lit on its north slope, shaded on its south slope."""
    h, wd = H.shape
    ya, yb = int(np.floor((y0 - width - abs(curve) - 0.5) * pxs)), int(np.ceil((y0 + width + abs(curve) + 0.5) * pxs))
    xa, xb = int(np.floor((x0 - 0.5) * pxs)), int(np.ceil((x0 + length + 0.5) * pxs))
    ys, xs = np.arange(ya, yb), np.arange(xa, xb)
    Y, X = np.meshgrid((ys + 0.5) / pxs, (xs + 0.5) / pxs, indexing="ij")
    s_ = np.clip((X - x0) / length, 0.0, 1.0)
    env = np.sin(np.pi * s_) ** 0.8
    yc = y0 + curve * (s_ - 0.5) ** 2 * 4.0 - curve
    prof = np.cos(np.clip((Y - yc) / width, -1.0, 1.0) * np.pi / 2.0) ** 1.5
    iy, ix = ys % h, xs % wd
    H[np.ix_(iy, ix)] += (amp * env * prof).astype(np.float32)


def water_heights(S, seed=61, detail_b=None):
    """Water module of 2 x 2 tiles, same base-plus-detail construction as the grass: a periodic swell and a ripple that crosses the
    tile edge (base), plus ripples of its own well inside each tile (detail). Ripples are long in x: the water reads as horizontal
    dashes, a lit crest over a shaded trough."""
    ss, T, pxu = S.ss, S.T, S.pxu
    pxs = float(ss)
    n = T * ss
    k = (T / 16.0) ** 0.8
    kw = k ** 0.6
    b = detail_b if detail_b is not None else (3.0 if T <= 16 else 4.5)
    Bs = np.zeros((n, n), np.float32)
    Bs += 0.12 * (T / 16.0) ** 1.0 * fft_noise((n, n), seed + 1, T / 6.0, aniso=(1.0, 3.0))
    add_ripple(Bs, T * 0.64, T * 0.55, 6.0 * k, 0.55 * kw, 0.55 * kw, 0.0, pxs)           # runs across the right edge and wraps
    add_ripple(Bs, T * 0.14, T * 0.86, 6.0 * k, 0.55 * kw, 0.55 * kw, 0.0, pxs)
    if T >= 32:
        add_ripple(Bs, T * 0.10, T * 0.12, 9.0 * k, 0.55 * kw, 0.55 * kw, 0.0, pxs)
    c = (np.arange(n) + 0.5) / pxs
    edge = np.minimum(c, T - c)
    w1 = np.clip((edge - b) / 1.5, 0.0, 1.0)
    W = np.minimum(w1[:, None], w1[None, :])
    H = np.zeros((2 * n, 2 * n), np.float32)
    for vy in range(2):
        for vx in range(2):
            r2 = np.random.RandomState(seed + 100 + 7 * vy + vx)
            Dv = np.zeros((n, n), np.float32)
            Dv += 0.10 * (T / 16.0) ** 1.0 * fft_noise((n, n), seed + 10 + 3 * vy + vx, T / 6.0, aniso=(1.0, 3.0))
            ys_used = []
            for _ in range((4 if T <= 16 else 8)):
                ln = r2.uniform(4.5 if T <= 16 else 5.0, 8.5 if T <= 16 else 10.0) * k
                for _try in range(12):
                    yy_ = r2.uniform(b + 1.0, T - b - 1.0)
                    if all(abs(yy_ - u) >= 2.6 * k for u in ys_used):
                        break
                ys_used.append(yy_)
                add_ripple(Dv, yy_, r2.uniform(b + 0.3, max(b + 0.4, T - b - 0.3 - ln * 0.7)), ln,
                           r2.uniform(0.5, 0.62) * kw, r2.uniform(0.5, 0.7) * kw, 0.0, pxs)
            Dv = np.where(W > 0.999, Dv, np.where(W > 0, Dv * W, 0.0))
            H[vy * n:(vy + 1) * n, vx * n:(vx + 1) * n] = Bs + Dv
    return (H * pxu).astype(np.float32), dict(b=b)
# <<END LIT_SURF>>


# <<LIT_SHORE>>
# ---------------------------------------------------------------------------
# Autotiling with a bank: a patch of one surface laid on another (water in grass, a wood rug on stone). The patch outline comes from
# the same blurred, noise-pushed cell mask as the prototype (a tile's pixels depend only on its 3 x 3 cells, so every transition tile
# is generated alone and still meets its neighbours). What is new is the bank: its shading follows the raking light.
#
#   lowered patch (water): the bank slopes down into it, so grass on the side away from the light is shaded, grass on the lit side
#     is lit, and the water under a shaded bank sits in its cast shadow.
#   raised patch (a rug): its own rim is lit where it faces the light and shaded where it faces away, and the floor beyond a shaded
#     rim sits in the rim's cast shadow.
# ---------------------------------------------------------------------------
RAMP_EXT = {
    "grass": [9, 16, 17, 18, 19],
    "water": [12, 20, 21, 22, 23],
    "stone": [0, 24, 25, 26, 27],
    "wood": [1, 45, 37, 2, 44],
}


def step_tone(idx, ramp, steps):
    """The tone `steps` steps lighter (+) or darker (-) than idx on a ramp, clamped to its ends. A tone not on the ramp is first
    snapped to the nearest step by value."""
    ramp = np.asarray(ramp, np.int32)
    out = np.zeros(idx.shape, np.int32)
    pos = np.full(idx.shape, -1, np.int32)
    for i, v in enumerate(ramp):
        pos = np.where(idx == v, i, pos)
    pos = np.where(pos < 0, len(ramp) // 2, pos)
    return ramp[np.clip(pos + steps, 0, len(ramp) - 1)].astype(np.uint8)


def dilate4(m):
    return m | shift(m, -1, 0, False) | shift(m, 1, 0, False) | shift(m, 0, -1, False) | shift(m, 0, 1, False)


def bank_light(m, raised):
    """Per pixel: how much the bank there faces the key light (+1 toward it, -1 away), from the gradient of the blurred patch mask.
    The bank slopes toward the lower surface: into the patch for a lowered one, away from it for a raised one."""
    f = box_blur(box_blur(m.astype(np.float32), 2), 1)
    gx = shift(f, 0, 1, 0.0) - shift(f, 0, -1, 0.0)                # shift(a, 0, 1) reads the pixel to the right: positive when the patch lies right
    gy = shift(f, 1, 0, 0.0) - shift(f, -1, 0, 0.0)                # positive when the patch lies below (screen down)
    sgn = -1.0 if raised else 1.0
    dx, dy_up = sgn * gx, -sgn * gy
    mag = np.sqrt(dx * dx + dy_up * dy_up) + 1e-6
    dxn, dyn = dx / mag, dy_up / mag
    return np.where(mag > 0.02, (dxn * LITE[0] + dyn * LITE[1]) / LXY, 0.0)       # LITE xy is (-LXY, LXY): +1 faces the light


def shore_shade(under, over, m, raised, cls_under, cls_over, allowed):
    """Compose under and over with the patch mask m and shade the bank, only on pixels of `allowed` (the patch cells, so every change
    lands in a tile that exists as a transition tile). Returns the pixel array."""
    out = np.where(m, over, under)
    bl = bank_light(m, raised)
    outer = ~m & dilate4(m) & allowed   # under pixels against the patch
    inner = m & dilate4(~m) & allowed   # patch pixels against the under surface
    ru, ro = RAMP_EXT[cls_under], RAMP_EXT[cls_over]
    lit, dark = bl > 0.35, bl < -0.35
    if not raised:      # water: grass lip lit or shaded by the bank, water in the bank's shadow
        out = np.where(outer & lit, step_tone(out, ru, +1), out)
        out = np.where(outer & dark, step_tone(out, ru, -1), out)
        out = np.where(inner & dark, step_tone(out, ro, -1), out)
        out = np.where(inner & lit, step_tone(out, ro, +1), out)
        second = inner2(m) & dark & allowed
        out = np.where(second, step_tone(out, ro, -1), out)
    else:               # rug: its rim lit or shaded, the floor beyond a shaded rim in shadow
        out = np.where(inner & lit, step_tone(out, ro, +1), out)
        out = np.where(inner & dark, step_tone(out, ro, -1), out)
        out = np.where(outer & dark, step_tone(out, ru, -1), out)
        second = outer2(m) & dark & allowed
        out = np.where(second, step_tone(out, ru, -1), out)
    return out


def inner2(m):
    """Patch pixels two steps from the edge (the second pixel in)."""
    e = m & dilate4(~m)
    return m & ~e & dilate4(e)


def outer2(m):
    e = ~m & dilate4(m)
    return ~m & ~e & dilate4(e)


def blend_layers_lit(under, over, cells, T, cls_under, cls_over, raised, seed=7):
    """Autotile two full-map pixel layers. `cells` marks the tiles of the `over` patch. Returns (hard, soft, stats). Every patch tile is
    made alone from its 3 x 3 cells (and the two layers' tiles there), cropped, placed, and the whole map is also made in one go:
    stats counts the pixels where the two disagree (must be 0) for the mask and for the final, shaded tiles."""
    rows, cols = cells.shape
    noise = periodic_noise(T, seed)
    hard = np.where(np.kron(cells > 0, np.ones((T, T), bool)), over, under)
    m_whole = transition_mask(cells, T, noise)
    in_patch = np.kron(cells > 0, np.ones((T, T), bool))
    whole = shore_shade(under, over, m_whole, raised, cls_under, cls_over, in_patch)
    padded = np.pad(cells, 1, constant_values=0)
    up = np.pad(under, T, mode="edge")
    ov = np.pad(over, T, mode="edge")
    soft = under.copy()
    sigs = set()
    mask_bad = 0
    for r in range(rows):
        for c in range(cols):
            if not cells[r, c]:
                continue
            ctx = padded[r:r + 3, c:c + 3]
            sigs.add(tuple(ctx.ravel().tolist()))
            mt = transition_mask(ctx, T, noise)
            mask_bad += int((mt[T:2 * T, T:2 * T] != m_whole[r * T:(r + 1) * T, c * T:(c + 1) * T]).sum())
            u_ctx = up[r * T:(r + 3) * T, c * T:(c + 3) * T]
            o_ctx = ov[r * T:(r + 3) * T, c * T:(c + 3) * T]
            tile = shore_shade(u_ctx, o_ctx, mt, raised, cls_under, cls_over, np.kron(ctx > 0, np.ones((T, T), bool)))[T:2 * T, T:2 * T]
            soft[r * T:(r + 1) * T, c * T:(c + 1) * T] = tile
    final_bad = int((soft != np.where(in_patch, whole, under)).sum())
    free = shore_shade(under, over, m_whole, raised, cls_under, cls_over, np.ones_like(in_patch))
    dropped = int(((free != under) & ~in_patch).sum())
    return hard, soft, {"signaturesUsed": len(sigs), "maskMismatchPixels": mask_bad, "shadedTileMismatchPixels": final_bad,
                        "bankPixelsDroppedAtCellEdges": dropped}
# <<END LIT_SHORE>>


# ---------------------------------------------------------------------------
# The Knight, for scale
# ---------------------------------------------------------------------------

def knight_frame(size_id="16x24", clip="idle", facing="down", index=0, loadout="sword_shield"):
    with open(FRAMES_JSON) as fh:
        doc = json.load(fh)
    meta = doc["sizes"][size_id]
    for c in doc["clips"]:
        if c["loadout"] == loadout and c["size"] == size_id and c["clip"] == clip and c["dir"] == facing:
            raw = zlib.decompress(base64.b64decode(c["data"]))
            n = meta["canvasW"] * meta["canvasH"]
            arr = np.frombuffer(raw, np.uint8)[index * n:(index + 1) * n].reshape(meta["canvasH"], meta["canvasW"]).copy()
            return arr
    raise RuntimeError("knight frame not found")


def trim(a):
    """Crop a sprite to its solid bounding box, keeping the bottom row as the ground line. Returns (array, x offset of centre)."""
    solid = a != TRANSPARENT
    ys, xs = np.nonzero(solid)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1], (xs.min() + xs.max()) / 2.0


def blit(dst, src, x, y):
    """Paint src (255 transparent) onto dst with its top-left at (x, y); clips at the edges."""
    h, w = src.shape
    y0, x0 = max(0, y), max(0, x)
    y1, x1 = min(dst.shape[0], y + h), min(dst.shape[1], x + w)
    if y1 <= y0 or x1 <= x0:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    d = dst[y0:y1, x0:x1]
    d[:] = np.where(s != TRANSPARENT, s, d)


def stand(dst, sprite, tile_c, tile_r, T, dx=0):
    """Stand a bottom-anchored sprite on tile (c, r): bottom row on the tile's bottom edge, centred on the tile."""
    h, w = sprite.shape
    x = tile_c * T + (T - w) // 2 + dx
    y = (tile_r + 1) * T - h
    blit(dst, sprite, x, y)


# ---------------------------------------------------------------------------
# Approach A: the tile set
# ---------------------------------------------------------------------------

WALL_THICK = 2.0    # the pack's walls are 1 unit thick (half a tile); the game's are a full tile, so the cap is stretched to 2


def wall_run(names, y=0.0, rotz=0.0, kz=1.0, thick=WALL_THICK):
    """A run of wall modules 4 units apart starting at x=0, stretched to a full tile of thickness."""
    out = []
    for i, n in enumerate(names):
        x = (i - (len(names) - 1) / 2.0) * 4.0
        out.append(dict(name=n, loc=(x, y, 0.0), rotz=rotz, scale=(1.0, thick, kz)))
    return out


def build_tiles(kit, pal):
    """Render every tile of approach A. Returns (tiles, sprites, sheet_items) where tiles are (T,T) arrays."""
    T = kit.T
    tiles, sprites = {}, {}

    def cut(arr, cols, rows, prefix, order=None):
        for r in range(rows):
            for c in range(cols):
                tiles[f"{prefix}_{c}{r}"] = arr[r * T:(r + 1) * T, c * T:(c + 1) * T].copy()

    t0 = time.time()
    # (floors and wall caps are the lit surfaces now: build_lit_surfaces)

    # -- wall faces, front on. Wall modules 4 units tall = 2 tile rows.
    run = kit.face(wall_run(["wall", "wall_cracked", "wall"], y=0.0), 0, 2.0, 5, 2)
    for i in range(5):
        tiles[f"face_up_{i}"] = run[:T, i * T:(i + 1) * T].copy()
        tiles[f"face_dn_{i}"] = run[T:, i * T:(i + 1) * T].copy()
    door = kit.face(wall_run(["wall", "wall_doorway", "wall"]), 0, 2.0, 5, 2)
    tiles["door_up"], tiles["door_dn"] = door[:T, 2 * T:3 * T].copy(), door[T:, 2 * T:3 * T].copy()
    tiles["door_side_l_up"], tiles["door_side_l_dn"] = door[:T, 1 * T:2 * T].copy(), door[T:, 1 * T:2 * T].copy()
    tiles["door_side_r_up"], tiles["door_side_r_dn"] = door[:T, 3 * T:4 * T].copy(), door[T:, 3 * T:4 * T].copy()
    # the same doorway with the door leaf removed: what the open door looks like (the hole is dark, the room beyond)
    st = kit.st
    st.clear()
    st.place_all(wall_run(["wall", "wall_doorway", "wall"], ))
    for o in list(st.objs):
        if o.name == "wall_doorway_door":
            bpy.data.objects.remove(o, do_unlink=True)
            st.objs.remove(o)
    w, h = 5 * T, 2 * T
    st.aim(0.0, (0, 0, 2.0), (w / 2.0, h / 2.0), w, h, kit.ppu)
    ps = st.passes(w, h)
    opened = st.quantise(ps, h, w, (FRONT,), prop=True, bias=FACE_BIAS)
    opened = np.where(opened == TRANSPARENT, 6, opened)
    tiles["door_open_up"], tiles["door_open_dn"] = opened[:T, 2 * T:3 * T].copy(), opened[T:, 2 * T:3 * T].copy()
    # the same wall squashed to ONE tile row (kz 0.5), which is what the game's current walls are: a face one tile tall
    run1 = kit.face(wall_run(["wall", "wall_cracked", "wall"], kz=0.5), 0, 1.0, 5, 1)
    for i in range(5):
        tiles[f"face1_{i}"] = run1[:, i * T:(i + 1) * T].copy()
    door1 = kit.face(wall_run(["wall", "wall_doorway", "wall"], kz=0.5), 0, 1.0, 5, 1)
    tiles["door1"] = door1[:, 2 * T:3 * T].copy()
    tiles["door1_side_l"], tiles["door1_side_r"] = door1[:, T:2 * T].copy(), door1[:, 3 * T:4 * T].copy()
    torch1 = kit.face(wall_run(["wall", "wall", "wall"], kz=0.5) + [dict(name="torch_mounted", loc=(0.0, -WALL_THICK / 2.0, 1.25), scale=(1, 1, 1))],
                      0, 1.0, 5, 1)
    tiles["face1_torch"] = torch1[:, 2 * T:3 * T].copy()
    # a banner hung on the full height wall (two tiles tall)
    ban = kit.face(wall_run(["wall", "wall", "wall"]) + [dict(name="banner_red", loc=(0.0, -WALL_THICK / 2.0 + 0.5, 0.0))], 0, 2.0, 5, 2)
    tiles["banner_up"], tiles["banner_dn"] = ban[:T, 2 * T:3 * T].copy(), ban[T:, 2 * T:3 * T].copy()
    # a window, and a wall torch (an upper-face tile with torch_mounted hung on it)
    win = kit.face(wall_run(["wall", "wall_window_open", "wall"]), 0, 2.0, 5, 2)
    tiles["win_up"], tiles["win_dn"] = win[:T, 2 * T:3 * T].copy(), win[T:, 2 * T:3 * T].copy()
    torch = kit.face(wall_run(["wall", "wall", "wall"]) + [dict(name="torch_mounted", loc=(0.0, -WALL_THICK / 2.0, 2.85))], 0, 2.0, 5, 2)
    tiles["face_torch_up"] = torch[:T, 2 * T:3 * T].copy()
    log("walls done %.1fs" % (time.time() - t0))

    # -- props, from the character camera
    for key, piece, sc in (("chest", "chest", 1.0), ("chest_gold", "chest_gold", 1.0), ("barrel", "barrel_large", 1.0),
                           ("barrel_small", "barrel_small", 1.0), ("crate", "box_large", 1.0),
                           ("crates", "crates_stacked", 0.95), ("torch", "torch_lit", 1.0), ("table", "table_medium", 1.0),
                           ("table_long", "table_long", 1.0), ("chair", "chair", 1.0), ("stool", "stool", 1.0),
                           ("bed", "bed_decorated", 0.7), ("pillar", "pillar", 1.0), ("column", "column", 1.0),
                           ("shelf", "shelves", 1.0), ("keg", "keg_decorated", 1.0), ("stairs", "stairs_narrow", 0.8),
                           ("coins", "coin_stack_large", 1.6), ("sword_shield", "sword_shield", 1.0)):
        try:
            sprites[key] = kit.prop(piece, scale=sc)
        except Exception as e:   # a missing piece must not sink the run
            log("prop", key, "failed:", repr(e))
    log("props done %.1fs" % (time.time() - t0))
    return tiles, sprites




# ---------------------------------------------------------------------------
# The sample room, from tiles (approach A)
# ---------------------------------------------------------------------------
COLS, ROWS = 12, 9
WOOD_COLS, WOOD_ROWS = (6, 8), (4, 6)          # block origins of the wood rug: cols 6..9, rows 4..7
# (piece, (col, row), scale): the props both the tile room and the single-camera rooms stand on the floor
ROOM_PROPS = [("barrel_large", (1, 3), 1.0), ("box_large", (2, 3), 1.0), ("chest", (10, 3), 1.0), ("torch_lit", (5, 5), 1.0),
              ("table_medium", (7, 5), 1.0), ("chair", (6, 5), 1.0), ("barrel_small", (10, 7), 1.0)]
# One camera has to light the floor, the wall face and the props with one light, so the face gets less of it.
SINGLE_LIGHT = np.array([-0.45, 0.25, 0.85], np.float32)
SINGLE_LIGHT /= np.linalg.norm(SINGLE_LIGHT)
SINGLE_LAM_REF = 0.79
# Layout, FF6 style: row 0 wall top, rows 1-2 the north wall's face (two tiles tall), rows 3-7 floor, row 8 the south wall's top.
# Columns 0 and 11 are the side walls seen as their tops.


def compose_room(tiles, sprites, T, knight=None, after_floor=None):
    room = np.full((ROWS * T, COLS * T), 6, np.uint8)

    def put(c, r, key):
        blit(room, tiles[key], c * T, r * T)

    # caps
    put(0, 0, "cap_nw")
    put(COLS - 1, 0, "cap_ne")
    put(0, ROWS - 1, "cap_sw")
    put(COLS - 1, ROWS - 1, "cap_se")
    for c in range(1, COLS - 1):
        k = "cap_h_0" if c % 2 == 0 else "cap_h_1"
        put(c, 0, k)
        put(c, ROWS - 1, k)
    for r in range(1, ROWS - 1):
        k = "cap_v_0" if r % 2 == 0 else "cap_v_1"
        put(0, r, k)
        put(COLS - 1, r, k)
    # north wall face. Even columns sit on a module's centre block (run tiles 0 or 4), odd columns on a joint (1 or 3).
    door_c, win_c = 4, 8
    for c in range(1, COLS - 1):
        if c % 2 == 0:
            i = 0 if (c // 2) % 2 else 4
        else:
            i = 1 if (c // 2) % 2 else 3
        up, dn = f"face_up_{i}", f"face_dn_{i}"
        if c == door_c:
            up, dn = "door_up", "door_dn"
        elif c == door_c - 1:
            up, dn = "door_side_l_up", "door_side_l_dn"
        elif c == door_c + 1:
            up, dn = "door_side_r_up", "door_side_r_dn"
        elif c == win_c:
            up, dn = "win_up", "win_dn"
        elif c in (2, 6, 10):
            up = "face_torch_up"
        put(c, 1, up)
        put(c, 2, dn)
    # floor: stone, with a wood patch. Tile (c, r) takes the quadrant of the 4 x 4 unit floor module it sits on.
    for r in range(3, ROWS - 1):
        for c in range(1, COLS - 1):
            kind = "stone"
            if 6 <= c <= 9 and 4 <= r <= 7:
                kind = "wood"
            put(c, r, f"floor_{kind}_{c % 2}{r % 2}")
    if after_floor is not None:
        after_floor(room)
    # props
    keys = {"barrel_large": "barrel", "box_large": "crate", "chest": "chest", "torch_lit": "torch", "table_medium": "table",
            "chair": "chair", "barrel_small": "barrel_small"}
    for piece, (c, r), _ in ROOM_PROPS:
        stand(room, sprites[keys[piece]], c, r, T)
    if knight is not None:
        k, _ = trim(knight)
        stand(room, k, 4, 5, T)
    return room




# ---------------------------------------------------------------------------
# Approach B and C: one camera, the whole room, then cut into cells
# ---------------------------------------------------------------------------







# ---------------------------------------------------------------------------
# The game's current art, for the side by side
# ---------------------------------------------------------------------------

def load_current():
    with open(CURRENT_JSON) as fh:
        d = json.load(fh)["sprites"]
    out = {}
    for k, rows in d.items():
        a = np.array(rows, np.int32)
        a = np.where(a < 0, TRANSPARENT, a).astype(np.uint8)
        out[k] = a
    return out


def compose_current_room(cur):
    """The same room from the game's own tiles: the layout its DM prompt teaches (top along the north edge, plain wall faces
    for the sides, base along the south). The north wall is one face row, since that is all the game has."""
    T = 16
    room = np.full((ROWS * T, COLS * T), 6, np.uint8)

    def put(c, r, key):
        blit(room, cur[key], c * T, r * T)

    for c in range(COLS):
        put(c, 0, "wall_stone_top")
        put(c, ROWS - 1, "wall_stone_base")
    for r in range(1, ROWS - 1):
        put(0, r, "wall_stone")
        put(COLS - 1, r, "wall_stone")
    for c in range(1, COLS - 1):
        put(c, 1, ["wall_stone", "wall_stone_b", "wall_stone_c"][c % 3])
    for r in range(2, ROWS - 1):
        for c in range(1, COLS - 1):
            put(c, r, ["floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d"][(c * 3 + r * 5) % 4])
    put(4, 1, "door_closed")
    stand(room, cur["torch"], 2, 2, T)
    stand(room, cur["torch"], 8, 2, T)
    stand(room, cur["chest"], 10, 2, T)
    put(6, 5, "table_w")
    put(7, 5, "table_e")
    blit(room, cur["token_knight"], 4 * T, 5 * T - 8)
    return room


# ---------------------------------------------------------------------------
# Sheets
# ---------------------------------------------------------------------------

def sheet(items, cols, T, pal, path, zoom=1, pad=2, bg=(72, 72, 80)):
    """items: list of arrays (any size); laid out on a grid of fixed cells sized to the largest item."""
    ch = max(a.shape[0] for a in items)
    cw = max(a.shape[1] for a in items)
    rows = (len(items) + cols - 1) // cols
    canvas = np.full((rows * (ch + pad) + pad, cols * (cw + pad) + pad), TRANSPARENT, np.uint8)
    for i, a in enumerate(items):
        r, c = divmod(i, cols)
        blit(canvas, a, pad + c * (cw + pad), pad + (r + 1) * (ch + pad) - a.shape[0])
    rgba = pal.rgba(canvas, bg)
    if zoom > 1:
        rgba = np.repeat(np.repeat(rgba, zoom, 0), zoom, 1)
    write_png(path, rgba)


def save_pair(name, idx, pal, zoom):
    pal.save(name + ".png", idx, 1)
    pal.save(name + f"@{zoom}x.png", idx, zoom)


# ---------------------------------------------------------------------------
# A tiny 3x5 bitmap font for labels (there is no Pillow here)
# ---------------------------------------------------------------------------
_G = {
    "A": "010101111101101", "B": "110101110101110", "C": "011100100100011", "D": "110101101101110",
    "E": "111100110100111", "F": "111100110100100", "G": "011100101101011", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101010", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "Q": "010101101110011", "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101010010010", "Z": "111001010100111", "0": "111101101101111", "1": "010110010010111",
    "2": "110001010100111", "3": "110001010001110", "4": "101101111001001", "5": "111100110001110",
    "6": "011100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001110",
    ".": "000000000000010", "-": "000000111000000", ":": "000010000010000", "/": "001001010100100",
    "+": "000010111010000", " ": "000000000000000", "(": "001010010010001", ")": "100010010010100",
}


def draw_text(rgba, text, x, y, color=(235, 235, 235), scale=1):
    for i, ch in enumerate(text.upper()):
        g = _G.get(ch, _G[" "])
        for k, bit in enumerate(g):
            if bit == "1":
                gy, gx = divmod(k, 3)
                px, py = x + (i * 4 + gx) * scale, y + gy * scale
                rgba[py:py + scale, px:px + scale, :3] = color
                rgba[py:py + scale, px:px + scale, 3] = 255


def stack(*arrs):
    """Stack tiles vertically (top first), centring a narrower one."""
    w = max(a.shape[1] for a in arrs)
    out = []
    for a in arrs:
        if a.shape[1] < w:
            left = (w - a.shape[1]) // 2
            pad_l = np.full((a.shape[0], left), TRANSPARENT, np.uint8)
            pad_r = np.full((a.shape[0], w - a.shape[1] - left), TRANSPARENT, np.uint8)
            a = np.concatenate([pad_l, a, pad_r], 1)
        out.append(a)
    return np.concatenate(out, 0)


def compare_rooms(pal, left, right, left_label, right_label, path, zoom):
    gap, top = 8, 10
    h = max(left.shape[0], right.shape[0])
    w = left.shape[1] + gap + right.shape[1]
    canvas = np.zeros((h + top + gap, w + 2 * gap, 4), np.uint8)
    canvas[..., :3] = (40, 40, 48)
    canvas[..., 3] = 255
    canvas[top:top + left.shape[0], gap:gap + left.shape[1]] = pal.rgba(left)
    x2 = gap + left.shape[1] + gap
    canvas[top:top + right.shape[0], x2:x2 + right.shape[1]] = pal.rgba(right)
    draw_text(canvas, left_label, gap, 2)
    draw_text(canvas, right_label, x2, 2)
    write_png(path, np.repeat(np.repeat(canvas, zoom, 0), zoom, 1))




# ---------------------------------------------------------------------------
# Autotiling: transitions between two floors, made from two rendered tiles and a mask
# ---------------------------------------------------------------------------

def periodic_noise(T, seed):
    """Value noise that tiles with period T, so a mask built from it agrees across every tile border."""
    n = 4
    rng = np.random.RandomState(seed)
    g = rng.rand(n, n)
    ys, xs = np.mgrid[0:T, 0:T] * (n / float(T))
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = g[y0 % n, x0 % n], g[y0 % n, (x0 + 1) % n]
    c, d = g[(y0 + 1) % n, x0 % n], g[(y0 + 1) % n, (x0 + 1) % n]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy - 0.5


def box_blur(a, r):
    k = 2 * r + 1
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        p = np.pad(a, pad, mode="constant")
        c = np.cumsum(p, axis=axis)
        a = (np.take(c, np.arange(k, c.shape[axis]), axis=axis) - np.take(c, np.arange(0, c.shape[axis] - k), axis=axis)) / float(k)
    return a


def transition_mask(cells, T, noise, thr=0.74, amp=0.22):
    """cells: 2D 0/1 array of patch cells (1 = patch). Returns a pixel mask of the patch: the cell grid blurred, so corners round
    off and the boundary pulls in from the cell edge, then pushed around by tile-periodic noise. A tile's pixels depend only on its
    3 x 3 neighbourhood (the blur reaches 2r < T), so any tile can be made on its own and still meet its neighbours."""
    big = np.kron(cells.astype(np.float32), np.ones((T, T), np.float32))
    r = max(2, T // 4)
    v = box_blur(box_blur(big, r), r)
    nz = np.tile(noise, cells.shape)
    return (v + amp * nz > thr) & np.kron(cells > 0, np.ones((T, T), bool))


def shade_index(idx, cls, steps):
    """The palette index `steps` ramp steps darker than idx inside its class ramp (its second step if idx is not on the ramp)."""
    ramp = RAMPS[cls]
    where = [i for i, v in enumerate(ramp) if v == idx]
    if not where:
        return ramp[1]
    return ramp[max(0, where[0] - steps)]




def titled(pal, arr, title, path, zoom):
    rgba = pal.rgba(arr)
    canvas = np.zeros((rgba.shape[0] + 10, rgba.shape[1] + 8, 4), np.uint8)
    canvas[..., :3] = (40, 40, 48)
    canvas[..., 3] = 255
    canvas[10:, 4:-4] = rgba
    draw_text(canvas, title, 4, 2)
    write_png(path, np.repeat(np.repeat(canvas, zoom, 0), zoom, 1))




# ---------------------------------------------------------------------------
# Outdoors: the Medieval Hexagon pack (a second CC0 KayKit pack), to see whether grass, water and nature can come from KayKit too
# ---------------------------------------------------------------------------
HEX = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env", "hexagon", "addons", "kaykit_medieval_hexagon_pack", "Assets", "gltf")
HEX_W, HEX_ROW = 2.0, 2.0 * 0.8660254      # a pointy-top hex is 2 units across; rows of a lattice are 1.732 apart


def hex_finder():
    idx = {}
    for dp, _, fn in os.walk(HEX):
        for f in fn:
            if f.endswith(".gltf"):
                idx[f[:-5]] = os.path.join(dp, f)
    return lambda name: idx[name]


def hex_field(piece_at, cx, cy, tiles_w, tiles_h):
    """Placements of a hex lattice that covers the tiles_w x tiles_h tile area centred on (cx, cy). piece_at(i, j) -> piece name."""
    wu, hu = tiles_w * UNITS_PER_TILE, tiles_h * UNITS_PER_TILE
    out = []
    j0, j1 = int(math.floor((cy - hu / 2) / HEX_ROW)) - 1, int(math.ceil((cy + hu / 2) / HEX_ROW)) + 1
    for j in range(j0, j1 + 1):
        off = 1.0 if j % 2 else 0.0
        i0, i1 = int(math.floor((cx - wu / 2 - off) / HEX_W)) - 1, int(math.ceil((cx + wu / 2 - off) / HEX_W)) + 1
        for i in range(i0, i1 + 1):
            out.append(dict(name=piece_at(i, j), loc=(i * HEX_W + off, j * HEX_ROW, 0.0)))
    return out


# <<MAIN>>
# ---------------------------------------------------------------------------
# The lit surface set: stone floor, wood floor, wall caps, grass, water
# ---------------------------------------------------------------------------
def build_lit_surfaces(st, T, report):
    """Build every ground tile from heightfields. Returns (tiles, modules): tiles are (T, T) index arrays named as the prototype
    named them (floor_stone_{c}{r}, floor_wood_{c}{r}, cap_*), plus grass_{c}{r} and water_{c}{r}; modules are the 2 x 2 tile
    arrays they were cut from."""
    ss = 8 if T <= 16 else 6
    ppu = T / UNITS_PER_TILE
    tiles, modules, secs = {}, {}, {}

    def cut(mod, prefix):
        for r in range(2):
            for c in range(2):
                tiles[f"{prefix}_{c}{r}"] = mod[r * T:(r + 1) * T, c * T:(c + 1) * T].copy()

    t0 = time.time()
    S = Surf(st, T, ss, 2, 2)
    # stone floor
    H, _ = stone_heights(S)
    Vp, m = S.light(H)
    idx, _ = tone_and_clean(Vp, STONE_TONES, 2.0, 5.0)
    modules["stone"] = idx[m:m + S.Hh, m:m + S.W]
    cut(modules["stone"], "floor_stone")
    secs["stone"] = round(time.time() - t0, 1)
    # wood floor
    t1 = time.time()
    H, _ = wood_heights(S)
    Vp, m = S.light(H, reach_px=2.0, ao_px=1.0, ao_k=0.12)
    idx, _ = tone_and_clean(Vp, WOOD_TONES, 2.2, 3.0, passes=1, off=pixel_layer(S, S.tone_shift))
    modules["wood"] = idx[m:m + S.Hh, m:m + S.W]
    cut(modules["wood"], "floor_wood")
    secs["wood"] = round(time.time() - t1, 1)
    # grass
    t1 = time.time()
    H, _ = grass_heights(S)
    Vp, m = S.light(H, reach_px=2.2, ao_px=1.0, ao_k=0.45)
    idx, _ = tone_dominant(S, GRASS_TONES, 2.2, 3.0)
    modules["grass"] = idx[m:m + S.Hh, m:m + S.W]
    cut(modules["grass"], "grass")
    secs["grass"] = round(time.time() - t1, 1)
    # water
    t1 = time.time()
    H, _ = water_heights(S)
    Vp, m = S.light(H, reach_px=2.0, ao_px=1.0, ao_k=0.25, shadow_k=0.6, spec_k=0.6, spec_p=30.0)
    idx, _ = tone_dominant(S, WATER_TONES, 1.0, 2.6)
    modules["water"] = idx[m:m + S.Hh, m:m + S.W]
    cut(modules["water"], "water")
    secs["water"] = round(time.time() - t1, 1)
    # wall caps: one block per tile; the corners take their outline from the KayKit wall_corner
    t1 = time.time()
    S1 = Surf(st, T, ss, 1, 1)

    def cap(seed, footprint=None, crack=False):
        H, sd, body = cap_heights(S1, seed, footprint=footprint, crack=crack)
        Vp, m = S1.light(H, reach_px=2.0, ao_px=1.0, ao_k=0.3, wrap=False, low=-1.5 * S1.pxu)
        idx, _ = tone_and_clean(Vp, CAP_TONES, 2.0, 3.0, passes=1)
        return idx[m:m + T, m:m + T]

    tiles["cap_h_0"], tiles["cap_h_1"] = cap(31), cap(32, crack=True)
    tiles["cap_v_0"], tiles["cap_v_1"] = cap(33), cap(34, crack=True)
    for key, rot, seed in (("ne", 0.0, 35), ("nw", 90.0, 36), ("sw", 180.0, 37), ("se", 270.0, 38)):
        D, _ = kk_depth(st, [dict(name="wall_corner", rotz=rot, scale=(WALL_THICK, WALL_THICK, 1.0))], T, T, ppu, ss)
        tiles[f"cap_{key}"] = cap(seed, footprint=D > 3.9)
    secs["caps"] = round(time.time() - t1, 1)
    report["surfaceSeconds"] = secs
    return tiles, modules


# ---------------------------------------------------------------------------
# Seams
# ---------------------------------------------------------------------------
def lum_of(a):
    rgb = PAL.rgb.astype(np.float32)
    return (rgb[a.astype(np.int32)] * np.array([0.30, 0.59, 0.11], np.float32)).sum(-1)


def jump(a, b, axis, thr=14.0):
    """Share of boundary pixels whose luminance jumps by more than thr (of 255) between a's last and b's first column (row),
    against the same share between a's last two columns (rows): what a seam costs against what the texture costs anyway."""
    la, lb = lum_of(a), lum_of(b)
    if axis == 1:
        return float((np.abs(la[:, -1] - lb[:, 0]) > thr).mean()), float((np.abs(la[:, -2] - la[:, -1]) > thr).mean())
    return float((np.abs(la[-1, :] - lb[0, :]) > thr).mean()), float((np.abs(la[-2, :] - la[-1, :]) > thr).mean())


def inside_all(a, axis, thr=14.0):
    """Share of ALL neighbouring pixel pairs inside a tile (along the axis) whose luminance jumps by more than thr: the texture's own
    busyness, the fair baseline for a seam."""
    la = lum_of(a)
    return float((np.abs(np.diff(la, axis=axis)) > thr).mean())


def lum_gap(a, b, axis):
    """Mean absolute luminance difference across the boundary, in 0..255 (lower is smoother)."""
    la, lb = lum_of(a), lum_of(b)
    return float(np.abs(la[:, -1] - lb[:, 0]).mean()) if axis == 1 else float(np.abs(la[-1, :] - lb[0, :]).mean())


def seam_stats(tiles, T):
    """Seam numbers. Floors (a lattice, made as a 2 x 2 module): quadrants inside a module and the module next to itself, as the
    prototype measured them. Grass and water (any tile beside any tile, itself included): every ordered pair of the four variants,
    both directions. Caps: block to block along a run and around the corners (the dark joint is deliberate, see notes)."""
    rep = {}
    q = lambda kind: (lambda c, r: tiles[f"{kind}_{c}{r}"])
    for kind in ("floor_stone", "floor_wood"):
        t = q(kind)
        pairs = {"quadrants inside a module, left to right": (t(0, 0), t(1, 0), 1), "quadrants inside a module, top to bottom": (t(0, 0), t(0, 1), 0),
                 "module next to itself, left to right": (t(1, 0), t(0, 0), 1), "module next to itself, top to bottom": (t(0, 1), t(0, 0), 0)}
        for k, (a, b, ax) in pairs.items():
            j = jump(a, b, ax)
            rep[f"{kind}: {k}"] = {"across": round(j[0], 3), "inside": round(j[1], 3), "insideAll": round((inside_all(a, ax) + inside_all(b, ax)) / 2, 3),
                                   "meanLumGap": round(lum_gap(a, b, ax), 1)}
    for kind in ("grass", "water"):
        vs = [tiles[f"{kind}_{c}{r}"] for r in range(2) for c in range(2)]
        for name, ax in (("left to right", 1), ("top to bottom", 0)):
            ac, ins, gaps, exact = [], [], [], 0
            for a in vs:
                for b in vs:
                    j = jump(a, b, ax)
                    ac.append(j[0])
                    ins.append(j[1])
                    gaps.append(lum_gap(a, b, ax))
            rep[f"{kind}: any variant beside any variant (16 pairs), {name}"] = {
                "across": round(float(np.mean(ac)), 3), "acrossWorst": round(float(np.max(ac)), 3), "inside": round(float(np.mean(ins)), 3),
                "insideAll": round(float(np.mean([inside_all(v, ax) for v in vs])), 3), "meanLumGap": round(float(np.mean(gaps)), 1),
                "meanLumGapInside": round(float(np.mean([np.abs(np.diff(lum_of(v), axis=ax)).mean() for v in vs])), 1)}
    for i, (a, b) in enumerate((("cap_h_0", "cap_h_1"), ("cap_h_1", "cap_h_0"), ("cap_h_1", "cap_h_1"), ("cap_nw", "cap_h_1"), ("cap_h_0", "cap_ne"))):
        j = jump(tiles[a], tiles[b], 1)
        rep[f"wall cap: {a} then {b} (joint column)"] = {"across": round(j[0], 3), "inside": round(j[1], 3), "insideAll": round(inside_all(tiles[a], 1), 3),
                                                        "note": "deliberate joint: a dark column ends each block"}
    for a, b in (("cap_v_0", "cap_v_1"), ("cap_v_1", "cap_v_0"), ("cap_nw", "cap_v_1"), ("cap_v_0", "cap_sw")):
        j = jump(tiles[a], tiles[b], 0)
        rep[f"wall cap: {a} over {b} (joint row)"] = {"across": round(j[0], 3), "inside": round(j[1], 3), "insideAll": round(inside_all(tiles[a], 0), 3),
                                                     "note": "deliberate joint: a dark row ends each block"}
    return rep


def border_continuity(tiles, kind, T):
    """Grass and water are a shared periodic base with private detail inside each tile. This checks the claim directly: the two
    columns (rows) at each tile edge differ from the same two columns of another variant by how many pixels? 0 means the edge
    strips of the four variants are identical, so a tile can sit anywhere."""
    vs = [tiles[f"{kind}_{c}{r}"] for r in range(2) for c in range(2)]
    worst = 0
    for a in vs:
        for b in vs:
            worst = max(worst, int((a[:, :2] != b[:, :2]).sum()), int((a[:, -2:] != b[:, -2:]).sum()),
                        int((a[:2, :] != b[:2, :]).sum()), int((a[-2:, :] != b[-2:, :]).sum()))
    return worst


def isolated_share(a, wrap=True):
    """Share of pixels that differ from all four neighbours: the single-pixel salt and pepper the brief rules out."""
    if wrap:
        nb = [np.roll(a, 1, 0), np.roll(a, -1, 0), np.roll(a, 1, 1), np.roll(a, -1, 1)]
        iso = (a != nb[0]) & (a != nb[1]) & (a != nb[2]) & (a != nb[3])
    else:
        c = a[1:-1, 1:-1]
        iso = (c != a[:-2, 1:-1]) & (c != a[2:, 1:-1]) & (c != a[1:-1, :-2]) & (c != a[1:-1, 2:])
    return round(float(iso.mean()), 4)


def clump_stats(a, wrap=True):
    """Mean size of the same-tone regions (4-connected) and the share of pixels that sit in a region of 1 or 2 pixels."""
    sizes = []
    h, w = a.shape
    seen = np.zeros(a.shape, bool)
    for y in range(h):
        for x in range(w):
            if seen[y, x]:
                continue
            v = a[y, x]
            stack, n = [(y, x)], 0
            seen[y, x] = True
            while stack:
                cy, cx = stack.pop()
                n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if wrap:
                        ny, nx = ny % h, nx % w
                    if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and a[ny, nx] == v:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            sizes.append(n)
    sizes = np.array(sizes)
    return {"meanRegionPixels": round(float(sizes.mean()), 2), "pixelsInRegionsOfOneOrTwo": round(float(sizes[sizes <= 2].sum() / sizes.sum()), 3)}


# ---------------------------------------------------------------------------
# Wall contact shadow, applied while the room is composed
# ---------------------------------------------------------------------------
def darker_lut(steps):
    """LUT over palette indices: the floor tone `steps` ramp steps darker (stone and wood ramps, clamped at their joint tones)."""
    lut = np.arange(256, dtype=np.uint8)
    for ramp in ([24, 25, 26, 27], [1, 45, 37, 2]):
        for i, v in enumerate(ramp):
            lut[v] = ramp[max(0, i - steps)]
    return lut


def wall_contact_shadow(room, T, rows=(3, ROWS - 1), cols=(1, COLS - 1)):
    """Floor next to the north wall and the west wall sits in their shade (the light comes from the upper left). A band of tone steps,
    darkest against the wall: 2 steps for the first pixels, 1 for the rest. Stylised: a real 4 unit wall would throw a shadow two
    tiles long."""
    band = 3 if T <= 16 else 5
    l1, l2 = darker_lut(1), darker_lut(2)
    y0, y1 = rows[0] * T, rows[1] * T
    x0, x1 = cols[0] * T, cols[1] * T
    depth = np.full((y1 - y0, x1 - x0), 99, np.int32)
    depth = np.minimum(depth, (np.arange(y1 - y0)[:, None] + 0 * np.arange(x1 - x0)[None, :]))
    depth = np.minimum(depth, (0 * np.arange(y1 - y0)[:, None] + np.arange(x1 - x0)[None, :]))
    reg = room[y0:y1, x0:x1]
    hard = max(1, band // 2)
    reg = np.where(depth < hard, l2[reg], np.where(depth < band, l1[reg], reg))
    room[y0:y1, x0:x1] = reg


def rug_shadow(room, T, cols=(6, 10), rows=(4, 8)):
    """The wood rug lies a little above the stone: the stone along its east edge sits in the rim's shadow (2 or 3 pixels, darkest at the
    rug), and its top and left rims catch the light (one pixel lighter). Its south edge meets the south wall cap, so no shadow is cast."""
    l1, l2 = darker_lut(1), darker_lut(2)
    up1 = np.arange(256, dtype=np.uint8)
    for ramp in ([1, 45, 37, 2, 44],):
        for i, v in enumerate(ramp):
            up1[v] = ramp[min(len(ramp) - 1, i + 1)]
    w = 2 if T <= 16 else 3
    x1, y0, y1 = cols[1] * T, rows[0] * T, rows[1] * T
    reg = room[y0 + 1:y1, x1:x1 + w]
    d = np.arange(w)[None, :] + 0 * np.arange(y1 - y0 - 1)[:, None]
    room[y0 + 1:y1, x1:x1 + w] = np.where(d < max(1, w // 2), l2[reg], l1[reg])
    xl = cols[0] * T
    room[y0, xl:x1] = up1[room[y0, xl:x1]]
    room[y0:y1, xl] = up1[room[y0:y1, xl]]


# ---------------------------------------------------------------------------
# Small layout helpers
# ---------------------------------------------------------------------------
def canvas_idx(w, h, fill=6):
    return np.full((h, w), fill, np.uint8)


def tile_block(tile, nx, ny):
    return np.tile(tile, (ny, nx))


def labelled_rgba(pal, idx, labels, zoom, bg=(40, 40, 48), top=10):
    """Index canvas -> RGBA with text labels [(text, x, y)] (in native pixels) drawn above, scaled by zoom."""
    h, w = idx.shape
    out = np.zeros((h + top, w, 4), np.uint8)
    out[..., :3] = bg
    out[..., 3] = 255
    solid = idx != TRANSPARENT
    out[top:][solid, :3] = pal.rgb[idx[solid]]
    for text, x, y in labels:
        draw_text(out, text, x, y + 0)
    return np.repeat(np.repeat(out, zoom, 0), zoom, 1)


def compare_rgba(left, right, left_label, right_label, path, zoom):
    gap, top = 8, 10
    h = max(left.shape[0], right.shape[0])
    w = left.shape[1] + gap + right.shape[1]
    canvas = np.zeros((h + top + gap, w + 2 * gap, 4), np.uint8)
    canvas[..., :3] = (40, 40, 48)
    canvas[..., 3] = 255
    canvas[top:top + left.shape[0], gap:gap + left.shape[1]] = left
    x2 = gap + left.shape[1] + gap
    canvas[top:top + right.shape[0], x2:x2 + right.shape[1]] = right
    draw_text(canvas, left_label, gap, 2)
    draw_text(canvas, right_label, x2, 2)
    write_png(path, np.repeat(np.repeat(canvas, zoom, 0), zoom, 1))


def read_png_rgba(path):
    img = bpy.data.images.load(path, check_existing=False)
    try:
        img.colorspace_settings.name = "sRGB"
        w, h = img.size
        px = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(px)
    finally:
        bpy.data.images.remove(img)
    a = px.reshape(h, w, 4)[::-1]
    return np.rint(np.clip(a, 0, 1) * 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Sheets
# ---------------------------------------------------------------------------
def tiles_sheet(pal, tiles, modules, T, path, zoom):
    """Every textured ground surface tiled so the seams show. Stone and wood: the 2 x 2 module repeated 2 x 2 (the four tiles laid out
    as the game lays them). Caps: a frame (corners, then the two block variants along each side) the way the room uses them. Grass and
    water: each of the four variants beside itself 2 x 2, then the four variants in a scattered 4 x 4."""
    pad = 4
    rng = np.random.RandomState(9)
    frame = canvas_idx(6 * T, 4 * T)
    for c in range(6):
        for r in (0, 3):
            key = "cap_h_%d" % (c % 2) if 0 < c < 5 else ("cap_" + ("n" if r == 0 else "s") + ("w" if c == 0 else "e"))
            blit(frame, tiles[key], c * T, r * T)
    for r in (1, 2):
        for c in (0, 5):
            blit(frame, tiles["cap_v_%d" % (r % 2)], c * T, r * T)
    rows = [[("STONE", np.tile(modules["stone"], (2, 2))), ("WOOD", np.tile(modules["wood"], (2, 2))), ("CAPS", frame)]]
    for kind, label in (("grass", "GRASS"), ("water", "WATER")):
        vs = [tiles[f"{kind}_{c}{r}"] for r in range(2) for c in range(2)]
        scat = np.zeros((4 * T, 4 * T), np.uint8)
        for r in range(4):
            for c in range(4):
                scat[r * T:(r + 1) * T, c * T:(c + 1) * T] = vs[rng.randint(4)]
        rows.append([(label + " 2X2 EACH", np.concatenate([np.pad(np.tile(v, (2, 2)), ((0, 0), (0, pad)), constant_values=6) for v in vs], 1)),
                     (label + " SCATTER", scat)])
    rgba_rows = []
    W = 0
    for row in rows:
        w = sum(b.shape[1] + pad for _, b in row)
        W = max(W, w)
    H = sum(max(b.shape[0] for _, b in row) + 9 + pad for row in rows)
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., :3] = (40, 40, 48)
    rgba[..., 3] = 255
    y = 0
    for row in rows:
        x = 0
        for label, b in row:
            draw_text(rgba, label, x, y)
            rgba[y + 8:y + 8 + b.shape[0], x:x + b.shape[1], :3] = np.where((b != 6)[..., None], pal.rgb[b], rgba[y + 8:y + 8 + b.shape[0], x:x + b.shape[1], :3])
            x += b.shape[1] + pad
        y += max(b.shape[0] for _, b in row) + 9 + pad
    write_png(path, np.repeat(np.repeat(rgba, zoom, 0), zoom, 1))


def autotile_stone_wood(tiles, T, pal, path, zoom):
    """A wood rug laid on stone: cell edges (top) against generated transition tiles with a lit and shaded rim (bottom)."""
    shape = ["..........", ".WWWW.....", ".WWWWWW...", ".WWWWWW...", "..WW.WW...", ".........."]
    cells = np.array([[1 if ch == "W" else 0 for ch in row] for row in shape], np.uint8)
    rows, cols = cells.shape

    def layer(kind):
        out = np.zeros((rows * T, cols * T), np.uint8)
        for r in range(rows):
            for c in range(cols):
                out[r * T:(r + 1) * T, c * T:(c + 1) * T] = tiles[f"floor_{kind}_{c % 2}{r % 2}"]
        return out

    hard, soft, stats = blend_layers_lit(layer("stone"), layer("wood"), cells, T, "stone", "wood", raised=True, seed=7)
    both = np.concatenate([hard, np.full((4, hard.shape[1]), 6, np.uint8), soft], 0)
    titled(pal, both, "TOP: CELL EDGES  BOTTOM: GENERATED, RAISED RUG", path, zoom)
    return stats


# ---------------------------------------------------------------------------
# Outdoors
# ---------------------------------------------------------------------------
def nature_lit(T, pal, tiles, knight, zoom, report):
    """The pond. Grass and water are the lit tiles (any variant in any cell, to prove they tile); the shore is generated from them
    with the lit bank; trees, rocks, the tent, hills and lily pads are the prototype's Medieval Hexagon renders, unchanged."""
    cols, rows = 12, 6
    rng = np.random.RandomState(5)

    def field(kind):
        out = np.zeros((rows * T, cols * T), np.uint8)
        for r in range(rows):
            for c in range(cols):
                out[r * T:(r + 1) * T, c * T:(c + 1) * T] = tiles[f"{kind}_{rng.randint(2)}{rng.randint(2)}"]
        return out

    grass, water = field("grass"), field("water")
    pond = np.array([[1 if ch == "W" else 0 for ch in row] for row in [
        "............", "...WWWW.....", "..WWWWWW....", "..WWWWW.....", "...WWW......", "............"]], np.uint8)
    hard, soft, stats = blend_layers_lit(grass, water, pond, T, "grass", "water", raised=False, seed=7)
    report["pond"] = stats
    titled(pal, np.concatenate([hard, np.full((4, hard.shape[1]), 6, np.uint8), soft], 0),
           "TOP: CELL EDGES  BOTTOM: GENERATED SHORE", os.path.join(OUT, f"pond-autotile-{T}@{zoom}x.png"), zoom)

    sprites = {}
    if os.path.isdir(HEX):
        ppu = T / UNITS_PER_TILE
        lib = Library(hex_finder())
        lib.load("hex_grass")
        lib.prepare_materials(pal)
        st = Stage(lib, pal)
        kit = Kit(st, ppu)
        for key, piece, sc in (("tree_a", "tree_single_A", 3.0), ("tree_b", "tree_single_B", 3.0), ("trees_small", "trees_A_small", 2.2),
                               ("rock_a", "rock_single_A", 3.0), ("rock_c", "rock_single_C", 3.0), ("tent", "tent", 2.5),
                               ("barrel", "barrel", 3.0), ("lily", "waterlily_A", 6.0)):
            try:
                sprites[key] = kit.prop(piece, scale=sc)
            except Exception as e:
                log("nature prop", key, "failed:", repr(e))
        st.clear()
    scene = soft.copy()
    stands = [("tree_a", 1, 1), ("tree_b", 10, 2), ("trees_small", 9, 4), ("rock_a", 7, 4), ("rock_c", 1, 4), ("tent", 10, 4),
              ("lily", 4, 2), ("lily", 5, 3), ("barrel", 8, 5)]
    for key, c, r in stands:
        if key in sprites:
            stand(scene, sprites[key], c, r, T)
    kn, _ = trim(knight)
    stand(scene, kn, 6, 5, T)
    return scene, soft, sprites, stats


def nature_sheet(pal, tiles, scene, soft, T, path, zoom):
    """nature-*.png: grass variants and water variants, shore tiles cut from the generated pond, then the pond scene."""
    pad = 3
    W = scene.shape[1]
    strip_h = T
    idx = canvas_idx(W, 2 * (strip_h + 10) + scene.shape[0] + 10, 6)
    labels = []
    # row 1: grass variants, water variants
    y = 7
    x = 0
    for kind in ("grass", "water"):
        for r in range(2):
            for c in range(2):
                blit(idx, tiles[f"{kind}_{c}{r}"], x, y)
                x += T + 1
        x += pad * 2
    labels.append(("GRASS (4)       WATER (4)", 0, 0))
    # row 2: eight shore tiles cut from the pond (distinct 3 x 3 signatures)
    picks = [(1, 3), (1, 4), (1, 6), (2, 2), (2, 7), (3, 6), (4, 3), (4, 5), (3, 3)]
    y2 = y + strip_h + 10
    x = 0
    for (r, c) in picks:
        blit(idx, soft[r * T:(r + 1) * T, c * T:(c + 1) * T], x, y2)
        x += T + 1
    labels.append(("SHORE TILES, GENERATED", 0, y + strip_h + 3))
    y3 = y2 + strip_h + 10
    labels.append(("POND SCENE", 0, y2 + strip_h + 3))
    blit(idx, scene, 0, y3)
    rgba = np.zeros(idx.shape + (4,), np.uint8)
    rgba[..., :3] = (40, 40, 48)
    rgba[..., 3] = 255
    # the tile rows sit on the panel colour; the scene is opaque everywhere so a void index cannot occur inside it
    solid = idx != 6
    rgba[solid, :3] = pal.rgb[idx[solid]]
    for text, x_, y_ in labels:
        draw_text(rgba, text, x_ + 1, y_)
    write_png(path, np.repeat(np.repeat(rgba, zoom, 0), zoom, 1))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
PAL = None


def main():
    global PAL
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    sizes = [int(x) for x in (argv[argv.index("--sizes") + 1] if "--sizes" in argv else "16,32").split(",")]
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SCRATCH, exist_ok=True)
    require(GLTF, "git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0.git .cache/kaykit/dungeon")
    require(PALETTE_JSON, "npm run kaykit:palette")
    require(FRAMES_JSON, "run harness.py --style bands (see scripts/kaykit/README.md)")
    t_all = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PAL = Pal()
    lib = Library()
    lib.load("floor_tile_large")          # first load fixes the shared atlas and material
    lib.prepare_materials(PAL)
    stage = Stage(lib, PAL)
    report = {"renderSeconds": {}, "sizes": {}}
    proto = os.path.join(ROOT, ".cache", "kaykit", "out", "env")
    for T in sizes:
        ppu = T / UNITS_PER_TILE
        zoom = 4 if T == 16 else 2
        tag = str(T)
        t0 = time.time()
        rep = report["sizes"].setdefault(tag, {})
        kit = Kit(stage, ppu)
        knight = knight_frame("16x24" if T == 16 else "32x48")
        # unchanged prototype path: wall faces, doors, windows, props
        tiles, sprites = build_tiles(kit, PAL)
        t_props = time.time() - t0
        # new: every ground surface from heightfields
        t1 = time.time()
        lit, modules = build_lit_surfaces(stage, T, rep)
        tiles.update(lit)
        rep["surfaceTotalSeconds"] = round(time.time() - t1, 1)
        # the room, same layout as the prototype
        room = compose_room(tiles, sprites, T, knight, after_floor=lambda r, T=T: (wall_contact_shadow(r, T), rug_shadow(r, T)))
        save_pair(f"room-{tag}", room, PAL, zoom)
        pr = os.path.join(proto, f"room-{tag}.png")
        if os.path.exists(pr):
            mine = PAL.rgba(room)
            compare_rgba(read_png_rgba(pr), mine, "PROTOTYPE (FLAT)", f"LIT {T}PX", os.path.join(OUT, f"compare-rooms-{tag}@{zoom}x.png"), zoom)
        tiles_sheet(PAL, tiles, modules, T, os.path.join(OUT, f"tiles-{tag}@{zoom}x.png"), zoom)
        rep["seams"] = seam_stats(tiles, T)
        rep["hybridBorderMismatchPixels"] = {k: border_continuity(tiles, k, T) for k in ("grass", "water")}
        rep["autotileStoneWood"] = autotile_stone_wood(tiles, T, PAL, os.path.join(OUT, f"autotile-stone-wood-{tag}@{zoom}x.png"), zoom)
        scene, soft, nsprites, stats = nature_lit(T, PAL, tiles, knight, zoom, rep)
        nature_sheet(PAL, tiles, scene, soft, T, os.path.join(OUT, f"nature-{tag}@{zoom}x.png"), zoom)
        PAL.save(f"nature-{tag}.png", scene, 1)
        rep["spriteSizes"] = {k: list(v.shape[::-1]) for k, v in {**sprites, **nsprites}.items()}
        for k in ("floor_stone_00", "floor_wood_00", "grass_00", "water_00", "cap_h_0"):
            u, c = np.unique(tiles[k], return_counts=True)
            rep.setdefault("tones", {})[k] = {int(a): int(b) for a, b in zip(u, c)}
        rep["toneCountPerMaterial"] = {k: int(len(np.unique(modules[k]))) for k in modules}
        rep["toneCountPerMaterial"]["cap"] = int(len(np.unique(np.concatenate([tiles[k].ravel() for k in tiles if k.startswith("cap_")]))))
        rep["isolatedPixelShare"] = {k: isolated_share(modules[k]) for k in modules}
        rep["isolatedPixelShare"]["cap_h_0"] = isolated_share(tiles["cap_h_0"], wrap=False)
        rep["isolatedPixelShare"]["cap_h_1"] = isolated_share(tiles["cap_h_1"], wrap=False)
        rep["clumps"] = {k: clump_stats(modules[k]) for k in ("grass", "water", "stone", "wood")}
        used = np.unique(np.concatenate([a.ravel() for a in list(tiles.values()) + [room, scene]]))
        rep["paletteIndicesUsedAll"] = [int(v) for v in used if v != TRANSPARENT]
        rep["paletteOk"] = bool(all(v < USABLE for v in used if v != TRANSPARENT))
        rep["outputHash"] = {"room": hashlib.sha256(room.tobytes()).hexdigest()[:16], "scene": hashlib.sha256(scene.tobytes()).hexdigest()[:16],
                             "surfaces": hashlib.sha256(b"".join(modules[k].tobytes() for k in sorted(modules))).hexdigest()[:16]}
        if os.path.exists(pr):
            ref = read_png_rgba(pr)
            mine_rgba = PAL.rgba(room)
            rep["approvedRegionMismatchPixels"] = {
                "north wall face incl. door, window, torches (rows 1 to 2, columns 1 to 10)": int((ref[T:3 * T, T:(COLS - 1) * T] != mine_rgba[T:3 * T, T:(COLS - 1) * T]).any(-1).sum())}
        pnat = os.path.join(proto, "report.json")
        if os.path.exists(pnat):
            with open(pnat) as fh:
                pr_rep = json.load(fh)
            ps = pr_rep.get("natureBySize", {}).get(tag, {}).get("nature", {}).get("spriteSizes", {})
            ms = {k: list(v.shape[::-1]) for k, v in nsprites.items()}
            rep["natureSpriteSizesMatchPrototype"] = {k: (ps.get(k) == v) for k, v in ms.items()}
            ps2 = pr_rep.get("sizes", {}).get(tag, {}).get("spriteSizes", {})
            rep["dungeonPropSizesMatchPrototype"] = bool(all(ps2.get(k) == list(v.shape[::-1]) for k, v in sprites.items() if k in ps2))
        pn = os.path.join(proto, f"nature-sample-{tag}@{zoom}x.png")
        if os.path.exists(pn):
            ref = read_png_rgba(pn)[::zoom, ::zoom][10:, 4:-4]
            compare_rgba(ref, PAL.rgba(scene), "PROTOTYPE (FLAT)", f"LIT {T}PX", os.path.join(OUT, f"compare-nature-{tag}@{zoom}x.png"), zoom)
        rep["tileCount"] = len(tiles)
        report["renderSeconds"][tag] = round(time.time() - t0, 1)
        rep["propsAndFacesSeconds"] = round(t_props, 1)
        log(f"{T}px done in {time.time() - t0:.1f}s")
    report["images"] = {
        "room-{T}.png / @Nx": "the sample room (12 x 9 tiles, wall face 2 tiles tall), lit floors and caps, unchanged door, wall faces and props, Knight for scale",
        "nature-{T}.png / @Nx": "grass and water variants, generated shore tiles, pond scene with trees, rocks, tent, Knight",
        "tiles-{T}@Nx.png": "stone, wood, cap, grass and water tiles laid 2 x 2 (and scattered) so seams show",
        "compare-rooms-{T}@Nx.png": "prototype room (left) against the lit room (right)",
        "autotile-stone-wood-{T}@Nx.png": "a wood rug on stone, cell edges against generated transition tiles with a lit and shaded rim",
        "pond-autotile-{T}@Nx.png": "a pond in grass, cell edges against generated shore tiles with a lit and shaded bank",
    }
    report["approach"] = ("lit: every ground surface is a real heightfield mesh in Blender, rendered straight down with the renderer's own normal pass and "
                          "depth pass, lit in numpy by a raking key light from the upper left (n.L bevels, cast shadow marched across the depth pass, "
                          "cavity darkening, specular on water), quantised to 4 palette tones per material")
    report["changes"] = {
        "stoneFloor": "KayKit floor_tile_large rendered to a height map (true joint profile), tops labelled into separate stones, each given a chamfered "
                      "edge, a soft dome, a tilt, pits and pebbles and hairline cracks, joint cut as a V groove about one pixel wide. Tones 24 25 26 27.",
        "woodFloor": "KayKit floor_wood_large height map moved half a pixel so every joint lands on whole pixel rows and columns; each plank labelled, "
                     "chamfered, bowed, given short grain grooves (and nail heads at 32 px); about one plank in five is the darker swatch of the same "
                     "wood (a tone offset, not geometry). Tones 1 45 37 2.",
        "wallCap": "KayKit cap tops are flat, so each cap is new geometry: one block per tile with a pixel wide joint, chamfered edges, a dome, mottling, "
                   "wobbled edge, chips and cracks; the four corners take their outline from the KayKit wall_corner footprint. Tones 24 26 27 32.",
        "grass": "new geometry (the hex mesh is flat): a one tile periodic base (swell and a tuft that runs across the tile edge) plus private detail of "
                 "blade tufts inside each tile; each blade is a tapered ridge so it has a lit left edge and a shaded right edge. Tones 16 17 18 19.",
        "water": "new geometry: same base plus detail construction with ripples, low ridges long in x, lit on the north slope and shaded on the south, "
                 "plus a Blinn glint. Tones 20 21 22 23.",
        "shore": "blend_layers_lit: the prototype's blurred, noise pushed cell mask, now with a bank shaded by the key light (grass lip lit or shaded, "
                 "water in the bank's shadow); every transition tile is made alone from its 3 x 3 cells and compared with the whole map.",
        "stoneWoodEdge": "same function, raised: the rug's own rim lit or shaded and the stone beyond a shaded rim in shadow.",
        "roomComposition": "same layout as the prototype. Two stylised shadows are applied while composing: floor against the north and west walls, and "
                           "stone along the east edge of the wood rug. Not ray marched (a 4 unit wall would throw a two tile shadow).",
        "unchanged": "wall faces, door, window, torches, props, trees, rocks, tent, lily pads, Knight: the prototype's code path, same parameters",
    }
    report["knownIssues"] = [
        "Grass and water tiles share a one tile periodic base, so scattered variants show a faint one tile lattice; variety is inside each tile only.",
        "Stone and wood are lattices made as a 2 x 2 tile module (the game picks floor_x_{c%2}{r%2}); one stone tile cannot tile with itself.",
        "Wall cap joints are deliberate dark columns and rows, so the seam metric reads high there by design.",
        "The 16 px tiles carry about one tone step of detail per pixel; the wood reads busy next to the Knight at 16 px.",
        "Wall contact shadow and rug shadow are stylised, not computed from the wall height.",
    ]
    report["totalSeconds"] = round(time.time() - t_all, 1)
    report["totalRenders"] = RENDERS[0]
    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    log("done in %.1fs, %d renders" % (time.time() - t_all, RENDERS[0]))


if __name__ == "__main__":
    main()
# <<END MAIN>>
