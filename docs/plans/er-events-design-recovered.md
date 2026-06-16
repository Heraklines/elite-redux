# ER Biome-Overhaul — Recovered Mystery-Event Design Dossier

**Source of truth:** the design conversation transcript
`91d7b1e2-397d-47d4-8fce-1ca7a5d1369d.jsonl`, lines ~116000–131034 (the tail block).
This dossier recovers the *maintainer's actual stated intent* for each event, because the
prior design doc captured these "very, very lackluster" and dropped detail the maintainer
gave verbally.

**Legend for confidence tags:**
- **[MAINTAINER]** = the user's own stated design call (decisive; quoted where it matters).
- **[ASSISTANT-PROPOSED]** = assistant idea the maintainer did NOT explicitly ratify (treat as draft).
- **[OPEN]** = explicitly undetermined / "we have to workshop / playtest this".
- **[BUILT-WRONG]** = what was coded differs from intent (flagged by the maintainer).

> **The framing complaint that triggered this recovery (line 131009, verbatim):**
> *"the actual problem is the item pool should not be the same. Each mystery event has unique
> items associated to it. You can't just share the item pools... Look at all the health items
> that are possible. And then we are going to look for items that we can find there that would
> fit... Mostly it's going to be money, maybe something like that, but the rarity of items also
> has to be appropriate. You can't just hand out all these kind of items to people. You need to
> make it somewhat rare sometimes. For example, one rare item could be a shell bell or something
> like this... obviously we're gonna expand the amount of items that are in this game drastically
> so that we can make some exclusive to mystery events... Also, you have no sense of taste. It
> actually has to be played. This is a game."*

---

## 0. ITEM POOL PHILOSOPHY (read this first)

This is the single most important recovered principle. Every event below must be re-specced
against it.

- **Per-event UNIQUE pools, never shared.** [MAINTAINER] "Each mystery event has unique items
  associated to it. You can't just share the item pools." The current code routes Tide Pools,
  Glittering Vein, Abyssal Vent, Overgrown Temple, etc. through one shared `er-mineral-loot`
  module — this is explicitly wrong.
- **Method to build a pool:** [MAINTAINER] "Look at all the health items that are possible... look
  for items that we can find there that would fit." i.e. curate from existing in-game modifiers by
  thematic fit, then tune rarity.
- **Money-heavy by default.** [MAINTAINER] for Tide Pools/beach: "Mostly it's going to be money,
  maybe something like that." Beach/forage events lean cash, with items as the rare upside.
- **Rarity must be appropriate / restrained.** [MAINTAINER] "the rarity of items also has to be
  appropriate. You can't just hand out all these kind of items to people. You need to make it
  somewhat rare sometimes." A signature rare example he named: **Shell Bell** ("one rare item could
  be a shell bell or something like this").
- **Event-exclusive items are the intended future.** [MAINTAINER] "we're gonna expand the amount of
  items that are in this game drastically so that we can make some exclusive to mystery events...
  but right now we're just gonna work with what we have. You don't have to add a lot of items."
- **Reward design principle (recovered from the Vein/Temple finalization, line ~123847+):** money
  rolls should VARY — usually a jittered payout, a small chance of a big **Nugget**, and a small
  chance of **nothing (a dud)**. Item finds (e.g. Eviolite, Mystical Rock) only on deeper strikes;
  **King's Rock** "pretty much as rare as the Megastone." [MAINTAINER]
- **Broader reward philosophy** [MAINTAINER, line ~124045/124944]: rewards should be "thematic,
  mechanically-meaningful — tools, slots, permanent boons — not 'roll a rarity pool.'" Tool unlocks
  (Damage Calculator, Speed Order panel), permanent identity changes (shiny, type-boon, candy),
  navigation power (map upgrades) — "never a faceless item roll."
- **Danger scales reward.** [MAINTAINER, line ~124156] "I definitely want to have the environments
  that are more dangerous to be way more rewarding." Volcano/Abyss/Wasteland pay master/rogue-tier.

**Note on Shell Bell appearing twice:** it is the **Sea biome shop signature item** (shop layer,
already built) AND the maintainer's example of an appropriate **rare Tide Pools reward**. Both are
intended.

---

## WORLD MAP / ROUTING / VARIABLE BIOME LENGTH / CROSSROADS

This is a top-priority redesign. The shipped "#486" feature is a read-only **node list**, which the
maintainer rejected: [MAINTAINER, line 130397] *"the world map is just a list? not an actual map?
did you DO ANYTHING AT ALL CORRECTLY?"*

### The Map as an item (renaming) — [MAINTAINER, line 123489]
> *"we will need to turn the map into a default item that you get automatically when you start the
> game. Because it's vital to how we play with this new biome system. And the actual map item will
> be renamed to just **map upgrade**, basically. So that it shows you more options, basically more
> biomes that you can visit from there."*

