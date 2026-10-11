# The Living Table in Unity: a proof of concept for sealed apps

Status: **planned, not started** (2026-10-11). The owner: "I think I'd like to plan on convertingin it to unity as a proof of concept for sealed apps." Paused with the rest of the work until tokens allow.

## Why

- **The first fully closed app on ConjureOS.** Compiled code, its own engine, its art and data in asset files, nothing a player can edit. It exercises everything sealed apps were built for (ConjureOS #1149).
- **Live 3D.** KayKit is made for engines like Unity: armour, helmets, capes, weapons and shields equip and unequip at run time on one rig. That answers the cloth-base request (every item removable, a plain cloth body underneath, NPCs too) with no pre-rendered layers, plus lighting, effects and animation blending.
- **The workflow.** The Unity plugin (Claude's Unity skills: a command line that drives a live Unity Editor, builds and runs tests) is what makes text-driven work on a Unity project practical.

## How a Unity game becomes a ConjureOS sealed app

| Piece of a Unity web (WebGL) build | Where it goes | Fits today? |
|---|---|---|
| `loader.js` and `framework.js` (about 0.3 to 1 MB) | inline in the app's page | yes (the page limit is 5 MB) |
| `build.wasm` (the engine, about 8 to 20 MB) | an asset file, `application/wasm` | yes (50 MB a file) |
| `build.data` (scenes, art, audio) | an asset file, `application/octet-stream` | yes (200 MB a version) |
| the loader fetching those | `dataUrl` / `codeUrl` set to the `objectUrl` from `assets.load(name)` | yes for data and code (the runner allows `connect-src blob:` since apphost 0.1.8); a framework loaded from a blob needs `script-src blob:` (one runner change) |

- **Talking to ConjureOS from C#:** a `.jslib` plugin calls `window.__conjureos`: `ai.complete` (the Dungeon Master), `actions.invoke("gamesDb", ...)` (saves), `assets`, `haptics`. Answers come back into C# with `SendMessage`.
- **Publishing:** CI builds the Unity project (GameCI's unity-builder, which needs a Unity licence as a secret), then the existing publish workflow uploads the page and the asset files to Discover.
- **Phone app:** runs it in its WebView, with the asset files coming through the phone's asset bridge (phone 0.59.1 and later). Memory and load time for a 15 to 30 MB engine on an iPhone are the main unknowns.

## Platform work (ConjureOS)

1. **Runner:** `script-src` allows `blob:` (the runner is already permissive inside the app frame: `*`, `'unsafe-inline'`, `'unsafe-eval'`).
2. **A Unity template for sealed apps:** the page with the loader and framework inline, the declared asset files, a bridge package (`conjureos.jslib` plus a small C# wrapper), and a Developer Docs page.
3. **Publishing:** a CI step that builds Unity before the existing publish step.
4. **Limits:** 50 MB a file, 200 MB a version, 500 MB per publishing account. Several Unity versions will fill the account pool, so old files need pruning first.

## The proof of concept, in phases (each ends in a go or no-go)

**Phase 0, setup.** Unity Hub and Unity 6 LTS on this machine, signed in to a Unity account (the owner's step), the Unity plugin connected, and a new repo for the Unity project.

**Phase 1, a hero on a table.**
- One KayKit Knight, live in 3D with the game's pixel look (a low-resolution render target, point filtering, toon shading), walking a grid room from the Rat Cellar.
- Armour, helmet, cape, sword and shield equip and unequip at run time over a plain cloth body.
- Built for the web, published to the dev listing as a sealed app, and opened on the web, the desktop and the iPhone app.
- Measured: download size, first and cached load on an iPhone, frame rate, memory.
- **Go if:** a cached load on the iPhone is under about 5 s, the frame rate is steady, the total download is under about 40 MB, and it does not crash in the phone app.

**Phase 2, one real scene.** The cellar with rats and the goblin, movement and a fight, the AI Dungeon Master through `ai.complete`, and a save through games-db.

**Phase 3, the decision.** Either carry on to a full conversion, or keep the TypeScript game and add live 3D with three.js instead.

## The rules question (the big cost)

Today's rules (dice, combat, skills, sight, adventures) are TypeScript with more than 2,200 tests.

- **Port them to C#:** the cleanest Unity project, but everything is rewritten and re-tested.
- **Keep the TypeScript engine in the page and use Unity only to draw:** keeps the tests, at the cost of more glue code between JavaScript and C#.

For the proof of concept: keep TypeScript (prove the platform and the look first), and decide on a port at the end of phase 2.

## Risks

- **iPhone:** Unity web builds hit memory limits and need a tap before audio plays; the phone app's WebView differs from Safari.
- **Size:** Unity's engine is far bigger than today's 1.7 MB page, so the first load is slower.
- **CI:** Unity licence activation in GitHub Actions; builds take 10 to 20 minutes.
- **Workflow:** scenes and prefabs are serialised files; keep logic in C# scripts and scenes small.
- **Cost:** phase 1 is a few working sessions.

## What the owner does

1. Install Unity Hub and sign in with a Unity account (an agent cannot create accounts or sign in for you).
2. Confirm the Unity plugin to use.
3. Say go for phase 0.

Related: the cloth-base decisions and the paused work are in STATUS.md; ConjureOS #1149 (sealed asset files).
