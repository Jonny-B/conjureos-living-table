/**
 * createOverlay: the text layer over the board (banners, floats, roll plates, the dialogue box, the turn strip, the story screen, the menu, the loot window, the adventure screens).
 */
import { pixelText, type PixelRun, type PixelTextOptions } from "./pixelFont";
import type { Overlay, TextStyle } from "./overlayTypes";
import { injectStyle } from "./overlayStyle";
import { el, FRAMES, frameUrl, deviceRatio } from "./domKit";
import { buildDefs } from "./numerals";
import type { FrameKey } from "./overlayTheme";
import { sizeTier } from "./overlayMath";
import { dialogueLines } from "./dialogueQueue";
import type { OverlayCtx } from "./overlayCtx";
import { installFeedback } from "./feedback";
import { installPlates } from "./plates";
import { installDialogue } from "./dialogue";
import { installInitiative } from "./initiative";
import { installContextMenu } from "./contextMenu";
import { installLootWindow } from "./lootWindow";
import { installScreenKit } from "./screenKit";
import { installStartScreen } from "./startScreen";
import { installHeroEnding } from "./heroEnding";
import { installArrivals } from "./arrivals";
import { installStory } from "./story";

// ---- the overlay ------------------------------------------------------------

interface Internals {
  host: HTMLElement;
  root: HTMLElement;
}
export const internals = new WeakMap<Overlay, Internals>();
let uidCounter = 0;

