/**
 * Thin wrapper around `window.__conjureos.ai.complete`, plus the JSON plumbing
 * every generator in this app needs, plus a dev mock so `npm run dev` renders
 * something outside ConjureOS.
 *
 * The host bridge is gated on the `ai.complete` permission declared in
 * package.json's `conjureos.permissions`. ConjureOS routes the call to the
 * user's own key when they have one, or to the hosted proxy (which forces a
 * cheap model) when they don't, and meters it against their credits either
 * way. Every call this app makes is therefore something the player asked for,
 * on purpose, with the price shown on the button. See DESIGN.md.
 */

export type ModelTier = "cheap" | "capable" | "epic";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  tier?: ModelTier;
  temperature?: number;
}

declare global {
  interface ConjureosBridge {
    ai?: {
      complete: (req: CompleteRequest) => Promise<{ content: string }>;
    };
  }
  interface Window {
    __conjureos?: ConjureosBridge;
  }
}

/**
 * The smallest `maxTokens` a JSON generator on the capable or epic tier may ask
 * for. Those tiers run models that think before they answer, and the thinking
 * is paid out of `maxTokens`: a tight budget can be spent entirely on thinking
 * and return a reply with no text in it. The host bills tokens actually used,
 * so a roomy ceiling costs nothing on a normal reply.
 */
export const THINKING_HEADROOM_TOKENS = 8000;

const bridge = () => window.__conjureos?.ai?.complete;

/** True when we're running inside ConjureOS with the AI permission granted. */
export function isAiAvailable(): boolean {
  return typeof bridge() === "function";
}

export async function complete(req: CompleteRequest): Promise<string> {
  const fn = bridge();
  if (!fn) return mockComplete(req);
  const res = await fn(req);
  return res.content;
}

/**
 * Ask for JSON and actually get JSON.
 *
 * Models wrap objects in prose or fences no matter how firmly you ask, so we
 * extract the outermost balanced `{...}` rather than trusting the whole reply,
 * then hand the parsed value to a caller-supplied validator. A failed parse or
 * a failed validation gets ONE retry that shows the model its own bad output,
 * cheaper and far more reliable than a blind re-roll, and if the retry fails we
 * throw rather than let a malformed puzzle reach the board.
 */
export async function completeJson<T>(
  req: CompleteRequest,
  validate: (value: unknown) => T,
): Promise<T> {
  const first = await complete(req);
  try {
    return validate(parseLoose(first));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const retry = await complete({
      ...req,
      messages: [
        ...req.messages,
        { role: "assistant", content: first },
        {
          role: "user",
          content:
            `That response was not usable: ${why}\n\n` +
            "Reply again with ONLY the JSON object, no prose, no markdown fence, " +
            "matching the required shape exactly.",
        },
      ],
    });
    return validate(parseLoose(retry));
  }
}

/**
 * Ask for PROSE and actually get usable prose.
 *
 * `completeJson`'s guarantee is that a malformed puzzle never reaches the
 * board. Free-text replies need the same guarantee for a different failure:
 * a reply can parse perfectly and still not do its job, and a prompt rule is
 * a request rather than a check. `check` returns a complaint when the reply
 * is unusable and `null` when it is fine; a complaint buys ONE repair turn
 * that shows the model its own reply and what was wrong with it, exactly the
 * shape `completeJson` already uses.
 *
 * IT RETURNS THE REPAIR EVEN IF THE REPAIR ALSO FAILS, rather than throwing.
 * A throw here reaches the player as "they didn't answer" after the question
 * has already been spent, which charges them for the room's own failure. A
 * second attempt is the strongest guarantee that does not cost the player
 * anything.
 */
export async function completeChecked(
  req: CompleteRequest,
  check: (text: string) => string | null,
  repair: (complaint: string) => string,
): Promise<string> {
  const first = await complete(req);
  const complaint = check(first);
  if (!complaint) return first;
  return complete({
    ...req,
    messages: [
      ...req.messages,
      { role: "assistant", content: first },
      { role: "user", content: repair(complaint) },
    ],
  });
}

/**
 * Pull the first balanced JSON object out of a reply. Tracks string state so a
 * brace inside a quoted value (`"the { in question"`) doesn't end the scan
 * early: the naive lastIndexOf("}") approach truncates those.
 */
