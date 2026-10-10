"""
KayKit environment tiles, painted: the render gives the layout, a pixel artist's texture pass gives the surface (Blender 5.2 headless).

The owner's note on scripts/kaykit/env_probe.py's renders: trees and rocks are solid but grass and water are flat colour, the room
border and the brick and wood floors are flat too, while the door has depth and texture. This script keeps the render for the
structure and paints each material in NumPy the way a pixel artist would, with one palette ramp per material:

  stone floor   the render's octagon paving lattice (read off its groove pixels): every stone gets a lit upper left edge, a shaded
                lower right edge (32 px), mortar, a recessed diamond between four stones, soft mottling, clustered speckle, the odd crack
  wood floor    the render's boards in running bond (rows and joints detected in the render): lit top edge in broken runs, a dark gap
                line under each board and a shaded end, grain strokes along the board, a knot now and then, nails (32 px)
  wall caps     one stone slab per tile: lit top and left, shaded bottom and right, a mortar joint between slabs, flecks, the odd crack;
                the render's chamfered corner wedges take the light from their side
  grass         three greens in clumps of a few pixels plus small tufts; six variants, a flower variant among them
  water         the pack's blue with short horizontal ripples (a light line and its shadow) and dashes of a darker step; a darker ramp
                for the middle of a pond
  shore, rug    the autotile mask of env_probe.py (each transition tile made alone from its 3 x 3 neighbourhood, compared pixel for
                pixel with the whole map), then a painted edge: a lit lip, a bank shadow and a dark grass outline for the pond; a
                lit upper left edge, shaded lower right edge and a cast shadow for the wood rug on stone
  room          the same layout as env_probe.py's room; the floor is shaded along the north and west walls before anything stands on it

Approved art is untouched: the door, wall faces, windows, props, trees, rocks, the tent and the lilies are the prototype's own renders
(same pieces, same cameras). Tiles are palette indices 0..47 only, every random choice is seeded (rng()), and every texture is periodic,
so the output is the same pixels on every run. Seams: stone and wood are checked where the room places them, grass and water as every
variant beside every variant (the outermost ring of a variant is shared, so they meet exactly); report.json carries the numbers.

Run from the repo root (about 8 seconds):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/env_painted.py [-- --sizes 16,32 --dump]

Inputs (all under .cache/, gitignored), as for env_probe.py:
  .cache/kaykit/dungeon/                   KayKit Dungeon Remastered (CC0)
  .cache/kaykit/scratch/env/hexagon/       KayKit Medieval Hexagon Pack (CC0), for the trees, rocks and the flat ground colours
  .cache/kaykit/palette-fantasy.json       npm run kaykit:palette
  .cache/kaykit/out/bands/frames.json      the Knight, from harness.py --style bands
  .cache/kaykit/scratch/env/current.json   the game's current sprites, for the side by side (see env_probe.py for how it is made)
Outputs: .cache/kaykit/out/env-painted/: room-16 / room-32 (+ @4x / @2x), nature-16 / nature-32 (+ @4x / @2x), tiles-16@4x, tiles-32@2x,
before-after-room-*, compare-rooms-* (the game's current art against this), nature-pond-*, autotile-stone-wood-*, report.json.
--dump also saves the raw render arrays to .cache/kaykit/scratch/env-painted/raw_*.npz, so the painting can be iterated on without Blender
(import this file from any Python with NumPy; bpy is only needed to render).
"""
import base64
import hashlib
import json
import math
import os
import sys
import time
import zlib

import numpy as np

try:                                   # the painting functions are plain NumPy; only rendering and PNG writing need Blender
    import bpy
    from mathutils import Matrix, Vector
except ImportError:                    # lets a dev script import this file and iterate on the painting without Blender
    bpy = None

ROOT = os.getcwd()
PACK = os.path.join(ROOT, ".cache", "kaykit", "dungeon", "addons", "kaykit_dungeon_remastered")
GLTF = os.path.join(PACK, "Assets", "gltf")
PALETTE_JSON = os.path.join(ROOT, ".cache", "kaykit", "palette-fantasy.json")
FRAMES_JSON = os.path.join(ROOT, ".cache", "kaykit", "out", "bands", "frames.json")
CURRENT_JSON = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env", "current.json")
OUT = os.path.join(ROOT, ".cache", "kaykit", "out", "env-painted")
SCRATCH = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env")          # read-only inputs (current.json, the hexagon clone)
WORK = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env-painted")     # this script's own temp files
TMP_PNG = os.path.join(WORK, f"render_{os.getpid()}.png")

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
# The rendered tile set (the layout the painting is done over)
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
    # -- floors, straight down. The large floor modules are 4 x 4 units = 2 x 2 tiles, cut into four.
    for key, piece in (("stone", "floor_tile_large"), ("wood", "floor_wood_large"), ("dirt", "floor_dirt_large"),
                       ("stonerocks", "floor_tile_large_rocks")):
        arr = kit.top_down([dict(name=piece)], 0, 0, 2, 2, ramp_override={"stone": "earth"} if key == "dirt" else None)
        cut(arr, 2, 2, f"floor_{key}")
    for key, piece in (("small", "floor_tile_small"), ("small_broken", "floor_tile_small_broken_A"),
                       ("small_weeds", "floor_tile_small_weeds_A"), ("grate", "floor_tile_grate"),
                       ("small_decorated", "floor_tile_small_decorated"), ("wood_small", "floor_wood_small")):
        tiles[f"floor_{key}"] = kit.top_down([dict(name=piece)], 0, 0, 1, 1)
    log("floors done %.1fs" % (time.time() - t0))

    # -- wall caps (top of the wall from above). A run of three modules, cut at the grooves (odd unit boundaries).
    names = ["wall", "wall_cracked", "wall"]
    cap = kit.top_down(wall_run(names), 0, 0, 5, 1, bias=CAP_BIAS)
    for i in range(5):
        tiles[f"cap_h_{i}"] = cap[:, i * T:(i + 1) * T].copy()
    capv = kit.top_down([dict(name=n, loc=(0.0, (i - 1) * 4.0, 0.0), rotz=90.0, scale=(1.0, WALL_THICK, 1.0))
                         for i, n in enumerate(names)], 0, 0, 1, 5, bias=CAP_BIAS)
    for i in range(5):
        tiles[f"cap_v_{i}"] = capv[i * T:(i + 1) * T, :].copy()
    for key, rot in (("ne", 0.0), ("nw", 90.0), ("sw", 180.0), ("se", 270.0)):
        tiles[f"cap_{key}"] = kit.top_down([dict(name="wall_corner", rotz=rot, scale=(WALL_THICK, WALL_THICK, 1.0))], 0, 0, 1, 1, bias=CAP_BIAS)
    log("caps done %.1fs" % (time.time() - t0))

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
# The sample room, from tiles
# ---------------------------------------------------------------------------
COLS, ROWS = 12, 9
# (piece, (col, row), scale): the props that stand on the floor. The wood rug is cols 6..9, rows 4..7.
ROOM_PROPS = [("barrel_large", (1, 3), 1.0), ("box_large", (2, 3), 1.0), ("chest", (10, 3), 1.0), ("torch_lit", (5, 5), 1.0),
              ("table_medium", (7, 5), 1.0), ("chair", (6, 5), 1.0), ("barrel_small", (10, 7), 1.0)]
# Layout, FF6 style: row 0 wall top, rows 1-2 the north wall's face (two tiles tall), rows 3-7 floor, row 8 the south wall's top.
# Columns 0 and 11 are the side walls seen as their tops.


