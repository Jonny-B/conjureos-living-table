/**
 * The Living Table, as the whole app.
 *
 * One screen: the table window (table/mountTable.ts) filling the page, with a slim bar above it (the title, the
 * Menu button, Fullscreen) and a line below (where the saves are, the version). While the table is being set a splash
 * screen (Splash.tsx) covers the page. The window itself holds everything else: the main menu (Continue, New game, Load,
 * Settings, Licence and credits), the start screen with the adventures, the hero choice, the board, the dice, the DM and
 * the game menu.
 *
 * The game stands alone: nothing here leads to another app. The window is built once per visit, from the game's own
 * host (table/host/gameHost.ts), and torn down with the screen.
 *
 * React owns the bar and the line; the window owns the element it is mounted into (its children are drawn by the
 * window, never by React), so that element has no React children.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../../version";
import { Splash, SPLASH_FADE_MS, splashRemainingMs } from "./Splash";
import { mountTable, type TableWindow } from "./table/mountTable";
import { createGameHost, type GameHost } from "./table/host/gameHost";
import { statusText, type StorageStatus } from "./table/host/gameStorage";

/** The splash: shown while loading, fading once the window is up (it stays at least a moment so it does not flash), then gone. */
type SplashState = "show" | "leave" | "gone";

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };

/** What the player reads when the window could not be stood up on their last save. Plain: no error text. */
const MOUNT_FAILED = "Your last game could not be opened. Your saves are kept. Try again to start from the adventure list.";

/** Whether the page may go full screen (the app declares display.fullscreen; a frame that does not allow it says false). */
const canFullscreen = (): boolean => typeof document !== "undefined" && document.fullscreenEnabled !== false && typeof document.documentElement.requestFullscreen === "function";

