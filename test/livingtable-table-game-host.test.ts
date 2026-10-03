/**
 * The shipped game's host (table/host/gameHost.ts): the one place the window's parts are put together. What it proves:
 *
 *  - the host is the game's: the owner's adventures, the playable classes, no sandbox address, no debug export, a fresh hero each
 *    time, the settings with the text speed, and no price text anywhere on the DM part;
 *  - open() settles the art (falling back to the bundled library when games-db has none) and the saves, and hands back a session;
 *  - a player who has a save is put back in it (not on the start screen), and one who has none starts at the start screen;
 *  - the catalog binding open() needs for reading saves is its own: it is gone again afterwards, and a window's binding that is
 *    already there is left alone;
 *  - a save that arrives late (another device, after the wait gave up) joins the book the window keeps;
 *  - who is playing is kept as a hash, never as the address, and a second player's device cache is put aside;
 *  - a window that could not be mounted on the save the host resumed is remembered: the next open lands on the start screen, with the
 *    saves kept, and Try again (`resume: false`) does the same;
 *  - with a server, whoami is asked again when it does not answer; while the owner is unknown nothing is resumed or pulled, and a late
 *    answer hands the sync on and tells the screen;
 *  - dispose is safe to call twice.
 *
 * Run: npx tsx --test test/livingtable-table-game-host.test.ts
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { resetLtSavesMock } from "../src/bridge/gamesApi";
import { ADVENTURE_FILES } from "../src/games/livingtable/table/adventures/data";
import { adventureById, adventureHero, bindAdventures, unbindAdventures } from "../src/games/livingtable/table/adventureCatalog";
import { bindCatalog, catalogBound, unbindCatalog } from "../src/games/livingtable/table/catalog";
import { createGameHost, playableHeroes, resetFailedResumes, type GameHost, type GameHostOptions } from "../src/games/livingtable/table/host/gameHost";
import { gamesSaveServer, TABLE_KEYS, type KeyValueStore } from "../src/games/livingtable/table/host/gameStorage";
import { newAdventurePlay } from "../src/games/livingtable/table/adventureRun";
import { createSaveBook } from "../src/games/livingtable/table/snapshot";
import { APP_VERSION } from "../src/version";

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** A signed-in player, for hosts that talk to a (mock) server: with none known, the storage keeps everything on the device. */
const SIGNED_IN = async () => ({ signedIn: true, email: "tester@example.test" });

const hosts: GameHost[] = [];
/** A game host that is not on the network: games-db has no art (the bundled library serves), saves are kept in `store`. */
function make(store: KeyValueStore, extra: Partial<GameHostOptions> = {}): GameHost {
  const g = createGameHost({
    art: { load: () => Promise.reject(new Error("offline")) },
    storage: { store, remote: null, retryMs: 0 },
    settings: { store },
    whoami: async () => null,
    reducedMotion: false,
    ...extra,
  });
  hosts.push(g);
  return g;
}

beforeEach(() => {
  resetLtSavesMock();
  resetFailedResumes();
});
afterEach(() => {
  for (const g of hosts.splice(0)) g.dispose();
  unbindAdventures();
  unbindCatalog();
});

/** A scene of The Rat Cellar for the Knight, saved into `session`'s book as a checkpoint. */
function saveRatCellar(g: GameHost, session: { saves: ReturnType<typeof createSaveBook> }): void {
  const offs = [bindCatalog(g.art), bindAdventures(g.host)];
  try {
    const rat = adventureById("rat-cellar")!;
    session.saves.add(newAdventurePlay(rat, adventureHero(rat, "knight" as never)), "checkpoint", "start of the adventure");
  } finally {
    for (const off of offs) off();
  }
}

test("the host is the game's: the owner's adventures, the playable classes, a fresh hero, no sandbox address, no debug export", () => {
  const g = make(memStore());
  const h = g.host;
  assert.deepEqual(h.adventures.files(), ADVENTURE_FILES);
  assert.ok(h.adventures.files().some((f) => f.file === "rat-cellar.md"));
  assert.ok(h.adventures.files().some((f) => f.file === "TEMPLATE.md"));
  assert.deepEqual(h.heroes.playable(), playableHeroes());
  assert.ok(h.heroes.playable().includes("knight" as never));
  assert.equal(h.heroes.initial(), null, "each start is a fresh hero; progress lives in the saves");
  assert.equal(h.env.address(), "");
  assert.equal(h.env.sandboxRooms, false);
  assert.equal(h.env.debugExport, false);
  assert.match(h.env.build.app, new RegExp(APP_VERSION.replace(/\./g, "\\.")));
  const s = h.settings.get();
  assert.equal(s.textSpeed, "normal");
  assert.equal(s.textStyle, "pixel");
  assert.equal(h.dm.costNote, undefined, "the game never states a price");
  assert.doesNotMatch(h.dm.unavailable, /credit|price|cost/i);
});

