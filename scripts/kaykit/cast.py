"""
KayKit cast maker: every character the game uses, ANIMATED, rendered through
the same pipeline as the KayKit Knight on the asset bench (scripts/kaykit/
harness.py), so the whole cast shares one art style. The exception is any id
kept hand-drawn by the owner's call (HAND_DRAWN below; today the goblin).

WHY THIS EXISTS
  The animated Knight came from harness.py: orthographic camera 30 degrees
  down, figure filling token_h - 1 px, canvas 2x token width by 1.5x token
  height, feet on the bottom edge, one of four style modules (plain, bands,
  toon, pixelart). The other characters came from lib_tokens.py, which stretched
  the models, shrank the weapons into the 16 px box and requantised the metals:
  another art style, and static. This script renders every character in CAST
  through the harness's own framing and the unchanged style modules, with each
  model's own KayKit animations.

Run from the repo root (Blender 5.2 headless). One process per (style, group):

  blender -b --factory-startup --python scripts/kaykit/cast.py -- render --style bands --chars token_knight
  blender -b --factory-startup --python scripts/kaykit/cast.py -- render --style bands          (all characters)
  blender -b --factory-startup --python scripts/kaykit/cast.py -- assemble --style bands        (raw renders -> cast.json, parts, sheet)
  blender -b --factory-startup --python scripts/kaykit/cast.py -- preview                       (hi-res look at the 3D parts)
  blender -b --factory-startup --python scripts/kaykit/cast.py -- parity --style plain          (Knight vs the harness, pixel for pixel)
  add  --stabilise off  to render, parity or assemble as it was before the temporal fixes below (A/B, regression checks)
  add  --snap idle,walk to override which clips are snapped to whole pixels (default: harness.SNAP_CLIPS)

Outputs
  .cache/kaykit/out/cast-<style>/cast.json     the animated cast (format below)
  .cache/kaykit/out/cast-<style>/sheet.png     every character in the cast at 32 px, four facings, next to the harness Knight
  .cache/kaykit/library/parts/tokens-<style>-<16|32>.json   the static tokens, gear overlays and icons
  scratch under .cache/kaykit/scratch/cast/

THE CAST
  Heroes (token_knight, token_shadow, token_fireball_person) render as a BODY
  without removable gear plus one animated LAYER per gear piece. A layer holds
  only the pixels where that piece is the nearest surface once the body is
  there (a Workbench object-colour pass decides), plus the piece's own outline
  pixels, so drawing the layers after the body, in the per-facing order, gives
  the body wearing them. Monsters and NPCs carry their kit in the body.
  Layers are rendered one piece at a time against the bare body, so any
  combination composites, except that two pieces overlapping each other are
  resolved by draw order and outline pixels shared by two pieces may differ by
  a pixel from a render of both together.
  The goblin is NOT in the cast. It is kept hand-drawn by the owner's call
  (2026-10-01): the game's own hand-drawn token_goblin (scripts/assets/
  fantasy.ts) is the one they prefer over a recoloured Rogue_Hooded stand-in.
  The library never supplies it: HAND_DRAWN below holds the reason, assemble
  writes token_goblin into every tokens part as a gap with that reason, and
  the bench falls back to the hand-drawn sprite (artManifest in
  scripts/asset-bench/assets.ts). The game has no KayKit loader yet: whoever
  switches it over must keep the hand-drawn token_goblin in the served
  manifest, upscaled to the manifest's spriteSize. Raw renders of it that
  remain on disk are ignored (merge_raw follows CAST).

cast.json
  { style, label, description, palette[52], cameraPitchDeg,
    characters: [ { id, label, kind, archetype, model, standIn, notes,
                    sizes: { "16": {tokenW, tokenH, canvasW, canvasH, anchorX, anchorY}, "32": ... },
                    clips: [ { size, clip, dir, count, loop, fps, data } ] } ],
    gear: [ { id, archetype, role, tier, label, character, clips: [ same shape ] } ],
    layerOrder: { down: [roles], right: [...], up: [...], left: [...] },
    layerOrderByArchetype: { knight: { down: [...], ... }, ... } }
  data: every frame's palette indices (0..47, 255 transparent), canvasW*canvasH
  bytes per frame, concatenated, zlib, base64 (the harness encoding).

Temporal stability (harness.ClipRun and ctx.mem; the harness draws its own frames through the same code)
  Every pixel was decided on its own, frame by frame, so a pixel on a threshold flipped and flipped back (the idle's
  only motion is a sub-pixel hip bob) and the figure shimmered. Three parts, all on by default:
  * Frames are rendered in clip order through ClipRun. A looping clip (idle, walk) runs twice and keeps the second pass,
    so the clip wraps cleanly; once-clips (attack, hit, death, interact, cheer) run once, cold at frame 0. Each thing
    drawn each frame (the body, every gear layer, every gear mask) is its own memory stream.
  * Each style's per-pixel decisions have a dead band (coverage, material, shade band, and here the gear mask): a pixel
    keeps its colour while that colour still holds 75% of the winner's weight, and a threshold must be crossed by a
    margin to flip back. Stills (the static tokens and overlays) have no memory and are unchanged.
  * The idle is also snapped to whole pixels: the camera follows the fractional part of the hips' motion (one camera
    per frame, shared by the body and every layer, so layers register), and never lifts the figure off the ground line.
    Walk and the once-clips were measured with and without it and left alone (it helps the 16 px walk, hurts the 32 px
    one, and is mixed on the rest); see harness.SNAP_CLIPS.

Framing rules (identical to harness.py)
  Per character the camera frames the FIT meshes (body plus head gear and cape,
  never weapons) in the Idle pose facing the camera so they fill token_h - 1
  pixels; the box comes from targets.json (16x24 for heroes, 16x16 for the
  skeleton and robed figure, so a small creature stays small; the goblin's
  16x16 box is unused, it is kept hand-drawn by the owner's call). The
  style modules key their per-size tuning on size ids "16x24" and "32x48", so
  those ids are used for every character whatever its box.
"""
import base64
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import time
import zlib

try:
    import bpy
    import bmesh
    import numpy as np
    from mathutils import Matrix, Vector
    IN_BLENDER = True
except ImportError:
    IN_BLENDER = False

ROOT = os.getcwd()
KK = os.path.join(ROOT, ".cache", "kaykit")
ADV = os.path.join(KK, "adventurers", "addons", "kaykit_character_pack_adventures")
SKE = os.path.join(KK, "skeletons", "addons", "kaykit_character_pack_skeletons")
TARGETS_JSON = os.path.join(KK, "library", "targets.json")
PALETTE_JSON = os.path.join(KK, "palette-fantasy.json")
SCRATCH = os.path.join(KK, "scratch", "cast")
RUN = "main"     # raw renders live in scratch/raw-<run>, so a trial run never mixes with the real one (--run to change)
RAW_DIR = os.path.join(SCRATCH, f"raw-{RUN}")
PARTS_DIR = os.path.join(KK, "library", "parts")
OUT_ROOT = os.path.join(KK, "out")
MAKER = "tokens"
STYLES = ["plain", "bands", "toon", "pixelart"]
SIZES = [16, 32]
TRANSPARENT = 255

# The game's gear ramp (brightest to darkest) and the colours the styles emit for KayKit metal. Base-tier metal
# pieces are put on the ramp so the game's uncommon recolour bites; every other piece is kept off the three ramp
# steps the recolour moves (it would turn a cloak into brass). Same rule lib_tokens.py followed.
GEAR_RAMP = (5, 8, 32, 33)
STEELISH = (5, 7, 8, 14, 20, 21, 22, 23, 24, 25, 26, 27, 32, 33, 40, 41)
OFF_RAMP = {8: 23, 32: 40, 33: 41}

UV_COLS, UV_ROWS = 8, 4   # every KayKit atlas is 8 x 4 swatches

CLIP_NAMES = ("idle", "walk", "attack", "hit", "death", "interact", "cheer")


