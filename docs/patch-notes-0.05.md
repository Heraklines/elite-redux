# Elite Redux v0.05

The biggest update yet: a full World Map and biome overhaul, dozens of new
mystery encounters, a relic and item system, and a much smarter Elite/Hell AI.

Baseline: everything since the last live release (the asset-crash + Move Learn
QoL hotfix). 273 commits.

---

## The World Map and biome overhaul

This is the centerpiece of 0.05. A run is no longer a fixed conveyor belt of
10-wave biomes. It is now a journey across a branching World Map, where each biome
has its own length, its own battle conditions, its own mix of fights and events,
and its own reward flavor, and where overstaying has consequences.

### The World Map

- **A real, visual map.** Press M (or use the map node) to open the World Map: a
  chain of biome thumbnails showing where you have been, where you are, and the
  routes branching out ahead. Your onward routes are drawn as paths from your current
  biome, and you pick which route to take directly from the map screen.
- **Branching routes, rolled per run.** Each biome leads to several possible next
  biomes, decided fresh each run, so the world is different every time. The roll
  avoids short back-and-forth loops (it excludes the last couple of biomes you just
  came from), so you are always moving forward into new territory.
- **The Map is a permanent item, with upgrades.** Every run, on every difficulty,
  starts with the Map. How many of the routes ahead you can actually SEE is gated by
  your Map tier: the base Map reveals a subset of the branching nodes, and the
  Upgraded Map reward (and Treasure Map fragments collected along the way) reveal more
  of what is coming, so you can plan your path. Routes are color-coded by how you
  learned of them.
- **Scouting the unknown.** Several encounters and effects peek further down the map:
  The Storm reveals a distant node, the Fortune Teller and Observatory point ahead,
  and Treasure Map fragments build toward fuller reveals. Routes you have not yet
  uncovered show as dashed, tentative paths.

### Biome length and the Crossroads

- **Variable biome length.** Each biome rolls its own length, roughly 7 to 25 waves,
  biased a little toward the longer end. A biome can be a quick passage or a long
  haul, and you will not know its exact end in advance.
- **The Crossroads.** Every 5 waves spent in a biome you reach a crossroads and
  choose: Stay and keep exploring this biome, or Leave for a new area (which opens
  the map picker). The biome's rolled length is still a hard cap, so it will end on
  its own eventually even if you keep choosing to stay.
- **Rest and shop cadence.** You still get a full party heal and a shop every 10
  waves, independent of biome boundaries.

### Biome Notoriety (the cost of lingering)

- The first stretch of waves in a biome (about 10) runs the normal difficulty curve.
  If you DELIBERATELY choose to stay past that at a crossroads, the locals take
  notice and the biome turns hostile: enemy levels and power creep upward, bosses and
  trainers appear more often, and held-item, resist-berry and Ward Stone drop rates
  climb, all scaling the longer you linger.
- This is purely local and optional. Notoriety only builds from a deliberate "Stay"
  past the free window, never from normal traversal, and it resets the moment you
  leave, so the global curve resumes exactly where it should. The game warns you once,
  on the wave you first cross into notoriety territory. Staying is a real risk-versus-
  reward gamble: harder fights, but richer loot.

### Every biome now plays differently

Three layers stack to give each biome its own identity: its **battle conditions**
(weather, terrain, hazards, field rules, applied on every difficulty), its
**encounter mix** (how often you hit a trainer, a wild boss, or a mystery event), and
its **on-mon loot** (the themed items enemies tend to carry). Highlights:

- **Grass / Tall Grass:** Grassy Terrain on entry and doubled wild double-battle odds.
  Tall Grass adds ambush. The berry belt, where wild mons commonly carry berries.
- **Forest / Snowy Forest:** ambush (a wild foe can snatch a free first move if you
  do not outspeed it); Snowy Forest also brings snow.
- **Jungle:** Grassy Terrain, wild mons spawn a couple of levels higher, and more
  bosses.
