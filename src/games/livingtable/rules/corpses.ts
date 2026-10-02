/**
 * WHAT A CREATURE CARRIES, AND ITS BODY.
 *
 * Pure rules for two things the table needs: (1) what a LIVE creature has on
 * it, so a pickpocket knows what there is to lift, and (2) the BODY a slain
 * creature leaves, which can be looted (and, for a beast, harvested).
 *
 * Where the contents come from:
 *  - Manufactured weapons: read off the bestiary's attack names. Natural
 *    attacks (Bite, Claw, Slam, Gore, Beak, Pseudopod, Life Drain, Rock...)
 *    are body parts, not possessions, so they are never emitted.
 *  - Armor and shield: read off the bestiary's `acNote` ("leather armor,
 *    shield"). "natural armor" is skin, not gear, and is never emitted.
 *  - Coins: OUR OWN simple rule, because SRD 5.1 has no treasure tables. A
 *    creature that carries at least one manufactured item (and is not undead
 *    or a machine) has a purse sized by challenge rating: CR 1/4 or less, 2
 *    to 12 copper; CR 1/2 to 1, 2 to 12 silver; CR 2 to 3, 2 to 16 gold; CR 4
 *    to 5, 5 to 30 gold; CR 6 and up, 20 to 100 gold. A flat uniform pick in
 *    that range, from the injected rng.
 *  - A trinket: our own short table (a bone die, a tin whistle, a love
 *    letter...), a one in three chance for creatures that have a purse.
 *    Undead instead may carry burial tatters and a grave token.
 *  - Beasts carry nothing at all. Their body can be harvested instead.
 *
 * HONESTY (equipmentTypes.ts rule 7): every note states what the thing is and
 * roughly what it is worth, and never implies an effect the engine does not
 * apply. Coins say the game does not track money.
 *
 * The ENGINE's own loot roll (rules/loot.ts `lootFor`, with its per-room
 * ledger) is NOT done here. `BodyState.engineLootRolled` only records that
 * the caller has already made it for this body; the bench calls `lootFor`
 * when the body is looted.
 *
 * Everything here is pure. Randomness comes only from an injectable `rng`
 * (a function returning [0, 1)); the default is Math.random for callers that
 * do not care about determinism. rng call order is fixed per creature, so a
 * seeded rng gives the same result every time.
 */
import { BESTIARY, beastById } from "./bestiary";
import type { Beast } from "./bestiary";

/** One thing a creature carries or a body holds. */
export interface CarriedItem {
  name: string;
  /** One plain line: what it is and roughly its worth. */
  note: string;
  kind: "weapon" | "armor" | "coins" | "trinket" | "part";
  /** Small enough to pickpocket. Armor and body parts never are. */
  pocketable: boolean;
}

/** What a slain creature leaves behind. Treat it as immutable; every function here returns a new one. */
export interface BodyState {
  id: string;
  name: string;
  at: { x: number; y: number };
  items: CarriedItem[];
  /** True once the body has been emptied. */
  looted: boolean;
  /** True once a harvest has been attempted successfully (the caller sets it; see `harvestFor`). */
  harvested: boolean;
  /** A beast: carries no gear, and can be harvested. */
  beast: boolean;
  /** The caller has already made the engine's own loot roll (rules/loot.ts `lootFor`) for this body. */
  engineLootRolled: boolean;
}

type Rng = () => number;

// ── tables of our own ───────────────────────────────────────────────────

interface Template {
  name: string;
  note: string;
  kind: CarriedItem["kind"];
  pocketable: boolean;
}

function weapon(name: string, note: string, pocketable = false): Template {
  return { name, note, kind: "weapon", pocketable };
}

function armor(name: string, note: string): Template {
  return { name, note, kind: "armor", pocketable: false };
}

/**
 * Manufactured weapons by lower-case bestiary attack name. Prices are the SRD
 * 5.1 equipment list's, quoted as "new"; carried gear is worn, so the note
 * says it would fetch less. A weapon not in this table is not emitted: better
 * to carry nothing than to invent an item.
 */
