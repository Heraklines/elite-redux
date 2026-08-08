//! Authority-side global revision, retention, receipt, and delivery state.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryKind, AuthorityReceipt, AuthorityRecoverySlice,
    ConnectionGeneration, FrameContext, Material, NextControl, OperationId, Revision, SafeU53,
    SeatId, TimeClass, TimerId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{KernelScheduler, ScheduledTimer, SchedulerCommand, SchedulerError};

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

#[derive(Debug)]
pub struct AuthorityLog {
    _contract: (),
}

impl AuthorityLog {
    pub fn new(_config: AuthorityLogConfig) -> Result<Self, AuthorityLogError> {
        Err(AuthorityLogError::InvalidConfig {
            reason: "authority log implementation pending".to_owned(),
        })
    }

    pub fn prepare_commit(
        &mut self,
        _draft: AuthorityEntryDraft,
    ) -> Result<PreparedCommit, AuthorityLogError> {
        Err(AuthorityLogError::Disposed)
    }

    pub fn publish_prepared(
        &mut self,
        _token: SafeU53,
        _scheduler: &mut KernelScheduler,
    ) -> Result<CommitOutcome, AuthorityLogError> {
        Err(AuthorityLogError::Disposed)
    }

    pub fn reject_prepared(&mut self, _token: SafeU53) -> bool {
        false
    }

    pub fn commit(
        &mut self,
        _draft: AuthorityEntryDraft,
        _scheduler: &mut KernelScheduler,
    ) -> Result<CommitOutcome, AuthorityLogError> {
        Err(AuthorityLogError::Disposed)
    }

    pub fn accept_receipt_detailed(
        &mut self,
        _receipt: AuthorityReceipt,
        _scheduler: &mut KernelScheduler,
    ) -> ReceiptOutcome {
        ReceiptOutcome {
            verdict: AuthorityReceiptVerdict::Rejected {
                reason: ReceiptRejectReason::Disposed,
            },
            actions: Vec::new(),
        }
    }

    pub fn accept_receipt(
        &mut self,
        _receipt: AuthorityReceipt,
        _scheduler: &mut KernelScheduler,
    ) -> (bool, Vec<AuthorityLogAction>) {
        (false, Vec::new())
    }

    pub fn peer_stage_quorum(&self, _operation_id: &OperationId, _stage: AckStage) -> bool {
        false
    }

    pub fn timer_fired(
        &mut self,
        _fired: ScheduledTimer,
        _scheduler: &mut KernelScheduler,
    ) -> Result<Vec<AuthorityLogAction>, AuthorityLogError> {
        Err(AuthorityLogError::Disposed)
    }

    pub fn recovery_slice(&self, _captured_frontier: Revision) -> Option<AuthorityRecoverySlice> {
        None
    }

    pub fn rebind_connection(
        &mut self,
        _local_context: FrameContext,
        _peer_bindings: Vec<PeerBinding>,
    ) -> Result<AuthorityRebindOutcome, AuthorityLogError> {
        Err(AuthorityLogError::Disposed)
    }

    pub fn retained_entry(&self, _revision: Revision) -> Option<&AuthorityEntry> {
        None
    }

    pub fn retained(&self) -> Vec<AuthorityEntry> {
        Vec::new()
    }

    pub fn head_revision(&self) -> Revision {
        Revision::ZERO
    }

    pub fn diagnostics(&self) -> AuthorityLogDiagnostics {
        AuthorityLogDiagnostics::default()
    }

    pub fn dispose(
        &mut self,
        _reason: &str,
        _scheduler: &mut KernelScheduler,
    ) -> Vec<AuthorityLogAction> {
        Vec::new()
    }
}
