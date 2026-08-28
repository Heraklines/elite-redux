//! Production M3 Battle-mode kernel transaction.
//!
//! This module is additive to the legacy M1/M2 fixture kernel. One external
//! input is reduced on cloned deterministic owners, the closed internal FIFO
//! is drained to quiescence, and only then are state and effects published.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_content::pack::ContentPack;
use er_game::internal_event::{
    AuthorityEntryReadyPayload, BattleResolvedPayload, ButtonEventPayload, ControlInstalledPayload,
    InternalEvent, InternalEventKind, InternalEventQueue, MaterialApplyResult as EventApplyResult,
    MaterialInstalledPayload, MaterialKind, PreparedBattleResolution, PresentationBarrier,
    UiEventPayload,
};
use er_game::material::{
    BattleMaterialApplyContext, MaterialApplyResult, decode_replacement_material,
    decode_turn_material,
};
use er_game::runtime::{BattleGameConfig, BattleUiResult, GameRuntime, GameRuntimeError};
use er_game::snapshot::{GameRuntimeSnapshotBridge, GameRuntimeSnapshotV2};
use er_protocol::{
    AuthorityLog, AuthorityLogAction, AuthorityLogSnapshotBridge, AuthorityReplica,
    AuthorityReplicaSnapshotBridge, BattleTerminalMaterialV1, BattleTerminalReasonV1,
    ConnectionSnapshotV2, CorrelatedResponseSnapshotV2, EndpointRole, FrameContextSnapshotV2,
    FrameValidator, InboundFrameResult, KernelScheduler, PeerBinding, PeerIdentitySnapshotV2,
    PendingRecoverySnapshotV2, ProposalAdmission, ProposalAdmissionLedger,
    ProposalAdmissionSnapshotBridge, ProposalIdentity, ProposalLeaseAction, ProposalLeaseManager,
    ProposalLeaseSnapshotBridge, ProposalLeaseSpec, ProposalLeaseStart, ProtocolRuntimeSnapshotV2,
    RecoveryAction, RecoveryBundleValidation, RecoveryFrontierStagingOutcome, RecoveryLiveState,
    RecoveryMaterialOutcome, RecoveryPhase, RecoveryTransaction, RecoveryTransactionSnapshotBridge,
    RecoveryValidationContext, ReplicaAction, ReplicaAdmission, ReplicaMechanicalStage,
    ReplicaTailProofDisposition, SchedulerCommand, StagedPeerRebindSnapshotV2, ValidatedFrame,
    ValidatedFrameBody, build_battle_terminal_commit_draft, control_id_of,
    frame_contexts_compatible, validate_battle_terminal_commit, validate_recovery_bundle,
};
use er_state::digest::MechanicalStateDigest;
use er_state::format::human_seats;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommandProposalV1, BattleReplacementProposalV1,
    ReplacementSelection,
};
use er_types::battle_control::{BattleControl, BattleControlPlan};
use er_types::battle_ids::{AuthorityEpoch, BattlePresentationEventId, CanonicalHexBytes};
use er_types::battle_ui::{
    BATTLE_UI_PROJECTION_SCHEMA_VERSION, BattlePresentationEvent, BattleUiProjection,
    PresentationSettlementOutcome,
};
use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, AuthorityReceipt,
    AuthorityReceiptBody, ButtonEvent, ConnectionGeneration, ControlProjectionOutcome,
    FRAME_PROTOCOL_VERSION, FrameContext, FrameType, InputTimerCommand, KernelEffect, KernelInput,
    LiveResourceSnapshot, NetworkFrame, ProposalMessage, RawFrame, RecoveryAppliedProof,
    RecoveryBundle, RecoveryBundleBody, RecoveryFenceState, RecoveryRequestBody, Revision, SeatId,
    TailProofBody, TailRequestBody, TerminalState, TimerId, TransportState,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use thiserror::Error;

use crate::battle_authority::{
    AuthorityPreparedTransaction, AuthorityPublishedTransaction, AuthorityReplacementDecision,
    AuthorityReplacementRequest, AuthorityTransactionError, AuthorityTransactionInput,
    AuthorityTurnRequest, EnclosingKernelValidation, PreparedMaterial,
    battle_terminal_operation_id, prepare_authority_replacement, prepare_authority_turn,
    protocol_next_control_from_plan,
};
use crate::battle_presentation::{
    BattlePresentationError, BattlePresentationState, M3_PRESENTATION_FAILED,
};
use crate::battle_replica::{ReplicaApplyError, apply_authority_material};
use crate::battle_ui::{BattleUiAdapter, BattleUiAdapterError};
use crate::input_router::{BattleButtonEvent, BattleInputOutput, InputRouteError};
use crate::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use crate::snapshot::{
    BattleKernelRuntimeIdentitySnapshotV1, InputRouterSnapshotV2, PendingPresentationsSnapshotV1,
    RngDraw, SnapshotError,
};
use crate::ui_reducer::{BattleUiIntent, BattleUiReject};

#[derive(Debug, Error)]
pub enum BattleInitializationError {
    #[error("battle game initialization failed: {reason}")]
    Game { reason: String },
    #[error("battle protocol initialization failed: {reason}")]
    Protocol { reason: String },
    #[error("battle UI initialization failed: {reason}")]
    Ui { reason: String },
}

