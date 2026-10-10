/**
 * Tests for the command menu's local/DM routing table (DESIGN.md, "Command
 * menu: what needs the model, what doesn't"), the player-facing copy every
 * roll line is built from (menu/labels.ts), the combat round's initiative and
 * action economy (menu/combatRound.ts), the Cast verb (menu/casting.ts), and
 * canvasRenderer's pure layout math (tile/sprite pixel placement, the part of
 * the renderer that doesn't need an actual canvas to verify).
 *
 * Run: npx tsx --test test/livingtable-menu.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMenuAction, normalizeMenuHint, menuHintSentence, COMMAND_VERBS, type MenuContext } from "../src/games/livingtable/menu/commandMenu";
import { ARCHETYPES } from "../src/games/livingtable/characters/templates";
import { createCharacter } from "../src/games/livingtable/characters/creation";
import { BAG_CAPACITY, BONUS_BY_TIER, EQUIPMENT_TIERS, MAX_ATTUNED_ITEMS, MAX_DISTINCT_MAGIC_ITEMS, MAX_TOTAL_AC_BONUS, MAX_TOTAL_SAVE_BONUS, SLOTS_BY_ARCHETYPE, SLOT_ROLES, attunementFullReason, gearItemName, type ArchetypeId, type LootRoll } from "../src/games/livingtable/characters/equipmentTypes";
import { RARITY_WORD, accessoryCopy, armorDisplayLabel, effectiveArmorClass, equipItem, equipmentAttackBonus, equippableTiers, gearView, itemNameAt, packItems, renderPlanFor, renderPlansFor, startingGearNames } from "../src/games/livingtable/menu/equipment";
import { weaponIdentityFor } from "../src/games/livingtable/session/combat";
import { assetNoun, attackLine, bonusSources, checkLine, humanizeEngineError, lootLine, neighbourLine, placeName, propLabel, tokenLabel, explain, stepsAndFeet, GLOSSARY, SRD_ATTRIBUTION, GAME_TAGLINE, CAMPAIGN_PLANNING_SUB, type TokenNamer } from "../src/games/livingtable/menu/labels";
import { attunedRoles, gearChangeBlockedReason } from "../src/games/livingtable/rules/attunement";
import { commitLoadout, draftFromSheet, normalizeBag, stageEquip, stageUnequip } from "../src/games/livingtable/rules/inventory";
import { lootDmNote, lootFor } from "../src/games/livingtable/rules/loot";
import { attackBlockedReason, activeCombatant, dropCombatant, endTurn, isPlayersTurn, spendActiveAction, spendActiveMovement, spendCombatantAction, startCombat, withinMeleeReach, MELEE_REACH_FT } from "../src/games/livingtable/menu/combatRound";
import { castableSpells, cantripNameFor, spellAttackBonus, spellSaveDc, spendSlotFor, spellRangeFt, castBlockedReason, attackWeaponName, attackCaption, SPELL_EFFECTS } from "../src/games/livingtable/menu/casting";
import { createCharacter } from "../src/games/livingtable/characters/creation";
import { CLERIC_SPELLS, WIZARD_SPELLS } from "../src/games/livingtable/rules/spells";
import { DEFAULT_RANGED_REACH_TILES } from "../src/games/livingtable/world/reach";
import { emptyWorld, setCell } from "../src/games/livingtable/world/perception";
import type { CellLayout } from "../src/games/livingtable/world/cell";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world/coordinates";
import { canvasDimensions, spritePixelRect, spritePixelSize, tileOrigin, type SpriteAsset } from "../src/games/livingtable/render/canvasRenderer";

function emptyLayout(): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor"));
  return { tiles, props: [], tokens: [], exits: [] };
}

// ── commandMenu routing table ────────────────────────────────────────────

test("Move within the current playspace is always local", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  const route = resolveMenuAction({ kind: "move", destination: { withinCell: true, to: { x: 5, y: 5 } } }, context);
  assert.deepEqual(route, { kind: "local" });
});

test("Move that steps into an unassembled neighbour is a DM turn", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: "E" } }, context);
  assert.equal(route.kind, "dm");
  if (route.kind === "dm") assert.match(route.reason, /unassembled/);
});

test("Move that steps into an already-assembled neighbour is local, no credit", () => {
  let world = emptyWorld();
  world = setCell(world, { cx: 1, cy: 0 }, emptyLayout()); // the E neighbour of (0,0), already built
  const context: MenuContext = { world, cell: { cx: 0, cy: 0 } };
  const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: "E" } }, context);
  assert.deepEqual(route, { kind: "local" });
});

test("Attack is always local", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  assert.deepEqual(resolveMenuAction({ kind: "attack" }, context), { kind: "local" });
});

test("Search is always local", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  assert.deepEqual(resolveMenuAction({ kind: "search" }, context), { kind: "local" });
});

test("Item is always local", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  assert.deepEqual(resolveMenuAction({ kind: "item" }, context), { kind: "local" });
});

test("Talk is always a DM turn", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  const route = resolveMenuAction({ kind: "talk" }, context);
  assert.equal(route.kind, "dm");
});

test("Free text is always a DM turn", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  const route = resolveMenuAction({ kind: "freeText" }, context);
  assert.equal(route.kind, "dm");
});

// ── canvasRenderer pure layout math ──────────────────────────────────────

test("tileOrigin places a tile at (tile * scale)", () => {
  assert.deepEqual(tileOrigin({ x: 3, y: 4 }, 16), { x: 48, y: 64 });
});

test("tileOrigin at the cell's last tile (boundary case)", () => {
  // The last valid tile is (CELL_WIDTH-1, CELL_HEIGHT-1) = (19,14).
  assert.deepEqual(tileOrigin({ x: CELL_WIDTH - 1, y: CELL_HEIGHT - 1 }, 16), { x: 304, y: 224 });
});

test("tileOrigin at the cell's first tile is the canvas origin", () => {
  assert.deepEqual(tileOrigin({ x: 0, y: 0 }, 16), { x: 0, y: 0 });
});

test("canvasDimensions is the fixed 20x15 grid times the tile scale", () => {
  assert.deepEqual(canvasDimensions(16), { width: 320, height: 240 });
  assert.deepEqual(canvasDimensions(32), { width: 640, height: 480 });
});

test("spritePixelSize is 1 canvas px per source px at native scale (16)", () => {
  assert.equal(spritePixelSize(16), 1);
});

test("spritePixelSize doubles at scale 32", () => {
  assert.equal(spritePixelSize(32), 2);
});

test("spritePixelRect lands a sprite pixel inside its tile's own origin", () => {
  const origin = tileOrigin({ x: 2, y: 1 }, 32); // origin = (64, 32), sprite pixel size 2
  const rect = spritePixelRect(origin, 3, 5, 32);
  assert.deepEqual(rect, { x: 64 + 3 * 2, y: 32 + 5 * 2, width: 2, height: 2 });
});

test("spritePixelRect at sprite pixel (0,0) equals the tile's own origin", () => {
  const origin = tileOrigin({ x: 7, y: 2 }, 16);
  const rect = spritePixelRect(origin, 0, 0, 16);
  assert.deepEqual(rect, { x: origin.x, y: origin.y, width: 1, height: 1 });
});

test("a SpriteAsset shape is just a 16x16 pixel-index grid, unused here but checked for shape", () => {
  const sprite: SpriteAsset = { pixels: Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => -1)) };
  assert.equal(sprite.pixels.length, 16);
  assert.equal(sprite.pixels[0]?.length, 16);
});

// ── menu/labels.ts: the copy every roll line is built from ────────────────
//
// The bug this whole section guards: the play screen used to interpolate
// engine identifiers straight into player-facing copy. The dice panel printed
// "monster-0-0 attacks lt-character-2: d20 5 +3 = 8 vs AC 16: MISS", where
// "lt-character-2" is a token id (a games-db UUID in production) belonging to
// a character whose name the player typed themselves.

const NAMER: TokenNamer = {
  playerTokenId: "8f3c1d2e-0000-4444-8888-abcdefabcdef",
  playerName: "Maddik",
  tokens: [
    { id: "8f3c1d2e-0000-4444-8888-abcdefabcdef", assetId: "token_knight" },
    { id: "monster-0-0", assetId: "token_goblin" },
  ],
};

test("tokenLabel resolves the player's own token to the name they typed, never to its id", () => {
  assert.equal(tokenLabel(NAMER.playerTokenId, NAMER), "Maddik");
});

test("tokenLabel resolves any other token to its sprite's noun with an article", () => {
  assert.equal(tokenLabel("monster-0-0", NAMER), "the goblin");
});

test("tokenLabel never returns the raw id for a token that has left the board", () => {
  const label = tokenLabel("monster-9-9", NAMER);
  assert.ok(!label.includes("monster-9-9"), `expected no raw id, got "${label}"`);
});

test("assetNoun strips the kind prefix and the underscores", () => {
  assert.equal(assetNoun("token_goblin"), "goblin");
  assert.equal(assetNoun("prop_wooden_chest"), "wooden chest");
});

test("propLabel prefers the label the DM authored, falling back to the sprite noun", () => {
  assert.equal(propLabel({ assetId: "prop_chest", label: "the iron-bound chest" }), "the iron-bound chest");
  assert.equal(propLabel({ assetId: "prop_chest" }), "chest");
});

test("attackLine reads as a sentence about named creatures, with the whole formula still visible", () => {
  const line = attackLine({
    attacker: tokenLabel("monster-0-0", NAMER),
    target: tokenLabel(NAMER.playerTokenId, NAMER),
    roll: 5,
    modifier: 3,
    total: 8,
    targetAC: 16,
    hit: false,
    critical: false,
    fumble: false,
  });
  assert.equal(line, "The goblin swings at Maddik: rolled 5, +3 = 8, needed 16 to hit. MISS.");
});

test("attackLine calls out a natural 20 as a critical hit, the single biggest beat in the genre", () => {
  const line = attackLine({
    attacker: "Maddik",
    target: "the goblin",
    roll: 20,
    modifier: 4,
    total: 24,
    targetAC: 13,
    hit: true,
    critical: true,
    fumble: false,
    damage: 15,
    targetDown: true,
  });
  assert.match(line, /NATURAL 20, CRITICAL HIT/);
  assert.match(line, /15 damage/);
  assert.match(line, /the goblin goes down/);
});

test("attackLine calls out a natural 1 rather than letting it read as an ordinary miss", () => {
  const line = attackLine({ attacker: "Maddik", target: "the goblin", roll: 1, modifier: 4, total: 5, targetAC: 13, hit: false, critical: false, fumble: true });
  assert.match(line, /NATURAL 1/);
});

test("checkLine names the save in words rather than a three-letter ability code", () => {
  const line = checkLine({ roller: "Maddik", what: "Dexterity save", roll: 3, modifier: 1, total: 4, dc: 13, success: false });
  assert.equal(line, "Maddik, Dexterity save: rolled 3, +1 = 4, needed 13. FAIL.");
});

test("placeName names the place instead of printing the engine's cell coordinates", () => {
  assert.equal(placeName({ cx: 0, cy: 0 }), "where it all began");
  assert.match(placeName({ cx: 1, cy: 0 }), /one room east/);
  assert.match(placeName({ cx: -1, cy: -2 }), /two rooms north and one room west/);
  for (const cell of [{ cx: 0, cy: 0 }, { cx: 2, cy: -3 }]) {
    assert.ok(!/\(-?\d+,-?\d+\)/.test(placeName(cell)), "a place name must never contain a raw coordinate pair");
  }
});

test("neighbourLine never prints getOffscreenCells' DM-facing summary, nor the bare word from the engine", () => {
  const built = neighbourLine("N", { built: true, occupied: false });
  assert.ok(!/assembled cell/.test(built), `expected fiction, got "${built}"`);
  assert.match(built, /a room you have been through/);

  const occupied = neighbourLine("E", { built: true, occupied: true });
  assert.match(occupied, /still moving/);

  const stub = neighbourLine("S", { built: false, occupied: false, hint: "unexplored" });
  assert.match(stub, /the DM will build it/);

  const hinted = neighbourLine("W", { built: false, occupied: false, hint: "a flooded undercroft" });
  assert.match(hinted, /a flooded undercroft/);
});

test("humanizeEngineError keeps token ids and cell coordinates out of the player's note banner", () => {
  const raw = 'token "8f3c1d2e-0000-4444-8888-abcdefabcdef" has 5 ft. of movement left this turn, but moving to (3,4) costs 10 ft.';
  const out = humanizeEngineError(raw, NAMER);
  assert.ok(!out.includes("8f3c1d2e"), `expected the id gone, got "${out}"`);
  assert.match(out, /Maddik/);
  assert.equal(humanizeEngineError('no token "monster-0-0" in cell (0,0)', NAMER), "no token the goblin in this room");
});

test("the glossary defines every number the play screen actually shows a newcomer", () => {
  for (const term of ["d20", "AC", "DC", "saving throw", "modifier", "proficiency", "hit points", "death save", "natural 20"]) {
    assert.ok(explain(term), `no glossary entry for "${term}"`);
  }
  for (const entry of GLOSSARY) {
    assert.ok(entry.short.trim().length > 20, `glossary entry "${entry.term}" needs a real sentence`);
  }
});

test("the SRD credit carries all six things CC BY 4.0 requires", () => {
  // Creator, copyright notice, licence notice, licence link, indication of
  // modification, disclaimer. Grepping the whole of src/ for "SRD" used to
  // return exactly one hit, inside a code comment.
  assert.match(SRD_ATTRIBUTION.creator, /System Reference Document 5\.1/);
  assert.match(SRD_ATTRIBUTION.creator, /Wizards of the Coast/);
  assert.match(SRD_ATTRIBUTION.copyright, /Copyright 2016/);
  assert.match(SRD_ATTRIBUTION.license, /Creative Commons Attribution 4\.0/);
  assert.equal(SRD_ATTRIBUTION.licenseUrl, "https://creativecommons.org/licenses/by/4.0/");
  assert.match(SRD_ATTRIBUTION.modified, /modified/i);
  assert.match(SRD_ATTRIBUTION.disclaimer, /without warranty/i);
});

// ── menu/commandMenu.ts: the two new local verbs, and menuHint ────────────

test("Cast is always local, so wiring the caster's button up costs no credits", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  assert.deepEqual(resolveMenuAction({ kind: "cast" }, context), { kind: "local" });
});

test("Rest is always local: charging for the way back up would be charging for losing", () => {
  const context: MenuContext = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  assert.deepEqual(resolveMenuAction({ kind: "rest" }, context), { kind: "local" });
});

test("normalizeMenuHint matches the model's strings back to real buttons and drops anything invented", () => {
  assert.deepEqual(normalizeMenuHint(["talk", "SEARCH", "Fly"]), ["Talk", "Search"]);
  assert.deepEqual(normalizeMenuHint(undefined), []);
  assert.deepEqual(normalizeMenuHint(["Move", "Move"]), ["Move"]);
});

test("every verb normalizeMenuHint can return is a verb the play screen actually renders", () => {
  for (const verb of COMMAND_VERBS) {
    assert.deepEqual(normalizeMenuHint([verb]), [verb]);
  }
});

test("menuHintSentence turns the DM's hint into the one-line nudge under the narration", () => {
  assert.equal(menuHintSentence([]), null);
  assert.equal(menuHintSentence(["Talk"]), "You could Talk.");
  assert.equal(menuHintSentence(["Talk", "Search"]), "You could Talk, or Search.");
});

// ── menu/combatRound.ts: initiative, action economy, reach ───────────────

function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

test("startCombat rolls initiative for the player and every hostile and sorts them, highest first", () => {
  // rollDie(20, rng) is floor(rng*20)+1, so 0.05 -> 1 and 0.95 -> 19.
  const round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 0, speedFt: 30 },
    hostiles: [{ id: "g1", label: "the goblin", speedFt: 30 }],
    rng: fixedRng([0.05, 0.95]),
  });
  assert.equal(round.order.length, 2);
  assert.equal(round.order[0]!.id, "g1", "the higher initiative should act first");
  assert.equal(round.roundNumber, 1);
  assert.ok(round.order.every((c) => c.economy.action && c.economy.movementRemaining === 30));
});

test("the action economy persists between clicks instead of being reconstructed fresh each time", () => {
  let round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 5, speedFt: 30 },
    hostiles: [],
    rng: () => 0.99,
  });
  assert.ok(isPlayersTurn(round));
  round = spendActiveMovement(round, 25)!;
  assert.equal(activeCombatant(round)!.economy.movementRemaining, 5);
  // The overspend a probe reproduced 19 clicks in a row now simply fails.
  assert.equal(spendActiveMovement(round, 10), null);
  round = spendActiveAction(round)!;
  assert.equal(activeCombatant(round)!.economy.action, false);
  assert.equal(spendActiveAction(round), null, "an action cannot be spent twice in one turn");
});

test("endTurn refreshes only the combatant whose turn is starting, and counts rounds on the wrap", () => {
  let round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 10, speedFt: 30 },
    hostiles: [{ id: "g1", label: "the goblin", speedFt: 30 }],
    rng: fixedRng([0.99, 0.01]),
  });
  round = spendActiveAction(round)!;
  assert.equal(round.order.find((c) => c.id === "pc")!.economy.action, false);

  round = endTurn(round);
  assert.equal(activeCombatant(round)!.id, "g1");
  assert.equal(round.roundNumber, 1);
  assert.equal(round.order.find((c) => c.id === "pc")!.economy.action, false, "a spent action must not come back on someone else's turn");

  round = endTurn(round);
  assert.equal(activeCombatant(round)!.id, "pc");
  assert.equal(round.roundNumber, 2);
  assert.equal(activeCombatant(round)!.economy.action, true, "the action comes back at the start of your own next turn");
});

test("dropCombatant removes a dead monster without handing the turn to somebody else mid-click", () => {
  let round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 10, speedFt: 30 },
    hostiles: [
      { id: "g1", label: "the goblin", speedFt: 30 },
      { id: "g2", label: "the skeleton", speedFt: 30 },
    ],
    rng: fixedRng([0.99, 0.5, 0.1]),
  });
  const activeBefore = activeCombatant(round)!.id;
  round = dropCombatant(round, "g2");
  assert.equal(round.order.length, 2);
  assert.equal(activeCombatant(round)!.id, activeBefore);
});

test("melee reach is one tile, diagonals included, so a longsword cannot cross the room", () => {
  assert.equal(MELEE_REACH_FT, 5);
  assert.equal(withinMeleeReach({ x: 4, y: 4 }, { x: 5, y: 5 }), true);
  assert.equal(withinMeleeReach({ x: 4, y: 4 }, { x: 6, y: 4 }), false);
});

test("attackBlockedReason explains a greyed-out Attack button in words rather than leaving it a mystery", () => {
  const round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 10, speedFt: 30 },
    hostiles: [{ id: "g1", label: "the goblin", speedFt: 30 }],
    rng: fixedRng([0.99, 0.01]),
  });

  assert.equal(attackBlockedReason({ round, attackerAt: { x: 4, y: 4 }, targetAt: { x: 5, y: 4 }, downed: false }), null);

  const far = attackBlockedReason({ round, attackerAt: { x: 0, y: 0 }, targetAt: { x: 19, y: 0 }, downed: false });
  assert.match(far ?? "", /Too far away: 95 feet/);

  const spent = attackBlockedReason({ round: spendActiveAction(round)!, attackerAt: { x: 4, y: 4 }, targetAt: { x: 5, y: 4 }, downed: false });
  assert.match(spent ?? "", /already taken your action/);

  const theirTurn = attackBlockedReason({ round: endTurn(round), attackerAt: { x: 4, y: 4 }, targetAt: { x: 5, y: 4 }, downed: false });
  assert.match(theirTurn ?? "", /not your turn/);

  const down = attackBlockedReason({ round, attackerAt: { x: 4, y: 4 }, targetAt: { x: 5, y: 4 }, downed: true });
  assert.match(down ?? "", /You are down/);
});

// Making Archery real ("+2 to attack rolls you make with ranged weapons")
// exposed that the command menu would not let anyone take a ranged attack at
// all: this function called withinMeleeReach unconditionally, so a Trooper
// with a plasma rifle and both wizard archetypes could only swing at someone
// standing next to them, and the bonus applied to a shot nobody could make.

test("attackBlockedReason lets a ranged weapon shoot across the room, and still holds a melee one to one tile", () => {
  const round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 10, speedFt: 30 },
    hostiles: [{ id: "g1", label: "the goblin", speedFt: 30 }],
    rng: fixedRng([0.99, 0.01]),
  });
  const far = { attackerAt: { x: 0, y: 0 }, targetAt: { x: 10, y: 0 }, downed: false };

  assert.match(attackBlockedReason({ round, ...far })  ?? "", /Too far away/, "melee is the default and stays one tile");
  assert.equal(attackBlockedReason({ round, ...far, reachTiles: DEFAULT_RANGED_REACH_TILES }), null);
});

test("attackBlockedReason names the equipped weapon's own reach in the refusal, not a hardcoded five feet", () => {
  const blocked = attackBlockedReason({
    round: null,
    attackerAt: { x: 0, y: 0 },
    targetAt: { x: 18, y: 0 },
    downed: false,
    reachTiles: DEFAULT_RANGED_REACH_TILES,
  });
  assert.match(blocked ?? "", /your reach is 80 feet/, "a shot that is genuinely out of range says so at the RIGHT range");
});

test("attackBlockedReason refuses a shot with no line of sight, so a ranged weapon cannot fire through a wall", () => {
  const inRange = { attackerAt: { x: 0, y: 0 }, targetAt: { x: 10, y: 0 }, downed: false, reachTiles: DEFAULT_RANGED_REACH_TILES };
  assert.equal(attackBlockedReason({ round: null, ...inRange, hasLineOfSight: true }), null);
  assert.match(attackBlockedReason({ round: null, ...inRange, hasLineOfSight: false }) ?? "", /cannot see it/i);
  // Undefined is "not known, so not checked", the same fail-open world/reach.ts
  // takes when it has no position for one side. Melee never needs it: a target
  // one tile away has nothing in between.
  assert.equal(attackBlockedReason({ round: null, ...inRange }), null);
});

// ── menu/casting.ts: the Cast verb that had no button ────────────────────

test("every launch spell has a mechanical effect, so no caster button is decorative", () => {
  for (const spell of [...CLERIC_SPELLS, ...WIZARD_SPELLS]) {
    assert.ok(SPELL_EFFECTS[spell.name], `"${spell.name}" is on a spell list with no effect wired to it`);
  }
});

test("castableSpells greys out a levelled spell the character has no slot for, and never a cantrip", () => {
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Tam", appearanceAssetId: "s" });
  const list = castableSpells(wizard);
  const cantrip = list.find((e) => e.spell.level === 0)!;
  assert.equal(cantrip.available, true);
  const level2 = list.find((e) => e.spell.level === 2)!;
  assert.equal(level2.available, false);
  assert.match(level2.blockedReason ?? "", /level 2 spell slots/);

  const drained = castableSpells({ ...wizard, spellSlots: { 1: { max: 2, used: 2 } } });
  const level1 = drained.find((e) => e.spell.level === 1)!;
  assert.equal(level1.available, false);
  assert.match(level1.blockedReason ?? "", /long rest gives them back/);
});

test("a non-caster is offered no spells at all, so the Cast row never appears for them", () => {
  const knight = createCharacter({ archetypeId: "knight", name: "Rowan", appearanceAssetId: "s" });
  assert.deepEqual(castableSpells(knight), []);
  assert.equal(cantripNameFor(knight), null);
});

test("spendSlotFor actually decrements a slot, which nothing in the app used to do", () => {
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Tam", appearanceAssetId: "s" });
  assert.equal(spendSlotFor(wizard.spellSlots, 0), "cantrip");
  const after = spendSlotFor(wizard.spellSlots, 1);
  assert.deepEqual(after, { 1: { max: 2, used: 1 } });
  assert.equal(spendSlotFor({ 1: { max: 2, used: 2 } }, 1), null);
});

test("spell save DC and spell attack bonus are the SRD formulas off the real sheet", () => {
  const cleric = createCharacter({ archetypeId: "healer", name: "Wren", appearanceAssetId: "s" });
  assert.equal(spellSaveDc(cleric), 8 + cleric.proficiencyBonus + cleric.modifiers.wis);
  assert.equal(spellAttackBonus(cleric), cleric.proficiencyBonus + cleric.modifiers.wis);
});

test("a caster's at-will attack is named as the cantrip it actually is, not a generic swing", () => {
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Tam", appearanceAssetId: "s" });
  assert.equal(cantripNameFor(wizard), "Fire Bolt");
});

// -- resolveMove: the boundary itself has to allow the step ---------------
//
// Exits are what stitch cells together, so a cross-cell move is legal only on
// an edge the CURRENT room declares one on. Before this check the router read
// only whether the NEIGHBOUR was assembled, so the party could walk out
// through the middle of a solid wall run, and toward unexplored ground doing
// so opened a PAID DM turn. Charging a credit to walk into a wall is exactly
// the toll booth this repo's cost model forbids, which is why the wrong
// answer here is `dm`, not merely "no note on screen".

function layoutWithExits(exits: CellLayout["exits"]): CellLayout {
  const tiles = Array.from({ length: CELL_HEIGHT }, () => Array.from({ length: CELL_WIDTH }, () => "floor"));
  return { tiles, props: [], tokens: [], exits };
}

test("Move at a wall run toward unexplored ground is blocked, and specifically is NOT a paid DM turn", () => {
  const here = layoutWithExits([{ at: { x: 10, y: 0 }, edge: "N", toCell: { cx: 0, cy: -1 } }]);
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, here);
  const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: "E" } }, { world, cell: { cx: 0, cy: 0 } });
  assert.equal(route.kind, "blocked", "walking east out of a room whose only exit is north must not cost a credit");
  if (route.kind === "blocked") assert.match(route.reason, /no way out/);
});

test("Move on an edge the room actually has an exit on still routes to the DM when the neighbour is a stub", () => {
  const here = layoutWithExits([{ at: { x: CELL_WIDTH - 1, y: 6 }, edge: "E", toCell: { cx: 1, cy: 0 } }]);
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, here);
  const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: "E" } }, { world, cell: { cx: 0, cy: 0 } });
  assert.equal(route.kind, "dm");
  if (route.kind === "dm") assert.match(route.reason, /unassembled/);
});

test("a diagonal has no shared boundary edge, so it is blocked rather than sold as a new room", () => {
  const here = layoutWithExits([{ at: { x: CELL_WIDTH - 1, y: 6 }, edge: "E", toCell: { cx: 1, cy: 0 } }]);
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, here);
  const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: "NE" } }, { world, cell: { cx: 0, cy: 0 } });
  assert.equal(route.kind, "blocked");
});

test("the campaign's opening state, where the current cell is not built yet, still routes to the DM", () => {
  // Nothing has been assembled, so there is no layout to hold an exit and
  // nothing has been built to be walled in by. Blocking here would make a
  // fresh campaign unable to begin.
  const route = resolveMenuAction(
    { kind: "move", destination: { withinCell: false, direction: "E" } },
    { world: emptyWorld(), cell: { cx: 0, cy: 0 } },
  );
  assert.equal(route.kind, "dm");
});

// -- attackLine: a wounded creature reads as wounded ----------------------

test("attackLine reports the target's remaining hit points when the engine knows them", () => {
  const line = attackLine({
    attacker: "Rowan",
    target: "the skeleton",
    roll: 14,
    modifier: 5,
    total: 19,
    targetAC: 13,
    hit: true,
    critical: false,
    fumble: false,
    damage: 6,
    targetHpLeft: 7,
  });
  assert.match(line, /6 damage/);
  assert.match(line, /7 hit points left/);
});

test("attackLine says the target goes down rather than reporting 0 hit points left", () => {
  const line = attackLine({
    attacker: "Rowan",
    target: "the goblin",
    roll: 18,
    modifier: 5,
    total: 23,
    targetAC: 15,
    hit: true,
    critical: false,
    fumble: false,
    damage: 9,
    targetDown: true,
    targetHpLeft: 0,
  });
  assert.match(line, /goes down/);
  assert.doesNotMatch(line, /hit points left/);
});

test("attackLine with no hit-point figure reads exactly as it did before monster HP was tracked", () => {
  const line = attackLine({
    attacker: "Rowan",
    target: "the goblin",
    roll: 14,
    modifier: 5,
    total: 19,
    targetAC: 15,
    hit: true,
    critical: false,
    fumble: false,
    damage: 6,
  });
  assert.match(line, /6 damage\.$/);
});

// ── the Cast row is held to the same geometry the Attack row is ─────────
//
// REGRESSION, adjacent to the reach fix. An adversary put a wizard at (1,1)
// with the only target at (18,13) and exercised both rows against it in the
// same turn. Attack correctly read "Too far away: 85 feet, and your reach is
// 5 feet." Burning Hands, a 15-foot cone, was enabled, clicked, and resolved:
// "Burning Hands catches the skeleton for 5 fire damage", with no note.

test("every damaging spell carries a real range, so a cone and a bolt are not the same distance", () => {
  assert.equal(spellRangeFt("Burning Hands"), 15, "SRD 5.1: a 15-foot cone");
  assert.equal(spellRangeFt("Sacred Flame"), 60);
  assert.equal(spellRangeFt("Fire Bolt"), 120);
  assert.equal(spellRangeFt("Cure Wounds"), 5, "touch");
});

test("castBlockedReason refuses a 15-foot cone at 85 feet, in the same words the Attack row uses", () => {
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Aster", appearanceAssetId: "token_fireball_person" });
  const cone = castableSpells(wizard).find((s) => s.spell.name === "Burning Hands")!;
  const blocked = castBlockedReason({
    round: null,
    entry: cone,
    casterAt: { x: 1, y: 1 },
    targetAt: { x: 18, y: 13 },
    downed: false,
  });
  assert.ok(blocked, "the Cast row had no distance filter at all");
  assert.match(blocked!, /85 feet/);
  assert.match(blocked!, /15 feet/);
  assert.match(blocked!, /closer/i);
});

test("castBlockedReason lets a 120-foot bolt across the same room", () => {
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Aster", appearanceAssetId: "token_fireball_person" });
  const bolt = castableSpells(wizard).find((s) => s.spell.name === "Fire Bolt")!;
  assert.equal(
    castBlockedReason({ round: null, entry: bolt, casterAt: { x: 1, y: 1 }, targetAt: { x: 18, y: 13 }, downed: false }),
    null,
  );
});

test("a spell that needs nothing to aim at is never blocked on distance", () => {
  const cleric = createCharacter({ archetypeId: "healer", name: "Bram", appearanceAssetId: "token_healer" });
  const cure = castableSpells(cleric).find((s) => s.spell.name === "Cure Wounds")!;
  assert.equal(castBlockedReason({ round: null, entry: cure, casterAt: { x: 1, y: 1 }, targetAt: undefined, downed: false }), null);
});

// ── one action economy, shared by the local path and the DM path ────────
//
// The rollRequests loop never read or wrote `round`, so a DM turn could
// request a second attack by the player in a round they had already acted
// in, and could land a skeleton's swing while the round pill read "Your turn,
// action ready".

test("spendCombatantAction refuses a combatant who is not the one acting", () => {
  const round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 3, speedFt: 30 },
    hostiles: [{ id: "mon", label: "the skeleton", speedFt: 30 }],
    rng: () => 0.99,
  });
  const acting = activeCombatant(round)!.id;
  const other = round.order.find((c) => c.id !== acting)!.id;
  assert.equal(spendCombatantAction(round, other), null, "acting out of initiative order");
  assert.ok(spendCombatantAction(round, acting));
});

test("spendCombatantAction refuses a second action in the same round", () => {
  const round = startCombat({
    player: { id: "pc", label: "Maddik", dexModifier: 3, speedFt: 30 },
    hostiles: [],
    rng: () => 0.99,
  });
  const once = spendCombatantAction(round, "pc")!;
  assert.ok(once);
  assert.equal(spendCombatantAction(once, "pc"), null, "requireActionEconomyForAttack only ever caught two in one JSON reply");
});

// ── Sacred Flame is one button, not two ─────────────────────────────────

test("a cleric's Attack row is not labelled with a cantrip that resolves a different way", () => {
  // menu/casting.ts defines Sacred Flame as a Dexterity SAVE for 1d8 radiant.
  // The Attack row resolves a 1d6+STR weapon swing. Same name, two buttons,
  // two resolutions, and nothing anywhere said so.
  const cleric = createCharacter({ archetypeId: "healer", name: "Bram", appearanceAssetId: "token_healer" });
  assert.equal(cantripNameFor(cleric), null, "Sacred Flame is not an at-will attack ROLL, so it cannot name one");
});

test("a wizard's Attack row keeps its cantrip name, because that IS how it resolves", () => {
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Aster", appearanceAssetId: "token_fireball_person" });
  assert.equal(cantripNameFor(wizard), "Fire Bolt", "1d10 off INT with an attack roll is Fire Bolt, and the label was right");
});

test("attackWeaponName never leaves a second-person pronoun in a third-person sentence", () => {
  // The roll caption produced "Bram attacks the goblin with your weapon",
  // which changes person mid-clause.
  const cleric = createCharacter({ archetypeId: "healer", name: "Bram", appearanceAssetId: "token_healer" });
  assert.equal(attackWeaponName(cleric), "Mace", "the noun comes off the same table that picks the damage die");
  assert.equal(attackCaption(cleric, "the goblin"), "Bram attacks the goblin with their mace");
  const wizard = createCharacter({ archetypeId: "fireball-person", name: "Aster", appearanceAssetId: "token_fireball_person" });
  assert.equal(attackCaption(wizard, "the goblin"), "Aster attacks the goblin with Fire Bolt", "an at-will cantrip is a proper noun");
});

test("attackWeaponName and attackCaption name a worn magic weapon, not the starting kit (contract v2)", () => {
  // Regression: both functions used to read `weaponFor(sheet).name` straight
  // off the combat kit table, which never moves when the weapon SLOT is
  // upgraded. A Knight who equipped the legendary Dawnbreaker still saw
  // "Attack with Longsword" and a caption reading "...with their longsword".
  const knight = equipItem(createCharacter({ archetypeId: "knight", name: "Ada", appearanceAssetId: "token_knight" }), "weapon", "legendary");
  assert.equal(attackWeaponName(knight), "Dawnbreaker", "the Attack row should name the sword actually in hand");
  assert.equal(attackCaption(knight, "the goblin"), "Ada attacks the goblin with Dawnbreaker", "a magic item's own name is a proper noun, not 'their Dawnbreaker'");

  // A common-tier weapon keeps the old behaviour exactly: no parenthetical
  // noise on a piece that carries no enchantment to disambiguate.
  const commonKnight = createCharacter({ archetypeId: "knight", name: "Ada", appearanceAssetId: "token_knight" });
  assert.equal(attackWeaponName(commonKnight), "Longsword");
  assert.equal(attackCaption(commonKnight, "the goblin"), "Ada attacks the goblin with their longsword");

  // Fireball Person's weapon slot names an object ("Sunstroke") that differs
  // from the thing actually swung ("Fire Bolt") -- the rider line and the
  // gear row already reconcile the two; the Attack row has to say the same
  // thing they do.
  const wizard = equipItem(createCharacter({ archetypeId: "fireball-person", name: "Aster", appearanceAssetId: "token_fireball_person" }), "weapon", "legendary");
  assert.equal(attackWeaponName(wizard), "Fire Bolt (Sunstroke)");
  assert.equal(attackCaption(wizard, "the goblin"), "Aster attacks the goblin with Fire Bolt (Sunstroke)");
});

// ── the four strings a cold reader could not look up ────────────────────

test("attackLine says 'hit point' when there is one of them", () => {
  const line = attackLine({
    attacker: "Maddik", target: "the goblin", roll: 12, modifier: 4, total: 16,
    targetAC: 15, hit: true, critical: false, fumble: false, damage: 6, targetHpLeft: 1,
  });
  assert.match(line, /1 hit point left/);
  assert.doesNotMatch(line, /1 hit points/);
});

test("a save line carries what happened, not just the arithmetic", () => {
  // Judge A: "tells me I failed and never tells me what happened to me.
  // Failed at what? Did I take damage? That line is a result with no event
  // attached."
  const line = checkLine({
    roller: "Bram", what: "Dexterity save", roll: 9, modifier: 1, total: 10, dc: 13,
    success: false, effect: "3 fire damage",
  });
  assert.match(line, /FAIL/);
  assert.match(line, /3 fire damage/);
});

test("the glossary defines the words attached to an actual decision, and has no word for a price", () => {
  // Judge A: "everything that has a hover explanation is explained well... The
  // problem is the words that don't have one, and those are the words attached
  // to my actual decisions: hit die, cantrip, superiority dice."
  for (const term of ["hit die", "cantrip", "superiority dice"]) {
    assert.ok(explain(term), `the glossary never defines "${term}"`);
  }
  assert.equal(explain("credit"), undefined, "the platform shows the credits; the game's glossary does not");
  assert.equal(GLOSSARY.some((g) => /credit|price|refund/i.test(g.short)), false);
});

test("the glossary states how many feet a step across one tile costs", () => {
  // Judge A: "feet are not tiles. I don't know how many feet a step costs, so
  // I don't know how many steps I get."
  const movement = explain("movement");
  assert.ok(movement, "movement is stated in feet on a grid of tiles and the conversion is never given");
  assert.match(movement!, /5 feet/);
  assert.match(movement!, /tile|step/i);
});

test("stepsAndFeet states both units, so a grid of tiles priced in feet is legible", () => {
  assert.match(stepsAndFeet(30), /30 feet/);
  assert.match(stepsAndFeet(30), /6 steps/);
  assert.match(stepsAndFeet(5), /1 step\b/);
});

// ── one name for the dungeon master, everywhere ─────────────────────────

test("no player-facing label calls the dungeon master 'the table'", () => {
  // Both cold readers independently read "the table" as other human players.
  // Judge B: "That is three names for what I eventually worked out is one
  // thing." Judge A: "I spent a while thinking 'the table' meant other human
  // players."
  const strings = [
    neighbourLine("N", { built: false, occupied: false }),
    GAME_TAGLINE,
    CAMPAIGN_PLANNING_SUB,
  ];
  for (const s of strings) {
    assert.doesNotMatch(s, /\bthe table\b/i, `"the table" reads as other people sitting at one: ${JSON.stringify(s)}`);
  }
});

test("the tagline stops calling the dungeon master real, and keeps the claim that is actually true", () => {
  // Both judges, at stated confident confidence, read "A real dungeon master"
  // as advertising a human being. Judge B: "I'd feel slightly sold to."
  assert.doesNotMatch(GAME_TAGLINE, /real dungeon master/i);
  assert.match(GAME_TAGLINE, /real dice/i);
  assert.match(GAME_TAGLINE, /dungeon master/i);
});

test("the tagline uses no film-school vocabulary the game never explains", () => {
  // Judge B: "throughline and beats are the two most jargony words in all four
  // screens and neither of them is a D&D word, which is funny, because all the
  // D&D words got explained and these didn't."
  for (const copy of [GAME_TAGLINE, CAMPAIGN_PLANNING_SUB]) {
    assert.doesNotMatch(copy, /throughline|\bbeats\b/i, `film-school jargon in: ${JSON.stringify(copy)}`);
  }
});

// ── equipment, on the screen, with the real number in the copy ───────────
//
// The lesson this whole section exists to enforce: two judges who had never
// played a tabletop game were shown this game's real screen text and, at BOTH
// build choices, confidently picked options that did not exist, because the
// copy made unimplemented things sound better than implemented ones. Zero for
// four. So every gear string has to state the real number and the real
// effect, or say plainly that the piece does nothing.

/** A level-1 sheet for one archetype, every creation choice defaulted. */
function gearSheet(archetypeId: string) {
  return createCharacter({ archetypeId, name: "Bram", appearanceAssetId: "token_knight" });
}

