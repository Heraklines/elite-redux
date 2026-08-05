//! Callback-free protocol timer ownership.

use er_types::{SafeU53, SeatId, TimeClass, TimerId, TimerOwner};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTimer {
    pub endpoint: SeatId,
    pub timer_id: TimerId,
    pub owner: TimerOwner,
    pub delay_ms: SafeU53,
    pub time_class: TimeClass,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchedulerCommand {
    Schedule { timer: ScheduledTimer },
    Cancel { endpoint: SeatId, timer_id: TimerId },
    PauseClass {
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    },
    ResumeClass {
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SchedulerError {
    #[error("scheduler is disposed")]
    Disposed,
    #[error("timer id space is exhausted")]
    TimerIdExhausted,
    #[error("timer {timer_id} is not live")]
    UnknownTimer { timer_id: TimerId },
    #[error("pause reason must not be empty")]
    EmptyPauseReason,
}

#[derive(Debug, Default)]
pub struct KernelScheduler {
    _contract: (),
}

impl KernelScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn schedule(
        &mut self,
        _endpoint: SeatId,
        _owner: TimerOwner,
        _delay_ms: SafeU53,
        _time_class: TimeClass,
    ) -> Result<SchedulerCommand, SchedulerError> {
        Err(SchedulerError::Disposed)
    }

    pub fn cancel(&mut self, _timer_id: TimerId) -> Option<SchedulerCommand> {
        None
    }

    pub fn cancel_owner(&mut self, _owner_id: &str) -> Vec<SchedulerCommand> {
        Vec::new()
    }

    pub fn fired(&mut self, timer_id: TimerId) -> Result<ScheduledTimer, SchedulerError> {
        Err(SchedulerError::UnknownTimer { timer_id })
    }

    pub fn pause_class(
        &mut self,
        _endpoint: SeatId,
        _time_class: TimeClass,
        _reason: &str,
    ) -> Result<Option<SchedulerCommand>, SchedulerError> {
        Err(SchedulerError::Disposed)
    }

    pub fn resume_class(
        &mut self,
        _endpoint: SeatId,
        _time_class: TimeClass,
        _reason: &str,
    ) -> Result<Option<SchedulerCommand>, SchedulerError> {
        Err(SchedulerError::Disposed)
    }

    pub fn set_connected(
        &mut self,
        _endpoint: SeatId,
        _connected: bool,
    ) -> Result<Vec<SchedulerCommand>, SchedulerError> {
        Err(SchedulerError::Disposed)
    }

    pub fn set_suspended(
        &mut self,
        _endpoint: SeatId,
        _suspended: bool,
    ) -> Result<Vec<SchedulerCommand>, SchedulerError> {
        Err(SchedulerError::Disposed)
    }

    pub fn is_class_paused(&self, _endpoint: SeatId, _time_class: TimeClass) -> bool {
        false
    }

    pub fn timer(&self, _timer_id: TimerId) -> Option<&ScheduledTimer> {
        None
    }

    pub fn live_timers(&self) -> Vec<ScheduledTimer> {
        Vec::new()
    }

    pub fn pending_timer_count(&self) -> SafeU53 {
        SafeU53::ZERO
    }

    pub fn is_disposed(&self) -> bool {
        true
    }

    pub fn dispose(&mut self) -> Vec<SchedulerCommand> {
        Vec::new()
    }
}
