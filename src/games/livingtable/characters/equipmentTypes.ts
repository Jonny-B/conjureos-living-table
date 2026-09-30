/**
 * THE EQUIPMENT CONTRACT. Types and constant tables only.
 *
 * Five lanes build this feature in parallel and never see each other's code:
 * equipment rules, the renderer, the fantasy art, the sci-fi art, and the play
 * screen. This file is the only thing that makes their output compose. Nothing
 * here renders, rolls, mutates or decides; every function below is a pure
 * string or table lookup, deliberately, so that two people applying the same
 * rule independently produce byte-identical output.
 *
 * THE LOAD-BEARING RULE, restated because equipment is the first system that
 * could plausibly break it: the AI dungeon master never writes or runs code at
 * play time and never overrides a die roll. The ENGINE owns every number: to
 * hit, damage, AC, saves, legality. Equipment bonuses are numbers, therefore
 * equipment bonuses are engine-owned and engine-applied. The model may never
 * supply, modify, suggest or name one. See the "MECHANICS" section for the
 * exact functions each bonus flows through and `EQUIPMENT_FORBIDDEN_WIRE_KEYS`
 * for the keys dm/turnSchema.ts must reject on sight.
 *
 * WHAT EACH LANE OWNS, so nobody edits a file two people are in:
 *
 *   rules lane    session/combat.ts, characters/creation.ts,
 *                 characters/equipment.ts (new), dm/turnSchema.ts validators
 *   render lane   render/canvasRenderer.ts, render/equipmentCompositor.ts (new)
 *   fantasy art   scripts/assets/fantasy.ts, test/livingtable-assets-fantasy.test.ts
 *   sci-fi art    scripts/assets/scifi.ts, test/livingtable-assets-scifi.test.ts
 *   screen lane   LivingTable.tsx, menu/labels.ts
 *
 *   shared, one line each, exact text given in this file so a merge is
 *   trivial: scripts/assets/png.mjs (see PNG_CONTACT_SHEET_PATCH) and
 *   src/bridge/gamesApi.ts (no change needed, see TOKEN GEOMETRY).
 *
 * WHY THIS FILE LIVES UNDER src/: it holds no pixels. The asset library
 * (scripts/assets/*.ts) still never ships in the app bundle and nothing under
 * src/ imports it. What crosses the boundary here is ids, integers and index
 * remaps, which is data the running client already receives over the wire.
 *
 * NOTHING IN THIS FEATURE IS A PAID ACTION. Finding, equipping and swapping
 * gear costs no credit and calls no model, so no CostBadge appears anywhere in
 * it. Combat, movement, search, items, resting and levelling stay free forever.
 *
 * Rules basis: SRD 5.1, CC BY 4.0. The tier ladder below is the SRD's own
 * "Weapon, +1/+2/+3" and "Armor, +1/+2/+3" magic item shape, nothing invented.
 *
 * CONTRACT V2 (section 11) adds ring, amulet and boots, the bag, attunement,
 * engine-rolled loot and the inventory screen, for SIX lanes whose ownership
 * table is in section 11. Everything in sections 1 to 10 keeps its name and
 * its value; where v2 had to reach back into them it only WIDENS a type
 * (EquipmentLayer, EquippedItem, Equipment, EquipmentLayerPlan) or GROWS a
 * frozen list (EQUIPMENT_FORBIDDEN_WIRE_KEYS), and each such spot says so.
 */
import type { TemplateGenre } from "./templates";

// ===========================================================================
// 1. ARCHETYPES AND KEYS
// ===========================================================================

/**
 * The eight launch archetypes, exactly as `templates.ts` spells their ids.
 * Note the hyphen in "fireball-person": it is real, it is load-bearing, and it
 * is the reason `ArchetypeKey` exists separately below.
 */
export type ArchetypeId =
  | "knight"
  | "shadow"
  | "healer"
  | "fireball-person"
  | "trooper"
  | "infiltrator"
  | "medic"
  | "psion";

export const ARCHETYPE_IDS: readonly ArchetypeId[] = Object.freeze([
  "knight",
  "shadow",
  "healer",
  "fireball-person",
  "trooper",
  "infiltrator",
  "medic",
  "psion",
] as const);

/**
 * The same eight, hyphen replaced by underscore, which is the form that
 * appears inside a sprite id. This mirrors the rule LivingTable.tsx's
 * `defaultAppearanceAssetId` has always applied ("token_" + id with "-"
 * replaced by "_"), stated once here so the art lanes do not have to go
 * looking for it.
 */
export type ArchetypeKey =
  | "knight"
  | "shadow"
  | "healer"
  | "fireball_person"
  | "trooper"
  | "infiltrator"
  | "medic"
  | "psion";

export const ARCHETYPE_KEY: Readonly<Record<ArchetypeId, ArchetypeKey>> = Object.freeze({
  knight: "knight",
  shadow: "shadow",
  healer: "healer",
  "fireball-person": "fireball_person",
  trooper: "trooper",
  infiltrator: "infiltrator",
  medic: "medic",
  psion: "psion",
} as const);

export const TEMPLATE_OF_ARCHETYPE: Readonly<Record<ArchetypeId, TemplateGenre>> = Object.freeze({
  knight: "fantasy",
  shadow: "fantasy",
  healer: "fantasy",
  "fireball-person": "fantasy",
  trooper: "scifi",
  infiltrator: "scifi",
  medic: "scifi",
  psion: "scifi",
} as const);

// ===========================================================================
// 2. SLOTS
// ===========================================================================

/**
 * THE THREE SLOT ROLES, in the project owner's own words: a weapon, an
 * "offhand-or-outer", and a "headwear-or-body". Role is the abstraction the
 * renderer and the rules engine reason over; the flavour name (Kite Shield,
 * Barrier Field) is a label carried per archetype in `SLOTS_BY_ARCHETYPE`.
 *
 *   weapon  what you attack with. Sword, staff, bow, rifle, baton, lash.
 *   outer   what turns a hit aside. A shield in the off hand, or a cloak,
 *           cape or barrier worn over the back.
 *   crown   the headwear-or-body piece. A hood, hat, mitre or visor, or the
 *           worn armour when the archetype's set has no headgear (the Knight's
 *           plate, the Trooper's carapace).
 *
 * Role does NOT determine draw order on its own: `outer` covers both a shield
 * (in front of the body) and a cloak (behind it), and `crown` covers both a
 * hood (on top of everything) and a plate harness (over the torso). Draw order
 * comes from the per-slot `layer` integer. See section 4.
 */
export type SlotRole = "weapon" | "outer" | "crown";

export const SLOT_ROLES: readonly SlotRole[] = Object.freeze(["weapon", "outer", "crown"] as const);

/**
 * THE SIX GEAR ROLES (contract v2). `SlotRole` above stays exactly the three
 * PER-ARCHETYPE roles, because SLOTS_BY_ARCHETYPE, the 72 sprite ids and a
 * thousand lines of v1 code and tests are keyed on it meaning three. The three
 * v2 roles are a separate union and `GearRole` is the six.
 *
 *   ring    SRD "rings on the finger". Sheet-only: at 16x24 a ring is one
 *           pixel, so it never draws on the body. Shared per template.
 *   amulet  a charm worn at the neck (or, for the Stone of Good Luck, carried
 *           on your person, which the SRD allows). Sheet-only, shared per
 *           template.
 *   boots   SRD "boots go on the feet". DRAWN on the body at LAYER_FEET, per
 *           ARCHETYPE (the eight bodies put their feet in different columns,
 *           see section 11), while the ITEM (name, effect) is shared per
 *           template.
 *
 * `GEAR_ROLES` is the one canonical order for six-role lists: the gear rows on
 * the sheet, the loot slot die, the attunement tie-break and the AC-cap
 * spending order all walk it. It extends SLOT_ROLES, so v1 order is preserved.
 */
export type AccessoryRole = "ring" | "amulet" | "boots";

export const ACCESSORY_ROLES: readonly AccessoryRole[] = Object.freeze(["ring", "amulet", "boots"] as const);

export type GearRole = SlotRole | AccessoryRole;

export const GEAR_ROLES: readonly GearRole[] = Object.freeze(["weapon", "outer", "crown", "ring", "amulet", "boots"] as const);

/** The roles whose gear is painted on the token. */
export type DrawnGearRole = SlotRole | "boots";

export const DRAWN_GEAR_ROLES: readonly DrawnGearRole[] = Object.freeze(["weapon", "outer", "crown", "boots"] as const);

/** The roles that exist only on the character sheet and the inventory screen. The only two roles that can be EMPTY. */
export type SheetOnlyRole = "ring" | "amulet";

export const SHEET_ONLY_ROLES: readonly SheetOnlyRole[] = Object.freeze(["ring", "amulet"] as const);

/**
 * What kind of number a slot contributes. Three kinds, each mapping onto one
 * SRD 5.1 magic item shape, and each landing in exactly one engine function
 * (section 8 names them):
 *
 *   weapon  SRD "Weapon, +1/+2/+3": the bonus applies to BOTH the attack roll
 *           and the damage roll made with that weapon.
 *   armor   SRD "Armor, +1/+2/+3" and "Shield, +1/+2/+3": a bonus to AC.
 *   save    SRD "Cloak of Protection" shape, narrowed: a bonus to saving
 *           throws only. Narrowed on purpose so a third slot cannot become a
 *           third source of AC.
 */
export type BonusKind = "weapon" | "armor" | "save";

/** SRD 5.1 damage types, for a legendary weapon's rider. No non-SRD types. */
export type DamageType =
  | "acid"
  | "cold"
  | "fire"
  | "force"
  | "lightning"
  | "necrotic"
  | "poison"
  | "psychic"
  | "radiant"
  | "thunder";

/**
 * A legendary weapon's extra effect, SRD "Flame Tongue" shape: extra damage
 * dice of a named type on a hit.
 *
 * `bonusDamage` is DICE NOTATION, never a total. The engine rolls it through
 * rules/dice.ts like every other die in the game. It is set only from
 * `SLOTS_BY_ARCHETYPE` below, which is engine-owned data; there is no path by
 * which a DM turn, a loot description or a player-entered string can reach it.
 */
export interface LegendaryRider {
  bonusDamage: string;
  damageType: DamageType;
}

/** Bounds on a rider, in the same spirit as session/combat.ts's MIN_DC/MAX_DC. */
export const MAX_RIDER_DICE = 2;
export const MAX_RIDER_SIDES = 8;

/**
 * One slot of one archetype: everything five lanes need to know about it.
 *
 * `nameByTier` is ordered [common, uncommon, rare, legendary] and is the
 * player-facing name on the character sheet AND the source label in the dice
 * readout (section 8). It is the only field here that is pure flavour.
 */
export interface SlotDefinition {
  role: SlotRole;
  /** Draw order. One of the LAYER_* constants in section 4. Never a raw number at a call site. */
  layer: EquipmentLayer;
  bonusKind: BonusKind;
  nameByTier: readonly [string, string, string, string];
  /** Set only on a `weapon`-role slot. What its legendary version adds on a hit. */
  legendaryRider?: LegendaryRider;
}

/**
 * THE EIGHT SETS. Three slots each, themed per archetype, mirrored per chassis
 * so two reskins of one class are equally strong.
 *
 * The Knight's set is the owner's own example, given verbatim (sword, shield,
 * armour), and the Fireball Person's is their wizard example (staff, hat,
 * cloak). The other six follow that spirit off each archetype's real
 * `startingInventory` in templates.ts.
 *
 * The bonus-kind triple per chassis:
 *   fighter (knight, trooper)            weapon, armor, armor
 *   rogue   (shadow, infiltrator)        weapon, armor, save
 *   cleric  (healer, medic)              weapon, armor, save
 *   wizard  (fireball-person, psion)     weapon, armor, save
 *
 * The Fighter chassis is the only one carrying two AC sources, which is both
 * what the owner's Knight example demands (shield AND armour) and what a tank
 * should be. It is also the one balance risk in this contract; see the open
 * risks in the handover, and `MAX_TOTAL_AC_BONUS` below for the bound.
 */
export const SLOTS_BY_ARCHETYPE: Readonly<Record<ArchetypeId, Readonly<Record<SlotRole, SlotDefinition>>>> =
  Object.freeze({
    // --- fantasy -----------------------------------------------------------
    knight: {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Longsword", "Keen Longsword", "Sword of the Vigil", "Dawnbreaker"],
        legendaryRider: { bonusDamage: "1d6", damageType: "radiant" },
      },
      outer: {
        role: "outer",
        layer: 35,
        bonusKind: "armor",
        nameByTier: ["Kite Shield", "Warded Kite Shield", "Bulwark of the Vigil", "Aegis Unbroken"],
      },
      crown: {
        role: "crown",
        layer: 30,
        bonusKind: "armor",
        nameByTier: ["Plate Harness", "Tempered Plate", "Vigil Plate", "Harness of the Last Wall"],
      },
    },
    shadow: {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Shortblade", "Honed Shortblade", "Whisper", "Nightsliver"],
        legendaryRider: { bonusDamage: "1d6", damageType: "poison" },
      },
      outer: {
        role: "outer",
        layer: 10,
        bonusKind: "armor",
        nameByTier: ["Dark Cloak", "Muffled Cloak", "Cloak of Still Air", "Shroud of No Name"],
      },
      crown: {
        role: "crown",
        layer: 50,
        bonusKind: "save",
        nameByTier: ["Hood", "Deep Hood", "Hood of the Unseen", "Facelessness"],
      },
    },
    healer: {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Mace", "Blessed Mace", "Mace of the Kind Hand", "Mercy"],
        legendaryRider: { bonusDamage: "1d6", damageType: "radiant" },
      },
      outer: {
        role: "outer",
        layer: 30,
        bonusKind: "armor",
        nameByTier: ["Vestments", "Consecrated Vestments", "Vestments of the Kind Hand", "Raiment of the Long Vigil"],
      },
      crown: {
        role: "crown",
        layer: 50,
        bonusKind: "save",
        nameByTier: ["Mitre", "Gilded Mitre", "Mitre of Clear Sight", "Crown of the Unfailing"],
      },
    },
    "fireball-person": {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Quarterstaff", "Runed Quarterstaff", "Staff of Embers", "Sunstroke"],
        legendaryRider: { bonusDamage: "1d6", damageType: "fire" },
      },
      outer: {
        role: "outer",
        layer: 10,
        bonusKind: "armor",
        nameByTier: ["Travelling Cloak", "Warded Cloak", "Cloak of Cinders", "Mantle of the Third Sun"],
      },
      crown: {
        role: "crown",
        layer: 50,
        bonusKind: "save",
        nameByTier: ["Pointed Hat", "Starred Hat", "Hat of the Ember Circle", "The Long Hat"],
      },
    },

    // --- sci-fi ------------------------------------------------------------
    trooper: {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Plasma Rifle", "Tuned Plasma Rifle", "Breachmaker", "Sunline"],
        legendaryRider: { bonusDamage: "1d6", damageType: "fire" },
      },
      outer: {
        role: "outer",
        layer: 35,
        bonusKind: "armor",
        nameByTier: ["Riot Shield", "Reactive Riot Shield", "Bulwark Emitter", "Wall Protocol"],
      },
      crown: {
        role: "crown",
        layer: 30,
        bonusKind: "armor",
        nameByTier: ["Carapace Vest", "Layered Carapace", "Vanguard Carapace", "Last Stand Carapace"],
      },
    },
    infiltrator: {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Sidearm", "Matched Sidearm", "Ghost Sidearm", "Nullpoint"],
        legendaryRider: { bonusDamage: "1d6", damageType: "poison" },
      },
      outer: {
        role: "outer",
        layer: 10,
        bonusKind: "armor",
        nameByTier: ["Stealth Cape", "Damped Stealth Cape", "Cape of Dead Air", "Nobody's Cape"],
      },
      crown: {
        role: "crown",
        layer: 50,
        bonusKind: "save",
        nameByTier: ["Optic Visor", "Layered Optic Visor", "Visor of the Blind Spot", "Total Occlusion"],
      },
    },
    medic: {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Stun Baton", "Charged Stun Baton", "Baton of Steady Hands", "Kindly Voltage"],
        legendaryRider: { bonusDamage: "1d6", damageType: "lightning" },
      },
      outer: {
        role: "outer",
        layer: 30,
        bonusKind: "armor",
        nameByTier: ["Field Vest", "Sealed Field Vest", "Trauma Vest", "Vest of the Long Shift"],
      },
      crown: {
        role: "crown",
        layer: 50,
        bonusKind: "save",
        nameByTier: ["Scanner Band", "Calibrated Scanner Band", "Band of Clear Reading", "Perfect Triage"],
      },
    },
    psion: {
      weapon: {
        role: "weapon",
        layer: 40,
        bonusKind: "weapon",
        nameByTier: ["Neural Focus", "Tuned Neural Focus", "Focus of the Quiet Room", "Silence Itself"],
        legendaryRider: { bonusDamage: "1d6", damageType: "psychic" },
      },
      outer: {
        role: "outer",
        layer: 10,
        bonusKind: "armor",
        nameByTier: ["Barrier Field", "Layered Barrier Field", "Field of Turned Intent", "Nothing Reaches"],
      },
      crown: {
        role: "crown",
        layer: 50,
        bonusKind: "save",
        nameByTier: ["Psi Crown", "Etched Psi Crown", "Crown of the Deep Channel", "The Open Door"],
      },
    },
  } as const);

// ===========================================================================
// 3. SPRITE IDS
// ===========================================================================

