/**
 * Tests for The Living Table's character templates and creation
 * (src/games/livingtable/characters).
 *
 * The load-bearing claim under test is DESIGN.md's "same engine, same
 * tactical rules": eight archetypes sharing four chassis two at a time still
 * have to be eight genuinely different characters, not four characters with
 * two names each. Everything else here is the standard "does the math
 * actually run" coverage: positive HP, a sensible AC, HP that only ever goes
 * up on level-up, and every plain-language option carrying its real
 * mechanical effect alongside it, never instead of it.
 *
 * Run: npx tsx --test test/livingtable-characters.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES, PLAYABLE_ARCHETYPE_IDS, getArchetype } from "../src/games/livingtable/characters/templates";
import { ARCHETYPE_LABEL } from "../src/games/livingtable/table/state";
import { createCharacter, creationChoicesFor, normalizeSheet, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { addMilestone, applyLevelUpChoice, canLevelUp, levelUpChoices, milestonesRemaining, MILESTONES_PER_LEVEL } from "../src/games/livingtable/characters/leveling";
import { applyDamage, applyDeathSave, applyHealing, longRest, longRestBlockedReason, newAdventuringDay, shortRest, shortRestBlockedReason } from "../src/games/livingtable/characters/health";
import { abilityModifier, computeAC, type ArmorCategory } from "../src/games/livingtable/rules";
import { SLOT_ROLES, STARTING_LOADOUT } from "../src/games/livingtable/characters/equipmentTypes";
import { equipItem, equippableTiers, gearView } from "../src/games/livingtable/menu/equipment";
import { commitLoadout, draftFromSheet, stageEquip } from "../src/games/livingtable/rules/inventory";
import { lootFor } from "../src/games/livingtable/rules/loot";
import { CAMPAIGN_PLANNING_SUB, GAME_TAGLINE } from "../src/games/livingtable/menu/labels";
import { join } from "node:path";

// ── helpers ─────────────────────────────────────────────────────────────

/** Build a character for one archetype with every choice defaulted, the same "no unmade choice blocks creation" path createCharacter guarantees. */
function makeDefault(archetypeId: string, name = "Test Hero"): CharacterSheet {
  return createCharacter({ archetypeId, name, appearanceAssetId: "sprite-01" });
}

/**
 * The numeric slice of a character sheet that "same stat block" actually
 * means: ability scores, HP, AC, and every computed skill/save bonus. Name,
 * archetype id, and flavour text are deliberately excluded -- two archetypes
 * with identical numbers but different names would still be the "reskin with
 * no mechanical difference" DESIGN.md's chassis table is explicitly not.
 */
function numericSignature(sheet: CharacterSheet): string {
  return JSON.stringify({
    abilities: sheet.abilities,
    maxHp: sheet.maxHp,
    armorClass: sheet.armorClass,
    proficiencyBonus: sheet.proficiencyBonus,
    skills: sheet.skills,
    saves: sheet.saves,
    spellSlots: sheet.spellSlots,
  });
}

// ── templates.ts ────────────────────────────────────────────────────────

test("the three playable classes are called Knight, Rogue and Mage; the ids stay as they were (item 6)", () => {
  assert.deepEqual(
    PLAYABLE_ARCHETYPE_IDS.map((id) => [id, ARCHETYPE_LABEL[id as keyof typeof ARCHETYPE_LABEL], getArchetype(id).displayName]),
    [
      ["knight", "Knight", "The Knight"],
      ["shadow", "Rogue", "The Rogue"],
      ["fireball-person", "Mage", "The Mage"],
    ],
  );
  // Nothing a player reads still uses the old names.
  for (const a of ARCHETYPES) assert.doesNotMatch(a.displayName, /Shadow|Fireball/);
});

test("normalizeSheet refreshes a stored class name, so an old save no longer says Shadow (item 6)", () => {
  for (const [id, old, now] of [["shadow", "The Rogue", "The Rogue"], ["fireball-person", "The Mage", "The Mage"]] as const) {
    const sheet = makeDefault(id);
    const stored = { ...sheet, displayName: old } as CharacterSheet;
    assert.equal(normalizeSheet(stored).displayName, now, id);
    assert.equal(normalizeSheet(sheet).displayName, now, id);
  }
  // A sheet whose class is unknown to this build keeps what it had.
  const odd = { ...makeDefault("knight"), archetypeId: "from-the-future", displayName: "The Oddity" } as CharacterSheet;
  assert.equal(normalizeSheet(odd).displayName, "The Oddity");
});

test("there are exactly eight archetypes, four fantasy and four sci-fi", () => {
  assert.equal(ARCHETYPES.length, 8);
  assert.equal(ARCHETYPES.filter((a) => a.template === "fantasy").length, 4);
  assert.equal(ARCHETYPES.filter((a) => a.template === "scifi").length, 4);
});

test("each of the four chassis is used by exactly one fantasy and one sci-fi archetype", () => {
  for (const chassis of ["fighter", "rogue", "cleric", "wizard"] as const) {
    const matching = ARCHETYPES.filter((a) => a.chassis === chassis);
    assert.equal(matching.length, 2, `expected exactly 2 archetypes on the ${chassis} chassis`);
    assert.deepEqual(
      matching.map((a) => a.template).sort(),
      ["fantasy", "scifi"],
      `expected the ${chassis} chassis to cover one fantasy and one sci-fi archetype`,
    );
  }
});

test("getArchetype rejects an unknown id", () => {
  assert.throws(() => getArchetype("not-a-real-archetype"), /unknown archetype id/);
});

