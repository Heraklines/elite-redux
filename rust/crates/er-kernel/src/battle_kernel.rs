//! Production M3 Battle-mode kernel transaction.
//!
//! This module is additive to the legacy M1/M2 fixture kernel. One external
//! input is reduced on cloned deterministic owners, the closed internal FIFO
//! is drained to quiescence, and only then are state and effects published.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_content::pack::ContentPack;
use er_game::internal_event::{
    AuthorityEntryReadyPayload, BattleResolvedPayload, ButtonEventPayload,
    ControlInstalledPayload, InternalEvent, InternalEventQueue, MaterialApplyResult as EventApplyResult,
    MaterialInstalledPayload, MaterialKind, PresentationBarrier, PreparedAuthorityEntry,
    PreparedBattleResolution, UiEventPayload,
};
use er_game::material::{
    BattleMaterialApplyContext, MaterialApplyResult, decode_replacement_material,
    decode_turn_material,
};
use er_game::runtime::{
    BattleGameConfig, BattleUiResult, GameRuntime, GameRuntimeError,
};
use er_protocol::{
    AuthorityLog, AuthorityLogAction, AuthorityReplica, FrameValidator, InboundFrameResult,
    KernelScheduler, ProposalAdmission, ProposalAdmissionLedger, ProposalIdentity,
    PeerBinding,
    ProposalLeaseAction, ProposalLeaseManager, ProposalLeaseSpec, ProposalLeaseStart,
    RecoveryLiveState, RecoveryTransaction, ReplicaAction, ReplicaAdmission, ReplicaMechanicalStage,
    SchedulerCommand, ValidatedFrame, ValidatedFrameBody, control_id_of,
};
use er_state::digest::MechanicalStateDigest;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommandProposalV1, BattleReplacementProposalV1,
    ReplacementSelection,
};
use er_types::battle_control::{BattleControl, BattleControlPlan};
use er_types::battle_ids::{AuthorityEpoch, BattlePresentationEventId};
use er_types::battle_ui::{
    BATTLE_UI_PROJECTION_SCHEMA_VERSION, BattlePresentationEvent, BattleUiProjection,
    PresentationSettlementOutcome,
};
use er_types::{
    AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, AuthorityReceipt,
    AuthorityReceiptBody, ButtonEvent, ConnectionGeneration, FrameContext, InputTimerCommand,
    KernelEffect, KernelInput, LiveResourceSnapshot, NetworkFrame, ProposalMessage, RawFrame,
    Revision, SeatId, TerminalState, TimerId, TransportState,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;

use crate::battle_authority::{
    AuthorityPreparedTransaction, AuthorityPublishedTransaction, AuthorityReplacementDecision,
    AuthorityReplacementRequest, AuthorityTransactionError, AuthorityTransactionInput,
    AuthorityTurnRequest, EnclosingKernelValidation, PreparedMaterial, prepare_authority_replacement,
    prepare_authority_turn,
};
use crate::battle_presentation::{
    BattlePresentationError, BattlePresentationState, M3_PRESENTATION_FAILED,
};
use crate::battle_replica::apply_authority_material;
use crate::battle_ui::{BattleUiAdapter, BattleUiAdapterError};
use crate::input_router::{BattleButtonEvent, BattleInputOutput, InputRouteError};
use crate::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
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
    #[error("battle mode rejects the legacy compatibility boundary: {boundary}")]
    CompatibilityBoundary { boundary: &'static str },
    #[error("battle transaction did not quiesce: {reason}")]
    Invariant { reason: String },
}

#[derive(Clone, Debug)]
pub(crate) struct BattleMode {
    game: GameRuntime,
    ui: BattleUiAdapter,
    protocol_config: BattleProtocolConfig,
    protocol: BattleProtocolState,
    presentations: BattlePresentationState,
    presentation_revisions: BTreeMap<BattlePresentationEventId, Revision>,
    suspended: bool,
    terminal_fenced: bool,
}

#[derive(Clone, Debug)]
enum BattleProtocolState {
    Authority {
        context: FrameContext,
        peer_bindings: Vec<PeerBinding>,
        log: AuthorityLog,
        proposals: ProposalAdmissionLedger,
    },
    Replica {
        context: FrameContext,
        authority_seat: SeatId,
        authority_generation: ConnectionGeneration,
        replica: AuthorityReplica,
        leases: ProposalLeaseManager,
        recovery: RecoveryTransaction,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "proposal", rename_all = "SCREAMING_SNAKE_CASE")]
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

struct BattleTransaction {
    staged: BattleMode,
    scheduler: KernelScheduler,
    terminal: Option<TerminalState>,
    effects: Vec<KernelEffect>,
    queue: InternalEventQueue,
    pending_authority: Option<AuthorityPreparedTransaction>,
    pending_replacements: BTreeMap<er_types::OperationId, BattleReplacementProposalV1>,
    pending_replica_material: Option<PendingReplicaMaterial>,
    pending_presentation_probes: BTreeMap<Revision, er_types::OperationId>,
}

impl BattleMode {
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
            game,
            ui,
            protocol_config,
            protocol,
            presentations,
            presentation_revisions: BTreeMap::new(),
            suspended: false,
            terminal_fenced: false,
        };
        mode.validate_quiescent().map_err(|error| protocol_init(&error.to_string()))?;
        Ok(mode)
    }

    pub(crate) fn step(
        &mut self,
        scheduler: &mut KernelScheduler,
        terminal: &mut Option<TerminalState>,
        input: KernelInput,
    ) -> Result<Vec<KernelEffect>, BattleKernelError> {
        let mut transaction = BattleTransaction::new(self.clone(), scheduler.clone(), terminal.clone());
        transaction.translate(input)?;
        transaction.drain()?;
        transaction.validate_quiescent()?;
        *self = transaction.staged;
        *scheduler = transaction.scheduler;
        *terminal = transaction.terminal;
        Ok(transaction.effects)
    }

    pub(crate) fn protocol_config(&self) -> &BattleProtocolConfig {
        &self.protocol_config
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
        })
    }

    pub(crate) fn live_resources(&self, scheduler: &KernelScheduler) -> LiveResourceSnapshot {
        let mut snapshot = LiveResourceSnapshot::default();
        snapshot.timers = scheduler
            .live_timers()
            .into_iter()
            .map(|timer| timer.timer_id)
            .collect();
        snapshot.battle_presentations = self.presentations.pending_ids().clone();
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
            BattleProtocolState::Authority { log, .. } => {
                let diagnostics = log.diagnostics();
                snapshot.delivery_leases = diagnostics.delivery_owner_ids;
                snapshot.retained_revisions = diagnostics.retained_revisions;
            }
            BattleProtocolState::Replica {
                leases,
                recovery,
                ..
            } => {
                snapshot.proposal_leases = leases.diagnostics().live_operation_ids;
                let recovery = recovery.diagnostics();
                if let Some(request_id) = recovery.request_id {
                    snapshot.recovery_transactions.insert(request_id);
                }
            }
        }
        snapshot
    }

    pub(crate) fn dispose(
        &mut self,
        scheduler: &mut KernelScheduler,
        reason: &str,
    ) -> Vec<KernelEffect> {
        let mut effects = Vec::new();
        let ui = self.ui.dispose(scheduler);
        let _ = map_input_timer_commands(
            &mut effects,
            &ui.timers,
            scheduler,
            self.game.local_seat(),
        );
        match &mut self.protocol {
            BattleProtocolState::Authority { log, proposals, .. } => {
                let actions = log.dispose(reason, scheduler);
                proposals.dispose();
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
                ..
            } => {
                let recovery_actions = recovery.dispose(reason, scheduler);
                map_recovery_dispose_actions(&mut effects, recovery_actions);
                let proposal_actions = leases.dispose(reason, scheduler);
                map_proposal_actions(&mut effects, proposal_actions);
                replica.dispose(reason);
            }
        }
        self.presentations.dispose();
        self.presentation_revisions.clear();
        effects
    }

    fn validate_quiescent(&self) -> Result<(), BattleKernelError> {
        self.game.validate()?;
        self.presentations.validate()?;
        let expected = projection_for(
            &self.game,
            &self.presentations,
            self.suspended || self.terminal_fenced,
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
                    return Err(protocol_init("authority context does not name the local authority seat"));
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
                    log: authority_log,
                    proposals,
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
                    return Err(protocol_init("replica context does not name the local guest seat"));
                }
                let context = replica.receipt_context.clone();
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

    fn diagnostics_value(&self) -> serde_json::Value {
        match self {
            Self::Authority { log, proposals, .. } => json!({
                "role": "AUTHORITY",
                "log": log.diagnostics(),
                "proposals": proposals.diagnostics(),
            }),
            Self::Replica {
                replica,
                leases,
                recovery,
                ..
            } => json!({
                "role": "REPLICA",
                "replica": replica.diagnostics(),
                "leases": leases.diagnostics(),
                "recovery": recovery.diagnostics(),
            }),
        }
    }
}

