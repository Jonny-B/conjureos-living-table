/**
 * Input: pointer events on the board (hover, click, long press, context menu) and the keyboard.
 *
 * The rule for the whole board: a left click or a tap SELECTS and WALKS, and never acts. The actions menu (a right click, or a
 * half-second press on a touch screen) is where every other action starts, and it selects too.
 */
import { DIR_STEP, heroDown, type Dir } from "../state";
import type { TableCtx } from "../tableCtx";

export function installInput(tc: TableCtx): void {
  // ---- pointer ---------------------------------------------------------------

  tc.viewport.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const t = tc.tileAt(e.clientX, e.clientY);
    if ((t?.x ?? -1) !== (tc.hover?.x ?? -1) || (t?.y ?? -1) !== (tc.hover?.y ?? -1)) tc.hover = t;
    const plan = t && !tc.busy ? tc.planFor(t) : null;
    // The only hint the pointer gives is that the hero cannot go there.
    tc.viewport.style.cursor = !plan ? "default" : plan.kind === "none" ? (plan.reason ? "not-allowed" : "default") : "pointer";
  });
  tc.viewport.addEventListener("pointerleave", () => {
    tc.hover = null;
  });
  // A touch screen's press-and-hold would start selecting text; the board never selects any.
  tc.viewport.addEventListener("selectstart", (e) => e.preventDefault());
  const clearTextSelection = (): void => {
    try {
      window.getSelection?.()?.removeAllRanges();
    } catch {
      // A page that will not say what is selected has nothing selected.
    }
  };
  /** The square the menu opens on is the selected one. */
  const selectUnder = (x: number, y: number): void => {
    const t = tc.tileAt(x, y);
    if (t) tc.selected = { ...t };
  };
  // Right-click, or a half-second press on a touch screen, opens the actions menu on any square the hero has seen, and selects it.
  let touchExaminedAt = -Infinity;
  let longPressed = false;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressFrom: { x: number; y: number } | null = null;
  const endPress = (): void => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
    pressFrom = null;
  };
  tc.viewport.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // A long press on a phone can fire this as well as the timer below: one examine, not two.
    if (performance.now() - touchExaminedAt < 900) return;
    selectUnder(e.clientX, e.clientY);
    tc.openMenu(e.clientX, e.clientY);
  });
  tc.viewport.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    longPressed = false;
    endPress();
    pressFrom = { x: e.clientX, y: e.clientY };
    const at = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      const t = tc.tileAt(at.x, at.y);
      if (!t) return;
      longPressed = true;
      touchExaminedAt = performance.now();
      clearTextSelection();
      selectUnder(at.x, at.y);
      tc.openMenu(at.x, at.y);
    }, 500);
  });
  tc.viewport.addEventListener("pointermove", (e) => {
    if (pressFrom && Math.hypot(e.clientX - pressFrom.x, e.clientY - pressFrom.y) > 10) endPress();
  });
  tc.viewport.addEventListener("pointerup", endPress);
  tc.viewport.addEventListener("pointercancel", endPress);
  tc.viewport.addEventListener("click", (e) => {
    if (longPressed) {
      // The press already opened the menu; the tap that ends it is not a click on the square.
      longPressed = false;
      return;
    }
    if (tc.busy) {
      tc.skipping = true;
      tc.tray.skip();
      return;
    }
    const t = tc.tileAt(e.clientX, e.clientY);
    if (!t) return;
    // One tap or one left click selects the square and walks there (or beside what stands on it) at once; it never acts.
    const touch = (e as PointerEvent).pointerType === "touch";
    const plan = tc.planFor(t);
    tc.hover = touch ? null : t;
    if (plan.kind !== "none") tc.selected = { ...t };
    tc.runPlan(plan);
  });

  // ---- keyboard ----------------------------------------------------------------

  /** The keys that open the game menu, and the tab each opens. */
  const MENU_KEY: Record<string, "character" | "inventory" | "journal" | "log"> = { c: "character", i: "inventory", j: "journal", l: "log" };
  const KEY_DIR: Record<string, Dir> = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!tc.el.isConnected || tc.el.offsetParent === null) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, [contenteditable]")) return;
    const key = e.key.toLowerCase();
    // A focused control that Space or Enter activates (a button, the licence panel's summary, a link) keeps that key; the board has Space only when nothing like that is focused.
    if (target?.closest?.("button, summary, a, [role=button]") && (key === " " || key === "enter")) return;
    if (target?.tagName === "SELECT" && !KEY_DIR[key]) return;
    // The game menu, a story screen and the creator pause the game: their own keys are theirs (they handle Escape themselves). The one thing the
    // board still does while the menu is up is its tab keys: another tab's key switches to it, and the tab already showing closes the menu.
    const menuTab = MENU_KEY[key];
    if (tc.overlayOpen()) {
      if (menuTab && !e.repeat && tc.gameMenuOpen()) {
        tc.openGameMenu(menuTab);
        e.preventDefault();
      }
      return;
    }
    // C, I, J and L open the game menu on the Character, Inventory, Journal and Log tabs.
    if (menuTab && !e.repeat) {
      tc.openGameMenu(menuTab);
      e.preventDefault();
      return;
    }
    if (key === "escape" && tc.dmThinking) {
      tc.cancelDm();
      e.preventDefault();
      return;
    }
    // Space is the dialogue box's press first (finish the page, next page, next entry, close); with no box up it is the skip key it always was.
    if (key === " " && tc.overlay.advanceStory()) {
      e.preventDefault();
      return;
    }
    if (key === " " || key === "escape") {
      if (tc.busy) {
        tc.skipping = true;
        tc.tray.skip();
      } else {
        tc.walkQueue.length = 0;
        tc.onArrive = null;
      }
      e.preventDefault();
      return;
    }
    if (tc.busy) return;
    // 1 to 4 pick the DM's suggested moves. With the hero down the two next moves are Load last save (1, or Enter) and Reset scene (2).
    if (heroDown(tc.st()) && (key === "enter" || key === "1" || key === "2")) {
      if (!e.repeat) {
        if (key === "2") tc.resetScene();
        else tc.loadSave("last");
      }
      e.preventDefault();
      return;
    }
    if (key >= "1" && key <= "4" && key.length === 1) {
      if (!e.repeat) tc.pickOption(Number(key) - 1);
      e.preventDefault();
      return;
    }
    const dir = KEY_DIR[key];
    if (dir) {
      (target as HTMLElement | null)?.blur?.();
      // One square per press; a held key's repeats keep exactly one square waiting, so letting go stops within a square.
      if (tc.walkQueue.length === 0 && !tc.onArrive) {
        const p = tc.st();
        tc.walkQueue.push({ x: p.heroAt.x + DIR_STEP[dir].x, y: p.heroAt.y + DIR_STEP[dir].y });
        tc.onArrive = async () => {
          await tc.afterHeroAction();
        };
      }
    } else if (key === "f") {
      if (!e.repeat) void tc.attackNearest();
    } else if (key === "e") {
      if (!e.repeat) void tc.useNearby();
    } else if (key === "q") {
      if (!e.repeat) void tc.drinkPotion();
    } else if (key === "t") {
      if (!e.repeat) void tc.endTurnFlow();
    } else if (key === "r") {
      if (!e.repeat) void tc.restFlow();
    } else {
      return;
    }
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  const onBlur = () => {
    tc.walkQueue.length = 0;
  };
  window.addEventListener("blur", onBlur);

  // What the other modules call or read.
  tc.endPress = endPress;
  tc.onKey = onKey;
  tc.onBlur = onBlur;
}
