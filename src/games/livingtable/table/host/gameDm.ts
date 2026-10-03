/**
 * The shipped game's DM: an adapter that turns the table window's sampler
 * (`SampleFn`, what dmCore's askDm and the adventure writer call) into calls on
 * the ConjureOS bridge (`ai.complete`, through src/bridge/ai.ts).
 *
 * What it does, and why each part exists (the money is real, so every rule here
 * is about spending less, or being honest about what was spent):
 *
 *   tiers        The sampler's quick / default / complex become the platform's
 *                cheap / capable / capable (see cost.ts: tierFor). The writer
 *                runs on Opus only if the host opts in with `writerTier: "epic"`.
 *   max tokens   8,000 for a DM turn (the capable tier thinks before it answers
 *                and the thinking is paid out of the ceiling), 16,000 for the
 *                writer, 2,000 for a quick call. The host bills what is used.
 *   caching      A DM turn's prompt is split in two. The part that is the same
 *                every turn (rules, fight rules, output format, the adventure's
 *                gospel block and brief) goes in `system`, byte for byte, so the
 *                platform can cache it. The live part (progress steps, people
 *                here, the world, the ask) goes in the user message. A repair
 *                resends the same system, so it reads the cache too. The split
 *                finds its seams by the section headers dmCore writes (see
 *                splitDmInput); a prompt without them goes whole in the user
 *                message and simply does not cache.
 *   one at once  One call in flight, always. A second ask while one is running
 *                is refused ("busy"), because the proxy holds the worst-case
 *                price of a call while it runs. A call the player cancelled is
 *                still running on the platform (the bridge cannot stop it, and
 *                it is still billed), so the next call waits for it to finish
 *                rather than stacking a second one on top.
 *   repairs      A DM turn may spend ONE repair round, the writer two; a third
 *                call in a row is refused without being sent (code
 *                "repair_limit"). Each repair resends the prompt and the bad
 *                answer, so the host is told ("start" event, repair true) and
 *                the window can say "trying again, this costs again".
 *   streaming    Every call streams, because the bridge's 60 second idle timer
 *                only resets on a chunk and a whole written adventure takes
 *                minutes. The narration reaches the window live through onText.
 *   cancelling   Abort rejects with code "cancelled" and drops the reply. The
 *                credits are still spent; a "dropped" event reports it when the
 *                call finishes anyway.
 *   errors       The bridge rejects with a plain Error whose message is the
 *                host's words (no code). This maps them to the codes dmCore's
 *                failFor reads (not_granted, rate_limited, cancelled) and a few
 *                more it lets through as the generic line (out_of_credits,
 *                app_budget, not_foreground, timeout, busy, repair_limit). The
 *                original text stays in Error.message for the debug export and
 *                is never shown to the player.
 *   price        `estimate()` prices a call before it is sent, `costNote` is the
 *                line to show beside the ask, and every finished call reports
 *                "about N credits" (or the exact figure when the host reported
 *                it, which only happens for an app with `credits.read`).
 *
 * No DOM, no clock at import, no network at import: the bridge is only touched
 * when a call is made. Tests pass their own `complete`.
 */
import { completeDetailed, isAiAvailable, type CompleteRequest, type CompleteResult } from "../../../../bridge/ai";
import type { SampleFn, TableDm } from "../host";
import {
  CACHE_TTL_MS,
  MAX_REPAIRS,
  MAX_TOKENS,
  RETRY_LINE,
  TEMPERATURE,
  afterLine,
  creditRange,
  estimateCall,
  estimateDmTurn,
  estimateSpend,
  estimateWriter,
  tierFor,
  tokensOf,
  turnPriceLine,
  typicalDmTurn,
  writerPriceLine,
  DM_OUTPUT,
  WRITER_OUTPUT,
  type CallKind,
  type CostEstimate,
  type ModelTier,
  type Spend,
  type WriterEstimate,
} from "../cost";

type SampleInput = Parameters<SampleFn>[0];
type SampleOpts = NonNullable<Parameters<SampleFn>[1]>;

// ---- errors ----------------------------------------------------------------------

export type DmErrorCode =
  | "not_granted"
  | "rate_limited"
  | "out_of_credits"
  | "app_budget"
  | "not_foreground"
  | "timeout"
  | "cancelled"
  | "busy"
  | "repair_limit"
  | "upstream_error";

