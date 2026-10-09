/**
 * The main menu, the start screen's cards and the splash, without a page (the markup itself is checked by scripts/e2e/specs/start.spec.mjs).
 *
 *  - the menu's buttons, its arrow-key walk, and the licence text it prints;
 *  - Continue: a game in front of the player (open, or left for the adventure list) goes back to it; else the newest save the host
 *    allows; else it is off. New game checkpoints a game in progress first and never writes one when there is none;
 *  - Load and Settings open the game menu on their tab; Escape on the main page continues only when there is a game;
 *  - the adventure cards: the hand written tag and the draft line are never drawn, and only an AI written card is tagged;
 *  - the splash waits out its minimum and no longer;
 *  - the files of this lane keep their promises: no dash characters, no developer words in the strings a player reads.
 *
 * Run: npx tsx --test test/livingtable-main-menu.test.ts
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createGameHost, resetFailedResumes } from "../src/games/livingtable/table/host/gameHost";
import type { KeyValueStore } from "../src/games/livingtable/table/host/gameStorage";
import type { TableSession } from "../src/games/livingtable/table/mountTable";
import { adventureById, adventureHero, bindAdventures, unbindAdventures } from "../src/games/livingtable/table/adventureCatalog";
import { bindCatalog, unbindCatalog } from "../src/games/livingtable/table/catalog";
import { newAdventurePlay } from "../src/games/livingtable/table/adventureRun";
import { NEW_GAME_CHECKPOINT, continueTarget, creditLines, installMainMenu, liveGame } from "../src/games/livingtable/table/flows/mainMenu";
import { mainMenuButtons, menuNavIndex, type MainMenuOptions } from "../src/games/livingtable/table/ui/mainMenu";
import { cardBadge, startCards } from "../src/games/livingtable/table/ui/screenHelpers";
import { SPLASH_MIN_MS, splashRemainingMs } from "../src/games/livingtable/Splash";
import { SRD_ATTRIBUTION } from "../src/games/livingtable/menu/labels";
import type { TableCtx } from "../src/games/livingtable/table/tableCtx";

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  unbindAdventures();
  unbindCatalog();
  resetFailedResumes();
});

function memStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

// ---- the buttons ---------------------------------------------------------------------------------------------------------------------

test("the menu has Continue, New game, Load, Settings and Licence and credits, in that order; Continue is off when there is nothing to go back to", () => {
  const on = mainMenuButtons({ canContinue: true, continueHint: "Back to your game" });
  assert.deepEqual(
    on.map((b) => b.id),
    ["continue", "new", "load", "settings", "credits"],
  );
  assert.deepEqual(
    on.map((b) => b.label),
    ["Continue", "New game", "Load", "Settings", "Licence and credits"],
  );
  assert.equal(on[0]!.disabled, false);
  assert.equal(on[0]!.hint, "Back to your game");
  const off = mainMenuButtons({ canContinue: false, continueHint: "ignored" });
  assert.equal(off[0]!.disabled, true);
  assert.notEqual(off[0]!.hint, "ignored", "an off Continue says why, not where it would have gone");
  assert.ok(off.slice(1).every((b) => !b.disabled), "the rest are always on");
});

test("the arrow keys walk the enabled buttons and wrap; Home and End go to the first and last; nothing enabled gives -1", () => {
  const en = [false, true, true, true, true];
  assert.equal(menuNavIndex(en, 1, "ArrowDown"), 2);
  assert.equal(menuNavIndex(en, 4, "ArrowDown"), 1, "wraps past the off Continue");
  assert.equal(menuNavIndex(en, 1, "ArrowUp"), 4);
  assert.equal(menuNavIndex(en, 3, "Home"), 1);
  assert.equal(menuNavIndex(en, 1, "End"), 4);
  assert.equal(menuNavIndex([false, false], 0, "ArrowDown"), -1);
  assert.equal(menuNavIndex([true], 0, "ArrowDown"), 0);
});

test("the credits page prints every part of the licence text, the licence as a link", () => {
  const lines = creditLines();
  assert.equal(lines.length, 5);
  assert.deepEqual(
    lines.map((l) => l.text),
    [SRD_ATTRIBUTION.creator, SRD_ATTRIBUTION.copyright, SRD_ATTRIBUTION.license, SRD_ATTRIBUTION.modified, SRD_ATTRIBUTION.disclaimer],
  );
  assert.equal(lines.filter((l) => l.href).length, 1);
  assert.equal(lines.find((l) => l.href)!.href, SRD_ATTRIBUTION.licenseUrl);
});

// ---- Continue ------------------------------------------------------------------------------------------------------------------------

const play = {} as never;

test("liveGame and continueTarget: a game in front of the player wins, then the newest save the host allows, then nothing", () => {
  const fresh = { play, atStart: true } as Pick<TableSession, "play" | "atStart" | "paused" | "continueId">;
  assert.equal(liveGame(fresh), false, "a fresh launch has a scene object but no game");
  assert.equal(liveGame({ play, atStart: false }), true, "the menu was opened from the game");
  assert.equal(liveGame({ play, atStart: true, paused: true }), true, "the game was left for the adventure list");
  assert.equal(liveGame({ play: null, atStart: false }), false);
  assert.deepEqual(continueTarget({ play, atStart: false }, "s1", () => true), { kind: "game" });
  assert.deepEqual(continueTarget({ play, atStart: true, paused: true }, "s1", () => true), { kind: "game" });
  assert.deepEqual(continueTarget(fresh, "s1", () => true), { kind: "save", id: "s1" }, "no continueId from the host: the newest save");
  assert.deepEqual(continueTarget({ ...fresh, continueId: "s2" }, "s1", () => true), { kind: "save", id: "s2" }, "the host's choice wins");
  assert.deepEqual(continueTarget({ ...fresh, continueId: null }, "s1", () => true), { kind: "none" }, "the host held the save back");
  assert.deepEqual(continueTarget(fresh, null, () => true), { kind: "none" });
  assert.deepEqual(continueTarget(fresh, "s1", () => false), { kind: "none" }, "a save that does not read is no save");
});

/** A window context with just what the menu's flow touches, over a real session and saves. */
async function rig(opts: { live?: boolean; paused?: boolean; withSave?: boolean; continueId?: string | null } = {}) {
  // The game's own host, over the bundled art and a memory store: the same pieces the shipped game reads a save with.
  const store = memStore();
  const game = createGameHost({ art: { load: () => Promise.reject(new Error("offline")) }, storage: { store, remote: null, retryMs: 0 }, settings: { store }, whoami: async () => null });
  const host = game.host;
  const session = await game.open();
  const offs = [bindCatalog(game.art), bindAdventures(host), () => game.dispose()];
  const rat = adventureById("rat-cellar")!;
  const made = () => newAdventurePlay(rat, adventureHero(rat, "knight" as never));
  const calls: string[] = [];
  let shown: MainMenuOptions | null = null;
  if (opts.withSave) session.saves.add(made(), "checkpoint", "an old save");
  session.play = made();
  session.atStart = !opts.live;
  if (opts.paused) session.paused = true;
  // The game host names no save when the book was empty at open; a host that says nothing at all is the default being tested here.
  if (opts.continueId !== undefined) session.continueId = opts.continueId;
  else delete session.continueId;
  const tc = {
    session,
    stageWrap: {} as HTMLElement,
    textStyle: "pixel",
    st: () => session.play!,
    addSavePoint: (p: never, kind: never, label: string) => {
      calls.push(`checkpoint:${label}`);
      session.saves.add(p, kind, label);
    },
    closeViews: () => calls.push("closeViews"),
    closeScreens: () => calls.push("closeScreens"),
    viewsChanged: () => calls.push("viewsChanged"),
    refreshAll: () => calls.push("refreshAll"),
    showStart: () => calls.push("showStart"),
    loadSave: (id: string) => calls.push(`loadSave:${id}`),
    openGameMenu: (tab: string) => calls.push(`gameMenu:${tab}`),
  } as unknown as TableCtx;
  installMainMenu(tc, {
    open: (_host, o) => {
      shown = o;
      return { node: {} as HTMLElement, page: () => "main", showCredits() {}, showMain() {}, close() {} };
    },
  });
  tc.openMainMenu();
  const done = (): void => offs.forEach((off) => off());
  cleanups.push(done);
  return { tc, session, calls, opts: () => shown!, done };
}

