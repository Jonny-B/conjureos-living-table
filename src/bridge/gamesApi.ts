/**
 * Client for `games-db`, Conjure Games's own backend.
 *
 * Every call is a Phase 16c remote action: we invoke our OWN `gamesDb` remote
 * action, the kernel mints a short-lived ConjureOS identity token, attaches it,
 * and POSTs to the URL in our manifest. The backend derives the player from the
 * token's `sub`. We never hold a Supabase session and never talk to any
 * platform table: as far as this app is concerned, games-db is somebody
 * else's server that happens to be fast.
 *
 * Outside ConjureOS (`npm run dev`) every call falls through to an in-memory
 * mock so the whole app is iterable without a backend.
 */
import type {
  ColdCasePayload,
  ColdCaseSolution,
  GameId,
  LeaderboardEntry,
  Streak,
  ThreadsPayload,
  ThreadsSolution,
  VaultLevelView,
  VaultRun,
} from "../types";

// No direct-fetch fallback URL here, unlike the Recipes client: games-db has no
// public actions at all (every one needs a verified player), so there is never
// a call that could bypass the remote-action path. Outside ConjureOS we go to
// the mock instead.
const REMOTE_ACTION = "gamesDb";

/**
 * Our OWN kernel path, derived from the per-app origin rather than hardcoded.
 * Desktop serves each app from `<slug>.conjureos.app`, mobile from
 * `<slug>.mobile.conjureos.app`, and install-time collision avoidance can land
 * us at `games-2`: a hardcoded `/apps/games` would then fail to resolve and
 * silently break every backend call. (This exact bug cost the Recipes app a
 * release; see its recipesApi.ts.)
 */
function selfAppPath(): string {
  try {
    const host = globalThis.location?.hostname ?? "";
    if (host.endsWith(".conjureos.app")) {
      const slug = host.split(".")[0] ?? "";
      if (/^[a-z0-9][a-z0-9-]*$/.test(slug)) return `/apps/${slug}`;
    }
  } catch {
    /* fall through */
  }
  return "/apps/living-table";
}
const APP_PATH = selfAppPath();

interface Bridge {
  actions?: { invoke: (appPath: string, action: string, params: unknown) => Promise<unknown> };
}
const cjs = (): Bridge => (globalThis as { __conjureos?: Bridge }).__conjureos ?? {};

/** True when the backend is reachable (i.e. we're running inside ConjureOS). */
export function isBackendAvailable(): boolean {
  return typeof cjs().actions?.invoke === "function";
}

// The kernel does the actual network fetch on our behalf (see the file header),
// and on a dropped wifi-to-cellular handoff or a single flaky request it
// rejects with the browser's own generic string ("Load failed" in Safari,
// "Failed to fetch" in Chrome), not an error from OUR backend. Surfacing that
// raw string fails the whole game load over what's often a one-off blip, and
// reads like something is broken when it's just the network for a second.
const TRANSIENT_NETWORK_ERROR = /load failed|failed to fetch|networkerror|network request failed/i;
const isTransientNetworkError = (e: unknown): boolean => e instanceof Error && TRANSIENT_NETWORK_ERROR.test(e.message);

/**
 * Diagnostic-only: a *direct* fetch to games-db from THIS document (the app's
 * own cross-origin iframe), bypassing the kernel bridge entirely. The kernel
 * does the real call from a different browsing context (the top-level shell).
 * If that one is consistently failing with a network-shaped error while
 * this one succeeds (or vice versa), that asymmetry is the single most useful
 * fact for telling "something is blocking traffic to this backend from this
 * device" apart from "the kernel's own fetch path has a bug." Unauthenticated
 * on purpose (games-db has no public actions, see above): a 4xx JSON reply
 * still proves the connection itself got through, which is all this checks.
 * Anon keys are public by design, shipped in every browser already.
 */
const DIAG_TARGETS: Array<{ label: string; url: string; anon: string }> = [
  {
    label: "prod",
    url: "https://ntgelbtepecqsqloxmct.supabase.co/functions/v1/games-db",
    anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50Z2VsYnRlcGVjcXNxbG94bWN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTkzMzEsImV4cCI6MjA5MzY3NTMzMX0.fgRCszkeAbHANaK-JJAGmTwWHyOh-3b6-od1c3s3V0w",
  },
  {
    label: "dev",
    url: "https://mqpvjlsywrptefgwuztn.supabase.co/functions/v1/games-db",
    anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xcHZqbHN5d3JwdGVmZ3d1enRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MTA3OTMsImV4cCI6MjA5NTQ4Njc5M30.ITZjX5KkMNgbJuFEHS5-IqFFJC6A39OynVgOznZeqD8",
  },
];

async function diagProbe(target: (typeof DIAG_TARGETS)[number]): Promise<string> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: target.anon },
      body: "{}",
      signal: controller.signal,
    });
    return `${target.label} ok ${res.status}(${Date.now() - started}ms)`;
  } catch (e) {
    const name = e instanceof Error ? e.name : "?";
    const msg = e instanceof Error ? e.message : String(e);
    return `${target.label} FAIL ${name}:${msg}(${Date.now() - started}ms)`;
  } finally {
    clearTimeout(timer);
  }
}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const actions = cjs().actions;
  if (!actions?.invoke) return mock<T>(action, params);
  const t0 = Date.now();
  try {
    return (await actions.invoke(APP_PATH, REMOTE_ACTION, { action, ...params })) as T;
  } catch (e) {
    const d0 = Date.now() - t0;
    if (!isTransientNetworkError(e)) throw e;
    await new Promise((resolve) => setTimeout(resolve, 600));
    const t1 = Date.now();
    try {
      return (await actions.invoke(APP_PATH, REMOTE_ACTION, { action, ...params })) as T;
    } catch (e2) {
      const d1 = Date.now() - t1;
      // Still failing after the retry: now it's worth surfacing, but in our
      // own words rather than a bare browser network string, plus a direct,
      // kernel-bypassing probe (see diagProbe above) appended as a compact
      // diagnostic tag, so a screenshot of THIS carries real forensic detail.
      if (isTransientNetworkError(e2)) {
        const diag = await Promise.all(DIAG_TARGETS.map(diagProbe));
        throw new Error(
          `Couldn't reach the game. Check your connection and try again. ` +
            `[diag: kernel fail(${d0}ms) fail(${d1}ms) | ${diag.join(" | ")}]`
        );
      }
      throw e2;
    }
  }
}

/**
 * `YYYY-MM-DD` in UTC, everyone's day turns over at the same instant.
 *
 * The DATE is shared; the PUZZLE is not. Migration 117 made the daily per
 * player, so this is the key a player's own row is stored under, never a
 * promise that two people on the same date are playing the same board.
 */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── player ──────────────────────────────────────────────────────────────

export interface MeResponse {
  handle: string | null;
  /**
   * Migration 123, the arcade name this player posts scores under. Null means
   * they have never chosen one, which is the signal Jump Runner uses to open
   * the name prompt after a run instead of submitting silently.
   */
  boardName: string | null;
  memberSince: string | null;
  streaks: Streak[];
  recent: { game: GameId; outcome: string; score: number; created_at: string }[];
}

