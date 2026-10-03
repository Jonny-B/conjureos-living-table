/**
 * Tests for the hero who wears no armour, and the rat statblocks.
 *
 * What is checked (src/games/livingtable/characters/creation.ts's `startingKit`
 * and `withArmor`, characters/equipment.ts's bare armour slots,
 * menu/equipment.ts, inventory/itemActions.ts and itemInfo.ts):
 *
 *   1. AN UNARMORED KNIGHT, SHADOW AND FIREBALL PERSON are AC 10 + DEX with
 *      the sheet, the engine's reader, the label and the speed all agreeing.
 *   2. THE KIT: no pack, no potions, the class weapon kept, a weapon note
 *      that changes words and no number.
 *   3. THE GEAR ROWS: the armour-kind slots read bare, the token is not drawn
 *      in them, the DM is not told they are worn.
 *   4. PUTTING ARMOUR ON AND TAKING IT OFF round-trips through the item
 *      actions, and a default sheet round-trips exactly.
 *   5. THE SAVED SHEET keeps the state and nothing else invents it.
 *   6. FIGHTING STYLES the kit cannot back are not offered.
 *   7. THE RATS: SRD 5.1 numbers, matched to the bestiary.
 *
 * Run: npx -y tsx --test test/livingtable-armor-optional.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classArmorFor, createCharacter, creationChoicesFor, previewCharacter, withArmor, type CharacterSheet, type CreateCharacterInput } from "../src/games/livingtable/characters/creation";
import { armorSpeedPenaltyFt, equipmentStatus, isUnarmored, itemNameFor, slotIsBare, tierInSlot } from "../src/games/livingtable/characters/equipment";
import { UNARMORED_LABEL } from "../src/games/livingtable/characters/equipmentTypes";
import { BARE_SLOT_NAME, armorDisplayLabel, gearView, packItems, renderPlanFor } from "../src/games/livingtable/menu/equipment";
import { equipItem, itemActionsFor, itemStatusLine, unequipItem, NO_ARMOR_WORN_REASON, type ItemActionContext } from "../src/games/livingtable/inventory/itemActions";
import { describeCarried, describeWorn } from "../src/games/livingtable/inventory/itemInfo";
import { MONSTER_STATBLOCKS, effectiveArmorClass, effectiveSpeedFt, equipmentStatusFor, lookupStatblock, monsterCurrentHp, statblockFor, weaponDamageNotationFor, weaponFor } from "../src/games/livingtable/session/combat";
import { resolveDamage } from "../src/games/livingtable/rules/combat";
import { GEAR_CHANGE_BLOCKED } from "../src/games/livingtable/characters/equipmentTypes";

const CALM: ItemActionContext = { inFight: false, heroTurn: true, actionReady: true, heroDown: false };
const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const HEROES = [
  { id: "knight", token: "token_knight", weapon: "Longsword", style: "dueling" },
  { id: "shadow", token: "token_shadow", weapon: "Shortblade", style: undefined },
  { id: "fireball-person", token: "token_fireball_person", weapon: "Quarterstaff", style: undefined },
] as const;

function make(id: string, extra: Partial<CreateCharacterInput> = {}): CharacterSheet {
  const hero = HEROES.find((h) => h.id === id)!;
  return createCharacter({
    archetypeId: id,
    name: "Tester",
    appearanceAssetId: hero.token,
    ...(hero.style ? { choices: { fightingStyle: hero.style } } : {}),
    ...extra,
  });
}

function bare(id: string, items?: string[]): CharacterSheet {
  return make(id, { startingKit: { armor: "none", ...(items ? { items } : {}) } });
}

// ── 1. unarmored AC ─────────────────────────────────────────────────────

test("an unarmored Knight, Shadow and Fireball Person are AC 10 + DEX with nothing slowing them", () => {
  for (const hero of HEROES) {
    const sheet = bare(hero.id);
    const expected = 10 + sheet.modifiers.dex;
    assert.equal(sheet.armor, "none", hero.id);
    assert.equal(sheet.armorClass, expected, `${hero.id} stored AC`);
    assert.equal(effectiveArmorClass(sheet), expected, `${hero.id} engine AC`);
    assert.equal(sheet.armorLabel, UNARMORED_LABEL, hero.id);
    assert.equal(armorDisplayLabel(sheet), "No armor (10 + DEX)", hero.id);
    assert.equal(armorSpeedPenaltyFt(sheet), 0, `${hero.id} speed penalty`);
    assert.equal(effectiveSpeedFt(sheet), 30, `${hero.id} speed`);
    assert.equal(isUnarmored(sheet), true);
  }
});

test("the Knight's armour is worth the figure the sheet says: bare AC is chain mail's minus the armour", () => {
  const mail = make("knight");
  const none = bare("knight");
  assert.equal(none.modifiers.dex, mail.modifiers.dex);
  assert.equal(mail.armorClass, 16, "chain mail is 16 with no Dexterity added (dueling adds no AC)");
  assert.equal(none.armorClass, 10 + none.modifiers.dex);
  assert.ok(none.armorClass < mail.armorClass);
});

test("a sheet made the old way has no armor field and wears its class armour", () => {
  for (const hero of HEROES) {
    const sheet = make(hero.id);
    assert.equal("armor" in sheet, false, hero.id);
    assert.equal("weaponNote" in sheet, false, hero.id);
    assert.equal(isUnarmored(sheet), false);
  }
  assert.equal(make("shadow").armorLabel, "leather armor");
  assert.equal(make("fireball-person").armorLabel, "unarmored");
});

test("an armoured kit given explicitly is today's kit exactly", () => {
  for (const hero of HEROES) {
    assert.deepEqual(make(hero.id, { startingKit: { armor: "class" } }), make(hero.id), hero.id);
  }
});

// ── 2. the kit ──────────────────────────────────────────────────────────

test("startingKit none: an empty pack, no potions, the class weapon kept", () => {
  for (const hero of HEROES) {
    const sheet = bare(hero.id);
    assert.deepEqual(sheet.inventory, [], `${hero.id} pack`);
    assert.deepEqual(sheet.consumables, [], `${hero.id} potions`);
    assert.equal(sheet.equipment?.weapon?.tier, "common", `${hero.id} weapon slot`);
    assert.equal(itemNameFor(sheet, "weapon"), hero.weapon, `${hero.id} weapon name`);
    assert.equal(weaponDamageNotationFor(sheet), weaponDamageNotationFor(make(hero.id)), `${hero.id} numbers`);
    assert.deepEqual(packItems(sheet), []);
    assert.match(sheet.kitDescription, /^No armour and no pack: you start with a /);
  }
  assert.equal(weaponFor(bare("knight")).name, "Longsword");
  assert.equal(weaponFor(bare("fireball-person")).name, "Fire Bolt", "the wizard casts through the staff");
});

test("startingKit items and potions are what the hero carries", () => {
  const sheet = make("shadow", { startingKit: { armor: "none", items: ["Rope", "  Torch  ", ""], potions: 2 } });
  assert.deepEqual(sheet.inventory, ["Rope", "Torch"]);
  assert.equal(sheet.consumables.length, 1);
  assert.equal(sheet.consumables[0]!.name, "Potion of healing");
  assert.equal(sheet.consumables[0]!.uses, 2);
  assert.match(sheet.kitDescription, /^No armour: you start with a /, "a pack with things in it is not 'no pack'");
});

test("a weapon note changes the words and no number", () => {
  const plain = bare("shadow");
  const noted = make("shadow", { startingKit: { armor: "none", weaponNote: "a plain dagger" } });
  assert.equal(noted.weaponNote, "a plain dagger");
  assert.equal(weaponDamageNotationFor(noted), weaponDamageNotationFor(plain));
  assert.equal(itemNameFor(noted, "weapon"), itemNameFor(plain, "weapon"));
  const card = describeWorn(noted, "weapon")!;
  assert.equal(card.summary, "A plain dagger.");
  assert.ok(card.facts.some((f) => /words only|how the weapon is described/i.test(f) && /Shortblade/.test(f)));
  assert.match(card.inGame, /1d6\+2/, "the card still states the real damage");
  assert.equal(describeWorn(plain, "weapon")!.summary.startsWith("A short, quick one-handed blade"), true);
  assert.match(noted.kitDescription, /a plain dagger/);
});

test("a bad starting kit says why and makes nothing", () => {
  const base = { archetypeId: "knight", name: "T", appearanceAssetId: "token_knight" };
  const bad: unknown[] = [
    { armor: "plate" },
    { armor: "none", potions: -1 },
    { armor: "none", potions: 99 },
    { armor: "none", potions: 1.5 },
    { armor: "none", items: new Array(13).fill("x") },
    null,
  ];
  for (const kit of bad) {
    const out = previewCharacter({ ...base, startingKit: kit as never });
    assert.equal(out.sheet, null, JSON.stringify(kit));
    assert.ok(out.errors.length > 0);
  }
});

// ── 3. the gear rows, the token, the DM ─────────────────────────────────

test("an unarmored hero's armour-kind slots read bare and the others do not", () => {
  const knight = bare("knight");
  assert.equal(slotIsBare(knight, "outer"), true, "kite shield");
  assert.equal(slotIsBare(knight, "crown"), true, "plate harness");
  assert.equal(slotIsBare(knight, "weapon"), false);
  assert.equal(tierInSlot(knight, "outer"), null);
  assert.equal(itemNameFor(knight, "crown"), null);
  assert.ok(itemNameFor(knight, "boots"), "the boots are not armour and stay worn");
  assert.ok(itemNameFor(knight, "weapon"));

  const shadow = bare("shadow");
  assert.equal(slotIsBare(shadow, "outer"), true, "dark cloak is armour-kind");
  assert.equal(slotIsBare(shadow, "crown"), false, "the hood is a save-kind piece and stays");
  const wizard = bare("fireball-person");
  assert.equal(slotIsBare(wizard, "outer"), true);
  assert.equal(slotIsBare(wizard, "crown"), false);

  // The same slots on a sheet that wears armour are untouched.
  assert.equal(slotIsBare(make("knight"), "outer"), false);
  assert.equal(tierInSlot(make("knight"), "outer"), "common");
});

test("equipmentStatus marks a bare slot empty, paying nothing", () => {
  const knight = bare("knight");
  const rows = equipmentStatusFor(knight);
  assert.equal(rows.length, 3);
  const outer = rows.find((r) => r.role === "outer")!;
  assert.equal(outer.empty, true);
  assert.equal(outer.active, false);
  assert.equal(outer.bonus, 0);
  assert.ok(outer.reason && /no armour/.test(outer.reason));
  assert.equal(rows.find((r) => r.role === "weapon")!.empty, undefined);
  assert.equal(equipmentStatus(make("knight"), { weaponHands: 1, weaponName: "Longsword" }).every((r) => !r.empty), true);
});

test("the gear view says Nothing worn on a bare row and states the real AC rule", () => {
  const view = gearView(bare("knight"))!;
  const outer = view.slots.find((s) => s.role === "outer")!;
  assert.equal(outer.empty, true);
  assert.equal(outer.itemName, BARE_SLOT_NAME);
  assert.equal(outer.bonus, 0);
  assert.match(outer.plain, /10 plus your Dexterity modifier/);
  assert.equal(view.slots.find((s) => s.role === "weapon")!.empty, false);
  assert.equal(view.acBonus, 0);
  assert.equal(view.acBonusRaw, 0);
  for (const slot of gearView(make("knight"))!.slots) assert.equal(slot.empty, false);
});

test("a bare hero is not drawn in armour they are not wearing", () => {
  const knightLayers = renderPlanFor(bare("knight"))!.layers;
  const armoured = renderPlanFor(make("knight"))!.layers;
  assert.ok(knightLayers.length < armoured.length);
  const wizard = renderPlanFor(bare("fireball-person"))!;
  const wizardArmoured = renderPlanFor(make("fireball-person"))!;
  assert.equal(wizard.layers.length, wizardArmoured.layers.length - 1, "the travelling cloak is gone, hat, staff and boots remain");
});

// ── 4. putting armour on and taking it off ──────────────────────────────

test("equip then unequip body armour round-trips through the item actions", () => {
  for (const hero of [HEROES[0], HEROES[1]]) {
    const armor = classArmorFor(make(hero.id).chassis)!;
    const worn = make(hero.id);
    const start = bare(hero.id, [armor.itemName]);
    assert.deepEqual(packItems(start), [armor.itemName], `${hero.id} the armour is a pack item`);

    const actions = itemActionsFor(start, { where: "carried", name: armor.itemName }, CALM);
    assert.equal(actions[0]!.id, "equip");
    assert.equal(actions[0]!.enabled, true);

    const on = equipItem(start, { where: "carried", name: armor.itemName });
    assert.equal(on.refused, undefined, `${hero.id} ${on.line}`);
    assert.equal(on.sheet.armor, undefined, "armoured sheets carry no armor field");
    assert.equal(on.sheet.armorClass, worn.armorClass, `${hero.id} AC with armour`);
    assert.equal(on.sheet.armorLabel, worn.armorLabel);
    assert.equal(effectiveArmorClass(on.sheet), effectiveArmorClass(worn));
    assert.deepEqual(packItems(on.sheet), [], "worn armour is not a pack item");
    assert.match(on.line, new RegExp(`from ${start.armorClass} to ${worn.armorClass}`));

    const off = unequipItem(on.sheet, "armor");
    assert.equal(off.refused, undefined, `${hero.id} ${off.line}`);
    assert.equal(off.sheet.armor, "none");
    assert.equal(off.sheet.armorClass, start.armorClass);
    assert.equal(off.sheet.armorLabel, UNARMORED_LABEL);
    assert.deepEqual(packItems(off.sheet), [armor.itemName], "taken off, it is a pack item again");
    assert.equal(off.sheet.inventory.filter((i) => i === armor.itemName).length, 1, "never duplicated");
    assert.deepEqual(off.sheet, start, `${hero.id} full round trip`);
  }
});

test("a default Knight takes the chain mail off through the plate slot and puts it back", () => {
  const knight = make("knight");
  const stripped = unequipItem(knight, "crown");
  assert.equal(stripped.refused, undefined, stripped.line);
  assert.equal(stripped.sheet.armor, "none");
  assert.equal(effectiveArmorClass(stripped.sheet), 10 + knight.modifiers.dex);
  assert.equal(stripped.sheet.inventory.filter((i) => i === "Chain mail").length, 1, "the sheet already held the string");
  assert.ok(packItems(stripped.sheet).includes("Chain mail"));
  assert.equal(itemNameFor(stripped.sheet, "crown"), null);

  const back = equipItem(stripped.sheet, { where: "carried", name: "Chain mail" });
  assert.equal(back.refused, undefined, back.line);
  assert.deepEqual(back.sheet, knight, "exactly the sheet it started as");
});

test("the worn plate slot offers Unequip on a Knight in armour, and a bare one offers nothing to take off", () => {
  const knight = make("knight");
  const un = itemActionsFor(knight, { where: "worn", slot: "crown" }, CALM).find((a) => a.id === "unequip")!;
  assert.equal(un.enabled, true);
  assert.match(itemStatusLine(knight, { where: "worn", slot: "crown" }, CALM), /Unequip takes it off and puts it in your pack/);
  assert.match(itemStatusLine(knight, { where: "worn", slot: "crown" }, CALM), /10 plus your Dexterity modifier/);
  // The shield is a plain common piece with nothing magic to take off: unchanged.
  const shield = itemActionsFor(knight, { where: "worn", slot: "outer" }, CALM).find((a) => a.id === "unequip")!;
  assert.equal(shield.enabled, false);

  const none = bare("knight");
  assert.deepEqual(itemActionsFor(none, { where: "worn", slot: "crown" }, CALM), [], "nothing is there to act on");
  assert.deepEqual(itemActionsFor(none, { where: "worn", slot: "armor" }, CALM), []);
  const refused = unequipItem(none, "crown");
  assert.equal(refused.refused, NO_ARMOR_WORN_REASON);
  assert.equal(refused.sheet, none);
  assert.equal(unequipItem(none, "armor").refused, NO_ARMOR_WORN_REASON);
});

test("a Shadow takes the leather armor off by its armour slot and the worn ref reads", () => {
  const shadow = make("shadow");
  const un = itemActionsFor(shadow, { where: "worn", slot: "armor" }, CALM);
  assert.equal(un[0]!.id, "unequip");
  assert.equal(un[0]!.enabled, true);
  assert.match(itemStatusLine(shadow, { where: "worn", slot: "armor" }, CALM), /wearing it as your armour/);
  const off = unequipItem(shadow, "armor");
  assert.equal(off.refused, undefined);
  assert.equal(off.sheet.armorClass, 10 + shadow.modifiers.dex);
  assert.ok(off.sheet.inventory.includes("Leather armor"), "added to the list because the Shadow's kit never named it");
  const back = equipItem(off.sheet, { where: "carried", name: "Leather armor" });
  assert.equal(back.sheet.armorClass, shadow.armorClass);
  assert.equal(back.sheet.armor, undefined);
});

test("the wizard has no armour to put on or take off", () => {
  const wizard = make("fireball-person");
  assert.equal(classArmorFor("wizard"), null);
  assert.equal(unequipItem(wizard, "armor").refused, NO_ARMOR_WORN_REASON);
  const bareWizard = bare("fireball-person", ["Chain mail"]);
  assert.ok(equipItem(bareWizard, { where: "carried", name: "Chain mail" }).refused, "a wizard is issued none");
});

test("armour changes are refused in a fight, while down, and when it is not carried or already on", () => {
  const start = bare("knight", ["Chain mail"]);
  const fight = equipItem(start, { where: "carried", name: "Chain mail" }, { hostilesPresent: true });
  assert.equal(fight.refused, GEAR_CHANGE_BLOCKED.hostiles, "the engine's own words");
  assert.equal(fight.sheet, start);
  const off = unequipItem(make("knight"), "armor", { hostilesPresent: true });
  assert.equal(off.refused, GEAR_CHANGE_BLOCKED.hostiles);
  const downed = equipItem({ ...start, downed: true }, { where: "carried", name: "Chain mail" });
  assert.equal(downed.refused, GEAR_CHANGE_BLOCKED.down);

  assert.ok(equipItem(bare("knight"), { where: "carried", name: "Chain mail" }).refused, "not carrying it");
  assert.ok(equipItem(make("knight"), { where: "carried", name: "Chain mail" }).refused, "already wearing it");
  const ctx = { ...CALM, inFight: true };
  const action = itemActionsFor(start, { where: "carried", name: "Chain mail" }, ctx)[0]!;
  assert.equal(action.id, "equip");
  assert.equal(action.enabled, false);
  assert.ok(action.reason);
});

test("a magic piece worn in the body-armour slot of a bare hero makes them armoured", () => {
  const start: CharacterSheet = { ...bare("knight"), bag: [{ slot: "crown", tier: "uncommon" }] };
  const on = equipItem(start, { where: "bag", index: 0 });
  assert.equal(on.refused, undefined, on.line);
  assert.equal(on.sheet.armor, undefined);
  assert.equal(on.sheet.armorClass, make("knight").armorClass);
  assert.equal(slotIsBare(on.sheet, "outer"), false, "the plain shield reads as worn again with armour on");
  assert.ok(effectiveArmorClass(on.sheet) > make("knight").armorClass, "the magic bonus is paid on top");

  // A magic cloak on a bare Shadow is a real piece and pays out; the hero stays unarmored.
  const shadow: CharacterSheet = { ...bare("shadow"), bag: [{ slot: "outer", tier: "uncommon" }] };
  const cloak = equipItem(shadow, { where: "bag", index: 0 });
  assert.equal(cloak.refused, undefined, cloak.line);
  assert.equal(cloak.sheet.armor, "none");
  assert.equal(slotIsBare(cloak.sheet, "outer"), false);
  assert.equal(effectiveArmorClass(cloak.sheet), shadow.armorClass + 1);
  const taken = unequipItem(cloak.sheet, "outer");
  assert.equal(taken.refused, undefined, taken.line);
  assert.equal(slotIsBare(taken.sheet, "outer"), true, "back to bare, the magic cloak in the bag");
  assert.equal(effectiveArmorClass(taken.sheet), shadow.armorClass);
});

test("withArmor recomputes from the sheet and round-trips a default sheet exactly", () => {
  for (const hero of HEROES) {
    const sheet = make(hero.id);
    const off = withArmor(sheet, "none");
    assert.equal(off.armorClass, 10 + sheet.modifiers.dex);
    assert.equal(off.armorLabel, UNARMORED_LABEL);
    assert.deepEqual(withArmor(off, "class"), sheet, hero.id);
    assert.equal(withArmor(sheet, "class"), sheet, "no change, same object");
  }
});

test("Defense's point comes back with the armour, and is never in a bare hero's AC", () => {
  const defender = createCharacter({ archetypeId: "knight", name: "T", appearanceAssetId: "token_knight", choices: { fightingStyle: "defense" } });
  assert.equal(defender.armorClass, 17);
  const stripped = withArmor(defender, "none");
  assert.equal(stripped.armorClass, 10 + defender.modifiers.dex, "no armour, no Defense point");
  assert.equal(withArmor(stripped, "class").armorClass, 17);
});

test("the item cards for the armour state the real numbers", () => {
  const start = bare("knight", ["Chain mail"]);
  const carried = describeCarried(start, "Chain mail");
  assert.match(carried.inGame, /once you wear it/);
  assert.match(carried.inGame, new RegExp(`from ${start.armorClass} to 16`));
  const worn = describeCarried(make("knight"), "Chain mail");
  assert.match(worn.inGame, /it is your body armour/);
  const leather = describeCarried(bare("shadow", ["Leather armor"]), "Leather armor");
  assert.equal(leather.kind, "armor");
  assert.notEqual(leather.summary, "The game has no rules entry for this item.");
  assert.match(leather.inGame, /once you wear it/);
  assert.match(describeCarried(bare("shadow", ["Chain mail"]), "Chain mail").inGame, /does not work your armour class from this entry/);
  for (const info of [carried, worn, leather]) {
    for (const line of [info.summary, info.inGame, ...info.facts]) assert.ok(!DASH.test(line), line);
  }
});

// ── 6. fighting styles ──────────────────────────────────────────────────

test("a Knight with no armour is not offered Defense, and Archery needs the handaxe", () => {
  const ids = (kit?: CreateCharacterInput["startingKit"]) => creationChoicesFor("knight", undefined, kit)[0]!.options.map((o) => o.id);
  assert.deepEqual(ids(), ["defense", "dueling", "archery"], "today's offer is unchanged");
  assert.deepEqual(ids({ armor: "class" }), ["defense", "dueling", "archery"]);
  assert.deepEqual(ids({ armor: "none" }), ["dueling"]);
  assert.deepEqual(ids({ armor: "none", items: ["Handaxe x2"] }), ["dueling", "archery"]);
});

test("a bare Knight defaults to Dueling and refuses Defense in plain words", () => {
  const sheet = createCharacter({ archetypeId: "knight", name: "T", appearanceAssetId: "token_knight", startingKit: { armor: "none" } });
  assert.equal(sheet.choices.fightingStyle, "dueling");
  const refused = previewCharacter({
    archetypeId: "knight",
    name: "T",
    appearanceAssetId: "token_knight",
    choices: { fightingStyle: "defense" },
    startingKit: { armor: "none" },
  });
  assert.equal(refused.sheet, null);
  assert.match(refused.errors[0]!, /Defense needs armour/);
  const archery = previewCharacter({
    archetypeId: "knight",
    name: "T",
    appearanceAssetId: "token_knight",
    choices: { fightingStyle: "archery" },
    startingKit: { armor: "none" },
  });
  assert.equal(archery.sheet, null, "no handaxe to throw");
  const withAxe = previewCharacter({
    archetypeId: "knight",
    name: "T",
    appearanceAssetId: "token_knight",
    choices: { fightingStyle: "archery" },
    startingKit: { armor: "none", items: ["Handaxe x2"] },
  });
  assert.equal(withAxe.errors.length, 0);
});

// ── 7. the rats ─────────────────────────────────────────────────────────

test("SRD 5.1 Rat: AC 10, 1 hp, Bite +0 for 1 piercing", () => {
  const rat = lookupStatblock("token_rat")!;
  assert.equal(rat.name, "Rat");
  assert.equal(rat.armorClass, 10);
  assert.equal(rat.maxHp, 1);
  assert.equal(rat.attackBonus, 0);
  assert.equal(rat.damageNotation, "1");
  assert.deepEqual(rat.abilityModifiers, { str: -4, dex: 0, con: -1, int: -4, wis: 0, cha: -3 });
  assert.equal(monsterCurrentHp({ assetId: "token_rat" }), 1);
});

test("SRD 5.1 Giant Rat: AC 12, 7 hp, Bite +4 for 1d4+2 piercing", () => {
  const rat = lookupStatblock("token_giant_rat")!;
  assert.equal(rat.name, "Giant Rat");
  assert.equal(rat.armorClass, 12);
  assert.equal(rat.maxHp, 7);
  assert.equal(rat.attackBonus, 4);
  assert.equal(rat.damageNotation, "1d4+2");
  assert.deepEqual(rat.abilityModifiers, { str: -2, dex: 2, con: 0, int: -4, wis: 0, cha: -3 });
  assert.equal(statblockFor("token_giant_rat"), MONSTER_STATBLOCKS.token_giant_rat);
  assert.deepEqual(resolveDamage(rat.damageNotation, () => 0).rolls, [1]);
});

test("a rat's flat 1 damage is rolled by the engine, crit or not", () => {
  assert.equal(resolveDamage(MONSTER_STATBLOCKS.token_rat!.damageNotation, () => 0).total, 1);
  assert.equal(resolveDamage(MONSTER_STATBLOCKS.token_rat!.damageNotation, () => 0.99, true).total, 1);
});
