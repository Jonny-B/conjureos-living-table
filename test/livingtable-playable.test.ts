/**
 * What a player can start: owner decision 2026-09-30. The art is moving to
 * Kay Lousberg's free KayKit packs, which have a knight, a rogue and a mage
 * but no cleric and no sci-fi characters, so sci-fi is paused and the Healer
 * is out of play. They stay defined and still load; they cannot be picked.
 * Changing what is playable is a product decision, so it should take editing
 * this test, not happen as a side effect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES, PLAYABLE_TEMPLATES, getArchetype, playableArchetypes } from "../src/games/livingtable/characters/templates";
import { createCharacter } from "../src/games/livingtable/characters/creation";
import { bodySpriteId } from "../src/games/livingtable/characters/equipmentTypes";

test("only the fantasy template can be started", () => {
  assert.deepEqual([...PLAYABLE_TEMPLATES], ["fantasy"]);
  assert.deepEqual(playableArchetypes("scifi"), []);
});

test("fantasy offers the knight, the shadow and the wizard, and not the healer", () => {
  assert.deepEqual(
    playableArchetypes("fantasy").map((a) => a.id),
    ["knight", "shadow", "fireball-person"],
  );
});

test("paused and out-of-play archetypes are still defined and still build a sheet", () => {
  for (const id of ["healer", "trooper", "infiltrator", "medic", "psion"]) {
    assert.ok(ARCHETYPES.some((a) => a.id === id), `${id} is still defined`);
    assert.equal(getArchetype(id).id, id);
    const sheet = createCharacter({ archetypeId: id, name: "Stored", appearanceAssetId: bodySpriteId(id as never) });
    assert.equal(sheet.archetypeId, id);
  }
});
