"""
KayKit ground, "lit" style: the library maker for the ground, wall and edge tiles of The Living Table (Blender 5.2, headless).

Scope: every `ground` (40 ids), `wall` (5) and `edge` (190) target in .cache/kaykit/library/targets.json, at 16 px and 32 px, as two
parts: .cache/kaykit/library/parts/ground-lit-16.json and ground-lit-32.json (format and validator: scripts/kaykit/check-part.mjs).

Derived from env_lit.py (the prototype the owner liked: depth from the 3D, not flat colour). The method is the same:

  * every ground surface is a HEIGHTFIELD built into a real dense mesh in Blender, rendered straight down with the renderer's own
    normal pass and depth pass, and lit in numpy by a raking key light from the upper left (n.L for bevels, a cast shadow marched
    across the depth pass, cavity darkening, a glint on water), then quantised to three to five tones of the game's own palette.
  * where KayKit has the piece, the heightfield starts from the piece: the Dungeon `floor_tile_small`, `_broken_A` and `_broken_B`
    (octagon and diamond cobbles, one tile each) for the stone floor, `floor_dirt_small_*` (their pebbles) for dirt, the proportions
    of `floor_tile_grate` for the drain, the Medieval Hexagon tree crowns (`tree_single_A`, `tree_single_B`, seen from straight above)
    for the forest canopy, and the Hexagon `rock_single_*` stones lying on the cliff top. Grass, pale grass, water, sand, the cliff
    rock, the wall masonry and the wall caps are generated lit geometry, as env_lit.py did (the packs' own meshes are flat there).

THE RULE THAT SHAPES EVERYTHING: the game scatters the four variants of a material over a field by a hash of the tile coordinate
(src/games/livingtable/render/tileVariants.ts), so any variant sits beside any variant. Each field material is therefore built as
a BASE that is periodic with period ONE tile (identical in all four variants, so every tile border matches every other) plus a
private DETAIL per variant that fades to nothing within a pixel or two of the tile border. `Field.seam_check` tests the claim
directly: it lights random arrangements of the four heightfields as one piece and compares every cell with the tile this script
writes (0 mismatching pixels for every material, at both sizes). Edge tiles are made from the base tiles, so they meet the field
the same way.

Edge tiles use exactly the game's masks (scripts/assets/fantasy.ts: EDGE_BITE, orthoMask, innerMask, ORTHO_VARIANTS, INNER_VARIANTS,
EDGE_PAIRS): the OVER material is the tile, the UNDER material eats in from the named sides (or the named corner) along the same
wandering profile, scaled for 32 px. What is new is the bank: its shading follows the raking light (a lit lip where the bank faces
the light, a shaded lip and a shadow at its foot where it faces away), plus the family's own touches (turf spilling over the cut,
foam on a shore, a dark footing under rock, an even blend for pale grass into grass).

Run from the repo root (about 25 seconds for both sizes):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/lib_ground_lit.py -- [--sizes 16,32] [--only stone,grass,...] [--no-edges] [--scratch-only]

  --only builds just those materials and writes a partial part under scratch instead of the real one; --scratch-only builds and
  checks everything but writes no part.

Inputs (all under .cache/, gitignored): dungeon pack (.cache/kaykit/dungeon), Medieval Hexagon pack
(.cache/kaykit/scratch/env/hexagon), palette-fantasy.json, library/targets.json.
Outputs: .cache/kaykit/library/parts/ground-lit-{16,32}.json, scratch under .cache/kaykit/scratch/ground-lit/ (tiles-N.npz and
report.json: the seam checks, isolated pixel shares and timings of the last run).
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
PACK = os.path.join(ROOT, ".cache", "kaykit", "dungeon", "addons", "kaykit_dungeon_remastered")
GLTF = os.path.join(PACK, "Assets", "gltf")
HEX = os.path.join(ROOT, ".cache", "kaykit", "scratch", "env", "hexagon", "addons", "kaykit_medieval_hexagon_pack", "Assets", "gltf")
PALETTE_JSON = os.path.join(ROOT, ".cache", "kaykit", "palette-fantasy.json")
TARGETS_JSON = os.path.join(ROOT, ".cache", "kaykit", "library", "targets.json")
PARTS_DIR = os.path.join(ROOT, ".cache", "kaykit", "library", "parts")
SCRATCH = os.path.join(ROOT, ".cache", "kaykit", "scratch", "ground-lit")
TMP_PNG = os.path.join(SCRATCH, f"render_{os.getpid()}.png")

TRANSPARENT = 255
RENDERS = [0]
UNITS_PER_TILE = 2.0       # the pack's grid: a small floor tile is 2 x 2 units
USABLE = 48
MAKER = "ground-lit"
STYLE = "lit"


def log(*a):
    print("[env]", *a, flush=True)



def srgb_to_lab(rgb01):
    rgb01 = np.asarray(rgb01, dtype=np.float64)
    c = np.where(rgb01 <= 0.04045, rgb01 / 12.92, ((rgb01 + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    return np.stack([116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])], -1)


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
        write_png(name if os.path.isabs(name) else os.path.join(SCRATCH, name), rgba)


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


# -- cracks -----------------------------------------------------------------------------------------------------------------------
STONE_TONES = [24, 25, 26, 27]


def carve_cracks(H, tops, rng, pxs, n=3, depth_px=0.9, span_px=(5.0, 9.0), width=0.45, segs=2, start=None, ang0=None):
    """Hairline cracks: short zigzag runs carved into the tops (a V about one sample wide, in pixels `depth_px` deep)."""
    h, w = H.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    out = H.copy()
    tys, txs = np.nonzero(tops)
    for _ in range(n):
        i = rng.randint(len(tys))
        y, x = float(tys[i]), float(txs[i])
        ang = rng.uniform(0, 2 * np.pi)
        if start is not None:
            y, x = float(start[0]), float(start[1])
        if ang0 is not None:
            ang = ang0
        for seg in range(segs):
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
            cut = -depth_px * np.clip(1.0 - dist / width, 0.0, 1.0)
            sub = out[np.ix_(ys_, xs_)]
            mk = tops[np.ix_(ys_, xs_)]
            out[np.ix_(ys_, xs_)] = np.where(mk, np.minimum(sub, sub + cut), sub)
            y, x = y2, x2
    return out


# -- chamfered blocks --------------------------------------------------------------------------------------------------------------
def block_profile(sd, bevel_px, drop_px, groove_px, deep_px):
    """Height (in pixels) of a chamfered raised block with a V groove around it, from the signed distance to its edge."""
    bev = np.where(sd >= bevel_px, 0.0, np.where(sd >= 0, -drop_px * (1.0 - sd / bevel_px), 0.0))
    groove = np.where(sd < 0, -drop_px - (deep_px - drop_px) * np.clip(-sd / (groove_px * 0.5), 0.0, 1.0), 0.0)
    return bev + groove


# -- wall cap blocks ---------------------------------------------------------------------------------------------------------------
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


def grass_heights(S, seed=41, detail_b=None, kinds=('plain', 'plain', 'plain', 'plain'), swell=(0.42, 0.30)):
    """Grass module of 2 x 2 tiles. Every tile is the same periodic BASE (ground swell and a few blades that run across the tile
    edges, period one tile) plus its own DETAIL (tufts and swell that fade to nothing within `detail_b` pixels of the tile edge).
    Because the edge strips are base only, any tile can sit next to any tile, itself included, and the texture simply continues.
    Returns (H for the module in world units, info)."""
    ss, T, pxu = S.ss, S.T, S.pxu
    pxs = float(ss)
    n = T * ss
    k = (T / 16.0) ** 0.8
    b = detail_b if detail_b is not None else detail_margin(T)
    rng = np.random.RandomState(seed)
    Bs = np.zeros((n, n), np.float32)
    Bs += swell[0] * fft_noise((n, n), seed + 1, T / 6.0)
    add_tufts(Bs, rng, 1 if T <= 16 else 2, (0.0, 0.0), (T, T), k, pxs)
    c = (np.arange(n) + 0.5) / pxs
    edge = np.minimum(c, T - c)
    w1 = np.clip((edge - b) / 1.5, 0.0, 1.0)
    W = np.minimum(w1[:, None], w1[None, :])
    H = np.zeros((2 * n, 2 * n), np.float32)
    info_flowers = []
    for vy in range(2):
        for vx in range(2):
            r2 = np.random.RandomState(seed + 100 + 7 * vy + vx)
            Dv = np.zeros((n, n), np.float32)
            Dv += swell[1] * fft_noise((n, n), seed + 10 + 3 * vy + vx, T / 6.5)
            kind = kinds[2 * vy + vx]
            if kind == 'plain':
                add_tufts(Dv, r2, (2 + int(r2.rand() < 0.6)) if T <= 16 else 7, (b + 1.0, b + 3.5), (T - b - 1.0, T - b), k, pxs)
            elif kind == 'tussock':
                add_tussock(Dv, T, k, pxs)
            elif kind == 'flowers':
                add_tufts(Dv, r2, 1 if T <= 16 else 3, (b + 1.0, b + 3.5), (T - b - 1.0, T - b), k, pxs)
                info_flowers.append(add_flowers(Dv, T, k, pxs, np.random.RandomState(seed + 500)))
            Dv = np.where(W > 0.999, Dv, np.where(W > 0, Dv * W, 0.0))
            H[vy * n:(vy + 1) * n, vx * n:(vx + 1) * n] = Bs + Dv
    return (H * pxu).astype(np.float32), dict(b=b, flowers=info_flowers)


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
    b = detail_b if detail_b is not None else detail_margin(T)
    Bs = np.zeros((n, n), np.float32)
    Bs += 0.06 * (T / 16.0) ** 1.0 * fft_noise((n, n), seed + 1, T / 6.0, aniso=(1.0, 3.0))
    rb = np.random.RandomState(seed + 5)
    # base ripples: long dashes in three rows of the tile, wrapping across the tile border, the same in every tile
    for fy in (0.10, 0.42, 0.76):
        add_ripple(Bs, T * fy + rb.uniform(-0.04, 0.04) * T, rb.uniform(0, T), 7.5 * k, 0.55 * kw, 0.50 * kw, 0.0, pxs)
    c = (np.arange(n) + 0.5) / pxs
    edge = np.minimum(c, T - c)
    w1 = np.clip((edge - b) / 1.5, 0.0, 1.0)
    W = np.minimum(w1[:, None], w1[None, :])
    H = np.zeros((2 * n, 2 * n), np.float32)
    for vy in range(2):
        for vx in range(2):
            r2 = np.random.RandomState(seed + 100 + 7 * vy + vx)
            Dv = np.zeros((n, n), np.float32)
            Dv += 0.16 * (T / 16.0) ** 1.0 * fft_noise((n, n), seed + 10 + 3 * vy + vx, T / 6.0, aniso=(1.0, 3.0))
            ys_used = []
            for _ in range((4 if T <= 16 else 9)):
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


# ===========================================================================================================================
# Field materials: a base periodic with period ONE tile (identical in every variant) plus a private detail per variant
# ===========================================================================================================================
def border_dist(T, ss):
    """Distance in pixels from each sample of a one tile array (T*ss samples square) to the nearest tile border."""
    n = T * ss
    c = (np.arange(n) + 0.5) / ss
    e = np.minimum(c, T - c)
    return np.minimum(e[:, None], e[None, :]).astype(np.float32)


def fade(T, ss, b, ramp=1.5):
    """Weight of a variant's private detail: 0 within b pixels of the tile border, 1 from b + ramp pixels in."""
    return np.clip((border_dist(T, ss) - b) / ramp, 0.0, 1.0).astype(np.float32)


