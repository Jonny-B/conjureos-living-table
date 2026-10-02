/**
 * Tests for the character creator's engine side: ability-score methods,
 * ancestries, class and background skills, and the preview the wizard calls.
 *
 * The load-bearing claim is backward compatibility: createCharacter with the
 * inputs that existed before the creator MUST return exactly the sheet it
 * returned then. test/fixtures/creation-baseline-head.json holds those sheets
 * as captured from the commit before the creator was written (every archetype,
 * every class choice, and the all-defaults path); it is data, not something to
 * regenerate when this test fails.
 *
 * Run: npx tsx --test test/livingtable-creation-custom.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARCHETYPES, CLASS_SKILL_CHOICES, PLAYABLE_ARCHETYPE_IDS, getArchetype } from "../src/games/livingtable/characters/templates";
import { ANCESTRIES } from "../src/games/livingtable/characters/ancestries";
import {
  ABILITY_KEYS,
  ALIGNMENTS,
  POINT_BUY_BUDGET,
  SKILL_ABILITY,
  STANDARD_ARRAY,
  createCharacter,
  creationChoicesFor,
  creationOptions,
  normalizeSheet,
  pointBuyCost,
  previewCharacter,
  rollAbilitySet,
  scoresFromDice,
  validateBaseScores,
  type CharacterSheet,
  type CreateCharacterInput,
} from "../src/games/livingtable/characters/creation";
import { effectiveSpeedFt } from "../src/games/livingtable/session/combat";
import { abilityModifier } from "../src/games/livingtable/rules";

const BASELINE = JSON.parse(readFileSync(new URL("./fixtures/creation-baseline-head.json", import.meta.url), "utf8")) as Record<string, CharacterSheet>;

const PLAYABLE = PLAYABLE_ARCHETYPE_IDS.slice();

/** The two dash characters the project bans, built from code points so this file never types them. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const CREATOR_KEYS = ["ancestryId", "ancestryName", "baseScores", "abilityMethod", "speedFt", "languages", "darkvisionFt", "traits", "background", "alignment", "backstory"] as const;

function base(archetypeId: string, extra: Partial<CreateCharacterInput> = {}): CreateCharacterInput {
  return { archetypeId, name: "Test Hero", appearanceAssetId: "token_test", ...extra };
}

// ── backward compatibility ─────────────────────────────────────────────

test("createCharacter with the pre-creator inputs returns exactly the sheet HEAD returned", () => {
  let checked = 0;
  for (const a of ARCHETYPES) {
    const choices = creationChoicesFor(a.id);
    const combos: (Record<string, string> | null)[] = choices.length ? choices[0]!.options.map((o) => ({ [choices[0]!.id]: o.id })) : [{}];
    combos.push(null);
    for (const c of combos) {
      const key = `${a.id}|${c ? JSON.stringify(c) : "default"}`;
      const expected = BASELINE[key];
      assert.ok(expected, `baseline has ${key}`);
      const actual = createCharacter({ archetypeId: a.id, name: "  Test Hero ", appearanceAssetId: "sprite-01", ...(c ? { choices: c } : {}) });
      assert.deepEqual(actual, expected, key);
      // No creator field may appear on an old-style sheet, not even as undefined.
      for (const k of CREATOR_KEYS) assert.equal(Object.hasOwn(actual, k), false, `${key} has no ${k}`);
      checked++;
    }
  }
  assert.equal(checked, Object.keys(BASELINE).length);
});

test("the old creation errors keep their words", () => {
  assert.throws(() => createCharacter(base("knight", { name: "  " })), /needs a name/);
  assert.throws(() => createCharacter(base("knight", { appearanceAssetId: "" })), /needs an appearance/);
  assert.throws(() => createCharacter(base("knight", { choices: { fightingStyle: "nope" } })), /not a fighting style option/);
  assert.throws(() => createCharacter(base("shadow", { choices: { expertiseSkill: "Arcana" } })), /not one of this archetype's starting skills/);
  assert.throws(() => createCharacter(base("no-such-archetype")), /unknown archetype/);
});

// ── ability score methods ──────────────────────────────────────────────

test("the standard array, and the archetype allocations, are 27 point-buy points", () => {
  assert.deepEqual([...STANDARD_ARRAY], [15, 14, 13, 12, 10, 8]);
  for (const a of ARCHETYPES) assert.equal(pointBuyCost(a.baseAbilityScores), POINT_BUY_BUDGET, a.id);
});

test("pointBuyCost is null outside 8 to 15 and for non-integers", () => {
  const ok = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  assert.equal(pointBuyCost(ok), 0);
  assert.equal(pointBuyCost({ ...ok, str: 7 }), null);
  assert.equal(pointBuyCost({ ...ok, str: 16 }), null);
  assert.equal(pointBuyCost({ ...ok, str: 12.5 }), null);
  assert.equal(pointBuyCost({ ...ok, str: Number.NaN }), null);
});

test("point buy validates the budget", () => {
  const within = { str: 15, dex: 15, con: 8, int: 8, wis: 8, cha: 8 }; // 18 points
  assert.equal(validateBaseScores("pointBuy", within), null);
  const exact = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }; // 27 points exactly
  assert.equal(validateBaseScores("pointBuy", exact), null);
  const tooMuch = { str: 15, dex: 15, con: 15, int: 10, wis: 8, cha: 8 }; // 29 points
  assert.match(validateBaseScores("pointBuy", tooMuch) ?? "", /29 points and you only have 27/);
  assert.match(validateBaseScores("pointBuy", { ...within, str: 16 }) ?? "", /8 to 15/);
  const r = previewCharacter(base("knight", { abilityMethod: "pointBuy", baseScores: tooMuch }));
  assert.equal(r.sheet, null);
  assert.ok(r.errors.some((e) => /29 points/.test(e)));
});

test("the standard array must be a permutation", () => {
  assert.equal(validateBaseScores("standard", { str: 8, dex: 10, con: 12, int: 13, wis: 14, cha: 15 }), null);
  assert.match(validateBaseScores("standard", { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 }) ?? "", /standard array/);
  assert.match(validateBaseScores("standard", { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }) ?? "", /standard array/);
  assert.match(validateBaseScores("standard", { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8.5 }) ?? "", /whole number/);
});

test("rolled scores must be the six rolled numbers, each used once", () => {
  const rolled = [17, 14, 12, 12, 9, 6];
  const scores = { str: 12, dex: 17, con: 14, int: 6, wis: 9, cha: 12 };
  assert.equal(validateBaseScores("rolled", scores, rolled), null);
  assert.match(validateBaseScores("rolled", { ...scores, str: 13 }, rolled) ?? "", /six numbers you rolled/);
  assert.match(validateBaseScores("rolled", scores) ?? "", /Roll your six/);
  assert.match(validateBaseScores("rolled", scores, [17, 14, 12]) ?? "", /Roll your six/);
  assert.match(validateBaseScores("rolled", scores, [19, 14, 12, 12, 9, 6]) ?? "", /3 to 18/);
});

test("scoresFromDice drops the lowest die of each group and rejects bad dice", () => {
  const dice = [
    [1, 2, 3, 4], // 9
    [6, 6, 6, 6], // 18
    [1, 1, 1, 1], // 3
    [5, 1, 4, 2], // 11
    [3, 3, 2, 6], // 12
    [2, 6, 1, 5], // 13
  ];
  assert.deepEqual(scoresFromDice(dice), [9, 18, 3, 11, 12, 13]);
  assert.throws(() => scoresFromDice(dice.slice(0, 5)), /six groups/);
  assert.throws(() => scoresFromDice([...dice.slice(0, 5), [1, 2, 3]]), /four/);
  assert.throws(() => scoresFromDice([...dice.slice(0, 5), [1, 2, 3, 7]]), /four/);
});

test("rollAbilitySet rolls 24 dice and scores them with scoresFromDice", () => {
  let n = 0;
  const seq = [0, 0.2, 0.5, 0.99];
  const set = rollAbilitySet(() => seq[n++ % seq.length]!);
  assert.equal(set.dice.length, 6);
  for (const g of set.dice) assert.deepEqual(g, [1, 2, 4, 6]);
  assert.deepEqual(set.scores, [12, 12, 12, 12, 12, 12]);
  const live = rollAbilitySet();
  assert.deepEqual(live.scores, scoresFromDice(live.dice));
  for (const s of live.scores) assert.ok(s >= 3 && s <= 18);
});

test("a rolled character builds from the dice, and a mismatched set is refused", () => {
  const set = rollAbilitySet(() => 0.9); // every die a 6, every score 18
  const ok = previewCharacter(base("knight", { abilityMethod: "rolled", rolledScores: set.scores }));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.sheet!.abilityMethod, "rolled");
  assert.equal(ok.sheet!.abilities.str, 18);
  // Rolled values land in the archetype's own priority order when baseScores is left out.
  const mixed = [17, 15, 13, 12, 9, 6];
  const placed = previewCharacter(base("knight", { abilityMethod: "rolled", rolledScores: mixed })).sheet!;
  assert.equal(placed.abilities.str, 17); // the Knight's highest
  assert.equal(placed.abilities.con, 15);
  const bad = previewCharacter(
    base("knight", { abilityMethod: "rolled", rolledScores: mixed, baseScores: { str: 18, dex: 15, con: 13, int: 12, wis: 9, cha: 6 } }),
  );
  assert.equal(bad.sheet, null);
  assert.ok(bad.errors.some((e) => /rolled/.test(e)));
  assert.ok(previewCharacter(base("knight", { abilityMethod: "rolled" })).errors.some((e) => /Roll your six/.test(e)));
});

// ── ancestries ─────────────────────────────────────────────────────────

test("the nine SRD ancestries are present with SRD numbers", () => {
  assert.deepEqual(
    ANCESTRIES.map((a) => a.name),
    ["Human", "Hill Dwarf", "High Elf", "Lightfoot Halfling", "Dragonborn", "Rock Gnome", "Half-Elf", "Half-Orc", "Tiefling"],
  );
  const by = Object.fromEntries(ANCESTRIES.map((a) => [a.id, a]));
  assert.equal(by["hill-dwarf"]!.speedFt, 25);
  assert.equal(by["lightfoot-halfling"]!.speedFt, 25);
  assert.equal(by["rock-gnome"]!.speedFt, 25);
  assert.equal(by["human"]!.speedFt, 30);
  assert.deepEqual(by["hill-dwarf"]!.abilityIncreases, { con: 2, wis: 1 });
  assert.equal(by["hill-dwarf"]!.hpPerLevel, 1);
  assert.deepEqual(by["half-elf"]!.chooseIncreases, { count: 2, amount: 1, exclude: ["cha"] });
  assert.equal(by["half-elf"]!.chooseSkills, 2);
  assert.deepEqual(by["half-orc"]!.skills, ["Intimidation"]);
  assert.deepEqual(by["high-elf"]!.skills, ["Perception"]);
  assert.equal(by["lightfoot-halfling"]!.size, "Small");
});

test("every ancestry trait states itself honestly: the engine-applied ones are real, the rest say the DM rules", () => {
  const appliedNames = ["Ability Score Increase", "Speed", "Keen Senses", "Menacing", "Skill Versatility", "Dwarven Toughness"];
  for (const a of ANCESTRIES) {
    assert.ok(a.traits.length >= 2, a.id);
    assert.ok(a.description.length > 20, a.id);
    for (const t of a.traits) {
      assert.ok(t.name && t.text, `${a.id} ${t.name}`);
      if (!t.applied) assert.match(t.text, /DM rules on/, `${a.id}/${t.name} must say the DM rules on it`);
      assert.doesNotMatch(t.text, DASHES, `${a.id}/${t.name} has no dash characters`);
    }
    // What the engine applies is a closed list: a number it folds in, never a mechanic it does not read.
    for (const t of a.traits.filter((x) => x.applied)) assert.ok(appliedNames.includes(t.name), `${a.id}/${t.name} is claimed as applied`);
    assert.doesNotMatch(a.description, DASHES);
  }
  const unapplied = ANCESTRIES.flatMap((a) => a.traits.filter((t) => !t.applied).map((t) => t.name));
  for (const n of ["Darkvision", "Lucky", "Breath Weapon", "Relentless Endurance", "Hellish Resistance", "Fey Ancestry"]) {
    assert.ok(unapplied.includes(n), `${n} is told to the DM, not applied`);
  }
});

test("every ancestry builds a valid sheet for every playable archetype, on defaults and with the wizard's defaults", () => {
  for (const archetypeId of PLAYABLE) {
    const arch = getArchetype(archetypeId);
    for (const anc of ANCESTRIES) {
      const viaDefaults = previewCharacter(base(archetypeId, { ancestryId: anc.id }));
      assert.deepEqual(viaDefaults.errors, [], `${anc.id}/${archetypeId}`);
      const sheet = viaDefaults.sheet!;
      assert.equal(sheet.ancestryId, anc.id);
      assert.equal(sheet.ancestryName, anc.name);
      assert.equal(sheet.speedFt, anc.speedFt);
      assert.deepEqual(sheet.languages, anc.languages);
      assert.equal(sheet.darkvisionFt, anc.darkvisionFt);
      assert.equal(sheet.traits!.length, anc.traits.length);
      assert.ok(sheet.traits!.every((t) => t.source === anc.name));
      // No repeated skill, every skill known, every skill has a real ability.
      const names = sheet.skills.map((s) => s.skill);
      assert.equal(new Set(names).size, names.length, `${anc.id}/${archetypeId} skills ${names.join(",")}`);
      for (const s of sheet.skills) assert.equal(s.ability, SKILL_ABILITY[s.skill]);
      for (const f of anc.skills ?? []) assert.ok(names.includes(f), `${anc.id} grants ${f}`);
      // Final scores: archetype scores plus the ancestry's fixed and free increases.
      let extra = 0;
      for (const k of ABILITY_KEYS) {
        const inc = sheet.abilities[k] - arch.baseAbilityScores[k];
        assert.ok(inc >= (anc.abilityIncreases[k] ?? 0), `${anc.id} ${k}`);
        extra += inc;
      }
      const fixed = Object.values(anc.abilityIncreases).reduce((p, v) => p + (v ?? 0), 0);
      const free = (anc.chooseIncreases?.count ?? 0) * (anc.chooseIncreases?.amount ?? 0);
      assert.equal(extra, fixed + free);
      assert.ok(Object.values(sheet.abilities).every((v) => v <= 20));
      assert.ok(sheet.maxHp >= 1 && sheet.armorClass >= 10);

      // And the wizard's own default input, with the ancestry swapped in and the class skills left to default, is valid too.
      const opts = creationOptions(archetypeId);
      const wiz = previewCharacter({ ...opts.defaults, ancestryId: anc.id, classSkills: undefined });
      assert.deepEqual(wiz.errors, [], `wizard defaults ${anc.id}/${archetypeId}`);
    }
  }
});

test("ancestry increases add to the base scores, cap at 20, and drive HP and AC from the final scores", () => {
  const dwarf = previewCharacter(base("knight", { ancestryId: "hill-dwarf" })).sheet!;
  assert.equal(dwarf.abilities.con, 16); // 14 + 2
  assert.equal(dwarf.abilities.wis, 13); // 12 + 1
  assert.equal(dwarf.baseScores!.con, 14);
  // d10 + CON mod + Dwarven Toughness 1
  assert.equal(dwarf.maxHp, 10 + abilityModifier(16) + 1);
  const human = previewCharacter(base("knight", { ancestryId: "human" })).sheet!;
  assert.equal(human.maxHp, 10 + abilityModifier(15));
  // AC reads the final DEX: a Rogue in leather, 11 + DEX mod.
  const elf = previewCharacter(base("shadow", { ancestryId: "high-elf" })).sheet!;
  assert.equal(elf.abilities.dex, 17);
  assert.equal(elf.armorClass, 11 + abilityModifier(17));
  // The cap: 18 rolled plus 2 is 20, and plus 1 stays under it.
  const capped = previewCharacter(
    base("knight", { ancestryId: "dragonborn", abilityMethod: "rolled", rolledScores: [18, 18, 18, 18, 18, 18], baseScores: { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 } }),
  ).sheet!;
  assert.equal(capped.abilities.str, 20);
  assert.equal(capped.abilities.cha, 19);
  assert.equal(capped.baseScores!.str, 18);
});

test("Half-Elf's free increases: chosen, defaulted from the archetype's best, and validated", () => {
  const dflt = previewCharacter(base("fireball-person", { ancestryId: "half-elf" })).sheet!;
  // Wizard base: int 15, con 14 lead, so those get the +1s; cha gets +2.
  assert.equal(dflt.abilities.int, 16);
  assert.equal(dflt.abilities.con, 15);
  assert.equal(dflt.abilities.cha, 12);
  const picked = previewCharacter(base("knight", { ancestryId: "half-elf", ancestryIncreases: ["dex", "wis"] })).sheet!;
  assert.equal(picked.abilities.dex, 14);
  assert.equal(picked.abilities.wis, 13);
  assert.equal(picked.abilities.cha, 12);
  assert.equal(picked.abilities.str, 15);
  for (const bad of [["cha", "dex"], ["dex"], ["dex", "dex"], ["dex", "wis", "con"], ["dex", "luck"]]) {
    const r = previewCharacter(base("knight", { ancestryId: "half-elf", ancestryIncreases: bad as never }));
    assert.equal(r.sheet, null, JSON.stringify(bad));
    assert.ok(r.errors.length > 0);
  }
  assert.ok(previewCharacter(base("knight", { ancestryId: "human", ancestryIncreases: ["dex"] })).errors.length > 0);
  assert.ok(previewCharacter(base("knight", { ancestryIncreases: ["dex"] })).errors.length > 0);
});

test("Half-Elf Skill Versatility picks two more skills, and no repeats are allowed", () => {
  const ok = previewCharacter(base("knight", { ancestryId: "half-elf", ancestrySkills: ["Persuasion", "Stealth"] })).sheet!;
  assert.deepEqual(
    ok.skills.map((s) => s.skill),
    ["Athletics", "Intimidation", "Persuasion", "Stealth"],
  );
  const dup = previewCharacter(base("knight", { ancestryId: "half-elf", ancestrySkills: ["Athletics", "Stealth"] }));
  assert.equal(dup.sheet, null);
  assert.ok(dup.errors.some((e) => /Athletics comes from both/.test(e)));
  assert.ok(previewCharacter(base("knight", { ancestryId: "half-elf", ancestrySkills: ["Stealth"] })).errors.length > 0);
  assert.ok(previewCharacter(base("knight", { ancestryId: "half-elf", ancestrySkills: ["Stealth", "Basketweaving"] })).errors.length > 0);
  assert.ok(previewCharacter(base("knight", { ancestryId: "human", ancestrySkills: ["Stealth"] })).errors.length > 0);
});

// ── class and background skills ────────────────────────────────────────

test("CLASS_SKILL_CHOICES is the SRD 5.1 table, and every archetype's own skills are legal picks", () => {
  assert.equal(CLASS_SKILL_CHOICES.fighter.count, 2);
  assert.equal(CLASS_SKILL_CHOICES.rogue.count, 4);
  assert.equal(CLASS_SKILL_CHOICES.wizard.count, 2);
  assert.equal(CLASS_SKILL_CHOICES.cleric.count, 2);
  assert.equal(CLASS_SKILL_CHOICES.fighter.from.length, 8);
  assert.equal(CLASS_SKILL_CHOICES.rogue.from.length, 11);
  assert.equal(CLASS_SKILL_CHOICES.wizard.from.length, 6);
  assert.equal(CLASS_SKILL_CHOICES.cleric.from.length, 5);
  for (const list of Object.values(CLASS_SKILL_CHOICES)) for (const s of list.from) assert.ok(Object.hasOwn(SKILL_ABILITY, s), s);
  for (const a of ARCHETYPES) {
    const rule = CLASS_SKILL_CHOICES[a.chassis];
    for (const s of a.startingProficiencies.skills) assert.ok(rule.from.includes(s), `${a.id} ${s}`);
    assert.ok(a.startingProficiencies.skills.length <= rule.count, a.id);
  }
});

test("custom class skills: exact count, on the list, no repeats", () => {
  const ok = previewCharacter(base("knight", { classSkills: ["Perception", "Survival"] })).sheet!;
  assert.deepEqual(ok.skills.map((s) => s.skill), ["Perception", "Survival"]);
  assert.equal(ok.skills[0]!.bonus, abilityModifier(ok.abilities.wis) + 2);
  assert.ok(previewCharacter(base("knight", { classSkills: ["Perception"] })).errors.some((e) => /exactly 2/.test(e)));
  assert.ok(previewCharacter(base("knight", { classSkills: ["Perception", "Arcana"] })).errors.some((e) => /not on this class's skill list/.test(e)));
  assert.ok(previewCharacter(base("knight", { classSkills: ["Perception", "Perception"] })).errors.some((e) => /twice/.test(e)));
  assert.ok(previewCharacter(base("knight", { classSkills: ["constructor", "toString"] })).errors.length > 0);
});

test("a Rogue picks four class skills and an Expertise from the skills it actually has", () => {
  const input = base("shadow", { classSkills: ["Acrobatics", "Stealth", "Persuasion", "Investigation"], choices: { expertiseSkill: "Persuasion" } });
  const r = previewCharacter(input);
  assert.deepEqual(r.errors, []);
  const persuasion = r.sheet!.skills.find((s) => s.skill === "Persuasion")!;
  assert.equal(persuasion.expertise, true);
  assert.equal(persuasion.bonus, abilityModifier(r.sheet!.abilities.cha) + 4);
  assert.equal(r.sheet!.skills.filter((s) => s.expertise).length, 1);
  // Not one of the chosen skills: refused.
  assert.ok(previewCharacter({ ...input, choices: { expertiseSkill: "Deception" } }).errors.length > 0);
  // The wizard's offer for those skills matches.
  const offered = creationChoicesFor("shadow", ["Acrobatics", "Stealth"])[0]!.options.map((o) => o.id);
  assert.deepEqual(offered, ["Acrobatics", "Stealth"]);
  // Expertise may fall on a background skill too.
  const bgExpert = previewCharacter(
    base("shadow", { background: { name: "Smuggler", skills: ["Survival", "Nature"] }, choices: { expertiseSkill: "Nature" } }),
  );
  assert.deepEqual(bgExpert.errors, []);
});

test("a custom background trains two skills and carries its four prompts", () => {
  const r = previewCharacter(
    base("knight", {
      classSkills: ["Athletics", "Intimidation"],
      background: { name: " Lighthouse Keeper ", skills: ["Survival", "Medicine"], personalityTrait: " Counts everything. ", ideal: "Duty", bond: "", flaw: "x".repeat(900) },
    }),
  );
  assert.deepEqual(r.errors, []);
  const sheet = r.sheet!;
  assert.deepEqual(sheet.skills.map((s) => s.skill), ["Athletics", "Intimidation", "Survival", "Medicine"]);
  assert.equal(sheet.background!.name, "Lighthouse Keeper");
  assert.equal(sheet.background!.personalityTrait, "Counts everything.");
  assert.equal(sheet.background!.ideal, "Duty");
  assert.equal(Object.hasOwn(sheet.background!, "bond"), false);
  assert.equal(sheet.background!.flaw!.length, 400);
  // Repeats across sources are refused, and a malformed background is too.
  const dup = previewCharacter(base("knight", { classSkills: ["Athletics", "Intimidation"], background: { name: "B", skills: ["Athletics", "Stealth"] } }));
  assert.ok(dup.errors.some((e) => /Athletics comes from both your class and your background/.test(e)));
  assert.ok(previewCharacter(base("knight", { background: { name: "B", skills: ["Stealth", "Stealth"] } })).errors.length > 0);
  assert.ok(previewCharacter(base("knight", { background: { name: "", skills: ["Stealth", "Nature"] } })).errors.length > 0);
  assert.ok(previewCharacter(base("knight", { background: { name: "B", skills: ["Stealth", "Juggling"] } })).errors.length > 0);
  assert.ok(previewCharacter(base("knight", { background: { name: "B", skills: ["Stealth"] } as never })).errors.length > 0);
});

test("a fixed ancestry skill steps a defaulted class skill aside but refuses an explicit repeat", () => {
  // Half-Orc trains Intimidation; the Knight's default class skills include it.
  const dflt = previewCharacter(base("knight", { ancestryId: "half-orc" })).sheet!;
  const names = dflt.skills.map((s) => s.skill);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("Intimidation") && names.includes("Athletics") && names.length === 3);
  const explicit = previewCharacter(base("knight", { ancestryId: "half-orc", classSkills: ["Athletics", "Intimidation"] }));
  assert.equal(explicit.sheet, null);
  assert.ok(explicit.errors.some((e) => /Intimidation comes from both your class and your ancestry/.test(e)));
});

test("alignment and backstory are validated and carried", () => {
  assert.equal(ALIGNMENTS.length, 10);
  const r = previewCharacter(base("knight", { alignment: "Chaotic Good", backstory: "  Raised by lamplighters.  " }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.sheet!.alignment, "Chaotic Good");
  assert.equal(r.sheet!.backstory, "Raised by lamplighters.");
  assert.ok(previewCharacter(base("knight", { alignment: "Chaotic Pickle" })).errors.some((e) => /not an alignment/.test(e)));
  assert.ok(previewCharacter(base("knight", { backstory: "x".repeat(2001) })).errors.some((e) => /at most 2000/.test(e)));
  assert.equal(Object.hasOwn(previewCharacter(base("knight", { backstory: "   " })).sheet!, "backstory"), false);
});

// ── previewCharacter and creationOptions ───────────────────────────────

test("previewCharacter never throws and collects every error at once", () => {
  const garbage: unknown[] = [
    {},
    { archetypeId: "knight" },
    { archetypeId: "knight", name: 5, appearanceAssetId: null },
    { archetypeId: "knight", name: "A", appearanceAssetId: "b", ancestryId: 7, abilityMethod: "dice", baseScores: "nope", classSkills: "nope", background: 4, ancestrySkills: "x" },
    { archetypeId: "knight", name: "A", appearanceAssetId: "b", abilityMethod: "pointBuy", baseScores: null },
    null,
    undefined,
  ];
  for (const g of garbage) {
    const r = previewCharacter(g as CreateCharacterInput);
    assert.ok(Array.isArray(r.errors));
    assert.ok(r.sheet === null ? r.errors.length > 0 : r.errors.length === 0);
  }
  const many = previewCharacter({
    archetypeId: "knight",
    name: " ",
    appearanceAssetId: "",
    ancestryId: "gelatinous-cube",
    abilityMethod: "standard",
    baseScores: { str: 18, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
    alignment: "Hungry",
  });
  assert.equal(many.sheet, null);
  assert.ok(many.errors.length >= 5, many.errors.join(" | "));
  assert.match(many.errors[0]!, /needs a name/);
  // createCharacter throws the first of them.
  assert.throws(() => createCharacter({ archetypeId: "knight", name: " ", appearanceAssetId: "" }), /needs a name/);
});

test("previewCharacter and createCharacter agree", () => {
  const input = base("fireball-person", { ancestryId: "rock-gnome", abilityMethod: "pointBuy", baseScores: { str: 8, dex: 12, con: 14, int: 15, wis: 10, cha: 8 } });
  const a = createCharacter(input);
  const b = previewCharacter(input).sheet;
  assert.deepEqual(a, b);
});

test("creationOptions gives a complete default input that builds for every archetype", () => {
  for (const a of ARCHETYPES) {
    const opts = creationOptions(a.id);
    assert.equal(opts.ancestries.length, 9);
    assert.deepEqual(opts.classSkills, { count: CLASS_SKILL_CHOICES[a.chassis].count, from: CLASS_SKILL_CHOICES[a.chassis].from });
    const d = opts.defaults;
    assert.equal(d.ancestryId, "human");
    assert.equal(d.abilityMethod, "archetype");
    assert.deepEqual(d.baseScores, a.baseAbilityScores);
    assert.equal(d.classSkills!.length, opts.classSkills.count);
    for (const s of a.startingProficiencies.skills) assert.ok(d.classSkills!.includes(s), `${a.id} keeps ${s}`);
    const r = previewCharacter(d);
    assert.deepEqual(r.errors, [], a.id);
    assert.equal(r.sheet!.ancestryId, "human");
    assert.equal(r.sheet!.skills.length, opts.classSkills.count);
    for (const choice of opts.choices) assert.ok(d.choices![choice.id], `${a.id} defaults ${choice.id}`);
  }
  assert.throws(() => creationOptions("nope"), /unknown archetype/);
});

// ── speed ──────────────────────────────────────────────────────────────

test("an ancestry's base speed shows in effectiveSpeedFt", () => {
  const dwarf = createCharacter(base("knight", { ancestryId: "hill-dwarf" }));
  assert.equal(dwarf.speedFt, 25);
  assert.equal(effectiveSpeedFt(dwarf), 25);
  assert.equal(effectiveSpeedFt(createCharacter(base("shadow", { ancestryId: "lightfoot-halfling" }))), 25);
  assert.equal(effectiveSpeedFt(createCharacter(base("shadow", { ancestryId: "human" }))), 30);
  assert.equal(effectiveSpeedFt(createCharacter(base("shadow"))), 30);
  // Armour's Strength penalty still applies on top of the ancestry's speed.
  const weak = createCharacter(base("knight", { ancestryId: "hill-dwarf", abilityMethod: "standard", baseScores: { str: 8, dex: 12, con: 15, int: 10, wis: 13, cha: 14 } }));
  assert.equal(weak.abilities.str, 8);
  assert.equal(effectiveSpeedFt(weak), 15);
});

// ── persistence ────────────────────────────────────────────────────────

test("normalizeSheet round-trips the creator's fields and leaves an old sheet unchanged", () => {
  const made = createCharacter(
    base("shadow", {
      ancestryId: "half-elf",
      abilityMethod: "standard",
      alignment: "Neutral Good",
      backstory: "Left a ledger behind.",
      background: { name: "Courier", skills: ["Survival", "Nature"], ideal: "Freedom" },
    }),
  );
  const viaJson = JSON.parse(JSON.stringify(made)) as CharacterSheet;
  const round = normalizeSheet(viaJson);
  for (const k of CREATOR_KEYS) assert.deepEqual(round[k], made[k], k);
  assert.deepEqual(normalizeSheet(round), round);

  const old = JSON.parse(JSON.stringify(createCharacter(base("knight")))) as CharacterSheet;
  const oldNormalized = normalizeSheet(old);
  for (const k of CREATOR_KEYS) assert.equal(Object.hasOwn(oldNormalized, k), false, k);
  assert.deepEqual(oldNormalized, normalizeSheet(old));
});

test("normalizeSheet drops malformed creator fields instead of trusting them", () => {
  const made = JSON.parse(JSON.stringify(createCharacter(base("knight", { ancestryId: "hill-dwarf" })))) as Record<string, unknown>;
  made.speedFt = "fast";
  made.baseScores = { str: 10 };
  made.abilityMethod = "wishful";
  made.languages = "Common";
  made.darkvisionFt = -5;
  made.traits = [{ name: "Ok", text: "fine", applied: true, source: "x" }, { name: "Bad", text: "no applied flag" }, 7];
  made.background = { name: "B", skills: ["Stealth", "Juggling"] };
  made.alignment = 12;
  made.backstory = { not: "a string" };
  const out = normalizeSheet(made as unknown as CharacterSheet);
  for (const k of ["speedFt", "baseScores", "abilityMethod", "languages", "darkvisionFt", "background", "alignment", "backstory"]) {
    assert.equal(Object.hasOwn(out, k), false, k);
  }
  assert.deepEqual(out.traits, [{ name: "Ok", text: "fine", applied: true, source: "x" }]);
  assert.equal(out.ancestryId, "hill-dwarf");
  // With no usable speed on the sheet, the engine falls back to 30.
  assert.equal(effectiveSpeedFt(out), 30);
});