test("every gear string states a real number or plainly says the piece adds nothing", () => {
  for (const archetype of ARCHETYPES) {
    for (const tier of EQUIPMENT_TIERS) {
      const sheet = SLOT_ROLES.reduce((s, role) => equipItem(s, role, tier), gearSheet(archetype.id));
      const view = gearView(sheet);
      assert.ok(view, `${archetype.id} has no gear view`);
      assert.equal(view!.slots.length, 3, `${archetype.id} should show three slots`);
      for (const slot of view!.slots) {
        // What the piece is ACTUALLY contributing, which is not its tier value
        // when SRD 5.1 is refusing it. The Trooper's riot shield is the live
        // case: a +3 piece at legendary that pays nothing while both hands are
        // on the plasma rifle. Copy promising "+3 armour class" there would be
        // the precise defect this test exists to catch, dressed up as passing
        // it, so the effective number is what the copy is held to.
        const effective = slot.active ? slot.bonus : 0;
        if (effective === 0) {
          assert.match(
            slot.plain,
            /\bno bonus\b|\badding nothing\b/i,
            `${archetype.id} ${slot.role} at ${tier} adds nothing and must say so: ${JSON.stringify(slot.plain)}`,
          );
        } else {
          assert.match(
            slot.plain,
            new RegExp(`\\+${slot.bonus}\\b`),
            `${archetype.id} ${slot.role} at ${tier} is worth +${slot.bonus} and the copy never says so: ${JSON.stringify(slot.plain)}`,
          );
        }
        // A refused piece must never print a plus number at all, and must say
        // why. Both halves matter: the number would be a lie, and a bare "adds
        // nothing" with no reason reads to a player as a bug in the maths.
        if (!slot.active) {
          assert.doesNotMatch(
            slot.plain,
            /\+\d/,
            `${archetype.id} ${slot.role} at ${tier} is refused and must not claim a number: ${JSON.stringify(slot.plain)}`,
          );
          assert.ok(slot.reason && slot.reason.length > 0, `${archetype.id} ${slot.role} at ${tier} is refused and must say why`);
        }
      }
    }
  }
});

