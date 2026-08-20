# M4 frozen public API

## Provenance and authority

- M3 base: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Version lock: `m4-contract.toml`
- Error policy: `m4-error-policy.md`
- Material contract: `m4-run-material.md`

The M3 API remains exact unless this document explicitly replaces a symbol. No public signature, serialization tag, operation grammar, digest domain, content ID, or failure class may change after G12 without an integration-owner contract revision and a new exact-SHA hosted bootstrap attestation.

## Versioning

`GameState`, `BattleState`, and `PokemonState` each serialize and validate `schema_version = 2`. `RunState`, every run surface root, `ProgressionQueue`, `ProgressionTaskEnvelope`, and `GameControlPlan` serialize their versions from `m4-contract.toml`. Mixed nested versions fail before state validation. M3 V1 values are accepted only by the offline typed migration API.

All inherited M3 proposal, RNG, menu, turn-coordinate, battle-content, manifest, and presentation versions remain the values in `m3-contract.toml` unless `m4-contract.toml` overrides them.

## Strong IDs and values

The following are opaque validated newtypes, not aliases to primitives:

```rust
GameRunId(SafeU53); RunInteractionSequence(SafeU53); RunTaskId(SafeU53);
RunSurfaceId(SafeU53); RunOfferId(SafeU53); RunStockId(SafeU53);
RouteNodeId(SafeU53); EncounterId(SafeU53); ModifierId(SafeU53);
GrowthRateId(u8); NatureId(u8); Experience(SafeU53); Money(SafeU53);
RunContentPackHash(String); SurfaceDigest(String);
```

Existing `er_types::ids::RunId` remains the opaque string protocol-context identity used by M2/M3 Authority V2 and is unchanged. `GameRunId` is the numeric canonical M4 game-state identity. They are distinct domains and never alias or convert implicitly.

Existing `BattleId`, `PokemonId`, `MoveId`, `AbilityId`, `PartyIndex`, `WaveIndex`, `TurnIndex`, `SeatId`, `ControlId`, `MenuInstanceId`, and `OperationId` remain the exact M3 types.

## Canonical state

```rust
pub struct GameState {
    pub schema_version: u32,
    pub battle_content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub mode: GameModeId,
    pub run: RunState,
    pub player_party: Vec<PokemonState>,
    pub battle: Option<BattleState>,
}

pub struct PokemonState {
    pub schema_version: u32,
    pub id: PokemonId,
    pub owner_seat: Option<SeatId>,
    pub species_id: SpeciesId,
    pub form_index: u16,
    pub level: u16,
    pub types: PokemonTyping,
    pub stats: BattleStats,
    pub hp: u32,
    pub max_hp: u32,
    pub status: StatusState,
    pub stat_stages: StatStages,
    pub moves: [Option<MoveSlotState>; MOVE_SLOT_COUNT],
    pub abilities: AbilityLoadout,
    pub fainted: bool,
    pub progression: PokemonProgressionState,
}

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

pub struct BattleState {
    pub schema_version: u32,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub wave_seed: String,
    pub turn: TurnIndex,
    pub format: BattleFormat,
    pub authority_seat: SeatId,
    pub enemy_party: Vec<PokemonState>,
    pub field: FieldState,
    pub weather: WeatherState,
    pub terrain: TerrainState,
    pub arena_conditions: Vec<ArenaConditionState>,
    pub global_ability_suppression: GlobalAbilitySuppressionState,
    pub battle_rng: BattleRngState,
    pub command_state: CommandCollectionState,
    pub participation: BattleParticipationState,
    pub settlement: BattleSettlementState,
    pub faint_queue: Vec<FaintOccurrence>,
    pub next_faint_occurrence: FaintOccurrenceId,
    pub outcome: BattleOutcome,
}

pub struct BattleParticipationState {
    pub player_participants: Vec<PokemonId>,
    pub defeated_enemies: Vec<DefeatedEnemyRecord>,
}

pub struct BattleSettlementState {
    pub source_battle_id: BattleId,
    pub settled: bool,
    pub scattered_money: Money,
    pub wave_reward_evidence: Vec<WaveRewardEvidence>,
}
```

