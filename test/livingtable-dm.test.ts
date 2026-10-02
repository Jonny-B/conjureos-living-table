/**
 * Tests for the Living Table's DM turn protocol
 * (src/games/livingtable/dm/): the wire schema's validator, and the
 * system-prompt builder.
 *
 * The load-bearing property under test throughout is DESIGN.md's "the model
 * never overrides a die roll" -- so alongside the usual accept/reject
 * pairs, this file checks the SCHEMA itself has nowhere a roll outcome could
 * come from (not just that validateDmTurn happens to reject one today).
 *
 * Run: npx tsx --test test/livingtable-dm.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDmTurn,
  type AttackRollRequest,
  type CheckRollRequest,
  type DmTurn,
  type ResolvedRoll,
  type SaveRollRequest,
} from "../src/games/livingtable/dm/turnSchema";
import {
  buildDmSystemPrompt,
  type AvailableAssetIds,
  type DmCharacterView,
  type DmPromptArgs,
} from "../src/games/livingtable/dm/promptBuilder";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world/coordinates";
import type { OffscreenCells, Playspace } from "../src/games/livingtable/world/perception";
import { assembleCell, emptyWorld, type AssetManifest } from "../src/games/livingtable/world";
import { checkAttackReach, type CombatGeometry } from "../src/games/livingtable/world/reach";
import { complete, parseLoose } from "../src/bridge/ai";
import { BEGIN_CAMPAIGN_MESSAGE, describeMoveIntoFog } from "../src/games/livingtable/session/dmContext";
import { SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";
import { PALETTE as FANTASY_PALETTE } from "../scripts/assets/fantasy";
import { adaptManifest } from "../src/games/livingtable/assets/manifestCache";
import { RENDER_ONLY_ASSET_IDS } from "../src/games/livingtable/render/wallProfiles";

// ── fixtures ─────────────────────────────────────────────────────────────

/** A blank 20x15 all-floor grid -- the cheapest layout that passes shape validation. */
function blankTiles(): string[][] {
  return Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor"));
}

/**
 * A resolved attack roll. `against` is required, matching the real schema
 * (AttackRollRequest.against is no longer optional -- an attack roll is
 * always aimed at one token; see turnSchema.ts's doc comment on why the
 * earlier "optional, matches any token" version was a real citation bypass).
 */
function attackRoll(id: string, by: string, against: string, hit: boolean): ResolvedRoll {
  return { id, kind: "attack", by, against, roll: hit ? 17 : 2, total: hit ? 21 : 6, hit, critical: false, fumble: false };
}

/** A resolved saving throw -- under SRD convention, a FAILED save is the one that lets a bad effect land on `by`. */
function saveRoll(id: string, by: string, success: boolean): ResolvedRoll {
  return { id, kind: "save", by, roll: success ? 18 : 3, total: success ? 22 : 7, success };
}

/** A resolved skill check -- unlike a save, a SUCCESSFUL check is the one that lets `by`'s attempted action land. */
function checkRoll(id: string, by: string, success: boolean): ResolvedRoll {
  return { id, kind: "check", by, roll: success ? 18 : 3, total: success ? 22 : 7, success };
}

function wellFormedTurn(): unknown {
  return {
    narration: "The goblin snarls and raises its rusty blade.",
    actions: [
      { type: "moveToken", cx: 0, cy: 0, tokenId: "goblin-1", to: { x: 5, y: 5 }, reason: "staging" },
      {
        type: "placeProp",
        cx: 0,
        cy: 0,
        prop: { id: "brazier-1", assetId: "brazier", x: 3, y: 3, facing: "N" },
      },
    ],
    rollRequests: [
      { id: "r1", by: "goblin-1", against: "pc-kira", kind: "attack", reason: "the goblin swings at Kira" },
    ],
    menuHint: ["Attack", "Move", "Talk"],
  };
}

// ── validateDmTurn: accepts a well-formed turn ────────────────────────────

test("validateDmTurn accepts a well-formed turn", () => {
  const turn = validateDmTurn(wellFormedTurn());
  assert.equal(turn.narration, "The goblin snarls and raises its rusty blade.");
  assert.equal(turn.actions.length, 2);
  assert.equal(turn.actions[0]!.type, "moveToken");
  assert.equal(turn.rollRequests?.length, 1);
  assert.equal(turn.rollRequests![0]!.kind, "attack");
  assert.deepEqual(turn.menuHint, ["Attack", "Move", "Talk"]);
});

test("validateDmTurn accepts a pure-narration turn with no actions and no rolls", () => {
  const turn = validateDmTurn({ narration: "The tavern is quiet tonight.", actions: [] });
  assert.equal(turn.actions.length, 0);
  assert.equal(turn.rollRequests, undefined);
});

test("validateDmTurn accepts a full assembleCell action with a real layout", () => {
  const layout = {
    tiles: blankTiles(),
    props: [{ id: "p1", assetId: "chest", x: 2, y: 2 }],
    tokens: [{ id: "t1", assetId: "hero", x: 1, y: 1, kind: "pc" }],
    exits: [{ at: { x: CELL_WIDTH - 1, y: 5 }, edge: "E", toCell: { cx: 1, cy: 0 } }],
  };
  const turn = validateDmTurn({
    narration: "You step into a torch-lit hall.",
    actions: [{ type: "assembleCell", cx: 0, cy: 0, layout }],
  });
  const action = turn.actions[0]!;
  assert.equal(action.type, "assembleCell");
  if (action.type === "assembleCell") {
    assert.equal(action.layout.tiles.length, CELL_HEIGHT);
    assert.equal(action.layout.tiles[0]!.length, CELL_WIDTH);
    assert.equal(action.layout.exits[0]!.edge, "E");
  }
});

// ── validateDmTurn: rejections, each with an actionable message ──────────

test("validateDmTurn rejects a turn missing narration", () => {
  assert.throws(() => validateDmTurn({ actions: [] }), /narration/);
});

test("validateDmTurn rejects a turn whose narration is an empty string", () => {
  assert.throws(() => validateDmTurn({ narration: "   ", actions: [] }), /narration/);
});

test("validateDmTurn rejects an action of an unknown type, naming the legal ones", () => {
  const turn = { narration: "You look around.", actions: [{ type: "castFireball", cx: 0, cy: 0 }] };
  assert.throws(() => validateDmTurn(turn), (err: unknown) => {
    assert.ok(err instanceof Error);
    // The message has to be actionable for completeJson's retry -- it must
    // name the type it rejected AND the vocabulary it should have used.
    assert.match(err.message, /castFireball/);
    assert.match(err.message, /assembleCell/);
    assert.match(err.message, /setDoorState/);
    return true;
  });
});

test("validateDmTurn rejects a moveToken action missing its destination", () => {
  const turn = { narration: "It shuffles closer.", actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "g1" }] };
  assert.throws(() => validateDmTurn(turn), /\.to/);
});

test("validateDmTurn rejects a moveToken/removeToken missing its reason field", () => {
  const turn = {
    narration: "Something shifts.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "g1", to: { x: 1, y: 1 } }],
  };
  assert.throws(() => validateDmTurn(turn), /\.reason/);
});

// ── combat-outcome gating: closing "skip the dice by never asking" ───────
//
// DESIGN.md's "the model never overrides a die roll" already holds
// structurally at the schema level (rollRequests has nowhere a result could
// live -- see the tests further down). The gap this section covers is
// different: nothing stopped the model from narrating a killing blow and
// removing the token in the SAME turn, enacting the outcome by never
// requesting a roll at all rather than by overriding one. A "combat"
// reason'd moveToken/removeToken must now cite a resolvedRollId that is
// actually present in the turn's resolved-rolls context -- and, critically,
// an id only present in THIS turn's own rollRequests (i.e. requested, not
// yet resolved) does not count, because that roll has no result yet.

test("validateDmTurn rejects a removeToken with reason 'combat' and no resolvedRollId", () => {
  const turn = {
    narration: "The goblin crumples, run through.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat" }],
  };
  assert.throws(() => validateDmTurn(turn), /resolvedRollId/);
});

test("validateDmTurn rejects a moveToken with reason 'combat' and no resolvedRollId", () => {
  const turn = {
    narration: "The blow sends the goblin reeling back a few paces.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "goblin-1", to: { x: 8, y: 8 }, reason: "combat" }],
  };
  assert.throws(() => validateDmTurn(turn), /resolvedRollId/);
});

test("validateDmTurn accepts a removeToken with reason 'combat' whose resolvedRollId is present in this turn's resolved-rolls context", () => {
  const turn = {
    narration: "The goblin crumples, run through.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat", resolvedRollId: "r1" }],
  };
  const result = validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-1", true)] });
  const action = result.actions[0]!;
  assert.equal(action.type, "removeToken");
  if (action.type === "removeToken") {
    assert.equal(action.reason, "combat");
    assert.equal(action.resolvedRollId, "r1");
  }
});

test("validateDmTurn rejects a resolvedRollId that isn't in this turn's resolved-rolls context", () => {
  const turn = {
    narration: "The goblin crumples, run through.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat", resolvedRollId: "r1" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [attackRoll("some-other-roll", "pc-kira", "goblin-1", true)] }),
    /not a roll this turn has seen resolved/,
  );
});

test("validateDmTurn rejects a resolvedRollId that only names a roll THIS turn is requesting -- a request has no result yet", () => {
  const turn = {
    narration: "Kira's blade finds the goblin.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat", resolvedRollId: "r1" }],
    rollRequests: [{ id: "r1", by: "pc-kira", kind: "attack", reason: "Kira attacks the goblin" }],
  };
  // r1 is only being asked for this turn (it's in rollRequests, not the
  // resolved-rolls context handed to validateDmTurn) -- citing it must fail
  // exactly like any other id the engine never actually resolved.
  assert.throws(() => validateDmTurn(turn), /not a roll this turn has seen resolved/);
});

// ── round 2: the gate must check WHAT the cited roll decided and WHO it
// concerned, not just that its id exists -- a critic-found gap. A resolved
// MISS's id, or a roll about an unrelated token, satisfied the first
// version of this gate exactly as well as a genuine hit did, and nothing
// stopped one resolved roll from "justifying" several separate removals.

test("validateDmTurn rejects a combat removeToken citing a resolved roll that MISSED", () => {
  const turn = {
    narration: "The goblin somehow crumples anyway.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat", resolvedRollId: "r1" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-1", false)] }),
    /does not decide a combat outcome/,
  );
});

test("validateDmTurn rejects a combat moveToken citing a save the token SUCCEEDED at -- a resisted effect decides nothing", () => {
  const turn = {
    narration: "The goblin is forced back anyway.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "goblin-1", to: { x: 8, y: 8 }, reason: "combat", resolvedRollId: "r1" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [saveRoll("r1", "goblin-1", true)] }),
    /does not decide a combat outcome/,
  );
});

