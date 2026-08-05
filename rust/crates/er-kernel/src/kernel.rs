//! Side-effect-free kernel entry point.

use std::collections::BTreeMap;

use er_canonical::content_digest;
use er_types::{
    ButtonEvent, GameButton, InputMap, InputRouterOutput, InputTimerCommand, MenuGeneration,
    MenuState, SeatId, TimeClass, TimerId, TimerOwner, UiState,
};
pub use er_types::{KernelEffect, KernelInput, KernelSnapshot, LiveResourceSnapshot};
use thiserror::Error;

use crate::{InputRouteError, InputRouter, UiReducer};

#[derive(Clone, Debug, Default)]
pub struct KernelConfig {
    pub input_map: InputMap,
    pub initial_ui: UiState,
}

#[derive(Clone, Debug)]
pub struct GameKernel {
    input_router: InputRouter,
    ui_reducer: UiReducer,
    repeat_timers: BTreeMap<TimerId, RepeatContext>,
    live_resources: LiveResourceSnapshot,
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
        }
    }

    pub fn step(&mut self, input: KernelInput) -> Result<Vec<KernelEffect>, KernelError> {
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
            | KernelInput::PresentationSettled { .. }
            | KernelInput::TransportChanged { .. }
            | KernelInput::StorageResult { .. }
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
                        owner: TimerOwner::InputRepeat(button),
                        delay_ms,
                        time_class: TimeClass::Virtual,
                    });
                }
                InputTimerCommand::Cancel { timer_id } => {
                    let cancel_endpoint = self
                        .repeat_timers
                        .remove(&timer_id)
                        .map_or(endpoint, |context| context.endpoint);
                    self.live_resources.timers.remove(&timer_id);
                    effects.push(KernelEffect::CancelTimer {
                        endpoint: cancel_endpoint,
                        timer_id,
                    });
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
                        owner: TimerOwner::InputRepeat(context.button),
                        delay_ms,
                        time_class: TimeClass::Virtual,
                    });
                }
                InputTimerCommand::Schedule { .. } => {}
                InputTimerCommand::Cancel { timer_id } => {
                    let cancel_endpoint = self
                        .repeat_timers
                        .remove(&timer_id)
                        .map_or(context.endpoint, |timer_context| timer_context.endpoint);
                    self.live_resources.timers.remove(&timer_id);
                    effects.push(KernelEffect::CancelTimer {
                        endpoint: cancel_endpoint,
                        timer_id,
                    });
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
            let accepted = self
                .ui_reducer
                .reduce_at(endpoint, generation, ButtonEvent::Pressed(button))
                .is_ok();
            pressed = Some((button, accepted));
            if accepted {
                effects.push(KernelEffect::UiChanged {
                    endpoint,
                    view: self.ui_reducer.view(),
                });
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
}
