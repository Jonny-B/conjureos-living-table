"""
KayKit free packs -> the game's FANTASY prop library, as sprites (Blender 5.2, headless).

Converts every target in group "prop" of .cache/kaykit/library/targets.json (39 ids: the two doors and their two side-on leaves, tree and
its left and right offsets, torch and its offsets, chest and chest_open, the 3 x 3 cottage, the archway, the stair, the pillar, the table, the bed,
the fence and the well) into renders of Kay Lousberg's free CC0 KayKit packs, in the game's 52 colour palette (indices 0..47).

The look is the owner-approved prop look of env_probe.py: a fixed orthographic camera 30 degrees down, the flat albedo pass from a
flattened atlas, a normal pass lit in numpy from the upper left, the majority material per pixel, one palette ramp per material
class, a class coloured one pixel outline around the silhouette. That code path is copied here (not imported) so this maker owns
its inputs: one atlas per pack (the packs do not share one), per-swatch ramp overrides, and canvases sized to the game's tile shapes.

Multi-tile props are ONE model rendered ONCE and sliced into the per-tile ids, so the pieces join with no seam when the DM lays
them in their shape:

  cottage_*    one Medieval Hexagon house, 3 x 3 cells (the bottom row is a half tile high strip, as in the game's shape)
  arch_*       one gateway, 3 x 1 cells
  stair_up_*   one flight of steps, 2 x 1
  pillar_*     one pillar, 1 x 2
  table_*      one table, 2 x 1
  bed_*        one bed, 1 x 2
  fence_*      a post and rail run, 3 x 1, periodic every tile so the middle piece repeats
  well_*       one well, 2 x 2

door_closed_ns / door_open_ns are the leaves of a door in a north-south wall (render/wallProfiles.ts: render-only, drawn over the ground makers' own
jamb overlay): the doorway's door mesh alone, seen from straight above, reduced to its plank and drawn to the pixel boxes the game's hand-drawn leaves use,
with two iron straps and the ring pull drawn on (see r_door_ns).

tree_left / tree_right / torch_left / torch_right are the plain tree and torch shifted sideways, exactly as scripts/assets/fantasy.ts
does it (the tree by 2 px at 16, the torch by 3 px; doubled at 32). Sizes: 16 is the game's native size; 32 is the same shot at
twice the resolution (every recipe is written in tile units, so the two sizes share all of its geometry).

Run from the repo root (about 5 seconds, 84 renders; the output is byte for byte the same on every run):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/lib_props.py [-- --sizes 16,32]
  node scripts/kaykit/check-part.mjs .cache/kaykit/library/parts/props-16.json

Development switches (none of them is needed for the real run; `--only` does not write the part files):
  --only tree,chest,cottage        run just these recipes (an asset id or a recipe name) and write only the sheets
  --shapes cottage,well            draw only these shapes on the shapes sheet
  --zoom 8                         sheet enlargement (default 4 at 16 px, 2 at 32 px)
  --set well_sx=1.2,chest_ang=120  override a recipe knob (S.opts in the recipes)
  --peek pack:model[:pitch[:yaw[:skip+skip]]]   render one raw model (textured, unquantised) to .cache/kaykit/scratch/props/peek/ and stop

Inputs (all under .cache/, gitignored; every pack is CC0, Kay Lousberg, github.com/KayKit-Game-Assets):
  .cache/kaykit/dungeon/                   KayKit-Dungeon-Remastered-1.0      chest, stairs, pillar, table, wall_doorway, torch_mounted
  .cache/kaykit/scratch/env/hexagon/       KayKit-Medieval-Hexagon-Pack-1.0   house, well, trees, wood fence
  .cache/kaykit/furniture/                 KayKit-Furniture-Bits-1.0          bed
  .cache/kaykit/halloween/                 KayKit-Halloween-Bits-1.0          arch, fence pieces
  .cache/kaykit/prototype/                 KayKit-Prototype-Bits-1.0          door leaf
  .cache/kaykit/palette-fantasy.json       npm run kaykit:palette
  .cache/kaykit/scratch/props/current.json the game's current sprites, for the before/after sheets (written by npx tsx
                                           .cache/kaykit/scratch/props/export-current.ts; optional, sheets skip it when absent)
Outputs: .cache/kaykit/library/parts/props-16.json and props-32.json (the part format check-part.mjs validates), and contact
sheets and per-recipe debug shots under .cache/kaykit/scratch/props/ (sheet-16@4x.png, sheet-32@2x.png, compare-*.png, peek/).
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.getcwd()
K = os.path.join(ROOT, ".cache", "kaykit")
PALETTE_JSON = os.path.join(K, "palette-fantasy.json")
TARGETS_JSON = os.path.join(K, "library", "targets.json")
CURRENT_JSON = os.path.join(K, "scratch", "props", "current.json")
PARTS = os.path.join(K, "library", "parts")
SCRATCH = os.path.join(K, "scratch", "props")
PEEK = os.path.join(SCRATCH, "peek")
TMP_PNG = os.path.join(SCRATCH, f"render_{os.getpid()}.png")

PACK_DIRS = {
    "dungeon": os.path.join(K, "dungeon"),
    "hex": os.path.join(K, "scratch", "env", "hexagon"),
    "furn": os.path.join(K, "furniture"),
    "hallo": os.path.join(K, "halloween"),
    "proto": os.path.join(K, "prototype"),
}
PACK_HOW = {
    "dungeon": "git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0.git .cache/kaykit/dungeon",
    "hex": "git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0.git .cache/kaykit/scratch/env/hexagon",
    "furn": "git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0.git .cache/kaykit/furniture",
    "hallo": "git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0.git .cache/kaykit/halloween",
    "proto": "git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Prototype-Bits-1.0.git .cache/kaykit/prototype",
}

TRANSPARENT = 255
RENDERS = [0]
UNITS_PER_TILE = 2.0       # one game tile is 2 world units (the pack's grid): ppu = tile pixels / 2
USABLE = 48

# ---------------------------------------------------------------------------
# Tunables (the conversion; the values of env_probe.py's prop path)
# ---------------------------------------------------------------------------
SS = 8                      # supersample per output pixel
LIGHT = np.array([-0.45, 0.60, 0.66], np.float32)   # camera space, upper left and toward the viewer, same as the characters
LIGHT /= np.linalg.norm(LIGHT)
LEVEL_K = 3.0               # ramp steps per unit of light, around a flat face
LAM_FLAT = 0.665            # n.L of a face that looks straight at the camera
FLAT_COS = 0.93             # a sub-pixel whose normal is within ~21 degrees of a reference face counts as flat
EDGE_MIN = 0.10
EDGE_SOLID = 0.45
GRADIENT_K = 1.0            # weight of the atlas's baked top-to-bottom gradient (Kay's cheap ambient occlusion)
COVER_T = 0.40              # silhouette: block coverage needed to be solid
CELL_W, CELL_H = 128, 256   # every KayKit atlas: 8 x 4 swatches, gradient top to bottom
GRADIENT_SAMPLE = 0.38

# Ramps are six steps, dark to light, as palette indices (0..47 only). A flat lit face lands on step 3.
RAMPS = {
    "stone": [0, 24, 25, 26, 27, 27],        # the game's ROCK ramp
    "dark": [0, 0, 6, 24, 25, 26],           # iron, near black swatches
    "wood": [1, 45, 35, 37, 2, 44],          # WOOD_DEEP .. WOOD_LIGHT
    "ember": [10, 43, 15, 42, 46, 5],        # flame
    "gold": [1, 28, 35, 13, 46, 5],
    "grass": [9, 16, 17, 18, 19, 19],        # the game's GRASS ramp
    "water": [12, 20, 21, 22, 23, 23],
    "earth": [1, 28, 29, 30, 31, 31],
    # ramps this maker adds for materials the dungeon atlas does not have
    "plaster": [1, 29, 34, 3, 4, 5],         # limewash, cloth: warm cream
    "roof": [10, 10, 43, 43, 15, 42],        # red clay tiles: a deep red face, ember edges, an ember light glint
    "thatch": [28, 29, 31, 3, 4, 5],         # straw, sand: earth shade up to cream
    "leaf": [9, 16, 39, 38, 11, 11],         # broadleaf foliage
    "bark": [0, 1, 45, 35, 2, 2],            # trunks, dark wood
    "iron": [0, 6, 7, 33, 32, 8],            # steel: blue-grey
    "cloth_blue": [7, 33, 41, 32, 40, 14],
}
BASE_OF = {"plaster": 3.7, "cloth_blue": 3.6, "thatch": 3.4}    # where a flat lit face of the ramp sits (default 3.0)
OUTLINE_OF = {"stone": 0, "dark": 0, "wood": 1, "ember": 10, "gold": 1, "grass": 9, "water": 12, "earth": 1, "plaster": 1, "roof": 10,
              "thatch": 1, "leaf": 9, "bark": 0, "iron": 0, "cloth_blue": 7}


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
    print("[props]", *a, flush=True)


def require(path, how):
    if not os.path.exists(path):
        raise SystemExit(f"lib_props: missing {path}\n  {how}")


def srgb_to_lab(rgb01):
    rgb01 = np.asarray(rgb01, dtype=np.float64)
    c = np.where(rgb01 <= 0.04045, rgb01 / 12.92, ((rgb01 + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    return np.stack([116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])], -1)


def hsv(rgb255):
    r, g, b = [c / 255.0 for c in rgb255]
    mx, mn = max(r, g, b), min(r, g, b)
    sat = 0.0 if mx <= 0 else (mx - mn) / mx
    if mx == mn:
        hue = 0.0
    elif mx == r:
        hue = (60 * ((g - b) / (mx - mn))) % 360
    elif mx == g:
        hue = 60 * ((b - r) / (mx - mn)) + 120
    else:
        hue = 60 * ((r - g) / (mx - mn)) + 240
    return hue, sat, mx


def classify(rgb255):
    """Swatch colour -> material class (env_probe.py's rule, plus the classes the dungeon atlas lacks: limewash and cloth when a
    light low-saturation swatch is not stone, clay roof for a desaturated red, foliage for green, steel for blue-grey)."""
    hue, sat, v = hsv(rgb255)
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


# ---------------------------------------------------------------------------
# Packs: one atlas and one shared material each, every model a list of parts
# ---------------------------------------------------------------------------

class Part:
    def __init__(self, name, mesh, matrix):
        self.name, self.mesh, self.matrix = name, mesh, matrix


class Pack:
    """One KayKit pack. The first model loaded fixes the pack's shared atlas and material (every pack has exactly one atlas)."""

    def __init__(self, key, pal):
        self.key, self.pal = key, pal
        root = PACK_DIRS[key]
        require(root, PACK_HOW[key])
        self.index = {}
        for dp, _, fn in os.walk(root):
            if "/gltf" not in dp.replace("\\", "/") + "/":
                continue
            for f in fn:
                for ext in (".gltf.glb", ".gltf", ".glb"):
                    if f.endswith(ext):
                        self.index.setdefault(f[: -len(ext)], os.path.join(dp, f))
                        break
        self.parts = {}
        self.mat = self.img = self.node = self.flat_img = None
        self.mat_rgb = self.mat_key = self.mat_class = self.mat_ramp = self.mat_outline = self.mat_base = self.mat_weight = None
        self.bounds = {}

    def load(self, name):
        if name in self.parts:
            return self.parts[name]
        if name not in self.index:
            raise KeyError(f"{self.key}: no model {name}")
        b_o, b_m, b_i = set(bpy.data.objects), set(bpy.data.materials), set(bpy.data.images)
        bpy.ops.import_scene.gltf(filepath=self.index[name])
        new = [o for o in bpy.data.objects if o not in b_o]
        parts = [Part(o.name, o.data, o.matrix_world.copy()) for o in new if o.type == "MESH"]
        new_mats = [m for m in bpy.data.materials if m not in b_m]
        first = self.mat is None
        if first:
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
        if first:
            self.prepare_materials()
        return parts

    def prepare_materials(self):
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
        self.flat_img = bpy.data.images.new(f"{self.key}_flat", w, h, alpha=True)
        self.flat_img.pixels.foreach_set(out[::-1].ravel())
        self.flat_img.update()
        uniq = np.unique(np.array(cols, np.int32), axis=0)
        self.mat_rgb = uniq
        self.mat_key = (uniq[:, 0] << 16) | (uniq[:, 1] << 8) | uniq[:, 2]
        self.set_ramps(None)

    def set_ramps(self, rule):
        """(Re)build the per-swatch class, ramp, outline and base level. `rule(rgb, cls)` may return a ramp name (a key of RAMPS) to
        override a swatch; None keeps the automatic choice."""
        classes, ramps, outl, base, weight = [], [], [], [], []
        lum = np.array([0.30, 0.59, 0.11])
        for c in self.mat_rgb:
            cls = classify(c)
            L = float((c / 255.0) @ lum)
            forced = rule(tuple(int(v) for v in c), cls) if rule else None
            if forced:
                classes.append(forced)
                ramps.append(RAMPS[forced])
                outl.append(OUTLINE_OF[forced])
                base.append(base_level(forced, L) if forced in ("stone", "wood", "dark", "gold") else BASE_OF.get(forced, 3.0))
            elif cls:
                classes.append(cls)
                ramps.append(RAMPS[cls])
                outl.append(OUTLINE_OF[cls])
                base.append(base_level(cls, L))
            else:
                r = auto_ramp(c, self.pal.lab)
                classes.append("auto")
                ramps.append(r)
                outl.append(r[0])
                base.append(3.0)
            weight.append(1.5 if L < 0.12 else 1.0)
        self.mat_class = classes
        self.mat_ramp = np.array(ramps, np.uint8)
        self.mat_outline = np.array(outl, np.uint8)
        self.mat_base = np.array(base, np.float32)
        self.mat_weight = np.array(weight, np.float32)

    def swap(self, which):
        self.node.image = self.flat_img if which == "flat" else self.img


