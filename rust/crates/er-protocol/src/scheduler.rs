//! Callback-free protocol timer ownership.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{SafeU53, SeatId, TimeClass, TimerId, TimerOwner};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSpec {
    pub endpoint: SeatId,
    pub owner: TimerOwner,
    pub delay_ms: SafeU53,
    pub time_class: TimeClass,
}

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

#[derive(Debug)]
pub struct KernelScheduler {
    timers: BTreeMap<TimerId, ScheduledTimer>,
    pause_reasons: BTreeMap<(SeatId, TimeClass), BTreeSet<String>>,
    // `Some(value)` is the next never-used ID in the inclusive
    // `0..=SafeU53::MAX` domain. `None` means the lifetime domain is exhausted;
    // fired and cancelled timers never make an ID available again.
    next_timer_id: Option<SafeU53>,
    disposed: bool,
}

impl Default for KernelScheduler {
    fn default() -> Self {
        Self {
            timers: BTreeMap::new(),
            pause_reasons: BTreeMap::new(),
            next_timer_id: Some(SafeU53::ZERO),
            disposed: false,
        }
    }
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
        self.schedule_batch(vec![TimerSpec {
            endpoint,
            owner,
            delay_ms,
            time_class,
        }])?
        .into_iter()
        .next()
        .ok_or(SchedulerError::TimerIdExhausted)
    }

    pub fn schedule_batch(
        &mut self,
        specs: Vec<TimerSpec>,
    ) -> Result<Vec<SchedulerCommand>, SchedulerError> {
        if self.disposed {
            return Err(SchedulerError::Disposed);
        }
        if specs.is_empty() {
            return Ok(Vec::new());
        }
        if (specs.len() as u64) > self.available_timer_ids() {
            return Err(SchedulerError::TimerIdExhausted);
        }

        // Build every registration and advance a local cursor first. No
        // scheduler field changes until the complete batch is known to fit.
        let mut next_timer_id = self.next_timer_id;
        let mut registrations = Vec::with_capacity(specs.len());
        for spec in specs {
            let timer_id_value = next_timer_id.ok_or(SchedulerError::TimerIdExhausted)?;
            let next_value = if timer_id_value == SafeU53::MAX {
                None
            } else {
                Some(
                    SafeU53::new(timer_id_value.get() + 1)
                        .map_err(|_| SchedulerError::TimerIdExhausted)?,
                )
            };
            let timer_id = TimerId::new(timer_id_value);
            let timer = ScheduledTimer {
                endpoint: spec.endpoint,
                timer_id,
                owner: spec.owner,
                delay_ms: spec.delay_ms,
                time_class: spec.time_class,
            };
            registrations.push((timer_id, timer));
            next_timer_id = next_value;
        }

        let mut commands = Vec::with_capacity(registrations.len());
        for (timer_id, timer) in registrations {
            commands.push(SchedulerCommand::Schedule {
                timer: timer.clone(),
            });
            self.timers.insert(timer_id, timer);
        }
        self.next_timer_id = next_timer_id;
        Ok(commands)
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

    fn available_timer_ids(&self) -> u64 {
        self.next_timer_id.map_or(0, |next_timer_id| {
            SafeU53::MAX.get() - next_timer_id.get() + 1
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(reason: &str) -> TimerSpec {
        TimerSpec {
            endpoint: SeatId::new(SafeU53::ZERO),
            owner: TimerOwner {
                owner_id: "scheduler-test".to_owned(),
                address: format!("boundary/{reason}"),
                reason: reason.to_owned(),
            },
            delay_ms: SafeU53::ZERO,
            time_class: TimeClass::Absolute,
        }
    }

    #[test]
    fn timer_id_domain_includes_safe_u53_maximum_without_reuse() -> Result<(), SchedulerError> {
        let mut scheduler = KernelScheduler::new();
        scheduler.next_timer_id = Some(SafeU53::MAX);

        let timer = ScheduledTimer {
            endpoint: SeatId::new(SafeU53::ZERO),
            timer_id: TimerId::new(SafeU53::MAX),
            owner: spec("maximum").owner,
            delay_ms: SafeU53::ZERO,
            time_class: TimeClass::Absolute,
        };
        assert_eq!(
            scheduler.schedule_batch(vec![spec("maximum")])?,
            vec![SchedulerCommand::Schedule {
                timer: timer.clone(),
            }]
        );
        assert_eq!(scheduler.fired(timer.timer_id)?, timer);
        assert_eq!(
            scheduler.schedule_batch(vec![spec("after-maximum")]),
            Err(SchedulerError::TimerIdExhausted)
        );
        Ok(())
    }

    #[test]
    fn batch_exhaustion_at_maximum_boundary_is_atomic() -> Result<(), SchedulerError> {
        let mut scheduler = KernelScheduler::new();
        scheduler.next_timer_id = Some(SafeU53::MAX);
        let first = spec("first");
        let second = spec("second");

        assert_eq!(
            scheduler.schedule_batch(vec![first.clone(), second]),
            Err(SchedulerError::TimerIdExhausted)
        );
        assert_eq!(scheduler.live_timers(), Vec::new());
        assert_eq!(scheduler.pending_timer_count(), SafeU53::ZERO);

        assert_eq!(
            scheduler.schedule_batch(vec![first])?,
            vec![SchedulerCommand::Schedule {
                timer: ScheduledTimer {
                    endpoint: SeatId::new(SafeU53::ZERO),
                    timer_id: TimerId::new(SafeU53::MAX),
                    owner: TimerOwner {
                        owner_id: "scheduler-test".to_owned(),
                        address: "boundary/first".to_owned(),
                        reason: "first".to_owned(),
                    },
                    delay_ms: SafeU53::ZERO,
                    time_class: TimeClass::Absolute,
                },
            }]
        );
        Ok(())
    }

    #[test]
    fn allocation_crossing_maximum_boundary_uses_each_id_once() -> Result<(), SchedulerError> {
        let mut scheduler = KernelScheduler::new();
        let before_max =
            SafeU53::new(SafeU53::MAX.get() - 1).map_err(|_| SchedulerError::TimerIdExhausted)?;
        scheduler.next_timer_id = Some(before_max);

        let commands = scheduler.schedule_batch(vec![spec("before-max"), spec("maximum")])?;
        assert_eq!(
            commands
                .iter()
                .filter_map(|command| match command {
                    SchedulerCommand::Schedule { timer } => Some(timer.timer_id),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec![TimerId::new(before_max), TimerId::new(SafeU53::MAX),]
        );
        assert_eq!(
            scheduler.schedule_batch(vec![spec("after-max")]),
            Err(SchedulerError::TimerIdExhausted)
        );
        Ok(())
    }
}
