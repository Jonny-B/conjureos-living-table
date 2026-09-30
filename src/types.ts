/** Shared shapes across Conjure Games' games. */

/** `jumprunner` is the one game here with no AI in it, see JumpRunner.tsx. */
export type GameId = "threads" | "coldcase" | "vault" | "jumprunner";

// ── Threads (the daily grouping puzzle) ─────────────────────────────────

export interface ThreadsGroup {
  /** The connection, revealed when the group is solved. */
  name: string;
  /** Exactly four members. */
  words: string[];
  /** 1 = most obvious, 4 = the trap. Drives the tile colour on reveal. */
  level: number;
}

export interface ThreadsPayload {
  /** What the whole puzzle is loosely about, shown as a subtitle. */
  theme: string;
  /** The sixteen tiles, pre-shuffled by whoever generated the puzzle. */
  words: string[];
}

export interface ThreadsSolution {
  groups: ThreadsGroup[];
}

// ── Cold Case (the five-suspect mystery) ────────────────────────────────

/**
 * Note what is NOT here: a `guilty` boolean. The suspect list ships to the
 * client (the interrogation runs there, on the player's credits, so the model
 * needs every suspect's private instructions), and a boolean would let anyone
 * with devtools solve the case with one glance. Instead each suspect carries a
 * prose `brief` written in the second person, and guilt is encoded in what that
 * brief tells them to do. The culprit's name lives only in the server-side
 * solution, and `accuse` is checked there.
 */
export interface Suspect {
  name: string;
  role: string;
  /** One-line description shown on the suspect card. */
  blurb: string;
  /** Where they say they were. Public, shown on the card. */
  alibi: string;
  /** Private in-character direction for the model. Never rendered. */
  brief: string;
  /**
   * AUTHORED, NOT HASHED. The portrait's silhouette used to be a hash of the
   * name, so "Clara Boyd, theatre patron" drew a black bowler hat and pointed
   * lapels and a leading actress got the same face geometry as an understudy.
   * The generator already makes one call per case; naming the look costs no
   * extra generation and stops the lineup, the one object whose entire job is
   * telling five people apart, arguing with its own copy.
   *
   * Optional because a stored case from before this field, or a model that
   * omits it, must still render: `PlatePortrait` falls back to the hash.
   */
  look?: SuspectLook;
}

/** The six silhouettes `PlatePortrait` draws, in the model's own vocabulary. */
export type SuspectLook = "short" | "long" | "swept" | "cap" | "fedora" | "bob";

export interface ColdCasePayload {
  title: string;
  /** Two or three sentences setting the scene. */
  setup: string;
  /** What was actually done, without saying by whom. */
  crime: string;
  suspects: Suspect[];
}

export interface ColdCaseSolution {
  culprit: string;
  motive: string;
  /** The chain of reasoning, shown after the accusation. */
  reveal: string;
}

// ── The Vault ───────────────────────────────────────────────────────────

export interface VaultLevelView {
  level: number;
  codename: string;
  brief: string;
  cracked: boolean;
  unlocked: boolean;
  attempts: number;
  /** Share of all runs at this level that ended cracked, or null if untried. */
  crackRate: number | null;
  /**
   * BE-2, ADDITIVE AND OPTIONAL. GAMEPLAY_SPEC §11 ships these as new fields on
   * an existing action, so a client running against a backend that predates
   * them gets `undefined`, and must cope. §6.3 says how: fall back to a par of
   * 8 and hide the histogram. Never render an empty distribution; an empty
   * chart is a bug report waiting to happen, exactly like an empty board.
   */
  medianTurns?: number | null;
  /** Exactly twelve buckets: `[0]` = 1 message … `[11]` = 12+. */
  turnsHistogram?: number[] | null;
  /** BE-2: the keeper's par, the real median once enough cracks exist and a
   *  coded value until then. Absent from an older backend. */
  par?: number;
  /** BE-2: this player's own latest crack of this keeper, and its score. */
  turns?: number | null;
  score?: number | null;
  /** BE-2: this player's best score on this keeper. For beating yourself;
   *  never a ranking. */
  best?: number | null;
  bestTurns?: number | null;
}

export interface VaultRun {
  runId: string;
  level: number;
  codename: string;
  brief: string;
  systemPrompt: string;
}

// ── Player-facing bookkeeping ───────────────────────────────────────────

export interface Streak {
  game: GameId;
  current: number;
  best: number;
  lastWonOn: string | null;
  lastPlayedOn: string | null;
  plays: number;
  wins: number;
}

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  score: number;
  mistakes: number;
  durationMs: number | null;
}
