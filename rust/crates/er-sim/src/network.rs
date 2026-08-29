//! Seeded deterministic fault network over raw Authority V2 envelopes.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{ConnectionGeneration, NetworkPayload, RawFrame, SafeU53, SeatId};
use serde::{Deserialize, Serialize, de::Error as SerdeDeError, ser::Error as SerdeSerError};
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

pub const FAULT_NETWORK_RNG_ALGORITHM_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FaultNetworkPacketKind {
    AuthorityFrame,
    CommandProposal,
    ReplacementProposal,
    ControlReceipt,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FaultNetworkPacketDisposition {
    Queued,
    Delayed,
    Ready,
}

/// Exact RNG state for the pinned mulberry32 implementation.  `state_bits` is
/// a fixed-width binary representation of the complete u32 state so a bridge
/// can carry it through the frozen string-only snapshot field without loss.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FaultNetworkRngState {
    pub algorithm_version: u32,
    pub state_bits: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FaultNetworkGenerationState {
    pub endpoint: SeatId,
    pub generation: ConnectionGeneration,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FaultNetworkPacketState {
    pub packet: NetworkPacket,
    pub queue_order_id: SafeU53,
    pub enqueued_at_ms: SafeU53,
    pub source_generation: ConnectionGeneration,
    pub destination_generation: ConnectionGeneration,
    pub stale: bool,
    pub kind: FaultNetworkPacketKind,
    pub payload_corrupted: bool,
    pub disposition: FaultNetworkPacketDisposition,
    /// The zero-based rank among explicitly reordered packet identities.
    pub reorder_rank: Option<SafeU53>,
}

/// Complete mechanical state of [`FaultNetwork`]. Packet records are
/// canonicalized by `queue_order_id`; those IDs are relabeled whenever a
/// fault changes vector order, so sorting the records reconstructs the exact
/// owner queue without an extra rank field.
#[derive(Clone, Debug, PartialEq)]
pub struct FaultNetworkState {
    pub seed: u64,
    pub rng: FaultNetworkRngState,
    pub observed_now_ms: SafeU53,
    pub endpoints: [SeatId; 2],
    pub generations: Vec<FaultNetworkGenerationState>,
    pub packets: Vec<FaultNetworkPacketState>,
    pub reordered_packet_ids: Vec<SafeU53>,
    pub next_packet_id: Option<SafeU53>,
    pub next_queue_order_id: Option<SafeU53>,
    pub disconnected: Vec<SeatId>,
    pub suspended: Vec<SeatId>,
    pub dropped_count: SafeU53,
    pub duplicated_count: SafeU53,
    pub corrupted_count: SafeU53,
    pub disposed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FrameCorruption {
    Replace { value: RawFrame },
    DeleteField { json_pointer: String },
    ReplaceField { json_pointer: String, value: Value },
    MalformedJson { text: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FaultOperation {
    Deliver {
        packet_id: SafeU53,
    },
    DeliverNext,
    Drop {
        packet_id: SafeU53,
    },
    Duplicate {
        packet_id: SafeU53,
    },
    Delay {
        packet_id: SafeU53,
        additional_ms: SafeU53,
    },
    Reorder {
        packet_ids: Vec<SafeU53>,
    },
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

/// Public diagnostics are observational state. Counter fields intentionally
/// saturate at `SafeU53::MAX` and never feed back into simulation behavior.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FaultNetworkDiagnostics {
    /// Canonical unsigned decimal representation of the internal `u64` seed.
    pub seed: String,
    pub queued_packet_ids: BTreeSet<SafeU53>,
    pub disconnected_endpoints: BTreeSet<SeatId>,
    pub suspended_endpoints: BTreeSet<SeatId>,
    pub dropped_count: SafeU53,
    pub duplicated_count: SafeU53,
    pub corrupted_count: SafeU53,
    pub disposed: bool,
}

impl Default for FaultNetworkDiagnostics {
    fn default() -> Self {
        Self {
            seed: "0".to_owned(),
            queued_packet_ids: BTreeSet::new(),
            disconnected_endpoints: BTreeSet::new(),
            suspended_endpoints: BTreeSet::new(),
            dropped_count: SafeU53::ZERO,
            duplicated_count: SafeU53::ZERO,
            corrupted_count: SafeU53::ZERO,
            disposed: false,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FaultNetworkDiagnosticsWire {
    seed: String,
    queued_packet_ids: BTreeSet<SafeU53>,
    disconnected_endpoints: BTreeSet<SeatId>,
    suspended_endpoints: BTreeSet<SeatId>,
    dropped_count: SafeU53,
    duplicated_count: SafeU53,
    corrupted_count: SafeU53,
    disposed: bool,
}

impl Serialize for FaultNetworkDiagnostics {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        parse_canonical_seed(&self.seed).map_err(S::Error::custom)?;
        FaultNetworkDiagnosticsWire {
            seed: self.seed.clone(),
            queued_packet_ids: self.queued_packet_ids.clone(),
            disconnected_endpoints: self.disconnected_endpoints.clone(),
            suspended_endpoints: self.suspended_endpoints.clone(),
            dropped_count: self.dropped_count,
            duplicated_count: self.duplicated_count,
            corrupted_count: self.corrupted_count,
            disposed: self.disposed,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for FaultNetworkDiagnostics {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = FaultNetworkDiagnosticsWire::deserialize(deserializer)?;
        parse_canonical_seed(&wire.seed).map_err(D::Error::custom)?;
        Ok(Self {
            seed: wire.seed,
            queued_packet_ids: wire.queued_packet_ids,
            disconnected_endpoints: wire.disconnected_endpoints,
            suspended_endpoints: wire.suspended_endpoints,
            dropped_count: wire.dropped_count,
            duplicated_count: wire.duplicated_count,
            corrupted_count: wire.corrupted_count,
            disposed: wire.disposed,
        })
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FaultNetworkError {
    #[error("fault network is disposed")]
    Disposed,
    #[error("packet id space is exhausted")]
    PacketIdExhausted,
    #[error("queue-order id space is exhausted")]
    QueueOrderExhausted,
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
    #[error("fault network state is invalid: {reason}")]
    InvalidState { reason: String },
}

#[derive(Debug)]
pub struct FaultNetwork {
    seed: u64,
    rng: SeededRng,
    endpoints: [SeatId; 2],
    generations: BTreeMap<SeatId, ConnectionGeneration>,
    queue: Vec<QueuedPacket>,
    reordered_packet_ids: BTreeSet<SafeU53>,
    next_packet_id: u64,
    next_queue_order_id: u64,
    disconnected: BTreeSet<SeatId>,
    suspended: BTreeSet<SeatId>,
    dropped_count: SafeU53,
    duplicated_count: SafeU53,
    corrupted_count: SafeU53,
    disposed: bool,
    last_observed_now_ms: SafeU53,
}

impl FaultNetwork {
    pub fn new(seed: u64, endpoints: [SeatId; 2]) -> Self {
        let mut generations = BTreeMap::new();
        generations.insert(endpoints[0], ConnectionGeneration::ZERO);
        generations.insert(endpoints[1], ConnectionGeneration::ZERO);
        Self {
            seed,
            rng: SeededRng::new(seed),
            endpoints,
            generations,
            queue: Vec::new(),
            reordered_packet_ids: BTreeSet::new(),
            next_packet_id: 0,
            next_queue_order_id: 0,
            disconnected: BTreeSet::new(),
            suspended: BTreeSet::new(),
            dropped_count: SafeU53::ZERO,
            duplicated_count: SafeU53::ZERO,
            corrupted_count: SafeU53::ZERO,
            disposed: false,
            last_observed_now_ms: SafeU53::ZERO,
        }
    }

    /// Export complete causal state without collapsing packet bodies into
    /// diagnostics or deriving queue order from vector positions.
    pub fn export_state(&self) -> FaultNetworkState {
        let reorder_ranks = self
            .queue
            .iter()
            .filter(|packet| self.reordered_packet_ids.contains(&packet.packet.packet_id))
            .enumerate()
            .map(|(rank, packet)| (packet.packet.packet_id, safe_u53_from_usize(rank)))
            .collect::<BTreeMap<_, _>>();

        let mut packets = self
            .queue
            .iter()
            .map(|packet| FaultNetworkPacketState {
                packet: packet.packet.clone(),
                queue_order_id: packet.queue_order_id,
                enqueued_at_ms: packet.enqueued_at_ms,
                source_generation: packet.source_generation,
                destination_generation: packet.destination_generation,
                stale: packet.stale,
                kind: packet.kind,
                payload_corrupted: packet.payload_corrupted,
                disposition: packet.disposition,
                reorder_rank: reorder_ranks.get(&packet.packet.packet_id).copied(),
            })
            .collect::<Vec<_>>();
        packets.sort_by_key(|packet| packet.queue_order_id);

        FaultNetworkState {
            seed: self.seed,
            rng: self.rng.export_state(),
            observed_now_ms: self.last_observed_now_ms,
            endpoints: self.endpoints,
            generations: self
                .generations
                .iter()
                .map(|(endpoint, generation)| FaultNetworkGenerationState {
                    endpoint: *endpoint,
                    generation: *generation,
                })
                .collect(),
            packets,
            reordered_packet_ids: self.reordered_packet_ids.iter().copied().collect(),
            next_packet_id: allocator_state(self.next_packet_id),
            next_queue_order_id: allocator_state(self.next_queue_order_id),
            disconnected: self.disconnected.iter().copied().collect(),
            suspended: self.suspended.iter().copied().collect(),
            dropped_count: self.dropped_count,
            duplicated_count: self.duplicated_count,
            corrupted_count: self.corrupted_count,
            disposed: self.disposed,
        }
    }

    pub fn restorable_state(&self) -> FaultNetworkState {
        self.export_state()
    }

    /// Construct a fresh network only after validating every allocator,
    /// endpoint, packet, generation, reorder, and RNG field.
    pub fn from_state(state: FaultNetworkState) -> Result<Self, FaultNetworkError> {
        state.validate()?;

        let generations = state
            .generations
            .into_iter()
            .map(|entry| (entry.endpoint, entry.generation))
            .collect();
        let queue = state
            .packets
            .into_iter()
            .map(|packet| QueuedPacket {
                packet: packet.packet,
                queue_order_id: packet.queue_order_id,
                enqueued_at_ms: packet.enqueued_at_ms,
                source_generation: packet.source_generation,
                destination_generation: packet.destination_generation,
                stale: packet.stale,
                kind: packet.kind,
                payload_corrupted: packet.payload_corrupted,
                disposition: packet.disposition,
            })
            .collect();
        let reordered_packet_ids = state.reordered_packet_ids.into_iter().collect();

        Ok(Self {
            seed: state.seed,
            rng: SeededRng::from_state(state.rng)?,
            last_observed_now_ms: state.observed_now_ms,
            endpoints: state.endpoints,
            generations,
            queue,
            reordered_packet_ids,
            next_packet_id: allocator_value(state.next_packet_id),
            next_queue_order_id: allocator_value(state.next_queue_order_id),
            disconnected: state.disconnected.into_iter().collect(),
            suspended: state.suspended.into_iter().collect(),
            dropped_count: state.dropped_count,
            duplicated_count: state.duplicated_count,
            corrupted_count: state.corrupted_count,
            disposed: state.disposed,
        })
    }

    pub fn from_restorable_state(state: FaultNetworkState) -> Result<Self, FaultNetworkError> {
        Self::from_state(state)
    }

    /// Replace an owner atomically through a fresh validated construction.
    pub fn restore_state(&mut self, state: FaultNetworkState) -> Result<(), FaultNetworkError> {
        let restored = Self::from_state(state)?;
        *self = restored;
        Ok(())
    }

    pub fn enqueue(
        &mut self,
        from: SeatId,
        to: SeatId,
        connection_generation: ConnectionGeneration,
        payload: NetworkPayload,
        now_ms: SafeU53,
    ) -> Result<SafeU53, FaultNetworkError> {
        self.ensure_live()?;
        self.ensure_endpoint(from, "from")?;
        self.ensure_endpoint(to, "to")?;
        if self.disconnected.contains(&from) {
            return Err(FaultNetworkError::Disconnected { endpoint: from });
        }
        if self.disconnected.contains(&to) {
            return Err(FaultNetworkError::Disconnected { endpoint: to });
        }

        let effective_now_ms = now_ms.max(self.last_observed_now_ms);
        let source_generation = self.connection_generation(from);
        let destination_generation = self.connection_generation(to);
        let (kind, payload_corrupted) = classify_payload(&payload);
        let (deliver_at_ms, next_rng) = self.next_delivery_time(effective_now_ms)?;
        let (packet_id, queue_order_id, next_packet_id, next_queue_order_id) =
            self.peek_packet_and_queue_ids()?;
        self.queue.push(QueuedPacket {
            packet: NetworkPacket {
                packet_id,
                from,
                to,
                connection_generation,
                payload,
                deliver_at_ms,
            },
            queue_order_id,
            enqueued_at_ms: effective_now_ms,
            source_generation,
            destination_generation,
            // Retain an explicitly stale send for deterministic drop/reap behavior, but never
            // allow it to cross either endpoint's current incarnation boundary.
            stale: connection_generation != source_generation
                || connection_generation != destination_generation,
            kind,
            payload_corrupted,
            disposition: if deliver_at_ms <= effective_now_ms {
                FaultNetworkPacketDisposition::Ready
            } else {
                FaultNetworkPacketDisposition::Queued
            },
        });
        self.rng = next_rng;
        self.next_packet_id = next_packet_id;
        self.next_queue_order_id = next_queue_order_id;
        self.observe_now(effective_now_ms);
        Ok(packet_id)
    }

    pub fn apply(
        &mut self,
        operation: FaultOperation,
        now_ms: SafeU53,
    ) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        self.ensure_live()?;
        let events = match operation {
            FaultOperation::Deliver { packet_id } => self.deliver_packet(packet_id),
            FaultOperation::DeliverNext => {
                match self.queue.first().map(|queued| queued.packet.packet_id) {
                    Some(packet_id) => self.deliver_packet(packet_id),
                    None => Ok(Vec::new()),
                }
            }
            FaultOperation::Drop { packet_id } => self.drop_packet(packet_id),
            FaultOperation::Duplicate { packet_id } => {
                self.duplicate_packet(packet_id)?;
                Ok(Vec::new())
            }
            FaultOperation::Delay {
                packet_id,
                additional_ms,
            } => {
                self.delay_packet(packet_id, additional_ms)?;
                Ok(Vec::new())
            }
            FaultOperation::Reorder { packet_ids } => {
                self.reorder_packets(packet_ids)?;
                Ok(Vec::new())
            }
            FaultOperation::Corrupt {
                packet_id,
                corruption,
            } => {
                self.corrupt_packet(packet_id, corruption)?;
                Ok(Vec::new())
            }
        }?;
        self.observe_now(now_ms);
        Ok(events)
    }

    pub fn deliver_due(&mut self, now_ms: SafeU53) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        self.ensure_live()?;
        self.observe_now(now_ms);
        let now_ms = self.last_observed_now_ms;
        let mut events = self.reap_stale_packets();
        while let Some(index) = self.next_reordered_due_index(now_ms) {
            let packet_id = self.queue[index].packet.packet_id;
            events.extend(self.deliver_packet(packet_id)?);
        }
        while let Some(index) = self.next_due_index(now_ms) {
            let packet_id = self.queue[index].packet.packet_id;
            events.extend(self.deliver_packet(packet_id)?);
        }
        Ok(events)
    }

    pub fn disconnect(&mut self, endpoint: SeatId) -> bool {
        if self.disposed || !self.is_endpoint(endpoint) || !self.disconnected.insert(endpoint) {
            return false;
        }
        for queued in &mut self.queue {
            if queued.packet.from == endpoint || queued.packet.to == endpoint {
                queued.stale = true;
            }
        }
        true
    }

    pub fn reconnect(
        &mut self,
        endpoint: SeatId,
    ) -> Result<ConnectionGeneration, FaultNetworkError> {
        self.ensure_live()?;
        self.ensure_endpoint(endpoint, "endpoint")?;
        let current = self.connection_generation(endpoint);
        let current_value = current.get().get();
        let next_value = current_value
            .checked_add(1)
            .ok_or(FaultNetworkError::GenerationExhausted)?;
        let next = ConnectionGeneration::new(
            SafeU53::new(next_value).map_err(|_| FaultNetworkError::GenerationExhausted)?,
        );
        for queued in &mut self.queue {
            if queued.packet.from == endpoint || queued.packet.to == endpoint {
                queued.stale = true;
            }
        }
        self.generations.insert(self.endpoints[0], next);
        self.generations.insert(self.endpoints[1], next);
        self.disconnected.remove(&endpoint);
        Ok(next)
    }

    pub fn suspend(&mut self, endpoint: SeatId) -> bool {
        if self.disposed || !self.is_endpoint(endpoint) {
            return false;
        }
        self.suspended.insert(endpoint)
    }

    pub fn resume(&mut self, endpoint: SeatId) -> bool {
        if self.disposed || !self.is_endpoint(endpoint) {
            return false;
        }
        self.suspended.remove(&endpoint)
    }

    pub fn connection_generation(&self, endpoint: SeatId) -> ConnectionGeneration {
        match self.generations.get(&endpoint).copied() {
            Some(generation) => generation,
            None => ConnectionGeneration::ZERO,
        }
    }

    pub fn packet(&self, packet_id: SafeU53) -> Option<&NetworkPacket> {
        self.queue
            .iter()
            .find(|queued| queued.packet.packet_id == packet_id)
            .map(|queued| &queued.packet)
    }

    pub fn packet_kind(&self, packet_id: SafeU53) -> Option<FaultNetworkPacketKind> {
        self.queue
            .iter()
            .find(|queued| queued.packet.packet_id == packet_id)
            .map(|queued| queued.kind)
    }

    pub fn packet_disposition(&self, packet_id: SafeU53) -> Option<FaultNetworkPacketDisposition> {
        self.queue
            .iter()
            .find(|queued| queued.packet.packet_id == packet_id)
            .map(|queued| queued.disposition)
    }

    pub fn queued_packets(&self) -> Vec<NetworkPacket> {
        self.queue
            .iter()
            .map(|queued| queued.packet.clone())
            .collect()
    }

    pub fn diagnostics(&self) -> FaultNetworkDiagnostics {
        FaultNetworkDiagnostics {
            seed: self.seed.to_string(),
            queued_packet_ids: self
                .queue
                .iter()
                .map(|queued| queued.packet.packet_id)
                .collect(),
            disconnected_endpoints: self.disconnected.clone(),
            suspended_endpoints: self.suspended.clone(),
            dropped_count: self.dropped_count,
            duplicated_count: self.duplicated_count,
            corrupted_count: self.corrupted_count,
            disposed: self.disposed,
        }
    }

    pub fn dispose(&mut self) {
        if self.disposed {
            return;
        }
        self.queue.clear();
        self.reordered_packet_ids.clear();
        self.disconnected.clear();
        self.suspended.clear();
        self.disposed = true;
    }

    fn ensure_live(&self) -> Result<(), FaultNetworkError> {
        if self.disposed {
            Err(FaultNetworkError::Disposed)
        } else {
            Ok(())
        }
    }

    fn ensure_endpoint(&self, endpoint: SeatId, label: &str) -> Result<(), FaultNetworkError> {
        if self.is_endpoint(endpoint) {
            Ok(())
        } else {
            Err(FaultNetworkError::InvalidFault {
                reason: format!("{label} endpoint {endpoint} is not configured"),
            })
        }
    }

    fn is_endpoint(&self, endpoint: SeatId) -> bool {
        self.endpoints.contains(&endpoint)
    }

    fn observe_now(&mut self, now_ms: SafeU53) {
        if now_ms > self.last_observed_now_ms {
            self.last_observed_now_ms = now_ms;
        }
        for queued in &mut self.queue {
            if queued.packet.deliver_at_ms <= self.last_observed_now_ms {
                queued.disposition = FaultNetworkPacketDisposition::Ready;
            }
        }
    }

    fn peek_packet_and_queue_ids(&self) -> Result<(SafeU53, SafeU53, u64, u64), FaultNetworkError> {
        let (packet_id, next_packet_id) = self.peek_packet_id()?;
        let queue_order_id = SafeU53::new(self.next_queue_order_id)
            .map_err(|_| FaultNetworkError::QueueOrderExhausted)?;
        let next_queue_order_id = self
            .next_queue_order_id
            .checked_add(1)
            .ok_or(FaultNetworkError::QueueOrderExhausted)?;
        Ok((
            packet_id,
            queue_order_id,
            next_packet_id,
            next_queue_order_id,
        ))
    }

    fn peek_packet_id(&self) -> Result<(SafeU53, u64), FaultNetworkError> {
        let packet_id =
            SafeU53::new(self.next_packet_id).map_err(|_| FaultNetworkError::PacketIdExhausted)?;
        let next_packet_id = self
            .next_packet_id
            .checked_add(1)
            .ok_or(FaultNetworkError::PacketIdExhausted)?;
        Ok((packet_id, next_packet_id))
    }

    fn next_delivery_time(
        &self,
        now_ms: SafeU53,
    ) -> Result<(SafeU53, SeededRng), FaultNetworkError> {
        let mut next_rng = self.rng.clone();
        // This is oracle `int(1, 5)`: floor((u32 / 2^32) * 5) + 1. Integer
        // arithmetic preserves the exact boundary behavior without a float.
        let delay_ms = next_rng.next_int_inclusive(1, 5);
        let deliver_at =
            now_ms
                .get()
                .checked_add(delay_ms)
                .ok_or_else(|| FaultNetworkError::InvalidFault {
                    reason: "packet delivery time exceeds SafeU53".to_owned(),
                })?;
        let deliver_at_ms =
            SafeU53::new(deliver_at).map_err(|_| FaultNetworkError::InvalidFault {
                reason: "packet delivery time exceeds SafeU53".to_owned(),
            })?;
        Ok((deliver_at_ms, next_rng))
    }

    fn packet_index(&self, packet_id: SafeU53) -> Result<usize, FaultNetworkError> {
        self.queue
            .iter()
            .position(|queued| queued.packet.packet_id == packet_id)
            .ok_or(FaultNetworkError::UnknownPacket { packet_id })
    }

    fn deliver_packet(
        &mut self,
        packet_id: SafeU53,
    ) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        let index = self.packet_index(packet_id)?;
        let queued = self.queue.remove(index);
        self.reordered_packet_ids.remove(&packet_id);
        if self.packet_is_stale(&queued) {
            increment_diagnostic_counter(&mut self.dropped_count);
            Ok(vec![NetworkEvent::Dropped { packet_id }])
        } else {
            Ok(vec![NetworkEvent::Delivered {
                packet: queued.packet,
            }])
        }
    }

    fn drop_packet(&mut self, packet_id: SafeU53) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        let index = self.packet_index(packet_id)?;
        self.queue.remove(index);
        self.reordered_packet_ids.remove(&packet_id);
        increment_diagnostic_counter(&mut self.dropped_count);
        Ok(vec![NetworkEvent::Dropped { packet_id }])
    }

    fn duplicate_packet(&mut self, packet_id: SafeU53) -> Result<(), FaultNetworkError> {
        let index = self.packet_index(packet_id)?;
        let (duplicate_id, next_packet_id) = self.peek_packet_id()?;
        let mut queue = self.queue.clone();
        let mut duplicate = queue[index].clone();
        duplicate.packet.packet_id = duplicate_id;
        queue.insert(index + 1, duplicate);
        let next_queue_order_id = relabel_queue_order_ids(&mut queue, self.next_queue_order_id)?;
        self.queue = queue;
        self.next_packet_id = next_packet_id;
        self.next_queue_order_id = next_queue_order_id;
        increment_diagnostic_counter(&mut self.duplicated_count);
        Ok(())
    }

    fn delay_packet(
        &mut self,
        packet_id: SafeU53,
        additional_ms: SafeU53,
    ) -> Result<(), FaultNetworkError> {
        let index = self.packet_index(packet_id)?;
        let current = self.queue[index].packet.deliver_at_ms;
        let deliver_at = current
            .get()
            .checked_add(additional_ms.get())
            .ok_or_else(|| FaultNetworkError::InvalidFault {
                reason: "packet delay exceeds SafeU53".to_owned(),
            })?;
        self.queue[index].packet.deliver_at_ms =
            SafeU53::new(deliver_at).map_err(|_| FaultNetworkError::InvalidFault {
                reason: "packet delay exceeds SafeU53".to_owned(),
            })?;
        self.queue[index].disposition =
            if self.queue[index].packet.deliver_at_ms <= self.last_observed_now_ms {
                FaultNetworkPacketDisposition::Ready
            } else {
                FaultNetworkPacketDisposition::Delayed
            };
        Ok(())
    }

    fn reorder_packets(&mut self, packet_ids: Vec<SafeU53>) -> Result<(), FaultNetworkError> {
        let mut seen = BTreeSet::new();
        for packet_id in &packet_ids {
            if !seen.insert(*packet_id) {
                return Err(FaultNetworkError::InvalidFault {
                    reason: format!("packet {packet_id} appears more than once in reorder"),
                });
            }
            self.packet_index(*packet_id)?;
        }

        if packet_ids.is_empty() {
            return Ok(());
        }

        let mut reordered = Vec::with_capacity(self.queue.len());
        for packet_id in &packet_ids {
            let packet = self
                .queue
                .iter()
                .find(|queued| queued.packet.packet_id == *packet_id)
                .cloned()
                .ok_or(FaultNetworkError::UnknownPacket {
                    packet_id: *packet_id,
                })?;
            reordered.push(packet);
        }
        reordered.extend(
            self.queue
                .iter()
                .filter(|queued| !seen.contains(&queued.packet.packet_id))
                .cloned(),
        );
        let next_queue_order_id =
            relabel_queue_order_ids(&mut reordered, self.next_queue_order_id)?;
        self.queue = reordered;
        self.next_queue_order_id = next_queue_order_id;
        self.reordered_packet_ids = seen;
        Ok(())
    }

    fn reap_stale_packets(&mut self) -> Vec<NetworkEvent> {
        let mut events = Vec::new();
        let mut index = 0;
        while index < self.queue.len() {
            if self.packet_is_stale(&self.queue[index]) {
                let queued = self.queue.remove(index);
                self.reordered_packet_ids.remove(&queued.packet.packet_id);
                increment_diagnostic_counter(&mut self.dropped_count);
                events.push(NetworkEvent::Dropped {
                    packet_id: queued.packet.packet_id,
                });
            } else {
                index += 1;
            }
        }
        events
    }

    fn packet_is_stale(&self, queued: &QueuedPacket) -> bool {
        let source_generation = self.connection_generation(queued.packet.from);
        let destination_generation = self.connection_generation(queued.packet.to);
        queued.stale
            || self.disconnected.contains(&queued.packet.from)
            || self.disconnected.contains(&queued.packet.to)
            || queued.source_generation != source_generation
            || queued.destination_generation != destination_generation
            || queued.packet.connection_generation != source_generation
            || queued.packet.connection_generation != destination_generation
    }

    fn next_reordered_due_index(&self, now_ms: SafeU53) -> Option<usize> {
        self.queue.iter().enumerate().find_map(|(index, queued)| {
            (self.reordered_packet_ids.contains(&queued.packet.packet_id)
                && queued.packet.deliver_at_ms <= now_ms)
                .then_some(index)
        })
    }

    fn next_due_index(&self, now_ms: SafeU53) -> Option<usize> {
        self.queue
            .iter()
            .enumerate()
            .filter(|(_, queued)| queued.packet.deliver_at_ms <= now_ms)
            .min_by_key(|(index, queued)| {
                // Equal deadlines retain the scheduled queue order. In particular, a duplicate
                // inserted immediately after its source remains adjacent unless an explicit reorder
                // fault changes the queue.
                (queued.packet.deliver_at_ms, *index, queued.packet.packet_id)
            })
            .map(|(index, _)| index)
    }

    fn corrupt_packet(
        &mut self,
        packet_id: SafeU53,
        corruption: FrameCorruption,
    ) -> Result<(), FaultNetworkError> {
        let index = self.packet_index(packet_id)?;
        {
            let payload = &mut self.queue[index].packet.payload;
            let NetworkPayload::Frame(raw) = payload else {
                return Err(FaultNetworkError::PayloadIsNotFrame { packet_id });
            };
            corrupt_raw_frame(raw, corruption)
                .map_err(|reason| FaultNetworkError::InvalidFault { reason })?;
        }
        let expected_kind = self.queue[index].kind;
        self.queue[index].payload_corrupted =
            classify_payload_strict(&self.queue[index].packet.payload) != Ok(expected_kind);
        increment_diagnostic_counter(&mut self.corrupted_count);
        Ok(())
    }
}

impl FaultNetworkState {
    pub fn validate(&self) -> Result<(), FaultNetworkError> {
        if self.endpoints[0] == self.endpoints[1] {
            return Err(FaultNetworkError::InvalidState {
                reason: "network endpoints must be distinct".to_owned(),
            });
        }
        self.rng.validate()?;

        if self.generations.len() != 2
            || self
                .generations
                .windows(2)
                .any(|pair| pair[0].endpoint >= pair[1].endpoint)
            || self
                .generations
                .iter()
                .map(|entry| entry.endpoint)
                .any(|endpoint| !self.endpoints.contains(&endpoint))
        {
            return Err(FaultNetworkError::InvalidState {
                reason: "generations must contain both configured endpoints in sorted order"
                    .to_owned(),
            });
        }
        if self
            .generations
            .iter()
            .map(|entry| entry.endpoint)
            .collect::<Vec<_>>()
            != sorted_endpoints(self.endpoints)
        {
            return Err(FaultNetworkError::InvalidState {
                reason: "generation endpoint identities do not match configured order".to_owned(),
            });
        }

        if self.disconnected.windows(2).any(|pair| pair[0] >= pair[1])
            || self.suspended.windows(2).any(|pair| pair[0] >= pair[1])
            || self
                .disconnected
                .iter()
                .chain(self.suspended.iter())
                .any(|endpoint| !self.endpoints.contains(endpoint))
        {
            return Err(FaultNetworkError::InvalidState {
                reason: "connection sets must be sorted and contain only configured endpoints"
                    .to_owned(),
            });
        }

        if self
            .reordered_packet_ids
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        {
            return Err(FaultNetworkError::InvalidState {
                reason: "reordered packet identities must be strictly sorted and unique".to_owned(),
            });
        }

        let generations = self
            .generations
            .iter()
            .map(|entry| (entry.endpoint, entry.generation))
            .collect::<BTreeMap<_, _>>();
        let reordered = self
            .reordered_packet_ids
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        let mut packet_ids = BTreeSet::new();
        let mut queue_order_ids = BTreeSet::new();
        let mut seen_reorder_ids = BTreeSet::new();
        let mut expected_reorder_rank = 0_u64;
        let mut previous_queue_order_id = None;
        for queued in &self.packets {
            let packet_id = queued.packet.packet_id;
            if !packet_ids.insert(packet_id) {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("packet ID {packet_id} is duplicated"),
                });
            }
            if !queue_order_ids.insert(queued.queue_order_id) {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("queue-order ID {} is duplicated", queued.queue_order_id),
                });
            }
            if previous_queue_order_id.is_some_and(|previous| previous >= queued.queue_order_id) {
                return Err(FaultNetworkError::InvalidState {
                    reason: "packets must be strictly sorted by queue-order ID".to_owned(),
                });
            }
            previous_queue_order_id = Some(queued.queue_order_id);
            if !self.endpoints.contains(&queued.packet.from)
                || !self.endpoints.contains(&queued.packet.to)
            {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("packet {packet_id} references an unknown endpoint"),
                });
            }
            if queued.packet.deliver_at_ms < queued.enqueued_at_ms {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("packet {packet_id} deadline precedes enqueue time"),
                });
            }
            if queued.enqueued_at_ms > self.observed_now_ms {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("packet {packet_id} was enqueued after the observed clock"),
                });
            }

            let expected_stale = self.disconnected.contains(&queued.packet.from)
                || self.disconnected.contains(&queued.packet.to)
                || generations.get(&queued.packet.from).copied() != Some(queued.source_generation)
                || generations.get(&queued.packet.to).copied()
                    != Some(queued.destination_generation)
                || Some(queued.packet.connection_generation)
                    != generations.get(&queued.packet.from).copied()
                || Some(queued.packet.connection_generation)
                    != generations.get(&queued.packet.to).copied();
            if queued.stale != expected_stale {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("packet {packet_id} has an inconsistent stale flag"),
                });
            }

            let family_matches = matches!(
                (&queued.kind, &queued.packet.payload),
                (
                    FaultNetworkPacketKind::AuthorityFrame | FaultNetworkPacketKind::ControlReceipt,
                    NetworkPayload::Frame(_)
                ) | (
                    FaultNetworkPacketKind::CommandProposal
                        | FaultNetworkPacketKind::ReplacementProposal,
                    NetworkPayload::Proposal(_)
                )
            );
            if !family_matches {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("packet {packet_id} has an inconsistent kind family"),
                });
            }
            let expected_payload_corrupted =
                classify_payload_strict(&queued.packet.payload) != Ok(queued.kind);
            if queued.payload_corrupted != expected_payload_corrupted {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!(
                        "packet {packet_id} has an inconsistent payload-corruption marker"
                    ),
                });
            }
            let due = queued.packet.deliver_at_ms <= self.observed_now_ms;
            if due != (queued.disposition == FaultNetworkPacketDisposition::Ready) {
                return Err(FaultNetworkError::InvalidState {
                    reason: format!("packet {packet_id} has an inconsistent disposition"),
                });
            }

            match (reordered.contains(&packet_id), queued.reorder_rank) {
                (true, Some(rank)) => {
                    if rank.get() != expected_reorder_rank || !seen_reorder_ids.insert(packet_id) {
                        return Err(FaultNetworkError::InvalidState {
                            reason: format!("packet {packet_id} has an inconsistent reorder rank"),
                        });
                    }
                    expected_reorder_rank = expected_reorder_rank.saturating_add(1);
                }
                (false, None) => {}
                _ => {
                    return Err(FaultNetworkError::InvalidState {
                        reason: format!("packet {packet_id} has an inconsistent reorder identity"),
                    });
                }
            }
        }
        if seen_reorder_ids != reordered {
            return Err(FaultNetworkError::InvalidState {
                reason: "reordered identities must refer to queued packets".to_owned(),
            });
        }
        let reorder_len =
            u64::try_from(reordered.len()).map_err(|_| FaultNetworkError::InvalidState {
                reason: "reorder identity count exceeds u64".to_owned(),
            })?;
        if expected_reorder_rank != reorder_len {
            return Err(FaultNetworkError::InvalidState {
                reason: "reorder ranks must cover exactly the explicitly held packets".to_owned(),
            });
        }

        if self.packets.iter().any(|packet| {
            !allocator_contains(self.next_packet_id, packet.packet.packet_id)
                || !allocator_contains(self.next_queue_order_id, packet.queue_order_id)
        }) {
            return Err(FaultNetworkError::InvalidState {
                reason: "allocators must be above every queued packet and queue-order ID"
                    .to_owned(),
            });
        }
        if self.disposed
            && (!self.packets.is_empty()
                || !self.reordered_packet_ids.is_empty()
                || !self.disconnected.is_empty()
                || !self.suspended.is_empty())
        {
            return Err(FaultNetworkError::InvalidState {
                reason: "disposed network cannot retain queue or connection state".to_owned(),
            });
        }
        Ok(())
    }
}

