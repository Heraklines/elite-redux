//! Side-effect-free kernel entry point.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_canonical::content_digest;
use er_content::pack::ContentPack;
use er_game::runtime::BattleGameConfig;
use er_protocol::{
    AuthorityEntryBody, AuthorityEntryDraft, AuthorityLog, AuthorityLogAction, AuthorityLogConfig,
    AuthorityReplica, AuthorityReplicaConfig, FrameValidator, InboundFrameResult, KernelScheduler,
    PresentationProbeOutcome, ProposalAdmission, ProposalAdmissionLedger, ProposalIdentity,
    ProposalLeaseAction, ProposalLeaseConfig, ProposalLeaseManager, ProposalLeaseSpec,
    ProposalLeaseStart, RecoveryAction, RecoveryFrontierStagingOutcome, RecoveryLiveState,
    RecoveryMaterialOutcome, RecoveryTransaction, RecoveryTransactionConfig, ReplicaAction,
    ReplicaAdmission, ReplicaResume, ReplicaTailProofDisposition, ScheduledTimer, SchedulerCommand,
    ValidatedFrame, ValidatedFrameBody, control_id_of, frame_contexts_compatible,
};
use er_state::digest::MechanicalStateDigest;
use er_types::{
    AuthorityEntry, AuthorityEntryKind, AuthorityReceipt, AuthorityReceiptBody,
    AuthorityRecoverySlice, ButtonEvent, CancelPolicy, ChoiceListMenu, CommandMenu,
    ConnectionGeneration, ControlProjectionOutcome, FRAME_PROTOCOL_VERSION, FrameContext,
    FrameType, GameButton, InputMap, InputRouterOutput, InputTimerCommand, InteractionMenu,
    MaterialApplicationOutcome, MenuGeneration, MenuOption, MenuOptionId, MenuState, NetworkFrame,
    NextControl, OperationId, PresentationEvent, PresentationEventId, PresentationOutcome,
    ProposalMessage, RawFrame, RecoveryAppliedProof, RecoveryBundle, RecoveryBundleBody,
    RecoveryPhase, RecoveryRequestBody, ReplacementMenu, Revision, SafeU53, SeatId, TailProofBody,
    TailRequestBody, TerminalFrameBody, TerminalMenu, TerminalState, TimeClass, TimerId,
    TimerOwner, TransportState, UiIntent, UiState, WaitingMenu,
};
pub use er_types::{KernelEffect, KernelInput, KernelSnapshot, LiveResourceSnapshot};
use serde_json::{Value, json};
use thiserror::Error;

use crate::battle_kernel::{BattleInitializationError, BattleMode, BattleModeSnapshotParts};
use crate::snapshot::{
    GameKernelSnapshotBridge, KERNEL_DETERMINISM_DIGEST_PREFIX, KernelDeterminismDigest,
    KernelSchedulerSnapshotV2, RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION,
    RestorableKernelSnapshotV2, SnapshotError, restore_game_kernel, snapshot_game_kernel,
};
use crate::{InputRouteError, InputRouter, UiReducer};

#[derive(Clone, Debug, Default)]
pub struct KernelConfig {
    pub input_map: InputMap,
    pub initial_ui: UiState,
    pub protocol: Option<ProtocolKernelConfig>,
}

/// Frozen protocol composition for one independent kernel endpoint.
#[derive(Clone, Debug, PartialEq)]
pub struct ProtocolKernelConfig {
    pub role: ProtocolRoleConfig,
    /// Fixture/game-owned menu projections keyed by exact control identity.
    pub menu_plans: Vec<ControlMenuPlan>,
}

