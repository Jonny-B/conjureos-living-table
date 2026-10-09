// Playing The Rat Cellar through the page, the way a player does: walking by clicking, the actions menu, the DM talks. Shared by the
// integration spec and the responsive walk. Nothing here reaches into the game; it reads the adventure file for where the doors are.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADVENTURE = path.resolve(HERE, "../../../adventures/rat-cellar.md");
export const COLS = 20;
export const ROWS = 15;
export const MENU = '[data-lto-menu][role="menu"]';
const T = 15000;

/** Pin Math.random to window.__pin while it is set (null: the real thing). A d20 reads floor(value * 20) + 1. */
export const PIN_DICE = "(() => { const real = Math.random.bind(Math); window.__pin = null; Math.random = () => (window.__pin === null ? real() : window.__pin); })();";
export const pin = (page, value) => page.evaluate((v) => { window.__pin = v; }, value);

/** Where things stand in the adventure file: { locationName: { grid: string[], legend: { char: "floor_x, prop y, exit z" } } }. */
let parsed = null;
export function adventureMaps() {
  if (parsed) return parsed;
  const text = fs.readFileSync(ADVENTURE, "utf8").replace(/\r\n/g, "\n");
  const out = {};
  for (const part of text.split(/^## Location: /m).slice(1)) {
    const name = part.split("\n")[0].trim();
    const grid = /### Map\n+```\n([\s\S]*?)\n```/.exec(part)?.[1].split("\n") ?? [];
    const legend = {};
    for (const m of part.matchAll(/^- `(.)` = (.*)$/gm)) legend[m[1]] = m[2];
    out[name] = { grid, legend };
  }
  parsed = out;
  return out;
}

/** The squares in a location that a legend entry matching `needle` is drawn on (an exit id, a spawn id, a feature id). */
export function squaresOf(location, needle) {
  const { grid, legend } = adventureMaps()[location];
  const chars = Object.entries(legend).filter(([, v]) => v.includes(needle)).map(([k]) => k);
  const out = [];
  grid.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (chars.includes(c)) out.push({ x, y });
    });
  });
  return out;
}

export async function boardBox(page) {
  const box = await page.locator("canvas.ltt-canvas").boundingBox();
  if (!box) throw new Error("no board on the page");
  return box;
}

export async function tilePoint(page, x, y) {
  const b = await boardBox(page);
  return { x: b.x + ((x + 0.5) * b.width) / COLS, y: b.y + ((y + 0.5) * b.height) / ROWS };
}

