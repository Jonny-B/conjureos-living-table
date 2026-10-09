/**
 * The dialogue box: draws the queue, runs the typewriter clock, and answers presses; also the DM narration handle.
 */
import { CELL_H, LINE_GAP, cssScale, normalizeText, textWidth, wrapWidth } from "./pixelFont";
import type { TextSpeed, DialogueLine, NarrationHandle } from "./overlayTypes";
import { el, FRAMES, deviceRatio, spriteCanvas, CARET_DOWN, ctxWidth, DIALOGUE_FONT } from "./domKit";
import { PX, NARRATION_TAG_MAX, DIALOGUE_IN_MS, DIALOGUE_OUT_MS, DOCK_BOTTOM_PX, DOCK_GAP_PX } from "./overlayTheme";
import { stripHoldMs, dialogueBoxPx } from "./overlayMath";
import type { DialogueQueue } from "./dialogueQueue";
import { DEFAULT_TEXT_SPEED, dialogueLines, dialoguePages, createDialogueQueue, textSpeedOf } from "./dialogueQueue";
import type { OverlayCtx } from "./overlayCtx";

export function installDialogue(oc: OverlayCtx): void {
  // ---- dialogue: the one box for story text. The queue is createDialogueQueue (pure); this draws it and runs its clock.

  /** The width of a storybook line is kept this much under the box, so a font that measures a hair wider never wraps in the browser. */
  const DIALOGUE_SAFETY_PX = 8;
  /** What the box drew last, so a frame that changes nothing touches nothing. */
  oc.drawnLook = "";
  let lastLook = "";
  oc.drawnPage = "";
  oc.drawnShown = -1;
  oc.drawnMore = null;
  oc.lineNodes = [];
  oc.fade = null;
  oc.dlgPaused = false;
  oc.dmCancel = null;
  let loopId = 0;
  let loopLast = 0;
  let textSpeed: TextSpeed = DEFAULT_TEXT_SPEED;
  let roomKey = "";
  let roomPx = 0;

  function frameDialogue(box: HTMLElement = oc.dlgBox): void {
    box.classList.remove("lto-fr", "fr-win", "fs1", "lto-plate");
    if (oc.isPixel()) oc.frame(box, "win", oc.tier === "s");
    else box.classList.add("lto-plate");
  }

  /** The width the box's text has, in CSS px, measured from the box itself (shown unseen for a moment when it is hidden). */
  function dialogueRoom(): number {
    const key = `${oc.root.clientWidth}|${oc.style}|${oc.tier}|${deviceRatio()}`;
    if (key === roomKey && roomPx > 0) return roomPx;
    const wasHidden = oc.dlg.hidden;
    if (wasHidden) {
      oc.dlg.style.visibility = "hidden";
      oc.dlg.hidden = false;
    }
    frameDialogue();
    const w = oc.dlgBody.clientWidth;
    if (wasHidden) {
      oc.dlg.hidden = true;
      oc.dlg.style.visibility = "";
    }
    if (w <= 24) return Math.max(80, (oc.root.clientWidth || oc.width) - 16 - 44);
    roomKey = key;
    roomPx = w;
    return roomPx;
  }

  /** An entry's text as pages of lines that fit the box in the current text style and board width (see dialoguePages). */
  function dialogueLayout(text: string): string[][] {
    const per = dialogueLines(oc.tier);
    const room = dialogueRoom();
    if (oc.isPixel()) {
      const ratio = deviceRatio();
      return dialoguePages(normalizeText(text), (s) => textWidth(s), wrapWidth(room - 2 * cssScale(2, ratio), 2, ratio), per);
    }
    return dialoguePages(text, (s) => ctxWidth(s, DIALOGUE_FONT, 7.6), room - DIALOGUE_SAFETY_PX, per);
  }

  const dq: DialogueQueue = createDialogueQueue({ layout: dialogueLayout, reading: (chars) => stripHoldMs(chars, oc.reduced()) });

  function renderDialogueTag(speaker: string, tag: HTMLElement = oc.dlgTag, more: HTMLElement = oc.dlgMore): void {
    const label = speaker.length > NARRATION_TAG_MAX ? `${speaker.slice(0, NARRATION_TAG_MAX - 1)}.` : speaker;
    tag.classList.remove("lto-fr", "fr-gold", "fs1");
    tag.replaceChildren();
    if (oc.isPixel()) {
      oc.frame(tag, "gold", true);
      tag.append(oc.px(label.toUpperCase(), { scale: 2, weight: "bold", color: PX.gold, shadow: PX.shade }));
    } else {
      tag.textContent = label;
    }
    more.replaceChildren();
    if (oc.isPixel()) more.append(spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.gold.L }, 2));
  }

  /** The height of one text row in the box, in px (pixel text is a whole number of device pixels a font pixel; storybook is 1.45 times its 15.5 px). */
  function dialogueRowPx(): number {
    return oc.isPixel() ? (CELL_H + LINE_GAP) * cssScale(2, deviceRatio()) : 15.5 * 1.45;
  }

  /**
   * The room the box takes at its fullest, published as --lto-dock (px) on the host: the board keeps clear of this band at its foot, so
   * the DM's words never cover the hero and the board never jumps as the box comes and goes. It is worked out from a copy of the box
   * with every row it can hold, so it follows the real frame, tag and type of the current style and size.
   */
  function publishDock(): void {
    if (oc.destroyed || !oc.root.clientHeight) return;
    const probe = el("div", "lto-dlg");
    probe.style.cssText = "visibility:hidden;pointer-events:none";
    const tag = el("div", "lto-dlg-tag");
    const box = el("div", "lto-dlg-box");
    const body = el("div", "lto-dlg-body");
    const more = el("span", "lto-dlg-more");
    box.append(body, more);
    probe.append(tag, box);
    oc.bottom.append(probe);
    frameDialogue(box);
    renderDialogueTag("DM", tag, more);
    // With no rows in it the copy is just the frame and the tag: that is the chrome; the rows are added by arithmetic.
    body.style.height = "0px";
    const chrome = probe.offsetHeight;
    probe.remove();
    if (chrome <= 0) return;
    const px = dialogueBoxPx({ lines: dialogueLines(oc.tier), row: dialogueRowPx(), chrome }) + DOCK_BOTTOM_PX + DOCK_GAP_PX;
    oc.host.style.setProperty("--lto-dock", `${px}px`);
  }

  /** The small Cancel button beside the dots: it takes the wait back, and says nothing of money. */
  function cancelButton(): HTMLButtonElement {
    const b = el("button", "lto-btn lto-dlg-cancel");
    b.type = "button";
    b.dataset.ltoCancel = "";
    b.setAttribute("aria-label", "Cancel");
    b.title = "Cancel (Esc)";
    if (oc.isPixel()) {
      b.classList.add("lto-fr", "fs1", "fr-win");
      b.append(oc.px("Cancel", { scale: 2, weight: "bold", color: PX.ink, outline: PX.dark }));
    } else {
      b.append(el("span", undefined, "Cancel"));
    }
    // The box itself takes a press to turn its page; this button is not that.
    for (const type of ["pointerdown", "mousedown", "click"]) b.addEventListener(type, (e) => e.stopPropagation());
    b.addEventListener("click", () => oc.dmCancel?.());
    return b;
  }

  /** Draw the entry on show: its tag, the part of its page printed so far, and the "more" marker. Does nothing when there is none. */
  function renderDialogue(): void {
    const v = dq.view();
    if (!v || oc.destroyed) return;
    if (oc.fade) {
      oc.fade.cancel();
      oc.fade = null;
    }
    const appearing = oc.dlg.hidden;
    oc.dlg.hidden = false;
    const pixel = oc.isPixel();
    const look = `${oc.style}|${oc.tier}|${deviceRatio()}|${v.id}|${v.speaker}`;
    if (look !== oc.drawnLook) {
      oc.drawnLook = look;
      frameDialogue();
      renderDialogueTag(v.speaker);
      oc.drawnPage = "";
      oc.drawnMore = null;
    }
    const lines = v.pages[v.page] ?? [];
    let reflow = appearing || look !== lastLook;
    lastLook = look;
    oc.dlgBody.dataset.tone = v.tone;
    if (v.thinking) {
      // Cancel stands beside the dots only while the DM has not said a word of its reply.
      const cancelable = oc.dmCancel !== null && v.text === "" && v.open;
      const sig = cancelable ? "dots+cancel" : "dots";
      if (oc.drawnPage !== sig) {
        const dots = el("span", "lto-dlg-dots");
        dots.setAttribute("role", "img");
        dots.setAttribute("aria-label", `${v.speaker} is thinking`);
        dots.append(el("i"), el("i"), el("i"));
        if (cancelable) {
          const wait = el("div", "lto-dlg-wait");
          wait.append(dots, cancelButton());
          oc.dlgBody.replaceChildren(wait);
        } else oc.dlgBody.replaceChildren(dots);
        oc.dlgBody.style.height = "";
        oc.lineNodes = [];
        oc.drawnPage = sig;
        oc.drawnShown = -1;
        reflow = true;
      }
    } else {
      const pageSig = `${v.id}|${v.page}|${v.tone}|${lines.join("\n")}`;
      const samePage = oc.drawnPage === pageSig;
      if (!samePage) reflow = true;
      if (pixel) {
        const ratio = deviceRatio();
        const row = (CELL_H + LINE_GAP) * cssScale(2, ratio);
        oc.dlgBody.style.height = `${lines.length * row}px`;
        if (!samePage || oc.drawnShown !== v.shown) {
          const part = lines.join("\n").slice(0, v.shown);
          const colour = v.tone === "good" ? PX.good : v.tone === "bad" ? PX.bad : PX.ink;
          oc.dlgBody.replaceChildren(...(part === "" ? [] : [oc.px(part, { scale: 2, color: colour, shadow: PX.shade })]));
        }
      } else {
        if (!samePage || oc.lineNodes.length !== lines.length) {
          oc.dlgBody.replaceChildren();
          oc.lineNodes = lines.map(() => {
            const d = el("div", "lto-dlg-line");
            oc.dlgBody.append(d);
            return d;
          });
          oc.dlgBody.style.height = `${lines.length * 1.45}em`;
        }
        if (!samePage || oc.drawnShown !== v.shown) {
          let left = v.shown;
          lines.forEach((l, i) => {
            const node = oc.lineNodes[i];
            if (node) node.textContent = l.slice(0, Math.max(0, left));
            left -= l.length + 1;
          });
        }
      }
      oc.drawnPage = pageSig;
      oc.drawnShown = v.shown;
    }
    if (oc.drawnMore !== v.more) {
      oc.drawnMore = v.more;
      oc.dlgMore.hidden = !v.more;
    }
    oc.dlg.dataset.speaker = v.speaker;
    oc.dlg.dataset.text = v.text;
    oc.dlg.dataset.tone = v.tone;
    oc.dlg.dataset.page = String(v.page + 1);
    oc.dlg.dataset.pages = String(Math.max(1, v.pages.length));
    oc.dlg.dataset.queued = String(v.queued);
    oc.dlg.dataset.shown = String(v.shown);
    oc.dlg.dataset.complete = String(v.complete);
    oc.dlg.dataset.thinking = String(v.thinking);
    oc.dlg.dataset.more = String(v.more);
    const hint = !v.complete ? "click to show all of it" : v.more ? "click for more" : v.open ? "" : "click to close";
    oc.dlg.title = hint ? hint.charAt(0).toUpperCase() + hint.slice(1) : "";
    oc.dlg.setAttribute("aria-label", hint ? `${v.speaker}, ${hint}` : v.speaker);
    if (appearing && !oc.reduced() && typeof oc.dlg.animate === "function") {
      void oc.play(oc.dlg, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], DIALOGUE_IN_MS, "ease-out");
    }
    if (reflow) oc.layoutLoot();
  }

  /** The box goes: a short fade, then hidden (unless a newer entry arrived meanwhile and took it back). */
  function fadeOutDialogue(): void {
    if (oc.destroyed || oc.dlg.hidden) return;
    const a = oc.start(oc.dlg, [{ opacity: 1 }, { opacity: 0 }], oc.reduced() ? 120 : DIALOGUE_OUT_MS, "ease-in");
    oc.fade = a.anim;
    void a.done.then(() => {
      if (oc.destroyed || oc.fade !== a.anim) return;
      oc.fade = null;
      if (dq.view()) return;
      oc.dlg.hidden = true;
      oc.drawnLook = "";
      oc.layoutLoot();
    });
  }

  function cancelLoop(): void {
    if (loopId === 0) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(loopId);
    window.clearTimeout(loopId);
    loopId = 0;
  }

  /** The typewriter's clock: one frame at a time while a box is up. */
  function loopStep(now: number): void {
    loopId = 0;
    if (oc.destroyed) return;
    if (oc.dlgPaused) return;
    const dt = Math.min(250, Math.max(0, now - loopLast));
    loopLast = now;
    const r = dq.tick(dt);
    if (r.closed) {
      fadeOutDialogue();
      return;
    }
    if (r.changed) renderDialogue();
    if (dq.needsTick()) loopId = typeof requestAnimationFrame === "function" ? requestAnimationFrame(loopStep) : window.setTimeout(() => loopStep(performance.now()), 33);
  }

  /** Run the clock if there is something for it to do (it stops by itself while a box only waits for a click). */
  function runClock(): void {
    if (loopId !== 0 || oc.dlgPaused || !dq.needsTick()) return;
    loopLast = performance.now();
    loopId = typeof requestAnimationFrame === "function" ? requestAnimationFrame(loopStep) : window.setTimeout(() => loopStep(performance.now()), 33);
  }

  /** After the queue changed: draw what is on show now and keep the clock running (or fade the box when nothing is left). */
  function afterQueueChange(): void {
    if (oc.destroyed) return;
    dq.setSpeed(oc.reduced() ? "instant" : textSpeed);
    if (!dq.view()) {
      cancelLoop();
      fadeOutDialogue();
      return;
    }
    renderDialogue();
    runClock();
  }

  /** Cut the pages again for the board as it is now (a resize, another text style), keeping the reader's place. */
  function relayoutDialogue(): void {
    roomKey = "";
    oc.drawnLook = "";
    publishDock();
    dq.relayout();
    if (dq.view()) renderDialogue();
    runClock();
  }

  /** A press on the box: finish the page, or the next page, or the next entry, or close. False when there is no box to press. */
  function pressDialogue(): boolean {
    if (oc.destroyed || !dq.view()) return false;
    const r = dq.press();
    if (r === "close") {
      cancelLoop();
      fadeOutDialogue();
    } else afterQueueChange();
    return true;
  }

  function say(line: DialogueLine): void {
    if (oc.destroyed) return;
    const id = dq.push({ speaker: line.speaker, text: line.text, tone: line.tone, sticky: line.sticky, repeat: line.repeat });
    if (id === null) return;
    oc.announce(line.speaker ? `${line.speaker}: ${line.text}` : line.text);
    afterQueueChange();
  }

  function dismissStory(opts: { stickyOnly?: boolean } = {}): void {
    if (oc.destroyed) return;
    if (dq.dismiss(opts) > 0) afterQueueChange();
  }

  function setTextSpeed(next: TextSpeed): void {
    textSpeed = textSpeedOf(next);
    dq.setSpeed(oc.reduced() ? "instant" : textSpeed);
  }

  // A click (or Enter or Space on the focused box) is a press; Escape sends the whole box away. The board's own keys never see those presses.
  oc.dlg.addEventListener("click", () => void pressDialogue());
  oc.dlg.addEventListener("keydown", (e) => {
    // A button in the box (Cancel) keeps its own Enter and Space.
    if (e.target instanceof HTMLButtonElement) return;
    if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") dismissStory();
    else pressDialogue();
  });

  /** A DM narration entry: "..." until its text starts, then the typewriter follows the stream. See NarrationHandle. */
  function narrate(opts: { speaker?: string; text: string; full?: boolean }): NarrationHandle {
    const dead: NarrationHandle = { update() {}, done() {}, close() {}, setSpeaker() {} };
    if (oc.destroyed) return dead;
    let text = opts.text ?? "";
    let speaker = opts.speaker?.trim() || "DM";
    const id = dq.push({ speaker, text, open: true });
    if (id === null) return dead;
    let finished = false;
    afterQueueChange();
    return {
      update(t: string): void {
        if (finished) return;
        text = t;
        dq.setText(id, t);
        afterQueueChange();
      },
      done(): void {
        if (finished) return;
        finished = true;
        dq.finish(id);
        if (text.trim() !== "" && !oc.destroyed) oc.announce(`${speaker}: ${text}`);
        afterQueueChange();
      },
      close(): void {
        finished = true;
        dq.drop(id);
        afterQueueChange();
      },
      setSpeaker(name: string): void {
        speaker = name.trim() || "DM";
        dq.setSpeaker(id, speaker);
        afterQueueChange();
      },
    };
  }

  /** The story screen covers the box: its clock stops (a reply is not read out unseen) and starts again where it was when the story is over. */
  function pauseDialogue(paused: boolean): void {
    if (oc.destroyed || oc.dlgPaused === paused) return;
    oc.dlgPaused = paused;
    if (paused) {
      cancelLoop();
      return;
    }
    if (dq.view()) renderDialogue();
    runClock();
  }

  /** Give the DM box its Cancel button (or take it away with null). */
  function onDmCancel(handler: (() => void) | null): void {
    oc.dmCancel = handler;
    if (oc.destroyed || !dq.view()) return;
    oc.drawnPage = "";
    renderDialogue();
  }

  // What the other modules call or read.
  oc.dq = dq;
  oc.pauseDialogue = pauseDialogue;
  oc.onDmCancel = onDmCancel;
  oc.publishDock = publishDock;
  oc.cancelLoop = cancelLoop;
  oc.relayoutDialogue = relayoutDialogue;
  oc.pressDialogue = pressDialogue;
  oc.say = say;
  oc.dismissStory = dismissStory;
  oc.setTextSpeed = setTextSpeed;
  oc.narrate = narrate;
}
