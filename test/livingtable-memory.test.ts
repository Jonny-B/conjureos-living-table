/**
 * Tests for the Living Table's tiered working memory
 * (src/games/livingtable/memory/). The property that matters most here is
 * DESIGN.md's whole reason for splitting tier 3 out: a fact planted in the
 * very first condensation must still be present, unmodified, after many more
 * condensation cycles run on top of it. Everything else is the supporting
 * cast for that one property.
 *
 * Run: npx tsx --test test/livingtable-memory.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSceneNarration,
  buildDmContextBlock,
  condenseOldest,
  detectFactCollisions,
  emptyWorkingMemory,
  needsCondensation,
  verbatimSceneSeqs,
  oldestVerbatimSceneSeq,
  MAX_CONDENSED_ENTRIES,
} from "../src/games/livingtable/memory";
import type { FactMention, MemoryFact, WorkingMemoryState } from "../src/games/livingtable/memory";
import { heuristicSummarize } from "../src/games/livingtable/session/memoryHeuristics";
import { dedupeLog } from "../src/games/livingtable/session/memoryLoad";

/** A no-op summarizer: digest is a fixed marker, no facts extracted. Used where the test doesn't care about extraction. */
const blankSummarize = (text: string) => ({ digest: `digest of: ${text}`, extractedFacts: [] as MemoryFact[] });

/** Push `n` verbatim scenes onto a fresh state, sceneSeq 1..n. */
function withScenes(n: number): WorkingMemoryState {
  let state = emptyWorkingMemory();
  for (let i = 1; i <= n; i++) state = addSceneNarration(state, i, `narration for scene ${i}`);
  return state;
}

test("needsCondensation is false at and below the threshold, true once it's exceeded", () => {
  assert.equal(needsCondensation(withScenes(4), 4), false);
  assert.equal(needsCondensation(withScenes(5), 4), true);
});

test("needsCondensation defaults to a small threshold usable without dozens of scenes", () => {
  assert.equal(needsCondensation(withScenes(4)), false);
  assert.equal(needsCondensation(withScenes(5)), true);
});

test("condenseOldest replaces only the oldest verbatim entry, leaving newer ones untouched", () => {
  const state = withScenes(3);
  const next = condenseOldest(state, blankSummarize);

  assert.equal(next.log.length, 3);
  assert.equal(next.log[0]!.tier, "condensed");
  assert.equal(next.log[0]!.sceneSeq, 1);
  assert.equal(next.log[0]!.content, "digest of: narration for scene 1");

  // Newer verbatim entries are the exact same objects/content as before -- condensation must not touch them.
  assert.equal(next.log[1]!.tier, "verbatim");
  assert.equal(next.log[1]!.content, "narration for scene 2");
  assert.equal(next.log[2]!.tier, "verbatim");
  assert.equal(next.log[2]!.content, "narration for scene 3");

  // The input state must not have been mutated.
  assert.equal(state.log[0]!.tier, "verbatim");
});

test("condenseOldest on an empty log is a no-op", () => {
  const state = emptyWorkingMemory();
  const next = condenseOldest(state, blankSummarize);
  assert.deepEqual(next.log, state.log);
  assert.deepEqual(next.facts, state.facts);
  assert.deepEqual(next.changedFacts, [], "a no-op cycle changed no facts, so the caller persists nothing");
});

test("condenseOldest on a log with no remaining verbatim entries is a no-op", () => {
  let state: WorkingMemoryState = withScenes(1);
  state = condenseOldest(state, blankSummarize);
  assert.equal(needsCondensation(state, 0), false); // no verbatim entries left at all
  const again = condenseOldest(state, blankSummarize);
  assert.deepEqual(again.log, state.log);
  assert.deepEqual(again.facts, state.facts);
  assert.deepEqual(again.changedFacts, []);
});

test("a fact upserted twice with the same category+key updates in place, never duplicates", () => {
  let state = withScenes(1);

  const v1 = (): { digest: string; extractedFacts: MemoryFact[] } => ({
    digest: "d1",
    extractedFacts: [{ category: "npc", key: "Old Man Fenwick", fact: { disposition: "wary" }, status: "met" }],
  });
  state = condenseOldest(state, v1);
  assert.equal(state.facts.length, 1);
  assert.equal(state.facts[0]!.fact.disposition, "wary");

  // Upsert again, same identity, different content -- must replace, not add.
  state = addSceneNarration(state, 2, "more narration");
  const v2 = (): { digest: string; extractedFacts: MemoryFact[] } => ({
    digest: "d2",
    extractedFacts: [{ category: "npc", key: "Old Man Fenwick", fact: { disposition: "friendly" }, status: "ally" }],
  });
  state = condenseOldest(state, v2);

  assert.equal(state.facts.length, 1, "must update in place, not duplicate");
  assert.equal(state.facts[0]!.fact.disposition, "friendly");
  assert.equal(state.facts[0]!.status, "ally");
});

test("a fact planted in the first extraction survives many later condensation cycles unmodified", () => {
  // This is the property DESIGN.md is built around: tier 3 is what keeps a
  // scene-2 murder mattering in scene 12, because it is a fact record, not
  // a sentence that can be paraphrased away by later condensation passes.
  let state = withScenes(1);

  const plantTheFact = (): { digest: string; extractedFacts: MemoryFact[] } => ({
    digest: "the party discovered the steward was murdered",
    extractedFacts: [
      {
        category: "event",
        key: "steward-murder",
        fact: { what: "the steward was murdered in the east wing", scene: 1 },
        status: "unsolved",
      },
    ],
  });

  // Cycle 1: plant the fact.
  state = condenseOldest(state, plantTheFact);
  assert.equal(state.facts.length, 1);

  // Cycles 2 through 5: unrelated scenes get added and condensed, each
  // extracting some OTHER fact (or none), never touching steward-murder.
  const unrelated = (n: number) => (): { digest: string; extractedFacts: MemoryFact[] } => ({
    digest: `digest ${n}`,
    extractedFacts: [
      { category: "npc", key: `villager-${n}`, fact: { seen: `scene ${n}` }, status: "met" },
    ],
  });

  for (let cycle = 2; cycle <= 5; cycle++) {
    state = addSceneNarration(state, cycle, `narration for scene ${cycle}`);
    state = condenseOldest(state, unrelated(cycle));
  }

  // Four condensation cycles ran on top of the first (cycles 2-5), so this
  // covers "at least 4 condensation cycles" beyond the one that planted it.
  const survivor = state.facts.find((f) => f.category === "event" && f.key === "steward-murder");
  assert.ok(survivor, "the planted fact must still be present after later cycles");
  assert.deepEqual(survivor!.fact, { what: "the steward was murdered in the east wing", scene: 1 });
  assert.equal(survivor!.status, "unsolved");

  // And it wasn't the only fact left standing -- the unrelated cycles' facts are there too, not overwriting it.
  assert.equal(state.facts.filter((f) => f.category === "npc").length, 4);
});