`GameState.player_party` is the only player-party owner. `BattleState` owns only encounter enemies. `FieldState` player slots resolve into the game-owned vector; enemy slots resolve into the battle-owned vector. `PartyIndex` addresses the stable player roster vector in M4. Party reorder, release, transfer, and compaction are deferred. No equality shim or second copy is permitted.

```rust
pub struct RunState {
    pub schema_version: u32,
    pub run_id: GameRunId,
    pub seed: String,
    pub wave: WaveIndex,
    pub next_battle_id: BattleId,
    pub run_rng: RunRngState,
    pub stage: RunStage,
    pub outcome: RunOutcome,
    pub money: Money,
    pub modifiers: Vec<RunModifierInstance>,
    pub progression: ProgressionQueue,
    pub active_surface: Option<RunSurfaceState>,
    pub biome: BiomeRuntimeState,
    pub counters: RunCounters,
}

pub enum RunStage { Battle, AwaitingWaveAdvance, Progression, Surface, Complete }
pub enum RunOutcome { InProgress, Victory, Defeat }

pub struct ProgressionQueue {
    pub schema_version: u32,
    pub tasks: Vec<ProgressionTaskEnvelope>,
    pub active_index: Option<u32>,
    pub next_task_id: RunTaskId,
}

pub struct ProgressionTaskEnvelope {
    pub schema_version: u32,
    pub task_id: RunTaskId,
    pub owner_seat: SeatId,
    pub source_battle_id: BattleId,
    pub task: ProgressionTask,
}

pub enum ProgressionTask {
    GainExperience(GainExperienceTask),
    LevelChanged(LevelChangedTask),
    LearnMove(LearnMoveTask),
    UnsupportedEvolution(UnsupportedEvolutionTask),
}

pub struct RunCounters {
    pub interaction: RunInteractionSequence,
    pub pending_remote_interaction: Option<RunInteractionSequence>,
    pub next_surface_id: RunSurfaceId,
    pub per_stream_action_ordinals: Vec<SurfaceActionOrdinal>,
}
```

## Stage invariants and transitions

| Stage | Required | Forbidden | Successors |
|---|---|---|---|
| `Battle` | `battle=Some`, no surface, empty progression | settled battle | `AwaitingWaveAdvance`, `Complete` |
| `AwaitingWaveAdvance` | terminal source battle with `settlement.settled=true` | active surface or progression | `Progression`, `Surface`, `Battle`, `Complete` |
| `Progression` | no battle/surface, nonempty queue | unsupported active task | `Progression`, `Surface`, `Battle`, `Complete` |
| `Surface` | exactly one active surface, no battle | empty closed surface | `Surface`, `Progression`, `Battle`, `Complete` |
| `Complete` | terminal outcome, no battle/surface/progression | actionable control | none |

Every transition validates the complete before state and complete candidate after state. It never repairs a contradictory stage.

## Battle world API

```rust
pub struct BattleWorldState<'a> {
    pub player_party: &'a [PokemonState],
    pub battle: &'a BattleState,
}

pub struct ResolvedBattleWorld {
    pub player_party: Vec<PokemonState>,
    pub battle: BattleState,
}
```

All stateful battle APIs stage the complete game-owned player party plus battle. M3 callback escape hatches for finalization and defensive gates are removed from the V2 authoritative path and replaced by closed typed evidence.

## Immutable run content