def compose_room(tiles, sprites, T, knight=None, variant="stone"):
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
HEX = os.path.join(SCRATCH, "hexagon", "addons", "kaykit_medieval_hexagon_pack", "Assets", "gltf")
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


# ---------------------------------------------------------------------------
# Painted materials: the pixel artist's texture pass over the render (plain NumPy, seeded, tile periodic)
#
# The render supplies the layout (octagon paving lattice, plank rows and joints, wall cap slabs and their chamfered corners, the pond
# mask). Each material is then painted the way a pixel artist would: one ramp per material, a light edge up left and a dark edge down
# right of every stone / board / slab, clustered speckle, the odd crack or knot. Nothing here is random per run: every random
# choice comes from rng(), keyed by material, tile size and object index.
# ---------------------------------------------------------------------------

def rng(*parts):
    """A seeded generator keyed by its parts. The key is hashed to a 128 bit seed array: seeding a RandomState with nearby integers
    (a crc of nearby keys) gives correlated first draws, which showed as every stone of a module getting the same tone."""
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return np.random.RandomState(np.frombuffer(digest[:16], dtype=np.uint32))


def put(a, x, y, v):
    """Set one pixel, wrapping around the array (textures are periodic, so a stamp may cross the edge)."""
    a[int(y) % a.shape[0], int(x) % a.shape[1]] = v


def stamp(a, x, y, rows, colours):
    """Draw rows of characters with their top-left at (x, y), wrapping. `colours` maps a character to a palette index."""
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch in colours:
                put(a, x + dx, y + dy, colours[ch])


def pv_noise(h, w, cell_y, cell_x, seed):
    """Smooth value noise in 0..1 that tiles with period (h, w): one random value per cell_y x cell_x block, smoothstep between."""
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


# ---- stone floor: octagon paving with recessed diamonds, the lattice the render shows ------------------------------------
STONE_CUT = {16: 4, 32: 10}         # corner cut of each octagon, read off the render's groove pixels
STONE = {"mortar": 24, "dark": 25, "base": 26, "lit": 27}
STONE_MOTTLE = {16: 0.20, 32: 0.24}         # share of each stone mottled a step darker, by tile size (keeps the floor near the game's own brightness)


