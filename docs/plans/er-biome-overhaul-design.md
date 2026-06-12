# ER Biome Overhaul - design doc (next patch)

Maintainer brief: biomes are "boring as fuck" - just different spawn tables.
Goal: every biome feels unique (shops, items, prices, events, hazards), plus
a real biome SHOP every 10 waves with BW art. This doc is the workshop pass;
nothing here is implemented until reviewed.

---

## 1. The Biome Shop (every 10th wave, after the boss reward)

### Presentation
- FULL-SCREEN shop, visually distinct from the wave shop. Layout:
  - Backdrop: market-stall scene assembled from BW interior tiles
    (a/0/1/4: chip_counter, chip_mat, shelf/wall chips) + biome-tinted
    canvas/awning strip. One base scene, recolored + reskinned per biome
    (desert = sand awning + crates, sea = dock planks + nets, etc.).
  - Left third: the SHOPKEEPER - BW 80x80 battle-sprite class matched to
    the biome (table below), standing behind the counter, with a one-line
    greeting that flavors the biome ("Fresh off the boat, take a look!").
  - Right two thirds: 4x4 item GRID (16 slots) with icons + prices, cursor
    like the starter grid. No more "one row of heals + reward row" - the
    whole screen is stock.
- Stock = 16 slots: 4 staples (heals/balls, always), 8 biome-skewed
  (the biome's affinity table below), 4 wildcards (rarity-rolled, can
  include the community items, TMs, berries).
- Prices: base shop prices x biome modifier (0.6x to 1.6x per category,
  table below). The discount is the reason to LOOK at every shop.
- Money matters more: this is the money-streak system's (#348) sink.

### Shopkeeper casting (BW classes we extracted, rom-work/SURVEY.md)
| Biome group | Class (BW battle sprite) | Flavor |
|---|---|---|
| Town/Plains/Meadow | Picnicker / School Kid | General store |
| Metropolis/Slum/Construction | Clerk / Roughneck | Pawn shop, haggling |
| Forest/Jungle/Tall Grass | Ranger | Field supplies |
| Sea/Beach/Lake/Seabed/Island | Fisherman | Dockside stall |
| Mountain/Cave/Badlands | Hiker / Backpacker | Trail post |
| Desert | Backpacker | Caravan |
| Ice Cave/Snowy Forest | Parasol Lady | Warm drinks stand |
| Power Plant/Factory/Laboratory | Scientist / Doctor | Tech counter |
| Volcano | Battle Girl | Forge stall |
| Graveyard/Ruins/Temple/Abyss | Hex-style (Psychic F) | Curio shop |
| Dojo | Black Belt-style (Battle Girl) | Training goods |
| Fairy Cave | Maid | Sweets shop |
| Swamp | Fisherman (recolor) | Bog trader |
| Space | Scientist | Observatory kiosk |
| Wasteland | Veteran | Survivalist |

### Engine notes
- Hook: after the x0-wave victory, before NextEncounterPhase, push a
  BiomeShopPhase when `waveIndex % 10 === 0` (skip wave 200 finale).
- Reuse ModifierType + money plumbing; new UI handler (BiomeShopUiHandler)
  modeled on starter-select grid input. Buying N items then Continue.
- Assets ship in er-assets (images/biome-shop/<biome>.png backdrops +
  shopkeepers atlas). Build pipeline: rom-work decoders -> PNG -> er-assets.
- Dev scenario: "Biome shop preview (#440)" - start at wave 9 in a chosen
  biome with money override, beat one wild mon, shop opens. One scenario
  per backdrop variant is overkill; scenario takes the CURRENT biome, plus
  a note listing biome override instructions.

---

## 2. Item-biome affinity + pricing (the economy layer)

Mechanic: every shop category gets a per-biome price multiplier and a
stock weight. Data lives in one table (er-biome-economy.ts), editor-friendly.

Categories: HEAL (potions/status), BALLS, BATTLE (X-items, Dire Hit),
BERRIES, TM, HELD (community items, claws, lenses), EVO (stones, items),
CANDY (rare candies), MINTS/NATURE, WARD (ward stones), RESIST (berries).

