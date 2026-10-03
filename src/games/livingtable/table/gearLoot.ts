/**
 * Gear, items, piles and bodies of the table window. Every gear change goes
 * through the inventory screen's own staging rules (rules/inventory.ts); the
 * item rules are the engine's (inventory/itemActions.ts decides what each item
 * offers and applies it, rules/corpses.ts says what a body holds). This is the
 * scene around them: where a dropped thing lies, what a search of a body turns
 * up, and the words the item card shows.
 *
 * Copied from the bench's Play panel, unchanged but for imports. Also home to
 * foldItem and withoutCount (how two item names are compared) and slotNaming
 * (what a gear role is called on an archetype), which the adventure rules, the
 * DM's effects and the window all share. Import-pure.
 */
import { itemNameFor, tierInSlot } from "../characters/equipment";
import {
  ACCESSORY_ROLES,
  ACCESSORY_SLOT_WORD,
  type AccessoryRole,
  type ArchetypeId,
  BAG_CAPACITY,
  type EquipmentTier,
  GEAR_ROLES,
  gearItemExists,
  gearItemName,
  type GearRole,
  type LoadoutDraft,
  LOOT_CAP_LINE,
  MAGIC_TIERS,
  type MagicTier,
  type SlotRole,
  SLOTS_BY_ARCHETYPE,
  TEMPLATE_OF_ARCHETYPE,
  TIER_WORD,
} from "../characters/equipmentTypes";
import { destroyItem, dropItem, type ItemActionContext, itemActionsFor, type ItemRef, itemStatusLine, pickUp } from "../inventory/itemActions";
import { describeBagItem, describeCarried, packInfo } from "../inventory/itemInfo";
import { slotLabelFor } from "../menu/equipment";
import { lootLine } from "../menu/labels";
import { type BodyState, itemNotes as carriedNotes, takeFromBody } from "../rules/corpses";
import { commitLoadout, draftFromSheet, stageEquip, stageUnequip } from "../rules/inventory";
import { lootFor } from "../rules/loot";
import { tileDistance } from "../world/reach";
import { creatureInSight, heroActionReady, heroesTurn } from "./sight";
import { DM_INVENTORY_MAX, heroDown, type PlayState, same, sentence, type XY } from "./state";
import type { ItemCardContent, LootWindowItem } from "./ui/overlay";
import { itemTip } from "./ui/sheet";

export function isAccessoryRole(role: GearRole): role is AccessoryRole {
  return (ACCESSORY_ROLES as readonly GearRole[]).includes(role);
}

/**
 * What a gear role is called on THIS archetype, in the inventory screen's own
 * words. The role keys are storage keys in saved sheets, not names: a
 * Knight's `outer` is its Kite Shield and its `crown` is its Plate Harness,
 * which is why "Outer" and "Crown" read as nonsense on a label. `slot` comes
 * off slotLabelFor for the three drawn slots (inventoryView.ts's slotWordFor
 * does the same) and ACCESSORY_SLOT_WORD for the rest; `own` is the piece the
 * archetype starts in, null for ring and amulet, which start empty.
 */
export function slotNaming(archetypeId: ArchetypeId, role: GearRole): { slot: string; own: string | null } {
  const slot = isAccessoryRole(role)
    ? ACCESSORY_SLOT_WORD[TEMPLATE_OF_ARCHETYPE[archetypeId]][role]
    : slotLabelFor(SLOTS_BY_ARCHETYPE[archetypeId][role as SlotRole]);
  return { slot, own: gearItemName(archetypeId, role, "common") };
}

/** Compare two item names the way a person would: case, punctuation and a leading article forgiven. */
export const foldItem = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/^(an?|the|some)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Gear: every change goes through the inventory screen's own staging rules.
// ---------------------------------------------------------------------------

export type GearOutcome = { ok: true } | { ok: false; reason: string };

/** The tier worn in a role, by the engine's own tierInSlot: an unarmored hero's armour and shield slots are bare (nothing worn), not "common". */
export function wornTier(p: PlayState, role: GearRole): EquipmentTier | null {
  return tierInSlot(p.hero, role);
}

export function itemName(archetypeId: ArchetypeId, role: GearRole, tier: EquipmentTier): string {
  return gearItemName(archetypeId, role, tier) ?? `${slotNaming(archetypeId, role).slot} (${tier})`;
}

function commitDraft(p: PlayState, draft: LoadoutDraft): GearOutcome {
  const next = commitLoadout(p.hero, draft);
  // commitLoadout hands back the same sheet when it refuses a draft.
  if (next === p.hero) return { ok: false, reason: "The game refused that loadout." };
  p.hero = next;
  return { ok: true };
}

