# M5 public API

## Scope

M5 replaces selected hand-authored battle content with a versioned mechanics IR, deterministic content compiler, complete source catalog, generated `BattleContentPackV2`, and a single production executor. M4 run progression and M3/M4 battle behavior remain compatibility contracts.

Production TypeScript is read-only. Rust content contains no callback, embedded script, dynamic trait object, filesystem, wall clock, network, thread, browser, or renderer dependency.

## Crate ownership

- `er-types`: stable mechanics IDs, source identities, addresses, hook/query enums, and version numbers.
- `er-mechanics`: closed IR DTOs and total validation. No canonical game state and no execution.
- `er-content`: immutable generated `BattleContentPackV2`, classification and bespoke manifests, load/hash validation.
- `er-state`: canonical V3 game/battle/Pokémon/mechanic-instance state and V2-to-V3 migration.
- `er-battle`: deterministic mechanics executor and battle integration.
- `er-run`: battle-visible held-item/run interaction integration and `RunContentPackV2`.
- `er-game`: material V3 production and application, V4 restoration, logical controls.
- `er-kernel`: external input/internal event orchestration only.
- `er-protocol`: typed V3 battle material and V2 run-material envelopes.
- `er-sim`, `er-wasm`, `er-testkit`: drivers and proof only; no semantic command or mechanic injection.
- `er-content-compiler`: deterministic offline compiler CLI; never linked by production runtime crates.

## Stable identities

```rust
pub struct MechanicId(pub SafeU53);
pub struct MechanicsProgramId(pub SafeU53);
pub struct MechanicInstanceId(pub SafeU53);
pub struct SourceOrdinal(pub u32);
pub struct ProgramOrdinal(pub u32);
pub struct HookOrdinal(pub u16);

pub enum MechanicSourceKind {
    Move,
    ActiveAbility,
    PassiveAbility,
    HeldItem,
    MajorStatus,
    VolatileStatus,
    Weather,
    Terrain,
    SideCondition,
    ArenaTag,
    BattlerTag,
    PositionalTag,
    Bespoke,
}

pub struct MechanicSourceId {
    pub kind: MechanicSourceKind,
    pub numeric_id: Option<SafeU53>,
    pub registry_key: Option<String>,
}

pub struct MechanicAddress {
    pub scope: MechanicScope,
    pub source: MechanicSourceId,
    pub source_ordinal: SourceOrdinal,
    pub instance_id: MechanicInstanceId,
}
```

Exactly one of `numeric_id` and `registry_key` is present. Addresses order lexicographically by scope, source kind, numeric/key identity, source ordinal, and instance ID. A canonical address never contains localized text or a TypeScript class name.

## Hooks and queries

`MechanicHook` is a closed enum. It contains battle lifecycle triggers, action/move stages, damage stages, switch/faint stages, turn end, field changes, and run-visible item stages. `MechanicQuery` is a separate closed enum for type, target, priority, speed, accuracy, critical rate, power, offensive/defensive stat, effectiveness, damage, hit count, and status/volatile eligibility.

A `HookBinding` supplies:

```rust
pub struct HookBinding {
    pub hook: MechanicHook,
    pub hook_ordinal: HookOrdinal,
    pub condition_root: Option<ConditionNodeId>,
    pub selector_root: Option<SelectorNodeId>,
    pub operation_range: ProgramRange,
}
```

Query programs return a typed `QueryModifier`; trigger programs emit closed `MechanicOperation` values. A query cannot directly mutate state. A trigger cannot write a query accumulator.

## Closed IR

A `MechanicsProgramV1` contains only IDs, closed enums, exact integers/ratios, bounded node arenas, and operation vectors:

```rust
pub struct MechanicsProgramV1 {
    pub schema_version: u32,
    pub id: MechanicsProgramId,
    pub source: MechanicSourceId,
    pub bindings: Vec<HookBinding>,
    pub conditions: ConditionArena,
    pub selectors: SelectorArena,
    pub values: ValueArena,
    pub operations: Vec<MechanicOperation>,
    pub budget: ProgramBudget,
}
```

