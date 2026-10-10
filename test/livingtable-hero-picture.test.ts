/**
 * The hero pictures off the board (ui/heroPicture.ts): the hero choice, the maker's class cards and the character sheet draw the KayKit
 * cast figure when the cast is loaded and the hand-made art when it is not.
 *
 *  - the choosing: a cast with the hero's class picks the cast figure for THAT class (and dresses it in the sheet's gear); no cast picks the
 *    doll; a cast that lacks the class, or its idle clip, picks the doll. Checked on a stand-in cast and on the committed cast file;
 *  - the fitting: whole device pixels per art pixel, centred, one crop for every hero and every set of gear (every piece of gear of every
 *    hero lies inside it, which is checked on the committed file);
 *  - the live picture, under plain Node with a recording canvas: the doll first, the cast figure the moment its frames are in, the switch
 *    in place when the cast lands under an open screen, and the subscription to the art released when the picture is (or when its canvas
 *    leaves the page).
 *
 * Run: npx tsx --test test/livingtable-hero-picture.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { freshHero, PLAYABLE_HEROES } from "../src/games/livingtable/table/state";
import { adventureById, adventureHero, bindAdventures, unbindAdventures } from "../src/games/livingtable/table/adventureCatalog";
import { bindCatalog, unbindCatalog } from "../src/games/livingtable/table/catalog";
import { createGameHost } from "../src/games/livingtable/table/host/gameHost";
import { renderPlanFor } from "../src/games/livingtable/menu/equipment";
import { parseCastFile } from "../src/games/livingtable/table/host/gameArt";
import { heroPreview } from "../src/games/livingtable/table/ui/heroPreview";
import type { CharacterSheet } from "../src/games/livingtable/characters/creation";
import type { FigureSet } from "../src/games/livingtable/table/figures";
import type { CastClip, CastData, CastSizeMeta, CastStyle } from "../src/games/livingtable/table/ui/cast";
import {
  chooseHeroArt,
  choiceKey,
  createHeroPictures,
  cropToFrame,
  figureCrop,
  fitFigure,
  pictureSize,
  type HeroPicture,
  type HeroPictureArt,
  type HeroPictureRequest,
  type HeroPictures,
} from "../src/games/livingtable/table/ui/heroPicture";

// ---- a stand-in cast ---------------------------------------------------------------------------

const DIRS = ["down", "right", "up", "left"] as const;
const clip = (clipId: CastClip["clip"], dir: CastClip["dir"], size: string): CastClip => ({ size, clip: clipId, dir, count: 6, loop: true, fps: 6, data: "" });
const meta = (s: number): CastSizeMeta => ({ tokenW: s, tokenH: s * 1.5, canvasW: s * 2, canvasH: s * 2.25, anchorX: s, anchorY: s * 2.25 });

/** A style with these classes' bodies (by token id) at these sizes, and every piece of gear the real game would dress each of them in. */
function standInStyle(tokens: readonly string[], sizeList: readonly string[] = ["16", "32"], gearIds: readonly string[] = [], opts: { idle?: boolean } = {}): CastStyle {
  const clips = (["idle", "walk"] as const).flatMap((c) => DIRS.flatMap((d) => (c === "idle" && opts.idle === false ? [] : sizeList.map((s) => clip(c, d, s)))));
  const sizes = Object.fromEntries(sizeList.map((s) => [s, meta(Number(s))]));
  return {
    style: "bands",
    label: "Bands",
    description: "",
    characters: tokens.map((id) => ({ id, label: id, kind: "hero" as const, archetype: id.replace(/^token_/, ""), model: "m", standIn: false, notes: "", sizes, clips })),
    gear: gearIds.map((id) => ({ id, archetype: "x", role: id.split("_")[2] ?? "weapon", tier: "base", label: id, clips })),
    layerOrder: { down: ["boots", "crown", "outer", "weapon"], right: [], up: [], left: [] },
  };
}

const castOf = (style: CastStyle): { data: CastData; style: CastStyle } => ({ data: { palette: [[0, 0, 0]], cameraPitchDeg: 30, styles: [style] }, style });

const KNIGHT = freshHero("knight");
const ROGUE = freshHero("shadow");
const WIZARD = freshHero("fireball-person");
const gearIdsOf = (sheet: CharacterSheet): string[] => (renderPlanFor(sheet)?.layers ?? []).map((l) => l.spriteId);

