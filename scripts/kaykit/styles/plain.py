"""
Plain: the control. Render at the exact sprite size with anti-aliasing off,
flat unlit texture colour, and snap every pixel to the nearest game palette
colour. No cleanup, no outline, no shading. This is what "just shrink the 3D
model" looks like, so the other styles have something honest to beat.
"""
import numpy as np

LABEL = "Plain"
DESCRIPTION = "Straight downscale: flat texture colour at the exact sprite size, snapped to the game palette, no cleanup."

TRANSPARENT = 255


def prepare(ctx):
    s = ctx.scene
    s.render.engine = "BLENDER_WORKBENCH"
    s.display.shading.light = "FLAT"
    s.display.shading.color_type = "TEXTURE"
    s.display.render_aa = "OFF"


def render_frame(ctx, size):
    rgba = ctx.render_rgba(ss=1)
    out = np.full(rgba.shape[:2], TRANSPARENT, dtype=np.uint8)
    solid = rgba[..., 3] >= 0.5
    if solid.any():
        out[solid] = ctx.nearest_palette(rgba[solid][:, :3])
    return out
