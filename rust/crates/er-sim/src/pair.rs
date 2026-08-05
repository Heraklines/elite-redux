//! Two-kernel effect-only orchestrator with no semantic-choice bypass API.

use std::collections::BTreeMap;

use er_kernel::KernelConfig;
use er_types::{
    InputFocus, KernelEffect, KernelSnapshot, LiveResourceSnapshot, PhysicalKey,
    PresentationEventId, PresentationOutcome, RawInputEvent, SafeU53, SeatId, StorageResult,
    UiViewModel,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::{
    FaultNetworkDiagnostics, FaultOperation, PresenterDiagnostics, PresenterMode,
    StorageDiagnostics,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairEndpoint {
    Host,
    Guest,
}

#[derive(Clone, Debug)]
pub struct SimulatedPairConfig {
    pub host_kernel: KernelConfig,
    pub guest_kernel: KernelConfig,
    pub host_seat: SeatId,
    pub guest_seat: SeatId,
    pub seed: u64,
    pub presenter: PresenterMode,
    pub initial_storage: BTreeMap<String, Value>,
    pub event_budget: SafeU53,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PairOperation {
    RawInput {
        endpoint: PairEndpoint,
        event: RawInputEvent,
    },
    AdvanceTime {
        delta_ms: SafeU53,
    },
    Fault {
        operation: FaultOperation,
    },
    Disconnect {
        endpoint: PairEndpoint,
    },
    Reconnect {
        endpoint: PairEndpoint,
    },
    PresentationSettled {
        endpoint: PairEndpoint,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    },
    StorageResult {
        endpoint: PairEndpoint,
        request_id: SafeU53,
        result: StorageResult,
    },
    Suspend {
        endpoint: PairEndpoint,
    },
    Resume {
        endpoint: PairEndpoint,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointSnapshot {
    pub kernel: KernelSnapshot,
    pub ui: UiViewModel,
    pub state_digest: String,
    pub live_resources: LiveResourceSnapshot,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairSnapshot {
    pub sequence: SafeU53,
    pub seed: u64,
    pub virtual_time_ms: SafeU53,
    pub host: EndpointSnapshot,
    pub guest: EndpointSnapshot,
    pub network: FaultNetworkDiagnostics,
    pub presenter: PresenterDiagnostics,
    pub storage: StorageDiagnostics,
    pub terminal_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStep {
    pub sequence: SafeU53,
    pub operation: PairOperation,
    pub generated_effects: Vec<KernelEffect>,
    pub effects_digest: String,
    pub snapshot: PairSnapshot,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SimulatedPairError {
    #[error("simulated pair contract is not initialized: {reason}")]
    InvalidConfig { reason: String },
    #[error("simulated pair is disposed")]
    Disposed,
    #[error("kernel transition failed: {reason}")]
    Kernel { reason: String },
    #[error("clock transition failed: {reason}")]
    Clock { reason: String },
    #[error("network transition failed: {reason}")]
    Network { reason: String },
    #[error("adapter transition failed: {reason}")]
    Adapter { reason: String },
    #[error("pair did not quiesce within {event_budget} generated events")]
    EventBudgetExceeded { event_budget: SafeU53 },
}

#[derive(Debug)]
pub struct SimulatedPair {
    _contract: (),
}

impl SimulatedPair {
    pub fn new(_config: SimulatedPairConfig) -> Result<Self, SimulatedPairError> {
        Err(SimulatedPairError::InvalidConfig {
            reason: "simulated pair implementation pending".to_owned(),
        })
    }

    pub fn apply(&mut self, _operation: PairOperation) -> Result<PairStep, SimulatedPairError> {
        Err(SimulatedPairError::Disposed)
    }

    pub fn key_down(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
        printable: bool,
    ) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::KeyDown {
                code,
                printable,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        })
    }

    pub fn key_up(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
    ) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::KeyUp { code },
        })
    }

    pub fn press(
        &mut self,
        _endpoint: PairEndpoint,
        _code: PhysicalKey,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        Err(SimulatedPairError::Disposed)
    }

    pub fn hold_for(
        &mut self,
        _endpoint: PairEndpoint,
        _code: PhysicalKey,
        _duration_ms: SafeU53,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        Err(SimulatedPairError::Disposed)
    }

    pub fn blur(&mut self, endpoint: PairEndpoint) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::WindowBlurred,
        })
    }

    pub fn focus(
        &mut self,
        endpoint: PairEndpoint,
        focus: InputFocus,
    ) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::FocusChanged(focus),
        })
    }

    pub fn advance_time(&mut self, delta_ms: SafeU53) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::AdvanceTime { delta_ms })
    }

    pub fn snapshot(&self) -> Result<PairSnapshot, SimulatedPairError> {
        Err(SimulatedPairError::Disposed)
    }

    pub fn teardown(&mut self, _reason: &str) -> Result<PairSnapshot, SimulatedPairError> {
        Err(SimulatedPairError::Disposed)
    }
}