test("opening the menu from a game: Continue is on and goes back to that game without loading anything", async () => {
  const r = await rig({ live: true, withSave: true });
  try {
    assert.equal(r.opts().canContinue, true);
    assert.match(r.opts().continueHint, /your game/i);
    r.calls.length = 0;
    r.opts().onContinue();
    assert.ok(r.calls.includes("closeScreens"));
    assert.ok(!r.calls.some((c) => c.startsWith("loadSave")), "the game in front of the player is not reloaded from a save");
    assert.equal(r.session.atStart, false);
  } finally {
    r.done();
  }
});

test("a game left for the adventure list comes back with Continue (the list was an errand, not an exit)", async () => {
  const r = await rig({ live: false, paused: true });
  try {
    assert.equal(r.opts().canContinue, true);
    r.calls.length = 0;
    r.opts().onContinue();
    assert.equal(r.session.atStart, false, "back in the game");
    assert.equal(r.session.paused, false);
    assert.ok(r.calls.includes("refreshAll"));
  } finally {
    r.done();
  }
});

test("on a fresh launch with a save, Continue loads the newest save; with none it is off and does nothing", async () => {
  const withSave = await rig({ live: false, withSave: true });
  try {
    assert.equal(withSave.opts().canContinue, true);
    assert.match(withSave.opts().continueHint, /newest save/i);
    withSave.calls.length = 0;
    withSave.opts().onContinue();
    assert.deepEqual(withSave.calls.filter((c) => c.startsWith("loadSave")), [`loadSave:${withSave.session.saves.list()[0]!.id}`]);
  } finally {
    withSave.done();
  }
  const none = await rig({ live: false });
  try {
    assert.equal(none.opts().canContinue, false);
    none.calls.length = 0;
    none.opts().onContinue();
    assert.deepEqual(none.calls, [], "an off Continue does nothing");
  } finally {
    none.done();
  }
  const held = await rig({ live: false, withSave: true, continueId: null });
  try {
    assert.equal(held.opts().canContinue, false, "a host that holds its saves back (owner not known) keeps Continue off");
  } finally {
    held.done();
  }
});

