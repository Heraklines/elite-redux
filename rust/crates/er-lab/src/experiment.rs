//! Deterministic experiment plans and backend-neutral execution.

use er_dev_types::{EvidenceProfile, ExternalTraceInputV7};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::artifact_store::LabArtifactIdV1;
use crate::coverage::{CoverageObservationV1, CoverageTargetV1};
use crate::matrix::{ExperimentCaseV1, expand_experiment_matrix_v1};
use crate::preset::ScenarioPresetIdV1;
use crate::scenario::{ReproCapsuleIdV1, ScenarioSpecificationV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ScenarioSourceV1 {
    Specification(Box<ScenarioSpecificationV1>),
    Preset(ScenarioPresetIdV1),
    Snapshot(LabArtifactIdV1),
    Capsule(ReproCapsuleIdV1),
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExperimentDimensionKindV1 {
    Seed,
    Species,
    Move,
    Ability,
    HeldItem,
    Status,
    Weather,
    Terrain,
    Format,
    SeatOwnership,
    NetworkDelay,
    PacketLoss,
    PresentationDelay,
    StorageOutcome,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ExperimentValueV1 {
    Identity(String),
    Integer(i64),
    Boolean(bool),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentDimensionV1 {
    pub kind: ExperimentDimensionKindV1,
    pub values: Vec<ExperimentValueV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentDriverV1 {
    pub events: Vec<ExternalTraceInputV7>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaultPlanV1 {
    pub external_events: Vec<ExternalTraceInputV7>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ExperimentAssertionV1 {
    MechanicalDigest(String),
    ControlKind(String),
    NoFailure,
    FailureOracle(String),
    StatePredicate(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentBudgetV1 {
    pub maximum_cases: usize,
    pub maximum_events_per_case: usize,
    pub maximum_total_events: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentPlanV1 {
    pub scenario: ScenarioSourceV1,
    pub dimensions: Vec<ExperimentDimensionV1>,
    pub driver: ExperimentDriverV1,
    pub faults: Option<FaultPlanV1>,
    pub assertions: Vec<ExperimentAssertionV1>,
    pub coverage: Vec<CoverageTargetV1>,
    pub evidence: EvidenceProfile,
    pub budget: ExperimentBudgetV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentCaseResultV1 {
    pub ordinal: usize,
    pub passed: bool,
    pub failure_oracle: Option<String>,
    pub coverage: CoverageObservationV1,
    pub deterministic_checksum: String,
    pub executed_events: usize,
    pub capsule: Option<LabArtifactIdV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentReportV1 {
    pub cases: usize,
    pub passed: usize,
    pub failed: usize,
    pub unique_failures: Vec<String>,
    pub coverage: CoverageObservationV1,
    pub deterministic_checksum: String,
    pub results: Vec<ExperimentCaseResultV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ExperimentErrorV1 {
    #[error("experiment plan, dimension, assertion, or bound is invalid")]
    Invalid,
    #[error("experiment matrix exceeds its budget")]
    Budget,
    #[error("experiment case failed to execute: {0}")]
    Executor(String),
    #[error("experiment canonical encoding failed: {0}")]
    Canonical(String),
}

#[derive(Clone, Copy, Debug)]
pub struct ExperimentExecutionRequestV1<'a> {
    pub scenario: &'a ScenarioSourceV1,
    pub case: &'a ExperimentCaseV1,
    pub driver: &'a ExperimentDriverV1,
    pub faults: Option<&'a FaultPlanV1>,
    pub assertions: &'a [ExperimentAssertionV1],
    pub coverage: &'a [CoverageTargetV1],
    pub evidence: EvidenceProfile,
}

pub trait ExperimentCaseExecutorV1: std::fmt::Debug {
    fn execute(
        &self,
        request: ExperimentExecutionRequestV1<'_>,
    ) -> Result<ExperimentCaseResultV1, String>;
}

pub fn run_experiment_v1<E: ExperimentCaseExecutorV1>(
    plan: &ExperimentPlanV1,
    executor: &E,
) -> Result<ExperimentReportV1, ExperimentErrorV1> {
    validate_plan(plan)?;
    let cases = expand_experiment_matrix_v1(&plan.dimensions, plan.budget.maximum_cases)?;
    let per_case_events = plan
        .driver
        .events
        .len()
        .checked_add(
            plan.faults
                .as_ref()
                .map_or(0, |faults| faults.external_events.len()),
        )
        .ok_or(ExperimentErrorV1::Budget)?;
    let total_events = per_case_events
        .checked_mul(cases.len())
        .ok_or(ExperimentErrorV1::Budget)?;
    if per_case_events > plan.budget.maximum_events_per_case
        || total_events > plan.budget.maximum_total_events
    {
        return Err(ExperimentErrorV1::Budget);
    }
    let mut results = Vec::with_capacity(cases.len());
    for case in &cases {
        let mut result = executor
            .execute(ExperimentExecutionRequestV1 {
                scenario: &plan.scenario,
                case,
                driver: &plan.driver,
                faults: plan.faults.as_ref(),
                assertions: &plan.assertions,
                coverage: &plan.coverage,
                evidence: plan.evidence,
            })
            .map_err(ExperimentErrorV1::Executor)?;
        result.ordinal = case.ordinal;
        results.push(result);
    }
    let passed = results.iter().filter(|result| result.passed).count();
    let mut unique_failures = results
        .iter()
        .filter_map(|result| result.failure_oracle.clone())
        .collect::<Vec<_>>();
    unique_failures.sort();
    unique_failures.dedup();
    let mut reached = results
        .iter()
        .flat_map(|result| result.coverage.reached.iter().cloned())
        .collect::<Vec<_>>();
    reached.sort();
    reached.dedup();
    let bytes = er_canonical::canonical_bytes(&results)
        .map_err(|error| ExperimentErrorV1::Canonical(error.to_string()))?;
    Ok(ExperimentReportV1 {
        cases: results.len(),
        passed,
        failed: results.len() - passed,
        unique_failures,
        coverage: CoverageObservationV1 { reached },
        deterministic_checksum: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
        results,
    })
}

fn validate_plan(plan: &ExperimentPlanV1) -> Result<(), ExperimentErrorV1> {
    if plan.budget.maximum_cases == 0
        || plan.budget.maximum_events_per_case == 0
        || plan.budget.maximum_total_events == 0
        || plan.assertions.is_empty()
        || plan
            .dimensions
            .windows(2)
            .any(|pair| pair[0].kind >= pair[1].kind)
        || plan.coverage.windows(2).any(|pair| pair[0] >= pair[1])
        || plan.driver.events.len() > plan.budget.maximum_events_per_case
    {
        return Err(ExperimentErrorV1::Invalid);
    }
    Ok(())
}
