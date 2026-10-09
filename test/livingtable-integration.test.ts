/**
 * Tests for the engine pieces the table window shares: the combat and skill
 * modifier helpers (session/combat.ts) and the games-db wire-shape adapter
 * (assets/manifestCache.ts), with the door flag and the wall-profile art that
 * adapter has to keep straight.
 *
 * Run: npx tsx --test test/livingtable-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { attackerBonusFor, weaponDamageNotationFor, modifierForRollRequest, skillModifierFor, saveModifierFor, DEFAULT_MONSTER_ATTACK_MODIFIER, DEFAULT_MONSTER_SAVE_MODIFIER } from "../src/games/livingtable/session/combat";
import { adaptManifest, adaptPalette } from "../src/games/livingtable/assets/manifestCache";

import { CELL_HEIGHT, CELL_WIDTH, emptyWorld, placeToken, placeProp, setCell, setDoorState, validateLayout, type CellLayout } from "../src/games/livingtable/world";
import { MOCK_LT_ASSETS } from "../src/bridge/gamesApi";
import { SPRITES as FANTASY_ASSETS } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI_ASSETS } from "../scripts/assets/scifi";
import { createCharacter } from "../src/games/livingtable/characters/creation";

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
  assert.deepEqual(adapted.world.tiles.floor_grass, { walkable: true, opaque: false });
  assert.deepEqual(adapted.world.tiles.wall_stone, { walkable: false, opaque: true });
  assert.ok("token_knight" in adapted.world.tokens);
  assert.ok("chest" in adapted.world.props);
  assert.deepEqual(adapted.render.tiles.floor_grass, { pixels: [[0]] });
  assert.deepEqual(adapted.availableAssetIds, { tiles: ["floor_grass", "wall_stone"], tokens: ["token_knight"], props: ["chest"] });
  assert.equal(adapted.render.palette[0], "#000000");
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
  assert.deepEqual(adapted.world.props.door_closed, { blocks: true, opaque: true });
  assert.deepEqual(adapted.world.props.door_open, { blocks: false, opaque: false }, "an open door must not block, or opening it changes nothing");
  assert.deepEqual(adapted.world.props.torch, { blocks: false, opaque: false });
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
  assert.deepEqual(adapted.world.tiles.wall_stone, { walkable: false, opaque: true });
  assert.deepEqual(adapted.world.props.door_closed, { blocks: true, opaque: true });
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
