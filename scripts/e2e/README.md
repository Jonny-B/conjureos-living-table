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
- `lib/driver.mjs`: the verbs (`toAdventureList`, `quickStart`, `playAs`, `continueGame`, `dialogue`, `pressDialogue`, `pressStory`, `dismissDialogue`, `ask`, `clickBoard`, `settle`, `openMenu`, `closeMenu`, `menuTabs`, `setSetting`, `settingsPressed`, `saves`, `rest`, `heroRect`, `adventuresButton`, ...). Only this file knows the window's markup (its `data-lto-*`, `data-hud-*`, `data-game-menu` and `data-menu-tab` attributes).
  - A named hero is required: "Play as the X" opens the character maker on its Name step with Begin disabled. `playAs(chassis, name = "Mira")` presses it, types the name, presses Begin and waits for the opening (`name: null` stops at the maker with the name empty). `quickStart(adventureId, chassis, name)` is the adventure card plus `playAs`. Never click `[data-lto-quick]` and wait for the story directly; the hero in the HUD and the Character tab is named Mira, not Knight.
  - The game menu (Character, Inventory, Journal, Log, Saves, Settings) opens inside the stage. `openMenu(tab)` presses the side panel's Menu button and then the tab (`openDrawer` is the old name and still works: "pack" is "inventory"); over the main menu or a start screen only Saves and Settings are reachable, and `openMenu` goes through the main menu's Load and Settings. `setSetting`, `settingsPressed` and `saves` read or press and then close the menu again, so the game is in reach after them.
  - There is no ask box. `ask(text)` right clicks the square beside the hero (`heroRect()` reads the mark the stage keeps on the viewport), types into the menu's text line (`input[data-lto-cm-input]`) and presses Enter.
  - `dismissDialogue` presses a story screen (`[data-lto-story]`) as well as the dialogue box, until both are gone.
  - `continueGame` is the way back into a saved game after a reload: the main menu's Continue (opened from the adventure list's Main menu button when the window opens there).
- `lib/harness.mjs`: one browser, a fresh page per spec, console/page/request watchers.
- `specs/table.spec.mjs`: the shipped game: the start screen, the Knight quick start, a step, a scripted DM ask with no price text anywhere, the dialogue box (typing, pages, clicks), the Settings tab, a save and a reload from the server alone, an outage, bundled art, no AI permission, another player's device cache, Fullscreen, and no sideways scroll at 390.
- `specs/menu.spec.mjs`: the game menu and the side panel: six tabs in order inside the stage, Escape and the C, I, J, L keys, the game waiting while it is open, no ask box and no Attack, Use, Potion or Cancel button, End turn automatically in Settings, a bagged piece previewing its stat changes (green and red, the engine's refusal in words, a tap then Equip on touch), the side panel condensed on a phone, the menu fitting 320 px with 44 px targets, and Saves and Settings over the main menu. Gear is put in the bag by editing the server's saves and coming back with Continue.
- `lib/journey.mjs`: playing The Rat Cellar through the page the way a player does (walking by clicking, the actions menu, the talks), reading the adventure file for where the doors, Tobin and Marta are. `lib/tour.mjs` is the whole game at one window size on top of it: the loading screen, the main menu, the adventure list, the hero choice, the maker, home, the actions menu, a DM answer, the game menu on six tabs, the cellar fight with the rats dying and a giant rat harvested, a DM call taken back and full screen. At every step it checks the page fits (no sideways scroll, nothing cut off by the window, nothing the game prints covering the hero outside the story screen, a finger-sized target on a phone, no notice strip) and saves a screenshot to `.cache/bench-shots/bb-<step>-<width>x<height>.png`.
- `specs/integration.spec.mjs`: the tour at 1280x900, 390x844 (touch) and 768x1024 (touch), with the bug bash items held together (the story screen locks the world, Cancel, left click walks only, the menu's text line, six tabs, Harvest, name first, no New character, the board filling its window).
- `walk.mjs`: the same tour at eight sizes, 320x640 up to 3840x2160, for the eyes: `node scripts/e2e/walk.mjs [--sizes 320x640,390x844] [--shots dir] [--items]` (`LT_TRACE=1` names each step as it goes).
- `specs/*.spec.mjs`: `export const specs = [{ name, run({ newGame, assert, mode }) }]`.
- `baseline.mjs`: records pass/fail of `npm test` and the bench-HTML play scripts in `.cache/` to a JSON file.
