/**
 * Tests for the first adventure, "The Rat Cellar" (adventures/rat-cellar.md).
 *
 * The file is the owner's gospel, drafted from the owner's outline: these tests
 * hold the parts of it that must never drift. It parses and validates against the
 * game's real art and creatures, the story can be played from the first morning to
 * the victory ending by events alone, the DM can move nothing but one judgment flag,
 * every class gets a hook and a kit with no armor, the rooms are laid out as the
 * balance note in the file describes, and every addition is marked for review.
 *
 * Run: npx -y tsx --test test/livingtable-adventure-rat-cellar.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adventureToMarkdown, markedForReview, parseAdventureMarkdown } from "../src/games/livingtable/adventures/markdown";
import {
  adventureBrief,
  allowedDmSteps,
  applyEvent,
  evaluate,
  exitDestination,
  heroHook,
  locationLayout,
  locationOf,
  sceneOf,
  spawnInstanceIds,
  startProgress,
  startingKitFor,
  validateAdventure,
  type Adventure,
  type AdventureEvent,
  type AdventureProgress,
  type AdventureStepResult,
  type Condition,
} from "../src/games/livingtable/adventures";
import { gameAssets } from "../scripts/adventures/check";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world";

const TEXT = readFileSync(new URL("../adventures/rat-cellar.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ASSETS = gameAssets();
const WALK = new Set(ASSETS.walkableTiles);
const BLOCK = new Set(ASSETS.blockingProps);

function load(): Adventure {
  const r = parseAdventureMarkdown(TEXT, { file: "adventures/rat-cellar.md" });
  assert.deepEqual(r.errors, [], r.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  assert.ok(r.adventure);
  return r.adventure!;
}

const A = load();

/**
 * validateAdventure has a known bug in its scene and location reachability walks
 * (it calls queue.shift() inside the predicate of Array.find, so the queue is eaten
 * and everything past the second scene or location is reported as unreachable).
 * Those two warnings are not about this file: the test computes the reachability
 * itself below, and fails on any other warning.
 */
const KNOWN_VALIDATOR_NOISE = /^(No path of scene transitions from the first scene ever reaches this scene\.|No chain of exits from the start location ever leads here\.)$/;

function step(a: Adventure, p: AdventureProgress, e: AdventureEvent): AdventureStepResult {
  const r = applyEvent(a, p, e);
  assert.equal(r.refused, undefined, `the engine refused ${JSON.stringify(e)}: ${r.refused}`);
  return r;
}

/** Plays a list of events in order and returns every result. */
function play(a: Adventure, events: AdventureEvent[], from: AdventureProgress = startProgress(a)): { final: AdventureProgress; results: AdventureStepResult[] } {
  let p = from;
  const results: AdventureStepResult[] = [];
  for (const e of events) {
    const r = step(a, p, e);
    results.push(r);
    p = r.progress;
  }
  return { final: p, results };
}

const enter = (location: string): AdventureEvent => ({ type: "enter", location });
const kill = (spawn: string): AdventureEvent => ({ type: "kill", spawn });
const talk = (npc: string): AdventureEvent => ({ type: "talk", npc });
const gain = (item: string): AdventureEvent => ({ type: "gain", item });

/** The whole first mission, in the order the outline tells it. */
const THE_FIRST_MISSION: AdventureEvent[] = [
  talk("tobin"),
  enter("village"),
  enter("tavern"),
  talk("marta"),
  enter("cellar"),
  kill("cellar_rats"),
  kill("cellar_rats"),
  kill("cellar_rats"),
  kill("cellar_giant_rat_north"),
  kill("cellar_giant_rat_south"),
  gain("green_cloth"),
  enter("tunnel"),
  kill("tunnel_rats"),
  kill("tunnel_rats"),
  kill("tunnel_goblin"),
  enter("cellar"),
  enter("tavern"),
  talk("marta_after"),
];

// ---------------------------------------------------------------------------
// The file reads and checks

test("rat-cellar.md parses with no errors", () => {
  const r = parseAdventureMarkdown(TEXT);
  assert.deepEqual(r.errors, []);
  assert.ok(r.adventure);
  assert.equal(r.adventure!.id, "rat-cellar");
  assert.equal(r.adventure!.title, "The Rat Cellar");
  assert.equal(r.adventure!.author, "owner");
  assert.deepEqual(r.warnings, [], "the reader has nothing to say about this file");
});

