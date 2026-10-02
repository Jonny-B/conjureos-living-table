/**
 * WHAT YOU CAN DO WITH AN ITEM, and the plain-words reason when you cannot.
 *
 * The owner's request: "I want to be able to equip and unequip or use items.
 * The hover window will give me context aware action on an item or clarity. So
 * an item that cannot be used will say cannot be used, or quest items cannot
 * be dropped, or use, drop, destroy."
 *
 * Two halves, both pure (no DOM, no clock, no Math.random):
 *
 *   READERS   `itemActionsFor` lists the buttons an item card shows, each
 *             enabled or disabled WITH its reason; `itemStatusLine` is the one
 *             clarity line at the top of the card.
 *   APPLIERS  `equipItem`, `unequipItem`, `dropItem`, `destroyItem`, `pickUp`
 *             return a NEW sheet and the words for the log. They never touch
 *             the DOM and never mutate their input.
 *
 * NO SECOND SET OF RULES. Equip and unequip run through rules/inventory.ts's
 * own `stageEquip`, `stageUnequip` and `commitLoadout`, behind
 * rules/attunement.ts's `gearChangeBlockedReason` (the same gate the
 * inventory screen uses), and print the engine's own refusal words
 * (attunement full, nothing to take off, bag full). Drop and pick up write the
 * same two fields loot writes (`bag`, `inventory`) and keep the bag's own
 * invariants (distinct items, never one that is also worn, at most
 * BAG_CAPACITY places).
 *
 * WHICH POTION RULE (the owner's brief asks for it to be said out loud):
 *   - "Not your turn", "you have already taken your action" and "you are
 *     already at full health" follow the BENCH's rule (the bench's
 *     drinkPotionRules): a potion takes your action in a fight and is refused
 *     at full health. The game's Item button (LivingTable.tsx handleUseItem)
 *     spends no action and heals nothing at full health, so this is the
 *     stricter of the two on purpose: the card never offers a button that
 *     would waste a potion.
 *   - While you are DOWN the card follows the GAME's rule: refused, "You
 *     cannot use anything while you are on the floor. Roll your death saves."
 *     (SRD 5.1 has no drink-your-own-potion at 0 hit points, and allowing it
 *     bypasses the death saves). The bench has no death saves and lets a
 *     downed hero drink; it passes `potionWhileDown: true` in the context to
 *     get its own rule back. The default is the game's.
 *
 * HONESTY (equipmentTypes.ts rule 7): every string states the real number or
 * the real rule and never implies an effect the engine does not apply. In
 * particular `cost` is what the ENGINE charges: drinking a potion in a fight
 * takes your action; equip, drop, destroy and pick up charge nothing (gear
 * simply cannot change in a fight), so they say "free".
 *
 * SRD 5.1 is CC BY 4.0 (NOTICE.md); the words are our own.
 */
import type { CharacterSheet } from "../characters/creation";
import { itemNameFor, slotsForArchetype, tierInSlot } from "../characters/equipment";
import {
  ACCESSORY_SLOT_WORD,
  BAG_CAPACITY,
  GEAR_ROLES,
  MAGIC_TIERS,
  TEMPLATE_OF_ARCHETYPE,
  gearItemExists,
  gearItemName,
  type ArchetypeId,
  type BagItem,
  type GearRole,
  type EquipmentTier,
  type LoadoutDraft,
  type SlotRole,
} from "../characters/equipmentTypes";
import { ARCHETYPES, type Consumable } from "../characters/templates";
import { packItems, slotLabelFor } from "../menu/equipment";
import { gearChangeBlockedReason, knownArchetypeId } from "../rules/attunement";
import { commitLoadout, draftFromSheet, stageEquip, stageUnequip } from "../rules/inventory";
import { CONSUMABLE_HEAL_NOTATION } from "./itemInfo";

// ── the public shapes ───────────────────────────────────────────────────

export type ItemActionId = "equip" | "unequip" | "use" | "drop" | "destroy" | "pickup";

/** Set by the DM for things it gives. A quest item cannot be dropped or destroyed; a usable item sends its use to the DM. */
export interface ItemFlags {
  quest?: boolean;
  usable?: boolean;
  /** What the hero says to the DM when they use it ("I read the map"). Absent: "I use my <name>." */
  useSay?: string;
}

