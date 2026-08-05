//! Seeded deterministic fault network over raw Authority V2 envelopes.

use std::collections::BTreeSet;

use er_types::{ConnectionGeneration, NetworkPayload, RawFrame, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPacket {
    pub packet_id: SafeU53,
    pub from: SeatId,
    pub to: SeatId,
    pub connection_generation: ConnectionGeneration,
    pub payload: NetworkPayload,
    pub deliver_at_ms: SafeU53,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FrameCorruption {
    Replace { value: RawFrame },
    DeleteField { json_pointer: String },
    ReplaceField {
        json_pointer: String,
        value: Value,
    },
    MalformedJson { text: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FaultOperation {
    Deliver { packet_id: SafeU53 },
    DeliverNext,
    Drop { packet_id: SafeU53 },
    Duplicate { packet_id: SafeU53 },
    Delay {
        packet_id: SafeU53,
        additional_ms: SafeU53,
    },
    Reorder { packet_ids: Vec<SafeU53> },
    Corrupt {
        packet_id: SafeU53,
        corruption: FrameCorruption,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NetworkEvent {
    Delivered { packet: NetworkPacket },
    Dropped { packet_id: SafeU53 },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaultNetworkDiagnostics {
    pub seed: u64,
    pub queued_packet_ids: BTreeSet<SafeU53>,
    pub disconnected_endpoints: BTreeSet<SeatId>,
    pub suspended_endpoints: BTreeSet<SeatId>,
    pub dropped_count: SafeU53,
    pub duplicated_count: SafeU53,
    pub corrupted_count: SafeU53,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FaultNetworkError {
    #[error("fault network is disposed")]
    Disposed,
    #[error("packet id space is exhausted")]
    PacketIdExhausted,
    #[error("packet {packet_id} is not queued")]
    UnknownPacket { packet_id: SafeU53 },
    #[error("endpoint {endpoint} is disconnected")]
    Disconnected { endpoint: SeatId },
    #[error("connection generation cannot advance")]
    GenerationExhausted,
    #[error("fault operation is invalid: {reason}")]
    InvalidFault { reason: String },
    #[error("packet {packet_id} carries an opaque proposal and cannot be frame-corrupted")]
    PayloadIsNotFrame { packet_id: SafeU53 },
}

#[derive(Debug)]
pub struct FaultNetwork {
    _contract: (),
}

impl FaultNetwork {
    pub fn new(_seed: u64, _endpoints: [SeatId; 2]) -> Self {
        Self { _contract: () }
    }

    pub fn enqueue(
        &mut self,
        _from: SeatId,
        _to: SeatId,
        _connection_generation: ConnectionGeneration,
        _payload: NetworkPayload,
        _now_ms: SafeU53,
    ) -> Result<SafeU53, FaultNetworkError> {
        Err(FaultNetworkError::Disposed)
    }

    pub fn apply(
        &mut self,
        _operation: FaultOperation,
        _now_ms: SafeU53,
    ) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        Err(FaultNetworkError::Disposed)
    }

    pub fn deliver_due(
        &mut self,
        _now_ms: SafeU53,
    ) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        Err(FaultNetworkError::Disposed)
    }

    pub fn disconnect(&mut self, _endpoint: SeatId) -> bool {
        false
    }

    pub fn reconnect(
        &mut self,
        _endpoint: SeatId,
    ) -> Result<ConnectionGeneration, FaultNetworkError> {
        Err(FaultNetworkError::Disposed)
    }

    pub fn suspend(&mut self, _endpoint: SeatId) -> bool {
        false
    }

    pub fn resume(&mut self, _endpoint: SeatId) -> bool {
        false
    }

    pub fn connection_generation(&self, _endpoint: SeatId) -> ConnectionGeneration {
        ConnectionGeneration::ZERO
    }

    pub fn packet(&self, _packet_id: SafeU53) -> Option<&NetworkPacket> {
        None
    }

    pub fn queued_packets(&self) -> Vec<NetworkPacket> {
        Vec::new()
    }

    pub fn diagnostics(&self) -> FaultNetworkDiagnostics {
        FaultNetworkDiagnostics::default()
    }

    pub fn dispose(&mut self) {
    }
}
