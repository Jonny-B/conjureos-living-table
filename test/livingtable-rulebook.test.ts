/**
 * Tests for the rulebook (src/games/livingtable/rules/rulebook.ts).
 *
 * The book is prose about numbers, so the useful tests are the ones that tie a
 * sentence to the engine: every number the book states is checked against the
 * constant or function that owns it, and each worked example is replayed
 * through the real rules with a scripted rng, so a retuned engine fails here
 * instead of leaving the book quietly wrong.
 *
 * Run: npx tsx --test test/livingtable-rulebook.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { RULEBOOK, ruleSection, rulebookText, type RuleBlock, type RuleSection } from "../src/games/livingtable/rules/rulebook";
import { ANCESTRIES } from "../src/games/livingtable/characters/ancestries";
import { ARCHETYPES, PLAYABLE_ARCHETYPE_IDS, getArchetype } from "../src/games/livingtable/characters/templates";
import { POINT_BUY_BUDGET, STANDARD_ARRAY, createCharacter, pointBuyCost } from "../src/games/livingtable/characters/creation";
import { DEATH_SAVE_DC, applyDeathSave, potionHealing } from "../src/games/livingtable/characters/health";
import { BAG_CAPACITY, LOOT_ROLLS_PER_CELL, LOOT_TIER_BANDS, MAX_ATTUNED_ITEMS, MAX_TOTAL_AC_BONUS, SLOTS_BY_ARCHETYPE, type ArchetypeId } from "../src/games/livingtable/characters/equipmentTypes";
import { SPELL_EFFECTS } from "../src/games/livingtable/menu/casting";
import { FEET_PER_TILE, MELEE_REACH_FT, MONSTER_INITIATIVE_MODIFIER } from "../src/games/livingtable/menu/combatRound";
import { lootFor } from "../src/games/livingtable/rules/loot";
import { resolveAttack, resolveDamage } from "../src/games/livingtable/rules/combat";
import { resolveSkillCheck } from "../src/games/livingtable/rules/checks";
import { parseDiceNotation } from "../src/games/livingtable/rules/dice";
import { WIZARD_SPELLS } from "../src/games/livingtable/rules/spells";
import { DEFAULT_SPEED_FT, MAX_DC, MIN_DC, MONSTER_STATBLOCKS, SEARCH_DC, attackerBonusFor, damageMonster, skillModifierFor, weaponDamageNotationFor } from "../src/games/livingtable/session/combat";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world/coordinates";
import { DEFAULT_RANGED_REACH_TILES } from "../src/games/livingtable/world/reach";
import { DM_LIMITS } from "../src/games/livingtable/table/dmCore";
import { resolveMenuAction } from "../src/games/livingtable/menu/commandMenu";
import { SRD_CONDITIONS } from "../src/games/livingtable/rules/conditions";
import { validateDmTurn } from "../src/games/livingtable/dm/turnSchema";
import { resetTurnEconomy } from "../src/games/livingtable/rules/actionEconomy";
import { stageEquip } from "../src/games/livingtable/rules/inventory";
import { isContainerProp } from "../src/games/livingtable/characters/equipmentTypes";
import { SKILL_ABILITY } from "../src/games/livingtable/characters/creation";
import { emptyWorld } from "../src/games/livingtable/world";

const BOOK = rulebookText();

/** The em dash and the en dash, built from their code points so this file never has to type either. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/** Every string a block carries, so a search sees tables and lists as well as paragraphs. */
function blockStrings(block: RuleBlock): string[] {
  switch (block.kind) {
    case "p":
    case "example":
    case "note":
      return [block.text];
    case "list":
      return block.items;
    case "table":
      return [...block.head, ...block.rows.flat()];
  }
}

function sectionStrings(section: RuleSection): string[] {
  return [section.title, section.summary, ...section.blocks.flatMap(blockStrings)];
}

function section(id: string): RuleSection {
  const found = ruleSection(id);
  assert.ok(found, `no section "${id}"`);
  return found;
}

function sectionText(id: string): string {
  return sectionStrings(section(id)).join("\n");
}

function tableOf(id: string, firstHead: string) {
  const found = section(id).blocks.find((b) => b.kind === "table" && b.head[0] === firstHead);
  assert.ok(found && found.kind === "table", `no table starting "${firstHead}" in ${id}`);
  return found;
}

