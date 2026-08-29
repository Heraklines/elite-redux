//! Event-by-event native/Wasm parity evidence at the frozen `GameKernel` boundary.
//!
//! This module deliberately consumes the production kernel instead of modelling a
//! second protocol.  The fixture is a private evidence format layered over the
//! frozen [`er_types::KernelTrace`] DTO: it adds the input map and the full-width
//! seed required to construct the same kernel in native and wasm32/Node tests.

use std::fmt;

use er_canonical::{canonicalize, content_digest};
use er_kernel::{
    ControlMenuPlan, GameKernel, KernelConfig, MenuProposalPlan, ProtocolKernelConfig,
    ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityReplicaConfig, ProposalFingerprintInput, ProposalJson, ProposalLeaseConfig,
    RecoveryTransactionConfig, proposal_fingerprint,
};
use er_types::{
    ConnectionGeneration, FrameContext, InputMap, KERNEL_TRACE_VERSION, KernelEffect, KernelTrace,
    KernelTraceEvent, LiveResourceSnapshot, MembershipRevision, MenuOption, MenuOptionId,
    OperationId, RunId, SafeI53, SafeU53, SeatId, SessionId,
};
use serde_json::{Value, json};

pub const PARITY_FIXTURE_SCHEMA_VERSION: u32 = 1;
const PROTOCOL_FIXTURE_ID: &str = "replica-authority-v2-command-v1";
const PROTOCOL_PENDING_EVIDENCE: &str = "M2B-01 er-kernel protocol composition commit";
const PROTOCOL_SESSION_ID: &str = "m2-parity-session";
const PROTOCOL_RUN_ID: &str = "m2-parity-run";
const PROTOCOL_SEAT_MAP_ID: &str = "m2-parity-seat-map";
const PROTOCOL_OPERATION_ID: &str = "operation/m2-parity";
const PROTOCOL_OPTION_ID: &str = "move:first";
const PROTOCOL_CONTROL_ID: &str = "COMMAND_FRONTIER/e1/w1/t1/f0:s1:p42";
const PROTOCOL_PROPOSAL_LABEL: &str = "command";
const PROTOCOL_PROPOSAL_WIRE_JSON: &str =
    r#"{"surface":"command","option":"move:first","operation":"operation/m2-parity"}"#;

/// A decoded parity fixture.  This is an evidence-only wrapper and is not a
/// public or wire schema.
#[derive(Clone, Debug, PartialEq)]
pub struct ParityFixture {
    pub seed: u64,
    pub input_map: InputMap,
    pub trace: KernelTrace,
    pub protocol_config: Option<ProtocolKernelConfig>,
    pub expected_evidence_status: Option<String>,
}

/// The four per-event observations required by the M2 parity contract.  The
/// live-resource digest is retained in addition to the exact snapshot so a
/// mismatch cannot be hidden by comparing only a final digest.
#[derive(Clone, Debug, PartialEq)]
pub struct ParityObservation {
    pub effect_digest: String,
    pub state_digest: String,
    pub ui_digest: String,
    pub live_resources: LiveResourceSnapshot,
    pub live_resources_digest: String,
}

/// First-mismatch evidence, including the canonical full-u64 seed and virtual
/// time needed to reproduce the failure.
#[derive(Clone, Debug, PartialEq)]
pub struct ParityDivergence {
    pub seed: String,
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub expected_effect_digest: String,
    pub actual_effect_digest: String,
    pub expected_state_digest: String,
    pub actual_state_digest: String,
    pub expected_ui_digest: String,
    pub actual_ui_digest: String,
    pub expected_live_resources: LiveResourceSnapshot,
    pub actual_live_resources: LiveResourceSnapshot,
    pub expected_live_resources_digest: String,
    pub actual_live_resources_digest: String,
}

