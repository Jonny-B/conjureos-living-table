/**
 * The art gate: the game does not show its window until both art files are in.
 *
 * The KayKit art ships as two asset files (assetFiles.ts, loaded by gameArt.ts): the animated figures and the board art. Until
 * both are loaded the only pictures there are would be the old hand-drawn ones, and a player must never see those standing in for
 * a picture that has a KayKit version. So the screen waits here, after the splash and before the window mounts (so before the
 * main menu, the hero choice, the maker or the board can show):
 *
 *   const result = await waitForArt(game.art);
 *   if (result.state === "ready") mount();                   // go on to the main menu
 *   else showTheArtScreen(result.reasons, result.retry);     // plain sentences; a Retry button when result.retry; Retry is retryArt
 *
 * `waitForArt` never rejects and never gives up on its own: a file that is slow to arrive is waited for (the splash says so; a file
 * that takes longer than its time limit counts as a failed download, see gameArt.ts), a file that cannot be had ends the wait with
 * one fixed plain sentence per kind of failure (artFailure.ts; never the raw detail, which goes to the log). `retryArt` is what the
 * Retry button calls: the whole art load again (the games-db manifest from the server, then the parts that failed), then the wait.
 * Parts that loaded are kept, so nothing is downloaded twice.
 *
 * Pure over the art's `assetStatus()`; import-free of the page, so it runs under Node.
 */
import type { AssetStatus, GameArt } from "./gameArt";
import { ART_FAILURE_TEXT, artSentence, canRetryArt } from "./artFailure";

/** The part of the game's art the gate reads. */
export type ArtGateArt = Pick<GameArt, "loadAssets" | "assetStatus">;

/** The part of the game's art a Retry uses: the whole load again, then the wait. */
export type ArtRetryArt = ArtGateArt & Pick<GameArt, "load">;

/**
 * Where the art is: still on its way, in (the game may go on), or not loaded (why: one fixed plain sentence per kind of failure,
 * never repeated; and whether a Retry could help, which it cannot when the ConjureOS app is too old to hand over the files).
 */
export type ArtGate = { state: "waiting" } | { state: "ready" } | { state: "failed"; reasons: string[]; retry: boolean };

/** What the player is told when a part did not load and gave no kind of failure. */
export const ART_FAILED_FALLBACK = ART_FAILURE_TEXT.unknown;

/**
 * Where the art is right now, from its status. Does not wait. What a part says about itself in words (`reason`) is not read: the
 * sentence comes from the part's kind of failure, so no raw text can reach the screen through here.
 */
export function artGateOf(status: AssetStatus): ArtGate {
  const parts = [status.cast, status.library];
  const failed = parts.filter((p) => p.state === "fallback");
  if (failed.length > 0) {
    const reasons: string[] = [];
    for (const p of failed) {
      const why = artSentence(p.failure);
      if (!reasons.includes(why)) reasons.push(why);
    }
    // One part that no Retry can fix keeps the game from going on, whatever the other does: no Retry button then.
    return { state: "failed", reasons, retry: failed.every((p) => canRetryArt(p.failure)) };
  }
  return parts.every((p) => p.state === "ready") ? { state: "ready" } : { state: "waiting" };
}

/** Whether the art is in, from the art itself. Does not wait, and does not start anything. */
export function artIsReady(art: Pick<GameArt, "assetStatus">): boolean {
  return artGateOf(art.assetStatus()).state === "ready";
}

/**
 * Wait until both art files are in or one cannot be had. Starts (or joins) the load, and tries a part that failed before again. Never
 * rejects. Call it once `art.load()` has settled (the game host's `open()` does that first): the board art is laid over the hand-drawn art
 * that load settles, so it has nothing to be laid over before then.
 */
export async function waitForArt(art: ArtGateArt): Promise<Exclude<ArtGate, { state: "waiting" }>> {
  try {
    await art.loadAssets();
  } catch {
    // loadAssets does not reject (each part reports its own failure); this is the net under that promise.
  }
  const gate = artGateOf(art.assetStatus());
  // After loadAssets has settled every part is ready or failed. Anything else means the art was let go under the wait (the screen is leaving).
  return gate.state === "waiting" ? { state: "failed", reasons: [ART_FAILED_FALLBACK], retry: true } : gate;
}

/**
 * The Retry button: the whole art load again, then the wait. The games-db manifest is asked for afresh (a cached copy is what may have
 * been refused, and a server library that has been fixed is only seen by asking) and the kept KayKit library is laid over it again; the
 * parts that failed are loaded again and the ones that loaded are not. Never rejects.
 *
 * The games-db call has no time limit of its own, so Retry waits for it at most `reloadTimeoutMs` and then goes on with what was
 * settled before: a call that never answers must not hold the "Getting the art ready" screen forever (each file load has its own limit).
 */
export async function retryArt(art: ArtRetryArt, opts: { reloadTimeoutMs?: number } = {}): Promise<Exclude<ArtGate, { state: "waiting" }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      art.load({ fresh: true }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, opts.reloadTimeoutMs ?? ART_RELOAD_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // The games-db art could not be had this time; what was settled before stays, and the wait below says what still fails.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return waitForArt(art);
}

/** How long Retry waits for the games-db art before going on with what it already has. */
export const ART_RELOAD_TIMEOUT_MS = 30_000;