- **Meadow:** the cozy biome, boosted friendship and candy gains.
- **Sea / Seabed:** non-swimmers lose Speed on entry; Seabed runs more bosses.
- **Lake:** calm and quiet, fewer trainers and events.
- **Beach:** harsh sun, plus a Harvest-like chance to preserve a consumed berry.
- **Swamp:** a bog that chips grounded, non-Poison/Steel mons each turn.
- **Mountain:** wind lifts Flying-move power but lowers everyone's accuracy.
- **Cave:** darkness lowers accuracy unless a Flash or Illuminate user is on the
  field; more bosses.
- **Badlands / Desert:** sandstorm. The Desert is a sparse crossing: trainers are
  rare and the waves that do happen lean toward bosses and events.
- **Ice Cave:** snow, plus a chance to inflict frostbite on non-Ice grounded mons on
  entry; more bosses.
- **Power Plant:** Electric Terrain is always up.
- **Volcano:** Fire moves hit harder for both sides, a burn risk on entry for non-Fire
  grounded mons, and it is boss-heavy.
- **Graveyard:** fog, and it is event-heavy and haunted (mystery encounters fire far
  more often).
- **Ruins:** ancient and event-heavy, with more bosses.
- **Wasteland:** the gauntlet. Almost every wild wave is a 2 to 3 bar boss, trainers
  are rare. Short, brutal, and rich in loot.
- **Abyss:** darkness, Dark-type attackers crit more easily, very boss-heavy, and no
  shop.
- **Space:** zero-g lowers grounded mons' Speed and accuracy; Psychic Terrain.
- **Plains:** open fields, running and switching never fail.
- **Fairy Cave:** a blessing, fielded mons cannot be infatuated and recover from sleep
  faster; Misty-flavored.
- **Metropolis:** busy and balanced, more trainers and more events than usual, and
  trainers carry more items.
- **Dojo:** wall-to-wall trainers (its hall-of-fighters identity), few events.
- **Factory:** manufactured goods, enemies carry more items.
- **Island:** exotic, biased toward regional variants and Redux forms in the wild.
- **Slum:** more events.

### Biome shops reworked

End-of-biome shops no longer sell elixirs or healing items (you already get a full
heal every 10 waves). Each biome instead stocks a themed signature line that fits the
place, so what is for sale tells you where you are.

---

## Mystery encounters

A large wave of new and reworked mystery encounters, themed to their biomes.

**Delve and press-your-luck (push for more loot, risk an interruption):**
Glittering Vein (Cave), The Overgrown Temple (Jungle), Into the Caldera (Volcano),
The Buried City (Desert), The Abyssal Vent (Seabed), Salvage Yard, Woodland Forager
(Forest), Scavenger's Pact. Delve finds scale with depth and can turn up Ward Stones
and resist berries; guardians grow stronger and match the biome's type the deeper
you go.

**Shops and trades:** Black Market (real bargain shop), Exotic Trader, Import Bazaar
(Island), The Exchange.

**Combat and duels:** World Tournament (a full Battle-Tournament gauntlet in the
Dojo arena with a 15-challenger bracket, graded rewards, and an escalating shop),
High Noon (Badlands single-strike duel), Fight Club, Still Waters (a mirror match
against your own team and held items), Reactor Meltdown (Power Plant), Frozen in Time
(Ice Cave), Sinking Mire and Bog Witch's Bargain (Swamp).

