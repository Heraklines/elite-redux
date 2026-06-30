# Shiny Lab x Achievements: unlock-condition design

Status: PROPOSAL for review. Nothing wired yet. Redline the tables, then we implement.

## Decisions locked
- **Unlock model = unlock-to-buy.** Completing a bound achievement flips the effect from
  `locked-achv` to `buyable`; the player still pays that species' candy to own it. This reuses the
  existing `available` set + `resolveErShinyLabEffectState` exactly.
- **Retroactive + additive.** Availability is computed live from `gameData.achvUnlocks` (every earned
  achievement is recorded permanently), so already-cleared achievements unlock their effect on the
  next Shiny Lab open with no migration. We never erase an existing unlock path: wild-catch (`owned`),
  candy-buy, completion-reward tokens, and the persisted `erShinyLabAvailableEffects` bitset all
  remain. An achievement binding only ADDS a way in.
- **Coverage ~50%.** ~77 of 154 effects become achievement-gated; ~77 stay buyable from the
  start (tier-gated only). Kept the strongest themes; weaker/duplicate pairings dropped to OPEN.
  The 11 effects that already carry a (currently dead) `lockHint` stay gated;
  their fictional achievement names (Midas, Going Nuclear, Cold Open, Prism Break, Eclipse,
  Untouchable) are retargeted to real achievements.
- **A few new combined-condition achievements** for marquee auras (see below).

## Mechanism (technical)
1. Replace the loose `LOCK_HINTS: Record<id,string>` with a structured
   `EFFECT_ACHV_BINDINGS: Record<effectId, AchvKey>` in er-shiny-lab-effects.ts.
2. `lockHint` display text is derived from the bound achievement's localized name ("Clear: Inferno").
3. When building the config, union into `available`: every effect whose bound achievement is present
   in `gameData.achvUnlocks`. (Retroactive, additive, no per-species storage.)
4. On `validateAchv(X)`, also grant availability for X's effects immediately (live mid-run feedback);
   the load-time union is the source of truth for persistence.
5. New combo achievements: defined in achv.ts + validated from challenge/difficulty/victory state in
   er-achievement-tracker.ts (same machinery as limbo/purgatory/inferno).

## Proposed NEW combo achievements (need sign-off)
"Elemental Apex" family — win an Elite OR Hell classic run with a mono-type challenge + Doubles Only +
Ghost Trainers all active (same victory check as inferno, swapping NU usage-tier for a mono-type).
Each unlocks one marquee aura.

| New achievement | Condition | Unlocks (aura) |
|---|---|---|
| Scorched Earth | Elite+ win, Mono-Fire + Doubles Only + Ghost Trainers | `flame` |
| Absolute Zero | Elite+ win, Mono-Ice + Doubles Only + Ghost Trainers | `icespikes` |
| Endless Night | Elite+ win, Mono-Dark + Doubles Only + Ghost Trainers | `shadowfire` |
| Tempest | Elite+ win, Mono-Electric + Doubles Only + Ghost Trainers | `sparkstorm` |
| Worldtree | Elite+ win, Mono-Grass + Doubles Only + Ghost Trainers | `petals` |

(Can extend to the other 13 types later; starting with 5.)

---

## PALETTES (63) — open 19, bound 44

OPEN (buyable from the start, no achievement): glacier, chrome, sepia, copper, camo, negative,
iridescent, pearl, moonstone, rust, oilspill, sapphire, emerald, jade, rosequartz, rosegold, sunset,
comic, abyss.