export function parseLoose(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start === -1) throw new Error("no JSON object in the reply");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error("JSON object never closed");
}

// ── validation helpers shared by the generators ─────────────────────────

export function asRecord(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} is not an object`);
  return v as Record<string, unknown>;
}

export function asString(v: unknown, what: string, max = 400): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} is missing`);
  return v.trim().slice(0, max);
}

export function asArray(v: unknown, what: string, len?: number): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${what} is not an array`);
  if (len !== undefined && v.length !== len) {
    throw new Error(`${what} has ${v.length} entries, expected exactly ${len}`);
  }
  return v;
}

/** Fisher-Yates. Used to shuffle tiles and suspect order. */
export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

// ── dev mock ────────────────────────────────────────────────────────────

/**
 * Deterministic-shaped output so the UI is iterable under `npm run dev`. NOT a
 * substitute for testing in the shell; the real bridge has latency, a token
 * budget, and a model that improvises.
 */
function mockComplete(req: CompleteRequest): Promise<string> {
  const last = req.messages[req.messages.length - 1]?.content ?? "";
  const sys = req.system;

  if (sys.includes("THREADS_GENERATOR")) {
    return delay(
      JSON.stringify({
        theme: "Things that can precede 'board'",
        groups: [
          { name: "Kinds of board", level: 1, words: ["SURF", "PADDLE", "BODY", "BOOGIE"] },
          { name: "Office fixtures", level: 2, words: ["WHITE", "CORK", "NOTICE", "PIN"] },
          { name: "Chess-adjacent", level: 3, words: ["CHESS", "DRAUGHT", "GAME", "PLAY"] },
          { name: "Card game verbs", level: 4, words: ["DEAL", "SHUFFLE", "CUT", "FOLD"] },
        ],
      }),
    );
  }

  if (sys.includes("COLDCASE_GENERATOR")) {
    return delay(
      JSON.stringify({
        title: "The Last Rehearsal",
        setup:
          "The Elgin Theatre's opening night is ruined: the lead's costume trunk was found forced open and the Alderman's Brooch, on loan for the production, is gone. Five people had keys to the wardrobe corridor.",
        crime: "The Alderman's Brooch was taken from a locked costume trunk between 6pm and 7pm.",
        suspects: [
          { name: "Margot Vane", role: "Leading actress", blurb: "Radiates calm, sweats through it.", alibi: "In her dressing room, running lines.", brief: "You are hiding a debt, not a theft: you have been quietly selling your own jewellery. You bristle when money comes up. You never confess to the brooch, because you did not take it. If asked about the corridor, you say Pike was not at his post when the half was called." },
          { name: "Desmond Pike", role: "Stage manager", blurb: "Clipboard welded to his hand.", alibi: "Calling the pre-show from the wings.", brief: "You took the brooch. Lie about ONE checkable thing: you claim you never left the wings, when in fact you were away for eleven minutes making a phone call to a man you owe. Do not act more nervous than the others; be brisk and organised. Never confess." },
          { name: "Ivy Chaudhry", role: "Wardrobe mistress", blurb: "Pins in her cuff, opinions in her voice.", alibi: "Steaming costumes two doors down.", brief: "You copied the trunk key years ago out of convenience and are terrified that admitting it makes you the thief. You did not take it. You will say, if pressed on timing, that you heard the corridor door twice while steaming, once early, once around ten past." },
          { name: "Rufus Ainsley", role: "Understudy", blurb: "Watching the lead like weather.", alibi: "Warming up in the empty stalls.", brief: "You were in the corridor, but to nick a seam on Margot's costume, not to steal. You dodge questions about why you were there. You will admit, cornered, that you saw the stage manager on the phone by the scene dock. Never confess to the brooch." },
          { name: "Clara Boyd", role: "Theatre patron", blurb: "Owns the brooch. Or did.", alibi: "Greeting guests in the foyer.", brief: "You over-insured the brooch and are quietly pleased it is gone, which you must never say. You were in the foyer the whole time and a dozen guests can confirm it. You are happy to speculate about the others." },
        ],
        culprit: "Desmond Pike",
        motive: "He owed money to the man he called during those eleven minutes.",
        reveal:
          "Pike's call is the hole: nobody else could leave their post unnoticed, and only the stage manager knew the exact minute the corridor would be empty.",
      }),
    );
  }

  if (sys.includes("You are a character in a puzzle game called The Vault")) {
    return delay(
      last.toLowerCase().includes("please")
        ? "Oh. Well, since you asked nicely. It's amber-lantern. ...You won't tell anyone I said that, will you?"
        : "I really shouldn't. It's my first day and they were very clear about it.",
    );
  }

  if (sys.includes("LIVINGTABLE_ARC_GENERATOR")) return delay(mockArcOutline(last));
  if (sys.includes("LIVINGTABLE_DM")) return delay(mockDmTurn(sys, last));

  // Cold Case interrogation.
  return delay("*shifts in the chair* I've told you where I was. Ask the others.");
}

/**
 * A fixed, deterministic arc for campaignGenerator.ts's mock path. Genre is
 * read straight off the user message, which always literally says
 * "fantasy campaign" or "scifi campaign" (see campaignGenerator.ts's `ask`
 * construction), so this never has to guess.
 */
function mockArcOutline(userMessage: string): string {
  const fantasy = !userMessage.toLowerCase().includes("scifi");
  return JSON.stringify(
    fantasy
      ? {
          title: "The Salt-Blighted Coast",
          throughline: "A creeping blight is poisoning the coastline, and something old beneath the marsh is stirring.",
          beats: [
            "The party arrives in a village and meets a local who has already lost someone to the blight.",
            "A clue leads to a dangerous, half-sunken shrine out in the marsh.",
            "A confrontation reveals who, or what, is actually behind the blight.",
            "The party has to decide what to do with what they've found.",
          ],
          npcs: [{ name: "Maren Hollowell", role: "the herbalist who first raised the alarm" }],
          // The region sketch campaignGenerator.ts now validates: without one
          // in the mock, creating a campaign under `npm run dev` fails its own
          // validator, and the DM's neighbour hints go back to "unexplored."
          regionSketch: [
            { cx: 0, cy: 0, hint: "Fenwick village, half its boats hauled up and rotting" },
            { cx: 1, cy: 0, hint: "the marsh causeway; the half-sunken shrine is visible from here" },
            { cx: 0, cy: -1, hint: "the salt flats, white, cracked and far too quiet" },
            { cx: -1, cy: 0, hint: "the drowned orchard, its trees standing in brackish water" },
            { cx: 0, cy: 1, hint: "the tideline, and whatever this week's tide left on it" },
            { cx: 1, cy: -1, hint: "an old sea-wall, breached, with something nesting in the breach" },
          ],
        }
      : {
          title: "Signal from the Drift",
          throughline: "A derelict station keeps broadcasting a distress call it has no business still sending.",
          beats: [
            "The crew boards the station and meets its one surviving officer, half out of her mind.",
            "A locked section holds the reason the station went dark in the first place.",
            "Something that was never meant to wake up does.",
            "The crew decides what, if anything, to bring back with them.",
          ],
          npcs: [{ name: "Chief Vey", role: "the station's last living officer" }],
          regionSketch: [
            { cx: 0, cy: 0, hint: "the docking spine, emergency lighting only" },
            { cx: 1, cy: 0, hint: "crew quarters, every door manually jammed open from the inside" },
            { cx: 0, cy: -1, hint: "hydroponics, still running, still watering nothing" },
            { cx: -1, cy: 0, hint: "the medbay Chief Vey has barricaded herself into" },
            { cx: 0, cy: 1, hint: "the reactor gallery, where the distress beacon is wired in" },
            { cx: 1, cy: -1, hint: "a sealed lab section the station's own manifest does not list" },
          ],
        },
  );
}

/** The engine's own cell-space deltas (world/coordinates.ts's DIRECTION_DELTAS): N is cy-1, screen convention, not compass. Restated here rather than imported so this bridge module stays free of any game's internals. */
const MOCK_DIRECTION_DELTAS: Record<string, { dcx: number; dcy: number }> = {
  N: { dcx: 0, dcy: -1 },
  NE: { dcx: 1, dcy: -1 },
  E: { dcx: 1, dcy: 0 },
  SE: { dcx: 1, dcy: 1 },
  S: { dcx: 0, dcy: 1 },
  SW: { dcx: -1, dcy: 1 },
  W: { dcx: -1, dcy: 0 },
  NW: { dcx: -1, dcy: -1 },
};

/** How a room reads, per direction, so three crossings don't stack three identical opening paragraphs in the story log. */
const MOCK_ROOM_FLAVOUR: Record<string, { fantasy: string; scifi: string }> = {
  N: { fantasy: "a low hall of salt-scarred stone", scifi: "a hydroponics bay, still watering nothing" },
  NE: { fantasy: "a collapsed stair, half-open to the sky", scifi: "a sealed lab section the manifest doesn't list" },
  E: { fantasy: "a flooded causeway room, ankle-deep", scifi: "crew quarters, every door jammed open from the inside" },
  SE: { fantasy: "a cellar of split barrels", scifi: "a cargo hold stacked wrong, as if in a hurry" },
  S: { fantasy: "a shrine antechamber, its offerings gone soft", scifi: "the reactor gallery, humming under your boots" },
  SW: { fantasy: "a burnt-out kitchen, the hearth long cold", scifi: "a galley, one meal still laid out" },
  W: { fantasy: "an orchard room, trees standing in brackish water", scifi: "a medbay with the lights on and nobody in it" },
  NW: { fantasy: "a breach in an old sea-wall", scifi: "an airlock ring, one seal cycling on its own" },
};

/**
 * DM turns for dm/dmTurn.ts's mock path.
 *
 * The one thing this has to get right to be playable under `npm run dev`
 * rather than merely not crash: assembleCell has to target the RIGHT cell.
 * Those are two different cells and only one of them is the current
 * playspace. On the campaign's opening turn the party has nowhere to stand
 * and the cell to build is the current one. On a fog crossing the party is
 * still in the OLD cell (the DM turn is issued before they move), so the cell
 * to build is the neighbour in the direction they stepped. An earlier version
 * read the first "cell (X,Y)" in the prompt for both, which meant every fog
 * crossing produced `assembleCell (0,0)`, got rejected with "already
 * assembled", and left the player having paid a credit for a room that never
 * appeared. Every other message (Talk, free text) gets narration and
 * sometimes a roll, never an assembleCell, so it can never re-assemble a room
 * that already exists.
 */
function mockDmTurn(sys: string, userMessage: string): string {
  // Anchored on the exact lines promptBuilder.ts renders, rather than "the
  // first coordinate pair anywhere in the prompt" -- the prompt now carries a
  // campaign plan and a memory block that could each contain a coordinate.
  const currentMatch =
    sys.match(/Current playspace: cell \((-?\d+),(-?\d+)\)/) ?? sys.match(/cell \((-?\d+),(-?\d+)\) has not been assembled/);
  const currentCx = currentMatch ? Number(currentMatch[1]) : 0;
  const currentCy = currentMatch ? Number(currentMatch[2]) : 0;
  const fantasy = sys.includes("A fantasy campaign");

  // session/dmContext.ts's describeMoveIntoFog: "The party moves E into the
  // unexplored area beyond the current room."
  const fogMatch = userMessage.match(/party moves (N|NE|E|SE|S|SW|W|NW) into the unexplored/);
  const openingTurn = /has not been assembled yet/.test(sys);

  if (!fogMatch && !openingTurn) return JSON.stringify(mockConversationTurn(sys, userMessage, fantasy));

  const delta = fogMatch ? MOCK_DIRECTION_DELTAS[fogMatch[1]!]! : { dcx: 0, dcy: 0 };
  const cx = currentCx + delta.dcx;
  const cy = currentCy + delta.dcy;
  const flavourKey = fogMatch ? fogMatch[1]! : "N";

  const floorTile = fantasy ? "floor_grass" : "floor_deckplate";
  const wallTile = fantasy ? "wall_stone" : "wall_bulkhead";
  const monsterAsset = fantasy ? "token_goblin" : "token_drone";
  const propAsset = fantasy ? "chest" : "crate";

  const width = 20;
  const height = 15;
  const northGap = { x: 10, y: 0 };
  const southGap = { x: 10, y: height - 1 };
  const eastGap = { x: width - 1, y: 7 };
  const westGap = { x: 0, y: 7 };

  const tiles: string[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const onBorder = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      const isGap =
        (x === northGap.x && y === northGap.y) ||
        (x === southGap.x && y === southGap.y) ||
        (x === eastGap.x && y === eastGap.y) ||
        (x === westGap.x && y === westGap.y);
      return onBorder && !isGap ? wallTile : floorTile;
    }),
  );

  const layout = {
    tiles,
    props: [
      {
        id: `prop-${cx}-${cy}`,
        assetId: propAsset,
        x: 15,
        y: 3,
        label: fantasy ? "the water-swollen chest" : "the scuffed supply crate",
        dc: 12,
        onFound: fantasy
          ? "Under the ruined cloth: a bone whistle, still dry, and a fistful of old coin."
          : "Under the packing foam: a spare power cell and someone's unsent message chip.",
      },
    ],
    tokens: [{ id: `monster-${cx}-${cy}`, assetId: monsterAsset, x: 5, y: 11, kind: "monster" }],
    exits: [
      { at: northGap, edge: "N", toCell: { cx, cy: cy - 1 } },
      { at: southGap, edge: "S", toCell: { cx, cy: cy + 1 } },
      { at: eastGap, edge: "E", toCell: { cx: cx + 1, cy } },
      { at: westGap, edge: "W", toCell: { cx: cx - 1, cy } },
    ],
  };

  const flavour = MOCK_ROOM_FLAVOUR[flavourKey]!;
  const place = fantasy ? flavour.fantasy : flavour.scifi;
  const narration = fantasy
    ? `The way opens onto ${place}. Something in the far corner is worth a closer look, and something else in here is not furniture.`
    : `The bulkhead cycles back onto ${place}. Something's crated up in the corner. Something else on the far side is not cargo.`;

  return JSON.stringify({
    narration,
    actions: [{ type: "assembleCell", cx, cy, layout }],
  });
}

