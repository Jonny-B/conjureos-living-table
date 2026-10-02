/**
 * Tests for the words on every item (src/games/livingtable/inventory/itemInfo.ts).
 *
 * The claim under test is the owner's: "Inventory items should have a hover
 * feature that explains exactly what they are so the player is never
 * confused." That breaks into four checkable promises:
 *
 *   1. COVERAGE. Every string any archetype starts with, in both templates,
 *      gets a real, specific entry, never the generic fallback.
 *   2. NO DRIFT. Gear numbers are the ones the sheet already prints
 *      (weaponCopy, armorCopy, saveCopy, accessoryCopy), live attack figures
 *      are the ones the dice use, and the healing numbers are the ones
 *      characters/health.ts rolls.
 *   3. HONESTY. Every in-game line opens with "The game applies this" or "The
 *      DM rules on this", and an item the engine does not read says so.
 *   4. NO DASH GLYPHS anywhere in what a tip can print, whatever a DM wrote.
 *
 * Run: npx tsx --test test/livingtable-item-info.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES, getArchetype } from "../src/games/livingtable/characters/templates";
import { createCharacter, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { potionHealing } from "../src/games/livingtable/characters/health";
import {
  ACCESSORY_ITEMS,
  ACCESSORY_ROLES,
  ARCHETYPE_IDS,
  BONUS_BY_TIER,
  GEAR_ROLES,
  MAGIC_TIERS,
  SLOT_ROLES,
  SLOTS_BY_ARCHETYPE,
  TIER_WORD,
  gearItemExists,
  gearItemName,
  type ArchetypeId,
  type GearRole,
} from "../src/games/livingtable/characters/equipmentTypes";
import { accessoryCopy, armorCopy, gearView, saveCopy, sheetWithGear, weaponCopy } from "../src/games/livingtable/menu/equipment";
import { attackerBonusFor, speedBeforeBootsFt, weaponDamageNotationFor, weaponFor } from "../src/games/livingtable/session/combat";
import {
  APPLIES_LABEL,
  DM_RULES_LABEL,
  DM_RULES_LINE,
  GENERIC_ITEM_SUMMARY,
  LOADOUT_GEAR_ROLE,
  describeBagItem,
  describeCarried,
  describeConsumable,
  describeWorn,
  itemTipLines,
  packInfo,
  type ItemInfo,
} from "../src/games/livingtable/inventory/itemInfo";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

function sheetFor(archetypeId: string, choices?: Record<string, string>): CharacterSheet {
  return createCharacter({ archetypeId, name: "Tester", appearanceAssetId: `token_${archetypeId}`, choices });
}

/** Every ItemInfo the module can produce for a fresh sheet of one archetype, tagged with where it came from. */
function everyInfo(sheet: CharacterSheet): { where: string; info: ItemInfo }[] {
  const out: { where: string; info: ItemInfo }[] = [];
  for (const name of sheet.inventory) out.push({ where: `carried ${name}`, info: describeCarried(sheet, name) });
  for (const role of GEAR_ROLES) {
    const worn = describeWorn(sheet, role);
    if (worn) out.push({ where: `worn ${role}`, info: worn });
  }
  for (const c of sheet.consumables) out.push({ where: `consumable ${c.name}`, info: describeConsumable(c) });
  for (const role of GEAR_ROLES) {
    for (const tier of MAGIC_TIERS) {
      if (gearItemExists(sheet.archetypeId as ArchetypeId, role, tier)) {
        out.push({ where: `bag ${role} ${tier}`, info: describeBagItem(sheet, { slot: role, tier }) });
      }
    }
  }
  for (const section of packInfo(sheet, { potions: 2 })) {
    for (const info of section.items) out.push({ where: `pack ${section.label} ${info.name}`, info });
  }
  return out;
}

// ── 1. coverage ─────────────────────────────────────────────────────────

