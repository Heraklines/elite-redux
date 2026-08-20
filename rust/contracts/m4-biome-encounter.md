# M4 biome, routing, and encounter contract

## Selected topology

The initial supported run segment is frozen by `m4-slice-manifest.json`. It begins from an oracle-exported canonical wave-9 state in Town (`BiomeId(0)`), completes waves 9 and 10, resolves the wave-10 Crossroads and regular/biome surfaces in their captured order, selects Plains (`BiomeId(1)`) from captured authority-generated options, and opens the wave-11 battle.

This is an oracle-composed fixture: each state and vector is captured from the pinned oracle, while the complete sequence is composed to cover the M4 vertical slice. It is not represented as a naturally discovered seed unless a later fresh-process export proves one.

## Biome structure

```rust
pub struct BiomeStructureState {
    pub current_start_wave: WaveIndex,
    pub current_length: Option<u16>,
    pub leave_biome_now: bool,
    pub overstay_anchor_wave: Option<WaveIndex>,
}
```

For the selected Classic, non-Daily, non-random-biome mode, a new structure starting before wave 146 draws two inclusive `[7,25]` values from the addressed seed `${runSeed}:er-biome-length:${startWave}` and stores their maximum. Starts at or after 146 draw nothing. The exact caller ordering, fixed-next-wave deferral, and Crossroads cadence are those in the oracle document.

Crossroads offers stable `Stay` and `MoveOn` identities. `Stay` updates the overstay anchor exactly once according to the captured rule. `MoveOn` sets the leave transition and chains to route selection under the same pinned interaction owner and sequence.

Dynamic notoriety, relic, challenge, warning, forced-biome, event, and carried-weather callbacks are unsupported.

## Route generation

Authority-generated route options are complete material. The pure generator distinguishes:

- ambient route RNG, used only when the exact starting RNG state is supplied;
- addressed route RNG, seeded by `${runSeed}:er-biome-routes:${entryWave}:${currentBiome}`.

It appends base links first, then eligible extras in the frozen biome-registry insertion order, stopping after three successful extras. It excludes current, previous, two-entry recent tail, Town, and End exactly as documented. It never shuffles. Weighted links and modifier-revealed routes are outside the selected slice.

M4 authority may generate only selected static links and captured options. Replicas never reroll. Selection validates both route-node ID and `BiomeId`, then applies the captured biome-state transition atomically.

## Encounter plan

```rust
pub struct EncounterPlan {
    pub schema_version: u32,
    pub encounter_id: EncounterId,
    pub run_id: GameRunId,
    pub wave: WaveIndex,
    pub biome: BiomeId,
    pub format: BattleFormat,
    pub enemy_party: Vec<PokemonState>,
    pub enemy_leads: Vec<PokemonId>,
    pub player_leads: Vec<PokemonId>,
    pub scripted_policy: ScriptedEnemyPolicyV1,
    pub battle_seed: String,
    pub generation_audit: Vec<RunRngDraw>,
    pub source: EncounterPlanSource,
}
```

`BattleStartV2` consumes the game-owned player party by stable IDs and the encounter-owned enemy party from this plan. It cannot accept a copied player party.

The parity fixture uses an exact captured wave-11 encounter vector, including species, form, level, ability loadout, moves and PP, IVs, nature, stats, HP, ownership, battle seed, field topology, and scripted commands. No field may be reconstructed from content when the oracle vector recorded it.

Ordinary callback-driven species pools, ability/moveset generation, trainer constructors, SMART/RANDOM AI, queue callbacks, Mystery encounters, timed weather, form/fusion logic, and browser-owned objects are unsupported. A captured static encounter vector is not permission to claim general encounter generation coverage.

## Run loop and terminal

Battle completion settles through `WAVE_ADVANCE` exactly once. The next stage is progression, surface, biome transition, next battle, or terminal. No source battle can settle twice, no next battle can start before settlement commits, and `Complete` always implies no active battle or surface.

The deterministic 200-wave test uses only a separately declared supported content pack and scripted policies. It is proof of continuous lifecycle/teardown, not broad TypeScript content parity.