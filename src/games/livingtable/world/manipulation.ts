/**
 * DESIGN.md's "The manipulation API": assembleCell (bulk, stub to real) and
 * the fine-grained mutators (placeToken / moveToken / removeToken / placeProp
 * / setDoorState) for what changes as a scene is played. Every one of these
 * validates before applying and returns a rejection instead of silently doing
 * something wrong -- the DM gets the rejection back in its next turn's
 * context and reacts to its own mistake in character, per the DM turn
 * protocol; it is never allowed to just have worked anyway.
 */
import { inBounds, type CellCoord } from "./coordinates";
import type { AssetManifest, CellLayout, PlacedProp, PlacedToken, TileId } from "./cell";
import { addStake, clearStakes, reconcileStakes, stakeFor, stakesFor, validateLayout } from "./connectivity";
import { getCell, setCell, type World } from "./perception";
import { spendMovement, type TurnEconomy } from "../rules/actionEconomy";

export type MutationResult = { ok: true; world: World } | { ok: false; error: string };
export type AssembleResult = { ok: true; world: World } | { ok: false; errors: string[] };

/**
 * moveToken's result carries the caller's TurnEconomy back with movement
 * already spent, the same "return a new one, never mutate" contract
 * actionEconomy.ts's own spendAction/spendMovement use -- so a caller
 * threading one combatant's economy across several moves in a turn always
 * has the right remaining-movement figure to hand to the next call.
 */
export type MoveResult = { ok: true; world: World; economy: TurnEconomy } | { ok: false; error: string };

/**
 * Feet one grid square of movement costs, matching actionEconomy.ts's own
 * note that "the SRD default is 5 ft. per square." Diagonal movement here
 * costs the same as orthogonal (Chebyshev distance between the two tiles),
 * a deliberate simplification of SRD 5.1's alternating-diagonal rule (every
 * second diagonal square costs 10 ft.): the simpler constant-cost
 * convention most top-down grid games use, and the one this app's tile
 * board is built around. Stated here, not hidden, same as every other
 * simplification this repo owns up to (DESIGN.md's "Launch scope" notes,
 * this file's own assembleCell comments).
 */
const FEET_PER_TILE = 5;

/** Chebyshev distance between two tile coordinates, converted to feet via FEET_PER_TILE. */
function moveDistanceFeet(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const squares = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return squares * FEET_PER_TILE;
}

/**
 * Turn a stub into a real cell, in one shot, the way a DM actually builds a
 * room: bulk layout up front, not a sequence of placements.
 *
 * Zero things happen if the cell is already assembled: DESIGN.md is explicit
 * that "re-entering an already-assembled cell costs nothing and calls no
 * action at all; the layout is just read back", so a second assembleCell on
 * the same (cx,cy) is never a legitimate DM turn, and letting it through
 * would be actively dangerous, not just redundant -- the first assembly
 * already cleared this cell's owed stakes and (if a neighbour was already
 * built) patched a mirror exit straight into that neighbour's stored layout.
 * A second call has no owed stakes left to reconcile against, so a
 * replacement layout that puts a wall where that mirror exit lands would
 * pass validateLayout on its own merits while leaving the neighbour's exit
 * silently pointing at a wall, with the engine having reported ok:true both
 * times. Rejecting outright is what keeps that from ever happening; a DM
 * that wants to change an already-built cell has the fine-grained mutators
 * (placeToken, moveToken, setDoorState, etc.) for exactly that.
 *
 * Otherwise, three things happen in order:
 * 1. Reconcile the incoming layout against any stakes earlier neighbours left
 *    on THIS cell (auto-inserting a return exit it forgot to declare).
 * 2. Validate the reconciled layout on its own merits, and reject the whole
 *    assembly (no partial write) if it fails.
 * 3. Store it, then stake this cell's own outgoing exits on whichever
 *    neighbours aren't built yet -- or, if a targeted neighbour is ALREADY
 *    assembled, patch the opening straight into its stored layout right now,
 *    because nobody will ever "later assemble" an already-assembled cell to
 *    redeem a stake left for it. That patched neighbour layout is re-run
 *    through validateLayout exactly like a fresh assembleCell would be,
 *    because a stake landing on a tile the neighbour already declared a wall
 *    is exactly "a doorway declared on a wall tile", the dead-exit failure
 *    validateLayout exists to catch -- patching stored state directly must
 *    not be a way around that check. A patch that fails rejects the whole
 *    assembly (no partial write here either) and is reported back to the DM.
 */
