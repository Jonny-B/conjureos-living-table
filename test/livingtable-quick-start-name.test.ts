/**
 * "Play as the Knight" must not start an adventure with an unnamed hero. The owner's rule: a new character gives a name, first, and it is
 * required. The quick start on the hero screen therefore goes through the character maker (which opens on its Name step and keeps Begin
 * disabled until there is a name) instead of starting the game straight away.
 *
 * Run: npx tsx --test test/livingtable-quick-start-name.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { adventureHero, adventureHeroFromCreator, benchAdventures, creatorStartFor } from "../src/games/livingtable/table/adventureCatalog";
import { PLAYABLE_ARCHETYPE_IDS } from "../src/games/livingtable/characters/templates";
import { initialDraft, hasName } from "../src/games/livingtable/table/ui/sheet";
import { previewCharacter } from "../src/games/livingtable/characters/creation";
import { bindBenchDefaults } from "../scripts/asset-bench/benchHost";

bindBenchDefaults();

const SRC = readFileSync(new URL("../src/games/livingtable/table/flows/adventureStart.ts", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");

/** The body of `onQuick: (chassis) => { ... },` in showHero. */
function onQuickBody(): string {
  const at = SRC.indexOf("onQuick:");
  assert.ok(at > 0, "showHero wires onQuick");
  const open = SRC.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) return SRC.slice(open, i + 1);
  }
  throw new Error("onQuick body not closed");
}

test("the quick start opens the maker (name first) and never begins the adventure itself", () => {
  const body = onQuickBody();
  assert.match(body, /openAdventureCreation\(entry, id\)/, "Play as the X opens the maker for that class");
  assert.doesNotMatch(body, /beginAdventure/, "the quick start does not begin the game with an unnamed hero");
  assert.doesNotMatch(SRC, /adventureHero\(/, "no hero is made here with the class label as its name");
});

test("the maker opens on a draft with no name, so Begin waits (hasName is false)", () => {
  const entry = benchAdventures().find((e) => e.adventure);
  assert.ok(entry?.adventure);
  for (const id of PLAYABLE_ARCHETYPE_IDS) {
    const start = creatorStartFor(entry!.adventure!, id);
    const draft = initialDraft(start);
    assert.equal(draft.archetypeId, id);
    assert.equal(hasName(draft), false, `${id}: a quick start draft has no name until the player types one`);
    assert.ok(previewCharacter(draft).errors.some((e) => /needs a name/.test(e)), `${id}: the sheet is refused without a name`);
  }
});

test("a named quick start is the same hero the slide showed (only the name differs)", () => {
  const a = benchAdventures().find((e) => e.adventure)!.adventure!;
  for (const id of PLAYABLE_ARCHETYPE_IDS) {
    // The same start the quick start gives the maker (adventureStart.ts openAdventureCreation): the slide's hero, no ancestry added.
    const named = { ...initialDraft({ ...creatorStartFor(a, id), ancestryId: undefined, background: undefined, alignment: undefined }), name: "Mira" };
    const pv = previewCharacter(named);
    assert.ok(pv.sheet, `${id}: ${pv.errors.join("; ")}`);
    const sheet = adventureHeroFromCreator(a, pv.sheet!, named);
    const quick = adventureHero(a, id as Parameters<typeof adventureHero>[1]);
    assert.equal(sheet.name, "Mira");
    assert.equal(sheet.archetypeId, quick.archetypeId);
    assert.equal(sheet.maxHp, quick.maxHp, `${id}: hit points`);
    assert.deepEqual(sheet.abilities, quick.abilities, `${id}: ability scores`);
    assert.equal(sheet.ac, quick.ac, `${id}: armor class`);
    // The maker asks a Rogue for four class skills where the bare hero has three; every skill the slide's hero has is still there.
    for (const k of quick.skills) assert.ok(sheet.skills.some((x) => x.skill === k.skill), `${id}: keeps ${k.skill}`);
    assert.equal(sheet.appearanceAssetId, quick.appearanceAssetId, `${id}: appearance`);
  }
});
