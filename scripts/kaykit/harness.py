"""
KayKit 3D -> 2D sprite harness (Blender 5.2, headless).

Poses the KayKit Knight (CC0, Kay Lousberg) through a fixed plan of weapon
loadouts, animations and four facings, frames it with one fixed orthographic
camera per sprite size, and hands every posed frame to a STYLE module that
decides how the 3D scene becomes an indexed pixel frame. The harness owns
everything that must be identical between styles (what is posed, how it is
framed, where the feet land, the output format) so that styles can be compared
side by side and only the conversion differs.

Run from the repo root:

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
    --python scripts/kaykit/harness.py -- --style plain [--quick]

Inputs (both under .cache/, gitignored):
  .cache/kaykit/adventurers/     the KayKit Adventurers pack (git clone of
                                 github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)
  .cache/kaykit/palette-fantasy.json   from `npx tsx scripts/kaykit/export-palette.ts`

Output: .cache/kaykit/out/<style>/frames.json plus sheet.png (a contact sheet
to look at) and reference.png (the untouched hi-res render, for comparison).

STYLE CONTRACT (scripts/kaykit/styles/<name>.py):
  LABEL: str            short name shown in the bench
  DESCRIPTION: str      one sentence: what the conversion does
  prepare(ctx)          once, after the model and camera exist; may change the
                        render engine, materials, world, add outline geometry...
  render_frame(ctx, size) -> numpy uint8 array, shape (size.canvas_h, size.canvas_w),
                        255 = transparent, otherwise a palette index 0..47.
                        The pose and camera are already set for this frame;
                        use ctx.render_rgba(ss) to render at ss x the canvas
                        resolution with the same framing.
"""
import base64
import importlib.util
import json
import math
import os
import sys
import time
import zlib

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.getcwd()
PACK = os.path.join(ROOT, ".cache", "kaykit", "adventurers", "addons", "kaykit_character_pack_adventures")
CHARACTER_GLB = os.path.join(PACK, "Characters", "gltf", "Knight.glb")
ASSET_DIR = os.path.join(PACK, "Assets", "gltf")
PALETTE_JSON = os.path.join(ROOT, ".cache", "kaykit", "palette-fantasy.json")

TRANSPARENT = 255
CAMERA_PITCH_DEG = 30.0  # how far the camera looks down; SNES field sprites are close to front-on

# ---------------------------------------------------------------------------
# The plan. Identical for every style.
# ---------------------------------------------------------------------------

# Sprite sizes: the token box the figure must fill, like the game's own 16x24
# tokens (bottom-anchored). The canvas is wider and taller than the token so a
# swung weapon is not clipped; the feet sit on the canvas bottom edge, centred.
SIZES = [
    {"id": "16x24", "token_w": 16, "token_h": 24},
    {"id": "32x48", "token_w": 32, "token_h": 48},
    {"id": "48x72", "token_w": 48, "token_h": 72},
]
FULL_SIZE_LOADOUTS = {"sword_shield"}  # 48x72 only for the default loadout (keeps the bench small)

FACINGS = [("down", 0.0), ("right", 90.0), ("up", 180.0), ("left", -90.0)]

# (clip id, frames sampled, loops)
CLIPS = [
    ("idle", 6, True),
    ("walk", 8, True),
    ("attack", 8, False),
    ("hit", 4, False),
    ("death", 8, False),
    ("interact", 6, False),
    ("cheer", 8, False),
]

# Which KayKit action plays for each clip, per loadout. Unlisted clips use COMMON.
COMMON = {"walk": "Walking_A", "hit": "Hit_A", "death": "Death_A", "interact": "Interact", "cheer": "Cheer"}

