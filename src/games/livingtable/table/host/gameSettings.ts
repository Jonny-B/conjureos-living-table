/**
 * The game's side of the table window's settings (TableHost.settings): the text style,
 * roll-it-myself, the dice skin and the board zoom, kept in localStorage under the
 * table's own key (see gameStorage.ts for the envelope and the version field).
 *
 * `get()` always returns a complete, valid TableSettings: a stored value that is the
 * wrong type or out of range is ignored field by field, so one bad field never costs
 * the others. `set()` ignores invalid fields the same way, merges the rest and keeps
 * them. A zoom of null means "let the window pick from the screen".
 */
import type { TableSettings, TableSettingsHost, TextStyle } from "../host";
import { TABLE_KEYS, browserStore, readEnvelope, writeEnvelope, type KeyValueStore } from "./gameStorage";

export const DEFAULT_SETTINGS: Readonly<TableSettings> = Object.freeze({
  textStyle: "pixel",
  rollMyself: true,
  diceSkin: "bone",
  zoom: null,
});

/** The zoom the board offers, whole steps. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

const TEXT_STYLES: readonly TextStyle[] = ["pixel", "storybook"];

/** The fields of `raw` that are valid, as a partial settings object. Anything else is dropped. */
export function validSettings(raw: unknown): Partial<TableSettings> {
  const out: Partial<TableSettings> = {};
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.textStyle === "string" && (TEXT_STYLES as readonly string[]).includes(r.textStyle)) out.textStyle = r.textStyle as TextStyle;
  if (typeof r.rollMyself === "boolean") out.rollMyself = r.rollMyself;
  if (typeof r.diceSkin === "string" && r.diceSkin.length > 0 && r.diceSkin.length <= 64) out.diceSkin = r.diceSkin;
  if (r.zoom === null) out.zoom = null;
  else if (typeof r.zoom === "number" && Number.isInteger(r.zoom) && r.zoom >= ZOOM_MIN && r.zoom <= ZOOM_MAX) out.zoom = r.zoom;
  return out;
}

export interface GameSettingsOptions {
  /** Where to keep them. Default: the browser's localStorage. */
  store?: KeyValueStore | null;
  /** The dice skins the player owns (the free ones plus any bought). Default: just the bone set. */
  ownedDiceSkins?: () => string[];
}

export function createGameSettings(opts: GameSettingsOptions = {}): TableSettingsHost {
  const store = (): KeyValueStore | null => (opts.store !== undefined ? opts.store : browserStore());
  const owned = (): string[] => {
    const list = opts.ownedDiceSkins?.() ?? [];
    return list.length > 0 ? [...list] : [DEFAULT_SETTINGS.diceSkin];
  };
  let held: TableSettings | null = null;

  function load(): TableSettings {
    if (held) return held;
    const env = readEnvelope(store(), TABLE_KEYS.settings);
    held = { ...DEFAULT_SETTINGS, ...validSettings(env?.settings) };
    return held;
  }

  return {
    get() {
      const s = load();
      // A skin that is no longer owned (or never was) falls back to the first one that is, without forgetting the choice.
      const skins = owned();
      return { ...s, diceSkin: skins.includes(s.diceSkin) ? s.diceSkin : skins[0] ?? DEFAULT_SETTINGS.diceSkin };
    },
    set(p) {
      held = { ...load(), ...validSettings(p) };
      // A failed write is not an error here: the settings still hold for this visit.
      writeEnvelope(store(), TABLE_KEYS.settings, { settings: held });
    },
    ownedDiceSkins: owned,
  };
}
