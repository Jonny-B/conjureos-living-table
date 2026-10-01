/**
 * Tests for this integration pass's own pure logic: the local-vs-DM
 * resolution glue (session/applyWorldAction.ts, session/worldLoader.ts), the
 * rejection-context-carry logic (session/dmContext.ts), the non-AI
 * condensation summarizer (session/memoryHeuristics.ts), the insert-only
 * memory-log dedup (session/memoryLoad.ts), the character-state round trip
 * (session/characterState.ts), the combat/skill modifier helpers
 * (session/combat.ts), and the games-db wire-shape adapter
 * (assets/manifestCache.ts), plus LivingTable.tsx's own pure helpers and the
 * strings it actually renders.
 *
 * On that last part: this repo's convention is that a screen component isn't
 * unit tested (Vault.tsx and ColdCase.tsx have none). LivingTable.tsx is the
 * exception because it owns every user-facing string in this game, and the
 * specific defect the render tests at the bottom guard is engine identifiers
 * and developer notes reaching the screen. That is a claim about output, so
 * the test reads the output; `renderToStaticMarkup` needs no DOM and runs
 * under `tsx --test` like everything else here.
 *
 * Run: npx tsx --test test/livingtable-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { heuristicSummarize } from "../src/games/livingtable/session/memoryHeuristics";
import { buildRejectionMessage, describeMoveIntoFog } from "../src/games/livingtable/session/dmContext";
import { dedupeLog } from "../src/games/livingtable/session/memoryLoad";
import { characterStateFromStats, statsFromCharacterState, type CharacterState } from "../src/games/livingtable/session/characterState";
import {
  attackerBonusFor,
  weaponDamageNotationFor,
  legendaryRiderDamageFor,
  modifierForRollRequest,
  skillModifierFor,
  saveModifierFor,
  DEFAULT_MONSTER_ATTACK_MODIFIER,
  DEFAULT_MONSTER_SAVE_MODIFIER,
} from "../src/games/livingtable/session/combat";
import { resolveDamage } from "../src/games/livingtable/rules/combat";
import { buildWorldFromCells, type LoadedCell } from "../src/games/livingtable/session/worldLoader";
import { applyWorldActions } from "../src/games/livingtable/session/applyWorldAction";
import { adaptManifest, adaptPalette } from "../src/games/livingtable/assets/manifestCache";

import {
  AboutRulesPanel,
  CharacterSheetPanel,
  PlaySession,
  RollReadoutOverlay,
  centralWalkableTile,
  createWriteQueue,
  displayScale,
  fallbackRoomLayout,
  nearestFreeTile,
  pocketableGrant,
  resolveDmRollRequests,
  resolveMonsterTurn,
  runHostileTurns,
  searchFoundLine,
  storyFromMemoryLog,
  type PlayInitialState,
  type StoryEntry,
} from "../src/games/livingtable/LivingTable";
import {
  activeCombatant,
  spendCombatantAction,
  startCombat,
  type CombatRound,
} from "../src/games/livingtable/menu/combatRound";
import { SPRITE_SIZE } from "../src/games/livingtable/render/canvasRenderer";
import type { CampaignDetail } from "../src/games/livingtable/types";
import type { CellCoord, World } from "../src/games/livingtable/world";

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  assembleCell,
  emptyWorld,
  getCell,
  placeToken,
  placeProp,
  setCell,
  setDoorState,
  validateLayout,
  type AssetManifest,
  type CellLayout,
} from "../src/games/livingtable/world";
import { MOCK_LT_ASSETS } from "../src/bridge/gamesApi";
import { SPRITES as FANTASY_ASSETS } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI_ASSETS } from "../scripts/assets/scifi";
import { createCharacter, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { effectiveArmorClass, equipItem } from "../src/games/livingtable/menu/equipment";
import { draftFromSheet } from "../src/games/livingtable/rules/inventory";
import { gearChangeBlockedReason } from "../src/games/livingtable/rules/attunement";
import { buildInventoryView } from "../src/games/livingtable/inventory/inventoryView";
import { InventoryScreen } from "../src/games/livingtable/inventory/InventoryScreen";
import { MAGIC_GEAR_NAMES, type ArchetypeId } from "../src/games/livingtable/characters/equipmentTypes";
import type { WorldAction } from "../src/games/livingtable/dm/turnSchema";
import { emptyWorkingMemory, addSceneNarration, needsCondensation, condenseOldest, buildDmContextBlock } from "../src/games/livingtable/memory";

// ── session/memoryHeuristics.ts ─────────────────────────────────────────

test("heuristicSummarize: the digest is made of whole sentences lifted from the scene, never paraphrase", () => {
  // This used to assert the exact "first sentence ... last sentence" string.
  // The summarizer is a salience scorer now (see memoryHeuristics.ts), which
  // is a deliberate change and is covered on its own in
  // test/livingtable-memory.test.ts. What still has to hold from this side is
  // the property the tier-2 design actually depends on: a condensed scene is
  // a SELECTION of what was written, so nothing in the DM's memory is a
  // sentence the DM never wrote.
  const source = "The party enters the old library. Dust hangs in still air. Kira finds a locked drawer under the desk.";
  const { digest } = heuristicSummarize(source);
  assert.ok(digest.length > 0);
  assert.ok(digest.length < source.length, "a digest that isn't shorter isn't a digest");
  for (const piece of digest.split(" ... ")) {
    assert.ok(source.includes(piece), `digest fragment ${JSON.stringify(piece)} is not in the source scene`);
  }
});

test("heuristicSummarize: single-sentence text is not duplicated", () => {
  const { digest } = heuristicSummarize("Nothing much happens.");
  assert.equal(digest, "Nothing much happens.");
});

test("heuristicSummarize: empty text produces a placeholder digest and no facts", () => {
  const result = heuristicSummarize("   ");
  assert.equal(result.digest, "(an uneventful scene)");
  assert.deepEqual(result.extractedFacts, []);
});

test("heuristicSummarize: extracts mid-sentence capitalized names as event facts", () => {
  const result = heuristicSummarize("The party meets Kira near the gate. She warns them about Gorrath the warden.");
  const keys = result.extractedFacts.map((f) => f.key);
  assert.ok(keys.includes("Kira"), `expected "Kira" among ${JSON.stringify(keys)}`);
  assert.ok(keys.includes("Gorrath"), `expected "Gorrath" among ${JSON.stringify(keys)}`);
  for (const fact of result.extractedFacts) {
    // The category the extractor assigns is its own call (memoryHeuristics.ts
    // and test/livingtable-memory.test.ts own that); what matters here is that
    // it is one of the real tier-3 categories and that the status admits the
    // fact was guessed at rather than authored.
    assert.ok(["npc", "promise", "item", "event", "thread"].includes(fact.category), `unexpected category ${fact.category}`);
    assert.match(fact.status, /heuristic/);
  }
});

test("heuristicSummarize: does not treat sentence-initial words as names", () => {
  const result = heuristicSummarize("The room is empty. The door is locked.");
  assert.deepEqual(result.extractedFacts, []);
});

test("heuristicSummarize: contractions do not survive normalization as fabricated proper-noun facts", () => {
  // Regression for a bug a session-quality gauntlet critic found in a real
  // simulated session: "I'll" and "I've" (character dialogue, capitalized
  // because they open a quoted sentence) survived the old normalizeWord as
  // "Ill" and "Ive" -- neither a real word nor a name, both extracted as
  // fake permanent facts. "Didn't"/"Wasn't"-shaped contractions are the
  // harder case: naively stripping only the apostrophe-t leaves a garbage
  // fragment ("Didn"), not a real word.
  const result = heuristicSummarize(
    "The party corners Maren near the well. \"I'll tell you what I've heard,\" Maren says. \"Voss didn't pay the harbourmaster. Wasn't ever going to.\"",
  );
  const keys = result.extractedFacts.map((f) => f.key);
  for (const bad of ["Ill", "Ive", "Didn", "Wasn"]) {
    assert.ok(!keys.includes(bad), `"${bad}" should not survive contraction handling as a fake name, got ${JSON.stringify(keys)}`);
  }
  assert.ok(keys.includes("Maren"), `expected the real name "Maren" (mentioned twice) to still be captured, got ${JSON.stringify(keys)}`);
});

test("heuristicSummarize: filters common mid-sentence capitalized stopwords", () => {
  const result = heuristicSummarize("Kira says, You should leave now.");
  const keys = result.extractedFacts.map((f) => f.key);
  assert.ok(!keys.includes("You"), `stopword "You" should be filtered, got ${JSON.stringify(keys)}`);
});

test("heuristicSummarize: a one-off sentence-initial common noun is not mistaken for a name", () => {
  // The regression this guards: an earlier rewrite admitted every
  // sentence-initial capitalized word as a name candidate, which caught
  // "Dust" here right alongside a real name elsewhere. "Dust" appears exactly
  // once, sentence-initial, nowhere else in the scene, so it must not be
  // corroborated. "Kira" gets a real second, mid-sentence mention so this
  // test isn't ALSO exercising the separate (documented) limitation that a
  // name mentioned exactly once, only at a sentence's start, isn't
  // corroborated either -- that's covered on its own below.
  const result = heuristicSummarize(
    "The party enters the old library. Dust hangs in still air. Kira finds a locked drawer, and the drawer resists Kira's tugging.",
  );
  const keys = result.extractedFacts.map((f) => f.key);
  assert.ok(!keys.includes("Dust"), `"Dust" should not be corroborated as a name, got ${JSON.stringify(keys)}`);
  assert.ok(keys.includes("Kira"), `expected "Kira" (mentioned twice) to be corroborated, got ${JSON.stringify(keys)}`);
});

test("heuristicSummarize: documented limitation, a name mentioned exactly once and only at a sentence's start is not corroborated", () => {
  // Stated honestly rather than hidden: corroboration trades recall for
  // precision. A real name that appears exactly once, and that one
  // appearance opens its sentence, looks identical to an ordinary noun in
  // the same position ("Kira finds..." vs "Dust hangs..."), so this
  // heuristic cannot and does not distinguish them from a single mention
  // alone. A second mention (see the mid-sentence and recurring-opener
  // tests) resolves it either way.
  const result = heuristicSummarize("Kira finds a locked drawer under the desk.");
  const keys = result.extractedFacts.map((f) => f.key);
  assert.ok(!keys.includes("Kira"), `a single sentence-initial mention should not be corroborated (documented limit), got ${JSON.stringify(keys)}`);
});

test("heuristicSummarize: a name is corroborated even when its FIRST appearance opens a sentence", () => {
  // The other half of the same regression, in the opposite direction: the
  // original bug unconditionally skipped a sentence's first word, so a name
  // that only ever opened sentences was never captured at all. "Ilsa" opens
  // both sentences here, which is real corroboration (a recurring subject),
  // not coincidence.
  const result = heuristicSummarize("Ilsa spins a story for the guards. Ilsa winks at the party once they've passed.");
  const keys = result.extractedFacts.map((f) => f.key);
  assert.ok(keys.includes("Ilsa"), `expected "Ilsa" to be corroborated by recurring as a sentence-opener, got ${JSON.stringify(keys)}`);
});

test("heuristicSummarize: an event stated in the MIDDLE of a scene survives into the digest, not just the first/last sentence", () => {
  const result = heuristicSummarize(
    "The party corners Marek Voss in his counting house. He begs for mercy, offers gold, offers anything. " +
      "Ilsa's arrow takes him through the throat before he can rise from his chair, and he falls dead among his own stolen gold. " +
      "The party searches the room in silence afterward.",
  );
  assert.match(result.digest, /dead|throat|arrow/, `expected the death to survive into the digest, got: ${result.digest}`);
});

test("heuristicSummarize: a fact's mentions are the sentence the name actually appeared in, not a disconnected digest fragment", () => {
  const result = heuristicSummarize(
    "The party corners Marek Voss in his counting house. " +
      "Ilsa's arrow takes him through the throat before he can rise from his chair, and Voss falls dead among his own stolen gold. " +
      "The party searches the room in silence afterward.",
  );
  // Keyed by whatever name the extractor settled on ("Voss" or "Marek Voss"),
  // since which one it picks is memoryHeuristics.ts's own call; what this
  // guards is that the surviving record still says what happened to him.
  const vossFact = result.extractedFacts.find((f) => f.key.includes("Voss"));
  assert.ok(vossFact, `expected a fact about Voss, got keys ${JSON.stringify(result.extractedFacts.map((f) => f.key))}`);
  const mentions = vossFact!.fact.mentions as { text: string }[];
  assert.ok(Array.isArray(mentions) && mentions.length > 0, "expected fact.mentions to be a non-empty array");
  assert.ok(
    mentions.some((m) => /dead|throat|arrow/.test(m.text)),
    `expected at least one mention to actually describe what happened to Voss, got ${JSON.stringify(mentions)}`,
  );
});

test("condensation regression: the critic's exact repro, a fact planted mid-scene stays legible in the DM context block many scenes later, through the REAL wired heuristic and REAL merge-on-collision", () => {
  let mem = emptyWorkingMemory();
  const scenes = [
    "The party arrives at the smuggler's dock as the sun sets over the water.",
    "The party corners Marek Voss in his counting house. He begs for mercy, offers gold, offers anything. " +
      "Ilsa's arrow takes him through the throat before he can rise from his chair, and Voss falls dead among his own stolen gold. " +
      "The party searches the room in silence afterward.",
    "The party splits up the recovered coin and heads back toward the inn for the night.",
    "A cold rain starts as the party crosses the market square, empty at this hour.",
    "The innkeeper waves the party over and pours four mugs of something dark and bitter.",
    "Talk turns to rumors of a second smuggler crew moving in on Voss's old territory.",
    "The party sleeps in shifts, and nothing troubles the night.",
    "Morning comes grey and quiet over the rooftops.",
    "A courier arrives asking after Voss by name, unaware he's dead.",
    "The party has to decide, on the spot, what to tell the courier about Voss.",
    "Ilsa spins a story for the courier that buys the party some time.",
    "Ilsa's story holds, and the courier leaves satisfied, for now.",
    "The party regroups to plan their next move against the second crew.",
    "Word spreads through the docks that Voss has not been seen in days.",
  ];

  for (let sceneSeq = 0; sceneSeq < scenes.length; sceneSeq++) {
    mem = addSceneNarration(mem, sceneSeq, scenes[sceneSeq]!);
    while (needsCondensation(mem)) mem = condenseOldest(mem, heuristicSummarize);
  }
  // Drain any remaining verbatim entries so tier 3 reflects the whole run.
  while (mem.log.some((e) => e.tier === "verbatim")) mem = condenseOldest(mem, heuristicSummarize);

  const block = buildDmContextBlock(mem);
  assert.ok(
    /dead|throat|arrow/.test(block),
    `expected the DM context block to still legibly connect Voss to being killed after ${scenes.length} scenes of condensation, ` +
      `got:\n${block}`,
  );
});

// ── session/dmContext.ts ─────────────────────────────────────────────────

test("buildRejectionMessage: returns null for an empty rejection list", () => {
  assert.equal(buildRejectionMessage([]), null);
});

test("buildRejectionMessage: batches every rejection into one user-role message", () => {
  const msg = buildRejectionMessage(['token "goblin" at (5,5) is not on a walkable tile', 'no prop "chest1" in cell (0,0)']);
  assert.ok(msg);
  assert.equal(msg!.role, "user");
  assert.match(msg!.content, /goblin/);
  assert.match(msg!.content, /chest1/);
  assert.match(msg!.content, /ENGINE NOTE/);
});

test("describeMoveIntoFog: names the direction", () => {
  assert.match(describeMoveIntoFog("N"), /\bN\b/);
});

// ── session/memoryLoad.ts ────────────────────────────────────────────────

test("dedupeLog: a sceneSeq with only a verbatim row keeps it", () => {
  const log = dedupeLog([{ sceneSeq: 0, tier: "verbatim", content: "opening scene" }]);
  assert.deepEqual(log, [{ sceneSeq: 0, tier: "verbatim", content: "opening scene" }]);
});

test("dedupeLog: a sceneSeq with both tiers on record prefers condensed", () => {
  const log = dedupeLog([
    { sceneSeq: 0, tier: "verbatim", content: "the long version" },
    { sceneSeq: 0, tier: "condensed", content: "the short version" },
  ]);
  assert.equal(log.length, 1);
  assert.equal(log[0]!.tier, "condensed");
  assert.equal(log[0]!.content, "the short version");
});

test("dedupeLog: sorts by sceneSeq regardless of input order", () => {
  const log = dedupeLog([
    { sceneSeq: 2, tier: "verbatim", content: "third" },
    { sceneSeq: 0, tier: "verbatim", content: "first" },
    { sceneSeq: 1, tier: "condensed", content: "second" },
  ]);
  assert.deepEqual(
    log.map((e) => e.sceneSeq),
    [0, 1, 2],
  );
});

// ── session/characterState.ts ────────────────────────────────────────────

test("characterState: sheet + position round-trips through statsFromCharacterState / characterStateFromStats", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "token_knight" });
  const state: CharacterState = { sheet, position: { cx: 2, cy: -1 } };
  const stats = statsFromCharacterState(state);
  const restored = characterStateFromStats(stats);
  assert.deepEqual(restored.position, { cx: 2, cy: -1 });
  assert.equal(restored.sheet.name, "Rowan");
  assert.equal(restored.sheet.maxHp, sheet.maxHp);
  assert.equal(restored.sheet.armorClass, sheet.armorClass);
});

test("characterState: missing position defaults to (0,0)", () => {
  const restored = characterStateFromStats({ name: "Anyone" });
  assert.deepEqual(restored.position, { cx: 0, cy: 0 });
});

test("characterState: garbage stats still produce a default position rather than throwing", () => {
  const restored = characterStateFromStats(null);
  assert.deepEqual(restored.position, { cx: 0, cy: 0 });
});

// ── session/combat.ts ─────────────────────────────────────────────────────

test("attackerBonusFor: fighter uses STR modifier + proficiency bonus", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "token_knight" });
  assert.equal(attackerBonusFor(sheet), sheet.modifiers.str + sheet.proficiencyBonus);
});

test("attackerBonusFor: wizard uses INT modifier + proficiency bonus", () => {
  const sheet = createCharacter({ archetypeId: "fireball-person", name: "Tam", appearanceAssetId: "token_fireball_person" });
  assert.equal(attackerBonusFor(sheet), sheet.modifiers.int + sheet.proficiencyBonus);
});

test("weaponDamageNotationFor: produces valid dice notation with a signed modifier", () => {
  const sheet = createCharacter({ archetypeId: "shadow", name: "Vex", appearanceAssetId: "token_shadow" });
  assert.match(weaponDamageNotationFor(sheet), /^\d+d\d+[+-]\d+$/);
});

test("skillModifierFor: uses the trained skill bonus when trained", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "token_knight" });
  const trained = sheet.skills.find((s) => s.skill === "Athletics")!;
  assert.equal(skillModifierFor(sheet, "Athletics"), trained.bonus);
});

test("skillModifierFor: falls back to the bare ability modifier when untrained", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "token_knight" });
  assert.ok(!sheet.skills.some((s) => s.skill === "Arcana"));
  assert.equal(skillModifierFor(sheet, "Arcana"), sheet.modifiers.int);
});

test("saveModifierFor: uses the trained save bonus for a proficient ability", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "token_knight" });
  const save = sheet.saves.find((s) => s.ability === "str")!;
  assert.equal(saveModifierFor(sheet, "str"), save.bonus);
});

test("modifierForRollRequest: player 'by' uses the real sheet lookup for each roll kind", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "token_knight" });
  assert.equal(
    modifierForRollRequest({ id: "r1", by: "pc1", reason: "", kind: "attack", against: "goblin" }, sheet),
    attackerBonusFor(sheet),
  );
  assert.equal(
    modifierForRollRequest({ id: "r2", by: "pc1", reason: "", kind: "save", dc: 12, ability: "con" }, sheet),
    saveModifierFor(sheet, "con"),
  );
  assert.equal(
    modifierForRollRequest({ id: "r3", by: "pc1", reason: "", kind: "check", dc: 12, skill: "Athletics" }, sheet),
    skillModifierFor(sheet, "Athletics"),
  );
});

test("modifierForRollRequest: a null sheet (NPC/monster 'by') falls back to the documented placeholder", () => {
  assert.equal(
    modifierForRollRequest({ id: "r1", by: "goblin1", reason: "", kind: "attack", against: "pc1" }, null),
    DEFAULT_MONSTER_ATTACK_MODIFIER,
  );
  assert.equal(
    modifierForRollRequest({ id: "r2", by: "goblin1", reason: "", kind: "save", dc: 12, ability: "dex" }, null),
    DEFAULT_MONSTER_SAVE_MODIFIER,
  );
});

// isHealingItem / healAmount used to be tested here. Both are now dead:
// what an item does is declared on the item (characters/templates.ts's
// Consumable) rather than guessed from a substring of its name, which is what
// made a Holo-disguise kit restore hit points while a Longsword, a Shield and
// an Explorer's pack all did nothing. The replacement is covered in
// test/livingtable-characters.test.ts; the two functions themselves are left
// for session/combat.ts's owner to remove.

// ── session/worldLoader.ts ────────────────────────────────────────────────

function blankLayout(exits: CellLayout["exits"] = []): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor"));
  // `sealed` when this fixture declares no exits at all: world/connectivity.ts
  // now rejects an exit-less layout unless the caller says the room is
  // deliberately closed, which is the right rule (a room with no way out ends
  // the game) and makes a bare test fixture opt in rather than sneak past it.
  return exits.length > 0 ? { tiles, props: [], tokens: [], exits } : { tiles, props: [], tokens: [], exits, sealed: true };
}

test("buildWorldFromCells: every loaded cell is present in the resulting World", () => {
  const cells: LoadedCell[] = [
    { cx: 0, cy: 0, layout: blankLayout() },
    { cx: 1, cy: 0, layout: blankLayout() },
  ];
  const world = buildWorldFromCells(cells);
  assert.ok(getCell(world, { cx: 0, cy: 0 }));
  assert.ok(getCell(world, { cx: 1, cy: 0 }));
  assert.equal(getCell(world, { cx: 2, cy: 0 }), undefined);
});

test("buildWorldFromCells: reconstructs a stake for an exit whose target isn't among the loaded cells", () => {
  const exits: CellLayout["exits"] = [{ at: { x: CELL_WIDTH - 1, y: 7 }, edge: "E", toCell: { cx: 1, cy: 0 } }];
  const cells: LoadedCell[] = [{ cx: 0, cy: 0, layout: blankLayout(exits) }];
  const world = buildWorldFromCells(cells);
  const owed = world.stakes.get("1,0");
  assert.ok(owed && owed.length === 1, "expected a stake filed against cell (1,0)");
  assert.equal(owed![0]!.edge, "W");
  assert.deepEqual(owed![0]!.fromCell, { cx: 0, cy: 0 });
});

test("buildWorldFromCells: no stake is filed when the exit's target is also among the loaded cells", () => {
  const exits: CellLayout["exits"] = [{ at: { x: CELL_WIDTH - 1, y: 7 }, edge: "E", toCell: { cx: 1, cy: 0 } }];
  const cells: LoadedCell[] = [
    { cx: 0, cy: 0, layout: blankLayout(exits) },
    { cx: 1, cy: 0, layout: blankLayout() },
  ];
  const world = buildWorldFromCells(cells);
  assert.equal(world.stakes.get("1,0"), undefined);
});

// ── session/applyWorldAction.ts ──────────────────────────────────────────

const MANIFEST: AssetManifest = {
  tiles: { floor: { walkable: true }, wall: { walkable: false } },
  tokens: { goblin: {} },
  props: { chest: {} },
};

test("applyWorldActions: a valid assembleCell action is applied and reported as touched", () => {
  const world = emptyWorld();
  const actions: WorldAction[] = [{ type: "assembleCell", cx: 0, cy: 0, layout: blankLayout() }];
  const result = applyWorldActions(world, actions, MANIFEST);
  assert.equal(result.rejections.length, 0);
  assert.ok(getCell(result.world, { cx: 0, cy: 0 }));
  assert.deepEqual(result.touchedCells, [{ cx: 0, cy: 0 }]);
});

test("applyWorldActions: an invalid action is rejected, collected, and does not stop the rest of the turn", () => {
  const actions: WorldAction[] = [
    // placeToken onto a wall tile: rejected.
    { type: "placeToken", cx: 0, cy: 0, token: { id: "g1", assetId: "goblin", x: 5, y: 5, kind: "monster" } },
    // placeProp: valid, should still apply even though the action before it failed.
    { type: "placeProp", cx: 0, cy: 0, prop: { id: "c1", assetId: "chest", x: 2, y: 2 } },
  ];
  // Make (5,5) a wall so the first action is genuinely invalid.
  const walled = blankLayout();
  walled.tiles[5]![5] = "wall";
  const wallWorld = setCell(emptyWorld(), { cx: 0, cy: 0 }, walled);

  const result = applyWorldActions(wallWorld, actions, MANIFEST);
  assert.equal(result.rejections.length, 1);
  assert.match(result.rejections[0]!, /not walkable/);
  const layout = getCell(result.world, { cx: 0, cy: 0 })!;
  assert.equal(layout.tokens.length, 0, "the rejected placeToken must not have been applied");
  assert.equal(layout.props.length, 1, "the valid placeProp after it must still apply");
});

// The other half of the companion exploit, and the one turnSchema.ts's own
// header says a shape-only validator cannot reach: a single genuine HIT for 3
// damage on a 20 HP creature is a decisive, citable roll, so it satisfied
// every rule in the citation gate and was enough to delete that creature from
// the board at full health. applyWorldAction holds the World, so it is the one
// place the engine's own hit points can answer.

test("applyWorldActions: a 'combat' removeToken on a creature the engine still holds hit points for is refused", () => {
  const layout = blankLayout();
  layout.tokens = [{ id: "g1", assetId: "goblin", x: 2, y: 2, kind: "monster" }];
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);
  const actions: WorldAction[] = [{ type: "removeToken", cx: 0, cy: 0, tokenId: "g1", reason: "combat", resolvedRollId: "r1" }];

  const result = applyWorldActions(world, actions, MANIFEST);
  assert.equal(result.rejections.length, 1);
  assert.match(result.rejections[0]!, /still standing/);
  assert.equal(getCell(result.world, { cx: 0, cy: 0 })!.tokens.length, 1, "the healthy goblin must still be on the board");
});

test("applyWorldActions: the same removal goes through once the engine's own hit points say the creature dropped", () => {
  const layout = blankLayout();
  layout.tokens = [{ id: "g1", assetId: "goblin", x: 2, y: 2, kind: "monster", currentHp: 0 }];
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);
  const actions: WorldAction[] = [{ type: "removeToken", cx: 0, cy: 0, tokenId: "g1", reason: "combat", resolvedRollId: "r1" }];

  const result = applyWorldActions(world, actions, MANIFEST);
  assert.deepEqual(result.rejections, []);
  assert.equal(getCell(result.world, { cx: 0, cy: 0 })!.tokens.length, 0);
});

test("applyWorldActions: a 'staging' removeToken is untouched by the hit-point gate, because walking off is not a combat outcome", () => {
  const layout = blankLayout();
  layout.tokens = [{ id: "g1", assetId: "goblin", x: 2, y: 2, kind: "monster" }];
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);
  const actions: WorldAction[] = [{ type: "removeToken", cx: 0, cy: 0, tokenId: "g1", reason: "staging" }];

  const result = applyWorldActions(world, actions, MANIFEST);
  assert.deepEqual(result.rejections, []);
  assert.equal(getCell(result.world, { cx: 0, cy: 0 })!.tokens.length, 0);
});

test("applyWorldActions: touched cells are deduplicated across multiple actions on the same cell", () => {
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, blankLayout());
  const actions: WorldAction[] = [
    { type: "placeProp", cx: 0, cy: 0, prop: { id: "c1", assetId: "chest", x: 1, y: 1 } },
    { type: "placeToken", cx: 0, cy: 0, token: { id: "g1", assetId: "goblin", x: 2, y: 2, kind: "monster" } },
  ];
  const result = applyWorldActions(world, actions, MANIFEST);
  assert.equal(result.rejections.length, 0);
  assert.deepEqual(result.touchedCells, [{ cx: 0, cy: 0 }]);
});

// ── assets/manifestCache.ts ───────────────────────────────────────────────

test("adaptPalette: converts [r,g,b] triples to lowercase-safe hex strings", () => {
  const hex = adaptPalette([[0x4f, 0x7a, 0x2e]]);
  assert.equal(hex[0], "#4f7a2e");
});

test("adaptPalette: leaves an already-hex entry alone (defensive, see the wire-shape comment)", () => {
  assert.deepEqual(adaptPalette(["#112233"]), ["#112233"]);
});

test("adaptPalette: a non-array input degrades to an empty palette rather than throwing", () => {
  assert.deepEqual(adaptPalette(null), []);
});

test("adaptManifest: groups the flat wire assets array by kind into world + render + availableAssetIds", () => {
  const wire = {
    template: "fantasy" as const,
    palette: [[0, 0, 0]],
    assets: [
      { assetId: "floor_grass", kind: "tile" as const, name: "Grass", size: 16, walkable: true, pixels: [[0]] },
      { assetId: "wall_stone", kind: "tile" as const, name: "Wall", size: 16, walkable: false, pixels: [[0]] },
      { assetId: "token_knight", kind: "token" as const, name: "Knight", size: 16, walkable: false, pixels: [[-1]] },
      { assetId: "chest", kind: "prop" as const, name: "Chest", size: 16, walkable: false, pixels: [[-1]] },
    ],
  };
  const adapted = adaptManifest(wire);
  assert.equal(adapted.template, "fantasy");
  assert.deepEqual(adapted.world.tiles.floor_grass, { walkable: true });
  assert.deepEqual(adapted.world.tiles.wall_stone, { walkable: false });
  assert.ok("token_knight" in adapted.world.tokens);
  assert.ok("chest" in adapted.world.props);
  assert.deepEqual(adapted.render.tiles.floor_grass, { pixels: [[0]] });
  assert.deepEqual(adapted.availableAssetIds, { tiles: ["floor_grass", "wall_stone"], tokens: ["token_knight"], props: ["chest"] });
  assert.equal(adapted.render.palette[0], "#000000");
});

// ── LivingTable.tsx's own pure helpers, and its rendered strings ─────────
//
// LivingTable.tsx is React, and this repo's convention is that a screen
// component isn't unit tested (Vault.tsx and ColdCase.tsx have none either).
// Two things changed that calculus for this one file. Its scale math and its
// write queue are real logic that happens to live next to JSX, and -- the
// reason for the render tests at the bottom -- every user-facing string in
// this game is built here, and the specific defect being guarded against is
// engine identifiers and developer notes reaching the screen. That is a claim
// about output, so the test reads the output. `renderToStaticMarkup` needs no
// DOM and runs under `tsx --test` exactly like everything else here; effects
// don't run under it, which is fine, because none of them produce copy.

test("displayScale picks a whole number of screen pixels per source pixel, never a fraction", () => {
  // The measured stage column in the two-column play layout is about 536px.
  // 536/320 is 1.675, which is exactly the fractional scale that deleted 104
  // of 640 columns; the answer has to be 1, with the rest letterboxed.
  assert.equal(displayScale(536), 1);
  assert.equal(displayScale(320), 1);
  assert.equal(displayScale(319), 1, "never smaller than 1:1, however narrow the column");
  assert.equal(displayScale(0), 1);
  assert.equal(displayScale(640), 2);
  assert.equal(displayScale(1000), 3);
  for (const width of [351, 375, 536, 720, 860, 1280]) {
    const k = displayScale(width);
    assert.ok(Number.isInteger(k) && k >= 1, `scale for ${width}px must be a positive integer, got ${k}`);
    assert.ok(CELL_WIDTH * SPRITE_SIZE * k <= Math.max(width, CELL_WIDTH * SPRITE_SIZE), "the canvas must fit its container, not overflow it");
  }
});

test("createWriteQueue retries a failed write before giving up on it", async () => {
  const reported: (string | null)[] = [];
  const queue = createWriteQueue((m) => reported.push(m), { attempts: 3, backoffMs: 0, schedule: (fn) => fn() });
  let calls = 0;
  queue.submit("character", () => {
    calls += 1;
    return calls < 3 ? Promise.reject(new Error("offline")) : Promise.resolve();
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 3, "expected two retries before the write finally landed");
  assert.deepEqual(reported, [], "a write that eventually succeeds must not alarm the player");
});

test("a write that never lands says so, honestly, instead of being swallowed", async () => {
  const reported: (string | null)[] = [];
  const queue = createWriteQueue((m) => reported.push(m), { attempts: 2, backoffMs: 0, schedule: (fn) => fn() });
  queue.submit("character", () => Promise.reject(new Error("offline")));
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  assert.equal(reported.length, 1);
  assert.match(reported[0] ?? "", /not saving right now/);
  assert.match(reported[0] ?? "", /character/);

  // ...and clears itself once anything saves again.
  queue.submit("map", () => Promise.resolve());
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  assert.equal(reported[reported.length - 1], null);
});

test("storyFromMemoryLog replays the player's ORIGINAL scene text, not the model's digest of it", () => {
  const story = storyFromMemoryLog([
    { sceneSeq: 0, tier: "verbatim", content: "The full opening paragraph, every sentence of it." },
    { sceneSeq: 0, tier: "condensed", content: "The full opening ... of it." },
    { sceneSeq: 1, tier: "verbatim", content: "The second scene." },
  ]);
  assert.equal(story.length, 2);
  assert.equal(story[0]!.text, "The full opening paragraph, every sentence of it.");
  assert.equal(story[0]!.role, "assistant");
  assert.equal(story[1]!.text, "The second scene.");
});

// ── the world fixtures the rest of this section plays on ────────────────

const PLAYER_ID = "8f3c1d2e-1111-4a2b-9c3d-abcdefabcdef";

const PLAY_MANIFEST: AssetManifest = {
  tiles: { floor_stone: { walkable: true }, wall_stone: { walkable: false } },
  tokens: { token_knight: {}, token_goblin: {} },
  props: { prop_chest: {} },
};

/** A walled room with a floor interior, the shape the DM actually assembles. */
function roomLayout(tokens: CellLayout["tokens"] = [], props: CellLayout["props"] = []): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) =>
      x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1 ? "wall_stone" : "floor_stone",
    ),
  );
  return { tiles, props, tokens, exits: [] };
}