test("rarity is a word, not only a colour, because colour alone fails a colour blind player", () => {
  const seen = new Set<string>();
  for (const tier of EQUIPMENT_TIERS) {
    const word = RARITY_WORD[tier];
    assert.match(word, /^[A-Z][a-z]+$/, `${tier} needs a plain word on screen, got ${JSON.stringify(word)}`);
    seen.add(word);
  }
  assert.equal(seen.size, EQUIPMENT_TIERS.length, "two tiers sharing a word is two tiers a player cannot tell apart");
});

test("a common piece never implies a mechanic, and an enchanted one never hides one", () => {
  const common = gearView(gearSheet("knight"))!;
  assert.equal(common.attackBonus, 0);
  assert.equal(common.acBonus, 0);
  assert.equal(common.saveBonus, 0);
  // It used to say "All three pieces are common, which adds nothing to any
  // roll" -- same fact, but naming a RANK, which is the one thing this panel
  // stopped doing (issue #15). What the sentence is FOR is unchanged: a kit
  // that adds nothing has to say so rather than imply a hidden bonus.
  assert.match(common.totalsLine, /\bnothing\b/i, "all-common gear should say so rather than imply a hidden bonus");
  assert.doesNotMatch(common.totalsLine, /\bcommon\b/i, "and it says it without naming a rank");
  assert.doesNotMatch(common.totalsLine, /\+[1-9]/, "nothing is added, so no plus sign may appear");

  const armed = equipItem(gearSheet("knight"), "weapon", "uncommon");
  const view = gearView(armed)!;
  assert.equal(view.attackBonus, 1);
  assert.match(view.totalsLine, /\+1 to hit and damage/i);
});