// ---- the choosing ------------------------------------------------------------------------------

test("no cast on offer: the doll", () => {
  assert.deepEqual(chooseHeroArt(null, KNIGHT), { kind: "doll" });
  assert.deepEqual(chooseHeroArt(undefined, KNIGHT), { kind: "doll" });
});

test("a cast that has the class: the cast figure for THAT class, at the finest size, in the gear the sheet wears", () => {
  const all = ["token_knight", "token_shadow", "token_fireball_person"];
  const cast = castOf(standInStyle(all, ["16", "32"], [...gearIdsOf(KNIGHT), ...gearIdsOf(ROGUE), ...gearIdsOf(WIZARD)]));
  for (const [sheet, token] of [[KNIGHT, "token_knight"], [ROGUE, "token_shadow"], [WIZARD, "token_fireball_person"]] as const) {
    const choice = chooseHeroArt(cast, sheet);
    assert.equal(choice.kind, "cast", `${sheet.archetypeId} is drawn from the cast`);
    if (choice.kind !== "cast") continue;
    assert.equal(choice.set.entry.id, token, "the figure is the one the board uses for that class");
    assert.equal(choice.size, "32", "a portrait is drawn at the finest size");
    assert.deepEqual(
      choice.set.layers.map((l) => l.gear.id).sort(),
      gearIdsOf(sheet).sort(),
      "and wears what the sheet wears (the board's own worn layers)",
    );
  }
  assert.ok(gearIdsOf(KNIGHT).length > 0, "the stand-in check means something: the fresh Knight wears gear");
});

test("a cast that lacks the class: the doll, class by class", () => {
  const cast = castOf(standInStyle(["token_knight"], ["32"], gearIdsOf(KNIGHT)));
  assert.equal(chooseHeroArt(cast, KNIGHT).kind, "cast");
  assert.equal(chooseHeroArt(cast, ROGUE).kind, "doll", "the Rogue is not in this cast");
  assert.equal(chooseHeroArt(cast, WIZARD).kind, "doll", "nor is the Wizard");
});

test("a cast whose figure has no idle clip facing the viewer, or no size at all: the doll", () => {
  assert.equal(chooseHeroArt(castOf(standInStyle(["token_knight"], ["32"], [], { idle: false })), KNIGHT).kind, "doll");
  assert.equal(chooseHeroArt(castOf(standInStyle(["token_knight"], [], [])), KNIGHT).kind, "doll");
  assert.equal(chooseHeroArt(castOf({ ...standInStyle(["token_knight"]), characters: [] }), KNIGHT).kind, "doll");
});

test("the size is the finest the figure has an idle clip for", () => {
  const only16 = standInStyle(["token_knight"], ["16"]);
  assert.equal(pictureSize(only16.characters[0]!), "16");
  const both = standInStyle(["token_knight"], ["16", "32"]);
  assert.equal(pictureSize(both.characters[0]!), "32");
  const none = standInStyle(["token_knight"], ["32"], [], { idle: false });
  assert.equal(pictureSize(none.characters[0]!), null);
});

test("the choice key changes with the class, the gear, the size and the style, and not otherwise", () => {
  const style = standInStyle(["token_knight", "token_shadow"], ["32"], [...gearIdsOf(KNIGHT), ...gearIdsOf(ROGUE)]);
  const a = chooseHeroArt(castOf(style), KNIGHT);
  const again = chooseHeroArt(castOf(style), KNIGHT);
  assert.equal(choiceKey(a), choiceKey(again), "the same look is the same key");
  assert.notEqual(choiceKey(a), choiceKey(chooseHeroArt(castOf(style), ROGUE)), "another class is another key");
  assert.notEqual(choiceKey(a), choiceKey({ kind: "doll" }));
  const undressed = chooseHeroArt(castOf({ ...style, gear: [] }), KNIGHT);
  assert.notEqual(choiceKey(a), choiceKey(undressed), "other gear is another key");
  const other = chooseHeroArt(castOf({ ...style, style: "toon" }), KNIGHT);
  assert.notEqual(choiceKey(a), choiceKey(other), "another style is another key");
});

// ---- the committed cast file ------------------------------------------------------------------

const castFile = parseCastFile(JSON.parse(readFileSync(new URL("../asset-files/living-table-cast.json", import.meta.url), "utf8")));

