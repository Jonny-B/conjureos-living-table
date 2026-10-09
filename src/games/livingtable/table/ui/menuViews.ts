/**
 * The views the HUD's drawer and the in-game menu share: Settings, Journal, Log and Saves.
 *
 * Each builder takes a kit (the look in use, a text helper, the bitmap text helper and where a press goes) so the same markup serves the
 * drawer beside the board (createHud, kept for the asset bench) and the menu that opens inside the game space (gameMenu.ts). The class
 * names are the HUD's own (`lto-hud-*`), so one stylesheet (hudStyle.ts) draws both. Import-pure: nothing touches the document until a
 * builder is called.
 */
import { pixelText, type PixelColor, type PixelTextOptions } from "./pixelFont";
import type { TextStyle } from "./overlayTypes";
import type { HudJournal, HudLogLine, HudSave, HudSettings } from "./hudTypes";
import { deviceRatio, el, spriteCanvas, svgEl } from "./domKit";
import { PX } from "./overlayTheme";
import {
  BOX_DONE_ROWS,
  BOX_ROWS,
  CHECK_PATH,
  SETTING_CHOICES,
  journalObjectives,
  journalProgress,
  journalRecent,
  logWindow,
  settingValue,
  type HudTone,
} from "./hudHelpers";

export type TextKind = "title" | "line" | "name" | "num" | "seclabel" | "item";

/** What a shared view needs from the surface it is drawn on. */
export interface ViewKit {
  /** The look in use. */
  style(): TextStyle;
  /** A line of text in the current treatment, with the words kept for screen readers. */
  text(words: string, kind: TextKind, inset?: number, tone?: HudTone): HTMLElement;
  /** A line of bitmap text (the pixel look only). */
  px(text: string, o: PixelTextOptions): HTMLCanvasElement;
  /** A press: the HUD's action ids ("set:textSpeed:fast", "load:<id>", "export", "export-copy"). */
  onAction(id: string): void;
  /** The width of the surface, in CSS px, for sizing bitmap text. */
  width(): number;
}

const TONE_COLOUR: Record<HudTone, PixelColor> = { good: PX.good, bad: PX.bad, dm: PX.gold };

/**
 * The text helpers of a surface: bitmap text in the pixel look, plain text in storybook. `width` is the room a line has before its
 * inset is taken off (font pixels are 2 CSS px). `name` shortens a name that has to stay on one line.
 */
export function createTextKit(opts: { style: () => TextStyle; width: () => number; name?: (words: string) => string }): Pick<ViewKit, "text" | "px"> {
  const px = (text: string, o: PixelTextOptions): HTMLCanvasElement => {
    const c = pixelText(text, { dpr: deviceRatio(), ...o });
    c.setAttribute("aria-hidden", "true");
    return c;
  };
  const text = (words: string, kind: TextKind, inset = 0, tone?: HudTone): HTMLElement => {
    const node = el("span", `lto-hud-${kind}`);
    if (tone) node.classList.add(`lto-hud-tone-${tone}`);
    if (opts.style() === "pixel") {
      const gold = kind === "title" || kind === "seclabel";
      const colour = tone ? TONE_COLOUR[tone] : gold ? PX.gold : kind === "line" ? PX.muted : PX.ink;
      // Titles, lines and items wrap to the surface; names and numbers stay on one line.
      const wrap = kind === "name" || kind === "num" ? undefined : Math.max(40, Math.floor((opts.width() - inset) / 2));
      const shown = kind === "name" && opts.name ? opts.name(words) : words;
      node.append(px(shown, { scale: 2, weight: gold || kind === "num" ? "bold" : "regular", color: colour, outline: PX.dark, maxWidth: wrap }), el("span", "lto-sr", words));
    } else {
      node.textContent = words;
    }
    return node;
  };
  return { text, px };
}