/**
 * THE BODY SPRITE ID IS UNCHANGED. `token_knight`, `token_shadow`,
 * `token_healer`, `token_fireball_person`, `token_trooper`,
 * `token_infiltrator`, `token_medic`, `token_psion`.
 *
 * This is not a style preference, it is a data constraint: every assembled
 * cell already persisted in `game_cells` names the player's token by this id,
 * and `CharacterSheet.appearanceAssetId` holds it on every existing sheet.
 * Renaming a body sprite orphans every saved campaign. The body grows from
 * 16x16 to 16x24 (section 5); its id does not move.
 */
export type BodySpriteId = `token_${ArchetypeKey}`;

export function bodySpriteId(archetypeId: ArchetypeId): BodySpriteId {
  return `token_${ARCHETYPE_KEY[archetypeId]}`;
}

/**
 * Which drawn artwork a tier uses. Common and uncommon SHARE one drawing and
 * differ only by a palette remap (section 6), which is the owner's "common and
 * uncommon are simple colour swaps, so they cost no new sprites". Rare and
 * legendary each get their own drawing, which is the owner's "rare and
 * legendary get special models".
 */
export type ArtVariant = "base" | "rare" | "legendary";

export const ART_VARIANTS: readonly ArtVariant[] = Object.freeze(["base", "rare", "legendary"] as const);

/**
 * THE EQUIPMENT SPRITE ID GRAMMAR, stated once, mechanically:
 *
 *     gear_<archetypeKey>_<role>_<artVariant>
 *
 * Four segments, joined by single underscores, all lower case, no other
 * punctuation. `archetypeKey` is the archetype id with any hyphen replaced by
 * an underscore (`ARCHETYPE_KEY` above). `role` is exactly one of "weapon",
 * "outer", "crown". `artVariant` is exactly one of "base", "rare",
 * "legendary".
 *
 * Worked examples, so there is nothing to interpret:
 *     gear_knight_weapon_base
 *     gear_knight_outer_legendary
 *     gear_fireball_person_crown_rare
 *     gear_psion_outer_base
 *
 * There is no id for a common or an uncommon piece: both use the `base` id and
 * differ by remap. That is the whole point of the recolour design.
 *
 * The template literal type below makes a typo a COMPILE ERROR rather than a
 * silently missing sprite, and `EQUIPMENT_SPRITE_IDS` enumerates all 72 so an
 * art lane has a checklist and a test has something to assert against.
 */
export type EquipmentSpriteId = `gear_${ArchetypeKey}_${SlotRole}_${ArtVariant}`;

export function equipmentSpriteId(archetypeId: ArchetypeId, role: SlotRole, variant: ArtVariant): EquipmentSpriteId {
  return `gear_${ARCHETYPE_KEY[archetypeId]}_${role}_${variant}`;
}

/** All 72 equipment sprite ids: 8 archetypes x 3 roles x 3 drawn variants. The art lanes author exactly these, 36 fantasy and 36 sci-fi, and nothing else. */
export const EQUIPMENT_SPRITE_IDS: readonly EquipmentSpriteId[] = Object.freeze(
  ARCHETYPE_IDS.flatMap((id) => SLOT_ROLES.flatMap((role) => ART_VARIANTS.map((v) => equipmentSpriteId(id, role, v)))),
);

/** The 36 for one template, for an art lane's own test to enumerate without filtering by hand. */
export function equipmentSpriteIdsFor(template: TemplateGenre): readonly EquipmentSpriteId[] {
  return ARCHETYPE_IDS.filter((id) => TEMPLATE_OF_ARCHETYPE[id] === template).flatMap((id) =>
    SLOT_ROLES.flatMap((role) => ART_VARIANTS.map((v) => equipmentSpriteId(id, role, v))),
  );
}

/**
 * Every gear sprite ships in the manifest with `kind: "token"` and
 * `walkable: false`, exactly like a body token does. It is NOT a prop: a prop
 * is a thing on the floor with an identity in `CellLayout.props`, and gear has
 * neither. assets/manifestCache.ts already routes `kind: "token"` into
 * `RenderManifest.tokens`, which is where the compositor looks these up, so
 * this needs no manifest-cache change at all.
 *
 * It does mean gear ids appear in `AvailableAssetIds.tokens`, which is the list
 * the DM is allowed to reference in a `placeToken`. That is a real hole and it
 * is the DM lane's job to close it: `dm/promptBuilder.ts` must filter ids
 * matching /^gear_/ out of `availableAssetIds.tokens`, and
 * `dm/turnSchema.ts`'s `validatePlacedToken` must REJECT (not ignore) an
 * assetId matching /^gear_/, the same way it rejects a model-supplied
 * `currentHp`. A floating disembodied helmet standing on a floor tile is the
 * failure this prevents.
 */
export const GEAR_ASSET_ID_PREFIX = "gear_";

// ===========================================================================
// 4. Z ORDER
// ===========================================================================

/**
 * DRAW ORDER, as explicit integers. The renderer sorts ascending and paints in
 * that order; later wins, -1 shows through, which is the rule canvasRenderer.ts
 * has always followed.
 *
 * Spaced by 10 so a future band can be inserted without renumbering anything.
 * A slot's band is DATA on the slot (`SlotDefinition.layer`), never derived
 * from its role and never derived from its position in a list, which is what
 * lets the Knight's shield sit in front of him while the Shadow's cloak sits
 * behind her even though both are the `outer` role.
 */
export type EquipmentLayer = 0 | 10 | 20 | 25 | 30 | 35 | 40 | 50;

/** The enchantment ring, dilated out from the glowing piece's silhouette. Under everything, always. */
export const LAYER_GLOW: EquipmentLayer = 0;
/** Worn behind the body: cloak, cape, barrier field. */
export const LAYER_BEHIND: EquipmentLayer = 10;
/** The archetype's own body sprite. Fixed. Nothing else may claim 20. */
export const LAYER_BODY: EquipmentLayer = 20;
/**
 * Boots (contract v2; 25 is the one value this version adds to EquipmentLayer).
 *
 * ABOVE the body, because a boots overlay has to paint over the body's own
 * drawn feet or the plain pair and the Boots of Speed would look identical.
 * BELOW LAYER_OVERBODY, because a robe hem, vestments or a plate skirt drawn
 * at 30 falls over the boot tops, not under them. Below the shield (35) and
 * the weapon (40) for the same reason: a staff butt or a kite shield's point
 * that reaches the floor is in front of the feet. Nothing else claims 25, so
 * no tie is possible, and 25 >= LAYER_BODY means an enchanted boot can catch
 * the compositor's rim light like every other piece worn in front.
 */
export const LAYER_FEET: EquipmentLayer = 25;
/** Worn over the torso: plate harness, vestments, carapace, field vest. */
export const LAYER_OVERBODY: EquipmentLayer = 30;
/** Held in the off hand, in front of the torso but behind the weapon arm: shield, emitter. */
export const LAYER_OFFHAND: EquipmentLayer = 35;
/** Held in the main hand: sword, staff, rifle, baton. */
export const LAYER_WEAPON: EquipmentLayer = 40;
/** On the head, on top of everything: hood, hat, mitre, visor, crown. */
export const LAYER_HEAD: EquipmentLayer = 50;

/**
 * Ties are impossible in the shipped table (no archetype gives two slots the
 * same layer), but the renderer must still sort STABLY: sort by `layer`
 * ascending, and where two layers are equal keep the order weapon, outer,
 * crown. Never `Array.prototype.sort` on a comparator that returns 0 without
 * a documented stable sort; Node and every current browser are stable, so a
 * plain `.sort((a, b) => a.layer - b.layer)` on an array already built in
 * SLOT_ROLES order is correct and is what the compositor should do.
 */
export const LAYER_TIE_BREAK_ORDER: readonly SlotRole[] = SLOT_ROLES;

// ===========================================================================
// 5. TOKEN GEOMETRY
// ===========================================================================

/**
 * The measured problem this fixes, in the veteran artist's words: "Every token
 * is exactly 16x16 and snapped to the grid. FF field sprites are roughly 16x24
 * and stand at sub-tile offsets. A judge who knows the era sorts on this before
 * looking at any craft."
 */

/** The tile grid's native pixel pitch. Unchanged, and equal to canvasRenderer.ts's existing SPRITE_SIZE. Every tile and prop stays exactly this square. */
export const TILE_SIZE = 16;

/** Every player-archetype body and every gear overlay is exactly this wide. Width never changes; a token still occupies exactly one tile of floor. */
export const TOKEN_WIDTH = 16;

/** Every player-archetype body and every gear overlay is exactly this tall. 16:24 is 2:3, the FF field-sprite proportion. */
export const TOKEN_HEIGHT = 24;

/** How far a full-height token overhangs upward past its own tile: 8 pixels, half a tile. */
export const TOKEN_OVERHANG = TOKEN_HEIGHT - TILE_SIZE;

/**
 * Bounds for any OTHER token (monsters, NPCs). Height is per sprite, so a
 * goblin may legitimately stay 16 tall and read as small next to a 24-tall
 * Knight, which is correct rather than a defect. Nothing may exceed
 * TOKEN_MAX_HEIGHT, because the renderer's clip and the glow raster below are
 * sized against it.
 */
export const TOKEN_MIN_HEIGHT = 16;
export const TOKEN_MAX_HEIGHT = 24;

/**
 * HOW WIDTH AND HEIGHT ARE NOW EXPRESSED, and why nothing breaks.
 *
 * THE PIXEL GRID IS THE ONLY AUTHORITY ON DIMENSIONS:
 *
 *     height = pixels.length
 *     width  = pixels[0]?.length ?? 0
 *
 * There is no new dimension field anywhere: not on `Sprite` in the two asset
 * files, not on `LtAssetWire`, not on `SpriteAsset` in the renderer, not on the
 * wire, not in games-db. A field that can disagree with the art is a field that
 * eventually will; deriving from the array makes disagreement impossible.
 *
 * `Sprite.size` KEEPS ITS TYPE AND ITS VALUE (the literal 16) on every existing
 * entry, so not one of the hundreds of shipped 16x16 tiles is touched. What
 * changes is only its DOCUMENTED MEANING: `size` is the sprite's WIDTH in
 * pixels and its tile footprint, not an assertion that it is square. A 16x24
 * token still carries `size: 16` and needs no new field. The art lanes each add
 * one assertion to their own test file:
 *
 *     every sprite: pixels.every(row => row.length === sprite.size)
 *                   pixels.length === sprite.size || pixels.length === TOKEN_HEIGHT
 *
 * `build-seed-code.mjs` already emits `pixels` verbatim, so the taller grid
 * reaches games-db with no change to that script and no change to the wire
 * type. `manifestCache.ts` copies `asset.pixels` straight into `SpriteAsset`,
 * so it needs no change either.
 *
 * ONE SHARED ONE-LINE PATCH, in `scripts/assets/png.mjs`'s
 * `renderContactSheet`, which today loops `y < sprite.size` and so would clip a
 * 24-tall sprite to its top 16 rows in the very preview an art lane reviews.
 * Both art lanes may need it; the exact replacement text is given so that if
 * both make it, the merge is identical text and resolves itself.
 */
export const PNG_CONTACT_SHEET_PATCH = `
In scripts/assets/png.mjs, renderContactSheet:

  replace   const cellW = Math.max(...sprites.map((s) => s.size)) * scale + gap * 2;
            const cellH = Math.max(...sprites.map((s) => s.size)) * scale + gap * 2 + labelRows;
  with      const cellW = Math.max(...sprites.map((s) => s.pixels[0].length)) * scale + gap * 2;
            const cellH = Math.max(...sprites.map((s) => s.pixels.length)) * scale + gap * 2 + labelRows;

  replace   for (let y = 0; y < sprite.size; y++) {
              for (let x = 0; x < sprite.size; x++) {
  with      for (let y = 0; y < sprite.pixels.length; y++) {
              for (let x = 0; x < sprite.pixels[y].length; x++) {

  and in the grid-overlay loops below it, replace every sprite.size with
  sprite.pixels[0].length for the x axis and sprite.pixels.length for the y axis.
`.trim();

/**
 * HOW A TALLER TOKEN ANCHORS. Feet on the tile, excess overhangs UPWARD.
 *
 * The sprite's BOTTOM row is flush with the BOTTOM of its tile. The extra rows
 * hang up into the tile above. In sprite-pixel space:
 *
 *     originX = tile.x * TILE_SIZE
 *     originY = (tile.y + 1) * TILE_SIZE - height
 *
 * In canvas space, where `scale` is canvas pixels per tile and
 * `px = scale / TILE_SIZE` is canvas pixels per source pixel:
 *
 *     originX = tile.x * scale
 *     originY = (tile.y + 1) * scale - height * px
 *
 * For height === 16 both reduce exactly to today's `tileOrigin`, so every
 * existing 16x16 token, prop and tile draws byte-identically. That equality is
 * worth a test of its own.
 *
 * CLIPPING AT THE CANVAS TOP: a 24-tall token standing on row 0 wants 8 source
 * rows above y = 0. The renderer must SKIP any source row whose canvas y would
 * be negative rather than relying on the canvas to swallow it, so the behaviour
 * is testable in node without a real 2D context. Concretely: skip source row
 * `sy` when `originY + sy * px < 0`. There is no horizontal clip case, because
 * width never leaves the tile.
 *
 * PAINTER'S ORDER BECOMES LOAD-BEARING. Tokens can now overlap, so
 * `renderCell` must draw them sorted by `y` ASCENDING (a token lower on screen
 * paints over one above it), tie-broken by the token's index in
 * `layout.tokens` so the order is stable across frames. Today's code draws them
 * in array order, which was harmless when nothing overlapped and is a visible
 * flicker now.
 *
 * KNOWN AND ACCEPTED: props are drawn before tokens and stay 16x16, so a tall
 * token overhangs a prop in the tile above it. That is correct for a torch on a
 * wall and slightly wrong for a tree the character should stand behind. Fixing
 * it properly means y-sorting props and tokens together, which is a bigger
 * change than this feature needs; it is listed in the open risks.
 */
export const TOKEN_ANCHOR_NOTE =
  "bottom row of the sprite is flush with the bottom of its tile; excess rows overhang upward; skip source rows whose canvas y is negative";

// ===========================================================================
// 6. RECOLOUR
// ===========================================================================

/**
 * Common and uncommon are the SAME PIXELS with a palette remap, which is why
 * they cost no new sprites.
 *
 * A remap is a plain index-to-index table. The renderer applies it per pixel at
 * draw time:
 *
 *     if (index < 0) continue;                 // transparency is never remapped
 *     const drawn = remap ? (remap[index] ?? index) : index;
 *
 * An index with no entry passes through unchanged, which is what lets a piece
 * of gear carry leather straps, a gem or a wood haft that the recolour does not
 * touch.
 *
 * THIS TABLE LIVES HERE, in src/, not in the asset files. It has to: the
 * renderer applies it at draw time inside the app, and the asset library never
 * ships in the bundle. It holds no colours, only indices, so it leaks nothing
 * about the art.
 */
export type PaletteRemap = Readonly<Record<number, number>>;

/**
 * THE SILHOUETTE MAY NOT DISSOLVE. Index 0 is the outline in BOTH palettes
 * (fantasy "0 OUTLINE", sci-fi "0 outline"), and it is also what
 * `outlined()`'s derived boundary and contact shadow are drawn in. Indices 48
 * to 51 are the reserved glow band (section 7). A remap entry whose KEY or
 * whose VALUE is any of these is invalid.
 *
 * Enforced twice, on purpose, because a dissolved silhouette is the single
 * most damaging thing a bad remap can do:
 *   1. a test over every table in RECOLOUR_BY_TIER asserts no protected index
 *      appears as a key or a value;
 *   2. the compositor skips a remap entry that names one at draw time, so even
 *      a hand-edited table cannot erase an outline in a running game.
 */
export const PROTECTED_PALETTE_INDICES: readonly number[] = Object.freeze([0, 48, 49, 50, 51]);

/**
 * THE GEAR RAMP. Four indices per template that ALL base-tier gear art must use
 * for its primary material, ordered brightest to darkest: highlight, light,
 * shade, deep. This is the constraint that makes a recolour meaningful rather
 * than a lottery: the remap only has to know these four, and the art lane only
 * has to promise that its main material is drawn in them.
 *
 * Fantasy: cream highlight, steel light, steel shade, steel deep.
 * Sci-fi:  steel highlight, steel light, steel light shade, steel light deep.
 *
 * Everything else in a base sprite (wood, leather, a gem, the cloth of a cloak)
 * is the art lane's free choice and passes through every remap untouched.
 */
export const GEAR_RAMP: Readonly<Record<TemplateGenre, readonly [number, number, number, number]>> = Object.freeze({
  fantasy: Object.freeze([5, 8, 32, 33] as const),
  scifi: Object.freeze([5, 4, 32, 33] as const),
});

/**
 * The recolour per tier per template. `null` means "draw the pixels as
 * authored": common is the base art in its own colours, and rare and legendary
 * have their own drawings and need no remap at all.
 *
 * THE RULE THE UNCOMMON REMAPS OBEY, and it is a rule rather than taste
 * because the first version of this table broke it on both templates: a
 * recolour moves the HUE and holds the VALUE. The target ramp must keep the
 * source ramp's top luminance (within 10 Rec709) and its total span (within 15
 * percent), or the "+1" piece is not a different metal, it is the same metal
 * in shadow. Measured, the first version was a straight downgrade: fantasy
 * went 238/196/146/92 to 180/155/119/89, so the span compressed by 38 percent
 * and an uncommon HIGHLIGHT (180) came out darker than a common MIDTONE (196),
 * which is why the +1 longsword blade read as wood and the +1 kite shield read
 * as leather. Sci-fi held its span but dropped every step by 13 to 43, so an
 * enchanted piece simply looked dirtier. Composite mean luminance fell on all
 * eight archetypes; it now matches or slightly exceeds common on all eight.
 *
 * `test/livingtable-rules.test.ts` measures both bounds against the shipped
 * PALETTEs, so this cannot silently regress again.
 *
 * A NOTE ON THE IDENTITY ENTRY (5 -> 5 in fantasy, and nothing in either table
 * that darkens): the brightest step of a polished-metal ramp is a specular
 * highlight, and a specular highlight on brass blows out to the same near-white
 * a specular highlight on steel does. Fantasy's palette holds exactly one entry
 * at that luminance (5 CREAM, L238), so the honest brass ramp keeps it and
 * moves the three steps below it. The entry is written out rather than omitted
 * so the table shows all four ramp steps and a reader can see the decision was
 * made rather than forgotten; an omitted key would draw identically.
 */