// ── createCharacter: per-archetype validity ─────────────────────────────

for (const archetype of ARCHETYPES) {
  test(`createCharacter(${archetype.id}) produces positive max HP and a sensible AC`, () => {
    const sheet = makeDefault(archetype.id);
    assert.ok(sheet.maxHp > 0, `${archetype.id}: maxHp should be positive, got ${sheet.maxHp}`);
    assert.equal(sheet.currentHp, sheet.maxHp);
    // A level-1 SRD 5.1 character's AC realistically lands between "no armor,
    // negative DEX" (as low as 8) and "heavy armor plus a shield plus a
    // fighting style" (as high as ~19); anything outside that band would mean
    // the armor table or the fighting-style bonus is wired up wrong.
    assert.ok(sheet.armorClass >= 8 && sheet.armorClass <= 20, `${archetype.id}: AC ${sheet.armorClass} is not in a sensible range`);
  });
}

// ── AC is computeAC's real output, not a private re-derivation ───────────
//
// Before this test (and before creation.ts called computeAC), armorClass
// was built by a hand-rolled `dexBonusForArmor` helper that reimplemented
// the exact DEX-cap rule rules/armorClass.ts's computeAC already owned and
// tests -- two implementations of the same SRD math that could silently
// drift apart. This test builds the expected AC by calling the real
// `computeAC` directly with each chassis's known armor category, so it only
// passes if createCharacter is actually delegating to computeAC, not just
// happening to produce the same numbers today.

/** Each launch chassis's starting armor category and base AC, matching creation.ts's ARMOR_BY_CHASSIS -- declared independently here so this test proves createCharacter's number equals computeAC's, not just equals itself. */
const ARMOR_CATEGORY_BY_CHASSIS: Record<string, { category: ArmorCategory; base: number }> = {
  fighter: { category: "heavy", base: 16 },
  rogue: { category: "light", base: 11 },
  cleric: { category: "medium", base: 15 },
  wizard: { category: "unarmored", base: 10 },
};

test("createCharacter's AC equals computeAC's output for that chassis's armor and DEX modifier", () => {
  for (const archetype of ARCHETYPES) {
    const sheet = makeDefault(archetype.id);
    const dexModifier = abilityModifier(archetype.baseAbilityScores.dex);
    const armor = ARMOR_CATEGORY_BY_CHASSIS[archetype.chassis]!;
    let expected = computeAC({ baseArmor: { category: armor.category, base: armor.base }, dexModifier });
    // Fighter chassis defaults to the "defense" fighting style (the first
    // option fightingStyleOptionsFor offers every fighter-chassis archetype),
    // the one style with an always-on flat +1 AC bonus while armored -- see
    // createCharacter's own comment on why Dueling/Archery aren't baked in.
    if (archetype.chassis === "fighter") expected += 1;
    assert.equal(
      sheet.armorClass,
      expected,
      `${archetype.id}: expected computeAC-derived AC ${expected}, got ${sheet.armorClass} -- ` +
        `creation.ts's armor math may have drifted from rules/armorClass.ts's computeAC`,
    );
  }
});

test("createCharacter rejects a blank name", () => {
  assert.throws(() => createCharacter({ archetypeId: "knight", name: "   ", appearanceAssetId: "sprite-01" }), /needs a name/);
});

test("createCharacter rejects a blank appearance", () => {
  assert.throws(() => createCharacter({ archetypeId: "knight", name: "Aldric", appearanceAssetId: "" }), /needs an appearance/);
});

test("createCharacter rejects an expertise choice that isn't one of the archetype's own skills", () => {
  assert.throws(
    () => createCharacter({ archetypeId: "shadow", name: "Vex", appearanceAssetId: "sprite-01", choices: { expertiseSkill: "Arcana" } }),
    /not one of this archetype's starting skills/,
  );
});

test("createCharacter rejects an unknown fighting style", () => {
  assert.throws(
    () => createCharacter({ archetypeId: "knight", name: "Aldric", appearanceAssetId: "sprite-01", choices: { fightingStyle: "berserk" } }),
    /not a fighting style option/,
  );
});

// ── distinctness: the actual claim DESIGN.md's chassis table makes ─────

test("all 8 archetypes produce numerically distinct stat blocks", () => {
  const signatures = ARCHETYPES.map((a) => numericSignature(makeDefault(a.id)));
  const distinct = new Set(signatures);
  assert.equal(distinct.size, ARCHETYPES.length, "two archetypes produced an identical numeric stat block");
});

test("all 8 archetypes have a distinct kitDescription", () => {
  // The numeric signature above proves the stat blocks differ; this proves
  // the one sentence a newcomer actually reads during the under-two-minutes
  // flow differs too. A chassis-pair sharing this sentence word for word is
  // the "thin reskin in name only" failure the chassis table is meant to avoid.
  const descriptions = ARCHETYPES.map((a) => a.kitDescription);
  const distinct = new Set(descriptions);
  assert.equal(distinct.size, ARCHETYPES.length, "two archetypes shared an identical kitDescription");
});

test("Knight and Trooper (both Fighter) differ mechanically despite sharing a chassis", () => {
  const knight = makeDefault("knight");
  const trooper = makeDefault("trooper");
  assert.notDeepEqual(knight.abilities, trooper.abilities);
  // Same hit die, same class math -- proving the chassis really is shared.
  assert.equal(knight.hitDieSides, trooper.hitDieSides);
  assert.equal(knight.proficiencyBonus, trooper.proficiencyBonus);
});

