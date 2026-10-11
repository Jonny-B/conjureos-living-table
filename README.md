# The Living Table

A D&D-style game for ConjureOS: an AI dungeon master runs your campaign on a
top-down pixel-art grid, and the dice are real, rolled by a rules engine built
on the SRD 5.1, never by the model.

It is its own ConjureOS app, installed and started on its own. Conjure Games
(the games hub) lists it through the `conjureGamesEntry` action it declares and
opens it in its own window.

## Working on it

```
npm install
npm run dev        # esbuild dev server with mocked ConjureOS bridges (conj-pack dev)
npm run typecheck
npm test
npm run build      # the real store bundle: dist/living-table.html
npm run bench      # the asset bench: .cache/asset-bench/living-table-bench.html
```

`npm run dev` does not exercise the store pipeline; run `npm run build` and
open `dist/living-table.html` before anything is published.

The game does not start without its two art files (`asset-files/`, which
ConjureOS hands over). On `npm run dev` there is no ConjureOS, so the script
that runs first copies them into `.devserve/asset-files/` and the game reads
them from the dev server (`src/games/livingtable/table/host/devAssets.ts`,
local pages with no ConjureOS only). Anywhere else a file that cannot be had
shows the art screen: one plain sentence and a Retry button (none when the
ConjureOS app is too old to hand files over, where it says to update the app).

## Where things are

- `src/games/livingtable/`: the game (rules, dungeon master, world, rendering, inventory).
- `src/bridge/`: the ConjureOS bridges (AI calls, the games-db backend, cross-app actions).
- `scripts/assets/`: the current sprite library, pixel art defined in code.
- `scripts/asset-bench/`: the asset bench (see its `BENCH.md`).
- `scripts/kaykit/`: the 3D-to-pixel trial with KayKit models in Blender (see its `README.md`).
- `DESIGN.md`: how the game works and why.

## Licence

All rights reserved; see `LICENSE`. This repository is public to be read, not
reused. `NOTICE.md` lists third-party material and carries the attribution the
SRD 5.1 licence requires.
