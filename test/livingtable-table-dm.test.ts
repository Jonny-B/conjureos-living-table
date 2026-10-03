/**
 * Tests for the game's DM bridge and its cost words
 * (src/games/livingtable/table/host/gameDm.ts, table/cost.ts, and the
 * streaming and stop-reason additions to src/bridge/ai.ts): the tier and
 * token-ceiling mapping, the system/user cache split of dmCore's prompt, one
 * call in flight, at most one repair round for a DM turn, errors reaching
 * dmCore's failFor with a code, cancel dropping the reply, and that nothing
 * in the adapter works out or states a price (the platform's credit display
 * says what AI use costs; the game never does). Every model call is a scripted
 * fake `complete`; nothing here touches a network.
 *
 * Run: npx tsx --test test/livingtable-table-dm.test.ts
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { THINKING_HEADROOM_TOKENS, completeDetailed, type CompleteRequest, type CompleteResult } from "../src/bridge/ai";
import {
  buildDmInput,
  askDm,
  validationContextFor,
  type DmAsk,
  type DmSceneView,
} from "../src/games/livingtable/table/dmCore";
import { DmCallError, DM_SYSTEM_STUB, WRITER_SYSTEM_STUB, codeForError, createGameDm, splitDmInput } from "../src/games/livingtable/table/host/gameDm";
import * as costModule from "../src/games/livingtable/table/cost";
import { CACHE_TTL_MS, MAX_REPAIRS, MAX_TOKENS, TEMPERATURE, tierFor, tokensOf } from "../src/games/livingtable/table/cost";

/** The em and en dash, built from code points so this file holds neither. */
const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

// ---- fixtures ---------------------------------------------------------------------

function makeView(over: Partial<DmSceneView> = {}): DmSceneView {
  return {
    template: "fantasy",
    cols: 8,
    rows: 6,
    grid: ["########", "#......#", "#..o...#", "#......#", "#...c..#", "########"],
    legend: { "#": "stone wall", ".": "floor", o: "drain grate in the floor", c: "iron-bound chest" },
    features: [
      { id: "grate1", x: 3, y: 2, what: "a rusted drain grate", asset: "floor_stone_drain", seen: true, secret: "A silver ring is wedged under the grate" },
      { id: "chest1", x: 4, y: 4, what: "an iron-bound chest", asset: "chest", state: "closed", seen: true },
    ],
    hero: {
      name: "Brannoc",
      archetype: "Knight",
      level: 2,
      hp: 14,
      maxHp: 18,
      ac: 17,
      at: { x: 1, y: 1 },
      speedFt: 30,
      abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 11, cha: 9 },
      skills: { Athletics: 5, Perception: 2 },
      conditions: [],
      worn: ["Chain mail", "Longsword"],
      bag: [],
      carried: ["Hemp rope"],
      potions: 2,
      consumables: [],
    },
    monsters: [{ id: "gob1", name: "Goblin", hp: 7, maxHp: 7, ac: 15, at: { x: 6, y: 4 }, awake: false, seenByHero: false }],
    fight: null,
    visibleToHero: "grate1, chest1",
    memory: [],
    recent: [],
    log: [],
    assets: { props: ["chest", "barrel"], tiles: ["floor_stone", "wall_stone"], monsters: ["token_goblin"] },
    ...over,
  };
}

const BRIEF = "ADVENTURE (written by the owner, gospel): The Rat Cellar\n\nTruths (never contradict these):\n- There is exactly one goblin, and he dug the tunnel.";

function advView(viewOver: Partial<DmSceneView> = {}): DmSceneView {
  return makeView({
    adventure: {
      title: "The Rat Cellar",
      brief: BRIEF,
      allowedSteps: [{ kind: "flag", flag: "tunnel_noticed" }],
      npcsHere: [{ id: "marta", name: "Marta Pell", at: { x: 2, y: 3 } }],
      itemIds: ["green_cloth"],
    },
    ...viewOver,
  });
}

const ASK: DmAsk = { kind: "freehand", text: "I knock on the wall." };
/** A reply of the usual length (about 500 tokens), for the price readout. */
const LONG_REPLY = JSON.stringify({ narration: "It rings hollow. ".repeat(110), cost: "free", effects: [], options: [] });
const GOOD_REPLY = JSON.stringify({
  narration: "It rings hollow.",
  cost: "free",
  effects: [],
  options: [
    { label: "Wait", say: "I wait." },
    { label: "Look", say: "I look again." },
  ],
});