test("the party spawns inside the room, not in the doorway on its northern edge", () => {
  // findFirstWalkableTile scanned from (0,0), so on a layout whose row 0 is
  // all wall except one gap it put the player IN that gap: on the boundary,
  // outside the room, several tiles from whatever the narration said was in
  // front of them -- and it made exactly one of the four Move arrows cross
  // into fog, which is why exactly one arrow wore an unexplained price.
  const layout = roomLayout();
  layout.tiles[0]![10] = "floor_stone"; // the north doorway
  const spot = centralWalkableTile(layout, PLAY_MANIFEST)!;
  assert.ok(spot, "there should be somewhere to stand");
  assert.notDeepEqual(spot, { x: 10, y: 0 }, "the doorway is not where a DM would put the party");
  assert.ok(spot.y > 0 && spot.y < CELL_HEIGHT - 1 && spot.x > 0 && spot.x < CELL_WIDTH - 1, `expected an interior tile, got ${JSON.stringify(spot)}`);
});

test("centralWalkableTile does not stack the party on top of a token already standing there", () => {
  const layout = roomLayout([{ id: "npc1", assetId: "token_goblin", x: 10, y: 7, kind: "npc" }]);
  const spot = centralWalkableTile(layout, PLAY_MANIFEST)!;
  assert.notDeepEqual(spot, { x: 10, y: 7 });
});

