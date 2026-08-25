# M6 public API

## Scope

M6 compiles or implements every battle-affecting source identity and behavior unit frozen by `m6-contract.toml`. M5 architecture remains: immutable typed content, closed mechanics programs, canonical state, deterministic execution, identical host/replica material application, raw-key control, native/Wasm parity, and atomic restoration. Production TypeScript remains read-only.

M6 does not port renderer behavior or allow TypeScript callbacks to execute in production Rust.

## Ownership

- `er-types`: stable source, behavior-unit, RNG-site, topology, and mechanic-instance IDs; versions.
- `er-mechanics`: Mechanics IR V2 DTOs and total validation only.
- `er-content`: raw/semantic DTOs, compiler output, `BattleContentPackV3`, prepared indexes, classification closure.
- `er-state`: `GameStateV4`, complete battle mechanic state, and V3-to-V4 migration.
- `er-battle`: prepared/direct V2 executor, bespoke mechanics, and battle integration.
- `er-game`: material V4 production/application and logical controls.
- `er-kernel`: snapshot/trace V5 and external-input orchestration.
- `er-content-compiler`: deterministic offline semantic compiler.
- `er-testkit`, `er-sim`, `er-wasm`: proof and drivers; no semantic injection.

## Stable identities

```rust
pub struct BehaviorUnitOrdinal(pub u32);
pub struct RngSiteOrdinal(pub u32);

pub enum BehaviorSourceId {
    Move { numeric_id: SafeU53 },
    ActiveAbility { numeric_id: SafeU53 },
    PassiveAbility { numeric_id: SafeU53 },
    HeldItem { registry_key: String },
    // closed numeric/registry variants for every source class, including
    // Species and Form
}

pub struct BehaviorUnitId {
    pub source: BehaviorSourceId,
    pub unit_kind: BehaviorUnitKind,
    pub ordinal: BehaviorUnitOrdinal,
    pub provenance_hash: ProvenanceHash,
}

pub struct RngSiteId {
    pub ordinal: RngSiteOrdinal,
    pub provenance_hash: ProvenanceHash,
}
```

`BehaviorSourceId` fixes numeric versus registry-key representation per source class; alternate payload shapes fail deserialization. `BehaviorUnitKind`, RNG domain/reason, and provenance hash are closed typed values. Provenance hashes validate at deserialization and identify evidence; they never dispatch code. Every source identity owns at least one behavior unit. Every behavior unit has exactly one classification.

## Semantic catalog

`RawSourceCatalogV2` contains the immutable source inventory and constructor/callsite provenance. `SemanticCatalogV1` adds ordered typed behavior units, implementation-class evidence, trigger/query/target contracts, species/forms, and RNG-site classifications.

Static resolutions mean:

- `RESOLVED_INTRINSIC`: identity and intrinsic definition are closed;
- `RESOLVED_OPERANDS`: hook, effect, condition, implementation class, and operands fit the closed descriptor vocabulary;
- `BESPOKE_GAP`: callback, unresolved hook/effect, unattached callsite, fixed dispatch, or opaque lifecycle remains.

At the M6B schema-upgrade checkpoint, `RESOLVED_OPERANDS` contains exactly 95 behavior units from the explicitly audited routine classes in the semantic exporter. Every other attribute remains `BESPOKE_GAP`; class-name recognition alone still grants no compiler support.

None of these values means production support. Support is granted only by the compiled/bespoke classification plus witnesses.

## Mechanics IR V2

```rust
pub struct MechanicsProgramV2 {
    pub schema_version: u32,
    pub id: MechanicsProgramId,
    pub source: BehaviorSourceId,
    pub behavior_units: Vec<BehaviorUnitId>,
    pub bindings: Vec<HookBindingV2>,
    pub conditions: ConditionArenaV2,
    pub selectors: SelectorArenaV2,
    pub values: ValueArenaV2,
    pub operations: Vec<MechanicOperationV2>,
    pub scheduled_events: Vec<ScheduledEventSpecV1>,
    pub rng_sites: Vec<RngSiteBindingV1>,
    pub budget: ProgramBudgetV2,
}
```

