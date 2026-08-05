//! Physical-input reducer and deterministic repeat ownership.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    GameButton, InputMap, InputRouterOutput, InputTimerCommand, PhysicalKey, RawInputEvent,
    SafeU53, TimerId,
};
use thiserror::Error;

#[derive(Clone, Debug)]
pub struct InputRouter {
    map: InputMap,
    held_buttons: BTreeSet<GameButton>,
    suppressed_keys: BTreeSet<PhysicalKey>,
    timer_buttons: BTreeMap<TimerId, GameButton>,
    next_timer_id: SafeU53,
}

impl InputRouter {
    pub fn new(map: InputMap) -> Self {
        Self {
            map,
            held_buttons: BTreeSet::new(),
            suppressed_keys: BTreeSet::new(),
            timer_buttons: BTreeMap::new(),
            next_timer_id: SafeU53::ZERO,
        }
    }

    pub fn input_map(&self) -> &InputMap {
        &self.map
    }

    pub fn replace_map(&mut self, map: InputMap) -> InputRouterOutput {
        let output = self.clear();
        self.map = map;
        output
    }

    pub fn handle(&mut self, event: RawInputEvent) -> Result<InputRouterOutput, InputRouteError> {
        if matches!(event, RawInputEvent::WindowBlurred) {
            return Ok(self.clear());
        }
        let _ = (&self.suppressed_keys, self.next_timer_id);
        Ok(InputRouterOutput::default())
    }

    pub fn timer_fired(&mut self, timer_id: TimerId) -> Result<InputRouterOutput, InputRouteError> {
        if self.timer_buttons.contains_key(&timer_id) {
            Ok(InputRouterOutput::default())
        } else {
            Err(InputRouteError::UnknownTimer { timer_id })
        }
    }

    pub fn is_held(&self, button: GameButton) -> bool {
        self.held_buttons.contains(&button)
    }

    pub fn clear(&mut self) -> InputRouterOutput {
        let timers = self
            .timer_buttons
            .keys()
            .copied()
            .map(|timer_id| InputTimerCommand::Cancel { timer_id })
            .collect();
        self.held_buttons.clear();
        self.suppressed_keys.clear();
        self.timer_buttons.clear();
        InputRouterOutput {
            events: Vec::new(),
            timers,
        }
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum InputRouteError {
    #[error("input repeat timer {timer_id} is not owned by the router")]
    UnknownTimer { timer_id: TimerId },
    #[error("input repeat timer identifiers are exhausted")]
    TimerIdExhausted,
}
