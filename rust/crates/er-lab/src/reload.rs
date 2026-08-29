//! Content-only reload preflight on an isolated session fork.

use er_dev_types::ExternalTraceInputV7;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::content_diff::ContentDiffReportV1;
use crate::incremental::ContentFragmentV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloadReplayEvidenceV1 {
    pub sequence: u64,
    pub mechanical_digest: String,
    pub control_digest: String,
    pub invariant_failures: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentReloadPlanV1 {
    pub current_identity: String,
    pub candidate_identity: String,
    pub diff: ContentDiffReportV1,
    pub recent_trace: Vec<ExternalTraceInputV7>,
    pub expected: Vec<ReloadReplayEvidenceV1>,
    pub maximum_events: usize,
    pub migrate_active_session: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentReloadReportV1 {
    pub compatible: bool,
    pub approved_for_new_sessions: bool,
    pub active_session_migrated: bool,
    pub first_divergent_sequence: Option<u64>,
    pub expected_digest: Option<String>,
    pub actual_digest: Option<String>,
    pub invariant_failures: Vec<String>,
    pub candidate_identity: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ContentReloadErrorV1 {
    #[error("content reload plan, identity, trace, or bound is invalid")]
    Invalid,
    #[error("content reload backend failed: {0}")]
    Backend(String),
}

pub trait ContentReloadBackendV1: std::fmt::Debug {
    type Prepared: std::fmt::Debug;
    type Fork: std::fmt::Debug;

    fn prepare_candidate(
        &self,
        fragments: &[ContentFragmentV1],
    ) -> Result<(String, Self::Prepared), String>;
    fn fork_current(&self) -> Result<Self::Fork, String>;
    fn migrate_fork(
        &self,
        fork: Self::Fork,
        prepared: &Self::Prepared,
    ) -> Result<Self::Fork, String>;
    fn replay(
        &self,
        fork: &mut Self::Fork,
        trace: &[ExternalTraceInputV7],
    ) -> Result<Vec<ReloadReplayEvidenceV1>, String>;
}

pub fn preflight_content_reload_v1<B: ContentReloadBackendV1>(
    plan: &ContentReloadPlanV1,
    candidate_fragments: &[ContentFragmentV1],
    backend: &B,
) -> Result<ContentReloadReportV1, ContentReloadErrorV1> {
    if plan.current_identity.is_empty()
        || plan.candidate_identity.is_empty()
        || plan.current_identity == plan.candidate_identity
        || plan.diff.current_identity != plan.current_identity
        || plan.diff.candidate_identity != plan.candidate_identity
        || plan.maximum_events == 0
        || plan.recent_trace.len() > plan.maximum_events
        || plan.expected.len() != plan.recent_trace.len()
        || plan
            .expected
            .windows(2)
            .any(|pair| pair[0].sequence >= pair[1].sequence)
        || plan.expected.iter().any(|evidence| {
            evidence.mechanical_digest.is_empty() || evidence.control_digest.is_empty()
        })
    {
        return Err(ContentReloadErrorV1::Invalid);
    }
    let (identity, prepared) = backend
        .prepare_candidate(candidate_fragments)
        .map_err(ContentReloadErrorV1::Backend)?;
    if identity != plan.candidate_identity {
        return Err(ContentReloadErrorV1::Invalid);
    }
    let fork = backend
        .fork_current()
        .map_err(ContentReloadErrorV1::Backend)?;
    let mut fork = backend
        .migrate_fork(fork, &prepared)
        .map_err(ContentReloadErrorV1::Backend)?;
    let actual = backend
        .replay(&mut fork, &plan.recent_trace)
        .map_err(ContentReloadErrorV1::Backend)?;
    if actual.len() != plan.expected.len() {
        return Ok(incompatible(plan, None, None, None, Vec::new()));
    }
    for (expected, actual) in plan.expected.iter().zip(&actual) {
        if expected.sequence != actual.sequence
            || expected.mechanical_digest != actual.mechanical_digest
            || expected.control_digest != actual.control_digest
            || !actual.invariant_failures.is_empty()
        {
            return Ok(incompatible(
                plan,
                Some(expected.sequence.min(actual.sequence)),
                Some(expected.mechanical_digest.clone()),
                Some(actual.mechanical_digest.clone()),
                actual.invariant_failures.clone(),
            ));
        }
    }
    Ok(ContentReloadReportV1 {
        compatible: true,
        approved_for_new_sessions: true,
        active_session_migrated: false,
        first_divergent_sequence: None,
        expected_digest: None,
        actual_digest: None,
        invariant_failures: Vec::new(),
        candidate_identity: plan.candidate_identity.clone(),
    })
}

fn incompatible(
    plan: &ContentReloadPlanV1,
    sequence: Option<u64>,
    expected: Option<String>,
    actual: Option<String>,
    invariant_failures: Vec<String>,
) -> ContentReloadReportV1 {
    ContentReloadReportV1 {
        compatible: false,
        approved_for_new_sessions: false,
        active_session_migrated: false,
        first_divergent_sequence: sequence,
        expected_digest: expected,
        actual_digest: actual,
        invariant_failures,
        candidate_identity: plan.candidate_identity.clone(),
    }
}
