// A tour of the whole game at one window size, the way a player meets it: the loading screen, the main menu, the adventure list, the hero
// choice, the character maker (name first), The Rat Cellar from home to a fight in the cellar with the rats dying and a body harvested, the
// actions menu with its text line, a DM answer, a DM call taken back, the game menu on all six tabs, and full screen. At every step it checks
// the page FITS (no sideways scroll, nothing cut off by the window, nothing the game prints covering the hero outside the story screen, a
// finger-sized target on a phone) and saves a screenshot to <shots>/bb-<step>-<width>x<height>.png.
//
// Used by specs/integration.spec.mjs (a few sizes, with the item checks) and by walk.mjs (every size, for the eyes).
import fs from "node:fs";
import path from "node:path";
import { dmReply } from "./fixtures.mjs";
import { COLS, ROWS, PIN_DICE, pin, readMenu, menuRow, clickRow, rightClickTile, leftClickTile, heroTile, readStory, homeToCellar, squaresOf, tilePoint, talkReply, waitUntil, walkTo } from "./journey.mjs";

const T = 15000;
const DM_ASK = (call) => !/You are writing ONE complete adventure/.test(call.messages[0]?.content ?? "");

/** The DM's script for the tour: Tobin and Marta talk, one question is held (to be taken back), anything else gets a plain answer. */
export function tourScript() {
  const talk = talkReply(dmReply);
  const lastAsk = (call) => call.messages[call.messages.length - 1]?.content ?? "";
  return [
    { match: (c) => DM_ASK(c) && /I listen at the door/.test(lastAsk(c)), hold: true, reply: JSON.stringify(dmReply({ narration: "You hear nothing." })) },
    {
      match: DM_ASK,
      reply: (call) => {
        // The newest question is the last one named in the prompt (the earlier ones ride along as reminders).
        const said = [...call.messages.map((x) => x.content).join(" ").matchAll(/I look at the walls|I talk to [A-Z][a-z]+(?: [A-Z][a-z]+)?/g)].pop()?.[0] ?? "";
        if (/I look at the walls/.test(said)) return JSON.stringify(dmReply({ narration: "The stone is old and cold, and the cobwebs in the corners have not been touched in years." }));
        return JSON.stringify(talk(call));
      },
    },
  ];
}

/** Everything the fit checks read, in one page call. */
async function measure(page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rectOf = (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
    };
    const shown = (n) => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      return !n.closest("[hidden]");
    };
    // A layer inside a box that scrolls up and down (the side panel of a phone on its side) is reached by scrolling it; the fit checks judge it there.
    const inScroller = (n) => {
      for (let p = n.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        if (["auto", "scroll"].includes(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
      }
      return false;
    };
    const pick = (sel) => [...document.querySelectorAll(sel)].filter(shown).map((n) => ({ sel, ...rectOf(n), scr: inScroller(n), text: (n.innerText || n.getAttribute("aria-label") || "").slice(0, 30) }));
    const hero = document.querySelector(".lt-viewport")?.getAttribute("data-lt-hero-rect");
    let heroRect = null;
    if (hero) {
      const [x, y, w, h] = hero.split(",").map(Number);
      if ([x, y, w, h].every(Number.isFinite)) heroRect = { x, y, w, h, r: x + w, b: y + h };
    }
    const fullscreen = document.fullscreenElement !== null;
    return {
      W,
      H,
      fullscreen,
      scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      scrollH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      heroRect,
      // The layers that must sit inside the window.
      layers: [
        ...pick(".lt-app-bar"),
        ...pick(".lt-arena"),
        ...pick(".lt-stage-wrap"),
        ...pick("[data-lto-hud]"),
        ...pick("[data-lto-dialogue]"),
        ...pick(".lto-story-panel"),
        ...pick("[data-game-menu]"),
        ...pick("[data-ltm-menu]"),
        ...pick('[data-lto-menu][role="menu"]'),
        ...pick("[data-lto-loot]"),
        ...pick("[data-lto-initiative]"),
        ...pick(".lt-dice-host"),
      ],
      // What the game prints over the board and must keep off the hero (the story screen may cover it: it is the whole story; the dice tray is the roll itself and rises over the board while a die is thrown).
      overlays: [...pick("[data-lto-dialogue]"), ...pick("[data-lto-initiative]"), ...pick("[data-lto-banner]")],
      // Things a finger has to hit.
      targets: [...pick('[data-lto-hud] button, [data-game-menu] button, [data-game-menu] [role="tab"], [data-ltm-menu] button, [data-lto-menu] [data-lto-menu-item], .lt-app-actions button, [data-lts] button, [data-lto-hero] button, [data-lto-screen] button, [data-lto-loot] button')]
        .filter((t) => t.w > 0)
        .map((t) => ({ sel: t.sel, w: t.w, h: t.h, text: t.text })),
      toasts: document.querySelectorAll(".lto-toast, [data-lto-toast], [data-lto-toasts]").length,
    };
  });
}

const overlap = (a, b) => !!a && !!b && a.x < b.r - 0.5 && a.r > b.x + 0.5 && a.y < b.b - 0.5 && a.b > b.y + 0.5;