#[derive(Debug, Error)]
pub(crate) enum BattleKernelError {
    #[error("battle game transition failed: {0}")]
    Game(#[from] GameRuntimeError),
    #[error("battle input/UI transition failed: {0}")]
    Ui(#[from] BattleUiAdapterError),
    #[error("battle input routing failed: {0}")]
    Input(#[from] InputRouteError),
    #[error("battle UI action was rejected: {0}")]
    UiReject(#[from] BattleUiReject),
    #[error("battle internal queue failed: {0}")]
    Queue(#[from] er_game::internal_event::InternalEventQueueError),
    #[error("battle authority transaction failed: {0}")]
    Authority(#[from] AuthorityTransactionError),
    #[error("battle presentation transition failed: {0}")]
    Presentation(#[from] BattlePresentationError),
    #[error("battle protocol transition failed: {reason}")]
    Protocol { reason: String },
    #[error("replica requires correlated recovery for {operation_id}: {reason}")]
    RecoveryRequired {
        operation_id: er_types::OperationId,
        reason: String,
    },
    #[error("battle transition requires a fresh shared terminal: {reason}")]
    TerminalRequired { reason: String },
    #[error("battle mode rejects the legacy compatibility boundary: {boundary}")]
    CompatibilityBoundary { boundary: &'static str },
    #[error("battle transaction did not quiesce: {reason}")]
    Invariant { reason: String },
}

#[derive(Clone, Debug)]
pub(crate) struct BattleMode {
    // External inputs clone BattleMode into a private transaction. Sharing the
    // already-validated game owner keeps protocol-only and key-release inputs
    // O(1); the first semantic mutation uses Arc::make_mut to preserve the
    // exact clone-and-swap rollback boundary.
    game: Arc<GameRuntime>,
    game_changed_in_transaction: bool,
    ui: BattleUiAdapter,
    protocol_config: BattleProtocolConfig,
    protocol: BattleProtocolState,
    presentations: BattlePresentationState,
    presentation_revisions: BTreeMap<BattlePresentationEventId, Revision>,
    suspended: bool,
    terminal_fenced: bool,
    last_rng_audit: Vec<RngDraw>,
    last_internal_events: Vec<InternalEventKind>,
}

pub(crate) struct BattleModeSnapshotParts {
    pub(crate) runtime_identity: BattleKernelRuntimeIdentitySnapshotV1,
    pub(crate) input_router: InputRouterSnapshotV2,
    pub(crate) ui: BattleUiProjection,
    pub(crate) protocol: ProtocolRuntimeSnapshotV2,
    pub(crate) game: GameRuntimeSnapshotV2,
    pub(crate) pending_presentations: PendingPresentationsSnapshotV1,
}

#[derive(Clone, Debug)]
// The authority and replica variants own live protocol graphs. The retained
// authority log is copy-on-write so presentation-only transactions do not
// clone full material payloads; every mutating path uses `Arc::make_mut`.
// Boxing either branch would ripple through snapshot ownership, so allow this
// enum's large-variant layout specifically.
#[allow(clippy::large_enum_variant)]
enum BattleProtocolState {
    Authority {
        context: FrameContext,
        peer_bindings: Vec<PeerBinding>,
        log: Arc<AuthorityLog>,
        proposals: ProposalAdmissionLedger,
        pending_recoveries: BTreeMap<String, BattlePendingRecovery>,
        transports: BTreeMap<SeatId, TransportState>,
        staged_local_rebind: Option<ConnectionGeneration>,
        staged_peer_rebinds: BTreeMap<SeatId, ConnectionGeneration>,
    },
    Replica {
        context: FrameContext,
        authority_seat: SeatId,
        authority_generation: ConnectionGeneration,
        replica: AuthorityReplica,
        leases: ProposalLeaseManager,
        recovery: RecoveryTransaction,
        recovery_config: er_protocol::RecoveryTransactionConfig,
        transports: BTreeMap<SeatId, TransportState>,
        staged_local_rebind: Option<ConnectionGeneration>,
        staged_authority_rebind: Option<ConnectionGeneration>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "proposal",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
enum BattleProposalEnvelope {
    Command(BattleCommandProposalV1),
    Replacement(BattleReplacementProposalV1),
}

impl BattleProposalEnvelope {
    fn operation_id(&self) -> &er_types::OperationId {
        match self {
            Self::Command(value) => &value.operation_id,
            Self::Replacement(value) => &value.operation_id,
        }
    }

    fn fingerprint(&self) -> String {
        match self {
            Self::Command(value) => value.fingerprint().into_inner(),
            Self::Replacement(value) => value.fingerprint().into_inner(),
        }
    }
}

struct PendingReplicaMaterial {
    entry: AuthorityEntry,
    applied: MaterialApplyResult,
}

struct PendingReplicaTerminal {
    entry: AuthorityEntry,
    material: BattleTerminalMaterialV1,
}

enum RecoveredMaterial {
    Battle {
        entry: AuthorityEntry,
        applied: Box<MaterialApplyResult>,
    },
    Terminal {
        entry: AuthorityEntry,
        material: BattleTerminalMaterialV1,
    },
}

impl RecoveredMaterial {
    fn entry(&self) -> &AuthorityEntry {
        match self {
            Self::Battle { entry, .. } | Self::Terminal { entry, .. } => entry,
        }
    }

    fn battle_apply(&self) -> Option<&MaterialApplyResult> {
        match self {
            Self::Battle { applied, .. } => Some(applied),
            Self::Terminal { .. } => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BattlePendingRecovery {
    peer: SeatId,
    context: FrameContext,
    captured_frontier: Revision,
    reason: String,
    frontier: Revision,
    material_digest: String,
    control_id: Option<String>,
    response_frame: NetworkFrame,
}

struct BattleTransaction {
    staged: BattleMode,
    scheduler: KernelScheduler,
    terminal: Option<TerminalState>,
    effects: Vec<KernelEffect>,
    queue: InternalEventQueue,
    pending_authority: Option<AuthorityPreparedTransaction>,
    pending_replacements: BTreeMap<er_types::OperationId, BattleReplacementProposalV1>,
    pending_replica_material: Option<PendingReplicaMaterial>,
    pending_replica_terminal: Option<PendingReplicaTerminal>,
    pending_presentation_probes: BTreeMap<Revision, er_types::OperationId>,
    defer_terminalization: bool,
    deferred_terminal: Option<TerminalState>,
}

impl BattleMode {
    fn game_mut(&mut self) -> &mut GameRuntime {
        self.game_changed_in_transaction = true;
        Arc::make_mut(&mut self.game)
    }

    pub(crate) fn new(
        config: BattleGameConfig,
        protocol_config: BattleProtocolConfig,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        let game = GameRuntime::new_battle(config, content).map_err(|error| {
            BattleInitializationError::Game {
                reason: error.to_string(),
            }
        })?;
        let local_seat = game.local_seat();
        let battle_authority = game
            .state()
            .battle
            .as_ref()
            .ok_or_else(|| protocol_init("battle runtime has no active battle"))?
            .authority_seat;
        let human_seat_values = human_seats(
            &game
                .state()
                .battle
                .as_ref()
                .ok_or_else(|| protocol_init("battle runtime has no active battle"))?
                .format,
        )
        .map_err(|error| protocol_init(&format!("battle topology: {error}")))?;
        match &protocol_config.role {
            BattleProtocolRoleConfig::Authority { log, .. } => {
                if local_seat != battle_authority {
                    return Err(protocol_init(
                        "authority protocol role does not match the battle authority seat",
                    ));
                }
                let mut expected_peers = human_seat_values
                    .iter()
                    .copied()
                    .filter(|seat| *seat != battle_authority)
                    .collect::<Vec<_>>();
                expected_peers.sort_unstable();
                let mut actual_peers = log
                    .peer_bindings
                    .iter()
                    .map(|binding| binding.seat_id)
                    .collect::<Vec<_>>();
                actual_peers.sort_unstable();
                if actual_peers != expected_peers {
                    return Err(protocol_init(
                        "authority peer bindings do not exactly match the battle human topology",
                    ));
                }
            }
            BattleProtocolRoleConfig::Replica { replica, .. } => {
                if local_seat == battle_authority
                    || replica.authority_seat_id != battle_authority
                    || !human_seat_values.contains(&local_seat)
                {
                    return Err(protocol_init(
                        "replica protocol role does not match the battle authority seat",
                    ));
                }
            }
        }
        let protocol = BattleProtocolState::new(&protocol_config, local_seat)?;
        let presentations = BattlePresentationState::new(local_seat);
        let projection = projection_for(&game, &presentations, false)
            .map_err(|error| protocol_init(&error.to_string()))?;
        let ui = BattleUiAdapter::with_default_map(local_seat, projection).map_err(|error| {
            BattleInitializationError::Ui {
                reason: error.to_string(),
            }
        })?;
        let mode = Self {
            game: Arc::new(game),
            game_changed_in_transaction: false,
            ui,
            protocol_config,
            protocol,
            presentations,
            presentation_revisions: BTreeMap::new(),
            suspended: false,
            terminal_fenced: false,
            last_rng_audit: Vec::new(),
            last_internal_events: Vec::new(),
        };
        mode.validate_quiescent()
            .map_err(|error| protocol_init(&error.to_string()))?;
        Ok(mode)
    }

    pub(crate) fn from_existing_game(
        game: GameRuntime,
        protocol_config: BattleProtocolConfig,
    ) -> Result<Self, BattleInitializationError> {
        let local_seat = game.local_seat();
        let battle_authority = game
            .state()
            .battle
            .as_ref()
            .ok_or_else(|| protocol_init("battle runtime has no active battle"))?
            .authority_seat;
        let human_seat_values = human_seats(
            &game
                .state()
                .battle
                .as_ref()
                .ok_or_else(|| protocol_init("battle runtime has no active battle"))?
                .format,
        )
        .map_err(|error| protocol_init(&format!("battle topology: {error}")))?;
        match &protocol_config.role {
            BattleProtocolRoleConfig::Authority { log, .. } => {
                if local_seat != battle_authority {
                    return Err(protocol_init(
                        "authority protocol role does not match the battle authority seat",
                    ));
                }
                let mut expected_peers = human_seat_values
                    .iter()
                    .copied()
                    .filter(|seat| *seat != battle_authority)
                    .collect::<Vec<_>>();
                expected_peers.sort_unstable();
                let mut actual_peers = log
                    .peer_bindings
                    .iter()
                    .map(|binding| binding.seat_id)
                    .collect::<Vec<_>>();
                actual_peers.sort_unstable();
                if actual_peers != expected_peers {
                    return Err(protocol_init(
                        "authority peer bindings do not exactly match the battle human topology",
                    ));
                }
            }
            BattleProtocolRoleConfig::Replica { replica, .. } => {
                if local_seat == battle_authority
                    || replica.authority_seat_id != battle_authority
                    || !human_seat_values.contains(&local_seat)
                {
                    return Err(protocol_init(
                        "replica protocol role does not match the battle authority seat",
                    ));
                }
            }
        }
        let protocol = BattleProtocolState::new(&protocol_config, local_seat)?;
        let presentations = BattlePresentationState::new(local_seat);
        let projection = projection_for(&game, &presentations, false)
            .map_err(|error| protocol_init(&error.to_string()))?;
        let ui = BattleUiAdapter::with_default_map(local_seat, projection).map_err(|error| {
            BattleInitializationError::Ui {
                reason: error.to_string(),
            }
        })?;
        let mode = Self {
            game: Arc::new(game),
            game_changed_in_transaction: false,
            ui,
            protocol_config,
            protocol,
            presentations,
            presentation_revisions: BTreeMap::new(),
            suspended: false,
            terminal_fenced: false,
            last_rng_audit: Vec::new(),
            last_internal_events: Vec::new(),
        };
        mode.validate_quiescent()
            .map_err(|error| protocol_init(&error.to_string()))?;
        Ok(mode)
    }

    pub(crate) fn game_state(&self) -> &er_state::snapshot::GameState {
        self.game.state()
    }

    pub(crate) fn step(
        &mut self,
        scheduler: &mut KernelScheduler,
        terminal: &mut Option<TerminalState>,
        input: KernelInput,
    ) -> Result<Vec<KernelEffect>, BattleKernelError> {
        let mut transaction =
            BattleTransaction::new(self.clone(), scheduler.clone(), terminal.clone());
        let staged = transaction
            .translate(input)
            .and_then(|()| transaction.drain())
            .and_then(|()| transaction.validate_quiescent());
        match staged {
            Ok(()) => {
                transaction.capture_trace_audit();
            }
            Err(BattleKernelError::RecoveryRequired {
                operation_id,
                reason,
            }) => {
                let mut recovery =
                    BattleTransaction::new(self.clone(), scheduler.clone(), terminal.clone());
                recovery.start_correlated_recovery(operation_id, reason)?;
                recovery.validate_quiescent()?;
                recovery.capture_trace_audit();
                *self = recovery.staged;
                *scheduler = recovery.scheduler;
                *terminal = recovery.terminal;
                return Ok(recovery.effects);
            }
            Err(BattleKernelError::TerminalRequired { reason }) => {
                let mut terminal_transition =
                    BattleTransaction::new(self.clone(), scheduler.clone(), terminal.clone());
                terminal_transition.enter_prescribed_terminal(reason)?;
                terminal_transition.validate_quiescent()?;
                terminal_transition.capture_trace_audit();
                *self = terminal_transition.staged;
                *scheduler = terminal_transition.scheduler;
                *terminal = terminal_transition.terminal;
                return Ok(terminal_transition.effects);
            }
            Err(error) => return Err(error),
        }
        *self = transaction.staged;
        *scheduler = transaction.scheduler;
        *terminal = transaction.terminal;
        Ok(transaction.effects)
    }

    pub(crate) fn protocol_config(&self) -> &BattleProtocolConfig {
        &self.protocol_config
    }

    pub(crate) fn trace_audit(&self) -> (&[RngDraw], &[InternalEventKind]) {
        (&self.last_rng_audit, &self.last_internal_events)
    }

    pub(crate) fn projection(&self) -> &BattleUiProjection {
        self.ui.projection()
    }

    pub(crate) fn state_value(&self) -> serde_json::Value {
        let presentation_plans = self
            .presentations
            .plans()
            .values()
            .map(|plan| {
                json!({
                    "operationId": plan.operation_id(),
                    "events": plan.events(),
                })
            })
            .collect::<Vec<_>>();
        let presentation_outcomes = self
            .presentations
            .outcomes()
            .iter()
            .map(|(event_id, outcome)| {
                json!({
                    "eventId": event_id,
                    "outcome": outcome,
                })
            })
            .collect::<Vec<_>>();
        json!({
            "mode": "BATTLE",
            "game": self.game.state(),
            "control": self.game.control(),
            "ui": self.ui.projection(),
            "protocol": self.protocol.diagnostics_value(),
            "presentationPlans": presentation_plans,
            "presentationPending": self.presentations.pending_ids(),
            "presentationOutcomes": presentation_outcomes,
            "suspended": self.suspended,
            "terminalFenced": self.terminal_fenced,
            "recoveryFenced": self.protocol.recovery_fenced(),
        })
    }

    pub(crate) fn live_resources(&self, scheduler: &KernelScheduler) -> LiveResourceSnapshot {
        let mut snapshot = LiveResourceSnapshot {
            timers: scheduler
                .live_timers()
                .into_iter()
                .map(|timer| timer.timer_id)
                .collect(),
            battle_presentations: self.presentations.pending_ids().clone(),
            ..Default::default()
        };
        if self.terminal_fenced {
            return snapshot;
        }
        snapshot.controls = self
            .game
            .control()
            .seats
            .iter()
            .filter_map(|entry| control_id(&entry.control))
            .collect();
        snapshot.waits = self
            .game
            .control()
            .seats
            .iter()
            .flat_map(|entry| match &entry.control {
                BattleControl::Waiting(waiting) => waiting
                    .operation_ids
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
                _ => Vec::new(),
            })
            .collect();
        match &self.protocol {
            BattleProtocolState::Authority {
                log,
                pending_recoveries,
                ..
            } => {
                let diagnostics = log.diagnostics();
                snapshot.delivery_leases = diagnostics.delivery_owner_ids;
                snapshot.retained_revisions = diagnostics.retained_revisions;
                snapshot
                    .recovery_transactions
                    .extend(pending_recoveries.keys().cloned());
            }
            BattleProtocolState::Replica {
                leases, recovery, ..
            } => {
                snapshot.proposal_leases = leases.diagnostics().live_operation_ids;
                let recovery = recovery.diagnostics();
                if recovery.phase.is_some_and(|phase| {
                    !matches!(phase, RecoveryPhase::Released | RecoveryPhase::Terminalized)
                }) && let Some(request_id) = recovery.request_id
                {
                    snapshot.recovery_transactions.insert(request_id);
                }
            }
        }
        snapshot
    }

    pub(crate) fn snapshot_parts(
        &self,
        scheduler: &KernelScheduler,
        terminal: &Option<TerminalState>,
        disposed: bool,
    ) -> Result<BattleModeSnapshotParts, SnapshotError> {
        self.validate_quiescent()
            .map_err(|error| battle_snapshot_invalid("battle", error))?;

        let ui = self.ui.snapshot_v2(scheduler)?;
        let protocol = self.protocol.snapshot_v2()?;
        let game = self.game.snapshot_v2().map_err(map_game_snapshot_error)?;
        let pending_presentations = self.presentations.snapshot_v1()?;
        let owner_quiesced = disposed || terminal.is_some();
        if ui.disposed != disposed
            || protocol.disposed != owner_quiesced
            || pending_presentations.disposed != owner_quiesced
        {
            return Err(snapshot_invalid(
                "disposed",
                "battle owner disposal flags differ from the root lifecycle",
            ));
        }

        let suspended = scheduler_has_reason(scheduler, "suspended");
        if self.suspended != suspended {
            return Err(snapshot_invalid(
                "scheduler.pauses",
                "battle suspension differs from the scheduler pause projection",
            ));
        }
        let terminal_fenced = disposed || terminal.is_some();
        if self.terminal_fenced != terminal_fenced {
            return Err(snapshot_invalid(
                "terminal",
                "battle terminal fence differs from the root lifecycle",
            ));
        }

        let revisions = presentation_revisions_from_protocol(
            &protocol,
            &pending_presentations.pending_barrier_ids,
        )?;
        if revisions != self.presentation_revisions {
            return Err(snapshot_invalid(
                "pending_presentations",
                "pending presentation revisions differ from protocol causal evidence",
            ));
        }

        let local_seat = self.game.local_seat();
        if ui.local_seat != local_seat || pending_presentations.local_endpoint != local_seat {
            return Err(snapshot_invalid(
                "runtime_identity.local_seat",
                "game, UI, and presentation owners disagree on the local seat",
            ));
        }
        Ok(BattleModeSnapshotParts {
            runtime_identity: BattleKernelRuntimeIdentitySnapshotV1 {
                local_seat,
                protocol_config: self.protocol_config.clone(),
            },
            input_router: ui.input_router,
            ui: ui.projection,
            protocol,
            game,
            pending_presentations,
        })
    }

    pub(crate) fn from_snapshot_parts(
        parts: BattleModeSnapshotParts,
        scheduler: &mut KernelScheduler,
        terminal: &Option<TerminalState>,
        disposed: bool,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        let BattleModeSnapshotParts {
            runtime_identity,
            input_router,
            ui,
            protocol,
            game,
            pending_presentations,
        } = parts;
        let local_seat = runtime_identity.local_seat;
        let owner_quiesced = disposed || terminal.is_some();
        if input_router.disposed != disposed
            || protocol.disposed != owner_quiesced
            || pending_presentations.disposed != owner_quiesced
        {
            return Err(snapshot_invalid(
                "disposed",
                "battle owner disposal flags differ from the root lifecycle",
            ));
        }

        let presentation_revisions = presentation_revisions_from_protocol(
            &protocol,
            &pending_presentations.pending_barrier_ids,
        )?;
        let game = GameRuntime::from_snapshot_v2(game, local_seat, content)
            .map_err(map_game_snapshot_error)?;
        let presentations = BattlePresentationState::from_snapshot_v1(pending_presentations)?;
        let ui = BattleUiAdapter::from_snapshot_parts_v2(
            local_seat,
            ui,
            input_router,
            disposed,
            scheduler,
        )?;
        let protocol = BattleProtocolState::from_snapshot_v2(protocol, scheduler)?;
        let mode = Self {
            game: Arc::new(game),
            game_changed_in_transaction: false,
            ui,
            protocol_config: runtime_identity.protocol_config,
            protocol,
            presentations,
            presentation_revisions,
            suspended: scheduler_has_reason(scheduler, "suspended"),
            terminal_fenced: disposed || terminal.is_some(),
            last_rng_audit: Vec::new(),
            last_internal_events: Vec::new(),
        };
        mode.validate_quiescent()
            .map_err(|error| battle_snapshot_invalid("battle", error))?;
        Ok(mode)
    }

    pub(crate) fn dispose(
        &mut self,
        scheduler: &mut KernelScheduler,
        reason: &str,
    ) -> Vec<KernelEffect> {
        let mut effects = Vec::new();
        self.suspended = false;
        self.terminal_fenced = true;
        let mut fenced_projection = self.ui.projection().clone();
        fenced_projection.actionable = false;
        if let Err(error) = self.ui.install_projection(fenced_projection) {
            effects.push(KernelEffect::EnterSharedTerminal {
                terminal: TerminalState {
                    terminal_id: "m3-dispose-ui".to_owned(),
                    reason: error.to_string(),
                },
            });
        }
        let ui = self.ui.dispose(scheduler);
        let _ =
            map_input_timer_commands(&mut effects, &ui.timers, scheduler, self.game.local_seat());
        match &mut self.protocol {
            BattleProtocolState::Authority {
                log,
                proposals,
                pending_recoveries,
                transports,
                staged_local_rebind,
                staged_peer_rebinds,
                ..
            } => {
                let actions = Arc::make_mut(log).dispose(reason, scheduler);
                proposals.dispose();
                pending_recoveries.clear();
                for state in transports.values_mut() {
                    *state = TransportState::Connected;
                }
                *staged_local_rebind = None;
                staged_peer_rebinds.clear();
                if let Err(error) = map_authority_actions(&mut effects, actions) {
                    effects.push(KernelEffect::EnterSharedTerminal {
                        terminal: TerminalState {
                            terminal_id: "m3-dispose-authority".to_owned(),
                            reason: error.to_string(),
                        },
                    });
                }
            }
            BattleProtocolState::Replica {
                replica,
                leases,
                recovery,
                transports,
                staged_local_rebind,
                staged_authority_rebind,
                ..
            } => {
                let recovery_actions = recovery.dispose(reason, scheduler);
                map_recovery_dispose_actions(&mut effects, recovery_actions);
                let proposal_actions = leases.dispose(reason, scheduler);
                map_proposal_actions(&mut effects, proposal_actions);
                replica.dispose(reason);
                for state in transports.values_mut() {
                    *state = TransportState::Connected;
                }
                *staged_local_rebind = None;
                *staged_authority_rebind = None;
            }
        }
        self.presentations.dispose();
        self.presentation_revisions.clear();
        effects
    }

    fn validate_quiescent(&self) -> Result<(), BattleKernelError> {
        self.validate_quiescent_transaction(true)
    }

    fn validate_quiescent_transaction(&self, validate_game: bool) -> Result<(), BattleKernelError> {
        // `GameRuntime` construction, restore, and public snapshot validation
        // fully validate the immutable ContentPack.  A staged transaction
        // retains that same Arc and uses the live-state check here so every
        // raw input does not canonicalize and rehash the whole pack.
        if validate_game {
            self.game.validate_transactional()?;
        }
        self.presentations.validate()?;
        let expected = projection_for(
            &self.game,
            &self.presentations,
            self.suspended || self.terminal_fenced || self.protocol.recovery_fenced(),
        )?;
        if self.ui.projection() != &expected {
            return Err(BattleKernelError::Invariant {
                reason: "Battle UI projection diverged from game/control/barrier state".to_owned(),
            });
        }
        Ok(())
    }
}

impl BattleProtocolState {
    fn new(
        config: &BattleProtocolConfig,
        local_seat: SeatId,
    ) -> Result<Self, BattleInitializationError> {
        match &config.role {
            BattleProtocolRoleConfig::Authority {
                log,
                proposal_capacity,
            } => {
                if log.local_context.sender_seat_id != local_seat
                    || log.local_context.authority_seat_id != local_seat
                {
                    return Err(protocol_init(
                        "authority context does not name the local authority seat",
                    ));
                }
                let context = log.local_context.clone();
                let authority_log = if log.peer_bindings.is_empty() {
                    AuthorityLog::new_local(log.clone())
                } else {
                    AuthorityLog::new(log.clone())
                }
                .map_err(|error| protocol_init(&format!("authority log: {error}")))?;
                let proposals = ProposalAdmissionLedger::new(*proposal_capacity)
                    .map_err(|error| protocol_init(&format!("proposal ledger: {error}")))?;
                Ok(Self::Authority {
                    context,
                    peer_bindings: log.peer_bindings.clone(),
                    log: Arc::new(authority_log),
                    proposals,
                    pending_recoveries: BTreeMap::new(),
                    transports: std::iter::once((local_seat, TransportState::Connected))
                        .chain(
                            log.peer_bindings
                                .iter()
                                .map(|binding| (binding.seat_id, TransportState::Connected)),
                        )
                        .collect(),
                    staged_local_rebind: None,
                    staged_peer_rebinds: BTreeMap::new(),
                })
            }
            BattleProtocolRoleConfig::Replica {
                replica,
                proposal_leases,
                recovery,
            } => {
                if replica.receipt_context.sender_seat_id != local_seat
                    || replica.authority_seat_id == local_seat
                {
                    return Err(protocol_init(
                        "replica context does not name the local guest seat",
                    ));
                }
                let context = replica.receipt_context.clone();
                if recovery.local_context != context {
                    return Err(protocol_init(
                        "recovery context does not equal the replica receipt context",
                    ));
                }
                let authority_seat = replica.authority_seat_id;
                let authority_generation = replica.authority_connection_generation;
                Ok(Self::Replica {
                    context,
                    authority_seat,
                    authority_generation,
                    replica: AuthorityReplica::new(replica.clone())
                        .map_err(|error| protocol_init(&format!("authority replica: {error}")))?,
                    leases: ProposalLeaseManager::new(proposal_leases.clone())
                        .map_err(|error| protocol_init(&format!("proposal leases: {error}")))?,
                    recovery: RecoveryTransaction::new(recovery.clone())
                        .map_err(|error| protocol_init(&format!("recovery: {error}")))?,
                    recovery_config: recovery.clone(),
                    transports: BTreeMap::from([
                        (local_seat, TransportState::Connected),
                        (authority_seat, TransportState::Connected),
                    ]),
                    staged_local_rebind: None,
                    staged_authority_rebind: None,
                })
            }
        }
    }

    fn is_authority(&self) -> bool {
        matches!(self, Self::Authority { .. })
    }

    fn authority_epoch(&self) -> AuthorityEpoch {
        let context = match self {
            Self::Authority { context, .. } | Self::Replica { context, .. } => context,
        };
        AuthorityEpoch::new(context.session_epoch)
    }

    fn recovery_fenced(&self) -> bool {
        match self {
            Self::Authority { .. } => false,
            Self::Replica { recovery, .. } => recovery.fence().is_some_and(|fence| {
                fence.is_command_admission_frozen()
                    || fence.is_control_surface_start_frozen()
                    || fence.is_progression_frozen()
                    || fence.is_materialization_frozen()
            }),
        }
    }

    fn accepts_remote_frame(&self, endpoint: SeatId, incoming: &FrameContext) -> bool {
        match self {
            Self::Authority {
                context,
                peer_bindings,
                ..
            } => authority_accepts_peer_frame(context, peer_bindings, endpoint, incoming),
            Self::Replica {
                context,
                authority_seat,
                authority_generation,
                ..
            } => replica_accepts_authority_frame(
                context,
                *authority_seat,
                *authority_generation,
                endpoint,
                incoming,
            ),
        }
    }

    fn endpoint_generation(&self, endpoint: SeatId) -> Option<ConnectionGeneration> {
        match self {
            Self::Authority {
                context,
                peer_bindings,
                staged_local_rebind,
                staged_peer_rebinds,
                ..
            } => {
                if endpoint == context.sender_seat_id {
                    Some(
                        staged_local_rebind
                            .as_ref()
                            .copied()
                            .map(|staged| staged.max(context.connection_generation))
                            .unwrap_or(context.connection_generation),
                    )
                } else {
                    let active = peer_bindings
                        .iter()
                        .find(|binding| binding.seat_id == endpoint)
                        .map(|binding| binding.connection_generation)?;
                    Some(
                        staged_peer_rebinds
                            .get(&endpoint)
                            .copied()
                            .map(|staged| staged.max(active))
                            .unwrap_or(active),
                    )
                }
            }
            Self::Replica {
                context,
                authority_seat,
                authority_generation,
                staged_local_rebind,
                staged_authority_rebind,
                ..
            } => {
                if endpoint == context.sender_seat_id {
                    Some(
                        staged_local_rebind
                            .as_ref()
                            .copied()
                            .map(|staged| staged.max(context.connection_generation))
                            .unwrap_or(context.connection_generation),
                    )
                } else if endpoint == *authority_seat {
                    Some(
                        staged_authority_rebind
                            .as_ref()
                            .copied()
                            .map(|staged| staged.max(*authority_generation))
                            .unwrap_or(*authority_generation),
                    )
                } else {
                    None
                }
            }
        }
    }

    fn endpoint_state(&self, endpoint: SeatId) -> Option<TransportState> {
        match self {
            Self::Authority { transports, .. } | Self::Replica { transports, .. } => {
                transports.get(&endpoint).copied()
            }
        }
    }

    fn diagnostics_value(&self) -> serde_json::Value {
        match self {
            Self::Authority {
                log,
                proposals,
                pending_recoveries,
                transports,
                staged_local_rebind,
                staged_peer_rebinds,
                ..
            } => json!({
                "role": "AUTHORITY",
                "log": log.diagnostics(),
                "proposals": proposals.diagnostics(),
                "pendingRecoveries": pending_recoveries.keys().collect::<Vec<_>>(),
                "transports": transports,
                "stagedLocalRebind": staged_local_rebind,
                "stagedPeerRebinds": staged_peer_rebinds,
            }),
            Self::Replica {
                replica,
                leases,
                recovery,
                transports,
                staged_local_rebind,
                staged_authority_rebind,
                ..
            } => json!({
                "role": "REPLICA",
                "replica": replica.diagnostics(),
                "leases": leases.diagnostics(),
                "recovery": recovery.diagnostics(),
                "transports": transports,
                "stagedLocalRebind": staged_local_rebind,
                "stagedAuthorityRebind": staged_authority_rebind,
            }),
        }
    }

    fn snapshot_v2(&self) -> Result<ProtocolRuntimeSnapshotV2, SnapshotError> {
        let snapshot = match self {
            Self::Authority {
                context,
                peer_bindings,
                log,
                proposals,
                pending_recoveries,
                transports,
                staged_local_rebind,
                staged_peer_rebinds,
            } => {
                let authority_log = log.snapshot_v2().map_err(map_protocol_snapshot_error)?;
                let proposal_admission = proposals
                    .snapshot_v2()
                    .map_err(map_protocol_snapshot_error)?;
                let disposed = authority_log.disposed;
                if authority_log.local_context != *context
                    || authority_log.disposed != proposal_admission.disposed
                {
                    return Err(snapshot_invalid(
                        "protocol.authority",
                        "authority owners disagree on context or disposal state",
                    ));
                }
                let mut live_bindings = peer_bindings
                    .iter()
                    .map(|binding| (binding.seat_id, binding.connection_generation))
                    .collect::<Vec<_>>();
                live_bindings.sort_unstable();
                let snapshot_bindings = authority_log
                    .peer_bindings
                    .iter()
                    .map(|binding| (binding.seat, binding.generation))
                    .collect::<Vec<_>>();
                if live_bindings != snapshot_bindings {
                    return Err(snapshot_invalid(
                        "protocol.authority_log.peer_bindings",
                        "battle peer bindings differ from the authority log owner",
                    ));
                }
                validate_transport_inventory(
                    transports,
                    std::iter::once(context.sender_seat_id)
                        .chain(peer_bindings.iter().map(|binding| binding.seat_id)),
                    "protocol.connections",
                )?;

                validate_schema_representable_local_transport(
                    transports,
                    context.sender_seat_id,
                    peer_bindings.iter().map(|binding| binding.seat_id),
                    authority_log.disposed,
                )?;
                let mut pending_correlations = Vec::new();
                let mut pending_recovery_snapshots = Vec::new();
                for (correlation_id, recovery) in pending_recoveries {
                    pending_correlations.push(CorrelatedResponseSnapshotV2 {
                        correlation_id: correlation_id.clone(),
                        bytes: canonical_snapshot_bytes(
                            recovery,
                            "protocol.pending_correlations.authority_recovery",
                        )?,
                    });
                    pending_recovery_snapshots.push(PendingRecoverySnapshotV2 {
                        correlation_id: correlation_id.clone(),
                        bundle: None,
                    });
                }
                pending_correlations
                    .sort_unstable_by(|left, right| left.correlation_id.cmp(&right.correlation_id));

                let mut connections = peer_bindings
                    .iter()
                    .map(|binding| {
                        Ok(ConnectionSnapshotV2 {
                            peer_seat: binding.seat_id,
                            generation: binding.connection_generation,
                            state: transport_state(
                                transports,
                                binding.seat_id,
                                "protocol.connections",
                            )?,
                        })
                    })
                    .collect::<Result<Vec<_>, SnapshotError>>()?;
                connections.sort_unstable_by_key(|connection| connection.peer_seat);
                let mut staged_rebinds = staged_peer_rebinds
                    .iter()
                    .map(|(seat, generation)| StagedPeerRebindSnapshotV2 {
                        peer_seat: *seat,
                        generation: *generation,
                    })
                    .collect::<Vec<_>>();
                if let Some(generation) = staged_local_rebind {
                    staged_rebinds.push(StagedPeerRebindSnapshotV2 {
                        peer_seat: context.sender_seat_id,
                        generation: *generation,
                    });
                }
                staged_rebinds.sort_unstable_by_key(|rebind| rebind.peer_seat);
                let peer = peer_bindings
                    .iter()
                    .min_by_key(|binding| binding.seat_id)
                    .map(|binding| {
                        peer_frame_context(context, binding.seat_id, binding.connection_generation)
                    });
                ProtocolRuntimeSnapshotV2 {
                    role: EndpointRole::Authority,
                    authority_log: Some(authority_log),
                    authority_replica: None,
                    proposal_admission: Some(proposal_admission),
                    proposal_leases: None,
                    recovery: None,
                    frame_context: FrameContextSnapshotV2 {
                        context: context.clone(),
                    },
                    peer_identity: PeerIdentitySnapshotV2 {
                        local: context.clone(),
                        peer,
                    },
                    connections,
                    pending_correlations,
                    pending_material: None,
                    pending_control: None,
                    pending_recoveries: pending_recovery_snapshots,
                    staged_rebinds,
                    authority_rebind_pending: staged_local_rebind.is_some(),
                    disposed,
                }
            }
            Self::Replica {
                context,
                authority_seat,
                authority_generation,
                replica,
                leases,
                recovery,
                recovery_config,
                transports,
                staged_local_rebind,
                staged_authority_rebind,
            } => {
                let authority_replica =
                    replica.snapshot_v2().map_err(map_protocol_snapshot_error)?;
                let proposal_leases = leases.snapshot_v2().map_err(map_protocol_snapshot_error)?;
                let recovery_snapshot = recovery
                    .snapshot_v2()
                    .map_err(map_protocol_snapshot_error)?;
                let disposed = authority_replica.disposed;
                if authority_replica.receipt_context != *context
                    || authority_replica.authority_seat != *authority_seat
                    || authority_replica.authority_generation != *authority_generation
                    || recovery_snapshot.config != *recovery_config
                    || authority_replica.disposed != proposal_leases.disposed
                    || authority_replica.disposed != recovery_snapshot.disposed
                {
                    return Err(snapshot_invalid(
                        "protocol.replica",
                        "replica owners disagree on identity, configuration, or disposal state",
                    ));
                }
                validate_transport_inventory(
                    transports,
                    [context.sender_seat_id, *authority_seat],
                    "protocol.connections",
                )?;
                validate_schema_representable_local_transport(
                    transports,
                    context.sender_seat_id,
                    [*authority_seat],
                    authority_replica.disposed,
                )?;
                let mut staged_rebinds = Vec::new();
                if let Some(generation) = staged_local_rebind {
                    staged_rebinds.push(StagedPeerRebindSnapshotV2 {
                        peer_seat: context.sender_seat_id,
                        generation: *generation,
                    });
                }
                if let Some(generation) = staged_authority_rebind {
                    staged_rebinds.push(StagedPeerRebindSnapshotV2 {
                        peer_seat: *authority_seat,
                        generation: *generation,
                    });
                }
                staged_rebinds.sort_unstable_by_key(|rebind| rebind.peer_seat);
                ProtocolRuntimeSnapshotV2 {
                    role: EndpointRole::Replica,
                    authority_log: None,
                    authority_replica: Some(authority_replica),
                    proposal_admission: None,
                    proposal_leases: Some(proposal_leases),
                    recovery: Some(recovery_snapshot),
                    frame_context: FrameContextSnapshotV2 {
                        context: context.clone(),
                    },
                    peer_identity: PeerIdentitySnapshotV2 {
                        local: context.clone(),
                        peer: Some(peer_frame_context(
                            context,
                            *authority_seat,
                            *authority_generation,
                        )),
                    },
                    connections: vec![ConnectionSnapshotV2 {
                        peer_seat: *authority_seat,
                        generation: *authority_generation,
                        state: transport_state(
                            transports,
                            *authority_seat,
                            "protocol.connections",
                        )?,
                    }],
                    pending_correlations: Vec::new(),
                    pending_material: None,
                    pending_control: None,
                    pending_recoveries: Vec::new(),
                    staged_rebinds,
                    authority_rebind_pending: staged_authority_rebind.is_some(),
                    disposed,
                }
            }
        };
        snapshot.validate().map_err(map_protocol_snapshot_error)?;
        Ok(snapshot)
    }

    fn from_snapshot_v2(
        snapshot: ProtocolRuntimeSnapshotV2,
        scheduler: &mut KernelScheduler,
    ) -> Result<Self, SnapshotError> {
        snapshot.validate().map_err(map_protocol_snapshot_error)?;
        if snapshot.pending_material.is_some() || snapshot.pending_control.is_some() {
            return Err(snapshot_invalid(
                "protocol.pending_material",
                "prepared protocol material/control cannot cross a public kernel boundary",
            ));
        }
        match snapshot.role {
            EndpointRole::Authority => restore_authority_protocol(snapshot, scheduler),
            EndpointRole::Replica => restore_replica_protocol(snapshot, scheduler),
        }
    }
}

/// Build the exact initial public protocol snapshot from a production battle protocol config.
///
/// M7 headless environments use this to construct authority/replica endpoints without
/// synthesizing private owner fields or overriding the endpoint role in tests.
pub fn initial_battle_protocol_snapshot_v2(
    config: &BattleProtocolConfig,
    local_seat: SeatId,
) -> Result<ProtocolRuntimeSnapshotV2, BattleInitializationError> {
    BattleProtocolState::new(config, local_seat)?
        .snapshot_v2()
        .map_err(|error| BattleInitializationError::Protocol {
            reason: error.to_string(),
        })
}

fn restore_authority_protocol(
    snapshot: ProtocolRuntimeSnapshotV2,
    scheduler: &mut KernelScheduler,
) -> Result<BattleProtocolState, SnapshotError> {
    let ProtocolRuntimeSnapshotV2 {
        authority_log,
        proposal_admission,
        frame_context,
        peer_identity,
        connections,
        pending_correlations,
        pending_recoveries,
        staged_rebinds,
        authority_rebind_pending,
        disposed,
        ..
    } = snapshot;
    let authority_log = authority_log.ok_or_else(|| {
        snapshot_invalid(
            "protocol.authority_log",
            "authority snapshot is missing its log owner",
        )
    })?;
    let proposal_admission = proposal_admission.ok_or_else(|| {
        snapshot_invalid(
            "protocol.proposal_admission",
            "authority snapshot is missing its proposal owner",
        )
    })?;
    let context = frame_context.context;
    let peer_bindings = authority_log
        .peer_bindings
        .iter()
        .map(|binding| PeerBinding {
            seat_id: binding.seat,
            connection_generation: binding.generation,
        })
        .collect::<Vec<_>>();
    let expected_peer = peer_bindings
        .iter()
        .min_by_key(|binding| binding.seat_id)
        .map(|binding| {
            peer_frame_context(&context, binding.seat_id, binding.connection_generation)
        });
    if peer_identity.local != context || peer_identity.peer != expected_peer {
        return Err(snapshot_invalid(
            "protocol.peer_identity",
            "authority peer identity is not the exact active binding projection",
        ));
    }

    let mut transports = BTreeMap::new();
    let mut correlations = correlation_map(pending_correlations)?;
    if connections.len() != peer_bindings.len() {
        return Err(snapshot_invalid(
            "protocol.connections",
            "authority connection inventory differs from its peer bindings",
        ));
    }
    for binding in &peer_bindings {
        let connection = connections
            .iter()
            .find(|connection| connection.peer_seat == binding.seat_id)
            .ok_or_else(|| {
                snapshot_invalid(
                    "protocol.connections",
                    "authority peer binding has no connection state",
                )
            })?;
        if connection.generation != binding.connection_generation {
            return Err(snapshot_invalid(
                "protocol.connections",
                "authority connection generation differs from its peer binding",
            ));
        }
        transports.insert(binding.seat_id, connection.state);
    }
    let local_transport = local_transport_from_connections(&connections, disposed)?;
    transports.insert(context.sender_seat_id, local_transport);

    let mut restored_pending = BTreeMap::new();
    for pending in pending_recoveries {
        if pending.bundle.is_some() {
            return Err(snapshot_invalid(
                "protocol.pending_recoveries",
                "authority pending recovery cannot carry a replica-owned bundle",
            ));
        }
        let bytes = correlations
            .remove(&pending.correlation_id)
            .ok_or_else(|| {
                snapshot_invalid(
                    "protocol.pending_correlations",
                    "authority pending recovery has no exact private causal record",
                )
            })?;
        let recovery: BattlePendingRecovery = decode_canonical_snapshot_bytes(
            &bytes,
            "protocol.pending_correlations.authority_recovery",
        )?;
        let response_body =
            serde_json::from_value::<RecoveryBundleBody>(recovery.response_frame.body.clone())
                .map_err(|error| {
                    snapshot_invalid(
                        "protocol.pending_correlations.authority_recovery.response_frame",
                        error.to_string(),
                    )
                })?;
        let canonical_response_body = serde_json::to_value(&response_body).map_err(|error| {
            snapshot_invalid(
                "protocol.pending_correlations.authority_recovery.response_frame",
                error.to_string(),
            )
        })?;
        let response_bundle = response_body.with_context(recovery.response_frame.context.clone());
        let response_validation = validate_recovery_bundle(
            &RecoveryValidationContext {
                expected_request_id: pending.correlation_id.clone(),
                live_context: recovery.context.clone(),
                captured_frontier: recovery.captured_frontier,
            },
            &response_bundle,
        );
        let response_final_material = response_bundle
            .required_tail
            .last()
            .map(|entry| &entry.material);
        let response_control_id = response_bundle.next_control.as_ref().map(control_id_of);
        if recovery.peer != recovery.context.sender_seat_id
            || !authority_accepts_peer_frame(
                &context,
                &peer_bindings,
                context.sender_seat_id,
                &recovery.context,
            )
            || !matches!(response_validation, RecoveryBundleValidation::Valid { .. })
            || canonical_response_body != recovery.response_frame.body
            || recovery.response_frame.version != FRAME_PROTOCOL_VERSION
            || recovery.response_frame.frame_type != FrameType::RecoveryBundle
            || recovery.response_frame.context != context
            || response_bundle.frontier != recovery.frontier
            || response_final_material != Some(&response_bundle.material)
            || response_bundle.material.digest != recovery.material_digest
            || response_control_id != recovery.control_id
        {
            return Err(snapshot_invalid(
                "protocol.pending_correlations.authority_recovery",
                "pending recovery peer/context is not an active authority binding",
            ));
        }
        if restored_pending
            .insert(pending.correlation_id, recovery)
            .is_some()
        {
            return Err(snapshot_invalid(
                "protocol.pending_recoveries",
                "duplicate authority recovery correlation",
            ));
        }
    }
    if !correlations.is_empty() {
        return Err(snapshot_invalid(
            "protocol.pending_correlations",
            "authority snapshot contains an unowned private correlation",
        ));
    }

    let mut staged_local_rebind = None;
    let mut staged_peer_rebinds = BTreeMap::new();
    for staged in staged_rebinds {
        if staged.peer_seat == context.sender_seat_id {
            if staged.generation <= context.connection_generation
                || staged_local_rebind.replace(staged.generation).is_some()
            {
                return Err(snapshot_invalid(
                    "protocol.staged_rebinds",
                    "authority local rebind must be one fresh generation",
                ));
            }
            continue;
        }
        let binding = peer_bindings
            .iter()
            .find(|binding| binding.seat_id == staged.peer_seat)
            .ok_or_else(|| {
                snapshot_invalid(
                    "protocol.staged_rebinds",
                    "authority rebind names an unknown peer",
                )
            })?;
        if staged.generation <= binding.connection_generation
            || staged_peer_rebinds
                .insert(staged.peer_seat, staged.generation)
                .is_some()
        {
            return Err(snapshot_invalid(
                "protocol.staged_rebinds",
                "authority peer rebind must be one fresh generation",
            ));
        }
    }
    if authority_rebind_pending != staged_local_rebind.is_some() {
        return Err(snapshot_invalid(
            "protocol.authority_rebind_pending",
            "authority local rebind marker differs from staged state",
        ));
    }
    let log =
        <AuthorityLog as AuthorityLogSnapshotBridge>::from_snapshot_v2(authority_log, scheduler)
            .map_err(map_protocol_snapshot_error)?;
    let proposals = <ProposalAdmissionLedger as ProposalAdmissionSnapshotBridge>::from_snapshot_v2(
        proposal_admission,
    )
    .map_err(map_protocol_snapshot_error)?;
    if disposed
        != log
            .snapshot_v2()
            .map_err(map_protocol_snapshot_error)?
            .disposed
    {
        return Err(snapshot_invalid(
            "protocol.disposed",
            "restored authority owner differs from the protocol lifecycle",
        ));
    }
    Ok(BattleProtocolState::Authority {
        context,
        peer_bindings,
        log: Arc::new(log),
        proposals,
        pending_recoveries: restored_pending,
        transports,
        staged_local_rebind,
        staged_peer_rebinds,
    })
}

fn restore_replica_protocol(
    snapshot: ProtocolRuntimeSnapshotV2,
    scheduler: &mut KernelScheduler,
) -> Result<BattleProtocolState, SnapshotError> {
    let ProtocolRuntimeSnapshotV2 {
        authority_replica,
        proposal_leases,
        recovery,
        frame_context,
        peer_identity,
        connections,
        pending_correlations,
        pending_recoveries,
        staged_rebinds,
        authority_rebind_pending,
        disposed,
        ..
    } = snapshot;
    if !pending_recoveries.is_empty() {
        return Err(snapshot_invalid(
            "protocol.pending_recoveries",
            "replica recovery state belongs exclusively to its recovery owner",
        ));
    }
    let authority_replica = authority_replica.ok_or_else(|| {
        snapshot_invalid(
            "protocol.authority_replica",
            "replica snapshot is missing its frontier owner",
        )
    })?;
    let proposal_leases = proposal_leases.ok_or_else(|| {
        snapshot_invalid(
            "protocol.proposal_leases",
            "replica snapshot is missing its proposal lease owner",
        )
    })?;
    let recovery = recovery.ok_or_else(|| {
        snapshot_invalid(
            "protocol.recovery",
            "replica snapshot is missing its recovery owner",
        )
    })?;
    let context = frame_context.context;
    let authority_seat = authority_replica.authority_seat;
    let authority_generation = authority_replica.authority_generation;
    let expected_peer = peer_frame_context(&context, authority_seat, authority_generation);
    if peer_identity.local != context || peer_identity.peer.as_ref() != Some(&expected_peer) {
        return Err(snapshot_invalid(
            "protocol.peer_identity",
            "replica peer identity is not its exact active authority binding",
        ));
    }
    if connections.len() != 1
        || connections[0].peer_seat != authority_seat
        || connections[0].generation != authority_generation
    {
        return Err(snapshot_invalid(
            "protocol.connections",
            "replica requires exactly one active authority connection",
        ));
    }

    let correlations = correlation_map(pending_correlations)?;
    if !correlations.is_empty() {
        return Err(snapshot_invalid(
            "protocol.pending_correlations",
            "replica snapshot contains an unowned private correlation",
        ));
    }
    let local_transport = local_transport_from_connections(&connections, disposed)?;
    let mut staged_local_rebind = None;
    let mut staged_authority_rebind = None;
    for staged in staged_rebinds {
        if staged.peer_seat == context.sender_seat_id {
            if staged.generation <= context.connection_generation
                || staged_local_rebind.replace(staged.generation).is_some()
            {
                return Err(snapshot_invalid(
                    "protocol.staged_rebinds",
                    "replica local rebind must be one fresh generation",
                ));
            }
        } else if staged.peer_seat == authority_seat {
            if staged.generation <= authority_generation
                || staged_authority_rebind.replace(staged.generation).is_some()
            {
                return Err(snapshot_invalid(
                    "protocol.staged_rebinds",
                    "replica authority rebind must be one fresh generation",
                ));
            }
        } else {
            return Err(snapshot_invalid(
                "protocol.staged_rebinds",
                "replica rebind names an unknown endpoint",
            ));
        }
    }
    if authority_rebind_pending != staged_authority_rebind.is_some() {
        return Err(snapshot_invalid(
            "protocol.authority_rebind_pending",
            "replica authority rebind marker differs from staged state",
        ));
    }

    let recovery_config = recovery.config.clone();
    let replica =
        <AuthorityReplica as AuthorityReplicaSnapshotBridge>::from_snapshot_v2(authority_replica)
            .map_err(map_protocol_snapshot_error)?;
    let leases = <ProposalLeaseManager as ProposalLeaseSnapshotBridge>::from_snapshot_v2(
        proposal_leases,
        scheduler,
    )
    .map_err(map_protocol_snapshot_error)?;
    let recovery = <RecoveryTransaction as RecoveryTransactionSnapshotBridge>::from_snapshot_v2(
        recovery, scheduler,
    )
    .map_err(map_protocol_snapshot_error)?;
    if disposed
        != replica
            .snapshot_v2()
            .map_err(map_protocol_snapshot_error)?
            .disposed
    {
        return Err(snapshot_invalid(
            "protocol.disposed",
            "restored replica owner differs from the protocol lifecycle",
        ));
    }
    let local_seat = context.sender_seat_id;
    Ok(BattleProtocolState::Replica {
        context,
        authority_seat,
        authority_generation,
        replica,
        leases,
        recovery,
        recovery_config,
        transports: BTreeMap::from([
            (local_seat, local_transport),
            (authority_seat, connections[0].state),
        ]),
        staged_local_rebind,
        staged_authority_rebind,
    })
}

fn peer_frame_context(
    local: &FrameContext,
    peer_seat: SeatId,
    generation: ConnectionGeneration,
) -> FrameContext {
    let mut peer = local.clone();
    peer.sender_seat_id = peer_seat;
    peer.connection_generation = generation;
    peer
}

fn validate_transport_inventory<I>(
    transports: &BTreeMap<SeatId, TransportState>,
    expected: I,
    path: &str,
) -> Result<(), SnapshotError>
where
    I: IntoIterator<Item = SeatId>,
{
    let expected = expected.into_iter().collect::<BTreeSet<_>>();
    let actual = transports.keys().copied().collect::<BTreeSet<_>>();
    if expected != actual || expected.len() != transports.len() {
        return Err(snapshot_invalid(
            path,
            "transport inventory differs from the protocol endpoint topology",
        ));
    }
    Ok(())
}

fn transport_state(
    transports: &BTreeMap<SeatId, TransportState>,
    seat: SeatId,
    path: &str,
) -> Result<TransportState, SnapshotError> {
    transports
        .get(&seat)
        .copied()
        .ok_or_else(|| snapshot_invalid(path, "transport endpoint is absent"))
}

fn validate_schema_representable_local_transport<I>(
    transports: &BTreeMap<SeatId, TransportState>,
    local_seat: SeatId,
    peer_seats: I,
    disposed: bool,
) -> Result<(), SnapshotError>
where
    I: IntoIterator<Item = SeatId>,
{
    let state = transport_state(transports, local_seat, "protocol.local_transport")?;
    let peer_states = peer_seats
        .into_iter()
        .map(|seat| transport_state(transports, seat, "protocol.connections"))
        .collect::<Result<Vec<_>, _>>()?;
    if disposed
        && (state != TransportState::Connected
            || peer_states
                .iter()
                .any(|peer| *peer != TransportState::Connected))
    {
        return Err(snapshot_invalid(
            "protocol.local_transport",
            "disposed protocol must normalize every inert transport",
        ));
    }
    if peer_states.is_empty() && state != TransportState::Connected {
        return Err(snapshot_invalid(
            "protocol.local_transport",
            "a local-only transport state is not representable by the frozen protocol schema",
        ));
    }
    if peer_states.iter().any(|peer| *peer != state) {
        return Err(snapshot_invalid(
            "protocol.local_transport",
            "local transport must equal every peer transport to be losslessly derived from connections",
        ));
    }
    Ok(())
}

fn local_transport_from_connections(
    connections: &[ConnectionSnapshotV2],
    disposed: bool,
) -> Result<TransportState, SnapshotError> {
    let state = connections
        .first()
        .map_or(TransportState::Connected, |connection| connection.state);
    if connections
        .iter()
        .any(|connection| connection.state != state)
    {
        return Err(snapshot_invalid(
            "protocol.connections",
            "peer transports disagree, so the local transport cannot be derived losslessly",
        ));
    }
    if disposed && state != TransportState::Connected {
        return Err(snapshot_invalid(
            "protocol.connections",
            "disposed protocol must normalize every inert transport",
        ));
    }
    Ok(state)
}

fn correlation_map(
    correlations: Vec<CorrelatedResponseSnapshotV2>,
) -> Result<BTreeMap<String, CanonicalHexBytes>, SnapshotError> {
    let mut result = BTreeMap::new();
    for correlation in correlations {
        if result
            .insert(correlation.correlation_id, correlation.bytes)
            .is_some()
        {
            return Err(snapshot_invalid(
                "protocol.pending_correlations",
                "duplicate correlation identity",
            ));
        }
    }
    Ok(result)
}

fn canonical_snapshot_bytes<T: Serialize>(
    value: &T,
    path: &str,
) -> Result<CanonicalHexBytes, SnapshotError> {
    let bytes = er_canonical::canonical_bytes(value)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    Ok(CanonicalHexBytes::from_bytes(&bytes))
}

fn decode_canonical_snapshot_bytes<T>(
    value: &CanonicalHexBytes,
    path: &str,
) -> Result<T, SnapshotError>
where
    T: DeserializeOwned + Serialize,
{
    let raw = value.as_str().as_bytes();
    if raw.is_empty() {
        return Err(snapshot_canonical(
            path,
            "canonical payload must not be empty",
        ));
    }
    let mut bytes = Vec::with_capacity(raw.len() / 2);
    for index in (0..raw.len()).step_by(2) {
        let high = snapshot_hex_value(raw[index])
            .ok_or_else(|| snapshot_canonical(path, "invalid hexadecimal payload"))?;
        let low = snapshot_hex_value(raw[index + 1])
            .ok_or_else(|| snapshot_canonical(path, "invalid hexadecimal payload"))?;
        bytes.push((high << 4) | low);
    }
    let decoded = serde_json::from_slice::<T>(&bytes)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    let canonical = er_canonical::canonical_bytes(&decoded)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    if canonical != bytes {
        return Err(snapshot_canonical(
            path,
            "payload is not the exact canonical JSON encoding",
        ));
    }
    Ok(decoded)
}

fn snapshot_hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn scheduler_has_reason(scheduler: &KernelScheduler, expected: &str) -> bool {
    scheduler
        .export_restorable_state()
        .pauses
        .iter()
        .any(|pause| {
            pause
                .reasons
                .iter()
                .any(|reason| reason.as_str() == expected)
        })
}

fn presentation_revisions_from_protocol(
    protocol: &ProtocolRuntimeSnapshotV2,
    pending: &[BattlePresentationEventId],
) -> Result<BTreeMap<BattlePresentationEventId, Revision>, SnapshotError> {
    let mut candidates = BTreeMap::<er_types::OperationId, BTreeSet<Revision>>::new();
    if let Some(log) = &protocol.authority_log {
        for lease in &log.retained {
            candidates
                .entry(lease.entry.identity.operation_id.clone())
                .or_default()
                .insert(lease.entry.identity.revision);
        }
        if let Some(entry) = &log.latest_committed {
            candidates
                .entry(entry.identity.operation_id.clone())
                .or_default()
                .insert(entry.identity.revision);
        }
    }
    if let Some(replica) = &protocol.authority_replica {
        if let Some(pending_entry) = &replica.pending {
            candidates
                .entry(pending_entry.entry.identity.operation_id.clone())
                .or_default()
                .insert(pending_entry.entry.identity.revision);
        }
        for installed in &replica.installed_controls {
            candidates
                .entry(installed.identity.operation_id.clone())
                .or_default()
                .insert(installed.identity.revision);
        }
        if let Some(proof) = &replica.recovery_proof {
            candidates
                .entry(proof.operation_id.clone())
                .or_default()
                .insert(proof.revision);
        }
    }

    let mut result = BTreeMap::new();
    for event_id in pending {
        let revisions = candidates.get(&event_id.operation_id).ok_or_else(|| {
            snapshot_invalid(
                "pending_presentations.pending_barrier_ids",
                "pending presentation has no retained protocol revision",
            )
        })?;
        if revisions.len() != 1 {
            return Err(snapshot_invalid(
                "pending_presentations.pending_barrier_ids",
                "pending presentation has ambiguous protocol revisions",
            ));
        }
        let revision = revisions.iter().next().copied().ok_or_else(|| {
            snapshot_invalid(
                "pending_presentations.pending_barrier_ids",
                "pending presentation revision disappeared",
            )
        })?;
        result.insert(event_id.clone(), revision);
    }
    Ok(result)
}

fn map_protocol_snapshot_error(error: er_protocol::SnapshotError) -> SnapshotError {
    snapshot_invalid("protocol", error.to_string())
}

fn map_game_snapshot_error(error: er_game::snapshot::SnapshotError) -> SnapshotError {
    snapshot_invalid("game", error.to_string())
}

fn battle_snapshot_invalid(path: &str, error: impl std::fmt::Display) -> SnapshotError {
    snapshot_invalid(path, error.to_string())
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

impl BattleTransaction {
    fn new(
        mut staged: BattleMode,
        scheduler: KernelScheduler,
        terminal: Option<TerminalState>,
    ) -> Self {
        staged.last_rng_audit.clear();
        staged.last_internal_events.clear();
        staged.game_changed_in_transaction = false;
        Self {
            staged,
            scheduler,
            terminal,
            effects: Vec::new(),
            queue: InternalEventQueue::new(),
            pending_authority: None,
            pending_replacements: BTreeMap::new(),
            pending_replica_material: None,
            pending_replica_terminal: None,
            pending_presentation_probes: BTreeMap::new(),
            defer_terminalization: false,
            deferred_terminal: None,
        }
    }

    fn capture_trace_audit(&mut self) {
        self.staged.last_internal_events = self.queue.processed_kinds().to_vec();
        self.staged.game_changed_in_transaction = false;
    }

    fn translate(&mut self, input: KernelInput) -> Result<(), BattleKernelError> {
        match input {
            KernelInput::RawInput { seat, event } => {
                let output = self
                    .staged
                    .ui
                    .route_raw_input(seat, event, &mut self.scheduler)?;
                self.enqueue_input_output(output)?;
            }
            KernelInput::TimerFired { endpoint, timer_id } => {
                let input_owned = self
                    .scheduler
                    .timer(timer_id)
                    .is_some_and(|timer| self.staged.ui.input().owns_scheduled_timer(timer));
                if input_owned {
                    let output = self.staged.ui.route_timer_fired(
                        endpoint,
                        timer_id,
                        &mut self.scheduler,
                    )?;
                    self.enqueue_input_output(output)?;
                } else {
                    self.dispatch_protocol_timer(endpoint, timer_id)?;
                }
            }
            KernelInput::ProposalReceived { endpoint, proposal } => {
                self.receive_proposal(endpoint, proposal)?;
            }
            KernelInput::NetworkFrame { endpoint, frame } => {
                let raw = RawFrame::JsonValue(json!({
                    "v": frame.version,
                    "t": frame.frame_type,
                    "ctx": frame.context,
                    "body": frame.body,
                }));
                self.receive_raw_frame(endpoint, raw)?;
            }
            KernelInput::RawNetworkFrame { endpoint, frame } => {
                self.receive_raw_frame(endpoint, frame)?;
            }
            KernelInput::BattlePresentationOutcome {
                endpoint,
                event_id,
                outcome,
            } => self.settle_presentation(endpoint, event_id, outcome)?,
            KernelInput::TransportChanged {
                endpoint,
                state,
                generation,
            } => self.transport_changed(endpoint, state, generation)?,
            KernelInput::Suspend { endpoint } => self.set_suspended(endpoint, true)?,
            KernelInput::Resume { endpoint } => self.set_suspended(endpoint, false)?,
            KernelInput::StorageResult { .. } => {}
            KernelInput::MaterialApplied { .. } => {
                return Err(BattleKernelError::CompatibilityBoundary {
                    boundary: "MaterialApplied",
                });
            }
            KernelInput::ControlProjected { .. } => {
                return Err(BattleKernelError::CompatibilityBoundary {
                    boundary: "ControlProjected",
                });
            }
            KernelInput::PresentationSettled { .. } => {
                return Err(BattleKernelError::CompatibilityBoundary {
                    boundary: "PresentationSettled",
                });
            }
        }
        Ok(())
    }

    fn start_correlated_recovery(
        &mut self,
        operation_id: er_types::OperationId,
        reason: String,
    ) -> Result<(), BattleKernelError> {
        let local_seat = self.staged.game.local_seat();
        let (context, actions) = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                context,
                replica,
                recovery,
                recovery_config,
                ..
            } => {
                if let Some(phase) = recovery.phase() {
                    if phase == RecoveryPhase::Released {
                        *recovery = RecoveryTransaction::new(recovery_config.clone())
                            .map_err(protocol_error)?;
                    } else {
                        return Err(BattleKernelError::Invariant {
                            reason: format!(
                                "correlated recovery requested while phase {phase:?} is active"
                            ),
                        });
                    }
                }
                let frontier = replica.frontier();
                let request_id = format!(
                    "m3-recovery/{local_seat}/{operation_id}/{}",
                    frontier.control
                );
                let actions = recovery
                    .start(request_id, frontier, reason, &mut self.scheduler)
                    .map_err(protocol_error)?;
                (context.clone(), actions)
            }
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority attempted to start replica recovery".to_owned(),
                });
            }
        };
        self.apply_recovery_start_actions(&context, actions)?;
        self.install_current_projection()
    }

    fn apply_recovery_start_actions(
        &mut self,
        context: &FrameContext,
        actions: Vec<RecoveryAction>,
    ) -> Result<(), BattleKernelError> {
        let mut input_cleared = false;
        for action in actions {
            match action {
                RecoveryAction::FenceChanged { view }
                    if view.state == RecoveryFenceState::Held && !input_cleared =>
                {
                    let cleared = self.staged.ui.clear_input(&mut self.scheduler)?;
                    map_input_timer_commands(
                        &mut self.effects,
                        &cleared.timers,
                        &self.scheduler,
                        self.staged.game.local_seat(),
                    )?;
                    input_cleared = true;
                }
                RecoveryAction::FenceChanged { .. } => {}
                RecoveryAction::SendRequest { request } => {
                    let frame = crate::kernel::recovery_request_frame(context, request)
                        .map_err(|reason| BattleKernelError::Protocol { reason })?;
                    self.effects.push(KernelEffect::SendFrame {
                        from: context.sender_seat_id,
                        frame,
                    });
                }
                RecoveryAction::Scheduler { command } => {
                    map_scheduler_command(&mut self.effects, command);
                }
                RecoveryAction::Terminalize { reason } => {
                    self.enter_terminal(reason)?;
                    break;
                }
                RecoveryAction::ApplyMaterial { .. }
                | RecoveryAction::StageRecoveredFrontier { .. }
                | RecoveryAction::ProjectControl { .. }
                | RecoveryAction::SendAppliedProof { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "recovery start emitted a post-bundle action".to_owned(),
                    });
                }
            }
        }
        Ok(())
    }

    fn enter_prescribed_terminal(&mut self, reason: String) -> Result<(), BattleKernelError> {
        let recovery_actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica { recovery, .. }
                if recovery.phase().is_some_and(|phase| {
                    !matches!(phase, RecoveryPhase::Released | RecoveryPhase::Terminalized)
                }) =>
            {
                Some(recovery.abort(reason.clone(), &mut self.scheduler))
            }
            BattleProtocolState::Authority { .. } | BattleProtocolState::Replica { .. } => None,
        };
        let mut terminalized = false;
        if let Some(actions) = recovery_actions {
            for action in actions {
                match action {
                    RecoveryAction::FenceChanged { .. } => {}
                    RecoveryAction::Scheduler { command } => {
                        map_scheduler_command(&mut self.effects, command);
                    }
                    RecoveryAction::Terminalize { reason } => {
                        self.enter_terminal(reason)?;
                        terminalized = true;
                        break;
                    }
                    RecoveryAction::SendRequest { .. }
                    | RecoveryAction::ApplyMaterial { .. }
                    | RecoveryAction::StageRecoveredFrontier { .. }
                    | RecoveryAction::ProjectControl { .. }
                    | RecoveryAction::SendAppliedProof { .. } => {
                        return Err(BattleKernelError::Invariant {
                            reason: "recovery abort emitted non-terminal work".to_owned(),
                        });
                    }
                }
            }
        }
        if !terminalized {
            self.enter_terminal(reason)?;
        }
        Ok(())
    }

    fn drain(&mut self) -> Result<(), BattleKernelError> {
        while let Some(event) = self.queue.pop()? {
            self.reduce_event(event)?;
            if self.terminal.is_some() {
                break;
            }
        }
        Ok(())
    }

    fn reduce_event(&mut self, event: InternalEvent) -> Result<(), BattleKernelError> {
        match event {
            InternalEvent::Button(payload) => self.reduce_button(payload),
            InternalEvent::Ui(payload) => self.reduce_ui(payload),
            InternalEvent::Game(payload) => self.reduce_game(payload),
            InternalEvent::Protocol(_) => Err(BattleKernelError::Invariant {
                reason: "protocol event reached an unbound reducer".to_owned(),
            }),
            InternalEvent::BattleResolved(payload) => self.reduce_battle_resolved(payload),
            InternalEvent::AuthorityEntryReady(payload) => self.reduce_authority_ready(payload),
            InternalEvent::MaterialInstalled(payload) => self.reduce_material_installed(payload),
            InternalEvent::ControlInstalled(payload) => self.reduce_control_installed(payload),
        }
    }

    fn enqueue_input_output(&mut self, output: BattleInputOutput) -> Result<(), BattleKernelError> {
        map_input_timer_commands(
            &mut self.effects,
            &output.timers,
            &self.scheduler,
            self.staged.game.local_seat(),
        )?;
        self.queue
            .push_all_source_order(output.events.into_iter().map(|event| match event {
                BattleButtonEvent::Pressed {
                    seat,
                    button,
                    menu_instance_id,
                } => InternalEvent::Button(ButtonEventPayload {
                    endpoint: seat,
                    menu_instance_id,
                    event: ButtonEvent::Pressed(button),
                }),
                BattleButtonEvent::Released {
                    seat,
                    button,
                    menu_instance_id,
                } => InternalEvent::Button(ButtonEventPayload {
                    endpoint: seat,
                    menu_instance_id,
                    event: ButtonEvent::Released(button),
                }),
            }));
        Ok(())
    }

    fn reduce_button(&mut self, payload: ButtonEventPayload) -> Result<(), BattleKernelError> {
        let ButtonEvent::Pressed(button) = payload.event else {
            return Ok(());
        };
        let reduction = self
            .staged
            .ui
            .reduce_one_button(BattleButtonEvent::Pressed {
                seat: payload.endpoint,
                button,
                menu_instance_id: payload.menu_instance_id,
            })?;
        if reduction.changed {
            let projection = self.staged.ui.projection();
            let (menu_instance_id, control_id, selected_option_id) = projection_menu(projection)
                .ok_or_else(|| BattleKernelError::Invariant {
                    reason: "changed Battle UI projection has no menu".to_owned(),
                })?;
            let control_id = control_id.to_owned();
            self.staged
                .game_mut()
                .sync_battle_ui_selection_in_kernel_transaction(
                    payload.endpoint,
                    menu_instance_id,
                    &control_id,
                    selected_option_id,
                )?;
            self.install_current_projection()?;
        }
        let events = reduction.intents.into_iter().map(ui_intent_event);
        self.queue.push_all_source_order(events);
        Ok(())
    }

    fn reduce_ui(&mut self, payload: UiEventPayload) -> Result<(), BattleKernelError> {
        let result = self
            .staged
            .game_mut()
            .reduce_ui_in_kernel_transaction(payload)?;
        match result {
            BattleUiResult::ControlChanged => self.install_current_projection(),
            BattleUiResult::CommandProposal(proposal) => {
                if self.staged.protocol.is_authority() {
                    let envelope = BattleProposalEnvelope::Command(proposal.clone());
                    if !self.admit_local_authority_proposal(&envelope)? {
                        return Ok(());
                    }
                    self.queue.push(InternalEvent::command_proposal(
                        proposal,
                        self.staged.protocol.authority_epoch(),
                    ));
                    Ok(())
                } else {
                    self.staged
                        .game_mut()
                        .retain_replica_command_in_kernel_transaction(proposal.clone())?;
                    self.arm_replica_proposal(BattleProposalEnvelope::Command(proposal))?;
                    self.install_current_projection()
                }
            }
            BattleUiResult::ReplacementProposal(proposal) => {
                let epoch = self.staged.protocol.authority_epoch();
                if self.staged.protocol.is_authority() {
                    let envelope = BattleProposalEnvelope::Replacement(proposal.clone());
                    if !self.admit_local_authority_proposal(&envelope)? {
                        return Ok(());
                    }
                    self.pending_replacements
                        .insert(proposal.operation_id.clone(), proposal.clone());
                    self.queue
                        .push(InternalEvent::replacement_proposal(proposal, epoch));
                    Ok(())
                } else {
                    self.staged
                        .game_mut()
                        .retain_replica_replacement_in_kernel_transaction(
                            proposal.clone(),
                            epoch,
                        )?;
                    self.arm_replica_proposal(BattleProposalEnvelope::Replacement(proposal))?;
                    self.install_current_projection()
                }
            }
        }
    }

    fn admit_local_authority_proposal(
        &mut self,
        envelope: &BattleProposalEnvelope,
    ) -> Result<bool, BattleKernelError> {
        let owner_seat = match envelope {
            BattleProposalEnvelope::Command(proposal) => proposal.owner_seat,
            BattleProposalEnvelope::Replacement(proposal) => proposal.owner_seat,
        };
        if owner_seat != self.staged.game.local_seat() {
            return Err(BattleKernelError::Invariant {
                reason: "authority-local proposal does not belong to the local authority seat"
                    .to_owned(),
            });
        }
        let identity = ProposalIdentity {
            operation_id: envelope.operation_id().clone(),
            fingerprint: envelope.fingerprint(),
        };
        let admission = match &mut self.staged.protocol {
            BattleProtocolState::Authority { proposals, .. } => proposals.admit(&identity),
            BattleProtocolState::Replica { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "replica attempted authority-local proposal admission".to_owned(),
                });
            }
        };
        match admission {
            ProposalAdmission::Admitted => Ok(true),
            ProposalAdmission::Duplicate => Ok(false),
            other => Err(BattleKernelError::Protocol {
                reason: format!("authority-local proposal admission failed: {other:?}"),
            }),
        }
    }

    fn reduce_game(
        &mut self,
        payload: er_game::internal_event::GameEventPayload,
    ) -> Result<(), BattleKernelError> {
        if !self.staged.protocol.is_authority() {
            return Err(BattleKernelError::Invariant {
                reason: "replica reached the authority game reducer".to_owned(),
            });
        }
        let reduction = self
            .staged
            .game_mut()
            .reduce_game_in_kernel_transaction(payload)?;
        if let Some(admission) = &reduction.admission {
            let operation_id = match admission {
                er_game::runtime::CommandAdmission::Accepted { operation_id, .. }
                | er_game::runtime::CommandAdmission::IdempotentDuplicate { operation_id } => {
                    operation_id
                }
            };
            if reduction.events.is_empty() {
                self.pending_replacements.remove(operation_id);
            }
        }
        self.queue.push_all_source_order(reduction.events);
        self.install_current_projection()?;
        Ok(())
    }

    fn reduce_battle_resolved(
        &mut self,
        payload: BattleResolvedPayload,
    ) -> Result<(), BattleKernelError> {
        let (context, log) = match &self.staged.protocol {
            BattleProtocolState::Authority { context, log, .. } => {
                (context.clone(), log.as_ref().clone())
            }
            BattleProtocolState::Replica { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "replica emitted BattleResolved".to_owned(),
                });
            }
        };
        let mut prepared = match payload.resolution {
            PreparedBattleResolution::Turn {
                digest_evidence,
                material_operation_id,
                next_control,
            } => {
                let transition = digest_evidence.transition();
                self.staged
                    .last_rng_audit
                    .extend(transition.rng_audit.iter().cloned());
                let human_proposals = transition
                    .accepted_commands
                    .entries
                    .iter()
                    .filter_map(|command| match command {
                        AcceptedBattleCommand::Human { proposal, .. } => Some(proposal.clone()),
                        AcceptedBattleCommand::ScriptedEnemy { .. } => None,
                    })
                    .collect();
                let prepared = self.staged.game.prepare_authority_turn(
                    digest_evidence,
                    &material_operation_id,
                    next_control,
                )?;
                let input = AuthorityTransactionInput {
                    state: self.staged.game.state(),
                    control: self.staged.game.control(),
                    menu_allocators: &self.staged.game.control().menu_allocators,
                    scripted_policy: self.staged.game.scripted_enemy_policy(),
                    authority_epoch: self.staged.protocol.authority_epoch(),
                    local_seat: self.staged.game.local_seat(),
                    authority_context: context,
                    authority_log: log,
                    scheduler: self.scheduler.clone(),
                };
                prepare_authority_turn(
                    input,
                    AuthorityTurnRequest {
                        human_proposals,
                        prepared,
                    },
                    self.staged.game.content(),
                )
                .map_err(|error| BattleKernelError::Protocol {
                    reason: format!(
                        "authority TURN_COMMIT preparation for {material_operation_id} failed: {error}"
                    ),
                })?
            }
            PreparedBattleResolution::Replacement {
                transition,
                material_operation_id,
                next_control,
            } => {
                let decision = match transition.selection {
                    ReplacementSelection::NoLegalReplacement => {
                        AuthorityReplacementDecision::NoLegalReplacement {
                            occurrence: transition.occurrence.id,
                        }
                    }
                    ReplacementSelection::Selected { .. } => {
                        let Some(proposal) =
                            self.pending_replacements.remove(&material_operation_id)
                        else {
                            return Err(BattleKernelError::Invariant {
                                reason: "resolved replacement lost its typed proposal".to_owned(),
                            });
                        };
                        AuthorityReplacementDecision::Proposal(proposal)
                    }
                };
                let prepared = self.staged.game.prepare_authority_replacement(
                    transition,
                    &material_operation_id,
                    next_control,
                )?;
                let input = AuthorityTransactionInput {
                    state: self.staged.game.state(),
                    control: self.staged.game.control(),
                    menu_allocators: &self.staged.game.control().menu_allocators,
                    scripted_policy: self.staged.game.scripted_enemy_policy(),
                    authority_epoch: self.staged.protocol.authority_epoch(),
                    local_seat: self.staged.game.local_seat(),
                    authority_context: context,
                    authority_log: log,
                    scheduler: self.scheduler.clone(),
                };
                prepare_authority_replacement(
                    input,
                    AuthorityReplacementRequest { decision, prepared },
                    self.staged.game.content(),
                )?
            }
        };
        let prepared_entry = prepared.take_prepared_entry();
        self.pending_authority = Some(prepared);
        self.queue.push(InternalEvent::AuthorityEntryReady(
            AuthorityEntryReadyPayload {
                prepared: prepared_entry,
            },
        ));
        Ok(())
    }

    fn reduce_authority_ready(
        &mut self,
        payload: AuthorityEntryReadyPayload,
    ) -> Result<(), BattleKernelError> {
        let prepared =
            self.pending_authority
                .as_ref()
                .ok_or_else(|| BattleKernelError::Invariant {
                    reason: "AuthorityEntryReady has no prepared transaction".to_owned(),
                })?;
        let entry = prepared.prepared_entry();
        if entry.revision != payload.prepared.revision
            || entry.operation_id != payload.prepared.operation_id
            || entry.kind != payload.prepared.kind
            || entry.material.digest != payload.prepared.material_digest
        {
            return Err(BattleKernelError::Invariant {
                reason: "AuthorityEntryReady identity diverged from the prepared log entry"
                    .to_owned(),
            });
        }
        let (kind, before_digest, after_digest, next_decision, allocator_before) =
            prepared_material_metadata(prepared.material());
        self.staged
            .game_mut()
            .install_material_in_kernel_transaction(
                before_digest,
                prepared.state().clone(),
                after_digest,
                prepared.operation_id(),
                next_decision,
                allocator_before.to_vec(),
                prepared.control().clone(),
            )?;
        self.queue
            .push(InternalEvent::MaterialInstalled(MaterialInstalledPayload {
                revision: entry.revision,
                result: EventApplyResult {
                    material_kind: kind,
                    operation_id: entry.operation_id.clone(),
                    before_digest: before_digest.clone(),
                    after_digest: after_digest.clone(),
                },
            }));
        Ok(())
    }

    fn reduce_material_installed(
        &mut self,
        payload: MaterialInstalledPayload,
    ) -> Result<(), BattleKernelError> {
        if let Some(prepared) = self.pending_authority.as_ref() {
            if prepared.prepared_entry().revision != payload.revision
                || prepared.operation_id() != &payload.result.operation_id
            {
                return Err(BattleKernelError::Invariant {
                    reason: "authority MaterialInstalled identity mismatch".to_owned(),
                });
            }
            self.queue
                .push(InternalEvent::ControlInstalled(ControlInstalledPayload {
                    revision: payload.revision,
                    operation_id: payload.result.operation_id,
                    control: prepared.control().clone(),
                    presentation_barrier: PresentationBarrier {
                        operation_id: prepared.operation_id().clone(),
                        pending_events: prepared.presentation().len(),
                    },
                }));
            return Ok(());
        }

        let pending =
            self.pending_replica_material
                .as_ref()
                .ok_or_else(|| BattleKernelError::Invariant {
                    reason: "replica MaterialInstalled has no applied material".to_owned(),
                })?;
        if pending.entry.revision != payload.revision
            || pending.entry.operation_id != payload.result.operation_id
        {
            return Err(BattleKernelError::Invariant {
                reason: "replica MaterialInstalled identity mismatch".to_owned(),
            });
        }
        let actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica { replica, .. } => replica
                .record_replica_stage(&pending.entry, ReplicaMechanicalStage::MaterialApplied)
                .map_err(protocol_error)?,
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority lost its prepared material before installation".to_owned(),
                });
            }
        };
        self.map_replica_actions(actions)?;
        Ok(())
    }

    fn reduce_control_installed(
        &mut self,
        payload: ControlInstalledPayload,
    ) -> Result<(), BattleKernelError> {
        if let Some(prepared) = self.pending_authority.take() {
            if prepared.prepared_entry().revision != payload.revision
                || prepared.operation_id() != &payload.operation_id
                || prepared.control() != &payload.control
                || payload.presentation_barrier.pending_events != prepared.presentation().len()
            {
                return Err(BattleKernelError::Invariant {
                    reason: "authority ControlInstalled identity mismatch".to_owned(),
                });
            }
            let validator = AuthorityStageValidator {
                state: self.staged.game.state(),
                control: self.staged.game.control(),
                scripted_policy: self.staged.game.scripted_enemy_policy(),
            };
            let published = prepared.publish_after_validation(&validator)?;
            self.install_published_authority(published, payload)?;
        } else if let Some(pending_terminal) = self.pending_replica_terminal.take() {
            if pending_terminal.entry.revision != payload.revision
                || pending_terminal.entry.operation_id != payload.operation_id
                || payload.control != *self.staged.game.control()
            {
                return Err(BattleKernelError::Invariant {
                    reason: "replica terminal ControlInstalled identity mismatch".to_owned(),
                });
            }
            self.validate_terminal_entry_identity(
                &pending_terminal.entry,
                &pending_terminal.material,
            )?;
            let actions = match &mut self.staged.protocol {
                BattleProtocolState::Replica { replica, .. } => replica
                    .record_replica_stage(
                        &pending_terminal.entry,
                        ReplicaMechanicalStage::ControlInstalled {
                            control_id: control_id_of(&pending_terminal.entry.next_control),
                        },
                    )
                    .map_err(protocol_error)?,
                BattleProtocolState::Authority { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "authority received replica terminal control stage".to_owned(),
                    });
                }
            };
            self.map_replica_actions(actions)?;
        } else {
            let pending = self.pending_replica_material.take().ok_or_else(|| {
                BattleKernelError::Invariant {
                    reason: "replica ControlInstalled has no material stage".to_owned(),
                }
            })?;
            if pending.entry.revision != payload.revision
                || pending.entry.operation_id != payload.operation_id
                || pending.applied.next_control != payload.control
            {
                return Err(BattleKernelError::Invariant {
                    reason: "replica ControlInstalled identity mismatch".to_owned(),
                });
            }
            let committed_local_proposals =
                committed_local_proposal_ids(&pending.entry, self.staged.game.local_seat())?;
            let actions = match &mut self.staged.protocol {
                BattleProtocolState::Replica { replica, .. } => replica
                    .record_replica_stage(
                        &pending.entry,
                        ReplicaMechanicalStage::ControlInstalled {
                            control_id: control_id_of(&pending.entry.next_control),
                        },
                    )
                    .map_err(protocol_error)?,
                BattleProtocolState::Authority { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "authority received replica control stage".to_owned(),
                    });
                }
            };
            self.map_replica_actions(actions)?;
            self.retire_local_proposal_leases(&committed_local_proposals)?;
            let revision = pending.entry.revision;
            let operation_id = pending.entry.operation_id.clone();
            self.install_presentation_plan(
                pending.entry.revision,
                pending.entry.operation_id,
                pending.applied.presentation,
            )?;
            self.resolve_pending_presentation_probe(revision, &operation_id)?;
        }

        if let Some(event) = self
            .staged
            .game_mut()
            .take_pending_no_legal_replacement_in_kernel_transaction()?
        {
            self.queue.push(event);
        }
        Ok(())
    }

    /// Publish the protocol-only terminal successor once the completed battle
    /// material has settled locally and the authority log has observed the
    /// same presentation stage from every configured peer.  The terminal
    /// candidate is derived from complete game/control state and the retained
    /// presentation plan, so it does not require a transient snapshot field.
    fn maybe_progress_authority_terminal(&mut self) -> Result<(), BattleKernelError> {
        let (control, outcome) = match &self.staged.protocol {
            BattleProtocolState::Authority { .. } => {
                let control = self.staged.game.control().clone();
                let mut outcome = None;
                for seat in &control.seats {
                    let BattleControl::Complete(seat_outcome) = &seat.control else {
                        return Ok(());
                    };
                    let seat_outcome = *seat_outcome;
                    if let Some(previous) = outcome {
                        if previous != seat_outcome {
                            return Err(BattleKernelError::Invariant {
                                reason: "completed battle seats disagree on outcome".to_owned(),
                            });
                        }
                    } else {
                        outcome = Some(seat_outcome);
                    }
                }
                let Some(outcome) = outcome else {
                    return Ok(());
                };
                if outcome == er_types::battle_model::BattleOutcome::Ongoing {
                    return Ok(());
                }
                (control, outcome)
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        };

        let terminal_operation_id = battle_terminal_operation_id(&control, outcome)?;
        let terminal_state = TerminalState {
            terminal_id: terminal_operation_id.to_string(),
            reason: "game-over".to_owned(),
        };
        let battle_operation_id = self
            .staged
            .presentations
            .plan()
            .map(|plan| plan.operation_id().clone())
            .or_else(|| match &self.staged.protocol {
                BattleProtocolState::Authority { log, .. } => log
                    .retained_entry(log.head_revision())
                    .filter(|entry| {
                        matches!(
                            entry.kind,
                            AuthorityEntryKind::TurnCommit | AuthorityEntryKind::ReplacementCommit
                        )
                    })
                    .map(|entry| entry.operation_id.clone()),
                BattleProtocolState::Replica { .. } => None,
            });
        let Some(battle_operation_id) = battle_operation_id else {
            return Ok(());
        };

        let (context, terminal_published, terminal_quorum, battle_quorum, latest_entry, subsumes) =
            match &self.staged.protocol {
                BattleProtocolState::Authority { context, log, .. } => {
                    let retained = log.retained();
                    let terminal_published = retained.iter().any(|entry| {
                        entry.operation_id == terminal_operation_id
                            && entry.kind == AuthorityEntryKind::TerminalCommit
                    }) || log
                        .peer_stage_quorum(&terminal_operation_id, AckStage::Admitted);
                    let terminal_quorum = log
                        .peer_stage_quorum(&terminal_operation_id, AckStage::PresentationSettled);
                    let battle_quorum =
                        log.peer_stage_quorum(&battle_operation_id, AckStage::PresentationSettled);
                    let latest_entry = log.retained_entry(log.head_revision()).cloned();
                    let mut subsumes = retained
                        .into_iter()
                        .filter(|entry| entry.kind != AuthorityEntryKind::TerminalCommit)
                        .map(|entry| entry.revision)
                        .collect::<Vec<_>>();
                    subsumes.sort_unstable();
                    subsumes.dedup();
                    (
                        context.clone(),
                        terminal_published,
                        terminal_quorum,
                        battle_quorum,
                        latest_entry,
                        subsumes,
                    )
                }
                BattleProtocolState::Replica { .. } => return Ok(()),
            };

        if terminal_published {
            if terminal_quorum {
                self.enter_terminal_state(terminal_state)?;
            }
            return Ok(());
        }

        let local_settled = !self
            .staged
            .presentations
            .pending_ids()
            .iter()
            .any(|event| event.operation_id == battle_operation_id);
        if !local_settled || !battle_quorum {
            return Ok(());
        }

        if let Some(entry) = latest_entry {
            if entry.operation_id != battle_operation_id
                || !matches!(
                    entry.kind,
                    AuthorityEntryKind::TurnCommit | AuthorityEntryKind::ReplacementCommit
                )
            {
                return Err(BattleKernelError::Invariant {
                    reason: "completed battle does not retain its final battle material entry"
                        .to_owned(),
                });
            }
            let expected_wait = protocol_next_control_from_plan(
                &entry.operation_id,
                er_battle::BattleNextDecision::Complete(outcome),
                &control,
                self.staged.protocol.authority_epoch(),
            )?;
            if entry.next_control != expected_wait {
                return Err(BattleKernelError::Invariant {
                    reason: "completed battle entry does not expose its exact terminal wait"
                        .to_owned(),
                });
            }
        }

        let terminal = BattleTerminalMaterialV1::new(
            terminal_operation_id.to_string(),
            BattleTerminalReasonV1::GameOver,
            control.wave,
            control.turn,
        )
        .map_err(|error| BattleKernelError::Protocol {
            reason: format!("terminal material construction failed: {error}"),
        })?;
        let draft = build_battle_terminal_commit_draft(
            context,
            terminal_operation_id.clone(),
            terminal,
            subsumes,
        )
        .map_err(|error| BattleKernelError::Protocol {
            reason: format!("terminal material draft failed: {error}"),
        })?;
        let commit = match &mut self.staged.protocol {
            BattleProtocolState::Authority { log, .. } => Arc::make_mut(log)
                .commit(draft, &mut self.scheduler)
                .map_err(|error| match error {
                    er_protocol::authority_log::AuthorityLogError::Scheduler(error) => {
                        BattleKernelError::Authority(AuthorityTransactionError::Scheduler(error))
                    }
                    other => BattleKernelError::Protocol {
                        reason: format!(
                            "terminal authority commit for {terminal_operation_id} failed: {other}"
                        ),
                    },
                })?,
            BattleProtocolState::Replica { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "replica attempted to publish terminal material".to_owned(),
                });
            }
        };
        map_authority_actions(&mut self.effects, commit.actions)?;
        let terminal_quorum = match &self.staged.protocol {
            BattleProtocolState::Authority { log, .. } => {
                log.peer_stage_quorum(&terminal_operation_id, AckStage::PresentationSettled)
            }
            BattleProtocolState::Replica { .. } => false,
        };
        if terminal_quorum {
            self.enter_terminal_state(terminal_state)?;
        }
        Ok(())
    }

    fn install_published_authority(
        &mut self,
        published: AuthorityPublishedTransaction,
        payload: ControlInstalledPayload,
    ) -> Result<(), BattleKernelError> {
        if published.state != *self.staged.game.state()
            || published.control != *self.staged.game.control()
            || published.scripted_policy_after != *self.staged.game.scripted_enemy_policy()
            || published.operation_id != payload.operation_id
        {
            return Err(BattleKernelError::Invariant {
                reason: "published authority transaction diverged from staged game".to_owned(),
            });
        }
        let revision = published.commit.entry.revision;
        let operation_id = published.operation_id;
        let presentation = published.presentation;
        self.scheduler = published.scheduler;
        match &mut self.staged.protocol {
            BattleProtocolState::Authority { log, .. } => *log = Arc::new(published.log),
            BattleProtocolState::Replica { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "published authority transaction installed on replica".to_owned(),
                });
            }
        }
        map_authority_actions(&mut self.effects, published.commit.actions)?;
        self.install_presentation_plan(revision, operation_id, presentation)?;
        self.maybe_progress_authority_terminal()
    }

    fn install_presentation_plan(
        &mut self,
        revision: Revision,
        operation_id: er_types::OperationId,
        events: Vec<BattlePresentationEvent>,
    ) -> Result<(), BattleKernelError> {
        self.staged
            .presentations
            .install_plan(operation_id, events.clone())?;
        for event in &events {
            self.staged
                .presentation_revisions
                .insert(event.event_id.clone(), revision);
        }
        self.install_current_projection()?;
        for event in events {
            self.effects.push(KernelEffect::PresentBattle {
                endpoint: self.staged.game.local_seat(),
                event,
            });
        }
        Ok(())
    }

    fn install_current_projection(&mut self) -> Result<(), BattleKernelError> {
        let projection = projection_for(
            &self.staged.game,
            &self.staged.presentations,
            self.staged.suspended
                || self.staged.terminal_fenced
                || self.staged.protocol.recovery_fenced(),
        )?;
        if self.staged.ui.projection() != &projection {
            self.staged.ui.install_projection(projection.clone())?;
            self.effects.push(KernelEffect::BattleUiChanged {
                endpoint: self.staged.game.local_seat(),
                projection,
            });
        }
        Ok(())
    }

    fn arm_replica_proposal(
        &mut self,
        envelope: BattleProposalEnvelope,
    ) -> Result<(), BattleKernelError> {
        let (context, authority_seat, authority_generation) = match &self.staged.protocol {
            BattleProtocolState::Replica {
                context,
                authority_seat,
                authority_generation,
                ..
            } => (context.clone(), *authority_seat, *authority_generation),
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority attempted to arm a replica proposal lease".to_owned(),
                });
            }
        };
        let proposal = ProposalMessage {
            operation_id: envelope.operation_id().clone(),
            fingerprint: envelope.fingerprint(),
            from: context.sender_seat_id,
            to: authority_seat,
            connection_generation: authority_generation,
            payload: serde_json::to_value(envelope).map_err(|error| {
                BattleKernelError::Protocol {
                    reason: format!("proposal encoding failed: {error}"),
                }
            })?,
        };
        let outcome = match &mut self.staged.protocol {
            BattleProtocolState::Replica { leases, .. } => leases
                .arm(
                    ProposalLeaseSpec {
                        proposal,
                        absolute_ceiling_ms: None,
                    },
                    &mut self.scheduler,
                )
                .map_err(protocol_error)?,
            BattleProtocolState::Authority { .. } => unreachable!(),
        };
        match outcome.result {
            ProposalLeaseStart::Retained | ProposalLeaseStart::AlreadyRetained => {
                self.apply_proposal_actions(outcome.actions)?;
                Ok(())
            }
            ProposalLeaseStart::AlreadyCommitted => Ok(()),
            other => Err(BattleKernelError::Protocol {
                reason: format!("proposal lease rejected: {other:?}"),
            }),
        }
    }

    fn receive_proposal(
        &mut self,
        endpoint: SeatId,
        proposal: ProposalMessage,
    ) -> Result<(), BattleKernelError> {
        let (context, admitted_peer) = match &mut self.staged.protocol {
            BattleProtocolState::Authority {
                context,
                peer_bindings,
                proposals,
                ..
            } => {
                if endpoint != context.sender_seat_id || proposal.to != context.sender_seat_id {
                    return Ok(());
                }
                let local = proposal.from == context.sender_seat_id;
                if local {
                    return Err(BattleKernelError::TerminalRequired {
                        reason: "externally delivered proposal forged the authority sender"
                            .to_owned(),
                    });
                }
                if !peer_bindings.iter().any(|binding| {
                    binding.seat_id == proposal.from
                        && binding.connection_generation == proposal.connection_generation
                }) {
                    return Ok(());
                }
                let admission = proposals.admit(&ProposalIdentity {
                    operation_id: proposal.operation_id.clone(),
                    fingerprint: proposal.fingerprint.clone(),
                });
                match admission {
                    ProposalAdmission::Duplicate => return Ok(()),
                    ProposalAdmission::Admitted => (context.clone(), true),
                    other => {
                        return Err(BattleKernelError::Protocol {
                            reason: format!("authority proposal admission failed: {other:?}"),
                        });
                    }
                }
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        };
        let envelope: BattleProposalEnvelope =
            serde_json::from_value(proposal.payload).map_err(|error| {
                BattleKernelError::Protocol {
                    reason: format!("typed proposal decode failed: {error}"),
                }
            })?;
        if envelope.operation_id() != &proposal.operation_id
            || envelope.fingerprint() != proposal.fingerprint
        {
            return Err(BattleKernelError::Protocol {
                reason: "proposal envelope identity/fingerprint mismatch".to_owned(),
            });
        }
        let owner_seat = match &envelope {
            BattleProposalEnvelope::Command(value) => value.owner_seat,
            BattleProposalEnvelope::Replacement(value) => value.owner_seat,
        };
        if owner_seat != proposal.from {
            return Err(BattleKernelError::TerminalRequired {
                reason: "proposal envelope owner does not match its authenticated sender"
                    .to_owned(),
            });
        }
        if admitted_peer && proposal.connection_generation == ConnectionGeneration::ZERO {
            return Err(BattleKernelError::Protocol {
                reason: "remote proposal has a zero connection generation".to_owned(),
            });
        }
        let epoch = AuthorityEpoch::new(context.session_epoch);
        match envelope {
            BattleProposalEnvelope::Command(value) => {
                self.queue
                    .push(InternalEvent::command_proposal(value, epoch));
            }
            BattleProposalEnvelope::Replacement(value) => {
                self.pending_replacements
                    .insert(value.operation_id.clone(), value.clone());
                self.queue
                    .push(InternalEvent::replacement_proposal(value, epoch));
            }
        }
        Ok(())
    }

    fn receive_raw_frame(
        &mut self,
        endpoint: SeatId,
        raw: RawFrame,
    ) -> Result<(), BattleKernelError> {
        match FrameValidator::new().validate(&raw) {
            InboundFrameResult::Valid { frame } => self.receive_validated_frame(endpoint, *frame),
            InboundFrameResult::CosmeticDrop { .. } => Ok(()),
            InboundFrameResult::ProtocolViolation { frame_type, issues } => {
                self.enter_terminal(format!(
                    "inbound frame protocol violation {frame_type:?}: {issues:?}"
                ))?;
                Ok(())
            }
        }
    }

    fn receive_validated_frame(
        &mut self,
        endpoint: SeatId,
        validated: ValidatedFrame,
    ) -> Result<(), BattleKernelError> {
        let context = validated.frame.context;
        match validated.body {
            ValidatedFrameBody::AuthorityEntry(body) => {
                self.receive_authority_entry(endpoint, context, body)
            }
            ValidatedFrameBody::AuthorityReceipt(body) => {
                self.receive_authority_receipt(endpoint, context, body)
            }
            ValidatedFrameBody::TailRequest(body) => {
                self.receive_tail_request(endpoint, context, body)
            }
            ValidatedFrameBody::TailProof(body) => self.receive_tail_proof(endpoint, context, body),
            ValidatedFrameBody::RecoveryRequest(body) => {
                self.receive_recovery_request(endpoint, context, body)
            }
            ValidatedFrameBody::RecoveryBundle(body) => {
                self.receive_recovery_bundle(endpoint, context, body)
            }
            ValidatedFrameBody::RecoveryApplied(proof) => {
                self.receive_recovery_applied(endpoint, context, proof)
            }
            ValidatedFrameBody::Terminal(body) => {
                if self
                    .staged
                    .protocol
                    .accepts_remote_frame(endpoint, &context)
                {
                    self.enter_terminal_state(TerminalState {
                        terminal_id: body.terminal_id,
                        reason: body.reason,
                    })?;
                }
                Ok(())
            }
        }
    }

    fn receive_authority_entry(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: AuthorityEntryBody,
    ) -> Result<(), BattleKernelError> {
        if self.staged.protocol.recovery_fenced() {
            return Ok(());
        }
        let entry = body.with_context(context.clone());
        let step = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                context: local_context,
                authority_seat,
                authority_generation,
                replica,
                ..
            } => {
                if !replica_accepts_authority_frame(
                    local_context,
                    *authority_seat,
                    *authority_generation,
                    endpoint,
                    &context,
                ) {
                    return Ok(());
                }
                replica.admit(entry)
            }
            BattleProtocolState::Authority { .. } => return Ok(()),
        };
        match step.admission {
            ReplicaAdmission::Rejected { reason } => {
                self.enter_terminal(format!("authority entry rejected: {reason:?}"))?;
                Ok(())
            }
            ReplicaAdmission::Duplicate {
                resume: er_protocol::ReplicaResume::ControlInstalled,
            } => self.map_replica_actions_with_probe_mode(step.actions, true),
            ReplicaAdmission::Admitted { .. }
            | ReplicaAdmission::Duplicate { .. }
            | ReplicaAdmission::Gap { .. } => self.map_replica_actions(step.actions),
        }
    }

    fn receive_authority_receipt(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: AuthorityReceiptBody,
    ) -> Result<(), BattleKernelError> {
        let actions = match &mut self.staged.protocol {
            BattleProtocolState::Authority {
                context: authority_context,
                peer_bindings,
                log,
                ..
            } => {
                if !authority_accepts_peer_frame(
                    authority_context,
                    peer_bindings,
                    endpoint,
                    &context,
                ) {
                    return Ok(());
                }
                let receipt = AuthorityReceipt {
                    context,
                    revision: body.revision,
                    operation_id: body.operation_id,
                    stage: body.stage,
                    control_id: body.control_id,
                };
                Arc::make_mut(log)
                    .accept_receipt_detailed(receipt, &mut self.scheduler)
                    .actions
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        };
        map_authority_actions(&mut self.effects, actions)?;
        self.maybe_progress_authority_terminal()?;
        Ok(())
    }

    fn receive_tail_request(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: TailRequestBody,
    ) -> Result<(), BattleKernelError> {
        if body.request_id.is_some() {
            let actions = match &mut self.staged.protocol {
                BattleProtocolState::Authority {
                    context: authority_context,
                    peer_bindings,
                    log,
                    ..
                } => {
                    if !authority_accepts_peer_frame(
                        authority_context,
                        peer_bindings,
                        endpoint,
                        &context,
                    ) {
                        return Ok(());
                    }
                    Arc::make_mut(log).handle_tail_proof_request(context, body)
                }
                BattleProtocolState::Replica { .. } => return Ok(()),
            };
            map_authority_actions(&mut self.effects, actions)?;
            return Ok(());
        }
        let (from, entries) = match &self.staged.protocol {
            BattleProtocolState::Authority {
                context: authority_context,
                peer_bindings,
                log,
                ..
            } => {
                if !authority_accepts_peer_frame(
                    authority_context,
                    peer_bindings,
                    endpoint,
                    &context,
                ) {
                    return Ok(());
                }
                let captured = previous_revision(body.from_revision).unwrap_or(Revision::ZERO);
                let Some(slice) = log.recovery_slice(captured) else {
                    return Ok(());
                };
                (authority_context.sender_seat_id, slice.required_tail)
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        };
        for entry in entries {
            let frame = crate::kernel::authority_entry_frame(&entry)
                .map_err(|reason| BattleKernelError::Protocol { reason })?;
            self.effects.push(KernelEffect::SendFrame { from, frame });
        }
        Ok(())
    }

    fn receive_tail_proof(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: TailProofBody,
    ) -> Result<(), BattleKernelError> {
        let disposition = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                context: local_context,
                authority_seat,
                authority_generation,
                replica,
                ..
            } => {
                if !replica_accepts_authority_frame(
                    local_context,
                    *authority_seat,
                    *authority_generation,
                    endpoint,
                    &context,
                ) {
                    return Ok(());
                }
                replica.accept_tail_proof(&context, &body)
            }
            BattleProtocolState::Authority { .. } => return Ok(()),
        };
        match disposition {
            ReplicaTailProofDisposition::Ignored { .. } | ReplicaTailProofDisposition::Pending => {
                Ok(())
            }
            ReplicaTailProofDisposition::Rejected { reason } => {
                self.enter_terminal(format!("tail proof rejected: {reason}"))?;
                Ok(())
            }
            ReplicaTailProofDisposition::Completed { step } => match &step.admission {
                ReplicaAdmission::Rejected { reason } => {
                    self.enter_terminal(format!("tail proof candidate rejected: {reason:?}"))?;
                    Ok(())
                }
                ReplicaAdmission::Duplicate {
                    resume: er_protocol::ReplicaResume::ControlInstalled,
                } => self.map_replica_actions_with_probe_mode(step.actions, true),
                ReplicaAdmission::Admitted { .. }
                | ReplicaAdmission::Duplicate { .. }
                | ReplicaAdmission::Gap { .. } => self.map_replica_actions(step.actions),
            },
        }
    }

    fn receive_recovery_request(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: RecoveryRequestBody,
    ) -> Result<(), BattleKernelError> {
        let mut conflict = false;
        let response = match &mut self.staged.protocol {
            BattleProtocolState::Authority {
                context: authority_context,
                peer_bindings,
                log,
                pending_recoveries,
                ..
            } => {
                if !authority_accepts_peer_frame(
                    authority_context,
                    peer_bindings,
                    endpoint,
                    &context,
                ) {
                    return Ok(());
                }
                if let Some(expected) = pending_recoveries.get(&body.request_id) {
                    let exact = expected.peer == context.sender_seat_id
                        && expected.context == context
                        && expected.captured_frontier == body.captured_frontier
                        && expected.reason == body.reason;
                    if exact {
                        Some((
                            authority_context.sender_seat_id,
                            expected.response_frame.clone(),
                        ))
                    } else {
                        conflict = true;
                        None
                    }
                } else {
                    let Some(slice) = log.recovery_slice(body.captured_frontier) else {
                        return Ok(());
                    };
                    let frame = crate::kernel::recovery_bundle_frame(
                        authority_context,
                        body.request_id.clone(),
                        authority_context.membership_revision,
                        &slice,
                    )
                    .map_err(|reason| BattleKernelError::Protocol { reason })?;
                    pending_recoveries.insert(
                        body.request_id.clone(),
                        BattlePendingRecovery {
                            peer: context.sender_seat_id,
                            context: context.clone(),
                            captured_frontier: body.captured_frontier,
                            reason: body.reason,
                            frontier: slice.frontier,
                            material_digest: crate::kernel::recovery_material_digest(&slice),
                            control_id: slice.next_control.as_ref().map(control_id_of),
                            response_frame: frame.clone(),
                        },
                    );
                    Some((authority_context.sender_seat_id, frame))
                }
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        };
        if conflict {
            self.enter_terminal(
                "recovery request identity conflicts with a live request".to_owned(),
            )?;
        } else if let Some((from, frame)) = response {
            self.effects.push(KernelEffect::SendFrame { from, frame });
        }
        Ok(())
    }

    fn receive_recovery_bundle(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: RecoveryBundleBody,
    ) -> Result<(), BattleKernelError> {
        let bundle = body.with_context(context.clone());
        // A terminal recovery entry must finish its ordered recovery proof
        // before shared-terminal cleanup clears the recovery owner. This is
        // transaction-local and never crosses a snapshot boundary.
        self.defer_terminalization = true;
        let accept_actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                context: local_context,
                authority_seat,
                authority_generation,
                replica,
                recovery,
                ..
            } => {
                if !replica_accepts_authority_frame(
                    local_context,
                    *authority_seat,
                    *authority_generation,
                    endpoint,
                    &context,
                ) {
                    return Ok(());
                }
                let live = RecoveryLiveState {
                    frontier: replica.frontier(),
                    context: local_context.clone(),
                };
                recovery
                    .accept_bundle(bundle.clone(), live, &mut self.scheduler)
                    .map_err(protocol_error)?
            }
            BattleProtocolState::Authority { .. } => return Ok(()),
        };

        let mut apply_material = None;
        for action in accept_actions {
            match action {
                RecoveryAction::FenceChanged { .. } => {}
                RecoveryAction::Scheduler { command } => {
                    map_scheduler_command(&mut self.effects, command);
                }
                RecoveryAction::ApplyMaterial {
                    request_id,
                    material,
                } => {
                    if apply_material.replace((request_id, material)).is_some() {
                        return Err(BattleKernelError::Invariant {
                            reason: "recovery bundle emitted duplicate material work".to_owned(),
                        });
                    }
                }
                RecoveryAction::Terminalize { reason } => {
                    return Err(BattleKernelError::TerminalRequired { reason });
                }
                RecoveryAction::SendRequest { .. }
                | RecoveryAction::StageRecoveredFrontier { .. }
                | RecoveryAction::ProjectControl { .. }
                | RecoveryAction::SendAppliedProof { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "recovery bundle validation emitted an out-of-phase action"
                            .to_owned(),
                    });
                }
            }
        }
        let Some((request_id, material)) = apply_material else {
            return Err(BattleKernelError::Invariant {
                reason: "accepted recovery bundle emitted no material action".to_owned(),
            });
        };
        if request_id != bundle.request_id || material != bundle.material {
            return Err(BattleKernelError::Invariant {
                reason: "recovery material action diverged from the retained bundle".to_owned(),
            });
        }

        let already_installed = match &self.staged.protocol {
            BattleProtocolState::Replica { replica, .. } => {
                let frontier = replica.frontier();
                bundle.frontier != Revision::ZERO
                    && frontier.received == bundle.frontier
                    && frontier.material == bundle.frontier
                    && frontier.control == bundle.frontier
            }
            BattleProtocolState::Authority { .. } => false,
        };
        let applied_tail = self.apply_recovery_tail(&bundle, already_installed)?;
        let material_actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                context,
                replica,
                recovery,
                ..
            } => {
                let live = RecoveryLiveState {
                    frontier: replica.frontier(),
                    context: context.clone(),
                };
                recovery
                    .material_result(RecoveryMaterialOutcome::Applied, live, &mut self.scheduler)
                    .map_err(protocol_error)?
            }
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority consumed replica recovery material".to_owned(),
                });
            }
        };

        let mut recovered_entry = None;
        let mut completed_without_frontier = false;
        for action in material_actions {
            match action {
                RecoveryAction::FenceChanged { .. } => {}
                RecoveryAction::Scheduler { command } => {
                    map_scheduler_command(&mut self.effects, command);
                }
                RecoveryAction::StageRecoveredFrontier { entry } => {
                    if recovered_entry.replace(entry).is_some() {
                        return Err(BattleKernelError::Invariant {
                            reason: "recovery material emitted duplicate frontier work".to_owned(),
                        });
                    }
                }
                RecoveryAction::SendAppliedProof { proof } => {
                    self.emit_recovery_applied_proof(proof)?;
                    completed_without_frontier = true;
                }
                RecoveryAction::Terminalize { reason } => {
                    return Err(BattleKernelError::TerminalRequired { reason });
                }
                RecoveryAction::SendRequest { .. }
                | RecoveryAction::ApplyMaterial { .. }
                | RecoveryAction::ProjectControl { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "recovery material completion emitted an out-of-phase action"
                            .to_owned(),
                    });
                }
            }
        }

        if bundle.frontier == Revision::ZERO {
            if recovered_entry.is_some() || !applied_tail.is_empty() || !completed_without_frontier
            {
                return Err(BattleKernelError::Invariant {
                    reason: "zero-frontier recovery did not complete as an empty proof".to_owned(),
                });
            }
            self.defer_terminalization = false;
            return self.install_current_projection();
        }
        if completed_without_frontier {
            return Err(BattleKernelError::Invariant {
                reason: "positive recovery completed before staging its frontier".to_owned(),
            });
        }
        let recovered_entry = recovered_entry.ok_or_else(|| BattleKernelError::Invariant {
            reason: "positive recovery emitted no recovered frontier".to_owned(),
        })?;
        let final_material = applied_tail
            .last()
            .ok_or_else(|| BattleKernelError::Invariant {
                reason: "positive recovery applied no material entry".to_owned(),
            })?;
        if let RecoveredMaterial::Terminal { entry, material } = final_material {
            self.validate_terminal_entry_identity(entry, material)?;
        }
        let final_entry = final_material.entry().clone();
        let terminal_final = final_entry.kind == AuthorityEntryKind::TerminalCommit;
        let final_battle_applied = final_material.battle_apply().cloned();
        let terminal_predecessor_frontier_ready =
            terminal_final && self.replica_has_terminal_predecessor_frontier(&final_entry);
        if recovered_entry != final_entry || recovered_entry.revision != bundle.frontier {
            return Err(BattleKernelError::Invariant {
                reason: "recovery staged a frontier other than the applied final entry".to_owned(),
            });
        }
        if terminal_final {
            if !already_installed {
                let previous_battle_is_present =
                    applied_tail.iter().rev().nth(1).is_some_and(|previous| {
                        previous.entry().kind != AuthorityEntryKind::TerminalCommit
                            && previous.battle_apply().is_some_and(|applied| {
                                applied.next_control == *self.staged.game.control()
                            })
                    });
                if !previous_battle_is_present && !terminal_predecessor_frontier_ready {
                    return Err(BattleKernelError::TerminalRequired {
                        reason: "terminal recovery has neither a preceding battle entry nor an admitted complete predecessor frontier".to_owned(),
                    });
                }
            }
        } else if final_battle_applied
            .as_ref()
            .is_none_or(|applied| applied.next_control != *self.staged.game.control())
        {
            return Err(BattleKernelError::TerminalRequired {
                reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
            });
        }

        let replica_stage_actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica { replica, .. } => replica
                .stage_recovered_frontier(recovered_entry.clone())
                .map_err(|_| BattleKernelError::TerminalRequired {
                    reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
                })?,
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority staged a replica recovery frontier".to_owned(),
                });
            }
        };
        let expected_control_id = control_id_of(&recovered_entry.next_control);
        if replica_stage_actions.as_slice()
            != [ReplicaAction::ProjectControl {
                entry: recovered_entry.clone(),
                expected_control_id: expected_control_id.clone(),
            }]
        {
            return Err(BattleKernelError::Invariant {
                reason: "replica did not retain the exact recovered entry for control".to_owned(),
            });
        }

        let frontier_actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                context,
                replica,
                recovery,
                ..
            } => {
                let live = RecoveryLiveState {
                    frontier: replica.frontier(),
                    context: context.clone(),
                };
                recovery
                    .recovered_frontier_staged(
                        RecoveryFrontierStagingOutcome::Staged {
                            revision: recovered_entry.revision,
                        },
                        live,
                        &mut self.scheduler,
                    )
                    .map_err(protocol_error)?
            }
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority advanced a replica recovery transaction".to_owned(),
                });
            }
        };

        let mut project_control = None;
        for action in frontier_actions {
            match action {
                RecoveryAction::FenceChanged { .. } => {}
                RecoveryAction::Scheduler { command } => {
                    map_scheduler_command(&mut self.effects, command);
                }
                RecoveryAction::ProjectControl {
                    revision,
                    control,
                    expected_control_id,
                } => {
                    if project_control
                        .replace((revision, control, expected_control_id))
                        .is_some()
                    {
                        return Err(BattleKernelError::Invariant {
                            reason: "recovery emitted duplicate control projection".to_owned(),
                        });
                    }
                }
                RecoveryAction::Terminalize { reason } => {
                    return Err(BattleKernelError::TerminalRequired { reason });
                }
                RecoveryAction::SendRequest { .. }
                | RecoveryAction::ApplyMaterial { .. }
                | RecoveryAction::StageRecoveredFrontier { .. }
                | RecoveryAction::SendAppliedProof { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "recovered frontier emitted an out-of-phase action".to_owned(),
                    });
                }
            }
        }
        let Some((revision, control, projected_control_id)) = project_control else {
            return Err(BattleKernelError::Invariant {
                reason: "recovered frontier emitted no exact control projection".to_owned(),
            });
        };
        if revision != recovered_entry.revision
            || control != recovered_entry.next_control
            || projected_control_id != expected_control_id
        {
            return Err(BattleKernelError::TerminalRequired {
                reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
            });
        }

        let replica_actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica { replica, .. } => {
                let outcome = if already_installed {
                    ControlProjectionOutcome::AlreadyInstalled {
                        control_id: expected_control_id.clone(),
                    }
                } else {
                    ControlProjectionOutcome::Installed {
                        control_id: expected_control_id.clone(),
                    }
                };
                replica
                    .control_result(recovered_entry.revision, outcome)
                    .map_err(|_| BattleKernelError::TerminalRequired {
                        reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
                    })?
            }
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority installed replica recovery control".to_owned(),
                });
            }
        };
        self.map_replica_actions(replica_actions)?;

        let control_actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                context,
                replica,
                recovery,
                ..
            } => {
                let live = RecoveryLiveState {
                    frontier: replica.frontier(),
                    context: context.clone(),
                };
                let outcome = if already_installed {
                    ControlProjectionOutcome::AlreadyInstalled {
                        control_id: expected_control_id,
                    }
                } else {
                    ControlProjectionOutcome::Installed {
                        control_id: expected_control_id,
                    }
                };
                recovery
                    .control_result(outcome, live, &mut self.scheduler)
                    .map_err(protocol_error)?
            }
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority completed a replica recovery transaction".to_owned(),
                });
            }
        };
        let mut proof_emitted = false;
        for action in control_actions {
            match action {
                RecoveryAction::FenceChanged { .. } => {}
                RecoveryAction::Scheduler { command } => {
                    map_scheduler_command(&mut self.effects, command);
                }
                RecoveryAction::SendAppliedProof { proof } => {
                    self.emit_recovery_applied_proof(proof)?;
                    proof_emitted = true;
                }
                RecoveryAction::Terminalize { reason } => {
                    return Err(BattleKernelError::TerminalRequired { reason });
                }
                RecoveryAction::SendRequest { .. }
                | RecoveryAction::ApplyMaterial { .. }
                | RecoveryAction::StageRecoveredFrontier { .. }
                | RecoveryAction::ProjectControl { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "recovery control completion emitted an out-of-phase action"
                            .to_owned(),
                    });
                }
            }
        }
        if !proof_emitted {
            return Err(BattleKernelError::Invariant {
                reason: "recovery control completed without an applied proof".to_owned(),
            });
        }

        for material in &applied_tail {
            if material.entry().kind == AuthorityEntryKind::TerminalCommit {
                continue;
            }
            let operation_ids =
                committed_local_proposal_ids(material.entry(), self.staged.game.local_seat())?;
            self.retire_local_proposal_leases(&operation_ids)?;
        }

        let final_revision = recovered_entry.revision;
        let final_operation_id = recovered_entry.operation_id.clone();
        let final_index = applied_tail.len().saturating_sub(1);
        if !already_installed {
            for (index, material) in applied_tail.into_iter().enumerate() {
                let Some(applied) = material.battle_apply().cloned() else {
                    continue;
                };
                let entry = material.entry().clone();
                let event_ids = applied
                    .presentation
                    .iter()
                    .map(|event| event.event_id.clone())
                    .collect::<Vec<_>>();
                self.install_presentation_plan(
                    entry.revision,
                    entry.operation_id,
                    applied.presentation,
                )?;
                if index != final_index {
                    for event_id in event_ids {
                        self.staged.presentation_revisions.remove(&event_id);
                    }
                }
            }
        }
        if !terminal_final {
            self.resolve_pending_presentation_probe(final_revision, &final_operation_id)?;
            self.defer_terminalization = false;
        } else if let Some(terminal) = self.deferred_terminal.take() {
            self.defer_terminalization = false;
            self.enter_terminal_state(terminal)?;
            return Ok(());
        } else {
            return Err(BattleKernelError::Invariant {
                reason: "terminal recovery completed without a deferred terminal transition"
                    .to_owned(),
            });
        }
        if let Some(event) = self
            .staged
            .game_mut()
            .take_pending_no_legal_replacement_in_kernel_transaction()?
        {
            self.queue.push(event);
        }
        self.install_current_projection()
    }

    fn apply_recovery_tail(
        &mut self,
        bundle: &RecoveryBundle,
        already_installed: bool,
    ) -> Result<Vec<RecoveredMaterial>, BattleKernelError> {
        let mut applied_tail = Vec::with_capacity(bundle.required_tail.len());
        for (index, entry) in bundle.required_tail.iter().enumerate() {
            if entry.kind == AuthorityEntryKind::TerminalCommit {
                if index + 1 != bundle.required_tail.len() {
                    return Err(BattleKernelError::TerminalRequired {
                        reason: "terminal recovery material must be the final protocol entry"
                            .to_owned(),
                    });
                }
                let terminal = validate_battle_terminal_commit(entry).map_err(|error| {
                    BattleKernelError::TerminalRequired {
                        reason: format!("malformed terminal recovery material: {error}"),
                    }
                })?;
                self.validate_terminal_entry_identity(entry, &terminal)?;
                if already_installed && bundle.required_tail.len() != 1 {
                    return Err(BattleKernelError::TerminalRequired {
                        reason: "already-installed terminal recovery requires an exact terminal reconstruction entry"
                            .to_owned(),
                    });
                }
                let predecessor_frontier_ready =
                    self.replica_has_terminal_predecessor_frontier(entry);
                if !already_installed
                    && !applied_tail
                        .iter()
                        .any(|item| matches!(item, RecoveredMaterial::Battle { .. }))
                    && !predecessor_frontier_ready
                {
                    return Err(BattleKernelError::TerminalRequired {
                        reason:
                            "terminal recovery must apply a battle entry before the terminal entry"
                                .to_owned(),
                    });
                }
                applied_tail.push(RecoveredMaterial::Terminal {
                    entry: entry.clone(),
                    material: terminal,
                });
                continue;
            }
            let current = if already_installed {
                recovery_reconstruction_context(entry, self.staged.game.local_seat()).map_err(
                    |_| BattleKernelError::TerminalRequired {
                        reason: crate::battle_replica::M3_MALFORMED_BATTLE_MATERIAL.to_owned(),
                    },
                )?
            } else {
                BattleMaterialApplyContext {
                    current_state: self.staged.game.state().clone(),
                    local_seat: self.staged.game.local_seat(),
                    menu_allocators: self.staged.game.control().menu_allocators.clone(),
                }
            };
            let applied = match apply_authority_material(
                &current,
                entry.kind,
                &entry.material,
                self.staged.game.content(),
            ) {
                Ok(applied) => applied,
                Err(ReplicaApplyError::BeforeDigestMismatch) => {
                    return Err(BattleKernelError::TerminalRequired {
                        reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
                    });
                }
                Err(error) => {
                    let reason = error.terminal_reason().ok_or_else(|| {
                        BattleKernelError::Invariant {
                            reason: format!(
                                "unclassified recovery material failure escaped exact mapping: {error}"
                            ),
                        }
                    })?;
                    return Err(BattleKernelError::TerminalRequired {
                        reason: reason.to_owned(),
                    });
                }
            };
            validate_replica_protocol_control(entry, &applied)?;
            if already_installed {
                if bundle.required_tail.len() != 1
                    || applied.after_state != *self.staged.game.state()
                    || applied.next_control != *self.staged.game.control()
                {
                    return Err(BattleKernelError::TerminalRequired {
                        reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
                    });
                }
                applied_tail.push(RecoveredMaterial::Battle {
                    entry: entry.clone(),
                    applied: Box::new(applied),
                });
                continue;
            }
            let (before_digest, allocator_before) =
                replica_material_metadata(entry).map_err(|_| {
                    BattleKernelError::TerminalRequired {
                        reason: crate::battle_replica::M3_MALFORMED_BATTLE_MATERIAL.to_owned(),
                    }
                })?;
            self.staged
                .game_mut()
                .install_material_in_kernel_transaction(
                    &before_digest,
                    applied.after_state.clone(),
                    &applied.after_digest,
                    &entry.operation_id,
                    applied.next_decision,
                    allocator_before,
                    applied.next_control.clone(),
                )
                .map_err(|_| BattleKernelError::TerminalRequired {
                    reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
                })?;
            applied_tail.push(RecoveredMaterial::Battle {
                entry: entry.clone(),
                applied: Box::new(applied),
            });
        }
        if bundle.frontier == Revision::ZERO {
            if !bundle.required_tail.is_empty() {
                return Err(BattleKernelError::Invariant {
                    reason: "zero-frontier recovery retained a material tail".to_owned(),
                });
            }
        } else if applied_tail.last().map(|item| &item.entry().material) != Some(&bundle.material) {
            return Err(BattleKernelError::Invariant {
                reason: "recovery final material diverged from the validated bundle".to_owned(),
            });
        }
        Ok(applied_tail)
    }

    fn emit_recovery_applied_proof(
        &mut self,
        proof: RecoveryAppliedProof,
    ) -> Result<(), BattleKernelError> {
        let context = match &self.staged.protocol {
            BattleProtocolState::Replica { context, .. } => context.clone(),
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority emitted a replica recovery proof".to_owned(),
                });
            }
        };
        let frame = crate::kernel::recovery_applied_frame(&context, proof)
            .map_err(|reason| BattleKernelError::Protocol { reason })?;
        self.effects.push(KernelEffect::SendFrame {
            from: context.sender_seat_id,
            frame,
        });
        Ok(())
    }

    fn receive_recovery_applied(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        proof: RecoveryAppliedProof,
    ) -> Result<(), BattleKernelError> {
        let mut mismatch = false;
        match &mut self.staged.protocol {
            BattleProtocolState::Authority {
                context: authority_context,
                peer_bindings,
                pending_recoveries,
                ..
            } => {
                if !authority_accepts_peer_frame(
                    authority_context,
                    peer_bindings,
                    endpoint,
                    &context,
                ) {
                    return Ok(());
                }
                let Some(expected) = pending_recoveries.get(&proof.request_id) else {
                    return Ok(());
                };
                let exact = expected.peer == context.sender_seat_id
                    && expected.context == context
                    && expected.frontier == proof.frontier
                    && expected.material_digest == proof.material_digest
                    && expected.control_id == proof.control_id;
                if exact {
                    pending_recoveries.remove(&proof.request_id);
                } else {
                    mismatch = true;
                }
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        }
        if mismatch {
            self.enter_terminal(
                "recovery applied proof did not match its authenticated bundle".to_owned(),
            )?;
        }
        Ok(())
    }

    fn replica_has_terminal_predecessor_frontier(&self, entry: &AuthorityEntry) -> bool {
        let Some(previous) = previous_revision(entry.revision) else {
            return false;
        };
        match &self.staged.protocol {
            BattleProtocolState::Replica { replica, .. } => {
                let frontier = replica.frontier();
                let terminal_admitted = frontier.received == entry.revision
                    && frontier.material == previous
                    && frontier.control == previous;
                let predecessor_installed = frontier.received == previous
                    && frontier.material == previous
                    && frontier.control == previous;
                terminal_admitted || predecessor_installed
            }
            BattleProtocolState::Authority { .. } => false,
        }
    }

    fn validate_terminal_entry_identity(
        &self,
        entry: &AuthorityEntry,
        material: &BattleTerminalMaterialV1,
    ) -> Result<(), BattleKernelError> {
        let mut outcome = None;
        for seat in &self.staged.game.control().seats {
            let BattleControl::Complete(seat_outcome) = &seat.control else {
                return Err(BattleKernelError::TerminalRequired {
                    reason:
                        "terminal material arrived before the complete battle control was installed"
                            .to_owned(),
                });
            };
            let seat_outcome = *seat_outcome;
            if let Some(previous) = outcome {
                if previous != seat_outcome {
                    return Err(BattleKernelError::TerminalRequired {
                        reason: "terminal material found divergent complete battle outcomes"
                            .to_owned(),
                    });
                }
            } else {
                outcome = Some(seat_outcome);
            }
        }
        let Some(outcome) = outcome else {
            return Err(BattleKernelError::TerminalRequired {
                reason: "terminal material arrived for an empty battle control plan".to_owned(),
            });
        };
        let expected_operation_id =
            battle_terminal_operation_id(self.staged.game.control(), outcome)?;
        if entry.kind != AuthorityEntryKind::TerminalCommit
            || entry.operation_id != expected_operation_id
            || material.terminal_id != expected_operation_id.to_string()
            || material.wave != self.staged.game.control().wave.get()
            || material.turn != self.staged.game.control().turn.get()
            || !matches!(&material.reason, BattleTerminalReasonV1::GameOver)
        {
            return Err(BattleKernelError::TerminalRequired {
                reason: "terminal material identity does not match the complete battle".to_owned(),
            });
        }
        Ok(())
    }

    fn map_replica_actions(
        &mut self,
        actions: Vec<ReplicaAction>,
    ) -> Result<(), BattleKernelError> {
        self.map_replica_actions_with_probe_mode(actions, false)
    }

    fn map_replica_actions_with_probe_mode(
        &mut self,
        actions: Vec<ReplicaAction>,
        duplicate_complete_probe: bool,
    ) -> Result<(), BattleKernelError> {
        for action in actions {
            match action {
                ReplicaAction::EmitReceipt { receipt } => {
                    let frame = crate::kernel::receipt_frame(&receipt)
                        .map_err(|reason| BattleKernelError::Protocol { reason })?;
                    self.effects.push(KernelEffect::SendFrame {
                        from: receipt.context.sender_seat_id,
                        frame,
                    });
                }
                ReplicaAction::ApplyMaterial { entry } => {
                    if entry.kind == AuthorityEntryKind::TerminalCommit {
                        let terminal =
                            validate_battle_terminal_commit(&entry).map_err(|error| {
                                BattleKernelError::TerminalRequired {
                                    reason: format!("malformed terminal material: {error}"),
                                }
                            })?;
                        self.validate_terminal_entry_identity(&entry, &terminal)?;
                        let actions = match &mut self.staged.protocol {
                            BattleProtocolState::Replica { replica, .. } => replica
                                .record_replica_stage(
                                    &entry,
                                    ReplicaMechanicalStage::MaterialApplied,
                                )
                                .map_err(protocol_error)?,
                            BattleProtocolState::Authority { .. } => {
                                return Err(BattleKernelError::Invariant {
                                    reason: "authority received replica terminal material stage"
                                        .to_owned(),
                                });
                            }
                        };
                        if self.pending_replica_terminal.is_some()
                            || self.pending_replica_material.is_some()
                        {
                            return Err(BattleKernelError::Invariant {
                                reason: "replica received terminal material while another material is pending"
                                    .to_owned(),
                            });
                        }
                        self.pending_replica_terminal = Some(PendingReplicaTerminal {
                            entry,
                            material: terminal,
                        });
                        self.map_replica_actions(actions)?;
                        continue;
                    }
                    let current = BattleMaterialApplyContext {
                        current_state: self.staged.game.state().clone(),
                        local_seat: self.staged.game.local_seat(),
                        menu_allocators: self.staged.game.control().menu_allocators.clone(),
                    };
                    let apply_result = apply_authority_material(
                        &current,
                        entry.kind,
                        &entry.material,
                        self.staged.game.content(),
                    );
                    let applied = match apply_result {
                        Ok(applied) => applied,
                        Err(ReplicaApplyError::BeforeDigestMismatch) => {
                            return Err(BattleKernelError::RecoveryRequired {
                                operation_id: entry.operation_id.clone(),
                                reason: "authenticated battle material does not match the local committed frontier"
                                    .to_owned(),
                            });
                        }
                        Err(error) => {
                            if let Some(reason) = error.terminal_reason() {
                                return Err(BattleKernelError::TerminalRequired {
                                    reason: reason.to_owned(),
                                });
                            }
                            return Err(BattleKernelError::Invariant {
                                reason: format!(
                                    "unclassified replica material failure escaped exact mapping: {error}"
                                ),
                            });
                        }
                    };
                    validate_replica_protocol_control(&entry, &applied)?;
                    let (before_digest, allocator_before) = replica_material_metadata(&entry)?;
                    self.staged
                        .game_mut()
                        .install_material_in_kernel_transaction(
                            &before_digest,
                            applied.after_state.clone(),
                            &applied.after_digest,
                            &entry.operation_id,
                            applied.next_decision,
                            allocator_before,
                            applied.next_control.clone(),
                        )
                        .map_err(|_| BattleKernelError::TerminalRequired {
                            reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
                        })?;
                    let kind = match entry.kind {
                        AuthorityEntryKind::TurnCommit => MaterialKind::Turn,
                        AuthorityEntryKind::ReplacementCommit => MaterialKind::Replacement,
                        _ => {
                            return Err(BattleKernelError::Protocol {
                                reason: "non-battle entry reached the material applier".to_owned(),
                            });
                        }
                    };
                    self.pending_replica_material = Some(PendingReplicaMaterial {
                        entry: entry.clone(),
                        applied: applied.clone(),
                    });
                    self.queue
                        .push(InternalEvent::MaterialInstalled(MaterialInstalledPayload {
                            revision: entry.revision,
                            result: EventApplyResult {
                                material_kind: kind,
                                operation_id: entry.operation_id,
                                before_digest,
                                after_digest: applied.after_digest,
                            },
                        }));
                }
                ReplicaAction::ProjectControl {
                    entry,
                    expected_control_id,
                } => {
                    if entry.kind == AuthorityEntryKind::TerminalCommit {
                        let pending = self.pending_replica_terminal.as_ref().ok_or_else(|| {
                            BattleKernelError::Invariant {
                                reason: "terminal ProjectControl arrived before terminal material staging"
                                    .to_owned(),
                            }
                        })?;
                        if pending.entry != entry
                            || expected_control_id != control_id_of(&entry.next_control)
                        {
                            return Err(BattleKernelError::Invariant {
                                reason: "replica terminal ProjectControl identity mismatch"
                                    .to_owned(),
                            });
                        }
                        self.queue
                            .push(InternalEvent::ControlInstalled(ControlInstalledPayload {
                                revision: entry.revision,
                                operation_id: entry.operation_id,
                                control: self.staged.game.control().clone(),
                                presentation_barrier: PresentationBarrier {
                                    operation_id: pending.entry.operation_id.clone(),
                                    pending_events: 0,
                                },
                            }));
                        continue;
                    }
                    let pending = self.pending_replica_material.as_ref().ok_or_else(|| {
                        BattleKernelError::Invariant {
                            reason: "ProjectControl arrived before material installation"
                                .to_owned(),
                        }
                    })?;
                    if pending.entry != entry
                        || expected_control_id != control_id_of(&entry.next_control)
                    {
                        return Err(BattleKernelError::Invariant {
                            reason: "replica ProjectControl identity mismatch".to_owned(),
                        });
                    }
                    self.queue
                        .push(InternalEvent::ControlInstalled(ControlInstalledPayload {
                            revision: entry.revision,
                            operation_id: entry.operation_id.clone(),
                            control: pending.applied.next_control.clone(),
                            presentation_barrier: PresentationBarrier {
                                operation_id: entry.operation_id,
                                pending_events: pending.applied.presentation.len(),
                            },
                        }));
                }
                ReplicaAction::ProbePresentation { entry } => {
                    if entry.kind == AuthorityEntryKind::TerminalCommit {
                        let terminal =
                            validate_battle_terminal_commit(&entry).map_err(|error| {
                                BattleKernelError::TerminalRequired {
                                    reason: format!("malformed terminal material: {error}"),
                                }
                            })?;
                        self.validate_terminal_entry_identity(&entry, &terminal)?;
                        let actions = match &mut self.staged.protocol {
                            BattleProtocolState::Replica { replica, .. } => replica
                                .presentation_result(
                                    entry.revision,
                                    er_protocol::PresentationProbeOutcome::Settled,
                                )
                                .map_err(protocol_error)?,
                            BattleProtocolState::Authority { .. } => {
                                return Err(BattleKernelError::Invariant {
                                    reason:
                                        "authority received a replica terminal presentation probe"
                                            .to_owned(),
                                });
                            }
                        };
                        self.map_replica_actions(actions)?;
                        let terminal = TerminalState {
                            terminal_id: terminal.terminal_id,
                            reason: "game-over".to_owned(),
                        };
                        if self.defer_terminalization {
                            self.deferred_terminal = Some(terminal);
                        } else {
                            self.enter_terminal_state(terminal)?;
                        }
                        continue;
                    }
                    if duplicate_complete_probe
                        && self.pending_replica_material.is_none()
                        && !self
                            .pending_presentation_probes
                            .contains_key(&entry.revision)
                    {
                        let has_live_events = self
                            .staged
                            .presentations
                            .pending_ids()
                            .iter()
                            .any(|event_id| event_id.operation_id == entry.operation_id);
                        if !has_live_events {
                            let actions = match &mut self.staged.protocol {
                                BattleProtocolState::Replica { replica, .. } => replica
                                    .presentation_result(
                                        entry.revision,
                                        er_protocol::PresentationProbeOutcome::Settled,
                                    )
                                    .map_err(protocol_error)?,
                                BattleProtocolState::Authority { .. } => {
                                    return Err(BattleKernelError::Invariant {
                                        reason: "authority received a duplicate replica presentation probe"
                                            .to_owned(),
                                    });
                                }
                            };
                            self.map_replica_actions(actions)?;
                        }
                        continue;
                    }
                    if let Some(existing) = self
                        .pending_presentation_probes
                        .insert(entry.revision, entry.operation_id.clone())
                        && existing != entry.operation_id
                    {
                        return Err(BattleKernelError::Invariant {
                            reason: "replica presentation probe identity conflict".to_owned(),
                        });
                    }
                }
                ReplicaAction::RequestTail {
                    context,
                    missing_from,
                } => {
                    let frame = crate::kernel::tail_request_frame(&context, missing_from)
                        .map_err(|reason| BattleKernelError::Protocol { reason })?;
                    self.effects.push(KernelEffect::SendFrame {
                        from: context.sender_seat_id,
                        frame,
                    });
                }
                ReplicaAction::RequestTailProof { context, request } => {
                    let frame = crate::kernel::correlated_tail_request_frame(&context, request)
                        .map_err(|reason| BattleKernelError::Protocol { reason })?;
                    self.effects.push(KernelEffect::SendFrame {
                        from: context.sender_seat_id,
                        frame,
                    });
                }
                ReplicaAction::EnterTerminal { reason } => {
                    return Err(BattleKernelError::TerminalRequired { reason });
                }
            }
        }
        Ok(())
    }

    fn settle_presentation(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    ) -> Result<(), BattleKernelError> {
        let operation_id = event_id.operation_id.clone();
        let revision = self.staged.presentation_revisions.remove(&event_id);
        let report = self
            .staged
            .presentations
            .settle_in_kernel_transaction(endpoint, event_id, outcome)?;
        let presentation_failed = report.terminal_reason() == Some(M3_PRESENTATION_FAILED);
        if presentation_failed {
            self.enter_terminal(M3_PRESENTATION_FAILED.to_owned())?;
        }
        if report.barrier_cleared() {
            self.install_current_projection()?;
        }
        let operation_complete = !self
            .staged
            .presentations
            .pending_ids()
            .iter()
            .any(|pending| pending.operation_id == operation_id);
        if !presentation_failed
            && operation_complete
            && let Some(revision) = revision
            && let BattleProtocolState::Replica { replica, .. } = &mut self.staged.protocol
        {
            let actions = replica
                .presentation_result(revision, er_protocol::PresentationProbeOutcome::Settled)
                .map_err(protocol_error)?;
            self.map_replica_actions(actions)?;
        }
        if !presentation_failed && self.staged.protocol.is_authority() {
            self.maybe_progress_authority_terminal()?;
        }
        Ok(())
    }

    fn resolve_pending_presentation_probe(
        &mut self,
        revision: Revision,
        operation_id: &er_types::OperationId,
    ) -> Result<(), BattleKernelError> {
        let Some(probe_operation) = self.pending_presentation_probes.remove(&revision) else {
            return Err(BattleKernelError::Invariant {
                reason: "replica control installation has no presentation probe".to_owned(),
            });
        };
        if &probe_operation != operation_id {
            return Err(BattleKernelError::Invariant {
                reason: "replica presentation probe operation mismatch".to_owned(),
            });
        }
        let outcome = if self
            .staged
            .presentations
            .pending_ids()
            .iter()
            .any(|event_id| &event_id.operation_id == operation_id)
        {
            er_protocol::PresentationProbeOutcome::Pending
        } else {
            er_protocol::PresentationProbeOutcome::Settled
        };
        let actions = match &mut self.staged.protocol {
            BattleProtocolState::Replica { replica, .. } => replica
                .presentation_result(revision, outcome)
                .map_err(protocol_error)?,
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority attempted to resolve a replica presentation probe"
                        .to_owned(),
                });
            }
        };
        self.map_replica_actions(actions)
    }

    fn dispatch_protocol_timer(
        &mut self,
        endpoint: SeatId,
        timer_id: TimerId,
    ) -> Result<(), BattleKernelError> {
        let Some(timer) = self.scheduler.timer(timer_id).cloned() else {
            return Err(InputRouteError::UnknownTimer { timer_id }.into());
        };
        if timer.endpoint != endpoint {
            return Err(InputRouteError::UnknownTimer { timer_id }.into());
        }
        let fired = self.scheduler.fired(timer_id).map_err(protocol_error)?;
        let mut recovery_actions = None;
        match &mut self.staged.protocol {
            BattleProtocolState::Authority { log, .. } => {
                let actions = Arc::make_mut(log)
                    .timer_fired(fired, &mut self.scheduler)
                    .map_err(protocol_error)?;
                map_authority_actions(&mut self.effects, actions)?;
            }
            BattleProtocolState::Replica {
                context,
                replica,
                leases,
                recovery,
                ..
            } => {
                if leases.diagnostics().timer_ids.contains(&timer_id) {
                    let actions = leases
                        .timer_fired(fired, &mut self.scheduler)
                        .map_err(protocol_error)?;
                    self.apply_proposal_actions(actions)?;
                } else if recovery.diagnostics().timer_ids.contains(&timer_id) {
                    let live = RecoveryLiveState {
                        frontier: replica.frontier(),
                        context: context.clone(),
                    };
                    let actions = recovery
                        .timer_fired(fired, live, &mut self.scheduler)
                        .map_err(protocol_error)?;
                    recovery_actions = Some(actions);
                } else {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }
            }
        }
        if let Some(actions) = recovery_actions {
            self.apply_recovery_timer_actions(actions)?;
        }
        Ok(())
    }

    fn apply_recovery_timer_actions(
        &mut self,
        actions: Vec<RecoveryAction>,
    ) -> Result<(), BattleKernelError> {
        let mut projection_changed = false;
        for action in actions {
            match action {
                RecoveryAction::FenceChanged { .. } => projection_changed = true,
                RecoveryAction::Scheduler { command } => {
                    map_scheduler_command(&mut self.effects, command);
                }
                RecoveryAction::Terminalize { reason } => {
                    self.enter_terminal(reason)?;
                    break;
                }
                RecoveryAction::SendRequest { .. }
                | RecoveryAction::ApplyMaterial { .. }
                | RecoveryAction::StageRecoveredFrontier { .. }
                | RecoveryAction::ProjectControl { .. }
                | RecoveryAction::SendAppliedProof { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "recovery timer emitted unsupported continuation work".to_owned(),
                    });
                }
            }
        }
        if projection_changed {
            self.install_current_projection()?;
        }
        Ok(())
    }

    fn transport_changed(
        &mut self,
        endpoint: SeatId,
        state: TransportState,
        generation: ConnectionGeneration,
    ) -> Result<(), BattleKernelError> {
        let Some(current_generation) = self.staged.protocol.endpoint_generation(endpoint) else {
            return Ok(());
        };
        if generation < current_generation
            || (generation == current_generation
                && self.staged.protocol.endpoint_state(endpoint) == Some(state))
        {
            return Ok(());
        }
        if state == TransportState::Disconnected {
            let cleared = self.staged.ui.clear_input(&mut self.scheduler)?;
            map_input_timer_commands(
                &mut self.effects,
                &cleared.timers,
                &self.scheduler,
                self.staged.game.local_seat(),
            )?;
        }
        let connected = state == TransportState::Connected;
        let scheduler_commands;
        let mut authority_actions = Vec::new();
        let mut proposal_actions = Vec::new();
        let mut recovery_cleanup_actions = Vec::new();
        let mut recovery_start = None;
        let mut authority_config_rebind = None;
        let mut replica_config_rebind = None;
        match &mut self.staged.protocol {
            BattleProtocolState::Authority {
                context,
                peer_bindings,
                log,
                pending_recoveries,
                transports,
                staged_local_rebind,
                staged_peer_rebinds,
                ..
            } => {
                let local = context.sender_seat_id;
                let active_generation = if endpoint == local {
                    context.connection_generation
                } else {
                    peer_bindings
                        .iter()
                        .find(|binding| binding.seat_id == endpoint)
                        .map(|binding| binding.connection_generation)
                        .ok_or_else(|| BattleKernelError::Invariant {
                            reason: "known authority transport has no active peer binding"
                                .to_owned(),
                        })?
                };
                let generation_changed = generation > active_generation;
                transports.insert(endpoint, state);
                scheduler_commands = self
                    .scheduler
                    .set_connected(
                        local,
                        transports
                            .values()
                            .all(|transport| *transport == TransportState::Connected),
                    )
                    .map_err(protocol_error)?;
                if endpoint == local && generation_changed {
                    *staged_local_rebind = Some(generation);
                    pending_recoveries.clear();
                } else if endpoint != local && generation_changed {
                    pending_recoveries.retain(|_, expected| expected.peer != endpoint);
                    staged_peer_rebinds.insert(endpoint, generation);
                }

                let complete_generation_staged = staged_local_rebind.is_some()
                    && peer_bindings
                        .iter()
                        .all(|binding| staged_peer_rebinds.contains_key(&binding.seat_id));
                let staged_local_connected =
                    transports.get(&local) == Some(&TransportState::Connected);
                let staged_peers_connected = peer_bindings.iter().all(|binding| {
                    transports.get(&binding.seat_id) == Some(&TransportState::Connected)
                });
                if connected
                    && complete_generation_staged
                    && staged_local_connected
                    && staged_peers_connected
                {
                    let mut next_context = context.clone();
                    if let Some(staged) = *staged_local_rebind {
                        next_context.connection_generation = staged;
                    }
                    let mut next_peer_bindings = peer_bindings.clone();
                    for binding in &mut next_peer_bindings {
                        if let Some(staged) = staged_peer_rebinds.get(&binding.seat_id) {
                            binding.connection_generation = *staged;
                        }
                    }
                    authority_actions = Arc::make_mut(log)
                        .rebind_connection(next_context.clone(), next_peer_bindings.clone())
                        .map_err(protocol_error)?
                        .actions;
                    *context = next_context.clone();
                    *peer_bindings = next_peer_bindings.clone();
                    *staged_local_rebind = None;
                    staged_peer_rebinds.clear();
                    authority_config_rebind = Some((next_context, next_peer_bindings));
                }
            }
            BattleProtocolState::Replica {
                context,
                authority_seat,
                authority_generation,
                replica,
                leases,
                recovery,
                recovery_config,
                transports,
                staged_local_rebind,
                staged_authority_rebind,
                ..
            } => {
                let local = context.sender_seat_id;
                let active_generation = if endpoint == local {
                    context.connection_generation
                } else if endpoint == *authority_seat {
                    *authority_generation
                } else {
                    return Err(BattleKernelError::Invariant {
                        reason: "known replica transport has no active endpoint identity"
                            .to_owned(),
                    });
                };
                let generation_changed = generation > active_generation;
                transports.insert(endpoint, state);
                scheduler_commands = self
                    .scheduler
                    .set_connected(
                        local,
                        transports
                            .values()
                            .all(|transport| *transport == TransportState::Connected),
                    )
                    .map_err(protocol_error)?;
                if endpoint == local && generation_changed {
                    *staged_local_rebind = Some(generation);
                }
                if endpoint == *authority_seat && generation_changed {
                    *staged_authority_rebind = Some(generation);
                }
                let complete_generation_staged =
                    staged_local_rebind.is_some() && staged_authority_rebind.is_some();
                let staged_local_connected =
                    transports.get(&local) == Some(&TransportState::Connected);
                let staged_authority_connected =
                    transports.get(&*authority_seat) == Some(&TransportState::Connected);
                if connected
                    && complete_generation_staged
                    && staged_local_connected
                    && staged_authority_connected
                {
                    let mut next_context = context.clone();
                    if let Some(staged) = *staged_local_rebind {
                        next_context.connection_generation = staged;
                    }
                    let next_authority_generation =
                        (*staged_authority_rebind).unwrap_or(*authority_generation);
                    replica
                        .rebind_connection(next_context.clone(), next_authority_generation)
                        .map_err(protocol_error)?;
                    proposal_actions = leases
                        .rebind(*authority_seat, next_authority_generation)
                        .map_err(protocol_error)?
                        .1;
                    let mut next_recovery_config = recovery_config.clone();
                    next_recovery_config.local_context = next_context.clone();
                    let mut next_recovery = RecoveryTransaction::new(next_recovery_config.clone())
                        .map_err(protocol_error)?;
                    if recovery.phase().is_some() {
                        recovery_cleanup_actions = recovery
                            .dispose("superseded transport generation", &mut self.scheduler);
                    }
                    let captured = replica.frontier();
                    let request_id = format!(
                        "m3-recovery/rebind/{local}/{}/{}/{}",
                        next_context.connection_generation.get().get(),
                        next_authority_generation.get().get(),
                        captured.control
                    );
                    let actions = next_recovery
                        .start(
                            request_id,
                            captured,
                            "transport-reconnect".to_owned(),
                            &mut self.scheduler,
                        )
                        .map_err(protocol_error)?;
                    *recovery = next_recovery;
                    *context = next_context.clone();
                    *authority_generation = next_authority_generation;
                    *recovery_config = next_recovery_config;
                    *staged_local_rebind = None;
                    *staged_authority_rebind = None;
                    replica_config_rebind = Some((next_context.clone(), next_authority_generation));
                    recovery_start = Some((next_context, actions));
                }
            }
        }
        if let Some((next_context, next_peer_bindings)) = authority_config_rebind {
            let BattleProtocolRoleConfig::Authority { log, .. } =
                &mut self.staged.protocol_config.role
            else {
                return Err(BattleKernelError::Invariant {
                    reason: "authority runtime has a replica protocol config".to_owned(),
                });
            };
            log.local_context = next_context;
            log.peer_bindings = next_peer_bindings;
        }
        if let Some((next_context, next_authority_generation)) = replica_config_rebind {
            let BattleProtocolRoleConfig::Replica {
                replica, recovery, ..
            } = &mut self.staged.protocol_config.role
            else {
                return Err(BattleKernelError::Invariant {
                    reason: "replica runtime has an authority protocol config".to_owned(),
                });
            };
            replica.receipt_context = next_context.clone();
            replica.authority_connection_generation = next_authority_generation;
            recovery.local_context = next_context;
        }
        for command in scheduler_commands {
            map_scheduler_command(&mut self.effects, command);
        }
        map_authority_actions(&mut self.effects, authority_actions)?;
        map_recovery_rebind_cleanup(&mut self.effects, recovery_cleanup_actions)?;
        self.apply_proposal_actions(proposal_actions)?;
        if let Some((context, actions)) = recovery_start {
            self.apply_recovery_start_actions(&context, actions)?;
        }
        self.install_current_projection()?;
        Ok(())
    }

    fn set_suspended(
        &mut self,
        endpoint: SeatId,
        suspended: bool,
    ) -> Result<(), BattleKernelError> {
        if endpoint != self.staged.game.local_seat() {
            return Ok(());
        }
        self.staged.suspended = suspended;
        let commands = self
            .scheduler
            .set_suspended(endpoint, suspended)
            .map_err(protocol_error)?;
        for command in commands {
            map_scheduler_command(&mut self.effects, command);
        }
        self.install_current_projection()
    }

    fn enter_terminal(&mut self, reason: String) -> Result<(), BattleKernelError> {
        self.enter_terminal_state(TerminalState {
            terminal_id: format!("m3-terminal-{}", self.staged.game.local_seat()),
            reason: if reason.is_empty() {
                "M3 battle terminal".to_owned()
            } else {
                reason
            },
        })
    }

    fn enter_terminal_state(&mut self, terminal: TerminalState) -> Result<(), BattleKernelError> {
        if self.terminal.is_some() {
            return Ok(());
        }

        // No productive side effect staged earlier in this external-input
        // transaction may escape beside the terminal transition. Preserve
        // cancellation commands and authenticated protocol receipts/proofs
        // already staged by the ordered mechanical path, then rebuild the
        // remaining cleanup effects from still-owned resources.
        self.effects.retain(is_terminal_cleanup_effect);
        let cleared = self.staged.ui.clear_input(&mut self.scheduler)?;
        map_input_timer_commands(
            &mut self.effects,
            &cleared.timers,
            &self.scheduler,
            self.staged.game.local_seat(),
        )?;

        match &mut self.staged.protocol {
            BattleProtocolState::Authority {
                log,
                proposals,
                pending_recoveries,
                transports,
                staged_local_rebind,
                staged_peer_rebinds,
                ..
            } => {
                let actions = Arc::make_mut(log).dispose(&terminal.reason, &mut self.scheduler);
                proposals.dispose();
                pending_recoveries.clear();
                for state in transports.values_mut() {
                    *state = TransportState::Connected;
                }
                *staged_local_rebind = None;
                staged_peer_rebinds.clear();
                map_authority_actions(&mut self.effects, actions)?;
            }
            BattleProtocolState::Replica {
                replica,
                leases,
                recovery,
                transports,
                staged_local_rebind,
                staged_authority_rebind,
                ..
            } => {
                let recovery_actions = recovery.dispose(&terminal.reason, &mut self.scheduler);
                map_recovery_rebind_cleanup(&mut self.effects, recovery_actions)?;
                let proposal_actions = leases.dispose(&terminal.reason, &mut self.scheduler);
                for action in proposal_actions {
                    match action {
                        ProposalLeaseAction::Scheduler { command } => {
                            map_scheduler_command(&mut self.effects, command);
                        }
                        ProposalLeaseAction::Terminalize { .. } => {}
                        ProposalLeaseAction::Send { .. } => {
                            return Err(BattleKernelError::Invariant {
                                reason:
                                    "proposal disposal emitted a fresh send during terminal cleanup"
                                        .to_owned(),
                            });
                        }
                    }
                }
                replica.dispose(&terminal.reason);
                for state in transports.values_mut() {
                    *state = TransportState::Connected;
                }
                *staged_local_rebind = None;
                *staged_authority_rebind = None;
            }
        }
        for command in self.scheduler.dispose() {
            map_scheduler_command(&mut self.effects, command);
        }
        self.staged.presentations.dispose();
        self.staged.presentation_revisions.clear();
        self.queue = InternalEventQueue::new();
        self.pending_authority = None;
        self.pending_replacements.clear();
        self.pending_replica_material = None;
        self.pending_replica_terminal = None;
        self.pending_presentation_probes.clear();
        self.deferred_terminal = None;
        self.defer_terminalization = false;
        self.staged.suspended = false;
        self.staged.terminal_fenced = true;
        self.install_current_projection()?;
        self.terminal = Some(terminal.clone());
        self.effects
            .push(KernelEffect::EnterSharedTerminal { terminal });
        Ok(())
    }

    fn apply_proposal_actions(
        &mut self,
        actions: Vec<ProposalLeaseAction>,
    ) -> Result<(), BattleKernelError> {
        for action in actions {
            match action {
                ProposalLeaseAction::Send { proposal } => {
                    self.effects.push(KernelEffect::SendProposal { proposal });
                }
                ProposalLeaseAction::Scheduler { command } => {
                    map_scheduler_command(&mut self.effects, command);
                }
                ProposalLeaseAction::Terminalize { reason, .. } => {
                    self.enter_terminal(reason)?;
                    break;
                }
            }
        }
        Ok(())
    }

    fn retire_local_proposal_leases(
        &mut self,
        operation_ids: &[er_types::OperationId],
    ) -> Result<(), BattleKernelError> {
        if operation_ids.is_empty() {
            return Ok(());
        }
        let mut actions = Vec::new();
        match &mut self.staged.protocol {
            BattleProtocolState::Replica { leases, .. } => {
                for operation_id in operation_ids {
                    actions.extend(
                        leases
                            .observe_committed(operation_id, &mut self.scheduler)
                            .1,
                    );
                }
            }
            BattleProtocolState::Authority { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "authority attempted to retire replica proposal leases".to_owned(),
                });
            }
        }
        self.apply_proposal_actions(actions)
    }

    fn validate_quiescent(&self) -> Result<(), BattleKernelError> {
        if !self.queue.is_empty()
            || self.pending_authority.is_some()
            || !self.pending_replacements.is_empty()
            || self.pending_replica_material.is_some()
            || self.pending_replica_terminal.is_some()
            || !self.pending_presentation_probes.is_empty()
            || self.deferred_terminal.is_some()
        {
            return Err(BattleKernelError::Invariant {
                reason: "internal Battle transaction retained uncommitted work".to_owned(),
            });
        }
        if self.effects.iter().any(|effect| {
            matches!(
                effect,
                KernelEffect::ApplyAuthorityMaterial { .. }
                    | KernelEffect::ProjectAuthorityControl { .. }
                    | KernelEffect::UiIntent { .. }
            )
        }) {
            return Err(BattleKernelError::Invariant {
                reason: "Battle mode staged a forbidden compatibility effect".to_owned(),
            });
        }
        self.staged
            .validate_quiescent_transaction(self.staged.game_changed_in_transaction)
    }
}