// ── creationChoicesFor: the "under two minutes" budget ──────────────────

test("Fighter chassis archetypes offer exactly one creation choice: a fighting style", () => {
  for (const id of ["knight", "trooper"]) {
    const choices = creationChoicesFor(id);
    assert.equal(choices.length, 1);
    assert.equal(choices[0]!.id, "fightingStyle");
    assert.ok(choices[0]!.options.length >= 2);
  }
});

test("the Trooper's fighting-style options never include Dueling, because its kit (plasma rifle, combat vest, frag grenades, field kit) has no one-handed melee weapon Dueling's bonus could ever apply to", () => {
  const options = creationChoicesFor("trooper")[0]!.options;
  assert.deepEqual(
    options.map((o) => o.id).sort(),
    ["archery", "defense"],
  );
});

test("the Knight's fighting-style options still include Dueling, because its kit (longsword + shield) genuinely supports it", () => {
  const options = creationChoicesFor("knight")[0]!.options;
  assert.deepEqual(
    options.map((o) => o.id).sort(),
    ["archery", "defense", "dueling"],
  );
});

test("createCharacter rejects Dueling for the Trooper even if forced through the choices input directly, not just hidden from the option list", () => {
  assert.throws(
    () => createCharacter({ archetypeId: "trooper", name: "Rook", appearanceAssetId: "sprite-01", choices: { fightingStyle: "dueling" } }),
    /not a fighting style option for this archetype's kit/,
  );
});

test("Rogue chassis archetypes offer exactly one creation choice: an expertise skill, scoped to that archetype's own skills", () => {
  for (const id of ["shadow", "infiltrator"]) {
    const archetype = getArchetype(id);
    const choices = creationChoicesFor(id);
    assert.equal(choices.length, 1);
    assert.equal(choices[0]!.id, "expertiseSkill");
    assert.deepEqual(
      choices[0]!.options.map((o) => o.id).sort(),
      [...archetype.startingProficiencies.skills].sort(),
    );
  }
});

test("Cleric and Wizard chassis archetypes offer no creation choice", () => {
  for (const id of ["healer", "medic", "fireball-person", "psion"]) {
    assert.deepEqual(creationChoicesFor(id), []);
  }
});

test("every creation choice option carries both a technical and a plain description", () => {
  for (const archetype of ARCHETYPES) {
    for (const choice of creationChoicesFor(archetype.id)) {
      for (const option of choice.options) {
        assert.ok(option.technical.trim().length > 0, `${archetype.id}/${choice.id}/${option.id} missing a technical description`);
        assert.ok(option.plain.trim().length > 0, `${archetype.id}/${choice.id}/${option.id} missing a plain description`);
      }
    }
  }
});

test("picking a fighting style actually changes the sheet: Defense adds +1 AC over the same character without it", () => {
  const plain = createCharacter({ archetypeId: "knight", name: "A", appearanceAssetId: "s", choices: { fightingStyle: "dueling" } });
  const defensive = createCharacter({ archetypeId: "knight", name: "A", appearanceAssetId: "s", choices: { fightingStyle: "defense" } });
  assert.equal(defensive.armorClass, plain.armorClass + 1);
});

test("picking an expertise skill doubles that skill's proficiency bonus over a non-expertise skill", () => {
  const sheet = createCharacter({ archetypeId: "shadow", name: "A", appearanceAssetId: "s", choices: { expertiseSkill: "Stealth" } });
  const stealth = sheet.skills.find((s) => s.skill === "Stealth")!;
  const other = sheet.skills.find((s) => s.skill !== "Stealth")!;
  assert.equal(stealth.expertise, true);
  assert.equal(stealth.bonus, sheet.modifiers[stealth.ability] + sheet.proficiencyBonus * 2);
  assert.equal(other.expertise, false);
  assert.equal(other.bonus, sheet.modifiers[other.ability] + sheet.proficiencyBonus);
});

test("createCharacter's applied expertise effect matches creationChoicesFor's own option text word for word, so the two paths can't drift apart unnoticed", () => {
  const sheet = createCharacter({ archetypeId: "shadow", name: "A", appearanceAssetId: "s", choices: { expertiseSkill: "Stealth" } });
  const offered = creationChoicesFor("shadow")[0]!.options.find((o) => o.id === "Stealth")!;
  const applied = sheet.appliedEffects[0]!;
  assert.equal(applied.technical, offered.technical);
  assert.equal(applied.plain, offered.plain);
});

// ── spell slots: only the two caster chassis get them ───────────────────

test("caster chassis (Cleric, Wizard) start with non-null spell slots; Fighter and Rogue start with null", () => {
  for (const id of ["healer", "medic", "fireball-person", "psion"]) {
    assert.notEqual(makeDefault(id).spellSlots, null, `${id} should have spell slots`);
  }
  for (const id of ["knight", "trooper", "shadow", "infiltrator"]) {
    assert.equal(makeDefault(id).spellSlots, null, `${id} should not have spell slots`);
  }
});

// ── leveling.ts ───────────────────────────────────────────────────────

