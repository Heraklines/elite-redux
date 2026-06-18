# Biome encounter composition + on-mon item distribution (design)

**Date:** 2026-06-18
**Status:** Ideation for review. Extends `er-biome-overhaul-design.md` (§14 freq, §20
grammar, §3 rules). Companion to the biome-rules work in progress. Nothing here is
built yet.

Goal: make each of the 34 biomes feel distinct not just in spawn table but in
**what kind of fights you get, how those fights play, and what the mons carry.**
Biome rules apply on ALL difficulties (world flavor, per the overhaul doc §6.2).

---

## 1. What's already coded (so we build only the gaps)

Per-biome TODAY (driven by `ErBiomeRule` in `er-biome-rules.ts`): weather, terrain,
entry status (burn/frostbite), swimmer/grounded Spd drop, **ambushChance** (free
first hit, wild only), **wildLevelBonus**, **doubleBattleMult**, accuracy/darkness,
typeBoost, berrySaveChance (Beach harvest).

NOT per-biome yet (all single, clean hook points identified):
- Trainer rate — vanilla `arena.trainerChance` + DOJO force + difficulty cadence.
  Hook: `game-mode.ts:isWaveTrainer` (~L309).
- Event (ME) rate — fully run-global (anti-variance ~target/run). Hook:
  `battle-scene.ts:~4246` (`successRate`).
- Boss rate / bar count — wave + overstay only; `getEncounterBossSegments` never
  reads biome. Hooks: `battle-scene.ts:2323` (rate), `:2336` (segments).
- Enemy held items — difficulty + wave only, never biome. Hooks:
  `generateEnemyModifiers` (`battle-scene.ts:3489`, vanilla count) +
  `applyErTrainerHeldItems` (`er-trainer-runtime-hook.ts:736`, ER layer).
- Encounter STYLE (dirty fighting) — only inside the Fight Club ME; primitives
  (`mysteryEncounterBattleEffects`, `startOfBattleEffects`, `EnemyPartyConfig`) are
  ME-gated, not wired to normal waves.

---

## 2. The knob taxonomy (everything we can pull per biome)

### A. COMPOSITION — how the wave-type mix is weighted
- `trainerMult` — x on the vanilla trainer odds. (DOJO already hard-forces.)
- `eventMult` — x on the ME success rate (see §3 for the target math).
- `doubleMult` — x on wild-double odds (exists as `doubleBattleMult`).
- `bossPct` — flat % added to the per-wave boss roll (like the notoriety hook).
- `bossEveryWave` + `bossBars` — Wasteland-style: every wild is a boss-bar mon,
  bar count forced to a 2-3 toss-up. (NEW: biome-aware boss segments.)
- `skipChance` — Desert-style: a flat % that a wave is EMPTY (auto-advances, no
  fight, "nothing out here"). The wave still counts for wave index / biome length.
  When a wave is NOT skipped, composition is hard-skewed to "something notable"
  via `skipFallback` (see below) instead of the normal trainer/wild mix. (NEW.)
- `skipFallback` — when a non-skipped wave fires in a skip biome, the weights for
  what it becomes: e.g. Desert = ~60% mystery event / ~40% boss monster, ~0
  ordinary trainer or wild. So the biome is long dead stretches punctuated only by
  an ME or a boss.

### B. STYLE — how the fight itself plays
- `encounterStyle: "dirty"` — trainers fight dirty (subset of Fight Club: rigged
  held items like Quick Claw/Focus Band/Wide Lens, an opening Sand-Attack/Fake-Out
  "blind", occasional lead omni-boost). NEW: wire the ME primitives to trainer waves.
- `ambushChance` — free enemy first hit if your lead doesn't outspeed (exists).
- weather / terrain / entryStatus / spd-drop / darkness — exist.
- `wildLevelBonus` — tougher wilds (exists).

### C. ON-MON ITEMS — what the enemy carries
- `enemyItemMult` — x on the vanilla per-mon held-item roll count (Factory 3x).
- `wildBerryChance` + `wildBerryPool` — % a WILD mon carries an EXTRA berry, on
  TOP of the vanilla roll, via a NEW minimal path (does NOT touch the trainer-only
  resist-berry logic). Pool is per-biome (plain berries, pinch berries, or a
  weakness-matched resist berry for hostile biomes).
- `wardStoneBias` — multiplier on the ward-stone assignment chance (Wasteland /
  Volcano bosses high). Ward stones are already boss/trainer-gated; bosses qualify.