test("rat-cellar.md validates against the game's real art and creatures", () => {
  const v = validateAdventure(A, ASSETS);
  assert.deepEqual(v.errors, [], v.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  const other = v.warnings.filter((w) => !KNOWN_VALIDATOR_NOISE.test(w.message));
  assert.deepEqual(other, [], other.map((w) => `${w.path}: ${w.message}`).join("\n"));
});

test("every scene and every place can be reached from the start (computed here, past the validator's reachability bug)", () => {
  const scenes = new Set([A.start.sceneId]);
  for (const queue = [A.start.sceneId]; queue.length > 0; ) {
    const cur = sceneOf(A, queue.shift()!)!;
    for (const n of cur.next) if (!scenes.has(n.scene)) {
      scenes.add(n.scene);
      queue.push(n.scene);
    }
  }
  assert.deepEqual([...scenes].sort(), A.scenes.map((s) => s.id).sort());

  const places = new Set([A.start.locationId]);
  for (const queue = [A.start.locationId]; queue.length > 0; ) {
    const cur = locationOf(A, queue.shift()!)!;
    for (const e of cur.exits) if (!places.has(e.to)) {
      places.add(e.to);
      queue.push(e.to);
    }
  }
  assert.deepEqual([...places].sort(), A.locations.map((l) => l.id).sort());
});

test("round trip: the writer's output reads back as the same adventure", () => {
  const again = parseAdventureMarkdown(adventureToMarkdown(A));
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.adventure, A);
});

test("the file has no em dash or en dash", () => {
  const bad = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  assert.equal(bad.test(TEXT), false);
});

// ---------------------------------------------------------------------------
// The outline is the spine

test("the outline is in the file: village, apprentice, extra jobs, the tavern's basement, the goblin's tunnel", () => {
  const all = [A.summary, ...A.truths, ...Object.values(A.hooks)].join(" ").toLowerCase();
  for (const phrase of ["small village", "apprentice", "father", "jobs on the side", "basement", "tunnel", "goblin", "leading the rats", "first mission", "no armor"]) {
    assert.ok(all.includes(phrase), `the summary, truths and hooks never say "${phrase}"`);
  }
  // The story opens at home, in the first scene, on the hero's start square.
  assert.equal(A.start.locationId, "home");
  assert.equal(A.start.sceneId, "morning");
  assert.match(sceneOf(A, "morning")!.opening ?? "", /wake|morning/i);
});

test("every class gets a hook, and the hooks follow the outline", () => {
  const fighter = heroHook(A, "fighter")!;
  const rogue = heroHook(A, "rogue")!;
  const wizard = heroHook(A, "wizard")!;
  assert.match(fighter, /strong/i, "the Knight is known for brawn");
  assert.match(wizard, /magic/i, "the Fireball Person is known for magic talent");
  assert.match(rogue, /quick hands/i, "the Shadow is known for quick hands (an addition)");
  for (const h of [fighter, rogue, wizard, heroHook(A, "cleric")!, heroHook(A)!]) assert.match(h, /apprentice to your father/i);
  assert.equal(new Set([fighter, rogue, wizard]).size, 3, "three different hooks");
});

test("every class gets a kit: one plain weapon, no armor, no potions, no pack", () => {
  const weapons = { fighter: /sword/, rogue: /dagger/, wizard: /staff/ } as const;
  for (const c of ["fighter", "rogue", "wizard"] as const) {
    const kit = startingKitFor(A, c)!;
    assert.ok(kit, `${c} has a kit`);
    assert.equal(kit.armor, "none");
    assert.equal(kit.potions, 0);
    assert.deepEqual(kit.items, []);
    assert.match(kit.weaponNote ?? "", weapons[c]);
  }
  // A class the adventure does not name (the Healer) falls back to a default that also wears nothing.
  const fallback = startingKitFor(A, "cleric")!;
  assert.equal(fallback.armor, "none");
  assert.equal(fallback.potions, 0);
  assert.deepEqual(fallback.items, []);
  // Nothing in the story hands out armor or a potion.
  for (const it of A.items) assert.doesNotMatch(`${it.name} ${it.description}`, /armou?r|mail|shield|potion|draught/i);
});

// ---------------------------------------------------------------------------
// Played through by events alone

