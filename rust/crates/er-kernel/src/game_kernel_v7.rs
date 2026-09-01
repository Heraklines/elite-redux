//! GameKernelV7: sole production owner for the direct M9-E runtime path.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_ai::authority_v2::AuthorityAiV2;
use er_ai::full_surface::{AiActionKindV1, AiActorViewV1, AiScoreContextV1, legal_actions_v1};
use er_canonical::{canonical_bytes, content_digest};
use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_game::m9e_internal_event_v2::{
    GameInternalEventKindV2, GameInternalEventQueueV2, GameInternalEventV2,
};
use er_game::m9e_material_v6::{
    AppliedGameMaterialLedgerV1, GameMaterialApplyOutcomeV6, GamePlatformEffectV2,
    GamePresentationEffectV2,
};
use er_game::m9e_new_run_v6::construct_natural_run_v6;
use er_game::m9e_runtime_v6::{
    GameActionDispatchContextV1, GameDomainExecutionInputV1, GameRuntimeSnapshotV6, GameRuntimeV6,
};
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapErrorV1, RunBootstrapMachineV1,
    RunBootstrapStageV1,
};
use er_protocol::snapshot::ProposalFingerprintSnapshotV2;
use er_protocol::{EndpointRole, ProtocolRuntimeSnapshotV2};
use er_state::m7_state::ProfileStateV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::MenuInstanceId;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::ui_menu::NavigationDirection;
use er_types::{
    BootstrapActionV1, ConnectionGeneration, GAME_ACTION_SCHEMA_VERSION_V1, GameActionContextV1,
    GameActionV1, GameButton, GameControlKindV2, GameControlPlanV2, GameMenuCancelV2,
    GameProposalV1, OperationId, PlatformRequestId, RunOutcome, SafeU53, SeatId,
    StarterSelectionV1, TerminalState,
};
use thiserror::Error;

