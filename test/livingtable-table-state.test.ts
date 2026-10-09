/**
 * The table window's state, saves and adventures (src/games/livingtable/table/state.ts, snapshot.ts, adventureCatalog.ts,
 * adventureRun.ts), driven through the in-memory host: no page, no localStorage, no bench. What it proves:
 *
 *  - a scene (a test room, an adventure with places left behind) survives toSnapshot, JSON and fromSnapshot, and a save never
 *    holds the adventure's text;
 *  - the book of saves goes through host.storage.saves only (never localStorage), newest first, and survives a new book over
 *    the same storage, a corrupt text and a storage that throws;
 *  - the AI adventures go through host.storage.aiAdventures and are read again when the host is bound again;
 *  - the shipped adventures come from host.adventures.files() and are checked against the host's art, so a host with the
 *    wrong pictures lists them with problems instead of starting them.
 *
 * Run: npx tsx --test test/livingtable-table-state.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { SPRITES as FANTASY } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI } from "../scripts/assets/scifi";
import { exitDestination } from "../src/games/livingtable/adventures/validate";
import { ADVENTURE_FILES } from "../src/games/livingtable/table/adventures/data";
import {
  adventureById,
  adventureHero,
  benchAdventures,
  bindAdventures,
  checkAdventureText,
  registerAiAdventure,
  startCardsFor,
  unbindAdventures,
} from "../src/games/livingtable/table/adventureCatalog";
import { advApply, enterLocation, leaveBody, newAdventurePlay, sceneTiles } from "../src/games/livingtable/table/adventureRun";
import { bindCatalog, unbindCatalog } from "../src/games/livingtable/table/catalog";
import { createMemoryHost, type MemoryHost } from "../src/games/livingtable/table/hostDefault";
import {
  SAVES_SCOPE,
  createSaveBook,
  fromSnapshot,
  isSnapshot,
  readStoredSaves,
  saveDetail,
  toSnapshot,
  writeStoredSaves,
} from "../src/games/livingtable/table/snapshot";
import { noteSight } from "../src/games/livingtable/table/sight";
import { MONSTER_ID, addCreature, carryJournals, createSessionLog, newPlay, sandboxFromAddress, type PlayState } from "../src/games/livingtable/table/state";

function memoryHost(): MemoryHost {
  return createMemoryHost({ sprites: { fantasy: FANTASY as never, scifi: SCIFI as never }, adventures: ADVENTURE_FILES });
}

let host = memoryHost();
let unbindArt = bindCatalog(host.art);
let unbindAdv = bindAdventures(host);

/** A fresh host for a test that writes to storage, bound as the current one. */
function rebind(next: MemoryHost): void {
  unbindAdv();
  unbindArt();
  host = next;
  unbindArt = bindCatalog(host.art);
  unbindAdv = bindAdventures(host);
}

before(() => {
  // The table must never reach for the page's storage: make any touch fail loudly.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("the table touched localStorage");
    },
  });
});