def detail_margin(T):
    """Pixels from the tile border where only the shared base may show (measured: with the lighting used here a variant's detail may
    come this close to the border and still leave every border pixel identical in all four variants)."""
    return 1.6 if T <= 16 else 2.6


class Field:
    """One material of four interchangeable tiles. Hs: four heightfields (T*ss samples square, world units), one per variant, that
    agree within `margin` pixels of the tile border. `tone(S, Vp, off)` turns a lit Surf into palette indices (off: the per pixel
    tone shift layer, or None). `shifts`: per variant tone shift arrays (samples), or None."""

    def __init__(self, name, T, ss, Hs, light_kw, tone, shifts=None, marks=None):
        self.name, self.T, self.ss, self.Hs, self.light_kw, self.tone, self.shifts = name, T, ss, Hs, light_kw, tone, shifts
        self.marks = marks            # per variant: (T, T) int array, -1 where nothing is stamped, else a palette index (cracks, flowers)

    def _assemble(self, st, order):
        """Light an arrangement of tiles (list of rows of variant ids) as one wrapped piece; returns the palette index array."""
        T, ss = self.T, self.ss
        rows, cols = len(order), len(order[0])
        H = np.block([[self.Hs[v] for v in row] for row in order])
        S = Surf(st, T, ss, cols, rows)
        Vp, m = S.light(H, **self.light_kw)
        off = None
        if self.shifts is not None:
            sh = np.block([[self.shifts[v] for v in row] for row in order])
            off = pixel_layer(S, sh)
        idx = self.tone(S, Vp, off)
        out = idx[m:m + S.Hh, m:m + S.W].copy()
        if self.marks is not None:
            for r, row in enumerate(order):
                for c, v in enumerate(row):
                    mk = self.marks[v]
                    if mk is not None:
                        reg = out[r * T:(r + 1) * T, c * T:(c + 1) * T]
                        reg[mk >= 0] = mk[mk >= 0]
        return out, S

    def tiles(self, st):
        """The four tiles, variant order a, b, c, d (cut from the 2 x 2 module)."""
        idx, _ = self._assemble(st, [[0, 1], [2, 3]])
        T = self.T
        return [idx[r * T:(r + 1) * T, c * T:(c + 1) * T].copy() for r, c in ((0, 0), (0, 1), (1, 0), (1, 1))]

    def seam_check(self, st, tiles, seed=3, n=5, use=(0, 1, 2, 3), arrangements=4):
        """The claim that any tile can sit beside any tile, tested directly: light random n x n arrangements of the heightfields as one
        piece (`arrangements` of them) and compare every cell with the tile cut from the 2 x 2 module. Returns (mismatch share over all
        pixels, mismatch share within 2 pixels of a tile border, worst tile mismatch count), over all the arrangements."""
        T = self.T
        bad, edge_bad, worst, cells = 0, 0, 0, 0
        band = np.zeros((T, T), bool)
        band[:2, :] = band[-2:, :] = True
        band[:, :2] = band[:, -2:] = True
        for a in range(arrangements):
            rng = np.random.RandomState(seed + a)
            order = [[int(use[rng.randint(len(use))]) for _ in range(n)] for _ in range(n)]
            big, _ = self._assemble(st, order)
            for r in range(n):
                for c in range(n):
                    d = big[r * T:(r + 1) * T, c * T:(c + 1) * T] != tiles[order[r][c]]
                    bad += int(d.sum())
                    edge_bad += int((d & band).sum())
                    worst = max(worst, int(d.sum()))
                    cells += 1
        return round(bad / float(cells * T * T), 4), round(edge_bad / float(cells * int(band.sum())), 4), worst


# -- stone cobble ----------------------------------------------------------------------------------------------------------------
STONE_PIECES = ("floor_tile_small", "floor_tile_small", "floor_tile_small_broken_A", "floor_tile_small_broken_B")


def stone_tile(S1, piece, seed, bevel_px=1.0, drop_px=0.65, groove_px=0.75, deep_px=1.3, plate_px=0.8, n_pits=3, n_cracks=0, joint_shift=None, own_dome=1.0):
    """One cobble tile, periodic with period one tile, from a KayKit floor_tile_small piece. The pack lays octagon stones on the tile
    corners (four quarters make one octagon, so they cross every tile border) and a diamond, a broken ring or a broken polygon on the
    tile centre: the octagons are the shared base, the centre is the variant. Height is in world units. Returns (H, sd, hole)."""
    st, ss, ppu, pxu, T = S1.st, S1.ss, S1.ppu, S1.pxu, S1.T
    D0, _ = kk_depth(st, [dict(name=piece)], S1.W, S1.Hh, ppu, ss)
    tops = D0 > 0.040
    nyx = tops.shape
    pxs = float(ss)
    sd = signed_dist(tops, int(6 * pxs)) / pxs
    if joint_shift is None:
        # how wide the KayKit joints are here, measured on the plain piece, so every variant gets the same groove width
        Dp, _ = kk_depth(st, [dict(name="floor_tile_small")], S1.W, S1.Hh, ppu, ss)
        tp = Dp > 0.040
        trans = np.abs(np.diff(tp.astype(np.int8), axis=1)).sum() + np.abs(np.diff(tp.astype(np.int8), axis=0)).sum()
        meas = (~tp).sum() / max(1.0, trans / 2.0) / pxs
        joint_shift = 0.5 * (groove_px - meas)
    sd = sd - joint_shift
    rng = np.random.RandomState(seed)
    yy, xx = np.mgrid[0:nyx[0], 0:nyx[1]].astype(np.float32)
    gw = groove_px * 0.5
    bev = np.where(sd >= bevel_px, 0.0, np.where(sd >= 0, -drop_px * (1.0 - sd / bevel_px), 0.0))
    groove = np.where(sd < 0, -drop_px - (deep_px - drop_px) * np.clip(-sd / gw, 0.0, 1.0), 0.0)
    # a broken tile's hole is wide: its floor is a plate a little below the paving, not a deep joint
    hole_w = np.clip((-sd - 1.0) / 1.2, 0.0, 1.0)
    groove = np.where(sd < 0, groove * (1.0 - hole_w) - plate_px * hole_w, 0.0)
    H = bev + groove
    lab = label_periodic(sd > 0)
    bd = border_dist(S1.T, ss)
    kk = float(S1.T) / 16.0
    for k in range(1, lab.max() + 1):
        mk = lab == k
        if mk.sum() < 40:
            continue
        shared = bool((mk & (bd < 1.5)).any())
        cy, cx = circ_centroid(mk, nyx[0], nyx[1])
        dy, dxp = wrap_delta(yy, cy, nyx[0]) / pxs, wrap_delta(xx, cx, nyx[1]) / pxs
        if shared:
            # an octagon: the same in every tile that holds a quarter of it
            r2 = np.random.RandomState(901)
            rad = 0.60 * S1.T
        else:
            r2 = rng
            rad = np.sqrt(mk.sum()) / pxs / 1.6 + 1e-3
        a, b = r2.normal(0, 0.008), r2.normal(0, 0.008)
        amp = 0.75 * kk ** 0.7 * (1.0 if shared else own_dome)
        dome = amp * np.clip(1.0 - (dy * dy + dxp * dxp) / (rad * rad), 0.0, 1.0)
        H = H + np.where(mk, a * dxp + b * dy + dome + r2.normal(0, 0.03), 0.0)
    # soft mottling, the same field in every variant
    H = H + np.where(sd > 0, 0.11 * fft_noise(nyx, 7001, 3.0), 0.0)
    # grit and hairline cracks only well inside the tile, where this variant is the only one to show
    inner = (bd > detail_margin(S1.T) + 1.5) & (sd > 1.4)
    tys, txs = np.nonzero(inner)
    Y, X = np.mgrid[0:nyx[0], 0:nyx[1]].astype(np.float32)
    for _ in range(int(n_pits)):
        if not len(tys):
            break
        j = rng.randint(len(tys))
        cy, cx = tys[j] / pxs, txs[j] / pxs
        rr = rng.uniform(0.7, 1.0) * kk ** 0.5
        amp = (0.5 if rng.rand() < 0.5 else -0.5) * rng.uniform(0.7, 1.1)
        dyw, dxw = (Y / pxs - cy), (X / pxs - cx)
        H = H + amp * np.clip(1.0 - (dyw * dyw + dxw * dxw) / (rr * rr), 0.0, 1.0) * inner
    if n_cracks:
        H = carve_cracks(H, inner, rng, pxs, n=n_cracks, depth_px=0.9, span_px=(4.0 * kk ** 0.7, 7.0 * kk ** 0.7))
    return (H * pxu).astype(np.float32), sd, (sd < -1.0)