use crate::snapshot::{
    HeldLogicalButtonSnapshotV2, InputButtonLockSnapshotV2, InputRouterSnapshotV2,
    KernelSchedulerSnapshotV2, PhysicalInputSourceV2, PressedPhysicalInputSnapshotV2,
};
use crate::snapshot_v7::{
    CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7, CoreGameKernelSnapshotV7,
    GameKernelLifecycleSnapshotV7, PendingPlatformRequestV2, PendingPresentationV3,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GameKernelRoleV7 {
    Authority,
    Replica,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameProposalEnvelopeV2 {
    pub schema_version: u32,
    pub sender_seat: SeatId,
    pub connection_generation: ConnectionGeneration,
    pub proposal: GameProposalV1,
}

#[derive(Clone, Debug, PartialEq)]
pub enum GameKernelEffectV7 {
    UiChanged(GameControlPlanV2),
    ProposalReady {
        operation_id: OperationId,
        bytes: Vec<u8>,
    },
    AuthorityMaterial {
        operation_id: OperationId,
        bytes: Vec<u8>,
    },
    Presentation(GamePresentationEffectV2),
    Platform(GamePlatformEffectV2),
    Terminal(TerminalState),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GameKernelStepV7 {
    pub effects: Vec<GameKernelEffectV7>,
    pub internal_events: Vec<GameInternalEventKindV2>,
}

#[derive(Clone, Debug)]
enum GameKernelLifecycleV7 {
    Bootstrap(RunBootstrapMachineV1),
    Active(GameRuntimeV6),
    Terminal {
        runtime: GameRuntimeV6,
        terminal: TerminalState,
    },
}

#[derive(Clone, Debug)]
pub struct GameKernelV7 {
    lifecycle: GameKernelLifecycleV7,
    content: Arc<PreparedGameContentV2>,
    local_seat: SeatId,
    role: GameKernelRoleV7,
    authority_ai: Option<AuthorityAiV2>,
    input_router: InputRouterSnapshotV2,
    scheduler: KernelSchedulerSnapshotV2,
    next_menu_instance_id: MenuInstanceId,
    protocol: Option<ProtocolRuntimeSnapshotV2>,
    pending_presentations: BTreeMap<er_types::PresentationEventId, PendingPresentationV3>,
    pending_platform: BTreeMap<PlatformRequestId, PendingPlatformRequestV2>,
    replay_sequence: SafeU53,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameKernelV7Error {
    #[error("GameKernelV7 state, input, or lifecycle is invalid")]
    Invalid,
    #[error("GameKernelV7 bootstrap failed: {0}")]
    Bootstrap(String),
    #[error("GameKernelV7 runtime failed: {0}")]
    Runtime(String),
    #[error("GameKernelV7 internal event transaction failed: {0}")]
    Internal(String),
    #[error("GameKernelV7 snapshot failed: {0}")]
    Snapshot(String),
}

impl GameKernelV7 {
    #[allow(clippy::too_many_arguments)]
    pub fn natural_start(
        profile: ProfileStateV1,
        seed: String,
        local_seat: SeatId,
        save_slots: Vec<String>,
        local_is_host: bool,
        content: Arc<PreparedGameContentV2>,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: Option<ProtocolRuntimeSnapshotV2>,
    ) -> Result<Self, GameKernelV7Error> {
        let role = protocol
            .as_ref()
            .map_or(GameKernelRoleV7::Authority, |protocol| {
                match protocol.role {
                    EndpointRole::Authority => GameKernelRoleV7::Authority,
                    EndpointRole::Replica => GameKernelRoleV7::Replica,
                }
            });
        let catalog = bootstrap_catalog(content.as_ref(), local_seat, save_slots, local_is_host)?;
        let bootstrap = RunBootstrapMachineV1::new(profile, seed, local_seat, catalog)
            .map_err(|error| GameKernelV7Error::Bootstrap(error.to_string()))?;
        let next_menu_instance_id = next_menu_after(bootstrap.menu_instance_high_water)?;
        let authority_ai =
            (role == GameKernelRoleV7::Authority).then(|| AuthorityAiV2::new(content.ai.clone()));
        let value = Self {
            lifecycle: GameKernelLifecycleV7::Bootstrap(bootstrap),
            content,
            local_seat,
            role,
            authority_ai,
            next_menu_instance_id,
            input_router: empty_input_router(),
            scheduler,
            protocol,
            pending_presentations: BTreeMap::new(),
            pending_platform: BTreeMap::new(),
            replay_sequence: SafeU53::ZERO,
        };
        value.validate()?;
        Ok(value)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_active(
        state: GameStateV6,
        next_authority_revision: SafeU53,
        local_seat: SeatId,
        role: GameKernelRoleV7,
        content: Arc<PreparedGameContentV2>,
        input_router: InputRouterSnapshotV2,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: Option<ProtocolRuntimeSnapshotV2>,
    ) -> Result<Self, GameKernelV7Error> {
        let next_menu_instance_id = next_menu_from_state(&state)?;
        let runtime = GameRuntimeV6::new(Some(state), content.clone(), next_authority_revision)
            .map_err(runtime_error)?;
        let authority_ai =
            (role == GameKernelRoleV7::Authority).then(|| AuthorityAiV2::new(content.ai.clone()));
        let value = Self {
            lifecycle: GameKernelLifecycleV7::Active(runtime),
            content,
            local_seat,
            role,
            authority_ai,
            next_menu_instance_id,
            input_router,
            scheduler,
            protocol,
            pending_presentations: BTreeMap::new(),
            pending_platform: BTreeMap::new(),
            replay_sequence: SafeU53::ZERO,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn from_snapshot(
        snapshot: CoreGameKernelSnapshotV7,
        local_seat: SeatId,
        role: GameKernelRoleV7,
        content: Arc<PreparedGameContentV2>,
    ) -> Result<Self, GameKernelV7Error> {
        snapshot
            .validate(content.as_ref())
            .map_err(|error| GameKernelV7Error::Snapshot(error.to_string()))?;
        let material_ledger = snapshot.material_ledger.clone();
        let authority_ai = match (role, snapshot.authority_ai.clone()) {
            (GameKernelRoleV7::Authority, Some(snapshot)) => Some(
                AuthorityAiV2::from_snapshot(content.ai.clone(), snapshot)
                    .map_err(|_| GameKernelV7Error::Invalid)?,
            ),
            (GameKernelRoleV7::Authority, None) => Some(AuthorityAiV2::new(content.ai.clone())),
            (GameKernelRoleV7::Replica, None) => None,
            (GameKernelRoleV7::Replica, Some(_)) => return Err(GameKernelV7Error::Invalid),
        };
        let lifecycle = match snapshot.lifecycle {
            GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) => {
                GameKernelLifecycleV7::Bootstrap(bootstrap)
            }
            GameKernelLifecycleSnapshotV7::Active(state) => GameKernelLifecycleV7::Active(
                GameRuntimeV6::from_snapshot(
                    GameRuntimeSnapshotV6 {
                        state: Some(state),
                        material_ledger: material_ledger.clone(),
                    },
                    content.clone(),
                )
                .map_err(runtime_error)?,
            ),
            GameKernelLifecycleSnapshotV7::Terminal {
                state,
                control: _,
                terminal,
            } => GameKernelLifecycleV7::Terminal {
                runtime: GameRuntimeV6::from_snapshot(
                    GameRuntimeSnapshotV6 {
                        state: Some(state),
                        material_ledger: material_ledger.clone(),
                    },
                    content.clone(),
                )
                .map_err(runtime_error)?,
                terminal,
            },
        };
        let value = Self {
            lifecycle,
            content,
            local_seat,
            role,
            authority_ai,
            next_menu_instance_id: snapshot.next_menu_instance_id,
            input_router: snapshot.input_router,
            scheduler: snapshot.scheduler,
            protocol: snapshot.protocol,
            pending_presentations: snapshot.pending_presentations,
            pending_platform: snapshot.pending_platform,
            replay_sequence: snapshot.replay_sequence,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn snapshot(&self) -> Result<CoreGameKernelSnapshotV7, GameKernelV7Error> {
        let (lifecycle, material_ledger) = match &self.lifecycle {
            GameKernelLifecycleV7::Bootstrap(bootstrap) => (
                GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap.clone()),
                AppliedGameMaterialLedgerV1::new(safe_one())
                    .map_err(|error| GameKernelV7Error::Snapshot(error.to_string()))?,
            ),
            GameKernelLifecycleV7::Active(runtime) => {
                let snapshot = runtime.snapshot();
                let state = snapshot.state.ok_or(GameKernelV7Error::Invalid)?;
                (
                    GameKernelLifecycleSnapshotV7::Active(state),
                    snapshot.material_ledger,
                )
            }
            GameKernelLifecycleV7::Terminal { runtime, terminal } => {
                let snapshot = runtime.snapshot();
                let state = snapshot.state.ok_or(GameKernelV7Error::Invalid)?;
                let control = state
                    .active_run
                    .as_ref()
                    .map(|run| run.control.clone())
                    .unwrap_or_else(|| {
                        complete_control(snapshot.material_ledger.next_authority_revision)
                    });
                (
                    GameKernelLifecycleSnapshotV7::Terminal {
                        state,
                        control,
                        terminal: terminal.clone(),
                    },
                    snapshot.material_ledger,
                )
            }
        };
        let snapshot = CoreGameKernelSnapshotV7 {
            schema_version: CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7,
            lifecycle,
            authority_ai: self.authority_ai.as_ref().map(AuthorityAiV2::snapshot),
            input_router: self.input_router.clone(),
            scheduler: self.scheduler.clone(),
            next_menu_instance_id: self.next_menu_instance_id,
            protocol: self.protocol.clone(),
            pending_presentations: self.pending_presentations.clone(),
            pending_platform: self.pending_platform.clone(),
            material_ledger,
            replay_sequence: self.replay_sequence,
            prepared_transaction: None,
        };
        snapshot
            .validate(self.content.as_ref())
            .map_err(|error| GameKernelV7Error::Snapshot(error.to_string()))?;
        Ok(snapshot)
    }

    pub fn state(&self) -> Option<&GameStateV6> {
        match &self.lifecycle {
            GameKernelLifecycleV7::Bootstrap(_) => None,
            GameKernelLifecycleV7::Active(runtime)
            | GameKernelLifecycleV7::Terminal { runtime, .. } => runtime.state(),
        }
    }

    pub fn current_control(&self) -> Option<&GameControlPlanV2> {
        match &self.lifecycle {
            GameKernelLifecycleV7::Bootstrap(bootstrap) => Some(&bootstrap.control),
            GameKernelLifecycleV7::Active(runtime)
            | GameKernelLifecycleV7::Terminal { runtime, .. } => runtime
                .state()
                .and_then(|state| state.active_run.as_ref())
                .map(|run| &run.control),
        }
    }

    pub fn prepare_authority_ai_commands(
        &mut self,
    ) -> Result<Vec<er_types::battle_command::AcceptedBattleCommand>, GameKernelV7Error> {
        if self.role != GameKernelRoleV7::Authority {
            return Err(GameKernelV7Error::Invalid);
        }
        let state = self.state().cloned().ok_or(GameKernelV7Error::Invalid)?;
        let run = state
            .active_run
            .as_ref()
            .ok_or(GameKernelV7Error::Invalid)?;
        let battle = run.battle.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        let player_targets = battle
            .field
            .slots
            .iter()
            .filter(|slot| {
                slot.slot.side == er_types::battle_ids::BattleSide::Player
                    && slot.occupant.is_some()
            })
            .map(|slot| slot.slot)
            .collect::<Vec<_>>();
        if player_targets.is_empty() {
            return Err(GameKernelV7Error::Invalid);
        }
        let policy = self
            .content
            .ai
            .mode(run.mode.get().get())
            .map(|mode| mode.policy)
            .ok_or(GameKernelV7Error::Invalid)?;
        let mut accepted = Vec::new();
        for field in battle.field.slots.iter().filter(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Enemy && slot.occupant.is_some()
        }) {
            let actor_id = field.occupant.ok_or(GameKernelV7Error::Invalid)?;
            let actor = battle
                .enemy_party
                .iter()
                .find(|pokemon| pokemon.id == actor_id)
                .ok_or(GameKernelV7Error::Invalid)?;
            let moves = actor
                .moves
                .iter()
                .enumerate()
                .filter_map(|(index, slot)| {
                    let slot = slot.as_ref()?;
                    let definition = self.content.battle.move_definition(slot.move_id).ok()?;
                    if slot.pp_used >= definition.base_pp {
                        return None;
                    }
                    let move_slot = u8::try_from(index).ok()?;
                    let power = match definition.power {
                        er_types::battle_model::MovePower::None => 0,
                        er_types::battle_model::MovePower::Value(power) => power,
                    };
                    Some((
                        slot.move_id,
                        move_slot,
                        power,
                        definition.priority,
                        player_targets
                            .iter()
                            .map(|target| target.position)
                            .collect::<Vec<_>>(),
                    ))
                })
                .collect::<Vec<_>>();
            let actor_view = AiActorViewV1 {
                pokemon: actor.id,
                hp: actor.hp,
                max_hp: actor.max_hp,
                moves,
                legal_switches: Vec::new(),
            };
            let legal = legal_actions_v1(&actor_view);
            let target = run
                .party
                .iter()
                .find(|pokemon| {
                    battle.field.slots.iter().any(|slot| {
                        slot.slot.side == er_types::battle_ids::BattleSide::Player
                            && slot.occupant == Some(pokemon.id)
                    })
                })
                .ok_or(GameKernelV7Error::Invalid)?;
            let contexts = legal
                .iter()
                .cloned()
                .map(|action| {
                    (
                        action,
                        AiScoreContextV1 {
                            effectiveness_percent: 100,
                            accuracy_percent: 100,
                            target_hp: target.hp,
                            target_max_hp: target.max_hp,
                            ally_damage_penalty: 0,
                        },
                    )
                })
                .collect::<BTreeMap<_, _>>();
            let decision = self
                .authority_ai
                .as_mut()
                .ok_or(GameKernelV7Error::Invalid)?
                .choose_single(true, policy, &actor_view, &contexts, None)
                .map_err(|_| GameKernelV7Error::Invalid)?;
            let action = decision.actions.first().ok_or(GameKernelV7Error::Invalid)?;
            let command = match action.kind {
                AiActionKindV1::Move => {
                    let slot = action.move_slot.ok_or(GameKernelV7Error::Invalid)?;
                    let target_position = action.target.ok_or(GameKernelV7Error::Invalid)?;
                    let target = player_targets
                        .iter()
                        .find(|target| target.position == target_position)
                        .copied()
                        .ok_or(GameKernelV7Error::Invalid)?;
                    er_types::battle_command::BattleCommand::fight(
                        actor.id,
                        er_types::battle_ids::MoveSlotIndex::new(slot)
                            .map_err(|_| GameKernelV7Error::Invalid)?,
                        er_types::battle_command::BattleTargetSelection::selected(vec![target])
                            .map_err(|_| GameKernelV7Error::Invalid)?,
                    )
                    .map_err(|_| GameKernelV7Error::Invalid)?
                }
                AiActionKindV1::Switch => return Err(GameKernelV7Error::Invalid),
            };
            let script_cursor =
                SafeU53::new(decision.decision_sequence).map_err(|_| GameKernelV7Error::Invalid)?;
            let operation = er_types::battle_command::scripted_enemy_command_operation_id(
                battle.battle_id,
                battle.wave,
                battle.turn,
                field.slot,
                script_cursor,
            )
            .map_err(|_| GameKernelV7Error::Invalid)?;
            let command = er_types::battle_command::ScriptedEnemyBattleCommandV1::new(
                operation,
                battle.battle_id,
                battle.wave,
                battle.turn,
                script_cursor,
                actor.id,
                field.slot,
                command,
            )
            .map_err(|_| GameKernelV7Error::Invalid)?;
            accepted.push(er_types::battle_command::AcceptedBattleCommand::scripted_enemy(command));
        }
        Ok(accepted)
    }

    pub fn raw_input(
        &mut self,
        event: RawInputEvent,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        if matches!(self.lifecycle, GameKernelLifecycleV7::Bootstrap(_)) {
            return self.bootstrap_input(event);
        }
        if matches!(self.lifecycle, GameKernelLifecycleV7::Terminal { .. }) {
            return Ok(GameKernelStepV7::default());
        }
        self.active_input(event)
    }

    pub fn apply_authority_material(
        &mut self,
        bytes: &[u8],
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let runtime = self.active_runtime_mut()?;
        let outcome = runtime.apply_material_bytes(bytes).map_err(runtime_error)?;
        if outcome == GameMaterialApplyOutcomeV6::Applied {
            self.advance_replay_sequence()?;
        }
        let mut step = GameKernelStepV7::default();
        if let Some(control) = self.current_control().cloned() {
            step.effects.push(GameKernelEffectV7::UiChanged(control));
        }
        self.synchronize_terminal(&mut step)?;
        Ok(step)
    }

    pub fn admit_game_proposal(
        &mut self,
        bytes: &[u8],
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        if self.role != GameKernelRoleV7::Authority || bytes.is_empty() {
            return Err(GameKernelV7Error::Invalid);
        }
        let envelope: GameProposalEnvelopeV2 =
            serde_json::from_slice(bytes).map_err(|_| GameKernelV7Error::Invalid)?;
        if envelope.schema_version != 2
            || canonical_bytes(&envelope).map_err(|_| GameKernelV7Error::Invalid)? != bytes
        {
            return Err(GameKernelV7Error::Invalid);
        }
        envelope
            .proposal
            .validate()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        let protocol = self.protocol.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        if envelope.proposal.context.authority_seat
            != protocol.frame_context.context.authority_seat_id
            || !protocol.connections.iter().any(|connection| {
                connection.peer_seat == envelope.sender_seat
                    && connection.generation == envelope.connection_generation
            })
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let fingerprint = content_digest(&envelope.proposal)
            .map(|digest| format!("blake3-v1:{digest}"))
            .map_err(|_| GameKernelV7Error::Invalid)?;
        let admission = protocol
            .proposal_admission
            .as_ref()
            .ok_or(GameKernelV7Error::Invalid)?;
        if let Some(previous) = admission
            .fingerprints
            .iter()
            .find(|entry| entry.operation_id == envelope.proposal.context.operation_id)
        {
            return if previous.fingerprint == fingerprint {
                Ok(GameKernelStepV7::default())
            } else {
                Err(GameKernelV7Error::Invalid)
            };
        }
        let capacity =
            usize::try_from(admission.capacity.get()).map_err(|_| GameKernelV7Error::Invalid)?;
        if admission.disposed || admission.fingerprints.len() >= capacity {
            return Err(GameKernelV7Error::Invalid);
        }
        let action = envelope.proposal.action;
        if matches!(action, GameActionV1::Battle { .. }) {
            return Err(GameKernelV7Error::Invalid);
        }
        let context = GameActionDispatchContextV1 {
            action: envelope.proposal.context.clone(),
            input: execution_input(&action),
            authority: true,
        };
        let mut staged_runtime = self.active_runtime()?.clone();
        let step = execute_action_transaction(&mut staged_runtime, action, context)?;
        let mut staged_protocol = protocol.clone();
        let staged_admission = staged_protocol
            .proposal_admission
            .as_mut()
            .ok_or(GameKernelV7Error::Invalid)?;
        staged_admission
            .fingerprints
            .push(ProposalFingerprintSnapshotV2 {
                operation_id: envelope.proposal.context.operation_id,
                fingerprint,
            });
        staged_admission
            .fingerprints
            .sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
        staged_protocol
            .validate()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(staged_runtime);
        self.protocol = Some(staged_protocol);
        self.advance_replay_sequence()?;
        let mut step = step;
        self.synchronize_terminal(&mut step)?;
        Ok(step)
    }

    pub fn validate(&self) -> Result<(), GameKernelV7Error> {
        self.input_router
            .validate()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        self.scheduler
            .validate()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        if let Some(protocol) = &self.protocol {
            protocol
                .validate()
                .map_err(|_| GameKernelV7Error::Invalid)?;
        }
        self.snapshot().map(|_| ())
    }

    fn bootstrap_input(
        &mut self,
        event: RawInputEvent,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let GameKernelLifecycleV7::Bootstrap(bootstrap) = &mut self.lifecycle else {
            return Err(GameKernelV7Error::Invalid);
        };
        match bootstrap.raw_input(event) {
            Ok(_) => {}
            Err(RunBootstrapErrorV1::RejectedInput) => {
                return Ok(GameKernelStepV7::default());
            }
            Err(error) => return Err(GameKernelV7Error::Bootstrap(error.to_string())),
        }
        self.next_menu_instance_id = next_menu_after(bootstrap.menu_instance_high_water)?;
        if bootstrap.stage != RunBootstrapStageV1::Complete {
            return Ok(GameKernelStepV7 {
                effects: vec![GameKernelEffectV7::UiChanged(bootstrap.control.clone())],
                internal_events: Vec::new(),
            });
        }
        if self.role != GameKernelRoleV7::Authority {
            return Err(GameKernelV7Error::Invalid);
        }
        let bootstrap = bootstrap.clone();
        let mut candidate = construct_natural_run_v6(&bootstrap, self.content.as_ref(), safe_one())
            .map_err(|error| GameKernelV7Error::Bootstrap(error.to_string()))?;
        let command_instance = self.allocate_menu_instance()?;
        let command_control = command_root_control(
            &candidate,
            self.local_seat,
            command_instance,
            increment_safe(safe_one())?,
        )?;
        candidate
            .active_run
            .as_mut()
            .ok_or(GameKernelV7Error::Invalid)?
            .control = command_control;
        let mut runtime =
            GameRuntimeV6::new(None, self.content.clone(), safe_one()).map_err(runtime_error)?;
        let context = GameActionDispatchContextV1 {
            action: GameActionContextV1 {
                operation_id: OperationId::new("bootstrap/new-run/1")
                    .map_err(|_| GameKernelV7Error::Invalid)?,
                authority_seat: self.local_seat,
                authority_revision: safe_one(),
                menu_instance: bootstrap.menu_instance_high_water,
            },
            input: GameDomainExecutionInputV1::BootstrapCandidate(candidate),
            authority: true,
        };
        let step = execute_action_transaction(
            &mut runtime,
            GameActionV1::Bootstrap {
                action: BootstrapActionV1::Confirm,
            },
            context,
        )?;
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(runtime);
        self.advance_replay_sequence()?;
        let mut step = step;
        self.synchronize_terminal(&mut step)?;
        Ok(step)
    }

    fn active_input(
        &mut self,
        event: RawInputEvent,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        match event {
            RawInputEvent::KeyDown {
                code,
                browser_repeat,
                focus,
                ..
            } => {
                if focus != InputFocus::Game
                    || browser_repeat
                    || self.input_router.pressed.iter().any(|pressed| {
                        pressed.seat == self.local_seat
                            && pressed.source == PhysicalInputSourceV2::Keyboard(code.clone())
                    })
                {
                    return Ok(GameKernelStepV7::default());
                }
                let Some(button) = physical_button(&code) else {
                    self.input_router
                        .pressed
                        .push(PressedPhysicalInputSnapshotV2 {
                            seat: self.local_seat,
                            source: PhysicalInputSourceV2::Keyboard(code),
                            logical_button: None,
                            printable: false,
                            accepted: false,
                            menu_instance_id: None,
                        });
                    self.sort_input();
                    return Ok(GameKernelStepV7::default());
                };
                let menu_instance = self
                    .current_control()
                    .and_then(|control| control.menu.as_ref())
                    .map(|menu| menu.instance_id);
                let accepted = self
                    .current_control()
                    .is_some_and(|control| control.actionable && menu_instance.is_some());
                self.input_router
                    .pressed
                    .push(PressedPhysicalInputSnapshotV2 {
                        seat: self.local_seat,
                        source: PhysicalInputSourceV2::Keyboard(code.clone()),
                        logical_button: accepted.then_some(button),
                        printable: matches!(code, PhysicalKey::Enter | PhysicalKey::Space),
                        accepted,
                        menu_instance_id: accepted.then_some(menu_instance).flatten(),
                    });
                if accepted {
                    let instance = menu_instance.ok_or(GameKernelV7Error::Invalid)?;
                    self.input_router
                        .held_buttons
                        .push(HeldLogicalButtonSnapshotV2 {
                            seat: self.local_seat,
                            button,
                            source: PhysicalInputSourceV2::Keyboard(code),
                            menu_instance_id: instance,
                        });
                    self.input_router.locks.push(InputButtonLockSnapshotV2 {
                        seat: self.local_seat,
                        button,
                        menu_instance_id: instance,
                    });
                }
                self.sort_input();
                if !accepted {
                    return Ok(GameKernelStepV7::default());
                }
                self.handle_button(button)
            }
            RawInputEvent::KeyUp { code } => {
                let source = PhysicalInputSourceV2::Keyboard(code);
                self.input_router.pressed.retain(|pressed| {
                    !(pressed.seat == self.local_seat && pressed.source == source)
                });
                self.input_router
                    .held_buttons
                    .retain(|held| !(held.seat == self.local_seat && held.source == source));
                self.input_router.locks.retain(|lock| {
                    self.input_router.held_buttons.iter().any(|held| {
                        held.seat == lock.seat
                            && held.button == lock.button
                            && held.menu_instance_id == lock.menu_instance_id
                    })
                });
                Ok(GameKernelStepV7::default())
            }
            RawInputEvent::WindowBlurred | RawInputEvent::FocusChanged(InputFocus::TextEntry) => {
                self.input_router.focus = InputFocus::TextEntry;
                self.clear_input();
                Ok(GameKernelStepV7::default())
            }
            RawInputEvent::WindowFocused | RawInputEvent::FocusChanged(InputFocus::Game) => {
                self.input_router.focus = InputFocus::Game;
                Ok(GameKernelStepV7::default())
            }
            RawInputEvent::GamepadDown { .. } | RawInputEvent::GamepadUp { .. } => {
                Ok(GameKernelStepV7::default())
            }
        }
    }

    fn handle_button(&mut self, button: GameButton) -> Result<GameKernelStepV7, GameKernelV7Error> {
        match button {
            GameButton::Up | GameButton::Down | GameButton::Left | GameButton::Right => {
                let direction = match button {
                    GameButton::Up => NavigationDirection::Up,
                    GameButton::Down => NavigationDirection::Down,
                    GameButton::Left => NavigationDirection::Left,
                    GameButton::Right => NavigationDirection::Right,
                    _ => return Err(GameKernelV7Error::Invalid),
                };
                self.active_runtime_mut()?
                    .navigate_control(direction)
                    .map_err(runtime_error)?;
                let control = self
                    .current_control()
                    .cloned()
                    .ok_or(GameKernelV7Error::Invalid)?;
                Ok(GameKernelStepV7 {
                    effects: vec![GameKernelEffectV7::UiChanged(control)],
                    internal_events: Vec::new(),
                })
            }
            GameButton::Action | GameButton::Cancel => self.submit_current(button),
            GameButton::Submit
            | GameButton::Menu
            | GameButton::Stats
            | GameButton::CycleShiny
            | GameButton::CycleForm
            | GameButton::CycleGender
            | GameButton::CycleAbility
            | GameButton::CycleNature
            | GameButton::CycleTera
            | GameButton::SpeedUp
            | GameButton::SlowDown
            | GameButton::DevCustom => Ok(GameKernelStepV7::default()),
        }
    }

    fn submit_current(
        &mut self,
        button: GameButton,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let (action, action_context) = if button == GameButton::Action {
            self.active_runtime()?
                .selected_action()
                .map_err(runtime_error)?
        } else {
            self.active_runtime()?
                .cancel_action()
                .map_err(runtime_error)?
        };
        match &action {
            GameActionV1::Battle {
                action: er_types::BattleUiActionV1::OpenFight,
            } => {
                let instance = self.allocate_menu_instance()?;
                let revision = self.active_runtime()?.next_authority_revision();
                let control = move_select_control(
                    self.state().ok_or(GameKernelV7Error::Invalid)?,
                    self.local_seat,
                    instance,
                    revision,
                )?;
                self.active_runtime_mut()?
                    .install_control(control.clone())
                    .map_err(runtime_error)?;
                return Ok(GameKernelStepV7 {
                    effects: vec![GameKernelEffectV7::UiChanged(control)],
                    internal_events: Vec::new(),
                });
            }
            GameActionV1::Battle {
                action: er_types::BattleUiActionV1::OpenParty,
            } => {
                let instance = self.allocate_menu_instance()?;
                let revision = self.active_runtime()?.next_authority_revision();
                let control = switch_select_control(
                    self.state().ok_or(GameKernelV7Error::Invalid)?,
                    self.local_seat,
                    instance,
                    revision,
                )?;
                self.active_runtime_mut()?
                    .install_control(control.clone())
                    .map_err(runtime_error)?;
                return Ok(GameKernelStepV7 {
                    effects: vec![GameKernelEffectV7::UiChanged(control)],
                    internal_events: Vec::new(),
                });
            }
            GameActionV1::Battle {
                action:
                    er_types::BattleUiActionV1::SelectMove { .. }
                    | er_types::BattleUiActionV1::SelectSwitch { .. },
            } if self.role == GameKernelRoleV7::Authority => {
                return self.resolve_local_battle_action(action, action_context);
            }
            _ => {}
        }
        if self.role == GameKernelRoleV7::Replica {
            let proposal = GameProposalV1 {
                schema_version: GAME_ACTION_SCHEMA_VERSION_V1,
                context: action_context.clone(),
                action,
            };
            proposal
                .validate()
                .map_err(|_| GameKernelV7Error::Invalid)?;
            let connection_generation = self
                .protocol
                .as_ref()
                .map(|protocol| protocol.frame_context.context.connection_generation)
                .ok_or(GameKernelV7Error::Invalid)?;
            let envelope = GameProposalEnvelopeV2 {
                schema_version: 2,
                sender_seat: self.local_seat,
                connection_generation,
                proposal,
            };
            let bytes = canonical_bytes(&envelope).map_err(|_| GameKernelV7Error::Invalid)?;
            return Ok(GameKernelStepV7 {
                effects: vec![GameKernelEffectV7::ProposalReady {
                    operation_id: action_context.operation_id,
                    bytes,
                }],
                internal_events: Vec::new(),
            });
        }
        let input = execution_input(&action);
        let context = GameActionDispatchContextV1 {
            action: action_context,
            input,
            authority: true,
        };
        let mut staged = self.active_runtime()?.clone();
        let step = execute_action_transaction(&mut staged, action, context)?;
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(staged);
        self.advance_replay_sequence()?;
        let mut step = step;
        self.synchronize_terminal(&mut step)?;
        Ok(step)
    }

    fn resolve_local_battle_action(
        &mut self,
        action: GameActionV1,
        action_context: GameActionContextV1,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let state = self.state().cloned().ok_or(GameKernelV7Error::Invalid)?;
        let (battle, actor, field) = local_battle_actor(&state, self.local_seat)?;
        let menu = state
            .active_run
            .as_ref()
            .and_then(|run| run.control.menu.as_ref())
            .ok_or(GameKernelV7Error::Invalid)?;
        let command = match &action {
            GameActionV1::Battle {
                action:
                    er_types::BattleUiActionV1::SelectMove {
                        actor: selected_actor,
                        move_slot,
                    },
            } if *selected_actor == actor => er_types::battle_command::BattleCommand::fight(
                actor,
                *move_slot,
                er_types::battle_command::BattleTargetSelection::implicit(),
            )
            .map_err(|_| GameKernelV7Error::Invalid)?,
            GameActionV1::Battle {
                action:
                    er_types::BattleUiActionV1::SelectSwitch {
                        actor: selected_actor,
                        party_slot,
                    },
            } if *selected_actor == actor => {
                er_types::battle_command::BattleCommand::switch(actor, *party_slot)
            }
            _ => return Err(GameKernelV7Error::Invalid),
        };
        let proposal = er_types::battle_command::BattleCommandProposalV1::new(
            action_context.operation_id.clone(),
            battle.battle_id,
            battle.wave,
            battle.turn,
            self.local_seat,
            actor,
            field,
            command,
            menu.instance_id,
            menu.control_id.clone(),
        )
        .map_err(|_| GameKernelV7Error::Invalid)?;
        let mut entries = vec![er_types::battle_command::AcceptedBattleCommand::human(
            proposal,
        )];
        entries.extend(self.prepare_authority_ai_commands()?);
        entries.sort_by_key(|entry| entry.field_slot());
        let commands = er_types::battle_command::CommandSet::new(entries)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        let authority = er_battle::m7_resolver::TurnAuthorityContextV1 {
            authority_seat: self.local_seat,
            revision: action_context.authority_revision,
        };
        let context = GameActionDispatchContextV1 {
            action: action_context,
            input: GameDomainExecutionInputV1::BattleTurn {
                commands,
                authority,
            },
            authority: true,
        };
        let mut staged = self.active_runtime()?.clone();
        let mut step = execute_action_transaction(&mut staged, action, context)?;
        if staged
            .state()
            .and_then(|state| state.active_run.as_ref())
            .is_some_and(|run| {
                matches!(run.outcome, RunOutcome::InProgress) && run.battle.is_some()
            })
        {
            let instance = self.allocate_menu_instance()?;
            let control = command_root_control(
                staged.state().ok_or(GameKernelV7Error::Invalid)?,
                self.local_seat,
                instance,
                staged.next_authority_revision(),
            )?;
            staged
                .install_control(control.clone())
                .map_err(runtime_error)?;
            step.effects.push(GameKernelEffectV7::UiChanged(control));
        }
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(staged);
        self.advance_replay_sequence()?;
        self.synchronize_terminal(&mut step)?;
        Ok(step)
    }

    fn install_step_effects(
        &mut self,
        effects: &[GameKernelEffectV7],
    ) -> Result<(), GameKernelV7Error> {
        for effect in effects {
            match effect {
                GameKernelEffectV7::Presentation(presentation) => {
                    if self
                        .pending_presentations
                        .insert(
                            presentation.event_id,
                            PendingPresentationV3 {
                                event_id: presentation.event_id,
                                semantic: presentation.semantic,
                                blocking: presentation.blocking,
                                skip: presentation.skip,
                            },
                        )
                        .is_some()
                    {
                        return Err(GameKernelV7Error::Invalid);
                    }
                }
                GameKernelEffectV7::Platform(platform) => {
                    let request = platform_request_id(platform);
                    if self
                        .pending_platform
                        .insert(
                            request,
                            PendingPlatformRequestV2 {
                                request_id: request,
                                effect: platform.clone(),
                            },
                        )
                        .is_some()
                    {
                        return Err(GameKernelV7Error::Invalid);
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn synchronize_terminal(
        &mut self,
        step: &mut GameKernelStepV7,
    ) -> Result<(), GameKernelV7Error> {
        let GameKernelLifecycleV7::Active(runtime) = &self.lifecycle else {
            return Ok(());
        };
        let Some(run) = runtime.state().and_then(|state| state.active_run.as_ref()) else {
            return Ok(());
        };
        let reason = match run.outcome {
            RunOutcome::InProgress => return Ok(()),
            RunOutcome::Victory => "VICTORY",
            RunOutcome::Defeat => "DEFEAT",
        };
        let terminal = TerminalState {
            terminal_id: format!("run/{}/terminal", run.run_id),
            reason: reason.to_owned(),
        };
        let runtime = runtime.clone();
        self.lifecycle = GameKernelLifecycleV7::Terminal {
            runtime,
            terminal: terminal.clone(),
        };
        step.effects.push(GameKernelEffectV7::Terminal(terminal));
        Ok(())
    }

    fn active_runtime(&self) -> Result<&GameRuntimeV6, GameKernelV7Error> {
        match &self.lifecycle {
            GameKernelLifecycleV7::Active(runtime) => Ok(runtime),
            _ => Err(GameKernelV7Error::Invalid),
        }
    }

    fn active_runtime_mut(&mut self) -> Result<&mut GameRuntimeV6, GameKernelV7Error> {
        match &mut self.lifecycle {
            GameKernelLifecycleV7::Active(runtime) => Ok(runtime),
            _ => Err(GameKernelV7Error::Invalid),
        }
    }

    fn allocate_menu_instance(&mut self) -> Result<MenuInstanceId, GameKernelV7Error> {
        let allocated = self.next_menu_instance_id;
        self.next_menu_instance_id = next_menu_after(allocated)?;
        Ok(allocated)
    }

    fn advance_replay_sequence(&mut self) -> Result<(), GameKernelV7Error> {
        let next = self
            .replay_sequence
            .get()
            .checked_add(1)
            .ok_or(GameKernelV7Error::Invalid)?;
        self.replay_sequence = SafeU53::new(next).map_err(|_| GameKernelV7Error::Invalid)?;
        Ok(())
    }

    fn sort_input(&mut self) {
        self.input_router
            .pressed
            .sort_by_key(|pressed| (pressed.seat, pressed.source.clone()));
        self.input_router
            .held_buttons
            .sort_by_key(|held| (held.seat, held.button, held.source.clone()));
        self.input_router
            .locks
            .sort_by_key(|lock| (lock.seat, lock.button, lock.menu_instance_id));
    }

    fn clear_input(&mut self) {
        self.input_router.pressed.clear();
        self.input_router.suppressed_printable_keys.clear();
        self.input_router.held_buttons.clear();
        self.input_router.locks.clear();
        self.input_router.repeats.clear();
    }
}

fn execute_action_transaction(
    runtime: &mut GameRuntimeV6,
    action: GameActionV1,
    context: GameActionDispatchContextV1,
) -> Result<GameKernelStepV7, GameKernelV7Error> {
    let mut queue =
        GameInternalEventQueueV2::new(GameInternalEventV2::ControlSelected { action, context })
            .map_err(internal_error)?;
    let mut effects = Vec::new();
    queue
        .run_to_quiescence(|event| match event {
            GameInternalEventV2::ControlSelected { action, context }
            | GameInternalEventV2::ControlCancelled { action, context } => {
                let prepared = runtime
                    .execute(action, context)
                    .map_err(|error| error.to_string())?;
                Ok(vec![GameInternalEventV2::TransitionPrepared(prepared)])
            }
            GameInternalEventV2::TransitionPrepared(prepared) => {
                let operation_id = prepared.material.transition().operation_id.clone();
                effects.push(GameKernelEffectV7::AuthorityMaterial {
                    operation_id: operation_id.clone(),
                    bytes: prepared.material_bytes.clone(),
                });
                effects.extend(
                    prepared
                        .presentation
                        .iter()
                        .cloned()
                        .map(GameKernelEffectV7::Presentation),
                );
                effects.extend(
                    prepared
                        .platform_effects
                        .iter()
                        .cloned()
                        .map(GameKernelEffectV7::Platform),
                );
                effects.push(GameKernelEffectV7::UiChanged(prepared.next_control.clone()));
                let mut children = vec![
                    GameInternalEventV2::MaterialEncoded {
                        operation_id: operation_id.clone(),
                        bytes: prepared.material_bytes,
                    },
                    GameInternalEventV2::MaterialApplied {
                        operation_id,
                        outcome: GameMaterialApplyOutcomeV6::Applied,
                    },
                    GameInternalEventV2::ControlInstalled(prepared.next_control),
                ];
                children.extend(
                    prepared
                        .presentation
                        .into_iter()
                        .map(GameInternalEventV2::PresentationQueued),
                );
                children.extend(
                    prepared
                        .platform_effects
                        .into_iter()
                        .map(GameInternalEventV2::PlatformRequestQueued),
                );
                Ok(children)
            }
            GameInternalEventV2::MaterialEncoded { .. }
            | GameInternalEventV2::MaterialApplied { .. }
            | GameInternalEventV2::PresentationQueued(_)
            | GameInternalEventV2::PlatformRequestQueued(_)
            | GameInternalEventV2::ControlInstalled(_) => Ok(Vec::new()),
            _ => Err("event is not valid in an action transaction".to_owned()),
        })
        .map_err(internal_error)?;
    Ok(GameKernelStepV7 {
        effects,
        internal_events: queue.processed_kinds().to_vec(),
    })
}

fn command_root_control(
    state: &GameStateV6,
    seat: SeatId,
    instance: MenuInstanceId,
    revision: SafeU53,
) -> Result<GameControlPlanV2, GameKernelV7Error> {
    let (battle, actor, field) = local_battle_actor(state, seat)?;
    let operation = er_types::battle_command::player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field,
        seat,
    )
    .map_err(|_| GameKernelV7Error::Invalid)?;
    let entries = vec![
        (
            "battle/command/fight".to_owned(),
            GameActionV1::Battle {
                action: er_types::BattleUiActionV1::OpenFight,
            },
        ),
        (
            "battle/command/party".to_owned(),
            GameActionV1::Battle {
                action: er_types::BattleUiActionV1::OpenParty,
            },
        ),
    ];
    let _actor = actor;
    generic_vertical_control_v2(
        instance,
        revision,
        seat,
        operation,
        GameControlKindV2::BattleCommand,
        "m9e/battle/command",
        &entries,
        GameMenuCancelV2::Disabled,
    )
    .map_err(|_| GameKernelV7Error::Invalid)
}

fn move_select_control(
    state: &GameStateV6,
    seat: SeatId,
    instance: MenuInstanceId,
    revision: SafeU53,
) -> Result<GameControlPlanV2, GameKernelV7Error> {
    let (battle, actor, field) = local_battle_actor(state, seat)?;
    let pokemon = state
        .active_run
        .as_ref()
        .and_then(|run| run.party.iter().find(|pokemon| pokemon.id == actor))
        .ok_or(GameKernelV7Error::Invalid)?;
    let operation = er_types::battle_command::player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field,
        seat,
    )
    .map_err(|_| GameKernelV7Error::Invalid)?;
    let entries = pokemon
        .moves
        .iter()
        .enumerate()
        .filter_map(|(index, slot)| {
            slot.as_ref()?;
            let move_slot = u8::try_from(index).ok()?;
            Some((
                format!("battle/move/{move_slot}"),
                GameActionV1::Battle {
                    action: er_types::BattleUiActionV1::SelectMove {
                        actor,
                        move_slot: er_types::battle_ids::MoveSlotIndex::new(move_slot).ok()?,
                    },
                },
            ))
        })
        .collect::<Vec<_>>();
    generic_vertical_control_v2(
        instance,
        revision,
        seat,
        operation,
        GameControlKindV2::BattleMove,
        "m9e/battle/move",
        &entries,
        GameMenuCancelV2::Back {
            action: Box::new(GameActionV1::Battle {
                action: er_types::BattleUiActionV1::OpenFight,
            }),
        },
    )
    .map_err(|_| GameKernelV7Error::Invalid)
}

fn switch_select_control(
    state: &GameStateV6,
    seat: SeatId,
    instance: MenuInstanceId,
    revision: SafeU53,
) -> Result<GameControlPlanV2, GameKernelV7Error> {
    let (battle, actor, field) = local_battle_actor(state, seat)?;
    let run = state
        .active_run
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let operation = er_types::battle_command::player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field,
        seat,
    )
    .map_err(|_| GameKernelV7Error::Invalid)?;
    let entries = run
        .party
        .iter()
        .enumerate()
        .filter(|(_, pokemon)| {
            pokemon.id != actor
                && !pokemon.fainted
                && !battle
                    .field
                    .slots
                    .iter()
                    .any(|slot| slot.occupant == Some(pokemon.id))
        })
        .filter_map(|(index, _)| {
            let party_slot = u8::try_from(index).ok()?;
            Some((
                format!("battle/switch/{party_slot}"),
                GameActionV1::Battle {
                    action: er_types::BattleUiActionV1::SelectSwitch {
                        actor,
                        party_slot: er_types::battle_ids::PartyIndex::new(party_slot).ok()?,
                    },
                },
            ))
        })
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return Err(GameKernelV7Error::Invalid);
    }
    generic_vertical_control_v2(
        instance,
        revision,
        seat,
        operation,
        GameControlKindV2::BattleSwitch,
        "m9e/battle/switch",
        &entries,
        GameMenuCancelV2::Back {
            action: Box::new(GameActionV1::Battle {
                action: er_types::BattleUiActionV1::OpenParty,
            }),
        },
    )
    .map_err(|_| GameKernelV7Error::Invalid)
}

fn local_battle_actor(
    state: &GameStateV6,
    seat: SeatId,
) -> Result<
    (
        &er_state::m7_state::BattleStateV5,
        er_types::battle_ids::PokemonId,
        er_types::battle_ids::FieldSlot,
    ),
    GameKernelV7Error,
> {
    let run = state
        .active_run
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let battle = run.battle.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let field = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Player
                && slot.occupant.is_some_and(|pokemon_id| {
                    run.party
                        .iter()
                        .any(|pokemon| pokemon.id == pokemon_id && pokemon.owner_seat == Some(seat))
                })
        })
        .ok_or(GameKernelV7Error::Invalid)?;
    Ok((
        battle,
        field.occupant.ok_or(GameKernelV7Error::Invalid)?,
        field.slot,
    ))
}

fn bootstrap_catalog(
    content: &PreparedGameContentV2,
    owner: SeatId,
    save_slots: Vec<String>,
    local_is_host: bool,
) -> Result<BootstrapCatalogV1, GameKernelV7Error> {
    if save_slots.is_empty() {
        return Err(GameKernelV7Error::Invalid);
    }
    let starters = content
        .bundle()
        .bootstrap
        .starters
        .iter()
        .enumerate()
        .map(|(index, starter)| {
            let identity = u64::try_from(index)
                .ok()
                .and_then(|value| value.checked_add(1))
                .and_then(|value| SafeU53::new(value).ok())
                .ok_or(GameKernelV7Error::Invalid)?;
            Ok(StarterSelectionV1 {
                pokemon_id: er_types::battle_ids::PokemonId::new(identity),
                species_id: starter.species_id.get(),
                form_index: starter.form_index,
                ability_index: starter.ability_index,
                cost: starter.cost,
                owner_seat: owner,
            })
        })
        .collect::<Result<Vec<_>, GameKernelV7Error>>()?;
    Ok(BootstrapCatalogV1 {
        modes: content
            .bundle()
            .bootstrap
            .modes
            .iter()
            .map(|mode| BootstrapModePolicyV1 {
                mode: mode.mode,
                challenge_selection: mode.challenge_selection,
                cooperative: mode.cooperative,
                supported: mode.supported,
            })
            .collect(),
        challenges: content
            .bundle()
            .bootstrap
            .choices
            .iter()
            .flat_map(|choice| {
                choice
                    .values
                    .iter()
                    .cloned()
                    .map(|value| (choice.id.clone(), value))
            })
            .collect(),
        starters,
        save_slots,
        automatic_coop_save_slot: None,
        maximum_starter_cost: content.bundle().bootstrap.maximum_starter_cost,
        maximum_starters: content.bundle().bootstrap.maximum_starters,
        local_is_host,
        developer_mode: false,
    })
}

fn execution_input(action: &GameActionV1) -> GameDomainExecutionInputV1 {
    match action {
        GameActionV1::Save {
            action:
                er_types::SaveActionV1::Write { .. }
                | er_types::SaveActionV1::Load { .. }
                | er_types::SaveActionV1::Delete { .. },
        } => GameDomainExecutionInputV1::SaveGeneration(safe_one()),
        _ => GameDomainExecutionInputV1::None,
    }
}

fn physical_button(key: &PhysicalKey) -> Option<GameButton> {
    match key {
        PhysicalKey::ArrowUp => Some(GameButton::Up),
        PhysicalKey::ArrowDown => Some(GameButton::Down),
        PhysicalKey::ArrowLeft => Some(GameButton::Left),
        PhysicalKey::ArrowRight => Some(GameButton::Right),
        PhysicalKey::Enter | PhysicalKey::Space => Some(GameButton::Action),
        PhysicalKey::Escape | PhysicalKey::Backspace => Some(GameButton::Cancel),
        _ => None,
    }
}

fn empty_input_router() -> InputRouterSnapshotV2 {
    InputRouterSnapshotV2 {
        focus: InputFocus::Game,
        pressed: Vec::new(),
        suppressed_printable_keys: Vec::new(),
        held_buttons: Vec::new(),
        locks: Vec::new(),
        repeats: Vec::new(),
        disposed: false,
    }
}

fn platform_request_id(effect: &GamePlatformEffectV2) -> PlatformRequestId {
    match effect {
        GamePlatformEffectV2::StorageRead { request, .. }
        | GamePlatformEffectV2::StorageWrite { request, .. }
        | GamePlatformEffectV2::StorageDelete { request, .. }
        | GamePlatformEffectV2::StorageList { request }
        | GamePlatformEffectV2::AssetRequest { request, .. }
        | GamePlatformEffectV2::AudioCue { request, .. }
        | GamePlatformEffectV2::Telemetry { request, .. }
        | GamePlatformEffectV2::ReproReady { request, .. } => *request,
    }
}

fn complete_control(revision: SafeU53) -> GameControlPlanV2 {
    GameControlPlanV2 {
        schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision,
        kind: er_types::GameControlKindV2::Complete,
        owner_seat: None,
        action_context: None,
        menu: None,
        actionable: false,
    }
}

fn next_menu_after(current: MenuInstanceId) -> Result<MenuInstanceId, GameKernelV7Error> {
    let next = current
        .get()
        .get()
        .checked_add(1)
        .ok_or(GameKernelV7Error::Invalid)?;
    SafeU53::new(next)
        .map(MenuInstanceId::new)
        .map_err(|_| GameKernelV7Error::Invalid)
}

fn next_menu_from_state(state: &GameStateV6) -> Result<MenuInstanceId, GameKernelV7Error> {
    match state
        .active_run
        .as_ref()
        .and_then(|run| run.control.menu.as_ref())
        .map(|menu| menu.instance_id)
    {
        Some(current) => next_menu_after(current),
        None => Ok(MenuInstanceId::new(safe_one())),
    }
}

fn increment_safe(value: SafeU53) -> Result<SafeU53, GameKernelV7Error> {
    let next = value
        .get()
        .checked_add(1)
        .ok_or(GameKernelV7Error::Invalid)?;
    SafeU53::new(next).map_err(|_| GameKernelV7Error::Invalid)
}

fn safe_one() -> SafeU53 {
    SafeU53::new(1).unwrap_or(SafeU53::MAX)
}

fn runtime_error(error: er_game::m9e_runtime_v6::GameRuntimeV6Error) -> GameKernelV7Error {
    GameKernelV7Error::Runtime(error.to_string())
}

fn internal_error(
    error: er_game::m9e_internal_event_v2::GameInternalEventQueueErrorV2,
) -> GameKernelV7Error {
    GameKernelV7Error::Internal(error.to_string())
}