export function assembleCell(world: World, cx: number, cy: number, layout: CellLayout, manifest: AssetManifest): AssembleResult {
  const here: CellCoord = { cx, cy };
  if (getCell(world, here)) {
    return { ok: false, errors: [`cell (${cx},${cy}) is already assembled -- re-assembling it is not a valid DM turn, use the fine-grained mutators to change it instead`] };
  }

  const owed = stakesFor(world.stakes, here);
  // The manifest goes in so reconcileStakes can repair a staked tile the DM
  // walled over, not just append an Exit record onto it -- see its own header
  // for why an exit record alone turned a forgivable omission into a hard
  // rejection of a paid turn.
  const reconciled = reconcileStakes(layout, owed, manifest);

  const check = validateLayout(reconciled, manifest, here);
  if (!check.ok) return { ok: false, errors: check.errors };

  let next = setCell(world, here, reconciled);
  next = { ...next, stakes: clearStakes(next.stakes, here) };

  for (const exit of reconciled.exits) {
    const { targetCell, stake } = stakeFor(here, exit);
    const targetLayout = getCell(next, targetCell);
    if (targetLayout) {
      // Already assembled: patch the return opening in immediately rather
      // than filing a stake that would never get redeemed. Validate the
      // patched result the same way a fresh assembleCell would -- if the
      // mirrored tile is a wall in the neighbour's stored layout, this is
      // the exact "doorway declared on a wall tile" failure validateLayout
      // exists to catch, and writing straight into stored state must not be
      // a way to bypass it. Reject the whole assembly rather than store a
      // dead exit; the DM gets the conflict back in its next turn's context,
      // same as any other rejected action.
      const patchedNeighbour = reconcileStakes(targetLayout, [stake]);
      const neighbourCheck = validateLayout(patchedNeighbour, manifest, targetCell);
      if (!neighbourCheck.ok) {
        return {
          ok: false,
          errors: neighbourCheck.errors.map(
            (e) =>
              `assembling (${cx},${cy}) would patch an exit into already-assembled neighbour (${targetCell.cx},${targetCell.cy}) that fails validation: ${e}`,
          ),
        };
      }
      next = setCell(next, targetCell, patchedNeighbour);
    } else {
      next = { ...next, stakes: addStake(next.stakes, targetCell, stake) };
    }
  }

  return { ok: true, world: next };
}

/** The assembled layout for (cx,cy), or a rejection if the cell is still a stub -- shared by every fine-grained mutator below. */
function requireCell(world: World, cx: number, cy: number): { ok: true; here: CellCoord; layout: CellLayout } | { ok: false; error: string } {
  const here: CellCoord = { cx, cy };
  const layout = getCell(world, here);
  if (!layout) return { ok: false, error: `cell (${cx},${cy}) is not assembled yet` };
  return { ok: true, here, layout };
}

/**
 * Whether a token could stand on this tile at all: the terrain has to be
 * walkable AND no prop flagged `blocks` in the manifest may be sitting on it.
 * The prop half is what makes a door a door -- before it, `setDoorState` was
 * a sprite swap with no mechanical effect whatsoever, because walkability
 * read the tile grid and never once looked at `layout.props`.
 */
function walkableAt(layout: CellLayout, manifest: AssetManifest, x: number, y: number): boolean {
  const id = layout.tiles[y]?.[x];
  if (id === undefined || manifest.tiles[id]?.walkable !== true) return false;
  return !layout.props.some((p) => p.x === x && p.y === y && manifest.props[p.assetId]?.blocks === true);
}

/** The blocking prop sitting on a tile, if any -- so a rejection can name the door rather than just saying "not walkable". */
function blockingPropAt(layout: CellLayout, manifest: AssetManifest, x: number, y: number): PlacedProp | undefined {
  return layout.props.find((p) => p.x === x && p.y === y && manifest.props[p.assetId]?.blocks === true);
}

/** The token standing on a tile, if any, ignoring `movingTokenId` (a token's own square is never an obstacle to itself). */
function occupantAt(layout: CellLayout, x: number, y: number, movingTokenId?: string): PlacedToken | undefined {
  return layout.tokens.find((t) => t.x === x && t.y === y && t.id !== movingTokenId);
}

/**
 * Whether a tile is both passable and unoccupied, for the token identified by
 * `movingTokenId` (pass its id when it is already on the board, so its own
 * current square doesn't read as occupied by someone else).
 *
 * Exported because it is the honest predicate for "can this creature stand
 * here", and every caller that needs to ask it -- placeToken, moveToken, and
 * a UI graying out a destination -- should be asking the same one rather than
 * re-deriving a weaker version from the tile grid alone. SRD 5.1 is explicit
 * that a creature cannot end its move in another creature's space; before
 * this, neither mutator checked occupancy at all and the renderer simply drew
 * two sprites overlapping, which is the one rules break a player can see.
 */
export function tileFreeFor(layout: CellLayout, manifest: AssetManifest, x: number, y: number, movingTokenId?: string): boolean {
  return walkableAt(layout, manifest, x, y) && occupantAt(layout, x, y, movingTokenId) === undefined;
}