def L709(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def strip_suffix(name):
    return re.sub(r"\.\d{3}$", "", name)


def adv(name):
    return os.path.join(ADV, "Characters", "gltf", name)


def adv_asset(name):
    return os.path.join(ADV, "Assets", "gltf", name)


def ske(name):
    return os.path.join(SKE, "Characters", "gltf", name)


def ske_asset(name):
    return os.path.join(SKE, "Assets", "gltf", name)


STAB = {"on": True, "snap": None}     # --stabilise on|off, --snap clip,clip|none (None keeps the harness's SNAP_CLIPS)


def load_harness():
    H = load_module(os.path.join(ROOT, "scripts", "kaykit", "harness.py"), "kaykit_harness")
    H.STABILISE = STAB["on"]
    if STAB["snap"] is not None:
        H.SNAP_CLIPS = STAB["snap"]
    return H


def load_targets():
    with open(TARGETS_JSON) as fh:
        return {t["assetId"]: t for t in json.load(fh)["targets"]}


# ---------------------------------------------------------------------------
# Builder: one Blender scene per character, meshes still on their rig
# ---------------------------------------------------------------------------

class Builder:
    """Imports a main glb (the model whose rig and animations play), clones donor meshes onto that rig, and edits
    meshes in REST space (so an edit follows the animation). Every part is a named object; the spec says which are
    the body, which are gear, which hide which."""

    def __init__(self, H):
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
        self.parts = {}
        self.main = {}
        self.rig = None
        self.turntable = None
        self.donors = {}
        self._donor_objs = []
        self._donor_actions = []

    # -- import ---------------------------------------------------------------
    def _import(self, path):
        before_o = set(bpy.data.objects)
        before_a = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before_o]
        acts = [a for a in bpy.data.actions if a not in before_a]
        objs = {strip_suffix(o.name): o for o in new}
        if "Icosphere" in objs:   # a stray helper sphere shipped in every character file
            ico = objs.pop("Icosphere")
            new = [o for o in new if o != ico]
            bpy.data.objects.remove(ico, do_unlink=True)
        return objs, new, acts

    def load_main(self, path):
        objs, _, _ = self._import(path)
        self.main = objs
        self.rig = next(o for o in objs.values() if o.type == "ARMATURE")
        ad = self.rig.animation_data or self.rig.animation_data_create()
        for tr in ad.nla_tracks:
            tr.mute = True
        # Facing turns an empty the rig hangs from, never the rig itself (harness.py explains why).
        self.turntable = bpy.data.objects.new("Turntable", None)
        self.scene.collection.objects.link(self.turntable)
        self.rig.parent = self.turntable
        for name, o in objs.items():
            if o.type == "MESH":
                o.hide_render = True
                self.parts[name] = o

    def donor(self, path):
        """Another glb, imported hidden so its meshes can be cloned onto the main rig; deleted in finish()."""
        if path not in self.donors:
            objs, new, acts = self._import(path)
            for o in new:
                if o.name in bpy.data.objects:
                    o.hide_render = True
            self.donors[path] = objs
            self._donor_objs.extend(new)
            self._donor_actions.extend(acts)
        return self.donors[path]

    # -- cloning ---------------------------------------------------------------
    def _adopt(self, src, o, key):
        o.name = key
        self.scene.collection.objects.link(o)
        o.hide_render = True
        o.parent = self.rig
        if src.parent_type == "BONE":
            o.parent_type = "BONE"
            o.parent_bone = src.parent_bone
        else:
            o.parent_type = "OBJECT"
            for m in o.modifiers:
                if m.type == "ARMATURE":
                    m.object = self.rig
        o.matrix_parent_inverse = src.matrix_parent_inverse.copy()
        self.parts[key] = o
        return o

    def clone(self, src, key):
        """Copy a mesh object (own part or donor mesh) onto the MAIN rig: same bone, or same skin."""
        o = src.copy()
        o.data = src.data.copy()
        return self._adopt(src, o, key)

    def take(self, path, name, key):
        """A mesh object from another glb, cloned onto the main rig."""
        return self.clone(self.donor(path)[name], key)

    def asset(self, path, like, key):
        """A standalone asset mesh (a sword gltf) attached exactly like an existing object (same bone, same
        importer corrections): copy that object and swap in the asset's mesh data. `like` is a part key or an object."""
        template = self.parts[like] if isinstance(like, str) else like
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == "MESH"]
        if not meshes:
            raise RuntimeError(f"{path}: no mesh imported")
        o = template.copy()
        o.data = meshes[0].data
        self._adopt(template, o, key)
        for n in new:
            bpy.data.objects.remove(n, do_unlink=True)
        return o

    def hand_template(self, slot="handslot.r"):
        """A weapon object for rigs that ship none (the skeletons): the Knight's 1H_Sword is parented to handslot.r
        with the importer's corrections, and every KayKit rig shares those bones."""
        return self.donor(adv("Knight.glb"))["1H_Sword"]

    # -- mesh edits in REST space ----------------------------------------------
    def verts(self, key):
        me = self.parts[key].data
        n = len(me.vertices)
        arr = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", arr)
        return arr.reshape(n, 3)

    def transform(self, key, matrix):
        me = self.parts[key].data
        me.transform(matrix)
        me.update()

    def scale_about(self, key, pivot, sx, sy=None, sz=None):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        p = Vector(pivot)
        self.transform(key, Matrix.Translation(p) @ Matrix.Diagonal((sx, sy, sz, 1.0)) @ Matrix.Translation(-p))

    def uv_cell(self, key, cell, y_frac=0.38):
        """Flatten every face of a mesh onto one atlas swatch (cell = col + row * 8, row 0 at the top)."""
        me = self.parts[key].data
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
        """Move every loop whose UV sits in swatch `from` to the same spot in swatch `to` (a recolour)."""
        me = self.parts[key].data
        layer = me.uv_layers.active
        n = len(layer.data)
        arr = np.empty(n * 2, np.float32)
        layer.data.foreach_get("uv", arr)
        uv = arr.reshape(n, 2)
        cx = np.clip(np.floor(uv[:, 0] * UV_COLS).astype(int), 0, UV_COLS - 1)
        cy = np.clip(np.floor((1.0 - uv[:, 1]) * UV_ROWS).astype(int), 0, UV_ROWS - 1)
        cell = cx + cy * UV_COLS
        moves = []
        for a, b in mapping.items():
            sel = cell == a
            if not sel.any():
                continue
            dy = 0.0
            if isinstance(b, tuple):   # (cell, shift down the swatch's gradient as a fraction of its height)
                b, dy = b
            moves.append((sel, ((b % UV_COLS) - (a % UV_COLS)) / UV_COLS,
                          -(((b // UV_COLS) - (a // UV_COLS)) + dy) / UV_ROWS))
        for sel, du, dv in moves:   # selections were taken before any move, so a swap chain cannot cascade
            uv[sel, 0] += du
            uv[sel, 1] += dv
        layer.data.foreach_set("uv", uv.reshape(-1))
        me.update()

    def cut(self, key, z, keep="below"):
        """Bisect a mesh with the horizontal plane at rest height z and keep one side, capping the cut (a boot out
        of a leg). Cap faces take the UVs of the side faces they meet, so the cap matches the leg."""
        me = self.parts[key].data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=(0, 0, z),
                               plane_no=(0, 0, 1), clear_outer=(keep == "below"), clear_inner=(keep != "below"))
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            res = bmesh.ops.holes_fill(bm, edges=edges, sides=64)
            caps = set(res["faces"])
            uvl = bm.loops.layers.uv.active
            for f in caps:
                for lp in f.loops:
                    for other in lp.vert.link_loops:
                        if other.face not in caps:
                            lp[uvl].uv = other[uvl].uv
                            break
        bm.to_mesh(me)
        bm.free()
        me.update()

    def boots(self, leg_keys, prefix, z, fat, cell=None):
        """Two boots cut out of a character's legs below rest height z, widened by `fat` about each leg's axis.
        cell=None keeps the leg's own colours (the base boot looks like the model's own feet); a cell recolours."""
        keys = []
        for side, leg in zip(("L", "R"), leg_keys):
            key = f"{prefix}_{side}"
            self.clone(self.parts[leg], key)
            self.cut(key, z, "below")
            v = self.verts(key)
            self.scale_about(key, (v[:, 0].mean(), v[:, 1].mean(), 0.0), fat, fat, 1.0)
            if cell is not None:
                self.uv_cell(key, cell)
            keys.append(key)
        return keys

    # -- finish --------------------------------------------------------------
    def finish(self, used):
        """Delete donor objects, donor actions and every part nothing uses; keep one canonical image per texture."""
        for o in list(self._donor_objs):
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)
        for a in self._donor_actions:
            if a.name in bpy.data.actions:
                bpy.data.actions.remove(a)
        for key in list(self.parts):
            if key not in used:
                o = self.parts.pop(key)
                if o.name in bpy.data.objects:
                    bpy.data.objects.remove(o, do_unlink=True)
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


# ---------------------------------------------------------------------------
# The cast
# ---------------------------------------------------------------------------
# A spec is a dict:
#   id, label, kind, archetype, model, standIn, notes
#   body   keys always drawn (heroes: WITHOUT removable gear; others: the whole figure with its kit)
#   fit    keys the camera frames (never weapons)
#   token  heroes: keys of the base kit token (body minus replaced parts plus base pieces, no boots); others: same as body
#   pieces [ dict(id, role, tier, label, mesh, add, hide, ramp) ]   (heroes only)
#   actions clip -> KayKit action name;  fallbacks list of (clip, wanted, used)

def P(role, tier, label, mesh, add, hide=(), ramp=None, behind=False):
    """behind: the game draws this piece BEFORE the body (LAYER_BEHIND, a cloak), so its static overlay is the whole
    piece rendered alone; the animated layer is still the holdout version (only what shows beside the body)."""
    return dict(role=role, tier=tier, label=label, mesh=mesh, add=list(add), hide=list(hide), ramp=ramp, behind=behind)


COMMON_ACTIONS = {"idle": "Idle", "walk": "Walking_A", "attack": "1H_Melee_Attack_Slice_Diagonal", "hit": "Hit_A",
                  "death": "Death_A", "interact": "Interact", "cheer": "Cheer"}


def actions_with(**over):
    a = dict(COMMON_ACTIONS)
    a.update(over)
    return a


def spec_knight(B):
    B.load_main(adv("Knight.glb"))
    body = ["Knight_Head", "Knight_ArmLeft", "Knight_ArmRight", "Knight_LegLeft", "Knight_LegRight"]
    # The bare torso under the plate: the plate mesh slimmed a little and flattened onto one swatch, so a Knight
    # without his harness is a man in a red gambeson, and the plate (the original Knight_Body) sits over it exactly.
    B.clone(B.parts["Knight_Body"], "torso_under")
    B.scale_about("torso_under", (0, 0, 0), 0.90, 0.90, 1.0)
    B.uv_cell("torso_under", 8)
    body.append("torso_under")
    B.asset(adv_asset("sword_2handed.gltf"), "1H_Sword", "sword_2h")
    B.scale_about("sword_2h", (0, 0, 0), 0.8)
    B.asset(adv_asset("sword_2handed_color.gltf"), "1H_Sword", "sword_2h_gold")
    B.scale_about("sword_2h_gold", (0, 0, 0), 0.8)
    B.asset(adv_asset("shield_badge_color.gltf"), "Badge_Shield", "shield_badge_color")
    B.asset(adv_asset("shield_spikes_color.gltf"), "Badge_Shield", "shield_spike_color")
    B.take(adv("Mage.glb"), "Mage_Cape", "cape_mage")
    B.take(adv("Rogue.glb"), "Rogue_Cape", "cape_rogue")
    B.take(ske("Skeleton_Warrior.glb"), "Skeleton_Warrior_Helmet", "helm_horned")
    boots_b = B.boots(("Knight_LegLeft", "Knight_LegRight"), "boot_base", 0.17, 1.04)
    boots_r = B.boots(("Knight_LegLeft", "Knight_LegRight"), "boot_rare", 0.23, 1.15, cell=12)
    pieces = [
        P("weapon", "base", "1H_Sword", "sword_1handed", ["1H_Sword"], ramp="metal"),
        P("weapon", "rare", "sword_2handed", "sword_2handed", ["sword_2h"]),
        P("weapon", "legendary", "sword_2handed_color", "sword_2handed_color", ["sword_2h_gold"]),
        P("outer", "base", "Badge_Shield", "shield_badge", ["Badge_Shield"], ramp="metal"),
        P("outer", "rare", "shield_badge_color", "shield_badge_color", ["shield_badge_color"]),
        P("outer", "legendary", "shield_spikes_color", "shield_spikes_color", ["shield_spike_color"]),
        P("crown", "base", "Knight_Body + Knight_Helmet + Knight_Cape", "Knight_Body, Knight_Helmet, Knight_Cape",
          ["Knight_Body", "Knight_Helmet", "Knight_Cape"], ["torso_under"], ramp="metal"),
        P("crown", "rare", "Knight_Body + Knight_Helmet + Mage_Cape", "Knight_Body, Knight_Helmet, Mage_Cape",
          ["Knight_Body", "Knight_Helmet", "cape_mage"], ["torso_under"]),
        P("crown", "legendary", "Knight_Body + Skeleton_Warrior_Helmet + Rogue_Cape",
          "Knight_Body, Skeleton_Warrior_Helmet, Rogue_Cape", ["Knight_Body", "helm_horned", "cape_rogue"], ["torso_under"]),
        P("boots", "base", "legs below the ankle", "Knight_LegLeft/Right (cut)", boots_b, ramp="metal"),
        P("boots", "rare", "legs below the shin, gold", "Knight_LegLeft/Right (cut, recoloured)", boots_r),
    ]
    fit = ["Knight_Body", "Knight_Head", "Knight_ArmLeft", "Knight_ArmRight", "Knight_LegLeft", "Knight_LegRight",
           "Knight_Helmet", "Knight_Cape"]
    return dict(id="token_knight", label="Knight", kind="hero", archetype="knight", model="Knight", standIn=False,
                notes="Body without gear; sword, badge shield, plate harness with helmet and cape, and boots are layers. "
                      "Base layers together are the Knight the harness renders.",
                body=body, fit=fit, pieces=pieces, actions=actions_with())


def spec_shadow(B):
    B.load_main(adv("Rogue_Hooded.glb"))
    # Rogue_Hooded's head already wears the hood: the bare head comes from the Rogue, and the hooded head is the base crown.
    B.take(adv("Rogue.glb"), "Rogue_Head", "Rogue_Head")
    # The hooded head is the bare head's hair-free twin, so the hair would poke out of the hood. Slim the bare head
    # a little about its neck so it sits wholly inside the hooded head's silhouette: the hood layer then covers it
    # exactly, and the figure without a hood is simply a Rogue with a slightly smaller head.
    hv = B.verts("Rogue_Head")
    B.scale_about("Rogue_Head", (hv[:, 0].mean(), hv[:, 1].mean(), hv[:, 2].min()), 0.84)
    body = ["Rogue_Body", "Rogue_Head", "Rogue_ArmLeft", "Rogue_ArmRight", "Rogue_LegLeft", "Rogue_LegRight"]
    B.asset(adv_asset("dagger.gltf"), "Knife", "dagger")
    B.asset(ske_asset("Skeleton_Blade.gltf"), "Knife", "blade_skel")
    B.scale_about("blade_skel", (0, 0, 0), 0.55)
    B.take(adv("Knight.glb"), "Knight_Cape", "cape_knight")
    B.take(ske("Skeleton_Rogue.glb"), "Skeleton_Rogue_Cape", "cape_skel")
    B.take(ske("Skeleton_Rogue.glb"), "Skeleton_Rogue_Hood", "hood_skel")
    B.take(ske("Skeleton_Rogue.glb"), "Skeleton_Rogue_Head", "skull_head")
    B.take(ske("Skeleton_Rogue.glb"), "Skeleton_Rogue_Jaw", "skull_jaw")
    B.take(ske("Skeleton_Rogue.glb"), "Skeleton_Rogue_Eyes", "skull_eyes")
    boots_b = B.boots(("Rogue_LegLeft", "Rogue_LegRight"), "boot_base", 0.17, 1.04)
    boots_r = B.boots(("Rogue_LegLeft", "Rogue_LegRight"), "boot_rare", 0.23, 1.15, cell=25)
    pieces = [
        P("weapon", "base", "dagger", "dagger", ["dagger"], ramp="metal"),
        P("weapon", "rare", "Knife", "Knife (the Rogue's own)", ["Knife"]),
        P("weapon", "legendary", "Skeleton_Blade", "Skeleton_Blade", ["blade_skel"]),
        P("outer", "base", "Rogue_Cape", "Rogue_Cape", ["Rogue_Cape"], ramp="cloth", behind=True),
        P("outer", "rare", "Knight_Cape", "Knight_Cape", ["cape_knight"], behind=True),
        P("outer", "legendary", "Skeleton_Rogue_Cape", "Skeleton_Rogue_Cape", ["cape_skel"], behind=True),
        P("crown", "base", "Rogue_Head_Hooded", "Rogue_Head_Hooded", ["Rogue_Head_Hooded"], ["Rogue_Head"], ramp="cloth"),
        P("crown", "rare", "Skeleton_Rogue_Hood", "Skeleton_Rogue_Hood on the bare head", ["hood_skel"]),
        P("crown", "legendary", "Skeleton_Rogue_Hood + skull", "Skeleton_Rogue_Hood, Skeleton_Rogue_Head/Jaw/Eyes",
          ["hood_skel", "skull_head", "skull_jaw", "skull_eyes"], ["Rogue_Head"]),
        P("boots", "base", "legs below the ankle", "Rogue_LegLeft/Right (cut)", boots_b, ramp="cloth"),
        P("boots", "rare", "legs below the shin, orange", "Rogue_LegLeft/Right (cut, recoloured)", boots_r),
    ]
    fit = ["Rogue_Body", "Rogue_Head_Hooded", "Rogue_ArmLeft", "Rogue_ArmRight", "Rogue_LegLeft", "Rogue_LegRight",
           "Rogue_Cape"]
    return dict(id="token_shadow", label="Shadow", kind="hero", archetype="shadow", model="Rogue_Hooded", standIn=False,
                notes="Rogue_Hooded with a dagger. Body is the bare-headed Rogue; hood, cloak, dagger and boots are layers.",
                body=body, fit=fit, pieces=pieces, actions=actions_with(attack="1H_Melee_Attack_Stab"))


def spec_fireball(B):
    B.load_main(adv("Mage.glb"))
    body = ["Mage_Body", "Mage_Head", "Mage_ArmLeft", "Mage_ArmRight", "Mage_LegLeft", "Mage_LegRight"]
    B.asset(ske_asset("Skeleton_Staff.gltf"), "2H_Staff", "staff_skel")
    B.clone(B.parts["2H_Staff"], "staff_long")
    B.scale_about("staff_long", (0, 0, 0), 1.3)
    B.take(adv("Knight.glb"), "Knight_Cape", "cape_knight")
    B.take(adv("Rogue.glb"), "Rogue_Cape", "cape_sun")
    B.uv_cell("cape_sun", 25)
    B.take(ske("Skeleton_Mage.glb"), "Skeleton_Mage_Hat", "hat_skel")
    B.clone(B.parts["Mage_Hat"], "hat_gold")
    B.uv_swap("hat_gold", {9: 26})
    boots_b = B.boots(("Mage_LegLeft", "Mage_LegRight"), "boot_base", 0.17, 1.04)
    boots_r = B.boots(("Mage_LegLeft", "Mage_LegRight"), "boot_rare", 0.23, 1.15, cell=26)
    pieces = [
        P("weapon", "base", "2H_Staff", "2H_Staff (the Mage's own)", ["2H_Staff"], ramp="cloth"),
        P("weapon", "rare", "Skeleton_Staff", "Skeleton_Staff", ["staff_skel"]),
        P("weapon", "legendary", "2H_Staff x1.3", "2H_Staff (longer)", ["staff_long"]),
        P("outer", "base", "Mage_Cape", "Mage_Cape", ["Mage_Cape"], ramp="cloth", behind=True),
        P("outer", "rare", "Knight_Cape", "Knight_Cape", ["cape_knight"], behind=True),
        P("outer", "legendary", "Rogue_Cape, sun colours", "Rogue_Cape (recoloured)", ["cape_sun"], behind=True),
        P("crown", "base", "Mage_Hat", "Mage_Hat", ["Mage_Hat"], ramp="cloth"),
        P("crown", "rare", "Skeleton_Mage_Hat", "Skeleton_Mage_Hat", ["hat_skel"]),
        P("crown", "legendary", "Mage_Hat, gold", "Mage_Hat (recoloured)", ["hat_gold"]),
        P("boots", "base", "legs below the ankle", "Mage_LegLeft/Right (cut)", boots_b, ramp="cloth"),
        P("boots", "rare", "legs below the shin, gold", "Mage_LegLeft/Right (cut, recoloured)", boots_r),
    ]
    fit = body + ["Mage_Hat", "Mage_Cape"]
    return dict(id="token_fireball_person", label="Fireball Person", kind="hero", archetype="fireball-person",
                model="Mage", standIn=False,
                notes="Mage with a staff and its own hat. Body is the bare Mage; staff, cape, hat and boots are layers.",
                body=body, fit=fit, pieces=pieces, actions=actions_with(idle="2H_Melee_Idle", attack="Spellcast_Shoot"))


def spec_skeleton(B):
    B.load_main(ske("Skeleton_Minion.glb"))
    body = [k for k in B.main if B.main[k].type == "MESH"]
    B.asset(ske_asset("Skeleton_Blade.gltf"), B.hand_template(), "skeleton_sword")
    fit = list(body)
    body = body + ["skeleton_sword"]
    return dict(id="token_skeleton", label="Skeleton", kind="monster", archetype=None, model="Skeleton_Minion",
                standIn=False, notes="Skeleton_Minion with the pack's Skeleton_Blade.", body=body, fit=fit, pieces=[],
                actions=actions_with(walk="Walking_D_Skeletons"))


def spec_villager(B):
    B.load_main(adv("Barbarian.glb"))
    body = ["Barbarian_Body", "Barbarian_Head", "Barbarian_ArmLeft", "Barbarian_ArmRight", "Barbarian_LegLeft",
            "Barbarian_LegRight"]
    fit = list(body)
    body = body + ["Mug"]
    return dict(id="token_villager", label="Villager", kind="npc", archetype=None, model="Barbarian", standIn=False,
                notes="Barbarian, unarmed, holding a mug.", body=body, fit=fit, pieces=[],
                actions=actions_with(attack="Unarmed_Melee_Attack_Punch_A"))


def spec_guard(B):
    B.load_main(adv("Barbarian.glb"))
    body = ["Barbarian_Body", "Barbarian_Head", "Barbarian_ArmLeft", "Barbarian_ArmRight", "Barbarian_LegLeft",
            "Barbarian_LegRight", "Barbarian_Hat"]
    fit = list(body)
    body = body + ["1H_Axe", "Barbarian_Round_Shield"]
    return dict(id="token_guard", label="Guard", kind="npc", archetype=None, model="Barbarian", standIn=False,
                notes="Barbarian with an axe, the round shield and the bear-skin helm, so it does not read as the Knight.",
                body=body, fit=fit, pieces=[], actions=actions_with(attack="1H_Melee_Attack_Chop"))


def spec_robed(B):
    B.load_main(ske("Skeleton_Mage.glb"))
    body = [k for k in B.main if B.main[k].type == "MESH" and k != "Skeleton_Mage_Hat"]
    B.take(ske("Skeleton_Rogue.glb"), "Skeleton_Rogue_Hood", "hood")
    body.append("hood")
    return dict(id="token_robed_figure", label="Robed Figure", kind="npc", archetype=None, model="Skeleton_Mage",
                standIn=False, notes="Skeleton_Mage's robe with the Skeleton_Rogue hood pulled up.", body=body,
                fit=list(body), pieces=[], actions=actions_with(attack="Spellcast_Shoot"))


CAST = {
    "token_knight": spec_knight,
    "token_shadow": spec_shadow,
    "token_fireball_person": spec_fireball,
    "token_skeleton": spec_skeleton,
    "token_villager": spec_villager,
    "token_guard": spec_guard,
    "token_robed_figure": spec_robed,
}
SHORT = {"knight": "token_knight", "shadow": "token_shadow", "fireball": "token_fireball_person",
         "skeleton": "token_skeleton", "villager": "token_villager", "guard": "token_guard",
         "robed": "token_robed_figure"}

# Ids the library deliberately does NOT supply: the owner keeps the game's own hand-drawn sprite for them. The bench
# falls back to it for any id the library does not cover; the game has no KayKit loader yet, so the switch-over must
# carry these ids over itself. assemble records each one as a gap with this reason instead of the generic "not rendered
# by cast.py". To keep another id hand-drawn, add it here AND drop it from CAST and SHORT (HAND_DRAWN alone only changes
# the parts; the cast would still animate the KayKit figure).
HAND_DRAWN = {
    "token_goblin": "kept hand-drawn: the owner prefers the game's own goblin (2026-10-01)",
}


def tier_gear_id(spec, pc):
    key = spec["archetype"].replace("-", "_")
    return f"gear_{key}_{pc['role']}_{pc['tier']}"


def build_spec(H, char_id):
    B = Builder(H)
    spec = CAST[char_id](B)
    used = set(spec["body"]) | set(spec["fit"])
    for pc in spec["pieces"]:
        pc["id"] = tier_gear_id(spec, pc)
        used |= set(pc["add"]) | set(pc["hide"])
    B.finish(used)
    spec["B"] = B
    return spec


# ---------------------------------------------------------------------------
# Framing (the harness's rules, per character)
# ---------------------------------------------------------------------------

def make_camera(ctx, H):
    cd = bpy.data.cameras.new("SpriteCam")
    cd.type = "ORTHO"
    cd.sensor_fit = "VERTICAL"
    cd.clip_start = 0.01
    cd.clip_end = 200.0
    cam = bpy.data.objects.new("SpriteCam", cd)
    ctx.scene.collection.objects.link(cam)
    ctx.scene.camera = cam
    cam.rotation_euler = (math.radians(90.0 - H.CAMERA_PITCH_DEG), 0.0, 0.0)
    ctx.camera = cam
    return cam


def extent_of(ctx, H, parts, keys):
    """Projected (min_r, max_r, min_u, max_u) of the given parts in the current pose (harness.figure_extent)."""
    dg = bpy.context.evaluated_depsgraph_get()
    r, u, _ = H.camera_basis()
    rs, us = [], []
    for name in keys:
        ob = parts[name].evaluated_get(dg)
        me = ob.to_mesh()
        mw = ob.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            rs.append(w.dot(r))
            us.append(w.dot(u))
        ob.to_mesh_clear()
    return min(rs), max(rs), min(us), max(us)


class Framing:
    """The camera for one character at one size. Animation framing = harness.frame_camera (figure fills token_h - 1
    pixels, centred on the figure's own extent, feet on the canvas bottom edge). Static framing (`static=True`) may
    scale down (never up) and shift sideways so the base-kit figure fits the token box; every layer of that
    character uses the same one, so they register."""

    def __init__(self, H, extent, box_w, box_h, k):
        self.H = H
        self.k = k
        sid = "16x24" if k == 1 else "32x48"
        self.size = H.Size({"id": sid, "token_w": box_w * k, "token_h": box_h * k})
        min_r, max_r, min_u, max_u = extent
        self.wpp0 = (max_u - min_u) / (self.size.token_h - 1)
        self.cam_r0 = (min_r + max_r) / 2.0
        self.min_u = min_u
        self.scale = 1.0     # static fit: 1.0 = the animation framing; <1 shrinks the figure
        self.shift = 0.0     # static fit: world shift of the camera along the screen's right axis

    def apply(self, ctx, static=False):
        s = self.size
        wpp = self.wpp0 / (self.scale if static else 1.0)
        r, u, f = self.H.camera_basis()
        cam_r = self.cam_r0 + (self.shift if static else 0.0)
        s.world_per_px = wpp
        ctx.camera.data.ortho_scale = s.canvas_h * wpp
        cam_u = self.min_u + s.canvas_h / 2.0 * wpp
        ctx.camera.location = r * cam_r + u * cam_u - f * 40.0
        ctx.size = s
        return s


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


def postprocess(ov, pc, pal):
    """Base metal pieces onto GEAR_RAMP; every other base piece off the three ramp steps the uncommon remap moves."""
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


# ---------------------------------------------------------------------------
# One character rendered through one style
# ---------------------------------------------------------------------------

class CastRender:
    MASK_SS = 8
    MASK_COVER = 0.40
    MASK_MARGIN = 0.10      # dead band either side of MASK_COVER inside a clip (stills use the plain threshold)

    def __init__(self, H, char_id, style_name):
        self.H = H
        self.char_id = char_id
        self.style_name = style_name
        t = load_targets()[char_id]
        self.box_w, self.box_h = t["w16"], t["h16"]
        self.spec = build_spec(H, char_id)
        self.B = self.spec["B"]
        self.parts = self.B.parts
        ctx = H.Ctx()
        ctx.scene = bpy.context.scene
        ctx.rig = self.B.rig
        ctx.turntable = self.B.turntable
        ctx.objects = dict(self.parts)
        with open(PALETTE_JSON) as fh:
            ctx.palette = np.array(json.load(fh)["palette"], dtype=np.uint8)
        os.makedirs(os.path.dirname(ctx.tmp_png), exist_ok=True)
        self.ctx = ctx
        make_camera(ctx, H)
        # extents BEFORE the style prepares: toon adds hull modifiers that would inflate them
        idle = self.spec["actions"]["idle"]
        self.pose(idle, bpy.data.actions[idle].frame_range[0], 0.0)
        self.extent = extent_of(ctx, H, self.parts, self.spec["fit"])
        self.framings = {k: Framing(H, self.extent, self.box_w, self.box_h, k) for k in SIZES_K}
        self.style_name = style_name
        if style_name:
            self.style = load_module(os.path.join(ROOT, "scripts", "kaykit", "styles", f"{style_name}.py"),
                                     f"kk_cast_style_{style_name}_{char_id}")
            self.style.prepare(ctx)
        self.stats = {"renders": 0, "mask_renders": 0, "layer_mismatch": 0, "layer_pixels": 0}
        self.warnings = []

    # -- posing / showing -----------------------------------------------------
    def pose(self, action, t, deg):
        self.H.pose(self.ctx, action, t, deg)

    def show(self, keys):
        ks = set(keys)
        for k, o in self.parts.items():
            o.hide_render = k not in ks

    def render(self, keys, stream="body"):
        """One style render of the parts in `keys`. `stream` names the render for the temporal memory (ctx.mem): every
        thing drawn each frame (the body, each gear layer) keeps its own memory, so two renders of one frame never
        read each other's."""
        self.show(keys)
        self.ctx.mem.stream = stream
        f = self.style.render_frame(self.ctx, self.ctx.size)
        size = self.ctx.size
        if f.shape != (size.canvas_h, size.canvas_w) or f.dtype != np.uint8:
            raise RuntimeError(f"style returned {f.shape} {f.dtype}")
        bad = (f != TRANSPARENT) & (f >= self.ctx.usable)
        if bad.any():
            raise RuntimeError("style used reserved or out-of-range palette indices")
        self.stats["renders"] += 1
        return f

    def gear_mask(self, gear_keys, vis_keys, stream="mask"):
        """Canvas-sized bool: the nearest surface is one of gear_keys (Workbench object colours, no AA, supersampled).
        Inside a clip the coverage threshold has a dead band (MASK_COVER +- MASK_MARGIN, remembered per `stream`), so
        a layer's membership does not flicker on a pixel the piece only just covers."""
        ctx, s = self.ctx, self.ctx.scene
        ctx.mem.stream = stream
        sh = s.display.shading
        saved = (s.render.engine, sh.light, sh.color_type, tuple(sh.single_color), s.display.render_aa,
                 s.view_settings.view_transform)
        s.render.engine = "BLENDER_WORKBENCH"
        sh.light = "FLAT"
        sh.color_type = "OBJECT"
        s.display.render_aa = "OFF"
        s.view_settings.view_transform = "Standard"
        gk, vk = set(gear_keys), set(vis_keys) | set(gear_keys)
        for k, o in self.parts.items():
            o.color = (1.0, 0.0, 0.0, 1.0) if k in gk else (0.0, 0.0, 0.0, 1.0)
            o.hide_render = k not in vk
        rgba = ctx.render_rgba(ss=self.MASK_SS)
        (s.render.engine, sh.light, sh.color_type, sh.single_color, s.display.render_aa,
         s.view_settings.view_transform) = saved
        ss = self.MASK_SS
        size = ctx.size
        hit = ((rgba[..., 3] > 0.5) & (rgba[..., 0] > 0.5)).astype(np.float32)
        cover = hit.reshape(size.canvas_h, ss, size.canvas_w, ss).mean(axis=(1, 3))
        self.stats["mask_renders"] += 1
        return ctx.mem.level("cover", cover, (self.MASK_COVER,), self.MASK_MARGIN) > 0

    # -- layers -----------------------------------------------------------------
    def vis_with(self, pc):
        return [q for q in self.spec["body"] if q not in pc["hide"]] + pc["add"]

    def layer(self, pc, A, track=True):
        """The piece as an overlay on body render A: where it is the nearest surface, plus its own outline."""
        vis = self.vis_with(pc)
        Bf = self.render(vis, "L:" + pc["id"])
        M = self.gear_mask(pc["add"], vis, "M:" + pc["id"])
        near = dilate(M, 6 if (pc["hide"] or pc["role"] == "outer") else 4)
        sel = M | ((Bf != A) & near)
        ov = np.where(sel, Bf, TRANSPARENT).astype(np.uint8)
        if track:
            comp = np.where(sel, Bf, A)
            mm = int((comp != Bf).sum())
            self.stats["layer_mismatch"] += mm
            self.stats["layer_pixels"] += int((ov != TRANSPARENT).sum())
            self.stats["mm:" + pc["id"]] = self.stats.get("mm:" + pc["id"], 0) + mm
        return ov

    def kit_keys(self):
        """The base-kit token: the body with every base piece (boots left out: the legs already wear them)."""
        keys = list(self.spec["body"])
        for pc in self.spec["pieces"]:
            if pc["tier"] == "base" and pc["role"] != "boots":
                keys = [k for k in keys if k not in pc["hide"]] + pc["add"]
        return keys

    # -- static fit -------------------------------------------------------------
    def fit_static(self, k):
        """Static framing for size k: scale down uniformly (never up) if the base-kit figure is wider than the token
        box, and shift sideways if it pokes out of the box. The same framing is used for the token and every layer."""
        fr = self.framings[k]
        fr.scale, fr.shift = 1.0, 0.0
        size = fr.apply(self.ctx, static=True)
        idle = self.spec["actions"]["idle"]
        self.pose(idle, bpy.data.actions[idle].frame_range[0], 0.0)
        tw, th = self.box_w * k, self.box_h * k
        win0 = size.canvas_w // 2 - tw // 2
        for _ in range(8):
            kit = self.render(self.kit_keys())
            ys, xs = np.nonzero(kit != TRANSPARENT)
            if not len(xs):
                break
            x0, x1 = int(xs.min()), int(xs.max())
            w = x1 - x0 + 1
            wpp = size.world_per_px
            if w > tw:
                fr.scale *= max(0.5, (tw - 0.0) / w) * 0.995
                fr.apply(self.ctx, static=True)
                continue
            if x0 < win0 or x1 >= win0 + tw:
                cx = (x0 + x1 + 1) / 2.0 - size.canvas_w / 2.0
                fr.shift += cx * wpp
                fr.apply(self.ctx, static=True)
                continue
            break
        return fr


SIZES_K = (1, 2)


def pack_frames(H, frames):
    return H.pack_frames(frames)


def clip_entry(size_k, clip_id, facing, frames, loop, fps, data):
    return {"size": str(16 * size_k), "clip": clip_id, "dir": facing, "count": len(frames), "loop": loop, "fps": fps,
            "data": data}


def plan_clips(quick):
    H_CLIPS = [("idle", 6, True), ("walk", 8, True), ("attack", 8, False), ("hit", 4, False), ("death", 8, False),
               ("interact", 6, False), ("cheer", 8, False)]
    return [c for c in H_CLIPS if c[0] in ("idle", "attack")] if quick else H_CLIPS


def to_rows(a):
    a = a.astype(np.int16)
    a[a == TRANSPARENT] = -1
    return a.tolist()


def window(arr, size, tw, th):
    x0 = size.canvas_w // 2 - tw // 2
    y0 = size.canvas_h - th
    return arr[y0:y0 + th, x0:x0 + tw]


def render_character(H, char_id, style_name, quick=False, sizes_k=SIZES_K, clips=None, anim=True, static=True,
                     tag="all"):
    """Render one character through one style. `clips` limits which clips (names); `anim` / `static` choose the
    animation and/or the static token and overlays. A run writes one raw file; several runs of the same
    (style, character) with different tags merge in assemble, so one hero can be split across processes."""
    t0 = time.time()
    cr = CastRender(H, char_id, style_name)
    spec = cr.spec
    ctx = cr.ctx
    pal = ctx.palette
    pieces = spec["pieces"]
    plan = [c for c in plan_clips(quick) if clips is None or c[0] in clips]
    body_clips, gear_clips = [], {pc["id"]: [] for pc in pieces}
    statics = {}
    warnings = cr.warnings
    n_frames = 0
    # --- animation
    for k in (sizes_k if anim else ()):
        fr = cr.framings[k]
        size = fr.apply(ctx, static=False)
        for clip_id, n, loop in plan:
            action = spec["actions"][clip_id]
            a, b = bpy.data.actions[action].frame_range
            times = H.sample_times(action, n, loop)
            seconds = (b - a) / 24.0
            fps = round(n / seconds, 3) if seconds > 0 else 8
            for facing, deg in H.FACINGS:
                ctx.clip, ctx.facing = clip_id, facing
                frames = []
                gframes = {pc["id"]: [] for pc in pieces}
                # ClipRun poses the figure, snaps the camera to whole pixels where the clip asks for it, and runs a
                # looping clip twice (a warm-up pass whose frames are dropped) so the temporal memory wraps.
                for _i, tt, keep in H.ClipRun(ctx, action, times, deg, loop, clip_id).steps():
                    A = cr.render(spec["body"], "body")
                    if keep:
                        frames.append(A)
                    for pc in pieces:
                        ov = cr.layer(pc, A, track=keep)
                        if pc["tier"] == "base":
                            ov = postprocess(ov, pc, pal)
                        if keep:
                            gframes[pc["id"]].append(ov)
                    n_frames += int(keep)
                body_clips.append(clip_entry(k, clip_id, facing, frames, loop, fps, H.pack_frames(frames)))
                for pid, fl in gframes.items():
                    gear_clips[pid].append(clip_entry(k, clip_id, facing, fl, loop, fps, H.pack_frames(fl)))
        print(f"[{style_name}/{char_id}/{tag}] size {16 * k} animation done, {cr.stats['renders']} renders, "
              f"{time.time() - t0:.1f}s", flush=True)
    # --- static token and overlays (frame 0 of idle, facing down, fitted into the token box)
    tokens = {}
    for k in (sizes_k if static else ()):
        fr = cr.fit_static(k)
        size = ctx.size
        tw, th = cr.box_w * k, cr.box_h * k
        idle = spec["actions"]["idle"]
        cr.pose(idle, bpy.data.actions[idle].frame_range[0], 0.0)
        kit = cr.render(cr.kit_keys())
        crop = window(kit, size, tw, th)
        clipped = int((kit != TRANSPARENT).sum() - (crop != TRANSPARENT).sum())
        if clipped:
            warnings.append(f"{char_id} {16 * k}px token: {clipped} opaque pixels fall outside the {tw}x{th} box")
        tokens.setdefault(char_id, {})[str(16 * k)] = to_rows(crop)
        statics.setdefault("fit", {})[str(16 * k)] = {"scale": round(fr.scale, 4), "shift": round(fr.shift, 5)}
        if pieces:
            A = cr.render(spec["body"])
            for pc in pieces:
                ov = cr.render(pc["add"]) if pc.get("behind") else cr.layer(pc, A, track=False)
                if pc["tier"] == "base":
                    ov = postprocess(ov, pc, pal)
                oc = window(ov, size, tw, th)
                clipped = int((ov != TRANSPARENT).sum() - (oc != TRANSPARENT).sum())
                if clipped:
                    warnings.append(f"{pc['id']} {16 * k}px: {clipped} opaque pixels fall outside the token box")
                tokens.setdefault(pc["id"], {})[str(16 * k)] = to_rows(oc)
    meta = {str(16 * k): cr.framings[k].size.meta() for k in SIZES_K}
    character = {"id": char_id, "label": spec["label"], "kind": spec["kind"], "archetype": spec["archetype"],
                 "model": spec["model"], "standIn": spec["standIn"], "notes": spec["notes"], "sizes": meta,
                 "clips": body_clips}
    gear = []
    targets = load_targets()
    for pc in pieces:
        nm = targets.get(pc["id"], {}).get("name", pc["label"])
        gear.append({"id": pc["id"], "archetype": spec["archetype"], "role": pc["role"],
                     "tier": pc["tier"], "label": f"{nm} ({pc['label']})", "character": char_id, "mesh": pc["mesh"],
                     "replaces": pc["hide"], "clips": gear_clips[pc["id"]]})
    order = layer_orders(cr) if pieces else {}
    secs = round(time.time() - t0, 1)
    doc = {"char": char_id, "style": style_name, "tag": tag, "character": character, "gear": gear, "tokens": tokens,
           "statics": statics, "layerOrder": order, "warnings": warnings, "stats": cr.stats, "frames": n_frames,
           "actions": spec["actions"], "seconds": secs, "quick": quick,
           "pieceInfo": [{k: pc[k] for k in ("id", "role", "tier", "label", "mesh", "add", "hide", "ramp", "behind")} for pc in pieces]}
    os.makedirs(RAW_DIR, exist_ok=True)
    out = os.path.join(RAW_DIR, f"raw-{style_name}-{char_id}-{tag}{'-quick' if quick else ''}.json")
    with open(out, "w") as fh:
        json.dump(doc, fh)
    mm = cr.stats["layer_mismatch"]
    print(f"[{style_name}/{char_id}/{tag}] done: {n_frames} frames, {cr.stats['renders']} style renders, "
          f"{cr.stats['mask_renders']} masks, layer composite mismatch {mm}/{cr.stats['layer_pixels']} px, "
          f"{len(warnings)} warnings, {secs}s -> {out}", flush=True)
    for w in warnings:
        print("   warn:", w, flush=True)
    return doc


def layer_orders(cr):
    """Per facing, the role order to draw a hero's layers after its body (bottom first). 'down' is the game's own
    (LAYER_* ints from equipmentTypes.ts); the other three facings sort by how far each base piece sits from the
    camera in that facing (far first), the game's layer as tie-break, because a cloak that hangs behind the figure
    when it faces us is in front of it from behind, and a shield is on the near or far side depending on the turn."""
    H, ctx, spec = cr.H, cr.ctx, cr.spec
    game_layer = {"knight": {"weapon": 40, "outer": 35, "crown": 30, "boots": 25},
                  "shadow": {"weapon": 40, "outer": 10, "crown": 50, "boots": 25},
                  "fireball-person": {"weapon": 40, "outer": 10, "crown": 50, "boots": 25}}[spec["archetype"]]
    idle = spec["actions"]["idle"]
    r, u, f = H.camera_basis()
    out = {}
    base = {pc["role"]: pc for pc in spec["pieces"] if pc["tier"] == "base"}
    for facing, deg in H.FACINGS:
        if facing == "down":
            out[facing] = sorted(base, key=lambda role: game_layer[role])
            continue
        cr.pose(idle, bpy.data.actions[idle].frame_range[0], deg)
        depth = {}
        dg = bpy.context.evaluated_depsgraph_get()
        for role, pc in base.items():
            ds = []
            for name in pc["add"]:
                ob = cr.parts[name].evaluated_get(dg)
                me = ob.to_mesh()
                mw = ob.matrix_world
                ds.extend(float((mw @ v.co).dot(f)) for v in me.vertices)
                ob.to_mesh_clear()
            depth[role] = sum(ds) / len(ds)
        # far first; pieces within 4 cm of each other keep the game's order
        roles = sorted(base, key=lambda role: game_layer[role])
        ordered = []
        for role in roles:
            i = len(ordered)
            while i > 0 and depth[ordered[i - 1]] < depth[role] - 0.04:
                i -= 1
            ordered.insert(i, role)
        out[facing] = ordered
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    global RUN, RAW_DIR
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if "--run" in argv:
        RUN = argv[argv.index("--run") + 1]
        RAW_DIR = os.path.join(SCRATCH, f"raw-{RUN}")
    opts = {"cmd": argv[0] if argv else "render", "style": None, "chars": None, "quick": False, "sizes": SIZES_K,
            "clips": None, "static": "yes", "tag": "all"}
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--style":
            opts["style"] = argv[i + 1]
            i += 2
        elif a == "--chars":
            opts["chars"] = [SHORT.get(x, x) for x in argv[i + 1].split(",")]
            i += 2
        elif a == "--quick":
            opts["quick"] = True
            i += 1
        elif a == "--clips":
            opts["clips"] = argv[i + 1].split(",")
            i += 2
        elif a == "--static":
            opts["static"] = argv[i + 1]   # yes | no | only
            i += 2
        elif a == "--tag":
            opts["tag"] = argv[i + 1]
            i += 2
        elif a == "--sizes":
            opts["sizes"] = tuple(int(x) // 16 for x in argv[i + 1].split(","))
            i += 2
        elif a == "--stabilise":
            STAB["on"] = argv[i + 1] != "off"
            i += 2
        elif a == "--snap":
            STAB["snap"] = tuple(x for x in argv[i + 1].split(",") if x and x != "none")
            i += 2
        else:
            i += 1
    return opts


def cmd_render(opts):
    H = load_harness()
    style = opts["style"] or "plain"
    for cid in opts["chars"] or list(CAST):
        render_character(H, cid, style, quick=opts["quick"], sizes_k=opts["sizes"], clips=opts["clips"],
                         anim=opts["static"] != "only", static=opts["static"] != "no", tag=opts["tag"])


# ---------------------------------------------------------------------------
# Preview: a hi-res look at the 3D parts (Workbench studio light), before any pixel conversion
# ---------------------------------------------------------------------------

def read_px(path, w, h):
    img = bpy.data.images.load(path, check_existing=False)
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1].copy()


def write_sheet(H, tiles, cols, path, bg=0.38):
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


def cmd_preview(opts):
    H = load_harness()
    os.makedirs(SCRATCH, exist_ok=True)
    tile_w, tile_h = 220, 330
    for cid in opts["chars"] or list(CAST):
        t0 = time.time()
        cr = CastRender(H, cid, None)
        ctx, spec, s = cr.ctx, cr.spec, cr.ctx.scene
        s.render.engine = "BLENDER_WORKBENCH"
        s.display.shading.light = "STUDIO"
        s.display.shading.color_type = "TEXTURE"
        s.display.render_aa = "8"
        min_r, max_r, min_u, max_u = cr.extent
        hgt = (max_u - min_u) * 1.45
        r, u, f = H.camera_basis()
        cam_u = 0.5 * (min_u + max_u) + 0.04 * hgt
        s.render.resolution_x, s.render.resolution_y = tile_w, tile_h
        s.render.resolution_percentage = 100
        ctx.camera.data.ortho_scale = hgt
        ctx.camera.location = r * (0.5 * (min_r + max_r)) + u * cam_u - f * 40.0
        idle = spec["actions"].get(opts.get("action", "idle"), spec["actions"]["idle"])

        def shot(keys, deg, frac=0.0):
            cr.show(keys)
            a, b = bpy.data.actions[idle].frame_range
            cr.pose(idle, a + (b - a) * frac, deg)
            s.render.filepath = ctx.tmp_png
            bpy.ops.render.render(write_still=True)
            return read_px(ctx.tmp_png, tile_w, tile_h)

        tiles = []
        kit = cr.kit_keys()
        for deg in (0.0, 90.0, 180.0, -90.0):
            tiles.append(shot(kit, deg))
        for deg in (0.0, 90.0, 180.0, -90.0):
            tiles.append(shot(spec["body"], deg))
        for pc in spec["pieces"]:
            for deg in (0.0, 180.0):
                tiles.append(shot(cr.vis_with(pc), deg))
        write_sheet(H, tiles, 8, os.path.join(SCRATCH, f"preview_{cid}.png"))
        print(f"[preview {cid}] {len(tiles)} tiles, {time.time() - t0:.1f}s -> preview_{cid}.png", flush=True)


# ---------------------------------------------------------------------------
# Assemble: raw renders -> cast.json, tokens parts, contact sheets
# ---------------------------------------------------------------------------

FONT = {
    "A": "010101111101101", "B": "110101110101110", "C": "011100100100011", "D": "110101101101110",
    "E": "111100110100111", "F": "111100110100100", "G": "011100101101011", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101010", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "Q": "010101101110011", "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101010010010", "Z": "111001010100111", "0": "111101101101111", "1": "010110010010111",
    "2": "110001010100111", "3": "110001010001110", "4": "101101111001001", "5": "111100110001110",
    "6": "011100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001110",
    "_": "000000000000111", "-": "000000111000000", ".": "000000000000010", " ": "000000000000000",
}


def draw_text(img, text, x, y, scale=2, color=(235, 235, 235)):
    """Tiny 3x5 bitmap text into an (h, w, 4) uint8 image."""
    for ch in text.upper():
        g = FONT.get(ch, FONT[" "])
        for i, bit in enumerate(g):
            if bit == "1":
                gy, gx = divmod(i, 3)
                img[y + gy * scale:y + (gy + 1) * scale, x + gx * scale:x + (gx + 1) * scale, :3] = color
                img[y + gy * scale:y + (gy + 1) * scale, x + gx * scale:x + (gx + 1) * scale, 3] = 255
        x += 4 * scale


def decode_clip(clip, meta):
    raw = zlib.decompress(base64.b64decode(clip["data"]))
    return np.frombuffer(raw, np.uint8).reshape(clip["count"], meta["canvasH"], meta["canvasW"])


def merge_raw(style, quick):
    import glob
    by_char = {}
    for f in sorted(glob.glob(os.path.join(RAW_DIR, f"raw-{style}-*.json"))):
        is_quick = f.endswith("-quick.json")
        if is_quick != quick:
            continue
        with open(f) as fh:
            doc = json.load(fh)
        if doc["char"] not in CAST:
            continue     # raw renders left on disk for a character that left the cast (the goblin) are never picked up
        by_char.setdefault(doc["char"], []).append(doc)
    merged = {}
    clip_rank = {c: i for i, c in enumerate(CLIP_NAMES)}
    dir_rank = {"down": 0, "right": 1, "up": 2, "left": 3}

    def order_clips(clips):
        return sorted(clips, key=lambda c: (int(c["size"]), clip_rank[c["clip"]], dir_rank[c["dir"]]))

    for cid, docs in by_char.items():
        m = {"character": dict(docs[0]["character"]), "gear": {}, "tokens": {}, "statics": {}, "warnings": [],
             "stats": {}, "seconds": 0.0, "max_seconds": 0.0, "frames": 0, "layerOrder": {},
             "actions": docs[0]["actions"], "pieceInfo": docs[0]["pieceInfo"]}
        clips = []
        for d in docs:
            clips.extend(d["character"]["clips"])
            for g in d["gear"]:
                e = m["gear"].setdefault(g["id"], dict({k: v for k, v in g.items() if k != "clips"}, clips=[]))
                e["clips"].extend(g["clips"])
            for k, v in d["tokens"].items():
                m["tokens"].setdefault(k, {}).update(v)
            for k, v in d["statics"].items():
                m["statics"].setdefault(k, {}).update(v)
            for w in d["warnings"]:
                if w not in m["warnings"]:
                    m["warnings"].append(w)
            for k, v in d["stats"].items():
                m["stats"][k] = m["stats"].get(k, 0) + v
            m["seconds"] += d["seconds"]
            m["max_seconds"] = max(m["max_seconds"], d["seconds"])
            m["frames"] += d["frames"]
            if d["layerOrder"]:
                m["layerOrder"] = d["layerOrder"]
        seen = set()
        for c in clips:
            key = (c["size"], c["clip"], c["dir"])
            if key in seen:
                raise RuntimeError(f"{style}/{cid}: clip {key} rendered twice")
            seen.add(key)
        m["character"]["clips"] = order_clips(clips)
        for e in m["gear"].values():
            e["clips"] = order_clips(e["clips"])
        merged[cid] = m
    return merged


def expected_clip_count(quick):
    return len(SIZES) * (2 if quick else len(CLIP_NAMES)) * 4


def compose(base, layers):
    out = base.copy()
    for layer in layers:
        m = layer != TRANSPARENT
        out[m] = layer[m]
    return out


def hero_frame(m, gear_ids_by_role, order, size, clip, facing, frame):
    """Body frame composited with the hero's base-tier layers in the facing's draw order."""
    ch = m["character"]
    meta = ch["sizes"][size]
    body = next(c for c in ch["clips"] if c["size"] == size and c["clip"] == clip and c["dir"] == facing)
    A = decode_clip(body, meta)[frame]
    layers = []
    for role in order.get(facing, []):
        g = m["gear"][gear_ids_by_role[role]]
        gc = next(c for c in g["clips"] if c["size"] == size and c["clip"] == clip and c["dir"] == facing)
        layers.append(decode_clip(gc, meta)[frame])
    return compose(A, layers)


def paint_row(sheet, pal, frames, y_bottom, x0, cell_w, zoom):
    for ci, f in enumerate(frames):
        rgba = np.zeros(f.shape + (4,), np.uint8)
        solid = f != TRANSPARENT
        rgba[solid, :3] = pal[f[solid]]
        rgba[solid, 3] = 255
        rgba = np.repeat(np.repeat(rgba, zoom, 0), zoom, 1)
        y0 = y_bottom - rgba.shape[0]
        x = x0 + ci * cell_w
        reg = sheet[y0:y0 + rgba.shape[0], x:x + rgba.shape[1]]
        reg[:] = np.where(rgba[..., 3:4] > 0, rgba, reg)


def make_sheets(H, style, merged, out_dir, pal):
    zoom = 3
    arch_orders = {m["character"]["archetype"]: m["layerOrder"] for m in merged.values() if m["layerOrder"]}
    by_role = {}
    for m in merged.values():
        if m["character"]["archetype"]:
            by_role[m["character"]["archetype"]] = {g["role"]: g["id"] for g in m["gear"].values()
                                                   if g["tier"] == "base"}
    rows = []     # (label, [frames x4])
    ref_frames = [harness_frames(style, "sword_shield", "32x48", "idle", d)[0][0]
                  for d in ("down", "right", "up", "left")]
    rows.append(("HARNESS KNIGHT", ref_frames))
    anim_rows = []
    for cid in CAST:
        if cid not in merged:
            continue
        m = merged[cid]
        ch = m["character"]
        arch = ch["archetype"]

        def get(clip, facing, idx):
            if arch:
                return hero_frame(m, by_role[arch], arch_orders[arch], "32", clip, facing, idx)
            c = next(c for c in ch["clips"] if c["size"] == "32" and c["clip"] == clip and c["dir"] == facing)
            return decode_clip(c, ch["sizes"]["32"])[idx]

        frames = [get("idle", d, 0) for d in ("down", "right", "up", "left")]
        rows.append((ch["label"], frames))
        try:
            walk = [get("walk", "down", i) for i in (0, 2, 4, 6)]
            attack = [get("attack", "down", i) for i in (1, 3, 5, 7)]
            anim_rows.append((ch["label"], walk + attack))
        except StopIteration:      # a --quick run has no walk clip
            pass
    label_w = 140

    def draw(rows, path, z, cols, cw, chh):
        sheet = np.zeros((chh * len(rows), label_w + cw * cols, 4), np.uint8)
        sheet[..., :3] = 96
        sheet[..., 3] = 255
        for ri, (label, frames) in enumerate(rows):
            draw_text(sheet, label[:16], 6, ri * chh + chh // 2 - 5, 2)
            paint_row(sheet, pal, frames, (ri + 1) * chh - 6, label_w + 4, cw, z)
        H.write_png(path, sheet)

    # every clip of every character, for looking at (scratch, not an output): one sheet per character
    clips_dir = os.path.join(SCRATCH, f"clips-{style}")
    os.makedirs(clips_dir, exist_ok=True)
    for cid in CAST:
        if cid not in merged:
            continue
        m = merged[cid]
        ch = m["character"]
        arch = ch["archetype"]
        crow = []
        for clip in CLIP_NAMES:
            for facing in ("down", "right", "up"):
                c = next((c for c in ch["clips"] if c["size"] == "32" and c["clip"] == clip and c["dir"] == facing), None)
                if c is None:
                    continue
                if arch:
                    fr = [hero_frame(m, by_role[arch], arch_orders[arch], "32", clip, facing, i) for i in range(c["count"])]
                else:
                    fr = list(decode_clip(c, ch["sizes"]["32"]))
                crow.append((f"{clip} {facing}", fr))
        if crow:
            draw(crow, os.path.join(clips_dir, f"{cid}.png"), 2, 8, 64 * 2 + 6, 72 * 2 + 8)
    # the static parts (scratch): per hero the token, its base overlays composited, then every overlay alone
    prow = []
    for size_key in ("32",):
        for cid in CAST:
            m = merged.get(cid)
            if m is None:
                continue
            tok = np.array(m["tokens"][cid][size_key], dtype=np.int16)
            tok[tok < 0] = TRANSPARENT
            cells = [tok.astype(np.uint8)]
            arch = m["character"]["archetype"]
            if arch:
                ov = {g["id"]: np.array(m["tokens"][g["id"]][size_key], dtype=np.int16) for g in m["gear"].values()}
                for v in ov.values():
                    v[v < 0] = TRANSPARENT
                comp = np.full(tok.shape, TRANSPARENT, np.uint8)
                for role in arch_orders[arch].get("down", []):
                    comp = compose(comp, [ov[by_role[arch][role]].astype(np.uint8)])
                cells.append(comp)
                cells.extend(v.astype(np.uint8) for v in ov.values())
            prow.append((m["character"]["label"], cells))
    if prow:
        wide = max(len(c) for _, c in prow)
        draw(prow, os.path.join(SCRATCH, f"parts-{style}.png"), 3, wide, 32 * 3 + 6, 48 * 3 + 8)
    draw(rows, os.path.join(out_dir, "sheet.png"), zoom, 4, 64 * zoom + 8, 72 * zoom + 8)
    if anim_rows:
        draw(anim_rows, os.path.join(out_dir, "sheet-anim.png"), 2, 8, 64 * 2 + 6, 72 * 2 + 8)


def cmd_assemble(opts):
    import shutil
    H = load_harness()
    targets = load_targets()
    scope = [t for t in targets.values() if t["group"] in ("token", "gear", "icon") and not t.get("outOfPlay")]
    styles = [opts["style"]] if opts["style"] else STYLES
    os.makedirs(PARTS_DIR, exist_ok=True)
    old_dir = os.path.join(SCRATCH, "old-parts")
    os.makedirs(old_dir, exist_ok=True)
    with open(PALETTE_JSON) as fh:
        pal = np.array(json.load(fh)["palette"], dtype=np.uint8)
    for style in styles:
        merged = merge_raw(style, opts["quick"])
        if not merged:
            print(f"[assemble {style}] no raw renders", flush=True)
            continue
        out_dir = os.path.join(SCRATCH, "quick-out", f"cast-{style}") if opts["quick"] else             os.path.join(OUT_ROOT, f"cast-{style}")
        os.makedirs(out_dir, exist_ok=True)
        # ---- completeness
        want = expected_clip_count(opts["quick"])
        for cid in CAST:
            m = merged.get(cid)
            if m is None:
                print(f"[assemble {style}] MISSING character {cid}", flush=True)
                continue
            n = len(m["character"]["clips"])
            if n != want:
                print(f"[assemble {style}] {cid}: {n} body clips, expected {want}", flush=True)
            for g in m["gear"].values():
                if len(g["clips"]) != want:
                    print(f"[assemble {style}] {g['id']}: {len(g['clips'])} gear clips, expected {want}", flush=True)
        # ---- cast.json
        style_mod = load_module(os.path.join(ROOT, "scripts", "kaykit", "styles", f"{style}.py"), f"kk_label_{style}")
        order = [cid for cid in CAST if cid in merged]
        characters = [merged[cid]["character"] for cid in order]
        gear = [g for cid in order for g in merged[cid]["gear"].values()]
        by_arch = {merged[cid]["character"]["archetype"]: merged[cid]["layerOrder"] for cid in order
                   if merged[cid]["layerOrder"]}
        flat = by_arch.get("knight") or next(iter(by_arch.values()), {})
        doc = {"style": style, "label": getattr(style_mod, "LABEL", style),
               "description": getattr(style_mod, "DESCRIPTION", ""),
               "source": "KayKit Character Pack: Adventurers 1.0 and Skeletons 1.0 by Kay Lousberg (CC0)",
               "palette": pal.tolist(), "cameraPitchDeg": H.CAMERA_PITCH_DEG,
               "characters": characters, "gear": gear, "layerOrder": flat, "layerOrderByArchetype": by_arch,
               "actions": {cid: merged[cid]["actions"] for cid in order},
               "renderSeconds": round(sum(merged[cid]["seconds"] for cid in order), 1),
               "frames": sum(merged[cid]["frames"] for cid in order), "quick": opts["quick"]}
        cast_path = os.path.join(out_dir, "cast.json")
        with open(cast_path, "w") as fh:
            json.dump(doc, fh)
        print(f"[assemble {style}] wrote {cast_path}: {len(characters)} characters, {len(gear)} gear layers, "
              f"{os.path.getsize(cast_path)} bytes", flush=True)
        # ---- static parts (a partial or --quick assembly goes to scratch, never over the library's parts)
        complete = all(cid in merged for cid in CAST) and not opts["quick"]
        parts_dir = PARTS_DIR if complete else os.path.join(SCRATCH, "partial-parts")
        os.makedirs(parts_dir, exist_ok=True)
        if not complete:
            print(f"[assemble {style}] incomplete or quick: parts go to {parts_dir}, not the library", flush=True)
        for size in SIZES:
            cur = os.path.join(parts_dir, f"{MAKER}-{style}-{size}.json")
            keep = os.path.join(old_dir, f"{MAKER}-{style}-{size}.json")
            lib = os.path.join(PARTS_DIR, f"{MAKER}-{style}-{size}.json")
            if not os.path.exists(keep) and os.path.exists(lib):
                shutil.copyfile(lib, keep)       # the old maker's file, kept once, source of the icons
            icons = {}
            if os.path.exists(keep):
                with open(keep) as fh:
                    for sp in json.load(fh)["sprites"]:
                        icons[sp["assetId"]] = sp["pixels"]
            pixels = {}
            for cid in order:
                for aid, bysize in merged[cid]["tokens"].items():
                    if str(size) in bysize:
                        pixels[aid] = bysize[str(size)]
            sprites, gaps = [], []
            for t in scope:
                aid = t["assetId"]
                if aid in HAND_DRAWN:
                    gaps.append({"assetId": aid, "reason": HAND_DRAWN[aid]})
                    continue
                px = pixels.get(aid)
                if px is None and t["group"] == "icon":
                    px = icons.get(aid)
                if px is None:
                    gaps.append({"assetId": aid, "reason": "not rendered by cast.py"})
                    continue
                sprites.append({"assetId": aid, "kind": t["kind"], "name": t["name"], "walkable": t["walkable"],
                                "pixels": px})
            out = cur
            with open(out, "w") as fh:
                json.dump({"maker": MAKER, "size": size, "style": style, "sprites": sprites, "gaps": gaps}, fh)
            res = subprocess.run(["node", os.path.join("scripts", "kaykit", "check-part.mjs"), out],
                                 capture_output=True, text=True)
            print((res.stdout.strip() or res.stderr.strip()), flush=True)
        # ---- sheets
        make_sheets(H, style, merged, out_dir, pal)
        print(f"[assemble {style}] sheets: {os.path.join(out_dir, 'sheet.png')}, sheet-anim.png", flush=True)
        for cid in order:
            m = merged[cid]
            print(f"   {cid}: {m['frames']} frames, layer mismatch {m['stats'].get('layer_mismatch', 0)}/"
                  f"{m['stats'].get('layer_pixels', 0)} px, cpu {m['seconds']}s, longest job {m['max_seconds']}s, "
                  f"fit {m['statics'].get('fit')}", flush=True)
            for w in m["warnings"]:
                print("      warn:", w, flush=True)


def harness_frames(style, loadout, size_id, clip, facing):
    """Decode one clip of the harness's frames.json: (frames (n, h, w), size meta)."""
    with open(os.path.join(OUT_ROOT, style, "frames.json")) as fh:
        doc = json.load(fh)
    meta = doc["sizes"][size_id]
    c = next(c for c in doc["clips"] if c["loadout"] == loadout and c["size"] == size_id and c["clip"] == clip
             and c["dir"] == facing)
    raw = zlib.decompress(base64.b64decode(c["data"]))
    n = c["count"]
    arr = np.frombuffer(raw, dtype=np.uint8).reshape(n, meta["canvasH"], meta["canvasW"])
    return arr, doc


def cmd_parity(opts):
    """The Knight through this script's pipeline (all base pieces, no boots) must equal the harness's sword_shield
    loadout, pixel for pixel, at the animation framing: that is the proof the cast is the Knight's pipeline."""
    H = load_harness()
    styles = [opts["style"]] if opts["style"] else STYLES
    total_bad = 0
    for style in styles:
        cr = CastRender(H, "token_knight", style)
        ctx, spec = cr.ctx, cr.spec
        for k, sid in ((1, "16x24"), (2, "32x48")):
            size = cr.framings[k].apply(ctx, static=False)
            for clip, n, loop in (("idle", 6, True), ("attack", 8, False), ("walk", 8, True)):
                action = spec["actions"][clip]
                times = H.sample_times(action, n, loop)
                for facing, deg in (("down", 0.0), ("right", 90.0), ("up", 180.0), ("left", -90.0)):
                    ref, _ = harness_frames(style, "sword_shield", sid, clip, facing)
                    bad = 0
                    for i, t, keep in H.ClipRun(ctx, action, times, deg, loop, clip).steps():
                        f = cr.render(cr.kit_keys(), "kit")
                        if keep:
                            bad += int((f != ref[i]).sum())
                    total_bad += bad
                    if bad or facing == "down":
                        print(f"[parity {style}] {sid} {clip} {facing}: {bad} differing pixels over {n} frames", flush=True)
    print(f"[parity] total differing pixels: {total_bad}", flush=True)


if __name__ == "__main__" and IN_BLENDER:
    opts = parse_args()
    if opts["cmd"] == "render":
        cmd_render(opts)
    elif opts["cmd"] == "preview":
        cmd_preview(opts)
    elif opts["cmd"] == "parity":
        cmd_parity(opts)
    elif opts["cmd"] == "assemble":
        cmd_assemble(opts)
