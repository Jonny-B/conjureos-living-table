// The owner's rule as a check: "the game must be designed to fit on mobile, tablet and all web screen sizes", with controls always reachable,
// text never clipped and no dead blank space. One spec per window size (lib/tour.mjs FIT_SIZES: five phones, two tablets, two landscape
// phones, seven desktops up to 3840x2160). Each plays the whole tour at that size (loading screen to a cellar fight, harvest, Cancel and
// full screen) with the fit checks on at every step (lib/tour.mjs fitChecks, on top of the older page-fits checks):
//
//   reach        every button, tab, input and action is whole in the window, or a scroller can bring it there (not under the footer, not covered)
//   scroll-cue   a scroller that clips content shows a cue (data-more, a local scroll shadow or a sticky footer)
//   dead-band    on a page 720 wide or under: at most 24 px between the board and the next block; wider: the board fills 85 percent of its stage
//   text-clipped no chip, HUD label, maker step tab, button or bar title is cut off; the turn strip shows the Round tab and every chip whole
//   text-size    at 3840 wide every text is 14 CSS px or more (pixel text 14 px of cap height, chip keys 10)
//   touch        on a touch screen every button is 44 px high
//
// Phones and tablets are opened as mobile devices (touch, pixel ratio 2 or 3); desktops at ratio 1. The sizes run one after another and the
// tour reuses one page per size. A failure names the size, the step, the check and the element. The screens are saved to .cache/fit-shots.
// Run: node scripts/e2e/run.mjs --only fit      (node scripts/e2e/walk.mjs --sizes all prints the same checks as one table)
import { tour, FIT_SIZES, profileFor } from "../lib/tour.mjs";

const SHOTS = ".cache/fit-shots";

const kind = (w, h, touch) => (!touch ? "desktop" : h < w && h <= 400 ? "landscape phone" : Math.min(w, h) >= 700 ? "tablet" : "phone");

export const specs = FIT_SIZES.map(([width, height, touch]) => ({
  name: `fit: the whole game at ${width}x${height} (${kind(width, height, touch)}) keeps every control reachable, no text clipped, no dead space`,
  run: async ({ newGame, assert }) => {
    const { dpr, mobile } = profileFor(width, height);
    const found = await tour(newGame, { width, height, touch, dpr, mobile, shots: SHOTS, items: false, assert, fit: true });
    assert.equal(found.length, 0, ["the fit checks at " + width + "x" + height + " found " + found.length + " problem(s):", ...found].join("\n"));
  },
}));
