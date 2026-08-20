//! Replica-side admission and staged material/control progression.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, AuthorityReceipt,
    AwaitSuccessorControl, CommandControlTarget, ConnectionGeneration, ControlAddress,
    ControlProjectionOutcome, FrameContext, InteractionControlAddress, InteractionSuccessor,
    Material, MaterialApplicationOutcome, NextControl, OperationId, RecoveredFrontierTerminal,
    ReplacementControl, ReplacementControlAddress, Revision, SafeU53, SeatId,
    SharedInteractionControl, TAIL_PROOF_MAX_SOURCE_REVISIONS, TailProofBody, TailRequestBody,
    TerminalControl, validate_authority_material_digest, validate_authority_operation_id,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use thiserror::Error;

use crate::tail_proof::{TailProofEntryCapture, TailProofFrameDisposition, TailProofReplicaState};
use crate::{SuccessorValidator, control_id_of};

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
    TailProofRejected,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplicaAction {
    EmitReceipt {
        receipt: AuthorityReceipt,
    },
    ApplyMaterial {
        entry: AuthorityEntry,
    },
    ProjectControl {
        entry: AuthorityEntry,
        expected_control_id: String,
    },
    ProbePresentation {
        entry: AuthorityEntry,
    },
    RequestTail {
        context: FrameContext,
        missing_from: Revision,
    },
    RequestTailProof {
        context: FrameContext,
        request: TailRequestBody,
    },
    EnterTerminal {
        reason: String,
    },
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

#[derive(Clone, Debug, PartialEq)]
pub enum ReplicaTailProofDisposition {
    Ignored { reason: String },
    Pending,
    Completed { step: ReplicaStep },
    Rejected { reason: String },
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

#[derive(Clone, Debug)]
pub struct AuthorityReplica {
    receipt_context: FrameContext,
    authority_seat_id: SeatId,
    authority_connection_generation: ConnectionGeneration,
    frontier: AuthorityFrontier,
    pending: Option<PendingReplicaEntry>,
    requested_tail_from: Option<Revision>,
    installed_controls: BTreeMap<Revision, InstalledControl>,
    recovery_proof: Option<RecoveryFrontierProof>,
    tail_proof: TailProofReplicaState,
    disposed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PendingStage {
    Admitted,
    MaterialApplied,
}

#[derive(Clone, Debug)]
struct PendingReplicaEntry {
    entry: AuthorityEntry,
    stage: PendingStage,
}

#[derive(Clone, Debug)]
struct InstalledControl {
    identity: EntryIdentity,
    control_id: String,
}

#[derive(Clone, Debug)]
struct RecoveryFrontierProof {
    identity: EntryIdentity,
}

#[derive(Clone, Debug)]
enum EntryMaterialIdentity {
    Complete(Material),
    DigestOnly { digest: String },
}

impl EntryMaterialIdentity {
    fn digest(&self) -> &str {
        match self {
            Self::Complete(material) => &material.digest,
            Self::DigestOnly { digest } => digest,
        }
    }

    fn matches(&self, other: &Self) -> bool {
        self.digest() == other.digest()
            && match (self, other) {
                (Self::Complete(left), Self::Complete(right)) => left.payload == right.payload,
                _ => true,
            }
    }

    /// The frozen action shape still carries a Material payload, but restored
    /// identities are intentionally opaque.  The placeholder is only for the
    /// presentation-probe action and is never used for identity matching.
    fn for_probe_action(&self) -> Material {
        match self {
            Self::Complete(material) => material.clone(),
            Self::DigestOnly { digest } => Material {
                digest: digest.clone(),
                payload: Value::Null,
            },
        }
    }
}

/// Complete local identity for one authenticated authority entry.
///
/// The revision is kept in the identity even where a surrounding map is
/// already keyed by it.  That makes every comparison path use the same
/// value: revision, material digest (and payload when available), all
/// control fields, and all authenticated frame-context dimensions.
#[derive(Clone, Debug)]
struct EntryIdentity {
    revision: Revision,
    context: FrameContext,
    operation_id: OperationId,
    kind: AuthorityEntryKind,
    material: EntryMaterialIdentity,
    next_control: NextControl,
    subsumes: Vec<Revision>,
}

impl EntryIdentity {
    fn matches(&self, other: &Self) -> bool {
        self.revision == other.revision
            && self.context == other.context
            && self.operation_id == other.operation_id
            && self.kind == other.kind
            && self.material.matches(&other.material)
            && self.next_control == other.next_control
            && self.subsumes == other.subsumes
    }

    fn from_entry(entry: &AuthorityEntry) -> Self {
        Self {
            revision: entry.revision,
            context: entry.context.clone(),
            operation_id: entry.operation_id.clone(),
            kind: entry.kind,
            material: EntryMaterialIdentity::Complete(entry.material.clone()),
            next_control: entry.next_control.clone(),
            subsumes: entry.subsumes.clone(),
        }
    }

    fn matches_terminal(&self, revision: Revision, terminal: &RecoveredFrontierTerminal) -> bool {
        self.revision == revision
            && self.operation_id == terminal.operation_id
            && self.next_control == terminal.next_control
    }

    fn to_probe_entry(&self) -> AuthorityEntry {
        AuthorityEntry {
            context: self.context.clone(),
            revision: self.revision,
            operation_id: self.operation_id.clone(),
            kind: self.kind,
            material: self.material.for_probe_action(),
            next_control: self.next_control.clone(),
            subsumes: self.subsumes.clone(),
        }
    }

    fn is_valid(&self) -> bool {
        if revision_value(self.revision) == 0
            || validate_authority_operation_id(self.operation_id.as_str()).is_err()
            || validate_authority_material_digest(self.material.digest()).is_err()
            || !is_valid_context(&self.context)
            || self
                .subsumes
                .iter()
                .any(|revision| revision_value(*revision) == 0)
            || !is_valid_successor_control(&self.next_control)
        {
            return false;
        }
        match self.kind {
            AuthorityEntryKind::TerminalCommit => {
                matches!(self.next_control, NextControl::Terminal(_))
            }
            _ => !matches!(self.next_control, NextControl::Terminal(_)),
        }
    }
}

impl InstalledControl {
    fn from_entry(entry: &AuthorityEntry, control_id: String) -> Self {
        Self {
            identity: EntryIdentity::from_entry(entry),
            control_id,
        }
    }
}

impl AuthorityReplica {
    pub fn new(config: AuthorityReplicaConfig) -> Result<Self, AuthorityReplicaError> {
        if !is_valid_context(&config.receipt_context)
            || config.receipt_context.authority_seat_id != config.authority_seat_id
            || config.receipt_context.sender_seat_id == config.authority_seat_id
        {
            return Err(invalid_stage(
                "replica configuration is not a receiving-peer context",
            ));
        }
        Ok(Self {
            receipt_context: config.receipt_context,
            authority_seat_id: config.authority_seat_id,
            authority_connection_generation: config.authority_connection_generation,
            frontier: AuthorityFrontier::default(),
            pending: None,
            requested_tail_from: None,
            installed_controls: BTreeMap::new(),
            recovery_proof: None,
            tail_proof: TailProofReplicaState::default(),
            disposed: false,
        })
    }

    pub fn classify(&self, revision: Revision) -> ReplicaClassification {
        let incoming = revision_value(revision);
        let received = revision_value(self.frontier.received);
        let material = revision_value(self.frontier.material);
        let control = revision_value(self.frontier.control);

        if incoming == 0 || incoming <= control {
            return ReplicaClassification::DuplicateComplete;
        }
        if incoming == received && received > control {
            if material < incoming {
                ReplicaClassification::DuplicatePendingMaterial
            } else {
                ReplicaClassification::DuplicatePendingControl
            }
        } else if incoming == control.saturating_add(1) && received == control {
            ReplicaClassification::Next
        } else {
            ReplicaClassification::Gap
        }
    }

    pub fn admit(&mut self, entry: AuthorityEntry) -> ReplicaStep {
        if self.disposed {
            return rejected_step(ReplicaRejectReason::Disposed);
        }
        if !is_valid_entry(&entry) {
            return rejected_step(ReplicaRejectReason::InvalidEntry);
        }
        if let Some(reason) = self.context_rejection(&entry) {
            return rejected_step(reason);
        }

        match self.tail_proof.capture_entry(&entry, tail_proof_capacity()) {
            TailProofEntryCapture::Inactive => {}
            TailProofEntryCapture::Parked {
                missing_from,
                redrive_request,
            } => {
                let actions = redrive_request
                    .into_iter()
                    .map(|request| ReplicaAction::RequestTailProof {
                        context: self.receipt_context.clone(),
                        request,
                    })
                    .collect();
                return ReplicaStep {
                    admission: ReplicaAdmission::Gap { missing_from },
                    actions,
                };
            }
            TailProofEntryCapture::Rejected { .. } => {
                return rejected_step(ReplicaRejectReason::TailProofRejected);
            }
        }

        match self.classify(entry.revision) {
            ReplicaClassification::DuplicateComplete => {
                let Some(installed) = self.installed_controls.get(&entry.revision) else {
                    return rejected_step(ReplicaRejectReason::RevisionIdentityConflict);
                };
                if !installed_matches_entry(installed, &entry) {
                    return rejected_step(ReplicaRejectReason::RevisionIdentityConflict);
                }
                ReplicaStep {
                    admission: ReplicaAdmission::Duplicate {
                        resume: ReplicaResume::ControlInstalled,
                    },
                    actions: vec![
                        self.receipt_action(
                            &entry,
                            AckStage::ControlInstalled,
                            Some(control_id_of(&entry.next_control)),
                        ),
                        ReplicaAction::ProbePresentation { entry },
                    ],
                }
            }
            ReplicaClassification::DuplicatePendingMaterial => {
                if !self.pending_matches(&entry) {
                    return rejected_step(ReplicaRejectReason::RevisionIdentityConflict);
                }
                ReplicaStep {
                    admission: ReplicaAdmission::Duplicate {
                        resume: ReplicaResume::Admitted,
                    },
                    actions: self.resume_actions(&entry, ReplicaResume::Admitted),
                }
            }
            ReplicaClassification::DuplicatePendingControl => {
                if !self.pending_matches(&entry) {
                    return rejected_step(ReplicaRejectReason::RevisionIdentityConflict);
                }
                ReplicaStep {
                    admission: ReplicaAdmission::Duplicate {
                        resume: ReplicaResume::MaterialApplied,
                    },
                    actions: self.resume_actions(&entry, ReplicaResume::MaterialApplied),
                }
            }
            ReplicaClassification::Next => {
                if self.frontier.control != Revision::ZERO {
                    let Some((ordinary_successor, predecessor)) = self
                        .installed_controls
                        .get(&self.frontier.control)
                        .map(|predecessor| {
                            (
                                SuccessorValidator::new().allows(
                                    &predecessor.identity.next_control,
                                    &predecessor.identity.operation_id,
                                    &entry,
                                ),
                                predecessor.identity.to_probe_entry(),
                            )
                        })
                    else {
                        return rejected_step(ReplicaRejectReason::PredecessorControlMismatch);
                    };
                    let proven_boundary = self.tail_proof.consume_admission(&entry);
                    if !ordinary_successor && !proven_boundary {
                        if let Some(request) =
                            self.tail_proof
                                .begin(&entry, &predecessor, &self.receipt_context)
                        {
                            let missing_from = request.from_revision;
                            return ReplicaStep {
                                admission: ReplicaAdmission::Gap { missing_from },
                                actions: vec![ReplicaAction::RequestTailProof {
                                    context: self.receipt_context.clone(),
                                    request,
                                }],
                            };
                        }
                        return rejected_step(ReplicaRejectReason::PredecessorControlMismatch);
                    }
                }
                self.frontier.received = entry.revision;
                self.pending = Some(PendingReplicaEntry {
                    entry: entry.clone(),
                    stage: PendingStage::Admitted,
                });
                ReplicaStep {
                    admission: ReplicaAdmission::Admitted {
                        resume: ReplicaResume::Admitted,
                    },
                    actions: self.resume_actions(&entry, ReplicaResume::Admitted),
                }
            }
            ReplicaClassification::Gap => {
                let missing_from = self.missing_from();
                let mut actions = Vec::new();
                if self.requested_tail_from != Some(missing_from) {
                    self.requested_tail_from = Some(missing_from);
                    actions.push(ReplicaAction::RequestTail {
                        context: self.receipt_context.clone(),
                        missing_from,
                    });
                }
                ReplicaStep {
                    admission: ReplicaAdmission::Gap { missing_from },
                    actions,
                }
            }
        }
    }

    pub fn accept_tail_proof(
        &mut self,
        authority_context: &FrameContext,
        body: &TailProofBody,
    ) -> ReplicaTailProofDisposition {
        if self.disposed {
            return ReplicaTailProofDisposition::Ignored {
                reason: "disposed".to_owned(),
            };
        }
        let request_context = self.receipt_context.clone();
        match self.tail_proof.accept_frame(
            &request_context,
            authority_context,
            body,
            tail_proof_capacity(),
        ) {
            TailProofFrameDisposition::Ignored { reason } => {
                ReplicaTailProofDisposition::Ignored { reason }
            }
            TailProofFrameDisposition::Pending => ReplicaTailProofDisposition::Pending,
            TailProofFrameDisposition::Rejected { reason } => {
                ReplicaTailProofDisposition::Rejected { reason }
            }
            TailProofFrameDisposition::Ready { candidate } => {
                let step = self.admit(*candidate);
                if matches!(
                    &step.admission,
                    ReplicaAdmission::Admitted { .. } | ReplicaAdmission::Duplicate { .. }
                ) {
                    ReplicaTailProofDisposition::Completed { step }
                } else {
                    self.tail_proof.fail();
                    ReplicaTailProofDisposition::Rejected {
                        reason: "tail proof candidate redrive was not admitted".to_owned(),
                    }
                }
            }
        }
    }

    pub fn material_result(
        &mut self,
        revision: Revision,
        outcome: MaterialApplicationOutcome,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        self.ensure_live()?;
        let pending = self.pending_for_revision(revision)?;
        match outcome {
            MaterialApplicationOutcome::Applied => {
                self.record_replica_stage(&pending.entry, ReplicaMechanicalStage::MaterialApplied)
            }
            MaterialApplicationOutcome::Deferred => {
                if pending.stage != PendingStage::Admitted {
                    return Err(invalid_stage(
                        "material result arrived after material was applied",
                    ));
                }
                Ok(Vec::new())
            }
            MaterialApplicationOutcome::Rejected { reason } => {
                if pending.stage != PendingStage::Admitted {
                    return Err(invalid_stage(
                        "material rejection arrived after material was applied",
                    ));
                }
                Ok(vec![ReplicaAction::EnterTerminal { reason }])
            }
        }
    }

    pub fn control_result(
        &mut self,
        revision: Revision,
        outcome: ControlProjectionOutcome,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        self.ensure_live()?;
        if let ControlProjectionOutcome::AlreadyInstalled { control_id } = &outcome
            && self.pending.is_none()
        {
            let installed = self
                .installed_controls
                .get(&revision)
                .ok_or(AuthorityReplicaError::WrongPendingRevision { revision })?;
            if installed.control_id != *control_id
                || !self.identity_matches_current_context(&installed.identity)
                || self.frontier
                    != (AuthorityFrontier {
                        received: revision,
                        material: revision,
                        control: revision,
                    })
            {
                return Err(invalid_recovery(
                    "already-installed recovery control proof is not the exact live frontier",
                ));
            }
            let entry = installed.identity.to_probe_entry();
            return Ok(vec![
                self.receipt_action(&entry, AckStage::ControlInstalled, Some(control_id.clone())),
                ReplicaAction::ProbePresentation { entry },
            ]);
        }
        let pending = self.pending_for_revision(revision)?;
        match outcome {
            ControlProjectionOutcome::Installed { control_id }
            | ControlProjectionOutcome::AlreadyInstalled { control_id } => self
                .record_replica_stage(
                    &pending.entry,
                    ReplicaMechanicalStage::ControlInstalled { control_id },
                ),
            ControlProjectionOutcome::Deferred => {
                if pending.stage != PendingStage::MaterialApplied {
                    return Err(invalid_stage(
                        "control result arrived before material was applied",
                    ));
                }
                Ok(Vec::new())
            }
            ControlProjectionOutcome::Rejected { reason } => {
                if pending.stage != PendingStage::MaterialApplied {
                    return Err(invalid_stage(
                        "control rejection arrived before material was applied",
                    ));
                }
                Ok(vec![ReplicaAction::EnterTerminal { reason }])
            }
        }
    }

    pub fn presentation_result(
        &mut self,
        revision: Revision,
        outcome: PresentationProbeOutcome,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        self.ensure_live()?;
        let Some(installed) = self.installed_controls.get(&revision) else {
            return Err(AuthorityReplicaError::WrongPendingRevision { revision });
        };
        if outcome != PresentationProbeOutcome::Settled {
            return Ok(Vec::new());
        }
        Ok(vec![self.receipt_identity_action(
            revision,
            installed.identity.operation_id.clone(),
            AckStage::PresentationSettled,
            None,
        )])
    }

    pub fn record_replica_stage(
        &mut self,
        entry: &AuthorityEntry,
        stage: ReplicaMechanicalStage,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        self.ensure_live()?;
        let pending = self.pending_for_entry(entry)?;
        match stage {
            ReplicaMechanicalStage::MaterialApplied => {
                if pending.stage != PendingStage::Admitted {
                    return Err(invalid_stage("materialApplied is not the next stage"));
                }
                let Some(previous_material) = previous_revision(pending.entry.revision) else {
                    return Err(invalid_stage("materialApplied revision must be positive"));
                };
                if self.frontier.material != previous_material
                    || self.frontier.received != pending.entry.revision
                {
                    return Err(invalid_stage(
                        "materialApplied does not advance the ordered frontier",
                    ));
                }
                self.frontier.material = pending.entry.revision;
                if let Some(current) = self.pending.as_mut() {
                    current.stage = PendingStage::MaterialApplied;
                }
                let expected_control_id = control_id_of(&pending.entry.next_control);
                Ok(vec![
                    self.receipt_action(&pending.entry, AckStage::MaterialApplied, None),
                    ReplicaAction::ProjectControl {
                        entry: pending.entry,
                        expected_control_id,
                    },
                ])
            }
            ReplicaMechanicalStage::ControlInstalled { control_id } => {
                if pending.stage != PendingStage::MaterialApplied {
                    return Err(invalid_stage("controlInstalled requires materialApplied"));
                }
                let Some(previous_control) = previous_revision(pending.entry.revision) else {
                    return Err(invalid_stage("controlInstalled revision must be positive"));
                };
                if self.frontier.material != pending.entry.revision
                    || self.frontier.control != previous_control
                {
                    return Err(invalid_stage(
                        "controlInstalled does not advance the ordered frontier",
                    ));
                }
                let expected_control_id = control_id_of(&pending.entry.next_control);
                if control_id != expected_control_id {
                    return Err(invalid_stage(
                        "projected control identity does not match the entry",
                    ));
                }
                self.frontier.control = pending.entry.revision;
                self.installed_controls.insert(
                    pending.entry.revision,
                    InstalledControl::from_entry(&pending.entry, expected_control_id.clone()),
                );
                self.pending = None;
                self.recovery_proof = None;
                self.clear_completed_tail_request();
                Ok(vec![
                    self.receipt_action(
                        &pending.entry,
                        AckStage::ControlInstalled,
                        Some(expected_control_id),
                    ),
                    ReplicaAction::ProbePresentation {
                        entry: pending.entry,
                    },
                ])
            }
        }
    }

    pub fn adopt_frontier(
        &mut self,
        revision: Revision,
        terminal: Option<RecoveredFrontierTerminal>,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        self.ensure_live()?;
        let incoming = revision_value(revision);
        if incoming == 0 {
            if terminal.is_some() {
                return Err(invalid_recovery(
                    "revision zero cannot carry a terminal proof",
                ));
            }
            if self.frontier != AuthorityFrontier::default()
                || self.pending.is_some()
                || self.recovery_proof.is_some()
                || !self.installed_controls.is_empty()
            {
                return Err(invalid_recovery(
                    "revision zero would rewind the replica frontier",
                ));
            }
            return Ok(Vec::new());
        }
        if self.recovery_proof.is_some() && terminal.is_none() {
            return Err(invalid_recovery(
                "recovery frontier proof requires its exact terminal",
            ));
        }
        if let Some(terminal) = terminal.as_ref()
            && (validate_authority_operation_id(terminal.operation_id.as_str()).is_err()
                || !is_valid_successor_control(&terminal.next_control))
        {
            return Err(invalid_recovery(
                "recovery terminal contains an invalid identity or successor control",
            ));
        }
        let control = revision_value(self.frontier.control);
        let received = revision_value(self.frontier.received);
        if incoming < control {
            return Err(invalid_recovery("recovery frontier would rewind control"));
        }
        let Some(terminal) = terminal.as_ref() else {
            if incoming <= control && self.has_complete_current_identity(revision) {
                return Ok(Vec::new());
            }
            return Err(invalid_recovery(
                "positive recovery adoption requires a complete terminal entry identity",
            ));
        };
        if incoming < received {
            return Err(invalid_recovery(
                "recovery frontier would rewind received material",
            ));
        }
        // RecoveredFrontierTerminal carries no material-bearing identity, so
        // a positive terminal-only call can only confirm the exact recovery
        // state already staged from a complete AuthorityEntry. It must never
        // promote an admitted entry or create a fresh frontier proof.
        self.complete_pending_recovery_identity(revision, terminal)?;
        Ok(Vec::new())
    }

    pub fn stage_recovered_frontier(
        &mut self,
        entry: AuthorityEntry,
    ) -> Result<Vec<ReplicaAction>, AuthorityReplicaError> {
        self.ensure_live()?;
        if !is_valid_entry(&entry) {
            return Err(invalid_recovery("recovered entry is invalid"));
        }
        if let Some(reason) = self.context_rejection(&entry) {
            return Err(invalid_recovery(&format!(
                "recovered entry context rejected: {reason:?}"
            )));
        }
        let recovered_revision = revision_value(entry.revision);
        if recovered_revision == 0 {
            return Err(invalid_recovery(
                "recovered entry revision must be positive",
            ));
        }
        let entry_identity = EntryIdentity::from_entry(&entry);
        if self.frontier
            == (AuthorityFrontier {
                received: entry.revision,
                material: entry.revision,
                control: entry.revision,
            })
            && self.pending.is_none()
            && self
                .installed_controls
                .get(&entry.revision)
                .is_some_and(|installed| {
                    installed.identity.matches(&entry_identity)
                        && installed.control_id == control_id_of(&entry.next_control)
                })
        {
            return Ok(vec![ReplicaAction::ProjectControl {
                entry: entry.clone(),
                expected_control_id: control_id_of(&entry.next_control),
            }]);
        }
        if let Some(pending) = self.pending.as_ref() {
            if !same_entry_identity(&pending.entry, &entry)
                || pending.stage != PendingStage::MaterialApplied
            {
                return Err(invalid_recovery("another replica entry is already pending"));
            }
            return Ok(vec![ReplicaAction::ProjectControl {
                entry: pending.entry.clone(),
                expected_control_id: control_id_of(&pending.entry.next_control),
            }]);
        }
        let Some(previous) = previous_revision(entry.revision) else {
            return Err(invalid_recovery(
                "recovered entry has no predecessor revision",
            ));
        };
        if let Some(proof) = self.recovery_proof.as_ref() {
            if !proof.identity.matches(&entry_identity)
                || !self.identity_matches_current_context(&proof.identity)
                || self.frontier.received != entry.revision
                || self.frontier.material != entry.revision
                || self.frontier.control != previous
            {
                return Err(invalid_recovery(
                    "recovered entry does not match the complete frontier proof",
                ));
            }
        } else {
            let received = revision_value(self.frontier.received);
            let control = revision_value(self.frontier.control);
            if recovered_revision < received || recovered_revision <= control {
                return Err(invalid_recovery(
                    "fresh recovered entry would rewind an existing frontier",
                ));
            }
        }

        self.frontier = AuthorityFrontier {
            received: entry.revision,
            material: entry.revision,
            control: previous,
        };
        self.installed_controls
            .retain(|retained, _| *retained < entry.revision);
        self.recovery_proof = Some(RecoveryFrontierProof {
            identity: entry_identity,
        });
        self.tail_proof.fail();
        self.pending = Some(PendingReplicaEntry {
            entry: entry.clone(),
            stage: PendingStage::MaterialApplied,
        });
        self.clear_tail_request_through(entry.revision);
        Ok(vec![ReplicaAction::ProjectControl {
            entry: entry.clone(),
            expected_control_id: control_id_of(&entry.next_control),
        }])
    }

    pub fn rebind_connection(
        &mut self,
        receipt_context: FrameContext,
        authority_connection_generation: ConnectionGeneration,
    ) -> Result<(), AuthorityReplicaError> {
        self.ensure_live()?;
        if !is_valid_context(&receipt_context)
            || receipt_context.session_id != self.receipt_context.session_id
            || receipt_context.run_id != self.receipt_context.run_id
            || receipt_context.session_epoch != self.receipt_context.session_epoch
            || receipt_context.seat_map_id != self.receipt_context.seat_map_id
            || receipt_context.sender_seat_id != self.receipt_context.sender_seat_id
            || receipt_context.authority_seat_id != self.authority_seat_id
            || receipt_context.membership_revision < self.receipt_context.membership_revision
            || receipt_context.connection_generation < self.receipt_context.connection_generation
            || authority_connection_generation < self.authority_connection_generation
        {
            return Err(invalid_stage(
                "connection rebind changed or rolled back authenticated identity",
            ));
        }
        if receipt_context.sender_seat_id == self.authority_seat_id {
            return Err(invalid_stage(
                "connection rebind would make the authority self-sign receipts",
            ));
        }
        let context_unchanged = receipt_context == self.receipt_context
            && authority_connection_generation == self.authority_connection_generation;
        if context_unchanged {
            self.requested_tail_from = None;
            return Ok(());
        }
        let rebound_entry_context = authority_entry_context(
            &receipt_context,
            self.authority_seat_id,
            authority_connection_generation,
        );
        self.receipt_context = receipt_context;
        self.authority_connection_generation = authority_connection_generation;
        if let Some(pending) = self.pending.as_mut() {
            pending.entry.context = rebound_entry_context.clone();
        }
        for installed in self.installed_controls.values_mut() {
            installed.identity.context = rebound_entry_context.clone();
        }
        if let Some(proof) = self.recovery_proof.as_mut() {
            proof.identity.context = rebound_entry_context;
        }
        self.requested_tail_from = None;
        self.tail_proof.rebind();
        Ok(())
    }

    pub fn frontier(&self) -> AuthorityFrontier {
        self.frontier
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
        match next_revision(self.frontier.control) {
            Some(revision) => revision,
            None => Revision::ZERO,
        }
    }

    pub fn pending_entry(&self) -> Option<&AuthorityEntry> {
        self.pending.as_ref().map(|pending| &pending.entry)
    }

    pub fn diagnostics(&self) -> AuthorityReplicaDiagnostics {
        AuthorityReplicaDiagnostics {
            frontier: self.frontier,
            pending_revision: self.pending.as_ref().map(|pending| pending.entry.revision),
            pending_operation_id: self
                .pending
                .as_ref()
                .map(|pending| pending.entry.operation_id.clone()),
            requested_tail_from: self.requested_tail_from,
            installed_control_ids: self
                .installed_controls
                .values()
                .map(|control| control.control_id.clone())
                .collect(),
            disposed: self.disposed,
        }
    }

    pub fn dispose(&mut self, _reason: &str) {
        if self.disposed {
            return;
        }
        self.disposed = true;
        self.pending = None;
        self.requested_tail_from = None;
        self.installed_controls.clear();
        self.recovery_proof = None;
        self.tail_proof.clear();
    }

    fn ensure_live(&self) -> Result<(), AuthorityReplicaError> {
        if self.disposed {
            Err(AuthorityReplicaError::Disposed)
        } else {
            Ok(())
        }
    }

    fn context_rejection(&self, entry: &AuthorityEntry) -> Option<ReplicaRejectReason> {
        if entry.context.session_id != self.receipt_context.session_id
            || entry.context.run_id != self.receipt_context.run_id
            || entry.context.seat_map_id != self.receipt_context.seat_map_id
        {
            return Some(ReplicaRejectReason::SessionMismatch);
        }
        if entry.context.session_epoch != self.receipt_context.session_epoch {
            return Some(ReplicaRejectReason::StaleEpoch);
        }
        if entry.context.membership_revision != self.receipt_context.membership_revision {
            return Some(ReplicaRejectReason::MembershipMismatch);
        }
        if entry.context.authority_seat_id != self.authority_seat_id
            || entry.context.authority_seat_id != self.receipt_context.authority_seat_id
            || entry.context.sender_seat_id != entry.context.authority_seat_id
            || self.receipt_context.sender_seat_id == self.authority_seat_id
            || entry.context.connection_generation != self.authority_connection_generation
        {
            return Some(ReplicaRejectReason::AuthoritySenderMismatch);
        }
        None
    }

    fn identity_matches_current_context(&self, identity: &EntryIdentity) -> bool {
        identity.context
            == authority_entry_context(
                &self.receipt_context,
                self.authority_seat_id,
                self.authority_connection_generation,
            )
    }

    fn has_complete_current_identity(&self, revision: Revision) -> bool {
        self.pending.as_ref().is_some_and(|pending| {
            pending.stage == PendingStage::MaterialApplied
                && pending.entry.revision == revision
                && previous_revision(revision).is_some_and(|previous| {
                    self.frontier
                        == (AuthorityFrontier {
                            received: revision,
                            material: revision,
                            control: previous,
                        })
                })
                && self.identity_matches_current_context(&EntryIdentity::from_entry(&pending.entry))
        }) || self
            .installed_controls
            .get(&revision)
            .is_some_and(|installed| self.identity_matches_current_context(&installed.identity))
    }

    fn complete_pending_recovery_identity(
        &self,
        revision: Revision,
        terminal: &RecoveredFrontierTerminal,
    ) -> Result<(), AuthorityReplicaError> {
        let Some(previous) = previous_revision(revision) else {
            return Err(invalid_recovery(
                "recovered frontier has no predecessor revision",
            ));
        };
        if self.frontier
            != (AuthorityFrontier {
                received: revision,
                material: revision,
                control: previous,
            })
        {
            return Err(invalid_recovery(
                "positive terminal-only adoption requires the exact staged frontier",
            ));
        }
        let Some(pending) = self.pending.as_ref() else {
            return Err(invalid_recovery(
                "positive terminal-only adoption requires a complete pending entry",
            ));
        };
        if pending.stage != PendingStage::MaterialApplied || pending.entry.revision != revision {
            return Err(invalid_recovery(
                "positive terminal-only adoption requires material-applied pending state",
            ));
        }
        let identity = EntryIdentity::from_entry(&pending.entry);
        if !identity.matches_terminal(revision, terminal)
            || !self.identity_matches_current_context(&identity)
        {
            return Err(invalid_recovery(
                "recovery terminal conflicts with the complete pending entry identity",
            ));
        }
        let Some(proof) = self.recovery_proof.as_ref() else {
            return Err(invalid_recovery(
                "positive terminal-only adoption requires the complete recovery proof",
            ));
        };
        if !proof.identity.matches(&identity)
            || !self.identity_matches_current_context(&proof.identity)
        {
            return Err(invalid_recovery(
                "recovery proof conflicts with the complete pending entry identity",
            ));
        }
        Ok(())
    }

    fn pending_matches(&self, entry: &AuthorityEntry) -> bool {
        self.pending
            .as_ref()
            .is_some_and(|pending| same_entry_identity(&pending.entry, entry))
    }

    fn pending_for_revision(
        &self,
        revision: Revision,
    ) -> Result<PendingReplicaEntry, AuthorityReplicaError> {
        let Some(pending) = self.pending.as_ref() else {
            return Err(AuthorityReplicaError::WrongPendingRevision { revision });
        };
        if pending.entry.revision != revision {
            return Err(AuthorityReplicaError::WrongPendingRevision { revision });
        }
        Ok(pending.clone())
    }

    fn pending_for_entry(
        &self,
        entry: &AuthorityEntry,
    ) -> Result<PendingReplicaEntry, AuthorityReplicaError> {
        if let Some(reason) = self.context_rejection(entry) {
            return Err(invalid_stage(&format!(
                "stage entry context rejected: {reason:?}"
            )));
        }
        let pending = self.pending_for_revision(entry.revision)?;
        if !same_entry_identity(&pending.entry, entry) {
            return Err(invalid_stage(
                "stage entry does not match the pending identity",
            ));
        }
        Ok(pending)
    }

    fn resume_actions(&self, entry: &AuthorityEntry, resume: ReplicaResume) -> Vec<ReplicaAction> {
        match resume {
            ReplicaResume::Admitted => vec![
                self.receipt_action(entry, AckStage::Admitted, None),
                ReplicaAction::ApplyMaterial {
                    entry: entry.clone(),
                },
            ],
            ReplicaResume::MaterialApplied => vec![
                self.receipt_action(entry, AckStage::MaterialApplied, None),
                ReplicaAction::ProjectControl {
                    entry: entry.clone(),
                    expected_control_id: control_id_of(&entry.next_control),
                },
            ],
            ReplicaResume::ControlInstalled => vec![self.receipt_action(
                entry,
                AckStage::ControlInstalled,
                Some(control_id_of(&entry.next_control)),
            )],
        }
    }

    fn receipt_action(
        &self,
        entry: &AuthorityEntry,
        stage: AckStage,
        control_id: Option<String>,
    ) -> ReplicaAction {
        self.receipt_identity_action(
            entry.revision,
            entry.operation_id.clone(),
            stage,
            control_id,
        )
    }

    fn receipt_identity_action(
        &self,
        revision: Revision,
        operation_id: OperationId,
        stage: AckStage,
        control_id: Option<String>,
    ) -> ReplicaAction {
        ReplicaAction::EmitReceipt {
            receipt: AuthorityReceipt {
                context: self.receipt_context.clone(),
                revision,
                operation_id,
                stage,
                control_id,
            },
        }
    }

    fn clear_completed_tail_request(&mut self) {
        self.clear_tail_request_through(self.frontier.control);
    }

    fn clear_tail_request_through(&mut self, revision: Revision) {
        if let Some(requested) = self.requested_tail_from
            && revision >= requested
        {
            self.requested_tail_from = None;
        }
    }
}

fn rejected_step(reason: ReplicaRejectReason) -> ReplicaStep {
    ReplicaStep {
        admission: ReplicaAdmission::Rejected { reason },
        actions: Vec::new(),
    }
}

fn invalid_stage(reason: &str) -> AuthorityReplicaError {
    AuthorityReplicaError::InvalidStage {
        reason: reason.to_owned(),
    }
}

fn invalid_recovery(reason: &str) -> AuthorityReplicaError {
    AuthorityReplicaError::InvalidRecoveryFrontier {
        reason: reason.to_owned(),
    }
}

fn revision_value(revision: Revision) -> u64 {
    revision.into_inner().get()
}

fn tail_proof_capacity() -> SafeU53 {
    u64::try_from(TAIL_PROOF_MAX_SOURCE_REVISIONS)
        .ok()
        .and_then(|value| SafeU53::new(value).ok())
        .unwrap_or(SafeU53::MAX)
}

fn next_revision(revision: Revision) -> Option<Revision> {
    let next = revision_value(revision).checked_add(1)?;
    let safe = SafeU53::new(next).ok()?;
    Some(Revision::new(safe))
}

fn previous_revision(revision: Revision) -> Option<Revision> {
    let value = revision_value(revision);
    if value == 0 {
        None
    } else {
        Some(Revision::new(SafeU53::new(value - 1).ok()?))
    }
}

fn same_entry_identity(left: &AuthorityEntry, right: &AuthorityEntry) -> bool {
    EntryIdentity::from_entry(left).matches(&EntryIdentity::from_entry(right))
}

fn installed_matches_entry(installed: &InstalledControl, entry: &AuthorityEntry) -> bool {
    installed
        .identity
        .matches(&EntryIdentity::from_entry(entry))
}

fn is_valid_entry(entry: &AuthorityEntry) -> bool {
    EntryIdentity::from_entry(entry).is_valid()
}

fn is_valid_context(context: &FrameContext) -> bool {
    !context.session_id.as_str().is_empty()
        && !context.run_id.as_str().is_empty()
        && !context.seat_map_id.is_empty()
}

fn authority_entry_context(
    receipt_context: &FrameContext,
    authority_seat_id: SeatId,
    authority_connection_generation: ConnectionGeneration,
) -> FrameContext {
    FrameContext {
        session_id: receipt_context.session_id.clone(),
        run_id: receipt_context.run_id.clone(),
        session_epoch: receipt_context.session_epoch,
        seat_map_id: receipt_context.seat_map_id.clone(),
        membership_revision: receipt_context.membership_revision,
        sender_seat_id: authority_seat_id,
        authority_seat_id,
        connection_generation: authority_connection_generation,
    }
}

fn is_valid_successor_control(control: &NextControl) -> bool {
    let Ok(value) = serde_json::to_value(control) else {
        return false;
    };
    SuccessorValidator::new().validate(&value).is_ok()
}

impl crate::snapshot::AuthorityReplicaSnapshotBridge for AuthorityReplica {
    fn snapshot_v2(
        &self,
    ) -> Result<crate::snapshot::AuthorityReplicaSnapshotV2, crate::snapshot::SnapshotError> {
        let pending = self
            .pending
            .as_ref()
            .map(|pending| {
                Ok(crate::snapshot::PendingReplicaEntrySnapshotV2 {
                    entry: opaque_authority_entry_snapshot(
                        &pending.entry,
                        "authority_replica.pending",
                    )?,
                    stage: match pending.stage {
                        PendingStage::Admitted => crate::snapshot::PendingReplicaStageV2::Admitted,
                        PendingStage::MaterialApplied => {
                            crate::snapshot::PendingReplicaStageV2::MaterialApplied
                        }
                    },
                })
            })
            .transpose()?;
        let installed_controls = self
            .installed_controls
            .iter()
            .map(|(revision, installed)| {
                let identity = identity_snapshot_from_identity(&installed.identity);
                if *revision != identity.revision
                    || installed.control_id != identity.next_control_id
                {
                    return Err(snapshot_invalid(
                        "authority_replica.installed_controls",
                        "installed control identity is internally inconsistent",
                    ));
                }
                Ok(crate::snapshot::InstalledControlSnapshotV2 {
                    revision: *revision,
                    identity,
                    control_id: installed.control_id.clone(),
                })
            })
            .collect::<Result<Vec<_>, crate::snapshot::SnapshotError>>()?;
        let snapshot = crate::snapshot::AuthorityReplicaSnapshotV2 {
            receipt_context: self.receipt_context.clone(),
            authority_seat: self.authority_seat_id,
            authority_generation: self.authority_connection_generation,
            frontier: self.frontier,
            pending,
            requested_tail_from: self.requested_tail_from,
            installed_controls,
            recovery_proof: self
                .recovery_proof
                .as_ref()
                .map(|proof| identity_snapshot_from_identity(&proof.identity)),
            tail_proof: self.tail_proof.snapshot_v2()?,
            disposed: self.disposed,
        };
        snapshot.validate()?;
        validate_replica_snapshot_state(
            &snapshot,
            self.pending.as_ref(),
            Some(&self.installed_controls),
            self.recovery_proof.as_ref().map(|proof| &proof.identity),
        )?;
        Ok(snapshot)
    }

    fn from_snapshot_v2(
        snapshot: crate::snapshot::AuthorityReplicaSnapshotV2,
    ) -> Result<Self, crate::snapshot::SnapshotError> {
        snapshot.validate()?;
        validate_replica_snapshot_config(&snapshot)?;
        let authority_context = authority_entry_context(
            &snapshot.receipt_context,
            snapshot.authority_seat,
            snapshot.authority_generation,
        );
        let tail_proof = TailProofReplicaState::from_snapshot_v2(
            &snapshot.tail_proof,
            &snapshot.receipt_context,
            &authority_context,
            tail_proof_capacity(),
        )?;

        let pending = snapshot
            .pending
            .as_ref()
            .map(|pending| {
                let entry = decode_authority_entry(
                    &pending.entry.canonical_entry_bytes,
                    "authority_replica.pending.entry.canonical_entry_bytes",
                )?;
                if !is_valid_entry(&entry) {
                    return Err(snapshot_invalid(
                        "authority_replica.pending.entry",
                        "decoded pending AuthorityEntry is invalid",
                    ));
                }
                Ok(PendingReplicaEntry {
                    entry,
                    stage: match pending.stage {
                        crate::snapshot::PendingReplicaStageV2::Admitted => PendingStage::Admitted,
                        crate::snapshot::PendingReplicaStageV2::MaterialApplied => {
                            PendingStage::MaterialApplied
                        }
                    },
                })
            })
            .transpose()?;

        let mut installed_controls = BTreeMap::new();
        for control in &snapshot.installed_controls {
            let identity = entry_identity_from_snapshot(
                &control.identity,
                "authority_replica.installed_controls.identity",
            )?;
            if control.revision != identity.revision
                || control.control_id != identity_snapshot_next_control_id(&identity)
            {
                return Err(snapshot_invalid(
                    "authority_replica.installed_controls",
                    "installed control identity or control ID is contradictory",
                ));
            }
            if installed_controls
                .insert(
                    control.revision,
                    InstalledControl {
                        identity,
                        control_id: control.control_id.clone(),
                    },
                )
                .is_some()
            {
                return Err(snapshot_invalid(
                    "authority_replica.installed_controls",
                    "duplicate installed control revision",
                ));
            }
        }

        let recovery_proof = snapshot
            .recovery_proof
            .as_ref()
            .map(|proof| entry_identity_from_snapshot(proof, "authority_replica.recovery_proof"))
            .transpose()?;

        validate_replica_snapshot_state(
            &snapshot,
            pending.as_ref(),
            Some(&installed_controls),
            recovery_proof.as_ref(),
        )?;

        Ok(Self {
            receipt_context: snapshot.receipt_context,
            authority_seat_id: snapshot.authority_seat,
            authority_connection_generation: snapshot.authority_generation,
            frontier: snapshot.frontier,
            pending,
            requested_tail_from: snapshot.requested_tail_from,
            installed_controls,
            recovery_proof: recovery_proof.map(|identity| RecoveryFrontierProof { identity }),
            tail_proof,
            disposed: snapshot.disposed,
        })
    }
}

fn validate_replica_snapshot_config(
    snapshot: &crate::snapshot::AuthorityReplicaSnapshotV2,
) -> Result<(), crate::snapshot::SnapshotError> {
    if !is_valid_context(&snapshot.receipt_context)
        || snapshot.receipt_context.authority_seat_id != snapshot.authority_seat
        || snapshot.receipt_context.sender_seat_id == snapshot.authority_seat
    {
        return Err(snapshot_invalid(
            "authority_replica.receipt_context",
            "replica configuration is not a receiving-peer context",
        ));
    }
    Ok(())
}

fn validate_replica_snapshot_state(
    snapshot: &crate::snapshot::AuthorityReplicaSnapshotV2,
    pending: Option<&PendingReplicaEntry>,
    installed_controls: Option<&BTreeMap<Revision, InstalledControl>>,
    recovery_proof: Option<&EntryIdentity>,
) -> Result<(), crate::snapshot::SnapshotError> {
    if !(snapshot.frontier.control <= snapshot.frontier.material
        && snapshot.frontier.material <= snapshot.frontier.received)
    {
        return Err(snapshot_invalid(
            "authority_replica.frontier",
            "control <= material <= received must hold",
        ));
    }
    if let Some(capture) = snapshot.tail_proof.capture.as_ref() {
        let predecessor_revision = capture.predecessor_identity.revision;
        let Some(installed) =
            installed_controls.and_then(|controls| controls.get(&predecessor_revision))
        else {
            return Err(snapshot_invalid(
                "authority_replica.tail_proof.capture.predecessor_identity",
                "tail proof capture predecessor is not an installed control",
            ));
        };
        if snapshot.frontier.received != predecessor_revision
            || snapshot.frontier.material != predecessor_revision
            || snapshot.frontier.control != predecessor_revision
            || identity_snapshot_from_identity(&installed.identity) != capture.predecessor_identity
        {
            return Err(snapshot_invalid(
                "authority_replica.tail_proof.capture.predecessor_identity",
                "tail proof capture does not match the exact complete replica predecessor",
            ));
        }
    }

    let expected_context = authority_entry_context(
        &snapshot.receipt_context,
        snapshot.authority_seat,
        snapshot.authority_generation,
    );
    if let Some(installed_controls) = installed_controls {
        for (revision, installed) in installed_controls {
            if *revision != installed.identity.revision
                || *revision > snapshot.frontier.control
                || installed.control_id != identity_snapshot_next_control_id(&installed.identity)
                || installed.identity.context != expected_context
            {
                return Err(snapshot_invalid(
                    "authority_replica.installed_controls",
                    "installed control is outside the live frontier or authenticated context",
                ));
            }
            if !installed.identity.is_valid() {
                return Err(snapshot_invalid(
                    "authority_replica.installed_controls",
                    "installed control identity is invalid",
                ));
            }
        }
    } else {
        for control in &snapshot.installed_controls {
            if control.revision > snapshot.frontier.control
                || control.identity.context != expected_context
                || control.control_id != control.identity.next_control_id
            {
                return Err(snapshot_invalid(
                    "authority_replica.installed_controls",
                    "installed control is outside the live frontier or authenticated context",
                ));
            }
        }
    }

    if let Some(pending) = pending {
        if pending.entry.context != expected_context
            || pending.entry.revision != snapshot.frontier.received
        {
            return Err(snapshot_invalid(
                "authority_replica.pending",
                "pending entry does not match the authenticated received frontier",
            ));
        }
        let Some(previous) = previous_revision(pending.entry.revision) else {
            return Err(snapshot_invalid(
                "authority_replica.pending",
                "pending revision must be positive",
            ));
        };
        let frontier_matches = match pending.stage {
            PendingStage::Admitted => {
                snapshot.frontier.material == previous && snapshot.frontier.control == previous
            }
            PendingStage::MaterialApplied => {
                snapshot.frontier.material == pending.entry.revision
                    && snapshot.frontier.control == previous
            }
        };
        if !frontier_matches {
            return Err(snapshot_invalid(
                "authority_replica.pending",
                "pending stage does not match the ordered frontier",
            ));
        }
    } else if snapshot.disposed {
        validate_disposed_frontier(&snapshot.frontier)?;
    } else if snapshot.frontier.received != snapshot.frontier.material
        || snapshot.frontier.material != snapshot.frontier.control
    {
        return Err(snapshot_invalid(
            "authority_replica.frontier",
            "a replica without pending state must have one complete frontier",
        ));
    }

    if let Some(requested) = snapshot.requested_tail_from
        && requested != next_revision(snapshot.frontier.control).unwrap_or(Revision::ZERO)
    {
        return Err(snapshot_invalid(
            "authority_replica.requested_tail_from",
            "tail request does not identify the current missing revision",
        ));
    }

    match (recovery_proof, pending) {
        (Some(proof), Some(pending)) if pending.stage == PendingStage::MaterialApplied => {
            if !proof.matches(&EntryIdentity::from_entry(&pending.entry))
                || proof.context != expected_context
                || proof.revision != pending.entry.revision
            {
                return Err(snapshot_invalid(
                    "authority_replica.recovery_proof",
                    "recovery proof does not equal the complete pending entry identity",
                ));
            }
        }
        (Some(_), _) => {
            return Err(snapshot_invalid(
                "authority_replica.recovery_proof",
                "recovery proof requires a material-applied pending entry",
            ));
        }
        (None, _) => {}
    }
    if recovery_proof.is_none() && snapshot.recovery_proof.is_some() {
        return Err(snapshot_invalid(
            "authority_replica.recovery_proof",
            "recovery proof could not be reconstructed",
        ));
    }

    if snapshot.disposed
        && (pending.is_some()
            || snapshot.requested_tail_from.is_some()
            || installed_controls.is_some_and(|controls| !controls.is_empty())
            || recovery_proof.is_some())
    {
        return Err(snapshot_invalid(
            "authority_replica",
            "disposed replica cannot retain pending or installed state",
        ));
    }
    Ok(())
}

fn validate_disposed_frontier(
    frontier: &AuthorityFrontier,
) -> Result<(), crate::snapshot::SnapshotError> {
    // dispose clears the pending entry but deliberately leaves the ordered
    // frontier observable.  A partial disposed frontier can therefore only
    // be the one admitted or material-applied successor that was cleared.
    if frontier.control == frontier.material && frontier.material == frontier.received {
        return Ok(());
    }

    let Some(next) = next_revision(frontier.control) else {
        return Err(snapshot_invalid(
            "authority_replica.frontier",
            "disposed incomplete frontier must have a successor revision",
        ));
    };
    let was_admitted = frontier.material == frontier.control && frontier.received == next;
    let was_material_applied = frontier.material == next && frontier.received == next;
    if was_admitted || was_material_applied {
        Ok(())
    } else {
        Err(snapshot_invalid(
            "authority_replica.frontier",
            "disposed incomplete frontier must retain exactly one cleared pending revision",
        ))
    }
}

fn identity_snapshot_from_identity(
    identity: &EntryIdentity,
) -> crate::snapshot::AuthorityEntryIdentitySnapshotV2 {
    crate::snapshot::AuthorityEntryIdentitySnapshotV2 {
        revision: identity.revision,
        context: identity.context.clone(),
        operation_id: identity.operation_id.clone(),
        kind: identity.kind,
        material_digest: identity.material.digest().to_owned(),
        next_control_id: control_id_of(&identity.next_control),
        subsumes: identity.subsumes.clone(),
    }
}

fn identity_snapshot_next_control_id(identity: &EntryIdentity) -> String {
    control_id_of(&identity.next_control)
}

fn opaque_authority_entry_snapshot(
    entry: &AuthorityEntry,
    path: &str,
) -> Result<crate::snapshot::OpaqueAuthorityEntrySnapshotV2, crate::snapshot::SnapshotError> {
    let canonical_entry_bytes = er_canonical::canonical_bytes(entry)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    Ok(crate::snapshot::OpaqueAuthorityEntrySnapshotV2 {
        identity: identity_snapshot_from_identity(&EntryIdentity::from_entry(entry)),
        canonical_entry_bytes: er_types::battle_ids::CanonicalHexBytes::from_bytes(
            &canonical_entry_bytes,
        ),
    })
}

fn decode_authority_entry(
    bytes: &er_types::battle_ids::CanonicalHexBytes,
    path: &str,
) -> Result<AuthorityEntry, crate::snapshot::SnapshotError> {
    decode_snapshot_canonical(bytes, path)
}

fn decode_snapshot_canonical<T>(
    bytes: &er_types::battle_ids::CanonicalHexBytes,
    path: &str,
) -> Result<T, crate::snapshot::SnapshotError>
where
    T: DeserializeOwned + Serialize,
{
    let raw = decode_snapshot_hex(bytes, path)?;
    let decoded = serde_json::from_slice::<T>(&raw)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    let canonical = er_canonical::canonical_bytes(&decoded)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    if canonical != raw {
        return Err(snapshot_canonical(
            path,
            "payload is not the exact canonical JSON encoding",
        ));
    }
    Ok(decoded)
}

fn decode_snapshot_hex(
    bytes: &er_types::battle_ids::CanonicalHexBytes,
    path: &str,
) -> Result<Vec<u8>, crate::snapshot::SnapshotError> {
    let raw = bytes.as_str().as_bytes();
    if !raw.len().is_multiple_of(2) {
        return Err(snapshot_canonical(
            path,
            "canonical payload has odd hex length",
        ));
    }
    let mut decoded = Vec::with_capacity(raw.len() / 2);
    for pair in raw.chunks_exact(2) {
        let Some(high) = snapshot_hex_digit(pair[0]) else {
            return Err(snapshot_canonical(path, "invalid hex"));
        };
        let Some(low) = snapshot_hex_digit(pair[1]) else {
            return Err(snapshot_canonical(path, "invalid hex"));
        };
        decoded.push((high << 4) | low);
    }
    if decoded.is_empty() {
        return Err(snapshot_canonical(
            path,
            "canonical payload must not be empty",
        ));
    }
    Ok(decoded)
}

fn snapshot_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn entry_identity_from_snapshot(
    identity: &crate::snapshot::AuthorityEntryIdentitySnapshotV2,
    path: &str,
) -> Result<EntryIdentity, crate::snapshot::SnapshotError> {
    identity.validate()?;
    if !is_valid_context(&identity.context)
        || validate_authority_operation_id(identity.operation_id.as_str()).is_err()
        || validate_authority_material_digest(identity.material_digest.as_str()).is_err()
    {
        return Err(snapshot_invalid(path, "entry identity is malformed"));
    }
    let next_control = parse_control_id(&identity.next_control_id)
        .ok_or_else(|| snapshot_invalid(path, "next control identity is not reversible"))?;
    let restored_identity = EntryIdentity {
        revision: identity.revision,
        context: identity.context.clone(),
        operation_id: identity.operation_id.clone(),
        kind: identity.kind,
        material: EntryMaterialIdentity::DigestOnly {
            digest: identity.material_digest.clone(),
        },
        next_control,
        subsumes: identity.subsumes.clone(),
    };
    if !restored_identity.is_valid()
        || control_id_of(&restored_identity.next_control) != identity.next_control_id
    {
        return Err(snapshot_invalid(path, "entry identity is invalid"));
    }
    Ok(restored_identity)
}

fn snapshot_invalid(
    path: impl Into<String>,
    reason: impl Into<String>,
) -> crate::snapshot::SnapshotError {
    crate::snapshot::SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn snapshot_canonical(
    path: impl Into<String>,
    reason: impl Into<String>,
) -> crate::snapshot::SnapshotError {
    crate::snapshot::SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

fn parse_control_id(value: &str) -> Option<NextControl> {
    let control = if value.starts_with("COMMAND_FRONTIER/") {
        parse_command_control_id(value)
    } else if value.starts_with("REPLACEMENT/") {
        parse_replacement_control_id(value)
    } else if value.starts_with("SHARED_INTERACTION/") {
        parse_shared_interaction_control_id(value)
    } else if value.starts_with("AWAIT_SUCCESSOR/") {
        parse_await_successor_control_id(value)
    } else if value.starts_with("TERMINAL/") {
        parse_terminal_control_id(value)
    } else {
        None
    }?;
    (is_valid_successor_control(&control) && control_id_of(&control) == value).then_some(control)
}

fn parse_command_control_id(value: &str) -> Option<NextControl> {
    let mut parts = value.split('/');
    if parts.next()? != "COMMAND_FRONTIER" {
        return None;
    }
    let epoch = parse_prefixed_u53(parts.next()?, "e")?;
    let wave = parse_prefixed_u53(parts.next()?, "w")?;
    let turn = parse_prefixed_u53(parts.next()?, "t")?;
    let targets = parts.next()?;
    if parts.next().is_some() || targets.is_empty() {
        return None;
    }
    let commands = targets
        .split(',')
        .map(|target| {
            let mut fields = target.split(':');
            Some(CommandControlTarget {
                field_index: parse_prefixed_u53(fields.next()?, "f")?,
                owner_seat_id: parse_prefixed_seat(fields.next()?, "s")?,
                pokemon_id: parse_prefixed_u53(fields.next()?, "p")?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(NextControl::CommandFrontier(
        er_types::CommandFrontierControl {
            epoch,
            wave,
            turn,
            commands,
        },
    ))
}

fn parse_replacement_control_id(value: &str) -> Option<NextControl> {
    let mut parts = value.split('/');
    if parts.next()? != "REPLACEMENT" {
        return None;
    }
    let operation_id = parse_operation_id(parts.next()?)?;
    let owner_seat_id = parse_prefixed_seat(parts.next()?, "s")?;
    let epoch = parse_prefixed_u53(parts.next()?, "e")?;
    let wave = parse_prefixed_u53(parts.next()?, "w")?;
    let turn = parse_prefixed_u53(parts.next()?, "t")?;
    let occurrence = parse_prefixed_u53(parts.next()?, "o")?;
    let field_index = parse_prefixed_u53(parts.next()?, "f")?;
    let remaining = parts.next()?.strip_prefix("remaining:")?;
    if parts.next().is_some() {
        return None;
    }
    let remaining = if remaining.is_empty() {
        Vec::new()
    } else {
        remaining
            .split(',')
            .map(parse_replacement_address)
            .collect::<Option<Vec<_>>>()?
    };
    Some(NextControl::Replacement(ReplacementControl {
        operation_id,
        owner_seat_id,
        epoch,
        wave,
        turn,
        occurrence,
        field_index,
        remaining,
    }))
}

fn parse_replacement_address(value: &str) -> Option<ReplacementControlAddress> {
    let mut fields = value.split(':');
    let address = ReplacementControlAddress {
        operation_id: parse_operation_id(fields.next()?)?,
        owner_seat_id: parse_prefixed_seat(fields.next()?, "s")?,
        epoch: parse_prefixed_u53(fields.next()?, "e")?,
        wave: parse_prefixed_u53(fields.next()?, "w")?,
        turn: parse_prefixed_u53(fields.next()?, "t")?,
        occurrence: parse_prefixed_u53(fields.next()?, "o")?,
        field_index: parse_prefixed_u53(fields.next()?, "f")?,
    };
    if fields.next().is_some() {
        return None;
    }
    Some(address)
}

fn parse_shared_interaction_control_id(value: &str) -> Option<NextControl> {
    let mut parts = value.split('/');
    if parts.next()? != "SHARED_INTERACTION" {
        return None;
    }
    let surface_class = decode_uri_component(parts.next()?)?;
    let operation_kind = decode_uri_component(parts.next()?)?;
    let operation_id = parse_operation_id(parts.next()?)?;
    let owner_seat_id = parse_prefixed_seat(parts.next()?, "s")?;
    let epoch = parse_prefixed_u53(parts.next()?, "e")?;
    let wave = parse_prefixed_u53(parts.next()?, "w")?;
    let turn = parse_prefixed_u53(parts.next()?, "t")?;
    let operation_kinds = parts.next()?.strip_prefix("results:")?;
    let operation_ids = parts.next()?.strip_prefix("resultIds:")?;
    if parts.next().is_some() || operation_kinds.is_empty() || operation_ids.is_empty() {
        return None;
    }
    let operation_kinds = operation_kinds
        .split(',')
        .map(decode_uri_component)
        .collect::<Option<Vec<_>>>()?;
    let operation_ids = if operation_ids == "*" {
        None
    } else {
        Some(
            operation_ids
                .split(',')
                .map(parse_operation_id)
                .collect::<Option<Vec<_>>>()?,
        )
    };
    Some(NextControl::SharedInteraction(SharedInteractionControl {
        operation_id,
        owner_seat_id,
        epoch,
        wave,
        turn,
        surface_class,
        operation_kind,
        successor: InteractionSuccessor {
            operation_kinds,
            operation_ids,
        },
    }))
}

fn parse_await_successor_control_id(value: &str) -> Option<NextControl> {
    let mut parts = value.split('/');
    if parts.next()? != "AWAIT_SUCCESSOR" {
        return None;
    }
    let after_operation_id = parse_operation_id(parts.next()?)?;
    let epoch = parse_prefixed_u53(parts.next()?, "e")?;
    let wave = parse_prefixed_u53(parts.next()?, "w")?;
    let turn = parse_prefixed_u53(parts.next()?, "t")?;
    let allowed_kinds = parts
        .next()?
        .split(',')
        .map(parse_authority_entry_kind)
        .collect::<Option<Vec<_>>>()?;
    let interaction_addresses = parts.next()?.strip_prefix("interactionAddresses:")?;
    let control_addresses = parts.next()?.strip_prefix("controlAddresses:")?;
    let next_wave = parts.next()?.strip_prefix("nextWave:")?;
    let expected = parts.next()?.strip_prefix("next:")?;
    if parts.next().is_some() || allowed_kinds.is_empty() {
        return None;
    }
    let allowed_interaction_addresses = parse_interaction_addresses(interaction_addresses)?;
    let allowed_control_addresses = parse_control_addresses(control_addresses)?;
    let allow_next_wave_start = match next_wave {
        "0" => false,
        "1" => true,
        _ => return None,
    };
    let expected_operation_id = if expected == "*" {
        None
    } else {
        Some(parse_operation_id(expected)?)
    };
    Some(NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id,
        epoch,
        wave,
        turn,
        allowed_kinds,
        allowed_interaction_addresses,
        allowed_control_addresses,
        allow_next_wave_start,
        expected_operation_id,
    }))
}

fn parse_interaction_addresses(value: &str) -> Option<Option<Vec<InteractionControlAddress>>> {
    if value == "*" {
        return Some(None);
    }
    if value.is_empty() {
        return None;
    }
    Some(Some(
        value
            .split(',')
            .map(|address| {
                let mut fields = address.split(':');
                let address = InteractionControlAddress {
                    surface_class: decode_uri_component(fields.next()?)?,
                    operation_kind: decode_uri_component(fields.next()?)?,
                    wave: parse_prefixed_u53(fields.next()?, "w")?,
                    turn: parse_prefixed_u53(fields.next()?, "t")?,
                };
                if fields.next().is_some() {
                    return None;
                }
                Some(address)
            })
            .collect::<Option<Vec<_>>>()?,
    ))
}

fn parse_control_addresses(value: &str) -> Option<Option<Vec<ControlAddress>>> {
    if value == "*" {
        return Some(None);
    }
    if value.is_empty() {
        return None;
    }
    Some(Some(
        value
            .split(',')
            .map(|address| {
                let mut fields = address.split(':');
                let material_kind = fields.next()?.to_owned();
                let wave = parse_prefixed_u53(fields.next()?, "w")?;
                let turn = parse_prefixed_u53(fields.next()?, "t")?;
                let operation_id = fields.next()?.strip_prefix("id")?;
                let operation_id = if operation_id == "*" {
                    None
                } else {
                    Some(parse_operation_id(operation_id)?)
                };
                if fields.next().is_some() {
                    return None;
                }
                Some(ControlAddress {
                    material_kind,
                    wave,
                    turn,
                    operation_id,
                })
            })
            .collect::<Option<Vec<_>>>()?,
    ))
}

fn parse_terminal_control_id(value: &str) -> Option<NextControl> {
    let encoded = value.strip_prefix("TERMINAL/")?;
    Some(NextControl::Terminal(TerminalControl {
        terminal_id: decode_uri_component(encoded)?,
    }))
}

fn parse_prefixed_u53(value: &str, prefix: &str) -> Option<SafeU53> {
    let value = value.strip_prefix(prefix)?.parse::<u64>().ok()?;
    SafeU53::new(value).ok()
}

fn parse_prefixed_seat(value: &str, prefix: &str) -> Option<SeatId> {
    Some(SeatId::new(parse_prefixed_u53(value, prefix)?))
}

fn parse_operation_id(value: &str) -> Option<OperationId> {
    OperationId::new(decode_uri_component(value)?).ok()
}

fn parse_authority_entry_kind(value: &str) -> Option<AuthorityEntryKind> {
    match value {
        "TURN_COMMIT" => Some(AuthorityEntryKind::TurnCommit),
        "REPLACEMENT_COMMIT" => Some(AuthorityEntryKind::ReplacementCommit),
        "INTERACTION_COMMIT" => Some(AuthorityEntryKind::InteractionCommit),
        "CONTROL_COMMIT" => Some(AuthorityEntryKind::ControlCommit),
        "WAVE_ADVANCE" => Some(AuthorityEntryKind::WaveAdvance),
        "TERMINAL_COMMIT" => Some(AuthorityEntryKind::TerminalCommit),
        _ => None,
    }
}

fn decode_uri_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return None;
        }
        let high = snapshot_hex_digit_ascii(bytes[index + 1])?;
        let low = snapshot_hex_digit_ascii(bytes[index + 2])?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).ok()
}

fn snapshot_hex_digit_ascii(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
