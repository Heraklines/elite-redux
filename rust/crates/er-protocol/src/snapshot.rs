//! Closed, restorable snapshots for the Authority V2 protocol owners.
//!
//! The protocol owns the shape and validation of these values, but it does not
//! own the battle payload schema.  Battle payloads therefore cross this
//! boundary only as canonical hex bytes.  The adjacent identity fields are
//! decoded and checked where the inherited Authority V2 wire type exposes
//! enough generic information to do so.

use std::collections::BTreeSet;
use std::fmt::Debug;

use er_types::battle_ids::{CanonicalHexBytes, CanonicalU64Decimal};
use er_types::{
    AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, ConnectionGeneration, FrameContext,
    OperationId, ProposalMessage, RecoveryBundle, RecoveryFenceState, RecoveryPhase, Revision,
    SafeU53, SeatId, TAIL_PROOF_MAX_SOURCE_REVISIONS, TailProofPhase, TimeClass, TimerId,
    TimerOwner, TransportState,
};
use serde::{Deserialize, Deserializer, Serialize, de::DeserializeOwned};
use thiserror::Error;

/// Private-owner bridge for the authority delivery log. The implementation
/// must preserve retained leases, staged receipts, allocator cursors,
/// prepared-token quiescence, and retired causal order, while restoring exact
/// scheduler timer identities through the supplied scheduler bridge.
pub trait AuthorityLogSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<AuthorityLogSnapshotV2, SnapshotError>;

    fn from_snapshot_v2(
        snapshot: AuthorityLogSnapshotV2,
        scheduler: &mut crate::KernelScheduler,
    ) -> Result<Self, SnapshotError>;
}

/// Private-owner bridge for the replica frontier/receipt owner.
pub trait AuthorityReplicaSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<AuthorityReplicaSnapshotV2, SnapshotError>;

    fn from_snapshot_v2(snapshot: AuthorityReplicaSnapshotV2) -> Result<Self, SnapshotError>;
}

/// Private-owner bridge for the authority proposal admission ledger.
pub trait ProposalAdmissionSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<ProposalAdmissionSnapshotV2, SnapshotError>;

    fn from_snapshot_v2(snapshot: ProposalAdmissionSnapshotV2) -> Result<Self, SnapshotError>;
}

/// Private-owner bridge for replica proposal leases and their timer targets.
pub trait ProposalLeaseSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<ProposalLeaseSnapshotV2, SnapshotError>;

    fn from_snapshot_v2(
        snapshot: ProposalLeaseSnapshotV2,
        scheduler: &mut crate::KernelScheduler,
    ) -> Result<Self, SnapshotError>;
}

/// Private-owner bridge for the recovery fence, phase, bundle, and timers.
pub trait RecoveryTransactionSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<RecoveryRuntimeSnapshotV2, SnapshotError>;

    fn from_snapshot_v2(
        snapshot: RecoveryRuntimeSnapshotV2,
        scheduler: &mut crate::KernelScheduler,
    ) -> Result<Self, SnapshotError>;
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// Closed protocol role identity carried by a restorable endpoint.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EndpointRole {
    Authority,
    Replica,
}

