"""
KayKit Dungeon (remastered) -> game environment tiles: a projection and quantisation probe (Blender 5.2, headless).

The question this answers with pixels: can Kay Lousberg's CC0 Dungeon pack replace the Living Table's hand-drawn environment
(floors, walls, doors, props)? The game draws floors as SQUARE top-down tiles and walls as front faces (FF6 oblique), on a 20x15
grid of 16x16 cells, in one 52 colour palette. The character pipeline (harness.py) looks down 30 degrees. Those do not agree, so
the crux is the projection.

Approaches tried (each written out as a room image under .cache/kaykit/out/env/):

  A  SPLIT. Floors and wall caps from straight above (pitch 90), wall faces from the front (pitch 0), props from the character
     camera (pitch 30). Each render is sliced into 16x16 (or 32x32) tiles and the room is composed from isolated tiles, the way
     the game's DM composes cells. Kept.
  B  ONE 30-DEGREE CAMERA, sliced. The whole room in the character camera. The floor foreshortens to 16x8 cells, so it cannot be
     cut into the game's square cells. Kept as the control that shows why.
  C  ONE CABINET CAMERA, sliced. Pitch 45 with a vertical stretch (world y and z scaled by 1/sin(pitch), which for an orthographic
     camera is exactly a cabinet projection) so floors are square and a unit of wall height is a unit of floor depth. One render of
     the whole room, cut into cells.

The conversion reuses the ideas of styles/bands.py and styles/pixelart.py (flat albedo pass from a flattened atlas, a normal pass lit
in numpy with a fixed upper-left light, majority material per pixel, palette ramps, selective outline) and adds two rules for tiles:
a pixel whose sub-pixels are mostly sloped (a bevel, a groove, a brick edge) becomes a one pixel line lit from the slope alone, and a
flat face sits on a ramp step chosen from its swatch's brightness plus a per-plane bias (caps lighter, wall faces darker), because a
pixel artist lights planes by value and a flat face has the same n.L from every camera.

Stages (all by default): A tiles and the sample rooms (plus the autotile demo), B and C single-camera rooms, N nature. N uses the
Medieval Hexagon pack if it has been cloned into .cache/kaykit/scratch/env/hexagon and is skipped otherwise.

Run from the repo root (about 15 seconds, 380 renders):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/env_probe.py [-- --only ABCN --sizes 16,32]

Inputs (all under .cache/, gitignored):
  .cache/kaykit/dungeon/                   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0.git
  .cache/kaykit/scratch/env/hexagon/       (optional) git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0.git
  .cache/kaykit/palette-fantasy.json       npm run kaykit:palette
  .cache/kaykit/out/bands/frames.json      the Knight, from harness.py --style bands
  .cache/kaykit/scratch/env/current.json   the game's current sprites, for the side by side. Made by running this with
                                           `npx tsx`, from the repo root:
      import { SPRITES } from "../../../../scripts/assets/fantasy";
      import { writeFileSync } from "node:fs";
      const o: Record<string, number[][]> = {};
      for (const s of SPRITES) o[s.assetId] = s.pixels;
      writeFileSync(".cache/kaykit/scratch/env/current.json", JSON.stringify({ sprites: o }));
    (saved as .cache/kaykit/scratch/env/export-current.ts, so the relative import resolves)
Outputs: .cache/kaykit/out/env/*.png (name.png at native size, name@Nx.png enlarged for looking at) and report.json.
"""
import base64
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
OUT = os.path.join(ROOT, ".cache", "kaykit", "out", "env")
SCRATCH = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env")
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