impl FaultNetworkRngState {
    pub fn validate(&self) -> Result<(), FaultNetworkError> {
        if self.algorithm_version != FAULT_NETWORK_RNG_ALGORITHM_VERSION {
            return Err(FaultNetworkError::InvalidState {
                reason: format!(
                    "unsupported RNG algorithm version {}; expected {}",
                    self.algorithm_version, FAULT_NETWORK_RNG_ALGORITHM_VERSION
                ),
            });
        }
        if self.state_bits.len() != 32
            || !self
                .state_bits
                .bytes()
                .all(|bit| matches!(bit, b'0' | b'1'))
        {
            return Err(FaultNetworkError::InvalidState {
                reason: "RNG state_bits must be exactly 32 binary bits".to_owned(),
            });
        }
        Ok(())
    }
}

fn sorted_endpoints(endpoints: [SeatId; 2]) -> Vec<SeatId> {
    let mut sorted = endpoints.to_vec();
    sorted.sort_unstable();
    sorted
}

fn allocator_contains(next: Option<SafeU53>, allocated: SafeU53) -> bool {
    next.is_none_or(|next| allocated < next)
}

fn allocator_state(next: u64) -> Option<SafeU53> {
    (next <= SafeU53::MAX.get())
        .then(|| SafeU53::new(next).expect("checked SafeU53 allocator value"))
}