/** Why a tile can't be stood on, worded for the DM's next turn, or null when it can. Shared by placeToken and moveToken so the two never drift. */
function describeBlockedTile(layout: CellLayout, manifest: AssetManifest, x: number, y: number, movingTokenId?: string): string | null {
  const door = blockingPropAt(layout, manifest, x, y);
  if (door) return `(${x},${y}) is blocked by prop "${door.id}" (${door.assetId}) -- open or remove it first`;
  if (!walkableAt(layout, manifest, x, y)) return `(${x},${y}) is not walkable`;
  const sitting = occupantAt(layout, x, y, movingTokenId);
  if (sitting) return `(${x},${y}) is already occupied by token "${sitting.id}" -- two creatures cannot share one square`;
  return null;
}

/** Add a new token to an already-assembled cell. Rejected if it's off-grid, on a non-walkable or occupied tile, its asset isn't in the manifest, or its id is already taken here. */
export function placeToken(world: World, cx: number, cy: number, token: PlacedToken, manifest: AssetManifest): MutationResult {
  const found = requireCell(world, cx, cy);
  if (!found.ok) return found;
  const { here, layout } = found;

  if (!inBounds(token)) return { ok: false, error: `(${token.x},${token.y}) is out of bounds` };
  if (!manifest.tokens[token.assetId]) return { ok: false, error: `unknown token asset "${token.assetId}"` };
  // Id collision: nothing checked this before, and a monster carrying the
  // PC's own id was accepted outright. That is not a cosmetic clash -- every
  // per-token guarantee in this app (which roll concerns whom, which token a
  // combat outcome removes) is keyed on the id being unique.
  if (layout.tokens.some((t) => t.id === token.id)) {
    return { ok: false, error: `a token with id "${token.id}" is already in cell (${cx},${cy}) -- give this one its own id` };
  }
  const blocked = describeBlockedTile(layout, manifest, token.x, token.y);
  if (blocked) return { ok: false, error: blocked };

  return { ok: true, world: setCell(world, here, { ...layout, tokens: [...layout.tokens, token] }) };
}

/**
 * Move an existing token. Rejected the same way placeToken is for bounds and
 * walkability -- a wall stays a wall whether a token is landing on it fresh
 * or walking into it -- plus a fourth check none of the other mutators need:
 * the move must fit inside `economy`'s remaining movement for this round.
 * `economy` is a required parameter, not an optional add-on, on purpose --
 * DESIGN.md's rules-engine paragraph lists movement as one of the four
 * action-economy resources "enforced structurally," and an optional check a
 * caller could simply not pass would make that true only when convenient.
 * Requiring it here matches how `manifest` is already required for asset
 * lookups: the caller has to supply the thing being checked against.
 * Distance is computed from the token's CURRENT position in `layout` to
 * `to`, in feet, via `moveDistanceFeet` -- this is the one call site that can
 * do that math at all, since it is the only layer that actually holds the
 * token's live position (turnSchema.ts validates shape only and never sees
 * `World`, per its own header comment). Insufficient movement is rejected
 * with the same "drop and report back" contract as every other rejection in
 * this file, not a silent clamp to whatever was left.
 */
export function moveToken(
  world: World,
  cx: number,
  cy: number,
  tokenId: string,
  to: { x: number; y: number },
  manifest: AssetManifest,
  economy: TurnEconomy,
): MoveResult {
  const found = requireCell(world, cx, cy);
  if (!found.ok) return found;
  const { here, layout } = found;

  const idx = layout.tokens.findIndex((t) => t.id === tokenId);
  if (idx === -1) return { ok: false, error: `no token "${tokenId}" in cell (${cx},${cy})` };
  if (!inBounds(to)) return { ok: false, error: `(${to.x},${to.y}) is out of bounds` };
  const blocked = describeBlockedTile(layout, manifest, to.x, to.y, tokenId);
  if (blocked) return { ok: false, error: blocked };

  const from = layout.tokens[idx]!;
  const distance = moveDistanceFeet(from, to);
  let spent: TurnEconomy;
  try {
    spent = spendMovement(economy, distance);
  } catch {
    return {
      ok: false,
      error:
        `token "${tokenId}" has ${economy.movementRemaining} ft. of movement left this turn, ` +
        `but moving to (${to.x},${to.y}) costs ${distance} ft. -- that's further than it can move right now.`,
    };
  }

  const tokens = [...layout.tokens];
  tokens[idx] = { ...tokens[idx]!, x: to.x, y: to.y };
  return { ok: true, world: setCell(world, here, { ...layout, tokens }), economy: spent };
}