/** An error dmCore's failFor can read: it looks for `code`. */
export class DmCallError extends Error {
  readonly code: DmErrorCode;
  constructor(code: DmErrorCode, message: string) {
    super(message);
    this.name = "DmCallError";
    this.code = code;
  }
}

/**
 * The bridge's rejections are `new Error(host words)`; the words come from the
 * kernel's gates ("app does not have ai.complete permission", "ai.complete rate
 * limit (burst): ...", "ai.complete blocked: ConjureOS is in the background"),
 * the hosted adapter ("You're out of credits ...") and the shim ("ai timeout").
 */
export function codeForError(e: unknown): DmErrorCode {
  if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") {
    const c = (e as { code: string }).code;
    if (isCode(c)) return c;
  }
  const msg = (e instanceof Error ? e.message : e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : String(e ?? "")).toLowerCase();
  if (/does not have .*permission|not granted|permission/.test(msg)) return "not_granted";
  if (/out of credits|out_of_credits/.test(msg)) return "out_of_credits";
  if (/budget/.test(msg)) return "app_budget";
  if (/rate limit|rate_limit|too many|daily cap|429/.test(msg)) return "rate_limited";
  if (/background|minimi[sz]ed/.test(msg)) return "not_foreground";
  if (/timeout|timed out/.test(msg)) return "timeout";
  return "upstream_error";
}

const CODES: readonly string[] = ["not_granted", "rate_limited", "out_of_credits", "app_budget", "not_foreground", "timeout", "cancelled", "busy", "repair_limit", "upstream_error"];
function isCode(c: string): c is DmErrorCode {
  return CODES.includes(c);
}

// ---- the prompt split --------------------------------------------------------------

const ADVENTURE_HEAD = "\n\n=== THE ADVENTURE (GOSPEL) ===";
const LIVE_ADVENTURE = "\n\nPROGRESS EFFECTS YOU MAY USE NOW";
const WORLD_HEAD = "\n\n=== THE WORLD (";

/** Below this, a stable part is too small to be worth separating (and likely under the platform's minimum cacheable size). */
const MIN_STABLE_CHARS = 200;

/**
 * Split dmCore's buildDmInput into the part that is the same every turn and the
 * part that changes. The seams are headers dmCore writes (the test pins them
 * against the real builder): with an adventure the stable part ends where the
 * progress steps begin, so it holds the rules, the format, the gospel rules and
 * the brief; without one it ends where the world begins. `system + "\n\n" +
 * user` is always the original text, so a bad seam can only cost the cache,
 * never change what the model reads. Returns null when there is no seam.
 */
export function splitDmInput(input: string): { system: string; user: string } | null {
  const world = input.indexOf(WORLD_HEAD);
  if (world < 0) return null;
  let cut = world;
  const adv = input.indexOf(ADVENTURE_HEAD);
  if (adv >= 0 && adv < world) {
    const live = input.indexOf(LIVE_ADVENTURE, adv);
    if (live >= 0 && live < world) cut = live;
  }
  if (cut < MIN_STABLE_CHARS) return null;
  return { system: input.slice(0, cut), user: input.slice(cut + 2) };
}

/** What `system` holds when nothing could be split off: a short line, since the whole prompt rides in the user message. */
export const DM_SYSTEM_STUB = "You are the Dungeon Master of a solo dungeon crawl. Follow the instructions in the message exactly and reply as they say.";
export const WRITER_SYSTEM_STUB = "You write one complete adventure file for a tabletop-style game, in the exact format the message gives. Reply with the file and nothing else.";

interface Prepared {
  req: CompleteRequest;
  /** Characters in `system`, the cacheable part. */
  stableChars: number;
  /** Characters in the messages. */
  liveChars: number;
  /** A conversation (the prompt, a bad answer, the problems) rather than a first ask. */
  repair: boolean;
}

