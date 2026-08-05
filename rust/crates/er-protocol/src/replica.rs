//! Replica-side admission and staged material/control progression.

use std::collections::BTreeSet;

use er_types::{
    AuthorityEntry, AuthorityFrontier, AuthorityReceipt, ConnectionGeneration,
    ControlProjectionOutcome, FrameContext, MaterialApplicationOutcome, OperationId, Revision,
    RecoveredFrontierTerminal, SeatId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityReplicaConfig {
    pub receipt_context: FrameContext,
    pub authority_seat_id: SeatId,
    pub authority_connection_generation: ConnectionGeneration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReplicaClassification {
    DuplicateComplete,
    DuplicatePendingMaterial,
    DuplicatePendingControl,
    Next,
    Gap,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplicaResume {
    Admitted,
    MaterialApplied,
    ControlInstalled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ReplicaMechanicalStage {
    MaterialApplied,
    ControlInstalled { control_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReplicaRejectReason {
    Disposed,
    InvalidEntry,
    SessionMismatch,
    StaleEpoch,
    MembershipMismatch,
    AuthoritySenderMismatch,
    RevisionIdentityConflict,
    PredecessorControlMismatch,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplicaAction {
    EmitReceipt { receipt: AuthorityReceipt },
    ApplyMaterial { entry: AuthorityEntry },
    ProjectControl {
        entry: AuthorityEntry,
        expected_control_id: String,
    },
    ProbePresentation { entry: AuthorityEntry },
    RequestTail {
        context: FrameContext,
        missing_from: Revision,
    },
    EnterTerminal { reason: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ReplicaAdmission {
    Admitted { resume: ReplicaResume },
    Duplicate { resume: ReplicaResume },
    Gap { missing_from: Revision },
    Rejected { reason: ReplicaRejectReason },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaStep {
    pub admission: ReplicaAdmission,
    pub actions: Vec<ReplicaAction>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentationProbeOutcome {
    Settled,
    Pending,
    Failed,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityReplicaDiagnostics {
    pub frontier: AuthorityFrontier,
    pub pending_revision: Option<Revision>,
    pub pending_operation_id: Option<OperationId>,
    pub requested_tail_from: Option<Revision>,
    pub installed_control_ids: BTreeSet<String>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AuthorityReplicaError {
    #[error("authority replica is disposed")]
    Disposed,
    #[error("revision {revision} is not the pending revision")]
    WrongPendingRevision { revision: Revision },
    #[error("replica stage transition is invalid: {reason}")]
    InvalidStage { reason: String },
    #[error("recovery frontier is invalid: {reason}")]
    InvalidRecoveryFrontier { reason: String },
}

#[derive(Debug)]
pub struct AuthorityReplica {
    _contract: (),
}

impl AuthorityReplica {
    pub fn new(_config: AuthorityReplicaConfig) -> Result<Self, AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn classify(&self, _revision: Revision) -> ReplicaClassification {
        ReplicaClassification::Gap
    }

    pub fn admit(&mut self, _entry: AuthorityEntry) -> ReplicaStep {
        ReplicaStep {
            admission: ReplicaAdmission::Rejected {
                reason: ReplicaRejectReason::Disposed,
            },
            actions: Vec::new(),
        }
    }

    pub fn material_result(
        &mut self,
        _revision: Revision,
        _outcome: MaterialApplicationOutcome,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn control_result(
        &mut self,
        _revision: Revision,
        _outcome: ControlProjectionOutcome,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn presentation_result(
        &mut self,
        _revision: Revision,
        _outcome: PresentationProbeOutcome,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn record_replica_stage(
        &mut self,
        _entry: &AuthorityEntry,
        _stage: ReplicaMechanicalStage,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn adopt_frontier(
        &mut self,
        _revision: Revision,
        _terminal: Option<RecoveredFrontierTerminal>,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn stage_recovered_frontier(
        &mut self,
        _entry: AuthorityEntry,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn rebind_connection(
        &mut self,
        _receipt_context: FrameContext,
        _authority_connection_generation: ConnectionGeneration,
    ) -> Result<(), AuthorityReplicaError> {
        Err(AuthorityReplicaError::Disposed)
    }

    pub fn frontier(&self) -> AuthorityFrontier {
        AuthorityFrontier::default()
    }

    pub fn received_through(&self) -> Revision {
        self.frontier().received
    }

    pub fn applied_through(&self) -> Revision {
        self.frontier().material
    }

    pub fn control_installed_through(&self) -> Revision {
        self.frontier().control
    }

    pub fn missing_from(&self) -> Revision {
        Revision::ZERO
    }

    pub fn pending_entry(&self) -> Option<&AuthorityEntry> {
        None
    }

    pub fn diagnostics(&self) -> AuthorityReplicaDiagnostics {
        AuthorityReplicaDiagnostics::default()
    }

    pub fn dispose(&mut self, _reason: &str) {
    }
}