function knight() {
  return createCharacter({ archetypeId: "knight", name: "Bram", appearanceAssetId: "token_knight", choices: { fightingStyle: "defense" } });
}

function scripted(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("rng called more often than scripted");
    return values[i++]!;
  };
}

// ── structure ────────────────────────────────────────────────────────────

test("every section has a unique, kebab-case id", () => {
  const ids = RULEBOOK.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids.join(", ")}`);
  for (const id of ids) assert.match(id, /^[a-z]+(-[a-z]+)*$/);
});

test("the sections the brief asked for are all there", () => {
  for (const id of ["how-to-play", "your-character", "checks", "exploring", "combat", "dying", "resting", "equipment", "levels", "magic", "the-dm"]) {
    assert.ok(ruleSection(id), `missing section ${id}`);
  }
  assert.equal(ruleSection("no-such-section"), undefined);
});

test("no section is empty: title, summary, blocks and every block's content", () => {
  for (const s of RULEBOOK) {
    assert.ok(s.title.trim(), `${s.id} has no title`);
    assert.ok(s.summary.trim(), `${s.id} has no summary`);
    assert.ok(s.blocks.length > 0, `${s.id} has no blocks`);
    for (const b of s.blocks) {
      assert.ok(["p", "list", "table", "example", "note"].includes(b.kind), `${s.id} has an unknown block kind`);
      if (b.kind === "list") assert.ok(b.items.length > 0, `${s.id} has an empty list`);
      if (b.kind === "table") {
        assert.ok(b.head.length > 0 && b.rows.length > 0, `${s.id} has an empty table`);
        for (const row of b.rows) assert.equal(row.length, b.head.length, `${s.id} has a ragged table row: ${row.join(" | ")}`);
      }
      for (const text of blockStrings(b)) assert.ok(text.trim().length > 0, `${s.id} has a blank string in a ${b.kind}`);
    }
  }
});

test("every seeAlso id exists, and none points at its own section", () => {
  const ids = new Set(RULEBOOK.map((s) => s.id));
  for (const s of RULEBOOK) {
    for (const see of s.seeAlso ?? []) {
      assert.ok(ids.has(see), `${s.id} points at "${see}", which is not a section`);
      assert.notEqual(see, s.id, `${s.id} points at itself`);
    }
  }
});

test("the book carries no em dash or en dash, in the text or in the source", () => {
  assert.doesNotMatch(BOOK, DASHES);
  const source = readFileSync(new URL("../src/games/livingtable/rules/rulebook.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, DASHES);
});

test("rulebookText contains every title, and a subset renders only its own sections", () => {
  for (const s of RULEBOOK) assert.ok(BOOK.includes(s.title), `rulebookText is missing the title "${s.title}"`);
  const some = rulebookText([section("checks")]);
  assert.ok(some.includes("Checks and saving throws"));
  assert.ok(!some.includes("Resting"));
  assert.equal(rulebookText([]), "");
});

test("rulebookText renders every block kind", () => {
  assert.match(BOOK, /^- /m);
  assert.match(BOOK, / \| /);
  assert.match(BOOK, /^Example: /m);
  assert.match(BOOK, /^Note: /m);
});

// ── numbers, tied to the engine ──────────────────────────────────────────

test("distance and speed come from the engine", () => {
  assert.equal(FEET_PER_TILE, 5);
  const exploring = sectionText("exploring");
  assert.ok(exploring.includes(`One square is ${FEET_PER_TILE} ft.`));
  assert.ok(exploring.includes(`${CELL_WIDTH} squares wide and ${CELL_HEIGHT} tall`));
  assert.ok(exploring.includes(`${DEFAULT_SPEED_FT} ft (${DEFAULT_SPEED_FT / FEET_PER_TILE} squares) a turn`));
  const combat = sectionText("combat");
  assert.ok(combat.includes(`reaches ${MELEE_REACH_FT} ft`));
  assert.ok(combat.includes(`reaches ${DEFAULT_RANGED_REACH_TILES * FEET_PER_TILE} ft`));
  assert.equal(MELEE_REACH_FT, 5);
  assert.equal(DEFAULT_RANGED_REACH_TILES * FEET_PER_TILE, 80);
});

test("the potion dice and range match the game's own potion", () => {
  assert.equal(potionHealing(() => 0), 4);
  assert.equal(potionHealing(() => 0.999999), 10);
  const { count, sides, modifier } = parseDiceNotation("2d4+2");
  assert.equal(count + modifier, 4);
  assert.equal(count * sides + modifier, 10);
  const dying = sectionText("dying");
  assert.ok(dying.includes("2d4+2, which is 4 to 10 hit points"));
  // The Item button's own copy prints the same dice.
  for (const archetype of ARCHETYPES) {
    for (const item of archetype.startingConsumables) assert.ok(item.description.includes("2d4+2"), `${archetype.id}: ${item.name}`);
  }
});

test("death saves: the DC, and the worked example replayed through applyDeathSave", () => {
  assert.equal(DEATH_SAVE_DC, 10);
  assert.ok(sectionText("dying").includes(`A ${DEATH_SAVE_DC} or higher is a success`));
  const roll = (d20: number) => ({ roll: d20, total: d20, success: d20 >= DEATH_SAVE_DC });
  let sheet = { ...knight(), currentHp: 0, downed: true };
  sheet = applyDeathSave(sheet, roll(12)).sheet;
  assert.deepEqual(sheet.deathSaves, { successes: 1, failures: 0 });
  sheet = applyDeathSave(sheet, roll(4)).sheet;
  assert.deepEqual(sheet.deathSaves, { successes: 1, failures: 1 });
  const up = applyDeathSave(sheet, roll(20));
  assert.equal(up.sheet.currentHp, 1);
  assert.equal(up.sheet.downed, false);
  // A natural 1 is two failures.
  const crashed = applyDeathSave({ ...knight(), currentHp: 0, downed: true }, roll(1));
  assert.equal(crashed.sheet.deathSaves.failures, 2);
});

test("the DC ladder and the engine's DC bounds", () => {
  const ladder = tableOf("checks", "How hard");
  const dcs = ladder.rows.map((r) => Number(r[1]));
  assert.equal(dcs[0], MIN_DC);
  assert.equal(dcs[dcs.length - 1], MAX_DC);
  assert.deepEqual(dcs, [5, 10, 15, 20, 25, 30]);
  assert.ok(sectionText("checks").includes(`between ${MIN_DC} and ${MAX_DC}`));
  assert.ok(sectionText("checks").includes(`or ${SEARCH_DC} when it has none`));
});

test("the search example: the Knight meets DC 12 on the boundary", () => {
  const sheet = knight();
  const modifier = skillModifierFor(sheet, "Perception");
  assert.equal(modifier, 1);
  // A roll of 11 is d20 face 11: rng 0.5 gives floor(0.5 * 20) + 1.
  const hit = resolveSkillCheck({ modifier, dc: SEARCH_DC, rng: () => 0.5 });
  assert.equal(hit.roll, 11);
  assert.equal(hit.total, SEARCH_DC);
  assert.equal(hit.success, true);
  assert.equal(resolveSkillCheck({ modifier, dc: SEARCH_DC, rng: () => 0.45 }).success, false);
  assert.ok(sectionText("checks").includes("You roll 11: 11 +1 = 12, which meets DC 12"));
});

test("the attack example: +4 against the goblin's AC 15, then 7 damage drops its 7 hit points", () => {
  const sheet = knight();
  const bonus = attackerBonusFor(sheet);
  const goblin = MONSTER_STATBLOCKS["token_goblin"]!;
  assert.equal(bonus, 4);
  assert.equal(goblin.armorClass, 15);
  assert.equal(goblin.maxHp, 7);
  // d20 face 13: rng 0.6 gives floor(0.6 * 20) + 1.
  const swing = resolveAttack({ attackerBonus: bonus, targetAC: goblin.armorClass, rng: () => 0.6 });
  assert.equal(swing.roll, 13);
  assert.equal(swing.total, 17);
  assert.equal(swing.hit, true);
  // d8 face 5: rng 0.5 gives floor(0.5 * 8) + 1.
  const notation = weaponDamageNotationFor(sheet);
  assert.equal(notation, "1d8+2");
  const damage = resolveDamage(notation, () => 0.5);
  assert.equal(damage.rolls[0], 5);
  assert.equal(damage.total, goblin.maxHp);
  assert.equal(damageMonster({ assetId: "token_goblin" }, damage.total).down, true);
  assert.ok(sectionText("combat").includes("The roll is 13: 13 +4 = 17, a hit"));
});

test("a natural 20 always hits and a natural 1 never does, as the combat section says", () => {
  assert.equal(resolveAttack({ attackerBonus: -5, targetAC: 30, rng: () => 0.99 }).hit, true);
  assert.equal(resolveAttack({ attackerBonus: 20, targetAC: 5, rng: () => 0 }).hit, false);
  assert.ok(sectionText("combat").includes("A natural 20 always hits and is a critical hit. A natural 1 always misses."));
});

test("the monster table is MONSTER_STATBLOCKS, and monsters add the fixed initiative bonus", () => {
  const table = tableOf("combat", "Creature");
  for (const key of ["token_goblin", "token_skeleton"]) {
    const m = MONSTER_STATBLOCKS[key]!;
    const row = table.rows.find((r) => r[0] === m.name);
    assert.ok(row, `no row for ${m.name}`);
    assert.deepEqual(row.slice(1, 5), [String(m.armorClass), String(m.maxHp), `+${m.attackBonus}`, m.damageNotation]);
  }
  assert.equal(MONSTER_INITIATIVE_MODIFIER, 2);
  assert.ok(sectionText("combat").includes(`flat +${MONSTER_INITIATIVE_MODIFIER}`));
});

test("loot: the table is LOOT_TIER_BANDS, the cap is the engine's, and the worked example replays", () => {
  const equipment = sectionText("equipment");
  assert.ok(equipment.includes(`at most ${LOOT_ROLLS_PER_CELL} loot rolls`));
  const table = tableOf("equipment", "d100 roll");
  assert.equal(table.rows.length, LOOT_TIER_BANDS.length);
  assert.deepEqual(table.rows.map((r) => r[0]), ["1 to 40", "41 to 75", "76 to 95", "96 to 100"]);
  assert.deepEqual(table.rows.map((r) => r[2]), ["40 in 100", "35 in 100", "20 in 100", "5 in 100"]);
  // The example: d100 = 88 (rare), then a d6 across six slots lands on the ring.
  const { roll } = lootFor({ archetypeId: "knight", equipment: {}, bag: [] }, { source: "container", cx: 0, cy: 0 }, scripted([0.87, 0.5]));
  assert.ok(roll);
  assert.equal(roll.tierRoll, 88);
  assert.equal(roll.tier, "rare");
  assert.equal(roll.slotDie, 6);
  assert.equal(roll.slotRoll, 4);
  assert.deepEqual(roll.item, { slot: "ring", tier: "rare" });
  assert.ok(equipment.includes("The engine rolls a d100 and gets 88"));
  assert.ok(equipment.includes("The fourth slot is the ring: the Ring of Protection"));
});

test("gear caps, attunement and the bag are the engine's numbers", () => {
  const equipment = sectionText("equipment");
  assert.ok(equipment.includes(`never add more than +${MAX_TOTAL_AC_BONUS}`));
  assert.ok(equipment.includes(`You can be attuned to ${MAX_ATTUNED_ITEMS} items at once`));
  assert.ok(equipment.includes(`${BAG_CAPACITY} places`));
  assert.equal(BAG_CAPACITY, 18);
});

test("a legendary weapon's rider damage types are the ones the book names", () => {
  const riders = (["knight", "shadow", "fireball-person"] as const).map((id) => SLOTS_BY_ARCHETYPE[id as ArchetypeId].weapon.legendaryRider?.damageType);
  assert.deepEqual(riders, ["radiant", "poison", "fire"]);
  assert.ok(sectionText("equipment").includes("radiant for the Knight's, poison for the Rogue's, fire for the Mage's"));
});

test("magic: slots by level, and every spell on the list is in the table with its real reach", () => {
  const magic = sectionText("magic");
  assert.ok(magic.includes("level 1 has 2 of level 1"));
  assert.ok(magic.includes("level 3 has 4 of level 1, 2 of level 2"));
  const table = tableOf("magic", "Spell");
  assert.equal(table.rows.length, WIZARD_SPELLS.length);
  for (const spell of WIZARD_SPELLS) {
    const row = table.rows.find((r) => r[0] === spell.name);
    assert.ok(row, `no row for ${spell.name}`);
    const effect = SPELL_EFFECTS[spell.name];
    if (effect?.kind === "utility") assert.match(row[3]!, /The DM rules on this/, `${spell.name} implies an effect the engine does not apply`);
    if (effect && "rangeFt" in effect) assert.equal(row[4], `${effect.rangeFt} ft`);
  }
  // Fireball is not on the wizard's list at these levels, and the book says why instead of listing it.
  assert.ok(!WIZARD_SPELLS.some((s) => s.name === "Fireball"));
  assert.ok(magic.includes("Fireball is a level 3 spell"));
});

test("character creation: the three score methods, the point-buy costs and the nine ancestries", () => {
  const character = sectionText("your-character");
  assert.ok(character.includes(STANDARD_ARRAY.join(", ")));
  assert.ok(character.includes(`${POINT_BUY_BUDGET} points`));
  const costs = tableOf("your-character", "Point buy score");
  assert.deepEqual(
    costs.rows.map((r) => r[1]),
    ["0", "1", "2", "3", "4", "5", "7", "9"],
  );
  assert.equal(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }), POINT_BUY_BUDGET);
  const ancestries = tableOf("your-character", "Ancestry");
  assert.equal(ancestries.rows.length, 9);
  for (const a of ANCESTRIES) assert.ok(ancestries.rows.some((r) => r[0] === a.name && r[1] === `${a.speedFt} ft`), `ancestry ${a.name}`);
});

test("the hero table is the creator's own numbers for every playable hero", () => {
  const table = tableOf("your-character", "Hero");
  assert.equal(table.rows.length, PLAYABLE_ARCHETYPE_IDS.length);
  for (const id of PLAYABLE_ARCHETYPE_IDS) {
    const archetype = getArchetype(id);
    const sheet = createCharacter({ archetypeId: id, name: "Example", appearanceAssetId: "token_x", choices: { fightingStyle: "dueling" } });
    const row = table.rows.find((r) => r[0] === archetype.displayName);
    assert.ok(row, `no row for ${archetype.displayName}`);
    assert.equal(row[2], `d${sheet.hitDieSides}`);
    assert.equal(row[3], String(sheet.maxHp));
    assert.ok(row[4]!.startsWith(String(sheet.armorClass)));
  }
});

test("modifiers and proficiency in the book are the engine's", () => {
  const table = tableOf("your-character", "Score");
  assert.deepEqual(table.rows.find((r) => r[0] === "8 or 9"), ["8 or 9", "-1"]);
  assert.deepEqual(table.rows.find((r) => r[0] === "10 or 11"), ["10 or 11", "+0"]);
  assert.deepEqual(table.rows.find((r) => r[0] === "20"), ["20", "+5"]);
  assert.ok(sectionText("your-character").includes("Proficiency bonus is +2 at level 1 and stays +2 at level 3"));
});

// ── the bench's own numbers, read from the bench ─────────────────────────

/**
 * Every module of the table window (src/games/livingtable/table/*.ts and its flows/ folder, not ui/) as one text. The numbers and words the book
 * quotes from the window live there now (state.ts holds the wake and hearing distances and the potion cap), so the scans read the
 * folder rather than one file and keep working when a constant moves between its modules.
 */
// The window is split into mountTable.ts and the flows/ modules beside it (tableCtx.ts is what they share), so the scan reads them all.
function tableSource(): string {
  const dirs = [new URL("../src/games/livingtable/table/", import.meta.url), new URL("../src/games/livingtable/table/flows/", import.meta.url)];
  return dirs
    .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".ts")).sort().map((f) => readFileSync(new URL(f, dir), "utf8")))
    .join("\n");
}

test("the bench-only numbers in the book match the table window", () => {
  const bench = tableSource();
  assert.match(bench, /const MONSTER_WAKE_TILES = 6;/);
  assert.match(bench, /const MONSTER_HEARS_STEPS = 2;/);
  assert.match(bench, /const DM_POTION_CAP = 2;/);
  assert.ok(sectionText("exploring").includes("within 6 squares"));
  assert.ok(sectionText("exploring").includes("2 squares or fewer"));
  const dm = sectionText("the-dm");
  assert.ok(dm.includes(`at most ${DM_LIMITS.maxEffects} things in a reply`));
  assert.ok(dm.includes(`healing is up to ${DM_LIMITS.maxDiceCount} dice from d4 to d${Math.max(...DM_LIMITS.healSides)} plus at most ${DM_LIMITS.maxHealModifier}`));
  assert.ok(dm.includes(`harm is up to ${DM_LIMITS.maxDiceCount} dice from d4 to d${Math.max(...DM_LIMITS.harmSides)} plus at most ${DM_LIMITS.maxHarmModifier}`));
  assert.ok(dm.includes(`from ${DM_LIMITS.minDc} to ${DM_LIMITS.maxDc}`));
  assert.equal(DM_LIMITS.minDc, MIN_DC);
  assert.equal(DM_LIMITS.maxDc, MAX_DC);
  assert.ok(dm.includes("at most 2 potions a scene"));
});

// ── honesty ──────────────────────────────────────────────────────────────

test("the book says where the engine does not apply something, in the game's own words", () => {
  assert.ok(BOOK.includes("The DM rules on this"));
  assert.ok(BOOK.includes("The game applies this"));
  // The two things a reader would most assume the engine does.
  assert.match(sectionText("dying"), /does not change anyone's rolls because of a condition: the DM rules on this/);
  assert.match(sectionText("combat"), /nothing you do spends them yet/);
  // Asset bench differences are named, not hidden.
  assert.match(sectionText("equipment"), /On the asset bench the chest opens without a check/);
  assert.match(sectionText("exploring"), /On the asset bench the chest simply opens/);
});

test("the DM section says the DM never sets a die result", () => {
  const dm = sectionText("the-dm");
  assert.match(dm, /Set a die result/);
  assert.match(dm, /never rolls/);
  assert.match(dm, /Choose, name, grant or price gear/);
});

/** Whether a section's text contains a sentence, with a failure message that does not print the section. */
function says(id: string, sentence: string): void {
  assert.ok(sectionText(id).includes(sentence), `section "${id}" should say: ${sentence}`);
}

function lacks(id: string, pattern: RegExp, why: string): void {
  assert.ok(!pattern.test(sectionText(id)), `section "${id}" should not match ${pattern}: ${why}`);
}

function wizard() {
  return createCharacter({ archetypeId: "fireball-person", name: "Ivo", appearanceAssetId: "token_fireball_person" });
}

test("the SRD's other actions are not in the engine, and the book says so", () => {
  says("combat", "Dash, Dodge, Disengage, Help and Ready");
  says("combat", "There are no opportunity attacks");
  // Nothing in the hero's action economy is anything but action, bonus action, reaction and movement.
  assert.deepEqual(Object.keys(resetTurnEconomy(30)).sort(), ["action", "bonusAction", "movementRemaining", "reaction"]);
});

test("Fire Bolt differs between Attack and Cast, and the book gives both", () => {
  const sheet = wizard();
  const attackNotation = weaponDamageNotationFor(sheet);
  assert.equal(attackNotation, `1d10+${sheet.modifiers.int}`);
  const effect = SPELL_EFFECTS["Fire Bolt"]!;
  assert.ok(effect.kind === "attack" && effect.damage === "1d10");
  says("magic", `rolls ${attackNotation} (the die plus your Intelligence modifier)`);
  says("magic", "rolls 1d10 and does not count a weapon's bonus");
});

test("a chest is the only container that rolls loot (the crate belongs to the paused sci-fi set)", () => {
  assert.equal(isContainerProp("fantasy", "chest"), true);
  assert.equal(isContainerProp("fantasy", "crate"), false);
  assert.ok(!/chest or crate/.test(BOOK), "the book names a crate that rolls no loot");
  says("equipment", "successfully search a chest");
});

test("attunement: a fourth item that needs it is refused, not worn and idle", () => {
  const equipment = {
    weapon: { slot: "weapon", tier: "legendary" },
    outer: { slot: "outer", tier: "common" },
    crown: { slot: "crown", tier: "common" },
    ring: { slot: "ring", tier: "uncommon" },
    amulet: { slot: "amulet", tier: "uncommon" },
    boots: { slot: "boots", tier: "common" },
  } as const;
  const staged = stageEquip("knight", { equipment: { ...equipment }, bag: [{ slot: "boots", tier: "rare" }] }, 0);
  assert.equal(staged.ok, false);
  assert.ok(!staged.ok && /Take one of them off first/.test(staged.reason));
  says("equipment", "is refused: take one off first");
  lacks("equipment", /does nothing until you take another off/, "the engine refuses the fourth");
});

test("the game's DM opens and closes doors; locking is the bench DM's", () => {
  // The game's world actions, as the validator itself lists them in its refusal.
  let message = "";
  try {
    validateDmTurn({ narration: "x", actions: [{ type: "lockDoor", cx: 0, cy: 0 }] });
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  const listed = /Use exactly one of: ([^.]*)\./.exec(message)?.[1] ?? "";
  assert.ok(/setDoorState/.test(listed) && !/lock/i.test(listed), `the game's world actions are: ${listed}`);
  says("exploring", "In the game the DM opens and closes doors");
  lacks("exploring", /opens, closes, locks and unlocks/, "the game has no lock");
  assert.ok(/On the asset bench[^.]*the DM can also lock and unlock one/.test(sectionText("exploring")));
  says("the-dm", "cannot be removed that way while it has hit points left");
});