#[derive(Clone, Copy)]
struct AuthorityStageValidator<'a> {
    state: &'a er_state::snapshot::GameState,
    control: &'a BattleControlPlan,
    scripted_policy: &'a er_types::battle_command::ScriptedEnemyPolicyV1,
}

impl EnclosingKernelValidation for AuthorityStageValidator<'_> {
    fn validate_authority_stage(
        &self,
        staged: &AuthorityPreparedTransaction,
    ) -> Result<(), AuthorityTransactionError> {
        if staged.state() != self.state
            || staged.control() != self.control
            || staged.menu_allocators() != self.control.menu_allocators.as_slice()
            || staged.scripted_policy_after() != self.scripted_policy
        {
            return Err(AuthorityTransactionError::EnclosingValidation {
                reason: "game/control/allocator stage diverged before log publication".to_owned(),
            });
        }
        Ok(())
    }

    fn validate_authority_publication(
        &self,
        published: &AuthorityPublishedTransaction,
    ) -> Result<(), AuthorityTransactionError> {
        if &published.state != self.state
            || &published.control != self.control
            || published.menu_allocators.as_slice() != self.control.menu_allocators.as_slice()
            || &published.scripted_policy_after != self.scripted_policy
        {
            return Err(AuthorityTransactionError::EnclosingValidation {
                reason: "post-publication authority stage diverged from the validated game state"
                    .to_owned(),
            });
        }
        Ok(())
    }
}