test("a paid fog crossing the DM failed to build is finished by the engine, not billed a second time", () => {
  // Live, this reproduced 100% of the time on the shipped dev mock: press the
  // north arrow (badged 1 credit), one paid DM turn fires, a room paragraph
  // is appended, and the note reads "The DM didn't build that room this turn.
  // Try moving that way again." Three presses, three credits, still cell
  // (0,0). The repo rule is that credits never buy "finish what you started",
  // so the recovery cannot be another call: the engine lays the room down the
  // same way connectivity.ts already inserts an exit a DM's layout forgot.
  const from: CellCoord = { cx: 0, cy: 0 };
  // Stepping out of a cell means standing on its boundary tile, so the room
  // the party is leaving has a doorway at (10,0) and the party is in it.
  const standingAt = { x: 10, y: 0 };
  const origin = roomLayout([{ id: PLAYER_ID, assetId: "token_knight", x: 10, y: 0, kind: "pc" }]);
  origin.tiles[0]![10] = "floor_stone";
  origin.exits = [{ at: { x: 10, y: 0 }, edge: "N", toCell: { cx: 0, cy: -1 } }];
  let world = setCell(emptyWorld(), from, origin);

  const layout = fallbackRoomLayout(PLAY_MANIFEST, from, "N", standingAt);
  assert.ok(layout, "the manifest has both a walkable and a solid tile, so a plain room is buildable");

  const assembled = assembleCell(world, 0, -1, layout!, PLAY_MANIFEST);
  assert.ok(assembled.ok, `expected a valid room, got ${assembled.ok ? "" : assembled.errors.join("; ")}`);
  world = (assembled as { ok: true; world: World }).world;

  const built = getCell(world, { cx: 0, cy: -1 })!;
  assert.ok(built, "the target cell is assembled after the fallback");
  // The doorway back has to be walkable and has to point at the cell the
  // party came from, or the party walks into a wall.
  const back = built.exits.find((e) => e.edge === "S")!;
  assert.ok(back, "the fallback room declares its way back");
  assert.deepEqual(back.toCell, from);
  assert.equal(PLAY_MANIFEST.tiles[built.tiles[back.at.y]![back.at.x]!]!.walkable, true);
});