def crack_marks(T, ss, rng, n, span, segs=2, dark=24, lit=27, start=None, ang0=None, width_px=0.75, margin=None):
    """Hairline cracks stamped straight onto the toned tile (the lighting cannot keep a one pixel line: lone pixels are absorbed into their
    neighbours). Zigzag runs of `segs` segments, `n` of them, each segment `span` pixels long; a dark line with a lit pixel on its upper
    left. Returns a (T, T) int array, -1 where there is no mark. Kept `margin` pixels off the tile border."""
    kk = T / 16.0
    margin = detail_margin(T) + 1.0 if margin is None else margin
    n_s = T * ss
    Y, X = (np.mgrid[0:n_s, 0:n_s].astype(np.float32) + 0.5) / ss
    cov = np.zeros((n_s, n_s), np.float32)
    for _ in range(n):
        if start is None:
            y, x = rng.uniform(margin + 1.5, T - margin - 1.5), rng.uniform(margin + 1.5, T - margin - 1.5)
        else:
            y, x = start
        ang = rng.uniform(0, 2 * np.pi) if ang0 is None else ang0
        for _seg in range(segs):
            ang += rng.uniform(-0.5, 0.5)
            ln = rng.uniform(*span) * kk ** 0.9
            y2, x2 = y + np.sin(ang) * ln, x + np.cos(ang) * ln
            vx, vy = x2 - x, y2 - y
            t = np.clip(((X - x) * vx + (Y - y) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
            dist = np.sqrt((X - (x + t * vx)) ** 2 + (Y - (y + t * vy)) ** 2)
            cov = np.maximum(cov, (dist < width_px * 0.5 * kk ** 0.5).astype(np.float32))
            y, x = y2, x2
    px = to_pixels(cov, T, T, ss) > 0.30
    bd = border_dist(T, 1)
    px &= bd > margin
    out = np.full((T, T), -1, np.int16)
    shifted = np.zeros_like(px)
    shifted[1:, 1:] = px[:-1, :-1]
    shifted[1:, :] |= False
    # the lit pixel is on the upper left of the dark line: a dark pixel at (y, x) lights the pixel at (y - 1, x - 1) when that is not dark
    lit_px = np.zeros_like(px)
    lit_px[:-1, :-1] = px[1:, 1:]
    lit_px &= ~px
    out[lit_px] = lit
    out[px] = dark
    return out


def build_stone(st, T, ss, report):
    S1 = Surf(st, T, ss, 1, 1)
    b = detail_margin(T)
    W = fade(T, ss, b)
    raw = [stone_tile(S1, p, 11 + 17 * i, n_pits=(3 if i else 2), own_dome=(2.4 if i == 1 else 1.0)) for i, p in enumerate(STONE_PIECES)]
    base = raw[0][0]
    Hs = [base] + [base + W * (r[0] - base) for r in raw[1:]]
    shifts = None

    def tone(S, Vp, off):
        idx, _ = tone_and_clean(Vp, STONE_TONES, 2.0, 5.0, passes=2, off=off)
        return idx
    lk = dict(reach_px=2.4, ao_px=1.2, ao_k=0.26, shadow_k=0.55) if T <= 16 else dict(reach_px=2.8, ao_px=1.3, ao_k=0.4, shadow_k=0.7)
    return Field("stone", T, ss, Hs, lk, tone, shifts, None), raw


# -- grass, pale grass, water (env_lit's lit surfaces, as Fields) ------------------------------------------------------------------
GRASS_PALE_TONES = [17, 18, 19, 38]


def add_tussock(Dv, T, k, pxs):
    """A tussock decal: a low mound with a fan of long blades standing out of it, in the middle of the tile."""
    cy, cx = T * 0.56, T * 0.50
    add_tuft(Dv, cy, cx, 3.4 * k, 4.2 * k, 0.55 * k ** 0.6, 0.0, pxs)
    for j in range(11):
        ang = (j - 5) * 0.27
        add_blade(Dv, cy + 1.5 * k, cx + (j - 5) * 0.50 * k, ang, (4.8 + 1.1 * np.cos(j * 1.7)) * k, 0.80 * k ** 0.5, 2.4 * k ** 0.6, pxs)


def add_flowers(Dv, T, k, pxs, rng):
    """Stems and flower heads in the middle of the tile. Returns the head positions in pixels (y, x); the heads are stamped in a
    flower colour after the grass is toned."""
    b = detail_margin(T)
    heads = []
    want = 6 if T <= 16 else 13
    for _ in range(200):
        if len(heads) >= want:
            break
        y = rng.uniform(b + 1.5 + 1.0 * k, T - b - 1.5)
        x = rng.uniform(b + 1.5, T - b - 1.5)
        if all((y - hy) ** 2 + (x - hx) ** 2 >= (3.3 * k) ** 2 for hy, hx in heads):
            heads.append((y, x))
    for y, x in heads:
        add_blade(Dv, y + 2.3 * k, x - 0.2 * k, 0.12, 2.5 * k, 0.5 * k ** 0.5, 1.0 * k ** 0.6, pxs)
        add_tuft(Dv, y, x, 0.9 * k, 0.9 * k, 1.2 * k ** 0.6, 0.0, pxs)
    return [(int(round(y - 0.5)), int(round(x - 0.5))) for y, x in heads]


def split4(H, n):
    return [H[:n, :n], H[:n, n:], H[n:, :n], H[n:, n:]]


def build_grass(st, T, ss, report, pale=False):
    S = Surf(st, T, ss, 2, 2)
    n = T * ss
    H, _ = grass_heights(S, seed=(73 if pale else 41), swell=((0.12, 0.10) if pale else (0.42, 0.30)))
    if pale:
        H = H * 0.85
    tones = GRASS_PALE_TONES if pale else GRASS_TONES

    def tone(S, Vp, off):
        idx, _ = tone_dominant(S, tones, 2.4 if pale else 2.2, 2.6 if pale else 3.0, off=off)
        return idx
    return Field("pale" if pale else "grass", T, ss, split4(H, n), dict(reach_px=2.2, ao_px=1.0, ao_k=(0.25 if pale else 0.45), shadow_k=(0.6 if pale else 0.9)), tone), None


def build_pale(st, T, ss, report):
    return build_grass(st, T, ss, report, pale=True)


def build_grass_decals(st, T, ss, report):
    """Tussock and flowering grass: the same base as the plain grass (same seed) with a decal in the middle of the tile. Variant order
    in the module: tussock, flowers, plain a, plain b. Returns the Field and the flower head positions (for the stamp)."""
    S = Surf(st, T, ss, 2, 2)
    n = T * ss
    H, info = grass_heights(S, seed=41, kinds=('tussock', 'flowers', 'plain', 'plain'))
    tones = GRASS_TONES
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) / float(ss)
    kk = (T / 16.0) ** 0.8
    clump = np.clip(1.0 - (((yy - T * 0.50) / (4.6 * kk)) ** 2 + ((xx - T * 0.48) / (5.4 * kk)) ** 2), 0.0, 1.0)
    shifts = [(0.9 * np.sqrt(clump)).astype(np.float32)] + [np.zeros((n, n), np.float32)] * 3

    def tone(S, Vp, off):
        idx, _ = tone_dominant(S, tones, 2.2, 3.0, off=off)
        return idx
    return Field("grass_decals", T, ss, split4(H, n), dict(reach_px=2.2, ao_px=1.0, ao_k=0.45), tone, shifts), info["flowers"][0]


def stamp_flowers(tile, heads, T):
    """Flower heads over the toned grass: a cream head, a pale yellow eye. One pixel at 16, a plus of five at 32."""
    out = tile.copy()
    for i, (y, x) in enumerate(heads):
        if T <= 16:
            out[y, x] = 5 if i % 3 else 46
        else:
            for dy, dx in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
                out[y + dy, x + dx] = 5
            out[y, x] = 46 if i % 3 == 0 else 5
            out[y + 1, x + 1] = 17
    return out


def build_water(st, T, ss, report):
    """Water: dashes of ripple, each a lit crest over a shaded trough with a glint on the crest, on a gently swelling surface."""
    S = Surf(st, T, ss, 2, 2)
    n = T * ss
    H, _ = water_heights(S, detail_b=detail_margin(T) + 0.9)

    def tone(S, Vp, off):
        idx, _ = tone_dominant(S, WATER_TONES, 1.0, 2.6, off=off)
        return idx
    return Field("water", T, ss, split4(H, n), dict(reach_px=2.0, ao_px=1.0, ao_k=0.25, shadow_k=0.6, spec_k=0.6, spec_p=30.0), tone), None


# -- dirt -------------------------------------------------------------------------------------------------------------------------
DIRT_TONES = [28, 29, 30, 31]
DIRT_PIECES = ("floor_dirt_small_A", "floor_dirt_small_B", "floor_dirt_small_C", "floor_dirt_small_D")


def spread_points(rng, n, lo, hi, min_d, T, existing=(), tries=300):
    """n points in [lo, hi) pixels at least min_d apart from each other and from `existing`, distances measured on a tile that wraps
    (period T), so a base set stays spread out when the tile is repeated."""
    pts = list(existing)
    out = []
    for _ in range(n):
        best, best_d = None, -1.0
        for _try in range(tries):
            y, x = rng.uniform(lo[0], hi[0]), rng.uniform(lo[1], hi[1])
            d = 1e9
            for (py, px) in pts:
                dy, dx = abs(y - py), abs(x - px)
                dy, dx = min(dy, T - dy), min(dx, T - dx)
                d = min(d, dy * dy + dx * dx)
            if d >= min_d * min_d:
                best = (y, x)
                break
            if d > best_d:
                best, best_d = (y, x), d
        pts.append(best)
        out.append(best)
    return out


def scatter_bumps(H, rng, pts, r_rng, a_rng, k, pxs, wrap=True):
    """A round bump (clod) at each of pts (pixels). Radii in pixels scale with k, heights with k ** 0.6."""
    for (cy, cx) in pts:
        r = rng.uniform(*r_rng) * k
        add_tuft(H, cy, cx, r, r * rng.uniform(0.9, 1.3), rng.uniform(*a_rng) * k ** 0.6, rng.uniform(-0.15, 0.15), pxs, wrap)


def build_dirt(st, T, ss, report):
    """Bare earth: clods lit from the upper left. A periodic base of a few clods that run across the tile border, and per variant a
    clod field of its own plus the pebbles of one KayKit floor_dirt_small piece (their rock meshes, stood up taller than the pack has
    them), faded out at the tile border."""
    S1 = Surf(st, T, ss, 1, 1)
    n = T * ss
    pxs = float(ss)
    k = (T / 16.0) ** 0.8
    b = detail_margin(T)
    W = fade(T, ss, b)
    pxu = S1.pxu
    rb = np.random.RandomState(311)
    Bs = np.zeros((n, n), np.float32)
    base_pts = spread_points(rb, 5 if T <= 16 else 11, (0, 0), (T, T), 4.2 * k, T)
    scatter_bumps(Bs, rb, base_pts, (1.9, 2.7), (0.65, 0.95), k, pxs)
    Hs = []
    shifts = []
    patch_base = 0.5 * fft_noise((n, n), 339, T / 2.2)
    for v, piece in enumerate(DIRT_PIECES):
        D0, _ = kk_depth(st, [dict(name=piece)], S1.W, S1.Hh, S1.ppu, ss)
        rocks = np.clip(D0 - 0.0195, 0.0, None)              # the slab is 0.019 units up; everything above it is a rock
        rocks = np.where(rocks > 0.004, rocks, 0.0)
        rv = np.random.RandomState(320 + v)
        Dv = np.zeros((n, n), np.float32)
        pts = spread_points(rv, 3 if T <= 16 else 7, (b + 1.0, b + 1.0), (T - b - 1.0, T - b - 1.0), 4.2 * k, T, existing=base_pts)
        scatter_bumps(Dv, rv, pts, (1.9, 2.7), (0.65, 0.95), k, pxs)
        Hpx = Bs + W * Dv
        Hs.append((Hpx * pxu + W * rocks * 2.4).astype(np.float32))
        patch = 0.5 * fft_noise((n, n), 340 + v, T / 2.2)
        shifts.append((patch_base + W * (patch - patch_base)).astype(np.float32))

    def tone(S, Vp, off):
        idx, _ = tone_and_clean(Vp, DIRT_TONES, 1.9, 3.6, passes=1, off=off)
        return idx
    return Field("dirt", T, ss, Hs, dict(reach_px=1.8, ao_px=1.2, ao_k=0.25, shadow_k=0.35), tone, shifts), None


# -- sand -------------------------------------------------------------------------------------------------------------------------
SAND_TONES = [29, 30, 31, 3]


def build_sand(st, T, ss, report):
    """Sand: low wind ripples, long dashes that are lit on the side toward the light and shaded on the other, a periodic base (one
    ripple that runs across the tile border) plus ripples, pebbles and a patch of grain of its own inside each tile, the same
    construction as the water."""
    n = T * ss
    pxu = 1.0 / (T / UNITS_PER_TILE)
    pxs = float(ss)
    k = (T / 16.0) ** 0.8
    kw = k ** 0.6
    b = detail_margin(T)
    W = fade(T, ss, b)
    Bs = 0.06 * (T / 16.0) * fft_noise((n, n), 403, T / 3.6, aniso=(1.0, 2.5))
    add_ripple(Bs, T * 0.70, T * 0.50, 7.0 * k, 0.75 * kw, 0.42 * kw, 0.0, pxs)           # runs across the right edge and wraps
    add_ripple(Bs, T * 0.22, T * 0.80, 6.0 * k, 0.75 * kw, 0.42 * kw, 0.0, pxs)
    Y, X = np.mgrid[0:n, 0:n].astype(np.float32)
    Hs = []
    shifts = []
    patch_base = 0.35 * fft_noise((n, n), 439, T / 2.4)
    base_pts = spread_points(np.random.RandomState(409), 3 if T <= 16 else 7, (0, 0), (T, T), 3.8 * k, T)
    for (cy, cx) in base_pts:
        rr = 1.4 * k ** 0.5
        d2 = (np.minimum(np.abs((Y + 0.5) / pxs - cy), T - np.abs((Y + 0.5) / pxs - cy))) ** 2 + (np.minimum(np.abs((X + 0.5) / pxs - cx), T - np.abs((X + 0.5) / pxs - cx))) ** 2
        Bs += 0.6 * k ** 0.6 * np.clip(1.0 - d2 / (rr * rr), 0.0, 1.0)
    for v in range(4):
        r2 = np.random.RandomState(410 + v)
        Dv = 0.05 * (T / 16.0) * fft_noise((n, n), 420 + v, T / 3.0, aniso=(1.0, 2.0))
        ys_used = []
        for _ in range(2 if T <= 16 else 5):
            ln = r2.uniform(5.0, 8.5) * k
            for _try in range(12):
                yy_ = r2.uniform(b + 1.2, T - b - 1.2)
                if all(abs(yy_ - u) >= 3.0 * k for u in ys_used):
                    break
            ys_used.append(yy_)
            add_ripple(Dv, yy_, r2.uniform(b + 0.3, max(b + 0.4, T - b - 0.3 - ln * 0.7)), ln, r2.uniform(0.6, 0.8) * kw, r2.uniform(0.38, 0.55) * kw, r2.uniform(-0.6, 0.6), pxs)
        for _ in range(1 + (v % 2)):
            cy, cx = r2.uniform(b + 2.0, T - b - 2.0), r2.uniform(b + 2.0, T - b - 2.0)
            rr = r2.uniform(0.85, 1.2) * k ** 0.5
            d2 = ((Y + 0.5) / pxs - cy) ** 2 + ((X + 0.5) / pxs - cx) ** 2
            Dv += 0.9 * k ** 0.6 * np.clip(1.0 - d2 / (rr * rr), 0.0, 1.0)
        for (cy, cx) in spread_points(r2, 4 if T <= 16 else 10, (b + 1.0, b + 1.0), (T - b - 1.0, T - b - 1.0), 3.4 * k, T, existing=base_pts):
            rr = r2.uniform(1.2, 1.8) * k ** 0.5
            d2 = ((Y + 0.5) / pxs - cy) ** 2 + ((X + 0.5) / pxs - cx) ** 2
            Dv += r2.uniform(0.45, 0.8) * k ** 0.6 * np.clip(1.0 - d2 / (rr * rr), 0.0, 1.0)
        Hs.append(((Bs + W * Dv) * pxu).astype(np.float32))
        patch = 0.35 * fft_noise((n, n), 440 + v, T / 2.4)
        shifts.append((patch_base + fade(T, ss, b + 2.2) * (patch - patch_base)).astype(np.float32))

    def tone(S, Vp, off):
        idx, _ = tone_dominant(S, SAND_TONES, 2.0, 3.0, off=off)
        return idx
    return Field("sand", T, ss, Hs, dict(reach_px=2.0, ao_px=1.0, ao_k=0.2, shadow_k=0.6), tone, shifts), None


# -- forest canopy ----------------------------------------------------------------------------------------------------------------
CANOPY_TONES = [9, 16, 17, 18, 19]
HEX_CACHE = {}


def hex_finder():
    idx = {}
    for dp, _, fn in os.walk(HEX):
        for f in fn:
            if f.endswith(".gltf"):
                idx[f[:-5]] = os.path.join(dp, f)
    return lambda name: idx[name]


def hex_stage():
    """A second library and stage for the Medieval Hexagon pack (its own material, its own camera)."""
    if "stage" not in HEX_CACHE:
        lib = Library(hex_finder())
        lib.load("tree_single_B")
        HEX_CACHE["lib"] = lib
        HEX_CACHE["stage"] = Stage(lib, PAL)
    return HEX_CACHE["stage"]


def crown_stamp(name, ppu_hi=96, skirt=0.30):
    """A KayKit tree seen from straight above: (heights above the crown's lower skirt in world units, half width in world units).
    The trunk is hidden under the crown, so the map is the crown alone."""
    stg = hex_stage()
    key = ("crown", name, skirt)
    if key in HEX_CACHE:
        return HEX_CACHE[key]
    stg.lib.load(name)
    mn, mx = stg.lib.bounds[name]
    cx, cy = (mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0
    half = max(mx.x - mn.x, mx.y - mn.y) / 2.0 + 0.04
    px = int(math.ceil(2 * half * ppu_hi))
    D, m = kk_depth(stg, [dict(name=name)], px, px, ppu_hi, 1, cx, cy)
    h = np.where(m, np.clip(D - skirt, 0.0, None), 0.0).astype(np.float32)
    HEX_CACHE[key] = (h, half)
    return h, half


def bilinear(img, y, x):
    """img sampled at fractional coordinates (y, x) in pixels (0 outside)."""
    h, w = img.shape
    y0, x0 = np.floor(y).astype(np.int64), np.floor(x).astype(np.int64)
    fy, fx = (y - y0).astype(np.float32), (x - x0).astype(np.float32)

    def at(yy, xx):
        ok = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w)
        return np.where(ok, img[np.clip(yy, 0, h - 1), np.clip(xx, 0, w - 1)], 0.0)
    return (at(y0, x0) * (1 - fy) * (1 - fx) + at(y0, x0 + 1) * (1 - fy) * fx + at(y0 + 1, x0) * fy * (1 - fx) + at(y0 + 1, x0 + 1) * fy * fx)


def stamp_crown(H, stamp, half, cy, cx, rad_world, rot, lift, n, T, ss, pxu):
    """Add one crown to H (a tile, T*ss samples square, periodic) centred at (cy, cx) pixels: the KayKit crown scaled so its radius is
    rad_world, rotated by `rot`, raised by `lift` world units (so crowns pile in layers). Overlaps take the higher crown."""
    s = rad_world / half
    ppu = T / UNITS_PER_TILE
    reach = int(math.ceil(rad_world * ppu * ss)) + 2
    cys, cxs = int(round(cy * ss)), int(round(cx * ss))
    ys = np.arange(cys - reach, cys + reach + 1)
    xs = np.arange(cxs - reach, cxs + reach + 1)
    Y, X = np.meshgrid(ys, xs, indexing="ij")
    dy = (Y + 0.5 - cy * ss) / (ppu * ss)            # world offsets (y down the image)
    dx = (X + 0.5 - cx * ss) / (ppu * ss)
    c, sn = math.cos(rot), math.sin(rot)
    u = (c * dx - sn * dy) / s
    v = (sn * dx + c * dy) / s
    ppu_hi = stamp.shape[0] / (2.0 * half)
    # the stamp's +y is world +y (up the image), so flip the row axis
    sy = stamp.shape[0] / 2.0 - v * ppu_hi
    sx = stamp.shape[1] / 2.0 + u * ppu_hi
    val = bilinear(stamp, sy, sx)
    val = np.where(val > 0, val + lift, 0.0).astype(np.float32)
    iy, ix = ys % n, xs % n
    cur = H[np.ix_(iy, ix)]
    H[np.ix_(iy, ix)] = np.maximum(cur, val)


def build_canopy(st, T, ss, report):
    """Forest canopy from above, out of KayKit tree crowns (Medieval Hexagon tree_single_A and _B seen from straight above): a
    periodic base of crowns that lie across the tile borders, and per variant crowns of its own, piled on top and faded out at the
    border. Lit from the upper left, the crowns are faceted domes with dark gaps between them."""
    n = T * ss
    pxu = 1.0 / (T / UNITS_PER_TILE)
    b = detail_margin(T)
    b = b + 0.8                  # crowns cast long shadows: keep their detail a little further from the border
    W = fade(T, ss, b)
    stamps = [crown_stamp("tree_single_B"), crown_stamp("tree_single_A")]
    Bs = np.zeros((n, n), np.float32)
    rb = np.random.RandomState(501)
    # the shared base: a big crown on the tile corner (so four tiles make one), a smaller one on the middle of each edge, a small one in
    # the middle of the tile. They overlap, so little is left bare.
    base_pts = [(0.0, 0.0, 0.86), (0.0, 0.5, 0.62), (0.5, 0.0, 0.62), (0.5, 0.5, 0.56)]
    for i, (fy, fx, rad) in enumerate(base_pts):
        st_, half = stamps[i % 2]
        stamp_crown(Bs, st_, half, fy * T, fx * T, rad, rb.uniform(0, 6.28), 0.04 * rb.rand(), n, T, ss, pxu)
    Hs = []
    shifts = []
    for v in range(4):
        rv = np.random.RandomState(510 + v)
        Dv = np.zeros((n, n), np.float32)
        # each variant: its own big crown in the middle of the tile (the two KayKit tree shapes, turned), piled over the small one
        st_, half = stamps[v % 2]
        stamp_crown(Dv, st_, half, T * 0.5 + rv.uniform(-0.04, 0.04) * T, T * 0.5 + rv.uniform(-0.04, 0.04) * T, 0.80 + 0.08 * rv.rand(), rv.uniform(0, 6.28), 0.16 + 0.06 * rv.rand(), n, T, ss, pxu)
        Hv = np.maximum(Bs, W * Dv).astype(np.float32)
        Hs.append(Hv)
        # any ground still showing between the crowns is in their shade: the darkest greens
        shifts.append(np.where(Hv <= 1e-6, -1.6, 0.0).astype(np.float32))

    def tone(S, Vp, off):
        idx, _ = tone_and_clean(Vp, CANOPY_TONES, 2.9, 3.2, passes=2, off=off)
        return idx
    return Field("canopy", T, ss, Hs, dict(reach_px=2.6, ao_px=2.0, ao_k=0.6, shadow_k=0.8), tone, shifts), None


# -- cliff top: cracked rock plates -----------------------------------------------------------------------------------------------
CLIFF_TOP_TONES = [25, 26, 27, 32]


def torus_voronoi(n, pts, T, ay=1.0):
    """For a tile of n x n samples (T pixels across, periodic), the distance in pixels to the nearest and second nearest of the seed
    points `pts` (pixels, periodic), and the index of the nearest."""
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) * (T / float(n))
    d1 = np.full((n, n), 1e9, np.float32)
    d2 = np.full((n, n), 1e9, np.float32)
    idx = np.zeros((n, n), np.int32)
    for i, (py, px) in enumerate(pts):
        dy = np.abs(yy - py)
        dx = np.abs(xx - px)
        dy = np.minimum(dy, T - dy) * ay
        dx = np.minimum(dx, T - dx)
        d = np.sqrt(dy * dy + dx * dx)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        idx = np.where(closer, i, idx)
        d1 = np.where(closer, d, d1)
    return d1, d2, idx


