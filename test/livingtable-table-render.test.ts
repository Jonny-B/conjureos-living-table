/**
 * The table window's rendering modules: figures.ts, stage.ts, fog.ts, tableStyle.ts.
 * They are tested under plain Node with a recording stand-in for the canvas, so
 * what is checked is the logic (what is drawn when, what is cached, what is
 * scoped), not the pixels. The pixels are checked in a browser, by the e2e harness.
 * Run: npx tsx --test test/livingtable-table-render.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { bindCatalog } from "../src/games/livingtable/table/catalog";
import { createMemoryHost, playableHeroIds } from "../src/games/livingtable/table/hostDefault";
import type { TableArt } from "../src/games/livingtable/table/host";
import {
  buildFigureSet,
  castEntry,
  clipRequests,
  drawSpriteFigure,
  pieceKeys,
  resolveCast,
  setFrames,
  spriteGeometry,
  starterLayers,
  tokenCanvas,
  type FigureSet,
} from "../src/games/livingtable/table/figures";
import { clearHeadroom, createFog, drawLootMarks, drawProneMark, portraitCanvas } from "../src/games/livingtable/table/fog";
import { animatedStyle, createPlayStage, creatureTimingFor, creatureTokensOf, equipmentSig, manifestId, sameItems, type StageItem } from "../src/games/livingtable/table/stage";
import { BOARD_CANVAS_CLASS, TABLE_ROOT_CLASS, TABLE_STYLE_ID, injectTableStyle, tableStyleCss } from "../src/games/livingtable/table/tableStyle";
import { ROOM_FLOOR, addCreature, newPlay } from "../src/games/livingtable/table/state";
import { slayCreature } from "../src/games/livingtable/table/fightRules";
import type { CastClip, CastData, CastStyle } from "../src/games/livingtable/table/ui/cast";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world/coordinates";
import { spriteSizeOf, type RenderManifest } from "../src/games/livingtable/render/canvasRenderer";

// Nothing may have reached for the page at import.
const NO_DOCUMENT_AT_IMPORT = typeof (globalThis as Record<string, unknown>).document === "undefined";

// ---- a recording canvas -----------------------------------------------------------

type Call = [string, ...unknown[]];

interface FakeCanvas {
  width: number;
  height: number;
  className: string;
  style: Record<string, string>;
  calls: Call[];
  ctx: Record<string, unknown>;
  getContext(kind: string): Record<string, unknown>;
}

function fakeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push([k, ...args])),
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
  const c: FakeCanvas = { width: 300, height: 150, className: "", style: {}, calls, ctx, getContext: () => ctx };
  return c;
}

function withDocument<T>(fn: (made: FakeCanvas[]) => T): T {
  const g = globalThis as Record<string, unknown>;
  const before = { document: g.document, ImageData: g.ImageData };
  const made: FakeCanvas[] = [];
  g.document = { createElement: (tag: string) => (tag === "canvas" ? (made[made.push(fakeCanvas()) - 1] as FakeCanvas) : { tag }) };
  g.ImageData = class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  };
  try {
    return fn(made);
  } finally {
    g.document = before.document;
    g.ImageData = before.ImageData;
  }
}

const count = (c: FakeCanvas, name: string): number => c.calls.filter((x) => x[0] === name).length;

// ---- a manifest and a cast ----------------------------------------------------------

function manifestWith(size: 16 | 32 = 16): RenderManifest {
  const px = (rows: number[][]) => ({ pixels: rows });
  return {
    palette: ["#101010", "#ff0000", "#00ff00"],
    tiles: {},
    props: {},
    tokens: { token_goblin: px([[-1, 1, -1], [1, 2, 1]]), token_knight: px([[1, 1], [2, 2]]) },
    spriteSize: size,
  };
}

const DIRS = ["down", "right", "up", "left"] as const;
const clip = (clipId: CastClip["clip"], dir: CastClip["dir"], size = "16"): CastClip => ({ size, clip: clipId, dir, count: 2, loop: true, fps: 8, data: "" });
const sizes = { "16": { tokenW: 16, tokenH: 16, canvasW: 24, canvasH: 24, anchorX: 12, anchorY: 20 } };

function fakeStyle(): CastStyle {
  const clips = (["idle", "walk"] as const).flatMap((c) => DIRS.map((d) => clip(c, d)));
  return {
    style: "bands",
    label: "Bands",
    description: "",
    characters: [
      { id: "token_knight", label: "Knight", kind: "hero", archetype: "knight", model: "m", standIn: false, notes: "", sizes, clips },
      { id: "token_goblin", label: "Goblin", kind: "monster", archetype: null, model: "m", standIn: false, notes: "", sizes, clips },
    ],
    gear: [
      { id: "gear_knight_helm", archetype: "knight", character: "token_knight", role: "crown", tier: "base", label: "Helm", clips },
      { id: "gear_knight_sword", archetype: "knight", character: "token_knight", role: "weapon", tier: "base", label: "Sword", clips },
      { id: "gear_other_cape", archetype: "other", role: "outer", tier: "base", label: "Cape", clips },
    ],
    layerOrder: { down: ["weapon", "crown"], right: ["crown", "weapon"], up: ["crown", "weapon"], left: ["crown", "weapon"] },
  };
}

// ---- tableStyle ---------------------------------------------------------------------

test("importing the rendering modules reaches for no page", () => {
  assert.equal(NO_DOCUMENT_AT_IMPORT, true);
});

test("tableStyle: every selector is scoped under the window's root class", () => {
  const css = tableStyleCss();
  const rules = [...css.replace(/@media[^{]*\{/g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]!.trim());
  assert.ok(rules.length > 15, "the stylesheet has its rules");
  for (const sel of rules) {
    for (const one of sel.split(",")) {
      assert.match(one.trim(), new RegExp(`^(:root[^ ]* )?\\.${TABLE_ROOT_CLASS}\\b`), `unscoped selector: ${one.trim()}`);
    }
  }
});

test("tableStyle: the board canvas has its own class; nothing of the bench's or the game's page is named", () => {
  const css = tableStyleCss();
  assert.equal(BOARD_CANVAS_CLASS, "ltt-canvas");
  assert.match(css, /\.ltt-root \.ltt-canvas\{/);
  assert.doesNotMatch(css, /\.lt-canvas\b/, "the game's styles.css owns .lt-canvas");
  assert.doesNotMatch(css, /\.lt-stage(?![-\w])/, "the game's styles.css owns .lt-stage");
  assert.doesNotMatch(css, /#bench-root/);
  assert.doesNotMatch(css, /asset-bench/);
  // The bench's own class names keep working.
  for (const cls of ["lt-arena", "lt-game", "lt-viewport", "lt-board", "lt-marks", "lt-shroud", "lt-reset", "lt-stage-wrap", "lt-tray-col"]) {
    assert.match(css, new RegExp(`\\.ltt-root \\.${cls}\\b`), cls);
  }
});

test("tableStyle: a page's --bn-* wins and the root's own --ltt-* fills the gap, in light and dark", () => {
  const css = tableStyleCss();
  const used = new Set([...css.matchAll(/var\(--bn-([a-z-]+),var\(--ltt-([a-z-]+)\)\)/g)].map((m) => `${m[1]}|${m[2]}`));
  assert.ok(used.size >= 5);
  for (const pair of used) assert.equal(pair.split("|")[0], pair.split("|")[1], "the fallback is the same token");
  assert.doesNotMatch(css.replace(/var\(--bn-[a-z-]+,var\(--ltt-[a-z-]+\)\)/g, ""), /var\(--bn-/, "no bare --bn- read without a fallback");
  // Not one --bn-* is DEFINED on the root (that would hide the bench's theme from the window).
  assert.doesNotMatch(css, /(^|[{;])\s*--bn-[a-z-]+:/);
  for (const pair of used) {
    const name = pair.split("|")[0]!;
    assert.equal([...css.matchAll(new RegExp(`--ltt-${name}:`, "g"))].length, 3, `--ltt-${name} is defined for light and for dark (media query and forced theme)`);
  }
  assert.match(css, /prefers-color-scheme:dark/);
  assert.match(css, /data-theme="dark"/);
});

test("tableStyle: no em or en dash", () => {
  const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  assert.doesNotMatch(tableStyleCss(), dashes);
});

test("injectTableStyle adds one style element however often it is called, and nothing without a document", () => {
  injectTableStyle(undefined);
  const added: { id: string; textContent: string }[] = [];
  const doc = {
    getElementById: (id: string) => added.find((e) => e.id === id) ?? null,
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild: (e: { id: string; textContent: string }) => void added.push(e) },
  } as unknown as Document;
  injectTableStyle(doc);
  injectTableStyle(doc);
  assert.equal(added.length, 1);
  assert.equal(added[0]!.id, TABLE_STYLE_ID);
  assert.equal(added[0]!.textContent, tableStyleCss());
});

// ---- figures ------------------------------------------------------------------------

test("figures: a set for a missing size is null; layers sort by the cast's draw order per facing", () => {
  const style = fakeStyle();
  const knight = castEntry(style, "token_knight")!;
  assert.equal(castEntry(style, "token_nobody"), null);
  assert.equal(buildFigureSet(style, knight, "32", []), null);
  const layers = [
    { gear: style.gear[0]!, remap: null },
    { gear: style.gear[1]!, remap: null },
  ];
  const set = buildFigureSet(style, knight, "16", layers)!;
  assert.deepEqual(set.byDir.down.map((l) => l.gear.role), ["weapon", "crown"]);
  assert.deepEqual(set.byDir.left.map((l) => l.gear.role), ["crown", "weapon"]);
  assert.equal(set.bodyOwner, "bands|token_knight");
});

test("figures: a clip's pieces are keyed body first, memoised, and empty when the body lacks the clip", () => {
  const style = fakeStyle();
  const set = buildFigureSet(style, castEntry(style, "token_knight")!, "16", [{ gear: style.gear[0]!, remap: null }])!;
  const keys = pieceKeys(set, "idle", "down");
  assert.equal(keys.length, 2);
  assert.equal(pieceKeys(set, "idle", "down"), keys, "the same array again");
  assert.deepEqual(pieceKeys(set, "death", "down"), []);
  assert.equal(setFrames(set, "idle", "down", 0), null, "nothing decoded yet");
  assert.equal(setFrames(set, "death", "down", 0), null);
});

test("figures: decode requests run facing by facing, body then worn pieces, and skip clips the body lacks", () => {
  const style = fakeStyle();
  const set = buildFigureSet(style, castEntry(style, "token_knight")!, "16", [{ gear: style.gear[0]!, remap: { 1: 2 } }])!;
  const reqs = clipRequests(set, ["idle", "attack"], ["left", "down"]);
  assert.equal(reqs.length, 4, "idle only, two facings, body and helm each");
  assert.deepEqual(reqs.map((r) => r.clip.dir), ["left", "left", "down", "down"]);
  assert.equal(reqs[0]!.ownerKey, "bands|token_knight");
  assert.equal(reqs[1]!.ownerKey, "bands|gear_knight_helm");
  assert.deepEqual(reqs[1]!.remap, { 1: 2 });
  assert.equal(reqs[0]!.remap, null);
});

test("figures: a hero's starter kit is its own base-tier gear, and a monster has none", () => {
  const style = fakeStyle();
  assert.deepEqual(starterLayers(style, castEntry(style, "token_knight")!).map((l) => l.gear.id), ["gear_knight_helm", "gear_knight_sword"]);
  assert.deepEqual(starterLayers(style, castEntry(style, "token_goblin")!), []);
});

test("figures: resolveCast shows nothing until something is decoded, then keeps what it last showed", () => {
  const style = fakeStyle();
  const set = buildFigureSet(style, castEntry(style, "token_knight")!, "16", [])!;
  const mem: { shown: { set: FigureSet; canvases: unknown[] } | null } = { shown: null };
  const want = clip("walk", "down");
  assert.equal(resolveCast(mem as never, set, want, 0), null);
  const frozen = { set, canvases: [{}] as unknown as HTMLCanvasElement[] };
  mem.shown = frozen;
  assert.equal(resolveCast(mem as never, set, want, 0), frozen, "the last complete frame holds");
  assert.equal(resolveCast(mem as never, null, want, 0), frozen);
});

test("figures: a token canvas is drawn from the manifest, cached by id and tint, and null for an unknown id", () => {
  withDocument((made) => {
    const m = manifestWith();
    const a = tokenCanvas(m, "token_goblin", null) as unknown as FakeCanvas;
    assert.equal(a.width, 3);
    assert.equal(a.height, 2);
    assert.equal(count(a, "fillRect"), 4, "one rect per opaque pixel");
    assert.equal(tokenCanvas(m, "token_goblin", null), a as unknown as HTMLCanvasElement, "cached");
    const tinted = tokenCanvas(m, "token_goblin", "rgba(214,48,48,0.55)") as unknown as FakeCanvas;
    assert.notEqual(tinted, a);
    assert.equal(tinted.ctx.globalCompositeOperation, "source-atop");
    assert.equal(tokenCanvas(m, "token_nobody", null), null);
    assert.equal(made.length, 2);
    // A different manifest does not share the cache.
    assert.notEqual(tokenCanvas(manifestWith(), "token_goblin", null), a as unknown as HTMLCanvasElement);
  });
});

test("figures: a hand-drawn figure stands on its feet, and lying down turns it about its middle", () => {
  withDocument(() => {
    const m = manifestWith(16);
    const stand = spriteGeometry(m, "token_knight", { dx: 0, dy: 0, lie: 0, fall: 1, tint: null }, 100, 200, 2)!;
    assert.equal(stand.w, 4);
    assert.equal(stand.h, 4);
    assert.equal(stand.tx, 100);
    assert.equal(stand.ty, 198);
    assert.deepEqual(stand.box, { x: 98, y: 196, w: 4, h: 4 });
    const lying = spriteGeometry(m, "token_knight", { dx: 0, dy: 0, lie: 1, fall: 1, tint: null }, 100, 200, 2)!;
    assert.ok(lying.box.w > lying.w, "the box holds it at any angle");
    assert.equal(spriteGeometry(m, "token_nobody", { dx: 0, dy: 0, lie: 0, fall: 1, tint: null }, 0, 0, 1), null);
    // At 32 px the same 16-pixel-wide standing size results from px16 alone.
    const big = spriteGeometry(manifestWith(32), "token_knight", { dx: 0, dy: 0, lie: 0, fall: 1, tint: null }, 0, 0, 2)!;
    assert.equal(big.w, 2, "a 32 px drawing draws half as large per source pixel");
    const ctx = fakeCanvas();
    assert.equal(drawSpriteFigure(ctx.ctx as unknown as CanvasRenderingContext2D, m, "token_knight", { dx: 0, dy: 0, lie: 0, fall: 1, tint: null }, 100, 200, 2), true);
    assert.equal(count(ctx, "drawImage"), 1);
    assert.equal(count(ctx, "rotate"), 0);
    assert.equal(drawSpriteFigure(ctx.ctx as unknown as CanvasRenderingContext2D, m, "token_nobody", { dx: 0, dy: 0, lie: 0, fall: 1, tint: null }, 0, 0, 1), false);
  });
});

// ---- stage helpers -------------------------------------------------------------------

test("stage: a manifest's number is stable per object and distinct between objects", () => {
  const a = manifestWith();
  const b = manifestWith();
  assert.equal(manifestId(a), manifestId(a));
  assert.notEqual(manifestId(a), manifestId(b));
});

test("stage: the animated style needs a cast for the hero's body, else the figures are static tokens", () => {
  const style = fakeStyle();
  assert.equal(animatedStyle({ archetypeId: "knight" }, style), style);
  assert.equal(animatedStyle({ archetypeId: "knight" }, null), null);
  const noKnight = { ...style, characters: style.characters.filter((c) => c.id !== "token_knight") };
  assert.equal(animatedStyle({ archetypeId: "knight" }, noKnight), null);
});

test("stage: a creature takes its cast entry's timings, or the shared hand-drawn ones", () => {
  const style = fakeStyle();
  assert.equal(creatureTimingFor("token_goblin", style), style.characters[1]);
  const shared = creatureTimingFor("token_skeleton", style);
  assert.equal(creatureTimingFor("token_goblin", null), shared);
  assert.ok(shared.clips.length > 0);
});

test("stage: sameItems compares positions and poses, not object identity", () => {
  const canv = {} as HTMLCanvasElement;
  const cast = (x: number): StageItem => ({ kind: "cast", canvases: [canv], x, y: 0, w: 4, h: 4 });
  const m = manifestWith();
  const sprite = (dx: number): StageItem => ({ kind: "sprite", manifest: m, assetId: "token_goblin", pose: { dx, dy: 0, lie: 0, fall: 1, tint: null }, feetX: 1, feetY: 1, px16: 1, box: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(sameItems([cast(1)], [cast(1)]), true);
  assert.equal(sameItems([cast(1)], [cast(2)]), false);
  assert.equal(sameItems([sprite(0)], [sprite(0)]), true);
  assert.equal(sameItems([sprite(0)], [sprite(1)]), false);
  assert.equal(sameItems([cast(1)], [sprite(0)]), false);
  assert.equal(sameItems([cast(1)], []), false);
});

// ---- fog ----------------------------------------------------------------------------

test("fog: a figure's headroom is cleared above it where the square above is not in plain view", () => {
  const size = 16;
  const states = new Uint8Array(CELL_WIDTH * CELL_HEIGHT).fill(0);
  const px = new Uint8ClampedArray(CELL_WIDTH * size * CELL_HEIGHT * size * 4).fill(255);
  clearHeadroom(px, states, { x: 3, y: 4 }, size);
  const alphaAt = (x: number, y: number): number => px[(y * CELL_WIDTH * size + x) * 4 + 3]!;
  // The row touching the figure is clearest, half a square up is mist again, and the sides are untouched.
  let clear = 0;
  for (let x = 3 * size; x < 4 * size; x++) if (alphaAt(x, 4 * size - 1) === 0) clear++;
  assert.ok(clear > 0, "some of the row against the figure is cleared");
  let far = 0;
  for (let x = 3 * size; x < 4 * size; x++) if (alphaAt(x, 4 * size - 8) === 0) far++;
  assert.ok(clear >= far, "clearer against the figure than half a square up");
  assert.equal(alphaAt(2 * size, 4 * size - 1), 255, "the next square along is untouched");
  assert.equal(alphaAt(3 * size, 4 * size - 9), 255, "above the band is untouched");

  // Nothing to clear on the top row, or where the square above is already in plain view.
  const top = new Uint8ClampedArray(px.length).fill(255);
  clearHeadroom(top, states, { x: 3, y: 0 }, size);
  assert.ok(top.every((v) => v === 255));
  const seen = new Uint8Array(states).fill(2);
  const none = new Uint8ClampedArray(px.length).fill(255);
  clearHeadroom(none, seen, { x: 3, y: 4 }, size);
  assert.ok(none.every((v) => v === 255));
});

function stateWithHero() {
  return newPlay("fantasy", playableHeroIds()[0]!, ROOM_FLOOR.fantasy);
}

function hostWithStableArt(over: Partial<TableArt> = {}) {
  const host = createMemoryHost();
  // The memory host builds a new manifest on every render() call; the stage needs the same object until the art changes.
  const memo = new Map<string, RenderManifest>();
  const original = host.art.render;
  const render = (t: "fantasy" | "scifi"): RenderManifest => {
    const hit = memo.get(t);
    if (hit) return hit;
    const m = original(t);
    memo.set(t, m);
    return m;
  };
  host.art.render = render;
  Object.assign(host.art, over);
  bindCatalog(host.art);
  return host;
}

test("fog: loot marks show for a pile and an unsearched body the hero has seen, and not for ones it has not", () => {
  hostWithStableArt();
  const p = stateWithHero();
  const hero = p.heroAt;
  p.piles.push({ at: { x: hero.x, y: hero.y }, items: ["a rope"] });
  const c = fakeCanvas();
  drawLootMarks(c.ctx as unknown as CanvasRenderingContext2D, p, 32);
  assert.ok(count(c, "fillRect") > 20, "a sack is drawn pixel by pixel");
  // A pile with nothing in it, or one no one has seen, draws nothing.
  const empty = fakeCanvas();
  p.piles[0]!.items = [];
  drawLootMarks(empty.ctx as unknown as CanvasRenderingContext2D, p, 32);
  assert.equal(count(empty, "fillRect"), 0);
  p.piles[0]!.items = ["a rope"];
  p.piles[0]!.at = { x: CELL_WIDTH - 1, y: CELL_HEIGHT - 1 };
  const unseen = fakeCanvas();
  drawLootMarks(unseen.ctx as unknown as CanvasRenderingContext2D, p, 32);
  assert.equal(count(unseen, "fillRect"), 0);
});

test("fog: an unsearched body gets no glint (the body itself is drawn now, and the board hints at nothing), a pile keeps its sack", () => {
  hostWithStableArt();
  const p = stateWithHero();
  const c = addCreature(p, "token_goblin", { x: p.heroAt.x + 2, y: p.heroAt.y });
  slayCreature(p, c);
  assert.equal(p.bodies.length, 1);
  assert.equal(p.bodies[0]!.looted, false, "unsearched");
  const canvas = fakeCanvas();
  drawLootMarks(canvas.ctx as unknown as CanvasRenderingContext2D, p, 32);
  assert.equal(count(canvas, "fillRect"), 0, "nothing is drawn for a body");
});

test("fog: the prone tag is a box with the word PRONE at the foot of the square", () => {
  const c = fakeCanvas();
  drawProneMark(c.ctx as unknown as CanvasRenderingContext2D, { x: 2, y: 3 }, 32);
  assert.deepEqual(c.calls.filter((x) => x[0] === "fillText").map((x) => x[1]), ["PRONE"]);
  const [, x, y, w, h] = c.calls.find((k) => k[0] === "fillRect")! as Call;
  assert.equal(x, Math.round(2 * 32 + (32 - Math.round(32 * 0.86)) / 2));
  assert.equal(w, Math.round(32 * 0.86));
  assert.ok((y as number) + (h as number) <= 4 * 32, "inside its own square");
});

test("fog: a portrait is the hero's token scaled by a whole number, and null for an archetype the art lacks", () => {
  withDocument(() => {
    const m = manifestWith();
    const p = portraitCanvas(m, "knight") as unknown as FakeCanvas;
    assert.ok(p);
    assert.equal(p.className, "lt-item-icon");
    assert.equal(p.width % 2, 0, "whole-number scale of a 2 wide drawing");
    assert.equal(p.width / 2, p.height / 2, "square pixels");
    assert.equal(portraitCanvas({ ...m, tokens: {} }, "knight"), null);
  });
});

// ---- the stage, end to end on a recording canvas ---------------------------------------

interface Loop {
  step(): void;
  pending(): number;
  restore(): void;
}

function fakeLoop(): Loop {
  const g = globalThis as Record<string, unknown>;
  const before = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  let next = 1;
  const queue = new Map<number, () => void>();
  g.requestAnimationFrame = (cb: () => void) => {
    const id = next++;
    queue.set(id, cb);
    return id;
  };
  g.cancelAnimationFrame = (id: number) => void queue.delete(id);
  return {
    step: () => {
      const [id, cb] = [...queue][0] ?? [];
      if (id === undefined || !cb) throw new Error("no frame is waiting");
      queue.delete(id);
      cb();
    },
    pending: () => queue.size,
    restore: () => {
      g.requestAnimationFrame = before.raf;
      g.cancelAnimationFrame = before.caf;
    },
  };
}

function viewport() {
  return { clientWidth: 400, clientHeight: 300, scrollLeft: 0, scrollTop: 0 } as unknown as HTMLElement;
}

test("stage: a frame sizes the board to the zoom, paints once, and paints again only when something changed", () => {
  const loop = fakeLoop();
  try {
    withDocument((made) => {
      const host = hostWithStableArt();
      const p = stateWithHero();
      addCreature(p, "token_goblin", { x: p.heroAt.x + 3, y: p.heroAt.y });
      let zoom = 2;
      const canvas = fakeCanvas();
      const seen: { before: number; after: number; tiles: number } = { before: 0, after: 0, tiles: -1 };
      const stage = createPlayStage({
        viewport: viewport(),
        canvas: canvas as unknown as HTMLCanvasElement,
        state: () => p,
        art: host.art,
        reducedMotion: false,
        zoom: () => zoom,
        beforeFrame: () => void seen.before++,
        afterFrame: (_now, tiles) => {
          seen.after++;
          seen.tiles = tiles.length;
        },
      });
      assert.equal(loop.pending(), 1, "the loop is waiting for its first frame");
      loop.step();
      assert.equal(canvas.width, CELL_WIDTH * 2 * 16);
      assert.equal(canvas.height, CELL_HEIGHT * 2 * 16);
      assert.equal(seen.before, 1);
      assert.equal(seen.after, 1);
      assert.ok(count(canvas, "drawImage") >= 1, "the room bitmap went onto the canvas");
      assert.equal(made.length, 1, "one offscreen canvas holds the room");
      const painted = count(canvas, "drawImage");
      const roomDraws = made[0]!.calls.length;

      loop.step();
      assert.equal(count(canvas, "drawImage"), painted, "nothing changed: nothing painted");
      assert.equal(made[0]!.calls.length, roomDraws, "and the room was not rebuilt");
      assert.equal(seen.before, 2, "the clock and input still ran");

      // With no figure on show there is nothing to restore, so invalidate has nothing to repaint; a new zoom repaints it all.
      stage.invalidate();
      loop.step();
      assert.equal(count(canvas, "drawImage"), painted);
      zoom = 3;
      loop.step();
      assert.equal(canvas.width, CELL_WIDTH * 3 * 16);
      assert.equal(count(canvas, "drawImage"), painted + 1, "a new zoom resizes the board and repaints it all");

      p.worldRev += 1;
      loop.step();
      assert.ok(made[0]!.calls.length > roomDraws, "a changed world rebuilds the room");

      stage.dispose();
      assert.equal(loop.pending(), 0, "no frame is left waiting after dispose");
    });
  } finally {
    loop.restore();
  }
});

test("stage: the fog rides the stage, sizes its canvas to the art and the CSS box to the board, and sleeps when nothing changed", () => {
  const loop = fakeLoop();
  try {
    withDocument(() => {
      const host = hostWithStableArt();
      const p = stateWithHero();
      const canvas = fakeCanvas();
      const shroud = fakeCanvas();
      const fog = createFog({ shroud: shroud as unknown as HTMLCanvasElement, canvas: canvas as unknown as HTMLCanvasElement, state: () => p, art: host.art, reducedMotion: true });
      const stage = createPlayStage({
        viewport: viewport(),
        canvas: canvas as unknown as HTMLCanvasElement,
        state: () => p,
        art: host.art,
        reducedMotion: true,
        zoom: () => 1,
        afterFrame: (now, tiles) => fog.frame(now, tiles),
      });
      loop.step();
      assert.equal(shroud.width, CELL_WIDTH * 16);
      assert.equal(shroud.height, CELL_HEIGHT * 16);
      assert.equal(shroud.style.width, `${canvas.width}px`);
      assert.equal(shroud.style.height, `${canvas.height}px`);
      assert.equal(count(shroud, "putImageData"), 1);
      loop.step();
      assert.equal(count(shroud, "putImageData"), 1, "an unchanged scene is not redrawn (reduced motion: no drift either)");
      // The hero moves: the visible set changes and the fog is redrawn.
      p.heroAt = { x: p.heroAt.x + 1, y: p.heroAt.y };
      loop.step();
      assert.equal(count(shroud, "putImageData"), 2);
      // A new scene starts the fog afresh.
      p.boardEpoch += 1;
      loop.step();
      assert.equal(count(shroud, "putImageData"), 3);
      stage.dispose();
    });
  } finally {
    loop.restore();
  }
});

test("stage: with a cast the figures are asked for, never drawn half-decoded", () => {
  const loop = fakeLoop();
  try {
    withDocument(() => {
      const style = fakeStyle();
      const data: CastData = { palette: [[0, 0, 0]], cameraPitchDeg: 30, styles: [style] };
      const host = hostWithStableArt({ cast: () => ({ data, style }) });
      const p = newPlay("fantasy", "knight", ROOM_FLOOR.fantasy);
      const canvas = fakeCanvas();
      const stage = createPlayStage({ viewport: viewport(), canvas: canvas as unknown as HTMLCanvasElement, state: () => p, art: host.art, reducedMotion: false, zoom: () => 1 });
      loop.step();
      assert.equal(canvas.width, CELL_WIDTH * 16);
      // Nothing is decoded in a test, so the hero is not drawn (a half-built figure is never shown), and the loop carries on.
      assert.equal(loop.pending(), 1);
      stage.dispose();
      assert.equal(loop.pending(), 0);
    });
  } finally {
    loop.restore();
  }
});

/** A host whose art draws the goblin (the stage draws a fallen creature from its token), and has no animated cast: the hand-drawn figures. */
function hostThatDrawsGoblins() {
  const base = createMemoryHost().art.render("fantasy");
  const withGoblin: RenderManifest = { ...base, tokens: { ...base.tokens, token_goblin: { pixels: [[-1, 1, -1], [1, 2, 1]] } } };
  return hostWithStableArt({ render: () => withGoblin });
}