test("the committed cast has every playable class in every style, and chooseHeroArt picks the cast figure for each, in its starting gear", () => {
  assert.ok(castFile, "the cast file parses");
  for (const style of castFile!.styles) {
    for (const id of PLAYABLE_HEROES) {
      const sheet = freshHero(id);
      const choice = chooseHeroArt({ style }, sheet);
      assert.equal(choice.kind, "cast", `${style.style}: ${id} has a cast figure`);
      if (choice.kind !== "cast") continue;
      assert.equal(choice.size, "32");
      assert.equal(choice.set.layers.length, gearIdsOf(sheet).filter((g) => style.gear.some((x) => x.id === g)).length, `${style.style}: ${id} is dressed in what the cast has of the sheet's gear`);
    }
  }
});

test("the portrait crop holds the body and every piece of every hero's gear, at every tier, in its idle animation facing the viewer", () => {
  for (const style of castFile!.styles.filter((s) => s.style === "bands")) {
    for (const hero of style.characters.filter((c) => c.kind === "hero")) {
      const pieces = [hero, ...style.gear.filter((g) => g.character === hero.id || g.id.startsWith(`gear_${hero.id.replace(/^token_/, "")}_`))];
      for (const size of Object.keys(hero.sizes)) {
        const m = hero.sizes[size]!;
        const crop = figureCrop(m);
        assert.ok(crop.x >= 0 && crop.x + crop.w <= m.canvasW, `${hero.id} ${size}: the crop is inside the frame across`);
        for (const piece of pieces) {
          const c = piece.clips.find((x) => x.size === size && x.clip === "idle" && x.dir === "down");
          if (!c) continue;
          const raw = inflateSync(Buffer.from(c.data, "base64"));
          for (let f = 0; f < c.count; f++) {
            for (let y = 0; y < m.canvasH; y++) {
              for (let x = 0; x < m.canvasW; x++) {
                if (raw[f * m.canvasW * m.canvasH + y * m.canvasW + x] === 255) continue;
                const inside = x >= crop.x && x < crop.x + crop.w && y >= crop.y && y < crop.y + crop.h;
                assert.ok(inside, `${hero.id} ${size} ${"id" in piece ? piece.id : ""} frame ${f}: pixel ${x},${y} is outside the crop ${JSON.stringify(crop)}`);
              }
            }
          }
        }
      }
    }
  }
});

test("the portrait crop is square and the same for every hero, whatever it wears, with the feet a little above its bottom", () => {
  const crops = castFile!.styles[0]!.characters.filter((c) => c.kind === "hero").map((c) => JSON.stringify(figureCrop(c.sizes["32"]!)));
  assert.equal(new Set(crops).size, 1, "one crop for every hero");
  const m32: CastSizeMeta = { tokenW: 32, tokenH: 48, canvasW: 64, canvasH: 72, anchorX: 32, anchorY: 72 };
  const c = figureCrop(m32);
  assert.deepEqual(c, { x: 4, y: 20, w: 56, h: 56 });
  assert.ok(c.y + c.h > m32.anchorY, "room under the feet");
  const small = figureCrop({ tokenW: 16, tokenH: 24, canvasW: 32, canvasH: 36, anchorX: 16, anchorY: 36 });
  assert.equal(small.w, small.h, "square at the board's size too");
  assert.deepEqual(small, { x: 2, y: 10, w: 28, h: 28 });
});

test("cropToFrame: the part of the crop that is inside the frame, and where it starts", () => {
  const m32: CastSizeMeta = { tokenW: 32, tokenH: 48, canvasW: 64, canvasH: 72, anchorX: 32, anchorY: 72 };
  assert.deepEqual(cropToFrame(figureCrop(m32), 64, 72), { sx: 4, sy: 20, sw: 56, sh: 52, ox: 0, oy: 0 }, "cut off at the frame's foot, the margin below it left empty");
  assert.deepEqual(cropToFrame({ x: -3, y: -2, w: 10, h: 10 }, 64, 72), { sx: 0, sy: 0, sw: 7, sh: 8, ox: 3, oy: 2 }, "and at the top and left, with where the picture starts in the crop");
  assert.deepEqual(cropToFrame({ x: 100, y: 0, w: 5, h: 5 }, 64, 72).sw, 0, "a crop wholly outside has nothing");
});

// ---- the fitting -------------------------------------------------------------------------------