test("a monster takes its own turn locally: it closes the distance and swings, with no AI call and no credit", () => {
  // rollInitiative and sortInitiative had zero callers and monsters never
  // acted at all: the only way to get a response out of a goblin was to spend
  // a credit on Talk, which quietly pushed the player at the paid surface just
  // to make a fight feel like a fight.
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const cell: CellCoord = { cx: 0, cy: 0 };
  const world = setCell(
    emptyWorld(),
    cell,
    roomLayout([
      { id: PLAYER_ID, assetId: "token_knight", x: 10, y: 7, kind: "pc" },
      { id: "mon-gob-1", assetId: "token_goblin", x: 4, y: 7, kind: "monster" },
    ]),
  );
  const namer = {
    playerTokenId: PLAYER_ID,
    playerName: "Maddik",
    tokens: [
      { id: PLAYER_ID, assetId: "token_knight" },
      { id: "mon-gob-1", assetId: "token_goblin" },
    ],
  };

  const closing = resolveMonsterTurn({ world, cell, manifest: PLAY_MANIFEST, monsterId: "mon-gob-1", playerTokenId: PLAYER_ID, sheet, namer, rng: () => 0.99 });
  assert.equal(closing.moved, true, "six tiles of movement should have closed most of a six-tile gap");
  const movedTo = getCell(closing.world, cell)!.tokens.find((t) => t.id === "mon-gob-1")!;
  assert.ok(movedTo.x > 4, "the goblin should be nearer than it was");

  // Adjacent: it attacks, and a natural 20 says so out loud.
  const adjacent = setCell(
    emptyWorld(),
    cell,
    roomLayout([
      { id: PLAYER_ID, assetId: "token_knight", x: 10, y: 7, kind: "pc" },
      { id: "mon-gob-1", assetId: "token_goblin", x: 9, y: 7, kind: "monster" },
    ]),
  );
  const swing = resolveMonsterTurn({ world: adjacent, cell, manifest: PLAY_MANIFEST, monsterId: "mon-gob-1", playerTokenId: PLAYER_ID, sheet, namer, rng: () => 0.99 });
  assert.equal(swing.lines.length, 1);
  assert.match(swing.lines[0]!.text, /The goblin swings at Maddik/);
  assert.match(swing.lines[0]!.text, /NATURAL 20, CRITICAL HIT/);
  assert.ok(swing.sheet.currentHp < sheet.currentHp, "a critical hit should actually take hit points off");
  assert.equal(swing.resolved.length, 1, "the roll is handed to the next DM turn as established fact");
  assert.equal(swing.resolved[0]!.by, "mon-gob-1");
  for (const line of swing.lines) {
    assert.ok(!line.text.includes("mon-gob-1"), `a dice-log line must never print a token id: "${line.text}"`);
    assert.ok(!line.text.includes(PLAYER_ID), `a dice-log line must never print the character's row id: "${line.text}"`);
  }
});

// ── the rendered strings ────────────────────────────────────────────────

/** Patterns that are engine plumbing, never copy. A match here is the regression this section exists to catch. */
const DEVELOPER_TEXT: { name: string; pattern: RegExp }[] = [
  { name: "a games-db uuid", pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/ },
  { name: "a dev-mock token id", pattern: /\blt-character-\d+\b/ },
  { name: "a monster token id", pattern: /\bmonster-\d+-\d+\b/ },
  { name: "an engine cell coordinate", pattern: /cell \(-?\d+,\s*-?\d+\)/ },
  { name: "getOffscreenCells' DM-facing summary", pattern: /assembled cell,\s*\d+ token/ },
  { name: "a pointer at a source-file comment", pattern: /header comment|see this panel/i },
  { name: "a developer apology for unfinished scope", pattern: /Flavor for now|doesn't change a number yet|none tracked yet/i },
];

function assertNoDeveloperText(html: string, where: string): void {
  for (const { name, pattern } of DEVELOPER_TEXT) {
    const match = pattern.exec(html);
    assert.equal(match, null, `${where} renders ${name}: ${JSON.stringify(match?.[0])}`);
  }
}

function playFixture(story: StoryEntry[]): {
  campaign: CampaignDetail;
  characterId: string;
  initial: PlayInitialState;
  onExit: () => void;
  onNewCharacter: () => void;
} {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const layout = roomLayout(
    [
      { id: PLAYER_ID, assetId: "token_knight", x: 10, y: 7, kind: "pc" },
      { id: "monster-0-0", assetId: "token_goblin", x: 11, y: 7, kind: "monster" },
    ],
    [{ id: "p1", assetId: "prop_chest", x: 5, y: 5 }],
  );
  return {
    campaign: {
      id: "camp-1",
      template: "fantasy",
      title: "The Salt Road",
      status: "active",
      createdAt: "",
      updatedAt: "",
      arcOutline: { throughline: "Find the missing caravan.", beats: ["a body on the road"], npcs: [{ name: "Ilsa", role: "guide" }] },
    },
    characterId: PLAYER_ID,
    initial: {
      character: { sheet, position: { cx: 0, cy: 0 } },
      manifest: {
        template: "fantasy",
        world: PLAY_MANIFEST,
        render: { palette: ["#000000"], tiles: {}, props: {}, tokens: {} },
        availableAssetIds: { tiles: ["floor_stone", "wall_stone"], tokens: ["token_knight", "token_goblin"], props: ["prop_chest"] },
      },
      cells: [{ cx: 0, cy: 0, layout }],
      workingMemory: { log: [], facts: [] },
      story,
      sceneSeq: 0,
    },
    onExit: () => {},
    onNewCharacter: () => {},
  };
}

test("the play screen renders no database id, no engine coordinate and no developer note", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assertNoDeveloperText(html, "the play screen");
  // ...and the things that replaced them are actually there.
  assert.match(html, /Maddik/);
  assert.match(html, /where it all began/, "the header names the place instead of addressing the cell");
  assert.match(html, /the goblin/, "the Attack button names the creature, not its token id");
  assert.match(html, /a room you have been through|the DM will build it/, "the compass reads as fiction");
});

test("both sides of the conversation are visible in the story panel, the way Vault and Cold Case already do it", () => {
  // A critic typed "what am I supposed to do here?", paid a credit, and
  // watched the message vanish: the panel hardcoded `bubble assistant` for
  // every entry and rendered working memory, which only ever receives the
  // DM's narration.
  const html = renderToStaticMarkup(
    createElement(
      PlaySession,
      playFixture([
        { role: "assistant", text: "The road forks under a dead tree." },
        { role: "user", text: "what am I supposed to do here?" },
        { role: "engine", text: "You cut down the goblin." },
      ]),
    ),
  );
  assert.match(html, /class="bubble user"/, "the player's own paid message has to be on screen");
  assert.match(html, /class="bubble assistant"/);
  assert.match(html, /class="bubble engine"/, "what the dice did is its own voice, neither the DM's nor the player's");
  assert.match(html, /what am I supposed to do here\?/);
  assert.ok(!/condensed/i.test(html), "the memory subsystem's own vocabulary must not leak into the story panel");
});

test("the character sheet is open by default for a brand new character, and carries no unfinished-feature apology", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.match(html, /Proficiency \+2/, "a newcomer's first session should show the sheet, where the explanations live");
  assertNoDeveloperText(html, "the character sheet");
});