```rust
pub struct GameContentBundle {
    pub battle: Arc<ContentPack>,
    pub run: Arc<RunContentPack>,
}

pub struct RunContentPack {
    pub schema_version: u32,
    pub m4_oracle_sha: String,
    pub m3_parity_oracle_sha: String,
    pub battle_content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub growth_rates: Vec<Option<GrowthRateDefinition>>,
    pub natures: Vec<Option<NatureDefinition>>,
    pub species_progression: Vec<Option<SpeciesProgressionDefinition>>,
    pub modifiers: Vec<Option<ModifierDefinition>>,
    pub biomes: Vec<Option<BiomeDefinition>>,
    pub encounter_plans: Vec<EncounterPlanDefinition>,
    pub reward_rules: RewardRuleSet,
    pub market_rules: MarketRuleSet,
    pub capability_manifest: RunCapabilityManifest,
}

pub struct ModifierDefinition {
    pub id: ModifierId,
    pub oracle_registry_key: String,
    pub tier: Option<ModifierTier>,
    pub maximum_stack: u16,
    pub target: ModifierTargetKind,
    pub effect: ModifierEffectSpec,
}
```

Modifier numeric IDs are M4 contract-owned and must map bijectively to the oracle string keys in `m4-slice-manifest.json`. Content hashing rejects duplicate IDs, duplicate keys, or mismatches. Definitions are closed data; callbacks, scripts, dynamic trait objects, and `serde_json::Value` are forbidden.

`tier: None` means the oracle registry item is not in the ordinary player reward pool. M4 may apply an already-owned such modifier, but reward generation must never synthesize it. `GOLDEN_EXP_CHARM` is the selected exotic-shop-only case.

## Pure `er-run` API

```rust
pub fn settle_battle(
    before: &GameState,
    input: &BattleSettlementInput,
    content: &GameContentBundle,
) -> Result<PreparedRunTransition, RunError>;

pub fn apply_progression_decision(
    before: &GameState,
    decision: &ProgressionDecision,
    content: &GameContentBundle,
) -> Result<PreparedRunTransition, RunError>;

pub fn open_run_surface(
    before: &GameState,
    request: &OpenSurfaceRequest,
    content: &GameContentBundle,
) -> Result<PreparedRunTransition, RunError>;

pub fn apply_surface_action(
    before: &GameState,
    action: &RunSurfaceAction,
    content: &GameContentBundle,
) -> Result<PreparedRunTransition, RunError>;

pub fn prepare_encounter(
    before: &GameState,
    request: &EncounterRequest,
    content: &GameContentBundle,
) -> Result<EncounterPlan, RunError>;

pub fn finish_run(
    before: &GameState,
    outcome: RunOutcome,
    content: &GameContentBundle,
) -> Result<PreparedRunTransition, RunError>;

pub struct PreparedRunTransition {
    pub before_digest: MechanicalStateDigest,
    pub after_state: GameState,
    pub after_digest: MechanicalStateDigest,
    pub mutations: Vec<RunMutation>,
    pub presentation: Vec<RunPresentationEvent>,
    pub rng_audit: Vec<RunRngDraw>,
    pub next_control: GameControlPlan,
    pub evidence: RunTransitionEvidence,
}

pub enum RunError {
    InvalidState(StateValidationError), InvalidStage, WrongSourceBattle,
    AlreadySettled, UnsupportedContent(UnsupportedReasonCode), InvalidAction,
    InsufficientMoney, InvalidTarget, StaleOrdinal, Overflow,
    EvolutionWouldTrigger, EncounterUnavailable, Rng(RngError),
}
```

These functions have no UI, protocol, kernel, scheduler, network, filesystem, browser, thread, async, wall-clock, or callback dependency.

## Surfaces and controls

