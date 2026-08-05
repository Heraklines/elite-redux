//! Fenced Authority V2 recovery validation and transaction state.

use std::collections::BTreeSet;

use er_types::{
    AuthorityEntry, AuthorityFrontier, ControlProjectionOutcome, FrameContext, Material,
    NextControl, RecoveryAppliedProof, RecoveryBundle, RecoveryFenceState, RecoveryFenceView,
    RecoveryPhase, RecoveryRequestBody, Revision, SafeU53, TimerId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::SchedulerCommand;

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
    Valid { bundle: Box<RecoveryBundle> },
    Stale {
        captured_frontier: Revision,
        bundle_frontier: Revision,
    },
    Mismatch { issues: Vec<String> },
}

pub fn validate_recovery_bundle(
    _context: &RecoveryValidationContext,
    _bundle: &RecoveryBundle,
) -> RecoveryBundleValidation {
    RecoveryBundleValidation::Mismatch {
        issues: vec!["recovery validator implementation pending".to_owned()],
    }
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
    FenceChanged { view: RecoveryFenceView },
    SendRequest { request: RecoveryRequestBody },
    Scheduler { command: SchedulerCommand },
    ApplyMaterial {
        request_id: String,
        material: Material,
    },
    StageRecoveredFrontier { entry: AuthorityEntry },
    ProjectControl {
        revision: Revision,
        control: NextControl,
        expected_control_id: String,
    },
    SendAppliedProof { proof: RecoveryAppliedProof },
    Terminalize { reason: String },
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
    _contract: (),
}

impl RecoveryFence {
    pub fn new() -> Self {
        Self { _contract: () }
    }

    pub fn state(&self) -> RecoveryFenceState {
        RecoveryFenceState::Open
    }

    pub fn terminal_reason(&self) -> Option<&str> {
        None
    }

    pub fn acquire(&mut self) -> bool {
        false
    }

    pub fn allow_control_projection(&mut self) -> bool {
        false
    }

    pub fn release(&mut self) {
    }

    pub fn terminalize(&mut self, _reason: String) {
    }

    pub fn is_command_admission_frozen(&self) -> bool {
        false
    }

    pub fn is_control_surface_start_frozen(&self) -> bool {
        false
    }

    pub fn is_progression_frozen(&self) -> bool {
        false
    }

    pub fn is_materialization_frozen(&self) -> bool {
        false
    }

    pub fn is_authority_wait_creation_frozen(&self) -> bool {
        false
    }

    pub fn view(&self) -> RecoveryFenceView {
        RecoveryFenceView {
            state: RecoveryFenceState::Open,
            command_admission_frozen: false,
            control_surface_start_frozen: false,
            progression_frozen: false,
            materialization_frozen: false,
            authority_wait_creation_frozen: false,
            terminal_reason: None,
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

#[derive(Debug)]
pub struct RecoveryTransaction {
    _contract: (),
}

impl RecoveryTransaction {
    pub fn new(_config: RecoveryTransactionConfig) -> Result<Self, RecoveryError> {
        Err(RecoveryError::Disposed)
    }

    pub fn start(
        &mut self,
        _request_id: String,
        _captured: AuthorityFrontier,
        _reason: String,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        Err(RecoveryError::Disposed)
    }

    pub fn accept_bundle(
        &mut self,
        _bundle: RecoveryBundle,
        _live_frontier: AuthorityFrontier,
        _live_context: &FrameContext,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        Err(RecoveryError::Disposed)
    }

    pub fn material_result(
        &mut self,
        _outcome: RecoveryMaterialOutcome,
        _live_frontier: AuthorityFrontier,
        _live_context: &FrameContext,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        Err(RecoveryError::Disposed)
    }

    pub fn recovered_frontier_staged(
        &mut self,
        _revision: Revision,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        Err(RecoveryError::Disposed)
    }

    pub fn control_result(
        &mut self,
        _outcome: ControlProjectionOutcome,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        Err(RecoveryError::Disposed)
    }

    pub fn timer_fired(
        &mut self,
        _timer_id: TimerId,
    ) -> Result<Vec<RecoveryAction>, RecoveryError> {
        Err(RecoveryError::Disposed)
    }

    pub fn abort(&mut self, _reason: String) -> Vec<RecoveryAction> {
        Vec::new()
    }

    pub fn phase(&self) -> Option<RecoveryPhase> {
        None
    }

    pub fn fence_view(&self) -> Option<RecoveryFenceView> {
        None
    }

    pub fn fence(&self) -> Option<&RecoveryFence> {
        None
    }

    pub fn diagnostics(&self) -> RecoveryDiagnostics {
        RecoveryDiagnostics::default()
    }

    pub fn dispose(&mut self, _reason: &str) -> Vec<RecoveryAction> {
        Vec::new()
    }
}
