# The Living Table: project instructions

Read [DESIGN.md](DESIGN.md) before changing what the game is or what it costs,
and [STATUS.md](STATUS.md) for where the move out of Conjure Games stands.

## The rules that matter

1. **The model never produces a mechanical outcome.** Hits, damage, saves,
   checks, loot and hit points come from the rules engine (`rules/`,
   `session/combat.ts`); the dungeon master narrates and requests rolls, it
   never rolls. A number on screen that the engine did not compute is a bug.
2. **Every paid action shows its price before the click** (`<CostBadge />`).
   An AI call added to a surface gets a badge in the same commit.
3. **No em dashes or en dashes anywhere**: code comments, copy, commit
   messages, and what the models write (every prompt carries the rule).
4. **The game knows only about itself.** No copy about other players, other
   games, or how something used to work.
5. **SRD attribution stays intact.** `NOTICE.md` and `SRD_ATTRIBUTION` in
   `src/games/livingtable/menu/labels.ts` carry the same six elements the CC BY
   4.0 licence requires; change one, change both.
6. **All rights reserved.** The repo is public to be read. Do not add an open
   source licence, and do not commit third-party files whose licence forbids
   redistribution. KayKit (CC0) packs are fetched into `.cache/`, not committed.

## Shape of the repo

```
src/games/livingtable/  the game
src/bridge/             ai.ts (ai.complete), gamesApi.ts (games-db), actions.ts (hub registration, leaving)
src/components/Bits.tsx the five pieces of shared chrome copied from Conjure Games
scripts/assets/         the current sprite library (pixel art as code) and its builders
scripts/asset-bench/    the asset bench (BENCH.md)
scripts/kaykit/         the Blender 3D-to-pixel trial (README.md)
```

## Conjure Games registration

The app declares `conjureGamesEntry` (package.json, `conjureos.actions`) and
registers a handler for it at startup (`src/bridge/actions.ts`). Conjure Games
lists registered games with `window.__conjureos.actions.list()` (reads
manifests: no permission, no consent dialog, works while the game is closed)
and opens one with `openApp`. Protocol 1 is informal; what a game must supply
to be compliant is not decided yet. Keep the declared `returns` and
`HUB_ENTRY` in step.

## Backend

The game still calls Conjure Games' backend: the `gamesDb` remote action,
pointing at the `games-db` edge function in the ConjureOS repo (the `lt*`
actions and the `game_campaigns` / `game_characters` / `game_cells` /
`game_memory_*` tables). The publish workflow stamps the dev or prod URL into
the manifest. Owner decision (2026-09-30): sprite art will move to Supabase
Storage and load at runtime instead of living in the edge function; not done
yet.

## Before pushing

```
npm run typecheck && npm test && npm run build
```

`npm run build` is not optional: `conj-pack dev` does not exercise the real
@bundle pipeline. Bump `version` in **both** `package.json` and
`src/version.ts` (the publish workflow refuses a mismatch), and take the number
at push time, after a fetch.

## Working alongside other sessions

The cross-repo rules live in the ConjureOS repo's `SHARED_AGENT_RULES.md`.
Enough to act on without it: claim an issue with the `agent-claimed` label and
an `agent-claim: <your session URL>` comment (labels REPLACE, so send the
current set back with it); never force-push `dev` or `main`; verify a push by
comparing SHAs.