type Scripted = string | CompleteResult | Error | ((req: CompleteRequest) => Promise<CompleteResult> | CompleteResult);

interface Fake {
  calls: CompleteRequest[];
  complete: (req: CompleteRequest) => Promise<CompleteResult>;
  /** Queue the next reply: a result, a text, an Error to reject with, or a function. */
  next: (r: Scripted) => Fake;
}

function fake(): Fake {
  const calls: CompleteRequest[] = [];
  const queue: Scripted[] = [];
  const f: Fake = {
    calls,
    complete: async (req) => {
      calls.push(req);
      const h = queue.shift();
      if (h === undefined) throw new Error("no scripted reply");
      if (h instanceof Error) throw h;
      if (typeof h === "function") return h(req);
      return typeof h === "string" ? { content: h, stopReason: "end_turn" } : h;
    },
    next: (r) => {
      queue.push(r);
      return f;
    },
  };
  return f;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

const g = globalThis as { window?: unknown };
afterEach(() => {
  delete g.window;
});

// ---- no price, anywhere a player could read it -------------------------------------------------

test("cost.ts holds the call settings and no price: no rates, no estimates, no credit words", () => {
  const names = Object.keys(costModule).sort();
  assert.deepEqual(names, ["CACHE_TTL_MS", "CHARS_PER_TOKEN", "MAX_REPAIRS", "MAX_TOKENS", "TEMPERATURE", "tierFor", "tokensOf"]);
  const text = readFileSync(new URL("../src/games/livingtable/table/cost.ts", import.meta.url), "utf8");
  // the file may say, once, that it states no price; it may never hold a figure or a player-facing price string
  assert.doesNotMatch(text, /CREDITS_PER_USD|TIER_RATES|per million|\$\d|costs about|from your ConjureOS balance/i);
  assert.equal(tokensOf(400), 100);
});

test("tiers: quick, default and complex map to cheap, capable and capable; the writer reaches epic only by a flag", () => {
  assert.equal(tierFor("quick"), "cheap");
  assert.equal(tierFor("default"), "capable");
  assert.equal(tierFor("complex"), "capable");
  assert.equal(tierFor("complex", { writerTier: "epic" }), "epic");
  assert.equal(tierFor("default", { writerTier: "epic" }), "capable");
});

test("max tokens: the capable ceiling is at least the thinking headroom, the writer's is larger, and a DM turn gets one repair", () => {
  assert.equal(MAX_TOKENS.default, THINKING_HEADROOM_TOKENS);
  assert.ok(MAX_TOKENS.complex > MAX_TOKENS.default);
  assert.ok(MAX_TOKENS.complex >= THINKING_HEADROOM_TOKENS);
  assert.equal(MAX_REPAIRS.default, 1);
  assert.equal(MAX_REPAIRS.complex, 2);
});

// ---- the prompt split ------------------------------------------------------------------------

test("split: with an adventure the system holds the rules, format and brief, the user message the live state, and the two rejoin to the original", () => {
  const input = buildDmInput(advView(), ASK);
  const sp = splitDmInput(input);
  assert.ok(sp, "dmCore's section headers are where the splitter expects them");
  assert.equal(`${sp.system}\n\n${sp.user}`, input);
  assert.match(sp.system, /^You are the Dungeon Master/);
  assert.match(sp.system, /OUTPUT FORMAT/);
  assert.match(sp.system, /=== THE ADVENTURE \(GOSPEL\) ===/);
  assert.ok(sp.system.includes(BRIEF));
  assert.match(sp.user, /^PROGRESS EFFECTS YOU MAY USE NOW/);
  assert.match(sp.user, /=== THE WORLD/);
  assert.match(sp.user, /=== THE ASK ===/);
  // nothing live in the cached part
  for (const live of ["Brannoc", "I knock on the wall", "tunnel_noticed", "Marta Pell", "grate1"]) assert.ok(!sp.system.includes(live), `${live} must not be in system`);
});

test("split: without an adventure the cut is at the world", () => {
  const input = buildDmInput(makeView(), ASK);
  const sp = splitDmInput(input);
  assert.ok(sp);
  assert.equal(`${sp.system}\n\n${sp.user}`, input);
  assert.match(sp.user, /^=== THE WORLD/);
  assert.match(sp.system, /OUTPUT FORMAT/);
});

test("split: the system part is byte for byte the same on every turn of a scene, whatever the world, the memory and the ask are", () => {
  const a = splitDmInput(buildDmInput(advView(), ASK));
  const b = splitDmInput(
    buildDmInput(
      advView({
        memory: ["the baron owes the hero a favour"],
        recent: [{ who: "player", text: "hello" }, { who: "dm", text: "Hello." }],
        log: ["Brannoc opened the door"],
        hero: { ...makeView().hero, hp: 3 },
        fight: { round: 2, whoseTurn: "Goblin", heroMovementFt: 10, heroActionReady: false },
      }),
      { kind: "examine", at: { x: 3, y: 2 }, what: "the drain grate" },
    ),
  );
  assert.ok(a && b);
  assert.equal(a.system, b.system);
  assert.notEqual(a.user, b.user);
  assert.ok(a.system.length > 10000, `the cacheable part is the bulk (${a.system.length})`);
  assert.ok(a.system.length > a.user.length * 2);
});

test("split: a text with no seam is not split and a tiny stable part is not worth it", () => {
  assert.equal(splitDmInput("just a prompt"), null);
  assert.equal(splitDmInput("short\n\n=== THE WORLD (x)\nmore"), null);
});

// ---- the adapter: requests -----------------------------------------------------------------------

test("a DM turn asks the capable tier for 8,000 tokens at 0.7 with the stable part in system and streams", async () => {
  const f = fake().next(GOOD_REPLY);
  const dm = createGameDm({ complete: f.complete });
  const input = buildDmInput(advView(), ASK);
  const res = await dm.sampler(input, { modelTier: "default", cache: false });
  const req = f.calls[0]!;
  assert.equal(req.tier, "capable");
  assert.equal(req.maxTokens, THINKING_HEADROOM_TOKENS);
  assert.equal(req.temperature, TEMPERATURE.default);
  assert.equal(typeof req.onChunk, "function", "every call streams, so the bridge's idle timer keeps resetting");
  assert.ok(req.system.includes(BRIEF));
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0]!.role, "user");
  assert.equal(`${req.system}\n\n${req.messages[0]!.content}`, input);
  assert.deepEqual(res, { text: GOOD_REPLY });
});