- `itemFlavor: ErShopCategory[] | itemKey[]` — which items skew onto mons for the
  EXTRA rolls (reuses `ER_SHOP_CATEGORY_POOL`; e.g. Factory = manufactured/HELD,
  Volcano = Water/Ground/Rock resist berries, Power Plant = Cell Battery/Magnet).

---

## 3. Event-rate target (clarified)

Baseline tuned so a run AVERAGES one ME roughly **every 10-15 waves** (~the existing
~16/run feel), but it VARIES (probabilistic, not fixed cadence). `eventMult` scales
the per-wave roll per biome, so event-heavy biomes (Graveyard, Ruins) feel haunted
and dense biomes (Dojo) almost never roll one. Mystery Charm relic still DOUBLES the
chance on top. Implementation: multiply the per-wave `successRate` by `eventMult`
(bursty; a long event-heavy route can exceed the run average, by design).

---

## 4. Items to import (mainline gear ER uses; not yet in our pool)

ER's combat items are mainline, so these are safe, well-understood imports. Grouped
by the biome flavor they unlock:

- **Eviolite** — not-fully-evolved bulk +50%. ER is FULL of mid-evo "Redux" mons →
  huge value. Cave/Meadow/wild biomes.
- **Weather rocks**: Heat (Sun), Damp (Rain), Smooth (Sand), Icy (Snow) — extend the
  biome's own weather. Volcano/Desert/Sea/Ice.
- **Terrain Seeds** (Electric/Grassy/Misty/Psychic) + **Terrain Extender** — Power
  Plant / Forest-Jungle / Fairy Cave / Ruins-Temple.
- **Type Gems** (one-shot 1.3x nuke) + **Type Plates** (+20% STAB) — per-biome type
  flavor (Fire Gem Volcano, Steel/Iron Plate Factory, Earth Plate Desert...).
- **Reactive defensive items**: Cell Battery (+Atk on Electric hit), Absorb Bulb /
  Luminous Moss (Water hit), Snowball (Ice hit), Weakness Policy (super-effective) —
  Power Plant / Sea-Swamp / Ice / boss encounters.
- **Survival/utility**: Air Balloon, Heavy-Duty Boots, Safety Goggles, Throat Spray,
  Eject Button — Factory/Construction (manufactured), Desert/Snow (survival gear).
- **Berries beyond resist**: stat-pinch (Liechi/Ganlon/Salac/Petaya/Apicot/Lansat/
  Starf), retaliation (Jaboca/Rowap/Kee/Maranga), Custap (move-first), Sitrus/Oran/
  Lum/status-cure — the wild-berry pool fodder.

Each import = a `PokemonHeldItemModifier` type (most map to existing vanilla classes;
weather rocks/seeds/Eviolite already have classes per the modifier inventory). This
is a separate workstream from the biome data; biomes just reference the item keys.

---

## 5. The wild-berry path (separate, additive, no resist-berry-logic change)

A new minimal function `maybeAssignErWildBerry(enemy)` called in
`applyErTrainerHeldItems` (the per-mon chokepoint) for WILD mons only:
- gated by `getErBiomeRule(biome).wildBerryChance` (0 = off);
- on a hit, picks ONE berry from the biome's `wildBerryPool` and `addEnemyModifier`;
- pools: berry biomes -> Sitrus/Oran/Lum + pinch berries; hostile biomes
  (Volcano/Wasteland) -> a resist berry matched to the mon's worst weakness (reuses
  the `ErResistBerryModifier` item but via THIS new picker, NOT the trainer-only
  `maybeAssignErResistBerry`, which stays untouched).
This is purely on TOP of the vanilla roll. Trainer mons keep getting resist berries
from the existing path; wild mons get the new extra berry.

---

## 6. The full 34-biome profile (reasoned)

Shorthand. Trainer: `--` 0.3x / `-` 0.6x / `·` 1x / `+` 1.6x / `++` 2.5x / `force`.
Event: `-` 0.7x / `·` 1x / `+` 1.6x / `++` 2.2x. Boss: `·` +0 / `+` +25% / `++` every
wave (2-3 bars). Db = wild-double 2x. Berry% = wild-berry chance.

