/**
 * What a call to the DM costs, worked out on the player's side, and the words
 * that say so.
 *
 * Why this exists. Every AI call in this app shows its price before the click
 * (DESIGN.md). The old promise, "1 credit per message", is wrong for the table
 * window's DM: its prompt is about 6,000 tokens, so one turn costs roughly 8 to
 * 60 credits, and the adventure writer costs 130 to 800. The host does not tell
 * an app what a call cost (the credit figure reaches only an app that declared
 * `credits.read`, and this one does not), so the price is an ESTIMATE and every
 * line here says "about". It is never presented as what was billed, unless the
 * host really did report a figure (see `afterLine`).
 *
 * The arithmetic is the platform's, copied here because the app cannot import
 * it (rates read from the ConjureOS worktree, 2026-10):
 *   credits = USD x 2000   (CREDIT_MARKUP 2.0 x 1000 credits per dollar)
 *   cheap  (Haiku 4.5)       $1 in /  $5 out per million tokens
 *   capable (Sonnet)         $3 in / $15 out (the platform bills Sonnet at this pinned rate)
 *   epic   (Opus)            $5 in / $25 out
 *   a cache read costs 10% of the input rate, a cache write 125%
 * Run on the measured Rat Cellar turn (24,055 characters, 500 output tokens,
 * Sonnet) it gives 51 credits uncached, 25 with the rules cached, 58 for the
 * turn that writes the cache; the tests pin those.
 *
 * Pure: no DOM, no clock, no bridge. A host may import this at any time.
 */
import { THINKING_HEADROOM_TOKENS } from "../../../bridge/ai";
import type { ModelTier } from "../../../bridge/ai";

export type { ModelTier };

/** The three kinds of call the table makes (the sampler's modelTier values). */
export type CallKind = "quick" | "default" | "complex";

// ---- the platform's price list -------------------------------------------------

export const CREDITS_PER_USD = 2000;

/** USD per million tokens. */
export const TIER_RATES: Readonly<Record<ModelTier, { in: number; out: number }>> = Object.freeze({
  cheap: { in: 1, out: 5 },
  capable: { in: 3, out: 15 },
  epic: { in: 5, out: 25 },
});

export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25;
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
   * agrees to "epic" (Opus, about 1.7 times the price of Sonnet). Off by
   * default: nothing in the table asks for Opus.
   */
  writerTier?: "capable" | "epic";
}

/**
 * The bench's three sampler tiers on the platform's three: quick to cheap,
 * default to capable, complex to the writer's tier (capable unless the policy
 * says epic). Free accounts are forced onto the cheap model by the platform
 * whatever is asked; `forcedCheap` says so for the estimate.
 */
export function tierFor(kind: CallKind, policy: TierPolicy = {}): ModelTier {
  if (kind === "quick") return "cheap";
  if (kind === "complex") return policy.writerTier === "epic" ? "epic" : "capable";
  return "capable";
}

/** The most repair rounds one job may spend: a DM turn gets one, the writer two (its prices below assume it). */
export const MAX_REPAIRS: Readonly<Record<CallKind, number>> = Object.freeze({ quick: 0, default: 1, complex: 2 });

// ---- sizes ---------------------------------------------------------------------