function prepare(input: SampleInput, kind: CallKind, tier: ModelTier): Prepared {
  let system = kind === "complex" ? WRITER_SYSTEM_STUB : DM_SYSTEM_STUB;
  let messages: { role: "user" | "assistant"; content: string }[];
  let repair = false;
  let split = false;
  if (typeof input === "string") {
    const sp = kind === "default" ? splitDmInput(input) : null;
    if (sp) {
      system = sp.system;
      split = true;
      messages = [{ role: "user", content: sp.user }];
    } else messages = [{ role: "user", content: input }];
  } else {
    repair = input.length > 1;
    const [head, ...rest] = input;
    const sp = head && head.role === "user" && kind === "default" ? splitDmInput(head.content) : null;
    if (sp && head) {
      system = sp.system;
      split = true;
      messages = [{ role: "user", content: sp.user }, ...rest];
    } else messages = input.map((m) => ({ role: m.role, content: m.content }));
  }
  const live = messages.reduce((n, m) => n + m.content.length, 0);
  return {
    req: { system, messages, maxTokens: MAX_TOKENS[kind], tier, temperature: TEMPERATURE[kind] },
    stableChars: split ? system.length : 0,
    liveChars: live + (split ? 0 : system.length),
    repair,
  };
}

// ---- events and reports ---------------------------------------------------------------

export interface DmReport {
  kind: CallKind;
  /** The tier that was asked for (a free account is moved to the cheap model by the platform). */
  tier: ModelTier;
  repair: boolean;
  spend: Spend;
  /** "about 25 credits", or "25 credits" when the host reported the figure. Ready to show. */
  line: string;
  inputTokens: number;
  outputTokens: number;
  /** The system prompt was the one used inside the cache's lifetime. */
  warm: boolean;
  ms: number;
}

export type DmEvent =
  /** A call is about to be sent. `repair` true means it resends everything and costs again; `line` is the price to show. */
  | { type: "start"; kind: CallKind; repair: boolean; estimate: CostEstimate; line: string }
  /** A call finished and was used. */
  | { type: "done"; report: DmReport }
  /** The player cancelled, the reply was dropped, and the call finished anyway: the credits were spent. */
  | { type: "dropped"; report: DmReport }
  | { type: "fail"; kind: CallKind; code: DmErrorCode };

// ---- the adapter -------------------------------------------------------------------------

export interface GameDmOptions {
  /** The call to the model. Default: src/bridge/ai.ts's completeDetailed (the bridge, or its dev mock). Tests pass a scripted one. */
  complete?: (req: CompleteRequest) => Promise<CompleteResult>;
  /** Milliseconds, for the cache window and the timings. Default Date.now. */
  now?: () => number;
  /** The writer's model. Default "capable"; "epic" (Opus) only when the owner agrees. */
  writerTier?: "capable" | "epic";
  /** True when the player's plan runs every call on the cheap model (a free account). Only changes the price shown. */
  forcedCheap?: boolean;
  /** True once the platform is known to cache the system prompt (two turns inside five minutes, compared). Otherwise it is learned from a reply that reports cache reads. */
  cacheConfirmed?: boolean;
  /** True: `sample()` is null outside ConjureOS instead of the dev mock, so the window says the DM is unavailable. Default false (the dev mock answers, as for the campaign DM). */
  requireBridge?: boolean;
  /** Most repair rounds in a row, per kind. Defaults: cost.ts MAX_REPAIRS. */
  maxRepairs?: Partial<Record<CallKind, number>>;
}

export interface GameDm {
  /** What goes in `host.dm`. Its `costNote` is a getter: the price line for a typical turn, in the cache state the DM is in now. */
  dm: TableDm;
  /** Price a call before sending it, from the prompt the window built. For a first ask or a repair conversation. */
  estimate(input: SampleInput, kind?: CallKind): { estimate: CostEstimate; line: string };
  /** The line for the adventure writer's button: price, worst case, and that cancelling does not refund. */
  writerLine(length: "short" | "medium"): string;
  writerEstimate(length: "short" | "medium"): WriterEstimate;
  /** The report of the last finished call, or null. */
  last(): DmReport | null;
  /** The sum of this session's reports (an estimate unless every one was exact). */
  total(): { credits: number; calls: number; exact: boolean };
  /** True while a call is running, cancelled or not. The window keeps the ask button off while it is. */
  busy(): boolean;
  /** True when the next call would find the system prompt in the cache (the last call used it less than five minutes ago). */
  warm(): boolean;
  /** Listen for start, done, dropped and fail. Returns the unsubscribe. */
  subscribe(cb: (e: DmEvent) => void): () => void;
  /** The `sample` the window calls, same as `await dm.sample()`. */
  sampler: SampleFn;
  /** Forget every listener. A call already running finishes and is billed. */
  dispose(): void;
}

