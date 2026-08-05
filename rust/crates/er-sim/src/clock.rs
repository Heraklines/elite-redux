//! One monotonic virtual clock with per-endpoint active-time classes.

use er_protocol::{ScheduledTimer, SchedulerCommand};
use er_types::{SafeU53, SeatId, TimeClass, TimerId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockTimerSnapshot {
    pub timer: ScheduledTimer,
    pub remaining_active_ms: SafeU53,
    pub paused: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClockEvent {
    TimerFired { endpoint: SeatId, timer_id: TimerId },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum VirtualClockError {
    #[error("virtual clock time would exceed SafeU53")]
    TimeOverflow,
    #[error("timer {timer_id} is already scheduled")]
    DuplicateTimer { timer_id: TimerId },
    #[error("timer {timer_id} is not scheduled")]
    UnknownTimer { timer_id: TimerId },
    #[error("scheduler command is invalid: {reason}")]
    InvalidCommand { reason: String },
    #[error("virtual clock is disposed")]
    Disposed,
}

#[derive(Debug, Default)]
pub struct VirtualClock {
    _contract: (),
}

impl VirtualClock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn now(&self) -> SafeU53 {
        SafeU53::ZERO
    }

    pub fn class_now(&self, _endpoint: SeatId, _time_class: TimeClass) -> SafeU53 {
        SafeU53::ZERO
    }

    pub fn apply(&mut self, _command: SchedulerCommand) -> Result<(), VirtualClockError> {
        Err(VirtualClockError::Disposed)
    }

    pub fn advance(&mut self, _delta_ms: SafeU53) -> Result<Vec<ClockEvent>, VirtualClockError> {
        Err(VirtualClockError::Disposed)
    }

    pub fn sync(&mut self) -> Result<Vec<ClockEvent>, VirtualClockError> {
        Err(VirtualClockError::Disposed)
    }

    pub fn next_deadline_delta(&self) -> Option<SafeU53> {
        None
    }

    pub fn timer(&self, _timer_id: TimerId) -> Option<ClockTimerSnapshot> {
        None
    }

    pub fn pending_timers(&self) -> Vec<ClockTimerSnapshot> {
        Vec::new()
    }

    pub fn is_class_paused(&self, _endpoint: SeatId, _time_class: TimeClass) -> bool {
        false
    }

    pub fn dispose(&mut self) {}
}