test("New game with a game in progress writes a checkpoint of it BEFORE the adventure list opens", async () => {
  const r = await rig({ live: true });
  try {
    const before = r.session.saves.list().length;
    r.calls.length = 0;
    r.opts().onNew();
    const at = r.calls.indexOf(`checkpoint:${NEW_GAME_CHECKPOINT}`);
    assert.ok(at >= 0, "a checkpoint was written");
    assert.ok(r.calls.indexOf("showStart") > at, "and it came first");
    assert.equal(r.session.saves.list().length, before + 1);
    const newest = r.session.saves.list()[0]!;
    assert.equal(newest.kind, "manual", "a kind the automatic checkpoints (start of the adventure, arrived: X) can never push out");
    assert.equal(newest.label, NEW_GAME_CHECKPOINT);
    assert.ok(r.session.saves.find(newest.id), "it is a save the player can load");
  } finally {
    r.done();
  }
});

test("the game saved by New game survives the checkpoints the next adventure writes (start of it, then each arrival)", async () => {
  const r = await rig({ live: true });
  try {
    r.opts().onNew();
    const kept = r.session.saves.list().find((s) => s.label === NEW_GAME_CHECKPOINT)!;
    assert.ok(kept, "written");
    // The adventure the player picks next: its start, then three arrivals (SAVES_KEEP.checkpoint is 3).
    for (const label of ["start of the adventure", "arrived: a", "arrived: b", "arrived: c", "arrived: d"]) r.session.saves.add(r.session.play!, "checkpoint", label);
    assert.ok(r.session.saves.find(kept.id), "the old game is still in the Saves list");
  } finally {
    r.done();
  }
});

test("pressing New game again on the same unchanged game does not stack a second copy of it (it would flush the real saves)", async () => {
  const r = await rig({ live: true });
  try {
    for (let i = 0; i < 4; i++) {
      r.session.atStart = false; // back in the game (Continue), then New game again
      r.opts().onNew();
    }
    assert.equal(r.session.saves.list().filter((s) => s.label === NEW_GAME_CHECKPOINT).length, 1);
  } finally {
    r.done();
  }
});

test("New game with no game in progress writes no checkpoint (a fresh launch, or the list reached a second time)", async () => {
  for (const r of [await rig({ live: false }), await rig({ live: false, paused: true })]) {
    try {
      r.calls.length = 0;
      r.opts().onNew();
      assert.ok(!r.calls.some((c) => c.startsWith("checkpoint")), "nothing to save");
      assert.ok(r.calls.includes("showStart"));
      assert.equal(r.session.saves.list().length, 0);
    } finally {
      r.done();
    }
  }
});

test("Load and Settings open the game menu on their tab, over the main menu (it stays up)", async () => {
  const r = await rig({ live: true });
  try {
    r.calls.length = 0;
    r.opts().onLoad();
    r.opts().onSettings();
    assert.deepEqual(r.calls, ["gameMenu:saves", "gameMenu:settings"], "nothing closes the main menu, so Escape comes back to it");
  } finally {
    r.done();
  }
});

test("Escape on the main page goes back to the game when there is one, and does nothing when there is none", async () => {
  const live = await rig({ live: true });
  try {
    live.calls.length = 0;
    live.opts().onEscape!();
    assert.ok(live.calls.includes("closeScreens"));
    assert.equal(live.session.atStart, false);
  } finally {
    live.done();
  }
  const none = await rig({ live: false, withSave: true });
  try {
    none.calls.length = 0;
    none.opts().onEscape!();
    assert.deepEqual(none.calls, [], "a menu with no game behind it stays up (a save is a choice, not a default)");
  } finally {
    none.done();
  }
});

