/**
 * The Living Table, as the whole app.
 *
 * One screen: the table window (table/mountTable.ts) filling the page, with a slim bar above it (the title, the
 * way back to the adventure list, Fullscreen) and a line below (where the saves are, the version, the licence
 * credits). The window itself holds everything else: the start screen with the adventures, the hero choice, the
 * board, the sheet, the dice, the DM and its Settings tab.
 *
 * The game stands alone: nothing here leads to another app. The window is built once per visit, from the game's own
 * host (table/host/gameHost.ts), and torn down with the screen.
 *
 * React owns the bar and the line; the window owns the element it is mounted into (its children are drawn by the
 * window, never by React), so that element has no React children.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../../version";
import { SRD_ATTRIBUTION } from "./menu/labels";
import { mountTable, type TableWindow } from "./table/mountTable";
import { createGameHost, type GameHost } from "./table/host/gameHost";
import { statusText, type StorageStatus } from "./table/host/gameStorage";

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
  const [full, setFull] = useState(false);
  const [fullNote, setFullNote] = useState("");

  useEffect(() => {
    let alive = true;
    let game: GameHost | null = null;
    let offStatus: (() => void) | null = null;
    setPhase({ kind: "loading" });
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
            setPhase({ kind: "failed", message: MOUNT_FAILED });
            return;
          }
          line(made.storage.status());
          setPhase({ kind: "ready" });
        },
        (e: unknown) => {
          if (!alive) return;
          setPhase({ kind: "failed", message: e instanceof Error && e.message ? e.message : "The table could not be set." });
        },
      );
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
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

  const showAdventures = useCallback(() => win.current?.showStart(), []);

  return (
    <main className="lt-app" ref={frame}>
      <header className="lt-app-bar">
        <h1 className="lt-app-title">The Living Table</h1>
        <div className="lt-app-actions">
          <button type="button" className="cui-button cui-button--secondary" onClick={showAdventures} disabled={phase.kind !== "ready"}>
            Adventures
          </button>
          {canFullscreen() ? (
            <button type="button" className="cui-button cui-button--secondary lt-app-full" onClick={toggleFullscreen} aria-pressed={full}>
              {full ? "Exit full screen" : "Fullscreen"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="lt-app-window">
        <div ref={stage} className="lt-app-stage" />
        {phase.kind === "loading" ? <p className="lt-app-note" role="status">Setting the table...</p> : null}
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
        <details className="lt-app-credits">
          <summary>Licence and attribution</summary>
          <div className="lt-app-credits-body">
            <p>{SRD_ATTRIBUTION.creator}</p>
            <p>{SRD_ATTRIBUTION.copyright}</p>
            <p>
              {SRD_ATTRIBUTION.license}{" "}
              <a href={SRD_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer noopener">
                {SRD_ATTRIBUTION.licenseUrl}
              </a>
            </p>
            <p>{SRD_ATTRIBUTION.modified}</p>
            <p>{SRD_ATTRIBUTION.disclaimer}</p>
          </div>
        </details>
        <span className="lt-app-version">v{APP_VERSION}</span>
      </footer>
    </main>
  );
}