export type ItemRef =
  | { where: "worn"; slot: string }
  | { where: "bag"; index: number }
  | { where: "carried"; name: string }
  | { where: "consumable"; name: string }
  | { where: "pile"; name: string };

export interface ItemActionContext {
  /** Something hostile is in the room: gear cannot change and potions take your action. */
  inFight: boolean;
  /** It is the hero's turn (only read when inFight). */
  heroTurn: boolean;
  /** The hero's action is still unspent this turn (only read when inFight). */
  actionReady: boolean;
  heroDown: boolean;
  /** The DM's flags, keyed by item name (case, curly apostrophes and a trailing " x2" are ignored). */
  flags?: Readonly<Record<string, ItemFlags>>;
  /** The host's own healing potion stock (the bench keeps one); replaces the sheet's own "Potion of healing" uses. */
  potions?: number;
  /** The host lets a downed hero drink (the bench has no death saves). Default false: the game's rule, refused while down. */
  potionWhileDown?: boolean;
}

export interface ItemAction {
  id: ItemActionId;
  label: string;
  enabled: boolean;
  /** Always set when `enabled` is false, in plain words. */
  reason?: string;
  /** Set on an enabled Destroy: the question to ask before calling `destroyItem`. */
  confirm?: string;
  /** What the engine charges for it. */
  cost?: "free" | "object" | "action";
}

// ── the words ───────────────────────────────────────────────────────────

export const CANNOT_USE_REASON = "Cannot be used: it does nothing on its own. Tell the DM what you do with it.";
export const QUEST_REASON = "Quest item: it cannot be dropped or destroyed.";
export const WORN_REASON = "You are wearing it: unequip it first.";
export const NOT_YOUR_TURN_REASON = "Not your turn.";
export const ACTION_SPENT_REASON = "You have already taken your action this turn.";
export const FULL_HEALTH_REASON = "You are already at full health.";
export const NONE_LEFT_REASON = "None left.";
export const DOWN_USE_REASON = "You cannot use anything while you are on the floor. Roll your death saves.";
export const DEAD_USE_REASON = "You cannot use anything: your hero is dead.";
export const DOWN_HANDS_REASON = "You cannot do that while you are on the floor.";
export const DEAD_HANDS_REASON = "Your hero is dead.";
export const NOT_CARRYING_REASON = "You do not have that.";
export const BAG_FULL_REASON = "Your bag is full.";
export const ALREADY_OWN_REASON = "You already own one of those.";
export const EQUIP_BAG_ONLY_REASON = "Only magic gear in your bag can be equipped.";

// ── small helpers ───────────────────────────────────────────────────────

const CURLY_QUOTES = new RegExp("[" + String.fromCharCode(0x2018, 0x2019) + "]", "g");