fn projection_for(
    game: &GameRuntime,
    presentations: &BattlePresentationState,
    suspended: bool,
) -> Result<BattleUiProjection, BattleKernelError> {
    let entry = game
        .control()
        .seat(game.local_seat())
        .cloned()
        .ok_or_else(|| BattleKernelError::Invariant {
            reason: "local seat is absent from BattleControlPlan".to_owned(),
        })?;
    let actionable = entry.control.is_actionable() && !presentations.is_blocked() && !suspended;
    BattleUiProjection::new(
        BATTLE_UI_PROJECTION_SCHEMA_VERSION,
        game.control().battle_id,
        game.control().wave,
        game.control().turn,
        entry,
        actionable,
    )
    .map_err(|error| BattleKernelError::Invariant {
        reason: format!("Battle UI projection failed: {error}"),
    })
}

fn projection_menu(
    projection: &BattleUiProjection,
) -> Option<(
    er_types::battle_ids::MenuInstanceId,
    &str,
    er_types::MenuOptionId,
)> {
    let menu = match &projection.seat_control.control {
        BattleControl::CommandRoot(value) => &value.menu,
        BattleControl::MoveSelect(value) => &value.menu,
        BattleControl::TargetSelect(value) => &value.menu,
        BattleControl::PartySelect(value) => &value.menu,
        BattleControl::PartyOptionSelect(value) => &value.menu,
        BattleControl::ReplacementSelect(value) => &value.menu,
        BattleControl::Waiting(_) | BattleControl::Complete(_) => return None,
    };
    Some((
        menu.instance_id,
        menu.control_id.as_str(),
        menu.selected_option_id.clone(),
    ))
}

