//! Fenced Authority V2 recovery validation and transaction state.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, AwaitSuccessorControl,
    ControlProjectionOutcome, FrameContext, Material, NextControl, RecoveryAppliedProof,
    RecoveryBundle, RecoveryFenceState, RecoveryFenceView, RecoveryPhase, RecoveryRequestBody,
    Revision, SafeU53, TimeClass, TimerId, TimerOwner,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{KernelScheduler, ScheduledTimer, SchedulerCommand, SchedulerError};

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
    if let Err(error) = er_types::validate_authority_material_digest(&bundle.material.digest) {
        return mismatch(format!("material digest is invalid: {error}"));
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
    if let Some(issue) = frame_shape_issue(bundle, "bundle") {
        return Some(issue);
    }
    if let Some(issue) = frame_shape_issue(live, "live") {
        return Some(issue);
    }
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

fn frame_shape_issue(context: &FrameContext, label: &str) -> Option<String> {
    if context.session_id.as_str().is_empty() {
        return Some(format!("{label} session id must be non-empty"));
    }
    if context.run_id.as_str().is_empty() {
        return Some(format!("{label} run id must be non-empty"));
    }
    if context.seat_map_id.is_empty() {
        return Some(format!("{label} seat map id must be non-empty"));
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
    // The successor lane owns the canonical structural/semantic validator; the
    // typed checks below retain the recovery-specific diagnostics and local
    // cross-field guardrails around that shared validation.
    let wire = match serde_json::to_value(control) {
        Ok(wire) => wire,
        Err(error) => return Some(format!("next control cannot be encoded: {error}")),
    };
    if let Err(error) = crate::validate_next_control(&wire) {
        return Some(format!("shared successor validator: {error}"));
    }

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
                || !positive(interaction.epoch)
                || interaction.successor.operation_kinds.is_empty()
            {
                issue = Some("shared interaction identity or successor is empty".to_owned());
            } else if !is_known_interaction_surface(&interaction.surface_class)
                || !is_known_interaction_kind(&interaction.operation_kind)
                || !interaction_surface_allows_kind(
                    &interaction.surface_class,
                    &interaction.operation_kind,
                )
            {
                issue = Some(
                    "shared interaction surface and operation kind are incompatible".to_owned(),
                );
            } else {
                let mut kinds = BTreeSet::new();
                if interaction
                    .successor
                    .operation_kinds
                    .iter()
                    .any(|kind| !is_known_interaction_kind(kind) || !kinds.insert(kind))
                {
                    issue = Some(
                        "shared interaction successor kinds must be known, unique, and non-empty"
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

fn is_known_interaction_surface(surface: &str) -> bool {
    matches!(
        surface,
        "op:ability"
            | "op:bargain"
            | "op:biome"
            | "op:catchFull"
            | "op:colosseum"
            | "op:learnMove"
            | "op:me"
            | "op:revival"
            | "op:reward"
            | "op:stormglass"
    )
}

fn is_known_interaction_kind(kind: &str) -> bool {
    matches!(
        kind,
        "ABILITY_PRESENT"
            | "ABILITY_PICK"
            | "BARGAIN_PRESENT"
            | "BARGAIN"
            | "BIOME_PICK"
            | "CATCH_FULL"
            | "COLO_PICK"
            | "CROSSROADS_PICK"
            | "LEARN_MOVE"
            | "LEARN_MOVE_BATCH"
            | "ME_BUTTON"
            | "ME_PICK"
            | "ME_PRESENT"
            | "ME_SUB"
            | "ME_TERMINAL"
            | "QUIZ_ANSWER"
            | "REVIVAL"
            | "REWARD"
            | "REWARD_PRESENT"
            | "SHOP_BUY"
            | "SHOP_PRESENT"
            | "STORMGLASS_PRESENT"
            | "STORMGLASS"
    )
}

fn interaction_surface_allows_kind(surface: &str, kind: &str) -> bool {
    match kind {
        "ABILITY_PRESENT" | "ABILITY_PICK" => surface == "op:ability",
        "BARGAIN_PRESENT" | "BARGAIN" => surface == "op:bargain",
        "BIOME_PICK" | "CROSSROADS_PICK" => surface == "op:biome",
        "CATCH_FULL" => surface == "op:catchFull",
        "COLO_PICK" => surface == "op:colosseum",
        "LEARN_MOVE" | "LEARN_MOVE_BATCH" => surface == "op:learnMove",
        "ME_BUTTON" | "ME_PICK" | "ME_PRESENT" | "ME_SUB" | "QUIZ_ANSWER" => surface == "op:me",
        "ME_TERMINAL" => matches!(surface, "op:me" | "op:reward" | "op:biome"),
        "REVIVAL" => surface == "op:revival",
        "REWARD" | "REWARD_PRESENT" | "SHOP_BUY" | "SHOP_PRESENT" => surface == "op:reward",
        "STORMGLASS_PRESENT" | "STORMGLASS" => surface == "op:stormglass",
        _ => false,
    }
}

fn is_known_control_material_kind(kind: &str) -> bool {
    matches!(kind, "command-open" | "interaction-open")
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
    if let Some(addresses) = control.allowed_interaction_addresses.as_ref() {
        if addresses.is_empty()
            || !control
                .allowed_kinds
                .contains(&AuthorityEntryKind::InteractionCommit)
        {
            return Some("await interaction addresses require INTERACTION_COMMIT".to_owned());
        }
        let mut seen = BTreeSet::new();
        for address in addresses {
            if !is_known_interaction_surface(&address.surface_class)
                || !is_known_interaction_kind(&address.operation_kind)
                || !interaction_surface_allows_kind(&address.surface_class, &address.operation_kind)
                || address.wave != control.wave
            {
                return Some("await interaction address is not a known coupled address".to_owned());
            }
            let key = (
                address.surface_class.clone(),
                address.operation_kind.clone(),
                address.wave.get(),
                address.turn.get(),
            );
            if !seen.insert(key) {
                return Some("await interaction addresses must be unique".to_owned());
            }
        }
    }
    if let Some(addresses) = control.allowed_control_addresses.as_ref() {
        if addresses.is_empty()
            || !control
                .allowed_kinds
                .contains(&AuthorityEntryKind::ControlCommit)
        {
            return Some("await control addresses require CONTROL_COMMIT".to_owned());
        }
        let mut seen = BTreeSet::new();
        for address in addresses {
            let wave_is_allowed = address.wave == control.wave
                || (control.allow_next_wave_start
                    && address.wave.get() == control.wave.get().saturating_add(1));
            if !is_known_control_material_kind(&address.material_kind)
                || !positive(address.turn)
                || !wave_is_allowed
                || address
                    .operation_id
                    .as_ref()
                    .is_some_and(|id| id.as_str().is_empty())
            {
                return Some(
                    "await control address has an unknown kind or invalid coordinate".to_owned(),
                );
            }
            let key = (
                address.material_kind.clone(),
                address.wave.get(),
                address.turn.get(),
                address.operation_id.as_ref().map(ToString::to_string),
            );
            if !seen.insert(key) {
                return Some("await control addresses must be unique".to_owned());
            }
        }
    }
    None
}

fn entry_issue(entry: &AuthorityEntry, bundle_context: &FrameContext) -> Option<String> {
    if revision_value(entry.revision) == 0 {
        return Some("tail entries must have positive revisions".to_owned());
    }
    if let Err(error) = er_types::validate_authority_operation_id(entry.operation_id.as_str()) {
        return Some(format!("tail operation identity is invalid: {error}"));
    }
    if let Err(error) = er_types::validate_authority_material_digest(&entry.material.digest) {
        return Some(format!("tail material digest is invalid: {error}"));
    }
    if let Some(issue) = frame_shape_issue(&entry.context, "tail") {
        return Some(issue);
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
    if !crate::controls_equal(
        bundle.next_control.as_ref(),
        Some(&final_entry.next_control),
    ) {
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryLiveState {
    pub frontier: AuthorityFrontier,
    pub context: FrameContext,
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryFrontierStagingOutcome {
    Staged { revision: Revision },
    Rejected { reason: String },
}

/// Callback-free shared fence owned by the recovery transaction and consulted
/// synchronously by the kernel's admission/progression boundaries.
#[derive(Clone, Debug)]
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
    #[error(transparent)]
    Scheduler(#[from] SchedulerError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RecoveryTimerKind {
    Request,
    Control,
    Pacing,
}

#[derive(Clone, Debug)]
struct RecoveryTimer {
    timer: ScheduledTimer,
    kind: RecoveryTimerKind,
}

fn pacing_delay(delay_ms: SafeU53) -> SafeU53 {
    if delay_ms.get() == 0 {
        match SafeU53::new(1) {
            Ok(one_millisecond) => one_millisecond,
            Err(_) => SafeU53::ZERO,
        }
    } else {
        delay_ms
    }
}

#[derive(Clone, Debug)]
pub struct RecoveryTransaction {
    config: RecoveryTransactionConfig,
    fence: RecoveryFence,
    phase: Option<RecoveryPhase>,
    request_id: Option<String>,
    captured_frontier: Option<Revision>,
    captured_state: Option<AuthorityFrontier>,
    bundle: Option<RecoveryBundle>,
    timers: BTreeMap<TimerId, RecoveryTimer>,
    disposed: bool,
}

impl RecoveryTransaction {
    pub fn new(config: RecoveryTransactionConfig) -> Result<Self, RecoveryError> {
        if config.request_timeout_ms == SafeU53::ZERO
            || config.control_timeout_ms == SafeU53::ZERO
            || config.pacing_ms == SafeU53::ZERO
        {
            return Err(RecoveryError::InvalidPhase { phase: None });
        }

        // TimerOwner is an opaque shared contract.  Validate the configured
        // owner through its canonical constructor before the transaction can
        // acquire the fence; in particular, an empty owner ID is never
        // allowed to reach the scheduler.
        TimerOwner::new(config.timer_owner_id.clone(), "recovery/config", "recovery")
            .map_err(|_| RecoveryError::InvalidPhase { phase: None })?;

        Ok(Self {
            config,
            fence: RecoveryFence::new(),
            phase: None,
            request_id: None,
            captured_frontier: None,
            captured_state: None,
            bundle: None,
            timers: BTreeMap::new(),
            disposed: false,
        })
    }

    pub fn start(
        &mut self,
        request_id: String,
        captured: AuthorityFrontier,
        reason: String,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        if request_id.is_empty() || reason.is_empty() {
            return Err(RecoveryError::InvalidPhase { phase: self.phase });
        }
        if self.fence.state() == RecoveryFenceState::Terminal
            || self.phase == Some(RecoveryPhase::Terminalized)
        {
            return Err(self.terminalized_error());
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
        self.captured_state = Some(captured);
        self.set_phase(RecoveryPhase::FenceAcquired);
        let mut actions = vec![RecoveryAction::FenceChanged {
            view: self.fence.view(),
        }];
        self.set_phase(RecoveryPhase::FrontierCaptured);
        self.set_phase(RecoveryPhase::Requested);

        let allocation = self.allocate_timer(
            scheduler,
            RecoveryTimerKind::Request,
            self.config.request_timeout_ms,
            "authority-v2 recovery request deadline",
        );
        let (timer, schedule_action) = match allocation {
            Ok(value) => value,
            Err(error) => {
                return Ok(self.terminalize_with_actions(
                    format!("recovery request timer allocation failed: {error}"),
                    scheduler,
                ));
            }
        };
        self.timers.insert(timer.timer.timer_id, timer);
        actions.push(schedule_action);
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
        live: RecoveryLiveState,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::Requested)?;

        if let Some(reason) = self.captured_live_issue(&live) {
            return Ok(self.terminalize_with_actions(reason, scheduler));
        }

        let captured = self
            .captured_frontier
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        let validation = validate_recovery_bundle(
            &RecoveryValidationContext {
                expected_request_id: self.request_id.clone().unwrap_or_default(),
                live_context: live.context.clone(),
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
                return Ok(self.terminalize_with_actions(reason, scheduler));
            }
            RecoveryBundleValidation::Mismatch { issues } => {
                let reason = format!("recovery bundle mismatch: {issues:?}");
                return Ok(self.terminalize_with_actions(reason, scheduler));
            }
        };

        let request_timer_id = self
            .timer_id_for(RecoveryTimerKind::Request)
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        let mut actions = match self.cancel_timer_checked(request_timer_id, scheduler) {
            Ok(actions) => actions,
            Err(error) => {
                return Ok(self.terminalize_with_actions(
                    format!("recovery request timer cancellation failed: {error}"),
                    scheduler,
                ));
            }
        };
        self.bundle = Some(valid_bundle.clone());
        self.set_phase(RecoveryPhase::Validated);
        actions.push(RecoveryAction::ApplyMaterial {
            request_id: valid_bundle.request_id,
            material: valid_bundle.material,
        });
        Ok(actions)
    }

    pub fn material_result(
        &mut self,
        outcome: RecoveryMaterialOutcome,
        live: RecoveryLiveState,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::Validated)?;

        if let Some(reason) = self.captured_live_issue(&live) {
            return Ok(self.terminalize_with_actions(reason, scheduler));
        }

        let captured = self
            .captured_frontier
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        let bundle = self
            .bundle
            .clone()
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;

        match validate_recovery_bundle(
            &RecoveryValidationContext {
                expected_request_id: self.request_id.clone().unwrap_or_default(),
                live_context: live.context.clone(),
                captured_frontier: captured,
            },
            &bundle,
        ) {
            RecoveryBundleValidation::Valid { .. } => {}
            RecoveryBundleValidation::Stale { .. } => {
                return Ok(self.terminalize_with_actions(
                    "post-apply recovery bundle is stale".to_owned(),
                    scheduler,
                ));
            }
            RecoveryBundleValidation::Mismatch { issues } => {
                return Ok(self.terminalize_with_actions(
                    format!("post-apply recovery bundle mismatch: {issues:?}"),
                    scheduler,
                ));
            }
        }

        match outcome {
            RecoveryMaterialOutcome::Applied => {
                self.set_phase(RecoveryPhase::MaterialApplied);
                if revision_value(bundle.frontier) == 0 {
                    self.set_phase(RecoveryPhase::FrontierInstalled);
                    self.set_phase(RecoveryPhase::ControlInstalled);
                    return Ok(self.complete_success(None, &bundle, &live, scheduler));
                }
                let Some(entry) = bundle.required_tail.last().cloned() else {
                    return Ok(self.terminalize_with_actions(
                        "recovery material applied without a frontier entry".to_owned(),
                        scheduler,
                    ));
                };
                Ok(vec![RecoveryAction::StageRecoveredFrontier { entry }])
            }
            RecoveryMaterialOutcome::Deferred => Ok(self.terminalize_with_actions(
                "recovery material application deferred".to_owned(),
                scheduler,
            )),
            RecoveryMaterialOutcome::Rejected => Ok(self.terminalize_with_actions(
                "recovery material application rejected".to_owned(),
                scheduler,
            )),
        }
    }

    pub fn recovered_frontier_staged(
        &mut self,
        outcome: RecoveryFrontierStagingOutcome,
        live: RecoveryLiveState,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::MaterialApplied)?;

        let bundle = self
            .bundle
            .clone()
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        let revision = match outcome {
            RecoveryFrontierStagingOutcome::Staged { revision } => {
                if revision_value(bundle.frontier) == 0 || revision != bundle.frontier {
                    let issue = format!(
                        "staged recovery revision {} does not match bundle frontier {}",
                        revision, bundle.frontier
                    );
                    return Ok(self.terminalize_with_actions(
                        format!("recovery frontier staging mismatch: {issue}"),
                        scheduler,
                    ));
                }
                let exact_already_installed = self.captured_frontier == Some(bundle.frontier)
                    && self.captured_state == Some(live.frontier)
                    && self.installed_live_issue(&live, bundle.frontier).is_none();
                if !exact_already_installed
                    && let Some(reason) = self.staged_live_issue(&live, bundle.frontier)
                {
                    return Ok(self.terminalize_with_actions(reason, scheduler));
                }
                revision
            }
            RecoveryFrontierStagingOutcome::Rejected { reason } => {
                if let Some(live_issue) = self.captured_live_issue(&live) {
                    return Ok(self.terminalize_with_actions(live_issue, scheduler));
                }
                return Ok(self.terminalize_with_actions(
                    format!("recovery frontier staging rejected: {reason}"),
                    scheduler,
                ));
            }
        };

        let Some(control) = bundle.next_control.clone() else {
            return Ok(self.terminalize_with_actions(
                "positive recovery frontier has no successor control".to_owned(),
                scheduler,
            ));
        };
        if !self.fence.allow_control_projection() {
            return Ok(self.terminalize_with_actions(
                "recovery fence refused the exact control-projection window".to_owned(),
                scheduler,
            ));
        }
        let allocation = self.allocate_timer(
            scheduler,
            RecoveryTimerKind::Control,
            self.config.control_timeout_ms,
            "await exact Authority V2 recovery control proof",
        );
        let (timer, schedule_action) = match allocation {
            Ok(value) => value,
            Err(error) => {
                return Ok(self.terminalize_with_actions(
                    format!("recovery control timer allocation failed: {error}"),
                    scheduler,
                ));
            }
        };

        self.timers.insert(timer.timer.timer_id, timer);
        self.set_phase(RecoveryPhase::FrontierInstalled);
        let mut actions = vec![RecoveryAction::FenceChanged {
            view: self.fence.view(),
        }];
        actions.push(schedule_action);
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
        live: RecoveryLiveState,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        self.ensure_phase(RecoveryPhase::FrontierInstalled)?;

        let bundle = self
            .bundle
            .clone()
            .ok_or(RecoveryError::InvalidPhase { phase: self.phase })?;
        let Some(control) = bundle.next_control.as_ref() else {
            return Ok(self.terminalize_with_actions(
                "control result received for an empty recovery frontier".to_owned(),
                scheduler,
            ));
        };
        let live_issue = match &outcome {
            ControlProjectionOutcome::Installed { .. }
            | ControlProjectionOutcome::AlreadyInstalled { .. } => {
                self.installed_live_issue(&live, bundle.frontier)
            }
            ControlProjectionOutcome::Deferred | ControlProjectionOutcome::Rejected { .. } => {
                self.staged_live_issue(&live, bundle.frontier)
            }
        };
        if let Some(reason) = live_issue {
            return Ok(self.terminalize_with_actions(reason, scheduler));
        }
        let expected_control_id = crate::control_id_of(control);

        match outcome {
            ControlProjectionOutcome::Installed { control_id }
            | ControlProjectionOutcome::AlreadyInstalled { control_id } => {
                if control_id != expected_control_id {
                    return Ok(self.terminalize_with_actions(
                        format!(
                            "control projection proved {control_id}, expected {expected_control_id}"
                        ),
                        scheduler,
                    ));
                }
                let Some(control_timer_id) = self.timer_id_for(RecoveryTimerKind::Control) else {
                    return Ok(self.terminalize_with_actions(
                        "recovery control timer registration is missing before control installation"
                            .to_owned(),
                        scheduler,
                    ));
                };
                let pacing_timer_ids = self.timer_ids_for(RecoveryTimerKind::Pacing);
                if !self.timer_registration_matches_id(control_timer_id, scheduler) {
                    return Ok(self.terminalize_with_actions(
                        "recovery control timer registration disappeared before control installation"
                            .to_owned(),
                        scheduler,
                    ));
                }
                if pacing_timer_ids
                    .iter()
                    .any(|timer_id| !self.timer_registration_matches_id(*timer_id, scheduler))
                {
                    return Ok(self.terminalize_with_actions(
                        "recovery pacing timer registration disappeared before control installation"
                            .to_owned(),
                        scheduler,
                    ));
                }

                // All registrations are validated above before either one is
                // cancelled.  The remaining operations are infallible against
                // this synchronous scheduler state, so a failure cannot expose
                // a successful-path cancellation before terminal actions.
                let mut actions = self.cancel_timer(control_timer_id, scheduler);
                for timer_id in pacing_timer_ids {
                    actions.extend(self.cancel_timer(timer_id, scheduler));
                }
                self.set_phase(RecoveryPhase::ControlInstalled);
                actions.extend(self.complete_success(Some(control_id), &bundle, &live, scheduler));
                Ok(actions)
            }
            ControlProjectionOutcome::Deferred => {
                if !self.timer_registration_matches(RecoveryTimerKind::Control, scheduler) {
                    return Ok(self.terminalize_with_actions(
                        "recovery control timer registration disappeared before deferred retry"
                            .to_owned(),
                        scheduler,
                    ));
                }
                if self.timer_id_for(RecoveryTimerKind::Pacing).is_some() {
                    if !self.timer_registration_matches(RecoveryTimerKind::Pacing, scheduler) {
                        return Ok(self.terminalize_with_actions(
                            "recovery pacing timer registration disappeared before deferred retry"
                                .to_owned(),
                            scheduler,
                        ));
                    }
                    return Ok(Vec::new());
                }
                let allocation = self.allocate_timer(
                    scheduler,
                    RecoveryTimerKind::Pacing,
                    pacing_delay(self.config.pacing_ms),
                    "await exact Authority V2 recovery control proof",
                );
                let (timer, schedule_action) = match allocation {
                    Ok(value) => value,
                    Err(error) => {
                        return Ok(self.terminalize_with_actions(
                            format!("recovery pacing timer allocation failed: {error}"),
                            scheduler,
                        ));
                    }
                };
                self.timers.insert(timer.timer.timer_id, timer);
                Ok(vec![schedule_action])
            }
            ControlProjectionOutcome::Rejected { reason } => Ok(self.terminalize_with_actions(
                format!("control projection rejected: {reason}"),
                scheduler,
            )),
        }
    }

    pub fn timer_fired(
        &mut self,
        fired: ScheduledTimer,
        live: RecoveryLiveState,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        self.ensure_not_disposed()?;
        if self.fence.state() == RecoveryFenceState::Terminal
            || self.phase == Some(RecoveryPhase::Terminalized)
        {
            return Err(self.terminalized_error());
        }

        let Some(owned) = self.timers.get(&fired.timer_id).cloned() else {
            return Err(RecoveryError::InvalidPhase { phase: self.phase });
        };
        // GameKernel removes the registration exactly once before routing the
        // callback.  A still-live registration is therefore a caller-order
        // error; the complete value comparison below validates endpoint, ID,
        // owner/address/reason, delay, and time class without requiring the
        // removed timer to remain in the scheduler.
        if scheduler.timer(fired.timer_id).is_some() || owned.timer != fired {
            return Err(RecoveryError::InvalidPhase { phase: self.phase });
        }

        match owned.kind {
            RecoveryTimerKind::Request => {
                if self.phase != Some(RecoveryPhase::Requested) {
                    return Err(RecoveryError::InvalidPhase { phase: self.phase });
                }
                if let Some(reason) = self.captured_live_issue(&live) {
                    return Ok(self.terminalize_with_actions(reason, scheduler));
                }
                self.timers.remove(&fired.timer_id);
                Ok(self.terminalize_with_actions(
                    "recovery request timeout exceeded".to_owned(),
                    scheduler,
                ))
            }
            RecoveryTimerKind::Control => {
                if self.phase != Some(RecoveryPhase::FrontierInstalled) {
                    return Err(RecoveryError::InvalidPhase { phase: self.phase });
                }
                let Some(frontier) = self.bundle.as_ref().map(|bundle| bundle.frontier) else {
                    return Ok(self.terminalize_with_actions(
                        "recovery control timer fired without a bundle".to_owned(),
                        scheduler,
                    ));
                };
                if let Some(reason) = self.staged_live_issue(&live, frontier) {
                    return Ok(self.terminalize_with_actions(reason, scheduler));
                }
                self.timers.remove(&fired.timer_id);
                Ok(self.terminalize_with_actions(
                    "recovery control-install timeout exceeded".to_owned(),
                    scheduler,
                ))
            }
            RecoveryTimerKind::Pacing => {
                if self.phase != Some(RecoveryPhase::FrontierInstalled) {
                    return Err(RecoveryError::InvalidPhase { phase: self.phase });
                }
                let Some((frontier, control)) = self.bundle.as_ref().and_then(|bundle| {
                    bundle
                        .next_control
                        .clone()
                        .map(|control| (bundle.frontier, control))
                }) else {
                    return Ok(self.terminalize_with_actions(
                        "recovery pacing fired without a successor control".to_owned(),
                        scheduler,
                    ));
                };
                if let Some(reason) = self.staged_live_issue(&live, frontier) {
                    return Ok(self.terminalize_with_actions(reason, scheduler));
                }
                if !self.timer_registration_matches(RecoveryTimerKind::Control, scheduler) {
                    return Ok(self.terminalize_with_actions(
                        "recovery control timer registration disappeared before pacing retry"
                            .to_owned(),
                        scheduler,
                    ));
                }
                self.timers.remove(&fired.timer_id);
                Ok(vec![RecoveryAction::ProjectControl {
                    revision: frontier,
                    expected_control_id: crate::control_id_of(&control),
                    control,
                }])
            }
        }
    }

    pub fn abort(
        &mut self,
        reason: String,
        scheduler: &mut KernelScheduler,
    ) -> Vec<RecoveryAction> {
        if self.disposed {
            return Vec::new();
        }
        if self.phase == Some(RecoveryPhase::Released) {
            return self.cancel_all_timers(scheduler);
        }
        if self.phase == Some(RecoveryPhase::Terminalized)
            || self.fence.state() == RecoveryFenceState::Terminal
        {
            return self.cancel_all_timers(scheduler);
        }
        self.terminalize_with_actions(
            if reason.is_empty() {
                "recovery aborted".to_owned()
            } else {
                reason
            },
            scheduler,
        )
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
            timer_ids: self.timers.keys().copied().collect(),
            disposed: self.disposed,
        }
    }

    pub fn dispose(
        &mut self,
        reason: &str,
        scheduler: &mut KernelScheduler,
    ) -> Vec<RecoveryAction> {
        if self.disposed {
            return Vec::new();
        }
        let actions = if self.phase == Some(RecoveryPhase::Released)
            || self.phase == Some(RecoveryPhase::Terminalized)
            || self.fence.state() == RecoveryFenceState::Terminal
        {
            self.cancel_all_timers(scheduler)
        } else {
            self.terminalize_with_actions(
                if reason.is_empty() {
                    "recovery transaction disposed".to_owned()
                } else {
                    reason.to_owned()
                },
                scheduler,
            )
        };
        self.bundle = None;
        self.timers.clear();
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
            return Err(self.terminalized_error());
        }
        if self.phase != Some(expected) {
            return Err(RecoveryError::InvalidPhase { phase: self.phase });
        }
        Ok(())
    }

    fn terminalized_error(&self) -> RecoveryError {
        RecoveryError::Terminalized {
            reason: match self.fence.terminal_reason() {
                Some(reason) => reason.to_owned(),
                None => "recovery transaction terminalized".to_owned(),
            },
        }
    }

    fn set_phase(&mut self, phase: RecoveryPhase) {
        self.phase = Some(phase);
    }

    fn captured_live_issue(&self, live: &RecoveryLiveState) -> Option<String> {
        if live.context != self.config.local_context {
            return Some("recovery live context changed under the fence".to_owned());
        }
        let Some(captured) = self.captured_state else {
            return Some("recovery captured frontier is unavailable".to_owned());
        };
        if live.frontier != captured {
            return Some(format!(
                "recovery live frontier changed under the fence (captured {captured:?}, live {:?})",
                live.frontier
            ));
        }
        None
    }

    fn staged_live_issue(&self, live: &RecoveryLiveState, frontier: Revision) -> Option<String> {
        if live.context != self.config.local_context {
            return Some("recovery live context changed under the fence".to_owned());
        }
        let Some(previous) = revision_value(frontier).checked_sub(1) else {
            return Some("positive staged recovery frontier cannot be decremented".to_owned());
        };
        let Some(control) = revision_from_value(previous) else {
            return Some("staged recovery frontier exceeds the safe integer range".to_owned());
        };
        let expected = AuthorityFrontier {
            received: frontier,
            material: frontier,
            control,
        };
        if live.frontier != expected {
            return Some(format!(
                "recovery staged frontier changed under the fence (expected {expected:?}, live {:?})",
                live.frontier
            ));
        }
        None
    }

    fn installed_live_issue(&self, live: &RecoveryLiveState, frontier: Revision) -> Option<String> {
        if live.context != self.config.local_context {
            return Some("recovery live context changed under the fence".to_owned());
        }
        let expected = AuthorityFrontier {
            received: frontier,
            material: frontier,
            control: frontier,
        };
        if live.frontier != expected {
            return Some(format!(
                "recovery installed frontier changed under the fence (expected {expected:?}, live {:?})",
                live.frontier
            ));
        }
        None
    }

    fn allocate_timer(
        &self,
        scheduler: &mut KernelScheduler,
        kind: RecoveryTimerKind,
        delay_ms: SafeU53,
        reason: &str,
    ) -> Result<(RecoveryTimer, RecoveryAction), RecoveryError> {
        let request_id = self.request_id.as_deref().unwrap_or("unstarted");
        let address_prefix = if kind == RecoveryTimerKind::Request {
            "recovery"
        } else {
            "recovery-control"
        };
        let owner = TimerOwner::new(
            self.config.timer_owner_id.clone(),
            format!(
                "{address_prefix}/{}/{}/{}",
                self.config.local_context.session_id, self.config.local_context.run_id, request_id
            ),
            reason.to_owned(),
        )
        .map_err(|_| RecoveryError::InvalidPhase { phase: self.phase })?;
        let command = scheduler.schedule(
            self.config.local_context.sender_seat_id,
            owner,
            delay_ms,
            TimeClass::Recovery,
        )?;
        let timer = match &command {
            SchedulerCommand::Schedule { timer } => timer.clone(),
            _ => {
                return Err(RecoveryError::InvalidPhase { phase: self.phase });
            }
        };
        Ok((
            RecoveryTimer { timer, kind },
            RecoveryAction::Scheduler { command },
        ))
    }

    fn timer_id_for(&self, kind: RecoveryTimerKind) -> Option<TimerId> {
        self.timers
            .values()
            .find(|timer| timer.kind == kind)
            .map(|timer| timer.timer.timer_id)
    }

    fn timer_ids_for(&self, kind: RecoveryTimerKind) -> Vec<TimerId> {
        self.timers
            .values()
            .filter(|timer| timer.kind == kind)
            .map(|timer| timer.timer.timer_id)
            .collect()
    }

    fn timer_registration_matches(
        &self,
        kind: RecoveryTimerKind,
        scheduler: &KernelScheduler,
    ) -> bool {
        let Some(timer_id) = self.timer_id_for(kind) else {
            return false;
        };
        self.timer_registration_matches_id(timer_id, scheduler)
    }

    fn timer_registration_matches_id(
        &self,
        timer_id: TimerId,
        scheduler: &KernelScheduler,
    ) -> bool {
        if scheduler.is_disposed() {
            return false;
        }
        self.timers
            .get(&timer_id)
            .is_some_and(|owned| scheduler.timer(timer_id) == Some(&owned.timer))
    }

    fn cancel_timer(
        &mut self,
        timer_id: TimerId,
        scheduler: &mut KernelScheduler,
    ) -> Vec<RecoveryAction> {
        self.timers.remove(&timer_id);
        scheduler
            .cancel(timer_id)
            .map(|command| vec![RecoveryAction::Scheduler { command }])
            .unwrap_or_default()
    }

    fn cancel_timer_checked(
        &mut self,
        timer_id: TimerId,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        let Some(owned) = self.timers.get(&timer_id) else {
            return Err(RecoveryError::Scheduler(SchedulerError::UnknownTimer {
                timer_id,
            }));
        };
        if scheduler.timer(timer_id) != Some(&owned.timer) {
            return Err(RecoveryError::Scheduler(SchedulerError::UnknownTimer {
                timer_id,
            }));
        }
        let Some(command) = scheduler.cancel(timer_id) else {
            return Err(RecoveryError::Scheduler(SchedulerError::UnknownTimer {
                timer_id,
            }));
        };
        self.timers.remove(&timer_id);
        Ok(vec![RecoveryAction::Scheduler { command }])
    }

    fn cancel_all_timers(&mut self, scheduler: &mut KernelScheduler) -> Vec<RecoveryAction> {
        let timer_ids = self.timers.keys().copied().collect::<Vec<_>>();
        let mut actions = Vec::new();
        for timer_id in timer_ids {
            actions.extend(self.cancel_timer(timer_id, scheduler));
        }
        actions
    }

    fn complete_success(
        &mut self,
        control_id: Option<String>,
        bundle: &RecoveryBundle,
        live: &RecoveryLiveState,
        scheduler: &mut KernelScheduler,
    ) -> Vec<RecoveryAction> {
        if let Some(reason) = self.installed_live_issue(live, bundle.frontier) {
            return self.terminalize_with_actions(
                format!("recovery completion live-state validation failed: {reason}"),
                scheduler,
            );
        }
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

    fn terminalize_with_actions(
        &mut self,
        reason: String,
        scheduler: &mut KernelScheduler,
    ) -> Vec<RecoveryAction> {
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
        actions.extend(self.cancel_all_timers(scheduler));
        self.set_phase(RecoveryPhase::Terminalized);
        actions.push(RecoveryAction::Terminalize { reason });
        actions
    }
}

impl crate::snapshot::RecoveryTransactionSnapshotBridge for RecoveryTransaction {
    fn snapshot_v2(
        &self,
    ) -> Result<crate::snapshot::RecoveryRuntimeSnapshotV2, crate::snapshot::SnapshotError> {
        let bundle = self
            .bundle
            .as_ref()
            .map(|bundle| opaque_recovery_bundle_snapshot(bundle, "recovery.bundle"))
            .transpose()?;
        let timers = self
            .timers
            .iter()
            .map(|(timer_id, timer)| {
                if *timer_id != timer.timer.timer_id {
                    return Err(recovery_snapshot_invalid(
                        "recovery.timers",
                        "recovery timer map key differs from registration identity",
                    ));
                }
                Ok(crate::snapshot::RecoveryTimerSnapshotV2 {
                    timer: timer.timer.clone(),
                    kind: match timer.kind {
                        RecoveryTimerKind::Request => crate::snapshot::RecoveryTimerKindV2::Request,
                        RecoveryTimerKind::Control => crate::snapshot::RecoveryTimerKindV2::Control,
                        RecoveryTimerKind::Pacing => crate::snapshot::RecoveryTimerKindV2::Pacing,
                    },
                })
            })
            .collect::<Result<Vec<_>, crate::snapshot::SnapshotError>>()?;
        let snapshot = crate::snapshot::RecoveryRuntimeSnapshotV2 {
            config: self.config.clone(),
            fence: crate::snapshot::RecoveryFenceSnapshotV2 {
                state: self.fence.state,
                control_projection_allowed: self.fence.control_projection_allowed,
                terminal_reason: self.fence.terminal_reason.clone(),
            },
            phase: self.phase,
            request_id: self.request_id.clone(),
            captured_frontier: self.captured_frontier,
            captured_state: self.captured_state,
            bundle,
            timers,
            disposed: self.disposed,
        };
        snapshot.validate()?;
        validate_recovery_snapshot_state(&snapshot, self.bundle.as_ref())?;
        Ok(snapshot)
    }

    fn from_snapshot_v2(
        snapshot: crate::snapshot::RecoveryRuntimeSnapshotV2,
        scheduler: &mut KernelScheduler,
    ) -> Result<Self, crate::snapshot::SnapshotError> {
        snapshot.validate()?;
        validate_recovery_config(&snapshot.config)?;

        let bundle = snapshot
            .bundle
            .as_ref()
            .map(|bundle| {
                decode_recovery_bundle(
                    &bundle.canonical_bundle_bytes,
                    "recovery.bundle.canonical_bundle_bytes",
                )
            })
            .transpose()?;
        if let Some(bundle) = &bundle {
            let Some(request_id) = snapshot.request_id.as_deref() else {
                return Err(recovery_snapshot_invalid(
                    "recovery.bundle",
                    "a retained recovery bundle requires a request identity",
                ));
            };
            let Some(captured_frontier) = snapshot.captured_frontier else {
                return Err(recovery_snapshot_invalid(
                    "recovery.bundle",
                    "a retained recovery bundle requires a captured frontier",
                ));
            };
            match validate_recovery_bundle(
                &RecoveryValidationContext {
                    expected_request_id: request_id.to_owned(),
                    live_context: snapshot.config.local_context.clone(),
                    captured_frontier,
                },
                bundle,
            ) {
                RecoveryBundleValidation::Valid { .. } => {}
                RecoveryBundleValidation::Stale { .. }
                | RecoveryBundleValidation::Mismatch { .. } => {
                    return Err(recovery_snapshot_invalid(
                        "recovery.bundle",
                        "decoded recovery bundle contradicts the retained transaction state",
                    ));
                }
            }
        }

        let mut timers = BTreeMap::new();
        for retained in &snapshot.timers {
            let kind = match retained.kind {
                crate::snapshot::RecoveryTimerKindV2::Request => RecoveryTimerKind::Request,
                crate::snapshot::RecoveryTimerKindV2::Control => RecoveryTimerKind::Control,
                crate::snapshot::RecoveryTimerKindV2::Pacing => RecoveryTimerKind::Pacing,
            };
            let (owner, delay_ms) = expected_recovery_timer_registration(
                &snapshot.config,
                snapshot.request_id.as_deref(),
                kind,
            )?;
            if retained.timer.endpoint != snapshot.config.local_context.sender_seat_id
                || retained.timer.owner != owner
                || retained.timer.delay_ms != delay_ms
                || retained.timer.time_class != TimeClass::Recovery
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.timers",
                    "recovery timer metadata does not match its retained kind and configuration",
                ));
            }
            if scheduler.is_disposed()
                || scheduler.timer(retained.timer.timer_id) != Some(&retained.timer)
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.timers",
                    "retained recovery timer is not the exact registration in the restored scheduler",
                ));
            }
            if timers
                .insert(
                    retained.timer.timer_id,
                    RecoveryTimer {
                        timer: retained.timer.clone(),
                        kind,
                    },
                )
                .is_some()
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.timers",
                    "duplicate recovery timer identity",
                ));
            }
        }

        validate_recovery_snapshot_state(&snapshot, bundle.as_ref())?;
        if snapshot.disposed && !timers.is_empty() {
            return Err(recovery_snapshot_invalid(
                "recovery",
                "disposed recovery cannot retain timers",
            ));
        }

        cross_check_recovery_timers(&snapshot.config, &timers, scheduler)?;

        Ok(Self {
            config: snapshot.config,
            fence: RecoveryFence {
                state: snapshot.fence.state,
                control_projection_allowed: snapshot.fence.control_projection_allowed,
                terminal_reason: snapshot.fence.terminal_reason,
            },
            phase: snapshot.phase,
            request_id: snapshot.request_id,
            captured_frontier: snapshot.captured_frontier,
            captured_state: snapshot.captured_state,
            bundle,
            timers,
            disposed: snapshot.disposed,
        })
    }
}