test("the first mission plays from the morning at home to the victory ending", () => {
  const { final, results } = play(A, THE_FIRST_MISSION);
  const last = results[results.length - 1]!;
  assert.deepEqual(last.ended, A.scenes.find((s) => s.id === "a_small_start")!.ending);
  assert.equal(last.ended!.outcome, "victory");
  assert.equal(final.ended, "victory");
  assert.equal(final.sceneId, "a_small_start");
  assert.ok(final.has.includes("marta_pay"), "Marta pays");
  assert.ok(final.has.includes("green_cloth"));
  // Every objective of the five working scenes was ticked off.
  for (const s of A.scenes) for (const o of s.objectives) assert.ok(final.objectivesDone.includes(o.id), `objective ${o.id}`);
  // Every beat fired exactly once.
  for (const s of A.scenes) for (const b of s.beats) assert.equal(final.beatsFired.filter((x) => x === b.id).length, 1, `beat ${b.id}`);
  // The adventure is over: nothing more is accepted.
  assert.match(applyEvent(A, final, talk("tobin")).refused ?? "", /over/i);
});

test("the story moves through the scenes in order, with the opening of each", () => {
  const { results } = play(A, THE_FIRST_MISSION);
  const moves = results.filter((r) => r.sceneChanged).map((r) => `${r.sceneChanged!.from}>${r.sceneChanged!.to}`);
  assert.deepEqual(moves, ["morning>the_job", "the_job>the_cellar", "the_cellar>the_tunnel", "the_tunnel>back_at_the_kettle", "back_at_the_kettle>a_small_start"]);
  for (const r of results) if (r.sceneChanged) assert.equal(r.sceneChanged.opening, sceneOf(A, r.sceneChanged.to)!.opening);
});

test("the doors are shut until the story earns them", () => {
  const cond = (loc: string, exit: string): Condition => locationOf(A, loc)!.exits.find((e) => e.id === exit)!.requires!;
  let p = startProgress(A);
  // Home: the front door waits for a word with your father.
  assert.equal(evaluate(A, p, cond("home", "to_village")), false);
  p = step(A, p, talk("tobin")).progress;
  assert.equal(evaluate(A, p, cond("home", "to_village")), true);
  // The tavern: the cellar stairs wait for Marta.
  p = step(A, p, enter("village")).progress;
  p = step(A, p, enter("tavern")).progress;
  assert.equal(evaluate(A, p, cond("tavern", "cellar_stairs")), false);
  p = step(A, p, talk("marta")).progress;
  assert.equal(evaluate(A, p, cond("tavern", "cellar_stairs")), true);
  // The cellar: the tunnel needs both the found hole and a clear cellar.
  p = step(A, p, enter("cellar")).progress;
  const hole = cond("cellar", "tunnel_hole");
  assert.equal(evaluate(A, p, hole), false);
  p = step(A, p, gain("green_cloth")).progress;
  assert.equal(p.flags.tunnel_found, true);
  assert.equal(evaluate(A, p, hole), false, "found, but the rats are still alive");
  for (const k of ["cellar_rats", "cellar_rats", "cellar_rats", "cellar_giant_rat_north"]) p = step(A, p, kill(k)).progress;
  assert.equal(evaluate(A, p, hole), false, "one Giant Rat is still alive");
  p = step(A, p, kill("cellar_giant_rat_south")).progress;
  assert.equal(evaluate(A, p, hole), true);
});

test("the cellar's rats cannot be skipped: scene 3 does not end until the hero is in the tunnel", () => {
  const upToCellar = play(A, THE_FIRST_MISSION.slice(0, 5)).final;
  assert.equal(upToCellar.sceneId, "the_cellar");
  const done = play(A, [gain("green_cloth")], upToCellar).final;
  assert.equal(done.sceneId, "the_cellar", "finding the hole alone does not move the story on");
  assert.equal(done.objectivesDone.includes("clear_cellar"), false);
});

test("the tunnel scene ends only when the goblin and his rats are all dead", () => {
  const atTunnel = play(A, THE_FIRST_MISSION.slice(0, 12)).final;
  assert.equal(atTunnel.sceneId, "the_tunnel");
  const goblinOnly = play(A, [kill("tunnel_goblin")], atTunnel).final;
  assert.equal(goblinOnly.sceneId, "the_tunnel", "the goblin is down, two rats are not");
  assert.ok(goblinOnly.objectivesDone.includes("end_the_goblin"));
  const done = play(A, [kill("tunnel_rats"), kill("tunnel_rats")], goblinOnly).final;
  assert.equal(done.sceneId, "back_at_the_kettle");
});

// ---------------------------------------------------------------------------
// The DM moves nothing but one judgment flag