**Ghosts and graves:** Graves of the Fallen (pay respects for a memento, or disturb
a real fallen challenger's ghost team for their items) and Unfinished Business
(finish a fallen player's fight against the exact team that beat them).

**Catch-flow:** The Gentle Giant, Rustling Grass, Dragon's Hoard.

**Puzzles and minigames:** the Unown Cipher (Sealed Door, decode a word), Dormant
Guardian (Braille seal), Tracks in the Snow (footprint identification), the Guessing
Booth and Scrambled Pokedex silhouette quizzes with a tiered reward ladder.

**Crafting and unlocks:** Great Forge (temper an item), Fabricator (feed items for a
value-based output), Innate Shrine (a run-scoped permanent innate unlock for one
Pokemon), Overcharge the Core (a permanent stat surge).

**Boons, blessings and travel:** The Fortune Teller (preview and steer your next
encounter), The Wishing Crystal and Fairy's Boon (Fairy Cave), The Mountain Sage,
The Picnic (Meadow, choose your spread), Hot Spring (guardian plus berry tribute),
The Mirage (Desert), The Cleansing Font (Temple), Lake Spirit, Totem Trial (Island),
Regional Emissary (Island regional-form exhibition), Foreman's Job, The Aurora, The
Experiment (Laboratory), Frozen Shapes, The Storm (reveals a distant map node),
Echo Chamber, Ultra Wormhole, Sunken Vessel, Town Raffle, Mushroom Circle.

Mystery encounter frequency was tuned to about one every 11 waves on average, with
the new ER events tiered by rarity. Many events now show a themed Pokemon intro
sprite, and reward pools use real item rarities. Mystery encounter battles are
exempt from the power-gate cap.

---

## Items, relics and rewards

- **Relic system.** A new class of run-long relics with standalone icons, granted by
  events and shops. New relics include the Coin Purse (more money), Mystery Charm
  (raises the mystery-encounter rate), Field Medic (heals the reserves), Bonded Charm
  (soft baton-pass: keep the lead's boosts when you switch), Molten Core and
  Capacitor (team-wide type-damage buffs), Pharaoh's Ankh (a once-per-battle team
  revive), and more.
- **Elemental Gems (18 types).** A one-shot held item that boosts the holder's first
  move of its type by 30 percent, then shatters.
- **Terrain Seeds (4).** Grassy, Electric, Misty and Psychic seeds that raise a
  defensive stat once while their terrain is active. They now trigger the instant the
  terrain appears, including from the holder's own terrain-setting ability.
- **Reactive held items.** Cell Battery, Absorb Bulb, Luminous Moss, Snowball and
  Weakness Policy, which react to the hits they take.
- **Ward Stones** turn up from delve events and scale with depth.
- **The biome Map is a default item** on every run and every difficulty, with an
  Upgraded Map reward that reveals more of the routes ahead.
- **Greater Golden Ball** reward (more reward options), depth-scaled challenge tokens
  on press-your-luck and guardian fights (they never persist past the encounter), and
  themed on-mon items: enemies in a biome can now carry biome-flavored gems, seeds and
  reactive items.

---

## Smarter Elite and Hell AI

- Elite and Hell trainers and bosses now play far better. They score moves by real
  simulated damage, accuracy and lethality, switch to better matchups and pivot out
  of doomed ones, use setup and hazards sensibly, and play safely in double battles.
  Elite keeps a small chance to misplay; Hell does not.
- **Hell now uses a positional, Foul-Play-style brain** that looks a turn ahead: it
  weighs its move against your best reply and the resulting board, so it secures
  knockouts that deny your turn, snipes with priority, refuses to set up into a
  knockout, and trades better. Elite stays on the standard smarter brain.

---

## Pokedex editor and data

- **Pokedex Editor.** A web tool to edit learnsets, TM compatibility, abilities and
  the ER innates (three passive slots), covering every species with an evolution and
  form navigator. Edits apply in-game through a fail-safe overrides loader.
- **ER innates** (the triple-passive model) are now applied in-game.
- A large batch of community Pokedex updates: learnsets, egg moves, abilities and
  species/item tuning.

---

## Fixes and balance

- **Move and ability fixes (to match the 2.65 dex):** Aegislash Stance Change
  un-stuck, Accelerate now actually skips charge turns, Wind Rider raises the higher
  attacking stat, Cloud Nine clears weather on switch-in, Castform gains a Foggy form
  in fog, Roar of Time reworked, Smokescreen creates an ER smoke field (party evasion
  up), Festivities and Accelerate corrected.
- **Stability:** resilient asset fetching with cache-bust retries and crash-proofing
  for animation and sprite loads, and reward-screen crash fixes for ER-custom items.
- **Encounter and run fixes:** stopped ER custom species leaking into vanilla
  Youngster/Ace runs and the Safari Zone, biome notoriety no longer sticks at maximum
  after a save load and no longer spams its warning, and several mystery-encounter
  reward, tier and crash fixes.

---

_Note: the level-up Move Learn panel and the earlier asset-crash fix shipped as a
prior hotfix and are already live._
