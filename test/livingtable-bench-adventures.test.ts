/**
 * The bench Play tab's adventure runner (scripts/asset-bench/assets.ts ADVENTURE_RULES), with no DOM: the adventures embedded from
 * adventures/*.md (adventuresData.ts, written by gen-adventures.mjs), read and checked in the page; a new game of one (an unarmored hero,
 * the first place built from its map, creatures from its spawns); the places and the ways between them; the story told of kills, items and
 * talk; the Journal; and a save that holds the adventure by id and the story, never its text. The board and the cards are checked headless in
 * .cache/adventure-run.cjs.
 *
 * Run: npx tsx --test test/livingtable-bench-adventures.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import bench, { ADVENTURE_RULES as R, PLAY_RULES as P } from "../scripts/asset-bench/assets";
import { ADVENTURE_FILES } from "../src/games/livingtable/table/adventures/data";
import { buildDmInput, validateDmReply, validationContextFor } from "../src/games/livingtable/table/dmCore";
// @ts-expect-error a plain ES module with no types: the generator the bench build runs.
import { buildModule } from "../scripts/asset-bench/gen-adventures.mjs";
import { exitDestination } from "../src/games/livingtable/adventures/validate";
import { tierInSlot } from "../src/games/livingtable/characters/equipment";
import { markedForReview } from "../src/games/livingtable/adventures/markdown";

void bench;

const RAT = R.adventureById("rat-cellar")!;
const KNIGHT = "knight" as never;
type Play = ReturnType<typeof R.newAdventurePlay>;

/** A new game of The Rat Cellar as this class. */
function game(archetype: string = "knight"): Play {
  return R.newAdventurePlay(RAT, R.adventureHero(RAT, archetype as never));
}

/** Go through one of the exits of the place the hero is in, as the panel does once the way is open. */
function go(p: Play, exitId: string): void {
  const dest = exitDestination(RAT, p.progress!.locationId, exitId);
  assert.ok(dest, `exit ${exitId} has a destination`);
  assert.equal(R.enterLocation(p, dest.locationId, dest.at), true, `entered ${dest.locationId}`);
}

/** Talk to Tobin, walk to the village, the tavern, talk to Marta and go down the stairs: the cellar, with its creatures. */
function toCellar(p: Play): void {
  R.advApply(p, { type: "talk", npc: "tobin" });
  go(p, "to_village");
  go(p, "tavern_door");
  R.advApply(p, { type: "talk", npc: "marta" });
  go(p, "cellar_stairs");
}

// ---------------------------------------------------------------------------
// The adventures the bench carries

test("the embedded adventure data is exactly adventures/*.md (run node scripts/asset-bench/gen-adventures.mjs when it is stale)", () => {
  const written = readFileSync(new URL("../src/games/livingtable/table/adventures/data.ts", import.meta.url), "utf8").replace(/\r\n?/g, "\n");
  assert.equal(written, buildModule());
  const files = ADVENTURE_FILES.map((f) => f.file);
  assert.deepEqual(files, ["blackstone.md", "rat-cellar.md", "TEMPLATE.md"]);
  assert.ok(!files.includes("README.md"), "the authoring guide is not an adventure");
});