# ---------------------------------------------------------------------------
# Scene: placements, camera, passes
# ---------------------------------------------------------------------------
UP = (0.0, 0.0, 1.0)
FRONT = (0.0, -1.0, 0.0)
AXES = [UP, FRONT, (1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]


class Stage:
    def __init__(self, pal):
        self.pal = pal
        self.pack = None
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
        data = bpy.data.cameras.new("PropCam")
        data.type = "ORTHO"
        data.sensor_fit = "HORIZONTAL"
        data.clip_start = 0.01
        data.clip_end = 400.0
        self.cam = bpy.data.objects.new("PropCam", data)
        s.collection.objects.link(self.cam)
        s.camera = self.cam
        self.objs = []
        self.render_count = 0
        self.matcap = self._make_matcap()
        self.basis = None
        self.ppu = 8.0
        self.cam_pitch = 30.0

    def _make_matcap(self):
        n = 256
        yy, xx = np.mgrid[0:n, 0:n]
        x = (xx + 0.5) / n * 2 - 1
        y = 1 - (yy + 0.5) / n * 2
        z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
        img = np.zeros((n, n, 4), np.float32)
        img[..., 0], img[..., 1], img[..., 2], img[..., 3] = x * 0.5 + 0.5, y * 0.5 + 0.5, z * 0.5 + 0.5, 1
        im = bpy.data.images.new("prop_matcap", n, n, alpha=True)
        im.pixels.foreach_set(img[::-1].ravel())
        path = os.path.join(SCRATCH, "matcap_nrm.png")
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
        bpy.data.images.remove(im)
        return bpy.context.preferences.studio_lights.load(path, "MATCAP").name

    def use(self, pack):
        self.pack = pack

    def clear(self):
        for o in self.objs:
            bpy.data.objects.remove(o, do_unlink=True)
        self.objs = []

    def place(self, name, loc=(0, 0, 0), rotz=0.0, scale=(1, 1, 1), skip=(), only=None, rot=None):
        """Place a model of the current pack. `rot` (degrees, about x, y, z applied in that order after scale) is for the odd piece
        that needs tipping; `rotz` turns about z. `skip` and `only` select meshes of the model by name."""
        if not isinstance(scale, (tuple, list)):
            scale = (scale,) * 3
        # scale is along the WORLD axes (applied after the turn), so a fit that stretches x stretches what the camera sees as x
        m = Matrix.Translation(loc) @ Matrix.Diagonal((*scale, 1.0)) @ Matrix.Rotation(math.radians(rotz), 4, "Z")
        if rot:
            m = m @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
        out = []
        for p in self.pack.load(name):
            if p.name in skip or (only is not None and p.name not in only):
                continue
            o = bpy.data.objects.new(p.name, p.mesh)
            self.scene.collection.objects.link(o)
            o.matrix_world = m @ p.matrix
            self.objs.append(o)
            out.append(o)
        return out

    def place_part(self, name, part, loc=(0, 0, 0), rotz=0.0, scale=(1, 1, 1), pivot=(0, 0, 0), rot=None):
        """Place ONE mesh of a model with an extra rotation about `pivot` (model space), for a chest lid or a door leaf."""
        if not isinstance(scale, (tuple, list)):
            scale = (scale,) * 3
        base = Matrix.Translation(loc) @ Matrix.Diagonal((*scale, 1.0)) @ Matrix.Rotation(math.radians(rotz), 4, "Z")
        piv = Vector(pivot)
        r = Matrix.Identity(4)
        if rot:
            r = Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
        about = Matrix.Translation(piv) @ r @ Matrix.Translation(-piv)
        for p in self.pack.load(name):
            if p.name != part:
                continue
            o = bpy.data.objects.new(p.name, p.mesh)
            self.scene.collection.objects.link(o)
            o.matrix_world = base @ about @ p.matrix
            self.objs.append(o)

    def aim(self, pitch, anchor, anchor_px, w, h, ppu, yaw=0.0):
        """Orthographic camera looking down `pitch` degrees below the horizon, turned `yaw` about z (0 looks toward +y, screen right
        is +x, screen up at pitch 90 is +y). The world point `anchor` lands on pixel (ax, ay) of a w x h image at `ppu` pixels per
        world unit."""
        p, yv = math.radians(pitch), math.radians(yaw)
        rz = Matrix.Rotation(yv, 3, "Z")
        r = rz @ Vector((1, 0, 0))
        u = rz @ Vector((0, math.sin(p), math.cos(p)))
        f = rz @ Vector((0, math.cos(p), -math.sin(p)))
        a = Vector(anchor) * 1.0
        ax, ay = anchor_px
        dx, dy = (ax - w / 2.0) / ppu, (h / 2.0 - ay) / ppu
        centre = a - r * dx - u * dy
        self.cam.rotation_euler = (math.radians(90.0 - pitch), 0.0, yv)
        self.cam.location = centre - f * 60.0
        self.cam.data.ortho_scale = w / ppu
        self.basis = (np.array(r, np.float32), np.array(u, np.float32), np.array(f, np.float32))
        self.anchor, self.anchor_px, self.ppu = np.array(anchor, np.float32), anchor_px, ppu

    def project(self, p):
        """World point -> (x, y) pixel of the last aim (float, pixel edges at integers)."""
        r, u, _ = self.basis
        d = np.array(p, np.float32) - self.anchor
        return self.anchor_px[0] + float(d @ r) * self.ppu, self.anchor_px[1] - float(d @ u) * self.ppu

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
        self.pack.swap("flat")
        alb = self._render(w * ss, h * ss)
        self.pack.swap("orig")
        org = self._render(w * ss, h * ss)
        sh.light, sh.studio_light, sh.color_type, sh.single_color = "MATCAP", self.matcap, "SINGLE", (1.0, 1.0, 1.0)
        nrm = self._render(w * ss, h * ss)
        return alb, org, nrm

    def raw(self, w, h, ss=2):
        """The textured, unlit, unquantised render (for looking at a model)."""
        sh = self.scene.display.shading
        sh.light, sh.color_type = "FLAT", "TEXTURE"
        self.pack.swap("orig")
        return self._render(w * ss, h * ss)

    # -- conversion ----------------------------------------------------------
    def quantise(self, ps, h, w, refs, ss=SS, bias=0.0, light=None, lam_ref=None, level_k=None, lines=True, hole_fill=True,
                 outline=True, tile_void=None):
        """(alb, org, nrm) at ss x -> uint8 (h, w) palette indices, 255 transparent. This is env_probe.py's prop path."""
        alb, org, nrm = ps
        pk = self.pack
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
                hit = np.nonzero(pk.mat_key == k)[0]
                lut[i] = hit[0] if len(hit) else int(((pk.mat_rgb - np.array([(k >> 16) & 255, (k >> 8) & 255, k & 255])) ** 2).sum(1).argmin())
        mat = lut[inv].reshape(opaque.shape)

        cover = block_sum(opaque.astype(np.float32), h, w, ss) / float(ss * ss)
        present = [int(m) for m in np.unique(mat) if m >= 0]
        if not present:
            return np.full((h, w), TRANSPARENT if tile_void is None else tile_void, np.uint8)
        cnt = np.zeros((len(present), h, w), np.float32)
        fcnt, lf, ls = cnt.copy(), cnt.copy(), cnt.copy()
        for j, m in enumerate(present):
            msk = mat == m
            fm = msk & flat
            cnt[j] = block_sum(msk.astype(np.float32), h, w, ss)
            fcnt[j] = block_sum(fm.astype(np.float32), h, w, ss)
            lf[j] = block_sum(np.where(fm, lam, 0.0).astype(np.float32), h, w, ss)
            ls[j] = block_sum(np.where(msk & ~flat, lam, 0.0).astype(np.float32), h, w, ss)
        wts = pk.mat_weight[present][:, None, None]
        win = (cnt * wts).argmax(0)
        pick = lambda a: np.take_along_axis(a, win[None], 0)[0]
        c, fc, lfw, lsw = pick(cnt), pick(fcnt), pick(lf), pick(ls)
        sc = c - fc
        sf = sc / np.maximum(c, 1.0)
        up, dn, lf_, rt = shift(sf, -1, 0, 0.0), shift(sf, 1, 0, 0.0), shift(sf, 0, -1, 0.0), shift(sf, 0, 1, 0.0)
        ridge = ((sf > lf_) & (sf >= rt)) | ((sf > up) & (sf >= dn))
        edge = (c > 0) & ((sf >= EDGE_SOLID) | ((sf >= EDGE_MIN) & ridge)) & lines
        lam_b = np.where(edge, lsw / np.maximum(sc, 1.0), lfw / np.maximum(fc, 1.0))
        ref = LAM_FLAT if lam_ref is None else lam_ref
        lam_b = np.where(c > 0, lam_b, ref)
        mat_id = np.asarray(present, np.int32)[win]
        base = pk.mat_base[mat_id]
        level = np.clip(np.rint(base + bias + (LEVEL_K if level_k is None else level_k) * (lam_b - ref)), 0, 5).astype(np.int32)
        solid = cover >= COVER_T
        mat_id = np.where(solid, mat_id, -1)
        if tile_void is not None:
            level = cleanup_tile(level, edge)
            out = np.full((h, w), tile_void, np.uint8)
            out[solid] = pk.mat_ramp[mat_id[solid], level[solid]]
            return out
        solid, mat_id, level = cleanup_prop(solid, mat_id, level, present, hole_fill)
        out = np.full((h, w), TRANSPARENT, np.uint8)
        out[solid] = pk.mat_ramp[mat_id[solid], level[solid]]
        if outline:
            nb = np.zeros_like(solid)
            src = np.full(solid.shape, -1, np.int32)
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ss_ = shift(solid, dy, dx, False)
                sm = shift(mat_id, dy, dx, -1)
                take = ss_ & ~solid & ~nb
                src[take] = sm[take]
                nb |= ss_ & ~solid
            out[nb] = pk.mat_outline[src[nb]]
        return out


def cleanup_tile(level, edge):
    """A flat pixel whose four neighbours all agree on another step takes it (speckle); line pixels are left alone."""
    four = ((-1, 0), (1, 0), (0, -1), (0, 1))
    nb = [shift(level, dy, dx, -1) for dy, dx in four]
    for target in range(6):
        votes = sum((x == target).astype(np.int32) for x in nb)
        flip = (~edge) & (votes >= 3) & (level != target)
        level = np.where(flip, target, level)
    return level


def cleanup_prop(solid, mat_id, level, present, hole_fill=True):
    four = ((-1, 0), (1, 0), (0, -1), (0, 1))
    if hole_fill:
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
# Canvas operations on (h, w) uint8 arrays, 255 transparent
# ---------------------------------------------------------------------------

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


def outline_around(img, mask, colour):
    """Paint `colour` on the clear cells 4-adjacent to `mask` (used for drawn overlays such as the torch flame)."""
    ring = np.zeros_like(mask)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        ring |= shift(mask, dy, dx, False)
    img[ring & ~mask & (img == TRANSPARENT)] = colour


def bbox(a):
    ys, xs = np.nonzero(a != TRANSPARENT)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def shifted(a, dx):
    """Shift sideways, padding with transparent; refuses to clip art."""
    out = np.full_like(a, TRANSPARENT)
    w = a.shape[1]
    if dx >= 0:
        assert not (a[:, w - dx:] != TRANSPARENT).any() if dx else True, "shifting would clip the art"
        out[:, dx:] = a[:, :w - dx]
    else:
        assert not (a[:, :-dx] != TRANSPARENT).any(), "shifting would clip the art"
        out[:, :dx] = a[:, -dx:]
    return out


# ---------------------------------------------------------------------------
# The shot: one model (or a few) through the 30 degree camera into a w x h canvas
# ---------------------------------------------------------------------------

class Shot:
    """Everything a recipe needs: the stage, the tile size T, the scale ppu = T / 2 pixels per world unit."""

    def __init__(self, stage, T):
        self.st, self.T = stage, T
        self.ppu = T / UNITS_PER_TILE
        self.k = T // 16

    def render(self, pack, placements, w, h, anchor, anchor_px, pitch=30.0, yaw=0.0, refs=AXES, ss=None, clean=True, **qkw):
        """placements: dicts for Stage.place. The world point `anchor` lands on canvas pixel `anchor_px` ((x, y), floats)."""
        st = self.st
        st.use(pack)
        st.clear()
        for pl in placements:
            pl = dict(pl)
            if "part" in pl:
                st.place_part(**pl)
            else:
                st.place(**pl)
        st.aim(pitch, anchor, anchor_px, w, h, self.ppu, yaw)
        ss = ss or (SS if w * h <= 1200 * self.k * self.k else 6)
        img = st.quantise(st.passes(w, h, ss), h, w, refs, ss=ss, **qkw)
        return despeckle(img) if clean else img

    def extent(self, pack, name):
        pack.load(name)
        return pack.bounds[name]


    def extents(self, pack, placements, pitch, yaw=0.0):
        """Screen extents (world units, at the placements' own scales) of a list of placements seen from `pitch`: (xmin, xmax, umin,
        umax), x to the right and u up the screen. Looks at every vertex, so it is exact."""
        st = self.st
        st.use(pack)
        st.clear()
        for pl in placements:
            pl = dict(pl)
            if "part" in pl:
                st.place_part(**pl)
            else:
                st.place(**pl)
        p, yv = math.radians(pitch), math.radians(yaw)
        rz = Matrix.Rotation(yv, 3, "Z")
        r = np.array(rz @ Vector((1, 0, 0)), np.float64)
        u = np.array(rz @ Vector((0, math.sin(p), math.cos(p))), np.float64)
        xs, us = [], []
        for o in st.objs:
            n = len(o.data.vertices)
            co = np.empty(n * 3, np.float32)
            o.data.vertices.foreach_get("co", co)
            co = co.reshape(n, 3).astype(np.float64)
            m = np.array(o.matrix_world, np.float64)
            w = co @ m[:3, :3].T + m[:3, 3]
            xs.append(w @ r)
            us.append(w @ u)
        st.clear()
        xs, us = np.concatenate(xs), np.concatenate(us)
        return float(xs.min()), float(xs.max()), float(us.min()), float(us.max())

    def fit(self, pack, placements, w, h, box, pitch=30.0, mode="uniform", valign="bottom", halign="centre", refs=AXES, scale_out=None,
            **qkw):
        """Scale the placements so the object's silhouette fills `box` = (x0, y0, x1, y1) in 16 px units (scaled by this size's k), then
        render it. mode: "uniform" keeps the model's proportions and fits inside the box; "stretch" stretches x to the box width and
        y and z together to the box height (the model's own y : z ratio is kept); "width" fits the width and lets the height fall
        where it falls. valign / halign say where a uniform fit that does not fill the box sits in it."""
        k = self.k
        x0, y0, x1, y1 = [v * k for v in box]
        ext = self.extents(pack, placements, pitch)
        W0, H0 = ext[1] - ext[0], ext[3] - ext[2]
        wt, ht = (x1 - x0) / self.ppu, (y1 - y0) / self.ppu
        if mode == "stretch":
            fx, fyz = wt / W0, ht / H0
        elif mode == "width":
            fx = fyz = wt / W0
        else:
            fx = fyz = min(wt / W0, ht / H0)
        if scale_out is not None:
            scale_out.update(fx=fx, fyz=fyz)
        scaled = []
        for pl in placements:
            pl = dict(pl)
            sc = pl.get("scale", (1, 1, 1))
            if not isinstance(sc, (tuple, list)):
                sc = (sc,) * 3
            pl["scale"] = (sc[0] * fx, sc[1] * fyz, sc[2] * fyz)
            lc = pl.get("loc", (0, 0, 0))
            pl["loc"] = (lc[0] * fx, lc[1] * fyz, lc[2] * fyz)
            scaled.append(pl)
        xmin, xmax, umin, umax = ext[0] * fx, ext[1] * fx, ext[2] * fyz, ext[3] * fyz
        bw, bh = (xmax - xmin) * self.ppu, (umax - umin) * self.ppu
        cx = {"centre": (x0 + x1) / 2.0, "left": x0 + bw / 2.0, "right": x1 - bw / 2.0}[halign]
        ax = cx - (xmin + xmax) / 2.0 * self.ppu
        if valign == "bottom":
            ay = y1 + umin * self.ppu
        elif valign == "top":
            ay = y0 + umax * self.ppu
        else:
            ay = (y0 + y1) / 2.0 + (umin + umax) / 2.0 * self.ppu
        return self.render(pack, scaled, w, h, (0, 0, 0), (ax, ay), pitch=pitch, refs=refs, **qkw)


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
    "_": "000000000000111", " ": "000000000000000",
}


