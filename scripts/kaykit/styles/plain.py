"""
Plain: the control. Render at the exact sprite size with anti-aliasing off,
flat unlit texture colour, and snap every pixel to the nearest game palette
colour. No cleanup, no outline, no shading. This is what "just shrink the 3D
model" looks like, so the other styles have something honest to beat.

Inside a clip (ctx.mem.active, see harness.py) a pixel has memory, because one sample per pixel flickers hard as the
figure moves by a fraction of a pixel. The picture is still the one-sample render. A second render of the same frame
at EVIDENCE_SS x the size (3 x 3 samples per pixel; the middle one is solid exactly where the one-sample render is,
though the texture is filtered at the other scale so its colour can differ) only votes on whether to hold last
frame's pixel. A pixel keeps its colour while that colour fills at least KEEP_RATIO as many of the 9 samples as the
one-sample colour does. It stays opaque while EVIDENCE_STAY of the 9 samples are solid (or the one sample is), and a
transparent pixel only turns opaque when the one sample is solid and EVIDENCE_ENTER of the 9 are. Stills are the
plain render.
"""
import numpy as np

LABEL = "Plain"
DESCRIPTION = "Straight downscale: flat texture colour at the exact sprite size, snapped to the game palette, no cleanup."

TRANSPARENT = 255
EVIDENCE_SS = 3
EVIDENCE_ENTER = 5       # samples (of 9) that must be solid, with the one sample, for a transparent pixel to turn opaque
EVIDENCE_STAY = 4        # samples (of 9) that keep an opaque pixel opaque once the one sample misses
# (5 in, 4 out brackets the half-coverage point, 4.5, so the silhouette neither grows nor shrinks on average: 3 and 3
# measured 1 to 3 percent more opaque pixels in a walk.)


def prepare(ctx):
    s = ctx.scene
    s.render.engine = "BLENDER_WORKBENCH"
    s.display.shading.light = "FLAT"
    s.display.shading.color_type = "TEXTURE"
    s.display.render_aa = "OFF"


def _indexed(ctx, rgba):
    out = np.full(rgba.shape[:2], TRANSPARENT, dtype=np.uint8)
    solid = rgba[..., 3] >= 0.5
    if solid.any():
        out[solid] = ctx.nearest_palette(rgba[solid][:, :3])
    return out


def render_frame(ctx, size):
    out = _indexed(ctx, ctx.render_rgba(ss=1))
    mem = getattr(ctx, "mem", None)
    if mem is None or not mem.active:
        return out
    h, w = out.shape
    ss = EVIDENCE_SS
    sub = _indexed(ctx, ctx.render_rgba(ss=ss))
    blocks = sub.reshape(h, ss, w, ss).transpose(0, 2, 1, 3).reshape(h, w, ss * ss)
    n_solid = (blocks != TRANSPARENT).sum(-1)
    one = out != TRANSPARENT
    # colour: the one-sample colour, or the block's majority where the one sample missed; held over last frame's
    labels = np.array([v for v in np.unique(blocks) if v != TRANSPARENT], np.uint8)
    col = out
    if len(labels):
        weights = np.stack([(blocks == v).sum(-1).astype(np.float32) for v in labels])
        majority = labels[weights.argmax(0)]
        win = np.where(one, out, majority)
        win_w = (weights * (labels[:, None, None] == win[None])).sum(0)
        lab, _ = mem.hold("col", labels, weights, win=win, win_w=win_w)
        col = np.where(lab >= 0, lab, out).astype(np.uint8)
    prev_op = mem.get("op")
    if prev_op is None:
        op = one
    else:
        op = np.where(prev_op, one | (n_solid >= EVIDENCE_STAY), one & (n_solid >= EVIDENCE_ENTER))
    mem.put("op", op)
    return np.where(op & (col != TRANSPARENT), col, TRANSPARENT).astype(np.uint8)