/// Frozen protocol composition for the production M3 battle kernel.
///
/// Unlike the M2 fixture configuration, this boundary contains no authored
/// menu projections or resolver outcomes.  Those values are derived by the
/// game runtime and typed material path.
#[derive(Clone, Debug, PartialEq)]
pub struct BattleProtocolConfig {
    pub role: BattleProtocolRoleConfig,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BattleProtocolRoleConfig {
    Authority {
        log: AuthorityLogConfig,
        proposal_capacity: SafeU53,
    },
    Replica {
        replica: AuthorityReplicaConfig,
        proposal_leases: ProposalLeaseConfig,
        recovery: RecoveryTransactionConfig,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProtocolRoleConfig {
    Authority {
        log: AuthorityLogConfig,
        proposal_capacity: SafeU53,
        resolutions: Vec<AuthorityResolutionPlan>,
    },
    Replica {
        replica: AuthorityReplicaConfig,
        proposal_leases: ProposalLeaseConfig,
        recovery: RecoveryTransactionConfig,
    },
}

/// Game-owned menu data used to project an exact protocol control without
/// allowing campaign code to mutate a reducer or submit a semantic choice.
#[derive(Clone, Debug, PartialEq)]
pub struct MenuProposalPlan {
    pub option_id: MenuOptionId,
    pub fingerprint: String,
    pub payload: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuthorityResolutionPlan {
    pub operation_id: OperationId,
    pub fingerprint: String,
    pub draft: AuthorityEntryDraft,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ControlMenuPlan {
    Command {
        control_id: String,
        owner_seat_id: SeatId,
        operation_id: OperationId,
        field_index: SafeU53,
        options: Vec<MenuOption>,
        proposals: Vec<MenuProposalPlan>,
        cancel: CancelPolicy,
    },
    Replacement {
        control_id: String,
        owner_seat_id: SeatId,
        operation_id: OperationId,
        field_index: SafeU53,
        options: Vec<MenuOption>,
        proposals: Vec<MenuProposalPlan>,
        cancel: CancelPolicy,
    },
    Interaction {
        control_id: String,
        owner_seat_id: SeatId,
        operation_id: OperationId,
        surface_class: String,
        operation_kind: String,
        options: Vec<MenuOption>,
        proposals: Vec<MenuProposalPlan>,
        cancel: CancelPolicy,
    },
}

#[derive(Clone, Debug)]
pub struct GameKernel {
    battle: Option<Box<BattleMode>>,
    run: Option<er_game::run_runtime::RunRuntime>,
    input_router: InputRouter,
    ui_reducer: UiReducer,
    scheduler: KernelScheduler,
    repeat_timers: BTreeMap<TimerId, RepeatContext>,
    pending_presentations: BTreeMap<PresentationEventId, LegacyPresentationEvidence>,
    completed_presentations: BTreeMap<PresentationEventId, LegacyPresentationCompletionEvidence>,
    live_resources: LiveResourceSnapshot,
    protocol_config: Option<ProtocolKernelConfig>,
    protocol: Option<ProtocolState>,
    protocol_init_error: Option<String>,
    terminal: Option<TerminalState>,
    disposed: bool,
}

#[derive(Clone, Debug)]
enum ProtocolState {
    Authority(Box<AuthorityKernelState>),
    Replica(Box<ReplicaKernelState>),
}

#[derive(Clone, Debug)]
struct AuthorityKernelState {
    context: FrameContext,
    peer_bindings: Vec<er_protocol::PeerBinding>,
    log: AuthorityLog,
    proposals: ProposalAdmissionLedger,
    resolutions: Vec<AuthorityResolutionPlan>,
    menu_plans: Vec<ControlMenuPlan>,
    pending_material: Option<AuthorityEntry>,
    pending_control: Option<PendingControl>,
    pending_recoveries: BTreeMap<String, PendingRecoveryExpectation>,
    authority_rebind_pending: bool,
    staged_peer_rebinds: BTreeMap<SeatId, ConnectionGeneration>,
    transports: BTreeMap<SeatId, TransportState>,
}

#[derive(Clone, Debug)]
struct ReplicaKernelState {
    context: FrameContext,
    authority_seat_id: SeatId,
    authority_generation: ConnectionGeneration,
    replica: AuthorityReplica,
    leases: ProposalLeaseManager,
    recovery: RecoveryTransaction,
    recovery_config: RecoveryTransactionConfig,
    recovery_context: FrameContext,
    menu_plans: Vec<ControlMenuPlan>,
    pending_material: Option<PendingMaterial>,
    pending_control: Option<PendingControl>,
    pending_recovery: Option<RecoveryBundle>,
    staged_authority_rebind: Option<ConnectionGeneration>,
    transports: BTreeMap<SeatId, TransportState>,
}

#[derive(Clone, Debug)]
struct PendingMaterial {
    revision: Revision,
    operation_id: OperationId,
}

#[derive(Clone, Debug)]
struct PendingControl {
    revision: Revision,
    operation_id: OperationId,
    control: NextControl,
    expected_control_id: String,
}

#[derive(Clone, Debug)]
struct PendingRecoveryExpectation {
    peer: SeatId,
    context: FrameContext,
    connection_generation: ConnectionGeneration,
    captured_frontier: Revision,
    reason: String,
    frontier: Revision,
    material_digest: String,
    control_id: Option<String>,
    response_frame: NetworkFrame,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MenuSubmissionKind {
    Command,
    Replacement,
    Interaction,
}

#[derive(Clone, Debug)]
struct MenuSubmission {
    kind: MenuSubmissionKind,
    seat: SeatId,
    operation_id: OperationId,
    control_id: String,
    option_id: MenuOptionId,
}

#[derive(Clone, Debug)]
enum CommandPlan {
    EmptyLocalPartition,
    Exact {
        owner: SeatId,
        operation_id: OperationId,
        options: Vec<MenuOption>,
        cancel: CancelPolicy,
    },
}

#[derive(Clone, Debug)]
enum ProtocolActionBatch {
    Authority(Vec<AuthorityLogAction>),
    Proposal(Vec<ProposalLeaseAction>),
    Recovery(Vec<RecoveryAction>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProtocolTimerKind {
    Authority,
    Proposal,
    Recovery,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RepeatContext {
    endpoint: SeatId,
    generation: MenuGeneration,
    button: GameButton,
}

#[derive(Clone, Debug, PartialEq)]
struct LegacyPresentationEvidence {
    revision: Revision,
    operation_id: OperationId,
    event: PresentationEvent,
}

#[derive(Clone, Debug, PartialEq)]
struct LegacyPresentationCompletionEvidence {
    presentation: LegacyPresentationEvidence,
    outcome: PresentationProbeOutcome,
}

impl LegacyPresentationEvidence {
    fn from_entry(entry: &AuthorityEntry) -> Self {
        let event_id = PresentationEventId::new(entry.revision.get());
        Self {
            revision: entry.revision,
            operation_id: entry.operation_id.clone(),
            event: PresentationEvent {
                event_id,
                event_kind: "authority-entry".to_owned(),
                payload: entry.material.payload.clone(),
            },
        }
    }

    fn matches_entry(&self, entry: &AuthorityEntry) -> bool {
        self.revision == entry.revision
            && self.operation_id == entry.operation_id
            && self.event.event_id == PresentationEventId::new(entry.revision.get())
            && self.event.event_kind == "authority-entry"
            && self.event.payload == entry.material.payload
    }
}

impl GameKernel {
    pub fn new(config: KernelConfig) -> Self {
        let protocol_config = config.protocol;
        let (protocol, protocol_init_error) = match protocol_config.as_ref() {
            Some(protocol_config) => match ProtocolState::new(protocol_config) {
                Ok(protocol) => (Some(protocol), None),
                Err(reason) => (None, Some(reason)),
            },
            None => (None, None),
        };
        let mut kernel = Self {
            battle: None,
            input_router: InputRouter::new(config.input_map),
            ui_reducer: UiReducer::new(config.initial_ui),
            scheduler: KernelScheduler::new(),
            repeat_timers: BTreeMap::new(),
            pending_presentations: BTreeMap::new(),
            completed_presentations: BTreeMap::new(),
            live_resources: LiveResourceSnapshot::default(),
            protocol_config,
            protocol,
            protocol_init_error,
            terminal: None,
            disposed: false,
        };
        if kernel.protocol.is_some() {
            kernel.sync_live_resources();
        }
        kernel
    }

    /// Construct the production M3 Battle kernel. The fixture-authored M1/M2
    /// protocol and menu-plan surfaces are not installed on this path.
    pub fn new_battle(
        config: BattleGameConfig,
        protocol: BattleProtocolConfig,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        let battle = BattleMode::new(config, protocol, content)?;
        let mut kernel = Self::new(KernelConfig::default());
        kernel.live_resources = battle.live_resources(&kernel.scheduler);
        kernel.battle = Some(Box::new(battle));
        Ok(kernel)
    }

    /// Construct the production M4 run kernel from validated initial state.
    /// No fixture-authored plans are installed on this path; every causal
    /// decision flows through [`AuthorityRunMaterial`] application.
    pub fn new_run(
        state: er_state::game_v2::GameStateV2,
        battle_content_hash: er_types::battle_ids::ContentPackHash,
        run_content_hash: er_types::run_ids::RunContentPackHash,
        m4_oracle_sha: impl Into<String>,
    ) -> Result<Self, String> {
        let runtime = er_game::run_runtime::RunRuntime::new(
            state,
            battle_content_hash,
            run_content_hash.clone(),
            m4_oracle_sha,
        )
        .map_err(|error| error.to_string())?;
        let mut kernel = Self::new(KernelConfig::default());
        kernel.run = Some(runtime);
        Ok(kernel)
    }

    /// Applies one canonical run-material payload through the single shared
    /// production applier. Canonical bytes in, atomic state swap out; both
    /// authority and replica use exactly this entry point.
    pub fn apply_run_material_bytes(&mut self, bytes: &[u8]) -> Result<(), KernelError> {
        if self.disposed {
            return Err(KernelError::Disposed);
        }
        let runtime = self.run.as_mut().ok_or_else(|| KernelError::Canonical {
            reason: "run mode is not active".to_owned(),
        })?;
        let material =
            er_run::decode_run_material(bytes).map_err(|error| KernelError::Canonical {
                reason: error.to_string(),
            })?;
        runtime
            .apply(&material)
            .map_err(|error| KernelError::Canonical {
                reason: error.to_string(),
            })
    }

    pub fn step(&mut self, input: KernelInput) -> Result<Vec<KernelEffect>, KernelError> {
        if self.disposed {
            return Err(KernelError::Disposed);
        }
        if let Some(reason) = self.protocol_init_error.as_ref() {
            return Err(KernelError::Canonical {
                reason: reason.clone(),
            });
        }
        if self.terminal.is_some() {
            return Ok(Vec::new());
        }
        if let Some(battle) = self.battle.as_mut() {
            let effects = battle
                .step(&mut self.scheduler, &mut self.terminal, input)
                .map_err(|error| KernelError::Battle {
                    reason: error.to_string(),
                })?;
            self.live_resources = battle.live_resources(&self.scheduler);
            return Ok(effects);
        }
        match input {
            KernelInput::RawInput { seat, event } => {
                let generation = self.ui_reducer.state().generation;
                let output = self.input_router.handle(seat, event, &mut self.scheduler)?;
                let effects = self.apply_raw_input_output(seat, generation, output);
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::TimerFired { endpoint, timer_id } => {
                let Some(scheduled) = self.scheduler.timer(timer_id).cloned() else {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                };
                if scheduled.endpoint != endpoint {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }
                let repeat_context = self.repeat_timers.get(&timer_id).copied();
                if repeat_context
                    .is_some_and(|context| !Self::is_input_repeat_timer(&scheduled, context))
                {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }
                if let Some(context) = repeat_context {
                    let fired = self
                        .scheduler
                        .fired(timer_id)
                        .map_err(InputRouteError::from)?;
                    self.repeat_timers.remove(&timer_id);
                    let output = match self.input_router.timer_fired(fired, &mut self.scheduler) {
                        Ok(output) => output,
                        Err(error) => {
                            self.input_router
                                .discard_timer(timer_id, &mut self.scheduler);
                            self.sync_live_resources();
                            return Err(error.into());
                        }
                    };
                    let effects = self.apply_timer_output(context, output);
                    self.sync_live_resources();
                    return Ok(effects);
                }

                let protocol_timer = self.protocol_timer_kind(timer_id);
                if protocol_timer.is_none() {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }
                let fired = self
                    .scheduler
                    .fired(timer_id)
                    .map_err(InputRouteError::from)?;
                let effects = self.dispatch_protocol_timer(protocol_timer, fired)?;
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::NetworkFrame { endpoint, frame } => {
                self.dispatch_network_frame(endpoint, frame)
            }
            KernelInput::RawNetworkFrame { endpoint, frame } => {
                self.dispatch_raw_network_frame(endpoint, frame)
            }
            KernelInput::ProposalReceived { endpoint, proposal } => {
                let effects = self.dispatch_proposal(endpoint, proposal)?;
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::PresentationSettled {
                endpoint,
                event_id,
                outcome,
            } => {
                let effects = self.dispatch_presentation(endpoint, event_id, outcome)?;
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::BattlePresentationOutcome { .. } => Err(KernelError::Canonical {
                reason: "battle presentation outcome requires Battle-mode construction".to_owned(),
            }),
            KernelInput::TransportChanged {
                endpoint,
                state,
                generation,
            } => {
                let effects = self.dispatch_transport(endpoint, state, generation)?;
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::StorageResult {
                endpoint,
                request_id,
                result,
            } => {
                let _ = (endpoint, request_id, result);
                self.sync_live_resources();
                Ok(Vec::new())
            }
            KernelInput::MaterialApplied {
                endpoint,
                revision,
                outcome,
            } => {
                let effects = self.dispatch_material(endpoint, revision, outcome)?;
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::ControlProjected {
                endpoint,
                revision,
                outcome,
            } => {
                let effects = self.dispatch_control(endpoint, revision, outcome)?;
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::Suspend { endpoint } => {
                let effects = self.dispatch_suspend(endpoint, true)?;
                self.sync_live_resources();
                Ok(effects)
            }
            KernelInput::Resume { endpoint } => {
                let effects = self.dispatch_suspend(endpoint, false)?;
                self.sync_live_resources();
                Ok(effects)
            }
        }
    }

    pub fn snapshot(&self) -> KernelSnapshot {
        if let Some(battle) = self.battle.as_ref() {
            let mut state = battle.state_value();
            if let Value::Object(fields) = &mut state {
                fields.insert("terminal".to_owned(), json!(self.terminal));
                fields.insert("liveResources".to_owned(), json!(self.live_resources));
                fields.insert("disposed".to_owned(), json!(self.disposed));
            }
            return KernelSnapshot {
                ui: UiState::default(),
                state,
            };
        }
        KernelSnapshot {
            ui: self.ui_reducer.state().clone(),
            state: self.protocol_snapshot(),
        }
    }

    /// Return the exact causal audit emitted by the most recent production
    /// Battle step. This observation seam is read-only and is not snapshot
    /// state; replay obtains it again by executing the same external input.
    #[doc(hidden)]
    pub fn m3_trace_audit(
        &self,
    ) -> (
        Vec<crate::snapshot::RngDraw>,
        Vec<er_game::internal_event::InternalEventKind>,
    ) {
        self.battle.as_ref().map_or_else(
            || (Vec::new(), Vec::new()),
            |battle| {
                let (rng_audit, internal_events) = battle.trace_audit();
                (rng_audit.to_vec(), internal_events.to_vec())
            },
        )
    }

    /// Capture the complete, closed production-M3 endpoint owner graph.
    pub fn snapshot_v2(&self) -> Result<RestorableKernelSnapshotV2, SnapshotError> {
        snapshot_game_kernel(self)
    }

    /// Reconstruct a fresh production-M3 endpoint from a validated snapshot.
    pub fn from_snapshot(
        snapshot: RestorableKernelSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        restore_game_kernel(snapshot, content)
    }

    /// Explicit schema-version alias for callers that name the V2 boundary.
    pub fn from_snapshot_v2(
        snapshot: RestorableKernelSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        Self::from_snapshot(snapshot, content)
    }

    fn capture_restorable_snapshot_v2(&self) -> Result<RestorableKernelSnapshotV2, SnapshotError> {
        let battle = self.battle.as_ref().ok_or_else(|| {
            m3_snapshot_invalid(
                "battle",
                "restorable V2 snapshots require production Battle-mode construction",
            )
        })?;
        if self.protocol_config.is_some()
            || self.protocol.is_some()
            || self.protocol_init_error.is_some()
            || !self.repeat_timers.is_empty()
            || !self.pending_presentations.is_empty()
        {
            return Err(m3_snapshot_invalid(
                "legacy_owners",
                "production Battle mode cannot retain fixture protocol or presentation owners",
            ));
        }
        let expected_resources = battle.live_resources(&self.scheduler);
        if self.live_resources != expected_resources {
            return Err(m3_snapshot_invalid(
                "live_resources",
                "root live-resource projection differs from the battle owner graph",
            ));
        }

        let parts = battle.snapshot_parts(&self.scheduler, &self.terminal, self.disposed)?;
        let scheduler = KernelSchedulerSnapshotV2::from_scheduler(&self.scheduler)?;
        let mechanical_digest = MechanicalStateDigest::compute(&parts.game.state)
            .map_err(|error| m3_snapshot_invalid("mechanical_digest", error.to_string()))?;
        let presentation_plan_digest =
            er_battle::compute_presentation_plan_digest(&parts.pending_presentations.plan_events())
                .map_err(|error| {
                    m3_snapshot_canonical("presentation_plan_digest", error.to_string())
                })?;
        let content_hash = parts.game.state.content_hash.clone();
        let mut snapshot = RestorableKernelSnapshotV2 {
            schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION,
            content_hash,
            runtime_identity: parts.runtime_identity,
            input_router: parts.input_router,
            ui: parts.ui,
            scheduler,
            protocol: parts.protocol,
            game: parts.game,
            pending_presentations: parts.pending_presentations,
            terminal: self.terminal.clone(),
            disposed: self.disposed,
            prepared_transaction: None,
            mechanical_digest,
            kernel_determinism_digest: KernelDeterminismDigest::new(format!(
                "{KERNEL_DETERMINISM_DIGEST_PREFIX}{}",
                "0".repeat(64)
            ))?,
            presentation_plan_digest,
        };
        snapshot.kernel_determinism_digest = KernelDeterminismDigest::compute(&snapshot)?;
        snapshot.validate()?;
        Ok(snapshot)
    }

    fn restore_restorable_snapshot_v2(
        snapshot: RestorableKernelSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        snapshot.validate_for_content(content.as_ref())?;
        let expected_snapshot = snapshot.clone();
        let RestorableKernelSnapshotV2 {
            runtime_identity,
            input_router,
            ui,
            scheduler,
            protocol,
            game,
            pending_presentations,
            terminal,
            disposed,
            ..
        } = snapshot;
        let mut scheduler = scheduler.into_scheduler()?;
        let battle = BattleMode::from_snapshot_parts(
            BattleModeSnapshotParts {
                runtime_identity,
                input_router,
                ui,
                protocol,
                game,
                pending_presentations,
            },
            &mut scheduler,
            &terminal,
            disposed,
            content,
        )?;
        let mut kernel = Self::new(KernelConfig::default());
        kernel.scheduler = scheduler;
        kernel.terminal = terminal;
        kernel.disposed = disposed;
        kernel.live_resources = if disposed {
            LiveResourceSnapshot::default()
        } else {
            battle.live_resources(&kernel.scheduler)
        };
        kernel.battle = Some(Box::new(battle));
        let restored_snapshot = kernel.capture_restorable_snapshot_v2()?;
        if restored_snapshot.mechanical_digest != expected_snapshot.mechanical_digest {
            return Err(m3_snapshot_invalid(
                "mechanical_digest",
                "restored runtime does not reproduce the captured mechanical digest",
            ));
        }
        if restored_snapshot.presentation_plan_digest != expected_snapshot.presentation_plan_digest
        {
            return Err(m3_snapshot_invalid(
                "presentation_plan_digest",
                "restored runtime does not reproduce the captured presentation digest",
            ));
        }
        if restored_snapshot.kernel_determinism_digest
            != expected_snapshot.kernel_determinism_digest
        {
            return Err(m3_snapshot_invalid(
                "kernel_determinism_digest",
                "restored runtime does not reproduce the captured determinism digest",
            ));
        }
        if restored_snapshot != expected_snapshot {
            return Err(m3_snapshot_invalid(
                "snapshot",
                "restored runtime does not reproduce the complete captured owner graph",
            ));
        }
        Ok(kernel)
    }

    pub fn state_digest(&self) -> String {
        match content_digest(&self.snapshot()) {
            Ok(digest) => digest,
            Err(error) => format!("invalid-kernel-state:{error}"),
        }
    }

    pub fn live_resources(&self) -> LiveResourceSnapshot {
        self.live_resources.clone()
    }

    pub fn protocol_config(&self) -> Option<&ProtocolKernelConfig> {
        self.protocol_config.as_ref()
    }

    pub fn battle_protocol_config(&self) -> Option<&BattleProtocolConfig> {
        self.battle.as_ref().map(|battle| battle.protocol_config())
    }

    pub fn battle_ui_projection(&self) -> Option<&er_types::battle_ui::BattleUiProjection> {
        self.battle.as_ref().map(|battle| battle.projection())
    }

    pub fn is_disposed(&self) -> bool {
        self.disposed
    }

    fn accept_shared_terminal_root(
        &mut self,
        terminal: &TerminalState,
    ) -> Result<(), SnapshotError> {
        if self.disposed {
            return Err(m3_snapshot_invalid(
                "terminal",
                "disposed endpoint cannot accept a new shared terminal root",
            ));
        }
        if let Some(existing) = &self.terminal {
            if existing != terminal {
                return Err(m3_snapshot_invalid(
                    "terminal",
                    "shared terminal differs from the endpoint terminal root",
                ));
            }
            return Ok(());
        }
        self.terminal = Some(terminal.clone());
        Ok(())
    }

    pub fn dispose(&mut self, reason: &str) -> Vec<KernelEffect> {
        if self.disposed {
            return Vec::new();
        }

        if let Some(battle) = self.battle.as_mut() {
            let mut effects = battle.dispose(&mut self.scheduler, reason);
            for command in self.scheduler.dispose() {
                if let SchedulerCommand::Cancel { endpoint, timer_id } = command {
                    effects.push(KernelEffect::CancelTimer { endpoint, timer_id });
                }
            }
            // Retain the disposed Battle owner so a terminal/teardown V2
            // snapshot can still reconstruct the exact mechanical endpoint.
            // `disposed` remains the absorbing execution guard.
            self.disposed = true;
            self.live_resources = LiveResourceSnapshot::default();
            return effects;
        }

        let contexts = self.repeat_timers.clone();
        let output = self.input_router.clear(&mut self.scheduler);
        let mut effects = Vec::new();
        for timer in output.timers {
            let InputTimerCommand::Cancel { timer_id } = timer else {
                continue;
            };
            if let Some(context) = contexts.get(&timer_id) {
                effects.push(KernelEffect::CancelTimer {
                    endpoint: context.endpoint,
                    timer_id,
                });
            }
        }
        self.repeat_timers.clear();

        let protocol_batches = if let Some(protocol) = self.protocol.as_mut() {
            match protocol {
                ProtocolState::Authority(authority) => vec![ProtocolActionBatch::Authority(
                    authority.log.dispose(reason, &mut self.scheduler),
                )],
                ProtocolState::Replica(replica) => vec![
                    ProtocolActionBatch::Recovery(
                        replica.recovery.dispose(reason, &mut self.scheduler),
                    ),
                    ProtocolActionBatch::Proposal(
                        replica.leases.dispose(reason, &mut self.scheduler),
                    ),
                ],
            }
        } else {
            Vec::new()
        };
        for batch in protocol_batches {
            match batch {
                ProtocolActionBatch::Authority(actions) => {
                    effects.extend(self.map_authority_actions(actions));
                }
                ProtocolActionBatch::Proposal(actions) => {
                    effects.extend(self.map_proposal_actions(actions));
                }
                ProtocolActionBatch::Recovery(actions) => {
                    // Endpoint teardown only releases recovery owners. A
                    // cleanup-time terminal fence must not publish a new
                    // shared terminal after this endpoint is disposed.
                    if let Ok(mapped) = Self::map_rebind_recovery_cleanup(actions) {
                        effects.extend(mapped);
                    }
                }
            }
        }
        if let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() {
            authority.proposals.dispose();
        }
        if let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() {
            replica.replica.dispose(reason);
        }

        for command in self.scheduler.dispose() {
            if let SchedulerCommand::Cancel { endpoint, timer_id } = command {
                effects.push(KernelEffect::CancelTimer { endpoint, timer_id });
            }
        }

        self.protocol = None;
        self.pending_presentations.clear();
        self.completed_presentations.clear();
        self.disposed = true;
        self.live_resources = LiveResourceSnapshot::default();
        effects
    }

    pub fn ui_state(&self) -> &UiState {
        self.ui_reducer.state()
    }

    pub fn ui_view(&self) -> er_types::UiViewModel {
        self.ui_reducer.view()
    }

    pub fn replace_menu(
        &mut self,
        owner_seat: Option<SeatId>,
        actionable: bool,
        menu: MenuState,
    ) -> MenuGeneration {
        if self.battle.is_some() || self.disposed || self.terminal.is_some() {
            return self.ui_reducer.state().generation;
        }
        let generation = self.ui_reducer.replace_menu(owner_seat, actionable, menu);
        self.sync_live_resources();
        generation
    }

    fn apply_raw_input_output(
        &mut self,
        endpoint: SeatId,
        generation: MenuGeneration,
        output: InputRouterOutput,
    ) -> Vec<KernelEffect> {
        let (mut effects, pressed) = self.reduce_button_events(endpoint, generation, output.events);

        for timer in output.timers {
            match timer {
                InputTimerCommand::Schedule { timer_id, delay_ms } => {
                    let Some((button, accepted)) = pressed else {
                        self.input_router
                            .discard_timer(timer_id, &mut self.scheduler);
                        continue;
                    };
                    if !accepted {
                        self.input_router
                            .discard_timer(timer_id, &mut self.scheduler);
                        continue;
                    }

                    if !self.is_live_input_timer(timer_id, endpoint, button, delay_ms) {
                        self.input_router
                            .discard_timer(timer_id, &mut self.scheduler);
                        continue;
                    }

                    self.repeat_timers.insert(
                        timer_id,
                        RepeatContext {
                            endpoint,
                            generation,
                            button,
                        },
                    );
                    effects.push(KernelEffect::ScheduleTimer {
                        endpoint,
                        timer_id,
                        owner: TimerOwner::input_repeat(button),
                        delay_ms,
                        time_class: TimeClass::HumanInput,
                    });
                }
                InputTimerCommand::Cancel { timer_id } => {
                    if let Some(context) = self.repeat_timers.remove(&timer_id) {
                        effects.push(KernelEffect::CancelTimer {
                            endpoint: context.endpoint,
                            timer_id,
                        });
                    }
                }
            }
        }

        self.sync_live_timers();
        effects
    }

    fn apply_timer_output(
        &mut self,
        context: RepeatContext,
        output: InputRouterOutput,
    ) -> Vec<KernelEffect> {
        let (mut effects, pressed) =
            self.reduce_button_events(context.endpoint, context.generation, output.events);
        let repeat_is_accepted = match pressed {
            None => true,
            Some((button, accepted)) => button == context.button && accepted,
        };

        for timer in output.timers {
            match timer {
                InputTimerCommand::Schedule { timer_id, delay_ms } => {
                    if !self.is_live_input_timer(
                        timer_id,
                        context.endpoint,
                        context.button,
                        delay_ms,
                    ) {
                        self.input_router
                            .discard_timer(timer_id, &mut self.scheduler);
                        continue;
                    }

                    self.repeat_timers.insert(
                        timer_id,
                        RepeatContext {
                            endpoint: context.endpoint,
                            generation: context.generation,
                            button: context.button,
                        },
                    );
                    if repeat_is_accepted {
                        effects.push(KernelEffect::ScheduleTimer {
                            endpoint: context.endpoint,
                            timer_id,
                            owner: TimerOwner::input_repeat(context.button),
                            delay_ms,
                            time_class: TimeClass::HumanInput,
                        });
                    } else {
                        self.input_router
                            .discard_timer(timer_id, &mut self.scheduler);
                        self.repeat_timers.remove(&timer_id);
                    }
                }
                InputTimerCommand::Cancel { timer_id } => {
                    if let Some(timer_context) = self.repeat_timers.remove(&timer_id) {
                        effects.push(KernelEffect::CancelTimer {
                            endpoint: timer_context.endpoint,
                            timer_id,
                        });
                    }
                }
            }
        }

        self.sync_live_timers();
        effects
    }

    fn is_input_repeat_timer(timer: &ScheduledTimer, context: RepeatContext) -> bool {
        timer.endpoint == context.endpoint
            && timer.owner == TimerOwner::input_repeat(context.button)
            && timer.time_class == TimeClass::HumanInput
    }

    fn is_live_input_timer(
        &self,
        timer_id: TimerId,
        endpoint: SeatId,
        button: GameButton,
        delay_ms: SafeU53,
    ) -> bool {
        self.scheduler.timer(timer_id).is_some_and(|timer| {
            timer.endpoint == endpoint
                && timer.owner == TimerOwner::input_repeat(button)
                && timer.delay_ms == delay_ms
                && timer.time_class == TimeClass::HumanInput
        })
    }

    fn sync_live_timers(&mut self) {
        self.live_resources.timers = self
            .scheduler
            .live_timers()
            .into_iter()
            .map(|timer| timer.timer_id)
            .collect();
    }

    fn reduce_button_events(
        &mut self,
        endpoint: SeatId,
        generation: MenuGeneration,
        events: Vec<ButtonEvent>,
    ) -> (Vec<KernelEffect>, Option<(GameButton, bool)>) {
        let mut effects = Vec::new();
        let mut pressed = None;

        for event in events {
            let ButtonEvent::Pressed(button) = event else {
                continue;
            };
            if self.command_admission_frozen() {
                pressed = Some((button, false));
                continue;
            }
            let intents =
                self.ui_reducer
                    .reduce_at(endpoint, generation, ButtonEvent::Pressed(button));
            let accepted = intents.is_ok();
            pressed = Some((button, accepted));
            if let Ok(intents) = intents {
                effects.push(KernelEffect::UiChanged {
                    endpoint,
                    view: self.ui_reducer.view(),
                });
                for intent in intents {
                    effects.push(KernelEffect::UiIntent {
                        endpoint,
                        intent: intent.clone(),
                    });
                    effects.extend(self.route_ui_intent(intent));
                }
            }
        }

        (effects, pressed)
    }

    fn local_endpoint(&self) -> SeatId {
        match self.protocol.as_ref() {
            Some(ProtocolState::Authority(authority)) => authority.context.sender_seat_id,
            Some(ProtocolState::Replica(replica)) => replica.context.sender_seat_id,
            None => match self.ui_reducer.state().owner_seat {
                Some(owner) => owner,
                None => SeatId::ZERO,
            },
        }
    }

    fn command_admission_frozen(&self) -> bool {
        self.protocol
            .as_ref()
            .is_some_and(|protocol| match protocol {
                ProtocolState::Authority(authority) => {
                    authority.pending_material.is_some()
                        || authority.pending_control.is_some()
                        || authority.authority_rebind_pending
                }
                ProtocolState::Replica(replica) => {
                    replica.pending_material.is_some()
                        || replica.pending_control.is_some()
                        || replica.staged_authority_rebind.is_some()
                        || replica
                            .recovery
                            .fence()
                            .is_some_and(|fence| fence.is_command_admission_frozen())
                }
            })
    }

    fn protocol_timer_kind(&self, timer_id: TimerId) -> Option<ProtocolTimerKind> {
        match self.protocol.as_ref()? {
            ProtocolState::Authority(authority)
                if authority
                    .log
                    .diagnostics()
                    .delivery_timer_ids
                    .contains(&timer_id) =>
            {
                Some(ProtocolTimerKind::Authority)
            }
            ProtocolState::Replica(replica)
                if replica.leases.diagnostics().timer_ids.contains(&timer_id) =>
            {
                Some(ProtocolTimerKind::Proposal)
            }
            ProtocolState::Replica(replica)
                if replica.recovery.diagnostics().timer_ids.contains(&timer_id) =>
            {
                Some(ProtocolTimerKind::Recovery)
            }
            _ => None,
        }
    }

    fn dispatch_protocol_timer(
        &mut self,
        kind: Option<ProtocolTimerKind>,
        fired: ScheduledTimer,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let Some(kind) = kind else {
            return Err(InputRouteError::UnknownTimer {
                timer_id: fired.timer_id,
            }
            .into());
        };
        let batch = match kind {
            ProtocolTimerKind::Authority => {
                let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() else {
                    return Err(kernel_protocol_error(
                        "authority timer has no authority owner",
                    ));
                };
                let actions = authority
                    .log
                    .timer_fired(fired, &mut self.scheduler)
                    .map_err(kernel_protocol_error)?;
                ProtocolActionBatch::Authority(actions)
            }
            ProtocolTimerKind::Proposal => {
                let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                    return Err(kernel_protocol_error("proposal timer has no replica owner"));
                };
                let actions = replica
                    .leases
                    .timer_fired(fired, &mut self.scheduler)
                    .map_err(kernel_protocol_error)?;
                ProtocolActionBatch::Proposal(actions)
            }
            ProtocolTimerKind::Recovery => {
                let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                    return Err(kernel_protocol_error("recovery timer has no replica owner"));
                };
                let live = RecoveryLiveState {
                    frontier: replica.replica.frontier(),
                    context: replica.recovery_context.clone(),
                };
                let actions = replica
                    .recovery
                    .timer_fired(fired, live, &mut self.scheduler)
                    .map_err(kernel_protocol_error)?;
                ProtocolActionBatch::Recovery(actions)
            }
        };
        self.apply_protocol_batch(batch)
    }

    fn apply_protocol_batch(
        &mut self,
        batch: ProtocolActionBatch,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        match batch {
            ProtocolActionBatch::Authority(actions) => Ok(self.map_authority_actions(actions)),
            ProtocolActionBatch::Proposal(actions) => Ok(self.map_proposal_actions(actions)),
            ProtocolActionBatch::Recovery(actions) => self.apply_recovery_actions(actions),
        }
    }

    fn map_scheduler_command(command: SchedulerCommand) -> Option<KernelEffect> {
        match command {
            SchedulerCommand::Schedule { timer } => Some(KernelEffect::ScheduleTimer {
                endpoint: timer.endpoint,
                timer_id: timer.timer_id,
                owner: timer.owner,
                delay_ms: timer.delay_ms,
                time_class: timer.time_class,
            }),
            SchedulerCommand::Cancel { endpoint, timer_id } => {
                Some(KernelEffect::CancelTimer { endpoint, timer_id })
            }
            SchedulerCommand::PauseClass { .. } | SchedulerCommand::ResumeClass { .. } => None,
        }
    }

    fn map_authority_actions(&mut self, actions: Vec<AuthorityLogAction>) -> Vec<KernelEffect> {
        let mut effects = Vec::new();
        for action in actions {
            match action {
                AuthorityLogAction::Scheduler { command } => {
                    if let Some(effect) = Self::map_scheduler_command(command) {
                        effects.push(effect);
                    }
                }
                AuthorityLogAction::Deliver { entry, .. } => match authority_entry_frame(&entry) {
                    Ok(frame) => effects.push(KernelEffect::SendFrame {
                        from: entry.context.sender_seat_id,
                        frame,
                    }),
                    Err(reason) => effects.extend(self.enter_terminal(reason)),
                },
                AuthorityLogAction::TailProof { context, body, .. } => {
                    match tail_proof_frame(&context, body) {
                        Ok(frame) => effects.push(KernelEffect::SendFrame {
                            from: context.sender_seat_id,
                            frame,
                        }),
                        Err(reason) => effects.extend(self.enter_terminal(reason)),
                    }
                }
            }
        }
        self.sync_live_resources();
        effects
    }

    fn map_proposal_actions(&mut self, actions: Vec<ProposalLeaseAction>) -> Vec<KernelEffect> {
        let mut effects = Vec::new();
        for action in actions {
            match action {
                ProposalLeaseAction::Scheduler { command } => {
                    if let Some(effect) = Self::map_scheduler_command(command) {
                        effects.push(effect);
                    }
                }
                ProposalLeaseAction::Send { proposal } => {
                    effects.push(KernelEffect::SendProposal { proposal });
                }
                ProposalLeaseAction::Terminalize {
                    operation_id,
                    reason,
                } => effects.extend(
                    self.enter_terminal(format!("proposal {operation_id} terminalized: {reason}")),
                ),
            }
        }
        self.sync_live_resources();
        effects
    }

    fn map_replica_actions(
        &mut self,
        actions: Vec<ReplicaAction>,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        self.map_replica_actions_with_probe_mode(actions, false)
    }

    fn map_replica_actions_with_probe_mode(
        &mut self,
        actions: Vec<ReplicaAction>,
        duplicate_complete_probe: bool,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let mut effects = Vec::new();
        for action in actions {
            match action {
                ReplicaAction::EmitReceipt { receipt } => match receipt_frame(&receipt) {
                    Ok(frame) => effects.push(KernelEffect::SendFrame {
                        from: receipt.context.sender_seat_id,
                        frame,
                    }),
                    Err(reason) => effects.extend(self.enter_terminal(reason)),
                },
                ReplicaAction::ApplyMaterial { entry } => {
                    self.set_pending_material(entry.revision, entry.operation_id.clone());
                    effects.push(KernelEffect::ApplyAuthorityMaterial {
                        endpoint: self.local_endpoint(),
                        revision: entry.revision,
                        operation_id: entry.operation_id,
                        material: entry.material,
                    });
                }
                ReplicaAction::ProjectControl {
                    entry,
                    expected_control_id,
                } => {
                    self.set_pending_control(PendingControl {
                        revision: entry.revision,
                        operation_id: entry.operation_id.clone(),
                        control: entry.next_control.clone(),
                        expected_control_id: expected_control_id.clone(),
                    });
                    effects.push(KernelEffect::ProjectAuthorityControl {
                        endpoint: self.local_endpoint(),
                        revision: entry.revision,
                        operation_id: entry.operation_id,
                        control: entry.next_control,
                    });
                }
                ReplicaAction::ProbePresentation { entry } => {
                    let evidence = LegacyPresentationEvidence::from_entry(&entry);
                    let event_id = evidence.event.event_id;
                    let has_duplicate_evidence = duplicate_complete_probe
                        || self.pending_presentations.contains_key(&event_id)
                        || self.completed_presentations.contains_key(&event_id);
                    if has_duplicate_evidence {
                        if let Some(pending) = self.pending_presentations.get(&event_id) {
                            if !pending.matches_entry(&entry) {
                                return Err(kernel_protocol_error(format!(
                                    "pending presentation evidence conflicts for event {event_id:?}"
                                )));
                            }
                            continue;
                        }
                        if let Some(completed) = self.completed_presentations.get(&event_id) {
                            if !completed.presentation.matches_entry(&entry) {
                                return Err(kernel_protocol_error(format!(
                                    "completed presentation evidence conflicts for event {event_id:?}"
                                )));
                            }
                            let completed_outcome = completed.outcome;
                            let completion_actions = {
                                let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut()
                                else {
                                    return Err(kernel_protocol_error(
                                        "duplicate presentation probe has no replica owner",
                                    ));
                                };
                                replica
                                    .replica
                                    .presentation_result(entry.revision, completed_outcome)
                                    .map_err(kernel_protocol_error)?
                            };
                            effects.extend(self.map_replica_actions(completion_actions)?);
                            continue;
                        }
                    }
                    self.pending_presentations
                        .insert(event_id, evidence.clone());
                    effects.push(KernelEffect::Present {
                        endpoint: self.local_endpoint(),
                        event: evidence.event,
                    });
                }
                ReplicaAction::RequestTail {
                    context,
                    missing_from,
                } => match tail_request_frame(&context, missing_from) {
                    Ok(frame) => effects.push(KernelEffect::SendFrame {
                        from: context.sender_seat_id,
                        frame,
                    }),
                    Err(reason) => effects.extend(self.enter_terminal(reason)),
                },
                ReplicaAction::RequestTailProof { context, request } => {
                    match correlated_tail_request_frame(&context, request) {
                        Ok(frame) => effects.push(KernelEffect::SendFrame {
                            from: context.sender_seat_id,
                            frame,
                        }),
                        Err(reason) => effects.extend(self.enter_terminal(reason)),
                    }
                }
                ReplicaAction::EnterTerminal { reason } => {
                    effects.extend(self.enter_terminal(reason));
                }
            }
        }
        self.sync_live_resources();
        Ok(effects)
    }

    fn route_ui_intent(&mut self, intent: UiIntent) -> Vec<KernelEffect> {
        let Some(submission) = menu_submission(intent) else {
            return Vec::new();
        };
        let Some(plan) = self.menu_proposal_plan(&submission) else {
            return self.enter_terminal(format!(
                "missing exact menu proposal plan for {} / {}",
                submission.operation_id, submission.option_id
            ));
        };
        let local = self.local_endpoint();
        if submission.seat != local {
            return Vec::new();
        }

        let authority = match self.protocol.as_ref() {
            Some(ProtocolState::Authority(authority)) => authority.context.authority_seat_id,
            Some(ProtocolState::Replica(replica)) => replica.authority_seat_id,
            None => return Vec::new(),
        };
        let proposal = ProposalMessage {
            operation_id: submission.operation_id,
            fingerprint: plan.fingerprint,
            from: local,
            to: authority,
            connection_generation: match self.protocol.as_ref() {
                Some(ProtocolState::Authority(authority)) => {
                    authority.context.connection_generation
                }
                Some(ProtocolState::Replica(replica)) => replica.authority_generation,
                None => ConnectionGeneration::ZERO,
            },
            payload: plan.payload,
        };

        match self.protocol.as_ref() {
            Some(ProtocolState::Authority(_)) => {
                match self.submit_authority_proposal(local, proposal) {
                    Ok(effects) => effects,
                    Err(reason) => self.enter_terminal(reason),
                }
            }
            Some(ProtocolState::Replica(_)) => match self.arm_replica_proposal(proposal) {
                Ok(effects) => effects,
                Err(reason) => self.enter_terminal(reason),
            },
            None => Vec::new(),
        }
    }

    fn menu_proposal_plan(&self, submission: &MenuSubmission) -> Option<MenuProposalPlan> {
        let plans = match self.protocol.as_ref()? {
            ProtocolState::Authority(authority) => &authority.menu_plans,
            ProtocolState::Replica(replica) => &replica.menu_plans,
        };
        plans.iter().find_map(|plan| {
            let (kind, control_id, owner_seat_id, operation_id) = match plan {
                ControlMenuPlan::Command {
                    control_id,
                    owner_seat_id,
                    operation_id,
                    ..
                } => (
                    MenuSubmissionKind::Command,
                    control_id,
                    owner_seat_id,
                    operation_id,
                ),
                ControlMenuPlan::Replacement {
                    control_id,
                    owner_seat_id,
                    operation_id,
                    ..
                } => (
                    MenuSubmissionKind::Replacement,
                    control_id,
                    owner_seat_id,
                    operation_id,
                ),
                ControlMenuPlan::Interaction {
                    control_id,
                    owner_seat_id,
                    operation_id,
                    ..
                } => (
                    MenuSubmissionKind::Interaction,
                    control_id,
                    owner_seat_id,
                    operation_id,
                ),
            };
            (kind == submission.kind
                && control_id == &submission.control_id
                && *owner_seat_id == submission.seat
                && operation_id == &submission.operation_id)
                .then(|| match plan {
                    ControlMenuPlan::Command { proposals, .. }
                    | ControlMenuPlan::Replacement { proposals, .. }
                    | ControlMenuPlan::Interaction { proposals, .. } => proposals
                        .iter()
                        .find(|proposal| proposal.option_id == submission.option_id)
                        .cloned(),
                })
                .flatten()
        })
    }

    fn arm_replica_proposal(
        &mut self,
        proposal: ProposalMessage,
    ) -> Result<Vec<KernelEffect>, String> {
        let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
            return Ok(Vec::new());
        };
        if proposal.from != replica.context.sender_seat_id
            || proposal.to != replica.authority_seat_id
            || proposal.connection_generation != replica.authority_generation
        {
            return Ok(Vec::new());
        }
        let outcome = replica
            .leases
            .arm(
                ProposalLeaseSpec {
                    proposal,
                    absolute_ceiling_ms: None,
                },
                &mut self.scheduler,
            )
            .map_err(|error| format!("proposal lease arm failed: {error}"))?;
        let effects = match outcome.result {
            ProposalLeaseStart::Retained | ProposalLeaseStart::AlreadyRetained => {
                self.map_proposal_actions(outcome.actions)
            }
            ProposalLeaseStart::AlreadyCommitted => Vec::new(),
            ProposalLeaseStart::Conflict
            | ProposalLeaseStart::Invalid
            | ProposalLeaseStart::Disposed => {
                self.enter_terminal(format!("proposal lease rejected with {:?}", outcome.result))
            }
        };
        Ok(effects)
    }

    fn submit_authority_proposal(
        &mut self,
        endpoint: SeatId,
        proposal: ProposalMessage,
    ) -> Result<Vec<KernelEffect>, String> {
        let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() else {
            return Ok(Vec::new());
        };
        if endpoint != authority.context.sender_seat_id
            || proposal.to != authority.context.sender_seat_id
        {
            return Ok(Vec::new());
        }
        let local_submission = proposal.from == authority.context.sender_seat_id;
        if local_submission
            && proposal.connection_generation != authority.context.connection_generation
        {
            return Ok(Vec::new());
        }
        let bound_peer = authority.peer_bindings.iter().any(|binding| {
            binding.seat_id == proposal.from
                && binding.connection_generation == proposal.connection_generation
        });
        if !local_submission && !bound_peer {
            return Ok(Vec::new());
        }
        if authority.pending_material.is_some()
            || authority.pending_control.is_some()
            || authority.authority_rebind_pending
        {
            return Ok(Vec::new());
        }

        let authority_context = authority.context.clone();
        let draft = {
            let Some(resolution) = authority.resolutions.iter_mut().find(|resolution| {
                resolution.operation_id == proposal.operation_id
                    && resolution.fingerprint == proposal.fingerprint
            }) else {
                return Err(format!(
                    "no exact authority resolution for {}",
                    proposal.operation_id
                ));
            };
            resolution.draft.context = authority_context;
            resolution.draft.clone()
        };
        let identity = ProposalIdentity {
            operation_id: proposal.operation_id.clone(),
            fingerprint: proposal.fingerprint.clone(),
        };
        match authority.proposals.admit(&identity) {
            ProposalAdmission::Admitted => {}
            ProposalAdmission::Duplicate => return Ok(Vec::new()),
            ProposalAdmission::Conflict
            | ProposalAdmission::Invalid
            | ProposalAdmission::CapacityExhausted => {
                return Err(format!(
                    "authority proposal admission rejected for {}",
                    proposal.operation_id
                ));
            }
        }

        let outcome = authority
            .log
            .commit(draft, &mut self.scheduler)
            .map_err(|error| format!("authority proposal commit failed: {error}"))?;
        Ok(self.map_authority_commit(outcome))
    }

    fn map_authority_commit(&mut self, outcome: er_protocol::CommitOutcome) -> Vec<KernelEffect> {
        let entry = outcome.entry;
        self.set_pending_authority_entry(entry.clone());
        let mut effects = self.map_authority_actions(outcome.actions);
        if self.terminal.is_some() {
            return effects;
        }
        let apply = KernelEffect::ApplyAuthorityMaterial {
            endpoint: entry.context.sender_seat_id,
            revision: entry.revision,
            operation_id: entry.operation_id,
            material: entry.material,
        };
        let insertion = match effects
            .iter()
            .position(|effect| matches!(effect, KernelEffect::SendFrame { .. }))
        {
            Some(insertion) => insertion,
            None => effects.len(),
        };
        effects.insert(insertion, apply);
        self.sync_live_resources();
        effects
    }

    fn dispatch_proposal(
        &mut self,
        endpoint: SeatId,
        proposal: ProposalMessage,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = match self.protocol.as_ref() {
            Some(ProtocolState::Authority(_)) => self
                .submit_authority_proposal(endpoint, proposal)
                .map_err(kernel_protocol_error)?,
            Some(ProtocolState::Replica(_)) | None => Vec::new(),
        };
        Ok(effects)
    }

    fn dispatch_network_frame(
        &mut self,
        endpoint: SeatId,
        frame: NetworkFrame,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let raw = RawFrame::JsonValue(json!({
            "v": frame.version,
            "t": frame.frame_type,
            "ctx": frame.context,
            "body": frame.body,
        }));
        self.dispatch_raw_network_frame(endpoint, raw)
    }

    fn dispatch_raw_network_frame(
        &mut self,
        endpoint: SeatId,
        frame: RawFrame,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        if self.protocol.is_none() && self.protocol_config.is_none() {
            return Ok(Vec::new());
        }
        let result = FrameValidator::new().validate(&frame);
        let mut effects = match result {
            InboundFrameResult::Valid { frame } => {
                self.dispatch_validated_frame(endpoint, *frame)?
            }
            InboundFrameResult::CosmeticDrop { .. } => Vec::new(),
            InboundFrameResult::ProtocolViolation { frame_type, issues } => {
                self.enter_terminal(format!(
                    "inbound frame protocol violation {:?}: {:?}",
                    frame_type, issues
                ))
            }
        };
        self.sync_live_resources();
        effects.shrink_to_fit();
        Ok(effects)
    }

    fn dispatch_validated_frame(
        &mut self,
        endpoint: SeatId,
        validated: ValidatedFrame,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let context = validated.frame.context;
        match validated.body {
            ValidatedFrameBody::AuthorityEntry(body) => {
                self.dispatch_authority_entry(endpoint, context, body)
            }
            ValidatedFrameBody::AuthorityReceipt(body) => {
                self.dispatch_authority_receipt(endpoint, context, body)
            }
            ValidatedFrameBody::TailRequest(body) => {
                self.dispatch_tail_request(endpoint, context, body)
            }
            ValidatedFrameBody::TailProof(body) => {
                self.dispatch_tail_proof(endpoint, context, body)
            }
            ValidatedFrameBody::RecoveryRequest(body) => {
                self.dispatch_recovery_request(endpoint, context, body)
            }
            ValidatedFrameBody::RecoveryBundle(body) => {
                self.dispatch_recovery_bundle(endpoint, context, body)
            }
            ValidatedFrameBody::RecoveryApplied(proof) => {
                self.dispatch_recovery_applied(endpoint, context, proof)
            }
            ValidatedFrameBody::Terminal(body) => self.dispatch_terminal(endpoint, context, body),
        }
    }

    fn dispatch_terminal(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: er_types::TerminalFrameBody,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let admitted = match self.protocol.as_ref() {
            Some(ProtocolState::Authority(authority)) => {
                authority_accepts_peer_frame(authority, endpoint, &context)
            }
            Some(ProtocolState::Replica(replica)) => {
                replica_accepts_authority_frame(replica, endpoint, &context)
            }
            None => false,
        };
        if admitted {
            Ok(self.enter_terminal_frame(body))
        } else {
            Ok(Vec::new())
        }
    }

    fn dispatch_authority_entry(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: AuthorityEntryBody,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
            return Ok(Vec::new());
        };
        if !replica_accepts_authority_frame(replica, endpoint, &context) {
            return Ok(Vec::new());
        }
        let entry = body.with_context(context);
        let operation_id = entry.operation_id.clone();
        let kind = entry.kind;
        let step = replica.replica.admit(entry);
        let duplicate_complete_probe = matches!(
            &step.admission,
            ReplicaAdmission::Duplicate {
                resume: ReplicaResume::ControlInstalled,
            }
        );
        let proposal_actions = if matches!(
            &step.admission,
            ReplicaAdmission::Admitted { .. } | ReplicaAdmission::Duplicate { .. }
        ) && kind == AuthorityEntryKind::InteractionCommit
        {
            let (_, actions) = replica
                .leases
                .observe_committed(&operation_id, &mut self.scheduler);
            actions
        } else {
            Vec::new()
        };
        let mut effects = match step.admission {
            ReplicaAdmission::Rejected { reason } => {
                self.enter_terminal(format!("authority entry rejected: {reason:?}"))
            }
            ReplicaAdmission::Admitted { .. }
            | ReplicaAdmission::Duplicate { .. }
            | ReplicaAdmission::Gap { .. } => Vec::new(),
        };
        effects.extend(self.map_proposal_actions(proposal_actions));
        effects.extend(
            self.map_replica_actions_with_probe_mode(step.actions, duplicate_complete_probe)?,
        );
        Ok(effects)
    }

    fn dispatch_authority_receipt(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: AuthorityReceiptBody,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() else {
            return Ok(Vec::new());
        };
        if !authority_accepts_peer_frame(authority, endpoint, &context) {
            return Ok(Vec::new());
        }
        let receipt = AuthorityReceipt {
            context,
            revision: body.revision,
            operation_id: body.operation_id,
            stage: body.stage,
            control_id: body.control_id,
        };
        let outcome = authority
            .log
            .accept_receipt_detailed(receipt, &mut self.scheduler);
        Ok(self.map_authority_actions(outcome.actions))
    }

    fn dispatch_tail_request(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: er_types::TailRequestBody,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() else {
            return Ok(Vec::new());
        };
        if !authority_accepts_peer_frame(authority, endpoint, &context) {
            return Ok(Vec::new());
        }
        if body.request_id.is_some() {
            let actions = authority.log.handle_tail_proof_request(context, body);
            return Ok(self.map_authority_actions(actions));
        }
        let captured = match previous_revision(body.from_revision) {
            Some(captured) => captured,
            None => Revision::ZERO,
        };
        let Some(slice) = authority.log.recovery_slice(captured) else {
            return Ok(Vec::new());
        };
        let from = authority.context.sender_seat_id;
        let effects = slice
            .required_tail
            .iter()
            .filter_map(|entry| {
                authority_entry_frame(entry)
                    .ok()
                    .map(|frame| KernelEffect::SendFrame { from, frame })
            })
            .collect();
        Ok(effects)
    }

    fn dispatch_tail_proof(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: TailProofBody,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let disposition = {
            let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                return Ok(Vec::new());
            };
            if !replica_accepts_authority_frame(replica, endpoint, &context) {
                return Ok(Vec::new());
            }
            replica.replica.accept_tail_proof(&context, &body)
        };
        match disposition {
            ReplicaTailProofDisposition::Ignored { .. } | ReplicaTailProofDisposition::Pending => {
                Ok(Vec::new())
            }
            ReplicaTailProofDisposition::Rejected { reason } => {
                Ok(self.enter_terminal(format!("tail proof rejected: {reason}")))
            }
            ReplicaTailProofDisposition::Completed { step } => {
                let duplicate_complete_probe = matches!(
                    &step.admission,
                    ReplicaAdmission::Duplicate {
                        resume: ReplicaResume::ControlInstalled,
                    }
                );
                match &step.admission {
                    ReplicaAdmission::Rejected { reason } => {
                        Ok(self
                            .enter_terminal(format!("tail proof candidate rejected: {reason:?}")))
                    }
                    ReplicaAdmission::Admitted { .. }
                    | ReplicaAdmission::Duplicate { .. }
                    | ReplicaAdmission::Gap { .. } => self.map_replica_actions_with_probe_mode(
                        step.actions,
                        duplicate_complete_probe,
                    ),
                }
            }
        }
    }

    fn dispatch_recovery_request(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: RecoveryRequestBody,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let mut duplicate_response = None;
        let mut conflict = false;
        let mut response = None;
        let from;
        {
            let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() else {
                return Ok(Vec::new());
            };
            if !authority_accepts_peer_frame(authority, endpoint, &context) {
                return Ok(Vec::new());
            }
            from = authority.context.sender_seat_id;
            if let Some(expected) = authority.pending_recoveries.get(&body.request_id) {
                let exact_request = expected.peer == context.sender_seat_id
                    && expected.context == context
                    && expected.connection_generation == context.connection_generation
                    && expected.captured_frontier == body.captured_frontier
                    && expected.reason == body.reason;
                if exact_request {
                    duplicate_response = Some(expected.response_frame.clone());
                } else {
                    conflict = true;
                }
            } else {
                let Some(slice) = authority.log.recovery_slice(body.captured_frontier) else {
                    return Ok(Vec::new());
                };
                let request_id = body.request_id.clone();
                let frame = recovery_bundle_frame(
                    &authority.context,
                    request_id.clone(),
                    authority.context.membership_revision,
                    &slice,
                )
                .map_err(kernel_protocol_error)?;
                response = Some(frame.clone());
                authority.pending_recoveries.insert(
                    request_id,
                    PendingRecoveryExpectation {
                        peer: context.sender_seat_id,
                        context: context.clone(),
                        connection_generation: context.connection_generation,
                        captured_frontier: body.captured_frontier,
                        reason: body.reason,
                        frontier: slice.frontier,
                        material_digest: recovery_material_digest(&slice),
                        control_id: slice.next_control.as_ref().map(control_id_of),
                        response_frame: frame,
                    },
                );
            }
        }
        if conflict {
            return Ok(self.enter_terminal(
                "recovery request identity conflicts with a live request".to_owned(),
            ));
        }
        if let Some(frame) = duplicate_response.or(response) {
            return Ok(vec![KernelEffect::SendFrame { from, frame }]);
        }
        Ok(Vec::new())
    }

    fn dispatch_recovery_applied(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        proof: RecoveryAppliedProof,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let mut mismatch = false;
        {
            let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() else {
                return Ok(Vec::new());
            };
            if !authority_accepts_peer_frame(authority, endpoint, &context) {
                return Ok(Vec::new());
            }
            let Some(expected) = authority.pending_recoveries.get(&proof.request_id) else {
                return Ok(Vec::new());
            };
            let exact = expected.peer == context.sender_seat_id
                && expected.connection_generation == context.connection_generation
                && expected.frontier == proof.frontier
                && expected.material_digest == proof.material_digest
                && expected.control_id == proof.control_id;
            if exact {
                authority.pending_recoveries.remove(&proof.request_id);
            } else {
                mismatch = true;
            }
        }
        if mismatch {
            Ok(self.enter_terminal(
                "recovery applied proof did not match its authenticated bundle".to_owned(),
            ))
        } else {
            Ok(Vec::new())
        }
    }

    fn dispatch_recovery_bundle(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: RecoveryBundleBody,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
            return Ok(Vec::new());
        };
        if !replica_accepts_authority_frame(replica, endpoint, &context) {
            return Ok(Vec::new());
        }
        let bundle = body.with_context(context);
        let live = RecoveryLiveState {
            frontier: replica.replica.frontier(),
            context: replica.recovery_context.clone(),
        };
        let actions = replica
            .recovery
            .accept_bundle(bundle.clone(), live, &mut self.scheduler)
            .map_err(kernel_protocol_error)?;
        replica.pending_recovery = Some(bundle);
        self.apply_recovery_actions(actions)
    }

    fn apply_recovery_actions(
        &mut self,
        actions: Vec<RecoveryAction>,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let mut effects = Vec::new();
        for action in actions {
            match action {
                RecoveryAction::FenceChanged { view } => {
                    if view.state == er_types::RecoveryFenceState::Terminal {
                        let reason = match view.terminal_reason {
                            Some(reason) => reason,
                            None => "recovery terminalized".to_owned(),
                        };
                        effects.extend(self.enter_terminal(reason));
                    } else if view.command_admission_frozen {
                        effects.extend(self.clear_input_effects());
                        let already_waiting = matches!(
                            self.ui_reducer.state().stack.last(),
                            Some(MenuState::Waiting(_))
                        );
                        if !already_waiting && self.terminal.is_none() {
                            self.ui_reducer.replace_menu(
                                None,
                                false,
                                MenuState::Waiting(WaitingMenu {
                                    prompt_key: Some("authority-v2.recovery".to_owned()),
                                }),
                            );
                            effects.push(KernelEffect::UiChanged {
                                endpoint: self.local_endpoint(),
                                view: self.ui_reducer.view(),
                            });
                        }
                    }
                }
                RecoveryAction::SendRequest { request } => {
                    let Some(ProtocolState::Replica(replica)) = self.protocol.as_ref() else {
                        continue;
                    };
                    let frame = recovery_request_frame(&replica.recovery_context, request)
                        .map_err(kernel_protocol_error)?;
                    effects.push(KernelEffect::SendFrame {
                        from: replica.recovery_context.sender_seat_id,
                        frame,
                    });
                }
                RecoveryAction::Scheduler { command } => {
                    if let Some(effect) = Self::map_scheduler_command(command) {
                        effects.push(effect);
                    }
                }
                RecoveryAction::ApplyMaterial {
                    request_id,
                    material,
                } => {
                    let Some((endpoint, frontier, operation_id)) = (|| {
                        let Some(ProtocolState::Replica(replica)) = self.protocol.as_ref() else {
                            return None;
                        };
                        let bundle = replica.pending_recovery.as_ref()?;
                        (bundle.request_id == request_id).then(|| {
                            (
                                replica.context.sender_seat_id,
                                bundle.frontier,
                                recovery_operation_id(bundle),
                            )
                        })
                    })() else {
                        effects.extend(self.enter_terminal(
                            "recovery material action has no matching retained bundle".to_owned(),
                        ));
                        continue;
                    };
                    let operation_id = operation_id?;
                    self.set_pending_material(frontier, operation_id.clone());
                    effects.push(KernelEffect::ApplyAuthorityMaterial {
                        endpoint,
                        revision: frontier,
                        operation_id,
                        material,
                    });
                }
                RecoveryAction::StageRecoveredFrontier { entry } => {
                    effects.extend(self.stage_recovered_frontier(entry)?);
                }
                RecoveryAction::ProjectControl {
                    revision,
                    control,
                    expected_control_id,
                } => {
                    let Some((endpoint, operation_id)) = (|| {
                        let Some(ProtocolState::Replica(replica)) = self.protocol.as_ref() else {
                            return None;
                        };
                        let bundle = replica.pending_recovery.as_ref()?;
                        Some((
                            replica.context.sender_seat_id,
                            recovery_operation_id(bundle),
                        ))
                    })() else {
                        effects.extend(self.enter_terminal(
                            "recovery control action has no retained bundle".to_owned(),
                        ));
                        continue;
                    };
                    let operation_id = operation_id?;
                    self.set_pending_control(PendingControl {
                        revision,
                        operation_id: operation_id.clone(),
                        control: control.clone(),
                        expected_control_id: expected_control_id.clone(),
                    });
                    effects.push(KernelEffect::ProjectAuthorityControl {
                        endpoint,
                        revision,
                        operation_id,
                        control,
                    });
                }
                RecoveryAction::SendAppliedProof { proof } => {
                    let Some(ProtocolState::Replica(replica)) = self.protocol.as_ref() else {
                        continue;
                    };
                    let frame = recovery_applied_frame(&replica.recovery_context, proof)
                        .map_err(kernel_protocol_error)?;
                    effects.push(KernelEffect::SendFrame {
                        from: replica.recovery_context.sender_seat_id,
                        frame,
                    });
                    if let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() {
                        replica.pending_recovery = None;
                        replica.pending_material = None;
                    }
                }
                RecoveryAction::Terminalize { reason } => {
                    effects.extend(self.enter_terminal(reason));
                    if let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() {
                        replica.pending_recovery = None;
                        replica.pending_material = None;
                        replica.pending_control = None;
                    }
                }
            }
        }
        self.sync_live_resources();
        Ok(effects)
    }

    fn stage_recovered_frontier(
        &mut self,
        entry: AuthorityEntry,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let actions = {
            let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                return Ok(Vec::new());
            };
            let staged = replica
                .replica
                .stage_recovered_frontier(entry.clone())
                .map_err(kernel_protocol_error)?;
            if !staged.iter().any(|action| {
                matches!(
                    action,
                    ReplicaAction::ProjectControl {
                        entry: staged_entry,
                        expected_control_id,
                    } if staged_entry == &entry
                        && expected_control_id == &control_id_of(&entry.next_control)
                )
            }) {
                return Err(kernel_protocol_error(
                    "recovery replica did not retain the exact staged AuthorityEntry",
                ));
            }
            let live = RecoveryLiveState {
                frontier: replica.replica.frontier(),
                context: replica.recovery_context.clone(),
            };
            replica
                .recovery
                .recovered_frontier_staged(
                    RecoveryFrontierStagingOutcome::Staged {
                        revision: entry.revision,
                    },
                    live,
                    &mut self.scheduler,
                )
                .map_err(kernel_protocol_error)?
        };
        self.apply_recovery_actions(actions)
    }

    fn dispatch_material(
        &mut self,
        endpoint: SeatId,
        revision: Revision,
        outcome: MaterialApplicationOutcome,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        if endpoint != self.local_endpoint() {
            return Ok(Vec::new());
        }
        let mut authority_project = None;
        let mut authority_rejection = None;
        if let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() {
            let Some(entry) = authority.pending_material.as_ref() else {
                return Ok(Vec::new());
            };
            if entry.revision != revision {
                return Ok(Vec::new());
            }
            match &outcome {
                MaterialApplicationOutcome::Applied => {
                    let entry = authority.pending_material.take().ok_or_else(|| {
                        kernel_protocol_error("authority material pending state disappeared")
                    })?;
                    let expected_control_id = control_id_of(&entry.next_control);
                    authority.pending_control = Some(PendingControl {
                        revision: entry.revision,
                        operation_id: entry.operation_id.clone(),
                        control: entry.next_control.clone(),
                        expected_control_id,
                    });
                    authority_project = Some((
                        authority.context.sender_seat_id,
                        entry.revision,
                        entry.operation_id,
                        entry.next_control,
                    ));
                }
                MaterialApplicationOutcome::Deferred => {}
                MaterialApplicationOutcome::Rejected { reason } => {
                    authority.pending_material = None;
                    authority.pending_control = None;
                    authority_rejection = Some(reason.clone());
                }
            }
        }
        if let Some(reason) = authority_rejection {
            return Ok(self.enter_terminal(reason));
        }
        if let Some((endpoint, revision, operation_id, control)) = authority_project {
            return Ok(vec![KernelEffect::ProjectAuthorityControl {
                endpoint,
                revision,
                operation_id,
                control,
            }]);
        }
        if self
            .protocol
            .as_ref()
            .is_some_and(|protocol| matches!(protocol, ProtocolState::Authority(_)))
        {
            return Ok(Vec::new());
        }
        let recovery_pending = matches!(
            self.protocol.as_ref(),
            Some(ProtocolState::Replica(replica))
                if replica.recovery.phase() == Some(RecoveryPhase::Validated)
                    && replica.pending_recovery.is_some()
        );
        if recovery_pending {
            let recovery_outcome = match &outcome {
                MaterialApplicationOutcome::Applied => RecoveryMaterialOutcome::Applied,
                MaterialApplicationOutcome::Deferred => RecoveryMaterialOutcome::Deferred,
                MaterialApplicationOutcome::Rejected { .. } => RecoveryMaterialOutcome::Rejected,
            };
            let actions = {
                let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                    return Ok(Vec::new());
                };
                if replica.pending_material.is_none()
                    || replica
                        .pending_material
                        .as_ref()
                        .is_some_and(|pending| pending.revision != revision)
                {
                    return Ok(Vec::new());
                }
                let live = RecoveryLiveState {
                    frontier: replica.replica.frontier(),
                    context: replica.recovery_context.clone(),
                };
                replica
                    .recovery
                    .material_result(recovery_outcome, live, &mut self.scheduler)
                    .map_err(kernel_protocol_error)?
            };
            let effects = self.apply_recovery_actions(actions)?;
            if !matches!(outcome, MaterialApplicationOutcome::Deferred)
                && let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut()
            {
                replica.pending_material = None;
            }
            return Ok(effects);
        }

        let actions = {
            let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                return Ok(Vec::new());
            };
            replica
                .replica
                .material_result(revision, outcome.clone())
                .map_err(kernel_protocol_error)?
        };
        let effects = self.map_replica_actions(actions)?;
        if !matches!(outcome, MaterialApplicationOutcome::Deferred)
            && let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut()
        {
            replica.pending_material = None;
        }
        Ok(effects)
    }

    fn dispatch_control(
        &mut self,
        endpoint: SeatId,
        revision: Revision,
        outcome: ControlProjectionOutcome,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        if endpoint != self.local_endpoint() {
            return Ok(Vec::new());
        }
        if self
            .protocol
            .as_ref()
            .is_some_and(|protocol| matches!(protocol, ProtocolState::Authority(_)))
        {
            let pending = match self.protocol.as_ref() {
                Some(ProtocolState::Authority(authority)) => authority.pending_control.clone(),
                _ => None,
            };
            let Some(pending) = pending else {
                return Ok(Vec::new());
            };
            if pending.revision != revision {
                return Ok(Vec::new());
            }
            match outcome {
                ControlProjectionOutcome::Installed { control_id }
                | ControlProjectionOutcome::AlreadyInstalled { control_id } => {
                    let control_mismatch = control_id != pending.expected_control_id;
                    if control_mismatch
                        && let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut()
                    {
                        authority.pending_control = None;
                    }
                    if control_mismatch {
                        return Ok(self.enter_terminal(format!(
                            "authority control projection proved {control_id}, expected {}",
                            pending.expected_control_id
                        )));
                    }
                    if let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() {
                        authority.pending_control = None;
                    }
                    return Ok(self.install_control(pending));
                }
                ControlProjectionOutcome::Deferred => return Ok(Vec::new()),
                ControlProjectionOutcome::Rejected { reason } => {
                    if let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() {
                        authority.pending_control = None;
                    }
                    return Ok(self.enter_terminal(reason));
                }
            }
        }
        let recovery_pending = matches!(
            self.protocol.as_ref(),
            Some(ProtocolState::Replica(replica))
                if replica.recovery.phase() == Some(RecoveryPhase::FrontierInstalled)
                    && replica.pending_recovery.is_some()
        );
        let successful = matches!(
            &outcome,
            ControlProjectionOutcome::Installed { .. }
                | ControlProjectionOutcome::AlreadyInstalled { .. }
        );
        if recovery_pending {
            let (replica_actions, recovery_actions) = {
                let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                    return Ok(Vec::new());
                };
                if replica.pending_control.is_none()
                    || replica
                        .pending_control
                        .as_ref()
                        .is_some_and(|pending| pending.revision != revision)
                {
                    return Ok(Vec::new());
                }
                let replica_actions = replica
                    .replica
                    .control_result(revision, outcome.clone())
                    .map_err(kernel_protocol_error)?;
                let live = RecoveryLiveState {
                    frontier: replica.replica.frontier(),
                    context: replica.recovery_context.clone(),
                };
                let recovery_actions = replica
                    .recovery
                    .control_result(outcome.clone(), live, &mut self.scheduler)
                    .map_err(kernel_protocol_error)?;
                (replica_actions, recovery_actions)
            };
            // The replica's exact controlInstalled receipt is mechanical
            // evidence for the installed control and must precede the
            // correlated recoveryApplied proof. Recovery actions retain their
            // own proof-before-fence-release order, and the menu is exposed
            // only after both batches have been mapped.
            let mut effects = self.map_replica_actions(replica_actions)?;
            if self.terminal.is_some() {
                return Ok(effects);
            }
            effects.extend(self.apply_recovery_actions(recovery_actions)?);
            if self.terminal.is_some() {
                return Ok(effects);
            }
            if successful {
                effects.extend(self.install_pending_control());
            }
            if (successful || matches!(&outcome, ControlProjectionOutcome::Rejected { .. }))
                && let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut()
            {
                replica.pending_control = None;
            }
            return Ok(effects);
        }

        let actions = {
            let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                return Ok(Vec::new());
            };
            replica
                .replica
                .control_result(revision, outcome.clone())
                .map_err(kernel_protocol_error)?
        };
        let mut effects = self.map_replica_actions(actions)?;
        if self.terminal.is_some() {
            return Ok(effects);
        }
        if successful {
            effects.extend(self.install_pending_control());
        }
        if (successful || matches!(&outcome, ControlProjectionOutcome::Rejected { .. }))
            && let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut()
        {
            replica.pending_control = None;
        }
        Ok(effects)
    }

    fn dispatch_presentation(
        &mut self,
        endpoint: SeatId,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        if endpoint != self.local_endpoint() {
            return Ok(Vec::new());
        }
        let Some(evidence) = self.pending_presentations.remove(&event_id) else {
            return Ok(Vec::new());
        };
        let probe = match &outcome {
            PresentationOutcome::Settled => PresentationProbeOutcome::Settled,
            PresentationOutcome::Cancelled | PresentationOutcome::Failed { .. } => {
                PresentationProbeOutcome::Failed
            }
        };
        let actions = {
            let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() else {
                return Ok(Vec::new());
            };
            replica
                .replica
                .presentation_result(evidence.revision, probe)
                .map_err(kernel_protocol_error)?
        };
        self.completed_presentations.insert(
            event_id,
            LegacyPresentationCompletionEvidence {
                presentation: evidence,
                outcome: probe,
            },
        );
        self.map_replica_actions(actions)
    }

    fn dispatch_suspend(
        &mut self,
        endpoint: SeatId,
        suspended: bool,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        if !self.protocol_endpoint_known(endpoint) {
            return Ok(Vec::new());
        }
        let commands = self
            .scheduler
            .set_suspended(endpoint, suspended)
            .map_err(kernel_protocol_error)?;
        Ok(Self::map_scheduler_commands(commands))
    }

    fn dispatch_transport(
        &mut self,
        endpoint: SeatId,
        state: TransportState,
        generation: ConnectionGeneration,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let Some(current_generation) = self.protocol_endpoint_generation(endpoint) else {
            return Ok(Vec::new());
        };
        if generation < current_generation {
            return Ok(Vec::new());
        }
        if generation == current_generation && self.protocol_endpoint_state(endpoint) == Some(state)
        {
            return Ok(Vec::new());
        }
        let mut effects = if state == TransportState::Disconnected {
            self.clear_input_effects()
        } else {
            Vec::new()
        };
        let connected = state == TransportState::Connected;
        effects.extend(Self::map_scheduler_commands(
            self.scheduler
                .set_connected(endpoint, connected)
                .map_err(kernel_protocol_error)?,
        ));
        let mut authority_actions = Vec::new();
        let mut proposal_actions = Vec::new();
        let mut recovery_cleanup_actions = Vec::new();
        let mut recovery_actions = Vec::new();
        let mut clear_presentations = false;
        match self.protocol.as_mut() {
            Some(ProtocolState::Authority(authority)) => {
                let generation_changed = generation > current_generation;
                let local = authority.context.sender_seat_id;
                authority.transports.insert(endpoint, state);
                if endpoint == local && generation_changed {
                    authority.context.connection_generation = generation;
                    authority.authority_rebind_pending = true;
                    // Every cached bundle embeds the authority's exact response
                    // context, so a local generation change invalidates all of
                    // them before any new-generation traffic is admitted.
                    authority.pending_recoveries.clear();
                } else if endpoint != local && generation_changed {
                    if let Some(binding) = authority
                        .peer_bindings
                        .iter_mut()
                        .find(|binding| binding.seat_id == endpoint)
                    {
                        binding.connection_generation = generation;
                    }
                    authority
                        .pending_recoveries
                        .retain(|_, expected| expected.peer != endpoint);
                    authority.authority_rebind_pending = true;
                    authority.staged_peer_rebinds.insert(endpoint, generation);
                }

                let staged_peer_connected = endpoint != local
                    && connected
                    && authority.staged_peer_rebinds.get(&endpoint) == Some(&generation);
                if staged_peer_connected {
                    authority_actions = authority
                        .log
                        .rebind_connection(
                            authority.context.clone(),
                            authority.peer_bindings.clone(),
                        )
                        .map_err(kernel_protocol_error)?
                        .actions;
                    authority.staged_peer_rebinds.remove(&endpoint);
                    authority.authority_rebind_pending = !authority.staged_peer_rebinds.is_empty();
                    if let Some(entry) = authority.pending_material.as_mut() {
                        entry.context = authority.context.clone();
                    }
                }
            }
            Some(ProtocolState::Replica(replica)) => {
                let local = replica.context.sender_seat_id;
                let authority_seat_id = replica.authority_seat_id;
                let generation_changed = generation > current_generation;
                replica.transports.insert(endpoint, state);
                if endpoint == local && generation_changed {
                    replica.context.connection_generation = generation;
                    replica.recovery_context.connection_generation = generation;
                    replica.recovery_config.local_context = replica.recovery_context.clone();
                }
                if endpoint == authority_seat_id && generation_changed {
                    replica.authority_generation = generation;
                    replica.staged_authority_rebind = Some(generation);
                }

                let authority_link_connected = endpoint == authority_seat_id
                    && connected
                    && replica.staged_authority_rebind == Some(generation);
                if authority_link_connected {
                    replica
                        .replica
                        .rebind_connection(replica.context.clone(), replica.authority_generation)
                        .map_err(kernel_protocol_error)?;
                    proposal_actions = replica
                        .leases
                        .rebind(authority_seat_id, replica.authority_generation)
                        .map_err(kernel_protocol_error)?
                        .1;

                    let mut next_recovery =
                        RecoveryTransaction::new(replica.recovery_config.clone())
                            .map_err(kernel_protocol_error)?;
                    if replica.recovery.phase().is_some() {
                        recovery_cleanup_actions = replica
                            .recovery
                            .dispose("superseded transport generation", &mut self.scheduler);
                    }
                    clear_presentations = true;
                    replica.pending_recovery = None;
                    replica.pending_material = None;
                    replica.pending_control = None;
                    let captured = replica.replica.frontier();
                    let request_id =
                        format!("recovery-{}", replica.authority_generation.get().get());
                    recovery_actions = next_recovery
                        .start(
                            request_id,
                            captured,
                            "transport-reconnect".to_owned(),
                            &mut self.scheduler,
                        )
                        .map_err(kernel_protocol_error)?;
                    replica.recovery = next_recovery;
                    replica.staged_authority_rebind = None;
                }
            }
            None => {}
        }
        if clear_presentations {
            self.pending_presentations.clear();
        }
        effects.extend(self.map_authority_actions(authority_actions));
        effects.extend(Self::map_rebind_recovery_cleanup(recovery_cleanup_actions)?);
        effects.extend(self.map_proposal_actions(proposal_actions));
        effects.extend(self.apply_recovery_actions(recovery_actions)?);
        self.sync_live_resources();
        Ok(effects)
    }

    fn install_pending_control(&mut self) -> Vec<KernelEffect> {
        let pending = match self.protocol.as_ref() {
            Some(ProtocolState::Authority(authority)) => authority.pending_control.clone(),
            Some(ProtocolState::Replica(replica)) => replica.pending_control.clone(),
            None => None,
        };
        let Some(pending) = pending else {
            return self.enter_terminal(
                "control projection completed without a pending control".to_owned(),
            );
        };
        self.install_control(pending)
    }

    fn install_control(&mut self, pending: PendingControl) -> Vec<KernelEffect> {
        let actual_control_id = control_id_of(&pending.control);
        if actual_control_id != pending.expected_control_id {
            return self.enter_terminal(format!(
                "control identity mismatch: expected {}, got {}",
                pending.expected_control_id, actual_control_id
            ));
        }
        let menu = match &pending.control {
            NextControl::AwaitSuccessor(control) => Some((
                None,
                false,
                MenuState::Waiting(WaitingMenu {
                    prompt_key: Some(format!("await/{}", control.after_operation_id)),
                }),
            )),
            NextControl::Terminal(control) => {
                return self.enter_terminal_control(control.terminal_id.clone());
            }
            NextControl::CommandFrontier(control) => {
                match self.find_command_plan(&pending, control) {
                    Some(CommandPlan::EmptyLocalPartition) => Some((None, false, MenuState::None)),
                    Some(CommandPlan::Exact {
                        owner,
                        operation_id,
                        options,
                        cancel,
                    }) => Some((
                        Some(owner),
                        true,
                        MenuState::Command(CommandMenu {
                            operation_id,
                            control_id: actual_control_id.clone(),
                            cursor: SafeU53::ZERO,
                            options,
                            cancel,
                        }),
                    )),
                    None => None,
                }
            }
            NextControl::Replacement(control) => self.find_replacement_plan(&pending, control).map(
                |(owner, operation_id, field_index, options, cancel)| {
                    (
                        Some(owner),
                        true,
                        MenuState::Replacement(ReplacementMenu {
                            operation_id,
                            control_id: actual_control_id.clone(),
                            field_index,
                            cursor: SafeU53::ZERO,
                            options,
                            cancel,
                        }),
                    )
                },
            ),
            NextControl::SharedInteraction(control) => {
                self.find_interaction_plan(&pending, control).map(
                    |(owner, operation_id, surface_class, operation_kind, options, cancel)| {
                        (
                            Some(owner),
                            true,
                            MenuState::Interaction(InteractionMenu {
                                operation_id,
                                control_id: actual_control_id.clone(),
                                surface_class,
                                operation_kind,
                                choice: ChoiceListMenu {
                                    cursor: SafeU53::ZERO,
                                    page: SafeU53::ZERO,
                                    wrap: false,
                                    options,
                                    cancel,
                                },
                            }),
                        )
                    },
                )
            }
        };
        let Some((owner, actionable, menu)) = menu else {
            return self.enter_terminal(format!(
                "missing exact control menu plan for {actual_control_id}"
            ));
        };
        self.ui_reducer.replace_menu(owner, actionable, menu);
        vec![KernelEffect::UiChanged {
            endpoint: self.local_endpoint(),
            view: self.ui_reducer.view(),
        }]
    }

    fn find_command_plan(
        &self,
        pending: &PendingControl,
        control: &er_types::CommandFrontierControl,
    ) -> Option<CommandPlan> {
        let local_endpoint = self.local_endpoint();
        let plans = match self.protocol.as_ref()? {
            ProtocolState::Authority(authority) => &authority.menu_plans,
            ProtocolState::Replica(replica) => &replica.menu_plans,
        };
        let Some(target) = control
            .commands
            .iter()
            .filter(|target| target.owner_seat_id == local_endpoint)
            .min_by(|left, right| {
                left.field_index
                    .cmp(&right.field_index)
                    .then_with(|| left.owner_seat_id.cmp(&right.owner_seat_id))
                    .then_with(|| left.pokemon_id.cmp(&right.pokemon_id))
            })
        else {
            return Some(CommandPlan::EmptyLocalPartition);
        };
        let matches = plans.iter().filter_map(|plan| {
            let ControlMenuPlan::Command {
                control_id,
                owner_seat_id,
                operation_id,
                field_index,
                options,
                cancel,
                ..
            } = plan
            else {
                return None;
            };
            let selected_target =
                target.owner_seat_id == *owner_seat_id && target.field_index == *field_index;
            (control_id == &pending.expected_control_id && selected_target).then(|| {
                (
                    *owner_seat_id,
                    operation_id.clone(),
                    options.clone(),
                    cancel.clone(),
                )
            })
        });
        let mut matches = matches.collect::<Vec<_>>();
        if matches.len() == 1 {
            matches.pop().map(
                |(owner, operation_id, options, cancel)| CommandPlan::Exact {
                    owner,
                    operation_id,
                    options,
                    cancel,
                },
            )
        } else {
            None
        }
    }

    fn find_replacement_plan(
        &self,
        pending: &PendingControl,
        control: &er_types::ReplacementControl,
    ) -> Option<(SeatId, OperationId, SafeU53, Vec<MenuOption>, CancelPolicy)> {
        let plans = match self.protocol.as_ref()? {
            ProtocolState::Authority(authority) => &authority.menu_plans,
            ProtocolState::Replica(replica) => &replica.menu_plans,
        };
        let matches = plans.iter().filter_map(|plan| {
            let ControlMenuPlan::Replacement {
                control_id,
                owner_seat_id,
                operation_id,
                field_index,
                options,
                cancel,
                ..
            } = plan
            else {
                return None;
            };
            (control_id == &pending.expected_control_id
                && operation_id == &control.operation_id
                && *owner_seat_id == control.owner_seat_id
                && *field_index == control.field_index)
                .then(|| {
                    (
                        *owner_seat_id,
                        operation_id.clone(),
                        *field_index,
                        options.clone(),
                        cancel.clone(),
                    )
                })
        });
        let mut matches = matches.collect::<Vec<_>>();
        if matches.len() == 1 {
            matches.pop()
        } else {
            None
        }
    }

    fn find_interaction_plan(
        &self,
        pending: &PendingControl,
        control: &er_types::SharedInteractionControl,
    ) -> Option<(
        SeatId,
        OperationId,
        String,
        String,
        Vec<MenuOption>,
        CancelPolicy,
    )> {
        let plans = match self.protocol.as_ref()? {
            ProtocolState::Authority(authority) => &authority.menu_plans,
            ProtocolState::Replica(replica) => &replica.menu_plans,
        };
        let matches = plans.iter().filter_map(|plan| {
            let ControlMenuPlan::Interaction {
                control_id,
                owner_seat_id,
                operation_id,
                surface_class,
                operation_kind,
                options,
                cancel,
                ..
            } = plan
            else {
                return None;
            };
            (control_id == &pending.expected_control_id
                && operation_id == &control.operation_id
                && *owner_seat_id == control.owner_seat_id
                && surface_class == &control.surface_class
                && operation_kind == &control.operation_kind)
                .then(|| {
                    (
                        *owner_seat_id,
                        operation_id.clone(),
                        surface_class.clone(),
                        operation_kind.clone(),
                        options.clone(),
                        cancel.clone(),
                    )
                })
        });
        let mut matches = matches.collect::<Vec<_>>();
        if matches.len() == 1 {
            matches.pop()
        } else {
            None
        }
    }

    fn clear_input_effects(&mut self) -> Vec<KernelEffect> {
        let contexts = self.repeat_timers.clone();
        let output = self.input_router.clear(&mut self.scheduler);
        let mut effects = Vec::new();
        for timer in output.timers {
            if let InputTimerCommand::Cancel { timer_id } = timer
                && let Some(context) = contexts.get(&timer_id)
            {
                effects.push(KernelEffect::CancelTimer {
                    endpoint: context.endpoint,
                    timer_id,
                });
            }
        }
        self.repeat_timers.clear();
        self.sync_live_timers();
        effects
    }

    fn protocol_endpoint_known(&self, endpoint: SeatId) -> bool {
        self.protocol_endpoint_state(endpoint).is_some()
    }

    fn protocol_endpoint_state(&self, endpoint: SeatId) -> Option<TransportState> {
        match self.protocol.as_ref()? {
            ProtocolState::Authority(authority) => authority.transports.get(&endpoint).copied(),
            ProtocolState::Replica(replica) => replica.transports.get(&endpoint).copied(),
        }
    }

    fn protocol_endpoint_generation(&self, endpoint: SeatId) -> Option<ConnectionGeneration> {
        match self.protocol.as_ref()? {
            ProtocolState::Authority(authority) => {
                if endpoint == authority.context.sender_seat_id {
                    Some(authority.context.connection_generation)
                } else {
                    authority
                        .peer_bindings
                        .iter()
                        .find(|binding| binding.seat_id == endpoint)
                        .map(|binding| binding.connection_generation)
                }
            }
            ProtocolState::Replica(replica) => {
                if endpoint == replica.authority_seat_id {
                    Some(replica.authority_generation)
                } else if endpoint == replica.context.sender_seat_id {
                    Some(replica.context.connection_generation)
                } else {
                    None
                }
            }
        }
    }

    fn map_scheduler_commands(commands: Vec<SchedulerCommand>) -> Vec<KernelEffect> {
        commands
            .into_iter()
            .filter_map(Self::map_scheduler_command)
            .collect()
    }

    fn map_rebind_recovery_cleanup(
        actions: Vec<RecoveryAction>,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let mut effects = Vec::new();
        for action in actions {
            match action {
                RecoveryAction::Scheduler { command } => {
                    if let Some(effect) = Self::map_scheduler_command(command) {
                        effects.push(effect);
                    }
                }
                RecoveryAction::FenceChanged { .. } | RecoveryAction::Terminalize { .. } => {}
                RecoveryAction::SendRequest { .. }
                | RecoveryAction::ApplyMaterial { .. }
                | RecoveryAction::StageRecoveredFrontier { .. }
                | RecoveryAction::ProjectControl { .. }
                | RecoveryAction::SendAppliedProof { .. } => {
                    return Err(kernel_protocol_error(
                        "superseded recovery emitted non-cleanup work during rebind",
                    ));
                }
            }
        }
        Ok(effects)
    }

    fn enter_terminal(&mut self, reason: String) -> Vec<KernelEffect> {
        let reason = if reason.is_empty() {
            "authority-v2 terminal".to_owned()
        } else {
            reason
        };
        self.enter_terminal_state(TerminalState {
            terminal_id: "authority-v2-terminal".to_owned(),
            reason,
        })
    }

    fn enter_terminal_frame(&mut self, body: TerminalFrameBody) -> Vec<KernelEffect> {
        self.enter_terminal_state(TerminalState {
            terminal_id: body.terminal_id,
            reason: body.reason,
        })
    }

    fn enter_terminal_control(&mut self, terminal_id: String) -> Vec<KernelEffect> {
        self.enter_terminal_state(TerminalState {
            reason: format!("terminal control {terminal_id}"),
            terminal_id,
        })
    }

    fn enter_terminal_state(&mut self, terminal: TerminalState) -> Vec<KernelEffect> {
        if self.terminal.is_some() {
            return Vec::new();
        }
        self.terminal = Some(terminal.clone());
        let mut effects = self.clear_input_effects();
        let protocol_batches = if let Some(protocol) = self.protocol.as_mut() {
            match protocol {
                ProtocolState::Authority(authority) => vec![ProtocolActionBatch::Authority(
                    authority.log.dispose(&terminal.reason, &mut self.scheduler),
                )],
                ProtocolState::Replica(replica) => vec![
                    ProtocolActionBatch::Recovery(
                        replica
                            .recovery
                            .dispose(&terminal.reason, &mut self.scheduler),
                    ),
                    ProtocolActionBatch::Proposal(
                        replica
                            .leases
                            .dispose(&terminal.reason, &mut self.scheduler),
                    ),
                ],
            }
        } else {
            Vec::new()
        };
        for batch in protocol_batches {
            match batch {
                ProtocolActionBatch::Authority(actions) => {
                    effects.extend(self.map_authority_actions(actions));
                }
                ProtocolActionBatch::Proposal(actions) => {
                    effects.extend(self.map_proposal_actions(actions));
                }
                ProtocolActionBatch::Recovery(actions) => {
                    if let Ok(mapped) = self.apply_recovery_actions(actions) {
                        effects.extend(mapped);
                    }
                }
            }
        }
        if let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() {
            authority.proposals.dispose();
        }
        if let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() {
            replica.replica.dispose(&terminal.reason);
        }
        match self.protocol.as_mut() {
            Some(ProtocolState::Authority(authority)) => {
                authority.pending_material = None;
                authority.pending_control = None;
                authority.pending_recoveries.clear();
                authority.authority_rebind_pending = false;
                authority.staged_peer_rebinds.clear();
            }
            Some(ProtocolState::Replica(replica)) => {
                replica.pending_material = None;
                replica.pending_control = None;
                replica.pending_recovery = None;
                replica.staged_authority_rebind = None;
            }
            None => {}
        }
        for command in self.scheduler.dispose() {
            if let SchedulerCommand::Cancel { endpoint, timer_id } = command {
                effects.push(KernelEffect::CancelTimer { endpoint, timer_id });
            }
        }
        self.pending_presentations.clear();
        self.completed_presentations.clear();
        self.live_resources = LiveResourceSnapshot::default();
        self.ui_reducer.replace_menu(
            None,
            false,
            MenuState::Terminal(TerminalMenu {
                terminal_id: terminal.terminal_id.clone(),
                prompt_key: Some(terminal.reason.clone()),
            }),
        );
        effects.push(KernelEffect::UiChanged {
            endpoint: self.local_endpoint(),
            view: self.ui_reducer.view(),
        });
        effects.push(KernelEffect::EnterSharedTerminal {
            terminal: terminal.clone(),
        });
        effects
    }

    fn protocol_snapshot(&self) -> Value {
        let Some(protocol_state) = self.protocol.as_ref() else {
            // Preserve the frozen M1/native-Wasm snapshot shape for kernels
            // without protocol composition: KernelSnapshot::default().state
            // is the empty object, not a protocol diagnostic envelope.
            if self.protocol_config.is_none() {
                return Value::Object(serde_json::Map::new());
            }
            return json!({
                "protocol": Value::Null,
                "terminal": self.terminal,
                "liveResources": self.live_resources,
                "initError": self.protocol_init_error,
            });
        };
        let protocol = match protocol_state {
            ProtocolState::Authority(authority) => json!({
                "role": "authority",
                "context": authority.context,
                "peerBindings": authority.peer_bindings,
                "transports": authority.transports,
                "log": authority.log.diagnostics(),
                "proposals": authority.proposals.diagnostics(),
                "pendingMaterial": authority.pending_material,
                "pendingControl": pending_control_snapshot(authority.pending_control.as_ref()),
                "pendingRecoveries": pending_recoveries_snapshot(&authority.pending_recoveries),
                "authorityRebindPending": authority.authority_rebind_pending,
                "stagedPeerRebinds": authority.staged_peer_rebinds,
            }),
            ProtocolState::Replica(replica) => json!({
                "role": "replica",
                "context": replica.context,
                "authoritySeatId": replica.authority_seat_id,
                "authorityGeneration": replica.authority_generation,
                "transports": replica.transports,
                "replica": replica.replica.diagnostics(),
                "leases": replica.leases.diagnostics(),
                "recovery": replica.recovery.diagnostics(),
                "recoveryFence": replica.recovery.fence_view(),
                "pendingMaterial": pending_material_snapshot(replica.pending_material.as_ref()),
                "pendingControl": pending_control_snapshot(replica.pending_control.as_ref()),
                "pendingRecovery": replica.pending_recovery,
                "stagedAuthorityRebind": replica.staged_authority_rebind,
            }),
        };
        let mut snapshot = json!({
            "protocol": protocol,
            "terminal": self.terminal,
            "liveResources": self.live_resources,
            "initError": self.protocol_init_error,
        });
        // Keep the optional R9 projection out of an empty M2 snapshot so its
        // canonical bytes remain unchanged until presentation evidence exists.
        if let Some(legacy_presentations) = legacy_presentations_snapshot(
            &self.pending_presentations,
            &self.completed_presentations,
        ) && let Value::Object(fields) = &mut snapshot
        {
            fields.insert("legacyPresentations".to_owned(), legacy_presentations);
        }
        snapshot
    }

    fn sync_live_resources(&mut self) {
        if let Some(battle) = self.battle.as_ref() {
            self.live_resources = battle.live_resources(&self.scheduler);
            return;
        }
        self.sync_live_timers();
        self.live_resources.presentations = self.pending_presentations.keys().copied().collect();
        self.live_resources.storage_requests.clear();
        self.live_resources.network_packets.clear();
        self.live_resources.delivery_leases.clear();
        self.live_resources.proposal_leases.clear();
        self.live_resources.recovery_transactions.clear();
        self.live_resources.waits.clear();
        self.live_resources.retained_revisions.clear();
        self.live_resources.controls.clear();

        match self.protocol.as_ref() {
            Some(ProtocolState::Authority(authority)) => {
                let diagnostics = authority.log.diagnostics();
                self.live_resources.delivery_leases = diagnostics.delivery_owner_ids;
                self.live_resources.retained_revisions = diagnostics.retained_revisions;
                self.live_resources.recovery_transactions =
                    authority.pending_recoveries.keys().cloned().collect();
            }
            Some(ProtocolState::Replica(replica)) => {
                let lease_diagnostics = replica.leases.diagnostics();
                self.live_resources.proposal_leases = lease_diagnostics.live_operation_ids;
                let recovery_diagnostics = replica.recovery.diagnostics();
                if let Some(request_id) = recovery_diagnostics.request_id
                    && !matches!(
                        recovery_diagnostics.phase,
                        Some(RecoveryPhase::Released | RecoveryPhase::Terminalized)
                    )
                {
                    self.live_resources.recovery_transactions.insert(request_id);
                }
            }
            None => {}
        }
        if self.protocol.is_none() {
            return;
        }
        if let Some(menu) = self.ui_reducer.state().stack.last() {
            match menu {
                MenuState::Waiting(waiting) => {
                    let wait = match waiting.prompt_key.clone() {
                        Some(prompt) => prompt,
                        None => "waiting".to_owned(),
                    };
                    self.live_resources.waits.insert(wait);
                }
                MenuState::Command(command) => {
                    self.live_resources
                        .controls
                        .insert(command.control_id.clone());
                }
                MenuState::Replacement(replacement) => {
                    self.live_resources
                        .controls
                        .insert(replacement.control_id.clone());
                }
                MenuState::Interaction(interaction) => {
                    self.live_resources
                        .controls
                        .insert(interaction.control_id.clone());
                }
                MenuState::None
                | MenuState::Message(_)
                | MenuState::Confirm(_)
                | MenuState::ChoiceList(_)
                | MenuState::Terminal(_) => {}
            }
        }
    }

    fn set_pending_material(&mut self, revision: Revision, operation_id: OperationId) {
        if let Some(ProtocolState::Replica(replica)) = self.protocol.as_mut() {
            replica.pending_material = Some(PendingMaterial {
                revision,
                operation_id,
            });
        }
    }

    fn set_pending_authority_entry(&mut self, entry: AuthorityEntry) {
        if let Some(ProtocolState::Authority(authority)) = self.protocol.as_mut() {
            authority.pending_material = Some(entry);
        }
    }

    fn set_pending_control(&mut self, pending: PendingControl) {
        match self.protocol.as_mut() {
            Some(ProtocolState::Authority(authority)) => {
                authority.pending_control = Some(pending);
            }
            Some(ProtocolState::Replica(replica)) => {
                replica.pending_control = Some(pending);
            }
            None => {}
        }
    }
}

impl GameKernelSnapshotBridge for GameKernel {
    fn snapshot_v2(&self) -> Result<RestorableKernelSnapshotV2, SnapshotError> {
        self.capture_restorable_snapshot_v2()
    }

    fn accept_shared_terminal_root(
        &mut self,
        terminal: &TerminalState,
    ) -> Result<(), SnapshotError> {
        GameKernel::accept_shared_terminal_root(self, terminal)
    }

    fn from_snapshot_v2(
        snapshot: RestorableKernelSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        snapshot.validate_for_content(content.as_ref())?;
        Self::restore_restorable_snapshot_v2(snapshot, content)
    }
}

fn m3_snapshot_invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn m3_snapshot_canonical(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

impl ProtocolState {
    fn new(config: &ProtocolKernelConfig) -> Result<Self, String> {
        match &config.role {
            ProtocolRoleConfig::Authority {
                log,
                proposal_capacity,
                resolutions,
            } => {
                let context = log.local_context.clone();
                let peer_bindings = log.peer_bindings.clone();
                let log = AuthorityLog::new(log.clone())
                    .map_err(|error| format!("authority log initialization failed: {error}"))?;
                let proposals =
                    ProposalAdmissionLedger::new(*proposal_capacity).map_err(|error| {
                        format!("proposal admission initialization failed: {error}")
                    })?;
                let mut transports = BTreeMap::new();
                transports.insert(context.sender_seat_id, TransportState::Connected);
                for peer in &peer_bindings {
                    transports.insert(peer.seat_id, TransportState::Connected);
                }
                Ok(Self::Authority(Box::new(AuthorityKernelState {
                    context,
                    peer_bindings,
                    log,
                    proposals,
                    resolutions: resolutions.clone(),
                    menu_plans: config.menu_plans.clone(),
                    pending_material: None,
                    pending_control: None,
                    pending_recoveries: BTreeMap::new(),
                    authority_rebind_pending: false,
                    staged_peer_rebinds: BTreeMap::new(),
                    transports,
                })))
            }
            ProtocolRoleConfig::Replica {
                replica,
                proposal_leases,
                recovery,
            } => {
                let context = replica.receipt_context.clone();
                let authority_seat_id = replica.authority_seat_id;
                let authority_generation = replica.authority_connection_generation;
                let replica_owner = AuthorityReplica::new(replica.clone())
                    .map_err(|error| format!("authority replica initialization failed: {error}"))?;
                let leases = ProposalLeaseManager::new(proposal_leases.clone())
                    .map_err(|error| format!("proposal lease initialization failed: {error}"))?;
                let recovery_owner = RecoveryTransaction::new(recovery.clone())
                    .map_err(|error| format!("recovery initialization failed: {error}"))?;
                let recovery_context = recovery.local_context.clone();
                let mut transports = BTreeMap::new();
                transports.insert(context.sender_seat_id, TransportState::Connected);
                transports.insert(authority_seat_id, TransportState::Connected);
                Ok(Self::Replica(Box::new(ReplicaKernelState {
                    context,
                    authority_seat_id,
                    authority_generation,
                    replica: replica_owner,
                    leases,
                    recovery: recovery_owner,
                    recovery_config: recovery.clone(),
                    recovery_context,
                    menu_plans: config.menu_plans.clone(),
                    pending_material: None,
                    pending_control: None,
                    pending_recovery: None,
                    staged_authority_rebind: None,
                    transports,
                })))
            }
        }
    }
}

fn menu_submission(intent: UiIntent) -> Option<MenuSubmission> {
    match intent {
        UiIntent::CommandSubmitted {
            seat,
            operation_id,
            control_id,
            option_id,
            ..
        } => Some(MenuSubmission {
            kind: MenuSubmissionKind::Command,
            seat,
            operation_id,
            control_id,
            option_id,
        }),
        UiIntent::ReplacementSubmitted {
            seat,
            operation_id,
            control_id,
            option_id,
            ..
        } => Some(MenuSubmission {
            kind: MenuSubmissionKind::Replacement,
            seat,
            operation_id,
            control_id,
            option_id,
        }),
        UiIntent::InteractionSubmitted {
            seat,
            operation_id,
            control_id,
            option_id,
            ..
        } => Some(MenuSubmission {
            kind: MenuSubmissionKind::Interaction,
            seat,
            operation_id,
            control_id,
            option_id,
        }),
        UiIntent::CursorChanged { .. }
        | UiIntent::CancelRequested { .. }
        | UiIntent::MessageAdvanced { .. }
        | UiIntent::Confirmed { .. }
        | UiIntent::MenuOpened { .. }
        | UiIntent::MenuClosed { .. } => None,
    }
}

fn authority_accepts_peer_frame(
    authority: &AuthorityKernelState,
    endpoint: SeatId,
    context: &FrameContext,
) -> bool {
    endpoint == authority.context.sender_seat_id
        && context.authority_seat_id == authority.context.authority_seat_id
        && context.sender_seat_id != authority.context.sender_seat_id
        && frame_contexts_compatible(context, &authority.context)
        && authority.peer_bindings.iter().any(|binding| {
            binding.seat_id == context.sender_seat_id
                && binding.connection_generation == context.connection_generation
        })
}

fn replica_accepts_authority_frame(
    replica: &ReplicaKernelState,
    endpoint: SeatId,
    context: &FrameContext,
) -> bool {
    endpoint == replica.context.sender_seat_id
        && context.sender_seat_id == replica.authority_seat_id
        && context.authority_seat_id == replica.authority_seat_id
        && context.connection_generation == replica.authority_generation
        && frame_contexts_compatible(context, &replica.context)
}

fn pending_material_snapshot(pending: Option<&PendingMaterial>) -> Value {
    match pending {
        Some(pending) => json!({
            "revision": pending.revision,
            "operationId": pending.operation_id,
        }),
        None => Value::Null,
    }
}

fn pending_control_snapshot(pending: Option<&PendingControl>) -> Value {
    match pending {
        Some(pending) => json!({
            "revision": pending.revision,
            "operationId": pending.operation_id,
            "control": pending.control,
            "expectedControlId": pending.expected_control_id,
        }),
        None => Value::Null,
    }
}

fn pending_recoveries_snapshot(pending: &BTreeMap<String, PendingRecoveryExpectation>) -> Value {
    let mut snapshot = serde_json::Map::new();
    for (request_id, expectation) in pending {
        snapshot.insert(
            request_id.clone(),
            json!({
                "peer": expectation.peer,
                "context": expectation.context,
                "connectionGeneration": expectation.connection_generation,
                "capturedFrontier": expectation.captured_frontier,
                "reason": expectation.reason,
                "frontier": expectation.frontier,
                "materialDigest": expectation.material_digest,
                "controlId": expectation.control_id,
            }),
        );
    }
    Value::Object(snapshot)
}

fn legacy_presentations_snapshot(
    pending: &BTreeMap<PresentationEventId, LegacyPresentationEvidence>,
    completed: &BTreeMap<PresentationEventId, LegacyPresentationCompletionEvidence>,
) -> Option<Value> {
    if pending.is_empty() && completed.is_empty() {
        return None;
    }

    let mut entries = pending
        .iter()
        .map(|(event_id, evidence)| {
            (
                *event_id,
                json!({
                    "eventId": event_id,
                    "status": "pending",
                    "revision": &evidence.revision,
                    "operationId": &evidence.operation_id,
                    "event": &evidence.event,
                }),
            )
        })
        .collect::<Vec<_>>();
    entries.extend(completed.iter().map(|(event_id, evidence)| {
        (
            *event_id,
            json!({
                "eventId": event_id,
                "status": "completed",
                "revision": &evidence.presentation.revision,
                "operationId": &evidence.presentation.operation_id,
                "event": &evidence.presentation.event,
                "outcome": &evidence.outcome,
            }),
        )
    }));
    entries.sort_by_key(|(event_id, _)| *event_id);
    Some(Value::Array(
        entries
            .into_iter()
            .map(|(_, presentation)| presentation)
            .collect(),
    ))
}

fn network_frame(
    context: &FrameContext,
    frame_type: FrameType,
    body: Value,
) -> Result<NetworkFrame, String> {
    Ok(NetworkFrame {
        version: FRAME_PROTOCOL_VERSION,
        frame_type,
        context: context.clone(),
        body,
    })
}

pub(crate) fn authority_entry_frame(entry: &AuthorityEntry) -> Result<NetworkFrame, String> {
    network_frame(
        &entry.context,
        FrameType::AuthorityEntry,
        serde_json::to_value(AuthorityEntryBody::from(entry)).map_err(|error| error.to_string())?,
    )
}

pub(crate) fn receipt_frame(receipt: &AuthorityReceipt) -> Result<NetworkFrame, String> {
    network_frame(
        &receipt.context,
        FrameType::AuthorityReceipt,
        serde_json::to_value(AuthorityReceiptBody {
            revision: receipt.revision,
            operation_id: receipt.operation_id.clone(),
            stage: receipt.stage,
            control_id: receipt.control_id.clone(),
        })
        .map_err(|error| error.to_string())?,
    )
}

pub(crate) fn tail_request_frame(
    context: &FrameContext,
    missing_from: Revision,
) -> Result<NetworkFrame, String> {
    correlated_tail_request_frame(
        context,
        TailRequestBody {
            from_revision: missing_from,
            request_id: None,
            candidate_revision: None,
            candidate_operation_id: None,
        },
    )
}

pub(crate) fn correlated_tail_request_frame(
    context: &FrameContext,
    body: TailRequestBody,
) -> Result<NetworkFrame, String> {
    network_frame(
        context,
        FrameType::TailRequest,
        serde_json::to_value(body).map_err(|error| error.to_string())?,
    )
}

pub(crate) fn tail_proof_frame(
    context: &FrameContext,
    body: TailProofBody,
) -> Result<NetworkFrame, String> {
    network_frame(
        context,
        FrameType::TailProof,
        serde_json::to_value(body).map_err(|error| error.to_string())?,
    )
}

pub(crate) fn recovery_request_frame(
    context: &FrameContext,
    request: RecoveryRequestBody,
) -> Result<NetworkFrame, String> {
    network_frame(
        context,
        FrameType::RecoveryRequest,
        serde_json::to_value(request).map_err(|error| error.to_string())?,
    )
}

pub(crate) fn recovery_bundle_frame(
    context: &FrameContext,
    request_id: String,
    membership_revision: er_types::MembershipRevision,
    slice: &AuthorityRecoverySlice,
) -> Result<NetworkFrame, String> {
    let material = match slice.required_tail.last() {
        Some(entry) => entry.material.clone(),
        None => er_types::Material {
            digest: "recovery-empty".to_owned(),
            payload: Value::Null,
        },
    };
    let body = RecoveryBundleBody {
        request_id,
        material,
        frontier: slice.frontier,
        frontier_operation_id: slice.frontier_operation_id.clone(),
        membership_revision,
        next_control: slice.next_control.clone(),
        required_tail: slice
            .required_tail
            .iter()
            .map(AuthorityEntryBody::from)
            .collect(),
    };
    network_frame(
        context,
        FrameType::RecoveryBundle,
        serde_json::to_value(body).map_err(|error| error.to_string())?,
    )
}

pub(crate) fn recovery_material_digest(slice: &AuthorityRecoverySlice) -> String {
    match slice.required_tail.last() {
        Some(entry) => entry.material.digest.clone(),
        None => "recovery-empty".to_owned(),
    }
}

pub(crate) fn recovery_applied_frame(
    context: &FrameContext,
    proof: RecoveryAppliedProof,
) -> Result<NetworkFrame, String> {
    network_frame(
        context,
        FrameType::RecoveryApplied,
        serde_json::to_value(proof).map_err(|error| error.to_string())?,
    )
}

fn recovery_operation_id(bundle: &RecoveryBundle) -> Result<OperationId, KernelError> {
    if let Some(operation_id) = bundle.frontier_operation_id.clone() {
        return Ok(operation_id);
    }
    OperationId::new(format!("recovery/{}/zero", bundle.request_id))
        .or_else(|_| OperationId::new("recovery/zero"))
        .map_err(kernel_protocol_error)
}

fn previous_revision(revision: Revision) -> Option<Revision> {
    let value = revision.get().get();
    if value == 0 {
        None
    } else {
        SafeU53::new(value - 1).ok().map(Revision::new)
    }
}

fn kernel_protocol_error<T: std::fmt::Display>(error: T) -> KernelError {
    KernelError::Canonical {
        reason: error.to_string(),
    }
}

impl Default for GameKernel {
    fn default() -> Self {
        Self::new(KernelConfig::default())
    }
}

#[derive(Debug, Error)]
pub enum KernelError {
    #[error(transparent)]
    Input(#[from] InputRouteError),
    #[error("kernel state could not be canonicalized: {reason}")]
    Canonical { reason: String },
    #[error("battle kernel transition failed: {reason}")]
    Battle { reason: String },
    #[error("kernel is disposed")]
    Disposed,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error;

    use er_protocol::{BackoffPolicy, PeerBinding};
    use er_types::{
        AuthorityEntryKind, FrameContext, FrameType, Material, MembershipRevision, NextControl,
        OperationId, RunId, SessionId, TerminalControl, TransportState, WaitingMenu,
    };

    fn safe(value: u64) -> SafeU53 {
        match SafeU53::new(value) {
            Ok(value) => value,
            Err(_) => SafeU53::MAX,
        }
    }

    fn seat(value: u64) -> SeatId {
        SeatId::new(safe(value))
    }

    fn generation(value: u64) -> ConnectionGeneration {
        ConnectionGeneration::new(safe(value))
    }

    fn context(connection_generation: u64) -> Result<FrameContext, Box<dyn Error>> {
        Ok(FrameContext {
            session_id: SessionId::new("kernel-unit-session")?,
            run_id: RunId::new("kernel-unit-run")?,
            session_epoch: safe(1),
            seat_map_id: "kernel-unit-seat-map".to_owned(),
            membership_revision: MembershipRevision::new(safe(1)),
            sender_seat_id: seat(0),
            authority_seat_id: seat(0),
            connection_generation: generation(connection_generation),
        })
    }

    fn generation_two_authority_kernel(
        operation_id: &OperationId,
    ) -> Result<GameKernel, Box<dyn Error>> {
        let initial_context = context(1)?;
        let next_control = NextControl::Terminal(TerminalControl {
            terminal_id: "kernel-unit-terminal".to_owned(),
        });
        let protocol = ProtocolKernelConfig {
            role: ProtocolRoleConfig::Authority {
                log: AuthorityLogConfig {
                    local_context: initial_context.clone(),
                    peer_bindings: vec![PeerBinding {
                        seat_id: seat(1),
                        connection_generation: generation(1),
                    }],
                    owner_id: "kernel-unit-authority".to_owned(),
                    retain_capacity: safe(8),
                    delivery_backoff: BackoffPolicy {
                        initial_ms: safe(1),
                        maximum_ms: safe(8),
                        factor_numerator: safe(2),
                        factor_denominator: safe(1),
                    },
                    delivery_time_class: TimeClass::Connected,
                    max_delivery_attempts: None,
                },
                proposal_capacity: safe(8),
                resolutions: vec![AuthorityResolutionPlan {
                    operation_id: operation_id.clone(),
                    fingerprint: "generation-2".to_owned(),
                    draft: AuthorityEntryDraft {
                        context: initial_context,
                        operation_id: operation_id.clone(),
                        kind: AuthorityEntryKind::TerminalCommit,
                        material: Material {
                            digest: "kernel-unit-generation-2".to_owned(),
                            payload: Value::Null,
                        },
                        next_control,
                        subsumes: Vec::new(),
                    },
                }],
            },
            menu_plans: Vec::new(),
        };
        Ok(GameKernel::new(KernelConfig {
            input_map: InputMap::default(),
            initial_ui: UiState::default(),
            protocol: Some(protocol),
        }))
    }

    #[test]
    fn authority_resolution_refreshes_cached_context_at_generation_two()
    -> Result<(), Box<dyn Error>> {
        let operation_id = OperationId::new("kernel.unit.generation-two")?;
        let mut kernel = generation_two_authority_kernel(&operation_id)?;

        kernel.step(KernelInput::TransportChanged {
            endpoint: seat(0),
            state: TransportState::Disconnected,
            generation: generation(2),
        })?;
        kernel.step(KernelInput::TransportChanged {
            endpoint: seat(1),
            state: TransportState::Disconnected,
            generation: generation(2),
        })?;
        kernel.step(KernelInput::TransportChanged {
            endpoint: seat(0),
            state: TransportState::Connected,
            generation: generation(2),
        })?;
        kernel.step(KernelInput::TransportChanged {
            endpoint: seat(1),
            state: TransportState::Connected,
            generation: generation(2),
        })?;

        let effects = kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: ProposalMessage {
                operation_id,
                fingerprint: "generation-2".to_owned(),
                from: seat(0),
                to: seat(0),
                connection_generation: generation(2),
                payload: Value::Null,
            },
        })?;
        let frames = effects
            .iter()
            .filter_map(|effect| match effect {
                KernelEffect::SendFrame { frame, .. }
                    if frame.frame_type == FrameType::AuthorityEntry =>
                {
                    Some(frame)
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].context.connection_generation, generation(2));
        assert_eq!(frames[0].context, context(2)?);
        Ok(())
    }

    #[test]
    fn replace_menu_is_inert_after_terminal() {
        let mut kernel = GameKernel::default();
        let _ = kernel.enter_terminal("kernel-unit-terminal".to_owned());
        let before = kernel.snapshot();

        let generation = kernel.replace_menu(None, true, MenuState::None);

        assert_eq!(generation, before.ui.generation);
        assert_eq!(kernel.snapshot(), before);
    }

    #[test]
    fn replace_menu_is_inert_after_dispose() {
        let mut kernel = GameKernel::default();
        let _ = kernel.dispose("kernel-unit-dispose");
        let before = kernel.snapshot();

        let generation = kernel.replace_menu(
            Some(seat(1)),
            true,
            MenuState::Waiting(WaitingMenu {
                prompt_key: Some("should-not-install".to_owned()),
            }),
        );

        assert_eq!(generation, before.ui.generation);
        assert_eq!(kernel.snapshot(), before);
    }

    #[test]
    fn clone_preserves_state_and_evolves_independently() {
        let mut original = GameKernel::default();
        let mut cloned = original.clone();

        assert_eq!(original.snapshot(), cloned.snapshot());
        assert_eq!(original.state_digest(), cloned.state_digest());

        let original_generation = original.replace_menu(None, false, MenuState::None);
        let cloned_generation = cloned.replace_menu(None, false, MenuState::None);
        assert_eq!(original_generation, cloned_generation);
        assert_eq!(original.snapshot(), cloned.snapshot());

        let cloned_before_divergence = cloned.snapshot();
        original.replace_menu(
            None,
            false,
            MenuState::Waiting(WaitingMenu {
                prompt_key: Some("original-only".to_owned()),
            }),
        );
        assert_eq!(cloned.snapshot(), cloned_before_divergence);
        assert_ne!(original.snapshot(), cloned.snapshot());

        let _ = original.dispose("original-only-dispose");
        assert!(original.is_disposed());
        assert!(!cloned.is_disposed());
        assert_eq!(cloned.snapshot(), cloned_before_divergence);
    }
}