- **Base Map** = default, auto-granted at run start. Shows your surroundings but *not precisely*.
- **Map Upgrade** = the old "Map" item, now **stackable tiers**; each reveals more options / more
  reachable biomes / better routing info.

### Node graph with chance-based adjacency — [MAINTAINER, line 123489 + 131009]
> *"each biome has like a chance, like 30% chance to be reachable from a given biome or something or
> 20% chance, so that there are more nodes you can go from. But it's not guaranteed. And there are
> obviously events as well that can take you to different biomes."*

Refined in the final statement [MAINTAINER, line 131009]:
> *"each run has a different size of biomes... also the cadence: after every five waves, you have the
> option to continue (after the reward screen) — continue in this biome or move to another one. And
> if you decide to move to another one, then we have the normal nodes, but then with a certain
> percent chance, other nodes also appear that can be adjacent — **50% chance** for different kinds
> of biomes to appear there and for a few of them to appear. And obviously **not the same biome from
> before. The only exclusion is a biome from which you already came from. But just the last one** —
> the last you came from, that's the only exception."*

Recovered mechanics:
- **Vanilla biome map mostly kept**, but with **wildcard biomes** that can move around / be reachable
  unexpectedly from other biomes [MAINTAINER, line 120414]: "there's an entire biome map the game
  has... I'll mostly keep it but some wild cards that can move around which you can reach sometimes
  from other biomes which you wouldn't expect... not every run has the same topography."
- **Partial visibility:** you may see ~3 possible next biomes "theoretically but you only know about
  one or only about two" unless you have a Map Upgrade [MAINTAINER, line 120414].
- **Exclusion rule:** the next node options exclude **only the immediately-previous biome**. Nothing
  else excluded.
- **Adjacency roll:** ~20–30% per-biome reachability originally; finalized to a **50% chance** for
  extra adjacent nodes to appear.

### Variable biome length — [MAINTAINER, line 123489]
> *"I don't like this 10 wave cadence and then you change biomes... that's a bit lame. The biomes have
> different sizes and those sizes can vary between runs — they're not always the same. Some biomes
> sometimes will be just five waves long and sometimes some biomes will be 25 or 30 waves long, but
> depending — you don't have to stay for this full duration either."*

- Length **bands** the maintainer approved [line 123563, confirming assistant's proposal]:
  SHORT 5–10, MED 10–18, LONG 18–30, rolled per run. ("these length bands are fine actually.")
- Replaces the hardcoded `waveIndex % 10` cadence with a per-run rolled length +
  a "waves-since-entered" counter.

### The "every 5 waves: continue-or-move" Crossroads — [MAINTAINER, lines 123489, 131009]
> *"after every five maybe waves you get the choice of staying in this biome or... move on."*

- Appears **after the reward screen** every ~5 waves: **Stay in this biome** vs **Move on (open the
  map / pick a node)**.
- Staying longer (dwell):
  - **more & rarer biome mystery events** [MAINTAINER]: "the longer you stay in the biome the more
    likely you're going to run into a mystery event related to that biome." Rarity (= how
    advantageous/game-changing) climbs with dwell.
  - **stronger trainers, proportionally** + **more bosses/boss-mons** [MAINTAINER]: "the longer you
    stay, the stronger proportionally the trainers get. And you're going to run into more bosses...
    with more potential rewards, but also potentially more dangerous."
- **Colosseum is a "pocket space" that does NOT count toward the 200-wave clock** [MAINTAINER, line
  120414] — see Totem/PWT note; relevant to map because it makes total run length variable-but-bounded.

### Status / open items
- The interaction-grammar verbs (GAUNTLET/DELVE/DEAL/FORAGE/TOLL/EXPERIMENT/etc.) are an
  **[ASSISTANT-PROPOSED]** organizing layer; the maintainer repeatedly said he is **[OPEN]** /
  unsure how to surface them in-game: [line 123563] "I'm not sure exactly how you guys imagined this
  interaction grammar in-game... What would I do from wave to wave exactly?" and [line 120414] "the
  interaction grammar... which I have not still not decided on and which I'm still struggling to
  conceptualize right now."
- A **collapsible map UI element** is wanted [MAINTAINER, line 124193]: "we probably need some map
  element, some kind of rudimentary UI element you can just collapse and open if you want, just to
  make sure that you understand where you're going." (Hotkey: the maintainer chose **J** after **M**
  conflicted with the menu.)

---

# PER-EVENT DOSSIER

## Tide Pools (BEACH) — [BUILT-WRONG item pool]
- **First built:** as a press-your-luck forage clone sharing `er-mineral-loot` (wrong).
- **Intended pool** [MAINTAINER, line 131009]: a **UNIQUE** Beach pool, **mostly money**, with
  appropriate-rarity items that *fit the beach*; **Shell Bell** named as the kind of **rare** item
  that belongs here. "Mostly it's going to be money... one rare item could be a shell bell."