fn allocator_value(next: Option<SafeU53>) -> u64 {
    next.map_or(SafeU53::MAX.get().saturating_add(1), |next| next.get())
}

fn safe_u53_from_usize(value: usize) -> SafeU53 {
    let value = u64::try_from(value).expect("queue length must fit u64");
    SafeU53::new(value).expect("queue reorder rank must fit SafeU53")
}

/// Assign a fresh, strictly increasing queue-order range to the already
/// staged delivery vector. All IDs are allocated before any packet is
/// touched, so exhaustion leaves the owner byte-for-byte unchanged.
fn relabel_queue_order_ids(
    queue: &mut [QueuedPacket],
    next_queue_order_id: u64,
) -> Result<u64, FaultNetworkError> {
    let mut ids = Vec::with_capacity(queue.len());
    let mut next = next_queue_order_id;
    for _ in queue.iter() {
        ids.push(SafeU53::new(next).map_err(|_| FaultNetworkError::QueueOrderExhausted)?);
        next = next
            .checked_add(1)
            .ok_or(FaultNetworkError::QueueOrderExhausted)?;
    }
    for (queued, queue_order_id) in queue.iter_mut().zip(ids) {
        queued.queue_order_id = queue_order_id;
    }
    Ok(next)
}

#[derive(Clone, Debug, PartialEq)]
struct QueuedPacket {
    packet: NetworkPacket,
    queue_order_id: SafeU53,
    enqueued_at_ms: SafeU53,
    source_generation: ConnectionGeneration,
    destination_generation: ConnectionGeneration,
    stale: bool,
    kind: FaultNetworkPacketKind,
    payload_corrupted: bool,
    disposition: FaultNetworkPacketDisposition,
}

