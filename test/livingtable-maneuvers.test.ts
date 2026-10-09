/**
 * Tests for the maneuvers that change the board
 * (src/games/livingtable/session/maneuvers.ts): the kick, the shove, where a
 * pushed token lands, hiding, pickpocketing, picking a lock, forcing a door,
 * skill checks by name, and creature skills.
 *
 * The thing this file defends is the kick bug: the DM narrated a kick that
 * knocked a goblin back and nothing on the board changed. These are the rules
 * the effects will call, so the numbers must be real and the lines must say
 * them. Every roll here is scripted: `d20s(14, 9)` hands the code a 14 and
 * then a 9 and throws if it asks for more, so a test that rolls the wrong
 * number of dice fails loudly.
 *
 * Run: npx tsx --test test/livingtable-maneuvers.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCharacter, type CharacterSheet, type SkillProficiency } from "../src/games/livingtable/characters/creation";
import { BESTIARY } from "../src/games/livingtable/rules/bestiary";
import { MONSTER_STATBLOCKS } from "../src/games/livingtable/session/combat";
import {
  canonicalAbility,
  canonicalSkill,
  forceDoor,
  monsterPassivePerception,
  monsterShoveProfile,
  monsterSkill,
  pickLock,
  proneAttackMode,
  proneEffects,
  pushDestination,
  sheetSize,
  shoveContest,
  skillCheck,
  sleightOfHand,
  standUpCostFt,
  stealthCheck,
  unarmedStrike,
} from "../src/games/livingtable/session/maneuvers";
import { CELL_HEIGHT, CELL_WIDTH, type AssetManifest, type CellLayout } from "../src/games/livingtable/world";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── scripted dice ───────────────────────────────────────────────────────

/** An rng that makes a d20 come up with exactly these numbers, in order. */
function d20s(...faces: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= faces.length) throw new Error("the code rolled more dice than the test scripted");
    return (faces[i++]! - 0.5) / 20;
  };
}

// ── sheets ──────────────────────────────────────────────────────────────

const mod = (str: number, dex: number) => ({ str, dex, con: 1, int: 0, wis: 0, cha: 0 });
const skill = (name: string, ability: SkillProficiency["ability"], bonus: number, expertise = false): SkillProficiency => ({ skill: name, ability, bonus, expertise });

function knight(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base = createCharacter({ archetypeId: "knight", name: "Kay", appearanceAssetId: "sprite-01" });
  return {
    ...base,
    modifiers: mod(2, 1),
    proficiencyBonus: 2,
    skills: [skill("Athletics", "str", 4)],
    ...overrides,
  };
}

function shadow(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base = createCharacter({ archetypeId: "shadow", name: "Shade", appearanceAssetId: "sprite-01" });
  return {
    ...base,
    modifiers: mod(-1, 3),
    proficiencyBonus: 2,
    skills: [skill("Stealth", "dex", 5), skill("Sleight of Hand", "dex", 5), skill("Intimidation", "cha", 4)],
    ...overrides,
  };
}

// ── a board ─────────────────────────────────────────────────────────────

const MANIFEST: AssetManifest = {
  tiles: { floor: { walkable: true }, wall: { walkable: false } },
  tokens: { hero: {}, goblin: {} },
  props: { door_closed: { blocks: true }, door_open: {}, chest: {} },
};

type Token = CellLayout["tokens"][number];
const tok = (id: string, x: number, y: number, kind: Token["kind"] = "monster"): Token => ({ id, assetId: "goblin", x, y, kind });

/** A walled 20x15 room. `walls` adds interior wall tiles. */
function room(walls: ReadonlyArray<readonly [number, number]> = [], tokens: Token[] = [], props: CellLayout["props"] = []): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) => (x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1 ? "wall" : "floor")),
  );
  for (const [x, y] of walls) tiles[y]![x] = "wall";
  return { tiles, props, tokens, exits: [], sealed: true };
}