test("the DM may declare exactly one thing in the whole adventure: that the hero has spotted the tunnel", () => {
  let p = startProgress(A);
  const seen: string[] = [];
  const note = () => {
    for (const s of allowedDmSteps(A, p)) seen.push(JSON.stringify(s));
  };
  note();
  for (const e of THE_FIRST_MISSION) {
    p = step(A, p, e).progress;
    note();
  }
  assert.deepEqual([...new Set(seen)], [JSON.stringify({ kind: "flag", flag: "tunnel_noticed" })]);
  // And it is open only while the hero is in the cellar scene and has not found the hole.
  const inCellar = play(A, THE_FIRST_MISSION.slice(0, 5)).final;
  assert.deepEqual(allowedDmSteps(A, inCellar), [{ kind: "flag", flag: "tunnel_noticed" }]);
  assert.deepEqual(allowedDmSteps(A, startProgress(A)), []);
});

test("the DM can reveal the tunnel by declaring tunnel_noticed, and can skip nothing else", () => {
  const atCellar = play(A, THE_FIRST_MISSION.slice(0, 5)).final;
  for (const bad of [
    { kind: "flag", flag: "tunnel_found" },
    { kind: "flag", flag: "goblin_slain" },
    { kind: "objective", id: "clear_cellar" },
    { kind: "objective", id: "find_way_in" },
    { kind: "scene", id: "the_tunnel" },
    { kind: "scene", id: "a_small_start" },
  ] as const) {
    const r = applyEvent(A, atCellar, { type: "dm", step: bad });
    assert.ok(r.refused, `the DM must not be able to ${JSON.stringify(bad)}`);
    assert.deepEqual(r.progress, atCellar);
  }
  const ok = step(A, atCellar, { type: "dm", step: { kind: "flag", flag: "tunnel_noticed" } });
  assert.equal(ok.progress.flags.tunnel_found, true, "the beat turns the DM's call into the found tunnel");
  assert.ok(ok.fired.some((b) => b.id === "tunnel_found"));
  // The hole is still shut while a rat is alive, so the alternative path skips no fight.
  const hole = locationOf(A, "cellar")!.exits.find((e) => e.id === "tunnel_hole")!;
  assert.equal(evaluate(A, ok.progress, hole.requires!), false);
});

// ---------------------------------------------------------------------------
// The people

test("Marta and the Marta of the ending are never in the tavern together", () => {
  const tavern = (p: AdventureProgress) =>
    locationLayout(A, "tavern", { progress: p, walkable: (t) => WALK.has(t), blocking: (x) => BLOCK.has(x) }).layout.tokens.map((t) => t.id);
  const morning = tavern(startProgress(A));
  assert.ok(morning.includes("marta_at_bar"));
  assert.equal(morning.includes("marta_after_the_job"), false);
  assert.ok(morning.includes("dunstan_by_the_fire"));
  const after = tavern(play(A, THE_FIRST_MISSION.slice(0, 15)).final);
  assert.equal(after.includes("marta_at_bar"), false);
  assert.ok(after.includes("marta_after_the_job"));
  assert.ok(after.includes("dunstan_by_the_fire"));
  // The second entry is the same woman, in the same place.
  assert.ok(A.npcs.find((n) => n.id === "marta_after")!.role.includes("Copper Kettle"));
});

test("every NPC has things to say and a place, and the secrets are marked as secrets", () => {
  assert.deepEqual(A.npcs.map((n) => n.id).sort(), ["dunstan", "marta", "marta_after", "skrit", "tobin"]);
  for (const n of A.npcs) {
    assert.ok(n.knows.length >= 2, `${n.id} has things to tell`);
    assert.ok(n.location, `${n.id} has a place`);
  }
  const brief = adventureBrief(A, startProgress(A), { chassis: "fighter" });
  assert.match(brief, /DM ONLY secret \(will not volunteer\): He would never say it/);
});

// ---------------------------------------------------------------------------
// The rooms, as the balance note describes them

const layoutOf = (id: string, progress = startProgress(A)) => locationLayout(A, id, { progress, walkable: (t) => WALK.has(t), blocking: (p) => BLOCK.has(p) });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

test("every map is a full 20 by 15 grid and builds into a layout", () => {
  for (const loc of A.locations) {
    assert.equal(loc.map.rows.length, CELL_HEIGHT, loc.id);
    for (const r of loc.map.rows) assert.equal(r.length, CELL_WIDTH, loc.id);
    const { layout } = layoutOf(loc.id);
    assert.equal(layout.tiles.length, CELL_HEIGHT);
    for (const row of layout.tiles) assert.equal(row.length, CELL_WIDTH);
  }
});

