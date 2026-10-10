/**
 * Tests for "The Quiet Under Blackstone" (adventures/blackstone.md), the first
 * adventure that keeps time: a three-act campaign whose villain moves day by day
 * in its ## World section, whether or not the party does anything.
 *
 * What must never drift: the file reads and checks clean; each of the four
 * endings can be reached by events alone; the clock ends the story if nobody
 * stops it, cutting off the silver buys three days, and stopping Corvane stops
 * it; the DM can only declare what the story names, never skip an act; the
 * hidden truths reach the DM marked DM ONLY; and the Journal shows the day in
 * the running game, moving on when the hero sleeps.
 *
 * Run: npx -y tsx --test test/livingtable-adventure-blackstone.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adventureToMarkdown, parseAdventureMarkdown } from "../src/games/livingtable/adventures/markdown";
import { adventureBrief, applyEvent, dmSettableFlags, settleProgress, startProgress, validateAdventure } from "../src/games/livingtable/adventures";
import type { Adventure, AdventureEvent, AdventureProgress, AdventureStepResult } from "../src/games/livingtable/adventures";
import { dayOf } from "../src/games/livingtable/adventures/types";
import { gameAssets } from "../scripts/adventures/check";
import { SPRITES as FANTASY } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI } from "../scripts/assets/scifi";
import { ADVENTURE_FILES } from "../src/games/livingtable/table/adventures/data";
import { adventureById, adventureHero, bindAdventures, unbindAdventures } from "../src/games/livingtable/table/adventureCatalog";
import { advApply, journalFor, newAdventurePlay } from "../src/games/livingtable/table/adventureRun";
import { bindCatalog, unbindCatalog } from "../src/games/livingtable/table/catalog";
import { createMemoryHost } from "../src/games/livingtable/table/hostDefault";

const TEXT = readFileSync(new URL("../adventures/blackstone.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function load(): Adventure {
  const r = parseAdventureMarkdown(TEXT, { file: "adventures/blackstone.md" });
  assert.deepEqual(r.errors, [], r.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  return r.adventure!;
}

const A = load();

function step(p: AdventureProgress, e: AdventureEvent): AdventureStepResult {
  const r = applyEvent(A, p, e);
  assert.equal(r.refused, undefined, `the engine refused ${JSON.stringify(e)}: ${r.refused}`);
  return r;
}

function play(events: AdventureEvent[], from: AdventureProgress = settleProgress(A, startProgress(A)).progress): AdventureProgress {
  let p = from;
  for (const e of events) p = step(p, e).progress;
  return p;
}

const talk = (npc: string): AdventureEvent => ({ type: "talk", npc });
const gain = (item: string): AdventureEvent => ({ type: "gain", item });
const enter = (location: string): AdventureEvent => ({ type: "enter", location });
const kill = (spawn: string): AdventureEvent => ({ type: "kill", spawn });
const declare = (flag: string): AdventureEvent => ({ type: "dm", step: { kind: "flag", flag } });
const rest = (n: number): AdventureEvent[] => Array.from({ length: n }, () => ({ type: "rest" }) as AdventureEvent);

/** Act I and Act II the quick way, all on the first day: the ledger, Hobb's word, the purse, the barrow mouth. */
const TO_ACT_THREE: AdventureEvent[] = [
  talk("grukka"),
  gain("tithe_ledger"),
  declare("hobb_told"),
  gain("archive_purse"),
  declare("barrow_mouth_found"),
  enter("tomb"),
];

// ---------------------------------------------------------------------------
// The file reads and checks