export const RECOLOUR_BY_TIER: Readonly<
  Record<TemplateGenre, Readonly<Record<EquipmentTier, PaletteRemap | null>>>
> = Object.freeze({
  fantasy: Object.freeze({
    common: null,
    // Steel becomes brass: L238 > L190 > L155 > L89, against a source ramp of
    // L238 > L190 > L140 > L75. Span 149 against 163, top step identical.
    // (Re-measured against the shipped PALETTE after the chroma re-grade moved
    // 8, 32 and 33; the indices below are unchanged and must not move.)
    //   5 cream        -> 5  cream        L238, the specular, unchanged (see above)
    //   8 steel light  -> 3  leather      L190, buff gold
    //   32 steel shade -> 31 earth lit    L155, brass body
    //   33 steel deep  -> 29 earth shade  L89,  brass shadow
    uncommon: Object.freeze({ 5: 5, 8: 3, 32: 31, 33: 29 }),
    rare: null,
    legendary: null,
  }),
  scifi: Object.freeze({
    common: null,
    // Steel becomes lit cyan alloy: L235 > L208 > L149 > L107, against a source
    // ramp of L221 > L185 > L151 > L94. Span 128 against 127, and the top step
    // rises rather than falls, which is what an energised alloy should do.
    //   5 steel highlight  -> 15 white       L235
    //   4 steel light      -> 10 cyan        L208
    //   32 steel lt shade  -> 40 cyan shade  L149
    //   33 steel lt deep   -> 11 cyan dark   L107
    uncommon: Object.freeze({ 5: 15, 4: 10, 32: 40, 33: 11 }),
    rare: null,
    legendary: null,
  }),
});

/**
 * The remap applies to THE GEAR LAYER ONLY, never to the body. A body sprite is
 * always drawn as authored. This matters: the body and the gear share a palette
 * and often share the gear ramp, and remapping the body would recolour the
 * character every time they found a new hat.
 */
export const RECOLOUR_SCOPE_NOTE = "gear layers only; the body sprite is never remapped";

// ===========================================================================
// 7. GLOW
// ===========================================================================

/**
 * THERE IS NO ALPHA. The renderer is indexed colour drawn as opaque rects, so a
 * soft bloom is not available and this contract does not pretend otherwise.
 *
 * What ships instead is what the era actually did: A DILATED SILHOUETTE RING in
 * reserved palette entries, drawn UNDER everything else, plus an optional
 * two-frame palette pulse that redraws the identical mask in a dimmer pair of
 * indices. Palette cycling on a fixed mask is exactly how a 16-bit game made
 * something shimmer, and it costs nothing at draw time.
 *
 * THE MASK. For each glowing gear layer, take that layer's opaque pixels AFTER
 * its remap. Band 1 is every pixel at Chebyshev distance exactly 1 from that
 * set and not in it. Band 2 is every pixel at distance exactly 2 and in neither
 * the set nor band 1. Chebyshev (the 8-neighbourhood), not Manhattan, so the
 * ring closes on diagonals instead of leaving corner gaps.
 *
 * The ring is NOT subtracted against the body: it is drawn at LAYER_GLOW, which
 * is under the body and under every gear layer, so any ring pixel that falls
 * on the figure is simply painted over. Two glowing layers union their masks
 * band by band, and where band 1 of one meets band 2 of another, band 1 wins
 * (the brighter index).
 *
 * THE RASTER. A ring can leave the sprite's own 16 x H box, so the mask is
 * computed on a grid inset by GLOW_MARGIN on all four sides and drawn at that
 * offset: origin (spriteOriginX - GLOW_MARGIN * px, spriteOriginY -
 * GLOW_MARGIN * px), size (TOKEN_WIDTH + 2 * GLOW_MARGIN) x (height + 2 *
 * GLOW_MARGIN). The same negative-y skip as the token itself applies, and the
 * two rows that fall below the feet bleed into the tile beneath, which reads as
 * light on the floor and is intended.
 */

/** Reserved palette entries, appended to BOTH template palettes. Indices 0 to 47 keep their exact current meaning, so not one shipped sprite re-authors. */
export const GLOW_PALETTE_BASE = 48;
export const GLOW_PALETTE_COUNT = 4;

/** Frame A, the bright frame: band 1 index and band 2 index. */
export const GLOW_INDEX_A: readonly [number, number] = Object.freeze([48, 49] as const);
/** Frame B, the dim frame: the same two bands, roughly 40 percent darker. */
export const GLOW_INDEX_B: readonly [number, number] = Object.freeze([50, 51] as const);

/**
 * WHAT THE ART LANES MUST ADD, identically in both files, and it is the only
 * palette change in this feature:
 *
 *   PALETTE grows from 48 entries to exactly 52. Indices 0 to 47 are byte
 *   identical to what ships today. Append four:
 *
 *     48 GLOW_A1  band 1, bright frame. Rec709 luminance at least 190.
 *     49 GLOW_A2  band 2, bright frame. Luminance 55 to 75 percent of 48.
 *     50 GLOW_B1  band 1, dim frame.    Luminance 55 to 70 percent of 48.
 *     51 GLOW_B2  band 2, dim frame.    Luminance 55 to 75 percent of 50.
 *
 *   The hue is one choice per template, not per item: fantasy warm (an arcane
 *   gold or pale amber), sci-fi cool (a hot cyan or white-blue). Both must be
 *   clearly distinct from every walkable floor colour in their own palette,
 *   because a ring that reads as floor reads as nothing.
 *
 *   Each art lane also relaxes its own test's bound from
 *   `PALETTE.length <= 48` to `PALETTE.length <= 52` and adds an assertion that
 *   `PALETTE.length === 52` and that no SPRITE pixel anywhere uses an index in
 *   48 to 51. The glow band belongs to the compositor; no drawn art may borrow
 *   it. That last assertion is what keeps the reservation real.
 */
export const GLOW_PALETTE_NOTE = "palette grows 48 -> 52; indices 48..51 are compositor-only and no sprite may use them";

/**
 * How many bands each tier gets, and whether it pulses.
 *
 * Common does not glow at all, which is what makes an enchanted piece read as
 * enchanted. Uncommon gets a thin ring, rare and legendary a thick one. Rare
 * and legendary already differ by having their own drawn artwork, so the ring
 * is not carrying that distinction on its own.
 */
export const GLOW_BANDS_BY_TIER: Readonly<Record<EquipmentTier, 0 | 1 | 2>> = Object.freeze({
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 2,
});

export const GLOW_PULSES_BY_TIER: Readonly<Record<EquipmentTier, boolean>> = Object.freeze({
  common: false,
  uncommon: false,
  rare: false,
  legendary: true,
});

/** Pixels of margin the glow raster adds on every side. Equal to the maximum band count, and the reason TOKEN_MAX_HEIGHT is bounded. */
export const GLOW_MARGIN = 2;

/**
 * IS ANIMATION IN SCOPE? The FRAMES are in scope, the LOOP is not.
 *
 * The compositor takes a `frame: 0 | 1` argument defaulting to 0 and picks
 * GLOW_INDEX_A or GLOW_INDEX_B from it. That is the whole animation surface,
 * and it is two lines. Nobody has to own a requestAnimationFrame loop, a
 * dirty-rect scheme or a re-render cadence to ship this feature, and the play
 * screen's canvas effect keeps redrawing exactly when the world changes, as it
 * does today.
 *
 * At launch the screen passes frame 0 and nothing pulses. Turning it on later
 * is a timer in LivingTable.tsx that flips a piece of state every
 * GLOW_PULSE_PERIOD_MS / 2 and passes it down. Deliberately deferred: an
 * always-on animation loop on a canvas that currently repaints only on change
 * is a performance and battery decision that deserves its own look, and it is
 * not what makes the characters stop being flat.
 */
export const GLOW_PULSE_PERIOD_MS = 1200;

export type GlowFrame = 0 | 1;

// ===========================================================================
// 8. MECHANICS
// ===========================================================================

/**
 * TIERS. Four, and the ladder is SRD 5.1's own magic item ladder, not a
 * homebrew curve.
 *
 *   common     +0   no bonus, no glow. The starting kit. It exists so every
 *                   archetype has all three slots drawn from turn one.
 *   uncommon   +1   SRD "Weapon, +1" / "Armor, +1". Recolour of the base art.
 *   rare       +2   SRD "Weapon, +2" / "Armor, +2". Its own drawn art.
 *   legendary  +3   SRD "Weapon, +3" / "Armor, +3", plus a rider on a weapon.
 *                   Its own drawn art.
 */
export type EquipmentTier = "common" | "uncommon" | "rare" | "legendary";

export const EQUIPMENT_TIERS: readonly EquipmentTier[] = Object.freeze([
  "common",
  "uncommon",
  "rare",
  "legendary",
] as const);

export const BONUS_BY_TIER: Readonly<Record<EquipmentTier, 0 | 1 | 2 | 3>> = Object.freeze({
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
});

/** Index into `SlotDefinition.nameByTier`. Ordered exactly as EQUIPMENT_TIERS. */
export const TIER_NAME_INDEX: Readonly<Record<EquipmentTier, 0 | 1 | 2 | 3>> = Object.freeze({
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
});

export function tierArtVariant(tier: EquipmentTier): ArtVariant {
  return tier === "rare" ? "rare" : tier === "legendary" ? "legendary" : "base";
}

/**
 * One equipped piece, as it sits on the character sheet.
 *
 * Deliberately tiny, and deliberately carrying NO NUMBER. The tier is the only
 * thing stored; the bonus is derived from `BONUS_BY_TIER` every time it is
 * read. A stored bonus is a number that can be written by something other than
 * this table, which is exactly the door this whole contract exists to keep
 * shut. Same reasoning that keeps `AttackRollRequest` from carrying a
 * `targetAC`.
 */
export interface EquippedItem {
  /** WIDENED in contract v2 from SlotRole to GearRole. Nothing in v1 reads this field back, so the widening is free. */
  slot: GearRole;
  tier: EquipmentTier;
}

/**
 * WIDENED in contract v2 to range over all six GearRoles. A v1 sheet (three
 * keys) is still a valid value. Semantics per role, pinned in section 11:
 * weapon, outer, crown and boots are never empty after normalisation (absent
 * reads as "common"); ring and amulet are EMPTY when absent and are never
 * stored with tier "common".
 */
export type Equipment = Partial<Record<GearRole, EquippedItem>>;

/**
 * Every archetype starts with all three slots at common. `createCharacter`
 * fills this in and `normalizeSheet` defaults it for any sheet stored before
 * equipment existed, which is the same load-boundary defaulting pattern
 * `hitDiceRemaining` and `deathSaves` already use for that free-form jsonb bag.
 *
 * On CharacterSheet the new field is:
 *
 *     equipment?: Equipment;
 *
 * Optional on the type, always present after `normalizeSheet`. It rides in the
 * same `game_characters.stats` blob as everything else and needs no migration.
 */
export const STARTING_EQUIPMENT: Equipment = Object.freeze({
  weapon: Object.freeze({ slot: "weapon", tier: "common" }),
  outer: Object.freeze({ slot: "outer", tier: "common" }),
  crown: Object.freeze({ slot: "crown", tier: "common" }),
});

/**
 * THE V2 STARTING KIT: STARTING_EQUIPMENT plus a plain pair of boots, so every
 * character has something on their feet from turn one (the token draws them).
 * Ring and amulet are deliberately ABSENT: those two slots start empty.
 *
 * A separate constant rather than a changed STARTING_EQUIPMENT, on purpose:
 * three v1 tests deep-equal a loaded sheet against STARTING_EQUIPMENT, and v1's
 * normalizeEquipment builds three keys, so changing that value before the rules
 * lane lands its six-role normaliser would break the suite in between. The
 * rules lane switches createCharacter, normalizeSheet, equipmentOf and
 * normalizeEquipment to STARTING_LOADOUT and moves those three assertions to it
 * in the same change. Every piece here is common: +0, no attunement.
 */
export const STARTING_LOADOUT: Equipment = Object.freeze({
  weapon: Object.freeze({ slot: "weapon", tier: "common" }),
  outer: Object.freeze({ slot: "outer", tier: "common" }),
  crown: Object.freeze({ slot: "crown", tier: "common" }),
  boots: Object.freeze({ slot: "boots", tier: "common" }),
});

/**
 * Bound on stacked AC from equipment, and the honest reason for it.
 *
 * The Fighter chassis is the only one with two `armor`-kind slots (the owner's
 * Knight example is sword, shield, armour). Under raw SRD that is +6 AC at
 * legendary, which is correct 5e and completely wrong for a game capped at
 * level 3 against goblins at +4 to hit. The bound is applied in one place,
 * `effectiveArmorClass` below, and it is the only house rule in this contract.
 * It is stated here rather than hidden so it can be argued with.
 */
export const MAX_TOTAL_AC_BONUS = 3;

/**
 * THE EXACT ROUTE EVERY BONUS TAKES TO A d20. A builder must not invent a
 * second path; if a number reaches a roll any other way, that is the bug.
 *
 * Four functions, all in `session/combat.ts`, which is already the adapter
 * layer between a CharacterSheet and the numbers-only rules engine. Nothing in
 * `rules/` changes: `rules/` takes plain numbers and returns outcomes, and it
 * must keep knowing nothing about a sheet.
 *
 * 1. ATTACK ROLL. `attackerBonusFor(sheet)` currently returns
 *    `modifiers[weapon.ability] + proficiencyBonus + archeryBonusFor(...)`.
 *    It gains one more addend: `equipmentAttackBonus(sheet)`, which is
 *    `BONUS_BY_TIER[weaponSlotTier]` when the weapon slot's `bonusKind` is
 *    "weapon", else 0. That total is what already flows into
 *    `resolveAttack({ attackerBonus })`. A magic sword therefore reaches the
 *    d20 through the identical channel the proficiency bonus does, which is the
 *    whole requirement.
 *
 * 2. DAMAGE ROLL. `weaponDamageNotationFor(sheet)` builds "1d8+2" from
 *    `modifiers[weapon.ability] + duelingBonusFor(...)`. The same
 *    `equipmentAttackBonus(sheet)` is added into that modifier. The notation
 *    then goes to `resolveDamage`, unchanged. A legendary rider is NOT folded
 *    in here: see 5.
 *
 * 3. ARMOR CLASS. `sheet.armorClass` is computed once at creation by
 *    `computeAC` and stored. Do NOT recompute and rewrite it when gear changes;
 *    a stored derived number goes stale the first time something forgets. Add a
 *    derived reader instead:
 *
 *        effectiveArmorClass(sheet) =
 *          sheet.armorClass + min(MAX_TOTAL_AC_BONUS, sum of BONUS_BY_TIER over
 *          every equipped slot whose bonusKind is "armor")
 *
 *    and route ALL SIX existing readers of `sheet.armorClass` through it. They
 *    are, exhaustively: session/combat.ts `defenderACForRollRequest`;
 *    LivingTable.tsx lines that pass `args.sheet.armorClass` as a `targetAC`
 *    (two of them) and the character-sheet panel's "AC {sheet.armorClass}";
 *    session/dmContext.ts `armorClass: sheet.armorClass`; dm/promptBuilder.ts's
 *    "AC {c.armorClass}" (which reads dmContext's value, so fixing dmContext
 *    fixes it). Missing one means the DM is told a different AC than the engine
 *    rolls against, which is the exact class of defect
 *    `defenderACForRollRequest` was written to end.
 *
 *    `sheet.armorClass` keeps meaning "AC from armour, DEX and fighting style".
 *    The base armour table (`ARMOR_BY_CHASSIS` in creation.ts) is NOT touched
 *    by this feature. Equipment is strictly additive on top.
 *
 * 4. SAVING THROWS. `saveModifierFor(sheet, ability)` returns the trained bonus
 *    or the bare modifier. It gains one addend: `equipmentSaveBonus(sheet)`,
 *    the sum of `BONUS_BY_TIER` over every equipped slot whose `bonusKind` is
 *    "save". Applies to every saving throw, trained or not, which is the SRD
 *    "Cloak of Protection" shape. `modifierForRollRequest` already delegates to
 *    `saveModifierFor`, so a DM-requested save picks it up with no second edit.
 *
 * 5. LEGENDARY RIDER. `SlotDefinition.legendaryRider` applies only when the
 *    weapon slot is at tier "legendary". It is EXTRA DAMAGE DICE, rolled by the
 *    engine as its own `resolveDamage(rider.bonusDamage)` call after a hit
 *    lands, and added to the total. Separate from the weapon's own notation on
 *    purpose: SRD doubles damage DICE on a critical, and a rider that had been
 *    concatenated into "1d8+1d6+4" would silently change what a critical
 *    doubles. Roll it separately, add it once, and it is right in both cases.
 *
 * 6. MONSTERS NEVER HAVE EQUIPMENT. `MONSTER_STATBLOCKS` numbers are the
 *    creature's whole story, and `statblockFor` stays the only source for a
 *    non-player roll. There is no equipment field on a statblock and none is to
 *    be added.
 */
