/**
 * The command menu's routing table: which of the five player actions (plus
 * free text) resolve entirely on the client, and which need a DM turn. This
 * is the cost-model enforcement point (DESIGN.md, "Command menu: what needs
 * the model, what doesn't" and "Cost model"), so the split below is copied
 * from the doc verbatim, not improvised:
 *
 * - Move: local (pathfind within the known playspace). Crosses into the DM
 *   ONLY when the destination is a neighbour cell that isn't assembled yet
 *   -- assembling costs a credit, re-entering an already-built cell doesn't.
 * - Attack: always local, the roll is `rules/combat.ts`, free.
 * - Cast: always local, the slot is `rules/spells.ts`'s castSpell and the
 *   effect routes through the same attack/save/heal resolvers Attack and Item
 *   already use (see menu/casting.ts). Not in DESIGN.md's original five-verb
 *   list, and added here rather than left out because two of the four
 *   archetypes per template are casters: without it the character sheet
 *   advertises spell slots the game has no button to spend. Free, for the same
 *   reason Attack is free -- it is the tactical layer, not the model.
 * - Rest: always local, restoring hit points and spell slots off the
 *   character's own hit dice. Free, and specifically free because DESIGN.md
 *   says "never charge for losing" and a hurt newcomer's way back up must not
 *   be a paid surface.
 * - Search: always local, a check against a DC set when the cell was
 *   assembled; no AI call, so search spam can't farm credits.
 * - Item: always local, applying a known item's effect.
 * - Talk: always the DM, 1 credit.
 * - Free text: always the DM, 1 credit; the escape hatch free text exists to
 *   pay for.
 *
 * This module makes no AI call and touches no rules dice itself -- it only
 * decides WHERE an action's real work happens. The caller does the actual
 * pathfinding / combat roll / DC check / DM turn after reading the route.
 */
import { neighbourCell, type CellCoord, type Direction, type TileCoord } from "../world/coordinates";
import { getCell, type World } from "../world/perception";
import { exitToNeighbour } from "../world/connectivity";

/**
 * Where a Move is headed: either a tile inside the party's current
 * playspace (always local, it's already assembled by definition), or a step
 * across the cell boundary into one of the eight neighbours (local only if
 * that neighbour is already assembled).
 */
export type MoveDestination = { withinCell: true; to: TileCoord } | { withinCell: false; direction: Direction };

export type MenuAction =
  | { kind: "move"; destination: MoveDestination }
  | { kind: "attack" }
  | { kind: "cast" }
  | { kind: "rest" }
  | { kind: "search" }
  | { kind: "item" }
  | { kind: "talk" }
  | { kind: "freeText" };

/**
 * The verbs the play screen puts on screen, in the order it puts them. Kept
 * here rather than inline in the component because a DM turn's `menuHint`
 * names verbs from this list and the UI has to match them back to real
 * buttons; two lists that could drift is exactly how `menuHint` ended up
 * requested on every paid turn, validated, and then thrown away.
 */
export const COMMAND_VERBS = ["Move", "Attack", "Cast", "Search", "Item", "Rest", "Talk"] as const;

export type CommandVerb = (typeof COMMAND_VERBS)[number];

/**
 * Match the model's free-form `menuHint` strings against the real verb list,
 * case-insensitively and ignoring anything it invented. The schema caps each
 * hint at 40 characters but does not constrain the vocabulary, so this is the
 * boundary where "whatever the model said" becomes "buttons that exist."
 */
