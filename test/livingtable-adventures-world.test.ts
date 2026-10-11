/**
 * Tests for the world clock (adventures/progress.ts, markdown.ts, validate.ts,
 * brief.ts): days that pass when the hero sleeps, the "it is day N or later"
 * condition, and the ## World section, whose beats fire whatever scene the
 * story is in and whose ways out are taken from anywhere.
 *
 * The fixture is the Template adventure with a defeat scene and a World added:
 * a rumour on day 2, and on day 3 the goblin flees with the stock unless the
 * storeroom has been barred, which ends the story in defeat from any scene.
 *
 * The Journal's day and a rest in the running game are checked through The
 * Quiet Under Blackstone, which ships in the catalog and keeps time
 * (test/livingtable-adventure-blackstone.test.ts).
 *
 * Run: npx -y tsx --test test/livingtable-adventures-world.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONDITION_PHRASES, adventureToMarkdown, parseAdventureMarkdown, parseConditionPhrase, type ConditionContext } from "../src/games/livingtable/adventures/markdown";
import { adventureKeepsTime, applyEvent, dmSettableFlags, evaluate, settleProgress, startProgress } from "../src/games/livingtable/adventures/progress";
import { validateAdventure } from "../src/games/livingtable/adventures/validate";
import { adventureBrief } from "../src/games/livingtable/adventures/brief";
import { dayOf, type Adventure, type AdventureEvent, type AdventureProgress } from "../src/games/livingtable/adventures/types";
import { gameAssets } from "../scripts/adventures/check";
const TEMPLATE = readFileSync(new URL("../adventures/TEMPLATE.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const WORLD = `
## Scene: Too late

- id: too_late

> The storeroom stands empty.

### Ending

- outcome: defeat

> The goblin is long gone, and Hobb's stock with it.

## World

### Beat: rumour

- when: it is day 2 or later
- sets flag: rumour_heard

> Word comes down the lane that something in Hobb's storeroom has been busy all night.

### Beat: goblin_flees

- when: it is day 3 or later and the flag storeroom_barred is not set
- sets flag: goblin_fled

> In the small hours the goblin slips out with everything it can carry.

### Next

- Too late when the flag goblin_fled is set
`;

function parse(text: string): Adventure {
  const r = parseAdventureMarkdown(text, { file: "world.md" });
  assert.deepEqual(r.errors, [], "the fixture parses");
  return r.adventure!;
}

const A = parse(TEMPLATE + WORLD);

function play(p: AdventureProgress, ...events: AdventureEvent[]): AdventureProgress {
  for (const e of events) p = applyEvent(A, p, e).progress;
  return p;
}

const fresh = (): AdventureProgress => settleProgress(A, startProgress(A)).progress;

// ---------------------------------------------------------------------------
// The condition

const CTX: ConditionContext = { locations: [], npcs: [], items: [], objectives: [] };

test("'it is day N or later' reads as a day condition, and is one of the documented phrasings", () => {
  assert.deepEqual(parseConditionPhrase("it is day 3 or later", CTX), { day: 3 });
  assert.deepEqual(parseConditionPhrase("not it is day 3 or later", CTX), { not: { day: 3 } });
  assert.deepEqual(parseConditionPhrase("it is day 2 or later and the flag x is set", CTX), { all: [{ day: 2 }, { flag: "x" }] });
  assert.ok(CONDITION_PHRASES.includes("it is day N or later"));
});

test("a day written without 'or later', or as nothing like a day, is refused with what to write instead", () => {
  assert.throws(() => parseConditionPhrase("it is day 3", CTX), /write "it is day 3 or later"/);
  assert.throws(() => parseConditionPhrase("it is day 0 or later", CTX), /whole number from 1/);
  assert.throws(() => parseConditionPhrase("it is day three or later", CTX), /whole number from 1/);
});

test("days start at 1 and only a rest moves them on; a game saved before days existed reads as day 1", () => {
  assert.equal(dayOf(fresh()), 1);
  assert.equal(dayOf(play(fresh(), { type: "talk", npc: "hobb" })), 1);
  assert.equal(dayOf(play(fresh(), { type: "rest" }, { type: "rest" })), 3);
  const old = { ...fresh() };
  delete old.day;
  assert.equal(dayOf(old), 1);
  assert.equal(evaluate(A, old, { day: 1 }), true);
  assert.equal(evaluate(A, old, { day: 2 }), false);
  assert.equal(dayOf(play(old, { type: "rest" })), 2);
});

// ---------------------------------------------------------------------------
// The World section

test("## World parses into beats and ways out, and the checker finds nothing wrong with it", () => {
  assert.deepEqual(A.world!.beats.map((b) => b.id), ["rumour", "goblin_flees"]);
  assert.deepEqual(A.world!.next, [{ scene: "too_late", when: { flag: "goblin_fled" } }]);
  const { errors } = validateAdventure(A, gameAssets());
  assert.deepEqual(errors, []);
});

test("an adventure with a World writes back out to the same adventure", () => {
  assert.deepEqual(parse(adventureToMarkdown(A)), A);
  assert.equal(parse(TEMPLATE).world, undefined, "no World section, no world");
  assert.doesNotMatch(adventureToMarkdown(parse(TEMPLATE)), /## World/);
});

test("the world's beats fire on their day whatever scene the story is in", () => {
  let p = fresh();
  assert.equal(p.sceneId, "trouble");
  const r = applyEvent(A, p, { type: "rest" });
  assert.deepEqual(r.fired.map((b) => b.id), ["rumour"]);
  assert.equal(r.progress.flags.rumour_heard, true);
  p = r.progress;
  assert.deepEqual(applyEvent(A, p, { type: "talk", npc: "hobb" }).fired, [], "a world beat fires once");
});

test("a clock that runs out ends the story from any scene", () => {
  const r = applyEvent(A, play(fresh(), { type: "rest" }), { type: "rest" });
  assert.deepEqual(r.fired.map((b) => b.id), ["goblin_flees"]);
  assert.deepEqual(r.sceneChanged, { from: "trouble", to: "too_late", opening: "The storeroom stands empty." });
  assert.equal(r.progress.ended, "defeat");
});

test("what the player does first can stop the clock: a barred storeroom keeps the goblin in", () => {
  const p = fresh();
  assert.ok(dmSettableFlags(A, p).includes("storeroom_barred"), "the world's judgment calls are the DM's to declare in any scene");
  const barred = applyEvent(A, p, { type: "dm", step: { kind: "flag", flag: "storeroom_barred" } });
  assert.equal(barred.refused, undefined);
  const later = play(barred.progress, { type: "rest" }, { type: "rest" }, { type: "rest" });
  assert.equal(later.ended, undefined);
  assert.equal(later.sceneId, "trouble");
  assert.equal(later.flags.goblin_fled, undefined);
});

test("a world beat's own flag is the story's machinery, never the DM's to declare", () => {
  assert.ok(!dmSettableFlags(A, fresh()).includes("goblin_fled"));
  assert.ok(applyEvent(A, fresh(), { type: "dm", step: { kind: "flag", flag: "goblin_fled" } }).refused);
});

test("a world way out to the scene already in play is no move, and the story still settles", () => {
  const loop = parse(TEMPLATE + WORLD.replace("- Too late when the flag goblin_fled is set", "- Hobb's trouble when always"));
  const r = settleProgress(loop, startProgress(loop));
  assert.equal(r.sceneChanged, undefined);
  assert.equal(r.progress.sceneId, "trouble");
});

// ---------------------------------------------------------------------------
// Checking

test("the checker refuses a day before day 1, a world way out to nowhere, and a beat id used twice across a scene and the world", () => {
  const bad = structuredClone(A);
  bad.world!.beats[0]!.when = { day: 0 };
  bad.world!.next[0]!.scene = "nowhere";
  bad.world!.beats[1]!.id = "goblin_down";
  const { errors } = validateAdventure(bad, gameAssets());
  assert.ok(errors.some((e) => e.path === "world.beats.rumour.when" && /whole number from 1/.test(e.message)));
  assert.ok(errors.some((e) => e.path === "world.next[0].scene" && /"nowhere" is not a scene/.test(e.message)));
  assert.ok(errors.some((e) => /Two beats share the id "goblin_down"/.test(e.message)));
});

test("a scene reached only by the world's way out is not reported as unreachable", () => {
  const { warnings } = validateAdventure(A, gameAssets());
  assert.ok(!warnings.some((w) => w.path === "scenes.too_late" && /No path/.test(w.message)));
});

test("## World takes only beats and a Next, once", () => {
  const twice = parseAdventureMarkdown(TEMPLATE + WORLD + "\n## World\n", { file: "w.md" });
  assert.ok(twice.errors.some((e) => /appears twice/.test(e.message)));
  const objective = parseAdventureMarkdown(TEMPLATE + WORLD + "\n### Objective: Win\n\n- done when: always\n", { file: "w.md" });
  assert.ok(objective.errors.some((e) => /is not a sub-section of ## World/.test(e.message)));
  const words = parseAdventureMarkdown(TEMPLATE + "\n## World\n\nThe goblin is restless.\n", { file: "w.md" });
  assert.ok(words.errors.some((e) => /## World holds only/.test(e.message)));
});

// ---------------------------------------------------------------------------
// What the DM and the player see

test("the DM is told the day and what the world does next, marked DM ONLY, and a beat that has fired drops off", () => {
  const day1 = adventureBrief(A, fresh());
  assert.match(day1, /It is day 1 of the adventure\. A day passes each time the hero sleeps\./);
  assert.match(day1, /DM ONLY, what the world does next unless the party stops it/);
  assert.match(day1, /- once it is day 2 or later: Word comes down the lane/);
  assert.match(day1, /- once it is day 3 or later and not \(the story declares "storeroom_barred"\): In the small hours/);
  const day2 = adventureBrief(A, play(fresh(), { type: "rest" }));
  assert.match(day2, /It is day 2 of the adventure/);
  assert.doesNotMatch(day2, /Word comes down the lane/);
});

test("an adventure that never looks at the day says nothing about days", () => {
  const plain = parse(TEMPLATE);
  assert.equal(adventureKeepsTime(plain), false);
  assert.doesNotMatch(adventureBrief(plain, settleProgress(plain, startProgress(plain)).progress), /It is day/);
  assert.equal(adventureKeepsTime(A), true);
});

test("a creature a world beat brings in is absent until that beat fires, like one a scene beat brings in", async () => {
  const { spawnIsPresent } = await import("../src/games/livingtable/adventures/validate");
  const withSpawn = parse(
    (TEMPLATE + WORLD)
      .replace("- sets flag: goblin_fled\n", "- sets flag: goblin_fled\n- spawns: goblin\n")
      .replace("### Spawn: goblin\n", "### Spawn: goblin\n"),
  );
  const goblin = withSpawn.locations.flatMap((l) => l.spawns).find((s) => s.id === "goblin")!;
  const start = settleProgress(withSpawn, startProgress(withSpawn)).progress;
  assert.equal(spawnIsPresent(withSpawn, start, goblin), false, "named by the world's goblin_flees beat, so not there yet");
  const later = applyEvent(withSpawn, applyEvent(withSpawn, start, { type: "rest" }).progress, { type: "rest" }).progress;
  assert.ok(later.spawned.includes("goblin"));
  assert.equal(spawnIsPresent(withSpawn, later, goblin), true);
});