def draw_text(rgba, text, x, y, color=(235, 235, 235)):
    for i, ch in enumerate(text.upper()):
        g = _G.get(ch, _G[" "])
        for k, bit in enumerate(g):
            if bit == "1":
                gy, gx = divmod(k, 3)
                px, py = x + i * 4 + gx, y + gy
                if 0 <= py < rgba.shape[0] and 0 <= px < rgba.shape[1]:
                    rgba[py, px, :3] = color
                    rgba[py, px, 3] = 255


# ---------------------------------------------------------------------------
# Small drawn helpers: a flame (the packs' rendered flames are about 3 px, so the torch gets a drawn one)
# ---------------------------------------------------------------------------
FLAME_RAMP = [43, 15, 42, 46, 5]      # ember deep, ember, ember light, cream shade, cream


def flame(T, width, height):
    """A teardrop flame, tip up, (height, width) uint8 with 255 outside. Sizes are in 16 px units (scaled by T / 16). From the rim in:
    EMBER, EMBER LIGHT, then a cream core in the lower half; the tip stays orange. The caller adds the outline."""
    k = T // 16
    w, h = int(round(width * k)), int(round(height * k))
    out = np.full((h, w), TRANSPARENT, np.uint8)
    yy, xx = np.mgrid[0:h, 0:w]
    v = (yy + 0.5) / h                       # 0 tip .. 1 base
    u = ((xx + 0.5) - w / 2.0) / (w / 2.0)   # -1 .. 1
    half = np.power(v, 0.75) * np.sqrt(np.clip(1.0 - np.power(np.clip(v * 1.04 - 0.04, 0, 1), 6), 0, 1))
    inside = np.abs(u) <= half + 1e-6
    t = np.abs(u) / np.maximum(half, 1e-3)
    lvl = np.where(t > 0.78, 1, np.where(t > 0.42, 2, np.where(v > 0.42, 4, 3)))
    lvl = np.where((v < 0.22) | (v > 0.9), np.minimum(lvl, 1 + (t <= 0.42)), lvl)
    for i, c in enumerate(FLAME_RAMP):
        out[inside & (lvl == i)] = c
    return out