test("a step into a room nobody has built asks the DM; nothing else on the buttons does, and the book names no price", () => {
  const here = { world: emptyWorld(), cell: { cx: 0, cy: 0 } };
  const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: "E" } }, here);
  assert.equal(route.kind, "dm");
  assert.equal(route.kind, "dm");
  for (const kind of ["attack", "cast", "rest", "search", "item"] as const) {
    assert.equal(resolveMenuAction({ kind }, here).kind, "local", kind);
  }
  says("how-to-play", "asks the DM to build it");
  says("exploring", "the DM builds it as you arrive");
  for (const id of ["how-to-play", "exploring", "the-dm"]) lacks(id, /credits?\b/i,`${id} states no price`);
});

test("who rolls: the engine rolls every die, and the tray only animates", () => {
  says("checks", "The engine rolls every die");
  lacks("checks", /You roll your own initiative/, "the engine rolls them");
  says("checks", "the number was fixed by the engine before the tray moved");
  // The Play window's closure moves into table/mountTable.ts at the end of the port; until then it is still in the bench's assets.ts.
  const bench = tableSource() + readFileSync(new URL("../scripts/asset-bench/assets.ts", import.meta.url), "utf8");
  assert.ok(/the engine has rolled it; the player throws the die and sees it land/.test(bench), "the window still says the engine rolled first");
  lacks("checks", /with its number on every face that can hold one/, "the tray draws a numeral where it fits");
});

