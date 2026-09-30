/**
 * ENGINE-ROLLED LOOT, contract v2 section 11.6. The load-bearing rule applied
 * to gear: the AI dungeon master never chooses an item, never chooses a tier,
 * never grants gear, and supplies no equipment number of any kind. Loot is a
 * die, not a gift, and this file is the die.
 *
 * `lootFor` takes only the structural `LootSheet` shape (`archetypeId`,
 * `equipment`, `bag`, `lootLedger`) pinned in `characters/equipmentTypes.ts`,
 * not a full CharacterSheet, so it stays exactly as sheet-agnostic as
 * `rules/magicItems.ts`: numbers and small structures in, the same shape out.
 * The DM never sees this module at all; `lootDmNote` produces the one fact
 * line another lane queues to the model, and the model has no field it could
 * write back into any of this.
 *
 * Determinism, restated because it is the one property every caller and every
 * test leans on: `rng` is called exactly once for the d100, and exactly one
 * more time, only when two or more roles are still eligible for the tier that
 * came up. Nothing here ever rerolls, steps or skips a face.
 */
import { knownArchetypeId } from "./attunement";
import { rollDie } from "./dice";
import {
  GEAR_ROLES,
  LOOT_DIE_SIDES,
  LOOT_LEDGER_MAX_CELLS,
  LOOT_ROLLS_PER_CELL,
  LOOT_TIER_BANDS,
  TIER_WORD,
  gearItemExists,
  lootCellKey,
  type BagItem,
  type GearRole,
  type LootAt,
  type LootDmNoteFn,
  type LootForFn,
  type LootLedger,
  type LootRoll,
  type LootSheet,
  type MagicTier,
} from "../characters/equipmentTypes";

/**
 * Whether this character already owns the item at (role, tier): worn at that
 * exact tier, or already sitting in the bag at that tier. Reads only the two
 * fields `LootSheet` guarantees, so a caller with nothing more than
 * `{ archetypeId, equipment, bag }` can still ask this.
 */
function alreadyOwns(sheet: LootSheet, role: GearRole, tier: MagicTier): boolean {
  const worn = sheet.equipment?.[role];
  if (worn && worn.tier === tier) return true;
  return (sheet.bag ?? []).some((item) => item.slot === role && item.tier === tier);
}

/**
 * The roles that could plausibly be found at this tier: GEAR_ROLES order,
 * filtered to a role that (a) has an item at this tier at all -- ring and
 * amulet's empty legendary rung, and boots' empty legendary rung, drop out
 * here, which is how loot never lands on an empty rung -- and (b) is not
 * already owned. Exported because the loot test asserts against it directly
 * (never grants an owned item, never an empty rung) without re-deriving the
 * loot roll's own randomness.
 */
export function eligibleRolesFor(sheet: LootSheet, tier: MagicTier): readonly GearRole[] {
  const known = knownArchetypeId(sheet.archetypeId);
  if (!known) return [];
  return GEAR_ROLES.filter((role) => gearItemExists(known, role, tier) && !alreadyOwns(sheet, role, tier));
}

function tierForD100(roll: number): MagicTier | null {
  // LOOT_TIER_BANDS is ordered ascending by `upTo` and covers 1..100 with no
  // gap (equipmentTypes.ts's own invariant), so the first band whose `upTo`
  // is >= the roll is always found for any roll in [1, LOOT_DIE_SIDES].
  const band = LOOT_TIER_BANDS.find((b) => roll <= b.upTo);
  return band ? band.tier : null;
}

/**
 * Evict the oldest ledger keys past LOOT_LEDGER_MAX_CELLS.
 *
 * `Object.keys` on a plain object returns non-integer string keys (every
 * `lootCellKey` is "x,y", never a bare integer) in INSERTION order, which is
 * exactly "oldest first" for a record built by repeated spreads the way this
 * ledger is. Deleting off the front of that list is therefore the oldest-key
 * eviction the contract asks for, with no separate timestamp or counter to
 * keep in sync.
 */