test("a quick call is cheap with a small ceiling; a prompt with no seam goes whole in the user message under a short system line", async () => {
  const f = fake().next("ok").next("ok");
  const dm = createGameDm({ complete: f.complete });
  await dm.sampler("hello there", { modelTier: "quick" });
  assert.equal(f.calls[0]!.tier, "cheap");
  assert.equal(f.calls[0]!.maxTokens, MAX_TOKENS.quick);
  assert.equal(f.calls[0]!.system, DM_SYSTEM_STUB);
  assert.equal(f.calls[0]!.messages[0]!.content, "hello there");
  await dm.sampler("no seam in this one", {});
  assert.equal(f.calls[1]!.tier, "capable");
  assert.equal(f.calls[1]!.system, DM_SYSTEM_STUB);
});

test("the writer runs on the capable tier with its own larger ceiling, and on epic only when the host says so", async () => {
  const f = fake().next("# A Title");
  const dm = createGameDm({ complete: f.complete });
  await dm.sampler("write an adventure about a lighthouse", { modelTier: "complex", cache: false });
  assert.equal(f.calls[0]!.tier, "capable");
  assert.equal(f.calls[0]!.maxTokens, MAX_TOKENS.complex);
  assert.equal(f.calls[0]!.system, WRITER_SYSTEM_STUB);
  assert.equal(f.calls[0]!.temperature, TEMPERATURE.complex);

  const f2 = fake().next("# A Title");
  const dm2 = createGameDm({ complete: f2.complete, writerTier: "epic" });
  await dm2.sampler("write an adventure about a lighthouse", { modelTier: "complex" });
  assert.equal(f2.calls[0]!.tier, "epic");
});

test("a reply that stopped at the token ceiling comes back truncated", async () => {
  const f = fake().next({ content: '{"narration":"cut', stopReason: "max_tokens" });
  const dm = createGameDm({ complete: f.complete });
  assert.deepEqual(await dm.sampler("x", {}), { text: '{"narration":"cut', truncated: true });
});