test("the legendary weapon rider is named with its dice, not left as flavour", () => {
  // SRD Flame Tongue shape: extra damage DICE of a named type, rolled by the
  // engine on its own. A player told only "it burns" cannot tell whether that
  // is a number or a sentence.
  const sheet = equipItem(gearSheet("fireball-person"), "weapon", "legendary");
  const weapon = gearView(sheet)!.slots.find((s) => s.role === "weapon")!;
  assert.match(weapon.plain, /1d6/, "the rider's dice belong in the copy");
  assert.match(weapon.plain, /fire/i, "and so does its damage type");
});

test("the two-armour chassis tells the truth about the cap instead of promising +6", () => {
  // The Knight is the only chassis with two armor-kind slots (the owner's own
  // sword-shield-armour example). Two legendary pieces are +3 and +3, and the
  // engine applies +3 in total. Copy that printed +6 would be the exact
  // "sounds better than it is" defect the blind test caught.
  let sheet = gearSheet("knight");
  sheet = equipItem(sheet, "outer", "legendary");
  sheet = equipItem(sheet, "crown", "legendary");
  const view = gearView(sheet)!;
  assert.equal(view.acBonusRaw, 6);
  assert.equal(view.acBonus, MAX_TOTAL_AC_BONUS);
  assert.equal(effectiveArmorClass(sheet), sheet.armorClass + MAX_TOTAL_AC_BONUS);
  assert.match(view.totalsLine, /\+3 armour class/i);
  assert.ok(view.capNote, "a cap the player cannot see is a number the sheet is lying about");
  assert.match(view.capNote!, /\+6/, "say what the pieces would add");
  assert.match(view.capNote!, new RegExp(`\\+${MAX_TOTAL_AC_BONUS}\\b`), "and what actually applies");
});