def rock_plates(S1, seed, n_cells, bevel_px=1.0, drop_px=0.6, joint_px=0.8, deep_px=1.4, dome_px=0.8, cracks=0, relax=2, ay=1.0, spacing=4.6):
    """A periodic tile of cracked rock plates (a Voronoi on a torus): chamfered plates separated by hairline joints, each with its own
    height, tilt and dome. Returns the height in world units."""
    T, ss, pxu = S1.T, S1.ss, S1.pxu
    n = T * ss
    pxs = float(ss)
    rng = np.random.RandomState(seed)
    kk = T / 16.0
    pts = spread_points(rng, n_cells, (0, 0), (T, T), spacing * kk, T)
    # Lloyd relaxation, so the plates are even rather than slivers
    for _ in range(relax):
        d1, d2, idx = torus_voronoi(n, pts, T, ay)
        yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) * (T / float(n))
        new = []
        for i, (py, px) in enumerate(pts):
            mk = idx == i
            if not mk.any():
                new.append((py, px))
                continue
            dy = ((yy[mk] - py + T / 2) % T) - T / 2
            dx = ((xx[mk] - px + T / 2) % T) - T / 2
            new.append(((py + dy.mean()) % T, (px + dx.mean()) % T))
        pts = new
    d1, d2, idx = torus_voronoi(n, pts, T, ay)
    sd = (d2 - d1) * 0.5
    H = block_profile(sd - joint_px * 0.5, bevel_px * kk ** 0.6, drop_px * kk ** 0.6, joint_px, deep_px * kk ** 0.6)
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) * (T / float(n))
    for i, (py, px) in enumerate(pts):
        mk = idx == i
        dy = ((yy - py + T / 2) % T) - T / 2
        dx = ((xx - px + T / 2) % T) - T / 2
        rad = 4.2 * kk
        dome = dome_px * kk ** 0.7 * np.clip(1.0 - (dy * dy + dx * dx) / (rad * rad), 0.0, 1.0)
        H = H + np.where(mk, dome + rng.normal(0, 0.10) + rng.normal(0, 0.03) * dx + rng.normal(0, 0.03) * dy, 0.0)
    if cracks:
        inner = sd > 1.3
        H = carve_cracks(H, inner, rng, pxs, n=cracks, depth_px=0.9, span_px=(4.0 * kk ** 0.7, 7.0 * kk ** 0.7))
    return (H * pxu).astype(np.float32)