def stone_lattice(T):
    """Coordinates of the 2T x 2T floor module against the octagon lattice: lines every T pixels at T/2-1, an octagon between."""
    W = 2 * T
    off = T // 2 - 1
    Y, X = np.mgrid[0:W, 0:W]
    gx, gy = X - off, Y - off
    u, v = gx % T, gy % T
    return dict(W=W, off=off, u=u, v=v, ci=(gx // T) % 2, cj=(gy // T) % 2, a=np.minimum(u, T - u), b=np.minimum(v, T - v))


def paint_stone(T, raw=None):
    """The 2T x 2T stone floor module (four octagon flagstones and four diamond insets), periodic. If the rendered module is given,
    its groove pixels are checked against the lattice and the coverage is returned too."""
    L = stone_lattice(T)
    W, off, u, v, ci, cj, a, b = (L[k] for k in ("W", "off", "u", "v", "ci", "cj", "a", "b"))
    q = STONE_CUT.get(T, int(round(0.3 * T)))
    s = a + b
    straight = ((a == 0) | (b == 0)) & (s >= q)
    diag = (a > 0) & (b > 0) & (s == q)
    octa = (a > 0) & (b > 0) & (s > q)
    base = np.full((W, W), STONE["base"], np.int32)       # every stone the same tone: with four stones a module would show a tone repeat
    out = base.copy()
    lit = octa & ((u == 1) | (v == 1) | (u + v == q + 1))
    dark = octa & ((u == T - 1) | (v == T - 1) | ((T - u) + (T - v) == q + 1)) & (T >= 32)      # the small tile has no room for a shaded edge
    out = np.where(lit, base + 1, out)
    out = np.where(dark, base - 1, out)
    # soft mottling: irregular patches a step darker than the stone, a few pixels across (the noise is periodic in the module); the light
    # step is kept for the lit edges and the odd fleck
    nz = pv_noise(W, W, max(3, T // 8), max(3, T // 8), ("stone-mottle", T))
    mot = np.where(nz < STONE_MOTTLE.get(T, 0.22), -1, 0) * octa * ~(lit | dark)
    mot = despeckle(mot.astype(np.int32))
    out = np.where(octa & ~(lit | dark), base + mot, out)
    out = np.where(straight | diag, STONE["mortar"], out)
    # the diamond insets sit lower than the stones: shadow up left, a lit lip down right
    dx, dy = np.where(u <= T // 2, u, u - T), np.where(v <= T // 2, v, v - T)
    dia = s < q
    rim = dia & (s == q - 1)
    out = np.where(dia, STONE["dark"], out)
    out = np.where(rim & (dx <= 0) & (dy <= 0), STONE["mortar"], out)
    out = np.where(rim & (dx >= 0) & (dy >= 0), STONE["base"], out)

    def inside(lu, lv, margin):
        aa, bb = min(lu, T - lu), min(lv, T - lv)
        return aa >= margin and bb >= margin and aa + bb >= q + margin

    for i in range(2):
        for j in range(2):
            r = rng("stone-deco", T, i, j)
            bs = int(base[(ci == i) & (cj == j)][0])
            ox, oy = off + i * T, off + j * T
            # clustered speckle: dark pits and light flecks, two to four pixels each
            placed, tries = 0, 0
            while placed < 2 + T // 8 and tries < 300:
                tries += 1
                lu, lv = int(r.randint(3, T - 3)), int(r.randint(3, T - 3))
                shape = clump_shapes()[int(r.randint(0, 7))]
                if not all(inside(lu + dx_, lv + dy_, 2) for dy_, row in enumerate(shape) for dx_, ch in enumerate(row) if ch == "x"):
                    continue
                val = bs - 1 if r.rand() < 0.55 else bs + 1
                stamp(out, ox + lu, oy + lv, shape, {"x": val})
                placed += 1
            # the odd crack
            if r.rand() < 0.55:
                n = int(T * (0.3 + 0.25 * r.rand()))
                lu, lv = int(r.randint(T // 4, T - T // 4)), int(r.randint(T // 4, T - T // 4))
                pts = crack_path(r, n)
                for k, (cx, cy) in enumerate(pts):
                    if inside(lu + cx, lv + cy, 2):
                        put(out, ox + lu + cx, oy + lv + cy, STONE["mortar"])
                        if T >= 32 and k % 3 == 1 and inside(lu + cx + 1, lv + cy + 1, 2):
                            put(out, ox + lu + cx + 1, oy + lv + cy + 1, bs + 1)
    out = out.astype(np.uint8)
    info = None
    if raw is not None:
        groove = raw != STONE["base"]
        covered = groove & ((straight | diag) | (out != STONE["base"]))
        info = {"renderGroovePixels": int(groove.sum()), "coveredByPainted": int(covered.sum())}
    return out, info


# ---- wood floor: boards in running bond, rows and joints read off the render ---------------------------------------------
WOOD = {"deep": 1, "gap": 45, "shade": 35, "base": 37, "lit": 2, "shine": 44}


def wood_layout(raw, T):
    """Board rows and joints of the rendered 2T x 2T wood module. Returns a list of (first_row, last_row, [joint columns]) per board
    row: last_row is the dark gap line under the boards, joints are the columns of the dark end lines (periodic in x)."""
    dark = raw == WOOD["gap"]
    gaps = [y for y in range(raw.shape[0]) if dark[y].mean() > 0.6]
    rows = []
    for k, y1 in enumerate(gaps):
        y0 = gaps[k - 1] + 1 if k else gaps[-1] + 1 - raw.shape[0]       # the first board row starts under the last gap of the module
        ys = [y % raw.shape[0] for y in range(y0, y1)]
        col = dark[ys].mean(axis=0)
        joints = [x for x in range(raw.shape[1]) if col[x] > 0.5]
        rows.append((y0, y1, joints))
    return rows


def paint_wood(T, raw):
    W = 2 * T
    out = np.full((W, W), WOOD["base"], np.uint8)
    layout = wood_layout(raw, T)
    big = T >= 32
    for bi, (y0, y1, joints) in enumerate(layout):
        H = y1 - y0 + 1                                   # board height including its gap line
        for ji, jx in enumerate(joints):
            x0 = joints[ji - 1] + 1 if ji else joints[-1] + 1 - W
            Lb = jx - x0 + 1                              # board length including its end line
            r = rng("wood", T, bi, ji)
            if r.rand() < 0.25:                           # a darker board: one step down the wood ramp, its grain and lip to match
                tone, lit, grain, gap, shade = WOOD["shade"], WOOD["base"], WOOD["gap"], WOOD["gap"], WOOD["gap"]
            else:
                tone, lit, grain, gap, shade = WOOD["base"], WOOD["lit"], WOOD["shade"], WOOD["gap"], WOOD["shade"]

            def px(lx, ly, val):
                put(out, x0 + lx, y0 + ly, val)

            for ly in range(H - 1):
                for lx in range(Lb - 1):
                    px(lx, ly, tone)
            # lit top edge, broken into runs so it reads as a sheen rather than a stripe
            lx = 0
            while lx < Lb - 1:
                run = int(r.randint(4, 10 if big else 7))
                if r.rand() < (0.78 if big else 0.42):
                    for k in range(lx, min(lx + run, Lb - 1)):
                        px(k, 0, lit)
                lx += run + int(r.randint(1, 3))
            if big:
                for ly in range(1, H - 1):
                    px(0, ly, lit)                        # lit left end (the small tile has no room for it)
            for ly in range(H - 1):
                px(Lb - 1, ly, gap)                       # joint at the right end
                if big:
                    px(Lb - 2, ly, shade)
            for lx in range(Lb):
                px(lx, H - 1, gap)                        # gap line under the board
            if big:
                for lx in range(1, Lb - 2):
                    px(lx, H - 2, shade)
            # grain: short darker strokes along the board, now and then a light one
            for _ in range((2 + H // 4) if big else 2):
                ly = int(r.randint(1, max(2, H - 2)))
                n = int(r.randint(3, 7 if not big else 11))
                lx = int(r.randint(2, max(3, Lb - 2 - n)))
                for k in range(n):
                    if 0 < ly < H - (3 if big else 2) and 1 <= lx + k < Lb - (3 if big else 2):
                        px(lx + k, ly, grain)
            if r.rand() < (0.3 if big else 0.15):
                ly = int(r.randint(1, max(2, H - 3)))
                n = int(r.randint(2, 5 if not big else 7))
                lx = int(r.randint(3, max(4, Lb - 3 - n)))
                for k in range(n):
                    if 0 < ly < H - 2:
                        px(lx + k, ly, lit)
            # a knot now and then
            if r.rand() < 0.16 and Lb > 8 and H >= 4:
                kx, ky = int(r.randint(4, Lb - 6)), max(1, (H - 1) // 2 - 1)
                if big:
                    stamp(out, x0 + kx, y0 + ky, [".ss.", "sKKs", ".ss."], {"s": grain, "K": gap})
                else:
                    stamp(out, x0 + kx, y0 + ky, ["sK"], {"s": grain, "K": gap})
            # nails at both ends (the bigger tile only)
            if big:
                for nx in (3, Lb - 6):
                    px(nx, H // 2 - 1, lit)
                    px(nx + 1, H // 2, gap)
    return out


# ---- wall caps: one stone slab per tile, lit top and left, shaded bottom and right, a mortar joint between slabs ------------
CAP = {"mortar": 24, "dark": 25, "base": 26, "lit": 27}


def paint_cap(T, raw, key):
    """One wall cap tile from the rendered one (its corner wedge of void, index 6, is kept). Every tile is a slab with a lit edge up
    and left, a shaded edge down and right and a mortar line on its right and bottom, so slabs butt together as a block joint."""
    void = raw == 6
    big = T >= 32
    out = np.full((T, T), CAP["base"], np.int32)
    r = rng("cap", T, key)
    # speckle: light flecks and dark chips, clustered
    for _ in range(2 + T // 8):
        lu, lv = int(r.randint(3, T - 5)), int(r.randint(3, T - 5))
        shape = clump_shapes()[int(r.randint(0, 7))]
        val = CAP["lit"] if r.rand() < 0.55 else CAP["dark"]
        stamp(out, lu, lv, shape, {"x": val})
    # mottling
    nz = pv_noise(T, T, max(3, T // 6), max(3, T // 6), ("cap", T, key))
    mot = despeckle((np.where(nz < 0.24, -1, 0)).astype(np.int32))
    out = np.where(out == CAP["base"], CAP["base"] + mot, out)
    if r.rand() < 0.35:
        pts = crack_path(r, int(T * 0.4))
        lu, lv = int(r.randint(T // 4, T - T // 4)), int(r.randint(T // 4, T - T // 4))
        for cx, cy in pts:
            if 2 <= lu + cx < T - 3 and 2 <= lv + cy < T - 3:
                out[lv + cy, lu + cx] = CAP["mortar"]
    # slab edges
    lit = np.zeros((T, T), bool)
    drk = np.zeros((T, T), bool)
    mort = np.zeros((T, T), bool)
    lit[0, :] = True
    lit[:, 0] = True
    mort[T - 1, :] = True
    mort[:, T - 1] = True
    if big:
        drk[T - 2, :] = True
        drk[:, T - 2] = True
    # the wedge: pixels that touch the void take its light
    up, dn = np.roll(void, 1, 0), np.roll(void, -1, 0)
    lf, rt = np.roll(void, 1, 1), np.roll(void, -1, 1)
    up[0, :], dn[-1, :], lf[:, 0], rt[:, -1] = False, False, False, False
    vl, vd = up | lf, dn | rt
    lit |= vl & ~vd
    drk |= vd & ~vl
    out = np.where(lit, CAP["lit"], out)
    out = np.where(drk, CAP["dark"], out)
    out = np.where(mort, CAP["mortar"], out)
    out = np.where(void, 6, out)
    return out.astype(np.uint8)


# ---- grass and water: fine clustered texture; the outermost ring of every variant is shared, so any tile sits beside any tile --
GRASS = {"deep": 16, "dark": 17, "base": 18, "light": 19, "bright": 38}
WATER = {"abyss": 12, "deep": 20, "dark": 21, "base": 22, "light": 23}


def edge_dist(T):
    """Distance in pixels of every pixel of a T x T tile from the nearest tile edge (0 on the outermost ring)."""
    y, x = np.mgrid[0:T, 0:T]
    return np.minimum(np.minimum(x, y), np.minimum(T - 1 - x, T - 1 - y))


def decal_ok(T, x, y, rows, margin):
    """Does a stamp at (x, y) stay at least `margin` pixels away from every tile edge?"""
    w, h = max(len(r) for r in rows), len(rows)
    return margin <= x and margin <= y and x + w <= T - margin and y + h <= T - margin


def paint_grass(T, nvar=6):
    """Grass tiles: clustered patches of three greens (clumps of a few pixels, nothing larger) and small tufts.
    Seamless by construction. Every variant takes the outermost ring of pixels from one shared periodic base texture, so a tile repeats
    on itself exactly and any two variants meet as the base meets itself across its own wrap. Inside, the variant's own noise takes
    over from the base's over three pixels (the two fields are blended, variance kept, so no patch is cut along the tile edge), and
    tufts and flowers sit clear of the edge."""
    big = T >= 32
    cell = 4 if big else 3
    ed = edge_dist(T)
    win = np.clip(ed / 3.0, 0.0, 1.0)
    ring = ed == 0
    if big:
        tufts = [["L.L", "LDL", ".D."], ["L..L", ".LD.", ".XD."], [".L.L.", "LDLDL", ".X.X."], ["..L", ".LD", "LD.", "D.."], ["L..", "DL.", ".DL"]]
    else:
        tufts = [["L.L", ".D."], [".L", "LD", ".D"], ["L.", "DL", "D."], ["L.L", ".X."]]
    cols = {"L": GRASS["light"], "D": GRASS["dark"], "X": GRASS["deep"], "B": GRASS["bright"]}

    def classify(nz):
        a = np.where(nz < 0.30, GRASS["dark"], np.where(nz > 0.70, GRASS["light"], GRASS["base"])).astype(np.uint8)
        return despeckle(despeckle(a))

    nz0 = pv_noise(T, T, cell, cell, ("grass-patch", T, "shared"))
    base = classify(nz0)
    norm = np.sqrt(win * win + (1 - win) * (1 - win))
    variants = []
    for k in range(nvar):
        r = rng("grass-var", T, k)
        nzk = pv_noise(T, T, cell, cell, ("grass-patch", T, k))
        t = classify(0.5 + (win * (nzk - 0.5) + (1 - win) * (nz0 - 0.5)) / norm)
        n = 3 if not big else 5                          # tufts on a jittered grid, clear of the edge
        for gy in range(n):
            for gx in range(n):
                if r.rand() < 0.6:
                    shape = tufts[int(r.randint(0, len(tufts)))]
                    x = int((gx + 0.1 + 0.8 * r.rand()) * T / n)
                    y = int((gy + 0.1 + 0.8 * r.rand()) * T / n)
                    if decal_ok(T, x, y, shape, 1):
                        stamp(t, x, y, shape, cols)
        if k == nvar - 1:                                # the flower variant
            shape = [".w.", "wYw", ".w."]
            for _ in range(2 + big):
                for _try in range(30):
                    x, y = int(r.randint(2, T - 4)), int(r.randint(2, T - 4))
                    if decal_ok(T, x, y, shape, 2):
                        stamp(t, x, y, shape, {"w": 5, "Y": 46})
                        break
        t[ring] = base[ring]                             # the shared ring goes on last
        variants.append(t)
    return variants


def paint_water(T, deep=False, nvar=4):
    """Water tiles: the base colour with short horizontal ripples (a light line with its shadow one row down and one across) and
    dashes of a darker step. The outermost ring is plain water in every variant and the ripples sit clear of it, so any tile meets any
    tile with no seam and a tile repeats on itself exactly. deep=True is the darker ramp for a pond's middle."""
    big = T >= 32
    base_c, dark_c, light_c = (WATER["dark"], WATER["deep"], WATER["base"]) if deep else (WATER["base"], WATER["dark"], WATER["light"])

    def ripple(t, x, y, n):
        for k in range(n):
            t[y, x + k] = light_c
        for k in range(n):
            t[y + 1, x + k + 1] = dark_c

    variants = []
    for k in range(nvar):
        r = rng("water-var", T, deep, k)
        t = np.full((T, T), base_c, np.uint8)
        rows_n = 3 if not big else 6
        span = T - 4                                     # ripple and shadow stay inside rows 1 .. T-3 and columns 1 .. T-2
        for i in range(rows_n):
            y = 1 + int((i + 0.15 + 0.6 * r.rand()) * (T - 4) / rows_n)
            n = int(r.randint(3, 6)) if not big else int(r.randint(5, 10))
            x = int(r.randint(1, T - 2 - n))
            if (i + k) % 3 == 2:                          # a trough: a dash of the darker step, no highlight
                t[y + 1, x + 1:x + 1 + n] = dark_c
            else:
                ripple(t, x, y, n)
            if big and r.rand() < 0.6:                    # a second, shorter ripple on the same row, further along
                n2 = int(r.randint(3, 6))
                x2 = x + n + int(r.randint(4, 10))
                if x2 + n2 + 1 <= T - 2:
                    ripple(t, x2, y, n2)
        variants.append(t)
    return variants


# ---- edges: a lit lip and a shadow where one surface meets another, made from the autotile mask --------------------------------

def dilate(m, dy, dx):
    """m moved by (dy, dx): out[y, x] = m[y - dy, x - dx], with the map's edge pixels repeated outside (a pond that reaches the edge of
    the map has no shore there)."""
    h, w = m.shape
    p = np.pad(m, 1, mode="edge")
    return p[1 - dy:1 - dy + h, 1 - dx:1 - dx + w]


def ring_depth(m, limit):
    """For each True pixel of m, how many pixels in from the edge it is (1 = touching the outside), capped at limit, 4-neighbour steps."""
    depth = np.zeros(m.shape, np.int32)
    cur = m.copy()
    for d in range(1, limit + 1):
        touch = cur & ~(dilate(cur, 1, 0) & dilate(cur, -1, 0) & dilate(cur, 0, 1) & dilate(cur, 0, -1))
        depth[touch] = d
        cur = cur & ~touch
    depth[cur] = limit + 1
    return depth


def edge_fx(out, m, T, style, under_layer=None):
    """Dress the boundary of mask m (the `over` surface) in the composed map `out`, light from the upper left.
    style 'shore': over is water sunk below grass. Water touching a bank that lies above or left of it is in the bank's shadow (dark),
      water touching a bank below or right of it takes a lit lip (light); the grass edge gets a dark outline and a dark-green second ring.
    style 'raised': over is a raised board floor on stone. Its upper and left edges are lit, its lower and right edges shaded, and it
      casts a shadow on the stone below and to the right."""
    big = T >= 32
    outside = ~m
    n_up, n_dn = dilate(outside, 1, 0), dilate(outside, -1, 0)          # the pixel above / below is outside the patch
    n_lf, n_rt = dilate(outside, 0, 1), dilate(outside, 0, -1)
    edge_in = m & (n_up | n_dn | n_lf | n_rt)
    top_left_out = m & (n_up | n_lf)                                     # outside neighbours above or to the left
    bot_right_out = m & (n_dn | n_rt)
    depth = ring_depth(m, 4)
    depth_out = ring_depth(outside, 3)
    o = out.copy()
    if style == "shore":
        W_ = WATER
        shadow = edge_in & top_left_out                                  # bank above or left: water in shadow
        lip = edge_in & ~shadow                                          # bank below or right: a lit lip
        o = np.where(lip, W_["light"], o)
        o = np.where(shadow, W_["deep"], o)
        # second ring: shadow spreads one more pixel (two on the big tile) down and right of a shadowed pixel
        sh2 = m & ~edge_in & (dilate(shadow, 1, 0) | dilate(shadow, 0, 1) | (dilate(shadow, 1, 1) if big else np.zeros_like(m)))
        o = np.where(sh2, W_["dark"], o)
        # grass side: a dark outline, and on the big tile a dark-green second ring
        g1 = outside & (depth_out == 1)
        o = np.where(g1, GRASS["deep"], o)
        if big:
            o = np.where(outside & (depth_out == 2), GRASS["dark"], o)
    else:
        lit_e = edge_in & top_left_out & ~bot_right_out
        dark_e = edge_in & bot_right_out & ~top_left_out
        o = np.where(lit_e, WOOD["lit"], o)
        o = np.where(dark_e, WOOD["gap"], o)
        cast = outside & (dilate(m, 1, 0) | dilate(m, 0, 1))             # stone just below or right of the patch
        o = np.where(cast, STONE["mortar"], o)
        if big:
            cast2 = outside & ~cast & (dilate(cast, 1, 0) | dilate(cast, 0, 1)) & ~(dilate(m, 1, 0) | dilate(m, 0, 1))
            o = np.where(cast2, STONE["dark"], o)
    return o


def blend_layers_painted(under, over, cells, T, style, seed=7, deep=None):
    """blend_layers with a painter's edge: the same autotile mask (each transition tile made alone from its 3 x 3 neighbourhood and
    compared pixel for pixel with the whole map result), then edge_fx on top. For the pond, pixels more than a few pixels in from the
    shore take the `deep` water layer, a darker ramp. Returns (hard, soft, stats)."""
    rows, cols = cells.shape
    noise = periodic_noise(T, seed)
    hard = np.where(np.kron(cells > 0, np.ones((T, T), bool)), over, under)
    m_whole = transition_mask(cells, T, noise)
    padded = np.pad(cells, 1, constant_values=0)
    m_tiles = np.zeros_like(m_whole)
    sigs = set()
    for r in range(rows):
        for c in range(cols):
            if not cells[r, c]:
                continue
            ctx = padded[r:r + 3, c:c + 3]
            sigs.add(tuple(ctx.ravel().tolist()))
            mt = transition_mask(ctx, T, noise)
            m_tiles[r * T:(r + 1) * T, c * T:(c + 1) * T] = mt[T:2 * T, T:2 * T]
    mismatch = int((m_tiles != m_whole).sum())
    m = m_tiles
    over_l = over
    if deep is not None:
        core = ring_depth(m, 6) >= (5 if T >= 32 else 4)
        over_l = np.where(core, deep, over)
    out = np.where(m, over_l, under)
    out = edge_fx(out, m, T, style)
    return hard, out, {"signaturesUsed": len(sigs), "maskMismatchPixels": mismatch, "mask": m}


# ---- the painted tile set, the room with its floor shading, seam numbers --------------------------------------------------

DARKER = {27: 26, 26: 25, 25: 24, 24: 24, 2: 37, 37: 35, 35: 45, 45: 1, 44: 2, 19: 18, 18: 17, 17: 16, 16: 9, 23: 22, 22: 21, 21: 20, 20: 12}


def darker(a, steps=1):
    lut = np.arange(52, dtype=np.uint8)
    for k, v in DARKER.items():
        lut[k] = v
    for _ in range(steps):
        a = lut[a]
    return a


def paint_tiles(tiles, T, report):
    """Replace the flat rendered floor and cap tiles with painted ones, keeping every tile name. Faces, doors, windows and props are
    left exactly as rendered."""
    out = dict(tiles)

    def module(key):
        m = np.zeros((2 * T, 2 * T), np.uint8)
        for c in range(2):
            for r in range(2):
                m[r * T:(r + 1) * T, c * T:(c + 1) * T] = tiles[f"floor_{key}_{c}{r}"]
        return m

    stone, info = paint_stone(T, module("stone"))
    wood = paint_wood(T, module("wood"))
    for key, arr in (("stone", stone), ("wood", wood)):
        for c in range(2):
            for r in range(2):
                out[f"floor_{key}_{c}{r}"] = arr[r * T:(r + 1) * T, c * T:(c + 1) * T].copy()
    for name in tiles:
        if name.startswith("cap_"):
            out[name] = paint_cap(T, tiles[name], name)
    report["stoneGroovesFromRender"] = info
    return out


# Layout, FF6 style: the same as compose_room. What is new is the shading laid on the floor before anything stands on it.
def compose_room_painted(tiles, sprites, T, knight=None):
    # the same composition as compose_room, but the floor is dressed before the props and the Knight stand on it
    floor_room = np.full((ROWS * T, COLS * T), 6, np.uint8)

    def put_(c, r, key):
        blit(floor_room, tiles[key], c * T, r * T)

    # caps
    put_(0, 0, "cap_nw")
    put_(COLS - 1, 0, "cap_ne")
    put_(0, ROWS - 1, "cap_sw")
    put_(COLS - 1, ROWS - 1, "cap_se")
    for c in range(1, COLS - 1):
        k = f"cap_h_{(c * 3 + 1) % 5}"                      # five painted slabs, in a fixed scatter
        put_(c, 0, k)
        put_(c, ROWS - 1, f"cap_h_{(c * 2 + 3) % 5}")
    for r in range(1, ROWS - 1):
        put_(0, r, f"cap_v_{(r * 3 + 1) % 5}")
        put_(COLS - 1, r, f"cap_v_{(r * 2 + 2) % 5}")
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
        put_(c, 1, up)
        put_(c, 2, dn)
    rug = np.zeros((ROWS * T, COLS * T), bool)
    for r in range(3, ROWS - 1):
        for c in range(1, COLS - 1):
            kind = "wood" if (6 <= c <= 9 and 4 <= r <= 7) else "stone"
            put_(c, r, f"floor_{kind}_{c % 2}{r % 2}")
            if kind == "wood":
                rug[r * T:(r + 1) * T, c * T:(c + 1) * T] = True
    # the rug is a raised board floor: lit upper and left edges, shaded lower and right, and its shadow on the stone
    floor_box = np.zeros_like(rug)
    floor_box[3 * T:(ROWS - 1) * T, T:(COLS - 1) * T] = True
    dressed = edge_fx(floor_room, rug, T, "raised")
    floor_room = np.where(floor_box, dressed, floor_room)
    # the north wall and the west wall shade the floor next to them (light comes from the upper left)
    d = 3 if T >= 32 else 2
    for k in range(d):
        rows = slice(3 * T + k, 3 * T + k + 1)
        cols = slice(T, (COLS - 1) * T)
        floor_room[rows, cols] = darker(floor_room[rows, cols], 2 if k == 0 else 1)
    for k in range(d - 1):
        rows = slice(3 * T, (ROWS - 1) * T)
        cols = slice(T + k, T + k + 1)
        floor_room[rows, cols] = darker(floor_room[rows, cols], 2 if k == 0 else 1)
    keys = {"barrel_large": "barrel", "box_large": "crate", "chest": "chest", "torch_lit": "torch", "table_medium": "table",
            "chair": "chair", "barrel_small": "barrel_small"}
    for piece, (c, r), _ in ROOM_PROPS:
        stand(floor_room, sprites[keys[piece]], c, r, T)
    if knight is not None:
        k, _ = trim(knight)
        stand(floor_room, k, 4, 5, T)
    return floor_room


def jump_rate(a, b, axis, rgb):
    """(across, inside) of the prototype's measure, plus the mean and the worst of the same rate at every boundary inside the two tiles
    side by side (the seam itself left out): a tile pair has no seam when `across` is no worse than the worst interior boundary."""
    lum = lambda x: (rgb[x.astype(np.int32)] * np.array([0.30, 0.59, 0.11], np.float32)).sum(-1)
    la, lb = lum(a), lum(b)
    n = a.shape[axis]
    strip = np.concatenate([la, lb], axis)
    d = (np.abs(np.diff(strip, axis=axis)) > 14).mean(axis=1 - axis)
    inner = np.delete(d, n - 1)
    if axis == 1:
        across, last2 = float((np.abs(la[:, -1] - lb[:, 0]) > 14).mean()), float((np.abs(la[:, -2] - la[:, -1]) > 14).mean())
    else:
        across, last2 = float((np.abs(la[-1, :] - lb[0, :]) > 14).mean()), float((np.abs(la[-2, :] - la[-1, :]) > 14).mean())
    return across, last2, float(inner.mean()), float(inner.max())


def seam_report_painted(tiles, grass, water, deep, T):
    """The prototype's seam measure, on the painted tiles. For each pair of abutting tiles: the share of boundary pixel pairs whose
    luminance jumps by more than 14 of 255 ('across'), against the same share between the last two columns (rows) inside the tile
    ('insideLast2', the prototype's number), and against the mean and the worst of the same share at every boundary inside the pair
    ('insideMean', 'insideMax'). A texture with no seam has across no worse than insideMax. Floors are checked where the room puts
    them (quadrants of one module, a module beside itself), caps in the order the room lays them, grass and water as every tile
    beside every tile."""
    rgb = PAL.rgb.astype(np.float32)
    rep = {}

    def add(name, pairs):
        ac = [jump_rate(a, b, ax, rgb) for a, b, ax in pairs]
        col = lambda i: float(np.mean([x[i] for x in ac]))
        worst, inside_max = float(np.max([x[0] for x in ac])), float(np.max([x[3] for x in ac]))
        rep[name] = {"across": round(col(0), 3), "insideLast2": round(col(1), 3), "insideMean": round(col(2), 3),
                     "insideMax": round(inside_max, 3), "worstAcross": round(worst, 3), "noWorseThanInside": bool(worst <= inside_max + 1e-9)}

    for key in ("stone", "wood"):
        q = lambda c, r, key=key: tiles[f"floor_{key}_{c}{r}"]
        add(f"floor_{key}: quadrants inside a module, left to right", [(q(0, 0), q(1, 0), 1), (q(0, 1), q(1, 1), 1)])
        add(f"floor_{key}: quadrants inside a module, top to bottom", [(q(0, 0), q(0, 1), 0), (q(1, 0), q(1, 1), 0)])
        add(f"floor_{key}: module next to itself, left to right", [(q(1, 0), q(0, 0), 1), (q(1, 1), q(0, 1), 1)])
        add(f"floor_{key}: module next to itself, top to bottom", [(q(0, 1), q(0, 0), 0), (q(1, 1), q(1, 0), 0)])
    hs = [tiles[f"cap_h_{i}"] for i in range(5)]
    vs = [tiles[f"cap_v_{i}"] for i in range(5)]
    add("wall cap: any slab beside any slab, left to right (the joint is deliberate)", [(a, b, 1) for a in hs for b in hs])
    add("wall cap: any side slab above any side slab (the joint is deliberate)", [(a, b, 0) for a in vs for b in vs])
    for name, grp in (("grass", grass), ("water", water), ("deep water", deep)):
        add(f"{name}: one tile beside itself, left to right", [(a, a, 1) for a in grp])
        add(f"{name}: one tile beside itself, top to bottom", [(a, a, 0) for a in grp])
        add(f"{name}: every variant beside every variant, left to right", [(a, b, 1) for a in grp for b in grp])
        add(f"{name}: every variant beside every variant, top to bottom", [(a, b, 0) for a in grp for b in grp])
    return rep


def label_sheet(items, path, pal, zoom, width, pad=3, bg=(58, 58, 66)):
    """items: (label, palette-index array). Laid out left to right in rows no wider than `width` pixels, label above each."""
    rows, cur, x = [], [], pad
    for lab, arr in items:
        if lab is None:                                   # (None, None) ends the row
            if cur:
                rows.append(cur)
            cur, x = [], pad
            continue
        w = max(arr.shape[1], 4 * len(lab))
        if cur and x + w + pad > width:
            rows.append(cur)
            cur, x = [], pad
        cur.append((lab, arr, x, w))
        x += w + pad
    if cur:
        rows.append(cur)
    heights = [max(a.shape[0] for _, a, _, _ in r) + 8 for r in rows]
    canvas = np.zeros((sum(heights) + pad * (len(rows) + 1), width, 4), np.uint8)
    canvas[..., :3] = bg
    canvas[..., 3] = 255
    y = pad
    for r, hh in zip(rows, heights):
        for lab, arr, x, w in r:
            draw_text(canvas, lab, x, y)
            canvas[y + 7:y + 7 + arr.shape[0], x:x + arr.shape[1]] = pal.rgba(arr, (72, 72, 80))
        y += hh + pad
    write_png(path, np.repeat(np.repeat(canvas, zoom, 0), zoom, 1))


def tile2x2(a):
    return np.tile(a, (2, 2))


# ---- outdoors: painted grass and water under the pack's own trees and rocks ------------------------------------------------

def nature_painted(T, pal, knight, zoom, report, grass_v, water_v, deep_v):
    """The outdoor sample. Trees, rocks, the tent and the lilies are rendered from the Medieval Hexagon pack exactly as the prototype did
    (same pieces, same scale, same camera); only the ground is new: painted grass and water tiles, a pond whose shore is generated from
    the same autotile mask, with a painted lip and shadow."""
    if not os.path.isdir(HEX):
        log("nature: hexagon pack not found at", HEX)
        return None
    ppu = T / UNITS_PER_TILE
    lib = Library(hex_finder())
    lib.load("hex_grass")
    lib.prepare_materials(pal)
    st = Stage(lib, pal)
    kit = Kit(st, ppu)
    t0 = time.time()
    cols, rows = 12, 6
    ss = 4 if T >= 32 else SS
    nat = report.setdefault("nature", {})

    # the pack's flat ground colours, read back from two tiles of rendered hex field: the painted tiles must sit on these ramps
    def flat(piece):
        pl = hex_field(lambda i, j: piece, 0.0, 0.0, 2, 2)
        st.clear()
        st.place_all(pl)
        w = h = 2 * T
        st.aim(90.0, (0.0, 0.0, 0.0), (w / 2.0, h / 2.0), w, h, ppu)
        a = st.quantise(st.passes(w, h, ss), h, w, (UP,), ss=ss, lines=False)
        return int(np.bincount(a.ravel()).argmax())

    nat["renderedFlat"] = {"grass": flat("hex_grass"), "water": flat("hex_water")}
    nat["paintedBase"] = {"grass": GRASS["base"], "water": WATER["base"]}

    pick = rng("nature-pick", T)
    layer = lambda vs: np.concatenate([np.concatenate([vs[int(pick.randint(len(vs)))] for _ in range(cols)], 1) for _ in range(rows)], 0)
    grass, water, deep = layer(grass_v), layer(water_v), layer(deep_v)
    pond = np.array([[1 if ch == "W" else 0 for ch in row] for row in [
        "............",
        "...WWWW.....",
        "..WWWWWW....",
        "..WWWWW.....",
        "...WWW......",
        "............"]], np.uint8)
    hard, soft, stats = blend_layers_painted(grass, water, pond, T, "shore", deep=deep)
    mask = stats.pop("mask")
    nat["pond"] = stats
    titled(pal, np.concatenate([hard, np.full((4, hard.shape[1]), 6, np.uint8), soft], 0),
           "TOP: CELL EDGES  BOTTOM: GENERATED SHORE", os.path.join(OUT, f"nature-pond-{T}@{zoom}x.png"), zoom)

    sprites = {}
    for key, piece, sc in (("tree_a", "tree_single_A", 3.0), ("tree_b", "tree_single_B", 3.0), ("trees_small", "trees_A_small", 2.2),
                           ("rock_a", "rock_single_A", 3.0), ("rock_c", "rock_single_C", 3.0), ("hills_a", "hills_A", 1.0),
                           ("tent", "tent", 2.5), ("barrel", "barrel", 3.0), ("lily", "waterlily_A", 6.0)):
        try:
            sprites[key] = kit.prop(piece, scale=sc)
        except Exception as e:
            log("nature prop", key, "failed:", repr(e))
    nat["spriteSizes"] = {k: list(v.shape[::-1]) for k, v in sprites.items()}
    if "--dump" in sys.argv:
        np.savez_compressed(os.path.join(WORK, f"nat_{T}.npz"), **{"s_" + k: v for k, v in sprites.items()})

    scene = soft[:rows * T].copy()
    for key, c, r in [("tree_a", 1, 1), ("tree_b", 10, 2), ("trees_small", 9, 4), ("rock_a", 7, 4), ("rock_c", 1, 4), ("tent", 10, 4),
                      ("hills_a", 0, 5), ("lily", 4, 2), ("lily", 5, 3), ("barrel", 8, 5)]:
        if key in sprites:
            stand(scene, sprites[key], c, r, T)
    kn, _ = trim(knight)
    stand(scene, kn, 6, 5, T)

    # shore tiles worth showing: the distinct edge tiles of the pond, each cut from the soft map
    shore, seen = [], set()
    for r in range(rows):
        for c in range(cols):
            mt = mask[r * T:(r + 1) * T, c * T:(c + 1) * T]
            if mt.any() and not mt.all():
                sig = tuple(pond[max(0, r - 1):r + 2, max(0, c - 1):c + 2].ravel().tolist()) + (r - max(0, r - 1), c - max(0, c - 1))
                if sig not in seen:
                    seen.add(sig)
                    shore.append(soft[r * T:(r + 1) * T, c * T:(c + 1) * T].copy())
    nat["shoreTilesShown"] = min(len(shore), 12)
    mixg = np.concatenate([np.concatenate([grass_v[(i * 3 + j * 5) % len(grass_v)] for i in range(8)], 1) for j in range(3)], 0)
    mixw = np.concatenate([np.concatenate([water_v[(i * 5 + j * 3) % len(water_v)] for i in range(8)], 1) for j in range(3)], 0)
    items = [("GRASS " + "ABCDEF"[i], grass_v[i]) for i in range(len(grass_v))] + [(None, None), ("GRASS MIXED", mixg), (None, None)]
    items += [("WATER " + "ABCD"[i], water_v[i]) for i in range(len(water_v))] + [("DEEP " + "ABCD"[i], deep_v[i]) for i in range(len(deep_v))]
    items += [(None, None), ("WATER MIXED", mixw), (None, None)]
    items += [("SHORE" if i == 0 else "", s) for i, s in enumerate(shore[:12])] + [(None, None)]
    items += [("POND SCENE WITH A TREE, A ROCK AND THE KNIGHT", scene)]
    label_sheet(items, os.path.join(OUT, f"nature-{T}@{zoom}x.png"), pal, zoom, cols * T + 9)
    write_png(os.path.join(OUT, f"nature-{T}.png"), pal.rgba(scene, (96, 96, 96)))
    st.clear()
    nat["totalSeconds"] = round(time.time() - t0, 1)
    log(f"nature {T}px done {time.time() - t0:.1f}s")
    return scene


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
PAL = None


def isolated_share(a):
    """Share of pixels with no same-valued 4-neighbour (wrapping): the single pixel salt and pepper measure. Diagonal crack steps count."""
    n = [np.roll(a, sh, ax) for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1))]
    return round(float((sum((x == a).astype(np.int32) for x in n) == 0).mean()), 3)


def check_palette(report, tag, arrays):
    """Every painted tile, the room and the pond scene must use palette indices 0..47 only (48..51 are reserved)."""
    worst = max(int(a.max()) for a in arrays.values())
    bad = sorted(k for k, a in arrays.items() if int(a.max()) >= USABLE)
    report["sizes"][tag]["paletteCheck"] = {"checkedArrays": len(arrays), "highestIndexUsed": worst, "allWithin0to47": not bad}
    if bad:
        raise SystemExit(f"env_painted: palette indices above {USABLE - 1} in {bad}")


def main():
    global PAL
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    sizes = [int(x) for x in (argv[argv.index("--sizes") + 1] if "--sizes" in argv else "16,32").split(",")]
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    require(GLTF, "git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0.git .cache/kaykit/dungeon")
    require(PALETTE_JSON, "npm run kaykit:palette")
    require(FRAMES_JSON, "run harness.py --style bands (see scripts/kaykit/README.md)")
    require(CURRENT_JSON, "export the game's sprites with npx tsx (see the docstring at the top of env_probe.py)")
    t_all = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PAL = Pal()
    lib = Library()
    lib.load("floor_tile_large")          # first load fixes the shared atlas and material
    lib.prepare_materials(PAL)
    stage = Stage(lib, PAL)
    report = {"approach": "painted: the render gives the layout, NumPy paints the texture", "renderSeconds": {}, "paintSeconds": {}, "sizes": {}}
    cur = load_current()
    for T in sizes:
        ppu = T / UNITS_PER_TILE
        zoom = 4 if T == 16 else 2
        kit = Kit(stage, ppu)
        tag = str(T)
        t0 = time.time()
        renders0 = stage.render_count
        knight = knight_frame("16x24" if T == 16 else "32x48")
        raw_tiles, sprites = build_tiles(kit, PAL)
        report["renderSeconds"][f"tiles_{T}"] = round(time.time() - t0, 1)
        if "--dump" in argv:
            np.savez_compressed(os.path.join(WORK, f"raw_{T}.npz"), knight=knight, **{"t_" + k: v for k, v in raw_tiles.items()},
                                **{"s_" + k: v for k, v in sprites.items()})
        t1 = time.time()
        rep = report["sizes"].setdefault(tag, {})
        tiles = paint_tiles(raw_tiles, T, rep)
        grass_v, water_v, deep_v = paint_grass(T), paint_water(T), paint_water(T, deep=True)
        report["paintSeconds"][f"tiles_{T}"] = round(time.time() - t1, 2)

        # the room: the same layout as the prototype's, painted floor and border
        room_before = compose_room(raw_tiles, sprites, T, knight)
        room = compose_room_painted(tiles, sprites, T, knight)
        save_pair(f"room-{tag}", room, PAL, zoom)
        compare_rooms(PAL, room_before, room, f"BEFORE (RENDER ONLY) {T}PX", f"AFTER (PAINTED) {T}PX",
                      os.path.join(OUT, f"before-after-room-{tag}@{zoom}x.png"), zoom)
        k = T // 16
        room_cur = np.repeat(np.repeat(compose_current_room(cur), k, 0), k, 1)
        compare_rooms(PAL, room_cur, room, "CURRENT ART" + ("" if T == 16 else " (X2)"), f"PAINTED KAYKIT {T}PX",
                      os.path.join(OUT, f"compare-rooms-{tag}@{zoom}x.png"), zoom)

        # the tile sheet: each tile shown 2 x 2 so a seam would show
        def module(key):
            m = np.zeros((2 * T, 2 * T), np.uint8)
            for c in range(2):
                for r in range(2):
                    m[r * T:(r + 1) * T, c * T:(c + 1) * T] = tiles[f"floor_{key}_{c}{r}"]
            return m

        floor = lambda c, r: tiles[f"floor_stone_{c % 2}{r % 2}"]
        frame = np.concatenate([
            np.concatenate([tiles["cap_nw"], tiles["cap_h_0"], tiles["cap_h_1"], tiles["cap_ne"]], 1),
            np.concatenate([tiles["cap_v_0"], floor(1, 1), floor(0, 1), tiles["cap_v_0"]], 1),
            np.concatenate([tiles["cap_v_1"], floor(1, 0), floor(0, 0), tiles["cap_v_1"]], 1),
            np.concatenate([tiles["cap_sw"], tiles["cap_h_0"], tiles["cap_h_1"], tiles["cap_se"]], 1)], 0)
        items = [("STONE FLOOR (MODULE X2 X2)", tile2x2(module("stone"))), ("WOOD FLOOR (MODULE X2 X2)", tile2x2(module("wood"))), (None, None),
                 ("WALL CAP RUN", tile2x2(np.concatenate([tiles["cap_h_0"], tiles["cap_h_1"]], 1))),
                 ("CAP SIDE", tile2x2(np.concatenate([tiles["cap_v_0"], tiles["cap_v_1"]], 0))), ("BORDER FRAME", frame)]
        items += [(None, None)] + [("GRASS " + "ABCDEF"[i], tile2x2(grass_v[i])) for i in range(len(grass_v))]
        items += [(None, None)] + [("WATER " + "ABCD"[i], tile2x2(water_v[i])) for i in range(4)]
        items += [("DEEP " + "ABCD"[i], tile2x2(deep_v[i])) for i in range(4)]
        label_sheet(items, os.path.join(OUT, f"tiles-{tag}@{zoom}x.png"), PAL, zoom, 13 * T + 16)
        rep["seams"] = seam_report_painted(tiles, grass_v, water_v, deep_v, T)
        cur_sprites = {n: np.where(np.array(v) < 0, TRANSPARENT, np.array(v)).astype(np.uint8) for n, v in
                       json.load(open(CURRENT_JSON))["sprites"].items()}
        rep["isolatedPixelShare"] = {
            "stoneModule": isolated_share(module("stone")), "woodModule": isolated_share(module("wood")),
            "capSlabs": round(float(np.mean([isolated_share(tiles[f"cap_h_{i}"]) for i in range(5)])), 3),
            "grass": round(float(np.mean([isolated_share(a) for a in grass_v])), 3),
            "water": round(float(np.mean([isolated_share(a) for a in water_v])), 3),
            "gameCurrentArtForReference": {"floor_stone": isolated_share(cur_sprites["floor_stone"]),
                                           "floor_grass": isolated_share(cur_sprites["floor_grass"]), "water": isolated_share(cur_sprites["water"])}}
        rep["tileNames"] = sorted(n for n in tiles if n.startswith(("floor_stone", "floor_wood", "cap_")))

        # autotiling, stone with a wood rug (the prototype's demo, with the painted edge)
        shape = ["..........", ".WWWW.....", ".WWWWWW...", ".WWWWWW...", "..WW.WW...", ".........."]
        cells = np.array([[1 if ch == "W" else 0 for ch in row] for row in shape], np.uint8)
        layer = lambda kind: np.concatenate([np.concatenate([tiles[f"floor_{kind}_{c % 2}{r % 2}"] for c in range(cells.shape[1])], 1)
                                             for r in range(cells.shape[0])], 0)
        hard, soft, stats = blend_layers_painted(layer("stone"), layer("wood"), cells, T, "raised")
        stats.pop("mask")
        rep["autotile"] = stats
        titled(PAL, np.concatenate([hard, np.full((4, hard.shape[1]), 6, np.uint8), soft], 0), "TOP: CELL EDGES  BOTTOM: GENERATED",
               os.path.join(OUT, f"autotile-stone-wood-{tag}@{zoom}x.png"), zoom)
        rep["renders"] = stage.render_count - renders0
        stage.clear()
        scene = nature_painted(T, PAL, knight, zoom, report.setdefault("natureBySize", {}).setdefault(tag, {}), grass_v, water_v, deep_v)
        check_palette(report, tag, {"room": room, "scene": scene, **{k: v for k, v in tiles.items() if k.startswith(("floor_stone", "floor_wood", "cap_"))},
                                    **{f"grass_{i}": a for i, a in enumerate(grass_v)}, **{f"water_{i}": a for i, a in enumerate(water_v)},
                                    **{f"deep_{i}": a for i, a in enumerate(deep_v)}})
        log(f"{T}px done {time.time() - t0:.1f}s")
    report["changed"] = {
        "stone floor": "octagon paving (lattice read off the render): lit upper left edge, shaded lower right edge, mortar, recessed diamond insets, mottling, clustered speckle, cracks",
        "wood floor": "boards in running bond (rows and joints read off the render): lit top edge in broken runs, gap line, shaded end, grain strokes, knots, nails (32px)",
        "wall caps": "one slab per tile: lit top and left, shaded bottom and right, mortar joint, flecks, mottling, the odd crack; corner wedges take the light from their side",
        "grass": "three greens in clumps of a few pixels plus tufts; six variants (one with flowers) that share their outermost ring exactly, so any variant sits beside any other",
        "water": "short horizontal ripples (a light line and its shadow) and dashes of a darker step, four variants sharing a plain outer ring; a darker ramp for the pond's middle",
        "shore": "same autotile mask as the prototype, plus a lit lip, a bank shadow and a dark grass outline",
        "room": "floor shading along the north and west walls, raised rug edge; props, door, wall faces untouched",
    }
    report["seamNotes"] = (
        "across: share of boundary pixel pairs whose luminance jumps by more than 14 (of 255) where two tiles meet, averaged over the pairs checked. "
        "insideLast2 is the prototype's own number (the last two columns or rows inside a tile). insideMean and insideMax are the same share at every "
        "other boundary inside the two tiles side by side. A seam-free texture has worstAcross no worse than insideMax (noWorseThanInside). Wood's "
        "top to bottom figure is high because a module edge is a board edge (dark gap line above the next board's lit edge), exactly as at every "
        "other board edge inside the module; the wall cap joint is a deliberate mortar joint between slabs. Grass and water tiles share their outermost "
        "ring, so a tile beside itself and any variant beside any variant meet exactly as the shared base meets itself across its own wrap.")
    report["knownLimits"] = [
        "the stone and wood floors repeat every 2 x 2 tiles (the render's module holds four stones and eight boards per row), so a crack or a knot recurs at that interval",
        "wall cap slabs are one tile square, as the render's joints are; five cap variants are scattered in the room, the tile dictionary holds five per direction",
        "grass and water tiles share a one pixel ring and the variant noise blends in over three pixels, so the four outer pixels of every tile are the same texture in every variant",
        "16 px: the stone has no shaded edge (no room beside the mortar) and the wood has no lit end or nails; 32 px carries both",
        "the shore is a one pixel lip and outline at 16 px (two at 32 px); a wider bank or foam is not attempted",
    ]
    report["images"] = {
        "room-{T}": "the sample room (12 x 9 tiles, same layout as env_probe.py) with painted floors and border, Knight for scale",
        "nature-{T}": "painted grass variants, water variants, pond shore tiles, and a pond scene with a tree, a rock and the Knight",
        "tiles-{T}": "painted stone and wood floor, wall caps, the border frame, grass and water, each shown 2 x 2 so a seam would show",
        "before-after-room-{T}": "the render only (env_probe.py's room) on the left, painted on the right",
        "compare-rooms-{T}": "the game's current hand drawn room on the left, painted KayKit on the right",
        "nature-pond-{T}": "pond: cell edges only (top) against generated shore (bottom)",
        "autotile-stone-wood-{T}": "wood rug on stone: cell edges only (top) against generated edge (bottom)",
    }
    report["totalSeconds"] = round(time.time() - t_all, 1)
    report["totalRenders"] = RENDERS[0]
    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    log("done in %.1fs, %d renders" % (time.time() - t_all, RENDERS[0]))


if __name__ == "__main__":
    main()
