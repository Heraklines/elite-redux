//! Side-effect-free kernel entry point.

use std::collections::BTreeMap;

use er_canonical::content_digest;
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, ProposalLeaseConfig,
    RecoveryTransactionConfig,
};
use er_types::{
    ButtonEvent, CancelPolicy, GameButton, InputMap, InputRouterOutput, InputTimerCommand,
    MenuGeneration, MenuOption, MenuOptionId, MenuState, OperationId, SafeU53, SeatId, TimeClass,
    TimerId, TimerOwner, UiState,
};
use serde_json::Value;
pub use er_types::{KernelEffect, KernelInput, KernelSnapshot, LiveResourceSnapshot};
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
                let output = self.input_router.handle(event)?;
                Ok(self.apply_raw_input_output(seat, generation, output))
            }
            KernelInput::TimerFired { endpoint, timer_id } => {
                let Some(context) = self.repeat_timers.get(&timer_id).copied() else {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                };
                if context.endpoint != endpoint || !self.live_resources.timers.contains(&timer_id) {
                    return Err(InputRouteError::UnknownTimer { timer_id }.into());
                }
                let output = self.input_router.timer_fired(timer_id)?;
                Ok(self.apply_timer_output(timer_id, context, output))
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
        self.disposed = true;
        let effects = self
            .repeat_timers
            .iter()
            .map(|(timer_id, context)| KernelEffect::CancelTimer {
                endpoint: context.endpoint,
                timer_id: *timer_id,
            })
            .collect();
        self.repeat_timers.clear();
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
                        continue;
                    };
                    let context = RepeatContext {
                        endpoint,
                        generation,
                        button,
                    };
                    self.repeat_timers.insert(timer_id, context);
                    if !accepted {
                        continue;
                    }
                    self.live_resources.timers.insert(timer_id);
                    effects.push(KernelEffect::ScheduleTimer {
                        endpoint,
                        timer_id,
                        owner: TimerOwner::input_repeat(button),
                        delay_ms,
                        time_class: TimeClass::HumanInput,
                    });
                }
                InputTimerCommand::Cancel { timer_id } => {
                    let cancel_endpoint = self
                        .repeat_timers
                        .remove(&timer_id)
                        .map_or(endpoint, |context| context.endpoint);
                    if self.live_resources.timers.remove(&timer_id) {
                        effects.push(KernelEffect::CancelTimer {
                            endpoint: cancel_endpoint,
                            timer_id,
                        });
                    }
                }
            }
        }

        effects
    }

    fn apply_timer_output(
        &mut self,
        fired_timer_id: TimerId,
        context: RepeatContext,
        output: InputRouterOutput,
    ) -> Vec<KernelEffect> {
        let (mut effects, pressed) =
            self.reduce_button_events(context.endpoint, context.generation, output.events);
        let repeat_is_accepted = match pressed {
            None => true,
            Some((button, accepted)) => button == context.button && accepted,
        };

        self.live_resources.timers.remove(&fired_timer_id);
        for timer in output.timers {
            match timer {
                InputTimerCommand::Schedule { timer_id, delay_ms }
                    if timer_id == fired_timer_id && repeat_is_accepted =>
                {
                    self.live_resources.timers.insert(timer_id);
                    effects.push(KernelEffect::ScheduleTimer {
                        endpoint: context.endpoint,
                        timer_id,
                        owner: TimerOwner::input_repeat(context.button),
                        delay_ms,
                        time_class: TimeClass::HumanInput,
                    });
                }
                InputTimerCommand::Schedule { .. } => {}
                InputTimerCommand::Cancel { timer_id } => {
                    let cancel_endpoint = self
                        .repeat_timers
                        .remove(&timer_id)
                        .map_or(context.endpoint, |timer_context| timer_context.endpoint);
                    if self.live_resources.timers.remove(&timer_id) {
                        effects.push(KernelEffect::CancelTimer {
                            endpoint: cancel_endpoint,
                            timer_id,
                        });
                    }
                }
            }
        }

        effects
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
            let intents = self
                .ui_reducer
                .reduce_at(endpoint, generation, ButtonEvent::Pressed(button));
            let accepted = intents.is_ok();
            pressed = Some((button, accepted));
            if let Ok(intents) = intents {
                effects.push(KernelEffect::UiChanged {
                    endpoint,
                    view: self.ui_reducer.view(),
                });
                effects.extend(intents.into_iter().map(|intent| KernelEffect::UiIntent {
                    endpoint,
                    intent,
                }));
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
