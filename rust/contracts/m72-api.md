# M7.2 Instant Agent Laboratory API

## Dependency boundary

`er-lab` is downstream of production and M7.1 developer-plane crates. Core crates may add core-owned fallible constructors, bootstrap state, typed legality DTOs, or observation methods, but may never import `er-lab`.

```text
er-types -> er-state -> er-content/er-run/er-world/er-scenario/er-battle -> er-game -> er-kernel -> er-env/er-sim
                                              |
                                              v
                       M7.1 developer plane -> er-lab -> er-cli/er-agent-protocol
```

No additional M7.2 crate is permitted without a measured platform, security, consumer, or compile boundary.

## Production bootstrap

The production bootstrap logic is core-owned. `er-lab::bootstrap` wraps it for sessions and presets.

```rust
pub struct RunBootstrapMachineV1 {
    pub schema_version: u32,
    pub profile: ProfileStateV1,
    pub seed: String,
    pub stage: RunBootstrapStageV1,
    pub selections: RunBootstrapSelectionsV1,
    pub control: GameControlPlanV2,
    pub menu_instance_high_water: MenuInstanceId,
}

pub enum RunBootstrapStageV1 {
    Title,
    ModeSelect,
    ChallengeSelect,
    StarterSelect,
    Confirmation,
    DifficultySelect,
    SaveSelect,
    WaitingForPartner,
    Complete,
}

pub struct RunBootstrapSelectionsV1 {
    pub mode: Option<GameModeId>,
    pub starters: Vec<StarterSelectionV1>,
    pub choices: BTreeMap<SetupChoiceIdV1, SetupChoiceValueV1>,
    pub difficulty: Option<RunDifficultyV1>,
    pub save_slot: Option<StorageSlotId>,
}
```

Every menu replacement increments `MenuInstanceId`. Bootstrap accepts raw input only. Cancel behavior follows the frozen oracle extraction. Unsupported modes fail closed rather than entering a fake screen.

```rust
pub struct NewRunMaterialV1 {
    pub schema_version: u32,
    pub profile_digest: String,
    pub bootstrap_digest: String,
    pub selections: RunBootstrapSelectionsV1,
    pub rng_audit: Vec<RngDraw>,
    pub initial_state: GameStateV5,
    pub initial_control: GameControlPlanV2,
    pub after_digest: String,
}
```

Authority and replica serialize, deserialize, validate, and apply the same bytes. A duplicate identical material is idempotent; the same identity with different bytes fails closed.

## Session startup

```rust
pub enum SessionStartV1 {
    Natural(NaturalSessionStartV1),
    Scenario(ScenarioSpecificationV1),
    Snapshot(RestorableKernelSnapshotV7<RestorableKernelSnapshotV6>),
    Capsule(ReproCapsuleV1),
    Preset(ScenarioPresetIdV1),
}
```

Natural begins at Title. Scenario and Preset build stable state directly. Snapshot and Capsule are the only mid-transaction entry paths.

## Scenario families

```rust
pub enum ScenarioSpecificationV1 {
    PreRun(PreRunScenarioV1),
    Battle(BattleScenarioV1),
    RunSurface(RunSurfaceScenarioV1),
    Progression(ProgressionScenarioV1),
    Capture(CaptureScenarioV1),
    World(WorldScenarioV1),
    ScenarioNode(ScenarioNodeScenarioV1),
    SoloRecovery(SoloRecoveryScenarioV1),
    PairRecovery(PairRecoveryScenarioV1),
    Terminal(TerminalScenarioV1),
}
```

Specifications are typed families, not one nullable object. Every ID is strongly typed. Every collection is deterministically ordered and bounded.

```rust
pub struct BuiltScenarioV1 {
    pub snapshot: ScenarioSnapshotV1,
    pub provenance: ScenarioReachabilityV1,
    pub content_dependencies: Vec<ContentIdentityV1>,
    pub behavior_dependencies: Vec<GameBehaviorUnitId>,
    pub assumptions: Vec<ScenarioAssumptionV1>,
    pub validation: ScenarioValidationReportV1,
}

pub enum ScenarioReachabilityV1 {
    RecordedNatural { capsule: ReproCapsuleIdV1 },
    CanonicallyGenerated { witness: ConstructorWitnessV1 },
    SyntheticValid { limitations: Vec<String> },
    InvalidNegativeTest { expected_error: String },
}
```

Normal session creation rejects `InvalidNegativeTest`. Release parity claims accept only `RecordedNatural`; focused mechanics accept `RecordedNatural` and `CanonicallyGenerated`. `SyntheticValid` is labeled in every report.

Builders invoke the owning production constructor and complete validators for state, content, control, scheduler, protocol, and snapshot. They never hand-author UI or protocol frontiers. Solo and pair snapshots derive from one specification.

## Presets and artifacts

```rust
pub struct ScenarioPresetManifestV1 {
    pub id: ScenarioPresetIdV1,
    pub schema_version: u32,
    pub content_identity: GameContentIdentity,
    pub specification_digest: String,
    pub reachability: ScenarioReachabilityV1,
    pub expected_control: GameControlKindV2,
    pub behaviors: Vec<GameBehaviorUnitId>,
    pub tags: Vec<String>,
}
```