fn ui_intent_event(intent: BattleUiIntent) -> InternalEvent {
    match intent {
        BattleUiIntent::Activate {
            seat,
            menu_instance_id,
            control_id,
            option_id,
        } => InternalEvent::Ui(UiEventPayload::activate(
            seat,
            menu_instance_id,
            control_id,
            option_id,
        )),
        BattleUiIntent::Cancel {
            seat,
            menu_instance_id,
            control_id,
        } => InternalEvent::Ui(UiEventPayload::cancel(seat, menu_instance_id, control_id)),
    }
}

fn prepared_material_metadata(
    material: &PreparedMaterial,
) -> (
    MaterialKind,
    &MechanicalStateDigest,
    &MechanicalStateDigest,
    er_battle::BattleNextDecision,
    &[er_types::battle_control::SeatMenuInstanceAllocator],
) {
    match material {
        PreparedMaterial::Turn(value) => (
            MaterialKind::Turn,
            &value.before_digest,
            &value.after_digest,
            value.next_decision,
            &value.menu_allocators_before,
        ),
        PreparedMaterial::Replacement(value) => (
            MaterialKind::Replacement,
            &value.before_digest,
            &value.after_digest,
            value.next_decision,
            &value.menu_allocators_before,
        ),
    }
}

fn replica_material_metadata(
    entry: &AuthorityEntry,
) -> Result<
    (
        MechanicalStateDigest,
        Vec<er_types::battle_control::SeatMenuInstanceAllocator>,
    ),
    BattleKernelError,
