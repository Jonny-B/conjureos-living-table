/**
 * THE BAG, staged. Equip, unequip, and the draft/commit cycle the inventory
 * screen stages a change through before it lands on the real sheet.
 *
 * Everything here operates on the structural `GearSheet` / `LoadoutDraft`
 * shapes pinned in `characters/equipmentTypes.ts` (`archetypeId`, `equipment`,
 * `bag`), never on a full CharacterSheet: staging a gear swap needs none of a
 * sheet's HP, spells or conditions, and keeping this module blind to the rest
 * of the sheet is what lets the inventory screen preview a change (the doll
 * redraws from the draft) without ever touching the character that is
 * actually on the board.
 *
 * NOTHING HERE IS A PAID ACTION and nothing here calls the model: staging and
 * committing a loadout is arithmetic on a small array and a small record, the
 * same free-forever rule every other function in this feature keeps.
 */
import { attunedRoles, knownArchetypeId } from "./attunement";
import {
  BAG_CAPACITY,
  GEAR_ROLES,
  MAGIC_TIERS,
  MAX_ATTUNED_ITEMS,
  STARTING_LOADOUT,
  attunementFullReason,
  gearItemExists,
  gearItemName,
  gearRequiresAttunement,
  type ArchetypeId,
  type BagItem,
  type CommitLoadoutFn,
  type DraftFromSheetFn,
  type Equipment,
  type GearRole,
  type GearSheet,
  type LoadoutDraft,
  type MagicTier,
  type StageEquipFn,
  type StageOutcome,
  type StageUnequipFn,
} from "../characters/equipmentTypes";

// ── reading a sheet into something the screen can stage against ─────────

/**
 * A normalised copy of the sheet's equipment and bag, ready to stage.
 *
 * Deliberately NOT a defensive re-validation of `sheet.bag`'s invariants
 * (duplicate entries, an item also worn, an unknown tier): by the time a
 * sheet reaches the screen it has already crossed the one real load boundary
 * (`normalizeBag`, called from `characters/creation.ts`'s `normalizeSheet`
 * and `session/characterState.ts`'s `characterStateFromStats`), so re-running
 * that scan here on every screen open would be strictly redundant work on
 * data this module already trusts, the same trust model
 * `characters/equipment.ts` documents for the rest of the blob.
 */
export function draftFromSheet(sheet: GearSheet): LoadoutDraft {
  return {
    equipment: sheet.equipment ? { ...sheet.equipment } : { ...STARTING_LOADOUT },
    bag: sheet.bag ? [...sheet.bag] : [],
  };
}

// ── equip: bag cell -> slot ──────────────────────────────────────────────

/**
 * Equip `draft.bag[bagIndex]` into the slot it fits, swapping IN PLACE: the
 * outgoing piece takes the incoming item's cell when the outgoing piece is
 * itself magic, or the cell is removed (and later cells shift left, which a
 * plain `Array.prototype.splice` already does) when the slot held only the
 * character's own common piece or was empty.
 *
 * Refuses, staging nothing, in exactly two cases: `bagIndex` does not name a
 * real bag entry, or the incoming item needs attunement and equipping it
 * would exceed MAX_ATTUNED_ITEMS. The second refusal prints
 * `attunementFullReason` naming the three items CURRENTLY worn and attuned
 * (in the draft as it stands before this equip), which is the SRD's own
 * remedy: take one of them off first.
 */
