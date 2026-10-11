/**
 * Starting an adventure: the start screen, the AI adventure writer, the hero screen, test rooms, and beginning and flushing an adventure.
 */
import { getArchetype } from "../../characters/templates";
import { type CharacterSheet } from "../../characters/creation";
import { BESTIARY } from "../../rules/bestiary";
import { type StartHeroHook } from "../ui/overlay";
import { roomsShown } from "../ui/screenHelpers";
import { heroPreview } from "../ui/heroPreview";
import { openCreation } from "../ui/sheet";
import { writeAdventure as writeAiAdventure, type AdventureWriterContext, type CompleteInput } from "../../adventures/generate";
import { heroHook, sceneOf, startingKitFor } from "../../adventures/types";
import { ARCHETYPE_LABEL, ROOM_CHOICES, ROOM_FLOOR, awakeHostiles, isRec, newPlay, roomLabel, type RoomChoice } from "../state";
import { adventureAssets } from "../catalog";
import { type ArchetypeId } from "../../characters/equipmentTypes";
import {
  TEMPLATE_FILE,
  adventureHeroFromCreator,
  benchAdventures,
  creatorStartFor,
  kitWords,
  registerAiAdventure,
  startCardsFor,
  type BenchAdventure,
} from "../adventureCatalog";
import { adventureOf, currentLocation, newAdventurePlay, syncItems } from "../adventureRun";
import { AI_WRITER_NOTE } from "./tableKit";
import type { TableCtx } from "../tableCtx";

