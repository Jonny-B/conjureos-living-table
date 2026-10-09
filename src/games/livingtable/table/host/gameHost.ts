/**
 * The shipped game's TableHost: the one place the table window's parts are put together.
 *
 *   art        gameArt.ts       games-db manifest, else the bundled hand-drawn art; the animated cast
 *                               arrives from ConjureOS asset files after the first paint
 *   dm         gameDm.ts        the ai.complete bridge, one call at a time, no price text
 *   storage    gameStorage.ts   saves on the device, mirrored to the server (games-db ltSave*)
 *   files      gameFiles.ts     the adventure export, as a download
 *   settings   gameSettings.ts  text style, text speed, dice, zoom: kept on the device
 *   adventures the owner's written adventures (adventures/data.ts, generated from adventures/*.md)
 *   heroes     the playable classes; a fresh hero each time (progress lives in the saves)
 *
 *   const game = createGameHost();
 *   const session = await game.open();       // art settled, saves pulled; the main menu offers Continue on the newest save
 *   const win = mountTable(el, game.host, { session });
 *   ...
 *   win.dispose(); game.dispose();
 *
 * `open()` is the only async step and it never waits long: the art falls back to the bundled copy, the saves to
 * the device, and the identity check gives up after a second and a half. It rejects only when the art could not
 * be had at all (no games-db manifest and no bundled copy), and the screen says so.
 *
 * Import-pure: nothing runs until `createGameHost` is called.
 */
import { ADVENTURE_FILES } from "../adventures/data";
import { PLAYABLE_ARCHETYPE_IDS } from "../../characters/templates";
import { ARCHETYPE_IDS, TEMPLATE_OF_ARCHETYPE } from "../../characters/equipmentTypes";
import { createTableSession, type TableSession } from "../mountTable";
import { bindAdventures } from "../adventureCatalog";
import { bindCatalog, catalogBound } from "../catalog";
import { createSaveBook, fromSnapshot } from "../snapshot";
import type { AdventureFile, ArchetypeId, TableHost } from "../host";
import { ENGINE_ASSET_IDS, adventureAssetIds, createGameArt, mergeAssetIds, type GameArt, type GameArtOptions } from "./gameArt";
import { createGameDm, type GameDm, type GameDmOptions } from "./gameDm";
import { createGameFiles, type FilesEnv } from "./gameFiles";
import { createGameSettings, type GameSettingsOptions } from "./gameSettings";
import { createGameStorage, hashText, type GameStorage, type GameStorageOptions } from "./gameStorage";
import { APP_VERSION } from "../../../../version";
import { BUILD_TARGET } from "../../../../buildTarget";

export interface GameHostOptions {
  art?: GameArtOptions;
  dm?: GameDmOptions;
  storage?: GameStorageOptions;
  settings?: GameSettingsOptions;
  files?: Partial<FilesEnv>;
  /** The adventures to offer. Default: the generated module (every adventures/*.md). */
  adventures?: readonly AdventureFile[];
  /**
   * Who is signed in, as ConjureOS's `auth.whoami()` answers it. Default: the bridge's, when there is one. It only decides whether
   * this device's saves belong to this player (see GameStorageOptions.account); nothing about it is sent anywhere.
   */
  whoami?: () => Promise<{ signedIn?: boolean; email?: string } | null | undefined>;
  /** How long to wait for one `whoami` answer before going on without it. Default 1500. */
  whoamiTimeoutMs?: number;
  /** How many times to ask `whoami` while opening, when there is a server and no answer yet. Default 3 (one try and two retries). */
  whoamiAttempts?: number;
  /** The pause between those tries. Default 300. */
  whoamiRetryMs?: number;
  /** While the owner is still unknown after opening, how often to ask again in the background (up to 3 more times). Default 8000; 0 turns it off. */
  whoamiLateMs?: number;
  /** Whether `open()` offers Continue on the player's newest save. Default true; the screen passes false for "Try again" after a failed mount. */
  resume?: boolean;
  reducedMotion?: boolean;
  rng?: () => number;
}