export function stageEquip(archetypeId: string, draft: LoadoutDraft, bagIndex: number): StageOutcome {
  const known = knownArchetypeId(archetypeId);
  if (!known) return { ok: false, reason: "this character has no gear table to equip from" };
  const bagItem = draft.bag[bagIndex];
  if (!bagItem) return { ok: false, reason: "there is nothing in that bag cell" };

  const role = bagItem.slot;
  const tier = bagItem.tier;

  if (gearRequiresAttunement(known, role, tier)) {
    // Whether THIS ROLE is already one of the currently-attuned ones, BEFORE
    // the swap. If it is (an attuned ring being traded for a different
    // attuned ring, say), the swap spends no new attunement slot at all: one
    // attuned item leaves this role and another takes its place, net zero.
    // Only when this role is newly becoming an attunement item does it need
    // to check whether a slot is actually free.
    //
    // Deliberately NOT "build a trial Equipment and ask attunedRoles whether
    // IT thinks this role made the cut": `attunedRoles`' GEAR_ROLES ordering
    // is a tie-break for a BAD BLOB that already holds more attuned items
    // than the cap allows (see rules/attunement.ts), not a priority scheme
    // for staging. Using it here would let equipping a weapon (early in
    // GEAR_ROLES order) silently bump an already-worn, already-attuned
    // amulet (late in the order) out of the attuned set with no refusal and
    // no warning -- exactly the "silently short" failure this whole feature
    // exists to avoid. Staging must refuse outright, not reassign.
    const before = attunedRoles(archetypeId, draft.equipment);
    if (!before.includes(role) && before.length >= MAX_ATTUNED_ITEMS) {
      const currentNames = before
        .map((r) => gearItemName(known, r, draft.equipment[r]!.tier))
        .filter((name): name is string => name !== null);
      return { ok: false, reason: attunementFullReason(currentNames) };
    }
  }

  const outgoing = draft.equipment[role];
  const outgoingIsMagic = outgoing !== undefined && outgoing.tier !== "common";

  const nextEquipment: Equipment = { ...draft.equipment, [role]: { slot: role, tier } };
  const nextBag = draft.bag.slice();
  if (outgoingIsMagic) {
    // outgoing.tier is a MagicTier here: "common" was just excluded above,
    // and ring/amulet are never stored with tier "common" in the first place.
    nextBag[bagIndex] = { slot: role, tier: outgoing!.tier as MagicTier };
  } else {
    nextBag.splice(bagIndex, 1);
  }

  return { ok: true, draft: { equipment: nextEquipment, bag: nextBag } };
}

// ── unequip: slot -> end of bag ──────────────────────────────────────────

const SHEET_ONLY: readonly GearRole[] = ["ring", "amulet"];

/**
 * Take off the magic piece worn in `role`. It goes to the END of the bag
 * (new finds and unequipped pieces share that one rule: append); the
 * character's own common piece returns to a drawn role (weapon, outer,
 * crown, boots), or a ring/amulet slot simply empties, since neither has a
 * common piece to fall back to.
 *
 * Refuses a slot that holds nothing worth taking off: empty, or already the
 * character's own common piece. Both are read the same way the screen reads
 * them ("Your own <name>. It is what you wear when nothing better is on."):
 * there is no Unequip button to press in the first place.
 */
export function stageUnequip(_archetypeId: string, draft: LoadoutDraft, role: GearRole): StageOutcome {
  const current = draft.equipment[role];
  if (!current || current.tier === "common") return { ok: false, reason: `there is nothing magic worn in the ${role} slot` };

  const nextBag = [...draft.bag, { slot: role, tier: current.tier as MagicTier }];
  const nextEquipment: Equipment = { ...draft.equipment };
  if (SHEET_ONLY.includes(role)) {
    delete nextEquipment[role];
  } else {
    nextEquipment[role] = { slot: role, tier: "common" };
  }

  return { ok: true, draft: { equipment: nextEquipment, bag: nextBag } };
}

// ── commit: draft -> the real sheet ──────────────────────────────────────