Anchor examples (full table in the data file, all 32 biomes):
| Biome | Cheap (0.6-0.8x, stocked heavy) | Dear (1.3-1.6x) | Signature stock |
|---|---|---|---|
| Town | HEAL, BALLS | TM, HELD | starter-grade berries |
| Metropolis | TM, EVO | BERRIES | Amulet Coin always slot 5 |
| Slum | everything 0.75x | - | stock is 3 rolls RARER but can be "used" (1 fewer charge etc.) |
| Sea/Seabed | RESIST(Water), Dive-flavored | EVO | Deep Sea items, Shell Bell |
| Volcano | Fire stones, WARD | HEAL | Charcoal, Flame Orb |
| Power Plant | ELEC TMs, Magnet | BERRIES | Thunder Stone, Cell Battery |
| Ice Cave | NeverMeltIce, Ice TMs | HEAL 1.4x (remote!) | Frostbite Orb |
| Graveyard | Spell Tag, Dusk Stone | BALLS | Reaper Cloth |
| Dojo | BATTLE (X-items), Focus items | TM | Muscle Band, Black Belt |
| Fairy Cave | MINTS, sweets | BATTLE | Lucky Heart always stocked |
| Desert | nothing cheap (caravan!) all 1.3x | - | rare HELD exotics (2 ROGUE rolls) |
| Laboratory | CANDY, Ability Capsule | BALLS | Learner's Shroom |
| Space | tech HELD | everything else 1.5x | Comet Shard buyback (sell HIGH here) |

Also: SELL prices vary - each biome overpays 1.5x for one category
(Volcano buys Ice items dear, Metropolis buys everything at book price).
That turns hoarding loot into a route decision.

---

## 3. Per-biome identity (battle layer)

One signature rule per biome - cheap to implement (most reuse existing
weather/terrain/tag systems), big flavor. Full list:

- TOWN: safe start - no identity, tutorial calm.
- PLAINS: "open fields" - run/switch never fails.
- GRASS/TALL_GRASS: wild double-battle chance doubled; Grass terrain
  starts active on entry waves.
- METROPOLIS: trainers pay 1.5x money; pickpocket event (see events).
- FOREST: ambush - 20% of wilds get a free first hit unless your lead
  outspeeds; Bug/Grass spawn skew already exists.
- SEA: non-swimmers (no Water/Flying type, no Levitate) lose 1 Spd stage
  while fielded. Rain more frequent.
- SWAMP: ATTRITION biome - every wave end, grounded non-Poison/Steel mons
  take 1/16 bog chip damage; Poison/Water/Ground mons immune and get +10%
  money find ("forage"). The "bring the right mon or suffer" biome.
- BEACH: sunny; Harvest-style - berries 25% chance to not be consumed.
- LAKE: calm - free full heal once on entry (spring water event).
- SEABED: pressure - both sides' Spd halved below... simpler: all PP costs
  doubled for non-Water mons (heavy water). High catch rates.
- MOUNTAIN: wind - Flying moves +20%, accuracy -5% for all.
- BADLANDS: sandstorm baseline; Rock/Ground immune as usual.
- CAVE: darkness - accuracy -10% both sides unless Flash/illuminate-class
  ability on field (makes Flash/Lantern mons matter).
- DESERT: long-haul - shop prices high, sandstorm, but DOUBLE item drops
  from trainers (caravan raids).
- ICE_CAVE: hail/snow baseline; non-Ice mons 10% frostbite chance per
  wave entry unless holding warm item (Charcoal/Flame Orb neutralize).
- MEADOW: friendship/candy gains +50% (the cozy biome).
- POWER_PLANT: Electric terrain always on; Electric mons +1 Spd stage.
- VOLCANO: entry burn risk for non-Fire grounded mons without protection;
  Fire moves +20% both sides.
- GRAVEYARD: FOG baseline (uses ER fog rework); ghost-event chance up.
- DOJO: COLOSSEUM-LITE - every wave is a trainer (uses erForcesTrainerWave
  machinery), win streak grants escalating BATTLE item drops. The
  "back-to-back fights for rewards" biome already half-exists here.
- FACTORY: held-item drop rate doubled; enemy mons frequently hold items
  (steal targets) - the HOARD-lite.
- RUINS: Unown swarm events; answer = archeology loot (fossils, plates,
  Comet Shards to sell in Space).
- WASTELAND: THE HOARD biome - fewer waves (short, 5), every encounter is
  a big bad single mon (boss-bar) CARRYING 2-3 held items; Thief/Covet/
  Trick and catch = keep the loot. High risk, loot pinata.
- ABYSS: darkness rules + Dark mons +1 crit stage; "no shop here" - the
  one biome with NO 10-wave shop (the dread of it).
- SPACE: DEBUFF biome - all grounded mons -1 Spd and -10% accuracy
  (zero-g); Flying/Levitate/Steel(magnetized) exempt. Psychic terrain
  pulses. Comet Shards drop; sell them here at 2x... no - BUY here, sell
  in Metropolis. (decide in review)
- CONSTRUCTION_SITE: falling debris event between waves (random enemy-side
  Stealth Rock at wave start, sometimes yours).
- JUNGLE: overgrowth - Grass terrain + wild mons +2 levels but +50% candy.
- FAIRY_CAVE: blessed - your status conditions heal 1 turn faster; Mints
  and sweets in shop; infatuation immunity for fielded Fairies.