interface Flight {
  abandoned: boolean;
  done: Promise<void>;
}

export const UNAVAILABLE = "The DM needs your permission to use AI. Turn on AI for this app in ConjureOS, then try again.";

export function createGameDm(options: GameDmOptions = {}): GameDm {
  const complete = options.complete ?? completeDetailed;
  const now = options.now ?? Date.now;
  const policy = { writerTier: options.writerTier ?? "capable" } as const;
  const forcedCheap = options.forcedCheap === true;
  let cacheConfirmed = options.cacheConfirmed === true;
  const repairCap = (k: CallKind): number => options.maxRepairs?.[k] ?? MAX_REPAIRS[k];

  const listeners = new Set<(e: DmEvent) => void>();
  const emit = (e: DmEvent): void => {
    for (const cb of [...listeners]) {
      try {
        cb(e);
      } catch {
        // a listener must never break a call
      }
    }
  };

  let flight: Flight | null = null;
  let lastReport: DmReport | null = null;
  let lastSystem: string | null = null;
  let lastAt = 0;
  const streak: Record<CallKind, number> = { quick: 0, default: 0, complex: 0 };
  const sum = { credits: 0, calls: 0, exact: true };

  const effectiveTier = (tier: ModelTier): ModelTier => (forcedCheap ? "cheap" : tier);
  const isWarm = (system: string): boolean => lastSystem !== null && system === lastSystem && now() - lastAt < CACHE_TTL_MS;

  const cancelled = (): DmCallError => new DmCallError("cancelled", "The call was cancelled.");

  function estimateFor(p: Prepared, kind: CallKind, tier: ModelTier): CostEstimate {
    const t = effectiveTier(tier);
    if (kind === "default") {
      return estimateDmTurn({ tier: t, stableChars: p.stableChars, liveChars: p.liveChars, warm: p.stableChars > 0 && isWarm(p.req.system), cacheConfirmed, maxTokens: p.req.maxTokens ?? MAX_TOKENS.default });
    }
    const out = kind === "complex" ? { low: WRITER_OUTPUT.short, typical: WRITER_OUTPUT.short, high: WRITER_OUTPUT.medium } : DM_OUTPUT;
    return estimateCall({ tier: t, stableChars: p.stableChars, liveChars: p.liveChars }, out, p.req.maxTokens ?? MAX_TOKENS[kind]);
  }

  function estimate(input: SampleInput, kind: CallKind = "default"): { estimate: CostEstimate; line: string } {
    const tier = tierFor(kind, policy);
    const p = prepare(input, kind, tier);
    const est = estimateFor(p, kind, tier);
    return { estimate: est, line: turnPriceLine(est, { forcedCheap }) };
  }

  /** Wait for an abandoned call to finish, giving up if this call is cancelled meanwhile. */
  function waitFor(f: Flight, signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(cancelled());
      const onAbort = (): void => reject(cancelled());
      signal?.addEventListener("abort", onAbort, { once: true });
      void f.done.then(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  }

  const writerEstimate = (length: "short" | "medium"): WriterEstimate => estimateWriter(length, effectiveTier(tierFor("complex", policy)), repairCap("complex"));
  const writerLine = (length: "short" | "medium"): string => writerPriceLine(writerEstimate(length));

  const sampler: SampleFn = async (input: SampleInput, opts: SampleOpts = {}) => {
    const kind: CallKind = opts.modelTier === "quick" || opts.modelTier === "complex" ? opts.modelTier : "default";
    const signal = opts.signal;
    if (signal?.aborted) throw cancelled();

    // One call at a time. A call still wanted is a real clash; one the player cancelled is still running, so wait for it.
    while (flight) {
      if (!flight.abandoned) {
        emit({ type: "fail", kind, code: "busy" });
        throw new DmCallError("busy", "A DM call is already running.");
      }
      await waitFor(flight, signal);
    }

    const tier = tierFor(kind, policy);
    const p = prepare(input, kind, tier);
    if (p.repair) {
      if (streak[kind] >= repairCap(kind)) {
        emit({ type: "fail", kind, code: "repair_limit" });
        throw new DmCallError("repair_limit", "The repair limit for this job is spent; nothing was sent.");
      }
      streak[kind] += 1;
    } else streak[kind] = 0;

    const est = estimateFor(p, kind, tier);
    const warm = p.stableChars > 0 && isWarm(p.req.system);
    const startedAt = now();
    let dropped = false;
    const req: CompleteRequest = {
      ...p.req,
      onChunk: (delta, text) => {
        if (dropped) return;
        try {
          opts.onText?.({ text, delta });
        } catch {
          // live text is a nicety; a throwing listener must never break the call
        }
      },
    };

    emit({ type: "start", kind, repair: p.repair, estimate: est, line: p.repair ? RETRY_LINE : kind === "complex" ? `The writer costs ${creditRange(est.low, est.high)} for this pass.` : turnPriceLine(est, { forcedCheap }) });

    let started: Promise<CompleteResult>;
    try {
      started = complete(req);
    } catch (e) {
      const code = codeForError(e);
      emit({ type: "fail", kind, code });
      throw new DmCallError(code, e instanceof Error ? e.message : String(e));
    }
    let release!: () => void;
    const me: Flight = { abandoned: false, done: new Promise<void>((r) => (release = r)) };
    // First handler on the call, so the slot is free before anything the caller does next (a repair) can look at it.
    const finish = (): void => {
      if (flight === me) flight = null;
      release();
    };
    started.then(finish, finish);
    flight = me;

    const report = (res: CompleteResult): DmReport => {
      const usage = res.usage;
      if (usage && (usage.cacheReadInputTokens ?? 0) > 0) cacheConfirmed = true;
      const outputChars = typeof res.content === "string" ? res.content.length : 0;
      const spend: Spend =
        typeof res.credits === "number"
          ? { credits: res.credits, exact: true }
          : estimateSpend({ tier: effectiveTier(tier), stableChars: p.stableChars, liveChars: p.liveChars, outputChars, warm, cacheConfirmed });
      const r: DmReport = {
        kind,
        tier,
        repair: p.repair,
        spend,
        line: afterLine(spend),
        inputTokens: usage ? usage.inputTokens : tokensOf(p.stableChars + p.liveChars),
        outputTokens: usage ? usage.outputTokens : tokensOf(outputChars),
        warm,
        ms: Math.max(0, now() - startedAt),
      };
      if (p.stableChars > 0) {
        lastSystem = p.req.system;
        lastAt = now();
      }
      sum.credits += spend.credits;
      sum.calls += 1;
      if (!spend.exact) sum.exact = false;
      lastReport = r;
      return r;
    };

    const res = await new Promise<CompleteResult>((resolve, reject) => {
      const onAbort = (): void => {
        dropped = true;
        me.abandoned = true;
        reject(cancelled());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      started.then(
        (r) => {
          signal?.removeEventListener("abort", onAbort);
          if (dropped) emit({ type: "dropped", report: report(r) });
          else resolve(r);
        },
        (e: unknown) => {
          signal?.removeEventListener("abort", onAbort);
          if (dropped) return;
          const code = codeForError(e);
          emit({ type: "fail", kind, code });
          reject(new DmCallError(code, e instanceof Error ? e.message : String(e)));
        },
      );
    });

    const r = report(res);
    emit({ type: "done", report: r });
    const text = typeof res.content === "string" ? res.content : "";
    return res.stopReason === "max_tokens" ? { text, truncated: true } : { text };
  };

  const dm: TableDm = {
    sample: async () => (options.requireBridge === true && !isAiAvailable() ? null : sampler),
    unavailable: UNAVAILABLE,
    get costNote(): string {
      return turnPriceLine(typicalDmTurn(effectiveTier(tierFor("default", policy)), { warm: lastSystem !== null && now() - lastAt < CACHE_TTL_MS, cacheConfirmed }), { forcedCheap });
    },
  };

  return {
    dm,
    estimate,
    writerLine,
    writerEstimate,
    last: () => lastReport,
    total: () => ({ credits: sum.credits, calls: sum.calls, exact: sum.exact }),
    busy: () => flight !== null,
    warm: () => lastSystem !== null && now() - lastAt < CACHE_TTL_MS,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    sampler,
    dispose: () => listeners.clear(),
  };
}