/** An open floor with NO border walls, so the only thing that stops a push is the edge of the grid. */
function openFloor(): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor"));
  return { tiles, props: [], tokens: [], exits: [], sealed: true };
}

// ── unarmed strike: the kick ────────────────────────────────────────────

test("kick hit: attack roll with Strength and proficiency, 1 + Strength bludgeoning, in plain numbers", () => {
  const r = unarmedStrike({ attacker: knight(), targetAC: 15, rng: d20s(14), label: "Kick" });
  assert.equal(r.roll, 14);
  assert.equal(r.total, 18);
  assert.equal(r.hit, true);
  assert.equal(r.critical, false);
  assert.equal(r.damage, 3);
  assert.deepEqual(r.dice, [{ kind: "d20", result: 14 }]);
  assert.equal(r.line, "Kick: 14 + 4 = 18 vs AC 15. Hit: 1 + 2 = 3 bludgeoning.");
});

test("kick miss: a total under the AC deals nothing", () => {
  const r = unarmedStrike({ attacker: knight(), targetAC: 15, rng: d20s(8), label: "Kick" });
  assert.equal(r.total, 12);
  assert.equal(r.hit, false);
  assert.equal(r.damage, 0);
  assert.equal(r.line, "Kick: 8 + 4 = 12 vs AC 15. Miss.");
});

test("a tie with the AC hits: meets-or-beats", () => {
  const r = unarmedStrike({ attacker: knight(), targetAC: 15, rng: d20s(11) });
  assert.equal(r.total, 15);
  assert.equal(r.hit, true);
});

test("kick critical: always hits, and an unarmed strike has no dice to double so it adds nothing", () => {
  const r = unarmedStrike({ attacker: knight(), targetAC: 30, rng: d20s(20), label: "Kick" });
  assert.equal(r.critical, true);
  assert.equal(r.hit, true);
  assert.equal(r.damage, 3, "1 + 2, not doubled");
  assert.match(r.line, /critical hit/);
  assert.match(r.line, /no damage dice to double/);
  assert.match(r.line, /1 \+ 2 = 3 bludgeoning/);
});

test("a natural 1 misses whatever the bonus is", () => {
  const strong = knight({ modifiers: mod(10, 1) });
  const r = unarmedStrike({ attacker: strong, targetAC: 5, rng: d20s(1), label: "Kick" });
  assert.equal(r.hit, false);
  assert.equal(r.damage, 0);
  assert.match(r.line, /natural 1/);
});

test("a weak kicker never does negative damage, and the line shows the real arithmetic", () => {
  const weak = knight({ modifiers: mod(-1, 1) });
  const r = unarmedStrike({ attacker: weak, targetAC: 10, rng: d20s(15) });
  assert.equal(r.hit, true);
  assert.equal(r.damage, 0);
  assert.match(r.line, /1 - 1 = 0 bludgeoning/);
  assert.match(r.line, /15 \+ 1 = 16/);
});

test("kick with advantage shows both dice and keeps the higher", () => {
  const r = unarmedStrike({ attacker: knight(), targetAC: 15, advantage: "advantage", rng: d20s(6, 13) });
  assert.deepEqual(r.dice.map((d) => d.result), [6, 13]);
  assert.equal(r.roll, 13);
  assert.match(r.line, /advantage: 6 and 13, kept 13/);
});

test("kick with disadvantage keeps the lower", () => {
  const r = unarmedStrike({ attacker: knight(), targetAC: 15, advantage: "disadvantage", rng: d20s(6, 13) });
  assert.equal(r.roll, 6);
});

test("the default label is Unarmed strike", () => {
  const r = unarmedStrike({ attacker: knight(), targetAC: 15, rng: d20s(14) });
  assert.match(r.line, /^Unarmed strike: 14 \+ 4 = 18/);
});

// ── shove ───────────────────────────────────────────────────────────────

const GOBLIN = { athletics: -1, acrobatics: 2, size: "Small", name: "the goblin" };