def seam_report(tiles, T):
    """How cleanly do tiles abut? The share of boundary pixels whose luminance jumps by more than 14 (of 255) across the boundary,
    against the same share between the last two columns (rows) inside a tile. Floors are checked where the room puts them next to
    each other: two quadrants of one 4 x 4 unit module, and a module next to the same module again (the wrap). A tile repeated on
    its own (small floor tiles) is checked the same way."""
    rgb = PAL.rgb.astype(np.float32)
    lum = lambda a: (rgb[a.astype(np.int32)] * np.array([0.30, 0.59, 0.11], np.float32)).sum(-1)

    def jump(a, b, axis):
        la, lb = lum(a), lum(b)
        if axis == 1:
            return float((np.abs(la[:, -1] - lb[:, 0]) > 14).mean()), float((np.abs(la[:, -2] - la[:, -1]) > 14).mean())
        return float((np.abs(la[-1, :] - lb[0, :]) > 14).mean()), float((np.abs(la[-2, :] - la[-1, :]) > 14).mean())

    rep = {}
    for key in ("stone", "wood", "dirt", "stonerocks"):
        q = lambda c, r: tiles[f"floor_{key}_{c}{r}"]
        rep[f"floor_{key}: quadrants inside a module, left to right"] = jump(q(0, 0), q(1, 0), 1)
        rep[f"floor_{key}: quadrants inside a module, top to bottom"] = jump(q(0, 0), q(0, 1), 0)
        rep[f"floor_{key}: module next to itself, left to right"] = jump(q(1, 0), q(0, 0), 1)
        rep[f"floor_{key}: module next to itself, top to bottom"] = jump(q(0, 1), q(0, 0), 0)
    for key in ("small", "small_broken", "small_weeds", "grate"):
        t = tiles[f"floor_{key}"]
        rep[f"floor_{key}: one tile repeated, left to right"] = jump(t, t, 1)
        rep[f"floor_{key}: one tile repeated, top to bottom"] = jump(t, t, 0)
    for i in range(4):
        rep[f"wall cap: run tile {i} to {i + 1}"] = jump(tiles[f"cap_h_{i}"], tiles[f"cap_h_{i + 1}"], 1)
        rep[f"wall face (upper row): run tile {i} to {i + 1}"] = jump(tiles[f"face_up_{i}"], tiles[f"face_up_{i + 1}"], 1)
    return {k: {"across": round(v[0], 3), "inside": round(v[1], 3)} for k, v in rep.items()}


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


