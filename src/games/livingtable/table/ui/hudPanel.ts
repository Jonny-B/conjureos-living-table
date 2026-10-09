/**
 * The HUD's panel: the title, hit point bars, the DM's suggested moves, the action buttons and the drawer tabs (the asset bench's).
 *
 * On a phone the panel is condensed (see HudState.condense): the title, the lines the state marks as short, and the hit point bars,
 * and nothing else, so it stays under about 100 px tall. The pixel look draws its text on canvases, so this is decided here, at draw time.
 */
import { textWidth, wrapWidth } from "./pixelFont";
import type { HudState, DrawerTab } from "./hudTypes";
import { el, deviceRatio } from "./domKit";
import { PX } from "./overlayTheme";
import { hpColour, optionsLayout, wrapClamp, DRAWER_TABS, drawerColumns } from "./hudHelpers";
import type { HudCtx } from "./hudCtx";
import { journalView, logView, savesView, settingsView } from "./menuViews";

export function installHudPanel(hc: HudCtx): void {
  function draw(): void {
    const s = hc.last;
    if (!s) return;
    hc.root.classList.toggle("lto-px", hc.isPixel());
    hc.root.classList.toggle("lto-sb", !hc.isPixel());
    // The drawer's list scrolls inside a box that is rebuilt below: note where the reader was.
    const prevList = hc.drawerBox.querySelector<HTMLElement>(".lto-hud-list");
    const tab = hc.openTab();
    const sameTab = !!prevList && prevList.dataset.tab === tab;
    const keep = {
      sameTab,
      scroll: prevList?.scrollTop ?? 0,
      atBottom: !prevList || prevList.scrollHeight - prevList.scrollTop - prevList.clientHeight < 14,
    };
    // A pinned item card stays up through a redraw that did not change the pack (the DM answering, a notice, the turn passing).
    const pinned = tab === "pack" && sameTab && !!s.pack && hc.packSig(s) === hc.drawnPackSig && !!hc.drawerBox.querySelector('.lto-hud-row[aria-expanded="true"]');
    if (!pinned) {
      for (const off of hc.tipOff) off();
      hc.tipOff = [];
    }
    hc.panel.className = "lto-hud-panel";
    if (hc.isPixel()) hc.panel.classList.add("lto-fr", "fr-win");
    else hc.panel.classList.add("lto-plate");
    hc.panel.replaceChildren();
    const small = hc.condensed();
    if (small) hc.panel.dataset.condensed = "true";
    else delete hc.panel.dataset.condensed;
    hc.panel.append(hc.text(s.title, "title"));
    // The small-screen look keeps the title, the lines marked short and the bars: no location, hint or armour class line.
    const shown = small ? (s.short ?? []) : s.lines;
    if (shown.length) {
      const lines = el("div", "lto-hud-lines");
      lines.dataset.hudLines = "";
      for (const l of shown) lines.append(hc.text(l, "line"));
      hc.panel.append(lines);
    }
    if (s.bars.length) {
      const bars = el("div", "lto-hud-bars");
      for (const b of s.bars) {
        const row = el("div", "lto-hud-bar");
        row.dataset.side = b.side;
        const meter = el("div", "lto-hud-meter");
        const fill = el("i");
        fill.style.setProperty("--hp", hpColour(b));
        fill.style.width = `${b.max > 0 ? Math.max(0, Math.min(100, (b.hp / b.max) * 100)) : 0}%`;
        meter.append(fill);
        meter.setAttribute("aria-hidden", "true");
        row.append(hc.text(b.label, "name"), meter, hc.text(b.down ? "DOWN" : `${b.hp}/${b.max}`, "num"));
        bars.append(row);
      }
      hc.panel.append(bars);
    }
    drawNext(s);
    drawActions(s);
    drawTabs(s, tab);
    if (!pinned) {
      drawDrawer(s, tab, keep);
      hc.drawnPackSig = tab === "pack" ? hc.packSig(s) : "";
    }
  }

  // ---- the DM's suggested next moves

  /** The width, in CSS px, a suggestion button's label has: the column, less the frame, the padding, the key and the gap. */
  function optionRoom(columns: 1 | 2, key: string): number {
    const rootW = hc.root.clientWidth || 300;
    const col = columns === 2 ? (rootW - 6) / 2 : rootW;
    return Math.max(40, col - 30 - textWidth(key, "bold") * 2 - 8 - 2);
  }

  function drawNext(s: HudState): void {
    const choices = [
      ...(s.options ?? []).map((o) => ({ id: o.id, label: o.label, key: o.key, enabled: true })),
      ...s.actions.filter((a) => !a.hidden && a.kind === "suggestion").map((a) => ({ id: a.id, label: a.label, key: a.key, enabled: a.enabled })),
    ];
    const { columns, items } = optionsLayout(choices);
    hc.nextLabel.replaceChildren();
    hc.nextList.replaceChildren();
    hc.next.hidden = items.length === 0;
    if (items.length === 0) return;
    hc.nextList.style.setProperty("--cols", String(columns));
    if (hc.isPixel()) hc.nextLabel.append(hc.px("What next?", { scale: 2, color: PX.gold, outline: PX.dark }));
    else hc.nextLabel.textContent = "What next?";
    for (const o of items) {
      const btn = el("button", "lto-hud-btn lto-hud-opt");
      btn.type = "button";
      btn.dataset.option = o.id;
      btn.dataset.key = o.key;
      btn.disabled = !o.enabled;
      btn.setAttribute("aria-label", `${o.full} (${o.key})`);
      if (o.full !== o.label) btn.title = o.full;
      const label = el("span", "lto-hud-opt-label");
      if (hc.isPixel()) {
        btn.classList.add("lto-fr", "fs1", "fr-gold");
        // Wrapped and cut to two lines here, since a canvas cannot wrap itself.
        const lines = wrapClamp(o.label, wrapWidth(optionRoom(columns, o.key), 2, deviceRatio()), 2);
        label.append(hc.px(lines.join("\n"), { scale: 2, color: PX.ink, outline: PX.dark }));
        btn.append(hc.px(o.key, { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark }), label);
      } else {
        label.textContent = o.label;
        btn.append(el("span", "lto-hud-key", o.key), label);
      }
      btn.onclick = () => hc.onAction(o.id);
      hc.nextList.append(btn);
    }
  }

  // ---- the game's own buttons: only the ones that do something now

  function drawActions(s: HudState): void {
    const shown = s.actions.filter((a) => !a.hidden && a.kind !== "suggestion");
    hc.actions.hidden = shown.length === 0;
    hc.actions.replaceChildren();
    for (const a of shown) {
      const btn = el("button", "lto-hud-btn");
      btn.type = "button";
      btn.dataset.action = a.id;
      btn.disabled = !a.enabled;
      if (a.emphasis) btn.classList.add("is-now");
      // The thin frame: a button needs its width for the label and the key.
      if (hc.isPixel()) btn.classList.add("lto-fr", "fs1", a.emphasis ? "fr-gold" : "fr-win");
      btn.setAttribute("aria-label", a.key ? `${a.label} (${a.key})` : a.label);
      if (hc.isPixel()) {
        btn.append(hc.px(a.label, { scale: 2, weight: "bold", color: a.emphasis ? PX.gold : PX.ink, outline: PX.dark }));
        if (a.key) btn.append(hc.px(a.key, { scale: 2, color: PX.muted, outline: PX.dark }));
      } else {
        btn.append(el("span", undefined, a.label));
        if (a.key) btn.append(el("span", "lto-hud-key", a.key));
      }
      btn.onclick = () => hc.onAction(a.id);
      hc.actions.append(btn);
    }
  }

  // ---- the drawer: Pack, Log, Saves

  const TAB_WORDS: Record<DrawerTab, { label: string; key?: string }> = { pack: { label: "Pack", key: "I" }, journal: { label: "Journal", key: "J" }, log: { label: "Log", key: "L" }, saves: { label: "Saves" }, settings: { label: "Settings" } };

  function drawTabs(s: HudState, tab: DrawerTab | null): void {
    const have = hc.has(s);
    const shown = DRAWER_TABS.filter((t) => have[t]);
    hc.tabs.hidden = shown.length === 0;
    hc.tabs.style.setProperty("--n", String(drawerColumns(shown.length)));
    hc.tabs.dataset.cols = String(drawerColumns(shown.length));
    hc.tabs.replaceChildren();
    for (const t of shown) {
      const { label, key } = TAB_WORDS[t];
      const open = tab === t;
      const btn = el("button", "lto-hud-btn lto-hud-tab");
      btn.type = "button";
      btn.dataset.hudDrawer = t;
      if (t === "pack") btn.dataset.hudPack = "";
      btn.setAttribute("aria-label", key ? `${label} (${key})` : label);
      btn.setAttribute("aria-pressed", String(open));
      btn.setAttribute("aria-expanded", String(open));
      if (t === "pack" && !open && hc.pendingNew.size > 0) btn.dataset.new = "true";
      if (t === "journal" && !open && hc.journalNew) btn.dataset.new = "true";
      if (hc.isPixel()) {
        btn.classList.add("lto-fr", "fs1", open ? "fr-gold" : "fr-win");
        btn.append(hc.px(label, { scale: 2, weight: "bold", color: open ? PX.gold : PX.ink, outline: PX.dark }));
        if (key) btn.append(hc.px(key, { scale: 2, color: PX.muted, outline: PX.dark }));
      } else {
        btn.append(el("span", undefined, label));
        if (key) btn.append(el("span", "lto-hud-key", key));
        if (open) btn.classList.add("is-open");
      }
      btn.onclick = () => hc.toggleTab(t);
      hc.tabs.append(btn);
    }
  }

  function drawDrawer(s: HudState, tab: DrawerTab | null, keep: { sameTab: boolean; scroll: number; atBottom: boolean }): void {
    hc.drawerBox.className = "lto-hud-drawer";
    hc.drawerBox.hidden = tab === null;
    hc.drawerBox.replaceChildren();
    if (tab === null) {
      delete hc.drawerBox.dataset.tab;
      return;
    }
    hc.drawerBox.dataset.tab = tab;
    hc.drawerBox.setAttribute("aria-label", TAB_WORDS[tab].label);
    if (hc.isPixel()) hc.drawerBox.classList.add("lto-fr", "fr-win");
    else hc.drawerBox.classList.add("lto-plate");
    if (tab === "pack" && s.pack) hc.drawerBox.append(hc.packView(s.pack.sections, keep.sameTab ? keep.scroll : 0));
    else if (tab === "journal" && s.journal) hc.drawerBox.append(journalView(hc.kit, s.journal, keep.sameTab ? keep.scroll : 0));
    else if (tab === "log" && s.log) hc.drawerBox.append(logView(hc.kit, s.log, keep));
    else if (tab === "saves" && s.saves) hc.drawerBox.append(savesView(hc.kit, s.saves, keep.sameTab ? keep.scroll : 0, { status: s.exportStatus, copy: s.exportCopy }));
    else if (tab === "settings" && s.settings) hc.drawerBox.append(settingsView(hc.kit, s.settings));
  }

  // What the other modules call or read.
  hc.draw = draw;
}