/** The one key every name lookup goes through (curly apostrophes folded, case ignored). */
function normKey(name: string): string {
  return name.replace(CURLY_QUOTES, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** "Handaxe x2" -> { base: "Handaxe", count: 2 }. "Shortbow, 20 arrows" has no trailing count and stays whole. */
function splitCount(raw: string): { base: string; count: number } {
  const text = raw.trim();
  const m = /^(.*\S)\s+x\s*(\d+)$/i.exec(text);
  if (!m) return { base: text, count: 1 };
  const count = Number.parseInt(m[2]!, 10);
  return count >= 1 ? { base: m[1]!.trim(), count } : { base: text, count: 1 };
}

function joinCount(base: string, count: number): string {
  return count <= 1 ? base : `${base} x${count}`;
}

/** "there is nothing in that bag cell" -> "There is nothing in that bag cell." (the engine's reasons are lower-case fragments). */
function sentence(reason: string): string {
  const t = reason.trim();
  if (!t) return t;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

function isGearRole(role: string): role is GearRole {
  return (GEAR_ROLES as readonly string[]).includes(role);
}

function isSlotRole(role: GearRole): role is SlotRole {
  return role === "weapon" || role === "outer" || role === "crown";
}

const POTION_KEY = "potion of healing";

function flagsFor(ctx: ItemActionContext, name: string): ItemFlags {
  if (!ctx.flags) return {};
  const wanted = new Set([normKey(name), normKey(splitCount(name).base)]);
  for (const [key, value] of Object.entries(ctx.flags)) {
    if (wanted.has(normKey(key)) || wanted.has(normKey(splitCount(key).base))) return value ?? {};
  }
  return {};
}

function isDown(sheet: CharacterSheet, ctx: ItemActionContext): boolean {
  return ctx.heroDown || sheet.downed || sheet.stable;
}

// ── what a ref points at ────────────────────────────────────────────────

type Subject =
  | { kind: "worn"; role: GearRole; tier: EquipmentTier; name: string }
  | { kind: "bag"; index: number; item: BagItem; name: string }
  | { kind: "carried"; invIndex: number; raw: string; base: string; count: number }
  | { kind: "consumable"; c: Consumable | null; name: string; count: number; hostStock: boolean }
  | { kind: "pile"; name: string };

function archetypeIdOf(sheet: CharacterSheet): ArchetypeId | null {
  return knownArchetypeId(sheet.archetypeId);
}

function consumableIndex(sheet: CharacterSheet, key: string): number {
  return (sheet.consumables ?? []).findIndex((c) => normKey(c.name) === key);
}

function consumableSubject(sheet: CharacterSheet, name: string, ctx: ItemActionContext): Subject | null {
  const key = normKey(splitCount(name).base);
  const idx = consumableIndex(sheet, key);
  if (key === POTION_KEY && ctx.potions !== undefined) {
    const c = idx >= 0 ? sheet.consumables[idx]! : null;
    return { kind: "consumable", c, name: c?.name ?? "Potion of healing", count: Math.max(0, Math.floor(ctx.potions)), hostStock: true };
  }
  if (idx < 0) return null;
  const c = sheet.consumables[idx]!;
  return { kind: "consumable", c, name: c.name, count: Math.max(0, Math.floor(c.uses)), hostStock: false };
}

function resolve(sheet: CharacterSheet, ref: ItemRef, ctx: ItemActionContext): Subject | null {
  switch (ref.where) {
    case "worn": {
      if (!isGearRole(ref.slot) || !archetypeIdOf(sheet)) return null;
      const tier = tierInSlot(sheet, ref.slot);
      const name = itemNameFor(sheet, ref.slot);
      if (tier === null || name === null) return null;
      return { kind: "worn", role: ref.slot, tier, name };
    }
    case "bag": {
      const arch = archetypeIdOf(sheet);
      const item = (sheet.bag ?? [])[ref.index];
      if (!arch || !item) return null;
      const name = gearItemName(arch, item.slot, item.tier);
      return name === null ? null : { kind: "bag", index: ref.index, item, name };
    }
    case "consumable":
      return consumableSubject(sheet, ref.name, ctx);
    case "carried": {
      const { base } = splitCount(ref.name);
      // "Trauma kit" is both a flavour-list string and a consumable: it acts as the consumable.
      const asConsumable = consumableSubject(sheet, base, ctx);
      if (asConsumable) return asConsumable;
      const wanted = new Set([normKey(ref.name), normKey(base)]);
      const shown = packItems(sheet);
      const raw = shown.find((s) => wanted.has(normKey(s)) || wanted.has(normKey(splitCount(s).base)));
      // The worn kit's own names are not in packItems, so they resolve to nothing here (the gear rows own them).
      if (raw === undefined) return null;
      const invIndex = sheet.inventory.findIndex((s) => s === raw);
      if (invIndex < 0) return null;
      const split = splitCount(raw);
      return { kind: "carried", invIndex, raw, base: split.base, count: split.count };
    }
    case "pile":
      return ref.name.trim() ? { kind: "pile", name: ref.name.trim() } : null;
  }
}

function subjectName(s: Subject): string {
  switch (s.kind) {
    case "worn":
    case "bag":
    case "pile":
    case "consumable":
      return s.name;
    case "carried":
      return s.base;
  }
}

// ── the gates ───────────────────────────────────────────────────────────

/** Why the hero's hands are not free right now, or null. Dead and down first, then a fight that is not on your turn. */
function handsBlockedReason(sheet: CharacterSheet, ctx: ItemActionContext): string | null {
  if (sheet.dead) return DEAD_HANDS_REASON;
  if (isDown(sheet, ctx)) return DOWN_HANDS_REASON;
  if (ctx.inFight && !ctx.heroTurn) return NOT_YOUR_TURN_REASON;
  return null;
}

/** Why gear may not change right now: the engine's own gate, verbatim. */
function gearBlockedReason(sheet: CharacterSheet, ctx: ItemActionContext): string | null {
  return gearChangeBlockedReason(
    { name: sheet.name, downed: sheet.downed || ctx.heroDown, stable: sheet.stable, dead: sheet.dead },
    ctx.inFight,
  );
}

/** Why this consumable cannot be used right now, or null. See the header for which rule each line follows. */
function useConsumableBlockedReason(sheet: CharacterSheet, count: number, ctx: ItemActionContext): string | null {
  if (sheet.dead) return DEAD_USE_REASON;
  if (count <= 0) return NONE_LEFT_REASON;
  const down = isDown(sheet, ctx);
  if (down && !ctx.potionWhileDown) return DOWN_USE_REASON;
  if (ctx.inFight && !ctx.heroTurn) return NOT_YOUR_TURN_REASON;
  if (ctx.inFight && !ctx.actionReady) return ACTION_SPENT_REASON;
  if (!down && sheet.currentHp >= sheet.maxHp) return FULL_HEALTH_REASON;
  return null;
}

/** Why a flagged-usable carried item cannot be sent to the DM right now, or null. */
function useCarriedBlockedReason(sheet: CharacterSheet, ctx: ItemActionContext): string | null {
  if (sheet.dead) return DEAD_USE_REASON;
  if (isDown(sheet, ctx)) return DOWN_USE_REASON;
  if (ctx.inFight && !ctx.heroTurn) return NOT_YOUR_TURN_REASON;
  return null;
}

/** Why this subject cannot be dropped or destroyed, or null: worn, then the quest flag, then the hands. */
function parkBlockedReason(sheet: CharacterSheet, s: Subject, ctx: ItemActionContext): string | null {
  if (s.kind === "worn") return WORN_REASON;
  if (s.kind === "pile") return "It is already on the ground.";
  if (s.kind === "consumable" && s.count <= 0) return NONE_LEFT_REASON;
  if (flagsFor(ctx, subjectName(s)).quest) return QUEST_REASON;
  return handsBlockedReason(sheet, ctx);
}

/** Why picking this up is refused, or null. Sheet-level only (the host decides whether the pile is in reach). */
function pickUpBlockedReason(sheet: CharacterSheet, name: string): string | null {
  if (sheet.dead) return DEAD_HANDS_REASON;
  if (sheet.downed || sheet.stable) return DOWN_HANDS_REASON;
  const gear = magicGearNamed(sheet, name);
  if (gear) {
    const owned =
      sheet.equipment?.[gear.slot]?.tier === gear.tier || (sheet.bag ?? []).some((b) => b.slot === gear.slot && b.tier === gear.tier);
    if (owned) return ALREADY_OWN_REASON;
    if ((sheet.bag ?? []).length >= BAG_CAPACITY) return BAG_FULL_REASON;
  }
  return null;
}

// ── magic gear by name ──────────────────────────────────────────────────

/** The bag item an exact gear name stands for on this character, or null (the one namer is `gearItemName`). */
function magicGearNamed(sheet: CharacterSheet, name: string): BagItem | null {
  const arch = archetypeIdOf(sheet);
  if (!arch) return null;
  const key = normKey(name);
  for (const role of GEAR_ROLES) {
    for (const tier of MAGIC_TIERS) {
      if (!gearItemExists(arch, role, tier)) continue;
      const gear = gearItemName(arch, role, tier);
      if (gear !== null && normKey(gear) === key) return { slot: role, tier };
    }
  }
  return null;
}

// ── equip and unequip: the engine's own staging ─────────────────────────

export interface EquipResult {
  sheet: CharacterSheet;
  line: string;
  refused?: string;
}

function refusedEquip(sheet: CharacterSheet, why: string): EquipResult {
  const refused = sentence(why);
  return { sheet, line: refused, refused };
}

/** The staged equip, or the engine's refusal. `bagIndex` is a cell in `sheet.bag`. */
function tryEquip(sheet: CharacterSheet, bagIndex: number, hostilesPresent: boolean): EquipResult {
  const gate = gearChangeBlockedReason(sheet, hostilesPresent);
  if (gate) return refusedEquip(sheet, gate);
  const arch = archetypeIdOf(sheet);
  if (!arch) return refusedEquip(sheet, "this character has no gear table to equip from");
  const draft: LoadoutDraft = draftFromSheet(sheet);
  const staged = stageEquip(sheet.archetypeId, draft, bagIndex);
  if (!staged.ok) return refusedEquip(sheet, staged.reason);
  const committed = commitLoadout(sheet, staged.draft);
  if (committed === sheet) return refusedEquip(sheet, "the game would not allow that change");
  const item = draft.bag[bagIndex]!;
  const name = gearItemName(arch, item.slot, item.tier) ?? "it";
  const outgoing = itemNameFor(sheet, item.slot);
  const swap = outgoing ? ` Your ${outgoing} is put away.` : "";
  return { sheet: committed, line: `You equip the ${name}.${swap}` };
}

/**
 * Equip the magic piece in a bag cell, through stageEquip and commitLoadout.
 * `opts.hostilesPresent` is the same flag `gearChangeBlockedReason` takes
 * (gear cannot change with something hostile in the room); dead and down are
 * read off the sheet itself.
 */
export function equipItem(sheet: CharacterSheet, ref: ItemRef, opts?: { hostilesPresent?: boolean }): EquipResult {
  if (ref.where !== "bag") return refusedEquip(sheet, EQUIP_BAG_ONLY_REASON);
  return tryEquip(sheet, ref.index, opts?.hostilesPresent === true);
}

/** Take off the magic piece worn in `slot`, through stageUnequip and commitLoadout. It goes to the end of the bag. */
export function unequipItem(sheet: CharacterSheet, slot: string, opts?: { hostilesPresent?: boolean }): EquipResult {
  if (!isGearRole(slot)) return refusedEquip(sheet, `there is no ${slot} slot`);
  const gate = gearChangeBlockedReason(sheet, opts?.hostilesPresent === true);
  if (gate) return refusedEquip(sheet, gate);
  const arch = archetypeIdOf(sheet);
  if (!arch) return refusedEquip(sheet, "this character has no gear table to take anything off");
  const draft = draftFromSheet(sheet);
  const staged = stageUnequip(sheet.archetypeId, draft, slot);
  if (!staged.ok) return refusedEquip(sheet, staged.reason);
  const name = itemNameFor(sheet, slot) ?? "it";
  const committed = commitLoadout(sheet, staged.draft);
  if (committed === sheet) {
    return refusedEquip(sheet, (sheet.bag ?? []).length >= BAG_CAPACITY ? BAG_FULL_REASON : "the game would not allow that change");
  }
  return { sheet: committed, line: `You take off the ${name}. It goes in your bag.` };
}

// ── the readers ─────────────────────────────────────────────────────────

function useLabelFor(): string {
  return "Use";
}

function disabled(id: ItemActionId, label: string, reason: string): ItemAction {
  return { id, label, enabled: false, reason };
}

function confirmFor(name: string, count: number): string {
  return count > 1 ? `Destroy one ${name}? You have ${count}; this one is gone for good.` : `Destroy the ${name}? It is gone for good.`;
}

function dropDestroy(sheet: CharacterSheet, s: Subject, ctx: ItemActionContext): ItemAction[] {
  const reason = parkBlockedReason(sheet, s, ctx);
  const name = subjectName(s);
  const count = s.kind === "carried" || s.kind === "consumable" ? s.count : 1;
  return [
    reason ? disabled("drop", "Drop", reason) : { id: "drop", label: "Drop", enabled: true, cost: "free" },
    reason
      ? disabled("destroy", "Destroy", reason)
      : { id: "destroy", label: "Destroy", enabled: true, confirm: confirmFor(name, count), cost: "free" },
  ];
}

/** The buttons an item card shows, in order. Every disabled one carries its reason. An unknown item gets none. */
export function itemActionsFor(sheet: CharacterSheet, ref: ItemRef, ctx: ItemActionContext): ItemAction[] {
  const s = resolve(sheet, ref, ctx);
  if (!s) return [];
  switch (s.kind) {
    case "worn": {
      const gate = gearBlockedReason(sheet, ctx);
      let unequip: ItemAction;
      if (gate) unequip = disabled("unequip", "Unequip", sentence(gate));
      else {
        const staged = stageUnequip(sheet.archetypeId, draftFromSheet(sheet), s.role);
        if (!staged.ok) unequip = disabled("unequip", "Unequip", sentence(staged.reason));
        else if (commitLoadout(sheet, staged.draft) === sheet) {
          unequip = disabled("unequip", "Unequip", (sheet.bag ?? []).length >= BAG_CAPACITY ? BAG_FULL_REASON : "The game would not allow that change.");
        } else unequip = { id: "unequip", label: "Unequip", enabled: true, cost: "free" };
      }
      return [unequip, disabled("drop", "Drop", WORN_REASON), disabled("destroy", "Destroy", WORN_REASON)];
    }
    case "bag": {
      const gate = gearBlockedReason(sheet, ctx);
      let equip: ItemAction;
      if (gate) equip = disabled("equip", "Equip", sentence(gate));
      else {
        const staged = stageEquip(sheet.archetypeId, draftFromSheet(sheet), s.index);
        if (!staged.ok) equip = disabled("equip", "Equip", sentence(staged.reason));
        else if (commitLoadout(sheet, staged.draft) === sheet) equip = disabled("equip", "Equip", "The game would not allow that change.");
        else equip = { id: "equip", label: "Equip", enabled: true, cost: "free" };
      }
      return [equip, ...dropDestroy(sheet, s, ctx)];
    }
    case "carried": {
      const flags = flagsFor(ctx, s.base);
      let use: ItemAction;
      if (!flags.usable) use = disabled("use", useLabelFor(), CANNOT_USE_REASON);
      else {
        const why = useCarriedBlockedReason(sheet, ctx);
        use = why ? disabled("use", useLabelFor(), why) : { id: "use", label: useLabelFor(), enabled: true };
      }
      return [use, ...dropDestroy(sheet, s, ctx)];
    }
    case "consumable": {
      const why = useConsumableBlockedReason(sheet, s.count, ctx);
      const use: ItemAction = why
        ? disabled("use", useLabelFor(), why)
        : { id: "use", label: useLabelFor(), enabled: true, cost: ctx.inFight ? "action" : "free" };
      return [use, ...dropDestroy(sheet, s, ctx)];
    }
    case "pile": {
      const why = pickUpBlockedReason(sheet, s.name) ?? (ctx.inFight && !ctx.heroTurn ? NOT_YOUR_TURN_REASON : null);
      return [why ? disabled("pickup", "Pick up", why) : { id: "pickup", label: "Pick up", enabled: true, cost: "free" }];
    }
  }
}

/** What the hero says to the DM when they use a flagged item: the DM's own `useSay`, else "I use my <name>." Null when the item is not a usable carried one. */
export function itemUseSay(sheet: CharacterSheet, ref: ItemRef, ctx: ItemActionContext): string | null {
  const s = resolve(sheet, ref, ctx);
  if (!s || s.kind !== "carried") return null;
  const flags = flagsFor(ctx, s.base);
  if (!flags.usable) return null;
  const say = typeof flags.useSay === "string" ? flags.useSay.trim() : "";
  return say || `I use my ${s.base}.`;
}

function slotWordOf(sheet: CharacterSheet, role: GearRole): string {
  const arch = archetypeIdOf(sheet);
  if (!arch) return role;
  if (isSlotRole(role)) {
    const def = slotsForArchetype(sheet.archetypeId)?.[role];
    return def ? slotLabelFor(def) : role;
  }
  return ACCESSORY_SLOT_WORD[TEMPLATE_OF_ARCHETYPE[arch]][role];
}

function drinkVerb(name: string): string {
  return /potion|draught|elixir|tonic/i.test(name) ? "Drink" : "Use";
}

/** The clarity line on top of the item card. One or two plain sentences; it never promises an effect the engine does not apply. */
export function itemStatusLine(sheet: CharacterSheet, ref: ItemRef, ctx: ItemActionContext): string {
  const s = resolve(sheet, ref, ctx);
  if (!s) return NOT_CARRYING_REASON;
  const actions = itemActionsFor(sheet, ref, ctx);
  const action = (id: ItemActionId): ItemAction | undefined => actions.find((a) => a.id === id);
  switch (s.kind) {
    case "worn": {
      const base = `Worn in your ${slotWordOf(sheet, s.role)} slot.`;
      if (s.tier === "common") return `${base} It is your own piece, so there is nothing magic to take off.`;
      const un = action("unequip");
      return un && !un.enabled && un.reason ? `${base} ${un.reason}` : `${base} Unequip puts it in your bag.`;
    }
    case "bag": {
      const base = "In your bag, not worn: it adds nothing until you equip it.";
      const eq = action("equip");
      const quest = flagsFor(ctx, s.name).quest ? ` ${QUEST_REASON}` : "";
      return eq && !eq.enabled && eq.reason ? `${base} ${eq.reason}${quest}` : `${base}${quest}`;
    }
    case "carried": {
      const flags = flagsFor(ctx, s.base);
      const parts: string[] = [];
      if (flags.quest) parts.push(QUEST_REASON);
      if (flags.usable) {
        const use = action("use");
        parts.push(use && !use.enabled && use.reason ? `Use sends it to the DM. Not now: ${use.reason}` : "The DM marked this usable: Use sends it to the DM.");
      } else {
        parts.push(CANNOT_USE_REASON);
      }
      return parts.join(" ");
    }
    case "consumable": {
      const verb = drinkVerb(s.name);
      const left = s.count === 1 ? "1 left" : `${s.count} left`;
      const quest = flagsFor(ctx, s.name).quest ? ` ${QUEST_REASON}` : "";
      const base = `${verb} it to heal ${CONSUMABLE_HEAL_NOTATION} (takes your action in a fight). ${left}.${quest}`;
      const use = action("use");
      return use && !use.enabled && use.reason ? `${base} Not now: ${use.reason}` : base;
    }
    case "pile": {
      const pick = action("pickup");
      return pick && !pick.enabled && pick.reason ? `Lying on the ground. ${pick.reason}` : "Lying on the ground. Pick it up to carry it.";
    }
  }
}

// ── the appliers: drop, destroy, pick up ────────────────────────────────

export interface DropResult {
  sheet: CharacterSheet;
  /** The name that now lies on the hero's square (what `pickUp` takes back), or null when nothing was dropped. */
  dropped: string | null;
  line: string;
  refused?: string;
  /** Set when the host's own potion stock (ctx.potions) was the thing spent: the new stock. The sheet is unchanged. */
  potions?: number;
}

export interface DestroyResult {
  sheet: CharacterSheet;
  line: string;
  refused?: string;
  /** Set when the host's own potion stock (ctx.potions) was the thing spent: the new stock. The sheet is unchanged. */
  potions?: number;
}

export interface PickUpResult {
  sheet: CharacterSheet;
  line: string;
  refused?: string;
  /** Set when `opts.potions` was given and the thing picked up is a potion of healing: the new stock. The sheet is unchanged. */
  potions?: number;
}

/** Take ONE of a stack, or the whole item, off the sheet. Shared by drop (which keeps the name) and destroy (which does not). */
function removeOne(sheet: CharacterSheet, s: Subject): { sheet: CharacterSheet; name: string; potions?: number } {
  switch (s.kind) {
    case "bag": {
      const bag = (sheet.bag ?? []).filter((_, i) => i !== s.index);
      return { sheet: { ...sheet, bag }, name: s.name };
    }
    case "carried": {
      const inventory = sheet.inventory.slice();
      if (s.count > 1) inventory[s.invIndex] = joinCount(s.base, s.count - 1);
      else inventory.splice(s.invIndex, 1);
      return { sheet: { ...sheet, inventory }, name: s.base };
    }
    case "consumable": {
      if (s.hostStock) return { sheet, name: s.name, potions: s.count - 1 };
      const consumables = sheet.consumables.map((c) => (normKey(c.name) === normKey(s.name) ? { ...c, uses: Math.max(0, c.uses - 1) } : c));
      return { sheet: { ...sheet, consumables }, name: s.name };
    }
    default:
      return { sheet, name: subjectName(s) };
  }
}

/**
 * Drop one item (one of a stack) onto the hero's square. Refused for worn
 * gear, quest items, anything while down or dead, and in a fight off your
 * turn. `dropped` is the name the host puts in the pile; `pickUp` takes it
 * back.
 */
export function dropItem(sheet: CharacterSheet, ref: ItemRef, ctx: ItemActionContext): DropResult {
  const s = resolve(sheet, ref, ctx);
  if (!s) return { sheet, dropped: null, line: NOT_CARRYING_REASON, refused: NOT_CARRYING_REASON };
  const why = parkBlockedReason(sheet, s, ctx);
  if (why) return { sheet, dropped: null, line: why, refused: why };
  const out = removeOne(sheet, s);
  const result: DropResult = { sheet: out.sheet, dropped: out.name, line: `You drop the ${out.name}. It lies on your square.` };
  if (out.potions !== undefined) result.potions = out.potions;
  return result;
}

/** Destroy one item (one of a stack) for good. The caller asks `ItemAction.confirm` first. Same refusals as drop. */
export function destroyItem(sheet: CharacterSheet, ref: ItemRef, ctx: ItemActionContext): DestroyResult {
  const s = resolve(sheet, ref, ctx);
  if (!s) return { sheet, line: NOT_CARRYING_REASON, refused: NOT_CARRYING_REASON };
  const why = parkBlockedReason(sheet, s, ctx);
  if (why) return { sheet, line: why, refused: why };
  const out = removeOne(sheet, s);
  const result: DestroyResult = { sheet: out.sheet, line: `You destroy the ${out.name}. It is gone for good.` };
  if (out.potions !== undefined) result.potions = out.potions;
  return result;
}

/**
 * Take a named thing off the ground. Magic gear the character's own gear
 * table names goes into the bag (never a duplicate of something owned, never
 * past BAG_CAPACITY); a consumable the character owns or starts with goes
 * back into its uses; anything else joins the carried list, merging into an
 * existing stack ("Handaxe" onto "Handaxe" makes "Handaxe x2"). When
 * `opts.potions` is given (a host that keeps its own potion stock), a potion
 * of healing raises that stock instead and the sheet is returned unchanged.
 */
export function pickUp(sheet: CharacterSheet, name: string, opts?: { potions?: number }): PickUpResult {
  const clean = name.trim();
  if (!clean) return { sheet, line: NOT_CARRYING_REASON, refused: NOT_CARRYING_REASON };
  const why = pickUpBlockedReason(sheet, clean);
  if (why) return { sheet, line: why, refused: why };
  const key = normKey(splitCount(clean).base);

  const gear = magicGearNamed(sheet, clean);
  if (gear) {
    const arch = archetypeIdOf(sheet)!;
    const shown = gearItemName(arch, gear.slot, gear.tier) ?? clean;
    return { sheet: { ...sheet, bag: [...(sheet.bag ?? []), gear] }, line: `You pick up the ${shown}. It goes in your bag.` };
  }

  if (key === POTION_KEY && opts?.potions !== undefined) {
    return { sheet, line: "You pick up the Potion of healing.", potions: Math.max(0, Math.floor(opts.potions)) + 1 };
  }

  const owned = consumableIndex(sheet, key);
  if (owned >= 0) {
    const consumables = sheet.consumables.map((c, i) => (i === owned ? { ...c, uses: c.uses + 1 } : c));
    return { sheet: { ...sheet, consumables }, line: `You pick up the ${sheet.consumables[owned]!.name}.` };
  }
  const starter = ARCHETYPES.find((a) => a.id === sheet.archetypeId)?.startingConsumables.find((c) => normKey(c.name) === key);
  if (starter) {
    return { sheet: { ...sheet, consumables: [...(sheet.consumables ?? []), { ...starter, uses: 1 }] }, line: `You pick up the ${starter.name}.` };
  }

  const { base, count } = splitCount(clean);
  const inventory = sheet.inventory.slice();
  const at = inventory.findIndex((s) => normKey(splitCount(s).base) === normKey(base));
  if (at >= 0) {
    const have = splitCount(inventory[at]!);
    inventory[at] = joinCount(have.base, have.count + count);
  } else {
    inventory.push(joinCount(base, count));
  }
  return { sheet: { ...sheet, inventory }, line: `You pick up the ${base}.` };
}