Preset roots are `rust/scenarios/` and regression roots are `rust/regressions/`. Registry paths are normalized relative paths. Absolute paths, traversal, duplicate canonical IDs, unknown schemas, unknown fields, symlink escape, and identity drift are rejected before allocation or file reads outside the configured root.

## Query protocol

Required methods:

```text
content.search          content.describe
behavior.search         behavior.describe
state.inspect           state.query           state.delta
control.describe        control.explain       control.explain_option
control.plan_navigation
scenario.search         scenario.describe     scenario.validate
lab.health              lab.resources
```

Search is read-only, bounded, stable-sorted, and content-identity pinned. State results are profile-filtered immutable DTOs, never references.

```rust
pub struct ActionLegalityEvidenceV1 {
    pub option: MenuOptionId,
    pub enabled: bool,
    pub reasons: Vec<ActionLegalityReasonV1>,
    pub source_behaviors: Vec<GameBehaviorUnitId>,
}
```

Closed reasons cover stale menu, hidden option, disabled option, no PP, invalid target, actor unavailable, active party slot, fainted party slot, duplicate party occupant, starter cost, starter challenge, full party, insufficient money, unavailable reward, progression precondition, evolution precondition, capture precondition, authority ownership, recovery fence, presentation barrier, and unsupported content. Structured values carry current/required quantities and source identities.

## Navigation

```rust
pub struct NavigationPlanV1 {
    pub menu_instance: MenuInstanceId,
    pub target: MenuOptionId,
    pub events: Vec<RawInputEvent>,
    pub expected_path: Vec<MenuOptionId>,
}
```

The planner performs deterministic breadth-first traversal of explicit edges in `Up, Down, Left, Right` order. Each edge emits physical keydown then keyup. Submit is appended only when explicitly requested. Hidden/disabled/unreachable targets and stale menu instances fail. Planning never executes events.

## Warm daemon

`er-cli agent --protocol jsonl --warm` owns one prepared content cache, preset registry, search index, bounded artifact store, and many isolated sessions. Session IDs and cache keys are deterministic within the daemon. Prepared content is `Arc`-shared; mutable state never aliases between sessions.

Startup modes are NATURAL, SCENARIO, PRESET, SNAPSHOT, and CAPSULE. Content and preset changes invalidate only dependent cache entries. Health/resources report sessions, cached bytes, artifacts, open handles, and pinned content identities. Close is idempotent and clears all owned resources.

## Experiments

```rust
pub struct ExperimentPlanV1 {
    pub scenario: ScenarioSourceV1,
    pub dimensions: Vec<ExperimentDimensionV1>,
    pub driver: ExperimentDriverV1,
    pub faults: Option<FaultPlanV1>,
    pub assertions: Vec<ExperimentAssertionV1>,
    pub coverage: Vec<CoverageTargetV1>,
    pub evidence: EvidenceProfile,
    pub budget: ExperimentBudgetV1,
}
```

Dimensions are seed, species, move, ability, held item, status, weather, terrain, format, seat ownership, network delay/loss, presentation delay, and storage outcome. Cartesian expansion is canonical and checked before allocation. Drivers contain raw inputs/external events only.

Coverage targets are behavior unit, mechanic hook, control kind, menu edge, material kind, scenario node, AI branch, protocol transition, and typed state predicate. The explorer retains coverage-novel traces, exports a capsule at target, and minimizes it under deterministic budgets.

## Fingerprints and counterfactuals

```rust
pub struct FailureFingerprintV1 {
    pub class: FailureClassV1,
    pub first_divergent_path: Option<StatePathV1>,
    pub causal_source: Option<CausalSourceV1>,
    pub terminal_reason: Option<String>,
    pub normalized_panic: Option<String>,
    pub behaviors: Vec<GameBehaviorUnitId>,
    pub content: Vec<ContentIdentityV1>,
}
```

Cluster identity excludes timestamps, seed frequency, adapter identity, backend latency, and build location. Each cluster retains first, smallest, fastest, count, and sorted seeds.

Counterfactual search changes only declared raw input, time, fault/outcome, scenario, or content dimensions. Candidate order is canonical. The result is the smallest exact objective-preserving validated difference.

## Bisect, corpus, and mutations

Bisect executes only allowlisted Git revisions in a hermetic worktree with pinned toolchain and lockfile. Outcomes are GOOD, BAD, or INCOMPATIBLE. Shell fragments from capsules or requests are never executed.

Every regression corpus entry binds a minimized capsule, exact failure oracle, issue/commit reference, fixed outcome, and impact entry. Missing entries require a machine-readable waiver with owner and expiry.

Mutation operators are a closed enum: invert condition, remove operation, numeric sign, selector change, RNG gate removal, query stage change, material-field skip, stale-generation allowance, and fence removal. Impact-selected linked tests/capsules must kill every applied mutation.

## Content iteration

Content diff operates on semantic groups and typed identities. Incremental compilation always assembles and validates a complete candidate pack. Reload prepares the candidate, forks a session, migrates supported schemas, replays the recent tail, checks invariants/control closure, then permits the candidate for new sessions. Existing sessions remain pinned unless explicitly migrated through the same proof. Native code hotpatching is forbidden.

## Semantic reference output

The viewer emits bounded terminal, HTML, and SVG representations of semantic UI, presentation timelines, asset identities, logical bounds, and layers. Output is diagnostic and cannot enter mechanical state or multiplayer identity.