def build_cliff_top(st, T, ss, report):
    """Cliff top: cracked rock plates, lit. The shared base is one set of plates (a Voronoi on a torus, period one tile); each variant
    has a plate pattern of its own inside the tile, morphing into the base within a pixel or two of the tile border."""
    S1 = Surf(st, T, ss, 1, 1)
    b = detail_margin(T)
    W = fade(T, ss, b)
    cells = 5 if T <= 16 else 6
    base = rock_plates(S1, 601, cells)
    Hs = []
    n = T * ss
    pxu = S1.pxu
    rocks = [crown_stamp("rock_single_%s" % c, 96, 0.0) for c in "ACDE"]
    for v in range(4):
        Hv = rock_plates(S1, 610 + 7 * v, cells)
        if v in (1, 3):
            rv = np.random.RandomState(650 + v)
            tile = np.zeros((n, n), np.float32)
            for q in range(2 if T <= 16 else 3):
                st_, half = rocks[(v + q) % 4]
                cy, cx = rv.uniform(detail_margin(T) + 3.0, T - detail_margin(T) - 3.0, 2)
                stamp_crown(tile, st_, half, cy, cx, 0.30 + 0.08 * rv.rand(), rv.uniform(0, 6.28), 0.0, n, T, ss, pxu)
            Hv = Hv + tile * 1.7
        Hs.append((base + W * (Hv - base)).astype(np.float32))

    def tone(S, Vp, off):
        idx, _ = tone_and_clean(Vp, CLIFF_TOP_TONES, 1.9, 3.4, passes=2, off=off)
        return idx
    return Field("cliff_top", T, ss, Hs, dict(reach_px=2.4, ao_px=1.2, ao_k=0.45, shadow_k=0.8), tone), None


# -- cliff face: columns of rock, seen from the front -----------------------------------------------------------------------------
CLIFF_FACE_TONES = [24, 25, 26, 27]


def split_sum(rng, total, lo, hi):
    """Random integer-ish pieces in [lo, hi] that sum to total (periodic tile)."""
    out = []
    left = float(total)
    while left > 0:
        if left <= hi + lo:
            if left <= hi:
                out.append(left)
                break
            a = rng.uniform(lo, left - lo)
            out.append(a)
            out.append(left - a)
            break
        a = rng.uniform(lo, hi)
        out.append(a)
        left -= a
    return out


def ashlar(S1, seed, h_rng=(4.0, 7.0), w_rng=(4.5, 9.0), wobble=0.45, tall=1.0):
    """A periodic tile of rough rock blocks, seen from the front: courses of uneven height made of blocks of uneven length,
    chamfered, each with its own height and lean, edges wobbled so they are not ruled lines. Height in world units."""
    T, ss, pxu = S1.T, S1.ss, S1.pxu
    n = T * ss
    kk = T / 16.0
    rng = np.random.RandomState(seed)
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) * (T / float(n))
    warp_y = wobble * kk * fft_noise((n, n), seed + 1, 3.0)
    warp_x = wobble * kk * fft_noise((n, n), seed + 2, 3.0)
    yw = (yy + warp_y + rng.uniform(0, T)) % T
    xw = (xx + warp_x) % T
    heights = split_sum(rng, T, h_rng[0] * kk, h_rng[1] * kk)
    y_edges = np.concatenate([[0.0], np.cumsum(heights)])
    sd = np.full((n, n), 1e3, np.float32)
    lean_h = np.zeros((n, n), np.float32)
    H = np.zeros((n, n), np.float32)
    for c in range(len(heights)):
        y0, y1 = y_edges[c], y_edges[c + 1]
        widths = split_sum(rng, T, w_rng[0] * kk, w_rng[1] * kk)
        start = rng.uniform(0, T)
        xe = start + np.concatenate([[0.0], np.cumsum(widths)])            # edges, from start to start + T
        row = (yw >= y0) & (yw < y1)
        sdy = np.minimum(yw - y0, y1 - yw)
        xm = (xw - start) % T
        rel_edges = np.concatenate([[0.0], np.cumsum(widths)])
        bi = np.clip(np.searchsorted(rel_edges, xm, side="right") - 1, 0, len(widths) - 1)
        left = rel_edges[bi]
        right = rel_edges[bi + 1]
        sdx = np.minimum(xm - left, right - xm)
        sdb = np.minimum(sdx, sdy) - 0.45 * kk ** 0.6
        sd = np.where(row, sdb, sd)
        hb = rng.normal(0, 0.14, len(widths)).astype(np.float32)
        ab = rng.normal(0, 0.03, len(widths)).astype(np.float32)
        cx = (left + right) / 2.0
        cy = (y0 + y1) / 2.0
        H = np.where(row, hb[bi] + ab[bi] * (xm - cx) + 0.5 * kk ** 0.6 * np.clip(1.0 - (((xm - cx) / ((right - left) / 2.0)) ** 2 + ((yw - cy) / ((y1 - y0) / 2.0)) ** 2) * 0.6, 0.0, 1.0), H)
    prof = block_profile(sd, 1.0 * kk ** 0.6, 0.6 * kk ** 0.6, 0.9 * kk ** 0.6, 1.4 * kk ** 0.6)
    return ((prof + H) * pxu).astype(np.float32)


def build_cliff_face(st, T, ss, report):
    """Cliff face: rough blocks of rock in courses of uneven height, lit from the upper left, darker than the cliff top and larger
    than the wall masonry. The shared base is one arrangement of blocks (period one tile); each variant has an arrangement of its
    own inside the tile, morphing into the base a pixel or two from the tile border."""
    S1 = Surf(st, T, ss, 1, 1)
    n = T * ss
    b = detail_margin(T)
    b = b + 0.6
    W = fade(T, ss, b)
    base = ashlar(S1, 701, tall=1.0)
    Hs = []
    pxs = float(ss)
    for v in range(4):
        Hv = ashlar(S1, 710 + 13 * v)
        if v in (1, 3):
            rv = np.random.RandomState(740 + v)
            inner = border_dist(T, ss) > detail_margin(T) + 1.5
            Hv = carve_cracks(Hv / S1.pxu, inner, rv, pxs, n=1, depth_px=0.8, span_px=(3.5 * T / 16.0, 6.0 * T / 16.0)) * S1.pxu
        Hs.append((base + W * (Hv - base)).astype(np.float32))

    def tone(S, Vp, off):
        idx, _ = tone_and_clean(Vp, CLIFF_FACE_TONES, 1.7, 4.0, passes=2, off=off)
        return idx
    return Field("cliff_face", T, ss, Hs, dict(reach_px=2.2, ao_px=1.2, ao_k=0.6, shadow_k=0.8), tone), None


