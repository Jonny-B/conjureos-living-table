/**
 * SRD 5.1 attunement, contract v2: "a creature can be attuned to no more than
 * three magic items at a time. Any attempt to attune to a fourth item fails;
 * the creature must end its attunement to an item first."
 *
 * The simplest faithful version, per `characters/equipmentTypes.ts` section
 * 11.3 (`ATTUNEMENT_NOTE`): WEARING IS ATTUNING. There is no separate
 * "attuned" flag stored anywhere; the attuned set is DERIVED from an
 * `Equipment` value on every read, exactly the way a bonus is derived from a
 * tier on every read. Taking a piece off ends its attunement.
 *
 * Both functions here are pure and take no CharacterSheet: `attunedRoles`
 * needs only an archetype id and an `Equipment`, and `gearChangeBlockedReason`
 * needs only the three vitals facts and whether a fight is on, exactly the
 * `GearChangeBlockedReasonFn` / `AttunedRolesFn` shapes pinned in
 * `equipmentTypes.ts`. Neither one is CharacterSheet-shaped on purpose: a
 * function that doesn't need a sheet shouldn't import one, the same
 * discipline `rules/magicItems.ts` keeps for a bonus number.
 */
import {
  ARCHETYPE_IDS,
  GEAR_CHANGE_BLOCKED,
  GEAR_ROLES,
  MAX_ATTUNED_ITEMS,
  gearRequiresAttunement,
  type ArchetypeId,
  type AttunedRolesFn,
  type Equipment,
  type GearChangeBlockedReasonFn,
  type GearRole,
} from "../characters/equipmentTypes";

/**
 * The archetype id when the equipment tables know it, else null.
 *
 * Every cross-lane function in this feature takes `archetypeId: string`
 * (GearSheet carries it as stored client data), while the contract's pure
 * lookups (`gearRequiresAttunement`, `gearItemName`) index SLOTS_BY_ARCHETYPE
 * directly and would THROW on an id they have never heard of. So every rules
 * entry point narrows here first, and an unknown id reads as "no gear at
 * all" rather than as a crash mid-campaign.
 */
export function knownArchetypeId(id: string): ArchetypeId | null {
  return (ARCHETYPE_IDS as readonly string[]).includes(id) ? (id as ArchetypeId) : null;
}

/**
 * The worn roles whose item requires attunement, in GEAR_ROLES order, capped
 * at MAX_ATTUNED_ITEMS.
 *
 * "In GEAR_ROLES order, first MAX_ATTUNED_ITEMS only" is not just a
 * tie-break: it is what makes a bad blob safe. A stored sheet is trusted
 * client input (the same trust model `characters/equipment.ts` already
 * documents), so nothing stops an old build, a hand-edited save or a future
 * bug from writing an `Equipment` that wears four or five attunement items at
 * once. Rather than either attuning all of them (breaking the SRD cap) or
 * throwing (crashing a campaign someone is mid-way through), the first three
 * in canonical order count as attuned and the rest fall out silently -- their
 * bonus simply does not apply, which `characters/equipment.ts`'s
 * attunement-aware status readers surface with a reason, never a crash.
 *
 * A role with no item, or an item that does not require attunement (common
 * gear, a +1/+2 weapon or any armour piece, at any tier), is never in the
 * result: attunement is never spent on something that would grant no benefit
 * from it.
 */
export function attunedRoles(archetypeId: string, equipment: Equipment): readonly GearRole[] {
  const known = knownArchetypeId(archetypeId);
  if (!known) return [];
  const needsIt = GEAR_ROLES.filter((role) => {
    const item = equipment[role];
    if (!item) return false;
    return gearRequiresAttunement(known, role, item.tier);
  });
  return needsIt.slice(0, MAX_ATTUNED_ITEMS);
}

/** Whether this one role's worn item is currently attuned (worn, requires attunement, and inside the cap). False for a role with nothing worn, or worn with an item that needs no attunement at all -- both read as "not gated," never as "gated and failing." */
export function isRoleAttuned(archetypeId: string, equipment: Equipment, role: GearRole): boolean {
  return attunedRoles(archetypeId, equipment).includes(role);
}

/** The `who` shape `gearChangeBlockedReason` needs: exactly the three vitals facts that matter, off a CharacterSheet or a test fixture alike. */
export interface GearChangeSubject {
  name: string;
  downed: boolean;
  stable: boolean;
  dead: boolean;
}

/**
 * Why gear may not change right now, or null when it may.
 *
 * SRD 5.1 ties attuning to "a creature spends a short rest focused on only
 * that item." This game does not spend the hit die or the in-fiction time a
 * short rest costs (equipping is free, per the load-bearing rule), but it
 * keeps the one condition that makes a short rest plausible at all: nobody
 * fighting you right now, and you are on your feet to take it. Checked in
 * this order, because a dead check trumps every other reason and a downed
 * one trumps a mid-fight one: dead, then down (downed or stable -- stable is
 * still unconscious at 0 HP), then hostiles present.
 */
export function gearChangeBlockedReason(who: GearChangeSubject, hostilesPresent: boolean): string | null {
  if (who.dead) return GEAR_CHANGE_BLOCKED.dead(who.name);
  if (who.downed || who.stable) return GEAR_CHANGE_BLOCKED.down;
  if (hostilesPresent) return GEAR_CHANGE_BLOCKED.hostiles;
  return null;
}

// Pinned to the contract's cross-lane types: a drifted signature is a compile
// error here, in the implementing file, not a runtime surprise in a caller.
const CONTRACT_PINS = { attunedRoles, gearChangeBlockedReason } satisfies {
  attunedRoles: AttunedRolesFn;
  gearChangeBlockedReason: GearChangeBlockedReasonFn;
};
void CONTRACT_PINS;