test("streamed text reaches onText with the text so far, and a throwing listener does not break the call", async () => {
  const f = fake().next((req) => {
    req.onChunk?.('{"narration":"It ', '{"narration":"It ');
    req.onChunk?.("rings", '{"narration":"It rings');
    return { content: GOOD_REPLY, stopReason: "end_turn" };
  });
  const dm = createGameDm({ complete: f.complete });
  const seen: string[] = [];
  await dm.sampler("x", {
    onText: ({ text, delta }) => {
      seen.push(`${delta}|${text}`);
      throw new Error("listener bug");
    },
  });
  assert.deepEqual(seen, ['{"narration":"It |{"narration":"It ', 'rings|{"narration":"It rings']);
});

// ---- the adapter: one at a time, repairs, errors, cancel -------------------------------------------------

test("askDm through the adapter: a bad answer buys exactly one repair, resending the same system so it can read the cache", async () => {
  const f = fake().next("not json at all").next(GOOD_REPLY);
  const dm = createGameDm({ complete: f.complete });
  const view = advView();
  const events: string[] = [];
  dm.subscribe((e) => events.push(e.type === "start" ? `start${e.repair ? ":repair" : ""}` : e.type));
  const out = await askDm(dm.sampler, view, ASK, validationContextFor(view));
  assert.equal(out.ok, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.system, f.calls[0]!.system);
  assert.deepEqual(f.calls[1]!.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(f.calls[1]!.messages[0]!.content, f.calls[0]!.messages[0]!.content);
  assert.match(f.calls[1]!.messages[2]!.content, /could not be used/);
  assert.deepEqual(events, ["start", "done", "start:repair", "done"]);
  assert.equal(dm.last()?.repair, true);
  assert.equal(dm.last()?.warm, true, "the repair found the system the first call had just used");
});

test("askDm through the adapter: two bad answers end the turn with no third call", async () => {
  const f = fake().next("nope").next("still nope").next(GOOD_REPLY);
  const dm = createGameDm({ complete: f.complete });
  const view = advView();
  const out = await askDm(dm.sampler, view, ASK, validationContextFor(view));
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.code, "invalid_reply");
  assert.equal(f.calls.length, 2);
});

test("a second repair in a row for a DM turn is refused without being sent; a fresh ask resets the count", async () => {
  const f = fake().next("a").next("b").next("c");
  const dm = createGameDm({ complete: f.complete });
  const convo = (n: number) => [
    { role: "user" as const, content: "prompt" },
    { role: "assistant" as const, content: `bad${n}` },
    { role: "user" as const, content: "fix it" },
  ];
  await dm.sampler(convo(1), {});
  await assert.rejects(dm.sampler(convo(2), {}), (e: unknown) => e instanceof DmCallError && e.code === "repair_limit");
  assert.equal(f.calls.length, 1);
  await dm.sampler("a new first ask", {});
  await dm.sampler(convo(3), {});
  assert.equal(f.calls.length, 3);
});

test("the writer may spend two repair rounds and no more", async () => {
  const f = fake().next("a").next("b").next("c").next("d");
  const dm = createGameDm({ complete: f.complete });
  const convo = [
    { role: "user" as const, content: "prompt" },
    { role: "assistant" as const, content: "bad" },
    { role: "user" as const, content: "fix" },
  ];
  await dm.sampler("write it", { modelTier: "complex" });
  await dm.sampler(convo, { modelTier: "complex" });
  await dm.sampler(convo, { modelTier: "complex" });
  await assert.rejects(dm.sampler(convo, { modelTier: "complex" }), (e: unknown) => e instanceof DmCallError && e.code === "repair_limit");
  assert.equal(f.calls.length, 3);
});

test("provider errors become codes dmCore's failFor reads, and raw provider text never reaches the player", async () => {
  const cases: [string, string, string][] = [
    ["app does not have ai.complete permission", "not_granted", "The DM needs your permission to use Claude."],
    ["ai.complete rate limit (burst): too many AI calls from this app", "rate_limited", "The DM needs a moment. Try again shortly."],
    ["You're out of credits. Top up in Settings, or add your own Anthropic key.", "out_of_credits", "The DM could not answer. Try again."],
    ["ai timeout", "timeout", "The DM could not answer. Try again."],
    ["ai.complete blocked: ConjureOS is in the background", "not_foreground", "The DM could not answer. Try again."],
    ["Anthropic 529 overloaded sk-ant-secret-detail", "upstream_error", "The DM could not answer. Try again."],
  ];
  for (const [text, code, words] of cases) {
    const f = fake().next(new Error(text));
    const dm = createGameDm({ complete: f.complete });
    const view = makeView();
    const out = await askDm(dm.sampler, view, ASK, validationContextFor(view));
    assert.equal(out.ok, false, text);
    assert.equal(!out.ok && out.code, code, text);
    assert.equal(!out.ok && out.message, words, text);
    assert.equal(f.calls.length, 1, "a failed call is not retried");
  }
  assert.equal(codeForError("something odd"), "upstream_error");
  assert.equal(codeForError({ code: "rate_limited" }), "rate_limited");
});

