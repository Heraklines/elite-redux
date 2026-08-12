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

/// The complete state owned by [`VirtualClock`].  This is deliberately kept
/// separate from `ClockTimerSnapshot`: the latter is the older diagnostic
/// projection and does not contain the endpoint counters, pause reasons, or
/// the deadline used to order due timers.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VirtualClockState {
    pub now_ms: SafeU53,
    pub endpoints: Vec<ClockEndpointState>,
    pub timers: Vec<ClockTimerState>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClockEndpointState {
    pub endpoint: SeatId,
    pub counters: Vec<ClockCounterState>,
    pub pause_reasons: Vec<ClockPauseState>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClockCounterState {
    pub time_class: TimeClass,
    pub now_ms: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClockPauseState {
    pub time_class: TimeClass,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClockTimerState {
    pub timer: ScheduledTimer,
    pub remaining_active_ms: SafeU53,
    pub deadline_ms: SafeU53,
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
    #[error("timer ({endpoint}, {timer_id}) is already scheduled")]
    DuplicateTimer { endpoint: SeatId, timer_id: TimerId },
    #[error("timer ({endpoint}, {timer_id}) is not scheduled")]
    UnknownTimer { endpoint: SeatId, timer_id: TimerId },
    #[error("scheduler command is invalid: {reason}")]
    InvalidCommand { reason: String },
    #[error("virtual clock is disposed")]
    Disposed,
    #[error("virtual clock state is invalid: {reason}")]
    InvalidState { reason: String },
}

#[derive(Debug, Default)]
pub struct VirtualClock {
    now_ms: SafeU53,
    endpoints: BTreeMap<SeatId, EndpointClock>,
    timers: BTreeMap<(SeatId, TimerId), TimerState>,
    disposed: bool,
}

impl VirtualClock {
    pub fn new() -> Self {
        Self::default()
    }

    /// Export every clock-owned field in deterministic order.
    pub fn export_state(&self) -> VirtualClockState {
        VirtualClockState {
            now_ms: self.now_ms,
            endpoints: self
                .endpoints
                .iter()
                .map(|(endpoint, clock)| ClockEndpointState {
                    endpoint: *endpoint,
                    counters: ALL_TIME_CLASSES
                        .into_iter()
                        .map(|time_class| ClockCounterState {
                            time_class,
                            now_ms: clock.counters[&time_class],
                        })
                        .collect(),
                    pause_reasons: clock
                        .pause_reasons
                        .iter()
                        .map(|(time_class, reasons)| ClockPauseState {
                            time_class: *time_class,
                            reasons: reasons.iter().cloned().collect(),
                        })
                        .collect(),
                })
                .collect(),
            timers: self
                .timers
                .values()
                .map(|timer| ClockTimerState {
                    timer: timer.timer.clone(),
                    remaining_active_ms: timer.remaining_active_ms,
                    deadline_ms: timer.deadline_ms,
                    paused: self
                        .is_endpoint_class_paused(timer.timer.endpoint, timer.timer.time_class),
                })
                .collect(),
            disposed: self.disposed,
        }
    }

    pub fn restorable_state(&self) -> VirtualClockState {
        self.export_state()
    }

    /// Construct a fresh owner only after validating the complete state.
    pub fn from_state(state: VirtualClockState) -> Result<Self, VirtualClockError> {
        state.validate()?;

        let endpoints = state
            .endpoints
            .into_iter()
            .map(|endpoint| {
                let counters = endpoint
                    .counters
                    .into_iter()
                    .map(|counter| (counter.time_class, counter.now_ms))
                    .collect();
                let pause_reasons = endpoint
                    .pause_reasons
                    .into_iter()
                    .map(|pause| (pause.time_class, pause.reasons.into_iter().collect()))
                    .collect();
                (
                    endpoint.endpoint,
                    EndpointClock {
                        counters,
                        pause_reasons,
                    },
                )
            })
            .collect();
        let timers = state
            .timers
            .into_iter()
            .map(|timer| {
                (
                    (timer.timer.endpoint, timer.timer.timer_id),
                    TimerState {
                        timer: timer.timer,
                        remaining_active_ms: timer.remaining_active_ms,
                        deadline_ms: timer.deadline_ms,
                    },
                )
            })
            .collect();

        Ok(Self {
            now_ms: state.now_ms,
            endpoints,
            timers,
            disposed: state.disposed,
        })
    }

    pub fn from_restorable_state(state: VirtualClockState) -> Result<Self, VirtualClockError> {
        Self::from_state(state)
    }

    /// Replace an owner atomically.  Validation and construction happen on a
    /// fresh value, so an invalid state leaves this clock untouched.
    pub fn restore_state(&mut self, state: VirtualClockState) -> Result<(), VirtualClockError> {
        let restored = Self::from_state(state)?;
        *self = restored;
        Ok(())
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

        let mut counter_updates = Vec::new();
        for (endpoint, clock) in &self.endpoints {
            for time_class in ALL_TIME_CLASSES {
                if clock.is_active(time_class) {
                    let counter = match clock.counters.get(&time_class).copied() {
                        Some(value) => value,
                        None => current_now,
                    };
                    counter_updates.push((*endpoint, time_class, add_time(counter, delta_ms)?));
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

        let mut timer_updates = Vec::with_capacity(self.timers.len());
        for (timer_key, timer) in &self.timers {
            let remaining_active_ms =
                if paused_classes.contains(&(timer.timer.endpoint, timer.timer.time_class)) {
                    timer.remaining_active_ms
                } else {
                    subtract_or_zero(timer.remaining_active_ms, delta_ms)?
                };
            timer_updates.push((*timer_key, remaining_active_ms));
        }

        self.now_ms = next_now;
        for (endpoint, time_class, counter) in counter_updates {
            if let Some(clock) = self.endpoints.get_mut(&endpoint) {
                clock.counters.insert(time_class, counter);
            }
        }
        for (timer_key, remaining_active_ms) in timer_updates {
            if let Some(timer) = self.timers.get_mut(&timer_key) {
                timer.remaining_active_ms = remaining_active_ms;
            }
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

    pub fn timer(&self, endpoint: SeatId, timer_id: TimerId) -> Option<ClockTimerSnapshot> {
        let timer = self.timers.get(&(endpoint, timer_id))?;
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
        let endpoint = timer.endpoint;
        let timer_id = timer.timer_id;
        let timer_key = (endpoint, timer_id);
        if self.timers.contains_key(&timer_key) {
            return Err(VirtualClockError::DuplicateTimer { endpoint, timer_id });
        }

        let deadline_ms = add_time(self.now_ms, timer.delay_ms)?;
        self.ensure_endpoint(timer.endpoint);
        self.timers.insert(
            timer_key,
            TimerState {
                remaining_active_ms: timer.delay_ms,
                deadline_ms,
                timer,
            },
        );
        Ok(())
    }

    fn cancel(&mut self, endpoint: SeatId, timer_id: TimerId) -> Result<(), VirtualClockError> {
        let timer_key = (endpoint, timer_id);
        if !self.timers.contains_key(&timer_key) {
            return Err(VirtualClockError::UnknownTimer { endpoint, timer_id });
        };
        self.timers.remove(&timer_key);
        Ok(())
    }

    fn pause_class(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    ) -> Result<(), VirtualClockError> {
        if time_class == TimeClass::Absolute {
            return Ok(());
        }
        validate_reason(&reason)?;
        let clock = self.ensure_endpoint(endpoint);
        clock
            .pause_reasons
            .entry(time_class)
            .or_default()
            .insert(reason);
        Ok(())
    }

    fn resume_class(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    ) -> Result<(), VirtualClockError> {
        if time_class == TimeClass::Absolute {
            return Ok(());
        }
        validate_reason(&reason)?;

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
                    .map(|deadline_ms| ((timer.timer.endpoint, timer.timer.timer_id), deadline_ms))
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
        for (timer_key, deadline_ms) in deadline_updates {
            if let Some(timer) = self.timers.get_mut(&timer_key) {
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
                    timer.timer.endpoint,
                    timer.timer.timer_id,
                )
            })
            .collect::<Vec<_>>();
        due.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| left.2.cmp(&right.2))
        });

        let mut events = Vec::with_capacity(due.len());
        for (_, endpoint, timer_id) in due {
            if self.timers.remove(&(endpoint, timer_id)).is_some() {
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

impl VirtualClockState {
    pub fn validate(&self) -> Result<(), VirtualClockError> {
        if self.disposed && (!self.endpoints.is_empty() || !self.timers.is_empty()) {
            return Err(VirtualClockError::InvalidState {
                reason: "disposed clock cannot retain endpoint or timer state".to_owned(),
            });
        }

        for pair in self.endpoints.windows(2) {
            if pair[0].endpoint >= pair[1].endpoint {
                return Err(VirtualClockError::InvalidState {
                    reason: "endpoints must be strictly sorted and unique".to_owned(),
                });
            }
        }

        let endpoint_map = self
            .endpoints
            .iter()
            .map(|endpoint| (endpoint.endpoint, endpoint))
            .collect::<BTreeMap<_, _>>();

        for endpoint in &self.endpoints {
            if endpoint.counters.len() != ALL_TIME_CLASSES.len() {
                return Err(VirtualClockError::InvalidState {
                    reason: format!(
                        "endpoint {} must contain one counter for every time class",
                        endpoint.endpoint
                    ),
                });
            }
            for (counter, expected_class) in endpoint.counters.iter().zip(ALL_TIME_CLASSES) {
                if counter.time_class != expected_class {
                    return Err(VirtualClockError::InvalidState {
                        reason: format!(
                            "endpoint {} counters must be ordered by time class",
                            endpoint.endpoint
                        ),
                    });
                }
                if counter.now_ms > self.now_ms {
                    return Err(VirtualClockError::InvalidState {
                        reason: format!(
                            "endpoint {} counter for {:?} exceeds clock time",
                            endpoint.endpoint, counter.time_class
                        ),
                    });
                }
                if counter.time_class == TimeClass::Absolute && counter.now_ms != self.now_ms {
                    return Err(VirtualClockError::InvalidState {
                        reason: format!(
                            "endpoint {} absolute counter must equal clock time",
                            endpoint.endpoint
                        ),
                    });
                }
            }

            for pair in endpoint.pause_reasons.windows(2) {
                if pair[0].time_class >= pair[1].time_class {
                    return Err(VirtualClockError::InvalidState {
                        reason: format!(
                            "endpoint {} pause classes must be strictly sorted and unique",
                            endpoint.endpoint
                        ),
                    });
                }
            }
            for pause in &endpoint.pause_reasons {
                if pause.time_class == TimeClass::Absolute {
                    return Err(VirtualClockError::InvalidState {
                        reason: "absolute time cannot have pause reasons".to_owned(),
                    });
                }
                if pause.reasons.is_empty()
                    || pause.reasons.windows(2).any(|pair| pair[0] >= pair[1])
                    || pause.reasons.iter().any(|reason| reason.is_empty())
                {
                    return Err(VirtualClockError::InvalidState {
                        reason: format!(
                            "endpoint {} pause reasons must be non-empty, sorted, and unique",
                            endpoint.endpoint
                        ),
                    });
                }
            }
        }

        for pair in self.timers.windows(2) {
            let left = (pair[0].timer.endpoint, pair[0].timer.timer_id);
            let right = (pair[1].timer.endpoint, pair[1].timer.timer_id);
            if left >= right {
                return Err(VirtualClockError::InvalidState {
                    reason: "timers must be strictly sorted and unique".to_owned(),
                });
            }
        }

        for timer in &self.timers {
            let key = (timer.timer.endpoint, timer.timer.timer_id);
            let Some(endpoint) = endpoint_map.get(&timer.timer.endpoint) else {
                return Err(VirtualClockError::InvalidState {
                    reason: format!("timer {:?} has no endpoint state", key),
                });
            };
            if timer.remaining_active_ms > timer.timer.delay_ms {
                return Err(VirtualClockError::InvalidState {
                    reason: format!(
                        "timer {:?} remaining duration exceeds its original delay",
                        key,
                    ),
                });
            }
            let expected_paused = endpoint
                .pause_reasons
                .iter()
                .any(|pause| pause.time_class == timer.timer.time_class);
            if timer.paused != expected_paused {
                return Err(VirtualClockError::InvalidState {
                    reason: format!("timer {:?} has an inconsistent pause state", key),
                });
            }
            let expected_deadline = add_time(self.now_ms, timer.remaining_active_ms)?;
            if timer.paused {
                if timer.deadline_ms > expected_deadline {
                    return Err(VirtualClockError::InvalidState {
                        reason: format!(
                            "paused timer {:?} deadline is later than its active deadline",
                            key
                        ),
                    });
                }
            } else if timer.deadline_ms != expected_deadline {
                return Err(VirtualClockError::InvalidState {
                    reason: format!(
                        "active timer {:?} deadline does not match remaining duration",
                        key
                    ),
                });
            }
        }
        Ok(())
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

fn subtract_or_zero(left: SafeU53, right: SafeU53) -> Result<SafeU53, VirtualClockError> {
    SafeU53::new(left.get().saturating_sub(right.get()))
        .map_err(|_| VirtualClockError::TimeOverflow)
}

fn validate_reason(reason: &str) -> Result<(), VirtualClockError> {
    if reason.is_empty() {
        return Err(VirtualClockError::InvalidCommand {
            reason: "pause reason must not be empty".to_owned(),
        });
    }
    Ok(())
}