test("validateDmTurn accepts a combat moveToken citing a save the token FAILED -- the effect actually lands", () => {
  const turn = {
    narration: "The goblin fails to resist and is flung backward.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "goblin-1", to: { x: 8, y: 8 }, reason: "combat", resolvedRollId: "r1" }],
  };
  const result = validateDmTurn(turn, { resolvedRolls: [saveRoll("r1", "goblin-1", false)] });
  assert.equal(result.actions[0]!.type, "moveToken");
});

test("validateDmTurn rejects a combat moveToken citing a check the token FAILED -- a failed attempt achieved nothing", () => {
  const turn = {
    narration: "The rogue drags the guard off the ledge anyway.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "guard-1", to: { x: 8, y: 8 }, reason: "combat", resolvedRollId: "r1" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [checkRoll("r1", "guard-1", false)] }),
    /does not decide a combat outcome/,
  );
});

test("validateDmTurn accepts a combat moveToken citing a check the token SUCCEEDED at", () => {
  const turn = {
    narration: "The guard is shoved off the ledge.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "guard-1", to: { x: 8, y: 8 }, reason: "combat", resolvedRollId: "r1" }],
  };
  const result = validateDmTurn(turn, { resolvedRolls: [checkRoll("r1", "guard-1", true)] });
  assert.equal(result.actions[0]!.type, "moveToken");
});

test("validateDmTurn rejects a combat removeToken whose cited roll hit a DIFFERENT token", () => {
  const turn = {
    narration: "The goblin crumples, run through -- somehow, from a hit on someone else entirely.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat", resolvedRollId: "r1" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-2", true)] }),
    /does not concern "goblin-1"/,
  );
});

test("validateDmTurn rejects an attack rollRequest with no 'against' -- there is no such thing as an untargeted attack roll", () => {
  // Regression test for the exploit a gauntlet critic found: an earlier
  // schema made `against` optional, and tokenMatchesRoll treated an
  // against-less resolved hit as matching ANY tokenId -- so a model could
  // request an untargeted attack, get told it hit, then cite that single
  // roll to justify a "combat" removeToken on any token in the scene. Fixed
  // at the source: `against` is now required on the roll REQUEST, so the
  // ambiguous resolved-roll shape this exploit needed can never be
  // constructed via the model-facing path in the first place.
  const turn = {
    narration: "The goblin swings wildly.",
    actions: [],
    rollRequests: [{ id: "r1", by: "goblin-1", kind: "attack", reason: "the goblin swings, but at whom?" }],
  };
  assert.throws(() => validateDmTurn(turn), /has no "against"/);
});

test("validateDmTurn rejects a combat removeToken that cites an attack roll aimed at a DIFFERENT token, even when only one token is in play", () => {
  // The direct proof that the fix holds, not just that the request-side gap
  // is closed: even with a real, correctly-shaped resolved roll in context,
  // citing it for a token it didn't target is still rejected -- the same
  // "does not concern" check as the pre-existing DIFFERENT-token test above,
  // exercised against the now-mandatory `against` field instead of an
  // omitted one.
  const turn = {
    narration: "The bystander crumples -- from a hit that landed on someone else entirely.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "bystander-1", reason: "combat", resolvedRollId: "r1" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-1", true)] }),
    /does not concern "bystander-1"/,
  );
});

test("validateDmTurn rejects citing the SAME resolvedRollId a second time for a second combat action in one turn", () => {
  const turn = {
    narration: "One stroke fells both goblins somehow.",
    actions: [
      { type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat", resolvedRollId: "r1" },
      { type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-2", reason: "combat", resolvedRollId: "r1" },
    ],
  };
  // Target the roll at goblin-1 so the FIRST action passes cleanly on
  // correspondence -- the "already cited" check runs before the token-match
  // check (see requireResolvedRollForCombat's ordering), so the second
  // action's rejection is isolated to re-citation, not correspondence,
  // regardless of which token the roll was actually aimed at.
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-1", true)] }),
    /already cited by an earlier combat action this turn/,
  );
});

// ── round 3: reason "staging" must not be a free pass around the whole gate
// -- a critic-found gap. The first two rounds above only ever ran when
// reason === "combat", the model's OWN self-reported label; a "combat"
// outcome tagged "staging" instead skipped the entire function, no
// rollRequests, no resolvedRollId, no error. This section closes the
// realistic version of that: a decisive roll the engine already resolved
// THIS turn, concerning the exact token being moved/removed, is now checked
// regardless of what reason claims. It does not and cannot close the
// degenerate version -- see the last test in this section.

test("validateDmTurn rejects a 'staging' removeToken when a decisive, unspent resolved roll this turn concerns that exact token", () => {
  const turn = {
    narration: "Kira's blade finds the goblin's throat. It crumples, dead.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "staging" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-1", true)] }),
    /reason "staging".*resolved roll "r1".*concerns "goblin-1"/s,
  );
});

test("validateDmTurn rejects a 'staging' moveToken when a decisive, unspent resolved SAVE this turn concerns that exact token", () => {
  const turn = {
    narration: "The blast throws the guard backward.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "guard-1", to: { x: 8, y: 8 }, reason: "staging" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [saveRoll("r1", "guard-1", false)] }),
    /reason "staging"/,
  );
});

test("validateDmTurn does NOT flag a 'staging' action just because a decisive attack roll resolved this turn for someone else entirely", () => {
  // A resolved hit against goblin-1 implicates goblin-1, nobody else --
  // tokenPositivelyImplicatedByRoll must not treat "some decisive roll
  // happened this turn" as evidence against an unrelated token's ordinary
  // staging move just because a fight was also going on.
  const turn = {
    narration: "The merchant steps aside to let you pass.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "merchant-1", to: { x: 6, y: 6 }, reason: "staging" }],
  };
  const result = validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-1", true)] });
  assert.equal(result.actions[0]!.type, "moveToken");
});

test("validateDmTurn does NOT flag a 'staging' action on a token whose only matching decisive roll was already cited by an earlier combat action this same turn", () => {
  const turn = {
    narration: "The goblin falls dead, then its fallen weapon is kicked out of the way.",
    actions: [
      { type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "combat", resolvedRollId: "r1" },
      { type: "moveToken", cx: 0, cy: 0, tokenId: "goblin-1", to: { x: 9, y: 9 }, reason: "staging" },
    ],
  };
  // The second action names the same, now-removed token again purely to
  // exercise "already spent" in isolation -- the point under test is that a
  // spent roll doesn't keep tripping the staging check for every later
  // action that happens to share its tokenId.
  const result = validateDmTurn(turn, { resolvedRolls: [attackRoll("r1", "pc-kira", "goblin-1", true)] });
  assert.equal(result.actions.length, 2);
});

test("acknowledged residual gap: a 'staging' removeToken narrated as an outright kill still validates when NO roll was ever requested or resolved for that token -- there is no fact in this turn's context to check the label against, the same category of unfixable gap this file already documents for narration text, just on the reason field instead", () => {
  const turn = {
    narration: "Kira's blade finds the goblin's throat. It crumples, dead, without a sound.",
    actions: [{ type: "removeToken", cx: 0, cy: 0, tokenId: "goblin-1", reason: "staging" }],
  };
  // No rollRequests, no resolvedRollId, no resolvedRolls context at all --
  // this is the critic's exact repro. It validates cleanly, on purpose and
  // documented, not by oversight: closing it needs either a hostility/HP
  // model this shape-only validator deliberately has no access to, or
  // narration-content analysis, which this file already treats as
  // unreliable (see the "unfixable prose gap" test above). The mitigation
  // that DOES exist for this residual case is the system prompt telling the
  // model honestly what "combat" means and that mislabeling is not a way
  // around the rule -- prompt-only, and known to be exactly that.
  const result = validateDmTurn(turn);
  assert.equal(result.actions[0]!.type, "removeToken");
});

test("validateDmTurn accepts a non-combat moveToken (staging) with no resolvedRollId at all", () => {
  const turn = {
    narration: "The merchant steps aside to let you pass.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "merchant-1", to: { x: 6, y: 6 }, reason: "staging" }],
  };
  const result = validateDmTurn(turn);
  const action = result.actions[0]!;
  assert.equal(action.type, "moveToken");
  if (action.type === "moveToken") {
    assert.equal(action.reason, "staging");
    assert.equal(action.resolvedRollId, undefined);
  }
});

// The inverse of the rule this file used to assert. An attack roll REQUIRED a
// numeric targetAC once, which is how the model came to be choosing the number
// its own d20 was compared against. session/combat.ts's
// defenderACForRollRequest owns every defender's AC now, from the player's
// sheet or the creature's statblock, so the field is not merely unnecessary,
// it must not be on the wire at all: a silently ignored field is exactly how
// this half-regressed between rounds, with the validator still accepting a
// number that no longer meant anything.
test("validateDmTurn rejects an attack rollRequest that carries a targetAC at all, rather than ignoring it", () => {
  const turn = {
    narration: "The goblin lunges.",
    actions: [],
    rollRequests: [{ id: "r1", by: "goblin-1", against: "pc-kira", kind: "attack", targetAC: 2, reason: "lunges at Kira" }],
  };
  assert.throws(() => validateDmTurn(turn), /targetAC/);
});

test("an attack rollRequest with no targetAC is exactly what the engine now wants", () => {
  const turn = validateDmTurn({
    narration: "The goblin lunges.",
    actions: [],
    rollRequests: [{ id: "r1", by: "goblin-1", against: "pc-kira", kind: "attack", reason: "lunges at Kira" }],
  });
  assert.equal(turn.rollRequests?.length, 1);
  assert.deepEqual(Object.keys(turn.rollRequests![0]!).sort(), ["against", "by", "id", "kind", "reason"]);
});

test("validateDmTurn rejects a save rollRequest missing its DC", () => {
  const turn = {
    narration: "Poison gas hisses from the trap.",
    actions: [],
    rollRequests: [{ id: "r1", by: "pc-kira", kind: "save", ability: "con", reason: "poison trap" }],
  };
  assert.throws(() => validateDmTurn(turn), /\bdc\b/i);
});

test("validateDmTurn rejects a check rollRequest missing its DC", () => {
  const turn = {
    narration: "You search the shelves.",
    actions: [],
    rollRequests: [{ id: "r1", by: "pc-kira", kind: "check", skill: "Investigation", reason: "searching the shelves" }],
  };
  assert.throws(() => validateDmTurn(turn), /\bdc\b/i);
});

