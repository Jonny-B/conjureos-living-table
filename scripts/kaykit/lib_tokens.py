"""
KayKit library maker: tokens, gear overlays and accessory icons.

Builds the game's character tokens (8 in play), the equipment OVERLAYS drawn on
them (weapon, outer, crown, boots per archetype) and the ring / amulet icons
from the FREE KayKit packs (CC0, Kay Lousberg), in every conversion style the
harness knows (plain, bands, toon, pixelart), at 16 and 32 px.

Run from the repo root (Blender 5.2 headless). One process per style:

  blender -b --factory-startup --python scripts/kaykit/lib_tokens.py -- render --style plain
  blender -b --factory-startup --python scripts/kaykit/lib_tokens.py -- render --style toon --scenes knight,rogue
  blender -b --factory-startup --python scripts/kaykit/lib_tokens.py -- preview --scenes knight     (hi-res look at the 3D parts)
  python scripts/kaykit/lib_tokens.py assemble [--gap-goblin]                                (raw renders -> parts JSON)

Outputs: .cache/kaykit/library/parts/tokens-<style>-<size>.json (validate with
scripts/kaykit/check-part.mjs), scratch under .cache/kaykit/scratch/tokens/.

HOW A CHARACTER IS BUILT
  * One scene per archetype. The main glb is posed ONCE (a fixed front-facing
    pose), then every mesh that will ever be shown (body parts, gear, donor
    meshes cloned onto the main rig from other glbs) is BAKED to a static
    world-space mesh and the rigs are deleted. After that, all edits (scale a
    hat, recolour a swatch, cut a boot out of a leg) are plain world-space mesh
    edits and the style modules see only static meshes.
  * One fixed orthographic camera per archetype and size, framed so the body
    plus its widest gear fits the 16 px token box; body and every gear piece
    share it, so they register pixel-exact.
  * BODY token = the body meshes only. A front GEAR overlay is rendered as
    "body with this piece" (B) against "body" (A): its pixels are B wherever a
    Workbench object-colour pass says the piece is the nearest surface, or B
    differs from A right next to it (the piece's own outline). So body + overlay
    is exactly B, and the overlay holds only what is visible over the body.
    A BEHIND piece (a cloak, drawn before the body in the game) is rendered
    alone, whole, because the body covers it anyway.
  * Base-tier metal pieces are quantised onto the game's GEAR_RAMP (5, 8, 32,
    33) so the uncommon recolour bites; cloth and leather pieces are kept off
    those four indices so it does not recolour them.
"""
import importlib.util
import json
import math
import os
import re
import sys
import time

try:
    import bpy
    import bmesh
    import numpy as np
    from mathutils import Matrix, Vector
    IN_BLENDER = True
except ImportError:  # the assemble step needs none of it
    IN_BLENDER = False

ROOT = os.getcwd()
KK = os.path.join(ROOT, ".cache", "kaykit")
ADV = os.path.join(KK, "adventurers", "addons", "kaykit_character_pack_adventures")
SKE = os.path.join(KK, "skeletons", "addons", "kaykit_character_pack_skeletons")
DUN = os.path.join(KK, "dungeon", "addons", "kaykit_dungeon_remastered")
PRO = os.path.join(KK, "prototype", "addons", "kaykit_prototype_bits")
TARGETS_JSON = os.path.join(KK, "library", "targets.json")
PALETTE_JSON = os.path.join(KK, "palette-fantasy.json")
SCRATCH = os.path.join(KK, "scratch", "tokens")
RAW_DIR = os.path.join(SCRATCH, "raw")
PARTS_DIR = os.path.join(KK, "library", "parts")
MAKER = "tokens"
STYLES = ["plain", "bands", "toon", "pixelart"]
SIZES = [16, 32]

TRANSPARENT = 255

# The game's gear ramp (brightest to darkest) and what the uncommon remap makes of it.
GEAR_RAMP = (5, 8, 32, 33)
# Cool steel-ish palette entries: what the styles emit for KayKit metal.
STEELISH = (5, 7, 8, 14, 20, 21, 22, 23, 24, 25, 26, 27, 32, 33, 40, 41)
# Where non-metal pieces send an accidental ramp index, so the uncommon remap cannot brass a cloak.
OFF_RAMP = {8: 23, 32: 40, 33: 41}