test("detectFactCollisions flags a key reused for genuinely different content", () => {
  const before: MemoryFact[] = [
    { category: "npc", key: "the guard", fact: { name: "Corin", post: "east gate" }, status: "met" },
  ];
  const incoming: MemoryFact[] = [
    { category: "npc", key: "the guard", fact: { name: "Bellamy", post: "west gate" }, status: "met" },
  ];

  const collisions = detectFactCollisions(before, incoming);
  assert.deepEqual(collisions, [{ category: "npc", key: "the guard" }]);
});

test("detectFactCollisions does not flag a legitimate update, same key, same content", () => {
  const before: MemoryFact[] = [
    { category: "npc", key: "Old Man Fenwick", fact: { disposition: "wary" }, status: "met" },
  ];
  const incoming: MemoryFact[] = [
    { category: "npc", key: "Old Man Fenwick", fact: { disposition: "wary" }, status: "met" },
  ];

  const collisions = detectFactCollisions(before, incoming);
  assert.deepEqual(collisions, []);
});

test("condenseOldest surfaces collisions in its return value when this cycle's extraction reuses a key for different content", () => {
  let state = withScenes(1);
  state = condenseOldest(state, () => ({
    digest: "d1",
    extractedFacts: [{ category: "npc", key: "the guard", fact: { name: "Corin" }, status: "met" }],
  }));
  assert.equal((state as { collisions?: unknown }).collisions, undefined, "no prior facts, nothing to collide with");

  state = addSceneNarration(state, 2, "more narration");
  const next = condenseOldest(state, () => ({
    digest: "d2",
    extractedFacts: [{ category: "npc", key: "the guard", fact: { name: "Bellamy" }, status: "met" }],
  }));

  assert.deepEqual(next.collisions, [{ category: "npc", key: "the guard" }]);
  // upsertFact still trusts the key, so the later fact wins in state -- the
  // collision field is what makes that overwrite visible, not something
  // that prevents it.
  assert.equal(next.facts.find((f) => f.key === "the guard")!.fact.name, "Bellamy");
});

test("condenseOldest omits collisions when a repeated key is a legitimate same-content update", () => {
  let state = withScenes(1);
  state = condenseOldest(state, () => ({
    digest: "d1",
    extractedFacts: [{ category: "npc", key: "Old Man Fenwick", fact: { disposition: "wary" }, status: "met" }],
  }));

  state = addSceneNarration(state, 2, "more narration");
  const next = condenseOldest(state, () => ({
    digest: "d2",
    extractedFacts: [{ category: "npc", key: "Old Man Fenwick", fact: { disposition: "wary" }, status: "met" }],
  }));

  assert.equal((next as { collisions?: unknown }).collisions, undefined);
});

test("buildDmContextBlock lists permanent facts grouped by category, then condensed, then verbatim, in order", () => {
  let state = emptyWorkingMemory();
  state = addSceneNarration(state, 1, "scene one narration");
  state = condenseOldest(state, () => ({
    digest: "scene one digest",
    extractedFacts: [
      { category: "promise", key: "return-the-ring", fact: { to: "Mira" }, status: "open" },
      { category: "npc", key: "Mira", fact: { role: "blacksmith" }, status: "met" },
    ],
  }));
  state = addSceneNarration(state, 2, "scene two narration, still verbatim");

  const block = buildDmContextBlock(state);

  const factsIdx = block.indexOf("PERMANENT CAMPAIGN FACTS");
  const npcIdx = block.indexOf("NPCs:");
  const promiseIdx = block.indexOf("Promises:");
  const condensedIdx = block.indexOf("CONDENSED HISTORY");
  const verbatimIdx = block.indexOf("RECENT SCENES, IN FULL");

  assert.ok(factsIdx !== -1 && npcIdx !== -1 && promiseIdx !== -1 && condensedIdx !== -1 && verbatimIdx !== -1);
  // Fixed section order: facts, category order (npc before promise), condensed, verbatim.
  assert.ok(factsIdx < npcIdx);
  assert.ok(npcIdx < promiseIdx);
  assert.ok(promiseIdx < condensedIdx);
  assert.ok(condensedIdx < verbatimIdx);

  assert.match(block, /Mira \[met\]/);
  assert.match(block, /return-the-ring \[open\]/);
  assert.match(block, /scene one digest/);
  assert.match(block, /scene two narration, still verbatim/);
});

test("buildDmContextBlock omits empty sections rather than printing empty headers", () => {
  const block = buildDmContextBlock(emptyWorkingMemory());
  assert.match(block, /PERMANENT CAMPAIGN FACTS: none yet\./);
  assert.doesNotMatch(block, /CONDENSED HISTORY/);
  assert.doesNotMatch(block, /RECENT SCENES/);
});

// ── ordinary DM prose fixtures ───────────────────────────────────────────
//
// Everything below is written the way a DM actually narrates: six to nine
// sentences a scene, the plot beat stated somewhere in the middle of the
// paragraph rather than helpfully parked at the end, and colour (weather,
// birds, food, boots) taking up most of the words. A gauntlet critic drove
// exactly this shape through the real modules and found five separate ways
// the permanent tier lied about the campaign; the fixtures are prose rather
// than keyword-stuffed one-liners precisely so a fix that only works on
// keyword bait cannot pass.

