# e2e: headless checks of the real game

Playwright drives the game as a player sees it, with the ConjureOS host mocked.
Playwright is resolved from `C:/Users/blewi/Shelf/ConjureOS/node_modules/playwright`
(set `PLAYWRIGHT_PATH` to use another copy). The repo has no dependency on it.

```
node scripts/e2e/run.mjs                      # build this checkout like `npm run dev`, run every spec
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
- `lib/platform.mjs`: the host mock. Defines `window.__conjureos.ai.complete` only; with no `actions` the game answers games-db from its own in-memory mock (state is lost on reload, so specs do not reload). Every AI call lands in `platform.calls` (system, messages, maxTokens, tier, temperature). Replies are scripted: `platform.script([{ match, reply }])`; a reply may be `{ error: { message, code } }`, or `hold: true` to park the call until `platform.release()`. An unmatched call is rejected and reported.
- `lib/fixtures.mjs`: canned arc outline and DM turns (`campaignScript()`).
- `lib/driver.mjs`: the verbs (`createCampaign`, `createCharacter`, `beginScene`, `step`, `talk`, `back`, ...). Only this file knows today's markup.
- `lib/harness.mjs`: one browser, a fresh page per spec, console/page/request watchers.
- `specs/*.spec.mjs`: `export const specs = [{ name, run({ newGame, assert, mode }) }]`.
- `baseline.mjs`: records pass/fail of `npm test` and the 23 bench-HTML play scripts in `.cache/` to a JSON file.