test("every adventure file is read and checked in the page: Blackstone, the Rat Cellar and the Template adventure start, with their cards", () => {
  const list = R.benchAdventures();
  const blackstone = list.find((e) => e.file === "blackstone.md")!;
  assert.equal(blackstone.id, "blackstone");
  assert.deepEqual(blackstone.problems, []);
  assert.ok(blackstone.adventure);
  const rat = list.find((e) => e.file === "rat-cellar.md")!;
  const template = list.find((e) => e.file === "TEMPLATE.md")!;
  assert.equal(rat.id, "rat-cellar");
  assert.equal(rat.title, "The Rat Cellar");
  assert.deepEqual(rat.problems, []);
  assert.ok(rat.adventure);
  assert.ok(rat.draftMarks > 0, "the draft's marked items are counted for the card");
  assert.match(template.title, /^Template adventure \(/);
  assert.deepEqual(template.problems, []);
  assert.ok(template.adventure);
  // The owner's files come first, the template last; the start screen's cards carry what the overlay shows.
  assert.deepEqual(list.slice(0, 3).map((e) => e.file), ["blackstone.md", "rat-cellar.md", "TEMPLATE.md"]);
  const cards = R.startCardsFor(list);
  assert.equal(cards[1]!.draftMarks, rat.draftMarks);
  assert.equal(cards[1]!.problems, undefined);
  assert.equal(cards[2]!.draftMarks, undefined);
});

test("a file with problems is listed with them and cannot be started", () => {
  const bad = R.checkAdventureText("bad.md", "# A Broken Tale\n\n- id: broken\n\n## Summary\n\nIt does not hold together.\n");
  assert.equal(bad.adventure, null);
  assert.ok(bad.problems.length > 0);
  assert.equal(bad.title, "A Broken Tale");
  assert.equal(bad.summary, "It does not hold together.");
  assert.equal(bad.id, "file:bad.md");
  // A picture the game does not have is caught against the real asset lists, in the page.
  const text = ADVENTURE_FILES.find((f) => f.file === "rat-cellar.md")!.text.replace("prop barrel", "prop barrle");
  const typo = R.checkAdventureText("typo.md", text);
  assert.equal(typo.adventure, null);
  assert.ok(typo.problems.some((m) => /barrle/.test(m)), typo.problems.join(" | "));
});

test("an adventure whose id is already taken is listed with that problem and cannot be started (and an AI one is registered the same way)", () => {
  const text = ADVENTURE_FILES.find((f) => f.file === "rat-cellar.md")!.text;
  const twin = R.registerAiAdventure(text);
  assert.equal(twin.adventure, null);
  assert.ok(twin.problems.some((m) => /already used/.test(m)));
  assert.equal(R.adventureById("rat-cellar"), RAT, "the first one is still the one that starts");
  const fresh = R.registerAiAdventure(text.replace("- id: rat-cellar", "- id: rat-cellar-ai").replace("- author: owner", "- author: ai"));
  assert.ok(fresh.adventure, fresh.problems.join(" | "));
  assert.equal(fresh.author, "ai");
  assert.equal(R.adventureById("rat-cellar-ai"), fresh.adventure);
});

// ---------------------------------------------------------------------------
// A new game: the hero, the first place, its people

test("a hero of every class starts unarmored with only the plain weapon: AC 10 + DEX, nothing worn on the armour slots, no potions", () => {
  for (const id of ["knight", "shadow", "fireball-person"]) {
    const p = game(id);
    const h = p.hero;
    assert.equal(h.armorClass, 10 + h.modifiers.dex, `${id} wears no armor`);
    assert.equal(tierInSlot(h, "outer"), null, `${id} has nothing worn in the armour slot`);
    assert.equal(p.potions, 0, `${id} starts with no potions`);
    assert.deepEqual(h.inventory, [], `${id} carries nothing`);
    assert.equal(tierInSlot(h, "weapon"), "common", `${id} carries the class's plain weapon`);
  }
  assert.equal(R.kitWords(RAT.startingKit.fighter), "a plain sword, no armor and no potions.");
  assert.equal(R.kitWords(undefined), "the class's usual gear.");
});

test("a new game begins at home: the first scene, the start square, and Tobin in the workshop as a person with his own name", () => {
  const p = game();
  assert.equal(p.adventureId, "rat-cellar");
  assert.equal(p.progress!.locationId, "home");
  assert.equal(p.progress!.sceneId, "morning");
  assert.deepEqual(p.heroAt, RAT.start.at);
  assert.equal(p.creatures.length, 1);
  const tobin = p.creatures[0]!;
  assert.equal(tobin.id, "tobin_at_work", "a creature's id is the instance id the story's kills use");
  assert.deepEqual([tobin.hostile, tobin.awake, tobin.npc?.name, tobin.adv?.npc], [false, true, "Tobin Hale", "tobin"]);
  assert.equal(R.creatureName(p, tobin), "Tobin Hale");
  assert.equal(R.creatureLabel(p, tobin), "Tobin Hale");
  // The board is the place's map: walls round the edge, the start square a wooden floor, props where the legend put them.
  const tiles = R.sceneTiles(p);
  assert.equal(tiles[0]![0], "wall_stone");
  assert.equal(tiles[3]![3], "floor_wood");
  assert.ok(R.sceneProps(p).some((q) => q.assetId === "workbench" && q.label === "Workbench"), "a feature's prop carries the feature's name");
  const layout = R.engineLayout(p);
  assert.deepEqual(layout.tokens.map((t) => [t.id, t.kind]), [["hero", "pc"], ["tobin_at_work", "npc"]]);
  assert.equal(p.round, null);
  // The test room is untouched: it has no adventure, no story and no places.
  assert.equal(R.advBoard(p) !== null, true);
});

// ---------------------------------------------------------------------------
// Places and ways between them

test("the front door is held shut until the story says Tobin has been spoken to, and a step onto it says why in the adventure's words", () => {
  const p = game();
  const door = R.exitsHere(p).find((e) => e.exit.id === "to_village")!;
  assert.deepEqual(door.at, { x: 13, y: 14 });
  assert.equal(R.exitIsOpen(p, door.exit), false);
  p.heroAt = { x: 13, y: 13 };
  const step = R.heroStepTo(p, door.at);
  assert.equal(step.refused, "Your father clears his throat. You should at least say good morning before you go.");
  assert.deepEqual(p.heroAt, { x: 13, y: 13 }, "the hero stayed where they were");
  assert.equal(R.advApply(p, { type: "talk", npc: "tobin" })!.refused, undefined);
  assert.equal(R.exitIsOpen(p, door.exit), true);
  assert.equal(R.heroStepTo(p, door.at).refused, null);
  assert.equal(R.exitOn(p, p.heroAt)?.exit.id, "to_village", "the hero now stands on the way out");
  assert.equal(R.advUseFor(p)?.kind, "exit");
});

test("going through an exit: the story is told the party entered, the old place is kept, the new one is built with its people, and arrival is where the exit leads", () => {
  const p = game();
  R.advApply(p, { type: "talk", npc: "tobin" });
  const dest = exitDestination(RAT, "home", "to_village")!;
  assert.equal(R.enterLocation(p, dest.locationId, dest.at), true);
  assert.equal(p.progress!.locationId, "village");
  assert.ok(p.progress!.entered.includes("village"));
  assert.deepEqual(p.heroAt, dest.at);
  assert.deepEqual(dest.at, R.exitsHere(p).find((e) => e.exit.id === "home_door")!.at);
  assert.deepEqual(Object.keys(p.places), ["home"], "the place left is remembered");
  assert.equal(p.progress!.sceneId, "the_job", "entering the village finished the morning scene's objectives and moved the story on");
  assert.ok(p.progress!.objectivesDone.includes("head_out"));
  assert.deepEqual(p.creatures, [], "nobody is in the village square");
  assert.equal(R.enterLocation(p, "no-such-place", { x: 1, y: 1 }), false, "a place the story does not have changes nothing");
  assert.equal(p.progress!.locationId, "village");
  // What the story did is waiting to be shown.
  assert.ok(p.adventurePending.some((r) => r.sceneChanged?.to === "the_job"));
  assert.ok(p.adventurePending.some((r) => r.completed.some((o) => o.id === "head_out")));
});

test("the tavern has Marta of the morning and Dunstan; once the goblin is dead it has Marta after the job instead", () => {
  const p = game();
  R.advApply(p, { type: "talk", npc: "tobin" });
  go(p, "to_village");
  go(p, "tavern_door");
  assert.deepEqual(p.creatures.map((c) => c.adv!.spawn).sort(), ["dunstan_by_the_fire", "marta_at_bar"]);
  assert.deepEqual(p.creatures.map((c) => c.npc?.name).sort(), ["Dunstan", "Marta Pell"]);
  // The goblin's death elsewhere changes who is behind the bar the next time the hero walks in.
  R.advApply(p, { type: "kill", spawn: "tunnel_goblin" });
  go(p, "to_square");
  go(p, "tavern_door");
  const spawns = p.creatures.map((c) => c.adv!.spawn).sort();
  assert.deepEqual(spawns, ["dunstan_by_the_fire", "marta_after_the_job"]);
  assert.equal(p.creatures.find((c) => c.adv!.spawn === "marta_after_the_job")!.adv!.npc, "marta_after");
});

test("the cellar stairs are bolted until Marta has been spoken to; the cellar holds five rats, three awake, with the instance ids the story counts", () => {
  const p = game();
  R.advApply(p, { type: "talk", npc: "tobin" });
  go(p, "to_village");
  go(p, "tavern_door");
  const stairs = R.exitsHere(p).find((e) => e.exit.id === "cellar_stairs")!;
  assert.equal(R.exitIsOpen(p, stairs.exit), false);
  assert.match(R.exitLockedWords(stairs.exit), /^The cellar door is bolted/);
  R.advApply(p, { type: "talk", npc: "marta" });
  assert.equal(R.exitIsOpen(p, stairs.exit), true);
  go(p, "cellar_stairs");
  assert.equal(p.progress!.sceneId, "the_cellar");
  assert.deepEqual(p.creatures.map((c) => c.id).sort(), ["cellar_giant_rat_north", "cellar_giant_rat_south", "cellar_rats_1", "cellar_rats_2", "cellar_rats_3"]);
  assert.deepEqual(p.creatures.filter((c) => c.awake).map((c) => c.id).sort(), ["cellar_rats_1", "cellar_rats_2", "cellar_rats_3"]);
  assert.ok(p.creatures.every((c) => c.hostile));
  assert.deepEqual(p.creatures.map((c) => c.token).sort(), ["token_giant_rat", "token_giant_rat", "token_rat", "token_rat", "token_rat"]);
  assert.deepEqual(p.creatures.filter((c) => c.token === "token_rat").map((c) => R.creatureName(p, c)).sort(), ["Rat 1", "Rat 2", "Rat 3"]);
  // Nobody shares a square with another or with the hero.
  const squares = new Set([...p.creatures.map((c) => `${c.at.x},${c.at.y}`), `${p.heroAt.x},${p.heroAt.y}`]);
  assert.equal(squares.size, 6);
  // The story's first cellar beat is waiting to be told.
  assert.ok(p.adventurePending.some((r) => r.fired.some((b) => b.id === "first_rat")));
});

test("a kill goes to the story by instance id; the last cellar creature finishes the objective, and the creatures of the next place are numbered afresh", () => {
  const p = game();
  toCellar(p);
  for (const c of [...p.creatures]) {
    assert.equal(p.progress!.objectivesDone.includes("clear_cellar"), false);
    R.slayCreature(p, c);
  }
  assert.deepEqual([...p.progress!.killed].sort(), ["cellar_giant_rat_north", "cellar_giant_rat_south", "cellar_rats_1", "cellar_rats_2", "cellar_rats_3"]);
  assert.ok(p.progress!.objectivesDone.includes("clear_cellar"));
  assert.ok(p.adventurePending.some((r) => r.fired.some((b) => b.id === "cellar_still")));
  assert.equal(p.bodies.length, 5, "each kill left its own body");
  // The tunnel is shut until the hole is found: both the flag and every cellar creature dead are the story's own conditions.
  const hole = R.exitsHere(p).find((e) => e.exit.id === "tunnel_hole")!;
  assert.equal(R.exitIsOpen(p, hole.exit), false);
  assert.match(R.exitLockedWords(hole.exit), /^There is only a heap of sacks/);
});

test("the heap of sacks is a feature to search; the cloth it gives, once in the pack, is told to the story: the flag, the objective, the open hole", () => {
  const p = game();
  toCellar(p);
  for (const c of [...p.creatures]) R.slayCreature(p, c);
  const board = R.advBoard(p)!;
  const at = board.featuresAt.sack_heap!;
  const heap = R.featureAtSquare(p, at)!;
  assert.equal(heap.id, "sack_heap");
  assert.equal(R.featureSearchable(heap), true);
  assert.equal(heap.searchDc, 10);
  assert.equal(R.featureIsFound(p, heap), false);
  const cloth = RAT.items.find((i) => i.id === "green_cloth")!;
  R.giveAdventureItem(p, cloth);
  assert.ok(p.hero.inventory.includes("Scrap of green cloth"));
  assert.equal(p.itemNotes["Scrap of green cloth"], cloth.description, "the item card says what the adventure says it is");
  assert.deepEqual(p.itemFlags["Scrap of green cloth"], { quest: true }, "a quest item cannot be dropped or destroyed");
  assert.equal(p.progress!.has.includes("green_cloth"), false, "the story has not heard of it yet");
  R.syncItems(p);
  assert.ok(p.progress!.has.includes("green_cloth"));
  assert.equal(p.progress!.flags.tunnel_found, true);
  assert.ok(p.progress!.objectivesDone.includes("find_way_in"));
  const hole = R.exitsHere(p).find((e) => e.exit.id === "tunnel_hole")!;
  assert.equal(R.exitIsOpen(p, hole.exit), true);
  // An item that leaves the pack is a loss.
  p.hero = { ...p.hero, inventory: [] };
  R.syncItems(p);
  assert.equal(p.progress!.has.includes("green_cloth"), false);
});

test("a creature the DM sent away does not come back when the place is read again", () => {
  const p = game();
  toCellar(p);
  const rat = p.creatures.find((c) => c.id === "cellar_rats_1")!;
  p.creatures = p.creatures.filter((c) => c !== rat);
  p.goneSpawns.push("cellar_rats_1");
  R.populateLocation(p);
  assert.equal(p.creatures.some((c) => c.id === "cellar_rats_1"), false);
  assert.equal(p.progress!.killed.includes("cellar_rats_1"), false, "it is not counted dead");
});

test("the places remember: leave the cellar and come back and the dead stay dead, who still sleeps sleeps, and what was seen is seen", () => {
  const p = game();
  toCellar(p);
  const before = p.creatures.find((c) => c.id === "cellar_rats_1")!;
  R.slayCreature(p, before);
  p.explored = Uint8Array.from(p.explored, () => 1);
  go(p, "stairs_up");
  assert.equal(p.progress!.locationId, "tavern");
  assert.equal(p.bodies.length, 0);
  assert.deepEqual(Object.keys(p.places).sort(), ["cellar", "home", "village"]);
  go(p, "cellar_stairs");
  assert.equal(p.bodies.length, 1);
  assert.deepEqual(p.creatures.map((c) => c.id).sort(), ["cellar_giant_rat_north", "cellar_giant_rat_south", "cellar_rats_2", "cellar_rats_3"]);
  assert.equal(p.explored.reduce((a, b) => a + b, 0) > 250, true, "what was explored is remembered");
  assert.equal(p.progress!.entered.filter((l) => l === "cellar").length, 1);
});

test("the tunnel's creatures are numbered within it: two Rats are Rat 1 and Rat 2 however many were in the cellar", () => {
  const p = game();
  toCellar(p);
  for (const c of [...p.creatures]) R.slayCreature(p, c);
  R.advApply(p, { type: "flag", flag: "tunnel_noticed" });
  assert.equal(p.progress!.flags.tunnel_found, true);
  go(p, "tunnel_hole");
  assert.equal(p.progress!.locationId, "tunnel");
  assert.equal(p.progress!.sceneId, "the_tunnel");
  const rats = p.creatures.filter((c) => c.token === "token_rat");
  assert.deepEqual(rats.map((c) => R.creatureName(p, c)).sort(), ["Rat 1", "Rat 2"]);
  const goblin = p.creatures.find((c) => c.token === "token_goblin")!;
  assert.deepEqual([goblin.hostile, goblin.awake, goblin.adv!.npc, goblin.npc], [true, false, "skrit", undefined]);
  assert.equal(R.creatureName(p, goblin), "Goblin");
});

// ---------------------------------------------------------------------------
// The Journal and saves

test("the Journal shows the adventure, the scene, its objectives with what is done, and the last beats oldest first", () => {
  const p = game();
  let j = R.journalFor(p)!;
  assert.equal(j.title, "The Rat Cellar");
  assert.equal(j.scene, "Morning at home");
  assert.deepEqual(j.objectives, [{ text: "Talk to your father", done: false }, { text: "Head out into the village", done: false }]);
  assert.equal(j.recent, undefined);
  toCellar(p);
  j = R.journalFor(p)!;
  assert.equal(j.scene, "The cellar");
  assert.deepEqual(j.objectives.map((o) => o.done), [false, false]);
  assert.equal(j.recent!.length, 1);
  assert.match(j.recent![0]!, /A rat sits in the middle of the floor/);
});

test("a save holds the adventure by id and the story, never the adventure's text, and puts the place, the people and the places left behind back", () => {
  const p = game("shadow");
  toCellar(p);
  R.slayCreature(p, p.creatures.find((c) => c.id === "cellar_rats_2")!);
  const snap = R.toSnapshot(p);
  const json = JSON.stringify(snap);
  assert.equal(snap.adventureId, "rat-cellar");
  assert.ok(!json.includes(RAT.summary.slice(0, 40)), "the adventure's summary is not in the save");
  assert.ok(!json.includes("Marta draws the bolt"), "no scene text is in the save");
  assert.ok(json.length < 100_000, `a save is small (${json.length} bytes)`);
  const back = JSON.parse(json);
  assert.equal(R.isSnapshot(back), true);
  const q = R.fromSnapshot(back)!;
  assert.equal(q.adventureId, "rat-cellar");
  assert.equal(q.progress!.locationId, "cellar");
  assert.deepEqual(q.progress, p.progress);
  assert.deepEqual(q.heroAt, p.heroAt);
  assert.deepEqual(q.creatures.map((c) => c.id), p.creatures.map((c) => c.id));
  assert.deepEqual(Object.keys(q.places).sort(), Object.keys(p.places).sort());
  assert.equal(q.bodies.length, 1);
  assert.deepEqual(q.adventurePending, [], "what was waiting to be shown is not saved");
  assert.notEqual(q.boardEpoch, p.boardEpoch, "a loaded board is a new board to every cache");
  assert.deepEqual(R.sceneTiles(q), R.sceneTiles(p), "the board is built again from the adventure");
  // The place left behind comes back too.
  go(q, "stairs_up");
  assert.equal(q.progress!.locationId, "tavern");
  assert.equal(q.creatures.length, 2);
});

test("a save of an adventure the bench does not have, or at another version of it, is refused instead of half read", () => {
  const p = game();
  const good = JSON.parse(JSON.stringify(R.toSnapshot(p)));
  assert.equal(R.isSnapshot(good), true);
  const gone = JSON.parse(JSON.stringify(good));
  gone.adventureId = "no-such-adventure";
  gone.progress.adventureId = "no-such-adventure";
  assert.equal(R.isSnapshot(gone), false);
  const older = JSON.parse(JSON.stringify(good));
  older.progress.version = RAT.version + 1;
  assert.equal(R.isSnapshot(older), false);
  const nowhere = JSON.parse(JSON.stringify(good));
  nowhere.progress.locationId = "nowhere";
  assert.equal(R.isSnapshot(nowhere), false);
  const brokenPlace = JSON.parse(JSON.stringify(good));
  brokenPlace.places = { home: { explored: "01" } };
  assert.equal(R.isSnapshot(brokenPlace), false);
});

test("the Template adventure starts too, with its own first place", () => {
  const tpl = R.benchAdventures().find((e) => e.file === "TEMPLATE.md")!.adventure!;
  const p = R.newAdventurePlay(tpl, R.adventureHero(tpl, KNIGHT));
  assert.equal(p.adventureId, tpl.id);
  assert.equal(p.progress!.locationId, tpl.start.locationId);
  assert.ok(R.sceneTiles(p).length > 0);
  assert.equal(R.currentLocation(p)!.id, tpl.start.locationId);
});

test("the owner's draft marks are what the overlay shows on the card", () => {
  const text = ADVENTURE_FILES.find((f) => f.file === "rat-cellar.md")!.text;
  assert.equal(R.benchAdventures().find((e) => e.file === "rat-cellar.md")!.draftMarks, markedForReview(text).length);
});

// ---------------------------------------------------------------------------
// The DM bound by the adventure (the view it is given, the effects the engine takes from it, the person it is told is speaking)

/** Down in the cellar, the way the story runs: Tobin and Marta spoken to, the stairs taken. */
function inCellar(): Play {
  const p = game();
  toCellar(p);
  return p;
}

test("a test room's DM view has no adventure at all, so its prompt is what it always was; an adventure's view has one", () => {
  const room = P.newPlay("fantasy", "knight" as never, "floor_stone" as never);
  assert.equal(R.dmViewFor(room).adventure, undefined);
  assert.equal(R.dmAdventureView(room), undefined);
  const view = R.dmViewFor(game());
  assert.ok(view.adventure);
  assert.equal(view.adventure!.title, "The Rat Cellar");
});

test("the DM's adventure view: the brief for this hero and moment, the steps it may take, the people on this board with their squares", () => {
  const p = game("knight");
  const v = R.dmAdventureView(p)!;
  assert.match(v.brief, /This adventure is gospel/);
  assert.match(v.brief, /The rats get into the cellar through a tunnel that a goblin dug/, "the truths");
  assert.match(v.brief, /strong back/, "the hook for a Knight");
  assert.match(v.brief, /DM ONLY secret/, "the secrets, marked");
  assert.ok(v.brief.length <= 5000, `the brief is held to its cap (${v.brief.length})`);
  assert.deepEqual(v.allowedSteps, [], "at home the story has nothing the DM may declare");
  const tobin = p.creatures.find((c) => c.adv?.npc === "tobin")!;
  assert.deepEqual(v.npcsHere, [{ id: "tobin", name: "Tobin Hale", at: { ...tobin.at } }]);
  const rogue = R.dmAdventureView(game("shadow"))!;
  assert.match(rogue.brief, /quick hands/, "another class is addressed by its own hook");
  assert.doesNotMatch(rogue.brief, /strong back/);
  const wizard = R.dmAdventureView(game("fireball-person"))!;
  assert.match(wizard.brief, /real talent with magic/);
});

test("in the cellar the one step the DM may take is the tunnel noticed; the people on the board are only who stands there", () => {
  const p = inCellar();
  const v = R.dmAdventureView(p)!;
  assert.deepEqual(v.allowedSteps, [{ kind: "flag", flag: "tunnel_noticed" }]);
  assert.deepEqual(v.npcsHere, [], "no person of the adventure is in the cellar");
  assert.match(v.brief, /Progress steps you may propose now/);
  assert.match(v.brief, /tunnel_noticed/);
  const tunnel = game();
  R.advApply(tunnel, { type: "flag", flag: "tunnel_noticed" });
  toCellar(tunnel);
  for (const id of ["cellar_rats_1", "cellar_rats_2", "cellar_rats_3", "cellar_giant_rat_north", "cellar_giant_rat_south"]) R.advApply(tunnel, { type: "kill", spawn: id });
  go(tunnel, "tunnel_hole");
  const tv = R.dmAdventureView(tunnel)!;
  assert.deepEqual(tv.npcsHere.map((n) => n.id), ["skrit"], "a hostile person is a person: the goblin is Skrit, and the DM may voice him");
  const view = R.dmViewFor(tunnel);
  assert.ok(view.monsters.some((m) => /^Skrit \(goblin\)$/.test(m.name)), "the monster list names him");
});

test("the item ids the DM may give are only the ones the story does not hand over itself (a search or a beat does that)", () => {
  assert.deepEqual(R.dmGivableItemIds(RAT), [], "the cloth is the sack heap's and the pay is a beat's: neither is the DM's to give");
  const withKey = { ...RAT, items: [...RAT.items, { id: "brass_key", name: "Brass key", description: "A small key." }] };
  assert.deepEqual(R.dmGivableItemIds(withKey), ["brass_key"]);
  assert.deepEqual(R.dmAdventureView(game())!.itemIds, []);
});

test("a DM progress step the adventure allows is taken by the engine; one it does not is refused in words and changes nothing", () => {
  const p = inCellar();
  const refused = R.applyWorldEffect(p, { type: "progress", step: { kind: "scene", id: "the_tunnel" } });
  assert.equal(refused.ok, false);
  assert.match((refused as { why: string }).why, /cannot go to "the_tunnel"|only when/);
  assert.equal(p.progress!.sceneId, "the_cellar");
  const flag = R.applyWorldEffect(p, { type: "progress", step: { kind: "flag", flag: "not_a_flag" } });
  assert.equal(flag.ok, false);
  assert.equal(p.progress!.flags.not_a_flag, undefined);
  const objective = R.applyWorldEffect(p, { type: "progress", step: { kind: "objective", id: "clear_cellar" } });
  assert.equal(objective.ok, false, "an objective the engine sees for itself (kills) cannot be declared");
  assert.match((objective as { why: string }).why, /finished by the story itself/);
  const ok = R.applyWorldEffect(p, { type: "progress", step: { kind: "flag", flag: "tunnel_noticed" } });
  assert.equal(ok.ok, true);
  assert.equal(p.progress!.flags.tunnel_noticed, true);
  assert.equal(p.progress!.flags.tunnel_found, true, "the beat that watches for it fired");
  assert.ok(p.progress!.objectivesDone.includes("find_way_in"));
  assert.ok(p.adventurePending.length > 0, "the panel plays what the story did");
  const room = P.newPlay("fantasy", "knight" as never, "floor_stone" as never);
  const none = R.applyWorldEffect(room, { type: "progress", step: { kind: "flag", flag: "x" } });
  assert.equal(none.ok, false, "a test room has no story to move");
});

test("a give by itemId hands over the adventure's own item with its own words and quest flag, and says no to an unknown id or one already held", () => {
  const p = inCellar();
  const given = R.applyWorldEffect(p, { type: "give", item: "green_cloth", itemId: "green_cloth" });
  assert.equal(given.ok, true);
  assert.ok(p.hero.inventory.includes("Scrap of green cloth"), "the adventure's name, not the id");
  assert.match(p.itemNotes["Scrap of green cloth"]!, /rough green cloth/);
  assert.equal(p.itemFlags["Scrap of green cloth"]?.quest, true);
  R.syncItems(p);
  assert.ok(p.progress!.has.includes("green_cloth"), "the story hears of it");
  const again = R.applyWorldEffect(p, { type: "give", item: "green_cloth", itemId: "green_cloth" });
  assert.equal(again.ok, false);
  const unknown = R.applyWorldEffect(p, { type: "give", item: "x", itemId: "excalibur" });
  assert.equal(unknown.ok, false);
  assert.match((unknown as { why: string }).why, /not an item of this adventure/);
});

test("the prompt carries the gospel block and, for a person the hero is speaking to, who they are; with nobody it is the same prompt", () => {
  const view = R.dmViewFor(game());
  const plain = buildDmInput(view, { kind: "freehand", text: "good morning" });
  assert.match(plain, /=== THE ADVENTURE \(GOSPEL\) ===/);
  assert.match(plain, /id=tobin /);
  assert.doesNotMatch(plain, /The hero is speaking to/);
  const spoken = buildDmInput(view, { kind: "freehand", text: "good morning", npc: { id: "tobin", name: "Tobin Hale" } });
  assert.match(spoken, /The hero is speaking to "Tobin Hale" \(id=tobin\)/);
  assert.match(spoken, /set "talkedTo" to their id/);
  assert.equal(spoken.replace(/\nThe hero is speaking to [^\n]*/, ""), plain, "only that line is added");
});

test("talkedTo is checked against the people standing on the board, and the reply carries it to the story", () => {
  const p = game();
  const ctx = validationContextFor(R.dmViewFor(p));
  assert.deepEqual(ctx.adventure!.npcIds, ["tobin"]);
  const ok = validateDmReply({ narration: "He nods.", cost: "free", effects: [], talkedTo: "tobin" }, ctx);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.reply.talkedTo, "tobin");
  const away = validateDmReply({ narration: "She waves.", cost: "free", effects: [], talkedTo: "marta" }, ctx);
  assert.equal(away.ok, false, "Marta is not in the workshop");
});