/**
 * A Talk / free-text turn. Two things this deliberately does that the earlier
 * two-fixed-strings version didn't: it varies with the player's own message,
 * so an NPC the mock itself placed can actually be conversed with, and it
 * sometimes comes back with a real rollRequest, so the Dice panel is
 * exercised at least once in a dev session instead of sitting empty for the
 * whole of it and leaving the entire roll surface unclicked.
 */
function mockConversationTurn(sys: string, userMessage: string, fantasy: boolean): Record<string, unknown> {
  const pcMatch = sys.match(/Token id on the board: (\S+)/) ?? sys.match(/id=(\S+) asset=\S+ kind=pc/);
  const pcId = pcMatch ? pcMatch[1]! : "pc-1";
  const asked = userMessage.toLowerCase();

  if (/\?|ask|what|who|why|where|how/.test(asked)) {
    return {
      narration: fantasy
        ? "The answer comes slower than the question deserved. Whoever you're talking to weighs how much of it you've already worked out for yourself, and tells you a little less than that."
        : "The reply comes over the local channel with a half-second lag that has nothing to do with distance. You're being decided about.",
      actions: [],
      rollRequests: [
        {
          id: `mock-insight-${Math.floor(Math.random() * 100000)}`,
          by: pcId,
          kind: "check",
          skill: "Insight",
          dc: 12,
          reason: "reading whether that answer was the whole of it",
        },
      ],
      menuHint: ["Talk", "Move", "Search"],
    };
  }

  if (/threat|attack|kill|hurt|weapon|draw|fight/.test(asked)) {
    return {
      narration: fantasy
        ? "That lands the way you meant it to. Nothing has been drawn yet, but the room has stopped being a room and started being ground."
        : "The tone reads across the channel cleanly. Nothing's been powered up yet. Everything has been thought about."
      ,
      actions: [],
      menuHint: ["Attack", "Talk", "Move"],
    };
  }

  return {
    narration: fantasy
      ? "You say your piece. The quiet afterward has a weight to it, the kind that comes before something does."
      : "You say your piece. The deck plating hums on underfoot, indifferent, and somewhere further in a hatch closes.",
    actions: [],
    menuHint: ["Talk", "Move", "Search"],
  };
}

const delay = (s: string): Promise<string> =>
  new Promise((resolve) => setTimeout(() => resolve(s), 450));