test("validateDmTurn rejects a rollRequest of an unknown kind", () => {
  const turn = {
    narration: "You try something unusual.",
    actions: [],
    rollRequests: [{ id: "r1", by: "pc-kira", kind: "luck", dc: 10, reason: "cosmic favor" }],
  };
  assert.throws(() => validateDmTurn(turn), /luck/);
});

test("validateDmTurn rejects an assembleCell layout with the wrong number of tile rows", () => {
  const layout = { tiles: blankTiles().slice(0, CELL_HEIGHT - 1), props: [], tokens: [], exits: [] };
  const turn = { narration: "A new room opens.", actions: [{ type: "assembleCell", cx: 1, cy: 0, layout }] };
  assert.throws(() => validateDmTurn(turn), /tiles/);
});

// ── the structural guarantee: no field a roll RESULT could originate from ─

test("a turn cannot smuggle a roll RESULT into narration disguised as fact -- but this is prose, an acknowledged unfixable gap, not a schema field", () => {
  // We CANNOT and do not try to stop narration text from reading like a
  // result already happened -- it's a free-text field, that's the honest
  // limit. What DOES hold, checked below, is that the roll REQUEST sitting
  // right next to that prose has no structured field a result could live in.
  const turn = validateDmTurn({
    narration: "The goblin's blade finds you -- a solid hit for 8 damage.",
    actions: [],
    rollRequests: [
      { id: "r1", by: "goblin-1", against: "pc-kira", kind: "attack", reason: "goblin swings at Kira" },
    ],
  });
  assert.match(turn.narration, /8 damage/); // the unfixable prose gap, acknowledged

  const keys = Object.keys(turn.rollRequests![0]!);
  const forbidden = ["result", "roll", "hit", "success", "total", "outcome", "damage", "won", "critical", "fumble"];
  for (const f of forbidden) {
    assert.ok(!keys.includes(f), `rollRequests[0] should never carry a "${f}" field, got keys: ${keys.join(", ")}`);
  }
});

test("validateDmTurn rebuilds every object as an explicit literal, so a stray result-shaped field the model invented never survives validation", () => {
  const turn = validateDmTurn({
    narration: "You strike true.",
    actions: [],
    rollRequests: [
      {
        id: "r1",
        by: "pc-kira",
        against: "goblin-1",
        kind: "attack",
        reason: "Kira attacks",
        // Not part of the schema -- a model hallucinating its own result.
        result: "hit",
        damage: 8,
      },
    ],
  });
  const keys = Object.keys(turn.rollRequests![0]!);
  assert.deepEqual(keys.sort(), ["against", "by", "id", "kind", "reason"]);
});

test("DmTurn's typed shape has no field a roll outcome could structurally originate from", () => {
  // Compile-time assertion, not just a runtime one: if any RollRequest
  // variant (or DmTurn itself) ever grows a field named like a roll
  // OUTCOME, this file fails to typecheck (see the ForbiddenKey exclusion
  // below), independent of whatever validateDmTurn happens to do at
  // runtime. We still build and inspect real instances afterward so the
  // check isn't purely a type-level trick with nothing exercising it.
  type ForbiddenKey = "result" | "roll" | "hit" | "success" | "total" | "outcome" | "damage" | "won" | "critical" | "fumble";
  type NoForbiddenKeys<T> = Extract<keyof T, ForbiddenKey> extends never ? true : false;

  const attackIsClean: NoForbiddenKeys<AttackRollRequest> = true;
  const saveIsClean: NoForbiddenKeys<SaveRollRequest> = true;
  const checkIsClean: NoForbiddenKeys<CheckRollRequest> = true;
  const turnIsClean: NoForbiddenKeys<DmTurn> = true;
  assert.ok(attackIsClean && saveIsClean && checkIsClean && turnIsClean);

  // Runtime companion: every field an actual AttackRollRequest can carry.
  const sample: AttackRollRequest = { id: "r1", by: "pc-kira", against: "goblin-1", kind: "attack", reason: "test" };
  assert.deepEqual(Object.keys(sample).sort(), ["against", "by", "id", "kind", "reason"]);

  // A save's `damageOnFailure` is the one field on any roll request that could
  // be mistaken for an outcome, so it gets its own check on both halves of
  // why it is not one. The NAME first: the ForbiddenKey list above bans the
  // exact key `damage`, and this field is deliberately not called that,
  // because a request field called `damage` is one a model eventually fills
  // in with 8 meaning "it took 8". Then the TYPE: it is dice the engine has
  // yet to roll, so a bare total is rejected outright rather than believed.
  const hazard = validateDmTurn({
    narration: "The coals flare.",
    actions: [],
    rollRequests: [{ id: "r1", by: "pc-kira", kind: "save", ability: "dex", dc: 13, damageOnFailure: "2d6", reason: "the coals" }],
  });
  assert.equal((hazard.rollRequests![0] as SaveRollRequest).damageOnFailure, "2d6");
  assert.throws(
    () =>
      validateDmTurn({
        narration: "The coals flare.",
        actions: [],
        rollRequests: [{ id: "r1", by: "pc-kira", kind: "save", ability: "dex", dc: 13, damageOnFailure: 8, reason: "the coals" }],
      }),
    /damageOnFailure/,
    "a save must never be able to report a damage TOTAL, only the dice for one",
  );
});

// ── action economy: closing "a combatant double-spends their action" ─────
//
// DESIGN.md's "The rules engine" lists action economy (action / bonus
// action / movement / reaction) among what's "enforced structurally." The
// gap this section covers: before this gate, rules/actionEconomy.ts's
// TurnEconomy/spendAction were correct, tested pure functions with no call
// site anywhere in the actual turn-validation pipeline -- nothing stopped
// the model from having the same combatant attack twice in one DmTurn (one
// narrated round). A repeat "attack" rollRequests entry naming the same
// "by" id now gets rejected as that double-spend.

test("validateDmTurn rejects a second 'attack' rollRequest naming the same 'by' id in one turn", () => {
  const turn = {
    narration: "The goblin swings once, then swings again before you can react.",
    actions: [],
    rollRequests: [
      { id: "r1", by: "goblin-1", against: "pc-kira", kind: "attack", reason: "first swing" },
      { id: "r2", by: "goblin-1", against: "pc-kira", kind: "attack", reason: "second swing" },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /goblin-1.*already spent their action/s);
});

test("validateDmTurn accepts two 'attack' rollRequests in one turn when they name different combatants", () => {
  const turn = {
    narration: "The goblin swings at Kira; Kira's companion wolf lunges at the goblin.",
    actions: [],
    rollRequests: [
      { id: "r1", by: "goblin-1", against: "pc-kira", kind: "attack", reason: "goblin swings at Kira" },
      { id: "r2", by: "wolf-1", against: "goblin-1", kind: "attack", reason: "wolf lunges at the goblin" },
    ],
  };
  const result = validateDmTurn(turn);
  assert.equal(result.rollRequests?.length, 2);
});

test("validateDmTurn does not let a repeat 'by' id on a 'save' or 'check' rollRequest trip the attack-only action-economy gate", () => {
  // Only the Attack action is gated here (see requireActionEconomyForAttack's
  // launch-scope note) -- a combatant can legitimately be named "by" on a
  // save/check and still attack once in the same turn, and two saves/checks
  // from the same id are not an action-economy violation this gate covers.
  const turn = {
    narration: "Kira braces against the blast, then swings back.",
    actions: [],
    rollRequests: [
      { id: "r1", by: "pc-kira", kind: "save", ability: "dex", dc: 13, reason: "dodges the blast" },
      { id: "r2", by: "pc-kira", against: "goblin-1", kind: "attack", reason: "Kira swings back" },
    ],
  };
  const result = validateDmTurn(turn);
  assert.equal(result.rollRequests?.length, 2);
});

// ── buildDmSystemPrompt ───────────────────────────────────────────────────

function samplePlayspace(): Playspace {
  return {
    cell: { cx: 0, cy: 0 },
    tiles: blankTiles(),
    walkable: Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => true)),
    opaque: Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => false)),
    props: [{ id: "chest-1", assetId: "chest", x: 4, y: 4 }],
    tokens: [{ id: "pc-kira", assetId: "knight", x: 2, y: 2, kind: "pc" }],
    exits: [{ at: { x: CELL_WIDTH - 1, y: 5 }, edge: "E", toCell: { cx: 1, cy: 0 } }],
  };
}

function sampleOffscreen(): OffscreenCells {
  const stub = (cx: number, cy: number): OffscreenCells["N"] => ({
    status: "unassembled",
    cell: { cx, cy },
    hint: "a rumored goblin camp",
    owedOpenings: [],
  });
  return {
    N: stub(0, -1),
    NE: stub(1, -1),
    E: { status: "assembled", cell: { cx: 1, cy: 0 }, summary: "assembled cell, 2 tokens, 1 prop" },
    SE: stub(1, 1),
    S: {
      status: "unassembled",
      cell: { cx: 0, cy: 1 },
      hint: "the marsh causeway; the half-sunken shrine is visible from here",
      owedOpenings: [{ edge: "N", at: { x: 10, y: 0 } }],
    },
    SW: stub(-1, 1),
    W: stub(-1, 0),
    NW: stub(-1, -1),
  };
}

/** The player character block the DM has to be told about, matching what session/dmContext.ts's buildDmCharacterView produces from a real CharacterSheet. */
function sampleCharacter(): DmCharacterView {
  return {
    tokenId: "pc-kira",
    name: "Kira",
    archetype: "The Shadow",
    level: 2,
    currentHp: 7,
    maxHp: 17,
    armorClass: 13,
    modifiers: { str: -1, dex: 2, con: 1, int: 2, wis: 1, cha: 0 },
    skills: [
      { skill: "Stealth", bonus: 6 },
      { skill: "Deception", bonus: 2 },
    ],
    // v2: gearItemName of the six worn pieces, GEAR_ROLES order, empty ring/amulet skipped.
    wearing: ["Shortblade", "Dark Cloak", "Hood", "Travel Boots"],
    inventory: ["Shortsword", "Thieves' tools"],
    conditions: ["prone"],
  };
}

function sampleArgs(): DmPromptArgs {
  const assetIds: AvailableAssetIds = { tiles: ["floor", "wall"], tokens: ["knight", "goblin"], props: ["chest", "brazier"] };
  return {
    template: "fantasy",
    campaignTitle: "The Salt Road",
    arcOutline: "A caravan escort quest that turns into uncovering a smuggling ring in Port Verren.",
    memoryContextBlock:
      "PERMANENT FACTS:\n- [npc] Mara the caravan master: trusts the party, paid half up front.\n" +
      "RECENT (condensed): The party left Elmsworth after a bar brawl.\n" +
      "RECENT (verbatim): You arrive at the crossroads as the sun sets.",
    playspace: samplePlayspace(),
    currentCell: { cx: 0, cy: 0 },
    offscreenCells: sampleOffscreen(),
    availableAssetIds: assetIds,
  };
}