const WEAPONS: Readonly<Record<string, Template>> = {
  scimitar: weapon("Scimitar", "A curved one-handed blade, nicked and worn. About 25 gp new, less as it is."),
  shortsword: weapon("Shortsword", "A short, straight blade, pitted from use. About 10 gp new, less as it is."),
  longsword: weapon("Longsword", "A one-handed blade with a long, straight edge. About 15 gp new, less as it is."),
  dagger: weapon("Dagger", "A small knife-blade, easy to hide. About 2 gp new.", true),
  spear: weapon("Spear", "A wooden shaft with a metal point. About 1 gp new."),
  javelin: weapon("Javelin", "A light throwing spear. About 5 sp each new."),
  club: weapon("Club", "A plain length of hard wood, shaped to the hand. About 1 sp."),
  "heavy club": weapon("Heavy club", "A thick, knobbed club that takes two hands to swing well. About 2 sp."),
  greatclub: weapon("Greatclub", "A huge knotted club, more a tree limb than a weapon. About 2 sp."),
  greataxe: weapon("Greataxe", "A big two-handed axe with a broad blade. About 30 gp new, less as it is."),
  morningstar: weapon("Morningstar", "A spiked metal head on a short haft. About 15 gp new, less as it is."),
  shortbow: weapon("Shortbow", "A small bow for short, quick shots. About 25 gp new, less as it is."),
  longbow: weapon("Longbow", "A tall bow built for distance. About 50 gp new, less as it is."),
  "light crossbow": weapon("Light crossbow", "A light crossbow with a cocking lever. About 25 gp new, less as it is."),
  sling: weapon("Sling", "A leather strap for hurling stones. About 1 sp.", true),
  "spiked shield": weapon("Spiked shield", "A shield with a spike set in its face. About 10 gp new, less as it is."),
  "scavenged sidearm": weapon(
    "Scavenged sidearm",
    "A battered, patched-up pistol of unknown make. Worth a few gp to a scrapper. The game has no rules for firing it; the DM rules on it.",
  ),
};

/** Armor and shield by lower-case `acNote` piece. "natural armor" is deliberately absent: it is skin. */
const ARMORS: Readonly<Record<string, Template>> = {
  "leather armor": armor("Leather armor", "Boiled-leather body armor, scuffed and sweat-stained. About 10 gp new, less as it is."),
  "studded leather": armor("Studded leather", "Leather armor reinforced with rivets. About 45 gp new, less as it is."),
  "hide armor": armor("Hide armor", "Crude armor of thick animal hides. About 10 gp new, less as it is."),
  "chain mail": armor("Chain mail", "A shirt of interlocking metal rings. About 75 gp new, less as it is."),
  shield: armor("Shield", "A sturdy shield, dented and scarred. About 10 gp new, less as it is."),
  "armor scraps": armor("Armor scraps", "Rusted, rotting bits of armor that barely hang together. Worth next to nothing."),
  "patched leather armor": armor("Patched leather armor", "A scavenger's jacket of stitched and glued leather. About 10 gp new, less as it is."),
};

/** Attack names that are body parts. Listed so the intent is on the page; anything not in WEAPONS is skipped either way. */
const NATURAL_ATTACKS: readonly string[] = [
  "bite", "claw", "claws", "slam", "gore", "beak", "pseudopod", "blood drain", "life drain", "tail spike", "rock",
];

const TRINKETS: readonly { name: string; note: string }[] = [
  { name: "Bone die", note: "A six-sided die carved from bone, well rolled. Worth a copper or two." },
  { name: "Tin whistle", note: "A cheap tin whistle with a dented mouthpiece. Worth a few copper." },
  { name: "Love letter", note: "A folded, much-handled letter in an unsteady hand. Worth nothing to a buyer, something to somebody." },
  { name: "Chipped whetstone", note: "A palm-sized sharpening stone worn into a dip. Worth a copper." },
  { name: "Lucky rabbit's foot", note: "A dried rabbit's foot on a thong, greasy from handling. Worth a copper." },
  { name: "Bent key", note: "A small iron key, bent at the bow. It opens something, somewhere. Worth a copper." },
  { name: "Pocket mirror", note: "A scrap of polished metal in a wooden frame. Worth a few silver." },
  { name: "Carved wooden bead", note: "A bead carved with a tiny spiral. Worth a copper." },
  { name: "Pressed flower", note: "A dried flower flattened inside a scrap of cloth. Worth nothing, kept anyway." },
  { name: "Greasy deck of cards", note: "A thin deck of hand-painted cards, a few missing. Worth a few silver." },
];

