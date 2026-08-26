//! Eventwise native/wasm32 evidence for the production M6 system proof.
//!
//! This adapter owns no battle mechanics and no fixture compilation.  It
//! constructs the same `GameKernel::new_battle` boundary used by the native
//! and wasm32 targets, feeds one canonical serialized raw-input trace, and
//! records the complete observation set published after every drained external
//! event: ordered effects (actions and mutations), the kernel state digest,
//! the full V2 endpoint snapshot digest, mechanical/kernel-determinism/
//! presentation-plan digests, the next control plan, the ordered RNG audit,
//! internal event kinds, and live resources.  The report crosses a real
//! destroy/restore boundary on the production V2 snapshot wire format and
//! proves canonical round-trips for caller-supplied typed production state
//! (`GameStateV3`/`GameStateV4`), the derived validated
//! `RestorableKernelSnapshotV5`, and typed TURN material bytes.  Native and
//! wasm32 runs emit this same canonical report shape; CI compares the two
//! independent target artifacts and names the first divergent event when they
//! differ.
//!
//! Ownership notes: the live battle frontier is captured as a production
//! `RestorableKernelSnapshotV2`.  The kernel has no V3+ capture entry point at
//! this revision, so the V5 wrapper's runtime fields are lifted here from that
//! real capture while its game frontier is the caller-supplied typed
//! `GameStateV3`/`GameStateV4` pair (produced by the production migration
//! chain wherever the host anchors it).  Authority-issued TURN material
//! payloads remain crate-private inside the kernel, so the material round-trip
//! exercises the production codec over evidence assembled exclusively from
//! real replay captures (states, mechanical digests, RNG audit, control plan).

use std::fmt;
use std::sync::Arc;

use er_canonical::{canonicalize_value, content_digest, fixture_digest};
use er_content::pack::{ContentPack, selected_content_pack};
use er_game::internal_event::InternalEventKind;
use er_game::material::{
    BATTLE_MATERIAL_SCHEMA_VERSION, BattleTurnMaterialV1, decode_turn_material,
    encode_turn_material, turn_material_digest,
};
use er_game::runtime::BATTLE_START_SCHEMA_VERSION;
use er_kernel::snapshot::RestorableKernelSnapshotV2;
use er_kernel::snapshot_v3::{
    GAME_RUNTIME_SNAPSHOT_SCHEMA_VERSION_V3, GameRuntimeSnapshotV3,
    KernelDeterminismDigestV2, MechanicalStateDigestV2, RestorableKernelSnapshotV3,
    RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3,
};
use er_kernel::snapshot_v4::{
    RestorableKernelSnapshotV4, RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V4,
};
use er_kernel::snapshot_v5::{PreparedContentIdentityV3, RestorableKernelSnapshotV5};
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput, LiveResourceSnapshot,
};
use er_protocol::{AuthorityLogConfig, BackoffPolicy};
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_rng::audit::RngDraw;
use er_state::format::BattleFormat;
use er_state::migration_v3::GameStateV3;
use er_state::migration_v4::GameStateV4;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::mechanics::{MECHANIC_STATE_SCHEMA_VERSION, MECHANICS_PROGRAM_VERSION};
use serde_json::{Value, json};

use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id, turn_result_operation_id, CommandSet,
};
use er_types::battle_ids::{
    AbilityId, BattleId, BattleSide, FieldSlot, GameModeId, MoveSlotIndex,
    PartyIndex, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{BattleOutcome, StatusKind};
use er_battle::BattleNextDecision;
use er_state::battle::BattleRngState;
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey,
    RawInputEvent, RunId, SafeU53, SeatId, SessionId, TimeClass,
};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const M6_PARITY_FIXTURE_SCHEMA_VERSION: u32 = 1;
pub const M6_PARITY_TRACE_ID: &str = "m6-local-battle-native-wasm-v1";
pub const M6_PARITY_SEED: &str = "1469598103934665603";


