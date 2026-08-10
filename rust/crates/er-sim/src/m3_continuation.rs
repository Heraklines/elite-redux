//! Shared native/wasm32 continuation evidence for the M3 pair snapshot.
//!
//! A native fixture builder records the uninterrupted production pair from
//! each required boundary. Both native and wasm32/Node then consume the same
//! canonical suite, reconstruct a fresh `SimulatedPair` from every serialized
//! V2 origin, and replay every later public operation through the real pair.
//! `PairKernelTraceV2` compares ordered effects, RNG draws, internal events,
//! owner digests, packet/environment state, and resources.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

use er_canonical::{canonicalize, content_digest};
use er_content::pack::ContentPack;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};

use crate::SimulatedPair;
use crate::snapshot::{
    PairDeterminismDigest, PairKernelTraceV2, SnapshotError, TraceDivergenceV2,
};

pub const M3_CONTINUATION_SUITE_SCHEMA_VERSION: u32 = 1;
pub const M3_CONTINUATION_REPORT_SCHEMA_VERSION: u32 = 1;
pub const M3_CONTINUATION_SUITE_ID: &str = "pokerogue-redux/m3/native-wasm-continuation/v1";

pub const REQUIRED_CONTINUATION_BOUNDARIES: [&str; 10] = [
    "held-fight-before-keyup",
    "doubles-one-command-pending",
    "guest-proposal-delivery-pending",
    "turn-packet-delayed",
    "control-receipt-delayed",
    "replacement-menu-open",
    "recovery-fence-held",
    "blocking-presentation-pending",
    "terminal-before-teardown",
    "mixed-network-fault-queue",
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3ContinuationScenarioV1 {
    pub boundary_id: String,
    pub trace: PairKernelTraceV2,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3ContinuationSuiteV1 {
    pub schema_version: u32,
    pub suite_id: String,
    pub content_pack: ContentPack,
    pub scenarios: Vec<M3ContinuationScenarioV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct M3ContinuationScenarioReportV1 {
    pub boundary_id: String,
    pub trace_digest: String,
    pub initial_snapshot_digest: String,
    pub initial_pair_determinism_digest: PairDeterminismDigest,
    pub operation_count: SafeU53,
    pub replayed_operation_count: SafeU53,
    pub host_rng_draw_count: SafeU53,
    pub guest_rng_draw_count: SafeU53,
    pub final_entry_digest: String,
    pub final_pair_determinism_digest: PairDeterminismDigest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct M3ContinuationReportV1 {
    pub schema_version: u32,
    pub suite_id: String,
    pub suite_digest: String,
    pub content_hash: String,
    pub scenario_count: SafeU53,
    pub scenarios: Vec<M3ContinuationScenarioReportV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum M3ContinuationError {
    Json(String),
    InvalidSuite(String),
    Snapshot {
        boundary_id: String,
        reason: String,
    },
    Divergence {
        boundary_id: String,
        divergence: TraceDivergenceV2,
    },
    Canonical(String),
}

impl fmt::Display for M3ContinuationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(reason) => write!(formatter, "invalid M3 continuation JSON: {reason}"),
            Self::InvalidSuite(reason) => {
                write!(formatter, "invalid M3 continuation suite: {reason}")
            }
            Self::Snapshot {
                boundary_id,
                reason,
            } => write!(
                formatter,
                "M3 continuation snapshot/replay failed at {boundary_id}: {reason}"
            ),
            Self::Divergence {
                boundary_id,
                divergence,
            } => write!(
                formatter,
                "M3 continuation diverged at {boundary_id}, operation {}, time {} ms, owner {:?}, path {}, code {}, expected {:?}, actual {:?}",
                divergence.sequence,
                divergence.virtual_time_ms,
                divergence.owner,
                divergence.path,
                divergence.code,
                divergence.expected,
                divergence.actual,
            ),
            Self::Canonical(reason) => {
                write!(formatter, "could not canonicalize M3 continuation evidence: {reason}")
            }
        }
    }
}

impl std::error::Error for M3ContinuationError {}

fn snapshot_error(boundary_id: &str, error: impl fmt::Display) -> M3ContinuationError {
    M3ContinuationError::Snapshot {
        boundary_id: boundary_id.to_owned(),
        reason: error.to_string(),
    }
}

fn safe_len(length: usize, field: &str) -> Result<SafeU53, M3ContinuationError> {
    let value = u64::try_from(length).map_err(|_| {
        M3ContinuationError::InvalidSuite(format!("{field} length exceeds u64"))
    })?;
    SafeU53::new(value).map_err(|error| {
        M3ContinuationError::InvalidSuite(format!("{field} length is not JS-safe: {error}"))
    })
}

impl M3ContinuationSuiteV1 {
    pub fn validate(&self) -> Result<(), M3ContinuationError> {
        if self.schema_version != M3_CONTINUATION_SUITE_SCHEMA_VERSION {
            return Err(M3ContinuationError::InvalidSuite(format!(
                "schema_version is {}, expected {}",
                self.schema_version, M3_CONTINUATION_SUITE_SCHEMA_VERSION
            )));
        }
        if self.suite_id != M3_CONTINUATION_SUITE_ID {
            return Err(M3ContinuationError::InvalidSuite(format!(
                "suite_id is {:?}, expected {:?}",
                self.suite_id, M3_CONTINUATION_SUITE_ID
            )));
        }
        self.content_pack
            .validate()
            .map_err(|error| M3ContinuationError::InvalidSuite(error.to_string()))?;
        if self.scenarios.len() != REQUIRED_CONTINUATION_BOUNDARIES.len() {
            return Err(M3ContinuationError::InvalidSuite(format!(
                "scenario count is {}, expected {}",
                self.scenarios.len(),
                REQUIRED_CONTINUATION_BOUNDARIES.len()
            )));
        }

        let mut seen = BTreeSet::new();
        for (index, (scenario, expected_id)) in self
            .scenarios
            .iter()
            .zip(REQUIRED_CONTINUATION_BOUNDARIES)
            .enumerate()
        {
            if scenario.boundary_id != expected_id {
                return Err(M3ContinuationError::InvalidSuite(format!(
                    "scenario {index} is {:?}, expected {expected_id:?}",
                    scenario.boundary_id
                )));
            }
            if !seen.insert(scenario.boundary_id.as_str()) {
                return Err(M3ContinuationError::InvalidSuite(format!(
                    "duplicate boundary_id {:?}",
                    scenario.boundary_id
                )));
            }
            scenario
                .trace
                .validate()
                .map_err(|error| snapshot_error(&scenario.boundary_id, error))?;
            if scenario.trace.entries.is_empty() {
                return Err(M3ContinuationError::InvalidSuite(format!(
                    "boundary {:?} has no continuation operations",
                    scenario.boundary_id
                )));
            }
            let initial = &scenario.trace.initial_snapshot;
            if initial.host.content_hash != self.content_pack.hash
                || initial.guest.content_hash != self.content_pack.hash
            {
                return Err(M3ContinuationError::InvalidSuite(format!(
                    "boundary {:?} content identity differs from the suite content pack",
                    scenario.boundary_id
                )));
            }
        }
        Ok(())
    }
}

pub fn canonical_suite_json(
    suite: &M3ContinuationSuiteV1,
) -> Result<String, M3ContinuationError> {
    suite.validate()?;
    canonicalize(suite).map_err(|error| M3ContinuationError::Canonical(error.to_string()))
}

pub fn parse_suite_json(input: &str) -> Result<M3ContinuationSuiteV1, M3ContinuationError> {
    let suite: M3ContinuationSuiteV1 =
        serde_json::from_str(input).map_err(|error| M3ContinuationError::Json(error.to_string()))?;
    suite.validate()?;
    Ok(suite)
}

pub fn replay_suite(
    suite: &M3ContinuationSuiteV1,
) -> Result<M3ContinuationReportV1, M3ContinuationError> {
    suite.validate()?;
    let content = Arc::new(suite.content_pack.clone());
    let mut scenarios = Vec::with_capacity(suite.scenarios.len());

    for scenario in &suite.scenarios {
        let replay = scenario
            .trace
            .replay_simulated_pair::<SimulatedPair, _>(
                Arc::clone(&content),
                |pair, operation, _virtual_time_ms| {
                    pair.apply_trace_operation_v2(operation.clone())
                },
            )
            .map_err(|error: SnapshotError| snapshot_error(&scenario.boundary_id, error))?;
        if let Some(divergence) = replay.first_divergence {
            return Err(M3ContinuationError::Divergence {
                boundary_id: scenario.boundary_id.clone(),
                divergence,
            });
        }

        let final_entry = scenario.trace.entries.last().ok_or_else(|| {
            M3ContinuationError::InvalidSuite(format!(
                "boundary {:?} has no final entry",
                scenario.boundary_id
            ))
        })?;
        let host_rng_draw_count = scenario
            .trace
            .entries
            .iter()
            .try_fold(0usize, |total, entry| {
                total.checked_add(entry.host.rng_audit.len())
            })
            .ok_or_else(|| {
                M3ContinuationError::InvalidSuite(format!(
                    "boundary {:?} host RNG count overflowed",
                    scenario.boundary_id
                ))
            })?;
        let guest_rng_draw_count = scenario
            .trace
            .entries
            .iter()
            .try_fold(0usize, |total, entry| {
                total.checked_add(entry.guest.rng_audit.len())
            })
            .ok_or_else(|| {
                M3ContinuationError::InvalidSuite(format!(
                    "boundary {:?} guest RNG count overflowed",
                    scenario.boundary_id
                ))
            })?;
        scenarios.push(M3ContinuationScenarioReportV1 {
            boundary_id: scenario.boundary_id.clone(),
            trace_digest: content_digest(&scenario.trace)
                .map_err(|error| M3ContinuationError::Canonical(error.to_string()))?,
            initial_snapshot_digest: content_digest(&scenario.trace.initial_snapshot)
                .map_err(|error| M3ContinuationError::Canonical(error.to_string()))?,
            initial_pair_determinism_digest: PairDeterminismDigest::compute(
                &scenario.trace.initial_snapshot,
            )
            .map_err(|error| snapshot_error(&scenario.boundary_id, error))?,
            operation_count: safe_len(scenario.trace.entries.len(), "scenario operations")?,
            replayed_operation_count: replay.replayed_entries,
            host_rng_draw_count: safe_len(host_rng_draw_count, "host RNG draws")?,
            guest_rng_draw_count: safe_len(guest_rng_draw_count, "guest RNG draws")?,
            final_entry_digest: content_digest(final_entry)
                .map_err(|error| M3ContinuationError::Canonical(error.to_string()))?,
            final_pair_determinism_digest: final_entry.pair_after.clone(),
        });
    }

    Ok(M3ContinuationReportV1 {
        schema_version: M3_CONTINUATION_REPORT_SCHEMA_VERSION,
        suite_id: suite.suite_id.clone(),
        suite_digest: content_digest(suite)
            .map_err(|error| M3ContinuationError::Canonical(error.to_string()))?,
        content_hash: suite.content_pack.hash.to_string(),
        scenario_count: safe_len(scenarios.len(), "report scenarios")?,
        scenarios,
    })
}

pub fn replay_suite_json(input: &str) -> Result<String, M3ContinuationError> {
    let suite = parse_suite_json(input)?;
    let report = replay_suite(&suite)?;
    canonicalize(&report).map_err(|error| M3ContinuationError::Canonical(error.to_string()))
}