# ---------------------------------------------------------------------------
# Shared rules and model helpers
# ---------------------------------------------------------------------------

def part_bounds(pack, name, part):
    mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for p in pack.load(name):
        if p.name != part:
            continue
        for c in p.mesh.vertices:
            w = p.matrix @ c.co
            mn = Vector((min(mn[i], w[i]) for i in range(3)))
            mx = Vector((max(mx[i], w[i]) for i in range(3)))
    return mn, mx


def solid_ramp(name):
    """A ramp rule that sends every swatch of a pack to one ramp (the prototype pack's blocks are yellow and blue placeholders)."""
    return lambda rgb, cls: name


def bits_rule(rgb, cls):
    """The non-dungeon packs (Medieval Hexagon, Furniture Bits, Halloween Bits) have materials the dungeon atlas does not: whitewash
    and linen, blue cloth, orange roof tiles, red cloth and clay. The dungeon pack keeps the approved classifier unchanged."""
    hue, sat, v = hsv(rgb)
    if sat < 0.14 and v > 0.80:
        return "plaster"
    if 18 <= hue <= 46 and sat > 0.52 and v > 0.88:
        return "ember"                     # orange tile and flame
    if (hue < 12 or hue > 340) and sat > 0.35 and v < 0.92:
        return "roof"
    if 190 <= hue <= 250 and sat > 0.40 and v > 0.60:
        return "cloth_blue"
    return None