#[derive(Clone, Debug)]
struct SeededRng {
    state: u32,
}

impl SeededRng {
    fn new(seed: u64) -> Self {
        Self { state: seed as u32 }
    }

    fn export_state(&self) -> FaultNetworkRngState {
        FaultNetworkRngState {
            algorithm_version: FAULT_NETWORK_RNG_ALGORITHM_VERSION,
            state_bits: format!("{:032b}", self.state),
        }
    }

    fn from_state(state: FaultNetworkRngState) -> Result<Self, FaultNetworkError> {
        state.validate()?;
        let parsed = u32::from_str_radix(&state.state_bits, 2).map_err(|_| {
            FaultNetworkError::InvalidState {
                reason: "RNG state_bits could not be parsed as u32".to_owned(),
            }
        })?;
        Ok(Self { state: parsed })
    }

    fn next_u32(&mut self) -> u32 {
        // Exact oracle makeRng/mulberry32 semantics. Every intermediate stays
        // in the JavaScript bitwise 32-bit domain (`| 0`, Math.imul, `>>> 0`).
        let a = self.state.wrapping_add(0x6d2b_79f5);
        self.state = a;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t));
        t ^ (t >> 14)
    }

    fn next_int_inclusive(&mut self, min: u64, max: u64) -> u64 {
        let span = max - min + 1;
        min + (u64::from(self.next_u32()) * span) / 4_294_967_296
    }
}

