// A mock of the ConjureOS host bridge, installed into a page before any app
// script runs.
//
// What the game reads (read from src/bridge/ai.ts, gamesApi.ts, actions.ts):
//   window.__conjureos.ai.complete(req) -> Promise<{ content: string }>
//       req = { system, messages: [{role, content}], maxTokens?, tier?, temperature? }
//   window.__conjureos.actions.invoke / register / list   (games-db, hub)
//   window.__conjureos.openApp
//
// This mock defines ONLY `ai`. With no `actions`, gamesApi.ts answers every
// games-db call from its own in-memory mock (state resets on reload, so specs
// must not reload mid-test), and registerActions() / openHub() are no-ops.
//
// The AI is answered from Node: the page calls an exposed function, so every
// call is recorded in `platform.calls` with its full request, and the reply is
// whatever the script says.
//
//   const platform = await installPlatform(page);
//   platform.script([
//     { match: /LIVINGTABLE_ARC_GENERATOR/, reply: JSON.stringify({...}) },
//     { match: (req) => req.messages.length > 3, reply: (req, n) => "..." },
//   ]);
//
// A script entry matches against the SYSTEM prompt when `match` is a RegExp or
// string, or against the whole request when it is a function. The first entry
// that matches answers; an entry with `once: true` is used up after one call.
// A reply is a string (the model's text), a function returning one, or
// { error: { message, code } } to reject like a provider failure, or
// { hold: true, reply } to park the call until platform.release() is called.
// No match at all rejects the call and records it in `platform.unmatched`, so a
// spec cannot spend a call it did not plan for without noticing.

export async function installPlatform(page, opts = {}) {
  const platform = {
    /** Every ai.complete call, in order: { n, at, system, messages, maxTokens, tier, temperature, answered }. */
    calls: [],
    /** Calls no script entry matched. */
    unmatched: [],
    entries: [],
    held: [],
    latencyMs: opts.latencyMs ?? 0,
    /** Replace the script. */
    script(entries) {
      platform.entries = entries.map((e) => ({ ...e, used: 0 }));
      return platform;
    },
    /** Append entries (checked after the existing ones). */
    add(...entries) {
      platform.entries.push(...entries.map((e) => ({ ...e, used: 0 })));
      return platform;
    },
    reset() {
      platform.calls.length = 0;
      platform.unmatched.length = 0;
      return platform;
    },
    /** Calls whose system prompt matches. */
    callsMatching(re) {
      return platform.calls.filter((c) => (typeof re === "string" ? c.system.includes(re) : re.test(c.system)));
    },
    /** Let every parked call (reply entries with hold: true) go. */
    release() {
      const h = platform.held.splice(0);
      for (const fn of h) fn();
    },
    /** Resolves once at least n calls have been received. */
    async waitForCalls(n, timeoutMs = 15000) {
      const t0 = Date.now();
      while (platform.calls.length < n) {
        if (Date.now() - t0 > timeoutMs) throw new Error(`waited ${timeoutMs} ms for ${n} AI calls, saw ${platform.calls.length}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };

  const handle = async (req) => {
    const call = {
      n: platform.calls.length + 1,
      at: Date.now(),
      system: String(req?.system ?? ""),
      messages: Array.isArray(req?.messages) ? req.messages : [],
      maxTokens: req?.maxTokens,
      tier: req?.tier,
      temperature: req?.temperature,
      answered: null,
    };
    platform.calls.push(call);
    const entry = platform.entries.find((e) => {
      if (e.once && e.used > 0) return false;
      if (typeof e.match === "function") return e.match(call);
      if (e.match instanceof RegExp) return e.match.test(call.system);
      if (typeof e.match === "string") return call.system.includes(e.match);
      return true;
    });
    if (!entry) {
      platform.unmatched.push(call);
      call.answered = "unmatched";
      return { error: { message: "e2e platform: no script entry matched this ai.complete call", code: "e2e_unmatched" } };
    }
    entry.used++;
    let reply = entry.reply;
    if (typeof reply === "function") reply = await reply(call, entry.used);
    if (entry.hold) await new Promise((resolve) => platform.held.push(resolve));
    else if (platform.latencyMs) await new Promise((r) => setTimeout(r, platform.latencyMs));
    if (reply && typeof reply === "object" && reply.error) {
      call.answered = "error";
      return { error: reply.error };
    }
    call.answered = "ok";
    return { content: String(reply ?? "") };
  };

  await page.exposeFunction("__e2eAiComplete", handle);

  // The init script runs before the page's own scripts, in every frame.
  await page.addInitScript((extra) => {
    const ai = {
      complete: async (req) => {
        const out = await window.__e2eAiComplete(JSON.parse(JSON.stringify(req)));
        if (out && out.error) {
          throw Object.assign(new Error(out.error.message || "ai.complete failed"), { code: out.error.code });
        }
        return { content: out.content };
      },
    };
    window.__conjureos = Object.assign(window.__conjureos ?? {}, { ai });
    if (extra) {
      try {
        // eslint-disable-next-line no-new-func
        new Function("bridge", extra)(window.__conjureos);
      } catch (e) {
        console.error("e2e platform extra init failed", e);
      }
    }
  }, opts.extraInit ?? null);

  return platform;
}
