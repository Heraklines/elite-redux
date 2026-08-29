//! Backend-neutral deterministic capsule replay, checkpoint seek, and branch comparison.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    FailureOracleV1,
    capsule::{CapsuleBlobKindV1, CapsuleErrorV1, CapsuleLimitsV1, ReproCapsuleV1},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayEvidenceV1 {
    pub sequence: u64,
    pub mechanical_digest: String,
    pub kernel_digest: String,
    pub diagnostic_root: String,
    pub named_digests: BTreeMap<String, String>,
    pub failure: Option<FailureOracleV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordedReplayEventV1<I> {
    pub sequence: u64,
    pub input: I,
    pub expected: ReplayEvidenceV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayDivergenceV1 {
    pub sequence: u64,
    pub field: String,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayReportV1 {
    pub processed_events: usize,
    pub first_divergence: Option<ReplayDivergenceV1>,
    pub expected_failure: FailureOracleV1,
    pub actual_failure: Option<FailureOracleV1>,
    pub exact_failure_reproduced: bool,
}

pub trait ReplayDriverV1<I> {
    type Error: std::error::Error;

    fn restore(&mut self, snapshot: &[u8]) -> Result<(), Self::Error>;
    fn apply_external(&mut self, input: &I) -> Result<ReplayEvidenceV1, Self::Error>;
    fn observed_failure(&self) -> Option<FailureOracleV1>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReproReplayEngineV1 {
    pub maximum_events: usize,
}

#[derive(Debug, Error)]
pub enum ReplayErrorV1 {
    #[error("replay event bound is zero or exceeded")]
    Bounds,
    #[error("replay trace is malformed: {0}")]
    Trace(String),
    #[error("replay driver failed: {0}")]
    Driver(String),
    #[error("replay capsule failed validation: {0}")]
    Capsule(#[from] CapsuleErrorV1),
}

impl ReproReplayEngineV1 {
    pub fn replay<I, D>(
        &self,
        snapshot: &[u8],
        events: &[RecordedReplayEventV1<I>],
        expected_failure: FailureOracleV1,
        driver: &mut D,
    ) -> Result<ReplayReportV1, ReplayErrorV1>
    where
        D: ReplayDriverV1<I>,
    {
        if self.maximum_events == 0 || events.len() > self.maximum_events {
            return Err(ReplayErrorV1::Bounds);
        }
        if events
            .windows(2)
            .any(|pair| pair[0].sequence >= pair[1].sequence)
            || events.iter().any(|event| {
                event.expected.sequence != event.sequence
                    || event.expected.mechanical_digest.is_empty()
                    || event.expected.kernel_digest.is_empty()
                    || event.expected.diagnostic_root.is_empty()
                    || event
                        .expected
                        .named_digests
                        .iter()
                        .any(|(name, digest)| name.is_empty() || digest.is_empty())
            })
        {
            return Err(ReplayErrorV1::Trace(
                "invalid sequence or evidence".to_owned(),
            ));
        }
        driver
            .restore(snapshot)
            .map_err(|error| ReplayErrorV1::Driver(error.to_string()))?;
        let mut processed_events = 0;
        let mut first_divergence = None;
        for event in events {
            let actual = driver
                .apply_external(&event.input)
                .map_err(|error| ReplayErrorV1::Driver(error.to_string()))?;
            processed_events += 1;
            if first_divergence.is_none() {
                first_divergence = evidence_divergence(&event.expected, &actual);
            }
            if first_divergence.is_some() {
                break;
            }
        }
        let actual_failure = driver.observed_failure();
        let exact_failure_reproduced =
            first_divergence.is_none() && actual_failure.as_ref() == Some(&expected_failure);
        Ok(ReplayReportV1 {
            processed_events,
            first_divergence,
            expected_failure,
            actual_failure,
            exact_failure_reproduced,
        })
    }

    pub fn replay_capsule<I, D>(
        &self,
        capsule: &ReproCapsuleV1,
        limits: CapsuleLimitsV1,
        driver: &mut D,
    ) -> Result<ReplayReportV1, ReplayErrorV1>
    where
        I: serde::de::DeserializeOwned,
        D: ReplayDriverV1<I>,
    {
        capsule.validate(limits)?;
        let snapshot = capsule
            .find_blob(&capsule.manifest.initial_snapshot_digest)?
            .decode(limits)?;
        let trace_blob = capsule.find_blob(&capsule.manifest.trace_digest)?;
        if trace_blob.kind != CapsuleBlobKindV1::Trace {
            return Err(ReplayErrorV1::Trace("trace blob kind mismatch".to_owned()));
        }
        let trace_bytes = trace_blob.decode(limits)?;
        let events: Vec<RecordedReplayEventV1<I>> = serde_json::from_slice(&trace_bytes)
            .map_err(|error| ReplayErrorV1::Trace(error.to_string()))?;
        self.replay(
            &snapshot,
            &events,
            capsule.manifest.failure_oracle.clone(),
            driver,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckpointIndexEntryV1 {
    pub sequence: u64,
    pub snapshot_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckpointIndexV1 {
    pub maximum_entries: usize,
    pub entries: Vec<CheckpointIndexEntryV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SeekPlanV1 {
    pub target_sequence: u64,
    pub checkpoint_sequence: u64,
    pub snapshot_digest: String,
    pub replay_from_index: usize,
}

impl CheckpointIndexV1 {
    pub fn validate(&self) -> Result<(), ReplayErrorV1> {
        if self.maximum_entries == 0
            || self.entries.is_empty()
            || self.entries.len() > self.maximum_entries
            || self
                .entries
                .iter()
                .any(|entry| entry.snapshot_digest.is_empty())
            || self
                .entries
                .windows(2)
                .any(|pair| pair[0].sequence >= pair[1].sequence)
        {
            return Err(ReplayErrorV1::Bounds);
        }
        Ok(())
    }

    pub fn nearest_not_after(&self, target_sequence: u64) -> Result<SeekPlanV1, ReplayErrorV1> {
        self.validate()?;
        let index = self
            .entries
            .partition_point(|entry| entry.sequence <= target_sequence)
            .checked_sub(1)
            .ok_or_else(|| ReplayErrorV1::Trace("no checkpoint before target".to_owned()))?;
        let checkpoint = &self.entries[index];
        Ok(SeekPlanV1 {
            target_sequence,
            checkpoint_sequence: checkpoint.sequence,
            snapshot_digest: checkpoint.snapshot_digest.clone(),
            replay_from_index: index,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BranchComparisonV1 {
    pub shared_prefix_events: usize,
    pub first_divergent_sequence: Option<u64>,
    pub identical: bool,
    pub divergence: Option<ReplayDivergenceV1>,
}

pub fn compare_branches(
    left: &[ReplayEvidenceV1],
    right: &[ReplayEvidenceV1],
    maximum_events: usize,
) -> Result<BranchComparisonV1, ReplayErrorV1> {
    if maximum_events == 0 || left.len() > maximum_events || right.len() > maximum_events {
        return Err(ReplayErrorV1::Bounds);
    }
    let mut shared = 0;
    for (expected, actual) in left.iter().zip(right) {
        if let Some(divergence) = evidence_divergence(expected, actual) {
            return Ok(BranchComparisonV1 {
                shared_prefix_events: shared,
                first_divergent_sequence: Some(expected.sequence.min(actual.sequence)),
                identical: false,
                divergence: Some(divergence),
            });
        }
        shared += 1;
    }
    let length_divergence = left.len() != right.len();
    let first_divergent_sequence = if length_divergence {
        left.get(shared)
            .or_else(|| right.get(shared))
            .map(|evidence| evidence.sequence)
    } else {
        None
    };
    Ok(BranchComparisonV1 {
        shared_prefix_events: shared,
        first_divergent_sequence,
        identical: !length_divergence,
        divergence: first_divergent_sequence.map(|sequence| ReplayDivergenceV1 {
            sequence,
            field: "event_count".to_owned(),
            expected: Some(left.len().to_string()),
            actual: Some(right.len().to_string()),
        }),
    })
}

fn evidence_divergence(
    expected: &ReplayEvidenceV1,
    actual: &ReplayEvidenceV1,
) -> Option<ReplayDivergenceV1> {
    let fields = [
        (
            "sequence",
            expected.sequence.to_string(),
            actual.sequence.to_string(),
        ),
        (
            "mechanical_digest",
            expected.mechanical_digest.clone(),
            actual.mechanical_digest.clone(),
        ),
        (
            "kernel_digest",
            expected.kernel_digest.clone(),
            actual.kernel_digest.clone(),
        ),
        (
            "diagnostic_root",
            expected.diagnostic_root.clone(),
            actual.diagnostic_root.clone(),
        ),
    ];
    for (field, left, right) in fields {
        if left != right {
            return Some(ReplayDivergenceV1 {
                sequence: expected.sequence,
                field: field.to_owned(),
                expected: Some(left),
                actual: Some(right),
            });
        }
    }
    for (name, digest) in &expected.named_digests {
        if actual.named_digests.get(name) != Some(digest) {
            return Some(ReplayDivergenceV1 {
                sequence: expected.sequence,
                field: format!("named_digest/{name}"),
                expected: Some(digest.clone()),
                actual: actual.named_digests.get(name).cloned(),
            });
        }
    }
    for (name, digest) in &actual.named_digests {
        if !expected.named_digests.contains_key(name) {
            return Some(ReplayDivergenceV1 {
                sequence: expected.sequence,
                field: format!("named_digest/{name}"),
                expected: None,
                actual: Some(digest.clone()),
            });
        }
    }
    if expected.failure != actual.failure {
        return Some(ReplayDivergenceV1 {
            sequence: expected.sequence,
            field: "failure_oracle".to_owned(),
            expected: expected.failure.as_ref().map(|value| format!("{value:?}")),
            actual: actual.failure.as_ref().map(|value| format!("{value:?}")),
        });
    }
    None
}