const CAMPAIGN_SCENES: string[] = [
  // 0: the toll crossing, Alderic Voss named three times
  "The road down to Harrow Mill runs beside the water for the last mile, and the water is higher than it ought to be. " +
    "A toll house stands where the road crosses the race, and a man in an oiled coat leans in its doorway. " +
    "He gives his name as Alderic Voss and asks four coppers a head for the crossing. " +
    "Alderic Voss says the crossing has belonged to his family for three generations. " +
    "The rain has stopped, though the sky over the hills has not cleared. " +
    "Alderic Voss counts your coins twice before he waves you through. " +
    "A heron stands in the shallows and does not move as you pass.",
  // 1: the promise, stated mid paragraph
  "The mill itself is quiet, and the wheel has been lashed still with rope. " +
    "A woman named Sella meets you at the door with flour to her elbows and does not ask who sent you. " +
    "She says her brother Perrin went upriver eleven days ago and has not come back. " +
    "You promise Sella that you will bring Perrin home before the water drops again. " +
    "Sella does not thank you, which is somehow worse than if she had. " +
    "She gives you bread wrapped in cloth and points along the track on the north bank. " +
    "The dogs under the mill bark once and then settle.",
  // 2: the iron door with three keyholes
  "The track along the north bank is soft and takes your boots to the ankle in places. " +
    "Willows lean out over the water and the light under them is green and cold. " +
    "Set into the flank of the old mill house is a black iron door with three keyholes in a row and no handle at all. " +
    "The door does not move when you lean on it, and nothing you carry fits any of the three. " +
    "Someone has been here recently enough that the nettles are still bent flat. " +
    "You eat the bread on a flat stone and watch the water go by. " +
    "The afternoon gets on toward evening without anything else happening.",
  // 3: the theft, written as "You take it."
  "The chapel above the mill has lost half its roof and the pews have been dragged out into the yard. " +
    "Dust lies thick on everything except one square of the altar cloth where something has been moved. " +
    "A brass instrument sits there under oilcloth, and the plate beneath it reads Tideglass Compass in worn letters. " +
    "You take it. " +
    "Nothing happens, and no one comes, and the birds in the roof beams do not even stop. " +
    "On the way out you see that the collection box has been emptied by somebody else already. " +
    "The light goes orange across the yard as you leave.",
  // 4: Voss puts the price up, habitual present
  "You go back down to the crossing to ask Alderic Voss what he knows about the upriver camps. " +
    "Alderic Voss has always put the price up when the water comes up, and today is no different. " +
    "He wants a silver now, not four coppers, and he does not pretend to be sorry about it. " +
    "The river has taken the lower step of the toll house and is working on the second. " +
    "Two men you do not know are drinking under the awning and stop talking when you come near. " +
    "Alderic Voss tells you nobody sensible goes above the weir in a flood. " +
    "You pay, because arguing with him costs more than a silver.",
  // 5: the mark at the weir
  "The weir is a low grey wall with water pouring over the whole width of it. " +
    "Below it the pool turns slowly and carries branches around in a circle. " +
    "On the upstream face, low down where the moss has been scraped away, someone has scratched a circle with a bar through it. " +
    "It is the same mark that was cut into the top of the black iron door at the mill. " +
    "Midges hang over the water in columns and the light comes through them. " +
    "You sit for a while because there is nowhere obvious to go next. " +
    "A heron watches from a snag for the better part of an hour and then leaves without hurrying.",
  // 6: camp, and a boat in the night
  "You make camp on the bank above the weir with the fire small and screened. " +
    "There is cheese and sorrel and the last of the bread from the mill. " +
    "Your boots do not dry out and you stop expecting them to. " +
    "Sometime after midnight a boat goes past upstream with no lantern showing. " +
    "Nobody aboard it calls out and nobody on the bank answers. " +
    "In the morning there is a fresh rope tied off on the willow root below the camp. " +
    "The birds start up again as though none of it had happened.",
  // 7: the upriver camp, and the first key
  "The upriver camp is three lean-tos and a fire pit that has been cold for a week. " +
    "There is no blood and no sign of a struggle anywhere in the clearing. " +
    "A boot print in the mud at the water edge points into the river, not out of it. " +
    "You find a brass key on a thong under a folded coat, small and three-sided. " +
    "The flies are bad and the smoke from your fire does nothing about them. " +
    "You sit with the coat for a while before you fold it into your pack.",
  // 8: Voss is killed, mid paragraph
  "You come back down to the crossing at dusk with the key and the coat. " +
    "Alderic Voss is standing on the wet planks arguing with one of the men from under the awning. " +
    "The argument stops when the man puts a knife into Alderic Voss just below the ribs. " +
    "Alderic Voss is dead before he goes down, and the man is into the willows before you reach the planks. " +
    "The toll box is still full, so it was not money. " +
    "The river keeps going over the lower step as though nothing had happened. " +
    "Somebody upstream is ringing a bell and nobody comes.",
  // 9: the key fits one of three
  "The black iron door at the mill has three keyholes and your brass key fits the middle one. " +
    "It turns, and nothing opens, because the other two are still locked. " +
    "Sella comes out and stands behind you without saying anything for a long time. " +
    "She tells you the verger kept one key and Alderic Voss kept another. " +
    "That means the third is somewhere nobody has thought to look yet. " +
    "The mark above the door is the same circle and bar you found at the weir. " +
    "Rain starts again, thin and steady, and the race under the mill picks up.",
  // 10: a buyer offers gold for the taken compass
  "A man in a good coat is waiting at the mill in the morning with two others behind him. " +
    "He says his name is Corwin Hale and that he buys curiosities up and down this river. " +
    "He offers forty gold for the Tideglass Compass and does not explain how he knows you have it. " +
    "Sella has gone very still in the doorway behind you. " +
    "Corwin Hale says the offer stands until the water drops and not one hour after. " +
    "The dogs under the mill do not bark at him, which you notice. " +
    "You tell him you will think about it.",
  // 11: the chapel yard, and the third key
  "The chapel yard has been turned over since you were last here and the pews are broken up for firewood. " +
    "The bell has been taken down and laid out in pieces in the grass. " +
    "Under where the bell hung there is a flagstone with the circle and bar cut into it. " +
    "It lifts, and beneath it is a dry hole with a third brass key in it. " +
    "Someone has been through the collection box again, though there was nothing left in it. " +
    "The rain fills your collar and you stop caring about it. " +
    "You go back down toward the mill with the key in your fist.",
  // 12: the village under pressure
  "The village has not slept properly in three days and it shows in every face on the street. " +
    "The boat that was tied below the weir is gone and the rope has been cut, not untied. " +
    "A board has been nailed across the door of the toll house since Voss died. " +
    "Sella keeps the mill door barred now, even in the middle of the day. " +
    "Two of the men from the far bank are camped where you can see them from the yard. " +
    "Somebody has drawn the circle and bar in chalk on three doors along the street. " +
    "You still have not told Sella what happened to Perrin.",
  // 13: the door opens
  "You take the three keys down to the black iron door in the last of the light. " +
    "They turn together and the door comes open on a stair going down under the race. " +
    "The air out of it is cold and smells of wet stone and old rope. " +
    "Sella follows you as far as the top step and then stops. " +
    "She says Perrin came down here the night before he went upriver. " +
    "Below you, somewhere under the water, something is moving that is not the river. " +
    "You promise Sella you will come back up whatever is down there.",
];