> {
    let bytes = serde_json::to_vec(&entry.material.payload).map_err(|error| {
        BattleKernelError::Protocol {
            reason: format!("authority material serialization failed: {error}"),
        }
    })?;
    match entry.kind {
        AuthorityEntryKind::TurnCommit => {
            let value = decode_turn_material(&bytes).map_err(protocol_error)?;
            Ok((value.before_digest, value.menu_allocators_before))
        }
        AuthorityEntryKind::ReplacementCommit => {
            let value = decode_replacement_material(&bytes).map_err(protocol_error)?;
            Ok((value.before_digest, value.menu_allocators_before))
        }
        _ => Err(BattleKernelError::Protocol {
            reason: "non-battle material kind".to_owned(),
        }),
    }
}

fn recovery_reconstruction_context(
    entry: &AuthorityEntry,
    local_seat: SeatId,
) -> Result<BattleMaterialApplyContext, BattleKernelError> {
    let bytes = serde_json::to_vec(&entry.material.payload).map_err(protocol_error)?;
    match entry.kind {
        AuthorityEntryKind::TurnCommit => {
            let value = decode_turn_material(&bytes).map_err(protocol_error)?;
            Ok(BattleMaterialApplyContext {
                current_state: value.before_state,
                local_seat,
                menu_allocators: value.menu_allocators_before,
            })
        }
        AuthorityEntryKind::ReplacementCommit => {
            let value = decode_replacement_material(&bytes).map_err(protocol_error)?;
            Ok(BattleMaterialApplyContext {
                current_state: value.before_state,
                local_seat,
                menu_allocators: value.menu_allocators_before,
            })
        }
        _ => Err(BattleKernelError::Protocol {
            reason: "non-battle recovery material kind".to_owned(),
        }),
    }
}

