//! Authority-side global revision, retention, receipt, and delivery state.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

use er_types::battle_ids::{CanonicalHexBytes, CanonicalU64Decimal};
use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryKind, AuthorityReceipt, AuthorityRecoverySlice,
    ConnectionGeneration, FrameContext, Material, NextControl, OperationId, Revision, SafeU53,
    SeatId, TailProofBody, TailRequestBody, TimeClass, TimerId, TimerOwner,
    validate_authority_material_digest, validate_authority_operation_id,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot::{
    AuthorityDeliveryLeaseSnapshotV2, AuthorityDeliveryPeerStageSnapshotV2,
    AuthorityDeliveryStageV2, AuthorityEntryIdentitySnapshotV2, AuthorityLogSnapshotBridge,
    AuthorityLogSnapshotV2, OpaqueAuthorityEntrySnapshotV2, PeerBindingSnapshotV2,
    RetiredOperationStageSnapshotV2, SnapshotError,
};
use crate::successor::{control_allows_successor_entry, control_id_of, is_valid_next_control};
use crate::tail_proof::{
    TailProofAuthorityEmission, TailProofAuthorityState, TailProofRequestContext,
    boundary_supersession_allows,
};
use crate::{
    KernelScheduler, ScheduledTimer, SchedulerCommand, SchedulerError, frame_contexts_compatible,
};