/// The complete protocol owner inventory for one endpoint.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolRuntimeSnapshotV2 {
    pub role: EndpointRole,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub authority_log: Option<AuthorityLogSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub authority_replica: Option<AuthorityReplicaSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub proposal_admission: Option<ProposalAdmissionSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub proposal_leases: Option<ProposalLeaseSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub recovery: Option<RecoveryRuntimeSnapshotV2>,
    pub frame_context: FrameContextSnapshotV2,
    pub peer_identity: PeerIdentitySnapshotV2,
    pub connections: Vec<ConnectionSnapshotV2>,
    pub pending_correlations: Vec<CorrelatedResponseSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub pending_material: Option<PendingProtocolMaterialSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub pending_control: Option<PendingProtocolControlSnapshotV2>,
    pub pending_recoveries: Vec<PendingRecoverySnapshotV2>,
    pub staged_rebinds: Vec<StagedPeerRebindSnapshotV2>,
    pub authority_rebind_pending: bool,
    pub disposed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerBindingSnapshotV2 {
    pub seat: SeatId,
    pub generation: ConnectionGeneration,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityEntryIdentitySnapshotV2 {
    pub revision: Revision,
    pub context: FrameContext,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub material_digest: String,
    pub next_control_id: String,
    pub subsumes: Vec<Revision>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpaqueAuthorityEntrySnapshotV2 {
    pub identity: AuthorityEntryIdentitySnapshotV2,
    pub canonical_entry_bytes: CanonicalHexBytes,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpaqueProposalEnvelopeSnapshotV2 {
    pub operation_id: OperationId,
    pub canonical_envelope_bytes: CanonicalHexBytes,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpaqueRecoveryBundleSnapshotV2 {
    pub correlation_id: String,
    pub canonical_bundle_bytes: CanonicalHexBytes,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum AuthorityDeliveryStageV2 {
    None,
    Admitted,
    MaterialApplied,
    ControlInstalled,
    PresentationSettled,
}

impl AuthorityDeliveryStageV2 {
    pub const fn rank(self) -> u8 {
        match self {
            Self::None => 0,
            Self::Admitted => 1,
            Self::MaterialApplied => 2,
            Self::ControlInstalled => 3,
            Self::PresentationSettled => 4,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityDeliveryPeerStageSnapshotV2 {
    pub seat: SeatId,
    pub generation: ConnectionGeneration,
    pub stage: AuthorityDeliveryStageV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityDeliveryLeaseSnapshotV2 {
    pub revision: Revision,
    pub entry: OpaqueAuthorityEntrySnapshotV2,
    pub owner: TimerOwner,
    pub peer_stages: Vec<AuthorityDeliveryPeerStageSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub timer_id: Option<TimerId>,
    pub attempts: CanonicalU64Decimal,
    pub next_delay_ms: SafeU53,
    pub stopped: bool,
    pub subsumption_done: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetiredOperationStageSnapshotV2 {
    pub operation_id: OperationId,
    pub stage: AuthorityDeliveryStageV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityLogSnapshotV2 {
    pub local_context: FrameContext,
    pub peer_bindings: Vec<PeerBindingSnapshotV2>,
    pub owner_id: String,
    pub retain_capacity: SafeU53,
    pub delivery_backoff: crate::BackoffPolicy,
    pub delivery_time_class: TimeClass,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub max_delivery_attempts: Option<SafeU53>,
    pub retained: Vec<AuthorityDeliveryLeaseSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub next_prepared_token: Option<SafeU53>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub latest_committed: Option<OpaqueAuthorityEntrySnapshotV2>,
    pub head_revision: Revision,
    pub retired_operation_stages: Vec<RetiredOperationStageSnapshotV2>,
    pub retired_operation_order: Vec<OperationId>,
    pub capacity_refusals: SafeU53,
    pub send_failures: SafeU53,
    #[serde(
        default,
        skip_serializing_if = "TailProofAuthoritySnapshotV2::is_empty"
    )]
    pub tail_proof: TailProofAuthoritySnapshotV2,
    pub disposed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TailProofPeerHighWaterSnapshotV2 {
    pub seat: SeatId,
    pub sequence: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TailProofAuthorityResponseSnapshotV2 {
    pub requester_seat: SeatId,
    pub sequence: SafeU53,
    pub request_context: FrameContext,
    pub authority_context: FrameContext,
    pub manifest: er_types::TailProofBody,
    pub sources: Vec<OpaqueAuthorityEntrySnapshotV2>,
    pub complete: er_types::TailProofBody,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TailProofAuthoritySnapshotV2 {
    pub retired_sources: Vec<OpaqueAuthorityEntrySnapshotV2>,
    pub responses: Vec<TailProofAuthorityResponseSnapshotV2>,
    pub request_high_water: Vec<TailProofPeerHighWaterSnapshotV2>,
}

impl TailProofAuthoritySnapshotV2 {
    pub fn is_empty(&self) -> bool {
        self.retired_sources.is_empty()
            && self.responses.is_empty()
            && self.request_high_water.is_empty()
    }

    fn validate(&self, capacity: SafeU53) -> Result<(), SnapshotError> {
        let capacity = usize::try_from(capacity.get()).unwrap_or(usize::MAX);
        if self.retired_sources.len() > capacity
            || self.responses.len() > capacity
            || self.retired_sources.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS
        {
            return Err(invalid(
                "authority_log.tail_proof",
                "retired source or response count exceeds retention capacity",
            ));
        }
        validate_sorted_unique(
            &self
                .retired_sources
                .iter()
                .map(|source| source.identity.revision)
                .collect::<Vec<_>>(),
            "authority_log.tail_proof.retired_sources",
        )?;
        for source in &self.retired_sources {
            source.validate()?;
        }
        validate_sorted_unique(
            &self
                .request_high_water
                .iter()
                .map(|value| value.seat)
                .collect::<Vec<_>>(),
            "authority_log.tail_proof.request_high_water",
        )?;
        if self
            .request_high_water
            .iter()
            .any(|value| value.sequence == SafeU53::ZERO)
        {
            return Err(invalid(
                "authority_log.tail_proof.request_high_water",
                "request sequence high-water values must be positive",
            ));
        }
        validate_sorted_unique(
            &self
                .responses
                .iter()
                .map(|response| {
                    (
                        response.requester_seat,
                        response.manifest.request_id.clone(),
                    )
                })
                .collect::<Vec<_>>(),
            "authority_log.tail_proof.responses",
        )?;
        for response in &self.responses {
            if response.sequence == SafeU53::ZERO
                || response.manifest.phase != TailProofPhase::Manifest
                || response.complete.phase != TailProofPhase::Complete
                || response.sources.len() > capacity
                || response.sources.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS
            {
                return Err(invalid(
                    "authority_log.tail_proof.responses",
                    "response phase, sequence, or source capacity is invalid",
                ));
            }
            for source in &response.sources {
                source.validate()?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PendingReplicaStageV2 {
    Admitted,
    MaterialApplied,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingReplicaEntrySnapshotV2 {
    pub entry: OpaqueAuthorityEntrySnapshotV2,
    pub stage: PendingReplicaStageV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstalledControlSnapshotV2 {
    pub revision: Revision,
    pub identity: AuthorityEntryIdentitySnapshotV2,
    pub control_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityReplicaSnapshotV2 {
    pub receipt_context: FrameContext,
    pub authority_seat: SeatId,
    pub authority_generation: ConnectionGeneration,
    pub frontier: AuthorityFrontier,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub pending: Option<PendingReplicaEntrySnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub requested_tail_from: Option<Revision>,
    pub installed_controls: Vec<InstalledControlSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub recovery_proof: Option<AuthorityEntryIdentitySnapshotV2>,
    #[serde(default, skip_serializing_if = "TailProofReplicaSnapshotV2::is_empty")]
    pub tail_proof: TailProofReplicaSnapshotV2,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TailProofReplicaCaptureSnapshotV2 {
    pub candidate: OpaqueAuthorityEntrySnapshotV2,
    pub predecessor_identity: AuthorityEntryIdentitySnapshotV2,
    pub from_revision: Revision,
    pub request_id: OperationId,
    pub request_context: FrameContext,
    pub authority_context: FrameContext,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub manifest: Option<er_types::TailProofBody>,
    pub sources: Vec<OpaqueAuthorityEntrySnapshotV2>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TailProofReplicaSnapshotV2 {
    pub request_sequence: SafeU53,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub capture: Option<TailProofReplicaCaptureSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub admission_candidate: Option<OpaqueAuthorityEntrySnapshotV2>,
}

impl TailProofReplicaSnapshotV2 {
    pub fn is_empty(&self) -> bool {
        self.request_sequence == SafeU53::ZERO
            && self.capture.is_none()
            && self.admission_candidate.is_none()
    }

    fn validate(&self) -> Result<(), SnapshotError> {
        if self.capture.is_some() && self.admission_candidate.is_some() {
            return Err(invalid(
                "authority_replica.tail_proof",
                "capture and one-shot admission cannot coexist",
            ));
        }
        if self.admission_candidate.is_some() {
            return Err(invalid(
                "authority_replica.tail_proof.admission_candidate",
                "one-shot admission state is call-stack-local and cannot cross a snapshot boundary",
            ));
        }
        if let Some(capture) = &self.capture {
            capture.candidate.validate()?;
            capture.predecessor_identity.validate()?;
            if capture.manifest.as_ref().is_some_and(|manifest| {
                manifest.phase != TailProofPhase::Manifest
                    || manifest.source_revisions.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS
            }) || capture.sources.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS
            {
                return Err(invalid(
                    "authority_replica.tail_proof.capture",
                    "capture manifest or source capacity is invalid",
                ));
            }
            for source in &capture.sources {
                source.validate()?;
            }
        }
        if let Some(candidate) = &self.admission_candidate {
            candidate.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalFingerprintSnapshotV2 {
    pub operation_id: OperationId,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalAdmissionSnapshotV2 {
    pub capacity: SafeU53,
    pub fingerprints: Vec<ProposalFingerprintSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ProposalTimerKindV2 {
    Retry,
    Absolute,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalTimerTargetSnapshotV2 {
    pub timer_id: TimerId,
    pub operation_id: OperationId,
    pub kind: ProposalTimerKindV2,
    pub endpoint: SeatId,
    pub owner: TimerOwner,
    pub delay_ms: SafeU53,
    pub time_class: TimeClass,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActiveProposalLeaseSnapshotV2 {
    pub operation_id: OperationId,
    pub proposal: OpaqueProposalEnvelopeSnapshotV2,
    pub retry_attempt: u32,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub retry_timer: Option<TimerId>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub absolute_timer: Option<TimerId>,
    pub timer_endpoint: SeatId,
    pub absolute_delay_ms: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalLeaseSnapshotV2 {
    pub config: crate::ProposalLeaseConfig,
    pub leases: Vec<ActiveProposalLeaseSnapshotV2>,
    pub committed_tombstones: Vec<OperationId>,
    pub timer_targets: Vec<ProposalTimerTargetSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryFenceSnapshotV2 {
    pub state: RecoveryFenceState,
    pub control_projection_allowed: bool,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub terminal_reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RecoveryTimerKindV2 {
    Request,
    Control,
    Pacing,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryTimerSnapshotV2 {
    pub timer: crate::ScheduledTimer,
    pub kind: RecoveryTimerKindV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryRuntimeSnapshotV2 {
    pub config: crate::RecoveryTransactionConfig,
    pub fence: RecoveryFenceSnapshotV2,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub phase: Option<RecoveryPhase>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub request_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub captured_frontier: Option<Revision>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub captured_state: Option<AuthorityFrontier>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub bundle: Option<OpaqueRecoveryBundleSnapshotV2>,
    pub timers: Vec<RecoveryTimerSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameContextSnapshotV2 {
    pub context: FrameContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerIdentitySnapshotV2 {
    pub local: FrameContext,
    /// `None` is the exact local-singles authority state. No synthetic peer
    /// context may be introduced merely to satisfy a DTO shape.
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub peer: Option<FrameContext>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectionSnapshotV2 {
    pub peer_seat: SeatId,
    pub generation: ConnectionGeneration,
    pub state: TransportState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrelatedResponseSnapshotV2 {
    pub correlation_id: String,
    pub bytes: CanonicalHexBytes,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingProtocolMaterialSnapshotV2 {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub bytes: CanonicalHexBytes,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingProtocolControlSnapshotV2 {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub expected_control_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingRecoverySnapshotV2 {
    pub correlation_id: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub bundle: Option<OpaqueRecoveryBundleSnapshotV2>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StagedPeerRebindSnapshotV2 {
    pub peer_seat: SeatId,
    pub generation: ConnectionGeneration,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotError {
    #[error("snapshot field {path} is invalid: {reason}")]
    Invalid { path: String, reason: String },
    #[error("snapshot canonical payload at {path} is invalid: {reason}")]
    Canonical { path: String, reason: String },
}

fn invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn canonical(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

fn validate_sorted_unique<T: Ord + Debug>(values: &[T], path: &str) -> Result<(), SnapshotError> {
    for pair in values.windows(2) {
        if pair[0] >= pair[1] {
            return Err(invalid(
                path,
                "entries must be strictly increasing and duplicate-free",
            ));
        }
    }
    Ok(())
}

fn validate_unique_in_order<T: Ord>(values: &[T], path: &str) -> Result<(), SnapshotError> {
    let mut seen = BTreeSet::new();
    if values.iter().any(|value| !seen.insert(value)) {
        return Err(invalid(path, "entries must be duplicate-free"));
    }
    Ok(())
}

fn decode_hex(value: &CanonicalHexBytes, path: &str) -> Result<Vec<u8>, SnapshotError> {
    let bytes = value.as_str().as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len() / 2);
    for index in (0..bytes.len()).step_by(2) {
        let high = hex_value(bytes[index]).ok_or_else(|| canonical(path, "invalid hex"))?;
        let low = hex_value(bytes[index + 1]).ok_or_else(|| canonical(path, "invalid hex"))?;
        decoded.push((high << 4) | low);
    }
    if decoded.is_empty() {
        return Err(canonical(path, "canonical payload must not be empty"));
    }
    Ok(decoded)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn decode_canonical<T>(value: &CanonicalHexBytes, path: &str) -> Result<T, SnapshotError>
where
    T: DeserializeOwned + Serialize,
{
    let bytes = decode_hex(value, path)?;
    let decoded =
        serde_json::from_slice::<T>(&bytes).map_err(|error| canonical(path, error.to_string()))?;
    let canonical_bytes = er_canonical::canonical_bytes(&decoded)
        .map_err(|error| canonical(path, error.to_string()))?;
    if canonical_bytes != bytes {
        return Err(canonical(
            path,
            "payload is not the exact canonical JSON encoding",
        ));
    }
    Ok(decoded)
}

impl AuthorityEntryIdentitySnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.material_digest.is_empty() {
            return Err(invalid("material_digest", "must not be empty"));
        }
        if self.next_control_id.is_empty() {
            return Err(invalid("next_control_id", "must not be empty"));
        }
        validate_sorted_unique(&self.subsumes, "subsumes")
    }
}

impl OpaqueAuthorityEntrySnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        self.identity.validate()?;
        let entry: AuthorityEntry =
            decode_canonical(&self.canonical_entry_bytes, "canonical_entry_bytes")?;
        if entry.revision != self.identity.revision
            || entry.context != self.identity.context
            || entry.operation_id != self.identity.operation_id
            || entry.kind != self.identity.kind
            || entry.material.digest != self.identity.material_digest
            || entry.subsumes != self.identity.subsumes
            || crate::control_id_of(&entry.next_control) != self.identity.next_control_id
        {
            return Err(invalid(
                "canonical_entry_bytes",
                "decoded AuthorityEntry identity differs from adjacent identity",
            ));
        }
        Ok(())
    }
}

impl OpaqueProposalEnvelopeSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        let proposal: ProposalMessage =
            decode_canonical(&self.canonical_envelope_bytes, "canonical_envelope_bytes")?;
        if proposal.operation_id != self.operation_id {
            return Err(invalid(
                "canonical_envelope_bytes",
                "decoded proposal operation identity differs from adjacent identity",
            ));
        }
        Ok(())
    }
}

impl OpaqueRecoveryBundleSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        let bundle: RecoveryBundle =
            decode_canonical(&self.canonical_bundle_bytes, "canonical_bundle_bytes")?;
        if bundle.request_id != self.correlation_id {
            return Err(invalid(
                "canonical_bundle_bytes",
                "decoded recovery request ID differs from correlation_id",
            ));
        }
        Ok(())
    }
}

impl AuthorityLogSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.owner_id.is_empty()
            || self.retain_capacity == SafeU53::ZERO
            || self.delivery_backoff.initial_ms == SafeU53::ZERO
            || self.delivery_backoff.maximum_ms < self.delivery_backoff.initial_ms
            || self.delivery_backoff.factor_denominator == SafeU53::ZERO
            || self.delivery_backoff.factor_numerator < self.delivery_backoff.factor_denominator
        {
            return Err(invalid(
                "authority_log",
                "owner and retention capacity are invalid",
            ));
        }
        validate_sorted_unique(
            &self
                .peer_bindings
                .iter()
                .map(|value| value.seat)
                .collect::<Vec<_>>(),
            "authority_log.peer_bindings",
        )?;
        validate_sorted_unique(
            &self
                .retained
                .iter()
                .map(|value| value.revision)
                .collect::<Vec<_>>(),
            "authority_log.retained",
        )?;
        if self.retained.len() as u64 > self.retain_capacity.get() {
            return Err(invalid(
                "authority_log.retained",
                "retained lease count exceeds retention capacity",
            ));
        }
        validate_sorted_unique(
            &self
                .retired_operation_stages
                .iter()
                .map(|value| value.operation_id.clone())
                .collect::<Vec<_>>(),
            "authority_log.retired_operation_stages",
        )?;
        validate_unique_in_order(
            &self.retired_operation_order,
            "authority_log.retired_operation_order",
        )?;
        let stage_ids = self
            .retired_operation_stages
            .iter()
            .map(|value| value.operation_id.clone())
            .collect::<BTreeSet<_>>();
        let order_ids = self
            .retired_operation_order
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if stage_ids != order_ids {
            return Err(invalid(
                "authority_log.retired_operation_order",
                "must contain exactly the retired operation IDs (in causal order)",
            ));
        }
        for lease in &self.retained {
            if lease.revision != lease.entry.identity.revision {
                return Err(invalid(
                    "authority_log.retained",
                    "lease revision must equal entry identity revision",
                ));
            }
            lease.entry.validate()?;
            validate_sorted_unique(
                &lease
                    .peer_stages
                    .iter()
                    .map(|value| value.seat)
                    .collect::<Vec<_>>(),
                "authority_log.retained.peer_stages",
            )?;
            for stage in &lease.peer_stages {
                if !self.peer_bindings.iter().any(|binding| {
                    binding.seat == stage.seat && binding.generation == stage.generation
                }) {
                    return Err(invalid(
                        "authority_log.retained.peer_stages",
                        "delivery stage has no exact peer binding generation",
                    ));
                }
            }
            if lease.timer_id.is_some() && lease.stopped {
                return Err(invalid(
                    "authority_log.retained.timer_id",
                    "a stopped delivery lease cannot retain a timer",
                ));
            }
            if lease.owner.owner_id.is_empty()
                || lease.owner.address.is_empty()
                || lease.owner.reason.is_empty()
            {
                return Err(invalid(
                    "authority_log.retained.owner",
                    "delivery timer owner fields must not be empty",
                ));
            }
            if lease.peer_stages.iter().any(|stage| {
                stage.stage == AuthorityDeliveryStageV2::PresentationSettled
                    && stage.generation
                        != self
                            .peer_bindings
                            .iter()
                            .find(|binding| binding.seat == stage.seat)
                            .map(|binding| binding.generation)
                            .unwrap_or(stage.generation)
            }) {
                return Err(invalid(
                    "authority_log.retained.peer_stages",
                    "presentation settlement must retain the exact bound generation",
                ));
            }
            if let Some(max_attempts) = self.max_delivery_attempts
                && (lease.attempts.as_u64() > max_attempts.get()
                    || (!lease.stopped && lease.attempts.as_u64() >= max_attempts.get()))
            {
                return Err(invalid(
                    "authority_log.retained",
                    "delivery attempts/timer do not cross-validate with max_delivery_attempts",
                ));
            }
        }
        if let Some(entry) = &self.latest_committed {
            entry.validate()?;
            if entry.identity.revision != self.head_revision {
                return Err(invalid(
                    "authority_log.latest_committed",
                    "latest committed revision must equal the head revision",
                ));
            }
        } else if self.head_revision != Revision::ZERO {
            return Err(invalid(
                "authority_log.head_revision",
                "a non-zero head revision requires latest_committed identity",
            ));
        }
        if self
            .retired_operation_stages
            .iter()
            .any(|entry| entry.stage == AuthorityDeliveryStageV2::None)
            && !self.peer_bindings.is_empty()
        {
            return Err(invalid(
                "authority_log.retired_operation_stages",
                "a bound-peer lease cannot retire at the unbound None stage",
            ));
        }
        self.tail_proof.validate(self.retain_capacity)?;
        if self.disposed
            && (!self.retained.is_empty()
                || self.latest_committed.is_some()
                || !self.retired_operation_stages.is_empty()
                || !self.retired_operation_order.is_empty()
                || !self.tail_proof.is_empty())
        {
            return Err(invalid(
                "authority_log",
                "disposed log cannot retain leases, commits, or tombstones",
            ));
        }
        Ok(())
    }
}

impl AuthorityReplicaSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        validate_sorted_unique(
            &self
                .installed_controls
                .iter()
                .map(|value| value.revision)
                .collect::<Vec<_>>(),
            "authority_replica.installed_controls",
        )?;
        for control in &self.installed_controls {
            if control.revision != control.identity.revision || control.control_id.is_empty() {
                return Err(invalid(
                    "authority_replica.installed_controls",
                    "control identity and revision do not agree",
                ));
            }
            control.identity.validate()?;
        }
        if let Some(pending) = &self.pending {
            pending.entry.validate()?;
        }
        if let Some(proof) = &self.recovery_proof {
            proof.validate()?;
        }
        self.tail_proof.validate()?;
        if !(self.frontier.control <= self.frontier.material
            && self.frontier.material <= self.frontier.received)
        {
            return Err(invalid(
                "authority_replica.frontier",
                "control <= material <= received must hold",
            ));
        }
        if self.disposed
            && (self.pending.is_some()
                || self.requested_tail_from.is_some()
                || !self.installed_controls.is_empty()
                || self.recovery_proof.is_some()
                || !self.tail_proof.is_empty())
        {
            return Err(invalid(
                "authority_replica",
                "disposed replica cannot retain pending or installed state",
            ));
        }
        Ok(())
    }
}

impl ProposalAdmissionSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.capacity == SafeU53::ZERO {
            return Err(invalid("proposal_admission.capacity", "must be positive"));
        }
        validate_sorted_unique(
            &self
                .fingerprints
                .iter()
                .map(|value| value.operation_id.clone())
                .collect::<Vec<_>>(),
            "proposal_admission.fingerprints",
        )?;
        if self.fingerprints.len() as u64 > self.capacity.get() {
            return Err(invalid(
                "proposal_admission.fingerprints",
                "fingerprint count exceeds admission capacity",
            ));
        }
        if self
            .fingerprints
            .iter()
            .any(|value| value.fingerprint.is_empty())
        {
            return Err(invalid(
                "proposal_admission.fingerprints",
                "fingerprints must not be empty",
            ));
        }
        if self.disposed && !self.fingerprints.is_empty() {
            return Err(invalid(
                "proposal_admission",
                "disposed admission ledger cannot retain fingerprints",
            ));
        }
        Ok(())
    }
}

impl ProposalLeaseSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.config.owner_prefix.is_empty()
            || self.config.retry_initial_ms == SafeU53::ZERO
            || self.config.retry_maximum_ms == SafeU53::ZERO
            || self.config.retry_initial_ms > self.config.retry_maximum_ms
            || self.config.absolute_ceiling_ms == SafeU53::ZERO
        {
            return Err(invalid(
                "proposal_leases.config",
                "proposal lease owner and timing configuration are invalid",
            ));
        }
        validate_sorted_unique(
            &self
                .leases
                .iter()
                .map(|value| value.operation_id.clone())
                .collect::<Vec<_>>(),
            "proposal_leases.leases",
        )?;
        validate_sorted_unique(
            &self.committed_tombstones,
            "proposal_leases.committed_tombstones",
        )?;
        validate_sorted_unique(
            &self
                .timer_targets
                .iter()
                .map(|value| value.timer_id)
                .collect::<Vec<_>>(),
            "proposal_leases.timer_targets",
        )?;
        for lease in &self.leases {
            if lease.operation_id != lease.proposal.operation_id {
                return Err(invalid(
                    "proposal_leases.leases",
                    "lease operation ID differs from opaque proposal identity",
                ));
            }
            lease.proposal.validate()?;
            if lease.absolute_delay_ms == SafeU53::ZERO
                || lease.absolute_delay_ms > self.config.absolute_ceiling_ms
            {
                return Err(invalid(
                    "proposal_leases.leases.absolute_delay_ms",
                    "absolute lease delay must be positive and within configured ceiling",
                ));
            }
            if self.committed_tombstones.contains(&lease.operation_id) {
                return Err(invalid(
                    "proposal_leases.committed_tombstones",
                    "a committed operation cannot retain an active lease",
                ));
            }
            let (Some(retry_timer), Some(absolute_timer)) =
                (lease.retry_timer, lease.absolute_timer)
            else {
                return Err(invalid(
                    "proposal_leases.leases",
                    "an active proposal lease must retain both scheduler timers",
                ));
            };
            if retry_timer == absolute_timer {
                return Err(invalid(
                    "proposal_leases.leases",
                    "proposal retry and absolute timers cannot share an identity",
                ));
            }
            for (timer_id, kind, time_class) in [
                (
                    lease.retry_timer,
                    ProposalTimerKindV2::Retry,
                    TimeClass::Connected,
                ),
                (
                    lease.absolute_timer,
                    ProposalTimerKindV2::Absolute,
                    TimeClass::Absolute,
                ),
            ] {
                if let Some(timer_id) = timer_id {
                    let target = self
                        .timer_targets
                        .iter()
                        .find(|target| target.timer_id == timer_id)
                        .ok_or_else(|| {
                            invalid(
                                "proposal_leases.timer_targets",
                                "active lease timer has no target",
                            )
                        })?;
                    if target.operation_id != lease.operation_id
                        || target.kind != kind
                        || target.endpoint != lease.timer_endpoint
                        || target.time_class != time_class
                    {
                        return Err(invalid(
                            "proposal_leases.timer_targets",
                            "lease timer target identity or class differs from its lease",
                        ));
                    }
                }
            }
        }
        for target in &self.timer_targets {
            if target.owner.owner_id.is_empty()
                || target.owner.address.is_empty()
                || target.owner.reason.is_empty()
                || target.delay_ms == SafeU53::ZERO
            {
                return Err(invalid(
                    "proposal_leases.timer_targets",
                    "timer target owner and delay must be complete",
                ));
            }
            let lease = self
                .leases
                .iter()
                .find(|lease| lease.operation_id == target.operation_id)
                .ok_or_else(|| {
                    invalid(
                        "proposal_leases.timer_targets",
                        "timer target has no active proposal lease",
                    )
                })?;
            let expected_id = match target.kind {
                ProposalTimerKindV2::Retry => lease.retry_timer,
                ProposalTimerKindV2::Absolute => lease.absolute_timer,
            };
            if expected_id != Some(target.timer_id) {
                return Err(invalid(
                    "proposal_leases.timer_targets",
                    "timer target is not the lease's active timer of that kind",
                ));
            }
        }
        if self.disposed
            && (!self.leases.is_empty()
                || !self.committed_tombstones.is_empty()
                || !self.timer_targets.is_empty())
        {
            return Err(invalid(
                "proposal_leases",
                "disposed lease manager cannot retain leases, timers, or tombstones",
            ));
        }
        Ok(())
    }
}

impl RecoveryRuntimeSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.config.timer_owner_id.is_empty()
            || self.config.request_timeout_ms == SafeU53::ZERO
            || self.config.control_timeout_ms == SafeU53::ZERO
            || self.config.pacing_ms == SafeU53::ZERO
        {
            return Err(invalid(
                "recovery.config",
                "timer owner and all recovery durations must be non-zero",
            ));
        }
        validate_sorted_unique(
            &self
                .timers
                .iter()
                .map(|value| value.timer.timer_id)
                .collect::<Vec<_>>(),
            "recovery.timers",
        )?;
        if let Some(bundle) = &self.bundle {
            bundle.validate()?;
            if self.request_id.as_deref() != Some(bundle.correlation_id.as_str()) {
                return Err(invalid(
                    "recovery.bundle",
                    "bundle correlation must equal the active recovery request",
                ));
            }
        }
        if self.request_id.as_ref().is_some_and(String::is_empty) {
            return Err(invalid("recovery.request_id", "must not be empty"));
        }
        for timer in &self.timers {
            if timer.timer.endpoint != self.config.local_context.sender_seat_id
                || timer.timer.owner.owner_id != self.config.timer_owner_id
                || timer.timer.time_class != TimeClass::Recovery
            {
                return Err(invalid(
                    "recovery.timers",
                    "timer endpoint, owner, and time class must match recovery configuration",
                ));
            }
            if timer.timer.owner.address.is_empty() || timer.timer.owner.reason.is_empty() {
                return Err(invalid(
                    "recovery.timers",
                    "recovery timer owner address and reason must not be empty",
                ));
            }
        }
        match self.fence.state {
            RecoveryFenceState::Open => {
                if self.fence.control_projection_allowed || self.fence.terminal_reason.is_some() {
                    return Err(invalid(
                        "recovery.fence",
                        "an open fence cannot allow projection or retain a terminal reason",
                    ));
                }
            }
            RecoveryFenceState::Held => {
                if self.fence.terminal_reason.is_some() {
                    return Err(invalid(
                        "recovery.fence.terminal_reason",
                        "a held fence cannot retain a terminal reason",
                    ));
                }
            }
            RecoveryFenceState::Terminal => {
                if self.fence.control_projection_allowed
                    || self
                        .fence
                        .terminal_reason
                        .as_deref()
                        .is_none_or(str::is_empty)
                {
                    return Err(invalid(
                        "recovery.fence",
                        "a terminal fence requires a reason and forbids control projection",
                    ));
                }
            }
        }
        if self.phase.is_none()
            && (self.request_id.is_some()
                || self.captured_frontier.is_some()
                || self.captured_state.is_some()
                || self.bundle.is_some()
                || !self.timers.is_empty()
                || self.fence.state != RecoveryFenceState::Open)
        {
            return Err(invalid(
                "recovery",
                "an unstarted recovery transaction must retain only an open empty owner",
            ));
        }
        if self.disposed && (!self.timers.is_empty() || self.bundle.is_some()) {
            return Err(invalid(
                "recovery",
                "disposed recovery cannot retain timers or a bundle",
            ));
        }
        Ok(())
    }
}

impl ProtocolRuntimeSnapshotV2 {
    /// Validate all closed owner invariants without mutating any live owner.
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.frame_context.context != self.peer_identity.local {
            return Err(invalid(
                "protocol.peer_identity.local",
                "local peer identity must equal the protocol frame context",
            ));
        }
        if let Some(peer) = &self.peer_identity.peer {
            if peer.sender_seat_id == self.frame_context.context.sender_seat_id
                || peer.authority_seat_id != self.frame_context.context.authority_seat_id
            {
                return Err(invalid(
                    "protocol.peer_identity.peer",
                    "peer context must name a distinct sender in the same authority session",
                ));
            }
            if !self
                .connections
                .iter()
                .any(|connection| connection.peer_seat == peer.sender_seat_id)
            {
                return Err(invalid(
                    "protocol.peer_identity.peer",
                    "peer identity must have an exact connection entry",
                ));
            }
        }
        match self.role {
            EndpointRole::Authority => {
                if self.authority_log.is_none()
                    || self.proposal_admission.is_none()
                    || self.authority_replica.is_some()
                    || self.proposal_leases.is_some()
                    || self.recovery.is_some()
                {
                    return Err(invalid(
                        "protocol.role",
                        "authority role has an incompatible owner inventory",
                    ));
                }
                self.authority_log
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.authority_log", "owner is required"))?
                    .validate()?;
                self.proposal_admission
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.proposal_admission", "owner is required"))?
                    .validate()?;
                let log = self
                    .authority_log
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.authority_log", "owner is required"))?;
                let admission = self
                    .proposal_admission
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.proposal_admission", "owner is required"))?;
                if log.local_context != self.frame_context.context {
                    return Err(invalid(
                        "protocol.authority_log.local_context",
                        "authority log context differs from protocol frame context",
                    ));
                }
                if log.peer_bindings.is_empty() {
                    if self.peer_identity.peer.is_some() || !self.connections.is_empty() {
                        return Err(invalid(
                            "protocol.peer_identity.peer",
                            "a local-singles authority must retain no peer or connection",
                        ));
                    }
                } else if self.peer_identity.peer.is_none() {
                    return Err(invalid(
                        "protocol.peer_identity.peer",
                        "a remote authority endpoint must retain an explicit peer context",
                    ));
                }
                if log.disposed != self.disposed || admission.disposed != self.disposed {
                    return Err(invalid(
                        "protocol.disposed",
                        "authority owner disposal flags differ from protocol disposal",
                    ));
                }
                for binding in &log.peer_bindings {
                    if !self.connections.iter().any(|connection| {
                        connection.peer_seat == binding.seat
                            && connection.generation == binding.generation
                    }) {
                        return Err(invalid(
                            "protocol.connections",
                            "authority peer binding has no exact connection generation",
                        ));
                    }
                }
            }
            EndpointRole::Replica => {
                if self.authority_log.is_some()
                    || self.proposal_admission.is_some()
                    || self.authority_replica.is_none()
                    || self.proposal_leases.is_none()
                    || self.recovery.is_none()
                {
                    return Err(invalid(
                        "protocol.role",
                        "replica role has an incompatible owner inventory",
                    ));
                }
                self.authority_replica
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.authority_replica", "owner is required"))?
                    .validate()?;
                self.proposal_leases
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.proposal_leases", "owner is required"))?
                    .validate()?;
                self.recovery
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.recovery", "owner is required"))?
                    .validate()?;
                let replica = self
                    .authority_replica
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.authority_replica", "owner is required"))?;
                let leases = self
                    .proposal_leases
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.proposal_leases", "owner is required"))?;
                let recovery = self
                    .recovery
                    .as_ref()
                    .ok_or_else(|| invalid("protocol.recovery", "owner is required"))?;
                if replica.receipt_context != self.frame_context.context
                    || recovery.config.local_context != self.frame_context.context
                {
                    return Err(invalid(
                        "protocol.frame_context",
                        "replica and recovery owner contexts differ from the protocol context",
                    ));
                }
                if self.peer_identity.peer.is_none() {
                    return Err(invalid(
                        "protocol.peer_identity.peer",
                        "a replica endpoint requires its exact authority peer context",
                    ));
                }
                if replica.disposed != self.disposed
                    || leases.disposed != self.disposed
                    || recovery.disposed != self.disposed
                {
                    return Err(invalid(
                        "protocol.disposed",
                        "replica owner disposal flags differ from protocol disposal",
                    ));
                }
            }
        }
        validate_sorted_unique(
            &self
                .connections
                .iter()
                .map(|value| value.peer_seat)
                .collect::<Vec<_>>(),
            "protocol.connections",
        )?;
        if self
            .connections
            .iter()
            .any(|connection| connection.peer_seat == self.frame_context.context.sender_seat_id)
        {
            return Err(invalid(
                "protocol.connections",
                "connections must identify non-local peers",
            ));
        }
        validate_sorted_unique(
            &self
                .pending_correlations
                .iter()
                .map(|value| value.correlation_id.clone())
                .collect::<Vec<_>>(),
            "protocol.pending_correlations",
        )?;
        validate_sorted_unique(
            &self
                .pending_recoveries
                .iter()
                .map(|value| value.correlation_id.clone())
                .collect::<Vec<_>>(),
            "protocol.pending_recoveries",
        )?;
        validate_sorted_unique(
            &self
                .staged_rebinds
                .iter()
                .map(|value| value.peer_seat)
                .collect::<Vec<_>>(),
            "protocol.staged_rebinds",
        )?;
        for pending in &self.pending_recoveries {
            if pending.correlation_id.is_empty() {
                return Err(invalid(
                    "protocol.pending_recoveries.correlation_id",
                    "must not be empty",
                ));
            }
            if let Some(bundle) = &pending.bundle {
                bundle.validate()?;
                if bundle.correlation_id != pending.correlation_id {
                    return Err(invalid(
                        "protocol.pending_recoveries",
                        "bundle correlation differs from pending correlation",
                    ));
                }
            }
        }
        for pending in &self.pending_correlations {
            if pending.correlation_id.is_empty() {
                return Err(invalid(
                    "protocol.pending_correlations.correlation_id",
                    "must not be empty",
                ));
            }
            let _ = decode_hex(&pending.bytes, "protocol.pending_correlations.bytes")?;
        }
        if let Some(material) = &self.pending_material {
            let _ = decode_hex(&material.bytes, "pending_material.bytes")?;
            if material.operation_id.as_str().is_empty() {
                return Err(invalid(
                    "pending_material.operation_id",
                    "operation identity must not be empty",
                ));
            }
        }
        if let Some(control) = &self.pending_control
            && control.operation_id.as_str().is_empty()
        {
            return Err(invalid(
                "protocol.pending_control.operation_id",
                "operation identity must not be empty",
            ));
        }
        if let Some(control) = &self.pending_control
            && control.expected_control_id.is_empty()
        {
            return Err(invalid(
                "protocol.pending_control.expected_control_id",
                "must not be empty",
            ));
        }
        if let (Some(material), Some(control)) = (&self.pending_material, &self.pending_control)
            && (material.revision != control.revision
                || material.operation_id != control.operation_id)
        {
            return Err(invalid(
                "protocol.pending_material",
                "pending material/control identities must agree when both are present",
            ));
        }
        if self.disposed
            && (!self.pending_correlations.is_empty()
                || self.pending_material.is_some()
                || self.pending_control.is_some()
                || !self.pending_recoveries.is_empty()
                || !self.staged_rebinds.is_empty()
                || self.authority_rebind_pending)
        {
            return Err(invalid(
                "protocol",
                "disposed protocol cannot retain live connection or pending state",
            ));
        }
        Ok(())
    }
}