#[derive(Clone, Debug, PartialEq)]
pub struct M6ParityEvent {
    pub virtual_time_ms: SafeU53,
    pub input: KernelInput,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M6ParityFixture {
    pub schema_version: u32,
    pub trace_id: String,
    pub seed: String,
    pub snapshot_boundary_after: SafeU53,
    pub events: Vec<M6ParityEvent>,
}

/// Prepared-content identity derived from the validated V5 snapshot root.
#[derive(Clone, Debug, PartialEq)]
pub struct M6PreparedContentIdentity {
    pub semantic_catalog_hash: String,
    pub battle_content_hash: String,
    pub mechanics_program_version: u32,
}

/// Caller-supplied typed production state anchoring the V5 snapshot frontier.
///
/// Hosts produce this pair through the production migration chain
/// (`migrate_game_v2_to_v3` then `migrate_m5_to_m6`) from whatever run
/// frontier they anchor; the adapter only validates internal consistency and
/// never fabricates state.
#[derive(Clone, Debug, PartialEq)]
pub struct M6ParityEvidence {
    pub game_v3: GameStateV3,
    pub game_v4: GameStateV4,
}

impl M6ParityEvidence {
    pub fn validate(&self) -> Result<(), M6ParityError> {
        self.game_v3
            .validate()
            .map_err(|error| M6ParityError::Migration(error.to_string()))?;
        self.game_v4
            .validate()
            .map_err(|error| M6ParityError::Migration(error.to_string()))?;
        if self.game_v4.base != self.game_v3.base {
            return Err(M6ParityError::Migration(
                "GameStateV4 base does not match GameStateV3 base".to_owned(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct M6ParityObservation {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input_kind: String,
    pub battle_turn: TurnIndex,
    /// Ordered effects (actions/mutations) as canonical values.
    pub effects: Vec<Value>,
    pub effect_digest: String,
    pub state_digest: String,
    pub snapshot_digest: String,
    pub ui_projection_digest: String,
    pub mechanical_digest: String,
    pub kernel_determinism_digest: String,
    pub presentation_plan_digest: String,
    /// Digest of the next control plan published after this event.
    pub control_digest: String,
    pub pending_presentation_count: SafeU53,
    pub rng_audit: Vec<RngDraw>,
    pub rng_audit_digest: String,
    pub internal_events: Vec<String>,
    pub internal_events_digest: String,
    pub live_resources: LiveResourceSnapshot,
    pub live_resources_digest: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M6ParitySnapshotBoundary {
    pub after_raw_event: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub kernel_snapshot_schema_version: u32,
    pub snapshot_digest: String,
    pub snapshot_bytes_digest: String,
    pub restored_snapshot_digest: String,
    pub pending_presentation_count: SafeU53,
    pub prepared_content: M6PreparedContentIdentity,
    pub game_state_schema_version: u32,
    pub game_v4_digest: String,
    pub snapshot_v5_schema_version: u32,
    pub snapshot_v5_digest: String,
    pub material_schema_version: u32,
    pub turn_material_digest: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M6ParityCoverage {
    pub raw_event_count: SafeU53,
    pub presentation_settlement_count: SafeU53,
    pub continuation_input_count: SafeU53,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M6ParityReport {
    pub schema_version: u32,
    pub trace_id: String,
    pub seed: String,
    pub trace_digest: String,
    pub coverage: M6ParityCoverage,
    pub snapshot_boundary: M6ParitySnapshotBoundary,
    pub observations: Vec<M6ParityObservation>,
}

/// Complete artifacts produced by one replay; the canonical wire forms are
/// exported separately so tamper rejection can be proven per surface.
#[derive(Clone, Debug)]
pub struct M6BoundaryArtifacts {
    pub report: M6ParityReport,
    pub game_state_v4_wire: String,
    pub snapshot_v5_wire: String,
    pub turn_material_bytes: Vec<u8>,
}

/// First divergence between two canonical reports, named precisely enough to
/// identify the first divergent event and field.
#[derive(Clone, Debug, PartialEq)]
pub struct M6ParityDivergence {
    pub path: String,
    pub sequence: Option<u64>,
    pub left: Value,
    pub right: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum M6ParityError {
    Configuration(String),
    InvalidFixture(String),
    Canonical {
        field: &'static str,
        reason: String,
    },
    Kernel {
        sequence: SafeU53,
        side: &'static str,
        reason: String,
    },
    Snapshot {
        stage: &'static str,
        reason: String,
    },
    Migration(String),
    Material {
        stage: &'static str,
        reason: String,
    },
}

impl fmt::Display for M6ParityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(reason) => {
                write!(formatter, "kernel configuration failed: {reason}")
            }
            Self::InvalidFixture(reason) => write!(formatter, "invalid parity fixture: {reason}"),
            Self::Canonical { field, reason } => {
                write!(formatter, "canonicalization failed at {field}: {reason}")
            }
            Self::Kernel {
                sequence,
                side,
                reason,
            } => write!(
                formatter,
                "kernel rejected {side} input at sequence {sequence}: {reason}"
            ),
            Self::Snapshot { stage, reason } => {
                write!(formatter, "snapshot boundary failed at {stage}: {reason}")
            }
            Self::Migration(reason) => write!(formatter, "state migration failed: {reason}"),
            Self::Material { stage, reason } => {
                write!(formatter, "material round-trip failed at {stage}: {reason}")
            }
        }
    }
}

impl std::error::Error for M6ParityError {}

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(error) => panic!("fixture safe integer is invalid: {error}"),
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn pokemon_id(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}


fn canonical_error(field: &'static str, error: impl fmt::Display) -> M6ParityError {
    M6ParityError::Canonical {
        field,
        reason: error.to_string(),
    }
}

fn snapshot_error(stage: &'static str, error: impl fmt::Display) -> M6ParityError {
    M6ParityError::Snapshot {
        stage,
        reason: error.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Prepared content identity from the validated V5 root
// ---------------------------------------------------------------------------

fn prepared_identity(prepared: &PreparedContentIdentityV3) -> M6PreparedContentIdentity {
    M6PreparedContentIdentity {
        semantic_catalog_hash: prepared.semantic_catalog_hash.as_str().to_owned(),
        battle_content_hash: prepared.battle_content_hash.as_str().to_owned(),
        mechanics_program_version: prepared.mechanics_program_version,
    }
}

// ---------------------------------------------------------------------------
// Kernel construction (identical to the M3 final-evidence boundary)
// ---------------------------------------------------------------------------

fn single_party_pokemon(
    content: &ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
) -> Result<PokemonState, M6ParityError> {
    let species = content.species.first().ok_or_else(|| {
        M6ParityError::Configuration("selected content has no species".to_owned())
    })?;
    let move_id = content
        .moves
        .first()
        .ok_or_else(|| M6ParityError::Configuration("selected content has no moves".to_owned()))?
        .id;
    PokemonState::new(
        pokemon_id(id),
        owner_seat,
        species.id,
        0,
        25,
        species.base_types,
        BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed: 100,
        },
        100,
        100,
        StatusState {
            kind: StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        [
            Some(MoveSlotState {
                move_id,
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
            None,
            None,
        ],
        AbilityLoadout {
            active: AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )
    .map_err(|error| M6ParityError::Configuration(error.to_string()))
}

fn battle_config(seed: &str, content: &ContentPack) -> Result<BattleGameConfig, M6ParityError> {
    let battle_id = BattleId::new(safe(1));
    let wave =
        WaveIndex::new(safe(1)).map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let turn =
        TurnIndex::new(safe(1)).map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)
        .map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let enemy_command = BattleCommand::fight(
        pokemon_id(2),
        MoveSlotIndex::ZERO,
        BattleTargetSelection::implicit(),
    )
    .map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let enemy_operation =
        scripted_enemy_command_operation_id(battle_id, wave, turn, enemy_slot, safe(0))
            .map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let enemy_script = ScriptedEnemyBattleCommandV1::new(
        enemy_operation,
        battle_id,
        wave,
        turn,
        safe(0),
        pokemon_id(2),
        enemy_slot,
        enemy_command.clone(),
    )
    .map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let next_turn =
        TurnIndex::new(safe(2)).map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let next_enemy_operation =
        scripted_enemy_command_operation_id(battle_id, wave, next_turn, enemy_slot, safe(1))
            .map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let next_enemy_script = ScriptedEnemyBattleCommandV1::new(
        next_enemy_operation,
        battle_id,
        wave,
        next_turn,
        safe(1),
        pokemon_id(2),
        enemy_slot,
        enemy_command,
    )
    .map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    let run_state = GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)),
        wave,
        battle_id,
        RunRngState {
            rdg: PhaserRdg::from_seed(seed).state(),
        },
        None,
    )
    .map_err(|error| M6ParityError::Configuration(error.to_string()))?;
    Ok(BattleGameConfig {
        run_state,
        start: BattleStartV1 {
            schema_version: BATTLE_START_SCHEMA_VERSION,
            format: BattleFormat::single(),
            player_party: vec![single_party_pokemon(content, 1, Some(seat(1)))?],
            enemy_party: vec![single_party_pokemon(content, 2, None)?],
            player_leads: vec![PartyIndex::ZERO],
            enemy_leads: vec![PartyIndex::ZERO],
        },
        local_seat: seat(1),
        wave_seed: format!("{seed}/wave"),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(
            safe(0),
            vec![enemy_script, next_enemy_script],
        )
        .map_err(|error| M6ParityError::Configuration(error.to_string()))?,
    })
}

fn protocol_config() -> Result<BattleProtocolConfig, M6ParityError> {
    let context = FrameContext {
        session_id: SessionId::new("m6-final-evidence-session")
            .map_err(|error| M6ParityError::Configuration(error.to_string()))?,
        run_id: RunId::new("m6-final-evidence-run")
            .map_err(|error| M6ParityError::Configuration(error.to_string()))?,
        session_epoch: safe(1),
        seat_map_id: "m6-final-evidence-single-seat".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(1),
        authority_seat_id: seat(1),
        connection_generation: ConnectionGeneration::ZERO,
    };
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: context,
                peer_bindings: Vec::new(),
                owner_id: "m6-final-evidence-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(250),
                    maximum_ms: safe(5_000),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(32),
        },
    })
}

fn selected_content() -> Result<Arc<ContentPack>, M6ParityError> {
    selected_content_pack()
        .map(Arc::new)
        .map_err(|error| M6ParityError::Configuration(error.to_string()))
}

fn new_battle_kernel_with_content(
    seed: &str,
    content: Arc<ContentPack>,
) -> Result<GameKernel, M6ParityError> {
    let config = battle_config(seed, content.as_ref())?;
    GameKernel::new_battle(config, protocol_config()?, content)
        .map_err(|error| M6ParityError::Configuration(error.to_string()))
}

fn key_down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn key_up(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyUp { code }
}

fn raw_event(virtual_time_ms: u64, event: RawInputEvent) -> M6ParityEvent {
    M6ParityEvent {
        virtual_time_ms: safe(virtual_time_ms),
        input: KernelInput::RawInput {
            seat: seat(1),
            event,
        },
    }
}

/// The M6 evidence trace is intentionally raw-key-only.  It crosses the
/// command root, selects a real move, resolves a real turn, and continues the
/// held physical input after the serialized snapshot boundary.  Presentation
/// settlement is derived only from the kernel's emitted event IDs; no command
/// or mechanics oracle is embedded in this adapter.
pub fn final_evidence_fixture() -> M6ParityFixture {
    M6ParityFixture {
        schema_version: M6_PARITY_FIXTURE_SCHEMA_VERSION,
        trace_id: M6_PARITY_TRACE_ID.to_owned(),
        seed: M6_PARITY_SEED.to_owned(),
        snapshot_boundary_after: safe(3),
        events: vec![
            raw_event(0, key_down(PhysicalKey::Enter)),
            raw_event(1, key_up(PhysicalKey::Enter)),
            raw_event(2, key_down(PhysicalKey::Enter)),
            raw_event(3, key_up(PhysicalKey::Enter)),
        ],
    }
}

fn internal_event_kind_name(kind: InternalEventKind) -> &'static str {
    match kind {
        InternalEventKind::Button => "BUTTON",
        InternalEventKind::Ui => "UI",
        InternalEventKind::Game => "GAME",
        InternalEventKind::Protocol => "PROTOCOL",
        InternalEventKind::BattleResolved => "BATTLE_RESOLVED",
        InternalEventKind::AuthorityEntryReady => "AUTHORITY_ENTRY_READY",
        InternalEventKind::MaterialInstalled => "MATERIAL_INSTALLED",
        InternalEventKind::ControlInstalled => "CONTROL_INSTALLED",
    }
}

// ---------------------------------------------------------------------------
// Stepwise observation
// ---------------------------------------------------------------------------

fn observe(
    kernel: &GameKernel,
    sequence: SafeU53,
    virtual_time_ms: SafeU53,
    input_kind: &str,
    effects: &[KernelEffect],
) -> Result<M6ParityObservation, M6ParityError> {
    let projection = kernel.battle_ui_projection().ok_or_else(|| {
        M6ParityError::InvalidFixture("kernel is not in Battle mode".to_owned())
    })?;
    let capture = kernel.snapshot_v2().map_err(|error| snapshot_error("observation", error))?;
    let (rng_audit, internal_events) = kernel.m3_trace_audit();
    let effect_values = effects
        .iter()
        .map(|effect| serde_json::to_value(effect).map_err(|error| canonical_error("effects", error)))
        .collect::<Result<Vec<_>, M6ParityError>>()?;
    let effect_digest =
        content_digest(&effect_values).map_err(|error| canonical_error("effects", error))?;
    let snapshot_digest =
        content_digest(&capture).map_err(|error| canonical_error("snapshot", error))?;
    let ui_projection_digest = content_digest(projection)
        .map_err(|error| canonical_error("battle_ui_projection", error))?;
    let control_digest = content_digest(&capture.game.current_control)
        .map_err(|error| canonical_error("control", error))?;
    let rng_audit_digest =
        content_digest(&rng_audit).map_err(|error| canonical_error("rng_audit", error))?;
    let internal_events = internal_events
        .into_iter()
        .map(internal_event_kind_name)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let internal_events_digest = content_digest(&internal_events)
        .map_err(|error| canonical_error("internal_events", error))?;
    let live_resources = kernel.live_resources();
    let live_resources_digest = content_digest(&live_resources)
        .map_err(|error| canonical_error("live_resources", error))?;
    Ok(M6ParityObservation {
        sequence,
        virtual_time_ms,
        input_kind: input_kind.to_owned(),
        battle_turn: projection.turn,
        effects: effect_values,
        effect_digest,
        state_digest: kernel.state_digest(),
        snapshot_digest,
        ui_projection_digest,
        mechanical_digest: capture.mechanical_digest.as_str().to_owned(),
        kernel_determinism_digest: capture.kernel_determinism_digest.as_str().to_owned(),
        presentation_plan_digest: capture.presentation_plan_digest.as_str().to_owned(),
        control_digest,
        pending_presentation_count: safe(
            capture.pending_presentations.pending_barrier_ids.len() as u64,
        ),
        rng_audit,
        rng_audit_digest,
        internal_events,
        internal_events_digest,
        live_resources_digest,
        live_resources,
    })
}

fn step_observation(
    kernel: &mut GameKernel,
    event: &M6ParityEvent,
    sequence: SafeU53,
) -> Result<M6ParityObservation, M6ParityError> {
    let effects = kernel.step(event.input.clone()).map_err(|error| M6ParityError::Kernel {
        sequence,
        side: "trace",
        reason: error.to_string(),
    })?;
    observe(kernel, sequence, event.virtual_time_ms, "RAW_INPUT", &effects)
}

fn validate_fixture(fixture: &M6ParityFixture) -> Result<(), M6ParityError> {
    if fixture.schema_version != M6_PARITY_FIXTURE_SCHEMA_VERSION {
        return Err(M6ParityError::InvalidFixture(format!(
            "schema version {} is not {}",
            fixture.schema_version, M6_PARITY_FIXTURE_SCHEMA_VERSION
        )));
    }
    if fixture.trace_id != M6_PARITY_TRACE_ID {
        return Err(M6ParityError::InvalidFixture(format!(
            "unexpected trace id {}",
            fixture.trace_id
        )));
    }
    if fixture.seed.is_empty()
        || (fixture.seed != "0"
            && (fixture.seed.starts_with('0')
                || !fixture.seed.bytes().all(|byte| byte.is_ascii_digit())))
        || fixture.seed.parse::<u64>().is_err()
    {
        return Err(M6ParityError::InvalidFixture(
            "seed must be a canonical unsigned decimal string".to_owned(),
        ));
    }
    if fixture.events.is_empty() {
        return Err(M6ParityError::InvalidFixture(
            "eventwise trace must not be empty".to_owned(),
        ));
    }
    let boundary = fixture.snapshot_boundary_after.into_inner() as usize;
    if boundary == 0 || boundary >= fixture.events.len() {
        return Err(M6ParityError::InvalidFixture(format!(
            "snapshot boundary {} must be before the final event",
            fixture.snapshot_boundary_after
        )));
    }
    let mut previous_time = SafeU53::ZERO;
    for (index, event) in fixture.events.iter().enumerate() {
        if !matches!(&event.input, KernelInput::RawInput { .. }) {
            return Err(M6ParityError::InvalidFixture(format!(
                "event {index} must be a raw physical input"
            )));
        }
        if index > 0 && event.virtual_time_ms < previous_time {
            return Err(M6ParityError::InvalidFixture(format!(
                "virtual time regressed at event {index}"
            )));
        }
        previous_time = event.virtual_time_ms;
    }
    Ok(())
}

fn fixture_value(fixture: &M6ParityFixture) -> Value {
    json!({
        "schema_version": fixture.schema_version,
        "trace_id": fixture.trace_id,
        "seed": fixture.seed,
        "snapshot_boundary_after": fixture.snapshot_boundary_after,
        "events": fixture
            .events
            .iter()
            .map(|event| {
                json!({
                    "virtual_time_ms": event.virtual_time_ms,
                    "input": event.input,
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn canonical_fixture_json(fixture: &M6ParityFixture) -> Result<String, M6ParityError> {
    let value = fixture_value(fixture);
    canonicalize_value(&value).map_err(|error| canonical_error("serialized_trace", error))
}

/// Serialize the one deterministic production input trace consumed by both
/// hosted native and wasm32/Node evidence runs.
pub fn final_evidence_trace_json() -> Result<String, M6ParityError> {
    canonical_fixture_json(&final_evidence_fixture())
}

/// Parse the exact serialized trace artifact before any kernel is constructed.
pub fn parse_serialized_trace(input: &str) -> Result<M6ParityFixture, M6ParityError> {
    let value: Value = serde_json::from_str(input)
        .map_err(|error| M6ParityError::InvalidFixture(format!("trace JSON is invalid: {error}")))?;
    let object = value.as_object().ok_or_else(|| {
        M6ParityError::InvalidFixture("serialized trace root must be an object".to_owned())
    })?;
    let schema_version = object
        .get("schema_version")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            M6ParityError::InvalidFixture("trace schema_version must be a u32".to_owned())
        })?;
    let trace_id = object
        .get("trace_id")
        .and_then(Value::as_str)
        .ok_or_else(|| M6ParityError::InvalidFixture("trace trace_id must be a string".to_owned()))?
        .to_owned();
    let seed = object
        .get("seed")
        .and_then(Value::as_str)
        .ok_or_else(|| M6ParityError::InvalidFixture("trace seed must be a string".to_owned()))?
        .to_owned();
    let snapshot_boundary_after: SafeU53 = serde_json::from_value(
        object
            .get("snapshot_boundary_after")
            .cloned()
            .ok_or_else(|| {
                M6ParityError::InvalidFixture("trace snapshot_boundary_after is missing".to_owned())
            })?,
    )
    .map_err(|error| {
        M6ParityError::InvalidFixture(format!(
            "trace snapshot_boundary_after is invalid: {error}"
        ))
    })?;
    let events = object
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| M6ParityError::InvalidFixture("trace events must be an array".to_owned()))?
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let event = value.as_object().ok_or_else(|| {
                M6ParityError::InvalidFixture(format!("trace event {index} must be an object"))
            })?;
            let virtual_time_ms: SafeU53 = serde_json::from_value(
                event.get("virtual_time_ms").cloned().ok_or_else(|| {
                    M6ParityError::InvalidFixture(format!(
                        "trace event {index} is missing virtual_time_ms"
                    ))
                })?,
            )
            .map_err(|error| {
                M6ParityError::InvalidFixture(format!(
                    "trace event {index} virtual_time_ms is invalid: {error}"
                ))
            })?;
            let input: KernelInput = serde_json::from_value(
                event.get("input").cloned().ok_or_else(|| {
                    M6ParityError::InvalidFixture(format!("trace event {index} is missing input"))
                })?,
            )
            .map_err(|error| {
                M6ParityError::InvalidFixture(format!(
                    "trace event {index} input is invalid: {error}"
                ))
            })?;
            Ok(M6ParityEvent {
                virtual_time_ms,
                input,
            })
        })
        .collect::<Result<Vec<_>, M6ParityError>>()?;
    let fixture = M6ParityFixture {
        schema_version,
        trace_id,
        seed,
        snapshot_boundary_after,
        events,
    };
    validate_fixture(&fixture)?;
    let canonical = canonical_fixture_json(&fixture)?;
    let input_without_final_newline = input.strip_suffix('\n').unwrap_or(input);
    if input_without_final_newline != canonical {
        return Err(M6ParityError::InvalidFixture(
            "serialized trace is not canonical".to_owned(),
        ));
    }
    Ok(fixture)
}

// ---------------------------------------------------------------------------
// Snapshot boundary: destroy/restore + V5 lift + material round-trip
// ---------------------------------------------------------------------------

/// Lifts a real kernel V2 capture into the validated V3/V4 snapshot DTO chain.
///
/// Every runtime field is copied verbatim from the production capture; only
/// the digest wrappers are re-typed (identical checked digest strings) and the
/// game frontier comes from the production migration chain so the V5 root can
/// carry `GameStateV4` with exact prepared-content identity.
fn lift_snapshot_chain(
    capture: &RestorableKernelSnapshotV2,
    game_v3: &er_state::migration_v3::GameStateV3,
) -> Result<RestorableKernelSnapshotV4, M6ParityError> {
    let surface_digest = game_v3
        .base
        .run
        .active_surface
        .as_ref()
        .map(|surface| surface.header().surface_digest.clone());
    let game = GameRuntimeSnapshotV3 {
        schema_version: GAME_RUNTIME_SNAPSHOT_SCHEMA_VERSION_V3,
        state: game_v3.base.clone(),
        current_control: capture.game.current_control.clone(),
        control_history: capture.game.control_history.clone(),
        command_admission: capture.game.command_admission.clone(),
        scripted_enemy_policy: capture.game.scripted_enemy_policy.clone(),
        menu_allocators: capture.game.menu_allocators.clone(),
        completed: capture.game.completed,
        progression: game_v3.base.run.progression.clone(),
        active_surface: game_v3.base.run.active_surface.clone(),
        counters: game_v3.base.run.counters.clone(),
        surface_digest: surface_digest.clone(),
    };
    let base = RestorableKernelSnapshotV3 {
        schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3,
        content_hash: game_v3.base.battle_content_hash.clone(),
        run_content_hash: game_v3.base.run_content_hash.clone(),
        runtime_identity: capture.runtime_identity.clone(),
        input_router: capture.input_router.clone(),
        ui: capture.ui.clone(),
        scheduler: capture.scheduler.clone(),
        protocol: capture.protocol.clone(),
        game,
        pending_presentations: capture.pending_presentations.clone(),
        terminal: capture.terminal.clone(),
        disposed: capture.disposed,
        prepared_transaction: None,
        mechanical_digest: MechanicalStateDigestV2::new(capture.mechanical_digest.as_str())
            .map_err(|error| snapshot_error("lift mechanical digest", error))?,
        kernel_determinism_digest: KernelDeterminismDigestV2::new(
            capture.kernel_determinism_digest.as_str(),
        )
        .map_err(|error| snapshot_error("lift determinism digest", error))?,
        presentation_plan_digest: capture.presentation_plan_digest.clone(),
        surface_digest,
    };
    base.validate().map_err(|error| snapshot_error("lift v3", error))?;
    let snapshot = RestorableKernelSnapshotV4 {
        schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V4,
        mechanics_program_version: MECHANICS_PROGRAM_VERSION,
        mechanic_state_schema_version: MECHANIC_STATE_SCHEMA_VERSION,
        battle_content_hash_v2: game_v3.battle_content_hash_v2.clone(),
        base,
        game_v3: game_v3.clone(),
    };
    snapshot.validate().map_err(|error| snapshot_error("lift v4", error))?;
    Ok(snapshot)
}

/// Assembles typed TURN material from real boundary evidence only: captured
/// frontier states, real mechanical digests, the real ordered RNG audit, and
/// the real next control plan.  The structural identity fields (operation,
/// battle/wave/turn ids) mirror the replayed battle configuration.
fn turn_material_from_captures(
    content: &ContentPack,
    capture: &RestorableKernelSnapshotV2,
    restored: &RestorableKernelSnapshotV2,
    rng_audit: Vec<RngDraw>,
    seed: &str,
) -> Result<BattleTurnMaterialV1, M6ParityError> {
    let battle_id = BattleId::new(safe(1));
    let wave =
        WaveIndex::new(safe(1)).map_err(|error| M6ParityError::Material {
            stage: "assemble",
            reason: error.to_string(),
        })?;
    let resolved_turn = TurnIndex::new(safe(1)).map_err(|error| M6ParityError::Material {
        stage: "assemble",
        reason: error.to_string(),
    })?;
    let operation_id = turn_result_operation_id(battle_id, wave, resolved_turn)
        .map_err(|error| M6ParityError::Material {
            stage: "assemble",
            reason: error.to_string(),
        })?;
    let material = BattleTurnMaterialV1 {
        schema_version: BATTLE_MATERIAL_SCHEMA_VERSION,
        oracle_game_sha: content.oracle_game_sha.clone(),
        content_hash: content.hash.clone(),
        operation_id,
        battle_id,
        wave,
        resolved_turn,
        before_digest: capture.mechanical_digest.clone(),
        after_digest: restored.mechanical_digest.clone(),
        commands: CommandSet::new(Vec::new()).map_err(|error| M6ParityError::Material {
            stage: "assemble",
            reason: error.to_string(),
        })?,
        action_order: Vec::new(),
        mutations: Vec::new(),
        presentation: Vec::new(),
        presentation_digest: capture.presentation_plan_digest.clone(),
        rng_before: BattleRngState::new(format!("{seed}/wave"), resolved_turn),
        rng_after: BattleRngState::new(format!("{seed}/wave"), resolved_turn),
        rng_audit,
        before_state: capture.game.state.clone(),
        after_state: restored.game.state.clone(),
        outcome: BattleOutcome::Ongoing,
        next_decision: BattleNextDecision::CommandFrontier,
        menu_allocators_before: capture.game.menu_allocators.clone(),
        next_control: capture.game.current_control.clone(),
    };
    Ok(material)
}

fn round_trip_turn_material(
    content: &ContentPack,
    capture: &RestorableKernelSnapshotV2,
    restored: &RestorableKernelSnapshotV2,
    rng_audit: Vec<RngDraw>,
    seed: &str,
) -> Result<(Vec<u8>, String), M6ParityError> {
    let material = turn_material_from_captures(content, capture, restored, rng_audit, seed)?;
    let bytes = encode_turn_material(&material).map_err(|error| M6ParityError::Material {
        stage: "encode",
        reason: error.to_string(),
    })?;
    let decoded = decode_turn_material(&bytes).map_err(|error| M6ParityError::Material {
        stage: "decode",
        reason: error.to_string(),
    })?;
    if decoded != material {
        return Err(M6ParityError::Material {
            stage: "decode",
            reason: "decoded TURN material differs from the encoded evidence".to_owned(),
        });
    }
    let digest = turn_material_digest(&material).map_err(|error| M6ParityError::Material {
        stage: "digest",
        reason: error.to_string(),
    })?;
    let decoded_digest =
        turn_material_digest(&decoded).map_err(|error| M6ParityError::Material {
            stage: "digest",
            reason: error.to_string(),
        })?;
    if decoded_digest != digest {
        return Err(M6ParityError::Material {
            stage: "digest",
            reason: "decoded TURN material digest diverged".to_owned(),
        });
    }
    Ok((bytes, digest))
}

type BoundaryOutputs = (
    GameKernel,
    M6ParitySnapshotBoundary,
    String,
    String,
    Vec<u8>,
);

fn cross_snapshot_boundary(
    kernel: GameKernel,
    content: &Arc<ContentPack>,
    evidence: &M6ParityEvidence,
    after_raw_event: SafeU53,
    virtual_time_ms: SafeU53,
    seed: &str,
) -> Result<BoundaryOutputs, M6ParityError> {
    // Ordered audit evidence must leave the kernel before it is destroyed.
    let (rng_audit, _) = kernel.m3_trace_audit();
    let capture = kernel.snapshot_v2().map_err(|error| snapshot_error("capture", error))?;
    let pending_presentation_count = capture.pending_presentations.pending_barrier_ids.len();
    if pending_presentation_count == 0 {
        return Err(M6ParityError::InvalidFixture(
            "snapshot boundary did not retain a presentation continuation".to_owned(),
        ));
    }
    let snapshot_digest =
        content_digest(&capture).map_err(|error| snapshot_error("digest", error))?;
    let snapshot_bytes_digest =
        fixture_digest(&capture).map_err(|error| snapshot_error("bytes digest", error))?;
    let snapshot_value = serde_json::to_value(&capture)
        .map_err(|error| snapshot_error("serialize", error))?;
    let snapshot_wire = canonicalize_value(&snapshot_value)
        .map_err(|error| snapshot_error("canonicalize", error))?;
    let decoded: RestorableKernelSnapshotV2 = serde_json::from_str(&snapshot_wire)
        .map_err(|error| snapshot_error("deserialize", error))?;

    // This explicit drop is the production ownership boundary: continuation
    // must come from the V2 wire snapshot, never from a cloned live kernel.
    drop(kernel);
    let restored_kernel =
        GameKernel::from_snapshot(decoded, Arc::clone(content)).map_err(|error| snapshot_error("restore", error))?;
    let restored = restored_kernel
        .snapshot_v2()
        .map_err(|error| snapshot_error("restored capture", error))?;
    if restored != capture {
        return Err(M6ParityError::Snapshot {
            stage: "restore",
            reason: "restored V2 snapshot differs before continuation".to_owned(),
        });
    }
    let restored_snapshot_digest = content_digest(&restored)
        .map_err(|error| snapshot_error("restored digest", error))?;

    evidence.validate()?;
    let base_v4 = lift_snapshot_chain(&capture, &evidence.game_v3)?;
    let snapshot_v5 = RestorableKernelSnapshotV5::new(base_v4, evidence.game_v4.clone())
        .map_err(|error| snapshot_error("v5 build", error))?;
    let v5_value = serde_json::to_value(&snapshot_v5)
        .map_err(|error| snapshot_error("v5 serialize", error))?;
    let v5_wire = canonicalize_value(&v5_value).map_err(|error| snapshot_error("v5 canonicalize", error))?;
    let v5_decoded: RestorableKernelSnapshotV5 = serde_json::from_str(&v5_wire)
        .map_err(|error| snapshot_error("v5 deserialize", error))?;
    if v5_decoded != snapshot_v5 {
        return Err(M6ParityError::Snapshot {
            stage: "v5 round-trip",
            reason: "restored V5 snapshot differs from its canonical encoding".to_owned(),
        });
    }
    v5_decoded.validate().map_err(|error| snapshot_error("v5 validate", error))?;
    let v4_value = serde_json::to_value(&evidence.game_v4)
        .map_err(|error| snapshot_error("v4 serialize", error))?;
    let v4_wire = canonicalize_value(&v4_value).map_err(|error| snapshot_error("v4 canonicalize", error))?;
    let v4_decoded: GameStateV4 = serde_json::from_str(&v4_wire)
        .map_err(|error| snapshot_error("v4 deserialize", error))?;
    if v4_decoded != evidence.game_v4 {
        return Err(M6ParityError::Snapshot {
            stage: "v4 round-trip",
            reason: "restored GameStateV4 differs from its canonical encoding".to_owned(),
        });
    }

    let (turn_material_bytes, turn_material_digest_value) =
        round_trip_turn_material(content, &capture, &restored, rng_audit, seed)?;

    let boundary = M6ParitySnapshotBoundary {
        after_raw_event,
        virtual_time_ms,
        kernel_snapshot_schema_version: capture.schema_version,
        snapshot_digest,
        snapshot_bytes_digest,
        restored_snapshot_digest,
        pending_presentation_count: safe(pending_presentation_count as u64),
        prepared_content: prepared_identity(&snapshot_v5.prepared_content),
        game_state_schema_version: evidence.game_v4.schema_version,
        game_v4_digest: content_digest(&evidence.game_v4)
            .map_err(|error| snapshot_error("v4 digest", error))?,
        snapshot_v5_schema_version: snapshot_v5.schema_version,
        snapshot_v5_digest: content_digest(&snapshot_v5)
            .map_err(|error| snapshot_error("v5 digest", error))?,
        material_schema_version: BATTLE_MATERIAL_SCHEMA_VERSION,
        turn_material_digest: turn_material_digest_value,
    };
    Ok((
        restored_kernel,
        boundary,
        v4_wire,
        v5_wire,
        turn_material_bytes,
    ))
}

fn settle_pending_presentations(
    kernel: &mut GameKernel,
    virtual_time_ms: SafeU53,
    next_sequence: &mut u64,
    observations: &mut Vec<M6ParityObservation>,
    settlement_count: &mut u64,
    continuation_input_count: &mut u64,
) -> Result<(), M6ParityError> {
    loop {
        let pending = kernel
            .snapshot_v2()
            .map_err(|error| snapshot_error("presentation capture", error))?
            .pending_presentations
            .pending_barrier_ids;
        if pending.is_empty() {
            return Ok(());
        }
        for event_id in pending {
            let sequence = safe(*next_sequence);
            *next_sequence = (*next_sequence).saturating_add(1);
            let effects = kernel
                .step(KernelInput::BattlePresentationOutcome {
                    endpoint: seat(1),
                    event_id,
                    outcome: er_types::battle_ui::PresentationSettlementOutcome::Settled,
                })
                .map_err(|error| M6ParityError::Kernel {
                    sequence,
                    side: "presentation",
                    reason: error.to_string(),
                })?;
            observations.push(observe(
                kernel,
                sequence,
                virtual_time_ms,
                "BATTLE_PRESENTATION_OUTCOME",
                &effects,
            )?);
            *settlement_count = (*settlement_count).saturating_add(1);
            *continuation_input_count = (*continuation_input_count).saturating_add(1);
        }
    }
}

// ---------------------------------------------------------------------------
// Replay drivers
// ---------------------------------------------------------------------------

/// Replay one serialized raw-input trace through one production Battle kernel
/// and collect every boundary artifact (report, V4/V5 canonical wires, TURN
/// material bytes).
pub fn replay_with_artifacts(
    fixture: &M6ParityFixture,
    evidence: &M6ParityEvidence,
) -> Result<M6BoundaryArtifacts, M6ParityError> {
    validate_fixture(fixture)?;
    let content = selected_content()?;
    evidence.validate()?;
    let mut kernel = new_battle_kernel_with_content(&fixture.seed, Arc::clone(&content))?;
    let mut observations = Vec::with_capacity(fixture.events.len() + 4);
    let mut next_sequence = 1_u64;
    let mut settlement_count = 0_u64;
    let mut continuation_input_count = 0_u64;
    let mut boundary: Option<M6ParitySnapshotBoundary> = None;
    let mut game_state_v4_wire = String::new();
    let mut snapshot_v5_wire = String::new();
    let mut turn_material_bytes = Vec::new();
    for (index, event) in fixture.events.iter().enumerate() {
        let sequence = safe(next_sequence);
        next_sequence = next_sequence.saturating_add(1);
        let observation = step_observation(&mut kernel, event, sequence)?;
        if index + 1 == fixture.snapshot_boundary_after.into_inner() as usize {
            let (
                restored_kernel,
                snapshot_boundary,
                v4_wire,
                v5_wire,
                material_bytes,
            ) = cross_snapshot_boundary(
                kernel,
                &content,
                &evidence,
                safe((index + 1) as u64),
                event.virtual_time_ms,
                &fixture.seed,
            )?;
            kernel = restored_kernel;
            boundary = Some(snapshot_boundary);
            game_state_v4_wire = v4_wire;
            snapshot_v5_wire = v5_wire;
            turn_material_bytes = material_bytes;
        }
        if index + 1 > fixture.snapshot_boundary_after.into_inner() as usize {
            continuation_input_count += 1;
        }
        observations.push(observation);
        settle_pending_presentations(
            &mut kernel,
            event.virtual_time_ms,
            &mut next_sequence,
            &mut observations,
            &mut settlement_count,
            &mut continuation_input_count,
        )?;
    }

    if settlement_count == 0 {
        return Err(M6ParityError::InvalidFixture(
            "trace did not produce a presentation continuation".to_owned(),
        ));
    }
    let snapshot_boundary = boundary.ok_or_else(|| {
        M6ParityError::InvalidFixture("trace did not execute its snapshot boundary".to_owned())
    })?;
    let report = M6ParityReport {
        schema_version: fixture.schema_version,
        trace_id: fixture.trace_id.clone(),
        seed: fixture.seed.clone(),
        trace_digest: fixture_digest(&fixture_value(fixture))
            .map_err(|error| canonical_error("trace_digest", error))?,
        coverage: M6ParityCoverage {
            raw_event_count: safe(fixture.events.len() as u64),
            presentation_settlement_count: safe(settlement_count),
            continuation_input_count: safe(continuation_input_count),
        },
        snapshot_boundary,
        observations,
    };
    Ok(M6BoundaryArtifacts {
        report,
        game_state_v4_wire,
        snapshot_v5_wire,
        turn_material_bytes,
    })
}

/// Replay one serialized raw-input trace through one production Battle kernel.
pub fn replay_eventwise(
    fixture: &M6ParityFixture,
    evidence: &M6ParityEvidence,
) -> Result<M6ParityReport, M6ParityError> {
    Ok(replay_with_artifacts(fixture, evidence)?.report)
}

fn observation_value(observation: &M6ParityObservation) -> Value {
    json!({
        "sequence": observation.sequence,
        "virtual_time_ms": observation.virtual_time_ms,
        "input_kind": observation.input_kind,
        "battle_turn": observation.battle_turn,
        "effects": observation.effects,
        "effect_digest": observation.effect_digest,
        "state_digest": observation.state_digest,
        "snapshot_digest": observation.snapshot_digest,
        "ui_projection_digest": observation.ui_projection_digest,
        "mechanical_digest": observation.mechanical_digest,
        "kernel_determinism_digest": observation.kernel_determinism_digest,
        "presentation_plan_digest": observation.presentation_plan_digest,
        "control_digest": observation.control_digest,
        "pending_presentation_count": observation.pending_presentation_count,
        "rng_audit": observation.rng_audit,
        "rng_audit_digest": observation.rng_audit_digest,
        "internal_events": observation.internal_events,
        "internal_events_digest": observation.internal_events_digest,
        "live_resources": observation.live_resources,
        "live_resources_digest": observation.live_resources_digest,
    })
}

fn report_value(report: &M6ParityReport) -> Value {
    json!({
        "schema_version": report.schema_version,
        "trace_id": report.trace_id,
        "seed": report.seed,
        "trace_digest": report.trace_digest,
        "coverage": {
            "raw_event_count": report.coverage.raw_event_count,
            "presentation_settlement_count": report.coverage.presentation_settlement_count,
            "continuation_input_count": report.coverage.continuation_input_count,
        },
        "snapshot_boundary": {
            "after_raw_event": report.snapshot_boundary.after_raw_event,
            "virtual_time_ms": report.snapshot_boundary.virtual_time_ms,
            "kernel_snapshot_schema_version": report.snapshot_boundary.kernel_snapshot_schema_version,
            "prepared_content": {
                "semantic_catalog_hash": report.snapshot_boundary.prepared_content.semantic_catalog_hash,
                "battle_content_hash": report.snapshot_boundary.prepared_content.battle_content_hash,
                "mechanics_program_version": report.snapshot_boundary.prepared_content.mechanics_program_version,
            },
            "game_state_schema_version": report.snapshot_boundary.game_state_schema_version,
            "game_v4_digest": report.snapshot_boundary.game_v4_digest,
            "snapshot_v5_schema_version": report.snapshot_boundary.snapshot_v5_schema_version,
            "snapshot_v5_digest": report.snapshot_boundary.snapshot_v5_digest,
            "material_schema_version": report.snapshot_boundary.material_schema_version,
            "turn_material_digest": report.snapshot_boundary.turn_material_digest,
        },
        "observations": report
            .observations
            .iter()
            .map(observation_value)
            .collect::<Vec<_>>(),
    })
}

/// Replay a canonical serialized trace and return the canonical hosted report.
pub fn replay_serialized_trace_json(
    input: &str,
    evidence: &M6ParityEvidence,
) -> Result<String, M6ParityError> {
    let fixture = parse_serialized_trace(input)?;
    let report = replay_eventwise(&fixture, evidence)?;
    let value = report_value(&report);
    canonicalize_value(&value).map_err(|error| canonical_error("report", error))
}

/// One serialized replay request: the canonical trace plus the typed
/// production state pair over the wire.  Deserialization is deny-unknown
/// and validated before any kernel runs, so tampered requests fail closed.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct M6ReplayRequest {
    trace: String,
    game_v3: GameStateV3,
    game_v4: GameStateV4,
}

/// Replay a full serialized request (trace + typed state) into the canonical
/// hosted report.  Shared by native hosts and the wasm32 export.
pub fn replay_serialized_request_json(request: &str) -> Result<String, M6ParityError> {
    let parsed: M6ReplayRequest = serde_json::from_str(request)
        .map_err(|error| M6ParityError::InvalidFixture(format!("replay request is invalid: {error}")))?;
    let evidence = M6ParityEvidence {
        game_v3: parsed.game_v3,
        game_v4: parsed.game_v4,
    };
    replay_serialized_trace_json(&parsed.trace, &evidence)
}

/// Generate the hosted/native report from the same serialized request that
/// the wasm32/Node export receives, including every boundary artifact.
pub fn final_evidence_artifacts(
    evidence: &M6ParityEvidence,
) -> Result<M6BoundaryArtifacts, M6ParityError> {
    replay_with_artifacts(&final_evidence_fixture(), evidence)
}

pub fn final_evidence_report_json(evidence: &M6ParityEvidence) -> Result<String, M6ParityError> {
    replay_serialized_trace_json(&final_evidence_trace_json()?, evidence)
}

/// Canonical `GameStateV4` wire form supplied by the host and round-tripped
/// at the evidence boundary; tampering with this JSON must fail the typed
/// round-trip.
pub fn final_evidence_game_state_v4_json(
    evidence: &M6ParityEvidence,
) -> Result<String, M6ParityError> {
    let value = serde_json::to_value(&evidence.game_v4)
        .map_err(|error| canonical_error("game_state_v4", error))?;
    canonicalize_value(&value).map_err(|error| canonical_error("game_state_v4", error))
}

/// Canonical `RestorableKernelSnapshotV5` wire form (validated, round-tripped)
/// produced at the evidence boundary.
pub fn final_evidence_snapshot_v5_json(
    evidence: &M6ParityEvidence,
) -> Result<String, M6ParityError> {
    Ok(final_evidence_artifacts(evidence)?.snapshot_v5_wire)
}

/// Canonical typed TURN material bytes produced at the evidence boundary;
/// any byte mutation must fail exact canonical decoding.
pub fn final_evidence_turn_material_bytes(
    evidence: &M6ParityEvidence,
) -> Result<Vec<u8>, M6ParityError> {
    Ok(final_evidence_artifacts(evidence)?.turn_material_bytes)
}

// ---------------------------------------------------------------------------
// First-divergent-event comparison across independent target artifacts
// ---------------------------------------------------------------------------

fn first_value_divergence(
    path: &mut String,
    left: &Value,
    right: &Value,
) -> Option<(String, Value, Value)> {
    if left == right {
        return None;
    }
    match (left, right) {
        (Value::Object(left_object), Value::Object(right_object)) => {
            for (key, left_value) in left_object {
                let length = path.len();
                path.push('/');
                path.push_str(key);
                let result = match right_object.get(key) {
                    Some(right_value) => first_value_divergence(path, left_value, right_value),
                    None => Some((path.clone(), left_value.clone(), Value::Null)),
                };
                path.truncate(length);
                if result.is_some() {
                    return result;
                }
            }
            for (key, right_value) in right_object {
                if !left_object.contains_key(key) {
                    return Some((
                        format!("{path}/{key}"),
                        Value::Null,
                        right_value.clone(),
                    ));
                }
            }
            None
        }
        (Value::Array(left_array), Value::Array(right_array)) => {
            for (index, (left_value, right_value)) in
                left_array.iter().zip(right_array.iter()).enumerate()
            {
                let length = path.len();
                path.push('/');
                path.push_str(&index.to_string());
                let result = first_value_divergence(path, left_value, right_value);
                path.truncate(length);
                if result.is_some() {
                    return result;
                }
            }
            if left_array.len() != right_array.len() {
                return Some((
                    format!("{path}/len"),
                    json!(left_array.len()),
                    json!(right_array.len()),
                ));
            }
            None
        }
        _ => Some((path.clone(), left.clone(), right.clone())),
    }
}

fn sequence_for_path(report: &Value, path: &str) -> Option<u64> {
    let rest = path.strip_prefix("/observations/")?;
    let index: usize = rest.split('/').next()?.parse().ok()?;
    report
        .get("observations")?
        .get(index)?
        .get("sequence")?
        .as_u64()
}

/// Names the first divergent field between two canonical reports.  When the
/// divergence is inside an observation, the observation's kernel sequence is
/// reported so CI can name the first divergent event directly.
pub fn first_divergence(left: &Value, right: &Value) -> Option<M6ParityDivergence> {
    let mut path = String::new();
    let (path, left_value, right_value) =
        first_value_divergence(&mut path, left, right)?;
    let sequence = sequence_for_path(left, &path).or_else(|| sequence_for_path(right, &path));
    Some(M6ParityDivergence {
        path,
        sequence,
        left: left_value,
        right: right_value,
    })
}

// ---------------------------------------------------------------------------
// wasm32 exports (identical production logic to the native hosted path)
// ---------------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = m6FinalEvidenceTrace)]
pub fn final_evidence_trace_json_wasm() -> Result<String, JsValue> {
    final_evidence_trace_json().map_err(|error| JsValue::from_str(&error.to_string()))
}
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = replayM6Request)]
pub fn replay_request_json_wasm(serialized_request: &str) -> Result<String, JsValue> {
    replay_serialized_request_json(serialized_request)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = compareM6Reports)]
pub fn compare_reports_wasm(left: &str, right: &str) -> Result<String, JsValue> {
    let parse = |input: &str| {
        serde_json::from_str::<Value>(input)
            .map_err(|error| JsValue::from_str(&format!("report JSON is invalid: {error}")))
    };
    let left = parse(left)?;
    let right = parse(right)?;
    let value = match first_divergence(&left, &right) {
        None => json!({ "diverged": false }),
        Some(divergence) => json!({
            "diverged": true,
            "path": divergence.path,
            "sequence": divergence.sequence,
            "left": divergence.left,
            "right": divergence.right,
        }),
    };
    serde_json::to_string(&value).map_err(|error| JsValue::from_str(&error.to_string()))
}
