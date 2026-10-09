/**
 * The DM, asking: the DM sample loader, the freehand line's state, the pack list, examining, and running an ask.
 */
import { packInfo } from "../../inventory/itemInfo";
import { type DmExchange } from "../../session/adventureExport";
import { isPlayersTurn } from "../../menu/combatRound";
import { type PackSection } from "../ui/overlay";
import { askDm, validationContextFor, type DmAsk, type SampleFn } from "../dmCore";
import { itemCount, itemTip, sheetItemKey } from "../ui/sheet";
import { DM_JOURNAL_KEEP, DOWN_NOTE, NOT_SEEN, awakeHostiles, creatureById, heroDown, type PlayState, type XY } from "../state";
import { itemCardFor } from "../gearLoot";
import { adventureOf, featureAtSquare } from "../adventureRun";
import { heroesTurn, sightLevel } from "../sight";
import { dmAdventureView, dmViewFor, whatIsAt } from "../dmScene";
import type { TableCtx } from "../tableCtx";

  // ---- the DM ------------------------------------------------------------------
  //
  // dm.ts asks the model (one plain-text sample call, checked and repaired by our
  // own code); this is the table around it. The model's reply is a narration,
  // what the action costs, effects the engine applies, and at most one check with
  // BOTH outcomes already written: the tray rolls, the engine plays the branch the
  // dice pick. So one action is one DM call.

  export type SampleState = "pending" | "ready" | "none";

  /** Whether the player can ask the DM right now, and what to say when they cannot (the right-click menu's free text row reads this). */
  export interface AskState {
    enabled: boolean;
    /** True while the DM is thinking. */
    busy?: boolean;
    /** Why it is not possible now, in plain words. */
    status?: string;
  }