/**
 * Check the page fits and return a list of what does not. `story` says a story screen is up (it may cover the hero); `touch` that fingers
 * are the pointer (targets must be 44 px).
 */
export async function fitProblems(page, { story = false, touch = false, vertical = true } = {}) {
  const m = await measure(page);
  const bad = [];
  // The side panel stacks under the board on a page 720 px wide or narrower and on an upright one (stageFit.ts stackedAt).
  const stacked = m.W <= 720 || m.H >= m.W * 1.2;
  if (m.scrollW > m.W + 1) bad.push(`the page scrolls sideways (${m.scrollW} > ${m.W})`);
  // On a narrow page the side panel stacks under the board and the page scrolls up and down by design; only a wide page must fit its height.
  if (vertical && !stacked && m.scrollH > m.H + 1) bad.push(`the page scrolls up and down (${m.scrollH} > ${m.H})`);
  for (const l of m.layers) {
    // The page's own scrolling holds the side panel under the board on a narrow page, so the arena and the panel may run past the bottom there.
    const scrolls = (stacked && (l.sel === ".lt-arena" || l.sel === "[data-lto-hud]")) || (l.scr && (stacked || l.sel !== ".lt-arena"));
    if (l.x < -1 || l.r > m.W + 1 || (!scrolls && (l.y < -1 || l.b > m.H + 1))) bad.push(`${l.sel} is cut off by the window: ${Math.round(l.x)},${Math.round(l.y)} to ${Math.round(l.r)},${Math.round(l.b)} in ${m.W}x${m.H}`);
  }
  if (!story && m.heroRect) {
    for (const o of m.overlays) if (overlap(o, m.heroRect)) bad.push(`${o.sel} covers the hero (${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}x${Math.round(o.h)} over ${Math.round(m.heroRect.x)},${Math.round(m.heroRect.y)})`);
  }
  if (touch) {
    for (const t of m.targets) if (Math.min(t.w, t.h) < 43.5) bad.push(`target "${t.text}" is ${Math.round(t.w)}x${Math.round(t.h)}: too small for a finger`);
  }
  if (m.toasts > 0) bad.push("a notice strip is on the page");
  return bad;
}

// ---- the fit checks: the owner's rule ("fit mobile, tablet and every web screen size; controls always reachable; text never clipped; no dead
// blank space") as a script. Every check runs inside the page in one call and returns "[check] element: what is wrong" lines. They run at every
// step of a tour opened with `fit: true` (specs/fit.spec.mjs and walk.mjs); fitProblems above is kept as it was and runs everywhere.

/** The window sizes the fit spec and the walk cover: [width, height, touch screen, pixel ratio]. */
export const FIT_SIZES = [
  [320, 640, true, 2],
  [360, 740, true, 3],
  [390, 844, true, 3],
  [430, 932, true, 3],
  [768, 1024, true, 2],
  [820, 1180, true, 2],
  [844, 390, true, 3],
  [667, 375, true, 2],
  [1024, 768, false, 1],
  [1180, 820, false, 1],
  [1280, 800, false, 1],
  [1366, 768, false, 1],
  [1440, 900, false, 1],
  [1920, 1080, false, 1],
  [2560, 1440, false, 1],
  [3840, 2160, false, 1],
];

/** How a window of this size is held: { touch, dpr, mobile }. A size outside FIT_SIZES is a phone or tablet when 820 px wide or less, or a landscape phone 400 px high or less. */
export function profileFor(width, height) {
  const hit = FIT_SIZES.find(([w, h]) => w === width && h === height);
  if (hit) return { touch: hit[2], dpr: hit[3], mobile: hit[2] };
  const touch = width <= 820 || height <= 400;
  return { touch, dpr: touch ? 2 : 1, mobile: touch };
}

/** Steps where the board is in play with nothing laid over it: the dead band and the board fill are judged here. */
const IN_PLAY = ["home", "fight-start", "fight", "fight-won", "harvest", "fullscreen"];

/**
 * Run the fit checks on the page as it stands. `step` names the step (the in-play checks only judge in-play steps), `touch` says fingers are
 * the pointer (every target 44 px high). Returns lines "[check] element: what is wrong"; an empty list is a page that fits. The checks:
 *   reach        every button, tab, input and [data-action]/[data-option] is whole inside the window, or a scroller that holds it can bring it there
 *                (scrollIntoView, then measured again: not off screen, not under the footer, not covered at its centre per elementFromPoint)
 *   scroll-cue   a scroller that clips content shows a cue: data-more, a background-attachment:local shadow layer, or a sticky footer
 *   dead-band    page 720 wide or under: at most 24 px between the board and the next block (or the foot of the window), when no DM box is up
 *   board-fill   wider page: the board fills 85 percent of the stage in width or in height
 *   text-clipped nothing truncates (ellipsis or overflow hidden that really cuts) in chips, the HUD, the maker's step tabs, buttons or the bar;
 *   turn-strip   the turn strip shows the Round tab and every chip whole
 *   text-size    at 3840 wide, DOM text is 14 CSS px (times CSS zoom) and pixel text 14 px of cap height (chip keys 10)
 *   touch        on a touch screen every button, tab and input is 44 px high
 */