for (const archetype of ARCHETYPES) {
  test(`levelUpChoices(${archetype.id}) from 1 to 2 raises max HP and never lowers it`, () => {
    const level1 = makeDefault(archetype.id);
    const { character: level2 } = levelUpChoices(level1, 2);
    assert.ok(level2.maxHp > level1.maxHp, `${archetype.id}: expected level 2 maxHp (${level2.maxHp}) > level 1 maxHp (${level1.maxHp})`);
    assert.equal(level2.currentHp, level1.currentHp + (level2.maxHp - level1.maxHp));
  });

  test(`levelUpChoices(${archetype.id}) from 2 to 3 also raises max HP and never lowers it`, () => {
    const level1 = makeDefault(archetype.id);
    const { character: level2 } = levelUpChoices(level1, 2);
    const { character: level3 } = levelUpChoices(level2, 3);
    assert.ok(level3.maxHp > level2.maxHp, `${archetype.id}: expected level 3 maxHp (${level3.maxHp}) > level 2 maxHp (${level2.maxHp})`);
  });
}

test("every levelUpChoices changes entry and every branch-choice option has both a technical and a plain description", () => {
  for (const archetype of ARCHETYPES) {
    const level1 = makeDefault(archetype.id);
    const level2Outcome = levelUpChoices(level1, 2);
    const level3Outcome = levelUpChoices(level2Outcome.character, 3);

    for (const outcome of [level2Outcome, level3Outcome]) {
      assert.ok(outcome.changes.length > 0, `${archetype.id}: expected at least one change entry`);
      for (const change of outcome.changes) {
        assert.ok(change.technical.trim().length > 0, `${archetype.id}: change missing technical text`);
        assert.ok(change.plain.trim().length > 0, `${archetype.id}: change missing plain text`);
      }
      if (outcome.choice) {
        for (const option of outcome.choice.options) {
          assert.ok(option.technical.trim().length > 0, `${archetype.id}: branch option missing technical text`);
          assert.ok(option.plain.trim().length > 0, `${archetype.id}: branch option missing plain text`);
        }
      }
    }
  }
});

test("only the Fighter chassis presents a level-3 branch choice; Rogue/Cleric/Wizard just apply the numbers", () => {
  for (const archetype of ARCHETYPES) {
    const level1 = makeDefault(archetype.id);
    const { character: level2 } = levelUpChoices(level1, 2);
    const { choice } = levelUpChoices(level2, 3);
    if (archetype.chassis === "fighter") {
      assert.ok(choice, `${archetype.id}: expected a level-3 branch choice`);
      assert.equal(choice!.id, "martialArchetype");
    } else {
      assert.equal(choice, null, `${archetype.id}: expected no level-3 branch choice`);
    }
  }
});

test("levelUpChoices raises proficiency bonus at level 5 and recomputes skill/save bonuses to match", () => {
  const level1 = makeDefault("knight");
  const { character: level2 } = levelUpChoices(level1, 2);
  const { character: level3 } = levelUpChoices(level2, 3);
  const { character: level5 } = levelUpChoices(level3, 5);
  assert.equal(level5.proficiencyBonus, 3);
  for (const skill of level5.skills) {
    assert.equal(skill.bonus, level5.modifiers[skill.ability] + level5.proficiencyBonus * (skill.expertise ? 2 : 1));
  }
  for (const save of level5.saves) {
    assert.equal(save.bonus, level5.modifiers[save.ability] + level5.proficiencyBonus);
  }
});

test("levelUpChoices keeps a caster's spell slots in sync with the new level", () => {
  const level1 = makeDefault("fireball-person");
  assert.deepEqual(level1.spellSlots, { 1: { max: 2, used: 0 } });
  const { character: level3 } = levelUpChoices(levelUpChoices(level1, 2).character, 3);
  assert.deepEqual(level3.spellSlots, { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } });
});

// ── the Item verb has something to spend, for every archetype ───────────
//
// The failure this guards, measured across all eight archetypes through the
// real createCharacter: the item-usable inventory was Knight none, Rogue
// none, Healer none, Mage none, Psion none. Only three archetypes
// carried anything the old name-substring heuristic matched, which means one
// of the five command-menu verbs was guaranteed to fail for the entire
// Fantasy template -- and the failure message advised using a potion that
// could not exist in the player's game, because Search returned no loot.

test("every archetype starts with at least one consumable that actually does something", () => {
  for (const archetype of ARCHETYPES) {
    const sheet = makeDefault(archetype.id);
    const usable = sheet.consumables.filter((c) => c.uses > 0);
    assert.ok(usable.length > 0, `${archetype.id} reaches the table with nothing the Item verb can spend`);
    for (const item of usable) {
      assert.equal(item.effect, "heal");
      assert.ok(item.description.trim().length > 10, `${archetype.id}/${item.name} needs a real description for its button`);
    }
  }
});

test("a disguise kit is gear, not medicine: healing is a property of the item, not a substring of its name", () => {
  // isHealingItem matched on "kit", so the Infiltrator's Holo-disguise kit
  // restored hit points. Consumables are now declared per archetype, and the
  // disguise kit is not one of them.
  const infiltrator = makeDefault("infiltrator");
  assert.ok(infiltrator.inventory.includes("Holo-disguise kit"), "the disguise kit should still be carried gear");
  assert.ok(
    !infiltrator.consumables.some((c) => /disguise/i.test(c.name)),
    "a disguise kit must not be usable as healing",
  );
});

// ── death saves: what happens at 0 hit points ───────────────────────────
//
// Before this, `Math.max(0, ...)` was the entire zero-HP story. A probe drove
// the Knight to 0 HP and then ran the attack path: it rolled 20+4 and reported
// HIT. A healing item at 0 HP healed 3 and the character walked on, with no
// stabilise check ever occurring.