/** Run `scenes` through the REAL wired pipeline: append, condense at the real threshold, exactly as LivingTable.tsx does. */
function runCampaign(scenes: string[]): WorkingMemoryState {
  let mem: WorkingMemoryState = emptyWorkingMemory();
  for (let sceneSeq = 0; sceneSeq < scenes.length; sceneSeq++) {
    mem = addSceneNarration(mem, sceneSeq, scenes[sceneSeq]!);
    while (needsCondensation(mem)) {
      const result = condenseOldest(mem, heuristicSummarize);
      mem = { log: result.log, facts: result.facts };
    }
  }
  return mem;
}

function mentionsOf(fact: MemoryFact): FactMention[] {
  return (fact.fact.mentions ?? []) as FactMention[];
}

// ── work order 1: tier 3 is typed, deduplicated and carries provenance ───

test("a scene naming the same two-word name three times produces exactly one fact, not one per capitalized word", () => {
  const { extractedFacts } = heuristicSummarize(CAMPAIGN_SCENES[0]!, 0);
  const vossFacts = extractedFacts.filter((f) => /Voss/.test(f.key));
  assert.equal(
    vossFacts.length,
    1,
    `expected one fact for "Alderic Voss", got ${JSON.stringify(extractedFacts.map((f) => f.key))}`,
  );
  assert.equal(vossFacts[0]!.key, "Alderic Voss");
});

test("heuristic facts are typed by inference, not all stamped as one hardcoded category", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const categories = new Set(mem.facts.map((f) => f.category));
  assert.ok(
    categories.size > 1,
    `after ${CAMPAIGN_SCENES.length} scenes the permanent tier is still single-category: ${JSON.stringify(
      mem.facts.map((f) => `${f.category}/${f.key}`),
    )}`,
  );
  assert.ok(categories.has("npc"), `expected at least one npc fact, got ${JSON.stringify([...categories])}`);
});

test("a sworn promise reaches the permanent tier as a promise fact whose status says it is still outstanding", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const promises = mem.facts.filter((f) => f.category === "promise");
  assert.ok(promises.length > 0, `expected a promise fact, got ${JSON.stringify(mem.facts.map((f) => `${f.category}/${f.key}`))}`);
  assert.ok(
    promises.some((f) => /outstanding/.test(f.status)),
    `expected a promise still marked outstanding, got ${JSON.stringify(promises.map((f) => f.status))}`,
  );
});

test("an NPC killed mid campaign carries a status that says so, and a later neutral mention does not erase it", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const voss = mem.facts.find((f) => /Voss/.test(f.key));
  assert.ok(voss, `expected a fact for the tollkeeper, got ${JSON.stringify(mem.facts.map((f) => f.key))}`);
  assert.match(
    voss!.status,
    /dead/,
    `the tollkeeper dies in scene 8 and is mentioned again in scenes 9 and 12; his status must still say dead, got "${voss!.status}"`,
  );
});

test("a fact's evidence carries the scene it came from, so supersession is legible", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const voss = mem.facts.find((f) => /Voss/.test(f.key))!;
  const mentions = mentionsOf(voss);
  assert.ok(mentions.length > 0, "expected evidence on the tollkeeper fact");
  for (const m of mentions) {
    assert.equal(typeof m.sceneSeq, "number", `every mention must name its scene, got ${JSON.stringify(m)}`);
    assert.equal(typeof m.text, "string");
  }
  const block = buildDmContextBlock(mem);
  assert.match(block, /\(scene \d+\)/, "the rendered fact section must show which scene each piece of evidence came from");
});

test("evidence attaches by adjacency, so a consequence stated in the NEXT sentence still lands on the fact", () => {
  // Scene 3 names the compass and then steals it in a four word sentence
  // that contains no proper noun at all ("You take it."). Literal word
  // matching finds nothing there; adjacency does.
  const { extractedFacts } = heuristicSummarize(CAMPAIGN_SCENES[3]!, 3);
  const compass = extractedFacts.find((f) => /Tideglass/.test(f.key));
  assert.ok(compass, `expected a fact for the compass, got ${JSON.stringify(extractedFacts.map((f) => f.key))}`);
  const evidence = mentionsOf(compass!).map((m) => m.text).join(" ");
  assert.match(evidence, /take/, `expected the taking to be attached as evidence, got "${evidence}"`);
  assert.equal(compass!.category, "item");
  assert.match(compass!.status, /taken/, `the permanent tier must record that the compass was taken, got "${compass!.status}"`);
});

test("a fact status carries state rather than a compile time constant", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const statuses = new Set(mem.facts.map((f) => f.status));
  assert.ok(statuses.size > 1, `every fact still shares one status string: ${JSON.stringify([...statuses])}`);
});

test("the fact section is introduced by a binding rule, in the same register as the dice rule", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const block = buildDmContextBlock(mem);
  const ruleIdx = block.indexOf("binding");
  const factsIdx = block.indexOf("PERMANENT CAMPAIGN FACTS");
  assert.ok(ruleIdx !== -1, `expected a binding rule above the fact section, got:\n${block.slice(0, 400)}`);
  assert.ok(ruleIdx < factsIdx, "the rule must sit above the fact section, not below it");
  assert.match(block, /never contradict/);
  assert.match(block, /does not appear, speak, or trade/);
});

