//! Eventwise native/wasm32 evidence for the production M3 Battle kernel.
//!
//! This adapter deliberately owns no battle mechanics.  It constructs the
//! same `GameKernel::new_battle` boundary used by the native and wasm32
//! targets, feeds one canonical serialized raw-input trace, and records the
//! observations published after each drained external event.  The report also
//! crosses a real V2 snapshot/destroy/restore boundary and settles the
//! presentation events emitted by the production kernel.  Hosted CI compares
//! the native artifact with the wasm32/Node artifact from that same trace.

use std::fmt;
use std::sync::Arc;

use er_canonical::{canonicalize_value, content_digest, fixture_digest};
use er_content::pack::{ContentPack, selected_content_pack};
use er_game::internal_event::InternalEventKind;
use er_game::runtime::BATTLE_START_SCHEMA_VERSION;
use er_kernel::snapshot::{RestorableKernelSnapshotV2, RngDraw};
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_protocol::{AuthorityLogConfig, BackoffPolicy};
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    BattleId, BattleSide, FieldSlot, GameModeId, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex,
    WaveIndex,
};
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent,
    RunId, SafeU53, SeatId, SessionId, TimeClass,
};
use serde_json::{Value, json};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const M3_PARITY_FIXTURE_SCHEMA_VERSION: u32 = 2;
pub const M3_PARITY_TRACE_ID: &str = "m3-local-battle-native-wasm-v2";
pub const M3_PARITY_SEED: &str = "1469598103934665603";

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityEvent {
    pub virtual_time_ms: SafeU53,
    pub input: KernelInput,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityFixture {
    pub schema_version: u32,
    pub trace_id: String,
    pub seed: String,
    pub snapshot_boundary_after: SafeU53,
    pub events: Vec<M3ParityEvent>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityObservation {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input_kind: String,
    pub battle_turn: TurnIndex,
    pub effect_digest: String,
    pub state_digest: String,
    pub snapshot_digest: String,
    pub ui_projection_digest: String,
    pub rng_audit: Vec<RngDraw>,
    pub rng_audit_digest: String,
    pub internal_events: Vec<String>,
    pub internal_events_digest: String,
    pub live_resources: er_types::LiveResourceSnapshot,
    pub live_resources_digest: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityCoverage {
    pub raw_event_count: SafeU53,
    pub presentation_settlement_count: SafeU53,
    pub continuation_input_count: SafeU53,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParitySnapshotBoundary {
    pub after_raw_event: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub snapshot_schema_version: u32,
    pub snapshot_digest: String,
    pub snapshot_bytes_digest: String,
    pub restored_snapshot_digest: String,
    pub pending_presentation_count: SafeU53,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityReport {
    pub schema_version: u32,
    pub trace_id: String,
    pub seed: String,
    pub trace_digest: String,
    pub coverage: M3ParityCoverage,
    pub snapshot_boundary: M3ParitySnapshotBoundary,
    pub observations: Vec<M3ParityObservation>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum M3ParityError {
    InvalidFixture(String),
    Configuration(String),
    Kernel {
        sequence: SafeU53,
        side: &'static str,
        reason: String,
    },
    Snapshot {
        stage: &'static str,
        reason: String,
    },
    Canonical {
        field: &'static str,
        reason: String,
    },
}

impl fmt::Display for M3ParityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFixture(reason) => {
                write!(formatter, "invalid M3 parity fixture: {reason}")
            }
            Self::Configuration(reason) => {
                write!(formatter, "M3 battle configuration failed: {reason}")
            }
            Self::Kernel {
                sequence,
                side,
                reason,
            } => write!(
                formatter,
                "M3 {side} kernel rejected event {sequence}: {reason}"
            ),
            Self::Snapshot { stage, reason } => {
                write!(formatter, "M3 snapshot {stage} failed: {reason}")
            }
            Self::Canonical { field, reason } => {
                write!(
                    formatter,
                    "could not canonicalize M3 parity {field}: {reason}"
                )
            }
        }
    }
}

impl std::error::Error for M3ParityError {}

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn pokemon_id(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}

fn single_party_pokemon(
    content: &ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
) -> Result<PokemonState, M3ParityError> {
    let species = content.species.first().ok_or_else(|| {
        M3ParityError::Configuration("selected content has no species".to_owned())
    })?;
    let move_id = content
        .moves
        .first()
        .ok_or_else(|| M3ParityError::Configuration("selected content has no moves".to_owned()))?
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
            kind: er_types::battle_model::StatusKind::None,
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
            active: er_types::battle_ids::AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )
    .map_err(|error| M3ParityError::Configuration(error.to_string()))
}

fn battle_config(seed: &str, content: &ContentPack) -> Result<BattleGameConfig, M3ParityError> {
    let battle_id = BattleId::new(safe(1));
    let wave =
        WaveIndex::new(safe(1)).map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let turn =
        TurnIndex::new(safe(1)).map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)
        .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let enemy_command = BattleCommand::fight(
        pokemon_id(2),
        MoveSlotIndex::ZERO,
        BattleTargetSelection::implicit(),
    )
    .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let enemy_operation =
        scripted_enemy_command_operation_id(battle_id, wave, turn, enemy_slot, safe(0))
            .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
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
    .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let next_turn =
        TurnIndex::new(safe(2)).map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let next_enemy_operation =
        scripted_enemy_command_operation_id(battle_id, wave, next_turn, enemy_slot, safe(1))
            .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
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
    .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
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
    .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
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
        .map_err(|error| M3ParityError::Configuration(error.to_string()))?,
    })
}