pub const DEFAULT_RETAIN_CAPACITY: u64 = 512;
pub const DEFAULT_DELIVERY_INITIAL_MS: u64 = 250;
pub const DEFAULT_DELIVERY_MAX_MS: u64 = 5_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerBinding {
    pub seat_id: SeatId,
    pub connection_generation: ConnectionGeneration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackoffPolicy {
    pub initial_ms: SafeU53,
    pub maximum_ms: SafeU53,
    pub factor_numerator: SafeU53,
    pub factor_denominator: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityLogConfig {
    pub local_context: FrameContext,
    pub peer_bindings: Vec<PeerBinding>,
    pub owner_id: String,
    pub retain_capacity: SafeU53,
    pub delivery_backoff: BackoffPolicy,
    pub delivery_time_class: TimeClass,
    pub max_delivery_attempts: Option<SafeU53>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityEntryDraft {
    pub context: FrameContext,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub material: Material,
    pub next_control: NextControl,
    pub subsumes: Vec<Revision>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCommit {
    pub token: SafeU53,
    pub entry: AuthorityEntry,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorityLogAction {
    Deliver {
        to: SeatId,
        entry: Box<AuthorityEntry>,
    },
    Scheduler {
        command: SchedulerCommand,
    },
    TailProof {
        to: SeatId,
        context: FrameContext,
        body: TailProofBody,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutcome {
    pub entry: AuthorityEntry,
    pub actions: Vec<AuthorityLogAction>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityRebindOutcome {
    pub retained_count: SafeU53,
    pub actions: Vec<AuthorityLogAction>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReceiptRejectReason {
    Disposed,
    InvalidReceipt,
    InvalidContext,
    SessionMismatch,
    StaleEpoch,
    RevisionMismatch,
    OperationMismatch,
    AuthorityMismatch,
    MembershipMismatch,
    SelfSigned,
    AuthoritySigned,
    UnboundPeer,
    ConnectionGenerationMismatch,
    ControlIdMismatch,
    UnexpectedControlId,
    PresentationBeforeMechanical,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AuthorityReceiptVerdict {
    Rejected {
        reason: ReceiptRejectReason,
    },
    Duplicate {
        highest_stage: AckStage,
    },
    Advanced {
        retired: bool,
        waiting_for_seat_ids: Vec<SeatId>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptOutcome {
    pub verdict: AuthorityReceiptVerdict,
    pub actions: Vec<AuthorityLogAction>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityLogDiagnostics {
    pub head_revision: Revision,
    pub retained_revisions: BTreeSet<Revision>,
    pub delivery_timer_ids: BTreeSet<TimerId>,
    pub delivery_owner_ids: BTreeSet<String>,
    pub peer_stages: BTreeMap<Revision, BTreeMap<SeatId, AckStage>>,
    pub capacity_refusals: SafeU53,
    pub send_failures: SafeU53,
    pub retired_tail_proof_sources: SafeU53,
    pub tail_proof_responses: SafeU53,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AuthorityLogError {
    #[error("authority log is disposed")]
    Disposed,
    #[error("authority log configuration is invalid: {reason}")]
    InvalidConfig { reason: String },
    #[error("authority entry is invalid: {reason}")]
    InvalidEntry { reason: String },
    #[error("entry context does not match the authority binding")]
    ContextMismatch,
    #[error("authority predecessor is terminal")]
    TerminalPredecessor,
    #[error("the predecessor control does not authorize this entry")]
    SuccessorRejected,
    #[error("retention capacity {capacity} refuses revision {attempted_revision}")]
    RetentionOverflow {
        capacity: SafeU53,
        attempted_revision: Revision,
    },
    #[error("revision space is exhausted")]
    RevisionExhausted,
    #[error("prepared commit {token} is not live")]
    UnknownPreparedCommit { token: SafeU53 },
    #[error(transparent)]
    Scheduler(#[from] SchedulerError),
}

const STAGE_NONE: i8 = -1;
const STAGE_ADMITTED: i8 = 0;
const STAGE_MATERIAL_APPLIED: i8 = 1;
const STAGE_CONTROL_INSTALLED: i8 = 2;
const STAGE_PRESENTATION_SETTLED: i8 = 3;

#[derive(Clone, Debug)]
struct PeerStage {
    connection_generation: ConnectionGeneration,
    stage: i8,
}

#[derive(Clone, Debug)]
struct DeliveryLease {
    entry: Arc<AuthorityEntry>,
    owner: TimerOwner,
    peer_stages: BTreeMap<SeatId, PeerStage>,
    timer_id: Option<TimerId>,
    attempts: u64,
    next_delay_ms: SafeU53,
    stopped: bool,
    subsumption_done: bool,
}

#[derive(Clone, Debug)]
pub struct AuthorityLog {
    local_context: FrameContext,
    peer_bindings: BTreeMap<SeatId, ConnectionGeneration>,
    owner_id: String,
    retain_capacity: SafeU53,
    delivery_backoff: BackoffPolicy,
    delivery_time_class: TimeClass,
    max_delivery_attempts: Option<SafeU53>,
    retained: BTreeMap<Revision, DeliveryLease>,
    prepared: BTreeMap<SafeU53, PreparedCommit>,
    next_token: Option<SafeU53>,
    latest_committed: Option<Arc<AuthorityEntry>>,
    head_revision: Revision,
    retired_operation_stages: BTreeMap<OperationId, i8>,
    retired_operation_order: VecDeque<OperationId>,
    capacity_refusals: SafeU53,
    send_failures: SafeU53,
    tail_proof: TailProofAuthorityState,
    disposed: bool,
}

impl AuthorityLog {
    pub fn new(config: AuthorityLogConfig) -> Result<Self, AuthorityLogError> {
        validate_config(&config, true)?;
        Self::from_validated_config(config)
    }

    /// Construct the authority log for a single-endpoint M3 battle.
    ///
    /// The ordinary protocol constructor continues to require at least one
    /// remote peer.  Local singles still use the same revision, material,
    /// preparation, publication, and retention machinery, but have no
    /// delivery lease or synthetic peer to acknowledge it.
    #[doc(hidden)]
    pub fn new_local(config: AuthorityLogConfig) -> Result<Self, AuthorityLogError> {
        if !config.peer_bindings.is_empty() {
            return Err(AuthorityLogError::InvalidConfig {
                reason: "a local authority log must not declare remote peer bindings".to_owned(),
            });
        }
        validate_config(&config, false)?;
        Self::from_validated_config(config)
    }

    fn from_validated_config(config: AuthorityLogConfig) -> Result<Self, AuthorityLogError> {
        let mut peer_bindings = BTreeMap::new();
        for peer in config.peer_bindings {
            peer_bindings.insert(peer.seat_id, peer.connection_generation);
        }

        let one = SafeU53::new(1).map_err(|_| AuthorityLogError::RevisionExhausted)?;
        Ok(Self {
            local_context: config.local_context,
            peer_bindings,
            owner_id: config.owner_id,
            retain_capacity: config.retain_capacity,
            delivery_backoff: config.delivery_backoff,
            delivery_time_class: config.delivery_time_class,
            max_delivery_attempts: config.max_delivery_attempts,
            retained: BTreeMap::new(),
            prepared: BTreeMap::new(),
            next_token: Some(one),
            latest_committed: None,
            head_revision: Revision::ZERO,
            retired_operation_stages: BTreeMap::new(),
            retired_operation_order: VecDeque::new(),
            capacity_refusals: SafeU53::ZERO,
            send_failures: SafeU53::ZERO,
            tail_proof: TailProofAuthorityState::default(),
            disposed: false,
        })
    }

    pub fn prepare_commit(
        &mut self,
        draft: AuthorityEntryDraft,
    ) -> Result<PreparedCommit, AuthorityLogError> {
        if self.disposed {
            return Err(AuthorityLogError::Disposed);
        }
        if !self.prepared.is_empty() {
            return Err(AuthorityLogError::InvalidEntry {
                reason: "another prepared commit is live".to_owned(),
            });
        }

        let revision = self.next_revision()?;
        let entry = AuthorityEntry {
            context: draft.context,
            revision,
            operation_id: draft.operation_id,
            kind: draft.kind,
            material: draft.material,
            next_control: draft.next_control,
            subsumes: draft.subsumes,
        };
        self.validate_entry(&entry)?;
        if self.retained.len() as u64 >= self.retain_capacity.get() {
            increment_counter(&mut self.capacity_refusals);
            return Err(AuthorityLogError::RetentionOverflow {
                capacity: self.retain_capacity,
                attempted_revision: revision,
            });
        }

        let token = match self.next_token {
            Some(token) => token,
            None => return Err(AuthorityLogError::RevisionExhausted),
        };
        self.next_token = next_safe(self.next_token);
        let prepared = PreparedCommit { token, entry };
        self.prepared.insert(token, prepared.clone());
        Ok(prepared)
    }

    pub fn publish_prepared(
        &mut self,
        token: SafeU53,
        scheduler: &mut KernelScheduler,
    ) -> Result<CommitOutcome, AuthorityLogError> {
        if self.disposed {
            return Err(AuthorityLogError::Disposed);
        }
        let Some(prepared) = self.prepared.remove(&token) else {
            return Err(AuthorityLogError::UnknownPreparedCommit { token });
        };
        let expected_revision = match next_revision_value(self.head_revision) {
            Ok(revision) => revision,
            Err(error) => {
                self.prepared.insert(token, prepared);
                return Err(error);
            }
        };
        if prepared.entry.revision != expected_revision {
            self.prepared.insert(token, prepared);
            return Err(AuthorityLogError::InvalidEntry {
                reason: "prepared revision is no longer the next global revision".to_owned(),
            });
        }

        let revision = prepared.entry.revision;
        let owner = match TimerOwner::new(
            format!("{}:delivery:{}", self.owner_id, revision),
            format!("authority-log/delivery/{}", revision),
            format!("redeliver revision {} until mechanical quorum", revision),
        ) {
            Ok(owner) => owner,
            Err(error) => {
                self.prepared.insert(token, prepared);
                return Err(AuthorityLogError::InvalidEntry {
                    reason: format!("delivery timer owner is invalid: {error}"),
                });
            }
        };
        let peer_stages = self
            .peer_bindings
            .iter()
            .map(|(seat_id, generation)| {
                (
                    *seat_id,
                    PeerStage {
                        connection_generation: *generation,
                        stage: STAGE_NONE,
                    },
                )
            })
            .collect();
        let entry = Arc::new(prepared.entry.clone());
        let mut lease = DeliveryLease {
            entry: Arc::clone(&entry),
            owner,
            peer_stages,
            timer_id: None,
            attempts: 0,
            next_delay_ms: self.delivery_backoff.initial_ms,
            stopped: false,
            subsumption_done: false,
        };

        let mut actions = Vec::new();
        if self.needs_delivery_timer() {
            match self.schedule_lease(&mut lease, scheduler) {
                Ok(Some(schedule)) => actions.push(schedule),
                Ok(None) => {}
                Err(error) => {
                    self.prepared.insert(token, prepared);
                    return Err(error);
                }
            }
        } else {
            lease.stopped = true;
        }
        // The scheduler registration must be emitted before delivery. A transport may synchronously feed a
        // receipt back into this log while handling Deliver; that receipt's Cancel must observe the timer
        // registration already in flight, or the later Schedule action would orphan it.
        actions.extend(self.delivery_actions(&lease));
        self.head_revision = revision;
        self.latest_committed = Some(entry);
        self.retained.insert(revision, lease);

        Ok(CommitOutcome {
            entry: prepared.entry,
            actions,
        })
    }

    pub fn reject_prepared(&mut self, token: SafeU53) -> bool {
        if self.disposed {
            return false;
        }
        if self.prepared.remove(&token).is_some() {
            // A rejected preparation must not consume token space independently of the revision domain. At
            // most one prepared commit is live, so the removed token is the next safe allocator value even
            // when its successor was SafeU53::MAX and wrapped to None.
            self.next_token = Some(token);
            true
        } else {
            false
        }
    }

    pub fn commit(
        &mut self,
        draft: AuthorityEntryDraft,
        scheduler: &mut KernelScheduler,
    ) -> Result<CommitOutcome, AuthorityLogError> {
        let prepared = self.prepare_commit(draft)?;
        match self.publish_prepared(prepared.token, scheduler) {
            Ok(outcome) => Ok(outcome),
            Err(error) => {
                let _ = self.reject_prepared(prepared.token);
                Err(error)
            }
        }
    }

    pub fn accept_receipt_detailed(
        &mut self,
        receipt: AuthorityReceipt,
        scheduler: &mut KernelScheduler,
    ) -> ReceiptOutcome {
        if self.disposed {
            return rejected_receipt(ReceiptRejectReason::Disposed);
        }
        if receipt.revision == Revision::ZERO
            || receipt.context.session_id.as_str().is_empty()
            || !valid_semantic_operation_id(&receipt.operation_id)
        {
            return rejected_receipt(ReceiptRejectReason::InvalidReceipt);
        }
        if !valid_frame_context(&receipt.context) {
            return rejected_receipt(ReceiptRejectReason::InvalidContext);
        }
        if !same_session_identity(&receipt.context, &self.local_context) {
            return rejected_receipt(ReceiptRejectReason::SessionMismatch);
        }
        if receipt.context.session_epoch != self.local_context.session_epoch {
            return rejected_receipt(ReceiptRejectReason::StaleEpoch);
        }
        let Some(lease) = self.retained.get(&receipt.revision) else {
            return rejected_receipt(ReceiptRejectReason::RevisionMismatch);
        };
        if receipt.operation_id != lease.entry.operation_id {
            return rejected_receipt(ReceiptRejectReason::OperationMismatch);
        }
        if receipt.context.authority_seat_id != self.local_context.authority_seat_id
            || lease.entry.context.authority_seat_id != self.local_context.authority_seat_id
        {
            return rejected_receipt(ReceiptRejectReason::AuthorityMismatch);
        }
        if receipt.context.sender_seat_id == self.local_context.sender_seat_id {
            return rejected_receipt(ReceiptRejectReason::SelfSigned);
        }
        if receipt.context.sender_seat_id == receipt.context.authority_seat_id {
            return rejected_receipt(ReceiptRejectReason::AuthoritySigned);
        }
        if receipt.context.membership_revision != lease.entry.context.membership_revision {
            return rejected_receipt(ReceiptRejectReason::MembershipMismatch);
        }
        let Some(binding_generation) = self.peer_bindings.get(&receipt.context.sender_seat_id)
        else {
            return rejected_receipt(ReceiptRejectReason::UnboundPeer);
        };
        let Some(peer_binding) = lease.peer_stages.get(&receipt.context.sender_seat_id) else {
            return rejected_receipt(ReceiptRejectReason::UnboundPeer);
        };
        if receipt.context.connection_generation != *binding_generation
            || receipt.context.connection_generation != peer_binding.connection_generation
        {
            return rejected_receipt(ReceiptRejectReason::ConnectionGenerationMismatch);
        }

        if receipt.stage == AckStage::ControlInstalled {
            let expected = control_id_of(&lease.entry.next_control);
            if receipt.control_id.as_deref() != Some(expected.as_str()) {
                return rejected_receipt(ReceiptRejectReason::ControlIdMismatch);
            }
        } else if receipt.control_id.is_some() {
            return rejected_receipt(ReceiptRejectReason::UnexpectedControlId);
        }

        let stage = stage_rank(receipt.stage);
        let peer_stage = lease
            .peer_stages
            .get(&receipt.context.sender_seat_id)
            .map_or(STAGE_NONE, |peer| peer.stage);
        if receipt.stage == AckStage::PresentationSettled && peer_stage < STAGE_CONTROL_INSTALLED {
            return rejected_receipt(ReceiptRejectReason::PresentationBeforeMechanical);
        }
        if stage <= peer_stage {
            let highest_stage = ack_stage(peer_stage);
            if let Some(highest_stage) = highest_stage {
                return ReceiptOutcome {
                    verdict: AuthorityReceiptVerdict::Duplicate { highest_stage },
                    actions: Vec::new(),
                };
            }
            return rejected_receipt(ReceiptRejectReason::InvalidReceipt);
        }

        let revision = receipt.revision;
        let sender = receipt.context.sender_seat_id;
        let (
            subsumes,
            should_retire_subsumed,
            should_retire_current,
            waiting_for,
            should_redeliver_after_control,
        ) = {
            let Some(lease) = self.retained.get_mut(&revision) else {
                return rejected_receipt(ReceiptRejectReason::RevisionMismatch);
            };
            let Some(peer) = lease.peer_stages.get_mut(&sender) else {
                return rejected_receipt(ReceiptRejectReason::UnboundPeer);
            };
            peer.stage = stage;
            let all_admitted = lease
                .peer_stages
                .values()
                .all(|peer| peer.stage >= STAGE_ADMITTED);
            let should_retire_subsumed = all_admitted && !lease.subsumption_done;
            if should_retire_subsumed {
                lease.subsumption_done = true;
            }
            let required_stage = retirement_stage(&lease.entry);
            let waiting_stage = waiting_stage(&lease.entry);
            let should_retire_current = required_stage.is_some_and(|required_stage| {
                lease
                    .peer_stages
                    .values()
                    .all(|peer| peer.stage >= required_stage)
            });
            let waiting_for = lease
                .peer_stages
                .iter()
                .filter_map(|(seat_id, peer)| (peer.stage < waiting_stage).then_some(*seat_id))
                .collect::<Vec<_>>();
            let should_redeliver_after_control = receipt.stage == AckStage::ControlInstalled
                && waiting_stage > STAGE_CONTROL_INSTALLED;
            (
                lease.entry.subsumes.clone(),
                should_retire_subsumed,
                should_retire_current,
                waiting_for,
                should_redeliver_after_control,
            )
        };

        let mut actions = Vec::new();
        if should_retire_subsumed {
            for subsumed in subsumes {
                if subsumed != revision {
                    self.retire(subsumed, &mut actions, scheduler);
                }
            }
        }
        // Stage monotonicity above makes this a one-shot redelivery per peer. It intentionally does
        // not inspect or replace the lease timer: stopped leases still need this exact post-control
        // probe.
        if should_redeliver_after_control {
            self.redeliver_immediate_peer(revision, sender, &mut actions);
        }
        if should_retire_current {
            let retired = self.retire(revision, &mut actions, scheduler);
            if retired {
                self.redeliver_immediate_successor(revision, &mut actions);
            }
            return ReceiptOutcome {
                verdict: AuthorityReceiptVerdict::Advanced {
                    retired,
                    waiting_for_seat_ids: Vec::new(),
                },
                actions,
            };
        }
        ReceiptOutcome {
            verdict: AuthorityReceiptVerdict::Advanced {
                retired: false,
                waiting_for_seat_ids: waiting_for,
            },
            actions,
        }
    }

    pub fn accept_receipt(
        &mut self,
        receipt: AuthorityReceipt,
        scheduler: &mut KernelScheduler,
    ) -> (bool, Vec<AuthorityLogAction>) {
        let outcome = self.accept_receipt_detailed(receipt, scheduler);
        let retired = matches!(
            outcome.verdict,
            AuthorityReceiptVerdict::Advanced { retired: true, .. }
        );
        (retired, outcome.actions)
    }

    pub fn peer_stage_quorum(&self, operation_id: &OperationId, stage: AckStage) -> bool {
        if self.disposed {
            return false;
        }
        let required = stage_rank(stage);
        if let Some(lease) = self
            .retained
            .values()
            .find(|lease| &lease.entry.operation_id == operation_id)
        {
            return lease
                .peer_stages
                .values()
                .all(|peer| peer.stage >= required);
        }
        self.retired_operation_stages
            .get(operation_id)
            .is_some_and(|highest| *highest >= required)
    }

    pub fn timer_fired(
        &mut self,
        fired: ScheduledTimer,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<AuthorityLogAction>, AuthorityLogError> {
        if self.disposed {
            return Err(AuthorityLogError::Disposed);
        }
        let revision = self.retained.iter().find_map(|(revision, lease)| {
            (lease.timer_id == Some(fired.timer_id)).then_some(*revision)
        });
        let Some(revision) = revision else {
            return Err(AuthorityLogError::InvalidEntry {
                reason: format!("delivery timer {} is not live", fired.timer_id),
            });
        };

        // The scheduler removes a due timer before delivering it. Validate every field of that removed
        // registration against the lease before touching authority state; a stale or cross-owner event must
        // never advance attempts, replace a lease, or emit delivery actions.
        let Some(lease) = self.retained.get(&revision) else {
            return Err(AuthorityLogError::InvalidEntry {
                reason: format!("delivery lease for revision {} is not live", revision),
            });
        };
        if fired.endpoint != self.local_context.sender_seat_id
            || fired.owner != lease.owner
            || fired.delay_ms != lease.next_delay_ms
            || fired.time_class != self.delivery_time_class
        {
            return Err(AuthorityLogError::InvalidEntry {
                reason: format!(
                    "delivery timer {} identity does not match its lease",
                    fired.timer_id
                ),
            });
        }

        let mut lease = match self.retained.remove(&revision) {
            Some(lease) => lease,
            None => {
                return Err(AuthorityLogError::InvalidEntry {
                    reason: format!("delivery lease for revision {} is not live", revision),
                });
            }
        };
        lease.timer_id = None;
        if lease.stopped {
            self.retained.insert(revision, lease);
            return Ok(Vec::new());
        }

        let next_attempts = lease.attempts.saturating_add(1);
        let mut actions = Vec::new();
        if self
            .max_delivery_attempts
            .is_some_and(|maximum| next_attempts >= maximum.get())
        {
            lease.attempts = next_attempts;
            lease.stopped = true;
        } else {
            let mut scheduled_lease = lease.clone();
            scheduled_lease.attempts = next_attempts;
            scheduled_lease.next_delay_ms =
                next_backoff_delay(lease.next_delay_ms, self.delivery_backoff);
            match self.schedule_lease(&mut scheduled_lease, scheduler) {
                Ok(Some(schedule)) => {
                    lease = scheduled_lease;
                    actions.push(schedule);
                }
                Ok(None) => {
                    // This is unreachable for a live, below-cap lease, but keep the failure terminal and
                    // preserve the last published attempt/delay if a future scheduler policy makes it
                    // possible.
                    lease.stopped = true;
                }
                Err(error) => {
                    // The due registration was already consumed by the scheduler. The proposed attempt and
                    // delay were never published because allocation failed; retain the entry as a stopped
                    // terminal lease rather than leaving an unresolved lease with no live timer.
                    lease.stopped = true;
                    self.retained.insert(revision, lease);
                    return Err(error);
                }
            }
        }
        // Keep the schedule ahead of delivery for the same synchronous receipt/cancellation ordering as the
        // initial commit path. The due timer was removed by the scheduler before this method was called;
        // any new timer must be registered before a delivery can retire the lease.
        actions.extend(self.delivery_actions(&lease));
        self.retained.insert(revision, lease);
        Ok(actions)
    }

    pub fn recovery_slice(&self, captured_frontier: Revision) -> Option<AuthorityRecoverySlice> {
        if self.disposed || captured_frontier > self.head_revision {
            return None;
        }
        if captured_frontier == self.head_revision {
            if self.head_revision == Revision::ZERO {
                return Some(AuthorityRecoverySlice {
                    frontier: Revision::ZERO,
                    frontier_operation_id: None,
                    next_control: None,
                    required_tail: Vec::new(),
                });
            }
            let latest = self.latest_committed.as_ref()?;
            if latest.revision != self.head_revision {
                return None;
            }
            return Some(AuthorityRecoverySlice {
                frontier: self.head_revision,
                frontier_operation_id: Some(latest.operation_id.clone()),
                next_control: Some(latest.next_control.clone()),
                required_tail: vec![latest.as_ref().clone()],
            });
        }

        let mut required_tail = Vec::new();
        let start = captured_frontier.get().get().checked_add(1)?;
        let end = self.head_revision.get().get();
        let mut revision = start;
        while revision <= end {
            let revision_id = Revision::new(SafeU53::new(revision).ok()?);
            required_tail.push(self.retained.get(&revision_id)?.entry.as_ref().clone());
            revision = revision.checked_add(1)?;
        }
        let last = required_tail.last()?;
        Some(AuthorityRecoverySlice {
            frontier: self.head_revision,
            frontier_operation_id: Some(last.operation_id.clone()),
            next_control: Some(last.next_control.clone()),
            required_tail,
        })
    }

    /// Answer one authenticated correlated boundary-proof request.
    ///
    /// Ordinary tail requests deliberately remain on [`Self::recovery_slice`].
    /// The correlated tuple is all-or-none, sequence-fenced per peer, and a
    /// successful response is frozen until its exact candidate retires.
    pub fn handle_tail_proof_request(
        &mut self,
        context: FrameContext,
        request: TailRequestBody,
    ) -> Vec<AuthorityLogAction> {
        if self.disposed
            || !matches!(
                (
                    request.request_id.as_ref(),
                    request.candidate_revision,
                    request.candidate_operation_id.as_ref(),
                ),
                (Some(_), Some(_), Some(_))
            )
        {
            return Vec::new();
        }
        let Some(generation) = self.peer_bindings.get(&context.sender_seat_id) else {
            return Vec::new();
        };
        if context.sender_seat_id == self.local_context.sender_seat_id
            || context.sender_seat_id == context.authority_seat_id
            || context.authority_seat_id != self.local_context.authority_seat_id
            || context.connection_generation != *generation
            || !frame_contexts_compatible(&context, &self.local_context)
        {
            return Vec::new();
        }

        let candidate = request
            .candidate_revision
            .and_then(|revision| self.retained.get(&revision))
            .map(|lease| lease.entry.as_ref().clone());
        let live_sources = self.retained();
        let authority_context = self.local_context.clone();
        let to = context.sender_seat_id;
        self.tail_proof
            .handle_request(TailProofRequestContext {
                request_context: &context,
                authority_context: &authority_context,
                request: &request,
                candidate: candidate.as_ref(),
                live_sources: &live_sources,
                head_revision: self.head_revision,
                capacity: self.retain_capacity,
            })
            .into_iter()
            .map(|emission| match emission {
                TailProofAuthorityEmission::Proof { context, body } => {
                    AuthorityLogAction::TailProof { to, context, body }
                }
                TailProofAuthorityEmission::Source { entry } => AuthorityLogAction::Deliver {
                    to,
                    entry: Box::new(entry),
                },
            })
            .collect()
    }

    pub fn rebind_connection(
        &mut self,
        local_context: FrameContext,
        peer_bindings: Vec<PeerBinding>,
    ) -> Result<AuthorityRebindOutcome, AuthorityLogError> {
        if self.disposed {
            return Err(AuthorityLogError::Disposed);
        }
        if !valid_frame_context(&local_context)
            || local_context.sender_seat_id != local_context.authority_seat_id
        {
            return Err(AuthorityLogError::InvalidConfig {
                reason: "rebind context is not a valid local authority context".to_owned(),
            });
        }
        if !same_session_identity(&local_context, &self.local_context)
            || local_context.session_epoch != self.local_context.session_epoch
            || local_context.sender_seat_id != self.local_context.sender_seat_id
            || local_context.authority_seat_id != self.local_context.authority_seat_id
            || local_context.membership_revision < self.local_context.membership_revision
            || local_context.connection_generation < self.local_context.connection_generation
        {
            return Err(AuthorityLogError::InvalidConfig {
                reason: "rebind changed or rolled back a stable authenticated axis".to_owned(),
            });
        }
        let next_peers = validate_peer_bindings(&local_context, &peer_bindings)?;
        if next_peers.len() != self.peer_bindings.len()
            || next_peers.keys().ne(self.peer_bindings.keys())
        {
            return Err(AuthorityLogError::InvalidConfig {
                reason: "rebind changed the authenticated peer quorum".to_owned(),
            });
        }
        for (seat_id, prior_generation) in &self.peer_bindings {
            let Some(next_generation) = next_peers.get(seat_id) else {
                return Err(AuthorityLogError::InvalidConfig {
                    reason: "rebind removed an authenticated peer".to_owned(),
                });
            };
            if next_generation < prior_generation {
                return Err(AuthorityLogError::InvalidConfig {
                    reason: "rebind rolled a peer connection generation back".to_owned(),
                });
            }
        }
        let changed = local_context.membership_revision != self.local_context.membership_revision
            || local_context.connection_generation != self.local_context.connection_generation
            || next_peers != self.peer_bindings;
        if !changed {
            return Ok(AuthorityRebindOutcome {
                retained_count: SafeU53::ZERO,
                actions: Vec::new(),
            });
        }
        if !self.prepared.is_empty() {
            return Err(AuthorityLogError::InvalidConfig {
                reason: "rebind cannot occur while a commit is prepared".to_owned(),
            });
        }
        let retained_count =
            u64::try_from(self.retained.len()).map_err(|_| AuthorityLogError::InvalidConfig {
                reason: "retained entry count exceeds SafeU53".to_owned(),
            })?;
        let retained_count =
            SafeU53::new(retained_count).map_err(|_| AuthorityLogError::InvalidConfig {
                reason: "retained entry count exceeds SafeU53".to_owned(),
            })?;

        // All validation and fallible conversion is complete before replacing the authenticated binding.
        // Rebind intentionally does not touch the scheduler: existing timer registrations, IDs, attempts,
        // delays, stages, and lease owners remain live exactly as they were.
        self.local_context = local_context.clone();
        self.peer_bindings = next_peers;
        let rebound_head = self.retained.get_mut(&self.head_revision).map(|lease| {
            Arc::make_mut(&mut lease.entry).context = local_context.clone();
            Arc::clone(&lease.entry)
        });
        for (revision, lease) in &mut self.retained {
            if *revision != self.head_revision {
                Arc::make_mut(&mut lease.entry).context = local_context.clone();
            }
            for (seat_id, peer) in &mut lease.peer_stages {
                if let Some(generation) = self.peer_bindings.get(seat_id) {
                    peer.connection_generation = *generation;
                }
            }
        }
        if let Some(rebound_head) = rebound_head {
            self.latest_committed = Some(rebound_head);
        } else if let Some(latest) = self.latest_committed.as_mut() {
            Arc::make_mut(latest).context = local_context.clone();
        }
        self.tail_proof.rebind(&local_context);

        let mut actions = Vec::new();
        for lease in self.retained.values() {
            actions.extend(self.delivery_actions(lease));
        }
        Ok(AuthorityRebindOutcome {
            retained_count,
            actions,
        })
    }

    pub fn retained_entry(&self, revision: Revision) -> Option<&AuthorityEntry> {
        self.retained
            .get(&revision)
            .map(|lease| lease.entry.as_ref())
    }

    pub fn retained(&self) -> Vec<AuthorityEntry> {
        self.retained
            .values()
            .map(|lease| lease.entry.as_ref().clone())
            .collect()
    }

    pub fn head_revision(&self) -> Revision {
        self.head_revision
    }

    pub fn diagnostics(&self) -> AuthorityLogDiagnostics {
        let mut peer_stages = BTreeMap::new();
        let mut delivery_timer_ids = BTreeSet::new();
        let mut delivery_owner_ids = BTreeSet::new();
        let mut retained_revisions = BTreeSet::new();
        for (revision, lease) in &self.retained {
            retained_revisions.insert(*revision);
            delivery_owner_ids.insert(lease.owner.owner_id.clone());
            if let Some(timer_id) = lease.timer_id {
                delivery_timer_ids.insert(timer_id);
            }
            let stages = lease
                .peer_stages
                .iter()
                .filter_map(|(seat_id, peer)| ack_stage(peer.stage).map(|stage| (*seat_id, stage)))
                .collect::<BTreeMap<_, _>>();
            peer_stages.insert(*revision, stages);
        }
        AuthorityLogDiagnostics {
            head_revision: self.head_revision,
            retained_revisions,
            delivery_timer_ids,
            delivery_owner_ids,
            peer_stages,
            capacity_refusals: self.capacity_refusals,
            send_failures: self.send_failures,
            retired_tail_proof_sources: safe_count(self.tail_proof.retired_source_count()),
            tail_proof_responses: safe_count(self.tail_proof.response_count()),
            disposed: self.disposed,
        }
    }

    pub fn dispose(
        &mut self,
        _reason: &str,
        scheduler: &mut KernelScheduler,
    ) -> Vec<AuthorityLogAction> {
        if self.disposed {
            return Vec::new();
        }
        self.disposed = true;
        let timer_ids = self
            .retained
            .values_mut()
            .filter_map(|lease| {
                lease.stopped = true;
                lease.timer_id.take()
            })
            .collect::<Vec<_>>();
        let mut actions = Vec::new();
        for timer_id in timer_ids {
            if let Some(command) = scheduler.cancel(timer_id) {
                actions.push(AuthorityLogAction::Scheduler { command });
            }
        }
        self.retained.clear();
        self.prepared.clear();
        self.latest_committed = None;
        self.head_revision = Revision::ZERO;
        self.retired_operation_stages.clear();
        self.retired_operation_order.clear();
        self.tail_proof.clear();
        actions
    }

    fn validate_entry(&self, entry: &AuthorityEntry) -> Result<(), AuthorityLogError> {
        self.validate_entry_shape(entry)?;
        if let Some(previous) = &self.latest_committed {
            if matches!(previous.next_control, NextControl::Terminal(_)) {
                return Err(AuthorityLogError::TerminalPredecessor);
            }
            let ordinary_successor = control_allows_successor_entry(
                &previous.next_control,
                &previous.operation_id,
                entry,
            );
            let boundary_successor = !ordinary_successor
                && boundary_supersession_allows(previous, entry, &self.retained());
            if !ordinary_successor && !boundary_successor {
                return Err(AuthorityLogError::SuccessorRejected);
            }
        }
        Ok(())
    }

    fn validate_entry_shape(&self, entry: &AuthorityEntry) -> Result<(), AuthorityLogError> {
        if !valid_frame_context(&entry.context) {
            return Err(AuthorityLogError::InvalidEntry {
                reason: "entry context is malformed".to_owned(),
            });
        }
        if entry.context != self.local_context {
            return Err(AuthorityLogError::ContextMismatch);
        }
        if !valid_semantic_operation_id(&entry.operation_id) {
            return Err(AuthorityLogError::InvalidEntry {
                reason: "operation id must be a non-empty wire-safe string of at most 256 UTF-16 code units"
                    .to_owned(),
            });
        }
        if validate_authority_material_digest(&entry.material.digest).is_err() {
            return Err(AuthorityLogError::InvalidEntry {
                reason: "material digest must be non-empty and at most 256 UTF-16 code units"
                    .to_owned(),
            });
        }
        let next_control_value = serde_json::to_value(&entry.next_control).map_err(|_| {
            AuthorityLogError::InvalidEntry {
                reason: "next control cannot be represented as a wire value".to_owned(),
            }
        })?;
        if !is_valid_next_control(&next_control_value) {
            return Err(AuthorityLogError::InvalidEntry {
                reason: "next control is malformed".to_owned(),
            });
        }
        if (entry.kind == AuthorityEntryKind::TerminalCommit)
            != matches!(entry.next_control, NextControl::Terminal(_))
        {
            return Err(AuthorityLogError::InvalidEntry {
                reason: "entry kind and successor control are incompatible".to_owned(),
            });
        }
        if entry.subsumes.contains(&Revision::ZERO) {
            return Err(AuthorityLogError::InvalidEntry {
                reason: "subsumed revisions must be positive".to_owned(),
            });
        }
        Ok(())
    }

    fn next_revision(&self) -> Result<Revision, AuthorityLogError> {
        next_revision_value(self.head_revision)
    }

    fn needs_delivery_timer(&self) -> bool {
        !self.peer_bindings.is_empty()
            && !self
                .max_delivery_attempts
                .is_some_and(|maximum| maximum.get() == 0)
    }

    fn delivery_actions(&self, lease: &DeliveryLease) -> Vec<AuthorityLogAction> {
        self.peer_bindings
            .keys()
            .map(|seat_id| AuthorityLogAction::Deliver {
                to: *seat_id,
                entry: Box::new(lease.entry.as_ref().clone()),
            })
            .collect()
    }

    fn schedule_lease(
        &mut self,
        lease: &mut DeliveryLease,
        scheduler: &mut KernelScheduler,
    ) -> Result<Option<AuthorityLogAction>, AuthorityLogError> {
        if lease.stopped
            || self
                .max_delivery_attempts
                .is_some_and(|maximum| lease.attempts >= maximum.get())
        {
            lease.stopped = true;
            return Ok(None);
        }
        let command = scheduler.schedule(
            self.local_context.sender_seat_id,
            lease.owner.clone(),
            lease.next_delay_ms,
            self.delivery_time_class,
        )?;
        let timer_id = match &command {
            SchedulerCommand::Schedule { timer } => timer.timer_id,
            _ => {
                return Err(AuthorityLogError::InvalidEntry {
                    reason: "scheduler returned a non-schedule command for delivery".to_owned(),
                });
            }
        };
        lease.timer_id = Some(timer_id);
        Ok(Some(AuthorityLogAction::Scheduler { command }))
    }

    fn retire(
        &mut self,
        revision: Revision,
        actions: &mut Vec<AuthorityLogAction>,
        scheduler: &mut KernelScheduler,
    ) -> bool {
        let Some(entry) = self
            .retained
            .get(&revision)
            .map(|lease| lease.entry.as_ref().clone())
        else {
            return false;
        };
        if !self
            .tail_proof
            .archive_retired(&entry, self.retain_capacity)
        {
            return false;
        }
        let Some(lease) = self.retained.remove(&revision) else {
            return false;
        };
        let quorum_stage = lease
            .peer_stages
            .values()
            .map(|peer| peer.stage)
            .min()
            .unwrap_or(STAGE_NONE);
        self.record_retired_stage(lease.entry.operation_id.clone(), quorum_stage);
        if let Some(timer_id) = lease.timer_id
            && let Some(command) = scheduler.cancel(timer_id)
        {
            actions.push(AuthorityLogAction::Scheduler { command });
        }
        self.tail_proof.release_candidate(revision);
        true
    }

    fn redeliver_immediate_successor(
        &self,
        retired_revision: Revision,
        actions: &mut Vec<AuthorityLogAction>,
    ) {
        let Some(next) = next_revision_value(retired_revision).ok() else {
            return;
        };
        let Some(successor) = self.retained.get(&next) else {
            return;
        };
        if successor.stopped {
            return;
        }
        actions.extend(self.delivery_actions(successor));
    }

    fn redeliver_immediate_peer(
        &self,
        revision: Revision,
        to: SeatId,
        actions: &mut Vec<AuthorityLogAction>,
    ) {
        let Some(lease) = self.retained.get(&revision) else {
            return;
        };
        actions.push(AuthorityLogAction::Deliver {
            to,
            entry: Box::new(lease.entry.as_ref().clone()),
        });
    }

    fn record_retired_stage(&mut self, operation_id: OperationId, stage: i8) {
        if !self.retired_operation_stages.contains_key(&operation_id) {
            self.retired_operation_order.push_back(operation_id.clone());
        }
        self.retired_operation_stages.insert(operation_id, stage);
        while self.retired_operation_order.len() as u64 > self.retain_capacity.get() {
            let Some(oldest) = self.retired_operation_order.pop_front() else {
                break;
            };
            self.retired_operation_stages.remove(&oldest);
        }
    }
}

/// Return the peer stage at which an entry may retire itself.  An
/// `AwaitSuccessor` control that admits a terminal successor is the final
/// battle predecessor: it remains retained until that successor's admitted
/// quorum subsumes it.
fn retirement_stage(entry: &AuthorityEntry) -> Option<i8> {
    match &entry.next_control {
        NextControl::AwaitSuccessor(_) if is_terminal_predecessor(entry) => None,
        NextControl::Terminal(_) => Some(STAGE_PRESENTATION_SETTLED),
        _ => Some(STAGE_CONTROL_INSTALLED),
    }
}

fn is_terminal_predecessor(entry: &AuthorityEntry) -> bool {
    if !matches!(
        entry.kind,
        AuthorityEntryKind::TurnCommit | AuthorityEntryKind::ReplacementCommit
    ) {
        return false;
    }
    let NextControl::AwaitSuccessor(control) = &entry.next_control else {
        return false;
    };
    control.allowed_kinds.as_slice() == [AuthorityEntryKind::TerminalCommit]
        && control.allowed_interaction_addresses.is_none()
        && control.allowed_control_addresses.is_none()
        && !control.allow_next_wave_start
        && control.expected_operation_id.is_some()
}

/// Return the peer stage represented by `waiting_for_seat_ids`.  The final
/// predecessor has no self-retirement stage, but it still has a meaningful
/// presentation frontier before the terminal successor can complete it.
fn waiting_stage(entry: &AuthorityEntry) -> i8 {
    match retirement_stage(entry) {
        Some(stage) => stage,
        None => STAGE_PRESENTATION_SETTLED,
    }
}

impl AuthorityLogSnapshotBridge for AuthorityLog {
    fn snapshot_v2(&self) -> Result<AuthorityLogSnapshotV2, SnapshotError> {
        if !self.prepared.is_empty() {
            return Err(snapshot_invalid(
                "authority_log.prepared",
                "a public authority snapshot cannot contain a prepared commit",
            ));
        }

        let retained = self
            .retained
            .iter()
            .map(|(revision, lease)| {
                Ok(AuthorityDeliveryLeaseSnapshotV2 {
                    revision: *revision,
                    entry: authority_entry_snapshot(
                        lease.entry.as_ref(),
                        "authority_log.retained.entry",
                    )?,
                    owner: lease.owner.clone(),
                    peer_stages: lease
                        .peer_stages
                        .iter()
                        .map(|(seat, peer)| AuthorityDeliveryPeerStageSnapshotV2 {
                            seat: *seat,
                            generation: peer.connection_generation,
                            stage: authority_delivery_stage(peer.stage),
                        })
                        .collect(),
                    timer_id: lease.timer_id,
                    attempts: CanonicalU64Decimal::new(lease.attempts.to_string()).map_err(
                        |error| {
                            snapshot_canonical("authority_log.retained.attempts", error.to_string())
                        },
                    )?,
                    next_delay_ms: lease.next_delay_ms,
                    stopped: lease.stopped,
                    subsumption_done: lease.subsumption_done,
                })
            })
            .collect::<Result<Vec<_>, SnapshotError>>()?;
        let retired_operation_stages = self
            .retired_operation_stages
            .iter()
            .map(|(operation_id, stage)| RetiredOperationStageSnapshotV2 {
                operation_id: operation_id.clone(),
                stage: authority_delivery_stage(*stage),
            })
            .collect();
        let snapshot = AuthorityLogSnapshotV2 {
            local_context: self.local_context.clone(),
            peer_bindings: self
                .peer_bindings
                .iter()
                .map(|(seat, generation)| PeerBindingSnapshotV2 {
                    seat: *seat,
                    generation: *generation,
                })
                .collect(),
            owner_id: self.owner_id.clone(),
            retain_capacity: self.retain_capacity,
            delivery_backoff: self.delivery_backoff,
            delivery_time_class: self.delivery_time_class,
            max_delivery_attempts: self.max_delivery_attempts,
            retained,
            next_prepared_token: self.next_token,
            latest_committed: self
                .latest_committed
                .as_ref()
                .map(|entry| {
                    authority_entry_snapshot(entry.as_ref(), "authority_log.latest_committed")
                })
                .transpose()?,
            head_revision: self.head_revision,
            retired_operation_stages,
            retired_operation_order: self.retired_operation_order.iter().cloned().collect(),
            capacity_refusals: self.capacity_refusals,
            send_failures: self.send_failures,
            tail_proof: self.tail_proof.snapshot_v2()?,
            disposed: self.disposed,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    fn from_snapshot_v2(
        snapshot: AuthorityLogSnapshotV2,
        scheduler: &mut KernelScheduler,
    ) -> Result<Self, SnapshotError> {
        // This is deliberately the first operation: no owner or scheduler
        // state is inspected or changed before the closed DTO validates.
        snapshot.validate()?;
        if snapshot
            .next_prepared_token
            .is_some_and(|token| token == SafeU53::ZERO)
        {
            return Err(snapshot_invalid(
                "authority_log.next_prepared_token",
                "the prepared-token allocator starts at one",
            ));
        }

        let config = AuthorityLogConfig {
            local_context: snapshot.local_context.clone(),
            peer_bindings: snapshot
                .peer_bindings
                .iter()
                .map(|binding| PeerBinding {
                    seat_id: binding.seat,
                    connection_generation: binding.generation,
                })
                .collect(),
            owner_id: snapshot.owner_id.clone(),
            retain_capacity: snapshot.retain_capacity,
            delivery_backoff: snapshot.delivery_backoff,
            delivery_time_class: snapshot.delivery_time_class,
            max_delivery_attempts: snapshot.max_delivery_attempts,
        };
        validate_config(&config, !config.peer_bindings.is_empty())
            .map_err(|error| snapshot_invalid("authority_log", error.to_string()))?;

        let AuthorityLogSnapshotV2 {
            local_context,
            peer_bindings: snapshot_peer_bindings,
            owner_id,
            retain_capacity,
            delivery_backoff,
            delivery_time_class,
            max_delivery_attempts,
            retained,
            next_prepared_token,
            latest_committed,
            head_revision,
            retired_operation_stages,
            retired_operation_order,
            capacity_refusals,
            send_failures,
            tail_proof,
            disposed,
        } = snapshot;

        let mut peer_bindings = BTreeMap::new();
        for binding in snapshot_peer_bindings {
            if peer_bindings
                .insert(binding.seat, binding.generation)
                .is_some()
            {
                return Err(snapshot_invalid(
                    "authority_log.peer_bindings",
                    "peer binding seats must be unique",
                ));
            }
        }

        let latest_committed = latest_committed
            .map(|entry| authority_entry_from_snapshot(&entry, "authority_log.latest_committed"))
            .transpose()?
            .map(Arc::new);
        if let Some(entry) = &latest_committed {
            if entry.revision != head_revision || entry.revision == Revision::ZERO {
                return Err(snapshot_invalid(
                    "authority_log.latest_committed",
                    "latest committed entry must be the positive head revision",
                ));
            }
        } else if head_revision != Revision::ZERO {
            return Err(snapshot_invalid(
                "authority_log.head_revision",
                "a non-zero head requires a latest committed entry",
            ));
        }

        let mut retired_stages = BTreeMap::new();
        for retired in retired_operation_stages {
            if !valid_semantic_operation_id(&retired.operation_id) {
                return Err(snapshot_invalid(
                    "authority_log.retired_operation_stages.operation_id",
                    "retired operation IDs must be valid semantic operation IDs",
                ));
            }
            if retired_stages
                .insert(
                    retired.operation_id,
                    authority_delivery_stage_rank(retired.stage),
                )
                .is_some()
            {
                return Err(snapshot_invalid(
                    "authority_log.retired_operation_stages",
                    "retired operation IDs must be unique",
                ));
            }
        }
        if retired_operation_order.len() as u64 > retain_capacity.get() {
            return Err(snapshot_invalid(
                "authority_log.retired_operation_order",
                "retired operation order exceeds retention capacity",
            ));
        }
        let retired_operation_order_set = retired_operation_order
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if retired_operation_order_set.len() != retired_operation_order.len()
            || retired_operation_order_set
                != retired_stages.keys().cloned().collect::<BTreeSet<_>>()
        {
            return Err(snapshot_invalid(
                "authority_log.retired_operation_order",
                "retired causal order must contain exactly the retired operation IDs",
            ));
        }

        let mut restored = Self {
            local_context,
            peer_bindings,
            owner_id,
            retain_capacity,
            delivery_backoff,
            delivery_time_class,
            max_delivery_attempts,
            retained: BTreeMap::new(),
            prepared: BTreeMap::new(),
            next_token: next_prepared_token,
            latest_committed,
            head_revision,
            retired_operation_stages: retired_stages,
            retired_operation_order: VecDeque::from(retired_operation_order),
            capacity_refusals,
            send_failures,
            tail_proof: TailProofAuthorityState::default(),
            disposed,
        };

        if let Some(entry) = restored.latest_committed.as_ref() {
            restored
                .validate_entry_shape(entry.as_ref())
                .map_err(|error| {
                    snapshot_invalid("authority_log.latest_committed", error.to_string())
                })?;
        }

        let mut timer_ids = BTreeSet::new();
        for lease_snapshot in retained {
            let revision = lease_snapshot.revision;
            if revision == Revision::ZERO || revision > restored.head_revision {
                return Err(snapshot_invalid(
                    "authority_log.retained.revision",
                    "retained revisions must be positive and no greater than the head",
                ));
            }
            let entry = authority_entry_from_snapshot(
                &lease_snapshot.entry,
                "authority_log.retained.entry",
            )?;
            if entry.revision != revision {
                return Err(snapshot_invalid(
                    "authority_log.retained.revision",
                    "retained revision must equal the decoded entry revision",
                ));
            }
            restored.validate_entry_shape(&entry).map_err(|error| {
                snapshot_invalid("authority_log.retained.entry", error.to_string())
            })?;

            let entry = if revision == restored.head_revision {
                let Some(latest_committed) = restored.latest_committed.as_ref() else {
                    return Err(snapshot_invalid(
                        "authority_log.retained.entry",
                        "retained head entry requires latest_committed",
                    ));
                };
                if &entry != latest_committed.as_ref() {
                    return Err(snapshot_invalid(
                        "authority_log.retained.entry",
                        "retained head entry must equal latest_committed as a complete AuthorityEntry",
                    ));
                }
                Arc::clone(latest_committed)
            } else {
                Arc::new(entry)
            };

            let expected_owner = delivery_timer_owner(&restored.owner_id, revision)?;
            if lease_snapshot.owner != expected_owner {
                return Err(snapshot_invalid(
                    "authority_log.retained.owner",
                    "delivery timer owner does not match the authority revision",
                ));
            }
            let mut peer_stages = BTreeMap::new();
            for stage in lease_snapshot.peer_stages {
                let Some(expected_generation) = restored.peer_bindings.get(&stage.seat) else {
                    return Err(snapshot_invalid(
                        "authority_log.retained.peer_stages",
                        "delivery stage names an unbound peer",
                    ));
                };
                if *expected_generation != stage.generation {
                    return Err(snapshot_invalid(
                        "authority_log.retained.peer_stages",
                        "delivery stage generation differs from its peer binding",
                    ));
                }
                if peer_stages
                    .insert(
                        stage.seat,
                        PeerStage {
                            connection_generation: stage.generation,
                            stage: authority_delivery_stage_rank(stage.stage),
                        },
                    )
                    .is_some()
                {
                    return Err(snapshot_invalid(
                        "authority_log.retained.peer_stages",
                        "delivery peer stages must be unique",
                    ));
                }
            }
            if peer_stages.len() != restored.peer_bindings.len()
                || peer_stages.keys().ne(restored.peer_bindings.keys())
            {
                return Err(snapshot_invalid(
                    "authority_log.retained.peer_stages",
                    "every configured peer must retain exactly one delivery stage",
                ));
            }
            let all_admitted = !peer_stages.is_empty()
                && peer_stages
                    .values()
                    .all(|peer| peer.stage >= STAGE_ADMITTED);
            if !peer_stages.is_empty() && lease_snapshot.subsumption_done != all_admitted {
                return Err(snapshot_invalid(
                    "authority_log.retained.subsumption_done",
                    "subsumption completion must equal the all-peers-admitted frontier",
                ));
            }
            if !lease_snapshot.stopped && lease_snapshot.timer_id.is_none() {
                return Err(snapshot_invalid(
                    "authority_log.retained.timer_id",
                    "a live delivery lease must retain its scheduler timer",
                ));
            }
            if lease_snapshot.next_delay_ms < restored.delivery_backoff.initial_ms
                || lease_snapshot.next_delay_ms > restored.delivery_backoff.maximum_ms
            {
                return Err(snapshot_invalid(
                    "authority_log.retained.next_delay_ms",
                    "delivery delay must remain within the configured backoff bounds",
                ));
            }
            if let Some(timer_id) = lease_snapshot.timer_id
                && !timer_ids.insert(timer_id)
            {
                return Err(snapshot_invalid(
                    "authority_log.retained.timer_id",
                    "delivery timer IDs must be unique",
                ));
            }

            restored.retained.insert(
                revision,
                DeliveryLease {
                    entry,
                    owner: lease_snapshot.owner,
                    peer_stages,
                    timer_id: lease_snapshot.timer_id,
                    attempts: lease_snapshot.attempts.as_u64(),
                    next_delay_ms: lease_snapshot.next_delay_ms,
                    stopped: lease_snapshot.stopped,
                    subsumption_done: lease_snapshot.subsumption_done,
                },
            );
        }

        let live_entries = restored
            .retained
            .iter()
            .map(|(revision, lease)| (*revision, lease.entry.as_ref().clone()))
            .collect::<BTreeMap<_, _>>();
        restored.tail_proof = TailProofAuthorityState::from_snapshot_v2(
            &tail_proof,
            &restored.local_context,
            &restored.peer_bindings,
            restored.retain_capacity,
            restored.head_revision,
            &live_entries,
        )?;

        cross_check_authority_timers(&restored, scheduler)?;
        Ok(restored)
    }
}

fn snapshot_invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn snapshot_canonical(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

fn authority_entry_snapshot(
    entry: &AuthorityEntry,
    path: &str,
) -> Result<OpaqueAuthorityEntrySnapshotV2, SnapshotError> {
    let canonical_bytes = er_canonical::canonical_bytes(entry)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    let snapshot = OpaqueAuthorityEntrySnapshotV2 {
        identity: AuthorityEntryIdentitySnapshotV2 {
            revision: entry.revision,
            context: entry.context.clone(),
            operation_id: entry.operation_id.clone(),
            kind: entry.kind,
            material_digest: entry.material.digest.clone(),
            next_control_id: control_id_of(&entry.next_control),
            subsumes: entry.subsumes.clone(),
        },
        canonical_entry_bytes: CanonicalHexBytes::from_bytes(&canonical_bytes),
    };
    snapshot.validate()?;
    Ok(snapshot)
}

fn authority_entry_from_snapshot(
    snapshot: &OpaqueAuthorityEntrySnapshotV2,
    path: &str,
) -> Result<AuthorityEntry, SnapshotError> {
    let encoded = snapshot.canonical_entry_bytes.as_str().as_bytes();
    if encoded.is_empty() || !encoded.len().is_multiple_of(2) {
        return Err(snapshot_canonical(
            path,
            "canonical entry bytes must be non-empty, even-length lowercase hex",
        ));
    }
    let mut bytes = Vec::with_capacity(encoded.len() / 2);
    for pair in encoded.chunks_exact(2) {
        let high = snapshot_hex_value(pair[0])
            .ok_or_else(|| snapshot_canonical(path, "canonical entry bytes contain invalid hex"))?;
        let low = snapshot_hex_value(pair[1])
            .ok_or_else(|| snapshot_canonical(path, "canonical entry bytes contain invalid hex"))?;
        bytes.push((high << 4) | low);
    }
    let entry = serde_json::from_slice::<AuthorityEntry>(&bytes)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    let canonical_bytes = er_canonical::canonical_bytes(&entry)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    if canonical_bytes != bytes {
        return Err(snapshot_canonical(
            path,
            "payload is not the exact canonical JSON encoding",
        ));
    }
    if entry.revision != snapshot.identity.revision
        || entry.context != snapshot.identity.context
        || entry.operation_id != snapshot.identity.operation_id
        || entry.kind != snapshot.identity.kind
        || entry.material.digest != snapshot.identity.material_digest
        || entry.subsumes != snapshot.identity.subsumes
        || control_id_of(&entry.next_control) != snapshot.identity.next_control_id
    {
        return Err(snapshot_invalid(
            path,
            "decoded AuthorityEntry identity differs from adjacent identity",
        ));
    }
    Ok(entry)
}

fn snapshot_hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn delivery_timer_owner(owner_id: &str, revision: Revision) -> Result<TimerOwner, SnapshotError> {
    TimerOwner::new(
        format!("{owner_id}:delivery:{revision}"),
        format!("authority-log/delivery/{revision}"),
        format!("redeliver revision {revision} until mechanical quorum"),
    )
    .map_err(|error| snapshot_invalid("authority_log.retained.owner", error.to_string()))
}

fn authority_delivery_stage(stage: i8) -> AuthorityDeliveryStageV2 {
    match stage {
        STAGE_NONE => AuthorityDeliveryStageV2::None,
        STAGE_ADMITTED => AuthorityDeliveryStageV2::Admitted,
        STAGE_MATERIAL_APPLIED => AuthorityDeliveryStageV2::MaterialApplied,
        STAGE_CONTROL_INSTALLED => AuthorityDeliveryStageV2::ControlInstalled,
        STAGE_PRESENTATION_SETTLED => AuthorityDeliveryStageV2::PresentationSettled,
        _ => AuthorityDeliveryStageV2::None,
    }
}

fn authority_delivery_stage_rank(stage: AuthorityDeliveryStageV2) -> i8 {
    match stage {
        AuthorityDeliveryStageV2::None => STAGE_NONE,
        AuthorityDeliveryStageV2::Admitted => STAGE_ADMITTED,
        AuthorityDeliveryStageV2::MaterialApplied => STAGE_MATERIAL_APPLIED,
        AuthorityDeliveryStageV2::ControlInstalled => STAGE_CONTROL_INSTALLED,
        AuthorityDeliveryStageV2::PresentationSettled => STAGE_PRESENTATION_SETTLED,
    }
}

fn cross_check_authority_timers(
    authority: &AuthorityLog,
    scheduler: &KernelScheduler,
) -> Result<(), SnapshotError> {
    let mut expected_owners = BTreeMap::new();
    for lease in authority.retained.values() {
        let Some(timer_id) = lease.timer_id else {
            continue;
        };
        let Some(timer) = scheduler.timer(timer_id) else {
            return Err(snapshot_invalid(
                "authority_log.retained.timer_id",
                format!("delivery timer {timer_id} is absent from the restored scheduler"),
            ));
        };
        if timer.endpoint != authority.local_context.sender_seat_id
            || timer.owner != lease.owner
            || timer.delay_ms != lease.next_delay_ms
            || timer.time_class != authority.delivery_time_class
        {
            return Err(snapshot_invalid(
                "authority_log.retained.timer_id",
                format!("delivery timer {timer_id} does not match its restored lease"),
            ));
        }
        if expected_owners
            .insert(lease.owner.clone(), timer_id)
            .is_some()
        {
            return Err(snapshot_invalid(
                "authority_log.retained.owner",
                "delivery timer owners must identify one retained lease each",
            ));
        }
    }

    // Reject orphaned timers carrying the authority delivery owner namespace;
    // a scheduler containing unrelated owners remains usable by other kernel
    // subsystems and is intentionally left untouched.
    let owner_prefix = format!("{}:delivery:", authority.owner_id);
    for timer in scheduler.live_timers() {
        if !timer.owner.owner_id.starts_with(&owner_prefix) {
            continue;
        }
        let Some(expected_timer_id) = expected_owners.get(&timer.owner) else {
            return Err(snapshot_invalid(
                "scheduler.timers",
                format!("orphaned authority delivery timer {}", timer.timer_id),
            ));
        };
        if *expected_timer_id != timer.timer_id {
            return Err(snapshot_invalid(
                "scheduler.timers",
                "authority delivery owner is bound to the wrong timer ID",
            ));
        }
    }
    Ok(())
}

fn validate_config(
    config: &AuthorityLogConfig,
    require_remote_peer: bool,
) -> Result<(), AuthorityLogError> {
    if !valid_frame_context(&config.local_context) {
        return Err(AuthorityLogError::InvalidConfig {
            reason: "local context is malformed".to_owned(),
        });
    }
    if config.local_context.sender_seat_id != config.local_context.authority_seat_id {
        return Err(AuthorityLogError::InvalidConfig {
            reason: "local context must be authority-signed".to_owned(),
        });
    }
    if require_remote_peer && config.peer_bindings.is_empty() {
        return Err(AuthorityLogError::InvalidConfig {
            reason: "at least one remote peer binding is required".to_owned(),
        });
    }
    let mut seats = BTreeSet::new();
    for peer in &config.peer_bindings {
        if peer.seat_id == config.local_context.sender_seat_id || !seats.insert(peer.seat_id) {
            return Err(AuthorityLogError::InvalidConfig {
                reason: "peer bindings must be unique and non-local".to_owned(),
            });
        }
    }
    if TimerOwner::new(
        config.owner_id.clone(),
        "authority-log/config",
        "authority-log/config",
    )
    .is_err()
    {
        return Err(AuthorityLogError::InvalidConfig {
            reason: "owner id must be non-empty".to_owned(),
        });
    }
    if config.retain_capacity == SafeU53::ZERO {
        return Err(AuthorityLogError::InvalidConfig {
            reason: "retention capacity must be positive".to_owned(),
        });
    }
    let backoff = config.delivery_backoff;
    if backoff.initial_ms == SafeU53::ZERO
        || backoff.maximum_ms < backoff.initial_ms
        || backoff.factor_denominator == SafeU53::ZERO
        || backoff.factor_numerator < backoff.factor_denominator
    {
        return Err(AuthorityLogError::InvalidConfig {
            reason: "delivery backoff must be positive, bounded, and non-decreasing".to_owned(),
        });
    }
    Ok(())
}

fn validate_peer_bindings(
    local_context: &FrameContext,
    bindings: &[PeerBinding],
) -> Result<BTreeMap<SeatId, ConnectionGeneration>, AuthorityLogError> {
    if bindings.is_empty() {
        return Err(AuthorityLogError::InvalidConfig {
            reason: "at least one remote peer binding is required".to_owned(),
        });
    }
    let mut peers = BTreeMap::new();
    for peer in bindings {
        if peer.seat_id == local_context.sender_seat_id
            || peers
                .insert(peer.seat_id, peer.connection_generation)
                .is_some()
        {
            return Err(AuthorityLogError::InvalidConfig {
                reason: "peer bindings must be unique and non-local".to_owned(),
            });
        }
    }
    Ok(peers)
}

fn valid_frame_context(context: &FrameContext) -> bool {
    !context.session_id.as_str().is_empty()
        && !context.run_id.as_str().is_empty()
        && !context.seat_map_id.is_empty()
}

fn valid_semantic_operation_id(operation_id: &OperationId) -> bool {
    validate_authority_operation_id(operation_id.as_str()).is_ok()
}

fn same_session_identity(left: &FrameContext, right: &FrameContext) -> bool {
    left.session_id == right.session_id
        && left.run_id == right.run_id
        && left.seat_map_id == right.seat_map_id
}

fn next_safe(value: Option<SafeU53>) -> Option<SafeU53> {
    let value = value?;
    let next = value.get().checked_add(1)?;
    SafeU53::new(next).ok()
}

fn next_revision_value(head: Revision) -> Result<Revision, AuthorityLogError> {
    let Some(next) = next_safe(Some(head.get())) else {
        return Err(AuthorityLogError::RevisionExhausted);
    };
    Ok(Revision::new(next))
}

fn increment_counter(counter: &mut SafeU53) {
    if let Some(next) = next_safe(Some(*counter)) {
        *counter = next;
    }
}

fn safe_count(value: usize) -> SafeU53 {
    u64::try_from(value)
        .ok()
        .and_then(|value| SafeU53::new(value).ok())
        .unwrap_or(SafeU53::MAX)
}

fn next_backoff_delay(current: SafeU53, policy: BackoffPolicy) -> SafeU53 {
    let multiplied = current
        .get()
        .checked_mul(policy.factor_numerator.get())
        .map(|value| value / policy.factor_denominator.get());
    let next = match multiplied {
        Some(value) => value,
        None => policy.maximum_ms.get(),
    };
    let next = next.max(current.get()).min(policy.maximum_ms.get());
    match SafeU53::new(next) {
        Ok(value) => value,
        Err(_) => policy.maximum_ms,
    }
}

fn stage_rank(stage: AckStage) -> i8 {
    match stage {
        AckStage::Admitted => STAGE_ADMITTED,
        AckStage::MaterialApplied => STAGE_MATERIAL_APPLIED,
        AckStage::ControlInstalled => STAGE_CONTROL_INSTALLED,
        AckStage::PresentationSettled => STAGE_PRESENTATION_SETTLED,
    }
}

fn ack_stage(stage: i8) -> Option<AckStage> {
    match stage {
        STAGE_ADMITTED => Some(AckStage::Admitted),
        STAGE_MATERIAL_APPLIED => Some(AckStage::MaterialApplied),
        STAGE_CONTROL_INSTALLED => Some(AckStage::ControlInstalled),
        STAGE_PRESENTATION_SETTLED => Some(AckStage::PresentationSettled),
        _ => None,
    }
}

fn rejected_receipt(reason: ReceiptRejectReason) -> ReceiptOutcome {
    ReceiptOutcome {
        verdict: AuthorityReceiptVerdict::Rejected { reason },
        actions: Vec::new(),
    }
}
