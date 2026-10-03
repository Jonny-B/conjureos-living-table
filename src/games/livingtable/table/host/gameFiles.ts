/**
 * The game's side of the table window's file saving (TableHost.files): the adventure
 * export, handed to the player as a browser download through an object URL and a
 * hidden link.
 *
 * Inside the app store the page has no downloads capability (that is an artifact
 * runtime feature the bench uses on claude.ai), so the object URL is the only way and
 * `via` is always "browser" or "none". Whether the browser lets the download through
 * cannot be seen from here: it may sit behind a frame's sandbox. "browser" means the
 * click was made, not that a file landed. The window keeps its "Copy adventure JSON"
 * fallback for that reason.
 */
import type { TableFiles } from "../host";

/** What a download needs from the page. Each default is the real global, resolved on use. */
export interface FilesEnv {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** Make the hidden link, put it in the page, click it, take it out. Returns false when there is no page to do that in. */
  click(url: string, filename: string): boolean;
  /** Schedule the revoke. Default: setTimeout. */
  later(fn: () => void, ms: number): void;
}

/** How long the object URL lives. A download starts at once; this only has to outlast the click. */
export const REVOKE_AFTER_MS = 10_000;

const MIME: Record<string, string> = {
  zip: "application/zip",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
};

/** The content type for a file name, by its extension. Unknown ones are plain bytes. */
export function mimeFor(filename: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** A file name the browser will accept as is: path separators and the characters Windows refuses become hyphens. */
export function safeFilename(filename: string): string {
  const cleaned = filename.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
  return cleaned.length > 0 ? cleaned : "download";
}

function browserEnv(): FilesEnv {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    click(url, filename) {
      if (typeof document === "undefined") return false;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    },
    later: (fn, ms) => void setTimeout(fn, ms),
  };
}

export function createGameFiles(env: Partial<FilesEnv> = {}): TableFiles {
  return {
    async save(filename, bytes) {
      const e: FilesEnv = { ...browserEnv(), ...env };
      let url: string | null = null;
      try {
        const name = safeFilename(filename);
        // The cast is the same one the bench makes: TypeScript's Uint8Array is generic over its buffer and BlobPart is not.
        url = e.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mimeFor(name) }));
        if (!e.click(url, name)) throw new Error("no page");
        const made = url;
        e.later(() => e.revokeObjectURL(made), REVOKE_AFTER_MS);
        return { via: "browser" };
      } catch {
        if (url) e.revokeObjectURL(url);
        return { via: "none", status: "The browser would not start a download." };
      }
    },
  };
}