// ---- the cards -----------------------------------------------------------------------------------------------------------------------

test("cards: only an AI written adventure is tagged; the owner's own are not, and the draft count is never a line", () => {
  assert.equal(cardBadge("owner"), "");
  assert.equal(cardBadge("ai"), "AI written");
  const cards = startCards([
    { id: "a", title: "Mine", summary: "x", author: "owner", draftMarks: 30 },
    { id: "b", title: "Written", summary: "y", author: "ai", draftMarks: 4 },
  ]);
  assert.equal(cards[0]!.draftMarks, 30, "the data keeps the count for the author's checks");
  const src = read("src/games/livingtable/table/ui/startScreen.ts");
  assert.doesNotMatch(src, /draftNote|authorBadge|lto-card-draft/, "the screen draws neither the draft line nor the hand written tag");
  assert.match(src, /cardBadge\(c\.author\)/);
});

test("the start screen reads at scale 2 everywhere a test room's words are drawn", () => {
  const src = read("src/games/livingtable/table/ui/startScreen.ts");
  const room = src.slice(src.indexOf("function roomCard"), src.indexOf("function aiCard"));
  assert.doesNotMatch(room, /scale: 1/, "no tiny text on a room card");
  assert.doesNotMatch(room, /PX\.muted/, "and no dim ink for the summary");
  assert.match(room, /r\.summary[^\n]*scale: 2[^\n]*PX\.ink/);
});

// ---- the splash ----------------------------------------------------------------------------------------------------------------------

test("splashRemainingMs: the minimum less what has passed, never below 0, never NaN", () => {
  assert.equal(SPLASH_MIN_MS, 600);
  assert.equal(splashRemainingMs(1000, 1000), 600);
  assert.equal(splashRemainingMs(1000, 1250), 350);
  assert.equal(splashRemainingMs(1000, 1600), 0);
  assert.equal(splashRemainingMs(1000, 9000), 0, "a slow load adds no wait");
  assert.equal(splashRemainingMs(1000, 900), 700, "a clock that stepped back");
  assert.equal(splashRemainingMs(NaN, 1000), 600);
  assert.equal(splashRemainingMs(0, 100, 50), 0, "a different minimum");
});

// ---- the lane's files ----------------------------------------------------------------------------------------------------------------

const LANE_FILES = [
  "src/buildTarget.ts",
  "src/games/livingtable/Splash.tsx",
  "src/games/livingtable/TableScreen.tsx",
  "src/games/livingtable/table/ui/mainMenu.ts",
  "src/games/livingtable/table/flows/mainMenu.ts",
  "src/games/livingtable/table/flows/adventureStart.ts",
  "src/games/livingtable/table/ui/startScreen.ts",
  "src/games/livingtable/table/host/gameHost.ts",
  "src/games/livingtable/table/host/gameSettings.ts",
  "src/games/livingtable/table/host/gameStorage.ts",
];

test("the lane's files use no dash characters", () => {
  for (const f of LANE_FILES) assert.doesNotMatch(read(f), DASHES, f);
});

test("every target of the menu is at least 44 px tall, and the splash and the menu carry their own style (no reliance on app.css)", () => {
  const css = read("src/games/livingtable/table/ui/mainMenu.ts");
  const m = /\.ltm-btn\{[^}]*min-height:(\d+)px/.exec(css);
  assert.ok(m && Number(m[1]) >= 44, "Continue and the rest are tall enough to touch");
  assert.match(css, /createElement\("style"\)/);
  assert.match(read("src/games/livingtable/Splash.tsx"), /createElement\("style"\)/);
  assert.match(read("src/games/livingtable/Splash.tsx"), /prefers-reduced-motion/);
  assert.match(css, /prefers-reduced-motion/);
});

test("what the menu and the splash say is in player words: no bench, stub, build, games-db or engine", () => {
  const menuText = [...mainMenuButtons({ canContinue: true, continueHint: "Back to your game" }).flatMap((b) => [b.label, b.hint])].join(" ");
  assert.doesNotMatch(menuText, /bench|stub|build|games-db|engine/i);
  const splash = read("src/games/livingtable/Splash.tsx");
  const words = [...splash.matchAll(/>\s*([A-Z][^<>{}]{3,})\s*</g)].map((x) => x[1]).join(" ");
  assert.match(words, /Setting the table/);
  assert.doesNotMatch(words, /bench|stub|build|games-db|engine/i);
});