test("the score methods and the skills: all 18 are rollable, none is trained twice, the tray is not promised", () => {
  assert.equal(Object.keys(SKILL_ABILITY).length, 18);
  assert.throws(
    () =>
      createCharacter({
        archetypeId: "knight",
        name: "Bram",
        appearanceAssetId: "token_knight",
        classSkills: ["Athletics", "Perception"],
        background: { name: "Guard", skills: ["Perception", "Insight"] },
      }),
    /Perception/,
  );
  says("your-character", "any of the 18 skills");
  lacks("your-character", /All 18 skills are on the sheet/, "the sheet lists only trained skills");
  says("your-character", "No skill can be trained twice");
  lacks("your-character", /rolled in the dice tray/, "no creator screen throws the tray yet");
  says("your-character", "Dwarven Toughness adds its hit point at level 1 only");
});

test("numbers the book states come from the engine, not from a literal in the book", () => {
  const source = readFileSync(new URL("../src/games/livingtable/rules/rulebook.ts", import.meta.url), "utf8");
  assert.ok(!/const LEVEL_CAP = \d/.test(source), "the level cap is read off the spell table, not typed");
  assert.ok(!/const POTION_DICE = "/.test(source), "the potion's dice are read off potionHealing, not typed");
  assert.ok(!/Wisdom 12/.test(source), "the Knight's Wisdom comes off the sheet");
  says("levels", "Levels run from 1 to 3");
  says("checks", `Wisdom ${knight().abilities.wis} gives`);
});

test("conditions: the engine holds fourteen of the SRD's fifteen, and the book does not say it holds them all", () => {
  assert.equal(SRD_CONDITIONS.length, 14);
  assert.ok(!(SRD_CONDITIONS as readonly string[]).includes("exhaustion"));
  says("dying", "14 of the SRD's conditions");
  says("dying", "exhaustion is not one of them");
  lacks("dying", /the 14 SRD conditions/, "the SRD has fifteen");
});