fn parse_canonical_seed(seed: &str) -> Result<u64, String> {
    if seed.is_empty() {
        return Err("seed must be a canonical unsigned decimal string".to_owned());
    }
    if seed.len() > 1 && seed.starts_with('0') {
        return Err("seed must not contain redundant leading zeroes".to_owned());
    }
    if !seed.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("seed must be a canonical unsigned decimal string".to_owned());
    }
    let value = seed
        .parse::<u64>()
        .map_err(|_| "seed is outside the u64 range".to_owned())?;
    if value.to_string() != seed {
        return Err("seed must be a canonical unsigned decimal string".to_owned());
    }
    Ok(value)
}

// Diagnostic-only mutation: saturation is intentional, and this helper has no
// access to RNG, cursors, queues, reorder markers, delivery, connections, or
// error results. Its unit return keeps the count observational by construction.
fn increment_diagnostic_counter(counter: &mut SafeU53) {
    let next = counter.get().saturating_add(1);
    if next > SafeU53::MAX.get() {
        return;
    }
    let Ok(value) = SafeU53::new(next) else {
        return;
    };
    *counter = value;
}

fn corrupt_raw_frame(raw: &mut RawFrame, corruption: FrameCorruption) -> Result<(), String> {
    match corruption {
        FrameCorruption::Replace { value } => {
            *raw = value;
            Ok(())
        }
        FrameCorruption::MalformedJson { text } => {
            *raw = RawFrame::JsonText(text);
            Ok(())
        }
        FrameCorruption::DeleteField { json_pointer } => {
            let mut value = parse_raw_frame(raw)?;
            delete_json_pointer(&mut value, &json_pointer)?;
            *raw = encode_raw_frame(raw, value)?;
            Ok(())
        }
        FrameCorruption::ReplaceField {
            json_pointer,
            value: replacement,
        } => {
            let mut value = parse_raw_frame(raw)?;
            let Some(target) = value.pointer_mut(&json_pointer) else {
                return Err(format!(
                    "JSON pointer {json_pointer} does not identify a field"
                ));
            };
            *target = replacement;
            *raw = encode_raw_frame(raw, value)?;
            Ok(())
        }
    }
}