test("buildDmSystemPrompt embeds the supplied memory context block verbatim", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /Mara the caravan master: trusts the party, paid half up front\./);
  assert.match(prompt, /The party left Elmsworth after a bar brawl\./);
});

test("buildDmSystemPrompt handles the campaign's very first turn, an undefined playspace, without crashing, and instructs the DM to assemble the starting cell", () => {
  // Regression test for a real bug a gauntlet critic found simulating a
  // fresh campaign end to end: the starting cell doesn't exist until the
  // DM's own first assembleCell call creates it, so a caller genuinely has
  // no Playspace to pass on turn one. An earlier version of the calling
  // code (LivingTable.tsx) threw "this room hasn't been built yet" right
  // here, which made a brand-new campaign structurally unable to ever
  // begin. playspace: undefined must produce a real, sane prompt, not a
  // crash and not a silently empty section.
  const args: DmPromptArgs = { ...sampleArgs(), playspace: undefined, currentCell: { cx: 0, cy: 0 } };
  const prompt = buildDmSystemPrompt(args);
  assert.match(prompt, /has not been assembled yet/);
  assert.match(prompt, /assembleCell.*\(0,0\)/s);
  // Must NOT throw trying to render a tile grid, tokens, props, or exits
  // that don't exist -- confirmed by buildDmSystemPrompt returning at all.
  assert.equal(typeof prompt, "string");
  assert.ok(prompt.length > 0);
});

test("buildDmSystemPrompt embeds an offscreen hint for an unbuilt neighbour and a summary for a built one", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /a rumored goblin camp/);
  assert.match(prompt, /assembled cell, 2 tokens, 1 prop/);
});

test("buildDmSystemPrompt states the DM must never narrate a roll result itself", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /never narrate|do not narrate/i);
  assert.match(prompt, /rollRequests/);
});

test("buildDmSystemPrompt states the combat-outcome citation rule explicitly, including RESOLVED ROLLS with nothing resolved yet", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /resolvedRollId/);
  assert.match(prompt, /RESOLVED ROLLS SINCE YOUR LAST TURN/);
  assert.match(prompt, /reason.*"staging"|staging.*reason/i);
  // sampleArgs() supplies no resolvedRolls -- the block must say so plainly, not render an empty list.
  assert.match(prompt, /no rolls have resolved/);
});

test("buildDmSystemPrompt lists a supplied resolvedRoll's id under RESOLVED ROLLS", () => {
  const args: DmPromptArgs = {
    ...sampleArgs(),
    resolvedRolls: [{ id: "r1", kind: "attack", by: "pc-kira", against: "goblin-1", roll: 17, total: 21, hit: true, critical: false, fumble: false }],
  };
  const prompt = buildDmSystemPrompt(args);
  assert.match(prompt, /id=r1/);
  assert.match(prompt, /hit=true/);
});

test("buildDmSystemPrompt contains no literal roll outcome -- it's an instruction document, not a played turn", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  // The prompt legitimately says the word "damage" as part of describing the
  // rules ("how much damage lands"), but it must never state a concrete
  // resolved roll like "you rolled a 17" or "critical hit for 8 damage" --
  // there is no roll happening while a system prompt is being built.
  assert.doesNotMatch(prompt, /\byou rolled\b/i);
  assert.doesNotMatch(prompt, /critical hit for \d/i);
  assert.doesNotMatch(prompt, /\bnatural 20\b.*!/i);
});

test("buildDmSystemPrompt lists only the asset ids it was given, per category", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /tiles: floor, wall/);
  assert.match(prompt, /tokens: knight, goblin/);
  assert.match(prompt, /props: chest, brazier/);
});

test("buildDmSystemPrompt names the campaign and reflects the requested template", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /The Salt Road/);
  assert.match(prompt, /fantasy/i);

  const sciFiArgs = { ...sampleArgs(), template: "scifi" as const };
  const sciFiPrompt = buildDmSystemPrompt(sciFiArgs);
  assert.match(sciFiPrompt, /sci-fi/i);
});

// ── the offscreen block: the DM is authored blind without this ────────────
//
// assembleCell is the one paid action that builds the world, and the prompt
// used to hand the model eight bare direction letters and the word
// "unexplored" for every one of them. It never said which COORDINATE a letter
// meant, never said that north is cy-1 (screen convention, not compass), and
// never mentioned the openings a built neighbour had already staked on the
// cell being built -- which is precisely how a normal fully-bordered room got
// the whole assembly rejected for an exit landing on a wall.

test("buildDmSystemPrompt prints each neighbour's real cell coordinates, not just a direction letter", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /N: not built yet \(cell \(0,-1\)\)/);
  assert.match(prompt, /E: already built \(cell \(1,0\)\)/);
  assert.match(prompt, /W: not built yet \(cell \(-1,0\)\)/);
});

test("buildDmSystemPrompt spells out an opening a built neighbour has already staked on an unbuilt one", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  // The S neighbour owes a north opening at (10,0): the DM has to be told, or
  // it draws a solid border there and the engine has to repair the room it
  // just paid for.
  assert.match(prompt, /N edge MUST be walkable at \(10,0\)/);
});

test("buildDmSystemPrompt carries each unbuilt neighbour's real hint rather than a bare 'unexplored'", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /the marsh causeway; the half-sunken shrine is visible from here/);
});

test("buildDmSystemPrompt states the axis convention and that a fog crossing assembles the NEIGHBOUR, not the current cell", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /north is cy-1/i);
  assert.match(prompt, /west is cx-1/i);
  assert.match(prompt, /neighbour/i);
});

// ── who is at your table ─────────────────────────────────────────────────
//
// DmPromptArgs used to carry no character field of any kind: the only line
// about the player that ever reached the model was a token id and a sprite
// name. It was ordered to write second-person narration for someone whose
// name, class and hit points it did not know, and required to supply a
// targetAC for attacks on a character whose AC it was never told.

test("buildDmSystemPrompt renders a WHO IS AT YOUR TABLE block with the character's real numbers", () => {
  const prompt = buildDmSystemPrompt({ ...sampleArgs(), character: sampleCharacter() });
  assert.match(prompt, /WHO IS AT YOUR TABLE/);
  assert.match(prompt, /Kira/);
  assert.match(prompt, /The Shadow/);
  assert.match(prompt, /level 2/i);
  assert.match(prompt, /7\/17/); // current/max HP
  assert.match(prompt, /AC 13/);
  assert.match(prompt, /dex \+2/);
  assert.match(prompt, /Stealth \+6/);
  assert.match(prompt, /Thieves' tools/);
  assert.match(prompt, /prone/);
  assert.match(prompt, /pc-kira/);
});

// The promise this makes changed with the wire. It used to be "a targetAC you
// supply for the PLAYER is ignored", which was true when it was written and
// became false twice over: the engine owns every creature's AC now, not just
// the player's, and the field is rejected rather than ignored. A prompt that
// still said "ignored" would be teaching the model a field that is guaranteed
// to fail validation.
test("buildDmSystemPrompt tells the DM plainly that a targetAC on any attack is rejected, not just one aimed at the player", () => {
  const prompt = buildDmSystemPrompt({ ...sampleArgs(), character: sampleCharacter() });
  assert.match(prompt, /targetAC/);
  assert.match(prompt, /rejected/i);
  assert.doesNotMatch(prompt, /"targetAC":\s*0/, "the reply shape must not still be asking the model to send one");
});

test("buildDmSystemPrompt teaches the save damage field, since nothing else tells the model a failed save can cost anything", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /damageOnFailure/);
  assert.match(prompt, /2d6/);
});

test("buildDmSystemPrompt still builds when no character block is supplied", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.equal(typeof prompt, "string");
  assert.doesNotMatch(prompt, /WHO IS AT YOUR TABLE/);
});

// ── the prompt has to teach the rules it enforces ────────────────────────

test("buildDmSystemPrompt teaches the one-attack-per-combatant-per-turn rule it already enforces", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /one attack roll/i);
  assert.match(prompt, /one DM turn is one round|next turn/i);
});

test("buildDmSystemPrompt shows the searchable-prop fields and asks the DM to fill them", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /"label"/);
  assert.match(prompt, /"dc"/);
  assert.match(prompt, /"onFound"/);
});

test("buildDmSystemPrompt tells the DM every room needs an exit unless it flags itself sealed", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /sealed/);
  assert.match(prompt, /at least one exit/i);
});

test("buildDmSystemPrompt prints each token's distance from the player and the attacker's reach", () => {
  const args: DmPromptArgs = { ...sampleArgs(), character: sampleCharacter() };
  const space = args.playspace!;
  space.tokens = [
    { id: "pc-kira", assetId: "knight", x: 9, y: 0, kind: "pc" },
    { id: "mon-gob-1", assetId: "goblin", x: 9, y: 6, kind: "monster" },
  ];
  const prompt = buildDmSystemPrompt(args);
  assert.match(prompt, /6 tiles from/i);
  assert.match(prompt, /reach:/);
});

// ── the paid turn's one repair retry must not be wasted ──────────────────

test("validateDmTurn reports EVERY problem in a turn at once, not just the first one it hits", () => {
  // The critic's exact repro: six independent problems, of which the old
  // fail-fast validator reported precisely one, so a model that fixed it
  // walked straight into the next rejection with no retry left.
  const turn = {
    narration: "Chaos everywhere.",
    actions: [
      {
        type: "assembleCell",
        cx: 1,
        cy: 0,
        layout: {
          tiles: blankTiles(),
          props: [{ id: "p1", assetId: "chest", x: 5.5, y: 2 }],
          tokens: [{ id: "t1", assetId: "hero", x: 1, y: 1, kind: "pc" }],
          exits: [{ at: { x: CELL_WIDTH - 1, y: 5 }, edge: "E", toCell: { cx: 2, cy: 0 } }],
        },
      },
      { type: "moveToken", cx: 1, cy: 0, tokenId: "g1", to: { x: 3, y: 3 } },
      { type: "castFireball", cx: 1, cy: 0 },
    ],
    rollRequests: [{ id: "r1", by: "g1", kind: "attack", reason: "swing" }],
  };
  assert.throws(() => validateDmTurn(turn), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /5\.5/, "the fractional prop coordinate must be reported");
    assert.match(err.message, /\.reason/, "the missing moveToken reason must be reported in the SAME message");
    assert.match(err.message, /castFireball/, "the unknown action type must be reported in the SAME message");
    assert.match(err.message, /against/, "the attack roll with no target must be reported in the SAME message");
    return true;
  });
});

test("validateDmTurn still reports a single problem as a single plain message", () => {
  const turn = { narration: "You look around.", actions: [{ type: "castFireball", cx: 0, cy: 0 }] };
  assert.throws(() => validateDmTurn(turn), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /problems with this turn/);
    return true;
  });
});

