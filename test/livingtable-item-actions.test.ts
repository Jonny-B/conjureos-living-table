/**
 * Tests for what you can do with an item (src/games/livingtable/inventory/itemActions.ts).
 *
 * The owner's claim: "an item that cannot be used will say cannot be used, or
 * quest items cannot be dropped, or use, drop, destroy." Checked here:
 *
 *   1. EVERY KIND gets the right buttons, and every disabled button says why.
 *   2. EQUIP AND UNEQUIP go through the engine's own staging (rules/inventory.ts)
 *      and print its refusal words (attunement full, nothing to take off, the
 *      fight gate).
 *   3. QUEST FLAGS block drop and destroy; USABLE FLAGS enable Use.
 *   4. DROP then PICK UP returns the item; DESTROY asks first and is final.
 *   5. THE POTION RULES: full health, off turn, action spent, down.
 *   6. NO DASH GLYPHS in anything the module can print.
 *
 * Run: npx tsx --test test/livingtable-item-actions.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCharacter, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import {
  BAG_CAPACITY,
  GEAR_CHANGE_BLOCKED,
  attunementFullReason,
  gearItemName,
} from "../src/games/livingtable/characters/equipmentTypes";
import { itemNameFor, tierInSlot } from "../src/games/livingtable/characters/equipment";
import {
  ACTION_SPENT_REASON,
  ALREADY_OWN_REASON,
  BAG_FULL_REASON,
  CANNOT_USE_REASON,
  DOWN_USE_REASON,
  FULL_HEALTH_REASON,
  NONE_LEFT_REASON,
  NOT_YOUR_TURN_REASON,
  QUEST_REASON,
  WORN_REASON,
  destroyItem,
  dropItem,
  equipItem,
  itemActionsFor,
  itemStatusLine,
  itemUseSay,
  pickUp,
  unequipItem,
  type ItemAction,
  type ItemActionContext,
  type ItemRef,
} from "../src/games/livingtable/inventory/itemActions";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const CALM: ItemActionContext = { inFight: false, heroTurn: true, actionReady: true, heroDown: false };
const FIGHT_MY_TURN: ItemActionContext = { inFight: true, heroTurn: true, actionReady: true, heroDown: false };

function knight(patch: Partial<CharacterSheet> = {}): CharacterSheet {
  return { ...createCharacter({ archetypeId: "knight", name: "Tester", appearanceAssetId: "token_knight" }), ...patch };
}

function hurt(sheet: CharacterSheet, hp = 5): CharacterSheet {
  return { ...sheet, currentHp: hp };
}

function withBag(sheet: CharacterSheet, bag: CharacterSheet["bag"]): CharacterSheet {
  return { ...sheet, bag };
}

function find(actions: ItemAction[], id: ItemAction["id"]): ItemAction {
  const a = actions.find((x) => x.id === id);
  assert.ok(a, `no ${id} action in ${JSON.stringify(actions.map((x) => x.id))}`);
  return a;
}

function ids(actions: ItemAction[]): string[] {
  return actions.map((a) => a.id);
}

const KEEN: { slot: "weapon"; tier: "uncommon" } = { slot: "weapon", tier: "uncommon" };

// ── 1. every kind, every disabled button has a reason ───────────────────

test("worn magic gear: Unequip is on, Drop and Destroy are off with the wear reason", () => {
  const sheet = withBag({ ...knight(), equipment: { ...knight().equipment, weapon: { slot: "weapon", tier: "uncommon" } } }, []);
  const actions = itemActionsFor(sheet, { where: "worn", slot: "weapon" }, CALM);
  assert.deepEqual(ids(actions), ["unequip", "drop", "destroy"]);
  assert.equal(find(actions, "unequip").enabled, true);
  for (const id of ["drop", "destroy"] as const) {
    assert.equal(find(actions, id).enabled, false);
    assert.equal(find(actions, id).reason, WORN_REASON);
  }
});

test("worn own (common) piece: Unequip is off with the engine's own refusal words", () => {
  const sheet = knight();
  const actions = itemActionsFor(sheet, { where: "worn", slot: "weapon" }, CALM);
  const un = find(actions, "unequip");
  assert.equal(un.enabled, false);
  assert.equal(un.reason, "There is nothing magic worn in the weapon slot.");
});

test("worn gear in a fight: Unequip says the engine's fight gate, word for word", () => {
  const sheet = { ...knight(), equipment: { ...knight().equipment, weapon: { slot: "weapon" as const, tier: "uncommon" as const } } };
  const un = find(itemActionsFor(sheet, { where: "worn", slot: "weapon" }, FIGHT_MY_TURN), "unequip");
  assert.equal(un.enabled, false);
  assert.equal(un.reason, GEAR_CHANGE_BLOCKED.hostiles);
});

test("bag gear: Equip, Drop, Destroy; Equip is off in a fight and when down, with the engine's words", () => {
  const sheet = withBag(knight(), [KEEN]);
  const ref: ItemRef = { where: "bag", index: 0 };
  const calm = itemActionsFor(sheet, ref, CALM);
  assert.deepEqual(ids(calm), ["equip", "drop", "destroy"]);
  assert.ok(calm.every((a) => a.enabled));
  const fight = itemActionsFor(sheet, ref, FIGHT_MY_TURN);
  assert.equal(find(fight, "equip").reason, GEAR_CHANGE_BLOCKED.hostiles);
  const down = itemActionsFor({ ...sheet, currentHp: 0, downed: true }, ref, { ...CALM, heroDown: true });
  assert.equal(find(down, "equip").reason, GEAR_CHANGE_BLOCKED.down);
});

test("carried flavour item: Use is off with the cannot-be-used words; Drop and Destroy are on", () => {
  const sheet = knight();
  const actions = itemActionsFor(sheet, { where: "carried", name: "Explorer's pack" }, CALM);
  assert.deepEqual(ids(actions), ["use", "drop", "destroy"]);
  assert.equal(find(actions, "use").enabled, false);
  assert.equal(find(actions, "use").reason, CANNOT_USE_REASON);
  assert.equal(find(actions, "drop").enabled, true);
  assert.equal(find(actions, "destroy").enabled, true);
});

test("consumable: Use, Drop, Destroy; Use is on when hurt", () => {
  const sheet = hurt(knight());
  const actions = itemActionsFor(sheet, { where: "consumable", name: "Potion of healing" }, CALM);
  assert.deepEqual(ids(actions), ["use", "drop", "destroy"]);
  assert.ok(actions.every((a) => a.enabled));
  assert.equal(find(actions, "use").cost, "free");
});

test("pile item: only Pick up, and it is on", () => {
  const actions = itemActionsFor(knight(), { where: "pile", name: "Rope" }, CALM);
  assert.deepEqual(ids(actions), ["pickup"]);
  assert.equal(actions[0]!.enabled, true);
});

test("an item that is not there gets no buttons and an honest status line", () => {
  assert.deepEqual(itemActionsFor(knight(), { where: "carried", name: "Unicorn" }, CALM), []);
  assert.deepEqual(itemActionsFor(knight(), { where: "bag", index: 3 }, CALM), []);
  assert.deepEqual(itemActionsFor(knight(), { where: "worn", slot: "ring" }, CALM), []);
  assert.deepEqual(itemActionsFor(knight(), { where: "worn", slot: "pocket" }, CALM), []);
  assert.equal(itemStatusLine(knight(), { where: "carried", name: "Unicorn" }, CALM), "You do not have that.");
});

test("the worn kit's own names are not carried things (the gear rows own them)", () => {
  assert.deepEqual(itemActionsFor(knight(), { where: "carried", name: "Longsword" }, CALM), []);
});

test("every disabled action, in every state, carries a reason", () => {
  const base = withBag(hurt(knight()), [KEEN]);
  const states: ItemActionContext[] = [
    CALM,
    FIGHT_MY_TURN,
    { ...FIGHT_MY_TURN, heroTurn: false },
    { ...FIGHT_MY_TURN, actionReady: false },
    { ...CALM, heroDown: true },
    { ...CALM, flags: { "Explorer's pack": { quest: true }, "Potion of healing": { quest: true } } },
  ];
  const refs: ItemRef[] = [
    { where: "worn", slot: "weapon" },
    { where: "worn", slot: "boots" },
    { where: "bag", index: 0 },
    { where: "carried", name: "Explorer's pack" },
    { where: "carried", name: "Handaxe x2" },
    { where: "consumable", name: "Potion of healing" },
    { where: "pile", name: "Rope" },
    { where: "pile", name: "Keen Longsword" },
  ];
  for (const ctx of states) {
    for (const sheet of [base, { ...base, dead: true }, { ...base, currentHp: 0, downed: true }, { ...base, currentHp: base.maxHp }]) {
      for (const ref of refs) {
        for (const a of itemActionsFor(sheet, ref, ctx)) {
          if (!a.enabled) assert.ok(a.reason && a.reason.length > 0, `${JSON.stringify(ref)} ${a.id} has no reason`);
          else assert.equal(a.reason, undefined);
        }
      }
    }
  }
});

// ── 2. equip and unequip go through the engine ──────────────────────────

test("equip then unequip round-trips through the engine and leaves the input alone", () => {
  const sheet = withBag(knight(), [KEEN]);
  const snapshot = JSON.stringify(sheet);
  const eq = equipItem(sheet, { where: "bag", index: 0 });
  assert.equal(eq.refused, undefined);
  assert.equal(JSON.stringify(sheet), snapshot, "equip must not mutate its input");
  assert.equal(tierInSlot(eq.sheet, "weapon"), "uncommon");
  assert.equal(itemNameFor(eq.sheet, "weapon"), "Keen Longsword");
  assert.deepEqual(eq.sheet.bag, []);
  assert.match(eq.line, /^You equip the Keen Longsword\./);

  const un = unequipItem(eq.sheet, "weapon");
  assert.equal(un.refused, undefined);
  assert.equal(tierInSlot(un.sheet, "weapon"), "common");
  assert.deepEqual(un.sheet.bag, [KEEN]);
  assert.match(un.line, /^You take off the Keen Longsword\./);
});

test("unequipping your own common piece is refused with the engine's words", () => {
  const sheet = knight();
  const r = unequipItem(sheet, "weapon");
  assert.equal(r.refused, "There is nothing magic worn in the weapon slot.");
  assert.equal(r.sheet, sheet);
});

test("equip while something hostile is in the room is refused with the engine's gate", () => {
  const sheet = withBag(knight(), [KEEN]);
  const r = equipItem(sheet, { where: "bag", index: 0 }, { hostilesPresent: true });
  assert.equal(r.refused, GEAR_CHANGE_BLOCKED.hostiles);
  assert.equal(r.sheet, sheet);
  const u = unequipItem(sheet, "weapon", { hostilesPresent: true });
  assert.equal(u.refused, GEAR_CHANGE_BLOCKED.hostiles);
});

test("a fourth attunement item is refused with attunementFullReason, in the card and in the applier", () => {
  const base = knight();
  const sheet: CharacterSheet = {
    ...base,
    equipment: {
      ...base.equipment,
      weapon: { slot: "weapon", tier: "legendary" },
      ring: { slot: "ring", tier: "uncommon" },
      amulet: { slot: "amulet", tier: "uncommon" },
    },
    bag: [{ slot: "boots", tier: "rare" }],
  };
  const names = [
    gearItemName("knight", "weapon", "legendary")!,
    gearItemName("knight", "ring", "uncommon")!,
    gearItemName("knight", "amulet", "uncommon")!,
  ];
  const words = attunementFullReason(names);
  const r = equipItem(sheet, { where: "bag", index: 0 });
  assert.equal(r.refused, words);
  assert.equal(r.sheet, sheet);
  const card = find(itemActionsFor(sheet, { where: "bag", index: 0 }, CALM), "equip");
  assert.equal(card.enabled, false);
  assert.equal(card.reason, words);
});

test("equip refuses anything that is not a bag cell", () => {
  const r = equipItem(knight(), { where: "carried", name: "Handaxe x2" });
  assert.ok(r.refused);
  const missing = equipItem(knight(), { where: "bag", index: 0 });
  assert.equal(missing.refused, "There is nothing in that bag cell.");
});

test("equipping over a magic piece swaps it into the same bag cell (the engine's swap)", () => {
  const base = knight();
  const sheet: CharacterSheet = {
    ...base,
    equipment: { ...base.equipment, weapon: { slot: "weapon", tier: "uncommon" } },
    bag: [{ slot: "weapon", tier: "rare" }],
  };
  const r = equipItem(sheet, { where: "bag", index: 0 });
  assert.equal(r.refused, undefined);
  assert.equal(tierInSlot(r.sheet, "weapon"), "rare");
  assert.deepEqual(r.sheet.bag, [{ slot: "weapon", tier: "uncommon" }]);
});

// ── 3. flags ────────────────────────────────────────────────────────────

test("a quest flag blocks drop and destroy on carried items, gear in the bag and consumables", () => {
  const sheet = withBag(hurt(knight()), [KEEN]);
  const flags = { "Explorer's pack": { quest: true }, "Keen Longsword": { quest: true }, "Potion of healing": { quest: true } };
  const ctx = { ...CALM, flags };
  for (const ref of [
    { where: "carried", name: "Explorer's pack" },
    { where: "bag", index: 0 },
    { where: "consumable", name: "Potion of healing" },
  ] as ItemRef[]) {
    const actions = itemActionsFor(sheet, ref, ctx);
    assert.equal(find(actions, "drop").enabled, false);
    assert.equal(find(actions, "drop").reason, QUEST_REASON);
    assert.equal(find(actions, "destroy").enabled, false);
    assert.equal(find(actions, "destroy").reason, QUEST_REASON);
    const d = dropItem(sheet, ref, ctx);
    assert.equal(d.refused, QUEST_REASON);
    assert.equal(d.dropped, null);
    assert.equal(d.sheet, sheet);
    assert.equal(destroyItem(sheet, ref, ctx).refused, QUEST_REASON);
  }
  // Quest items can still be used or equipped.
  assert.equal(find(itemActionsFor(sheet, { where: "bag", index: 0 }, ctx), "equip").enabled, true);
  assert.equal(find(itemActionsFor(sheet, { where: "consumable", name: "Potion of healing" }, ctx), "use").enabled, true);
});

test("flag names ignore case, curly apostrophes and a trailing count", () => {
  const sheet = knight();
  const curly = "Explorer" + String.fromCharCode(0x2019) + "s PACK";
  const ctx = { ...CALM, flags: { [curly]: { quest: true } } };
  assert.equal(find(itemActionsFor(sheet, { where: "carried", name: "Explorer's pack" }, ctx), "drop").reason, QUEST_REASON);
  const stack = { ...CALM, flags: { "handaxe x5": { quest: true } } };
  assert.equal(find(itemActionsFor(sheet, { where: "carried", name: "Handaxe x2" }, stack), "drop").reason, QUEST_REASON);
});

test("a usable flag turns Use on for a carried item and hands the DM the words", () => {
  const sheet = knight();
  const ref: ItemRef = { where: "carried", name: "Explorer's pack" };
  const ctx = { ...CALM, flags: { "Explorer's pack": { usable: true, useSay: "I open the pack and look for the map." } } };
  const use = find(itemActionsFor(sheet, ref, ctx), "use");
  assert.equal(use.enabled, true);
  assert.equal(use.reason, undefined);
  assert.equal(itemUseSay(sheet, ref, ctx), "I open the pack and look for the map.");
  const plain = { ...CALM, flags: { "Explorer's pack": { usable: true } } };
  assert.equal(itemUseSay(sheet, ref, plain), "I use my Explorer's pack.");
  assert.equal(itemUseSay(sheet, ref, CALM), null, "no flag, nothing to send");
});

test("a usable carried item is off while down and off your turn, with the reason", () => {
  const sheet = knight();
  const ref: ItemRef = { where: "carried", name: "Explorer's pack" };
  const flags = { "Explorer's pack": { usable: true } };
  assert.equal(find(itemActionsFor(sheet, ref, { ...FIGHT_MY_TURN, heroTurn: false, flags }), "use").reason, NOT_YOUR_TURN_REASON);
  assert.equal(find(itemActionsFor(sheet, ref, { ...CALM, heroDown: true, flags }), "use").reason, DOWN_USE_REASON);
});

// ── 4. drop, pick up, destroy ───────────────────────────────────────────

test("drop then pick up returns a carried item, one of a stack at a time", () => {
  const sheet = knight();
  const first = dropItem(sheet, { where: "carried", name: "Handaxe x2" }, CALM);
  assert.equal(first.refused, undefined);
  assert.equal(first.dropped, "Handaxe");
  assert.ok(first.sheet.inventory.includes("Handaxe"));
  assert.ok(!first.sheet.inventory.includes("Handaxe x2"));
  const second = dropItem(first.sheet, { where: "carried", name: "Handaxe" }, CALM);
  assert.ok(!second.sheet.inventory.some((s) => s.startsWith("Handaxe")));
  const back1 = pickUp(second.sheet, second.dropped!);
  const back2 = pickUp(back1.sheet, first.dropped!);
  assert.ok(back2.sheet.inventory.includes("Handaxe x2"));
  assert.deepEqual([...back2.sheet.inventory].sort(), [...sheet.inventory].sort());
  assert.equal(JSON.stringify(sheet), JSON.stringify(knight()), "input untouched");
});

test("drop then pick up returns a bag item (magic gear goes back into the bag)", () => {
  const sheet = withBag(knight(), [KEEN]);
  const d = dropItem(sheet, { where: "bag", index: 0 }, CALM);
  assert.equal(d.dropped, "Keen Longsword");
  assert.deepEqual(d.sheet.bag, []);
  assert.match(d.line, /^You drop the Keen Longsword\./);
  const p = pickUp(d.sheet, d.dropped!);
  assert.equal(p.refused, undefined);
  assert.deepEqual(p.sheet.bag, [KEEN]);
});

test("drop then pick up returns a consumable use", () => {
  const sheet = knight();
  const d = dropItem(sheet, { where: "consumable", name: "Potion of healing" }, CALM);
  assert.equal(d.sheet.consumables[0]!.uses, 1);
  const d2 = dropItem(d.sheet, { where: "consumable", name: "Potion of healing" }, CALM);
  assert.equal(d2.sheet.consumables[0]!.uses, 0);
  assert.equal(find(itemActionsFor(d2.sheet, { where: "consumable", name: "Potion of healing" }, CALM), "drop").reason, NONE_LEFT_REASON);
  const p = pickUp(pickUp(d2.sheet, d.dropped!).sheet, d2.dropped!);
  assert.equal(p.sheet.consumables[0]!.uses, 2);
});

test("a host's own potion stock is spent and refilled through `potions`, and the sheet is left alone", () => {
  const sheet = knight();
  const ctx = { ...CALM, potions: 2 };
  const d = dropItem(sheet, { where: "consumable", name: "Potion of healing" }, ctx);
  assert.equal(d.potions, 1);
  assert.equal(d.sheet, sheet);
  assert.equal(d.dropped, "Potion of healing");
  const back = pickUp(sheet, d.dropped!, { potions: 1 });
  assert.equal(back.potions, 2);
  assert.equal(back.sheet, sheet);
  const x = destroyItem(sheet, { where: "consumable", name: "Potion of healing" }, ctx);
  assert.equal(x.potions, 1);
  assert.equal(dropItem(sheet, { where: "consumable", name: "Potion of healing" }, { ...CALM, potions: 0 }).refused, NONE_LEFT_REASON);
});

test("worn gear cannot be dropped or destroyed", () => {
  const sheet = knight();
  assert.equal(dropItem(sheet, { where: "worn", slot: "weapon" }, CALM).refused, WORN_REASON);
  assert.equal(destroyItem(sheet, { where: "worn", slot: "weapon" }, CALM).refused, WORN_REASON);
});

test("drop and destroy are refused while down or dead, and off your turn in a fight", () => {
  const sheet = knight();
  const ref: ItemRef = { where: "carried", name: "Explorer's pack" };
  assert.ok(dropItem({ ...sheet, currentHp: 0, downed: true }, ref, { ...CALM, heroDown: true }).refused);
  assert.ok(dropItem({ ...sheet, dead: true }, ref, CALM).refused);
  assert.equal(dropItem(sheet, ref, { ...FIGHT_MY_TURN, heroTurn: false }).refused, NOT_YOUR_TURN_REASON);
  assert.equal(destroyItem(sheet, ref, { ...FIGHT_MY_TURN, heroTurn: false }).refused, NOT_YOUR_TURN_REASON);
  assert.equal(dropItem(sheet, ref, FIGHT_MY_TURN).refused, undefined, "dropping is free on your turn");
});

test("destroy asks first, in the owner's words, and then it is gone for good", () => {
  const sheet = withBag(knight(), [KEEN]);
  const ref: ItemRef = { where: "bag", index: 0 };
  const destroy = find(itemActionsFor(sheet, ref, CALM), "destroy");
  assert.equal(destroy.confirm, "Destroy the Keen Longsword? It is gone for good.");
  const r = destroyItem(sheet, ref, CALM);
  assert.equal(r.refused, undefined);
  assert.deepEqual(r.sheet.bag, []);
  assert.equal(r.line, "You destroy the Keen Longsword. It is gone for good.");
  // A stack says how many there are: it destroys one.
  const stack = find(itemActionsFor(sheet, { where: "carried", name: "Handaxe x2" }, CALM), "destroy");
  assert.equal(stack.confirm, "Destroy one Handaxe? You have 2; this one is gone for good.");
  const one = destroyItem(sheet, { where: "carried", name: "Handaxe x2" }, CALM);
  assert.ok(one.sheet.inventory.includes("Handaxe"));
  // A disabled Destroy asks nothing.
  assert.equal(find(itemActionsFor(sheet, { where: "worn", slot: "weapon" }, CALM), "destroy").confirm, undefined);
});

test("pick up: a magic piece already owned or a full bag is refused in words", () => {
  const owned = withBag(knight(), [KEEN]);
  assert.equal(pickUp(owned, "Keen Longsword").refused, ALREADY_OWN_REASON);
  assert.equal(find(itemActionsFor(owned, { where: "pile", name: "Keen Longsword" }, CALM), "pickup").reason, ALREADY_OWN_REASON);
  const filler = Array.from({ length: BAG_CAPACITY }, () => KEEN);
  const full = withBag(knight(), filler);
  const r = pickUp(full, "Sword of the Vigil");
  assert.equal(r.refused, BAG_FULL_REASON);
  assert.equal(r.sheet, full);
});

test("pick up an unknown thing lands in the carried list, merging into a stack", () => {
  const sheet = knight();
  const rope = pickUp(sheet, "Silk rope");
  assert.ok(rope.sheet.inventory.includes("Silk rope"));
  const twice = pickUp(rope.sheet, "Silk rope");
  assert.ok(twice.sheet.inventory.includes("Silk rope x2"));
  assert.equal(pickUp({ ...sheet, dead: true }, "Silk rope").refused !== undefined, true);
});

// ── 5. the potion rules ─────────────────────────────────────────────────

const POTION: ItemRef = { where: "consumable", name: "Potion of healing" };

test("potion: refused at full health", () => {
  const use = find(itemActionsFor(knight(), POTION, CALM), "use");
  assert.equal(use.enabled, false);
  assert.equal(use.reason, FULL_HEALTH_REASON);
});

test("potion in a fight: costs your action, needs your turn and an unspent action", () => {
  const sheet = hurt(knight());
  const mine = find(itemActionsFor(sheet, POTION, FIGHT_MY_TURN), "use");
  assert.equal(mine.enabled, true);
  assert.equal(mine.cost, "action");
  assert.equal(find(itemActionsFor(sheet, POTION, { ...FIGHT_MY_TURN, heroTurn: false }), "use").reason, NOT_YOUR_TURN_REASON);
  assert.equal(find(itemActionsFor(sheet, POTION, { ...FIGHT_MY_TURN, actionReady: false }), "use").reason, ACTION_SPENT_REASON);
});

test("potion while down: the game's rule refuses it; a host without death saves can switch that on", () => {
  const down = { ...knight(), currentHp: 0, downed: true };
  const ctx = { ...CALM, heroDown: true };
  assert.equal(find(itemActionsFor(down, POTION, ctx), "use").reason, DOWN_USE_REASON);
  const bench = find(itemActionsFor(down, POTION, { ...ctx, potionWhileDown: true }), "use");
  assert.equal(bench.enabled, true, "down is below full health, so the bench rule allows it");
  assert.equal(find(itemActionsFor({ ...down, dead: true }, POTION, { ...ctx, potionWhileDown: true }), "use").enabled, false);
});

test("potion with none left, and the host's own stock replaces the sheet's uses", () => {
  const sheet = hurt({ ...knight(), consumables: [{ ...knight().consumables[0]!, uses: 0 }] });
  assert.equal(find(itemActionsFor(sheet, POTION, CALM), "use").reason, NONE_LEFT_REASON);
  assert.equal(find(itemActionsFor(sheet, POTION, { ...CALM, potions: 3 }), "use").enabled, true);
  assert.equal(find(itemActionsFor(hurt(knight()), POTION, { ...CALM, potions: 0 }), "use").reason, NONE_LEFT_REASON);
  // The bench's potion works even when the sheet has no such consumable.
  const bare = hurt({ ...knight(), consumables: [] });
  assert.equal(find(itemActionsFor(bare, POTION, { ...CALM, potions: 2 }), "use").enabled, true);
});

test("a consumable named in the carried list acts as the consumable", () => {
  const sheet = hurt(knight({ archetypeId: "knight" }));
  const trauma = { ...sheet, inventory: [...sheet.inventory, "Trauma kit"], consumables: [...sheet.consumables, { name: "Trauma kit", uses: 3, effect: "heal" as const, description: "Pack the wound." }] };
  const actions = itemActionsFor(trauma, { where: "carried", name: "Trauma kit" }, CALM);
  assert.equal(find(actions, "use").enabled, true);
});

// ── 6. the status line ──────────────────────────────────────────────────

test("status lines say the thing the owner asked for, in plain words", () => {
  const sheet = withBag(hurt(knight()), [KEEN]);
  assert.equal(itemStatusLine(sheet, { where: "carried", name: "Explorer's pack" }, CALM), CANNOT_USE_REASON);
  assert.equal(
    itemStatusLine(sheet, { where: "carried", name: "Explorer's pack" }, { ...CALM, flags: { "Explorer's pack": { quest: true } } }),
    `${QUEST_REASON} ${CANNOT_USE_REASON}`,
  );
  assert.match(itemStatusLine(sheet, { where: "worn", slot: "weapon" }, CALM), /^Worn in your Weapon slot\./);
  assert.match(itemStatusLine(sheet, { where: "consumable", name: "Potion of healing" }, CALM), /^Drink it to heal 2d4\+2 \(takes your action in a fight\)\. 2 left\.$/);
  assert.match(itemStatusLine(sheet, { where: "bag", index: 0 }, CALM), /^In your bag, not worn/);
  assert.match(itemStatusLine(sheet, { where: "pile", name: "Rope" }, CALM), /^Lying on the ground\. Pick it up/);
});

test("status lines add the reason a button is off right now", () => {
  const full = knight();
  assert.match(itemStatusLine(full, { where: "consumable", name: "Potion of healing" }, CALM), /Not now: You are already at full health\.$/);
  const bagged = withBag(knight(), [KEEN]);
  assert.ok(itemStatusLine(bagged, { where: "bag", index: 0 }, FIGHT_MY_TURN).includes(GEAR_CHANGE_BLOCKED.hostiles));
});

test("the healing number on the card is the one the item copy and the engine use", () => {
  assert.match(itemStatusLine(hurt(knight()), POTION, CALM), /2d4\+2/);
});

// ── 7. no dash glyphs ───────────────────────────────────────────────────

test("no dash glyph in any string the module can print", () => {
  const base = withBag(hurt(knight()), [KEEN, { slot: "ring", tier: "uncommon" }]);
  const states: ItemActionContext[] = [
    CALM,
    FIGHT_MY_TURN,
    { ...FIGHT_MY_TURN, heroTurn: false },
    { ...CALM, heroDown: true },
    { ...CALM, flags: { "Explorer's pack": { quest: true, usable: true } } },
  ];
  const refs: ItemRef[] = [
    { where: "worn", slot: "weapon" },
    { where: "bag", index: 0 },
    { where: "bag", index: 1 },
    { where: "carried", name: "Explorer's pack" },
    { where: "carried", name: "Handaxe x2" },
    { where: "consumable", name: "Potion of healing" },
    { where: "pile", name: "Rope" },
  ];
  const seen: string[] = [];
  for (const ctx of states) {
    for (const ref of refs) {
      seen.push(itemStatusLine(base, ref, ctx));
      for (const a of itemActionsFor(base, ref, ctx)) seen.push(a.label, a.reason ?? "", a.confirm ?? "");
      for (const r of [dropItem(base, ref, ctx), destroyItem(base, ref, ctx)]) seen.push(r.line, r.refused ?? "");
    }
  }
  seen.push(equipItem(base, { where: "bag", index: 0 }).line, unequipItem(base, "weapon").line, pickUp(base, "Rope").line);
  assert.ok(seen.length > 100);
  for (const text of seen) assert.ok(!DASH.test(text), `dash glyph in: ${text}`);
});
