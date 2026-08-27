# Rust kernel M7 API contract

This file is normative for Milestone 7. It inherits every M0–M6 contract unless `m7-contract.toml` explicitly versions the surface. Production TypeScript remains read-only.

## Causal ownership

The canonical path is entirely Rust:

```text
RawInputEvent
→ GameKernelV6 internal FIFO
→ GameControlPlanV2
→ GameRuntimeV5
→ direct battle/run/scenario resolver
→ canonical MaterialV5
→ common material applier
→ next control
→ typed platform and presentation effects
```

No browser, renderer, CLI, simulator, storage adapter, or transport adapter may decide canonical state, options, RNG, AI, progression, world generation, or outcomes.

One external input is processed to deterministic quiescence. Internal events never cross an adapter boundary. The event budget is finite and exhaustion is an invariant failure carrying a replayable trace.

## Production source ban

The M7 production path must not reference:

```text
project_legacy_state
merge_legacy_state
LegacyResolver
selected_content_pack
BattleStartV1
GameKernel::new_battle
er_state::snapshot::GameState
er_content::pack::ContentPack
```

Historical adapters may exist only under `er-testkit` and may not be imported by a production crate.

## Crate ownership

- `er-progression`: capture, party/storage lifecycle, EXP, moves, abilities, evolution, fusion, forms, and held-item ownership.
- `er-world`: modes, waves, biomes, routes, encounters, trainers, bosses, and difficulty curves.
- `er-scenario`: deterministic scenario graphs, quests, factions, domains, and scripted run events.
- `er-ai`: legal observations and deterministic canonical policies.
- `er-save`: canonical save/profile/replay schemas, validation, checksums, and migration. No platform I/O.
- `er-env`: public headless environment and batch/replay boundary.
- `er-cli`: terminal input/output adapter only.

## Content

```rust
pub struct GameContentBundleV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub battle: Arc<BattleContentPackV3>,
    pub run: Arc<RunContentPackV3>,
    pub progression: Arc<ProgressionContentPackV1>,
    pub world: Arc<WorldContentPackV1>,
    pub scenarios: Arc<ScenarioContentPackV1>,
    pub ai: Arc<AiPolicyPackV1>,
    pub meta: Arc<MetaContentPackV1>,
    pub content_hash: GameContentBundleHash,
}

pub struct PreparedGameContentV1 {
    pub battle: PreparedBattleContentV3,
    pub run: PreparedRunContentV3,
    pub progression: PreparedProgressionContentV1,
    pub world: PreparedWorldContentV1,
    pub scenarios: PreparedScenarioContentV1,
    pub ai: PreparedAiPolicyContentV1,
    pub meta: PreparedMetaContentV1,
}
```

Every nested canonical pack binds the M7 oracle SHA and relevant dependent content hashes. Preparation validates the complete bundle, builds deterministic indexes, and returns an immutable derived value. Prepared content is neither serialized nor authoritative state.

No canonical content contains callbacks, scripts, function pointers, arbitrary JSON, dynamic trait-object mechanics, or nondeterministic map iteration.

## Behavior closure

Every canonical nonvisual behavior has exactly one final status:

```rust
pub enum GameBehaviorStatus {
    Compiled,
    BespokeImplemented,
    SemanticallyInert,
    PlatformEffect,
    PresentationOnly,
}
```

`Unsupported`, `Pending`, `Unknown`, `Skipped`, and `Unvisited` are illegal at G30. Duplicate classifications are illegal. Platform and presentation classifications require explicit source evidence.

## Run IR

```rust
pub struct RunProgramV1 {
    pub id: RunProgramId,
    pub source: GameBehaviorUnitId,
    pub hooks: Vec<RunHookBinding>,
    pub conditions: RunConditionArena,
    pub selectors: RunSelectorArena,
    pub values: RunValueArena,
    pub operations: Vec<RunOperation>,
    pub budget: RunProgramBudget,
}
```