test("the Settings tab's choices are kept: text speed and style persist through the host's settings", () => {
  const store = memStore();
  const a = make(store);
  a.host.settings.set({ textSpeed: "fast", textStyle: "storybook" });
  const b = make(store);
  assert.equal(b.host.settings.get().textSpeed, "fast");
  assert.equal(b.host.settings.get().textStyle, "storybook");
  b.host.settings.set({ textSpeed: "warp" as never });
  assert.equal(make(store).host.settings.get().textSpeed, "fast", "a value the window does not know is ignored");
});

test("open() with nothing saved: the art is settled (bundled when games-db has none) and the session starts at the start screen", async () => {
  const g = make(memStore());
  const session = await g.open();
  assert.equal(session.atStart, true);
  assert.equal(session.play, null);
  assert.equal(session.saves.list().length, 0);
  assert.equal(g.art.ready(), true);
  assert.equal(g.art.status("fantasy").source, "bundled");
  assert.equal(await g.open(), session, "open runs once");
  assert.equal(catalogBound(), false, "the binding open() used for reading saves is gone again");
});

test("open() puts a player who has a save back in it, and the book holds their saves", async () => {
  const store = memStore();
  const first = make(store);
  const s1 = await first.open();
  saveRatCellar(first, s1);
  first.dispose();

  const again = make(store);
  const s2 = await again.open();
  assert.equal(s2.atStart, false, "the game opens where it was");
  assert.ok(s2.play, "the scene is up");
  assert.equal(s2.play!.adventureId, "rat-cellar");
  assert.equal(s2.saves.list().length, 1);
  assert.equal(s2.saves.list()[0]!.kind, "checkpoint");
  assert.equal(catalogBound(), false);
});

test("a binding that is already there (the window's) is left alone while the book is read", async () => {
  const store = memStore();
  const first = make(store);
  saveRatCellar(first, await first.open());
  first.dispose();
  const again = make(store);
  const mine = bindCatalog(again.art);
  const off = bindAdventures(again.host);
  await again.open();
  assert.equal(catalogBound(), true, "still bound after open()");
  off();
  mine();
});

test("a save that arrives after the wait gave up joins the book the window keeps", async () => {
  // A server another device already saved to; this device waits 1 ms for it, then starts from its cache.
  const other = make(memStore(), { whoami: SIGNED_IN, storage: { store: memStore(), remote: gamesSaveServer, retryMs: 0, readyTimeoutMs: 0 } });
  saveRatCellar(other, await other.open());
  await other.storage.flush();
  const rows = await gamesSaveServer.list();
  assert.ok(rows.saves.length >= 1, "the other device's save is on the server");
  other.dispose();

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = {
    ...gamesSaveServer,
    async list() {
      await gate;
      return gamesSaveServer.list();
    },
  };
  const g = make(memStore(), { whoami: SIGNED_IN, storage: { store: memStore(), remote: slow, retryMs: 0, readyTimeoutMs: 1 } });
  const session = await g.open();
  assert.equal(session.saves.list().length, 0, "the wait gave up with an empty book");
  assert.equal(session.atStart, true);
  release();
  await g.storage.sync();
  assert.ok(session.saves.list().length >= 1, "the late save joined the book");
});

test("who is playing is kept as a hash, never as the address, and another player's device cache is put aside", async () => {
  const store = memStore();
  const a = make(store, { whoami: async () => ({ signedIn: true, email: "Tester@Example.test" }), storage: { store, remote: gamesSaveServer, retryMs: 0, readyTimeoutMs: 0 } });
  saveRatCellar(a, await a.open());
  await a.storage.flush();
  a.dispose();
  const kept = [...store.data.values()].join("\n");
  assert.doesNotMatch(kept, /example\.test/i, "the address is not kept");
  assert.match(store.data.get(TABLE_KEYS.sync) ?? "", /"owner":"u[0-9a-z]+"/);

  resetLtSavesMock(); // the second player's account is empty
  const b = make(store, { whoami: async () => ({ signedIn: true, email: "someone-else@example.test" }), storage: { store, remote: gamesSaveServer, retryMs: 0, readyTimeoutMs: 0 } });
  const s = await b.open();
  assert.equal(s.atStart, true, "the first player's game is not the second player's");
  assert.equal(s.saves.list().length, 0);
  assert.equal((await gamesSaveServer.list()).saves.length, 0, "nothing of the first player's was uploaded");
  assert.ok([...store.data.keys()].some((k) => k.startsWith(TABLE_KEYS.backupPrefix)), "the first player's saves were kept aside on the device");
});