test("the creatures are the ones the truths list: 5 Rats, 2 Giant Rats and one goblin, and no others", () => {
  const counts: Record<string, number> = {};
  for (const loc of A.locations) for (const s of loc.spawns) {
    if (!s.hostile) continue;
    counts[s.creature] = (counts[s.creature] ?? 0) + spawnInstanceIds(s).length;
  }
  assert.deepEqual(counts, { rat: 5, "giant-rat": 2, goblin: 1 });
  assert.equal(layoutOf("cellar").layout.tokens.filter((t) => t.assetId === "token_rat").length, 3);
  assert.equal(layoutOf("cellar").layout.tokens.filter((t) => t.assetId === "token_giant_rat").length, 2);
  assert.equal(layoutOf("tunnel").layout.tokens.filter((t) => t.assetId === "token_rat").length, 2);
  assert.equal(layoutOf("tunnel").layout.tokens.filter((t) => t.assetId === "token_goblin").length, 1);
});

test("the balance note's promises hold: the Giant Rats and the goblin sleep, apart from each other and from the stairs", () => {
  const cellar = layoutOf("cellar");
  const spawn = (loc: string, id: string) => locationOf(A, loc)!.spawns.find((s) => s.id === id)!;
  // The three Rats are awake, the dangerous creatures are not.
  assert.equal(spawn("cellar", "cellar_rats").awake, true);
  for (const [loc, id] of [["cellar", "cellar_giant_rat_north"], ["cellar", "cellar_giant_rat_south"], ["tunnel", "tunnel_rats"], ["tunnel", "tunnel_goblin"]] as const) {
    assert.equal(spawn(loc, id).awake, false, `${id} starts asleep or unaware`);
  }
  // The two Giant Rats are met one at a time: far apart.
  const north = cellar.spawnsAt.cellar_giant_rat_north![0]!;
  const south = cellar.spawnsAt.cellar_giant_rat_south![0]!;
  assert.ok(dist(north, south) >= 8, `the nests are ${dist(north, south)} squares apart`);
  // Neither is near the stairs, so nothing is on the hero when they arrive.
  const stairs = cellar.exitsAt.stairs_up!;
  for (const at of [north, south, ...cellar.spawnsAt.cellar_rats!]) assert.ok(dist(stairs, at) >= 6, "nothing waits at the foot of the stairs");
  // In the tunnel the two Rats sleep far from the goblin, so they are met first and alone.
  const tunnel = layoutOf("tunnel");
  const goblin = tunnel.spawnsAt.tunnel_goblin![0]!;
  for (const at of tunnel.spawnsAt.tunnel_rats!) assert.ok(dist(goblin, at) >= 6, "the goblin is not guarded by his rats");
  // Nobody stands on the way in.
  for (const at of tunnel.spawnsAt.tunnel_rats!) assert.ok(dist(tunnel.exitsAt.back_to_cellar!, at) >= 3);
});

test("the exits come in pairs, arrive on real squares and lead where the names say", () => {
  for (const loc of A.locations) for (const e of loc.exits) {
    const there = exitDestination(A, loc.id, e.id);
    assert.ok(there, `${loc.id}.${e.id} has a destination`);
    assert.equal(there!.locationId, e.to);
    const back = locationOf(A, e.to)!.exits.find((x) => x.id === e.arriveAt)!;
    assert.equal(back.to, loc.id, `${e.id} and ${back.id} point at each other`);
    assert.equal(back.arriveAt, e.id);
    const row = locationOf(A, e.to)!.map.rows[there!.at.y]!;
    assert.ok(WALK.has(locationOf(A, e.to)!.map.legend[row[there!.at.x]!]!.tile), "arrives on a walkable tile");
  }
});

test("the tunnel mouth is behind the sacks on the cellar's east wall, and it is where the search is", () => {
  const cellar = layoutOf("cellar");
  const hole = cellar.exitsAt.tunnel_hole!;
  assert.deepEqual(cellar.featuresAt.sack_heap, hole, "the sack heap and the hole share a square");
  assert.equal(hole.x, CELL_WIDTH - 2, "against the east wall");
  const feature = locationOf(A, "cellar")!.features.find((f) => f.id === "sack_heap")!;
  assert.equal(feature.searchDc, 10);
  assert.deepEqual(feature.gives, ["Scrap of green cloth"]);
  const prop = cellar.layout.props.find((p) => p.x === hole.x && p.y === hole.y)!;
  assert.equal(prop.grantsItem, "Scrap of green cloth");
  assert.equal(prop.assetId, "sack", "the real art hides the hole under sacks until it is found");
});