fn protocol_config() -> Result<BattleProtocolConfig, M3ParityError> {
    let context = FrameContext {
        session_id: SessionId::new("m3-final-evidence-session")
            .map_err(|error| M3ParityError::Configuration(error.to_string()))?,
        run_id: RunId::new("m3-final-evidence-run")
            .map_err(|error| M3ParityError::Configuration(error.to_string()))?,
        session_epoch: safe(1),
        seat_map_id: "m3-final-evidence-single-seat".to_owned(),
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
                owner_id: "m3-final-evidence-authority".to_owned(),
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

fn selected_content() -> Result<Arc<ContentPack>, M3ParityError> {
    selected_content_pack()
        .map(Arc::new)
        .map_err(|error| M3ParityError::Configuration(error.to_string()))
}

fn new_battle_kernel_with_content(
    seed: &str,
    content: Arc<ContentPack>,
) -> Result<GameKernel, M3ParityError> {
    let config = battle_config(seed, content.as_ref())?;
    GameKernel::new_battle(config, protocol_config()?, content)
        .map_err(|error| M3ParityError::Configuration(error.to_string()))
}

pub fn new_battle_kernel(seed: &str) -> Result<GameKernel, M3ParityError> {
    new_battle_kernel_with_content(seed, selected_content()?)
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

fn raw_event(virtual_time_ms: u64, event: RawInputEvent) -> M3ParityEvent {
    M3ParityEvent {
        virtual_time_ms: safe(virtual_time_ms),
        input: KernelInput::RawInput {
            seat: seat(1),
            event,
        },
    }
}

/// The final-evidence trace is intentionally raw-key-only.  It crosses the
/// command root, selects a real move, resolves a real turn, and then continues
/// the held physical input after the serialized snapshot boundary. Presentation
/// settlement is derived only from the production kernel's emitted event IDs;
/// no command or mechanics oracle is embedded in this adapter.
pub fn final_evidence_fixture() -> M3ParityFixture {
    M3ParityFixture {
        schema_version: M3_PARITY_FIXTURE_SCHEMA_VERSION,
        trace_id: M3_PARITY_TRACE_ID.to_owned(),
        seed: M3_PARITY_SEED.to_owned(),
        snapshot_boundary_after: safe(3),
        events: vec![
            raw_event(0, key_down(PhysicalKey::Enter)),
            raw_event(1, key_up(PhysicalKey::Enter)),
            raw_event(2, key_down(PhysicalKey::Enter)),
            raw_event(3, key_up(PhysicalKey::Enter)),
        ],
    }
}

fn canonical_error(field: &'static str, error: impl fmt::Display) -> M3ParityError {
    M3ParityError::Canonical {
        field,
        reason: error.to_string(),
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

fn observe(
    kernel: &GameKernel,
    sequence: SafeU53,
    virtual_time_ms: SafeU53,
    input_kind: &str,
    effects: &[KernelEffect],
    rng_audit: Vec<RngDraw>,
    internal_events: Vec<InternalEventKind>,
) -> Result<M3ParityObservation, M3ParityError> {
    let projection = kernel
        .battle_ui_projection()
        .ok_or_else(|| M3ParityError::InvalidFixture("kernel is not in Battle mode".to_owned()))?;
    let live_resources = kernel.live_resources();
    let effect_digest =
        content_digest(&effects).map_err(|error| canonical_error("effects", error))?;
    let snapshot = kernel.snapshot();
    let snapshot_digest =
        content_digest(&snapshot).map_err(|error| canonical_error("snapshot", error))?;
    let ui_projection_digest = content_digest(projection)
        .map_err(|error| canonical_error("battle_ui_projection", error))?;
    let rng_audit_digest =
        content_digest(&rng_audit).map_err(|error| canonical_error("rng_audit", error))?;
    let internal_events = internal_events
        .into_iter()
        .map(internal_event_kind_name)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let internal_events_digest = content_digest(&internal_events)
        .map_err(|error| canonical_error("internal_events", error))?;
    let live_resources_digest = content_digest(&live_resources)
        .map_err(|error| canonical_error("live_resources", error))?;
    Ok(M3ParityObservation {
        sequence,
        virtual_time_ms,
        input_kind: input_kind.to_owned(),
        battle_turn: projection.turn,
        effect_digest,
        state_digest: kernel.state_digest(),
        snapshot_digest,
        ui_projection_digest,
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
    event: &M3ParityEvent,
    sequence: SafeU53,
) -> Result<M3ParityObservation, M3ParityError> {
    let effects = kernel
        .step(event.input.clone())
        .map_err(|error| M3ParityError::Kernel {
            sequence,
            side: "trace",
            reason: error.to_string(),
        })?;
    let (rng_audit, internal_events) = kernel.m3_trace_audit();
    observe(
        kernel,
        sequence,
        event.virtual_time_ms,
        "RAW_INPUT",
        &effects,
        rng_audit,
        internal_events,
    )
}

fn validate_fixture(fixture: &M3ParityFixture) -> Result<(), M3ParityError> {
    if fixture.schema_version != M3_PARITY_FIXTURE_SCHEMA_VERSION {
        return Err(M3ParityError::InvalidFixture(format!(
            "schema version {} is not {}",
            fixture.schema_version, M3_PARITY_FIXTURE_SCHEMA_VERSION
        )));
    }
    if fixture.trace_id != M3_PARITY_TRACE_ID {
        return Err(M3ParityError::InvalidFixture(format!(
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
        return Err(M3ParityError::InvalidFixture(
            "seed must be a canonical unsigned decimal string".to_owned(),
        ));
    }
    if fixture.events.is_empty() {
        return Err(M3ParityError::InvalidFixture(
            "eventwise trace must not be empty".to_owned(),
        ));
    }
    let boundary = fixture.snapshot_boundary_after.into_inner() as usize;
    if boundary == 0 || boundary >= fixture.events.len() {
        return Err(M3ParityError::InvalidFixture(format!(
            "snapshot boundary {} must be before the final event",
            fixture.snapshot_boundary_after
        )));
    }
    let mut previous_time = SafeU53::ZERO;
    for (index, event) in fixture.events.iter().enumerate() {
        if !matches!(&event.input, KernelInput::RawInput { .. }) {
            return Err(M3ParityError::InvalidFixture(format!(
                "event {index} must be a raw physical input"
            )));
        }
        if index > 0 && event.virtual_time_ms < previous_time {
            return Err(M3ParityError::InvalidFixture(format!(
                "virtual time regressed at event {index}"
            )));
        }
        previous_time = event.virtual_time_ms;
    }
    Ok(())
}

fn fixture_value(fixture: &M3ParityFixture) -> Value {
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

fn canonical_fixture_json(fixture: &M3ParityFixture) -> Result<String, M3ParityError> {
    let value = fixture_value(fixture);
    canonicalize_value(&value).map_err(|error| canonical_error("serialized_trace", error))
}

/// Serialize the one deterministic production input trace consumed by both
/// hosted native and wasm32/Node evidence runs.
pub fn final_evidence_trace_json() -> Result<String, M3ParityError> {
    canonical_fixture_json(&final_evidence_fixture())
}

/// Parse the exact serialized trace artifact before any kernel is constructed.
pub fn parse_serialized_trace(input: &str) -> Result<M3ParityFixture, M3ParityError> {
    let value: Value = serde_json::from_str(input).map_err(|error| {
        M3ParityError::InvalidFixture(format!("trace JSON is invalid: {error}"))
    })?;
    let object = value.as_object().ok_or_else(|| {
        M3ParityError::InvalidFixture("serialized trace root must be an object".to_owned())
    })?;
    let schema_version = object
        .get("schema_version")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            M3ParityError::InvalidFixture("trace schema_version must be a u32".to_owned())
        })?;
    let trace_id = object
        .get("trace_id")
        .and_then(Value::as_str)
        .ok_or_else(|| M3ParityError::InvalidFixture("trace trace_id must be a string".to_owned()))?
        .to_owned();
    let seed = object
        .get("seed")
        .and_then(Value::as_str)
        .ok_or_else(|| M3ParityError::InvalidFixture("trace seed must be a string".to_owned()))?
        .to_owned();
    let snapshot_boundary_after: SafeU53 =
        serde_json::from_value(object.get("snapshot_boundary_after").cloned().ok_or_else(
            || M3ParityError::InvalidFixture("trace snapshot_boundary_after is missing".to_owned()),
        )?)
        .map_err(|error| {
            M3ParityError::InvalidFixture(format!(
                "trace snapshot_boundary_after is invalid: {error}"
            ))
        })?;
    let events = object
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| M3ParityError::InvalidFixture("trace events must be an array".to_owned()))?
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let event = value.as_object().ok_or_else(|| {
                M3ParityError::InvalidFixture(format!("trace event {index} must be an object"))
            })?;
            let virtual_time_ms: SafeU53 =
                serde_json::from_value(event.get("virtual_time_ms").cloned().ok_or_else(|| {
                    M3ParityError::InvalidFixture(format!(
                        "trace event {index} is missing virtual_time_ms"
                    ))
                })?)
                .map_err(|error| {
                    M3ParityError::InvalidFixture(format!(
                        "trace event {index} virtual_time_ms is invalid: {error}"
                    ))
                })?;
            let input: KernelInput =
                serde_json::from_value(event.get("input").cloned().ok_or_else(|| {
                    M3ParityError::InvalidFixture(format!("trace event {index} is missing input"))
                })?)
                .map_err(|error| {
                    M3ParityError::InvalidFixture(format!(
                        "trace event {index} input is invalid: {error}"
                    ))
                })?;
            Ok(M3ParityEvent {
                virtual_time_ms,
                input,
            })
        })
        .collect::<Result<Vec<_>, M3ParityError>>()?;
    let fixture = M3ParityFixture {
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
        return Err(M3ParityError::InvalidFixture(
            "serialized trace is not canonical".to_owned(),
        ));
    }
    Ok(fixture)
}

fn snapshot_error(stage: &'static str, error: impl fmt::Display) -> M3ParityError {
    M3ParityError::Snapshot {
        stage,
        reason: error.to_string(),
    }
}

fn restore_from_v2_snapshot(
    kernel: GameKernel,
    content: &Arc<ContentPack>,
    after_raw_event: SafeU53,
    virtual_time_ms: SafeU53,
) -> Result<(GameKernel, M3ParitySnapshotBoundary), M3ParityError> {
    let snapshot = kernel
        .snapshot_v2()
        .map_err(|error| snapshot_error("capture", error))?;
    let pending_presentation_count = snapshot.pending_presentations.pending_barrier_ids.len();
    if pending_presentation_count == 0 {
        return Err(M3ParityError::InvalidFixture(
            "snapshot boundary did not retain a presentation continuation".to_owned(),
        ));
    }
    let snapshot_digest =
        content_digest(&snapshot).map_err(|error| snapshot_error("digest", error))?;
    let snapshot_bytes_digest =
        fixture_digest(&snapshot).map_err(|error| snapshot_error("bytes digest", error))?;
    let snapshot_value =
        serde_json::to_value(&snapshot).map_err(|error| snapshot_error("serialize", error))?;
    let snapshot_wire = canonicalize_value(&snapshot_value)
        .map_err(|error| snapshot_error("canonicalize", error))?;
    let decoded: RestorableKernelSnapshotV2 = serde_json::from_str(&snapshot_wire)
        .map_err(|error| snapshot_error("deserialize", error))?;

    // This explicit drop is the production ownership boundary: continuation
    // must come from the V2 wire snapshot, never from a cloned live kernel.
    drop(kernel);
    let restored = GameKernel::from_snapshot(decoded, Arc::clone(content))
        .map_err(|error| snapshot_error("restore", error))?;
    let restored_snapshot = restored
        .snapshot_v2()
        .map_err(|error| snapshot_error("restored capture", error))?;
    if restored_snapshot != snapshot {
        return Err(M3ParityError::Snapshot {
            stage: "restore",
            reason: "restored V2 snapshot differs before continuation".to_owned(),
        });
    }
    let restored_snapshot_digest = content_digest(&restored_snapshot)
        .map_err(|error| snapshot_error("restored digest", error))?;
    let pending_presentation_count = u64::try_from(pending_presentation_count)
        .map_err(|error| snapshot_error("pending presentation count", error))?;
    Ok((
        restored,
        M3ParitySnapshotBoundary {
            after_raw_event,
            virtual_time_ms,
            snapshot_schema_version: snapshot.schema_version,
            snapshot_digest,
            snapshot_bytes_digest,
            restored_snapshot_digest,
            pending_presentation_count: safe(pending_presentation_count),
        },
    ))
}

fn settle_pending_presentations(
    kernel: &mut GameKernel,
    virtual_time_ms: SafeU53,
    next_sequence: &mut u64,
    observations: &mut Vec<M3ParityObservation>,
    settlement_count: &mut u64,
    continuation_input_count: &mut u64,
) -> Result<(), M3ParityError> {
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
                .map_err(|error| M3ParityError::Kernel {
                    sequence,
                    side: "presentation",
                    reason: error.to_string(),
                })?;
            let (rng_audit, internal_events) = kernel.m3_trace_audit();
            observations.push(observe(
                kernel,
                sequence,
                virtual_time_ms,
                "BATTLE_PRESENTATION_OUTCOME",
                &effects,
                rng_audit,
                internal_events,
            )?);
            *settlement_count = (*settlement_count).saturating_add(1);
            *continuation_input_count = (*continuation_input_count).saturating_add(1);
        }
    }
}

/// Replay one serialized raw-input trace through one production Battle kernel.
/// The report contains the real kernel observations, presentation outcomes,
/// and an explicit V2 snapshot destroy/restore continuation boundary.  Native
/// and wasm32/Node runs emit this same canonical report shape; CI compares the
/// two independent target artifacts.
pub fn replay_eventwise(fixture: &M3ParityFixture) -> Result<M3ParityReport, M3ParityError> {
    validate_fixture(fixture)?;
    let content = selected_content()?;
    let mut kernel = new_battle_kernel_with_content(&fixture.seed, Arc::clone(&content))?;
    let mut observations = Vec::with_capacity(fixture.events.len() + 4);
    let mut next_sequence = 1_u64;
    let mut settlement_count = 0_u64;
    let mut continuation_input_count = 0_u64;
    let mut boundary = None;
    for (index, event) in fixture.events.iter().enumerate() {
        let sequence = safe(next_sequence);
        next_sequence = next_sequence.saturating_add(1);
        let observation = step_observation(&mut kernel, event, sequence)?;
        if index + 1 == fixture.snapshot_boundary_after.into_inner() as usize {
            let (restored, snapshot_boundary) = restore_from_v2_snapshot(
                kernel,
                &content,
                safe((index + 1) as u64),
                event.virtual_time_ms,
            )?;
            kernel = restored;
            boundary = Some(snapshot_boundary);
        }
        if index + 1 > fixture.snapshot_boundary_after.into_inner() as usize {
            continuation_input_count = continuation_input_count.saturating_add(1);
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
        return Err(M3ParityError::InvalidFixture(
            "trace did not produce a presentation continuation".to_owned(),
        ));
    }
    let snapshot_boundary = boundary.ok_or_else(|| {
        M3ParityError::InvalidFixture("trace did not execute its snapshot boundary".to_owned())
    })?;
    Ok(M3ParityReport {
        schema_version: fixture.schema_version,
        trace_id: fixture.trace_id.clone(),
        seed: fixture.seed.clone(),
        trace_digest: fixture_digest(&fixture_value(fixture))
            .map_err(|error| canonical_error("trace_digest", error))?,
        coverage: M3ParityCoverage {
            raw_event_count: safe(fixture.events.len() as u64),
            presentation_settlement_count: safe(settlement_count),
            continuation_input_count: safe(continuation_input_count),
        },
        snapshot_boundary,
        observations,
    })
}

fn observation_value(observation: &M3ParityObservation) -> Value {
    json!({
        "sequence": observation.sequence,
        "virtual_time_ms": observation.virtual_time_ms,
        "input_kind": observation.input_kind,
        "battle_turn": observation.battle_turn,
        "effect_digest": observation.effect_digest,
        "state_digest": observation.state_digest,
        "snapshot_digest": observation.snapshot_digest,
        "ui_projection_digest": observation.ui_projection_digest,
        "rng_audit": observation.rng_audit,
        "rng_audit_digest": observation.rng_audit_digest,
        "internal_events": observation.internal_events,
        "internal_events_digest": observation.internal_events_digest,
        "live_resources": observation.live_resources,
        "live_resources_digest": observation.live_resources_digest,
    })
}

fn report_value(report: &M3ParityReport) -> Value {
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
            "snapshot_schema_version": report.snapshot_boundary.snapshot_schema_version,
            "snapshot_digest": report.snapshot_boundary.snapshot_digest,
            "snapshot_bytes_digest": report.snapshot_boundary.snapshot_bytes_digest,
            "restored_snapshot_digest": report.snapshot_boundary.restored_snapshot_digest,
            "pending_presentation_count": report.snapshot_boundary.pending_presentation_count,
        },
        "observations": report
            .observations
            .iter()
            .map(observation_value)
            .collect::<Vec<_>>(),
    })
}

/// Replay a canonical serialized trace and return the canonical hosted report.
pub fn replay_serialized_trace_json(input: &str) -> Result<String, M3ParityError> {
    let fixture = parse_serialized_trace(input)?;
    let report = replay_eventwise(&fixture)?;
    let value = report_value(&report);
    canonicalize_value(&value).map_err(|error| canonical_error("report", error))
}

/// Generate the hosted/native report from the same serialized trace that the
/// wasm32/Node export receives.
pub fn final_evidence_report_json() -> Result<String, M3ParityError> {
    replay_serialized_trace_json(&final_evidence_trace_json()?)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = replayM3FinalEvidence)]
pub fn final_evidence_report_json_wasm(serialized_trace: &str) -> Result<String, JsValue> {
    replay_serialized_trace_json(serialized_trace)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
