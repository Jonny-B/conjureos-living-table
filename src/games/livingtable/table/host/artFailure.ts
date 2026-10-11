/**
 * Why the game's art could not be had, in the words a player reads.
 *
 * Every way an art file can fail is one of a few kinds, and each kind has ONE fixed plain sentence (ART_FAILURE_TEXT). The raw detail of
 * a failure (an HTTP status, an exception's message, the platform's reason code) never reaches the screen: gameArt.ts sends it to
 * console.warn for whoever is diagnosing, and the gate (artGate.ts) shows the sentence of the kind and nothing else.
 *
 * Pure and import-free, so it runs under Node.
 */

/**
 * What went wrong, as far as a player can do anything about it:
 *   download     the file did not come (no connection, the server said no, or it took too long): check the connection and try again
 *   damaged      the file came but is not whole or not what the game expects: try again
 *   unavailable  the game has no such file just now (not in this build, over the size limit, not known to the app): try again later
 *   mismatch     the files do not fit each other or the game (the board art is for other colours than the game's): try again later
 *   update       the ConjureOS app is there but is too old to give a game its files: update the app (Retry cannot help)
 *   outside      the game is not inside the ConjureOS app at all: open it there
 *   unknown      anything else
 */
export type ArtFailure = "download" | "damaged" | "unavailable" | "mismatch" | "update" | "outside" | "unknown";

/** The oldest phone app that gives a game its asset files. */
export const PHONE_APP_WITH_ASSETS = "0.59.1";

/** The one sentence each kind of failure is shown as. Plain and short: no status code, no exception text, no reason code, no parentheses. */
export const ART_FAILURE_TEXT: Readonly<Record<ArtFailure, string>> = {
  download: "The game's art could not be downloaded. Check your connection and try again.",
  damaged: "The game's art file was damaged. Try again.",
  unavailable: "The game's art is not available right now. Try again later.",
  mismatch: "The game's art does not match this version of the game. Try again later.",
  update: `This version of the ConjureOS app cannot download the game's art. Update the app to play. The phone app needs version ${PHONE_APP_WITH_ASSETS} or newer.`,
  outside: "Open the game in the ConjureOS app to play it.",
  unknown: "The game's art could not be loaded. Try again.",
};

/** The kinds for which Retry could never work (the same thing would happen again), so the screen does not offer it. */
export const ART_NO_RETRY: readonly ArtFailure[] = ["update"];

/** Whether a Retry button makes sense for this failure. */
export function canRetryArt(failure: ArtFailure | undefined): boolean {
  return !(failure !== undefined && ART_NO_RETRY.includes(failure));
}

/** The sentence a player reads for a failure. A part that gave no kind gets the "unknown" sentence, never its own text. */
export function artSentence(failure: ArtFailure | undefined): string {
  return failure !== undefined && failure in ART_FAILURE_TEXT ? ART_FAILURE_TEXT[failure] : ART_FAILURE_TEXT.unknown;
}

/** What the platform's `assets.load` reason codes mean to a player. A code nobody knows is "unknown", never printed. */
export function bridgeFailure(reason: unknown): ArtFailure {
  switch (reason) {
    case "fetch_failed":
      return "download";
    case "mismatch":
      return "damaged";
    case "unknown_name":
    case "too_large":
      return "unavailable";
    default:
      return "unknown";
  }
}
