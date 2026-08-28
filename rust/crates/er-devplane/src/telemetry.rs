//! Byte- and event-bounded local telemetry with no external backend.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TelemetryEventKindV1 {
    ExternalEvent,
    ControlChange,
    Material,
    Terminal,
    Recovery,
    ResourceCount,
    PerformanceOutlier,
    ModelRequest,
    PlatformWarning,
    RenderWarning,
    Checkpoint,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TelemetryEventV1 {
    pub sequence: u64,
    pub event_kind: TelemetryEventKindV1,
    pub payload: Vec<u8>,
    pub redacted: bool,
    pub pinned: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TelemetryRingV1 {
    maximum_bytes: usize,
    maximum_events: usize,
    retained_bytes: usize,
    events: VecDeque<TelemetryEventV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TelemetryErrorV1 {
    #[error("telemetry bounds or payload are invalid")]
    Invalid,
    #[error("telemetry ring has no legal eviction")]
    Capacity,
}

impl TelemetryRingV1 {
    pub fn new(maximum_bytes: usize, maximum_events: usize) -> Result<Self, TelemetryErrorV1> {
        if maximum_bytes == 0 || maximum_events == 0 {
            return Err(TelemetryErrorV1::Invalid);
        }
        Ok(Self {
            maximum_bytes,
            maximum_events,
            retained_bytes: 0,
            events: VecDeque::new(),
        })
    }

    pub fn push(&mut self, event: TelemetryEventV1) -> Result<(), TelemetryErrorV1> {
        if event.payload.is_empty() || event.payload.len() > self.maximum_bytes {
            return Err(TelemetryErrorV1::Invalid);
        }
        while self.events.len() >= self.maximum_events
            || self
                .retained_bytes
                .checked_add(event.payload.len())
                .is_none_or(|bytes| bytes > self.maximum_bytes)
        {
            let index = self
                .events
                .iter()
                .position(|current| !current.pinned)
                .ok_or(TelemetryErrorV1::Capacity)?;
            let removed = self
                .events
                .remove(index)
                .ok_or(TelemetryErrorV1::Capacity)?;
            self.retained_bytes = self
                .retained_bytes
                .checked_sub(removed.payload.len())
                .ok_or(TelemetryErrorV1::Invalid)?;
        }
        self.retained_bytes = self
            .retained_bytes
            .checked_add(event.payload.len())
            .ok_or(TelemetryErrorV1::Capacity)?;
        self.events.push_back(event);
        Ok(())
    }

    pub fn events(&self) -> &VecDeque<TelemetryEventV1> {
        &self.events
    }

    pub fn retained_bytes(&self) -> usize {
        self.retained_bytes
    }

    pub fn clear(&mut self) {
        self.events.clear();
        self.retained_bytes = 0;
    }
}
