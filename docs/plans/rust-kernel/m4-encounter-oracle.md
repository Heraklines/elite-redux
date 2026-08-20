# M4 Encounter Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

Oracle extraction for production TypeScript at M4_ORACLE_SHA 45c89493e7edec9c4da247a98cd7858b1f015c09. OBSERVED ROUTING: `rollErNextBiomeNodes` builds unweighted/weighted base links first, excludes current plus the two-entry loopback tail and explicit `prev`, excludes biome 0 TOWN and 50 END as travel destinations, then walks `allBiomes` in insertion order and performs one `<50` Bernoulli draw per still-eligible biome until 3 extras succeed. It never shuffles. Empty output falls back to the first non-END/TOWN base link, otherwise biome 1 PLAINS. Base visibility is 2 nodes, plus Map upgrade tier, Cartographer's Lens, and ability reveal callbacks; at least one is visible. Town(0) has base link Plains(1); at run start its complete ordered unexpected-candidate universe is `[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,40,41]`, with at most three successes. Thus the proposed wave-10 Town exit must explicitly select Plains; it is not intrinsically a singleton route. Plains has base onward links Grass(2), Metropolis(4), Lake(9). Single-player reuses the pending graph shown during the biome; >1 revealed nodes open ER_MAP and the selected biome is applied. One revealed node auto-applies. No revealed nodes fall back to random biome only in solo; co-op parks/fails closed. Finale/travel-target precedence is before the graph. Co-op interactive identity is `makeCoopOperationId(epoch, coopInteractionOwnerSeat(pinned), COOP_BIOME_PICK_SEQ_BASE+pinned, "BIOME_PICK")`; owner is chosen by the pinned interaction counter, watcher adopts the committed choice. Deterministic transitions use a distinct host-owned, source-wave-scoped operation and do not advance alternation.

RNG DOMAINS: route rolls have two materially different production domains. Solo/start calls omit `runSeed`, so base weighted-link filters and extra-node tests consume the ambient Phaser seeded stream through `randSeedInt`; SelectBiome resets to the current wave seed before the exit flow, but the initial Town graph is rolled by `newArena` before a battle exists. Authoritative host preparation passes `(globalScene.seed, entryWave)` and uses a local Phaser RandomDataGenerator seeded exactly `${runSeed}:er-biome-routes:${entryWave}:${current}`; the guest rolls nothing and adopts. Biome length is independently addressable when `runSeed` is supplied: local seed `${runSeed}:er-biome-length:${startWave}`, two inclusive integer draws in `[7,25]`, result `max(a,b)`. No snap/rounding. It returns `length:null` if `startWave>=170` or `startWave+24>=170`; otherwise the hard cap ends when `wave-startWave+1>=length`. A Crossroads Leave ends early, while Stay can arm notoriety only after 10 spent waves. Solo SwitchBiome currently rolls routes first on the ambient stream, then length on the local run-seed stream; authoritative preparation makes both addressable.

OBSERVED MUTATION/CAUSAL ORDER: SelectBiome resets the wave RNG unless authoritative guest; finale -> retained authoritative commit -> travel target -> test auto-resolve -> ER pending graph -> random-biome mode -> vanilla links -> random biome is the selection precedence. Terminal authority is established before consuming a travel target and before queuing `SwitchBiomePhase`. Solo/host SwitchBiome records the source in previous/history, clears old map nodes, rolls and stores the destination's onward nodes, reveals visible nodes, rolls destination structure at `sourceWave+1`, captures last trainer/ME, then asynchronously animates and calls `newArena(nextBiome)`; authoritative renderer instead adopts an exact permit/plan and does not roll. `newArena` constructs Arena, resets relic/fight-token state, logs visit, and emits NewArenaEvent. Arena constructor merges `ALL` plus the current time bucket. New-biome Encounter finalization generates enemies and modifiers first; after assets/UI settle it applies ambient weather, then terrain, then Stormglass override/picker, then saves/publishes, then presents. Weather/terrain use weighted `randSeedInt(totalWeight)` with insertion order of enum-valued Maps; carried weather wins, then forced biome weather, then weighted pool. Forced terrain wins over weighted pool.

OBSERVED ENCOUNTER POLICY: `newBattle` resets `waveSeed=shiftCharCodes(runSeed,wave)`, resolves saved/fixed/nonfixed type, format and trainer/ME verdicts, then constructs `Battle` inside isolated offset `(wave<<3)` using `waveSeed`. `Battle.battleSeed` property initialization is 16 successive `randSeedInt(62)` draws over `A-Z,a-z,0-9`, before level construction in that same isolated stream. The outer Phaser state is restored afterward. Per-turn battle RNG seeds with `shiftCharCodes(battleSeed, turn<<6)` on its first draw, persists serialized Phaser state for subsequent draws, and `incrementTurn` clears the cursor; `range<=1` returns `min` without a draw. The authority/host alone generates co-op enemy identity/loadout/items; the renderer clears its local enemy party, validates the host descriptor/manifest, reconstructs it, skips ability/modifier generation, and fails the shared session rather than locally falling back on missing/malformed authority.