fn committed_local_proposal_ids(
    entry: &AuthorityEntry,
    local_seat: SeatId,
) -> Result<Vec<er_types::OperationId>, BattleKernelError> {
    let invalid_material = || BattleKernelError::TerminalRequired {
        reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
    };
    let bytes = serde_json::to_vec(&entry.material.payload).map_err(|_| invalid_material())?;
    let mut operation_ids = match entry.kind {
        AuthorityEntryKind::TurnCommit => decode_turn_material(&bytes)
            .map_err(|_| invalid_material())?
            .commands
            .entries
            .into_iter()
            .filter_map(|command| match command {
                AcceptedBattleCommand::Human { proposal, .. }
                    if proposal.owner_seat == local_seat =>
                {
                    Some(proposal.operation_id)
                }
                AcceptedBattleCommand::Human { .. }
                | AcceptedBattleCommand::ScriptedEnemy { .. } => None,
            })
            .collect::<Vec<_>>(),
        AuthorityEntryKind::ReplacementCommit => {
            let material = decode_replacement_material(&bytes).map_err(|_| invalid_material())?;
            if material.occurrence.owner_seat == Some(local_seat) {
                vec![material.operation_id]
            } else {
                Vec::new()
            }
        }
        _ => return Err(invalid_material()),
    };
    operation_ids.sort_unstable();
    operation_ids.dedup();
    Ok(operation_ids)
}

