# Status

Last updated: 2026-09-30, repo set up; the game still also lives inside Conjure Games.

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

## Next

- Publishing: add the five Actions secrets (see the publish workflow's header), then the first publish per project.
- The KayKit 3D-to-pixel trial is on the asset bench; the owner is judging whether it looks good enough to pursue.
- Art hosting in Supabase Storage.