`RunHook` is closed over profile/run start, wave/battle boundaries, capture and party lifecycle, progression, rewards and modifiers, biome/scenario/quest/faction transitions, and run terminals.

`RunOperation` is closed over money, modifiers, progression, Pokémon lifecycle, moves/abilities/forms, inventory and held items, world generation, flags/quests/factions, controls, scenarios, presentation, and terminal state.

There is no generic call, reflection, source-string dispatch, or executable extension value. Every arena index, operation count, recursion depth, scheduled event count, and emitted presentation count is budgeted and validated before execution.

## Scenario graph

```rust
pub struct ScenarioGraphV1 {
    pub id: ScenarioId,
    pub entry: ScenarioNodeId,
    pub nodes: Vec<ScenarioNode>,
}

pub enum ScenarioNode {
    Message(MessageNode),
    Choice(ChoiceNode),
    Conditional(ConditionalNode),
    ApplyProgram(ApplyProgramNode),
    StartBattle(StartBattleNode),
    PartyTarget(PartyTargetNode),
    ItemTarget(ItemTargetNode),
    Complete(CompleteNode),
}
```

Node IDs are stable typed IDs. Every edge targets an existing node. Every nonterminal reachable node has an outgoing edge. Unreachable nodes require an explicit inert classification. Scenario state mutates only through validated run programs and atomic materials.

## Canonical state V5

```rust
pub struct GameStateV5 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentity,
    pub profile: ProfileStateV1,
    pub active_run: Option<RunStateV3>,
}

pub struct ProfileStateV1 {
    pub unlocks: Vec<UnlockId>,
    pub achievements: Vec<AchievementProgress>,
    pub challenges: Vec<ChallengeProgress>,
    pub statistics: ProfileStatistics,
    pub dex: DexState,
}

pub struct RunStateV3 {
    pub run_id: RunId,
    pub seed: String,
    pub mode: GameModeId,
    pub wave: WaveIndex,
    pub run_rng: RunRngState,
    pub party: Vec<PokemonStateV5>,
    pub storage: Vec<PokemonStateV5>,
    pub inventory: InventoryStateV1,
    pub modifiers: Vec<RunModifierInstanceV2>,
    pub money: Money,
    pub world: WorldStateV1,
    pub scenario: Option<ScenarioRuntimeStateV1>,
    pub quests: QuestStateV1,
    pub factions: FactionStateV1,
    pub progression_queue: ProgressionQueueV2,
    pub battle: Option<BattleStateV5>,
    pub control: GameControlPlanV2,
    pub outcome: RunOutcome,
}
```

`PokemonStateV5` contains stable identity and ownership, species/form, level/EXP, IVs, nature, friendship, moves/PP, active plus exactly three passive abilities and suppression, held items, persistent modifiers, fusion/evolution state, Tera type, mechanically relevant shiny/variant data, capture metadata, and mechanically relevant original-trainer data.

Canonical collections are ordered vectors, `BTreeMap`, or validated indexed structures. Mechanical order never depends on hash iteration. Canonical state contains no floats, handles, arbitrary JSON, platform values, or transient presentation objects.

## Validation invariants

Validation occurs before and after every transition, material application, snapshot restore, save load, and migration.

- IDs are valid safe integers and unique in their scope.
- Party/storage/field references are total and nonduplicated.
- Pokémon lifecycle, HP/faint, PP, stages, ownership, fusion, and form invariants hold.
- Inventory counts, stack limits, ownership, money, and modifiers are valid.
- World, mode, wave, route, encounter, trainer, and boss state bind prepared content.
- Scenario node/control state is reachable and internally consistent.
- Progression queues contain only legal, ordered operations.
- Battle and run outcomes agree with parties, world terminals, and controls.
- Content hashes and oracle identity match `PreparedGameContentV1`.

## Direct battle resolver

```rust
pub fn resolve_turn_v5(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedGameContentV1,
    authority: &TurnAuthorityContext,
) -> Result<BattleTransitionV5, GameError>;
```