```rust
pub enum RunSurfaceState {
    MoveLearn(MoveLearnSurfaceState),
    RewardShop(RewardShopSurfaceState),
    BiomeMarket(BiomeMarketSurfaceState),
    Crossroads(CrossroadsSurfaceState),
    BiomeSelect(BiomeSelectSurfaceState),
}

pub struct SurfaceHeader {
    pub schema_version: u32,
    pub surface_id: RunSurfaceId,
    pub kind: RunSurfaceKind,
    pub owner_seat: SeatId,
    pub interaction_sequence: RunInteractionSequence,
    pub action_ordinal: u32,
    pub operation_id: OperationId,
    pub menu: LogicalMenu,
    pub surface_digest: SurfaceDigest,
}

pub struct MoveLearnSurfaceState { pub header: SurfaceHeader, pub task: LearnMoveTask, pub pending_slot: Option<u8> }
pub struct RewardShopSurfaceState { pub header: SurfaceHeader, pub offers: Vec<RewardOffer>, pub lock_tiers: Vec<ModifierTier>, pub reroll_count: u32, pub reroll_cost: Money, pub pending_target: Option<PendingModifierTarget> }
pub struct BiomeMarketSurfaceState { pub header: SurfaceHeader, pub stock: Vec<MarketStockEntry>, pub pending_target: Option<PendingModifierTarget> }
pub struct CrossroadsSurfaceState { pub header: SurfaceHeader, pub source_wave: WaveIndex }
pub struct BiomeSelectSurfaceState { pub header: SurfaceHeader, pub routes: Vec<RouteNode>, pub inherited_crossroads_sequence: Option<RunInteractionSequence> }

pub enum RunSurfaceAction {
    LearnMove(LearnMoveDecision), Reward(RewardAction),
    BiomeMarket(BiomeMarketAction), Crossroads(CrossroadsAction),
    BiomeSelect(BiomeSelectAction),
}

pub enum RewardAction { SelectFree{offer:RunOfferId,target:Option<PokemonId>}, Skip, Buy{offer:RunOfferId,target:Option<PokemonId>,price:Money}, Reroll, ToggleLock{tier:ModifierTier} }
pub enum BiomeMarketAction { Buy{stock:RunStockId,target:Option<PokemonId>,price:Money}, Leave }
pub enum CrossroadsAction { Stay, MoveOn }
pub struct BiomeSelectAction { pub route_node: RouteNodeId, pub biome: BiomeId }

pub enum GameControl {
    Battle(BattleControl), MoveLearn(MoveLearnControl), RewardShop(RewardShopControl),
    BiomeMarket(BiomeMarketControl), Crossroads(CrossroadsControl),
    BiomeSelect(BiomeSelectControl), Waiting(WaitingControl), Complete(RunOutcome),
}

pub struct GameControlPlan {
    pub schema_version: u32,
    pub seats: Vec<SeatControlPlan>,
    pub next_control_id: ControlId,
    pub next_menu_instance_id: MenuInstanceId,
}
```

`LogicalMenu` and stable option identities are frozen by `m4-game-control.md`. Regular reward/shop supports reroll and locks. Biome market does not. Selected modifier effects execute inside Rust before payment/stock state commits; no external adapter returns acceptance.

## Live operation identities

M4 preserves production Authority V2 identities; it does not use adapter-only `IREW/IMKT/IBIO` addresses.

- Live interaction grammar: `<epoch>:<ownerSeat>:<KIND>:<address>`.
- Ambient reward/market address: `pinned*100000 + actionOrdinal`.
- Reward kind: `REWARD`; market kind: `SHOP_BUY`.
- Crossroads: kind `CROSSROADS_PICK`, address `9600000+pinned`.
- Interactive biome: kind `BIOME_PICK`, address `9700000+pinned`.
- Deterministic biome: owner 0, kind `BIOME_PICK`, address `9800001+sourceWave`.
- Learn prompt/decision: `LEARN_MOVE` or `LEARN_MOVE_BATCH`; decision address is prompt address plus one.
- Global wave: `V2/WAVE/e{epoch}/w{wave}/tick{tick}`.
- Terminal: `V2/TERMINAL/e{epoch}/w{wave}/tick{tick}`.

Wave is retained material/control state for interactions; it is not an extra field in their four-part operation ID. A proposal fingerprint includes operation ID, retained wave coordinate, owner, surface kind/ID, ordinal, control/menu identity, stable option identity, target, price, and semantic payload.

## Authority material DTOs