export function TableScreen() {
  const frame = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const win = useRef<TableWindow | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Try again after a failure opens on the start screen: the save that just failed is not resumed, and nothing is deleted.
  const noResume = useRef(false);
  const [saveLine, setSaveLine] = useState("");
  const [splash, setSplash] = useState<SplashState>("show");
  const [full, setFull] = useState(false);
  const [fullNote, setFullNote] = useState("");

  useEffect(() => {
    let alive = true;
    let game: GameHost | null = null;
    let offStatus: (() => void) | null = null;
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    let goneTimer: ReturnType<typeof setTimeout> | null = null;
    const shownAt = performance.now();
    setPhase({ kind: "loading" });
    setSplash("show");
    // Started a tick later, not at once: React's development double run (mount, unmount, mount) would otherwise leave two hosts
    // pulling the same saves into the same device storage at the same time. The first run is cancelled before it starts.
    const timer = setTimeout(() => {
      const made = createGameHost({ resume: !noResume.current });
      game = made;
      const line = (s: StorageStatus): void => {
        if (alive) setSaveLine(statusText(s)); // while the account is not known the storage's own message says saves are on this device only
      };
      offStatus = made.storage.onStatus(line);
      made.open().then(
        (session) => {
          const el = stage.current;
          if (!alive || !el) return;
          // A save the window cannot stand up must not strand the screen on "loading", nor be resumed again: say so, and let Try again
          // open on the start screen with every save kept.
          try {
            win.current = mountTable(el, made.host, { session });
          } catch {
            made.noteMountFailed();
            win.current?.dispose();
            win.current = null;
            el.replaceChildren();
            noResume.current = true;
            setSplash("gone");
            setPhase({ kind: "failed", message: MOUNT_FAILED });
            return;
          }
          line(made.storage.status());
          setPhase({ kind: "ready" });
          // The splash stays for its minimum, then fades away.
          leaveTimer = setTimeout(() => {
            if (!alive) return;
            setSplash("leave");
            goneTimer = setTimeout(() => alive && setSplash("gone"), SPLASH_FADE_MS + 40);
          }, splashRemainingMs(shownAt, performance.now()));
        },
        (e: unknown) => {
          if (!alive) return;
          setSplash("gone");
          setPhase({ kind: "failed", message: e instanceof Error && e.message ? e.message : "The table could not be set." });
        },
      );
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
      if (leaveTimer !== null) clearTimeout(leaveTimer);
      if (goneTimer !== null) clearTimeout(goneTimer);
      offStatus?.();
      win.current?.dispose();
      win.current = null;
      game?.dispose();
    };
  }, [attempt]);

  useEffect(() => {
    const sync = (): void => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // The scroll cue: data-more on the stage while it scrolls, "down" while there is more under the fold (a fade is drawn from it, app.css). Set from the scroll position and
  // from the sizes of the stage and what is in it, so it follows a menu opening, the DM's box coming and a turn of the phone.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const sync = (): void => {
      // Present while the stage scrolls at all: "down" while there is more under the fold (the fade shows), "end" once it is all in view.
      const scrolls = el.scrollHeight > el.clientHeight + 4;
      const want = !scrolls ? null : el.scrollHeight > el.scrollTop + el.clientHeight + 8 ? "down" : "end";
      if (want === null) {
        if (el.hasAttribute("data-more")) el.removeAttribute("data-more");
      } else if (el.getAttribute("data-more") !== want) {
        el.setAttribute("data-more", want);
      }
    };
    let raf = 0;
    const later = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        sync();
      });
    };
    el.addEventListener("scroll", later, { passive: true });
    const seen = new Set<Element>();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
    const watch = (): void => {
      if (!ro) return;
      ro.observe(el);
      for (const c of Array.from(el.children)) {
        if (!seen.has(c)) {
          seen.add(c);
          ro.observe(c);
        }
      }
    };
    watch();
    // The window draws its own children after the first paint and swaps them; look again when the child list changes.
    const mo = typeof MutationObserver === "function" ? new MutationObserver(() => { watch(); later(); }) : null;
    mo?.observe(el, { childList: true });
    later();
    return () => {
      el.removeEventListener("scroll", later);
      ro?.disconnect();
      mo?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      el.removeAttribute("data-more");
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullNote("");
    const done = (): void => setFullNote("Full screen is not available here.");
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(done);
      else void (frame.current ?? document.documentElement).requestFullscreen().catch(done);
    } catch {
      done();
    }
  }, []);

  // The Menu button opens the main menu. A window without one (it is optional on the handle) falls back to the adventure list.
  const openMenu = useCallback(() => {
    const w = win.current;
    if (!w) return;
    if (w.openMainMenu) w.openMainMenu();
    else w.showStart();
  }, []);

  return (
    <main className="lt-app" ref={frame}>
      <header className="lt-app-bar">
        <h1 className="lt-app-title">The Living Table</h1>
        <div className="lt-app-actions">
          <button type="button" className="cui-button cui-button--secondary lt-app-menu" onClick={openMenu} disabled={phase.kind !== "ready"}>
            Menu
          </button>
          {canFullscreen() ? (
            <button
              type="button"
              className="cui-button cui-button--secondary lt-app-full"
              onClick={toggleFullscreen}
              aria-pressed={full}
              aria-label={full ? "Exit full screen" : "Fullscreen"}
            >
              <span className="lt-app-long">{full ? "Exit full screen" : "Fullscreen"}</span>
              <span className="lt-app-short" aria-hidden="true">
                {full ? "Exit" : "Full"}
              </span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="lt-app-window">
        <div ref={stage} className="lt-app-stage" />
        <div className="lt-app-fade" aria-hidden="true" />
        {phase.kind === "failed" ? (
          <div className="lt-app-note" role="alert">
            <p>{phase.message}</p>
            <button
              type="button"
              className="cui-button cui-button--primary"
              onClick={() => {
                noResume.current = true;
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      <footer className="lt-app-foot">
        <span className="lt-app-save" role="status">
          {fullNote || saveLine}
        </span>
        <span className="lt-app-version">v{APP_VERSION}</span>
      </footer>
      {splash !== "gone" ? <Splash leaving={splash === "leave"} /> : null}
    </main>
  );
}
