/**
 * The converted KayKit art library on the bench: the static sprites the
 * scripts/kaykit/lib_*.py makers and cast.py wrote, packed by
 * scripts/kaykit/pack-library.mjs and embedded with
 * build-bench.mjs --data kaylib=.cache/kaykit/bench-library.json.
 *
 * Per part: every sprite's palette indices (255 = transparent) concatenated,
 * zlib-compressed and base64-encoded, decoded with the browser's own
 * DecompressionStream. The animated cast is cast.ts.
 */

async function inflate(b64: string): Promise<Uint8Array> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface KLibPart {
  file: string;
  maker: string;
  size: 16 | 32;
  style: string | null;
  sprites: { assetId: string; w: number; h: number }[];
  gaps: { assetId: string; reason: string }[];
  data: string;
}

let libCached: KLibPart[] | null | undefined;

/** The packed library parts, or null when this bench was built without any. */
export function kaykitLibrary(): KLibPart[] | null {
  if (libCached !== undefined) return libCached;
  try {
    const el = typeof document !== "undefined" ? document.getElementById("bench-data-kaylib") : null;
    const parsed = el?.textContent ? (JSON.parse(el.textContent) as { parts: KLibPart[] }) : null;
    libCached = parsed && parsed.parts.length > 0 ? parsed.parts : null;
  } catch {
    libCached = null;
  }
  return libCached;
}

let libDecoded: Promise<Map<string, Map<string, number[][]>>> | null = null;

/** Every part's sprites as palette-index grids (-1 transparent), keyed by part file then asset id. Decoded once. */
export function decodeLibrary(): Promise<Map<string, Map<string, number[][]>>> {
  if (libDecoded) return libDecoded;
  const parts = kaykitLibrary() ?? [];
  libDecoded = Promise.all(
    parts.map(async (part) => {
      const raw = await inflate(part.data);
      const sprites = new Map<string, number[][]>();
      let o = 0;
      for (const s of part.sprites) {
        const rows: number[][] = [];
        for (let y = 0; y < s.h; y++) {
          const row = new Array<number>(s.w);
          for (let x = 0; x < s.w; x++) {
            const v = raw[o++]!;
            row[x] = v === 255 ? -1 : v;
          }
          rows.push(row);
        }
        sprites.set(s.assetId, rows);
      }
      return [part.file, sprites] as const;
    }),
  ).then((entries) => new Map(entries));
  return libDecoded;
}

/** The part file for a maker, size and (optional) style, as pack-library names them. */
export function partFile(maker: string, size: 16 | 32, style?: string): string {
  return style ? `${maker}-${style}-${size}.json` : `${maker}-${size}.json`;
}