fn validate_recovery_config(
    config: &RecoveryTransactionConfig,
) -> Result<(), crate::snapshot::SnapshotError> {
    if config.request_timeout_ms == SafeU53::ZERO
        || config.control_timeout_ms == SafeU53::ZERO
        || config.pacing_ms == SafeU53::ZERO
        || config.local_context.seat_map_id.is_empty()
        || TimerOwner::new(config.timer_owner_id.clone(), "recovery/config", "recovery").is_err()
    {
        return Err(recovery_snapshot_invalid(
            "recovery.config",
            "recovery configuration is invalid",
        ));
    }
    Ok(())
}

fn cross_check_recovery_timers(
    config: &RecoveryTransactionConfig,
    timers: &BTreeMap<TimerId, RecoveryTimer>,
    scheduler: &KernelScheduler,
) -> Result<(), crate::snapshot::SnapshotError> {
    let mut expected_timer_ids = BTreeMap::<TimerOwner, BTreeSet<TimerId>>::new();
    for (timer_id, timer) in timers {
        expected_timer_ids
            .entry(timer.timer.owner.clone())
            .or_default()
            .insert(*timer_id);
    }

    // Recovery owns one configured scheduler owner namespace.  Any live timer
    // carrying that owner must be represented by an exact retained timer;
    // unrelated scheduler owners remain available to their own subsystems.
    for timer in scheduler.live_timers() {
        if timer.owner.owner_id != config.timer_owner_id {
            continue;
        }
        let Some(expected_ids) = expected_timer_ids.get(&timer.owner) else {
            return Err(recovery_snapshot_invalid(
                "scheduler.timers",
                format!("orphaned recovery timer {}", timer.timer_id),
            ));
        };
        if !expected_ids.contains(&timer.timer_id) {
            return Err(recovery_snapshot_invalid(
                "scheduler.timers",
                "recovery timer owner is bound to the wrong timer ID",
            ));
        }
    }
    Ok(())
}

