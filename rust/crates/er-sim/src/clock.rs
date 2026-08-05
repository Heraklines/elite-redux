//! One monotonic virtual clock with per-endpoint active-time classes.

use std::collections::{BTreeMap, BTreeSet};

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
    now_ms: SafeU53,
    endpoints: BTreeMap<SeatId, EndpointClock>,
    timers: BTreeMap<TimerId, TimerState>,
    disposed: bool,
}

impl VirtualClock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn now(&self) -> SafeU53 {
        self.now_ms
    }

    pub fn class_now(&self, endpoint: SeatId, time_class: TimeClass) -> SafeU53 {
        match self
            .endpoints
            .get(&endpoint)
            .and_then(|clock| clock.counters.get(&time_class).copied())
        {
            Some(value) => value,
            None => self.now_ms,
        }
    }

    pub fn apply(&mut self, command: SchedulerCommand) -> Result<(), VirtualClockError> {
        self.ensure_live()?;

        match command {
            SchedulerCommand::Schedule { timer } => self.schedule(timer),
            SchedulerCommand::Cancel { endpoint, timer_id } => self.cancel(endpoint, timer_id),
            SchedulerCommand::PauseClass {
                endpoint,
                time_class,
                reason,
            } => self.pause_class(endpoint, time_class, reason),
            SchedulerCommand::ResumeClass {
                endpoint,
                time_class,
                reason,
            } => self.resume_class(endpoint, time_class, reason),
        }
    }

    pub fn advance(&mut self, delta_ms: SafeU53) -> Result<Vec<ClockEvent>, VirtualClockError> {
        self.ensure_live()?;
        let current_now = self.now_ms;
        let next_now = add_time(self.now_ms, delta_ms)?;

        for clock in self.endpoints.values() {
            for time_class in ALL_TIME_CLASSES {
                if clock.is_active(time_class) {
                    let counter = match clock.counters.get(&time_class).copied() {
                        Some(value) => value,
                        None => current_now,
                    };
                    add_time(counter, delta_ms)?;
                }
            }
        }

        self.now_ms = next_now;
        for clock in self.endpoints.values_mut() {
            for time_class in ALL_TIME_CLASSES {
                if clock.is_active(time_class) {
                    let counter = clock.counters.entry(time_class).or_insert(current_now);
                    *counter = add_time(*counter, delta_ms)?;
                }
            }
        }

        let paused_classes = self
            .endpoints
            .iter()
            .flat_map(|(endpoint, clock)| {
                clock
                    .pause_reasons
                    .iter()
                    .filter(|(time_class, reasons)| {
                        **time_class != TimeClass::Absolute && !reasons.is_empty()
                    })
                    .map(move |(time_class, _)| (*endpoint, *time_class))
            })
            .collect::<BTreeSet<_>>();
        for timer in self.timers.values_mut() {
            if paused_classes.contains(&(timer.timer.endpoint, timer.timer.time_class)) {
                continue;
            }
            timer.remaining_active_ms = subtract_or_zero(timer.remaining_active_ms, delta_ms);
        }

        Ok(self.collect_due())
    }

    pub fn sync(&mut self) -> Result<Vec<ClockEvent>, VirtualClockError> {
        self.ensure_live()?;
        Ok(self.collect_due())
    }

    pub fn next_deadline_delta(&self) -> Option<SafeU53> {
        self.timers
            .values()
            .filter(|timer| {
                !self.is_endpoint_class_paused(timer.timer.endpoint, timer.timer.time_class)
            })
            .map(|timer| timer.remaining_active_ms)
            .min()
    }

    pub fn timer(&self, timer_id: TimerId) -> Option<ClockTimerSnapshot> {
        let timer = self.timers.get(&timer_id)?;
        Some(self.snapshot(timer))
    }

    pub fn pending_timers(&self) -> Vec<ClockTimerSnapshot> {
        self.timers
            .values()
            .map(|timer| self.snapshot(timer))
            .collect()
    }

    pub fn is_class_paused(&self, endpoint: SeatId, time_class: TimeClass) -> bool {
        self.is_endpoint_class_paused(endpoint, time_class)
    }

    pub fn dispose(&mut self) {
        if self.disposed {
            return;
        }
        self.disposed = true;
        self.timers.clear();
        self.endpoints.clear();
    }

    fn ensure_live(&self) -> Result<(), VirtualClockError> {
        if self.disposed {
            Err(VirtualClockError::Disposed)
        } else {
            Ok(())
        }
    }

    fn schedule(&mut self, timer: ScheduledTimer) -> Result<(), VirtualClockError> {
        let timer_id = timer.timer_id;
        if self.timers.contains_key(&timer_id) {
            return Err(VirtualClockError::DuplicateTimer { timer_id });
        }

        let deadline_ms = add_time(self.now_ms, timer.delay_ms)?;
        self.ensure_endpoint(timer.endpoint);
        self.timers.insert(
            timer_id,
            TimerState {
                remaining_active_ms: timer.delay_ms,
                deadline_ms,
                timer,
            },
        );
        Ok(())
    }

    fn cancel(&mut self, endpoint: SeatId, timer_id: TimerId) -> Result<(), VirtualClockError> {
        let Some(timer) = self.timers.get(&timer_id) else {
            return Err(VirtualClockError::UnknownTimer { timer_id });
        };
        if timer.timer.endpoint != endpoint {
            return Err(VirtualClockError::UnknownTimer { timer_id });
        }
        self.timers.remove(&timer_id);
        Ok(())
    }

    fn pause_class(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    ) -> Result<(), VirtualClockError> {
        validate_reason(&reason)?;
        let clock = self.ensure_endpoint(endpoint);
        if time_class != TimeClass::Absolute {
            clock
                .pause_reasons
                .entry(time_class)
                .or_default()
                .insert(reason);
        }
        Ok(())
    }

    fn resume_class(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    ) -> Result<(), VirtualClockError> {
        validate_reason(&reason)?;
        if time_class == TimeClass::Absolute {
            return Ok(());
        }

        let removes_final_reason = self
            .endpoints
            .get(&endpoint)
            .and_then(|clock| clock.pause_reasons.get(&time_class))
            .is_some_and(|reasons| reasons.len() == 1 && reasons.contains(&reason));

        if !removes_final_reason {
            if let Some(clock) = self.endpoints.get_mut(&endpoint)
                && let Some(reasons) = clock.pause_reasons.get_mut(&time_class)
            {
                reasons.remove(&reason);
                if reasons.is_empty() {
                    clock.pause_reasons.remove(&time_class);
                }
            }
            return Ok(());
        }

        let deadline_updates = self
            .timers
            .values()
            .filter(|timer| {
                timer.timer.endpoint == endpoint && timer.timer.time_class == time_class
            })
            .map(|timer| {
                add_time(self.now_ms, timer.remaining_active_ms)
                    .map(|deadline_ms| (timer.timer.timer_id, deadline_ms))
            })
            .collect::<Result<Vec<_>, _>>()?;

        if let Some(clock) = self.endpoints.get_mut(&endpoint)
            && let Some(reasons) = clock.pause_reasons.get_mut(&time_class)
        {
            reasons.remove(&reason);
            if reasons.is_empty() {
                clock.pause_reasons.remove(&time_class);
            }
        }
        for (timer_id, deadline_ms) in deadline_updates {
            if let Some(timer) = self.timers.get_mut(&timer_id) {
                timer.deadline_ms = deadline_ms;
            }
        }
        Ok(())
    }

    fn ensure_endpoint(&mut self, endpoint: SeatId) -> &mut EndpointClock {
        let now_ms = self.now_ms;
        self.endpoints
            .entry(endpoint)
            .or_insert_with(|| EndpointClock::new(now_ms))
    }

    fn is_endpoint_class_paused(&self, endpoint: SeatId, time_class: TimeClass) -> bool {
        if time_class == TimeClass::Absolute {
            return false;
        }
        self.endpoints
            .get(&endpoint)
            .is_some_and(|clock| clock.is_paused(time_class))
    }

    fn snapshot(&self, timer: &TimerState) -> ClockTimerSnapshot {
        ClockTimerSnapshot {
            timer: timer.timer.clone(),
            remaining_active_ms: timer.remaining_active_ms,
            paused: self.is_endpoint_class_paused(timer.timer.endpoint, timer.timer.time_class),
        }
    }

    fn collect_due(&mut self) -> Vec<ClockEvent> {
        let mut due = self
            .timers
            .values()
            .filter(|timer| {
                timer.remaining_active_ms == SafeU53::ZERO
                    && !self.is_endpoint_class_paused(timer.timer.endpoint, timer.timer.time_class)
            })
            .map(|timer| {
                (
                    timer.deadline_ms,
                    timer.timer.timer_id,
                    timer.timer.endpoint,
                )
            })
            .collect::<Vec<_>>();
        due.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));

        let mut events = Vec::with_capacity(due.len());
        for (_, timer_id, endpoint) in due {
            if self.timers.remove(&timer_id).is_some() {
                events.push(ClockEvent::TimerFired { endpoint, timer_id });
            }
        }
        events
    }
}