| Biome | Trainer | Event | Boss | Style | Berry% | Held flavor (extra rolls) |
|---|---|---|---|---|---|---|
| TOWN | - | · | · | calm | 10 | starter berries (Oran/Sitrus) |
| PLAINS | · | - | · | open (run never fails) | 20 | Sitrus, Lum |
| GRASS | - | · | · | Db, Grass terrain | **50** | pinch berries, Grassy Seed |
| TALL_GRASS | - | · | · | **Db**, ambush | **75** | pinch + retaliation berries |
| METROPOLIS | + | + | · | balanced; trainers carry **more items** (itemMult ~1.5) | 0 | Amulet-coin/utility on trainers |
| FOREST | · | · | · | ambush, Db | **60** | pinch berries, Eviolite (mid-evos) |
| SEA | · | - | · | rain, swimmer Spd drop | 25 | Damp Rock, Absorb Bulb, Passho |
| SWAMP | - | · | · | bog chip, Poison skew | 30 | Black Sludge*, Toxic Orb, Rindo/Shuca |
| BEACH | - | · | · | sun, berry-save (harvest) | **60** | Sitrus/Oran (harvest synergy) |
| LAKE | - | - | · | calm (spring heal) | 30 | Mystic Water, Sitrus |
| SEABED | - | · | + | dive pressure, high catch | 25 | Deep Sea Tooth/Scale, Damp Rock, Passho |
| MOUNTAIN | · | - | · | wind | 20 | Hard Stone, Eviolite, Charti |
| BADLANDS | · | - | + | sandstorm | 15 | Smooth Rock, Soft Sand, Shuca |
| CAVE | - | · | + | darkness | 20 | Eviolite, Hard Stone, Everstone-mons |
| DESERT | -- | (skip) | (skip) | **~40% waves SKIP (empty)**; non-skip = 60% ME / 40% boss, sandstorm | 10 | Smooth Rock, Safety Goggles, Heavy-Duty Boots |
| ICE_CAVE | - | · | + | hail, frostbite entry | 20 | Icy Rock, Snowball, Yache, NeverMeltIce |
| MEADOW | - | · | · | cozy (+candy) | 40 | pinch berries, Grassy Seed |
| POWER_PLANT | · | · | · | Electric terrain | 0 | Cell Battery, Magnet, Electric Seed |
| VOLCANO | - (1-2 trainers) | · | **++ boss-heavy** | burn entry, hostile | 0 (wild) | **weakness resist berries (Passho/Shuca/Charti)**, high **ward stones** |
| GRAVEYARD | - | **++ event-heavy** | + | fog | 0 | Spell Tag, Kasib, Reaper-flavor |
| DOJO | **force (every wave)** | - | + | trainer-dense | 0 | Black Belt, Focus items, Muscle Band |
| FACTORY | · | - | + | manufactured | 0 | **itemMult 3x**, Air Balloon/Cell Battery/Iron Plate/Eject Button/lenses |
| RUINS | - | **++** | + | ancient | 10 | Plates, Psychic Seed, relic-flavor |
| WASTELAND | **-- (half normal)** | - | **++ every wave = 2-3 bar wild** | hostile hoard | 0 (wild) | **high ward stones** + loaded held items (itemMult ~2 on the bosses); survival gear |
| ABYSS | -- | + | ++ | darkness, dark crit | 0 | Weakness Policy, dread-flavor; NO shop |
| SPACE | -- | · | + | zero-g (Spd/acc debuff) | 0 | Iron Ball, tech utility, Psychic Seed |
| CONSTRUCTION | · | · | · | debris (random Rocks) | 0 | Hard Hat-flavor, Iron Plate, Heavy-Duty Boots |
| JUNGLE | - | · | + | overgrowth, +levels +candy | **60** | pinch berries, Grassy Seed, Eviolite |
| FAIRY_CAVE | - | · | · | blessed, Misty terrain | 30 | Misty Seed, Roseli*, sweet-flavor |
| TEMPLE | - | · | + | trial (totem beat) | 10 | Plates, ward stones on the guardian |
| SLUM | · | + | · | **DIRTY fighting** | 0 | rigged gear (Quick Claw/Focus Band/Wide Lens) |
| SNOWY_FOREST | - | · | · | snow + ambush | **60** | Icy Rock, pinch berries, Yache |
| ISLAND | - | · | + | regional/redux skew, totem trial | 25 | exotic/regional-flavor, Power Gem on totem |
| LABORATORY | - | · | · | experiment | 0 | Ability-item flavor, Eviolite, utility |

(END = finale, untouched.)

---

## 7. Per-biome reasoning notes (the distinctive ones)