The resolver directly executes `PreparedBattleContentV3`, Mechanics IR V2, routine programs, bespoke handlers, typed mechanic state, scheduled events, and audited RNG bindings. It does not construct, project, or merge an M3 state.

The input state is immutable. The result contains before/after digests, accepted commands, action order, mutations, presentation plan, RNG audit, next control, and outcome. Unsupported content or an unclassified behavior fails before any RNG draw or mutation.

## Atomic transition and common material applier

Every canonical transition uses clone-and-swap:

```text
clone deterministic state
→ validate intent and content
→ resolve against clone
→ encode canonical material
→ decode and apply through the common applier
→ install control and scheduler state
→ validate complete clone
→ swap live state
→ emit effects
```

Failure discards the clone. State, revision, RNG, scheduler, control, protocol, pending presentation, and external effects remain unchanged.

Authority and replica both deserialize and apply identical canonical bytes through the same production applier. The authority does not adopt an in-memory candidate directly. The replica never resolves or generates options.

`GameMaterialV5` is the only canonical installation envelope. It is closed over battle turns,
battle replacement, run actions, progression, capture, party, world, scenario, and terminal
transitions. Every variant binds schema, oracle/content identity, operation ID, authority
seat/revision, before/after digests, accepted typed action, mutation and RNG evidence, complete
after-state, next control, and ordered presentation plan. `apply_game_material_v5` decodes
canonical bytes and is role-neutral. Solo authority, co-op authority, and replicas use this same
applier.

## AI

```rust
pub struct AiObservation {
    pub state_digest: MechanicalStateDigest,
    pub legal_commands: Vec<BattleCommand>,
    pub public_battle_state: AiBattleView,
}

pub trait DeterministicBattlePolicy {
    fn choose(
        &self,
        observation: &AiObservation,
        rng: &mut AuditedRng,
    ) -> Result<BattleCommand, AiError>;
}
```

Every returned command is a member of `legal_commands`. Policies are bounded and deterministic for the same observation and RNG state. No policy reads rendering, time, DOM, platform state, or unordered collections.

## Controls and raw input

`GameControlPlanV2` covers title/mode, starter choice, battle command/move/target/switch/replacement, capture, full-party resolution, progression and move learning, evolution/fusion, reward/market, scenario/quest/faction, biome/route, save confirmation, and terminal states.

`GameControlPlanV2.menu` is a `GameMenuV2`. Every `GameMenuOptionV2` carries stable renderer
identity/layout plus one closed `GameActionV1`. Renderer/environment projections strip the action
and expose only option identity, enabled/visible state, and navigation. Production code must not
derive actions by parsing `MenuOptionId`.

`GameActionContextV1` binds the operation ID, authority seat/revision, and menu instance. An
actionable control must carry a context matching its menu owner, revision, and instance.

```rust
pub enum GameActionV1 {
    ExecuteRunProgram { program: RunProgramId, hook: RunHook, context: RunExecutionContextV2 },
    Battle { action: BattleUiActionV1 },
    Capture { action: CaptureActionV1 },
    Party { action: PartyActionV1 },
    Progression { action: ProgressionActionV1 },
    MoveLearning { action: MoveLearningActionV1 },
    Evolution { action: EvolutionActionV1 },
    Fusion { action: FusionActionV1 },
    Inventory { action: InventoryActionV1 },
    Reward { action: RewardActionV1 },
    World { action: WorldActionV1 },
    Scenario { action: ScenarioGameActionV1 },
    Save { action: SaveActionV1 },
    Terminal { action: TerminalActionV1 },
}
```

One external input creates a transaction-local `GameInternalEventQueueV1`. FIFO order is
deterministic, the budget is 4,096 events, and the live runtime is swapped only after quiescent
validation. Authority reducers may prepare and apply material. Replica reducers may only prepare
proposals and await authority material.

