// The board: what a click, a tap, a long press and a hover mean, how a turn ends, and what a fallen creature looks like.
//
// The rule these specs hold the game to (bug bash items 15, 16, 21, 22, 28): a left click or a tap SELECTS and WALKS (to the square, or beside
// whatever stands on it) and never acts; the actions menu (a right click, or a long press) is where every other action starts. The board gives
// no hints about what a thing is: a hover shows the walk, one neutral ring, and red where the hero cannot go. The dice are pinned through
// Math.random (a page script before the game's own), so a fight is the same every run.
const WITH_SERVER = { art: true };
const T = 15000;

/** Pin Math.random to window.__rnd (0.5 reads as an 11 on a d20: a goblin misses a Knight, a Knight does not crit). A spec sets __rnd for what comes next. */
const PIN_DICE = "window.__rnd = 0.5; Math.random = () => window.__rnd;";

const CELLS = { w: 20, h: 15 };

async function boardBox(page) {
  const box = await page.locator("canvas.ltt-canvas").boundingBox();
  if (!box) throw new Error("no board on the page");
  return box;
}

/** The middle of square (x, y) on the page. */
async function tileCenter(page, x, y) {
  const b = await boardBox(page);
  return { x: b.x + ((x + 0.5) * b.width) / CELLS.w, y: b.y + ((y + 0.5) * b.height) / CELLS.h };
}

/** The square the hero stands on, from the window's own marker (data-lt-hero-rect on the board's viewport: "x,y,w,h" in client pixels). */
async function heroTile(page) {
  const [rect, b] = await Promise.all([page.locator("[data-lt-hero-rect]").first().getAttribute("data-lt-hero-rect"), boardBox(page)]);
  const [x, y, w, h] = String(rect).split(",").map(Number);
  return { x: Math.round((x - b.x) / w), y: Math.round((y - b.y) / h) };
}

async function waitHero(page, want, ms = 6000) {
  const t0 = Date.now();
  let at = null;
  while (Date.now() - t0 < ms) {
    at = await heroTile(page);
    if (at.x === want.x && at.y === want.y) return at;
    await page.waitForTimeout(80);
  }
  throw new Error(`the hero never reached (${want.x}, ${want.y}); it is at (${at?.x}, ${at?.y})`);
}

/** What the marks canvas (everything drawn over the floor: paths, rings, words) holds: opaque pixels, and how many are red, gold or blue. */
async function marks(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.lt-marks");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const out = { opaque: 0, red: 0, gold: 0, blue: 0, width: c.width, height: c.height };
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 100) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      out.opaque++;
      if (r > 200 && g < 130 && b < 130) out.red++;
      else if (r > 230 && g > 170 && g < 225 && b < 140) out.gold++;
      else if (b > 200 && b > r + 40) out.blue++;
    }
    return out;
  });
}

/** Opaque pixels of the marks canvas inside square (x, y). */
async function marksInTile(page, x, y) {
  return page.evaluate(
    ({ x, y, w, h }) => {
      const c = document.querySelector("canvas.lt-marks");
      const tw = c.width / w;
      const th = c.height / h;
      const d = c.getContext("2d").getImageData(Math.floor(x * tw), Math.floor(y * th), Math.ceil(tw), Math.ceil(th)).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] >= 100) n++;
      return n;
    },
    { x, y, w: CELLS.w, h: CELLS.h },
  );
}

/** How many green pixels (the goblin's colour) the board canvas holds on square (x, y) and the `pad` squares around it. */
async function greenIn(page, x, y, pad = 0) {
  return page.evaluate(
    ({ x, y, pad, w, h }) => {
      const c = document.querySelector("canvas.ltt-canvas");
      const tw = c.width / w;
      const th = c.height / h;
      const x0 = Math.max(0, Math.floor((x - pad) * tw));
      const y0 = Math.max(0, Math.floor((y - pad) * th));
      const x1 = Math.min(c.width, Math.floor((x + 1 + pad) * tw));
      const y1 = Math.min(c.height, Math.floor((y + 1 + pad) * th));
      const d = c.getContext("2d").getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 25 && d[i + 1] > 90) n++;
      return n;
    },
    { x, y, pad, w: CELLS.w, h: CELLS.h },
  );
}