- **WASTELAND** (your call): NOT a trainer biome — trainers ~half normal. Instead
  EVERY wave is a wild **boss-bar** mon, a 2-3 bar toss-up, **loaded** (high ward
  stones + ~2x held items). It's a short, brutal loot-pinata gauntlet. The danger IS
  the reward (more rewarding per the overhaul's "danger -> reward" principle).
- **VOLCANO** (your call): very boss-heavy (only 1-2 trainers / wilds between
  bosses), hostile but a notch under Wasteland. NO fire items on the mons (they're
  already Fire) — instead **resist berries vs their weaknesses** (Passho/Shuca/Charti
  for Water/Ground/Rock) + high ward stones, so the boss fights are walls.
- **FACTORY** (your call): **3x** held items, manufactured/utility flavor (Air
  Balloon, Cell Battery, Iron Plate/Steel Gem, lenses, Eject Button). The steal-
  target / hoard-lite biome; Thief/Knock Off pays.
- **METROPOLIS** (your call): BALANCED trainer + event (not trainer-dominant);
  trainers carry **more items** (a trainer-only `enemyItemMult` ~1.5).
- **GRAVEYARD** (your call): event-heavy (`++`); fog; ghost-flavored gear.
- **DESERT** (your call): a sparse, less-traveled crossing where most waves are
  literally EMPTY. ~40% of waves SKIP (auto-advance, no fight, "nothing out here")
  via `skipChance`; the wave still counts toward wave index / biome length. When a
  wave DOES fire, it is almost never an ordinary trainer/wild - `skipFallback`
  skews it ~60% mystery event / ~40% boss monster. So Desert plays as long dead
  stretches broken only by a notable event or a lone boss. Survival gear (Heavy-
  Duty Boots, Safety Goggles) reads as "you packed for a long crossing". Trainer
  rate stays `--` for the rare non-skip, non-ME/boss case.
- **SLUM** (your call): the **dirty-fighting** biome — generalizes Fight Club to
  ordinary trainer waves: rigged held items + an opening blind (Sand Attack/Fake
  Out) + occasional lead omni-boost. The "everyone cheats here" den.
- **DOJO**: already force-trainer every wave; low events; martial-goods on mons.
- **GRASS/TALL_GRASS/FOREST/JUNGLE/MEADOW/SNOWY_FOREST/BEACH**: the berry belt —
  high `wildBerryChance` (50-75%) so "every grassy mon has a berry", wild doubles,
  ambush in the wooded ones.

---

## 8. Data model + hooks (build plan)

Extend `ErBiomeRule` with the §2 fields (all optional, default = vanilla):
```ts
encounter?: { trainerMult?; eventMult?; doubleMult?; bossPct?; bossEveryWave?; bossBars?; };
style?: "dirty" | undefined;          // + the existing ambush/weather/etc.
enemyItems?: { countMult?; trainerCountMult?; wildBerryChance?; wildBerryPool?; wardStoneBias?; flavor?; };
```
Read sites (all already single hooks): trainer `game-mode.ts:309`; event
`battle-scene.ts:4246`; boss rate `:2323` + segments `:2336`; vanilla item count
`battle-scene.ts:3489`; ER per-mon layer `applyErTrainerHeldItems` (wild-berry +
flavor + ward bias). Dirty style = new code wiring the ME primitives
(`startOfBattleEffects` opening move + `mysteryEncounterBattleEffects` omni-boost +
rigged `modifierConfigs`) onto trainer-wave generation for `style==="dirty"` biomes.

Build order:
1. Add the `ErBiomeRule` fields + read hooks for COMPOSITION (trainer/event/boss/
   double) + boss-bar-every-wave (Wasteland). Data-only, low risk.
2. `enemyItemMult` (Factory 3x) at the vanilla count site.
3. The wild-berry path (new `maybeAssignErWildBerry`, additive).
4. Import the new item types (Eviolite/weather rocks/seeds/gems/plates/reactive) +
   `itemFlavor` skew.
5. Ward-stone bias.
6. `encounterStyle: "dirty"` (new wiring; biggest piece) — Slum.
Each step: data-driven, save-additive, dev scenario, all-difficulty.

---

## 9. Decisions to lock
1. Event-rate model: per-wave `successRate` multiply (bursty) - CONFIRM vs scaling
   the run target.
2. Wild-berry path is SEPARATE from resist-berry logic - CONFIRMED (your call).
3. Volcano/Wasteland wild bosses get resist berries via the new wild path - confirm
   weakness-matched selection is the rule.
4. Dirty-fighting subset for Slum trainer waves: which tactics (rigged items always;
   opening blind sometimes; omni-boost rarely?) - needs a tuning pass.
5. Item import scope: do all of §4 now, or just the per-biome essentials first
   (Eviolite, weather rocks, Cell Battery, gems/plates)?