export interface GameHost {
  /** What `mountTable` takes. */
  host: TableHost;
  art: GameArt;
  dm: GameDm;
  storage: GameStorage;
  /**
   * Settle everything the window needs before it mounts, and hand back the session to mount it with: the saves are in the
   * book, and the session starts at the main menu. When the player has a save the session names it (`continueId`) and the menu's
   * Continue goes back to it; the game is not put into a save behind the player's back. Runs once; later calls give the same session.
   */
  open(): Promise<TableSession>;
  /**
   * The window could not be mounted on the session `open()` gave. The save it offered Continue on is remembered (for this page
   * session, across hosts) and not offered again, so the next open has Continue off. The saves are kept, and Load still has them.
   */
  noteMountFailed(): void;
  /**
   * Whether the account is known. With a save server and no answer from `whoami` it is not: the host does not put the player in any
   * save, does not pull or push until it is, and the storage is told so (`storage.waitingForOwner()`).
   */
  ownerKnown(): boolean;
  /** Called when the owner becomes known after `open()` (a late `whoami`). Returns the unsubscribe. */
  onOwner(cb: () => void): () => void;
  /** Let go of the subscriptions and timers. Safe to call twice. */
  dispose(): void;
}

/** The classes a player can start as: the fantasy ones the game has turned on, in library order. */
/**
 * The ids of the saves a window failed to mount, for this page session. A fresh host (the screen's Try again) must not resume one of
 * them, so this outlives any one host.
 */
const failedResumes = new Set<string>();

/** Test hook: forget which saves failed to mount. */
export function resetFailedResumes(): void {
  failedResumes.clear();
}

export function playableHeroes(): ArchetypeId[] {
  return ARCHETYPE_IDS.filter((id) => TEMPLATE_OF_ARCHETYPE[id] === "fantasy" && PLAYABLE_ARCHETYPE_IDS.includes(id));
}

/** The page names that mean "served from this machine": local development and the e2e harness. */
const LOCAL_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1"];

/**
 * Whether the two test rooms show on the start screen. A dev build shows them; a prod build never does, unless the page is served
 * from this machine (local development and the e2e harness keep them). Pure.
 */
export function testRoomsVisible(target: "prod" | "dev", hostname: string): boolean {
  return target === "dev" || LOCAL_HOSTNAMES.includes(hostname);
}

/** The page's hostname, or "" when there is no page (Node). */
function pageHostname(): string {
  try {
    return typeof location === "object" && location && typeof location.hostname === "string" ? location.hostname : "";
  } catch {
    return "";
  }
}

/** The bridge's `whoami`, or null when there is none (outside ConjureOS). */
async function bridgeWhoami(): Promise<{ signedIn?: boolean; email?: string } | null> {
  try {
    const auth = (globalThis as { __conjureos?: { auth?: { whoami?: () => Promise<{ signedIn?: boolean; email?: string }> } } }).__conjureos?.auth;
    return typeof auth?.whoami === "function" ? await auth.whoami() : null;
  } catch {
    return null;
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });

const prefersReducedMotion = (): boolean => {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export function createGameHost(options: GameHostOptions = {}): GameHost {
  const adventures = options.adventures ?? ADVENTURE_FILES;
  // The art has to cover the engine's own pieces and every id an adventure names; one that falls short is replaced whole by the bundled library.
  const art = createGameArt({
    required: (t) => mergeAssetIds(ENGINE_ASSET_IDS[t], adventureAssetIds(adventures)),
    ...options.art,
  });
  // Outside ConjureOS there is no model to ask, so the window says so instead of a stand-in answering in the DM's name.
  const dm = createGameDm({ requireBridge: true, ...options.dm });
  let account: string | null = null;
  const storage = createGameStorage({ account: () => account, ...options.storage });
  const settings = createGameSettings(options.settings);
  const files = createGameFiles(options.files);
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();

  const host: TableHost = {
    art,
    dm: dm.dm,
    storage,
    files,
    adventures: { files: () => adventures },
    heroes: {
      playable: playableHeroes,
      initial: () => null,
    },
    settings,
    env: {
      rng: options.rng ?? (() => Math.random()),
      reducedMotion,
      address: () => "",
      sandboxRooms: false,
      testRooms: testRoomsVisible(BUILD_TARGET, pageHostname()),
      mainMenu: true,
      debugExport: false,
      build: { app: `The Living Table ${APP_VERSION}` },
    },
  };

  /**
   * Run `fn` with the picture catalog and the adventure list bound to this host. Reading a save asks them which ids exist and which
   * adventure a save names (snapshot.ts isSnapshot), and the window binds them only when it mounts; without them every stored save
   * reads as unreadable and the book comes up empty. A binding that is already there (the window's) is left alone.
   */
  function withCatalog<T>(fn: () => T): T {
    const offs = catalogBound() ? [] : [bindCatalog(art), bindAdventures(host)];
    try {
      return fn();
    } finally {
      for (const off of offs) off();
    }
  }

  const accountOf = (who: { signedIn?: boolean; email?: string } | null | undefined): string | null =>
    who?.signedIn !== false && typeof who?.email === "string" && who.email ? `u${hashText(who.email.toLowerCase())}` : null;
  const askWho = (): Promise<{ signedIn?: boolean; email?: string } | null | undefined> => withTimeout((options.whoami ?? bridgeWhoami)(), options.whoamiTimeoutMs ?? 1500, null);

  let opened: Promise<TableSession> | null = null;
  let unsubscribeChange: (() => void) | null = null;
  let disposed = false;
  let ownerUnknown = false;
  let resumedId: string | null = null;
  let lateTimer: ReturnType<typeof setTimeout> | null = null;
  const ownerListeners = new Set<() => void>();

  async function open(): Promise<TableSession> {
    // Who is playing, so one browser never uploads another player's saves into this account. A hash, so no address is kept.
    // With a server to talk to, an answer that does not name someone is asked for again (a slow bridge, a dropped call).
    const attempts = Math.max(1, options.whoamiAttempts ?? 3);
    for (let i = 0; i < attempts && !disposed; i++) {
      if (i > 0) await new Promise<void>((r) => setTimeout(r, options.whoamiRetryMs ?? 300));
      account = accountOf(await askWho());
      if (!storage.waitingForOwner()) break; // no server to protect the saves from, or the owner is known
    }
    // Still nobody: the cache on this device may be another player's. The storage keeps everything on this device (no pull, no push,
    // and it says so in its status), and no save of it is resumed until the account is known.
    ownerUnknown = storage.waitingForOwner();

    await Promise.all([art.load(), storage.ready()]);
    // The player lands on the main menu with Continue on their newest save, unless the owner is unknown, or the save is one the window
    // already failed to mount, or the screen asked for a plain start. The game is never put into a save for them.
    const made = withCatalog(() => {
      const book = createTableSession(host);
      book.continueId = continueFor(book);
      resumedId = book.continueId;
      return book;
    });
    // A save that arrives late (another device, after the wait gave up) joins the book the window keeps.
    unsubscribeChange = storage.onChange(() => {
      if (disposed) return;
      made.saves = withCatalog(() => createSaveBook(storage.saves));
      made.continueId = withCatalog(() => continueFor(made));
    });
    if (ownerUnknown) askLater(made, 0);
    return made;
  }

  /** The save the main menu's Continue goes to: the newest, when the owner is known, it reads, it is a class the game plays, and the window never failed on it. Else null. */
  function continueFor(book: TableSession): string | null {
    const newest = book.saves.list()[0];
    if (!newest || ownerUnknown || options.resume === false || failedResumes.has(newest.id)) return null;
    const play = fromSnapshot(newest.data);
    return play && playableHeroes().includes(play.archetypeId) ? newest.id : null;
  }

  /** The owner is still unknown after opening: ask again now and then. When it answers, the sync starts and the book is read again. */
  function askLater(made: TableSession, n: number): void {
    const every = options.whoamiLateMs ?? 8000;
    if (every <= 0 || n >= 3 || disposed) return;
    lateTimer = setTimeout(() => {
      lateTimer = null;
      void askWho().then(async (who) => {
        if (disposed) return;
        const found = accountOf(who);
        if (found === null) return askLater(made, n + 1);
        account = found;
        ownerUnknown = false;
        await storage.ownerKnown();
        if (disposed) return;
        made.saves = withCatalog(() => createSaveBook(storage.saves));
        made.continueId = withCatalog(() => continueFor(made));
        for (const cb of [...ownerListeners]) cb();
      });
    }, every);
  }

  return {
    host,
    art,
    dm,
    storage,
    open: () => (opened ??= open()),
    noteMountFailed() {
      if (resumedId !== null) failedResumes.add(resumedId);
    },
    ownerKnown: () => !ownerUnknown,
    onOwner(cb) {
      ownerListeners.add(cb);
      return () => void ownerListeners.delete(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (lateTimer !== null) clearTimeout(lateTimer);
      lateTimer = null;
      ownerListeners.clear();
      unsubscribeChange?.();
      unsubscribeChange = null;
      dm.dispose();
      storage.dispose();
      art.dispose();
    },
  };
}