export function installDmFlow(tc: TableCtx): void {
  tc.sampleState = "pending";
  tc.sampleFn = null;
  
  tc.alive = true;
  /** The adventure brief the DM was last given (the debug export keeps it); null before the first ask of a game. */
  tc.lastBrief = null;
  /** The AI writer's call in progress, so Cancel (and leaving the tab) can stop it. */
  tc.writerCtl = null;
  /** The call in progress (a turn that is being asked for or played); null when the table is free. */
  tc.dmCtl = null;
  /** True only while waiting on the model and before the first word of its reply: Cancel is offered. `busy` covers the whole turn. */
  tc.dmThinking = false;
  const NO_DM = tc.host.dm.unavailable;

  /** A stand-in sampler the host can answer at once (the bench's test hook): asked before the capability on every ask. */
  const peekSample = (): SampleFn | null => tc.host.dm.peek?.() ?? null;

  /** Once per mount, after the first paint: the host says whether there is a DM to ask, and the ask field says so when there is not. */
  async function loadSample(): Promise<void> {
    const hook = peekSample();
    if (hook) {
      tc.sampleFn = hook;
      tc.sampleState = "ready";
      return;
    }
    try {
      const found = await tc.host.dm.sample();
      if (!tc.alive) return;
      if (found) {
        tc.sampleFn = found;
        tc.sampleState = "ready";
      } else {
        tc.sampleState = "none";
        tc.dmStatus = NO_DM;
      }
    } catch {
      tc.sampleState = "none";
      tc.dmStatus = NO_DM;
    }
  }

  /**
   * Take back a question to the DM. Only while it is still thinking, before the reply starts to type: it stops the wait, drops the
   * reply and changes nothing in the world. What the call used is still used (the platform bills a call when it is made).
   */
  function cancelDm(): void {
    if (!tc.dmThinking) return;
    tc.dmCtl?.abort();
  }
  // The DM box shows a small Cancel beside its dots while the DM thinks.
  tc.overlay.onDmCancel(cancelDm);

  /** What the HUD's freehand field shows right now. */
  function askStateFor(p: PlayState): AskState {
    if (tc.dmThinking) return { enabled: false, busy: true };
    if (tc.overlayOpen()) return { enabled: false, status: tc.screenOpen() ? "Choose how to begin." : "Close the sheet to act." };
    if (tc.sampleState === "pending") return { enabled: false, status: "Waking the DM..." };
    if (tc.sampleState === "none") return { enabled: false, status: tc.dmStatus ?? NO_DM };
    const myMove = !p.round || heroesTurn(p);
    return { enabled: !tc.busy && !heroDown(p) && myMove };
  }

  /**
   * The pack view inside the game window: what the hero wears, the bag, what is carried
   * and the consumables (the bench's own potion count included). Every row carries the
   * hover tip from inventory/itemInfo.ts: what it is, its real numbers, and whether the
   * game applies it or the DM rules on it. The DM's own words for things it handed over
   * ride in through itemNotes.
   */
  function packSections(p: PlayState): PackSection[] {
    return packInfo(p.hero, { potions: p.potions, notes: p.itemNotes }).map((section) => ({
      label: section.label,
      items: section.items.map((info) => {
        const count = itemCount(info);
        const key = sheetItemKey(section.label, info.name);
        // A card, not just a tip: click or tap pins it with the buttons the engine says this item has (read fresh each time it opens).
        return { text: count ? `${info.name} ${count}` : info.name, tip: itemTip(info), key, card: () => itemCardFor(tc.st(), key) ?? { tip: itemTip(info), status: "You do not have that any more.", actions: [] } };
      }),
    }));
  }

  /** Look closely at a square the hero has seen. */
  function examineAt(at: XY): void {
    if (tc.busy || tc.overlayOpen()) return;
    const p = tc.st();
    if (sightLevel(p, at) === 0) return tc.refuse(NOT_SEEN);
    // A feature of an adventure's place is described by the adventure, in its own words; the DM is for what the adventure does not say.
    const feature = p.adventureId ? featureAtSquare(p, at) : undefined;
    if (feature) return tc.showFeature(feature);
    void runDm({ kind: "examine", at: { ...at }, what: whatIsAt(p, at) });
  }

  /** The adventure's people standing on this board: their ids, their adventure names and where they are. */
  function npcsOnBoard(p: PlayState): { id: string; name: string; at: XY }[] {
    return dmAdventureView(p)?.npcsHere ?? [];
  }

  /** Whether a name is spoken in some words: the whole name, or its first word when that is a name (Tobin Hale: "Tobin"), as a word of its own. */
  function mentions(text: string, name: string): boolean {
    const t = text.toLowerCase();
    const parts = [name.toLowerCase(), name.toLowerCase().split(/\s+/)[0] ?? ""].filter((w) => w.length >= 3);
    return parts.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[^a-z0-9 ]/g, "")}([^a-z]|$)`).test(t));
  }

  /**
   * An ask in an adventure, with the person it is for: the one it names already (`npc`, set by a click on them), else the only person of the
   * adventure whose name the words use. The DM then answers in that person's voice and says it set talkedTo. Words that speak to nobody go as they are.
   */
  function askWithPerson(p: PlayState, ask: DmAsk): DmAsk {
    if (ask.kind !== "freehand" || ask.npc || !adventureOf(p)) return ask;
    const named = npcsOnBoard(p).filter((n) => mentions(ask.text, n.name));
    const who = named.length === 1 ? named[0] : undefined;
    return who ? { ...ask, npc: { id: who.id, name: who.name } } : ask;
  }

  /** One DM turn: ask, then play the reply. The table is busy from the ask to the last effect. */
  async function runDm(first: DmAsk): Promise<void> {
    if (tc.dmCtl || tc.busy) return;
    const p = tc.st();
    const ask = askWithPerson(p, first);
    if (heroDown(p)) return tc.refuse(DOWN_NOTE);
    if (p.round && !isPlayersTurn(p.round)) return tc.refuse("Wait for your turn.");
    const sample = peekSample() ?? tc.sampleFn;
    if (!sample) return tc.refuse(NO_DM);
    // Kept so a cancel can put the suggested moves and the Log back as they were.
    const prevOptions = p.options;
    tc.clearOptions();
    const yourLine = { text: ask.kind === "freehand" ? `You: ${ask.text.slice(0, 300)}` : `You look closely at ${ask.what}.`, tone: "plain" as const };
    p.log.push(yourLine);
    const ctl = new AbortController();
    tc.dmCtl = ctl;
    tc.dmThinking = true;
    tc.busy = true;
    tc.skipping = false;
    tc.walkQueue.length = 0;
    tc.onArrive = null;
    // The box shows "..." until the model's narration starts to stream in.
    const handle = tc.overlay.narrate({ text: "" });
    tc.renderHud();
    const view = dmViewFor(p);
    tc.lastBrief = view.adventure?.brief ?? null;
    // Every ask goes in the debug journal, whichever way it ends; what the engine applied and refused is added when the reply has played.
    const exchange: { current: DmExchange | null } = { current: null };
    const outcome = await askDm(sample, view, ask, validationContextFor(view), {
      signal: ctl.signal,
      onNarration: (t) => {
        handle.update(t);
        // The first word of the reply is typing: it is too late to take the question back.
        if (tc.dmThinking && t.trim() !== "") {
          tc.dmThinking = false;
          tc.renderHud();
        }
      },
      onExchange: (x) => {
        exchange.current = { ...x };
        const journal = tc.st().dmJournal;
        journal.push(exchange.current);
        if (journal.length > DM_JOURNAL_KEEP) journal.splice(0, journal.length - DM_JOURNAL_KEEP);
      },
    });
    // A new scene or a closed tab while it thought: nothing of this turn may touch the new one.
    if (!tc.alive || tc.dmCtl !== ctl) return;
    tc.dmThinking = false;
    if (!outcome.ok) {
      handle.close();
      tc.dmCtl = null;
      tc.busy = false;
      tc.skipping = false;
      if (outcome.code === "not_granted" || outcome.code === "sampling_disabled") {
        tc.sampleState = "none";
        tc.dmStatus = outcome.message;
      }
      if (outcome.code === "cancelled") {
        // The player took it back: the Log and the suggested moves are as they were before the question, and nothing is said.
        const at = p.log.lastIndexOf(yourLine);
        if (at >= 0) {
          p.log.splice(at, 1);
          if (tc.said > at) tc.said -= 1;
        }
        p.options = prevOptions;
      } else {
        // The Log says it too, so a reply that was thrown away (and why the board did not change) is on the record.
        p.log.push({ text: outcome.code === "invalid_reply" ? "The DM's answer could not be used, so nothing changed." : outcome.message, tone: "plain" });
        tc.refuse(outcome.message);
      }
      tc.refreshAll();
      return;
    }
    let woken: string[] = [];
    try {
      woken = await tc.playReply(p, ctl, ask, outcome.reply, handle, exchange.current);
    } catch (err) {
      console.error("DM turn failed", err);
    }
    if (!tc.alive || tc.dmCtl !== ctl) return;
    tc.dmCtl = null;
    tc.busy = false;
    tc.skipping = false;
    tc.refreshAll();
    // Whoever the DM woke (or struck, or shoved) starts the fight, or joins the one that is on.
    const wake = woken.flatMap((id) => creatureById(p, id) ?? []).filter((c) => tc.needsFight(p, c));
    if (wake.length > 0) await tc.beginFight(false, wake);
    // The story may have brought something awake and hostile onto the board (a beat's spawn): the fight starts at once, as on arrival.
    else if (adventureOf(p) && !p.round && awakeHostiles(p).length > 0) await tc.beginFight(false, []);
    await tc.afterHeroAction();
  }

  // What the other modules call or read.
  tc.NO_DM = NO_DM;
  tc.peekSample = peekSample;
  tc.loadSample = loadSample;
  tc.cancelDm = cancelDm;
  tc.askStateFor = askStateFor;
  tc.packSections = packSections;
  tc.examineAt = examineAt;
  tc.runDm = runDm;
}