# ---------------------------------------------------------------------------
# Recipes. Each takes the shot context S (S.T, S.k, S.render) and the packs, and returns {assetId: (h, w) uint8 array}.
# Coordinates are in 16 px units times S.k, so the 16 and 32 px runs share all geometry.
# ---------------------------------------------------------------------------
RECIPES = {}


def recipe(name, ids):
    def deco(fn):
        RECIPES[name] = (fn, ids)
        return fn
    return deco


def tiles_of(img, cols, rows, T, names):
    """Slice a (rows*T, cols*T) canvas, row-major, into {name: (T, T)}; names may skip with None."""
    out = {}
    for i, n in enumerate(names):
        if n is None:
            continue
        r, c = divmod(i, cols)
        out[n] = img[r * T:(r + 1) * T, c * T:(c + 1) * T].copy()
    return out


@recipe("tree", ["tree", "tree_left", "tree_right"])
def r_tree(S, P):
    """Medieval Hexagon tree_single_B, fitted to the cell: a rounded conifer. The offsets are the same art shifted by 2 px (fantasy.ts)."""
    k, T = S.k, S.T
    img = S.fit(P["hex"], [dict(name="tree_single_B")], T, T, (2, 1, 14, 15))
    return {"tree": img, "tree_left": shifted(img, -2 * k), "tree_right": shifted(img, 2 * k)}


@recipe("torch", ["torch", "torch_left", "torch_right"])
def r_torch(S, P):
    """Dungeon torch_mounted (no flame in the model) with a drawn flame; the offsets are the same art shifted by 3 px (fantasy.ts)."""
    k, T = S.k, S.T
    img = S.fit(P["dungeon"], [dict(name="torch_mounted")], T, T, (5, 7, 11, 15), bias=float(S.opts.get("torch_bias", 1.0)))
    fl = flame(T, 5, 6)
    fx, fy = int(round(8 * k - fl.shape[1] / 2.0)), int(round(8 * k - fl.shape[0]))
    layer = np.full_like(img, TRANSPARENT)
    blit(layer, fl, fx, fy)
    outline_around(img, layer != TRANSPARENT, 43)
    blit(img, layer, 0, 0)
    return {"torch": img, "torch_left": shifted(img, -3 * k), "torch_right": shifted(img, 3 * k)}


@recipe("chest", ["chest", "chest_open"])
def r_chest(S, P):
    """Dungeon chest: body and lid are two meshes, so the open chest is the lid turned about its back hinge, with a stack of the pack's
    coins standing in the hollow body."""
    k, T = S.k, S.T
    dp = P["dungeon"]
    closed = S.fit(dp, [dict(name="chest")], T, T, (2, 4, 14, 15), mode="stretch")
    pivot = (0, 0.66, 0.55)
    ang = float(S.opts.get("chest_ang", 140))
    dp.set_ramps(lambda rgb, cls: "gold" if (36 <= hsv(rgb)[0] <= 52 and hsv(rgb)[1] > 0.5 and hsv(rgb)[2] > 0.85) else None)
    open_pl = [dict(name="chest", skip=("chest_lid",)),
               dict(name="coin_stack_medium", loc=(0, 0.02, 0.2), scale=1.15),
               dict(name="chest", part="chest_lid", pivot=pivot, rot=(-ang, 0, 0))]
    opened = S.fit(dp, open_pl, T, T, (2, 1, 14, 15))
    dp.set_ramps(None)
    return {"chest": closed, "chest_open": opened}


@recipe("door", ["door_closed", "door_open"])
def r_door(S, P):
    """wall_doorway seen from the front, squashed to one tile row (the approved door1 of env_probe.py): the leaf in its arch. Open: the
    same doorway with the leaf swung back, the room beyond dark."""
    k, T = S.k, S.T
    dp = P["dungeon"]
    anchor, at = (0, 0, 1.0), (T / 2.0, T / 2.0)
    kw = dict(pitch=0.0, refs=(FRONT,), bias=-0.5, tile_void=6)
    closed = S.render(dp, [dict(name="wall_doorway", scale=(1, 1, 0.5))], T, T, anchor, at, **kw)
    lmn, lmx = part_bounds(dp, "wall_doorway", "wall_doorway_door")
    pivot = (lmn.x, 0.0, 0)
    ang = float(S.opts.get("door_ang", 75))
    opened = S.render(dp, [dict(name="wall_doorway", scale=(1, 1, 0.5), skip=("wall_doorway_door",)),
                           dict(name="wall_doorway", part="wall_doorway_door", scale=(1, float(S.opts.get("door_thick", 0.5)), 0.5), pivot=pivot,
                                rot=(0, 0, ang))],
                      T, T, anchor, at, **kw)
    return {"door_closed": closed, "door_open": opened}