const GRAVE_TOKEN: Template = {
  name: "Grave token",
  note: "A small tarnished disc that was laid with a body at burial. Worth a silver to a collector.",
  kind: "trinket",
  pocketable: true,
};

const BURIAL_TATTERS: Template = {
  name: "Burial tatters",
  note: "Rotted rags that once were a shroud or clothes. Worthless.",
  kind: "trinket",
  pocketable: false,
};

// ── who is who ──────────────────────────────────────────────────────────

/** What the carry rules read, from a bestiary entry or a token without one. */
interface Profile {
  id: string;
  name: string;
  type: string;
  cr: string;
  weaponKeys: string[];
  armorKeys: string[];
  /** Bodiless undead (ghost-like): nothing to bury, nothing to carry. */
  incorporeal: boolean;
}

/**
 * Tokens the game fights with that have no bestiary entry. Pinned to
 * MONSTER_STATBLOCKS names by the test. The Raider is the sci-fi Bandit
 * (leather armor, a sidearm); the Combat Drone is a machine and carries nothing.
 */
const TOKEN_PROFILES: Readonly<Record<string, Profile>> = {
  token_raider: {
    id: "token_raider", name: "Raider", type: "humanoid (any race)", cr: "1/8",
    weaponKeys: ["scavenged sidearm"], armorKeys: ["patched leather armor"], incorporeal: false,
  },
  token_drone: {
    id: "token_drone", name: "Combat Drone", type: "construct", cr: "1/4",
    weaponKeys: [], armorKeys: [], incorporeal: false,
  },
};

const INCORPOREAL_IDS: ReadonlySet<string> = new Set(["specter", "wraith"]);