test("condenseOldest reports only the facts that changed this cycle, not the whole accumulated list", () => {
  let mem: WorkingMemoryState = emptyWorkingMemory();
  for (let sceneSeq = 0; sceneSeq < 6; sceneSeq++) {
    mem = addSceneNarration(mem, sceneSeq, CAMPAIGN_SCENES[sceneSeq]!);
    while (needsCondensation(mem)) {
      const result = condenseOldest(mem, heuristicSummarize);
      mem = { log: result.log, facts: result.facts };
    }
  }
  mem = addSceneNarration(mem, 6, CAMPAIGN_SCENES[6]!);
  const result = condenseOldest(mem, heuristicSummarize);
  assert.ok(Array.isArray(result.changedFacts), "condenseOldest must report the subset that changed");
  assert.ok(
    result.changedFacts.length < result.facts.length,
    `the caller re-POSTs one request per reported fact, so this must be a subset: ${result.changedFacts.length} of ${result.facts.length}`,
  );
  for (const changed of result.changedFacts) {
    assert.ok(result.facts.some((f) => f.key === changed.key), "a reported change must be present in the new fact list");
  }
});

test("DM supplied typed facts win over the heuristic for the same key", () => {
  let mem = emptyWorkingMemory();
  mem = addSceneNarration(mem, 0, CAMPAIGN_SCENES[0]!, [
    { category: "npc", key: "Alderic Voss", fact: { role: "tollkeeper at the crossing" }, status: "hostile, wants a silver a head" },
  ]);
  const result = condenseOldest(mem, heuristicSummarize);
  const voss = result.facts.find((f) => /Voss/.test(f.key));
  assert.ok(voss, "the supplied fact must be in the permanent tier");
  assert.equal(voss!.category, "npc");
  assert.equal(voss!.status, "hostile, wants a silver a head");
  assert.equal(voss!.fact.role, "tollkeeper at the crossing");
});

// ── work order 2: the digest spends its budget on signal, not position ───

test("a plot beat in the middle of a scene, stated in plain common nouns, survives condensation", () => {
  const scene =
    "The track climbs away from the water and the trees close over it. " +
    "Nothing moves in the undergrowth and the birds have gone quiet. " +
    "You walk for most of an hour without seeing another soul. " +
    "Someone has scratched a circle with a bar through it into the trunk of a beech at the fork, the same mark that was cut into the black iron door. " +
    "The moss on the north side of the trunk is thick and undisturbed. " +
    "You eat what is left of the bread and sit for a while. " +
    "The light is going by the time you decide which way to turn.";
  const { digest } = heuristicSummarize(scene, 0);
  assert.match(
    digest,
    /scratched|circle with a bar/,
    `the only plot beat in the scene is sentence four and it names nobody; it must survive, got: ${digest}`,
  );
});

test("the closing colour sentence is not kept just for being last", () => {
  const { digest } = heuristicSummarize(CAMPAIGN_SCENES[5]!, 5);
  assert.doesNotMatch(digest, /heron/, `the last sentence is pure colour and must not be anchored into the digest: ${digest}`);
  assert.match(digest, /scratched|same mark/, `the two sentence thread must be what the budget buys instead: ${digest}`);
});

// ── work order 3: the block owns a ceiling and proves it ─────────────────

test("the memory block reaches a flat ceiling and HOLDS it across a sixty scene campaign, with the DM emitting a fact a turn", () => {
  // Sixty scenes of the same shape of prose, with a fresh cast every
  // fourteen so entity count grows the way a real long campaign's does
  // rather than being flattered by repetition.
  //
  // This test used to assert `growthPerScene < 200`, under a comment saying
  // the block "must be bounded, not linear". 200 chars a scene IS linear:
  // the assertion could not fail for the behaviour it was written to catch,
  // and it measured 136. It also passed no suppliedFacts, which is the path
  // that doubles the fact count once the DM starts emitting them the way the
  // prompt asks. Both are fixed here: the DM emits one typed fact per turn,
  // and what's asserted is a ceiling REACHED AND HELD (scene 60 within a few
  // hundred chars of scene 30), not a slope under a constant.
  const CASTS = [
    ["Alderic Voss", "Sella", "Perrin", "Corwin Hale", "Tideglass Compass", "Harrow Mill"],
    ["Roderic Fen", "Marra", "Odo", "Bellan Crest", "Nightglass Lens", "Cotter Bridge"],
    ["Emric Dole", "Ilsa", "Wren", "Sabin Roke", "Emberglass Dial", "Stonefall Weir"],
    ["Halden Ros", "Nessa", "Tobin", "Piers Vane", "Sunglass Ring", "Ashbeck Ford"],
    ["Garrick Ilm", "Bryn", "Callum", "Ordric Mane", "Frostglass Bead", "Redmarsh Lock"],
  ];
  const scenes: string[] = [];
  for (let i = 0; i < 60; i++) {
    const cast = CASTS[Math.floor(i / CAMPAIGN_SCENES.length) % CASTS.length]!;
    let text = CAMPAIGN_SCENES[i % CAMPAIGN_SCENES.length]!;
    CASTS[0]!.forEach((original, slot) => {
      text = text.split(original).join(cast[slot]!);
      const lastName = original.split(" ").slice(-1)[0]!;
      text = text.split(lastName).join(cast[slot]!.split(" ").slice(-1)[0]!);
    });
    scenes.push(text);
  }

  let mem: WorkingMemoryState = emptyWorkingMemory();
  const lengths: number[] = [];
  for (let sceneSeq = 0; sceneSeq < scenes.length; sceneSeq++) {
    // The DM types one fact a turn, keyed as promptBuilder.ts asks for it (a
    // slug), which is the shape the merge path has to cope with.
    const cast = CASTS[Math.floor(sceneSeq / CAMPAIGN_SCENES.length) % CASTS.length]!;
    const subject = cast[sceneSeq % cast.length]!;
    mem = addSceneNarration(mem, sceneSeq, scenes[sceneSeq]!, [
      {
        category: "npc",
        key: subject.toLowerCase().split(" ").join("-"),
        fact: `${subject} matters to this campaign.`,
        status: `seen in scene ${sceneSeq}`,
      },
    ]);
    while (needsCondensation(mem)) {
      const result = condenseOldest(mem, heuristicSummarize);
      mem = { log: result.log, facts: result.facts };
    }
    lengths.push(buildDmContextBlock(mem).length);
  }

  const CEILING = 20000;
  assert.ok(
    lengths[59]! < CEILING,
    `the DM memory block must be bounded: scene 60 is ${lengths[59]} chars (ceiling ${CEILING}); ` +
      `by scene: ${lengths.filter((_, i) => i % 10 === 9).join(", ")}`,
  );

  // Peaks, not single samples: how full any one turn's block is depends on
  // how long that scene's own prose happens to be (tier 1 is four whole
  // scenes and tier 2 is six digests of whole sentences), so two arbitrary
  // scenes differ by a few hundred chars in either direction whether or not
  // the block is bounded. What a ceiling means is that the HIGH WATER MARK
  // stops moving. A block growing at the pre-fix 136 chars a scene would put
  // these two peaks about four thousand apart.
  const peak = (from: number, to: number): number => Math.max(...lengths.slice(from, to));
  const reached = peak(14, 30);
  const held = peak(30, 60);
  assert.ok(
    held - reached < 600,
    `the ceiling must be REACHED AND HELD, not approached on a slope: the peak over scenes 15-30 is ${reached} chars and ` +
      `the peak over scenes 31-60 is ${held}; by scene: ${lengths.filter((_, i) => i % 10 === 9).join(", ")}`,
  );
});

