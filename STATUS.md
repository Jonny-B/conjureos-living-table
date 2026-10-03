# Status

Last updated: 2026-10-03, the real game window is ported into `src/` and the app runs it as a sealed standalone game (0.9.0, branch `port/table-window`).

## The port (branch `port/table-window`, 0.9.0)

The bench game is now THE game. Branch `port/table-window` (cut from `5b09966`; not merged to `dev` yet, the orchestrator commits) holds:

- **One window.** `src/games/livingtable/table/` (`mountTable.ts` and `host.ts` with its `TableHost`; `ui/`, `dmCore.ts`, `fightRules.ts`, `adventureRun.ts` and the rest) is the window the bench used to hold. The bench (`scripts/asset-bench/benchHost.ts`, `assets.ts`) is a thin host around it. The app (`src/games/livingtable/TableScreen.tsx`, `table/host/gameHost.ts`) is the other host. The nine re-export shims under `scripts/asset-bench/` are deleted and `test/livingtable-table-rules-parity.test.ts` with them; a guard test fails if anything under `src/` names `asset-bench`.
- **Standalone and sealed.** The app opens straight into the window: a bar with Adventures and Fullscreen, the window, a save line and the licence panel. `package.json` declares `"editStyle": "locked"` with `"editable": false`, permissions `ai.complete` and `display.fullscreen`, and no `conjureGamesEntry` action. No hub, no back-to-hub exit.
- **Old campaign mode retired.** The AI campaign list, campaign generator, hero creator, play screen, memory and inventory screens went with `LivingTable.tsx` (about 220 tests of retired code cut; 1965 tests remain). Predefined adventures (The Rat Cellar and the Template) and the two test rooms replace it.
- **Saves on the server.** games-db `game_saves` through the `gamesDb` action; the device cache is a fallback only, and a different player's cache is put aside, never uploaded. On open, a player with a save lands in their newest one.
- **Animated art as asset files.** The 6.3 MB cast and the 0.2 MB library load through `window.__conjureos.assets.load(url, sha256)` (`table/host/assetFiles.ts`). Until they are uploaded the table draws still figures and the hand-drawn art and says so.
- **Checks.** `npm test` 1965 of 1965, `npm run typecheck` clean, `npm run build` writes `dist/living-table.html` (about 1.5 MB), `node scripts/e2e/run.mjs` 14 of 14 on the dev build and on `dist`. The bench type check has one known error (`scripts/assets/scifi.ts` GRATING_SLOTS; sci-fi is paused).

Owner steps, in order (none done yet):

1. Add the five Actions secrets in the repo (listed in the header of `.github/workflows/publish-store.yml`): `CONJUREOS_REPO_TOKEN`, `SUPABASE_DEV_PROJECT_REF`, `SUPABASE_PROD_PROJECT_REF`, `PUBLISH_BOT_DEV_PASSWORD`, `PUBLISH_BOT_PROD_PASSWORD`. Until then every publish run skips with a notice.
2. Upload the asset files: `node scripts/assets/export-asset-files.mjs` prints each file's name, size and sha256; upload `living-table-cast.json` and `living-table-library.json` in ConjureOS Settings, Apps, Asset files (once per project, dev and prod); paste each address and hash into `ASSET_FILES` in `src/games/livingtable/table/host/assetFiles.ts`; rebuild and publish. A changed file has a new hash.
3. First publish per project: Actions, "Publish to ConjureOS App Store", Run workflow, target `dev`, tick `first_publish`; check, then the same with `prod`. Later pushes publish on their own (`dev` to the dev store, `main` to prod). `CHANGELOG_NEXT.md` carries the players' copy and must be stamped with the `package.json` version.
4. Open the app on ConjureOS dev and check what was only tested headless: Fullscreen (`display.fullscreen`), the AI call, server saves, and the sealed state (the App Sandbox should refuse edits).

## Where the move stands

The Living Table is leaving Conjure Games for this repo. Owner decisions,
2026-09-30:

1. Conjure Games' hub rebuild (conjureos-games branch `claude/confident-einstein-85t9dw`) lands on its `dev` first; only then does the Living Table come out of that repo.
2. This repo is a COPY for now, taken from conjureos-games branch `claude/lt-inventory-loot` (0.21.1 plus the unpushed inventory, loot and bench work). That branch is held, not pushed.
3. No user data to protect: there are no players yet.
4. Registration with the hub: SUPERSEDED (2026-10-03). The Living Table is standalone for now and declares no `conjureGamesEntry`; the owner will design how games register later (DECISIONS.md).
5. Sprite art moves to Supabase Storage (not started).
6. The game stays inside Conjure Games until this app is live on the prod store; then the hub card points here. (The card side is the owner's later registration design; this app does not wait on it.)
7. All rights reserved (not MIT).

Later the same day, with the art moving to Kay Lousberg's free KayKit packs
(CC0): **sci-fi is paused** and **the Healer is out of play**, because the free
packs have a knight, a rogue and a mage but no cleric and no sci-fi characters.
Both stay in the code and still load; only `PLAYABLE_TEMPLATES` and
`PLAYABLE_ARCHETYPE_IDS` in `characters/templates.ts` decide what a player can
start (0.2.0). The owner also wants the "not much use" free packs kept in mind:
pieces of them can be pulled in and adapted.

**The fantasy library is converted to KayKit (2026-09-30, 0.3.0):** 319 of the
320 in-play fantasy pieces at 16 and 32 px (token_goblin is kept hand-drawn,
see below), ground in two styles (Painted, Lit),
characters in four (Cel bands, Pixel artist, Toon, Plain), on the bench (Art
row, Pieces tab). The renderer draws 32 px art (`RenderManifest.spriteSize`).
The game itself still shows the hand-drawn 16 px art: switching it needs the
owner's pick of styles and size, then the window's board sizing
(`SPRITE_SIZE * displayScale` must use the manifest's sprite size), games-db
serving the new art and `spriteSize` (or the Supabase Storage hosting already
agreed), and `STORAGE_PREFIX` in manifestCache.ts bumped to v4 in the same
release. The served manifest must also keep the hand-drawn `token_goblin`,
upscaled to its `spriteSize`: the game has no fallback for an id the library
leaves out.

**The whole cast is animated KayKit, drawn like the Knight (2026-09-30):** the
owner saw the other characters looked like another art style and were static.
`scripts/kaykit/cast.py` renders the 7 characters in the cast through the Knight's own
pipeline (proved pixel-identical for the Knight), 7 animations x 4 facings x
2 sizes x 4 styles, with each hero's gear as animated layers, and remade the
static token parts from the same renders. The goblin stays the game's own
hand-drawn one (owner's call, 2026-10-01: "I liked the old goblin"): the
KayKit library leaves it out on purpose (`HAND_DRAWN` in cast.py), so the
bench shows the hand-drawn sprite and moves the one drawing alongside the
cast. The bench was reorganised: Play (opens first; hero and goblin animate,
gear shows on the moving hero), Characters, Pieces, Gear, Terrain (the
Palette and Library tabs are gone, 2026-10-02). Known weak spots: the Pixel artist style turns non-Knight
clothing drab, and the skeleton is near white in Cel bands and Plain.

**0.4.0 (2026-10-01):** walls from above with a side-on door in north-south walls (display-only pass, render/wallProfiles.ts; hand-drawn and both KayKit ground styles; players get it with the games-db paste and STORAGE_PREFIX v4), KayKit idle shimmer removed (whole-pixel idle snap plus per-pixel hysteresis; walk only about 20 percent calmer), the bench Play tab never blanks or jumps (cached room layer, pre-decoded clips, continuous walk, gliding camera), and the engine pieces for turn-based play (world/pathing.ts, session/hostileTurns.ts with monsters that route round walls, session/combatEvents.ts, render/anchors.ts). The bench Play tab is turn based (2026-10-02): click to walk, click the goblin to attack, initiative and turns from combatRound.ts, the goblin's turn from resolveMonsterTurn, and every word on the board through overlay.ts in a pixel or storybook style.

**0.5.0 (2026-10-02), line of sight, fog of war and the DM (#7):** closed doors, walls, trees and buildings block sight in the game's own engine (`world/visibility.ts`, its own `opaque` flag apart from walking; symmetric, corner gaps closed), so a ranged attack through a shut door is now refused in the game too. `render/shroud.ts` draws a three-level fog of war (never seen, remembered, in sight) as drifting pixel mist. On the bench: the fog over the board, the goblin hidden and untargetable until seen, and a DM (`src/games/livingtable/table/dmCore.ts`, then `scripts/asset-bench/dm.ts`) that is told the whole room, every secret, the goblin's numbers, the sheet and pack and what you can see. You type anything into "What do you do?" or right-click/long-press to look closer; it can give and take items, potions, engine-rolled loot, heal or harm (harm only on a failed check), place/alter/remove props, change tiles, lock doors and wake, calm, spawn or scare off the goblin. Checks carry both outcomes and roll in the dice tray; chests stay engine RNG. A Pack view sits in the game window (I). On the bench the DM runs on the viewer's own Claude account (the artifact sample capability, asks permission once).

**0.6.0 (2026-10-02), character sheet and creation, rules, bestiary (#8, #9):** SRD 5.1 creation in the engine (standard array, point buy, 4d6 drop lowest; nine ancestries; class skills; custom background; alignment; backstory; old inputs build the old sheet exactly), `inventory/itemInfo.ts` (what every item is and does), `rules/rulebook.ts` (checked against the engine) and `rules/bestiary.ts` (40 SRD creatures, checked against the SRD). On the bench: Sheet (C) and New character inside the game window with hover help on every number and item, the 4d6 thrown in the dice tray, Rules and Bestiary tabs, dice numerals in every state.

**0.7.0 (2026-10-02), the table loop (#6, #10, #11):** engine modules `session/savePoints.ts`, `contextActions.ts`, `maneuvers.ts`, `adventureExport.ts` and `zip.ts`, `inventory/itemActions.ts`, `rules/corpses.ts`. On the bench: story-only board text that fades with a Log tab, the DM suggesting next moves (keys 1 to 4) and context-only buttons, Rest and save points (browser), item cards with real actions, lootable bodies, class and skill context menus whose engine actions change the board, DM push/hurt/prone inside attack and contest checks (the kick bug), foe dice in six tiers in their own trays, and a debug export zip.

**0.8.0 (2026-10-02 to 03), predefined adventures (#12):** adventures are Markdown files the owner writes (`adventures/`, TEMPLATE.md, README.md, `npm run adventures:check`), parsed and validated by `src/games/livingtable/adventures/` (model, progress, gospel brief for the DM, maps from ASCII, optional AI writer). The Rat Cellar is drafted from the owner's outline with 30 marked additions awaiting review. Heroes can be unarmored (AC 10 + DEX) and the adventure kit is the class weapon only. Rats (art, statblocks). On the bench: many creatures, a start screen, locations and exits, NPCs, a Journal, the DM bound by the adventure, the AI writer; a full Rat Cellar playthrough per class.

## Next

- Merge `port/table-window` to `dev` (the orchestrator commits it), then do the owner steps above.
- Owner calls from the port: (1) a player with a save lands in their newest save on open, not the start screen, keep it? (2) the Adventures bar button mid-game opens the start screen with no confirm; saves are kept. (3) with no AI permission or outside ConjureOS the DM is off and says so, no stand-in answer; keep it? (4) the start screen's "Test rooms" heading, rename it "Example adventures for testing"? (5) prune the old CSS, and trim the hub and campaign code left in `src/bridge/gamesApi.ts` and `src/bridge/ai.ts`?
- Stale text to clean: CLAUDE.md (the `actions.ts` and `Bits.tsx` lines and the "Conjure Games registration" section), README.md (the `conjureGamesEntry` sentence), and comments in about 15 `src` files that still name deleted files. The game window has no Rules or Bestiary tab yet (the bench has both).
- Owner review of adventures/rat-cellar.md (30 marks) and the balance calls on #12 (the goblin is the hard fight unarmored; sleeper advantage and sneak attack are not in the engine).
- Owner's calls pending: how dice skins are sold (#6); a deliberate 1 px breathing bob for 16 px idles (they are now still).
- Owner picks still open from 2026-09-30: ground style, character style and size for the game.
- Art hosting in Supabase Storage (superseded for the animated art by asset files; the hand-drawn art still comes from games-db).
- Authored campaigns beyond the predefined adventures (owner-written outlines plus a freestyle option).
