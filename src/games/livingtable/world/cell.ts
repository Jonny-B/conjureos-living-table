/**
 * One assembled cell's shape: a dense terrain grid plus the sparse,
 * identity-bearing things placed on it. DESIGN.md's "The perception API" is
 * explicit that this is both/and, not either/or: terrain is naturally
 * grid-shaped and cheap at 20x15, while props/tokens/exits are sparse and
 * persist by identity across turns (the same goblin token moves, it isn't a
 * new one each turn).
 */
import type { CellCoord, Edge } from "./coordinates";

/** An asset id referencing one entry in the loaded manifest (a tile, token, or prop sprite). */
export type TileId = string;

/**
 * The four optional fields below are what DESIGN.md's Search verb ("a
 * Perception/Investigation check against a DC set when the cell was assembled,
 * revealing pre-authored flavour text on the prop it was checked against")
 * actually needs to exist in the data model. Before they were here the Search
 * handler had nowhere to read a DC or a line of text from, so it resolved a
 * flat DC forever and printed one of two hardcoded sentences, which made
 * succeeding at the check indistinguishable in consequence from failing it.
 * All four are optional: a purely decorative prop (a torch, a bare crate) has
 * nothing to find and shouldn't be forced to pretend it does.
 */
export interface PlacedProp {
  id: string;
  assetId: TileId;
  x: number;
  y: number;
  /** Which way it faces, when that matters (a door, a statue); omitted when it doesn't. */
  facing?: Edge;
  /** What the player's UI and the DM's own narration call this thing ("the iron-bound chest"), rather than falling back to the bare asset id. */
  label?: string;
  /** The Perception/Investigation DC searching this prop is checked against. SRD 5 to 30 scale; validated in connectivity.ts. */
  dc?: number;
  /** The pre-authored line printed when the search BEATS `dc`. This is the DM's own writing, authored at assembly time, not new hardcoded copy. */
  onFound?: string;
  /** An inventory item granted once, on a successful search. Plain item name, matching characters/templates.ts's startingInventory strings. */
  grantsItem?: string;
  /** Set by the engine once this prop has been successfully searched, so re-searching says so instead of re-rolling the same DC forever. */
  searched?: boolean;
}

export interface PlacedToken {
  id: string;
  assetId: TileId;
  x: number;
  y: number;
  kind: "pc" | "npc" | "monster" | "companion";
  /**
   * Current hit points for a monster or NPC token. Absent means "undamaged",
   * read back as the statblock maximum by session/combat.ts's
   * `monsterCurrentHp`, so a freshly placed token needs no HP computed for it.
   * Written only by the engine (manipulation.ts's `setTokenHp`) after a
   * resolved damage roll, which is why there is deliberately no `currentHp` in
   * dm/turnSchema.ts's validatePlacedToken: HP is a resolved mechanical
   * outcome, and letting a placeToken carry one would let the model place a
   * goblin at 1 HP, the same class of hole as a model-supplied targetAC.
   */
  currentHp?: number;
}

/**
 * A passage on a cell boundary. `at` must sit on the boundary edge implies
 * (x=0 for W, x=CELL_WIDTH-1 for E, and so on) -- validateLayout checks this,
 * connectivity.ts is what mirrors it onto the neighbour it points to.
 */
export interface Exit {
  at: { x: number; y: number };
  edge: Edge;
  toCell: CellCoord;
}

export interface CellLayout {
  /**
   * tiles[y][x]: one row per y (top to bottom), CELL_WIDTH ids per row. Every
   * function under world/ that indexes this grid agrees on that order; it's
   * an internal convention, not something DESIGN.md pins down, so it only
   * has to be consistent with itself.
   */
  tiles: TileId[][];
  props: PlacedProp[];
  tokens: PlacedToken[];
  exits: Exit[];
  /**
   * Waives the "a cell must declare at least one exit" check in
   * connectivity.ts's validateLayout. A room with no way out is normally a
   * bug (the party walks in and the game is over), so it has to be declared
   * on purpose: a vault, a cut-scene chamber, a cell the DM intends to open
   * later with setDoorState. Absent means "this is a normal room", which is
   * the case that must never silently ship with zero exits.
   */
  sealed?: boolean;
}

/**
 * Just enough of the real asset manifest to validate a layout: does this id
 * exist, is it walkable. The real manifest (from the asset-set builders, see
 * DESIGN.md "Assets: a code-defined library") carries far more per entry, so
 * this stays a loose, structural subset rather than the full type -- it's
 * satisfied by anything with at least this shape.
 */
export interface AssetManifest {
  tiles: Record<TileId, { walkable: boolean }>;
  tokens: Record<TileId, Record<string, unknown>>;
  /**
   * `blocks` is what makes a door a door rather than a sprite swap:
   * manipulation.ts's `walkableAt` consults it, so a `door_closed` prop
   * genuinely stops a token walking onto its tile and `door_open` doesn't.
   * Before this flag, walkability read the tile grid ONLY and never looked at
   * props at all, so `setDoorState` changed a picture and nothing else.
   * Optional and defaulting to false, because most props (a torch, a rug)
   * really are decorative.
   */
  props: Record<TileId, { blocks?: boolean }>;
}