/// Successful replay output.  It contains every event observation so native
/// and wasm32/Node tests compare the complete trace, not merely the tail.
#[derive(Clone, Debug, PartialEq)]
pub struct ParityReplayReport {
    pub seed: String,
    pub replayed_events: u64,
    pub observations: Vec<ParityObservation>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ParityReplayError {
    InvalidFixture(String),
    PendingEvidence { dependency: String },
    Kernel { sequence: SafeU53, reason: String },
    Canonical { field: &'static str, reason: String },
    Divergence(Box<ParityDivergence>),
}

impl fmt::Display for ParityReplayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFixture(reason) => {
                write!(formatter, "invalid M2 parity fixture: {reason}")
            }
            Self::PendingEvidence { dependency } => write!(
                formatter,
                "M2 protocol parity evidence is pending dependency: {dependency}"
            ),
            Self::Kernel { sequence, reason } => {
                write!(
                    formatter,
                    "GameKernel rejected parity event {sequence}: {reason}"
                )
            }
            Self::Canonical { field, reason } => {
                write!(formatter, "could not canonicalize parity {field}: {reason}")
            }
            Self::Divergence(divergence) => write!(
                formatter,
                "M2 parity divergence at sequence {} seed {} virtual_time_ms {}: effect expected={} actual={}; state expected={} actual={}; ui expected={} actual={}; live digest expected={} actual={}; live snapshot expected={:?} actual={:?}",
                divergence.sequence,
                divergence.seed,
                divergence.virtual_time_ms,
                divergence.expected_effect_digest,
                divergence.actual_effect_digest,
                divergence.expected_state_digest,
                divergence.actual_state_digest,
                divergence.expected_ui_digest,
                divergence.actual_ui_digest,
                divergence.expected_live_resources_digest,
                divergence.actual_live_resources_digest,
                divergence.expected_live_resources,
                divergence.actual_live_resources,
            ),
        }
    }
}

impl std::error::Error for ParityReplayError {}

/// Parse the CR-0010 canonical unsigned decimal seed representation.
///
/// The input is deliberately a string rather than a JSON number.  The explicit
/// ASCII check rejects signs, padding, whitespace, exponent notation, empty
/// strings, and every non-decimal form before parsing to `u64`.
pub fn parse_seed_text(seed: &str) -> Result<u64, String> {
    let bytes = seed.as_bytes();
    let canonical_digits = seed == "0"
        || (!bytes.is_empty()
            && bytes[0].is_ascii_digit()
            && bytes[0] != b'0'
            && bytes.iter().all(|byte| byte.is_ascii_digit()));
    if !canonical_digits {
        return Err("seed must be a canonical unsigned decimal string".to_owned());
    }
    seed.parse::<u64>()
        .map_err(|_| "seed exceeds u64::MAX".to_owned())
}

/// Deserialize a seed from JSON while rejecting numeric JSON values.
pub fn deserialize_seed_json(input: &str) -> Result<u64, String> {
    let value: Value =
        serde_json::from_str(input).map_err(|error| format!("seed JSON is invalid: {error}"))?;
    let Some(seed) = value.as_str() else {
        return Err("seed must be a JSON string".to_owned());
    };
    parse_seed_text(seed)
}

/// Serialize a full-width seed as its canonical JSON string.
pub fn serialize_seed_json(seed: u64) -> String {
    format!("\"{seed}\"")
}

/// Decode and validate one frozen parity fixture.
pub fn parse_fixture(input: &str) -> Result<ParityFixture, ParityReplayError> {
    let root: Value = serde_json::from_str(input)
        .map_err(|error| ParityReplayError::InvalidFixture(error.to_string()))?;
    let schema_version = root
        .get("parity_fixture_schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            ParityReplayError::InvalidFixture(
                "parity_fixture_schema_version must be an integer".to_owned(),
            )
        })?;
    if schema_version != PARITY_FIXTURE_SCHEMA_VERSION as u64 {
        return Err(ParityReplayError::InvalidFixture(format!(
            "unsupported parity fixture schema version: {schema_version}"
        )));
    }

    let seed_value = root
        .get("seed")
        .ok_or_else(|| ParityReplayError::InvalidFixture("fixture is missing seed".to_owned()))?;
    let seed = seed_value
        .as_str()
        .ok_or_else(|| ParityReplayError::InvalidFixture("seed must be a JSON string".to_owned()))
        .and_then(|value| parse_seed_text(value).map_err(ParityReplayError::InvalidFixture))?;

    let input_map_value = root.get("input_map").ok_or_else(|| {
        ParityReplayError::InvalidFixture("fixture is missing input_map".to_owned())
    })?;
    let input_map: InputMap = serde_json::from_value(input_map_value.clone()).map_err(|error| {
        ParityReplayError::InvalidFixture(format!("input_map is invalid: {error}"))
    })?;

    let protocol_config = match root.get("protocol_fixture") {
        None => None,
        Some(value) => {
            let fixture_id = value.as_str().ok_or_else(|| {
                ParityReplayError::InvalidFixture("protocol_fixture must be a string".to_owned())
            })?;
            if fixture_id != PROTOCOL_FIXTURE_ID {
                return Err(ParityReplayError::InvalidFixture(format!(
                    "unsupported protocol fixture: {fixture_id}"
                )));
            }
            Some(protocol_config_for_fixture()?)
        }
    };
    let expected_evidence_status = root
        .get("expected_evidence_status")
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                ParityReplayError::InvalidFixture(
                    "expected_evidence_status must be a string".to_owned(),
                )
            })
        })
        .transpose()?;
    if expected_evidence_status.is_some() && protocol_config.is_none() {
        return Err(ParityReplayError::InvalidFixture(
            "expected_evidence_status requires protocol_fixture".to_owned(),
        ));
    }
    if let Some(status) = expected_evidence_status.as_deref()
        && status != PROTOCOL_PENDING_EVIDENCE
    {
        return Err(ParityReplayError::InvalidFixture(format!(
            "unsupported expected evidence status: {status}"
        )));
    }

    let trace: KernelTrace = serde_json::from_value(root).map_err(|error| {
        ParityReplayError::InvalidFixture(format!("KernelTrace is invalid: {error}"))
    })?;
    validate_trace(&trace)?;

    Ok(ParityFixture {
        seed,
        input_map,
        trace,
        protocol_config,
        expected_evidence_status,
    })
}