test("fitFigure: whole device pixels per art pixel, centred", () => {
  const f = fitFigure(384, 384, { w: 52, h: 52 });
  assert.equal(Number.isInteger(f.k), true, "a whole scale keeps every art pixel the same size");
  assert.equal(f.k, Math.floor(384 / 52));
  assert.equal(f.w, 52 * f.k);
  assert.ok(Math.abs(f.x * 2 + f.w - 384) <= 1 && Math.abs(f.y * 2 + f.h - 384) <= 1, "centred");
  assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= 384 && f.y + f.h <= 384, "inside the box");
  assert.equal(fitFigure(208, 208, { w: 52, h: 52 }).k, 4, "the 1280 px hero box at one device pixel per css pixel");
  assert.equal(fitFigure(56, 56, { w: 52, h: 52 }).k, 1, "a class card box at one device pixel per css pixel");
  assert.equal(fitFigure(112, 112, { w: 52, h: 52 }).k, 2, "the same box on a double density screen");
});

test("fitFigure: a box smaller than the figure scales it down to fit instead of cutting it off; a wide box is limited by its height", () => {
  const small = fitFigure(30, 30, { w: 52, h: 52 });
  assert.ok(small.k < 1 && small.w <= 30 && small.h <= 30);
  const wide = fitFigure(900, 200, { w: 52, h: 52 });
  assert.equal(wide.k, Math.floor(200 / 52));
  assert.ok(wide.x > 0, "centred across the spare width");
  assert.doesNotThrow(() => fitFigure(0, 0, { w: 52, h: 52 }));
});

// ---- the live pictures, with a recording canvas ------------------------------------------------

interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  isConnected: boolean;
  rect: { width: number; height: number };
  calls: unknown[][];
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  getBoundingClientRect(): { width: number; height: number };
  getContext(kind: string): Record<string, unknown>;
  /** What the canvas was last drawn with: "still" when the doll's canvas was copied, "cast" when frame canvases were. */
  lastDraw(): string | null;
}

function fakeCanvas(): FakeCanvas {
  const calls: unknown[][] = [];
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push([k, ...args])),
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
  const c: FakeCanvas = {
    width: 300,
    height: 150,
    style: {},
    dataset: {},
    attrs: {},
    isConnected: false,
    rect: { width: 128, height: 128 },
    calls,
    setAttribute: (k, v) => void (c.attrs[k] = v),
    removeAttribute: (k) => void delete c.attrs[k],
    // A canvas that is not on the page has no box (as in a browser).
    getBoundingClientRect: () => (c.isConnected ? c.rect : { width: 0, height: 0 }),
    getContext: () => ctx,
    lastDraw: () => {
      const draws = calls.filter((x) => x[0] === "drawImage");
      const last = draws[draws.length - 1];
      if (!last) return null;
      return last.length === 4 ? "still" : "cast";
    },
  };
  return c;
}

/** The art: a settable cast, and a count of who is listening. */
function fakeArt(initial: { data: CastData; style: CastStyle } | null = null): HeroPictureArt & { cast: () => typeof initial; set(next: typeof initial): void; listeners: Set<() => void>; fire(): void } {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    cast: () => current,
    onChange: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    set: (next) => void (current = next),
    listeners,
    fire: () => {
      for (const cb of [...listeners]) cb();
    },
  };
}

interface Rig {
  art: ReturnType<typeof fakeArt>;
  pictures: HeroPictures;
  canvases: FakeCanvas[];
  requests: FigureSet[];
  /** Frames are in: from now on `frames` hands back a stack of one canvas. */
  decode(): void;
  /** Run the frame loop once. */
  tick(ms?: number): void;
  pending(): number;
  clock: { t: number };
}