function evictOldest(rollsByCell: Record<string, number>): Record<string, number> {
  const keys = Object.keys(rollsByCell);
  if (keys.length <= LOOT_LEDGER_MAX_CELLS) return rollsByCell;
  const next = { ...rollsByCell };
  const excess = keys.length - LOOT_LEDGER_MAX_CELLS;
  for (let i = 0; i < excess; i++) delete next[keys[i]!];
  return next;
}

/**
 * Roll loot for one trigger. Returns `{ sheet, roll: null }`, sheet
 * UNCHANGED, when this cell has already used its two rolls -- no rng call at
 * all, per the anti-farming cap. Otherwise the returned sheet has the ledger
 * bumped and, on a find, the item appended to the end of `bag` (which the bag
 * invariants guarantee always has room; see equipmentTypes.ts's
 * MAX_DISTINCT_MAGIC_ITEMS <= BAG_CAPACITY). Touches only `lootLedger` and
 * `bag`; `equipment`, `inventory` and everything else on the sheet passes
 * through untouched.
 */
export function lootFor<S extends LootSheet>(sheet: S, at: LootAt, rng: () => number = Math.random): { sheet: S; roll: LootRoll | null } {
  const ledger: LootLedger = sheet.lootLedger ?? { rollsByCell: {} };
  const key = lootCellKey(at.cx, at.cy);
  const rollsSoFar = ledger.rollsByCell[key] ?? 0;
  if (rollsSoFar >= LOOT_ROLLS_PER_CELL) return { sheet, roll: null };

  const tierRoll = rollDie(LOOT_DIE_SIDES, rng);
  const tier = tierForD100(tierRoll);

  let eligible: readonly GearRole[] = [];
  let slotDie = 0;
  let slotRoll: number | null = null;
  let item: BagItem | null = null;

  if (tier) {
    eligible = eligibleRolesFor(sheet, tier);
    if (eligible.length >= 2) {
      slotDie = eligible.length;
      slotRoll = rollDie(slotDie, rng);
      item = { slot: eligible[slotRoll - 1]!, tier };
    } else if (eligible.length === 1) {
      item = { slot: eligible[0]!, tier };
    }
    // eligible.length === 0: no second die, nothing new -- every piece of
    // this tier is already owned.
  }

  const roll: LootRoll = { source: at.source, tierRoll, tier, eligible, slotDie, slotRoll, item };

  const rollsByCell = evictOldest({ ...ledger.rollsByCell, [key]: rollsSoFar + 1 });
  const nextSheet: S = {
    ...sheet,
    lootLedger: { rollsByCell },
    bag: item ? [...(sheet.bag ?? []), item] : sheet.bag,
  };
  return { sheet: nextSheet, roll };
}

/**
 * The DM's one fact line about a loot roll, verbatim per equipmentTypes.ts
 * section 11.6. `itemName` is supplied by the caller (via `gearItemName`,
 * the one namer) rather than looked up here, so this file never has to know
 * an archetype id is even a thing -- it only ever prints what it is handed.
 */
export function lootDmNote(roll: LootRoll, itemName: string | null, sourceLabel: string): string {
  if (roll.item && itemName && roll.tier) {
    return `the engine rolled loot from ${sourceLabel}: ${itemName} (${TIER_WORD[roll.tier].toLowerCase()}) is now in the player's pack. Narrate the find. The item and its quality are already decided; do not name a different one.`;
  }
  return `the engine rolled loot from ${sourceLabel} and nothing magical turned up. Describe ordinary odds and ends if you like, never a magic item.`;
}

// Pinned to the contract's cross-lane types: a drifted signature is a compile
// error here, in the implementing file, not a runtime surprise in a caller.
const CONTRACT_PINS = { lootFor, lootDmNote } satisfies { lootFor: LootForFn; lootDmNote: LootDmNoteFn };
void CONTRACT_PINS;