test("the rejection for citing your own attack roll names the actual fix instead of contradicting itself", () => {
  // turnSchema's old wording said the roll "does not concern mon-gob-2" in
  // the same clause that said mon-gob-2 rolled it, which is the one rejection
  // in a 14-turn run a model could not have recovered from.
  const turn = {
    narration: "The goblin staggers back from its own swing.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "mon-gob-2", to: { x: 8, y: 8 }, reason: "combat", resolvedRollId: "roll-gob2-a" }],
  };
  assert.throws(
    () => validateDmTurn(turn, { resolvedRolls: [attackRoll("roll-gob2-a", "mon-gob-2", "pc-kira", true)] }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /own attack/i);
      assert.match(err.message, /never for the attacker|only ever decides an outcome for its target/i);
      assert.doesNotMatch(err.message, /does not concern "mon-gob-2"/);
      return true;
    },
  );
});

// ── reach at the turn gate ───────────────────────────────────────────────

function geometry(): CombatGeometry {
  return {
    positions: { "pc-kira": { x: 9, y: 0 }, "mon-gob-1": { x: 9, y: 6 }, "mon-gob-2": { x: 9, y: 1 } },
    visibleTokens: {
      "mon-gob-1": ["mon-gob-1", "pc-kira", "mon-gob-2"],
      "mon-gob-2": ["mon-gob-2", "pc-kira", "mon-gob-1"],
      "pc-kira": ["pc-kira", "mon-gob-1", "mon-gob-2"],
    },
  };
}

test("validateDmTurn rejects a melee attack rollRequest from six tiles away, naming both positions and the distance", () => {
  const turn = {
    narration: "The goblin lunges from across the room.",
    actions: [],
    rollRequests: [{ id: "r1", by: "mon-gob-1", against: "pc-kira", kind: "attack", reason: "the goblin swings" }],
  };
  assert.throws(() => validateDmTurn(turn, { geometry: geometry() }), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /\(9,6\)/);
    assert.match(err.message, /\(9,0\)/);
    assert.match(err.message, /6 tiles/);
    return true;
  });
});

test("validateDmTurn accepts a melee attack from an adjacent tile", () => {
  const turn = {
    narration: "The second goblin is right on top of you.",
    actions: [],
    rollRequests: [{ id: "r1", by: "mon-gob-2", against: "pc-kira", kind: "attack", reason: "the goblin swings" }],
  };
  const result = validateDmTurn(turn, { geometry: geometry() });
  assert.equal(result.rollRequests?.length, 1);
});

test("validateDmTurn accepts the same six-tile attack when it declares itself ranged", () => {
  const turn = {
    narration: "The goblin looses an arrow down the hall.",
    actions: [],
    rollRequests: [{ id: "r1", by: "mon-gob-1", against: "pc-kira", kind: "attack", range: "ranged", reason: "the goblin shoots" }],
  };
  const result = validateDmTurn(turn, { geometry: geometry() });
  assert.equal(result.rollRequests?.length, 1);
});

test("validateDmTurn rejects a ranged attack through a wall, because line of sight is part of the same check", () => {
  const blind: CombatGeometry = {
    positions: { "pc-kira": { x: 4, y: 7 }, "mon-gob-1": { x: 15, y: 7 } },
    visibleTokens: { "mon-gob-1": ["mon-gob-1"], "pc-kira": ["pc-kira"] },
  };
  const turn = {
    narration: "The goblin fires through the wall somehow.",
    actions: [],
    rollRequests: [{ id: "r1", by: "mon-gob-1", against: "pc-kira", kind: "attack", range: "ranged", reason: "shoots" }],
  };
  assert.throws(() => validateDmTurn(turn, { geometry: blind }), /line of sight/i);
});

test("validateDmTurn does not check reach at all when the caller supplies no geometry", () => {
  const turn = {
    narration: "The goblin lunges from across the room.",
    actions: [],
    rollRequests: [{ id: "r1", by: "mon-gob-1", against: "pc-kira", kind: "attack", reason: "the goblin swings" }],
  };
  assert.equal(validateDmTurn(turn).rollRequests?.length, 1);
});

// ── the gate ABOVE reach: was there anybody swinging at all ──────────────
//
// `checkAttackReach` fails open when it has no position for one of the two
// tokens, deliberately (see its doc comment, and world/reach.ts's own test for
// that fail-open) -- and the play loop inherited that fail-open without ever
// asking whether the attacker existed. One Talk turn carrying twenty attack
// rollRequests whose "by" ids were "nobody-0" through "nobody-19" validated
// clean with zero retries: no token had any of those ids, so every reach check
// fell through the fail-open, the engine resolved twenty swings at the
// fallback modifier, and a level-2 character went from 12/12 to dead in a
// single turn the player had paid one credit for.

test("validateDmTurn rejects an attack rolled by a token that is not in the playspace at all", () => {
  const turn = {
    narration: "Something swings at you out of the dark.",
    actions: [],
    rollRequests: [{ id: "r1", by: "nobody-0", against: "pc-kira", kind: "attack", reason: "it swings" }],
  };
  assert.throws(() => validateDmTurn(turn, { geometry: geometry() }), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /nobody-0/);
    assert.match(err.message, /no token with that id/i);
    assert.match(err.message, /placeToken/);
    return true;
  });
});

test("one paid turn cannot carry twenty attacks from twenty invented attackers", () => {
  const rollRequests = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    by: `nobody-${i}`,
    against: "pc-kira",
    kind: "attack",
    reason: "it swings",
  }));
  const turn = { narration: "The dark comes apart into hands.", actions: [], rollRequests };
  assert.throws(() => validateDmTurn(turn, { geometry: geometry() }), /at most 8/);
});

test("the per-turn rollRequests cap holds even with no geometry, so a missing board cannot switch it off", () => {
  const rollRequests = Array.from({ length: 60 }, (_, i) => ({
    id: `r${i}`,
    by: `ghost-${i}`,
    against: "pc-kira",
    kind: "attack",
    reason: "it swings",
  }));
  assert.throws(() => validateDmTurn({ narration: "All of it.", actions: [], rollRequests }), /at most 8/);
});

test("no turn may carry more attack rolls than there are creatures standing in the playspace", () => {
  // geometry() holds exactly three tokens, and each of them may spend one
  // action per turn (requireActionEconomyForAttack), so a fourth attacker in
  // the same turn is either a repeat of somebody who already swung or somebody
  // who does not exist. Both are rejected, which is what makes "one attack per
  // creature present" a property of the turn rather than a hope.
  const rollRequests = [
    { id: "r1", by: "mon-gob-2", against: "pc-kira", kind: "attack", reason: "swings" },
    { id: "r2", by: "pc-kira", against: "mon-gob-2", kind: "attack", reason: "swings back" },
    { id: "r3", by: "mon-gob-1", against: "pc-kira", kind: "attack", range: "ranged", reason: "shoots" },
    { id: "r4", by: "mon-gob-4", against: "pc-kira", kind: "attack", reason: "swings" },
  ];
  assert.throws(
    () => validateDmTurn({ narration: "All of it at once.", actions: [], rollRequests }, { geometry: geometry() }),
    /mon-gob-4/,
  );

  // The other half of the same property: the fourth attacker cannot be one of
  // the three swinging twice either, so between the two gates the number of
  // attacks in a turn can never exceed the number of creatures on the board.
  const repeat = [...rollRequests.slice(0, 3), { ...rollRequests[0]!, id: "r4" }];
  assert.throws(
    () => validateDmTurn({ narration: "Again, somehow.", actions: [], rollRequests: repeat }, { geometry: geometry() }),
    /already spent their action/,
  );
});

test("a ghost attacker cannot borrow a name JavaScript hands out for free", () => {
  // `by` is a model-supplied string indexed straight into a plain object, so
  // "toString" and "constructor" resolve to Object.prototype's own members and
  // would read as tokens that exist under a bare truthiness check.
  for (const name of ["toString", "constructor", "hasOwnProperty"]) {
    const turn = {
      narration: "Something swings at you out of the dark.",
      actions: [],
      rollRequests: [{ id: "r1", by: name, against: "pc-kira", kind: "attack", reason: "it swings" }],
    };
    assert.throws(() => validateDmTurn(turn, { geometry: geometry() }), /no token with that id/i, `"${name}" must not read as a token`);
  }
});

test("the on-board gate lives in the turn validator, not in world/reach.ts, whose fail-open stays deliberate", () => {
  // The pure geometry helper has no idea who is paying for the turn, so a
  // missing position genuinely leaves it no fact to reject on. The play loop
  // does know, which is why the refusal belongs there and only there.
  assert.equal(checkAttackReach(geometry(), "nobody-0", "pc-kira", "melee").ok, true);
});

// ── a requested roll has no answer yet ───────────────────────────────────
//
// Two blind table judges independently named the same passage as the proof of
// machine authorship: the DM narrated what an Insight check found and THEN
// printed the roll. The wire format was already right (there is nowhere in the
// schema for an outcome to originate) -- what failed was the prose, which
// answered the question before asking it and so made the enforced gap
// invisible. Most of that is a prompt rule, because judging whether a sentence
// foreshadows a roll's content is exactly the narration-content analysis this
// file distrusts. The half that IS cheaply checkable is second person: a turn
// that tells the player what they realise, can tell, or are certain of while a
// roll is still pending.

test("validateDmTurn rejects narration that tells the player what they work out while the roll deciding it is still pending", () => {
  const turn = {
    narration: "She answers a different question than the one you asked. You get it before she answers: she is under orders.",
    actions: [],
    rollRequests: [{ id: "r1", by: "pc-kira", kind: "check", skill: "Insight", dc: 13, reason: "reading Mera" }],
  };
  assert.throws(() => validateDmTurn(turn), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /you get it/i);
    assert.match(err.message, /instant of the attempt/i);
    return true;
  });
});

test("the same turn validates once the narration stops at the evidence and leaves the conclusion to the player", () => {
  const turn = {
    narration: "She answers a different question than the one you asked, and her hands do not stop moving on the table.",
    actions: [],
    rollRequests: [{ id: "r1", by: "pc-kira", kind: "check", skill: "Insight", dc: 13, reason: "reading Mera" }],
  };
  assert.equal(validateDmTurn(turn).rollRequests?.length, 1);
});

