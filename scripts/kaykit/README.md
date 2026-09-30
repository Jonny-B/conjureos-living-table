# KayKit: the 3D-to-pixel trial

Can a CC0 3D model, rendered in Blender, become sprites that look right in The
Living Table? This folder is the machinery for answering that on the asset
bench. Nothing here ships in the game.

## What is here

| File | What it does |
|---|---|
| `harness.py` | Blender 5.2 script. Loads the KayKit Knight, attaches weapons, poses 7 loadouts x 7 animations x 4 facings, frames one fixed orthographic camera per sprite size (16x24, 32x48, and 48x72 for the default loadout), and hands every frame to a style module. Owns everything that must be identical between styles. |
| `styles/*.py` | Conversion styles: how a posed 3D scene becomes an indexed pixel frame in the game's palette. `plain.py` is the control (a straight downscale). The contract is in `harness.py`'s docstring. |
| `export-palette.ts` | Writes the fantasy palette to `.cache/kaykit/palette-fantasy.json` so Blender quantises into the game's own 52 colours. |
| `sheet.mjs` | Contact sheets from harness output, to look at renders without the bench. |
| `pack.mjs` | Gathers every finished style into `.cache/kaykit/bench-data.json`, which `npm run bench` embeds. |

## Running it

Everything reads and writes under `.cache/` (gitignored). From the repo root:

1. Fetch the pack (CC0, Kay Lousberg), once. About 140 MB.
   ```
   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0.git .cache/kaykit/adventurers
   ```
2. Export the palette, once and whenever the fantasy palette changes.
   ```
   npm run kaykit:palette
   ```
3. Render a style. `--quick` does one loadout and two animations in seconds; the full run is 2,880 frames and needs no flag.
   ```
   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/harness.py -- --style plain --quick
   ```
4. Look at it.
   ```
   node scripts/kaykit/sheet.mjs plain --size 32x48 --dir down
   ```
5. Put it on the bench (packs every full-run style, then builds).
   ```
   npm run bench
   ```

## Notes

- The camera looks down 30 degrees, orthographic. Change `CAMERA_PITCH_DEG` in `harness.py`.
- The figure fills `token_h - 1` pixels with its feet on the canvas bottom edge; the canvas is twice the token width and 1.5x its height so swung weapons are not clipped. The bench stands every size in the game's one-tile token footprint.
- The axe, crossbow and staff come from the pack's `Assets/` folder and are attached by copying an existing weapon on the same hand slot, so the bone parenting and the importer's bone-axis correction carry over.
- The Knight's idle holds a weapon forward, which suits swords better than a staff; the staff loadout borrows the two-handed idle.