impl BattleTransaction {
    fn new(
        staged: BattleMode,
        scheduler: KernelScheduler,
        terminal: Option<TerminalState>,
    ) -> Self {
        Self {
            staged,
            scheduler,
            terminal,
            effects: Vec::new(),
            queue: InternalEventQueue::new(),
            pending_authority: None,
            pending_replacements: BTreeMap::new(),
            pending_replica_material: None,
            pending_presentation_probes: BTreeMap::new(),
        }
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

    fn drain(&mut self) -> Result<(), BattleKernelError> {
        while let Some(event) = self.queue.pop()? {
            self.reduce_event(event)?;
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
        self.queue.push_all_source_order(output.events.into_iter().map(|event| {
            match event {
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
            }
        }));
        Ok(())
    }

    fn reduce_button(&mut self, payload: ButtonEventPayload) -> Result<(), BattleKernelError> {
        let ButtonEvent::Pressed(button) = payload.event else {
            return Ok(());
        };
        let reduction = self.staged.ui.reduce_one_button(BattleButtonEvent::Pressed {
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
            self.staged.game.sync_battle_ui_selection(
                payload.endpoint,
                menu_instance_id,
                control_id,
                selected_option_id,
            )?;
            self.install_current_projection()?;
        }
        let events = reduction.intents.into_iter().map(ui_intent_event);
        self.queue.push_all_source_order(events);
        Ok(())
    }

    fn reduce_ui(&mut self, payload: UiEventPayload) -> Result<(), BattleKernelError> {
        let result = self.staged.game.reduce_ui(payload)?;
        match result {
            BattleUiResult::ControlChanged => self.install_current_projection(),
            BattleUiResult::CommandProposal(proposal) => {
                if self.staged.protocol.is_authority() {
                    self.queue.push(InternalEvent::command_proposal(
                        proposal,
                        self.staged.protocol.authority_epoch(),
                    ));
                    Ok(())
                } else {
                    self.staged.game.retain_replica_command(proposal.clone())?;
                    self.arm_replica_proposal(BattleProposalEnvelope::Command(proposal))?;
                    self.install_current_projection()
                }
            }
            BattleUiResult::ReplacementProposal(proposal) => {
                let epoch = self.staged.protocol.authority_epoch();
                if self.staged.protocol.is_authority() {
                    self.pending_replacements.insert(
                        proposal.operation_id.clone(),
                        proposal.clone(),
                    );
                    self.queue
                        .push(InternalEvent::replacement_proposal(proposal, epoch));
                    Ok(())
                } else {
                    self.staged
                        .game
                        .retain_replica_replacement(proposal.clone(), epoch)?;
                    self.arm_replica_proposal(BattleProposalEnvelope::Replacement(proposal))?;
                    self.install_current_projection()
                }
            }
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
        let reduction = self.staged.game.reduce_game(payload)?;
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
        Ok(())
    }

    fn reduce_battle_resolved(
        &mut self,
        payload: BattleResolvedPayload,
    ) -> Result<(), BattleKernelError> {
        let (context, log) = match &self.staged.protocol {
            BattleProtocolState::Authority { context, log, .. } => {
                (context.clone(), log.clone())
            }
            BattleProtocolState::Replica { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "replica emitted BattleResolved".to_owned(),
                });
            }
        };
        let input = AuthorityTransactionInput {
            state: self.staged.game.state().clone(),
            control: self.staged.game.control().clone(),
            menu_allocators: self.staged.game.control().menu_allocators.clone(),
            scripted_policy: self.staged.game.scripted_enemy_policy().clone(),
            authority_epoch: self.staged.protocol.authority_epoch(),
            local_seat: self.staged.game.local_seat(),
            authority_context: context,
            authority_log: log,
            scheduler: self.scheduler.clone(),
        };
        let prepared = match payload.resolution {
            PreparedBattleResolution::Turn {
                transition,
                material_operation_id,
                next_control,
            } => {
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
                    transition,
                    &material_operation_id,
                    next_control,
                )?;
                prepare_authority_turn(
                    input,
                    AuthorityTurnRequest {
                        human_proposals,
                        prepared,
                    },
                    self.staged.game.content(),
                )?
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
                prepare_authority_replacement(
                    input,
                    AuthorityReplacementRequest { decision, prepared },
                    self.staged.game.content(),
                )?
            }
        };
        let entry = prepared.prepared_entry().clone();
        let material_bytes = serde_json::to_vec(&prepared.material_wire().payload).map_err(|error| {
            BattleKernelError::Protocol {
                reason: format!("prepared material serialization failed: {error}"),
            }
        })?;
        self.pending_authority = Some(prepared);
        self.queue.push(InternalEvent::AuthorityEntryReady(
            AuthorityEntryReadyPayload {
                prepared: PreparedAuthorityEntry {
                    revision: entry.revision,
                    operation_id: entry.operation_id,
                    kind: entry.kind,
                    material_bytes,
                    material_digest: entry.material.digest,
                },
            },
        ));
        Ok(())
    }

    fn reduce_authority_ready(
        &mut self,
        payload: AuthorityEntryReadyPayload,
    ) -> Result<(), BattleKernelError> {
        let prepared = self.pending_authority.as_ref().ok_or_else(|| {
            BattleKernelError::Invariant {
                reason: "AuthorityEntryReady has no prepared transaction".to_owned(),
            }
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
        self.staged.game.install_material(
            before_digest,
            prepared.state().clone(),
            after_digest,
            prepared.operation_id(),
            next_decision,
            allocator_before.to_vec(),
            prepared.control().clone(),
        )?;
        self.queue.push(InternalEvent::MaterialInstalled(
            MaterialInstalledPayload {
                revision: entry.revision,
                result: EventApplyResult {
                    material_kind: kind,
                    operation_id: entry.operation_id.clone(),
                    before_digest: before_digest.clone(),
                    after_digest: after_digest.clone(),
                },
            },
        ));
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
            self.queue.push(InternalEvent::ControlInstalled(
                ControlInstalledPayload {
                    revision: payload.revision,
                    operation_id: payload.result.operation_id,
                    control: prepared.control().clone(),
                    presentation_barrier: PresentationBarrier {
                        operation_id: prepared.operation_id().clone(),
                        pending_events: prepared.presentation().len(),
                    },
                },
            ));
            return Ok(());
        }

        let pending = self.pending_replica_material.as_ref().ok_or_else(|| {
            BattleKernelError::Invariant {
                reason: "replica MaterialInstalled has no applied material".to_owned(),
            }
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
                state: self.staged.game.state().clone(),
                control: self.staged.game.control().clone(),
            };
            let published = prepared.publish_after_validation(&validator)?;
            self.install_published_authority(published, payload)?;
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
            let (actions, proposal_actions) = match &mut self.staged.protocol {
                BattleProtocolState::Replica { replica, leases, .. } => {
                    let (_, proposal_actions) = leases.observe_committed(
                        &pending.entry.operation_id,
                        &mut self.scheduler,
                    );
                    let actions = replica
                        .record_replica_stage(
                            &pending.entry,
                            ReplicaMechanicalStage::ControlInstalled {
                                control_id: control_id_of(&pending.entry.next_control),
                            },
                        )
                        .map_err(protocol_error)?;
                    (actions, proposal_actions)
                }
                BattleProtocolState::Authority { .. } => {
                    return Err(BattleKernelError::Invariant {
                        reason: "authority received replica control stage".to_owned(),
                    });
                }
            };
            self.apply_proposal_actions(proposal_actions)?;
            self.map_replica_actions(actions)?;
            let revision = pending.entry.revision;
            let operation_id = pending.entry.operation_id.clone();
            self.install_presentation_plan(
                pending.entry.revision,
                pending.entry.operation_id,
                pending.applied.presentation,
            )?;
            self.resolve_pending_presentation_probe(revision, &operation_id)?;
        }

        if let Some(event) = self.staged.game.take_pending_no_legal_replacement()? {
            self.queue.push(event);
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
            || published.operation_id != payload.operation_id
        {
            return Err(BattleKernelError::Invariant {
                reason: "published authority transaction diverged from staged game".to_owned(),
            });
        }
        let revision = published.commit.entry.revision;
        let operation_id = published.operation_id.clone();
        let presentation = published.presentation.clone();
        self.scheduler = published.scheduler;
        match &mut self.staged.protocol {
            BattleProtocolState::Authority { log, .. } => *log = published.log,
            BattleProtocolState::Replica { .. } => {
                return Err(BattleKernelError::Invariant {
                    reason: "published authority transaction installed on replica".to_owned(),
                });
            }
        }
        map_authority_actions(&mut self.effects, published.commit.actions)?;
        self.install_presentation_plan(revision, operation_id, presentation)
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
            self.staged.suspended || self.staged.terminal_fenced,
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
            payload: serde_json::to_value(envelope).map_err(|error| BattleKernelError::Protocol {
                reason: format!("proposal encoding failed: {error}"),
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
                    if proposal.connection_generation != context.connection_generation {
                        return Ok(());
                    }
                } else if !peer_bindings.iter().any(|binding| {
                    binding.seat_id == proposal.from
                        && binding.connection_generation == proposal.connection_generation
                }) {
                    return Ok(());
                }
                let peer = !local;
                let admission = proposals.admit(&ProposalIdentity {
                    operation_id: proposal.operation_id.clone(),
                    fingerprint: proposal.fingerprint.clone(),
                });
                match admission {
                    ProposalAdmission::Duplicate => return Ok(()),
                    ProposalAdmission::Admitted => (context.clone(), peer),
                    other => {
                        return Err(BattleKernelError::Protocol {
                            reason: format!("authority proposal admission failed: {other:?}"),
                        });
                    }
                }
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        };
        let envelope: BattleProposalEnvelope = serde_json::from_value(proposal.payload)
            .map_err(|error| BattleKernelError::Protocol {
                reason: format!("typed proposal decode failed: {error}"),
            })?;
        if envelope.operation_id() != &proposal.operation_id
            || envelope.fingerprint() != proposal.fingerprint
        {
            return Err(BattleKernelError::Protocol {
                reason: "proposal envelope identity/fingerprint mismatch".to_owned(),
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
                self.queue.push(InternalEvent::command_proposal(value, epoch));
            }
            BattleProposalEnvelope::Replacement(value) => {
                self.pending_replacements.insert(
                    value.operation_id.clone(),
                    value.clone(),
                );
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
            ValidatedFrameBody::Terminal(body) => {
                self.enter_terminal(body.reason)?;
                Ok(())
            }
            other => Err(BattleKernelError::Protocol {
                reason: format!("Battle protocol frame is not yet valid in this phase: {other:?}"),
            }),
        }
    }

    fn receive_authority_entry(
        &mut self,
        endpoint: SeatId,
        context: FrameContext,
        body: AuthorityEntryBody,
    ) -> Result<(), BattleKernelError> {
        let entry = body.with_context(context.clone());
        let step = match &mut self.staged.protocol {
            BattleProtocolState::Replica {
                authority_seat,
                authority_generation,
                replica,
                ..
            } => {
                if endpoint != self.staged.game.local_seat()
                    || context.sender_seat_id != *authority_seat
                    || context.authority_seat_id != *authority_seat
                    || context.connection_generation != *authority_generation
                {
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
                log,
                ..
            } => {
                if endpoint != authority_context.sender_seat_id
                    || context.authority_seat_id != authority_context.authority_seat_id
                    || context.sender_seat_id == authority_context.sender_seat_id
                {
                    return Ok(());
                }
                let receipt = AuthorityReceipt {
                    context,
                    revision: body.revision,
                    operation_id: body.operation_id,
                    stage: body.stage,
                    control_id: body.control_id,
                };
                log.accept_receipt_detailed(receipt, &mut self.scheduler).actions
            }
            BattleProtocolState::Replica { .. } => return Ok(()),
        };
        map_authority_actions(&mut self.effects, actions)?;
        Ok(())
    }

    fn map_replica_actions(
        &mut self,
        actions: Vec<ReplicaAction>,
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
                        Err(error) => {
                            if let Some(reason) = error.terminal_reason() {
                                self.enter_terminal(reason.to_owned())?;
                                return Ok(());
                            }
                            return Err(BattleKernelError::Protocol {
                                reason: error.to_string(),
                            });
                        }
                    };
                    let (before_digest, allocator_before) =
                        replica_material_metadata(&entry)?;
                    self.staged.game.install_material(
                        &before_digest,
                        applied.after_state.clone(),
                        &applied.after_digest,
                        &entry.operation_id,
                        applied.next_decision,
                        allocator_before,
                        applied.next_control.clone(),
                    )?;
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
                    self.queue.push(InternalEvent::MaterialInstalled(
                        MaterialInstalledPayload {
                            revision: entry.revision,
                            result: EventApplyResult {
                                material_kind: kind,
                                operation_id: entry.operation_id,
                                before_digest,
                                after_digest: applied.after_digest,
                            },
                        },
                    ));
                }
                ReplicaAction::ProjectControl {
                    entry,
                    expected_control_id,
                } => {
                    let pending = self.pending_replica_material.as_ref().ok_or_else(|| {
                        BattleKernelError::Invariant {
                            reason: "ProjectControl arrived before material installation".to_owned(),
                        }
                    })?;
                    if pending.entry != entry
                        || expected_control_id != control_id_of(&entry.next_control)
                    {
                        return Err(BattleKernelError::Invariant {
                            reason: "replica ProjectControl identity mismatch".to_owned(),
                        });
                    }
                    self.queue.push(InternalEvent::ControlInstalled(
                        ControlInstalledPayload {
                            revision: entry.revision,
                            operation_id: entry.operation_id.clone(),
                            control: pending.applied.next_control.clone(),
                            presentation_barrier: PresentationBarrier {
                                operation_id: entry.operation_id,
                                pending_events: pending.applied.presentation.len(),
                            },
                        },
                    ));
                }
                ReplicaAction::ProbePresentation { entry } => {
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
                ReplicaAction::EnterTerminal { reason } => self.enter_terminal(reason)?,
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
        let revision = self
            .staged
            .presentation_revisions
            .remove(&event_id);
        let report = self
            .staged
            .presentations
            .settle(endpoint, event_id, outcome)?;
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
                .presentation_result(
                    revision,
                    er_protocol::PresentationProbeOutcome::Settled,
                )
                .map_err(protocol_error)?;
            self.map_replica_actions(actions)?;
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
        match &mut self.staged.protocol {
            BattleProtocolState::Authority { log, .. } => {
                let actions = log
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
                    map_recovery_dispose_actions(&mut self.effects, actions);
                } else {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }
            }
        }
        Ok(())
    }

    fn transport_changed(
        &mut self,
        endpoint: SeatId,
        state: TransportState,
        generation: ConnectionGeneration,
    ) -> Result<(), BattleKernelError> {
        let connected = state == TransportState::Connected;
        let scheduler_commands = self
            .scheduler
            .set_connected(endpoint, connected)
            .map_err(protocol_error)?;
        for command in scheduler_commands {
            map_scheduler_command(&mut self.effects, command);
        }
        match &mut self.staged.protocol {
            BattleProtocolState::Authority {
                context,
                peer_bindings,
                log,
                ..
            } => {
                if connected
                    && let Some(binding) = peer_bindings
                        .iter_mut()
                        .find(|binding| binding.seat_id == endpoint)
                {
                    if generation < binding.connection_generation {
                        return Ok(());
                    }
                    binding.connection_generation = generation;
                    let outcome = log
                        .rebind_connection(context.clone(), peer_bindings.clone())
                        .map_err(protocol_error)?;
                    map_authority_actions(&mut self.effects, outcome.actions)?;
                }
            }
            BattleProtocolState::Replica {
                context,
                authority_seat,
                authority_generation,
                replica,
                leases,
                ..
            } => {
                if endpoint == *authority_seat && connected {
                    if generation < *authority_generation {
                        return Ok(());
                    }
                    *authority_generation = generation;
                    replica
                        .rebind_connection(context.clone(), generation)
                        .map_err(protocol_error)?;
                    let (_, actions) = leases.rebind(endpoint, generation).map_err(protocol_error)?;
                    self.apply_proposal_actions(actions)?;
                }
            }
        }
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
        if self.terminal.is_some() {
            return Ok(());
        }
        let terminal = TerminalState {
            terminal_id: format!("m3-terminal-{}", self.staged.game.local_seat()),
            reason,
        };
        self.staged.terminal_fenced = true;
        self.install_current_projection()?;
        self.terminal = Some(terminal.clone());
        self.effects.push(KernelEffect::EnterSharedTerminal { terminal });
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
                }
            }
        }
        Ok(())
    }

    fn validate_quiescent(&self) -> Result<(), BattleKernelError> {
        if !self.queue.is_empty()
            || self.pending_authority.is_some()
            || !self.pending_replacements.is_empty()
            || self.pending_replica_material.is_some()
            || !self.pending_presentation_probes.is_empty()
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
        self.staged.validate_quiescent()
    }
}

#[derive(Clone)]
struct AuthorityStageValidator {
    state: er_state::snapshot::GameState,
    control: BattleControlPlan,
}

impl EnclosingKernelValidation for AuthorityStageValidator {
    fn validate_authority_stage(
        &self,
        staged: &AuthorityPreparedTransaction,
    ) -> Result<(), AuthorityTransactionError> {
        if staged.state() != &self.state
            || staged.control() != &self.control
            || staged.menu_allocators() != self.control.menu_allocators.as_slice()
        {
            return Err(AuthorityTransactionError::EnclosingValidation {
                reason: "game/control/allocator stage diverged before log publication".to_owned(),
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
) -> Option<(er_types::battle_ids::MenuInstanceId, &str, er_types::MenuOptionId)> {
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
        } => InternalEvent::Ui(UiEventPayload::cancel(
            seat,
            menu_instance_id,
            control_id,
        )),
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
                let timer = scheduler.timer(*timer_id).ok_or_else(|| {
                    BattleKernelError::Invariant {
                        reason: format!(
                            "input router emitted schedule for unknown timer {timer_id}"
                        ),
                    }
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
        }
    }
    Ok(())
}

fn map_proposal_actions(
    effects: &mut Vec<KernelEffect>,
    actions: Vec<ProposalLeaseAction>,
) {
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
            er_protocol::RecoveryAction::Terminalize { reason } => {
                effects.push(KernelEffect::EnterSharedTerminal {
                    terminal: TerminalState {
                        terminal_id: "m3-recovery".to_owned(),
                        reason,
                    },
                });
            }
            _ => {}
        }
    }
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