The validator rejects unknown versions, duplicate IDs, cycles, unreachable nodes, invalid references, invalid ratios, invalid ranges, incompatible query types, mutation operations on query hooks, query modifiers on trigger hooks, unbounded selection, and budget excess.

## Content catalog and classification

`SourceCatalogV1` is the exact source inventory. Every move, active ability, passive ability, held modifier, status, weather, terrain, arena tag, battler tag, and positional tag receives exactly one `ClassificationV1`:

```rust
pub enum ClassificationV1 {
    Compiled { programs: Vec<MechanicsProgramId> },
    Bespoke { mechanic: BespokeMechanicId },
    Unsupported { reason: UnsupportedReasonCode },
}
```

The compiler rejects duplicate and missing identities. Runtime pack loading rejects `Unsupported` for any reachable active or bench battle content. `BespokeMechanicId` is closed and centrally implemented; arbitrary names do not dispatch code.

## BattleContentPackV2

```rust
pub struct BattleContentPackV2 {
    pub schema_version: u32,
    pub oracle_sha: String,
    pub source_catalog_digest: String,
    pub content_hash: BattleContentPackHashV2,
    pub species: Vec<Option<SpeciesDefinitionV2>>,
    pub moves: Vec<Option<MoveDefinitionV2>>,
    pub abilities: Vec<Option<AbilityDefinitionV2>>,
    pub held_items: Vec<HeldItemDefinitionV2>,
    pub programs: Vec<Option<MechanicsProgramV1>>,
    pub classifications: ClassificationManifestV1,
    pub bespoke: BespokeManifestV1,
    pub type_chart: TypeChart,
}
```

Numeric source IDs index vectors directly where practical. String registry entries are sorted by UTF-8 byte order. Hashing uses canonical JSON and the frozen M5 domain. Runtime never reparses TypeScript or compiles IR.

## Canonical state V3

`GameStateV3`, `BattleStateV3`, and `PokemonStateV3` preserve the M4 ownership rule: the game owns the player party, battle owns enemies, and field slots contain stable Pokémon IDs.

V3 adds ordered held-item state and `MechanicStateStoreV1`. Every mechanic instance records address, program ID, owner/target scope, creation ordinal, optional remaining turns, counters, and a closed typed payload. Instances are sorted by address and unique. No `serde_json::Value` appears in canonical state or material.

## Execution

```rust
pub fn execute_query(
    context: &MechanicsContext<'_>,
    query: MechanicQuery,
    initial: QueryValue,
) -> Result<QueryTransition, MechanicsError>;

pub fn execute_hook(
    context: &MechanicsContext<'_>,
    hook: MechanicHook,
) -> Result<MechanicsTransition, MechanicsError>;
```

Source collection is deterministic and produces explicit ordering evidence. Condition and selector evaluation is read-only. The executor stages mutations, presentations, RNG draws, and instance lifecycle changes. It validates the candidate state before returning. Battle resolution integrates the result into the existing clone-and-swap transaction.

## Materials and replicas

`BattleTurnMaterialV3` and `BattleReplacementMaterialV3` carry V3 after-state, mechanics mutations/evidence, program/content hashes, RNG before/after, presentations, and next control. Authority and replica deserialize and apply the same canonical bytes through the same production applier. The authority cannot adopt the in-memory candidate directly.

## Compatibility and migration

- V1 mechanics and M3 fixtures remain readable only by the frozen compatibility adapters.
- V2 M4 game state migrates explicitly to V3; migration is deterministic and validates both sides.
- Material V1/V2 never masquerades as V3.
- Snapshot/trace V2/V3 never masquerades as V4.
- No alias, fallback, or default program is created for missing content.

## Driver boundary

Representative solo/co-op campaigns continue to accept external inputs only: raw physical input, network frames, timers, presentation/storage results, transport changes, suspend, and resume. They cannot inject `MechanicOperation`, `UiIntent`, semantic commands, material-applied success, or control-projected success.
