//! GameKernelV7: sole production owner for the direct M9-E runtime path.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_ai::authority_v2::AuthorityAiV2;
use er_ai::full_surface::{AiActionKindV1, AiActorViewV1, AiScoreContextV1, legal_actions_v1};
use er_canonical::{canonical_bytes, content_digest};
use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_game::m9e_internal_event_v2::{
    GAME_INTERNAL_TIMER_CONSEQUENCE_BUDGET_V2, GameInternalEventKindV2, GameInternalEventQueueV2,
    GameInternalEventV2,
};
use er_game::m9e_material_v6::{
    AppliedGameMaterialLedgerV1, AppliedMaterialRetentionV1, GameMaterialApplyOutcomeV6,
    GameMaterialV6, GamePlatformEffectV2, GamePresentationEffectV2,
    MAX_APPLIED_MATERIAL_RECORDS_V1,
};
use er_game::m9e_new_run_v6::{construct_natural_run_v6, expand_cooperative_topology_v6};
use er_game::m9e_runtime_v6::{
    GameActionDispatchContextV1, GameDomainExecutionInputV1, GameRuntimeSnapshotV6, GameRuntimeV6,
    InventoryUseEffectV1,
};
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapErrorV1, RunBootstrapMachineV1,
    RunBootstrapStageV1,
};
use er_protocol::snapshot::ProposalFingerprintSnapshotV2;
use er_protocol::{
    EndpointRole, ProtocolRuntimeSnapshotV2, ScheduledTimer, SchedulerCommand, SchedulerError,
};
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::ProfileStateV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommandProposalV1, CommandAdmissionSource, CommandFrontierStatus,
};
use er_types::battle_ids::MenuInstanceId;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::ui_menu::NavigationDirection;
use er_types::{
    BootstrapActionV1, ConnectionGeneration, GAME_ACTION_SCHEMA_VERSION_V1, GameActionContextV1,
    GameActionV1, GameButton, GameControlKindV2, GameControlPlanV2, GameMenuCancelV2,
    GameProposalV1, OperationId, PlatformRequestId, RunOutcome, SafeU53, SeatId,
    StarterSelectionV1, TerminalState, TimeClass, TimerId, TimerOwner, TransportState,
};
use thiserror::Error;

use crate::current_proposal_v7::{
    CurrentProposalMaterialReceiptV1, CurrentProposalOwnerSnapshotV1, MAX_CURRENT_RECEIPT_BYTES_V1,
    RetainedCurrentProposalV1, TerminalAbandonedCurrentProposalV1, current_bytes_hex_v1,
    decode_current_proposal_v1, json_bytes_sha256_v1, validate_current_pair_v1,
    validate_current_proposal_quiescence_v1,
};
use crate::snapshot::{
    HeldLogicalButtonSnapshotV2, InputButtonLockSnapshotV2, InputRepeatSnapshotV2,
    InputRouterSnapshotV2, KernelSchedulerSnapshotV2, PhysicalInputSourceV2,
    PressedPhysicalInputSnapshotV2,
};
use crate::snapshot_v7::{
    CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7, CoreGameKernelSnapshotV7,
    GameKernelLifecycleSnapshotV7, PendingPlatformRequestV2, PendingPresentationV3,
    PrivateBattleControlSnapshotV7, StorageFrontierSnapshotV1,
};

pub(crate) const NAVIGATION_REPEAT_INTERVAL_MS_V7: SafeU53 = match SafeU53::new(250) {
    Ok(value) => value,
    Err(_) => SafeU53::ZERO,
};