test("narrating the consequence of an ALREADY resolved roll is untouched, even in a turn that asks for a new one", () => {
  // Past tense is how a turn narrates what the engine already decided, which
  // the protocol requires; the tripwire is present tense with a roll still
  // pending. If this ever starts throwing, the check has grown from a fixed
  // phrase list into a grader of prose, which is the thing it must not become.
  const turn = {
    narration: "You realized halfway down the stair that the salt smell was wrong, and you failed to say so in time. The door ahead is shut.",
    actions: [],
    rollRequests: [{ id: "r2", by: "pc-kira", kind: "check", skill: "Perception", dc: 12, reason: "listening at the door" }],
  };
  assert.equal(validateDmTurn(turn).rollRequests?.length, 1);
});

test("the pending-roll check is scoped to turns that actually request a roll, so it never second-guesses plain narration", () => {
  // Narrating the player's own mind is forbidden by the prompt everywhere, but
  // the VALIDATOR only speaks up where there is an independent fact to check
  // against: a roll this same turn declared unresolved. Anywhere else this
  // would be the validator grading prose, which this file does not do.
  const turn = { narration: "You realize the door was never locked at all.", actions: [] };
  assert.ok(validateDmTurn(turn).narration.length > 0);
});

// ── memoryFacts: let the already-paid turn type its own campaign facts ───
//
// Tier 3 is DESIGN.md's source of truth, and a prose heuristic structurally
// cannot know that a promise is outstanding or that an NPC is dead: every
// fact the old extractor could produce was hardcoded category "event" and
// status "noted (heuristic, unverified)". The only thing in the system that
// knows is the model that just wrote the scene, and it was never asked.

test("validateDmTurn accepts an optional memoryFacts array and normalises it to the tier-3 fact shape", () => {
  const turn = {
    narration: "Maren makes you swear it, on the new moon.",
    actions: [],
    memoryFacts: [
      { category: "promise", key: "maren-new-moon", fact: "The party swore to return the chart before the new moon.", status: "outstanding, due the new moon" },
      { category: "npc", key: "maren-hollowell", fact: { role: "herbalist", disposition: "trusting" }, status: "alive, in the village" },
    ],
  };
  const result = validateDmTurn(turn);
  assert.equal(result.memoryFacts?.length, 2);
  assert.equal(result.memoryFacts![0]!.category, "promise");
  assert.equal(result.memoryFacts![0]!.status, "outstanding, due the new moon");
  // A bare string is normalised into the same Record shape tier 3 stores.
  assert.deepEqual(result.memoryFacts![0]!.fact, { text: "The party swore to return the chart before the new moon." });
  assert.equal(result.memoryFacts![1]!.fact.role, "herbalist");
});

test("validateDmTurn rejects a memoryFact whose category is outside the closed tier-3 union", () => {
  const turn = {
    narration: "Something happened.",
    actions: [],
    memoryFacts: [{ category: "weather", key: "storm", fact: "it rained", status: "ongoing" }],
  };
  assert.throws(() => validateDmTurn(turn), /npc.*promise.*item.*event.*thread/s);
});

test("validateDmTurn caps how many memoryFacts one turn can assert, so the field cannot balloon the turn", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ category: "event", key: `k${i}`, fact: "a thing", status: "done" }));
  const turn = { narration: "A lot happened.", actions: [], memoryFacts: many };
  assert.throws(() => validateDmTurn(turn), /memoryFacts/);
});

test("a turn that omits memoryFacts entirely still validates -- the heuristic extractor stays the fallback", () => {
  const result = validateDmTurn({ narration: "Quiet night.", actions: [] });
  assert.equal(result.memoryFacts, undefined);
});

test("buildDmSystemPrompt asks for memoryFacts in the reply shape and shows a worked example", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /memoryFacts/);
  assert.match(prompt, /npc\|promise\|item\|event\|thread|"promise"/);
});

// ── the round trip: a turn hand-authored against the NEW prompt has to
// survive the real validator AND the real world engine, or the prompt edit
// is just words.

test("a fog-crossing turn hand-authored against the new prompt validates and assembles cleanly, staked opening and all", () => {
  const manifest: AssetManifest = {
    tiles: { floor: { walkable: true }, wall: { walkable: false } },
    tokens: { knight: {}, goblin: {} },
    props: { chest: {} },
  };

  // (0,0) is already built with an east exit at (19,6), so (1,0) owes a west
  // opening at (0,6) -- exactly the situation the new prompt now spells out.
  const start = {
    tiles: blankTiles().map((row, y) => row.map((_, x) => (x === 0 || x === CELL_WIDTH - 1 || y === 0 || y === CELL_HEIGHT - 1 ? "wall" : "floor"))),
    props: [],
    tokens: [],
    exits: [{ at: { x: CELL_WIDTH - 1, y: 6 }, edge: "E" as const, toCell: { cx: 1, cy: 0 } }],
  };
  start.tiles[6]![CELL_WIDTH - 1] = "floor";
  const built = assembleCell(emptyWorld(), 0, 0, start, manifest);
  assert.equal(built.ok, true, built.ok ? "" : built.errors.join("; "));
  if (!built.ok) return;

  // Hand-authored reply: the DM reads "E: not built yet (cell (1,0)) ... your
  // W edge MUST be walkable at (0,6)" off the prompt and builds the neighbour
  // with that opening, rather than the cell the party is standing in.
  const tiles = blankTiles().map((row, y) =>
    row.map((_, x) => (x === 0 || x === CELL_WIDTH - 1 || y === 0 || y === CELL_HEIGHT - 1 ? "wall" : "floor")),
  );
  tiles[6]![0] = "floor";
  const reply = {
    narration: "The lane opens into a low hall of salt-scarred stone. Something has been living in here.",
    actions: [
      {
        type: "assembleCell",
        cx: 1,
        cy: 0,
        layout: {
          tiles,
          props: [{ id: "chest-1", assetId: "chest", x: 15, y: 3, label: "the water-swollen chest", dc: 13, onFound: "Under the ruined cloth: a bone whistle, still dry." }],
          tokens: [{ id: "mon-gob-1", assetId: "goblin", x: 12, y: 8, kind: "monster" }],
          exits: [{ at: { x: 0, y: 6 }, edge: "W", toCell: { cx: 0, cy: 0 } }],
        },
      },
    ],
    memoryFacts: [{ category: "item", key: "bone-whistle", fact: "A bone whistle is hidden in the salt hall's chest.", status: "unfound, DC 13" }],
    menuHint: ["Move", "Search", "Attack"],
  };

  const turn = validateDmTurn(reply);
  assert.equal(turn.actions.length, 1);
  const action = turn.actions[0]!;
  assert.equal(action.type, "assembleCell");
  if (action.type !== "assembleCell") return;
  const assembled = assembleCell(built.world, action.cx, action.cy, action.layout, manifest);
  assert.equal(assembled.ok, true, assembled.ok ? "" : assembled.errors.join("; "));
  if (!assembled.ok) return;
  const stored = assembled.world.cells.get("1,0")!;
  assert.equal(stored.props[0]!.dc, 13);
  assert.equal(stored.exits.length, 1);
});

test("a combat turn hand-authored against the new prompt closes the distance instead of swinging from six tiles away, and validates", () => {
  // The prompt now prints "6 tiles from Kira" on the goblin's own line and
  // states the reach rule beside the roll shapes. This is the turn a model
  // reading that writes: step in this round, swing next round. It has to
  // validate, or the rule is unplayable rather than merely enforced.
  const turn = validateDmTurn(
    {
      narration: "The goblin breaks cover and crosses the floor at you, close enough now that you can hear it breathing.",
      actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "mon-gob-1", to: { x: 9, y: 1 }, reason: "staging" }],
      rollRequests: [],
      menuHint: ["Attack", "Move"],
    },
    { geometry: geometry() },
  );
  assert.equal(turn.actions.length, 1);
  assert.equal(turn.rollRequests?.length, 0);
});

// ── the dev mock: anyone outside the ConjureOS shell plays THIS ──────────
//
// bridge/ai.ts's mock took the FIRST "cell (X,Y)" in the prompt, which on a
// fog turn is "Current playspace: cell (0,0)" -- the cell the party is
// standing in, because the DM turn is issued before the party moves. So
// pressing E into unbuilt fog produced assembleCell (0,0), rejected with
// "already assembled", and the new room never appeared. 100% reproducible,
// which is how a critic hit it three times in a row.

/** The mock reads `window.__conjureos`; under node there is no window at all, and its absence is exactly what routes complete() to the mock. */
function ensureWindow(): void {
  if ((globalThis as { window?: unknown }).window === undefined) (globalThis as { window?: unknown }).window = {};
}

/** A prompt shaped exactly like the one requestDmTurn sends on a fog crossing: the party is standing in a BUILT cell (0,0). */
function fogPrompt(): string {
  return buildDmSystemPrompt({
    ...sampleArgs(),
    playspace: samplePlayspace(),
    currentCell: { cx: 0, cy: 0 },
    availableAssetIds: {
      tiles: ["floor_grass", "wall_stone"],
      tokens: ["token_goblin"],
      props: ["chest"],
    },
  });
}

test("the dev mock assembles the NEIGHBOUR the player stepped into, not the cell they are standing in", async () => {
  ensureWindow();
  const reply = await complete({ system: fogPrompt(), messages: [{ role: "user", content: describeMoveIntoFog("E") }] });
  const turn = validateDmTurn(parseLoose(reply));
  const action = turn.actions[0]!;
  assert.equal(action.type, "assembleCell");
  if (action.type !== "assembleCell") return;
  assert.equal(action.cx, 1, "east of (0,0) is (1,0)");
  assert.equal(action.cy, 0);
});

test("the dev mock applies the engine's own N=cy-1 convention when the player steps north", async () => {
  ensureWindow();
  const reply = await complete({ system: fogPrompt(), messages: [{ role: "user", content: describeMoveIntoFog("N") }] });
  const turn = validateDmTurn(parseLoose(reply));
  const action = turn.actions[0]!;
  assert.equal(action.type, "assembleCell");
  if (action.type !== "assembleCell") return;
  assert.deepEqual({ cx: action.cx, cy: action.cy }, { cx: 0, cy: -1 });
});

test("the dev mock still assembles the current cell on the campaign's opening turn, when there is no neighbour to step into", async () => {
  ensureWindow();
  const opening = buildDmSystemPrompt({ ...sampleArgs(), playspace: undefined, currentCell: { cx: 0, cy: 0 } });
  const reply = await complete({ system: opening, messages: [{ role: "user", content: BEGIN_CAMPAIGN_MESSAGE }] });
  const turn = validateDmTurn(parseLoose(reply));
  const action = turn.actions[0]!;
  assert.equal(action.type, "assembleCell");
  if (action.type !== "assembleCell") return;
  assert.deepEqual({ cx: action.cx, cy: action.cy }, { cx: 0, cy: 0 });
});