- TEMPLE: trial - one TOTEM-style boss midway (aura-boosted) that drops a
  guaranteed ROGUE item.
- SLUM: black market (shop rules above); pickpocket event risk - after a
  loss-less wave, 5% an NPC "bumps" you, -5% money, beatable trainer next
  wave returns it x2.
- SNOWY_FOREST: snow + FOREST ambush rules combined; Ice/Dark skew.
- ISLAND: regional variants spawn boost (Alolan etc.); shop = exotic
  imports (one item normally exclusive to another biome).
- LABORATORY: ability-tinkering - Ability Capsule/Randomizer always in
  shop; "experiment" event (free reroll offer with 10% downside).
- END: untouched (finale).

Specialized structure mechanics (engine work, gated separately):
- LONG (20 waves: Desert, Wasteland-hoard excepted, Jungle) and SHORT
  (5 waves: Wasteland, Lake) biome lengths - needs the biome-transition
  cadence to read a per-biome length instead of fixed 10.
- RUNNING SHOES (new GREAT item): single-use, skips to the current
  biome's transition wave (forfeits its remaining shops/loot).
- COLOSSEUM: rather than a new biome id, DOJO becomes it (trainer
  gauntlet). If a true Colosseum backdrop is wanted later, BW2 has the
  PWT arena art (would need the BW2 ROM - maintainer mentioned it).

## 4. Events layer (per-biome flavor encounters)
Reuse the Mystery Encounter system - add `erBiomeEvents` pool keyed by
biome with 1-2 bespoke events each (pickpocket, spring water, debris,
Unown swarm, totem trial, experiment). MEs already support biome gating;
this is mostly content, not engine.

## 5. Phasing (proposed)
1. P1 - Biome shop UI + assets + per-biome stock/prices (the visible win).
2. P2 - Battle-layer biome rules (one PR per group; each gets a dev
   scenario + vitest).
3. P3 - Structure: biome lengths, Running Shoes, Wasteland hoard, Dojo
   gauntlet.
4. P4 - Events layer.
Everything data-driven where possible (er-biome-economy.ts +
er-biome-rules.ts) so the editor site can manage it later.

## 6. Decisions LOCKED (maintainer, 0.0.4.x planning)
1. Biome shop appears IN ADDITION to the x0 reward shop.
2. Biome battle rules apply on ALL difficulties incl. Ace/Youngster.
   (Supersedes the #345 reading: "pure vanilla" still governs SPAWNS and
   item pools there, but biome rules are universal world flavor.)
3. Abyss: NO shop - a Devilish Deal instead (Part II below).
4. Space economy: buy tech cheap there, sell Comet Shards in Metropolis.
5. Biome lengths: this patch, P3.

---
---

# PART II - The interaction grammar ("not every biome speaks the same language")

Maintainer brief v2: biomes must differ not only in WHAT they throw at you
but in HOW YOU ENGAGE them. Colosseum lets you stay or walk away. Caves let
you push deeper at mounting risk. The Abyss makes offers. Curses exist.

## 7. The Crossroads (one engine primitive powers everything)

A choice screen (styled like the ME option dialog, full art panel) that a
biome can raise at defined beats - typically after the x0 boss, next to the
shop. Every option is one of six VERBS; each biome flavors at most ONE verb.
This keeps engine work tiny (one phase + one data table) while every biome
plays differently.

### The six verbs

1. GAUNTLET (stay or walk) - "Another challenger waits. Fight on?"
   - Loop: extra trainer fight -> reward tier escalates (T1 GREAT -> T2
     ULTRA -> T3 ROGUE -> T4 the jackpot: voucher/candy pile) -> Crossroads
     again. FORFEIT at any Crossroads: keep everything banked, biome ends,
     run continues. Lose the fight: run over, like any loss - that is the
     tension. No heals between rounds (Ward/berries matter).
   - Biomes: DOJO (the Colosseum). ISLAND gets a 1-round variant
     (exhibition match vs a Veteran for an exotic import).

2. DELVE (push your luck) - "A passage descends..."
   - Loop: optional extra wave(s) beyond the biome's normal length. Each
     delve depth adds +1 loot roll AND a stacking hazard (depth 1: enemies
     +2 levels; depth 2: +1 curse offered as floor trap (below); depth 3:
     boss-bar guardian with 2-3 held items - the hoard). Leave at any
     Crossroads with everything. Faint-outs are real: the run can end down
     there.
   - Biomes: CAVE, SEABED, RUINS, JUNGLE, ICE_CAVE. (WASTELAND is a
     permanent depth-3: every wave is a guardian.)