Encounter selection draw order for an ordinary wild is: resolve battle type/format on the wave stream; isolated Battle construction produces battle seed then levels; EncounterPhase calls Arena.randomSpecies; boss status is decided in an isolated `(wave<<2)` stream (forced/every-10/biome+notoriety percentage, then random-boss roll only if prior clauses fail); tier draw is ambient (`0..511` nonboss, `0..63` boss, luck lowers ceiling by `2*luck` or `0.5*luck`); empty tiers downgrade numerically; species pick is ambient uniform if every callback-derived weight is 1, otherwise weights are `max(1, round(multiplier*1000))` followed by weighted cumulative selection. Island may draw a 50% regional redraw. Legendary/BST rejection recursively repeats the full species process up to 10 times, then tries one ambient pick from safe COMMON. Level substitution and de-evolution occur before EnemyPokemon construction. Constructor draw order begins active-ability regular slot, hidden-ability check (modifier-adjusted denominator), 32-bit Pokémon ID/IV derivation, gender/form/shiny/variant/nature, then moveset generation and enemy shiny re-rolls; trainer IVs add six inclusive wave-scaled draws. SyncEncounterNature callbacks run after construction. Enemy held-item/modifier generation occurs only after assets load.

LEVEL CURVE: with defaults `waveSlope=2`, `quadDivisor=25`, `bossMult=1.2`, `base=1+w/2+(w/25)^2`. Nonboss returns `max(round(base+abs(randSeedGaussForLevel(10/w))),1)`; the helper performs `ceil(10/w)` `randSeedFloat` draws but divides their sum by the original real `10/w`. Boss returns `floor(base*1.2)` plus `round(realInRange(-1,1)*floor(w/10))` unless final; classic final or every-250 boss rounds upward to a multiple of 25. Hell scaling, Jungle wild bonus, and notoriety overlevel are later callbacks/additions. Wave 11 ordinary Classic base is 6.6936 and, absent later modifiers, produces level 7 or 8 from its one deviation draw.

SELECTED M4 ENCOUNTER POLICY (G12 correction): ordinary species-pool and low-level move/ability candidates from vanilla balance tables are not authoritative because production initialization overwrites movesets and active abilities. The wave-11 parity encounter is therefore supported only as a complete post-initialization oracle-captured vector. The exporter must record species/form/level, all four ability slots and suppression flags, ordered moves/PP, IVs, nature/effective nature, stats/HP/status/stages, ownership, field topology, battle seed/RNG, and scripted commands. No candidate record is executable until that vector is published and capability-validated.

SELECTED COMPLETE FIXED CANDIDATE: the non-ER-replaced Classic final in END biome 50 is Eternatus species 890, level 200, active ability Pressure 46. Normal form moves are Eternabeam 795, Sludge Bomb 188, Flamethrower 53, Cosmic Power 322. E-Max form moves are Dynamax Cannon 744, Cross Poison 440, Flamethrower 53, Recover 105 (constructed with ppUsed=-4). Inverse Battle replaces Flamethrower 53 with Thunderbolt 85. This loadout is literal, consumes no moveset RNG, and the boss uses SMART AI rather than a literal scripted sequence. Elite/Hell replaces this with callback-selected ER Cascoon content and is deliberately deferred. The actual `classicFixedBattles` table is trainer-shell fixed, not party fixed: waves `[5,8,25,35,55,62,64,66,95,112,114,115,145,164,165,182,184,186,188,190,195]`; wave 5 fixes Youngster plus a seeded gender but species/moves/abilities still flow through trainer templates/callbacks, so it cannot be admitted as a complete fixed content candidate without captured output.

SCRIPTED POLICY: TS has no general serializable scripted-enemy cursor matching Rust M3's `ScriptedEnemyPolicyV1`. `EnemyPokemon.getNextMove` first consults a mutable callback-populated move queue; virtual queued moves bypass PP/usability, ordinary queued moves must remain in moveset and usable. The method's local splice removes entries before the selected item but not visibly the selected item, so queue consumption is callback/lifecycle-dependent and is a stop condition rather than a guessed Rust contract. With no queue, a singleton/Encore is deterministic; otherwise wild SMART_RANDOM repeatedly draws `randBattleSeedInt(8)` and advances while `>=5`, trainer/boss SMART repeatedly draws `randBattleSeedInt(100)` against `round(nextScore/currentScore*50)`, and ER AI delegates to score/sharpness policy. Target selection separately draws `randBattleSeedInt(totalWeight)` after benefit-score normalization/cutoff. Move scoring executes move conditions and simulated damage/ability logic, so it is not a supported M4 scripted policy. Proposed M4 should support only an oracle-captured literal enemy command/target sequence; do not reimplement SMART/ER AI from these files.

