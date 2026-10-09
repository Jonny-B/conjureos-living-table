// The whole game, played through once at a desktop, a tablet and a phone size (lib/tour.mjs): the loading screen, the main menu, the
// adventure list, the hero choice, the maker (name first), The Rat Cellar from home to a fight in the cellar with the rats dying and a
// giant rat's pelt harvested, the actions menu with its text line, a DM answer, a DM call taken back, the game menu on six tabs and full
// screen. At every step the page must fit, and the items the lane specs hold one at a time are held here together:
//
//   1       no window error event anywhere (the runner fails any spec whose page raised one)
//   2, 3    the board fills its window; nothing is cut off; no sideways scroll
//   12      a place's story is told on a screen of its own and the world waits
//   13, 30  Cancel stands beside the DM's dots, makes no new call, and no step states a price
//   14      one menu with six tabs, and an equipment doll in Inventory
//   17      nothing the game prints covers the hero (the story screen may)
//   18, 19  no pop-up strip, ever
//   20, 21, 28  a left click only walks; the menu ends in a text line
//   22, 23  a fallen creature lies on the board; a giant rat's body offers Harvest and the pelt lands in the pack
//   24, 25  the main menu; no New character mid game; the maker waits for a name
//   26, 27  every size from a phone to a desktop, full screen included
//
// Every screen of the tour is saved to <repo>/.cache/bench-shots/bb-<step>-<size>.png for the eyes (node scripts/e2e/walk.mjs does the same at
// eight sizes).
import { tour } from "../lib/tour.mjs";

const SHOTS = ".cache/bench-shots";

const run = (width, height, touch, items) => async ({ newGame, assert }) => {
  const found = await tour(newGame, { width, height, touch, items, assert, shots: SHOTS });
  assert.deepEqual(found, [], `the tour at ${width}x${height} found problems`);
};

export const specs = [
  { name: "the whole game at 1280x900: from the loading screen to a cellar fight, harvest, Cancel and full screen, every screen fitting", run: run(1280, 900, false, true) },
  { name: "the whole game on a 390x844 phone: every screen fits, with a finger-sized target everywhere", run: run(390, 844, true, true) },
  { name: "the whole game on a 768x1024 tablet: every screen fits", run: run(768, 1024, true, false) },
];