test("shove push: Athletics against the better of the target's two skills, win pushes", () => {
  // You: 10 + 4 = 14. Goblin picks Acrobatics +2: 8 + 2 = 10.
  const r = shoveContest({ attacker: knight(), target: GOBLIN, mode: "push", rng: d20s(10, 8) });
  assert.equal(r.allowed, true);
  assert.equal(r.attackerTotal, 14);
  assert.equal(r.targetTotal, 10);
  assert.equal(r.success, true);
  assert.equal(r.effect, "push");
  assert.deepEqual(r.dice.map((d) => [d.label, d.result]), [["You", 10], ["the goblin", 8]]);
  assert.match(r.line, /your Athletics 10 \+ 4 = 14 against the goblin's Acrobatics 8 \+ 2 = 10/);
  assert.match(r.line, /pushed 5 feet away from you/);
});

test("shove prone: a win knocks the target prone", () => {
  const r = shoveContest({ attacker: knight(), target: GOBLIN, mode: "prone", rng: d20s(15, 3) });
  assert.equal(r.success, true);
  assert.equal(r.effect, "prone");
  assert.match(r.line, /knocked prone/);
});

test("shove lost: nothing happens", () => {
  const r = shoveContest({ attacker: knight(), target: GOBLIN, mode: "push", rng: d20s(2, 18) });
  assert.equal(r.success, false);
  assert.equal(r.effect, "none");
  assert.match(r.line, /You lose/);
});

test("a tied contest goes to the target", () => {
  // You: 11 + 4 = 15. Target Acrobatics: 13 + 2 = 15.
  const r = shoveContest({ attacker: knight(), target: GOBLIN, mode: "push", rng: d20s(11, 13) });
  assert.equal(r.attackerTotal, r.targetTotal);
  assert.equal(r.success, false);
  assert.equal(r.effect, "none");
  assert.match(r.line, /tie goes to the goblin/);
});

test("the target uses Athletics when that is its better skill", () => {
  const ogre = { athletics: 6, acrobatics: -1, size: "Large", name: "the ogre" };
  const r = shoveContest({ attacker: knight(), target: ogre, mode: "push", rng: d20s(10, 10) });
  assert.match(r.line, /the ogre's Athletics 10 \+ 6 = 16/);
  assert.equal(r.targetTotal, 16);
});

test("size: no more than one size larger than you", () => {
  const huge = shoveContest({ attacker: knight(), target: { athletics: 5, acrobatics: 0, size: "Huge", name: "the giant" }, mode: "push", rng: d20s() });
  assert.equal(huge.allowed, false);
  assert.equal(huge.success, false);
  assert.deepEqual(huge.dice, [], "a refused shove rolls nothing");
  assert.match(huge.reason!, /the giant is Huge and you are Medium/);
  assert.equal(huge.line, huge.reason);

  const large = shoveContest({ attacker: knight(), target: { athletics: 5, acrobatics: 0, size: "Large" }, mode: "push", rng: d20s(10, 10) });
  assert.equal(large.allowed, true, "one size larger is allowed");
});

test("size: a Small shover can shove a Medium creature but not a Large one, and the sheet's ancestry sets the size", () => {
  const halfling = createCharacter({ archetypeId: "knight", name: "Pip", appearanceAssetId: "sprite-01", ancestryId: "lightfoot-halfling" });
  assert.equal(sheetSize(halfling), "Small");
  assert.equal(sheetSize(knight()), "Medium");
  const large = shoveContest({ attacker: halfling, target: { athletics: 0, acrobatics: 0, size: "Large" }, mode: "push", rng: d20s() });
  assert.equal(large.allowed, false);
  assert.match(large.reason!, /Large and you are Small/);
  const medium = shoveContest({ attacker: halfling, target: { athletics: 0, acrobatics: 0, size: "Medium" }, mode: "push", rng: d20s(10, 10) });
  assert.equal(medium.allowed, true);
});

test("an explicit attackerSize overrides the sheet, and size names are case-insensitive", () => {
  const r = shoveContest({ attacker: knight(), attackerSize: "large", target: { athletics: 0, acrobatics: 0, size: "huge" }, mode: "push", rng: d20s(10, 10) });
  assert.equal(r.allowed, true);
});

// ── push destination ────────────────────────────────────────────────────

test("push across open floor: one square per step, away from the shover", () => {
  const path = pushDestination(room(), MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 3);
  assert.deepEqual(path, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }]);
});