function downed(): CharacterSheet {
  const sheet = makeDefault("knight");
  const hit = applyDamage(sheet, sheet.maxHp);
  assert.equal(hit.sheet.currentHp, 0);
  assert.equal(hit.sheet.downed, true);
  assert.equal(hit.wentDown, true);
  return hit.sheet;
}

test("reaching exactly 0 hit points knocks a character down rather than leaving them standing at 0", () => {
  const sheet = downed();
  assert.equal(sheet.downed, true);
  assert.equal(sheet.stable, false);
  assert.equal(sheet.dead, false);
  assert.deepEqual(sheet.deathSaves, { successes: 0, failures: 0 });
});

test("three death-save successes stabilise, and stop the saves", () => {
  let sheet = downed();
  for (let i = 0; i < 3; i++) {
    sheet = applyDeathSave(sheet, { roll: 15, total: 15, success: true }).sheet;
  }
  assert.equal(sheet.stable, true);
  assert.equal(sheet.downed, false);
  assert.equal(sheet.dead, false);
  assert.equal(sheet.currentHp, 0);
});

test("three death-save failures end the character, and nothing about that is charged for", () => {
  let sheet = downed();
  for (let i = 0; i < 3; i++) {
    sheet = applyDeathSave(sheet, { roll: 4, total: 4, success: false }).sheet;
  }
  assert.equal(sheet.dead, true);
  assert.equal(sheet.downed, false);
});

test("a natural 20 on a death save puts the character back up at 1 hit point, per SRD 5.1", () => {
  const outcome = applyDeathSave(downed(), { roll: 20, total: 20, success: true });
  assert.equal(outcome.sheet.currentHp, 1);
  assert.equal(outcome.sheet.downed, false);
  assert.equal(outcome.backUp, true);
  assert.match(outcome.note, /Natural 20/);
});

test("a natural 1 on a death save counts as two failures, per SRD 5.1", () => {
  const outcome = applyDeathSave(downed(), { roll: 1, total: 1, success: false });
  assert.equal(outcome.sheet.deathSaves.failures, 2);
});

test("damage taken while down is itself a failed death save, and a critical hit is two", () => {
  assert.equal(applyDamage(downed(), 3).sheet.deathSaves.failures, 1);
  assert.equal(applyDamage(downed(), 3, true).sheet.deathSaves.failures, 2);
});

test("a hit while already on two failures ends it", () => {
  let sheet = downed();
  sheet = applyDeathSave(sheet, { roll: 1, total: 1, success: false }).sheet;
  const outcome = applyDamage(sheet, 3);
  assert.equal(outcome.sheet.dead, true);
  assert.equal(outcome.died, true);
});

test("healing a downed character brings them round and wipes the death-save tally", () => {
  const outcome = applyHealing(downed(), 4);
  assert.equal(outcome.sheet.currentHp, 4);
  assert.equal(outcome.sheet.downed, false);
  assert.deepEqual(outcome.sheet.deathSaves, { successes: 0, failures: 0 });
});

// ── rest: the free, non-AI way back up that had no surface at all ────────

test("a short rest spends one hit die and gives hit points back", () => {
  const hurt = { ...makeDefault("knight"), currentHp: 1 };
  const outcome = shortRest(hurt, () => 0.99);
  assert.ok(outcome.sheet.currentHp > 1, "a short rest should heal");
  assert.equal(outcome.sheet.hitDiceRemaining, hurt.hitDiceRemaining - 1);
  assert.match(outcome.note, /hit die spent/);
});

test("a short rest with no hit dice left is refused in words rather than silently doing nothing", () => {
  const spent = { ...makeDefault("knight"), currentHp: 1, hitDiceRemaining: 0 };
  const outcome = shortRest(spent);
  assert.equal(outcome.sheet, spent);
  assert.match(shortRestBlockedReason(spent) ?? "", /No hit dice left/);
});

test("a long rest is the only thing that gives a caster their spell slots back", () => {
  const drained: CharacterSheet = {
    ...makeDefault("fireball-person"),
    currentHp: 1,
    hitDiceRemaining: 0,
    spellSlots: { 1: { max: 2, used: 2 } },
  };
  const outcome = longRest(drained);
  assert.equal(outcome.sheet.currentHp, outcome.sheet.maxHp);
  assert.equal(outcome.sheet.hitDiceRemaining, outcome.sheet.level);
  assert.deepEqual(outcome.sheet.spellSlots, { 1: { max: 2, used: 0 } });
});

test("neither rest is available while dying: somebody has to bring you round first", () => {
  const down = downed();
  assert.match(shortRestBlockedReason(down) ?? "", /dying/);
  assert.match(longRestBlockedReason(down) ?? "", /dying/);
});

// ── levelling has to be earned, and the branch choice has to stick ───────
//
// Before this, "Level up" was permanently available and gated on nothing: three
// presses took a character from level 1 to the cap in under ten seconds without
// leaving the first room. And the level-3 branch was rendered as two paragraphs
// whose pick confirmLevelUp discarded entirely.

test("a fresh character cannot level up until the campaign has earned it", () => {
  const sheet = makeDefault("knight");
  assert.equal(canLevelUp(sheet, 3), false);
  assert.equal(milestonesRemaining(sheet), MILESTONES_PER_LEVEL);
});