fn validate_recovery_snapshot_state(
    snapshot: &crate::snapshot::RecoveryRuntimeSnapshotV2,
    bundle: Option<&RecoveryBundle>,
) -> Result<(), crate::snapshot::SnapshotError> {
    let phase = snapshot.phase;
    if snapshot.captured_frontier.is_some() != snapshot.captured_state.is_some() {
        return Err(recovery_snapshot_invalid(
            "recovery.captured_frontier",
            "captured frontier and captured state must be present together",
        ));
    }
    if let (Some(captured_frontier), Some(captured_state)) =
        (snapshot.captured_frontier, snapshot.captured_state)
        && (captured_frontier != captured_state.control
            || captured_state.control > captured_state.material
            || captured_state.material > captured_state.received)
    {
        return Err(recovery_snapshot_invalid(
            "recovery.captured_state",
            "captured frontier does not contain an ordered control frontier",
        ));
    }

    match phase {
        None => {
            if snapshot.disposed
                || snapshot.request_id.is_some()
                || snapshot.captured_frontier.is_some()
                || snapshot.captured_state.is_some()
                || bundle.is_some()
                || !snapshot.timers.is_empty()
                || snapshot.fence.state != RecoveryFenceState::Open
                || snapshot.fence.control_projection_allowed
                || snapshot.fence.terminal_reason.is_some()
            {
                return Err(recovery_snapshot_invalid(
                    "recovery",
                    "an unstarted recovery transaction must retain only an open empty owner",
                ));
            }
        }
        Some(RecoveryPhase::Terminalized) => {
            if snapshot.fence.state != RecoveryFenceState::Terminal
                || snapshot.fence.control_projection_allowed
                || snapshot
                    .fence
                    .terminal_reason
                    .as_deref()
                    .is_none_or(str::is_empty)
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.fence",
                    "a terminalized transaction requires an exact terminal fence",
                ));
            }
            if snapshot.request_id.is_some() != snapshot.captured_frontier.is_some() {
                return Err(recovery_snapshot_invalid(
                    "recovery",
                    "terminalized request and captured state must be complete or absent",
                ));
            }
            if snapshot.request_id.is_none() && bundle.is_some() {
                return Err(recovery_snapshot_invalid(
                    "recovery.bundle",
                    "an unrequested terminalized recovery cannot retain a bundle",
                ));
            }
            if !snapshot.timers.is_empty() {
                return Err(recovery_snapshot_invalid(
                    "recovery.timers",
                    "a terminalized recovery cannot retain timers",
                ));
            }
        }
        Some(RecoveryPhase::Acked | RecoveryPhase::Released) => {
            if snapshot.disposed && phase == Some(RecoveryPhase::Acked) {
                return Err(recovery_snapshot_invalid(
                    "recovery.phase",
                    "a disposed recovery cannot retain the transient acknowledged phase",
                ));
            }
            if snapshot.fence.state != RecoveryFenceState::Open
                || snapshot.fence.control_projection_allowed
                || snapshot.fence.terminal_reason.is_some()
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.fence",
                    "an acknowledged or released recovery requires an open fence",
                ));
            }
            if snapshot.request_id.is_none() || snapshot.captured_frontier.is_none() {
                return Err(recovery_snapshot_invalid(
                    "recovery",
                    "an acknowledged or released recovery requires request and captured state",
                ));
            }
            if !snapshot.disposed && bundle.is_none() {
                return Err(recovery_snapshot_invalid(
                    "recovery.bundle",
                    "a live released recovery must retain its canonical bundle",
                ));
            }
            if !snapshot.timers.is_empty() {
                return Err(recovery_snapshot_invalid(
                    "recovery.timers",
                    "an acknowledged or released recovery cannot retain timers",
                ));
            }
        }
        Some(phase) => {
            if snapshot.disposed {
                return Err(recovery_snapshot_invalid(
                    "recovery.phase",
                    "a disposed recovery must be released or terminalized",
                ));
            }
            if snapshot.fence.state != RecoveryFenceState::Held
                || snapshot.fence.terminal_reason.is_some()
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.fence",
                    "an active recovery phase requires a held fence",
                ));
            }
            if snapshot.request_id.is_none() || snapshot.captured_frontier.is_none() {
                return Err(recovery_snapshot_invalid(
                    "recovery",
                    "an active recovery phase requires request and captured state",
                ));
            }
            let bundle_required = matches!(
                phase,
                RecoveryPhase::Validated
                    | RecoveryPhase::MaterialApplied
                    | RecoveryPhase::FrontierInstalled
                    | RecoveryPhase::ControlInstalled
            );
            if bundle_required != bundle.is_some() {
                return Err(recovery_snapshot_invalid(
                    "recovery.bundle",
                    "bundle presence does not match the active recovery phase",
                ));
            }
            if matches!(
                phase,
                RecoveryPhase::FenceAcquired
                    | RecoveryPhase::FrontierCaptured
                    | RecoveryPhase::Requested
            ) && bundle.is_some()
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.bundle",
                    "pre-validation recovery phases cannot retain a bundle",
                ));
            }
            if phase == RecoveryPhase::FrontierInstalled
                && !snapshot.fence.control_projection_allowed
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.fence.control_projection_allowed",
                    "frontier-installed recovery must allow its exact control projection",
                ));
            }
            if matches!(
                phase,
                RecoveryPhase::FenceAcquired
                    | RecoveryPhase::FrontierCaptured
                    | RecoveryPhase::Requested
                    | RecoveryPhase::Validated
                    | RecoveryPhase::MaterialApplied
            ) && snapshot.fence.control_projection_allowed
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.fence.control_projection_allowed",
                    "control projection is not allowed before frontier installation",
                ));
            }
            let mut request_timers = 0;
            let mut control_timers = 0;
            let mut pacing_timers = 0;
            for timer in &snapshot.timers {
                match timer.kind {
                    crate::snapshot::RecoveryTimerKindV2::Request => request_timers += 1,
                    crate::snapshot::RecoveryTimerKindV2::Control => control_timers += 1,
                    crate::snapshot::RecoveryTimerKindV2::Pacing => pacing_timers += 1,
                }
            }
            let timer_shape = match phase {
                RecoveryPhase::Requested => {
                    request_timers == 1 && control_timers == 0 && pacing_timers == 0
                }
                RecoveryPhase::FrontierInstalled => {
                    request_timers == 0 && control_timers == 1 && pacing_timers <= 1
                }
                _ => request_timers == 0 && control_timers == 0 && pacing_timers == 0,
            };
            if !timer_shape {
                return Err(recovery_snapshot_invalid(
                    "recovery.timers",
                    "retained recovery timer kinds do not match the phase",
                ));
            }
            if phase == RecoveryPhase::ControlInstalled
                && bundle.is_some_and(|bundle| bundle.frontier != Revision::ZERO)
            {
                return Err(recovery_snapshot_invalid(
                    "recovery.phase",
                    "control-installed is only a valid quiescent phase for an empty frontier",
                ));
            }
        }
    }

    if let Some(request_id) = &snapshot.request_id
        && request_id.is_empty()
    {
        return Err(recovery_snapshot_invalid(
            "recovery.request_id",
            "request identity must not be empty",
        ));
    }
    if let (Some(snapshot_bundle), Some(bundle)) = (&snapshot.bundle, bundle)
        && (snapshot_bundle.correlation_id != bundle.request_id
            || snapshot.request_id.as_deref() != Some(bundle.request_id.as_str()))
    {
        return Err(recovery_snapshot_invalid(
            "recovery.bundle",
            "canonical bundle identity differs from the active request",
        ));
    }
    if snapshot.disposed && (!snapshot.timers.is_empty() || bundle.is_some()) {
        return Err(recovery_snapshot_invalid(
            "recovery",
            "disposed recovery cannot retain timers or a bundle",
        ));
    }
    Ok(())
}

