//! Hierarchical reproduction-session diffing.

use er_dev_types::{DiagnosticDiffV1, DiagnosticDigestTreeV1, StatePathV1};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::replay::{ReplayErrorV1, ReplayEvidenceV1, compare_branches};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionCapsuleDiffV1 {
    pub mechanically_identical: bool,
    pub shared_prefix_events: usize,
    pub first_divergent_sequence: Option<u64>,
    pub first_divergent_path: Option<StatePathV1>,
    pub digest_diff: Option<DiagnosticDiffV1>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SessionDiffErrorV1 {
    #[error("session diff bound is zero")]
    Bounds,
    #[error("diagnostic digest tree is invalid: {0}")]
    Digest(String),
    #[error("session replay evidence is invalid: {0}")]
    Replay(String),
}

pub fn diff_sessions(
    left_evidence: &[ReplayEvidenceV1],
    right_evidence: &[ReplayEvidenceV1],
    left_tree: Option<&DiagnosticDigestTreeV1>,
    right_tree: Option<&DiagnosticDigestTreeV1>,
    maximum_events: usize,
    maximum_mismatches: usize,
) -> Result<SessionCapsuleDiffV1, SessionDiffErrorV1> {
    if maximum_events == 0 || maximum_mismatches == 0 {
        return Err(SessionDiffErrorV1::Bounds);
    }
    let branch = compare_branches(left_evidence, right_evidence, maximum_events)
        .map_err(map_replay_error)?;
    let (digest_diff, first_divergent_path, truncated, mechanical_tree_match) =
        match (left_tree, right_tree) {
            (Some(left), Some(right)) => {
                left.validate()
                    .map_err(|error| SessionDiffErrorV1::Digest(error.to_string()))?;
                right
                    .validate()
                    .map_err(|error| SessionDiffErrorV1::Digest(error.to_string()))?;
                let difference = left.diff(right, maximum_mismatches);
                let path = difference.first_mismatch.clone();
                let is_truncated = difference.truncated;
                let mechanical_match = left.mechanical_digest == right.mechanical_digest;
                (Some(difference), path, is_truncated, mechanical_match)
            }
            (None, None) => (None, None, false, true),
            _ => (None, None, true, false),
        };
    let stream_mechanical_match = left_evidence
        .iter()
        .zip(right_evidence)
        .all(|(left, right)| left.mechanical_digest == right.mechanical_digest)
        && left_evidence.len() == right_evidence.len();
    Ok(SessionCapsuleDiffV1 {
        mechanically_identical: stream_mechanical_match && mechanical_tree_match,
        shared_prefix_events: branch.shared_prefix_events,
        first_divergent_sequence: branch.first_divergent_sequence,
        first_divergent_path,
        digest_diff,
        truncated,
    })
}

fn map_replay_error(error: ReplayErrorV1) -> SessionDiffErrorV1 {
    SessionDiffErrorV1::Replay(error.to_string())
}
