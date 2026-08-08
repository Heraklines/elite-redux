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
    seed: u64,
    rng: SeededRng,
    endpoints: [SeatId; 2],
    generations: BTreeMap<SeatId, ConnectionGeneration>,
    queue: Vec<QueuedPacket>,
    reordered_packet_ids: BTreeSet<SafeU53>,
    next_packet_id: u64,
    disconnected: BTreeSet<SeatId>,
    suspended: BTreeSet<SeatId>,
    dropped_count: SafeU53,
    duplicated_count: SafeU53,
    corrupted_count: SafeU53,
    disposed: bool,
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
            disconnected: BTreeSet::new(),
            suspended: BTreeSet::new(),
            dropped_count: SafeU53::ZERO,
            duplicated_count: SafeU53::ZERO,
            corrupted_count: SafeU53::ZERO,
            disposed: false,
        }
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

        let source_generation = self.connection_generation(from);
        let destination_generation = self.connection_generation(to);
        let (deliver_at_ms, next_rng) = self.next_delivery_time(now_ms)?;
        let packet_id = self.allocate_packet_id()?;
        self.queue.push(QueuedPacket {
            packet: NetworkPacket {
                packet_id,
                from,
                to,
                connection_generation,
                payload,
                deliver_at_ms,
            },
            source_generation,
            destination_generation,
            // Retain an explicitly stale send for deterministic drop/reap behavior, but never
            // allow it to cross either endpoint's current incarnation boundary.
            stale: connection_generation != source_generation
                || connection_generation != destination_generation,
        });
        self.rng = next_rng;
        Ok(packet_id)
    }

    pub fn apply(
        &mut self,
        operation: FaultOperation,
        _now_ms: SafeU53,
    ) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        self.ensure_live()?;
        match operation {
            FaultOperation::Deliver { packet_id } => self.deliver_packet(packet_id),
            FaultOperation::DeliverNext => {
                let Some(packet_id) = self.queue.first().map(|queued| queued.packet.packet_id)
                else {
                    return Ok(Vec::new());
                };
                self.deliver_packet(packet_id)
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
        }
    }

    pub fn deliver_due(&mut self, now_ms: SafeU53) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        self.ensure_live()?;
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

    fn allocate_packet_id(&mut self) -> Result<SafeU53, FaultNetworkError> {
        let packet_id =
            SafeU53::new(self.next_packet_id).map_err(|_| FaultNetworkError::PacketIdExhausted)?;
        self.next_packet_id = self
            .next_packet_id
            .checked_add(1)
            .ok_or(FaultNetworkError::PacketIdExhausted)?;
        Ok(packet_id)
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
        let mut duplicate = self.queue[index].clone();
        let duplicate_id = self.allocate_packet_id()?;
        duplicate.packet.packet_id = duplicate_id;
        self.queue.insert(index + 1, duplicate);
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
        for packet_id in packet_ids {
            let index = self.packet_index(packet_id)?;
            reordered.push(self.queue.remove(index));
        }
        reordered.append(&mut self.queue);
        self.queue = reordered;
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
        let payload = &mut self.queue[index].packet.payload;
        let NetworkPayload::Frame(raw) = payload else {
            return Err(FaultNetworkError::PayloadIsNotFrame { packet_id });
        };
        corrupt_raw_frame(raw, corruption)
            .map_err(|reason| FaultNetworkError::InvalidFault { reason })?;
        increment_diagnostic_counter(&mut self.corrupted_count);
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
struct QueuedPacket {
    packet: NetworkPacket,
    source_generation: ConnectionGeneration,
    destination_generation: ConnectionGeneration,
    stale: bool,
}

#[derive(Clone, Debug)]
struct SeededRng {
    state: u32,
}

impl SeededRng {
    fn new(seed: u64) -> Self {
        Self { state: seed as u32 }
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
        [
            SeatId::new(safe(1)),
            SeatId::new(safe(2)),
        ]
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
        let first = network
            .enqueue(
                endpoints[0],
                endpoints[1],
                ConnectionGeneration::ZERO,
                frame(serde_json::json!({"id": 0})),
                SafeU53::ZERO,
            )
            ?;
        let second = network
            .enqueue(
                endpoints[1],
                endpoints[0],
                ConnectionGeneration::ZERO,
                frame(serde_json::json!({"id": 1})),
                SafeU53::ZERO,
            )
            ?;
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
    fn mulberry32_matches_the_pinned_cross_language_u32_vectors() -> Result<(), Box<dyn std::error::Error>> {
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
    fn packet_id_exhaustion_is_fail_atomic_after_the_last_valid_id() -> Result<(), FaultNetworkError> {
        let endpoints = endpoints();
        let mut network = FaultNetwork::new(79, endpoints);
        network.next_packet_id = SafeU53::MAX.get();
        let last_id = network
            .enqueue(
                endpoints[0],
                endpoints[1],
                ConnectionGeneration::ZERO,
                frame(serde_json::json!({"last": true})),
                SafeU53::ZERO,
            )
            ?;
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
        -> Result<(), FaultNetworkError>
    {
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
        -> Result<(), FaultNetworkError>
    {
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
        network
            .duplicate_packet(packet_ids[0])
            ?;
        network
            .corrupt_packet(
                packet_ids[1],
                FrameCorruption::Replace {
                    value: RawFrame::JsonValue(serde_json::json!({"corrupted": true})),
                },
            )
            ?;
        network
            .drop_packet(packet_ids[1])
            ?;
        assert!(network.disconnect(endpoints[0]));
        assert_eq!(network.reconnect(endpoints[0]), Ok(generation(1)));
        network
            .enqueue(
                endpoints[0],
                endpoints[1],
                generation(1),
                frame(serde_json::json!({"afterReconnect": true})),
                SafeU53::ZERO,
            )
            ?;
        Ok(())
    }

    #[test]
    fn diagnostic_counter_saturation_is_isolated_from_mechanical_state()
        -> Result<(), FaultNetworkError>
    {
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
