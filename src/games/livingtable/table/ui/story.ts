/**
 * The story screen: story the player did not ask for (a place's read-aloud, a scene's opening, a beat) told on a screen of its own in
 * the middle of the board. A scrim, a parchment (or gold-framed pixel) panel with a title ribbon, and the words printed a character at
 * a time in pages of about eight rows. The world is locked while it is up and the normal DM box is hidden; a press finishes the page,
 * then turns it, then closes the story. It never closes by itself.
 *
 * createStoryFlow is the pure part (the queue of stories and their promises, on a second dialogue queue whose reading time is endless);
 * installStory draws it.
 */
import { CELL_H, LINE_GAP, cssScale, normalizeText, textWidth, wrapWidth } from "./pixelFont";
import type { BannerKind, StoryOptions, TextSpeed } from "./overlayTypes";
import { el, deviceRatio, ctxWidth, spriteCanvas, FRAMES, CARET_DOWN, clamp } from "./domKit";
import { PX, SERIF, STORY_IN_MS } from "./overlayTheme";
import { storyPerPage } from "./overlayMath";
import { tidy } from "./screenHelpers";
import { createDialogueQueue, dialoguePages, sameStory, DEFAULT_TEXT_SPEED, textSpeedOf } from "./dialogueQueue";
import type { DialogueView } from "./dialogueQueue";
import type { OverlayCtx } from "./overlayCtx";

// ---- the flow (pure, unit tested) ------------------------------------------------------------------------------------------------

/** The same words told again within this long of being read are not shown a second time. */
const STORY_RECENT_MS = 3000;

/** The story on show, as the screen draws it (its words are paged by the queue: see StoryFlow.view). */
export interface StoryCurrent {
  id: number;
  title: string;
  speaker: string;
  text: string;
  ribbon: BannerKind;
}

export interface StoryFlowOptions {
  /** A story's text as pages of rows that fit the panel (it measures; the flow never does). */
  layout(text: string): string[][];
  now?(): number;
  speed?: TextSpeed;
}

export interface StoryFlow {
  /** Tell a story. Resolves when it has been read through (or cleared). The same words already waiting share one screen. */
  open(opts: StoryOptions): Promise<void>;
  /** Whether a story is up (or waiting behind the one that is). */
  isOpen(): boolean;
  /** The story on show, or null. */
  current(): StoryCurrent | null;
  /** How many stories are up or waiting. */
  pending(): number;
  /** A press: finish the page, turn it, move to the next story, or close. "none" when nothing is open. */
  press(): "finish" | "page" | "next" | "close" | "none";
  tick(dtMs: number): { changed: boolean };
  needsTick(): boolean;
  /** The words of the story on show as the queue pages them; null when it is a title alone. */
  view(): DialogueView | null;
  setSpeed(speed: TextSpeed): void;
  relayout(): void;
  /** Release every teller and every waiter and leave nothing open. */
  clear(): void;
  /** Resolves at once with nothing open, else after the last story has been read. */
  whenClosed(): Promise<void>;
  /** One listener: called whenever the story on show changes, or the last one closes. */
  onChange(listener: (() => void) | null): void;
}

interface StoryItem {
  id: number;
  title: string;
  speaker: string;
  text: string;
  ribbon: BannerKind;
  done: Promise<void>;
  release(): void;
}

