//! Deterministic two-endpoint transport for M4 run material.
//!
//! The authority and replica remain independent [`GameKernel`] instances. The
//! pair transports canonical material bytes only; it never chooses a run
//! action or derives canonical state. Duplicate delivery is idempotent by exact
//! operation identity and bytes, while identity reuse with different bytes
//! fails closed.

use std::collections::BTreeMap;

use er_kernel::{GameKernel, KernelError, KernelInput};
use er_run::run_material::{RunMaterialCodecError, decode_run_material};
use er_state::digest_v2::MechanicalStateDigestV2;
use er_types::input::RawInputEvent;
use er_types::run_model::RunSurfaceAction;
use er_types::{OperationId, SafeU53, SeatId};

use crate::PairEndpoint;
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuedRunPacket {
    pub packet_id: SafeU53,
    pub operation_id: OperationId,
    pub deliver_at_ms: SafeU53,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum M4PairError {
    #[error("run material is invalid: {0}")]
    Material(#[from] RunMaterialCodecError),
    #[error("kernel rejected run material: {0}")]
    Kernel(#[from] KernelError),
    #[error("packet ID allocator exhausted")]
    PacketIdExhausted,
    #[error("virtual time overflowed")]
    TimeOverflow,
    #[error("queued packet does not exist")]
    UnknownPacket,
    #[error("operation identity was reused with different canonical bytes")]
    OperationConflict,
    #[error("run frontier is unavailable")]
    MissingFrontier,
    #[error("run state digest failed: {0}")]
    StateDigest(String),
    #[error("raw input targeted a disconnected endpoint")]
    DisconnectedInput,
}

#[derive(Debug)]
pub struct M4RunPair {
    host: GameKernel,
    guest: GameKernel,
    virtual_time_ms: SafeU53,
    next_packet_id: SafeU53,
    guest_connected: bool,
    queue: Vec<QueuedRunPacket>,
    host_applied: BTreeMap<OperationId, Vec<u8>>,
    guest_applied: BTreeMap<OperationId, Vec<u8>>,
}

impl M4RunPair {
    pub fn new(host: GameKernel, guest: GameKernel) -> Self {
        Self {
            host,
            guest,
            virtual_time_ms: SafeU53::ZERO,
            next_packet_id: safe(1).expect("one is a safe integer"),
            guest_connected: true,
            queue: Vec::new(),
            host_applied: BTreeMap::new(),
            guest_applied: BTreeMap::new(),
        }
    }

    pub fn virtual_time_ms(&self) -> SafeU53 {
        self.virtual_time_ms
    }

    pub fn queued_packets(&self) -> &[QueuedRunPacket] {
        &self.queue
    }

    pub fn guest_connected(&self) -> bool {
        self.guest_connected
    }

    pub fn disconnect_guest(&mut self) {
        self.guest_connected = false;
    }

    pub fn reconnect_guest(&mut self) {
        self.guest_connected = true;
    }

    /// Delivers one physical input event to one independent endpoint.
    pub fn step_raw(
        &mut self,
        endpoint: PairEndpoint,
        seat: SeatId,
        event: RawInputEvent,
    ) -> Result<(), M4PairError> {
        if endpoint == PairEndpoint::Guest && !self.guest_connected {
            return Err(M4PairError::DisconnectedInput);
        }
        let kernel = match endpoint {
            PairEndpoint::Host => &mut self.host,
            PairEndpoint::Guest => &mut self.guest,
        };
        kernel.step(KernelInput::RawInput { seat, event })?;
        Ok(())
    }

    /// Read-only typed action audit for campaign assertions.
    #[doc(hidden)]
    pub fn take_actions(&mut self, endpoint: PairEndpoint) -> Vec<RunSurfaceAction> {
        match endpoint {
            PairEndpoint::Host => self.host.take_run_actions(),
            PairEndpoint::Guest => self.guest.take_run_actions(),
        }
    }

    /// Applies canonical bytes to the authority through the production applier,
    /// then queues those exact bytes for the replica.
    pub fn commit_authority(
        &mut self,
        bytes: Vec<u8>,
        delay_ms: SafeU53,
    ) -> Result<SafeU53, M4PairError> {
        let material = decode_run_material(&bytes)?;
        let operation_id = material.operation_id().clone();
        match self.host_applied.get(&operation_id) {
            Some(existing) if existing == &bytes => {}
            Some(_) => return Err(M4PairError::OperationConflict),
            None => {
                self.host.apply_run_material_bytes(&bytes)?;
                self.host_applied
                    .insert(operation_id.clone(), bytes.clone());
            }
        }
        self.enqueue(operation_id, bytes, delay_ms)
    }

    pub fn duplicate_packet(&mut self, packet_id: SafeU53) -> Result<SafeU53, M4PairError> {
        let packet = self
            .queue
            .iter()
            .find(|packet| packet.packet_id == packet_id)
            .cloned()
            .ok_or(M4PairError::UnknownPacket)?;
        self.enqueue(
            packet.operation_id,
            packet.bytes,
            safe(
                packet
                    .deliver_at_ms
                    .get()
                    .saturating_sub(self.virtual_time_ms.get()),
            )?,
        )
    }

    pub fn drop_packet(&mut self, packet_id: SafeU53) -> Result<(), M4PairError> {
        let index = self
            .queue
            .iter()
            .position(|packet| packet.packet_id == packet_id)
            .ok_or(M4PairError::UnknownPacket)?;
        self.queue.remove(index);
        Ok(())
    }

    pub fn delay_packet(
        &mut self,
        packet_id: SafeU53,
        additional_ms: SafeU53,
    ) -> Result<(), M4PairError> {
        let packet = self
            .queue
            .iter_mut()
            .find(|packet| packet.packet_id == packet_id)
            .ok_or(M4PairError::UnknownPacket)?;
        packet.deliver_at_ms = checked_add(packet.deliver_at_ms, additional_ms)?;
        Ok(())
    }

    pub fn advance_time(&mut self, delta_ms: SafeU53) -> Result<usize, M4PairError> {
        self.virtual_time_ms = checked_add(self.virtual_time_ms, delta_ms)?;
        self.deliver_due()
    }

    pub fn deliver_due(&mut self) -> Result<usize, M4PairError> {
        if !self.guest_connected {
            return Ok(0);
        }
        self.queue
            .sort_by_key(|packet| (packet.deliver_at_ms, packet.packet_id));
        let due = self
            .queue
            .partition_point(|packet| packet.deliver_at_ms <= self.virtual_time_ms);
        let mut pending: Vec<_> = self.queue.drain(..due).collect();
        let mut applied = 0;
        loop {
            let mut deferred = Vec::new();
            let mut progressed = false;
            for packet in pending {
                match self.guest_applied.get(&packet.operation_id) {
                    Some(existing) if existing == &packet.bytes => continue,
                    Some(_) => return Err(M4PairError::OperationConflict),
                    None => {}
                }
                let material = decode_run_material(&packet.bytes)?;
                let required = MechanicalStateDigestV2::compute(material.before_state())
                    .map_err(|error| M4PairError::StateDigest(error.to_string()))?;
                let local = self
                    .guest
                    .run_frontier_digest()
                    .map_err(|_| M4PairError::MissingFrontier)?;
                if required != local {
                    deferred.push(packet);
                    continue;
                }
                self.guest.apply_run_material_bytes(&packet.bytes)?;
                self.guest_applied.insert(packet.operation_id, packet.bytes);
                applied += 1;
                progressed = true;
            }
            if deferred.is_empty() {
                break;
            }
            if !progressed {
                self.queue.extend(deferred);
                break;
            }
            pending = deferred;
        }
        Ok(applied)
    }

    pub fn frontiers(
        &self,
    ) -> Result<(MechanicalStateDigestV2, MechanicalStateDigestV2), M4PairError> {
        let host = self
            .host
            .run_frontier_digest()
            .map_err(|_| M4PairError::MissingFrontier)?;
        let guest = self
            .guest
            .run_frontier_digest()
            .map_err(|_| M4PairError::MissingFrontier)?;
        Ok((host, guest))
    }

    fn enqueue(
        &mut self,
        operation_id: OperationId,
        bytes: Vec<u8>,
        delay_ms: SafeU53,
    ) -> Result<SafeU53, M4PairError> {
        let packet_id = self.next_packet_id;
        self.next_packet_id =
            checked_add(self.next_packet_id, safe(1).expect("one is a safe integer"))
                .map_err(|_| M4PairError::PacketIdExhausted)?;
        let deliver_at_ms = checked_add(self.virtual_time_ms, delay_ms)?;
        self.queue.push(QueuedRunPacket {
            packet_id,
            operation_id,
            deliver_at_ms,
            bytes,
        });
        Ok(packet_id)
    }
}

fn safe(value: u64) -> Result<SafeU53, M4PairError> {
    SafeU53::new(value).map_err(|_| M4PairError::TimeOverflow)
}

fn checked_add(left: SafeU53, right: SafeU53) -> Result<SafeU53, M4PairError> {
    let value = left
        .get()
        .checked_add(right.get())
        .ok_or(M4PairError::TimeOverflow)?;
    safe(value)
}
