//! Callback-free protocol timer ownership.

use std::collections::{BTreeMap, BTreeSet};

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
    Schedule {
        timer: ScheduledTimer,
    },
    Cancel {
        endpoint: SeatId,
        timer_id: TimerId,
    },
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
    timers: BTreeMap<TimerId, ScheduledTimer>,
    pause_reasons: BTreeMap<(SeatId, TimeClass), BTreeSet<String>>,
    next_timer_id: SafeU53,
    disposed: bool,
}

impl KernelScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn schedule(
        &mut self,
        endpoint: SeatId,
        owner: TimerOwner,
        delay_ms: SafeU53,
        time_class: TimeClass,
    ) -> Result<SchedulerCommand, SchedulerError> {
        if self.disposed {
            return Err(SchedulerError::Disposed);
        }

        let timer_id = self.allocate_timer_id()?;
        let timer = ScheduledTimer {
            endpoint,
            timer_id,
            owner,
            delay_ms,
            time_class,
        };
        self.timers.insert(timer_id, timer.clone());
        Ok(SchedulerCommand::Schedule { timer })
    }

    pub fn cancel(&mut self, timer_id: TimerId) -> Option<SchedulerCommand> {
        let timer = self.timers.remove(&timer_id)?;
        Some(SchedulerCommand::Cancel {
            endpoint: timer.endpoint,
            timer_id,
        })
    }

    pub fn cancel_owner(&mut self, owner_id: &str) -> Vec<SchedulerCommand> {
        let timer_ids = self
            .timers
            .values()
            .filter(|timer| timer.owner.owner_id == owner_id)
            .map(|timer| timer.timer_id)
            .collect::<Vec<_>>();

        timer_ids
            .into_iter()
            .filter_map(|timer_id| self.cancel(timer_id))
            .collect()
    }

    pub fn fired(&mut self, timer_id: TimerId) -> Result<ScheduledTimer, SchedulerError> {
        self.timers
            .remove(&timer_id)
            .ok_or(SchedulerError::UnknownTimer { timer_id })
    }

    pub fn pause_class(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: &str,
    ) -> Result<Option<SchedulerCommand>, SchedulerError> {
        self.check_pause_request(reason)?;
        if time_class == TimeClass::Absolute {
            return Ok(None);
        }

        let reasons = self
            .pause_reasons
            .entry((endpoint, time_class))
            .or_default();
        if !reasons.insert(reason.to_owned()) {
            return Ok(None);
        }

        Ok(Some(SchedulerCommand::PauseClass {
            endpoint,
            time_class,
            reason: reason.to_owned(),
        }))
    }

    pub fn resume_class(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: &str,
    ) -> Result<Option<SchedulerCommand>, SchedulerError> {
        self.check_pause_request(reason)?;
        if time_class == TimeClass::Absolute {
            return Ok(None);
        }

        let key = (endpoint, time_class);
        let Some(reasons) = self.pause_reasons.get_mut(&key) else {
            return Ok(None);
        };
        if !reasons.remove(reason) {
            return Ok(None);
        }
        let is_empty = reasons.is_empty();
        if is_empty {
            self.pause_reasons.remove(&key);
        }

        Ok(Some(SchedulerCommand::ResumeClass {
            endpoint,
            time_class,
            reason: reason.to_owned(),
        }))
    }

    pub fn set_connected(
        &mut self,
        endpoint: SeatId,
        connected: bool,
    ) -> Result<Vec<SchedulerCommand>, SchedulerError> {
        let command = if connected {
            self.resume_class(endpoint, TimeClass::Connected, DISCONNECTED_REASON)?
        } else {
            self.pause_class(endpoint, TimeClass::Connected, DISCONNECTED_REASON)?
        };
        Ok(command.into_iter().collect())
    }

    pub fn set_suspended(
        &mut self,
        endpoint: SeatId,
        suspended: bool,
    ) -> Result<Vec<SchedulerCommand>, SchedulerError> {
        let mut commands = Vec::new();
        for time_class in MECHANICAL_TIME_CLASSES {
            let command = if suspended {
                self.pause_class(endpoint, time_class, SUSPENDED_REASON)?
            } else {
                self.resume_class(endpoint, time_class, SUSPENDED_REASON)?
            };
            if let Some(command) = command {
                commands.push(command);
            }
        }
        Ok(commands)
    }

    pub fn is_class_paused(&self, endpoint: SeatId, time_class: TimeClass) -> bool {
        time_class != TimeClass::Absolute
            && self
                .pause_reasons
                .get(&(endpoint, time_class))
                .is_some_and(|reasons| !reasons.is_empty())
    }

    pub fn timer(&self, timer_id: TimerId) -> Option<&ScheduledTimer> {
        self.timers.get(&timer_id)
    }

    pub fn live_timers(&self) -> Vec<ScheduledTimer> {
        self.timers.values().cloned().collect()
    }

    pub fn pending_timer_count(&self) -> SafeU53 {
        match SafeU53::new(self.timers.len() as u64) {
            Ok(count) => count,
            Err(_) => SafeU53::MAX,
        }
    }

    pub fn is_disposed(&self) -> bool {
        self.disposed
    }

    pub fn dispose(&mut self) -> Vec<SchedulerCommand> {
        if self.disposed {
            return Vec::new();
        }

        self.disposed = true;
        self.pause_reasons.clear();
        let timer_ids = self.timers.keys().copied().collect::<Vec<_>>();
        timer_ids
            .into_iter()
            .filter_map(|timer_id| self.cancel(timer_id))
            .collect()
    }

    fn allocate_timer_id(&mut self) -> Result<TimerId, SchedulerError> {
        let next_value = self
            .next_timer_id
            .get()
            .checked_add(1)
            .ok_or(SchedulerError::TimerIdExhausted)?;
        let next_timer_id =
            SafeU53::new(next_value).map_err(|_| SchedulerError::TimerIdExhausted)?;
        let timer_id = TimerId::new(self.next_timer_id);
        self.next_timer_id = next_timer_id;
        Ok(timer_id)
    }

    fn check_pause_request(&self, reason: &str) -> Result<(), SchedulerError> {
        if self.disposed {
            return Err(SchedulerError::Disposed);
        }
        if reason.is_empty() {
            return Err(SchedulerError::EmptyPauseReason);
        }
        Ok(())
    }
}

const DISCONNECTED_REASON: &str = "disconnected";
const SUSPENDED_REASON: &str = "suspended";
const MECHANICAL_TIME_CLASSES: [TimeClass; 4] = [
    TimeClass::Connected,
    TimeClass::Recovery,
    TimeClass::Renderer,
    TimeClass::HumanInput,
];
