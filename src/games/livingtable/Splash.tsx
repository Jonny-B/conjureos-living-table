/**
 * The splash screen: what the player sees while the table is being set (the identity check, the art, the saves).
 *
 * The game's title in the pixel style of the table itself, a d20 that turns, and a line saying what is going on. It covers the whole
 * page, fits from a 320 px phone to a 4K screen, holds still for people who ask for less motion, and carries its own style sheet (it
 * must look right before the page's own styles have anything to say).
 *
 * Design note: there is no Pantry or Recipes splash to copy (neither app has one; the only precedent is the shell's plain loading
 * spinner), so this one is designed in the game's own look: the dark navy of the table, the gold of its titles, its pixel letters.
 *
 * TableScreen shows it for the loading phase, for at least SPLASH_MIN_MS so it does not flash, then fades it (SPLASH_FADE_MS).
 *
 * It has three steps, `data-step` on the page-wide element:
 *   table    setting the table (the identity check, the saves, the hand-drawn base art)
 *   art      getting the art ready: the game waits here until both art files are in (table/host/artGate.ts)
 *   failed   the art could not be had: the plain reasons and a Retry button (none when Retry could not help), the die holding still.
 *            The game never goes on without its art.
 */
import { useEffect, useRef, useState } from "react";
import { fitScale, pixelText, textWidth, wrapWidth } from "./table/ui/pixelFont";

/** The least time the splash stays up once it is shown, so a fast load does not make it flash. */
export const SPLASH_MIN_MS = 600;
/** How long the fade takes. */
export const SPLASH_FADE_MS = 260;
/** After this long a second line says it is still working. */
export const SPLASH_SLOW_MS = 6000;

/** What the splash says in each step of the wait. */
export type SplashStep = "table" | "art" | "failed";

/** The words of the line under the die for a step, in plain words. */
export const SPLASH_LINES: Readonly<Record<SplashStep, string>> = {
  table: "Setting the table",
  art: "Getting the art ready",
  failed: "The art did not load",
};

/** How much longer the splash must stay up: the minimum less what has passed since it was shown (never below 0). Pure. */
export function splashRemainingMs(shownAt: number, now: number, min: number = SPLASH_MIN_MS): number {
  const gone = Number.isFinite(now - shownAt) ? now - shownAt : 0;
  return Math.max(0, Math.round(min - gone));
}

const STYLE_ID = "ltp-style";

const CSS = `
.ltp{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px 16px calc(16px + env(safe-area-inset-bottom));background:radial-gradient(ellipse at 50% 38%,#1b2257 0%,#0b0e2e 55%,#05061a 100%);color:#f4ecd0;font-family:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;opacity:1;transition:opacity ${SPLASH_FADE_MS}ms ease-out;overflow-x:hidden;overflow-y:auto}
.ltp.is-leaving{opacity:0;pointer-events:none}
.ltp-inner{display:flex;flex-direction:column;align-items:center;gap:clamp(14px,3.5vh,28px);width:100%;max-width:760px;min-width:0;text-align:center;margin:auto}
.ltp-title{display:flex;justify-content:center;min-width:0;max-width:100%}
.ltp-title canvas{display:block;max-width:100%;height:auto;image-rendering:pixelated}
.ltp-die{width:clamp(72px,18vmin,148px);height:clamp(72px,18vmin,148px)}
.ltp-die svg{display:block;width:100%;height:100%;filter:drop-shadow(0 6px 0 rgba(5,6,26,.7));animation:ltp-turn 2.8s ease-in-out infinite;transform-origin:50% 50%}
@keyframes ltp-turn{0%{transform:rotate(0deg) scale(1)}25%{transform:rotate(90deg) scale(1.06)}50%{transform:rotate(180deg) scale(1)}75%{transform:rotate(270deg) scale(1.06)}100%{transform:rotate(360deg) scale(1)}}
.ltp-line{margin:0;font-size:clamp(13px,3.6vw,17px);letter-spacing:.06em;color:#98a5d8;overflow-wrap:anywhere}
.ltp-line.is-slow{color:#d9c79b;font-size:clamp(12px,3.2vw,14px);letter-spacing:.03em}
.ltp-dots{display:inline-flex;gap:3px;margin-left:2px}
.ltp-dots i{width:4px;height:4px;background:#ffc72a;display:block;animation:ltp-dot 1.2s ease-in-out infinite}
.ltp-dots i:nth-child(2){animation-delay:.2s}.ltp-dots i:nth-child(3){animation-delay:.4s}
@keyframes ltp-dot{0%,80%,100%{opacity:.2}40%{opacity:1}}
.ltp-line.is-head{color:#ffc72a;font-weight:700}
.ltp-why{margin:0;max-width:44ch;font-size:clamp(12px,3.3vw,15px);line-height:1.45;color:#d9c79b;overflow-wrap:anywhere}
.ltp-retry{box-sizing:border-box;min-width:min(100%,160px);min-height:48px;padding:10px 26px;font:inherit;font-size:clamp(14px,3.8vw,17px);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#2b1a05;background:linear-gradient(#fff3ad,#ffc72a);border:2px solid #2b1a05;border-radius:0;box-shadow:0 4px 0 #5a3208,0 7px 0 rgba(5,6,26,.65);cursor:pointer;touch-action:manipulation}
.ltp-retry:hover{background:linear-gradient(#fffbd0,#ffd35a)}
.ltp-retry:active{transform:translateY(2px);box-shadow:0 2px 0 #5a3208,0 5px 0 rgba(5,6,26,.65)}
.ltp-retry:focus-visible{outline:3px solid #f4ecd0;outline-offset:3px}
.ltp[data-step="failed"] .ltp-die svg{animation:none}
.ltp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-height:460px){.ltp{padding:10px 16px}.ltp-inner{gap:10px}.ltp-die{width:48px;height:48px}}
@media (prefers-reduced-motion:reduce){.ltp{transition:none}.ltp-die svg{animation:none}.ltp-dots i{animation:none;opacity:.8}}
`;

function ensureStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** The title in the game's own pixel letters, as large as the page allows (never smaller than 2 nor larger than 6 pixels per font pixel). */
function paintTitle(host: HTMLElement): void {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const avail = Math.max(120, Math.min(760, (host.parentElement?.clientWidth || window.innerWidth) - 8));
  const label = "THE LIVING TABLE";
  const scale = fitScale(textWidth(label, "bold") + 8, avail, 2, 6, dpr);
  const canvas = pixelText(label, {
    scale,
    dpr,
    weight: "bold",
    color: ["#fff3ad", "#ffc72a"],
    outline: "#2b1a05",
    outlinePx: 2,
    shadow: "rgba(5, 6, 26, 0.7)",
    shadowDx: 2,
    shadowDy: 2,
    maxWidth: wrapWidth(avail, scale, dpr),
    align: "center",
  });
  canvas.setAttribute("aria-hidden", "true");
  host.replaceChildren(canvas);
}

/** A d20 seen from the front: the table's gold hexagon with its triangle (the same die as the app icon). */
function Die() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ltp-gold" x1=".2" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor="#FFE3A3" />
          <stop offset=".5" stopColor="#E9A93B" />
          <stop offset="1" stopColor="#9A5A12" />
        </linearGradient>
      </defs>
      <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="url(#ltp-gold)" stroke="#5A3208" strokeWidth="2.4" strokeLinejoin="round" />
      <polygon points="32,16 46,40 18,40" fill="#FFF1CC" fillOpacity=".6" stroke="#5A3208" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 3 32 16 M7 17.5 18 40 M57 17.5 46 40 M18 40 7 46.5 M46 40 57 46.5 M18 40 32 61 46 40 M7 17.5 32 16 57 17.5" fill="none" stroke="#5A3208" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export interface SplashProps {
  leaving?: boolean;
  /** Which step the wait is in. Default "table". */
  step?: SplashStep;
  /** For the failed step: why, one plain sentence per kind of failure (table/host/artFailure.ts). */
  reasons?: readonly string[];
  /** For the failed step: what the Retry button does. Left out when no Retry could help (the ConjureOS app is too old), and then there is no button. */
  onRetry?: () => void;
}

export function Splash({ leaving = false, step = "table", reasons = [], onRetry }: SplashProps) {
  const title = useRef<HTMLDivElement | null>(null);
  const retry = useRef<HTMLButtonElement | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    ensureStyle();
  }, []);

  useEffect(() => {
    const host = title.current;
    if (!host) return;
    paintTitle(host);
    const again = (): void => paintTitle(host);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, []);

  // The slow line belongs to a wait that is going on; a new step starts the count again.
  useEffect(() => {
    setSlow(false);
    if (step === "failed") return;
    const t = setTimeout(() => setSlow(true), SPLASH_SLOW_MS);
    return () => clearTimeout(t);
  }, [step]);

  // The Retry button is the one thing to do on the failed step: the keyboard lands on it.
  const canRetry = typeof onRetry === "function";
  useEffect(() => {
    if (step === "failed") retry.current?.focus({ preventScroll: true });
  }, [step, canRetry]);

  // The style sheet is added in an effect, so the first paint of the splash would be bare; add it during render as well (idempotent).
  ensureStyle();

  const failed = step === "failed";
  return (
    <div
      className={`ltp${leaving ? " is-leaving" : ""}`}
      data-splash=""
      data-step={step}
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      aria-label={failed ? "The Living Table could not get its art" : "The Living Table is loading"}
    >
      <div className="ltp-inner">
        <span className="ltp-sr">The Living Table</span>
        <div className="ltp-title" ref={title} />
        <div className="ltp-die">
          <Die />
        </div>
        {failed ? (
          <>
            <p className="ltp-line is-head" data-art-failed="">
              {SPLASH_LINES.failed}
            </p>
            {reasons.map((why) => (
              <p className="ltp-why" data-art-reason="" key={why}>
                {why}
              </p>
            ))}
            {onRetry ? (
              <button type="button" className="ltp-retry" data-art-retry="" ref={retry} onClick={() => onRetry()}>
                Retry
              </button>
            ) : null}
          </>
        ) : (
          <p className="ltp-line" data-splash-line="">
            {SPLASH_LINES[step]}
            <span className="ltp-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
        )}
        {slow && !failed ? <p className="ltp-line is-slow">Still working. This can take a moment.</p> : null}
      </div>
    </div>
  );
}