export async function fitChecks(page, { step = "", touch = false } = {}) {
  return page.evaluate(
    ({ step, touch, inPlay }) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const out = [];
      const px = (v) => Math.round(v * 10) / 10;
      const R = (n) => n.getBoundingClientRect();
      function describe(n) {
        if (!n || !n.tagName) return String(n);
        const cls = [...n.classList].slice(0, 2).map((c) => `.${c}`).join("");
        const data = n.getAttributeNames().find((a) => a.startsWith("data-lt") || a.startsWith("data-hud") || a.startsWith("data-menu") || a === "data-action" || a === "data-option" || a === "data-game-menu");
        const raw = n.tagName === "CANVAS" ? n.dataset.text : n.innerText || n.getAttribute("aria-label") || n.value || "";
        const text = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
        return `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${cls}${data ? `[${data}${n.getAttribute(data) ? `=${n.getAttribute(data).slice(0, 16)}` : ""}]` : ""}${text ? ` "${text}"` : ""}`;
      }
      const add = (check, el, what) => out.push(`[${check}] ${typeof el === "string" ? el : describe(el)}: ${what}`);
      const memo = new Map();
      const shown = (n) => {
        if (memo.has(n)) return memo.get(n);
        let ok = true;
        const r = R(n);
        if (r.width === 0 || r.height === 0 || n.hasAttribute("hidden") || n.hasAttribute("inert") || n.classList.contains("lto-sr")) ok = false;
        else {
          const cs = getComputedStyle(n);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) ok = false;
          else if (n.parentElement && n.parentElement !== document.body) ok = shown(n.parentElement);
        }
        memo.set(n, ok);
        return ok;
      };
      const all = [...document.querySelectorAll("body *")];

      // Checking scrolls things into view; remember every scroll position so the page is as it was when the screenshot comes.
      const scrolled = [document.scrollingElement, ...all].filter(Boolean).map((n) => [n, n.scrollTop, n.scrollLeft]);
      const stage = document.querySelector(".lt-app-stage");
      const foot = document.querySelector(".lt-app-foot");
      const footRect = foot && shown(foot) ? R(foot) : null;

      // ---- scroll cue
      const hasCue = (c) => {
        const more = (n) => n.hasAttribute("data-more") && !["false", "0"].includes(n.getAttribute("data-more") ?? "");
        if (more(c)) return true;
        const up = c.parentElement?.closest("[data-more]");
        if (up && up !== stage && more(up)) return true;
        const cs = getComputedStyle(c);
        if (/gradient/.test(cs.backgroundImage) && /local/.test(cs.backgroundAttachment)) return true;
        return [...c.querySelectorAll("*")].some((d) => {
          const s = getComputedStyle(d);
          return s.position === "sticky" && s.bottom !== "auto" && shown(d);
        });
      };
      const docEl = document.documentElement;
      for (const c of [docEl, ...all]) {
        const isDoc = c === docEl;
        if (!isDoc && (["TEXTAREA", "SELECT", "INPUT", "CANVAS", "svg", "BUTTON"].includes(c.tagName) || !shown(c))) continue;
        const scrollsY = isDoc ? getComputedStyle(docEl).overflowY !== "hidden" && getComputedStyle(document.body).overflowY !== "hidden" : ["auto", "scroll"].includes(getComputedStyle(c).overflowY);
        if (!scrollsY) continue;
        const clipped = c.scrollHeight - c.clientHeight;
        if (clipped <= 4) continue;
        if (!hasCue(c)) add("scroll-cue", isDoc ? "page" : c, `clips ${Math.round(clipped)} px of content (${c.clientWidth}x${c.clientHeight}, content ${c.scrollHeight}) with no cue: no data-more, no scroll shadow (background-attachment: local), no sticky footer`);
      }

      // ---- dead band under the board on a narrow page; the board filling its room on a wide one
      const canvas = document.querySelector("canvas.ltt-canvas");
      const dlg = document.querySelector("[data-lto-dialogue]");
      // A roll in progress holds the room under the board for the dice (they ride over its foot): not a dead band either.
      const over = [...document.querySelectorAll("[data-game-menu], [data-lto-story], [data-ltm-menu], [data-lto-loot], .lt-stage-wrap > .lt-dice-host.lt-dice-over:not(.lt-dice-quiet)")].some(shown);
      if (inPlay.includes(step) && canvas && shown(canvas) && !(dlg && !dlg.hasAttribute("hidden")) && !over) {
        const c = R(canvas);
        if (W <= 720) {
          const room = R(document.querySelector(".lt-app-window") ?? document.body);
          let next = null;
          for (const n of stage ? stage.querySelectorAll("*") : []) {
            if (n === canvas || n.contains(canvas) || canvas.contains(n) || !shown(n)) continue;
            const r = R(n);
            if (r.top < c.bottom - 2) continue;
            const own = [...n.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim());
            if (!(own || n.matches("button, canvas, input, img, svg"))) continue;
            if (!next || r.top < next.top) next = { top: r.top, n };
          }
          // Nothing under the board at all: the dead band is whatever is left of the window under it.
          const gap = (next ? next.top : room.bottom) - c.bottom;
          if (gap > 24) add("dead-band", next ? next.n : "the window", `${px(gap)} px of empty space between the bottom of the board (${Math.round(c.bottom)}) and ${next ? "the next block" : "the foot of the window"} (limit 24)`);
        } else {
          const s = document.querySelector(".lt-stage-wrap");
          if (s) {
            const sr = R(s);
            // The bands the game keeps clear on purpose (the DM box below, the turn strip above: they are the stage wrap's padding) are not the board's room;
            // keeping them reserved is what stops the board resizing every time the Dungeon Master speaks.
            const sc = getComputedStyle(s);
            const roomH = sr.height - (parseFloat(sc.paddingTop) || 0) - (parseFloat(sc.paddingBottom) || 0);
            const fill = Math.max(c.width / sr.width, c.height / Math.max(1, roomH));
            if (fill < 0.85) add("board-fill", canvas, `${Math.round(c.width)}x${Math.round(c.height)} in a stage of ${Math.round(sr.width)}x${Math.round(roomH)} (bands left out): fills ${Math.round(fill * 100)} percent in its best axis (needs 85)`);
          }
        }
      }

      // ---- text that is cut off
      const truncated = (n) => {
        const cs = getComputedStyle(n);
        const hx = cs.overflowX === "hidden" || cs.overflowX === "clip";
        const hy = cs.overflowY === "hidden" || cs.overflowY === "clip";
        if (hx && n.scrollWidth > n.clientWidth + 1) return `text cut off sideways (${n.scrollWidth} wide in ${n.clientWidth}${cs.textOverflow === "ellipsis" ? ", ellipsis" : ""})`;
        if (hy && n.scrollHeight > n.clientHeight + 1 && (n.innerText || "").trim()) return `text cut off at the bottom (${n.scrollHeight} high in ${n.clientHeight})`;
        return null;
      };
      const watch = new Set([
        ...document.querySelectorAll(".lto-chip, .lto-chip-item, .lts-step, .lto-hud-bar, .lt-app-title, .lt-app-bar button, button"),
        ...all.filter((n) => n.getAttributeNames().some((a) => a.startsWith("data-hud-"))),
      ]);
      const sawText = new Set();
      for (const n of watch) {
        if (!shown(n)) continue;
        for (const m of [n, ...n.querySelectorAll("*")]) {
          if (sawText.has(m) || !shown(m)) continue;
          sawText.add(m);
          const why = truncated(m);
          if (why) add("text-clipped", m, why);
        }
      }
      const strip = document.querySelector("[data-lto-initiative]");
      if (strip && shown(strip)) {
        const sr = R(strip);
        const round = strip.querySelector(".lto-round, [data-lto-round]");
        if (!round || !shown(round)) add("turn-strip", strip, "the Round tab is not on the strip");
        else if (R(round).left < sr.left - 1 || R(round).right > sr.right + 1) add("turn-strip", round, "the Round tab is cut off by the strip");
        for (const chip of strip.querySelectorAll("[data-lto-chip], .lto-chip")) {
          const r = R(chip);
          if (!shown(chip)) add("turn-strip", chip, "a chip is not shown");
          else if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1 || r.left < -1 || r.right > W + 1) add("turn-strip", chip, `a chip is not whole inside the strip (chip ${Math.round(r.left)}..${Math.round(r.right)}, strip ${Math.round(sr.left)}..${Math.round(sr.right)}, window ${W})`);
        }
      }

      // ---- text a player has to read, on a very big screen
      if (W >= 3840) {
        const zoomOf = (n) => {
          let z = 1;
          for (let p = n; p && p.nodeType === 1; p = p.parentElement) z *= Number.parseFloat(getComputedStyle(p).zoom) || 1;
          return z;
        };
        const seen = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const p = t.parentElement;
          if (!p || !t.textContent.trim() || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(p.tagName) || seen.has(p) || !shown(p)) continue;
          seen.add(p);
          const size = Number.parseFloat(getComputedStyle(p).fontSize) * zoomOf(p);
          if (size < 13.99) add("text-size", p, `renders at ${px(size)} CSS px (needs 14)`);
        }
        for (const n of document.querySelectorAll("input:not([type=hidden]), textarea, select")) {
          if (!shown(n)) continue;
          const size = Number.parseFloat(getComputedStyle(n).fontSize) * zoomOf(n);
          if (size < 13.99) add("text-size", n, `renders at ${px(size)} CSS px (needs 14)`);
        }
        // Pixel text (a canvas with data-text): the font pixel is the thinnest run of ink in the bitmap, and its capitals are 7 font pixels tall.
        for (const c of document.querySelectorAll("canvas[data-text]")) {
          if (!shown(c) || !c.width || !c.height) continue;
          const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          let thin = Infinity;
          for (let x = 0; x < c.width; x += 1) {
            let run = 0;
            for (let y = 0; y <= c.height; y += 1) {
              if (y < c.height && d[(y * c.width + x) * 4 + 3] > 0) run += 1;
              else {
                if (run > 0 && run < thin) thin = run;
                run = 0;
              }
            }
          }
          if (!Number.isFinite(thin)) continue;
          const cap = (7 * thin) / (c.width / Math.max(1, R(c).width));
          const key = !!c.closest(".lto-chip-k");
          const need = key ? 10 : 14;
          if (cap < need - 0.01) add("text-size", c, `pixel text is drawn ${px(cap)} CSS px high (needs ${need}${key ? ", a chip key" : ""})`);
        }
      }

      // ---- finger-sized targets
      if (touch) {
        const SEL = 'button, [role="button"], [role="tab"], [role="menuitem"], [data-action], [data-option], .lts-step, [data-lto-cancel], input:not([type="hidden"]), select, summary';
        for (const n of document.querySelectorAll(SEL)) {
          if (!shown(n) || n.parentElement?.closest(SEL)) continue;
          const r = R(n);
          if (r.height < 43.5) add("touch", n, `${Math.round(r.width)}x${Math.round(r.height)}: under 44 px high for a finger`);
        }
      }

      // ---- every control can be reached
      const CONTROL = 'button, [role="button"], [role="tab"], [role="menuitem"], input:not([type="hidden"]), select, textarea, [data-action], [data-option], summary';
      const clipBox = (n) => {
        let box = { l: 0, t: 0, r: W, b: H };
        let c = n;
        for (let p = n.parentElement; p && p !== docEl; p = p.parentElement) {
          const pos = getComputedStyle(c).position;
          if (pos === "fixed") break;
          const pcs = getComputedStyle(p);
          // An absolutely placed box is clipped only by the ancestors from its containing block (the nearest positioned one) outwards.
          const holds = pos !== "absolute" || pcs.position !== "static" || pcs.transform !== "none";
          if (holds && (pcs.overflowX !== "visible" || pcs.overflowY !== "visible")) {
            // client sizes are in the box's own CSS pixels; a zoomed box (the tray column at 3840 wide) is drawn bigger: scale them to the screen.
            const r = R(p);
            const sx = p.offsetWidth > 0 ? r.width / p.offsetWidth : 1;
            const sy = p.offsetHeight > 0 ? r.height / p.offsetHeight : 1;
            box = { l: Math.max(box.l, r.left + p.clientLeft * sx), t: Math.max(box.t, r.top + p.clientTop * sy), r: Math.min(box.r, r.left + (p.clientLeft + p.clientWidth) * sx), b: Math.min(box.b, r.top + (p.clientTop + p.clientHeight) * sy) };
          }
          if (holds) c = p;
        }
        return box;
      };
      const reach = (n) => {
        const r = R(n);
        const box = clipBox(n);
        if (r.left < box.l - 0.5 || r.top < box.t - 0.5 || r.right > box.r + 0.5 || r.bottom > box.b + 0.5) {
          return r.bottom > H + 0.5 || r.right > W + 0.5 || r.top < -0.5 || r.left < -0.5 ? "off the screen" : "cut off by the box that holds it";
        }
        if (footRect && !foot.contains(n) && r.bottom > footRect.top + 0.5 && r.top < footRect.bottom - 0.5) return "under the footer";
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!top) return "off the screen";
        if (top === n || n.contains(top)) return null;
        // Behind a modal layer on purpose: the game menu or the main menu laid over a screen, or the loading screen over the whole page, holds
        // the controls beneath it out of reach until it is closed (its own close button and tabs are checked like any other control).
        const MODAL = "[data-game-menu], [data-ltm-menu], [data-lto-story], [data-splash], .ltp";
        const modal = top.closest(MODAL);
        if (modal && !modal.contains(n)) return null;
        return `covered by ${describe(top)}`;
      };
      for (const n of document.querySelectorAll(CONTROL)) {
        if (!shown(n) || getComputedStyle(n).pointerEvents === "none") continue;
        if (!reach(n)) continue;
        // A control on another slide of a carousel (the hero choice) is reached by paging: bring its slide into view first. (scrollIntoView
        // alone would be undone by the scroll snap when the control is less than half a slide away.)
        const slide = n.closest('[aria-roledescription="slide"]');
        const strip = slide?.parentElement;
        if (strip) {
          const sx = strip.offsetWidth > 0 ? R(strip).width / strip.offsetWidth : 1;
          strip.scrollLeft += (R(slide).left - R(strip).left) / sx;
        }
        // "instant": a scroller with scroll-behavior: smooth would otherwise still be moving when the box is measured again.
        n.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        const why = reach(n);
        if (why) {
          const r = R(n);
          add("reach", n, `${why}, even after scrolling to it (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${W}x${H})`);
        }
      }

      for (const [n, top, left] of scrolled) {
        if (n.scrollTop !== top) n.scrollTop = top;
        if (n.scrollLeft !== left) n.scrollLeft = left;
      }
      return out;
    },
    { step, touch, inPlay: IN_PLAY },
  );
}