/**
 * Remove a token (it fled, it died, it was never really there). Rejected only
 * if it isn't there to remove.
 *
 * Removes EXACTLY ONE token, by index, matching how moveToken already picks
 * its target (findIndex, first match). The old `filter` version removed every
 * token sharing the id, which mattered because nothing at any layer enforced
 * unique ids: two goblins carrying the same id plus one properly cited attack
 * roll took both off the board, straight past turnSchema.ts's "one resolved
 * roll decides one outcome, not several" gate. placeToken and validateLayout
 * now refuse to create that duplicate in the first place, but a mutation must
 * never be able to affect more entities than it names regardless.
 */
export function removeToken(world: World, cx: number, cy: number, tokenId: string): MutationResult {
  const found = requireCell(world, cx, cy);
  if (!found.ok) return found;
  const { here, layout } = found;

  const idx = layout.tokens.findIndex((t) => t.id === tokenId);
  if (idx === -1) return { ok: false, error: `no token "${tokenId}" in cell (${cx},${cy})` };

  const tokens = [...layout.tokens];
  tokens.splice(idx, 1);
  return { ok: true, world: setCell(world, here, { ...layout, tokens }) };
}

/**
 * Set a token's current hit points. ENGINE-ONLY, deliberately: there is no
 * WorldAction variant for this and there must never be one, because HP is a
 * resolved mechanical outcome and DESIGN.md's turn protocol says the model
 * never originates one. The only legitimate caller is code that has just
 * resolved a damage roll through rules/combat.ts.
 */
export function setTokenHp(world: World, cx: number, cy: number, tokenId: string, currentHp: number): MutationResult {
  const found = requireCell(world, cx, cy);
  if (!found.ok) return found;
  const { here, layout } = found;

  const idx = layout.tokens.findIndex((t) => t.id === tokenId);
  if (idx === -1) return { ok: false, error: `no token "${tokenId}" in cell (${cx},${cy})` };

  const tokens = [...layout.tokens];
  tokens[idx] = { ...tokens[idx]!, currentHp: Math.max(0, currentHp) };
  return { ok: true, world: setCell(world, here, { ...layout, tokens }) };
}

/**
 * Add a prop. No walkability check -- DESIGN.md's manipulation API only
 * requires walkability "for a token"; a statue in a wall alcove is a
 * perfectly normal prop placement, an off-grid one or an unknown asset isn't.
 */
export function placeProp(world: World, cx: number, cy: number, prop: PlacedProp, manifest: AssetManifest): MutationResult {
  const found = requireCell(world, cx, cy);
  if (!found.ok) return found;
  const { here, layout } = found;

  if (!inBounds(prop)) return { ok: false, error: `(${prop.x},${prop.y}) is out of bounds` };
  if (!manifest.props[prop.assetId]) return { ok: false, error: `unknown prop asset "${prop.assetId}"` };

  return { ok: true, world: setCell(world, here, { ...layout, props: [...layout.props, prop] }) };
}

/**
 * Mark a prop as already searched. ENGINE-ONLY, for the same reason
 * `setTokenHp` is: this is the recorded outcome of a resolved Perception
 * check, not something the model may assert, so it has no WorldAction
 * variant. Without it `PlacedProp.searched` was a field the DM could author
 * and the engine could read but nothing ever wrote, so a chest re-rolled its
 * DC forever and a player who failed once could simply keep pressing until
 * the dice went their way.
 */
export function markPropSearched(world: World, cx: number, cy: number, propId: string): MutationResult {
  const found = requireCell(world, cx, cy);
  if (!found.ok) return found;
  const { here, layout } = found;

  const idx = layout.props.findIndex((p) => p.id === propId);
  if (idx === -1) return { ok: false, error: `no prop "${propId}" in cell (${cx},${cy})` };

  const props = [...layout.props];
  props[idx] = { ...props[idx]!, searched: true };
  return { ok: true, world: setCell(world, here, { ...layout, props }) };
}

/**
 * A door opening or closing is modelled as swapping an existing prop's
 * asset id (its closed-door sprite for its open-door sprite, or back) --
 * there's no separate Door type, a door is just a prop whose two states are
 * two asset ids.
 */
export function setDoorState(world: World, cx: number, cy: number, propId: string, assetId: TileId, manifest: AssetManifest): MutationResult {
  const found = requireCell(world, cx, cy);
  if (!found.ok) return found;
  const { here, layout } = found;

  const idx = layout.props.findIndex((p) => p.id === propId);
  if (idx === -1) return { ok: false, error: `no prop "${propId}" in cell (${cx},${cy})` };
  if (!manifest.props[assetId]) return { ok: false, error: `unknown prop asset "${assetId}"` };

  const props = [...layout.props];
  props[idx] = { ...props[idx]!, assetId };
  return { ok: true, world: setCell(world, here, { ...layout, props }) };
}
