# CR-0017: persist the canonical wave seed

Status: approved by the integration owner before M3 oracle publication and
before any M3B mechanics branch is based.

## Problem

The frozen `BattleState` carried the process-global run RNG state and the
battle substream's `battle_seed`, turn, and saved state, but it did not carry
the original production `BattleScene.waveSeed`.

That omission makes the supported speed-tie contract impossible to implement
or restore faithfully. Production speed ordering opens an isolated
seed-offset transaction from `waveSeed` with the turn/list-length offset; it
does not use the current run RNG state or `Battle.battleSeed`. The original
value cannot be reconstructed from either persisted RNG value after battle
construction.

## Decision

`BattleState` additionally carries the exact production wave seed:

```rust
pub struct BattleState {
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub wave_seed: String,
    pub turn: TurnIndex,
    // remaining frozen fields unchanged
}
```

The M3 oracle exporter reads this value directly from
`BattleScene.waveSeed`. It must not substitute `seed`, `rngSeedOverride`,
`Battle.battleSeed`, or a locally re-derived value. Every initial, before, and
after canonical battle state carries the field, and the full live-state
fingerprint observes it.

Fresh Rust battle construction therefore carries the same value explicitly at
the game boundary:

```rust
pub struct BattleGameConfig {
    pub run_state: GameState,
    pub wave_seed: String,
    // remaining frozen fields unchanged
}
```

`GameKernel::new_battle` rejects an empty value. Mid-battle restoration reads
the already-canonical `BattleState.wave_seed`; neither path reconstructs it.

M3B action ordering reads `before.battle.wave_seed` when opening the exact
speed-tie seed-offset transaction. The field remains unchanged through a
battle transition. `BattleRngState` remains the battle-cache owner and does
not duplicate the wave seed.

The string is carried losslessly. It is seed data, not an operation ID, so no
new lexical normalization is imposed. The closed `BattleState` schema makes a
missing value fail deserialization; the publication exporter additionally
fails closed when its selected live scenario does not expose a non-empty
string.

## Compatibility and ownership

This is a pre-production M3 schema correction. No M3 oracle fixture or
production Rust battle consumer has been published, so
`battle_state_schema_version = 1` remains unchanged. Previously serialized
incomplete M3 `BattleState` JSON is intentionally rejected.

The integration owner changes the frozen contract, canonical state DTO,
schema vector, freeze assertion, and existing construction tests. M3A-05 owns
the production-oracle observation. M3B-01 consumes the field but does not
redefine or derive it.

## Acceptance evidence

- native and wasm schema round trips include `wave_seed`;
- removing `wave_seed` from a serialized `BattleState` is rejected;
- generated oracle battle states use the exact live `BattleScene.waveSeed`;
- a transient seed-offset override cannot replace the canonical field;
- M3B speed-tie ordering consumes the stored field with the frozen offset;
  and
- the full hosted Rust Kernel Gate is green at the published checkpoint.
