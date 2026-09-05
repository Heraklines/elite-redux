//! Closed M4 pair/environment snapshot DTOs.
//!
//! This is a parallel V3 root.  The M3 owner DTOs remain complete packet,
//! presenter, storage, clock, and fault representations; only the endpoint
//! root is upgraded to the M4 GameStateV2 endpoint and V3 validation boundary.

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use er_types::battle_ids::CanonicalHexBytes;
use er_types::{SafeU53, TimeClass, TransportState};

use er_kernel::snapshot_v3::RestorableKernelSnapshotV3;

use crate::PairEndpoint;
use crate::snapshot::{
    DetachedKeyboardDriverSnapshotV2, FaultNetworkSnapshotV2, FaultRngStateV2,
    FaultScriptSnapshotV2, PacketDispositionV2, PresenterSnapshotV2, StorageSnapshotV2,
    VirtualClockSnapshotV2,
};

pub const RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V3: u32 = 3;
pub const PAIR_DETERMINISM_DIGEST_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct PairDeterminismDigestV2(String);

impl PairDeterminismDigestV2 {
    pub fn new(value: impl Into<String>) -> Result<Self, SnapshotError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix("blake3-v1:") else {
            return Err(invalid(
                "pair_determinism_digest",
                "digest must start with blake3-v1:",
            ));
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(invalid(
                "pair_determinism_digest",
                "digest must contain 64 lowercase hexadecimal digits",
            ));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for PairDeterminismDigestV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorablePairSnapshotV3 {
    pub schema_version: u32,
    pub sequence: SafeU53,
    pub replay_seed: String,
    pub virtual_time_ms: SafeU53,
    pub host: RestorableKernelSnapshotV3,
    pub guest: RestorableKernelSnapshotV3,
    pub host_driver: DetachedKeyboardDriverSnapshotV2,
    pub guest_driver: DetachedKeyboardDriverSnapshotV2,
    pub clock: VirtualClockSnapshotV2,
    pub network: FaultNetworkSnapshotV2,
    pub presenter: PresenterSnapshotV2,
    pub storage: StorageSnapshotV2,
    pub fault_script: FaultScriptSnapshotV2,
    pub fault_rng_state: FaultRngStateV2,
    pub pair_determinism_digest: PairDeterminismDigestV2,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotError {
    #[error("snapshot field {path} is invalid: {reason}")]
    Invalid { path: String, reason: String },
    #[error("snapshot recapture differs at {path}: {reason}")]
    Recapture { path: String, reason: String },
}

fn invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn recapture(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Recapture {
        path: path.into(),
        reason: reason.into(),
    }
}

fn validate_digest(value: &str, path: &str) -> Result<(), SnapshotError> {
    let Some(hex) = value.strip_prefix("blake3-v1:") else {
        return Err(invalid(path, "digest must start with blake3-v1:"));
    };
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(invalid(
            path,
            "digest must contain 64 lowercase hexadecimal digits",
        ));
    }
    Ok(())
}

fn validate_packet_body(body: &CanonicalHexBytes, path: &str) -> Result<(), SnapshotError> {
    if body.as_str().is_empty()
        || !body.as_str().len().is_multiple_of(2)
        || !body
            .as_str()
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(invalid(
            path,
            "queued packet body must retain non-empty canonical bytes",
        ));
    }
    Ok(())
}

impl RestorablePairSnapshotV3 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V3 {
            return Err(invalid(
                "schema_version",
                format!(
                    "expected {RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V3}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.replay_seed.is_empty() {
            return Err(invalid("replay_seed", "replay seed must not be empty"));
        }
        if self.virtual_time_ms != self.clock.now_ms {
            return Err(invalid("virtual_time_ms", "must equal clock.now_ms"));
        }
        self.host
            .validate()
            .map_err(|error| invalid("host", error.to_string()))?;
        self.guest
            .validate()
            .map_err(|error| invalid("guest", error.to_string()))?;
        if self.host.runtime_identity.local_seat == self.guest.runtime_identity.local_seat {
            return Err(invalid(
                "host.guest.runtime_identity.local_seat",
                "host and guest seats must be distinct",
            ));
        }
        if self.host.content_hash != self.guest.content_hash
            || self.host.run_content_hash != self.guest.run_content_hash
        {
            return Err(invalid(
                "host.guest.content_hash",
                "both endpoints must use the same content identities",
            ));
        }
        if self.host.terminal != self.guest.terminal {
            return Err(invalid(
                "host.guest.terminal",
                "both endpoints must retain the exact same terminal state",
            ));
        }
        if self.host_driver.seat != self.host.runtime_identity.local_seat
            || self.guest_driver.seat != self.guest.runtime_identity.local_seat
        {
            return Err(invalid(
                "driver.seat",
                "driver seats must equal endpoint identities",
            ));
        }
        self.host_driver
            .validate()
            .map_err(|error| invalid("host_driver", error.to_string()))?;
        self.guest_driver
            .validate()
            .map_err(|error| invalid("guest_driver", error.to_string()))?;
        self.clock
            .validate()
            .map_err(|error| invalid("clock", error.to_string()))?;
        self.network
            .validate()
            .map_err(|error| invalid("network", error.to_string()))?;
        self.presenter
            .validate()
            .map_err(|error| invalid("presenter", error.to_string()))?;
        self.storage
            .validate()
            .map_err(|error| invalid("storage", error.to_string()))?;
        self.fault_script
            .validate()
            .map_err(|error| invalid("fault_script", error.to_string()))?;
        self.fault_rng_state
            .validate()
            .map_err(|error| invalid("fault_rng_state", error.to_string()))?;
        validate_digest(
            self.pair_determinism_digest.as_str(),
            "pair_determinism_digest",
        )?;

        let host_link = self
            .network
            .links
            .iter()
            .find(|link| link.endpoint == PairEndpoint::Host)
            .ok_or_else(|| invalid("network.links", "host link is absent"))?;
        let guest_link = self
            .network
            .links
            .iter()
            .find(|link| link.endpoint == PairEndpoint::Guest)
            .ok_or_else(|| invalid("network.links", "guest link is absent"))?;
        if host_link.generation != guest_link.generation {
            return Err(invalid(
                "network.links.generation",
                "one shared transport generation is required",
            ));
        }
        if self
            .host
            .protocol
            .frame_context
            .context
            .connection_generation
            != host_link.generation
            || self
                .guest
                .protocol
                .frame_context
                .context
                .connection_generation
                != guest_link.generation
        {
            return Err(invalid(
                "network.links.generation",
                "link generation must equal each endpoint protocol generation",
            ));
        }
        let host_peer = self.host.protocol.connections.as_slice();
        let guest_peer = self.guest.protocol.connections.as_slice();
        let host_seat = self.host.runtime_identity.local_seat;
        let guest_seat = self.guest.runtime_identity.local_seat;
        if host_peer.len() != 1
            || guest_peer.len() != 1
            || host_peer[0].peer_seat != guest_seat
            || guest_peer[0].peer_seat != host_seat
            || host_peer[0].generation != guest_link.generation
            || guest_peer[0].generation != host_link.generation
        {
            return Err(invalid(
                "network.links",
                "endpoint peer bindings must describe the exact pair topology",
            ));
        }
        let expected_transport = if host_link.connected && guest_link.connected {
            TransportState::Connected
        } else {
            TransportState::Disconnected
        };
        if host_peer[0].state != expected_transport || guest_peer[0].state != expected_transport {
            return Err(invalid(
                "network.links.connected",
                "link connectivity must equal endpoint transport projections",
            ));
        }
        for (index, packet) in self.network.packets.iter().enumerate() {
            let path = format!("network.packets[{index}]");
            validate_packet_body(&packet.body, &format!("{path}.body"))?;
            if packet.source == packet.destination {
                return Err(invalid(
                    format!("{path}.source"),
                    "packet source and destination must differ",
                ));
            }
            if packet.enqueued_at_ms > self.virtual_time_ms {
                return Err(invalid(
                    format!("{path}.enqueued_at_ms"),
                    "packet cannot be enqueued after virtual time",
                ));
            }
            let ready = packet.delivery_deadline_ms <= self.virtual_time_ms;
            if matches!(packet.disposition, PacketDispositionV2::Ready) != ready {
                return Err(invalid(
                    format!("{path}.disposition"),
                    "READY must exactly match a deadline at or before virtual time",
                ));
            }
            let source_generation = match packet.source {
                PairEndpoint::Host => host_link.generation,
                PairEndpoint::Guest => guest_link.generation,
            };
            let destination_generation = match packet.destination {
                PairEndpoint::Host => host_link.generation,
                PairEndpoint::Guest => guest_link.generation,
            };
            if packet.source_generation != packet.destination_generation
                || packet.source_generation > source_generation
                || packet.destination_generation > destination_generation
            {
                return Err(invalid(
                    format!("{path}.connection_generation"),
                    "packet must retain one generation no newer than either endpoint link",
                ));
            }
        }
        let mut scheduler_timer_count = 0_usize;
        for (path, endpoint) in [
            ("host.scheduler", &self.host),
            ("guest.scheduler", &self.guest),
        ] {
            for timer in &endpoint.scheduler.timers {
                scheduler_timer_count += 1;
                let registration = &timer.registration;
                let clock_timer = self
                    .clock
                    .timers
                    .iter()
                    .find(|clock_timer| {
                        clock_timer.endpoint == registration.endpoint
                            && clock_timer.timer_id == registration.timer_id
                    })
                    .ok_or_else(|| {
                        invalid(path, "scheduler timer has no pair-clock registration")
                    })?;
                let expected_paused = endpoint.scheduler.pauses.iter().any(|pause| {
                    pause.endpoint == registration.endpoint
                        && pause.time_class == registration.time_class
                });
                if clock_timer.time_class != registration.time_class
                    || clock_timer.remaining_active_ms != timer.remaining_active_ms
                    || clock_timer.paused != expected_paused
                {
                    return Err(invalid(
                        path,
                        "pair-clock duration, pause state, or time class differs from scheduler owner",
                    ));
                }
            }
        }
        if scheduler_timer_count != self.clock.timers.len() {
            return Err(invalid(
                "clock.timers",
                "every pair-clock timer must have exactly one scheduler owner",
            ));
        }
        let environment_disposed = self.clock.disposed
            && self.network.disposed
            && self.presenter.disposed
            && self.storage.disposed;
        if self.host.disposed != self.guest.disposed
            || self.host.disposed != environment_disposed
            || (!self.host.disposed
                && (self.clock.disposed
                    || self.network.disposed
                    || self.presenter.disposed
                    || self.storage.disposed))
        {
            return Err(invalid(
                "disposed",
                "endpoint and environment owners must enter disposal together",
            ));
        }
        Ok(())
    }

    pub fn recapture_equal(expected: &Self, recaptured: &Self) -> Result<(), SnapshotError> {
        expected.validate()?;
        recaptured.validate()?;
        if expected != recaptured {
            return Err(recapture(
                "snapshot",
                "recaptured complete V3 pair state differs from candidate",
            ));
        }
        Ok(())
    }
}

pub fn validate_pair_snapshot_v3(snapshot: &RestorablePairSnapshotV3) -> Result<(), SnapshotError> {
    snapshot.validate()
}

pub fn require_recapture_equality_v3(
    expected: &RestorablePairSnapshotV3,
    recaptured: &RestorablePairSnapshotV3,
) -> Result<(), SnapshotError> {
    RestorablePairSnapshotV3::recapture_equal(expected, recaptured)
}

/// Retain a packet body in a focused, pure helper used by capture adapters.
pub fn validate_packet_body_v3(body: &CanonicalHexBytes) -> Result<(), SnapshotError> {
    validate_packet_body(body, "packet.body")
}

// Keep these imports part of the V3 owner contract: all four pausable classes
// are represented by the inherited clock/scheduler DTOs, while Absolute is
// intentionally not synthesized here.
#[allow(dead_code)]
fn _all_time_classes() -> [TimeClass; 4] {
    [
        TimeClass::Connected,
        TimeClass::Recovery,
        TimeClass::Renderer,
        TimeClass::HumanInput,
    ]
}