test("every starting item of every archetype (both templates) gets a specific entry, never the generic fallback", () => {
  assert.equal(ARCHETYPES.length, 8);
  for (const archetype of ARCHETYPES) {
    const sheet = sheetFor(archetype.id);
    for (const name of archetype.startingInventory) {
      const info = describeCarried(sheet, name);
      const label = `${archetype.id}: ${name}`;
      assert.notEqual(info.summary, GENERIC_ITEM_SUMMARY, `${label} fell through to the generic summary`);
      assert.ok(info.facts.length > 0, `${label} has no facts`);
      assert.ok(info.summary.length > 10, `${label} has no real summary`);
      assert.equal(info.source, "Starting kit", `${label} should say where it came from`);
    }
  }
});

test("the whole pack of every archetype describes with no generic fallback", () => {
  for (const archetype of ARCHETYPES) {
    const sheet = sheetFor(archetype.id);
    const sections = packInfo(sheet, { potions: 2 });
    assert.deepEqual(
      sections.map((s) => s.label),
      ["Worn", "Bag", "Carried", "Consumables"],
    );
    for (const section of sections) {
      for (const info of section.items) {
        assert.notEqual(info.summary, GENERIC_ITEM_SUMMARY, `${archetype.id} ${section.label}: ${info.name}`);
      }
    }
    const worn = sections[0]!.items;
    assert.ok(worn.length >= 4, `${archetype.id} wears weapon, outer, crown and boots at the start`);
  }
});

test("Carried is the pack, not the loadout, and a consumable is not listed twice", () => {
  const knight = packInfo(sheetFor("knight"));
  const carried = knight[2]!.items.map((i) => i.name);
  assert.deepEqual(carried, ["Handaxe", "Explorer's pack"], "Longsword, Shield and Chain mail are worn kit");

  // The Medic's "Trauma kit" is a flavour string AND a three-use consumable.
  const medic = packInfo(sheetFor("medic"));
  assert.ok(!medic[2]!.items.some((i) => i.name === "Trauma kit"), "listed under Consumables only");
  assert.deepEqual(
    medic[3]!.items.map((i) => i.name),
    ["Medfoam injector", "Trauma kit"],
  );
});

test("the Explorer's pack, Burglar's pack, Priest's pack and Scholar's pack say what is inside", () => {
  const knight = sheetFor("knight");
  const explorer = describeCarried(knight, "Explorer's pack");
  assert.ok(explorer.facts.some((f) => f.includes("10 torches") && f.includes("50 feet of hempen rope")));
  assert.ok(describeCarried(sheetFor("shadow"), "Burglar's pack").facts.some((f) => f.includes("ball bearings") && f.includes("crowbar")));
  assert.ok(describeCarried(sheetFor("healer"), "Priest's pack").facts.some((f) => f.includes("incense") && f.includes("vestments")));
  assert.ok(describeCarried(sheetFor("fireball-person"), "Scholar's pack").facts.some((f) => f.includes("ink pen") && f.includes("parchment")));
  // A pack the engine does not read says so.
  assert.ok(explorer.inGame.startsWith(DM_RULES_LABEL));
});

// ── counts, spellings, unknown names, DM notes ──────────────────────────

test("stack counts parse; a comma in a name is not a count", () => {
  const knight = sheetFor("knight");
  const axes = describeCarried(knight, "Handaxe x2");
  assert.equal(axes.name, "Handaxe");
  assert.ok(axes.facts.includes("You carry 2."));
  assert.equal(describeCarried(knight, "Handaxe").facts.some((f) => f.startsWith("You carry")), false);

  const trooper = sheetFor("trooper");
  const grenades = describeCarried(trooper, "Frag grenade x2");
  assert.equal(grenades.name, "Frag grenade");
  assert.ok(grenades.facts.includes("You carry 2."));

  const bow = describeCarried(sheetFor("shadow"), "Shortbow, 20 arrows");
  assert.equal(bow.name, "Shortbow, 20 arrows");
  assert.equal(bow.facts.some((f) => f.startsWith("You carry")), false);
  assert.ok(bow.facts.some((f) => f.includes("20 arrows")));

  // Case, curly apostrophes and a spaced count all land on the same entry.
  const curly = String.fromCharCode(0x2019);
  assert.equal(describeCarried(knight, `explorer${curly}s PACK`).summary, describeCarried(knight, "Explorer's pack").summary);
  assert.ok(describeCarried(knight, "HANDAXE X 3").facts.includes("You carry 3."));
});