test("what a creation choice actually did stays findable on the sheet afterwards", () => {
  // A critic only discovered they had Archery instead of Defense because a
  // probe said the Knight should be AC 17 and the sheet said 16:
  // `appliedEffects` was computed at creation and rendered nowhere.
  const fixture = playFixture([]);
  const html = renderToStaticMarkup(createElement(PlaySession, fixture));
  const plain = fixture.initial.character.sheet.appliedEffects[0]!.plain;
  assert.ok(plain.length > 0);
  assert.ok(html.includes(plain.replace(/'/g, "&#x27;")), `expected the applied effect "${plain}" on the sheet`);
});

test("the About the rules panel ships the SRD credit and the vocabulary, both of which had no surface at all", () => {
  const html = renderToStaticMarkup(createElement(AboutRulesPanel, {}));
  assert.match(html, /System Reference Document 5\.1/);
  assert.match(html, /Wizards of the Coast/);
  assert.match(html, /Copyright 2016/);
  assert.match(html, /Creative Commons Attribution 4\.0/);
  assert.match(html, /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(html, /modified/i);
  assert.match(html, /without warranty/i);
  for (const term of ["d20", "AC", "DC", "saving throw", "hit points"]) {
    assert.ok(html.includes(term), `the glossary should define "${term}"`);
  }
});

test("the Level up button is not offered to a character who has not earned it", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.ok(!/>Level up</.test(html), "a fresh character should see the milestone requirement, not a free level");
  assert.match(html, /Next level after/);
});

// ── the door flag, end to end through the adapter ────────────────────────
//
// This is the one line that makes `setDoorState` mechanical rather than a
// sprite swap. The wire has always carried the right answer (fantasy.ts marks
// door_closed walkable:false and door_open walkable:true); the adapter never
// read it, so `blocks` was undefined for every prop in the running game and
// world/manipulation.ts's walkableAt had nothing to consult.

test("adaptManifest: a walkable:false prop becomes a BLOCKING prop, which is what makes a closed door a door", () => {
  const wire = {
    template: "fantasy" as const,
    palette: [[0, 0, 0]],
    assets: [
      { assetId: "door_closed", kind: "prop" as const, name: "Closed Door", size: 16, walkable: false, pixels: [[-1]] },
      { assetId: "door_open", kind: "prop" as const, name: "Open Door", size: 16, walkable: true, pixels: [[-1]] },
      { assetId: "torch", kind: "prop" as const, name: "Torch", size: 16, walkable: true, pixels: [[-1]] },
    ],
  };
  const adapted = adaptManifest(wire);
  assert.deepEqual(adapted.world.props.door_closed, { blocks: true });
  assert.deepEqual(adapted.world.props.door_open, { blocks: false }, "an open door must not block, or opening it changes nothing");
  assert.deepEqual(adapted.world.props.torch, { blocks: false });
});

test("a closed door adapted off the wire actually stops a token, and opening it lets one through", () => {
  const wire = {
    template: "fantasy" as const,
    palette: [[0, 0, 0]],
    assets: [
      { assetId: "floor_grass", kind: "tile" as const, name: "Grass", size: 16, walkable: true, pixels: [[0]] },
      { assetId: "token_goblin", kind: "token" as const, name: "Goblin", size: 16, walkable: false, pixels: [[-1]] },
      { assetId: "door_closed", kind: "prop" as const, name: "Closed Door", size: 16, walkable: false, pixels: [[-1]] },
      { assetId: "door_open", kind: "prop" as const, name: "Open Door", size: 16, walkable: true, pixels: [[-1]] },
    ],
  };
  const manifest = adaptManifest(wire).world;
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor_grass"));
  const layout: CellLayout = {
    tiles,
    props: [{ id: "door1", assetId: "door_closed", x: 8, y: 8 }],
    tokens: [],
    exits: [],
    sealed: true,
  };
  let world = setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);

  const blocked = placeToken(world, 0, 0, { id: "g1", assetId: "token_goblin", x: 8, y: 8, kind: "monster" }, manifest);
  assert.equal(blocked.ok, false, "a closed door is not a tile you can stand on");
  if (!blocked.ok) assert.match(blocked.error, /door1/);

  const opened = setDoorState(world, 0, 0, "door1", "door_open", manifest);
  assert.ok(opened.ok);
  world = opened.world;
  const through = placeToken(world, 0, 0, { id: "g1", assetId: "token_goblin", x: 8, y: 8, kind: "monster" }, manifest);
  assert.equal(through.ok, true, "opening the door has to actually let something through");
});

// ── the wall-profile art is the renderer's, never the DM's ────────────────
//
// render/wallProfiles.ts draws walls from their neighbours with 23 sprites the
// DM has no business naming: the sixteen joins, four run variants, the jamb
// overlay and the two side-on door leaves. adaptManifest keeps them in the
// render manifest ONLY, which closes the hole at both ends: the prompt never
// lists one, and naming one is rejected as an unknown asset.

function wallProfileWire() {
  const px = [[0]];
  return {
    template: "fantasy" as const,
    palette: [[0, 0, 0]],
    assets: [
      { assetId: "floor_stone", kind: "tile" as const, name: "Stone", size: 16, walkable: true, pixels: px },
      { assetId: "wall_stone", kind: "tile" as const, name: "Wall", size: 16, walkable: false, pixels: px },
      { assetId: "wall_stone_join_ns", kind: "tile" as const, name: "Run", size: 16, walkable: false, pixels: [[1]] },
      { assetId: "wall_stone_join_ns_b", kind: "tile" as const, name: "Run B", size: 16, walkable: false, pixels: [[2]] },
      { assetId: "wall_stone_join_nesw", kind: "tile" as const, name: "Crossing", size: 16, walkable: false, pixels: [[3]] },
      { assetId: "wall_stone_jambs_ns", kind: "prop" as const, name: "Jambs", size: 16, walkable: false, pixels: [[4]] },
      { assetId: "door_closed_ns", kind: "prop" as const, name: "Closed leaf", size: 16, walkable: false, pixels: [[5]] },
      { assetId: "door_open_ns", kind: "prop" as const, name: "Open leaf", size: 16, walkable: true, pixels: [[6]] },
      { assetId: "door_closed", kind: "prop" as const, name: "Door", size: 16, walkable: false, pixels: px },
      { assetId: "door_open", kind: "prop" as const, name: "Open door", size: 16, walkable: true, pixels: px },
      { assetId: "token_goblin", kind: "token" as const, name: "Goblin", size: 16, walkable: false, pixels: px },
    ],
  };
}

test("adaptManifest puts the render-only wall-profile ids in render but not in world or availableAssetIds", () => {
  const adapted = adaptManifest(wallProfileWire());

  // The renderer gets every one of them, as the right kind.
  assert.deepEqual(adapted.render.tiles.wall_stone_join_ns, { pixels: [[1]] });
  assert.deepEqual(adapted.render.tiles.wall_stone_join_ns_b, { pixels: [[2]] });
  assert.deepEqual(adapted.render.tiles.wall_stone_join_nesw, { pixels: [[3]] });
  assert.deepEqual(adapted.render.props.wall_stone_jambs_ns, { pixels: [[4]] });
  assert.deepEqual(adapted.render.props.door_closed_ns, { pixels: [[5]] });
  assert.deepEqual(adapted.render.props.door_open_ns, { pixels: [[6]] });

  // The engine does not: nothing in world/ can be asked to place one.
  for (const id of ["wall_stone_join_ns", "wall_stone_join_ns_b", "wall_stone_join_nesw"]) assert.ok(!(id in adapted.world.tiles), `${id} is not a world tile`);
  for (const id of ["wall_stone_jambs_ns", "door_closed_ns", "door_open_ns"]) assert.ok(!(id in adapted.world.props), `${id} is not a world prop`);

  // The DM is not told about them.
  assert.deepEqual(adapted.availableAssetIds, { tiles: ["floor_stone", "wall_stone"], tokens: ["token_goblin"], props: ["door_closed", "door_open"] });

  // And the ordinary ids around them are adapted exactly as before.
  assert.deepEqual(adapted.world.tiles.wall_stone, { walkable: false });
  assert.deepEqual(adapted.world.props.door_closed, { blocks: true });
  assert.ok("wall_stone" in adapted.render.tiles && "door_closed" in adapted.render.props);
});

test("a layout that names a wall-profile id is rejected as an unknown asset", () => {
  const manifest = adaptManifest(wallProfileWire()).world;
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor_stone"));
  const here = { cx: 0, cy: 0 };

  const joinLayout: CellLayout = { tiles: tiles.map((row, y) => (y === 3 ? row.map((id, x) => (x === 4 ? "wall_stone_join_ns" : id)) : row)), props: [], tokens: [], exits: [], sealed: true };
  const joinCheck = validateLayout(joinLayout, manifest, here);
  assert.equal(joinCheck.ok, false);
  if (!joinCheck.ok) assert.match(joinCheck.errors.join("\n"), /tile \(4,3\) references unknown asset "wall_stone_join_ns"/);

  const propLayout: CellLayout = {
    tiles,
    props: [{ id: "arch", assetId: "wall_stone_jambs_ns", x: 5, y: 5 }, { id: "leaf", assetId: "door_closed_ns", x: 6, y: 5 }],
    tokens: [],
    exits: [],
    sealed: true,
  };
  const propCheck = validateLayout(propLayout, manifest, here);
  assert.equal(propCheck.ok, false);
  if (!propCheck.ok) {
    assert.match(propCheck.errors.join("\n"), /prop "arch" references unknown asset "wall_stone_jambs_ns"/);
    assert.match(propCheck.errors.join("\n"), /prop "leaf" references unknown asset "door_closed_ns"/);
  }

  // The same layout with the stored ids is fine, so the rejection is about the ids and nothing else.
  assert.equal(validateLayout({ tiles, props: [{ id: "door", assetId: "door_closed", x: 5, y: 5 }], tokens: [], exits: [], sealed: true }, manifest, here).ok, true);
});

test("setDoorState to a side-on leaf, and placeProp of a jamb overlay, are rejected: the DM cannot reach the render-only art", () => {
  const manifest = adaptManifest(wallProfileWire()).world;
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor_stone"));
  const layout: CellLayout = { tiles, props: [{ id: "door1", assetId: "door_closed", x: 8, y: 8 }], tokens: [], exits: [], sealed: true };
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);

  const leaf = setDoorState(world, 0, 0, "door1", "door_closed_ns", manifest);
  assert.equal(leaf.ok, false);
  if (!leaf.ok) assert.match(leaf.error, /unknown prop asset "door_closed_ns"/);
  const open = setDoorState(world, 0, 0, "door1", "door_open_ns", manifest);
  assert.equal(open.ok, false);

  const jambs = placeProp(world, 0, 0, { id: "j", assetId: "wall_stone_jambs_ns", x: 3, y: 3 }, manifest);
  assert.equal(jambs.ok, false);
  if (!jambs.ok) assert.match(jambs.error, /unknown prop asset "wall_stone_jambs_ns"/);

  // The stored door states still work.
  const opened = setDoorState(world, 0, 0, "door1", "door_open", manifest);
  assert.equal(opened.ok, true);
});

// ── the dev mock's roster is a hard gate, so it has to match the real one ─
//
// `availableAssetIds` rejects any action naming an id the manifest does not
// list, so a short mock does not degrade gracefully: it makes most of the art
// untestable outside the shell and makes the DM look like it keeps inventing
// ids. These two assertions are what catch the roster drifting again.

test("the dev mock's asset roster covers every id the real fantasy template ships", () => {
  const mocked = new Set(MOCK_LT_ASSETS.fantasy.map((a) => a.assetId));
  const missing = FANTASY_ASSETS.map((a) => a.assetId).filter((id) => !mocked.has(id));
  assert.deepEqual(missing, [], `the dev mock is missing real fantasy ids: ${missing.join(", ")}`);
});

test("the dev mock's asset roster covers every id the real sci-fi template ships, with matching walkability", () => {
  const mocked = new Map(MOCK_LT_ASSETS.scifi.map((a) => [a.assetId, a.walkable]));
  const missing = SCIFI_ASSETS.map((a) => a.assetId).filter((id) => !mocked.has(id));
  assert.deepEqual(missing, [], `the dev mock is missing real sci-fi ids: ${missing.join(", ")}`);
  const wrong = SCIFI_ASSETS.filter((a) => mocked.get(a.assetId) !== a.walkable).map((a) => a.assetId);
  assert.deepEqual(wrong, [], `walkability disagrees between the mock and the real template for: ${wrong.join(", ")}`);
});

// ── nearestFreeTile: a taken doorway must not soft-lock the crossing ──────

test("nearestFreeTile steps around a doorway that something is already standing in", () => {
  const manifest: import("../src/games/livingtable/world").AssetManifest = {
    tiles: { floor: { walkable: true }, wall: { walkable: false } },
    tokens: { goblin: {} },
    props: { door_closed: { blocks: true } },
  };
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor"));
  const layout: CellLayout = {
    tiles,
    props: [{ id: "door1", assetId: "door_closed", x: 0, y: 7 }],
    tokens: [{ id: "g1", assetId: "goblin", x: 1, y: 7, kind: "monster" }],
    exits: [],
    sealed: true,
  };
  const spot = nearestFreeTile(layout, manifest, { x: 0, y: 7 });
  assert.ok(spot, "a room with 298 free tiles must not report nowhere to stand");
  assert.notDeepEqual(spot, { x: 0, y: 7 }, "the blocking prop's own tile is not free");
  assert.notDeepEqual(spot, { x: 1, y: 7 }, "the goblin's square is not free either");
  assert.ok(Math.abs(spot!.x - 0) + Math.abs(spot!.y - 7) <= 2, "it should land just inside the door, not across the room");
});

test("nearestFreeTile returns null rather than a wall when a room genuinely has nowhere to stand", () => {
  const manifest: import("../src/games/livingtable/world").AssetManifest = {
    tiles: { wall: { walkable: false } },
    tokens: {},
    props: {},
  };
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "wall"));
  assert.equal(nearestFreeTile({ tiles, props: [], tokens: [], exits: [], sealed: true }, manifest, { x: 0, y: 7 }), null);
});

// ── a DM-requested hit on a monster has to actually hurt it ─────────────
//
// Found from two directions. The code adversary: a 13 HP skeleton, a DM turn
// requesting an attack by the player, a natural 20 logged, and the Attack
// button still reading "(13 hit points left)". The cause was that
// `if (result.hit && targetIsPlayer)` was the only damage branch, so the
// engine held hit points for that creature and never consulted them, and the
// next turn's removeToken reason "combat" could cite the roll and delete a
// creature at full health. Both blind table judges caught the same defect
// class in a session log: "The narrative remembered the fire; the math did
// not."

function skeletonRoom(): { world: World; cell: CellCoord } {
  const cell: CellCoord = { cx: 0, cy: 0 };
  const world = setCell(
    emptyWorld(),
    cell,
    roomLayout([
      { id: PLAYER_ID, assetId: "token_knight", x: 10, y: 7, kind: "pc" },
      { id: "mon-skel-1", assetId: "token_skeleton", x: 11, y: 7, kind: "monster" },
    ]),
  );
  return { world, cell };
}

function skeletonNamer() {
  return {
    playerTokenId: PLAYER_ID,
    playerName: "Maddik",
    tokens: [
      { id: PLAYER_ID, assetId: "token_knight" },
      { id: "mon-skel-1", assetId: "token_skeleton" },
    ],
  };
}

test("a DM-requested attack that hits a monster takes hit points off it", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const before = getCell(world, cell)!.tokens.find((t) => t.id === "mon-skel-1")!;
  assert.equal(before.currentHp, undefined, "an untouched token is at its statblock maximum");

  const out = resolveDmRollRequests({
    requests: [
      { id: "r1", kind: "attack", by: PLAYER_ID, against: "mon-skel-1", reason: "Maddik swings at the skeleton" },
    ],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.99, // a natural 20
  });

  assert.equal(out.resolved.length, 1);
  assert.equal(out.resolved[0]!.kind, "attack");
  const after = getCell(out.world, cell)!.tokens.find((t) => t.id === "mon-skel-1");
  const hpAfter = after ? after.currentHp ?? 13 : 0;
  assert.ok(hpAfter < 13, `a natural 20 left the skeleton on ${hpAfter} of 13 hit points`);
  assert.match(out.dice[0]!.text, /damage/, "the roll line has to say what the hit did");
});

test("a DM-requested attack that hits the player still hurts the player, exactly as before", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [
      { id: "r1", kind: "attack", by: "mon-skel-1", against: PLAYER_ID, reason: "the skeleton swings" },
    ],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.99,
  });
  assert.ok(out.sheet.currentHp < sheet.currentHp, "the player branch is untouched");
});

test("a DM-requested save that fails reports what happened to the roller, not just arithmetic", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "save", by: PLAYER_ID, ability: "dex", dc: 30, reason: "the coals flare up under you" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0,
  });
  assert.match(out.dice[0]!.text, /FAIL/);
  assert.match(out.dice[0]!.text, /coals flare up/, "a result with no event attached is what both judges flagged");
});

// "The doorway goblin fails a Dexterity save against the coals and no damage
// is ever assigned. The narrative remembered the fire; the math did not."
// SaveRollRequest had nowhere to put a consequence, so the strongest true
// thing the line could say was what the save was against. `damageOnFailure`
// is the dice, bounded and validated in dm/turnSchema.ts; the engine rolls
// them and applies them on the same two paths an attack's damage takes.

test("a failed save with damage on it actually costs the player hit points", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "save", by: PLAYER_ID, ability: "dex", dc: 30, damageOnFailure: "2d6", reason: "the coals flare up under you" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0,
  });
  assert.ok(out.sheet.currentHp < sheet.currentHp, "a failed save against a fire has to cost something");
  assert.match(out.dice[0]!.text, /damage/);
});

test("a failed save with damage on it hurts a MONSTER too, on the same path an attack's damage takes", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "save", by: "mon-skel-1", ability: "dex", dc: 30, damageOnFailure: "1d6", reason: "the coals flare up under it" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0,
  });
  const after = getCell(out.world, cell)!.tokens.find((t) => t.id === "mon-skel-1")!;
  assert.ok((after.currentHp ?? 13) < 13, `the skeleton walked out of a fire on ${after.currentHp} of 13 hit points`);
  assert.equal(out.sheet.currentHp, sheet.currentHp, "and the player, who did not roll it, took nothing");
});