test("one call at a time: a second ask while one runs is refused and nothing extra is sent", async () => {
  const gate = deferred<CompleteResult>();
  const f = fake().next(() => gate.promise);
  const dm = createGameDm({ complete: f.complete });
  const first = dm.sampler("first", {});
  await tick();
  assert.equal(dm.busy(), true);
  await assert.rejects(dm.sampler("second", {}), (e: unknown) => e instanceof DmCallError && e.code === "busy");
  assert.equal(f.calls.length, 1);
  gate.resolve({ content: "done" });
  await first;
  assert.equal(dm.busy(), false);
});

test("cancel drops the reply, keeps the slot until the platform call really ends, and reports the drop when it does", async () => {
  const gate = deferred<CompleteResult>();
  const gate2 = deferred<CompleteResult>();
  const f = fake()
    .next((req) => {
      req.onChunk?.("a", "a");
      return gate.promise;
    })
    .next(() => gate2.promise);
  const dm = createGameDm({ complete: f.complete });
  const events: string[] = [];
  dm.subscribe((e) => events.push(e.type));
  const ctl = new AbortController();
  const seen: string[] = [];
  const first = dm.sampler("first", { signal: ctl.signal, onText: ({ delta }) => seen.push(delta) });
  first.catch(() => undefined);
  await tick();
  const chunkLater = f.calls[0]!.onChunk;
  ctl.abort();
  await assert.rejects(first, (e: unknown) => e instanceof DmCallError && e.code === "cancelled");
  chunkLater?.("late", "alate");
  assert.deepEqual(seen, ["a"], "text after the cancel is dropped");
  assert.equal(dm.busy(), true, "the call is still running on the platform");

  // a new ask waits for the old call instead of stacking a second one on it
  const second = dm.sampler("second", {});
  await tick();
  assert.equal(f.calls.length, 1);
  gate.resolve({ content: "the reply nobody wanted" });
  await tick();
  assert.equal(f.calls.length, 2, "now the second goes out");
  gate2.resolve({ content: "wanted" });
  assert.deepEqual(await second, { text: "wanted" });
  assert.deepEqual(events, ["start", "dropped", "start", "done"]);
  assert.equal(dm.total().calls, 2, "the dropped call is counted: it still finished on the platform");
});

test("a call cancelled before it starts never reaches the model", async () => {
  const f = fake().next("never");
  const dm = createGameDm({ complete: f.complete });
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(dm.sampler("x", { signal: ctl.signal }), (e: unknown) => e instanceof DmCallError && e.code === "cancelled");
  assert.equal(f.calls.length, 0);
});

// ---- the report and the cache, with no price ----------------------------------------------------------------

test("a finished call reports its size and timing and says nothing about money", async () => {
  const f = fake().next(LONG_REPLY);
  const dm = createGameDm({ complete: f.complete });
  const input = buildDmInput(advView(), ASK);
  await dm.sampler(input, { modelTier: "default" });
  const r = dm.last()!;
  assert.equal(r.kind, "default");
  assert.equal(r.repair, false);
  assert.ok(r.inputTokens > 0 && r.outputTokens > 0);
  assert.deepEqual(Object.keys(r).sort(), ["inputTokens", "kind", "ms", "outputTokens", "repair", "tier", "warm"]);
  assert.deepEqual(dm.total(), { calls: 1 });
});

test("the start event says only the kind and whether it is a repair, and a reported figure from the host is not passed on", async () => {
  const f = fake().next({ content: GOOD_REPLY, credits: 31, usage: { inputTokens: 900, outputTokens: 120, cacheReadInputTokens: 4800 } });
  const dm = createGameDm({ complete: f.complete });
  const seen: unknown[] = [];
  dm.subscribe((e) => seen.push(e));
  await dm.sampler(buildDmInput(advView(), ASK), {});
  assert.deepEqual(seen[0], { type: "start", kind: "default", repair: false });
  const r = dm.last()!;
  assert.equal(r.inputTokens, 900);
  assert.equal(r.outputTokens, 120);
  assert.doesNotMatch(JSON.stringify(seen), /credit|price|cost|about/i);
});

