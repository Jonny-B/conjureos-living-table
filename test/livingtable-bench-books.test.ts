/**
 * Tests for the pure helpers behind the bench's Rules and Bestiary tabs
 * (scripts/asset-bench/books.ts): formatting, filtering, search and highlight.
 * The DOM is covered by a browser check; everything here runs in plain Node,
 * which is also the proof that books.ts does not touch the DOM at import time.
 *
 * Run: npx tsx --test test/livingtable-bench-books.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOOK_TERMS,
  abilityRows,
  attributionLines,
  baseType,
  crOptions,
  engineNote,
  filterBeasts,
  filterRuleSections,
  findTerms,
  formatAc,
  formatAttack,
  formatAttackBody,
  formatCount,
  formatCr,
  formatDamage,
  formatDice,
  formatHp,
  formatModifier,
  formatSaves,
  formatSectionCount,
  formatSenses,
  formatSkills,
  formatSpeed,
  formatSubtitle,
  ROLLS_WITH_TIP,
  queryWords,
  rollsWithInfo,
  ruleBlockText,
  sizeOptions,
  splitHighlight,
  splitTierWords,
  typeOptions,
} from "../scripts/asset-bench/books";
import { FOE_TIER_WORDS } from "../src/games/livingtable/table/ui/foeDice";
import { BESTIARY, beastById } from "../src/games/livingtable/rules/bestiary";
import { RULEBOOK } from "../src/games/livingtable/rules/rulebook";
import { SRD_ATTRIBUTION } from "../src/games/livingtable/menu/labels";

const goblin = beastById("goblin")!;

/** The em dash, the en dash and the Unicode minus sign, built from code points so this file never types them. */
const DASH_CHARS = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2212)}]`);

test("formatModifier signs every number with a plain hyphen", () => {
  assert.equal(formatModifier(2), "+2");
  assert.equal(formatModifier(0), "+0");
  assert.equal(formatModifier(-1), "-1");
  assert.equal(formatModifier(-5), "-5");
  assert.ok(!DASH_CHARS.test(formatModifier(-3)), "no minus sign or dash character");
});

test("filterBeasts with no filter returns every creature, in order", () => {
  assert.deepEqual(filterBeasts(BESTIARY, {}).map((b) => b.id), BESTIARY.map((b) => b.id));
  assert.deepEqual(filterBeasts(BESTIARY, { cr: "all", type: "all", size: "all", text: "  " }).map((b) => b.id), BESTIARY.map((b) => b.id));
});

test("filterBeasts by CR, size and type", () => {
  const cr = filterBeasts(BESTIARY, { cr: "1/4" });
  assert.ok(cr.length > 1 && cr.every((b) => b.cr === "1/4"));
  assert.ok(cr.some((b) => b.id === "goblin"));
  const size = filterBeasts(BESTIARY, { size: "Small" });
  assert.ok(size.length > 0 && size.every((b) => b.size === "Small"));
  const humanoids = filterBeasts(BESTIARY, { type: "humanoid" });
  assert.ok(humanoids.some((b) => b.type === "humanoid (goblinoid)"), "a subtype matches its base type");
  assert.ok(humanoids.every((b) => baseType(b.type) === "humanoid"));
  assert.deepEqual(filterBeasts(BESTIARY, { type: "humanoid (goblinoid)" }), [], "the subtype alone is not a type option");
});

test("filterBeasts by text needs every word and ignores case", () => {
  assert.ok(filterBeasts(BESTIARY, { text: "GOBLIN" }).some((b) => b.id === "goblin"));
  const undeadCrypt = filterBeasts(BESTIARY, { text: "undead crypt" });
  assert.ok(undeadCrypt.length > 0 && undeadCrypt.every((b) => b.type.includes("undead") || /crypt/i.test(b.habitat + b.description)));
  assert.deepEqual(filterBeasts(BESTIARY, { text: "goblin xyzzy" }), []);
});

test("filterBeasts combines filters and matches one tag exactly", () => {
  const both = filterBeasts(BESTIARY, { cr: "1/4", type: "undead" });
  assert.ok(both.length > 0 && both.every((b) => b.cr === "1/4" && baseType(b.type) === "undead"));
  const tagged = filterBeasts(BESTIARY, { tag: "Undead" });
  assert.ok(tagged.length > 0 && tagged.every((b) => b.tags.includes("undead")));
  assert.deepEqual(filterBeasts(BESTIARY, { tag: "und" }), [], "a tag is matched whole, not as a fragment");
});

test("filterBeasts does not mutate its input", () => {
  const before = BESTIARY.map((b) => b.id).join();
  filterBeasts(BESTIARY, { text: "dragon", cr: "8" });
  assert.equal(BESTIARY.map((b) => b.id).join(), before);
});

test("the option lists are the values present, in a sensible order", () => {
  const crs = crOptions(BESTIARY);
  assert.equal(crs[0], "0");
  assert.ok(crs.indexOf("1/8") < crs.indexOf("1/4") && crs.indexOf("1/4") < crs.indexOf("1/2") && crs.indexOf("1/2") < crs.indexOf("1"));
  assert.ok(crs.indexOf("2") < crs.indexOf("10") || !crs.includes("10"), "numeric CRs are not sorted as text");
  assert.deepEqual(new Set(crs), new Set(BESTIARY.map((b) => b.cr)));
  const types = typeOptions(BESTIARY);
  assert.deepEqual(types, [...types].sort());
  assert.ok(types.includes("humanoid") && !types.some((t) => t.includes("(")));
  const sizes = sizeOptions(BESTIARY);
  assert.deepEqual(sizes, ["Tiny", "Small", "Medium", "Large", "Huge"].filter((s) => sizes.includes(s as never)));
});

test("formatCount", () => {
  assert.equal(formatCount(40, 40), "40 creatures");
  assert.equal(formatCount(1, 1), "1 creature");
  assert.equal(formatCount(3, 40), "3 of 40 creatures");
  assert.equal(formatCount(1, 40), "1 of 40 creatures");
  assert.equal(formatCount(0, 40), "0 of 40 creatures");
  assert.equal(formatSectionCount(12, 12), "12 sections");
  assert.equal(formatSectionCount(1, 12), "1 of 12 sections");
});

test("formatDice and formatDamage", () => {
  assert.equal(formatDice("1d6+2"), "1d6 + 2");
  assert.equal(formatDice("2d8-1"), "2d8 - 1");
  assert.equal(formatDice("2d6"), "2d6");
  assert.equal(formatDice("1"), "1");
  assert.equal(formatDamage([{ dice: "1d6+2", average: 5, type: "slashing" }]), "5 (1d6 + 2) slashing damage");
  assert.equal(
    formatDamage([
      { dice: "1d4+3", average: 5, type: "piercing" },
      { dice: "2d6", average: 7, type: "poison" },
    ]),
    "5 (1d4 + 3) piercing damage plus 7 (2d6) poison damage",
  );
  assert.equal(formatDamage([{ dice: "1", average: 1, type: "piercing" }]), "1 piercing damage", "a flat amount has no dice in brackets");
});

test("formatAttack writes the goblin's attacks in the stat block style", () => {
  const [scimitar, bow] = goblin.attacks;
  assert.equal(formatAttack(scimitar!), "Scimitar. Melee attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.");
  assert.equal(formatAttack(bow!), "Shortbow. Ranged attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.");
});

test("formatAttack carries a thrown weapon's reach and range, and an extra rule", () => {
  const thrown = BESTIARY.flatMap((b) => b.attacks).find((a) => a.kind === "melee or ranged")!;
  assert.ok(thrown, "the book has a melee or ranged attack");
  assert.match(formatAttackBody(thrown), /^Melee or ranged attack: \+\d+ to hit, reach 5 ft\. or range \d+\/\d+ ft\., /);
  const withExtra = BESTIARY.flatMap((b) => b.attacks).find((a) => a.extra)!;
  assert.ok(formatAttack(withExtra).endsWith(withExtra.extra!), "the extra text closes the line");
});

test("every attack in the book formats without losing its numbers", () => {
  for (const b of BESTIARY) {
    for (const a of b.attacks) {
      const line = formatAttack(a);
      assert.ok(line.startsWith(`${a.name}. `), `${b.id} ${a.name}`);
      assert.ok(line.includes(`${formatModifier(a.toHit)} to hit`), `${b.id} ${a.name} to hit`);
      for (const d of a.damage) assert.ok(line.includes(`${d.average}`) && line.includes(d.type), `${b.id} ${a.name} damage`);
      assert.ok(!DASH_CHARS.test(line), `${b.id} ${a.name} has no dash character`);
    }
  }
});

test("formatSpeed", () => {
  assert.equal(formatSpeed({ walk: 30 }), "30 ft.");
  assert.equal(formatSpeed({ walk: 20, swim: 40 }), "20 ft., swim 40 ft.");
  assert.equal(formatSpeed({ walk: 0, fly: 50, hover: true }), "0 ft., fly 50 ft. (hover)");
  assert.equal(formatSpeed({ walk: 30, climb: 30, burrow: 10, fly: 60, swim: 20 }), "30 ft., burrow 10 ft., climb 30 ft., fly 60 ft., swim 20 ft.");
});

test("abilityRows follows the SRD modifier", () => {
  const rows = abilityRows({ str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 });
  assert.deepEqual(rows.map((r) => r.label), ["STR", "DEX", "CON", "INT", "WIS", "CHA"]);
  assert.deepEqual(rows.map((r) => r.mod), ["-1", "+2", "+0", "+0", "-1", "-1"]);
  assert.deepEqual(rows.map((r) => r.score), [8, 14, 10, 10, 8, 8]);
});

test("saves, skills, senses, CR, HP and AC lines", () => {
  assert.equal(formatSaves({ dex: 4, wis: 2 }), "Dex +4, Wis +2");
  assert.equal(formatSaves({ con: -1 }), "Con -1");
  assert.equal(formatSaves(undefined), null);
  assert.equal(formatSaves({}), null);
  assert.equal(formatSkills({ Perception: 3, Stealth: 6 }), "Perception +3, Stealth +6");
  assert.equal(formatSkills(undefined), null);
  assert.equal(formatSenses({ senses: "darkvision 60 ft.", passivePerception: 9 }), "darkvision 60 ft., passive Perception 9");
  assert.equal(formatSenses({ senses: "none special", passivePerception: 10 }), "passive Perception 10");
  assert.equal(formatCr({ cr: "1/4", xp: 50 }), "1/4 (50 XP)");
  assert.equal(formatCr({ cr: "8", xp: 3900 }), "8 (3,900 XP)");
  assert.equal(formatHp(goblin), "7 (2d6)");
  assert.equal(formatHp({ hp: 22, hpDice: "3d8+9" }), "22 (3d8 + 9)");
  assert.equal(formatAc(goblin), "15 (leather armor, shield)");
  assert.equal(formatAc({ ac: 8 }), "8");
  assert.equal(formatSubtitle(goblin), "Small humanoid (goblinoid), neutral evil");
});

test("the engine note is honest: only creatures with a token are applied", () => {
  const board = BESTIARY.filter((b) => b.tokenAssetId);
  assert.deepEqual(board.map((b) => b.id).sort(), ["giant-rat", "goblin", "rat", "skeleton"]);
  for (const b of board) assert.match(engineNote(b), /^On the board: the game applies/);
  for (const b of BESTIARY.filter((x) => !x.tokenAssetId)) assert.match(engineNote(b), /^Reference only/);
  assert.match(engineNote(goblin), /The DM rules on every trait/);
  assert.match(engineNote(beastById("zombie")!), /The DM rules on every number and trait/);
});

test("findTerms marks the first use of each confusing term, and the pieces join back to the text", () => {
  const text = "The target must succeed on a DC 11 Constitution saving throw or fall. It can repeat the saving throw at the end of its turn.";
  const segs = findTerms(text);
  assert.equal(segs.map((s) => s.text).join(""), text);
  assert.deepEqual(segs.filter((s) => s.term).map((s) => s.term), ["dc", "saving throw"], "each term once");
  assert.deepEqual(findTerms("Plain words only."), [{ text: "Plain words only." }]);
  assert.deepEqual(findTerms("Melee attack: +4 to hit, reach 5 ft.").filter((s) => s.term).map((s) => s.term), ["to hit"]);
  assert.deepEqual(findTerms("darkvision 60 ft., passive Perception 9").filter((s) => s.term).map((s) => s.term), ["darkvision", "passive perception"]);
  assert.equal(findTerms("saving throws")[0]!.term, "saving throw", "the plural maps to the singular entry");
});

test("every term findTerms can return, and every stat block label, has a tip", () => {
  for (const key of ["ac", "hp", "cr", "xp", "passive perception", "to hit", "saving throw", "dc", "darkvision", "blindsight", "truesight", "tremorsense"]) {
    assert.ok(BOOK_TERMS[key], `a tip for ${key}`);
  }
  for (const key of ["vulnerabilities", "resistances", "immunities", "condition immunities"]) assert.ok(BOOK_TERMS[key], `a tip for ${key}`);
  for (const [key, tip] of Object.entries(BOOK_TERMS)) {
    assert.ok(tip.title && tip.lines.length > 0 && tip.lines.every((l) => l.length > 10), key);
    assert.ok(!DASH_CHARS.test(JSON.stringify(tip)), `${key} has no dash character`);
  }
  // Every term the creature text can produce resolves to a tip.
  for (const b of BESTIARY) {
    for (const text of [...b.traits.map((t) => t.text), ...b.attacks.map(formatAttackBody), b.senses, ...(b.specials ?? []).map((s) => s.text), b.multiattack ?? ""]) {
      for (const seg of findTerms(text)) if (seg.term) assert.ok(BOOK_TERMS[seg.term], `${b.id}: ${seg.term}`);
    }
  }
});

test("the XP and AC tips do not promise what the engine lacks", () => {
  assert.match(BOOK_TERMS.xp!.lines.join(" "), /milestones/);
  assert.equal(BOOK_TERMS.xp!.footer, "The DM rules on this.");
  assert.equal(BOOK_TERMS.ac!.footer, "The game applies this to creatures on the board.");
});

test("splitHighlight cuts around every match and joins back to the text", () => {
  const text = "You make a Saving Throw against the saving DC.";
  const segs = splitHighlight(text, "saving");
  assert.equal(segs.map((s) => s.text).join(""), text);
  assert.deepEqual(segs.filter((s) => s.hit).map((s) => s.text), ["Saving", "saving"], "case blind, original case kept");
  assert.deepEqual(splitHighlight("anything", ""), [{ text: "anything", hit: false }]);
  assert.deepEqual(splitHighlight("anything", "   "), [{ text: "anything", hit: false }]);
  assert.deepEqual(splitHighlight("", "x"), [{ text: "", hit: false }]);
  assert.deepEqual(splitHighlight("no match here", "zzz"), [{ text: "no match here", hit: false }]);
});

test("splitHighlight takes several words, longest first, and never builds a bad pattern", () => {
  const segs = splitHighlight("Roll a die, then roll again", "roll die");
  assert.deepEqual(segs.filter((s) => s.hit).map((s) => s.text), ["Roll", "die", "roll"]);
  for (const nasty of ["(", "[a", "a.*", "\\", "+", "$^", "a|b", "?"]) {
    assert.doesNotThrow(() => splitHighlight("(x) [a] a.*b \\ + $^ a|b ?", nasty), nasty);
  }
  const lit = splitHighlight("price (5) gold", "(5)");
  assert.deepEqual(lit.filter((s) => s.hit).map((s) => s.text), ["(5)"], "specials are literal");
});

test("queryWords", () => {
  assert.deepEqual(queryWords("  Death   SAVES "), ["death", "saves"]);
  assert.deepEqual(queryWords(""), []);
});

test("filterRuleSections: empty query is the whole book in order, a search keeps matching sections", () => {
  assert.deepEqual(filterRuleSections(RULEBOOK, "").map((s) => s.id), RULEBOOK.map((s) => s.id));
  assert.deepEqual(filterRuleSections(RULEBOOK, "   ").map((s) => s.id), RULEBOOK.map((s) => s.id));
  const dying = filterRuleSections(RULEBOOK, "death save");
  assert.ok(dying.some((s) => s.id === "dying"));
  assert.ok(dying.length < RULEBOOK.length);
  assert.deepEqual(filterRuleSections(RULEBOOK, "qqqzzzxxx"), []);
  assert.equal(filterRuleSections(RULEBOOK, "RESTING").some((s) => s.id === "resting"), true, "case blind");
});

test("filterRuleSections searches table cells, lists and notes, not just paragraphs", () => {
  for (const s of RULEBOOK) {
    for (const block of s.blocks) {
      const word = ruleBlockText(block).split(/\s+/).find((w) => /^[a-z]{6,}$/i.test(w));
      if (!word) continue;
      assert.ok(filterRuleSections(RULEBOOK, word).some((r) => r.id === s.id), `${s.id} ${block.kind} finds "${word}"`);
    }
  }
});

test("ruleBlockText reads every block kind", () => {
  assert.equal(ruleBlockText({ kind: "p", text: "a" }), "a");
  assert.equal(ruleBlockText({ kind: "list", items: ["a", "b"] }), "a b");
  assert.equal(ruleBlockText({ kind: "table", head: ["H1", "H2"], rows: [["x", "y"]] }), "H1 H2 x y");
  assert.equal(ruleBlockText({ kind: "example", text: "e" }), "e");
  assert.equal(ruleBlockText({ kind: "note", text: "n" }), "n");
});

test("the SRD attribution footer carries every part of SRD_ATTRIBUTION", () => {
  const joined = attributionLines().join("\n");
  assert.equal(attributionLines().length, 5);
  for (const part of [SRD_ATTRIBUTION.creator, SRD_ATTRIBUTION.copyright, SRD_ATTRIBUTION.license, SRD_ATTRIBUTION.licenseUrl, SRD_ATTRIBUTION.modified, SRD_ATTRIBUTION.disclaimer]) {
    assert.ok(joined.includes(part), part);
  }
});

test("splitTierWords takes a tier line apart into label, CR range and sentence", () => {
  assert.deepEqual(splitTierWords("Tier 1 (CR 1/4 to 1/2): a dark iron die in a box."), { tierLabel: "Tier 1", crRange: "CR 1/4 to 1/2", tierText: "a dark iron die in a box." });
  assert.deepEqual(splitTierWords("no shape here"), { tierLabel: "", crRange: "", tierText: "no shape here" });
  FOE_TIER_WORDS.forEach((line, i) => {
    const t = splitTierWords(line);
    assert.equal(t.tierLabel, `Tier ${i}`);
    assert.match(t.crRange, /^CR \d/);
    assert.ok(t.tierText.length > 10);
  });
});

test("rollsWithInfo gives every creature a tier, one to six marks, a look name and its tier words", () => {
  for (const b of BESTIARY) {
    const info = rollsWithInfo(b);
    assert.ok(info.look.tier >= 0 && info.look.tier <= 5, b.id);
    assert.equal(info.marks, info.look.tier + 1, b.id);
    assert.equal(info.tierLabel, `Tier ${info.look.tier}`, b.id);
    assert.ok(info.crRange.startsWith("CR "), b.id);
    assert.ok(info.tierText.length > 10 && info.look.name.length > 3, b.id);
    assert.ok(!DASH_CHARS.test(info.look.name + info.tierText + info.crRange), b.id);
  }
});

test("rollsWithInfo climbs the ladder from the rat to the dragon", () => {
  const rat = rollsWithInfo(beastById("rat")!);
  const gob = rollsWithInfo(goblin);
  const dragon = rollsWithInfo(beastById("young-green-dragon")!);
  assert.equal(rat.look.tier, 0);
  assert.equal(rat.marks, 1);
  assert.equal(gob.look.tier, 1);
  assert.equal(dragon.look.accent, "dragon");
  assert.ok(dragon.marks > gob.marks && gob.marks > rat.marks);
  assert.equal(rollsWithInfo(beastById("wight")!).look.accent, "undead");
  assert.match(rollsWithInfo(beastById("wight")!).accentNote, /^Undead/);
  assert.match(dragon.accentNote, /^Dragons/);
  assert.equal(gob.accentNote, "");
});

test("the Rolls with tip says what the owner asked it to say", () => {
  assert.equal(ROLLS_WITH_TIP.title, "Rolls with");
  assert.ok(ROLLS_WITH_TIP.lines.join(" ").includes("When this creature attacks, its dice are thrown in its own tray. Tougher creatures roll fancier dice."));
  assert.ok(!DASH_CHARS.test(JSON.stringify(ROLLS_WITH_TIP)));
});

test("books.ts is pure at import and keeps clear of dash characters", () => {
  const src = readFileSync(new URL("../scripts/asset-bench/books.ts", import.meta.url), "utf8");
  assert.ok(!DASH_CHARS.test(src), "no em or en dash in the file");
  const pure = src.split("// DOM")[0]!;
  assert.ok(!/\b(document|window)\./.test(pure), "no DOM use before the DOM section");
  assert.match(src, /export function mountRulesPanel\(el: HTMLElement, _api: unknown\): \(\) => void/);
  assert.match(src, /export function mountBestiaryPanel\(el: HTMLElement, _api: unknown\): \(\) => void/);
});