| id | label | → achievement | theme |
|---|---|---|---|
| aurum | Aurum | 100KMoney (Rich) | gold [was "Midas"] |
| obsidian | Obsidian | monoDark | black glass |
| amethyst | Amethyst | monoPsychic | purple gem |
| inferno | Inferno | monoFire | fire |
| toxic | Toxic | monoPoison | poison [was "Going Nuclear"] |
| verdigris | Verdigris | monoSteel | patinated metal |
| spectral | Spectral | monoGhost | ghost |
| void | Void Bloom | permadeath | void/death |
| shadowflame | Shadowflame | devilsBargain | hellfire |
| thermal | Thermal | 2500Dmg (That's a Lotta Damage) | heat map |
| synthwave | Synthwave | monoElectric | neon |
| onyxgold | Onyx Gold | 10KMoney (Money Haver) | gold tier 1 |
| ultraviolet | Ultraviolet | stellarTerastallize | hidden light |
| acid | Acid | monoBug | acid green |
| bubblegum | Bubblegum | monoFairy | sweet |
| blood | Blood | backInBlood (Predator win) | name match |
| antique | Antique | relicHunter | relics |
| frostfire | Frostfire | monoFire | fire/ice |
| mono | Monochrome | masterOfAll (18 mono ribbons) | mono mastery |
| prismarine | Prismarine | monoWater | sea crystal |
| nebula | Nebula | catchLegendary | cosmic |
| venom | Venom | snakesOnAPlane | snakes/venom |
| solarflare | Solar Flare | gigantamax | huge burst |
| royal | Royal | classicVictory (Undefeated) | champion |
| deepsea | Deep Sea | catchSubLegendary | deep water |
| sakura | Sakura | maxFriendship | affection |
| mythril | Mythril | megaEvolve | legendary metal |
| cursed | Cursed | exorcist | cursed/ghost |
| plasmatic | Plasmatic | autoCounter | energy/ability |
| duoink | Duo Ink | monoNormal | plain two-tone |
| duoneon | Duo Neon | monoElectric | neon |
| duomono | Duo Mono | freshStart | minimal |
| duoblood | Duo Blood | monoFighting | blood/fight |
| duomint | Duo Mint | monoGrass | mint |
| duosunset | Duo Sunset | monoFlying | sky |
| duomecha | Duo Mecha | metalSlime (Snorlax +6 Def) | mecha/metal |
| trisunset | Tri Sunset | monoFlying | sky |
| triforest | Tri Forest | nuzlocke | wilds survival |
| quadvapor | Quad Vapor | splice (Infinite Fusion) | fusion |
| pentacandy | Penta Candy | passives (Passive Mastery) | candy-heavy |
| pentajewel | Penta Jewel | allShinyTiers (All That Glitters) | jewels |
| synthwavesun | Synthwave Sun | dailyVictory | sunrise/daily |
| gameboy | Game Boy | monoGenOne (The Original Rival) | Gen 1 |
| retro | Retro | monoGenTwo | GBC era |

---

## SURFACES (49) — open 15, bound 34

OPEN: rainbow*, aurora, hologram, mercury, marble, rimlight, vaporwave, halftone, sparkle, ripple,
scales, tvstatic, crosshatch, oilfilm, heatshimmer.
(*rainbow stays open as the basic foil; the prestige rainbow lives on the aura layer.)

| id | label | → achievement | theme |
|---|---|---|---|
| holofoil | Holo Foil | seeShiny (Shiny) | foil/shiny |
| prismatic | Prismatic | allShinyTiers | all shinies |
| frostbite | Frostbite | monoIce | ice [was "Cold Open"] |
| glitch | Glitch | hollowWickerBasket | broken reality |
| galaxy | Galaxy | catchLegendary | cosmic |
| plasma | Plasma | monoElectric | energy |
| molten | Molten | monoFire | lava |
| electric | Electric | monoElectric | bolts |
| dissolve | Dissolve | splice | fusion/merge |
| lavacracks | Lava Cracks | monoFire | lava |
| frozenice | Frozen Ice | monoIce | ice |
| crystalfacets | Crystal Facets | terastallize (STAB Enthusiast) | tera crystal |
| stainedglass | Stained Glass | terastallize | crystal/glass |
| bioluminescent | Bioluminescent | monoBug | glow bugs |
| constellation | Constellation | stellarTerastallize | stars |
| aurorawings | Aurora Wings | monoFlying | sky aurora |
| gildededges | Gilded Edges | 1MMoney (Millionaire) | gold trim |
| lightningveins | Lightning Veins | sorryForTheWait (charge KO) | charged power |
| dripgold | Dripping Gold | 10MMoney (One Percenter) | molten gold [Midas top] |
| spectrumsplit | Prism Split | stellarTerastallize | prism [was "Prism Break"] |
| circuit | Circuit | autoCounter | wiring/triggers |
| scansweep | Scan Sweep | beamSpam (Mega Launcher win) | beam sweep |
| poison | Toxic Bubbles | monoPoison | poison [was "Going Nuclear"] |
| kaleido | Kaleido | flipInverse (A Distorted World) | distortion |
| fractalflow | Fractal Flow | flipStats (Equivalent Exchange) | math/fractal |
| wormhole | Wormhole | breedersInSpace | space |
| shatter | Shatter | shieldBreak (KO through screen) | breaking |
| caustics | Caustics | monoWater | underwater light |
| pixelpulse | Pixel Pulse | cccCombo (5th-hit KO) | combo pulse |
| neonwire | Neon Wire | monoElectric | neon |
| starmap | Star Map | catchSubLegendary | stars |
| synthscan | Synth Scan | weaveNationCertified (dodge x3) | scan/evasion |
| sunsetsun | Sunset Sun | dailyVictory | sun/day |
| tron | Tron | gigantamax | grid/giant |

---

## AURAS (42) — open 12, bound 30

OPEN: outline, halo, rings, orbit, smoke, embers, snow, bubbles, fireflies, petals*, rain, luminous.
(*petals stays open unless we ship Worldtree; if Worldtree ships, petals moves to bound.)

| id | label | → achievement | theme |
|---|---|---|---|
| flame | Wing Flame? (flame) | NEW: Scorched Earth | fire apex [was "—"] |
| shadowfire | Shadow Fire | NEW: Endless Night | dark apex |
| frost | Foot Frost? (frost) | monoIce | ice [was "Cold Open"] |
| efield | Electric Field | monoElectric | electric |
| auroraveil | Aurora Veil | monoFlying | sky |
| holyrays | Holy Light | 10000Heal (Recovery Master) | holy/heal |
| cosmos | Cosmic Backdrop | breedersInSpace | space [was "Eclipse"] |
| radiant | Radiant Burst | gigantamax | radiant power |
| wingflame | Wing Flame | monoFire | fire wings |
| footfrost | Foot Frost | monoIce | ice |
| crown | Crown | classicVictory (Undefeated) | champion crown |
| underlight | Underlight | limbo | apex (Ace/Youngster) |
| uprising | Uprising | iJustGotHere (switch-in KO) | dramatic entrance |
| topbeam | Top Beam | beamSpam | beam |
| sideaura | Side Aura | yo (first shiny) | starter shimmer |
| magiccircle | Magic Circle | monoPsychic | arcane |
| vortex | Vortex | flipInverse | distortion |
| galaxyspiral | Galaxy Spiral | catchLegendary | cosmic |
| sparkstorm | Spark Storm | NEW: Tempest | electric apex |
| prismburst | Prism Burst | stellarTerastallize | prism |
| icespikes | Ice Spikes | NEW: Absolute Zero | ice apex |
| rainbowglitter | Rainbow Glitter | shinyParty (full shiny party) | rainbow/shiny |
| cursedaura | Cursed Aura | inferno (Hell apex) | YOUR EXAMPLE |
| goldenglow | Golden Glow | 10MMoney (One Percenter) | gold [was "Midas"] |
| shadowaura | Shadow Aura | purgatory (Elite apex) | dark [was "Eclipse"] |
| rainbowoutline | Rainbow Outline | nuzlocke (no faints) | [was "Untouchable"] |
| triangles | Triangles | monoSteel | geometric |
| hexagons | Hexagons | monoBug | honeycomb |
| hearts | Hearts | maxFriendship | affection |
| staticfield | Static Field | autoCounter | electric/ability |

Notes:
- Apex auras land on the hardest content: cursedaura=Inferno, shadowaura=Purgatory, underlight=Limbo,
  rainbowoutline=Nuzlocke, plus the 5 new Elemental Apex combos.
- Several mono-types intentionally cover 2-3 effects across layers (a palette + surface + aura) so a
  themed clear lights up a matching set.

## Open questions for you
1. Approve the 5 new combo achievements (Scorched Earth / Absolute Zero / Endless Night / Tempest /
   Worldtree)? Want all 18 elemental types instead of 5?
2. The OPEN lists (46 commons) — happy with that starter set, or pull specific ones into/out of gating?
3. Any effect whose theme you'd reassign (this is the part to redline).