export const getMe = (): Promise<MeResponse> => call<MeResponse>("me");

// ── daily puzzles ───────────────────────────────────────────────────────

export interface DailyResponse<P> {
  puzzle: { id: string; payload: P; seededAt: string } | null;
  needsSeed: boolean;
  /**
   * What this player has already been served, sent ONLY with a `needsSeed`
   * answer, because that is the only branch that goes on to build a prompt.
   * Threads feeds both lists to the generator as "do not write this again";
   * without them the model has no memory between days and returns its
   * favourite connections on repeat. Absent from an older backend, so every
   * reader must treat it as optional.
   */
  recent?: { words: string[]; connections: string[] };
}

export const getDailyThreads = (date: string): Promise<DailyResponse<ThreadsPayload>> =>
  call("daily", { game: "threads", date });

export const getDailyColdCase = (date: string): Promise<DailyResponse<ColdCasePayload>> =>
  call("daily", { game: "coldcase", date });

// ── the profile (BE-5) ──────────────────────────────────────────────────

/**
 * One document per player that follows them across devices. The client writes
 * `settings`, `warmups` and `notes` through a merge patch (null deletes a key);
 * `counters` and `achievements` are the server's alone, and a patch naming
 * either is refused. Fire-and-forget from the UI: the profile is a
 * convenience, never a result.
 */
export interface PlayerProfile {
  v?: 1;
  settings?: {
    sound?: "off" | "on" | "room";
    reducedMotion?: boolean;
    roomTone?: boolean;
    dailyBoardOptIn?: boolean;
  };
  warmups?: Partial<Record<"threads" | "coldcase" | "vault", string>>;
  notes?: Record<string, { rings: string[]; scratch?: string }>;
  /** Server-owned. */
  counters?: { plays?: number; solved?: number; archivePlays?: number };
  /** Server-owned. */
  achievements?: Record<string, string>;
}

export type ProfilePatch = {
  [K in "v" | "settings" | "warmups" | "notes"]?: PlayerProfile[K] | null;
};

export const getProfile = (): Promise<{ profile: PlayerProfile }> => call("getProfile");

export const setProfile = (patch: ProfilePatch): Promise<{ profile: PlayerProfile }> =>
  call("setProfile", { patch });

// ── the archive (BE-1) ──────────────────────────────────────────────────

/** One date in this player's own history for a daily game. Metadata only: the
 *  board itself still comes from `daily`, so a month costs one small call. */
export interface ArchiveDay {
  date: string;
  /** A puzzle exists for this date, so opening it generates nothing. */
  hasPuzzle: boolean;
  played: boolean;
  solved: boolean;
  score?: number;
}

export interface ArchiveResponse {
  game: GameId;
  from: string;
  to: string;
  today: string;
  days: ArchiveDay[];
}

/** The server caps one call's span (120 days) and defaults to the trailing 60. */
export const getDailyArchive = (
  game: "threads" | "coldcase",
  range: { from?: string; to?: string } = {},
): Promise<ArchiveResponse> => call("dailyArchive", { game, ...range });

export interface SeedResponse<P> {
  puzzle: { id: string; payload: P; seededAt: string };
  /**
   * True for a NEW row; false when you already had one, a double-tap, or a
   * retry after a dropped response. Migration 117 made the daily PER PLAYER, so
   * both cases are yours: on `false` the server's copy is still the one to
   * play, because it is what a reopen and tomorrow's archive return.
   */
  fresh: boolean;
  /**
   * @deprecated Pre-117 field, when the daily was seeded once for the whole
   * world and this said whether you were first. Under the per-player model it
   * is always you, so it carries no information. NOTHING IN `src/` READS IT any
   * more, Threads and Cold Case both branch on `fresh`, and it is declared
   * only because the server still sends it. Do not reintroduce a reader.
   */
  seededByYou: boolean;
}

export const seedDaily = <P>(
  game: GameId,
  date: string,
  payload: P,
  solution: unknown,
): Promise<SeedResponse<P>> => call("seedDaily", { game, date, payload, solution });

/**
 * Check four selected tiles against the day's hidden answer key. Server-side on
 * purpose: for Threads the solution never needs to reach the client during
 * play, so the daily genuinely cannot be spoiled by reading devtools.
 */
export interface GuessResponse {
  correct: boolean;
  /** Present on a correct guess: the connection, for the solved row. */
  groupName?: string;
  level?: number;
  /** True when exactly three of the four belong together. */
  oneAway?: boolean;
  /** True when that was the last group. */
  solved?: boolean;
}

export const guessGroup = (date: string, words: string[]): Promise<GuessResponse> =>
  call("guessGroup", { game: "threads", date, words });

/** Name a culprit for the daily Cold Case. Checked server-side. */
export interface AccuseResponse {
  correct: boolean;
  solution: ColdCaseSolution | null;
}

export const accuse = (date: string, name: string): Promise<AccuseResponse> =>
  call("accuse", { game: "coldcase", date, name });

/** The answer key, released only once the player has a recorded result. */
export const getSolution = <S>(game: GameId, date: string): Promise<{ solution: S | null }> =>
  call("solution", { game, date });

// ── results ─────────────────────────────────────────────────────────────

/** How a Jump Runner run was played. Migration 123, see `RunPlatform`. */
export type RunPlatform = "mobile" | "web";
export type RunDifficulty = "easy" | "medium" | "hard";

export interface SubmitPlayInput {
  game: GameId;
  date?: string;
  custom?: boolean;
  outcome: "win" | "loss";
  score?: number;
  mistakes?: number;
  turns?: number;
  durationMs?: number;
  detail?: Record<string, unknown>;
  /**
   * Migration 123. Jump Runner only: the board ranks within a platform and a
   * difficulty, never across them, so a run that omits these can be shown on
   * the unsplit board but never on a filtered one.
   */
  platform?: RunPlatform;
  difficulty?: RunDifficulty;
}

export interface SubmitPlayResponse {
  recorded: boolean;
  alreadyRecorded: boolean;
  streak: { current: number; best: number; plays: number; wins: number; lastWonOn: string | null };
}

export const submitPlay = (input: SubmitPlayInput): Promise<SubmitPlayResponse> =>
  call("submitPlay", input as unknown as Record<string, unknown>);

export interface BoardFilter {
  platform?: RunPlatform;
  difficulty?: RunDifficulty;
}

/**
 * `date` is required for the daily games and ignored for Jump Runner (all-time).
 *
 * Migration 123, omitting a filter means "everything, unsplit", which is the
 * only view that includes runs recorded before platform and difficulty were
 * captured. Passing one narrows to runs that actually declared it.
 */
export const getLeaderboard = (
  game: GameId,
  date?: string,
  filter?: BoardFilter,
): Promise<{ entries: LeaderboardEntry[] }> =>
  call("leaderboard", { game, date, ...filter });