/** Whether the board canvas is painted (not blank), as a sanity check that a screen was really drawn. */
async function boardPainted(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.ltt-canvas");
    if (!c) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 64) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return seen.size > 8;
  });
}

/** The size of the board and of the room the stage gives it, to say the board fills its window (item 3). */
export async function boardFill(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.ltt-canvas")?.getBoundingClientRect();
    const s = document.querySelector(".lt-stage-wrap")?.getBoundingClientRect();
    if (!c || !s) return null;
    // Not counting the bands the game keeps clear on purpose for the DM box and the turn strip (the stage wrap's padding): the board does not resize each time the DM speaks.
    const sc = getComputedStyle(document.querySelector(".lt-stage-wrap"));
    const h = s.height - (parseFloat(sc.paddingTop) || 0) - (parseFloat(sc.paddingBottom) || 0);
    return { board: { w: c.width, h: c.height }, stage: { w: s.width, h }, ratio: Math.max(c.width / s.width, c.height / Math.max(1, h)) };
  });
}

/**
 * Run the tour. `opts`: { width, height, touch, shots (a directory, or null for no screenshots), items (the item assertions on or off), fit (also
 * run fitChecks at every step), mobile and dpr (mobile emulation with that pixel ratio) }.
 * Returns the problems it found as a list of "step: what" strings (an empty list is a clean tour).
 */