/** `(role, tier)` pairs of every magic item this loadout owns, worn or bagged, as a sorted, comparable key list. Staging only ever MOVES an item between "worn" and "bagged"; it never creates or destroys one, and this is the check that proves it. */
function ownedMagicKeys(equipment: Equipment, bag: readonly BagItem[]): string[] {
  const keys: string[] = [];
  for (const role of GEAR_ROLES) {
    const item = equipment[role];
    if (item && item.tier !== "common") keys.push(`${role}:${item.tier}`);
  }
  for (const item of bag) keys.push(`${item.slot}:${item.tier}`);
  return keys.sort();
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

function isValidBag(archetypeId: ArchetypeId, equipment: Equipment, bag: readonly BagItem[]): boolean {
  if (bag.length > BAG_CAPACITY) return false;
  const seen = new Set<string>();
  for (const item of bag) {
    if (!(MAGIC_TIERS as readonly string[]).includes(item.tier)) return false;
    if (!gearItemExists(archetypeId, item.slot, item.tier)) return false;
    const key = `${item.slot}:${item.tier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const worn = equipment[item.slot];
    if (worn && worn.tier === item.tier) return false;
  }
  return true;
}

/**
 * Write the draft's `equipment` and `bag` onto `sheet` and NOTHING else.
 * Returns `sheet` UNCHANGED (the same object, so a caller can compare by
 * reference) when the draft would not be a legal outcome of staging: it does
 * not hold exactly the same set of owned magic items the sheet started with,
 * it breaks a bag invariant, or it wears more attunement items than
 * MAX_ATTUNED_ITEMS actually counts as attuned.
 *
 * This is the one and only write path for equipment and bag together, which
 * is the property that lets the inventory screen be "one staged equip
 * surface, not two writers" (issue #15's own restore note): nothing else in
 * this codebase may assign `sheet.equipment` or `sheet.bag` directly.
 */
export function commitLoadout<S extends GearSheet>(sheet: S, draft: LoadoutDraft): S {
  const archetypeId = knownArchetypeId(sheet.archetypeId);
  if (!archetypeId) return sheet;
  const before = ownedMagicKeys(sheet.equipment ?? STARTING_LOADOUT, sheet.bag ?? []);
  const after = ownedMagicKeys(draft.equipment, draft.bag);
  if (!sameKeys(before, after)) return sheet;
  if (!isValidBag(archetypeId, draft.equipment, draft.bag)) return sheet;
  // The attunement cap, checked on the UNCAPPED count. `attunedRoles` slices
  // its answer at MAX_ATTUNED_ITEMS (that slice is the bad-blob safety for a
  // sheet that already wears too many), so asking it here would always say
  // "three or fewer" and wave a fourth straight through. The contract's
  // CommitLoadoutFn refuses a draft that WEARS more than MAX_ATTUNED_ITEMS
  // attunement items, so a committed sheet can never be the bad blob.
  if (wornAttunementCount(archetypeId, draft.equipment) > MAX_ATTUNED_ITEMS) return sheet;
  return { ...sheet, equipment: draft.equipment, bag: draft.bag };
}

/** How many worn pieces require attunement, NOT capped (unlike `attunedRoles`). */
function wornAttunementCount(archetypeId: ArchetypeId, equipment: Equipment): number {
  return GEAR_ROLES.filter((role) => {
    const item = equipment[role];
    return item !== undefined && gearRequiresAttunement(archetypeId, role, item.tier);
  }).length;
}

// ── normalising a stored bag ──────────────────────────────────────────────

/**
 * The load boundary for `sheet.bag`, the same job `normalizeEquipment` does
 * for `sheet.equipment`: turn whatever came back out of `game_characters.stats`
 * into a `BagItem[]` this engine will answer for.
 *
 * Enforces every BAG invariant on the way in: each entry names an item that
 * exists at a magic tier, no duplicate `(slot, tier)` (first occurrence
 * kept), nothing already worn in `equipment`, and the list truncated at
 * BAG_CAPACITY (unreachable in play -- MAX_DISTINCT_MAGIC_ITEMS <=
 * BAG_CAPACITY -- but a hand-edited blob is not play). An entry this file
 * cannot make sense of is DROPPED rather than defaulted to anything: there is
 * no safe substitute for "an item I do not recognise," unlike a tier, which
 * has a safe default of "common."
 */
export function normalizeBag(value: unknown, archetypeId: string, equipment: Equipment): BagItem[] {
  const known = knownArchetypeId(archetypeId);
  if (!known || !Array.isArray(value)) return [];
  const out: BagItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const slot = rec.slot;
    const tier = rec.tier;
    if (typeof slot !== "string" || !(GEAR_ROLES as readonly string[]).includes(slot)) continue;
    if (typeof tier !== "string" || !(MAGIC_TIERS as readonly string[]).includes(tier)) continue;
    const role = slot as GearRole;
    const magicTier = tier as MagicTier;
    if (!gearItemExists(known, role, magicTier)) continue;
    const key = `${role}:${magicTier}`;
    if (seen.has(key)) continue;
    const worn = equipment[role];
    if (worn && worn.tier === magicTier) continue;
    seen.add(key);
    out.push({ slot: role, tier: magicTier });
    if (out.length >= BAG_CAPACITY) break;
  }
  return out;
}

// Pinned to the contract's cross-lane types: a drifted signature is a compile
// error here, in the implementing file, not a runtime surprise in a caller.
const CONTRACT_PINS = { draftFromSheet, stageEquip, stageUnequip, commitLoadout } satisfies {
  draftFromSheet: DraftFromSheetFn;
  stageEquip: StageEquipFn;
  stageUnequip: StageUnequipFn;
  commitLoadout: CommitLoadoutFn;
};
void CONTRACT_PINS;