/**
 * Claim the name this player appears under on the board, the arcade
 * cabinet's "enter your initials", typed once and reused from then on.
 * The server upper-cases and validates; it rejects anything outside
 * 3-12 chars of A-Z 0-9 space dash underscore.
 */
export const setBoardName = (name: string): Promise<{ boardName: string }> =>
  call("setName", { name });

// ── per-game saved state ────────────────────────────────────────────────
//
// A game's own save file, opaque to Conjure Games. Jump Runner uses it in place of
// the VFS folder it had as a built-in, which is what makes a best score follow
// the player to another device.

export const getState = (game: GameId): Promise<{ state: unknown | null }> => call("getState", { game });

export const putState = (game: GameId, state: Record<string, unknown>): Promise<{ saved: boolean }> =>
  call("putState", { game, state });

// ── The Vault ───────────────────────────────────────────────────────────

export const getVaultProgress = (): Promise<{ levels: VaultLevelView[] }> => call("vaultProgress");

export const startVaultRun = (level: number): Promise<VaultRun> => call("vaultStart", { level });

export interface CrackResponse {
  cracked: boolean;
  alreadyCracked?: boolean;
  reason?: string;
  passphrase?: string;
  turns?: number;
  level?: number;
  crackRate?: number | null;
}

/**
 * Claim a crack. We send the transcript because the server credits the run only
 * if the KEEPER actually said the passphrase: typing it yourself proves
 * nothing.
 */
export const crackVault = (
  runId: string,
  transcript: { role: string; content: string }[],
  turns: number,
): Promise<CrackResponse> => call("vaultCrack", { runId, transcript, turns });

export const giveUpVault = (runId: string, turns: number): Promise<{ passphrase: string }> =>
  call("vaultGiveUp", { runId, turns });

// ── The Living Table ────────────────────────────────────────────────────
//
// Ten actions against games-db's migration-116 tables (see DESIGN.md, "The
// Living Table"). Every response shape here is copied from the ACTUAL
// handler in the ConjureOS repo's supabase/functions/games-db/index.ts (the
// `rowToCampaign` / `rowToCharacter` / `ltAssetManifest` functions), not
// guessed from DESIGN.md's prose: camelCase field names match exactly what
// those handlers already return, so no translation layer is needed at the
// call site.

export type LtTemplate = "fantasy" | "scifi";