export async function tour(newGame, opts) {
  const found = [];
  const progress = { step: "start" };
  try {
    return await tourSteps(newGame, opts, found, progress);
  } catch (e) {
    // An item assertion is thrown as it was. Anything else (a control the tour could not reach, a screen that never came) ends the tour: keep
    // what the earlier steps found and say where it stopped, so a size where the game cannot be played on still reports the steps it did reach.
    if (e && e.name === "AssertionError") throw e;
    found.push(`${opts.width}x${opts.height} ${progress.step}: the tour stopped after this step: ${String(e?.message ?? e).split("\n")[0]}`);
    return found;
  }
}

async function tourSteps(newGame, opts, found, progress) {
  const { width, height, touch = false, shots = null, items = false, assert, fit = false, dpr = null, mobile = false } = opts;
  // A phone is a touch screen with a pixel ratio of 2 or 3 (isMobile also makes the page see a coarse pointer); a desktop is ratio 1.
  const device = { ...(touch ? { hasTouch: true } : {}), ...(mobile ? { isMobile: true } : {}), ...(dpr ? { deviceScaleFactor: dpr } : {}) };
  const size = `${width}x${height}`;
  const note = (step, list) => {
    for (const s of list) found.push(`${size} ${step}: ${s}`);
  };
  const server = { art: true };
  const shotDir = shots ? path.resolve(shots) : null;
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

  // ---- the loading screen: the platform answers slowly, so the splash is up long enough to look at
  {
    const slow = await newGame({ server, viewport: { width, height }, latencyMs: 2500, ...device });
    try {
      await slow.page.locator("[data-splash]").waitFor({ state: "visible", timeout: 5000 });
      note("splash", await fitProblems(slow.page, { touch }));
      if (fit) note("splash", await fitChecks(slow.page, { step: "splash", touch }));
      if (shotDir) await slow.page.screenshot({ path: path.join(shotDir, `bb-splash-${size}.png`) });
    } catch (e) {
      note("splash", [String(e.message).split("\n")[0]]);
    }
    await slow.close();
  }

  const g = await newGame({ server, script: tourScript(), extraInit: PIN_DICE, viewport: { width, height }, ...device });
  const d = g.driver;
  const page = g.page;
  const shot = async (step) => {
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `bb-${step}-${size}.png`) });
  };
  /** Check the page fits, and take the picture. */
  const check = async (step, o = {}) => {
    progress.step = step;
    if (process.env.LT_TRACE) console.log(`  [${size}] ${step}`);
    note(step, await fitProblems(page, { touch, ...o }));
    if (fit) note(step, await fitChecks(page, { step, touch }));
    await shot(step);
  };

  // ---- the main menu
  await d.ready();
  await page.locator('[data-ltm-menu="main"]').waitFor({ timeout: T });
  await page.locator("[data-splash]").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await check("main-menu");
  if (items) {
    assert.equal(await page.locator('[data-ltm-act="continue"]').isDisabled(), true, "a first visit has nothing to continue");
    for (const act of ["new", "load", "settings", "credits"]) assert.equal(await page.locator(`[data-ltm-act="${act}"]`).count(), 1, `the main menu has ${act}`);
  }
  await page.locator('[data-ltm-act="credits"]').click();
  await page.waitForTimeout(300);
  await check("credits");
  await page.keyboard.press("Escape");
  await page.locator('[data-ltm-act="settings"]').click();
  await page.locator("[data-game-menu]").waitFor({ timeout: T });
  await check("main-settings");
  await d.closeMenu();
  await page.locator('[data-ltm-act="load"]').click();
  await page.locator("[data-game-menu]").waitFor({ timeout: T });
  await check("main-load");
  await d.closeMenu();

  // ---- the adventure list, the hero choice, the character maker
  await d.toAdventureList();
  await page.waitForTimeout(300);
  await check("adventures");
  if (items) assert.ok((await page.locator("[data-lto-room]").count()) === 2, "the two test rooms show on a local page");
  await page.locator('[data-lto-adventure="rat-cellar"]').click();
  await page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: T });
  await page.waitForTimeout(300);
  await check("hero-choice");
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
  await check("hero-choice-last");
  await page.locator("[data-lto-create]").click();
  await page.locator('[data-lts="creation"]').waitFor({ timeout: T });
  await page.waitForTimeout(300);
  await check("maker-name");
  if (items) assert.equal(await page.locator('[data-lts-act="begin"]').isDisabled(), true, "the maker waits for a name");
  await page.locator('[data-lts-field="Name"]').fill("Mira");
  await page.locator('[data-lts-act="next"]').click();
  await page.waitForTimeout(300);
  await check("maker-class");
  // Back out to the hero choice and play the Knight.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if ((await page.locator('[data-lto-quick="fighter"]').count()) === 0) {
    await d.toAdventureList();
    await page.locator('[data-lto-adventure="rat-cellar"]').click();
    await page.locator('[data-lto-quick="fighter"]').waitFor({ timeout: T });
  }
  await d.playAs("fighter", "Mira");

  // ---- the story screen on arrival: it holds the world, and the normal DM box stays away
  await page.locator("[data-lto-story]:not([hidden])").waitFor({ timeout: T });
  await page.waitForTimeout(1200);
  await check("story", { story: true });
  if (items) {
    assert.equal(await page.locator("[data-lto-dialogue]").isVisible(), false, "the DM box is out of sight while the story is up");
    const before = await heroTile(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(400);
    assert.deepEqual(await heroTile(page), before, "the world is locked while the story is up");
    assert.equal(await page.locator("[data-lto-story]:not([hidden])").count(), 1, "keys do not read the story for the player");
  }
  await readStory(g);
  await d.dismissDialogue().catch(() => {});
  await page.waitForTimeout(400);
  await check("home");
  if (items) {
    const fill = await boardFill(page);
    assert.ok(fill && fill.ratio >= 0.8, `the board fills its window (${JSON.stringify(fill)})`);
    assert.ok(await boardPainted(page), "the board is painted");
  }

  // ---- left click walks only, right click opens the menu with its text line
  const start = await heroTile(page);
  await leftClickTile(page, start.x + 2, start.y + 1);
  await waitUntil(async () => {
    const h = await heroTile(page);
    return h.x !== start.x || h.y !== start.y;
  }, 8000, "the hero to walk on a left click");
  await d.settle(500, 15000);
  if (items) assert.equal(g.platform.calls.length, 0, "walking asks nothing of the DM");
  const me = await heroTile(page);
  await rightClickTile(page, me.x - 1 < 0 ? me.x + 1 : me.x - 1, me.y);
  const menu = await readMenu(page);
  await check("context-menu");
  if (items) {
    assert.ok(menuRow(menu, "ask"), `the actions menu ends in the text line (${menu.rows.map((r) => r.id).join(", ")})`);
    assert.doesNotMatch(menu.text, /Anyone can/, "no 'Anyone can'");
    assert.ok(menuRow(menu, "look"), "Look closer is on the menu");
  }

  // ---- a DM answer in the normal box: it never covers the hero
  const input = page.locator("input[data-lto-cm-input]");
  await input.fill("I look at the walls");
  await input.press("Enter");
  await g.platform.waitForCalls(1);
  const said = await d.waitDialogue((x) => /cobwebs/.test(x.text), 25000);
  if (items) assert.equal(said.speaker, "DM");
  await page.waitForTimeout(500);
  await check("dm-answer");
  if (items) assert.equal(await page.locator("[data-lto-toast], .lto-toast").count(), 0, "no pop-up strip");
  await d.dismissDialogue();

  // ---- a refusal is said by the DM box (nothing to use here)
  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  await check("refusal");
  if (items) assert.equal(await page.locator(".lto-toast, [data-lto-toast]").count(), 0, "a refusal is not a strip across the board");
  await d.dismissDialogue().catch(() => {});

  // ---- the game menu: six tabs
  await d.openMenu("character");
  if (items) assert.deepEqual((await d.menuTabs()).map((t) => t.id), ["character", "inventory", "journal", "log", "saves", "settings"], "one menu, six tabs");
  for (const tab of ["character", "inventory", "journal", "log", "saves", "settings"]) {
    await d.openMenu(tab);
    await page.waitForTimeout(250);
    await check(`menu-${tab}`);
  }
  if (items) {
    await d.openMenu("inventory");
    assert.ok((await page.locator("[data-game-menu] canvas").count()) > 0, "the inventory draws the paper doll");
    assert.equal(await page.locator("[data-game-menu]").getByText(/New character/i).count(), 0, "no New character in the game");
  }
  await d.setSetting("rollMyself", "true");

  // ---- on to the cellar (the roll is the player's: the tray is on show)
  const calls = await homeToCellar(g);
  if (items) assert.equal(calls, 2, "Tobin and Marta are two asks");
  await page.waitForTimeout(800);
  const tray = page.locator('[data-ltd-root][data-state="waiting"]');
  await tray.waitFor({ timeout: 20000 });
  await check("initiative-tray");
  await page.locator("[data-ltd-root]").click({ force: true });
  await page.waitForTimeout(1500);
  await check("fight-start");
  await d.setSetting("rollMyself", "false");
  await check("fight");

  // ---- the rats die and a body is searched and harvested: the hero swings on every turn (the dice are pinned high on the hero's turn and low
  // on a creature's, so the hero always hits and the rats always miss), and the turn is ended by hand when it is not over by itself. The
  // side panel is condensed on a phone, so only its title tells whose turn it is.
  const t0 = Date.now();
  for (let i = 0; i < 400 && Date.now() - t0 < 240000; i += 1) {
    const hud = await d.readout();
    if (!/Round \d/.test(hud) && i > 2) break;
    const mine = /your turn/.test(hud);
    await pin(page, mine ? 0.97 : 0.0);
    if (mine) {
      await page.keyboard.press("f");
      await page.waitForTimeout(900);
      if (/your turn/.test(await d.readout())) await page.keyboard.press("t");
    }
    await page.waitForTimeout(700);
  }
  await pin(page, 0.0);
  await waitUntil(async () => !/Round \d/.test(await d.readout()), 40000, "the fight to end");
  await d.dismissDialogue().catch(() => {});
  await d.settle(600, 8000);
  await check("fight-won");

  // A giant rat's body: the menu offers Search and Harvest. (The pelt is the engine's, so no DM call.)
  const here = await heroTile(page);
  let bodyAt = null;
  for (let r = 1; r <= 6 && !bodyAt; r += 1) {
    for (let dx = -r; dx <= r && !bodyAt; dx += 1) {
      for (let dy = -r; dy <= r && !bodyAt; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = here.x + dx;
        const y = here.y + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        try {
          await rightClickTile(page, x, y);
        } catch {
          await page.keyboard.press("Escape");
          continue;
        }
        const m = await readMenu(page);
        if (menuRow(m, "harvest")) bodyAt = { x, y, menu: m };
        else {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(80);
        }
      }
    }
  }
  if (!bodyAt) note("body", ["no creature body with a Harvest line was found near the hero"]);
  else {
    await check("body-menu");
    await page.keyboard.press("Escape");
    // A body lies where it fell: its square on the board is drawn (not bare floor).
    if (items) assert.ok(menuRow(bodyAt.menu, "loot"), "the body can be searched");
    await rightClickTile(page, bodyAt.x, bodyAt.y);
    await pin(page, 0.97);
    await clickRow(page, "harvest");
    await d.waitDialogue((x) => /pelt|nothing to take|spoil/i.test(x.text), 30000);
    await pin(page, null);
    await check("harvest");
    await d.dismissDialogue().catch(() => {});
    await d.settle(500, 10000);
    // Search the other giant rat: the loot window.
    const second = bodyAt;
    await rightClickTile(page, second.x, second.y).catch(() => {});
    await page.keyboard.press("Escape");
    await d.openMenu("inventory");
    await page.waitForTimeout(250);
    await check("inventory-after");
    if (items) assert.match(await d.hudText(), /pelt/i, "the pelt is in the pack");
    await d.closeMenu();
  }

  // ---- a question taken back: Cancel stands beside the DM's dots
  const cancel = page.locator("[data-lto-dialogue] [data-lto-cancel]");
  // The table must be free to be asked: no fight on, no box up. (A giant rat may have woken.)
  await d.dismissDialogue().catch(() => {});
  await waitUntil(async () => !/Round \d/.test(await d.readout()), 40000, "the table to be free");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await d.ask("I listen at the door");
      await cancel.waitFor({ state: "visible", timeout: 6000 });
      break;
    } catch (e) {
      if (attempt >= 2) {
        const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 240));
        throw new Error(`the held ask never showed Cancel (calls ${g.platform.calls.length}): ${String(e.message).split("\n")[0]} | page: ${seen}`);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  }
  await check("dm-waiting");
  if (items) assert.doesNotMatch(await d.text(), /(?<!Licence and )credit|\brefund|\bprice/i, "the waiting state states no price");
  const asked = g.platform.calls.length;
  await cancel.click();
  await page.waitForFunction(() => !document.querySelector("[data-lto-dialogue]:not([hidden]) [data-lto-cancel]"), null, { timeout: 4000 });
  if (items) assert.equal(g.platform.calls.length, asked, "Cancel makes no new call and the call made is still spent");
  g.platform.release();
  await page.waitForTimeout(500);

  // ---- full screen
  const full = page.locator(".lt-app-full");
  await full.click();
  try {
    await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5000 });
    await page.waitForTimeout(700);
    await check("fullscreen");
    if (items) {
      const fill = await boardFill(page);
      assert.ok(fill && fill.ratio >= 0.8, `full screen: the board fills the stage (${JSON.stringify(fill)})`);
    }
    await full.click();
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 5000 });
  } catch (e) {
    note("fullscreen", [String(e.message).split("\n")[0]]);
  }
  note("clean", g.problems().map((p) => `page problem: ${p}`));
  return found;
}
