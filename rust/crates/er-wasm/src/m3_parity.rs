//! Eventwise native/wasm32 evidence for the production M3 Battle kernel.
//!
//! This adapter deliberately owns no battle mechanics.  It constructs the
//! same `GameKernel::new_battle` boundary used by the native and wasm32
//! targets, feeds only raw physical events, and compares the observations
//! published after each drained external event.  A second kernel in the same
//! target is the deterministic control run; the wasm32 test invokes this
//! exact module through wasm-bindgen so the two targets consume one trace
//! definition rather than two hand-written drivers.

use std::fmt;
use std::sync::Arc;

use er_canonical::{canonicalize_value, content_digest};
use er_content::pack::{ContentPack, selected_content_pack};
use er_game::runtime::BATTLE_START_SCHEMA_VERSION;
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
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey,
    RawInputEvent, RunId, SafeU53, SeatId, SessionId, TimeClass,
};
use serde_json::json;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const M3_PARITY_FIXTURE_SCHEMA_VERSION: u32 = 1;
pub const M3_PARITY_TRACE_ID: &str = "m3-local-battle-raw-eventwise-v1";
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
    pub events: Vec<M3ParityEvent>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityObservation {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub effect_digest: String,
    pub state_digest: String,
    pub snapshot_digest: String,
    pub ui_projection_digest: String,
    pub live_resources: er_types::LiveResourceSnapshot,
    pub live_resources_digest: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityReport {
    pub schema_version: u32,
    pub trace_id: String,
    pub seed: String,
    pub observations: Vec<M3ParityObservation>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct M3ParityDivergence {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub field: &'static str,
    pub left: String,
    pub right: String,
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
    Canonical {
        field: &'static str,
        reason: String,
    },
    Divergence(M3ParityDivergence),
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
            Self::Canonical { field, reason } => {
                write!(formatter, "could not canonicalize M3 parity {field}: {reason}")
            }
            Self::Divergence(divergence) => write!(
                formatter,
                "M3 eventwise divergence at sequence {} virtual_time_ms {} in {}: left={} right={}",
                divergence.sequence,
                divergence.virtual_time_ms,
                divergence.field,
                divergence.left,
                divergence.right,
            ),
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
    let species = content
        .species
        .first()
        .ok_or_else(|| M3ParityError::Configuration("selected content has no species".to_owned()))?;
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
    let wave = WaveIndex::new(safe(1))
        .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let turn = TurnIndex::new(safe(1))
        .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)
        .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let enemy_command = BattleCommand::fight(
        pokemon_id(2),
        MoveSlotIndex::ZERO,
        BattleTargetSelection::implicit(),
    )
    .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let enemy_operation = scripted_enemy_command_operation_id(
        battle_id,
        wave,
        turn,
        enemy_slot,
        safe(0),
    )
    .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let enemy_script = ScriptedEnemyBattleCommandV1::new(
        enemy_operation,
        battle_id,
        wave,
        turn,
        safe(0),
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
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(safe(0), vec![enemy_script])
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

pub fn new_battle_kernel(seed: &str) -> Result<GameKernel, M3ParityError> {
    let content = selected_content_pack()
        .map_err(|error| M3ParityError::Configuration(error.to_string()))?;
    let config = battle_config(seed, &content)?;
    GameKernel::new_battle(config, protocol_config()?, Arc::new(content))
        .map_err(|error| M3ParityError::Configuration(error.to_string()))
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

/// The final-evidence trace is intentionally raw-key-only and ends at a
/// quiescent menu boundary.  It exercises the command root, Fight menu,
/// cancellation, and deterministic navigation without inventing oracle
/// mechanics or a fabricated expected digest.
pub fn final_evidence_fixture() -> M3ParityFixture {
    M3ParityFixture {
        schema_version: M3_PARITY_FIXTURE_SCHEMA_VERSION,
        trace_id: M3_PARITY_TRACE_ID.to_owned(),
        seed: M3_PARITY_SEED.to_owned(),
        events: vec![
            raw_event(0, key_down(PhysicalKey::Enter)),
            raw_event(1, key_up(PhysicalKey::Enter)),
            raw_event(2, key_down(PhysicalKey::Backspace)),
            raw_event(3, key_up(PhysicalKey::Backspace)),
            raw_event(4, key_down(PhysicalKey::ArrowDown)),
            raw_event(5, key_up(PhysicalKey::ArrowDown)),
            raw_event(6, key_down(PhysicalKey::ArrowUp)),
            raw_event(7, key_up(PhysicalKey::ArrowUp)),
        ],
    }
}

fn canonical_error(field: &'static str, error: impl fmt::Display) -> M3ParityError {
    M3ParityError::Canonical {
        field,
        reason: error.to_string(),
    }
}

fn observe(
    kernel: &GameKernel,
    sequence: SafeU53,
    virtual_time_ms: SafeU53,
    effects: &[KernelEffect],
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
    let live_resources_digest = content_digest(&live_resources)
        .map_err(|error| canonical_error("live_resources", error))?;
    Ok(M3ParityObservation {
        sequence,
        virtual_time_ms,
        effect_digest,
        state_digest: kernel.state_digest(),
        snapshot_digest,
        ui_projection_digest,
        live_resources_digest,
        live_resources,
    })
}

fn step_observation(
    kernel: &mut GameKernel,
    event: &M3ParityEvent,
    sequence: SafeU53,
    side: &'static str,
) -> Result<M3ParityObservation, M3ParityError> {
    let effects = kernel
        .step(event.input.clone())
        .map_err(|error| M3ParityError::Kernel {
            sequence,
            side,
            reason: error.to_string(),
        })?;
    observe(kernel, sequence, event.virtual_time_ms, &effects)
}

fn first_divergence(
    left: &M3ParityObservation,
    right: &M3ParityObservation,
) -> Option<M3ParityDivergence> {
    let fields = [
        ("effect_digest", &left.effect_digest, &right.effect_digest),
        ("state_digest", &left.state_digest, &right.state_digest),
        (
            "snapshot_digest",
            &left.snapshot_digest,
            &right.snapshot_digest,
        ),
        (
            "ui_projection_digest",
            &left.ui_projection_digest,
            &right.ui_projection_digest,
        ),
        (
            "live_resources_digest",
            &left.live_resources_digest,
            &right.live_resources_digest,
        ),
    ];
    for (field, left_value, right_value) in fields {
        if left_value != right_value {
            return Some(M3ParityDivergence {
                sequence: left.sequence,
                virtual_time_ms: left.virtual_time_ms,
                field,
                left: left_value.clone(),
                right: right_value.clone(),
            });
        }
    }
    if left.live_resources != right.live_resources {
        return Some(M3ParityDivergence {
            sequence: left.sequence,
            virtual_time_ms: left.virtual_time_ms,
            field: "live_resources",
            left: format!("{:?}", left.live_resources),
            right: format!("{:?}", right.live_resources),
        });
    }
    None
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

/// Replay the same raw-input trace through two independent production Battle
/// kernels and retain every post-event observation.  No expected digest is
/// checked into source: hosted/native and wasm32 runs establish equality from
/// the same deterministic trace and report the first field-level divergence.
pub fn replay_eventwise(
    fixture: &M3ParityFixture,
) -> Result<M3ParityReport, M3ParityError> {
    validate_fixture(fixture)?;
    let mut left = new_battle_kernel(&fixture.seed)?;
    let mut right = new_battle_kernel(&fixture.seed)?;
    let mut observations = Vec::with_capacity(fixture.events.len());
    for (index, event) in fixture.events.iter().enumerate() {
        let sequence = safe((index + 1) as u64);
        let left_observation = step_observation(&mut left, event, sequence, "left")?;
        let right_observation = step_observation(&mut right, event, sequence, "right")?;
        if let Some(divergence) = first_divergence(&left_observation, &right_observation) {
            return Err(M3ParityError::Divergence(divergence));
        }
        observations.push(left_observation);
    }
    Ok(M3ParityReport {
        schema_version: fixture.schema_version,
        trace_id: fixture.trace_id.clone(),
        seed: fixture.seed.clone(),
        observations,
    })
}

/// Canonical byte artifact consumed by the hosted native/wasm32 comparison.
/// Digests are produced by the kernel at runtime and are never frozen into a
/// source fixture as invented evidence.
pub fn final_evidence_report_json() -> Result<String, M3ParityError> {
    let report = replay_eventwise(&final_evidence_fixture())?;
    let observations = report
        .observations
        .iter()
        .map(|observation| {
            json!({
                "sequence": observation.sequence,
                "virtual_time_ms": observation.virtual_time_ms,
                "effect_digest": observation.effect_digest,
                "state_digest": observation.state_digest,
                "snapshot_digest": observation.snapshot_digest,
                "ui_projection_digest": observation.ui_projection_digest,
                "live_resources": observation.live_resources,
                "live_resources_digest": observation.live_resources_digest,
            })
        })
        .collect::<Vec<_>>();
    let value = json!({
        "schema_version": report.schema_version,
        "trace_id": report.trace_id,
        "seed": report.seed,
        "observations": observations,
    });
    canonicalize_value(&value).map_err(|error| canonical_error("report", error))
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = replayM3FinalEvidence)]
pub fn final_evidence_report_json_wasm() -> Result<String, JsValue> {
    final_evidence_report_json().map_err(|error| JsValue::from_str(&error.to_string()))
}