fn expected_recovery_timer_registration(
    config: &RecoveryTransactionConfig,
    request_id: Option<&str>,
    kind: RecoveryTimerKind,
) -> Result<(TimerOwner, SafeU53), crate::snapshot::SnapshotError> {
    let Some(request_id) = request_id else {
        return Err(recovery_snapshot_invalid(
            "recovery.timers",
            "a retained recovery timer requires a request identity",
        ));
    };
    let (address_prefix, delay_ms, reason) = match kind {
        RecoveryTimerKind::Request => (
            "recovery",
            config.request_timeout_ms,
            "authority-v2 recovery request deadline",
        ),
        RecoveryTimerKind::Control => (
            "recovery-control",
            config.control_timeout_ms,
            "await exact Authority V2 recovery control proof",
        ),
        RecoveryTimerKind::Pacing => (
            "recovery-control",
            pacing_delay(config.pacing_ms),
            "await exact Authority V2 recovery control proof",
        ),
    };
    let owner = TimerOwner::new(
        config.timer_owner_id.clone(),
        format!(
            "{address_prefix}/{}/{}/{}",
            config.local_context.session_id, config.local_context.run_id, request_id
        ),
        reason,
    )
    .map_err(|error| recovery_snapshot_invalid("recovery.timers.owner", error.to_string()))?;
    Ok((owner, delay_ms))
}