test("tier 2 is capped: past the cap the oldest digests fold into tier 3 and leave the block", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const condensed = mem.log.filter((e) => e.tier === "condensed");
  assert.ok(condensed.length <= MAX_CONDENSED_ENTRIES, `tier 2 must be capped, found ${condensed.length} condensed entries`);
  // What left the block is not lost: it folded into the permanent tier.
  assert.ok(
    mem.facts.some((f) => mentionsOf(f).some((m) => m.sceneSeq <= 2)),
    "the earliest scenes must still be represented somewhere in tier 3",
  );
});

test("the caller can ask which scenes are still tier 1, so it stops resending condensed ones verbatim", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  const verbatim = verbatimSceneSeqs(mem);
  assert.ok(verbatim.length > 0 && verbatim.length <= 5, `expected a handful of tier 1 scenes, got ${JSON.stringify(verbatim)}`);
  assert.equal(oldestVerbatimSceneSeq(mem), verbatim[0]);
  for (const seq of verbatim) {
    assert.equal(mem.log.find((e) => e.sceneSeq === seq)!.tier, "verbatim");
  }
  assert.equal(oldestVerbatimSceneSeq(emptyWorkingMemory()), null);
});

test("a fact's evidence is bounded: the newest mentions plus the status, never an unbounded pile", () => {
  const mem = runCampaign(CAMPAIGN_SCENES);
  for (const fact of mem.facts) {
    const mentions = mentionsOf(fact);
    assert.ok(mentions.length <= 3, `fact "${fact.key}" carries ${mentions.length} mentions; evidence must be bounded`);
    for (const m of mentions) assert.ok(m.text.length <= 260, `mention on "${fact.key}" is ${m.text.length} chars`);
  }
});

test("dedupeLog caps condensed rows on load, so a reload cannot re-inflate tier 2 past its cap", () => {
  const rows: Array<{ sceneSeq: number; tier: "verbatim" | "condensed"; content: string }> = [];
  for (let sceneSeq = 0; sceneSeq < 30; sceneSeq++) rows.push({ sceneSeq, tier: "condensed", content: `digest ${sceneSeq}` });
  rows.push({ sceneSeq: 30, tier: "verbatim", content: "the current scene" });
  const log = dedupeLog(rows);
  const condensed = log.filter((e) => e.tier === "condensed");
  assert.ok(condensed.length <= MAX_CONDENSED_ENTRIES, `load path must cap tier 2 too, got ${condensed.length}`);
  assert.equal(condensed[condensed.length - 1]!.sceneSeq, 29, "the cap must keep the NEWEST digests, not the oldest");
  assert.ok(log.some((e) => e.tier === "verbatim"), "verbatim rows are never dropped by the cap");
});

// ── work order 4: key identity, provenance, and what a heuristic may restate ─
//
// Everything below is a blind adversary's reproduction, re-run against the
// real modules. The through-line: the permanent tier is printed under a rule
// that calls it binding, so a record that is wrong there is worse than a
// record that is missing, and a record that is wrong IRREVERSIBLY is worse
// again.

/** Fold one scene of prose plus optional DM-typed facts through the real wired pipeline, condensing it immediately. */
function foldScene(
  state: WorkingMemoryState,
  sceneSeq: number,
  text: string,
  supplied?: Parameters<typeof addSceneNarration>[3],
): WorkingMemoryState {
  const withScene = addSceneNarration(state, sceneSeq, text, supplied);
  const result = condenseOldest(withScene, heuristicSummarize);
  return { log: result.log, facts: result.facts };
}

test("a DM fact keyed the way the prompt actually asks for it (a slug) merges with the heuristic's record, not beside it", () => {
  // promptBuilder.ts tells the model {"key":"a-stable-slug"} and its own
  // worked examples are `maren-new-moon` and `harrow`. The heuristic invents
  // the capitalised phrase key "Alderic Voss". Those two must be one record.
  let mem = emptyWorkingMemory();
  mem = foldScene(mem, 0, CAMPAIGN_SCENES[0]!, [
    { category: "npc", key: "alderic-voss", fact: "The tollkeeper at the Harrow Mill crossing.", status: "hostile, wants a silver a head" },
  ]);

  const vossFacts = mem.facts.filter((f) => /voss/i.test(f.key));
  assert.equal(
    vossFacts.length,
    1,
    `the slug key the prompt demands must resolve to the heuristic's record, got ${JSON.stringify(
      vossFacts.map((f) => `${f.category}/${f.key} [${f.status}]`),
    )}`,
  );
  assert.equal(vossFacts[0]!.status, "hostile, wants a silver a head", "the model's own typed status is what the DM must read back");
});

test("a DM fact keyed as the prompt's own lowercase example (a bare surname) also merges, rather than forking the record", () => {
  let mem = emptyWorkingMemory();
  mem = foldScene(mem, 0, CAMPAIGN_SCENES[0]!, [
    { category: "npc", key: "voss", fact: "The tollkeeper.", status: "wary of the party" },
  ]);
  const vossFacts = mem.facts.filter((f) => /voss/i.test(f.key));
  assert.equal(vossFacts.length, 1, `got ${JSON.stringify(vossFacts.map((f) => `${f.key} [${f.status}]`))}`);
  assert.equal(vossFacts[0]!.key, "Alderic Voss", "the fuller, readable name is what the DM should be shown");
});