test("milestones accumulate and then unlock exactly one level", () => {
  let sheet = makeDefault("knight");
  for (let i = 0; i < MILESTONES_PER_LEVEL; i++) sheet = addMilestone(sheet);
  assert.equal(canLevelUp(sheet, 3), true);

  const levelled = applyLevelUpChoice(levelUpChoices(sheet, 2), null);
  assert.equal(levelled.level, 2);
  assert.equal(levelled.milestones, 0, "levelling up spends the milestones that earned it");
  assert.equal(canLevelUp(levelled, 3), false, "one level per set of milestones, not three in ten seconds");
});

test("the level cap is still respected by canLevelUp even with milestones banked", () => {
  let sheet = { ...makeDefault("knight"), level: 3 };
  for (let i = 0; i < MILESTONES_PER_LEVEL; i++) sheet = addMilestone(sheet);
  assert.equal(canLevelUp(sheet, 3), false);
});

test("applyLevelUpChoice records the pick on the sheet and echoes it back in plain language", () => {
  let sheet = makeDefault("knight");
  for (let i = 0; i < MILESTONES_PER_LEVEL * 2; i++) sheet = addMilestone(sheet);
  const level2 = applyLevelUpChoice(levelUpChoices(sheet, 2), null);
  const outcome = levelUpChoices(level2, 3);
  assert.ok(outcome.choice, "level 3 on the fighter chassis presents a real branch");

  const level3 = applyLevelUpChoice(outcome, "battle-master");
  assert.equal(level3.choices.martialArchetype, "battle-master");
  const effect = level3.appliedEffects.find((e) => e.plain.startsWith("Battle Master:"));
  assert.ok(effect, `expected the pick in appliedEffects, got ${JSON.stringify(level3.appliedEffects)}`);
  assert.ok(effect!.technical.trim().length > 0);
});

test("a level-up that presents a choice cannot be applied without one being made", () => {
  let sheet = makeDefault("knight");
  for (let i = 0; i < MILESTONES_PER_LEVEL * 2; i++) sheet = addMilestone(sheet);
  const level2 = applyLevelUpChoice(levelUpChoices(sheet, 2), null);
  assert.throws(() => applyLevelUpChoice(levelUpChoices(level2, 3), null), /has to be made/);
  assert.throws(() => applyLevelUpChoice(levelUpChoices(level2, 3), "not-an-option"), /is not an option/);
});

test("levelling up hands back one hit die without refilling the ones already spent", () => {
  let sheet: CharacterSheet = { ...makeDefault("knight"), hitDiceRemaining: 0 };
  for (let i = 0; i < MILESTONES_PER_LEVEL; i++) sheet = addMilestone(sheet);
  const level2 = applyLevelUpChoice(levelUpChoices(sheet, 2), null);
  assert.equal(level2.hitDiceRemaining, 1);
});

// ── normalizeSheet: a campaign that predates all of the above ────────────

test("normalizeSheet fills in every field a stored sheet predates, so no tracker renders against undefined", () => {
  const legacy = makeDefault("knight") as CharacterSheet & Record<string, unknown>;
  delete legacy.deathSaves;
  delete legacy.downed;
  delete legacy.stable;
  delete legacy.dead;
  delete legacy.hitDiceRemaining;
  delete legacy.milestones;
  delete legacy.consumables;

  const fixed = normalizeSheet(legacy);
  assert.deepEqual(fixed.deathSaves, { successes: 0, failures: 0 });
  assert.equal(fixed.downed, false);
  assert.equal(fixed.stable, false);
  assert.equal(fixed.dead, false);
  assert.equal(fixed.hitDiceRemaining, fixed.level);
  assert.equal(fixed.milestones, 0);
  assert.deepEqual(fixed.consumables, []);
});

// ── the choice pills: a number, or an honest "not yet" ───────────────────
//
// Two cold readers made four build decisions off these strings and got zero
// right, and both blamed the same thing: "Every other pill on this screen
// also has no number, so I'm choosing between three vibes." The level-up
// preview card was the one thing both praised ("8 more health, so you can
// take more hits before going down"), so the invariant below is that voice
// applied to every choice: state the real number, or say the build does not
// apply this one yet. Never a present-tense effect with neither.

test("no choice option describes an effect with neither a number nor a 'not yet' label", () => {
  for (const archetype of ARCHETYPES) {
    for (const choice of creationChoicesFor(archetype.id)) {
      for (const option of choice.options) {
        const quantified = /\d/.test(option.plain);
        assert.ok(
          quantified || option.notYet,
          `"${option.label}" on ${archetype.id} is three vibes: ${JSON.stringify(option.plain)}`,
        );
      }
    }
  }
});

test("Defense states the +1 armour class it actually applies", () => {
  const [style] = creationChoicesFor("knight");
  const defense = style!.options.find((o) => o.id === "defense")!;
  assert.match(defense.plain, /\+1/);
  assert.match(defense.plain, /armour class/i);
  assert.equal(defense.notYet, undefined, "Defense IS applied: createCharacter adds the point to AC");
});

test("Dueling and Archery state the numbers the combat math now actually applies", () => {
  // These two were labels attached to nothing when the blind evaluation ran,
  // and both judges spent their only build decision on one of them. The rules
  // lane has since wired both (session/combat.ts's duelingBonusFor and
  // archeryBonusFor), so the copy states the real bonus rather than a caveat.
  const [style] = creationChoicesFor("knight");
  for (const id of ["dueling", "archery"]) {
    const option = style!.options.find((o) => o.id === id)!;
    assert.match(option.plain, /\+2/, `"${option.label}" still does not name its number`);
    assert.equal(option.notYet, undefined, "it is applied now, so it must not be labelled otherwise");
  }
});