3. DEAL (the bargain) - "A figure in the dark clears its throat."
   - The Abyss special; FAIRY_CAVE gets the benevolent mirror (small gift
     for a small vow). Menu of 2-3 offers, each = COST + PAYOFF, both
     drawn from weighted pools, both stated up front. Walk away freely.
   - COST pool (all implementable on existing save fields):
     - Sacrifice: release a chosen party member (scales payoff by its BST).
     - Tithe: all candies of one species you own.
     - Drain: a chosen mon loses 20% of its levels.
     - Seal: a party slot is LOCKED for the rest of the run (5-mon cap;
       reuses the Doubles/slot machinery; the dramatic one).
     - Curse: the devil applies a permanent stat curse (below) to a mon
       of YOUR choice - which is secretly a build tool (Trick Room teams
       happily take -Spd).
     - Embargo: your next 2 biome shops are shuttered.
   - PAYOFF pool: ROGUE item of choice from 3, +2 run Luck, legendary egg,
     revive-all + full heal, money x3 of current, a 5th-move-slot item,
     black-shiny reroll on one mon (1/10).
   - HARD RULE: never touch permanent account data negatively except
     candies (which are an account currency the player consciously
     spends); everything else is run-scoped. Saves stay safe.

4. FORAGE (free roll with a catch) - "Berries glint in the grass."
   - One free pick from a biome-flavored minipool; 20% the pick is
     "guarded" (a wild double-battle ambush before you get it).
   - Biomes: FOREST, MEADOW, BEACH, GRASS, SNOWY_FOREST, LAKE (spring:
     full team heal instead of an item).

5. TOLL (pay or fight) - "The bridge keeper names a price."
   - Pay 10% money: pass quietly (skip next wave entirely). Refuse: fight
     a trainer with +1 reward tier. Either is fine; it is a mood choice.
   - Biomes: MOUNTAIN, CONSTRUCTION_SITE, SLUM (the pickpocket event folds
     into this), BADLANDS.
6. EXPERIMENT (the lab special) - one free Ability-Randomizer-style
   reroll offer with a stated 10% chance of rolling Truant/Slow Start
   (removable later, as normal). LABORATORY, POWER_PLANT.

TOWN/PLAINS/METROPOLIS/TEMPLE/etc. raise no Crossroads - pacing breathers.
TEMPLE keeps its totem fight as a scripted beat instead.

## 8. Curses (the anti-vitamins)

New item class `ER Curse`, the negative mirror of vitamins - a PERMANENT
(run-scoped) -10% to one stat of one mon, displayed as a dark badge on the
summary. Sources: Deal costs, Delve floor traps (depth 2+, always with a
sidestep: lose the loot roll instead), and the Slum shop's "used goods"
fine print. NEVER random unavoidable - always the consequence of a choice.
The twist that makes them DESIGN and not just punishment: curses have
corner-case upside (Gyro Ball / Trick Room love -Spd; a -Atk curse on a
special attacker is free Deal currency), so veterans learn to eat them
deliberately. Cleansing: one shrine event in TEMPLE/FAIRY_CAVE removes a
curse, once per run.

## 9. How a biome composes its language (full stack per biome)
Each biome = passive RULE (Part I §3) + ECONOMY column (§2) + one VERB
(§7) + optional EVENT (§4). Example readings:
- DOJO: rule "every wave a trainer" + gauntlet verb + battle-goods shop =
  the Colosseum run-within-a-run.
- CAVE: darkness rule + delve verb + Hiker trail post = the dungeon crawl.
- ABYSS: dark rule + NO shop + Deal verb = the dread floor.
- SWAMP: attrition rule + no verb (the biome itself is the negotiation) +
  bog trader who sells the antidotes to its own swamp.
- SLUM: cheap-but-used economy + toll verb + pickpocket event = the den.

## 10. Engine inventory for Part II (all small, listed for estimation)
- CrossroadsPhase + er-biome-crossroads.ts data table (verb per biome,
  option text, payload refs). One UI handler, ME-dialog styled.
- Gauntlet loop: repeat-trainer-wave flag + banked-reward ledger +
  forfeit-to-transition. Reuses generateNewBattleTrainer.
- Delve loop: extra-wave counter on Battle, loot-roll multiplier, depth
  modifiers (level bump exists; guardian = boss flag + held items exist).
- Deal: cost executors (release/candy spend/level set/slot lock/curse/
  shop-skip flag) + payoff executors (mostly existing reward plumbing).
- Curse: one PokemonHeldItemModifier subclass with negative stat hook
  (SLOW_START-style multiplier site already exists) + badge icon.
- Slot seal: party-size cap field checked in switch/summon + party UI.
- All of it behind run-scoped fields only; serialized additively (save-safe).
