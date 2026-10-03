// Shim: the cast engine moved to the game (src/games/livingtable/table/ui/cast.ts).
// Until the bench host binds its own cast (L8), this shim feeds it the cast the
// bench build embeds, so the bench behaves as it did. Deleted with the other shims.
import { bindCastSource, type CastData } from "../../src/games/livingtable/table/ui/cast";

export * from "../../src/games/livingtable/table/ui/cast";

let embedded: CastData | null | undefined;
bindCastSource(() => {
  if (embedded !== undefined) return embedded;
  try {
    const el = typeof document !== "undefined" ? document.getElementById("bench-data-kaycast") : null;
    embedded = el?.textContent ? (JSON.parse(el.textContent) as CastData) : null;
  } catch {
    embedded = null;
  }
  return embedded;
});