fn parse_raw_frame(raw: &RawFrame) -> Result<serde_json::Value, String> {
    match raw {
        RawFrame::JsonText(text) => serde_json::from_str(text)
            .map_err(|error| format!("raw frame is not valid JSON: {error}")),
        RawFrame::JsonValue(value) => Ok(value.clone()),
    }
}

fn classify_payload(payload: &NetworkPayload) -> (FaultNetworkPacketKind, bool) {
    match classify_payload_strict(payload) {
        Ok(kind) => (kind, false),
        Err(_) => (FaultNetworkPacketKind::AuthorityFrame, true),
    }
}

fn classify_payload_strict(payload: &NetworkPayload) -> Result<FaultNetworkPacketKind, String> {
    match payload {
        NetworkPayload::Proposal(proposal) => {
            if proposal.fingerprint.starts_with("brp1-") {
                Ok(FaultNetworkPacketKind::ReplacementProposal)
            } else {
                Ok(FaultNetworkPacketKind::CommandProposal)
            }
        }
        NetworkPayload::Frame(raw) => {
            let value = parse_raw_frame(raw)?;
            let kind = match value.get("t").and_then(Value::as_str) {
                Some("authorityReceipt") => FaultNetworkPacketKind::ControlReceipt,
                _ => FaultNetworkPacketKind::AuthorityFrame,
            };
            Ok(kind)
        }
    }
}