/** The Settings view: a heading and a row of choices for each setting, the one in use pressed. Each press goes to onAction("set:<key>:<value>"). */
export function settingsView(kit: ViewKit, cur: HudSettings): HTMLElement {
  const pixel = kit.style() === "pixel";
  const wrap = el("div", "lto-hud-settingsview");
  wrap.dataset.hudSettingsView = "";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Settings");
  for (const g of SETTING_CHOICES) {
    const box = el("div", "lto-hud-setting");
    box.dataset.setting = g.key;
    box.append(kit.text(g.label, "seclabel"));
    const row = el("div", "lto-hud-choices");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", g.label);
    const now = settingValue(cur, g.key);
    for (const c of g.choices) {
      const on = c.value === now;
      const btn = el("button", "lto-hud-btn lto-hud-choice");
      btn.type = "button";
      btn.dataset.settingChoice = `${g.key}:${c.value}`;
      btn.dataset.settingValue = c.value;
      btn.setAttribute("aria-label", `${g.label}: ${c.label}`);
      btn.setAttribute("aria-pressed", String(on));
      if (pixel) {
        btn.classList.add("lto-fr", "fs1", on ? "fr-gold" : "fr-win");
        btn.append(kit.px(c.label, { scale: 2, weight: "bold", color: on ? PX.gold : PX.ink, outline: PX.dark }));
      } else {
        btn.append(el("span", undefined, c.label));
        if (on) btn.classList.add("is-open");
      }
      btn.onclick = () => kit.onAction(`set:${g.key}:${c.value}`);
      row.append(btn);
    }
    box.append(row);
    wrap.append(box);
  }
  return wrap;
}

/** The journal: the adventure and scene, the objectives with their ticks, and the last few beats (newest first). */
export function journalView(kit: ViewKit, j: HudJournal, prevScroll: number): HTMLElement {
  const pixel = kit.style() === "pixel";
  const wrap = el("div", "lto-hud-journalview");
  wrap.dataset.hudJournalView = "";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Journal");
  const list = el("div", "lto-hud-pack-list lto-hud-list lto-hud-journal");
  list.dataset.tab = "journal";
  const row = (node: HTMLElement): HTMLElement => {
    const r = el("div", "lto-hud-row");
    r.append(node);
    return r;
  };
  const story = el("div", "lto-hud-sec");
  story.dataset.section = "Story";
  story.append(row(kit.text(j.title, "seclabel", 18)));
  if (j.scene.trim()) {
    const scene = row(kit.text(`Scene: ${j.scene.trim()}`, "item", 18));
    scene.dataset.journalScene = "";
    story.append(scene);
  }
  list.append(story);
  const objs = journalObjectives(j.objectives);
  const sec = el("div", "lto-hud-sec");
  sec.dataset.section = "Objectives";
  const progress = journalProgress(j.objectives);
  sec.append(row(kit.text("Objectives", "seclabel", 18)));
  if (progress) {
    const pr = row(kit.text(progress, "line", 18));
    pr.dataset.journalProgress = progress;
    sec.append(pr);
  }
  if (objs.length === 0) sec.append(row(kit.text("Nothing to do yet.", "line", 18)));
  for (const o of objs) {
    const r = el("div", "lto-hud-obj");
    r.dataset.objective = o.text;
    r.dataset.done = String(o.done);
    const box = el("span", "lto-hud-box");
    box.setAttribute("aria-hidden", "true");
    if (pixel) {
      box.append(spriteCanvas(o.done ? BOX_DONE_ROWS : BOX_ROWS, { M: "#98a5d8", L: "#e6dcb4", G: "#2f9e55", W: "#ffffff" }, 2));
    } else if (o.done) {
      box.classList.add("is-done");
      const svg = svgEl("svg", { viewBox: "0 0 448 512", "aria-hidden": "true", focusable: "false" });
      svg.append(svgEl("path", { d: CHECK_PATH }));
      box.append(svg);
    }
    const words = kit.text(o.text, "item", 18 + 26, o.done ? "good" : undefined);
    r.append(box, words, el("span", "lto-sr", o.done ? " (done)" : " (not done)"));
    sec.append(r);
  }
  list.append(sec);
  const beats = journalRecent(j.recent);
  if (beats.length > 0) {
    const lately = el("div", "lto-hud-sec");
    lately.dataset.section = "Lately";
    lately.append(row(kit.text("Lately", "seclabel", 18)));
    for (const b of beats) {
      const r = el("div", "lto-hud-beat");
      r.dataset.beat = b;
      r.append(kit.text(b, "line", 18));
      lately.append(r);
    }
    list.append(lately);
  }
  wrap.append(list);
  queueMicrotask(() => {
    list.scrollTop = prevScroll;
  });
  return wrap;
}

