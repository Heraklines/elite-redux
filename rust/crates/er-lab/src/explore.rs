//! Deterministic coverage-guided exploration over raw/external event traces.

use std::collections::{BTreeSet, VecDeque};

use er_dev_types::ExternalTraceInputV7;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::artifact_store::LabArtifactIdV1;
use crate::coverage::{CoverageObservationV1, CoverageTargetV1, CoverageTrackerV1};
use crate::scenario::ScenarioSpecificationV1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExplorerBudgetV1 {
    pub maximum_executions: usize,
    pub maximum_trace_events: usize,
    pub maximum_retained_traces: usize,
    pub maximum_mutations_per_trace: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExplorerExecutionV1 {
    pub coverage: CoverageObservationV1,
    pub failure_oracle: Option<String>,
    pub capsule: Option<LabArtifactIdV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExplorerReportV1 {
    pub target: CoverageTargetV1,
    pub reached: bool,
    pub executions: usize,
    pub retained_novel_traces: usize,
    pub minimal_trace: Option<Vec<ExternalTraceInputV7>>,
    pub capsule: Option<LabArtifactIdV1>,
    pub coverage: CoverageObservationV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ExplorerErrorV1 {
    #[error("explorer target, seed trace, or budget is invalid")]
    Invalid,
    #[error("explorer backend failed: {0}")]
    Backend(String),
    #[error("explorer canonical encoding failed: {0}")]
    Canonical(String),
}

pub trait CoverageExplorerBackendV1: std::fmt::Debug {
    fn execute(
        &self,
        scenario: &ScenarioSpecificationV1,
        trace: &[ExternalTraceInputV7],
    ) -> Result<ExplorerExecutionV1, String>;
    fn mutations(
        &self,
        trace: &[ExternalTraceInputV7],
        maximum: usize,
    ) -> Vec<Vec<ExternalTraceInputV7>>;
    fn minimize_success(
        &self,
        scenario: &ScenarioSpecificationV1,
        trace: &[ExternalTraceInputV7],
        target: &CoverageTargetV1,
    ) -> Result<Vec<ExternalTraceInputV7>, String>;
}

pub fn explore_coverage_v1<B: CoverageExplorerBackendV1>(
    scenario: &ScenarioSpecificationV1,
    seed_traces: Vec<Vec<ExternalTraceInputV7>>,
    target: CoverageTargetV1,
    budget: ExplorerBudgetV1,
    backend: &B,
) -> Result<ExplorerReportV1, ExplorerErrorV1> {
    if budget.maximum_executions == 0
        || budget.maximum_trace_events == 0
        || budget.maximum_retained_traces == 0
        || budget.maximum_mutations_per_trace == 0
        || seed_traces.is_empty()
        || seed_traces
            .iter()
            .any(|trace| trace.len() > budget.maximum_trace_events)
    {
        return Err(ExplorerErrorV1::Invalid);
    }
    let mut queue = VecDeque::new();
    let mut seen = BTreeSet::new();
    for trace in seed_traces {
        let digest = trace_digest(&trace)?;
        if seen.insert(digest) {
            queue.push_back(trace);
        }
    }
    let mut tracker = CoverageTrackerV1::new(100_000)
        .map_err(|error| ExplorerErrorV1::Backend(error.to_string()))?;
    let mut executions = 0;
    let mut retained = 0;
    let mut reached_trace = None;
    let mut reached_capsule = None;
    while let Some(trace) = queue.pop_front() {
        if executions == budget.maximum_executions {
            break;
        }
        executions += 1;
        let result = backend
            .execute(scenario, &trace)
            .map_err(ExplorerErrorV1::Backend)?;
        let novel = tracker
            .observe(result.coverage)
            .map_err(|error| ExplorerErrorV1::Backend(error.to_string()))?;
        if tracker.reached(&target) {
            reached_trace = Some(
                backend
                    .minimize_success(scenario, &trace, &target)
                    .map_err(ExplorerErrorV1::Backend)?,
            );
            reached_capsule = result.capsule;
            break;
        }
        if !novel.is_empty() {
            if retained == budget.maximum_retained_traces {
                continue;
            }
            retained += 1;
        }
        let mutations = backend.mutations(&trace, budget.maximum_mutations_per_trace);
        let mut keyed = mutations
            .into_iter()
            .filter(|candidate| candidate.len() <= budget.maximum_trace_events)
            .map(|candidate| Ok((trace_digest(&candidate)?, candidate)))
            .collect::<Result<Vec<_>, ExplorerErrorV1>>()?;
        keyed.sort_by(|left, right| left.0.cmp(&right.0));
        keyed.truncate(budget.maximum_mutations_per_trace);
        for (digest, candidate) in keyed {
            if seen.insert(digest) {
                queue.push_back(candidate);
            }
        }
    }
    Ok(ExplorerReportV1 {
        target: target.clone(),
        reached: reached_trace.is_some(),
        executions,
        retained_novel_traces: retained,
        minimal_trace: reached_trace,
        capsule: reached_capsule,
        coverage: tracker.snapshot(),
    })
}

fn trace_digest(trace: &[ExternalTraceInputV7]) -> Result<String, ExplorerErrorV1> {
    let bytes = er_canonical::canonical_bytes(&trace)
        .map_err(|error| ExplorerErrorV1::Canonical(error.to_string()))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}