export function equipFromPack(p: PlayState, index: number): GearOutcome {
  const item = p.hero.bag?.[index];
  if (!item) return { ok: false, reason: "That pack space is empty." };
  const staged = stageEquip(p.archetypeId, draftFromSheet(p.hero), index);
  if (!staged.ok) return { ok: false, reason: sentence(staged.reason) };
  const done = commitDraft(p, staged.draft);
  if (done.ok) p.log.push({ text: `Equipped: ${itemName(p.archetypeId, item.slot, item.tier)}.`, tone: "plain" });
  return done;
}

export function takeOff(p: PlayState, role: GearRole): GearOutcome {
  const worn = wornTier(p, role);
  const { slot } = slotNaming(p.archetypeId, role);
  if (!worn) return { ok: false, reason: `The ${slot} slot is already empty.` };
  if (worn === "common") return { ok: false, reason: `Your own ${itemName(p.archetypeId, role, worn)} stays on when nothing better is worn.` };
  const staged = stageUnequip(p.archetypeId, draftFromSheet(p.hero), role);
  if (!staged.ok) return { ok: false, reason: sentence(staged.reason) };
  const done = commitDraft(p, staged.draft);
  if (done.ok) p.log.push({ text: `Took off: ${itemName(p.archetypeId, role, worn)}. It is in your pack.`, tone: "plain" });
  return done;
}

/**
 * The armoury hands an item over as if it had just been found: onto the end
 * of the pack (where lootFor puts a find), then equipped from there through
 * the same stageEquip the pack uses. A refusal (the attunement cap, say)
 * takes it back out of the pack, so trying something on leaves no trace.
 */
export function equipFromArmoury(p: PlayState, role: GearRole, tier: EquipmentTier): GearOutcome {
  const name = itemName(p.archetypeId, role, tier);
  if (wornTier(p, role) === tier) return { ok: false, reason: `Already wearing the ${name}.` };
  if (tier === "common") return takeOff(p, role);
  const bag = p.hero.bag ?? [];
  const inPack = bag.findIndex((b) => b.slot === role && b.tier === tier);
  if (inPack >= 0) return equipFromPack(p, inPack);
  if (bag.length >= BAG_CAPACITY) return { ok: false, reason: "Your pack is full." };
  const before = p.hero;
  p.hero = { ...p.hero, bag: [...bag, { slot: role, tier: tier as MagicTier }] };
  const done = equipFromPack(p, bag.length);
  if (!done.ok) p.hero = before;
  return done;
}

// ---------------------------------------------------------------------------
// Item cards, piles and bodies. The rules are the engine's (inventory/itemActions.ts
// decides what each item offers and applies it, rules/corpses.ts says what a body
// holds); this is the scene around them: where a dropped thing lies, what a search
// of a body turns up, and the words the card shows.
// ---------------------------------------------------------------------------

/** Something hostile is awake or in sight: the game's own gate on changing gear, with the same test the rest rule uses (a sleeping goblin behind a shut door does not stop you). */
export function hostileNear(p: PlayState): boolean {
  return p.round !== null || p.creatures.some((c) => c.hostile && (c.awake || creatureInSight(p, c)));
}

/** What the engine needs to know about the hero's moment to say what an item can do. */
export function itemCtx(p: PlayState): ItemActionContext {
  return {
    inFight: hostileNear(p),
    // Outside a round nobody is waiting for a turn.
    heroTurn: !p.round || heroesTurn(p),
    actionReady: heroActionReady(p),
    heroDown: heroDown(p),
    flags: p.itemFlags,
    // The bench keeps its own potion stock and has no death saves, so a downed hero can still drink.
    potions: p.potions,
    potionWhileDown: true,
  };
}

/** The item a pack or sheet key stands for (sheetItemKey: the section, a colon, the name), or null when it is not there any more. */
export function itemRefFor(p: PlayState, key: string): ItemRef | null {
  const at = key.indexOf(":");
  if (at < 0) return null;
  const section = key.slice(0, at);
  const name = key.slice(at + 1);
  if (section === "Worn") {
    const role = GEAR_ROLES.find((r) => itemNameFor(p.hero, r) === name);
    return role ? { where: "worn", slot: role } : null;
  }
  if (section === "Bag") {
    const index = (p.hero.bag ?? []).findIndex((b) => gearItemName(p.archetypeId, b.slot, b.tier) === name);
    return index >= 0 ? { where: "bag", index } : null;
  }
  if (section === "Carried") return { where: "carried", name };
  if (section === "Consumables") return { where: "consumable", name };
  return null;
}