test("stage: with the hand-drawn figures (no cast) a slain creature is drawn lying where it fell, under the living, and not on the hero's square", () => {
  const loop = fakeLoop();
  try {
    withDocument(() => {
      const host = hostThatDrawsGoblins();
      assert.equal(host.art.cast(), null, "no cast: the hand-drawn art");
      const p = stateWithHero();
      const rat = addCreature(p, "token_goblin", { x: p.heroAt.x + 3, y: p.heroAt.y });
      const other = addCreature(p, "token_goblin", { x: p.heroAt.x + 3, y: p.heroAt.y + 2 });
      const canvas = fakeCanvas();
      const stage = createPlayStage({ viewport: viewport(), canvas: canvas as unknown as HTMLCanvasElement, state: () => p, art: host.art, reducedMotion: true, zoom: () => 1 });
      loop.step();
      const lying = (): number => count(canvas, "rotate");
      assert.equal(lying(), 0, "nobody has fallen yet");

      slayCreature(p, rat);
      assert.equal(p.bodies.length, 1);
      loop.step();
      assert.equal(lying(), 1, "the body is drawn lying down");
      const move = canvas.calls.filter((c) => c[0] === "translate").at(-1)!;
      const body = p.bodies[0]!.at;
      assert.ok((move[1] as number) >= body.x * 16 && (move[1] as number) <= (body.x + 1) * 16, "across the square it fell on");
      assert.ok((move[2] as number) >= body.y * 16 && (move[2] as number) <= (body.y + 1) * 16, "down the square it fell on");

      // Another creature standing on it hides it; the hero standing on it hides it too.
      const before = lying();
      other.at = { ...body };
      stage.invalidate();
      loop.step();
      assert.equal(lying(), before, "a living creature on the square is drawn instead of the body");
      other.at = { x: body.x, y: body.y + 2 };
      p.heroAt = { ...body };
      stage.invalidate();
      loop.step();
      assert.equal(lying(), before, "the hero on the square is drawn instead of the body");
      p.heroAt = { x: body.x - 2, y: body.y };
      stage.invalidate();
      loop.step();
      assert.equal(lying(), before + 1, "stepping off shows the body again");
      stage.dispose();
    });
  } finally {
    loop.restore();
  }
});