# show: meshes from Knight.glb to render; extra: (asset gltf, copy transform from, bone)
LOADOUTS = [
    {"id": "sword_shield", "label": "Sword and badge shield",
     "show": ["1H_Sword", "Badge_Shield", "Knight_Helmet", "Knight_Cape"],
     "clips": {"idle": "Idle", "attack": "1H_Melee_Attack_Slice_Diagonal"}},
    {"id": "sword_shield_bare", "label": "Sword and shield, no helmet or cape",
     "show": ["1H_Sword", "Round_Shield"],
     "clips": {"idle": "Idle", "attack": "1H_Melee_Attack_Chop"}},
    {"id": "greatsword", "label": "Two-handed sword",
     "show": ["2H_Sword", "Knight_Helmet", "Knight_Cape"],
     "clips": {"idle": "2H_Melee_Idle", "attack": "2H_Melee_Attack_Slice"}},
    {"id": "dual_swords", "label": "Two swords",
     "show": ["1H_Sword", "1H_Sword_Offhand", "Knight_Helmet", "Knight_Cape"],
     "clips": {"idle": "Idle", "attack": "Dualwield_Melee_Attack_Slice"}},
    {"id": "axe_spikes", "label": "Axe and spiked shield",
     "show": ["Spike_Shield", "Knight_Helmet", "Knight_Cape"],
     "extra": [("axe_1handed.gltf", "1H_Sword")],
     "clips": {"idle": "Idle", "attack": "1H_Melee_Attack_Chop"}},
    {"id": "crossbow", "label": "Crossbow",
     "show": ["Knight_Helmet", "Knight_Cape"],
     "extra": [("crossbow_2handed.gltf", "2H_Sword")],
     "clips": {"idle": "2H_Ranged_Aiming", "attack": "2H_Ranged_Shoot"}},
    {"id": "staff", "label": "Staff",
     "show": ["Knight_Helmet", "Knight_Cape"],
     "extra": [("staff.gltf", "2H_Sword")],
     "clips": {"idle": "2H_Melee_Idle", "attack": "Spellcast_Shoot"}},
]

BODY_MESHES = ["Knight_Body", "Knight_Head", "Knight_ArmLeft", "Knight_ArmRight", "Knight_LegLeft", "Knight_LegRight"]
OPTIONAL_MESHES = ["1H_Sword", "1H_Sword_Offhand", "2H_Sword", "Badge_Shield", "Rectangle_Shield", "Round_Shield",
                   "Spike_Shield", "Knight_Helmet", "Knight_Cape"]


class Size:
    def __init__(self, spec):
        self.id = spec["id"]
        self.token_w = spec["token_w"]
        self.token_h = spec["token_h"]
        self.canvas_w = self.token_w * 2
        self.canvas_h = int(math.ceil(self.token_h * 1.5))
        self.world_per_px = None  # set by frame_camera

    def meta(self):
        return {"tokenW": self.token_w, "tokenH": self.token_h, "canvasW": self.canvas_w, "canvasH": self.canvas_h,
                "anchorX": self.canvas_w / 2, "anchorY": self.canvas_h}


