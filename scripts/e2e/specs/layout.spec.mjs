// Layout: the board fills the room the page gives it (phones to 4K, full screen), the mobile shell keeps the page still and
// text unselected, the dice come up over the play space on a phone, and the page never raises a window error event.
//
// The harness records every window "error" event (a ResizeObserver loop error is one that Playwright's pageerror never sees,
// yet the ConjureOS shell paints each as a red banner), and the runner fails any spec whose page raised one.
import { dmReply, dmScript } from "../lib/fixtures.mjs";

const WITH_SERVER = { art: true };

/** Every size the layout is held to: [width, height, touch]. */
export const SIZES = [
  [320, 640, true],
  [390, 844, true],
  [768, 1024, true],
  [820, 1180, true],
  [1024, 768, false],
  [1280, 900, false],
  [1920, 1080, false],
  [2560, 1440, false],
  [3840, 2160, false],
];

/** Measure the page: where the window, the arena, the stage and the board are, and whether anything scrolls. */
function measure() {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  const q = (s) => document.querySelector(s);
  const win = q(".lt-app-window");
  const stageApp = q(".lt-app-stage");
  const arena = q(".lt-arena");
  const wrap = q(".lt-stage-wrap");
  const view = q(".lt-viewport");
  const board = q(".lt-board");
  const canvas = q("canvas.ltt-canvas");
  const cs = wrap ? getComputedStyle(wrap) : null;
  const pad = (k) => (cs ? parseFloat(cs.getPropertyValue(k)) || 0 : 0);
  const sideways = [];
  for (const el of [document.documentElement, document.body, q(".lt-app"), win, stageApp, q(".ltt-root"), arena, wrap, view]) {
    if (el && el.scrollWidth > el.clientWidth + 1) sideways.push(`${el.className || el.tagName}: ${el.scrollWidth} > ${el.clientWidth}`);
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) sideways.push("page wider than the window");
  const wr = rect(wrap);
  const availW = wr ? wr.w - pad("padding-left") - pad("padding-right") : 0;
  const availH = wr ? wr.h - pad("padding-top") - pad("padding-bottom") : 0;
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    win: rect(win),
    stage: rect(stageApp),
    stageScrolls: stageApp ? stageApp.scrollHeight > stageApp.clientHeight + 1 : false,
    arena: rect(arena),
    wrap: wr,
    availW,
    availH,
    viewport: rect(view),
    board: rect(board),
    canvas: rect(canvas),
    viewportScrolls: view ? view.scrollWidth > view.clientWidth + 1 || view.scrollHeight > view.clientHeight + 1 : false,
    sideways,
    tray: rect(q(".lt-tray-col")),
    trayShown: q(".lt-tray-col") ? getComputedStyle(q(".lt-tray-col")).display !== "none" : false,
  };
}

