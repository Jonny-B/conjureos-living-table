/**
 * Which dice and which tray a monster rolls in: "the better the enemy, the
 * fancier the die and the die container". Pure data and lookups, no DOM, so the
 * unit test and any view (the Play tab, the Bestiary) can use it. The looks
 * themselves (the skins and the tray paintings) live in dice.ts; this file only
 * decides WHICH ones a creature gets.
 *
 * The ladder is by challenge rating, six tiers, each clearly richer than the last
 * in both the die and the container:
 *
 *   tier 0  CR 0 to 1/8     a chipped wooden die in a battered crate lid on sackcloth
 *   tier 1  CR 1/4 to 1/2   an iron die in an iron-bound, riveted box on dark leather
 *   tier 2  CR 1 to 2       a bronze die in a carved stone bowl on slate-blue felt
 *   tier 3  CR 3 to 4       a silver die in an oak tray with silver caps on crimson velvet
 *   tier 4  CR 5 to 7       a gold-veined die in a gilded filigree tray on shimmering purple velvet
 *   tier 5  CR 8 and up     an ember-veined obsidian die in a dragon-bone tray, embers drifting over black velvet
 *
 * Accents layer on the tier: undead get a bone-white die and an ossuary rim (with
 * a faint sickly green glow from tier 2 up, skull corners from tier 3), dragons
 * get a scaled rim and hoard-gold accents (tinted red, green, blue, black or white
 * when the creature's id names the colour). Everything else uses the base ladder.
 *
 * Foe looks are NOT for sale: none of these skins is in DICE_SKINS or the picker.
 * It reads the bestiary, so it lives with the table window rather than the rules.
 */
import { BESTIARY, type Beast } from "../../rules/bestiary";
import { DRAGON_COLOURS, FOE_DICE_SKINS, TRAY_LOOKS, foeSkinId, foeTrayId, type DragonColour, type FoeAccent, type FoeTier } from "./dice";

export type { FoeTier } from "./dice";

export interface FoeDiceLook {
  tier: FoeTier;
  /** A skin id in FOE_DICE_SKINS (pass it as RollRequest.skin). */
  skinId: string;
  /** A tray look id in TRAY_LOOKS (pass it as RollRequest.tray). */
  trayId: string;
  /** For example "Iron-bound box, iron dice". */
  name: string;
  accent?: "undead" | "dragon";
}

/** One plain line per tier, for the owner and the Bestiary. */
export const FOE_TIER_WORDS: readonly string[] = [
  "Tier 0 (CR 0 to 1/8): a chipped wooden die in a battered crate lid, on scuffed sackcloth.",
  "Tier 1 (CR 1/4 to 1/2): a dark iron die in an iron-bound, riveted box lined with dark leather.",
  "Tier 2 (CR 1 to 2): a bronze die with a metal sheen in a carved stone bowl on slate-blue felt.",
  "Tier 3 (CR 3 to 4): a polished silver die in an oak tray with silver corner caps, on crimson velvet.",
  "Tier 4 (CR 5 to 7): a glossy gold-veined die in a gold filigree tray with gems at the corners, on shimmering royal purple velvet.",
  "Tier 5 (CR 8 and up): an obsidian die with glowing ember veins in a dragon-bone tray, embers drifting over black velvet.",
];

/** The challenge rating of the sci-fi tokens, which are SRD reskins (see MONSTER_STATBLOCKS in session/combat.ts): a Raider is the Bandit's numbers, a Combat Drone the Flying Sword's. */
const TOKEN_CR: Readonly<Record<string, string>> = { token_raider: "1/8", token_drone: "1/4" };

/** The tier of a token the bestiary and the table above do not know. */
const UNKNOWN_TIER: FoeTier = 1;

/** The numeric value of a challenge rating written "0", "1/8", "1/4", "1/2", "1", "2" ..., or NaN when it is not one. */
function crValue(cr: string): number {
  const s = String(cr).trim();
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) return Number(frac[2]) === 0 ? Number.NaN : Number(frac[1]) / Number(frac[2]);
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

/** The look tier for a challenge rating string. An unreadable rating is tier 1. */
export function tierForCr(cr: string): FoeTier {
  const v = crValue(cr);
  if (!Number.isFinite(v) || v < 0) return UNKNOWN_TIER;
  if (v <= 1 / 8) return 0;
  if (v <= 1 / 2) return 1;
  if (v <= 2) return 2;
  if (v <= 4) return 3;
  if (v <= 7) return 4;
  return 5;
}

function dragonColourOf(id: string): DragonColour | undefined {
  const parts = id.toLowerCase().split(/[^a-z]+/);
  return DRAGON_COLOURS.find((c) => parts.includes(c));
}

const TRAY_NAMES: ReadonlyMap<string, string> = new Map(TRAY_LOOKS.map((l) => [l.id, l.name]));
const SKIN_NAMES: ReadonlyMap<string, string> = new Map(FOE_DICE_SKINS.map((s) => [s.id, s.name]));

/** Words for a look's display name: the tray's name and the skin's, lower-cased after the comma. */
function lookName(tier: FoeTier, accent: FoeAccent | undefined, colour: DragonColour | undefined): string {
  const tray = TRAY_NAMES.get(foeTrayId(tier, accent, colour)) ?? "Tray";
  const skin = SKIN_NAMES.get(foeSkinId(tier, accent, colour)) ?? "dice";
  return `${tray}, ${skin.charAt(0).toLowerCase()}${skin.slice(1)}`;
}

function build(tier: FoeTier, accent: FoeAccent | undefined, colour: DragonColour | undefined): FoeDiceLook {
  const look: FoeDiceLook = { tier, skinId: foeSkinId(tier, accent, colour), trayId: foeTrayId(tier, accent, colour), name: lookName(tier, accent, colour) };
  if (accent) look.accent = accent;
  return look;
}

/** The accent a creature gets, from its SRD type, its tags and its id. Undead wins over dragon (a dragon that is also undead is undead). */
function accentOf(beast: Pick<Beast, "id" | "type" | "tags">): FoeAccent | undefined {
  const type = beast.type.toLowerCase();
  if (type.startsWith("undead") || beast.tags.includes("undead")) return "undead";
  if (type.startsWith("dragon") || beast.tags.includes("dragon")) return "dragon";
  return undefined;
}

/** The dice and tray a creature rolls in, by its challenge rating, with the undead and dragon accents. */
export function foeDiceFor(beast: Beast): FoeDiceLook {
  const tier = tierForCr(beast.cr);
  const accent = accentOf(beast);
  return build(tier, accent, accent === "dragon" ? dragonColourOf(beast.id) : undefined);
}

/**
 * The dice and tray for a token on the board, via the bestiary's tokenAssetId
 * (token_goblin and token_skeleton), or by the SRD challenge rating of the
 * sci-fi tokens (token_raider is CR 1/8, token_drone CR 1/4). An unknown token
 * is tier 1.
 */
export function foeDiceForToken(tokenAssetId: string): FoeDiceLook {
  const beast = BESTIARY.find((b) => b.tokenAssetId === tokenAssetId);
  if (beast) return foeDiceFor(beast);
  const cr = TOKEN_CR[tokenAssetId];
  return build(cr ? tierForCr(cr) : UNKNOWN_TIER, undefined, undefined);
}