fn encode_raw_frame(raw: &RawFrame, value: serde_json::Value) -> Result<RawFrame, String> {
    match raw {
        RawFrame::JsonText(_) => serde_json::to_string(&value)
            .map(RawFrame::JsonText)
            .map_err(|error| format!("corrupted frame cannot be encoded as JSON text: {error}")),
        RawFrame::JsonValue(_) => Ok(RawFrame::JsonValue(value)),
    }
}

fn delete_json_pointer(root: &mut serde_json::Value, pointer: &str) -> Result<(), String> {
    if pointer.is_empty() {
        return Err("cannot delete the JSON document root".to_owned());
    }
    let Some(separator) = pointer.rfind('/') else {
        return Err(format!("invalid JSON pointer {pointer}"));
    };
    let parent_pointer = &pointer[..separator];
    let token = decode_pointer_token(&pointer[separator + 1..])?;
    let Some(parent) = root.pointer_mut(parent_pointer) else {
        return Err(format!("JSON pointer {pointer} does not identify a field"));
    };
    match parent {
        serde_json::Value::Object(fields) => {
            if fields.remove(&token).is_none() {
                return Err(format!("JSON pointer {pointer} does not identify a field"));
            }
        }
        serde_json::Value::Array(items) => {
            let index = parse_array_index(&token, pointer)?;
            if index >= items.len() {
                return Err(format!("JSON pointer {pointer} does not identify a field"));
            }
            items.remove(index);
        }
        _ => {
            return Err(format!("JSON pointer {pointer} does not identify a field"));
        }
    }
    Ok(())
}

fn decode_pointer_token(token: &str) -> Result<String, String> {
    let mut decoded = String::with_capacity(token.len());
    let mut characters = token.chars();
    while let Some(character) = characters.next() {
        if character != '~' {
            decoded.push(character);
            continue;
        }
        let Some(escape) = characters.next() else {
            return Err(format!("invalid JSON pointer escape in {token}"));
        };
        match escape {
            '0' => decoded.push('~'),
            '1' => decoded.push('/'),
            _ => return Err(format!("invalid JSON pointer escape in {token}")),
        }
    }
    Ok(decoded)
}