test("an unknown name with no note gets the honest generic line", () => {
  const info = describeCarried(sheetFor("knight"), "Rusty key");
  assert.equal(info.name, "Rusty key");
  assert.equal(info.kind, "item");
  assert.equal(info.summary, GENERIC_ITEM_SUMMARY);
  assert.equal(info.inGame, DM_RULES_LINE);
  assert.ok(info.inGame.includes("The game does not use this on its own; tell the DM what you do with it and the DM decides."));
  assert.equal(info.source, "Found");
});

test("an unknown name with a DM note uses the note, with no dash glyph in it", () => {
  const long = String.fromCharCode(0x2014);
  const notes = { "rusty key": `An old iron key ${long} the head is a tiny dragon.` };
  const info = describeCarried(sheetFor("knight"), "Rusty Key", notes);
  assert.ok(info.summary.startsWith("An old iron key, the head is a tiny dragon"));
  assert.ok(!DASH.test(JSON.stringify(info)));
  assert.equal(info.inGame, DM_RULES_LINE, "a note describes it; it does not make the engine read it");
  // A count on the name still finds the note.
  assert.ok(describeCarried(sheetFor("knight"), "Rusty key x3", notes).summary.startsWith("An old iron key"));
  // A note never overrides a real catalogue entry.
  assert.equal(describeCarried(sheetFor("knight"), "Longsword", { longsword: "A cursed thing." }).summary.includes("cursed"), false);
});

// ── 2. no drift: worn gear carries the sheet's own numbers ──────────────

test("worn gear facts carry the exact sentences weaponCopy, armorCopy and saveCopy print, at every tier of every archetype", () => {
  for (const id of ARCHETYPE_IDS) {
    for (const tier of ["common", ...MAGIC_TIERS] as const) {
      let sheet = sheetFor(id);
      for (const role of SLOT_ROLES) sheet = sheetWithGear(sheet, role, tier);
      const view = gearView(sheet)!;
      for (const role of SLOT_ROLES) {
        const info = describeWorn(sheet, role);
        assert.ok(info, `${id} ${role} ${tier}`);
        const row = view.slots.find((r) => r.role === role)!;
        const def = SLOTS_BY_ARCHETYPE[id][role];
        const bonus = BONUS_BY_TIER[tier];
        assert.equal(info!.name, def.nameByTier[["common", "uncommon", "rare", "legendary"].indexOf(tier)]);
        assert.ok(info!.facts.includes(row.plain), `${id} ${role} ${tier}: the sheet's own sentence`);
        if (row.active) {
          const expected = def.bonusKind === "weapon" ? weaponCopy(def, tier, bonus) : def.bonusKind === "armor" ? armorCopy(bonus) : saveCopy(bonus);
          assert.ok(info!.facts.includes(expected.plain), `${id} ${role} ${tier}: ${expected.plain}`);
        }
        assert.ok(info!.facts.some((f) => f.includes(TIER_WORD[tier])), `${id} ${role} ${tier}: rarity word`);
      }
    }
  }
});

test("a worn ring, amulet or boots carries accessoryCopy's sentence and its SRD source", () => {
  for (const id of ARCHETYPE_IDS) {
    for (const role of ACCESSORY_ROLES) {
      for (const tier of MAGIC_TIERS) {
        const item = ACCESSORY_ITEMS[role][tier];
        if (!item) continue;
        const sheet = sheetWithGear(sheetFor(id), role, tier);
        const info = describeWorn(sheet, role);
        assert.ok(info, `${id} ${role} ${tier}`);
        assert.equal(info!.name, gearItemName(id, role, tier));
        assert.ok(info!.facts.includes(accessoryCopy(role, tier, speedBeforeBootsFt(sheet))), `${id} ${role} ${tier}`);
        assert.ok(info!.facts.some((f) => f.includes(item.srd!.name)), "names the SRD item it reskins");
        for (const note of item.simplified) assert.ok(info!.facts.includes(note), "states every place this game differs from the SRD");
        if (item.requiresAttunement) assert.ok(info!.facts.some((f) => f.startsWith("Attuned:")), "wearing attunes");
        else assert.ok(info!.facts.includes("No attunement needed."));
        assert.ok(info!.inGame.startsWith(APPLIES_LABEL));
      }
    }
  }
});

