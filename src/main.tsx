import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// ConjureOS "Modern Whimsy" tokens and primitives, a VENDORED copy of
// @conjureos/ui's dist/ui.css imported by RELATIVE path on purpose: ConjureOS's
// @bundle sends every BARE import to the jspm CDN, which cannot serve a
// CSS-only package, while a relative import is inlined into the bundle.
// Re-sync when the tokens change: cp node_modules/@conjureos/ui/dist/ui.css src/conjureos-ui.css
import "./conjureos-ui.css";
// THE ORDER OF THESE THREE SHEETS IS LOAD-BEARING, and it is layer order, not
// source order: conjureos-ui.css and styles.css both open with
// `@layer core, legacy;` and core.css with `@layer core, skin, state;`, which
// compose to core, legacy, skin, state. A sheet left unlayered silently
// outranks every layer; app.css is unlayered on purpose and styles only the
// page around the table window (everything under .lt-app).
import "./styles.css";
import "./core.css";
import "./app.css";

// The browser raises "ResizeObserver loop completed with undelivered notifications." and "ResizeObserver loop limit exceeded." as a window "error" event when a ResizeObserver callback changes the size of what it watches. They are
// harmless (nothing is lost, the next frame lays out again), but the ConjureOS shell paints every window error as a red banner over the
// game. The fixes are in the observers themselves (each one defers its work a frame); this is the net under them. A capture listener on
// the window runs before anyone else's and stops exactly these two messages, nothing else.
const BENIGN_RESIZE = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)\.?$/;
window.addEventListener(
  "error",
  (ev: ErrorEvent) => {
    if (typeof ev.message === "string" && BENIGN_RESIZE.test(ev.message)) ev.stopImmediatePropagation();
  },
  true,
);

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// The --cui-* tokens are scoped to `.cui-ui`. ConjureOS @bundle generates its
// own HTML shell and drops index.html's body class, so set it at runtime too.
document.body.classList.add("cui-ui");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