function rig(initial: { data: CastData; style: CastStyle } | null, opts: { reducedMotion?: boolean } = {}): Rig {
  const art = fakeArt(initial);
  const canvases: FakeCanvas[] = [];
  const requests: FigureSet[] = [];
  const clock = { t: 1000 };
  let decoded = false;
  const queue: Array<() => void> = [];
  const stack = [fakeCanvas() as unknown as HTMLCanvasElement];
  const pictures = createHeroPictures({
    art,
    ...(opts.reducedMotion ? { reducedMotion: true } : {}),
    now: () => clock.t,
    schedule: (cb) => {
      queue.push(cb);
      return () => void queue.splice(queue.indexOf(cb), 1);
    },
    makeCanvas: () => {
      const c = fakeCanvas();
      canvases.push(c);
      return c as unknown as HTMLCanvasElement;
    },
    pixelRatio: () => 1,
    deps: {
      request: (set) => void requests.push(set),
      frames: () => (decoded ? stack : null),
    },
  });
  return {
    art,
    pictures,
    canvases,
    requests,
    decode: () => void (decoded = true),
    tick: (ms = 16) => {
      clock.t += ms;
      for (const cb of queue.splice(0)) cb();
    },
    pending: () => queue.length,
    clock,
  };
}

const stillOf = (): HTMLCanvasElement => {
  const c = fakeCanvas();
  c.width = 128;
  c.height = 128;
  return c as unknown as HTMLCanvasElement;
};

const request = (sheet: CharacterSheet, still: HeroPictureRequest["still"] = () => stillOf()): HeroPictureRequest => ({ sheet, still });
const knightCast = (): { data: CastData; style: CastStyle } => castOf(standInStyle(["token_knight"], ["32"], gearIdsOf(KNIGHT)));
const asFake = (p: HeroPicture): FakeCanvas => p.canvas as unknown as FakeCanvas;

test("no cast: the picture is the doll, drawn at once, and it holds the art subscription only while it lives", () => {
  const r = rig(null);
  const p = r.pictures.picture(request(KNIGHT))!;
  assert.ok(p);
  assert.equal(p.art(), "doll");
  assert.equal(asFake(p).dataset.art, "doll", "data-art says so");
  assert.equal(asFake(p).lastDraw(), "still", "the stand-in is on the canvas before the screen shows it");
  assert.equal(r.art.listeners.size, 1, "listening for the cast");
  p.dispose();
  assert.equal(r.art.listeners.size, 0, "not once it is let go");
  assert.equal(r.pending(), 0, "and the animation loop stops");
  p.dispose();
});

test("a cast that is loaded and decoded: the cast figure, whole-pixel scaled and centred, once the canvas is on the page", () => {
  const r = rig(knightCast());
  r.decode();
  const p = r.pictures.picture(request(KNIGHT))!;
  asFake(p).isConnected = true;
  r.tick();
  assert.equal(p.art(), "cast");
  assert.equal(asFake(p).dataset.art, "cast");
  assert.equal(asFake(p).width, 128, "the canvas is its box in device pixels");
  assert.equal(asFake(p).height, 128);
  const draw = asFake(p).calls.filter((x) => x[0] === "drawImage").pop()!;
  const [, , sx, sy, sw, sh, dx, dy, dw, dh] = draw as number[];
  assert.deepEqual([sx, sy, sw, sh], [4, 20, 56, 52], "the figure's footprint is cut out of the frame (the margin under the feet is below it)");
  assert.equal(dw! % sw!, 0, "a whole number of device pixels per art pixel");
  assert.equal(dh! / sh!, dw! / sw!, "the same scale across and down");
  assert.ok(dx! >= 0 && dy! >= 0 && dx! + dw! <= 128 && dy! + dh! <= 128, "inside the box");
  p.dispose();
});

test("the picture has no doll for the frame before the figure is drawn when the frames are already decoded", () => {
  const r = rig(knightCast());
  r.decode();
  const p = r.pictures.picture(request(KNIGHT))!;
  assert.equal(asFake(p).lastDraw(), null, "nothing drawn yet: the canvas is not on the page, and the doll would only flash");
  p.dispose();
});

test("a cast that lands while the screen is open: the same canvas switches from the doll to the figure, and nothing else changes", () => {
  const r = rig(null);
  const p = r.pictures.picture(request(KNIGHT))!;
  const canvas = p.canvas;
  asFake(p).isConnected = true;
  r.tick();
  assert.equal(p.art(), "doll");
  const stillSize = [asFake(p).width, asFake(p).height];
  assert.deepEqual(stillSize, [128, 128], "the doll is drawn at its own size");
  r.art.set(knightCast());
  r.art.fire();
  assert.equal(r.requests.length, 1, "the figure's clips are asked for");
  assert.equal(r.requests[0]!.entry.id, "token_knight");
  r.tick();
  assert.equal(p.art(), "doll", "the doll stays until the frames are decoded: never a blank");
  r.decode();
  r.tick();
  assert.equal(p.art(), "cast");
  assert.equal(p.canvas, canvas, "in place: the very same element");
  assert.equal(asFake(p).dataset.art, "cast");
  p.dispose();
});

