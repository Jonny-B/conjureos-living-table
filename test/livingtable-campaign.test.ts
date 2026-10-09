/**
 * Tests for written campaigns (src/games/livingtable/campaign/): the module
 * validator, the story-state engine, the brief the DM reads, and the `story`
 * field on a DM turn.
 *
 * The load-bearing ones are the playthroughs at the bottom. Each drives The
 * Quiet Under Blackstone from its first scene to one of its endings through
 * the real engine, using only what a DM turn could report, so a gate that can
 * never open (an act that cannot end, an ending nobody can reach) fails here
 * instead of stranding a player halfway through.
 *
 * Run: npx tsx --test test/livingtable-campaign.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMPAIGN_LIBRARY, findCampaignModule, writtenCampaignsFor } from "../src/games/livingtable/campaign/library";
import { validateCampaignModule } from "../src/games/livingtable/campaign/validate";
import {
  arcOutlineFor,
  attitudeOf,
  coerceStoryState,
  conditionHolds,
  inheritStory,
  initialStoryState,
  locationAt,
  moduleRegionHints,
  stepStory,
} from "../src/games/livingtable/campaign/engine";
import { renderCampaignBrief } from "../src/games/livingtable/campaign/brief";
import { BLACKSTONE } from "../src/games/livingtable/campaign/modules/blackstone";
import type { CampaignModule, StoryState, StoryUpdate } from "../src/games/livingtable/campaign/types";
import { validateDmTurn } from "../src/games/livingtable/dm/turnSchema";
import { buildDmSystemPrompt, type DmPromptArgs } from "../src/games/livingtable/dm/promptBuilder";
import { SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";
import { CREDIT_BUYS, NEW_CAMPAIGN_BLURB, WRITTEN_CAMPAIGNS_HEADING } from "../src/games/livingtable/menu/labels";

const clone = (m: CampaignModule): CampaignModule => structuredClone(m);

// ── the library ─────────────────────────────────────────────────────────

test("every written campaign in the library passes the authoring check", () => {
  assert.ok(CAMPAIGN_LIBRARY.length > 0);
  for (const module of CAMPAIGN_LIBRARY) {
    assert.deepEqual(validateCampaignModule(module), [], `${module.id} has authoring problems`);
  }
});

test("module ids are unique across the library and findable", () => {
  const ids = CAMPAIGN_LIBRARY.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of CAMPAIGN_LIBRARY) assert.equal(findCampaignModule(m.id), m);
  assert.equal(findCampaignModule("no_such_campaign"), undefined);
  assert.equal(findCampaignModule(undefined), undefined);
  assert.ok(writtenCampaignsFor("fantasy").includes(BLACKSTONE));
});

test("every NPC token a written campaign names is a real, placeable token in its genre's roster", () => {
  for (const module of CAMPAIGN_LIBRARY) {
    const sprites = module.template === "fantasy" ? FANTASY_SPRITES : SCIFI_SPRITES;
    const tokens = new Set(sprites.filter((s) => s.kind === "token" && !s.assetId.startsWith("gear_")).map((s) => s.assetId));
    for (const npc of module.npcs) {
      if (npc.token) assert.ok(tokens.has(npc.token), `${module.id}: ${npc.id} names token "${npc.token}", which the ${module.template} roster does not draw`);
    }
  }
});

test("a written campaign's stored outline fits the campaign row's 32 KB cap and points back at its module", () => {
  for (const module of CAMPAIGN_LIBRARY) {
    const outline = arcOutlineFor(module);
    assert.ok(JSON.stringify(outline).length < 32 * 1024);
    assert.deepEqual(outline.module, { id: module.id, version: module.version });
    assert.ok(outline.regionSketch?.some((c) => c.cx === 0 && c.cy === 0), "the opening cell is in the sketch");
    assert.ok(outline.npcs.length > 0 && outline.throughline.length > 0, "a missing module still leaves a plan to steer by");
  }
});

test("the region hints name the written place in every cell it covers", () => {
  const hints = moduleRegionHints(BLACKSTONE);
  assert.match(hints["0,0"]!, /^Blackstone square: /);
  assert.match(hints["-1,-2"]!, /^The barrow-field: /);
  assert.equal(locationAt(BLACKSTONE, 1, -3)?.id, "loc_lower_mine");
  assert.equal(locationAt(BLACKSTONE, 9, 9), undefined);
});

// ── the validator catches what a playtest would not ─────────────────────

test("the validator names a reference to something that does not exist", () => {
  const m = clone(BLACKSTONE);
  m.npcs[0]!.secrets.push("t_nonexistent");
  assert.ok(validateCampaignModule(m).some((p) => p.includes('"t_nonexistent"')));
});

test("the validator names a gate that waits on a flag nothing can ever set", () => {
  const m = clone(BLACKSTONE);
  m.acts[0]!.advanceWhen = { allOf: ["b_mayor_involved", "b_typo_here"] };
  assert.ok(validateCampaignModule(m).some((p) => p.includes('"b_typo_here"') && p.includes("nothing in this campaign can ever set")));
});

test("the validator names a duplicate id, a missing opening cell, and a doubly claimed cell", () => {
  const m = clone(BLACKSTONE);
  m.npcs[1]!.id = m.npcs[0]!.id;
  m.locations[0]!.cells = [{ cx: 1, cy: 0, hint: "moved" }];
  const problems = validateCampaignModule(m);
  assert.ok(problems.some((p) => p.includes("is used twice")));
  assert.ok(problems.some((p) => p.includes("must include cell (0,0)")));
  assert.ok(problems.some((p) => p.includes("is claimed by both")));
});

test("the validator refuses em and en dashes anywhere in a module", () => {
  const m = clone(BLACKSTONE);
  m.premise.hook = "A village \u2014 and its dead.";
  m.npcs[0]!.speech = "Formal \u2013 always.";
  assert.equal(validateCampaignModule(m).filter((p) => p.includes("em or en dash")).length, 2);
});

test("the validator refuses a secret with no way out and an act with no way on", () => {
  const m = clone(BLACKSTONE);
  m.truths.find((t) => t.visibility === "secret")!.learnedVia = [];
  delete m.acts[0]!.advanceWhen;
  const problems = validateCampaignModule(m);
  assert.ok(problems.some((p) => p.includes("no way for it ever to come out")));
  assert.ok(problems.some((p) => p.includes("can never leave it")));
});

// ── the engine ──────────────────────────────────────────────────────────

test("a fresh campaign opens in its first act with every known truth already true", () => {
  const s = initialStoryState(BLACKSTONE);
  assert.equal(s.act, "act_something_wrong");
  assert.ok(s.flags.includes("act:act_something_wrong"));
  assert.ok(s.flags.includes("t_three_missing"));
  assert.deepEqual(s.learned, []);
});

test("conditions: every part that is present must hold", () => {
  const flags = new Set(["a", "b"]);
  assert.ok(conditionHolds(undefined, flags, 0));
  assert.ok(conditionHolds({}, flags, 0));
  assert.ok(conditionHolds({ allOf: ["a", "b"], anyOf: ["z", "a"], noneOf: ["c"], afterScene: 3 }, flags, 3));
  assert.ok(!conditionHolds({ allOf: ["a", "c"] }, flags, 9));
  assert.ok(!conditionHolds({ anyOf: ["y", "z"] }, flags, 9));
  assert.ok(!conditionHolds({ noneOf: ["b"] }, flags, 9));
  assert.ok(!conditionHolds({ afterScene: 4 }, flags, 3));
});

test("a beat whose gate has not opened is refused, with the reason, and nothing is recorded", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { beats: ["b_mayor_involved"] }, 1);
  assert.deepEqual(step.state.beats, []);
  assert.ok(step.notes.some((n) => n.startsWith('STORY: beat "b_mayor_involved" cannot happen yet') && n.includes("evidence_against_mayor (not yet)")));
});

test("one turn's report can be listed in any order: a beat lands on a clue found in the same turn", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { beats: ["b_mayor_involved"], clues: ["cl_tithe_ledger"] }, 1);
  assert.deepEqual(step.state.beats, ["b_mayor_involved"]);
  assert.ok(step.state.flags.includes("evidence_against_mayor"), "the clue's own `sets` flag");
  assert.equal(step.notes.length, 0);
});

test("an unknown id is reported back to the DM and ignored", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { clues: ["cl_made_up"], dead: ["npc_nobody"] }, 1);
  assert.deepEqual(step.state.clues, []);
  assert.deepEqual(step.state.dead, []);
  assert.equal(step.notes.filter((n) => n.includes("is not a")).length, 2);
});

test("a secret cannot come out before its gate opens, whatever the DM reports", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { learned: ["t_corvane_is_buyer"] }, 1);
  assert.deepEqual(step.state.learned, []);
  assert.ok(step.notes.some((n) => n.includes('truth "t_corvane_is_buyer" cannot come out yet') && n.includes("NOT learned")));
});

test("a known truth reported as learned is a harmless no-op", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { learned: ["t_three_missing"] }, 1);
  assert.deepEqual(step.state.learned, []);
  assert.equal(step.notes.length, 0);
});

test("an outcome from an act that has not begun is refused", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { outcomes: ["o_buyer_met"] }, 1);
  assert.deepEqual(step.state.outcomes, []);
  assert.ok(step.notes.some((n) => n.includes("has not begun")));
});

test("an outcome applies the attitude shifts the module wrote for it", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { outcomes: ["o_goblins_allied"] }, 2);
  assert.equal(attitudeOf(BLACKSTONE, step.state, "f_hollow_teeth"), "allied");
  assert.equal(attitudeOf(BLACKSTONE, step.state, "npc_grukka"), "allied");
  assert.equal(attitudeOf(BLACKSTONE, step.state, "npc_snik"), "hostile", "an NPC the outcome does not name keeps the module's attitude");
  assert.ok(step.state.flags.includes("goblin_alliance"));
});

test("a death is recorded as a dead: flag", () => {
  const step = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), { dead: ["npc_snik"] }, 2);
  assert.deepEqual(step.state.dead, ["npc_snik"]);
  assert.ok(step.state.flags.includes("dead:npc_snik"));
});

test("the villain's clock fires on schedule with nobody reporting anything, and tells the DM", () => {
  const before = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), undefined, 11);
  assert.deepEqual(before.state.clock, []);
  const at = stepStory(BLACKSTONE, before.state, undefined, 12);
  assert.deepEqual(at.state.clock, ["c_ridge_walkers"]);
  assert.ok(at.state.flags.includes("village_wants_raid"));
  assert.ok(at.notes.some((n) => n.startsWith("STORY, OFFSCREEN:") && n.includes("shepherd")));
  const again = stepStory(BLACKSTONE, at.state, undefined, 13);
  assert.ok(!again.notes.some((n) => n.includes("shepherd")), "a step fires once");
});

test("cutting off the silver stops the lantern on schedule, and the clock reroutes rather than stalling", () => {
  let s = initialStoryState(BLACKSTONE);
  s = { ...s, act: "act_silver_road", flags: [...s.flags, "act:act_silver_road"] };
  s = stepStory(BLACKSTONE, s, { outcomes: ["o_silver_cut_off"] }, 20).state;
  assert.ok(s.prevented.includes("c_lantern_finished"));
  assert.ok(s.flags.includes("prevented:c_lantern_finished"));
  s = stepStory(BLACKSTONE, s, undefined, 30).state;
  assert.ok(!s.flags.includes("lantern_finished"), "scene 30 passes with the lantern unfinished");
  s = stepStory(BLACKSTONE, s, undefined, 42).state;
  assert.ok(s.clock.includes("c_silver_taken"));
  assert.ok(s.flags.includes("lantern_finished"), "late, by another route");
});

test("a finished campaign does not move any more", () => {
  const ended: StoryState = { ...initialStoryState(BLACKSTONE), ending: "end_dawn" };
  const step = stepStory(BLACKSTONE, ended, { clues: ["cl_tracks"] }, 99);
  assert.equal(step.state, ended);
  assert.deepEqual(step.notes, []);
});

test("a saved state is read back defensively: stale ids dropped, another module's state ignored", () => {
  const raw = {
    moduleId: "blackstone",
    act: "act_gone",
    flags: ["custom_flag"],
    beats: ["b_mayor_involved", "b_removed"],
    clues: ["cl_tracks", 7],
    attitudes: { npc_venn: "hostile", npc_gone: "allied", f_village: "ecstatic" },
    ending: "end_nonexistent",
  };
  const s = coerceStoryState(BLACKSTONE, raw);
  assert.equal(s.act, "act_something_wrong");
  assert.deepEqual(s.beats, ["b_mayor_involved"]);
  assert.deepEqual(s.clues, ["cl_tracks"]);
  assert.deepEqual(s.attitudes, { npc_venn: "hostile" });
  assert.ok(s.flags.includes("custom_flag") && s.flags.includes("t_three_missing"));
  assert.equal(s.ending, undefined);
  assert.deepEqual(coerceStoryState(BLACKSTONE, { ...raw, moduleId: "other" }), initialStoryState(BLACKSTONE));
  assert.deepEqual(coerceStoryState(BLACKSTONE, null), initialStoryState(BLACKSTONE));
});

test("a character rolled in after a death inherits the campaign's latest story, and their own always wins", () => {
  const story = (tag: string) => ({ story: { moduleId: "blackstone", tag } });
  const rows = [
    { id: "dead-old", stats: story("old"), updatedAt: "2026-10-01T00:00:00Z" },
    { id: "dead-new", stats: story("new"), updatedAt: "2026-10-05T00:00:00Z" },
    { id: "fresh", stats: { name: "Ash" }, updatedAt: "2026-10-06T00:00:00Z" },
  ];
  assert.deepEqual(inheritStory("fresh", rows), { moduleId: "blackstone", tag: "new" });
  assert.deepEqual(inheritStory("dead-old", rows), { moduleId: "blackstone", tag: "old" });
  assert.equal(inheritStory("fresh", [rows[2]!]), undefined);
});

// ── the brief ───────────────────────────────────────────────────────────

const brief = (s: StoryState, scene = 0, cx = 0, cy = 0) => renderCampaignBrief(BLACKSTONE, s, { scene, cx, cy });

test("the brief carries no em or en dash, at any point in the campaign", () => {
  const states = [initialStoryState(BLACKSTONE), { ...initialStoryState(BLACKSTONE), act: "act_unburied_king" }];
  for (const s of states) for (const loc of BLACKSTONE.locations) for (const c of loc.cells) assert.doesNotMatch(brief(s, 5, c.cx, c.cy), /[\u2013\u2014]/);
});

test("the brief expands only the current act and never prints a later act's arcs", () => {
  const text = brief(initialStoryState(BLACKSTONE));
  assert.match(text, /ACT 1 OF 3: Act I: Something Is Wrong in Blackstone/);
  assert.match(text, /\[a_missing_three\]/);
  assert.doesNotMatch(text, /\[a_the_buyer\]|\[a_lamplighter\]|\[b_its_over\]/);
  assert.match(text, /LATER ACTS, not in play yet: Act II: The Silver Road; Act III: The Unburied King/);
});

test("a closed secret is printed without its routes; an open one with them", () => {
  const closed = brief(initialStoryState(BLACKSTONE));
  const line = closed.split("\n").find((l) => l.includes("[t_corvane_is_buyer]"))!;
  assert.match(line, /gate CLOSED/);
  assert.doesNotMatch(line, /Routes:/);
  const s = initialStoryState(BLACKSTONE);
  const open = brief({ ...s, act: "act_silver_road", flags: [...s.flags, "act:act_silver_road"] });
  const openLine = open.split("\n").find((l) => l.includes("[t_corvane_is_buyer]"))!;
  assert.match(openLine, /gate OPEN/);
  assert.match(openLine, /Routes: meeting him at the cairn/);
});

test("detail follows the player: the people where they stand in full, the rest of the act in one line", () => {
  const atSquare = brief(initialStoryState(BLACKSTONE), 3, 0, 0);
  assert.match(atSquare, /YOU ARE HERE: \[loc_square\]/);
  assert.match(atSquare, /\[npc_hobb\] Hobb Varley, Blackstone's only watchman\. A broad young man/);
  assert.match(atSquare, /\[npc_grukka\] Grukka Two-Knives, chief of the Hollow Teeth\. Wants right now:/);
  assert.doesNotMatch(atSquare, /Grukka Two-Knives, chief of the Hollow Teeth\. A grey-skinned/);
  const atCamp = brief(initialStoryState(BLACKSTONE), 3, 0, -2);
  assert.match(atCamp, /Grukka Two-Knives, chief of the Hollow Teeth\. A grey-skinned/);
  assert.match(atCamp, /encounter \[e_camp_fight\] Snik's ambush \(combat, medium\): Survive.*\n\s+Who:/);
  const nowhere = brief(initialStoryState(BLACKSTONE), 3, 7, 7);
  assert.match(nowhere, /which this campaign has not written/);
});

test("the opening scene is in the brief on the first turn only", () => {
  assert.match(brief(initialStoryState(BLACKSTONE), 0), /THE OPENING SCENE/);
  assert.doesNotMatch(brief(initialStoryState(BLACKSTONE), 1), /THE OPENING SCENE/);
});

test("the brief shows what the villain's plan has done and what it does next", () => {
  const s = stepStory(BLACKSTONE, initialStoryState(BLACKSTONE), undefined, 12).state;
  const text = brief(s, 13);
  assert.match(text, /What the plan has already done: \[c_ridge_walkers\]/);
  assert.match(text, /\[c_lantern_finished\] Corvane finishes the Grave Lantern.*Happens once: it is scene 30 \(now 13\)/);
  assert.match(text, /\[c_king_wakes\] later, once lantern_finished has happened/);
});

test("the brief stays a size worth sending every turn", () => {
  for (const loc of BLACKSTONE.locations) {
    const c = loc.cells[0]!;
    const size = brief(initialStoryState(BLACKSTONE), 4, c.cx, c.cy).length;
    assert.ok(size < 32_000, `${loc.id}: ${size} characters`);
  }
});

// ── the DM turn and prompt ──────────────────────────────────────────────

test("a DM turn's story report is validated for shape", () => {
  const turn = validateDmTurn({
    narration: "The ledger is cold in your hands.",
    actions: [],
    story: { clues: ["cl_tithe_ledger"], beats: ["b_mayor_involved"], attitudes: [{ id: "npc_venn", attitude: "unfriendly" }] },
  });
  assert.deepEqual(turn.story, { clues: ["cl_tithe_ledger"], beats: ["b_mayor_involved"], attitudes: [{ id: "npc_venn", attitude: "unfriendly" }] });
  assert.equal(validateDmTurn({ narration: "Quiet.", actions: [] }).story, undefined);
  assert.throws(() => validateDmTurn({ narration: "x", actions: [], story: { attitudes: [{ id: "npc_venn", attitude: "furious" }] } }), /attitude/);
  assert.throws(() => validateDmTurn({ narration: "x", actions: [], story: { clues: Array.from({ length: 9 }, (_, i) => `c${i}`) } }), /at most 8/);
  assert.throws(() => validateDmTurn({ narration: "x", actions: [], story: "the mayor did it" }), /story is not an object/);
});

function promptArgs(campaignBrief?: string): DmPromptArgs {
  const unbuilt = (cx: number, cy: number) => ({ status: "unassembled" as const, cell: { cx, cy }, hint: "unexplored", owedOpenings: [] });
  return {
    template: "fantasy",
    campaignTitle: "The Quiet Under Blackstone",
    arcOutline: "PLANNED-OUTLINE-MARKER",
    ...(campaignBrief ? { campaignBrief } : {}),
    memoryContextBlock: "(nothing yet)",
    playspace: undefined,
    currentCell: { cx: 0, cy: 0 },
    offscreenCells: {
      N: unbuilt(0, -1),
      NE: unbuilt(1, -1),
      E: unbuilt(1, 0),
      SE: unbuilt(1, 1),
      S: unbuilt(0, 1),
      SW: unbuilt(-1, 1),
      W: unbuilt(-1, 0),
      NW: unbuilt(-1, -1),
    },
    availableAssetIds: { tiles: ["floor_stone"], tokens: ["token_villager"], props: ["chest"] },
  };
}

test("a written campaign's prompt carries its brief and the story rules in place of the planned outline", () => {
  const text = buildDmSystemPrompt(promptArgs(brief(initialStoryState(BLACKSTONE))));
  assert.match(text, /This is a WRITTEN campaign/);
  assert.match(text, /HOW A WRITTEN CAMPAIGN WORKS/);
  assert.match(text, /"story" is how this written campaign's state moves/);
  assert.match(text, /,"story":\{/);
  assert.doesNotMatch(text, /PLANNED-OUTLINE-MARKER/);
});

test("a planned campaign's prompt is untouched by written campaigns", () => {
  const text = buildDmSystemPrompt(promptArgs());
  assert.match(text, /PLANNED-OUTLINE-MARKER/);
  assert.doesNotMatch(text, /"story"/);
  assert.doesNotMatch(text, /WRITTEN campaign/);
});

// ── copy ────────────────────────────────────────────────────────────────

test("starting a written campaign says what it costs, and the card hook promises no company", () => {
  assert.match(CREDIT_BUYS.startWritten, /no credit to start/i);
  assert.match(NEW_CAMPAIGN_BLURB, /written campaign/i);
  assert.match(WRITTEN_CAMPAIGNS_HEADING, /written campaign/i);
  for (const m of CAMPAIGN_LIBRARY) {
    assert.doesNotMatch(m.premise.hook, /\bpart(y|ies)\b|\bsquad\b|\bteammates?\b|\ballies\b|\bcompanions?\b/i);
    assert.doesNotMatch(m.premise.hook, /\bthe table\b/i);
  }
});

// ── playthroughs: every ending can actually be reached ──────────────────

/** Feed turns through the engine and keep every note, the way PlaySession does. */
function play(turns: [scene: number, update: StoryUpdate | undefined][]): { state: StoryState; notes: string[] } {
  let state = initialStoryState(BLACKSTONE);
  const notes: string[] = [];
  for (const [scene, update] of turns) {
    const step = stepStory(BLACKSTONE, state, update, scene);
    state = step.state;
    notes.push(...step.notes);
  }
  return { state, notes };
}

