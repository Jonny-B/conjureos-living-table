/**
 * Bodies, piles and item cards: the loot window, taking loot, item actions, using things nearby, drinking potions.
 */
import { equipItem, itemActionsFor, itemUseSay, unequipItem } from "../../inventory/itemActions";
import { isPlayersTurn } from "../../menu/combatRound";
import { type CombatEvent } from "../../session/combatEvents";
import { type LootWindowItem } from "../ui/overlay";
import { type DieKind } from "../ui/dice";
import { playClips } from "../ui/cast";
import { tileDistance } from "../../world/reach";
import { DOWN_NOTE, heroDown, same, type XY } from "../state";
import {
  bodyLootItems,
  destroyFromPack,
  dropFromPack,
  ensureBodyLoot,
  hostileNear,
  itemCtx,
  itemRefFor,
  lootNear,
  pileAt,
  pileLootItems,
  takeFromBodyInto,
  takeFromPileInto,
} from "../gearLoot";
import { doorOrChestUsable, drinkPotionRules, heroInteractRules, lastPotionDice } from "../fightRules";
import { advUseFor } from "../adventureRun";
import type { TableCtx } from "../tableCtx";

export function installLoot(tc: TableCtx): void {
  // ---- bodies, piles and item cards ----------------------------------------------

  function closeLoot(): void {
    tc.lootWin?.close();
    tc.lootWin = null;
    tc.lootTarget = null;
  }

  /** What the open window lists now. */
  function lootItemsNow(): LootWindowItem[] {
    const p = tc.st();
    const t = tc.lootTarget;
    if (!t) return [];
    if (t.kind === "body") {
      const b = p.bodies.find((x) => x.id === t.id);
      return b ? bodyLootItems(p, b) : [];
    }
    return pileLootItems(p, t.at);
  }

  function showLoot(target: NonNullable<typeof tc.lootTarget>, title: string): void {
    closeLoot();
    tc.lootTarget = target;
    tc.lootWin = tc.overlay.lootWindow({
      title,
      items: lootItemsNow(),
      onTake: (key) => takeLoot(key),
      onClose: () => {
        tc.lootWin = null;
        tc.lootTarget = null;
        tc.refreshAll();
      },
    });
    tc.refreshAll();
  }

  /**
   * Search what lies on a square: an unsearched body first (its first search rolls the engine's loot), then a pile. From further than one square the
   * hero walks up to it and searches on arrival (a walk that is cut short searches nothing); `walked` is true on that second call, so it cannot walk twice.
   */
  function openLootAt(tile: XY, walked = false): void {
    if (tc.busy || tc.overlayOpen()) return;
    const p = tc.st();
    if (heroDown(p)) return tc.refuse(DOWN_NOTE);
    if (p.round && !isPlayersTurn(p.round)) return tc.refuse("Wait for your turn.");
    if (tileDistance(p.heroAt, tile) > 1) {
      if (walked) return tc.refuse("Too far away. Step next to it.");
      if (!tc.approachCost(tile).reachable) return tc.refuse(p.round ? "You cannot reach it this turn." : "You cannot get next to it from here.");
      return tc.walkThen(tile, () => openLootAt(tile, true));
    }
    const body = p.bodies.find((b) => same(b.at, tile) && !b.looted);
    if (body) {
      tc.clearOptions();
      ensureBodyLoot(p, body);
      tc.flushLog();
      if (body.looted) {
        tc.refreshAll();
        return tc.refuse(`There is nothing on the ${body.name.toLowerCase()}'s body.`);
      }
      return showLoot({ kind: "body", id: body.id }, `The ${body.name.toLowerCase()}'s body`);
    }
    if (pileAt(p, tile)) return showLoot({ kind: "pile", at: { ...tile } }, "On the ground");
    tc.refuse(p.bodies.some((b) => same(b.at, tile)) ? "You have already searched that body." : "There is nothing to take here.");
  }

  /** A Take button of the open window (an item's key), or Take all. Whatever stays behind, and why, is said in a notice. */
  function takeLoot(key: string | "all"): void {
    const p = tc.st();
    const t = tc.lootTarget;
    if (!t || !tc.lootWin) return;
    if (tc.busy) return tc.refuse("Wait until the table is free.");
    if (heroDown(p)) {
      closeLoot();
      return tc.refuse(DOWN_NOTE);
    }
    const at = t.kind === "body" ? p.bodies.find((b) => b.id === t.id)?.at : t.at;
    if (!at || tileDistance(p.heroAt, at) > 1) {
      closeLoot();
      return tc.refuse("Too far away. Step next to it.");
    }
    const refusals = t.kind === "body" ? takeFromBodyInto(p, t.id, key) : takeFromPileInto(p, t.at, key);
    tc.clearOptions();
    tc.flushLog();
    tc.lootWin.update(lootItemsNow());
    if (refusals.length > 0) tc.refuse(refusals.length === 1 ? refusals[0]! : `${refusals[0]!} (${refusals.length - 1} more stayed behind.)`);
    tc.refreshAll();
  }

  /** A button on an item card, in the pack or on the sheet: the engine's own equip, unequip, drop and destroy, or Use. */
  async function runItemAction(key: string, id: string): Promise<void> {
    if (tc.busy) return tc.refuse("Wait until the table is free.");
    const p = tc.st();
    const ref = itemRefFor(p, key);
    if (!ref) return tc.refuse("You do not have that any more.");
    const name = key.slice(key.indexOf(":") + 1);
    const act = itemActionsFor(p.hero, ref, itemCtx(p)).find((a) => a.id === id);
    if (!act) return;
    if (!act.enabled) return tc.refuse(act.reason ?? "You cannot do that now.");
    tc.clearOptions();
    if (id === "equip") {
      const r = equipItem(p.hero, ref, { hostilesPresent: hostileNear(p) });
      if (r.refused) return tc.refuse(r.refused);
      p.hero = r.sheet;
      p.log.push({ text: r.line, tone: "plain" });
    } else if (id === "unequip" && ref.where === "worn") {
      const r = unequipItem(p.hero, ref.slot, { hostilesPresent: hostileNear(p) });
      if (r.refused) return tc.refuse(r.refused);
      p.hero = r.sheet;
      p.log.push({ text: r.line, tone: "plain" });
    } else if (id === "drop") {
      const why = dropFromPack(p, ref);
      if (why) return tc.refuse(why);
    } else if (id === "destroy") {
      const why = destroyFromPack(p, ref, name);
      if (why) return tc.refuse(why);
    } else if (id === "use") {
      // The board and the dice tray are where a use plays out: the sheet gets out of the way.
      tc.closeSheet();
      const kit = (p.hero.consumables ?? []).some((c) => c.name === name);
      if (ref.where === "consumable" || kit) {
        await (/^potion of healing$/i.test(name) ? drinkPotion() : drinkPotion(name));
        return;
      }
      const say = itemUseSay(p.hero, ref, itemCtx(p));
      if (say) await tc.runDm({ kind: "freehand", text: say });
      return;
    }
    tc.flushLog();
    tc.refreshAll();
  }

  async function useNearby(): Promise<void> {
    if (tc.busy) return;
    const p = tc.st();
    // An adventure's place: go through the way out underfoot, search or look at what is beside the hero, else search a body or a pile.
    if (p.adventureId) {
      const u = advUseFor(p);
      if (u?.kind === "exit") return tc.useExit(u.exit);
      if (u?.kind === "feature") return tc.featureFlow(u.at);
      const loot = lootNear(p);
      if (loot) return openLootAt(loot.kind === "body" ? loot.body.at : loot.at);
      return tc.refuse("Nothing to use here. Stand on a way out, or next to something you can search.");
    }
    // Something to search beside you, and no door or chest to use: E searches it.
    const loot = lootNear(p);
    if (loot && !doorOrChestUsable(p)) return openLootAt(loot.kind === "body" ? loot.body.at : loot.at);
    const r = heroInteractRules(p);
    if (r.refused) {
      // Nothing to use, but a body you have already been through is right there: say so.
      const searched = p.bodies.find((b) => b.looted && tileDistance(p.heroAt, b.at) <= 1);
      return tc.refuse(searched && /^Nothing to use here/.test(r.refused) ? `You have already searched the ${searched.name.toLowerCase()}'s body.` : r.refused);
    }
    tc.clearOptions();
    if (!tc.reducedMotion) playClips(p.heroActor, ["interact"], performance.now());
    tc.stage.invalidate();
    await tc.afterHeroAction();
  }

  /** The potion, or (with a name) one of the sheet's other healing consumables. */
  async function drinkPotion(kit?: string): Promise<void> {
    if (tc.busy) return;
    const p = tc.st();
    const r = drinkPotionRules(p, kit);
    if (r.refused) return tc.refuse(r.refused);
    tc.clearOptions();
    tc.busy = true;
    const heal = r.events.find((e): e is Extract<CombatEvent, { kind: "heal" }> => e.kind === "heal");
    const rolls = lastPotionDice;
    await tc.rollStep("Tap to roll healing", rolls.map((v) => ({ kind: "d4" as DieKind, result: v })), `${rolls.join(" + ")} + 2 = ${rolls.reduce((a, b) => a + b, 2)}`, heal ? `+${heal.amount} HP` : "HEALED", "good");
    tc.busy = false;
    if (!tc.reducedMotion) playClips(p.heroActor, ["cheer"], performance.now());
    tc.showAttack(r.events, "hero");
    await tc.afterHeroAction();
  }

  // What the other modules call or read.
  tc.closeLoot = closeLoot;
  tc.openLootAt = openLootAt;
  tc.runItemAction = runItemAction;
  tc.useNearby = useNearby;
  tc.drinkPotion = drinkPotion;
}
