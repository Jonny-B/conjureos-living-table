# Living Table asset bench

One self-contained HTML page for judging the game's art and play. It opens on
**Play** and has seven tabs, all calling the game's own render, rules and
character functions by symbol, so the bench shows what ships rather than a
second drawing of it.

| Tab | What it is for |
|---|---|
| **Play** | The game in miniature, turn based like D&D: a two-room scene with a door, a chest and a goblin. Click a square to walk there (the path and its cost in feet show first), the goblin to attack it (walking up first if it can), the door or the chest to use it. When the goblin notices you, everyone rolls initiative; then each side takes its turn: 30 ft of movement and one action for you, then the goblin's turn plays out. Banners, the turn order, the story strip (the DM's narration and what creatures say) and floating damage and healing numbers are drawn on the board in a pixel or a storybook style (the Text control); every roll and result is in the dice tray and the Log tab, not on the board (see The calmer board below). The dice roll in a tray beside the board: you tap to roll your initiative, attack, damage and healing dice (or untick I roll my own dice), the goblin's dice roll themselves, and every die lands on the engine's own result. Dice skins shows the skins as a shop preview (buying is not wired). Everything you play with is inside one game window: the board, and a dock beside it (under it on a phone) with whose turn it is, what is left of it, both fighters' hit points, the dice tray, the DM's suggested next moves, the buttons that can do something right now (Attack, Use, Potion, End turn, Rest, Sheet; End turn glows once your action is spent) and the Pack, Log and Saves tabs. Sheet (key C) opens your character sheet over the board, and New character on it runs character creation in the same window (see The character sheet and creation below); the dice tray shows a number on every face in every state. Outside the window are only the bench's settings (art, hero, zoom, text style, Reset scene), the dice skins and the gear panels, where you drag items onto the hero's slots and see them worn. Walls and shut doors hide what is behind them (see Line of sight below), and a DM answers anything you type or look at (see The DM below). |
| **Rules** | The rulebook: how the game is played, in plain words, one section per topic (the dice, the turn, combat, skills, resting, the DM, creation and more). Every number is read from the game's own engine, and where the engine does not apply something the book says so. A contents list (a fold-out on a phone), search that filters the sections and highlights matches, see-also links that jump to a section, and the SRD 5.1 attribution at the foot. Built from `src/games/livingtable/rules/rulebook.ts`. |
| **Bestiary** | About 40 SRD 5.1 creatures from CR 0 to CR 10 with their real stat blocks, our own short description, where you find them and how they fight. Search, and CR, type and size filters; each creature opens into a classic stat block with hover help on AC, hit points, CR and the rest. No pictures or animation yet. The goblin and the skeleton say "On the board" and match what the game fights; every other creature is reference only. Built from `src/games/livingtable/rules/bestiary.ts`. |
| **Characters** | Every figure the game uses, animated, in four facings: pick the animation, the style (or every style side by side), the detail and the floor. Heroes can wear their starting gear. The goblin, kept hand-drawn, has its own row. |
| **Pieces** | Every in-play fantasy sprite as a still: the game today beside the KayKit conversion. |
| **Gear** | One hero's paper doll (the inventory screen's figure) and every item's inventory icon. |
| **Terrain** | A preset map, raw beside the game's autotiling. |

The **Art row** (top of most tabs) switches between the game's current
hand-drawn art and the KayKit art (Kay Lousberg, CC0): ground style, character
style, 16 or 32 px, with a line explaining each choice. One choice, shared by
every tab. KayKit is the default. Fantasy only: sci-fi is paused and the Healer
is out of play (`characters/templates.ts`).

Built from the `asset-bench` skill's template (`.claude/skills/asset-bench/`
in the ConjureOS repo), and moved here from conjureos-games with the game on
2026-09-30. This copy (`build-bench.mjs`, `shell.js`) is maintained here, not
there.

## Line of sight and the fog of war

You see only what is in line of sight: a closed door, a wall, a tree or a pillar hides what is behind it, and an open door shows a lit cone. Squares you have seen stay on the board as a dim memory (terrain and props, never creatures); squares you have never seen are mist, and clicking one says "You have not seen that far." The goblin is drawn, named and attackable only while you can see it, and it wakes when you see each other within 6 squares or when a walking path to you is 2 squares or fewer (it hears you). All of it is the game's own `world/visibility.ts` and `render/shroud.ts`, so the bench and the game cannot disagree about what a door hides.

