/**
 * The HUD's notices: small notes under the drawer buttons that fade.
 */
import { el } from "./domKit";
import { NOTICE_OUT_MS, NOTICE_MS, noticeOverflow } from "./hudHelpers";
import type { HudCtx } from "./hudCtx";

  // ---- notices: small notes that fade (loot, mostly)

  export interface Notice {
    node: HTMLElement;
    text: string;
    tone: "good" | "bad" | "plain";
    lease: number;
    timer: number;
    fade: Animation | null;
  }

export function installHudNotices(hc: HudCtx): void {
  const notices: Notice[] = [];

  function fillNotice(n: Notice): void {
    // A note is a chip that sizes to its words, so it wraps only at the column's width less its frame (inset -28 undoes the 44 the panel keeps).
    n.node.replaceChildren(hc.text(n.text, "line", -28, n.tone === "plain" ? undefined : n.tone));
    n.node.classList.remove("lto-fr", "fr-win", "fs1", "lto-plate");
    if (hc.isPixel()) n.node.classList.add("lto-fr", "fr-win", "fs1");
    else n.node.classList.add("lto-plate");
  }

  function dropNotice(n: Notice): void {
    window.clearTimeout(n.timer);
    n.fade?.cancel();
    n.node.remove();
    const at = notices.indexOf(n);
    if (at >= 0) notices.splice(at, 1);
    hc.noticeBox.hidden = notices.length === 0;
  }

  function armNotice(n: Notice): void {
    const lease = ++n.lease;
    window.clearTimeout(n.timer);
    n.timer = window.setTimeout(() => {
      if (hc.destroyed || n.lease !== lease || !notices.includes(n)) return;
      const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof n.node.animate !== "function") return dropNotice(n);
      n.fade = n.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: still ? 120 : NOTICE_OUT_MS, fill: "forwards" });
      n.fade.finished.then(
        () => {
          if (n.lease === lease) dropNotice(n);
        },
        () => {},
      );
    }, NOTICE_MS);
  }

  function noticeNow(words: string, tone: "good" | "bad" | "plain" = "plain"): void {
    const said = words.replace(/\s+/g, " ").trim();
    if (hc.destroyed || !said) return;
    const again = notices.find((n) => n.text === said && n.tone === tone);
    if (again) {
      // The same note again: keep the one showing and give it a fresh stay (a fade already running is stopped).
      again.fade?.cancel();
      again.fade = null;
      armNotice(again);
      return;
    }
    for (let i = noticeOverflow(notices.length); i > 0 && notices[0]; i--) dropNotice(notices[0]);
    const node = el("div", "lto-hud-notice");
    node.dataset.hudNotice = "";
    node.dataset.tone = tone;
    node.dataset.text = said;
    const n: Notice = { node, text: said, tone, lease: 0, timer: 0, fade: null };
    fillNotice(n);
    notices.push(n);
    hc.noticeBox.append(node);
    hc.noticeBox.hidden = false;
    armNotice(n);
  }

  // What the other modules call or read.
  hc.notices = notices;
  hc.fillNotice = fillNotice;
  hc.dropNotice = dropNotice;
  hc.noticeNow = noticeNow;
}
