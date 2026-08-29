//! Deterministic minimal counterfactual search over declared dimensions.

use er_dev_types::ExternalTraceInputV7;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scenario::ReproCapsuleIdV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum CounterfactualObjectiveV1 {
    AvoidFailure(String),
    ReachCoverage(String),
    MechanicalDigest(String),
    ControlKind(String),
    StatePredicate(String),
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CounterfactualDimensionV1 {
    RawInput,
    Time,
    NetworkFault,
    PresentationOutcome,
    StorageOutcome,
    ScenarioParameter,
    ContentParameter,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum CounterfactualChangeV1 {
    ReplaceExternalEvent {
        index: usize,
        event: ExternalTraceInputV7,
    },
    InsertExternalEvent {
        index: usize,
        event: ExternalTraceInputV7,
    },
    RemoveExternalEvent {
        index: usize,
    },
    ScenarioParameter {
        path: String,
        canonical_value: Vec<u8>,
    },
    ContentParameter {
        identity: String,
        canonical_value: Vec<u8>,
    },
}

impl CounterfactualChangeV1 {
    pub fn dimension(&self) -> CounterfactualDimensionV1 {
        match self {
            Self::ReplaceExternalEvent { event, .. } | Self::InsertExternalEvent { event, .. } => {
                match event {
                    ExternalTraceInputV7::RawInput(_) => CounterfactualDimensionV1::RawInput,
                    ExternalTraceInputV7::AdvanceTime(_) => CounterfactualDimensionV1::Time,
                    ExternalTraceInputV7::NetworkFrame(_)
                    | ExternalTraceInputV7::TransportChanged(_) => {
                        CounterfactualDimensionV1::NetworkFault
                    }
                    ExternalTraceInputV7::PresentationSettled(_)
                    | ExternalTraceInputV7::RendererFault(_)
                    | ExternalTraceInputV7::AssetResult(_) => {
                        CounterfactualDimensionV1::PresentationOutcome
                    }
                    ExternalTraceInputV7::StorageResult(_) => {
                        CounterfactualDimensionV1::StorageOutcome
                    }
                    ExternalTraceInputV7::Suspend
                    | ExternalTraceInputV7::Resume
                    | ExternalTraceInputV7::ModelInferenceCompleted(_)
                    | ExternalTraceInputV7::PlatformLifecycleEvent(_) => {
                        CounterfactualDimensionV1::NetworkFault
                    }
                }
            }
            Self::RemoveExternalEvent { .. } => CounterfactualDimensionV1::RawInput,
            Self::ScenarioParameter { .. } => CounterfactualDimensionV1::ScenarioParameter,
            Self::ContentParameter { .. } => CounterfactualDimensionV1::ContentParameter,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CounterfactualCandidateV1 {
    pub changes: Vec<CounterfactualChangeV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CounterfactualBudgetV1 {
    pub maximum_candidates: usize,
    pub maximum_changes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CounterfactualQueryV1 {
    pub baseline: ReproCapsuleIdV1,
    pub objective: CounterfactualObjectiveV1,
    pub dimensions: Vec<CounterfactualDimensionV1>,
    pub candidates: Vec<CounterfactualCandidateV1>,
    pub budget: CounterfactualBudgetV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CounterfactualEvaluationV1 {
    pub objective_satisfied: bool,
    pub valid: bool,
    pub distance: u64,
    pub result_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CounterfactualReportV1 {
    pub evaluated: usize,
    pub solution: Option<CounterfactualCandidateV1>,
    pub evaluation: Option<CounterfactualEvaluationV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CounterfactualErrorV1 {
    #[error("counterfactual query, dimension, or budget is invalid")]
    Invalid,
    #[error("counterfactual backend failed: {0}")]
    Backend(String),
    #[error("counterfactual canonical encoding failed: {0}")]
    Canonical(String),
}

pub trait CounterfactualBackendV1: std::fmt::Debug {
    fn evaluate(
        &self,
        baseline: &ReproCapsuleIdV1,
        objective: &CounterfactualObjectiveV1,
        candidate: &CounterfactualCandidateV1,
    ) -> Result<CounterfactualEvaluationV1, String>;
}

pub fn search_counterfactual_v1<B: CounterfactualBackendV1>(
    mut query: CounterfactualQueryV1,
    backend: &B,
) -> Result<CounterfactualReportV1, CounterfactualErrorV1> {
    query.dimensions.sort();
    query.dimensions.dedup();
    if query.baseline.0.is_empty()
        || query.dimensions.is_empty()
        || query.budget.maximum_candidates == 0
        || query.budget.maximum_changes == 0
        || query.candidates.len() > query.budget.maximum_candidates
        || query.candidates.iter().any(|candidate| {
            candidate.changes.is_empty()
                || candidate.changes.len() > query.budget.maximum_changes
                || candidate
                    .changes
                    .iter()
                    .any(|change| !query.dimensions.contains(&change.dimension()))
        })
    {
        return Err(CounterfactualErrorV1::Invalid);
    }
    let mut keyed = query
        .candidates
        .into_iter()
        .map(|candidate| {
            let bytes = er_canonical::canonical_bytes(&candidate)
                .map_err(|error| CounterfactualErrorV1::Canonical(error.to_string()))?;
            Ok((candidate.changes.len(), bytes, candidate))
        })
        .collect::<Result<Vec<_>, CounterfactualErrorV1>>()?;
    keyed.sort_by(|left, right| (left.0, &left.1).cmp(&(right.0, &right.1)));
    let mut best: Option<(
        CounterfactualCandidateV1,
        CounterfactualEvaluationV1,
        Vec<u8>,
    )> = None;
    let mut evaluated = 0;
    for (_, key, candidate) in keyed {
        evaluated += 1;
        let evaluation = backend
            .evaluate(&query.baseline, &query.objective, &candidate)
            .map_err(CounterfactualErrorV1::Backend)?;
        if !evaluation.valid
            || !evaluation.objective_satisfied
            || evaluation.result_digest.is_empty()
        {
            continue;
        }
        let replace = best.as_ref().is_none_or(|(_, current, current_key)| {
            (evaluation.distance, &key) < (current.distance, current_key)
        });
        if replace {
            best = Some((candidate, evaluation, key));
        }
    }
    let (solution, evaluation) = best
        .map(|(candidate, evaluation, _)| (Some(candidate), Some(evaluation)))
        .unwrap_or((None, None));
    Ok(CounterfactualReportV1 {
        evaluated,
        solution,
        evaluation,
    })
}