test("common boots are described; an empty ring or amulet, an unknown slot and an unknown archetype are null", () => {
  const sheet = sheetFor("knight");
  const boots = describeWorn(sheet, "boots");
  assert.ok(boots);
  assert.equal(boots!.name, "Travel Boots");
  assert.ok(boots!.facts.includes(accessoryCopy("boots", "common", 30)));
  assert.equal(describeWorn(sheet, "ring"), null);
  assert.equal(describeWorn(sheet, "amulet"), null);
  assert.equal(describeWorn(sheet, "nonsense"), null);
  assert.equal(describeWorn({ ...sheet, archetypeId: "mystery" }, "weapon"), null);
});

test("a bagged piece names itself, its rarity, its attunement and the same effect sentence the sheet prints", () => {
  for (const id of ARCHETYPE_IDS) {
    const sheet = sheetFor(id);
    for (const role of GEAR_ROLES) {
      for (const tier of MAGIC_TIERS) {
        if (!gearItemExists(id, role, tier)) continue;
        const info = describeBagItem(sheet, { slot: role, tier });
        assert.equal(info.name, gearItemName(id, role, tier));
        assert.ok(info.facts.some((f) => f.startsWith(`Rarity: ${TIER_WORD[tier]}`)), `${id} ${role} ${tier}`);
        assert.ok(info.facts.some((f) => f.includes("attunement") || f.startsWith("Needs attunement")), `${id} ${role} ${tier}: attunement stated`);
        assert.ok(info.inGame.startsWith(APPLIES_LABEL));
        assert.ok(info.inGame.includes("adds nothing yet"), "a bagged piece is not worn, and says so");
        assert.equal(info.source, "Loot");
      }
    }
  }
  // The effect sentence is the identical string the gear rows use.
  const knight = sheetFor("knight");
  const def = SLOTS_BY_ARCHETYPE.knight.weapon;
  assert.ok(describeBagItem(knight, { slot: "weapon", tier: "rare" }).facts.includes(weaponCopy(def, "rare", 2).plain));
  assert.ok(describeBagItem(knight, { slot: "ring", tier: "rare" }).facts.includes(accessoryCopy("ring", "rare", 30)));
});

test("a bagged piece shows its live before and after, and boots, which move none of the three numbers, show none", () => {
  const knight = sheetFor("knight");
  const armour = describeBagItem(knight, { slot: "crown", tier: "rare" });
  const line = armour.facts.find((f) => f.startsWith("If you wear it: Armour class "))!;
  assert.ok(line, "an armour piece shows armour class before and after");
  const [, before, after] = /Armour class (\d+) -> (\d+)/.exec(line)!;
  assert.equal(Number(before), knight.armorClass);
  assert.equal(Number(after), Number(before) + 2, "a rare piece is worth +2");
  const ring = describeBagItem(knight, { slot: "ring", tier: "rare" });
  assert.ok(ring.facts.some((f) => f.includes("Armour class") && f.includes("Saving throw bonus")), "a Ring of Protection moves both");
  assert.equal(describeBagItem(knight, { slot: "boots", tier: "rare" }).facts.some((f) => f.startsWith("If you wear it")), false);
});

// ── the live numbers come from the engine ───────────────────────────────

