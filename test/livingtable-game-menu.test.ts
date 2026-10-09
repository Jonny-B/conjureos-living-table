/**
 * Tests for the in-game menu and the side panel (bug bash items 14, 13, 20, 21, 24 and 27): the pure parts of
 * src/games/livingtable/table/ui/gameMenu.ts (the tab order, the slots around the doll, the bag), the panel's small-screen rule and the
 * Settings choice, plus source checks that the wiring is what the brief says. The DOM drawing is covered by scripts/e2e/specs/menu.spec.mjs;
 * everything here runs in plain Node, which is also the proof that the modules do not touch the document at import time.
 *
 * Run: npx -y tsx --test test/livingtable-game-menu.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createCharacter, creationOptions, withArmor, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { BAG_CAPACITY, type BagItem } from "../src/games/livingtable/characters/equipmentTypes";
import {
  MENU_TABS,
  bagCells,
  dollScale,
  dollSlots,
  firstUsableTab,
  isMenuTab,
  menuTabStep,
  previewSummary,
  statValue,
  tabUsable,
  STAT_ROWS,
} from "../src/games/livingtable/table/ui/gameMenu";
import { CONDENSED_MAX_PX, DRAWER_TABS, SETTING_CHOICES, condensedHud, settingValue } from "../src/games/livingtable/table/ui/hudHelpers";
import type { HudSettings } from "../src/games/livingtable/table/ui/hudTypes";
import { statsOf } from "../src/games/livingtable/menu/statPreview";
import { heroLineOf } from "../src/games/livingtable/table/flows/gameMenuFlow";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

const TABLE = new URL("../src/games/livingtable/table/", import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, TABLE), "utf8");

function hero(archetypeId: string, over: Partial<CharacterSheet> = {}): CharacterSheet {
  const defaults = creationOptions(archetypeId).defaults;
  return { ...createCharacter({ ...defaults, name: "Tester" }), ...over };
}

// ---- the tabs ------------------------------------------------------------------

test("the menu has six tabs in the owner's order, named Character, Inventory, Journal, Log, Saves and Settings", () => {
  assert.deepEqual(MENU_TABS.map((t) => t.id), ["character", "inventory", "journal", "log", "saves", "settings"]);
  assert.deepEqual(MENU_TABS.map((t) => t.label), ["Character", "Inventory", "Journal", "Log", "Saves", "Settings"]);
  assert.ok(!MENU_TABS.some((t) => /sheet|pack/i.test(t.label)), "Sheet is Character now, and the pack is the Inventory");
  assert.deepEqual(MENU_TABS.filter((t) => t.key).map((t) => `${t.id}:${t.key}`), ["character:C", "inventory:I", "journal:J", "log:L"], "the keys C, I, J and L");
  for (const t of MENU_TABS) assert.ok(isMenuTab(t.id));
  assert.equal(isMenuTab("sheet"), false);
  assert.equal(isMenuTab(undefined), false);
});

test("Journal, Log, Character and Inventory need a game in play; Saves and Settings work anywhere", () => {
  for (const id of ["character", "inventory", "journal", "log"] as const) {
    assert.equal(tabUsable(id, true), true);
    assert.equal(tabUsable(id, false), false, `${id} is off with no game`);
  }
  for (const id of ["saves", "settings"] as const) {
    assert.equal(tabUsable(id, false), true, `${id} works over the main menu`);
    assert.equal(tabUsable(id, true), true);
  }
});

test("firstUsableTab and menuTabStep: the asked tab if it can be used, else the first that can; stepping wraps and skips the tabs that are off", () => {
  assert.equal(firstUsableTab("inventory", true), "inventory");
  assert.equal(firstUsableTab(undefined, true), "character");
  assert.equal(firstUsableTab("character", false), "saves", "over the main menu the menu opens on Saves");
  assert.equal(firstUsableTab("settings", false), "settings");
  assert.equal(menuTabStep("character", 1, true), "inventory");
  assert.equal(menuTabStep("character", -1, true), "settings", "wraps round");
  assert.equal(menuTabStep("settings", 1, true), "character");
  assert.equal(menuTabStep("saves", 1, false), "settings");
  assert.equal(menuTabStep("settings", 1, false), "saves", "skips the four that are off");
  assert.equal(menuTabStep("saves", -1, false), "settings");
});

// ---- the slots around the doll ---------------------------------------------------

test("seven slots around the doll: the engine's six gear roles and the body armour, three on each side and one under it; nothing invented", () => {
  const slots = dollSlots(hero("knight"));
  assert.equal(slots.length, 7);
  assert.deepEqual(slots.filter((s) => s.area === "left").map((s) => s.role), ["weapon", "outer", "ring"]);
  assert.deepEqual(slots.filter((s) => s.area === "right").map((s) => s.role), ["crown", "amulet", "boots"]);
  assert.deepEqual(slots.filter((s) => s.area === "bottom").map((s) => s.role), ["armor"]);
  const labels = slots.map((s) => s.label).join(" | ");
  assert.doesNotMatch(labels, /glove|belt|shoulder|helm/i, "no slot the engine does not have");
});

test("the slots are named per class, off the engine's own words", () => {
  const knight = dollSlots(hero("knight"));
  assert.equal(knight.find((s) => s.role === "weapon")!.label, "Weapon");
  assert.equal(knight.find((s) => s.role === "outer")!.label, "Shield or cloak");
  assert.equal(knight.find((s) => s.role === "crown")!.label, "Armour");
  assert.equal(knight.find((s) => s.role === "amulet")!.label, "Amulet");
  const rogue = dollSlots(hero("shadow"));
  assert.equal(rogue.find((s) => s.role === "crown")!.label, "Headwear (saving throws)", "a Rogue's crown piece is a hood, not armour");
  const trooper = dollSlots(hero("trooper"));
  assert.equal(trooper.find((s) => s.role === "amulet")!.label, "Tag", "the sci-fi word for an amulet");
  assert.deepEqual(dollSlots({ ...hero("knight"), archetypeId: "not-a-class" }), [], "an unknown class has no slots, not a crash");
});

test("what is worn shows by name and tier: the plain starting pieces, a magic piece, and nothing in an empty ring slot", () => {
  const plain = dollSlots(hero("knight"));
  assert.equal(plain.find((s) => s.role === "weapon")!.item, "Longsword");
  assert.equal(plain.find((s) => s.role === "weapon")!.tier, "common");
  assert.equal(plain.find((s) => s.role === "ring")!.item, null, "the ring slot starts empty");
  assert.equal(plain.find((s) => s.role === "ring")!.tier, null);
  const magic = dollSlots({ ...hero("knight"), equipment: { weapon: { slot: "weapon", tier: "rare" }, ring: { slot: "ring", tier: "rare" } } });
  assert.equal(magic.find((s) => s.role === "weapon")!.item, "Sword of the Vigil");
  assert.equal(magic.find((s) => s.role === "weapon")!.tier, "rare");
  assert.equal(magic.find((s) => s.role === "ring")!.item, "Ring of Protection");
});

test("the body armour slot is the hero's armour, or empty for a hero who wears none", () => {
  const wearing = hero("knight", { armor: undefined });
  assert.equal(dollSlots(wearing).find((s) => s.role === "armor")!.item, wearing.armorLabel.charAt(0).toUpperCase() + wearing.armorLabel.slice(1));
  const bare = withArmor(hero("knight"), "none");
  assert.equal(dollSlots(bare).find((s) => s.role === "armor")!.item, null);
});

// ---- the bag ----------------------------------------------------------------------

test("the bag is eighteen cells in reading order, a piece or an empty cell", () => {
  assert.equal(BAG_CAPACITY, 18);
  assert.equal(bagCells(undefined).length, 18);
  assert.ok(bagCells([]).every((c) => c === null));
  const bag: BagItem[] = [{ slot: "weapon", tier: "rare" }, { slot: "boots", tier: "uncommon" }];
  const cells = bagCells(bag);
  assert.equal(cells.length, 18);
  assert.deepEqual(cells[0], bag[0]);
  assert.deepEqual(cells[1], bag[1]);
  assert.ok(cells.slice(2).every((c) => c === null));
});

test("the doll is drawn at a whole-number scale that fits the room, between 4 and 8", () => {
  assert.equal(dollScale(100), 4, "never below the smallest scale");
  assert.equal(dollScale(2000), 8, "never above the largest");
  for (const w of [200, 264, 296, 340, 390, 500, 700]) {
    const s = dollScale(w);
    assert.ok(Number.isInteger(s) && s >= 4 && s <= 8, `${w} px gives ${s}`);
  }
  assert.ok(dollScale(296) <= dollScale(500), "a wider room never gets a smaller doll");
});

test("the line under the doll: the name, the level, and the class unless the name already is the class", () => {
  assert.equal(heroLineOf("Marta", 2, "Rogue"), "Marta, level 2 Rogue");
  assert.equal(heroLineOf("Knight", 1, "Knight"), "Knight, level 1");
  assert.equal(heroLineOf(" knight ", 1, "Knight"), " knight , level 1");
});

// ---- the stat column's words --------------------------------------------------------

test("the stat column reads the engine: six rows, each in plain words", () => {
  assert.deepEqual(STAT_ROWS.map((r) => r.label), ["Armour class", "To hit", "Damage", "Saving throws", "Speed", "Attuned"]);
  const s = statsOf(hero("knight"));
  assert.equal(statValue("ac", s), String(s.ac));
  assert.equal(statValue("toHit", s), `+${s.toHit}`);
  assert.equal(statValue("damage", s), s.damage);
  assert.match(statValue("speedFt", s), /^\d+ ft$/);
  assert.equal(statValue("attuned", s), "0 of 3");
  assert.match(statValue("saves", s), /^\+\d+ from gear$/);
});

test("a preview in one sentence: what moves, and plainly when nothing does", () => {
  assert.equal(previewSummary({ ac: 0, toHit: 2, damage: 2, saves: 0, speedFt: 0, attuned: 0 }), "to hit +2, damage +2");
  assert.equal(previewSummary({ ac: 1, toHit: 0, damage: 0, saves: 1, speedFt: 30, attuned: 1 }), "armour class +1, saving throws +1, speed +30 ft, uses 1 attunement spot");
  assert.equal(previewSummary({ ac: 0, toHit: 0, damage: 0, saves: 0, speedFt: 0, attuned: 0 }), "none of these numbers change");
  assert.equal(previewSummary({ ac: -1, toHit: 0, damage: 0, saves: 0, speedFt: 0, attuned: -2 }), "armour class -1, frees 2 attunement spots");
});

// ---- the side panel: the small-screen rule and the Settings choice ----------------------------

test("the panel is condensed only when it is narrower than 520 px and fills its row (a phone), never as a desktop column", () => {
  assert.equal(CONDENSED_MAX_PX, 520);
  assert.equal(condensedHud(390, 390), true, "a phone: the dock fills the row under the board");
  assert.equal(condensedHud(320, 320), true);
  assert.equal(condensedHud(320, 1280), false, "a 320 px column beside the board on a desktop has the room of a column");
  assert.equal(condensedHud(600, 600), false, "wide enough to keep its lines");
  assert.equal(condensedHud(519, 520), true);
  assert.equal(condensedHud(520, 520), false);
  assert.equal(condensedHud(0, 0), false, "not laid out yet");
});

test("End turn automatically is a Settings choice, on unless it was turned off", () => {
  const g = SETTING_CHOICES.find((c) => c.key === "autoEndTurn");
  assert.ok(g, "the setting is offered");
  assert.deepEqual(g!.choices.map((c) => c.value), ["true", "false"]);
  assert.deepEqual(g!.choices.map((c) => c.label), ["On", "Off"]);
  const base: HudSettings = { textSpeed: "normal", textStyle: "pixel", rollMyself: true, zoom: null };
  assert.equal(settingValue(base, "autoEndTurn"), "true", "absent reads as on");
  assert.equal(settingValue({ ...base, autoEndTurn: true }, "autoEndTurn"), "true");
  assert.equal(settingValue({ ...base, autoEndTurn: false }, "autoEndTurn"), "false");
  for (const probe of [base, { ...base, autoEndTurn: false }]) assert.equal(g!.choices.filter((c) => c.value === settingValue(probe, "autoEndTurn")).length, 1, "exactly one choice is in use");
});

test("the drawer's own tabs stay as the asset bench pins them", () => {
  assert.deepEqual(DRAWER_TABS, ["pack", "journal", "log", "saves", "settings"]);
});

// ---- the wiring, as source ---------------------------------------------------------------

test("the side panel keeps Rest, End turn and Menu: no Attack, Use, Potion, Cancel or Sheet button, no ask box", () => {
  const wiring = read("flows/hudWiring.ts");
  for (const gone of ['id: "attack"', 'id: "use"', 'id: "potion"', 'id: "cancel"', 'id: "sheet"', "askStateFor", "ask:"]) assert.ok(!wiring.includes(gone), `${gone} is gone from the readout`);
  assert.match(wiring, /id: "rest", label: "Rest"/);
  assert.match(wiring, /id: "end", label: "End turn"/);
  assert.match(wiring, /id: "menu", label: "Menu"/);
  assert.match(wiring, /id: "mainmenu", label: "Main menu"/);
  assert.match(wiring, /id === "menu"\) return tc\.openGameMenu\("character"\)/, "Menu opens the game menu on Character");
  assert.doesNotMatch(wiring, /cancelDm|useNearby|drinkPotion|attackNearest/, "the readout no longer drives those");
  assert.ok(!existsSync(new URL("ui/hudAsk.ts", TABLE)), "the ask box module is deleted");
  const css = read("ui/hudStyle.ts");
  assert.doesNotMatch(css, /lto-hud-input|lto-hud-ask/, "and its styles");
  const hud = read("ui/createHud.ts") + read("ui/hudCtx.ts") + read("ui/hudTypes.ts");
  assert.doesNotMatch(hud, /onAsk|askBox|askInput|askSend|\bask\?:/, "the HUD has no freehand line");
});

test("the readout sends the menu its data, and the arena marks when a screen is up", () => {
  const wiring = read("flows/hudWiring.ts");
  assert.match(wiring, /tc\.syncGameMenu\(\)/, "the open menu follows the hero live");
  assert.match(wiring, /toggleAttribute\("data-screens", tc\.screenOpen\(\) \|\| tc\.creationView !== null\)/, "the arena says when a screen or the maker is up");
  assert.match(wiring, /condense: true/, "the panel asks for the small-screen look");
  assert.doesNotMatch(wiring, /pack: \{|journal: |saves: saveRows|settings: \{/, "the HUD is not handed the pack, journal, saves or settings any more");
  assert.match(wiring, /key === "autoEndTurn"/, "the choice is handled");
  assert.doesNotMatch(wiring, /tc\.talkTarget/, "the ask box's target reset is gone");
});

test("the game menu flow gives the table exactly the three calls the other lanes use, and shuts for a story screen", () => {
  const flow = read("flows/gameMenuFlow.ts");
  assert.match(flow, /tc\.openGameMenu = /);
  assert.match(flow, /tc\.closeGameMenu = /);
  assert.match(flow, /tc\.gameMenuOpen = /);
  assert.match(read("tableCtx.ts"), /openGameMenu: \(tab\?: MenuTab\) => void/);
  assert.match(flow, /storyOpen/, "it knows when a story screen is up");
  assert.match(flow, /itemCardFor/, "item cards are the engine's own");
  assert.match(flow, /runItemAction/, "and the buttons go to the same equip, unequip, drop and use as the pack did");
});

test("the screens that pause the game count the menu, a story screen and the main menu; the sheet's old window is gone", () => {
  const views = read("flows/sheetViews.ts");
  assert.match(views, /tc\.gameMenuOpen\(\)/);
  assert.match(views, /storyUp\(\)/);
  assert.match(views, /tc\.menuScr !== null/, "the main menu counts as a screen");
  assert.doesNotMatch(views, /onNewCharacter|openCreationView|syncStageRoom|minHeight/, "no New character from the game, no stale stage height");
  assert.match(views, /tc\.stageRefresh\(\)/, "the stage measures its room after a view opens or closes");
});

test("nothing a player can read in the menu's own strings is a developer word or a long dash", () => {
  const files = [read("ui/gameMenu.ts"), read("ui/menuViews.ts"), read("flows/gameMenuFlow.ts"), readFileSync(new URL("../menu/statPreview.ts", TABLE), "utf8")];
  for (const src of files) {
    assert.ok(!src.includes(EM) && !src.includes(EN), "no em or en dash anywhere");
    // Quoted strings with a space in them (the sentences a player reads); identifiers and class names have none.
    const literals = [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "").filter((s) => /\s/.test(s) && /[A-Za-z]{3}/.test(s) && !/[{}=;]/.test(s));
    for (const lit of literals) assert.doesNotMatch(lit, /\b(bench|stub|build|games-db|engine)\b/i, `player text "${lit}"`);
  }
});