function normName(s: string): string {
  return s.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function profileOfBeast(b: Beast): Profile {
  const weaponKeys: string[] = [];
  for (const a of b.attacks) {
    const key = normName(a.name);
    if (NATURAL_ATTACKS.includes(key)) continue;
    if (WEAPONS[key] && !weaponKeys.includes(key)) weaponKeys.push(key);
  }
  const armorKeys: string[] = [];
  for (const piece of (b.acNote ?? "").split(",")) {
    const key = normName(piece);
    if (key === "shield" && weaponKeys.includes("spiked shield")) continue; // the same object
    if (ARMORS[key] && !armorKeys.includes(key)) armorKeys.push(key);
  }
  return {
    id: b.id, name: b.name, type: b.type, cr: b.cr,
    weaponKeys, armorKeys, incorporeal: INCORPOREAL_IDS.has(b.id),
  };
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** A bestiary entry, a bestiary id, a manifest token id ("token_goblin"), or a name. Unknown strings carry nothing. */
function profileOf(x: Beast | string): Profile {
  if (typeof x !== "string") return profileOfBeast(x);
  const raw = x.trim();
  const lower = raw.toLowerCase();
  const byId = beastById(lower);
  if (byId) return profileOfBeast(byId);
  const byToken = BESTIARY.find((b) => b.tokenAssetId === lower);
  if (byToken) return profileOfBeast(byToken);
  const profile = TOKEN_PROFILES[lower];
  if (profile) return profile;
  const byName = BESTIARY.find((b) => b.name.toLowerCase() === lower);
  if (byName) return profileOfBeast(byName);
  return {
    id: lower, name: titleCase(lower.replace(/^token_/, "")) || "Creature", type: "unknown", cr: "0",
    weaponKeys: [], armorKeys: [], incorporeal: false,
  };
}

function isBeastType(type: string): boolean {
  return /^beast\b/.test(type);
}

function isUndeadType(type: string): boolean {
  return /^undead\b/.test(type);
}

// ── helpers ─────────────────────────────────────────────────────────────

function pick01(rng: Rng): number {
  const r = rng();
  return Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999999) : 0;
}

function intIn(min: number, max: number, rng: Rng): number {
  return min + Math.floor(pick01(rng) * (max - min + 1));
}

function fresh(t: Template): CarriedItem {
  return { name: t.name, note: t.note, kind: t.kind, pocketable: t.pocketable };
}

function crValue(cr: string): number {
  const frac = /^(\d+)\/(\d+)$/.exec(cr);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(cr);
  return Number.isFinite(n) ? n : 0;
}

const COPPER_VALUE: Readonly<Record<string, number>> = { copper: 1, silver: 10, gold: 100 };

/** Our own purse rule by CR (see the file header). SRD 5.1 has no treasure tables. */
function purseRange(cr: string): { coin: "copper" | "silver" | "gold"; min: number; max: number } {
  const v = crValue(cr);
  if (v <= 0.25) return { coin: "copper", min: 2, max: 12 };
  if (v <= 1) return { coin: "silver", min: 2, max: 12 };
  if (v <= 3) return { coin: "gold", min: 2, max: 16 };
  if (v <= 5) return { coin: "gold", min: 5, max: 30 };
  return { coin: "gold", min: 20, max: 100 };
}

function coinItem(coin: "copper" | "silver" | "gold", amount: number): CarriedItem {
  const value = amount * (COPPER_VALUE[coin] ?? 1);
  return {
    name: `${amount} ${coin} ${amount === 1 ? "piece" : "pieces"}`,
    note: `A handful of loose coins, about ${value} copper in all. The game does not track money yet; the DM does.`,
    kind: "coins",
    pocketable: true,
  };
}

// ── the exports ─────────────────────────────────────────────────────────

/**
 * A live creature's possessions: its manufactured weapons and armor (from its
 * attack names and `acNote`), a coin purse by tier and maybe one trinket if it
 * is the sort that has a purse. Beasts, machines and ghosts carry nothing; a
 * corporeal undead carries its gear plus, maybe, a grave token (or burial
 * tatters if it has no armor). Takes a bestiary entry, a bestiary id, a token
 * id such as "token_goblin" or "token_raider", or a name; an unknown string
 * carries nothing.
 *
 * rng is consumed in a fixed order (purse size, trinket chance, trinket pick),
 * so a seeded rng is repeatable.
 */
export function carriedBy(beastOrToken: Beast | string, rng: Rng = Math.random): CarriedItem[] {
  const p = profileOf(beastOrToken);
  if (isBeastType(p.type) || p.incorporeal) return [];

  const items: CarriedItem[] = [];
  for (const k of p.weaponKeys) {
    const t = WEAPONS[k];
    if (t) items.push(fresh(t));
  }
  for (const k of p.armorKeys) {
    const t = ARMORS[k];
    if (t) items.push(fresh(t));
  }
  const hasGear = items.length > 0;

  if (isUndeadType(p.type)) {
    if (p.armorKeys.length === 0) items.push(fresh(BURIAL_TATTERS));
    if (pick01(rng) < 0.5) items.push(fresh(GRAVE_TOKEN));
    return items;
  }

  // A purse goes with a person (or a person-like thing) who owns manufactured goods.
  if (!hasGear) return items;
  const range = purseRange(p.cr);
  items.push(coinItem(range.coin, intIn(range.min, range.max, rng)));
  if (pick01(rng) < 1 / 3) {
    const t = TRINKETS[intIn(0, TRINKETS.length - 1, rng)];
    if (t) items.push({ name: t.name, note: t.note, kind: "trinket", pocketable: true });
  }
  return items;
}

/**
 * The body a slain creature leaves. `carried` is what it STILL carried (so an
 * item already pickpocketed is gone); omit it for a creature that was never
 * touched and the body gets `carriedBy`'s full list (rolled with `rng`).
 */
export function bodyFor(
  id: string,
  beastOrToken: Beast | string,
  at: { x: number; y: number },
  carried?: CarriedItem[],
  rng: Rng = Math.random,
): BodyState {
  const p = profileOf(beastOrToken);
  const items = (carried ?? carriedBy(beastOrToken, rng)).map((i) => ({ ...i }));
  return {
    id,
    name: p.name,
    at: { x: at.x, y: at.y },
    items,
    looted: false,
    harvested: false,
    beast: isBeastType(p.type),
    engineLootRolled: false,
  };
}

/**
 * What a creature's body can be harvested for, and the check to do it. Our
 * own short table by creature (SRD 5.1 has no harvesting rules): skin and
 * hide are Survival, glands and venom are Nature. `null` when there is
 * nothing worth taking (a rat, a person, an ooze). The DC is a flat number;
 * the caller rolls the check and, on a success, hands the item over.
 */
export function harvestFor(beast: Beast): { item: CarriedItem; skill: "Survival" | "Nature"; dc: number } | null {
  const part = (name: string, note: string): CarriedItem => ({ name, note, kind: "part", pocketable: false });
  switch (beast.id) {
    case "wolf":
      return { item: part("Wolf pelt", "A thick grey pelt, a little torn. Worth about 2 gp to a tanner."), skill: "Survival", dc: 10 };
    case "dire-wolf":
      return { item: part("Dire wolf pelt", "A huge, coarse pelt, big enough for a cloak. Worth about 5 gp to a tanner."), skill: "Survival", dc: 12 };
    case "black-bear":
      return { item: part("Black bear pelt", "A heavy dark pelt. Worth about 5 gp to a tanner."), skill: "Survival", dc: 11 };
    case "brown-bear":
      return { item: part("Brown bear pelt", "A broad, shaggy pelt that would cover a bed. Worth about 8 gp to a tanner."), skill: "Survival", dc: 12 };
    case "giant-bat":
      return { item: part("Bat wing membrane", "A strip of leathery wing, tough but thin. Worth a few silver."), skill: "Survival", dc: 11 };
    case "giant-spider":
      return { item: part("Spider venom gland", "A swollen gland that still seeps. Worth about 5 gp to an alchemist, and unpleasant to carry."), skill: "Nature", dc: 12 };
    case "stirge":
      return { item: part("Stirge proboscis", "A needle-sharp feeding tube, dried stiff. Worth a few silver."), skill: "Nature", dc: 10 };
    case "owlbear":
      return { item: part("Owlbear feathers", "A bundle of stiff, barred feathers from the head and neck. Worth about 10 gp."), skill: "Survival", dc: 13 };
    case "red-dragon-wyrmling":
      return { item: part("Wyrmling scales", "A few small red scales, warm to the touch. Worth about 25 gp to a collector."), skill: "Survival", dc: 13 };
    case "young-green-dragon":
      return { item: part("Green dragon scale", "One dull green scale as wide as a hand. Worth about 50 gp to a collector."), skill: "Survival", dc: 15 };
    default:
      return null;
  }
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Take one named item (first match, case-insensitive), or "all", from a body.
 * Returns a NEW body plus what came out; an unknown name takes nothing and
 * leaves the body as it was. `looted` becomes true once nothing is left.
 */
export function takeFromBody(body: BodyState, name: string | "all"): { body: BodyState; taken: CarriedItem[] } {
  if (name === "all") {
    return {
      body: { ...body, items: [], looted: true },
      taken: body.items.map((i) => ({ ...i })),
    };
  }
  const idx = body.items.findIndex((i) => sameName(i.name, name));
  if (idx < 0) return { body: { ...body, items: body.items.map((i) => ({ ...i })) }, taken: [] };
  const taken = { ...body.items[idx]! };
  const items = body.items.filter((_, k) => k !== idx).map((i) => ({ ...i }));
  return { body: { ...body, items, looted: items.length === 0 }, taken: [taken] };
}

/**
 * A pickpocket lifts one pocketable thing: chosen uniformly from the
 * pocketable items, one rng call. Armor and body parts are never pocketable,
 * so they are never returned. `item` is null when there was nothing small
 * enough; `rest` is what the mark still carries (feed it to `bodyFor` later).
 */
export function pocketPick(carried: CarriedItem[], rng: Rng = Math.random): { item: CarriedItem | null; rest: CarriedItem[] } {
  const candidates: number[] = [];
  carried.forEach((it, i) => {
    if (it.pocketable) candidates.push(i);
  });
  if (candidates.length === 0) return { item: null, rest: carried.map((i) => ({ ...i })) };
  const chosen = candidates[intIn(0, candidates.length - 1, rng)]!;
  return {
    item: { ...carried[chosen]! },
    rest: carried.filter((_, i) => i !== chosen).map((i) => ({ ...i })),
  };
}

/**
 * The item notes keyed by name, in the shape `describeCarried` (inventory/
 * itemInfo.ts) takes as its `notes` argument, so every looted item gets a
 * real description in the pack tip.
 */
export function itemNotes(items: readonly CarriedItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of items) out[i.name] = i.note;
  return out;
}