test("what a pick did stays findable, with its number, on the sheet afterwards", () => {
  // Judge A, on reaching the character sheet with Dueling picked: "shows up
  // on my sheet as the same flavour sentence and no number. I have no way to
  // confirm it's doing anything."
  const dueling = createCharacter({ archetypeId: "knight", name: "Maddik", appearanceAssetId: "token_knight", choices: { fightingStyle: "dueling" } });
  const shown = dueling.appliedEffects.map((e) => e.plain).join(" ");
  assert.match(shown, /\+2/, `the sheet still cannot confirm the pick did anything: ${JSON.stringify(shown)}`);
});

test("Champion and Battle Master both state a number, because both are real now", () => {
  let sheet = makeDefault("knight");
  for (let i = 0; i < MILESTONES_PER_LEVEL * 2; i++) sheet = addMilestone(sheet);
  const level2 = applyLevelUpChoice(levelUpChoices(sheet, 2), null);
  const choice = levelUpChoices(level2, 3).choice!;
  const champion = choice.options.find((o) => o.id === "champion")!;
  assert.match(champion.plain, /19/, "the crit range is a real number the engine reads (criticalOnFor)");
  assert.equal(champion.notYet, undefined);
  const battleMaster = choice.options.find((o) => o.id === "battle-master")!;
  assert.match(battleMaster.plain, /d8/, "both judges checked the play screen for maneuvers and found none; there are four dice and two of them now");
  assert.equal(battleMaster.notYet, undefined);
});

// ── the archetype blurbs sell the game that exists ──────────────────────

test("no archetype blurb sells a party this game never shows", () => {
  // A cold reader picked Knight expecting three AI teammates, found one HP
  // bar, and said they would have been annoyed about it two hours later.
  const PARTY_WORDS = /\bpart(y|ies)\b|\bsquad\b|\bteammates?\b|\ballies\b|\beveryone else\b|behind the line|\bthe line\b/i;
  for (const archetype of ARCHETYPES) {
    const match = PARTY_WORDS.exec(archetype.kitDescription);
    assert.equal(match, null, `${archetype.id} promises company: ${JSON.stringify(match?.[0])}`);
  }
});

test("no player-facing pitch promises company the build cannot deliver (issue #16)", () => {
  // The strings the campaign list and the new-campaign screen are built from.
  // None of them has ever promised a party; this is the guard that keeps it
  // that way, because they are where a "you and your companions" rewrite would
  // most naturally land next.
  const PARTY_WORDS = /\bpart(y|ies)\b|\bsquad\b|\bteammates?\b|\ballies\b|\bcompanions?\b|\byour crew\b/i;
  const copy: [string, string][] = [
    ["GAME_TAGLINE", GAME_TAGLINE],
    ["CAMPAIGN_PLANNING_SUB", CAMPAIGN_PLANNING_SUB],
  ];
  for (const [name, text] of copy) {
    const match = PARTY_WORDS.exec(text);
    assert.equal(match, null, `${name} promises company: ${JSON.stringify(match?.[0])}`);
  }
});

test("the Healer's blurb names the solo-relevant strength it actually has", () => {
  // Five healing uses against everyone else's two is the deepest pool in the
  // game, and the copy never mentioned it because it was busy selling friends.
  const healer = getArchetype("healer");
  const uses = healer.startingConsumables.reduce((n, c) => n + c.uses, 0);
  assert.equal(uses, 5);
  assert.match(healer.kitDescription, /five|5/i);
});

// ── make camp is not an infinite free full heal ──────────────────────────

test("a second long rest in a row is refused, with the reason in words", () => {
  // Judge A, from one screen of text: "my confident read is: Make camp is an
  // infinite free full heal, Catch your breath is strictly worse and
  // pointless, and healing potions are worthless. I'd rest to full after
  // every single fight and never buy an item again." That read was correct.
  const hurt: CharacterSheet = { ...makeDefault("knight"), currentHp: 3, hitDiceRemaining: 0 };
  const slept = longRest(hurt).sheet;
  assert.equal(slept.currentHp, slept.maxHp);

  const spent: CharacterSheet = { ...slept, currentHp: 4 };
  const blocked = longRestBlockedReason(spent);
  assert.ok(blocked, "nothing stopped a second camp, so hit dice, potions and spell slots were all decorative");
  assert.equal(longRest(spent).sheet, spent, "a blocked long rest must not heal anyway");
});

test("something happening in the campaign turns the day over and camp is available again", () => {
  const slept = longRest({ ...makeDefault("knight"), currentHp: 3 }).sheet;
  assert.ok(longRestBlockedReason(slept));
  const nextDay = newAdventuringDay(slept);
  assert.equal(longRestBlockedReason({ ...nextDay, currentHp: 3 }), null);
});

test("normalizeSheet defaults the camp flag, so an older campaign is not stuck unable to rest", () => {
  const legacy = makeDefault("knight") as CharacterSheet & Record<string, unknown>;
  delete legacy.longRestUsed;
  assert.equal(normalizeSheet(legacy).longRestUsed, false);
});

// ── equipment: three slots, on every sheet, from turn one ────────────────
//
// The three slots are drawn on the token from the first turn (the art lanes
// author a `base` sprite for every one of them), so the SHEET has to agree:
// a character with no `equipment` at all would render a body wearing gear the
// sheet says it does not have. STARTING_LOADOUT (contract v2: the v1 three
// slots plus a common pair of boots, ring and amulet empty) is all-common on
// every drawn role, which adds no number to anything -- that is the point of
// the common tier existing.