fn opaque_recovery_bundle_snapshot(
    bundle: &RecoveryBundle,
    path: &str,
) -> Result<crate::snapshot::OpaqueRecoveryBundleSnapshotV2, crate::snapshot::SnapshotError> {
    let canonical_bundle_bytes = er_canonical::canonical_bytes(bundle)
        .map_err(|error| recovery_snapshot_canonical(path, error.to_string()))?;
    Ok(crate::snapshot::OpaqueRecoveryBundleSnapshotV2 {
        correlation_id: bundle.request_id.clone(),
        canonical_bundle_bytes: er_types::battle_ids::CanonicalHexBytes::from_bytes(
            &canonical_bundle_bytes,
        ),
    })
}

fn decode_recovery_bundle(
    bytes: &er_types::battle_ids::CanonicalHexBytes,
    path: &str,
) -> Result<RecoveryBundle, crate::snapshot::SnapshotError> {
    let raw = decode_recovery_hex(bytes, path)?;
    let bundle = serde_json::from_slice::<RecoveryBundle>(&raw)
        .map_err(|error| recovery_snapshot_canonical(path, error.to_string()))?;
    let canonical = er_canonical::canonical_bytes(&bundle)
        .map_err(|error| recovery_snapshot_canonical(path, error.to_string()))?;
    if canonical != raw {
        return Err(recovery_snapshot_canonical(
            path,
            "payload is not the exact canonical JSON encoding",
        ));
    }
    Ok(bundle)
}