const REFUSED = /cannot|not recorded|is not a|has not begun|NOT learned/;

test("playthrough: the full campaign to dawn, with every act changing on its own", () => {
  const { state, notes } = play([
    [1, { clues: ["cl_tithe_ledger"], beats: ["b_mayor_involved"] }],
    [3, { beats: ["b_pell_heard"], learned: ["t_grain_toll", "t_oath_seal"] }],
    [5, { clues: ["cl_oath_stone"], outcomes: ["o_goblins_allied"], beats: ["b_something_below"] }],
    [7, { outcomes: ["o_silver_cut_off"], clues: ["cl_archive_seal"], learned: ["t_corvane_is_buyer"], beats: ["b_lamplighter_named"] }],
    [9, { outcomes: ["o_door_held", "o_buyer_followed"], beats: ["b_barrow_entered", "b_tam_alive"] }],
    [11, { learned: ["t_bell_rite", "t_crown_price"], outcomes: ["o_tam_freed", "o_tomb_reached"], beats: ["b_crown_truth"] }],
    [13, { beats: ["b_face_to_face", "b_its_over"], outcomes: ["o_king_at_rest", "o_corvane_let_go"] }],
  ]);
  assert.deepEqual(notes.filter((n) => REFUSED.test(n)), [], "nothing the story allowed was refused");
  assert.ok(notes.some((n) => n.startsWith("STORY: Act II: The Silver Road begins.")));
  assert.ok(notes.some((n) => n.startsWith("STORY: Act III: The Unburied King begins.")));
  assert.equal(state.act, "act_unburied_king");
  assert.equal(state.ending, "end_dawn");
  assert.ok(notes.some((n) => n.includes('"Dawn over Blackstone"')));
  assert.ok(state.prevented.includes("c_lantern_finished"));
  assert.ok(state.prevented.includes("c_door_breaks"));
  assert.ok(state.prevented.includes("c_king_wakes"));
});