```rust
pub struct M4MaterialHeader {
    pub m4_oracle_sha: String,
    pub m3_parity_oracle_sha: String,
    pub battle_content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub operation_id: OperationId,
    pub run_id: GameRunId,
    pub wave: WaveIndex,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub before_state: GameState,
    pub after_state: GameState,
    pub next_control: GameControlPlan,
}

pub struct BattleTurnMaterialV2 { pub schema_version:u32, pub header:M4MaterialHeader, pub battle_id:BattleId, pub resolved_turn:TurnIndex, pub commands:CommandSet, pub action_order:Vec<ResolvedAction>, pub mutations:Vec<BattleMutation>, pub presentation:Vec<BattlePresentationEvent>, pub rng_before:BattleRngState, pub rng_after:BattleRngState, pub rng_audit:Vec<RngDraw> }
pub struct BattleReplacementMaterialV2 { pub schema_version:u32, pub header:M4MaterialHeader, pub battle_id:BattleId, pub resolved_turn:TurnIndex, pub occurrence:FaintOccurrence, pub selection:ReplacementSelection, pub mutations:Vec<BattleMutation>, pub presentation:Vec<BattlePresentationEvent> }
pub struct WaveAdvanceMaterialV1 { pub schema_version:u32, pub header:M4MaterialHeader, pub source_battle_id:BattleId, pub settlement:BattleSettlementEvidence, pub mutations:Vec<RunMutation>, pub presentation:Vec<RunPresentationEvent>, pub rng_audit:Vec<RunRngDraw> }
pub struct RunInteractionMaterialV1 { pub schema_version:u32, pub header:M4MaterialHeader, pub surface_kind:RunSurfaceKind, pub surface_id:RunSurfaceId, pub owner_seat:SeatId, pub interaction_sequence:RunInteractionSequence, pub action_ordinal:u32, pub action:RunSurfaceAction, pub mutations:Vec<RunMutation>, pub presentation:Vec<RunPresentationEvent>, pub rng_audit:Vec<RunRngDraw>, pub surface_after_digest:Option<SurfaceDigest> }
pub struct RunTerminalMaterialV1 { pub schema_version:u32, pub header:M4MaterialHeader, pub outcome:RunOutcome, pub mutations:Vec<RunMutation>, pub presentation:Vec<RunPresentationEvent> }

#[serde(tag="kind", content="payload")]
pub enum AuthorityGameMaterial { Turn(BattleTurnMaterialV2), Replacement(BattleReplacementMaterialV2), WaveAdvance(WaveAdvanceMaterialV1), Interaction(RunInteractionMaterialV1), Terminal(RunTerminalMaterialV1) }

pub struct MaterialApplyContext { pub expected_revision:Revision, pub expected_operation_id:OperationId, pub expected_control_id:ControlId, pub expected_menu_instance_id:MenuInstanceId }
pub struct MaterialApplyResult { pub after_state:GameState, pub next_control:GameControlPlan, pub mutations:Vec<GameMutation>, pub presentation:Vec<GamePresentationEvent> }

pub enum MaterialApplyError { NonCanonical, Malformed, WrongKind, WrongSchema, WrongOracle, ContentIdentity, SelfDigest, LocalFrontier, MissingPredecessor, IdentityConflict, MutationReplay, InvalidBeforeState, InvalidAfterState, InvalidControl, InvalidAllocator, UnsupportedContent }

pub fn encode_authority_material(material:&AuthorityGameMaterial) -> Result<CanonicalBytes, MaterialCodecError>;
pub fn decode_authority_material(bytes:&[u8]) -> Result<AuthorityGameMaterial, MaterialCodecError>;
pub fn apply_authority_material(state:&GameState, material:&AuthorityGameMaterial, context:&MaterialApplyContext, content:&GameContentBundle) -> Result<MaterialApplyResult, MaterialApplyError>;
```

All roots use `#[serde(deny_unknown_fields)]`; enums use explicit screaming-snake-case tags. The exact error-to-recovery/terminal mapping is in `m4-error-policy.md`. Authority and replica call the same three functions over the same bytes.

## Digest domains

All M4 mechanical/kernel/pair/surface/run-content digests are `blake3-v1:<64 lowercase hex>` over domain bytes, one zero separator byte, then canonical JSON bytes.

