# Status

Last updated: 2026-10-10, Blackstone made smaller with no story lost; this branch is behind main (see the note under Recently shipped).

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

## Recently shipped

- **Written campaigns, smaller (no version: this branch cannot publish).** Note: main retired the campaign mode this branch is built on (DECISIONS.md on main, 2026-10-03) for Markdown predefined adventures; this work is a source for porting Blackstone there, not a merge candidate. The brief the DM reads each turn is about a fifth smaller (23.0 to 18.8 KB on average, 28.5 to 24.0 KB at most), and Blackstone's file shed duplicated text. Nothing lost: all 128 ids, every gate, flag, DC, timing and name are unchanged (now pinned by a test). The format now writes each fact once: who is where lives on the person, an act's cast on its arcs, a single-cell place's description doubles as its map hint.

- **Written campaigns (0.2.0).** Campaign, Acts, Arcs, Scenes, Encounters plus State, run by the DM rather than recited: truths with known/discoverable/secret gates, beats, outcomes, a villain clock the engine fires on scene count, act changes and endings, all reported by id in an optional `story` field on the DM turn and checked by `campaign/engine.ts`. First campaign: *The Quiet Under Blackstone* (fantasy, three acts, levels 1 to 3). Free to start. Authoring guide: `CAMPAIGN_TEMPLATE.md`.

## Next

- Publishing: add the five Actions secrets (see the publish workflow's header), then the first publish per project.
- The KayKit 3D-to-pixel trial is on the asset bench; the owner is judging whether it looks good enough to pursue.
- Art hosting in Supabase Storage.
- Written campaigns, not yet seen by a person: play Blackstone end to end on dev and watch whether the DM reports `story` ids reliably and whether the brief (16 to 24 KB a turn) is worth its size.
- Written campaigns, next steps if it plays well: a player-facing journal (what they know, open problems), the AI planner producing this format instead of the four-line plan, and a second campaign (sci-fi).
- Story state lives on the player character's `stats` blob (like `position`); a `game_campaigns` column would be its proper home once the backend is touched for something else.