export function tokensOf(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

/**
 * What a typical Rat Cellar DM turn weighs, measured on a real prompt: the part
 * that is the same on every turn (rules, fight rules, output format, the
 * adventure's gospel block and brief) and the part that changes (the scene, the
 * world, the ask). Used for the price line shown before any prompt is built.
 */
export const TYPICAL_TURN = Object.freeze({ stableChars: 19564, liveChars: 4491 });

/** Output a DM turn is expected to write, in tokens: a short answer, the usual one, a long one with a check and options. */
export const DM_OUTPUT = Object.freeze({ low: 300, typical: 500, high: 900 });

/** The adventure writer's prompt (about 15,000 characters, the same for short and medium). */
export const WRITER_PROMPT_CHARS = 15035;
/** Output the writer is expected to write, in tokens, by length. A medium adventure is about 7,000 (the Rat Cellar file is about 9,000). */
export const WRITER_OUTPUT: Readonly<Record<"short" | "medium", number>> = Object.freeze({ short: 3500, medium: 7000 });
/** What a repair request adds on top of the prompt and the bad answer (the problem list), in tokens. */
export const REPAIR_NOTE_TOKENS = 500;

// ---- the estimate ---------------------------------------------------------------

export interface CallShape {
  /** The tier that will run (use `forcedCheap` for a free account). */
  tier: ModelTier;
  /** Characters in the part of the prompt that is the same call after call (the system prompt). */
  stableChars: number;
  /** Characters in the rest (the messages). */
  liveChars: number;
  /** True when the stable part was used within the cache's lifetime, so it may be read from the cache. */
  warm?: boolean;
  /**
   * True once the platform is known to cache the system prompt for this app
   * (measured with two turns inside five minutes, runbook step 7). Until then
   * a warm turn is shown as "between a cache read and no cache", and a cold one
   * as "between no cache and a cache write", so the line never promises a saving
   * the platform may not give.
   */
  cacheConfirmed?: boolean;
}

export interface OutputShape {
  low: number;
  typical: number;
  high: number;
}

export interface CostEstimate {
  tier: ModelTier;
  /** The least a turn is likely to cost, in credits (not rounded). */
  low: number;
  /** The usual cost. */
  likely: number;
  /** The most it is likely to cost without a retry. */
  high: number;
  /** The most it can cost at all: the whole token ceiling written. This is what the proxy holds while the call runs, not what is spent. */
  ceiling: number;
  inputTokens: number;
}

function usd(tier: ModelTier, inTokens: number, outTokens: number, inFactor = 1): number {
  const r = TIER_RATES[tier];
  return (inTokens * r.in * inFactor + outTokens * r.out) / 1_000_000;
}

function credits(tier: ModelTier, stableTokens: number, liveTokens: number, outTokens: number, stableFactor: number): number {
  const stable = usd(tier, stableTokens, 0, stableFactor);
  const live = usd(tier, liveTokens, 0, 1);
  const out = usd(tier, 0, outTokens, 1);
  return (stable + live + out) * CREDITS_PER_USD;
}

/**
 * Price one call before it is made.
 *
 * Which price the stable part gets depends on the cache: read (10%), none (100%)
 * or written (125%). `cacheConfirmed` picks how sure to be (see CallShape): a
 * warm turn spans read..none (just read once confirmed), a cold one spans
 * none..write (just write once confirmed). `likely` is the middle case: read
 * (warm, confirmed), write (cold, confirmed), else none.
 */
export function estimateCall(shape: CallShape, out: OutputShape, maxTokens: number): CostEstimate {
  const s = tokensOf(shape.stableChars);
  const l = tokensOf(shape.liveChars);
  const warm = shape.warm === true;
  const confirmed = shape.cacheConfirmed === true;
  const best = warm ? CACHE_READ_FACTOR : confirmed ? CACHE_WRITE_FACTOR : 1;
  const worst = warm ? (confirmed ? CACHE_READ_FACTOR : 1) : CACHE_WRITE_FACTOR;
  const mid = confirmed ? (warm ? CACHE_READ_FACTOR : CACHE_WRITE_FACTOR) : 1;
  const lowFactor = Math.min(best, worst);
  const highFactor = Math.max(best, worst);
  return {
    tier: shape.tier,
    low: credits(shape.tier, s, l, out.low, lowFactor),
    likely: credits(shape.tier, s, l, out.typical, mid),
    high: credits(shape.tier, s, l, out.high, highFactor),
    ceiling: credits(shape.tier, s, l, maxTokens, CACHE_WRITE_FACTOR),
    inputTokens: s + l,
  };
}

/**
 * Price a DM turn from the prompt that is about to go out, split the way the
 * adapter splits it (system holds the stable part).
 */
export function estimateDmTurn(args: { tier: ModelTier; stableChars: number; liveChars: number; warm?: boolean; cacheConfirmed?: boolean; maxTokens?: number }): CostEstimate {
  return estimateCall({ tier: args.tier, stableChars: args.stableChars, liveChars: args.liveChars, ...(args.warm !== undefined ? { warm: args.warm } : {}), ...(args.cacheConfirmed !== undefined ? { cacheConfirmed: args.cacheConfirmed } : {}) }, DM_OUTPUT, args.maxTokens ?? MAX_TOKENS.default);
}

/** The price line for a turn before any prompt is built: the typical Rat Cellar turn, cold, on the given tier. */
export function typicalDmTurn(tier: ModelTier, opts: { warm?: boolean; cacheConfirmed?: boolean } = {}): CostEstimate {
  return estimateDmTurn({ tier, ...TYPICAL_TURN, ...opts });
}

export interface WriterEstimate {
  tier: ModelTier;
  /** One pass, nothing to repair. */
  low: number;
  /** The same as `low`: most adventures are meant to pass on the first go. */
  likely: number;
  /** Every repair round spent. */
  high: number;
  repairs: number;
  /** What the proxy holds while one call runs (the token ceiling written). */
  ceiling: number;
}

/**
 * Price the adventure writer: one pass, and the worst case with every repair
 * round used (each repair sends the prompt, the bad answer and the problem list
 * again, and writes a whole answer again). On Sonnet this gives about 130 for a
 * short one (430 worst) and 230 for a medium one (790 worst).
 */
export function estimateWriter(length: "short" | "medium", tier: ModelTier, repairs: number = MAX_REPAIRS.complex): WriterEstimate {
  const prompt = tokensOf(WRITER_PROMPT_CHARS);
  const out = WRITER_OUTPUT[length];
  const pass = usd(tier, prompt, out) * CREDITS_PER_USD;
  const repair = usd(tier, prompt + out + REPAIR_NOTE_TOKENS, out) * CREDITS_PER_USD;
  const n = Math.max(0, Math.floor(repairs));
  return {
    tier,
    low: pass,
    likely: pass,
    high: pass + repair * n,
    repairs: n,
    ceiling: usd(tier, prompt + out + REPAIR_NOTE_TOKENS, MAX_TOKENS.complex) * CREDITS_PER_USD,
  };
}

// ---- words ---------------------------------------------------------------------

/** Credits as a person reads them: whole up to 20, then to the nearest 5, then to the nearest 10. */
export function roundCredits(n: number): number {
  const v = Math.max(0, n);
  const step = v < 20 ? 1 : v < 100 ? 5 : 10;
  return Math.max(1, Math.round(v / step) * step);
}

const credits1 = (n: number): string => `${n} credit${n === 1 ? "" : "s"}`;

/** "about 25 to 60 credits", or "about 25 credits" when the two ends round alike. */
export function creditRange(low: number, high: number): string {
  const a = roundCredits(low);
  const b = roundCredits(high);
  return a >= b ? `about ${credits1(b)}` : `about ${a} to ${b} credits`;
}

export const FREE_PLAN_NOTE = "Free accounts run this on a smaller, cheaper model.";

/**
 * The line beside the ask, before the click. "A turn costs about 25 to 60
 * credits from your ConjureOS balance." Says how a free account differs when
 * the plan is not known to be free.
 */
export function turnPriceLine(est: CostEstimate, opts: { forcedCheap?: boolean } = {}): string {
  const base = `A turn costs ${creditRange(est.low, est.high)} from your ConjureOS balance.`;
  return opts.forcedCheap || est.tier === "cheap" ? base : `${base} ${FREE_PLAN_NOTE}`;
}

/** The price line for the AI adventure writer button, with the worst case and the cancel warning. */
export function writerPriceLine(est: WriterEstimate): string {
  return (
    `Having the AI write an adventure costs ${creditRange(est.low, est.low)} from your ConjureOS balance, ` +
    `and up to about ${roundCredits(est.high)} if it needs ${est.repairs === 1 ? "a rewrite" : `${est.repairs} rewrites`} to pass the checks. ` +
    "It takes a few minutes. Stopping it part way does not refund what has been used. Adventures written by hand cost nothing to load."
  );
}

/** The line shown while a repair is on its way: it resends the whole prompt. */
export const RETRY_LINE = "The answer could not be used, so the DM is trying once more. This costs again.";

/** What a finished call tells the player it cost. */
export interface Spend {
  /** Credits. When `exact` is false this is the player-side estimate. */
  credits: number;
  /** True only when the host reported the figure (an app with `credits.read`). */
  exact: boolean;
}

/**
 * "about 25 credits" after the call, from what was really sent and received.
 * The output is counted from the reply's length, and any hidden thinking is not
 * seen, so it can undershoot a little; that is why it says "about". When the
 * host reported the real figure it says "N credits" with no "about".
 */
export function estimateSpend(args: { tier: ModelTier; stableChars: number; liveChars: number; outputChars: number; warm?: boolean; cacheConfirmed?: boolean }): Spend {
  const est = estimateCall(
    { tier: args.tier, stableChars: args.stableChars, liveChars: args.liveChars, ...(args.warm !== undefined ? { warm: args.warm } : {}), ...(args.cacheConfirmed !== undefined ? { cacheConfirmed: args.cacheConfirmed } : {}) },
    { low: tokensOf(args.outputChars), typical: tokensOf(args.outputChars), high: tokensOf(args.outputChars) },
    MAX_TOKENS.default,
  );
  return { credits: est.likely, exact: false };
}

export function afterLine(spend: Spend): string {
  if (spend.exact) {
    const n = Math.max(0, Math.round(spend.credits));
    return credits1(n);
  }
  return `about ${credits1(roundCredits(spend.credits))}`;
}