export const BONUS_ROUTING_NOTE =
  "attack: attackerBonusFor; damage: weaponDamageNotationFor; AC: effectiveArmorClass; saves: saveModifierFor; rider: its own resolveDamage call";

/**
 * NO FIELD OF THE DM TURN SCHEMA MAY EVER CARRY AN EQUIPMENT BONUS.
 *
 * Stated as plainly as the file allows: there is no legitimate reason for a
 * model to name a number that modifies a roll, and equipment is the newest and
 * most tempting shape for one. `dm/turnSchema.ts` already REJECTS rather than
 * ignores a `targetAC` on an attack request, and the reasoning in that field's
 * doc comment applies here word for word: a silently ignored field is how a
 * fix half-regresses while still looking whole.
 *
 * The DM lane adds, to `validateRollRequest` and to `validatePlacedToken`, a
 * rejection of every key below, with a message in the same voice as the
 * existing targetAC rejection. `test/livingtable-dm.test.ts` already has a "no
 * field a roll outcome could structurally originate from" test that forbids
 * `damage`, `result`, `hit` and `total` at compile time; these join it.
 *
 * The model may still narrate gear all it likes ("her sword is burning"). It
 * simply has no field in which to write what that is worth.
 *
 * GROWN IN CONTRACT V2 by the last eleven keys, so that no field can grant,
 * choose, name or price gear, loot, a bag slot, an attunement or an item
 * charge. v2 also WIDENS where the DM lane runs the check: not only
 * `validateRollRequest` and `validatePlacedToken` but also the turn root,
 * every world action, every assembleCell layout and every placed prop (see
 * section 11, "THE MODEL IS LOCKED OUT"). None of the eleven collides with a
 * key the turn schema legitimately reads (checked against every `rec.<key>`
 * in dm/turnSchema.ts at the time of writing: "grantsItem" is legitimate and
 * is deliberately NOT here; it is policed by value instead, see
 * `isMagicGearName`).
 */
export const EQUIPMENT_FORBIDDEN_WIRE_KEYS: readonly string[] = Object.freeze([
  "bonus",
  "attackBonus",
  "damageBonus",
  "acBonus",
  "saveBonus",
  "magicBonus",
  "plus",
  "enchantment",
  "equipment",
  "equipped",
  "item",
  "tier",
  "rarity",
  // contract v2
  "loot",
  "gear",
  "bag",
  "slot",
  "attuned",
  "attunement",
  "charges",
  "grantsGear",
  "grantsEquipment",
  "grantsLoot",
  "magicItem",
]);

/**
 * WHERE THE DICE READOUT NAMES THE SOURCE.
 *
 * A player who hits on a 14 needs to be able to see WHY. Today
 * `menu/labels.ts`'s `attackLine` prints "rolled 9, +5 = 14, needed 13 to hit",
 * and +5 is an unexplained lump. One shared shape, pinned here because the
 * render lane owns `RollReadout` and the screen lane owns `attackLine` and they
 * must not invent two:
 */
export interface BonusSource {
  /** Player-facing, already resolved: "Dexterity and training", "Keen Longsword". Never an asset id, never a slot key. */
  label: string;
  /** Signed. The amount this source contributed to the modifier that was just rolled. */
  amount: number;
}

/**
 * Three additions, one per lane, all optional so nothing existing breaks:
 *
 *   render lane   `RollReadout` in render/canvasRenderer.ts gains
 *                 `sources?: readonly BonusSource[]`.
 *   render lane   `attackResultToReadout` / `checkResultToReadout` in
 *                 render/rollReadoutAdapter.ts each take an optional trailing
 *                 `sources` argument and copy it through. Those two functions
 *                 remain the ONLY way to build a RollReadout.
 *   screen lane   `AttackLineInput` and `CheckLineInput` in menu/labels.ts gain
 *                 the same optional field, and the printed line becomes
 *                 "rolled 9, +5 = 14 (+3 Dexterity and training, +2 Keen
 *                 Longsword), needed 13 to hit". With no sources supplied the
 *                 line is byte-identical to today's, which keeps every existing
 *                 label test passing untouched.
 *
 * The sum of every `amount` MUST equal the `modifier` that was rolled. That is
 * one assertion in the labels test and it is what stops the readout drifting
 * from the engine, which is the same failure mode as a decorative AC.
 */
export const READOUT_SOURCE_NOTE = "sum of BonusSource.amount must equal the modifier that was actually rolled";

// ===========================================================================
// 9. THE RENDER PLAN: how equipment reaches the canvas
// ===========================================================================

/**
 * EQUIPMENT DOES NOT GO INTO THE WORLD MODEL. `PlacedToken` stays
 * `{ id, assetId, x, y, kind, currentHp? }` and gains nothing. Two reasons, and
 * both are load-bearing: the world is persisted to `game_cells` and shown to
 * the DM, so anything on a token is something the model can see and reason
 * about supplying; and the layout is validated against a manifest that has no
 * concept of a worn item.
 *
 * Instead the play screen builds a plan from the character sheet, which the
 * model never touches, and hands it to the renderer alongside the layout:
 *
 *     renderCell(ctx, layout, manifest, scale, seed = 0, plans?: TokenRenderPlans)
 *
 * A sixth optional parameter, so the existing call site and every existing
 * render test keep compiling and keep drawing exactly what they draw today. A
 * token with no plan draws body-only, from its own `assetId`, as now.
 */
export interface EquipmentLayerPlan {
  /** WIDENED in contract v2 to also accept a boots overlay id. The compositor only ever passes it to a string lookup. */
  spriteId: DrawnGearSpriteId;
  layer: EquipmentLayer;
  /** null means draw as authored. Never applied to the body. */
  remap: PaletteRemap | null;
  glowBands: 0 | 1 | 2;
  glowPulses: boolean;
}

export interface TokenRenderPlan {
  /** Always the archetype body id. Must equal the PlacedToken's own assetId; if they disagree the renderer trusts the token and skips the plan. */
  bodySpriteId: BodySpriteId;
  /** Already sorted ascending by `layer`. The compositor may re-sort defensively but must not need to. */
  layers: readonly EquipmentLayerPlan[];
}

/** Keyed by `PlacedToken.id`, not by assetId: two Knights on the board are two different characters with two different sets of gear. */
export type TokenRenderPlans = Readonly<Record<string, TokenRenderPlan>>;

/**
 * The composite draw, in order, for one planned token. This is the whole
 * renderer contract in nine lines:
 *
 *   1. compute the glow mask from every layer with glowBands > 0
 *   2. draw band 2 pixels, then band 1 pixels, in the frame's indices
 *   3. draw every layer with layer <  LAYER_BODY, ascending
 *   4. draw the body sprite
 *   5. draw every layer with layer >  LAYER_BODY, ascending
 *
 * Steps 3 and 5 are one ascending pass with the body spliced in at 20; they are
 * written as two only to make it obvious that a cloak at 10 lands behind the
 * body and a hood at 50 lands on top of it.
 *
 * Every layer sprite is looked up in `RenderManifest.tokens`. A missing id
 * SKIPS that layer, exactly as a missing tile id already skips a tile: a
 * manifest gap must read as a missing hat during play, never as a crashed
 * renderer. Every layer sprite is exactly TOKEN_WIDTH x the body's height and
 * is drawn at the body's own origin, so no per-layer offset arithmetic exists
 * anywhere. That is the property that lets four people draw four layers that
 * line up without ever talking.
 */
export const COMPOSITE_ORDER_NOTE = "glow band2, glow band1, layers < 20 ascending, body, layers > 20 ascending";

// ===========================================================================
// 10. THE INVARIANTS EACH LANE OWNS A TEST FOR
// ===========================================================================

/**
 * Written down because a contract nobody checks is a suggestion. Each line
 * names the lane that owns it.
 *
 * rules lane
 *   - every archetype has exactly three slots, one per SlotRole
 *   - exactly one slot per archetype has bonusKind "weapon", so a weapon bonus
 *     can never stack with itself
 *   - a legendaryRider exists only on a weapon-role slot, and parses as dice
 *     notation within MAX_RIDER_DICE / MAX_RIDER_SIDES
 *   - effectiveArmorClass with all-common equipment equals sheet.armorClass
 *   - a +1 weapon moves both the attack total and the damage total by exactly 1
 *   - no bonus is readable from any DM-supplied field; every forbidden key is
 *     rejected, not ignored
 *
 * render lane
 *   - a 16x16 sprite drawn under the new anchor math lands on exactly the
 *     pixels tileOrigin produces today
 *   - a 24-tall token on tile row 0 skips exactly 8 source rows
 *   - tokens draw in ascending y, stably
 *   - a remap entry naming a PROTECTED_PALETTE_INDICES value is skipped
 *   - a missing gear sprite id skips its layer and draws the rest
 *
 * fantasy art lane and sci-fi art lane, each on their own file
 *   - PALETTE.length === 52, indices 0..47 unchanged
 *   - no SPRITE pixel uses an index in 48..51
 *   - every id in equipmentSpriteIdsFor(template) exists in SPRITES exactly
 *     once, with kind "token"
 *   - every gear sprite and every archetype body is 16 wide and TOKEN_HEIGHT
 *     tall; every other sprite's rows are `size` long
 *   - every base-variant gear sprite uses all four GEAR_RAMP indices, so the
 *     recolour has something to bite on
 *   - the art problem this feature exists to fix, measured: no archetype body
 *     has more than 45 percent of its non-outline pixels in a single palette
 *     index, and at least 20 percent of them are darker than the brightest
 *     walkable floor in the same palette
 *   - at every tier, the composited kit leaves the archetype's face readable.
 *     This is the one invariant no per-sprite check can express: a crown and a
 *     weapon can each be a good drawing and still, stacked in layer order over
 *     the body, paint out the eyes. It has to be measured on the composite.
 *   - a body keeps real negative space: at least two rows of a 16x24 archetype
 *     carry more than one opaque run, so the figure reads as a figure rather
 *     than as a filled blob with a rim. A two-column interior gap does not
 *     survive a derived outline; three columns is the floor.
 *
 * screen lane
 *   - the sum of a readout's BonusSource amounts equals its modifier
 *   - a sheet stored before equipment existed loads with STARTING_EQUIPMENT
 *   - no CostBadge appears on any equipment surface
 */

// ===========================================================================
// 11. CONTRACT V2: SIX SLOTS, THE BAG, ATTUNEMENT, LOOT, THE INVENTORY SCREEN
// ===========================================================================

/**
 * WHAT V2 IS FOR. The owner asked for an inventory screen in the shape of a
 * reference they supplied: a framed, book-titled panel; the character drawn
 * large on a glowing circular pedestal; equipment slots arranged round the
 * figure that show a faint silhouette when empty and glow when selected; a
 * bag grid of loose items underneath; Cancel and Ok so a change is staged
 * before it commits. Its LAYOUT, in this game's own FF-era pixel vocabulary,
 * not its painted look. They also chose: six slots (ring, amulet and boots
 * join weapon, outer and crown, under D&D's real three-item attunement cap),
 * and engine-rolled loot, built now.
 *
 * WHY THIS COMPLETES ISSUE #15 RATHER THAN OVERRIDING IT. #15 hid the rarity
 * chip and the tier picker because nothing granted gear, so the ladder was
 * unclimbable. Loot is the engine-owned grant #15 was waiting for. The restore
 * list and exactly what comes back is under "THE SCREEN" below.
 *
 * THE LOAD-BEARING RULE, applied to v2: the model may NEVER choose an item,
 * choose a tier, grant gear, or supply any equipment, attunement or charge
 * number, from any field of the DM turn. Loot is rolled by the engine off the
 * frozen tables below and shown like any other die. The model is TOLD what
 * turned up, after the fact, so it can narrate the find.
 *
 * FREE FOREVER. Equipping, unequipping, attuning, opening the inventory and
 * looting cost no credit, make no model call and never show a CostBadge.
 *
 * WHO OWNS WHAT IN V2 (six lanes, disjoint files; a lane edits only its own):
 *
 * AS BUILT: the staging and attunement functions shipped in
 * rules/inventory.ts and rules/attunement.ts, and loot in rules/loot.ts, not
 * the characters/inventory.ts and characters/loot.ts named below. They take
 * the structural GearSheet / LootSheet shapes, never a CharacterSheet, which
 * is rules/'s own layering rule; names and signatures are exactly the ones
 * pinned here (each file pins itself with `satisfies` against the Fn types).
 *
 *   rules      characters/equipment.ts, characters/inventory.ts (new),
 *              characters/creation.ts, characters/health.ts,
 *              session/combat.ts, session/characterState.ts
 *              tests: livingtable-rules, livingtable-characters
 *   loot + DM  characters/loot.ts (new), dm/turnSchema.ts,
 *              dm/promptBuilder.ts, session/dmContext.ts
 *              tests: livingtable-loot (new file), livingtable-dm
 *   render     render/equipmentCompositor.ts, render/canvasRenderer.ts,
 *              render/rollReadoutAdapter.ts, render/doll.ts (new),
 *              render/gearIcon.ts (new)
 *              tests: livingtable-render
 *   fantasy    scripts/assets/fantasy.ts, test/livingtable-assets-fantasy
 *   sci-fi     scripts/assets/scifi.ts, test/livingtable-assets-scifi
 *   screen     LivingTable.tsx, menu/labels.ts, menu/equipment.ts, and ONLY
 *              the Living Table `.lt-*` block of src/styles.css
 *              tests: livingtable-menu, livingtable-integration
 *
 * The cross-lane function signatures are pinned in "THE CROSS-LANE API" below.
 * A lane that needs something another lane owns calls it by that name and
 * never re-derives it.
 */

// ── 11.1 boots are drawn, per archetype ─────────────────────────────────

/**
 * WHY BOOTS OVERLAYS ARE PER ARCHETYPE, read off the shipped body pixel rows
 * (TOKEN_ART in scripts/assets/fantasy.ts, the tokenXxxPixels fills in
 * scripts/assets/scifi.ts), not assumed. Row 22 is each body's last drawn row
 * and row 23 its contact shadow:
 *
 *   knight           feet on row 22 at x3..5 and x9..11 (legs rows 19..21)
 *   shadow           feet at x5..6 and x9..10, legs rows 19..22
 *   healer           NO FEET: row 22 is the robe hem, x2..13
 *   fireball-person  feet at x5..6 and x9..10 under a hem that ends on row 21
 *   trooper          feet at x3..5 and x10..12
 *   infiltrator      feet at x4..5 and x10..11, legs rows 18..22
 *   medic            feet at x5..6 and x9..10 under a skirt ending on row 21
 *   psion            NO FEET: the robe tapers to x5..10 on row 22
 *
 * Four different foot placements plus two bodies with no feet showing, and
 * each template on its own already has three or four of those variations
 * (fantasy: knight, shadow and fireball-person, healer; sci-fi: all four
 * differ). A shared-per-template overlay would paint boots beside most of the
 * roster's feet. So the boots DRAWING is
 * per archetype (like weapon, outer and crown), while the boots ITEM (name,
 * effect, attunement) is shared per template (like ring and amulet).
 *
 * WHAT A BOOTS OVERLAY MUST BE, for both art lanes (each asserts it in its own
 * test):
 *   - 16 wide and TOKEN_HEIGHT tall, `kind: "token"`, walkable false, built
 *     with `outlined(worn(block, x, y), false)` like every other gear piece;
 *   - its FILL (every pixel that is neither -1 nor index 0) lies in rows 17
 *     to 22 inclusive, never on row 23 (the contact shadow row);
 *   - on the six archetypes with drawn feet, it covers every non-outline body
 *     pixel on row 22 (the boots ARE the feet, or the plain pair and the
 *     Boots of Speed read identically);
 *   - on the healer and the psion, it adds toe caps on row 22 only: at most
 *     two runs, each at most three columns wide, inside the hem's own
 *     columns, so the robe still reads as a robe;
 *   - the `base` variant uses all four GEAR_RAMP indices of its template
 *     (the uncommon recolour has to bite on something), which the existing
 *     "every base-variant gear sprite" invariant already enforces once the
 *     boots ids are in the list it walks.
 */
export const BOOTS_ART_NOTE =
  "per archetype; fill in rows 17..22 only; covers the body's row-22 feet, or toe caps only on healer and psion; base uses all four GEAR_RAMP indices";

// ── 11.2 the items ──────────────────────────────────────────────────────

