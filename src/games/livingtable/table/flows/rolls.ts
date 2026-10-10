/**
 * Throwing dice on the table: the tray throw with its roll journal entry, the hero's tap-to-roll step, and a creature's throw in its own tray.
 */
import { type RollRecord } from "../../session/adventureExport";
import { sentenceCase } from "../../menu/labels";
import { foeDiceForToken } from "../ui/foeDice";
import { type DieKind, type RollRequest } from "../ui/dice";
import { ROLL_JOURNAL_KEEP, creatureLabel, type Creature, type PlayState } from "../state";
import type { TableCtx } from "../tableCtx";

  /** The numbers a roll's journal entry carries beside its dice (the export lists every roll: who, the dice, the numbers, the verdict). */
  export interface RollMeta {
    modifier?: number;
    total?: number;
    target?: number;
  }

export function installRolls(tc: TableCtx): void {
  /** Throw dice in the tray, and write the throw in the roll journal. Every throw on the table goes through here. */
  function throwDice(req: RollRequest, who: string, meta: RollMeta = {}): Promise<void> {
    const rec: RollRecord = {
      at: new Date().toISOString(),
      who,
      label: req.label ?? "",
      dice: req.dice.map((d) => ({ kind: d.kind, result: d.result })),
      ...(meta.modifier !== undefined ? { modifier: meta.modifier } : {}),
      ...(meta.total !== undefined ? { total: meta.total } : {}),
      ...(meta.target !== undefined ? { target: meta.target } : {}),
      ...(req.detail ? { verdict: req.detail } : {}),
    };
    const journal = tc.st().rollJournal;
    journal.push(rec);
    if (journal.length > ROLL_JOURNAL_KEEP) journal.splice(0, journal.length - ROLL_JOURNAL_KEEP);
    return tc.tray.roll(req);
  }

  /** Wait for the player's tap on the tray (unless the tray rolls for them), then throw. */
  async function rollStep(prompt: string, dice: readonly { kind: DieKind; result: number }[], label: string, detail: string, tone: "good" | "bad" | "plain", meta?: RollMeta): Promise<void> {
    if (tc.rollMyself) await tc.tray.awaitRoll(prompt, dice.map((d) => d.kind));
    await throwDice({ dice, label, detail, tone }, tc.st().hero.name, meta);
  }

  /** A creature's throw: in ITS tray, with its own dice and its name on the rim (foeDice.ts: the better the enemy, the fancier the die and the tray). It rolls itself; nobody taps. */
  function foeThrow(p: PlayState, c: Creature, dice: readonly { kind: DieKind; result: number }[], label: string, detail: string, tone: "good" | "bad" | "plain", meta?: RollMeta): Promise<void> {
    const foe = foeDiceForToken(c.token);
    const who = c.seen ? creatureLabel(p, c) : "";
    return throwDice({ dice, label, detail, tone, skin: foe.skinId, tray: foe.trayId, who: c.seen ? `${sentenceCase(who)} rolls` : "Something rolls" }, c.seen ? sentenceCase(who) : "Something", meta);
  }

  // What the other modules call or read.
  tc.throwDice = throwDice;
  tc.rollStep = rollStep;
  tc.foeThrow = foeThrow;
}
