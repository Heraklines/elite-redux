//! Authority V2 wire DTOs and kernel environment boundary values.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _, ser::Error as _};
use serde_json::Value;
use thiserror::Error;

use crate::battle_ids::BattlePresentationEventId;
use crate::battle_ui::{
    BattlePresentationEvent, BattleUiProjection, PresentationSettlementOutcome,
};
use crate::{
    ConnectionGeneration, GameButton, MembershipRevision, OperationId, PresentationEventId,
    RawInputEvent, Revision, RunId, SafeU53, SeatId, SessionId, TimerId, UiState, UiViewModel,
};

pub const PROTOCOL_VERSION: &str = "er-coop-48";
pub const FRAME_PROTOCOL_VERSION: u32 = 2;
pub const TAIL_PROOF_MAX_SOURCE_REVISIONS: usize = 512;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameContext {
    pub session_id: SessionId,
    pub run_id: RunId,
    pub session_epoch: SafeU53,
    pub seat_map_id: String,
    pub membership_revision: MembershipRevision,
    pub sender_seat_id: SeatId,
    pub authority_seat_id: SeatId,
    pub connection_generation: ConnectionGeneration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AuthorityEntryKind {
    #[serde(rename = "TURN_COMMIT")]
    TurnCommit,
    #[serde(rename = "REPLACEMENT_COMMIT")]
    ReplacementCommit,
    #[serde(rename = "INTERACTION_COMMIT")]
    InteractionCommit,
    #[serde(rename = "CONTROL_COMMIT")]
    ControlCommit,
    #[serde(rename = "WAVE_ADVANCE")]
    WaveAdvance,
    #[serde(rename = "TERMINAL_COMMIT")]
    TerminalCommit,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Material {
    pub digest: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandControlTarget {
    pub owner_seat_id: SeatId,
    pub pokemon_id: SafeU53,
    pub field_index: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementControlAddress {
    pub operation_id: OperationId,
    pub owner_seat_id: SeatId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub occurrence: SafeU53,
    pub field_index: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFrontierControl {
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub commands: Vec<CommandControlTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementControl {
    pub operation_id: OperationId,
    pub owner_seat_id: SeatId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub occurrence: SafeU53,
    pub field_index: SafeU53,
    pub remaining: Vec<ReplacementControlAddress>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSuccessor {
    pub operation_kinds: Vec<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub operation_ids: Option<Vec<OperationId>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedInteractionControl {
    pub operation_id: OperationId,
    pub owner_seat_id: SeatId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub surface_class: String,
    pub operation_kind: String,
    pub successor: InteractionSuccessor,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionControlAddress {
    pub surface_class: String,
    pub operation_kind: String,
    pub wave: SafeU53,
    pub turn: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlAddress {
    pub material_kind: String,
    pub wave: SafeU53,
    pub turn: SafeU53,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub operation_id: Option<OperationId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitSuccessorControl {
    pub after_operation_id: OperationId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub allowed_kinds: Vec<AuthorityEntryKind>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub allowed_interaction_addresses: Option<Vec<InteractionControlAddress>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub allowed_control_addresses: Option<Vec<ControlAddress>>,
    pub allow_next_wave_start: bool,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub expected_operation_id: Option<OperationId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalControl {
    pub terminal_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NextControl {
    CommandFrontier(CommandFrontierControl),
    Replacement(ReplacementControl),
    SharedInteraction(SharedInteractionControl),
    AwaitSuccessor(AwaitSuccessorControl),
    Terminal(TerminalControl),
}

/// Private flattened wire representation for [`NextControl`].
///
/// The public enum keeps the frozen tuple-variant shape, while the Authority V2
/// wire puts each variant's fields beside its uppercase `kind` discriminator.
/// Serde's derived internally tagged representation cannot flatten tuple
/// variants, so this helper owns that wire-only translation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
enum NextControlWire {
    #[serde(rename = "COMMAND_FRONTIER")]
    CommandFrontier {
        epoch: SafeU53,
        wave: SafeU53,
        turn: SafeU53,
        commands: Vec<CommandControlTarget>,
    },
    #[serde(rename = "REPLACEMENT")]
    Replacement {
        #[serde(rename = "operationId")]
        operation_id: OperationId,
        #[serde(rename = "ownerSeatId")]
        owner_seat_id: SeatId,
        epoch: SafeU53,
        wave: SafeU53,
        turn: SafeU53,
        occurrence: SafeU53,
        #[serde(rename = "fieldIndex")]
        field_index: SafeU53,
        remaining: Vec<ReplacementControlAddress>,
    },
    #[serde(rename = "SHARED_INTERACTION")]
    SharedInteraction {
        #[serde(rename = "operationId")]
        operation_id: OperationId,
        #[serde(rename = "ownerSeatId")]
        owner_seat_id: SeatId,
        epoch: SafeU53,
        wave: SafeU53,
        turn: SafeU53,
        #[serde(rename = "surfaceClass")]
        surface_class: String,
        #[serde(rename = "operationKind")]
        operation_kind: String,
        successor: InteractionSuccessor,
    },
    #[serde(rename = "AWAIT_SUCCESSOR")]
    AwaitSuccessor {
        #[serde(rename = "afterOperationId")]
        after_operation_id: OperationId,
        epoch: SafeU53,
        wave: SafeU53,
        turn: SafeU53,
        #[serde(rename = "allowedKinds")]
        allowed_kinds: Vec<AuthorityEntryKind>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_optional_non_null",
            rename = "allowedInteractionAddresses"
        )]
        allowed_interaction_addresses: Option<Vec<InteractionControlAddress>>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_optional_non_null",
            rename = "allowedControlAddresses"
        )]
        allowed_control_addresses: Option<Vec<ControlAddress>>,
        #[serde(rename = "allowNextWaveStart")]
        allow_next_wave_start: bool,
        #[serde(
            deserialize_with = "deserialize_required_nullable",
            rename = "expectedOperationId"
        )]
        expected_operation_id: Option<OperationId>,
    },
    #[serde(rename = "TERMINAL")]
    Terminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
    },
}

impl Serialize for NextControl {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let wire = match self {
            Self::CommandFrontier(control) => NextControlWire::CommandFrontier {
                epoch: control.epoch,
                wave: control.wave,
                turn: control.turn,
                commands: control.commands.clone(),
            },
            Self::Replacement(control) => NextControlWire::Replacement {
                operation_id: control.operation_id.clone(),
                owner_seat_id: control.owner_seat_id,
                epoch: control.epoch,
                wave: control.wave,
                turn: control.turn,
                occurrence: control.occurrence,
                field_index: control.field_index,
                remaining: control.remaining.clone(),
            },
            Self::SharedInteraction(control) => NextControlWire::SharedInteraction {
                operation_id: control.operation_id.clone(),
                owner_seat_id: control.owner_seat_id,
                epoch: control.epoch,
                wave: control.wave,
                turn: control.turn,
                surface_class: control.surface_class.clone(),
                operation_kind: control.operation_kind.clone(),
                successor: control.successor.clone(),
            },
            Self::AwaitSuccessor(control) => NextControlWire::AwaitSuccessor {
                after_operation_id: control.after_operation_id.clone(),
                epoch: control.epoch,
                wave: control.wave,
                turn: control.turn,
                allowed_kinds: control.allowed_kinds.clone(),
                allowed_interaction_addresses: control.allowed_interaction_addresses.clone(),
                allowed_control_addresses: control.allowed_control_addresses.clone(),
                allow_next_wave_start: control.allow_next_wave_start,
                expected_operation_id: control.expected_operation_id.clone(),
            },
            Self::Terminal(control) => NextControlWire::Terminal {
                terminal_id: control.terminal_id.clone(),
            },
        };
        wire.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for NextControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = NextControlWire::deserialize(deserializer)?;
        Ok(match wire {
            NextControlWire::CommandFrontier {
                epoch,
                wave,
                turn,
                commands,
            } => Self::CommandFrontier(CommandFrontierControl {
                epoch,
                wave,
                turn,
                commands,
            }),
            NextControlWire::Replacement {
                operation_id,
                owner_seat_id,
                epoch,
                wave,
                turn,
                occurrence,
                field_index,
                remaining,
            } => Self::Replacement(ReplacementControl {
                operation_id,
                owner_seat_id,
                epoch,
                wave,
                turn,
                occurrence,
                field_index,
                remaining,
            }),
            NextControlWire::SharedInteraction {
                operation_id,
                owner_seat_id,
                epoch,
                wave,
                turn,
                surface_class,
                operation_kind,
                successor,
            } => Self::SharedInteraction(SharedInteractionControl {
                operation_id,
                owner_seat_id,
                epoch,
                wave,
                turn,
                surface_class,
                operation_kind,
                successor,
            }),
            NextControlWire::AwaitSuccessor {
                after_operation_id,
                epoch,
                wave,
                turn,
                allowed_kinds,
                allowed_interaction_addresses,
                allowed_control_addresses,
                allow_next_wave_start,
                expected_operation_id,
            } => Self::AwaitSuccessor(AwaitSuccessorControl {
                after_operation_id,
                epoch,
                wave,
                turn,
                allowed_kinds,
                allowed_interaction_addresses,
                allowed_control_addresses,
                allow_next_wave_start,
                expected_operation_id,
            }),
            NextControlWire::Terminal { terminal_id } => {
                Self::Terminal(TerminalControl { terminal_id })
            }
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityEntry {
    pub context: FrameContext,
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub material: Material,
    pub next_control: NextControl,
    pub subsumes: Vec<Revision>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AckStage {
    #[serde(rename = "admitted")]
    Admitted,
    #[serde(rename = "materialApplied")]
    MaterialApplied,
    #[serde(rename = "controlInstalled")]
    ControlInstalled,
    #[serde(rename = "presentationSettled")]
    PresentationSettled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityReceipt {
    pub context: FrameContext,
    pub revision: Revision,
    pub operation_id: OperationId,
    pub stage: AckStage,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub control_id: Option<String>,
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum FrameType {
    #[serde(rename = "authorityEntry")]
    AuthorityEntry,
    #[serde(rename = "authorityReceipt")]
    AuthorityReceipt,
    #[serde(rename = "tailRequest")]
    TailRequest,
    #[serde(rename = "tailProof")]
    TailProof,
    #[serde(rename = "recoveryRequest")]
    RecoveryRequest,
    #[serde(rename = "recoveryBundle")]
    RecoveryBundle,
    #[serde(rename = "recoveryApplied")]
    RecoveryApplied,
    #[serde(rename = "terminal")]
    Terminal,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NetworkFrame {
    /// The wire protocol version. Valid frames must use [`FRAME_PROTOCOL_VERSION`].
    pub version: u32,
    pub frame_type: FrameType,
    pub context: FrameContext,
    pub body: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct NetworkFrameWire {
    #[serde(rename = "v")]
    version: u32,
    #[serde(rename = "t")]
    frame_type: FrameType,
    #[serde(rename = "ctx")]
    context: FrameContext,
    #[serde(rename = "body")]
    body: Value,
}

impl Serialize for NetworkFrame {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.version != FRAME_PROTOCOL_VERSION {
            return Err(S::Error::custom(format_args!(
                "unsupported frame protocol version: {}",
                self.version
            )));
        }
        NetworkFrameWire {
            version: self.version,
            frame_type: self.frame_type,
            context: self.context.clone(),
            body: self.body.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for NetworkFrame {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = NetworkFrameWire::deserialize(deserializer)?;
        if wire.version != FRAME_PROTOCOL_VERSION {
            return Err(D::Error::custom(format_args!(
                "unsupported frame protocol version: {}",
                wire.version
            )));
        }
        Ok(Self {
            version: wire.version,
            frame_type: wire.frame_type,
            context: wire.context,
            body: wire.body,
        })
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerOwner {
    pub owner_id: String,
    pub address: String,
    pub reason: String,
}

impl TimerOwner {
    pub fn new(
        owner_id: impl Into<String>,
        address: impl Into<String>,
        reason: impl Into<String>,
    ) -> Result<Self, TimerOwnerError> {
        let owner = Self {
            owner_id: owner_id.into(),
            address: address.into(),
            reason: reason.into(),
        };
        validate_timer_owner_field("ownerId", &owner.owner_id)?;
        validate_timer_owner_field("address", &owner.address)?;
        validate_timer_owner_field("reason", &owner.reason)?;
        Ok(owner)
    }

    pub fn input_repeat(button: GameButton) -> Self {
        Self {
            owner_id: "input-router".to_owned(),
            address: format!("input-repeat/{button:?}"),
            reason: "input-repeat".to_owned(),
        }
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TimerOwnerError {
    #[error("timer owner {field} must not be empty")]
    Empty { field: &'static str },
}

fn validate_timer_owner_field(field: &'static str, value: &str) -> Result<(), TimerOwnerError> {
    if value.is_empty() {
        return Err(TimerOwnerError::Empty { field });
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeClass {
    Connected,
    Recovery,
    Renderer,
    HumanInput,
    Absolute,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationOutcome {
    Settled,
    Cancelled,
    Failed { reason: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransportState {
    Disconnected,
    Connecting,
    Connected,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StorageResult {
    Loaded {
        #[serde(deserialize_with = "deserialize_required_nullable")]
        value: Option<Value>,
    },
    Persisted,
    Failed {
        reason: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StorageRequest {
    pub request_id: SafeU53,
    pub key: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub value: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PresentationEvent {
    pub event_id: PresentationEventId,
    pub event_kind: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TerminalState {
    pub terminal_id: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelSnapshot {
    pub ui: UiState,
    pub state: Value,
}

impl Default for KernelSnapshot {
    fn default() -> Self {
        Self {
            ui: UiState::default(),
            state: Value::Object(serde_json::Map::new()),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct LiveResourceSnapshot {
    pub timers: BTreeSet<TimerId>,
    pub presentations: BTreeSet<PresentationEventId>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub battle_presentations: BTreeSet<BattlePresentationEventId>,
    pub storage_requests: BTreeSet<SafeU53>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub delivery_leases: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub proposal_leases: BTreeSet<OperationId>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub recovery_transactions: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub waits: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub retained_revisions: BTreeSet<Revision>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub controls: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub network_packets: BTreeSet<SafeU53>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KernelInput {
    RawInput {
        seat: SeatId,
        event: RawInputEvent,
    },
    NetworkFrame {
        endpoint: SeatId,
        frame: NetworkFrame,
    },
    RawNetworkFrame {
        endpoint: SeatId,
        frame: crate::RawFrame,
    },
    ProposalReceived {
        endpoint: SeatId,
        proposal: crate::ProposalMessage,
    },
    TimerFired {
        endpoint: SeatId,
        timer_id: TimerId,
    },
    PresentationSettled {
        endpoint: SeatId,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    },
    BattlePresentationOutcome {
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    },
    TransportChanged {
        endpoint: SeatId,
        state: TransportState,
        generation: ConnectionGeneration,
    },
    StorageResult {
        endpoint: SeatId,
        request_id: SafeU53,
        result: StorageResult,
    },
    MaterialApplied {
        endpoint: SeatId,
        revision: Revision,
        outcome: crate::MaterialApplicationOutcome,
    },
    ControlProjected {
        endpoint: SeatId,
        revision: Revision,
        outcome: crate::ControlProjectionOutcome,
    },
    Suspend {
        endpoint: SeatId,
    },
    Resume {
        endpoint: SeatId,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KernelEffect {
    SendFrame {
        from: SeatId,
        frame: NetworkFrame,
    },
    SendProposal {
        proposal: crate::ProposalMessage,
    },
    ScheduleTimer {
        endpoint: SeatId,
        timer_id: TimerId,
        owner: TimerOwner,
        delay_ms: SafeU53,
        time_class: TimeClass,
    },
    CancelTimer {
        endpoint: SeatId,
        timer_id: TimerId,
    },
    UiChanged {
        endpoint: SeatId,
        view: UiViewModel,
    },
    BattleUiChanged {
        endpoint: SeatId,
        projection: BattleUiProjection,
    },
    UiIntent {
        endpoint: SeatId,
        intent: crate::UiIntent,
    },
    Present {
        endpoint: SeatId,
        event: PresentationEvent,
    },
    PresentBattle {
        endpoint: SeatId,
        event: BattlePresentationEvent,
    },
    Persist {
        endpoint: SeatId,
        request: StorageRequest,
    },
    ApplyAuthorityMaterial {
        endpoint: SeatId,
        revision: Revision,
        operation_id: OperationId,
        material: Material,
    },
    ProjectAuthorityControl {
        endpoint: SeatId,
        revision: Revision,
        operation_id: OperationId,
        control: NextControl,
    },
    EnterSharedTerminal {
        terminal: TerminalState,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const AUTHORITY_ENTRY_KINDS_FIXTURE: &str =
        include_str!("../../../../test/kernel-fixtures/v1/authority-entry-kinds.json");
    const NEXT_CONTROLS_FIXTURE: &str =
        include_str!("../../../../test/kernel-fixtures/v1/next-controls.json");
    const PROTOCOL_FIXTURE: &str =
        include_str!("../../../../test/kernel-fixtures/v1/protocol.json");
    const RECEIPTS_FIXTURE: &str =
        include_str!("../../../../test/kernel-fixtures/v1/receipts.json");

    fn fixture_payload(raw: &str) -> Option<Value> {
        serde_json::from_str::<Value>(raw)
            .ok()?
            .get("payload")
            .cloned()
    }

    fn fixture_by_id(payload: &Value, id: &str) -> Option<Value> {
        payload
            .get("fixtures")
            .and_then(Value::as_array)?
            .iter()
            .find(|fixture| fixture.get("id").and_then(Value::as_str) == Some(id))
            .cloned()
    }

    fn round_trip<T>(value: &Value) -> Option<Value>
    where
        T: serde::Serialize + serde::de::DeserializeOwned,
    {
        let decoded = serde_json::from_value::<T>(value.clone()).ok()?;
        serde_json::to_value(decoded).ok()
    }

    #[test]
    fn authority_entry_kind_fixture_matches_all_wire_tags() {
        let payload = fixture_payload(AUTHORITY_ENTRY_KINDS_FIXTURE);
        assert!(payload.is_some());
        let Some(payload) = payload else {
            return;
        };
        let kinds = payload.get("entry_kinds").and_then(Value::as_array);
        assert!(kinds.is_some());
        let Some(kinds) = kinds else {
            return;
        };
        assert_eq!(kinds.len(), 6);
        for kind in kinds {
            let decoded = serde_json::from_value::<AuthorityEntryKind>(kind.clone());
            assert!(decoded.is_ok());
            let encoded = decoded
                .ok()
                .and_then(|value| serde_json::to_value(value).ok());
            assert_eq!(encoded, Some(kind.clone()));
        }
    }

    #[test]
    fn next_control_fixtures_round_trip_as_flattened_variants() {
        let payload = fixture_payload(NEXT_CONTROLS_FIXTURE);
        assert!(payload.is_some());
        let Some(payload) = payload else {
            return;
        };
        let fixtures = payload.get("fixtures").and_then(Value::as_array);
        assert!(fixtures.is_some());
        let Some(fixtures) = fixtures else {
            return;
        };
        assert_eq!(fixtures.len(), 5);
        for fixture in fixtures {
            let control = fixture.get("control");
            assert!(control.is_some());
            let Some(control) = control else {
                continue;
            };
            let encoded = round_trip::<NextControl>(control);
            assert_eq!(encoded, Some(control.clone()));
        }
    }

    #[test]
    fn nullable_and_optional_control_fields_follow_oracle_presence_rules() {
        let payload = fixture_payload(NEXT_CONTROLS_FIXTURE);
        assert!(payload.is_some());
        let Some(payload) = payload else {
            return;
        };
        let shared = fixture_by_id(&payload, "shared-interaction")
            .and_then(|fixture| fixture.get("control").cloned());
        let await_successor = fixture_by_id(&payload, "await-successor")
            .and_then(|fixture| fixture.get("control").cloned());
        assert!(shared.is_some());
        assert!(await_successor.is_some());
        let (Some(shared), Some(await_successor)) = (shared, await_successor) else {
            return;
        };

        let mut missing_operation_ids = shared.clone();
        let removed = missing_operation_ids
            .get_mut("successor")
            .and_then(Value::as_object_mut)
            .and_then(|successor| successor.remove("operationIds"));
        assert!(removed.is_some());
        assert!(serde_json::from_value::<NextControl>(missing_operation_ids).is_err());
        assert!(serde_json::from_value::<NextControl>(shared.clone()).is_ok());

        let mut explicit_operation_ids = shared.clone();
        let inserted = explicit_operation_ids
            .get_mut("successor")
            .and_then(Value::as_object_mut)
            .map(|successor| {
                successor.insert(
                    "operationIds".to_owned(),
                    json!(["interaction/e1/w2/t2/ability"]),
                )
            });
        assert!(inserted.is_some());
        assert_eq!(
            round_trip::<NextControl>(&explicit_operation_ids),
            Some(explicit_operation_ids.clone())
        );

        let mut omitted_addresses = await_successor.clone();
        let removed_interaction_addresses = omitted_addresses
            .as_object_mut()
            .and_then(|control| control.remove("allowedInteractionAddresses"));
        let removed_control_addresses = omitted_addresses
            .as_object_mut()
            .and_then(|control| control.remove("allowedControlAddresses"));
        assert!(removed_interaction_addresses.is_some());
        assert!(removed_control_addresses.is_some());
        let encoded_omitted = round_trip::<NextControl>(&omitted_addresses);
        assert!(encoded_omitted.is_some());
        if let Some(encoded_omitted) = encoded_omitted {
            let object = encoded_omitted.as_object();
            assert!(object.is_some());
            if let Some(object) = object {
                assert!(!object.contains_key("allowedInteractionAddresses"));
                assert!(!object.contains_key("allowedControlAddresses"));
            }
        }

        for field in ["allowedInteractionAddresses", "allowedControlAddresses"] {
            let mut explicit_null = await_successor.clone();
            let inserted = explicit_null
                .as_object_mut()
                .map(|control| control.insert(field.to_owned(), Value::Null));
            assert!(inserted.is_some());
            assert!(serde_json::from_value::<NextControl>(explicit_null).is_err());
        }

        let mut missing_expected_operation_id = await_successor.clone();
        let removed_expected = missing_expected_operation_id
            .as_object_mut()
            .and_then(|control| control.remove("expectedOperationId"));
        assert!(removed_expected.is_some());
        assert!(serde_json::from_value::<NextControl>(missing_expected_operation_id).is_err());
        assert!(serde_json::from_value::<NextControl>(await_successor.clone()).is_ok());

        let mut missing_control_address_operation_id = await_successor;
        let removed_address_operation_id = missing_control_address_operation_id
            .get_mut("allowedControlAddresses")
            .and_then(Value::as_array_mut)
            .and_then(|addresses| addresses.first_mut())
            .and_then(Value::as_object_mut)
            .and_then(|address| address.remove("operationId"));
        assert!(removed_address_operation_id.is_some());
        assert!(
            serde_json::from_value::<NextControl>(missing_control_address_operation_id).is_err()
        );
    }

    #[test]
    fn material_payload_is_required_but_accepts_json_null() {
        let with_null_payload = json!({"digest": "fixture-digest", "payload": null});
        let decoded = serde_json::from_value::<Material>(with_null_payload.clone());
        assert!(decoded.is_ok());
        let encoded = decoded
            .ok()
            .and_then(|value| serde_json::to_value(value).ok());
        assert_eq!(encoded, Some(with_null_payload));

        let without_payload = json!({"digest": "fixture-digest"});
        assert!(serde_json::from_value::<Material>(without_payload).is_err());
    }

    #[test]
    fn authority_entry_fixture_shape_round_trips_context_material_and_successor() {
        let receipts_payload = fixture_payload(RECEIPTS_FIXTURE);
        let controls_payload = fixture_payload(NEXT_CONTROLS_FIXTURE);
        assert!(receipts_payload.is_some());
        assert!(controls_payload.is_some());
        let (Some(receipts_payload), Some(controls_payload)) = (receipts_payload, controls_payload)
        else {
            return;
        };
        let context = fixture_by_id(&receipts_payload, "admitted")
            .and_then(|fixture| fixture.get("receipt").cloned())
            .and_then(|receipt| receipt.get("context").cloned());
        let next_control = fixture_by_id(&controls_payload, "command-frontier")
            .and_then(|fixture| fixture.get("control").cloned());
        assert!(context.is_some());
        assert!(next_control.is_some());
        let (Some(context), Some(next_control)) = (context, next_control) else {
            return;
        };
        let entry = json!({
            "context": context,
            "revision": 1,
            "operationId": "turn/e1/w2/t1",
            "kind": "TURN_COMMIT",
            "material": {"digest": "fixture-digest", "payload": null},
            "nextControl": next_control,
            "subsumes": []
        });
        assert_eq!(round_trip::<AuthorityEntry>(&entry), Some(entry.clone()));

        let mut missing_payload = entry;
        let removed = missing_payload
            .get_mut("material")
            .and_then(Value::as_object_mut)
            .and_then(|material| material.remove("payload"));
        assert!(removed.is_some());
        assert!(serde_json::from_value::<AuthorityEntry>(missing_payload).is_err());
    }

    #[test]
    fn receipt_fixture_preserves_omitted_and_non_null_control_ids() {
        let payload = fixture_payload(RECEIPTS_FIXTURE);
        assert!(payload.is_some());
        let Some(payload) = payload else {
            return;
        };
        let fixtures = payload.get("fixtures").and_then(Value::as_array);
        assert!(fixtures.is_some());
        let Some(fixtures) = fixtures else {
            return;
        };
        assert_eq!(fixtures.len(), 4);
        for fixture in fixtures {
            let receipt = fixture.get("receipt");
            assert!(receipt.is_some());
            let Some(receipt) = receipt else {
                continue;
            };
            let encoded = round_trip::<AuthorityReceipt>(receipt);
            assert_eq!(encoded, Some(receipt.clone()));
            if fixture.get("id").and_then(Value::as_str) == Some("admitted") {
                assert!(
                    encoded
                        .and_then(|value| value.get("controlId").cloned())
                        .is_none()
                );
            }
        }

        let control_installed = fixture_by_id(&payload, "controlInstalled")
            .and_then(|fixture| fixture.get("receipt").cloned());
        assert!(control_installed.is_some());
        let Some(control_installed) = control_installed else {
            return;
        };
        let mut explicit_null = control_installed;
        let inserted = explicit_null
            .as_object_mut()
            .map(|receipt| receipt.insert("controlId".to_owned(), Value::Null));
        assert!(inserted.is_some());
        assert!(serde_json::from_value::<AuthorityReceipt>(explicit_null).is_err());
    }

    #[test]
    fn protocol_fixture_round_trips_exact_envelopes_and_opaque_body_json() {
        let receipts_payload = fixture_payload(RECEIPTS_FIXTURE);
        assert!(receipts_payload.is_some());
        let Some(receipts_payload) = receipts_payload else {
            return;
        };
        let context = fixture_by_id(&receipts_payload, "admitted")
            .and_then(|fixture| fixture.get("receipt").cloned())
            .and_then(|receipt| receipt.get("context").cloned());
        assert!(context.is_some());
        let Some(context) = context else {
            return;
        };
        let frame = json!({
            "v": FRAME_PROTOCOL_VERSION,
            "t": "authorityReceipt",
            "ctx": context,
            "body": {
                "futureM2": {
                    "nullable": null,
                    "numbers": [0, SafeU53::MAX.get()],
                    "nested": [{"opaque": true}, []]
                }
            }
        });
        let encoded = round_trip::<NetworkFrame>(&frame);
        assert_eq!(encoded, Some(frame.clone()));
        let Some(encoded) = encoded else {
            return;
        };
        let object = encoded.as_object();
        assert!(object.is_some());
        if let Some(object) = object {
            assert_eq!(object.len(), 4);
            for field in ["v", "t", "ctx", "body"] {
                assert!(object.contains_key(field));
            }
        }

        let protocol_payload = fixture_payload(PROTOCOL_FIXTURE);
        assert!(protocol_payload.is_some());
        let Some(protocol_payload) = protocol_payload else {
            return;
        };
        let frame_types = protocol_payload
            .get("authority_frame")
            .and_then(|authority_frame| authority_frame.get("frame_types"))
            .and_then(Value::as_array);
        assert!(frame_types.is_some());
        let Some(frame_types) = frame_types else {
            return;
        };
        assert_eq!(frame_types.len(), 8);
        for frame_type in frame_types {
            let mut frame_with_type = frame.clone();
            let inserted = frame_with_type
                .as_object_mut()
                .map(|value| value.insert("t".to_owned(), frame_type.clone()));
            assert!(inserted.is_some());
            assert!(serde_json::from_value::<NetworkFrame>(frame_with_type).is_ok());
        }

        let mut wrong_version = frame;
        let inserted = wrong_version
            .as_object_mut()
            .map(|value| value.insert("v".to_owned(), json!(FRAME_PROTOCOL_VERSION - 1)));
        assert!(inserted.is_some());
        assert!(serde_json::from_value::<NetworkFrame>(wrong_version).is_err());

        let mut missing_context = json!({
            "v": FRAME_PROTOCOL_VERSION,
            "t": "authorityReceipt",
            "body": null
        });
        let inserted = missing_context
            .as_object_mut()
            .map(|value| value.insert("body".to_owned(), Value::Null));
        assert!(inserted.is_some());
        assert!(serde_json::from_value::<NetworkFrame>(missing_context).is_err());
    }

    #[test]
    fn safe_u53_coordinates_reject_negative_fractional_and_oversized_values() {
        let payload = fixture_payload(NEXT_CONTROLS_FIXTURE);
        assert!(payload.is_some());
        let Some(payload) = payload else {
            return;
        };
        let command = fixture_by_id(&payload, "command-frontier")
            .and_then(|fixture| fixture.get("control").cloned());
        assert!(command.is_some());
        let Some(command) = command else {
            return;
        };
        for invalid_coordinate in [json!(-1), json!(1.5), json!(SafeU53::MAX.get() + 1)] {
            let mut invalid = command.clone();
            let inserted = invalid
                .as_object_mut()
                .map(|control| control.insert("epoch".to_owned(), invalid_coordinate));
            assert!(inserted.is_some());
            assert!(serde_json::from_value::<NextControl>(invalid).is_err());
        }
    }

    #[test]
    fn storage_values_are_required_and_explicitly_nullable() {
        let loaded = json!({"kind": "LOADED", "value": null});
        assert_eq!(round_trip::<StorageResult>(&loaded), Some(loaded.clone()));
        assert!(serde_json::from_value::<StorageResult>(json!({"kind": "LOADED"})).is_err());

        let request = json!({"request_id": 7, "key": "save:slot", "value": null});
        assert_eq!(
            round_trip::<StorageRequest>(&request),
            Some(request.clone())
        );
        assert!(
            serde_json::from_value::<StorageRequest>(json!({
                "request_id": 7,
                "key": "save:slot"
            }))
            .is_err()
        );
    }

    #[test]
    fn timer_owner_fields_are_non_empty_opaque_strings() {
        assert_eq!(
            TimerOwner::new("", "address", "reason"),
            Err(TimerOwnerError::Empty { field: "ownerId" })
        );
        assert_eq!(
            TimerOwner::new("owner", "", "reason"),
            Err(TimerOwnerError::Empty { field: "address" })
        );
        assert_eq!(
            TimerOwner::new("owner", "address", ""),
            Err(TimerOwnerError::Empty { field: "reason" })
        );

        let long = "\u{1f642}".repeat(512);
        let with_control = "owner\u{0000}opaque";
        assert!(TimerOwner::new(&long, with_control, &long).is_ok());
    }
}