export function installAdventureStart(tc: TableCtx): void {
  // ---- the adventure: the start screen, its heroes, moving between places, the story's cards ----------------------
  //
  // The Play tab opens on the start screen (overlay.ts startScreen): the owner's adventures, the test rooms, and the AI writer. An adventure
  // goes to the hero screen (a quick start for a class, or the character creator with the adventure's kit), then the game begins at the
  // adventure's start. The story is progress.ts (the adventure is gospel): the game tells it what happened, it says what that did.

  function closeScreens(): void {
    const screens = [tc.startScr, tc.heroScr, tc.endScr, tc.menuScr];
    tc.startScr = null;
    tc.heroScr = null;
    tc.endScr = null;
    tc.menuScr = null;
    for (const s of screens) s?.close();
  }

  const ROOM_SUMMARY: Record<RoomChoice, string> = {
    one: "A two-room test scene: a door, a chest and one goblin asleep in the east room. No story, for trying the rules.",
    two: "The same two rooms with a goblin and a skeleton, each with its own hit points, dice and turn. No story.",
  };

  function showStart(): void {
    tc.closeViews();
    closeScreens();
    // A game in progress stays reachable (the main menu's Continue) while the adventure list is up.
    if (!tc.session.atStart) tc.session.paused = true;
    tc.session.atStart = true;
    tc.startScr = tc.overlay.startScreen({
      adventures: startCardsFor(benchAdventures()),
      // The two test rooms are for dev builds and local pages; a published game does not list them (the host decides, env.testRooms).
      sandboxes: roomsShown(tc.host.env) ? ROOM_CHOICES.map((r) => ({ id: `room:${r}`, title: roomLabel(tc.st().template, r), summary: ROOM_SUMMARY[r] })) : [],
      aiNote: AI_WRITER_NOTE,
      onPick: (id) => pickStart(id),
      onWrite: (premise) => void writeNewAdventure(premise),
      // Where the host has a main menu, the list has a way back to it.
      ...(tc.host.env.mainMenu ? { onMenu: () => tc.openMainMenu() } : {}),
    });
    tc.viewsChanged();
  }

  function pickStart(id: string): void {
    if (id.startsWith("room:")) {
      const room = id.slice(5) as RoomChoice;
      if (ROOM_CHOICES.includes(room)) startSandbox(room);
      return;
    }
    const entry = benchAdventures().find((e) => e.id === id && e.adventure);
    if (entry) showHero(entry);
  }

  /**
   * The AI writer. Called only by the start screen's "Yes, write it" (the confirm is the screen's own), once per press. It asks the model through
   * the sample capability (the complex tier: a whole adventure is long; no cache, a repeat must be fresh), with the engine's
   * writeAdventure checking every answer and sending the problems back for a repair. Cancel (or leaving the tab) stops the call in flight. A
   * finished adventure joins the start screen as "AI written" and is kept in this browser; a failure says why, in plain words, and keeps nothing.
   */
  async function writeNewAdventure(premise: string): Promise<void> {
    const screen = tc.startScr;
    if (!screen) return;
    const sample = tc.peekSample() ?? tc.sampleFn;
    if (!sample) {
      screen.setWriting(null);
      if (tc.sampleState === "pending") screen.setNote("The DM is still waking. Try again in a moment.");
      else screen.setProblems([tc.host.dm.writerUnavailable ?? `${tc.host.dm.unavailable} Nothing was sent.`]);
      return;
    }
    const ctl = new AbortController();
    tc.writerCtl?.abort();
    tc.writerCtl = ctl;
    const cancel = (): void => ctl.abort();
    const complete = (input: CompleteInput): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        if (ctl.signal.aborted) return reject(new Error("The writer was stopped."));
        const onAbort = (): void => reject(new Error("The writer was stopped."));
        ctl.signal.addEventListener("abort", onAbort, { once: true });
        const done = (): void => ctl.signal.removeEventListener("abort", onAbort);
        try {
          sample(input, { modelTier: "complex", cache: false, signal: ctl.signal }).then(
            (r) => {
              done();
              resolve(typeof r?.text === "string" ? r.text : "");
            },
            (e: unknown) => {
              done();
              reject(new Error(writerFailureWords(e)));
            },
          );
        } catch (e) {
          done();
          reject(new Error(writerFailureWords(e)));
        }
      });
    screen.setWriting({ stage: "Starting the writer", canCancel: true }, cancel);
    let result: Awaited<ReturnType<typeof writeAiAdventure>>;
    try {
      result = await writeAiAdventure(complete, { premise, length: "short" }, writerContext(), {
        onProgress: (stage) => {
          if (tc.alive && tc.startScr && !ctl.signal.aborted) tc.startScr.setWriting({ stage, canCancel: true }, cancel);
        },
      });
    } catch (e) {
      result = { ok: false, errors: [`The writer could not finish: ${writerFailureWords(e)}`] };
    }
    if (tc.writerCtl === ctl) tc.writerCtl = null;
    if (!tc.alive) return;
    const now = tc.startScr;
    if (ctl.signal.aborted) {
      now?.setWriting(null);
      now?.setNote("Stopped. Nothing was kept.");
      return;
    }
    if (!result.ok) {
      now?.setWriting(null);
      now?.setProblems([...result.errors, "Nothing was kept. You can try again, or change the idea."]);
      return;
    }
    const entry = registerAiAdventure(result.markdown);
    if (!entry.adventure) {
      now?.setWriting(null);
      now?.setProblems([...entry.problems, "Nothing was kept. You can try again, or change the idea."]);
      return;
    }
    // The new card is on the list (the AI written pill) and stays there on later visits; the start screen is built again to show it.
    if (now) {
      showStart();
      tc.startScr?.setNote(`"${entry.title}" is ready, written by the AI. It is on the list and kept on this device.`);
    }
  }

  /** What the AI writer needs to know: the pictures and creatures the game has, and the format by example (adventures/TEMPLATE.md). */
  function writerContext(): AdventureWriterContext {
    const template = tc.host.adventures.files().find((f) => f.file === TEMPLATE_FILE)?.text ?? "";
    return { assets: adventureAssets(), creatures: BESTIARY.map((b) => b.id), template };
  }

  /** A sample failure in plain words (raw provider text is never shown). */
  function writerFailureWords(e: unknown): string {
    const code = isRec(e) && typeof e.code === "string" ? e.code : "";
    if (code === "not_granted") return "Claude has not been allowed to write for you here.";
    if (code === "rate_limited") return "Claude needs a moment. Try again shortly.";
    if (code === "cancelled") return "The writer was stopped.";
    return "Claude could not answer.";
  }

  /** After an adventure is picked: a quick start for each class that can be played (the adventure's own hook and kit for it), or the creator. */
  function showHero(entry: BenchAdventure): void {
    const a = entry.adventure;
    if (!a) return;
    tc.closeViews();
    closeScreens();
    tc.heroScr = tc.overlay.startHero({
      adventureTitle: a.title,
      hooks: tc.heroIds.map((id): StartHeroHook => {
        const chassis = getArchetype(id).chassis;
        return { chassis, label: ARCHETYPE_LABEL[id], hook: heroHook(a, chassis) ?? a.summary, kit: kitWords(startingKitFor(a, chassis)) };
      }),
      // The class picker shows each class in its starting gear with its default stats (built from the adventure's own kit), as the cast figure when it is loaded.
      preview: (chassis) => heroPreview(a, chassis, tc.pictures),
      onCreate: () => openAdventureCreation(entry),
      // A named hero is required, however the player got here: "Play as the Knight" opens the maker on its Name step with that class and the
      // adventure's kit, and nothing else changed from the slide's default stats, so Begin waits for a name and then starts the hero the slide showed.
      onQuick: (chassis) => {
        const id = tc.heroIds.find((h) => getArchetype(h).chassis === chassis);
        if (id) openAdventureCreation(entry, id);
      },
      onBack: () => showStart(),
    });
    tc.viewsChanged();
  }

  /**
   * The character creator, started from the adventure's kit for a class (it is built again with the kit of the class the hero ended up as). It opens
   * on the Name step and Begin waits for a name. With `archetypeId` (a quick start) the draft is the slide's hero exactly: no ancestry, background or
   * alignment, which the maker would otherwise add (Human adds a point to every score). Without it, the maker's own first-class defaults.
   */
  function openAdventureCreation(entry: BenchAdventure, archetypeId?: ArchetypeId): void {
    const a = entry.adventure;
    if (!a) return;
    closeScreens();
    tc.creationView = openCreation(
      tc.stageWrap,
      { style: () => tc.textStyle, rollDice: tc.rollScoreDice, portrait: tc.portrait, pictures: tc.pictures },
      {
        start: archetypeId ? { ...creatorStartFor(a, archetypeId), ancestryId: undefined, background: undefined, alignment: undefined } : creatorStartFor(a, tc.heroIds[0]!),
        onBegin: (sheet, input) => {
          tc.creationView = null;
          beginAdventure(entry, adventureHeroFromCreator(a, sheet, input));
        },
        onCancel: () => {
          tc.creationView = null;
          tc.viewsChanged();
          showHero(entry);
        },
      },
    );
    tc.viewsChanged();
  }

  /** A test room: nothing but the rules. The hero stays the one picked in the bench's Hero setting. */
  function startSandbox(room: RoomChoice): void {
    tc.closeViews();
    closeScreens();
    tc.session.roomChoice = room;
    const old = tc.st();
    tc.session.play = newPlay("fantasy", old.archetypeId, ROOM_FLOOR.fantasy, undefined, undefined, room);
    tc.carry(old, tc.session.play, "a test room was started");
    tc.session.atStart = false;
    tc.newScene();
  }

  // The place's card and the scene's card are story screens (title ribbon and words). They are shown in the order they are called, so
  // nothing else on the board draws story text and nothing is said twice.
  function showLocationCard(card: { name: string; readAloud: string }): void {
    tc.overlay.locationCard(card); // opens the story screen (a place is story the player did not ask for)
  }
  function showSceneCard(card: { title: string; opening?: string }): void {
    tc.overlay.sceneCard(card);
  }

  /** A new game of an adventure with this hero: a checkpoint, the place's name and read-aloud, the first scene's opening, and a fight at once when something awake and hostile is there. */
  function beginAdventure(entry: BenchAdventure, sheet: CharacterSheet): void {
    const a = entry.adventure;
    if (!a) return;
    tc.closeViews();
    closeScreens();
    const old = tc.session.play;
    tc.session.play = newAdventurePlay(a, sheet);
    // The scene keeps the Room setting as it was (the Room control is off in an adventure, but a save and the export carry it).
    tc.session.play.room = tc.session.roomChoice;
    tc.session.atStart = false;
    tc.carry(old, tc.session.play, `began ${a.title}`);
    const p = tc.st();
    const hook = heroHook(a, sheet.chassis);
    if (hook) {
      p.storyRecent = [hook];
      p.log.push({ text: hook, tone: "plain" });
    }
    tc.newScene();
    const loc = currentLocation(p);
    const scene = p.progress ? sceneOf(a, p.progress.sceneId) : undefined;
    if (loc) showLocationCard({ name: loc.name, readAloud: loc.readAloud });
    if (scene) showSceneCard({ title: scene.title, ...(scene.opening ? { opening: scene.opening } : {}) });
    flushAdventure();
    void arrivalFight();
  }

  /** Anything awake and hostile where the hero has just arrived starts the fight at once; a sleeper that notices them joins it. */
  async function arrivalFight(): Promise<void> {
    // The world is locked while a story screen is up: the fight starts once it is read or clicked through.
    await tc.overlay.whenStoryClosed();
    if (!tc.alive) return;
    const p = tc.st();
    if (!p.round && awakeHostiles(p).length > 0) await tc.beginFight(false, []);
    await tc.afterHeroAction();
  }

  /** What the story did since it was last shown: beats in the dialogue box, objectives in the notice and the Log, a new scene's card, an ending. */
  function flushAdventure(): void {
    const p = tc.st();
    const a = adventureOf(p);
    if (!a) return;
    syncItems(p);
    // What the story tells the player now, in one box (a find's secret first, then each beat that fired, in order).
    const told: string[] = [...tc.pendingTell];
    tc.pendingTell.length = 0;
    while (p.adventurePending.length > 0) {
      const r = p.adventurePending.shift()!;
      for (const b of r.fired) if (b.narrate) told.push(b.narrate);
      for (const o of r.completed) {
        p.log.push({ text: `Objective done: ${o.text}`, tone: "good" });
        tc.hud.notice(`Done: ${o.text}`, "good");
      }
      if (r.sceneChanged) {
        if (r.ended) tc.showEnding(a, r.sceneChanged.to, r.ended);
        else {
          const scene = sceneOf(a, r.sceneChanged.to);
          showSceneCard({ title: scene?.title ?? "", ...(r.sceneChanged.opening ? { opening: r.sceneChanged.opening } : {}) });
        }
      }
    }
    if (told.length > 0) {
      // Story the player did not ask for (a beat, a find's secret) goes to the story screen, not the DM box.
      void tc.overlay.storyScreen({ text: told.join(" ") });
      for (const line of told) p.log.push({ text: line, tone: "dm" });
    }
    tc.flushLog();
  }

  // What the other modules call or read.
  tc.closeScreens = closeScreens;
  tc.showStart = showStart;
  tc.showLocationCard = showLocationCard;
  tc.beginAdventure = beginAdventure;
  tc.arrivalFight = arrivalFight;
  tc.flushAdventure = flushAdventure;
}