def L709(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def strip_suffix(name):
    return re.sub(r"\.\d{3}$", "", name)


# ---------------------------------------------------------------------------
# Stage: one posed main rig, donors, baked static meshes
# ---------------------------------------------------------------------------

UV_COLS, UV_ROWS = 8, 4   # every KayKit character / asset atlas is 8 x 4 swatches


class Stage:
    """Imports a main glb, poses it, clones donor meshes onto its rig, bakes everything static."""

    def __init__(self, H, main_glb, pose):
        self.H = H
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        r = self.scene.render
        r.film_transparent = True
        r.image_settings.file_format = "PNG"
        r.image_settings.color_mode = "RGBA"
        r.image_settings.color_depth = "8"
        self.scene.view_settings.view_transform = "Standard"
        self.scene.view_settings.look = "None"
        r.fps = 24
        self.donors = {}          # glb path -> {name: obj}
        self.static = {}          # key -> baked static object
        self.verts = {}           # key -> (n, 3) world vertices
        self.main_objs, self.rig = {}, None
        if main_glb:
            self.main_objs = self._import(main_glb)
            self.rig = next(o for o in self.main_objs.values() if o.type == "ARMATURE")
            self._pose(pose)

    # -- import ---------------------------------------------------------------
    def _import(self, path):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        for o in new:
            o.hide_render = True
        return {strip_suffix(o.name): o for o in new}

    def donor(self, path):
        if path not in self.donors:
            self.donors[path] = self._import(path)
        return self.donors[path]

    # -- pose -----------------------------------------------------------------
    def _pose(self, pose):
        rig = self.rig
        ad = rig.animation_data or rig.animation_data_create()
        for tr in ad.nla_tracks:
            tr.mute = True
        act = bpy.data.actions[pose["action"]]
        ad.action = act
        if getattr(act, "slots", None) and len(act.slots) > 0 and hasattr(ad, "action_slot"):
            ad.action_slot = act.slots[0]
        a, b = act.frame_range
        t = a + (b - a) * pose.get("frac", 0.0)
        whole = math.floor(t)
        self.scene.frame_set(int(whole), subframe=float(t - whole))
        bpy.context.view_layer.update()

    def bone_world(self, bone_name):
        pb = self.rig.pose.bones[bone_name]
        return self.rig.matrix_world @ pb.head, self.rig.matrix_world @ pb.tail

    # -- cloning ---------------------------------------------------------------
    def _link(self, o):
        self.scene.collection.objects.link(o)
        o.hide_render = False
        return o

    def clone(self, src, key):
        """Copy a mesh object (from the main glb or a donor) onto the MAIN rig, same bone or same skin."""
        o = src.copy()
        o.data = src.data.copy()
        o.name = key
        self._link(o)
        if src.parent_type == "BONE":
            o.parent = self.rig
            o.parent_type = "BONE"
            o.parent_bone = src.parent_bone
            o.matrix_parent_inverse = src.matrix_parent_inverse.copy()
        else:
            o.parent = self.rig
            o.parent_type = "OBJECT"
            o.matrix_parent_inverse = src.matrix_parent_inverse.copy()
            for m in o.modifiers:
                if m.type == "ARMATURE":
                    m.object = self.rig
        return o

    def clone_like(self, asset_glb, like, key):
        """A standalone asset mesh (a sword gltf) attached exactly like an existing object (same bone, same corrections)."""
        objs = self.donor(asset_glb)
        mesh_obj = next(o for o in objs.values() if o.type == "MESH")
        template = like if not isinstance(like, str) else self.main_objs[like]
        o = template.copy()
        o.data = mesh_obj.data.copy()
        o.name = key
        self._link(o)
        o.parent = self.rig
        return o

    # -- baking ----------------------------------------------------------------
    def bake(self, obj, key, hide=True):
        dg = bpy.context.evaluated_depsgraph_get()
        eo = obj.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(eo, preserve_all_data_layers=True, depsgraph=dg)
        me.transform(eo.matrix_world)
        new = bpy.data.objects.new(key, me)
        self.scene.collection.objects.link(new)
        new.hide_render = hide
        self.static[key] = new
        self._refresh_verts(key)
        return new

    def _refresh_verts(self, key):
        me = self.static[key].data
        n = len(me.vertices)
        arr = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", arr)
        self.verts[key] = arr.reshape(n, 3)

    def take(self, src, key):
        """clone onto the rig, bake, discard the clone. Returns the static object."""
        c = self.clone(src, key + "__tmp")
        bpy.context.view_layer.update()
        new = self.bake(c, key)
        bpy.data.objects.remove(c, do_unlink=True)
        return new

    def take_donor(self, glb, name, key):
        """Bake a donor object where it sits (no rig): props and icons."""
        return self.bake(self.donor(glb)[name], key)

    def take_like(self, asset_glb, like, key):
        c = self.clone_like(asset_glb, like, key + "__tmp")
        bpy.context.view_layer.update()
        new = self.bake(c, key)
        bpy.data.objects.remove(c, do_unlink=True)
        return new

    # -- static mesh edits (world space) --------------------------------------
    def transform(self, key, matrix):
        self.static[key].data.transform(matrix)
        self._refresh_verts(key)

    def scale_about(self, key, pivot, sx, sy=None, sz=None):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        p = Vector(pivot)
        m = Matrix.Translation(p) @ Matrix.Diagonal((sx, sy, sz, 1.0)) @ Matrix.Translation(-p)
        self.transform(key, m)

    def rotate_about(self, key, pivot, axis, degrees):
        p = Vector(pivot)
        m = Matrix.Translation(p) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-p)
        self.transform(key, m)

    def translate(self, key, offset):
        self.transform(key, Matrix.Translation(Vector(offset)))

    def uv_cell(self, key, cell, y_frac=0.38):
        """Flatten every face of a mesh onto one atlas swatch (cell = col + row * 8, row 0 at the top)."""
        me = self.static[key].data
        layer = me.uv_layers.active
        col, row = cell % UV_COLS, cell // UV_COLS
        u = (col + 0.5) / UV_COLS
        v = 1.0 - (row + y_frac) / UV_ROWS
        n = len(layer.data)
        arr = np.empty(n * 2, np.float32)
        arr[0::2] = u
        arr[1::2] = v
        layer.data.foreach_set("uv", arr)
        me.update()

    def uv_swap(self, key, mapping):
        """Move every loop whose UV sits in swatch `from` to the same spot in swatch `to`."""
        me = self.static[key].data
        layer = me.uv_layers.active
        n = len(layer.data)
        arr = np.empty(n * 2, np.float32)
        layer.data.foreach_get("uv", arr)
        uv = arr.reshape(n, 2)
        cx = np.clip(np.floor(uv[:, 0] * UV_COLS).astype(int), 0, UV_COLS - 1)
        cy = np.clip(np.floor((1.0 - uv[:, 1]) * UV_ROWS).astype(int), 0, UV_ROWS - 1)
        cell = cx + cy * UV_COLS
        for a, b in mapping.items():
            sel = cell == a
            if not sel.any():
                continue
            uv[sel, 0] += ((b % UV_COLS) - (a % UV_COLS)) / UV_COLS
            uv[sel, 1] -= ((b // UV_COLS) - (a // UV_COLS)) / UV_ROWS
        layer.data.foreach_set("uv", uv.reshape(-1))
        me.update()

    def cut(self, key, z, keep="below", cap=True):
        """Bisect a static mesh with the horizontal plane at world z and keep one side (the boot out of a leg)."""
        me = self.static[key].data
        bm = bmesh.new()
        bm.from_mesh(me)
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6,
                                     plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_outer=(keep == "below"),
                                     clear_inner=(keep != "below"))
        if cap:
            edges = [e for e in bm.edges if e.is_boundary]
            if edges:
                bmesh.ops.holes_fill(bm, edges=edges, sides=64)
        bm.to_mesh(me)
        bm.free()
        me.update()
        self._refresh_verts(key)

    def inflate(self, key, d):
        """Push every vertex out along its normal: a thin tube becomes a chunkier one."""
        me = self.static[key].data
        n = len(me.vertices)
        co = np.empty(n * 3)
        nr = np.empty(n * 3)
        me.vertices.foreach_get("co", co)
        me.vertices.foreach_get("normal", nr)
        me.vertices.foreach_set("co", co + nr * d)
        me.update()
        self._refresh_verts(key)

    def keep_islands(self, key, pred):
        """Keep only the loose parts whose vertex array satisfies pred(co (n,3))."""
        me = self.static[key].data
        bm = bmesh.new()
        bm.from_mesh(me)
        seen = set()
        drop = []
        for v in bm.verts:
            if v.index in seen:
                continue
            stack, comp = [v], []
            while stack:
                x = stack.pop()
                if x.index in seen:
                    continue
                seen.add(x.index)
                comp.append(x)
                for e in x.link_edges:
                    stack.append(e.other_vert(x))
            co = np.array([c.co[:] for c in comp])
            if not pred(co):
                drop.extend(comp)
        bmesh.ops.delete(bm, geom=drop, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        me.update()
        self._refresh_verts(key)

    def stretch_all(self, z_factor):
        """Stretch every baked mesh upward from the floor: a taller, slimmer chibi, so the figure can use the 16x24 box."""
        for key in list(self.static):
            self.transform(key, Matrix.Diagonal((1.0, 1.0, z_factor, 1.0)))

    # -- finish --------------------------------------------------------------
    def finish(self):
        """Delete the rigs and every donor; purge what nothing uses; one canonical image per texture."""
        for o in list(bpy.data.objects):
            if o.name not in self.static.keys() and o not in self.static.values():
                bpy.data.objects.remove(o, do_unlink=True)
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)
        canon = {}
        for m in bpy.data.materials:
            if not m.use_nodes:
                continue
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image is not None:
                    k = strip_suffix(n.image.name)
                    canon.setdefault(k, n.image)
                    n.image = canon[k]
        for _ in range(3):
            bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
        # remaining images, for the log
        self.images = sorted({i.name for i in bpy.data.images if i.users > 0 and i.name not in ("Render Result", "Viewer Node")})


# ---------------------------------------------------------------------------
# Camera and framing
# ---------------------------------------------------------------------------

class CenterFraming:
    """An icon: its own extents centred in the box, filling `fill` px of it."""

    def __init__(self, stage, keys, fill=14):
        lo_r, hi_r, lo_u, hi_u = extent_of(stage, keys)
        self.cx, self.cu = 0.5 * (lo_r + hi_r), 0.5 * (lo_u + hi_u)
        self.wpp16 = max(hi_r - lo_r, hi_u - lo_u) / fill
        self.fit = dict(w=(hi_r - lo_r) / self.wpp16, h=(hi_u - lo_u) / self.wpp16)

    def apply(self, ctx, size):
        k = size.token_w / 16.0
        wpp = self.wpp16 / k
        size.world_per_px = wpp
        r, u, f = ctx.H.camera_basis()
        ctx.camera.data.ortho_scale = size.canvas_h * wpp
        ctx.camera.location = r * self.cx + u * self.cu - f * 40.0
        ctx.size = size


def extent_of(stage, keys):
    H = stage.H
    r, u, f = H.camera_basis()
    R = np.array([r.x, r.y, r.z])
    U = np.array([u.x, u.y, u.z])
    lo_r, hi_r, lo_u, hi_u = 1e9, -1e9, 1e9, -1e9
    for k in keys:
        v = stage.verts[k]
        pr, pu = v @ R, v @ U
        lo_r, hi_r = min(lo_r, pr.min()), max(hi_r, pr.max())
        lo_u, hi_u = min(lo_u, pu.min()), max(hi_u, pu.max())
    return lo_r, hi_r, lo_u, hi_u


def make_camera(ctx):
    scene = ctx.scene
    cd = bpy.data.cameras.new("SpriteCam")
    cd.type = "ORTHO"
    cd.sensor_fit = "VERTICAL"
    cd.clip_start = 0.01
    cd.clip_end = 200.0
    cam = bpy.data.objects.new("SpriteCam", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.rotation_euler = (math.radians(90.0 - ctx.H.CAMERA_PITCH_DEG), 0.0, 0.0)
    ctx.camera = cam
    return cam


class Framing:
    """Where the camera sits for one archetype: same world framing for every piece, scaled per size."""

    def __init__(self, stage, body_keys, fit_keys, box_h, box_w=16, width_margin=2, feet_keys=None):
        b_lo_r, b_hi_r, b_lo_u, b_hi_u = extent_of(stage, feet_keys or body_keys)
        f_lo_r, f_hi_r, f_lo_u, f_hi_u = extent_of(stage, fit_keys)
        # centre the box on everything that must fit (a shield on one side and a sword on the other shift the
        # body off the middle by a pixel, which wastes less of the 16 px than centring the body would)
        self.cx = 0.5 * (f_lo_r + f_hi_r)
        self.min_u = b_lo_u
        half = 0.5 * (f_hi_r - f_lo_r)
        h_world = f_hi_u - b_lo_u
        self.wpp16 = max(h_world / (box_h - 1), 2.0 * half / (box_w - width_margin))
        self.fit = dict(w=2.0 * half / self.wpp16, h=h_world / self.wpp16)

    def apply(self, ctx, size):
        """size: harness.Size (canvas). Sets the camera for it. k = size.token_w / 16."""
        k = size.token_w / 16.0
        wpp = self.wpp16 / k
        size.world_per_px = wpp
        r, u, f = ctx.H.camera_basis()
        ctx.camera.data.ortho_scale = size.canvas_h * wpp
        cam_u = self.min_u + size.canvas_h / 2.0 * wpp
        ctx.camera.location = r * self.cx + u * cam_u - f * 40.0
        ctx.size = size


# ---------------------------------------------------------------------------
# Preview (hi-res look at the 3D parts, before any pixel conversion)
# ---------------------------------------------------------------------------

def _write_sheet(H, tiles, cols, path, bg=0.38):
    th, tw = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    out = np.zeros((rows * th, cols * tw, 4), np.float32)
    out[..., :3] = bg
    out[..., 3] = 1
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        a = t[..., 3:4]
        region = out[r * th:(r + 1) * th, c * tw:(c + 1) * tw]
        region[..., :3] = t[..., :3] * a + region[..., :3] * (1 - a)
    H.write_png(path, (np.clip(out, 0, 1) * 255).astype(np.uint8))


def preview_sets(ctx, stage, sets, path, fit_keys, tile=(200, 300), cols=6, pad=1.12):
    """sets: list of (label, [keys]) rendered with Workbench studio light at hi-res, one shared camera."""
    H = ctx.H
    s = ctx.scene
    saved = (s.render.engine, s.display.shading.light, s.display.shading.color_type, s.display.render_aa)
    s.render.engine = "BLENDER_WORKBENCH"
    s.display.shading.light = "STUDIO"
    s.display.shading.color_type = "TEXTURE"
    s.display.render_aa = "8"
    lo_r, hi_r, lo_u, hi_u = extent_of(stage, fit_keys)
    w, h = tile
    hgt = (hi_u - lo_u) * pad
    wid = (hi_r - lo_r) * pad
    scale = max(hgt, wid * h / w)
    cx, cu = 0.5 * (lo_r + hi_r), 0.5 * (lo_u + hi_u)
    r, u, f = H.camera_basis()
    ctx.camera.data.ortho_scale = scale
    ctx.camera.location = r * cx + u * cu - f * 40.0
    s.render.resolution_x, s.render.resolution_y = w, h
    s.render.resolution_percentage = 100
    tiles = []
    for label, keys in sets:
        for k, o in stage.static.items():
            o.hide_render = k not in keys
        s.render.filepath = ctx.tmp_png
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(ctx.tmp_png, check_existing=False)
        px = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        tiles.append(px.reshape(h, w, 4)[::-1].copy())
    s.render.engine, s.display.shading.light, s.display.shading.color_type, s.display.render_aa = saved
    _write_sheet(H, tiles, cols, path)
    print("preview:", path, [l for l, _ in sets], flush=True)


def new_ctx(H):
    ctx = H.Ctx()
    with open(PALETTE_JSON) as fh:
        ctx.palette = np.array(json.load(fh)["palette"], dtype=np.uint8)
    ctx.H = H
    ctx.facing = "down"
    ctx.clip = "idle"
    return ctx


# ---------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------
# Every builder returns a dict:
#   stage, body (keys drawn for the token), fit (keys that must fit the token box),
#   box (w, h of the token in 16 px units), token (assetId -> body keys) for extra tokens,
#   pieces (assetId -> dict(add=[keys], hide=[keys], layer=int, ramp="metal"|"cloth"|None))

def adv(name):
    return os.path.join(ADV, "Characters", "gltf", name)


def adv_asset(name):
    return os.path.join(ADV, "Assets", "gltf", name)


def ske(name):
    return os.path.join(SKE, "Characters", "gltf", name)


def ske_asset(name):
    return os.path.join(SKE, "Assets", "gltf", name)


def make_boots(st, M, leg_names, prefix, z, cell, sc=1.12, sz=1.0):
    """Two boots cut out of a character's legs below world height z, widened, flat-coloured with an atlas swatch."""
    keys = []
    for side, leg in zip(("L", "R"), leg_names):
        key = f"{prefix}_{side}"
        st.take(M[leg], key)
        st.cut(key, z, "below")
        v = st.verts[key]
        st.scale_about(key, (v[:, 0].mean(), v[:, 1].mean(), 0.0), sc, sc, sz)
        st.uv_cell(key, cell)
        keys.append(key)
    return keys


def scene_knight(H):
    st = Stage(H, adv("Knight.glb"), {"action": "1H_Melee_Attack_Chop", "frac": 0.4})
    M = st.main_objs
    for k in ("Knight_Head", "Knight_ArmLeft", "Knight_ArmRight", "Knight_LegLeft", "Knight_LegRight"):
        st.take(M[k], k)
    st.take(M["Knight_Body"], "torso_plate")
    st.take(M["Knight_Body"], "torso_under")
    st.scale_about("torso_under", (0, 0, 0), 0.90, 0.90, 1.0)
    st.uv_cell("torso_under", 8)
    st.take(M["Knight_Helmet"], "helmet")
    st.take(M["Knight_Cape"], "cape")
    hr, _ = st.bone_world("handslot.r")
    hl, _ = st.bone_world("handslot.l")
    st.take(M["1H_Sword"], "sword_1h")
    st.take_like(adv_asset("sword_2handed.gltf"), "1H_Sword", "sword_2h")
    st.scale_about("sword_2h", hr, 0.72)
    st.take_like(adv_asset("sword_2handed_color.gltf"), "1H_Sword", "sword_2h_gold")
    st.scale_about("sword_2h_gold", hr, 0.72)
    for key, asset in (("shield_kite", "shield_badge.gltf"), ("shield_kite_color", "shield_badge_color.gltf"),
                       ("shield_spike_color", "shield_spikes_color.gltf")):
        st.take_like(adv_asset(asset), "Badge_Shield", key)
        st.rotate_about(key, hl, "Z", -50)
    st.take(M["Round_Shield"], "shield_round")
    st.rotate_about("shield_round", hl, "Z", -50)
    boots_b = make_boots(st, M, ("Knight_LegLeft", "Knight_LegRight"), "boot_base", 0.20, 5)
    boots_r = make_boots(st, M, ("Knight_LegLeft", "Knight_LegRight"), "boot_rare", 0.28, 12, 1.15)
    body = ["Knight_Head", "Knight_ArmLeft", "Knight_ArmRight", "Knight_LegLeft", "Knight_LegRight", "torso_under"]
    G = lambda add, layer, ramp, hide=(): dict(add=list(add), hide=list(hide), layer=layer, ramp=ramp)
    pieces = {
        "gear_knight_weapon_base": G(["sword_1h"], 40, "metal"),
        "gear_knight_weapon_rare": G(["sword_2h"], 40, None),
        "gear_knight_weapon_legendary": G(["sword_2h_gold"], 40, None),
        "gear_knight_outer_base": G(["shield_kite"], 35, "metal"),
        "gear_knight_outer_rare": G(["shield_kite_color"], 35, None),
        "gear_knight_outer_legendary": G(["shield_spike_color"], 35, None),
        "gear_knight_crown_base": G(["torso_plate"], 30, "metal", ["torso_under"]),
        "gear_knight_crown_rare": G(["torso_plate", "cape"], 30, None, ["torso_under"]),
        "gear_knight_crown_legendary": G(["torso_plate", "cape", "helmet"], 30, None, ["torso_under"]),
        "gear_knight_boots_base": G(boots_b, 25, "cloth"),
        "gear_knight_boots_rare": G(boots_r, 25, None),
    }
    fit = body + ["sword_1h", "sword_2h", "shield_kite", "shield_kite_color", "helmet"]
    guard = [k for k in body if k != "torso_under"] + ["torso_plate", "helmet", "shield_round", "sword_1h"]
    st.stretch_all(1.2)
    return dict(stage=st, body=body, fit=fit, box_h=24, pieces=pieces, tokens={"token_knight": body, "token_guard": guard})


def widen_cape(st, key, sx=1.28, sy=1.0, sz=1.3):
    """Capes hang behind the body and barely show from the front: widen and lengthen them from the neckline."""
    v = st.verts[key]
    st.scale_about(key, (0.5 * (v[:, 0].min() + v[:, 0].max()), v[:, 1].mean(), v[:, 2].max()), sx, sy, sz)


def scene_rogue(H):
    st = Stage(H, adv("Rogue.glb"), {"action": "1H_Melee_Attack_Chop", "frac": 0.4})
    M = st.main_objs
    for k in ("Rogue_Body", "Rogue_Head", "Rogue_ArmLeft", "Rogue_ArmRight", "Rogue_LegLeft", "Rogue_LegRight"):
        st.take(M[k], k)
    hr, _ = st.bone_world("handslot.r")
    st.take(M["Knife"], "knife_sword")
    st.take_like(adv_asset("dagger.gltf"), "Knife", "dagger_sword")
    st.scale_about("dagger_sword", hr, 1.25)
    st.take_like(ske_asset("Skeleton_Blade.gltf"), "Knife", "blade_sword")
    st.scale_about("blade_sword", hr, 0.55)
    st.take(M["Rogue_Cape"], "cape_rogue")
    kn = st.donor(adv("Knight.glb"))
    st.take(kn["Knight_Cape"], "cape_knight")
    sr = st.donor(ske("Skeleton_Rogue.glb"))
    st.take(sr["Skeleton_Rogue_Cape"], "cape_skel")
    for key in ("cape_rogue", "cape_knight", "cape_skel"):
        widen_cape(st, key)
    st.take(sr["Skeleton_Rogue_Hood"], "hood_skel")
    st.take(sr["Skeleton_Rogue_Head"], "skull_head")
    st.take(sr["Skeleton_Rogue_Jaw"], "skull_jaw")
    st.take(sr["Skeleton_Rogue_Eyes"], "skull_eyes")
    rh = st.donor(adv("Rogue_Hooded.glb"))
    st.take(rh["Rogue_Head_Hooded"], "hood_rogue")
    boots_b = make_boots(st, M, ("Rogue_LegLeft", "Rogue_LegRight"), "boot_base", 0.20, 5)
    boots_r = make_boots(st, M, ("Rogue_LegLeft", "Rogue_LegRight"), "boot_rare", 0.28, 27, 1.15)
    body = ["Rogue_Body", "Rogue_Head", "Rogue_ArmLeft", "Rogue_ArmRight", "Rogue_LegLeft", "Rogue_LegRight"]
    G = lambda add, layer, ramp, hide=(): dict(add=list(add), hide=list(hide), layer=layer, ramp=ramp)
    pieces = {
        "gear_shadow_weapon_base": G(["knife_sword"], 40, "metal"),
        "gear_shadow_weapon_rare": G(["dagger_sword"], 40, None),
        "gear_shadow_weapon_legendary": G(["blade_sword"], 40, None),
        "gear_shadow_outer_base": G(["cape_rogue"], 10, "cloth"),
        "gear_shadow_outer_rare": G(["cape_knight"], 10, None),
        "gear_shadow_outer_legendary": G(["cape_skel"], 10, None),
        "gear_shadow_crown_base": G(["hood_rogue"], 50, "cloth", ["Rogue_Head"]),
        "gear_shadow_crown_rare": G(["hood_skel"], 50, None),
        "gear_shadow_crown_legendary": G(["hood_skel", "skull_head", "skull_jaw", "skull_eyes"], 50, None, ["Rogue_Head"]),
        "gear_shadow_boots_base": G(boots_b, 25, "cloth"),
        "gear_shadow_boots_rare": G(boots_r, 25, None),
    }
    fit = body + ["knife_sword", "hood_skel", "hood_rogue", "cape_rogue", "cape_knight"]
    st.stretch_all(1.2)
    return dict(stage=st, body=body, fit=fit, box_h=24, pieces=pieces, tokens={"token_shadow": body})


def scene_mage(H):
    st = Stage(H, adv("Mage.glb"), {"action": "1H_Melee_Attack_Chop", "frac": 0.4})
    M = st.main_objs
    for k in ("Mage_Body", "Mage_Head", "Mage_ArmLeft", "Mage_ArmRight", "Mage_LegLeft", "Mage_LegRight"):
        st.take(M[k], k)
    hr, _ = st.bone_world("handslot.r")
    st.take(M["1H_Wand"], "wand_staff")
    st.scale_about("wand_staff", hr, 1.6)
    st.take(M["2H_Staff"], "orb_staff")
    st.scale_about("orb_staff", hr, 0.8)
    st.take_like(ske_asset("Skeleton_Staff.gltf"), "2H_Staff", "skull_staff")
    st.scale_about("skull_staff", hr, 0.8)
    st.take(M["Mage_Cape"], "cape_mage")
    kn = st.donor(adv("Knight.glb"))
    st.take(kn["Knight_Cape"], "cape_knight")
    rg = st.donor(adv("Rogue.glb"))
    st.take(rg["Rogue_Cape"], "cape_sun")
    st.uv_cell("cape_sun", 25)
    for key in ("cape_mage", "cape_knight", "cape_sun"):
        widen_cape(st, key)
        sm = st.donor(ske("Skeleton_Mage.glb"))
    st.take(sm["Skeleton_Mage_Hat"], "hat_skel")
    st.take(M["Mage_Hat"], "hat_mage")
    st.take(M["Mage_Hat"], "hat_long")
    for key, (sxy, sz) in (("hat_mage", (0.72, 0.95)), ("hat_long", (0.72, 1.3)), ("hat_skel", (0.85, 1.0))):
        v = st.verts[key]
        st.scale_about(key, (v[:, 0].mean(), v[:, 1].mean(), float(np.percentile(v[:, 2], 12))), sxy, sxy, sz)
    boots_b = make_boots(st, M, ("Mage_LegLeft", "Mage_LegRight"), "boot_base", 0.20, 5)
    boots_r = make_boots(st, M, ("Mage_LegLeft", "Mage_LegRight"), "boot_rare", 0.28, 26, 1.15)
    body = ["Mage_Body", "Mage_Head", "Mage_ArmLeft", "Mage_ArmRight", "Mage_LegLeft", "Mage_LegRight"]
    G = lambda add, layer, ramp, hide=(): dict(add=list(add), hide=list(hide), layer=layer, ramp=ramp)
    pieces = {
        "gear_fireball_person_weapon_base": G(["wand_staff"], 40, "cloth"),
        "gear_fireball_person_weapon_rare": G(["orb_staff"], 40, None),
        "gear_fireball_person_weapon_legendary": G(["skull_staff"], 40, None),
        "gear_fireball_person_outer_base": G(["cape_mage"], 10, "cloth"),
        "gear_fireball_person_outer_rare": G(["cape_knight"], 10, None),
        "gear_fireball_person_outer_legendary": G(["cape_sun"], 10, None),
        "gear_fireball_person_crown_base": G(["hat_mage"], 50, "cloth"),
        "gear_fireball_person_crown_rare": G(["hat_skel"], 50, None),
        "gear_fireball_person_crown_legendary": G(["hat_long"], 50, None),
        "gear_fireball_person_boots_base": G(boots_b, 25, "cloth"),
        "gear_fireball_person_boots_rare": G(boots_r, 25, None),
    }
    fit = body + ["hat_mage", "hat_long", "orb_staff", "cape_mage", "cape_sun"]
    st.stretch_all(1.15)
    return dict(stage=st, body=body, fit=fit, box_h=24, pieces=pieces, tokens={"token_fireball_person": body})


def skel_parts(st, M, prefix):
    keys = []
    for k in list(M):
        if M[k].type == "MESH" and k.startswith(prefix) and not any(x in k for x in ("Helmet", "Hat", "Hood", "Cloak", "Cape")):
            st.take(M[k], k)
            keys.append(k)
    return keys


def scene_villager(H):
    st = Stage(H, adv("Barbarian.glb"), {"action": "Idle", "frac": 0.0})
    M = st.main_objs
    body = []
    for k in ("Barbarian_Body", "Barbarian_Head", "Barbarian_ArmLeft", "Barbarian_ArmRight", "Barbarian_LegLeft", "Barbarian_LegRight"):
        st.take(M[k], k)
        body.append(k)
    st.take(M["Mug"], "mug")
    body.append("mug")
    st.stretch_all(1.2)
    return dict(stage=st, body=body, fit=body, box_h=24, pieces={}, tokens={"token_villager": body})


def scene_skeleton(H):
    st = Stage(H, ske("Skeleton_Minion.glb"), {"action": "Idle", "frac": 0.0})
    M = st.main_objs
    body = skel_parts(st, M, "Skeleton_Minion_")
    return dict(stage=st, body=body, fit=body, box_h=16, pieces={}, tokens={"token_skeleton": body})


def scene_robed(H):
    st = Stage(H, ske("Skeleton_Mage.glb"), {"action": "Idle", "frac": 0.0})
    M = st.main_objs
    body = skel_parts(st, M, "Skeleton_Mage_")
    sr = st.donor(ske("Skeleton_Rogue.glb"))
    st.take(sr["Skeleton_Rogue_Hood"], "hood")
    body.append("hood")
    return dict(stage=st, body=body, fit=body, box_h=16, pieces={}, tokens={"token_robed_figure": body})


def scene_goblin(H):
    st = Stage(H, adv("Rogue_Hooded.glb"), {"action": "Idle", "frac": 0.0})
    M = st.main_objs
    body = []
    for k in ("Rogue_Body", "Rogue_Head_Hooded", "Rogue_ArmLeft", "Rogue_ArmRight", "Rogue_LegLeft", "Rogue_LegRight"):
        st.take(M[k], k)
        st.uv_swap(k, {0: 18, 8: 6, 9: 5})
        body.append(k)
    return dict(stage=st, body=body, fit=body, box_h=16, pieces={}, tokens={"token_goblin": body})


def place(st, key, center, width):
    """Re-centre a static mesh on `center` and scale it so its widest X/Z extent equals `width`."""
    v = st.verts[key]
    lo, hi = v.min(0), v.max(0)
    c = 0.5 * (lo + hi)
    w = max(hi[0] - lo[0], hi[2] - lo[2])
    m = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((width / w,) * 3 + (1.0,)) @ Matrix.Translation(Vector(-c))
    st.transform(key, m)


def ring_path():
    import glob
    return glob.glob(os.path.join(DUN, "Assets", "gltf", "keyring_hanging.gltf*"))[0]


def scene_icons(H):
    st = Stage(H, None, None)
    rp = ring_path()
    coin = lambda n: os.path.join(PRO, "Assets", "gltf", n)
    loop_only = lambda co: (co[:, 0].max() - co[:, 0].min()) > 0.5
    # the ring: the keyring's hoop with the keys taken off, chunked up a little
    for key, cell in (("ring_iron", None), ("ring_gold", 21), ("ring_green", 17)):
        st.take_donor(rp, "keyring_hanging", key)
        st.keep_islands(key, loop_only)
        st.inflate(key, 0.035)
        place(st, key, (0, 0, 0), 1.0)
        if cell is not None:
            st.uv_cell(key, cell)
    # set stones: a coin on edge, tinted by an atlas swatch
    for key, cell in (("stone_blue", 5), ("stone_red", 7)):
        st.take_donor(coin("Coin_A.gltf"), "Coin_A", key)
        place(st, key, (0, -0.04, 0.5), 0.26)
        st.uv_cell(key, cell)
    # amulets: a medal with a loop to hang it from
    for key, cname, cell_loop in (("amulet_silver", "Coin_B", None), ("amulet_gold", "Coin_A", 21)):
        st.take_donor(coin(cname + ".gltf"), cname, key + "_coin")
        place(st, key + "_coin", (0, 0, 0), 1.0)
        st.take_donor(rp, "keyring_hanging", key + "_loop")
        st.keep_islands(key + "_loop", loop_only)
        st.inflate(key + "_loop", 0.035)
        place(st, key + "_loop", (0, 0.0, 0.62), 0.42)
        if cell_loop is not None:
            st.uv_cell(key + "_loop", cell_loop)
    # face the camera: the scene is tilted down 30 degrees
    for key in list(st.static):
        st.rotate_about(key, (0, 0, 0), "X", -30)
    G = lambda add, ramp: dict(add=list(add), hide=[], layer=None, ramp=ramp, frame="self")
    pieces = {
        "gear_fantasy_ring_base": G(["ring_iron"], "metal"),
        "gear_fantasy_ring_rare": G(["ring_gold", "stone_blue"], None),
        "gear_fantasy_ring_legendary": G(["ring_green", "stone_red"], None),
        "gear_fantasy_amulet_base": G(["amulet_silver_coin", "amulet_silver_loop"], "metal"),
        "gear_fantasy_amulet_rare": G(["amulet_gold_coin", "amulet_gold_loop"], None),
    }
    return dict(stage=st, body=[], fit=list(st.static), box_h=16, pieces=pieces, tokens={}, icons=True)


SCENES = {"knight": scene_knight, "rogue": scene_rogue, "mage": scene_mage, "villager": scene_villager,
          "skeleton": scene_skeleton, "robed": scene_robed, "goblin": scene_goblin, "icons": scene_icons}


# ---------------------------------------------------------------------------
# Rendering one scene through one style
# ---------------------------------------------------------------------------

def dilate(mask, r):
    out = mask.copy()
    for _ in range(r):
        m = out.copy()
        m[1:, :] |= out[:-1, :]
        m[:-1, :] |= out[1:, :]
        m[:, 1:] |= out[:, :-1]
        m[:, :-1] |= out[:, 1:]
        m[1:, 1:] |= out[:-1, :-1]
        m[:-1, :-1] |= out[1:, 1:]
        m[1:, :-1] |= out[:-1, 1:]
        m[:-1, 1:] |= out[1:, :-1]
        out = m
    return out


class Shot:
    """Renders sets of static objects through a style module with a fixed framing."""

    MASK_SS = 8
    MASK_COVER = 0.40

    def __init__(self, ctx, stage, style, framing):
        self.ctx, self.st, self.style, self.framing = ctx, stage, style, framing

    def show(self, keys):
        ks = set(keys)
        for k, o in self.st.static.items():
            o.hide_render = k not in ks

    def render(self, keys, size):
        self.show(keys)
        self.framing.apply(self.ctx, size)
        f = self.style.render_frame(self.ctx, size)
        if f.shape != (size.canvas_h, size.canvas_w) or f.dtype != np.uint8:
            raise RuntimeError(f"style returned {f.shape} {f.dtype}")
        return f

    def gear_mask(self, gear_keys, vis_keys, size):
        """Canvas-sized bool: the nearest surface is one of gear_keys (Workbench object colours, no AA, supersampled)."""
        ctx, s = self.ctx, self.ctx.scene
        sh = s.display.shading
        saved = (s.render.engine, sh.light, sh.color_type, tuple(sh.single_color), s.display.render_aa,
                 s.view_settings.view_transform)
        s.render.engine = "BLENDER_WORKBENCH"
        sh.light = "FLAT"
        sh.color_type = "OBJECT"
        s.display.render_aa = "OFF"
        s.view_settings.view_transform = "Standard"
        gk, vk = set(gear_keys), set(vis_keys) | set(gear_keys)
        for k, o in self.st.static.items():
            o.color = (1.0, 0.0, 0.0, 1.0) if k in gk else (0.0, 0.0, 0.0, 1.0)
            o.hide_render = k not in vk
        self.framing.apply(ctx, size)
        rgba = ctx.render_rgba(ss=self.MASK_SS)
        (s.render.engine, sh.light, sh.color_type, sh.single_color, s.display.render_aa,
         s.view_settings.view_transform) = saved
        ss = self.MASK_SS
        H, W = size.canvas_h, size.canvas_w
        hit = ((rgba[..., 3] > 0.5) & (rgba[..., 0] > 0.5)).astype(np.float32)
        cover = hit.reshape(H, ss, W, ss).mean(axis=(1, 3))
        return cover >= self.MASK_COVER


def ramp_index(i):
    """Steel-ish palette index -> the GEAR_RAMP step of the same luminance."""
    return i


def postprocess(ov, pc, pal):
    """Base metal pieces onto GEAR_RAMP; everything else off the three ramp steps the uncommon remap moves."""
    out = ov.copy()
    if pc.get("ramp") == "metal":
        for i in STEELISH:
            sel = ov == i
            if not sel.any():
                continue
            L = L709(pal[i])
            out[sel] = 5 if L >= 215 else 8 if L >= 160 else 32 if L >= 105 else 33
    elif pc.get("ramp") == "cloth":
        for a, b in OFF_RAMP.items():
            out[ov == a] = b
    return out


SILHOUETTE_FILL = 24   # ROCK_DEEP: Rec709 L45, inside the game's 40 to 90 empty-slot band; outline is index 0


def silhouette(icon, k):
    """An empty-slot silhouette from an icon: its opaque shape in one flat fill, edge pixels (outer rim and the ring's hole) in the outline colour."""
    m = icon >= 0
    up = np.zeros_like(m)
    dn = np.zeros_like(m)
    lf = np.zeros_like(m)
    rt = np.zeros_like(m)
    up[1:, :] = m[:-1, :]
    dn[:-1, :] = m[1:, :]
    lf[:, 1:] = m[:, :-1]
    rt[:, :-1] = m[:, 1:]
    inner = m & up & dn & lf & rt
    for _ in range(k - 1):      # at 32 px the rim is 2 px thick
        e = inner.copy()
        u2 = np.zeros_like(e); d2 = np.zeros_like(e); l2 = np.zeros_like(e); r2 = np.zeros_like(e)
        u2[1:, :] = e[:-1, :]; d2[:-1, :] = e[1:, :]; l2[:, 1:] = e[:, :-1]; r2[:, :-1] = e[:, 1:]
        inner = e & u2 & d2 & l2 & r2
    out = np.full(icon.shape, -1, dtype=np.int16)
    out[m] = 0
    out[inner] = SILHOUETTE_FILL
    return out.tolist()


def run_scene(H, style_name, name, sizes):
    t0 = time.time()
    sc = SCENES[name](H)
    st = sc["stage"]
    st.finish()
    ctx = new_ctx(H)
    ctx.scene = bpy.context.scene
    ctx.objects = dict(st.static)
    make_camera(ctx)
    style = load_module(os.path.join(ROOT, "scripts", "kaykit", "styles", f"{style_name}.py"), f"kk_style_{style_name}_{name}")
    style.prepare(ctx)
    framing = Framing(st, sc["body"], sc["fit"], sc["box_h"]) if sc["body"] else None
    shot = Shot(ctx, st, style, framing)
    pal = ctx.palette
    size_objs = {16: H.Size(H.SIZES[0]), 32: H.Size(H.SIZES[1])}
    sprites = {}
    warnings = []
    body = sc["body"]

    def window(arr, size, tw, th):
        x0 = size.canvas_w // 2 - tw // 2
        y0 = size.canvas_h - th
        return arr[y0:y0 + th, x0:x0 + tw], (x0, y0)

    def cwindow(arr, size, tw, th):
        x0 = size.canvas_w // 2 - tw // 2
        y0 = size.canvas_h // 2 - th // 2
        return arr[y0:y0 + th, x0:x0 + tw]

    def to_rows(a):
        a = a.astype(np.int16)
        a[a == TRANSPARENT] = -1
        return a.tolist()

    for px in sizes:
        size = size_objs[px]
        k = px // 16
        th, tw = sc["box_h"] * k, 16 * k
        if framing is not None:
            A = shot.render(body, size)
            crop, (x0, y0) = window(A, size, tw, th)
            clipped = int((A != TRANSPARENT).sum() - (crop != TRANSPARENT).sum())
            if clipped:
                warnings.append(f"{name} {px}px body: {clipped} opaque pixels fall outside the {tw}x{th} token box")
        for tid, tkeys in sc.get("tokens", {}).items():
            tc, _ = window(shot.render(tkeys, size), size, tw, th) if tkeys is not body else (crop, None)
            sprites.setdefault(tid, {})[str(px)] = to_rows(tc)
        for aid, pc in sc.get("pieces", {}).items():
            if pc.get("frame") == "self":
                shot.framing = CenterFraming(st, pc["add"], 14)
                ov = postprocess(shot.render(pc["add"], size), pc, pal)
                shot.framing = framing
                oc = cwindow(ov, size, tw, th)
                clipped = int((ov != TRANSPARENT).sum() - (oc != TRANSPARENT).sum())
                if clipped:
                    warnings.append(f"{aid} {px}px: {clipped} opaque pixels fall outside the icon box")
                sprites.setdefault(aid, {})[str(px)] = to_rows(oc)
                continue
            vis = [q for q in body if q not in pc["hide"]] + pc["add"]
            if pc["layer"] < 20:
                ov = shot.render(pc["add"], size)
            else:
                B = shot.render(vis, size)
                M = shot.gear_mask(pc["add"], vis, size)
                near = dilate(M, 2)
                sel = M | ((B != A) & near)
                ov = np.where(sel, B, TRANSPARENT).astype(np.uint8)
                erased = int(((A != TRANSPARENT) & (B == TRANSPARENT) & near).sum())
                if erased:
                    warnings.append(f"{aid} {px}px: {erased} body pixels are erased in B (body pixel under a hidden part not covered)")
            ov = postprocess(ov, pc, pal)
            oc, _ = window(ov, size, tw, th)
            clipped = int((ov != TRANSPARENT).sum() - (oc != TRANSPARENT).sum())
            if clipped:
                warnings.append(f"{aid} {px}px: {clipped} opaque pixels fall outside the token box")
            sprites.setdefault(aid, {})[str(px)] = to_rows(oc)
    if sc.get("icons"):
        for px in sizes:
            for base, sil in (("gear_fantasy_ring_base", "gear_fantasy_ring_empty"), ("gear_fantasy_amulet_base", "gear_fantasy_amulet_empty")):
                sprites.setdefault(sil, {})[str(px)] = silhouette(np.array(sprites[base][str(px)]), px // 16)
    os.makedirs(RAW_DIR, exist_ok=True)
    doc = dict(scene=name, style=style_name, sprites=sprites, warnings=warnings, fit=(framing.fit if framing else {}),
               seconds=round(time.time() - t0, 1), images=st.images)
    with open(os.path.join(RAW_DIR, f"raw-{style_name}-{name}.json"), "w") as fh:
        json.dump(doc, fh)
    fit_txt = f"fit {framing.fit['w']:.1f}x{framing.fit['h']:.1f} px, " if framing else ""
    print(f"[{style_name}/{name}] {len(sprites)} sprites, {fit_txt}{len(warnings)} warnings, {doc['seconds']}s", flush=True)
    for w in warnings:
        print("   warn:", w, flush=True)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    opts = {"cmd": argv[0] if argv else "render", "style": "plain", "scenes": None, "sizes": SIZES}
    i = 1
    while i < len(argv):
        if argv[i] == "--style":
            opts["style"] = argv[i + 1]
            opts["style_given"] = True
            i += 2
        elif argv[i] == "--scenes":
            opts["scenes"] = argv[i + 1].split(",")
            i += 2
        elif argv[i] == "--gap-goblin":
            opts["gap_goblin"] = True
            i += 1
        elif argv[i] == "--sizes":
            opts["sizes"] = [int(x) for x in argv[i + 1].split(",")]
            i += 2
        else:
            i += 1
    return opts


def load_harness():
    return load_module(os.path.join(ROOT, "scripts", "kaykit", "harness.py"), "kaykit_harness")


def cmd_preview(opts):
    H = load_harness()
    os.makedirs(SCRATCH, exist_ok=True)
    os.makedirs(os.path.dirname(H.Ctx().tmp_png), exist_ok=True)
    for name in opts["scenes"] or list(SCENES):
        t0 = time.time()
        ctx = new_ctx(H)
        sc = SCENES[name](H)
        st = sc["stage"]
        st.finish()
        ctx.scene = bpy.context.scene
        make_camera(ctx)
        body = sc["body"]
        sets = [(tid, tk) for tid, tk in sc.get("tokens", {}).items()]
        for aid, pc in sc.get("pieces", {}).items():
            sets.append((aid, [k for k in body if k not in pc["hide"]] + pc["add"]))
        preview_sets(ctx, st, sets, os.path.join(SCRATCH, f"preview_{name}.png"), sc["fit"], cols=sc.get("cols", 6))
        print(f"[{name}] images: {st.images} {time.time() - t0:.1f}s", flush=True)


def cmd_render(opts):
    H = load_harness()
    os.makedirs(SCRATCH, exist_ok=True)
    os.makedirs(os.path.dirname(H.Ctx().tmp_png), exist_ok=True)
    for name in opts["scenes"] or list(SCENES):
        run_scene(H, opts["style"], name, opts["sizes"])


# ---------------------------------------------------------------------------
# Assemble: raw renders -> parts JSON (pure python, no Blender needed)
# ---------------------------------------------------------------------------

GAP_REASONS = {
    "token_goblin": "no free KayKit goblin (Adventurers, Skeletons and the Bits packs hold none); only a recoloured Rogue_Hooded exists",
}


def cmd_assemble(opts):
    import glob
    import subprocess
    with open(TARGETS_JSON) as fh:
        targets = json.load(fh)["targets"]
    scope = [t for t in targets if t["group"] in ("token", "gear", "icon") and not t.get("outOfPlay")]
    styles = [opts["style"]] if opts.get("style_given") else STYLES
    os.makedirs(PARTS_DIR, exist_ok=True)
    for style in styles:
        merged = {}
        for f in sorted(glob.glob(os.path.join(RAW_DIR, f"raw-{style}-*.json"))):
            with open(f) as fh:
                merged.update(json.load(fh)["sprites"])
        for size in opts["sizes"]:
            sprites, gaps = [], []
            for t in scope:
                aid = t["assetId"]
                px = merged.get(aid, {}).get(str(size))
                if aid == "token_goblin" and opts.get("gap_goblin"):
                    px = None   # the goblin is a recoloured Rogue_Hooded, not a Kay goblin: --gap-goblin reports it as a gap instead
                if px is None:
                    gaps.append({"assetId": aid, "reason": GAP_REASONS.get(aid, "not converted")})
                    continue
                sprites.append({"assetId": aid, "kind": t["kind"], "name": t["name"], "walkable": t["walkable"], "pixels": px})
            out = os.path.join(PARTS_DIR, f"{MAKER}-{style}-{size}.json")
            with open(out, "w") as fh:
                json.dump({"maker": MAKER, "size": size, "style": style, "sprites": sprites, "gaps": gaps}, fh)
            res = subprocess.run(["node", os.path.join("scripts", "kaykit", "check-part.mjs"), out], capture_output=True, text=True)
            print(res.stdout.strip() or res.stderr.strip())


if __name__ == "__main__" and IN_BLENDER:
    opts = parse_args()
    if opts["cmd"] == "preview":
        cmd_preview(opts)
    elif opts["cmd"] == "render":
        cmd_render(opts)
elif __name__ == "__main__":
    opts = parse_args()
    if opts["cmd"] == "assemble":
        cmd_assemble(opts)