/** The log: every line so far, the newest at the bottom, kept at the bottom unless the reader has scrolled up. */
export function logView(kit: ViewKit, log: readonly HudLogLine[], keep: { sameTab: boolean; scroll: number; atBottom: boolean }): HTMLElement {
  const wrap = el("div", "lto-hud-logview");
  wrap.dataset.hudLogView = "";
  const list = el("div", "lto-hud-pack-list lto-hud-list lto-hud-log");
  list.dataset.tab = "log";
  list.setAttribute("role", "list");
  const { shown, hidden } = logWindow(log);
  if (hidden > 0) {
    const row = el("div", "lto-hud-logrow");
    row.append(kit.text(`${hidden} older lines are not shown.`, "line", 18));
    list.append(row);
  }
  if (shown.length === 0) {
    const row = el("div", "lto-hud-logrow");
    row.append(kit.text("Nothing has happened yet.", "line", 18));
    list.append(row);
  }
  for (const l of shown) {
    const tone = l.tone ?? "plain";
    const row = el("div", "lto-hud-logrow");
    row.setAttribute("role", "listitem");
    row.dataset.tone = tone;
    row.append(kit.text(l.text, "item", 18, tone === "plain" ? undefined : tone));
    list.append(row);
  }
  wrap.append(list);
  queueMicrotask(() => {
    list.scrollTop = keep.sameTab && !keep.atBottom ? keep.scroll : list.scrollHeight;
  });
  return wrap;
}

/** The save points, each with a Load button (greyed where it cannot be loaded), or the empty-state line; under them the export row. */
export function savesView(kit: ViewKit, saves: readonly HudSave[], prevScroll: number, exp: { status?: string; copy?: boolean }): HTMLElement {
  const pixel = kit.style() === "pixel";
  const wrap = el("div", "lto-hud-savesview");
  wrap.dataset.hudSavesView = "";
  const list = el("div", "lto-hud-pack-list lto-hud-list lto-hud-saves");
  list.dataset.tab = "saves";
  if (saves.length === 0) {
    const row = el("div", "lto-hud-logrow");
    row.append(kit.text("No saves yet. Rest to save, and every scene start is a checkpoint.", "line", 18));
    list.append(row);
  }
  for (const sv of saves) {
    const row = el("div", "lto-hud-save");
    row.dataset.saveRow = sv.id;
    const info = el("div", "lto-hud-save-info");
    info.append(kit.text(sv.label, "item", 100));
    if (sv.detail) info.append(kit.text(sv.detail, "line", 100));
    const btn = el("button", "lto-hud-btn lto-hud-load");
    btn.type = "button";
    btn.dataset.save = sv.id;
    btn.disabled = !sv.canLoad;
    btn.setAttribute("aria-label", `Load ${sv.label}`);
    if (pixel) {
      btn.classList.add("lto-fr", "fs1", "fr-win");
      btn.append(kit.px("Load", { scale: 2, weight: "bold", color: PX.ink, outline: PX.dark }));
    } else {
      btn.append(el("span", undefined, "Load"));
    }
    btn.onclick = () => kit.onAction(`load:${sv.id}`);
    row.append(info, btn);
    list.append(row);
  }
  wrap.append(list);
  // The debug export: everything about this adventure in one file, for finding what went wrong.
  const foot = el("div", "lto-hud-exportrow");
  foot.dataset.hudExportRow = "";
  foot.setAttribute("role", "group");
  foot.setAttribute("aria-label", "Debugging");
  const exportBtn = (label: string, key: string, id: string): HTMLButtonElement => {
    const btn = el("button", "lto-hud-btn lto-hud-export");
    btn.type = "button";
    btn.dataset[key] = "";
    btn.setAttribute("aria-label", label);
    if (pixel) {
      btn.classList.add("lto-fr", "fs1", "fr-win");
      const room = Math.max(40, Math.floor((kit.width() - 76) / 2));
      btn.append(kit.px(label, { scale: 2, weight: "bold", color: PX.ink, outline: PX.dark, maxWidth: room }));
    } else {
      btn.append(el("span", undefined, label));
    }
    btn.onclick = () => kit.onAction(id);
    return btn;
  };
  foot.append(exportBtn("Export adventure (debug)", "export", "export"));
  if (exp.copy) foot.append(exportBtn("Copy adventure JSON", "exportCopy", "export-copy"));
  wrap.append(foot);
  const status = el("div", "lto-hud-export-status");
  status.dataset.hudExportStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = !exp.status;
  if (exp.status) status.append(kit.text(exp.status, "line", 18));
  wrap.append(status);
  queueMicrotask(() => {
    list.scrollTop = prevScroll;
  });
  return wrap;
}

// ---- the menu's tab icons -----------------------------------------------------