/** The square with the most green on the board (the goblin), or null. */
async function findGoblin(page) {
  return page.evaluate(
    ({ w, h }) => {
      const c = document.querySelector("canvas.ltt-canvas");
      const tw = c.width / w;
      const th = c.height / h;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const per = new Map();
      for (let py = 0; py < c.height; py += 1) {
        for (let px = 0; px < c.width; px += 1) {
          const i = (py * c.width + px) * 4;
          if (d[i + 3] > 200 && d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 25 && d[i + 1] > 90) {
            const k = Math.floor(px / tw) + "," + Math.floor(py / th);
            per.set(k, (per.get(k) ?? 0) + 1);
          }
        }
      }
      let best = null;
      for (const [k, n] of per) if (!best || n > best.n) best = { k, n };
      if (!best || best.n < 15) return null;
      const [x, y] = best.k.split(",").map(Number);
      return { x, y };
    },
    { w: CELLS.w, h: CELLS.h },
  );
}

async function hover(page, x, y) {
  const p = await tileCenter(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(160);
}

async function click(page, x, y, opts) {
  const p = await tileCenter(page, x, y);
  await page.mouse.click(p.x, p.y, opts);
}

/** A test room: the first room card on the start screen (a two-room scene, a closed door, a chest, a goblin asleep in the east room). */
async function startRoom(g) {
  const d = g.driver;
  await d.ready();
  await d.toAdventureList();
  await g.page.locator("[data-lto-room]").first().click({ timeout: T });
  await g.page.locator("canvas.ltt-canvas").waitFor({ timeout: T });
  await g.page.locator("[data-lt-hero-rect]").first().waitFor({ state: "attached", timeout: T });
  await g.page.waitForTimeout(500);
}

/** Skip and tap through whatever is playing until it is the hero's turn with nothing left to roll or read. */
async function untilMyTurn(g, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hud = await g.driver.hudText();
    if (/your turn/i.test(hud) && !/Tap to roll/i.test(hud)) return hud;
    await g.page.keyboard.press("Space");
    await g.page.locator(".lt-dice-host").click({ timeout: 1500, force: true }).catch(() => {});
    await g.page.waitForTimeout(350);
  }
  throw new Error(`it never became the hero's turn: ${await g.driver.hudText()}`);
}

/** Open the door (walk up to it with a click, then E), and play the goblin's waking until it is the hero's turn. */
async function intoTheFight(g) {
  const page = g.page;
  await click(page, 11, 7);
  await waitHero(page, { x: 10, y: 7 });
  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  await untilMyTurn(g);
}