test("a one-square shove moves exactly one square", () => {
  assert.deepEqual(pushDestination(room(), MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 1), [{ x: 6, y: 5 }]);
});

test("a push stops before a wall", () => {
  const path = pushDestination(room([[8, 5]]), MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 5);
  assert.deepEqual(path, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
});

test("pinned against a wall: no squares at all", () => {
  assert.deepEqual(pushDestination(room(), MANIFEST, { x: 1, y: 5 }, { x: 2, y: 5 }, 1), []);
});

test("a push stops before a closed door but not before an open one", () => {
  const closed = room([], [], [{ id: "d", assetId: "door_closed", x: 7, y: 5 }]);
  assert.deepEqual(pushDestination(closed, MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 4), [{ x: 6, y: 5 }]);
  const open = room([], [], [{ id: "d", assetId: "door_open", x: 7, y: 5 }]);
  assert.equal(pushDestination(open, MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 4).length, 4);
});

test("a push stops before another token, and the shover standing behind is no obstacle", () => {
  const layout = room([], [tok("target", 5, 5), tok("shover", 4, 5, "pc"), tok("blocker", 8, 5)]);
  assert.deepEqual(pushDestination(layout, MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 5), [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
});

test("a push stops at the edge of the grid", () => {
  const path = pushDestination(openFloor(), MANIFEST, { x: 17, y: 5 }, { x: 16, y: 5 }, 5);
  assert.deepEqual(path, [{ x: 18, y: 5 }, { x: 19, y: 5 }]);
  assert.deepEqual(pushDestination(openFloor(), MANIFEST, { x: 5, y: 0 }, { x: 5, y: 1 }, 3), []);
});

test("a diagonal shove goes diagonally, and stops where it would squeeze between two walls", () => {
  const diag = pushDestination(room(), MANIFEST, { x: 5, y: 5 }, { x: 4, y: 4 }, 2);
  assert.deepEqual(diag, [{ x: 6, y: 6 }, { x: 7, y: 7 }]);
  const squeeze = pushDestination(room([[7, 6], [6, 7]]), MANIFEST, { x: 5, y: 5 }, { x: 4, y: 4 }, 3);
  assert.deepEqual(squeeze, [{ x: 6, y: 6 }]);
});

test("a push direction follows the sign of the offset, not its size", () => {
  const path = pushDestination(room(), MANIFEST, { x: 5, y: 5 }, { x: 5, y: 9 }, 2);
  assert.deepEqual(path, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
});

test("no squares to push, or no direction to push in, gives an empty path", () => {
  assert.deepEqual(pushDestination(room(), MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 0), []);
  assert.deepEqual(pushDestination(room(), MANIFEST, { x: 5, y: 5 }, { x: 5, y: 5 }, 3), []);
});

// ── prone ───────────────────────────────────────────────────────────────

test("prone effects are data, and the distance rule is exact", () => {
  assert.deepEqual(proneEffects(), {
    meleeAttackersHaveAdvantage: true,
    rangedAttackersHaveDisadvantage: true,
    proneAttacksHaveDisadvantage: true,
    standUpCostsHalfMovement: true,
  });
  assert.equal(proneAttackMode(5), "advantage");
  assert.equal(proneAttackMode(10), "disadvantage");
  assert.equal(standUpCostFt(30), 15);
  assert.equal(standUpCostFt(25), 12);
});

// ── stealth ─────────────────────────────────────────────────────────────

test("stealth: one roll, hidden from the dull observer and spotted by the sharp one", () => {
  const r = stealthCheck({
    sheet: shadow(),
    observers: [{ id: "gob", passivePerception: 9, name: "Goblin" }, { id: "owl", passivePerception: 20, name: "Owl" }],
    rng: d20s(12),
  });
  assert.equal(r.total, 17);
  assert.deepEqual(r.hiddenFrom, ["gob"]);
  assert.deepEqual(r.spottedBy, ["owl"]);
  assert.deepEqual(r.dice, [{ kind: "d20", result: 12 }]);
  assert.equal(r.line, "Stealth: 12 + 5 = 17. Hidden from Goblin (passive 9); spotted by Owl (passive 20).");
});

test("stealth meets-or-beats: a total equal to the passive score hides you", () => {
  const r = stealthCheck({ sheet: shadow(), observers: [{ id: "a", passivePerception: 17 }], rng: d20s(12) });
  assert.deepEqual(r.hiddenFrom, ["a"]);
  const miss = stealthCheck({ sheet: shadow(), observers: [{ id: "a", passivePerception: 18 }], rng: d20s(12) });
  assert.deepEqual(miss.spottedBy, ["a"]);
  assert.match(miss.line, /Spotted by a \(passive 18\)/);
});

test("stealth with no observers is a clean success, and uses one die", () => {
  const r = stealthCheck({ sheet: shadow(), observers: [], rng: d20s(3) });
  assert.deepEqual(r.hiddenFrom, []);
  assert.deepEqual(r.spottedBy, []);
  assert.match(r.line, /No one is watching/);
});

test("stealth with advantage rolls two dice and keeps the better", () => {
  const r = stealthCheck({ sheet: shadow(), observers: [{ id: "a", passivePerception: 14 }], advantage: "advantage", rng: d20s(4, 10) });
  assert.equal(r.dice.length, 2);
  assert.equal(r.total, 15);
  assert.deepEqual(r.hiddenFrom, ["a"]);
  assert.match(r.line, /advantage: 4 and 10, kept 10/);
});

// ── pickpocket ──────────────────────────────────────────────────────────

test("pickpocket success: Sleight of Hand meets the passive Perception, not noticed", () => {
  const r = sleightOfHand({ sheet: shadow(), targetPassivePerception: 9, rng: d20s(10) });
  assert.equal(r.total, 15);
  assert.equal(r.success, true);
  assert.equal(r.noticed, false);
  assert.equal(r.line, "Sleight of Hand: 10 + 5 = 15 vs passive Perception 9. Success: they do not notice.");
});

test("pickpocket failure: the target notices", () => {
  const r = sleightOfHand({ sheet: shadow(), targetPassivePerception: 12, rng: d20s(2) });
  assert.equal(r.total, 7);
  assert.equal(r.success, false);
  assert.equal(r.noticed, true);
  assert.match(r.line, /Failure: they notice/);
});

test("pickpocket meets-or-beats, and an untrained character uses the bare Dexterity modifier", () => {
  const exact = sleightOfHand({ sheet: shadow(), targetPassivePerception: 15, rng: d20s(10) });
  assert.equal(exact.success, true);
  const untrained = sleightOfHand({ sheet: knight(), targetPassivePerception: 9, rng: d20s(10) });
  assert.equal(untrained.total, 11, "10 + the knight's Dexterity +1, no proficiency");
});

// ── pick the lock ───────────────────────────────────────────────────────

test("pick the lock is refused for a non-rogue, without rolling, and says why", () => {
  const r = pickLock({ sheet: knight(), dc: 12, rng: d20s() });
  assert.equal(r.allowed, false);
  assert.equal(r.success, false);
  assert.deepEqual(r.dice, []);
  assert.match(r.reason!, /thieves' tools/);
  assert.match(r.reason!, /only a rogue/);
  assert.equal(r.line, r.reason);
});

test("pick the lock for a rogue: Dexterity plus proficiency against the DC", () => {
  const ok = pickLock({ sheet: shadow(), dc: 14, rng: d20s(10) });
  assert.equal(ok.allowed, true);
  assert.equal(ok.total, 15);
  assert.equal(ok.success, true);
  assert.equal(ok.line, "Pick the lock (Dexterity +3, thieves' tools +2): 10 + 5 = 15 vs DC 14. Success: the lock clicks open.");

  const bad = pickLock({ sheet: shadow(), dc: 14, rng: d20s(5) });
  assert.equal(bad.total, 10);
  assert.equal(bad.success, false);
  assert.match(bad.line, /Failure: the lock holds/);
});

test("both rogue archetypes are trained, and a wizard is not", () => {
  const infiltrator = createCharacter({ archetypeId: "infiltrator", name: "Ix", appearanceAssetId: "sprite-01" });
  assert.equal(pickLock({ sheet: infiltrator, dc: 10, rng: d20s(10) }).allowed, true);
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Wiz", appearanceAssetId: "sprite-01" });
  assert.equal(pickLock({ sheet: wizard, dc: 10, rng: d20s() }).allowed, false);
});

// ── force the door ──────────────────────────────────────────────────────

test("force the door: Athletics against the DC", () => {
  const ok = forceDoor({ sheet: knight(), dc: 15, rng: d20s(12) });
  assert.equal(ok.total, 16, "12 + Athletics +4");
  assert.equal(ok.success, true);
  assert.equal(ok.line, "Force it (Athletics): 12 + 4 = 16 vs DC 15. Success: it gives way.");
  const bad = forceDoor({ sheet: knight(), dc: 15, rng: d20s(4) });
  assert.equal(bad.success, false);
  assert.match(bad.line, /Failure: it holds/);
});

test("force the door uses the bare Strength modifier when untrained", () => {
  const r = forceDoor({ sheet: shadow(), dc: 10, rng: d20s(10) });
  assert.equal(r.total, 9, "10 + the shadow's Strength -1");
  assert.match(r.line, /10 - 1 = 9/);
});

// ── skill check by name ─────────────────────────────────────────────────

test("skill names are case-insensitive and give the same result", () => {
  const sheet = shadow();
  const results = ["Sleight of Hand", "sleight of hand", "SLEIGHT OF HAND", "  Sleight Of Hand "].map((s) => skillCheck({ sheet, skill: s, dc: 12, rng: d20s(9) }));
  for (const r of results) {
    assert.equal(r.modifier, 5);
    assert.equal(r.total, 14);
    assert.equal(r.success, true);
  }
  assert.equal(results[0]!.line, "Sleight of Hand: 9 + 5 = 14 vs DC 12. Success.");
  assert.equal(results[1]!.line, results[0]!.line, "the canonical spelling is what the line prints");
  assert.equal(canonicalSkill("athletics"), "Athletics");
  assert.equal(canonicalSkill("basket weaving"), undefined);
});

test("an untrained skill uses the bare ability modifier", () => {
  const r = skillCheck({ sheet: knight(), skill: "stealth", dc: 10, rng: d20s(10) });
  assert.equal(r.modifier, 1);
});

test("an ability check uses the raw modifier, and accepts short and long names", () => {
  const a = skillCheck({ sheet: knight(), ability: "STR", dc: 10, rng: d20s(8) });
  const b = skillCheck({ sheet: knight(), ability: "strength", dc: 10, rng: d20s(8) });
  assert.equal(a.modifier, 2);
  assert.equal(a.total, 10);
  assert.equal(a.success, true);
  assert.equal(a.line, b.line);
  assert.match(a.line, /^Strength check: 8 \+ 2 = 10 vs DC 10\. Success\.$/);
  assert.equal(canonicalAbility("Wisdom"), "wis");
  assert.equal(canonicalAbility("luck"), undefined);
});

test("a skill rolled with a different ability keeps its training", () => {
  // Intimidation trained bonus +4 on a sheet with Charisma 0: swapping to
  // Strength -1 replaces the Charisma part (0) and keeps the training (+4).
  const r = skillCheck({ sheet: shadow(), skill: "Intimidation", ability: "str", dc: 10, rng: d20s(10) });
  assert.equal(r.modifier, 3);
  assert.match(r.line, /^Strength \(Intimidation\): 10 \+ 3 = 13/);
});

test("skillCheck fails on an unknown skill or ability and on neither", () => {
  assert.throws(() => skillCheck({ sheet: knight(), skill: "Juggling", dc: 10, rng: d20s(10) }), /not a skill/);
  assert.throws(() => skillCheck({ sheet: knight(), ability: "luck", dc: 10, rng: d20s(10) }), /not an ability/);
  assert.throws(() => skillCheck({ sheet: knight(), dc: 10, rng: d20s(10) }), /needs a skill or an ability/);
});

test("skillCheck advantage and disadvantage show two dice", () => {
  const adv = skillCheck({ sheet: knight(), skill: "Athletics", dc: 20, advantage: "advantage", rng: d20s(3, 17) });
  assert.equal(adv.roll, 17);
  assert.equal(adv.dice.length, 2);
  const dis = skillCheck({ sheet: knight(), skill: "Athletics", dc: 20, advantage: "disadvantage", rng: d20s(3, 17) });
  assert.equal(dis.roll, 3);
});

test("a failed check says Failure with the real numbers", () => {
  const r = skillCheck({ sheet: knight(), skill: "athletics", dc: 20, rng: d20s(5) });
  assert.equal(r.line, "Athletics: 5 + 4 = 9 vs DC 20. Failure.");
  assert.equal(r.success, false);
});

// ── creature skills ─────────────────────────────────────────────────────

test("a creature's listed skill wins, else its ability modifier", () => {
  const goblin = BESTIARY.find((b) => b.id === "goblin")!;
  assert.equal(monsterSkill(goblin, "Stealth"), 6, "listed on the bestiary entry");
  assert.equal(monsterSkill(goblin, "stealth"), 6, "case-insensitive");
  assert.equal(monsterSkill(goblin, "Athletics"), -1, "Strength 8");
  assert.equal(monsterSkill(goblin, "Acrobatics"), 2, "Dexterity 14");
  assert.equal(monsterSkill(goblin, "Perception"), -1, "Wisdom 8, not the passive 9");
  assert.equal(monsterSkill(goblin, "Basket Weaving"), 0);
});

test("a statblock-only creature uses its ability modifiers", () => {
  const drone = MONSTER_STATBLOCKS.token_drone!;
  assert.equal(monsterSkill(drone, "Athletics"), 1);
  assert.equal(monsterSkill(drone, "Acrobatics"), 2);
  assert.equal(monsterSkill(drone, "perception"), -3);
});

test("the shove profile and passive Perception come from the bestiary, then the statblock, then a fallback", () => {
  assert.deepEqual(monsterShoveProfile("token_goblin"), { athletics: -1, acrobatics: 2, size: "Small", name: "Goblin" });
  assert.equal(monsterShoveProfile("token_skeleton").size, "Medium");
  assert.equal(monsterShoveProfile("token_drone").size, "Small");
  assert.equal(monsterShoveProfile("token_raider").size, "Medium");
  assert.deepEqual(monsterShoveProfile("token_never_heard_of_it"), { athletics: 1, acrobatics: 1, size: "Medium", name: "Hostile" });
  assert.equal(monsterPassivePerception("token_goblin"), 9);
  assert.equal(monsterPassivePerception("token_raider"), 10);
  assert.equal(monsterPassivePerception("token_drone"), 7);
  assert.equal(monsterPassivePerception(undefined), 11, "the fallback creature's Wisdom +1");
});

test("the kick bug end to end: a goblin is shoved, and the board says where it lands", () => {
  const layout = room([], [tok("hero", 4, 5, "pc"), tok("gob", 5, 5)]);
  const profile = monsterShoveProfile("token_goblin");
  const shove = shoveContest({ attacker: knight(), target: profile, mode: "push", rng: d20s(15, 4) });
  assert.equal(shove.success, true);
  const path = pushDestination(layout, MANIFEST, { x: 5, y: 5 }, { x: 4, y: 5 }, 1);
  assert.deepEqual(path, [{ x: 6, y: 5 }], "the goblin really moves one square");
  const kick = unarmedStrike({ attacker: knight(), targetAC: 15, rng: d20s(14), label: "Kick" });
  assert.equal(kick.damage, 3, "and it really takes damage");
});

// ── house rule ──────────────────────────────────────────────────────────

test("no em or en dash characters anywhere in the module or its tests", () => {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  for (const rel of ["src/games/livingtable/session/maneuvers.ts", "test/livingtable-maneuvers.test.ts"]) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(!text.includes(em), `${rel} contains an em dash`);
    assert.ok(!text.includes(en), `${rel} contains an en dash`);
  }
});

// ── harvest ─────────────────────────────────────────────────────────────

test("resolveHarvest: a rat's pelt comes on a Survival success and not on a failure, with the hero's real modifier", async () => {
  const { resolveHarvest } = await import("../src/games/livingtable/table/flows/maneuvers");
  const { harvestForToken } = await import("../src/games/livingtable/rules/corpses");
  const rat = harvestForToken("token_rat")!;
  assert.ok(rat, "the rat has something to harvest");
  const sheet = knight({ skills: [skill("Survival", "wis", 3)] });
  // d20 = 12 + 3 = 15 against DC 8: the pelt.
  const win = resolveHarvest(sheet, rat, d20s(12));
  assert.equal(win.check.success, true);
  assert.equal(win.check.modifier, 3);
  assert.equal(win.item?.name, "Rat pelt");
  assert.notEqual(win.item, rat.item, "a copy, not the table's own object");
  // d20 = 2 + 3 = 5 against DC 8: nothing, and the carcass is the flow's to spoil.
  const lose = resolveHarvest(sheet, rat, d20s(2));
  assert.equal(lose.check.success, false);
  assert.equal(lose.item, null);
  // Exactly the DC is a success (a check meets or beats it).
  assert.equal(resolveHarvest(sheet, rat, d20s(5)).item?.name, "Rat pelt");
  // An untrained hero still rolls: Survival is an anyone-can-try skill, with the plain ability modifier.
  const untrained = resolveHarvest(knight({ skills: [] }), rat, d20s(9));
  assert.equal(untrained.check.modifier, knight().modifiers.wis);
  assert.equal(untrained.check.success, true, "9 + 0 beats DC 8");
});

test("the harvest flow marks the body harvested on a success AND on a failure, and fills the pack only on a success (read from the source)", () => {
  const src = readFileSync(join(ROOT, "src/games/livingtable/table/flows/maneuvers.ts"), "utf8");
  const flow = src.slice(src.indexOf("async function harvestFlow"), src.indexOf("// What the other modules call or read."));
  assert.match(flow, /harvestForToken\(body\.token\)/, "what a body yields comes from its token");
  assert.match(flow, /resolveHarvest\(/);
  assert.equal((flow.match(/harvested: true/g) ?? []).length, 2, "success and failure both spoil the carcass");
  assert.match(flow, /takeIntoPack\(p, out\.item\.name, out\.item\.note\)/);
  assert.match(flow, /tc\.spendCost\(p, act\.cost\)/);
  assert.match(flow, /await tc\.afterManeuver\(\)/);
  // The old stub is gone, and nothing a player reads names the bench.
  assert.doesNotMatch(src, /nothing to harvest here: the bench|is not something the bench/);
  assert.match(src, /is not something you can do here/);
});
