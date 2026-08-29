# M4 progression contract

## Selected slice

M4 implements only the growth, nature, species, and move-learning entries named by `rust/fixtures/m4/m4-slice-manifest.json`. Unsupported IDs fail during run initialization or progression preflight. No unknown value is normalized to the selected value.

The composed parity progression baseline is Nacli (`SpeciesId(932)`), Medium Slow (`GrowthRateId(3)`), level 16→17 under explicitly captured test-only `LEVEL_CAP_OVERRIDE=17`. Nacli's post-initialization level-17 list contains only Body Slam (`MoveId(34)`) and its evolution threshold is 23. The composed initial battle loadout is `[1,52,77,78]`; raw input replaces slot 0, producing `[34,52,77,78]`. The exact EXP, six-entry IV array, nature, stats, owner, and initial-loadout provenance are exporter-owned state. The override and loadout are fixture inputs, not a natural Classic wave-9 claim.

## Canonical state

```rust
pub struct PokemonProgressionState {
    pub experience: Experience,
    pub growth_rate: GrowthRateId,
    pub ivs: [Iv; 6],
    pub nature: NatureId,
    pub effective_nature: NatureId,
    pub friendship: u16,
    pub permanent_bonuses: PermanentStatBonuses,
    pub pause_evolutions: bool,
}
```

Level and battle stats are canonical observed values. Derived recomputation is an explicit typed transition, never a deserialization default.

## Wave settlement order

For one defeated enemy, authority settlement is:

1. validate the exact source battle and one unresolved wave boundary;
2. freeze ordered defeated-enemy records and the final participation set;
3. compute base EXP from immutable species/growth/content inputs;
4. derive each recipient and multiplier in stable player-party order;
5. apply each supported multiplier with the oracle-frozen JavaScript `Number` operation and floor point;
6. append EXP mutations and level changes;
7. discover every level-up move across `(oldLevel, newLevel]` in oracle order;
8. discover evolution candidates without executing them;
9. preflight the complete progression queue;
10. abort the complete transaction if any candidate evolution or callback-driven content is reachable;
11. commit the queue and exact next control through authority material.

Participation is added at the frozen battle boundary, fainted participants are removed according to oracle behavior, and duplicate participant IDs are impossible. EXP recipients and owner seats are explicit evidence.

## Numeric rules

JavaScript arithmetic order is preserved exactly. `f64` is allowed only for transient operations where the oracle uses `Number`. No algebraic simplification, saturating fallback, `mul_add`, or fast-math is allowed. Integer conversion occurs only at the frozen floor/truncation point.

Experience, level, HP, stats, money, and counters are checked for their declared ranges before committing. Overflow, NaN, Infinity, invalid IV length/range, unsupported growth, or unsupported nature is a typed failure.

## Progression queue

```rust
pub enum ProgressionTask {
    GainExperience(GainExperienceTask),
    LevelChanged(LevelChangedTask),
    LearnMove(LearnMoveTask),
    UnsupportedEvolution(UnsupportedEvolutionTask),
}
```

Tasks have stable IDs, owner seats, source-wave identities, and ordered prerequisites. Queue order is canonical. Completing or rejecting a task advances through one atomic material transition.

M4 move learning uses the oracle batch surface for the selected parity segment. A free slot does not bypass the surface when that captured batch requires an action. Replacement, decline, undo, and completion use raw input and stable option IDs. The owner is `PokemonState.owner_seat`; a watcher is never actionable.

An evolution candidate causes the whole preflight to fail before EXP, level, stats, RNG, control, or presentation becomes visible. Evolution execution is deferred; it is not converted to a no-op.

## Migration

`M3ToM4MigrationContext` supplies exact, observed progression companions for every Pokémon in each typed V1 fixture. Migration:

- consumes zero RNG draws;
- preserves stable Pokémon identity and explicit stable roster order;
- never infers EXP, IVs, nature, growth, owner, friendship, or permanent bonuses;
- recomputes nothing;
- validates the complete V2 graph before returning;
- leaves all published M3 bytes unchanged.

Missing or contradictory companion data is a migration error.