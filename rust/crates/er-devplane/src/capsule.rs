//! Privacy-preserving conversion of bounded telemetry into an opaque capsule blob.

use std::collections::BTreeSet;

use er_canonical::canonical_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{TelemetryEventKindV1, TelemetryEventV1, TelemetryRingV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TelemetryCapsulePolicyV1 {
    pub maximum_events: usize,
    pub maximum_bytes: usize,
    pub allowed_kinds: Vec<TelemetryEventKindV1>,
    pub require_redacted_payloads: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TelemetryCapsuleProjectionV1 {
    pub schema_version: u32,
    pub digest: String,
    pub bytes: Vec<u8>,
    pub included_sequences: Vec<u64>,
    pub omitted_sequences: Vec<u64>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TelemetryCapsuleErrorV1 {
    #[error("telemetry capsule policy has an invalid bound or duplicate kind")]
    Policy,
    #[error("telemetry capsule exceeds its byte bound")]
    Bounds,
    #[error("telemetry capsule encoding failed: {0}")]
    Canonical(String),
}

pub fn telemetry_to_capsule_blob_v1(
    telemetry: &TelemetryRingV1,
    policy: &TelemetryCapsulePolicyV1,
) -> Result<TelemetryCapsuleProjectionV1, TelemetryCapsuleErrorV1> {
    if policy.maximum_events == 0
        || policy.maximum_bytes == 0
        || policy.allowed_kinds.is_empty()
        || policy
            .allowed_kinds
            .windows(2)
            .any(|pair| event_kind_rank(pair[0]) >= event_kind_rank(pair[1]))
    {
        return Err(TelemetryCapsuleErrorV1::Policy);
    }
    let allowed = policy
        .allowed_kinds
        .iter()
        .copied()
        .map(event_kind_rank)
        .collect::<BTreeSet<_>>();
    let mut included = Vec::<TelemetryEventV1>::new();
    let mut omitted_sequences = Vec::new();
    for event in telemetry.events() {
        if included.len() == policy.maximum_events
            || !allowed.contains(&event_kind_rank(event.event_kind))
            || (policy.require_redacted_payloads && !event.redacted)
        {
            omitted_sequences.push(event.sequence);
            continue;
        }
        included.push(event.clone());
    }
    let bytes = canonical_bytes(&("elite-redux/m71/telemetry-capsule/v1", &included))
        .map_err(|error| TelemetryCapsuleErrorV1::Canonical(error.to_string()))?;
    if bytes.len() > policy.maximum_bytes {
        return Err(TelemetryCapsuleErrorV1::Bounds);
    }
    let included_sequences = included.iter().map(|event| event.sequence).collect();
    Ok(TelemetryCapsuleProjectionV1 {
        schema_version: 1,
        digest: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
        bytes,
        included_sequences,
        omitted_sequences,
    })
}

fn event_kind_rank(kind: TelemetryEventKindV1) -> u8 {
    match kind {
        TelemetryEventKindV1::ExternalEvent => 0,
        TelemetryEventKindV1::ControlChange => 1,
        TelemetryEventKindV1::Material => 2,
        TelemetryEventKindV1::Terminal => 3,
        TelemetryEventKindV1::Recovery => 4,
        TelemetryEventKindV1::ResourceCount => 5,
        TelemetryEventKindV1::PerformanceOutlier => 6,
        TelemetryEventKindV1::ModelRequest => 7,
        TelemetryEventKindV1::PlatformWarning => 8,
        TelemetryEventKindV1::RenderWarning => 9,
        TelemetryEventKindV1::Checkpoint => 10,
    }
}
