/**
 * Arrivals: a place's name and read-aloud, a scene's title and opening. They are story the player did not ask for, so they go to the
 * story screen (story.ts): the world is locked while it is read, and the normal DM box is not used.
 */
import { el } from "./domKit";
import { tidy } from "./screenHelpers";
import type { BannerKind } from "./overlayTypes";
import type { OverlayCtx } from "./overlayCtx";

export function installArrivals(oc: OverlayCtx): void {
  // Nothing is ever put in here now; plates.ts still asks whether a card is up, and the answer is always no.
  const cardsHost = el("div", "lto-cards");
  cardsHost.hidden = true;

  function showArrival(kind: "location" | "scene", titleIn: string, textIn: string | undefined): void {
    if (oc.destroyed) return;
    const title = tidy(titleIn);
    const text = (textIn ?? "").trim();
    if (!title && !text) return;
    // A place is headed in gold, a scene in blue: the new scene is what is happening.
    const ribbon: BannerKind = kind === "location" ? "turn" : "initiative";
    void oc.storyScreen({ title, text, ribbon });
  }

  function locationCard(o: { name: string; readAloud: string }): void {
    showArrival("location", o.name, o.readAloud);
  }
  function sceneCard(o: { title: string; opening?: string }): void {
    showArrival("scene", o.title, o.opening);
  }

  // What the other modules call or read.
  oc.cardsHost = cardsHost;
  oc.locationCard = locationCard;
  oc.sceneCard = sceneCard;
}
