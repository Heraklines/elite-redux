//! Fenced Authority V2 recovery validation and transaction state.

use std::collections::BTreeSet;

use er_types::{
    AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, AwaitSuccessorControl,
    ControlProjectionOutcome, FrameContext, Material, NextControl, RecoveryAppliedProof,
    RecoveryBundle, RecoveryFenceState, RecoveryFenceView, RecoveryPhase, RecoveryRequestBody,
    Revision, SafeU53, TimeClass, TimerId, TimerOwner,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{ScheduledTimer, SchedulerCommand};

pub const DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS: u64 = 300_000;
pub const DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_RECOVERY_PACING_MS: u64 = 16;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryValidationContext {
    pub expected_request_id: String,
    pub live_context: FrameContext,
    pub captured_frontier: Revision,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RecoveryBundleValidation {
    Valid {
        bundle: Box<RecoveryBundle>,
    },
    Stale {
        captured_frontier: Revision,
        bundle_frontier: Revision,
    },
    Mismatch {
        issues: Vec<String>,
    },
}

/// Validate a recovery bundle without mutating a replica or consuming a revision.
///
/// The bundle context is the authority's authenticated context, while the live
/// context is the recovering replica's context.  They therefore share the
/// immutable session identity and authority binding but intentionally do not
/// share sender seat or connection generation.  Tail entries, on the other
/// hand, must carry exactly the bundle's authority context.
pub fn validate_recovery_bundle(
    context: &RecoveryValidationContext,
    bundle: &RecoveryBundle,
) -> RecoveryBundleValidation {
    if context.expected_request_id.is_empty() || bundle.request_id != context.expected_request_id {
        return mismatch(format!(
            "request {} does not match expected {}",
            bundle.request_id, context.expected_request_id
        ));
    }

    if let Some(issue) = recovery_context_issue(&bundle.context, &context.live_context) {
        return mismatch(issue);
    }

    if bundle.membership_revision != bundle.context.membership_revision {
        return mismatch(format!(
            "bundle membership {} does not match bundle context {}",
            bundle.membership_revision, bundle.context.membership_revision
        ));
    }

    let frontier = revision_value(bundle.frontier);
    if bundle.material.digest.is_empty() || bundle.material.digest.len() > 256 {
        return mismatch("material digest must be non-empty and at most 256 bytes".to_owned());
    }

    if frontier == 0 {
        if bundle.frontier_operation_id.is_some() {
            return mismatch("frontier zero requires a null frontier operation id".to_owned());
        }
        if bundle.next_control.is_some() {
            return mismatch("frontier zero requires a null next control".to_owned());
        }
    } else {
        if bundle.frontier_operation_id.is_none() {
            return mismatch("positive frontier requires a frontier operation id".to_owned());
        }
        if bundle.next_control.is_none() {
            return mismatch("positive frontier requires a next control".to_owned());
        }
        if let Some(control) = bundle.next_control.as_ref()
            && let Some(issue) = next_control_issue(control)
        {
            return mismatch(format!("next control {issue}"));
        }
    }

    let captured = revision_value(context.captured_frontier);
    if frontier < captured {
        return RecoveryBundleValidation::Stale {
            captured_frontier: context.captured_frontier,
            bundle_frontier: bundle.frontier,
        };
    }

    if let Some(issue) = tail_issue(bundle, captured, frontier) {
        return mismatch(issue);
    }

    RecoveryBundleValidation::Valid {
        bundle: Box::new(bundle.clone()),
    }
}

fn mismatch(issue: String) -> RecoveryBundleValidation {
    RecoveryBundleValidation::Mismatch {
        issues: vec![issue],
    }
}

fn revision_value(revision: Revision) -> u64 {
    revision.get().get()
}

fn revision_from_value(value: u64) -> Option<Revision> {
    SafeU53::new(value).ok().map(Revision::new)
}

fn positive(value: SafeU53) -> bool {
    value.get() > 0
}

fn recovery_context_issue(bundle: &FrameContext, live: &FrameContext) -> Option<String> {
    if bundle.session_id != live.session_id {
        return Some("bundle session does not match live session".to_owned());
    }
    if bundle.run_id != live.run_id {
        return Some("bundle run does not match live run".to_owned());
    }
    if bundle.session_epoch != live.session_epoch {
        return Some("bundle session epoch does not match live epoch".to_owned());
    }
    if bundle.seat_map_id != live.seat_map_id {
        return Some("bundle seat map does not match live seat map".to_owned());
    }
    if bundle.membership_revision != live.membership_revision {
        return Some("bundle membership does not match live membership".to_owned());
    }
    if bundle.authority_seat_id != live.authority_seat_id {
        return Some("bundle authority seat does not match live authority".to_owned());
    }
    if bundle.sender_seat_id != bundle.authority_seat_id {
        return Some("bundle sender is not the authority".to_owned());
    }
    None
}

fn same_coordinates(
    left_epoch: SafeU53,
    left_wave: SafeU53,
    left_turn: SafeU53,
    right_epoch: SafeU53,
    right_wave: SafeU53,
    right_turn: SafeU53,
) -> bool {
    left_epoch == right_epoch && left_wave == right_wave && left_turn == right_turn
}

fn next_control_issue(control: &NextControl) -> Option<String> {
    let mut issue = None;
    match control {
        NextControl::CommandFrontier(command) => {
            if !positive(command.epoch) || !positive(command.wave) || !positive(command.turn) {
                issue = Some("command coordinates must be positive".to_owned());
            } else if command.commands.is_empty() {
                issue = Some("command frontier must contain a command target".to_owned());
            } else {
                let mut fields = BTreeSet::new();
                for target in &command.commands {
                    if !positive(target.pokemon_id) {
                        issue = Some("command pokemon ids must be positive".to_owned());
                        break;
                    }
                    if !fields.insert(target.field_index) {
                        issue = Some("command field indices must be unique".to_owned());
                        break;
                    }
                }
            }
        }
        NextControl::Replacement(replacement) => {
            issue = replacement_control_issue(replacement);
        }
        NextControl::SharedInteraction(interaction) => {
            if interaction.operation_id.as_str().is_empty()
                || interaction.surface_class.is_empty()
                || interaction.operation_kind.is_empty()
                || !positive(interaction.epoch)
                || interaction.successor.operation_kinds.is_empty()
            {
                issue = Some("shared interaction identity or successor is empty".to_owned());
            } else {
                let mut kinds = BTreeSet::new();
                if interaction
                    .successor
                    .operation_kinds
                    .iter()
                    .any(|kind| kind.is_empty() || !kinds.insert(kind))
                {
                    issue = Some(
                        "shared interaction successor kinds must be unique and non-empty"
                            .to_owned(),
                    );
                }
                if issue.is_none()
                    && let Some(operation_ids) = interaction.successor.operation_ids.as_ref()
                    && (operation_ids.is_empty()
                        || operation_ids
                            .iter()
                            .any(|operation_id| operation_id.as_str().is_empty())
                        || operation_ids.iter().collect::<BTreeSet<_>>().len()
                            != operation_ids.len())
                {
                    issue = Some(
                        "shared interaction successor operation ids must be unique and non-empty"
                            .to_owned(),
                    );
                }
            }
        }
        NextControl::AwaitSuccessor(wait) => {
            issue = await_control_issue(wait);
        }
        NextControl::Terminal(terminal) => {
            if terminal.terminal_id.is_empty() {
                issue = Some("terminal identity must be non-empty".to_owned());
            }
        }
    }
    issue
}

fn replacement_control_issue(control: &er_types::ReplacementControl) -> Option<String> {
    if control.operation_id.as_str().is_empty()
        || !positive(control.epoch)
        || !positive(control.wave)
        || !positive(control.turn)
    {
        return Some("replacement identity and coordinates are invalid".to_owned());
    }

    let mut operation_ids = BTreeSet::new();
    operation_ids.insert(control.operation_id.clone());
    let mut previous_occurrence = control.occurrence;
    for target in &control.remaining {
        if target.operation_id.as_str().is_empty()
            || !positive(target.epoch)
            || !positive(target.wave)
            || !positive(target.turn)
            || !same_coordinates(
                target.epoch,
                target.wave,
                target.turn,
                control.epoch,
                control.wave,
                control.turn,
            )
            || target.occurrence <= previous_occurrence
        {
            return Some("replacement tail has invalid coordinates or occurrence order".to_owned());
        }
        if !operation_ids.insert(target.operation_id.clone()) {
            return Some("replacement operation ids must be unique".to_owned());
        }
        previous_occurrence = target.occurrence;
    }
    None
}

fn await_control_issue(control: &AwaitSuccessorControl) -> Option<String> {
    if control.after_operation_id.as_str().is_empty()
        || !positive(control.epoch)
        || control.allowed_kinds.is_empty()
    {
        return Some("await successor identity, epoch, or allowed kinds is invalid".to_owned());
    }

    let mut kinds = BTreeSet::new();
    if control
        .allowed_kinds
        .iter()
        .any(|kind| !kinds.insert(format!("{kind:?}")))
    {
        return Some("await successor kinds must be unique".to_owned());
    }
    if let Some(operation_id) = control.expected_operation_id.as_ref()
        && operation_id.as_str().is_empty()
    {
        return Some("await successor expected operation id is empty".to_owned());
    }
    if let Some(addresses) = control.allowed_interaction_addresses.as_ref()
        && (addresses.is_empty()
            || addresses.iter().any(|address| {
                address.surface_class.is_empty() || address.operation_kind.is_empty()
            }))
    {
        return Some("await interaction addresses must be non-empty".to_owned());
    }
    if let Some(addresses) = control.allowed_control_addresses.as_ref()
        && (addresses.is_empty()
            || addresses.iter().any(|address| {
                address.material_kind.is_empty()
                    || !positive(address.turn)
                    || (address.wave != control.wave
                        && !(control.allow_next_wave_start
                            && address.wave.get() == control.wave.get().saturating_add(1)))
                    || address
                        .operation_id
                        .as_ref()
                        .is_some_and(|id| id.as_str().is_empty())
            }))
    {
        return Some("await control addresses are invalid".to_owned());
    }
    None
}

fn entry_issue(entry: &AuthorityEntry, bundle_context: &FrameContext) -> Option<String> {
    if revision_value(entry.revision) == 0 {
        return Some("tail entries must have positive revisions".to_owned());
    }
    if entry.operation_id.as_str().is_empty() {
        return Some("tail operation identity must be non-empty".to_owned());
    }
    if entry.material.digest.is_empty() || entry.material.digest.len() > 256 {
        return Some("tail material digest must be non-empty and at most 256 bytes".to_owned());
    }
    if &entry.context != bundle_context {
        return Some(format!(
            "tail revision {} has a different authority frame context",
            entry.revision
        ));
    }
    if let Some(issue) = next_control_issue(&entry.next_control) {
        return Some(format!("tail next control {issue}"));
    }
    if (entry.kind == AuthorityEntryKind::TerminalCommit)
        != matches!(entry.next_control, NextControl::Terminal(_))
    {
        return Some("tail entry kind and next control are incompatible".to_owned());
    }
    if entry
        .subsumes
        .iter()
        .any(|revision| revision_value(*revision) == 0)
    {
        return Some("tail subsumption revisions must be positive".to_owned());
    }
    None
}

fn tail_issue(bundle: &RecoveryBundle, captured: u64, frontier: u64) -> Option<String> {
    if bundle.required_tail.is_empty() {
        return if frontier == 0 && captured == 0 {
            None
        } else {
            Some("nonzero recovery frontier requires its immutable reconstruction entry".to_owned())
        };
    }

    let reconstruction_only = frontier == captured;
    if reconstruction_only && (frontier == 0 || bundle.required_tail.len() != 1) {
        return Some(format!(
            "equal frontier {frontier} requires exactly one reconstruction entry"
        ));
    }

    let mut previous = if reconstruction_only {
        captured.saturating_sub(1)
    } else {
        captured
    };
    let mut operation_ids = BTreeSet::new();
    for entry in &bundle.required_tail {
        if let Some(issue) = entry_issue(entry, &bundle.context) {
            return Some(issue);
        }
        let expected = match previous.checked_add(1).and_then(revision_from_value) {
            Some(revision) => revision,
            None => return Some("tail revision exceeds the safe integer range".to_owned()),
        };
        if entry.revision != expected {
            return Some(format!(
                "tail revision {} is not contiguous after {previous}",
                entry.revision
            ));
        }
        if !operation_ids.insert(entry.operation_id.clone()) {
            return Some(format!(
                "tail operation {} is duplicated",
                entry.operation_id
            ));
        }
        previous = revision_value(entry.revision);
    }

    if previous != frontier {
        return Some(format!("tail ends at {previous}, not frontier {frontier}"));
    }

    let Some(final_entry) = bundle.required_tail.last() else {
        return Some("tail has no final reconstruction entry".to_owned());
    };
    if bundle.next_control.as_ref() != Some(&final_entry.next_control) {
        return Some("tail final next control does not match the recovery successor".to_owned());
    }
    if bundle.frontier_operation_id.as_ref() != Some(&final_entry.operation_id) {
        return Some(format!(
            "tail final operation {} does not match frontier operation",
            final_entry.operation_id
        ));
    }
    None
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryTransactionConfig {
    pub local_context: FrameContext,
    pub request_timeout_ms: SafeU53,
    pub control_timeout_ms: SafeU53,
    pub pacing_ms: SafeU53,
    pub timer_owner_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryAction {
    FenceChanged {
        view: RecoveryFenceView,
    },
    SendRequest {
        request: RecoveryRequestBody,
    },
    Scheduler {
        command: SchedulerCommand,
    },
    ApplyMaterial {
        request_id: String,
        material: Material,
    },
    StageRecoveredFrontier {
        entry: AuthorityEntry,
    },
    ProjectControl {
        revision: Revision,
        control: NextControl,
        expected_control_id: String,
    },
    SendAppliedProof {
        proof: RecoveryAppliedProof,
    },
    Terminalize {
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryMaterialOutcome {
    Applied,
    Deferred,
    Rejected,
}

/// Callback-free shared fence owned by the recovery transaction and consulted
/// synchronously by the kernel's admission/progression boundaries.
#[derive(Debug)]
pub struct RecoveryFence {
    state: RecoveryFenceState,
    control_projection_allowed: bool,
    terminal_reason: Option<String>,
}

impl RecoveryFence {
    pub fn new() -> Self {
        Self {
            state: RecoveryFenceState::Open,
            control_projection_allowed: false,
            terminal_reason: None,
        }
    }

    pub fn state(&self) -> RecoveryFenceState {
        self.state
    }

    pub fn terminal_reason(&self) -> Option<&str> {
        self.terminal_reason.as_deref()
    }

    pub fn acquire(&mut self) -> bool {
        if self.state != RecoveryFenceState::Open {
            return false;
        }
        self.state = RecoveryFenceState::Held;
        self.control_projection_allowed = false;
        true
    }

    pub fn allow_control_projection(&mut self) -> bool {
        if self.state != RecoveryFenceState::Held || self.control_projection_allowed {
            return false;
        }
        self.control_projection_allowed = true;
        true
    }

    pub fn release(&mut self) {
        if self.state != RecoveryFenceState::Held {
            return;
        }
        self.state = RecoveryFenceState::Open;
        self.control_projection_allowed = false;
    }

    pub fn terminalize(&mut self, reason: String) {
        if self.state == RecoveryFenceState::Terminal {
            return;
        }
        self.state = RecoveryFenceState::Terminal;
        self.control_projection_allowed = false;
        self.terminal_reason = Some(reason);
    }

    pub fn is_command_admission_frozen(&self) -> bool {
        self.state != RecoveryFenceState::Open
    }

    pub fn is_control_surface_start_frozen(&self) -> bool {
        self.state != RecoveryFenceState::Open && !self.control_projection_allowed
    }

    pub fn is_progression_frozen(&self) -> bool {
        self.state != RecoveryFenceState::Open
    }

    pub fn is_materialization_frozen(&self) -> bool {
        self.state != RecoveryFenceState::Open
    }

    pub fn is_authority_wait_creation_frozen(&self) -> bool {
        self.state != RecoveryFenceState::Open && !self.control_projection_allowed
    }

    pub fn view(&self) -> RecoveryFenceView {
        RecoveryFenceView {
            state: self.state,
            command_admission_frozen: self.is_command_admission_frozen(),
            control_surface_start_frozen: self.is_control_surface_start_frozen(),
            progression_frozen: self.is_progression_frozen(),
            materialization_frozen: self.is_materialization_frozen(),
            authority_wait_creation_frozen: self.is_authority_wait_creation_frozen(),
            terminal_reason: self.terminal_reason.clone(),
        }
    }
}

impl Default for RecoveryFence {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDiagnostics {
    pub phase: Option<RecoveryPhase>,
    pub fence_state: Option<RecoveryFenceState>,
    pub request_id: Option<String>,
    pub captured_frontier: Option<Revision>,
    pub bundle_frontier: Option<Revision>,
    pub timer_ids: BTreeSet<TimerId>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RecoveryError {
    #[error("recovery transaction is disposed")]
    Disposed,
    #[error("another recovery transaction already holds the fence")]
    FenceHeld,
    #[error("recovery transition is invalid in phase {phase:?}")]
    InvalidPhase { phase: Option<RecoveryPhase> },
    #[error("recovery bundle is stale")]
    StaleBundle,
    #[error("recovery bundle does not match: {issues:?}")]
    BundleMismatch { issues: Vec<String> },
    #[error("recovery transaction terminalized: {reason}")]
    Terminalized { reason: String },
}

const REQUEST_TIMER_NUMBER: u64 = 0;
const CONTROL_TIMER_NUMBER: u64 = 1;
const PACING_TIMER_NUMBER: u64 = 2;

fn recovery_timer_id(number: u64) -> TimerId {
    match SafeU53::new(number) {
        Ok(value) => TimerId::new(value),
        Err(_) => TimerId::ZERO,
    }
}

#[derive(Debug)]
pub struct RecoveryTransaction {
    config: RecoveryTransactionConfig,
    fence: RecoveryFence,
    phase: Option<RecoveryPhase>,
    request_id: Option<String>,
    captured_frontier: Option<Revision>,
    bundle: Option<RecoveryBundle>,
    timer_ids: BTreeSet<TimerId>,
    disposed: bool,
}

impl RecoveryTransaction {
    pub fn new(config: RecoveryTransactionConfig) -> Result<Self, RecoveryError> {
        Ok(Self {
            config,
            fence: RecoveryFence::new(),
            phase: None,
            request_id: None,
            captured_frontier: None,
            bundle: None,
            timer_ids: BTreeSet::new(),
            disposed: false,
        })
    }

    pub fn start(
        &mut self,
        request_id: String,
        captured: AuthorityFrontier,
        reason: String,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        if self.fence.state() == RecoveryFenceState::Terminal
            || self.phase == Some(RecoveryPhase::Terminalized)
        {
            return Err(RecoveryError::Terminalized {
                reason: match self.fence.terminal_reason() {
                    Some(reason) => reason.to_owned(),
                    None => "recovery transaction terminalized".to_owned(),
                },
            });
        }
        if self.phase.is_some() {
            if self.fence.state() == RecoveryFenceState::Held {
                return Err(RecoveryError::FenceHeld);
            }
            return Err(RecoveryError::InvalidPhase { phase: self.phase });
        }
        if !self.fence.acquire() {
            return Err(RecoveryError::FenceHeld);
        }

        self.request_id = Some(request_id.clone());
        self.captured_frontier = Some(captured.control);
        self.set_phase(RecoveryPhase::FenceAcquired);
        let mut actions = vec![RecoveryAction::FenceChanged {
            view: self.fence.view(),
        }];
        self.set_phase(RecoveryPhase::FrontierCaptured);
        self.set_phase(RecoveryPhase::Requested);

        let request_timer = recovery_timer_id(REQUEST_TIMER_NUMBER);
        self.timer_ids.insert(request_timer);
        actions.push(self.schedule_timer(
            request_timer,
            self.config.request_timeout_ms,
            "request",
            "authority-v2 recovery request deadline",
        ));
        actions.push(RecoveryAction::SendRequest {
            request: RecoveryRequestBody {
                request_id,
                captured_frontier: captured.control,
                reason,
            },
        });
        Ok(actions)
    }

    pub fn accept_bundle(
        &mut self,
        bundle: RecoveryBundle,
        live_frontier: AuthorityFrontier,
        live_context: &FrameContext,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::Requested)?;
        let captured = self
            .captured_frontier
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        if live_frontier.control != captured {
            let reason = format!(
                "frontier advanced under the recovery fence ({} -> {})",
                captured, live_frontier.control
            );
            let _ = self.terminalize_with_actions(reason);
            return Err(RecoveryError::StaleBundle);
        }

        let validation = validate_recovery_bundle(
            &RecoveryValidationContext {
                expected_request_id: self.request_id.clone().unwrap_or_default(),
                live_context: live_context.clone(),
                captured_frontier: captured,
            },
            &bundle,
        );
        let valid_bundle = match validation {
            RecoveryBundleValidation::Valid { bundle } => *bundle,
            RecoveryBundleValidation::Stale {
                captured_frontier,
                bundle_frontier,
            } => {
                let reason = format!(
                    "recovery bundle frontier {} is stale behind captured {}",
                    bundle_frontier, captured_frontier
                );
                let _ = self.terminalize_with_actions(reason);
                return Err(RecoveryError::StaleBundle);
            }
            RecoveryBundleValidation::Mismatch { issues } => {
                let reason = format!("recovery bundle mismatch: {issues:?}");
                let _ = self.terminalize_with_actions(reason);
                return Err(RecoveryError::BundleMismatch { issues });
            }
        };

        self.bundle = Some(valid_bundle.clone());
        self.set_phase(RecoveryPhase::Validated);
        let mut actions = self.cancel_timer(recovery_timer_id(REQUEST_TIMER_NUMBER));
        actions.push(RecoveryAction::ApplyMaterial {
            request_id: valid_bundle.request_id,
            material: valid_bundle.material,
        });
        Ok(actions)
    }

    pub fn material_result(
        &mut self,
        outcome: RecoveryMaterialOutcome,
        live_frontier: AuthorityFrontier,
        live_context: &FrameContext,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::Validated)?;
        let captured = self
            .captured_frontier
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        let bundle = self
            .bundle
            .clone()
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;

        if live_frontier.control != captured {
            let reason = format!(
                "post-apply recovery frontier advanced under the fence ({} -> {})",
                captured, live_frontier.control
            );
            let _ = self.terminalize_with_actions(reason);
            return Err(RecoveryError::StaleBundle);
        }
        match validate_recovery_bundle(
            &RecoveryValidationContext {
                expected_request_id: self.request_id.clone().unwrap_or_default(),
                live_context: live_context.clone(),
                captured_frontier: captured,
            },
            &bundle,
        ) {
            RecoveryBundleValidation::Valid { .. } => {}
            RecoveryBundleValidation::Stale { .. } => {
                let reason = "post-apply recovery bundle is stale".to_owned();
                let _ = self.terminalize_with_actions(reason);
                return Err(RecoveryError::StaleBundle);
            }
            RecoveryBundleValidation::Mismatch { issues } => {
                let reason = format!("post-apply recovery bundle mismatch: {issues:?}");
                let _ = self.terminalize_with_actions(reason);
                return Err(RecoveryError::BundleMismatch { issues });
            }
        }

        match outcome {
            RecoveryMaterialOutcome::Applied => {
                self.set_phase(RecoveryPhase::MaterialApplied);
                if revision_value(bundle.frontier) == 0 {
                    self.set_phase(RecoveryPhase::FrontierInstalled);
                    self.set_phase(RecoveryPhase::ControlInstalled);
                    return Ok(self.complete_success(None, &bundle));
                }
                let Some(entry) = bundle.required_tail.last().cloned() else {
                    let reason = "recovery material applied without a frontier entry".to_owned();
                    let actions = self.terminalize_with_actions(reason.clone());
                    return Ok(actions);
                };
                Ok(vec![RecoveryAction::StageRecoveredFrontier { entry }])
            }
            RecoveryMaterialOutcome::Deferred => {
                let reason = "recovery material application deferred".to_owned();
                Ok(self.terminalize_with_actions(reason))
            }
            RecoveryMaterialOutcome::Rejected => {
                let reason = "recovery material application rejected".to_owned();
                Ok(self.terminalize_with_actions(reason))
            }
        }
    }

    pub fn recovered_frontier_staged(
        &mut self,
        revision: Revision,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::MaterialApplied)?;
        let bundle = self
            .bundle
            .clone()
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        if revision_value(bundle.frontier) == 0 || revision != bundle.frontier {
            let issue = format!(
                "staged recovery revision {} does not match bundle frontier {}",
                revision, bundle.frontier
            );
            let reason = format!("recovery frontier staging mismatch: {issue}");
            let actions = self.terminalize_with_actions(reason);
            return Ok(actions);
        }

        self.set_phase(RecoveryPhase::FrontierInstalled);
        if !self.fence.allow_control_projection() {
            let reason = "recovery fence refused the exact control-projection window".to_owned();
            return Ok(self.terminalize_with_actions(reason));
        }

        let control_timer = recovery_timer_id(CONTROL_TIMER_NUMBER);
        self.timer_ids.insert(control_timer);
        let control = bundle.next_control.clone();
        let Some(control) = control else {
            let reason = "positive recovery frontier has no successor control".to_owned();
            return Ok(self.terminalize_with_actions(reason));
        };
        let mut actions = vec![RecoveryAction::FenceChanged {
            view: self.fence.view(),
        }];
        actions.push(self.schedule_timer(
            control_timer,
            self.config.control_timeout_ms,
            "control",
            "await exact Authority V2 recovery control proof",
        ));
        actions.push(RecoveryAction::ProjectControl {
            revision,
            expected_control_id: crate::control_id_of(&control),
            control,
        });
        Ok(actions)
    }

    pub fn control_result(
        &mut self,
        outcome: ControlProjectionOutcome,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::FrontierInstalled)?;
        let bundle = self
            .bundle
            .clone()
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        let Some(control) = bundle.next_control.as_ref() else {
            let reason = "control result received for an empty recovery frontier".to_owned();
            return Ok(self.terminalize_with_actions(reason));
        };
        let expected_control_id = crate::control_id_of(control);

        match outcome {
            ControlProjectionOutcome::Installed { control_id }
            | ControlProjectionOutcome::AlreadyInstalled { control_id } => {
                if control_id != expected_control_id {
                    let reason = format!(
                        "control projection proved {control_id}, expected {expected_control_id}"
                    );
                    return Ok(self.terminalize_with_actions(reason));
                }
                let mut actions = self.cancel_timer(recovery_timer_id(CONTROL_TIMER_NUMBER));
                actions.extend(self.cancel_timer(recovery_timer_id(PACING_TIMER_NUMBER)));
                self.set_phase(RecoveryPhase::ControlInstalled);
                actions.extend(self.complete_success(Some(control_id), &bundle));
                Ok(actions)
            }
            ControlProjectionOutcome::Deferred => {
                if self
                    .timer_ids
                    .contains(&recovery_timer_id(PACING_TIMER_NUMBER))
                {
                    return Ok(Vec::new());
                }
                let pacing_timer = recovery_timer_id(PACING_TIMER_NUMBER);
                self.timer_ids.insert(pacing_timer);
                Ok(vec![self.schedule_timer(
                    pacing_timer,
                    self.config.pacing_ms,
                    "pacing",
                    "await exact Authority V2 recovery control proof",
                )])
            }
            ControlProjectionOutcome::Rejected { reason } => {
                Ok(self.terminalize_with_actions(format!("control projection rejected: {reason}")))
            }
        }
    }

    pub fn timer_fired(&mut self, timer_id: TimerId) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        if self.fence.state() == RecoveryFenceState::Terminal
            || self.phase == Some(RecoveryPhase::Terminalized)
        {
            return Err(RecoveryError::Terminalized {
                reason: match self.fence.terminal_reason() {
                    Some(reason) => reason.to_owned(),
                    None => "recovery transaction terminalized".to_owned(),
                },
            });
        }
        if !self.timer_ids.remove(&timer_id) {
            return Err(RecoveryError::InvalidPhase { phase: self.phase });
        }

        if timer_id == recovery_timer_id(REQUEST_TIMER_NUMBER) {
            if self.phase != Some(RecoveryPhase::Requested) {
                return Err(RecoveryError::InvalidPhase { phase: self.phase });
            }
            return Ok(
                self.terminalize_with_actions("recovery request timeout exceeded".to_owned())
            );
        }
        if timer_id == recovery_timer_id(CONTROL_TIMER_NUMBER) {
            if self.phase != Some(RecoveryPhase::FrontierInstalled) {
                return Err(RecoveryError::InvalidPhase { phase: self.phase });
            }
            return Ok(self
                .terminalize_with_actions("recovery control-install timeout exceeded".to_owned()));
        }
        if timer_id == recovery_timer_id(PACING_TIMER_NUMBER) {
            if self.phase != Some(RecoveryPhase::FrontierInstalled) {
                return Err(RecoveryError::InvalidPhase { phase: self.phase });
            }
            let Some(bundle) = self.bundle.as_ref() else {
                return Err(RecoveryError::InvalidPhase { phase: self.phase });
            };
            let Some(control) = bundle.next_control.clone() else {
                return Ok(self.terminalize_with_actions(
                    "recovery pacing fired without a successor control".to_owned(),
                ));
            };
            return Ok(vec![RecoveryAction::ProjectControl {
                revision: bundle.frontier,
                expected_control_id: crate::control_id_of(&control),
                control,
            }]);
        }

        Err(RecoveryError::InvalidPhase { phase: self.phase })
    }

    pub fn abort(&mut self, reason: String) -> Vec<RecoveryAction> {
        if self.disposed || self.phase == Some(RecoveryPhase::Released) {
            return Vec::new();
        }
        self.terminalize_with_actions(if reason.is_empty() {
            "recovery aborted".to_owned()
        } else {
            reason
        })
    }

    pub fn phase(&self) -> Option<RecoveryPhase> {
        self.phase
    }

    pub fn fence_view(&self) -> Option<RecoveryFenceView> {
        if self.disposed {
            None
        } else {
            Some(self.fence.view())
        }
    }

    pub fn fence(&self) -> Option<&RecoveryFence> {
        if self.disposed {
            None
        } else {
            Some(&self.fence)
        }
    }

    pub fn diagnostics(&self) -> RecoveryDiagnostics {
        RecoveryDiagnostics {
            phase: self.phase,
            fence_state: Some(self.fence.state()),
            request_id: self.request_id.clone(),
            captured_frontier: self.captured_frontier,
            bundle_frontier: self.bundle.as_ref().map(|bundle| bundle.frontier),
            timer_ids: self.timer_ids.clone(),
            disposed: self.disposed,
        }
    }

    pub fn dispose(&mut self, reason: &str) -> Vec<RecoveryAction> {
        if self.disposed {
            return Vec::new();
        }
        let actions = if self.phase == Some(RecoveryPhase::Released) {
            Vec::new()
        } else {
            self.terminalize_with_actions(if reason.is_empty() {
                "recovery transaction disposed".to_owned()
            } else {
                reason.to_owned()
            })
        };
        self.bundle = None;
        self.disposed = true;
        actions
    }

    fn ensure_not_disposed(&self) -> Result<(), RecoveryError> {
        if self.disposed {
            Err(RecoveryError::Disposed)
        } else {
            Ok(())
        }
    }

    fn ensure_phase(&self, expected: RecoveryPhase) -> Result<(), RecoveryError> {
        if self.fence.state() == RecoveryFenceState::Terminal
            || self.phase == Some(RecoveryPhase::Terminalized)
        {
            return Err(RecoveryError::Terminalized {
                reason: match self.fence.terminal_reason() {
                    Some(reason) => reason.to_owned(),
                    None => "recovery transaction terminalized".to_owned(),
                },
            });
        }
        if self.phase != Some(expected) {
            return Err(RecoveryError::InvalidPhase { phase: self.phase });
        }
        Ok(())
    }

    fn set_phase(&mut self, phase: RecoveryPhase) {
        self.phase = Some(phase);
    }

    fn schedule_timer(
        &self,
        timer_id: TimerId,
        delay_ms: SafeU53,
        category: &str,
        reason: &str,
    ) -> RecoveryAction {
        let request_id = self.request_id.as_deref().unwrap_or("unstarted");
        let owner_id = self.config.timer_owner_id.clone();
        let address_prefix = if category == "request" {
            "recovery"
        } else {
            "recovery-control"
        };
        let address = format!(
            "{address_prefix}/{}/{}/{}",
            self.config.local_context.session_id, self.config.local_context.run_id, request_id
        );
        RecoveryAction::Scheduler {
            command: SchedulerCommand::Schedule {
                timer: ScheduledTimer {
                    endpoint: self.config.local_context.sender_seat_id,
                    timer_id,
                    owner: TimerOwner {
                        owner_id,
                        address,
                        reason: reason.to_owned(),
                    },
                    delay_ms,
                    time_class: TimeClass::Recovery,
                },
            },
        }
    }

    fn cancel_timer(&mut self, timer_id: TimerId) -> Vec<RecoveryAction> {
        if !self.timer_ids.remove(&timer_id) {
            return Vec::new();
        }
        vec![RecoveryAction::Scheduler {
            command: SchedulerCommand::Cancel {
                endpoint: self.config.local_context.sender_seat_id,
                timer_id,
            },
        }]
    }

    fn complete_success(
        &mut self,
        control_id: Option<String>,
        bundle: &RecoveryBundle,
    ) -> Vec<RecoveryAction> {
        let proof = RecoveryAppliedProof {
            request_id: bundle.request_id.clone(),
            frontier: bundle.frontier,
            material_digest: bundle.material.digest.clone(),
            control_id,
        };
        self.set_phase(RecoveryPhase::Acked);
        let mut actions = vec![RecoveryAction::SendAppliedProof { proof }];
        self.fence.release();
        actions.push(RecoveryAction::FenceChanged {
            view: self.fence.view(),
        });
        self.set_phase(RecoveryPhase::Released);
        actions
    }

    fn terminalize_with_actions(&mut self, reason: String) -> Vec<RecoveryAction> {
        if self.phase == Some(RecoveryPhase::Terminalized)
            || self.fence.state() == RecoveryFenceState::Terminal
        {
            return Vec::new();
        }
        let mut actions = vec![RecoveryAction::FenceChanged {
            view: {
                self.fence.terminalize(reason.clone());
                self.fence.view()
            },
        }];
        let timer_ids: Vec<TimerId> = self.timer_ids.iter().copied().collect();
        for timer_id in timer_ids {
            actions.extend(self.cancel_timer(timer_id));
        }
        self.set_phase(RecoveryPhase::Terminalized);
        actions.push(RecoveryAction::Terminalize { reason });
        actions
    }
}