DEFERRED/UNSUPPORTED CALLBACK CONTENT SEAMS (explicit): routing reveal count from held Map modifiers, Cartographer's Lens and `BiomeRevealMarker`; event-added/revealed routes; UI `onSelect`; weighted legacy links; co-op owner/watcher callbacks and recovery; timed-event weather tables; carried-weather/Stormglass picker; forced biome rules; PostBiomeChange ability callbacks; challenge heal replacement; LLM Director/dev enemy overrides; Showdown manifests; network ghost teams; extra-rival/gauntlet policy; daily battle/trainer/ME/boss callbacks; Mystery Encounter presence pity and every `getMysteryEncounter`, `onInit`, requirements/options/loadAssets` callback; trainer `getTrainer`, party template, species filter and `genPartyMember` callbacks; player ability encounter-weight multipliers; daily forced tier/species; level-based evolution/de-evolution and ER BST/custom-species gates; HiddenAbilityRateBooster, form/gender/shiny/nature generation; procedural moveset signature/STAB/TM/egg/superseded/filter/tera callbacks; SyncEncounterNature; enemy modifier pools/held-item overrides; golden bug net; Cascoon final replacement; scripted move queues and dynamic AI conditions. Desert `skipChance`/`skipFallback` are data-only and have no production consumers outside `er-biome-encounters.ts`, so empty-wave semantics are unsupported/unobserved, not an oracle contract.

FAILURES/GAPS: exact solo route extras require the concrete ambient Phaser state; exact authoritative extras require run seed+entry wave. Exact wave-11 time bucket also needs `waveCycleOffset` (one run-seed draw yielding multiples of 5), so Meowth 52 cannot be promised in the proposed Town->Plains segment without captured seed/state. Exact ordinary species, ability, moveset order, IV/nature/items and AI command cannot be stated from content alone. Arena pool exhaustion downgrades tiers, then falls back to global species if the resulting pool is empty; after ten incompatible draws it picks a safe COMMON if one exists, otherwise retains the last species. Malformed authoritative encounter descriptors throw; guest adoption/recovery exhaustion fails the shared session. Solo/legacy asset/UI rejection resets the local run; authoritative rejection fails closed. Fixed trainer callback exceptions propagate out of `newBattle`. These are explicit stop conditions for fixture authoring.

## Source evidence

### `src/data/elite-redux/er-biome-routing.ts`

Lines 29-350: activation gate, route history/loopback state, pending/reveal mutation, base-link filtering, local-vs-ambient RNG domain, extra cap/chance, fallback and visibility.

### `src/init/init-biomes.ts`

Lines 39-82: canonical `allBiomes` insertion order used directly by unexpected-node iteration.

### `src/phases/select-biome-phase.ts`

Lines 266-495, 501-577, 1081-1083, 1520-1665: routing precedence, pending graph reuse, solo/co-op choice ownership, deterministic fallback, operation boundary and transition mutation order/fail-closed behavior.

### `src/phases/switch-biome-phase.ts`

Lines 83-252, 339-373: previous-biome/history mutation, route/structure preparation, solo ambient routing versus co-op locally addressed routing, arena switch ordering.

### `src/data/elite-redux/er-biome-structure.ts`

Lines 40-183, 255-288: exact 7..25 two-draw max length algorithm, seed label, finale clamp, start/length mutation and biome-end/Crossroads rules.

### `src/battle-scene.ts`

Lines 1640-1760, 1820-2070, 2469-2520, 2820-2888, 2932-2952, 3222-3231, 4848-4918: battle creation/type/fixed precedence, seed reset/offset isolation, arena creation, boss RNG, wild pool entry and ME pity domain.

### `src/battle.ts`

Lines 85-97, 129-193, 240-278, 610-633: battle seed state, enemy level construction and later bonuses, exact level rounding/draw formula, per-turn battle RNG cursor.

### `src/field/arena.ts`

Lines 202-289, 359-425, 560-598, 700-778, 794-930, 1272-1295: initialization, weather/terrain weighted picks, time-bucket merge, rarity thresholds, species draw/retry/substitution and wave-cycle time policy.

### `src/phases/encounter-phase.ts`

Lines 929-1438, 1535-1615, 2073-2111: authoritative boundary, enemy generation and post-construction callbacks, modifier/loadout order, biome weather/terrain order, co-op authority ownership and failure behavior.

