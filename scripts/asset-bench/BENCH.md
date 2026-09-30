# Living Table asset bench

One self-contained HTML page showing every sprite in `scripts/assets/fantasy.ts`
and `scripts/assets/scifi.ts` (476 sprites total: tiles, props, tokens, gear
overlays, boots, ring/amulet icons, slot silhouettes), plus six panels
(Character, KayKit, Doll, Icons, Terrain, Palette) that call the game's own
render/character functions by symbol, so the bench shows what ships rather
than a second drawing of it.

- **Character** is playable: a d-pad, a two-room scene with a door, a chest and
  a monster, drag-to-equip gear slots, and Attack and Interact running the
  game's own rules. Its Archetype list includes the **KayKit Knight (3D
  render)**, which plays the same scene with a Blender-rendered, animated
  sprite.
- **KayKit** is the 3D-to-pixel trial's comparison surface: every conversion
  style from `scripts/kaykit/` side by side in four facings, next to the
  source render and the game's current hand-drawn Knight in the same
  footprint.

Built from the `asset-bench` skill's template (`.claude/skills/asset-bench/`
in the ConjureOS repo), and moved here from conjureos-games with the game on
2026-09-30. This copy (`build-bench.mjs`, `shell.js`) is maintained here, not
there.

## Rebuild it

```
npm run bench
```

which packs the KayKit renders (`scripts/kaykit/pack.mjs`; an empty set when
there are none, and the KayKit panel then says how to make them) and runs:

```
node scripts/asset-bench/build-bench.mjs \
  --assets scripts/asset-bench/assets.ts \
  --out .cache/asset-bench/living-table-bench.html \
  --artifact \
  --data kaykit=.cache/kaykit/bench-data.json
```

`--data <id>=<file.json>` embeds a JSON block the registry reads at mount time
(`kaykit.ts`), so generated data never becomes an import of the registry or of
the tests that load it.

Output goes to `.cache/asset-bench/living-table-bench.html`, gitignored (see
`.gitignore`), never under `src/` or `public/` (`build-bench.mjs` refuses to
write there). `test/livingtable-asset-bench.test.ts` guards both of those
facts plus "every sprite id in both SPRITES arrays appears on the bench" and
"nothing under src/ imports scripts/asset-bench".

## Files

- `assets.ts`: the registry (every sprite, the six panels). Edit this when the
  game's asset library or render functions change.
- `kaykit.ts`: decodes and plays the embedded KayKit frames.
- `build-bench.mjs`, `shell.js`: this project's own copy of the asset-bench
  skill's template builder and shell. Adapt them here if the bench needs
  something the template does not provide; they are not shared with other
  projects.

## Publishing

Artifact URL: https://claude.ai/artifact/Hjj7bkAS2fwDKUqY41ZeCG

The bench is published with the Artifact tool as its own artifact, updating
that same URL in place every time it changes rather than publishing a new one.