/// Replay a fixture through the production `GameKernel` and compare every
/// event against its frozen expected evidence.
pub fn replay_fixture(fixture: &ParityFixture) -> Result<ParityReplayReport, ParityReplayError> {
    let mut kernel = GameKernel::new(KernelConfig {
        input_map: fixture.input_map.clone(),
        initial_ui: fixture.trace.initial_snapshot.ui.clone(),
        protocol: fixture.protocol_config.clone(),
    });
    if let Some(dependency) = fixture.expected_evidence_status.as_ref() {
        return Err(ParityReplayError::PendingEvidence {
            dependency: dependency.clone(),
        });
    }
    if kernel.snapshot() != fixture.trace.initial_snapshot {
        return Err(ParityReplayError::InvalidFixture(
            "initial_snapshot does not match GameKernel construction".to_owned(),
        ));
    }

    let use_frozen_m2_state_digest_compatibility = fixture.protocol_config.is_some();
    let seed = fixture.seed.to_string();
    let mut observations = Vec::with_capacity(fixture.trace.events.len());
    for event in &fixture.trace.events {
        let effects =
            kernel
                .step(event.input.clone())
                .map_err(|error| ParityReplayError::Kernel {
                    sequence: event.sequence,
                    reason: error.to_string(),
                })?;
        let actual = observe(&kernel, &effects, use_frozen_m2_state_digest_compatibility)?;
        let expected_live_resources_digest = live_resources_digest(&event.expected_live_resources)?;
        if !matches_expected(event, &actual, &expected_live_resources_digest) {
            return Err(ParityReplayError::Divergence(Box::new(ParityDivergence {
                seed: seed.clone(),
                sequence: event.sequence,
                virtual_time_ms: event.virtual_time_ms,
                expected_effect_digest: event.expected_effect_digest.clone(),
                actual_effect_digest: actual.effect_digest.clone(),
                expected_state_digest: event.expected_state_digest.clone(),
                actual_state_digest: actual.state_digest.clone(),
                expected_ui_digest: event.expected_ui_digest.clone(),
                actual_ui_digest: actual.ui_digest.clone(),
                expected_live_resources: event.expected_live_resources.clone(),
                actual_live_resources: actual.live_resources.clone(),
                expected_live_resources_digest,
                actual_live_resources_digest: actual.live_resources_digest.clone(),
            })));
        }
        observations.push(actual);
    }

    Ok(ParityReplayReport {
        seed,
        replayed_events: observations.len() as u64,
        observations,
    })
}

/// Parse, replay, and return a canonical JSON report suitable for comparing a
/// native run with a wasm32/Node run.
pub fn replay_fixture_json(input: &str) -> Result<String, ParityReplayError> {
    let fixture = parse_fixture(input)?;
    let report = replay_fixture(&fixture)?;
    canonicalize(&report_value(&report)).map_err(|error| ParityReplayError::Canonical {
        field: "replay_report",
        reason: error.to_string(),
    })
}