export async function leftClickTile(page, x, y) {
  const p = await tilePoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

export async function rightClickTile(page, x, y) {
  const p = await tilePoint(page, x, y);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.locator(MENU).waitFor({ timeout: T });
  // The menu ignores presses for a moment after it opens (a finger lifting after a long press).
  await page.waitForTimeout(350);
}

/** The square the hero stands on, from the mark the stage keeps on the viewport. */
export async function heroTile(page) {
  const [rect, b] = await Promise.all([page.locator("[data-lt-hero-rect]").first().getAttribute("data-lt-hero-rect"), boardBox(page)]);
  const [x, y, w, h] = String(rect).split(",").map(Number);
  return { x: Math.round((x - b.x) / w), y: Math.round((y - b.y) / h) };
}

export async function waitUntil(fn, ms = 12000, what = "the condition") {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** What the open actions menu shows. */
export async function readMenu(page) {
  return page.evaluate((sel) => {
    const m = document.querySelector(sel);
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return {
      title: m.getAttribute("aria-label") ?? "",
      text: m.innerText.replace(/\s+/g, " "),
      rows: [...m.querySelectorAll("[data-lto-menu-item]")].map((x) => ({ id: x.dataset.ltoMenuItem, label: x.getAttribute("aria-label") ?? "", enabled: x.dataset.enabled === "true", height: x.getBoundingClientRect().height })),
      box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    };
  }, MENU);
}

export const menuRow = (menu, id) => menu?.rows.find((r) => r.id === id);

export async function clickRow(page, id) {
  await page.locator(`${MENU} [data-lto-menu-item="${id}"]`).click({ timeout: T });
}

/** Press a story screen until it is gone (a click finishes a page, the next turns it, the last closes it). */
export async function readStory(g, max = 40) {
  for (let i = 0; i < max; i += 1) {
    if ((await g.page.locator("[data-lto-story]:not([hidden])").count()) === 0) return i;
    await g.page.locator("[data-lto-story]").click({ timeout: 3000 }).catch(() => {});
    await g.page.waitForTimeout(70);
  }
  throw new Error("the story would not close");
}

/** Walk the hero to a square by clicking it, and wait until it stands there. */
export async function walkTo(g, x, y, ms = 25000) {
  await leftClickTile(g.page, x, y);
  await waitUntil(async () => {
    const h = await heroTile(g.page);
    return h.x === x && h.y === y;
  }, ms, `the hero to reach (${x}, ${y})`);
}

/**
 * Click a square that leads out (an open exit): the hero walks to it and goes through. Waits for the new place's story screen. A click only
 * walks to a square the hero has seen, so `via` lists squares to walk to first, in order.
 */
export async function takeExit(g, x, y, via = []) {
  for (const v of via) await walkTo(g, v.x, v.y);
  await leftClickTile(g.page, x, y);
  await g.page.locator("[data-lto-story]:not([hidden])").waitFor({ timeout: 30000 });
}

/** The DM reply that has a person say a line and the story record the talk. */
export function talkReply(dmReply) {
  return (call) => {
    const said = call.messages.map((x) => x.content).join("\n");
    // The last "I talk to ..." is this ask (earlier ones are the exchanges the DM is reminded of).
    const who = [...said.matchAll(/I talk to ([A-Z][a-z]+ [A-Z][a-z]+|[A-Z][a-z]+)/g)].pop()?.[1];
    if (/Tobin Hale/.test(who ?? "")) return { ...dmReply({ narration: "Tobin looks up from his bench. Good morning, then. Mind the cellar." }), speaker: "Tobin Hale", talkedTo: "tobin" };
    if (/Marta/.test(who ?? "")) return { ...dmReply({ narration: "Marta wipes her hands. Five silver for every rat. The stairs are unbolted." }), speaker: "Marta Pell", talkedTo: "marta" };
    return dmReply();
  };
}

/**
 * From a started game at home (Rat Cellar, the Knight) to the cellar with the rats awake: Tobin, the front door, the square, the tavern, Marta,
 * the stairs. Each arrival's story screen is read through. Returns the AI calls it spent.
 */
export async function homeToCellar(g) {
  const d = g.driver;
  const before = g.platform.calls.length;
  // Into the workshop (a doorway in the wall between the rooms), then Tobin.
  const door = squaresOf("Your Home", "door_open_ns")[0];
  await walkTo(g, door.x, door.y);
  const tobin = squaresOf("Your Home", "tobin_at_work")[0];
  await rightClickTile(g.page, tobin.x, tobin.y);
  await clickRow(g.page, "talk");
  await g.platform.waitForCalls(before + 1);
  await d.waitDialogue((x) => /Mind the cellar/.test(x.text), 25000);
  await d.dismissDialogue();
  // Out of the front door.
  const front = squaresOf("Your Home", "exit to_village")[0];
  await takeExit(g, front.x, front.y);
  await readStory(g);
  const tavern = squaresOf("Wick End Square", "exit tavern_door")[0];
  // The dirt road runs south from the home door, east along row 9, then north to the tavern door.
  await takeExit(g, tavern.x, tavern.y, [{ x: 3, y: 9 }, { x: tavern.x, y: 9 }, { x: tavern.x, y: 4 }]);
  await readStory(g);
  // Marta behind the bar.
  const marta = squaresOf("The Copper Kettle", "marta_at_bar")[0];
  await rightClickTile(g.page, marta.x, marta.y);
  await clickRow(g.page, "talk");
  await g.platform.waitForCalls(before + 2);
  await d.waitDialogue((x) => /unbolted/.test(x.text), 25000);
  await d.dismissDialogue();
  // Down the cellar stairs.
  const stairs = squaresOf("The Copper Kettle", "exit cellar_stairs")[0];
  await takeExit(g, stairs.x, stairs.y);
  await readStory(g);
  return g.platform.calls.length - before;
}