after(() => {
  unbindAdv();
  unbindArt();
  unbindAdventures();
  unbindCatalog();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const RAT_TEXT = ADVENTURE_FILES.find((f) => f.file === "rat-cellar.md")!.text;
const rat = () => adventureById("rat-cellar")!;
const knight = "knight" as never;

function game(archetype: string = "knight"): PlayState {
  return newAdventurePlay(rat(), adventureHero(rat(), archetype as never));
}

function go(p: PlayState, exitId: string): void {
  const dest = exitDestination(rat(), p.progress!.locationId, exitId);
  assert.ok(dest, `exit ${exitId} has a destination`);
  assert.equal(enterLocation(p, dest.locationId, dest.at), true, `entered ${dest.locationId}`);
}

/** What a save is meant to hold: the snapshot of a scene read back from its own snapshot is the same snapshot. */
function roundTrip(p: PlayState): PlayState {
  const text = JSON.stringify(toSnapshot(p));
  const back = JSON.parse(text);
  assert.equal(isSnapshot(back), true, "the snapshot is one this table can read");
  const q = fromSnapshot(back);
  assert.ok(q, "the snapshot puts a scene back");
  assert.deepEqual(toSnapshot(q), toSnapshot(p), "a scene read back saves as the same snapshot");
  return q;
}

// ---------------------------------------------------------------------------
// Snapshots

test("a test room survives a save: hero, both creatures, the door, the DM's leavings and the log", () => {
  const p = newPlay("fantasy", knight, "floor_stone", undefined, undefined, "two");
  assert.equal(p.creatures.length, 2);
  p.hero = { ...p.hero, currentHp: 3 };
  p.doorOpen = true;
  p.doorLocked = false;
  p.potions = 1;
  p.dmMemory.push("the goblin owes the hero a favour");
  p.dmRecent.push({ who: "player", text: "I look around" });
  p.extraProps.push({ id: "dm-prop-1", assetId: "barrel", x: 6, y: 6, label: "a barrel", secret: "it is empty" });
  p.tileOverrides.push({ x: 5, y: 5, tile: "floor_stone_cracked" });
  p.log.push({ text: "You open the door.", tone: "good", notice: "+ nothing" });
  p.creatures[0]!.prone = true;
  p.creatures[0]!.seen = true;
  p.heroAt = { x: 9, y: 7 };
  noteSight(p);
  const body = leaveBody(p, p.creatures[1]!);
  p.creatures.splice(1, 1);
  assert.equal(body.token, "token_skeleton");

  const q = roundTrip(p);
  assert.equal(q.hero.currentHp, 3);
  assert.equal(q.room, "two");
  assert.equal(q.creatures.length, 1);
  assert.equal(q.creatures[0]!.id, MONSTER_ID);
  assert.equal(q.creatures[0]!.prone, true);
  assert.equal(q.bodies.length, 1);
  assert.deepEqual(q.dmMemory, ["the goblin owes the hero a favour"]);
  assert.deepEqual(q.extraProps, p.extraProps);
  assert.equal(q.doorOpen, true);
  assert.notEqual(q.boardEpoch, p.boardEpoch, "a loaded board is a new board to every cache");
  assert.deepEqual(q.options, [], "the DM's suggested moves are not saved");
  assert.equal(q.round, null);
});

test("what only the picture needs is not in a save, and what was explored is", () => {
  const p = newPlay("fantasy", knight, "floor_stone");
  const snap = toSnapshot(p) as unknown as Record<string, unknown>;
  for (const k of ["heroActor", "exploredRev", "note", "options", "dmJournal", "rollJournal", "adventurePending", "boardEpoch"]) assert.ok(!(k in snap), `${k} is left out`);
  assert.equal(typeof snap.explored, "string");
  const q = roundTrip(p);
  assert.deepEqual(Array.from(q.explored), Array.from(p.explored));
  assert.ok(q.explored.some((v) => v === 1), "the room the hero starts in is already seen");
  assert.equal(q.exploredRev, 1);
});

test("an adventure save holds the adventure by id and the story, never its text, and puts the places left behind back", () => {
  const p = game("shadow");
  advApply(p, { type: "talk", npc: "tobin" });
  go(p, "to_village");
  go(p, "tavern_door");
  advApply(p, { type: "talk", npc: "marta" });
  go(p, "cellar_stairs");
  const cellarRats = p.creatures.filter((c) => c.adv?.spawn).length;
  assert.ok(cellarRats >= 5, "the cellar's creatures were placed");
  leaveBody(p, p.creatures.find((c) => c.id === "cellar_rats_2")!);
  p.creatures = p.creatures.filter((c) => c.id !== "cellar_rats_2");

  const json = JSON.stringify(toSnapshot(p));
  assert.ok(!json.includes(rat().summary.slice(0, 40)), "the adventure's summary is not in the save");
  assert.ok(!json.includes("Marta draws the bolt"), "no scene text is in the save");
  assert.ok(json.length < 100_000, `a save is small (${json.length} bytes)`);

  const q = roundTrip(p);
  assert.equal(q.adventureId, "rat-cellar");
  assert.equal(q.progress!.locationId, "cellar");
  assert.deepEqual(q.progress, p.progress);
  assert.deepEqual(Object.keys(q.places).sort(), Object.keys(p.places).sort());
  assert.deepEqual(sceneTiles(q), sceneTiles(p), "the board is built again from the adventure");
  go(q, "stairs_up");
  assert.equal(q.progress!.locationId, "tavern", "the place left behind comes back too");
});

test("a save the table cannot read is refused whole: another adventure, another version, an unknown picture, a damaged fog", () => {
  const p = game();
  const good = JSON.parse(JSON.stringify(toSnapshot(p)));
  assert.equal(isSnapshot(good), true);
  const mutate = (f: (d: Record<string, any>) => void): unknown => {
    const d = JSON.parse(JSON.stringify(good));
    f(d);
    return d;
  };
  assert.equal(isSnapshot(mutate((d) => ((d.adventureId = "no-such-adventure"), (d.progress.adventureId = "no-such-adventure")))), false);
  assert.equal(isSnapshot(mutate((d) => (d.progress.version = rat().version + 1))), false);
  assert.equal(isSnapshot(mutate((d) => (d.progress.locationId = "nowhere"))), false);
  assert.equal(isSnapshot(mutate((d) => (d.places = { home: { explored: "01" } }))), false);
  assert.equal(isSnapshot(mutate((d) => (d.floorId = "floor_made_up"))), false);
  assert.equal(isSnapshot(mutate((d) => (d.explored = "0101"))), false);
  assert.equal(isSnapshot(mutate((d) => (d.v = 3))), false);
  assert.equal(isSnapshot(mutate((d) => (d.archetypeId = "healer"))), false, "the Healer is out of play");
  assert.equal(isSnapshot(null), false);
  assert.equal(isSnapshot("a save"), false);
  assert.equal(fromSnapshot({ v: 2 }), null);
});

test("a save from before creatures (one monster) is read as a scene with that creature", () => {
  const p = newPlay("fantasy", knight, "floor_stone");
  const snap = JSON.parse(JSON.stringify(toSnapshot(p)));
  const m = snap.creatures[0];
  for (const k of ["creatures", "room", "spawned", "creatureSeq", "round"]) delete snap[k];
  snap.v = 1;
  snap.monster = { at: m.at, hp: 3, awake: true, prone: true };
  snap.monsterSeen = true;
  snap.monsterCarried = m.carried;
  delete snap.bodies;
  assert.equal(isSnapshot(snap), true);
  const q = fromSnapshot(snap)!;
  assert.equal(q.creatures.length, 1);
  assert.equal(q.creatures[0]!.id, MONSTER_ID);
  assert.equal(q.creatures[0]!.hp, 3);
  assert.equal(q.creatures[0]!.awake, true);
  assert.equal(q.creatures[0]!.seen, true);
  assert.equal(q.creatures[0]!.prone, true);
  assert.equal(q.room, "one");
  assert.equal(q.creatureSeq, 2);
  assert.equal(q.round, null);
});

// ---------------------------------------------------------------------------
// The book of saves

test("the book goes through host.storage.saves under one scope, newest first, and a new book over the same storage reads it back", () => {
  rebind(memoryHost());
  const book = createSaveBook(host.storage.saves);
  assert.deepEqual(book.list(), []);
  assert.equal(host.store.size, 0);
  const p = newPlay("fantasy", knight, "floor_stone");
  book.add(p, "checkpoint", "start of the scene");
  p.hero = { ...p.hero, currentHp: 2 };
  book.add(p, "rest", "");
  assert.deepEqual([...host.store.keys()], [SAVES_SCOPE], "the saves are one text under one scope");
  assert.deepEqual(book.list().map((s) => s.kind), ["rest", "checkpoint"], "newest first");
  assert.equal(book.find("last"), book.list()[0]);
  assert.equal(book.find(book.list()[1]!.id), book.list()[1]);
  assert.equal(book.find("nope"), undefined);
  assert.match(saveDetail(book.list()[0]!), /2\/\d+ HP, 2 potions/);

  const again = createSaveBook(host.storage.saves);
  assert.deepEqual(again.list().map((s) => s.id), book.list().map((s) => s.id));
  assert.deepEqual(again.list().map((s) => s.data), book.list().map((s) => s.data));
  const q = fromSnapshot(again.find("last")!.data)!;
  assert.equal(q.hero.currentHp, 2);
});

test("a corrupt or foreign text in storage is an empty book; a storage that throws never breaks play", () => {
  rebind(memoryHost());
  host.store.set(SAVES_SCOPE, "{ this is not json");
  assert.deepEqual(readStoredSaves(host.storage.saves), []);
  host.store.set(SAVES_SCOPE, JSON.stringify({ saves: [{ nonsense: true }] }));
  assert.deepEqual(readStoredSaves(host.storage.saves), []);

  const broken = {
    read: (): string | null => {
      throw new Error("blocked");
    },
    write: (): void => {
      throw new Error("full");
    },
  };
  assert.deepEqual(readStoredSaves(broken), []);
  const book = createSaveBook(broken);
  book.add(newPlay("fantasy", knight, "floor_stone"), "checkpoint", "still works this visit");
  assert.equal(book.list().length, 1);
  assert.doesNotThrow(() => writeStoredSaves(broken, book.list()));
});

test("two windows keep two books: nothing is shared through the page", () => {
  const a = memoryHost();
  const b = memoryHost();
  rebind(a);
  const bookA = createSaveBook(a.storage.saves);
  bookA.add(newPlay("fantasy", knight, "floor_stone"), "checkpoint", "a");
  const bookB = createSaveBook(b.storage.saves);
  assert.equal(bookB.list().length, 0);
  assert.equal(b.store.size, 0);
});

// ---------------------------------------------------------------------------
// The adventure list

test("the shipped adventures come from the host, are checked against its art, and are listed with their cards", () => {
  rebind(memoryHost());
  const list = benchAdventures();
  assert.deepEqual(list.map((e) => e.file), ["rat-cellar.md", "TEMPLATE.md"], "the owner's files first, the template last");
  assert.deepEqual(list.map((e) => e.problems), [[], []]);
  assert.match(list[1]!.title, /^Template adventure \(/);
  assert.equal(benchAdventures(), list, "the list is read once while the art is ready");
  const cards = startCardsFor(list);
  assert.equal(cards[0]!.id, "rat-cellar");
  assert.ok(cards[0]!.draftMarks! > 0);
  assert.equal(cards[1]!.draftMarks, undefined);
});

test("a host whose art lacks the adventure's pictures lists it with problems and cannot start it; the list is read again when the art changes", () => {
  const poor = createMemoryHost({ adventures: ADVENTURE_FILES });
  rebind(poor);
  const first = benchAdventures().find((e) => e.file === "rat-cellar.md")!;
  assert.equal(first.adventure, null);
  assert.ok(first.problems.length > 0);
  assert.equal(adventureById("rat-cellar"), undefined);

  poor.setSprites("fantasy", FANTASY as never);
  const second = benchAdventures().find((e) => e.file === "rat-cellar.md")!;
  assert.deepEqual(second.problems, []);
  assert.ok(adventureById("rat-cellar"), "the same host now starts it");
});

test("a list made while the art is still loading is not kept", () => {
  const loading = createMemoryHost({ sprites: { fantasy: FANTASY as never }, adventures: ADVENTURE_FILES, ready: false });
  rebind(loading);
  const early = benchAdventures();
  assert.notEqual(benchAdventures(), early, "read again on every ask until the art is ready");
  loading.setReady(true);
  const settled = benchAdventures();
  assert.equal(benchAdventures(), settled);
});

test("an AI adventure goes to the host's storage, comes back after a new bind, and a twin of an existing id is listed with the problem", () => {
  const h = memoryHost();
  rebind(h);
  const twin = registerAiAdventure(RAT_TEXT);
  assert.equal(twin.adventure, null);
  assert.ok(twin.problems.some((m) => /already used/.test(m)));
  assert.deepEqual(h.aiAdventures, [], "an adventure with problems is not kept");

  const ai = RAT_TEXT.replace("- id: rat-cellar", "- id: rat-cellar-ai").replace("- author: owner", "- author: ai");
  const fresh = registerAiAdventure(ai);
  assert.ok(fresh.adventure, fresh.problems.join(" | "));
  assert.equal(fresh.author, "ai");
  assert.deepEqual(h.aiAdventures, [ai]);
  assert.equal(adventureById("rat-cellar-ai"), fresh.adventure);

  // A new window over the same host: the AI adventure is read from storage and checked again.
  rebind(h);
  assert.deepEqual(benchAdventures().map((e) => e.file), ["rat-cellar.md", "TEMPLATE.md", "ai"]);
  assert.ok(adventureById("rat-cellar-ai"));

  // A game of it saves and loads like any other.
  const p = newAdventurePlay(adventureById("rat-cellar-ai")!, adventureHero(adventureById("rat-cellar-ai")!, knight));
  assert.equal(roundTrip(p).adventureId, "rat-cellar-ai");
  rebind(memoryHost());
  assert.equal(isSnapshot(JSON.parse(JSON.stringify(toSnapshot(p)))), false, "a save of an adventure this host does not have is refused");
});

test("checkAdventureText never throws: a broken file is an entry with problems, not a crash", () => {
  rebind(memoryHost());
  const bad = checkAdventureText("bad.md", "# A Broken Tale\n\n- id: broken\n\n## Summary\n\nIt does not hold together.\n");
  assert.equal(bad.adventure, null);
  assert.ok(bad.problems.length > 0);
  assert.equal(bad.id, "file:bad.md");
  assert.equal(bad.title, "A Broken Tale");
  assert.equal(bad.summary, "It does not hold together.");
  const typo = checkAdventureText("typo.md", RAT_TEXT.replace("prop barrel", "prop barrle"));
  assert.equal(typo.adventure, null);
  assert.ok(typo.problems.some((m) => /barrle/.test(m)));
  assert.doesNotThrow(() => checkAdventureText("empty.md", ""));
});

test("without a bound host the adventure list says what to call, instead of answering from nothing", () => {
  unbindAdv();
  assert.throws(() => benchAdventures(), /bindAdventures/);
  // A late unbind of a replaced binding must not drop the new one.
  const staleUnbind = bindAdventures(host);
  const current = bindAdventures(host);
  staleUnbind();
  assert.ok(benchAdventures().length > 0, "the newer binding is still there");
  unbindAdv = current;
});

// ---------------------------------------------------------------------------
// The helpers that used to be page globals

test("the session log belongs to one window and keeps the old scene's lines with a marker when a scene is replaced", () => {
  const log = createSessionLog();
  const other = createSessionLog();
  const a = newPlay("fantasy", knight, "floor_stone");
  a.log.push({ text: "one", tone: "plain", notice: "dropped" });
  a.dmJournal.push({ at: 0 } as never);
  const b = newPlay("fantasy", knight, "floor_stone");
  carryJournals(a, b, "Reset scene", log);
  assert.deepEqual(log.lines.map((l) => l.text), ["one", "--- Reset scene ---"]);
  assert.equal(log.lines[0]!.notice, undefined, "only the words and the tone are kept");
  assert.deepEqual(other.lines, [], "another window's log is untouched");
  assert.equal(b.dmJournal, a.dmJournal, "the journals ride over to the new scene");
  carryJournals(b, b, "same", log);
  carryJournals(null, b, "none", log);
  assert.equal(log.lines.length, 2);
  for (let i = 0; i < 4100; i++) log.archive([{ text: String(i), tone: "plain" }]);
  assert.equal(log.lines.length, 4000);
});

test("the sandbox rooms come from the host's address and only when the host allows them", () => {
  const env = (address: string, sandboxRooms: boolean) => ({ address: () => address, sandboxRooms });
  assert.equal(sandboxFromAddress(env("#sandbox", true)), "one");
  assert.equal(sandboxFromAddress(env("#Sandbox-One", true)), "one");
  assert.equal(sandboxFromAddress(env("#sandbox-two", true)), "two");
  assert.equal(sandboxFromAddress(env("#elsewhere", true)), null);
  assert.equal(sandboxFromAddress(env("#sandbox", false)), null, "the game never opens a sandbox room");
  assert.equal(sandboxFromAddress({ address: () => { throw new Error("no address"); }, sandboxRooms: true }), null);
});

test("a creature added to a scene is numbered and carries what its kind carries", () => {
  const p = newPlay("fantasy", knight, "floor_stone");
  const extra = addCreature(p, "token_goblin", { x: 14, y: 8 }, { awake: true });
  assert.equal(extra.id, "monster-2");
  assert.equal(extra.n, 2);
  assert.equal(extra.awake, true);
  assert.equal(p.spawned.token_goblin, 2);
});