test("blackstone.md parses, checks clean against the game's real art and creatures, and writes back out the same", () => {
  assert.equal(A.id, "blackstone");
  assert.equal(A.title, "The Quiet Under Blackstone");
  const v = validateAdventure(A, gameAssets());
  assert.deepEqual(v.errors, [], v.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  assert.deepEqual(v.warnings, [], v.warnings.map((w) => `${w.path}: ${w.message}`).join("\n"));
  assert.deepEqual(parseAdventureMarkdown(adventureToMarkdown(A)).adventure, A);
});

test("the file has no em dash or en dash", () => {
  const bad = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  assert.equal(bad.test(TEXT), false);
});

test("three acts and four endings, and the clock is in the World", () => {
  assert.deepEqual(A.scenes.map((s) => s.id), ["act_one", "act_two", "act_three", "end_cold_crown", "end_dawn", "end_quiet_ridge", "end_king_wakes"]);
  const outcomes = Object.fromEntries(A.scenes.filter((s) => s.ending).map((s) => [s.id, s.ending!.outcome]));
  assert.deepEqual(outcomes, { end_cold_crown: "defeat", end_dawn: "victory", end_quiet_ridge: "victory", end_king_wakes: "defeat" });
  assert.deepEqual(A.world!.next, [{ scene: "end_king_wakes", when: { flag: "king_woken" } }]);
});

// ---------------------------------------------------------------------------
// The endings, by events alone

test("the story moves through the three acts in order", () => {
  let p = settleProgress(A, startProgress(A)).progress;
  const moves: string[] = [];
  for (const e of TO_ACT_THREE) {
    const r = step(p, e);
    if (r.sceneChanged) moves.push(`${r.sceneChanged.from}>${r.sceneChanged.to}`);
    p = r.progress;
  }
  assert.deepEqual(moves, ["act_one>act_two", "act_two>act_three"]);
  assert.ok(p.objectivesDone.includes("reach_tomb"));
  assert.equal(dayOf(p), 1);
});

test("Dawn over Blackstone: the Quiet Bell rung in the tomb puts the king to rest", () => {
  const p = play([...TO_ACT_THREE, declare("bell_rung_in_tomb"), declare("tomb_quiet")]);
  assert.equal(p.sceneId, "end_dawn");
  assert.equal(p.ended, "victory");
});

test("A Quiet Ridge: the lantern snuffed, or Corvane brought down, and the king left crowned", () => {
  const snuffed = play([...TO_ACT_THREE, declare("lantern_snuffed"), declare("tomb_quiet")]);
  assert.equal(snuffed.sceneId, "end_quiet_ridge");
  assert.equal(snuffed.ended, "victory");
  const slain = play([...TO_ACT_THREE, kill("corvane_tomb"), declare("tomb_quiet")]);
  assert.equal(slain.sceneId, "end_quiet_ridge");
});

test("The Cold Crown: a hero who puts the crown on is the next unburied king, even with the king at rest", () => {
  const p = play([...TO_ACT_THREE, declare("bell_rung_in_tomb"), declare("player_takes_crown"), declare("tomb_quiet")]);
  assert.equal(p.sceneId, "end_cold_crown");
  assert.equal(p.ended, "defeat");
});

test("the tomb is not over until the DM says the moment has passed", () => {
  const p = play([...TO_ACT_THREE, declare("bell_rung_in_tomb")]);
  assert.equal(p.sceneId, "act_three");
  assert.equal(p.ended, undefined);
});

// ---------------------------------------------------------------------------
// The villain's clock

test("if nobody does anything, the dead walk on day 2, the lantern burns on day 4, the door breaks on day 6 and the king wakes on day 9", () => {
  let p = settleProgress(A, startProgress(A)).progress;
  const firedOn: Record<string, number> = {};
  for (let i = 0; i < 8; i++) {
    const r = step(p, { type: "rest" });
    for (const b of r.fired) firedOn[b.id] = dayOf(r.progress);
    p = r.progress;
  }
  assert.deepEqual(firedOn, { ridge_walkers: 2, something_below: 2, lantern_finished: 4, door_breaks: 6, king_wakes: 9 });
  assert.equal(p.sceneId, "end_king_wakes");
  assert.equal(p.ended, "defeat");
  assert.ok(p.spawned.includes("ridge_dead") && p.spawned.includes("square_dead"), "the dead are on the ridge and in the square");
});

test("cutting off the silver buys three days: the lantern on day 7, the door on day 9, the king on day 12", () => {
  let p = play([declare("silver_cut_off")]);
  const firedOn: Record<string, number> = {};
  for (let i = 0; i < 11; i++) {
    const r = step(p, { type: "rest" });
    for (const b of r.fired) firedOn[b.id] = dayOf(r.progress);
    p = r.progress;
  }
  assert.deepEqual(firedOn, { ridge_walkers: 2, something_below: 2, silver_taken: 7, door_breaks_late: 9, king_wakes_late: 12 });
  assert.equal(p.ended, "defeat");
});

test("holding the Deep Door keeps the dead out of the village, but does not stop the king", () => {
  const atActTwo = play(TO_ACT_THREE.slice(0, 4));
  assert.equal(atActTwo.sceneId, "act_two");
  const p = play([declare("deep_door_held"), ...rest(5)], atActTwo);
  assert.equal(dayOf(p), 6);
  assert.equal(p.flags.door_broken, undefined);
  assert.ok(!p.spawned.includes("square_dead"));
  assert.equal(play(rest(3), p).ended, "defeat", "the king still wakes on day 9");
});

test("stopping Corvane stops the clock", () => {
  const p = play([...TO_ACT_THREE, kill("corvane_tomb"), ...rest(12)]);
  assert.equal(dayOf(p), 13);
  assert.equal(p.ended, undefined);
  assert.equal(p.flags.king_woken, undefined);
  assert.equal(p.sceneId, "act_three");
});

// ---------------------------------------------------------------------------
// What the DM may do and is told

test("the DM can only declare what the story names: no act skipped, no ending forced, no clock moved", () => {
  const start = settleProgress(A, startProgress(A)).progress;
  for (const flag of ["tomb_quiet", "king_woken", "lantern_finished", "mayor_involved", "lamplighter_named", "barrow_way_found", "corvane_stopped"]) {
    assert.ok(applyEvent(A, start, declare(flag)).refused, `the DM must not declare ${flag} in Act I`);
  }
  for (const s of ["act_two", "act_three", "end_dawn"]) {
    assert.ok(applyEvent(A, start, { type: "dm", step: { kind: "scene", id: s } }).refused, `the DM must not move to ${s}`);
  }
  // The world's own judgment calls are open in any act.
  for (const flag of ["silver_cut_off", "deep_door_held"]) assert.ok(dmSettableFlags(A, start).includes(flag), flag);
});

test("the hidden truths reach the DM marked DM ONLY, with the day and what the world does next", () => {
  for (const t of A.truths) {
    if (/Corvane|Lamplighter|Deep Door|Quiet Bell|Ember Crown/.test(t)) assert.match(t, /^DM ONLY: /, t);
  }
  const brief = adventureBrief(A, settleProgress(A, startProgress(A)).progress, { chassis: "fighter" });
  assert.match(brief, /It is day 1 of the adventure/);
  assert.match(brief, /DM ONLY, what the world does next/);
  assert.match(brief, /- once it is day 2 or later: A shepherd comes running/);
});

// ---------------------------------------------------------------------------
// In the running game

let unbindArt = () => {};
let unbindAdv = () => {};
after(() => {
  unbindAdv();
  unbindArt();
  unbindAdventures();
  unbindCatalog();
});

test("Blackstone ships in the catalog, and its Journal shows the day, which moves on when the hero sleeps", () => {
  const host = createMemoryHost({ sprites: { fantasy: FANTASY as never, scifi: SCIFI as never }, adventures: ADVENTURE_FILES });
  unbindArt = bindCatalog(host.art);
  unbindAdv = bindAdventures(host);
  const a = adventureById("blackstone")!;
  assert.ok(a, "blackstone is in the catalog");
  const p = newAdventurePlay(a, adventureHero(a, "knight" as never));
  assert.equal(journalFor(p)!.day, 1);
  assert.equal(journalFor(p)!.scene, "Act I: Something Is Wrong in Blackstone");
  advApply(p, { type: "rest" });
  assert.equal(journalFor(p)!.day, 2);
  assert.ok(p.progress!.flags.dead_seen_on_ridge, "the shepherd's news came with the morning");
  // An adventure that never looks at the day shows none.
  const rat = adventureById("rat-cellar")!;
  assert.equal(journalFor(newAdventurePlay(rat, adventureHero(rat, "knight" as never)))!.day, undefined);
});