test("a weapon in the pack states the engine's own attack: the same dice string and to-hit the d20 uses", () => {
  for (const archetype of ARCHETYPES) {
    const sheet = sheetFor(archetype.id);
    const dice = weaponDamageNotationFor(sheet);
    const hit = `+${attackerBonusFor(sheet)} to hit`;
    const slot = describeWorn(sheet, "weapon")!;
    assert.ok(slot.inGame.includes(dice), `${archetype.id}: ${slot.inGame}`);
    assert.ok(slot.inGame.includes(hit), `${archetype.id}: ${slot.inGame}`);
    assert.ok(slot.inGame.startsWith(APPLIES_LABEL));
    // And the carried string that IS that weapon agrees with the gear row.
    const carriedName = Object.keys(LOADOUT_GEAR_ROLE[archetype.id]!).find((k) => LOADOUT_GEAR_ROLE[archetype.id]![k] === "weapon")!;
    const original = archetype.startingInventory.find((s) => s.toLowerCase() === carriedName)!;
    const carried = describeCarried(sheet, original);
    assert.ok(carried.inGame.includes(dice), `${archetype.id}: carried ${original}: ${carried.inGame}`);
    assert.ok(carried.inGame.startsWith(APPLIES_LABEL));
  }
});

test("a weapon the engine is not rolling says so, and names the one it is", () => {
  const knight = sheetFor("knight", { fightingStyle: "defense" });
  assert.equal(weaponFor(knight).name, "Longsword");
  const axe = describeCarried(knight, "Handaxe x2");
  assert.ok(axe.inGame.startsWith(DM_RULES_LABEL));
  assert.ok(axe.inGame.includes("Longsword") && axe.inGame.includes(weaponDamageNotationFor(knight)));
  assert.ok(axe.inGame.includes("Archery"), "tells a Knight how the axe becomes the weapon");

  // Archery flips it, and every sentence follows.
  const archer = sheetFor("knight", { fightingStyle: "archery" });
  assert.equal(weaponFor(archer).name, "Thrown handaxe");
  const archerAxe = describeCarried(archer, "Handaxe x2");
  assert.ok(archerAxe.inGame.startsWith(APPLIES_LABEL));
  assert.ok(archerAxe.inGame.includes(weaponDamageNotationFor(archer)));
  assert.ok(archerAxe.inGame.includes("Archery adds +2 to hit"));
  assert.ok(describeCarried(archer, "Longsword").inGame.startsWith(DM_RULES_LABEL));

  // A Shadow's shortbow is never the engine's weapon.
  const shadow = sheetFor("shadow");
  const bow = describeCarried(shadow, "Shortbow, 20 arrows");
  assert.ok(bow.inGame.startsWith(DM_RULES_LABEL));
  assert.ok(bow.inGame.includes("Shortblade"));
  assert.ok(bow.inGame.includes("does not count arrows"));
});

test("a focus the engine casts through is described as a focus, not as the weapon swung", () => {
  const wizard = sheetFor("fireball-person");
  const staff = describeCarried(wizard, "Quarterstaff");
  assert.ok(staff.inGame.startsWith(APPLIES_LABEL));
  assert.ok(staff.inGame.includes("Fire Bolt") && staff.inGame.includes("1d10"));
  const psion = describeCarried(sheetFor("psion"), "Neural focus");
  assert.ok(psion.inGame.includes("Neural Lash"));
});

test("armour and shield lines are honest about what the engine reads", () => {
  const knight = sheetFor("knight");
  const mail = describeCarried(knight, "Chain mail");
  assert.ok(mail.inGame.startsWith(APPLIES_LABEL));
  assert.ok(mail.inGame.includes(`armour class is ${knight.armorClass}`));
  assert.ok(mail.inGame.includes("meets its requirement"), "Strength 15 clears chain mail's 13");
  assert.ok(mail.facts.some((f) => f.startsWith("Your gear row shows it as Plate Harness")));
  // The SRD's flat +2 is NOT added for a fighter, and the tip says so.
  const shield = describeCarried(knight, "Shield");
  assert.ok(shield.inGame.includes("not added"));
  assert.ok(shield.facts.includes("+2 armour class."));
  assert.ok(shield.facts.some((f) => f.startsWith("Your gear row shows it as Kite Shield")));
  // A Cleric's armour line already folds the shield in.
  const healer = sheetFor("healer");
  assert.ok(describeCarried(healer, "Shield").inGame.includes("already folded"));
  // The Healer's scale mail is not what the engine reads, and the tip does not pretend it is.
  const scale = describeCarried(healer, "Scale mail");
  assert.ok(scale.inGame.includes("not with the SRD's numbers"));
  assert.ok(scale.inGame.includes(healer.armorLabel));
});