def door_plank(pack, limit=0.12):
    """A copy of the doorway's door mesh with everything that stands proud of the plank taken off: every face with a vertex more than `limit`
    from the leaf's mid plane (the crossbars, the hinge straps and the ring pull, which together are 0.5 to 0.78 thick against the plank's 0.2).
    Seen from straight above those make a ladder of wide bars across the leaf; the plank alone is the leaf the game's side-on door needs.
    Registered on the pack as the model "door_plank_ns" (one part, "door_plank") so Stage.place_part can place it."""
    import bmesh
    src = [q for q in pack.load("wall_doorway") if q.name == "wall_doorway_door"][0]
    mesh = src.mesh.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bad = [f for f in bm.faces if any(abs((src.matrix @ v.co).y) > limit for v in f.verts)]
    bmesh.ops.delete(bm, geom=bad, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    pack.parts["door_plank_ns"] = [Part("door_plank", mesh, src.matrix.copy())]
    pack.bounds["door_plank_ns"] = pack.bounds["wall_doorway"]


@recipe("door_ns", ["door_closed_ns", "door_open_ns"])
def r_door_ns(S, P):
    """The side-on leaves of a door in a north-south wall (render/wallProfiles.ts: render-only, drawn over the wall set's own jamb overlay,
    which the ground makers draw, because this part is shared by both ground styles). The leaf ALONE, seen from straight above: only the
    doorway's door mesh (wall_doorway_door: no wall, no frame, no stubs, which is what the cutaway probe in the door investigation drew to
    judge the shape), reduced to its plank (door_plank) and turned 90 degrees so its length runs north-south. The model is 2 units long and
    its plank 0.2 thick, and one pixel is 1/8 unit at 16 px, so the placement is scaled in WORLD axes straight to the pixel shapes the game
    draws: no fit.

    Closed: the bar spans the gap from jamb to jamb, the sprite (outline included) filling rows 2..13 and columns 5..10, centred on the tile.
    Open: the leaf swung 90 degrees on its hinge at the SOUTH end (the pivot is part_bounds' lmn.x, the door's own hinge edge) so it points
    east and folds against the south jamb, the sprite filling rows 9..12 and columns 6..14 (one pixel short of the 16 the owner's brief allows,
    so check-part's rule that the outer column bands stay clear holds). Both stay inside their own tile, which the probe's leaf did not: in a
    one tile canvas that clips it into the neighbouring cell's edge. The jamb overlay under the leaf carries the outline row the open leaf
    lies against (row 13), so the leaf stops at its own last row of wood.

    Seen from above a plank is plain, so two iron straps and the ring pull are drawn over it (as the torch's flame is), the way the
    hand-drawn leaf has them: straps across the bar, the pull on the east face."""
    k, T = S.k, S.T
    dp = P["dungeon"]
    door_plank(dp)
    lmn, lmx = part_bounds(dp, "wall_doorway", "wall_doorway_door")
    plank = float(S.opts.get("door_ns_t", 0.2))             # the plank's thickness in model units
    base = dict(name="door_plank_ns", part="door_plank", rotz=90.0)
    ppu = S.ppu
    iron, gold = 32, 13                                     # STEEL_SHADE and GOLD, the hand-drawn straps and pull
    # closed: the silhouette is (12k - 2) rows long and (6k - 2) columns wide, so the sprite with its one pixel outline fills rows 2..13, columns 5..10
    closed = S.render(dp, [dict(base, scale=((6 * k - 2) / ppu / plank, (12 * k - 2) / ppu / 2.0, 1.0))], T, T, (0, 0, 0), (T / 2.0, T / 2.0), pitch=90.0, refs=AXES)
    for y in (4, 10):
        sel = closed[y * k:(y + 1) * k, 6 * k:10 * k]
        sel[sel != TRANSPARENT] = iron
    closed[7 * k:8 * k, 11 * k:12 * k] = gold
    # open: after the swing world x is the leaf's length. The hinge is at column 6k + 1, the wood runs to column 15k - 2 (7 px at 16) and is 4k - 1 rows
    # thick, ending on row 13k - 1 where the jamb's outline row takes over
    sx = (9 * k - 2) / ppu / 2.0
    sy = (4 * k - 1) / ppu / plank
    ang = float(S.opts.get("door_ns_ang", 90))
    opened = S.render(dp, [dict(base, scale=(sx, sy, 1.0), pivot=(lmn.x, 0.0, 0.0), rot=(0, 0, -ang))], T, T, (0, -sy, 0), (6 * k + 1.0, 11 * k + 0.5),
                      pitch=90.0, refs=AXES)
    opened[13 * k:, :] = TRANSPARENT                        # the south jamb's outline row is the leaf's own bottom edge
    for x in (8, 12):
        sel = opened[10 * k:13 * k, x * k:(x + 1) * k]
        sel[sel != TRANSPARENT] = iron
    opened[12 * k:13 * k, 9 * k:10 * k] = gold
    return {"door_closed_ns": closed, "door_open_ns": opened}


@recipe("cottage", ["cottage_nw", "cottage_n", "cottage_ne", "cottage_w", "cottage_door", "cottage_e", "cottage_sw", "cottage_s", "cottage_se"])
def r_cottage(S, P):
    """Medieval Hexagon building_home_B (timber frame on a stone plinth), one render over the 3 x 3 block, sliced. The house is 40 rows
    tall like the game's cottage (the bottom tile row carries only the plinth), so the doorway lands in the middle tile of the
    middle row."""
    k, T = S.k, S.T
    name = S.opts.get("house", "building_home_B_red")
    h = float(S.opts.get("house_h", 41))
    img = S.fit(P["hex"], [dict(name=name, scale=(1, float(S.opts.get("house_sy", 0.4)), 1))], 3 * T, 3 * T, (1, 1, 47, h),
                pitch=float(S.opts.get("house_pitch", 20)), mode="stretch")
    return tiles_of(img, 3, 3, T, ["cottage_nw", "cottage_n", "cottage_ne", "cottage_w", "cottage_door", "cottage_e", "cottage_sw", "cottage_s", "cottage_se"])


@recipe("arch", ["arch_jamb_w", "arch_passage", "arch_jamb_e"])
def r_arch(S, P):
    k, T = S.k, S.T
    img = S.fit(P["hallo"], [dict(name="arch")], 3 * T, T, (2, 1, 46, 15), mode="stretch", pitch=float(S.opts.get("arch_pitch", 20)),
                bias=float(S.opts.get("arch_bias", 1.3)), level_k=float(S.opts.get("arch_k", 2.0)))
    return tiles_of(img, 3, 1, T, ["arch_jamb_w", "arch_passage", "arch_jamb_e"])


@recipe("stair", ["stair_up_w", "stair_up_e"])
def r_stair(S, P):
    k, T = S.k, S.T
    P["proto"].set_ramps(solid_ramp("stone"))
    img = S.fit(P["proto"], [dict(name="Primitive_Stairs_Half", rotz=float(S.opts.get("stair_rot", 270)))], 2 * T, T, (1, 0, 31, 16),
                pitch=float(S.opts.get("stair_pitch", 50)), mode="stretch", bias=float(S.opts.get("stair_bias", 0.8)),
                level_k=float(S.opts.get("stair_k", 4.0)))
    return tiles_of(img, 2, 1, T, ["stair_up_w", "stair_up_e"])


@recipe("pillar", ["pillar_top", "pillar_base"])
def r_pillar(S, P):
    k, T = S.k, S.T
    img = S.fit(P["dungeon"], [dict(name="pillar")], T, 2 * T, (2, 1, 14, 31), bias=float(S.opts.get("pillar_bias", 1.2)),
                level_k=float(S.opts.get("pillar_k", 2.0)))
    return tiles_of(img, 1, 2, T, ["pillar_top", "pillar_base"])


@recipe("table", ["table_w", "table_e"])
def r_table(S, P):
    k, T = S.k, S.T
    img = S.fit(P["dungeon"], [dict(name="table_long", rotz=90)], 2 * T, T, (2, 2, 30, 15))
    return tiles_of(img, 2, 1, T, ["table_w", "table_e"])


@recipe("bed", ["bed_head", "bed_foot"])
def r_bed(S, P):
    k, T = S.k, S.T
    img = S.fit(P["furn"], [dict(name="bed_single_A")], T, 2 * T, (2, 1, 14, 31), pitch=float(S.opts.get("bed_pitch", 60)), mode="stretch")
    return tiles_of(img, 1, 2, T, ["bed_head", "bed_foot"])


@recipe("fence", ["fence_w", "fence_mid", "fence_e"])
def r_fence(S, P):
    """Posts and rails from the Prototype Bits primitives (wood ramp): a post every tile, two rails between posts. A run of four tiles is
    rendered (cap, middle, middle, cap) and the two middles must be pixel identical so the middle piece repeats."""
    k, T = S.k, S.T
    pk = P["proto"]
    pk.set_ramps(solid_ramp("wood"))
    for n in ("Primitive_Pillar", "Primitive_Beam"):
        pk.load(n)
    pmn, pmx = pk.bounds["Primitive_Pillar"]
    bmn, bmx = pk.bounds["Primitive_Beam"]
    u = 2.0 / 16.0                          # one 16 px pixel in world units
    post_w, post_h = 2.4 * u, 10.5 * u       # 2.4 px wide, tall enough for ~10 rows at this pitch
    pl = []
    cen = lambda mn, mx: ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z)
    for i in range(4):
        x = (7.0 + 16 * i) * u
        c = cen(pmn, pmx)
        sx, sy, sz = post_w / (pmx.x - pmn.x), post_w / (pmx.y - pmn.y), post_h / (pmx.z - pmn.z)
        pl.append(dict(name="Primitive_Pillar", loc=(x - c[0] * sx, -c[1] * sy, 0), scale=(sx, sy, sz)))
    for z0, z1 in ((2.4, 4.6), (6.6, 8.8)):
        x0, x1 = 7.0 * u, (7.0 + 48) * u
        sx = (x1 - x0) / (bmx.x - bmn.x)
        sy = 1.4 * u / (bmx.y - bmn.y)
        sz = (z1 - z0) * u / (bmx.z - bmn.z)
        c = cen(bmn, bmx)
        pl.append(dict(name="Primitive_Beam", loc=(x0 - bmn.x * sx, -c[1] * sy, z0 * u - bmn.z * sz), scale=(sx, sy, sz)))
    img = S.render(pk, pl, 4 * T, T, (0, -0.15, 0), (0, 15 * k))
    a, b = img[:, T:2 * T], img[:, 2 * T:3 * T]
    if not (a == b).all():
        log("fence: the two middle tiles differ in", int((a != b).sum()), "pixels")
    return {"fence_w": img[:, :T].copy(), "fence_mid": a.copy(), "fence_e": img[:, 3 * T:].copy()}