/** Font Awesome solid icons (the project draws icons inline, with no icon font): one per tab of the in-game menu. */
export const MENU_ICONS: Readonly<Record<"character" | "inventory" | "journal" | "log" | "saves" | "settings", { w: number; h: number; d: string }>> = {
  character: { w: 448, h: 512, d: "M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z" },
  inventory: { w: 448, h: 512, d: "M160 80c0-35.3 28.7-64 64-64s64 28.7 64 64l0 48-128 0 0-48zm-48 48l-64 0c-26.5 0-48 21.5-48 48L0 384c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-208c0-26.5-21.5-48-48-48l-64 0 0-48c0-61.9-50.1-112-112-112S112 18.1 112 80l0 48zm24 48a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm152 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z" },
  journal: { w: 448, h: 512, d: "M384 512L96 512c-53 0-96-43-96-96L0 96C0 43 43 0 96 0L400 0c26.5 0 48 21.5 48 48l0 288c0 20.9-13.4 38.7-32 45.3l0 66.7c17.7 0 32 14.3 32 32s-14.3 32-32 32l-32 0zM96 384c-17.7 0-32 14.3-32 32s14.3 32 32 32l256 0 0-64-256 0zm32-232c0 13.3 10.7 24 24 24l176 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-176 0c-13.3 0-24 10.7-24 24zm24 72c-13.3 0-24 10.7-24 24s10.7 24 24 24l176 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-176 0z" },
  log: { w: 576, h: 512, d: "M0 112C0 70.5 31.6 36.4 72 32.4l0-.4 280 0c53 0 96 43 96 96l0 176-176 0c-39.8 0-72 32.2-72 72l0 60c0 24.3-19.7 44-44 44s-44-19.7-44-44l0-228-64 0c-26.5 0-48-21.5-48-48l0-48zM236.8 480c7.1-13.1 11.2-28.1 11.2-44l0-60c0-13.3 10.7-24 24-24l248 0c13.3 0 24 10.7 24 24l0 24c0 44.2-35.8 80-80 80l-227.2 0zM80 80c-17.7 0-32 14.3-32 32l0 48 64 0 0-48c0-17.7-14.3-32-32-32z" },
  saves: { w: 448, h: 512, d: "M64 32C28.7 32 0 60.7 0 96L0 416c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-242.7c0-17-6.7-33.3-18.7-45.3L352 50.7C340 38.7 323.7 32 306.7 32L64 32zm32 96c0-17.7 14.3-32 32-32l160 0c17.7 0 32 14.3 32 32l0 64c0 17.7-14.3 32-32 32l-160 0c-17.7 0-32-14.3-32-32l0-64zM224 288a64 64 0 1 1 0 128 64 64 0 1 1 0-128z" },
  settings: { w: 512, h: 512, d: "M195.1 9.5C198.1-5.3 211.2-16 226.4-16l59.8 0c15.2 0 28.3 10.7 31.3 25.5L332 79.5c14.1 6 27.3 13.7 39.3 22.8l67.8-22.5c14.4-4.8 30.2 1.2 37.8 14.4l29.9 51.8c7.6 13.2 4.9 29.8-6.5 39.9L447 233.3c.9 7.4 1.3 15 1.3 22.7s-.5 15.3-1.3 22.7l53.4 47.5c11.4 10.1 14 26.8 6.5 39.9l-29.9 51.8c-7.6 13.1-23.4 19.2-37.8 14.4l-67.8-22.5c-12.1 9.1-25.3 16.7-39.3 22.8l-14.4 69.9c-3.1 14.9-16.2 25.5-31.3 25.5l-59.8 0c-15.2 0-28.3-10.7-31.3-25.5l-14.4-69.9c-14.1-6-27.2-13.7-39.3-22.8L73.5 432.3c-14.4 4.8-30.2-1.2-37.8-14.4L5.8 366.1c-7.6-13.2-4.9-29.8 6.5-39.9l53.4-47.5c-.9-7.4-1.3-15-1.3-22.7s.5-15.3 1.3-22.7L12.3 185.8c-11.4-10.1-14-26.8-6.5-39.9L35.7 94.1c7.6-13.2 23.4-19.2 37.8-14.4l67.8 22.5c12.1-9.1 25.3-16.7 39.3-22.8L195.1 9.5zM256.3 336a80 80 0 1 0 -.6-160 80 80 0 1 0 .6 160z" },
};

/** An icon as an svg element, sized by CSS (it takes the text colour). */
export function menuIcon(name: keyof typeof MENU_ICONS): SVGElement {
  const i = MENU_ICONS[name];
  const svg = svgEl("svg", { viewBox: `0 0 ${i.w} ${i.h}`, "aria-hidden": "true", focusable: "false", class: "lto-gm-icon" });
  svg.append(svgEl("path", { d: i.d }));
  return svg;
}