test("a bare surname shared by two established people DECLINES to merge rather than guessing by insertion order", () => {
  // The adversary's scene: "You find Vetch face down at the bottom of the
  // mill steps... Nobody in the village will say which of them it is." The
  // engine answered a question the DM was deliberately holding open, and the
  // answer was whichever Vetch happened to be inserted first.
  let mem = withScenes(1);
  mem = condenseOldest(mem, () => ({
    digest: "d1",
    extractedFacts: [
      { category: "npc", key: "Bran Vetch", fact: { mentions: [{ sceneSeq: 1, text: "Bran Vetch runs the mill." }] }, status: "known (heuristic)" },
      { category: "npc", key: "Sella Vetch", fact: { mentions: [{ sceneSeq: 1, text: "Sella Vetch keeps the door barred." }] }, status: "known (heuristic)" },
    ],
  }));

  mem = addSceneNarration(mem, 2, "a later scene");
  const next = condenseOldest(mem, () => ({
    digest: "d2",
    extractedFacts: [
      {
        category: "npc",
        key: "Vetch",
        fact: { mentions: [{ sceneSeq: 2, text: "You find Vetch face down at the mill steps." }] },
        status: "dead (heuristic)",
      },
    ],
  }));

  assert.equal(next.facts.find((f) => f.key === "Bran Vetch")!.status, "known (heuristic)", "an ambiguous surname must not kill Bran");
  assert.equal(next.facts.find((f) => f.key === "Sella Vetch")!.status, "known (heuristic)", "or Sella");
});

test("the heuristic can never restate a status the model itself authored, at any rank, at any later condensation", () => {
  // The worst ordering there is: the player paid a credit for the model to
  // author this fact, and an unsupervised string matcher replaced it with
  // the opposite.
  let mem = emptyWorkingMemory();
  mem = foldScene(mem, 0, "The wheel at Harrow Mill has been lashed still with rope, and Bran Vetch is not troubled by it.", [
    { category: "npc", key: "Bran Vetch", fact: "The miller at Harrow Mill.", status: "alive, running the mill" },
  ]);
  assert.equal(mem.facts.find((f) => /Vetch/.test(f.key))!.status, "alive, running the mill");

  mem = foldScene(
    mem,
    1,
    "You find Bran Vetch at the bottom of the mill steps in the grey of the morning. " +
      "Bran Vetch is dead and has been since first light. " +
      "Nobody in the village will say who found him.",
  );

  const bran = mem.facts.find((f) => /Vetch/.test(f.key))!;
  assert.equal(bran.status, "alive, running the mill", `the heuristic overwrote the model's own typed fact, got "${bran.status}"`);
  const evidence = mentionsOf(bran).map((m) => m.text).join(" ");
  assert.match(evidence, /steps|first light/, "the heuristic may still APPEND evidence to a model-authored fact");
});

test("a death two sentences away does not kill a living NPC: the cue must be in the naming sentence and about that name", () => {
  // Bran Vetch is the miller. His FATHER died. Because "dead" ranks terminal
  // and terminal can never be outranked, the wrong answer was permanent.
  const scene =
    "You show the cutting to Bran Vetch at the mill door, and he will not stand under it. " +
    "He says he has seen the same cutting twice before, once on a boat that went down the valley empty and once on his father's door the week his father died. " +
    "Bran Vetch bars the door behind you when you leave.";
  const { extractedFacts } = heuristicSummarize(scene, 6);
  const bran = extractedFacts.find((f) => /Vetch/.test(f.key));
  assert.ok(bran, `expected a fact for the miller, got ${JSON.stringify(extractedFacts.map((f) => f.key))}`);
  assert.doesNotMatch(bran!.status, /dead/, `somebody else's death two sentences away must not kill him, got "${bran!.status}"`);
  assert.equal(bran!.category, "npc");
});

test("a death stated about the name itself is still caught", () => {
  // The other half: narrowing the death cue must not make it unreachable.
  const { extractedFacts } = heuristicSummarize(CAMPAIGN_SCENES[8]!, 8);
  const voss = extractedFacts.find((f) => /Voss/.test(f.key));
  assert.ok(voss, `got ${JSON.stringify(extractedFacts.map((f) => f.key))}`);
  assert.match(voss!.status, /dead/, `the tollkeeper is knifed and dies in this scene, got "${voss!.status}"`);
});

test("classification reads the UNCLIPPED evidence window, so a state change stated late in a scene is not invisible", () => {
  // Identical event, opposite permanent record, decided purely by character
  // offset: the taking sentence sat past MAX_MENTION_CHARS of the naming
  // sentence, so classify() never saw it. Clipping is a presentation bound.
  const scene =
    "The chapel above the mill has lost half its roof and the pews have been dragged out into the yard where the rain has swollen them, " +
    "and dust lies thick on everything except one square of the altar cloth where the Tideglass Compass has been sitting undisturbed for years. " +
    "Nothing in the roof beams moves, and the birds that nest there do not so much as shift on their perches while you stand in the doorway. " +
    "You take it.";
  const { extractedFacts } = heuristicSummarize(scene, 3);
  const compass = extractedFacts.find((f) => /Tideglass/.test(f.key));
  assert.ok(compass, `got ${JSON.stringify(extractedFacts.map((f) => f.key))}`);
  assert.match(
    compass!.status,
    /taken/,
    `the party stole it in the last sentence; character offset must not decide the permanent record, got "${compass!.status}"`,
  );
  // ...and the stored evidence is still clipped, because that bound is real,
  // it just isn't allowed to be an INPUT to the decision above.
  for (const m of mentionsOf(compass!)) assert.ok(m.text.length <= 260, `evidence must still be clipped, got ${m.text.length} chars`);
});

test("a person named in a scene where something changes hands is not filed as loot the party is carrying", () => {
  const scene =
    "You come up the track to the mill and find Sella Vetch waiting at the door. " +
    "She puts the bundle in your hands and stands there until you take it. " +
    "Nobody in the village will say what is in it.";
  const { extractedFacts } = heuristicSummarize(scene, 3);
  const sella = extractedFacts.find((f) => /Sella/.test(f.key));
  assert.ok(sella, `got ${JSON.stringify(extractedFacts.map((f) => f.key))}`);
  assert.equal(sella!.category, "npc", `a woman is not an item, got ${sella!.category}/${sella!.key} [${sella!.status}]`);
  assert.doesNotMatch(sella!.status, /taken by the party/);
});