# -- stone wall: masonry seen from the front, one tile tall -----------------------------------------------------------------------
WALL_TONES = [24, 25, 26, 27]


def masonry(S1, seed, plinth=False, cracks=0, chips=3, brick_len=8.0, course_h=4.0, joint_px=0.9, jitter=0.0):
    """One tile of running bond masonry, periodic in x (and in y when there is no plinth): courses `course_h` pixels tall (scaled for
    the tile size), bricks `brick_len` long, every second course shifted by half a brick. The joints that lie near the tile border sit
    at fixed places (so any tile can stand beside any tile); the ones in the middle of the tile may be moved by up to `jitter` pixels
    (brick lengths then vary from 6 to 10). Bricks are chamfered (lit on the upper left edge, shaded on the lower right) with a joint
    between. With `plinth` the last course is a long footing block that sticks out. Height in world units."""
    T, ss, pxu = S1.T, S1.ss, S1.pxu
    n = T * ss
    kk = T / 16.0
    pxs = float(ss)
    L, ch, j = brick_len * kk, course_h * kk, joint_px * kk ** 0.6
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) * (T / float(n))
    course = np.floor(yy / ch).astype(np.int32)
    n_courses = int(round(T / ch))
    rj = np.random.RandomState(seed + 31)
    shared = np.random.RandomState(9001)
    hoff = shared.normal(0, 0.10, (n_courses, 8)).astype(np.float32)
    tilt = shared.normal(0, 0.03, (n_courses, 8, 2)).astype(np.float32)
    sd = np.full((n, n), 1e3, np.float32)
    H = np.zeros((n, n), np.float32)
    dy = yy - (course + 0.5) * ch
    sdy = ch / 2.0 - np.abs(dy)
    nb = max(1, int(round(T / L)))
    for c in range(n_courses):
        joints = []
        for i in range(nb):
            x = i * L + (L / 2.0 if c % 2 else 0.0)
            if jitter and min(x % T, T - (x % T)) > 3.6 * kk:
                x += rj.uniform(-1.0, 1.0) * jitter * kk
            joints.append(x % T)
        joints = np.sort(np.asarray(joints, np.float32))
        ext = np.concatenate([[joints[-1] - T], joints, [joints[0] + T]])
        idx = np.clip(np.searchsorted(ext, xx, side="right") - 1, 0, len(joints))
        left, right = ext[idx], ext[idx + 1]
        sdx = np.minimum(xx - left, right - xx)
        dxc = xx - (left + right) / 2.0
        row = course == c
        sd = np.where(row, np.minimum(sdx, sdy) - j * 0.5, sd)
        bh = hoff[c, idx % 8] + tilt[c, idx % 8, 0] * dxc + tilt[c, idx % 8, 1] * dy
        H = np.where(row, bh, H)
    H = H + block_profile(sd, 0.9 * kk ** 0.6, 0.55 * kk ** 0.6, j, 1.2 * kk ** 0.6)
    rng = np.random.RandomState(seed)
    if plinth:
        y0 = T - ch
        foot = yy >= y0
        sdp = np.minimum(yy - y0, (T - yy)) - j * 0.5
        sdx = (T - 1.0 * kk ** 0.6) / 2.0 - np.abs(xx - T / 2.0)       # one long block per tile, joint at the tile border
        sdf = np.minimum(sdp, sdx)
        foot_h = block_profile(sdf, 0.8 * kk ** 0.6, 0.45 * kk ** 0.6, j, 1.2 * kk ** 0.6) + 0.9 * kk ** 0.6
        H = np.where(foot, foot_h, H)
    if chips or cracks:
        bd = border_dist(T, ss)
        inner = (bd > detail_margin(T) + 1.5) & (sd > 0.9)
        tys, txs = np.nonzero(inner)
        Y, X = np.mgrid[0:n, 0:n].astype(np.float32)
        for _ in range(chips):
            if not len(tys):
                break
            q = rng.randint(len(tys))
            cy, cx = tys[q] / pxs, txs[q] / pxs
            rr = rng.uniform(1.4, 2.0) * kk ** 0.5
            d2 = (Y / pxs - cy) ** 2 + (X / pxs - cx) ** 2
            H = H - 0.7 * kk ** 0.6 * np.clip(1.0 - d2 / (rr * rr), 0.0, 1.0) * inner
        if cracks:
            H = carve_cracks(H, inner, rng, pxs, n=cracks, depth_px=0.9, span_px=(4.0 * kk ** 0.7, 7.0 * kk ** 0.7))
    return (H * pxu).astype(np.float32)


def build_wall(st, T, ss, report):
    """Wall faces a, b, c (stone_wall, _b, _c) sharing one masonry layout, differing by chips and cracks inside the tile, and the
    base course (wall_stone_base): the same masonry with a footing block along the bottom. Returns the Field (variants a, b, c and
    the base tile as the fourth) for the faces; the cap is built separately."""
    S1 = Surf(st, T, ss, 1, 1)
    b = detail_margin(T)
    W = fade(T, ss, b)
    base = masonry(S1, 801, chips=0)
    Hs = []
    for v, (chips, cracks) in enumerate(((3, 0), (2, 1), (4, 0))):
        Hv = masonry(S1, 810 + 5 * v, chips=chips, cracks=cracks, jitter=1.7)
        Hs.append((base + W * (Hv - base)).astype(np.float32))
    Hs.append(Hs[0])                                  # the module's fourth place is a plain face again: the footing is lit in its own module

    def tone(S, Vp, off):
        idx, _ = tone_and_clean(Vp, WALL_TONES, 1.8, 4.4, passes=2, off=off)
        return idx
    kw = dict(reach_px=2.2, ao_px=1.0, ao_k=0.45, shadow_k=0.8)
    plinth = masonry(S1, 801, plinth=True, chips=0)
    # the base course: footing on top of plain faces, so the footing's top edge sees the face above it and its sides see more footing
    base_field = Field("wall_base", T, ss, [plinth, plinth, Hs[0], Hs[0]], kw, tone)
    return Field("wall", T, ss, Hs, kw, tone), base_field


# -- wall cap ----------------------------------------------------------------------------------------------------------------------
CAP_TONES = [24, 26, 27, 32]


def build_cap(st, T, ss, report):
    """wall_stone_top: one cap block per tile with a pixel wide joint on its right and lower edge (so a run of caps is a row of blocks and
    the row under it reads as a dark line above the wall face), chamfered, domed, mottled and chipped, lit from the upper left. The
    heights are env_lit's cap heights (the pack's cap tops are flat). The joints are at fixed places, so a row of caps is seamless."""
    S1 = Surf(st, T, ss, 1, 1)
    H, sd, body = cap_heights(S1, 31, crack=False, chip=True, mottle_px=0.20, joint_px=1.0 * (T / 16.0) ** 0.6, deep_px=1.2)
    Vp, m = S1.light(H, reach_px=2.0, ao_px=1.0, ao_k=0.3, wrap=False, low=-1.5 * S1.pxu)
    idx, _ = tone_and_clean(Vp, CAP_TONES, 2.0, 3.0, passes=1)
    return idx[m:m + T, m:m + T]


# -- stone decals: a crack across a cobble, a drain ----------------------------------------------------------------------------------
def build_stone_decals(st, T, ss, stone_field, report):
    """floor_stone_cracked and floor_stone_drain. Both are the plain cobble tile (variant a of the stone) with one event in the middle
    of the tile, well inside the border, so they sit among the other cobbles like any variant: a split that runs across the diamond
    and into the octagons beside it, and a recessed grate with a dark opening, made with the proportions of the KayKit
    floor_tile_grate (a frame, then bars about a third as wide as the openings between them)."""
    n = T * ss
    pxs = float(ss)
    kk = T / 16.0
    S1 = Surf(st, T, ss, 1, 1)
    pxu = S1.pxu
    base = stone_field.Hs[0]
    bd = border_dist(T, ss)
    inner = bd > detail_margin(T) + 0.6
    rng = np.random.RandomState(1203)
    # the crack: a long zigzag through the middle, wide and deep enough to survive as a line of pixels
    Hc = base
    crack = crack_marks(T, ss, rng, 1, (4.0, 5.0), segs=3, dark=24, lit=27, start=(T * 0.26, T * 0.22), ang0=0.75, width_px=0.95, margin=2.2)
    # the grate: a rectangle well inside the tile
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) / pxs
    rw, rh = 8.0 * kk, 6.0 * kk
    ry0, rx0 = (T - rh) / 2.0 + 0.5 * kk, (T - rw) / 2.0
    ry1, rx1 = ry0 + rh, rx0 + rw
    sdr = np.minimum(np.minimum(yy - ry0, ry1 - yy), np.minimum(xx - rx0, rx1 - xx))
    frame_w = 1.4 * kk ** 0.8
    inside = sdr >= 0
    opening = sdr >= frame_w
    bars = np.zeros((n, n), bool)
    period = 2.6 * kk
    bar_w = 0.9 * kk ** 0.8
    phase = ((xx - rx0 - frame_w - 0.4 * kk) % period)
    bars = (phase < bar_w) & opening
    holes = opening & ~bars
    recess = np.where(inside, -0.9 * kk ** 0.6, 0.0) + np.where(holes, -1.4 * kk ** 0.6, 0.0) + np.where(bars, 0.35 * kk ** 0.6, 0.0)
    Hd = base + (recess * pxu).astype(np.float32)
    Hs = [Hc.astype(np.float32), Hd.astype(np.float32), base, stone_field.Hs[1]]

    def tone(S, Vp, off):
        idx, _ = tone_and_clean(Vp, STONE_TONES, 2.0, 5.0, passes=1, off=off)
        return idx
    f = Field("stone_decals", T, ss, Hs, stone_field.light_kw, tone, None, [crack, None, None, None])
    tiles = f.tiles(st)
    cracked = tiles[0]
    drain = tiles[1].copy()
    # the deep openings of the grate are near black; the frame keeps its lit rim
    op_px = to_pixels(holes.astype(np.float32), T, T, ss) > 0.55
    drain[op_px] = 0
    return cracked, drain, f


