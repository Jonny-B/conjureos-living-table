/**
 * The start screen: adventure cards, test rooms and the AI adventure writer card.
 */
import type { StartScreenOptions, StartScreen, StartWriting, StartRoom } from "./overlayTypes";
import { el, spriteCanvas } from "./domKit";
import { PX } from "./overlayTheme";
import type { WriteStage, StartCard, WriteEvent } from "./screenHelpers";
import { startCards, startRooms, PREMISE_MAX, premiseReady, cardBadge, excerpt, problemLines, writingLine, nextWriteStage, tidy } from "./screenHelpers";
import type { OverlayCtx } from "./overlayCtx";

export function installStartScreen(oc: OverlayCtx): void {
  // ---- the start screen

  function startScreen(sopts: StartScreenOptions): StartScreen {
    const dead: StartScreen = { close() {}, setWriting() {}, setProblems() {}, setNote() {} };
    if (oc.destroyed) return dead;
    let writeProblems: string[] = [];
    let note = "";
    const adventures = startCards(sopts.adventures);
    const rooms = startRooms(sopts.sandboxes);
    let stage: WriteStage = "closed";
    let writing: StartWriting | null = null;
    let cancelFn: (() => void) | undefined;
    let cancelling = false;
    const ta = el("textarea", "lto-ta");
    ta.rows = 4;
    ta.maxLength = PREMISE_MAX;
    ta.placeholder = "A haunted lighthouse and a missing keeper...";
    ta.dataset.scrKey = "premise";
    ta.dataset.ltoPremise = "";
    ta.setAttribute("aria-label", "What the adventure is about");
    ta.setAttribute("autocapitalize", "sentences");
    let writeBtn: HTMLButtonElement | null = null;
    const sync = (): void => {
      if (writeBtn) writeBtn.disabled = !premiseReady(ta.value);
    };
    ta.addEventListener("input", sync);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        step("write");
      }
    });
    const busy = (): boolean => stage === "writing";

    const s = oc.mountScreen("start", "The Living Table: choose an adventure", (sc) => {
      sc.node.dataset.busy = String(busy());
      const body = sc.body;
      if (sopts.onMenu) {
        const top = el("div", "lto-scr-actions is-start");
        body.append(top);
        const back = oc.sbtn(top, "Main menu", "menu");
        back.dataset.ltoMenu = "";
        if (busy()) back.disabled = true;
        else back.addEventListener("click", () => sopts.onMenu?.());
      }
      oc.titleBlock(body, "The Living Table", "Choose an adventure");
      if (note) {
        const n = oc.stext(body, note, { cls: "lto-card-text", scale: 2, color: PX.gold, outline: true, center: true });
        n.dataset.ltoNote = "";
        n.setAttribute("role", "status");
      }

      // the owner's adventures
      oc.sectionHead(body, "Adventures");
      const list = el("div", "lto-card-list");
      list.dataset.ltoAdventures = "";
      body.append(list);
      if (adventures.length === 0) oc.stext(list, "No adventures are installed yet.", { cls: "lto-scr-sub", scale: 2, color: PX.muted, outline: true });
      for (const c of adventures) adventureCard(list, c);

      // the test rooms
      if (rooms.length > 0) {
        oc.sectionHead(body, "Test rooms");
        const grid = el("div", "lto-card-grid");
        grid.dataset.ltoRooms = "";
        body.append(grid);
        for (const r of rooms) roomCard(grid, r);
      }

      // the AI writer
      oc.sectionHead(body, "Something new");
      aiCard(body);
    });
    s.onEscape = () => {
      if (stage === "closed" && !busy()) sopts.onMenu?.();
      else step("back");
    };

    function adventureCard(list: HTMLElement, c: StartCard): void {
      const playable = c.playable;
      const node = playable ? el("button", "lto-card") : el("div", "lto-card");
      if (node instanceof HTMLButtonElement) node.type = "button";
      node.dataset.ltoAdventure = c.id;
      node.dataset.author = c.author;
      node.dataset.playable = String(playable);
      node.dataset.draft = String(c.draftMarks);
      node.dataset.scrKey = `adv:${c.id}`;
      node.dataset.scrNav = "";
      // Who wrote it and how finished it is are for the author's checks, not for the player: only an AI written card is tagged.
      const badge = cardBadge(c.author);
      const name = [c.title, badge].filter(Boolean).join(", ");
      if (playable) {
        node.setAttribute("aria-label", `${name}. ${c.summary}`);
        node.addEventListener("click", () => {
          if (!busy()) sopts.onPick(c.id);
        });
        if (busy()) node.setAttribute("aria-disabled", "true");
      } else {
        node.tabIndex = 0;
        node.setAttribute("role", "group");
        node.setAttribute("aria-label", `${name}, cannot be played yet. ${c.problems.join(". ")}`);
        node.setAttribute("aria-disabled", "true");
      }
      list.append(node);
      if (oc.isPixel()) oc.frame(node, playable ? "gold" : "red", true);
      else {
        node.classList.add("lto-plate");
        if (!playable) node.classList.add("is-bad");
      }
      oc.stext(node, c.title, { cls: "lto-card-title", scale: 2, weight: "bold", color: playable ? PX.gold : PX.muted });
      const meta = el("div", "lto-card-meta");
      if (badge || playable) node.append(meta);
      if (badge) oc.pill(meta, badge, "ai");
      if (playable) {
        const play = el("span", "lto-play");
        play.setAttribute("aria-hidden", "true");
        if (oc.isPixel()) play.append(oc.px("PLAY", { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark }), spriteCanvas(["o...", "oo..", "ooo.", "oooo", "ooo.", "oo..", "o..."], { o: "#ffc72a" }, 2));
        else play.textContent = "Play";
        meta.append(play);
      }
      if (c.summary) oc.stext(node, excerpt(c.summary), { cls: "lto-card-text", scale: 2, color: PX.ink });
      if (!playable) {
        oc.stext(node, "This file has problems and cannot be played yet:", { cls: "lto-card-badhead", scale: 2, weight: "bold", color: PX.bad });
        const probs = el("div", "lto-problems");
        probs.dataset.ltoProblems = "";
        probs.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0";
        node.append(probs);
        for (const line of problemLines(c.problems)) oc.stext(probs, /^and \d+ more$/.test(line) ? line : `- ${line}`, { cls: "lto-card-bad", scale: 2, color: PX.bad });
      }
    }

    function roomCard(grid: HTMLElement, r: StartRoom): void {
      const node = el("button", "lto-card is-compact");
      node.type = "button";
      node.dataset.ltoRoom = r.id;
      node.dataset.scrKey = `room:${r.id}`;
      node.dataset.scrNav = "";
      node.setAttribute("aria-label", r.summary ? `${r.title}. ${r.summary}` : r.title);
      node.addEventListener("click", () => {
        if (!busy()) sopts.onPick(r.id);
      });
      if (busy()) node.setAttribute("aria-disabled", "true");
      grid.append(node);
      if (oc.isPixel()) oc.frame(node, "win", true);
      else node.classList.add("lto-plate");
      oc.stext(node, r.title, { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.ink });
      if (r.summary) oc.stext(node, r.summary, { cls: "lto-card-text", scale: 2, color: PX.ink });
    }

    function aiCard(parent: HTMLElement): void {
      writeBtn = null;
      if (stage === "closed") {
        const node = el("button", "lto-card");
        node.type = "button";
        node.dataset.ltoAi = "";
        node.dataset.scrKey = "ai";
        node.dataset.scrNav = "";
        node.setAttribute("aria-label", "Write a new adventure with AI. Describe an idea and the AI writes one for you. Optional.");
        node.addEventListener("click", () => step("open"));
        parent.append(node);
        if (oc.isPixel()) oc.frame(node, "blue", true);
        else node.classList.add("lto-plate");
        oc.stext(node, "Write a new adventure with AI", { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.ink });
        oc.stext(node, "Describe an idea and the AI writes one for you. Optional.", { cls: "lto-card-quiet", scale: 2, color: PX.muted });
        return;
      }
      const node = el("div", "lto-card");
      node.dataset.ltoAi = "";
      node.dataset.stage = stage;
      node.tabIndex = -1;
      node.setAttribute("role", "group");
      node.setAttribute("aria-label", "Write a new adventure with AI");
      node.dataset.scrKey = "ai";
      parent.append(node);
      if (oc.isPixel()) oc.frame(node, "blue", true);
      else node.classList.add("lto-plate");
      oc.stext(node, "Write a new adventure with AI", { cls: "lto-card-title", scale: 2, weight: "bold", color: PX.ink });
      oc.stext(node, sopts.aiNote, { cls: "lto-card-text", scale: 2, color: PX.ink }).dataset.ltoCost = "";
      oc.stext(node, "What is the adventure about?", { cls: "lto-card-quiet", scale: 2, weight: "bold", color: PX.muted });
      ta.disabled = busy();
      ta.classList.toggle("lto-fr", oc.isPixel());
      ta.classList.toggle("fs1", oc.isPixel());
      ta.classList.toggle("fr-win", oc.isPixel());
      node.append(ta);
      if (stage === "confirm") {
        const q = oc.stext(node, "Start writing now?", { cls: "lto-card-ask", scale: 2, weight: "bold", color: PX.gold });
        q.dataset.ltoConfirm = "";
      } else if (stage === "form" && writeProblems.length > 0) {
        oc.stext(node, "No adventure was made. Why:", { cls: "lto-card-badhead", scale: 2, weight: "bold", color: PX.bad }).dataset.ltoWriteFailed = "";
        const probs = el("div", "lto-problems");
        probs.dataset.ltoWriteProblems = "";
        probs.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0";
        node.append(probs);
        for (const line of problemLines(writeProblems)) oc.stext(probs, /^and \d+ more$/.test(line) ? line : `- ${line}`, { cls: "lto-card-bad", scale: 2, color: PX.bad });
      } else if (stage === "writing") {
        const prog = el("div", "lto-wprog");
        prog.dataset.ltoWriting = "";
        prog.setAttribute("role", "status");
        prog.setAttribute("aria-live", "polite");
        const dots = el("span", "lto-wdots");
        dots.setAttribute("aria-hidden", "true");
        dots.append(el("i"), el("i"), el("i"));
        node.append(prog);
        prog.append(dots);
        oc.stext(prog, cancelling ? "Cancelling" : writingLine(writing?.stage), { cls: "lto-card-ask", scale: 2, weight: "bold", color: PX.gold, slack: 30 });
      }
      const row = el("div", "lto-scr-actions is-start");
      node.append(row);
      if (stage === "form") {
        writeBtn = oc.sbtn(row, "Write it", "write", true);
        writeBtn.dataset.ltoWrite = "";
        writeBtn.addEventListener("click", () => step("write"));
        sync();
        oc.sbtn(row, "Cancel", "back").addEventListener("click", () => step("back"));
      } else if (stage === "confirm") {
        const yes = oc.sbtn(row, "Yes, write it", "yes", true);
        yes.dataset.ltoYes = "";
        yes.addEventListener("click", () => step("yes"));
        oc.sbtn(row, "Not yet", "back").addEventListener("click", () => step("back"));
      } else if (writing?.canCancel) {
        const cancel = oc.sbtn(row, "Cancel", "cancel");
        cancel.dataset.ltoCancel = "";
        cancel.disabled = cancelling;
        cancel.addEventListener("click", () => {
          if (cancelling) return;
          cancelling = true;
          s.rebuild();
          cancelFn?.();
        });
      }
    }

    /** Bring the AI card into view: all of it when it fits the screen (so its buttons show), else down to what has the focus. */
    function reveal(card: HTMLElement | undefined, focused: HTMLElement | undefined): void {
      if (!card) return;
      const sr = s.scroll.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      if (cr.height + 12 <= sr.height) {
        if (cr.bottom > sr.bottom - 8) s.scroll.scrollTop += cr.bottom - sr.bottom + 12;
        else if (cr.top < sr.top) s.scroll.scrollTop -= sr.top - cr.top + 8;
      } else focused?.scrollIntoView({ block: "nearest" });
    }

    function pick(key: string): HTMLElement | undefined {
      return Array.from(s.node.querySelectorAll<HTMLElement>("[data-scr-key]")).find((n) => n.dataset.scrKey === key);
    }

    function step(ev: WriteEvent): void {
      if (s.closed) return;
      const r = nextWriteStage(stage, ev, ta.value);
      const was = stage;
      stage = r.stage;
      // A new try, or stepping out of the form, drops what the last try said.
      if (r.fire || stage !== "form") writeProblems = [];
      if (r.fire) sopts.onWrite(ta.value.trim());
      if (stage === was) return;
      s.rebuild();
      const target = stage === "form" ? pick("premise") : stage === "confirm" ? pick("back") : stage === "closed" ? pick("ai") : (pick("cancel") ?? pick("ai"));
      target?.focus({ preventScroll: true });
      reveal(pick("ai"), target);
    }

    // The first focus: the first card.
    queueMicrotask(() => {
      if (s.closed) return;
      s.node.querySelector<HTMLElement>("[data-scr-nav]")?.focus({ preventScroll: true });
    });

    return {
      close: () => oc.closeScreen(s),
      setWriting(state: StartWriting | null, onCancel?: () => void): void {
        if (s.closed) return;
        writing = state;
        if (state) writeProblems = [];
        cancelFn = onCancel;
        cancelling = false;
        const was = stage;
        stage = nextWriteStage(stage, state ? "busy" : "idle", ta.value).stage;
        s.rebuild();
        if (stage !== was && stage === "form") ta.focus({ preventScroll: true });
      },
      setNote(text: string): void {
        if (s.closed) return;
        note = tidy(text);
        s.rebuild();
        s.scroll.scrollTop = 0;
      },
      setProblems(lines: readonly string[] | null): void {
        if (s.closed) return;
        writeProblems = lines ? lines.map(tidy).filter(Boolean) : [];
        s.rebuild();
        if (writeProblems.length > 0) reveal(pick("ai"), pick("premise"));
      },
    };
  }

  // What the other modules call or read.
  oc.startScreen = startScreen;
}