test("capNote fires and names the ring when a Ring of Protection is what pushes the AC total over the cap", () => {
  // Regression: `equipmentAcBonusRaw` used to sum only the three v1
  // armour-kind slots, so a single legendary armour piece (+3, already AT
  // the cap on its own) plus a worn Ring of Protection (+1 more) stayed
  // "raw 3" and `capNote` never fired -- the ring's own row still promised
  // "+1 armour class" and nothing on the sheet explained why AC never moved.
  let sheet = gearSheet("knight");
  sheet = equipItem(sheet, "outer", "legendary");
  sheet = { ...sheet, equipment: { ...sheet.equipment, ring: { slot: "ring", tier: "rare" } } };
  const view = gearView(sheet)!;
  assert.equal(view.acBonusRaw, 4, "the outer piece's +3 plus the ring's +1");
  assert.equal(view.acBonus, MAX_TOTAL_AC_BONUS, "the engine still caps the applied total");
  assert.equal(effectiveArmorClass(sheet), sheet.armorClass + MAX_TOTAL_AC_BONUS);
  assert.ok(view.capNote, "the ring alone pushes the raw total past the cap and the sheet has to say so");
  assert.match(view.capNote!, /\+4\b/);
  assert.match(view.capNote!, new RegExp(`\\+${MAX_TOTAL_AC_BONUS}\\b`));
  assert.match(view.capNote!, /Ring of Protection/, "the cap note should name every piece pushing against it, ring included");
});

test("saveCapNote fires and names the amulet when a Stone of Good Luck is what pushes the save total over the cap", () => {
  // The save-kind mirror of the AC cap note (contract v2's MAX_TOTAL_SAVE_BONUS):
  // did not exist at all before this fix, so a save-kind crown at legendary
  // (+3, already at the cap) plus a worn Stone of Good Luck (+1 more) left
  // the amulet's own row claiming "+1 on every saving throw" with the sheet
  // never saying the cap had already swallowed it.
  const shadow = createCharacter({ archetypeId: "shadow", name: "Nix", appearanceAssetId: "token_shadow" });
  let sheet = equipItem(shadow, "crown", "legendary");
  assert.equal(SLOTS_BY_ARCHETYPE.shadow.crown.bonusKind, "save", "the shadow's crown is the save-kind slot this test needs");
  sheet = { ...sheet, equipment: { ...sheet.equipment, amulet: { slot: "amulet", tier: "rare" } } };
  const view = gearView(sheet)!;
  assert.equal(view.saveBonus, MAX_TOTAL_SAVE_BONUS, "the engine still caps the applied total");
  assert.ok(view.saveCapNote, "the amulet alone pushes the raw save total past the cap and the sheet has to say so");
  assert.match(view.saveCapNote!, new RegExp(`\\+${MAX_TOTAL_SAVE_BONUS}\\b`));
  assert.match(view.saveCapNote!, /Stone of Good Luck/, "the cap note should name every piece pushing against it, the amulet included");
});

test("effectiveArmorClass is additive on top of the stored AC and never rewrites it", () => {
  const base = gearSheet("shadow");
  assert.equal(effectiveArmorClass(base), base.armorClass, "all-common gear must not move the AC at all");
  const cloaked = equipItem(base, "outer", "rare");
  assert.equal(effectiveArmorClass(cloaked), base.armorClass + 2);
  assert.equal(cloaked.armorClass, base.armorClass, "the stored number keeps meaning armour, DEX and fighting style");
});

test("a save-slot piece adds to saving throws and never to armour class", () => {
  // The third slot is deliberately narrowed to saves so it cannot become a
  // second source of AC for the six non-fighter archetypes.
  const sheet = equipItem(gearSheet("psion"), "crown", "legendary");
  const view = gearView(sheet)!;
  assert.equal(view.saveBonus, 3);
  assert.equal(view.acBonus, 0);
  assert.equal(effectiveArmorClass(sheet), sheet.armorClass);
});

test("the gear rows name the piece the character actually carries, per tier", () => {
  const common = gearView(gearSheet("knight"))!;
  assert.deepEqual(
    common.slots.map((s) => s.itemName),
    ["Longsword", "Kite Shield", "Plate Harness"],
    "the common set is the archetype's own starting kit, not new fiction",
  );
  const upgraded = gearView(equipItem(gearSheet("knight"), "weapon", "uncommon"))!;
  assert.equal(upgraded.slots.find((s) => s.role === "weapon")!.itemName, "Keen Longsword");
});

test("the weapon row names the swing as well as the item, wherever those are two objects", () => {
  // The gear row used to print `nameByTier` alone, so a Fireball Person read
  // "Sunstroke" on the sheet and watched the dice log resolve a Fire Bolt: two
  // names for one action with nothing on screen to square them. The rider line
  // and the attack breakdown already print `weaponIdentityFor().label`; this
  // row now asks the same function rather than picking one of the two names.
  const wizard = equipItem(gearSheet("fireball-person"), "weapon", "legendary");
  const weaponRow = gearView(wizard)!.slots.find((s) => s.role === "weapon")!;
  assert.equal(weaponRow.itemName, weaponIdentityFor(wizard).label);
  assert.equal(weaponRow.itemName, "Fire Bolt (Sunstroke)");

  // And the six archetypes whose two tables describe ONE object still print
  // one noun, so the reconciliation never adds a parenthetical to a row that
  // has nothing to disambiguate.
  for (const archetype of ARCHETYPES) {
    for (const tier of EQUIPMENT_TIERS) {
      const sheet = equipItem(gearSheet(archetype.id), "weapon", tier);
      const row = gearView(sheet)!.slots.find((s) => s.role === "weapon")!;
      assert.equal(
        row.itemName,
        weaponIdentityFor(sheet).label,
        `${archetype.id} at ${tier}: the gear row and the dice log must name the weapon identically`,
      );
    }
  }
});

// ── the readout names where the bonus came from ──────────────────────────

test("bonusSources refuses to print a breakdown that does not add up to the roll", () => {
  // The failure this stops is the readout drifting from the engine, which is
  // the same defect class as a decorative AC: a line that explains a +5 with
  // parts summing to +7 is worse than the unexplained lump it replaced.
  const parts = [
    { label: "Strength and training", amount: 3 },
    { label: "Keen Longsword", amount: 2 },
  ];
  assert.deepEqual(bonusSources(parts, 5), parts);
  assert.equal(bonusSources(parts, 4), undefined);
});

test("bonusSources drops a zero source and never explains a single lump with itself", () => {
  const only = bonusSources(
    [
      { label: "Strength and training", amount: 5 },
      { label: "Longsword", amount: 0 },
    ],
    5,
  );
  assert.equal(only, undefined, "(+5 Strength and training) next to +5 is noise, not an explanation");
  const two = bonusSources(
    [
      { label: "Dexterity and training", amount: 3 },
      { label: "Archery", amount: 2 },
      { label: "Shortblade", amount: 0 },
    ],
    5,
  )!;
  assert.equal(two.length, 2, "a +0 piece contributed nothing and must not be listed as a source");
});

test("an attack line with sources says where every point came from, and the sum is the roll", () => {
  const sources = bonusSources(
    [
      { label: "Dexterity and training", amount: 3 },
      { label: "Keen Longsword", amount: 2 },
    ],
    5,
  )!;
  const line = attackLine({
    attacker: "Bram",
    target: "the goblin",
    roll: 9,
    modifier: 5,
    total: 14,
    targetAC: 13,
    hit: true,
    critical: false,
    fumble: false,
    sources,
  });
  assert.match(line, /rolled 9, \+5 = 14 \(\+3 Dexterity and training, \+2 Keen Longsword\), needed 13 to hit/);
  assert.equal(
    sources.reduce((n, s) => n + s.amount, 0),
    5,
    "the sum of the parts is the modifier that was actually rolled",
  );
});

test("a line with no sources is byte-identical to the one this game already printed", () => {
  assert.equal(
    attackLine({
      attacker: "Bram",
      target: "the goblin",
      roll: 9,
      modifier: 5,
      total: 14,
      targetAC: 13,
      hit: true,
      critical: false,
      fumble: false,
    }),
    "Bram swings at the goblin: rolled 9, +5 = 14, needed 13 to hit. HIT.",
  );
  assert.equal(
    checkLine({ roller: "Bram", what: "Dexterity save", roll: 9, modifier: 1, total: 10, dc: 13, success: false }),
    "Bram, Dexterity save: rolled 9, +1 = 10, needed 13. FAIL.",
  );
});

test("a check line carries the same breakdown as an attack line", () => {
  const sources = bonusSources(
    [
      { label: "Wisdom and training", amount: 4 },
      { label: "Mitre of Clear Sight", amount: 2 },
    ],
    6,
  )!;
  const line = checkLine({ roller: "Bram", what: "Wisdom save", roll: 9, modifier: 6, total: 15, dc: 13, success: true, sources });
  assert.match(line, /rolled 9, \+6 = 15 \(\+4 Wisdom and training, \+2 Mitre of Clear Sight\), needed 13/);
});

test("the glossary teaches rarity again now that loot can grant it (issue #15)", () => {
  // The entry was pulled while nothing in the build granted a piece above
  // common: `equippableTiers` could only ever answer with the tier already
  // worn, so a four-rank glossary entry would have taught a ladder nobody
  // could climb. Loot (rules/loot.ts's `lootFor`) is the
  // engine-owned grant that changed that, so the entry -- and the numbers it
  // states -- are back.
  const rarity = explain("rarity");
  assert.ok(rarity, "the About panel dropped the rarity entry");
  assert.match(rarity!, /common/i);
  assert.match(rarity!, /uncommon/i);
  assert.match(rarity!, /\brare\b/i);
  assert.match(rarity!, /legendary/i);
  assert.ok(explain("attunement"), "the About panel is missing the attunement entry");
});

// ── equipping is free, and the picker only exists where a choice does ────