- `pokerogue-redux/m4/mechanical/v2`: complete validated `GameState` V2, including run state, player party, battle, every mechanics RNG state, admitted command/progression state, active surface, counters, and outcome. Transaction-local encounter plans are excluded until folded into the material `after_state` as a complete battle. Logical `GameControlPlan`, UI, input, scheduler, protocol, network, renderer, and the stored `surface_digest` field are excluded.
- `pokerogue-redux/m4/kernel-determinism/v2`: complete V3 endpoint snapshot with append-only diagnostics and stored digest fields omitted.
- `pokerogue-redux/m4/pair-determinism/v2`: complete V3 pair snapshot with append-only diagnostics and stored digest fields omitted.
- `pokerogue-redux/m4/surface/v1`: canonical `RunSurfaceState` with its `surface_digest` field omitted; includes owner, operation identity, ordinal, options/stock, prices, locks/sold/target state, and logical menu graph.
- `pokerogue-redux/m4/run-content/v1`: canonical `RunContentPack` with `run_content_hash` omitted; array order is declared order and optional numeric-ID vectors retain null holes.
- `pokerogue-redux/m3/presentation-plan/v1`: inherited unchanged for battle presentation. Run presentation uses `pokerogue-redux/m4/presentation-plan/v1` over ordered events and blocking/skip policy.

Authority envelope/material digest remains the existing protocol compatibility digest and is never substituted by these BLAKE3 values.

## Internal event FIFO

```rust
pub enum InternalEvent {
    Button(ButtonEvent), Ui(UiIntent), Game(GameIntent), Protocol(ProtocolAction),
    BattleResolved(PreparedBattleTransition), BattleSettled(BattleSettlementInput),
    RunPrepared(PreparedRunTransition), ProgressionAction(ProgressionDecision),
    SurfaceOpened(OpenSurfaceRequest), SurfaceAction(RunSurfaceAction),
    EncounterPrepared(EncounterPlan),
    AuthorityEntryReady(PreparedAuthorityEntry), MaterialInstalled(Revision),
    ControlInstalled(Revision), TerminalPrepared(RunOutcome),
}
```

External `RawInput` can enqueue `Button`; `Button` can enqueue one `Ui`; `Ui` can enqueue one `Game`; game handlers enqueue prepared battle/run work; prepared work canonical-round-trips through `AuthorityEntryReady`; valid application enqueues `MaterialInstalled`, then `ControlInstalled`, then presentation effects. A handler may enqueue only the ordered successors declared by its typed transition. Queue exhaustion is quiescence. The deterministic budget is 4096 internal events per external input; exceeding it is an invariant failure with a trace.

## Snapshot and trace V3 API

```rust
pub struct RestorableKernelSnapshotV3 { pub schema_version:u32, pub input_router:InputRouterSnapshot, pub ui:UiState, pub scheduler:KernelSchedulerSnapshot, pub protocol:ProtocolRuntimeSnapshot, pub game:GameRuntimeSnapshot, pub pending_presentations:Vec<PendingPresentation>, pub prepared_transaction:Option<PreparedTransactionSnapshot>, pub terminal:Option<KernelTerminalState> }
pub struct RestorablePairSnapshotV3 { pub schema_version:u32, pub sequence:SafeU53, pub virtual_time_ms:SafeU53, pub host:RestorableKernelSnapshotV3, pub guest:RestorableKernelSnapshotV3, pub clock:VirtualClockSnapshot, pub network:FaultNetworkSnapshot, pub presenter:PresenterSnapshot, pub storage:StorageSnapshot, pub fault_script:FaultScriptSnapshot, pub fault_rng_state:FaultRngState }
pub struct KernelTraceV3 { pub schema_version:u32, pub initial:RestorablePairSnapshotV3, pub events:Vec<KernelTraceEventV3>, pub final_snapshot:RestorablePairSnapshotV3 }

pub fn GameKernel::snapshot_v3(&self) -> RestorableKernelSnapshotV3;
pub fn GameKernel::from_snapshot_v3(snapshot:RestorableKernelSnapshotV3, content:Arc<GameContentBundle>) -> Result<GameKernel, SnapshotError>;
pub fn SimulatedPair::snapshot_v3(&self) -> RestorablePairSnapshotV3;
pub fn SimulatedPair::from_snapshot_v3(snapshot:RestorablePairSnapshotV3, content:Arc<GameContentBundle>) -> Result<SimulatedPair, SnapshotError>;
```

