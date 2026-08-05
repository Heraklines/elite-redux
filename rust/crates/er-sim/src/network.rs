//! Seeded deterministic fault network over raw Authority V2 envelopes.

use std::collections::{BTreeMap, BTreeSet};

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
    seed: u64,
    rng: SeededRng,
    endpoints: [SeatId; 2],
    generations: BTreeMap<SeatId, ConnectionGeneration>,
    queue: Vec<QueuedPacket>,
    reorder_active: bool,
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
            reorder_active: false,
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

        let deliver_at_ms = self.next_delivery_time(now_ms)?;
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
            stale: false,
        });
        Ok(packet_id)
    }

    pub fn apply(
        &mut self,
        operation: FaultOperation,
        now_ms: SafeU53,
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
                self.duplicate_packet(packet_id, now_ms)?;
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
        if self.reorder_active {
            return self.deliver_due_in_queue_order(now_ms);
        }
        let mut events = Vec::new();
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
        self.generations.insert(endpoint, next);
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
            seed: self.seed,
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

    fn next_delivery_time(&mut self, now_ms: SafeU53) -> Result<SafeU53, FaultNetworkError> {
        if now_ms.get() > SafeU53::MAX.get().saturating_sub(5) {
            return Err(FaultNetworkError::InvalidFault {
                reason: "packet delivery time exceeds SafeU53".to_owned(),
            });
        }
        let delay_ms = 1 + u64::from(self.rng.next_u32() % 5);
        let deliver_at =
            now_ms
                .get()
                .checked_add(delay_ms)
                .ok_or_else(|| FaultNetworkError::InvalidFault {
                    reason: "packet delivery time exceeds SafeU53".to_owned(),
                })?;
        SafeU53::new(deliver_at).map_err(|_| FaultNetworkError::InvalidFault {
            reason: "packet delivery time exceeds SafeU53".to_owned(),
        })
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
        if queued.stale
            || self.disconnected.contains(&queued.packet.from)
            || self.disconnected.contains(&queued.packet.to)
            || queued.packet.connection_generation != self.connection_generation(queued.packet.from)
        {
            increment_counter(&mut self.dropped_count);
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
        increment_counter(&mut self.dropped_count);
        Ok(vec![NetworkEvent::Dropped { packet_id }])
    }

    fn duplicate_packet(
        &mut self,
        packet_id: SafeU53,
        now_ms: SafeU53,
    ) -> Result<(), FaultNetworkError> {
        let index = self.packet_index(packet_id)?;
        let mut duplicate = self.queue[index].clone();
        let deliver_at_ms = self.next_delivery_time(now_ms)?;
        let duplicate_id = self.allocate_packet_id()?;
        duplicate.packet.packet_id = duplicate_id;
        duplicate.packet.deliver_at_ms = deliver_at_ms;
        self.queue.insert(index + 1, duplicate);
        increment_counter(&mut self.duplicated_count);
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
        self.reorder_active = true;
        Ok(())
    }

    fn deliver_due_in_queue_order(
        &mut self,
        now_ms: SafeU53,
    ) -> Result<Vec<NetworkEvent>, FaultNetworkError> {
        let mut events = Vec::new();
        let mut index = 0;
        while index < self.queue.len() {
            if self.queue[index].packet.deliver_at_ms <= now_ms {
                let packet_id = self.queue[index].packet.packet_id;
                events.extend(self.deliver_packet(packet_id)?);
            } else {
                index += 1;
            }
        }
        Ok(events)
    }

    fn next_due_index(&self, now_ms: SafeU53) -> Option<usize> {
        self.queue
            .iter()
            .enumerate()
            .filter(|(_, queued)| queued.packet.deliver_at_ms <= now_ms)
            .min_by_key(|(index, queued)| {
                (queued.packet.deliver_at_ms, queued.packet.packet_id, *index)
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
        increment_counter(&mut self.corrupted_count);
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct QueuedPacket {
    packet: NetworkPacket,
    stale: bool,
}

#[derive(Debug)]
struct SeededRng {
    state: u64,
}

impl SeededRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        (value ^ (value >> 31)) as u32
    }
}

fn increment_counter(counter: &mut SafeU53) {
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