test("a cached system prompt: the next turn inside five minutes is warm, one after five minutes is not", async () => {
  let t = 1_000_000;
  const f = fake().next(GOOD_REPLY).next(GOOD_REPLY).next(GOOD_REPLY);
  const dm = createGameDm({ complete: f.complete, now: () => t });
  const turn = (over: Partial<DmSceneView> = {}) => buildDmInput(advView(over), ASK);
  await dm.sampler(turn(), {});
  assert.equal(dm.last()?.warm, false);
  t += 60_000;
  assert.equal(dm.warm(), true);
  await dm.sampler(turn({ log: ["the door creaks"] }), {});
  assert.equal(dm.last()?.warm, true);
  t += CACHE_TTL_MS + 1;
  assert.equal(dm.warm(), false);
  await dm.sampler(turn(), {});
  assert.equal(dm.last()?.warm, false);
});

test("the host has no cost note and the adapter offers no estimate or price line", () => {
  const dm = createGameDm({ complete: fake().complete });
  assert.equal((dm.dm as { costNote?: string }).costNote, undefined);
  for (const k of ["estimate", "writerLine", "writerEstimate"]) assert.equal((dm as unknown as Record<string, unknown>)[k], undefined, k);
  assert.match(dm.dm.unavailable, /permission/);
  assert.doesNotMatch(dm.dm.unavailable, /credit|price|cost/i);
});

// ---- the bridge ------------------------------------------------------------------------------------------------

test("sample() is the adapter by default and null outside ConjureOS only when the host requires the bridge", async () => {
  const a = createGameDm({ complete: fake().complete });
  assert.equal(await a.dm.sample(), a.sampler);
  const b = createGameDm({ complete: fake().complete, requireBridge: true });
  assert.equal(await b.dm.sample(), null);
  g.window = { __conjureos: { ai: { complete: async () => ({ content: "x" }) } } };
  assert.equal(await b.dm.sample(), b.sampler);
});

test("through the real bridge wrapper: streaming and the stop reason come back, and a rejection keeps the host's words", async () => {
  const seen: CompleteRequest[] = [];
  g.window = {
    __conjureos: {
      ai: {
        complete: async (req: CompleteRequest) => {
          seen.push(req);
          req.onChunk?.("he", "he");
          if (req.messages[0]!.content === "boom") throw new Error("ai.complete rate limit (daily): too many AI calls from this app");
          return { content: "hello", stopReason: "max_tokens", credits: 12, usage: { inputTokens: 10, outputTokens: 5 } };
        },
      },
    },
  };
  const dm = createGameDm();
  const parts: string[] = [];
  const res = await dm.sampler("hi", { onText: ({ text }) => parts.push(text) });
  assert.deepEqual(res, { text: "hello", truncated: true });
  assert.deepEqual(parts, ["he"]);
  assert.equal(seen[0]!.tier, "capable");
  assert.equal(dm.last()?.outputTokens, 5);
  await assert.rejects(dm.sampler("boom", {}), (e: unknown) => e instanceof DmCallError && e.code === "rate_limited");
  const direct = await completeDetailed({ system: "s", messages: [{ role: "user", content: "hi" }] });
  assert.equal(direct.stopReason, "max_tokens");
  assert.equal(direct.credits, 12);
});

test("outside ConjureOS the dev mock answers a table prompt with a reply dmCore accepts, streaming it", async () => {
  delete g.window;
  const dm = createGameDm();
  const view = advView();
  const narration: string[] = [];
  const out = await askDm(dm.sampler, view, ASK, validationContextFor(view), { onNarration: (t) => narration.push(t) });
  assert.equal(out.ok, true);
  assert.ok(narration.length > 0, "the mock streams");
  assert.equal(dm.last()?.kind, "default");
});

test("outside ConjureOS the mock does not pretend to write an adventure", async () => {
  delete g.window;
  const dm = createGameDm();
  await assert.rejects(dm.sampler("You are writing ONE complete adventure for a tabletop-style fantasy game", { modelTier: "complex" }), (e: unknown) => e instanceof DmCallError);
});

// ---- hygiene ----------------------------------------------------------------------------------------------------

test("the files of this lane carry no dash characters and none of the bench's directory name", () => {
  for (const f of ["src/games/livingtable/table/host/gameDm.ts", "src/games/livingtable/table/cost.ts", "src/bridge/ai.ts"]) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, DASH, f);
    assert.ok(!text.includes("asset-" + "bench"), f);
  }
});