export function createStoryFlow(o: StoryFlowOptions): StoryFlow {
  const now = o.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  // A second queue: same typewriter and page presses as the DM box, but its reading time is endless, so nothing here closes by itself.
  const queue = createDialogueQueue({ layout: o.layout, reading: () => Number.POSITIVE_INFINITY, now, speed: o.speed ?? DEFAULT_TEXT_SPEED });
  const items: StoryItem[] = [];
  const waiters: Array<() => void> = [];
  let nextId = 1;
  let recent: { text: string; at: number } | null = null;
  let listener: (() => void) | null = null;

  const changed = (): void => listener?.();
  /** Put the first story's words in the queue (or nothing, for a title alone). */
  const loadHead = (): void => {
    queue.clear();
    const head = items[0];
    if (head && head.text !== "") queue.push({ speaker: head.speaker, text: head.text });
  };
  const settleWaiters = (): void => {
    if (items.length > 0) return;
    for (const w of waiters.splice(0)) w();
  };
  const closeHead = (): void => {
    const head = items.shift();
    if (!head) return;
    if (head.text !== "") recent = { text: head.text, at: now() };
    head.release();
    loadHead();
    settleWaiters();
    changed();
  };

  return {
    open(opts) {
      const title = tidy(opts.title);
      const text = (opts.text ?? "").trim();
      if (!title && !text) return Promise.resolve();
      const twin = items.find((i) => (text !== "" ? i.text !== "" && sameStory(i.text, text) : i.text === "" && i.title === title));
      if (twin) return twin.done;
      if (text !== "" && recent && now() - recent.at < STORY_RECENT_MS && sameStory(recent.text, text)) return Promise.resolve();
      let release!: () => void;
      const done = new Promise<void>((resolve) => (release = resolve));
      const item: StoryItem = { id: nextId++, title, speaker: tidy(opts.speaker), text, ribbon: opts.ribbon ?? "turn", done, release };
      items.push(item);
      if (items.length === 1) loadHead();
      changed();
      return done;
    },
    isOpen: () => items.length > 0,
    current() {
      const h = items[0];
      return h ? { id: h.id, title: h.title, speaker: h.speaker, text: h.text, ribbon: h.ribbon } : null;
    },
    pending: () => items.length,
    press() {
      const head = items[0];
      if (!head) return "none";
      if (head.text === "") {
        closeHead();
        return items.length > 0 ? "next" : "close";
      }
      const r = queue.press();
      if (r === "close" || r === "next") {
        closeHead();
        return items.length > 0 ? "next" : "close";
      }
      if (r !== "none") changed();
      return r;
    },
    tick(dtMs) {
      const r = queue.tick(dtMs);
      return { changed: r.changed };
    },
    needsTick: () => items.length > 0 && queue.needsTick(),
    view: () => queue.view(),
    setSpeed(speed) {
      queue.setSpeed(speed);
    },
    relayout() {
      queue.relayout();
    },
    clear() {
      const all = items.splice(0);
      queue.clear();
      for (const i of all) i.release();
      recent = null;
      settleWaiters();
      changed();
    },
    whenClosed() {
      if (items.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    onChange(fn) {
      listener = fn;
    },
  };
}

// ---- the screen ------------------------------------------------------------------------------------------------------------------

/** One row of the page on show: how to show its first `k` characters. */
interface StoryRow {
  len: number;
  show(k: number): void;
}

export function installStory(oc: OverlayCtx): void {
  const layer = el("div", "lto-story");
  layer.dataset.ltoStory = "";
  layer.hidden = true;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "Story");
  const panel = el("div", "lto-story-panel");
  panel.tabIndex = 0;
  layer.append(panel);

  let textSpeed: TextSpeed = DEFAULT_TEXT_SPEED;
  let drawnSig = "";
  let drawnHint = "";
  let rows: StoryRow[] = [];
  let hintHost: HTMLElement | null = null;
  let loopId = 0;
  let loopLast = 0;
  let wasOpen = false;
  /** The story whose words were last read out to a screen reader. */
  let announced = 0;
  let prevFocus: Element | null = null;
  let handler: ((open: boolean) => void) | null = null;

  /** What the panel is cut to: its width, the type size, the rows a page holds and the width a row of text has. */
  function metrics(): { panelW: number; scale: number; row: number; fontPx: number; room: number; per: number } {
    const rootW = oc.root.clientWidth || oc.width || 480;
    const rootH = oc.root.clientHeight || 320;
    const pixel = oc.isPixel();
    const ratio = deviceRatio();
    const panelW = clamp(rootW - 24, 200, oc.tier === "l" ? 620 : 560);
    const scale = oc.tier === "l" ? 3 : 2;
    const fontPx = oc.tier === "s" ? 16 : 17;
    const row = pixel ? (CELL_H + LINE_GAP) * cssScale(scale, ratio) : Math.round(fontPx * 1.5);
    const frame = pixel ? (oc.tier === "s" ? 5 : 10) : 1;
    const padX = pixel ? 18 : 26;
    const room = Math.max(60, panelW - 2 * frame - 2 * padX);
    // Title ribbon (it may take two lines), speaker line, footer, padding and frame: about 200 px that the rows do not get.
    const per = storyPerPage(rootH - 24, row, 200);
    return { panelW, scale, row, fontPx, room, per };
  }

  function layout(text: string): string[][] {
    const m = metrics();
    if (oc.isPixel()) return dialoguePages(normalizeText(text), (s) => textWidth(s), wrapWidth(m.room, m.scale, deviceRatio()), m.per);
    return dialoguePages(text, (s) => ctxWidth(s, `italic ${m.fontPx}px ${SERIF}`, m.fontPx * 0.5), m.room - 8, m.per);
  }

  const flow = createStoryFlow({ layout });

  function setHint(complete: boolean, more: boolean): void {
    const words = !complete ? "Click to show it all" : more ? "Click for more" : "Click to continue";
    const key = `${words}|${oc.style}|${oc.tier}|${deviceRatio()}`;
    if (!hintHost || key === drawnHint) return;
    drawnHint = key;
    hintHost.replaceChildren();
    if (oc.isPixel()) {
      hintHost.append(oc.srText(words), oc.px(words.toUpperCase(), { scale: 2, weight: "bold", color: complete ? PX.gold : PX.muted, shadow: PX.shade }));
      if (complete) {
        const caret = spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.gold.L }, 2);
        caret.classList.add("lto-story-caret");
        hintHost.append(caret);
      }
    } else {
      hintHost.append(el("span", "lto-story-hint-words", words));
      if (complete) hintHost.append(el("span", "lto-story-more"));
    }
  }

  /** Draw the story on show from scratch: its ribbon, the rows of the page, the footer. */
  function build(cur: NonNullable<ReturnType<typeof flow.current>>): void {
    const m = metrics();
    const pixel = oc.isPixel();
    const v = flow.view();
    panel.className = "lto-story-panel";
    panel.replaceChildren();
    panel.style.setProperty("--sw", `${m.panelW}px`);
    panel.style.setProperty("--srow", `${m.row}px`);
    panel.style.setProperty("--sfs", `${m.fontPx}px`);
    if (pixel) oc.frame(panel, "gold");
    else panel.classList.add("lto-sbpanel");
    if (cur.title) oc.ribbon(panel, cur.title, cur.ribbon, { pxMax: 3, sbMax: oc.tier === "s" ? 22 : 30 });
    if (cur.speaker) oc.stext(panel, cur.speaker, { cls: "lto-story-spk", scale: 2, weight: "bold", color: PX.gold, center: true });
    rows = [];
    const body = el("div", "lto-story-body");
    body.setAttribute("aria-hidden", "true");
    const lines = v ? (v.pages[v.page] ?? []) : [];
    const longest = Math.max(0, ...(v ? v.pages : []).map((p) => p.length));
    body.style.minHeight = `${longest * m.row}px`;
    for (const line of lines) {
      const rowNode = el("div", "lto-story-line");
      if (pixel) {
        const ink = el("span", "lto-story-ink");
        ink.append(oc.px(line, { scale: m.scale, color: PX.ink, shadow: PX.shade }));
        rowNode.append(ink);
        const total = Math.max(1, textWidth(line));
        rows.push({
          len: line.length,
          show(k) {
            if (k >= line.length) ink.style.clipPath = "";
            else if (k <= 0) ink.style.clipPath = "inset(0 100% 0 0)";
            else ink.style.clipPath = `inset(0 ${((1 - textWidth(line.slice(0, k)) / total) * 100).toFixed(2)}% 0 0)`;
          },
        });
      } else {
        const typed = el("span");
        const rest = el("span", "lto-story-rest", line);
        rowNode.append(typed, rest);
        rows.push({
          len: line.length,
          show(k) {
            const n = clamp(k, 0, line.length);
            typed.textContent = line.slice(0, n);
            rest.textContent = line.slice(n);
          },
        });
      }
      body.append(rowNode);
    }
    panel.append(body);
    if (cur.text) panel.append(oc.srText(cur.text));
    const foot = el("div", "lto-story-foot");
    foot.setAttribute("aria-hidden", "true");
    hintHost = foot;
    drawnHint = "";
    panel.append(foot);
    layer.setAttribute("aria-label", cur.title || "Story");
  }

  /** Show the first `shown` characters of the page: the rows before are whole, the row being typed is part way, those after are not yet. */
  function reveal(shown: number): void {
    let left = shown;
    for (const r of rows) {
      r.show(left);
      left -= r.len + 1;
    }
  }

  function render(): void {
    if (oc.destroyed) return;
    const cur = flow.current();
    if (!cur) return;
    const v = flow.view();
    const sig = [cur.id, v ? v.page : 0, oc.style, oc.tier, deviceRatio(), oc.root.clientWidth, oc.root.clientHeight].join("|");
    if (sig !== drawnSig) {
      drawnSig = sig;
      build(cur);
    }
    reveal(v ? v.shown : 0);
    const complete = v ? v.complete : true;
    const more = v ? v.pages.length > v.page + 1 : false;
    setHint(complete, more);
    layer.dataset.title = cur.title;
    layer.dataset.speaker = cur.speaker;
    layer.dataset.text = cur.text;
    layer.dataset.page = String(v ? v.page + 1 : 1);
    layer.dataset.pages = String(v ? Math.max(1, v.pages.length) : 1);
    layer.dataset.shown = String(v ? v.shown : 0);
    layer.dataset.complete = String(complete);
    layer.dataset.more = String(more);
    layer.dataset.queued = String(Math.max(0, flow.pending() - 1));
    layer.title = !complete ? "Click to show it all" : "Click to continue";
  }

  // ---- the clock

  function loopStep(now: number): void {
    loopId = 0;
    if (oc.destroyed || !flow.isOpen()) return;
    const dt = Math.min(250, Math.max(0, now - loopLast));
    loopLast = now;
    if (flow.tick(dt).changed) render();
    if (flow.needsTick()) loopId = typeof requestAnimationFrame === "function" ? requestAnimationFrame(loopStep) : window.setTimeout(() => loopStep(performance.now()), 33);
  }
  function runClock(): void {
    if (loopId !== 0 || !flow.needsTick()) return;
    loopLast = performance.now();
    loopId = typeof requestAnimationFrame === "function" ? requestAnimationFrame(loopStep) : window.setTimeout(() => loopStep(performance.now()), 33);
  }
  function stopClock(): void {
    if (loopId === 0) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(loopId);
    window.clearTimeout(loopId);
    loopId = 0;
  }

  // ---- keys and pointer: the world takes none of them while a story is up

  function onKey(e: KeyboardEvent): void {
    if (!flow.isOpen()) return;
    // The browser's own shortcuts (copy, reload, zoom) are left alone; everything else is the story's.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopImmediatePropagation();
    if (e.key === "Tab") {
      e.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    if (e.key === "Enter" || e.key === " " || e.key === "Escape" || e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!e.repeat) press();
    }
  }
  function press(): void {
    if (oc.destroyed || !flow.isOpen()) return;
    // The flow tells sync() when the page, the story or the screen changed.
    flow.press();
  }
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "touchstart", "touchend", "keyup", "keypress"]) layer.addEventListener(type, (e) => e.stopPropagation());
  layer.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  layer.addEventListener("click", (e) => {
    e.stopPropagation();
    press();
  });

  // ---- opening and closing

  /** After anything changed: show or hide the screen, draw what is on show and keep the clock going. */
  function sync(): void {
    if (oc.destroyed) return;
    const open = flow.isOpen();
    if (open) {
      if (!wasOpen) {
        wasOpen = true;
        oc.closeMenu(false);
        prevFocus = document.activeElement;
        layer.hidden = false;
        oc.root.dataset.story = "open";
        oc.pauseDialogue(true);
        window.addEventListener("keydown", onKey, true);
        drawnSig = "";
        if (!oc.reduced() && typeof layer.animate === "function") void oc.play(layer, [{ opacity: 0 }, { opacity: 1 }], STORY_IN_MS, "ease-out");
        render();
        panel.focus({ preventScroll: true });
        handler?.(true);
      } else render();
      const cur = flow.current();
      if (cur && cur.id !== announced) {
        announced = cur.id;
        oc.announce(`${cur.title ? `${cur.title}. ` : ""}${cur.text}`);
      }
      runClock();
      return;
    }
    stopClock();
    announced = 0;
    if (!wasOpen) return;
    wasOpen = false;
    window.removeEventListener("keydown", onKey, true);
    layer.hidden = true;
    delete oc.root.dataset.story;
    drawnSig = "";
    const had = layer.contains(document.activeElement);
    oc.pauseDialogue(false);
    if ((had || document.activeElement === document.body) && prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    prevFocus = null;
    handler?.(false);
  }
  flow.onChange(sync);

  function storyScreen(sopts: StoryOptions): Promise<void> {
    if (oc.destroyed) return Promise.resolve();
    return flow.open(sopts);
  }

  function relayoutStory(): void {
    if (!flow.isOpen()) return;
    flow.relayout();
    drawnSig = "";
    render();
    runClock();
  }

  function clearStory(): void {
    flow.clear();
  }

  // The text speed the player chose follows into this screen as well (reduced motion prints a page at once).
  const baseSpeed = oc.setTextSpeed;
  oc.setTextSpeed = (next: TextSpeed): void => {
    baseSpeed(next);
    textSpeed = textSpeedOf(next);
    flow.setSpeed(oc.reduced() ? "instant" : textSpeed);
  };

  // What the other modules call or read.
  oc.storyLayer = layer;
  oc.storyScreen = storyScreen;
  oc.storyOpen = flow.isOpen;
  oc.whenStoryClosed = flow.whenClosed;
  oc.onStoryChange = (fn) => {
    handler = fn;
  };
  oc.relayoutStory = relayoutStory;
  oc.clearStory = clearStory;
}