test("the tiers a character can equip are the ones they own: common, the worn tier, and every tier sitting in the bag", () => {
  // `equippableTiers` used to answer with only the tier already worn, because
  // nothing in the build granted a piece above common. Loot changes that: a
  // character who has found something can equip common (their own starting
  // piece never goes away) or whatever they are wearing or carrying.
  const sheet = gearSheet("medic");
  for (const role of SLOT_ROLES) {
    assert.deepEqual(equippableTiers(sheet, role), ["common"]);
  }
  const found = equipItem(sheet, "weapon", "rare");
  assert.deepEqual(equippableTiers(found, "weapon"), ["common", "rare"], "the worn piece never hides the character's own common one");
});

test("the character picker names the three pieces an archetype starts with", () => {
  // The three slots are drawn on the token from turn one, so the screen where
  // a player chooses between eight archetypes is where they should first see
  // what each one carries. Every piece is common, worth +0, so the line
  // promises nothing mechanical.
  for (const archetype of ARCHETYPES) {
    const names = startingGearNames(archetype.id);
    assert.equal(names.length, 3, `${archetype.id} should carry three named pieces`);
    for (const name of names) assert.ok(name.length > 0, `${archetype.id} has an unnamed slot`);
  }
  assert.deepEqual(startingGearNames("knight"), ["Longsword", "Kite Shield", "Plate Harness"]);
  assert.deepEqual(startingGearNames("psion"), ["Neural Focus", "Barrier Field", "Psi Crown"]);
  assert.deepEqual(startingGearNames("not-an-archetype"), [], "an unknown archetype renders no gear line rather than a broken one");
});

test("no gear string promises a bonus in the wrong currency", () => {
  // The third slot is deliberately narrowed to saving throws so it cannot
  // become a second source of armour class for the six non-fighter
  // archetypes. Copy that said "armour class" on a save-slot piece would sell
  // a mechanic the engine does not have, which is the defect the blind test
  // found four times over.
  for (const archetype of ARCHETYPES) {
    for (const tier of EQUIPMENT_TIERS) {
      for (const slot of gearView(SLOT_ROLES.reduce((s, r) => equipItem(s, r, tier), gearSheet(archetype.id)))!.slots) {
        if (slot.bonus === 0) continue;
        if (slot.bonusKind === "save") {
          assert.doesNotMatch(slot.plain, /armour class|to hit/i, `${archetype.id} ${slot.role}: ${slot.plain}`);
        }
        if (slot.bonusKind === "armor") {
          assert.doesNotMatch(slot.plain, /saving throw|damage/i, `${archetype.id} ${slot.role}: ${slot.plain}`);
        }
        if (slot.bonusKind === "weapon") {
          assert.doesNotMatch(slot.plain, /armour class|saving throw/i, `${archetype.id} ${slot.role}: ${slot.plain}`);
        }
      }
    }
  }
});

test("the slot label names what the piece does to a roll, not what a Knight's version of it happens to be", () => {
  // "Armour or headwear" was ONE string for the crown slot, applied to all
  // eight archetypes. The crown slot is bonusKind "armor" for exactly two of
  // them (the Knight's Plate Harness, the Trooper's Carapace Vest). For the
  // Shadow's Hood, the Healer's Mitre, the Fireball Person's Pointed Hat, the
  // Infiltrator's Optic Visor, the Medic's Scanner Band and the Psion's Psi
  // Crown it is "save", which `equipmentSaveBonus` routes into
  // `saveModifierFor` and which never touches armour class at all. A
  // first-time player reads the label, not the paragraph under it, and
  // concludes their Hood is their armour: the effect sentence honoured this
  // screen's own rule and the label above it broke it.
  for (const archetype of ARCHETYPES) {
    for (const slot of gearView(gearSheet(archetype.id))!.slots) {
      if (slot.bonusKind === "save") {
        assert.doesNotMatch(
          slot.slotLabel,
          /armou?r/i,
          `${archetype.id} ${slot.role} moves saving throws and never AC, so its label must not say armour: ${JSON.stringify(slot.slotLabel)}`,
        );
        assert.match(slot.slotLabel, /saving throws/i, `${archetype.id} ${slot.role}: say what it moves`);
      }
      if (slot.bonusKind === "armor") {
        assert.doesNotMatch(slot.slotLabel, /saving throw/i, `${archetype.id} ${slot.role}: ${slot.slotLabel}`);
        assert.match(slot.slotLabel, /armou?r|shield|cloak/i, `${archetype.id} ${slot.role}: ${slot.slotLabel}`);
      }
      if (slot.bonusKind === "weapon") assert.equal(slot.slotLabel, "Weapon", `${archetype.id} ${slot.role}`);
    }
  }

  const crownOf = (id: string) => gearView(gearSheet(id))!.slots.find((s) => s.role === "crown")!;
  assert.equal(crownOf("knight").slotLabel, "Armour", "the Knight's crown really is his armour");
  assert.equal(crownOf("shadow").slotLabel, "Headwear (saving throws)");
  assert.notEqual(
    crownOf("knight").slotLabel,
    crownOf("shadow").slotLabel,
    "one label for both is the label lying to six players out of eight",
  );
  // The Healer's Vestments are worn on the torso (LAYER_OVERBODY, the same
  // predicate the engine uses to find the piece an SRD Strength requirement
  // hangs off), so they are armour rather than a shield.
  assert.equal(gearView(gearSheet("healer"))!.slots.find((s) => s.role === "outer")!.slotLabel, "Armour");
  assert.equal(gearView(gearSheet("knight"))!.slots.find((s) => s.role === "outer")!.slotLabel, "Shield or cloak");
});

test("no view the sheet is built from names a rank, or apologises for one (issue #15)", () => {
  // WHAT CHANGED AND WHY. This used to assert the opposite: that `GearView`
  // carried an `upgradeNote` reading "Nothing in this campaign upgrades gear
  // yet, so all three pieces stay common." That sentence was true, and it was
  // the right answer while the same panel was advertising four ranks (a chip
  // per row, a glossary entry behind each). Option B on issue #15 removed the
  // advertisement instead of explaining it, and once the ranks are off the
  // screen the apology is the only thing left telling a player a ladder
  // exists. So `upgradeNote` is gone from the type, and no string this view
  // produces may name a rank either.
  //
  // The gate is unchanged and is what re-enables all of it.
  const sheet = gearSheet("knight");
  assert.ok(SLOT_ROLES.every((role) => equippableTiers(sheet, role).length === 1), "the gate the whole surface hangs off");

  const RANK = /\bcommon\b|\buncommon\b|\brare\b|\blegendary\b|\brarity\b/i;
  for (const archetype of ARCHETYPES) {
    for (const tier of EQUIPMENT_TIERS) {
      const view = gearView(SLOT_ROLES.reduce((sh, r) => equipItem(sh, r, tier), gearSheet(archetype.id)))!;
      assert.equal(
        (view as { upgradeNote?: unknown }).upgradeNote,
        undefined,
        `${archetype.id} at ${tier} still carries an upgradeNote`,
      );
      const strings = [view.totalsLine, view.capNote ?? "", ...view.slots.flatMap((s) => [s.itemName, s.slotLabel, s.plain])];
      for (const text of strings) {
        const match = RANK.exec(text);
        assert.equal(match, null, `${archetype.id} at ${tier} names a rank in "${text}"`);
      }
      // ...and no display-only rank word survives on the row either.
      for (const slot of view.slots) {
        assert.equal((slot as { rarityWord?: unknown }).rarityWord, undefined, `${archetype.id} ${slot.role} still carries a rarityWord`);
      }
    }
  }
});

test("the rarity MACHINERY is intact under the hidden surface (issue #15)", () => {
  // Option B was "hide the ladder", explicitly not "delete it", so that an
  // acquisition path stays a small change. Everything a grant would need is
  // asserted here in one place: the tiers themselves, what each is worth, the
  // per-tier name, the per-tier art variant and glow, and a view that already
  // states the right number at a rank no character can currently reach.
  assert.deepEqual([...EQUIPMENT_TIERS], ["common", "uncommon", "rare", "legendary"]);
  assert.deepEqual(
    EQUIPMENT_TIERS.map((t) => BONUS_BY_TIER[t]),
    [0, 1, 2, 3],
    "the ladder's numbers are the machinery, and they stay",
  );
  const words = new Set(EQUIPMENT_TIERS.map((t) => RARITY_WORD[t]));
  assert.equal(words.size, EQUIPMENT_TIERS.length, "the four words a restored chip needs are still distinct");

  const sheet = gearSheet("knight");
  const names = EQUIPMENT_TIERS.map((t) => itemNameAt(sheet, "weapon", t));
  assert.equal(new Set(names).size, EQUIPMENT_TIERS.length, "per-tier naming still answers for a tier nobody wears");
  assert.equal(names[3], "Dawnbreaker", "the top of the ladder still has its own name, unread by anything on screen");

  // The engine still pays out at a tier the UI never mentions, which is what
  // makes restoring the ladder a grant rather than a rebuild.
  const armed = equipItem(sheet, "weapon", "rare");
  assert.equal(equipmentAttackBonus(armed), 2);
  const row = gearView(armed)!.slots.find((s) => s.role === "weapon")!;
  assert.equal(row.tier, "rare", "the tier is still on the view; it is only the WORD that left the screen");
  assert.match(row.plain, /\+2/);
  assert.equal(row.itemName, "Sword of the Vigil", "the row is already correct at a rank nobody can reach");

  // ...and the token still draws that piece differently, glow and all.
  const plan = renderPlanFor(equipItem(sheet, "outer", "legendary"))!;
  const outer = plan.layers.find((l) => l.spriteId.includes("_outer_"))!;
  assert.ok(outer.glowBands > 0, "the enchanted glow is still built; nothing currently grants a piece that lights it");
});

test("only a weapon carries the legendary rider, so no restored copy may promise one anywhere else", () => {
  // `legendaryRider` is set on the weapon-role slot and nowhere else, and
  // `legendaryRiderFor` returns one only when the WEAPON slot is legendary, so
  // two of the three legendary pieces a character can own are +3 flat. The
  // glossary sentence that used to teach the ladder oversold two thirds of its
  // own top rank for exactly this reason; it is gone with the rest of the
  // surface (issue #15), and this invariant is what the replacement has to be
  // written against on the day the ladder comes back.
  for (const id of Object.keys(SLOTS_BY_ARCHETYPE) as ArchetypeId[]) {
    for (const role of SLOT_ROLES) {
      const slot = SLOTS_BY_ARCHETYPE[id][role];
      if (role === "weapon") assert.ok(slot.legendaryRider, `${id} weapon should carry the rider`);
      else assert.equal(slot.legendaryRider, undefined, `${id} ${role} has no rider, so no copy may promise one`);
    }
  }
  // The rider itself is machinery and still pays out, unmentioned.
  const wizard = equipItem(gearSheet("fireball-person"), "weapon", "legendary");
  const weapon = gearView(wizard)!.slots.find((s) => s.role === "weapon")!;
  assert.match(weapon.plain, /1d6/, "the rider's dice are still in the row that would show them");
});