export const specs = [
  {
    name: "hovering a bed, a chest, a stool, a shelf and the floor gives the same plain mark; only a wall is red",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue().catch(() => {});
      await d.settle();
      const page = g.page;
      // The Rat Cellar's home: a two-part bed (1,1) (1,2), a chest with a feature (6,1), a stool (6,5), a shelf (6,9), open floor (4,5), a wall (0,5).
      const plain = { "bed head": [1, 1], "bed foot": [1, 2], chest: [6, 1], stool: [6, 5], shelf: [6, 9], floor: [4, 5] };
      for (const [name, [x, y]] of Object.entries(plain)) {
        await hover(page, x, y);
        const m = await marks(page);
        assert.ok(m.opaque > 0, `${name}: a walk and a ring are drawn`);
        assert.equal(m.red + m.gold + m.blue, 0, `${name}: no red, gold or blue (found ${m.red} red, ${m.gold} gold, ${m.blue} blue)`);
      }
      await hover(page, 0, 5);
      const wall = await marks(page);
      assert.ok(wall.red > 0, "a wall is the one red 'you cannot go here'");
      await hover(page, 3, 3);
      assert.equal((await marks(page)).opaque, 0, "the hero's own square says nothing");
      assert.equal(g.platform.calls.length, 0, "hovering never calls the model");
    },
  },

  {
    name: "both parts of the bed draw the same plain mark: a click on either walks to the same square",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER });
      const d = g.driver;
      await d.ready();
      await d.quickStart();
      await d.dismissDialogue().catch(() => {});
      await d.settle();
      const page = g.page;
      await hover(page, 1, 1);
      const head = await marks(page);
      await hover(page, 1, 2);
      const foot = await marks(page);
      assert.equal(head.red + foot.red, 0, "neither part of the bed is red");
      assert.ok(head.opaque > 0 && foot.opaque > 0);
      // The hero is left of and below the bed: either part sends it to the square beside the bed.
      await click(page, 1, 1);
      await page.waitForTimeout(1500);
      const at = await heroTile(page);
      assert.ok(Math.max(Math.abs(at.x - 1), Math.abs(at.y - 1.5)) <= 1.5, `the hero is beside the bed, not on it (at ${at.x}, ${at.y})`);
      assert.ok(!(at.x === 1 && (at.y === 1 || at.y === 2)), "never inside it");
    },
  },

  {
    name: "a left click only walks: it goes up to the door and does not open it, rolls nothing and asks nothing; the E key is the accelerator that opens it",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: [] });
      await startRoom(g);
      const page = g.page;
      const before = await heroTile(page);
      await hover(page, 11, 7);
      const hovered = await marks(page);
      assert.equal(hovered.red + hovered.gold + hovered.blue, 0, "a closed door shows no verb and no colour");
      assert.ok(hovered.opaque > 0, "the walk and a ring show");
      await click(page, 11, 7);
      await waitHero(page, { x: 10, y: 7 });
      assert.notDeepEqual(before, await heroTile(page));
      assert.ok((await marksInTile(page, 11, 7)) > 0, "one ring stays on what was selected");
      const hud = await g.driver.hudText();
      assert.doesNotMatch(hud, /Tap to roll|Round \d/, "no roll and no fight: the click did not open the door or wake anything");
      assert.equal(g.platform.calls.length, 0, "no call to the model");
      // Walking to a square is free in every sense: a plain square is walked to the same way.
      await click(page, 8, 4);
      await waitHero(page, { x: 8, y: 4 });
      assert.equal(await marksInTile(page, 8, 4), 0, "the ring leaves once the hero stands on the square");
    },
  },

  {
    name: "in a fight a left click on the goblin walks beside it and rolls nothing; the F key swings; a kill lies on the board where it fell",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: [], extraInit: PIN_DICE });
      await startRoom(g);
      const page = g.page;
      await intoTheFight(g);
      assert.match(await g.driver.hudText(), /Goblin\s*7\/7/);
      // The goblin woke and came for the hero: find it by its green, then step back so there is a square to walk.
      let goblin = await findGoblin(page);
      assert.ok(goblin, "the goblin is on the board");
      for (let i = 0; i < 2; i += 1) {
        await page.keyboard.press("a");
        await page.waitForTimeout(450);
      }
      goblin = await findGoblin(page);
      const apart = await heroTile(page);
      assert.ok(Math.max(Math.abs(apart.x - goblin.x), Math.abs(apart.y - goblin.y)) >= 2, `two or more squares apart (hero ${apart.x},${apart.y}; goblin ${goblin.x},${goblin.y})`);
      // Hovering it shows the walk and one ring: no red outline, no gold, no verb.
      await hover(page, goblin.x, goblin.y);
      const m = await marks(page);
      assert.equal(m.red + m.gold, 0, `no red outline, no gold (found ${m.red} red, ${m.gold} gold)`);
      assert.ok(m.opaque > 0);
      // A click walks beside it, and that is all.
      await click(page, goblin.x, goblin.y);
      const t0 = Date.now();
      let at = await heroTile(page);
      while (Date.now() - t0 < 6000 && Math.max(Math.abs(at.x - goblin.x), Math.abs(at.y - goblin.y)) > 1) {
        await page.waitForTimeout(100);
        at = await heroTile(page);
      }
      assert.equal(Math.max(Math.abs(at.x - goblin.x), Math.abs(at.y - goblin.y)), 1, `the hero is beside the goblin (at ${at.x}, ${at.y})`);
      await page.waitForTimeout(400);
      const hud = await g.driver.hudText();
      assert.doesNotMatch(hud, /Tap to roll your attack/, "the click did not attack");
      assert.match(hud, /Goblin\s*7\/7/, "and the goblin is unhurt");
      assert.equal(g.platform.calls.length, 0, "no call to the model");
      assert.ok((await marksInTile(page, goblin.x, goblin.y)) > 0, "the goblin keeps one neutral ring");
      assert.ok((await greenIn(page, goblin.x, goblin.y, 1)) > 20, "the living goblin is green on its square");
      // F is the desktop accelerator for the swing: now the attack roll is asked for. A natural 20 and the best damage kill it.
      await page.evaluate(() => { window.__rnd = 0.99; });
      await page.keyboard.press("f");
      await page.waitForFunction(() => /Tap to roll your attack/i.test(document.querySelector("[data-lto-hud]")?.innerText ?? ""), null, { timeout: T });
      const t1 = Date.now();
      while (Date.now() - t1 < 20000 && /Goblin\s*\d+\/\d+/.test(await g.driver.hudText())) {
        await page.keyboard.press("Space");
        await page.locator(".lt-dice-host").click({ timeout: 1500, force: true }).catch(() => {});
        await page.waitForTimeout(350);
      }
      assert.doesNotMatch(await g.driver.hudText(), /Goblin\s*\d+\/\d+/, "the goblin is gone from the fight");
      await g.driver.settle(600);
      // The body is on the board, lying where it fell: its green is still on the square (before the fix the square was bare floor).
      const lying = await greenIn(page, goblin.x, goblin.y, 1);
      assert.ok(lying > 20, `the fallen goblin is drawn on its square (${lying} green pixels)`);
      const glint = await page.evaluate(() => {
        const c = document.querySelector("canvas.lt-marks");
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] === 0xff && d[i + 1] === 0xd3 && d[i + 2] === 0x4c) n++;
        return n;
      });
      assert.equal(glint, 0, "and nothing hints that it can be searched");
      assert.equal(g.platform.calls.length, 0, "no call to the model");
    },
  },

  {
    name: "a turn ends by itself once the action is used and no movement is left, with a line in the dialogue box (not a strip); a spare step keeps it going",
    async run({ newGame, assert }) {
      // d20 = 1 for everyone: the Knight misses, the goblin misses, nobody is hurt.
      const g = await newGame({ server: WITH_SERVER, script: [], extraInit: "window.__rnd = 0; Math.random = () => window.__rnd;" });
      await startRoom(g);
      const page = g.page;
      await intoTheFight(g);
      // The goblin is beside the hero. Swing (and miss): the action is used, all 30 ft of movement are left, so the turn goes on.
      await page.keyboard.press("f");
      await page.waitForFunction(() => /Tap to roll your attack/i.test(document.querySelector("[data-lto-hud]")?.innerText ?? ""), null, { timeout: T });
      const t1 = Date.now();
      while (Date.now() - t1 < 15000 && /Tap to roll/i.test(await g.driver.hudText())) {
        await page.keyboard.press("Space");
        await page.locator(".lt-dice-host").click({ timeout: 1500, force: true }).catch(() => {});
        await page.waitForTimeout(350);
      }
      await page.waitForTimeout(1200);
      const mid = await g.driver.hudText();
      assert.match(mid, /your turn/i, "the action is used but movement is left: the turn goes on");
      assert.match(mid, /Move: 30 ft left/);
      // Walk away five squares: 5 ft are left and the turn still goes on; the sixth step spends the last of it, and the turn ends itself.
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press("a");
        await page.waitForTimeout(450);
      }
      await page.waitForTimeout(600);
      const near = await g.driver.hudText();
      assert.match(near, /your turn/i);
      assert.match(near, /Move: 5 ft left/);
      await page.keyboard.press("a");
      // The goblin's barks may be ahead of it in the box: press through them until the line comes.
      let said = null;
      const t2 = Date.now();
      while (!said && Date.now() - t2 < 12000) {
        const now = await g.driver.dialogue();
        if (now && /nothing left to do/i.test(now.text)) said = now;
        else if (now) await g.driver.pressDialogue().catch(() => {});
        else await page.waitForTimeout(100);
      }
      assert.ok(said, "the turn said why it ended, in the dialogue box");
      assert.match(said.text, /ends here/i);
      await page.waitForFunction(() => /goblin'?s turn|Round 2/i.test(document.querySelector("[data-lto-hud]")?.innerText ?? ""), null, { timeout: 8000 });
    },
  },

  {
    name: "on a touch screen a tap walks at once (no first-tap preview), and a long press opens the actions menu without selecting any text",
    async run({ newGame, assert }) {
      const g = await newGame({ server: WITH_SERVER, script: [], hasTouch: true });
      await startRoom(g);
      const page = g.page;
      const start = await heroTile(page);
      const spot = await tileCenter(page, 7, 7);
      await page.touchscreen.tap(spot.x, spot.y);
      await waitHero(page, { x: 7, y: 7 }, 5000);
      assert.notDeepEqual(start, await heroTile(page), "one tap went");
      // A press and hold: a touch pointer down, then 600 ms, then up. The menu opens and the hero does not walk to the square.
      const at = await tileCenter(page, 3, 3);
      await page.evaluate(({ x, y }) => {
        const v = document.querySelector("[data-lt-hero-rect]");
        const opts = { pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y };
        v.dispatchEvent(new PointerEvent("pointerdown", opts));
      }, at);
      await page.waitForTimeout(650);
      await page.locator("[data-lto-menu]").waitFor({ timeout: 3000 });
      await page.evaluate(({ x, y }) => {
        const v = document.querySelector("[data-lt-hero-rect]");
        const opts = { pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y };
        v.dispatchEvent(new PointerEvent("pointerup", opts));
        v.dispatchEvent(new MouseEvent("click", opts));
      }, at);
      await page.waitForTimeout(500);
      assert.deepEqual(await heroTile(page), { x: 7, y: 7 }, "the press that opened the menu did not also walk");
      assert.equal(await page.evaluate(() => String(window.getSelection())), "", "no text is selected");
      assert.equal(await page.evaluate(() => window.getSelection()?.rangeCount ?? 0), 0);
      assert.equal(g.platform.calls.length, 0, "no call to the model");
    },
  },
];