# ===========================================================================================================================
# Edge tiles: the game's own masks (scripts/assets/fantasy.ts), a lit bank
# ===========================================================================================================================
EDGE_BITE = [1, 2, 3, 4, 5, 5, 4, 3, 2, 2, 3, 3, 2, 1, 1, 1]             # how far the under material eats in, per column along the edge
TURF_SPILL = [2, 1, 3, 1, 2, 0, 2, 3, 1, 2, 1, 3, 0, 2, 1, 2]              # how far turf spills past the cut, per column
FOAM_SCALLOP = [0, 1, 2, 2, 2, 1, 0, 0]                                     # the foam lip's 8 px scallop
ORTHO_VARIANTS = [("n", "n"), ("e", "e"), ("s", "s"), ("w", "w"), ("ne", "ne"), ("nw", "nw"), ("se", "se"), ("sw", "sw"), ("ns", "ns"), ("ew", "ew"),
                  ("nes", "nes"), ("wne", "wne"), ("swn", "swn"), ("esw", "esw"), ("nesw", "nesw")]
INNER_VARIANTS = ("inw", "ine", "isw", "ise")

EDGE_RAMPS = {
    "grass": [9, 16, 17, 18, 19],
    "pale": [16, 17, 18, 19, 38],
    "water": [12, 20, 21, 22, 23],
    "stone": [0, 24, 25, 26, 27],
    "sand": [28, 29, 30, 31, 3],
    "dirt": [1, 28, 29, 30, 31],
    "cliff": [24, 25, 26, 27, 32],
}


def bite_at(a, T):
    """EDGE_BITE scaled to a tile of T pixels and sampled at pixel `a` along the edge (any integer, periodic). At 16 px this is exactly
    the game's table; at 32 px it is the same profile, stretched and interpolated."""
    k = T // 16
    if k == 1:
        return np.asarray(EDGE_BITE, np.float32)[np.asarray(a) % 16]
    u = (np.asarray(a, np.float32) % T + 0.5) / k - 0.5
    i0 = np.floor(u).astype(np.int64)
    f = u - i0
    tab = np.asarray(EDGE_BITE, np.float32)
    return k * (tab[i0 % 16] * (1 - f) + tab[(i0 + 1) % 16] * f)


def ortho_mask(sides, T, ext=0):
    """The game's orthoMask for a tile of T pixels, over the tile and `ext` pixels around it (the pattern is periodic along each edge
    and runs on beyond the tile across the side where the neighbour is the under material)."""
    lo, hi = -ext, T + ext
    ys, xs = np.mgrid[lo:hi, lo:hi]
    m = np.zeros(ys.shape, bool)
    for side in sides:
        depth = ys if side == "n" else (T - 1 - ys) if side == "s" else xs if side == "w" else (T - 1 - xs)
        along = xs if side in ("n", "s") else ys
        m |= depth < bite_at(along, T)
    return m


def inner_mask(corner, T, ext=0):
    """The game's innerMask: only the diagonal neighbour is the under material, so it pokes into one corner."""
    lo, hi = -ext, T + ext
    ys, xs = np.mgrid[lo:hi, lo:hi]
    north, west = "n" in corner, "w" in corner
    dy = ys if north else (T - 1 - ys)
    dx = xs if west else (T - 1 - xs)
    inside = (dy >= 0) & (dx >= 0) & (dy < T) & (dx < T)
    a = np.where(inside, bite_at(np.clip(dy, 0, T - 1), T), 0)
    b = np.where(inside, bite_at(np.clip(dx, 0, T - 1), T), 0)
    m = (dx < a) & (dy < b) & inside
    # beyond the tile across a corner: the diagonal tile itself is all under material
    beyond_y = (ys < 0) if north else (ys >= T)
    beyond_x = (xs < 0) if west else (xs >= T)
    m |= beyond_y & beyond_x
    return m


def edge_context_mask(suffix, T):
    """The eaten mask of one edge tile, on a 3 x 3 tile context (3T square), so the bank can be shaded across the tile border with the
    right neighbours: a neighbour that is the under material is all eaten, one that is the over material runs on with the pattern of
    the sides it touches. Returns (context mask, centre mask)."""
    inner = suffix.startswith("i")
    sides = set(suffix) if not inner else set()
    under = {(r, c): False for r in range(3) for c in range(3)}
    if not inner:
        for s, (r, c) in (("n", (0, 1)), ("s", (2, 1)), ("w", (1, 0)), ("e", (1, 2))):
            under[(r, c)] = s in sides
        for (r, c), (a, b) in (((0, 0), ("n", "w")), ((0, 2), ("n", "e")), ((2, 0), ("s", "w")), ((2, 2), ("s", "e"))):
            under[(r, c)] = (a in sides) and (b in sides)
    else:
        under[{"inw": (0, 0), "ine": (0, 2), "isw": (2, 0), "ise": (2, 2)}[suffix]] = True
    big = np.zeros((3 * T, 3 * T), bool)
    for r in range(3):
        for c in range(3):
            if (r, c) == (1, 1):
                m = inner_mask(suffix, T) if inner else ortho_mask(sorted(sides), T)
            elif under[(r, c)]:
                m = np.ones((T, T), bool)
            else:
                ss_ = []
                for s, (dr, dc) in (("n", (-1, 0)), ("s", (1, 0)), ("w", (0, -1)), ("e", (0, 1))):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < 3 and 0 <= cc < 3 and under[(rr, cc)]:
                        ss_.append(s)
                m = ortho_mask(ss_, T) if ss_ else np.zeros((T, T), bool)
            big[r * T:(r + 1) * T, c * T:(c + 1) * T] = m
    return big, big[T:2 * T, T:2 * T].copy()


def bfs_dist(src, limit, allowed=None):
    """4-connected distance (1 = adjacent) from the True pixels of `src`, to pixels where `allowed`, up to `limit`; 0 elsewhere."""
    d = np.zeros(src.shape, np.int32)
    frontier = src.copy()
    seen = src.copy()
    for step in range(1, limit + 1):
        nxt = dilate4(frontier) & ~seen
        if allowed is not None:
            nxt &= allowed
        d[nxt] = step
        seen |= nxt
        frontier = nxt
        if not nxt.any():
            break
    return d


def along_field(E, T):
    """For every pixel within a few pixels of the boundary of E, the coordinate that runs along the nearest piece of boundary (x on a
    horizontal run, y on a vertical one), taken from the nearest boundary pixel. Others get x."""
    h, w = E.shape
    ys, xs = np.mgrid[0:h, 0:w]
    up = shift(E, -1, 0, False) != E
    dn = shift(E, 1, 0, False) != E
    lf = shift(E, 0, -1, False) != E
    rt = shift(E, 0, 1, False) != E
    horiz = up | dn
    vert = (lf | rt) & ~horiz
    bnd = horiz | vert
    al = np.where(horiz, xs, np.where(vert, ys, -1)).astype(np.int32)
    for _ in range(6):
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nb = shift(al, dy, dx, -1)
            al = np.where(al < 0, nb, al)
    return np.where(al < 0, xs, al)


def facing(M_high, r):
    """For each pixel: how much the bank there faces the key light, +1 toward it, -1 away. The bank slopes from the higher material
    (mask M_high) to the lower one, so its normal points away from the higher region; a normal toward the upper left faces the light."""
    f = box_blur(box_blur(M_high.astype(np.float32), r), max(1, r - 1))
    gx = shift(f, 0, 1, 0.0) - shift(f, 0, -1, 0.0)
    gy = shift(f, 1, 0, 0.0) - shift(f, -1, 0, 0.0)
    mag = np.sqrt(gx * gx + gy * gy) + 1e-6
    return np.where(mag > 0.02, 0.7071 * (gx + gy) / mag, 0.0)