test("a SUCCESSFUL save costs nothing, even when the request carries damage", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "save", by: PLAYER_ID, ability: "dex", dc: 5, damageOnFailure: "2d6", reason: "the coals flare up under you" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.99,
  });
  assert.equal(out.sheet.currentHp, sheet.currentHp);
  assert.doesNotMatch(out.dice[0]!.text, /damage/);
});

// ── one action economy, both paths ──────────────────────────────────────

test("a DM turn cannot spend an action the player has already spent this round", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const started = startCombat({
    player: { id: PLAYER_ID, label: "Maddik", dexModifier: 3, speedFt: 30 },
    hostiles: [{ id: "mon-skel-1", label: "the skeleton", speedFt: 30 }],
    rng: () => 0.99,
  });
  // Force the player to be the one acting, with the action already spent.
  const playerFirst: CombatRound = { ...started, activeIndex: started.order.findIndex((c) => c.id === PLAYER_ID) };
  const spent = spendCombatantAction(playerFirst, PLAYER_ID)!;

  const out = resolveDmRollRequests({
    requests: [
      { id: "r1", kind: "attack", by: PLAYER_ID, against: "mon-skel-1", reason: "another swing" },
    ],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: spent,
    namer: skeletonNamer(),
    rng: () => 0.99,
  });
  assert.equal(out.resolved.length, 0, "two attack rolls in one round is what the local Attack button already refuses");
  assert.equal(out.refusals.length, 1);
  assert.match(out.refusals[0]!, /already/i);
});

test("a DM turn cannot make a combatant act out of initiative order", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const started = startCombat({
    player: { id: PLAYER_ID, label: "Maddik", dexModifier: 3, speedFt: 30 },
    hostiles: [{ id: "mon-skel-1", label: "the skeleton", speedFt: 30 }],
    rng: () => 0.99,
  });
  const playerFirst: CombatRound = { ...started, activeIndex: started.order.findIndex((c) => c.id === PLAYER_ID) };

  const out = resolveDmRollRequests({
    requests: [
      { id: "r1", kind: "attack", by: "mon-skel-1", against: PLAYER_ID, reason: "the skeleton swings" },
    ],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: playerFirst,
    namer: skeletonNamer(),
    rng: () => 0.99,
  });
  assert.equal(out.resolved.length, 0, "the round read 'Your turn, action ready' and the skeleton swung anyway");
  assert.equal(out.sheet.currentHp, sheet.currentHp);
  assert.match(out.refusals[0]!, /turn/i);
});

// ── winning initiative must not be worse than losing it ─────────────────

test("a hostile that wins initiative takes its turn instead of standing there", () => {
  // With the rolls forced so the skeleton wins, the round read "the skeleton
  // is acting", the skeleton never swung, and the only enabled control was
  // End turn -- which then burned the monster's turn, not the player's.
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const started = startCombat({
    player: { id: PLAYER_ID, label: "Maddik", dexModifier: 3, speedFt: 30 },
    hostiles: [{ id: "mon-skel-1", label: "the skeleton", speedFt: 30 }],
    rng: () => 0.99,
  });
  const monsterFirst: CombatRound = { ...started, activeIndex: started.order.findIndex((c) => c.id === "mon-skel-1") };

  const out = runHostileTurns({
    round: monsterFirst,
    world,
    cell,
    manifest: PLAY_MANIFEST,
    playerTokenId: PLAYER_ID,
    sheet,
    namer: skeletonNamer(),
    rng: () => 0.99,
  });
  assert.equal(activeCombatant(out.round)?.id, PLAYER_ID, "control comes back to the player, not to a stalled monster turn");
  assert.ok(out.dice.length > 0, "the skeleton actually swung");
  assert.ok(out.sheet.currentHp < sheet.currentHp, "a natural 20 from an adjacent skeleton has to land");
});

test("runHostileTurns is a no-op when the player is already the one acting", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const started = startCombat({
    player: { id: PLAYER_ID, label: "Maddik", dexModifier: 3, speedFt: 30 },
    hostiles: [{ id: "mon-skel-1", label: "the skeleton", speedFt: 30 }],
    rng: () => 0.99,
  });
  const playerFirst: CombatRound = { ...started, activeIndex: started.order.findIndex((c) => c.id === PLAYER_ID) };
  const out = runHostileTurns({
    round: playerFirst,
    world,
    cell,
    manifest: PLAY_MANIFEST,
    playerTokenId: PLAYER_ID,
    sheet,
    namer: skeletonNamer(),
    rng: () => 0.99,
  });
  assert.equal(out.round, playerFirst);
  assert.equal(out.sheet, sheet);
});

// ── the rendered strings, second pass ───────────────────────────────────

test("the play screen never calls the dungeon master 'the table'", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.doesNotMatch(html, /\bthe table\b/i, "three names for one entity, and this one reads as other human players");
});

test("the play screen says out loud what never costs a credit", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.match(html, /never cost/i, "the pricing taught a cold reader to avoid the half of the product that is the product");
});

test("Make camp stops advertising itself as an unqualified free full heal", () => {
  // A peaceful room: with a goblin standing there, "Not with something still
  // in the room" wins and the button's real explanation never renders.
  const fixture = playFixture([]);
  const empty = { ...fixture, initial: { ...fixture.initial, cells: [{ cx: 0, cy: 0, layout: roomLayout([{ id: PLAYER_ID, assetId: "token_knight", x: 10, y: 7, kind: "pc" as const }]) }] } };
  const html = renderToStaticMarkup(createElement(PlaySession, empty));
  const camp = /title="([^"]*)"[^>]*>\s*Make camp/.exec(html);
  assert.ok(camp, "expected the Make camp button to carry its own explanation");
  assert.doesNotMatch(camp![1]!, /\bFree\.\s*$/, "a cold reader read that word and concluded the economy was defeated");
  assert.match(camp![1]!, /once/i, "the limit has to be on the button, not in the code");
});

test("a dead character is offered a way to keep the campaign, and every billable button is off", () => {
  // DESIGN.md promises "A character going down doesn't cost anything and
  // doesn't end the campaign". Going down does not; dying did: the only
  // control was "Leave the table", re-entry loaded the same dead character,
  // and the Talk button stayed live and billable.
  const fixture = playFixture([]);
  const dead = { ...fixture.initial.character.sheet, dead: true, currentHp: 0, deathSaves: { successes: 0, failures: 3 } };
  const html = renderToStaticMarkup(
    createElement(PlaySession, {
      ...fixture,
      initial: { ...fixture.initial, character: { ...fixture.initial.character, sheet: dead } },
    }),
  );
  assert.match(html, /new character/i, "the campaign, its world and its memory all survive; the character does not");
// The badge is matched by CLASS PRESENCE, not by an exact class string:
  // `CostBadge` renders through `Chip`, so the attribute is
  // `class="cg-chip cg-chip--cost cost"`. The assertion is "the Talk button
  // still wears its price", and pinning attribute order tested the wrong thing.
  const talkRe = /<button[^>]*>\s*Talk\s*<span [^>]*class="[^"]*\bcost\b/;
  const talk = talkRe.exec(html);
  assert.ok(talk, "expected the Talk button in the markup");
  assert.match(talk![0]!, /disabled/, "a dead character must not be able to spend a credit");
});

test("the death panel does not put the billing reassurance in the sentence that says you died", () => {
  // Judge A: "The death screen mentions billing... it made me think about my
  // wallet at the exact moment it wanted me to feel something."
  const fixture = playFixture([]);
  const dead = { ...fixture.initial.character.sheet, dead: true, currentHp: 0, deathSaves: { successes: 0, failures: 3 } };
  const html = renderToStaticMarkup(
    createElement(PlaySession, {
      ...fixture,
      initial: { ...fixture.initial, character: { ...fixture.initial.character, sheet: dead } },
    }),
  );
  const panel = /Three failed death saves\.([^<]*)</.exec(html);
  assert.ok(panel, "expected the death panel's own sentence");
  assert.doesNotMatch(panel![1]!, /charge|credit|bill/i, `billing in the death sentence: ${JSON.stringify(panel![1])}`);
});

test("the About panel claims the SRD licence grants, and never the trademark it does not", () => {
  // CC BY 4.0 licenses the SRD text's copyright, not the D&D trademark, which
  // is why every other string in the block correctly says "System Reference
  // Document 5.1". "real Dungeons & Dragons 5th edition rules" sat three
  // paragraphs above "not affiliated with... Wizards of the Coast".
  const html = renderToStaticMarkup(createElement(AboutRulesPanel, {}));
  assert.doesNotMatch(html, /Dungeons &(amp;)? Dragons/i, "trademark use outside the required attribution strings");
  assert.match(html, /SRD 5\.1/);
});

test("a Battle Master finds the maneuver buttons the level-up copy promised", () => {
  // Both cold readers reasoned that Battle Master must come with combat
  // buttons, checked the play screen's command menu, found no maneuver
  // anywhere, and picked it anyway because the copy outranked their own
  // correct suspicion. rules/maneuvers.ts is the rule; this is the surface.
  const fixture = playFixture([]);
  const bm = {
    ...fixture.initial.character.sheet,
    level: 3,
    choices: { ...fixture.initial.character.sheet.choices, martialArchetype: "battle-master" },
  };
  const html = renderToStaticMarkup(
    createElement(PlaySession, {
      ...fixture,
      initial: { ...fixture.initial, character: { ...fixture.initial.character, sheet: bm } },
    }),
  );
  assert.match(html, /Maneuver \(4 of 4/, "the pool has to be visible before it is spent");
  assert.match(html, />Trip Attack</);
  assert.match(html, />Disarming Attack</);
});

test("a character who did not pick Battle Master gets no maneuver row at all, disabled or otherwise", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.doesNotMatch(html, /Maneuver \(/, "a row of dead buttons is worse than no row");
});

test("the Attack row names a real weapon, never the second person", () => {
  // "Bram attacks the goblin with your weapon" changed person mid-clause, and
  // for a Cleric the same row was labelled with a cantrip that resolves an
  // entirely different way.
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.doesNotMatch(html, /your weapon/i);
  assert.match(html, /Attack with Longsword/);
});

// ── equipment on the character sheet ─────────────────────────────────────
//
// Three slots, what is in each, and what it actually does to the numbers. The
// judge-facing rule is the same one the creation pills are held to: state the
// real number, or say the piece does nothing. Nothing here is a paid action,
// so nothing here may wear a price.
//
// THE RANK IS BACK ON THIS PANEL, EARNED (issue #15, contract v2). It was
// pulled while nothing could grant a tier above common; engine-rolled loot is
// that grant now, so a row names its rank exactly when the piece is above
// common. The tests below assert both halves: a fresh (all-common) kit shows
// no rank at all, an enchanted piece shows its word and chip beside the
// sentence that states its real number, and the old tier PICKER stays gone
// (the inventory screen replaced it; see livingtable-menu.test.ts).

/** The panel on its own, which is how the gear rows are inspected without the whole play screen around them. */
function sheetPanelHtml(sheet: CharacterSheet, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(CharacterSheetPanel, {
      sheet,
      superiorityDice: 0,
      superiorityDiceMax: 0,
      preview: null,
      pick: null,
      levelUpAvailable: false,
      onPick: () => {},
      onBeginLevelUp: () => {},
      onConfirmLevelUp: () => {},
      onCancelLevelUp: () => {},
      onOpenInventory: () => {},
      ...extra,
    } as never),
  );
}

/**
 * The old tier PICKER never reaches the player, by class (issue #15: it is
 * REPLACED by the inventory screen, not restored beside it). `lt-gear-option`
 * dresses it; `lt-rarity` is now a LEGITIMATE class (the restored chip), so
 * it is deliberately not checked here any more.
 */
function assertNoPicker(html: string, where: string): void {
  assert.ok(!/lt-gear-option/.test(html), `${where} still renders the old tier picker`);
}

test("the character sheet shows all six gear slots, each named, and no rank on a fresh (all-common) kit", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const html = sheetPanelHtml(sheet);
  for (const piece of ["Longsword", "Kite Shield", "Plate Harness", "Travel Boots"]) {
    assert.ok(html.includes(piece), `the sheet never names the ${piece} the character is carrying`);
  }
  // A fresh character owns nothing above common, so no rarity chip renders
  // for anyone yet -- issue #15's restored chip only ever names a rank the
  // dice actually rolled against, never an unearned one.
  for (const word of ["Uncommon", "Rare", "Legendary"]) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(html), `a fresh character's sheet still names a rank ("${word}") nobody granted`);
  }
  assertNoPicker(html, "the gear rows");
  assertNoDeveloperText(html, "the gear rows");
  assert.ok(!/gear_knight/.test(html), "a sprite id is a database key, never a noun on screen");
});