test("a cast without the hero's class never replaces the doll, even when it lands", () => {
  const r = rig(null);
  const p = r.pictures.picture(request(ROGUE))!;
  asFake(p).isConnected = true;
  r.art.set(knightCast());
  r.art.fire();
  r.decode();
  r.tick();
  assert.equal(p.art(), "doll");
  assert.equal(r.requests.length, 0, "nothing is decoded for a figure that is not used");
  p.dispose();
});

test("taking the cast away goes back to the doll", () => {
  const r = rig(knightCast());
  r.decode();
  const p = r.pictures.picture(request(KNIGHT))!;
  asFake(p).isConnected = true;
  r.tick();
  assert.equal(p.art(), "cast");
  r.art.set(null);
  r.art.fire();
  r.tick();
  assert.equal(p.art(), "doll");
  p.dispose();
});

test("the figure idles: a later frame of the loop is drawn again, and reduced motion keeps the first", () => {
  const moving = rig(knightCast());
  moving.decode();
  const a = moving.pictures.picture(request(KNIGHT))!;
  asFake(a).isConnected = true;
  moving.tick(0);
  const before = asFake(a).calls.filter((x) => x[0] === "drawImage").length;
  assert.ok(before > 0, "the first frame is drawn");
  moving.tick(250);
  assert.ok(asFake(a).calls.filter((x) => x[0] === "drawImage").length > before, "the next frame of the loop was drawn a quarter of a second later");
  a.dispose();
  const still = rig(knightCast(), { reducedMotion: true });
  still.decode();
  const b = still.pictures.picture(request(KNIGHT))!;
  asFake(b).isConnected = true;
  still.tick(0);
  const first = asFake(b).calls.filter((x) => x[0] === "drawImage").length;
  still.tick(2000);
  assert.equal(asFake(b).calls.filter((x) => x[0] === "drawImage").length, first, "no new frame under reduced motion");
  b.dispose();
});

test("a picture whose canvas has left the page is let go by itself, and the last one takes the art subscription with it", () => {
  const r = rig(null);
  const a = r.pictures.picture(request(KNIGHT))!;
  const b = r.pictures.picture(request(ROGUE))!;
  asFake(a).isConnected = true;
  asFake(b).isConnected = true;
  r.tick();
  assert.equal(r.art.listeners.size, 1, "one subscription however many pictures");
  asFake(a).isConnected = false; // its screen was redrawn or closed
  r.tick();
  assert.equal(r.art.listeners.size, 1, "the other is still on the page");
  asFake(b).isConnected = false;
  r.tick();
  assert.equal(r.art.listeners.size, 0, "unsubscribed");
  assert.equal(r.pending(), 0, "no loop left running");
});

test("a picture that never reaches the page is let go after a while, and one still on its way is not", () => {
  const r = rig(null);
  const p = r.pictures.picture(request(KNIGHT))!;
  r.tick(500);
  assert.equal(r.art.listeners.size, 1, "still on its way");
  r.tick(4000);
  assert.equal(r.art.listeners.size, 0, "never attached: released");
  void p;
});

test("disposing one of two pictures keeps the other; disposing the service ends everything and later pictures are refused", () => {
  const r = rig(null);
  const a = r.pictures.picture(request(KNIGHT))!;
  const b = r.pictures.picture(request(ROGUE))!;
  a.dispose();
  assert.equal(r.art.listeners.size, 1);
  b.dispose();
  assert.equal(r.art.listeners.size, 0);
  const c = r.pictures.picture(request(KNIGHT))!;
  assert.equal(r.art.listeners.size, 1, "a new picture subscribes again");
  r.pictures.dispose();
  assert.equal(r.art.listeners.size, 0);
  assert.equal(r.pictures.picture(request(KNIGHT)), null, "a window that is gone makes no more");
  void c;
});

test("neither a cast figure nor a still: no picture at all (the screen shows its words alone)", () => {
  const r = rig(null);
  assert.equal(r.pictures.picture(request(KNIGHT, () => null)), null);
  assert.equal(r.art.listeners.size, 0, "and nothing is left subscribed");
});

