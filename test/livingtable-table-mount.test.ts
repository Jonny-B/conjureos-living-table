/**
 * The table window's wiring (src/games/livingtable/table/mountTable.ts) and the bench's side of it
 * (scripts/asset-bench/benchHost.ts), without a page. mountTable draws into the DOM, so what is checked here is what needs none:
 *
 *  - both modules load in Node (nothing touches the page at import: build-bench.mjs imports the registry in Node);
 *  - a TableSession reads its saves from the host's storage, once, and starts on the start screen;
 *  - the bench host is a whole TableHost over the bench's own art: its catalog is the sprite arrays', the AI adventure list and the
 *    saves go to the bench's own storage keys, and its dice come from the test hook when there is one;
 *  - the source keeps its promises: every document listener the window adds is removed again, every module binding is released by
 *    dispose(), the board canvas has the game's class, no singleton of the bench survives in the window, and no file names the
 *    bench folder or uses a dash character.
 *
 * Run: npx tsx --test test/livingtable-table-mount.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createMemoryHost } from "../src/games/livingtable/table/hostDefault";
import { createTableSession, mountTable } from "../src/games/livingtable/table/mountTable";
import { SAVES_SCOPE } from "../src/games/livingtable/table/snapshot";
import { PLAYABLE_HEROES } from "../src/games/livingtable/table/state";
import { artManifest, benchHost, benchSession, bindBenchDefaults, installBenchHooks, MANIFEST, SPRITES_BY_TEMPLATE } from "../scripts/asset-bench/benchHost";
import { adventureById, benchAdventures, unbindAdventures } from "../src/games/livingtable/table/adventureCatalog";
import { catalogBound, unbindCatalog } from "../src/games/livingtable/table/catalog";
import { SETTING_CHOICES } from "../src/games/livingtable/table/ui/overlay";
import { fightEnvBound, tableRng } from "../src/games/livingtable/table/fightRules";

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const MOUNT = "src/games/livingtable/table/mountTable.ts";
const BENCH_HOST = "scripts/asset-bench/benchHost.ts";
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

test("the window and the bench host load in Node, and mountTable needs a page only when it is called", () => {
  assert.equal(typeof mountTable, "function");
  assert.equal(typeof createTableSession, "function");
  assert.equal(typeof document, "undefined", "this test runs with no page");
  assert.throws(() => mountTable(null as unknown as HTMLElement, createMemoryHost()));
});

test("a session starts on the start screen with no scene, and reads the saves from the host's storage when it is made", () => {
  const host = createMemoryHost();
  const session = createTableSession(host);
  assert.equal(session.play, null);
  assert.equal(session.atStart, true);
  assert.equal(session.roomChoice, "one");
  assert.deepEqual(session.saves.list(), []);
  // Nothing is written until something is saved.
  assert.equal(host.store.size, 0);
  const again = createTableSession(host);
  assert.notEqual(again.log, session.log, "each session has its own log");
  assert.ok(SAVES_SCOPE.length > 0);
});

test("a session over a storage that throws still works (the saves are only for this visit)", () => {
  const host = createMemoryHost();
  host.storage.saves.read = () => {
    throw new Error("blocked");
  };
  const session = createTableSession(host);
  assert.deepEqual(session.saves.list(), []);
});

test("the bench host is a whole TableHost over the bench's own art", () => {
  for (const t of ["fantasy", "scifi"] as const) {
    const c = benchHost.art.catalog(t);
    assert.equal(c, benchHost.art.catalog(t), "the catalog is memoized");
    assert.deepEqual(c.ids.tiles, SPRITES_BY_TEMPLATE[t].filter((s) => s.kind === "tile").map((s) => s.assetId));
    assert.deepEqual(c.ids.props, SPRITES_BY_TEMPLATE[t].filter((s) => s.kind === "prop").map((s) => s.assetId));
    assert.deepEqual(c.ids.tokens, SPRITES_BY_TEMPLATE[t].filter((s) => s.kind === "token").map((s) => s.assetId));
  }
  // The render manifest is the same object until the art choice changes (the room bitmap is rebuilt when it does not stay put).
  assert.equal(benchHost.art.render("fantasy"), benchHost.art.render("fantasy"));
  assert.equal(artManifest("scifi"), MANIFEST.scifi);
  // With no page there is no KayKit library to wait for, and no cast.
  assert.equal(benchHost.art.ready(), true);
  assert.equal(benchHost.art.cast(), null);
  assert.equal(typeof benchHost.art.signature(), "string");
  const heard: string[] = [];
  const off = benchHost.art.onChange(() => heard.push("changed"));
  off();
  assert.deepEqual(heard, []);
  assert.deepEqual(benchHost.heroes.playable(), PLAYABLE_HEROES);
  assert.equal(benchHost.heroes.initial(), null);
  assert.equal(benchHost.env.sandboxRooms, true);
  assert.equal(benchHost.env.debugExport, true);
  assert.equal(benchHost.env.address(), "", "no address in Node");
  assert.ok(benchHost.adventures.files().some((f) => f.file === "rat-cellar.md"));
  assert.match(benchHost.dm.unavailable, /claude\.ai/);
  assert.match(benchHost.dm.writerUnavailable ?? "", /Nothing was sent/);
});

test("the bench host's settings are merged in and kept, the free dice skin is owned, and the dice follow the test hook", () => {
  const before = benchHost.settings.get();
  benchHost.settings.set({ zoom: 3, textStyle: "storybook" });
  assert.equal(benchHost.settings.get().zoom, 3);
  assert.equal(benchHost.settings.get().textStyle, "storybook");
  assert.equal(benchHost.settings.get().rollMyself, before.rollMyself, "what was not named is left alone");
  benchHost.settings.set({ zoom: before.zoom, textStyle: before.textStyle });
  assert.ok(benchHost.settings.ownedDiceSkins().includes("bone"));

  const g = globalThis as { __ltBenchRng?: unknown; __ltBenchSample?: unknown };
  g.__ltBenchRng = () => 0.25;
  assert.equal(benchHost.env.rng(), 0.25);
  g.__ltBenchRng = () => 7;
  const out = benchHost.env.rng();
  assert.ok(out >= 0 && out < 1, "a hook that answers out of range is ignored");
  delete g.__ltBenchRng;

  assert.equal(benchHost.dm.peek?.(), null);
  const sample = async () => ({ text: "x" });
  g.__ltBenchSample = sample;
  assert.equal(benchHost.dm.peek?.(), sample);
  delete g.__ltBenchSample;
});

test("the bench host keeps its saves and its AI adventures under the bench's own storage keys, and survives having no storage at all", async () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  try {
    benchHost.storage.saves.write("saves", "[]");
    assert.equal(store.get("livingtable-bench-saves-v1"), "[]");
    assert.equal(benchHost.storage.saves.read("saves"), "[]");
    benchHost.storage.aiAdventures.write(["# One", "# Two"]);
    assert.equal(store.get("livingtable-bench-ai-adventures-v1"), JSON.stringify([{ markdown: "# One" }, { markdown: "# Two" }]));
    assert.deepEqual(benchHost.storage.aiAdventures.read(), ["# One", "# Two"]);
    store.set("livingtable-bench-ai-adventures-v1", "not json");
    assert.deepEqual(benchHost.storage.aiAdventures.read(), [], "a corrupt entry reads as none");
  } finally {
    if (had === undefined) delete g.localStorage;
    else g.localStorage = had;
  }
  assert.equal(benchHost.storage.saves.read("saves"), null, "no storage reads as nothing saved");
  assert.doesNotThrow(() => benchHost.storage.aiAdventures.write(["# Three"]));
  // And with no page and no downloads capability, saving a file offers nothing and does not throw.
  assert.deepEqual(await benchHost.files.save("a.zip", new Uint8Array([1])), { via: "none" });
});

test("bindBenchDefaults brings the rules up with no window: the catalog, the adventures and the dice", () => {
  unbindCatalog();
  unbindAdventures();
  assert.equal(catalogBound(), false);
  bindBenchDefaults();
  assert.equal(catalogBound(), true);
  assert.equal(fightEnvBound(), true);
  const n = tableRng();
  assert.ok(n >= 0 && n < 1);
  assert.ok(benchAdventures().length >= 1);
  assert.equal(adventureById("rat-cellar")?.id, "rat-cellar");
});

test("the bench keeps one session across visits to the Play tab", () => {
  assert.equal(benchSession(), benchSession());
  assert.equal(benchSession().play, null, "nothing is played until a window mounts");
});

test("installBenchHooks puts the handles the play scripts read on globalThis, from the window's own debug()", () => {
  const play = { marker: "scene" };
  const adventure = { startScreen: () => {} };
  const sight = () => ({ levels: [] });
  const saved: string[] = [];
  installBenchHooks({ debug: () => ({ play: () => play, adventure, sight, save: (l: string) => void saved.push(l) }) } as never);
  const g = globalThis as unknown as { __ltBenchPlay(): unknown; __ltBenchAdventure: unknown; __ltBenchSave(l: string): void; __ltBenchSight: unknown };
  assert.equal(g.__ltBenchPlay(), play);
  assert.equal(g.__ltBenchAdventure, adventure);
  assert.equal(g.__ltBenchSight, sight);
  g.__ltBenchSave("here");
  assert.deepEqual(saved, ["here"]);
  for (const k of ["__ltBenchPlay", "__ltBenchAdventure", "__ltBenchSave", "__ltBenchSight"]) delete (globalThis as Record<string, unknown>)[k];
});

// ---- the source keeps its promises ----------------------------------------------------------------------------------------

test("every document and window listener the window adds is removed again by dispose()", () => {
  const src = read(MOUNT);
  const added = [...src.matchAll(/\b(document|window)\.addEventListener\("([a-z]+)"/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.ok(added.length >= 2, "the keyboard and the blur listeners are there");
  for (const a of added) {
    const [target, type] = a.split(".");
    assert.ok(new RegExp(`${target}\\.removeEventListener\\("${type}"`).test(src), `${a} is never removed`);
  }
  // dispose() is the one place they go, and it is safe twice.
  const dispose = /function dispose\(\): void \{([\s\S]*?)\n  \}\n/.exec(src)?.[1] ?? "";
  assert.match(dispose, /disposed/);
  assert.match(dispose, /removeEventListener\("keydown"/);
  assert.match(dispose, /removeEventListener\("blur"/);
  assert.match(dispose, /for \(const unbind of unbinds\) unbind\(\)/);
  assert.match(dispose, /stage\.dispose\(\)/);
  assert.match(dispose, /endPress\(\)/, "a long press waiting to fire is cancelled");
});

test("every module binding the window makes is a token it releases (a late dispose cannot unbind its successor)", () => {
  const src = read(MOUNT);
  const binds = [...src.matchAll(/\b(bind[A-Z][A-Za-z]+)\(/g)].map((m) => m[1]!);
  for (const b of new Set(binds)) assert.ok(/^(bindCatalog|bindAdventures|bindFightEnv|bindCastSource)$/.test(b), `unexpected binding ${b}`);
  assert.match(src, /const unbinds: Array<\(\) => void> = \[bindCatalog\(host\.art\), bindAdventures\(host\), bindFightEnv\(host\.env\)\]/);
  assert.match(src, /unbinds\.push\(bindCastSource\(/);
  assert.match(src, /unbinds\.push\(host\.art\.onChange\(artChanged\)\)/);
});

test("the window holds no state of the bench's: the singletons live in the session, the settings in the host, the page reads go through the host", () => {
  const src = read(MOUNT);
  // The module level of mountTable.ts has no mutable state: no `let` outside the function.
  const outside = src.slice(0, src.indexOf("export function mountTable("));
  assert.doesNotMatch(outside, /^let /m, "no module-level let");
  assert.doesNotMatch(src, /\bglobalThis\b/, "the page's globals are the host's to read");
  assert.doesNotMatch(src, /\blocalStorage\b|\bsessionStorage\b/);
  assert.doesNotMatch(src, /__ltBench|claude\.use|__conjureos/);
  assert.doesNotMatch(src, /\bmatchMedia\b/, "reduced motion comes from host.env");
  assert.doesNotMatch(src, /\blocation\./, "the address comes from host.env");
  assert.match(src, /BOARD_CANVAS_CLASS/);
  assert.doesNotMatch(src, /"lt-canvas"/, "the board canvas has the table's own class");
});

test("neither file names the bench folder or uses a dash character", () => {
  for (const f of [MOUNT, BENCH_HOST, "scripts/asset-bench/assets.ts"]) {
    const text = read(f);
    if (f.startsWith("src/")) assert.equal(text.includes("asset-bench"), false, `${f} names the bench folder`);
    assert.equal(DASHES.test(text), false, `${f} has an en or em dash`);
  }
});

// ---- the dialogue box and the window's own copy ---------------------------------------------------------------------------

const OVERLAY = "src/games/livingtable/table/ui/overlay.ts";

test("the window states no price, no number and no credits anywhere a player can read it", () => {
  const src = read(MOUNT);
  assert.doesNotMatch(src, /costNote|AI_ADVENTURE_COST_NOTE/, "the window shows no cost note");
  const note = /const AI_WRITER_NOTE = "([^"]*)"/.exec(src)?.[1] ?? "";
  assert.match(note, /few minutes/, "the writer's note says it is a long job");
  assert.doesNotMatch(note, /\d|credit|price|cost|usage|\$/i, "the writer's note names no number, price or credits");
  assert.match(src, /aiNote: AI_WRITER_NOTE/);
  // No string of the window's own speaks of credits or prices (the quoted text a player can read).
  const strings = [...src.matchAll(/"([^"\n]{3,})"|`([^`\n]{3,})`/g)].map((m) => m[1] ?? m[2] ?? "");
  for (const text of strings) assert.doesNotMatch(text, /\bcredits?\b|\bprice\b|\bcosts? \d|\d+ credits?/i, `"${text}" talks money`);
});

test("story text has one home: the window queues it in the dialogue box, and the Space key is the box's press first", () => {
  const src = read(MOUNT);
  assert.match(src, /overlay\.advanceStory\(\)/, "Space presses the dialogue box when one is up");
  assert.match(src, /overlay\.say\(line\)/, "story lines go to the box");
  assert.match(src, /overlay\.narrate\(/, "the DM's text goes to the box");
  assert.doesNotMatch(src, /locationHoldMs|dropPendingCards|sceneTimer/, "the cards no longer carry text or take turns");
  // A streaming reply that turns out to be a person speaking keeps its entry: it is renamed, not queued twice.
  assert.match(src, /current\.setSpeaker\(speaker\)/);
  const overlay = read(OVERLAY);
  for (const name of ["setTextSpeed", "advanceStory", "createDialogueQueue"]) assert.ok(overlay.includes(name), name);
  assert.doesNotMatch(overlay, /lto-narr-host|lto-dlg-scroll|stripOverflow|retireNarration/, "the second box and the scrolling strip are gone");
});

test("text speed is a game setting: the host type declares it, the window reads it, and the Settings tab's choices are all handled", () => {
  const host = read("src/games/livingtable/table/host.ts");
  assert.match(host, /export type TextSpeed = "slow" \| "normal" \| "fast" \| "instant"/);
  assert.match(host, /textSpeed: TextSpeed;/);
  const src = read(MOUNT);
  assert.match(src, /textSpeedOf\(host\.settings\.get\(\)\.textSpeed\)/, "an old saved setting with no speed reads as normal");
  assert.match(src, /reducedMotion \? "instant" : textSpeed/, "reduced motion prints at once");
  for (const g of SETTING_CHOICES) assert.match(src, new RegExp(`key === "${g.key}"`), `the window handles set:${g.key}`);
  assert.match(src, /id\.startsWith\("set:"\)/);
  assert.match(src, /settings: \{ textSpeed, textStyle, rollMyself, zoom: host\.settings\.get\(\)\.zoom \?\? null \}/, "the HUD is told the settings");
});

test("Space and Enter keep their own meaning on a focused control: summary, link, button and role=button are exempt from the board's keys", () => {
  const src = read(MOUNT);
  // The guard line in onKey: a focused control that Space or Enter activates is left alone (the board keeps Space on the board itself).
  const guard = /target\?\.closest\?\.\("([^"]*)"\) && \(key === " " \|\| key === "enter"\)/.exec(src);
  assert.ok(guard, "onKey has a guard that lets Space and Enter through to a focused control");
  const parts = guard[1].split(",").map((s) => s.trim());
  for (const sel of ["button", "summary", "a", '[role=button]']) assert.ok(parts.includes(sel), `Space on a focused "${sel}" is not swallowed`);
  // Typing fields and selects were already exempt and stay so.
  assert.match(src, /target\?\.closest\?\.\("input, textarea, \[contenteditable\]"\)\) return;/);
  assert.match(src, /target\?\.tagName === "SELECT" && !KEY_DIR\[key\]\) return;/);
  // The board's own Space (dialogue press, then skip) is still there, after the guard.
  assert.ok(src.indexOf("overlay.advanceStory()") > guard.index, "Space still presses the dialogue box and skips when nothing focused wants it");
});
