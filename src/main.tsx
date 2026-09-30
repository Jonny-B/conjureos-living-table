import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerActions } from "./bridge/actions";
// ConjureOS "Modern Whimsy" tokens and primitives, a VENDORED copy of
// @conjureos/ui's dist/ui.css imported by RELATIVE path on purpose: ConjureOS's
// @bundle sends every BARE import to the jspm CDN, which cannot serve a
// CSS-only package, while a relative import is inlined into the bundle.
// Re-sync when the tokens change: cp node_modules/@conjureos/ui/dist/ui.css src/conjureos-ui.css
import "./conjureos-ui.css";
// THE ORDER OF THESE THREE SHEETS IS LOAD-BEARING, and it is layer order, not
// source order: conjureos-ui.css and styles.css both open with
// `@layer core, legacy;` and core.css with `@layer core, skin, state;`, which
// compose to core, legacy, skin, state. This is the same ladder Conjure Games
// runs, so the Living Table looks exactly as it did inside the hub. A sheet
// left unlayered silently outranks every layer.
import "./styles.css";
import "./core.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// The --cui-* tokens are scoped to `.cui-ui`. ConjureOS @bundle generates its
// own HTML shell and drops index.html's body class, so set it at runtime too.
document.body.classList.add("cui-ui");

void registerActions();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
