// The stage fit's layout: an upright tablet stacks the panel under a full width board, a phone and a landscape page are as they were,
// and the tray column is scaled up on a very large page. Screenshots go to the harness's shots folder for the eyes.
import { dmScript } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };

/** Into the Knight's first scene. A quick start may open the maker on its Name step (a named hero is required): type a name and begin. */
async function begin(g) {
  const d = g.driver;
  await d.ready();
  await d.toAdventureList();
  await g.page.locator('[data-lto-adventure="rat-cellar"]').click();
  await d.playAs("fighter");
  await d.dismissDialogue();
}

function measure() {
  const q = (s) => document.querySelector(s);
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
  };
  const root = q(".ltt-root");
  const col = q(".lt-tray-col");
  const stageApp = q(".lt-app-stage");
  return {
    stacked: root ? root.hasAttribute("data-lt-stack") : null,
    zoom: col ? col.style.zoom : null,
    innerW: innerWidth,
    innerH: innerHeight,
    wrap: r(q(".lt-stage-wrap")),
    board: r(q(".lt-board")),
    tray: r(col),
    hud: r(q("[data-lto-hud]")),
    sideways: stageApp ? stageApp.scrollWidth > stageApp.clientWidth + 1 : false,
    stageScrolls: stageApp ? stageApp.scrollHeight > stageApp.clientHeight + 1 : false,
    docWider: document.documentElement.scrollWidth > innerWidth + 1,
  };
}

export const specs = [
  {
    name: "an upright tablet stacks the panel under a full width board; landscape pages keep it beside; a phone stacks; 4K scales the panel up",
    async run({ newGame, assert }) {
      const cases = [
        [768, 1024, true, true],
        [820, 1180, true, true],
        [1024, 1366, true, true],
        [1024, 768, false, true],
        [1280, 900, false, false],
        [390, 844, true, true],
        [3840, 2160, false, false],
      ];
      for (const [width, height, stacked, touch] of cases) {
        const at = `${width}x${height}`;
        const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: { width, height }, hasTouch: touch });
        const d = g.driver;
        await begin(g);
        await d.settle(400);
        await g.page.waitForTimeout(300);
        const m = await g.page.evaluate(measure);
        await g.screenshot(`stagefit-${at}`);
        assert.equal(m.stacked, stacked, `${at}: stacked is ${m.stacked}`);
        assert.equal(m.sideways, false, `${at}: scrolls sideways`);
        assert.equal(m.docWider, false, `${at}: the page is wider than the window`);
        if (stacked) {
          assert.ok(m.tray.y >= m.wrap.bottom - 2, `${at}: the panel should be under the stage`);
          assert.ok(m.wrap.w >= width - 40, `${at}: the stage takes the page width (${Math.round(m.wrap.w)})`);
          // A phone's board takes the page width; an upright tablet's leaves room under it for the whole panel (so nothing scrolls).
          if (width <= 720) assert.ok(m.board.w >= width - 40, `${at}: the board takes the page width (${Math.round(m.board.w)})`);
          else {
            assert.ok(m.board.w >= 0.6 * width, `${at}: the board is ${Math.round(m.board.w)} wide, under 60% of the page`);
            assert.equal(m.stageScrolls, false, `${at}: the page scrolls, so the panel is not all in view`);
            assert.ok(m.tray.bottom <= m.innerH + 1, `${at}: the panel runs off the screen (${Math.round(m.tray.bottom)} of ${m.innerH})`);
          }
        } else {
          assert.ok(m.tray.x >= m.wrap.right - 2, `${at}: the panel should be beside the stage`);
        }
        if (width === 768) assert.ok(m.board.w >= 640, `${at}: the board is ${Math.round(m.board.w)} wide`);
        if (width === 3840) {
          assert.equal(m.zoom, "2", `${at}: the panel zoom is ${m.zoom}`);
          assert.ok(m.hud.w >= 700, `${at}: the panel is ${Math.round(m.hud.w)} wide`);
        } else assert.equal(m.zoom, "", `${at}: the panel should not be scaled (${m.zoom})`);
        await g.close();
      }
    },
  },

  {
    name: "turning a tablet from upright to landscape and back moves the panel under and beside the board, and the dice tray follows",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: { width: 768, height: 1024 }, hasTouch: true });
      const d = g.driver;
      await begin(g);
      const where = async () => {
        await g.page.waitForTimeout(450);
        return g.page.evaluate(() => {
          const host = document.querySelector(".lt-dice-host");
          const m = {
            stacked: document.querySelector(".ltt-root").hasAttribute("data-lt-stack"),
            diceOver: host.parentElement === document.querySelector(".lt-stage-wrap"),
            diceInColumn: !!host.closest(".lt-tray-col"),
            board: document.querySelector(".lt-board").getBoundingClientRect().width,
            errors: (window.__ltErrors || []).length,
          };
          return m;
        });
      };
      let w = await where();
      assert.equal(w.stacked, true, "upright stacks");
      assert.equal(w.diceOver, true, "and the dice host sits over the stage");
      await g.page.setViewportSize({ width: 1024, height: 768 });
      w = await where();
      assert.equal(w.stacked, false, "landscape is beside");
      assert.equal(w.diceInColumn, true, "and the dice host is back in the column");
      await g.page.setViewportSize({ width: 768, height: 1024 });
      w = await where();
      assert.equal(w.stacked, true, "upright again");
      assert.ok(w.board >= 640, `the board is back to its upright size (${Math.round(w.board)})`);
      assert.equal(w.errors, 0, "no window error");
    },
  },
];
