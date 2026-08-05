//! Proposal admission identity and retained resend leases.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{OperationId, ProposalMessage, SafeI53, SafeU53, TimerId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::SchedulerCommand;

pub const DEFAULT_PROPOSAL_CAPACITY: u64 = 8_192;
pub const DEFAULT_PROPOSAL_RETRY_INITIAL_MS: u64 = 250;
pub const DEFAULT_PROPOSAL_RETRY_MAX_MS: u64 = 5_000;
pub const DEFAULT_PROPOSAL_ABSOLUTE_CEILING_MS: u64 = 1_200_000;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProposalJson(String);

impl ProposalJson {
    pub fn new(value: impl Into<String>) -> Result<Self, ProposalFingerprintError> {
        let value = value.into();
        serde_json::from_str::<Value>(&value).map_err(|error| {
            ProposalFingerprintError::InvalidJson {
                reason: error.to_string(),
            }
        })?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProposalFingerprintInput {
    Ordinary {
        sequence: SafeU53,
        label: String,
        choice: SafeI53,
        wire: Option<ProposalJson>,
        reward_surface: Option<ProposalJson>,
    },
    Bargain {
        sequence: SafeU53,
        outcome: ProposalJson,
    },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProposalFingerprintError {
    #[error("proposal kind must not be empty")]
    EmptyKind,
    #[error("proposal JSON is invalid: {reason}")]
    InvalidJson { reason: String },
    #[error("proposal sequence offset exceeds SafeU53")]
    SequenceOverflow,
}

pub fn proposal_fingerprint(
    _input: &ProposalFingerprintInput,
) -> Result<String, ProposalFingerprintError> {
    Err(ProposalFingerprintError::InvalidJson {
        reason: "proposal fingerprint implementation pending".to_owned(),
    })
}

pub fn fingerprint_reward(
    _sequence: SafeU53,
    _label: &str,
    _choice: SafeI53,
    _wire: Option<&ProposalJson>,
    _reward_surface: Option<&ProposalJson>,
) -> Result<String, ProposalFingerprintError> {
    Err(ProposalFingerprintError::InvalidJson {
        reason: "reward fingerprint implementation pending".to_owned(),
    })
}

pub fn fingerprint_biome_shop_leave(
    _pinned_sequence: SafeU53,
) -> Result<String, ProposalFingerprintError> {
    Err(ProposalFingerprintError::InvalidJson {
        reason: "biome-shop fingerprint implementation pending".to_owned(),
    })
}

pub fn fingerprint_biome_shop_buy(
    _pinned_sequence: SafeU53,
    _bought_slot: SafeI53,
    _proposal_data: [SafeI53; 4],
) -> Result<String, ProposalFingerprintError> {
    Err(ProposalFingerprintError::InvalidJson {
        reason: "biome-shop fingerprint implementation pending".to_owned(),
    })
}

pub fn fingerprint_bargain(
    _sequence: SafeU53,
    _outcome: &ProposalJson,
) -> Result<String, ProposalFingerprintError> {
    Err(ProposalFingerprintError::InvalidJson {
        reason: "bargain fingerprint implementation pending".to_owned(),
    })
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalIdentity {
    pub operation_id: OperationId,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalAdmission {
    Admitted,
    Duplicate,
    Conflict,
    Invalid,
    CapacityExhausted,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalAdmissionDiagnostics {
    pub capacity: SafeU53,
    pub fingerprints: BTreeMap<OperationId, String>,
    pub disposed: bool,
}

#[derive(Debug)]
pub struct ProposalAdmissionLedger {
    _contract: (),
}

impl ProposalAdmissionLedger {
    pub fn new(_capacity: SafeU53) -> Result<Self, ProposalAdmissionError> {
        Err(ProposalAdmissionError::InvalidCapacity)
    }

    pub fn admit(&mut self, _proposal: &ProposalIdentity) -> ProposalAdmission {
        ProposalAdmission::Invalid
    }

    pub fn fingerprint(&self, _operation_id: &OperationId) -> Option<&str> {
        None
    }

    pub fn reset(&mut self) {}

    pub fn len(&self) -> SafeU53 {
        SafeU53::ZERO
    }

    pub fn is_empty(&self) -> bool {
        true
    }

    pub fn diagnostics(&self) -> ProposalAdmissionDiagnostics {
        ProposalAdmissionDiagnostics::default()
    }

    pub fn dispose(&mut self) {}
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProposalAdmissionError {
    #[error("proposal admission capacity must be positive")]
    InvalidCapacity,
}

/// The lease retains the exact opaque transport proposal; it does not define a
/// second proposal envelope or an Authority V2 frame type.
pub type RetainedProposal = ProposalMessage;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseConfig {
    pub owner_prefix: String,
    pub retry_initial_ms: SafeU53,
    pub retry_maximum_ms: SafeU53,
    pub absolute_ceiling_ms: SafeU53,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseSpec {
    pub proposal: RetainedProposal,
    pub absolute_ceiling_ms: Option<SafeU53>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProposalLeaseAction {
    Send {
        proposal: RetainedProposal,
    },
    Scheduler {
        command: SchedulerCommand,
    },
    Terminalize {
        operation_id: OperationId,
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalLeaseStart {
    Retained,
    AlreadyRetained,
    AlreadyCommitted,
    Conflict,
    Invalid,
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseOutcome {
    pub result: ProposalLeaseStart,
    pub actions: Vec<ProposalLeaseAction>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseDiagnostics {
    pub live_operation_ids: BTreeSet<OperationId>,
    pub committed_tombstones: BTreeSet<OperationId>,
    pub timer_ids: BTreeSet<TimerId>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProposalLeaseError {
    #[error("proposal lease manager is disposed")]
    Disposed,
    #[error("proposal operation identity conflicts with a retained lease")]
    Conflict,
    #[error("proposal timer {timer_id} is unknown")]
    UnknownTimer { timer_id: TimerId },
    #[error("proposal lease is invalid: {reason}")]
    InvalidProposal { reason: String },
}

#[derive(Debug)]
pub struct ProposalLeaseManager {
    _contract: (),
}

impl ProposalLeaseManager {
    pub fn new(_config: ProposalLeaseConfig) -> Result<Self, ProposalLeaseError> {
        Err(ProposalLeaseError::Disposed)
    }

    pub fn arm(&mut self, _spec: ProposalLeaseSpec) -> ProposalLeaseOutcome {
        ProposalLeaseOutcome {
            result: ProposalLeaseStart::Disposed,
            actions: Vec::new(),
        }
    }

    pub fn observe_committed(
        &mut self,
        _operation_id: &OperationId,
    ) -> (bool, Vec<ProposalLeaseAction>) {
        (false, Vec::new())
    }

    pub fn resend_retained(&mut self) -> (SafeU53, Vec<ProposalLeaseAction>) {
        (SafeU53::ZERO, Vec::new())
    }

    pub fn rebind(
        &mut self,
        _endpoint: er_types::SeatId,
        _generation: er_types::ConnectionGeneration,
    ) -> Result<(SafeU53, Vec<ProposalLeaseAction>), ProposalLeaseError> {
        Err(ProposalLeaseError::Disposed)
    }

    pub fn timer_fired(
        &mut self,
        timer_id: TimerId,
    ) -> Result<Vec<ProposalLeaseAction>, ProposalLeaseError> {
        Err(ProposalLeaseError::UnknownTimer { timer_id })
    }

    pub fn diagnostics(&self) -> ProposalLeaseDiagnostics {
        ProposalLeaseDiagnostics::default()
    }

    pub fn retained_count(&self) -> SafeU53 {
        SafeU53::ZERO
    }

    pub fn dispose(&mut self, _reason: &str) -> Vec<ProposalLeaseAction> {
        Vec::new()
    }
}