const ALL_TIME_CLASSES: [TimeClass; 5] = [
    TimeClass::Connected,
    TimeClass::Recovery,
    TimeClass::Renderer,
    TimeClass::HumanInput,
    TimeClass::Absolute,
];

#[derive(Debug)]
struct EndpointClock {
    counters: BTreeMap<TimeClass, SafeU53>,
    pause_reasons: BTreeMap<TimeClass, BTreeSet<String>>,
}

impl EndpointClock {
    fn new(now_ms: SafeU53) -> Self {
        let counters = ALL_TIME_CLASSES
            .into_iter()
            .map(|time_class| (time_class, now_ms))
            .collect();
        Self {
            counters,
            pause_reasons: BTreeMap::new(),
        }
    }

    fn is_paused(&self, time_class: TimeClass) -> bool {
        self.pause_reasons
            .get(&time_class)
            .is_some_and(|reasons| !reasons.is_empty())
    }

    fn is_active(&self, time_class: TimeClass) -> bool {
        time_class == TimeClass::Absolute || !self.is_paused(time_class)
    }
}

#[derive(Debug)]
struct TimerState {
    timer: ScheduledTimer,
    remaining_active_ms: SafeU53,
    deadline_ms: SafeU53,
}

fn add_time(left: SafeU53, right: SafeU53) -> Result<SafeU53, VirtualClockError> {
    let Some(value) = left.get().checked_add(right.get()) else {
        return Err(VirtualClockError::TimeOverflow);
    };
    SafeU53::new(value).map_err(|_| VirtualClockError::TimeOverflow)
}

fn subtract_or_zero(left: SafeU53, right: SafeU53) -> SafeU53 {
    match SafeU53::new(left.get().saturating_sub(right.get())) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn validate_reason(reason: &str) -> Result<(), VirtualClockError> {
    if reason.is_empty() {
        return Err(VirtualClockError::InvalidCommand {
            reason: "pause reason must not be empty".to_owned(),
        });
    }
    Ok(())
}
