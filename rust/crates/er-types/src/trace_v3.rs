//! M4 deterministic boundary trace schema.
//!
//! The trace crate cannot depend on the kernel or simulator crates (those
//! crates depend on `er-types`).  Snapshot payloads are therefore retained as
//! canonical bytes.  The bytes are the complete typed V3 snapshot, not a
//! diagnostic projection or a summary.

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::battle_ids::{CanonicalHexBytes, MenuInstanceId};
use crate::{KernelEffect, KernelInput, LiveResourceSnapshot, OperationId, Revision, SafeU53};

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub const KERNEL_TRACE_SCHEMA_VERSION_V3: u32 = 3;
pub const KERNEL_TRACE_VERSION_V3: u32 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum TraceSourceV3 {
    Host,
    Guest,
    External,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceSnapshotEnvelopeV3 {
    pub schema_version: u32,
    /// Canonical bytes for the complete `RestorablePairSnapshotV3`.
    pub canonical_snapshot: CanonicalHexBytes,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RngAuditDrawV3 {
    pub sequence: SafeU53,
    pub stream: String,
    pub callsite: String,
    pub reason: String,
    pub before: String,
    pub after: String,
    pub value: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RngAuditDeltaV3 {
    pub before_fingerprint: String,
    pub after_fingerprint: String,
    pub draws: Vec<RngAuditDrawV3>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceTraceEvidenceV3 {
    pub surface_kind: String,
    pub surface_id: SafeU53,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub option_id: Option<String>,
    pub action_ordinal: SafeU53,
    pub owner: SafeU53,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub price: Option<SafeU53>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub target: Option<SafeU53>,
    pub expected_surface_digest: String,
    pub actual_surface_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceFailureEvidenceV3 {
    pub subsystem: String,
    pub path: String,
    pub expected: String,
    pub actual: String,
    pub first_difference: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub surface: Option<SurfaceTraceEvidenceV3>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelTraceEventV3 {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub source: TraceSourceV3,
    pub input: KernelInput,
    pub expected_pre_mechanical_digest: String,
    pub expected_pre_kernel_digest: String,
    pub produced_effects: Vec<KernelEffect>,
    pub expected_post_mechanical_digest: String,
    pub expected_post_kernel_digest: String,
    pub rng_audit_delta: RngAuditDeltaV3,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub authority_revision: Option<Revision>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub active_operation_id: Option<OperationId>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub active_control_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub active_menu_instance_id: Option<MenuInstanceId>,
    pub live_resources: LiveResourceSnapshot,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub failure: Option<TraceFailureEvidenceV3>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelTraceV3 {
    pub schema_version: u32,
    pub initial: TraceSnapshotEnvelopeV3,
    pub events: Vec<KernelTraceEventV3>,
    pub final_snapshot: TraceSnapshotEnvelopeV3,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TraceValidationError {
    #[error("trace field {path} is invalid: {reason}")]
    Invalid { path: String, reason: String },
}

fn invalid(path: impl Into<String>, reason: impl Into<String>) -> TraceValidationError {
    TraceValidationError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn valid_digest(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("blake3-v1:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

impl TraceSnapshotEnvelopeV3 {
    pub fn validate(&self, path: &str) -> Result<(), TraceValidationError> {
        if self.schema_version != KERNEL_TRACE_SCHEMA_VERSION_V3 {
            return Err(invalid(
                format!("{path}.schema_version"),
                format!(
                    "expected {KERNEL_TRACE_SCHEMA_VERSION_V3}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.canonical_snapshot.as_str().is_empty()
            || self.canonical_snapshot.as_str().len() % 2 != 0
            || !self
                .canonical_snapshot
                .as_str()
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(invalid(
                format!("{path}.canonical_snapshot"),
                "complete snapshot bytes must be non-empty lowercase hexadecimal",
            ));
        }
        Ok(())
    }
}

impl RngAuditDeltaV3 {
    pub fn validate(&self, path: &str) -> Result<(), TraceValidationError> {
        if self.before_fingerprint.is_empty() || self.after_fingerprint.is_empty() {
            return Err(invalid(path, "RNG fingerprints must be non-empty"));
        }
        for (index, draw) in self.draws.iter().enumerate() {
            if draw.stream.is_empty()
                || draw.callsite.is_empty()
                || draw.reason.is_empty()
                || draw.before.is_empty()
                || draw.after.is_empty()
            {
                return Err(invalid(
                    format!("{path}.draws[{index}]"),
                    "RNG draw identity and fingerprints must be non-empty",
                ));
            }
        }
        if self
            .draws
            .windows(2)
            .any(|pair| pair[0].sequence >= pair[1].sequence)
        {
            return Err(invalid(
                format!("{path}.draws"),
                "RNG draws must be strictly increasing",
            ));
        }
        Ok(())
    }
}

impl KernelTraceEventV3 {
    pub fn validate(&self, path: &str) -> Result<(), TraceValidationError> {
        if !valid_digest(&self.expected_pre_mechanical_digest)
            || !valid_digest(&self.expected_pre_kernel_digest)
            || !valid_digest(&self.expected_post_mechanical_digest)
            || !valid_digest(&self.expected_post_kernel_digest)
        {
            return Err(invalid(
                format!("{path}.digest"),
                "all stored digests must be blake3-v1 lowercase hexadecimal digests",
            ));
        }
        self.rng_audit_delta
            .validate(&format!("{path}.rng_audit_delta"))?;
        if let Some(failure) = &self.failure {
            if failure.subsystem.is_empty()
                || failure.path.is_empty()
                || failure.first_difference.is_empty()
            {
                return Err(invalid(
                    format!("{path}.failure"),
                    "failure evidence must name a subsystem, path, and first difference",
                ));
            }
            if let Some(surface) = &failure.surface {
                if surface.surface_kind.is_empty()
                    || surface.expected_surface_digest.is_empty()
                    || surface.actual_surface_digest.is_empty()
                {
                    return Err(invalid(
                        format!("{path}.failure.surface"),
                        "surface evidence must retain identity and both digests",
                    ));
                }
            }
        }
        Ok(())
    }
}

impl KernelTraceV3 {
    pub fn validate(&self) -> Result<(), TraceValidationError> {
        if self.schema_version != KERNEL_TRACE_SCHEMA_VERSION_V3 {
            return Err(invalid(
                "schema_version",
                format!(
                    "expected {KERNEL_TRACE_SCHEMA_VERSION_V3}, got {}",
                    self.schema_version
                ),
            ));
        }
        self.initial.validate("initial")?;
        self.final_snapshot.validate("final_snapshot")?;
        for (index, event) in self.events.iter().enumerate() {
            event.validate(&format!("events[{index}]"))?;
            if index > 0 {
                let previous = &self.events[index - 1];
                if event.sequence <= previous.sequence {
                    return Err(invalid(
                        format!("events[{index}].sequence"),
                        "event sequences must be strictly increasing",
                    ));
                }
                if event.virtual_time_ms < previous.virtual_time_ms {
                    return Err(invalid(
                        format!("events[{index}].virtual_time_ms"),
                        "virtual time must be monotonic",
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn recapture_equal(
        expected: &TraceSnapshotEnvelopeV3,
        recaptured: &TraceSnapshotEnvelopeV3,
    ) -> Result<(), TraceValidationError> {
        expected.validate("expected")?;
        recaptured.validate("recaptured")?;
        if expected != recaptured {
            return Err(invalid(
                "recapture",
                "recaptured complete V3 snapshot differs from the candidate",
            ));
        }
        Ok(())
    }
}
