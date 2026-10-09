/**
 * Tests for the bench's character sheet and creation views: the pure parts of
 * src/games/livingtable/table/ui/sheet.ts (every tip builder, the creation helpers, the
 * features list). The DOM drawing is covered by the Playwright harness; all of
 * this runs in plain Node, which is also the proof that the module does not
 * touch the DOM at import time (the bench registry is imported in Node).
 *
 * Run: npx tsx --test test/livingtable-bench-sheet.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ABILITY_KEYS,
  ANCESTRIES,
  STANDARD_ARRAY,
  createCharacter,
  creationOptions,
  previewCharacter,
  rollAbilitySet,
  type CharacterSheet,
  type CreateCharacterInput,
} from "../src/games/livingtable/characters/creation";
import { PLAYABLE_ARCHETYPE_IDS, getArchetype } from "../src/games/livingtable/characters/templates";
import { packInfo } from "../src/games/livingtable/inventory/itemInfo";
import { saveModifierFor, skillModifierFor, weaponDamageNotationFor, attackerBonusFor, effectiveArmorClass } from "../src/games/livingtable/session/combat";
import {
  ALL_SKILLS,
  CREATION_STEPS,
  SKILL_BLURB,
  abilityTip,
  adjustPointBuy,
  ancestryIncreaseFor,
  appliedLabel,
  armorClassTip,
  assignRolledByPriority,
  attackNameTip,
  damageTip,
  deathSavesTip,
  dropLowest,
  featureList,
  featureTip,
  finalScores,
  hitDiceTip,
  hitPointsTip,
  blankDraft,
  initialDraft,
  initiativeTip,
  itemCount,
  itemTip,
  passivePerceptionTip,
  pointCost,
  proficiencyTip,
  reconcileDraft,
  saveTip,
  skillSourcesOf,
  skillTip,
  speedTip,
  spellSlotTip,
  startFromClass,
  stepForError,
  swapAssign,
  swapScore,
  toHitTip,
  scoresFromAssign,
  sheetClassName,
  sheetItemKey,
  validDiceGroups,
  type StepId,
} from "../src/games/livingtable/table/ui/sheet";
import type { TipContent } from "../src/games/livingtable/table/ui/tip";
import { heroPreview } from "../src/games/livingtable/table/ui/heroPreview";
import { parseAdventureMarkdown } from "../src/games/livingtable/adventures/markdown";
import { adventureHero } from "../src/games/livingtable/table/adventureCatalog";
import { attackerBonusFor, effectiveArmorClass, weaponDamageNotationFor } from "../src/games/livingtable/session/combat";
import { readFileSync } from "node:fs";

// The two dash glyphs the project forbids, built from code points so this file never types them.
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

function build(over: Partial<CreateCharacterInput> = {}): CharacterSheet {
  const defaults = creationOptions("knight").defaults;
  return createCharacter({ ...defaults, ...over });
}

function allText(t: TipContent): string {
  return [t.title, ...t.lines, t.footer ?? ""].join("\n");
}

function everyTip(sheet: CharacterSheet): TipContent[] {
  const tips: TipContent[] = [];
  for (const k of ABILITY_KEYS) tips.push(abilityTip(sheet, k), saveTip(sheet, k));
  for (const s of ALL_SKILLS) tips.push(skillTip(sheet, s));
  tips.push(
    armorClassTip(sheet),
    initiativeTip(sheet),
    speedTip(sheet),
    proficiencyTip(sheet),
    passivePerceptionTip(sheet),
    hitPointsTip(sheet),
    hitDiceTip(sheet),
    deathSavesTip(sheet),
    attackNameTip(sheet),
    toHitTip(sheet),
    damageTip(sheet),
  );
  for (const f of featureList(sheet)) tips.push(featureTip(f));
  for (const section of packInfo(sheet)) for (const info of section.items) tips.push(itemTip(info));
  if (sheet.spellSlots) for (const [lv, s] of Object.entries(sheet.spellSlots)) tips.push(spellSlotTip(Number(lv), s.max, s.used));
  return tips;
}

// ---- tips tell the engine's truth -----------------------------------------------

test("an ability tip says where the score came from and spells out the modifier", () => {
  const sheet = build({
    ancestryId: "half-orc",
    abilityMethod: "standard",
    baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 13 },
    classSkills: ["Athletics", "Perception"],
  });
  const tip = abilityTip(sheet, "str");
  assert.equal(sheet.abilities.str, 17);
  assert.equal(tip.title, "Strength 17");
  const text = allText(tip);
  assert.match(text, /15 from your standard array/);
  assert.match(text, /\+2 from Half-Orc/);
  assert.match(text, /\(17 - 10\) \/ 2/);
  assert.match(text, /Modifier \+3/);
  assert.match(text, /Longsword/);
  assert.equal(tip.footer, "The game applies this");
});

test("a negative modifier rounds down in its tip, and a score with no creator fields still reads", () => {
  const sheet = build();
  const low = abilityTip(sheet, "int");
  // The knight's default 8 is 9 after the default Human ancestry.
  assert.equal(sheet.abilities.int, 9);
  assert.match(allText(low), /\(9 - 10\) \/ 2, rounded down/);
  assert.match(allText(low), /Modifier -1/);
  // A sheet from before the creator existed has no baseScores at all.
  const old = { ...sheet, baseScores: undefined, abilityMethod: undefined, ancestryName: undefined, ancestryId: undefined } as CharacterSheet;
  assert.match(allText(abilityTip(old, "str")), /Your class starts at 16/);
});

test("every skill tip sums exactly to the number the engine rolls", () => {
  const sheet = build({ ancestryId: "high-elf", classSkills: ["Athletics", "Intimidation"] });
  for (const skill of ALL_SKILLS) {
    const tip = skillTip(sheet, skill);
    const total = skillModifierFor(sheet, skill);
    const s = total >= 0 ? `+${total}` : `${total}`;
    assert.equal(tip.title, `${skill} ${s}`);
    assert.ok(tip.lines[0] && tip.lines[0].length > 10, `${skill} has a plain blurb`);
    assert.equal(tip.footer, "The game applies this");
  }
  const trained = allText(skillTip(sheet, "Athletics"));
  assert.match(trained, /proficiency bonus \+2/);
  assert.match(trained, /you are trained in it/);
  assert.match(allText(skillTip(sheet, "Arcana")), /not trained/);
});

test("expertise is explained as the proficiency bonus counted twice", () => {
  const sheet = createCharacter({ ...creationOptions("shadow").defaults, choices: { expertiseSkill: "Stealth" } });
  const stealth = sheet.skills.find((s) => s.skill === "Stealth")!;
  assert.ok(stealth.expertise);
  const text = allText(skillTip(sheet, "Stealth"));
  assert.match(text, /counted twice: Expertise/);
  assert.match(text, new RegExp(`\\+${stealth.bonus} =`));
});

test("a background skill names its source", () => {
  const sheet = build({ background: { name: "Soldier", skills: ["Survival", "History"] } });
  assert.match(allText(skillTip(sheet, "Survival")), /your Soldier background/);
});

test("saving throw tips match saveModifierFor", () => {
  const sheet = build();
  for (const k of ABILITY_KEYS) {
    const tip = saveTip(sheet, k);
    const total = saveModifierFor(sheet, k);
    assert.ok(tip.title.endsWith(total >= 0 ? `+${total}` : `${total}`));
  }
  assert.match(allText(saveTip(sheet, "str")), /your class trains this save/);
  assert.match(allText(saveTip(sheet, "dex")), /does not train this save/);
});

test("armor class, speed, hit points and hit dice carry the real numbers", () => {
  const sheet = build({ ancestryId: "hill-dwarf" });
  assert.equal(armorClassTip(sheet).title, `Armor class ${effectiveArmorClass(sheet)}`);
  assert.match(allText(armorClassTip(sheet)), /Chain mail|armor/i);
  // A Hill Dwarf is 25 feet, and the Knight's chain mail may take some off.
  assert.match(allText(speedTip(sheet)), /Base 25 feet for a Hill Dwarf/);
  const hp = allText(hitPointsTip(sheet));
  // d10 + Con modifier + 1 Dwarven Toughness, all spelled out.
  assert.match(hp, /d10, so 10/);
  assert.match(hp, /1 from Hill Dwarf/);
  assert.equal(hitPointsTip(sheet).title, `Hit points ${sheet.currentHp} / ${sheet.maxHp}`);
  assert.match(allText(hitDiceTip(sheet)), /1 of 1 hit die left, each a d10/);
  assert.match(allText(deathSavesTip(sheet)), /Three successes/);
});

test("initiative and the proficiency bonus are the plain numbers they are", () => {
  const sheet = build();
  assert.match(allText(initiativeTip(sheet)), new RegExp(`Dexterity modifier \\(\\+${sheet.modifiers.dex}\\)`));
  assert.equal(proficiencyTip(sheet).title, "Proficiency bonus +2");
});

test("passive Perception says the DM rules on it, because the game never rolls against it", () => {
  const sheet = build();
  const tip = passivePerceptionTip(sheet);
  assert.equal(tip.footer, "The DM rules on this");
  assert.match(tip.title, /Passive Perception \d+/);
  assert.equal(Number(tip.title.split(" ").pop()), 10 + skillModifierFor(sheet, "Perception"));
});

test("the attack tips read the engine's own to-hit and damage", () => {
  const sheet = build();
  assert.equal(toHitTip(sheet).title, `To hit +${attackerBonusFor(sheet)}`);
  assert.equal(damageTip(sheet).title, `Damage ${weaponDamageNotationFor(sheet)}`);
  assert.match(allText(toHitTip(sheet)), /Strength and training/);
  assert.match(allText(attackNameTip(sheet)), /melee/i);
  // A Fighter who picked Archery leads with the thrown handaxe and the tip says so.
  const archer = build({ choices: { fightingStyle: "archery" } });
  assert.match(allText(toHitTip(archer)), /\+2 Archery/);
  assert.match(allText(attackNameTip(archer)), /ranged/i);
});

test("a spell caster's slots get a tip", () => {
  const sheet = createCharacter(creationOptions("fireball-person").defaults);
  assert.ok(sheet.spellSlots);
  const tip = spellSlotTip(1, 2, 1);
  assert.equal(tip.title, "1st level slots 1 of 2");
  assert.match(allText(tip), /long rest/);
});

test("features list the class choice and every ancestry trait with an honest label", () => {
  const sheet = build({ ancestryId: "dragonborn" });
  const list = featureList(sheet);
  const style = list.find((f) => f.name.startsWith("Fighting style:"));
  assert.ok(style, "the fighting style is listed");
  assert.equal(style!.applied, true);
  const breath = list.find((f) => f.name === "Breath Weapon");
  assert.ok(breath);
  assert.equal(breath!.applied, false);
  assert.equal(appliedLabel(breath!.applied), "The DM rules on this");
  assert.equal(featureTip(breath!).footer, "The DM rules on this");
  assert.equal(appliedLabel(true), "The game applies this");
  for (const f of list) assert.ok(f.text.length > 5, `${f.name} has text`);
  // Rogues list their Expertise.
  const rogue = createCharacter(creationOptions("shadow").defaults);
  assert.ok(featureList(rogue).some((f) => f.name.startsWith("Expertise:")));
  // An old sheet with no ancestry lists no traits and does not throw.
  assert.doesNotThrow(() => featureList({ ...build(), traits: undefined } as CharacterSheet));
});

test("an item tip carries the summary, the numbers, the source and the honest label last", () => {
  const sheet = build();
  const infos = packInfo(sheet).flatMap((s) => s.items);
  assert.ok(infos.length >= 5);
  for (const info of infos) {
    const tip = itemTip(info);
    assert.equal(tip.title, info.name);
    assert.ok(tip.lines.length >= 1);
    assert.match(tip.footer ?? "", /^The (game applies|DM rules on) this/);
  }
  const axe = infos.find((i) => i.name === "Handaxe");
  assert.ok(axe);
  assert.equal(itemCount(axe!), "x2");
  const potion = infos.find((i) => i.name === "Potion of healing");
  assert.ok(potion);
  assert.equal(itemCount(potion!), "x2");
});

test("no tip, label or feature text contains an em or en dash, for every class and ancestry", () => {
  for (const id of PLAYABLE_ARCHETYPE_IDS) {
    for (const a of ANCESTRIES) {
      const sheet = previewCharacter(reconcileDraft({ ...creationOptions(id).defaults, ancestryId: a.id })).sheet!;
      for (const tip of everyTip(sheet)) {
        const text = allText(tip);
        assert.ok(!text.includes(EM) && !text.includes(EN), `dash in ${tip.title} for ${id}/${a.id}`);
      }
    }
  }
  for (const s of ALL_SKILLS) assert.ok(!SKILL_BLURB[s]!.includes(EM) && !SKILL_BLURB[s]!.includes(EN));
});

test("every skill has a blurb", () => {
  assert.equal(ALL_SKILLS.length, 18);
  for (const s of ALL_SKILLS) assert.ok(SKILL_BLURB[s] && SKILL_BLURB[s]!.length > 15, s);
});

// ---- creation helpers ---------------------------------------------------------

test("the creation steps are the seven the brief asks for, in order, the name first", () => {
  assert.deepEqual(
    CREATION_STEPS.map((s) => s.id),
    ["name", "class", "ancestry", "scores", "skills", "background", "review"],
  );
});

test("a fresh draft has no name and cannot be built until it gets one (item 25)", () => {
  const draft = initialDraft();
  assert.equal(draft.name, "");
  const refused = previewCharacter(draft);
  assert.equal(refused.sheet, null);
  assert.ok(refused.errors.some((e) => /needs a name/.test(e)), refused.errors.join("|"));
  assert.equal(stepForError(refused.errors[0]!), "name");
  // Spaces are not a name.
  assert.equal(previewCharacter({ ...draft, name: "   " }).sheet, null);
  // A name is all it takes: every class starts as a complete, buildable hero.
  for (const id of PLAYABLE_ARCHETYPE_IDS) {
    const named = previewCharacter(initialDraft({ archetypeId: id, name: "Mira" }));
    assert.deepEqual(named.errors, [], id);
    assert.equal(named.sheet?.name, "Mira");
  }
  // A start that carries a name keeps it.
  assert.equal(initialDraft({ name: "Corin" }).name, "Corin");
});

test("an adventure's starting kit stays with the draft through a class change, a blank sheet and back (item 25)", () => {
  // No armor in the kit: a Knight's first fighting style (Defense) needs armor, so the draft must start on one that does not.
  const kit = { armor: "none" as const, items: ["Longsword"], potions: 0 };
  const choices = { fightingStyle: "dueling" };
  const start = initialDraft({ archetypeId: "knight", name: "Mira", startingKit: kit, choices });
  assert.deepEqual(previewCharacter(start).errors, []);
  assert.deepEqual(previewCharacter(blankDraft(start)).errors, [], "blank");
  assert.deepEqual(previewCharacter(startFromClass(blankDraft(start), "knight")).errors, [], "back from blank");
  assert.deepEqual(previewCharacter(startFromClass(start, "shadow")).errors, [], "another class");
  assert.deepEqual(previewCharacter(reconcileDraft({ ...startFromClass(start, "shadow"), archetypeId: "knight", choices: {} })).errors, [], "a class change that clears the choices");
  assert.equal(startFromClass(start, "shadow").startingKit, kit, "the kit rides along");
});

test("heroPreview gives the default stats of each class under the adventure's own kit (item 6)", () => {
  const parsed = parseAdventureMarkdown(readFileSync(new URL("../adventures/rat-cellar.md", import.meta.url), "utf8").replace(/\r\n/g, "\n"), { file: "adventures/rat-cellar.md" });
  assert.ok(parsed.adventure, parsed.errors.map((e) => e.message).join("|"));
  const adventure = parsed.adventure!;
  const byLabel = (stats: readonly { label: string; value: string }[]): Record<string, string> => Object.fromEntries(stats.map((s) => [s.label, s.value]));
  for (const [chassis, id] of [["fighter", "knight"], ["rogue", "shadow"], ["wizard", "fireball-person"]] as const) {
    const p = heroPreview(adventure, chassis);
    const sheet = adventureHero(adventure, id);
    const m = byLabel(p.stats);
    assert.equal(m.AC, String(effectiveArmorClass(sheet)), id);
    assert.equal(m.HP, String(sheet.maxHp), id);
    assert.equal(m["To hit"], `${attackerBonusFor(sheet) >= 0 ? "+" : ""}${attackerBonusFor(sheet)}`, id);
    assert.equal(m.Damage, weaponDamageNotationFor(sheet), id);
    for (const [k, name] of [["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]] as const) {
      assert.ok((m[name] ?? "").startsWith(`${sheet.abilities[k]} (`), `${id} ${name}: ${m[name]}`);
    }
    assert.equal(p.canvas, null, "no page here, so no picture");
  }
  // A class the game does not have gives no stats, and nothing throws.
  assert.deepEqual(heroPreview(adventure, "nonsense").stats, []);
});

test("the sheet names the class by the archetype, so a hero saved as The Shadow reads Rogue (item 6)", () => {
  const old = { ...build(), archetypeId: "shadow", displayName: "The Shadow" } as CharacterSheet;
  assert.equal(sheetClassName(old), "Rogue");
  assert.equal(sheetClassName({ ...old, archetypeId: "fireball-person", displayName: "The Fireball Person" } as CharacterSheet), "Mage");
  assert.equal(sheetClassName({ ...old, archetypeId: "from-the-future", displayName: "The Oddity" } as CharacterSheet), "Oddity", "an unknown class keeps its stored name");
});

test("startFromClass fills in a class's own defaults and keeps the name; blankDraft is a bare sheet (item 25)", () => {
  const typed = initialDraft({ name: "Mira", backstory: "Raised on a salt farm." });
  const mage = startFromClass(typed, "fireball-person");
  assert.equal(mage.archetypeId, "fireball-person");
  assert.equal(mage.name, "Mira");
  assert.equal(mage.backstory, "Raised on a salt farm.");
  assert.deepEqual(mage.baseScores, getArchetype("fireball-person").baseAbilityScores);
  assert.equal(mage.abilityMethod, "archetype");
  assert.equal(previewCharacter(mage).sheet?.archetypeId, "fireball-person");
  // Everything stays editable from there: an edit is kept.
  assert.equal(reconcileDraft({ ...mage, name: "Mirabel" }).name, "Mirabel");

  const blank = blankDraft(typed);
  assert.equal(blank.name, "Mira", "the name survives");
  assert.equal(blank.abilityMethod, "pointBuy");
  assert.deepEqual(blank.baseScores, { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  assert.equal(blank.ancestryId, undefined, "no ancestry");
  assert.equal(blank.background, undefined, "no background");
  const sheet = previewCharacter(blank).sheet;
  assert.ok(sheet, previewCharacter(blank).errors.join("|"));
  for (const k of ["str", "dex", "con", "int", "wis", "cha"] as const) assert.equal(sheet!.abilities[k], 8, k);
  assert.ok(sheet!.maxHp > 0, "the class still gives a hit die");
  assert.ok(sheet!.equipment, "and gear");
  // A blank sheet of any class builds.
  for (const id of PLAYABLE_ARCHETYPE_IDS) {
    const b = blankDraft(initialDraft({ archetypeId: id, name: "Z" }));
    assert.deepEqual(previewCharacter(b).errors, [], id);
  }
});

test("stepForError puts each real engine error next to the step that caused it", () => {
  const cases: [Partial<CreateCharacterInput>, StepId][] = [
    [{ name: "" }, "name"],
    [{ name: "x".repeat(61) }, "name"],
    [{ appearanceAssetId: "" }, "class"],
    [{ abilityMethod: "standard", baseScores: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 } }, "scores"],
    [{ abilityMethod: "pointBuy", baseScores: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } }, "scores"],
    [{ abilityMethod: "pointBuy", baseScores: { str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } }, "scores"],
    [{ abilityMethod: "rolled", baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } }, "scores"],
    [{ ancestryId: "nope" }, "ancestry"],
    [{ ancestryId: "half-elf", ancestryIncreases: ["str"] }, "ancestry"],
    [{ ancestryId: "half-elf", ancestryIncreases: ["cha", "str"] }, "ancestry"],
    [{ ancestryId: "half-elf", ancestrySkills: ["Stealth"] }, "skills"],
    [{ classSkills: ["Athletics"] }, "skills"],
    [{ classSkills: ["Athletics", "Arcana"] }, "skills"],
    [{ classSkills: ["Athletics", "Intimidation"], ancestryId: "half-orc" }, "skills"],
    [{ background: { name: "", skills: ["Perception", "Survival"] } }, "background"],
    // The same skill twice is a skills problem (the pickers grey the duplicate out), whoever holds it.
    [{ background: { name: "Hermit", skills: ["Perception", "Perception"] } }, "skills"],
    [{ background: { name: "Hermit", skills: ["Athletics", "Survival"] } }, "skills"],
    [{ alignment: "Wobbly" }, "background"],
    [{ backstory: "x".repeat(2001) }, "name"],
    [{ choices: { fightingStyle: "nonsense" } }, "class"],
  ];
  for (const [patch, expected] of cases) {
    const { errors, sheet } = previewCharacter({ ...creationOptions("knight").defaults, ...patch });
    assert.equal(sheet, null, `${JSON.stringify(patch)} should be refused`);
    assert.ok(errors.length > 0);
    assert.equal(stepForError(errors[0]!), expected, `${JSON.stringify(patch)}: "${errors[0]}"`);
  }
  // An expertise pick that is not one of a Rogue's skills lands on the Skills step.
  const rogue = previewCharacter({ ...creationOptions("shadow").defaults, choices: { expertiseSkill: "Arcana" } });
  assert.equal(stepForError(rogue.errors[0]!), "skills");
  assert.equal(stepForError("something nobody wrote a rule for"), "review");
});

test("reconcileDraft makes every class and ancestry a valid draft, from the plain defaults and from a tangle", () => {
  for (const id of PLAYABLE_ARCHETYPE_IDS) {
    for (const a of ANCESTRIES) {
      const plain = reconcileDraft({ ...creationOptions(id).defaults, ancestryId: a.id });
      const pv = previewCharacter(plain);
      assert.deepEqual(pv.errors, [], `${id}/${a.id}: ${pv.errors.join("; ")}`);
      assert.ok(pv.sheet);
      // A tangle: a background that fights the ancestry, repeated and bogus picks, stale half-elf picks, scores gone stale.
      const tangle = reconcileDraft({
        ...creationOptions(id).defaults,
        ancestryId: a.id,
        classSkills: ["Intimidation", "Intimidation", "Perception"],
        ancestrySkills: ["Intimidation", "Stealth", "Stealth"],
        ancestryIncreases: ["cha", "str", "str"],
        background: { name: "Soldier", skills: ["Intimidation", "Perception"] },
        abilityMethod: "pointBuy",
        baseScores: { str: 20, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      });
      const tv = previewCharacter(tangle);
      assert.deepEqual(tv.errors, [], `${id}/${a.id} tangle: ${tv.errors.join("; ")}`);
      // Every trained skill is trained once.
      const names = tv.sheet!.skills.map((s) => s.skill);
      assert.equal(new Set(names).size, names.length);
    }
  }
});

test("reconcileDraft keeps a Rogue's Expertise on a skill the Rogue actually has", () => {
  const draft = reconcileDraft({ ...creationOptions("shadow").defaults, choices: { expertiseSkill: "Arcana" } });
  const sheet = previewCharacter(draft).sheet!;
  const picked = sheet.choices.expertiseSkill!;
  assert.ok(sheet.skills.some((s) => s.skill === picked));
});

test("initialDraft is a complete draft with a background, valid once it has a name, and its start values win", () => {
  const draft = initialDraft({ name: "Test Hero" });
  assert.equal(draft.archetypeId, PLAYABLE_ARCHETYPE_IDS[0]);
  assert.equal(draft.background?.name, "Wanderer");
  assert.deepEqual(previewCharacter(draft).errors, []);
  const custom = initialDraft({ archetypeId: "shadow", name: "Mira", ancestryId: "tiefling", alignment: "Chaotic Good" });
  assert.equal(custom.archetypeId, "shadow");
  assert.equal(custom.name, "Mira");
  assert.equal(custom.ancestryId, "tiefling");
  assert.deepEqual(previewCharacter(custom).errors, []);
  // An unknown class falls back instead of throwing.
  assert.doesNotThrow(() => initialDraft({ archetypeId: "does-not-exist" }));
});

test("skillSourcesOf reports where each trained skill comes from", () => {
  const draft = initialDraft({ ancestryId: "half-orc" });
  const m = skillSourcesOf(draft);
  assert.equal(m.get("Intimidation"), "ancestry");
  for (const s of draft.classSkills ?? []) assert.equal(m.get(s), "class");
  for (const s of draft.background?.skills ?? []) assert.equal(m.get(s), "background");
});

test("finalScores matches the engine for every ancestry, including the free picks and the ceiling", () => {
  for (const a of ANCESTRIES) {
    const draft = reconcileDraft({ ...creationOptions("knight").defaults, ancestryId: a.id });
    const sheet = previewCharacter(draft).sheet!;
    const mine = finalScores(draft.baseScores!, a, draft.ancestryIncreases);
    assert.deepEqual(mine, sheet.abilities, a.id);
  }
  // The ceiling: a 20 never goes up.
  const capped = finalScores({ str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, ANCESTRIES.find((a) => a.id === "human"), undefined);
  assert.equal(capped.str, 20);
  assert.deepEqual(ancestryIncreaseFor(undefined, undefined), {});
  const halfElf = ANCESTRIES.find((a) => a.id === "half-elf")!;
  assert.deepEqual(ancestryIncreaseFor(halfElf, ["dex", "con"]), { cha: 2, dex: 1, con: 1 });
});

test("standard array assignment swaps, so it is always a legal permutation", () => {
  let s = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  s = swapScore(s, "str", 8);
  assert.equal(s.str, 8);
  assert.equal(s.cha, 15);
  assert.deepEqual([...Object.values(s)].sort((a, b) => b - a), [...STANDARD_ARRAY]);
  // Taking the value it already has changes nothing.
  assert.deepEqual(swapScore(s, "str", 8), s);
  for (const key of ABILITY_KEYS) {
    for (const v of STANDARD_ARRAY) {
      const t = swapScore(s, key, v);
      assert.deepEqual([...Object.values(t)].sort((a, b) => b - a), [...STANDARD_ARRAY]);
    }
  }
});

test("point buy keeps the 27 point budget and the 8 to 15 range", () => {
  assert.equal(pointCost(8), 0);
  assert.equal(pointCost(13), 5);
  assert.equal(pointCost(15), 9);
  assert.equal(pointCost(16), null);
  assert.equal(pointCost(7), null);
  const start = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  assert.equal(pointCost(start.str)! + pointCost(start.dex)! + pointCost(start.con)! + pointCost(start.int)! + pointCost(start.wis)! + pointCost(start.cha)!, 27);
  // The budget is spent: no raise is allowed, a lower always is, and then a raise elsewhere is.
  assert.equal(adjustPointBuy(start, "cha", 1), start);
  assert.equal(adjustPointBuy(start, "str", 1), start);
  const lowered = adjustPointBuy(start, "str", -1);
  assert.equal(lowered.str, 14);
  assert.equal(adjustPointBuy(lowered, "cha", 1).cha, 9);
  // Not below 8, not above 15.
  assert.equal(adjustPointBuy(start, "cha", -1), start);
  assert.equal(adjustPointBuy({ str: 15, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, "str", 1).str, 15);
});

test("rolled scores: drop the lowest, assign by class priority, swap keeps every roll used once", () => {
  assert.deepEqual(dropLowest([6, 1, 4, 3]), { total: 13, dropped: 1 });
  assert.deepEqual(dropLowest([2, 2, 2, 2]), { total: 6, dropped: 0 });
  assert.deepEqual(dropLowest([5, 5, 1, 1]), { total: 11, dropped: 2 });
  const scores = [9, 16, 12, 14, 8, 11];
  const assign = assignRolledByPriority("knight", scores);
  // The Knight's own order is STR, CON, DEX, WIS, CHA, INT: the best roll goes to Strength.
  const base = scoresFromAssign(scores, assign);
  assert.equal(base.str, 16);
  assert.equal(base.con, 14);
  assert.deepEqual([...Object.values(base)].sort((a, b) => a - b), [...scores].sort((a, b) => a - b));
  // Swapping keeps it a permutation of the rolled set.
  const swapped = swapAssign(assign, 0, assign[3]!);
  assert.deepEqual([...swapped].sort(), [0, 1, 2, 3, 4, 5]);
  assert.equal(scoresFromAssign(scores, swapped).str, base.int);
  assert.equal(scoresFromAssign(scores, swapped).int, base.str);
  // The engine accepts what the assignment makes, for a real roll.
  const set = rollAbilitySet(() => 0.7);
  const a2 = assignRolledByPriority("shadow", set.scores);
  const draft = reconcileDraft({ ...creationOptions("shadow").defaults, abilityMethod: "rolled", rolledScores: set.scores, baseScores: scoresFromAssign(set.scores, a2) });
  assert.equal(draft.abilityMethod, "rolled");
  assert.deepEqual(previewCharacter(draft).errors, []);
});

test("a stale method falls back to the class default instead of leaving an invalid draft", () => {
  const draft = reconcileDraft({ ...creationOptions("knight").defaults, abilityMethod: "rolled", baseScores: { str: 18, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } });
  assert.equal(draft.abilityMethod, "archetype");
  assert.deepEqual(previewCharacter(draft).errors, []);
});

test("validDiceGroups accepts only six groups of four faces from 1 to 6", () => {
  const good = [
    [1, 2, 3, 4],
    [6, 6, 6, 6],
    [1, 1, 1, 1],
    [2, 3, 4, 5],
    [3, 3, 3, 3],
    [4, 4, 4, 4],
  ];
  assert.ok(validDiceGroups(good));
  assert.ok(!validDiceGroups(good.slice(0, 5)));
  assert.ok(!validDiceGroups([...good.slice(0, 5), [1, 2, 3]]));
  assert.ok(!validDiceGroups([...good.slice(0, 5), [1, 2, 3, 7]]));
  assert.ok(!validDiceGroups([...good.slice(0, 5), [1, 2, 3, 0]]));
  assert.ok(!validDiceGroups(null));
  assert.ok(!validDiceGroups("rolled"));
});

test("adding an ancestry or switching class does not move the skills the background already holds", () => {
  const start = initialDraft({ name: "Test Hero" });
  const bgBefore = [...start.background!.skills];
  for (const a of ANCESTRIES) {
    for (const id of PLAYABLE_ARCHETYPE_IDS) {
      const next = reconcileDraft({ ...start, archetypeId: id, appearanceAssetId: creationOptions(id).defaults.appearanceAssetId, classSkills: creationOptions(id).defaults.classSkills, choices: {}, ancestryId: a.id, ancestrySkills: undefined });
      // Only a fixed ancestry skill (Half-Orc Intimidation, High Elf Perception) may displace one.
      const fixed = a.skills ?? [];
      const expected = bgBefore.filter((s) => !fixed.includes(s));
      for (const s of expected) assert.ok(next.background!.skills.includes(s), `${id}/${a.id} moved background skill ${s}`);
      assert.deepEqual(previewCharacter(next).errors, []);
    }
  }
});

test("the half-elf's free skill picks are filled around the background, not over it", () => {
  const draft = initialDraft({ ancestryId: "half-elf" });
  const bg = draft.background!.skills;
  for (const s of draft.ancestrySkills ?? []) assert.ok(!bg.includes(s), `${s} is held twice`);
  assert.deepEqual([...bg].sort(), ["Perception", "Survival"]);
});

test("sheetItemKey: the section is part of an equipment chip's key, so one name under two sections stays two things", () => {
  assert.equal(sheetItemKey("Worn", "Chain shirt"), "Worn:Chain shirt");
  assert.notEqual(sheetItemKey("Worn", "Longsword"), sheetItemKey("Bag", "Longsword"));
  // Every chip of a real kit gets a distinct key within its section.
  const keys = packInfo(build(), {}).flatMap((s) => s.items.map((i) => sheetItemKey(s.label, i.name)));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.length > 0);
});
