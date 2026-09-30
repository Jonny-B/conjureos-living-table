/**
 * The Living Table's two touch points with other ConjureOS apps.
 *
 * 1. REGISTRATION WITH CONJURE GAMES. The hub finds registered games with
 *    window.__conjureos.actions.list(), which reads every installed app's
 *    declared actions from its manifest (no permission, no consent dialog, and
 *    it works while this app is closed), and keeps each app that declares
 *    `conjureGamesEntry` (package.json, "conjureos.actions"). It then opens the
 *    game with window.__conjureos.openApp(appPath) in its own window. The hub
 *    never needs to invoke the action just to list the game; the handler here
 *    answers a later, deliberate invoke with the same facts. The contract is
 *    informal for now (protocol 1); the fields a game must supply to be
 *    compliant are not decided yet.
 *
 * 2. LEAVING. "Back to the games" opens Conjure Games in its own window when it
 *    is installed. Install paths are not fixed (a collision lands an app at
 *    /apps/games-2), so the hub is found by `playDaily`, the action only the hub
 *    declares, never by a hard-coded path.
 */

/** What this game tells Conjure Games about itself. Mirrors the action's declared `returns` in package.json. */
export const HUB_ENTRY = Object.freeze({
  protocol: 1,
  title: "The Living Table",
  hook: "An AI dungeon master runs your campaign. The dice are real.",
});

interface ListedApp {
  appPath: string;
  displayName: string;
  actions: Array<{ name: string }>;
}

interface Bridge {
  actions?: {
    register?: (handlers: Record<string, (params?: unknown) => Promise<unknown>>) => Promise<void>;
    list?: () => Promise<ListedApp[]>;
  };
  openApp?: (appPath: string) => Promise<{ ok: boolean; reason?: string }>;
}

const cjs = (): Bridge => (globalThis as { __conjureos?: Bridge }).__conjureos ?? {};

/** Register this app's action handlers with the kernel. A no-op outside ConjureOS. */
export async function registerActions(): Promise<void> {
  const register = cjs().actions?.register;
  if (typeof register !== "function") return;
  await register({
    conjureGamesEntry: async () => ({ ...HUB_ENTRY }),
  });
}

/** The installed Conjure Games hub's app path, or null when it is not installed or the bridge is absent. */
export async function findHub(): Promise<string | null> {
  const list = cjs().actions?.list;
  if (typeof list !== "function") return null;
  try {
    const apps = await list();
    return apps.find((app) => app.actions.some((a) => a.name === "playDaily"))?.appPath ?? null;
  } catch {
    return null;
  }
}

/** Open Conjure Games in its own window. Resolves false when there is no hub to open. */
export async function openHub(): Promise<boolean> {
  const openApp = cjs().openApp;
  if (typeof openApp !== "function") return false;
  const hub = await findHub();
  if (!hub) return false;
  try {
    return (await openApp(hub)).ok;
  } catch {
    return false;
  }
}