fn parse_array_index(token: &str, pointer: &str) -> Result<usize, String> {
    if token.is_empty() || (token.len() > 1 && token.starts_with('0')) {
        return Err(format!("JSON pointer {pointer} has an invalid array index"));
    }
    token
        .parse::<usize>()
        .map_err(|_| format!("JSON pointer {pointer} has an invalid array index"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, PartialEq)]
    struct MechanicalState {
        rng_state: u32,
        endpoints: [SeatId; 2],
        generations: BTreeMap<SeatId, ConnectionGeneration>,
        queue: Vec<QueuedPacket>,
        reordered_packet_ids: BTreeSet<SafeU53>,
        next_packet_id: u64,
        disconnected: BTreeSet<SeatId>,
        suspended: BTreeSet<SeatId>,
        disposed: bool,
    }

    fn endpoints() -> [SeatId; 2] {
        [SeatId::new(safe(1)), SeatId::new(safe(2))]
    }

    fn safe(value: u64) -> SafeU53 {
        assert!(value <= SafeU53::MAX.get());
        SafeU53::new(value).unwrap_or(SafeU53::ZERO)
    }

    fn generation(value: u64) -> ConnectionGeneration {
        ConnectionGeneration::new(safe(value))
    }

    fn frame(value: serde_json::Value) -> NetworkPayload {
        NetworkPayload::Frame(RawFrame::JsonValue(value))
    }

    fn network_with_packets() -> Result<(FaultNetwork, [SafeU53; 2]), FaultNetworkError> {
        let endpoints = endpoints();
        let mut network = FaultNetwork::new(73, endpoints);
        let first = network.enqueue(
            endpoints[0],
            endpoints[1],
            ConnectionGeneration::ZERO,
            frame(serde_json::json!({"id": 0})),
            SafeU53::ZERO,
        )?;
        let second = network.enqueue(
            endpoints[1],
            endpoints[0],
            ConnectionGeneration::ZERO,
            frame(serde_json::json!({"id": 1})),
            SafeU53::ZERO,
        )?;
        Ok((network, [first, second]))
    }

    fn mechanical_state(network: &FaultNetwork) -> MechanicalState {
        MechanicalState {
            rng_state: network.rng.state,
            endpoints: network.endpoints,
            generations: network.generations.clone(),
            queue: network.queue.clone(),
            reordered_packet_ids: network.reordered_packet_ids.clone(),
            next_packet_id: network.next_packet_id,
            disconnected: network.disconnected.clone(),
            suspended: network.suspended.clone(),
            disposed: network.disposed,
        }
    }

    #[test]
    fn mulberry32_matches_the_pinned_cross_language_u32_vectors()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../fixtures/v1/m2-network-rng-golden.json"
        ))?;
        for vector in fixture["vectors"]
            .as_array()
            .ok_or_else(|| std::io::Error::other("oracle fixture has no vectors"))?
        {
            let seed = vector["seed"]
                .as_str()
                .ok_or_else(|| std::io::Error::other("oracle fixture seed is not a string"))?
                .parse::<u64>()?;
            let samples = vector["u32"]
                .as_array()
                .ok_or_else(|| std::io::Error::other("oracle fixture has no u32 samples"))?;
            let mut rng = SeededRng::new(seed);
            for sample in samples {
                let expected = sample
                    .as_u64()
                    .ok_or_else(|| std::io::Error::other("oracle sample is not an integer"))?;
                let expected = u32::try_from(expected)?;
                assert_eq!(rng.next_u32(), expected, "seed {seed}");
            }
        }
        Ok(())
    }

    #[test]
    fn packet_id_exhaustion_is_fail_atomic_after_the_last_valid_id() -> Result<(), FaultNetworkError>
    {
        let endpoints = endpoints();
        let mut network = FaultNetwork::new(79, endpoints);
        network.next_packet_id = SafeU53::MAX.get();
        let last_id = network.enqueue(
            endpoints[0],
            endpoints[1],
            ConnectionGeneration::ZERO,
            frame(serde_json::json!({"last": true})),
            SafeU53::ZERO,
        )?;
        assert_eq!(last_id, SafeU53::MAX);

        let before = mechanical_state(&network);
        let before_diagnostics = network.diagnostics();
        assert_eq!(
            network.enqueue(
                endpoints[0],
                endpoints[1],
                ConnectionGeneration::ZERO,
                frame(serde_json::json!({"after": false})),
                SafeU53::ZERO,
            ),
            Err(FaultNetworkError::PacketIdExhausted)
        );
        assert_eq!(mechanical_state(&network), before);
        assert_eq!(network.diagnostics(), before_diagnostics);

        let before_duplicate = mechanical_state(&network);
        let before_duplicate_diagnostics = network.diagnostics();
        assert_eq!(
            network.duplicate_packet(last_id),
            Err(FaultNetworkError::PacketIdExhausted)
        );
        assert_eq!(mechanical_state(&network), before_duplicate);
        assert_eq!(network.diagnostics(), before_duplicate_diagnostics);
        Ok(())
    }

    #[test]
    fn generation_exhaustion_is_fail_atomic_for_connection_and_queued_state()
    -> Result<(), FaultNetworkError> {
        let (mut network, _) = network_with_packets()?;
        let endpoints = network.endpoints;
        let maximum = ConnectionGeneration::new(SafeU53::MAX);
        network.generations.insert(endpoints[0], maximum);
        network.generations.insert(endpoints[1], maximum);
        let before = mechanical_state(&network);
        let before_diagnostics = network.diagnostics();

        assert_eq!(
            network.reconnect(endpoints[0]),
            Err(FaultNetworkError::GenerationExhausted)
        );
        assert_eq!(mechanical_state(&network), before);
        assert_eq!(network.diagnostics(), before_diagnostics);
        Ok(())
    }

    #[test]
    fn delay_deadline_overflow_is_fail_atomic_for_rng_ids_order_and_diagnostics()
    -> Result<(), FaultNetworkError> {
        let (mut network, [packet_id, _]) = network_with_packets()?;
        network.queue[0].packet.deliver_at_ms = SafeU53::MAX;
        let before = mechanical_state(&network);
        let before_diagnostics = network.diagnostics();

        assert_eq!(
            network.apply(
                FaultOperation::Delay {
                    packet_id,
                    additional_ms: safe(1),
                },
                SafeU53::ZERO,
            ),
            Err(FaultNetworkError::InvalidFault {
                reason: "packet delay exceeds SafeU53".to_owned(),
            })
        );
        assert_eq!(mechanical_state(&network), before);
        assert_eq!(network.diagnostics(), before_diagnostics);
        Ok(())
    }

    fn apply_counter_sequence(
        network: &mut FaultNetwork,
        packet_ids: [SafeU53; 2],
    ) -> Result<(), FaultNetworkError> {
        let endpoints = network.endpoints;
        network.duplicate_packet(packet_ids[0])?;
        network.corrupt_packet(
            packet_ids[1],
            FrameCorruption::Replace {
                value: RawFrame::JsonValue(serde_json::json!({"corrupted": true})),
            },
        )?;
        network.drop_packet(packet_ids[1])?;
        assert!(network.disconnect(endpoints[0]));
        assert_eq!(network.reconnect(endpoints[0]), Ok(generation(1)));
        network.enqueue(
            endpoints[0],
            endpoints[1],
            generation(1),
            frame(serde_json::json!({"afterReconnect": true})),
            SafeU53::ZERO,
        )?;
        Ok(())
    }

    #[test]
    fn diagnostic_counter_saturation_is_isolated_from_mechanical_state()
    -> Result<(), FaultNetworkError> {
        let (mut maxed, maxed_ids) = network_with_packets()?;
        let (mut near_max, near_max_ids) = network_with_packets()?;
        let one_below_two = safe(SafeU53::MAX.get() - 2);
        maxed.dropped_count = SafeU53::MAX;
        maxed.duplicated_count = SafeU53::MAX;
        maxed.corrupted_count = SafeU53::MAX;
        near_max.dropped_count = one_below_two;
        near_max.duplicated_count = one_below_two;
        near_max.corrupted_count = one_below_two;

        apply_counter_sequence(&mut maxed, maxed_ids)?;
        apply_counter_sequence(&mut near_max, near_max_ids)?;

        assert_eq!(mechanical_state(&maxed), mechanical_state(&near_max));
        let maxed_diagnostics = maxed.diagnostics();
        let near_max_diagnostics = near_max.diagnostics();
        assert_eq!(maxed_diagnostics.seed, near_max_diagnostics.seed);
        assert_eq!(
            maxed_diagnostics.queued_packet_ids,
            near_max_diagnostics.queued_packet_ids
        );
        assert_eq!(
            maxed_diagnostics.disconnected_endpoints,
            near_max_diagnostics.disconnected_endpoints
        );
        assert_eq!(
            maxed_diagnostics.suspended_endpoints,
            near_max_diagnostics.suspended_endpoints
        );
        assert_eq!(maxed_diagnostics.disposed, near_max_diagnostics.disposed);
        assert_eq!(maxed_diagnostics.dropped_count, SafeU53::MAX);
        assert_eq!(maxed_diagnostics.duplicated_count, SafeU53::MAX);
        assert_eq!(maxed_diagnostics.corrupted_count, SafeU53::MAX);
        assert_eq!(
            near_max_diagnostics.dropped_count,
            safe(SafeU53::MAX.get() - 1)
        );
        assert_eq!(
            near_max_diagnostics.duplicated_count,
            safe(SafeU53::MAX.get() - 1)
        );
        assert_eq!(
            near_max_diagnostics.corrupted_count,
            safe(SafeU53::MAX.get() - 1)
        );
        Ok(())
    }
}