export function createOverlay(host: HTMLElement, initialStyle: TextStyle): Overlay {
  const oc = {} as OverlayCtx;
  oc.host = host;
  injectStyle();
  const uid = String(++uidCounter);
  oc.style = initialStyle;
  oc.destroyed = false;
  oc.epoch = 0;
  let busy = 0;

  let restorePosition: string | null = null;
  const hostStyle = getComputedStyle(host);
  if (hostStyle.position === "static") {
    restorePosition = host.style.position;
    host.style.position = "relative";
  }
  if (/auto|scroll/.test(`${hostStyle.overflowX} ${hostStyle.overflowY}`)) {
    console.warn("overlay: the host scrolls, so banners and the dialogue box would scroll away with the board. Pass a non-scrolling wrapper that sits over it.");
  }

  // ---- scaffolding
  const root = el("div", "lto-root");
  root.dataset.ltoRoot = "";
  root.dataset.busy = "0";
  const defs = buildDefs(uid);
  const live = el("div", "lto-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "false");
  live.dataset.ltoLive = "";
  const platesLayer = el("div", "lto-layer");
  const floatsLayer = el("div", "lto-layer");
  const top = el("div", "lto-top");
  const initEl = el("div", "lto-init");
  initEl.dataset.ltoInitiative = "";
  initEl.hidden = true;
  initEl.setAttribute("role", "group");
  initEl.setAttribute("aria-label", "Turn order");
  // Banners ("Your turn") sit under the turn strip, in the same band at the top; the board keeps clear of both (--lto-top-band).
  const bannersLayer = el("div", "lto-banners");
  top.append(initEl, bannersLayer);
  const bottom = el("div", "lto-bottom");
  const dlg = el("div", "lto-dlg");
  dlg.dataset.ltoDialogue = "";
  dlg.hidden = true;
  dlg.tabIndex = 0;
  dlg.setAttribute("role", "group");
  dlg.setAttribute("aria-label", "Story");
  const dlgTag = el("div", "lto-dlg-tag");
  const dlgBox = el("div", "lto-dlg-box");
  const dlgBody = el("div", "lto-dlg-body");
  // The words are announced whole by the live region as each entry arrives; the typing is not read out letter by letter.
  dlgBody.setAttribute("aria-hidden", "true");
  const dlgMore = el("span", "lto-dlg-more");
  dlgMore.dataset.ltoMore = "";
  dlgMore.setAttribute("aria-hidden", "true");
  dlgMore.hidden = true;
  dlgBox.append(dlgBody, dlgMore);
  dlg.append(dlgTag, dlgBox);
  bottom.append(dlg);
  // Stacking, bottom to top: the top band (turn strip and banners), the dialogue box, roll plates (they cover the dialogue for
  // their two seconds rather than the other way round, so a verdict is never hidden), floats, and last the story screen over all.
  root.append(defs, live, top, bottom, platesLayer, floatsLayer);
  host.appendChild(root);

  const frameVars = (): void => {
    for (const key of Object.keys(FRAMES) as FrameKey[]) {
      const url = frameUrl(key);
      if (url) root.style.setProperty(`--fr-${key}`, `url("${url}")`);
    }
  };
  frameVars();

  // ---- state
  oc.initState = { entries: [], activeId: null, round: 1 };
  oc.recent = [];
  oc.tier = "l";
  oc.width = 0;
  oc.bannersUp = 0;

  // ---- time: every wait and animation is tracked so clear() can end them at once
  const waits = new Map<number, () => void>();
  const anims = new Set<Animation>();

  const reduced = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = window.setTimeout(() => {
        waits.delete(id);
        resolve();
      }, ms);
      waits.set(id, resolve);
    });
  }

  /** Start an animation; `anim` is the running one (null where there is no Web Animations API), `done` resolves when it ends or is cancelled. */
  function start(node: Element, frames: Keyframe[], ms: number, easing = "linear"): { anim: Animation | null; done: Promise<void> } {
    if (typeof node.animate !== "function") return { anim: null, done: wait(ms) };
    const anim = node.animate(frames, { duration: ms, easing, fill: "forwards" });
    anims.add(anim);
    const done = anim.finished.then(
      () => {
        anims.delete(anim);
      },
      () => {
        anims.delete(anim);
      },
    );
    return { anim, done };
  }

  function play(node: Element, frames: Keyframe[], ms: number, easing = "linear"): Promise<void> {
    return start(node, frames, ms, easing).done;
  }

  /** Count an animation in or out. A late finish from before a clear() must not touch the new count. */
  function setBusy(delta: number, forEpoch: number): void {
    if (forEpoch !== oc.epoch) return;
    busy = Math.max(0, busy + delta);
    root.dataset.busy = String(busy);
  }

  function announce(text: string): void {
    const p = el("p", undefined, text);
    live.appendChild(p);
    while (live.childElementCount > 8) live.firstElementChild?.remove();
  }

  const isPixel = (): boolean => oc.style === "pixel";

  const px = (input: string | readonly PixelRun[], opts: PixelTextOptions): HTMLCanvasElement => {
    const canvas = pixelText(input, { dpr: deviceRatio(), ...opts });
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  };

  const srText = (text: string): HTMLElement => el("span", "lto-sr", text);

  function frame(node: HTMLElement, key: FrameKey = "win", small = false): HTMLElement {
    node.classList.add("lto-fr", `fr-${key}`);
    if (small) node.classList.add("fs1");
    return node;
  }

  // ---- sizing
  function measure(): void {
    oc.width = root.clientWidth;
    const next = sizeTier(oc.width);
    root.dataset.size = next;
    // The dialogue box holds 3 or 4 rows by the overlay's height (dialogueLines), so a change in rows republishes the dock like a new tier.
    const rows = dialogueLines(next, root.clientHeight || Number.POSITIVE_INFINITY);
    const changed = next !== oc.tier || rows !== lastRows;
    lastRows = rows;
    oc.tier = next;
    // The bands the board keeps clear of (the DM box below, the turn strip above) follow the size tier and are published at once.
    if (changed || !bandsPublished) {
      oc.publishDock();
      oc.updateBands();
      bandsPublished = root.clientHeight > 0;
    }
    if (changed || isPixel()) scheduleRelayout();
  }
  let bandsPublished = false;
  let lastRows = 0;
  let relayoutQueued = false;
  // Pixel text is drawn for one width and one device pixel ratio, so a change in either redraws it.
  const layoutKey = (): string => `${oc.width}@${deviceRatio()}`;
  let lastLayoutKey = "";
  function scheduleRelayout(): void {
    if (relayoutQueued || layoutKey() === lastLayoutKey) return;
    relayoutQueued = true;
    const run = () => {
      relayoutQueued = false;
      if (oc.destroyed) return;
      lastLayoutKey = layoutKey();
      oc.relayoutDialogue();
      oc.renderInitiative();
      if (oc.menu) oc.renderMenu(oc.menu);
      if (oc.loot) oc.renderLoot(oc.loot);
      oc.relayoutStory();
      oc.rebuildScreens();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else run();
  }
  // The observer only schedules: measure() republishes the dock, which can resize the very box this watches, and doing that from inside the
  // callback raises "ResizeObserver loop completed with undelivered notifications" as a window error.
  let measureQueued = false;
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (measureQueued || oc.destroyed) return;
          measureQueued = true;
          const run = () => {
            measureQueued = false;
            if (!oc.destroyed) measure();
          };
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
          else run();
        })
      : null;
  ro?.observe(root);

  function applyStyleClass(): void {
    root.classList.toggle("lto-px", oc.style === "pixel");
    root.classList.toggle("lto-sb", oc.style === "storybook");
    root.dataset.style = oc.style;
  }

  // What the modules below read or call.
  oc.uid = uid;
  oc.root = root;
  oc.platesLayer = platesLayer;
  oc.floatsLayer = floatsLayer;
  oc.top = top;
  oc.initEl = initEl;
  oc.bottom = bottom;
  oc.dlg = dlg;
  oc.dlgTag = dlgTag;
  oc.dlgBox = dlgBox;
  oc.dlgBody = dlgBody;
  oc.dlgMore = dlgMore;
  oc.bannersLayer = bannersLayer;
  oc.reduced = reduced;
  oc.wait = wait;
  oc.start = start;
  oc.play = play;
  oc.setBusy = setBusy;
  oc.announce = announce;
  oc.isPixel = isPixel;
  oc.px = px;
  oc.srText = srText;
  oc.frame = frame;

  installFeedback(oc);
  installPlates(oc);
  installDialogue(oc);
  installInitiative(oc);
  installContextMenu(oc);
  installLootWindow(oc);
  installScreenKit(oc);
  installStartScreen(oc);
  installHeroEnding(oc);
  installStory(oc);
  installArrivals(oc);

  root.insertBefore(oc.lootHost, platesLayer);
  root.insertBefore(oc.screensLayer, oc.lootHost);
  root.append(oc.menuLayer, oc.storyLayer);

  // ---- control

  function clear(): void {
    oc.closeMenu(false);
    oc.epoch++;
    for (const [id, resolve] of waits) {
      window.clearTimeout(id);
      resolve();
    }
    waits.clear();
    for (const a of Array.from(anims)) a.cancel();
    anims.clear();
    platesLayer.replaceChildren();
    oc.livePlates.clear();
    floatsLayer.replaceChildren();
    oc.liveFloats.clear();
    bannersLayer.replaceChildren();
    oc.bannersUp = 0;
    oc.cancelLoop();
    oc.dq.clear();
    oc.fade = null;
    dlgBody.replaceChildren();
    dlgMore.hidden = true;
    dlg.hidden = true;
    oc.drawnLook = "";
    oc.drawnPage = "";
    oc.drawnShown = -1;
    oc.drawnMore = null;
    oc.lineNodes = [];
    // The story goes last: letting the dialogue's clock go again then finds nothing to draw.
    oc.clearStory();
    oc.initState = { entries: [], activeId: null, round: 1 };
    oc.renderInitiative();
    oc.updateBands();
    live.replaceChildren();
    oc.recent = [];
    oc.platesWaiting = 0;
    busy = 0;
    root.dataset.busy = "0";
  }

  function setStyle(next: TextStyle): void {
    if (oc.destroyed || next === oc.style) return;
    oc.style = next;
    applyStyleClass();
    oc.relayoutDialogue();
    oc.renderInitiative();
    if (oc.menu) oc.renderMenu(oc.menu);
    if (oc.loot) oc.renderLoot(oc.loot);
    oc.relayoutStory();
    oc.rebuildScreens();
  }

  function destroy(): void {
    if (oc.destroyed) return;
    clear();
    if (oc.loot) oc.closeLoot(oc.loot, false);
    for (const sc of Array.from(oc.screens)) oc.closeScreen(sc);
    oc.destroyed = true;
    ro?.disconnect();
    host.style.removeProperty("--lto-dock");
    host.style.removeProperty("--lto-top-band");
    root.remove();
    if (restorePosition !== null) host.style.position = restorePosition;
    internals.delete(api);
  }

  const api: Overlay = { setStyle, banner: oc.banner, float: oc.float, rollPlate: oc.rollPlate, say: oc.say, dismissStory: oc.dismissStory, narrate: oc.narrate, setTextSpeed: oc.setTextSpeed, advanceStory: oc.pressDialogue, storyScreen: oc.storyScreen, storyOpen: oc.storyOpen, whenStoryClosed: oc.whenStoryClosed, onStoryChange: oc.onStoryChange, onDmCancel: oc.onDmCancel, initiative: oc.initiative, contextMenu: oc.contextMenu, lootWindow: oc.lootWindow, startScreen: oc.startScreen, startHero: oc.startHero, locationCard: oc.locationCard, sceneCard: oc.sceneCard, endingCard: oc.endingCard, clear, destroy };
  internals.set(api, { host, root });
  applyStyleClass();
  measure();
  return api;
}