test("the Carrying line is the pack, not the loadout named a third time", () => {
  // A Knight read "AC 16 (chain mail)", a gear row saying "Plate Harness", and
  // "Carrying: Longsword, Shield, Chain mail, ..." -- one suit of armour under
  // three names, with the shield called "Kite Shield" in one list and "Shield"
  // in the other, and no way to tell which of the three an upgrade would move.
  for (const archetype of ARCHETYPES) {
    const sheet = gearSheet(archetype.id);
    const pack = packItems(sheet);
    for (const named of archetype.loadoutInventory) {
      assert.ok(sheet.inventory.includes(named), `${archetype.id} declares "${named}" as loadout but never carries it`);
      assert.ok(!pack.includes(named), `${archetype.id} still lists "${named}" in the pack, which the loadout already names`);
    }
    for (const item of sheet.inventory) {
      if (archetype.loadoutInventory.includes(item)) continue;
      assert.ok(pack.includes(item), `${archetype.id} dropped "${item}" from the pack, and nothing else on the sheet names it`);
    }
    assert.ok(pack.length > 0, `${archetype.id} would show an empty Carrying line`);
  }
  assert.deepEqual(packItems(gearSheet("knight")), ["Handaxe x2", "Explorer's pack"]);
  // Exact strings, never substrings: something picked up mid-campaign must not
  // be filtered off the sheet because a loadout entry is a prefix of it.
  const knight = gearSheet("knight");
  const withLoot = { ...knight, inventory: [...knight.inventory, "Longsword, notched and bloody"] };
  assert.ok(packItems(withLoot).includes("Longsword, notched and bloody"), "a loose match would swallow this");
  // An archetype this table has never heard of hides nothing, because hiding
  // is the risky direction.
  const stranger = { ...knight, archetypeId: "not-an-archetype" };
  assert.deepEqual(packItems(stranger), knight.inventory);
});

test("one suit of armour has one name: the AC line and the gear row agree", () => {
  for (const archetype of ARCHETYPES) {
    const sheet = gearSheet(archetype.id);
    const label = armorDisplayLabel(sheet);
    const armourRow = gearView(sheet)!.slots.find((s) => s.slotLabel === "Armour");
    if (armourRow) {
      assert.ok(
        label.startsWith(armourRow.itemName),
        `${archetype.id} calls its armour "${armourRow.itemName}" in the gear row and "${label}" on the AC line`,
      );
    } else {
      assert.equal(label, sheet.armorLabel, `${archetype.id} has no armour in a gear slot, so the chassis label stands`);
    }
  }
  assert.equal(armorDisplayLabel(gearSheet("knight")), "Plate Harness", "not 'chain mail', which appears nowhere else on the panel");
  assert.equal(armorDisplayLabel(gearSheet("trooper")), "Carapace Vest");
  // The Cleric chassis folds a shield's flat +2 into its base AC, so dropping
  // the shield would explain 15 points of armour class with 13 of vestments.
  assert.equal(armorDisplayLabel(gearSheet("healer")), "Vestments and shield");
  assert.equal(armorDisplayLabel(gearSheet("fireball-person")), "unarmored", "a wizard's 10 comes from no armour at all");
  // It follows the tier, because the gear row does: two surfaces naming one
  // object differently is the whole defect.
  assert.equal(armorDisplayLabel(equipItem(gearSheet("knight"), "crown", "rare")), "Vigil Plate");
  // `sheet.armorLabel` is untouched: characters/equipment.ts anchors the SRD
  // armour Strength requirement to it, and this is a display name only.
  assert.equal(gearSheet("knight").armorLabel, "chain mail");
});

test("every number in the gear copy takes the right article, because 'needs a 18' reads as a typo", () => {
  for (const archetype of ARCHETYPES) {
    for (const tier of EQUIPMENT_TIERS) {
      const view = gearView(SLOT_ROLES.reduce((s, r) => equipItem(s, r, tier), gearSheet(archetype.id)))!;
      for (const slot of view.slots) {
        assert.doesNotMatch(slot.plain, /\ba (8|11|18)\b/, `${archetype.id} ${slot.role}: ${slot.plain}`);
        assert.doesNotMatch(slot.plain, /\ban (?!8|11|18)\d/, `${archetype.id} ${slot.role}: ${slot.plain}`);
      }
    }
  }
});

// ── the plan the renderer is handed ──────────────────────────────────────

test("the token's gear layers are built from the sheet, keyed by the token id the board knows", () => {
  // Equipment never goes into the world model: PlacedToken stays
  // {id, assetId, x, y, kind, currentHp?} because the world is persisted and
  // shown to the dungeon master, and gear is the one thing the model must not
  // be able to reach. The plan is assembled from the sheet instead.
  const plans = renderPlansFor("token-row-id", gearSheet("knight"))!;
  const plan = plans["token-row-id"]!;
  assert.equal(plan.bodySpriteId, "token_knight", "the body id is unchanged; every saved cell already names it");
  // Contract v2: boots are always present after normalisation (absent reads
  // as common), and common boots exist for every archetype, so a plain pair
  // now draws at LAYER_FEET (25) on every character from turn one -- between
  // the body and the plate, below the shield and the sword.
  assert.deepEqual(
    plan.layers.map((l) => l.spriteId),
    ["gear_knight_boots_base", "gear_knight_crown_base", "gear_knight_outer_base", "gear_knight_weapon_base"],
    "sorted ascending by layer: boots at 25, plate at 30, shield at 35, sword at 40",
  );
  assert.deepEqual(plan.layers.map((l) => l.layer), [25, 30, 35, 40]);
  for (const layer of plan.layers) {
    assert.equal(layer.glowBands, 0, "common gear does not glow, which is what makes an enchanted piece read as enchanted");
    assert.equal(layer.remap, null, "common is the base art in its own colours");
  }
});

test("a cloak is drawn behind its wearer and a hood on top, though both are the same slot role", () => {
  // The whole reason draw order is DATA on the slot rather than derived from
  // the role: the Shadow's cloak is `outer` at layer 10 and the Knight's
  // shield is `outer` at 35.
  const shadow = renderPlanFor(gearSheet("shadow"))!;
  const byId = Object.fromEntries(shadow.layers.map((l) => [l.spriteId, l.layer]));
  assert.equal(byId["gear_shadow_outer_base"], 10, "the cloak goes behind the body");
  assert.equal(byId["gear_shadow_crown_base"], 50, "the hood goes on top of everything");
  const knight = renderPlanFor(gearSheet("knight"))!;
  const knightById = Object.fromEntries(knight.layers.map((l) => [l.spriteId, l.layer]));
  assert.equal(knightById["gear_knight_outer_base"], 35, "the shield goes in front of the torso");
});

test("an uncommon piece is the same drawing with a palette remap, and it glows", () => {
  // "Common and uncommon are simple colour swaps, so they cost no new
  // sprites" is only literally true if the uncommon variant asks for the same
  // sprite id.
  const plan = renderPlanFor(equipItem(gearSheet("healer"), "weapon", "uncommon"))!;
  const weapon = plan.layers.find((l) => l.spriteId.includes("_weapon_"))!;
  assert.equal(weapon.spriteId, "gear_healer_weapon_base", "uncommon reuses the base drawing");
  assert.ok(weapon.remap, "and differs from common only by the remap");
  assert.equal(weapon.glowBands, 1, "an enchanted piece reads as enchanted");
});

test("rare and legendary ask for their own drawn artwork", () => {
  const rare = renderPlanFor(equipItem(gearSheet("psion"), "crown", "rare"))!;
  assert.ok(rare.layers.some((l) => l.spriteId === "gear_psion_crown_rare"));
  const legendary = renderPlanFor(equipItem(gearSheet("psion"), "crown", "legendary"))!;
  assert.ok(legendary.layers.some((l) => l.spriteId === "gear_psion_crown_legendary"));
  const crown = legendary.layers.find((l) => l.spriteId === "gear_psion_crown_legendary")!;
  assert.equal(crown.remap, null, "it has its own drawing, so there is nothing to recolour");
  assert.equal(crown.glowBands, 2);
});

// ═══════════════════════════════════════════════════════════════════════
// CONTRACT V2: staging, attunement and loot (rules/inventory.ts,
// rules/attunement.ts, rules/loot.ts), the inventory screen's view builder
// (inventory/inventoryView.ts), and the copy they print (menu/labels.ts's
// lootLine, the restored glossary).
// ═══════════════════════════════════════════════════════════════════════

test("draftFromSheet defaults a fresh character to four drawn-role commons and an empty bag", () => {
  const sheet = gearSheet("knight");
  const draft = draftFromSheet(sheet);
  for (const role of ["weapon", "outer", "crown", "boots"] as const) {
    assert.deepEqual(draft.equipment[role], { slot: role, tier: "common" }, `${role} should default to common`);
  }
  assert.equal(draft.equipment.ring, undefined, "ring starts empty, never at common");
  assert.equal(draft.equipment.amulet, undefined, "amulet starts empty, never at common");
  assert.deepEqual(draft.bag, []);
});

test("MAX_DISTINCT_MAGIC_ITEMS never exceeds BAG_CAPACITY, so a full bag stays unreachable", () => {
  assert.ok(MAX_DISTINCT_MAGIC_ITEMS <= BAG_CAPACITY, `${MAX_DISTINCT_MAGIC_ITEMS} magic items must fit in an ${BAG_CAPACITY}-cell bag`);
});

test("normalizeBag enforces its invariants: real items only, no duplicates, nothing already worn, capped", () => {
  const equipment = { weapon: { slot: "weapon", tier: "common" } } as ReturnType<typeof draftFromSheet>["equipment"];
  const raw = [
    { slot: "weapon", tier: "common" }, // not a magic tier
    { slot: "weapon", tier: "uncommon" }, // kept
    { slot: "weapon", tier: "uncommon" }, // duplicate
    { slot: "boots", tier: "legendary" }, // no such rung
    { slot: "ring", tier: "uncommon" }, // kept
    "garbage",
    null,
  ];
  const bag = normalizeBag(raw, "knight", equipment);
  assert.deepEqual(bag, [
    { slot: "weapon", tier: "uncommon" },
    { slot: "ring", tier: "uncommon" },
  ]);
});

test("normalizeBag drops an entry equal to what is already worn", () => {
  const equipment = { weapon: { slot: "weapon", tier: "rare" } } as ReturnType<typeof draftFromSheet>["equipment"];
  const bag = normalizeBag([{ slot: "weapon", tier: "rare" }, { slot: "weapon", tier: "uncommon" }], "knight", equipment);
  assert.deepEqual(bag, [{ slot: "weapon", tier: "uncommon" }], "the worn rare weapon is never a duplicate copy in the bag");
});

test("stageEquip swaps in place: the outgoing magic piece takes the incoming item's own bag cell", () => {
  const draft = { equipment: draftFromSheet(gearSheet("knight")).equipment, bag: [{ slot: "weapon", tier: "uncommon" }, { slot: "outer", tier: "rare" }] as const };
  const first = stageEquip("knight", draft as never, 0);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.draft.equipment.weapon?.tier, "uncommon");
  assert.equal(first.draft.bag.length, 1, "the outgoing common weapon has nothing to put back, so the cell is gone");

  const second = stageEquip("knight", { ...first.draft, bag: [{ slot: "weapon", tier: "legendary" }, ...first.draft.bag] }, 0);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.draft.equipment.weapon?.tier, "legendary");
  assert.deepEqual(second.draft.bag[0], { slot: "weapon", tier: "uncommon" }, "the outgoing uncommon weapon lands in the incoming piece's own cell");
});