/** The card an item shows: the hover facts, the engine's one-line status on top, and a button for everything it offers (greyed, with its reason, when it cannot be done now). */
export function itemCardFor(p: PlayState, key: string): ItemCardContent | null {
  const ref = itemRefFor(p, key);
  if (!ref) return null;
  const at = key.indexOf(":");
  const label = key.slice(0, at);
  const name = key.slice(at + 1);
  const info = packInfo(p.hero, { potions: p.potions, notes: p.itemNotes })
    .find((s) => s.label === label)
    ?.items.find((i) => i.name === name);
  if (!info) return null;
  const ctx = itemCtx(p);
  return {
    tip: itemTip(info),
    status: itemStatusLine(p.hero, ref, ctx),
    actions: itemActionsFor(p.hero, ref, ctx).map((a) => ({ id: a.id, label: a.label, enabled: a.enabled, ...(a.reason ? { reason: a.reason } : {}), ...(a.confirm ? { confirm: a.confirm } : {}) })),
  };
}

export const withoutCount = (s: string): string => s.replace(/\s+x\d+$/i, "");

/** Whether a pack still holds, or a pile still lies with, a thing of this name (case and a leading article forgiven). */
function itemStillAround(p: PlayState, name: string): boolean {
  const want = foldItem(withoutCount(name));
  return p.hero.inventory.some((s) => foldItem(withoutCount(s)) === want) || p.piles.some((q) => q.items.some((s) => foldItem(withoutCount(s)) === want));
}

/** An item that has left the hero's hands for good: the DM's note and flags on it go too, unless another copy is still around. */
export function forgetItem(p: PlayState, name: string): void {
  if (itemStillAround(p, name)) return;
  const want = foldItem(name);
  for (const k of Object.keys(p.itemNotes)) if (foldItem(k) === want) delete p.itemNotes[k];
  for (const k of Object.keys(p.itemFlags)) if (foldItem(k) === want) delete p.itemFlags[k];
}

/** Put a thing on the ground at `at`. */
function addToPile(p: PlayState, at: XY, name: string): void {
  const pile = p.piles.find((q) => same(q.at, at));
  if (pile) pile.items.push(name);
  else p.piles.push({ at: { ...at }, items: [name] });
}

/** The pile on a square, when anything lies there. */
export const pileAt = (p: PlayState, at: XY): { at: XY; items: string[] } | undefined => p.piles.find((q) => same(q.at, at) && q.items.length > 0);

/** The body on a square that still has something to search or take. */
export const bodyAt = (p: PlayState, at: XY): BodyState | undefined => p.bodies.find((b) => same(b.at, at) && !b.looted);

/** The nearest searchable body or pile within one square of the hero (the hero's own square counts), a body first. */
export function lootNear(p: PlayState): { kind: "body"; body: BodyState } | { kind: "pile"; at: XY } | null {
  const reach = (at: XY): boolean => tileDistance(p.heroAt, at) <= 1;
  const body = p.bodies.find((b) => !b.looted && reach(b.at));
  if (body) return { kind: "body", body };
  const pile = p.piles.find((q) => q.items.length > 0 && reach(q.at));
  return pile ? { kind: "pile", at: { ...pile.at } } : null;
}

/** The magic piece of gear a name stands for on this hero's gear table, or null (the engine's one namer is gearItemName). */
function magicBagItemNamed(p: PlayState, name: string): { slot: GearRole; tier: MagicTier } | null {
  for (const slot of GEAR_ROLES) {
    for (const tier of MAGIC_TIERS) {
      if (gearItemExists(p.archetypeId, slot, tier) && gearItemName(p.archetypeId, slot, tier) === name) return { slot, tier };
    }
  }
  return null;
}

/**
 * The first search of a body rolls the engine's own loot (the fight source, one roll of the cell's ledger), and a find waits
 * on the body to be taken, not in the pack. When the ledger is spent the log says so, as it does for the chest.
 */
export function ensureBodyLoot(p: PlayState, body: BodyState): void {
  if (body.engineLootRolled) return;
  body.engineLootRolled = true;
  const out = lootFor(p.hero, { source: "fight", cx: 0, cy: 0 });
  if (!out.roll) {
    p.log.push({ text: LOOT_CAP_LINE, tone: "plain" });
    return;
  }
  const roll = out.roll;
  // lootFor puts a find straight into the bag; here it has to wait on the body, so only the ledger comes back to the hero.
  p.hero = { ...p.hero, lootLedger: out.sheet.lootLedger };
  const name = roll.item ? gearItemName(p.archetypeId, roll.item.slot, roll.item.tier) : null;
  if (roll.item && name && roll.tier) {
    body.items.push({ name, note: "A magic piece from the engine's loot roll.", kind: "trinket", pocketable: false });
    const slotDie = roll.slotDie >= 2 && roll.slotRoll !== null ? ` d${roll.slotDie} = ${roll.slotRoll}:` : "";
    p.log.push({ text: `Loot: d100 = ${roll.tierRoll}, ${TIER_WORD[roll.tier].toLowerCase()}.${slotDie} ${name}, on the body.`, tone: "good" });
  } else {
    p.log.push({ text: lootLine(roll, null), tone: "plain" });
  }
  // Nothing at all on it (a creature that carries nothing, and no find): it counts as searched.
  if (body.items.length === 0) body.looted = true;
}

