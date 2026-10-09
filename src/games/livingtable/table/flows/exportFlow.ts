/**
 * The debug export: the adventure and its journals as a bundle, saved as a zip or copied as JSON.
 */
import { ADVENTURE_FORMAT, ADVENTURE_VERSION, adventureFilename, adventureFiles, type AdventureBundle } from "../../session/adventureExport";
import { zipStore } from "../../session/zip";
import { type AdventureProgress } from "../../adventures/types";
import { type PlayState } from "../state";
import { toSnapshot } from "../snapshot";
import { benchAdventures } from "../adventureCatalog";
import { adventureOf, sceneLayout } from "../adventureRun";
import type { TableCtx } from "../tableCtx";

  /** The bundle plus the adventure: the zip's adventure.json carries every field (the engine's file list is written from the bundle as it is). */
  export type BenchBundle = AdventureBundle & {
    adventure: {
      id: string;
      title: string;
      version: number;
      author: "owner" | "ai";
      file: string;
      progress: AdventureProgress;
      sceneId: string;
      locationId: string;
      source: string;
      lastBrief: string | null;
    } | null;
  };

export function installExportFlow(tc: TableCtx): void {
  // ---- the debug export ----------------------------------------------------------------------------

  /**
   * The adventure part of the export: which adventure (id, title, version, author, the file it came from), where the story stands (the
   * progress record, the scene, the place), the whole Markdown the adventure was read from (so a debug export can reproduce the run) and the
   * brief the DM was last given. Null in a test room.
   */
  function exportedAdventure(p: PlayState): BenchBundle["adventure"] {
    const a = adventureOf(p);
    if (!a || !p.progress) return null;
    const entry = benchAdventures().find((e) => e.adventure === a);
    return {
      id: a.id,
      title: a.title,
      version: a.version,
      author: a.author,
      file: entry?.file ?? "",
      progress: JSON.parse(JSON.stringify(p.progress)) as AdventureProgress,
      sceneId: p.progress.sceneId,
      locationId: p.progress.locationId,
      source: entry?.source ?? "",
      lastBrief: tc.host.env.debugExport ? tc.lastBrief : null,
    };
  }

  /** The files of the zip: the engine's own list, and for an adventure its Markdown and the last brief on their own as readable text. */
  function exportFiles(bundle: BenchBundle): { name: string; data: string }[] {
    const files = adventureFiles(bundle);
    const ad = bundle.adventure;
    if (ad) {
      files.push({ name: "adventure-source.md", data: ad.source });
      files.push({ name: "dm-brief.txt", data: ad.lastBrief ?? "The DM has not been asked anything in this game yet.\n" });
    }
    return files;
  }

  function exportZip(bundle: BenchBundle, now: Date = new Date()): { filename: string; bytes: Uint8Array } {
    return { filename: adventureFilename(now), bytes: zipStore(exportFiles(bundle).map((f) => ({ name: f.name, data: f.data, modified: now }))) };
  }

  /** The whole adventure so far, as the export's bundle: the state, the sheet, the scene, every save, the full log, every DM exchange and every roll. */
  function adventureBundle(): BenchBundle {
    const p = tc.st();
    const adventure = exportedAdventure(p);
    return {
      ...(adventure ? { notes: `Adventure: ${adventure.title} (${adventure.id}, version ${adventure.version}). adventure-source.md is the Markdown it was played from, dm-brief.txt is the brief the DM was last given, and adventure.json has the story's progress.` } : {}),
      adventure,
      format: ADVENTURE_FORMAT,
      version: ADVENTURE_VERSION,
      exportedAt: new Date().toISOString(),
      build: { ...tc.host.env.build, userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent },
      settings: { art: tc.host.art.signature(), textStyle: tc.textStyle, zoom: tc.scale, rollMyself: tc.rollMyself, autoEndTurn: tc.host.settings.get().autoEndTurn !== false, diceSkin: tc.tray.skin().id, reducedMotion: tc.reducedMotion, template: p.template },
      character: p.hero,
      scene: {
        template: p.template,
        floorId: p.floorId,
        layout: sceneLayout(p, false),
        heroAt: p.heroAt,
        room: p.room,
        creatures: p.creatures.map(({ actor: _actor, ...c }) => c),
        doorOpen: p.doorOpen,
        doorLocked: p.doorLocked,
        doorLockDc: p.doorLockDc,
        searched: p.searched,
        extraProps: p.extraProps,
        tileOverrides: p.tileOverrides,
        bodies: p.bodies,
        piles: p.piles,
      },
      state: toSnapshot(p),
      saves: [...tc.session.saves.list()],
      log: [...tc.session.log.lines, ...p.log].map((l) => ({ text: l.text, tone: l.tone })),
      dm: tc.host.env.debugExport ? p.dmJournal : [],
      rolls: p.rollJournal,
    };
  }

  function setExportStatus(text: string | undefined, copy: boolean): void {
    tc.exportStatus = text;
    tc.exportCopyShown = copy;
    tc.renderHud();
  }

  const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))} KB`;
  let exporting = false;

  /**
   * Save the whole adventure as one zip (the DM transcript, the log, every roll, the sheet, the saves and the state), with the
   * artifact runtime's downloads capability. If the viewer has none, a plain browser download, and a "Copy adventure JSON" button
   * for when even that is blocked. The status line under the button says in words which of these happened.
   */
  async function exportAdventure(): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      let built: { filename: string; bytes: Uint8Array };
      try {
        built = exportZip(adventureBundle());
      } catch (err) {
        setExportStatus(`Could not build the export: ${err instanceof Error ? err.message : "unknown error"}. Try Copy adventure JSON.`, true);
        return;
      }
      const { filename, bytes } = built;
      const res = await tc.host.files.save(filename, bytes);
      if (res.via === "capability") {
        if (res.declined) return setExportStatus("Not saved: you declined. Press Export again when you are ready.", false);
        return setExportStatus(res.status === "delivered" ? `Sent ${filename} (${kb(bytes.length)}).` : `Saved ${filename} (${kb(bytes.length)}).`, false);
      }
      if (res.status === "rate_limited") return setExportStatus("Another save prompt is still open. Answer it, then press Export again.", false);
      // A plain browser download (an object URL and a link) is the next best thing; whether the browser lets it through cannot be seen from here.
      setExportStatus(
        res.via === "browser"
          ? `${res.status === "capability_failed" ? "The save did not go through, so " : "Saving files is not available here, so "}${filename} (${kb(bytes.length)}) was offered as a plain browser download. If nothing was saved, press Copy adventure JSON.`
          : "The browser would not start a download. Press Copy adventure JSON.",
        true,
      );
    } finally {
      exporting = false;
    }
  }

  /** The fallback of last resort: adventure.json (the whole adventure in one file) on the clipboard. */
  async function copyAdventureJson(): Promise<void> {
    const json = adventureFiles(adventureBundle()).find((f) => f.name === "adventure.json")?.data ?? "";
    try {
      await navigator.clipboard.writeText(json);
      return setExportStatus(`Copied adventure.json (${kb(json.length)}) to the clipboard.`, true);
    } catch {
      // The async clipboard can be blocked in a frame: the old way, through a hidden text box.
    }
    try {
      const box = document.createElement("textarea");
      box.value = json;
      box.setAttribute("readonly", "");
      box.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      if (ok) return setExportStatus(`Copied adventure.json (${kb(json.length)}) to the clipboard.`, true);
    } catch {
      // fall through
    }
    setExportStatus("The browser blocked the clipboard, so nothing was copied.", true);
  }

  // What the other modules call or read.
  tc.exportFiles = exportFiles;
  tc.adventureBundle = adventureBundle;
  tc.exportAdventure = exportAdventure;
  tc.copyAdventureJson = copyAdventureJson;
}