def edge_tile(over, under, suffix, T, recipe):
    """One edge tile. over, under: (T, T) base tiles. recipe: dict(over_cls, under_cls, raised (is the over material the higher one),
    spill (over material spills onto the under material like turf), foam (over material is water with a foam lip), skirt (dark
    footing under the higher material), wet (the lower material darkens at the foot), soft (same material, two shades: blend)).
    Returns the (T, T) uint8 tile."""
    k = T // 16
    Eext, Ec = edge_context_mask(suffix, T)
    O = np.tile(over, (3, 3))
    U = np.tile(under, (3, 3))
    out = np.where(Eext, U, O)
    ro, ru = EDGE_RAMPS[recipe["over_cls"]], EDGE_RAMPS[recipe["under_cls"]]
    H_ = Eext.shape[0]
    if recipe.get("soft"):
        return soft_blend(O, U, Eext, Ec, T)
    raised = recipe["raised"]
    M_high = ~Eext if raised else Eext
    fc = facing(M_high, 2 * k)
    lit, dark = fc > 0.35, fc < -0.35
    d_over = bfs_dist(Eext, 3 * k, ~Eext)                 # over pixels, 1 = touching the under material
    d_under = bfs_dist(~Eext, 3 * k, Eext)                # under pixels, 1 = touching the over material
    al = along_field(Eext, T)
    a16 = (al // k) % 16
    hi_d, lo_d = (d_over, d_under) if raised else (d_under, d_over)
    hi_ramp, lo_ramp = (ro, ru) if raised else (ru, ro)
    hi_is_over = raised
    # spill (turf over the cut), before the bank is shaded
    if recipe.get("spill"):
        spill = np.asarray(TURF_SPILL, np.int32)[a16] * k
        sp = Eext & (d_under >= 1) & (d_under <= spill)
        grass_px = step_tone(O, ro, np.where(d_under > k, -1, 0))
        out = np.where(sp, grass_px, out)
    if recipe.get("foam"):
        scal = np.asarray(FOAM_SCALLOP, np.int32)[a16 % 8] * k
        fm = ~Eext & (d_over >= 1) & (d_over <= np.maximum(scal, k))
        out = np.where(fm & (d_over == 1), 23, out)
        out = np.where(fm & (d_over > 1) & (d_over <= scal), 22, out)
    # the bank: the higher material's rim is lit or shaded by which way it faces; the lower material in the shadow at its foot
    rim = (hi_d >= 1) & (hi_d <= k)
    rim2 = (hi_d > k) & (hi_d <= 2 * k)
    foot = (lo_d >= 1) & (lo_d <= 2 * k)
    hi_mask = (~Eext) if hi_is_over else Eext
    lo_mask = Eext if hi_is_over else ~Eext
    if recipe.get("foam"):
        rim = rim & ~(out == 23)
    if recipe.get("skirt"):
        # rock meeting ground: a dark footing under the lip wherever it is not full in the light, deeper where it faces away
        out = np.where(rim & hi_mask & ~lit, step_tone(out, hi_ramp, -1), out)
        out = np.where(rim2 & hi_mask & dark, step_tone(out, hi_ramp, -1), out)
    else:
        out = np.where(rim & hi_mask & lit, step_tone(out, hi_ramp, +1), out)
        out = np.where(rim & hi_mask & dark, step_tone(out, hi_ramp, -1), out)
        out = np.where(rim2 & hi_mask & dark, step_tone(out, hi_ramp, -1), out)
    # the lower material at the foot of the bank is in its shade: always a step darker, two where the bank faces away from the light
    foot_dark = foot & lo_mask & (dark | (lo_d <= k) | bool(recipe.get("wet")))
    out = np.where(foot_dark, step_tone(out, lo_ramp, -1), out)
    out = np.where(foot & lo_mask & dark & (lo_d <= k), step_tone(out, lo_ramp, -1), out)
    return out[T:2 * T, T:2 * T].astype(np.uint8)


def soft_blend(O, U, Eext, Ec, T):
    """Pale grass into grass (and the like): one material at two shades, so no bank and no outline, only the two patterns interleaving
    across a band a few pixels wide, in clusters."""
    k = T // 16
    d_over = bfs_dist(Eext, 4 * k, ~Eext)
    d_under = bfs_dist(~Eext, 4 * k, Eext)
    nz = np.tile(periodic_noise(T, 77), (3, 3)) + 0.5              # 0..1, periodic
    nz2 = np.tile(periodic_noise(T, 78), (3, 3)) + 0.5
    mix = 0.5 * nz + 0.5 * nz2
    out = np.where(Eext, U, O)
    # over pixels near the cut take the under pattern sometimes, under pixels near the cut take the over pattern sometimes
    p_over = np.where(d_over > 0, np.clip(0.62 - 0.17 * (d_over - 1) / k, 0.0, 1.0), 0.0)
    p_under = np.where(d_under > 0, np.clip(0.62 - 0.17 * (d_under - 1) / k, 0.0, 1.0), 0.0)
    out = np.where((d_over > 0) & (mix < p_over), U, out)
    out = np.where((d_under > 0) & (mix < p_under), O, out)
    return out[T:2 * T, T:2 * T].astype(np.uint8)


# family: prefix, over material, under material, recipe (the game's EDGE_PAIRS, with the physical model of which one is higher)
EDGE_FAMILIES = [
    ("floor_grass_edge_", "grass", "stone", dict(over_cls="grass", under_cls="stone", raised=True, spill=False, wet=True)),
    ("floor_grass_edge_dirt_", "grass", "dirt", dict(over_cls="grass", under_cls="dirt", raised=True, spill=True, wet=True)),
    ("floor_grass_edge_sand_", "grass", "sand", dict(over_cls="grass", under_cls="sand", raised=True, spill=True, wet=True)),
    ("floor_stone_edge_grass_", "stone", "grass", dict(over_cls="stone", under_cls="grass", raised=True, skirt=True)),
    ("floor_stone_edge_water_", "stone", "water", dict(over_cls="stone", under_cls="water", raised=True, skirt=True, wet=True)),
    ("water_edge_", "water", "stone", dict(over_cls="water", under_cls="stone", raised=False, foam=True)),
    ("water_edge_grass_", "water", "grass", dict(over_cls="water", under_cls="grass", raised=False, foam=True)),
    ("water_edge_sand_", "water", "sand", dict(over_cls="water", under_cls="sand", raised=False, foam=True)),
    ("cliff_edge_", "cliff_top", "grass", dict(over_cls="cliff", under_cls="grass", raised=True, skirt=True)),
    ("floor_grass_pale_edge_", "pale", "grass", dict(over_cls="pale", under_cls="grass", raised=False, soft=True)),
]


def build_edges(T, base):
    """All 10 families x 19 shapes. base: dict of the base tiles by material name (grass, pale, stone, dirt, sand, water, cliff_top), each
    the (T, T) array of variant a. Returns {assetId: (T, T) uint8}."""
    out = {}
    for prefix, over_m, under_m, recipe in EDGE_FAMILIES:
        over, under = base[over_m], base[under_m]
        for suffix in [s for s, _ in ORTHO_VARIANTS] + list(INNER_VARIANTS):
            out[prefix + suffix] = edge_tile(over, under, suffix, T, recipe)
    return out


# ===========================================================================================================================
# Packaging: asset ids, the part files, checks
# ===========================================================================================================================
def variant_ids(base):
    return [base, base + "_b", base + "_c", base + "_d"]


MATERIAL_IDS = {
    "grass": variant_ids("floor_grass"),
    "pale": variant_ids("floor_grass_pale"),
    "dirt": variant_ids("floor_dirt"),
    "sand": variant_ids("floor_sand"),
    "stone": variant_ids("floor_stone"),
    "water": variant_ids("water"),
    "canopy": variant_ids("forest_canopy"),
    "cliff_top": variant_ids("cliff_top"),
    "cliff_face": variant_ids("cliff_face"),
    "wall": ["wall_stone", "wall_stone_b", "wall_stone_c"],
}
BUILDERS = {
    "grass": build_grass, "pale": build_pale, "dirt": build_dirt, "sand": build_sand, "stone": build_stone, "water": build_water,
    "canopy": build_canopy, "cliff_top": build_cliff_top, "cliff_face": build_cliff_face, "wall": build_wall,
}
ORDER = ["stone", "grass", "pale", "dirt", "sand", "water", "canopy", "cliff_top", "cliff_face", "wall"]


def isolated(a):
    """Share of pixels that differ from all four neighbours (a wrapped tile)."""
    nb = [np.roll(a, 1, 0), np.roll(a, -1, 0), np.roll(a, 1, 1), np.roll(a, -1, 1)]
    return round(float(((a != nb[0]) & (a != nb[1]) & (a != nb[2]) & (a != nb[3])).mean()), 4)


def build_size(st, T, ss, only, edges, report):
    """Every tile of one size. Returns {assetId: (T, T) uint8}."""
    tiles = {}
    t0 = time.time()
    fields = {}
    for name in ORDER:
        if only and name not in only:
            continue
        t1 = time.time()
        field, _extra = BUILDERS[name](st, T, ss, report)
        four = field.tiles(st)
        for aid, t in zip(MATERIAL_IDS[name], four):
            tiles[aid] = t
        fields[name] = field
        use = (0, 1, 2, 3)
        if name == "wall":
            tiles["wall_stone_base"] = _extra.tiles(st)[0]
        seam = field.seam_check(st, four, use=use)
        report.setdefault("seams", {})[name] = {"mismatchShare": seam[0], "borderBandMismatchShare": seam[1], "worstTileMismatchPixels": seam[2]}
        report.setdefault("isolatedPixelShare", {})[name] = round(float(np.mean([isolated(t) for t in four])), 4)
        report.setdefault("seconds", {})[name] = round(time.time() - t1, 1)
        log(T, name, "done %.1fs" % (time.time() - t1), "seam", seam)
    if not only or "stone" in only:
        cracked, drain, _f = build_stone_decals(st, T, ss, fields["stone"], report)
        tiles["floor_stone_cracked"], tiles["floor_stone_drain"] = cracked, drain
    if not only or "grass" in only:
        gd, heads = build_grass_decals(st, T, ss, report)
        gt = gd.tiles(st)
        tiles["floor_grass_tufted"] = gt[0]
        tiles["floor_grass_flowers"] = stamp_flowers(gt[1], heads, T)
    if not only or "wall" in only:
        tiles["wall_stone_top"] = build_cap(st, T, ss, report)
    if edges:
        t1 = time.time()
        base = {"grass": tiles["floor_grass"], "pale": tiles["floor_grass_pale"], "stone": tiles["floor_stone"], "dirt": tiles["floor_dirt"],
                "sand": tiles["floor_sand"], "water": tiles["water"], "cliff_top": tiles["cliff_top"]}
        tiles.update(build_edges(T, base))
        report["seconds"]["edges"] = round(time.time() - t1, 1)
        log(T, "edges done %.1fs" % (time.time() - t1))
    report["seconds"]["total"] = round(time.time() - t0, 1)
    return tiles


def write_part(T, tiles, targets, path):
    """The part file: one sprite per in-scope target that has a tile, the rest listed as gaps."""
    sprites, gaps = [], []
    for t in targets:
        if t["group"] not in ("ground", "wall", "edge"):
            continue
        if t.get("outOfPlay"):
            continue
        aid = t["assetId"]
        if aid in tiles:
            a = tiles[aid]
            assert a.shape == (t["h16"] * T // 16, t["w16"] * T // 16), (aid, a.shape)
            assert int(a.max()) < USABLE, (aid, int(a.max()))
            sprites.append({"assetId": aid, "kind": t["kind"], "name": t["name"], "walkable": t["walkable"], "pixels": [[int(v) for v in row] for row in a]})
        else:
            gaps.append({"assetId": aid, "reason": "not built in this run"})
    doc = {"maker": MAKER, "size": T, "style": STYLE, "sprites": sprites, "gaps": gaps}
    with open(path, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return len(sprites), len(gaps)


def main():
    global PAL
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    sizes = [int(x) for x in (argv[argv.index("--sizes") + 1] if "--sizes" in argv else "16,32").split(",")]
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    edges = "--no-edges" not in argv and only is None
    scratch_only = "--scratch-only" in argv
    os.makedirs(SCRATCH, exist_ok=True)
    os.makedirs(PARTS_DIR, exist_ok=True)
    for need in (GLTF, HEX, PALETTE_JSON, TARGETS_JSON):
        if not os.path.exists(need):
            raise SystemExit("lib_ground_lit: missing %s" % need)
    with open(TARGETS_JSON) as fh:
        targets = json.load(fh)["targets"]
    t_all = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PAL = Pal()
    lib = Library()
    lib.load("floor_tile_small")
    st = Stage(lib, PAL)
    report = {"sizes": {}}
    for T in sizes:
        ss = 8 if T <= 16 else 6
        rep = {}
        tiles = build_size(st, T, ss, only, edges, rep)
        rep["paletteOk"] = bool(all(int(a.max()) < USABLE for a in tiles.values()))
        report["sizes"][str(T)] = rep
        if not scratch_only:
            path = os.path.join(PARTS_DIR, "%s-%d.json" % (MAKER, T)) if not only else os.path.join(SCRATCH, "partial-%d.json" % T)
            n, g = write_part(T, tiles, targets, path)
            log(T, "wrote", path, n, "sprites", g, "gaps")
        np.savez_compressed(os.path.join(SCRATCH, "tiles-%d.npz" % T), **tiles)
    report["totalSeconds"] = round(time.time() - t_all, 1)
    report["totalRenders"] = RENDERS[0]
    with open(os.path.join(SCRATCH, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    try:
        os.remove(TMP_PNG)
    except OSError:
        pass
    log("done in %.1fs, %d renders" % (time.time() - t_all, RENDERS[0]))


if __name__ == "__main__":
    main()
