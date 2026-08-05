//! Side-effect-free kernel entry point.

use er_canonical::fixture_digest;
pub use er_types::{KernelEffect, KernelInput, KernelSnapshot, LiveResourceSnapshot};
use er_types::{
    InputMap, InputTimerCommand, MenuGeneration, MenuState, SeatId, TimeClass, TimerOwner, UiState,
};
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
    live_resources: LiveResourceSnapshot,
}

impl GameKernel {
    pub fn new(config: KernelConfig) -> Self {
        Self {
            input_router: InputRouter::new(config.input_map),
            ui_reducer: UiReducer::new(config.initial_ui),
            live_resources: LiveResourceSnapshot::default(),
        }
    }

    pub fn step(&mut self, input: KernelInput) -> Result<Vec<KernelEffect>, KernelError> {
        match input {
            KernelInput::RawInput { seat, event } => {
                let output = self.input_router.handle(event)?;
                Ok(self.effects_from_input_output(seat, output.timers))
            }
            KernelInput::TimerFired { endpoint, timer_id } => {
                let output = self.input_router.timer_fired(timer_id)?;
                Ok(self.effects_from_input_output(endpoint, output.timers))
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
        fixture_digest(&self.snapshot()).unwrap_or_default()
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
        self.ui_reducer
            .replace_menu(owner_seat, actionable, menu)
    }

    fn effects_from_input_output(
        &mut self,
        endpoint: SeatId,
        timers: Vec<InputTimerCommand>,
    ) -> Vec<KernelEffect> {
        timers
            .into_iter()
            .map(|timer| match timer {
                InputTimerCommand::Schedule { timer_id, delay_ms } => {
                    self.live_resources.timers.insert(timer_id);
                    KernelEffect::ScheduleTimer {
                        endpoint,
                        timer_id,
                        owner: TimerOwner::Kernel,
                        delay_ms,
                        time_class: TimeClass::Virtual,
                    }
                }
                InputTimerCommand::Cancel { timer_id } => {
                    self.live_resources.timers.remove(&timer_id);
                    KernelEffect::CancelTimer { endpoint, timer_id }
                }
            })
            .collect()
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
