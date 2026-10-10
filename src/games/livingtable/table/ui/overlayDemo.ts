/**
 * overlayDemo: cycles every overlay element once, for a harness to screenshot.
 */
import type { Overlay, InitiativeEntry } from "./overlayTypes";
import { internals } from "./createOverlay";

export interface OverlayDemoOptions {
  /** Multiplies every pause. Default 1; 0 runs the whole thing back to back. */
  pace?: number;
  /** Called (and awaited) as each step begins, so a harness can screenshot it. */
  onStep?: (name: string) => void | Promise<void>;
}

/**
 * Cycles every element once: the initiative strip, each banner, floating
 * numbers of every kind, two stacked roll plates, dialogue in each tone, a
 * refusal in the DM's voice. It queues a few story entries in the dialogue box (click it to read on) and leaves
 * the initiative strip on screen (call clear() to wipe them). Resolves when the last banner is gone.
 */
export async function overlayDemo(overlay: Overlay, opts: OverlayDemoOptions = {}): Promise<void> {
  const inner = internals.get(overlay);
  const W = inner?.root.clientWidth || 480;
  const H = inner?.root.clientHeight || 320;
  const pace = opts.pace ?? 1;
  const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * pace));
  const step = async (name: string) => {
    await opts.onStep?.(name);
  };

  const hero = { x: Math.round(W * 0.3), y: Math.round(H * 0.62) };
  const goblin = { x: Math.round(W * 0.68), y: Math.round(H * 0.5) };
  const entries: InitiativeEntry[] = [
    { id: "hero", label: "Aldric", total: 17, side: "hero" },
    { id: "goblin", label: "Goblin", total: 12, side: "enemy" },
  ];

  await step("say");
  overlay.say({ text: "A goblin spots you across the room." });
  await pause(300);
  await step("banner-initiative");
  const b1 = overlay.banner("Roll initiative", "initiative");
  await pause(500);
  overlay.initiative(entries, null, 1);
  await b1;

  await step("banner-turn");
  overlay.initiative(entries, "hero", 1);
  await overlay.banner("Your turn", "turn");

  await step("plate-hit");
  overlay.rollPlate(goblin, {
    roll: 14,
    modifier: 5,
    total: 19,
    target: 15,
    hit: true,
    sources: [
      { label: "Strength and training", amount: 3 },
      { label: "Keen Longsword", amount: 2 },
    ],
    caption: "Aldric attacks the goblin",
  });
  overlay.rollPlate(goblin, { roll: 20, modifier: 5, total: 25, target: 15, hit: true, critical: true, caption: "Aldric attacks the goblin" });
  await pause(900);
  await step("floats");
  overlay.say({ speaker: "Aldric", text: "Longsword attack: 14 + 5 = 19 against AC 15. Hit!" });
  overlay.float({ x: goblin.x, y: goblin.y }, "-6", "damage");
  await pause(350);
  overlay.float({ x: goblin.x, y: goblin.y }, "-6", "damage");
  overlay.float({ x: goblin.x, y: goblin.y }, "-3", "damage");
  await pause(500);
  overlay.float({ x: goblin.x, y: goblin.y }, "-14 CRIT!", "crit");
  overlay.float({ x: hero.x, y: hero.y }, "MISS", "miss");
  overlay.float({ x: hero.x + 90, y: hero.y }, "+5", "heal");
  overlay.float({ x: goblin.x - 120, y: goblin.y + 20 }, "Poisoned", "info");
  await pause(700);
  overlay.float({ x: goblin.x, y: goblin.y }, "DOWN", "down");
  overlay.say({ speaker: "Goblin", text: "Shinies! Give!", tone: "bad" });
  overlay.say({ text: "You drink a healing potion and recover 5 hit points.", tone: "good" });
  await pause(600);
  await step("refusal");
  overlay.say({ speaker: "DM", text: "The goblin is too far away to reach this turn.", repeat: true });
  await pause(900);
  await step("banner-enemy");
  overlay.initiative(entries, "goblin", 1);
  await overlay.banner("Goblin's turn", "enemy");
  await step("banner-victory");
  await overlay.banner("Victory", "victory");
  await step("banner-defeat");
  await overlay.banner("Defeat", "defeat");
  // Let the last plate and floats finish too, so "done" means the screen is quiet.
  for (let i = 0; i < 160 && inner && inner.root.dataset.busy !== "0"; i++) await new Promise<void>((r) => setTimeout(r, 50));
  await step("done");
}