test("the dev mock varies the room it builds by direction, so three crossings do not stack three identical paragraphs", async () => {
  ensureWindow();
  const east = await complete({ system: fogPrompt(), messages: [{ role: "user", content: describeMoveIntoFog("E") }] });
  const south = await complete({ system: fogPrompt(), messages: [{ role: "user", content: describeMoveIntoFog("S") }] });
  const eastTurn = validateDmTurn(parseLoose(east));
  const southTurn = validateDmTurn(parseLoose(south));
  assert.notEqual(eastTurn.narration, southTurn.narration);
});

test("the dev mock exercises the dice surface: a Talk turn can come back with a real rollRequest", async () => {
  ensureWindow();
  const prompt = fogPrompt();
  const replies = await Promise.all(
    ["Ask the goblin what it wants.", "Tell them you mean no harm.", "Ask about the shrine."].map((content) =>
      complete({ system: prompt, messages: [{ role: "user", content }] }),
    ),
  );
  const turns = replies.map((r) => validateDmTurn(parseLoose(r)));
  assert.ok(
    turns.some((t) => (t.rollRequests?.length ?? 0) > 0),
    "at least one Talk turn must request a roll, or the Dice panel is dead for an entire dev session",
  );
  // And the replies are not the same two fixed strings over and over.
  assert.ok(new Set(turns.map((t) => t.narration)).size > 1);
});

// ── the prompt has to SHOW what the engine now tracks ─────────────────────
//
// Persisting a wounded monster's hit points on the token is only half the
// point. The perception API is how the DM learns anything about the board, so
// an HP the prompt never renders is an HP the DM still cannot react to, which
// is why it could never have a hurt monster flee.

test("buildDmSystemPrompt shows a wounded token's remaining hit points", () => {
  const args = sampleArgs();
  args.playspace = {
    ...samplePlayspace(),
    tokens: [
      { id: "pc-kira", assetId: "knight", x: 2, y: 2, kind: "pc" },
      { id: "goblin-1", assetId: "goblin", x: 3, y: 2, kind: "monster", currentHp: 2 },
    ],
  };
  const prompt = buildDmSystemPrompt(args);
  assert.match(prompt, /id=goblin-1 asset=goblin kind=monster at \(3,2\) hp=2/);
});

test("buildDmSystemPrompt omits the hp segment entirely for an undamaged token", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /id=pc-kira asset=knight kind=pc at \(2,2\) --/);
  assert.doesNotMatch(prompt, /hp=/);
});

// ── the tile conventions the enlarged roster needs to be usable ───────────
//
// The model receives every new id automatically via availableAssetIds and has
// no idea what any of them are for. Untaught, it keeps building rooms out of
// the four ids it already knew, and the wall-height read and the neutral NPC
// tokens sit unused in the manifest.
//
// Two of the conventions this used to pin are gone, and the assertions moved
// with them rather than being softened. The prompt used to name shore_n and
// friends as tiles to lay by hand: those eight ids are DELETED from the
// fantasy roster, and availableAssetIds is a hard gate, so the old instruction
// now teaches the model to get its own action rejected. It also used to ask
// for a hand-scattered decal on one tile in ten, which the renderer's variant
// pass now does per coordinate, so following both puts a decal on roughly one
// cell in four and the floor reads as static. The two tests below are the
// replacements: what the prompt must teach, and what it must never name again.

test("buildDmSystemPrompt teaches the three-part wall run, base-id flooring and the NPC tokens, per template", () => {
  const fantasy = buildDmSystemPrompt(sampleArgs());
  assert.match(fantasy, /wall_stone_top/);
  assert.match(fantasy, /wall_stone_base/);
  assert.match(fantasy, /FLOOR WITH THE BASE ID/);
  assert.match(fantasy, /MATERIALS MEET BY THEMSELVES/);
  assert.match(fantasy, /token_villager/);
  assert.match(fantasy, /token_robed_figure/);
  assert.match(fantasy, /token_guard/);

  const scifi = buildDmSystemPrompt({ ...sampleArgs(), template: "scifi" });
  assert.match(scifi, /wall_bulkhead_top/);
  assert.match(scifi, /wall_bulkhead_base/);
  assert.match(scifi, /floor_deckplate/);
  assert.match(scifi, /MATERIALS MEET BY THEMSELVES/);
  assert.match(scifi, /token_technician/);
  assert.match(scifi, /token_officer/);
  assert.doesNotMatch(scifi, /wall_stone/);
});

test("buildDmSystemPrompt never names an id the template does not ship", () => {
  // The gate is hard: `availableAssetIds` rejects any action naming an id the
  // manifest does not list, so a prompt that teaches a deleted id teaches the
  // model to fail. This walks every underscore-bearing token in the prompt and
  // checks it against the REAL roster, which is what would have caught the
  // shore_* instruction outliving the shore_* tiles.
  const rosters: Array<[template: "fantasy" | "scifi", sprites: readonly { assetId: string }[]]> = [
    ["fantasy", FANTASY_SPRITES],
    ["scifi", SCIFI_SPRITES],
  ];
  for (const [template, sprites] of rosters) {
    const prompt = buildDmSystemPrompt({ ...sampleArgs(), template });
    const ids = new Set(sprites.map((s) => s.assetId));
    // Anything shaped like an asset id: a lowercase word with an underscore in
    // it. Prose in this prompt is written without them, and the few code-ish
    // words that are not assets are listed once here rather than loosened into
    // a pattern.
    const notAssets = new Set(["availableAssetIds", "_top", "_base"]);
    const mentioned = (prompt.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []).filter((w) => !notAssets.has(w));
    const suffixed = new Set(mentioned.map((w) => w.replace(/^(wall_stone|wall_bulkhead)$/, "$1")));
    const unknown = [...suffixed].filter((w) => !ids.has(w) && !ids.has(`${w}_top`));
    assert.deepEqual(unknown, [], `${template} prompt names ids the template does not ship: ${unknown.join(", ")}`);
  }
});

test("a prompt built from the adapted real fantasy roster names no render-only wall-profile id", () => {
  // The wall-profile sprites (the joins, the jamb overlay, the side-on door
  // leaves) are the renderer's. adaptManifest keeps them out of
  // `availableAssetIds`, and this is the property that matters to the model:
  // built from the roster the game really ships, the prompt never offers one.
  const adapted = adaptManifest({ template: "fantasy", palette: FANTASY_PALETTE, assets: FANTASY_SPRITES as never });
  const prompt = buildDmSystemPrompt({ ...sampleArgs(), availableAssetIds: adapted.availableAssetIds });

  const named = [...RENDER_ONLY_ASSET_IDS].filter((id) => prompt.includes(id));
  assert.deepEqual(named, [], `the prompt offers render-only ids: ${named.join(", ")}`);

  // Not vacuous: the roster it was built from does carry them, and the ordinary
  // wall and door ids around them are still offered.
  const shipped = new Set(FANTASY_SPRITES.map((s) => s.assetId));
  assert.ok([...RENDER_ONLY_ASSET_IDS].every((id) => shipped.has(id)), "the fantasy roster ships the profile art");
  for (const id of ["wall_stone", "wall_stone_top", "wall_stone_base", "door_closed", "door_open"]) {
    assert.ok(prompt.includes(id), `${id} is still offered`);
  }
  assert.ok(adapted.availableAssetIds.tiles.every((id) => !RENDER_ONLY_ASSET_IDS.has(id)));
  assert.ok(adapted.availableAssetIds.props.every((id) => !RENDER_ONLY_ASSET_IDS.has(id)));
});

// ── the voice rules: what two blind table judges said would end the run ───
//
// Both judges, reading only a session log, named the same three habits: a DM
// that empties the plot at the first good guess, narrates the player's own
// deductions back at them as exposition, and hangs a judgment off the end of
// every paragraph ("which is the first thing wrong with it", four times in
// eight turns). All three are prompt-level: the prose itself was praised, so
// this is a cadence and disclosure constraint, not a rewrite.

test("buildDmSystemPrompt tells the DM to withhold, and prices a correct guess at one piece rather than the whole file", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /WITHHOLD/);
  assert.match(prompt, /one piece/i);
  assert.match(prompt, /out of their mouth/i);
});

test("buildDmSystemPrompt forbids narrating the player's own conclusions, and forbids reviewing its own detail", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /NEVER NARRATE THE PLAYER'S OWN MIND/);
  assert.match(prompt, /DO NOT REVIEW YOUR OWN SCENE/);
});

test("buildDmSystemPrompt names the trailing-appositive tic and asks for varied paragraph endings", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /VARY HOW YOUR PARAGRAPHS END/);
  assert.match(prompt, /which is|which means/);
});

test("buildDmSystemPrompt stops the DM narrating past the instant of an attempt it is asking for a roll on", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /instant of the attempt/i);
});

// ── what the validator enforces, the prompt has to teach ─────────────────
//
// The discipline this file already applies to resolvedRolls and to reach: a
// rule the model is held to but never shown is a rule that only ever shows up
// as a rejection the player paid for.

test("buildDmSystemPrompt teaches that an attacker has to be a token standing on the board, and caps rolls per turn", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /actually standing in the playspace|standing in the playspace/i);
  assert.match(prompt, /at most 8 rollRequests|8 rollRequests/i);
});

test("buildDmSystemPrompt tells the DM the player's own token is not theirs to move", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /NOT YOURS TO MOVE/i);
  assert.match(prompt, /they walk themselves|let them take the step/i);
});

// ── contract v2: the model is locked out of gear, tiers, loot and attunement ─
//
// equipmentTypes.ts section 11.7, "THE MODEL IS LOCKED OUT": the eleven keys
// EQUIPMENT_FORBIDDEN_WIRE_KEYS grew by are rejected, not ignored, at every
// site listed there -- the turn root, every world action, every assembleCell
// layout, every placed prop, every placed token (already covered by v1's
// gear_ prefix tests) and every roll request (already covered above by the
// targetAC tests, which share the same rejectEquipmentKeys call). What was
// missing before this change: rejectEquipmentKeys was only ever called from
// validatePlacedToken and validateRollRequest, so a forbidden key sitting
// directly on the turn root, on a world action, on an assembleCell layout or
// on a placed prop sailed straight through unrejected. Each test below names
// one of those four previously-open sites.

