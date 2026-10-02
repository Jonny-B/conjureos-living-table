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
| `pack.mjs` | The trial's packer (`.cache/kaykit/bench-data.json`). The bench no longer embeds it: the animated cast below replaced the trial panel. |
| `cast.py` | Every character the game uses (heroes, monsters, townsfolk) except the goblin, which is kept hand-drawn, rendered through this harness's camera, framing and styles, animated, with each hero's gear as separate animated layers. See "The animated cast" below. |
| `pack-cast.mjs` | Gathers `.cache/kaykit/out/cast-<style>/cast.json` into `.cache/kaykit/bench-cast.json`, which `npm run bench` embeds. |

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
5. The trial's Knight now lives on as part of the animated cast (`cast.py`, below), which is what the bench shows.

## Notes

- The camera looks down 30 degrees, orthographic. Change `CAMERA_PITCH_DEG` in `harness.py`.
- The figure fills `token_h - 1` pixels with its feet on the canvas bottom edge; the canvas is twice the token width and 1.5x its height so swung weapons are not clipped. The bench stands every size in the game's one-tile token footprint.
- The axe, crossbow and staff come from the pack's `Assets/` folder and are attached by copying an existing weapon on the same hand slot, so the bone parenting and the importer's bone-axis correction carry over.
- The Knight's idle holds a weapon forward, which suits swords better than a staff; the staff loadout borrows the two-handed idle.

## The converted library (every fantasy sprite)

The game's whole fantasy library, converted to KayKit renders and kept under
the same asset ids, so the game's own renderer draws it unchanged. Built by
four makers, each owning one script and its parts:

| Script | Covers | Parts (under `.cache/kaykit/library/parts/`) |
|---|---|---|
| `lib_ground_lit.py` | 40 ground, 5 wall and 190 edge tiles, Lit style | `ground-lit-16.json`, `ground-lit-32.json` |
| `lib_ground_painted.py` | the same 235 tiles, Painted style | `ground-painted-16.json`, `ground-painted-32.json` |
| `lib_props.py` | 37 props (multi-tile props are one model, sliced) | `props-16.json`, `props-32.json` |
| `cast.py` | 7 tokens, 33 gear overlays, 7 icons, per character style (stills from the animated cast; replaced `lib_tokens.py`, whose figures did not match the Knight). The goblin is left out on purpose (a gap: kept hand-drawn) | `tokens-<plain/bands/toon/pixelart>-<16/32>.json` |

The Healer's pieces are out of play and sci-fi is paused, so neither is
converted. `token_goblin` is kept hand-drawn by the owner's call
(2026-10-01): the free packs have no goblin, the recoloured Rogue stand-in did
not read as one, and the owner preferred the game's own drawing. The parts
list it as a gap, so the bench shows the game's sprite. The game has no KayKit
loader yet: the switch-over must keep the hand-drawn `token_goblin` in the
served manifest and upscale it to the manifest's `spriteSize` (the renderer
draws a 16 px sprite at half a tile in a 32 px manifest).

Run order, from the repo root (each step is safe to repeat):

1. `npm run kaykit:palette` and `npm run kaykit:targets` (the palette and the
   list of ids to produce, with sizes and walkability).
2. Fetch the free packs the makers use into `.cache/kaykit/` (each script's
   docstring names its clones: Adventurers, Skeletons, Dungeon Remastered,
   Medieval Hexagon, Furniture, Halloween, Prototype Bits).
3. Run each maker with Blender, as above (`... --python scripts/kaykit/lib_props.py`).
4. `node scripts/kaykit/check-part.mjs <part>` on every part: it must report
   0 problems (ids, sizes, walkability, palette range, opaque tiles).
5. `npm run bench`: packs the parts (`pack-library.mjs`) and embeds them. The
   bench's **Art** row switches every panel between the current art and the
   conversion (ground style, character style, 16 or 32 px), and the
   **Pieces** tab lists every in-play piece side by side.

32 px art needs the renderer's `RenderManifest.spriteSize` (32), which the
game supports from 0.3.0; the game itself still loads the 16 px art from
games-db until it is switched over.

## The animated cast

The owner's call (2026-09-30): every character must be a Kay model drawn the
same way as the animated Knight, except the goblin, kept hand-drawn by the
owner's later call (2026-10-01). `cast.py` renders the whole cast through the
harness's camera, framing and four styles, at 16 and 32 px, in seven
animations and four facings. Heroes are rendered without their removable gear,
and each gear piece (weapon, shield or cloak, armour or hat, boots; base, rare
and legendary) is its own animated layer rendered with the body as holdout, so
body plus any combination of layers composites pixel for pixel. The bench's
Play tab dresses the hero from `renderPlanFor` (the game's own equipment
plan): each plan layer's sprite id is a cast gear id.

Output, per style: `.cache/kaykit/out/cast-<style>/cast.json` (the shape is
in `scripts/asset-bench/cast.ts`), a contact sheet `sheet.png` beside the
Knight, and the static `tokens-<style>-<size>.json` library parts.

Seven characters are in the cast. To keep an id hand-drawn, make two edits in
cast.py: add it to `HAND_DRAWN` (the parts then record it as a gap whose
reason starts "kept hand-drawn"), and delete it from `CAST` and `SHORT`
(that stops it being rendered into the cast). `HAND_DRAWN` alone only changes
the parts, so the cast would still animate the KayKit figure. Today only
`token_goblin` is kept this way.
The bench reads that reason, shows the game's own sprite for it, and moves the
one drawing with the same clips as the cast (`spritePose` in
`scripts/asset-bench/cast.ts`).

```
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/cast.py -- render --style bands
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/kaykit/cast.py -- assemble --style bands
npm run bench
```

Repeat render and assemble per style (bands, toon, pixelart, plain); `--chars` renders a subset, and `parity` proves the Knight still matches the harness pixel for pixel. The full cast is about 20 minutes with the styles in parallel. The other subcommands are in `cast.py`'s docstring.