@recipe("well", ["well_nw", "well_ne", "well_sw", "well_se"])
def r_well(S, P):
    k, T = S.k, S.T
    name = S.opts.get("well", "building_well_red")
    sx, sz = float(S.opts.get("well_sx", 1.3)), float(S.opts.get("well_sz", 1.0))
    img = S.fit(P["hex"], [dict(name=name, rotz=float(S.opts.get("well_rot", 90)), scale=(sx, 1, sz))], 2 * T, 2 * T, (2, 1, 30, 29), pitch=float(S.opts.get("well_pitch", 25)),
                bias=float(S.opts.get("well_bias", 0.8)))
    return tiles_of(img, 2, 2, T, ["well_nw", "well_ne", "well_sw", "well_se"])


# ---------------------------------------------------------------------------
# Assembly (for looking at the pieces in their shapes), sheets, the part files
# ---------------------------------------------------------------------------
SHAPES = [   # (label, cols, rows, [ids row-major])
    ("cottage", 3, 3, ["cottage_nw", "cottage_n", "cottage_ne", "cottage_w", "cottage_door", "cottage_e", "cottage_sw", "cottage_s", "cottage_se"]),
    ("arch", 3, 1, ["arch_jamb_w", "arch_passage", "arch_jamb_e"]),
    ("stair", 2, 1, ["stair_up_w", "stair_up_e"]),
    ("pillar", 1, 2, ["pillar_top", "pillar_base"]),
    ("table", 2, 1, ["table_w", "table_e"]),
    ("bed", 1, 2, ["bed_head", "bed_foot"]),
    ("fence", 4, 1, ["fence_w", "fence_mid", "fence_mid", "fence_e"]),
    ("well", 2, 2, ["well_nw", "well_ne", "well_sw", "well_se"]),
    ("door", 2, 1, ["door_closed", "door_open"]),
    ("door_ns", 2, 1, ["door_closed_ns", "door_open_ns"]),
    ("tree", 3, 1, ["tree_left", "tree", "tree_right"]),
    ("torch", 3, 1, ["torch_left", "torch", "torch_right"]),
    ("chest", 2, 1, ["chest", "chest_open"]),
]
BG = {"grass": 18, "stone": 26, "dirt": 30}


def assemble(sprites, cols, rows, ids, T):
    out = np.full((rows * T, cols * T), TRANSPARENT, np.uint8)
    for i, n in enumerate(ids):
        if n is None or n not in sprites:
            continue
        r, c = divmod(i, cols)
        out[r * T:(r + 1) * T, c * T:(c + 1) * T] = sprites[n]
    return out