test("a brand new character of every archetype carries all three slots, all common", () => {
  for (const archetype of ARCHETYPES) {
    const sheet = makeDefault(archetype.id);
    const equipment = sheet.equipment;
    assert.ok(equipment, `${archetype.id} has no equipment at all, so its three drawn slots are a lie`);
    for (const role of SLOT_ROLES) {
      assert.equal(equipment[role]?.slot, role, `${archetype.id} is missing its ${role} slot`);
      assert.equal(equipment[role]?.tier, "common", `${archetype.id}'s ${role} should start common`);
    }
  }
});

test("a sheet stored before equipment existed loads with the starting three, not with undefined", () => {
  // `game_characters.stats` is a free-form jsonb bag written by this client
  // and read straight back, so every campaign started before this feature
  // comes back with the field simply absent -- exactly how longRestUsed,
  // hitDiceRemaining and deathSaves each arrived.
  const legacy = makeDefault("shadow") as CharacterSheet & Record<string, unknown>;
  delete legacy.equipment;
  const loaded = normalizeSheet(legacy);
  assert.deepEqual(loaded.equipment, STARTING_LOADOUT);
});

test("a character sheet stores a tier and never a bonus number", () => {
  // The load-bearing rule, at the storage layer: a stored bonus is a number
  // something other than BONUS_BY_TIER could write. EquippedItem is
  // {slot, tier} and nothing else, so there is no field for one to land in.
  const sheet = equipItem(makeDefault("knight"), "weapon", "legendary");
  assert.deepEqual(sheet.equipment?.weapon, { slot: "weapon", tier: "legendary" });
  const keys = Object.keys(sheet.equipment!.weapon!);
  assert.deepEqual(keys.sort(), ["slot", "tier"]);
});

test("equipping is pure: it changes one slot and nothing else on the sheet", () => {
  const before = makeDefault("healer");
  const after = equipItem(before, "crown", "rare");
  assert.equal(after.equipment?.crown?.tier, "rare");
  assert.equal(after.equipment?.weapon?.tier, "common", "the other two slots are untouched");
  assert.equal(after.equipment?.outer?.tier, "common");
  assert.equal(before.equipment?.crown?.tier, "common", "the input sheet is not mutated");
  // Everything the engine rolls off is byte-identical: equipping spends no
  // resource, costs no credit and calls no model.
  assert.equal(numericSignature({ ...after, equipment: before.equipment }), numericSignature(before));
});

// ── contract v2, end to end: a real character finds something and wears it ─

test("a real character's full loot -> stage -> commit loop lands on the sheet and the gear row shows its restored rarity", () => {
  let sheet = makeDefault("shadow");
  const { sheet: looted, roll } = lootFor(sheet, { source: "fight", cx: 0, cy: 0 }, () => 0.5);
  sheet = looted;
  // Whatever the roll found (rng 0.5 lands well inside the uncommon band),
  // it should be sitting in the bag, findable and equippable end to end.
  if (roll?.item) {
    const draft = draftFromSheet(sheet);
    const bagIndex = draft.bag.findIndex((b) => b.slot === roll.item!.slot && b.tier === roll.item!.tier);
    assert.ok(bagIndex >= 0, "the found item should be sitting in the bag");
    const staged = stageEquip(sheet.archetypeId, draft, bagIndex);
    assert.ok(staged.ok, "equipping a freshly-found item should never be refused on a fresh character");
    if (staged.ok) {
      sheet = commitLoadout(sheet, staged.draft);
      const view = gearView(sheet)!;
      const worn = [...view.slots, ...view.accessorySlots].find((s) => s.role === roll.item!.slot);
      assert.ok(worn, `the sheet should show a row for ${roll.item!.slot}`);
      assert.equal(worn!.tier, roll.item!.tier, "the gear row should show the tier that was actually found and equipped");
      assert.ok(
        equippableTiers(sheet, roll.item!.slot as (typeof SLOT_ROLES)[number]).includes(roll.item!.tier) ||
          !SLOT_ROLES.includes(roll.item!.slot as (typeof SLOT_ROLES)[number]),
        "equippableTiers should now own the found tier for a v1 role",
      );
    }
  } else {
    // The 40% nothing band on this rng: the sheet is simply returned with
    // one more ledger entry, nothing more to assert about gear.
    assert.equal(roll?.tier, null);
  }
});

test("a v1 three-key equipment blob (no boots, ring or amulet) still loads and draws through normalizeSheet, unchanged in every number", () => {
  const fresh = makeDefault("trooper") as CharacterSheet & Record<string, unknown>;
  const legacyEquipment = { weapon: { slot: "weapon", tier: "common" }, outer: { slot: "outer", tier: "common" }, crown: { slot: "crown", tier: "common" } };
  const legacy = { ...fresh, equipment: legacyEquipment };
  delete (legacy as Record<string, unknown>).bag;
  const loaded = normalizeSheet(legacy as CharacterSheet);
  const view = gearView(loaded)!;
  assert.equal(view.slots.length, 3, "the v1 three slots are unchanged");
  const boots = view.accessorySlots.find((s) => s.role === "boots")!;
  assert.equal(boots.tier, "common", "a v1 blob with no boots key still draws the common pair");
  const ring = view.accessorySlots.find((s) => s.role === "ring")!;
  assert.equal(ring.empty, true, "a v1 blob never invents a ring");
  assert.equal(numericSignature(loaded), numericSignature(fresh), "not one number moved for a legacy blob");
});