export function normalizeMenuHint(hint: readonly string[] | undefined): CommandVerb[] {
  if (!hint) return [];
  const out: CommandVerb[] = [];
  for (const raw of hint) {
    const match = COMMAND_VERBS.find((v) => v.toLowerCase() === raw.trim().toLowerCase());
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

/**
 * The one-line nudge under the narration: "You could Talk, or Search." Built
 * from the same normalized list the button highlighting uses, so the sentence
 * can never name a verb that isn't lit up.
 */
export function menuHintSentence(verbs: readonly CommandVerb[]): string | null {
  if (verbs.length === 0) return null;
  if (verbs.length === 1) return `You could ${verbs[0]}.`;
  const head = verbs.slice(0, -1).join(", ");
  return `You could ${head}, or ${verbs[verbs.length - 1]}.`;
}

/** What resolveMenuAction needs to decide a Move: the world (to check whether the target neighbour is a stub) and which cell the party currently occupies. */
export interface MenuContext {
  world: World;
  cell: CellCoord;
}

/**
 * `blocked` is the third answer this routing table always needed and never
 * had. "Local or DM" has no way to say "this does not happen at all", so a
 * step at a solid wall run had to be forced into one of the other two, and it
 * was forced into the wrong one: a cross-cell move read only whether the
 * NEIGHBOUR was assembled, never whether the current room had a way out on
 * that side, so walking at a wall toward unexplored ground opened a paid DM
 * turn. Charging a credit to walk into a wall is exactly what this repo's
 * cost model calls a toll booth, and the caller can now refuse it for free
 * with the reason in words.
 */
export type MenuRoute = { kind: "local" } | { kind: "dm"; reason: string } | { kind: "blocked"; reason: string };

/**
 * The single function every command-menu button and the free-text box both
 * go through before doing anything. Keeping this as one pure function (no
 * side effects, no AI call inside it) is what makes the cost model testable
 * in isolation from the actual pathfinder / combat resolver / DM prompt --
 * this only answers "local or DM", never "what happens".
 */
export function resolveMenuAction(action: MenuAction, context: MenuContext): MenuRoute {
  switch (action.kind) {
    case "move":
      return resolveMove(action.destination, context);
    case "attack":
      // Always local: the roll is rules/combat.ts, always free per the cost
      // model. What the target does in response is the DM's call on its
      // NEXT turn, but that's a separate Talk/freeText exchange, not part
      // of resolving the attack itself.
      return { kind: "local" };
    case "cast":
      // Always local: the slot spend is rules/spells.ts and the effect lands
      // in the same resolvers Attack uses. A spell is combat, and combat is
      // free forever per the cost model.
      return { kind: "local" };
    case "rest":
      // Always local: hit dice and slot recovery are arithmetic on the
      // character's own sheet. Charging for the way back up from 1 HP would
      // be charging for losing, which this repo's cost model forbids outright.
      return { kind: "local" };
    case "search":
      // Always local: a DC check against a pre-authored prop set when the
      // cell was assembled. No AI call, on purpose -- search spam must not
      // be a way to farm credits out of the player.
      return { kind: "local" };
    case "item":
      // Always local: applying a known item's effect needs no reasoning.
      return { kind: "local" };
    case "talk":
      return { kind: "dm", reason: "talking to someone is always a DM turn" };
    case "freeText":
      return { kind: "dm", reason: "free text is always a DM turn; it's the escape hatch for anything the menu does not cover" };
  }
}

/**
 * A move within the current playspace is always local: the party is
 * standing in an assembled cell by definition, so there's nothing to build.
 * A move that steps into a neighbour only needs the DM if that neighbour is
 * still a stub -- assembleCell is what costs the credit, not the walk.
 *
 * Before either of those, the boundary itself has to allow the step. Exits
 * are what stitch cells together (DESIGN.md, "Exits stitch the world
 * together automatically"), so a cross-cell move is legal only where the
 * CURRENT room declares one on that edge; without this check the party could
 * walk out through the middle of a solid wall run, and toward unexplored
 * ground it would have opened a paid DM turn to do it.
 * `exitToNeighbour` returns undefined for the four diagonals, which share no
 * boundary edge, so those are blocked here too rather than special-cased.
 *
 * The one case that deliberately skips the check: the current cell is not
 * assembled at all. That is the campaign's opening state, where there is no
 * layout to hold an exit and nothing has been built to be walled in by.
 */
function resolveMove(destination: MoveDestination, context: MenuContext): MenuRoute {
  if (destination.withinCell) return { kind: "local" };

  const here = getCell(context.world, context.cell);
  if (here && !exitToNeighbour(here, destination.direction)) {
    return {
      kind: "blocked",
      reason: `there is no way out of this room to the ${destination.direction}`,
    };
  }

  const target = neighbourCell(context.cell, destination.direction);
  const layout = getCell(context.world, target);
  if (layout) return { kind: "local" };

  return {
    kind: "dm",
    reason: `cell (${target.cx},${target.cy}) is unassembled -- the DM has to build it (assembleCell) before the party can walk in`,
  };
}
