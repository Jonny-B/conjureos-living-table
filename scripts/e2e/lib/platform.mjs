// A mock of the ConjureOS host bridge, installed into a page before any app
// script runs.
//
// What the game reads (src/bridge/ai.ts, gamesApi.ts, table/host/gameHost.ts):
//   window.__conjureos.ai.complete(req) -> Promise<{ content: string }>
//       req = { system, messages: [{role, content}], maxTokens?, tier?, temperature? }
//   window.__conjureos.actions.invoke(appPath, "gamesDb", { action, ...params })   (games-db)
//   window.__conjureos.auth.whoami() -> { signedIn, email }
//
// The mock always defines `ai`. With `server: true` it also defines `actions` and `auth`, and
// plays games-db from Node: the server saves (ltSaveList / Get / Put / Delete, the same rules
// as the real table: key shape, kind, 256 KiB, 60 rows a game) live in `platform.saves` for the
// whole browser context, so they SURVIVE A RELOAD like a real server's do. ltAssetManifest
// answers from the dev manifest (or an error, so the bundled art is used). Without `server` the
// game runs as it does outside ConjureOS: saves stay on the device and games-db is its own mock.
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

const SAVE_KEY = /^[a-z0-9:_-]{1,80}$/;
const SAVE_KINDS = ["rest", "checkpoint", "manual", "current", "ai-adventure"];
const MAX_ROWS = 60;
const MAX_BYTES = 256 * 1024;

export async function installPlatform(page, opts = {}) {
  const platform = {
    /** The server saves, by key (server: true): { key, kind, label, updatedAt, payload }. Shared by every page of one context. */
    saves: opts.saves ?? new Map(),
    /** Every games-db call the page made: { action, key? }. */
    serverCalls: [],
    /** Set to a message to make every games-db save call fail like an outage (the page keeps its saves on the device). */
    serverDown: null,
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

  let stamp = 0;
  const nextStamp = () => new Date((stamp = Math.max(Date.now(), stamp + 1))).toISOString();
  const serverHandle = async (params) => {
    const { action } = params;
    platform.serverCalls.push({ action, key: params.key });
    if (action === "ltAssetManifest") {
      const m = opts.assetManifest ? opts.assetManifest(params.template) : null;
      return m ? m : { error: "no art served in this test" };
    }
    if (platform.serverDown) throw new Error(platform.serverDown);
    if (params.game !== "livingtable") return { error: "bad_game" };
    if (action === "ltSaveList") {
      const rows = [...platform.saves.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return { saves: rows.map((r) => ({ key: r.key, kind: r.kind, label: r.label, updatedAt: r.updatedAt, bytes: Buffer.byteLength(JSON.stringify(r.payload)) })) };
    }
    if (action === "ltSaveGet") return { save: platform.saves.get(params.key) ?? null };
    if (action === "ltSavePut") {
      if (typeof params.key !== "string" || !SAVE_KEY.test(params.key)) return { error: "bad_key" };
      if (!SAVE_KINDS.includes(params.kind)) return { error: "bad_kind" };
      if (Buffer.byteLength(JSON.stringify(params.payload ?? null)) > MAX_BYTES) return { error: "too_large" };
      if (!platform.saves.has(params.key) && platform.saves.size >= MAX_ROWS) return { error: "too_many" };
      const updatedAt = nextStamp();
      platform.saves.set(params.key, { key: params.key, kind: params.kind, label: String(params.label ?? "").slice(0, 120), updatedAt, payload: params.payload });
      return { ok: true, updatedAt };
    }
    if (action === "ltSaveDelete") {
      platform.saves.delete(params.key);
      return { ok: true };
    }
    return { error: `e2e platform: games-db action ${action} is not played` };
  };
  if (opts.server) await page.exposeFunction("__e2eGamesDb", serverHandle);

  // The init script runs before the page's own scripts, in every frame.
  await page.addInitScript(({ extra, server, who }) => {
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
    if (server) {
      window.__conjureos.actions = {
        invoke: async (_appPath, name, params) => {
          if (name !== "gamesDb") throw new Error("e2e platform: no action " + name);
          return await window.__e2eGamesDb(JSON.parse(JSON.stringify(params)));
        },
      };
      window.__conjureos.auth = { whoami: async () => who };
    }
    if (extra) {
      try {
        // eslint-disable-next-line no-new-func
        new Function("bridge", extra)(window.__conjureos);
      } catch (e) {
        console.error("e2e platform extra init failed", e);
      }
    }
  }, { extra: opts.extraInit ?? null, server: !!opts.server, who: opts.who ?? { signedIn: true, email: "tester@example.test" } });

  return platform;
}