class Ctx:
    """What a style gets. Everything here is read-mostly; styles may change render settings and materials."""

    def __init__(self):
        self.scene = bpy.context.scene
        self.rig = None
        self.camera = None
        self.objects = {}
        self.palette = None        # (52, 3) uint8 sRGB
        self.usable = 48           # indices 0..47 are pickable; 48..51 are the reserved glow band
        self.size = None           # the Size currently being rendered
        self.tmp_png = os.path.join(ROOT, ".cache", "kaykit", "tmp", f"render_{os.getpid()}.png")
        self.loadout = None
        self.clip = None
        self.facing = None

    # -- rendering helpers --------------------------------------------------
    def render_rgba(self, ss=1):
        """Render the current pose at ss x the canvas resolution with the current framing.
        Returns float32 (h*ss, w*ss, 4) straight sRGB-ish RGBA in 0..1, row 0 at the TOP."""
        s = self.scene
        w, h = self.size.canvas_w * ss, self.size.canvas_h * ss
        s.render.resolution_x, s.render.resolution_y = w, h
        s.render.resolution_percentage = 100
        s.render.filepath = self.tmp_png
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(self.tmp_png, check_existing=False)
        try:
            px = np.empty(w * h * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
        finally:
            bpy.data.images.remove(img)
        return px.reshape(h, w, 4)[::-1].copy()

    def nearest_palette(self, rgb, indices=None):
        """rgb: (..., 3) float 0..1. Returns uint8 indices into the palette (restricted to `indices`, default 0..47),
        by nearest colour in a perceptual-ish weighted RGB space."""
        idx = np.arange(self.usable) if indices is None else np.asarray(indices)
        pal = self.palette[idx].astype(np.float32) / 255.0
        flat = rgb.reshape(-1, 3)
        wts = np.array([0.30, 0.59, 0.11], dtype=np.float32) ** 0.5
        d = (((flat[:, None, :] - pal[None, :, :]) * wts) ** 2).sum(-1)
        return idx[d.argmin(1)].astype(np.uint8).reshape(rgb.shape[:-1])

    def palette_rgb(self):
        return self.palette.astype(np.float32) / 255.0


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------

def load_scene(ctx):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ctx.scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=CHARACTER_GLB)
    ctx.objects = {o.name: o for o in bpy.data.objects}
    ctx.rig = ctx.objects["Rig"]
    if "Icosphere" in ctx.objects:
        ctx.objects["Icosphere"].hide_render = True  # stray helper sphere shipped in the file
    ad = ctx.rig.animation_data or ctx.rig.animation_data_create()
    for tr in ad.nla_tracks:
        tr.mute = True
    # Facing turns an empty the rig hangs from, never the rig itself: the rig object is in quaternion mode and
    # its own transform may be keyed, so turning it directly is silently ignored.
    turntable = bpy.data.objects.new("Turntable", None)
    ctx.scene.collection.objects.link(turntable)
    ctx.rig.parent = turntable
    ctx.turntable = turntable
    # Extra weapons from the pack's Assets folder, attached exactly like an
    # existing weapon on the same hand slot: copy that object (so the bone
    # parenting and the importer's bone-axis correction carry over) and swap in
    # the new mesh data.
    for lo in LOADOUTS:
        for fname, like in lo.get("extra", []):
            key = fname.replace(".gltf", "")
            if key in ctx.objects:
                continue
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=os.path.join(ASSET_DIR, fname))
            new_objs = [o for o in bpy.data.objects if o not in before]
            meshes = [o for o in new_objs if o.type == "MESH"]
            if not meshes:
                raise RuntimeError(f"{fname}: no mesh imported")
            template = ctx.objects[like]
            clone = template.copy()
            clone.data = meshes[0].data
            clone.name = key
            ctx.scene.collection.objects.link(clone)
            for o in new_objs:
                bpy.data.objects.remove(o, do_unlink=True)
            ctx.objects[key] = clone
            OPTIONAL_MESHES.append(key)
    s = ctx.scene.render
    s.film_transparent = True
    s.image_settings.file_format = "PNG"
    s.image_settings.color_mode = "RGBA"
    s.image_settings.color_depth = "8"
    ctx.scene.view_settings.view_transform = "Standard"
    ctx.scene.view_settings.look = "None"
    ctx.scene.render.fps = 24


def show_loadout(ctx, lo):
    shown = set(lo["show"]) | {fname.replace(".gltf", "") for fname, _ in lo.get("extra", [])}
    for name in OPTIONAL_MESHES:
        if name in ctx.objects:
            ctx.objects[name].hide_render = name not in shown
    for name in BODY_MESHES:
        ctx.objects[name].hide_render = False
    ctx.loadout = lo["id"]


def action_for(lo, clip_id):
    return lo["clips"].get(clip_id) or COMMON[clip_id]


def pose(ctx, action_name, t, facing_deg):
    ad = ctx.rig.animation_data
    act = bpy.data.actions[action_name]
    ad.action = act
    if getattr(act, "slots", None) and len(act.slots) > 0 and hasattr(ad, "action_slot"):
        ad.action_slot = act.slots[0]
    ctx.turntable.rotation_euler = (0.0, 0.0, math.radians(facing_deg))
    whole = math.floor(t)
    ctx.scene.frame_set(int(whole), subframe=float(t - whole))


def sample_times(action_name, n, loop):
    a, b = bpy.data.actions[action_name].frame_range
    if n == 1:
        return [a]
    if loop:
        return [a + (b - a) * i / n for i in range(n)]
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def camera_basis():
    th = math.radians(CAMERA_PITCH_DEG)
    r = Vector((1.0, 0.0, 0.0))
    u = Vector((0.0, math.sin(th), math.cos(th)))
    f = Vector((0.0, math.cos(th), -math.sin(th)))
    return r, u, f


def figure_extent(ctx):
    """Projected (min_r, max_r, min_u, max_u) of the body plus helmet and cape, in the default loadout's idle
    pose facing the camera. Weapons are left out so the framing is the same for every loadout."""
    lo = LOADOUTS[0]
    show_loadout(ctx, lo)
    pose(ctx, action_for(lo, "idle"), bpy.data.actions[action_for(lo, "idle")].frame_range[0], 0.0)
    dg = bpy.context.evaluated_depsgraph_get()
    r, u, _ = camera_basis()
    rs, us = [], []
    for name in BODY_MESHES + ["Knight_Helmet", "Knight_Cape"]:
        ob = ctx.objects[name].evaluated_get(dg)
        me = ob.to_mesh()
        mw = ob.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            rs.append(w.dot(r))
            us.append(w.dot(u))
        ob.to_mesh_clear()
    return min(rs), max(rs), min(us), max(us)