/**
 * THE CLOSED SET OF ACCESSORY EFFECTS. Each ring, amulet and boots item has
 * exactly ONE of these, taken from its own SRD 5.1 text, and each lands in
 * exactly one existing engine function (rules lane). Seven kinds, no more; a
 * new kind is a contract change, never a lane's improvisation.
 *
 *   protection   SRD Ring of Protection, one sentence: "+1 bonus to AC and
 *                saving throws". `amount` joins the AC total inside
 *                MAX_TOTAL_AC_BONUS (effectiveArmorClass) AND the save total
 *                inside MAX_TOTAL_SAVE_BONUS (saveModifierFor).
 *   luck         SRD Stone of Good Luck: "+1 bonus to ability checks and
 *                saving throws". `amount` joins every ability check
 *                (skillModifierFor, so Search's Perception too) inside
 *                MAX_TOTAL_CHECK_BONUS, and the save total inside
 *                MAX_TOTAL_SAVE_BONUS.
 *   skillAdvantage  SRD Boots of Elvenkind: advantage on Dexterity (Stealth)
 *                checks. Passed as `advantage: true` into resolveSkillCheck
 *                for every check of `skill` the player makes.
 *   speedMultiplier SRD Boots of Speed: "double your walking speed".
 *                effectiveSpeedFt applies the armour Strength penalty FIRST,
 *                then multiplies by `factor`.
 *   hitDieHealingMultiplier  SRD Periapt of Wound Closure: "whenever you roll
 *                a Hit Die to regain hit points, double the number of hit
 *                points it restores". shortRest heals
 *                max(1, die + CON) * factor.
 *   saveRescue   SRD Ring of Evasion: when you fail a saving throw of
 *                `ability`, spend a charge and succeed instead. `charges` is
 *                the maximum; a long rest (this game's dawn) rolls
 *                `rechargeDice` and restores that many, capped at the maximum.
 *   restRegeneration  SRD Ring of Regeneration: "regain 1d6 hit points every
 *                10 minutes, provided that you have at least 1 hit point".
 *                This game keeps no clock outside a rest, and a short rest is
 *                an hour, six 10-minute intervals, so the ring rolls `dice`
 *                (6d6) at the end of every short rest, after the hit die,
 *                when the character is on at least 1 hit point.
 *
 * Magnitudes are bounded by EFFECT_BOUNDS; the rules test asserts every item
 * in ACCESSORY_ITEMS sits inside them.
 */
export type AccessoryEffect =
  | { kind: "protection"; amount: number }
  | { kind: "luck"; amount: number }
  | { kind: "skillAdvantage"; skill: "Stealth" }
  | { kind: "speedMultiplier"; factor: number }
  | { kind: "hitDieHealingMultiplier"; factor: number }
  | { kind: "saveRescue"; ability: "dex"; charges: number; rechargeDice: string }
  | { kind: "restRegeneration"; dice: string };

export type AccessoryEffectKind = AccessoryEffect["kind"];

export const ACCESSORY_EFFECT_KINDS: readonly AccessoryEffectKind[] = Object.freeze([
  "protection",
  "luck",
  "skillAdvantage",
  "speedMultiplier",
  "hitDieHealingMultiplier",
  "saveRescue",
  "restRegeneration",
] as const);

/** Every accessory effect magnitude sits inside these. The rules test walks ACCESSORY_ITEMS against them. */
export const EFFECT_BOUNDS = Object.freeze({
  protectionAmountMax: 1,
  luckAmountMax: 1,
  speedFactorMax: 2,
  hitDieHealingFactorMax: 2,
  saveRescueChargesMax: 3,
  /** rechargeDice and restRegeneration dice parse through rules/dice.ts with modifier 0, count <= this, sides <= restRegenSidesMax. */
  restRegenDiceMax: 6,
  restRegenSidesMax: 6,
});

/**
 * The totals caps. MAX_TOTAL_AC_BONUS (section 8) is unchanged at 3 and now
 * also counts `protection`. The two below are new: before v2 exactly one slot
 * could add to a save and nothing added to a check, so neither needed one.
 * Every cap is applied once, in rules/magicItems.ts, and spent in GEAR_ROLES
 * order when a readout breaks the total into BonusSources (so a slot that
 * finds the cap already spent drops out of the breakdown, exactly as the v1
 * AC breakdown already does).
 */
export const MAX_TOTAL_SAVE_BONUS = 3;
export const MAX_TOTAL_CHECK_BONUS = 1;

/** Where an item's name and rules come from in the SRD 5.1 document. Evidence, not flavour: every field was checked against open5e's `wotc-srd` document (SRD 5.1) AND the official CC-BY-4.0 PDF, SRD_CC_v5.1.pdf, "Magic Items A-Z". */
export interface SrdSource {
  /** Exactly as SRD 5.1 prints it. */
  name: string;
  /** open5e v1 slug: https://api.open5e.com/v1/magicitems/<slug>/ with document__slug "wotc-srd". */
  slug: string;
  /** The SRD's own rarity, which is NOT always this game's tier: see ACCESSORY_ITEMS. */
  rarity: "uncommon" | "rare" | "very rare" | "legendary";
  /** Whether the SRD says "(requires attunement)". */
  attunement: boolean;
}

/** One ring, amulet or boots item at one tier. Shared per TEMPLATE; the archetype never changes what it is. */
export interface AccessoryItem {
  role: AccessoryRole;
  tier: EquipmentTier;
  /** Player-facing. The fantasy name is the SRD name (minus a parenthetical alias); the sci-fi name is a reskin over identical mechanics. */
  nameByTemplate: Readonly<Record<TemplateGenre, string>>;
  /** null only for the mundane common boots, which are not an SRD magic item. */
  srd: SrdSource | null;
  /** This game's answer. Equal to `srd.attunement` for every SRD item, by rule. */
  requiresAttunement: boolean;
  /** null only for the mundane common boots: +0, does nothing, like every common piece. */
  effect: AccessoryEffect | null;
  /** Where this game's implementation differs from the SRD text, stated so every cut is visible and arguable. Empty when the whole item is applied as written. */
  simplified: readonly string[];
}

/**
 * THE NINE RUNGS, SEVEN SRD ITEMS AND ONE PLAIN PAIR OF BOOTS.
 *
 * How items were chosen, in order: (1) the name is in SRD 5.1's magic items
 * list, nothing else; (2) the item belongs on that body part in the SRD's own
 * words ("rings on the finger", "boots go on the feet", a pendant or a charm
 * "on your person"); (3) at least one clause of its SRD text lands in a
 * number THIS engine already computes (AC, a save, a check, speed, hit-die
 * healing, a rest); (4) the three rungs of a slot are ordered by how much they
 * move this game's numbers, not by SRD rarity, which is recorded beside each
 * item so the difference is visible. v1 set the precedent: its uncommon armour
 * rung is SRD "Armor, +1", which the SRD prices rare.
 *
 * TWO RUNGS ARE EMPTY, AND THAT IS THE HONEST ANSWER. SRD 5.1 has no footwear
 * above rare at all (its seven are Elvenkind, Striding and Springing, the
 * Winterlands, Winged, Levitation, Speed and Slippers of Spider Climbing), and
 * none of its neck items above rare has an effect this engine can apply (the
 * Scarab of Protection's advantage is against spells and undead, which no save
 * here can be told apart as; the Amulet of the Planes and the Talismans are
 * plane travel and alignment locks). So there is no legendary amulet and no
 * legendary boots. An invented rung would break the SRD-only rule, and a
 * decorative one would break the copy rule (state the number or say the piece
 * does nothing). Loot never lands on an empty rung (see LOOT). Filling them is
 * an owner question, not a lane's call.
 *
 * Items considered and rejected, so the next person does not re-litigate:
 * Ring of Warmth, Ring of Resistance, Brooch of Shielding, Boots of the
 * Winterlands and the Periapt of Proof against Poison (resistance to a damage
 * type, and no damage in this engine carries a type); Amulet of Health (sets
 * CON to 19, which moves a STORED maximum hit points read in 35 places);
 * Boots of Striding and Springing (sets speed to 30, which every character
 * already has); Winged Boots and Boots of Levitation (flight, and the
 * pathfinder has no flying); Ring of Jumping, Swimming, Water Walking, Mind
 * Shielding, Free Action, Feather Falling (nothing in the engine to act on).
 */
export const ACCESSORY_ITEMS: Readonly<Record<AccessoryRole, Readonly<Partial<Record<EquipmentTier, AccessoryItem>>>>> =
  Object.freeze({
    ring: Object.freeze({
      // common: no ring. The slot starts empty.
      uncommon: Object.freeze({
        role: "ring",
        tier: "uncommon",
        nameByTemplate: Object.freeze({ fantasy: "Ring of Evasion", scifi: "Reflex Ring" }),
        srd: Object.freeze({ name: "Ring of Evasion", slug: "ring-of-evasion", rarity: "rare", attunement: true }),
        requiresAttunement: true,
        effect: Object.freeze({ kind: "saveRescue", ability: "dex", charges: 3, rechargeDice: "1d3" }),
        simplified: Object.freeze([
          "SRD: you use your reaction to spend a charge. The engine spends it for you on the first failed Dexterity save while a charge remains, because there is never a reason to decline.",
          "SRD: charges return daily at dawn. This game's dawn is the end of a long rest.",
        ]),
      }),
      rare: Object.freeze({
        role: "ring",
        tier: "rare",
        nameByTemplate: Object.freeze({ fantasy: "Ring of Protection", scifi: "Deflector Ring" }),
        srd: Object.freeze({ name: "Ring of Protection", slug: "ring-of-protection", rarity: "rare", attunement: true }),
        requiresAttunement: true,
        effect: Object.freeze({ kind: "protection", amount: 1 }),
        simplified: Object.freeze([]),
      }),
      legendary: Object.freeze({
        role: "ring",
        tier: "legendary",
        nameByTemplate: Object.freeze({ fantasy: "Ring of Regeneration", scifi: "Nanite Ring" }),
        srd: Object.freeze({ name: "Ring of Regeneration", slug: "ring-of-regeneration", rarity: "very rare", attunement: true }),
        requiresAttunement: true,
        effect: Object.freeze({ kind: "restRegeneration", dice: "6d6" }),
        simplified: Object.freeze([
          "SRD: 1d6 every 10 minutes. This game keeps no clock outside a rest, so the ring pays out at the end of each short rest: an hour, six intervals, 6d6.",
          "The limb-regrowth clause has nothing to act on in this game.",
        ]),
      }),
    }),
    amulet: Object.freeze({
      // common: no amulet. The slot starts empty. legendary: none, see above.
      uncommon: Object.freeze({
        role: "amulet",
        tier: "uncommon",
        nameByTemplate: Object.freeze({ fantasy: "Periapt of Wound Closure", scifi: "Sealant Tag" }),
        srd: Object.freeze({ name: "Periapt of Wound Closure", slug: "periapt-of-wound-closure", rarity: "uncommon", attunement: true }),
        requiresAttunement: true,
        effect: Object.freeze({ kind: "hitDieHealingMultiplier", factor: 2 }),
        simplified: Object.freeze([
          "The first SRD clause (you stabilise whenever you are dying at the start of your turn) is not applied: death saves stay the player's own roll, one item one effect.",
        ]),
      }),
      rare: Object.freeze({
        role: "amulet",
        tier: "rare",
        nameByTemplate: Object.freeze({ fantasy: "Stone of Good Luck", scifi: "Fortune Tag" }),
        srd: Object.freeze({ name: "Stone of Good Luck (Luckstone)", slug: "stone-of-good-luck-luckstone", rarity: "uncommon", attunement: true }),
        requiresAttunement: true,
        effect: Object.freeze({ kind: "luck", amount: 1 }),
        simplified: Object.freeze([
          "SRD: works anywhere on your person. This game gives it the amulet slot, so it competes for a slot like every other charm.",
        ]),
      }),
    }),
    boots: Object.freeze({
      common: Object.freeze({
        role: "boots",
        tier: "common",
        nameByTemplate: Object.freeze({ fantasy: "Travel Boots", scifi: "Deck Boots" }),
        srd: null,
        requiresAttunement: false,
        effect: null,
        simplified: Object.freeze([]),
      }),
      uncommon: Object.freeze({
        role: "boots",
        tier: "uncommon",
        nameByTemplate: Object.freeze({ fantasy: "Boots of Elvenkind", scifi: "Silent Treads" }),
        srd: Object.freeze({ name: "Boots of Elvenkind", slug: "boots-of-elvenkind", rarity: "uncommon", attunement: false }),
        requiresAttunement: false,
        effect: Object.freeze({ kind: "skillAdvantage", skill: "Stealth" }),
        simplified: Object.freeze([
          "SRD: advantage on Stealth checks that rely on moving silently. The engine cannot tell that kind of Stealth check from any other, so it applies to every Stealth check.",
          "Silent footsteps are narration, not a number.",
        ]),
      }),
      rare: Object.freeze({
        role: "boots",
        tier: "rare",
        nameByTemplate: Object.freeze({ fantasy: "Boots of Speed", scifi: "Overdrive Boots" }),
        srd: Object.freeze({ name: "Boots of Speed", slug: "boots-of-speed", rarity: "rare", attunement: true }),
        requiresAttunement: true,
        effect: Object.freeze({ kind: "speedMultiplier", factor: 2 }),
        simplified: Object.freeze([
          "SRD: a bonus action to click the heels, for up to 10 minutes a day. A fight here lasts rounds, never close to 10 minutes, so the boots are simply on in every fight and cost no bonus action.",
          "The opportunity-attack clause is not applied: this engine has no opportunity attacks.",
        ]),
      }),
      // legendary: none. SRD 5.1 has no footwear above rare.
    }),
  });

/**
 * ATTUNEMENT FOR THE THREE PER-ARCHETYPE SLOTS, faithful to SRD 5.1:
 *   weapon  "Weapon, +1/+2/+3" needs none. The legendary rung also carries the
 *           Flame Tongue-shape rider (section 2), and Flame Tongue is
 *           "requires attunement", so legendary does.
 *   armor   "Armor, +N" and "Shield, +N" need none, at any tier.
 *   save    the Cloak of Protection shape, and the Cloak of Protection is
 *           "requires attunement", so every magic rung does.
 * Common never does: it is not a magic item.
 */
export const ARCHETYPE_SLOT_ATTUNEMENT: Readonly<Record<BonusKind, Readonly<Record<EquipmentTier, boolean>>>> = Object.freeze({
  weapon: Object.freeze({ common: false, uncommon: false, rare: false, legendary: true }),
  armor: Object.freeze({ common: false, uncommon: false, rare: false, legendary: false }),
  save: Object.freeze({ common: false, uncommon: true, rare: true, legendary: true }),
});

/** SRD 5.1: "a creature can be attuned to no more than three magic items at a time. Any attempt to attune to a fourth item fails." */
export const MAX_ATTUNED_ITEMS = 3;

/** The two templates, in the order every per-template list below is built. */
export const GEAR_TEMPLATES: readonly TemplateGenre[] = Object.freeze(["fantasy", "scifi"] as const);

function isSlotRole(role: GearRole): role is SlotRole {
  return role === "weapon" || role === "outer" || role === "crown";
}

/**
 * Whether this archetype has an item at this role and tier. True for all four
 * tiers of weapon, outer and crown (every archetype's set names all four); per
 * ACCESSORY_ITEMS for the rest. Pure table lookup. The archetype is checked so
 * a caller holding an unvalidated id gets false rather than a throw.
 */
export function gearItemExists(archetypeId: ArchetypeId, role: GearRole, tier: EquipmentTier): boolean {
  if (isSlotRole(role)) return SLOTS_BY_ARCHETYPE[archetypeId]?.[role] !== undefined;
  return ACCESSORY_ITEMS[role][tier] !== undefined;
}

/** The player-facing name of the item at (archetype, role, tier), or null when there is none. THE ONE NAMER: the sheet, the screen, the dice log, the loot line and the DM's prompt all ask this. */
export function gearItemName(archetypeId: ArchetypeId, role: GearRole, tier: EquipmentTier): string | null {
  if (isSlotRole(role)) return SLOTS_BY_ARCHETYPE[archetypeId][role].nameByTier[TIER_NAME_INDEX[tier]];
  return ACCESSORY_ITEMS[role][tier]?.nameByTemplate[TEMPLATE_OF_ARCHETYPE[archetypeId]] ?? null;
}

/** Whether the item at (archetype, role, tier) requires attunement. False when there is no such item. */
export function gearRequiresAttunement(archetypeId: ArchetypeId, role: GearRole, tier: EquipmentTier): boolean {
  if (isSlotRole(role)) return ARCHETYPE_SLOT_ATTUNEMENT[SLOTS_BY_ARCHETYPE[archetypeId][role].bonusKind][tier];
  return ACCESSORY_ITEMS[role][tier]?.requiresAttunement ?? false;
}

/** The accessory effect at (role, tier), or null for a per-archetype role, a common piece, or an empty rung. */
export function accessoryEffect(role: GearRole, tier: EquipmentTier): AccessoryEffect | null {
  if (isSlotRole(role)) return null;
  return ACCESSORY_ITEMS[role][tier]?.effect ?? null;
}

// ── 11.3 attunement, and the words for its refusal ──────────────────────

/**
 * HOW ATTUNING WORKS HERE, the simplest faithful version.
 *
 * SRD 5.1: attuning "requires a creature to spend a short rest focused on only
 * that item", at most three at a time, "any attempt to attune to a fourth item
 * fails; the creature must end its attunement to an item first."
 *
 *   - WEARING IS ATTUNING. An item that requires attunement is attuned
 *     exactly while it is worn. Nothing is stored for it: the attuned set is
 *     DERIVED from `equipment` on every read, like every bonus in this file.
 *     Taking it off ends the attunement (the SRD's 100-feet-for-24-hours rule
 *     has nothing to act on here, because an item is either worn or in the
 *     bag on your back).
 *   - THE SHORT REST IS THE GATE. Gear changes commit only when a short rest
 *     could be taken as far as the room is concerned: nothing hostile present
 *     and the character on their feet (GEAR_CHANGE_BLOCKED copy below). The
 *     screen still opens during a fight, read-only. No hit die is spent and no
 *     time passes; that is the one simplification.
 *   - THE CAP IS ENFORCED AT STAGING. Staging a fourth attunement item is
 *     refused with `attunementFullReason`, and nothing is staged. So a
 *     committed sheet never holds more than MAX_ATTUNED_ITEMS attuned items.
 *   - A BAD BLOB IS STILL SAFE. If a stored sheet somehow wears more than
 *     three, the first three in GEAR_ROLES order count as attuned and the rest
 *     are INACTIVE (bonus refused, with the reason shown, exactly like v1's
 *     refused shield), never silently active.
 *   - Unattuned means "no magical benefit" (SRD). There is no unattuned-but-
 *     worn state reachable through the screen, only through a bad blob.
 */