V2 adds behavior-unit ownership, exact source ordering, slot-aware ability conditions, held-item lifecycle values, topology selectors, scheduled events, and explicit RNG-site bindings. Queries remain read-only. Triggers stage closed operations. Programs contain no callback, function name, arbitrary script, untyped JSON, platform handle, or dynamic trait object.

## BattleContentPackV3

```rust
pub struct BattleContentPackV3 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub raw_catalog_hash: CatalogHash,
    pub semantic_catalog_hash: CatalogHash,
    pub content_hash: BattleContentPackHashV3,
    pub species: Vec<Option<SpeciesDefinitionV3>>,
    pub forms: Vec<FormDefinitionV1>,
    pub moves: Vec<Option<MoveDefinitionV3>>,
    pub abilities: Vec<Option<AbilityDefinitionV3>>,
    pub held_items: Vec<HeldItemDefinitionV3>,
    pub field_content: FieldContentV1,
    pub programs: Vec<Option<MechanicsProgramV2>>,
    pub classifications: BehaviorClassificationManifestV2,
    pub bespoke: BespokeManifestV2,
    pub rng_sites: Vec<RngSiteDefinitionV1>,
    pub type_chart: TypeChart,
}
```

`PreparedBattleContentV3` validates and indexes the pack once. Runtime execution receives prepared content; it never recompiles, reparses TypeScript, or linearly scans the full catalog per hook. Indexed vectors and stable sorted slices are preferred over maps. Hash-map iteration is never canonical.

Pack load fails if any identity or behavior unit is missing, duplicated, out of order, unclassified, mapped to an absent program/bespoke implementation, or references an unknown RNG site. Reachable `Unsupported` content fails battle initialization.

## Canonical state V4

`GameStateV4`, `BattleStateV4`, and `PokemonStateV4` retain stable Pokémon IDs and topology slots. V4 adds closed state required by the complete semantic catalog:

- four-slot active/passive ability source state and suppression;
- ordered held-item instances, stack, consume, transfer, and berry ledger state;
- major status counters and volatile/tag instances;
- weather, terrain, side, arena, and positional instances;
- substitute/proxy HP;
- charge/recharge/action locks;
- delayed scheduled effects;
- protect/endure/guard chains;
- pivot/trap/redirect state;
- transform, illusion, form, stance, Mega, and Tera overlays;
- copied/called move state and special-damage counters;
- exact source/behavior-unit ownership and creation ordinals.

Mechanic state is typed. No `serde_json::Value`, callback text, or TypeScript class name appears in canonical state or material.

## Execution APIs

```rust
pub fn prepare_content(pack: BattleContentPackV3) -> Result<PreparedBattleContentV3, ContentError>;

pub fn execute_query_v2(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    query: MechanicQueryV2,
    initial: QueryValueV2,
) -> Result<QueryTransitionV2, MechanicsErrorV2>;

pub fn execute_hook_v2(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    hook: MechanicHookV2,
) -> Result<MechanicsTransitionV2, MechanicsErrorV2>;
```

A temporary direct executor may exist only as a parity reference. G23 requires prepared and direct output equality. Production uses prepared content.

## Materials and replicas

Battle turn and replacement material contract V4 carries GameStateV4/BattleStateV4 evidence, content and semantic hashes, behavior-unit evidence, ordered mechanic transitions, scheduled events, RNG sites/draws, presentations, and next control. Authority and replica deserialize and apply identical canonical bytes through one production applier. The authority cannot adopt an in-memory candidate directly.

## Compatibility and migration

- `GameStateV3` migrates explicitly to V4; both sides validate.
- `BattleContentPackV2` is an input to migration/witness compatibility only; production execution uses V3.
- Material V3 never masquerades as V4.
- Snapshot/trace V4 never masquerades as V5.
- Unknown state or behavior cannot default to empty, `NONE`, false, zero, or ignored.

## Driver boundary

Representative campaigns accept only external raw input, network frames, timers, presentation/storage outcomes, transport changes, suspend, and resume. They cannot inject semantic commands, targets, mechanic operations, authority material success, control projection success, or mutable state handles.
