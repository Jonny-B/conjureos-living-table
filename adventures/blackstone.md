# The Quiet Under Blackstone

<!--
  A three-act campaign, written by Claude for the owner on 2026-10-09 and ported to this format on
  2026-10-10 from its first draft (a TypeScript module on branch claude/dreamy-fermi-xg1ixr, history
  only now). The owner's framing, from the request: the goblins and the mayor's broken deal ("the
  mayor has secretly made a deal with the goblin clan"; "the goblins are taking people because the
  mayor broke his agreement with them") and "a kingdom where the dead are coming back" ("Who is
  awakening the dead beneath the kingdom, and why?"), with a villain whose plan moves day by day if
  the party does nothing.

  Everything else is Claude's, so every judgment call that is not the owner's is marked REVIEW.

  How it is built:
    - three act scenes, each with objectives, beats and one way on; three ending scenes reached from
      the tomb, and one (the king wakes) reached from anywhere through the World;
    - the villain's clock is the ## World section: days 2, 4, 6 and 9, three days later if the party
      cuts off the silver; a day passes each time the hero sleeps;
    - a judgment the DM makes ("the mayor confesses") is a flag that a beat reacts to, so the DM can
      only declare what the story names, and each declaration has a consequence;
    - secrets are DM ONLY lines (truths, NPC secrets, features, location notes). The format cannot stop
      a secret coming out early, so the DM never list carries the old gates in words.
-->

- id: blackstone
- version: 1
- author: owner
- levels: 1 to 3
- tone: Folk horror with a warm centre: dread at night, small kindnesses by day, and nobody simply evil, the villain included.

## Summary

Three people have vanished from Blackstone in two weeks, and the village says the goblins took them. The mayor is offering a reward. Up on the ridge, at night, something walks that is not a goblin. Blackstone is a played-out silver-mining village of about sixty, four days up a cold valley from the nearest town, below a ridge of royal barrows and an old mine held by goblins under an oath the village never talks about. The goblins did take two of the missing, because the mayor broke that oath, and the thing they were sworn to guard is waking: a grieving scholar is raising the dead king under the ridge to use his crown, with the grave-silver the mayor has been selling him.

## Truths

- Blackstone is a played-out silver-mining village of about sixty people, four days up a cold valley from the nearest town.
- Three villagers have vanished in two weeks: Bessa Crane, the miller's daughter; old Jory Flint, a retired miner; and Tam Holt, the carter's fifteen-year-old son.
- A goblin clan, the Hollow Teeth, lives in the old mine above the village and has for longer than anyone remembers. Villagers rarely see them.
- The mine's silver ran out a year ago, and the village has been getting poorer since.
- The ridge above the village is the barrow-field, the graves of the kings of a kingdom that fell centuries ago. Nobody goes up there; children are told pointing at it is bad luck.
- DM ONLY: Since its founding the village has paid the Hollow Teeth a grain toll each season for guarding the bottom of the mine. Mayor Venn stopped paying three months ago, to save money.
- DM ONLY: The Hollow Teeth took Bessa and Jory as surety for the unpaid toll. Both are alive, fed, unhurt and bored, roped under an awning in the goblin camp.
- DM ONLY: Venn sells grave-silver to a buyer he has never met. His men dug it from the bottom of the mine, where the workings broke into old barrow tunnels; Wenna Holt carts it to the cairn on the ridge, where the buyer leaves old royal coin. The buyer signs every letter with a small drawn lantern and collects at midnight.
- DM ONLY: Skeletons walk the barrow-field at night. They do not come down into the village. Yet.
- DM ONLY: Goblins did not take Tam. Curious about his mother's heavy crates, he went down the mine alone; the dead took him to the Lamplighter, who keeps him entranced as a lamp-bearer. He is alive.
- DM ONLY: The goblins' oath was never about the mine. The Hollow Teeth keep the Deep Door shut: the stone seal between the bottom of the mine and the barrow halls, so that nothing buried there comes down into the valley. The grain was their wage, sworn long ago to the keepers of the Quiet Bell.
- DM ONLY: Grave-silver only holds the Lamplighter's cold flame if living hands give it; stolen, it will not burn. That is why he buys it, and why cutting off the mayor's silver slows him.
- DM ONLY: The buyer is Corvane Ash, a royal archivist from the capital who left in disgrace. He is the Lamplighter, and the ridge's dead answer to his Grave Lantern, a grey-silver lantern with a cold blue flame.
- DM ONLY: Corvane's daughter Lise died of a winter fever two years ago while he was away in the archives. He believes the Ember Crown, which commands the dead, can call her back. It cannot: it calls back the body, never the person.
- DM ONLY: Whoever wears the Ember Crown commands the dead and slowly becomes one: it takes their warmth until they are the next unburied king.
- DM ONLY: The Quiet Bell, a fist-sized bronze hand bell over the shrine's altar that everyone takes for decoration, was cast to lay King Orrin to rest. Rung in his tomb it puts every dead thing in the barrow back to sleep, and its sound breaks the Lamplighter's hold on Tam.
- DM ONLY: Corvane's plan: buy grave-silver from the mayor, forge the Grave Lantern from it, raise the barrow's dead with its light, wake King Orrin in his tomb, and light the crown. His motive is grief and guilt; he has not forgiven himself one day since Lise died.
- DM ONLY: Corvane's weakness is the lantern. Without it the dead stop obeying and he is a frail man alone in a cold tomb. It can be smashed, snuffed, or drowned out by the Quiet Bell. He is no fighter and avoids being seen, and the dead obey the lantern, not him.
- DM ONLY: The village (led by Venn, about sixty people, few fighters) wants the missing home and the goblins stopped. Ignored, it works itself up to a torch-and-pitchfork raid on the goblin camp: deaths on both sides, and the Deep Door unguarded while the goblins fight.
- DM ONLY: The Hollow Teeth (led by Grukka, about twenty goblins, eight of them warriors, who know the tunnels in the dark) want the toll paid or the oath honoured some other way, and help against what scratches at the Deep Door. Ignored, they take another villager as surety every few days while Snik talks of taking the grain instead.
- DM ONLY: The keepers of the Quiet Bell are one stubborn old woman, Sexton Pell. She wants someone young enough to carry the bell up to the barrow, and willing to believe her. Ignored, she climbs the ridge alone one night and does not come back.

## DM must

- Play every person by what they want right now; that is what drives them, not a script.
- Let the world's clock land the way a person would meet it: a rumour, a scream in the night, a door that was shut and is not. The engine makes the clock happen; the party only ever sees what follows.
- Pitch every fight for one hero between levels 1 and 3. When the hero goes down and lives, the goblins take them prisoner and the dead drag them to their master; narrate it that way, and let the story go on from somewhere worse.
- Show that nobody here is simply evil: Venn is a frightened man doing a cowardly thing, Snik a boy playing warrior, Corvane a father. Show it without excusing anyone.
- Keep dread for the night and warmth for the day: daylight in the village should feel worth saving.
- Declare a judgment flag only when it has truly happened in play: missing_traced when the party has followed the tracks to the camp; grukka_told, wenna_told, hobb_told when that person has told them what they know; scratching_heard when the party has listened at the shaft after dark; pell_heard when the party has taken Pell seriously.
- Declare tomb_quiet only when the confrontation in King Orrin's tomb is over and the moment has passed: the lantern out, the king asleep, Corvane stopped, or the crown on someone's head.

## DM never

- Never tell the party the goblins are not the threat. Let them find it out.
- Never reveal Corvane's name or face before the party meets him at the cairn, finds the archive seal, follows the blue light or wakes Tam.
- Never reveal what the Ember Crown does to its wearer before the party has found its way under the ridge.
- Never reveal the Quiet Bell's rite unless Pell trusts the party or they have read the bell's inscription.
- Never let the dead come down into the village unless the story itself brings them.
- Never name a magic item. The tithe ledger, the buyer's letters, the archive purse, the Quiet Bell and Corvane's journal are ordinary things.

## Hooks

- default: You walked into Blackstone at dusk looking for work, and the village has a job nobody in it will take.
- fighter: You are known for a strong arm, and the mayor wants someone to bring the goblins to heel.
- rogue: You go where you are not invited, and in Blackstone the answers are behind locked doors.
- wizard: You read old carvings and older magic, and something on the ridge is waiting to be read.
- cleric: You keep faith with the dead's rest, and the old sexton here has been waiting for someone who does.

## Starting kit

### default

- armor: class
- potions: 2

## Item: Tithe ledger

- description: The village's grain ledger: a payment to "the Teeth" every season for ninety years, in a dozen different hands, stopping three months ago in the mayor's.
- quest: yes

## Item: Buyer's letters

- description: Letters to the mayor in a fine scholar's hand, ordering "grave-silver, as before" and promising payment at the cairn, each signed with a small drawn lantern.
- quest: yes

## Item: Archive purse

- description: A purse of old royal coin, sealed in wax with the crossed keys of the royal archive in the capital, scratched through.
- quest: yes

## Item: Quiet Bell

- description: A fist-sized hand bell of dark bronze. Tiny letters around its rim read: "Rung below, he sleeps."
- quest: yes
- usable: yes
- use says: I ring the Quiet Bell, and let its note fill the dark.

## Item: Corvane's journal

- description: Two years of entries in a fine hand, every one addressed to "my Lise". The last reads: "Tonight, or the next. I will hear you laugh again."
- quest: yes

## NPC: Aldous Venn

- id: venn
- role: mayor of Blackstone
- personality: Proud and anxious, generous in public and mean with the truth. A heavy, careful man in a good coat gone shiny at the elbows, his chain of office always polished. Fears being found out, the village emptying, and goblins coming for him personally. Values order, appearances and the village's good name.
- token: token_villager
- wants: To keep the disappearances blamed on the goblins until the buyer's last payment comes, then pay the village's debts and never dig again.
- knows: Three people are missing and he is offering a reward for whoever brings the goblins to heel.
- knows: The goblins have always been trouble, as far as he will say.
- secret: He stopped paying the Hollow Teeth's grain toll three months ago and reads the old terms however suits him.
- secret: He sells grave-silver from the bottom of the mine to a buyer he has never met, through Wenna's cart, for old royal coin. He knows exactly how much has gone up the ridge, and that the buyer writes like a scholar.
- secret: He leans on Wenna, who owes him money, dismisses Pell as superstitious, and has told Hobb to stop talking about ghosts.
- voice: Over-formal civic phrases. Answers questions about money with questions about safety.
- location: square

## NPC: Hobb Varley

- id: hobb
- role: Blackstone's only watchman
- personality: Honest, easily embarrassed, braver than he thinks. A broad young man in a borrowed breastplate that does not fit, with a spear never used on anything but rats. Fears the ridge at night and letting the mayor down. Fond of Pell, who taught him his letters, and sweet on Bessa Crane, one of the missing.
- token: token_guard
- wants: To find the missing three without going up the ridge in the dark.
- knows: He found goblin tracks at the mill and was told to leave them be.
- knows: Sexton Pell has been trying to tell people something for weeks.
- secret: He has twice seen two skeletons walking the ridge at dusk, and the mayor told him to stop talking about ghosts. He will tell someone he trusts, or someone who catches him alone.
- voice: Sir or ma'am to everyone. Rambles when nervous.
- location: square

## NPC: Wenna Holt

- id: wenna
- role: the village carter, Tam's mother
- personality: Hard-working, frightened, angry at herself. A wiry woman with rope-burned hands and a cart she cannot stop fixing. Fears that the crates she carried are why Tam is gone. Values her family and paying what she owes.
- token: token_villager
- wants: To find Tam without telling anyone about the crates, because the mayor said that would ruin her.
- knows: She hauled the goblins' grain up the mine road every season until the mayor stopped it.
- secret: She has hauled six sealed, heavy crates from the mine to the cairn on the ridge at night for the mayor, and Tam asked what was in them the day before he vanished. She will tell a hero who promises to look for Tam, or who presses her kindly.
- secret: She owes the mayor a debt she cannot pay.
- voice: Short and plain. Swallows her words when the mayor is near.
- location: yard

## NPC: Ilse Pell

- id: pell
- role: sexton of the shrine of the Quiet Bell
- personality: Stubborn and dry, kind under it, tired of not being listened to. A small, sharp old woman with ink-stained fingers and a ring of iron keys at her belt. Fears that the rite is forgotten and she is too old to perform it. Values rest for the dead, honesty and the old courtesies. Respects Grukka, whose grandmother swore the oath to hers; despairs of Venn.
- token: token_robed_figure
- wants: Someone who will believe her and carry the Quiet Bell up to the barrow, since her knees will not.
- knows: The goblins are not the enemy, and the bell over her altar was not hung there to be looked at.
- knows: The old terms of the oath: the village's grain was the goblins' wage for guarding something below the mine.
- knows: The king under the ridge is Orrin, and he was buried crowned.
- secret: The Quiet Bell's rite came to her from her grandmother: rung in the king's tomb it puts every dead thing in the barrow back to sleep. She gives it only to someone she trusts.
- secret: Grave-silver only holds a cold flame if living hands give it.
- secret: Her grandmother's account says the crown takes its wearer's warmth.
- voice: Clipped and dry. Quotes old rhymes and answers questions with questions.
- location: shrine

## NPC: Grukka Two-Knives

- id: grukka
- role: chief of the Hollow Teeth
- personality: Blunt, patient, dryly funny, never bluffs. A grey-skinned goblin with a notched ear and two mismatched knives, older than most goblins live to be. Fears what wakes behind the Deep Door and her young warriors dying for a village that cheats them. Values oaths kept, debts paid, children fed. Despises Venn as an oath-breaker; respects Pell.
- token: token_goblin
- wants: The toll paid, or something worth as much, before her clan starves or the Deep Door gives.
- knows: The village paid grain for ninety years for the goblins to guard the bottom of the mine. The mayor stopped paying and sent men to dig silver down there instead.
- knows: Something has scratched at the Deep Door from the far side for a month.
- secret: Her goblins hold Bessa and Jory as surety, unhurt.
- secret: Her sentries saw a village boy go down the shaft alone and not come back.
- secret: The oath is to keep the Deep Door shut, sworn to the keepers of the Quiet Bell. She tells it once she trusts the party.
- voice: Short sentences in trader's village-speech. Calls the hero walker.
- location: camp

## NPC: Snik

- id: snik
- role: Grukka's nephew, the youngest Hollow Teeth warrior
- personality: Loud, proud, reckless, desperate to be taken seriously. A wiry young goblin with too many knives and a shield painted with a grinning mouth. Fears being laughed at, and the scratching at the Deep Door, which he will not admit. Thinks the village owes the clan blood, not grain.
- token: token_goblin
- wants: To raid the village for the unpaid grain and come home a hero.
- knows: Where the captives are kept.
- knows: The quickest way down the mine.
- voice: Boasts, challenges, insults the hero's shoes.
- location: camp

## NPC: Bessa Crane

- id: bessa
- role: the miller's daughter, one of the missing
- personality: Sharp-tongued and unafraid, more annoyed than frightened. She has been teaching the goblin children to whistle.
- token: token_villager
- wants: To go home, and to give the mayor a piece of her mind.
- knows: The goblins took her from the mill for "the grain", fed her well and never hurt her.
- knows: The goblins sleep facing the mine, not the village, as if something down there frightens them.
- location: camp

## NPC: Jory Flint

- id: jory
- role: a retired miner, one of the missing
- personality: Slow, kindly, full of stories. He worked the Blackstone mine for forty years.
- token: token_villager
- wants: His own bed, and someone to listen.
- knows: The bottom of the mine broke into something older a year ago: smooth tunnels that no miner cut.
- knows: There was a round stone at the bottom with a bell carved on it, and the old miners never went near it.
- location: camp

## NPC: Corvane Ash

- id: corvane
- role: the Lamplighter, once a royal archivist
- personality: Courteous, precise, exhausted, utterly certain. A thin man in a scholar's black coat, grey before his time, carrying a grey-silver lantern that burns with a cold blue flame. Fears being too late, and forgetting his daughter's face. Values knowledge, promises and Lise. He listens, because he was a scholar first; he will not stop for threats.
- token: token_robed_figure
- wants: To finish the Grave Lantern and light the crown before anyone in the village understands what he is doing.
- knows: The history of every king on the ridge, and he will correct anyone who gets it wrong.
- secret: He is the buyer, and the Lamplighter. He buys from the mayor by letter and has never met him.
- secret: His daughter Lise died two years ago while he was away in the archives. He means to call her back with the Ember Crown, and half suspects it cannot be done. He has not let himself read the inscription on the bier.
- secret: He knows the rite that wakes King Orrin and how the lantern works. The silver must be given by the living.
- secret: He keeps Tam as a lamp-bearer, entranced, and feeds him carefully.
- voice: Soft, formal and archival. Never raises his voice.

## NPC: Tam Holt

- id: tam
- role: the missing carter's son, entranced
- personality: Cheeky and curious when himself; empty and humming now. A gangly fifteen-year-old with a blank, peaceful face, carrying an unlit lantern pole.
- token: token_villager
- wants: Entranced, to carry the lantern pole wherever the Lamplighter walks. Woken, to go home to his mother.
- knows: Once woken: the way through the barrow halls, and where Corvane sleeps.
- knows: Once woken: the cold man talks to a little painted portrait every night, and the crown "is so cold, it makes him sad".
- secret: The trance breaks if he hears his mother's name and is shaken awake, if the Quiet Bell rings near him, or if the lantern goes out.
- voice: Entranced, he hums and says nothing. Woken, he talks too fast and cries.

## NPC: King Orrin the Unburied

- id: orrin
- role: the dead king beneath the ridge
- personality: Asleep. If woken: cold, regal, and sure the valley is still his. A tall skeleton in rotted royal silks on a stone bier, a crown of dark gold on his skull. Fears only the Quiet Bell.
- token: token_skeleton
- wants: To sleep. If woken, to rule again.
- knows: If woken: the valley is his, and everything buried in it obeys him.
- secret: He knows what the crown does to its wearer, because it did it to him.
- voice: Asleep, nothing. Woken, very few words, all of them commands.
- location: tomb

<!-- REVIEW: Bessa and Jory are new people (the first draft named them but gave them no part). They make the rescue a meeting rather than a flag. -->

## Location: Blackstone Square

- id: square
- dm notes: At dusk the mayor reads Tam's name off the notice board to an angry crowd and promises a reward for goblin ears. Venn's hands shake whenever the mine comes up (Insight 12); Wenna, if she is here, will not look at him (Insight 12). If the hero sides loudly with the goblins, the crowd turns ugly and Venn has Hobb walk them out of the square. The crowd follows whoever sounds most certain: calming it is Persuasion 13, shouting it down Intimidation 13, or evidence against the mayor; fail, and a dozen villagers set out for the mine at dawn.

> Dusk in Blackstone. Smoke from a dozen chimneys, a deep stone well, and a crowd around the notice board, where a heavy man in a chain of office is reading out a name. The mayor's hall stands to the east, a cold stone chapel to the west, and the old mine road climbs north into the pines.

### Map

```
TTTTTTTTTNTTTTTTTTTT
T.t......=.......t.T
T...x....=.........T
T.#####..=....abc..T
T.#####..=....dMe..T
T.##S##..=.....=...T
T...=....=.....=...T
T...======12=====..T
T........=34=.H....T
T..t...V.====....t.T
T...o.v....B...o...T
T........@.........T
T..f.k.j......f....T
T.t......=.......t.T
TTTTTTTTTYTTTTTTTTTT
```

### Legend

- `T` = forest_canopy
- `.` = floor_grass
- `f` = floor_grass_flowers
- `=` = floor_dirt
- `#` = wall_stone
- `t` = floor_grass, prop tree
- `a` = floor_grass, prop cottage_nw
- `b` = floor_grass, prop cottage_n
- `c` = floor_grass, prop cottage_ne
- `d` = floor_grass, prop cottage_w
- `e` = floor_grass, prop cottage_e
- `M` = floor_grass, prop cottage_door, exit mayor_door
- `S` = floor_stone, prop door_open, exit shrine_door
- `1` = floor_dirt, prop well_nw, feature notice_board
- `2` = floor_dirt, prop well_ne
- `3` = floor_dirt, prop well_sw
- `4` = floor_dirt, prop well_se
- `o` = floor_grass, prop stool
- `B` = floor_grass, prop barrel
- `@` = floor_grass, start
- `N` = floor_dirt, exit to_mine_road
- `Y` = floor_dirt, exit to_yard
- `H` = floor_grass, spawn hobb_square
- `V` = floor_grass, spawn venn_square
- `v` = floor_grass, spawn crowd
- `k` = floor_grass, spawn bessa_home
- `j` = floor_grass, spawn jory_home
- `x` = floor_grass, spawn square_dead

### Feature: Notice board

- id: notice_board
- description: Notices nailed to the well's post: three names, each newer than the last, and the mayor's offer of a reward for goblin ears.

### Spawn: hobb_square

- creature: token_guard
- hostile: no
- awake: yes
- npc: hobb

### Spawn: venn_square

- creature: token_villager
- hostile: no
- awake: yes
- npc: venn

### Spawn: crowd

- creature: token_villager
- count: 2
- hostile: no
- awake: yes

### Spawn: bessa_home

- creature: token_villager
- hostile: no
- awake: yes
- npc: bessa

### Spawn: jory_home

- creature: token_villager
- hostile: no
- awake: yes
- npc: jory

### Spawn: square_dead

- creature: skeleton
- count: 2
- hostile: yes
- awake: yes

### Exit: The mine road

- id: to_mine_road
- to: mine_road
- arrive at: road_to_square

### Exit: The mayor's door

- id: mayor_door
- to: mayors_house
- arrive at: house_door

### Exit: The shrine door

- id: shrine_door
- to: shrine
- arrive at: shrine_front

### Exit: The lane to the carter's yard

- id: to_yard
- to: yard
- arrive at: yard_gate

## Location: The Mayor's House

- id: mayors_house
- dm notes: The mayor is out in the square, so the house is empty. The tithe ledger is on the study shelf in plain sight (Investigation 10). The buyer's letters are in the locked desk (Sleight of Hand 13 to pick the lock, or Investigation 15 to find the key under the drawer). In the hearth, a burnt corner of an older letter still shows the lantern mark (Investigation 12). If the hero is caught here, Venn calls for Hobb and has them run out of the village, and burns the letters that night unless someone stops him.

> The best house in Blackstone, polished and cold. The study at the back is tidy to the point of nerves: ledgers on the shelf, a locked writing desk, and a hearth full of burnt paper.

### Map

```
####################
#KL.....H.......LL.#
#..................#
#...ED.......r.....#
#.....c............#
#..................#
#########o##########
#..................#
#.yz...........yz..#
#.................C#
#..i..........i....#
#..................#
#.cc..........cc...#
#..................#
#########X##########
```

### Legend

- `#` = wall_stone
- `.` = floor_wood
- `L` = floor_wood, prop shelf
- `K` = floor_wood, prop shelf, feature ledger_shelf
- `D` = floor_wood, prop workbench
- `E` = floor_wood, prop workbench, feature locked_desk
- `H` = floor_wood, prop hearth, feature cold_hearth
- `r` = floor_wood, prop rug
- `c` = floor_wood, prop chair
- `y` = floor_wood, prop table_w
- `z` = floor_wood, prop table_e
- `C` = floor_wood, prop crate
- `i` = floor_wood, prop torch
- `o` = floor_wood, prop door_open
- `X` = floor_wood, prop door_open, exit house_door

### Feature: Ledger shelf

- id: ledger_shelf
- description: Shelves of village ledgers, tax rolls and minutes, all neatly labelled.
- secret: The tithe ledger: a grain payment to "the Teeth" every season for ninety years, stopping three months ago in the mayor's hand.
- search dc: 10
- gives: Tithe ledger

### Feature: Locked desk

- id: locked_desk
- description: A writing desk with a good brass lock, the only locked thing in the room.
- secret: Inside, a bundle of letters in a scholar's hand ordering grave-silver and promising payment at the cairn, each signed with a small drawn lantern.
- search dc: 13
- gives: Buyer's letters

### Feature: Cold hearth

- id: cold_hearth
- description: A cold hearth full of burnt paper, more than a tidy man burns by accident.
- secret: One corner survived the fire: the end of a letter, signed with a small drawn lantern.
- search dc: 12

### Exit: Back to the square

- id: house_door
- to: square
- arrive at: mayor_door

## Location: The Shrine of the Quiet Bell

- id: shrine
- dm notes: Pell sweeps a floor that is already clean. She gives the oath's old terms to anyone who listens, and the bell's rite only to someone she trusts. Mocked or hurried, she shuts the shrine door and opens it again only to someone Hobb or Wenna vouches for. Reading the bell's inscription is Religion 13; seeing that she is frightened, not mad, is Insight 10. If the hero takes the bell without asking, she does not stop them, and she does not forgive it quickly. A path out of the back door climbs north to the barrow-field.

> A cold stone chapel, older than Blackstone and too big for it. Pillars carved with a sleeping king hold up the roof, benches face a plain altar, and on a hook above the altar hangs a small bronze bell nobody looks at.

### Map

```
#########P##########
#..................#
#....p...AB...p....#
#....q........q....#
#........E.........#
#.K..............R.#
#..................#
#....p........p....#
#....Q........q....#
#..................#
#.ccc.ccc..ccc.ccc.#
#..................#
#.i..............i.#
#..................#
#########S##########
```

### Legend

- `#` = wall_stone
- `.` = floor_stone
- `p` = floor_stone, prop pillar_top
- `q` = floor_stone, prop pillar_base
- `Q` = floor_stone, prop pillar_base, feature sleeping_king_carvings
- `A` = floor_stone, prop table_w
- `B` = floor_stone, prop table_e, feature quiet_bell
- `K` = floor_stone, prop shelf, feature shrine_records
- `R` = floor_stone, prop rug
- `c` = floor_stone, prop chair
- `i` = floor_stone, prop torch
- `E` = floor_stone, spawn pell_shrine
- `S` = floor_stone, prop door_open, exit shrine_front
- `P` = floor_stone, prop door_open, exit ridge_path

### Feature: The Quiet Bell

- id: quiet_bell
- description: A small dark bronze hand bell on a hook above the altar, its clapper tied with old thread.
- secret: Tiny letters around the rim: "Rung below, he sleeps."
- search dc: 13
- gives: Quiet Bell

### Feature: Sleeping king carvings

- id: sleeping_king_carvings
- description: Old carvings on the pillars: a crowned king lying down, a bell above him, a goblin hand and a human hand clasped beneath.
- secret: Under the moss the king's name is cut in old letters: Orrin.
- search dc: 12

### Feature: Shrine records

- id: shrine_records
- description: Shelves of old shrine records in a dozen hands, mostly births and burials.
- secret: The oldest record sets down the oath: the village's grain to the Hollow Teeth, every season, for keeping the round door below the mine shut.
- search dc: 12

### Spawn: pell_shrine

- creature: token_robed_figure
- hostile: no
- awake: yes
- npc: pell

### Exit: The front door

- id: shrine_front
- to: square
- arrive at: shrine_door

### Exit: The path up the ridge

- id: ridge_path
- to: barrow_field
- arrive at: field_from_shrine

## Location: Wenna's Yard

- id: yard
- dm notes: Wenna loads an empty cart with nothing, to keep her hands busy. Seeing she hides something about her work is Insight 12. Pressed hard or threatened, she shuts the gate and goes to warn the mayor. Once Tam is home, he is here with her.

> A muddy carter's yard: a stable, a lean-to house, a cart with nothing in it, and a boy's coat still hanging on its peg by the door.

### Map

```
TTTTTTTTTNTTTTTTTTTT
T.................tT
T.abc.........abc..T
T.dge.........dhe..T
T..................T
T....===========...T
T....=CCK......=...T
T....=...W.....=...T
T....=.........=.u.T
T....===========...T
T.[--].........[-].T
T..................T
T.t......b.......t.T
T..................T
TTTTTTTTTTTTTTTTTTTT
```

### Legend

- `T` = forest_canopy
- `.` = floor_grass_pale
- `=` = floor_dirt
- `t` = floor_grass_pale, prop tree
- `a` = floor_grass_pale, prop cottage_nw
- `b` = floor_grass_pale, prop cottage_n
- `c` = floor_grass_pale, prop cottage_ne
- `d` = floor_grass_pale, prop cottage_w
- `e` = floor_grass_pale, prop cottage_e
- `g` = floor_grass_pale, prop cottage_door
- `h` = floor_grass_pale, prop cottage_door, feature tams_coat
- `C` = floor_dirt, prop crate
- `K` = floor_dirt, prop crate, feature cart_bed
- `[` = floor_grass_pale, prop fence_w
- `-` = floor_grass_pale, prop fence_mid
- `]` = floor_grass_pale, prop fence_e
- `W` = floor_dirt, spawn wenna_yard
- `u` = floor_grass_pale, spawn tam_home
- `N` = floor_dirt, exit yard_gate

### Feature: Wenna's cart

- id: cart_bed
- description: Wenna's cart, empty and scrubbed, though not scrubbed enough.
- secret: Grey silver dust in the cracks of the cart bed, and a small lantern scratched into one board.
- search dc: 11

### Feature: Tam's coat

- id: tams_coat
- description: A boy's coat on a peg by the door. Nobody has moved it.

### Spawn: wenna_yard

- creature: token_villager
- hostile: no
- awake: yes
- npc: wenna

### Spawn: tam_home

- creature: token_villager
- hostile: no
- awake: yes
- npc: tam
- appears when: the flag tam_freed is set

### Exit: Back to the square

- id: yard_gate
- to: square
- arrive at: to_yard

## Location: The Old Mine Road

- id: mine_road
- dm notes: A goblin scout watches the road from a platform in a tree. It runs rather than fights; spotting it first is Perception 12, getting past unseen Stealth 12, or the hero can call up and talk. If it gets away, the camp knows the hero is coming and Snik is waiting. The drag marks and the boy's prints are Survival 12.

> A rutted cart road climbs north through dark pine woods toward the old mine. A track branches west toward the bare ridge. It is pine-quiet here, and things watch from the trees.

### Map

```
TTTTTTTTTNTTTTTTTTTT
TTTTTTTT.=.TTTTTTTTT
TTTTTTT..=..TTTTTTTT
TTTTTTt..=...tTTTTTT
TTTTT....=....TTTTTT
TTTT.....=..g..TTTTT
W=========.....TTTTT
TTTT.....=.....TTTTT
TTTTt....=....tTTTTT
TTTTT.k..=.....TTTTT
TTTTT....=d...TTTTTT
TTTTTT...=...TTTTTTT
TTTTTTT..=..TTTTTTTT
TTTTTTTT.=.TTTTTTTTT
TTTTTTTTTSTTTTTTTTTT
```

### Legend

- `T` = forest_canopy
- `.` = floor_grass
- `=` = floor_dirt
- `t` = floor_grass, prop tree
- `k` = floor_grass, prop tree, feature lookout_post
- `d` = floor_dirt, prop sack, feature drag_marks
- `g` = floor_grass, spawn road_scout
- `N` = floor_dirt, exit road_to_camp
- `S` = floor_dirt, exit road_to_square
- `W` = floor_dirt, exit road_to_field

### Feature: Lookout post

- id: lookout_post
- description: A rough platform of lashed branches ten feet up a pine, with a good view down the road.

### Feature: Drag marks

- id: drag_marks
- description: A torn flour sack dropped by the roadside, the mud around it churned.
- secret: Bare goblin footprints and drag marks from the mill up the road, two weeks old, and a fresher set: a boy's boots walking alone, uphill, toward the mine.
- search dc: 12

### Spawn: road_scout

- creature: goblin
- hostile: no
- awake: yes
- appears when: the flag door_broken is not set

### Exit: Up to the mine

- id: road_to_camp
- to: camp
- arrive at: camp_to_road

### Exit: Down to the square

- id: road_to_square
- to: square
- arrive at: to_mine_road

### Exit: The track west to the ridge

- id: road_to_field
- to: barrow_field
- arrive at: field_to_road

## Location: The Hollow Teeth Camp

- id: camp
- dm notes: Two goblin sentries see the hero long before the hero sees them. Grukka wants the toll, and to know whether the hero speaks for the village; Snik wants an excuse. The goblins are frightened, and not of the hero: half the warriors sleep facing the mine (Insight 11). Getting close unseen is Stealth 13; getting Grukka to talk instead of fight is Persuasion 13. Grukka never bluffs and respects those who do not; a lie she catches (Insight against the hero's Deception) ends the parley. Her terms: the toll, or something worth it, such as dealing with the scratching below, or Pell's word. If the hero draws a weapon or is caught creeping, Snik fights to prove himself and the warrior hangs back and runs if hurt; Grukka fights only if a goblin is killed. If Snik goes down, the others stop and look to Grukka. A hero who goes down here wakes roped beside Bessa and Jory, Grukka waiting to talk. Reading the oath stone is History or Religion 12.

> A camp of hide tents and old mine timbers at the mouth of the Blackstone mine. A carved stone stands at its heart, a cook fire smokes, and under an awning two villagers sit roped, fed and bored. The mine mouth gapes in the cliff behind.

### Map

```
cccccccccccccccccccc
cccccccc.M.ccccccccc
cccc....===....ccccc
T.KK.....=.....KK..T
T.....g..=.........T
T........=.........T
W....O...F...rrr...T
T........=...rBJ...T
T..R.....=...rrr...T
T.....N..=.........T
T.KK.....=.....KK..T
T........=.........T
T..t.....=.....t...T
TT.......=........TT
TTTTTTTTTSTTTTTTTTTT
```

### Legend

- `c` = cliff_face
- `T` = forest_canopy
- `.` = floor_dirt
- `=` = floor_dirt_b
- `t` = floor_dirt, prop tree
- `K` = floor_dirt, prop crate_stack
- `O` = floor_dirt, prop pillar_base, feature oath_stone
- `F` = floor_dirt, prop hearth
- `r` = floor_dirt, prop rug
- `B` = floor_dirt, prop rug, spawn bessa_captive
- `J` = floor_dirt, prop rug, spawn jory_captive
- `R` = floor_dirt, spawn grukka_camp
- `N` = floor_dirt, spawn snik
- `g` = floor_dirt, spawn camp_warrior
- `M` = floor_dirt, prop tunnel_mouth, exit mine_mouth
- `S` = floor_dirt, exit camp_to_road
- `W` = floor_dirt, exit camp_to_field

### Feature: Oath stone

- id: oath_stone
- description: A carved stone at the camp's heart, worn smooth by hands.
- secret: A bell, a goblin hand clasping a human one, and a crowned figure lying down beneath them: an oath to keep something below asleep.
- search dc: 12

### Spawn: grukka_camp

- creature: goblin
- hostile: no
- awake: yes
- npc: grukka
- appears when: the flag door_broken is not set

### Spawn: snik

- creature: goblin
- hostile: no
- awake: yes
- npc: snik
- appears when: the flag door_broken is not set

### Spawn: camp_warrior

- creature: goblin
- hostile: no
- awake: yes
- appears when: the flag door_broken is not set

<!-- REVIEW: the camp's goblins stand as not hostile, so no fight starts on arrival; a fight here is one the hero starts (Snik's ambush in the first draft is the DM's to narrate, not the engine's). -->

### Spawn: bessa_captive

- creature: token_villager
- hostile: no
- awake: yes
- npc: bessa
- appears when: the flag captives_freed is not set

### Spawn: jory_captive

- creature: token_villager
- hostile: no
- awake: yes
- npc: jory
- appears when: the flag captives_freed is not set

### Exit: Down the mine road

- id: camp_to_road
- to: mine_road
- arrive at: road_to_camp

### Exit: West along the ridge

- id: camp_to_field
- to: barrow_field
- arrive at: field_to_camp

### Exit: The mine mouth

- id: mine_mouth
- to: upper_mine
- arrive at: upper_to_camp

## Location: The Upper Workings

- id: upper_mine
- dm notes: The Hollow Teeth live in these tunnels. At night goblins sit around the shaft head in silence, listening; listening with them is Perception 12 and hears fingers on stone, more than one set. If the hero climbs down alone, the goblins neither stop nor follow them. Goblins who did not agree to the hero being here are not pleased to find them.

> The old mine's upper tunnels: timber props, goblin sleeping niches heaped with sacks, a pair of rusted ore carts, and the head of a shaft going down into the cold. A draught breathes up it.

### Map

```
####################
#ss......##......ss#
#........##........#
#..kk..........kk..#
#.......i..i.......#
####............####
#ss................#
#.....##....##.....#
#.....##.D..##..ss.#
#..................#
####.....i......####
#ss................#
#........kk.......s#
#..................#
#########U##########
```

### Legend

- `#` = wall_stone
- `.` = floor_dirt
- `s` = floor_dirt, prop sack
- `k` = floor_dirt, prop crate
- `i` = floor_dirt, prop torch
- `D` = floor_dirt, prop stairs_down, feature shaft_head, exit shaft_down
- `U` = floor_dirt, prop tunnel_mouth, exit upper_to_camp

### Feature: Shaft head

- id: shaft_head
- description: Ladders lashed down the side of a cold shaft. The draught that comes up it smells of wet stone.
- secret: Listen long enough after dark and there is a scratching from far below: fingers on stone, more than one set.
- search dc: 12

### Exit: The way out to the camp

- id: upper_to_camp
- to: camp
- arrive at: mine_mouth

### Exit: Down the shaft

- id: shaft_down
- to: lower_mine
- arrive at: ladder_up

## Location: The Lower Workings

- id: lower_mine
- dm notes: The Deep Door is held only by its own weight now; two skeletons work at it from the far side (Perception 11 sees bony fingers at the gap). Bracing it alone is Athletics 14, or 10 with goblin help, and the timbers lie ready. If the hero lingers without bracing it, the door grinds a little wider each turn, and then the dead come through, one at a time through the gap, silent, never retreating; goblin allies who came hold the shaft and fight beside the hero. A hero who goes down here is dragged through the gap and wakes in the barrow halls beside a humming boy with a lantern pole. The carvings in full are Religion or History 12.

> Ladders end in ankle-deep water. Fresh pick marks show where the mayor's men broke through into older, smoother tunnels, and at the end of them, set in the west wall, stands a round stone door carved with a bell. It shifts slightly as you watch. Something on the other side is pushing.

### Map

```
####################
#......#####......U#
#......#####.......#
#..ww.........ww...#
#..www.......www...#
#....ww......p.....#
Dxx................#
#..ww....b.........#
#..www........ww...#
#.....kk......www..#
#..................#
#..ww........ww....#
#.......o..........#
#..................#
####################
```

### Legend

- `#` = wall_stone
- `.` = floor_stone_drain
- `w` = water
- `p` = floor_stone_drain, prop crate, feature miners_breach
- `b` = floor_stone_drain, prop crate, feature bracing_timbers
- `k` = floor_stone_drain, prop crate
- `x` = floor_stone_drain, spawn door_dead
- `o` = floor_stone_drain, prop sack, feature boy_prints
- `D` = floor_stone_drain, prop arch_passage, feature deep_door, exit deep_door
- `U` = floor_stone_drain, prop ladder_up, exit ladder_up

### Feature: The Deep Door

- id: deep_door
- description: A round stone seal set in the west wall, carved with a bell, a goblin hand and a human hand, and a crowned king lying down. A hand's width of dark shows at its edge.
- secret: The words under the carvings: "Rung below, he sleeps. Lit above, he rises. Who wears it, keeps it, cold."
- search dc: 12

### Feature: Miners' breach

- id: miners_breach
- description: Where the miners' picks broke through into the old tunnel: rubble, and tools left where they fell.
- secret: Picks, a lantern from the mayor's hall, and a ledger of silver weights in Venn's hand.
- search dc: 10

### Feature: Bracing timbers

- id: bracing_timbers
- description: Old mine timbers stacked against the wall, heavy enough to brace a door.

### Feature: Boy's prints

- id: boy_prints
- description: A dropped miner's sack near the door, the silt around it scuffed.
- secret: A boy's boot prints going through the gap at the edge of the Deep Door, with bony footprints on either side of them.
- search dc: 11

### Spawn: door_dead

- creature: skeleton
- count: 2
- hostile: yes
- awake: yes

### Exit: Up the ladder

- id: ladder_up
- to: upper_mine
- arrive at: shaft_down

### Exit: Through the Deep Door

- id: deep_door
- to: halls
- arrive at: deep_door_back
- open when: the flag deep_door_opened is set or the flag door_gap_passed is set or the flag door_broken is set
- locked text: The round stone does not move for one pair of hands, and the gap at its edge is a hand wide. Something on the other side is pushing.

## Location: The Barrow-Field

- id: barrow_field
- dm notes: By day, wind and silence. At dusk, frost on the mounds and footprints in it that are only bone, all leading to and from the cairn (Survival 11). After dark a cold blue light moves among the barrows with skeletons walking beside it like an honour guard; watching unseen is Stealth 13. Once the dead walk here, they stop at the first standing stone and do not chase further.

> Long grassed grave mounds climb the ridge above the village, standing stones between them. Below, Blackstone's chimneys smoke. Above, at the top of the ridge, a tall stack of black stones.

### Map

```
TTTTTTTTTNTTTTTTTTTT
T.,,,....=....,,,..T
T.,,,..p.=.p..,,,..T
T......q.=.q.......T
T..,,,...=...,,,...T
T..,,,...=...,,,...C
T........=.........T
T.p..,,,.=.,,,..p..T
T.Q..,,,.=.,,,..q..T
T........=..x......R
T..,,,...=...,,,...T
T..,,,...=...,,,...T
T......p.=.p.......T
T......q.=.q.......T
TTTTTTTTTSTTTTTTTTTT
```

### Legend

- `T` = forest_canopy
- `.` = floor_grass_pale
- `,` = floor_grass_tufted
- `=` = floor_dirt
- `p` = floor_grass_pale, prop pillar_top
- `q` = floor_grass_pale, prop pillar_base
- `Q` = floor_grass_pale, prop pillar_base, feature frost_prints
- `x` = floor_grass_pale, spawn ridge_dead
- `N` = floor_dirt, exit field_to_cairn
- `S` = floor_dirt, exit field_from_shrine
- `C` = floor_grass_pale, exit field_to_camp
- `R` = floor_grass_pale, exit field_to_road

### Feature: Standing stone

- id: frost_prints
- description: An old standing stone, lichen on its north face.
- secret: Frost on the grass around it, and footprints in the frost that are only bone, all leading up the ridge to the cairn and back.
- search dc: 11

### Spawn: ridge_dead

- creature: skeleton
- count: 2
- hostile: yes
- awake: yes

### Exit: Up to the cairn

- id: field_to_cairn
- to: cairn
- arrive at: cairn_to_field

### Exit: Down to the shrine

- id: field_from_shrine
- to: shrine
- arrive at: ridge_path

### Exit: East to the goblin camp

- id: field_to_camp
- to: camp
- arrive at: camp_to_field

### Exit: East to the mine road

- id: field_to_road
- to: mine_road
- arrive at: road_to_field

## Location: The Cairn

- id: cairn
- dm notes: The buyer leaves payment in a niche in the cairn and collects the silver at midnight. Behind the cairn a barrow mouth has been dug open, lantern soot on its lintel and a boy's boot print in the dust (Investigation 12 by day). If the hero waits here until midnight (declare cairn_watched), a cold blue light rises from the barrow and with it a thin man and two skeletons. Corvane wants the silver and no witnesses; he would rather talk than fight, and rather leave than talk (Persuasion 14 keeps him talking). The skeletons obey the lantern, not him: out of its sight they stand still for a round (Arcana 13 sees it). Threatened, he steps back into the barrow and the skeletons step forward; they never chase past the cairn. A hero who goes down here wakes at dawn on the hilltop, the crate gone, a small lantern drawn on the back of their hand in cold blue wax.

> The top of the ridge: wind, a steep drop to the east, and a tall stack of black stones. Behind it, the grass has been torn up around a low dark opening.

### Map

```
TTTTTTTTTTTTTTTTcccc
T........M......cccc
T.......,,,.....cccc
T...............cccc
T.......Z.......cccc
T...............cccc
T..,,......,,...cccc
T..,,..x....,,..cccc
T......y.y......cccc
T...............cccc
T.,,.......,,...cccc
T.,,.......,,...cccc
T...............cccc
T........=......cccc
TTTTTTTTTSTTTTTTcccc
```

### Legend

- `T` = forest_canopy
- `c` = cliff_face
- `.` = floor_grass_pale
- `,` = floor_grass_tufted
- `=` = floor_dirt
- `Z` = floor_grass_pale, prop crate_stack, feature payment_niche
- `M` = floor_dirt, prop tunnel_mouth, exit barrow_mouth
- `x` = floor_grass_pale, spawn corvane_cairn
- `y` = floor_grass_pale, spawn cairn_guard
- `S` = floor_dirt, exit cairn_to_field

### Feature: Payment niche

- id: payment_niche
- description: A gap between the cairn's stones, rubbed smooth by hands.
- secret: A purse of old royal coin, sealed with the royal archive's crossed keys, scratched through.
- search dc: 12
- gives: Archive purse

### Spawn: corvane_cairn

- creature: token_robed_figure
- hostile: no
- awake: yes
- npc: corvane

### Spawn: cairn_guard

- creature: skeleton
- count: 2
- hostile: yes
- awake: no

<!-- REVIEW: the cairn guard stands unaware until it notices the hero, so watching, talking and following are all possible before a fight. -->

### Exit: Down the ridge

- id: cairn_to_field
- to: barrow_field
- arrive at: field_to_cairn

### Exit: The barrow mouth

- id: barrow_mouth
- to: halls
- arrive at: halls_to_cairn
- open when: the flag barrow_mouth_found is set or the flag barrow_way_found is set
- locked text: Behind the cairn the stones look heaped and settled. If there is a way in here, it has not been found yet.

## Location: The Barrow Halls

- id: halls
- dm notes: Low halls of the old kings, every third niche empty. Corvane camps here on a coffin lid he uses as a desk, with his journal (Investigation 10) and a small painted portrait of a girl. Tam walks the halls with an unlit lantern pole, humming, two skeletons behind him; they never attack Tam, and once his trance breaks they ignore him and come for the hero. Reaching him with his mother's name is Persuasion 13; following unseen is Stealth 12; seeing the trance is not hurting him and fear will not break it is Medicine 13. Seen, the hero watches Tam walk on as the skeletons turn. A hero who goes down here is carried to the tomb and laid at Corvane's feet, and he apologises. There is no room to swing a long weapon freely.

> Low stone halls under the ridge, lined with niches of bones, every third niche empty. Somewhere ahead a boy is humming. Steps lead down to the north, and the back of a round stone door is set in the east wall.

### Map

```
#########D##########
#nn.n.n.n..n.n.n.nn#
#..................#
#n................n#
#....yz......r.....#
#n................n#
W.........u........E
#n.......ss.......n#
#..................#
#n................n#
#..................#
#n................n#
#..................#
#nn.n.n.n..n.n.n.nn#
####################
```

### Legend

- `#` = wall_stone
- `.` = floor_stone_cracked
- `n` = floor_stone_cracked, prop shelf
- `y` = floor_stone_cracked, prop table_w, feature corvanes_desk
- `z` = floor_stone_cracked, prop table_e
- `r` = floor_stone_cracked, prop rug
- `u` = floor_stone_cracked, spawn tam_entranced
- `s` = floor_stone_cracked, spawn hall_dead
- `D` = floor_stone_cracked, prop stairs_down, exit tomb_stairs
- `W` = floor_stone_cracked, exit halls_to_cairn
- `E` = floor_stone_cracked, prop arch_passage, exit deep_door_back

### Feature: Corvane's desk

- id: corvanes_desk
- description: A coffin lid laid across two stones as a desk: candle stubs, a small painted portrait of a girl, and a book.
- secret: The book is Corvane's journal: two years of entries addressed to "my Lise".
- search dc: 10
- gives: Corvane's journal

### Spawn: tam_entranced

- creature: token_villager
- hostile: no
- awake: yes
- npc: tam
- appears when: the flag tam_freed is not set

### Spawn: hall_dead

- creature: skeleton
- count: 2
- hostile: yes
- awake: no

### Exit: Down to the tomb

- id: tomb_stairs
- to: tomb
- arrive at: tomb_steps

### Exit: Out to the cairn

- id: halls_to_cairn
- to: cairn
- arrive at: barrow_mouth

### Exit: The back of the Deep Door

- id: deep_door_back
- to: lower_mine
- arrive at: deep_door
- open when: the flag deep_door_opened is set or the flag door_gap_passed is set or the flag door_broken is set
- locked text: The round stone is shut from this side too, and too heavy to shift alone.

## Location: King Orrin's Tomb

- id: tomb
- dm notes: King Orrin lies crowned on his bier under the Grave Lantern's cold light. Corvane kneels at the bier's head, reading the rite; two skeletons stand on the steps. Corvane wants five more minutes; the dead want the rite finished. He half suspects the crown cannot give him Lise and has not let himself read the inscription (Religion 12). Talking him down is Persuasion 18, 2 easier for each true thing shown him: the journal, the inscription, Tam's words, Pell's account. He will not stop for threats. Snuffing the lantern while he holds it is Sleight of Hand 13 once the hero is beside him. While the lantern burns, one fallen skeleton stands again at the start of the next round, once. Ringing the Quiet Bell takes an action and drops every skeleton where it stands. Each turn the rite goes on the crown glows brighter; after several turns of nothing, the king's fingers move. Tam, if he is here and entranced, holds up the lantern pole and nothing else. A hero who goes down here watches Corvane finish the rite, and the king sits up.

> A round chamber at the bottom of the barrow, cold enough to see breath. A tall skeleton in rotted royal silks lies on a stone bier, a crown of dark gold on its skull, which has begun, very faintly, to glow. A thin man kneels at its head, reading aloud beside a lantern burning blue.

### Map

```
####################
#####..........#####
###..............###
##....p......p....##
##....q......q....##
#........rr........#
#.......rKr........#
#........rr.v......#
#.....g......g.....#
##....p......p....##
##....Q......q....##
###..............###
#####..........#####
#######.....########
#########U##########
```

### Legend

- `#` = wall_stone
- `.` = floor_stone
- `p` = floor_stone, prop pillar_top
- `q` = floor_stone, prop pillar_base
- `Q` = floor_stone, prop pillar_base, feature bier_inscription
- `r` = floor_stone, prop rug
- `K` = floor_stone, prop rug, spawn orrin
- `v` = floor_stone, spawn corvane_tomb
- `g` = floor_stone, spawn tomb_guard
- `U` = floor_stone, prop stair_up_w, exit tomb_steps

### Feature: The inscription

- id: bier_inscription
- description: Words cut around the base of a pillar facing the bier, in old letters.
- secret: "The crown calls back the body and never the breath. Who wears it, keeps it, cold."
- search dc: 12

### Spawn: orrin

- creature: skeleton
- hostile: no
- awake: no
- npc: orrin

### Spawn: corvane_tomb

- creature: token_robed_figure
- hostile: no
- awake: yes
- npc: corvane

### Spawn: tomb_guard

- creature: skeleton
- count: 2
- hostile: yes
- awake: no

### Exit: Up the steps

- id: tomb_steps
- to: halls
- arrive at: tomb_stairs

## Scene: Act I: Something Is Wrong in Blackstone

- id: act_one
- location: square

> Dusk. A fresh notice by the well names the third missing person, Tam Holt. Mayor Venn reads it to a small, angry crowd and promises a reward to whoever brings the goblins to heel.

### Objective: Find out what happened to the missing

- id: find_missing
- done when: the player talks to Grukka or the flag missing_traced is set or the flag captives_freed is set

### Objective: Bring Bessa and Jory home

- id: free_captives
- done when: the flag captives_freed is set

### Objective: Find out what the mayor is hiding

- id: mayor_hiding
- done when: the flag mayor_involved is set

### Objective: Learn what is stirring under the ridge

- id: stirring_below
- hidden: yes
- done when: the flag something_below is set

### Beat: mayor_involved

- when: the player has the tithe ledger or the player has the buyer's letters or the flag grukka_told is set or the flag wenna_told is set
- sets flag: mayor_involved

> It is all there now: the grain that stopped, the silver that went up the ridge, and the mayor's hand on both. Whatever else is wrong in Blackstone, Aldous Venn has been lying to it.

### Beat: something_below

- when: the flag scratching_heard is set or the flag hobb_told is set or the flag pell_heard is set or the flag dead_seen_on_ridge is set
- sets flag: something_below

> Goblins do not scratch at stone from the far side, and they do not walk the ridge at dusk on bare bone. Whatever the Hollow Teeth have been guarding, it is not the mine.

### Beat: captives_home

- when: the flag captives_freed is set
- spawns: bessa_home
- spawns: jory_home

> Bessa and Jory walk back down the mine road blinking at the light, Bessa already complaining, Jory already telling a story. By evening half the village has heard who brought them home.

### Beat: goblin_deal

- when: the flag goblin_deal is set

> Grukka spits in her palm and holds it out. "Grain, or something worth grain. You bring it, walker, and the Teeth remember."

### Beat: goblin_alliance

- when: the flag goblin_alliance is set and the flag goblins_bloodied is not set
- sets flag: goblin_deal

> Grukka looks at you a long time, then at the mine behind her. "Then we stand at the door together," she says. "Like the old days. Like the oath."

### Beat: goblins_bloodied

- when: the spawn snik is killed or the spawn camp_warrior is killed
- sets flag: goblins_bloodied

> The camp goes very quiet. Grukka draws both her knives and does not take her eyes off you.

### Beat: mayor_exposed

- when: the flag mayor_exposed is set

> The square goes silent, then loud. Venn tries a speech about the village's good name and nobody lets him finish. People who would not look at you an hour ago are looking at you now.

### Beat: mayor_confessed

- when: the flag mayor_confessed is set

> Venn sits down heavily. "It was for the village," he says, and then, quieter, "It was for me. Please. If they knew, I would have nothing."

### Beat: mayor_covered

- when: the flag mayor_covered is set

> Venn shakes your hand too long. "A sensible person," he says. "Blackstone will not forget it." Across the square, the shrine door closes.

### Beat: village_left

- when: the flag village_left is set

> Blackstone watches you walk away, and the talk in the square turns to torches.

### Next

- Act II: The Silver Road when the flag mayor_involved is set and the flag something_below is set

<!-- REVIEW: the first draft's mayor outcomes (exposed, confessed, covered for, walked away) are flags the DM declares; each has a beat so it lands in the story. -->

## Scene: Act II: The Silver Road

- id: act_two

> The mayor broke the oath, and something under the ridge is stirring. The story now is whoever buys the silver, and whatever is behind the Deep Door. Wenna is ready to talk, Pell is ready to be believed, and Grukka wants a word.

### Objective: Find out who is buying the grave-silver

- id: name_buyer
- done when: the flag lamplighter_named is set

### Objective: Find a way under the ridge

- id: way_under
- done when: the flag barrow_way_found is set

### Objective: Find out whether Tam is alive

- id: tam_alive
- hidden: yes
- done when: the flag tam_alive is set

### Beat: lamplighter_named

- when: the player has the archive purse or the flag met_corvane is set or the flag blue_light_followed is set or the flag tam_spoke is set
- sets flag: lamplighter_named

> A royal archive's seal, scratched through. A scholar's hand. A man who carries his own cold light. Whoever buys Blackstone's grave-silver once kept the kingdom's records, and left them in disgrace.

### Beat: midnight_at_the_cairn

- when: the flag cairn_watched is set
- spawns: corvane_cairn
- spawns: cairn_guard

> At midnight a cold blue light rises out of the barrow behind the cairn, and with it a thin man in a scholar's black coat, and two shapes walking beside him on bare bone.

### Beat: barrow_way_found

- when: the flag barrow_mouth_found is set or the flag deep_door_opened is set or the flag door_gap_passed is set
- sets flag: barrow_way_found

> There is a way under the ridge, and someone has been using it.

### Beat: tam_alive

- when: the flag boy_prints_found is set or the flag tam_glimpsed is set or the flag grukka_told is set
- sets flag: tam_alive

> A boy's boots, walking. Not dragged, not carried: walking. Wherever Tam Holt went, he went on his own feet, and he may still be on them.

### Beat: silver_cut_off

- when: the flag silver_cut_off is set

> The last crate will not reach the cairn. Somewhere under the ridge a man who needs it will be counting the days.

### Beat: deep_door_held

- when: the flag deep_door_held is set

> Timber groans into place against the round stone, and the pushing on the far side stops, then starts again, weaker. Up the shaft, someone is whistling.

### Beat: door_breach

- when: the flag door_gives is set and the flag deep_door_held is not set
- spawns: door_dead

> With a grinding of stone the Deep Door slides a hand's width further, and bony fingers curl round its edge. The first of them comes through sideways.

### Next

- Act III: The Unburied King when the flag lamplighter_named is set and the flag barrow_way_found is set

## Scene: Act III: The Unburied King

- id: act_three

> You are going under the ridge, and the Lamplighter knows it. The halls are thick with the dead, a boy carries a lantern pole, and the crown waits on a dead king's head to be lit.

### Objective: Bring Tam Holt home

- id: free_tam
- done when: the flag tam_freed is set

### Objective: Reach King Orrin's tomb

- id: reach_tomb
- done when: the player enters King Orrin's Tomb

### Objective: Stop the crown being lit

- id: stop_crown
- done when: the flag corvane_stopped is set or the flag lantern_destroyed is set or the flag king_at_rest is set

### Objective: Let it end

- id: let_it_end
- hidden: yes
- done when: the flag tomb_quiet is set

### Beat: tam_freed

- when: the flag tam_freed is set

> Tam stops humming. He looks at the pole in his hands as if he has never seen it, then at you, and then he is crying and talking too fast, asking for his mother.

### Beat: corvane_let_go

- when: the flag corvane_let_go is set
- sets flag: corvane_stopped
- sets flag: lantern_destroyed

> Corvane closes the book. For a long moment he looks at the crown, and then he leans over and breathes out the lantern's flame himself, and sits down beside the bier, and weeps.

### Beat: corvane_falls

- when: the spawn corvane_tomb is killed or the flag corvane_captured is set
- sets flag: corvane_stopped

> The reading stops. In the silence the crown's glow falters, steadies, and does not grow.

### Beat: lantern_out

- when: the flag lantern_snuffed is set
- sets flag: lantern_destroyed

> The blue flame gutters and dies. All around the chamber the dead stop where they stand, and then, one by one, lie down.

### Beat: king_at_rest

- when: the flag bell_rung_in_tomb is set
- sets flag: king_at_rest

> The Quiet Bell's note goes down into the stone and does not come back. The light in the crown goes out. King Orrin, who was beginning to stir, is still again, and this time it is the stillness of something that will not wake.

### Beat: crown_taken

- when: the flag player_takes_crown is set
- sets flag: player_crowned

> The crown is lighter than it looks, and colder. As it settles, every dead thing in the barrow turns its face toward you.

### Next

- The Cold Crown when the flag player_crowned is set and the flag tomb_quiet is set
- Dawn over Blackstone when the flag king_at_rest is set and the flag tomb_quiet is set
- A Quiet Ridge when (the flag corvane_stopped is set or the flag lantern_destroyed is set) and the flag tomb_quiet is set

## Scene: The Cold Crown

- id: end_cold_crown

> The crown is on your head and the dead kneel.

### Ending

- outcome: defeat

> The power is real, and so is the price: the cold has already begun, in your fingers, in your breath. Whoever is still near looks at you the way you once looked at Corvane. The dead wait for your first command.

<!-- REVIEW: the first draft gave this ending no outcome; it is recorded as a defeat because the campaign's success is the king asleep, not a new one crowned. -->

## Scene: Dawn over Blackstone

- id: end_dawn

> You climb out into a grey dawn.

### Ending

- outcome: victory

> The king sleeps for good and the dead are still. At the top of the ridge someone is waiting for you. Down in the village they will decide what to do with their mayor, Grukka will have words about the oath, and Wenna Holt is standing at her gate, watching the road.

## Scene: A Quiet Ridge

- id: end_quiet_ridge

> You climb out into the morning.

### Ending

- outcome: victory

> The lantern is out and the dead lie down, but King Orrin still wears his crown in an unsealed tomb. It is over, for now. One day someone will light that crown again, unless the Quiet Bell is brought down to ring over him.

## Scene: The Unburied King Wakes

- id: end_king_wakes

> Under the ridge, a king sits up.

### Ending

- outcome: defeat

> King Orrin is awake and crowned, and every grave on the ridge has emptied. Blackstone cannot be saved tonight. You run with whoever you can carry, and behind you the dead walk down the valley road, which belongs to the king now.

## World

<!-- The villain's clock. A day passes each time the hero sleeps. Cutting off the silver delays the lantern, and everything after it, by three days. -->

### Beat: ridge_walkers

- when: it is day 2 or later
- sets flag: dead_seen_on_ridge
- spawns: ridge_dead

> A shepherd comes running down into the square at dusk, screaming that he saw two skeletons walking the barrow-field. By nightfall Blackstone is blaming goblin witchcraft, and the talk is of raiding the mine.

### Beat: lantern_finished

- when: it is day 4 or later and the flag silver_cut_off is not set
- sets flag: lantern_finished

> That night a cold blue light burns on the top of the ridge, steady as a star, and every dog in Blackstone howls until dawn.

### Beat: silver_taken

- when: it is day 7 or later and the flag silver_cut_off is set and the flag corvane_stopped is not set and the flag lantern_destroyed is not set
- sets flag: lantern_finished
- sets flag: lantern_late

> In the night a thin man in a black coat walks into Blackstone with the dead behind him, and the mayor, white to the lips, gives him the shrine's silver candlesticks with his own hands. By morning a cold blue light burns on the ridge.

### Beat: door_breaks

- when: it is day 6 or later and the flag lantern_finished is set and the flag lantern_late is not set and the flag deep_door_held is not set and the flag corvane_stopped is not set and the flag lantern_destroyed is not set
- sets flag: door_broken
- spawns: square_dead

> The Deep Door breaks. The Hollow Teeth come pouring out of the mine and down to the edge of the village, and frightened villagers meet them with pitchforks. That night the dead walk into Blackstone, and the shrine is full of people until dawn.

### Beat: door_breaks_late

- when: it is day 9 or later and the flag lantern_late is set and the flag deep_door_held is not set and the flag corvane_stopped is not set and the flag lantern_destroyed is not set
- sets flag: door_broken
- spawns: square_dead

> The Deep Door breaks at last. The Hollow Teeth flee the mine for the village's edge, where frightened villagers meet them with pitchforks, and that night the dead walk into Blackstone. The shrine is full of people until dawn.

### Beat: king_wakes

- when: it is day 9 or later and the flag lantern_finished is set and the flag lantern_late is not set and the flag corvane_stopped is not set and the flag lantern_destroyed is not set and the flag king_at_rest is not set
- sets flag: king_woken

> In the night the light on the ridge turns from blue to gold, and every grave on the barrow-field opens at once.

### Beat: king_wakes_late

- when: it is day 12 or later and the flag lantern_late is set and the flag corvane_stopped is not set and the flag lantern_destroyed is not set and the flag king_at_rest is not set
- sets flag: king_woken

> Late, but not late enough: in the night the light on the ridge turns from blue to gold, and every grave on the barrow-field opens at once.

### Next

- The Unburied King Wakes when the flag king_woken is set