/** The visible buttons and links of the page bar and the line under the window that are smaller than a fingertip (44 px). */
function smallTargets() {
  const out = [];
  for (const el of document.querySelectorAll(".lt-app-bar button, .lt-app-bar a, .lt-app-foot summary, .lt-app-foot a")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 43.5 || r.width < 43.5) out.push(`${(el.textContent || el.className).trim().slice(0, 30)}: ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
}

export const specs = [
  {
    name: "the page raises no window error event (ResizeObserver loop) over the start screen, a started game, three resizes and every drawer",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.adventures();
      for (const [w, h] of [[900, 700], [700, 900], [1280, 800]]) {
        await g.page.setViewportSize({ width: w, height: h });
        await g.page.waitForTimeout(250);
      }
      await d.quickStart();
      await d.dismissDialogue();
      for (const [w, h] of [[500, 800], [1100, 700], [390, 844]]) {
        await g.page.setViewportSize({ width: w, height: h });
        await g.page.waitForTimeout(250);
      }
      for (const drawer of ["pack", "journal", "log", "saves", "settings"]) {
        await d.openDrawer(drawer);
        await g.page.waitForTimeout(150);
        await d.closeDrawer(drawer);
      }
      await g.page.setViewportSize({ width: 1280, height: 900 });
      await g.page.waitForTimeout(400);
      const recorded = await g.page.evaluate(() => window.__ltErrors || []);
      assert.deepEqual(recorded, [], `the page recorded window errors: ${recorded.join(" | ")}`);
      assert.deepEqual(g.windowErrors, [], "and so did the harness");
    },
  },

  {
    name: "the board fills the room at every size from a 320 px phone to 4K: no sideways scroll, no inner scroll, no gap under the window, tap targets a fingertip wide",
    async run({ newGame, assert }) {
      for (const [width, height, touch] of SIZES) {
        const at = `${width}x${height}`;
        const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: { width, height }, hasTouch: touch });
        const d = g.driver;
        await d.ready();
        await d.quickStart();
        await d.dismissDialogue();
        await d.settle(400);
        await g.page.waitForTimeout(300);
        const m = await g.page.evaluate(measure);
        await g.screenshot(`layout-${at}`);
        assert.deepEqual(m.sideways, [], `${at}: something scrolls sideways`);
        assert.equal(m.viewportScrolls, false, `${at}: the board scrolls inside its box`);
        assert.ok(m.board && m.board.w > 0 && m.board.h > 0, `${at}: no board`);
        // The window is filled: the arena reaches the bottom of the window (a phone page may run on below it, scrolling).
        const gap = m.win.bottom - m.arena.bottom;
        if (m.stageScrolls) assert.ok(gap <= 8, `${at}: the arena stops ${gap} px short of the window`);
        else assert.ok(Math.abs(gap) <= 8, `${at}: the arena is ${gap} px from the bottom of the window`);
        // The board never leaves the stage, and uses its width or its height.
        assert.ok(m.board.w <= m.availW + 2 && m.board.h <= m.availH + 2, `${at}: board ${Math.round(m.board.w)}x${Math.round(m.board.h)} is bigger than the stage ${Math.round(m.availW)}x${Math.round(m.availH)}`);
        const use = Math.max(m.board.w / m.availW, m.board.h / m.availH);
        assert.ok(use >= 0.8, `${at}: the board uses only ${Math.round(use * 100)}% of the stage`);
        // The tray column sits beside the stage above 720 px and under it at 720 and below, and under it on an upright page (stageFit.ts stackedAt).
        if (width > 720 && height < width * 1.2) {
          assert.ok(m.tray && m.tray.x >= m.wrap.right - 2, `${at}: the tray column should sit beside the stage`);
          assert.ok(Math.abs(m.tray.y - m.wrap.y) <= 2, `${at}: and start at its top`);
        } else {
          assert.ok(m.tray && m.tray.y >= m.wrap.bottom - 2, `${at}: the tray column should stack under the stage`);
          assert.ok(m.wrap.w >= width - 40, `${at}: the stage should take the screen width (${Math.round(m.wrap.w)})`);
        }
        if (width >= 1024) assert.ok(m.board.w >= 600 || m.board.h >= 450, `${at}: the board is small`);
        if (touch) assert.deepEqual(await g.page.evaluate(smallTargets), [], `${at}: tap targets under 44 px`);
        await g.close();
      }
    },
  },

  {
    name: "a double click on the board selects no text, a right click and a drag leave the browser menu out, and the page keeps its own gestures",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript() });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      const style = await g.page.evaluate(() => {
        const root = getComputedStyle(document.querySelector(".ltt-root"));
        const app = getComputedStyle(document.querySelector(".lt-app"));
        const input = document.querySelector("[data-lto-hud] input");
        return {
          rootSelect: root.userSelect || root.webkitUserSelect,
          appSelect: app.userSelect || app.webkitUserSelect,
          touch: app.touchAction,
          overscroll: getComputedStyle(document.body).overscrollBehaviorY,
          inputSelect: input ? getComputedStyle(input).userSelect || getComputedStyle(input).webkitUserSelect : "n/a",
        };
      });
      assert.equal(style.rootSelect, "none", "the window text cannot be selected");
      assert.equal(style.appSelect, "none", "nor the page text");
      assert.equal(style.touch, "manipulation", "a double tap is the game's");
      assert.equal(style.overscroll, "none", "the page does not rubber-band");
      if (style.inputSelect !== "n/a") assert.notEqual(style.inputSelect, "none", "a text field stays editable");
      const box = await g.page.locator("canvas.ltt-canvas").boundingBox();
      await g.page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
      await g.page.mouse.dblclick(box.x + 30, box.y + 30);
      await g.page.waitForTimeout(150);
      assert.equal(await g.page.evaluate(() => String(getSelection())), "", "a double click selected nothing");
      const prevented = await g.page.evaluate(() => {
        const canvas = document.querySelector("canvas.ltt-canvas");
        const out = [];
        for (const type of ["contextmenu", "dragstart"]) {
          const ev = new Event(type, { bubbles: true, cancelable: true });
          canvas.dispatchEvent(ev);
          out.push(ev.defaultPrevented);
        }
        return out;
      });
      assert.deepEqual(prevented, [true, true], "no browser menu and no picture drag on the board");
    },
  },

  {
    name: "on a phone the dice come up over the board when a roll is waiting, stay inside the stage and the screen, and sit back in the tray column on a wide page",
    async run({ newGame, assert }) {
      const check = {
        ability: "dex",
        dc: 12,
        why: "A stiff lock.",
        success: { narration: "It clicks open.", effects: [], options: [{ label: "Wait", say: "I wait." }] },
        failure: { narration: "It holds.", effects: [], options: [{ label: "Wait", say: "I wait." }] },
      };
      const g = await newGame({ server: WITH_SERVER, script: dmScript({ ...dmReply({ narration: "The lock is stiff." }), check }), viewport: { width: 390, height: 844 }, hasTouch: true });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      await d.setSetting("rollMyself", "true");
      await d.closeDrawer("settings");
      const where = () =>
        g.page.evaluate(() => {
          const host = document.querySelector(".lt-dice-host");
          const r = (e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
          };
          const tray = document.querySelector("[data-ltd-root]");
          const wrap = document.querySelector(".lt-stage-wrap");
          const cs = getComputedStyle(wrap);
          return {
            over: host.parentElement === wrap,
            inColumn: !!host.closest(".lt-tray-col"),
            quiet: host.classList.contains("lt-dice-quiet"),
            state: tray.dataset.state,
            tray: r(tray),
            stage: r(wrap),
            dock: parseFloat(cs.paddingBottom) || 0,
            innerW: innerWidth,
            innerH: innerHeight,
          };
        });
      let w = await where();
      assert.equal(w.over, true, "on a phone the dice host sits in the stage");
      assert.equal(w.quiet, true, "and stays out of sight while nothing is rolled");
      await d.ask("I pick the lock");
      await g.page.locator('[data-ltd-root][data-state="waiting"]').waitFor({ timeout: 15000 });
      await g.page.waitForTimeout(300);
      w = await where();
      assert.equal(w.quiet, false, "a waiting roll shows the tray");
      const t = w.tray;
      const s = w.stage;
      assert.ok(t.x >= s.x - 1 && t.right <= s.right + 1 && t.y >= s.y - 1 && t.bottom <= s.bottom - w.dock + 1, `the tray ${JSON.stringify(t)} lies inside the stage ${JSON.stringify(s)} above the dock band (${w.dock})`);
      assert.ok(t.x >= 0 && t.y >= 0 && t.right <= w.innerW && t.bottom <= w.innerH, "and inside the screen");
      await g.screenshot("dice-over-board-390");
      await g.page.locator("[data-ltd-root]").click();
      await g.page.waitForFunction(() => document.querySelector("[data-ltd-root]")?.dataset.state === "settled", null, { timeout: 8000 });
      await g.page.waitForFunction(() => document.querySelector(".lt-dice-host")?.classList.contains("lt-dice-quiet"), null, { timeout: 8000 });
      await g.page.setViewportSize({ width: 1280, height: 900 });
      await g.page.waitForTimeout(400);
      w = await where();
      assert.equal(w.over, false, "on a wide page the dice host leaves the stage");
      assert.equal(w.inColumn, true, "and is back in the tray column");
    },
  },

  {
    name: "the board is drawn again when the page changes size, a click lands on the square under it at every size, and an explicit zoom never overflows",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: { width: 1280, height: 900 } });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      const board = async () => {
        await g.page.waitForTimeout(350);
        return g.page.evaluate(measure);
      };
      const wide = await board();
      await g.page.setViewportSize({ width: 1920, height: 1080 });
      const huge = await board();
      assert.ok(huge.board.w > wide.board.w + 150, `a bigger window draws a bigger board (${Math.round(wide.board.w)} to ${Math.round(huge.board.w)})`);
      await g.page.setViewportSize({ width: 800, height: 700 });
      const small = await board();
      assert.ok(small.board.w < huge.board.w - 150, "a smaller one draws a smaller board");
      assert.deepEqual(small.sideways, []);
      // The hero square is published for the checks, and a click on another square walks there.
      const heroRect = () => g.page.locator(".lt-viewport").getAttribute("data-lt-hero-rect").then((t) => t.split(",").map(Number));
      for (const [width, height, step] of [[1280, 900, 2], [390, 844, -2]]) {
        await g.page.setViewportSize({ width, height });
        await g.page.waitForTimeout(400);
        const before = await heroRect();
        assert.equal(before.length, 4);
        const canvas = await g.page.locator("canvas.ltt-canvas").boundingBox();
        const tile = canvas.width / 20;
        assert.ok(Math.abs(before[2] - tile) < 0.6, `${width}: the hero rect is one square wide (${before[2]} vs ${tile})`);
        const colBefore = Math.round((before[0] - canvas.x) / tile);
        const rowBefore = Math.round((before[1] - canvas.y) / tile);
        const target = { c: colBefore + step, r: rowBefore };
        await g.page.mouse.click(canvas.x + (target.c + 0.5) * tile, canvas.y + (target.r + 0.5) * tile);
        await d.settle(400);
        const after = await heroRect();
        const col = Math.round((after[0] - canvas.x) / tile);
        const row = Math.round((after[1] - canvas.y) / tile);
        assert.ok(col !== colBefore || row !== rowBefore, `${width}: the hero did not move`);
        assert.ok(Math.abs(col - target.c) <= 1 && Math.abs(row - target.r) <= 1, `${width}: the hero went to (${col},${row}) for a click on (${target.c},${target.r})`);
      }
      await g.page.setViewportSize({ width: 1024, height: 768 });
      await d.setSetting("zoom", "4");
      const zoomed = await board();
      assert.deepEqual(zoomed.sideways, [], "zoom 4 on a small window does not scroll sideways");
      assert.equal(zoomed.viewportScrolls, false, "nor inside the board");
      assert.ok(zoomed.board.w <= zoomed.availW + 2 && zoomed.board.h <= zoomed.availH + 2, "and never overflows the stage");
    },
  },

  {
    name: "full screen fills the whole screen with the board, not the top left quarter, and leaving it puts the page back",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: dmScript(), viewport: { width: 1000, height: 700 } });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue();
      const small = await g.page.evaluate(measure);
      await g.page.locator(".lt-app-full").click();
      await g.page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5000 });
      await g.page.waitForTimeout(600);
      const m = await g.page.evaluate(measure);
      const app = await g.page.evaluate(() => {
        const r = document.querySelector(".lt-app").getBoundingClientRect();
        return { w: r.width, h: r.height, innerW: innerWidth, innerH: innerHeight };
      });
      assert.ok(Math.abs(app.w - app.innerW) <= 1 && Math.abs(app.h - app.innerH) <= 1, `the page fills the screen (${Math.round(app.w)}x${Math.round(app.h)} of ${app.innerW}x${app.innerH})`);
      assert.ok(m.board.w >= small.board.w, `the board did not shrink (${Math.round(small.board.w)} to ${Math.round(m.board.w)})`);
      assert.ok(Math.max(m.board.w / m.availW, m.board.h / m.availH) >= 0.8, "the board fills the stage");
      assert.ok(Math.abs(m.win.bottom - m.arena.bottom) <= 8, "and nothing is blank under the window");
      assert.deepEqual(m.sideways, []);
      await g.screenshot("fullscreen");
      await g.page.locator(".lt-app-full").click();
      await g.page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 5000 });
    },
  },
];