def shapes_sheet(pal, sprites, T, path, zoom, bgs=("grass", "stone"), grid=False, cur=None, only=None, width=1500):
    """Every shape assembled on a flat ground colour (one per background), label above, flowed left to right. With `cur` (the game's
    current sprites, 16 px, -1 clear) the current shape is drawn first, enlarged to this size, for comparison."""
    k = T // 16
    items = []
    for label, cols, rows, ids in SHAPES:
        if only and label not in only:
            continue
        if not all(n in sprites for n in ids if n):
            continue
        items.append((label, assemble(sprites, cols, rows, ids, T), cols, rows, ids))
    if not items:
        return
    pad = 4
    maxw = max(8, width // zoom)
    views_of = []
    maxw = max(maxw, max(a.shape[1] for _, a, _, _, _ in items) * (len(bgs) + (1 if cur else 0)) + 4 * pad)
    for label, a, cols, rows, ids in items:
        views = []
        if cur:
            curimg = np.full((rows * 16, cols * 16), TRANSPARENT, np.uint8)
            for j, n in enumerate(ids):
                if n and n in cur:
                    rr, cc = divmod(j, cols)
                    arr = np.array(cur[n], np.int32)
                    curimg[rr * 16:(rr + 1) * 16, cc * 16:(cc + 1) * 16] = np.where(arr < 0, TRANSPARENT, arr).astype(np.uint8)
            views.append((np.repeat(np.repeat(curimg, k, 0), k, 1), bgs[0]))
        views += [(a, b) for b in bgs]
        views_of.append((label, a, views))
    # flow
    x = y = pad
    line_h = 0
    place = []
    for label, a, views in views_of:
        ah, aw = a.shape
        wblock = len(views) * (aw + pad)
        if x + wblock > maxw and x > pad:
            x, y, line_h = pad, y + line_h + pad, 0
        place.append((x, y))
        x += wblock + pad
        line_h = max(line_h, ah + 8)
    H = y + line_h + pad
    canvas = np.zeros((H, maxw, 4), np.uint8)
    canvas[..., :3] = (44, 44, 52)
    canvas[..., 3] = 255
    for (label, a, views), (x0, y0) in zip(views_of, place):
        ah, aw = a.shape
        draw_text(canvas, label, x0, y0)
        for j, (v, bgname) in enumerate(views):
            bx = x0 + j * (aw + pad)
            by = y0 + 7
            canvas[by:by + ah, bx:bx + aw, :3] = pal.rgb[BG[bgname]]
            rgba = pal.rgba(v)
            m = rgba[..., 3] > 0
            region = canvas[by:by + ah, bx:bx + aw]
            region[m] = rgba[m]
            if grid and j == len(views) - 1:
                for gx in range(T, aw, T):
                    region[:, gx, :3] = (region[:, gx, :3] * 0.8).astype(np.uint8)
                for gy in range(T, ah, T):
                    region[gy, :, :3] = (region[gy, :, :3] * 0.8).astype(np.uint8)
    if zoom > 1:
        canvas = np.repeat(np.repeat(canvas, zoom, 0), zoom, 1)
    write_png(path, canvas)


def tile_sheet(pal, sprites, order, T, path, zoom, cols=8):
    """Every sprite on its own cell with a gap, in target order."""
    cw = T + 3
    rows = (len(order) + cols - 1) // cols
    canvas = np.zeros((rows * (T + 10) + 2, cols * cw + 2, 4), np.uint8)
    canvas[..., :3] = (60, 60, 70)
    canvas[..., 3] = 255
    for i, n in enumerate(order):
        r, c = divmod(i, cols)
        x0, y0 = 2 + c * cw, 2 + r * (T + 10) + 7
        canvas[y0:y0 + T, x0:x0 + T, :3] = (84, 84, 94)
        if n in sprites:
            rgba = pal.rgba(sprites[n])
            m = rgba[..., 3] > 0
            region = canvas[y0:y0 + T, x0:x0 + T]
            region[m] = rgba[m]
        draw_text(canvas, n[:max(1, (T + 2) // 4)], x0, y0 - 6)
    if zoom > 1:
        canvas = np.repeat(np.repeat(canvas, zoom, 0), zoom, 1)
    write_png(path, canvas)


def despeckle(a, votes=5):
    """A pixel none of whose 8 neighbours share its colour takes the colour most of them share, when at least `votes` of the eight
    agree (an island inside one colour is noise; an island on a boundary between colours is a feature and stays)."""
    out = a.copy()
    sp = speckles(a)
    if not sp.any():
        return out
    ys, xs = np.nonzero(sp)
    h, w = a.shape
    for y, x in zip(ys, xs):
        cnt = {}
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and a[yy, xx] != TRANSPARENT:
                        cnt[int(a[yy, xx])] = cnt.get(int(a[yy, xx]), 0) + 1
        if cnt:
            best = max(cnt, key=cnt.get)
            if cnt[best] >= votes:
                out[y, x] = best
    return out


def speckles(a):
    """Opaque pixels that none of their 8 neighbours share a colour with (a single pixel island inside other colours)."""
    solid = a != TRANSPARENT
    same = np.zeros(a.shape, bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                same |= shift(a, dy, dx, TRANSPARENT) == a
    return solid & ~same


def write_part(path, size, targets, sprites, gaps):
    k = size // 16
    out = {"maker": "props", "size": size, "style": "prop-30deg", "sprites": [], "gaps": gaps}
    for t in targets:
        n = t["assetId"]
        if n not in sprites:
            continue
        a = sprites[n].astype(np.int32)
        assert a.shape == (t["h16"] * k, t["w16"] * k), (n, a.shape)
        a = np.where(a == TRANSPARENT, -1, a)
        out["sprites"].append({"assetId": n, "kind": t["kind"], "name": t["name"], "walkable": t["walkable"], "pixels": a.tolist()})
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))


def load_current_sprites():
    if not os.path.exists(CURRENT_JSON):
        return None
    with open(CURRENT_JSON) as fh:
        return json.load(fh)["sprites"]


def peek(stage, pal, spec):
    """--peek pack:model[:pitch[:yaw]] -> one textured render of a raw model, written to PEEK."""
    parts = spec.split(":")
    key, name = parts[0], parts[1]
    pitch = float(parts[2]) if len(parts) > 2 else 30.0
    yaw = float(parts[3]) if len(parts) > 3 else 0.0
    skip = tuple(parts[4].split("+")) if len(parts) > 4 else ()
    pack = Pack(key, pal)
    pack.load(name)
    mn, mx = pack.bounds[name]
    stage.use(pack)
    stage.clear()
    stage.place(name, skip=skip)
    size = max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z)
    ppu = 330.0 / size
    w = h = 400
    stage.aim(pitch, ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2), (w / 2.0, h / 2.0), w, h, ppu, yaw)
    img = stage.raw(w, h, 1)
    rgba = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    rgba[rgba[..., 3] == 0, :3] = (90, 90, 100)
    rgba[..., 3] = 255
    os.makedirs(PEEK, exist_ok=True)
    path = os.path.join(PEEK, f"{key}-{name}-{int(pitch)}-{int(yaw)}{'-' + parts[4] if skip else ''}.png")
    write_png(path, rgba)
    log("peek", os.path.basename(path), "size", [round(v, 2) for v in (mx - mn)], "min", [round(v, 2) for v in mn])
    stage.clear()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = lambda n, d=None: argv[argv.index(n) + 1] if n in argv else d
    os.makedirs(SCRATCH, exist_ok=True)
    os.makedirs(PARTS, exist_ok=True)
    require(PALETTE_JSON, "npm run kaykit:palette")
    require(TARGETS_JSON, "npx tsx scripts/kaykit/export-targets.ts")
    sizes = [int(x) for x in opt("--sizes", "16,32").split(",")]
    only = opt("--only").split(",") if opt("--only") else None
    t_all = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    pal = Pal()
    stage = Stage(pal)
    if "--peek" in argv:
        for spec in opt("--peek").split(","):
            peek(stage, pal, spec)
        return
    with open(TARGETS_JSON) as fh:
        targets = [t for t in json.load(fh)["targets"] if t["group"] == "prop" and not t.get("outOfPlay")]
    scope = [t["assetId"] for t in targets]
    packs = {key: Pack(key, pal) for key in PACK_DIRS}
    packs["proto"].load("Primitive_Pillar")
    packs["hex"].load("tree_single_A")
    packs["hex"].set_ramps(bits_rule)
    for key in ("furn", "hallo"):
        packs[key].load({"furn": "bed_single_A", "hallo": "arch"}[key])
        packs[key].set_ramps(bits_rule)
    cur = load_current_sprites()
    for T in sizes:
        t0 = time.time()
        S = Shot(stage, T)
        S.opts = dict(kv.split("=") for kv in opt("--set").split(",")) if opt("--set") else {}
        sprites = {}
        for name, (fn, ids) in RECIPES.items():
            if only and not (set(ids) & set(only)) and name not in only:
                continue
            t1 = time.time()
            try:
                got = fn(S, packs)
            except Exception as e:     # a failed recipe must not sink the run; its ids become gaps
                import traceback
                traceback.print_exc()
                log(name, "FAILED", repr(e))
                continue
            sprites.update(got)
            log(f"{T}px {name} {time.time() - t1:.1f}s")
        noisy = {n: int(speckles(a).sum()) for n, a in sprites.items() if speckles(a).any() and n in scope}
        if noisy:
            log(f"{T}px single-pixel islands:", noisy)
        gaps = [{"assetId": n, "reason": "not converted in this run"} for n in scope if n not in sprites]
        zoom = int(opt("--zoom")) if opt("--zoom") else (4 if T == 16 else 2)
        tile_sheet(pal, sprites, scope + [n for n in sprites if n not in scope], T, os.path.join(SCRATCH, f"tiles-{T}@{zoom}x.png"), zoom)
        shapes_sheet(pal, sprites, T, os.path.join(SCRATCH, f"shapes-{T}@{zoom}x.png"), zoom, grid=True, cur=cur,
                     only=opt("--shapes").split(",") if opt("--shapes") else None)
        if not only:
            write_part(os.path.join(PARTS, f"props-{T}.json"), T, targets, sprites, gaps)
        log(f"size {T}: {len(sprites)} sprites, {len(gaps)} gaps, {time.time() - t0:.1f}s")
    try:
        os.remove(TMP_PNG)
    except OSError:
        pass
    log("done in %.1fs, %d renders" % (time.time() - t_all, RENDERS[0]))


if __name__ == "__main__":
    main()