test("a sheet change (a gear preview) re-dresses the figure and redraws the doll, on the same canvas", () => {
  const worn = standInStyle(["token_knight"], ["32"], [...gearIdsOf(KNIGHT), "gear_knight_crown_legendary"]);
  const r = rig(castOf(worn));
  r.decode();
  const p = r.pictures.picture(request(KNIGHT))!;
  const canvas = p.canvas;
  asFake(p).isConnected = true;
  r.tick();
  const asked = r.requests.length;
  p.setSheet(KNIGHT);
  assert.equal(r.requests.length, asked, "the same look is not decoded again");
  const dressed = { ...KNIGHT, equipment: { ...KNIGHT.equipment, crown: { tier: "legendary" } } } as unknown as CharacterSheet;
  p.setSheet(dressed);
  assert.equal(p.canvas, canvas);
  // The doll, when there is no cast, is redrawn from the new sheet.
  const none = rig(null);
  const seen: string[] = [];
  const d = none.pictures.picture(request(KNIGHT, (s) => (seen.push(s === KNIGHT ? "plain" : "other"), stillOf())))!;
  d.setSheet(dressed);
  assert.deepEqual(seen, ["plain", "other"], "the still is asked for again with the new sheet");
  d.dispose();
  p.dispose();
});

test("a cast that cannot be read never breaks a picture", () => {
  const art = fakeArt(null);
  art.cast = () => {
    throw new Error("host broke");
  };
  const pictures = createHeroPictures({ art, now: () => 0, schedule: () => () => {}, makeCanvas: () => fakeCanvas() as unknown as HTMLCanvasElement, pixelRatio: () => 1, deps: { request: () => {}, frames: () => null } });
  const p = pictures.picture(request(KNIGHT));
  assert.equal(p?.art(), "doll");
  p?.dispose();
});

// ---- the hero choice's preview ----------------------------------------------------------------

function withDocument<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const before = g.document;
  g.document = { createElement: () => fakeCanvas() };
  try {
    return fn();
  } finally {
    g.document = before;
  }
}

test("heroPreview: with a picture service the slide's canvas is the live picture of the class in the adventure's own kit; without one it is the doll", async () => {
  // The game's own host, over the bundled art and a memory store: the same pieces the shipped game reads its adventures and art through.
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  const game = createGameHost({ art: { load: () => Promise.reject(new Error("offline")) }, storage: { store, remote: null, retryMs: 0 }, settings: { store }, whoami: async () => null });
  await game.open();
  const offs = [bindCatalog(game.art), bindAdventures(game.host), () => game.dispose()];
  try {
    const adventure = adventureById("rat-cellar")!;
    assert.ok(adventure, "the Rat Cellar is there");
    const asked: Array<{ sheet: CharacterSheet; chassis: string }> = [];
    const stub: HeroPictures = {
      picture: (req) => {
        asked.push({ sheet: req.sheet, chassis: req.sheet.chassis });
        return { canvas: fakeCanvas() as unknown as HTMLCanvasElement, art: () => "cast", setSheet: () => {}, dispose: () => {} };
      },
      dispose: () => {},
    };
    for (const [chassis, id] of [["fighter", "knight"], ["rogue", "shadow"], ["wizard", "fireball-person"]] as const) {
      const pv = heroPreview(adventure, chassis, stub);
      assert.ok(pv.picture, `${chassis} gets a live picture`);
      assert.equal(pv.canvas, pv.picture!.canvas, "the slide shows the picture's canvas");
      assert.equal(asked[asked.length - 1]!.sheet.archetypeId, id, "of the right class");
      assert.deepEqual(asked[asked.length - 1]!.sheet, adventureHero(adventure, id), "in the adventure's own starting kit, the sheet the quick start would play");
      assert.ok(pv.stats.length > 0, "and the default stats are still there");
    }
    // No service: the doll, drawn once.
    const plain = withDocument(() => heroPreview(adventure, "fighter"));
    assert.ok(plain.canvas, "the doll");
    assert.equal(plain.picture, undefined);
    // A service with nothing to draw: no canvas, the words alone (as when the art is missing).
    const empty = heroPreview(adventure, "fighter", { picture: () => null, dispose: () => {} });
    assert.equal(empty.canvas, null);
    assert.ok(empty.stats.length > 0);
  } finally {
    for (const off of offs) off();
    unbindAdventures();
    unbindCatalog();
  }
});