test("a body never joins the engine's layout (it would block a step): the scene layout holds the hero and the living only", async () => {
  const { sceneLayout } = await import("../src/games/livingtable/table/adventureRun");
  hostThatDrawsGoblins();
  const p = stateWithHero();
  const rat = addCreature(p, "token_goblin", { x: p.heroAt.x + 3, y: p.heroAt.y });
  slayCreature(p, rat);
  assert.equal(p.bodies.length, 1);
  for (const forDisplay of [false, true]) {
    const tokens = sceneLayout(p, false, forDisplay).tokens;
    assert.ok(tokens.length <= 1 + p.creatures.length, "the hero and the creatures still standing, no more");
    if (!forDisplay) assert.equal(tokens.length, 1 + p.creatures.length);
    assert.ok(!tokens.some((t) => t.x === p.bodies[0]!.at.x && t.y === p.bodies[0]!.at.y));
  }
  assert.equal(sceneLayout(p, true).tokens.length, 0);
});

test("stage: creatureTokensOf lists each kind once, sorted; equipmentSig changes with the worn gear", () => {
  hostWithStableArt();
  const p = stateWithHero();
  addCreature(p, "token_skeleton", { x: 1, y: 1 });
  addCreature(p, "token_goblin", { x: 2, y: 2 });
  addCreature(p, "token_goblin", { x: 3, y: 3 });
  assert.deepEqual(creatureTokensOf(p), ["token_goblin", "token_skeleton"]);
  const before = equipmentSig(p.hero);
  const next = { ...p.hero, equipment: { ...(p.hero.equipment ?? {}), weapon: { tier: "magic" } } } as unknown as typeof p.hero;
  assert.notEqual(equipmentSig(next), before);
  assert.equal(equipmentSig(p.hero), before);
  assert.equal(spriteSizeOf(manifestWith(32)), 32);
});