export const ATTUNEMENT_NOTE = "worn = attuned; commit only when a rest could be taken; at most 3; overflow in a bad blob is inactive in GEAR_ROLES order";

/** "a", "a and b", "a, b and c": the one list-joiner for the copy below. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What the screen says when a fourth attunement item is staged. Produced by
 * the rules lane's `stageEquip`, printed verbatim by the screen lane. `names`
 * are the three currently attuned worn items, in GEAR_ROLES order.
 */
export function attunementFullReason(names: readonly string[]): string {
  return `You can be attuned to three magic items at once, and you are: ${joinNames(names)}. Take one of them off first.`;
}

/** The detail panel's attunement line for an item that needs it. `inUse` is how many of the three are attuned in the STAGED loadout. */
export function attunementNeededLine(inUse: number): string {
  return `Needs attunement. You are attuned to ${inUse} of ${MAX_ATTUNED_ITEMS}.`;
}

export const ATTUNEMENT_NOT_NEEDED_LINE = "No attunement needed.";

/** The counter in the screen header, always shown: "Attuned: 2 of 3". */
export function attunedCounter(inUse: number): string {
  return `Attuned: ${inUse} of ${MAX_ATTUNED_ITEMS}`;
}

/**
 * Why gear cannot change right now, or the screen is read-only. Produced by
 * the rules lane's `gearChangeBlockedReason`, printed verbatim by the screen.
 * Checked in this order: dead, then on the floor (downed or stable), then
 * something hostile in the room.
 */
export const GEAR_CHANGE_BLOCKED = Object.freeze({
  dead: (name: string) => `${name} is gone. Nothing here changes hands.`,
  down: "You are on the floor. Gear changes wait until you are back on your feet.",
  hostiles: "Not with something still in the room. Look all you like; gear changes wait until the fight is over.",
});

// ── 11.4 the bag ────────────────────────────────────────────────────────

/** The three magic tiers. Common is never an item in the bag and never a loot result. */
export type MagicTier = Exclude<EquipmentTier, "common">;

export const MAGIC_TIERS: readonly MagicTier[] = Object.freeze(["uncommon", "rare", "legendary"] as const);

/**
 * ONE OWNED, UNWORN MAGIC ITEM. Same shape and same discipline as
 * EquippedItem: a role and a tier, NO name, NO number. The name comes from
 * `gearItemName` and every number from the engine, on every read.
 *
 * `slot` is the role the item fits; with the archetype fixed per character,
 * (slot, tier) identifies exactly one item, so it is the whole identity.
 */
export interface BagItem {
  slot: GearRole;
  tier: MagicTier;
}

/**
 * THE BAG. `CharacterSheet.bag?: BagItem[]`, an ORDERED list that IS the grid
 * order, read left to right, top to bottom. Its invariants, which the rules
 * lane's normaliser enforces at load and every staging function preserves:
 *   - every entry names an item that exists (gearItemExists) at a MagicTier;
 *   - no duplicates by (slot, tier);
 *   - no entry equal to what is worn in that slot;
 *   - length <= BAG_CAPACITY.
 *
 * COMMON PIECES ARE NEVER BAG ITEMS. A character's own common weapon, outer,
 * crown and boots are always available: "unequip" on a magic piece puts it in
 * the bag and puts the common piece back in the slot (or empties a ring or
 * amulet slot). So the bag holds only magic items.
 *
 * WHY A FULL BAG CANNOT HAPPEN. Loot never grants an item the character
 * already owns (worn or bagged, see LOOT), so a character owns at most one of
 * each (role, magic tier) that has an item: MAX_DISTINCT_MAGIC_ITEMS, which is
 * 16 (three magic rungs each on weapon, outer, crown and ring, two each on
 * amulet and boots). The bag holds 18. Even wearing nothing magic, all 16 fit,
 * so there is no full-bag flow to build, no overflow slot, no forced drop, and
 * no find is ever lost. The rules test asserts
 * MAX_DISTINCT_MAGIC_ITEMS <= BAG_CAPACITY so a future rung cannot quietly
 * break this.
 *
 * 18 rather than the reference's 12, deliberately: 12 would need a full-bag
 * flow for a case this design makes unreachable. Six columns keeps the
 * reference's width; the third row is the difference.
 *
 * CONSUMABLES ARE NOT BAG ITEMS. `sheet.consumables` (potions, medfoam) keeps
 * its uses and stays the Item verb's list; the inventory screen shows it as a
 * read-only "Usable" line, never in a cell, so it can never compete for space.
 *
 * THE FLAVOUR LIST STAYS. `sheet.inventory: string[]` remains what it is: the
 * plain-words things a character carries, which the DM narrates over. It never
 * holds typed gear, and typed gear never becomes a string there (loot writes
 * only `bag`). The screen shows it read-only as "Also carrying", through
 * menu/equipment.ts's existing `packItems`, which drops the loadout strings
 * the gear rows already name.
 */
export const BAG_COLUMNS = 6;
export const BAG_ROWS = 3;
export const BAG_CAPACITY = BAG_COLUMNS * BAG_ROWS;

/** The most distinct magic items any one archetype can own. Derived from the tables, never typed by hand. */
export const MAX_DISTINCT_MAGIC_ITEMS: number = Math.max(
  ...ARCHETYPE_IDS.map(
    (id) => GEAR_ROLES.reduce((n, role) => n + MAGIC_TIERS.filter((tier) => gearItemExists(id, role, tier)).length, 0),
  ),
);

/** A stable key for one item, used by `itemCharges`. */
export type GearItemKey = `${GearRole}:${EquipmentTier}`;

export function gearItemKey(role: GearRole, tier: EquipmentTier): GearItemKey {
  return `${role}:${tier}`;
}

// ── 11.5 persistence ────────────────────────────────────────────────────

/**
 * THE SHEET, v2. Every field rides in the existing `game_characters.stats`
 * jsonb blob; no migration, no backend change.
 *
 *   equipment?:   Equipment (widened, six roles). After normalisation: weapon,
 *                 outer, crown, boots always present (absent or unknown reads
 *                 as common); ring and amulet present only when worn, never
 *                 with tier "common"; a (role, tier) with no item resolves to
 *                 common (drawn roles) or is dropped (ring, amulet).
 *   bag?:         BagItem[]. Absent reads as []. Normalised per the BAG
 *                 invariants; a duplicate keeps the first; overflow past
 *                 BAG_CAPACITY is truncated (unreachable except by a bad blob).
 *   itemCharges?: Partial<Record<GearItemKey, number>>. ABSENT KEY MEANS FULL,
 *                 exactly like `superiorityDice`. Only saveRescue items have a
 *                 key. Normalised to an integer in 0..charges.
 *   lootLedger?:  LootLedger (see LOOT). Absent reads as no rolls yet.
 *
 * All four are optional on the type and defaulted at the load boundary
 * (normalizeSheet and characterStateFromStats), the pattern every post-launch
 * field of this blob has used. They are SHEET fields, so characterState.ts's
 * destructure needs no change: they ride in `sheetFields` like `equipment`.
 *
 * AN EXISTING THREE-SLOT CAMPAIGN LOADS UNCHANGED: its `equipment` has three
 * keys; boots resolves to common (+0, no attunement, drawn as the plain pair);
 * ring and amulet are empty; bag, charges and ledger are absent and read as
 * empty, full and empty. Not one number on the sheet moves, which the rules
 * lane asserts on a literal v1 blob.
 *
 * SIZE. The backend rejects a stats blob whose JSON.stringify length exceeds
 * LT_MAX_STATS_BYTES (16 * 1024, games-db). Measured on this branch, a fresh
 * level-1 sheet serialises to 1,496 to 1,826 characters across the eight
 * archetypes. v2's worst case, measured with every string at its longest:
 * `equipment` with six legendary entries 279, a `bag` holding all 16
 * possible items 549, `itemCharges` with its one key 33, a `lootLedger` of
 * LOOT_LEDGER_MAX_CELLS cells keyed like "-963,-999" 926: 1,790 characters
 * in total, so a v2 sheet stays under 4 KB, a quarter of the cap. The only
 * unbounded list in the blob is the pre-existing flavour `inventory`
 * (grantsItem strings, 60 characters each), which v2 does not grow.
 */
export const PERSISTENCE_NOTE = "equipment (six roles), bag, itemCharges (absent = full), lootLedger; all optional; v1 blobs load with boots common, the rest empty";

// ── 11.6 loot ───────────────────────────────────────────────────────────

/**
 * LOOT: WHEN IT ROLLS.
 *
 *   "fight"      the site that already awards "That fight is over." in
 *                LivingTable.tsx: the player's own attack downs the last
 *                hostile. Once per fight by construction (the site fires on
 *                the transition to no hostiles). A kill the DM resolves on its
 *                own turn earns no loot, exactly as it earns no milestone
 *                today.
 *   "container"  a SUCCESSFUL Search of a prop whose assetId is in
 *                CONTAINER_PROP_ASSET_IDS for the template, on the same
 *                success that sets `prop.searched`. Once per container by
 *                construction (a searched prop cannot be searched again).
 *
 * ANTI-FARMING, on top of those two: at most LOOT_ROLLS_PER_CELL rolls per
 * cell, fights and containers combined, counted in the sheet's LootLedger.
 * A trigger past the cap makes NO roll and prints LOOT_CAP_LINE. The cap is
 * what stops a paid DM turn that spawns a fresh goblin or a fresh chest in
 * the same room from being a loot tap. The ledger remembers the most recent
 * LOOT_LEDGER_MAX_CELLS cells (oldest key evicted first, which JS object key
 * order makes insertion order for non-integer string keys like "3,-1"). A
 * cell old enough to be evicted has had its containers searched and its fight
 * won already, so re-opening its count only matters if the player pays the DM
 * to restock it, and even then the per-cell cap applies again.
 */
export type LootSource = "fight" | "container";

export const LOOT_ROLLS_PER_CELL = 2;
export const LOOT_LEDGER_MAX_CELLS = 64;

export interface LootLedger {
  /** Loot rolls already made in each cell, keyed by `lootCellKey`. A roll counts whether or not it found anything. */
  rollsByCell: Readonly<Record<string, number>>;
}

export function lootCellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * The single-tile containers a successful Search rolls loot from. Exact
 * assetIds from each template's SPRITES. "chest_open" is excluded (already
 * open); the sci-fi "crate_stack_*" members are excluded (one structure is
 * four props, and four rolls from one stack of crates is the farming the cap
 * exists to stop).
 */
export const CONTAINER_PROP_ASSET_IDS: Readonly<Record<TemplateGenre, readonly string[]>> = Object.freeze({
  fantasy: Object.freeze(["chest"] as const),
  scifi: Object.freeze(["crate"] as const),
});

export function isContainerProp(template: TemplateGenre, assetId: string): boolean {
  return CONTAINER_PROP_ASSET_IDS[template].includes(assetId);
}

/**
 * LOOT: THE ROLL, the same table for both templates and both sources.
 *
 * Step 1, the tier: roll d100 (rules/dice.ts rollDie(100, rng)). The first
 * band whose `upTo` is >= the roll decides it:
 *     1..40   nothing          40%
 *     41..75  uncommon         35%
 *     76..95  rare             20%
 *     96..100 legendary         5%
 *
 * Step 2, the piece: `eligible` is every GearRole, in GEAR_ROLES order, that
 * has an item at that tier (gearItemExists) which the character does NOT
 * already own (not worn at that tier, not in the bag at that tier). Then:
 *     eligible.length >= 2   roll d<eligible.length>; face k picks eligible[k-1]
 *     eligible.length == 1   no second die; that one role
 *     eligible.length == 0   no second die; nothing new (every piece of that
 *                            tier is already owned)
 * The die is sized to what is left rather than a d6 with rerolls or steps,
 * so every face means one real item and the readout never has to explain a
 * skip. Early in a campaign it is a plain d6 (d4 at legendary, where amulet
 * and boots have no rung).
 *
 * Step 3: append { slot, tier } to the END of `bag` (it always fits, see the
 * BAG), and add 1 to the ledger for the cell. A roll that found nothing, or
 * nothing new, still counts against the cell.
 *
 * DETERMINISM. Everything random goes through the injected `rng`, in this
 * order: exactly one call for the d100; exactly one more call for the second
 * die when and only when eligible.length >= 2. So a test that injects
 * [0.87, 0.5] gets d100 = 88 (rare) and, with six eligible roles, d6 = 4
 * (ring): the Ring of Protection.
 */
export interface LootTierBand {
  upTo: number;
  tier: MagicTier | null;
}

export const LOOT_DIE_SIDES = 100;

export const LOOT_TIER_BANDS: readonly LootTierBand[] = Object.freeze([
  Object.freeze({ upTo: 40, tier: null }),
  Object.freeze({ upTo: 75, tier: "uncommon" as const }),
  Object.freeze({ upTo: 95, tier: "rare" as const }),
  Object.freeze({ upTo: 100, tier: "legendary" as const }),
]);

/** One loot roll, as the engine resolved it. Pure data: the loot lane produces it, the screen prints it, the render lane turns it into a readout. */
export interface LootRoll {
  source: LootSource;
  /** The d100 face, 1..100. */
  tierRoll: number;
  /** null when the d100 landed in the nothing band. */
  tier: MagicTier | null;
  /** The roles that could have been found, GEAR_ROLES order. Empty when `tier` is null. */
  eligible: readonly GearRole[];
  /** Sides of the second die. 0 when no second die was rolled (eligible.length < 2). */
  slotDie: number;
  /** The second die's face, or null when it was not rolled. */
  slotRoll: number | null;
  /** What went into the bag, or null for nothing / nothing new. */
  item: BagItem | null;
}

/**
 * THE WORDS, pinned so the log, the readout and their tests agree. `tier` is
 * TIER_WORD lower-cased, `item` is `gearItemName`.
 *
 *   dice log (menu/labels.ts `lootLine`, screen lane):
 *     nothing           Loot: d100 = 23, nothing of value.
 *     slotDie >= 2      Loot: d100 = 88, rare. d6 = 4: Ring of Protection, into your pack.
 *     eligible = 1      Loot: d100 = 88, rare: Ring of Protection, into your pack.
 *     eligible = 0      Loot: d100 = 88, rare, but you already have every rare piece there is.
 *     past the cap      LOOT_CAP_LINE (no dice, because none were rolled)
 *   story line on a find (engine voice):  You find <item>. It is in your pack.
 *   readout overlay: a LootReadout (below) in the existing `.lt-readout` DOM
 *     overlay, caption "<character name>, loot from <source label>", where the
 *     source label is "the fight" or "the <propLabel(prop)>".
 *
 *   the DM's fact line (characters/loot.ts `lootDmNote`, loot lane), queued
 *   through LivingTable.tsx's existing `noteToDm`:
 *     find      the engine rolled loot from <source label>: <item> (<tier>) is now in the player's pack. Narrate the find. The item and its quality are already decided; do not name a different one.
 *     otherwise the engine rolled loot from <source label> and nothing magical turned up. Describe ordinary odds and ends if you like, never a magic item.
 *     past the cap: no note at all.
 */
export const LOOT_CAP_LINE = "Loot: nothing more of value in this area.";

/** The loot popup, beside RollReadout in the same DOM overlay. Built only by render/rollReadoutAdapter.ts's `lootRollToReadout`. */
export interface LootReadout {
  kind: "loot";
  caption: string;
  tierRoll: number;
  /** TIER_WORD[tier], or "Nothing". */
  tierWord: string;
  /** 0 when no second die was rolled. */
  slotDie: number;
  slotRoll: number | null;
  /** The item name, "Nothing of value", or "Nothing new". */
  verdict: string;
}

// ── 11.7 the model is locked out ────────────────────────────────────────

/**
 * THE MODEL IS LOCKED OUT OF GEAR, field by field (loot + DM lane):
 *
 *   1. EQUIPMENT_FORBIDDEN_WIRE_KEYS (grown in v2) is REJECTED, not ignored,
 *      on the turn root, every world action, every assembleCell layout, every
 *      placed prop, every placed token and every roll request.
 *   2. A prop's `grantsItem` that `isMagicGearName` is REJECTED by
 *      validatePlacedProp: "<what>.grantsItem is "<name>", which is a magic
 *      item. Magic items come only from the engine's loot roll, never from a
 *      prop. Grant an ordinary thing (a key, a letter, a coil of rope) or leave
 *      grantsItem out." Common names ("Longsword", "Hood", "Travel Boots")
 *      stay legal: they are ordinary things and land in the flavour list.
 *   3. Defence in depth for cells assembled before rule 2: the Search handler
 *      pushes a grantsItem into `inventory` only when it is NOT a magic gear
 *      name, and silently drops one that is. A grantsItem string NEVER becomes
 *      typed gear under any circumstance; only a LootRoll writes `bag`.
 *   4. gear_* sprite ids stay filtered out of the DM's placeable tokens and
 *      rejected by validatePlacedToken (v1). Props are validated against
 *      manifest.props, and every gear sprite is kind "token", so a gear id
 *      can never be placed as a prop either.
 *   5. The system prompt gains one rule, verbatim:
 *      "- LOOT IS THE ENGINE'S. You never give the player a magic item, never
 *      name one as found, and never decide how good one is. When a fight is
 *      won or a container is searched, the engine rolls loot and tells you
 *      what turned up; narrate that and nothing more. "grantsItem" on a prop
 *      is for ordinary things (a key, a letter, a coil of rope), never a magic
 *      item: a prop whose grantsItem names one is rejected."
 *   6. What the DM SEES: DmCharacterView gains `wearing: string[]`, the
 *      `gearItemName` of every worn piece in GEAR_ROLES order (empty ring or
 *      amulet skipped), rendered as "Wearing: a, b, c" above "Carrying", and
 *      its `inventory` becomes menu/equipment.ts's `packItems(sheet)` so the
 *      loadout is named once ("Keen Longsword" under Wearing, not also
 *      "Longsword" under Carrying). Names only: never a tier word, a bonus, a
 *      charge count or the bag. The bag reaches the DM only as each find's
 *      one fact line.
 */
