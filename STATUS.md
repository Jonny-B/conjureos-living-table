# Status

Last updated: 2026-10-02, the bench Play tab is turn based (click to move, initiative, on-board text) and the bench is down to five tabs.

## Where the move stands

The Living Table is leaving Conjure Games for this repo. Owner decisions,
2026-09-30:

1. Conjure Games' hub rebuild (conjureos-games branch `claude/confident-einstein-85t9dw`) lands on its `dev` first; only then does the Living Table come out of that repo.
2. This repo is a COPY for now, taken from conjureos-games branch `claude/lt-inventory-loot` (0.21.1 plus the unpushed inventory, loot and bench work). That branch is held, not pushed.
3. No user data to protect: there are no players yet.
4. Registration with the hub: implemented on this side (`conjureGamesEntry`); the hub side comes with the hub rebuild.
5. Sprite art moves to Supabase Storage (not started).
6. The game stays inside Conjure Games until this app is live on the prod store; then the hub card points here.
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
owner's pick of styles and size, then LivingTable.tsx's board sizing
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

## Next

- Bring the bench's turn-based play into the game (#5): the click layer, turn order, overlay text and floating numbers into LivingTable.tsx. The owner picks the text style first (Pixel or Storybook, on the Play tab).
- Owner's call pending: a deliberate 1 px breathing bob for 16 px idles (they are now still).
- Publishing: add the five Actions secrets (see the publish workflow's header), then the first publish per project.
- Owner picks: ground style, character style and size for the game. Then the game needs an animation system to use the cast (the bench's Actor in `scripts/asset-bench/cast.ts` is the model).
- Authored campaigns (owner-written outlines plus a freestyle option) and real-cost pricing for campaign generation.
- Art hosting in Supabase Storage.