### `src/field/pokemon.ts`

Lines 468-575, 798-812, 2704-2737, 8923-9055, 9116-9183, 9500-9750: active ability draws/fallback, enemy constructor/loadout draw order, literal Eternatus kits, scripted queue precedence and SMART/SMART_RANDOM move/target RNG.

### `src/ai/ai-moveset-gen.ts`

Lines 1086-1173 plus RNG sites 531-662/1044-1050: procedural loadout pipeline and callback/RNG seams that prevent static ordinary/trainer move ordering.

### `src/data/elite-redux/er-biome-encounters.ts`

Lines 38-146: per-biome trainer/event/boss composition, Wasteland bars, and unwired Desert skip data.

### `src/game-mode.ts`

Lines 238-345: trainer eligibility, anti-clustering offset rolls, forced cadence/notoriety and rounded biome multiplier divisor.

### `src/data/balance/biomes/town.ts`

Lines 184-213: Town trainer chance 0 and sole static base link Plains(1).

### `src/data/balance/biomes/plains.ts`

Lines 9-119: complete time-partitioned encounter pools, Plains links `[2,4,9]`, trainer chance 6; Meowth(52) Dusk/Night COMMON evidence.

### `src/data/balance/biomes/grass.ts`

Lines 9-108: Bulbasaur(1) RARE/ALL and Grass(2) static biome content.

### `src/data/balance/biomes/metropolis.ts`

Lines 9-115: Rattata(19) COMMON/ALL and Metropolis(4) static biome content.

### `src/data/balance/biomes/forest.ts`

Lines 49-65: Ekans(23) UNCOMMON/ALL.

### `src/data/balance/biomes/lake.ts`

Lines 9-123: Squirtle(7) RARE/ALL and Lake(9) static biome content.

### `src/data/balance/biomes/badlands.ts`

Lines 9-25: Diglett(50) COMMON/ALL.

### `src/data/balance/pokemon-species.ts`

Lines 13, 28, 52-60, 94-98, 1515-1517: selected species' exact active/hidden ability symbols and Eternatus forms.

### `src/data/balance/pokemon-level-moves.ts`

Lines 13-28, 111-128, 277-292, 342-358, 840-855, 874-890: exact low-level wild learn candidates for all six selected species.

### `src/data/trainers/fixed-battle-configs.ts`

Lines 24-55 and following table: fixed wave trainer construction is callback-driven; wave 5 only fixes Youngster/gender, not party loadout.

### `src/enums/fixed-boss-waves.ts`

Lines 1-22: concrete Classic fixed trainer wave numbers.

### `src/enums/biome-id.ts`

Lines 1-38: numeric biome IDs.

### `src/enums/biome-pool-tier.ts`

Lines 1-11: numeric encounter tier IDs.

### `src/enums/time-of-day.ts`

Lines 1-7: numeric time bucket IDs.

### `src/utils/common.ts`

Lines 20-29: battle seed character alphabet and one seeded draw per character.

### `src/utils/random.ts`

Lines 60-75: cumulative weighted-pick draw/order/failsafe.

### `src/data/elite-redux/coop/coop-biome-operation.ts`

`coopBiomeOperationId`, deterministic operation identity, owner commit/watcher adopt and retained receipt symbols: co-op route operation identity/ownership.

## Architecture and contract guidance

Recommended split for the two M4 oracle documents. `m4-biome-routing-oracle.md`: freeze BiomeId registry and insertion order; model RouteContext(current, explicit prev, two-entry recent tail, pending/event reveals, reveal sources); distinguish SoloAmbientRouteRng from AuthorityAddressedRouteRng; record ordered base then extras; specify selection precedence and co-op operation identity/owner; specify SwitchBiome/NewArena mutation sequence; separately specify addressed two-draw biome structure. Use Town(0)->explicit Plains(1) as the integration candidate and list the full Town extra universe rather than pretending it is a singleton. `m4-encounter-oracle.md`: freeze encounter verdict, time-bucket pool, rarity and species draws, level rounding, construction/loadout phases, battle seed substream, host-generation/guest-adoption ownership, and failure terminals. Admit the six static species/biome candidates above as content vocabulary, with exact low-level move/ability candidates, but require captured TS output to choose a concrete ordinary encounter. Admit END(50)/Eternatus(890) as the one complete literal fixed loadout. Represent scripted enemy behavior only as an oracle-provided literal command/target sequence; mark mutable TS queues and SMART/ER AI unsupported. Keep every callback seam listed above outside the Rust-supported M4 contract until separately extracted; especially do not implement Desert skips, fixed trainer parties, Mystery Encounters, ER Cascoon, procedural loadouts or dynamic AI from inference.