test("validateDmTurn rejects a forbidden equipment key carried on the turn root itself", () => {
  const turn = { narration: "The room is quiet.", actions: [], loot: { slot: "ring", tier: "rare" } };
  assert.throws(() => validateDmTurn(turn), /"loot"/);
  assert.throws(() => validateDmTurn(turn), /engine's/);
});

test("validateDmTurn rejects a forbidden equipment key carried directly on a world action, not just inside its prop or token", () => {
  const turn = {
    narration: "The merchant steps aside.",
    actions: [{ type: "moveToken", cx: 0, cy: 0, tokenId: "goblin-1", to: { x: 1, y: 1 }, reason: "staging", bag: [] }],
  };
  assert.throws(() => validateDmTurn(turn), /"bag"/);
});

test("validateDmTurn rejects a forbidden equipment key carried on an assembleCell layout itself", () => {
  const layout = { tiles: blankTiles(), props: [], tokens: [], exits: [], attunement: 3 };
  const turn = { narration: "A new room opens.", actions: [{ type: "assembleCell", cx: 1, cy: 0, layout }] };
  assert.throws(() => validateDmTurn(turn), /"attunement"/);
});

test("validateDmTurn rejects a forbidden equipment key carried on a placed prop", () => {
  const turn = {
    narration: "A chest sits in the corner.",
    actions: [{ type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, charges: 3 } }],
  };
  assert.throws(() => validateDmTurn(turn), /"charges"/);
});

test("validateDmTurn rejects a forbidden equipment key carried on a prop nested inside an assembleCell layout, not only a standalone placeProp", () => {
  // rejectEquipmentKeys on the layout itself checks keys sitting directly on
  // the layout object; a key hiding one level down, on one of the layout's
  // OWN props, needs validatePlacedProp's own call to catch it. Two different
  // objects, two different call sites, both required.
  const layout = {
    tiles: blankTiles(),
    props: [{ id: "p1", assetId: "chest", x: 2, y: 2, grantsGear: true }],
    tokens: [],
    exits: [],
  };
  const turn = { narration: "A new room opens.", actions: [{ type: "assembleCell", cx: 1, cy: 0, layout }] };
  assert.throws(() => validateDmTurn(turn), /"grantsGear"/);
});

test("validateDmTurn rejects a forbidden equipment key carried on a layout's exit, not only its props and tokens", () => {
  // Found by the integrator's lockout probe: an exit is rebuilt from explicit
  // literals, so a "loot" on it was silently DROPPED rather than rejected,
  // the one layout child still ignoring the list instead of refusing it.
  const layout = {
    tiles: blankTiles(),
    props: [],
    tokens: [],
    exits: [{ at: { x: 0, y: 5 }, edge: "W", toCell: { cx: 0, cy: 0 }, loot: { slot: "ring", tier: "legendary" } }],
  };
  const turn = { narration: "A new room opens.", actions: [{ type: "assembleCell", cx: 1, cy: 0, layout }] };
  assert.throws(() => validateDmTurn(turn), /"loot"/);
});

// A prop's `grantsItem` is a legitimate field (unlike the eleven keys above,
// it is policed by VALUE, not rejected outright) -- equipmentTypes.ts section
// 11.7 point 2: a magic gear name in it is rejected, an ordinary name is not.
// This is the "what a DM-authored grantsItem equal to a gear name does"
// decision this lane owns: it never becomes typed gear, full stop, because
// validatePlacedProp refuses to let the prop exist at all.

test("validateDmTurn rejects a placeProp whose grantsItem names a magic gear item", () => {
  const turn = {
    narration: "The chest creaks open.",
    actions: [
      { type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "Ring of Protection" } },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /grantsItem/);
  assert.throws(() => validateDmTurn(turn), /magic item/i);
  assert.throws(() => validateDmTurn(turn), /engine's loot roll/i);
});

test("validateDmTurn rejects a magic grantsItem case- and whitespace-insensitively, matching isMagicGearName's own rule", () => {
  const turn = {
    narration: "The chest creaks open.",
    actions: [
      { type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "  ring OF protection  " } },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /magic item/i);
});

test("validateDmTurn accepts a placeProp whose grantsItem names an ordinary, non-magic thing", () => {
  const turn = {
    narration: "The chest creaks open.",
    actions: [
      { type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "a coil of rope" } },
    ],
  };
  const result = validateDmTurn(turn);
  const action = result.actions[0]!;
  assert.equal(action.type, "placeProp");
  if (action.type === "placeProp") assert.equal(action.prop.grantsItem, "a coil of rope");
});

test("validateDmTurn accepts a placeProp whose grantsItem names a COMMON gear piece, since only the magic tiers are policed", () => {
  // "Longsword" is the Knight's common-tier weapon name (BONUS_BY_TIER common
  // = +0, no glow, not a magic item by this contract's own definition), so a
  // DM handing one over as ordinary flavour is legal even though the string
  // looks gear-shaped. isMagicGearName only lists the uncommon/rare/legendary
  // names (equipmentTypes.ts MAGIC_GEAR_NAMES slices off index 0, "common").
  const turn = {
    narration: "A dead guard's kit lies here.",
    actions: [
      { type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "Longsword" } },
    ],
  };
  const result = validateDmTurn(turn);
  const action = result.actions[0]!;
  assert.equal(action.type, "placeProp");
  if (action.type === "placeProp") assert.equal(action.prop.grantsItem, "Longsword");
});

// DM-lane close-out finding ("grantsItem magic-name lockout is exact-match
// only"): `isMagicGearName` matches only an EXACT name after trim/whitespace
// collapse/case fold, so every one of the ordinary ways a DM sentence wraps a
// name around itself -- an article, a "+1", a trailing plural, a
// parenthetical, a period -- passed straight through untouched. Separately,
// `label` and `onFound` were never checked against magic gear names at all,
// so a prop could announce the exact item sitting inside it before the
// engine's own loot roll ever ran. Each test below reproduces one of the
// probe's accepted variants and asserts it is now rejected.

test("validateDmTurn rejects a grantsItem that only WRAPS a magic gear name in an article", () => {
  const turn = {
    narration: "The chest creaks open.",
    actions: [
      { type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "a Ring of Protection" } },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /magic item/i);
});

test("validateDmTurn rejects a grantsItem with a trailing '+1' still stuck to a magic gear name", () => {
  const turn = {
    narration: "The chest creaks open.",
    actions: [
      { type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "Keen Longsword +1" } },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /magic item/i);
});

test("validateDmTurn rejects a pluralised magic gear name in grantsItem", () => {
  const turn = {
    narration: "The chest creaks open.",
    actions: [
      { type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "Keen Longswords" } },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /magic item/i);
});

test("validateDmTurn rejects a magic gear name in grantsItem trailed by a parenthetical or punctuation", () => {
  const parenthetical = {
    narration: "The chest creaks open.",
    actions: [{ type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "Dawnbreaker (worn)" } }],
  };
  const punctuated = {
    narration: "The chest creaks open.",
    actions: [{ type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "Dawnbreaker." } }],
  };
  assert.throws(() => validateDmTurn(parenthetical), /magic item/i);
  assert.throws(() => validateDmTurn(punctuated), /magic item/i);
});

test("validateDmTurn rejects a grantsItem naming the one magic item whose own name carries a parenthetical", () => {
  // "Stone of Good Luck (Luckstone)" ends in a non-word character, so a plain
  // `\b`-based boundary would never match its own trailing edge; this is the
  // regression for that specific edge case, wrapped the same way as the rest.
  const exact = {
    narration: "The chest creaks open.",
    actions: [{ type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "Stone of Good Luck (Luckstone)" } }],
  };
  const wrapped = {
    narration: "The chest creaks open.",
    actions: [{ type: "placeProp", cx: 0, cy: 0, prop: { id: "p1", assetId: "chest", x: 2, y: 2, grantsItem: "a Stone of Good Luck (Luckstone)" } }],
  };
  assert.throws(() => validateDmTurn(exact), /magic item/i);
  assert.throws(() => validateDmTurn(wrapped), /magic item/i);
});

test("validateDmTurn rejects a prop's label that names a magic gear item, before it is ever searched", () => {
  const turn = {
    narration: "A chest sits in the corner.",
    actions: [
      {
        type: "placeProp",
        cx: 0,
        cy: 0,
        prop: { id: "p1", assetId: "chest", x: 2, y: 2, label: "a chest holding the Ring of Protection" },
      },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /label/);
  assert.throws(() => validateDmTurn(turn), /magic item/i);
});

test("validateDmTurn rejects a prop's onFound that names the magic gear item it reveals", () => {
  const turn = {
    narration: "A chest sits in the corner.",
    actions: [
      {
        type: "placeProp",
        cx: 0,
        cy: 0,
        prop: { id: "p1", assetId: "chest", x: 2, y: 2, onFound: "Beneath the rags lies a Ring of Protection." },
      },
    ],
  };
  assert.throws(() => validateDmTurn(turn), /onFound/);
  assert.throws(() => validateDmTurn(turn), /magic item/i);
});

test("validateDmTurn still accepts a label or onFound that merely coincides with a single-word magic gear name", () => {
  // "Mercy" is a legendary magic item name in this contract, but it is also
  // an ordinary English word; the multi-word-only containment check on
  // label/onFound (unlike grantsItem, which checks every name) must not
  // reject a sentence that just happens to contain it.
  const turn = {
    narration: "A guard cowers here.",
    actions: [
      {
        type: "placeProp",
        cx: 0,
        cy: 0,
        prop: { id: "p1", assetId: "chest", x: 2, y: 2, label: "a guard begging for mercy", onFound: "He whispers his thanks." },
      },
    ],
  };
  const result = validateDmTurn(turn);
  const action = result.actions[0]!;
  assert.equal(action.type, "placeProp");
  if (action.type === "placeProp") {
    assert.equal(action.prop.label, "a guard begging for mercy");
    assert.equal(action.prop.onFound, "He whispers his thanks.");
  }
});

test("buildDmSystemPrompt gains the pinned LOOT IS THE ENGINE'S rule, verbatim", () => {
  const prompt = buildDmSystemPrompt(sampleArgs());
  assert.match(prompt, /LOOT IS THE ENGINE'S/);
  assert.match(prompt, /never give the player a magic item/i);
  assert.match(prompt, /the engine rolls loot and tells you what turned up/i);
  assert.match(prompt, /"grantsItem" on a prop is for ordinary things/i);
});

test("buildDmSystemPrompt renders what the character is wearing, above what they are carrying", () => {
  const prompt = buildDmSystemPrompt({ ...sampleArgs(), character: sampleCharacter() });
  assert.match(prompt, /Wearing: Shortblade, Dark Cloak, Hood, Travel Boots/);
  const wearingIndex = prompt.indexOf("Wearing:");
  const carryingIndex = prompt.indexOf("Carrying:");
  assert.ok(wearingIndex >= 0 && carryingIndex >= 0, "both lines must be present");
  assert.ok(wearingIndex < carryingIndex, "Wearing must print above Carrying");
});

test("buildDmSystemPrompt still builds a WHO IS AT YOUR TABLE block when the character has nothing magical on", () => {
  const prompt = buildDmSystemPrompt({ ...sampleArgs(), character: { ...sampleCharacter(), wearing: [] } });
  assert.match(prompt, /Wearing: \(nothing\)/);
});