test("stageEquip refuses a fourth attunement item, with the SRD's own remedy named", () => {
  const base = draftFromSheet(gearSheet("shadow"));
  const draft = {
    equipment: {
      ...base.equipment,
      weapon: { slot: "weapon" as const, tier: "legendary" as const },
      ring: { slot: "ring" as const, tier: "rare" as const },
      boots: { slot: "boots" as const, tier: "rare" as const },
    },
    bag: [{ slot: "amulet" as const, tier: "rare" as const }],
  };
  const outcome = stageEquip("shadow", draft, 0);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  const names = [
    gearItemName("shadow" as ArchetypeId, "weapon", "legendary")!,
    gearItemName("shadow" as ArchetypeId, "ring", "rare")!,
    gearItemName("shadow" as ArchetypeId, "boots", "rare")!,
  ];
  assert.equal(outcome.reason, attunementFullReason(names));
  assert.match(outcome.reason, /You can be attuned to three magic items at once/);
});

test("stageUnequip empties an accessory slot and restores a drawn role's own common piece", () => {
  const base = draftFromSheet(gearSheet("knight"));
  const draft = {
    equipment: { ...base.equipment, weapon: { slot: "weapon" as const, tier: "rare" as const }, ring: { slot: "ring" as const, tier: "uncommon" as const } },
    bag: [],
  };
  const un1 = stageUnequip("knight", draft, "weapon");
  assert.ok(un1.ok);
  if (un1.ok) {
    assert.equal(un1.draft.equipment.weapon?.tier, "common", "a drawn role reverts to its own common piece");
    assert.deepEqual(un1.draft.bag.at(-1), { slot: "weapon", tier: "rare" }, "unequip appends to the end of the bag");
  }
  const un2 = stageUnequip("knight", draft, "ring");
  assert.ok(un2.ok);
  if (un2.ok) assert.equal(un2.draft.equipment.ring, undefined, "an empty accessory slot has no common piece to revert to");

  assert.equal(stageUnequip("knight", draft, "outer").ok, false, "a common piece cannot be unequipped");
  assert.equal(stageUnequip("knight", draft, "amulet").ok, false, "an empty slot cannot be unequipped");
});

test("commitLoadout refuses a draft that invents or destroys an owned item, returning the sheet unchanged", () => {
  const sheet = gearSheet("medic");
  const draft = draftFromSheet(sheet);
  const invented = { ...draft, bag: [...draft.bag, { slot: "weapon" as const, tier: "legendary" as const }] };
  assert.equal(commitLoadout(sheet, invented), sheet, "a draft that creates an item from nothing must not be written");
});

test("commitLoadout writes equipment and bag from a legitimate draft, and nothing else on the sheet", () => {
  // The uncommon weapon has to already be OWNED by the sheet (here, sitting
  // in its bag) before staging: commitLoadout refuses a draft that invents
  // an item, so a test draft has to earn its item the same way loot does.
  const sheet = { ...gearSheet("medic"), bag: [{ slot: "weapon" as const, tier: "uncommon" as const }] };
  const draft = draftFromSheet(sheet);
  const staged = stageEquip("medic", draft, 0);
  assert.ok(staged.ok);
  if (!staged.ok) return;
  const committed = commitLoadout(sheet, staged.draft);
  assert.equal(committed.equipment?.weapon?.tier, "uncommon");
  assert.equal(committed.name, sheet.name, "nothing else on the sheet moved");
  assert.notEqual(committed, sheet, "a legitimate commit is a new object");
});

test("attunedRoles is bad-blob safe: only the first MAX_ATTUNED_ITEMS in GEAR_ROLES order count as attuned", () => {
  const equipment = {
    weapon: { slot: "weapon" as const, tier: "legendary" as const },
    crown: { slot: "crown" as const, tier: "rare" as const }, // the Shadow's crown is save-kind
    ring: { slot: "ring" as const, tier: "rare" as const },
    amulet: { slot: "amulet" as const, tier: "rare" as const },
    boots: { slot: "boots" as const, tier: "rare" as const },
  };
  const attuned = attunedRoles("shadow", equipment);
  assert.equal(attuned.length, MAX_ATTUNED_ITEMS);
  assert.deepEqual(attuned, ["weapon", "crown", "ring"], "GEAR_ROLES order, first three only");
});

test("gearChangeBlockedReason checks dead, then down, then hostiles, in that order", () => {
  assert.match(gearChangeBlockedReason({ name: "Bram", downed: true, stable: false, dead: true }, true)!, /is gone/);
  assert.equal(
    gearChangeBlockedReason({ name: "Bram", downed: true, stable: false, dead: false }, true),
    "You are on the floor. Gear changes wait until you are back on your feet.",
  );
  assert.equal(
    gearChangeBlockedReason({ name: "Bram", downed: false, stable: false, dead: false }, true),
    "Not with something still in the room. Look all you like; gear changes wait until the fight is over.",
  );
  assert.equal(gearChangeBlockedReason({ name: "Bram", downed: false, stable: false, dead: false }, false), null);
});

test("loot: the pinned worked example -- rng [0.87, 0.5] on a fresh character rolls a rare Ring of Protection", () => {
  const sheet = gearSheet("knight");
  const seq = [0.87, 0.5];
  let i = 0;
  const rng = () => seq[i++]!;
  const { sheet: next, roll } = lootFor(sheet, { source: "fight", cx: 0, cy: 0 }, rng);
  assert.ok(roll);
  assert.equal(roll!.tierRoll, 88);
  assert.equal(roll!.tier, "rare");
  assert.equal(roll!.eligible.length, 6, "every one of the six roles has a rare rung, and none is owned yet");
  assert.equal(roll!.slotDie, 6);
  assert.equal(roll!.slotRoll, 4);
  assert.deepEqual(roll!.item, { slot: "ring", tier: "rare" });
  assert.equal(gearItemName("knight" as ArchetypeId, "ring", "rare"), "Ring of Protection");
  assert.deepEqual((next as unknown as { bag: unknown }).bag, [{ slot: "ring", tier: "rare" }]);
});

test("loot: LOOT_ROLLS_PER_CELL caps rolls per cell; past it, no rng call and no new roll", () => {
  const sheet = gearSheet("shadow");
  const at = { source: "container" as const, cx: 2, cy: -3 };
  const r1 = lootFor(sheet, at, () => 0.5);
  const r2 = lootFor(r1.sheet, at, () => 0.5);
  assert.ok(r1.roll && r2.roll, "the first two rolls in a cell should both roll");
  let called = false;
  const r3 = lootFor(r2.sheet, at, () => {
    called = true;
    return 0.5;
  });
  assert.equal(r3.roll, null, "a third roll in the same cell finds nothing to roll for");
  assert.equal(called, false, "past the cap makes no rng call at all");
  assert.equal(r3.sheet, r2.sheet, "the sheet is returned unchanged, same object");
});

test("lootDmNote matches the pinned words for a find and for nothing", () => {
  const found: LootRoll = { source: "fight", tierRoll: 88, tier: "rare", eligible: ["ring"], slotDie: 0, slotRoll: null, item: { slot: "ring", tier: "rare" } };
  assert.equal(
    lootDmNote(found, "Ring of Protection", "the fight"),
    "the engine rolled loot from the fight: Ring of Protection (rare) is now in the player's pack. Narrate the find. The item and its quality are already decided; do not name a different one.",
  );
  const nothing: LootRoll = { source: "container", tierRoll: 12, tier: null, eligible: [], slotDie: 0, slotRoll: null, item: null };
  assert.equal(
    lootDmNote(nothing, null, "the chest"),
    "the engine rolled loot from the chest and nothing magical turned up. Describe ordinary odds and ends if you like, never a magic item.",
  );
});

test("lootLine matches the pinned words for all four rolled cases", () => {
  const nothing: LootRoll = { source: "fight", tierRoll: 23, tier: null, eligible: [], slotDie: 0, slotRoll: null, item: null };
  assert.equal(lootLine(nothing, null), "Loot: d100 = 23, nothing of value.");

  const twoDice: LootRoll = {
    source: "fight",
    tierRoll: 88,
    tier: "rare",
    eligible: ["weapon", "outer", "crown", "ring", "amulet", "boots"],
    slotDie: 6,
    slotRoll: 4,
    item: { slot: "ring", tier: "rare" },
  };
  assert.equal(lootLine(twoDice, "Ring of Protection"), "Loot: d100 = 88, rare. d6 = 4: Ring of Protection, into your pack.");

  const oneDie: LootRoll = { ...twoDice, eligible: ["ring"], slotDie: 0, slotRoll: null };
  assert.equal(lootLine(oneDie, "Ring of Protection"), "Loot: d100 = 88, rare: Ring of Protection, into your pack.");

  const zeroEligible: LootRoll = { ...twoDice, eligible: [], slotDie: 0, slotRoll: null, item: null };
  assert.equal(lootLine(zeroEligible, null), "Loot: d100 = 88, rare, but you already have every rare piece there is.");
});

test("accessoryCopy states every accessory effect's real magnitude, never an unapplied one", () => {
  assert.match(accessoryCopy("ring", "rare", 30), /\+1 armour class and \+1 on every saving throw/);
  assert.match(accessoryCopy("amulet", "rare", 30), /\+1 on every skill check and every saving throw/);
  assert.match(accessoryCopy("boots", "uncommon", 30), /Advantage on Stealth checks/);
  assert.match(accessoryCopy("boots", "rare", 30), /Double walking speed in a fight: 30 feet becomes 60/);
  assert.match(accessoryCopy("amulet", "uncommon", 30), /heals twice as much/);
  assert.match(accessoryCopy("ring", "uncommon", 30), /3 charges; a long rest brings back 1d3/);
  assert.match(accessoryCopy("ring", "legendary", 30), /restores 6d6 hit points/);
  assert.equal(accessoryCopy("boots", "common", 30), "No effect. These are the boots you started in.");
});

test("the glossary teaches rarity and attunement again now that loot can grant it (issue #15)", () => {
  const rarity = explain("rarity");
  assert.ok(rarity, "the About panel dropped the rarity entry");
  assert.match(rarity!, /common/i);
  assert.match(rarity!, /uncommon/i);
  assert.match(rarity!, /\brare\b/i);
  assert.match(rarity!, /legendary/i);
  const attunement = explain("attunement");
  assert.ok(attunement, "the About panel is missing the attunement entry");
  assert.match(attunement!, /three/i);
});

test("checkLine names the item granting advantage, when one is supplied", () => {
  const withAdvantage = checkLine({
    roller: "Nix",
    what: "Stealth",
    roll: 17,
    modifier: 5,
    total: 22,
    dc: 15,
    success: true,
    advantageFrom: "Boots of Elvenkind",
  });
  assert.match(withAdvantage, /rolled 17 with advantage from Boots of Elvenkind, \+5 = 22/);
  const without = checkLine({ roller: "Nix", what: "Stealth", roll: 17, modifier: 5, total: 22, dc: 15, success: true });
  assert.match(without, /^Nix, Stealth: rolled 17, \+5 = 22/, "with no advantage the line is byte-identical to before");
});
