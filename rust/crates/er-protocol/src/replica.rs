//! Replica-side admission and staged material/control progression.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, AuthorityReceipt,
    ConnectionGeneration, ControlProjectionOutcome, FrameContext, Material,
    MaterialApplicationOutcome, NextControl, OperationId, RecoveredFrontierTerminal, Revision,
    SafeU53, SeatId, validate_authority_material_digest, validate_authority_operation_id,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

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
    receipt_context: FrameContext,
    authority_seat_id: SeatId,
    authority_connection_generation: ConnectionGeneration,
    frontier: AuthorityFrontier,
    pending: Option<PendingReplicaEntry>,
    requested_tail_from: Option<Revision>,
    installed_controls: BTreeMap<Revision, InstalledControl>,
    recovery_proof: Option<RecoveryFrontierProof>,
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

/// Complete local identity for one authenticated authority entry.
///
/// The revision is kept in the identity even where a surrounding map is
/// already keyed by it.  That makes every comparison path use the same
/// complete value: revision, all entry material/control fields, and all
/// authenticated frame-context dimensions.
#[derive(Clone, Debug, PartialEq)]
struct EntryIdentity {
    revision: Revision,
    context: FrameContext,
    operation_id: OperationId,
    kind: AuthorityEntryKind,
    material: Material,
    next_control: NextControl,
    subsumes: Vec<Revision>,
}

impl EntryIdentity {
    fn from_entry(entry: &AuthorityEntry) -> Self {
        Self {
            revision: entry.revision,
            context: entry.context.clone(),
            operation_id: entry.operation_id.clone(),
            kind: entry.kind,
            material: entry.material.clone(),
            next_control: entry.next_control.clone(),
            subsumes: entry.subsumes.clone(),
        }
    }

    fn matches_terminal(&self, revision: Revision, terminal: &RecoveredFrontierTerminal) -> bool {
        self.revision == revision
            && self.operation_id == terminal.operation_id
            && self.next_control == terminal.next_control
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
                    actions: vec![self.receipt_action(
                        &entry,
                        AckStage::ControlInstalled,
                        Some(control_id_of(&entry.next_control)),
                    )],
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
                    let Some(predecessor) = self.installed_controls.get(&self.frontier.control)
                    else {
                        return rejected_step(ReplicaRejectReason::PredecessorControlMismatch);
                    };
                    if !SuccessorValidator::new().allows(
                        &predecessor.identity.next_control,
                        &predecessor.identity.operation_id,
                        &entry,
                    ) {
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
        let entry_identity = EntryIdentity::from_entry(&entry);
        if let Some(proof) = self.recovery_proof.as_ref() {
            if proof.identity != entry_identity
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
        if proof.identity != identity || !self.identity_matches_current_context(&proof.identity) {
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
    EntryIdentity::from_entry(left) == EntryIdentity::from_entry(right)
}

fn installed_matches_entry(installed: &InstalledControl, entry: &AuthorityEntry) -> bool {
    installed.identity == EntryIdentity::from_entry(entry)
}

fn is_valid_entry(entry: &AuthorityEntry) -> bool {
    if revision_value(entry.revision) == 0
        || validate_authority_operation_id(entry.operation_id.as_str()).is_err()
        || validate_authority_material_digest(entry.material.digest.as_str()).is_err()
        || !is_valid_context(&entry.context)
        || entry
            .subsumes
            .iter()
            .any(|revision| revision_value(*revision) == 0)
        || !is_valid_successor_control(&entry.next_control)
    {
        return false;
    }
    match entry.kind {
        AuthorityEntryKind::TerminalCommit => {
            matches!(entry.next_control, NextControl::Terminal(_))
        }
        _ => !matches!(entry.next_control, NextControl::Terminal(_)),
    }
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