test("playthrough: doing nothing ends with the king awake", () => {
  const { state, notes } = play([[12, undefined], [30, undefined], [45, undefined], [60, undefined]]);
  assert.deepEqual(state.clock, ["c_ridge_walkers", "c_lantern_finished", "c_door_breaks", "c_king_wakes"]);
  assert.equal(state.ending, "end_fallen");
  assert.ok(notes.some((n) => n.includes("dead walk into Blackstone")));
});

test("playthrough: the crown on the player's head ends the campaign cold, ahead of every other ending", () => {
  const { state } = play([
    [1, { clues: ["cl_buyer_letters", "cl_scratching"], beats: ["b_mayor_involved", "b_something_below"] }],
    [2, { clues: ["cl_blue_light", "cl_cairn_tunnel"], beats: ["b_lamplighter_named", "b_barrow_entered"] }],
    [3, { outcomes: ["o_player_crowned", "o_lantern_destroyed"], beats: ["b_its_over"] }],
  ]);
  assert.equal(state.ending, "end_cold_crown");
});

test("playthrough: stopping Corvane without the bell leaves a quiet, unfinished ridge", () => {
  const { state } = play([
    [1, { clues: ["cl_tithe_ledger", "cl_oath_stone"], beats: ["b_mayor_involved", "b_something_below"] }],
    [2, { outcomes: ["o_buyer_met"], clues: ["cl_boy_prints"], beats: ["b_lamplighter_named", "b_barrow_entered"] }],
    [3, { outcomes: ["o_corvane_stopped"], dead: ["npc_corvane"], beats: ["b_its_over"] }],
  ]);
  assert.equal(state.ending, "end_quiet_ridge");
  assert.ok(state.flags.includes("dead:npc_corvane"));
});