fn decode_recovery_hex(
    bytes: &er_types::battle_ids::CanonicalHexBytes,
    path: &str,
) -> Result<Vec<u8>, crate::snapshot::SnapshotError> {
    let raw = bytes.as_str().as_bytes();
    if !raw.len().is_multiple_of(2) {
        return Err(recovery_snapshot_canonical(
            path,
            "canonical payload has odd hex length",
        ));
    }
    let mut decoded = Vec::with_capacity(raw.len() / 2);
    for pair in raw.chunks_exact(2) {
        let Some(high) = recovery_hex_digit(pair[0]) else {
            return Err(recovery_snapshot_canonical(path, "invalid hex"));
        };
        let Some(low) = recovery_hex_digit(pair[1]) else {
            return Err(recovery_snapshot_canonical(path, "invalid hex"));
        };
        decoded.push((high << 4) | low);
    }
    if decoded.is_empty() {
        return Err(recovery_snapshot_canonical(
            path,
            "canonical payload must not be empty",
        ));
    }
    Ok(decoded)
}

fn recovery_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn recovery_snapshot_invalid(
    path: impl Into<String>,
    reason: impl Into<String>,
) -> crate::snapshot::SnapshotError {
    crate::snapshot::SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn recovery_snapshot_canonical(
    path: impl Into<String>,
    reason: impl Into<String>,
) -> crate::snapshot::SnapshotError {
    crate::snapshot::SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

#[cfg(test)]
#[allow(
    clippy::panic,
    reason = "Explicit panic branches assert impossible fixture/action shapes in exhaustion evidence"
)]
mod exhaustion_tests {
    use super::*;
    use crate::{SchedulerError, TimerSpec};
    use er_types::{
        CommandControlTarget, CommandFrontierControl, ConnectionGeneration, MembershipRevision,
        OperationId, RunId, SeatId, SessionId,
    };

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("test value must fit SafeU53")
    }

    fn authority_context() -> FrameContext {
        FrameContext {
            session_id: SessionId::new("session-1").expect("session id"),
            run_id: RunId::new("run-1").expect("run id"),
            session_epoch: safe(3),
            seat_map_id: "seat-map-1".to_owned(),
            membership_revision: MembershipRevision::new(safe(2)),
            sender_seat_id: SeatId::new(safe(0)),
            authority_seat_id: SeatId::new(safe(0)),
            connection_generation: ConnectionGeneration::new(safe(1)),
        }
    }

    fn replica_context() -> FrameContext {
        FrameContext {
            sender_seat_id: SeatId::new(safe(1)),
            connection_generation: ConnectionGeneration::new(safe(2)),
            ..authority_context()
        }
    }

    fn control() -> NextControl {
        NextControl::CommandFrontier(CommandFrontierControl {
            epoch: safe(3),
            wave: safe(4),
            turn: safe(1),
            commands: vec![CommandControlTarget {
                owner_seat_id: SeatId::new(safe(0)),
                pokemon_id: safe(7),
                field_index: safe(0),
            }],
        })
    }

    fn entry(context: &FrameContext, revision: u64) -> AuthorityEntry {
        AuthorityEntry {
            context: context.clone(),
            revision: Revision::new(safe(revision)),
            operation_id: OperationId::new(format!("operation-{revision}")).expect("operation id"),
            kind: AuthorityEntryKind::TurnCommit,
            material: Material {
                digest: format!("digest-{revision}"),
                payload: serde_json::Value::Null,
            },
            next_control: control(),
            subsumes: Vec::new(),
        }
    }

    fn bundle() -> RecoveryBundle {
        let context = authority_context();
        let required_tail = (11..=12)
            .map(|revision| entry(&context, revision))
            .collect::<Vec<_>>();
        let final_entry = required_tail.last().expect("recovery tail");
        RecoveryBundle {
            request_id: "recovery-1".to_owned(),
            context,
            material: Material {
                digest: "material-digest".to_owned(),
                payload: serde_json::Value::Null,
            },
            frontier: Revision::new(safe(12)),
            frontier_operation_id: Some(final_entry.operation_id.clone()),
            membership_revision: MembershipRevision::new(safe(2)),
            next_control: Some(final_entry.next_control.clone()),
            required_tail,
        }
    }

    fn frontier(revision: u64) -> AuthorityFrontier {
        AuthorityFrontier {
            received: Revision::new(safe(revision)),
            material: Revision::new(safe(revision)),
            control: Revision::new(safe(revision)),
        }
    }

    fn staged_frontier() -> AuthorityFrontier {
        AuthorityFrontier {
            received: Revision::new(safe(12)),
            material: Revision::new(safe(12)),
            control: Revision::new(safe(11)),
        }
    }

    fn live() -> RecoveryLiveState {
        RecoveryLiveState {
            frontier: frontier(10),
            context: replica_context(),
        }
    }

    fn staged_live() -> RecoveryLiveState {
        RecoveryLiveState {
            frontier: staged_frontier(),
            context: replica_context(),
        }
    }

    fn transaction() -> RecoveryTransaction {
        RecoveryTransaction::new(RecoveryTransactionConfig {
            local_context: replica_context(),
            request_timeout_ms: safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS),
            control_timeout_ms: safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS),
            pacing_ms: safe(DEFAULT_RECOVERY_PACING_MS),
            timer_owner_id: "recovery-owner".to_owned(),
        })
        .expect("recovery transaction config")
    }

    fn start(transaction: &mut RecoveryTransaction, scheduler: &mut KernelScheduler) {
        transaction
            .start(
                "recovery-1".to_owned(),
                frontier(10),
                "rejoin".to_owned(),
                scheduler,
            )
            .expect("recovery start");
    }

    fn prepare_material_pending(next_timer_id: SafeU53) -> (RecoveryTransaction, KernelScheduler) {
        let mut transaction = transaction();
        let mut scheduler = KernelScheduler::new();
        scheduler.set_next_timer_id_for_test(next_timer_id);
        start(&mut transaction, &mut scheduler);
        transaction
            .accept_bundle(bundle(), live(), &mut scheduler)
            .expect("recovery bundle");
        transaction
            .material_result(RecoveryMaterialOutcome::Applied, live(), &mut scheduler)
            .expect("material success");
        (transaction, scheduler)
    }

    fn scheduled(actions: &[RecoveryAction]) -> ScheduledTimer {
        actions
            .iter()
            .find_map(|action| match action {
                RecoveryAction::Scheduler {
                    command: SchedulerCommand::Schedule { timer },
                } => Some(timer.clone()),
                _ => None,
            })
            .expect("scheduled timer")
    }

    fn terminal_view(reason: &str) -> RecoveryFenceView {
        RecoveryFenceView {
            state: RecoveryFenceState::Terminal,
            command_admission_frozen: true,
            control_surface_start_frozen: true,
            progression_frozen: true,
            materialization_frozen: true,
            authority_wait_creation_frozen: true,
            terminal_reason: Some(reason.to_owned()),
        }
    }

    fn terminal_actions(reason: &str, cancelled: &[ScheduledTimer]) -> Vec<RecoveryAction> {
        let mut actions = vec![RecoveryAction::FenceChanged {
            view: terminal_view(reason),
        }];
        actions.extend(cancelled.iter().map(|timer| RecoveryAction::Scheduler {
            command: SchedulerCommand::Cancel {
                endpoint: timer.endpoint,
                timer_id: timer.timer_id,
            },
        }));
        actions.push(RecoveryAction::Terminalize {
            reason: reason.to_owned(),
        });
        actions
    }

    fn recovery_diagnostics(
        phase: RecoveryPhase,
        fence_state: RecoveryFenceState,
        bundle_frontier: Option<u64>,
        timer_ids: &[TimerId],
    ) -> RecoveryDiagnostics {
        RecoveryDiagnostics {
            phase: Some(phase),
            fence_state: Some(fence_state),
            request_id: Some("recovery-1".to_owned()),
            captured_frontier: Some(Revision::new(safe(10))),
            bundle_frontier: bundle_frontier.map(|revision| Revision::new(safe(revision))),
            timer_ids: timer_ids.iter().copied().collect(),
            disposed: false,
        }
    }

    fn terminal_diagnostics(bundle_frontier: Option<u64>) -> RecoveryDiagnostics {
        recovery_diagnostics(
            RecoveryPhase::Terminalized,
            RecoveryFenceState::Terminal,
            bundle_frontier,
            &[],
        )
    }

    fn scheduler_snapshot(
        scheduler: &KernelScheduler,
    ) -> (String, Vec<ScheduledTimer>, SafeU53, bool) {
        (
            format!("{scheduler:?}"),
            scheduler.live_timers(),
            scheduler.pending_timer_count(),
            scheduler.is_disposed(),
        )
    }

    fn assert_no_leaks(transaction: &RecoveryTransaction, scheduler: &KernelScheduler) {
        assert!(transaction.diagnostics().timer_ids.is_empty());
        assert!(scheduler.live_timers().is_empty());
        assert_eq!(scheduler.pending_timer_count(), SafeU53::ZERO);
    }

    fn timer_spec(reason: &str) -> TimerSpec {
        TimerSpec {
            endpoint: SeatId::new(SafeU53::ZERO),
            owner: TimerOwner {
                owner_id: "recovery-exhaustion-test".to_owned(),
                address: format!("exhaustion/{reason}"),
                reason: reason.to_owned(),
            },
            delay_ms: SafeU53::ZERO,
            time_class: TimeClass::Absolute,
        }
    }

    fn exhaust_cursor(scheduler: &mut KernelScheduler) {
        scheduler.set_next_timer_id_for_test(SafeU53::MAX);
        let timer = match scheduler
            .schedule(
                SeatId::new(SafeU53::ZERO),
                TimerOwner {
                    owner_id: "recovery-exhaustion-test".to_owned(),
                    address: "exhaustion/consume".to_owned(),
                    reason: "consume final timer id".to_owned(),
                },
                SafeU53::ZERO,
                TimeClass::Absolute,
            )
            .expect("consume final timer id")
        {
            SchedulerCommand::Schedule { timer } => timer,
            _ => panic!("scheduler returned a non-schedule command"),
        };
        assert_eq!(
            scheduler
                .fired(timer.timer_id)
                .expect("remove fixture timer"),
            timer
        );
    }

    #[test]
    fn request_allocation_at_exhausted_cursor_terminalizes_without_partial_state() {
        let mut scheduler = KernelScheduler::new();
        exhaust_cursor(&mut scheduler);
        let scheduler_before = scheduler_snapshot(&scheduler);
        let mut transaction = transaction();
        let reason = "recovery request timer allocation failed: timer id space is exhausted";

        let actions = transaction
            .start(
                "recovery-1".to_owned(),
                frontier(10),
                "rejoin".to_owned(),
                &mut scheduler,
            )
            .expect("allocator exhaustion terminalizes the recovery");

        assert_eq!(actions, terminal_actions(reason, &[]));
        assert_eq!(transaction.diagnostics(), terminal_diagnostics(None));
        assert_eq!(transaction.fence_view(), Some(terminal_view(reason)));
        assert_eq!(scheduler_snapshot(&scheduler), scheduler_before);
        assert_no_leaks(&transaction, &scheduler);
    }

    #[test]
    fn two_timer_batch_with_one_remaining_id_is_fail_atomic() {
        let mut scheduler = KernelScheduler::new();
        scheduler.set_next_timer_id_for_test(SafeU53::MAX);
        let before = scheduler_snapshot(&scheduler);

        let result = scheduler.schedule_batch(vec![timer_spec("first"), timer_spec("second")]);

        assert_eq!(result, Err(SchedulerError::TimerIdExhausted));
        assert_eq!(scheduler_snapshot(&scheduler), before);
        assert!(scheduler.live_timers().is_empty());
        assert_eq!(scheduler.pending_timer_count(), SafeU53::ZERO);
    }

    #[test]
    fn control_allocation_exhaustion_after_material_success_has_frozen_terminal_order() {
        let (mut transaction, mut scheduler) = prepare_material_pending(SafeU53::MAX);
        assert_eq!(
            transaction.diagnostics(),
            recovery_diagnostics(
                RecoveryPhase::MaterialApplied,
                RecoveryFenceState::Held,
                Some(12),
                &[],
            )
        );
        assert!(scheduler.live_timers().is_empty());
        let scheduler_before = scheduler_snapshot(&scheduler);
        let reason = "recovery control timer allocation failed: timer id space is exhausted";

        let actions = transaction
            .recovered_frontier_staged(
                RecoveryFrontierStagingOutcome::Staged {
                    revision: Revision::new(safe(12)),
                },
                staged_live(),
                &mut scheduler,
            )
            .expect("control allocator exhaustion terminalizes the recovery");

        assert_eq!(actions, terminal_actions(reason, &[]));
        assert_eq!(transaction.diagnostics(), terminal_diagnostics(Some(12)));
        assert_eq!(transaction.fence_view(), Some(terminal_view(reason)));
        assert_eq!(scheduler_snapshot(&scheduler), scheduler_before);
        assert_no_leaks(&transaction, &scheduler);
    }

    #[test]
    fn pacing_allocation_exhaustion_cancels_control_only_in_terminal_order() {
        let before_max = SafeU53::new(SafeU53::MAX.get() - 1).expect("SafeU53 predecessor");
        let (mut transaction, mut scheduler) = prepare_material_pending(before_max);
        let stage_actions = transaction
            .recovered_frontier_staged(
                RecoveryFrontierStagingOutcome::Staged {
                    revision: Revision::new(safe(12)),
                },
                staged_live(),
                &mut scheduler,
            )
            .expect("control timer allocation");
        let control_timer = scheduled(&stage_actions);
        assert_eq!(control_timer.timer_id, TimerId::new(SafeU53::MAX));
        assert_eq!(
            scheduler.timer(control_timer.timer_id),
            Some(&control_timer)
        );
        assert_eq!(
            transaction.diagnostics(),
            recovery_diagnostics(
                RecoveryPhase::FrontierInstalled,
                RecoveryFenceState::Held,
                Some(12),
                &[control_timer.timer_id],
            )
        );
        let mut expected_scheduler = scheduler.clone();
        assert_eq!(
            expected_scheduler.cancel(control_timer.timer_id),
            Some(SchedulerCommand::Cancel {
                endpoint: control_timer.endpoint,
                timer_id: control_timer.timer_id,
            })
        );
        let scheduler_after_control_cancel = scheduler_snapshot(&expected_scheduler);
        let reason = "recovery pacing timer allocation failed: timer id space is exhausted";

        let actions = transaction
            .control_result(
                ControlProjectionOutcome::Deferred,
                staged_live(),
                &mut scheduler,
            )
            .expect("pacing allocator exhaustion terminalizes the recovery");

        assert_eq!(actions, terminal_actions(reason, &[control_timer]));
        assert_eq!(transaction.diagnostics(), terminal_diagnostics(Some(12)));
        assert_eq!(transaction.fence_view(), Some(terminal_view(reason)));
        assert_eq!(
            scheduler_snapshot(&scheduler),
            scheduler_after_control_cancel
        );
        assert_no_leaks(&transaction, &scheduler);
        let after_terminal = scheduler_snapshot(&scheduler);
        assert_eq!(
            scheduler.schedule_batch(vec![timer_spec("after-terminal")]),
            Err(SchedulerError::TimerIdExhausted)
        );
        assert_eq!(scheduler_snapshot(&scheduler), after_terminal);
    }
}
