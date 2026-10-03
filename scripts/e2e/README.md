# e2e: headless checks of the real game

Playwright drives the game as a player sees it, with the ConjureOS host mocked.
Playwright is resolved from `C:/Users/blewi/Shelf/ConjureOS/node_modules/playwright`
(set `PLAYWRIGHT_PATH` to use another copy). The repo has no dependency on it.

```
node scripts/e2e/run.mjs                      # build this checkout like `npm run dev`, run every spec (also: npm run e2e)
node scripts/e2e/run.mjs --root <dir>         # test another checkout (a clean snapshot of a commit)
node scripts/e2e/run.mjs --mode dist          # test dist/living-table.html from `npm run build` (needs network for React)
node scripts/e2e/run.mjs --only "step"        # specs whose name or file contains the text
node scripts/e2e/run.mjs --headed --list --json out.json --shots <dir>
```

Exit code is 0 when every spec passes. A spec also fails when its page logged a
console error, threw, asked for a non-local host, or made an AI call the spec
had not scripted, so a stray paid call cannot go unnoticed.

## Pieces

- `lib/serve.mjs`: esbuild build into a temp dir (same config as `conj-pack dev`), static server on 127.0.0.1, plus `/livingtable-assets.json` from `scripts/assets/build-dev-manifest.ts` so the real art loads. Frozen copy: nothing reloads under a test while another session edits src/.
- `lib/platform.mjs`: the ConjureOS host mock. It always defines `window.__conjureos.ai.complete`; every call lands in `platform.calls` (system, messages, maxTokens, tier, temperature) and is answered from the script: `platform.script([{ match, reply }])`, where a reply may be `{ error: { message, code } }`, or `hold: true` to park the call until `platform.release()`. An unmatched call is rejected and reported. With `server: true` it also defines `actions.invoke` (the `gamesDb` remote action) and `auth.whoami`, and plays games-db from Node: the server saves (`ltSaveList`, `ltSaveGet`, `ltSavePut`, `ltSaveDelete`, with the real key, kind, size and row limits) live in `platform.saves` for the whole page, so they survive a reload; `ltAssetManifest` answers with the dev art when the game asks for `server: { art: true }` and with an error otherwise (the bundled art then serves); `platform.serverDown = "message"` makes the save calls fail like an outage.
- `lib/fixtures.mjs`: canned DM replies in the table DM's own shape (`dmReply`, `dmScript`, `LONG_NARRATION`).
- `lib/driver.mjs`: the verbs (`quickStart`, `dialogue`, `pressDialogue`, `dismissDialogue`, `ask`, `clickBoard`, `settle`, `openDrawer`, `setSetting`, `saves`, `rest`, `adventuresButton`, ...). Only this file knows the window's markup (its `data-lto-*` and `data-hud-*` attributes).
- `lib/harness.mjs`: one browser, a fresh page per spec, console/page/request watchers.
- `specs/table.spec.mjs`: the shipped game: the start screen, the Knight quick start, a step, a scripted DM ask with no price text anywhere, the dialogue box (typing, pages, clicks), the Settings tab, a save and a reload from the server alone, an outage, bundled art, no AI permission, another player's device cache, Fullscreen, and no sideways scroll at 390.
- `specs/*.spec.mjs`: `export const specs = [{ name, run({ newGame, assert, mode }) }]`.
- `baseline.mjs`: records pass/fail of `npm test` and the bench-HTML play scripts in `.cache/` to a JSON file.