test("the new art is used where it belongs: workbench and anvil at home, the bar and hearth at the Kettle, rat holes and the tunnel mouth below", () => {
  const props = (id: string) => new Set(layoutOf(id).layout.props.map((p) => p.assetId));
  for (const p of ["workbench", "anvil", "hearth", "bed_head", "bed_foot", "shelf"]) assert.ok(props("home").has(p), `home has ${p}`);
  for (const p of ["bar_counter_w", "bar_counter_mid", "bar_counter_e", "hearth", "stairs_down", "stool", "table_w", "table_e"]) assert.ok(props("tavern").has(p), `tavern has ${p}`);
  for (const p of ["barrel", "crate", "crate_stack", "sack", "cobweb", "rat_hole", "stair_up_w"]) assert.ok(props("cellar").has(p), `cellar has ${p}`);
  for (const p of ["tunnel_mouth", "chest", "rat_hole"]) assert.ok(props("tunnel").has(p), `tunnel has ${p}`);
  for (const p of ["well_nw", "well_se", "cottage_door", "fence_mid", "tree"]) assert.ok(props("village").has(p), `village has ${p}`);
});

// ---------------------------------------------------------------------------
// Gospel: what the DM is handed

test("the gospel brief carries the owner's rules and gives each class its own hook", () => {
  const knight = adventureBrief(A, startProgress(A), { chassis: "fighter" });
  assert.match(knight, /strong back and strong arm/);
  assert.doesNotMatch(knight, /quick hands and sharp eyes/);
  assert.match(knight, /Never give the hero armor or a potion before the job is done/);
  assert.match(knight, /Never move the tunnel/);
  assert.match(knight, /Keep the tone gentle and small-town/);
  assert.match(knight, /The rats get into the cellar through a tunnel that a goblin dug/);
  const shadow = adventureBrief(A, startProgress(A), { chassis: "rogue" });
  assert.match(shadow, /quick hands and sharp eyes/);
  const wizard = adventureBrief(A, startProgress(A), { chassis: "wizard" });
  assert.match(wizard, /talent with magic/);
});

test("the cellar's secrets reach the DM marked DM ONLY, and the goblin is not named before the hero finds him", () => {
  const atCellar = play(A, THE_FIRST_MISSION.slice(0, 5)).final;
  const brief = adventureBrief(A, atCellar, { chassis: "fighter" });
  assert.match(brief, /DM ONLY secret \(found on a search, DC 10\)/);
  assert.match(brief, /Progress steps you may propose now[\s\S]*tunnel_noticed/);
  // The rule is in the DM never list; the room's own read-aloud text and the sleeping creatures do not name him.
  assert.match(brief, /Never reveal the goblin before the hero finds the tunnel/);
  assert.doesNotMatch(locationOf(A, "cellar")!.readAloud, /goblin/i);
  assert.doesNotMatch(sceneOf(A, "the_cellar")!.opening ?? "", /goblin/i);
  for (const b of sceneOf(A, "the_cellar")!.beats) assert.doesNotMatch(b.narrate ?? "", /goblin/i, `beat ${b.id}`);
});

// ---------------------------------------------------------------------------
// Every addition is marked for the owner to review

test("everything that is not in the outline is marked ADDED or REVIEW", () => {
  const marks = markedForReview(TEXT);
  assert.ok(marks.length >= 25, `${marks.length} marks`);
  for (const m of marks) assert.ok(m.text.length >= 25, `line ${m.line}: an empty marker`);
  // Each place, person and item has a mark within the few lines under its heading.
  const lines = TEXT.split("\n");
  const markLines = new Set(marks.map((m) => m.line));
  const headings = lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => /^## (Location|NPC|Item): /.test(x.l));
  assert.ok(headings.length >= 12, "five places, five NPCs, two items");
  for (const h of headings) {
    const near = [...markLines].some((m) => m > h.n && m <= h.n + 6);
    assert.ok(near, `${h.l} has no ADDED or REVIEW mark just under it`);
  }
  // The comments the checker lists are real comments the game never sees: the DM's text has none of them.
  const brief = adventureBrief(A, startProgress(A), { chassis: "wizard" });
  assert.doesNotMatch(brief, /ADDED:|REVIEW:/);
  // The balance note is in the file and carries its figures.
  assert.ok(marks.some((m) => /BALANCE/.test(m.text) && /Giant Rat/.test(m.text) && /Goblin/.test(m.text)));
});