test("a possessive pronoun before a name does not make a person a thing", () => {
  // DETERMINERS held "her"/"his"/"their"/"my"/"your"/"our", so ordinary
  // English ("everyone calls her Sella Vetch") filed a woman as an object.
  const scene =
    "Everybody along this stretch of the river calls her Sella Vetch, though the name on the mill deed is a different one. " +
    "Sella Vetch has run the place alone since her brother went upriver. " +
    "The dogs under the mill do not bark at her.";
  const { extractedFacts } = heuristicSummarize(scene, 2);
  const sella = extractedFacts.find((f) => /Sella/.test(f.key));
  assert.ok(sella, `got ${JSON.stringify(extractedFacts.map((f) => f.key))}`);
  assert.equal(sella!.category, "npc", `got ${sella!.category}/${sella!.key} [${sella!.status}]`);
});

test("a name already recorded as an NPC is never re-filed as an item by a later scene", () => {
  let mem = withScenes(1);
  mem = condenseOldest(mem, () => ({
    digest: "d1",
    extractedFacts: [
      {
        category: "npc",
        key: "Alderic Voss",
        fact: { mentions: [{ sceneSeq: 1, text: "Alderic Voss counts your coins twice before he waves you through." }] },
        status: "known (heuristic)",
      },
    ],
  }));
  mem = addSceneNarration(mem, 2, "a later scene");
  const next = condenseOldest(mem, () => ({
    digest: "d2",
    extractedFacts: [
      {
        category: "item",
        key: "Voss",
        fact: { mentions: [{ sceneSeq: 2, text: "He takes the coin without looking at it." }] },
        status: "taken by the party (heuristic)",
      },
    ],
  }));

  // categoriesCompatible(item, npc) used to be false, so this record could
  // never merge and the man stayed permanently in the Items list.
  const voss = next.facts.filter((f) => /Voss/.test(f.key));
  assert.equal(voss.length, 1, `one person, one record, got ${JSON.stringify(voss.map((f) => `${f.category}/${f.key}`))}`);
  assert.equal(voss[0]!.category, "npc");
  assert.doesNotMatch(voss[0]!.status, /taken by the party/, "a person is never loot the party is carrying");
});

test("a DM-supplied fact is in the permanent tier on the turn it ARRIVES, not four scenes later", () => {
  // suppliedFacts were parked on the LogEntry and only consumed when that
  // scene became the oldest verbatim entry, four scenes on at the default
  // threshold. A player closing the tab inside that window permanently lost
  // the record the credit they just spent had bought.
  let mem = emptyWorkingMemory();
  mem = addSceneNarration(mem, 3, CAMPAIGN_SCENES[0]!, [
    { category: "npc", key: "alderic-voss", fact: "The tollkeeper at the crossing.", status: "dead, murdered before first light" },
  ]);
  const voss = mem.facts.find((f) => /voss/i.test(f.key));
  assert.ok(voss, `the model's own record must land immediately, got ${JSON.stringify(mem.facts.map((f) => f.key))}`);
  assert.equal(voss!.status, "dead, murdered before first light");
  // Still parked on the entry as a merge hint, so condensation can re-apply
  // it over whatever the heuristic later infers for the same scene.
  assert.ok(mem.log.find((e) => e.sceneSeq === 3)!.suppliedFacts, "the merge hint stays on the entry too");
});

test("a promise discharged in later prose updates the open promise instead of standing beside it as a second one", () => {
  let mem = emptyWorkingMemory();
  mem = foldScene(mem, 0, CAMPAIGN_SCENES[1]!);
  const opened = mem.facts.filter((f) => f.category === "promise");
  assert.equal(opened.length, 1, `expected one open promise, got ${JSON.stringify(opened.map((f) => f.key))}`);
  assert.match(opened[0]!.status, /outstanding/);

  mem = foldScene(
    mem,
    5,
    "You bring Perrin up the track to the mill in the morning with his boots over his shoulder. " +
      "Sella meets you at the door and does not say anything for a long while. " +
      "The promise you made Sella at that gate nine days ago is kept.",
  );

  const promises = mem.facts.filter((f) => f.category === "promise");
  assert.equal(
    promises.length,
    1,
    `a kept promise must update the record, not read as a second unmade one, got ${JSON.stringify(
      promises.map((f) => `${f.key} [${f.status}]`),
    )}`,
  );
  assert.match(promises[0]!.status, /kept/, `got "${promises[0]!.status}"`);
});

test("a DM-typed promise slug lands on the heuristic's promise for the same vow, rather than contradicting it", () => {
  // promptBuilder.ts's own worked example is {"category":"promise",
  // "key":"maren-new-moon"}. The heuristic writes "promise: Perrin & Sella".
  // Two records for one vow, one saying it is owed and one saying it is
  // settled, is the exact shape the fact rule forbids the DM from producing.
  let mem = emptyWorkingMemory();
  mem = foldScene(mem, 0, CAMPAIGN_SCENES[1]!);
  assert.equal(mem.facts.filter((f) => f.category === "promise").length, 1);

  mem = foldScene(mem, 1, "The mill is quiet in the morning and nobody has anything to add.", [
    { category: "promise", key: "perrin-home-before-the-water-drops", fact: "Bring Perrin home.", status: "kept, he is back at the mill" },
  ]);

  const promises = mem.facts.filter((f) => f.category === "promise");
  assert.equal(promises.length, 1, `got ${JSON.stringify(promises.map((f) => `${f.key} [${f.status}]`))}`);
  assert.equal(promises[0]!.status, "kept, he is back at the mill");
});

test("a promise with no resolvable subject is not given a sentence-fragment key that can never be matched again", () => {
  const { extractedFacts } = heuristicSummarize(
    "You swear it on the water and on everything downstream of it. " +
      "Nobody answers, and the rain keeps on across the flat of the race. " +
      "The oath sits badly on you for the rest of the afternoon.",
    4,
  );
  const promises = extractedFacts.filter((f) => f.category === "promise");
  assert.deepEqual(
    promises.map((f) => f.key),
    [],
    "a promise the heuristic cannot name a subject for gets no permanent record at all, rather than one keyed off a " +
      "sentence fragment that no later scene can ever match again",
  );
});
