/**
 * What the table's DM calls are made with: which model tier each kind of call
 * runs on, how much it may write, how long a cached prompt lives, and how many
 * repair rounds one job may spend.
 *
 * There is no price in this file on purpose. The platform's credit display
 * shows what AI use costs; the game never states a price, an estimate or a
 * number of credits anywhere a player can read it (owner decision, 2026-10-03).
 * Nothing here works out money, so there is nothing to keep in step with the
 * platform's rates.
 *
 * Pure: no DOM, no clock, no bridge. A host may import this at any time.
 */
import { THINKING_HEADROOM_TOKENS } from "../../../bridge/ai";
import type { ModelTier } from "../../../bridge/ai";

export type { ModelTier };

/** The three kinds of call the table makes (the sampler's modelTier values). */
export type CallKind = "quick" | "default" | "complex";

/** How long the platform keeps a cached prompt after its last use. */
export const CACHE_TTL_MS = 5 * 60 * 1000;
/** The rough size of a token in this app's prompts (English and JSON). */
export const CHARS_PER_TOKEN = 4;

// ---- how each kind of call is made --------------------------------------------

/**
 * The most each kind of call may write, thinking included. The capable and epic
 * tiers think before they answer and the thinking is paid out of this number, so
 * a tight value can return a reply with no text in it (bridge/ai.ts); the host
 * bills tokens actually used, so a roomy value costs nothing on a normal reply
 * (it only sets how much the proxy holds back while the call runs). The writer
 * gets its own, larger ceiling: a medium adventure is about 9,000 tokens.
 */
export const MAX_TOKENS: Readonly<Record<CallKind, number>> = Object.freeze({
  quick: 2000,
  default: THINKING_HEADROOM_TOKENS,
  complex: 16000,
});

/** The DM's own temperature (the campaign DM uses the same); the writer is freer. */
export const TEMPERATURE: Readonly<Record<CallKind, number>> = Object.freeze({
  quick: 0.5,
  default: 0.7,
  complex: 1,
});

export interface TierPolicy {
  /**
   * The model for the adventure writer. "capable" (Sonnet) unless the owner
   * agrees to "epic" (Opus). Off by default: nothing in the table asks for Opus.
   */
  writerTier?: "capable" | "epic";
}

/**
 * The bench's three sampler tiers on the platform's three: quick to cheap,
 * default to capable, complex to the writer's tier (capable unless the policy
 * says epic). Free accounts are moved onto the cheap model by the platform
 * whatever is asked.
 */
export function tierFor(kind: CallKind, policy: TierPolicy = {}): ModelTier {
  if (kind === "quick") return "cheap";
  if (kind === "complex") return policy.writerTier === "epic" ? "epic" : "capable";
  return "capable";
}

/** The most repair rounds one job may spend: a DM turn gets one, the writer two. */
export const MAX_REPAIRS: Readonly<Record<CallKind, number>> = Object.freeze({ quick: 0, default: 1, complex: 2 });

/** A rough token count for a piece of text, for the debug report. */
export function tokensOf(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}
