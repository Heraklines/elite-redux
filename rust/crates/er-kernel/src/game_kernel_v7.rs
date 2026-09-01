//! GameKernelV7: sole production owner for the direct M9-E runtime path.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_canonical::canonical_bytes;
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
use er_protocol::{EndpointRole, ProtocolRuntimeSnapshotV2};
use er_state::m7_state::ProfileStateV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::ui_menu::NavigationDirection;
use er_types::{
    BootstrapActionV1, GAME_ACTION_SCHEMA_VERSION_V1, GameActionContextV1, GameActionV1,
    GameButton, GameControlPlanV2, GameProposalV1, OperationId, PlatformRequestId, RunOutcome,
    SafeU53, SeatId, StarterSelectionV1, TerminalState,
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
    input_router: InputRouterSnapshotV2,
    scheduler: KernelSchedulerSnapshotV2,
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
        let value = Self {
            lifecycle: GameKernelLifecycleV7::Bootstrap(bootstrap),
            content,
            local_seat,
            role,
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
        let runtime = GameRuntimeV6::new(Some(state), content.clone(), next_authority_revision)
            .map_err(runtime_error)?;
        let value = Self {
            lifecycle: GameKernelLifecycleV7::Active(runtime),
            content,
            local_seat,
            role,
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
        let lifecycle = match snapshot.lifecycle {
            GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) => {
                GameKernelLifecycleV7::Bootstrap(bootstrap)
            }
            GameKernelLifecycleSnapshotV7::Active(state) => GameKernelLifecycleV7::Active(
                GameRuntimeV6::from_snapshot(
                    GameRuntimeSnapshotV6 {
                        state: Some(state),
                        material_ledger: snapshot.material_ledger,
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
                        material_ledger: snapshot.material_ledger,
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
            input_router: self.input_router.clone(),
            scheduler: self.scheduler.clone(),
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
        let candidate = construct_natural_run_v6(&bootstrap, self.content.as_ref(), safe_one())
            .map_err(|error| GameKernelV7Error::Bootstrap(error.to_string()))?;
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
        if self.role == GameKernelRoleV7::Replica {
            let proposal = GameProposalV1 {
                schema_version: GAME_ACTION_SCHEMA_VERSION_V1,
                context: action_context.clone(),
                action,
            };
            proposal
                .validate()
                .map_err(|_| GameKernelV7Error::Invalid)?;
            let bytes = canonical_bytes(&proposal).map_err(|_| GameKernelV7Error::Invalid)?;
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