/** What a loot window lists for a body: each thing with its real facts on hover (a magic piece reads the engine's own numbers). */
export function bodyLootItems(p: PlayState, body: BodyState): LootWindowItem[] {
  const notes = carriedNotes(body.items);
  return body.items.map((it, i) => {
    const bag = magicBagItemNamed(p, it.name);
    return { key: String(i), name: it.name, tip: itemTip(bag ? describeBagItem(p.hero, bag) : describeCarried(p.hero, it.name, notes)) };
  });
}

/** What a loot window lists for a pile. */
export function pileLootItems(p: PlayState, at: XY): LootWindowItem[] {
  const pile = p.piles.find((q) => same(q.at, at));
  return (pile?.items ?? []).map((name, i) => {
    const bag = magicBagItemNamed(p, name);
    return { key: String(i), name, tip: itemTip(bag ? describeBagItem(p.hero, bag) : describeCarried(p.hero, name, p.itemNotes)) };
  });
}

/** Why a taken thing did not come, or null when it did. A flavour item goes to the carried list, magic gear to the bag (pickUp keeps the bag's rules), and the line goes in the log. */
export function takeIntoPack(p: PlayState, name: string, note: string | null): string | null {
  const magic = magicBagItemNamed(p, name) !== null;
  if (!magic && p.hero.inventory.length >= DM_INVENTORY_MAX) return "Your pack is full.";
  const r = pickUp(p.hero, name, { potions: p.potions });
  if (r.refused) return r.refused;
  p.hero = r.sheet;
  if (r.potions !== undefined) p.potions = r.potions;
  if (note && !magic && !p.itemNotes[name]) p.itemNotes[name] = note;
  p.log.push({ text: r.line, tone: "good", notice: `+ ${name}` });
  return null;
}

/** Take one thing, or "all", from a body. Returns the refusals (what stayed behind and why). */
export function takeFromBodyInto(p: PlayState, bodyId: string, key: string | "all"): string[] {
  const at = p.bodies.findIndex((b) => b.id === bodyId);
  if (at < 0) return ["That body is gone."];
  const refusals: string[] = [];
  const wanted = key === "all" ? p.bodies[at]!.items.map((i) => i.name) : [p.bodies[at]!.items[Number(key)]?.name].filter((n): n is string => !!n);
  for (const name of wanted) {
    const item = p.bodies[at]!.items.find((i) => i.name === name);
    if (!item) continue;
    const why = takeIntoPack(p, item.name, item.note);
    if (why) {
      refusals.push(`${item.name}: ${why}`);
      continue;
    }
    p.bodies[at] = { ...takeFromBody(p.bodies[at]!, item.name).body, token: p.bodies[at]!.token };
  }
  return refusals;
}

/** Take one thing, or "all", off a pile. Returns the refusals. */
export function takeFromPileInto(p: PlayState, at: XY, key: string | "all"): string[] {
  const pile = p.piles.find((q) => same(q.at, at));
  if (!pile) return ["There is nothing there."];
  const refusals: string[] = [];
  const names = key === "all" ? [...pile.items] : [pile.items[Number(key)]].filter((n): n is string => !!n);
  for (const name of names) {
    const act = itemActionsFor(p.hero, { where: "pile", name }, itemCtx(p)).find((a) => a.id === "pickup");
    if (act && !act.enabled) {
      refusals.push(`${name}: ${act.reason ?? "You cannot pick that up."}`);
      continue;
    }
    const why = takeIntoPack(p, name, null);
    if (why) {
      refusals.push(`${name}: ${why}`);
      continue;
    }
    pile.items.splice(pile.items.indexOf(name), 1);
  }
  p.piles = p.piles.filter((q) => q.items.length > 0);
  return refusals;
}

/** Drop one of an item onto the hero's square. Returns the refusal, or null. */
export function dropFromPack(p: PlayState, ref: ItemRef): string | null {
  const r = dropItem(p.hero, ref, itemCtx(p));
  if (r.refused) return r.refused;
  p.hero = r.sheet;
  if (r.potions !== undefined) p.potions = r.potions;
  if (r.dropped) addToPile(p, p.heroAt, r.dropped);
  p.log.push({ text: r.line, tone: "plain" });
  return null;
}

/** Destroy one of an item for good. Returns the refusal, or null. */
export function destroyFromPack(p: PlayState, ref: ItemRef, name: string): string | null {
  const r = destroyItem(p.hero, ref, itemCtx(p));
  if (r.refused) return r.refused;
  p.hero = r.sheet;
  if (r.potions !== undefined) p.potions = r.potions;
  forgetItem(p, name);
  p.log.push({ text: r.line, tone: "plain" });
  return null;
}
