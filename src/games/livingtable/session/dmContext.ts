/**
 * The local-vs-DM glue that isn't already covered by menu/commandMenu.ts's
 * `resolveMenuAction`: turning a DM-routed command-menu action into the
 * synthetic message that opens a `requestDmTurn` call, and carrying a
 * rejected world-action's error message forward into the NEXT turn's
 * context (DESIGN.md's manipulation API: "a rejected action is dropped and
 * reported back to the DM in its next turn's context... the model gets to
 * react to its own mistake in character rather than the game breaking").
 *
 * The rejection carry-forward is implemented as a synthetic user-role
 * message prepended ahead of the player's real next line, not a new
 * DmPromptArgs field: dm/dmTurn.ts's `requestDmTurn` already threads
 * `priorMessages` straight into `completeJson`, so a plain chat message
 * round-trips through exactly the same path every other turn does, with no
 * schema change to dm/turnSchema.ts or dm/promptBuilder.ts needed. Simpler
 * beats a new field here since the DM already reads its whole message
 * history each turn; a schema field would only be worth it if the rejection
 * needed to survive INTO the next turn's system prompt specifically, and it
 * doesn't; the very next model reply already gets to see it.
 */
import type { ChatMessage } from "../../../bridge/ai";
import type { Direction } from "../world/coordinates";
import type { DmCharacterView } from "../dm/promptBuilder";
import type { CharacterSheet } from "../characters/creation";
import { itemNameFor } from "../characters/equipment";
import { GEAR_ROLES } from "../characters/equipmentTypes";
import { packItems } from "../menu/equipment";
import { effectiveArmorClass, skillModifierFor } from "./combat";

/**
 * What the character has on, by NAME only, GEAR_ROLES order (contract v2,
 * equipmentTypes.ts 11.7 point 6): "Keen Longsword, Kite Shield, Hood, Travel
 * Boots". An empty ring or amulet is skipped rather than named. Never a tier
 * word, a bonus, a charge count or a bag item: the DM narrates what it can
 * see, and the one namer (`itemNameFor` delegates to `gearItemName`) keeps
 * the name identical to the sheet's, the dice log's and the screen's.
 */
function wearingNames(sheet: CharacterSheet): string[] {
  return GEAR_ROLES.map((role) => itemNameFor(sheet, role)).filter((name): name is string => name !== null);
}

/**
 * The player character as the DM's prompt needs them (dm/promptBuilder.ts's
 * WHO IS AT YOUR TABLE block), built fresh from the sheet the caller already
 * holds. Rebuilt every turn rather than cached: dmTurn.ts rebuilds the whole
 * system prompt per turn anyway, so there is no staleness risk and no reason
 * to keep a second copy of a character's HP anywhere.
 *
 * Only the fields a DM actually reasons with cross over. Spell slots, hit
 * dice, saving-throw proficiencies and the creation-choice bookkeeping stay
 * on the sheet: the DM narrates and targets, it does not resolve, so handing
 * it the resolver's inputs would only invite it to try.
 */
export function buildDmCharacterView(sheet: CharacterSheet, tokenId: string, conditions?: string[]): DmCharacterView {
  const view: DmCharacterView = {
    tokenId,
    name: sheet.name,
    archetype: sheet.displayName,
    level: sheet.level,
    currentHp: sheet.currentHp,
    maxHp: sheet.maxHp,
    // Through `effectiveArmorClass`, never the stored field. The DM's prompt
    // prints this number ("AC {c.armorClass}") and `defenderACForRollRequest`
    // rolls against the derived one, so reading the raw field here would tell
    // the model a LOWER armour class than the engine actually uses and it
    // would narrate near-misses as hits. Same asymmetry, different door.
    armorClass: effectiveArmorClass(sheet),
    modifiers: { ...sheet.modifiers },
    // Through `skillModifierFor`, for the same reason AC goes through
    // `effectiveArmorClass`: a worn Stone of Good Luck adds to every check
    // (contract v2), and a DC pitched at the stored bonus would be pitched at
    // a number one lower than the engine actually rolls. The number only,
    // never its parts: the DM never learns which item moved it.
    skills: sheet.skills.map((s) => ({ skill: s.skill, bonus: skillModifierFor(sheet, s.skill) })),
    wearing: wearingNames(sheet),
    // The PACK, not the loadout (`packItems` drops the starting-kit strings the
    // Wearing line already names), so no piece is listed twice. The bag is
    // never here: a find reaches the DM only as its own one fact line.
    inventory: [...packItems(sheet)],
  };
  if (conditions && conditions.length > 0) view.conditions = [...conditions];
  return view;
}

/**
 * Batch one or more world-action rejections (world/manipulation.ts's plain
 * string errors) into one synthetic chat message. Returns null for an empty
 * list so a clean turn never grows the transcript with an empty note.
 */
export function buildRejectionMessage(rejections: string[]): ChatMessage | null {
  if (rejections.length === 0) return null;
  const lines = rejections.map((r) => `- ${r}`).join("\n");
  return {
    role: "user",
    content:
      "[ENGINE NOTE, not from the player: one or more of your last turn's actions were rejected and NOT applied " +
      "to the world. React to your own mistake in character, then continue the scene.]\n" +
      lines,
  };
}

/** The synthetic player line for a Move that crosses into an unassembled neighbour cell (commandMenu.ts's `{kind:"dm"}` route for Move) -- there is no free-text from the player in this case, so this stands in for it. */
export function describeMoveIntoFog(direction: Direction): string {
  return `The party moves ${direction} into the unexplored area beyond the current room. Describe what's there and build it so they can step in.`;
}

/** The synthetic opening line for a brand-new campaign's very first DM turn, which has to assemble cell (0,0) before there's anywhere for the party to stand. */
export const BEGIN_CAMPAIGN_MESSAGE =
  "Begin the campaign. Set the opening scene and assemble the starting cell (0,0) so the party has somewhere to stand.";