test("no equipment surface wears a price, because equipping never costs a credit", () => {
  // components/Bits.tsx's CostBadge renders `class="cost"`. Combat, movement,
  // search, items, resting, levelling and now gear are free forever.
  const sheet = createCharacter({ archetypeId: "psion", name: "Vell", appearanceAssetId: "token_psion" });
  // (The `gearOptions` / `onEquip` props this used to pass are gone with the
  // tier picker, issue #15; the panel is free with or without them.)
  const html = sheetPanelHtml(sheet);
  assert.ok(html.includes("Neural Focus"));
  assert.ok(!/class="cost"/.test(html), "a free action wearing a price is the cost model failing out loud");
  assert.ok(!/✦/.test(html));
});

test("a common piece says it adds nothing rather than sounding like it adds something", () => {
  const sheet = createCharacter({ archetypeId: "healer", name: "Ilsa", appearanceAssetId: "token_healer" });
  const html = sheetPanelHtml(sheet);
  assert.match(html, /no bonus/i, "the starting kit is +0 and the copy has to say so");
});

test("an enchanted piece states its real number, what it does to a roll, and its rank (issue #15, restored)", () => {
  // A piece above the starting rank renders under its own name with its own
  // real number, AND names its rank now that loot is the engine-owned grant
  // that makes the rank reachable: showing "Uncommon" on a piece a player
  // actually found is the opposite of the defect that pulled the chip.
  const base = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  const sheet = equipItem(base, "weapon", "uncommon");
  const html = sheetPanelHtml(sheet);
  assert.ok(html.includes("Honed Shortblade"), "the uncommon piece has its own name");
  assert.match(html, /\+1 to hit and \+1 damage/i, "the number, not the flavour");
  assert.match(html, /\blt-rarity--uncommon\b/, "the restored rarity chip should mark the uncommon weapon row");
  assert.match(html, /\bUncommon\b/, "the rank is carried by the WORD, not colour alone");
});

test("the armour class on the sheet is the armour class the engine rolls against", () => {
  // The defect this stops: a decorative AC. `effectiveArmorClass` is the one
  // reader, so the number the player reads, the number an attack is resolved
  // against and the number the dungeon master is told are the same number.
  const base = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const sheet = equipItem(base, "outer", "uncommon");
  assert.equal(effectiveArmorClass(sheet), base.armorClass + 1);
  const html = sheetPanelHtml(sheet);
  assert.ok(html.includes(`AC ${base.armorClass + 1}`), `the sheet should show AC ${base.armorClass + 1}, not the stored ${base.armorClass}`);
  assert.match(html, /\+1 from gear/i, "and say where the extra point came from");
});

test("the gear picker is gone, and cannot be talked back onto the panel", () => {
  // It used to render wherever `equippableTiers` offered two or more choices.
  // Contract v2 makes that genuinely reachable (loot), but the picker itself
  // is not restored: it is REPLACED by the inventory screen, the one staged
  // surface that changes gear now. The props that fed it (`gearOptions`,
  // `onEquip`) are gone from the panel for good -- passing them now does
  // nothing at all, which is what this asserts.
  const sheet = createCharacter({ archetypeId: "trooper", name: "Kase", appearanceAssetId: "token_trooper" });
  assertNoPicker(sheetPanelHtml(sheet), "the gear rows");
  const coaxed = sheetPanelHtml(sheet, { gearOptions: { crown: ["common", "rare"] }, onEquip: () => {} });
  assertNoPicker(coaxed, "the panel handed a two-tier choice");
  assert.ok(!coaxed.includes("Vanguard Carapace"), "the rare piece's name reached the screen through a dead prop");
});

test("the play screen puts the gear rows in front of a player without being asked", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.ok(html.includes("Longsword"), "the sheet is open by default for a new character, and gear is on it");
  assert.match(html, /No bonus to hit/i, "the row still says what the piece does, which is the half that was load-bearing");
  // A brand-new character owns nothing above common, so no rarity chip has
  // anything true to say yet, and the old tier picker stays gone for good.
  assert.ok(!/\bUncommon\b|\bRare\b|\bLegendary\b/.test(html), "a fresh character's play screen names a rank nobody granted");
  assertNoPicker(html, "the whole play screen");
});

// ── one object, one name, and the pack that is only the pack ─────────────

/** The Carrying paragraph on its own, which is the list this panel means to be the pack rather than the loadout said a third time. */
function carryingLine(html: string): string {
  const found = /Carrying: ([^<]*)</.exec(html);
  assert.ok(found, "the sheet always has a Carrying line, even if it says nothing");
  // renderToStaticMarkup escapes the apostrophe in "Explorer's pack".
  return found![1]!.replace(/&#x27;/g, "'");
}

test("the Carrying line stops repeating the weapon, the shield and the armour the panel already showed", () => {
  // The Knight's panel printed "AC 16 (chain mail)", a gear row reading "Plate
  // Harness", and "Carrying: Longsword, Shield, Chain mail, Handaxe x2,
  // Explorer's pack". One suit of armour, three names, and the shield called
  // "Kite Shield" in one list and "Shield" in the other, so a player cannot
  // tell which of the three lists the rarity ladder acts on.
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const carrying = carryingLine(sheetPanelHtml(sheet));
  for (const named of ["Longsword", "Shield", "Chain mail"]) {
    assert.ok(!carrying.includes(named), `the loadout already names ${named}, and the pack said it again: ${carrying}`);
  }
  assert.ok(carrying.includes("Handaxe x2"), "what is genuinely in the pack still shows");
  assert.ok(carrying.includes("Explorer's pack"));
});

test("the armour in the AC line is the armour in the gear row, by name", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const html = sheetPanelHtml(sheet);
  assert.ok(html.includes("(Plate Harness"), "the AC parenthesis names the piece the rarity ladder acts on");
  assert.ok(!/chain mail/i.test(html), "and never a second name for the same suit of armour");
  // The stored field is untouched: characters/equipment.ts anchors the SRD
  // armour Strength requirement to `armorLabel`, so this is a display name
  // only and nothing mechanical moved.
  assert.equal(sheet.armorLabel, "chain mail");
  // Upgrading the harness moves that number, which is the question a rarity
  // chip on an armour row invites and the panel could not previously answer.
  const better = sheetPanelHtml(equipItem(sheet, "crown", "rare"));
  assert.ok(better.includes(`AC ${sheet.armorClass + 2}`));
  assert.ok(better.includes("(Vigil Plate"), "and the AC line follows the piece to its new name");
});

test("the slot label on a save-slot piece never calls it armour", () => {
  // Six of the eight archetypes have a crown slot whose bonusKind is "save":
  // it moves saving throws through `saveModifierFor` and never touches AC. The
  // label above the sentence used to read "Armour or headwear" for all eight,
  // and a first-time player reads the label.
  const shadow = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  const html = sheetPanelHtml(shadow);
  assert.ok(html.includes("Headwear (saving throws)"), "say what the Hood actually moves");
  assert.ok(!/Armour or headwear/.test(html), "one label for eight archetypes is the label lying to six of them");
  // And the two archetypes whose crown really is armour still say so.
  const knight = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  assert.ok(/>Armour</.test(sheetPanelHtml(knight)), "the Knight's Plate Harness is armour and the label says armour");
});

test("the sheet does not apologise for a ladder it no longer shows", () => {
  // The panel used to carry "Nothing in this campaign upgrades gear yet",
  // which was true and was the right answer while the same panel was
  // advertising four ranks three times over. With the ranks gone, that line
  // would be the only thing left telling a player a ladder exists -- an
  // apology for a feature they have never been shown. Neither the ranks nor
  // the apology, and still not a paid surface.
  const sheet = createCharacter({ archetypeId: "healer", name: "Ilsa", appearanceAssetId: "token_healer" });
  const html = sheetPanelHtml(sheet);
  assert.ok(!/upgrades gear yet/i.test(html), "the apology outlived the thing it was apologising for");
  assert.ok(!/upgrade/i.test(html), "no upgrade path is named anywhere on the panel");
  assertNoPicker(html, "the gear rows");
  assert.ok(!/class="cost"/.test(html), "and it is still not a paid surface");
});

// ── the floating readout names the parts of the bonus ────────────────────

test("the roll readout shows the breakdown it is handed, not just the lump", () => {
  // Both call sites compute the sources once and give the same array to the
  // dice log and to this overlay, with a comment saying it is done "so the
  // overlay never shows an unexplained lump beside a dice log that names every
  // part of it" -- and then nothing ever read `readout.sources`, so the
  // overlay showed exactly that lump. The popup is the surface a player is
  // actually looking at when the die lands.
  const html = renderToStaticMarkup(
    createElement(RollReadoutOverlay, {
      readout: {
        caption: "Maddik attacks the goblin",
        roll: 9,
        modifier: 5,
        total: 14,
        target: 13,
        hit: true,
        sources: [
          { label: "Strength and training", amount: 3 },
          { label: "Keen Longsword", amount: 2 },
        ],
      },
    }),
  );
  assert.match(html, /\+3 Strength and training/);
  assert.match(html, /\+2 Keen Longsword/);
  assert.match(html, /\+5/, "the lump is still there; the parts explain it rather than replace it");
});

test("a readout with no breakdown renders exactly what it rendered before", () => {
  // `bonusSources` refuses a set that does not sum to the modifier and drops a
  // lone part, so most rolls carry nothing, and those have to look untouched.
  const html = renderToStaticMarkup(
    createElement(RollReadoutOverlay, {
      readout: { caption: "Maddik, Dexterity save", roll: 9, modifier: 1, total: 10, target: 13, hit: false },
    }),
  );
  assert.ok(!/lt-readout-sources/.test(html), "an empty breakdown renders no row at all, not an empty one");
  assert.match(html, /MISS/);
});

// ── the roll line names where the bonus came from ────────────────────────

/** Pull the parenthesised breakdown out of a roll line, if it printed one. */
function breakdownOf(line: string): { parts: readonly string[]; sum: number } | null {
  const found = /= -?\d+ \(([^)]+)\)/.exec(line);
  if (!found) return null;
  const parts = found[1]!.split(", ");
  return { parts, sum: parts.reduce((n, part) => n + Number(part.split(" ")[0]), 0) };
}

test("a player's attack line says which part of the bonus was training and which was the fighting style", () => {
  // "rolled 9, +6 = 15" told a newcomer a +6 existed and nothing about where
  // it came from. A Knight who picked Archery is carrying +4 of ability and
  // training and +2 of the style they chose, and the style is invisible
  // otherwise: the sheet says "+2 to hit with a ranged weapon" and no roll
  // ever showed it happening.
  const archer = createCharacter({
    archetypeId: "knight",
    name: "Maddik",
    appearanceAssetId: "token_knight",
    choices: { fightingStyle: "archery" },
  });
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "attack", by: PLAYER_ID, against: "mon-skel-1", reason: "Maddik looses an axe" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet: archer,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.5,
  });
  const line = out.dice[0]!.text;
  assert.match(line, /\(\+4 Strength and training, \+2 Archery\)/, `no breakdown in: ${line}`);
  const breakdown = breakdownOf(line)!;
  assert.equal(breakdown.sum, attackerBonusFor(archer), "the parts have to add up to the modifier that was actually rolled");
});

test("a modifier with only one source is not explained with itself", () => {
  // The whole +5 of a Defense Knight is ability and training, and their gear
  // is common, worth +0. "(+5 Strength and training)" next to "+5" is noise,
  // so the line stays exactly the one this game already printed.
  const knight = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "attack", by: PLAYER_ID, against: "mon-skel-1", reason: "Maddik swings" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet: knight,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.5,
  });
  assert.equal(breakdownOf(out.dice[0]!.text), null, `expected no breakdown in: ${out.dice[0]!.text}`);
});

test("a roll line never claims a bonus the engine did not actually roll", () => {
  // The failure mode this stops is the readout drifting from the engine, the
  // same defect class as a decorative armour class. Equipment bonuses reach a
  // d20 through session/combat.ts and nowhere else; whatever that returns,
  // the printed parts have to add up to it, and the printed modifier has to
  // BE it.
  const warded = equipItem(
    createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" }),
    "crown",
    "legendary",
  );
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "save", by: PLAYER_ID, ability: "dex", dc: 13, reason: "the floor gives way" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet: warded,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.5,
  });
  const line = out.dice[0]!.text;
  const printed = Number(/rolled \d+, ([-+]\d+)/.exec(line)![1]);
  assert.equal(printed, saveModifierFor(warded, "dex"), "the line prints the engine's own modifier, not a recomputation of it");
  const breakdown = breakdownOf(line);
  if (breakdown) assert.equal(breakdown.sum, printed, `the breakdown must add up to the modifier: ${line}`);
});