## The DM

Type anything you try in the box under the buttons ("I look in the grate", "I tell the goblin I mean no harm") or look closer at anything: right-click a square, or long-press it on a phone, and pick Look closer (the first line of the context menu, below); a left click on a prop the DM placed walks up to it and looks closer. A left click on a grate just walks onto it, because every DM answer is a paid call. The DM (`dm.ts`) is told the whole room, every secret in it, the goblin's numbers, your sheet and pack, what you can see right now and the last few exchanges, and narrates only what you can see or hear.

- **Freehand.** A trivial action just happens. An uncertain one comes with ONE check, written with both outcomes before the roll; the tray rolls it (d20, or two for advantage or disadvantage, plus your sheet's real modifier, against the DM's DC) and the engine plays the branch the dice pick. One action is one DM call.
- **What the DM can do.** Give and take plain items, hand out healing potions (two a scene), call the engine's own loot roll (the cell's ledger caps it), heal and harm (dice rolled in the tray, harm only in a failed check), place, remove and alter props, change terrain (never the border, never under a figure), open, close, lock and unlock the door, wake or calm the goblin, make it flee, or bring it back. It can also push, hurt and knock down the goblin, but only through effects the engine applies (see The DM's board powers below). Chests stay the engine's loot roll: the DM never invents what is inside one, and never gives gear with a magic name. Every refused effect is a plain line in the log (and the DM is told next turn), never a popup.
- **Cost in a fight.** The DM declares free, object or action; the engine enforces it. Speech is free, a check costs the action, and one object interaction a turn is treated as free on the bench.
- **Pack.** The Pack button (key I) inside the game window lists what you wear, the bag, what you carry and your consumables (the potions); new items flash gold. Hover or focus any row and a tip says exactly what it is: its real numbers and whether the game applies it or the DM rules on it. Click or tap a row and it pins as an item card (see Items below). The DM is asked to describe everything it gives (a `desc` of one line); that line is the tip for the item, and taking the item away removes it. It can also flag what it gives: `quest` (cannot be dropped or destroyed), `usable` with a `useSay` (the Use button sends that line to the DM).
- **Who you are.** The DM is also told your ancestry, background, alignment, personality, backstory, traits (with whether the engine applies each) and languages, and what each thing you carry is.
- **Stopping it.** While the DM thinks the HUD shows Cancel; Escape does the same.

The DM runs on the viewer's own Claude account through the artifact runtime's `sample` capability (plain text out, checked and repaired by our own code, tier "default", no cache), so it spends the viewer's own Claude usage and asks permission on the first call. Off claude.ai (a plain file, or a viewer without the capability) the box is disabled and says so; the rest of the game plays as before. Headless checks install `globalThis.__ltBenchSample` (a function with the sample signature) before the bench script runs and it is used instead.

## The calmer board, suggestions, Rest and saves

The board stays clear: only story is written on it, and it fades.

- **Story only.** The DM's narration and what a creature says ("Hee hee. Fresh meat.") go in the strip at the bottom of the board. A line stays for a reading time (3.5 s and 40 ms a character, up to 9 s), then fades and the box shrinks away. At most two lines show at once, and on a phone one while the DM is narrating; older lines fade first. A click on the strip clears it. "You are down" is the one line that stays until you load a save or reset. Under reduced motion the reading time is longer and the strip still clears.
- **Everything else is in the Log.** Attack lines, check results, loot, doors, initiative and refused DM effects are written only to the log. The dice tray already shows every roll. The **Log** tab (key L) in the dock keeps the last 200 lines (every roll, find and line of narration, and your own words to the DM), newest at the bottom. Items and potions you gain also flash a small note beside the Pack button ("+ a few tarnished copper coins", "+1 potion") that fades after about 3 s, and the Pack button shows its gold dot.
- **Suggested next moves.** Each DM answer comes with two to four moves that fit the moment ("Pull the stone loose", "Leave it"). They show under "What next?" with keys 1 to 4; pressing one is the same as typing its words (it is written to the log as yours and sent to the DM). A move the DM marks as one of the game's own buttons (attack, use, potion, rest, end turn) runs that button's own rule instead of asking the DM, and says why in a toast if it cannot be done right now. After a check, the moves of the branch the dice picked show. They clear when you step away, take any other action, a fight starts, or the next answer arrives (which replaces them), and when the scene changes. They show only while the table is free.
- **Buttons that can do something.** Attack shows with the goblin in sight and in reach (or a fight on, with your action ready). Use shows next to a door you can use (not locked, nobody in the doorway) or a chest not yet emptied; with neither, and a body or a sack of dropped things next to you, it reads Search. Potion shows when you are hurt and have one. End turn shows only on your turn in a fight. Rest shows when nothing refuses it (below). They are hidden, not greyed out; busy turns and an open sheet grey the ones that are showing. Sheet, Pack, Log, Saves and the ask box always stay.
- **Rest (key R).** The game's own long rest (`characters/health.ts` `longRest`): full hit points, hit dice and spell slots, once a day. It is refused (in the sheet's words, or the table's) when today's sleep is spent, in a fight, with the goblin awake, or with it in sight, even asleep. It does not refill the potions: they are items, not part of the rest. A won fight turns the day over (`newAdventuringDay`), so you can make camp again after the goblin falls. A rest makes a "rest" save, and tells the DM you slept.
- **Saves.** The **Saves** tab lists the last three of each kind (rest, checkpoint), newest first, each with a Load button (`session/savePoints.ts` keeps and describes them). A checkpoint is made when a scene starts (page load, Reset scene, a new hero or a made character). Loading puts back the whole scene (squares, sheet, goblin, door, what you have explored, items the DM gave, the DM's memory and recent talk), clears the suggestions and closes the drawer. Saves are kept in this browser's localStorage (key `livingtable-bench-saves-v1`), read at the start of a page load; if storage is blocked or full the saves still work for the visit. In the game they will go with the character on the server.
- **Down.** With you down, "Load last save" (key 1, or Enter) and "Reset scene" (key 2) replace the buttons, and "You are down" stays on the strip. A downed hero who is not dead can still drink a potion; Reset scene keeps working as before (hero kept, scene starts again).

## Foe dice, bodies and looting, item cards and piles

- **The goblin rolls in its own tray.** Its attack d20 is thrown in the tray look and the dice skin `foeDice.ts` gives it by challenge rating (`foeDiceForToken`: the goblin is tier 1, a dark iron die in an iron-bound box), with "The goblin rolls" on the rim (a creature you have not seen yet is "Something rolls"). Your own rolls stay in your own tray and skin, and the tray goes back to yours at the next roll. The engine does not report the goblin's individual damage dice, only the total, so its damage is the number in the line under the dice and no die is thrown for it. Its initiative die is thrown in its own tray after yours (the total startCombat rolled, less the fixed bonus it adds), and so is its die in a contest (a shove, see below).
- **The kill drops nothing in the pack.** The body stays where it fell (the animated picture draws it lying there) with what the creature carried (`rules/corpses.ts` `carriedBy`: the goblin has a scimitar, a shortbow, leather armor, a shield and a few coins, maybe a trinket; beasts carry nothing). A small gold glint on the square marks a body that has not been searched. Nothing is rolled at the kill.
- **Searching.** Click the body (you walk up first), or stand next to it and press E (the button reads Search when no door or chest competes for E). A loot window opens at the top of the board: the creature's things, each with a Take button, and Take all. The FIRST search rolls the engine's own loot once (`lootFor`, source fight, the cell's ledger caps it, the log says so when it is spent); a found piece of gear waits in the window, not in the pack, until you take it. Take puts gear the engine names into the bag (`pickUp`, which keeps the bag's rules and says why it refused) and everything else on the carried list with its note for the hover tip. Coins are an item ("12 copper pieces"): the game does not track money yet, and the note says so. A body with nothing left says so; walking away, a fight or a DM turn closes the window.
- **Items.** Click an item in the Pack tab, or in the sheet's equipment list, and a card pins with what `inventory/itemActions.ts` says it can do: Equip or Unequip (the game's own gate, with the reason when it is refused), Use (a potion heals with the game's own dice; a healing kit uses one of its own uses; an item the DM flagged `usable` sends its `useSay` to the DM; any other item says "Cannot be used" and why), Drop and Destroy (greyed with the reason for worn gear and quest items; Destroy asks to confirm). The clarity line on top comes from `itemStatusLine`. Gear can change only with nothing hostile awake or in sight, the same test Rest uses; a goblin asleep behind a shut door does not stop you.
- **Piles.** A dropped item lies in a small sack on your square, listed to the DM. Click it, or press E next to it, to open the same loot window ("On the ground"); Take picks it up.

## Context menus and maneuvers

Right-click, or long-press for half a second on a phone, any square the hero has seen. A menu opens at that spot (it flips and scrolls to stay on the board). **Look closer** is always the first line (the DM examines it, as before); under it is what THIS character can do there, from `session/contextActions.ts`. Each line says why it is offered ("Rogue, Stealth +6, expertise", "Anyone can try: Athletics +1"), a small gold star marks what the character is good at, and a greyed line says in plain words why it cannot be done now ("Too far away: 40 feet", "You have already used your action"). What a class or training rules out is left off the list rather than greyed (a Knight has no Pickpocket, only a rogue has Pick the lock, only a Survival-trained hero has Track). A left click keeps its meaning: walk, attack, use.

What is on the square decides the list: yourself (Hide, Sneak), the goblin, a body (Loot), the door (Listen at the door, Force the door, Pick the lock), the chest, a prop or a grate (Search, Hide), a pile of dropped things (Pick through it), the floor (Search, Sneak, Hide) and a wall (Look closer only).

An action the **DM** rules on (Talk, Parley, Bluff, Threaten, Read its intent, Search, Recall lore, Grapple and the rest of the social and lore actions) sends its first-person line as a freehand ask, with the cost enforced as for any DM turn. These lines are greyed with the reason when the DM is not available. Grapple says on its line that the board does not track grappled, so the DM rules on it in words only. An action the **engine** rules on runs here, with every die thrown in the tray (yours in your tray, the goblin's contest die in its own), the numbers in the Log and a short story line where it matters:

| Action | What it does |
|---|---|
| **Kick** | An unarmed strike (`maneuvers.ts unarmedStrike`): d20 plus Strength plus proficiency against its AC; a hit deals 1 plus Strength bludgeoning, never below 0, and a critical adds nothing because there are no dice to double (the line says so). The damage lands on the goblin on the board, with floats, a body if it falls. It starts the fight if none is on and takes the action. |
| **Shove** and **Knock down** | SRD 5.1's two shoves. Your Athletics against the better of its Athletics and Acrobatics, a tie to the goblin; refused when it is more than one size larger. A win on Shove moves it one square straight away from you along `pushDestination` (it stops before a wall, a prop or another token, and the Log says when it is pinned), and the slide is animated. A win on Knock down makes it **prone**. |
| **Prone** | A state on the goblin (`PlayState.monster.prone`): the figure lies down with a small PRONE tag; your attacks from within 5 feet have advantage (both d20 are thrown, and the Log says why) and from farther off have disadvantage; and at the start of its turn it spends half its movement (15 feet) standing up, which the Log says. Its own attacks do not carry the SRD's disadvantage, because it stands before it attacks. |
| **Hide** | One Stealth check against its passive Perception, if it could see you (nobody can see you through a wall or a shut door, so you are simply hidden). Success sets `PlayState.heroHidden`, shown in the dock. Not offered while it is looking right at you, and greyed in a fight (the goblin's turn does not read it). |
| **Sneak** and **Sneak up** | Sneak is a mode, not a roll: the line becomes Stop sneaking. On a square it also walks you there. Sneak up turns it on and walks you next to it. In either, and while hidden, the goblin does not wake by sight: every step it WOULD have noticed (seen within 6 squares, or a walking path of 2 steps) is a Stealth check against its passive Perception, thrown in the tray. Pass and you stay hidden and keep walking; fail and it notices, the fight starts, and the hiding is over. Attacking from hiding gives advantage and ends it. |
| **Pickpocket** | Sleight of Hand against its passive Perception, on a goblin that has not noticed you. A success moves one small thing (coins, a trinket, a dagger) from what it carries to your pack, and it is gone from the body later. A failure wakes it and the fight starts. |
| **Pick the lock** and **Force the door** | Dexterity plus proficiency (thieves' tools; a rogue only) or Athletics against the lock's DC. The DM locks a door without naming a DC, so it is 15 (`PlayState.doorLockDc`). A success unlocks the door; forcing it also opens it. |
| **Listen at the door** | Perception against DC 10. A success says whether something is moving beyond the door and whether it is awake, never where; a failure says nothing is clear. |
| **Loot** and **Pick through it** | The loot window of Foe dice, bodies and looting above. Greyed in a fight, because the window closes when one starts. |

Left out, and why: **Stabilize** (the goblin at 0 hit points is removed from the board, so nothing is ever down to stabilize), **Harvest** (the bench has no beast; the handler refuses in words) and **Cast** (greyed: the bench has no spell menu). The engine has no Second Wind, Sneak Attack or Turn Undead, so they are not offered.

## The DM's board powers

A DM that narrates the goblin moving, hurt or knocked down used to leave it standing there (the kick that never moved the goblin). Now a creature changes only through an effect, and the prompt says so. Three effects and two check kinds (`dm.ts`):

- **push** (a creature, 1 or 2 squares) moves it straight away from you along the engine's `pushDestination`, animated; it can stop short, and a push with a wall behind it is refused in words.
- **hurt** (a creature, only inside the success branch of an attack or contest check) damages it. After an attack check with no dice named it is the attack's own damage (your weapon's dice thrown in the tray, or the kick's flat number); with dice named, those are thrown in the tray instead. A kill leaves a body like any other.
- **prone** knocks it down by the prone rules above (and its condition immunities, which the goblin has none of).
- **Attack check** (`kind: "attack"`, weapon `unarmed` or the weapon in hand): the engine rolls your attack against its AC (both d20 with advantage from hiding or a prone target), a miss lands at once, and a hit's damage lands when the branch's hurt runs. A target out of reach or behind something solid cannot be attacked: the check is refused in words and counts as failed. An attack from the DM starts the fight.
- **Contest check** (`kind: "contest"`): your skill against its skill or ability (by default the better of its Athletics and Acrobatics), your d20 in your tray and its in its own, a tie to the goblin.

Every refusal is a line in the Log and a note the DM reads next turn, as before; a reply the validator throws away (a hurt outside a success branch) leaves a Log line too, and both raw answers and the errors in the journal.

## The debug export and the journals

The Saves tab has **Export adventure (debug)**. It builds the whole adventure (`session/adventureExport.ts`, `session/zip.ts`): `adventure.json` (the sheet, the scene layout with props and tokens, the full play state, every save, the log, every DM exchange, every roll, the settings and the build), `dm-transcript.md` (each exchange: the ask, the full input sent, every raw answer, the errors, what the engine applied and refused, the timing), `log.txt`, `character-sheet.json`, `saves.json`, `rolls.csv` and a README. It saves the zip with the artifact runtime's `downloads` capability (the viewer confirms the file name). Without that capability (a plain file, or a viewer that cannot save) it offers the zip as a plain browser download and shows a **Copy adventure JSON** button for when even that is blocked; the line under the button says in words which of these happened, or that the viewer declined. The zip holds the whole DM prompt, so the world's secrets: it is for the owner's debugging, not for sharing.

Two journals feed it. Every DM ask is journaled whichever way it ends (a good answer, a repaired one, a thrown-away one, a provider error, a cancel), with the engine's applied and refused effects added when the reply has played (`PlayState.dmJournal`, the last 100). Every roll thrown in the tray, the creator's and the goblin's included, is journaled with who, the dice, the numbers and the verdict (`PlayState.rollJournal`, the last 500). Neither is in a save, so saves stay small; both survive Reset scene, a new hero and loading a save, and the log lines that scroll off the Log tab, or belong to an earlier scene, are kept for the export too (marked where a scene was replaced).

Headless checks can install `globalThis.__ltBenchRng` (a function returning a number from 0 up to, not including, 1) to make the engine's maneuver and swing dice land where a check needs; the goblin's initiative and its own swings still use the engine's plain random.

## The character sheet and creation

Press **C** (or the Sheet button) and a D&D style sheet opens over the board, inside the game window, so the HUD and the dice tray stay in view beside it (under it on a phone). Every number on it has a tip that says where it came from and how it was worked out, and every line is labelled "The game applies this" or "The DM rules on this". It follows your hero live (hit points, potions, what the DM hands over). Escape, C or Close returns to the board. While the sheet or the creator is open the game waits: board clicks, game keys, the action buttons and the DM box do nothing.

**New character** on the sheet opens creation in the same place, following SRD 5.1: class (the playable archetypes), ancestry (the nine SRD ancestries), ability scores (class default, standard array, point buy with 27 points, or 4d6 drop the lowest), skills, a background in your own words (two skills plus a personality trait, ideal, bond and flaw), alignment, name and backstory. Every step has a default, so **Begin** works from any step. Rolling throws the real dice tray: six groups of four d6, so you see every number (tap the tray once to start, and again during a throw to skip ahead). Begin makes the new hero, with a fresh scene and the DM's memory cleared. Reset scene keeps the hero you made; the **Hero** setting in the bench's own row still quick-picks a ready-made character.

`sheet.ts` draws both views and holds their tips and creation helpers; the engine side (`characters/creation.ts`, `ancestries.ts`, `inventory/itemInfo.ts`) lives under `src/` so the game can adopt it.

## Rebuild it

```
npm run bench
```

which packs the KayKit stills (`scripts/kaykit/pack-library.mjs`) and the
animated cast (`scripts/kaykit/pack-cast.mjs`; an empty set when there is
none, and the Characters tab then says how to make it) and runs:

```
node scripts/asset-bench/build-bench.mjs \
  --assets scripts/asset-bench/assets.ts \
  --out .cache/asset-bench/living-table-bench.html \
  --artifact \
  --data kaylib=.cache/kaykit/bench-library.json \
  --data kaycast=.cache/kaykit/bench-cast.json
```

`--data <id>=<file.json>` embeds a JSON block the registry reads at mount time
(`kaykit.ts`, `cast.ts`), so generated data never becomes an import of the
registry or of the tests that load it. The artifact has a 16 MB ceiling;
`pack-cast.mjs --styles bands,pixelart` keeps fewer styles if the cast grows
past it.

Output goes to `.cache/asset-bench/living-table-bench.html`, gitignored (see
`.gitignore`), never under `src/` or `public/` (`build-bench.mjs` refuses to
write there). `test/livingtable-asset-bench.test.ts` guards both of those
facts plus "every in-play fantasy sprite is on the Pieces tab" and "nothing
under src/ imports scripts/asset-bench".

## Files

- `assets.ts`: the registry and the seven panels. Edit this when the game's
  asset library, rules or render functions change.
- `sheet.ts`: the character sheet and the creation wizard (DOM views, their tips and the pure creation helpers). Unit-tested in `test/livingtable-bench-sheet.test.ts`.
- `books.ts`: the Rules and Bestiary panels, built from `src/games/livingtable/rules/`. Unit-tested in `test/livingtable-bench-books.test.ts`.
- `tip.ts`: the hover help (placement, one at a time, keyboard and touch) every tip in the bench uses.
- `kaykit.ts`: decodes the embedded KayKit stills.
- `cast.ts`: decodes and plays the embedded animated cast, and the small
  animation state machine (`Actor`) the Play tab drives.
- `dm.ts`: the DM's model side with no DOM: the prompt, the reply parser and validator, the single repair round, and `askDm`. Unit-tested in `test/livingtable-bench-dm.test.ts`.
- `overlay.ts`, `pixelFont.ts`: every word drawn on the Play board (banners,
  the story strip, roll plates, floating numbers, the turn order) and the HUD
  (buttons, suggested moves, the Pack, Log and Saves drawer) in two styles; no
  web fonts, so the game can reuse it.
- `dice.ts`: the dice tray: pixel-art d4 to d20 that tumble and land on a given result, skins as data, the skin picker, and the foe trays. `foeDice.ts` says which tray and skin a creature rolls in.
- `build-bench.mjs`, `shell.js`: this project's own copy of the asset-bench
  skill's template builder and shell. Adapt them here if the bench needs
  something the template does not provide; they are not shared with other
  projects. Additions so far: `--data`, and the registry's `defaultPanel`,
  `library: false` (no sprite library tab), `libraryLast` and `libraryLabel`.

## Publishing

Artifact URL: https://claude.ai/artifact/Hjj7bkAS2fwDKUqY41ZeCG

The bench is published with the Artifact tool as its own artifact, updating
that same URL in place every time it changes rather than publishing a new one. It must be published with the `sample` capability declared (`capabilities: {sample: {}}`), or the DM box stays disabled, and with the `downloads` capability, or the Export button falls back to a plain browser download (and the Copy button).