export function gearNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Every MAGIC gear name in both templates: the uncommon, rare and legendary
 * names of all eight archetype sets, every magic accessory item under both
 * template names, and the SRD's own spelling where it differs
 * ("Stone of Good Luck (Luckstone)", and its alias "Luckstone").
 */
export const MAGIC_GEAR_NAMES: readonly string[] = Object.freeze(
  [
    ...ARCHETYPE_IDS.flatMap((id) => SLOT_ROLES.flatMap((role) => SLOTS_BY_ARCHETYPE[id][role].nameByTier.slice(1))),
    ...ACCESSORY_ROLES.flatMap((role) =>
      MAGIC_TIERS.flatMap((tier) => {
        const item = ACCESSORY_ITEMS[role][tier];
        if (!item) return [];
        return [...GEAR_TEMPLATES.map((t) => item.nameByTemplate[t]), ...(item.srd ? [item.srd.name] : [])];
      }),
    ),
    "Luckstone",
  ].filter((name, i, all) => all.indexOf(name) === i),
);

const MAGIC_GEAR_NAME_KEYS: readonly string[] = Object.freeze(MAGIC_GEAR_NAMES.map(gearNameKey));

/** True when `name`, trimmed, whitespace-collapsed and case-folded, is a magic gear name in either template. */
export function isMagicGearName(name: string): boolean {
  return MAGIC_GEAR_NAME_KEYS.includes(gearNameKey(name));
}

// ── 11.8 sprite ids ─────────────────────────────────────────────────────

/**
 * THE V2 SPRITE ID GRAMMAR. Always BUILD an id with these functions; never
 * parse one. Every id starts with GEAR_ASSET_ID_PREFIX, so the DM's filter and
 * validatePlacedToken already cover all of them, and every one ships as
 * `kind: "token"`, walkable false, so manifestCache routes it into
 * RenderManifest.tokens where the renderer looks. All lower case, single
 * underscores.
 *
 *   boots overlay, per ARCHETYPE, 16x24, drawn on the body:
 *       gear_<archetypeKey>_boots_<base|rare>
 *       gear_knight_boots_base   gear_fireball_person_boots_rare
 *     `base` is the common Travel/Deck Boots, and uncommon is its recolour;
 *     `rare` is its own drawing. No `legendary`: there are no legendary boots.
 *
 *   ring and amulet ICON, per TEMPLATE, 16x16, never drawn on the body:
 *       gear_<template>_ring_<base|rare|legendary>
 *       gear_<template>_amulet_<base|rare>
 *       gear_fantasy_ring_base   gear_scifi_amulet_rare
 *     `base` is drawn once and only ever shown through the uncommon recolour
 *     (there is no common ring or amulet). No legendary amulet.
 *
 *   empty-slot SILHOUETTE, per TEMPLATE, 16x16:
 *       gear_<template>_<ring|amulet>_empty
 *     Only ring and amulet can be empty (every other slot always holds at
 *     least its common piece), so only they need one.
 *
 * Variants follow tierArtVariant exactly as in v1: common and uncommon share
 * `base` (uncommon is RECOLOUR_BY_TIER's remap, no new sprite), rare and
 * legendary are their own drawings. A template name is never an archetype key
 * and a role segment is never shared across grammars, so no two grammars can
 * produce the same string.
 *
 * THE MANIFEST `name` of each new sprite is the item name of the LOWEST tier
 * that sprite draws, under its template: gear_knight_boots_base is "Travel
 * Boots", gear_scifi_ring_base is "Reflex Ring", gear_fantasy_ring_empty is
 * "Empty Ring Slot", gear_scifi_amulet_empty is "Empty Tag Slot".
 *
 * WHAT IS NOT A SPRITE, deliberately:
 *   - an inventory icon for weapon, outer, crown or boots. The render lane
 *     CROPS it from the overlay the doll and the board already draw (same
 *     pixels, same recolour, same rim light; see ICONS below). Justification:
 *     the bag then shows exactly what the doll will wear, with no second
 *     drawing to drift from the first; the v1 overlays are already compact
 *     blocks (a sword 5x16, a shield 6x10, a cloak 12x12, a harness 8x7) that
 *     read on their own; and it saves 96 drawings (8 archetypes x 4 roles x
 *     3 variants) that would each need their own review.
 *   - the frame, the pedestal and the slot boxes. They are CSS and a
 *     procedural raster (see THE DOLL), not asset-library art, because the
 *     library reaches players only when games-db's LIVING_TABLE_TEMPLATES is
 *     regenerated and redeployed in the ConjureOS repo. Chrome that is
 *     invisible until a backend redeploy would leave the screen without its
 *     frame; code ships with the app.
 */
export type BootsArtVariant = "base" | "rare";

export const BOOTS_ART_VARIANTS: readonly BootsArtVariant[] = Object.freeze(["base", "rare"] as const);

export type BootsSpriteId = `gear_${ArchetypeKey}_boots_${BootsArtVariant}`;

export function bootsSpriteId(archetypeId: ArchetypeId, variant: BootsArtVariant): BootsSpriteId {
  return `gear_${ARCHETYPE_KEY[archetypeId]}_boots_${variant}`;
}

/** All 16 boots overlays: 8 archetypes x 2 drawn variants. */
export const BOOTS_SPRITE_IDS: readonly BootsSpriteId[] = Object.freeze(
  ARCHETYPE_IDS.flatMap((id) => BOOTS_ART_VARIANTS.map((v) => bootsSpriteId(id, v))),
);

/** The 8 for one template. */
export function bootsSpriteIdsFor(template: TemplateGenre): readonly BootsSpriteId[] {
  return ARCHETYPE_IDS.filter((id) => TEMPLATE_OF_ARCHETYPE[id] === template).flatMap((id) =>
    BOOTS_ART_VARIANTS.map((v) => bootsSpriteId(id, v)),
  );
}

/** Every sprite that draws ON the body: v1's 72 plus the 16 boots. What EquipmentLayerPlan.spriteId may hold. */
export type DrawnGearSpriteId = EquipmentSpriteId | BootsSpriteId;

export type AccessoryIconSpriteId = `gear_${TemplateGenre}_${SheetOnlyRole}_${ArtVariant}`;

export function accessoryIconSpriteId(template: TemplateGenre, role: SheetOnlyRole, variant: ArtVariant): AccessoryIconSpriteId {
  return `gear_${template}_${role}_${variant}`;
}

/** The drawn variants a sheet-only role actually has, from ACCESSORY_ITEMS: ring base, rare, legendary; amulet base, rare. */
export function accessoryArtVariants(role: SheetOnlyRole): readonly ArtVariant[] {
  return ART_VARIANTS.filter((variant) => EQUIPMENT_TIERS.some((tier) => ACCESSORY_ITEMS[role][tier] !== undefined && tierArtVariant(tier) === variant));
}

/** All 10 ring and amulet icons: 2 templates x (3 ring + 2 amulet). */
export const ACCESSORY_ICON_SPRITE_IDS: readonly AccessoryIconSpriteId[] = Object.freeze(
  GEAR_TEMPLATES.flatMap((t) => SHEET_ONLY_ROLES.flatMap((role) => accessoryArtVariants(role).map((v) => accessoryIconSpriteId(t, role, v)))),
);

export function accessoryIconSpriteIdsFor(template: TemplateGenre): readonly AccessoryIconSpriteId[] {
  return SHEET_ONLY_ROLES.flatMap((role) => accessoryArtVariants(role).map((v) => accessoryIconSpriteId(template, role, v)));
}

export type SlotSilhouetteSpriteId = `gear_${TemplateGenre}_${SheetOnlyRole}_empty`;

export function slotSilhouetteSpriteId(template: TemplateGenre, role: SheetOnlyRole): SlotSilhouetteSpriteId {
  return `gear_${template}_${role}_empty`;
}

/** All 4 silhouettes. */
export const SLOT_SILHOUETTE_SPRITE_IDS: readonly SlotSilhouetteSpriteId[] = Object.freeze(
  GEAR_TEMPLATES.flatMap((t) => SHEET_ONLY_ROLES.map((role) => slotSilhouetteSpriteId(t, role))),
);

export function slotSilhouetteSpriteIdsFor(template: TemplateGenre): readonly SlotSilhouetteSpriteId[] {
  return SHEET_ONLY_ROLES.map((role) => slotSilhouetteSpriteId(template, role));
}

/** EVERY NEW SPRITE ONE ART LANE AUTHORS, and nothing else: 8 boots overlays, 5 icons, 2 silhouettes, 15 in all. */
export function v2GearSpriteIdsFor(template: TemplateGenre): readonly string[] {
  return [...bootsSpriteIdsFor(template), ...accessoryIconSpriteIdsFor(template), ...slotSilhouetteSpriteIdsFor(template)];
}

/**
 * WHAT THE ART LANES MUST KNOW about the 16x16 sprites (icons and
 * silhouettes). They are 16 wide AND 16 tall, so each art test's existing
 * "every gear sprite is TOKEN_HEIGHT tall" check narrows to the overlay ids
 * (EQUIPMENT_SPRITE_IDS + BOOTS_SPRITE_IDS) and gains "every icon and
 * silhouette is 16x16". No pixel in 48..51. Icons are `outlined(fill, false)`
 * with row 0, row 15, column 0 and column 15 left free for the derived rim.
 * The `base` icons use all four GEAR_RAMP indices (the uncommon recolour must
 * bite). A silhouette is one flat fill plus the derived outline, the SAME
 * fill index for both silhouettes of a template, whose Rec709 luminance is
 * between SILHOUETTE_LUMINANCE.min and .max: visible against the slot box, and
 * clearly dimmer than any item's highlight, so it reads as an empty socket
 * rather than as an item. The screen lane's slot-box background keeps its own
 * luminance below SILHOUETTE_LUMINANCE.boxMax so that band stays visible.
 */
export const ICON_ART_NOTE = "16x16; base uses all four GEAR_RAMP indices; silhouettes one flat fill (luminance in band) + outline; no index 48..51";

/** Rec709 luminance, 0..255, the same measure the v1 art tests use. */
export const SILHOUETTE_LUMINANCE = Object.freeze({ min: 40, max: 90, boxMax: 30 });

// ── 11.9 icons, the doll and the pedestal (render lane) ─────────────────

/** What to draw in one slot box or bag cell. Built by `gearIconSource` / `emptySlotIconSource`, drawn by render/gearIcon.ts. */
export type GearIconSource =
  | { kind: "overlay"; spriteId: DrawnGearSpriteId; remap: PaletteRemap | null; glowBands: 0 | 1 | 2 }
  | { kind: "icon"; spriteId: AccessoryIconSpriteId; remap: PaletteRemap | null; glowBands: 0 | 1 | 2 }
  | { kind: "silhouette"; spriteId: SlotSilhouetteSpriteId };

/** The icon for the item at (archetype, role, tier), or null when there is no such item. Pure table lookup. */
export function gearIconSource(archetypeId: ArchetypeId, role: GearRole, tier: EquipmentTier): GearIconSource | null {
  if (!gearItemExists(archetypeId, role, tier)) return null;
  const template = TEMPLATE_OF_ARCHETYPE[archetypeId];
  const remap = RECOLOUR_BY_TIER[template][tier];
  const glowBands = GLOW_BANDS_BY_TIER[tier];
  const variant = tierArtVariant(tier);
  if (isSlotRole(role)) return { kind: "overlay", spriteId: equipmentSpriteId(archetypeId, role, variant), remap, glowBands };
  if (role === "boots") {
    if (variant === "legendary") return null;
    return { kind: "overlay", spriteId: bootsSpriteId(archetypeId, variant), remap, glowBands };
  }
  return { kind: "icon", spriteId: accessoryIconSpriteId(template, role, variant), remap, glowBands };
}

export function emptySlotIconSource(template: TemplateGenre, role: SheetOnlyRole): GearIconSource {
  return { kind: "silhouette", spriteId: slotSilhouetteSpriteId(template, role) };
}

/**
 * ICONS, the pinned crop rule (render lane, render/gearIcon.ts):
 *
 *   crop     the bounding box of every pixel that is not TRANSPARENT (-1),
 *            outline pixels included, grown by `glowBands` on every side so
 *            the rim light fits (0 for a silhouette)
 *   scale    clamp(floor(cellPx / max(tightW, tightH)), 1, GEAR_ICON_MAX_SCALE),
 *            where tightW / tightH are the item's OWN opaque bounding box,
 *            NOT grown by glowBands, and cellPx is the square's side in CSS
 *            pixels. The glow growth only ever moves the placement; it must
 *            never shrink the item (sizing from the grown crop drew a rare
 *            or legendary piece at half the scale of the same silhouette at
 *            common or uncommon). A rim that does not fit at that scale
 *            yields at the box edge, the item does not.
 *   place    offsetX = floor((cellPx - cropW * scale) / 2), same for Y, where
 *            cropW / cropH are the glow-grown crop above
 *   paint    the sprite with its remap (remappedIndex, so protected indices
 *            survive), then the rim light from the compositor's own glow
 *            raster for that one sprite at frame 0, under it, exactly as the
 *            board would draw it. A silhouette gets neither.
 *   canvas   backing store equals CSS size, `image-rendering: pixelated`,
 *            devicePixelRatio NOT multiplied in (the rule displayScale in
 *            LivingTable.tsx already set for the board).
 *   missing  a sprite id absent from the manifest draws nothing and returns
 *            false; the screen then shows the item's name (or, for an empty
 *            slot, the slot word) as text in the box. This is the state until
 *            games-db serves the v2 sprites, and it must read as a finished
 *            screen, not a broken one.
 */
export const GEAR_ICON_MAX_SCALE = 4;