test("a whoami that never answers does not hold the game up", async () => {
  const g = make(memStore(), { whoami: () => new Promise(() => {}), whoamiTimeoutMs: 20 });
  const t0 = Date.now();
  const session = await g.open();
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(session.atStart, true);
});

/** A device that already holds a save of The Rat Cellar (kept in `store`, no server). */
async function deviceWithSave(store: KeyValueStore): Promise<void> {
  const first = make(store);
  saveRatCellar(first, await first.open());
  first.dispose();
}

test("a window that failed to mount on the resumed save is not given that save again: the start screen, saves kept", async () => {
  const store = memStore();
  await deviceWithSave(store);
  const a = make(store);
  const s1 = await a.open();
  assert.equal(s1.atStart, false, "the save is resumed the first time");
  a.noteMountFailed();
  a.dispose();

  const b = make(store);
  const s2 = await b.open();
  assert.equal(s2.atStart, true, "the save that failed to mount is not resumed again, even by a fresh host");
  assert.equal(s2.play, null);
  assert.equal(s2.saves.list().length, 1, "the save is kept");

  resetFailedResumes();
  const c = make(store, { resume: false });
  const s3 = await c.open();
  assert.equal(s3.atStart, true, "resume: false opens on the start screen (Try again)");
  assert.equal(s3.saves.list().length, 1);
});

test("noteMountFailed does nothing when no save was resumed", async () => {
  const store = memStore();
  await deviceWithSave(store);
  const a = make(store, { resume: false });
  await a.open();
  a.noteMountFailed();
  const b = make(store);
  assert.equal((await b.open()).atStart, false, "nothing was marked failed, so the save is still resumed");
});

const WITH_SERVER = { remote: gamesSaveServer, retryMs: 0, readyTimeoutMs: 0 } as const;

test("whoami is asked again when it does not answer, and the answer found on a retry is used", async () => {
  const store = memStore();
  let asked = 0;
  const g = make(store, {
    storage: { store, ...WITH_SERVER },
    whoamiRetryMs: 0,
    whoami: async () => (++asked < 3 ? null : { signedIn: true, email: "late@example.test" }),
  });
  await g.open();
  assert.equal(asked, 3, "asked once and retried twice");
  assert.equal(g.ownerKnown(), true);
  assert.match(store.data.get(TABLE_KEYS.sync) ?? "", /"owner":"u[0-9a-z]+"/);
});

test("with no server whoami is asked once: there is nobody to protect the saves from", async () => {
  let asked = 0;
  const g = make(memStore(), { whoami: async () => (asked++, null) });
  await g.open();
  assert.equal(asked, 1);
  assert.equal(g.ownerKnown(), true);
});

test("while the owner is unknown nothing is resumed, nothing is pulled or pushed, and the screen can tell", async () => {
  const store = memStore();
  await deviceWithSave(store);
  resetLtSavesMock();
  const g = make(store, { storage: { store, ...WITH_SERVER }, whoamiAttempts: 2, whoamiRetryMs: 0, whoamiLateMs: 0, whoamiTimeoutMs: 20, whoami: async () => null });
  const s = await g.open();
  assert.equal(g.ownerKnown(), false);
  assert.equal(s.atStart, true, "the cache may be another player's: no save is resumed");
  assert.equal(s.play, null);
  assert.equal((await gamesSaveServer.list()).saves.length, 0, "nothing of the device cache went to the server");
});

test("a late whoami answer makes the owner known, starts the sync, and tells the screen", async () => {
  const store = memStore();
  let asked = 0;
  const g = make(store, {
    storage: { store, ...WITH_SERVER },
    whoamiAttempts: 1,
    whoamiRetryMs: 0,
    whoamiLateMs: 5,
    whoamiTimeoutMs: 20,
    whoami: async () => (++asked < 3 ? null : { signedIn: true, email: "later@example.test" }),
  });
  await g.open();
  assert.equal(g.ownerKnown(), false);
  const told = new Promise<void>((resolve) => g.onOwner(resolve));
  await told;
  assert.equal(g.ownerKnown(), true);
  assert.match(store.data.get(TABLE_KEYS.sync) ?? "", /"owner":"u[0-9a-z]+"/);
});

test("dispose can be called twice", () => {
  const g = make(memStore());
  g.dispose();
  g.dispose();
});