A prepared transaction may be captured only after complete deterministic preparation and before publication; it contains typed canonical candidate/material bytes and no external handle. Restoration recaptures and requires equality before publication. V1/V2 roots are rejected by V3 constructors; offline migration functions are separate.

## Typed M3 migration

```rust
pub struct M3PokemonCompanionKey { pub fixture_id:String, pub state_side:MigrationStateSide, pub party_side:BattleSide, pub pokemon_id:PokemonId }
pub struct M3PokemonCompanion { pub key:M3PokemonCompanionKey, pub source_party_index:u8, pub stable_roster_index:u8, pub owner_seat:Option<SeatId>, pub experience:Experience, pub growth_rate:GrowthRateId, pub ivs:[Iv;6], pub nature:NatureId, pub effective_nature:NatureId, pub friendship:u16, pub permanent_bonuses:PermanentStatBonuses, pub pause_evolutions:bool }
pub struct M3BattleCompanion { pub fixture_id:String, pub state_side:MigrationStateSide, pub participation:BattleParticipationState, pub settlement:BattleSettlementState }
pub struct M3ToM4MigrationContext { pub m3_parity_oracle_sha:String, pub m4_oracle_sha:String, pub battle_content_hash:ContentPackHash, pub run_content_hash:RunContentPackHash, pub run:RunStateV2, pub fixture_id:String, pub state_side:MigrationStateSide, pub companions:Vec<M3PokemonCompanion>, pub battle:Option<M3BattleCompanion> }
pub enum MigrationError { WrongSchema, WrongOracle, ContentIdentity, MissingCompanion, DuplicateCompanion, UnknownCompanion, PartyOrderConflict, OwnerConflict, InvalidV1, InvalidV2 }
pub fn migrate_m3_game_state(input:&GameStateV1, context:&M3ToM4MigrationContext) -> Result<GameStateV2,MigrationError>;
```

Every player and enemy Pokémon in initial and final fixture states has exactly one companion keyed by stable ID and party side. The three M3 reordered-party cases use explicit stable roster indices from the companion, not array order or legacy party-index maps. Migration consumes zero RNG, performs no stat/EXP reconstruction, publishes no effect, and validates the complete V2 graph.

## Frozen parity fixture

The representative segment starts from the oracle-exported wave-9 canonical state and consumes only oracle-captured reward, progression, market, route, encounter, and RNG vectors whose joins have identical canonical state, content hash, and RNG frontier. The driver uses only physical keydown/keyup, focus/blur, virtual time, network faults, presentation outcomes, and storage outcomes. Direct semantic intents, proposals, material application, progression decisions, surface actions, battle creation, or wave advance are forbidden.

The selected move-learning crossing is Nacli species 932, level 16→17, under test-only `LEVEL_CAP_OVERRIDE=17`. Its post-initialization ER level-17 list contains only Body Slam 34. The composed initial battle loadout is `[1,52,77,78]`; raw input selects Body Slam and replaces slot 0, producing `[34,52,77,78]`. Nacli evolves at level 23, so no evolution candidate is reachable at this boundary. The segment is explicitly composed and makes no natural single-seed, natural-loadout, or default-cap claim.

## Production boundary

M4 mode never emits causal `UiIntent`, `ApplyAuthorityMaterial`, or `ProjectAuthorityControl` effects and never accepts external `UiIntent`, `MaterialApplied`, or `ControlProjected`. Production TypeScript and `rust/source-lock.toml` remain unchanged.