// Current V7 owns this policy across construction and restore. Historical
// GameRuntimeV6 callers retain their default hard-stop behavior and wire schema.
const MATERIAL_RETENTION_V7: AppliedMaterialRetentionV1 =
    AppliedMaterialRetentionV1::BoundedSuffix {
        maximum_records: MAX_APPLIED_MATERIAL_RECORDS_V1,
    };

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
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

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum KernelStorageResultV2 {
    Read { bytes: Option<Vec<u8>> },
    Written,
    Deleted,
    Slots { slots: Vec<String> },
    Failed { reason: String },
    Conflict { current_generation: SafeU53 },
    Uncertain { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum KernelPresentationOutcomeV2 {
    Settled,
    IntentionallySkipped,
    Failed { reason: String },
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
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

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
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
    private_battle_control: Option<PrivateBattleControlSnapshotV7>,
    current_proposal: Option<CurrentProposalOwnerSnapshotV1>,
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
    storage_frontiers: BTreeMap<String, SafeU53>,
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
    #[error("GameKernelV7 storage result failed: {0}")]
    Storage(String),
    #[error("GameKernelV7 timer allocation is exhausted")]
    TimerAllocationExhausted,
    #[error("GameKernelV7 timer {timer_id} has an unsupported purpose")]
    UnsupportedTimerPurpose { timer_id: TimerId },
    #[error(
        "GameKernelV7 timer consequence budget {limit} exceeded at {timer_id}, with {remaining_milliseconds:?} ms remaining"
    )]
    TimerBudgetExceeded {
        limit: usize,
        timer_id: TimerId,
        remaining_milliseconds: SafeU53,
    },
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
            private_battle_control: None,
            current_proposal: None,
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
            storage_frontiers: BTreeMap::new(),
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
        let runtime = GameRuntimeV6::new_with_retention(
            Some(state),
            content.clone(),
            next_authority_revision,
            MATERIAL_RETENTION_V7,
        )
        .map_err(runtime_error)?;
        let authority_ai =
            (role == GameKernelRoleV7::Authority).then(|| AuthorityAiV2::new(content.ai.clone()));
        let value = Self {
            lifecycle: GameKernelLifecycleV7::Active(runtime),
            private_battle_control: None,
            current_proposal: None,
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
            storage_frontiers: BTreeMap::new(),
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
                GameRuntimeV6::from_snapshot_with_retention(
                    GameRuntimeSnapshotV6 {
                        state: Some(state),
                        material_ledger: material_ledger.clone(),
                    },
                    content.clone(),
                    MATERIAL_RETENTION_V7,
                )
                .map_err(runtime_error)?,
            ),
            GameKernelLifecycleSnapshotV7::Terminal {
                state,
                control: _,
                terminal,
            } => GameKernelLifecycleV7::Terminal {
                runtime: GameRuntimeV6::from_snapshot_with_retention(
                    GameRuntimeSnapshotV6 {
                        state: Some(state),
                        material_ledger: material_ledger.clone(),
                    },
                    content.clone(),
                    MATERIAL_RETENTION_V7,
                )
                .map_err(runtime_error)?,
                terminal,
            },
        };
        let value = Self {
            lifecycle,
            private_battle_control: snapshot.private_battle_control,
            current_proposal: snapshot.current_proposal,
            content,
            local_seat,
            role,
            authority_ai,
            next_menu_instance_id: snapshot.next_menu_instance_id,
            input_router: snapshot.input_router,
            scheduler: snapshot.scheduler,
            protocol: snapshot.protocol,
            pending_presentations: snapshot
                .pending_presentations
                .into_iter()
                .map(|pending| (pending.event_id, pending))
                .collect(),
            pending_platform: snapshot
                .pending_platform
                .into_iter()
                .map(|pending| (pending.request_id, pending))
                .collect(),
            storage_frontiers: snapshot
                .storage_frontiers
                .into_iter()
                .map(|frontier| (frontier.slot, frontier.generation))
                .collect(),
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
            private_battle_control: self.private_battle_control.clone(),
            current_proposal: self.current_proposal.clone(),
            authority_ai: self.authority_ai.as_ref().map(AuthorityAiV2::snapshot),
            input_router: self.input_router.clone(),
            scheduler: self.scheduler.clone(),
            next_menu_instance_id: self.next_menu_instance_id,
            protocol: self.protocol.clone(),
            pending_presentations: self.pending_presentations.values().cloned().collect(),
            pending_platform: self.pending_platform.values().cloned().collect(),
            storage_frontiers: self
                .storage_frontiers
                .iter()
                .map(|(slot, generation)| StorageFrontierSnapshotV1 {
                    slot: slot.clone(),
                    generation: *generation,
                })
                .collect(),
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
                legal_switches: battle
                    .enemy_party
                    .iter()
                    .filter(|candidate| {
                        !candidate.fainted
                            && candidate.id != actor.id
                            && !battle
                                .field
                                .slots
                                .iter()
                                .any(|slot| slot.occupant == Some(candidate.id))
                    })
                    .map(|candidate| candidate.id)
                    .collect(),
            };
            let legal = legal_actions_v1(&actor_view);
            let contexts = legal
                .iter()
                .cloned()
                .map(|action| {
                    let target = action
                        .target
                        .and_then(|position| {
                            battle.field.slots.iter().find(|slot| {
                                slot.slot.side == er_types::battle_ids::BattleSide::Player
                                    && slot.slot.position == position
                            })
                        })
                        .and_then(|slot| slot.occupant)
                        .and_then(|pokemon| run.party.iter().find(|target| target.id == pokemon))
                        .or_else(|| run.party.iter().find(|pokemon| !pokemon.fainted))
                        .ok_or(GameKernelV7Error::Invalid)?;
                    let (effectiveness_percent, accuracy_percent) =
                        if let Some(move_id) = action.move_id {
                            let definition = self
                                .content
                                .battle
                                .move_definition(move_id)
                                .map_err(|_| GameKernelV7Error::Invalid)?;
                            let accuracy = match definition.accuracy {
                                er_types::battle_model::MoveAccuracy::AlwaysHits => 100,
                                er_types::battle_model::MoveAccuracy::Percent(value) => {
                                    u16::from(value)
                                }
                            };
                            (
                                type_effectiveness_percent(
                                    self.content.as_ref(),
                                    definition.move_type,
                                    target,
                                ),
                                accuracy,
                            )
                        } else {
                            (100, 100)
                        };
                    Ok((
                        action,
                        AiScoreContextV1 {
                            effectiveness_percent,
                            accuracy_percent,
                            target_hp: target.hp,
                            target_max_hp: target.max_hp,
                            ally_damage_penalty: 0,
                        },
                    ))
                })
                .collect::<Result<BTreeMap<_, _>, GameKernelV7Error>>()?;
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
                AiActionKindV1::Switch => {
                    let target = action.switch_target.ok_or(GameKernelV7Error::Invalid)?;
                    let index = battle
                        .enemy_party
                        .iter()
                        .position(|pokemon| pokemon.id == target && !pokemon.fainted)
                        .ok_or(GameKernelV7Error::Invalid)?;
                    er_types::battle_command::BattleCommand::switch(
                        actor.id,
                        er_types::battle_ids::PartyIndex::new(
                            u8::try_from(index).map_err(|_| GameKernelV7Error::Invalid)?,
                        )
                        .map_err(|_| GameKernelV7Error::Invalid)?,
                    )
                }
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
            let event = match event {
                RawInputEvent::GamepadDown { button } => {
                    let Some(code) = gamepad_key(button) else {
                        return Ok(GameKernelStepV7::default());
                    };
                    RawInputEvent::KeyDown {
                        code,
                        printable: false,
                        browser_repeat: false,
                        focus: InputFocus::Game,
                    }
                }
                RawInputEvent::GamepadUp { button } => {
                    let Some(code) = gamepad_key(button) else {
                        return Ok(GameKernelStepV7::default());
                    };
                    RawInputEvent::KeyUp { code }
                }
                other => other,
            };
            return self.bootstrap_input(event);
        }
        if matches!(self.lifecycle, GameKernelLifecycleV7::Terminal { .. }) {
            return Ok(GameKernelStepV7::default());
        }
        // Every proposal-producing press includes physical/held/lock ownership.
        // Stage ordinary controls too, so a late proposal or replay rejection
        // cannot leave input state behind on direct kernel calls.
        let mut candidate = self.clone();
        let step = candidate.active_input(event)?;
        candidate.retire_obsolete_repeats()?;
        candidate.validate()?;
        *self = candidate;
        Ok(step)
    }
    pub fn advance_time(
        &mut self,
        milliseconds: SafeU53,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let mut candidate = self.clone();
        let step = candidate.advance_time_transaction(milliseconds)?;
        candidate.validate()?;
        *self = candidate;
        Ok(step)
    }

    fn advance_time_transaction(
        &mut self,
        milliseconds: SafeU53,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        self.retire_obsolete_repeats()?;
        let mut remaining = milliseconds;
        let mut step = GameKernelStepV7::default();
        loop {
            let next = self
                .scheduler
                .timers
                .iter()
                .filter(|timer| !timer_paused(&self.scheduler, &timer.registration))
                .min_by_key(|timer| {
                    (
                        timer.remaining_active_ms,
                        timer.registration.endpoint,
                        timer.registration.timer_id,
                    )
                })
                .cloned();
            let Some(next) = next.filter(|timer| timer.remaining_active_ms <= remaining) else {
                self.elapse_active_time(remaining)?;
                break;
            };
            if step.internal_events.len() >= GAME_INTERNAL_TIMER_CONSEQUENCE_BUDGET_V2 {
                return Err(GameKernelV7Error::TimerBudgetExceeded {
                    limit: GAME_INTERNAL_TIMER_CONSEQUENCE_BUDGET_V2,
                    timer_id: next.registration.timer_id,
                    remaining_milliseconds: remaining,
                });
            }
            self.elapse_active_time(next.remaining_active_ms)?;
            remaining = SafeU53::new(remaining.get() - next.remaining_active_ms.get())
                .map_err(|_| GameKernelV7Error::Invalid)?;
            let consequence = self.fire_navigation_timer(next.registration)?;
            step.internal_events
                .push(GameInternalEventKindV2::TimerFired);
            step.effects.extend(consequence.effects);
        }
        if milliseconds != SafeU53::ZERO {
            self.advance_replay_sequence()?;
        }
        Ok(step)
    }

    fn elapse_active_time(&mut self, milliseconds: SafeU53) -> Result<(), GameKernelV7Error> {
        let pauses = &self.scheduler.pauses;
        for timer in &mut self.scheduler.timers {
            if pauses.iter().any(|pause| {
                pause.endpoint == timer.registration.endpoint
                    && pause.time_class == timer.registration.time_class
                    && !pause.reasons.is_empty()
            }) {
                continue;
            }
            timer.remaining_active_ms = SafeU53::new(
                timer
                    .remaining_active_ms
                    .get()
                    .checked_sub(milliseconds.get())
                    .ok_or(GameKernelV7Error::Invalid)?,
            )
            .map_err(|_| GameKernelV7Error::Invalid)?;
        }
        Ok(())
    }

    fn fire_navigation_timer(
        &mut self,
        registration: ScheduledTimer,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let index = self
            .input_router
            .repeats
            .iter()
            .position(|repeat| repeat.timer_id == registration.timer_id)
            .ok_or(GameKernelV7Error::UnsupportedTimerPurpose {
                timer_id: registration.timer_id,
            })?;
        let repeat = self.input_router.repeats[index].clone();
        if registration.endpoint != repeat.seat
            || registration.owner != TimerOwner::input_repeat(repeat.button)
            || registration.time_class != TimeClass::HumanInput
            || registration.delay_ms != NAVIGATION_REPEAT_INTERVAL_MS_V7
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut scheduler = self
            .scheduler
            .clone()
            .into_scheduler()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        scheduler
            .fired(registration.timer_id)
            .map_err(timer_error)?;
        let SchedulerCommand::Schedule { timer } = scheduler
            .schedule(
                repeat.seat,
                TimerOwner::input_repeat(repeat.button),
                NAVIGATION_REPEAT_INTERVAL_MS_V7,
                TimeClass::HumanInput,
            )
            .map_err(timer_error)?
        else {
            return Err(GameKernelV7Error::Invalid);
        };
        self.scheduler = KernelSchedulerSnapshotV2::from_scheduler(&scheduler)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        self.input_router.repeats[index].timer_id = timer.timer_id;
        self.handle_button(repeat.button)
    }

    fn validate_current_network_pair(
        &self,
        generation: ConnectionGeneration,
    ) -> Result<(), GameKernelV7Error> {
        let protocol = self.protocol.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        let role = match self.role {
            GameKernelRoleV7::Authority => EndpointRole::Authority,
            GameKernelRoleV7::Replica => EndpointRole::Replica,
        };
        validate_current_pair_v1(protocol, self.local_seat, role, true)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        validate_current_proposal_quiescence_v1(Some(protocol), &self.scheduler)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        if generation != protocol.frame_context.context.connection_generation {
            return Err(GameKernelV7Error::Invalid);
        }
        Ok(())
    }

    pub fn ingest_network_frame(
        &mut self,
        generation: ConnectionGeneration,
        bytes: &[u8],
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        self.validate_current_network_pair(generation)?;
        if bytes.is_empty() || bytes.len() > MAX_CURRENT_RECEIPT_BYTES_V1 {
            return Err(GameKernelV7Error::Invalid);
        }
        match self.role {
            GameKernelRoleV7::Authority => {
                let envelope =
                    decode_current_proposal_v1(bytes).map_err(|_| GameKernelV7Error::Invalid)?;
                if envelope.connection_generation != generation {
                    return Err(GameKernelV7Error::Invalid);
                }
                let authority_context = self
                    .protocol
                    .as_ref()
                    .ok_or(GameKernelV7Error::Invalid)?
                    .frame_context
                    .context
                    .clone();
                let mut candidate = self.clone();
                // The compatibility API remains raw. Only this validated network
                // transaction captures actual admitted input and committed output.
                let mut step = candidate.admit_game_proposal(bytes)?;
                if step.effects.is_empty() {
                    return Ok(step); // Historical admission has no retained reply.
                }
                let mut matched = 0;
                for effect in &mut step.effects {
                    if let GameKernelEffectV7::AuthorityMaterial {
                        operation_id,
                        bytes: material,
                    } = effect
                    {
                        if operation_id != &envelope.proposal.context.operation_id {
                            return Err(GameKernelV7Error::Invalid);
                        }
                        let receipt = CurrentProposalMaterialReceiptV1::from_admission(
                            bytes,
                            material,
                            authority_context.clone(),
                        )
                        .map_err(|_| GameKernelV7Error::Invalid)?;
                        let decoded = receipt.evidence().map_err(|_| GameKernelV7Error::Invalid)?;
                        let transition = decoded.material.transition();
                        let snapshot = candidate.snapshot()?;
                        if !snapshot.material_ledger.records.iter().any(|record| {
                            &record.operation_id == operation_id
                                && record.material_fingerprint == receipt.material_fingerprint
                                && record.authority_revision == transition.authority_revision
                                && record.after_digest == transition.after_digest
                        }) || &transition.content_identity != self.content.identity()
                        {
                            return Err(GameKernelV7Error::Invalid);
                        }
                        *material = receipt
                            .canonical_bytes()
                            .map_err(|_| GameKernelV7Error::Invalid)?;
                        matched += 1;
                    }
                }
                if matched != 1 {
                    return Err(GameKernelV7Error::Invalid);
                }
                candidate.validate()?;
                *self = candidate;
                Ok(step)
            }
            GameKernelRoleV7::Replica => {
                if let Ok(receipt) = CurrentProposalMaterialReceiptV1::decode(bytes) {
                    self.apply_current_receipt(receipt)
                } else {
                    self.apply_authority_material(bytes)
                }
            }
        }
    }

    fn apply_current_receipt(
        &mut self,
        receipt: CurrentProposalMaterialReceiptV1,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let evidence = receipt.evidence().map_err(|_| GameKernelV7Error::Invalid)?;
        let protocol = self.protocol.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        let transition = evidence.material.transition();
        if protocol.peer_identity.peer.as_ref() != Some(&receipt.authority_context)
            || evidence.proposal.sender_seat != self.local_seat
            || &transition.content_identity != self.content.identity()
        {
            return Err(GameKernelV7Error::Invalid);
        }
        transition
            .after_state
            .validate_with(self.content.as_ref())
            .map_err(|_| GameKernelV7Error::Invalid)?;
        let mut settle = false;
        if let Some(CurrentProposalOwnerSnapshotV1::Pending { retained }) = &self.current_proposal
            && retained.proposal_hex == receipt.proposal_hex
        {
            if retained.proposal_digest != receipt.proposal_digest
                || retained.authority_peer_context != receipt.authority_context
                || retained.publication_content_identity != transition.content_identity
                || retained.publication_before_digest != transition.before_digest
                || retained.publication_next_authority_revision != transition.authority_revision
                || transition
                    .after_state
                    .active_run
                    .as_ref()
                    .map(|run| run.run_id)
                    != Some(retained.publication_game_run_id)
            {
                return Err(GameKernelV7Error::Invalid);
            }
            settle = true;
        }
        self.apply_current_material(&evidence.material_bytes, settle, true)
    }
    pub fn transport_changed(
        &mut self,
        generation: ConnectionGeneration,
        connected: bool,
    ) -> Result<(), GameKernelV7Error> {
        let mut candidate = self.clone();
        candidate.transport_changed_transaction(generation, connected)?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    fn transport_changed_transaction(
        &mut self,
        generation: ConnectionGeneration,
        connected: bool,
    ) -> Result<(), GameKernelV7Error> {
        let protocol = self.protocol.as_mut().ok_or(GameKernelV7Error::Invalid)?;
        // Generation-one current pairs cannot enter an unsupported rebind.
        // Other historical protocol fixtures retain their existing staging API.
        if (self.current_proposal.is_some()
            || validate_current_pair_v1(protocol, self.local_seat, protocol.role, false).is_ok())
            && generation.get() != safe_one()
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let connection = protocol
            .connections
            .first_mut()
            .ok_or(GameKernelV7Error::Invalid)?;
        if generation < connection.generation {
            return Err(GameKernelV7Error::Invalid);
        }
        if generation == connection.generation {
            connection.state = if connected {
                TransportState::Connected
            } else {
                TransportState::Disconnected
            };
        } else {
            if protocol
                .staged_rebinds
                .iter()
                .any(|staged| staged.peer_seat == connection.peer_seat)
            {
                return Err(GameKernelV7Error::Invalid);
            }
            protocol
                .staged_rebinds
                .push(er_protocol::snapshot::StagedPeerRebindSnapshotV2 {
                    peer_seat: connection.peer_seat,
                    generation,
                });
            protocol
                .staged_rebinds
                .sort_by_key(|staged| staged.peer_seat);
            connection.state = TransportState::Connecting;
        }
        // A new generation is only staged above; Connecting cannot resume
        // connected-time work. Remove only the pause reason owned by this API.
        let effective_connected = connection.state == TransportState::Connected;
        let mut scheduler = self
            .scheduler
            .clone()
            .into_scheduler()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        let reason = "transport-disconnected";
        let _ = if effective_connected {
            scheduler.resume_class(self.local_seat, TimeClass::Connected, reason)
        } else {
            scheduler.pause_class(self.local_seat, TimeClass::Connected, reason)
        }
        .map_err(|_| GameKernelV7Error::Invalid)?;
        self.scheduler = KernelSchedulerSnapshotV2::from_scheduler(&scheduler)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        protocol
            .validate()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        self.scheduler
            .validate()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        self.advance_replay_sequence()
    }

    pub fn apply_authority_material(
        &mut self,
        bytes: &[u8],
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        self.apply_current_material(bytes, false, false)
    }

    fn apply_current_material(
        &mut self,
        bytes: &[u8],
        settle: bool,
        has_receipt: bool,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let was_terminal = matches!(self.lifecycle, GameKernelLifecycleV7::Terminal { .. });
        if was_terminal && !has_receipt {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut candidate = self.clone();
        candidate.restore_canonical_battle_control()?;
        let runtime = match &mut candidate.lifecycle {
            GameKernelLifecycleV7::Active(runtime)
            | GameKernelLifecycleV7::Terminal { runtime, .. } => runtime,
            _ => return Err(GameKernelV7Error::Invalid),
        };
        let outcome = runtime.apply_material_bytes(bytes).map_err(runtime_error)?;
        if outcome == GameMaterialApplyOutcomeV6::DuplicateApplied {
            if settle {
                // Discard the canonical-control validation candidate. Receipt
                // retirement starts from ORIGINAL private/UI/allocator state.
                let mut retired = self.clone();
                retired.current_proposal = None;
                retired.advance_replay_sequence()?;
                retired.validate()?;
                *self = retired;
            }
            return Ok(GameKernelStepV7::default());
        }
        if was_terminal {
            return Err(GameKernelV7Error::Invalid);
        }
        if settle {
            candidate.current_proposal = None;
        }
        candidate.private_battle_control = None;
        let material = GameMaterialV6::decode(bytes)
            .map_err(|error| GameKernelV7Error::Runtime(error.to_string()))?;
        candidate.advance_replay_sequence()?;
        candidate.synchronize_menu_allocator()?;
        let mut step = GameKernelStepV7 {
            effects: material
                .transition()
                .presentation
                .iter()
                .cloned()
                .map(GameKernelEffectV7::Presentation)
                .collect(),
            internal_events: Vec::new(),
        };
        // Replicas own presentation only. Never replay the material's platform
        // or storage effects merely because a receipt accompanies its bytes.
        candidate.install_step_effects(&step.effects)?;
        if let Some(control) = candidate.current_control().cloned() {
            step.effects.push(GameKernelEffectV7::UiChanged(control));
        }
        candidate.synchronize_terminal(&mut step)?;
        candidate.validate()?;
        *self = candidate;
        Ok(step)
    }
    pub fn settle_presentation(
        &mut self,
        event_id: er_types::PresentationEventId,
    ) -> Result<(), GameKernelV7Error> {
        self.settle_presentation_outcome(event_id, KernelPresentationOutcomeV2::Settled)
    }

    pub fn settle_presentation_outcome(
        &mut self,
        event_id: er_types::PresentationEventId,
        outcome: KernelPresentationOutcomeV2,
    ) -> Result<(), GameKernelV7Error> {
        let pending = self
            .pending_presentations
            .get(&event_id)
            .ok_or(GameKernelV7Error::Invalid)?;
        match outcome {
            KernelPresentationOutcomeV2::Settled => {}
            KernelPresentationOutcomeV2::IntentionallySkipped
                if pending.skip == er_types::battle_ui::PresentationSkipPolicy::Allowed => {}
            KernelPresentationOutcomeV2::Failed { reason } if !reason.is_empty() => {
                return Err(GameKernelV7Error::Runtime(format!(
                    "renderer recovery required: {reason}"
                )));
            }
            _ => return Err(GameKernelV7Error::Invalid),
        }
        // Preflight the sole remaining fallible step before retiring ownership.
        let next_replay_sequence = increment_safe(self.replay_sequence)?;
        self.pending_presentations.remove(&event_id);
        self.replay_sequence = next_replay_sequence;
        Ok(())
    }

    pub fn settle_platform_request(
        &mut self,
        request_id: PlatformRequestId,
    ) -> Result<(), GameKernelV7Error> {
        self.pending_platform
            .remove(&request_id)
            .map(|_| ())
            .ok_or(GameKernelV7Error::Invalid)
    }

    pub fn apply_storage_result(
        &mut self,
        request_id: PlatformRequestId,
        result: KernelStorageResultV2,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let mut candidate = self.clone();
        let step = candidate.apply_storage_result_transaction(request_id, result)?;
        candidate.validate()?;
        *self = candidate;
        Ok(step)
    }

    fn apply_storage_result_transaction(
        &mut self,
        request_id: PlatformRequestId,
        result: KernelStorageResultV2,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let pending = self
            .pending_platform
            .get(&request_id)
            .cloned()
            .ok_or(GameKernelV7Error::Invalid)?;
        let mut step = GameKernelStepV7::default();
        match (&pending.effect, result) {
            (
                GamePlatformEffectV2::StorageWrite {
                    slot, generation, ..
                },
                KernelStorageResultV2::Written,
            ) => {
                let expected = self
                    .storage_frontiers
                    .get(slot)
                    .copied()
                    .map(increment_safe)
                    .transpose()?
                    .unwrap_or_else(safe_one);
                if *generation != expected {
                    return Err(GameKernelV7Error::Storage(
                        "write generation differs from the CAS frontier".to_owned(),
                    ));
                }
                self.storage_frontiers.insert(slot.clone(), *generation);
            }
            (
                GamePlatformEffectV2::StorageRead { slot, .. },
                KernelStorageResultV2::Read { bytes: Some(bytes) },
            ) => {
                let save = GameSaveV2::decode(&bytes)
                    .map_err(|error| GameKernelV7Error::Storage(error.to_string()))?;
                if &save.content_identity != self.content.identity() {
                    return Err(GameKernelV7Error::Storage(
                        "loaded save content identity differs".to_owned(),
                    ));
                }
                let current_revision = self.active_runtime()?.next_authority_revision();
                let control_revision = save
                    .state
                    .active_run
                    .as_ref()
                    .map(|run| run.control.revision)
                    .unwrap_or(SafeU53::ZERO);
                let next_revision = current_revision.max(increment_safe(control_revision)?);
                let runtime = GameRuntimeV6::new_with_retention(
                    Some(save.state),
                    self.content.clone(),
                    next_revision,
                    MATERIAL_RETENTION_V7,
                )
                .map_err(runtime_error)?;
                self.lifecycle = GameKernelLifecycleV7::Active(runtime);
                self.private_battle_control = None;
                self.clear_input()?;
                self.storage_frontiers.insert(slot.clone(), save.generation);
                self.synchronize_menu_allocator()?;
                if let Some(control) = self.current_control().cloned() {
                    step.effects.push(GameKernelEffectV7::UiChanged(control));
                }
            }
            (
                GamePlatformEffectV2::StorageRead { .. },
                KernelStorageResultV2::Read { bytes: None },
            ) => {}
            (GamePlatformEffectV2::StorageDelete { slot, .. }, KernelStorageResultV2::Deleted) => {
                self.storage_frontiers.remove(slot);
            }
            (GamePlatformEffectV2::StorageList { .. }, KernelStorageResultV2::Slots { slots })
                if slots.windows(2).all(|pair| pair[0] < pair[1])
                    && slots.iter().all(|slot| !slot.is_empty()) => {}
            (
                GamePlatformEffectV2::StorageWrite { slot, .. },
                KernelStorageResultV2::Conflict { current_generation },
            ) => {
                return Err(GameKernelV7Error::Storage(format!(
                    "storage write conflict for {slot} at generation {}",
                    current_generation.get()
                )));
            }
            (
                GamePlatformEffectV2::StorageWrite { .. },
                KernelStorageResultV2::Uncertain { reason },
            )
            | (_, KernelStorageResultV2::Failed { reason }) => {
                return Err(GameKernelV7Error::Storage(reason));
            }
            _ => {
                return Err(GameKernelV7Error::Storage(
                    "storage outcome does not match pending request".to_owned(),
                ));
            }
        }
        self.pending_platform.remove(&request_id);
        self.advance_replay_sequence()?;
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
        let protocol = self.protocol.clone().ok_or(GameKernelV7Error::Invalid)?;
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
        if !proposal_is_rooted_in_control(
            self.canonical_battle_control(),
            envelope.sender_seat,
            &envelope.proposal,
        ) && !battle_proposal_is_rooted_in_control(
            self.state(),
            self.canonical_battle_control(),
            envelope.sender_seat,
            &envelope.proposal,
        ) {
            return Err(GameKernelV7Error::Invalid);
        }
        let capacity =
            usize::try_from(admission.capacity.get()).map_err(|_| GameKernelV7Error::Invalid)?;
        if admission.disposed || admission.fingerprints.len() >= capacity {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut staged = self.clone();
        let step = staged.apply_admitted_game_proposal(envelope, protocol, fingerprint)?;
        staged.validate()?;
        *self = staged;
        Ok(step)
    }

    fn apply_admitted_game_proposal(
        &mut self,
        envelope: GameProposalEnvelopeV2,
        protocol: ProtocolRuntimeSnapshotV2,
        fingerprint: String,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let action_context = envelope.proposal.context;
        let operation_id = action_context.operation_id.clone();
        let action = envelope.proposal.action;
        if matches!(action, GameActionV1::Battle { .. }) {
            let step = self.collect_battle_action(
                action,
                action_context,
                envelope.sender_seat,
                CommandAdmissionSource::AuthorityRemoteProposal,
            )?;
            remember_proposal_fingerprint(
                self.protocol.as_mut().ok_or(GameKernelV7Error::Invalid)?,
                operation_id,
                fingerprint,
            )?;
            return Ok(step);
        }
        let context = GameActionDispatchContextV1 {
            action: action_context,
            input: self.execution_input(&action)?,
            authority: true,
        };
        let mut staged_runtime = self.active_runtime()?.clone();
        if let Some(owner) = &self.private_battle_control {
            staged_runtime
                .install_control(owner.canonical_control.clone())
                .map_err(runtime_error)?;
        }
        let step = execute_action_transaction(&mut staged_runtime, action, context)?;
        let mut staged_protocol = protocol;
        remember_proposal_fingerprint(&mut staged_protocol, operation_id, fingerprint)?;
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(staged_runtime);
        self.private_battle_control = None;
        self.synchronize_menu_allocator()?;
        self.protocol = Some(staged_protocol);
        self.advance_replay_sequence()?;
        let mut step = step;
        self.synchronize_terminal(&mut step)?;
        Ok(step)
    }
    pub fn validate(&self) -> Result<(), GameKernelV7Error> {
        if let Some(owner) = &self.current_proposal
            && (self.role != GameKernelRoleV7::Replica
                || owner.retained().publication_context.sender_seat_id != self.local_seat)
        {
            return Err(GameKernelV7Error::Invalid);
        }
        if self
            .private_battle_control
            .as_ref()
            .is_some_and(|owner| owner.owner_seat != self.local_seat)
        {
            return Err(GameKernelV7Error::Invalid);
        }
        if self
            .input_router
            .repeats
            .iter()
            .any(|repeat| repeat.seat != self.local_seat)
        {
            return Err(GameKernelV7Error::Invalid);
        }
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
        let cooperative = candidate
            .active_run
            .as_ref()
            .and_then(|run| self.content.world.mode(run.mode))
            .is_some_and(|mode| mode.cooperative);
        if cooperative
            && let Some(partner) = self
                .protocol
                .as_ref()
                .and_then(|protocol| protocol.connections.first())
                .map(|connection| connection.peer_seat)
        {
            expand_cooperative_topology_v6(&mut candidate, self.content.as_ref(), partner)
                .map_err(|error| GameKernelV7Error::Bootstrap(error.to_string()))?;
        }
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
        let mut runtime = GameRuntimeV6::new_with_retention(
            None,
            self.content.clone(),
            safe_one(),
            MATERIAL_RETENTION_V7,
        )
        .map_err(runtime_error)?;
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
        self.synchronize_menu_allocator()?;
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
                let presentation_blocked = self.pending_presentations.values().any(|pending| {
                    pending.blocking
                        == er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
                });
                let accepted = !presentation_blocked
                    && self.input_router.focus == InputFocus::Game
                    && !self.input_router.locks.iter().any(|lock| {
                        lock.seat == self.local_seat
                            && lock.button == button
                            && Some(lock.menu_instance_id) == menu_instance
                    })
                    && self
                        .current_control()
                        .is_some_and(|control| control.actionable && menu_instance.is_some());
                if accepted {
                    self.register_navigation_repeat(
                        button,
                        PhysicalInputSourceV2::Keyboard(code.clone()),
                        menu_instance.ok_or(GameKernelV7Error::Invalid)?,
                    )?;
                }
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
                self.cancel_source_repeats(&source)?;
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
                self.clear_input()?;
                Ok(GameKernelStepV7::default())
            }
            RawInputEvent::WindowFocused | RawInputEvent::FocusChanged(InputFocus::Game) => {
                self.input_router.focus = InputFocus::Game;
                Ok(GameKernelStepV7::default())
            }
            RawInputEvent::GamepadDown { button } => self.active_gamepad_down(button),
            RawInputEvent::GamepadUp { button } => self.active_gamepad_up(button),
        }
    }

    fn active_gamepad_down(
        &mut self,
        button_index: u16,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let source = PhysicalInputSourceV2::Gamepad(button_index);
        if self
            .input_router
            .pressed
            .iter()
            .any(|pressed| pressed.seat == self.local_seat && pressed.source == source)
        {
            return Ok(GameKernelStepV7::default());
        }
        let Some(button) = gamepad_button(button_index) else {
            self.input_router
                .pressed
                .push(PressedPhysicalInputSnapshotV2 {
                    seat: self.local_seat,
                    source,
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
        let presentation_blocked = self.pending_presentations.values().any(|pending| {
            pending.blocking == er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
        });
        let accepted = !presentation_blocked
            && self.input_router.focus == InputFocus::Game
            && !self.input_router.locks.iter().any(|lock| {
                lock.seat == self.local_seat
                    && lock.button == button
                    && Some(lock.menu_instance_id) == menu_instance
            })
            && self
                .current_control()
                .is_some_and(|control| control.actionable && menu_instance.is_some());
        if accepted {
            self.register_navigation_repeat(
                button,
                source.clone(),
                menu_instance.ok_or(GameKernelV7Error::Invalid)?,
            )?;
        }
        self.input_router
            .pressed
            .push(PressedPhysicalInputSnapshotV2 {
                seat: self.local_seat,
                source: source.clone(),
                logical_button: accepted.then_some(button),
                printable: false,
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
                    source,
                    menu_instance_id: instance,
                });
            self.input_router.locks.push(InputButtonLockSnapshotV2 {
                seat: self.local_seat,
                button,
                menu_instance_id: instance,
            });
        }
        self.sort_input();
        if accepted {
            self.handle_button(button)
        } else {
            Ok(GameKernelStepV7::default())
        }
    }

    fn active_gamepad_up(
        &mut self,
        button_index: u16,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let source = PhysicalInputSourceV2::Gamepad(button_index);
        self.cancel_source_repeats(&source)?;
        self.input_router
            .pressed
            .retain(|pressed| !(pressed.seat == self.local_seat && pressed.source == source));
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
                self.retain_canonical_battle_control()?;
                self.active_runtime_mut()?
                    .navigate_control(direction)
                    .map_err(runtime_error)?;
                let control = self
                    .current_control()
                    .cloned()
                    .ok_or(GameKernelV7Error::Invalid)?;
                if control.kind == GameControlKindV2::BattleCommand
                    && let Some(owner) = &mut self.private_battle_control
                {
                    owner.return_control = control.clone();
                }
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
        if button == GameButton::Cancel
            && self
                .current_control()
                .is_some_and(|control| is_private_battle_leaf(control.kind))
        {
            let control = self
                .private_battle_control
                .as_ref()
                .ok_or(GameKernelV7Error::Invalid)?
                .return_control
                .clone();
            self.active_runtime_mut()?
                .install_control(control.clone())
                .map_err(runtime_error)?;
            return Ok(GameKernelStepV7 {
                effects: vec![GameKernelEffectV7::UiChanged(control)],
                internal_events: Vec::new(),
            });
        }
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
                self.retain_canonical_battle_control()?;
                let instance = self.allocate_menu_instance()?;
                let revision = self.active_runtime()?.next_authority_revision();
                let mut control = move_select_control(
                    self.state().ok_or(GameKernelV7Error::Invalid)?,
                    self.local_seat,
                    instance,
                    revision,
                )?;
                control
                    .action_context
                    .as_mut()
                    .ok_or(GameKernelV7Error::Invalid)?
                    .authority_seat = action_context.authority_seat;
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
                self.retain_canonical_battle_control()?;
                let instance = self.allocate_menu_instance()?;
                let revision = self.active_runtime()?.next_authority_revision();
                let mut control = switch_select_control(
                    self.state().ok_or(GameKernelV7Error::Invalid)?,
                    self.local_seat,
                    instance,
                    revision,
                )?;
                control
                    .action_context
                    .as_mut()
                    .ok_or(GameKernelV7Error::Invalid)?
                    .authority_seat = action_context.authority_seat;
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
            self.validate_current_network_pair(connection_generation)?;
            if !proposal_is_rooted_in_control(
                self.canonical_battle_control(),
                self.local_seat,
                &envelope.proposal,
            ) && !battle_proposal_is_rooted_in_control(
                self.state(),
                self.canonical_battle_control(),
                self.local_seat,
                &envelope.proposal,
            ) {
                return Err(GameKernelV7Error::Invalid);
            }
            let bytes = canonical_bytes(&envelope).map_err(|_| GameKernelV7Error::Invalid)?;
            decode_current_proposal_v1(&bytes).map_err(|_| GameKernelV7Error::Invalid)?;
            let proposal_hex = current_bytes_hex_v1(&bytes);
            if let Some(owner) = &self.current_proposal {
                if !matches!(owner, CurrentProposalOwnerSnapshotV1::Pending { retained }
                    if retained.proposal_hex == proposal_hex)
                {
                    return Err(GameKernelV7Error::Invalid);
                }
            } else {
                let mut canonical_state =
                    self.state().cloned().ok_or(GameKernelV7Error::Invalid)?;
                if let Some(private) = &self.private_battle_control {
                    canonical_state
                        .active_run
                        .as_mut()
                        .ok_or(GameKernelV7Error::Invalid)?
                        .control = private.canonical_control.clone();
                }
                let publication_before_digest =
                    er_game::m9e_material_v6::game_state_digest(&canonical_state)
                        .map_err(|_| GameKernelV7Error::Invalid)?;
                let publication_game_run_id = canonical_state
                    .active_run
                    .as_ref()
                    .ok_or(GameKernelV7Error::Invalid)?
                    .run_id;
                let publication_next_authority_revision = self
                    .active_runtime()?
                    .snapshot()
                    .material_ledger
                    .next_authority_revision;
                self.advance_replay_sequence()?;
                let protocol = self.protocol.as_ref().ok_or(GameKernelV7Error::Invalid)?;
                self.current_proposal = Some(CurrentProposalOwnerSnapshotV1::Pending {
                    retained: Box::new(RetainedCurrentProposalV1 {
                        schema_version: 1,
                        proposal_hex,
                        proposal_digest: json_bytes_sha256_v1(&bytes)
                            .map_err(|_| GameKernelV7Error::Invalid)?,
                        publication_context: protocol.frame_context.context.clone(),
                        authority_peer_context: protocol
                            .peer_identity
                            .peer
                            .clone()
                            .ok_or(GameKernelV7Error::Invalid)?,
                        publication_content_identity: self.content.identity().clone(),
                        publication_game_run_id,
                        publication_before_digest,
                        publication_next_authority_revision,
                        publication_menu_highwater: self.next_menu_instance_id,
                        publication_replay_sequence: self.replay_sequence,
                    }),
                });
            }
            return Ok(GameKernelStepV7 {
                effects: vec![GameKernelEffectV7::ProposalReady {
                    operation_id: action_context.operation_id,
                    bytes,
                }],
                internal_events: Vec::new(),
            });
        }
        let input = self.execution_input(&action)?;
        let context = GameActionDispatchContextV1 {
            action: action_context,
            input,
            authority: true,
        };
        let mut staged = self.active_runtime()?.clone();
        if let Some(owner) = &self.private_battle_control {
            staged
                .install_control(owner.canonical_control.clone())
                .map_err(runtime_error)?;
        }
        let step = execute_action_transaction(&mut staged, action, context)?;
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(staged);
        self.private_battle_control = None;
        self.synchronize_menu_allocator()?;
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
        self.collect_battle_action(
            action,
            action_context,
            self.local_seat,
            CommandAdmissionSource::AuthorityLocalInternal,
        )
    }

    fn collect_battle_action(
        &mut self,
        action: GameActionV1,
        action_context: GameActionContextV1,
        command_seat: SeatId,
        source: CommandAdmissionSource,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let state = self.state().cloned().ok_or(GameKernelV7Error::Invalid)?;
        let (battle, actor, field) = local_battle_actor(&state, command_seat)?;
        let run = state
            .active_run
            .as_ref()
            .ok_or(GameKernelV7Error::Invalid)?;
        let menu = run
            .control
            .menu
            .as_ref()
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
        let proposal = BattleCommandProposalV1::new(
            action_context.operation_id.clone(),
            battle.battle_id,
            battle.wave,
            battle.turn,
            command_seat,
            actor,
            field,
            command,
            menu.instance_id,
            menu.control_id.clone(),
        )
        .map_err(|_| GameKernelV7Error::Invalid)?;
        if battle.command_state.frontier.iter().any(|entry| {
            entry.operation_id == proposal.operation_id
                || entry.field_slot == proposal.field_slot
                || entry.actor == proposal.actor
        }) {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut required = battle
            .field
            .slots
            .iter()
            .filter(|slot| slot.slot.side == er_types::battle_ids::BattleSide::Player)
            .filter_map(|slot| {
                let actor = slot.occupant?;
                let owner = run
                    .party
                    .iter()
                    .find(|pokemon| pokemon.id == actor && !pokemon.fainted)?
                    .owner_seat?;
                Some((slot.slot, owner))
            })
            .collect::<Vec<_>>();
        required.sort_by_key(|(slot, _)| *slot);
        let mut entries = battle
            .command_state
            .frontier
            .iter()
            .filter_map(|entry| match &entry.status {
                CommandFrontierStatus::Retained { command, .. }
                | CommandFrontierStatus::Admitted { command, .. } => Some(command.clone()),
                CommandFrontierStatus::Pending => None,
            })
            .collect::<Vec<_>>();
        entries.push(AcceptedBattleCommand::human(proposal.clone()));
        let human_complete = required.iter().all(|(_, seat)| {
            entries
                .iter()
                .any(|entry| accepted_command_owner(entry) == Some(*seat))
        });
        let input = if human_complete {
            entries.extend(self.prepare_authority_ai_commands()?);
            entries.sort_by_key(|entry| entry.field_slot());
            let commands = er_types::battle_command::CommandSet::new(entries)
                .map_err(|_| GameKernelV7Error::Invalid)?;
            GameDomainExecutionInputV1::BattleTurn {
                commands,
                authority: er_battle::m7_resolver::TurnAuthorityContextV1 {
                    authority_seat: action_context.authority_seat,
                    revision: action_context.authority_revision,
                },
            }
        } else {
            let next_owner = required
                .iter()
                .map(|(_, seat)| *seat)
                .find(|seat| {
                    !entries
                        .iter()
                        .any(|entry| accepted_command_owner(entry) == Some(*seat))
                })
                .ok_or(GameKernelV7Error::Invalid)?;
            GameDomainExecutionInputV1::BattleCommandRetention {
                proposal,
                source,
                next_owner,
            }
        };
        let mut canonical_state = state;
        if let Some(owner) = &self.private_battle_control {
            canonical_state
                .active_run
                .as_mut()
                .ok_or(GameKernelV7Error::Invalid)?
                .control = owner.canonical_control.clone();
        }
        let runtime_snapshot = self.active_runtime()?.snapshot();
        let mut staged = GameRuntimeV6::from_snapshot_with_retention(
            GameRuntimeSnapshotV6 {
                state: Some(canonical_state),
                material_ledger: runtime_snapshot.material_ledger,
            },
            self.content.clone(),
            MATERIAL_RETENTION_V7,
        )
        .map_err(runtime_error)?;
        let context = GameActionDispatchContextV1 {
            action: action_context,
            input,
            authority: true,
        };
        let mut step = execute_action_transaction(&mut staged, action, context)?;
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(staged);
        self.private_battle_control = None;
        self.synchronize_menu_allocator()?;
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
        self.retire_obsolete_repeats()
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
        if let Some(CurrentProposalOwnerSnapshotV1::Pending { retained }) = &self.current_proposal {
            let snapshot = runtime.snapshot();
            let record = snapshot
                .material_ledger
                .records
                .last()
                .ok_or(GameKernelV7Error::Invalid)?;
            self.current_proposal = Some(CurrentProposalOwnerSnapshotV1::TerminalAbandoned {
                audit: Box::new(TerminalAbandonedCurrentProposalV1 {
                    retained: retained.as_ref().clone(),
                    terminal_id: terminal.terminal_id.clone(),
                    terminal_reason: terminal.reason.clone(),
                    terminal_operation_id: record.operation_id.clone(),
                    terminal_material_fingerprint: record.material_fingerprint.clone(),
                    terminal_authority_revision: record.authority_revision,
                    terminal_after_digest: record.after_digest.clone(),
                    abandonment_replay_sequence: self.replay_sequence,
                }),
            });
        }
        self.lifecycle = GameKernelLifecycleV7::Terminal {
            runtime,
            terminal: terminal.clone(),
        };
        self.private_battle_control = None;
        self.clear_input()?;
        step.effects.push(GameKernelEffectV7::Terminal(terminal));
        Ok(())
    }

    fn execution_input(
        &self,
        action: &GameActionV1,
    ) -> Result<GameDomainExecutionInputV1, GameKernelV7Error> {
        match action {
            GameActionV1::Save {
                action: er_types::SaveActionV1::Write { slot },
            } => {
                let generation = self
                    .storage_frontiers
                    .get(slot)
                    .copied()
                    .map(increment_safe)
                    .transpose()?
                    .unwrap_or_else(safe_one);
                Ok(GameDomainExecutionInputV1::SaveGeneration(generation))
            }
            GameActionV1::Inventory {
                action: er_types::InventoryActionV1::Use { item, target },
            } => {
                let run = self
                    .state()
                    .and_then(|state| state.active_run.as_ref())
                    .ok_or(GameKernelV7Error::Invalid)?;
                let entry = run
                    .inventory
                    .entries
                    .iter()
                    .find(|entry| entry.item == *item && entry.count > 0)
                    .ok_or(GameKernelV7Error::Invalid)?;
                let target = target.ok_or(GameKernelV7Error::Invalid)?;
                let pokemon = run
                    .party
                    .iter()
                    .find(|pokemon| pokemon.id == target)
                    .or_else(|| {
                        run.storage
                            .iter()
                            .map(|stored| &stored.pokemon)
                            .find(|pokemon| pokemon.id == target)
                    })
                    .ok_or(GameKernelV7Error::Invalid)?;
                let healing = match (item.get().get(), entry.registry_key.as_str()) {
                    (100, "POTION") => Some((20_u32, 10_u32)),
                    (101, "SUPER_POTION") => Some((50, 25)),
                    (102, "HYPER_POTION") => Some((200, 50)),
                    (103, "MAX_POTION") => Some((0, 100)),
                    _ => None,
                };
                if let Some((points, percent)) = healing {
                    if pokemon.hp == 0 || pokemon.hp >= pokemon.max_hp {
                        return Err(GameKernelV7Error::Invalid);
                    }
                    let percent_amount = u64::from(pokemon.max_hp)
                        .checked_mul(u64::from(percent))
                        .and_then(|value| value.checked_div(100))
                        .ok_or(GameKernelV7Error::Invalid)?;
                    let amount = u32::try_from(percent_amount)
                        .map_err(|_| GameKernelV7Error::Invalid)?
                        .saturating_add(points)
                        .min(pokemon.max_hp - pokemon.hp);
                    Ok(GameDomainExecutionInputV1::InventoryUse(
                        InventoryUseEffectV1::Heal { amount },
                    ))
                } else {
                    self.content
                        .battle
                        .held_item(&entry.registry_key)
                        .map_err(|_| GameKernelV7Error::Invalid)?;
                    Ok(GameDomainExecutionInputV1::InventoryUse(
                        InventoryUseEffectV1::GrantHeldItem {
                            registry_key: entry.registry_key.clone(),
                        },
                    ))
                }
            }
            GameActionV1::Capture {
                action: er_types::CaptureActionV1::Attempt { ball, .. },
            } => {
                let definition = self
                    .content
                    .progression
                    .capture_ball(*ball)
                    .ok_or(GameKernelV7Error::Invalid)?;
                if definition.guaranteed {
                    return Ok(GameDomainExecutionInputV1::None);
                }
                let run_rng = self
                    .state()
                    .and_then(|state| state.active_run.as_ref())
                    .map(|run| run.run_rng.clone())
                    .ok_or(GameKernelV7Error::Invalid)?;
                let mut rng = RngRuntime::from_states(run_rng, None)
                    .map_err(|_| GameKernelV7Error::Invalid)?;
                let draw = rng
                    .run_integer_in_range(
                        SafeU53::ZERO,
                        SafeU53::new(255).map_err(|_| GameKernelV7Error::Invalid)?,
                        RngReason::RandomSelector,
                        RngCallsiteId::mechanics(RngReason::RandomSelector),
                    )
                    .map_err(|_| GameKernelV7Error::Invalid)?;
                Ok(GameDomainExecutionInputV1::CaptureRng {
                    draw: u32::try_from(draw.get()).map_err(|_| GameKernelV7Error::Invalid)?,
                    run_rng: rng.run_state(),
                    audit: rng.audit_entries().to_vec(),
                })
            }
            _ => Ok(GameDomainExecutionInputV1::None),
        }
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

    fn retain_canonical_battle_control(&mut self) -> Result<(), GameKernelV7Error> {
        let Some(control) = self.current_control().cloned() else {
            return Ok(());
        };
        if control.kind != GameControlKindV2::BattleCommand || self.private_battle_control.is_some()
        {
            return Ok(());
        }
        self.private_battle_control = Some(PrivateBattleControlSnapshotV7 {
            owner_seat: self.local_seat,
            canonical_control: control.clone(),
            return_control: control,
        });
        Ok(())
    }

    fn canonical_battle_control(&self) -> Option<&GameControlPlanV2> {
        self.private_battle_control
            .as_ref()
            .map(|owner| &owner.canonical_control)
            .or_else(|| self.current_control())
    }

    fn restore_canonical_battle_control(&mut self) -> Result<(), GameKernelV7Error> {
        let Some(owner) = &self.private_battle_control else {
            return Ok(());
        };
        let root = owner.canonical_control.clone();
        self.active_runtime_mut()?
            .install_control(root)
            .map_err(runtime_error)
    }

    fn synchronize_menu_allocator(&mut self) -> Result<(), GameKernelV7Error> {
        self.retire_obsolete_repeats()?;
        let Some(instance) = self
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .map(|menu| menu.instance_id)
        else {
            return Ok(());
        };
        if instance >= self.next_menu_instance_id {
            self.next_menu_instance_id = next_menu_after(instance)?;
        }
        Ok(())
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
        self.input_router
            .repeats
            .sort_by_key(|repeat| (repeat.seat, repeat.button, repeat.source.clone()));
    }

    fn clear_input(&mut self) -> Result<(), GameKernelV7Error> {
        let timers: Vec<_> = self
            .input_router
            .repeats
            .iter()
            .map(|repeat| repeat.timer_id)
            .collect();
        self.cancel_repeats(&timers)?;
        self.input_router.pressed.clear();
        self.input_router.suppressed_printable_keys.clear();
        self.input_router.held_buttons.clear();
        self.input_router.locks.clear();
        self.input_router.repeats.clear();
        Ok(())
    }

    fn register_navigation_repeat(
        &mut self,
        button: GameButton,
        source: PhysicalInputSourceV2,
        menu_instance_id: MenuInstanceId,
    ) -> Result<(), GameKernelV7Error> {
        if navigation_button_v7(&source) != Some(button) {
            return Ok(());
        }
        let mut scheduler = self
            .scheduler
            .clone()
            .into_scheduler()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        let SchedulerCommand::Schedule { timer } = scheduler
            .schedule(
                self.local_seat,
                TimerOwner::input_repeat(button),
                NAVIGATION_REPEAT_INTERVAL_MS_V7,
                TimeClass::HumanInput,
            )
            .map_err(timer_error)?
        else {
            return Err(GameKernelV7Error::Invalid);
        };
        self.scheduler = KernelSchedulerSnapshotV2::from_scheduler(&scheduler)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        self.input_router.repeats.push(InputRepeatSnapshotV2 {
            seat: self.local_seat,
            button,
            source,
            menu_instance_id,
            timer_id: timer.timer_id,
        });
        Ok(())
    }

    fn cancel_source_repeats(
        &mut self,
        source: &PhysicalInputSourceV2,
    ) -> Result<(), GameKernelV7Error> {
        let timers: Vec<_> = self
            .input_router
            .repeats
            .iter()
            .filter(|repeat| repeat.seat == self.local_seat && &repeat.source == source)
            .map(|repeat| repeat.timer_id)
            .collect();
        self.cancel_repeats(&timers)
    }

    fn cancel_repeats(&mut self, timers: &[TimerId]) -> Result<(), GameKernelV7Error> {
        if timers.is_empty() {
            return Ok(());
        }
        let mut scheduler = self
            .scheduler
            .clone()
            .into_scheduler()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        for timer_id in timers {
            let _ = scheduler.cancel(*timer_id);
        }
        self.scheduler = KernelSchedulerSnapshotV2::from_scheduler(&scheduler)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        self.input_router
            .repeats
            .retain(|repeat| !timers.contains(&repeat.timer_id));
        Ok(())
    }

    fn retire_obsolete_repeats(&mut self) -> Result<(), GameKernelV7Error> {
        let current_menu = if matches!(self.lifecycle, GameKernelLifecycleV7::Active(_))
            && self.input_router.focus == InputFocus::Game
            && !self.pending_presentations.values().any(|pending| {
                pending.blocking
                    == er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
            }) {
            self.current_control()
                .filter(|control| control.actionable)
                .and_then(|control| control.menu.as_ref())
                .map(|menu| menu.instance_id)
        } else {
            None
        };
        let timers: Vec<_> = self
            .input_router
            .repeats
            .iter()
            .filter(|repeat| {
                Some(repeat.menu_instance_id) != current_menu || repeat.seat != self.local_seat
            })
            .map(|repeat| repeat.timer_id)
            .collect();
        self.cancel_repeats(&timers)
    }
}

fn timer_error(error: SchedulerError) -> GameKernelV7Error {
    match error {
        SchedulerError::TimerIdExhausted => GameKernelV7Error::TimerAllocationExhausted,
        _ => GameKernelV7Error::Invalid,
    }
}

fn timer_paused(scheduler: &KernelSchedulerSnapshotV2, timer: &ScheduledTimer) -> bool {
    scheduler.pauses.iter().any(|pause| {
        pause.endpoint == timer.endpoint
            && pause.time_class == timer.time_class
            && !pause.reasons.is_empty()
    })
}

pub(crate) fn navigation_button_v7(source: &PhysicalInputSourceV2) -> Option<GameButton> {
    let button = match source {
        PhysicalInputSourceV2::Keyboard(key) => physical_button(key),
        PhysicalInputSourceV2::Gamepad(button) => gamepad_button(*button),
    }?;
    matches!(
        button,
        GameButton::Up | GameButton::Down | GameButton::Left | GameButton::Right
    )
    .then_some(button)
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

fn is_private_battle_leaf(kind: GameControlKindV2) -> bool {
    matches!(
        kind,
        GameControlKindV2::BattleMove
            | GameControlKindV2::BattleTarget
            | GameControlKindV2::BattleSwitch
    )
}

fn controls_differ_only_in_selection(left: &GameControlPlanV2, right: &GameControlPlanV2) -> bool {
    let (Some(_), Some(right_menu)) = (&left.menu, &right.menu) else {
        return false;
    };
    let mut comparable = left.clone();
    if let Some(menu) = &mut comparable.menu {
        menu.selected_option_id = right_menu.selected_option_id.clone();
    }
    comparable == *right
}

pub(crate) fn validate_private_battle_control_v7(
    state: &GameStateV6,
    owner: Option<&PrivateBattleControlSnapshotV7>,
    revision: SafeU53,
) -> Result<(), GameKernelV7Error> {
    let control = state.active_run.as_ref().map(|run| &run.control);
    let Some(owner) = owner else {
        // Old private leaf snapshots cannot identify their exact canonical root.
        return if control.is_some_and(|control| is_private_battle_leaf(control.kind)) {
            Err(GameKernelV7Error::Invalid)
        } else {
            Ok(())
        };
    };
    let control = control.ok_or(GameKernelV7Error::Invalid)?;
    let canonical = &owner.canonical_control;
    canonical
        .validate()
        .map_err(|_| GameKernelV7Error::Invalid)?;
    owner
        .return_control
        .validate()
        .map_err(|_| GameKernelV7Error::Invalid)?;
    let context = canonical
        .action_context
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let menu = canonical.menu.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let canonical_seat = canonical.owner_seat.ok_or(GameKernelV7Error::Invalid)?;
    let (battle, _, field) = local_battle_actor(state, canonical_seat)?;
    let _ = local_battle_actor(state, owner.owner_seat)?;
    let operation = er_types::battle_command::player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field,
        canonical_seat,
    )
    .map_err(|_| GameKernelV7Error::Invalid)?;
    if canonical.kind != GameControlKindV2::BattleCommand
        || !canonical.actionable
        || canonical.revision != revision
        || context.authority_revision != revision
        || context.menu_instance != menu.instance_id
        || context.operation_id != operation
        || !controls_differ_only_in_selection(canonical, &owner.return_control)
    {
        return Err(GameKernelV7Error::Invalid);
    }
    if control.kind == GameControlKindV2::BattleCommand {
        return if *control == owner.return_control {
            Ok(())
        } else {
            Err(GameKernelV7Error::Invalid)
        };
    }
    let leaf_menu = control.menu.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    if leaf_menu.instance_id <= menu.instance_id {
        return Err(GameKernelV7Error::Invalid);
    }
    // Regenerate only to validate the supplied leaf's legal actor/actions; the
    // canonical root and return selection always come from retained exact data.
    let mut expected = match control.kind {
        GameControlKindV2::BattleMove => {
            move_select_control(state, owner.owner_seat, leaf_menu.instance_id, revision)?
        }
        GameControlKindV2::BattleSwitch => {
            switch_select_control(state, owner.owner_seat, leaf_menu.instance_id, revision)?
        }
        _ => return Err(GameKernelV7Error::Invalid),
    };
    expected
        .action_context
        .as_mut()
        .ok_or(GameKernelV7Error::Invalid)?
        .authority_seat = context.authority_seat;
    if !controls_differ_only_in_selection(&expected, control) {
        return Err(GameKernelV7Error::Invalid);
    }
    Ok(())
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

fn type_effectiveness_percent(
    content: &PreparedGameContentV2,
    attack: er_types::battle_model::PokemonType,
    target: &er_state::m7_state::PokemonStateV5,
) -> u16 {
    let mut numerator = 100_u16;
    let mut denominator = 1_u16;
    for defense in [Some(target.types.primary), target.types.secondary]
        .into_iter()
        .flatten()
    {
        match content.battle.pack().type_chart.multiplier(attack, defense) {
            er_types::battle_model::SingleTypeMultiplier::Zero => return 0,
            er_types::battle_model::SingleTypeMultiplier::Half => {
                denominator = denominator.saturating_mul(2);
            }
            er_types::battle_model::SingleTypeMultiplier::One => {}
            er_types::battle_model::SingleTypeMultiplier::Two => {
                numerator = numerator.saturating_mul(2);
            }
        }
    }
    numerator / denominator
}

fn accepted_command_owner(command: &AcceptedBattleCommand) -> Option<SeatId> {
    match command {
        AcceptedBattleCommand::Human { proposal, .. } => Some(proposal.owner_seat),
        AcceptedBattleCommand::ScriptedEnemy { .. } => None,
    }
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

fn battle_proposal_is_rooted_in_control(
    state: Option<&GameStateV6>,
    control: Option<&GameControlPlanV2>,
    sender: SeatId,
    proposal: &GameProposalV1,
) -> bool {
    let (Some(state), Some(control)) = (state, control) else {
        return false;
    };
    let Some(root_context) = control.action_context.as_ref() else {
        return false;
    };
    if control.kind != GameControlKindV2::BattleCommand
        || !control.actionable
        || control.owner_seat != Some(sender)
        || proposal.context.operation_id != root_context.operation_id
        || proposal.context.authority_seat != root_context.authority_seat
        || proposal.context.authority_revision != root_context.authority_revision
        || proposal.context.menu_instance <= root_context.menu_instance
    {
        return false;
    }
    let Ok((_, actor, _)) = local_battle_actor(state, sender) else {
        return false;
    };
    match &proposal.action {
        GameActionV1::Battle {
            action:
                er_types::BattleUiActionV1::SelectMove {
                    actor: selected,
                    move_slot,
                },
        } if *selected == actor => state
            .active_run
            .as_ref()
            .and_then(|run| run.party.iter().find(|pokemon| pokemon.id == actor))
            .and_then(|pokemon| pokemon.moves.get(usize::from(move_slot.get())))
            .is_some_and(Option::is_some),
        GameActionV1::Battle {
            action:
                er_types::BattleUiActionV1::SelectSwitch {
                    actor: selected,
                    party_slot,
                },
        } if *selected == actor => state
            .active_run
            .as_ref()
            .and_then(|run| {
                run.party
                    .get(usize::from(party_slot.get()))
                    .map(|pokemon| (run, pokemon))
            })
            .is_some_and(|(run, pokemon)| {
                pokemon.owner_seat == Some(sender)
                    && !pokemon.fainted
                    && run.battle.as_ref().is_some_and(|battle| {
                        !battle
                            .field
                            .slots
                            .iter()
                            .any(|slot| slot.occupant == Some(pokemon.id))
                    })
            }),
        _ => false,
    }
}

fn remember_proposal_fingerprint(
    protocol: &mut ProtocolRuntimeSnapshotV2,
    operation_id: OperationId,
    fingerprint: String,
) -> Result<(), GameKernelV7Error> {
    let admission = protocol
        .proposal_admission
        .as_mut()
        .ok_or(GameKernelV7Error::Invalid)?;
    admission.fingerprints.push(ProposalFingerprintSnapshotV2 {
        operation_id,
        fingerprint,
    });
    admission
        .fingerprints
        .sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
    protocol.validate().map_err(|_| GameKernelV7Error::Invalid)
}

fn proposal_is_rooted_in_control(
    control: Option<&GameControlPlanV2>,
    sender: SeatId,
    proposal: &GameProposalV1,
) -> bool {
    let Some(control) = control else {
        return false;
    };
    if !control.actionable
        || control.owner_seat != Some(sender)
        || control.action_context.as_ref() != Some(&proposal.context)
    {
        return false;
    }
    let Some(menu) = control.menu.as_ref() else {
        return false;
    };
    if menu.owner_seat != sender || menu.instance_id != proposal.context.menu_instance {
        return false;
    }
    if menu
        .options
        .iter()
        .any(|option| option.enabled && option.visible && option.action == proposal.action)
    {
        return true;
    }
    match &menu.cancel {
        GameMenuCancelV2::Disabled => false,
        GameMenuCancelV2::Select { option_id } => menu.options.iter().any(|option| {
            &option.option_id == option_id
                && option.enabled
                && option.visible
                && option.action == proposal.action
        }),
        GameMenuCancelV2::Back { action } | GameMenuCancelV2::Close { action } => {
            action.as_ref() == &proposal.action
        }
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

fn gamepad_button(button: u16) -> Option<GameButton> {
    match button {
        12 => Some(GameButton::Up),
        13 => Some(GameButton::Down),
        14 => Some(GameButton::Left),
        15 => Some(GameButton::Right),
        0 => Some(GameButton::Action),
        1 => Some(GameButton::Cancel),
        _ => None,
    }
}

fn gamepad_key(button: u16) -> Option<PhysicalKey> {
    match button {
        12 => Some(PhysicalKey::ArrowUp),
        13 => Some(PhysicalKey::ArrowDown),
        14 => Some(PhysicalKey::ArrowLeft),
        15 => Some(PhysicalKey::ArrowRight),
        0 => Some(PhysicalKey::Space),
        1 => Some(PhysicalKey::Escape),
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