test("a fighter too weak for chain mail is told what it costs", () => {
  const weak = { ...sheetFor("knight"), abilities: { ...sheetFor("knight").abilities, str: 10 } };
  const mail = describeCarried(weak, "Chain mail");
  assert.ok(mail.inGame.includes("costs you 10 feet of speed"));
});

test("spellcasting gear is honest that the game never checks for it", () => {
  for (const [id, name] of [
    ["fireball-person", "Spellbook"],
    ["fireball-person", "Component pouch"],
    ["healer", "Holy symbol"],
  ] as const) {
    const info = describeCarried(sheetFor(id), name);
    assert.ok(info.inGame.startsWith(DM_RULES_LABEL), name);
    assert.ok(info.inGame.includes("your spells and slots work without it"), name);
  }
});

test("every loadout key names a real loadout string and a gear slot the archetype has", () => {
  for (const archetype of ARCHETYPES) {
    const map = LOADOUT_GEAR_ROLE[archetype.id];
    assert.ok(map, archetype.id);
    const loadout = archetype.loadoutInventory.map((s) => s.toLowerCase());
    for (const [key, role] of Object.entries(map!)) {
      assert.ok(loadout.includes(key), `${archetype.id}: "${key}" is not in loadoutInventory`);
      assert.ok(GEAR_ROLES.includes(role as GearRole));
    }
  }
});

// ── consumables ─────────────────────────────────────────────────────────

test("a healing consumable states the healing the engine really rolls", () => {
  // Pin the typed-in numbers to characters/health.ts: 2d4+2 is 4 to 10.
  assert.equal(potionHealing(() => 0), 4);
  assert.equal(potionHealing(() => 0.999999), 10);

  for (const archetype of ARCHETYPES) {
    for (const c of archetype.startingConsumables) {
      const info = describeConsumable(c);
      assert.equal(info.kind, "consumable");
      assert.equal(info.name, c.name);
      assert.equal(info.summary, c.description);
      assert.ok(info.facts.includes("Heals 2d4+2 hit points per use (4 to 10)."));
      assert.ok(info.facts.includes(`Uses left: ${c.uses}.`));
      assert.ok(info.inGame.startsWith(APPLIES_LABEL));
    }
  }
  const spent = describeConsumable(getArchetype("knight").startingConsumables[0]!, 0);
  assert.ok(spent.facts.includes("Uses left: 0."));
  assert.ok(spent.inGame.includes("none are left"));
  assert.ok(describeConsumable(getArchetype("knight").startingConsumables[0]!, 5).facts.includes("Uses left: 5."));
});

test("packInfo's potion count replaces the sheet's own, and the bench's potion reads like every other healing consumable", () => {
  const knight = sheetFor("knight");
  const withFive = packInfo(knight, { potions: 5 })[3]!.items;
  assert.equal(withFive.length, 1);
  assert.equal(withFive[0]!.name, "Potion of healing");
  assert.ok(withFive[0]!.facts.includes("Uses left: 5."));
  assert.equal(packInfo(knight, { potions: 0 })[3]!.items.length, 0, "none left means no entry");
  assert.ok(packInfo(knight)[3]!.items[0]!.facts.includes("Uses left: 2."), "no override: the sheet's own two");

  // A sci-fi hero with no potion of its own is given the bench's one when the bench keeps a count.
  const trooper = sheetFor("trooper");
  const names = packInfo(trooper, { potions: 3 })[3]!.items.map((i) => i.name);
  assert.deepEqual(names, ["Potion of healing", "Medfoam injector"]);
  const potion = packInfo(trooper, { potions: 3 })[3]!.items[0]!;
  assert.equal(potion.summary, getArchetype("knight").startingConsumables[0]!.description);
});

// ── 3. honesty, 4. no dashes ────────────────────────────────────────────