fn validate_replica_protocol_control(
    entry: &AuthorityEntry,
    applied: &MaterialApplyResult,
) -> Result<(), BattleKernelError> {
    let projected = protocol_next_control_from_plan(
        &entry.operation_id,
        applied.next_decision,
        &applied.next_control,
        AuthorityEpoch::new(entry.context.session_epoch),
    )
    .map_err(|_| BattleKernelError::TerminalRequired {
        reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
    })?;
    if projected != entry.next_control {
        return Err(BattleKernelError::TerminalRequired {
            reason: crate::battle_replica::M3_INVALID_AUTHORITY_MATERIAL.to_owned(),
        });
    }
    Ok(())
}

fn control_id(control: &BattleControl) -> Option<String> {
    match control {
        BattleControl::CommandRoot(value) => Some(value.menu.control_id.clone()),
        BattleControl::MoveSelect(value) => Some(value.menu.control_id.clone()),
        BattleControl::TargetSelect(value) => Some(value.menu.control_id.clone()),
        BattleControl::PartySelect(value) => Some(value.menu.control_id.clone()),
        BattleControl::PartyOptionSelect(value) => Some(value.menu.control_id.clone()),
        BattleControl::ReplacementSelect(value) => Some(value.menu.control_id.clone()),
        BattleControl::Waiting(_) | BattleControl::Complete(_) => None,
    }
}

fn map_input_timer_commands(
    effects: &mut Vec<KernelEffect>,
    commands: &[InputTimerCommand],
    scheduler: &KernelScheduler,
    endpoint: SeatId,
) -> Result<(), BattleKernelError> {
    for command in commands {
        match command {
            InputTimerCommand::Schedule { timer_id, .. } => {
                let timer =
                    scheduler
                        .timer(*timer_id)
                        .ok_or_else(|| BattleKernelError::Invariant {
                            reason: format!(
                                "input router emitted schedule for unknown timer {timer_id}"
                            ),
                        })?;
                effects.push(KernelEffect::ScheduleTimer {
                    endpoint: timer.endpoint,
                    timer_id: timer.timer_id,
                    owner: timer.owner.clone(),
                    delay_ms: timer.delay_ms,
                    time_class: timer.time_class,
                });
            }
            InputTimerCommand::Cancel { timer_id } => effects.push(KernelEffect::CancelTimer {
                endpoint,
                timer_id: *timer_id,
            }),
        }
    }
    Ok(())
}

fn is_terminal_cleanup_effect(effect: &KernelEffect) -> bool {
    matches!(effect, KernelEffect::CancelTimer { .. })
        || matches!(
            effect,
            KernelEffect::SendFrame { frame, .. }
                if matches!(frame.frame_type, FrameType::AuthorityReceipt | FrameType::RecoveryApplied)
        )
}

fn map_authority_actions(
    effects: &mut Vec<KernelEffect>,
    actions: Vec<AuthorityLogAction>,
) -> Result<(), BattleKernelError> {
    for action in actions {
        match action {
            AuthorityLogAction::Deliver { to: _, entry } => {
                let frame = crate::kernel::authority_entry_frame(&entry)
                    .map_err(|reason| BattleKernelError::Protocol { reason })?;
                effects.push(KernelEffect::SendFrame {
                    from: entry.context.sender_seat_id,
                    frame,
                });
            }
            AuthorityLogAction::Scheduler { command } => {
                map_scheduler_command(effects, command);
            }
            AuthorityLogAction::TailProof { context, body, .. } => {
                let frame = crate::kernel::tail_proof_frame(&context, body)
                    .map_err(|reason| BattleKernelError::Protocol { reason })?;
                effects.push(KernelEffect::SendFrame {
                    from: context.sender_seat_id,
                    frame,
                });
            }
        }
    }
    Ok(())
}

fn map_proposal_actions(effects: &mut Vec<KernelEffect>, actions: Vec<ProposalLeaseAction>) {
    for action in actions {
        match action {
            ProposalLeaseAction::Send { proposal } => {
                effects.push(KernelEffect::SendProposal { proposal });
            }
            ProposalLeaseAction::Scheduler { command } => map_scheduler_command(effects, command),
            ProposalLeaseAction::Terminalize {
                operation_id,
                reason,
            } => {
                let next = TerminalState {
                    terminal_id: format!("m3-proposal-{operation_id}"),
                    reason,
                };
                effects.push(KernelEffect::EnterSharedTerminal { terminal: next });
            }
        }
    }
}

fn map_recovery_dispose_actions(
    effects: &mut Vec<KernelEffect>,
    actions: Vec<er_protocol::RecoveryAction>,
) {
    for action in actions {
        match action {
            er_protocol::RecoveryAction::Scheduler { command } => {
                map_scheduler_command(effects, command)
            }
            // Explicit endpoint disposal uses the recovery transaction's
            // terminal fence only to release its internal owner. Publishing
            // that cleanup-only fence after GameKernel has become disposed
            // would incorrectly create a fresh pair-level semantic terminal.
            // Scheduler cancellation actions above remain observable.
            er_protocol::RecoveryAction::Terminalize { .. } => {}
            _ => {}
        }
    }
}

fn map_recovery_rebind_cleanup(
    effects: &mut Vec<KernelEffect>,
    actions: Vec<RecoveryAction>,
) -> Result<(), BattleKernelError> {
    for action in actions {
        match action {
            RecoveryAction::Scheduler { command } => map_scheduler_command(effects, command),
            RecoveryAction::FenceChanged { .. } | RecoveryAction::Terminalize { .. } => {}
            RecoveryAction::SendRequest { .. }
            | RecoveryAction::ApplyMaterial { .. }
            | RecoveryAction::StageRecoveredFrontier { .. }
            | RecoveryAction::ProjectControl { .. }
            | RecoveryAction::SendAppliedProof { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "superseded recovery emitted non-cleanup work during rebind".to_owned(),
                });
            }
        }
    }
    Ok(())
}

fn map_scheduler_command(effects: &mut Vec<KernelEffect>, command: SchedulerCommand) {
    match command {
        SchedulerCommand::Schedule { timer } => effects.push(KernelEffect::ScheduleTimer {
            endpoint: timer.endpoint,
            timer_id: timer.timer_id,
            owner: timer.owner,
            delay_ms: timer.delay_ms,
            time_class: timer.time_class,
        }),
        SchedulerCommand::Cancel { endpoint, timer_id } => {
            effects.push(KernelEffect::CancelTimer { endpoint, timer_id });
        }
        SchedulerCommand::PauseClass { .. } | SchedulerCommand::ResumeClass { .. } => {}
    }
}

fn protocol_init(reason: &str) -> BattleInitializationError {
    BattleInitializationError::Protocol {
        reason: reason.to_owned(),
    }
}

fn protocol_error(error: impl std::fmt::Display) -> BattleKernelError {
    BattleKernelError::Protocol {
        reason: error.to_string(),
    }
}

fn authority_accepts_peer_frame(
    local: &FrameContext,
    peer_bindings: &[PeerBinding],
    endpoint: SeatId,
    incoming: &FrameContext,
) -> bool {
    endpoint == local.sender_seat_id
        && incoming.authority_seat_id == local.authority_seat_id
        && incoming.sender_seat_id != local.sender_seat_id
        && frame_contexts_compatible(incoming, local)
        && peer_bindings.iter().any(|binding| {
            binding.seat_id == incoming.sender_seat_id
                && binding.connection_generation == incoming.connection_generation
        })
}

fn replica_accepts_authority_frame(
    local: &FrameContext,
    authority_seat: SeatId,
    authority_generation: ConnectionGeneration,
    endpoint: SeatId,
    incoming: &FrameContext,
) -> bool {
    endpoint == local.sender_seat_id
        && incoming.sender_seat_id == authority_seat
        && incoming.authority_seat_id == authority_seat
        && incoming.connection_generation == authority_generation
        && frame_contexts_compatible(incoming, local)
}

fn previous_revision(revision: Revision) -> Option<Revision> {
    let value = revision.get().get();
    if value == 0 {
        None
    } else {
        er_types::SafeU53::new(value - 1).ok().map(Revision::new)
    }
}
