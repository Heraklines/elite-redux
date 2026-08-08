//! Side-effect-free kernel entry point.

use std::collections::BTreeMap;

use er_canonical::content_digest;
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, ProposalLeaseConfig,
    KernelScheduler, ScheduledTimer, SchedulerCommand, RecoveryTransactionConfig,
};
use er_types::{
    ButtonEvent, CancelPolicy, GameButton, InputMap, InputRouterOutput, InputTimerCommand,
    MenuGeneration, MenuOption, MenuOptionId, MenuState, OperationId, SafeU53, SeatId, TimeClass,
    TimerId, TimerOwner, UiState,
};
pub use er_types::{KernelEffect, KernelInput, KernelSnapshot, LiveResourceSnapshot};
use serde_json::Value;
use thiserror::Error;

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
    input_router: InputRouter,
    ui_reducer: UiReducer,
    scheduler: KernelScheduler,
    repeat_timers: BTreeMap<TimerId, RepeatContext>,
    live_resources: LiveResourceSnapshot,
    protocol_config: Option<ProtocolKernelConfig>,
    disposed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RepeatContext {
    endpoint: SeatId,
    generation: MenuGeneration,
    button: GameButton,
}

impl GameKernel {
    pub fn new(config: KernelConfig) -> Self {
        Self {
            input_router: InputRouter::new(config.input_map),
            ui_reducer: UiReducer::new(config.initial_ui),
            scheduler: KernelScheduler::new(),
            repeat_timers: BTreeMap::new(),
            live_resources: LiveResourceSnapshot::default(),
            protocol_config: config.protocol,
            disposed: false,
        }
    }

    pub fn step(&mut self, input: KernelInput) -> Result<Vec<KernelEffect>, KernelError> {
        if self.disposed {
            return Err(KernelError::Disposed);
        }
        match input {
            KernelInput::RawInput { seat, event } => {
                let generation = self.ui_reducer.state().generation;
                let output = self.input_router.handle(seat, event, &mut self.scheduler)?;
                Ok(self.apply_raw_input_output(seat, generation, output))
            }
            KernelInput::TimerFired { endpoint, timer_id } => {
                let Some(scheduled) = self.scheduler.timer(timer_id).cloned() else {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                };
                if scheduled.endpoint != endpoint {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }
                let Some(context) = self.repeat_timers.get(&timer_id).copied() else {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                };
                if !Self::is_input_repeat_timer(&scheduled, context) {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }

                let fired = self.scheduler.fired(timer_id).map_err(InputRouteError::from)?;
                self.repeat_timers.remove(&timer_id);
                let output = match self.input_router.timer_fired(fired, &mut self.scheduler) {
                    Ok(output) => output,
                    Err(error) => {
                        self.input_router
                            .discard_timer(timer_id, &mut self.scheduler);
                        self.sync_live_timers();
                        return Err(error.into());
                    }
                };
                Ok(self.apply_timer_output(context, output))
            }
            KernelInput::NetworkFrame { .. }
            | KernelInput::RawNetworkFrame { .. }
            | KernelInput::ProposalReceived { .. }
            | KernelInput::PresentationSettled { .. }
            | KernelInput::TransportChanged { .. }
            | KernelInput::StorageResult { .. }
            | KernelInput::MaterialApplied { .. }
            | KernelInput::ControlProjected { .. }
            | KernelInput::Suspend { .. }
            | KernelInput::Resume { .. } => Ok(Vec::new()),
        }
    }

    pub fn snapshot(&self) -> KernelSnapshot {
        KernelSnapshot {
            ui: self.ui_reducer.state().clone(),
            ..KernelSnapshot::default()
        }
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

    pub fn is_disposed(&self) -> bool {
        self.disposed
    }

    pub fn dispose(&mut self, _reason: &str) -> Vec<KernelEffect> {
        if self.disposed {
            return Vec::new();
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

        for command in self.scheduler.dispose() {
            if let SchedulerCommand::Cancel { endpoint, timer_id } = command {
                effects.push(KernelEffect::CancelTimer {
                    endpoint,
                    timer_id,
                });
            }
        }

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
        self.ui_reducer.replace_menu(owner_seat, actionable, menu)
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
                effects.extend(
                    intents
                        .into_iter()
                        .map(|intent| KernelEffect::UiIntent { endpoint, intent }),
                );
            }
        }

        (effects, pressed)
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
    #[error("kernel is disposed")]
    Disposed,
}
