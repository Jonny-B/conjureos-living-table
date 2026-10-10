/**
 * A tiny, pure, dependency-free ZIP writer: store-only (no compression).
 *
 * The adventure export is a handful of text files, so compression buys little
 * and a stored archive is the simplest thing that every unzip tool opens. The
 * layout is the classic one: for each file a local header plus its bytes, then
 * a central directory with one record per file, then the end record.
 *
 * Details that matter:
 *   - Names are written as UTF-8 and general purpose bit 11 is set, so
 *     non-ASCII names survive in Windows Explorer, macOS and unzip.
 *   - Each entry carries its CRC-32 (IEEE, the ZIP polynomial 0xEDB88320).
 *   - No ZIP64: it throws a plain Error past 65535 entries or 4 GiB, rather
 *     than writing a corrupt archive.
 *   - Timestamps are DOS date and time in UTC (so output is deterministic for
 *     a given input). A file with no `modified` is stamped 1980-01-01 00:00,
 *     the DOS epoch, so this module never reads the clock.
 *   - Names are normalised to forward slashes with no leading slash; a name
 *     that is empty or tries to climb out with ".." is refused.
 *
 * No DOM, no Node APIs: runs in the browser and in node:test.
 */

export interface ZipFile {
  name: string;
  data: string | Uint8Array;
  modified?: Date;
}

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (IEEE 802.3, as ZIP uses it) of a byte array, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (t[(c ^ bytes[i]!) & 0xff]!) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date | undefined): { time: number; date: number } {
  const epoch = { time: 0, date: (0 << 9) | (1 << 5) | 1 };
  if (!d || Number.isNaN(d.getTime())) return epoch;
  const year = d.getUTCFullYear();
  if (year < 1980 || year > 2107) return epoch;
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

function cleanName(raw: string): string {
  const name = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!name) throw new Error("zip: empty file name");
  if (name.split("/").includes("..")) throw new Error("zip: file name may not contain '..': " + raw);
  return name;
}

/**
 * Build a valid store-only ZIP archive from the given files, in the given order.
 * Strings are encoded as UTF-8.
 */
export function zipStore(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  if (files.length > 0xffff) throw new Error("zip: too many files (no ZIP64 support)");

  const prepared = files.map((f) => {
    const nameBytes = enc.encode(cleanName(f.name));
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    return { nameBytes, data, crc: crc32(data), stamp: dosDateTime(f.modified) };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const p of prepared) {
    localSize += 30 + p.nameBytes.length + p.data.length;
    centralSize += 46 + p.nameBytes.length;
  }
  const total = localSize + centralSize + 22;
  if (total > 0xffffffff) throw new Error("zip: archive too large (no ZIP64 support)");

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  const offsets: number[] = [];

  const FLAGS = 0x0800; // bit 11: names are UTF-8
  const VERSION = 20; // 2.0, needed for stored entries with UTF-8 flag

  for (const p of prepared) {
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, VERSION, true);
    view.setUint16(pos + 6, FLAGS, true);
    view.setUint16(pos + 8, 0, true); // method 0: stored
    view.setUint16(pos + 10, p.stamp.time, true);
    view.setUint16(pos + 12, p.stamp.date, true);
    view.setUint32(pos + 14, p.crc, true);
    view.setUint32(pos + 18, p.data.length, true);
    view.setUint32(pos + 22, p.data.length, true);
    view.setUint16(pos + 26, p.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true); // no extra field
    out.set(p.nameBytes, pos + 30);
    out.set(p.data, pos + 30 + p.nameBytes.length);
    pos += 30 + p.nameBytes.length + p.data.length;
  }

  const centralStart = pos;
  prepared.forEach((p, i) => {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, (3 << 8) | VERSION, true); // made by: Unix, 2.0
    view.setUint16(pos + 6, VERSION, true);
    view.setUint16(pos + 8, FLAGS, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, p.stamp.time, true);
    view.setUint16(pos + 14, p.stamp.date, true);
    view.setUint32(pos + 16, p.crc, true);
    view.setUint32(pos + 20, p.data.length, true);
    view.setUint32(pos + 24, p.data.length, true);
    view.setUint16(pos + 28, p.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true); // extra
    view.setUint16(pos + 32, 0, true); // comment
    view.setUint16(pos + 34, 0, true); // disk number
    view.setUint16(pos + 36, 0, true); // internal attrs
    view.setUint32(pos + 38, ((0o100644 << 16) >>> 0), true); // external attrs: regular file rw-r--r--
    view.setUint32(pos + 42, offsets[i]!, true);
    out.set(p.nameBytes, pos + 46);
    pos += 46 + p.nameBytes.length;
  });

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, prepared.length, true);
  view.setUint16(pos + 10, prepared.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  view.setUint16(pos + 20, 0, true); // no comment
  return out;
}