- **Berry-find:** Beach is the **no-consume / berry-find biome** [from §3 battle identity: "berries
  25% not consumed"], so berries can surface here too.
- **Structure (recovered intent for forage/low-tide):** the maintainer found "Low Tide" generic and
  parked it for rework [line 124117]: "the low tide is a bit of a generic event... it's not the idea
  that's bad, it's the way it's executed." He liked "choose between three different spots." So:
  comb 3 readable spots (rock pools / wrack line / wet-sand dig), money-heavy, rare item upside.
- **Rarity:** money payouts should **vary** (jittered; chance of a Nugget; chance of a dud).
- **[OPEN]:** exact spot list, exact item table beyond "money + rare Shell Bell + berries."

## Glittering Vein (CAVE)
- **Grammar:** press-your-luck **mining/DELVE**; each strike pulls reward but raises chance of waking
  a guardian / cave-in.
- **Signature reward — EARLY MEGA STONES** [MAINTAINER, line 124214, decisive]:
  > *"you can find megastones... very rarely megastones for pokemon even right now if they're not in
  > the evolved state. Imagine you go there with Charmander, Charmeleon and you find a Mega Charizardite
  > X/Y that you can still give to your Charmeleon — once he evolves you'll be able to have that Mega.
  > That's one way of getting early Mega Stones."*
- **Other rewards** [MAINTAINER]: money; **rock/gem-related items** "depending on the rarity"
  (look at the table). Finalized item finds (line 128047): **Eviolite + Mystical Rock** (uncommon,
  deeper strikes), **King's Rock** (rare, its own low-% roll, "about as rare as the mega stone").
  Everything else (lenses, orbs, plates, claws, Soul Dew, Amulet Coin, Mini Black Hole) was
  explicitly **removed**.
- **Guardians** [MAINTAINER, lines 124214 + 130224]: an **Onix — specifically a Carbonix** (ER
  custom), or if very unlucky a **Regirock**, or a cave-in. Boss after enough interrupts. Guardian
  **BST must climb with depth** and **type must match the biome (Rock/Ground)** — "don't scale the
  BST too fast, it shouldn't go from an NFE to a mega form immediately, but still not too slow."
- **Money variance** as in §0.

## Abyssal Vent (SEABED)
- **Grammar:** deep DELVE (Overgrown-Temple pattern), pressure-rising.
- **Non-Water strain** [MAINTAINER, line 124156]: each delve does chip damage to non-Water mons —
  "maybe some damage per delve... like a sixteenth of the HP or something" (~1/16 max HP per level).
- **Rewards:** UNIQUE seabed pool (NOT shared mineral loot). [MAINTAINER, line 124156] also wants a
  **chance for the Damage Calculator** unlock here. Deep-sea themed items + money.
- **Guardians:** deep-sea species; **BST climbs with depth; type = Water** [MAINTAINER #494].
- **Ward Stone + resist-berry find chance must scale up sharply with depth** [MAINTAINER #491].
- **Known bug [OPEN/#492]:** `EnemyBattleInfo.updateInfo drawImage of null` on vent guardians.

## Overgrown Temple (JUNGLE)
- **Origin:** replaced the rejected "Apex Predator" Jungle idea. [MAINTAINER, line 124095] "I'm not
  sure I like the Apex Predator... it's very similar to another mystery event that already exists...
  I guess the Overgrown Temple is better." It is a **DELVE through vine-choked ruins reclaimed by the
  jungle, traps + a guardian; depth = older relics + a Treasure Map fragment**.
- **Chain final boss = "Eternaburm" (Burmy Eterna, ErSpeciesId BURMY_ETERNA)** [MAINTAINER, decisive,
  line ~127xxx]: "the jungle fortune specifically — the end boss has to be Eternaburm." **Clarified:**
  this is the **final boss of the forage/delve CHAIN, NOT the 200-wave run finale.** Boss must have
  **2–3 health bars** and be **~+5 levels above your strongest mon**.
- **Non-boss guardians:** BST climbs with depth; **type = Grass/Bug**.
- **Forage BST escalation** [MAINTAINER, line 124095]: "if the BST will steadily increase... at some
  point you might face an Eternaburm." Reward scales with depth; chance of running into the boss
  scales with how deep you are (e.g. ~10% early rising to ~50% after 3–4 turns).
- **Rewards on beating the boss:** Pharaoh's-Ankh-class top relic; otherwise money / ultra–great-tier
  items / max one random rogue-tier item, plus possible chip damage from traps.

## Exotic Trader (a real SHOP) — [BUILT-WRONG: was a reward screen]
- [MAINTAINER, line 124117, decisive]: a **real third Sea event** (not optional), with **exotic
  goods where every single good is Master-Ball to Ultra-Ball tier**. "That would be very good. A rare
  event, like a Rogue-tier event. Obviously the prices are still high, but there's some good stuff."
- [MAINTAINER, rework #488]: it must be an **actual SHOP screen** (reuse the biome-shop infra built in
  P1), **Ultra→Master tier goods only, high prices, NO healing items.** Not a reward screen.
- **Sprite:** a pirate captain / Team Aqua trainer keeper [MAINTAINER #490].
- **Rarity tier:** ROGUE event.

## Black Market (a real SHOP) — [BUILT-WRONG: was a reward screen]
- It is also the **Slum biome's shop name** (shop layer, already built: "Slum = Black Market, 25%
  off, signature Wide Lens + Loaded Dice, priceMod 0.75").
- As a **mystery event** [MAINTAINER, rework #489]: a real **bargain SHOP screen** — **cheap "used"
  goods, mixed-tier, with curse-lite fine print** (the cheap stuff can carry a small downside).
  NOT a reward screen.
- **Sprite:** a proper shady **black-market dealer/shopkeeper** [MAINTAINER #490], not the chest.
- **[ASSISTANT-PROPOSED → confirmed direction]:** alternative warm Slum event "The Stray" was offered;
  maintainer kept Black Market as the Slum shop event and approved a separate **Fight Club** event for
  the Slum (see below).

## Picnic (food spread → candy / affection / biome catch) — [BUILT-WRONG: was a flat catch]
- [MAINTAINER, line 124095, decisive]:
  > *"The Picnic one is great — use all of the food related items, the more you use the more generous,
  > then you're gonna get a bunch of candy and affection for your Pokémon, like **5 to a maximum of
  > 10 candy** for all the Pokémon. Like base — obviously there are multipliers on candy gain, so
  > depending on your multipliers it could be more. Also a chance an approaching **rare or ultra-rare
  > Pokémon from that biome** could approach you — that's a chance, obviously depending on how generous
  > you are. Generosity will have to playtest exactly how much."*
- **Inputs:** the player **chooses how many FOOD items** to lay out (not just berries); payoff scales
  with the spread.
- **Outputs:** party-wide **Candy (5→~10/mon pre-multiplier) + Affection**, and a scaling chance a
  **biome-native rare/ultra wild mon joins** (and gets dex-registered).
- **Home biome:** Meadow (the bonding biome). Daycare also belongs in Meadow [MAINTAINER, line 124038].
- **[OPEN]:** exact generosity curve, max candy, exact join chance — "will have to playtest."

## Hot Spring (guardian Pokémon, pay in berries) — [MAINTAINER, decisive]
- [MAINTAINER, line 124045]:
  > *"a Hotspring that's guarded by Pokémon, and they don't take money, but they take **berries** as
  > payment. If you want to rest there you'll have to pay them the berry tax — maybe **two or three
  > berries to fully rest your team.** That could be more in the wilderness — not a jungle, but the
  > mountains or something."*
- **Built correctly later:** Slowking guardian intro sprite, **BERRY_COST = 3**, option greyed out
  under 3 berries, **no money**. (Earlier build used money — that was wrong; fixed.)
- **Biome:** Mountain / wilderness (NOT jungle).
- **Sprite:** a **guardian Pokémon** (the Pokémon are guarding it), not a chest.

## Still Waters (mirror match, your own items) — [BUILT-WRONG: items + BST cap]
- This is the **Mirror Pool**, homed at the **Lake** (still/sacred) [MAINTAINER, line 124117]:
  > *"Still Waters, the Mirror Pool's home — oh I like this one, yes... your reflection on the glassy
  > water steps out: a shadow clone of your current squad... beat yourself, **rogue-tier reward**. It
  > uses the **same items as you** — so for a smart person they could get some extra items too.
  > Exactly, that's great."*
- **Mechanics:** enemy = a clone of your **current squad** (same builds, scaled), **using your own
  held items** (a smart player exploits this). Reward = **rogue-tier**.
- **Two known bugs the maintainer flagged:**
  1. The clone wasn't copying your held items [#495 — fixed: clones held-item modifiers onto the
     mirror, marked non-transferable].
  2. The **BST-cap routine was clipping the mirror** [#: fixed by exempting all mystery-encounter
     battles from the #419 BST cap]. [MAINTAINER, line 130397] "the still waters event gets hit by
     the BST cap routine, we need to make exceptions for certain mystery events."

## Lake Spirit (quiz) — [MAINTAINER, approved]
- [MAINTAINER, line 124117]:
  > *"Lake Spirit could be **Celebi**... it offers a blessing matched to a test: **Knowledge** = a
  > riddle; **Emotion** = a bond check; **Willpower** = a tough opponent and a power relic. That's
  > completely fine with me. Let's put this at an **Ultra-Ball** event."*
- **Three branches, choose one:**
  - **Knowledge** → riddle / Pokédex quiz → tool unlock (Damage Calc / Speed Order) or candy.
  - **Emotion** → reads team friendship → affection/candy boon.
  - **Willpower** → tough optional fight → power relic.
- **Rarity:** ULTRA event. **Sprite:** Celebi (or Uxie/lake-trio flavor).

## Fairy's Boon / Fairy Cave (blessing) — [MAINTAINER]
Two distinct Fairy Cave events were designed:
- **The Wishing Crystal** [MAINTAINER, line 124193]: make a wish and **choose your blessing** —
  power / protection / luck / bond. The **event rolls at different tiers**; at high tier (rogue/master)
  the wish can make a chosen mon **permanently shiny** (lowest tier-1 shiny only). The maintainer was
  **[OPEN]** on exact implementation: "I'm not sure exactly how we're gonna make this work... so this
  mystery event can come at different rarities? You roll the dice, and the rarity of the blessing
  determines what you get."
  - **Vow mechanic** [MAINTAINER]: "I would like the idea of a vow. And if you ever in a mystery event
    commit a crime, then you get hunted down by really strong fairy monsters" (ties to future
    notoriety system).
- **The Fairy's Boon** [MAINTAINER, GREAT tier as built]: the **benevolent DEAL** — a blessing for a
  small fair price. Creative relic = **"Pixie Charm"**: [MAINTAINER] "team-wide maybe luck, like two
  or three luck extra, and a periodic minor heal — like every five rounds heal ~1/6 of max HP for each
  team member." The built version grants a random Formation/buff relic.
  - **Sprite:** Clefairy / Clefable / Mega Clefable [MAINTAINER #490].

## Echo Chamber (CAVE — scout) — [MAINTAINER, line 124214]
- Sound-move-gated **SCOUT**: a mon with a **sound move** echoes louder and reveals more.
  [MAINTAINER]: "reveal / scout ahead what kind of biome you can go into from there. Pokémon with a
  sound move could work. There are lots of sound moves that are tagged."
- **Cross-cutting idea** [MAINTAINER]: "some move tags we could take advantage of — kicking moves,
  slicing moves — to actually get something out of it. Use that data." (Gate events on move flags.)
- **Reveals map nodes** (Phase D map event). **Sprite:** Noibat.

## Observatory (SPACE — scout) — [MAINTAINER, line 124193]
- Telescope/constellation read → **reveal the run map far ahead** + big money (Comet Shard).
  [MAINTAINER]: "you can get some money and reveal the map far ahead. How would we reveal? We need
  some UI element... a star chart could work — a partial map so you can review all the nodes you
  wouldn't otherwise see."
- Creative relic **"Star Chart"** = permanent partial map-reveal each transition. **Sprite:** Lunatone.

## Informant (SLUM) — [MAINTAINER, line 124231]
- [MAINTAINER]: "what if it gives you information on the location of an item and then **guarantees you
  in two or three waves a specific rarity of drops** — you'd be guaranteed a rogue-tier item if you
  pay the cash. And maybe also reveal more map nodes." Pay money → buy info (guaranteed future drop of
  a chosen rarity, and/or node reveal). **Sprite:** Nickit.

## The Storm (SEA — travel) — [BUILT-WRONG: random target]
- [MAINTAINER, line 124117]: liked **revealing a distant node you couldn't otherwise reach** and
  **carrying weather into the next biome in your favor**. The "guess the weather" was the weak link;
  fix [MAINTAINER]: the signal comes from **your own team's weather abilities/innates** —
  > *"maybe we take abilities, innates or whatever that are activated by weather... my Pokémon's
  > ability is activating, and then maybe it's the sun, the fog, something else — and then you can
  > take that weather with you into the next biome. It reveals a node and you have the option of taking
  > that weather with you."*
- **[BUILT-WRONG]:** shipped version just sets a random travel target; should read weather via your
  weather-ability mon + carry weather + reveal a distant node. **Sprite:** Pelipper.

## Ultra Wormhole (SPACE — travel) — [MAINTAINER, approved, line 124193]
- [MAINTAINER]: "travel to a distant biome of your choice — any biome — or brace an Ultra Beast. Yeah
  that's perfect, an Ultra Beast monster, that's amazing, a really good one." Step through → jump to
  any biome; OR a dangerous Ultra-Beast catch for a big cosmic prize. **Sprite:** Cosmog.

## Lost Wanderer (FOREST/PLAINS) — [MAINTAINER, line 123955/123962]
- Original "give directions" was a plot hole [MAINTAINER]: "if they're lost how could they give you
  directions?" Fixed to **both lost, escape together**: the only exit is blocked by a territorial
  guardian → **ally double battle** against it (a mechanic no other ME has) → win = break out =
  shortcut/map-reveal + shared loot; alternative = go separate ways (decline). Nav reward is **earned
  by the fight**, never handed over. **Built as a lighter reveal event** (flagged near-duplicate).

## Sunken Vessel (SEABED — scout/tool) — [MAINTAINER, line 124156]
- "The sunken vessel is fine, in my opinion, it's good." Salvage a wreck's data core (pressure-rising
  delve, non-Water mons strained) → **information**: scout upcoming map nodes OR a **tool unlock**
  (Speed Order). **Sprite:** Dhelmise. (Shipped as a lighter reveal variant.)

## Message in a Bottle (SEA) — [MAINTAINER, line 124117]
- "Message in a bottle is fine." The clean **Treasure Map Fragment source**: a bottle yields a
  fragment (or a note pointing to a reward node). **Sprite:** Wingull. (Built: grants +1 fragment +
  charts onward routes.)

## X Marks the Spot (BEACH) — [MAINTAINER, line 124117]
- The **redemption site** for Treasure Map Fragments. [MAINTAINER, decisive]:
  > *"if you get the three fragments you should be able to **return to the beach automatically** — a
  > node, the next biome, will reveal itself. That has to be tracked by the fragments. Regardless of
  > how you got the three fragments, you are able to return to the beach. We're gonna put it at like a
  > **Great-Ball-tier** mystery event in terms of rarity — it's not a really high chance."*
- Bring 3 fragments → dig → high-tier payout (clean home for Greater Golden Ball / Phoenix-tier).
  **Rarity:** GREAT. **Sprite:** Gimmighoul.
- **TREASURE_FRAGMENTS_FOR_REWARD = 3.**

## Aurora (SNOWY FOREST — ice) — [MAINTAINER, line 124095, decisive]
- > *"like the Aurora, you're gonna get a rare blessing — heightened luck, better catch, etc., for
  > say 20 waves. The longer you stay under it, the more you get — but some of your Pokémon might get
  > frostbite if you stay too long. At the beginning it's a better catch rate; stay longer it's better
  > crit rate; stay even longer it's better luck, etc. Some Pokémon don't get frostbite — **ice
  > Pokémon are immune**, and anything with an ability that keeps them warm like **Magma Armor** —
  > otherwise your Pokémon slowly get frostbite."*
- A **press-your-luck blessing-linger loop**: each tier of staying adds a stacking boon (catch → crit
  → luck), with rising **frostbite risk** to non-immune mons (Ice types + warm abilities exempt).
- **Synergy:** the **"Thermal Core"** relic (party-wide frostbite immunity) lets you milk this far
  longer [ASSISTANT-PROPOSED]. **Sprite:** Cryogonal.

## Frozen Shapes (ICE CAVE — ice/quiz) — [MAINTAINER, line 124156]
- The maintainer rejected the "Ice Slide" minigame (too complex for now) and replaced it with the
  **Zoom quiz** from the dugramen/pokemon-quiz repo he linked:
  > *"something is trapped under the ice... there's the Zoom minigame where it zooms into a Pokémon and
  > you have to guess which one it is. Maybe it's under the ice and you can zoom in — you only see a
  > small part, you have to guess. Depending on which Pokémon it is, you either get to face it (so you
  > can catch it) or you can break it out and it'll be thankful and give you something really rare —
  > like a rogue-tier event with a really rare relic."*
- Built as a silhouette/zoom quiz → tiered cache. **[OPEN]:** which rare relic it gives.
- Companion event **"Frozen in Time"** [MAINTAINER, line 124156]: thaw it (Fire move/type, or an
  **Ever-Melt-Ice** item) → wake a rare ancient mon to catch; OR **chip it out by hand** → the
  crystal-preserved held item, no fight.

## Foreman's Job (CONSTRUCTION SITE — boss trial) — [MAINTAINER, line 124156]
- The plain "pay toll or clear squatters" version was too generous for the "Hard Hat" relic.
  [MAINTAINER]: "the Hard Hat is way too good for this little thing... so I was thinking some Pokémon
  have been making it impossible — like **three to four boss monsters** — and you can get a Hard Hat as
  a reward. This is too easy otherwise; it would have to be something pretty strong to get a Hard Hat."
- So: clear **3–4 boss-tier mons** at the site → reward (Hard Hat or equivalent). **Sprite:** the boss
  species you'll face. Built as a construction-golem boss trial.
- **Related orphan reward — "Moveset Workshop"** [MAINTAINER, line 124214]: homed at the **Mountain
  Sage**, not Construction; "you can build the entire move slot of an all-legal TMs, tutors, and egg
  moves... or get a training boon (a stat increase and maybe some candy) — not always a relic, we
  shouldn't always give out relics."

## Overcharge Core (POWER PLANT — boss trial / experiment) — [MAINTAINER, line 124175, decisive]
- > *"Overcharge the core — oh that's really good, I love that idea. Permanently increase the Sp.Atk or
  > Speed... we can do like **5% per surge**... short-circuit chip damage and losing that session's
  > gains, absolutely. The max we can raise is **a bit more than vitamins — a maximum of 20%** for
  > those stats. You can also charge all the **Power Herb items and Ward Stones** automatically, and
  > maybe overcharge them to **+1 capacity** — but there has to be a limit, maybe you can only do it
  > **twice**, or for two Pokémon, or two items."*
- Press-your-luck: each surge banks ~5% permanent Sp.Atk/Spd (cap ~20%), rising short-circuit risk.
  Also a limited (≤2) charge-station for charge-items / +1 capacity.
- **Companion "Reactor Meltdown" knowledge check** [MAINTAINER]: "what if there are three Pokémon near
  the reactor — you can't reach them but you need to give one an order, and you have to pick the one
  with the highest Speed (or Sp.Atk, etc.) to activate the shutdown." Or "let it blow" and loot.

## Salvage Yard (FACTORY — market/craft) — [MAINTAINER, line 124214, decisive]
- The maintainer rejected another press-your-luck loop here. Two intended Factory ideas:
  1. **The Fabricator/Duplicator** gated behind the **item-icon quiz** (dugramen repo): "look at the
     icon of an item and guess its name; pass three or four in a row → a relic that lets one of your
     Pokémon (say the 3rd slot) **copy a random item from your team every 10 waves**."
  2. **Item smelting/production** [MAINTAINER]: "you can produce your own items — the more items you
     pour in, the higher rarity item you can get, weighted by value. Pour in a bunch of berries → max
     an ultra-ball-tier item; pour in more → higher. We have to figure out the sensible weighting."
- Built as a "market" — **[OPEN]/likely needs rework** toward the smelter/copy-relic intent.

## Import Bazaar (ISLAND — market) — [MAINTAINER, line 124231]
- Home for **regional/Redux forms**. [MAINTAINER, "Regional Emissary"]: "it would be cool if you
  fight a trainer with **only Redux forms and regional forms**, and if you win you get to keep one of
  their Pokémon — you can choose one." Plus exotic regional items. Built as a plain market —
  **[OPEN]/likely needs the fight-and-keep-one mechanic.**
- Island also gets the **Totem Trial** (below).

## Totem Trial (TEMPLE / ISLAND) — [MAINTAINER, line 124231 + 124193]
- **Island Trial** [MAINTAINER]: "the Totem challenges, yes — face a Totem, an aura-boosted boss that
  summons an ally. Clear it for a reward. We have a **Power Gem** in the game, maybe use the Power Gem
  as the reward." Dangerous-ish = rewarding.
- **Temple's signature is actually the Innate Shrine** [MAINTAINER, line 124193, decisive]:
  > *"the Innate Shrine could be really good for the Temple. Temporarily for a few biomes for a modest
  > cost — that would work on Pokémon that have their innates still **locked**, so you unlock them for
  > the rest of the run. Or pay a steeper cost to unlock them **permanently** (also works in starter
  > select). You give an offering and you can permanently unlock an innate. There's going to be a trial
  > — you fight a boss monster, nothing too crazy: some ward stones, resistance berries, a couple of
  > health bars."*
- **Cleansing Font** (Temple) [MAINTAINER]: "remove a curse — gated to when you do have a curse. If
  you don't have a curse, it buffs your HP like a vitamin, +10 or so, for all Pokémon."
- **Sprite:** the actual boss species you will face [MAINTAINER #490].
- The built "Totem Trial" is a boss→reward+relic; ensure the reward = Power Gem and the Temple variant
  is the Innate Shrine.

---

## Additional approved events recovered (not in the headline list but designed in the same region)

These were explicitly approved by the maintainer and belong in the same redesign; included so the
spec is complete.

- **Graveyard "Graves of the Fallen"** [MAINTAINER, line 123921]: ~3 real fallen-player ghost graves
  (epitaph = name · difficulty · wave died · what killed them). **Pay respects** (leave a berry/decent
  item) → a **memento** = one item from that fallen team. **Disturb** → fight their real ghost team →
  win = take **2 of their held items** (NOT the whole set — "that would be way too strong"). Reading
  the epitaph IS the scouting. Phoenix Feather is the rare top payout. **Held-item capture on ghost
  teams was added** (forward-only; legacy graves fall back to "a random Ultra-Ball-tier item or
  berry"). [MAINTAINER]: "for ghost trainers we don't have item lists retroactively, it's gonna be a
  random ultra ball tier item or berry."
- **Graveyard "Unfinished Business"** [MAINTAINER, line 124021, "rly rly good"]: fight the **exact
  team that ended that player's run** (`opponentParty`) → avenge them → **a random relic** they were
  reaching for. ("how do we determine the prize they were reaching for? probably just a random relic.")
- **Woodland Forager (FOREST)** [MAINTAINER, line 123955]: press-your-luck FORAGE; **hauls/fights do
  NOT count toward wave count** (whole ME = one wave). BST steadily increases; chain final boss with
  2–3 bars, ~+5 levels. Forager's Pack relic.
- **Mushroom Circle / Apricorn Tree / Daycare / Town Guessing Booth / Professor's Scrambled Pokédex /
  Town Raffle / Talent Agency (permanent shiny, rogue/master rarity) / Underground Trade (hunted) /
  Auction House / Sommelier / Wandering Merchant / Bog Witch's Bargain (devious hidden-rarity offering
  → curse if you under-offer) / The Sinking Mire / Outlaw's Bounty / High Noon duel / Buried City /
  The Mirage / Dragon's Hoard / Scavenger's Pact / Fight Club (dirty tricks) / Gene Lab / Subject X /
  The Gadget (innate-replacing one-per-battle any-move-on-switch item)** — all approved with specific
  notes; see transcript lines 124034–124238 for each. The Gadget [MAINTAINER, line 124231] is
  explicitly novel: "it replaces one of your innates — you choose which — with the ability to use any
  move you can learn on the turn you switch in, once per battle, like a gadget exploding."

### Approved REWARD / RELIC catalogue (drives event payouts)
[MAINTAINER verdicts, lines 124045/124193]: Weathervane (good), Beacon (good), Coin Purse (good),
**Collector's Album** ("super fucking good"), Scrap Magnet (good), **Anchor** ("love it"), Twin Link
(fine), Poacher's Cage (good), Abandoned Backpack (works), Warm Incubator ("works on every egg
currently hatching"), **Bonded Charm** ("such a good idea" — soft baton pass: boost one mon, switch to
second lead, it keeps the boost), Shiny Charm (master-ball reward), **Phoenix Feather** (MASTER tier:
revive whole team to HALF HP on a wipe; championship/EX reward pool). **Cut:** Trail Rations (full heal
on biome entry already exists), **Mentor** (maintainer "don't understand it"), Symbiosis. **Field
Medic** (slots 2–3 heal active every 3 turns), **Quartermaster** (slot 5 copies 4/6 item every ~10
waves). **Golden Ball** = master-tier, +1 reward option over cap; **Greater Golden Ball** = +2 over
cap, rarer, separate high-tier reward. **EX-champion reward** = one random **tier-1–3 shiny (not
black)** on a random Pokémon + **either Golden Ball or 7th slot (one or both).** Themed balls
(Momentum/Streak/Underdog/Heavy-Hitter; **Gambler's Ball must NOT quite be a Master Ball** — "almost
masks the ball but not quite").

---

## Quick "what's wrong vs intended" table for the events the maintainer is redesigning

| Event | Built as | Intended (recovered) |
|---|---|---|
| Tide Pools | shared mineral loot | UNIQUE beach pool, mostly money, rare Shell Bell, berries, 3 readable spots |
| Glittering Vein | shared loot | early Mega Stones (very rare), Eviolite/Mystical Rock, King's Rock (=mega-rare), Carbonix/Regirock guardians |
| Abyssal Vent | shared delve loot | UNIQUE seabed pool, ~1/16 chip/delve to non-Water, Damage-Calc chance, ward/resist scale w/ depth |
| Overgrown Temple | shared delve loot | vine-temple DELVE, chain boss = Eternaburm (2–3 bars, +5 lv), fragment |
| Exotic Trader | reward screen | real SHOP, Ultra→Master goods, high prices, no heals, pirate/Aqua keeper |
| Black Market | reward screen | real bargain SHOP, used goods, curse-lite, shady dealer sprite |
| Picnic | flat catch | choose food spread → 5–10 candy + affection party-wide + scaling biome rare/ultra join |
| Hot Spring | money | guardian Pokémon, pay 2–3 berries, no money (built correctly later) |
| Still Waters | no items, BST-capped | clone uses YOUR held items, rogue reward, exempt from BST cap (both fixed) |
| The Storm | random travel target | read weather via your weather-ability mon, carry weather, reveal distant node |
| World Map | read-only node list | branching graph, variable length, 5-wave Crossroads, Map/Map-Upgrade, 50% adjacency, exclude only last biome |

---

*End of recovered dossier. Items marked [OPEN] are the maintainer's own undetermined points and must
be playtested/decided, not invented. Items marked [ASSISTANT-PROPOSED] were never ratified and should
be re-confirmed before building.*