export interface IconPlacement {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * THE DOLL: the real composited token (renderPlanFor of the STAGED loadout,
 * so a staged change shows on the doll before Ok) on a pixel pedestal, drawn
 * into a square DOLL_CANVAS_SIZE source-pixel raster at an integer scale.
 *
 *   token      drawn with the compositor at DOLL_TOKEN_ORIGIN, glow frame 0
 *   pedestal   drawn FIRST, so the feet and contact shadow stand on it.
 *              Source pixel (x, y) is inside when
 *                ((x + 0.5 - cx) / rx)^2 + ((y + 0.5 - cy) / ry)^2 <= 1
 *              with PEDESTAL's numbers (rows 25..30, columns 4..27). Band 1
 *              is every inside pixel with a 4-neighbour outside, painted
 *              palette index 25; band 2 is every other inside pixel with a
 *              4-neighbour in band 1, painted palette index 27; the interior
 *              stays transparent. 25 and 27 are the shade and lit steps of
 *              the neutral structural ramp both templates lay at 24..27
 *              (ROCK_SHADE / ROCK_LIT in fantasy.ts, MESH_SHADE / MESH_LIT
 *              in scifi.ts), exported as PEDESTAL_INDEX_OUTER / _INNER from
 *              render/doll.ts, so the pedestal reads as a stone or deck disc
 *              in either template. It NEVER paints GLOW_INDEX_A/B: those
 *              stay exclusively the worn item's own enchantment signal (a
 *              pedestal in the glow hue made a rare and a legendary rim run
 *              straight into the stage's trim and read alike on the doll).
 *              It never pulses.
 *   scale      clamp(floor(availableCssWidth / DOLL_CANVAS_SIZE),
 *              DOLL_MIN_SCALE, DOLL_MAX_SCALE); the canvas width, height and
 *              CSS size are all DOLL_CANVAS_SIZE * scale; no
 *              devicePixelRatio, same rule as the board. At 390 CSS px the
 *              doll gets 206 px and draws at 6 (192 px), the 16x24 figure at
 *              96x144.
 *   missing    no body sprite: the pedestal alone, never a crash.
 */
export const DOLL_CANVAS_SIZE = 32;
export const DOLL_TOKEN_ORIGIN = Object.freeze({ x: 8, y: 4 });
export const PEDESTAL = Object.freeze({ cx: 16, cy: 28, rx: 12, ry: 3 });
export const DOLL_MIN_SCALE = 4;
export const DOLL_MAX_SCALE = 8;

// ── 11.10 the screen (screen lane) ──────────────────────────────────────

/**
 * THE INVENTORY SCREEN, layout first because the owner plays on an iPhone.
 *
 * PRESENTATION. A modal panel over the play screen (role="dialog",
 * aria-modal), full-bleed on a phone with the page's 16 px side gutter, a
 * centred panel capped at 480 CSS px wide on desktop. Opened from an
 * "Inventory" button beside "Character sheet" in the composer bar, and from
 * the character sheet's gear section. Free: no CostBadge, anywhere.
 *
 *   ┌ title bar ── <INVENTORY_TITLE_BY_TEMPLATE> ─────── Attuned: n of 3  [x] ┐
 *   │ [weapon]                                             [crown]            │
 *   │ [outer ]            (the doll on its pedestal)       [amulet]           │
 *   │ [ring  ]                                             [boots ]           │
 *   │ detail panel: the selected item or slot                                 │
 *   │ bag: 6 columns x 3 rows                                                 │
 *   │ Usable: ...   Also carrying: ...                                        │
 *   │ [ Cancel ]                                   [   Ok   ]                 │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * The frame is CSS in the game's existing FF window vocabulary: a hard 2 px
 * light border inside a 2 px dark one, square corners, a flat dark panel, the
 * title in the existing heading face. No gradients, no blur, no rounded
 * corners inside the frame, no painted texture: the reference's LAYOUT, not
 * its look.
 *
 * SLOT PLACEMENT, identical on phone and desktop: INVENTORY_LAYOUT's two
 * columns flank the doll, ordered roughly by where each thing sits on a body
 * (head and hand high, feet low). At 390 CSS px: 390 - 2 x 16 gutter - 2 x 12
 * frame padding = 334 of content; 56 + 8 + 206 + 8 + 56 = 334, so each slot
 * box is 56 px and the doll gets 206 (scale 6, 192 px), which also matches
 * three stacked boxes (3 x 56 + 2 x 8 = 184) within a few pixels. Bag cells:
 * (334 - 5 x 4) / 6 = 52 px. Every tap target is at least 44 px.
 *
 * INTERACTION (tap, never hover; no drag):
 *   - Tap a BAG cell: it is selected; the slot box it fits glows (CSS
 *     outline in the rarity colour plus the selection ring); the detail panel
 *     shows name + rarity chip, "Fits: <slot word>", the effect sentence, the
 *     attunement line, and, when that slot holds something, "Replaces <worn
 *     name>: <worn effect sentence>". One button: Equip. When staging would
 *     break the attunement cap, Equip is disabled and the refusal
 *     (attunementFullReason) is printed under it.
 *   - Tap a SLOT box: it is selected; the detail panel shows the worn piece.
 *     A magic piece gets one button, Unequip (it goes to the end of the bag;
 *     the common piece returns, or a ring or amulet slot empties). A common
 *     piece gets no button and the line "Your own <name>. It is what you wear
 *     when nothing better is on." An empty ring or amulet slot reads "No
 *     <slot word, lower case> worn." and, when the bag holds one that fits,
 *     lists them as tappable rows.
 *   - Tap the selected thing again, or tap empty panel space: deselect.
 *   - Equip swaps IN PLACE: the incoming item leaves its bag cell and the
 *     outgoing magic piece takes that same cell, so the grid never jumps.
 *     When the outgoing piece is common (or the slot was empty), the cell is
 *     removed and later cells shift left.
 *
 * STAGING. Opening the screen takes a LoadoutDraft of the sheet. Equip and
 * Unequip change only the draft; the doll redraws from the draft; the board
 * keeps drawing the committed sheet. Ok commits with `commitLoadout` (which
 * writes only `equipment` and `bag`, onto the CURRENT sheet, so a DM turn
 * that landed meanwhile loses nothing) and persists through the existing
 * write queue; Cancel and the title bar's x discard the draft. When
 * `gearChangeBlockedReason` returns a reason, the screen is READ-ONLY: the
 * reason is shown under the title, Equip and Unequip are not rendered, and
 * the footer is a single Close button.
 *
 * RARITY WITHOUT COLOUR ALONE. Three independent cues, colour only ever
 * reinforcing: (1) the WORD, TIER_WORD, on the detail panel's chip (the
 * restored `.lt-rarity--<tier>` rules) and in every box's accessible name,
 * "<name>, <tier word>, fits <slot word>"; (2) PIPS, RARITY_PIPS small square
 * marks in each box's top-right corner, so rank is a count you can see
 * without hue; (3) the rim light's own shape: none at common, one band at
 * uncommon, two at rare and legendary. The box border takes the tier colour
 * as a fourth, redundant cue.
 *
 * ISSUE #15, WHAT COMES BACK. Loot is the engine-owned grant #15 waited for,
 * so the ladder is climbable and its surface returns:
 *   RESTORED  the rarity chip on every gear row of the character sheet (now
 *             six rows, GEAR_ROLES order) and on the inventory detail panel;
 *   RESTORED  the "rarity" glossary entry in menu/labels.ts, reworded for four
 *             ranks with their pips; a new "attunement" entry beside it;
 *   RESTORED  the `.lt-rarity*` styles, used by both chips;
 *   CHANGED   `equippableTiers(sheet, role)` answers with every tier the
 *             character OWNS for that role (common for drawn roles, the worn
 *             tier, each bagged tier), ladder order; the screen's compare
 *             line reads it, and its comment stops describing a hidden
 *             surface;
 *   REPLACED  the tier picker and its `gearOptions` / `onEquip` props. The
 *             inventory screen is the one place gear changes, with staging;
 *             a second, unstaged writer of `sheet.equipment` on the sheet
 *             panel would be two equip models for one sheet. The panel gains
 *             `onOpenInventory?: (role?: GearRole) => void` instead, which
 *             opens the screen with that slot selected;
 *   UNUSED    `.lt-gear-options` / `.lt-gear-option*` stay in styles.css,
 *             untouched, their comment updated to say the inventory screen
 *             superseded the picker. Deleting them is the owner's call.
 */
export const INVENTORY_LAYOUT = Object.freeze({
  phoneWidthCssPx: 390,
  pageGutterCssPx: 16,
  framePaddingCssPx: 12,
  slotBoxCssPx: 56,
  columnGapCssPx: 8,
  bagGapCssPx: 4,
  minTouchCssPx: 44,
  desktopMaxWidthCssPx: 480,
  leftColumn: Object.freeze(["weapon", "outer", "ring"] as const) as readonly GearRole[],
  rightColumn: Object.freeze(["crown", "amulet", "boots"] as const) as readonly GearRole[],
});

/** The rarity WORD, the one colour-blind-safe carrier of rank. menu/equipment.ts's RARITY_WORD may re-export this; the two must never differ. */
export const TIER_WORD: Readonly<Record<EquipmentTier, string>> = Object.freeze({
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
});

/** Pip marks per tier: rank as a count, legible with no hue at all. */
export const RARITY_PIPS: Readonly<Record<EquipmentTier, 0 | 1 | 2 | 3>> = Object.freeze({
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
});

export const INVENTORY_TITLE_BY_TEMPLATE: Readonly<Record<TemplateGenre, string>> = Object.freeze({
  fantasy: "Pack and Gear",
  scifi: "Loadout",
});

/** The slot word for the three v2 roles. The three v1 roles keep menu/equipment.ts's `slotLabelFor`, which names them per archetype off `bonusKind`. */
export const ACCESSORY_SLOT_WORD: Readonly<Record<TemplateGenre, Readonly<Record<AccessoryRole, string>>>> = Object.freeze({
  fantasy: Object.freeze({ ring: "Ring", amulet: "Amulet", boots: "Boots" }),
  scifi: Object.freeze({ ring: "Ring", amulet: "Tag", boots: "Boots" }),
});

/**
 * THE EFFECT SENTENCES for accessory items (screen lane builds them from the
 * item's effect data, never from a hard-coded number, and the menu test
 * asserts every magnitude in the table appears in its sentence):
 *   protection      +<amount> armour class and +<amount> on every saving throw.
 *   luck            +<amount> on every skill check and every saving throw.
 *   skillAdvantage  Advantage on <skill> checks: roll two d20s and keep the higher.
 *   speedMultiplier Double walking speed in a fight: <base> feet becomes <base * factor>.
 *                   (<base> is this character's effectiveSpeedFt without the
 *                   boots; "Double" is the word for factor 2, the only factor
 *                   EFFECT_BOUNDS allows)
 *   hitDieHealingMultiplier  Every hit die you spend to catch your breath heals twice as much.
 *                   ("twice" is the word for factor 2, same reason)
 *   saveRescue      When you fail a <Ability> saving throw, a charge turns it into a success. <charges> charges; a long rest brings back <rechargeDice>.
 *   restRegeneration  Every time you catch your breath, the ring also restores <dice> hit points.
 *   (common boots)  No effect. These are the boots you started in.
 * And the dice-log lines those effects print when they fire:
 *   advantage   CheckLineInput gains `advantageFrom?: string`; checkLine then
 *               reads "rolled 17 with advantage from Boots of Elvenkind, +5 = 22, ..."
 *   saveRescue  a second line after the failed save's own line:
 *               "<item>: the failed <Ability> save becomes a success. <n> of <max> charges left."
 *               and the ResolvedRoll reported to the DM carries success: true.
 *   recharge    appended to the long rest note:
 *               " <item> regains <k> charges (<rechargeDice> rolled <k>): <n> of <max>."
 *   regeneration appended to the short rest note:
 *               " <item>: <total> more hit points (<dice> rolled <total>)."
 */
export const EFFECT_COPY_NOTE = "copy is built from effect data; every magnitude appears in its sentence";

// ── 11.11 the cross-lane API ────────────────────────────────────────────

/**
 * THE CROSS-LANE API. Exact names and shapes. The function TYPES below let a
 * lane pin its own implementation with `satisfies`, so a drifted signature is
 * a compile error in the implementing lane rather than a runtime surprise in
 * the calling one. Signatures that need CharacterSheet or CheckResult are
 * written out in prose instead, to keep this file free of imports from the
 * modules that import it.
 *
 * RULES LANE, characters/inventory.ts (new; as built, rules/inventory.ts and rules/attunement.ts):
 *   draftFromSheet, stageEquip, stageUnequip, attunedRoles,
 *   gearChangeBlockedReason, commitLoadout (types below), plus
 *   normalizeBag(value: unknown, archetypeId: string, equipment: Equipment): BagItem[]
 * RULES LANE, characters/equipment.ts:
 *   normalizeEquipment(value: unknown): Equipment   (now six roles, STARTING_LOADOUT defaults)
 *   equipmentOf(sheet): Equipment                   (now six roles)
 *   equipmentStatus / equipmentIssues / bonus readers extended to all six roles,
 *   honouring attunement (an unattuned attunement item is inactive, with a reason)
 * RULES LANE, session/combat.ts (existing names, new addends):
 *   effectiveArmorClass(sheet)       + protection, inside MAX_TOTAL_AC_BONUS
 *   saveModifierFor(sheet, ability)  + protection + luck, inside MAX_TOTAL_SAVE_BONUS
 *   skillModifierFor(sheet, skill)   + luck, inside MAX_TOTAL_CHECK_BONUS
 *   effectiveSpeedFt(sheet)          x speedMultiplier, after the armour penalty
 *   checkAdvantageFor(sheet: CharacterSheet, skill: string): string | null
 *       the NAME of the worn, attuned-or-attunement-free item granting
 *       advantage on that skill, or null
 *   checkBonusSourcesFor(sheet: CharacterSheet, skill: string): readonly BonusSource[]
 *       sums exactly to skillModifierFor(sheet, skill)
 *   evasionRescue(sheet: CharacterSheet, ability: keyof AbilityScores, result: CheckResult)
 *       : { sheet: CharacterSheet; result: CheckResult; note: string } | null
 *       null unless the save FAILED, the ability matches, the item is worn
 *       and attuned, and a charge remains; otherwise success: true, one
 *       charge spent, `note` is the pinned dice-log line
 * RULES LANE, characters/health.ts:
 *   shortRest(sheet, rng)  applies hitDieHealingMultiplier, then restRegeneration
 *   longRest(sheet, rng = Math.random)  gains the optional rng, recharges saveRescue
 *
 * LOOT + DM LANE, characters/loot.ts (new; as built, rules/loot.ts):
 *   lootFor, lootDmNote (types below)
 *
 * RENDER LANE:
 *   render/doll.ts      renderDoll(ctx, plan: TokenRenderPlan | null, manifest: RenderManifest, scale: number): void
 *                       pedestalBands(): { band1: boolean[][]; band2: boolean[][] }   (pure, 32x32, for tests)
 *   render/gearIcon.ts  iconPlacement(pixels: SpriteGrid, glowBands: 0 | 1 | 2, cellPx: number): IconPlacement   (pure)
 *                       renderGearIcon(ctx, source: GearIconSource, manifest: RenderManifest, cellPx: number): boolean
 *   render/rollReadoutAdapter.ts
 *                       lootRollToReadout(roll: LootRoll, itemName: string | null, caption: string): LootReadout
 *
 * SCREEN LANE:
 *   menu/equipment.ts   renderPlanFor(sheet) includes the boots layer
 *                       (bootsSpriteId, LAYER_FEET, RECOLOUR_BY_TIER, glow by
 *                       tier); gearView covers six roles; equippableTiers as
 *                       described under THE SCREEN
 *   menu/labels.ts      lootLine(roll: LootRoll, itemName: string | null): string
 *                       CheckLineInput.advantageFrom; the "rarity" and
 *                       "attunement" glossary entries
 */
export interface GearSheet {
  archetypeId: string;
  equipment?: Equipment;
  bag?: readonly BagItem[];
}

export interface LoadoutDraft {
  equipment: Equipment;
  bag: readonly BagItem[];
}

export type StageOutcome = { ok: true; draft: LoadoutDraft } | { ok: false; reason: string };

/** A normalised copy of the sheet's equipment and bag, for the screen to stage against. */
export type DraftFromSheetFn = (sheet: GearSheet) => LoadoutDraft;
/** Equip bag[bagIndex] into the slot it fits, swapping in place (see THE SCREEN). Refuses past the attunement cap with `attunementFullReason`. */
export type StageEquipFn = (archetypeId: string, draft: LoadoutDraft, bagIndex: number) => StageOutcome;
/** Take off the magic piece in `role`: it goes to the end of the bag; the common piece returns, or ring/amulet empties. Refuses a common or empty slot. */
export type StageUnequipFn = (archetypeId: string, draft: LoadoutDraft, role: GearRole) => StageOutcome;
/** The worn roles whose item requires attunement, GEAR_ROLES order, first MAX_ATTUNED_ITEMS only. */
export type AttunedRolesFn = (archetypeId: string, equipment: Equipment) => readonly GearRole[];
/** GEAR_CHANGE_BLOCKED's words, or null when gear may change. */
export type GearChangeBlockedReasonFn = (
  who: { name: string; downed: boolean; stable: boolean; dead: boolean },
  hostilesPresent: boolean,
) => string | null;
/**
 * Write the draft's equipment and bag onto `sheet` and nothing else. Returns
 * `sheet` UNCHANGED (same object) when the draft does not hold exactly the
 * same set of owned magic items as the sheet, breaks a BAG invariant, or
 * wears more than MAX_ATTUNED_ITEMS attunement items: staging moves items, it
 * never creates or destroys one.
 */
export type CommitLoadoutFn = <S extends GearSheet>(sheet: S, draft: LoadoutDraft) => S;

export interface LootSheet extends GearSheet {
  lootLedger?: LootLedger;
}

export interface LootAt {
  source: LootSource;
  cx: number;
  cy: number;
}

/**
 * Roll loot for one trigger, per LOOT. `roll` is null when the cell's cap was
 * already reached, and then `sheet` is returned unchanged (same object).
 * Otherwise the returned sheet has the ledger bumped and, on a find, the item
 * appended to `bag`. Never touches `inventory`, `equipment` or anything else.
 */
export type LootForFn = <S extends LootSheet>(sheet: S, at: LootAt, rng?: () => number) => { sheet: S; roll: LootRoll | null };
/** The DM fact line, verbatim from the LOOT words. */
export type LootDmNoteFn = (roll: LootRoll, itemName: string | null, sourceLabel: string) => string;

// ── 11.12 the invariants each lane owns a test for (v2) ─────────────────

/**
 * rules lane
 *   - every ACCESSORY_ITEMS entry: role and tier match its keys; effect
 *     inside EFFECT_BOUNDS; requiresAttunement === (srd?.attunement ?? false)
 *   - MAX_DISTINCT_MAGIC_ITEMS <= BAG_CAPACITY
 *   - a literal v1 blob (three equipment keys, no bag) loads with boots
 *     common, ring and amulet empty, bag [], and every number unchanged
 *   - staging never creates or destroys an owned item, never produces a
 *     duplicate, a common or a worn item in the bag, and never exceeds
 *     MAX_ATTUNED_ITEMS; a fourth is refused with attunementFullReason
 *   - each accessory effect moves exactly its own reader by exactly its
 *     amount, and nothing else; every cap binds where it says it does
 *   - no gear number is readable from any DM-supplied field
 * loot + DM lane
 *   - band edges: 40 -> nothing, 41 -> uncommon, 75, 76, 95, 96, 100
 *   - rng consumption is 1 or 2 calls, exactly as pinned
 *   - never grants an owned item; never lands on an empty rung
 *   - LOOT_ROLLS_PER_CELL holds across sources; past it, no rng call at all
 *   - every forbidden key is rejected at the turn root, on an action, a
 *     layout, a prop, a token and a roll request; a magic grantsItem is
 *     rejected and a common one accepted
 *   - the prompt never contains a tier word, a bonus or a bag item
 * render lane
 *   - the boots layer sorts between the body and LAYER_OVERBODY
 *   - pedestalBands matches the pinned formula (rows 25..30, cols 4..27)
 *   - iconPlacement's crop, scale clamp and centring, including glow growth
 *   - a missing icon sprite returns false and draws nothing
 * art lanes, each on its own file
 *   - v2GearSpriteIdsFor(template) exist exactly once each, kind "token"
 *   - overlays 16x24, icons and silhouettes 16x16, no pixel in 48..51
 *   - BOOTS_ART_NOTE and ICON_ART_NOTE, measured
 * screen lane
 *   - no CostBadge on the inventory screen, the loot lines or the sheet's
 *     gear rows
 *   - every accessory effect sentence contains its magnitudes
 *   - lootLine matches the pinned words for all five cases
 *   - every box's accessible name carries the tier WORD
 *   - Cancel leaves the sheet deep-equal to before; Ok writes only
 *     equipment and bag
 */
export const CONTRACT_VERSION = 2;