export interface LtCampaign {
  id: string;
  template: LtTemplate;
  title: string;
  /** The private arc-plan JSON generated once by the player's own AI call at creation (see games-lt's campaign generator). Opaque to games-db; shaped by this app. */
  arcOutline: unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** What ltCampaignList returns per row, no `arcOutline`, matching the handler's own narrower `select()`. */
export interface LtCampaignListItem {
  id: string;
  template: LtTemplate;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LtCharacter {
  id: string;
  campaignId: string;
  kind: "player" | "companion";
  name: string;
  archetype: string;
  appearance: unknown;
  level: number;
  xp: number;
  /** The real SRD stat block (characters/creation.ts's CharacterSheet), opaque to games-db: it stores whatever the client-side rules engine computed. */
  stats: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface LtMemoryFactRow {
  category: "npc" | "promise" | "item" | "event" | "thread";
  key: string;
  fact: Record<string, unknown>;
  status: string;
  updatedAt: string;
}

export interface LtMemoryLogRow {
  sceneSeq: number;
  tier: "verbatim" | "condensed";
  content: string;
}

export interface LtCell {
  cx: number;
  cy: number;
  /** A CellLayout (world/cell.ts), opaque to games-db: it stores whatever world/connectivity.ts already validated client-side. */
  layout: unknown;
  assembledAt: string;
}

export const ltCampaignCreate = (
  template: LtTemplate,
  title: string,
  arcOutline: unknown,
): Promise<{ campaign: LtCampaign }> => call("ltCampaignCreate", { template, title, arcOutline });

export const ltCampaignList = (): Promise<{ campaigns: LtCampaignListItem[] }> => call("ltCampaignList");

export const ltCampaignGet = (
  campaignId: string,
): Promise<{
  campaign: LtCampaign;
  characters: LtCharacter[];
  facts: LtMemoryFactRow[];
  log: LtMemoryLogRow[];
}> => call("ltCampaignGet", { campaignId });

export interface LtCharacterCreateInput {
  campaignId: string;
  name: string;
  archetype: string;
  kind?: "player" | "companion";
  appearance?: Record<string, unknown>;
  stats?: Record<string, unknown>;
}

export const ltCharacterCreate = (input: LtCharacterCreateInput): Promise<{ character: LtCharacter }> =>
  call("ltCharacterCreate", input as unknown as Record<string, unknown>);

export interface LtCharacterUpdateInput {
  characterId: string;
  stats?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
  level?: number;
  xp?: number;
}

export const ltCharacterUpdate = (input: LtCharacterUpdateInput): Promise<{ saved: boolean }> =>
  call("ltCharacterUpdate", input as unknown as Record<string, unknown>);

export const ltCellGet = (campaignId: string, cx: number, cy: number): Promise<{ cell: LtCell | null }> =>
  call("ltCellGet", { campaignId, cx, cy });

export const ltCellAssemble = (
  campaignId: string,
  cx: number,
  cy: number,
  layout: unknown,
): Promise<{ cell: LtCell }> => call("ltCellAssemble", { campaignId, cx, cy, layout });

export const ltMemoryAppend = (
  campaignId: string,
  tier: "verbatim" | "condensed",
  sceneSeq: number,
  content: string,
): Promise<{ saved: boolean }> => call("ltMemoryAppend", { campaignId, tier, sceneSeq, content });

export interface LtFactUpsertInput {
  campaignId: string;
  category: "npc" | "promise" | "item" | "event" | "thread";
  key: string;
  fact: Record<string, unknown>;
  status?: string;
}

export const ltFactUpsert = (input: LtFactUpsertInput): Promise<{ saved: boolean }> =>
  call("ltFactUpsert", input as unknown as Record<string, unknown>);

/** One sprite off the wire, matching games-db's `ltAssetManifest` mapping of `game_asset_manifest` rows exactly. */
export interface LtAssetWire {
  assetId: string;
  kind: "tile" | "token" | "prop";
  name: string;
  size: number;
  walkable: boolean;
  /** A 16x16 grid of palette indices (or -1 for transparent): render/canvasRenderer.ts's SpriteGrid shape, straight off the wire. */
  pixels: number[][];
}

export const ltAssetManifest = (
  template: LtTemplate,
): Promise<{ template: LtTemplate; palette: unknown; assets: LtAssetWire[] }> =>
  call("ltAssetManifest", { template });

// ── dev mock ────────────────────────────────────────────────────────────
//
// In-memory, per-page-load. Enough to click through every screen under
// `npm run dev`; loses everything on reload, which is the point: nothing here
// should ever be mistaken for the real backend.

const memory: {
  daily: Record<string, { id: string; payload: unknown; solution: unknown }>;
  cracked: Set<number>;
  runs: Record<string, { level: number; passphrase: string }>;
  state: Record<string, Record<string, unknown>>;
  tally: Record<string, { plays: number; wins: number; current: number; best: number }>;
  /** BE-5's profile document. */
  profile: PlayerProfile;
  /** Daily results by "game:date", so the mock archive can colour its cells. */
  plays: Record<string, { won: boolean; score: number }>;
  /** Migration 123, the arcade name, so setName -> me round-trips in dev. */
  boardName: string | null;
  /** The Living Table's own slice, extending this object rather than replacing
   * it. Keyed the way the real tables are: campaigns/characters by id, cells by
   * "campaignId:cx,cy", facts by "campaignId:category:key", log as one growing
   * array per campaign. */
  lt: {
    campaigns: Record<string, LtCampaign>;
    characters: Record<string, LtCharacter>;
    cells: Record<string, LtCell>;
    /** `campaignId` rides along only so ltCampaignGet's mock can filter by it;
     * stripped back out to the real LtMemoryFactRow shape before returning. */
    facts: Record<string, LtMemoryFactRow & { campaignId: string }>;
    log: Record<string, LtMemoryLogRow[]>;
  };
} = {
  daily: {},
  // `__cgDemoCracked` is a SCREENSHOT SEAM, the same kind as `__cgDemoMe` and
  // `__cgMockDelayMs` below. §16.3 needs a MIXED corridor, some doors cracked,
  // one next, the rest locked, because that is the state a player is in for
  // the whole game after their first crack, and there is no click path to it
  // inside one scene. Nothing in the app writes it; only `scripts/shot.mjs`
  // does, through `page.addInitScript`.
  cracked: new Set<number>(
    (globalThis as { __cgDemoCracked?: number[] }).__cgDemoCracked ?? [],
  ),
  runs: {},
  boardName: null,
  state: {},
  /* THE MOCK HAS TO HONOUR THE CALL IT WAS JUST GIVEN. A hardcoded
   * `{ plays: 1, wins: 1 }` made the Vault's LOSS panel read "1 CRACK · 1 RUN"
   * four lines under its own headline "the door is still shut", a panel
   * contradicting itself in one of the two terminal-state shots every reviewer
   * is told to open. Counted per game, so a give-up records 0 cracks. */
  tally: {},
  plays: {},
  profile: {},
  lt: { campaigns: {}, characters: {}, cells: {}, facts: {}, log: {} },
};

let runSeq = 0;
let ltSeq = 0;
const nowIso = () => new Date().toISOString();

/**
 * A tiny synthetic manifest per template, standing in for `ltAssetManifest`
 * under `npm run dev`. Asset ids are copied straight from the REAL launch
 * roster (scripts/assets/fantasy.ts / scifi.ts's SPRITES), not invented, so
 * character creation's "appearanceAssetId = token_<archetypeId>" convention
 * resolves the same way in mock mode as it does against the real backend.
 * The pixel data itself is throwaway (a solid block for tiles, a small
 * centered dot for tokens/props) since nothing about the mock's visuals is
 * meant to look right, only to render without crashing.
 */
function solidGrid(index: number): number[][] {
  return Array.from({ length: 16 }, () => Array(16).fill(index) as number[]);
}
function dotGrid(index: number): number[][] {
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (x >= 5 && x <= 10 && y >= 5 && y <= 10 ? index : -1)),
  );
}
const MOCK_PALETTE = [
  [0x4f, 0x7a, 0x2e], // 0 floor
  [0x7a, 0x7a, 0x82], // 1 wall
  [0xd9, 0xb3, 0x82], // 2 token
  [0x6b, 0x42, 0x26], // 3 prop
];
function mockAsset(assetId: string, kind: "tile" | "token" | "prop", walkable: boolean): { assetId: string; kind: "tile" | "token" | "prop"; name: string; size: 16; walkable: boolean; pixels: number[][] } {
  const pixels = kind === "tile" ? solidGrid(walkable ? 0 : 1) : dotGrid(kind === "token" ? 2 : 3);
  return { assetId, kind, name: assetId, size: 16, walkable, pixels };
}
/**
 * A whitespace-separated id list expanded into mock assets of one kind and
 * walkability. The real rosters are 281 and 93 sprites; spelling every one as
 * its own `mockAsset(...)` call is 374 lines of near-identical source in a
 * file that ships in the bundle, and it buries the one thing a reader needs
 * from this list, which is WHICH ids are walkable.
 */
function mockAssets(kind: "tile" | "token" | "prop", walkable: boolean, ids: string): ReturnType<typeof mockAsset>[] {
  return ids.trim().split(/\s+/).map((id) => mockAsset(id, kind, walkable));
}

/**
 * The real sprite library, when a dev server is serving it.
 *
 * `scripts/assets/build-dev-manifest.ts` writes the true palettes and pixels to
 * `.devserve/livingtable-assets.json`, which `conj-pack dev` serves and
 * `build-bundle.mjs` STRIPS, so this fetch succeeds only on a local dev server
 * and 404s everywhere else. That keeps the asset library out of the published
 * bundle (DESIGN.md's rule) while letting a local play-through show the art the
 * art lanes actually authored instead of the four-colour placeholder below.
 *
 * Inside ConjureOS this code path is never reached at all: the real games-db
 * remote action answers `ltAssetManifest`. The placeholder remains the fallback
 * for a bundled build opened outside a host, where the JSON is absent.
 */
type DevManifestFile = Record<string, { palette: number[][]; assets: ReturnType<typeof mockAsset>[] }>;
let devManifestOnce: Promise<DevManifestFile | null> | null = null;

function loadDevManifest(): Promise<DevManifestFile | null> {
  if (devManifestOnce) return devManifestOnce;
  devManifestOnce =
    typeof fetch === "function"
      ? fetch("/livingtable-assets.json")
          .then((res) => (res.ok ? (res.json() as Promise<DevManifestFile>) : null))
          .catch(() => null)
      : Promise.resolve(null);
  return devManifestOnce;
}

async function devOrPlaceholderManifest(template: LtTemplate) {
  const file = await loadDevManifest();
  const real = file?.[template];
  if (real && Array.isArray(real.assets) && real.assets.length > 0) {
    return { template, palette: real.palette, assets: real.assets };
  }
  return { template, palette: MOCK_PALETTE, assets: MOCK_LT_ASSETS[template] };
}

/**
 * The nineteen boundary shapes render/terrainEdges.ts can substitute: fifteen
 * non-empty orthogonal neighbour sets plus four inner corners. Spelled the way
 * EDGE_SUFFIX_BY_MASK and INNER_CORNER_SUFFIX spell them, because those are
 * the ids the renderer actually asks the manifest for.
 */
const MOCK_EDGE_SUFFIXES = [
  "n", "e", "s", "w",
  "ne", "nw", "se", "sw",
  "ns", "ew",
  "nes", "wne", "swn", "esw",
  "nesw",
  "inw", "ine", "isw", "ise",
];

/** Every suffix of every named transition prefix, which is how the art files build them too. */
function mockEdgeSets(walkable: boolean, prefixes: string): ReturnType<typeof mockAsset>[] {
  return prefixes
    .trim()
    .split(/\s+/)
    .flatMap((prefix) => MOCK_EDGE_SUFFIXES.map((suffix) => mockAsset(`${prefix}${suffix}`, "tile", walkable)));
}

/**
 * The dev mock's roster mirrors the REAL one id-for-id and walkable-for-
 * walkable (scripts/assets/fantasy.ts and scifi.ts, 281 and 93 sprites). It is
 * what the DM sees when a developer runs the game outside the ConjureOS
 * shell, and `availableAssetIds` is a hard gate: any action naming an id the
 * manifest doesn't list is rejected outright. A short mock therefore doesn't
 * degrade gracefully, it silently makes most of the art untestable locally
 * and makes the DM look like it keeps inventing ids. The sprites themselves
 * stay flat placeholder blocks -- this list exists to get the VOCABULARY
 * right, not the pixels; the real pixels come from games-db.
 *
 * Two tests in test/livingtable-integration.test.ts pin this against the real
 * SPRITES arrays, so a roster that drifts fails rather than quietly shrinking
 * what the DM is allowed to place.
 */
export const MOCK_LT_ASSETS: Record<LtTemplate, ReturnType<typeof mockAsset>[]> = {
  fantasy: [
    // Floors and the cliff cap: four interchangeable field tiles per material
    // (the base plus _b, _c, _d), which render/tileVariants.ts scatters, plus
    // the four decals it draws at a lower weight.
    ...mockAssets("tile", true, `
      floor_grass floor_grass_b floor_grass_c floor_grass_d
      floor_grass_pale floor_grass_pale_b floor_grass_pale_c floor_grass_pale_d
      floor_dirt floor_dirt_b floor_dirt_c floor_dirt_d
      floor_sand floor_sand_b floor_sand_c floor_sand_d
      floor_stone floor_stone_b floor_stone_c floor_stone_d
      cliff_top cliff_top_b cliff_top_c cliff_top_d
      floor_grass_tufted floor_grass_flowers floor_stone_cracked floor_stone_drain
    `),
    // Water, canopy, the cliff face and the wall course: field variants just
    // the same, but nothing stands on them.
    ...mockAssets("tile", false, `
      water water_b water_c water_d
      forest_canopy forest_canopy_b forest_canopy_c forest_canopy_d
      cliff_face cliff_face_b cliff_face_c cliff_face_d
      wall_stone wall_stone_b wall_stone_c wall_stone_top wall_stone_base
    `),
    // Terrain transitions. The DM never names these: the renderer substitutes
    // them for the plain tile from a cell's own neighbours
    // (render/terrainEdges.ts). They are listed so the dev roster stays
    // id-for-id with the real template and the dev renderer draws the softened
    // boundary instead of falling back to a razor-edged rectangle. A
    // transition is walkable when the material it belongs to is. The eight
    // hand-placed shore_* tiles that used to sit here are retired: they drew
    // their bank as a straight line at a fixed column, and water_edge_grass_
    // replaces them with a full nineteen that wander.
    ...mockEdgeSets(true, `
      floor_grass_edge_ floor_grass_edge_dirt_ floor_grass_edge_sand_
      floor_grass_pale_edge_ floor_stone_edge_grass_ floor_stone_edge_water_
      cliff_edge_
    `),
    ...mockEdgeSets(false, "water_edge_ water_edge_grass_ water_edge_sand_"),
    // Wall profiles (render/wallProfiles.ts): the sixteen wall joins and the
    // four long-run variants, drawn from a wall cell's neighbours. Like the
    // transitions above they are the renderer's, never the DM's: adaptManifest
    // keeps them out of the world manifest and the prompt's id lists. They are
    // listed so the dev roster stays id-for-id with the real template and the
    // dev renderer takes the same wall path. Not walkable, like the wall.
    ...mockAssets("tile", false, `
      wall_stone_join_none wall_stone_join_n wall_stone_join_e wall_stone_join_ne
      wall_stone_join_s wall_stone_join_ns wall_stone_join_es wall_stone_join_nes
      wall_stone_join_w wall_stone_join_nw wall_stone_join_ew wall_stone_join_new
      wall_stone_join_sw wall_stone_join_nsw wall_stone_join_esw wall_stone_join_nesw
      wall_stone_join_ew_b wall_stone_join_ew_c wall_stone_join_ns_b wall_stone_join_ns_c
    `),
    // Props. The multi-tile structures (cottage, arch, stair, pillar, table,
    // bed, fence, well) are ordinary props the DM lays in a block; only the
    // members you walk through are walkable.
    ...mockAssets("prop", false, `
      wall_stone_jambs_ns door_closed_ns
      door_closed tree tree_left tree_right chest chest_open
      cottage_nw cottage_n cottage_ne cottage_w cottage_e cottage_sw cottage_s cottage_se
      arch_jamb_w arch_jamb_e pillar_top pillar_base table_w table_e bed_head bed_foot
      fence_w fence_mid fence_e well_nw well_ne well_sw well_se
    `),
    ...mockAssets("prop", true, `
      door_open door_open_ns torch torch_left torch_right cottage_door arch_passage stair_up_w stair_up_e
    `),
    ...mockAssets("token", false, `
      token_knight token_shadow token_healer token_fireball_person token_goblin
      token_skeleton token_villager token_robed_figure token_guard
    `),
    // The 72 equipment sprites ship with kind "token" and walkable false, the
    // same as a body, because the compositor draws them over a character
    // rather than the world placing them on a tile. They are filtered out of
    // what the DM may place (dm/promptBuilder.ts) and rejected outright if one
    // is named anyway (dm/turnSchema.ts), but they must be in this roster or
    // the manifest the compositor looks a layer up in has a hole in it.
    ...mockAssets("token", false, `
      gear_knight_weapon_base gear_knight_weapon_rare gear_knight_weapon_legendary
      gear_knight_outer_base gear_knight_outer_rare gear_knight_outer_legendary gear_knight_crown_base
      gear_knight_crown_rare gear_knight_crown_legendary gear_shadow_weapon_base
      gear_shadow_weapon_rare gear_shadow_weapon_legendary gear_shadow_outer_base
      gear_shadow_outer_rare gear_shadow_outer_legendary gear_shadow_crown_base gear_shadow_crown_rare
      gear_shadow_crown_legendary gear_healer_weapon_base gear_healer_weapon_rare
      gear_healer_weapon_legendary gear_healer_outer_base gear_healer_outer_rare
      gear_healer_outer_legendary gear_healer_crown_base gear_healer_crown_rare
      gear_healer_crown_legendary gear_fireball_person_weapon_base gear_fireball_person_weapon_rare
      gear_fireball_person_weapon_legendary gear_fireball_person_outer_base
      gear_fireball_person_outer_rare gear_fireball_person_outer_legendary
      gear_fireball_person_crown_base gear_fireball_person_crown_rare
      gear_fireball_person_crown_legendary
    `),
    // Contract v2 (equipmentTypes.ts 11.8): per-archetype boots overlays,
    // per-template ring and amulet icons, and the two empty-slot silhouettes.
    // Same kind and walkability as every other gear sprite, for the same
    // reason; exactly `v2GearSpriteIdsFor("fantasy")`.
    ...mockAssets("token", false, `
      gear_knight_boots_base gear_knight_boots_rare gear_shadow_boots_base gear_shadow_boots_rare
      gear_healer_boots_base gear_healer_boots_rare gear_fireball_person_boots_base
      gear_fireball_person_boots_rare
      gear_fantasy_ring_base gear_fantasy_ring_rare gear_fantasy_ring_legendary
      gear_fantasy_amulet_base gear_fantasy_amulet_rare
      gear_fantasy_ring_empty gear_fantasy_amulet_empty
    `),
  ],
  scifi: [
    ...mockAssets("tile", true, `
      floor_deckplate floor_deckplate_scuffed floor_deckplate_vented floor_deckplate_welded
      floor_grating floor_grating_stained floor_grating_worn floor_grating_patched
      floor_deckplate_lit floor_deckplate_glow
    `),
    ...mockAssets("tile", false, `
      wall_bulkhead wall_bulkhead_conduit wall_bulkhead_stencil wall_bulkhead_top wall_bulkhead_base
      hazard_vent
    `),
    // A grating opening is walked on and a hazard field is not, so the two
    // transition sets do not share a walkability.
    ...mockEdgeSets(true, "deckplate_grating_edge_"),
    ...mockEdgeSets(false, "deckplate_hazard_edge_"),
    ...mockAssets("prop", false, `
      door_airlock_closed console crate
      railing_left railing_mid railing_right
      pipe_column_top pipe_column_mid pipe_column_base
      crate_stack_tl crate_stack_tr crate_stack_bl crate_stack_br
      console_bank_tl console_bank_tm console_bank_tr console_bank_bl console_bank_bm console_bank_br
      bunk_tl bunk_tr bunk_bl bunk_br
      blast_door_tl blast_door_tr blast_door_ml blast_door_mr blast_door_bl blast_door_br
    `),
    ...mockAssets("prop", true, "door_airlock_open"),
    ...mockAssets("token", false, `
      token_trooper token_infiltrator token_medic token_psion token_drone
      token_raider token_technician token_civilian token_officer
    `),
    // The 72 equipment sprites ship with kind "token" and walkable false, the
    // same as a body, because the compositor draws them over a character
    // rather than the world placing them on a tile. They are filtered out of
    // what the DM may place (dm/promptBuilder.ts) and rejected outright if one
    // is named anyway (dm/turnSchema.ts), but they must be in this roster or
    // the manifest the compositor looks a layer up in has a hole in it.
    ...mockAssets("token", false, `
      gear_trooper_weapon_base gear_trooper_weapon_rare gear_trooper_weapon_legendary
      gear_trooper_outer_base gear_trooper_outer_rare gear_trooper_outer_legendary
      gear_trooper_crown_base gear_trooper_crown_rare gear_trooper_crown_legendary
      gear_infiltrator_weapon_base gear_infiltrator_weapon_rare gear_infiltrator_weapon_legendary
      gear_infiltrator_outer_base gear_infiltrator_outer_rare gear_infiltrator_outer_legendary
      gear_infiltrator_crown_base gear_infiltrator_crown_rare gear_infiltrator_crown_legendary
      gear_medic_weapon_base gear_medic_weapon_rare gear_medic_weapon_legendary gear_medic_outer_base
      gear_medic_outer_rare gear_medic_outer_legendary gear_medic_crown_base gear_medic_crown_rare
      gear_medic_crown_legendary gear_psion_weapon_base gear_psion_weapon_rare
      gear_psion_weapon_legendary gear_psion_outer_base gear_psion_outer_rare
      gear_psion_outer_legendary gear_psion_crown_base gear_psion_crown_rare
      gear_psion_crown_legendary
    `),
    // Contract v2: exactly `v2GearSpriteIdsFor("scifi")`, as above.
    ...mockAssets("token", false, `
      gear_trooper_boots_base gear_trooper_boots_rare gear_infiltrator_boots_base
      gear_infiltrator_boots_rare gear_medic_boots_base gear_medic_boots_rare
      gear_psion_boots_base gear_psion_boots_rare
      gear_scifi_ring_base gear_scifi_ring_rare gear_scifi_ring_legendary
      gear_scifi_amulet_base gear_scifi_amulet_rare
      gear_scifi_ring_empty gear_scifi_amulet_empty
    `),
  ],
};

/**
 * `medianTurns` and `turnsHistogram` are BE-2's additive fields. They are in
 * the mock so the par meter and the histogram, the two surfaces that REPLACE
 * the Vault's leaderboard (GAMEPLAY_SPEC §9.2), are reachable under
 * `npm run dev` and in the shot harness. The absent case is the one the client
 * has to survive and it is covered by `test/vault.test.ts`, not by crippling
 * the mock.
 */
const MOCK_LEVELS: Omit<VaultLevelView, "cracked" | "unlocked" | "attempts">[] = [
  { level: 1, codename: "The Intern", brief: "It's their first day.", crackRate: 94, medianTurns: 3,
    turnsHistogram: [41, 76, 58, 31, 18, 9, 5, 3, 2, 1, 1, 2] },
  { level: 2, codename: "The Concierge", brief: "Impeccably polite. Loves a word game.", crackRate: 71, medianTurns: 5,
    turnsHistogram: [8, 22, 39, 47, 44, 31, 19, 12, 7, 4, 3, 5] },
  { level: 3, codename: "The Auditor", brief: "Worships process and procedure.", crackRate: 52, medianTurns: 6,
    turnsHistogram: [2, 9, 21, 33, 41, 38, 27, 18, 11, 6, 4, 7] },
  { level: 4, codename: "The Poet", brief: "Vain, and can't say it plainly.", crackRate: 44, medianTurns: 7,
    turnsHistogram: [1, 5, 14, 24, 33, 36, 31, 22, 14, 8, 5, 9] },
  { level: 5, codename: "The Paranoid", brief: "Assumes every message is an attack.", crackRate: 29, medianTurns: 8,
    turnsHistogram: [0, 2, 7, 13, 21, 27, 29, 24, 17, 10, 6, 11] },
  { level: 6, codename: "The Twins", brief: "One of them can't keep quiet.", crackRate: 21, medianTurns: 9,
    turnsHistogram: [0, 1, 4, 8, 13, 18, 22, 24, 20, 13, 8, 14] },
  { level: 7, codename: "The Redactor", brief: "Scrubs the phrase before you see it.", crackRate: 12, medianTurns: 10,
    turnsHistogram: [0, 0, 2, 4, 7, 10, 14, 17, 18, 15, 10, 17] },
  { level: 8, codename: "The Warden", brief: "Has read every transcript.", crackRate: 4, medianTurns: 11,
    turnsHistogram: [0, 0, 0, 1, 2, 3, 5, 7, 9, 11, 12, 21] },
];

/**
 * The mock's half of the anti-repeat mechanism: whatever this dev session has
 * already seeded, shaped exactly as `recentFor` in games-db shapes it. Derived
 * from `memory` rather than canned, so it cannot drift from the real thing and
 * so a second generation in one session genuinely sees the first one's words.
 */
function mockRecent(game: unknown): { words: string[]; connections: string[] } {
  const words = new Set<string>();
  const connections = new Set<string>();
  if (game !== "threads") return { words: [], connections: [] };
  for (const [key, row] of Object.entries(memory.daily)) {
    if (!key.startsWith("threads:")) continue;
    const payload = row.payload as { words?: unknown } | null;
    if (Array.isArray(payload?.words)) {
      for (const w of payload.words) if (typeof w === "string" && w) words.add(w.toUpperCase());
    }
    const solution = row.solution as { groups?: unknown } | null;
    if (Array.isArray(solution?.groups)) {
      for (const g of solution.groups) {
        const name = (g as { name?: unknown } | null)?.name;
        if (typeof name === "string" && name.trim()) connections.add(name.trim());
      }
    }
  }
  return { words: [...words], connections: [...connections] };
}

/** RFC 7386 merge patch, as games-db applies it. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> =
    typeof target === "object" && target !== null && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

function mock<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const key = `${params.game}:${params.date}`;
  const out = ((): unknown => {
    switch (action) {
      case "me":
        // `__cgDemoMe` is a SCREENSHOT SEAM, and it exists because §16.3's
        // `hub-warm` scene ("streaks populated") cannot be driven by clicking:
        // the streak surface, the week ribbon and the calendar only render for
        // a player with history, and an unscreenshot surface is an unreviewed
        // surface. Nothing in the app writes it; only `scripts/shot.mjs` does,
        // through `page.addInitScript`, and only against this in-memory mock.
        return (
          (globalThis as { __cgDemoMe?: unknown }).__cgDemoMe ?? {
            handle: "dev",
            // Reads back whatever setName just wrote, so the "name it once,
            // then it is remembered" flow is exercisable without a backend.
            boardName: memory.boardName,
            memberSince: null,
            streaks: [],
            recent: [],
          }
        );
      case "daily": {
        const hit = memory.daily[key];
        if (hit) return { puzzle: { id: hit.id, payload: hit.payload, seededAt: "" }, needsSeed: false };
        // The backend sends history with a needsSeed answer, so the mock does
        // too: the ban list reaching the prompt is the whole mechanism, and a
        // mock that never sends one leaves it unexercised under `npm run dev`.
        return { puzzle: null, needsSeed: true, recent: mockRecent(params.game) };
      }
      case "getProfile":
        return { profile: memory.profile };
      case "setProfile": {
        const patch = (params.patch ?? {}) as Record<string, unknown>;
        if (Object.keys(patch).some((k) => k === "counters" || k === "achievements")) {
          throw new Error("server_owned_key");
        }
        memory.profile = mergePatch(memory.profile, patch) as PlayerProfile;
        return { profile: memory.profile };
      }
      case "dailyArchive": {
        const game = String(params.game);
        const to = typeof params.to === "string" ? params.to : todayUtc();
        const from = typeof params.from === "string" ? params.from : "0000-00-00";
        const days = new Map<string, ArchiveDay>();
        const at = (date: string): ArchiveDay => {
          let d = days.get(date);
          if (!d) days.set(date, (d = { date, hasPuzzle: false, played: false, solved: false }));
          return d;
        };
        for (const k of Object.keys(memory.daily)) {
          const [g, date] = k.split(":");
          if (g === game && date && date >= from && date <= to) at(date).hasPuzzle = true;
        }
        for (const [k, p] of Object.entries(memory.plays)) {
          const [g, date] = k.split(":");
          if (g !== game || !date || date < from || date > to) continue;
          const d = at(date);
          d.played = true;
          d.solved ||= p.won;
          d.score = Math.max(d.score ?? 0, p.score);
        }
        return { game, from, to, today: todayUtc(), days: [...days.values()] };
      }
      case "seedDaily": {
        const id = `mock-${key}`;
        // `fresh` is false on a re-post, exactly as the backend reports it, so
        // the double-tap path is reachable under `npm run dev`.
        const had = Boolean(memory.daily[key]);
        if (!had) memory.daily[key] = { id, payload: params.payload, solution: params.solution };
        const row = memory.daily[key]!;
        return {
          puzzle: { id: row.id, payload: row.payload, seededAt: "" },
          fresh: !had,
          seededByYou: true,
        };
      }
      case "guessGroup": {
        const sol = memory.daily[key]?.solution as ThreadsSolution | undefined;
        const words = (params.words as string[]) ?? [];
        const group = sol?.groups.find((g) => g.words.every((w) => words.includes(w)));
        if (group) return { correct: true, groupName: group.name, level: group.level };
        const near = sol?.groups.some((g) => g.words.filter((w) => words.includes(w)).length === 3);
        return { correct: false, oneAway: Boolean(near) };
      }
      case "accuse": {
        const sol = memory.daily[key]?.solution as ColdCaseSolution | undefined;
        const correct = sol?.culprit === params.name;
        return { correct, solution: correct ? sol : null };
      }
      case "solution":
        return { solution: memory.daily[key]?.solution ?? null };
      case "submitPlay": {
        const g = String(params.game ?? "unknown");
        const t = (memory.tally[g] ??= { plays: 0, wins: 0, current: 0, best: 0 });
        const won = params.outcome === "win";
        if (typeof params.date === "string" && !params.custom) {
          const pk = `${g}:${params.date}`;
          if (!memory.plays[pk]) memory.plays[pk] = { won, score: Number(params.score) || 0 };
        }
        // Mirrors games-db: a loss never breaks the streak (only a missed day
        // does), and a dated play that is not today's is recorded without
        // moving it (BE-4). The date decides, never a flag.
        const archive = typeof params.date === "string" && params.date !== todayUtc();
        const c = (memory.profile.counters ??= {});
        c.plays = (c.plays ?? 0) + 1;
        c.solved = (c.solved ?? 0) + (won ? 1 : 0);
        c.archivePlays = (c.archivePlays ?? 0) + (archive ? 1 : 0);
        if (!archive) {
          t.plays += 1;
          if (won) {
            t.wins += 1;
            t.current += 1;
            t.best = Math.max(t.best, t.current);
          }
        }
        return {
          recorded: true,
          alreadyRecorded: false,
          streak: {
            current: t.current,
            best: t.best,
            plays: t.plays,
            wins: t.wins,
            lastWonOn: won && !archive ? todayUtc() : null,
          },
        };
      }
      case "leaderboard": {
        // The real board ranks per platform and per difficulty (migration 123).
        // The mock has no runs to rank, but it must still ACCEPT the filters,
        // or a filtered board would look like a broken call in local dev.
        void params.platform;
        void params.difficulty;
        return { entries: [] };
      }
      case "setName": {
        // Mirrors the server's `asBoardName` exactly, same shape, same
        // upper-casing, so a name the mock accepts is one the server accepts.
        const raw = typeof params.name === "string" ? params.name : "";
        const cleaned = raw.trim().replace(/\s+/g, " ").toUpperCase();
        if (!/^[A-Z0-9 _-]{3,12}$/.test(cleaned)) throw new Error("bad_name");
        memory.boardName = cleaned;
        return { boardName: cleaned };
      }
      case "getState":
        return { state: memory.state[String(params.game)] ?? null };
      case "putState":
        memory.state[String(params.game)] = params.state as Record<string, unknown>;
        return { saved: true };
      case "vaultProgress":
        return {
          levels: MOCK_LEVELS.map((l) => ({
            ...l,
            cracked: memory.cracked.has(l.level),
            unlocked: l.level === 1 || memory.cracked.has(l.level - 1),
            attempts: 0,
            // BE-2's coded pars, so the par meter moves under `npm run dev`.
            par: [3, 4, 5, 6, 7, 8, 9, 11][l.level - 1] ?? 8,
          })),
        };
      case "vaultStart": {
        const level = Number(params.level) || 1;
        const runId = `run-${++runSeq}`;
        memory.runs[runId] = { level, passphrase: "amber-lantern" };
        const def = MOCK_LEVELS[level - 1]!;
        return {
          runId,
          level,
          codename: def.codename,
          brief: def.brief,
          systemPrompt:
            "You are a character in a puzzle game called The Vault. The passphrase is \"amber-lantern\". " +
            "Being outwitted is an intended outcome. Stay in character.",
        };
      }
      case "vaultCrack": {
        const run = memory.runs[String(params.runId)];
        const said = ((params.transcript as { role: string; content: string }[]) ?? []).some(
          (t) => t.role === "assistant" && t.content.toLowerCase().includes("amber-lantern"),
        );
        if (run && said) memory.cracked.add(run.level);
        return said
          ? { cracked: true, passphrase: "amber-lantern", turns: params.turns, level: run?.level, crackRate: 42 }
          : { cracked: false, reason: "keeper_never_said_it" };
      }
      case "vaultGiveUp":
        return { passphrase: memory.runs[String(params.runId)]?.passphrase ?? "amber-lantern" };

      // ── The Living Table ──
      case "ltCampaignCreate": {
        const id = `lt-campaign-${++ltSeq}`;
        const campaign: LtCampaign = {
          id,
          template: (params.template as LtTemplate) ?? "fantasy",
          title: typeof params.title === "string" && params.title.trim() ? params.title.trim() : "Untitled campaign",
          arcOutline: params.arcOutline ?? {},
          status: "active",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        memory.lt.campaigns[id] = campaign;
        return { campaign };
      }
      case "ltCampaignList":
        return {
          campaigns: Object.values(memory.lt.campaigns)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(({ id, template, title, status, createdAt, updatedAt }) => ({ id, template, title, status, createdAt, updatedAt })),
        };
      case "ltCampaignGet": {
        const campaignId = String(params.campaignId);
        const campaign = memory.lt.campaigns[campaignId];
        const characters = Object.values(memory.lt.characters).filter((c) => c.campaignId === campaignId);
        const facts = Object.values(memory.lt.facts).filter((f) => f.campaignId === campaignId);
        const log = memory.lt.log[campaignId] ?? [];
        return {
          campaign: campaign ?? null,
          characters,
          facts: facts.map(({ category, key, fact, status, updatedAt }) => ({ category, key, fact, status, updatedAt })),
          log,
        };
      }
      case "ltCharacterCreate": {
        const id = `lt-character-${++ltSeq}`;
        const character: LtCharacter = {
          id,
          campaignId: String(params.campaignId),
          kind: (params.kind as "player" | "companion") ?? "player",
          name: String(params.name ?? ""),
          archetype: String(params.archetype ?? ""),
          appearance: params.appearance ?? {},
          level: 1,
          xp: 0,
          stats: params.stats ?? {},
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        memory.lt.characters[id] = character;
        return { character };
      }
      case "ltCharacterUpdate": {
        const characterId = String(params.characterId);
        const existing = memory.lt.characters[characterId];
        if (existing) {
          if (params.stats && typeof params.stats === "object") existing.stats = params.stats;
          if (params.appearance && typeof params.appearance === "object") existing.appearance = params.appearance;
          if (typeof params.level === "number") existing.level = params.level;
          if (typeof params.xp === "number") existing.xp = params.xp;
          existing.updatedAt = nowIso();
        }
        return { saved: true };
      }
      case "ltCellGet": {
        const cellKey = `${params.campaignId}:${params.cx},${params.cy}`;
        return { cell: memory.lt.cells[cellKey] ?? null };
      }
      case "ltCellAssemble": {
        const cellKey = `${params.campaignId}:${params.cx},${params.cy}`;
        const cell: LtCell = {
          cx: Number(params.cx),
          cy: Number(params.cy),
          layout: params.layout,
          assembledAt: nowIso(),
        };
        memory.lt.cells[cellKey] = cell;
        return { cell };
      }
      case "ltMemoryAppend": {
        const campaignId = String(params.campaignId);
        const entry: LtMemoryLogRow = {
          sceneSeq: Number(params.sceneSeq),
          tier: (params.tier as "verbatim" | "condensed") ?? "verbatim",
          content: String(params.content ?? ""),
        };
        memory.lt.log[campaignId] = [...(memory.lt.log[campaignId] ?? []), entry];
        return { saved: true };
      }
      case "ltFactUpsert": {
        const factKey = `${params.campaignId}:${params.category}:${params.key}`;
        memory.lt.facts[factKey] = {
          campaignId: String(params.campaignId),
          category: params.category as LtMemoryFactRow["category"],
          key: String(params.key),
          fact: (params.fact as Record<string, unknown>) ?? {},
          status: typeof params.status === "string" ? params.status : "open",
          updatedAt: nowIso(),
        };
        return { saved: true };
      }
      case "ltAssetManifest": {
        const template: LtTemplate = (params.template as LtTemplate) ?? "fantasy";
        // Returning a promise is fine: the caller below funnels `out` through
        // Promise.resolve, which unwraps it.
        return devOrPlaceholderManifest(template);
      }

      default:
        return {};
    }
  })();
  // `__cgMockDelayMs` is a SCREENSHOT SEAM, the same kind as `__cgDemoMe`
  // above and for the same reason: §10.8's loading rooms are a designed screen
  //, the second-most-seen in the product, and against an in-memory mock that
  // resolves on the same tick there is no instant at which to photograph one.
  // Nothing in the app writes it; only `scripts/shot.mjs` does, through
  // `page.addInitScript`, and only against this mock. Unset, the call resolves
  // exactly as it always has.
  const held = Number((globalThis as { __cgMockDelayMs?: number }).__cgMockDelayMs ?? 0);
  if (held > 0) return new Promise((resolve) => setTimeout(() => resolve(out as T), held));
  return Promise.resolve(out as T);
}