def build_camera(ctx):
    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "VERTICAL"
    cam_data.clip_start = 0.01
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new("SpriteCam", cam_data)
    ctx.scene.collection.objects.link(cam)
    ctx.scene.camera = cam
    cam.rotation_euler = (math.radians(90.0 - CAMERA_PITCH_DEG), 0.0, 0.0)
    ctx.camera = cam
    ctx.extent = figure_extent(ctx)


def frame_camera(ctx, size):
    """Fixed framing per size: the figure fills token_h - 1 pixels (one pixel of headroom for an outline) with
    its feet on the canvas's bottom edge, centred horizontally."""
    min_r, max_r, min_u, max_u = ctx.extent
    wpp = (max_u - min_u) / (size.token_h - 1)
    size.world_per_px = wpp
    ctx.camera.data.ortho_scale = size.canvas_h * wpp
    r, u, f = camera_basis()
    cam_r = (min_r + max_r) / 2.0
    cam_u = min_u + size.canvas_h / 2.0 * wpp
    ctx.camera.location = r * cam_r + u * cam_u - f * 40.0
    ctx.size = size


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def pack_frames(frames):
    raw = b"".join(np.ascontiguousarray(f, dtype=np.uint8).tobytes() for f in frames)
    return base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def write_png(path, rgba_u8):
    """rgba_u8: (h, w, 4) uint8, row 0 at the top."""
    h, w, _ = rgba_u8.shape
    img = bpy.data.images.new("out", w, h, alpha=True)
    img.pixels.foreach_set((rgba_u8[::-1].astype(np.float32) / 255.0).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def to_rgba(ctx, frame):
    out = np.zeros(frame.shape + (4,), dtype=np.uint8)
    solid = frame != TRANSPARENT
    out[solid, :3] = ctx.palette[frame[solid]]
    out[solid, 3] = 255
    return out


def contact_sheet(ctx, samples, path, zoom=4):
    """samples: list of rows, each a list of (h, w) index frames. Grey background, zoomed nearest-neighbour."""
    cell_w = max(f.shape[1] for row in samples for f in row) * zoom + 8
    cell_h = max(f.shape[0] for row in samples for f in row) * zoom + 8
    cols = max(len(row) for row in samples)
    sheet = np.zeros((cell_h * len(samples), cell_w * cols, 4), dtype=np.uint8)
    sheet[..., :3] = 96
    sheet[..., 3] = 255
    for ri, row in enumerate(samples):
        for ci, f in enumerate(row):
            rgba = np.repeat(np.repeat(to_rgba(ctx, f), zoom, 0), zoom, 1)
            y0 = ri * cell_h + 4 + (cell_h - 8 - rgba.shape[0])
            x0 = ci * cell_w + 4
            region = sheet[y0:y0 + rgba.shape[0], x0:x0 + rgba.shape[1]]
            a = rgba[..., 3:4] > 0
            region[:] = np.where(a, rgba, region)
    write_png(path, sheet)


def reference_render(ctx, out_dir):
    """The untouched model, lit and anti-aliased, at 8x the 32x48 canvas: what the pixel versions start from."""
    size = Size(SIZES[1])
    frame_camera(ctx, size)
    lo = LOADOUTS[0]
    show_loadout(ctx, lo)
    idle = action_for(lo, "idle")
    pose(ctx, idle, bpy.data.actions[idle].frame_range[0], 0.0)
    s = ctx.scene
    saved = (s.render.engine, s.display.shading.light, s.display.shading.color_type, s.display.render_aa)
    s.render.engine = "BLENDER_WORKBENCH"
    s.display.shading.light = "STUDIO"
    s.display.shading.color_type = "TEXTURE"
    s.display.render_aa = "8"
    rgba = ctx.render_rgba(ss=8)
    s.render.engine, s.display.shading.light, s.display.shading.color_type, s.display.render_aa = saved
    path = os.path.join(out_dir, "reference.png")
    write_png(path, (np.clip(rgba, 0, 1) * 255).astype(np.uint8))
    with open(path, "rb") as fh:
        return base64.b64encode(fh.read()).decode("ascii")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    style_name = argv[argv.index("--style") + 1] if "--style" in argv else "plain"
    quick = "--quick" in argv
    style_path = os.path.join(ROOT, "scripts", "kaykit", "styles", f"{style_name}.py")
    spec = importlib.util.spec_from_file_location(f"kaykit_style_{style_name}", style_path)
    style = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(style)

    out_dir = os.path.join(ROOT, ".cache", "kaykit", "out", style_name)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.dirname(Ctx().tmp_png), exist_ok=True)

    ctx = Ctx()
    with open(PALETTE_JSON) as fh:
        ctx.palette = np.array(json.load(fh)["palette"], dtype=np.uint8)
    load_scene(ctx)
    build_camera(ctx)
    reference_b64 = reference_render(ctx, out_dir)

    t0 = time.time()
    style.prepare(ctx)

    loadouts = LOADOUTS[:1] if quick else LOADOUTS
    clips_plan = [c for c in CLIPS if c[0] in ("idle", "attack")] if quick else CLIPS
    sizes = [Size(s) for s in SIZES]
    clips_out = []
    sheet_rows = {}
    renders = 0
    for lo in loadouts:
        show_loadout(ctx, lo)
        for size in sizes:
            if size.id == "48x72" and lo["id"] not in FULL_SIZE_LOADOUTS:
                continue
            if quick and size.id == "48x72":
                continue
            frame_camera(ctx, size)
            for clip_id, n, loop in clips_plan:
                action = action_for(lo, clip_id)
                a, b = bpy.data.actions[action].frame_range
                times = sample_times(action, n, loop)
                for facing, deg in FACINGS:
                    ctx.clip, ctx.facing = clip_id, facing
                    frames = []
                    for t in times:
                        pose(ctx, action, t, deg)
                        f = style.render_frame(ctx, size)
                        if f.shape != (size.canvas_h, size.canvas_w) or f.dtype != np.uint8:
                            raise RuntimeError(f"{style_name}: render_frame returned {f.shape} {f.dtype}, "
                                               f"expected ({size.canvas_h}, {size.canvas_w}) uint8")
                        bad = (f != TRANSPARENT) & (f >= ctx.usable)
                        if bad.any():
                            raise RuntimeError(f"{style_name}: render_frame used reserved/out-of-range palette indices")
                        frames.append(f)
                        renders += 1
                    seconds = (b - a) / 24.0
                    clips_out.append({
                        "loadout": lo["id"], "size": size.id, "clip": clip_id, "dir": facing,
                        "count": len(frames), "loop": loop,
                        "fps": round(len(frames) / seconds, 3) if seconds > 0 else 8,
                        "data": pack_frames(frames),
                    })
                    if lo["id"] == "sword_shield" and size.id in ("16x24", "32x48"):
                        sheet_rows.setdefault(f"{size.id}:{facing}", []).extend(
                            [frames[0], frames[len(frames) // 2]])
        print(f"[{style_name}] loadout {lo['id']} done, {renders} frames, {time.time() - t0:.1f}s", flush=True)

    rows = [sheet_rows[k] for k in sorted(sheet_rows)]
    contact_sheet(ctx, rows, os.path.join(out_dir, "sheet.png"))

    doc = {
        "style": style_name,
        "label": getattr(style, "LABEL", style_name),
        "description": getattr(style, "DESCRIPTION", ""),
        "character": "Knight",
        "source": "KayKit Character Pack: Adventurers 1.0 by Kay Lousberg (CC0)",
        "palette": ctx.palette.tolist(),
        "sizes": {s.id: s.meta() for s in sizes},
        "loadouts": [{"id": lo["id"], "label": lo["label"]} for lo in loadouts],
        "clips": clips_out,
        "reference": reference_b64,
        "cameraPitchDeg": CAMERA_PITCH_DEG,
        "renderSeconds": round(time.time() - t0, 1),
        "frames": renders,
        "quick": quick,
    }
    with open(os.path.join(out_dir, "frames.json"), "w") as fh:
        json.dump(doc, fh)
    print(f"[{style_name}] wrote {out_dir}/frames.json: {len(clips_out)} clips, {renders} frames, "
          f"{os.path.getsize(os.path.join(out_dir, 'frames.json'))} bytes, {doc['renderSeconds']}s", flush=True)


if __name__ == "__main__":
    main()