fn validate_trace(trace: &KernelTrace) -> Result<(), ParityReplayError> {
    if trace.header.trace_version != KERNEL_TRACE_VERSION {
        return Err(ParityReplayError::InvalidFixture(format!(
            "trace_version must be {KERNEL_TRACE_VERSION}, got {}",
            trace.header.trace_version
        )));
    }
    if trace.events.is_empty() {
        return Err(ParityReplayError::InvalidFixture(
            "parity trace must contain at least one event".to_owned(),
        ));
    }
    let mut previous_time = None;
    for (index, event) in trace.events.iter().enumerate() {
        if event.sequence.get() != index as u64 {
            return Err(ParityReplayError::InvalidFixture(format!(
                "event sequence {} is not contiguous at index {index}",
                event.sequence
            )));
        }
        if previous_time.is_some_and(|time| event.virtual_time_ms < time) {
            return Err(ParityReplayError::InvalidFixture(format!(
                "virtual time regressed at sequence {}",
                event.sequence
            )));
        }
        previous_time = Some(event.virtual_time_ms);
    }
    Ok(())
}

fn protocol_config_for_fixture() -> Result<ProtocolKernelConfig, ParityReplayError> {
    let safe = |value: u64| {
        SafeU53::new(value).map_err(|error| {
            ParityReplayError::InvalidFixture(format!(
                "protocol fixture value is not SafeU53: {error}"
            ))
        })
    };
    let session_id = SessionId::new(PROTOCOL_SESSION_ID).map_err(|error| {
        ParityReplayError::InvalidFixture(format!("protocol session ID is invalid: {error}"))
    })?;
    let run_id = RunId::new(PROTOCOL_RUN_ID).map_err(|error| {
        ParityReplayError::InvalidFixture(format!("protocol run ID is invalid: {error}"))
    })?;
    let operation_id = OperationId::new(PROTOCOL_OPERATION_ID).map_err(|error| {
        ParityReplayError::InvalidFixture(format!("protocol operation ID is invalid: {error}"))
    })?;
    let option_id = MenuOptionId::new(PROTOCOL_OPTION_ID).map_err(|error| {
        ParityReplayError::InvalidFixture(format!("protocol option ID is invalid: {error}"))
    })?;
    let proposal_wire = ProposalJson::new(PROTOCOL_PROPOSAL_WIRE_JSON).map_err(|error| {
        ParityReplayError::InvalidFixture(format!(
            "protocol proposal wire JSON is invalid: {error}"
        ))
    })?;
    let proposal_payload: Value =
        serde_json::from_str(PROTOCOL_PROPOSAL_WIRE_JSON).map_err(|error| {
            ParityReplayError::InvalidFixture(format!(
                "protocol proposal payload is invalid: {error}"
            ))
        })?;
    let proposal_identity = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(0)?,
        label: PROTOCOL_PROPOSAL_LABEL.to_owned(),
        choice: SafeI53::ZERO,
        wire: Some(proposal_wire),
        reward_surface: None,
    })
    .map_err(|error| {
        ParityReplayError::InvalidFixture(format!(
            "protocol proposal fingerprint is invalid: {error}"
        ))
    })?;
    let local_context = FrameContext {
        session_id,
        run_id,
        session_epoch: safe(1)?,
        seat_map_id: PROTOCOL_SEAT_MAP_ID.to_owned(),
        membership_revision: MembershipRevision::new(safe(1)?),
        sender_seat_id: SeatId::new(safe(1)?),
        authority_seat_id: SeatId::new(safe(0)?),
        connection_generation: ConnectionGeneration::new(safe(1)?),
    };
    let menu = ControlMenuPlan::Command {
        control_id: PROTOCOL_CONTROL_ID.to_owned(),
        owner_seat_id: SeatId::new(safe(1)?),
        operation_id: operation_id.clone(),
        field_index: safe(0)?,
        options: vec![MenuOption {
            id: option_id.clone(),
            label_key: "menu.move.first".to_owned(),
            enabled: true,
            visible: true,
        }],
        proposals: vec![MenuProposalPlan {
            option_id,
            fingerprint: proposal_identity,
            payload: proposal_payload,
        }],
        cancel: er_types::CancelPolicy::Disabled,
    };
    let proposal_leases = ProposalLeaseConfig {
        owner_prefix: "authority-v2:proposal:".to_owned(),
        retry_initial_ms: safe(250)?,
        retry_maximum_ms: safe(5_000)?,
        absolute_ceiling_ms: safe(1_200_000)?,
    };
    let recovery = RecoveryTransactionConfig {
        local_context: local_context.clone(),
        request_timeout_ms: safe(1_000)?,
        control_timeout_ms: safe(1_000)?,
        pacing_ms: safe(250)?,
        timer_owner_id: "m2-parity-recovery".to_owned(),
    };
    Ok(ProtocolKernelConfig {
        role: ProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: local_context,
                authority_seat_id: SeatId::new(safe(0)?),
                authority_connection_generation: ConnectionGeneration::new(safe(1)?),
            },
            proposal_leases,
            recovery,
        },
        menu_plans: vec![menu],
    })
}