test("every in-game line opens with one of the two honest labels, for everything the module can describe", () => {
  for (const archetype of ARCHETYPES) {
    for (const { where, info } of everyInfo(sheetFor(archetype.id))) {
      assert.ok(
        info.inGame.startsWith(APPLIES_LABEL) || info.inGame.startsWith(DM_RULES_LABEL),
        `${archetype.id} ${where}: "${info.inGame}"`,
      );
      assert.ok(info.summary.length > 0 && info.inGame.length > 0, `${archetype.id} ${where}`);
    }
  }
});

test("no dash glyph appears in anything a tip can print, across every archetype, tier and slot", () => {
  for (const archetype of ARCHETYPES) {
    const sheet = sheetFor(archetype.id);
    for (const { where, info } of everyInfo(sheet)) {
      for (const line of itemTipLines(info)) assert.ok(!DASH.test(line), `${archetype.id} ${where}: ${line}`);
      assert.ok(!DASH.test(info.name), `${archetype.id} ${where}: name`);
    }
    // Magic gear worn too, and the packs with a bag.
    let geared = sheet;
    for (const role of GEAR_ROLES) {
      const tier = gearItemExists(archetype.id as ArchetypeId, role, "rare") ? "rare" : "uncommon";
      if (gearItemExists(archetype.id as ArchetypeId, role, tier)) geared = sheetWithGear(geared, role, tier);
    }
    for (const section of packInfo({ ...geared, bag: [{ slot: "ring", tier: "legendary" }, { slot: "weapon", tier: "legendary" }] }, { potions: 1 })) {
      for (const info of section.items) for (const line of itemTipLines(info)) assert.ok(!DASH.test(line), `${archetype.id} ${section.label}: ${line}`);
    }
  }
});

// ── the pack: a hero with loot, and degradation ─────────────────────────

test("packInfo lists worn, bag, carried and consumables in order, and the bag carries what loot found", () => {
  const knight = { ...sheetFor("knight"), bag: [{ slot: "ring" as const, tier: "rare" as const }, { slot: "boots" as const, tier: "uncommon" as const }] };
  const sections = packInfo(knight);
  assert.deepEqual(sections.map((s) => s.label), ["Worn", "Bag", "Carried", "Consumables"]);
  assert.deepEqual(sections[0]!.items.map((i) => i.name), ["Longsword", "Kite Shield", "Plate Harness", "Travel Boots"]);
  assert.deepEqual(sections[1]!.items.map((i) => i.name), ["Ring of Protection", "Boots of Elvenkind"]);
  assert.ok(sections[1]!.items.every((i) => i.source === "Loot"));
  assert.deepEqual(sections[2]!.items.map((i) => i.name), ["Handaxe", "Explorer's pack"]);
  assert.deepEqual(sections[3]!.items.map((i) => i.name), ["Potion of healing"]);
});

test("an archetype the table has never heard of degrades to describing what it can, never throwing", () => {
  const stray = { ...sheetFor("knight"), archetypeId: "mystery" };
  const sections = packInfo(stray, { potions: 1 });
  assert.equal(sections[0]!.items.length, 0, "no gear table, no worn rows");
  assert.ok(sections[2]!.items.length > 0, "every carried string still describes");
  assert.equal(describeBagItem(stray, { slot: "weapon", tier: "rare" }).summary, GENERIC_ITEM_SUMMARY);
});

test("itemTipLines is the summary, then the facts, then the in-game line", () => {
  const info = describeCarried(sheetFor("knight"), "Handaxe x2");
  const lines = itemTipLines(info);
  assert.equal(lines[0], info.summary);
  assert.deepEqual(lines.slice(1, -1), info.facts);
  assert.equal(lines[lines.length - 1], info.inGame);
});

test("an item's name, kind and source are filled for every starting item, so a tip never has a blank header", () => {
  const kinds = new Set<string>();
  for (const archetype of ARCHETYPES) {
    const sheet = sheetFor(archetype.id);
    for (const { info } of everyInfo(sheet)) {
      assert.ok(info.name.length > 0);
      kinds.add(info.kind);
    }
  }
  for (const kind of ["weapon", "armor", "accessory", "consumable", "kit", "item"]) assert.ok(kinds.has(kind), `no ${kind} described`);
});
