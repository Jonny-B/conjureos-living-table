# Living Table asset bench

One self-contained HTML page for judging the game's art. It opens on **Play**
and has six tabs plus the Library, all calling the game's own render, rules
and character functions by symbol, so the bench shows what ships rather than a
second drawing of it.

| Tab | What it is for |
|---|---|
| **Play** | The game in miniature: a two-room scene with a door, a chest and a goblin. Walk (d-pad, arrows or WASD), Attack (F), Interact (E); drag items onto the hero's slots and see them worn. With the KayKit art on, the hero is the animated cast and the goblin is the game's own hand-drawn one (kept by the owner's call), moved by the bench: both walk, swing, flinch, die and leave a body. |
| **Characters** | Every figure the game uses, animated, in four facings: pick the animation, the style (or every style side by side), the detail and the floor. Heroes can wear their starting gear. A figure kept hand-drawn (the goblin) has its own row, posed from its one drawing. |
| **Pieces** | Every in-play fantasy sprite as a still: the game today beside the KayKit conversion. |
| **Gear** | One hero's paper doll (the inventory screen's figure) and every item's inventory icon. |
| **Terrain** | A preset map, raw beside the game's autotiling. |
| **Palette** | The fantasy palette. |
| **Library** | Every sprite in both templates, sci-fi included, searchable. |

The **Art row** (top of most tabs) switches between the game's current
hand-drawn art and the KayKit art (Kay Lousberg, CC0): ground style, character
style, 16 or 32 px. One choice, shared by every tab. KayKit is the default.

Fantasy only outside the Library: sci-fi is paused and the Healer is out of
play (`characters/templates.ts`).

Built from the `asset-bench` skill's template (`.claude/skills/asset-bench/`
in the ConjureOS repo), and moved here from conjureos-games with the game on
2026-09-30. This copy (`build-bench.mjs`, `shell.js`) is maintained here, not
there.

## Rebuild it

```
npm run bench
```

which packs the KayKit stills (`scripts/kaykit/pack-library.mjs`) and the
animated cast (`scripts/kaykit/pack-cast.mjs`; an empty set when there is
none, and the Characters tab then says how to make it) and runs:

```
node scripts/asset-bench/build-bench.mjs \
  --assets scripts/asset-bench/assets.ts \
  --out .cache/asset-bench/living-table-bench.html \
  --artifact \
  --data kaylib=.cache/kaykit/bench-library.json \
  --data kaycast=.cache/kaykit/bench-cast.json
```

`--data <id>=<file.json>` embeds a JSON block the registry reads at mount time
(`kaykit.ts`, `cast.ts`), so generated data never becomes an import of the
registry or of the tests that load it. The artifact has a 16 MB ceiling;
`pack-cast.mjs --styles bands,pixelart` keeps fewer styles if the cast grows
past it.

Output goes to `.cache/asset-bench/living-table-bench.html`, gitignored (see
`.gitignore`), never under `src/` or `public/` (`build-bench.mjs` refuses to
write there). `test/livingtable-asset-bench.test.ts` guards both of those
facts plus "every sprite id in both SPRITES arrays appears on the bench" and
"nothing under src/ imports scripts/asset-bench".

## Files

- `assets.ts`: the registry (every sprite, the six panels). Edit this when the
  game's asset library or render functions change.
- `kaykit.ts`: decodes the embedded KayKit stills.
- `cast.ts`: decodes and plays the embedded animated cast, and the small
  animation state machine (`Actor`) the Play tab drives.
- `build-bench.mjs`, `shell.js`: this project's own copy of the asset-bench
  skill's template builder and shell. Adapt them here if the bench needs
  something the template does not provide; they are not shared with other
  projects. Additions so far: `--data`, and the registry's `defaultPanel`,
  `libraryLast` and `libraryLabel`.

## Publishing

Artifact URL: https://claude.ai/artifact/Hjj7bkAS2fwDKUqY41ZeCG

The bench is published with the Artifact tool as its own artifact, updating
that same URL in place every time it changes rather than publishing a new one.