def compose_room_1row(tiles, sprites, T, knight=None):
    """The same room with the wall squashed to one tile row of face, the height of the game's current walls (wall_stone_top above
    one row of wall_stone). Everything else is as in compose_room; the floor gains a row."""
    room = np.full((ROWS * T, COLS * T), 6, np.uint8)

    def put(c, r, key):
        blit(room, tiles[key], c * T, r * T)

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
    for c in range(1, COLS - 1):
        if c % 2 == 0:
            i = 0 if (c // 2) % 2 else 4
        else:
            i = 1 if (c // 2) % 2 else 3
        key = f"face1_{i}"
        if c == 4:
            key = "door1"
        elif c == 3:
            key = "door1_side_l"
        elif c == 5:
            key = "door1_side_r"
        elif c in (2, 6, 10):
            key = "face1_torch"
        put(c, 1, key)
    for r in range(2, ROWS - 1):
        for c in range(1, COLS - 1):
            kind = "wood" if (6 <= c <= 9 and 4 <= r <= 7) else "stone"
            put(c, r, f"floor_{kind}_{c % 2}{r % 2}")
    keys = {"barrel_large": "barrel", "box_large": "crate", "chest": "chest", "torch_lit": "torch", "table_medium": "table",
            "chair": "chair", "barrel_small": "barrel_small"}
    for piece, (c, r), _ in ROOM_PROPS:
        stand(room, sprites[keys[piece]], c, r - (1 if r == 3 else 0), T)
    if knight is not None:
        k, _ = trim(knight)
        stand(room, k, 4, 5, T)
    return room


# ---------------------------------------------------------------------------
# Approach B and C: one camera, the whole room, then cut into cells
# ---------------------------------------------------------------------------

def room_3d(with_props=True):
    """World placements for the north half of the sample room, tile (c, r) centred on x = 2c, y = 2(ROWS-1-r). Floor modules are
    4 x 4 units, aligned to even columns and rows exactly like the tile composition. The side and south walls are left out on
    purpose: in a single-camera view a tall south or side wall hides the floor behind it, which is the whole problem."""
    def X(c):
        return 2.0 * c

    def Y(r):
        return 2.0 * (ROWS - 1 - r)

    pl = []
    for c0 in range(0, COLS, 2):
        for r0 in range(2, ROWS, 2):
            wood = c0 in WOOD_COLS and r0 in WOOD_ROWS
            pl.append(dict(name="floor_wood_large" if wood else "floor_tile_large", loc=(X(c0) + 1.0, Y(r0) - 1.0, 0.0)))
    yc = Y(2)        # the north wall's footprint is row 2; its face is on the row's south edge
    for i in range(0, 7):
        x = 4.0 * i
        name = "wall_doorway" if i == 2 else ("wall_window_open" if i == 4 else "wall")
        pl.append(dict(name=name, loc=(x, yc, 0.0), scale=(1.0, WALL_THICK, 1.0)))
    for c in (2, 6, 10):
        pl.append(dict(name="torch_mounted", loc=(X(c), yc - WALL_THICK / 2.0, 2.85)))
    if with_props:
        for name, (c, r), sc in ROOM_PROPS:
            pl.append(dict(name=name, loc=(X(c), Y(r), 0.0), scale=(sc,) * 3))
    return pl


def single_camera_room(stage, ppu, pitch, stretch):
    """Render the north half of the room through ONE camera. stretch=True applies the cabinet stretch (world y and z scaled
    by 1/sin(pitch)) so floors are square and a unit of height is a unit of floor depth."""
    T = int(round(UNITS_PER_TILE * ppu))
    st = stage
    sp, cp = math.sin(math.radians(pitch)), math.cos(math.radians(pitch))
    s = 1.0 / sp if stretch else 1.0
    st.world = np.array([1.0, s, s])
    st.clear()
    st.place_all(room_3d())
    v_bottom = Y_SOUTH(8) * sp * s
    v_top = (2.0 * (ROWS - 1 - 2) + 1.0) * sp * s + 4.0 * cp * s
    h = int(round((v_top - v_bottom) * ppu)) if stretch else int(math.ceil((v_top - v_bottom) * ppu)) + 1
    w = COLS * T
    st.aim(pitch, (0.0, Y_SOUTH(8), 0.0), (T / 2.0, h), w, h, ppu)
    img = st.quantise(st.passes(w, h), h, w, (UP, FRONT), prop=True, light=SINGLE_LIGHT, lam_ref=SINGLE_LAM_REF,
                      level_k=5.0)
    st.world = np.array([1.0, 1.0, 1.0])
    return img


def Y_SOUTH(r):
    """World y of the south edge of tile row r."""
    return 2.0 * (ROWS - 1 - r) - 1.0


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


def compare_tiles(pal, rows, path, zoom):
    """rows: list of (label, [current arrays], [kaykit arrays]). Current on the left, KayKit on the right of a divider."""
    pad, lab, lw = 3, 8, 40
    cell_h = max(max(a.shape[0] for a in cur + kk) for _, cur, kk in rows)
    left_w = max(sum(a.shape[1] + pad for a in cur) for _, cur, kk in rows)
    right_w = max(sum(a.shape[1] + pad for a in kk) for _, cur, kk in rows)
    w = lw + left_w + 8 + right_w + pad
    h = lab + len(rows) * (cell_h + pad + 2) + pad
    canvas = np.zeros((h, w, 4), np.uint8)
    canvas[..., :3] = (40, 40, 48)
    canvas[..., 3] = 255
    draw_text(canvas, "CURRENT", lw, 2)
    draw_text(canvas, "KAYKIT", lw + left_w + 8, 2)
    for ri, (label, cur, kk) in enumerate(rows):
        y0 = lab + ri * (cell_h + pad + 2)
        draw_text(canvas, label, 2, y0 + cell_h // 2 - 2)
        for x0, arrs in ((lw, cur), (lw + left_w + 8, kk)):
            x = x0
            for a in arrs:
                rgba = pal.rgba(a, (72, 72, 80))
                canvas[y0 + cell_h - a.shape[0]:y0 + cell_h, x:x + a.shape[1]] = rgba
                x += a.shape[1] + pad
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


def blend_layers(under, over, cells, T, under_cls, over_cls, seed=7):
    """Autotile two full-map pixel layers. `cells` marks the tiles of the `over` patch. Returns (hard, soft, stats): hard is the plain
    cell-edge composition, soft has transition tiles. Each transition tile is made alone from its 3 x 3 neighbourhood, composed, and
    compared pixel for pixel with the whole-map result (maskMismatchPixels must be 0, or neighbouring tiles would not meet)."""
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
    out = np.where(m, over, under)
    nb = lambda a, dy, dx: shift(a, dy, dx, False)
    lip = m & ~(nb(m, -1, 0) & nb(m, 1, 0) & nb(m, 0, -1) & nb(m, 0, 1))
    shadow = ~m & (nb(m, -1, 0) | nb(m, 0, -1))
    lut_o = np.array([shade_index(i, over_cls, 2) for i in range(52)], np.uint8)
    lut_u = np.array([shade_index(i, under_cls, 1) for i in range(52)], np.uint8)
    out = np.where(lip, lut_o[out], out)
    out = np.where(shadow, lut_u[out], out)
    return hard, out, {"signaturesUsed": len(sigs), "maskMismatchPixels": mismatch}


def titled(pal, arr, title, path, zoom):
    rgba = pal.rgba(arr)
    canvas = np.zeros((rgba.shape[0] + 10, rgba.shape[1] + 8, 4), np.uint8)
    canvas[..., :3] = (40, 40, 48)
    canvas[..., 3] = 255
    canvas[10:, 4:-4] = rgba
    draw_text(canvas, title, 4, 2)
    write_png(path, np.repeat(np.repeat(canvas, zoom, 0), zoom, 1))


def autotile_demo(tiles, T, pal, path, zoom):
    """A wood rug on stone. Top: cell edges only. Bottom: the same map with generated transition tiles."""
    shape = ["..........",
             ".WWWW.....",
             ".WWWWWW...",
             ".WWWWWW...",
             "..WW.WW...",
             ".........."]
    cells = np.array([[1 if ch == "W" else 0 for ch in row] for row in shape], np.uint8)
    rows, cols = cells.shape

    def layer(kind):
        out = np.zeros((rows * T, cols * T), np.uint8)
        for r in range(rows):
            for c in range(cols):
                out[r * T:(r + 1) * T, c * T:(c + 1) * T] = tiles[f"floor_{kind}_{c % 2}{r % 2}"]
        return out

    hard, soft, stats = blend_layers(layer("stone"), layer("wood"), cells, T, "stone", "wood")
    both = np.concatenate([hard, np.full((4, hard.shape[1]), 6, np.uint8), soft], 0)
    titled(pal, both, "TOP: CELL EDGES  BOTTOM: GENERATED", path, zoom)
    return stats


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


def nature_stage(T, pal, cur, knight, zoom, report):
    """Grass and water from hex lattices cut into square cells, a pond blended with generated transitions, and trees, rocks and hills
    as standing sprites (scaled up: the hex pack's props are miniatures)."""
    if not os.path.isdir(HEX):
        log("nature: hexagon pack not found at", HEX, "(clone KayKit-Medieval-Hexagon-Pack-1.0 there to enable)")
        return
    ppu = T / UNITS_PER_TILE
    lib = Library(hex_finder())
    lib.load("hex_grass")
    lib.prepare_materials(pal)
    st = Stage(lib, pal)
    kit = Kit(st, ppu)
    t0 = time.time()
    cols, rows = 12, 6
    ss = 4 if T >= 32 else SS

    def field(piece_at, bias=0.0):
        pl = hex_field(piece_at, 0.0, 0.0, cols, rows)
        st.clear()
        st.place_all(pl)
        w, h = cols * T, rows * T
        st.aim(90.0, (0.0, 0.0, 0.0), (w / 2.0, h / 2.0), w, h, ppu)
        return st.quantise(st.passes(w, h, ss), h, w, (UP,), bias=bias, ss=ss, lines=False)

    grass = field(lambda i, j: "hex_grass")
    water = field(lambda i, j: "hex_water")
    report["nature"] = {"fieldRenderSeconds": round(time.time() - t0, 1)}
    pond = np.array([[1 if ch == "W" else 0 for ch in row] for row in [
        "............",
        "...WWWW.....",
        "..WWWWWW....",
        "..WWWWW.....",
        "...WWW......",
        "............"]], np.uint8)
    hard, soft, stats = blend_layers(grass, water, pond, T, "grass", "water")
    report["nature"]["pond"] = stats
    titled(pal, np.concatenate([hard, np.full((4, hard.shape[1]), 6, np.uint8), soft], 0),
           "TOP: HEX CELLS  BOTTOM: GENERATED SHORE", os.path.join(OUT, f"nature-pond-{T}@{zoom}x.png"), zoom)

    # the pack's own transition pieces, dropped into a grass lattice: what a coast, a river and a road look like cut square
    def special(piece):
        c = {"centre": piece}
        return field(lambda i, j: c["centre"] if (i, j) == (0, 0) else "hex_grass")

    coast, river, road = special("hex_coast_A"), special("hex_river_A"), special("hex_road_A")
    mid = lambda a: a[(rows // 2 - 1) * T:(rows // 2 + 1) * T, (cols // 2 - 1) * T:(cols // 2 + 1) * T]
    specials = [mid(coast), mid(river), mid(road)]

    # standing sprites
    sprites = {}
    for key, piece, sc in (("tree_a", "tree_single_A", 3.0), ("tree_b", "tree_single_B", 3.0), ("trees_small", "trees_A_small", 2.2),
                           ("trees_medium", "trees_A_medium", 1.8), ("rock_a", "rock_single_A", 3.0), ("rock_c", "rock_single_C", 3.0),
                           ("hills_a", "hills_A", 1.0), ("mountain_a", "mountain_A_grass", 1.0), ("tent", "tent", 2.5),
                           ("crate", "crate_A_big", 3.0), ("barrel", "barrel", 3.0), ("lily", "waterlily_A", 6.0)):
        try:
            sprites[key] = kit.prop(piece, scale=sc)
        except Exception as e:
            log("nature prop", key, "failed:", repr(e))
    report["nature"]["spriteSizes"] = {k: list(v.shape[::-1]) for k, v in sprites.items()}
    report["nature"]["totalSeconds"] = round(time.time() - t0, 1)

    # an outdoor sample: the soft pond map with props stood on it
    scene = soft[:rows * T].copy()
    tiles_stand = [("tree_a", 1, 1), ("tree_b", 10, 2), ("trees_small", 9, 4), ("rock_a", 7, 4), ("rock_c", 1, 4), ("tent", 10, 4),
                   ("hills_a", 0, 5), ("lily", 4, 2), ("lily", 5, 3), ("barrel", 8, 5)]
    for key, c, r in tiles_stand:
        if key in sprites:
            stand(scene, sprites[key], c, r, T)
    kn, _ = trim(knight)
    stand(scene, kn, 6, 5, T)
    titled(pal, scene, "OUTDOOR SAMPLE: HEX GRASS AND WATER", os.path.join(OUT, f"nature-sample-{T}@{zoom}x.png"), zoom)

    # sheet of the raw pieces next to the game's own
    k = T // 16
    up = lambda a: np.repeat(np.repeat(a, k, 0), k, 1)
    rows_cmp = [
        ("GRASS", [up(cur[n]) for n in ("floor_grass", "floor_grass_b", "floor_grass_tufted", "floor_grass_flowers")],
         [grass[:T, :T], grass[T:2 * T, T:2 * T], specials[2]]),
        ("WATER", [up(cur[n]) for n in ("water", "water_b")], [water[:T, :T], water[T:2 * T, T:2 * T], specials[0], specials[1]]),
        ("SHORE", [up(cur["floor_grass_edge_n"]), up(cur["floor_grass_edge_ne"]), up(cur["floor_grass_edge_inw"])],
         [soft[T:2 * T, 2 * T:3 * T], soft[T:2 * T, 3 * T:4 * T], soft[2 * T:3 * T, 2 * T:3 * T]]),
        ("TREE", [up(cur["tree"]), up(cur["forest_canopy"])], [sprites[n] for n in ("tree_a", "tree_b", "trees_small") if n in sprites]),
        ("ROCK", [up(cur["cliff_top"]), up(cur["cliff_face"])], [sprites[n] for n in ("rock_a", "rock_c", "hills_a", "mountain_a") if n in sprites]),
    ]
    compare_tiles(pal, rows_cmp, os.path.join(OUT, f"compare-nature-{T}@{zoom}x.png"), zoom)
    st.clear()
    log(f"nature {T}px done {time.time() - t0:.1f}s")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
PAL = None


def main():
    global PAL
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = argv[argv.index("--only") + 1] if "--only" in argv else "ABCN"
    sizes = [int(x) for x in (argv[argv.index("--sizes") + 1] if "--sizes" in argv else "16,32").split(",")]
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SCRATCH, exist_ok=True)
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
    report = {"renderSeconds": {}, "sizes": {}}
    cur = load_current()

    for T in sizes:
        ppu = T / UNITS_PER_TILE
        zoom = 4 if T == 16 else 2
        k = T // 16
        up = lambda a, k=k: np.repeat(np.repeat(a, k, 0), k, 1)
        kit = Kit(stage, ppu)
        tag = str(T)
        t0 = time.time()
        renders0 = stage.render_count
        knight = knight_frame("16x24" if T == 16 else "32x48")
        room_cur = up(compose_current_room(cur))
        save_pair("room-current-16" if T == 16 else "room-current-32-upscaled", room_cur, PAL, zoom)
        room = None
        if "A" in only:
            tiles, sprites = build_tiles(kit, PAL)
            report["renderSeconds"][f"tiles_{T}"] = round(time.time() - t0, 1)
            room = compose_room(tiles, sprites, T, knight)
            save_pair(f"room-{tag}", room, PAL, zoom)
            room1 = compose_room_1row(tiles, sprites, T, knight)
            save_pair(f"room-1row-{tag}", room1, PAL, zoom)
            compare_rooms(PAL, room_cur, room1, "CURRENT ART" + ("" if T == 16 else " (X2)"), f"KAYKIT, 1 ROW WALL {T}PX",
                          os.path.join(OUT, f"compare-rooms-1row-{tag}@{zoom}x.png"), zoom)
            floors = [tiles[n] for n in sorted(tiles) if n.startswith("floor_")]
            walls = [tiles[n] for n in sorted(tiles) if n.startswith(("cap_", "face", "door", "win_", "banner"))]
            props = [sprites[n] for n in sorted(sprites)]
            sheet(floors, 8, T, PAL, os.path.join(OUT, f"tiles-floors-{tag}@{zoom}x.png"), zoom)
            sheet(walls, 8, T, PAL, os.path.join(OUT, f"tiles-walls-{tag}@{zoom}x.png"), zoom)
            sheet(props, 8, T, PAL, os.path.join(OUT, f"tiles-props-{tag}@{zoom}x.png"), zoom)
            compare_rooms(PAL, room_cur, room, "CURRENT ART" + ("" if T == 16 else " (X2)"), f"KAYKIT DUNGEON {T}PX",
                          os.path.join(OUT, f"compare-rooms-{tag}@{zoom}x.png"), zoom)
            kn, _ = trim(knight)
            rows = [
                ("FLOOR", [cur[n] for n in ("floor_stone", "floor_stone_b", "floor_stone_c", "floor_stone_d")],
                 [tiles[n] for n in ("floor_stone_00", "floor_stone_10", "floor_stone_01", "floor_stone_11")]),
                ("OTHER", [cur[n] for n in ("floor_dirt", "floor_sand")],
                 [tiles[n] for n in ("floor_dirt_00", "floor_dirt_10", "floor_wood_00", "floor_wood_10", "floor_small", "floor_small_broken")]),
                ("WALL", [cur[n] for n in ("wall_stone", "wall_stone_b", "wall_stone_c", "wall_stone_base")],
                 [stack(tiles[f"face_up_{i}"], tiles[f"face_dn_{i}"]) for i in (0, 1, 3, 2)]),
                ("TOP", [cur["wall_stone_top"]], [tiles[n] for n in ("cap_h_0", "cap_h_1", "cap_v_0", "cap_ne")]),
                ("DOOR", [cur["door_closed"], cur["door_open"]],
                 [stack(tiles["door_up"], tiles["door_dn"]), stack(tiles["door_open_up"], tiles["door_open_dn"]),
                  stack(tiles["win_up"], tiles["win_dn"]), stack(tiles["face_torch_up"], tiles["face_dn_0"])]),
                ("PROPS", [up(cur[n]) for n in ("chest", "chest_open", "torch", "table_w", "table_e")],
                 [sprites[n] for n in ("chest", "barrel", "crate", "torch", "table", "chair")]),
                ("TOKEN", [up(cur["token_knight"])], [kn]),
            ]
            if k > 1:
                rows = [(lab, [up(a) if lab not in ("PROPS", "TOKEN") else a for a in c], kk) for lab, c, kk in rows]
            compare_tiles(PAL, rows, os.path.join(OUT, f"compare-tiles-{tag}@{zoom}x.png"), zoom)
            report["sizes"][tag] = {"seams": seam_report(tiles, T), "tileNames": sorted(tiles), "spriteNames": sorted(sprites),
                                    "spriteSizes": {n: list(v.shape[::-1]) for n, v in sprites.items()}}
            report["sizes"][tag]["autotile"] = autotile_demo(tiles, T, PAL, os.path.join(OUT, f"autotile-stone-wood-{tag}@{zoom}x.png"), zoom)
            log(f"A {T}px done {time.time() - t0:.1f}s")
        if "B" in only:
            t1 = time.time()
            img = single_camera_room(stage, ppu, 30.0, False)
            save_pair(f"approachB-30deg-{tag}", img, PAL, zoom)
            report["renderSeconds"][f"B_{T}"] = round(time.time() - t1, 1)
            report["sizes"].setdefault(tag, {})["approachB_size"] = [img.shape[1], img.shape[0]]
        if "C" in only:
            t1 = time.time()
            img = single_camera_room(stage, ppu, 45.0, True)
            kn, _ = trim(knight)
            stand(img, kn, 4, 5, T)
            save_pair(f"approachC-cabinet-{tag}", img, PAL, zoom)
            report["renderSeconds"][f"C_{T}"] = round(time.time() - t1, 1)
            report["sizes"].setdefault(tag, {})["approachC_size"] = [img.shape[1], img.shape[0]]
        report["sizes"].setdefault(tag, {})["renders"] = stage.render_count - renders0
        if "N" in only:
            stage.clear()
            nature_stage(T, PAL, cur, knight, zoom, report.setdefault("natureBySize", {}).setdefault(tag, {}))
    desc = {
        "room-{T}": "approach A: the sample room (12 x 9 tiles, wall face 2 tiles tall) composed from isolated KayKit tiles, Knight for scale",
        "room-1row-{T}": "approach A with the wall squashed to one tile row of face, the height of the game's current walls",
        "room-current-{T}": "the same room from the game's current tiles (32px file is the 16px art enlarged x2)",
        "approachB-30deg-{T}": "approach B: whole north half of the room in the 30 degree character camera (floor is 2:1, not square)",
        "approachC-cabinet-{T}": "approach C: whole north half of the room in one cabinet camera (pitch 45, y and z stretched), floors square",
        "compare-rooms-{T}": "current art (left) against approach A (right)",
        "compare-rooms-1row-{T}": "current art (left) against approach A with a one row wall (right)",
        "compare-tiles-{T}": "tile by tile: floor, other floors, wall face, wall top, door, props, token; current left, KayKit right",
        "tiles-floors-{T}": "every floor tile rendered, sorted by id",
        "tiles-walls-{T}": "every wall tile rendered (caps, faces, doors, windows, torch, banner), sorted by id",
        "tiles-props-{T}": "every standing prop rendered from the character camera, sorted by id",
        "autotile-stone-wood-{T}": "autotiling: a wood rug on stone, cell edges (top) against generated transition tiles (bottom)",
        "nature-pond-{T}": "hex grass and hex water fields cut square, pond with generated shore tiles",
        "nature-sample-{T}": "outdoor sample: hex grass and water, generated shore, trees, rocks, hills, tent, Knight",
        "compare-nature-{T}": "grass, water, shore, trees, rocks: current left, KayKit hex pack right",
    }
    report["images"] = {}
    for T in sizes:
        zoom = 4 if T == 16 else 2
        for key, text in desc.items():
            base = key.format(T=T)
            if T == 32 and key == "room-current-{T}":
                base = "room-current-32-upscaled"
            for cand in (f"{base}@{zoom}x.png", f"{base}.png"):
                if os.path.exists(os.path.join(OUT, cand)):
                    report["images"][cand] = text
    report["totalSeconds"] = round(time.time() - t_all, 1)
    report["totalRenders"] = RENDERS[0]
    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    log("done in %.1fs, %d renders" % (time.time() - t_all, RENDERS[0]))


if __name__ == "__main__":
    main()