fn observe(
    kernel: &GameKernel,
    effects: &[KernelEffect],
    use_frozen_m2_state_digest_compatibility: bool,
) -> Result<ParityObservation, ParityReplayError> {
    Ok(ParityObservation {
        effect_digest: effects_digest(effects)?,
        state_digest: state_digest_for_evidence(kernel, use_frozen_m2_state_digest_compatibility)?,
        ui_digest: ui_digest(kernel)?,
        live_resources: kernel.live_resources(),
        live_resources_digest: live_resources_digest(&kernel.live_resources())?,
    })
}

fn state_digest_for_evidence(
    kernel: &GameKernel,
    use_frozen_m2_state_digest_compatibility: bool,
) -> Result<String, ParityReplayError> {
    if !use_frozen_m2_state_digest_compatibility {
        return Ok(kernel.state_digest());
    }

    let mut snapshot = kernel.snapshot();
    let state = snapshot
        .state
        .as_object_mut()
        .ok_or_else(|| ParityReplayError::Canonical {
            field: "state",
            reason: "frozen M2 compatibility projection requires an object state".to_owned(),
        })?;
    state.remove("legacyPresentations");
    content_digest(&snapshot).map_err(|error| ParityReplayError::Canonical {
        field: "state",
        reason: error.to_string(),
    })
}

fn effects_digest(effects: &[KernelEffect]) -> Result<String, ParityReplayError> {
    content_digest(&effects).map_err(|error| ParityReplayError::Canonical {
        field: "effects",
        reason: error.to_string(),
    })
}

fn ui_digest(kernel: &GameKernel) -> Result<String, ParityReplayError> {
    content_digest(&kernel.ui_view()).map_err(|error| ParityReplayError::Canonical {
        field: "ui",
        reason: error.to_string(),
    })
}

fn live_resources_digest(
    live_resources: &LiveResourceSnapshot,
) -> Result<String, ParityReplayError> {
    content_digest(live_resources).map_err(|error| ParityReplayError::Canonical {
        field: "live_resources",
        reason: error.to_string(),
    })
}

fn matches_expected(
    event: &KernelTraceEvent,
    actual: &ParityObservation,
    expected_live_resources_digest: &str,
) -> bool {
    actual.effect_digest == event.expected_effect_digest
        && actual.state_digest == event.expected_state_digest
        && actual.ui_digest == event.expected_ui_digest
        && actual.live_resources == event.expected_live_resources
        && actual.live_resources_digest == expected_live_resources_digest
}

fn report_value(report: &ParityReplayReport) -> Value {
    json!({
        "seed": report.seed,
        "replayed_events": report.replayed_events,
        "observations": report.observations.iter().map(observation_value).collect::<Vec<_>>(),
    })
}

fn observation_value(observation: &ParityObservation) -> Value {
    json!({
        "effect_digest": observation.effect_digest,
        "state_digest": observation.state_digest,
        "ui_digest": observation.ui_digest,
        "live_resources": observation.live_resources,
        "live_resources_digest": observation.live_resources_digest,
    })
}

/// Convert divergence evidence to a stable JSON object for CI diagnostics.
pub fn divergence_value(divergence: &ParityDivergence) -> Value {
    json!({
        "seed": divergence.seed,
        "sequence": divergence.sequence,
        "virtual_time_ms": divergence.virtual_time_ms,
        "expected_effect_digest": divergence.expected_effect_digest,
        "actual_effect_digest": divergence.actual_effect_digest,
        "expected_state_digest": divergence.expected_state_digest,
        "actual_state_digest": divergence.actual_state_digest,
        "expected_ui_digest": divergence.expected_ui_digest,
        "actual_ui_digest": divergence.actual_ui_digest,
        "expected_live_resources": divergence.expected_live_resources,
        "actual_live_resources": divergence.actual_live_resources,
        "expected_live_resources_digest": divergence.expected_live_resources_digest,
        "actual_live_resources_digest": divergence.actual_live_resources_digest,
    })
}