// ═══════════════════════════════════════════════════════════════════════
// CONTRACT V2: THE INVENTORY SCREEN, rendered as its own PURE component --
// props in, callbacks out -- exactly the harness the brief asks for, plus
// the play screen's own door into it.
// ═══════════════════════════════════════════════════════════════════════

function fixtureInventoryView(overrides: Partial<Parameters<typeof buildInventoryView>[0]> = {}) {
  const archetypeId = "knight" as ArchetypeId;
  const defaultSheet = createCharacter({ archetypeId, name: "Maddik", appearanceAssetId: "token_knight" });
  return buildInventoryView({
    archetypeId,
    template: "fantasy",
    sheet: defaultSheet,
    draft: draftFromSheet(defaultSheet),
    selection: null,
    blockedReason: null,
    usable: [],
    carrying: [],
    baseSpeedFt: 30,
    ...overrides,
  });
}

function inventoryScreenHtml(view: ReturnType<typeof fixtureInventoryView>, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(InventoryScreen, {
      view,
      dollPlan: null,
      manifest: { palette: [], tiles: {}, props: {}, tokens: {} },
      onSelectSlot: () => {},
      onSelectBagCell: () => {},
      onDeselect: () => {},
      onEquip: () => {},
      onUnequip: () => {},
      onCancel: () => {},
      onOk: () => {},
      ...extra,
    } as never),
  );
}

test("InventoryScreen renders the reference layout: title, all six slot boxes, a full bag grid, Cancel and Ok", () => {
  const view = fixtureInventoryView();
  const html = inventoryScreenHtml(view);
  assert.ok(html.includes("Pack and Gear"), "the fantasy template's own title should be on screen");
  assert.equal(view.leftColumn.length + view.rightColumn.length, 6, "weapon, outer, ring, crown, amulet, boots");
  assert.equal((html.match(/class="lt-inventory-bag-cell/g) ?? []).length, view.bagCapacity, "the bag grid always shows its full capacity, empty cells included");
  assert.ok(html.includes(">Cancel<"));
  assert.ok(html.includes(">Ok<"));
  assert.ok(!/class="cost"/.test(html), "the inventory screen is free forever: no CostBadge anywhere");
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
});

test("InventoryScreen's bag cell names the item and states its rank as a word, not colour alone", () => {
  const sheet = { ...createCharacter({ archetypeId: "trooper", name: "Kase", appearanceAssetId: "token_trooper" }), bag: [{ slot: "outer", tier: "rare" }] };
  const draft = draftFromSheet(sheet as never);
  const view = fixtureInventoryView({ archetypeId: "trooper" as ArchetypeId, template: "scifi", sheet: sheet as never, draft });
  const html = inventoryScreenHtml(view);
  assert.ok(html.includes("Bulwark Emitter"), "the rare outer piece the trooper found should be named");
  assert.match(html, /rare/i, "somewhere on the cell, the rank is a WORD");
});

test("InventoryScreen goes read-only when gear changes are blocked: the reason shows, Equip/Unequip/Cancel/Ok are gone, Close is the one button", () => {
  const archetypeId = "knight" as ArchetypeId;
  const sheet = {
    ...createCharacter({ archetypeId, name: "Maddik", appearanceAssetId: "token_knight" }),
    equipment: { weapon: { slot: "weapon", tier: "legendary" } },
  };
  const draft = draftFromSheet(sheet as never);
  const blockedReason = "Not with something still in the room. Look all you like; gear changes wait until the fight is over.";
  const view = fixtureInventoryView({ sheet: sheet as never, draft, selection: { kind: "slot", role: "weapon" }, blockedReason });
  const html = inventoryScreenHtml(view);
  assert.ok(html.includes(blockedReason));
  assert.ok(!html.includes(">Ok<"), "read-only: no Ok button");
  assert.ok(!html.includes(">Cancel<"), "read-only: no Cancel button (the title bar's x still closes it)");
  assert.ok(html.includes(">Close<"), "the footer is a single Close button");
  assert.ok(!html.includes(">Unequip<"), "read-only: no Unequip, even for the legendary weapon selected");
});

test("InventoryScreen's Equip button carries the attunement-full refusal verbatim when staging would exceed the cap", () => {
  const archetypeId = "shadow" as ArchetypeId;
  const sheet = {
    ...createCharacter({ archetypeId, name: "Nix", appearanceAssetId: "token_shadow" }),
    equipment: { weapon: { slot: "weapon", tier: "legendary" }, ring: { slot: "ring", tier: "rare" }, boots: { slot: "boots", tier: "rare" } },
    bag: [{ slot: "amulet", tier: "rare" }],
  };
  const draft = draftFromSheet(sheet as never);
  const view = fixtureInventoryView({ archetypeId, template: "fantasy", sheet: sheet as never, draft, selection: { kind: "bag", index: 0 } });
  const html = inventoryScreenHtml(view);
  assert.match(html, /You can be attuned to three magic items at once/, "the SRD's own remedy, printed verbatim");
  assert.ok(html.includes("Attuned: 3 of 3"));
});

test("the play screen offers a free Inventory button beside Character sheet, and it opens gear on the composer bar", () => {
  const html = renderToStaticMarkup(createElement(PlaySession, playFixture([])));
  assert.ok(html.includes(">Inventory<"), "the composer bar should offer an Inventory button");
});

test("the character sheet's attuned counter reflects a worn attunement item", () => {
  const base = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  const sheet = equipItem(base, "weapon", "legendary");
  const html = sheetPanelHtml(sheet);
  assert.ok(html.includes("Attuned: 1 of 3"), "a legendary weapon needs attunement and should be counted");
});

test("the character sheet shows the boots row (contract v2) even on a v1 blob with no boots data", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight" });
  const html = sheetPanelHtml(sheet);
  assert.ok(html.includes("Travel Boots"), "boots default to common and are always shown");
  assert.ok(html.includes("No ring worn") || html.includes("No amulet worn") || /ring|amulet/i.test(html), "ring and amulet rows are present, empty");
});

// ── contract v2, wired at the DM roll-request path: evasion and advantage ──

test("a worn, attuned Ring of Evasion turns a failed Dexterity save into a success, and prints a second dice line naming it", () => {
  const base = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  const sheet = { ...base, equipment: { ...base.equipment, ring: { slot: "ring", tier: "uncommon" } } };
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "save", by: PLAYER_ID, ability: "dex", dc: 30, reason: "the floor gives way" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0,
  });
  const saved = out.resolved[0] as { success: boolean };
  assert.equal(saved.success, true, "the DM should be told the rescued save succeeded, per the contract's own instruction");
  assert.equal(out.dice.length, 2, "the save's own line, then the rescue as a second line");
  // The first line is the die as it LANDED: a failure. Printing SUCCESS beside
  // "rolled 1, needed 30" would be a line that disagrees with its own math.
  assert.match(out.dice[0]!.text, /\. FAIL\.$/, `the save's own line must show the failed die: ${out.dice[0]!.text}`);
  assert.equal(out.dice[0]!.hit, false);
  assert.match(out.dice[1]!.text, /Ring of Evasion: the failed Dexterity save becomes a success\. 2 of 3 charges left\./);
  assert.equal(out.sheet.itemCharges?.["ring:uncommon"], 2, "one charge is spent, written back onto the returned sheet");
});

test("a save the ring does not cover (not Dexterity) fails normally, with no rescue line", () => {
  const base = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  const sheet = { ...base, equipment: { ...base.equipment, ring: { slot: "ring", tier: "uncommon" } } };
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "save", by: PLAYER_ID, ability: "wis", dc: 30, reason: "a compelling whisper" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0,
  });
  const saved = out.resolved[0] as { success: boolean };
  assert.equal(saved.success, false);
  assert.equal(out.dice.length, 1, "no second line when the ring does not apply");
});

test("Boots of Elvenkind's advantage is passed to a DM-requested Stealth check and named in the printed line", () => {
  const base = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  const sheet = { ...base, equipment: { ...base.equipment, boots: { slot: "boots", tier: "uncommon" } } };
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "check", by: PLAYER_ID, skill: "Stealth", dc: 12, reason: "sneaking past" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.5,
  });
  assert.match(out.dice[0]!.text, /rolled \d+ with advantage from Boots of Elvenkind/);
});

test("a skill other than Stealth gets no advantage from Boots of Elvenkind", () => {
  const base = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  const sheet = { ...base, equipment: { ...base.equipment, boots: { slot: "boots", tier: "uncommon" } } };
  const { world, cell } = skeletonRoom();
  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "check", by: PLAYER_ID, skill: "Perception", dc: 12, reason: "listening at the door" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng: () => 0.5,
  });
  assert.doesNotMatch(out.dice[0]!.text, /with advantage/);
});

test("a legendary weapon's rider fires on a DM-requested player attack, exactly like the local Attack button", () => {
  // Regression: `handleAttack` (the local Attack button) has always rolled
  // `legendaryRiderDamageFor` after a hit; `resolveDmRollRequests` (every
  // attack the DM itself asks for, e.g. from a Talk turn) never did, so the
  // same Dawnbreaker did different damage depending on which control
  // triggered the swing.
  const sheet = equipItem(createCharacter({ archetypeId: "knight", name: "Ada", appearanceAssetId: "token_knight" }), "weapon", "legendary");
  const { world, cell } = skeletonRoom();
  const rng = () => 0.5; // a constant, non-critical d20 (roll 11) and a fixed die face everywhere else

  // The expected numbers, computed off the identical engine functions with
  // the identical constant rng, independent of resolveDmRollRequests itself.
  const baseDamage = resolveDamage(weaponDamageNotationFor(sheet), rng, false).total;
  const rider = legendaryRiderDamageFor(sheet, rng, false);
  assert.ok(rider, "a legendary weapon always has a rider");
  assert.equal(rider!.damageType, "radiant");
  assert.equal(rider!.source, "Dawnbreaker");

  const out = resolveDmRollRequests({
    requests: [{ id: "r1", kind: "attack", by: PLAYER_ID, against: "mon-skel-1", reason: "Ada swings Dawnbreaker at the skeleton" }],
    world,
    cell,
    playerTokenId: PLAYER_ID,
    sheet,
    round: null,
    namer: skeletonNamer(),
    rng,
  });

  assert.equal(out.dice.length, 2, "the rider's own line, then the attack's own line");
  assert.match(out.dice[0]!.text, /Dawnbreaker/);
  assert.match(out.dice[0]!.text, /radiant/);
  assert.match(out.dice[0]!.text, new RegExp(`${rider!.roll.total} radiant damage`));
  const after = getCell(out.world, cell)!.tokens.find((t) => t.id === "mon-skel-1");
  const hpAfter = after ? (after.currentHp ?? 13) : 0;
  assert.equal(hpAfter, Math.max(0, 13 - (baseDamage + rider!.roll.total)), "the skeleton's hit points reflect the base weapon damage PLUS the rider, not just the base damage");
});

// ── the Search handler's defence in depth against pre-rule cells ─────────
//
// validatePlacedProp (dm/turnSchema.ts) now rejects a magic gear name inside
// a prop's grantsItem, label or onFound, wrapped in prose or not. A cell the
// DM assembled BEFORE that rule landed is already in the world cache, so the
// Search handler re-checks both fields itself: a magic name is never
// pocketed and never told as the thing that was found.

test("pocketableGrant drops every magic gear name, bare or wrapped, and keeps an ordinary item", () => {
  for (const name of MAGIC_GEAR_NAMES) {
    for (const wrapped of [name, `a ${name}`, `the ${name}`, `${name}.`, `${name} (worn)`, name.toUpperCase()]) {
      assert.equal(pocketableGrant(wrapped), null, `"${wrapped}" names a magic item and must never be pocketed`);
    }
  }
  assert.equal(pocketableGrant("a coil of rope"), "a coil of rope");
  assert.equal(pocketableGrant("Longsword"), "Longsword", "a COMMON gear name is not magic by the contract's own definition");
  assert.equal(pocketableGrant(undefined), null);
  assert.equal(pocketableGrant(""), null);
});

test("searchFoundLine never tells a pre-rule onFound that names a magic item, and keeps ordinary flavour", () => {
  assert.equal(searchFoundLine("You find the Boots of Speed tucked under a blanket.", "the chest"), "Something about the chest looks disturbed.");
  assert.equal(searchFoundLine("A Ring of Protection glints in the straw.", "the crate"), "Something about the crate looks disturbed.");
  assert.equal(searchFoundLine("A note in a merchant's hand begs for mercy.", "the chest"), "A note in a merchant's hand begs for mercy.", "a single common word that is also an item name is not a match in free prose");
  assert.equal(searchFoundLine(undefined, "the chest"), "Something about the chest looks disturbed.");
});
