/**
 * What the hero screen shows for a class before it is chosen: the class drawn in its basic gear and its default numbers. Built from the same
 * sheet the quick start would play, so what is shown is what the player gets.
 *
 * The picture is the KayKit cast figure (the board's own, in the sheet's gear, idling and facing the viewer); the canvas stays empty until its
 * frames are decoded (ui/heroPicture.ts), and the hand-made pixel doll is never drawn for a class that has a KayKit version. Only a class with
 * none keeps the doll, and so does a host with no picture service (the asset bench), which draws it once and leaves it.
 */
import type { Adventure } from "../../adventures/types";
import { renderPlanFor } from "../../menu/equipment";
import { renderDoll } from "../../render/doll";
import { DOLL_CANVAS_SIZE } from "../../characters/equipmentTypes";
import { ABILITY_KEYS, type CharacterSheet } from "../../characters/creation";
import { getArchetype } from "../../characters/templates";
import { attackerBonusFor, effectiveArmorClass, weaponDamageNotationFor } from "../../session/combat";
import { adventureHero } from "../adventureCatalog";
import { renderManifest } from "../catalog";
import { PLAYABLE_HEROES } from "../state";
import { signed } from "./domKit";
import type { HeroPicture, HeroPictures } from "./heroPicture";

export interface HeroPreviewStat {
  label: string;
  value: string;
}

export interface HeroPreview {
  /**
   * The class in its basic gear. The doll is 32 source pixels a side at DOLL_SCALE canvas pixels each; the cast figure is drawn to the canvas's own
   * box. `data-art` on it says which ("cast", "wait" while the figure is made, or "doll" for a class with no KayKit version). Null when there is no page or no art to draw it from.
   */
  canvas: HTMLCanvasElement | null;
  /** The live picture behind `canvas`, when there is a picture service: the screen disposes it when it closes. */
  picture?: HeroPicture;
  /** The six abilities, then AC, HP, To hit and Damage. Empty for a class the game does not have. */
  stats: readonly HeroPreviewStat[];
}

/** Canvas pixels per source pixel. The screen shows the canvas at its own size, so every pixel stays square. */
export const DOLL_SCALE = 4;

const ABILITY_ABBR = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" } as const;

/** The default stats of a hero sheet, in the order the screen lists them. */
export function defaultStats(sheet: CharacterSheet): HeroPreviewStat[] {
  const bonus = attackerBonusFor(sheet);
  return [
    ...ABILITY_KEYS.map((k) => ({ label: ABILITY_ABBR[k], value: `${sheet.abilities[k]} (${signed(sheet.modifiers[k])})` })),
    { label: "AC", value: String(effectiveArmorClass(sheet)) },
    { label: "HP", value: String(sheet.maxHp) },
    { label: "To hit", value: signed(bonus) },
    { label: "Damage", value: weaponDamageNotationFor(sheet) },
  ];
}

function drawDoll(sheet: CharacterSheet): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  try {
    const manifest = renderManifest(sheet.template);
    const canvas = document.createElement("canvas");
    canvas.width = DOLL_CANVAS_SIZE * DOLL_SCALE;
    canvas.height = DOLL_CANVAS_SIZE * DOLL_SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    renderDoll(ctx, renderPlanFor(sheet), manifest, DOLL_SCALE);
    return canvas;
  } catch {
    // The art is not loaded yet, or has no picture of this class: the screen shows the words alone.
    return null;
  }
}

/**
 * The picture and default numbers of the playable class with this chassis ("fighter", "rogue", "wizard"), under the adventure's own starting kit.
 * With `pictures` the picture is live (the cast figure; the doll only for a class with no KayKit version); without it, the doll.
 */
export function heroPreview(adventure: Adventure, chassis: string, pictures?: HeroPictures): HeroPreview {
  const id = PLAYABLE_HEROES.find((h) => getArchetype(h).chassis === chassis);
  if (!id) return { canvas: null, stats: [] };
  try {
    const sheet = adventureHero(adventure, id);
    const picture = pictures?.picture({ sheet, still: drawDoll }) ?? null;
    if (picture) return { canvas: picture.canvas, picture, stats: defaultStats(sheet) };
    return { canvas: pictures ? null : drawDoll(sheet), stats: defaultStats(sheet) };
  } catch {
    return { canvas: null, stats: [] };
  }
}