Every option has stable identity and explicit directional navigation. Held input is bound to a control/menu instance and cannot cross replacement. Representative tests and CLI use physical keydown/keyup only; semantic action injection is unavailable.

## Save and replay

```rust
pub struct GameSaveV1 {
    pub schema_version: u32,
    pub game_content_hash: GameContentBundleHash,
    pub profile: ProfileStateV1,
    pub run: Option<RunStateV3>,
    pub checksum: SaveChecksum,
}
```

Save bytes are canonical and checksummed. Loading validates the complete document before atomic installation. Corruption, unknown schema, content drift, or invalid state cannot partially mutate live state. `er-save` emits typed read/write/delete/list effects; adapters never parse game state.

Replay V6 records every nondeterministic external boundary: raw input, network frames, virtual time, presentation outcomes, storage outcomes, transport changes, suspend, and resume. Replay verifies all mechanical, kernel, run, battle, UI, save, RNG, material, scenario, AI, and resource digests after every event and reports the first divergence.

## Snapshot V6

`RestorableKernelSnapshotV6` captures complete input router, UI/control stack, scheduler, protocol, `GameRuntimeV5`, pending presentations, terminal state, RNG, prepared-content identity, and transaction frontier. Pair snapshots additionally capture virtual clock, queued packet bodies/deadlines, presenter, storage, fault script, and fault RNG.

Restoration accepts only `PreparedGameContentV1` matching the snapshot identity and must reproduce subsequent bytes, effects, and digests exactly.

## Headless environment

```rust
pub struct GameEnvironment {
    kernel: GameKernelV6,
    content: Arc<PreparedGameContentV1>,
}

impl GameEnvironment {
    pub fn new_run(config: NewRunConfig, content: Arc<PreparedGameContentV1>) -> Result<Self, EnvironmentError>;
    pub fn load_save(bytes: &[u8], content: Arc<PreparedGameContentV1>) -> Result<Self, EnvironmentError>;
    pub fn observe(&self) -> GameObservation;
    pub fn legal_actions(&self) -> Vec<LegalAction>;
    pub fn raw_input(&mut self, event: RawInputEvent) -> Result<Vec<GameEffect>, EnvironmentError>;
    pub fn advance_time(&mut self, milliseconds: SafeU53) -> Result<Vec<GameEffect>, EnvironmentError>;
    pub fn snapshot(&self) -> RestorableKernelSnapshotV6;
}
```

`legal_actions` is observational and cannot submit actions. `raw_input` is the representative control path. Batch simulation, CLI, co-op simulation, Wasm, save/replay validation, and tests use this same environment/kernel implementation.

## CLI boundary

`er-cli` exposes `new-run`, `resume`, `replay`, `validate-save`, `simulate`, and `inspect-content`. It renders only `UiViewModel` and semantic presentation cues, translates terminal events to `RawInputEvent`, and delegates file I/O through an adapter. It contains no RNG, AI, state transition, legality, content generation, or outcome logic.

## Error policy

- Wrong seat, stale menu instance, disabled option, or illegal raw input: reject with no mutation.
- Unsupported/unclassified reachable content: initialization failure.
- Invalid pre-state or candidate: invariant failure; discard transaction.
- Material schema/content/checksum mismatch: protocol violation or correlated recovery according to the frozen class.
- Before-digest drift: correlated recovery.
- Save corruption or migration failure: reject before live mutation.
- Presentation failure: canonical state remains; input stays blocked until renderer recovery or shared terminal policy.
- Platform failure: typed failure enters the kernel; adapters cannot choose fallback semantics.
- Event/program/AI budget exhaustion: invariant failure with replayable trace.

## Digests and resources

Mechanical, run, battle, kernel-determinism, pair-determinism, UI, save, presentation-plan, RNG-audit, material, scenario, and AI-choice digests are distinct typed values.

Teardown requires zero timers, proposal/delivery leases, waits, retained entries, controls, pending presentations, command collectors, replacement/progression/scenario queues, save requests, network packets, and recovery fences.
