//! Closed impact-selected mutation testing contracts and execution.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scenario::ReproCapsuleIdV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum MutationOperatorV1 {
    InvertCondition {
        symbol: String,
        ordinal: u32,
    },
    RemoveOperation {
        symbol: String,
        ordinal: u32,
    },
    ChangeNumericSign {
        symbol: String,
        ordinal: u32,
    },
    ChangeSelector {
        symbol: String,
        from: String,
        to: String,
    },
    RemoveRngGate {
        symbol: String,
        ordinal: u32,
    },
    ChangeQueryStage {
        symbol: String,
        from: String,
        to: String,
    },
    SkipMaterialField {
        material: String,
        field: String,
    },
    AllowStaleGeneration {
        symbol: String,
    },
    RemoveFence {
        symbol: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofTargetV1 {
    pub package: String,
    pub test_target: String,
    pub test_name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationCaseV1 {
    pub id: String,
    pub operator: MutationOperatorV1,
    pub proof_targets: Vec<ProofTargetV1>,
    pub capsules: Vec<ReproCapsuleIdV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationPlanV1 {
    pub cases: Vec<MutationCaseV1>,
    pub maximum_cases: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationResultV1 {
    pub id: String,
    pub killed: bool,
    pub evidence: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationReportV1 {
    pub killed: usize,
    pub survived: usize,
    pub results: Vec<MutationResultV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MutationErrorV1 {
    #[error("mutation plan, operator, or linked evidence is invalid")]
    Invalid,
    #[error("mutation backend failed: {0}")]
    Backend(String),
}

pub trait MutationBackendV1: std::fmt::Debug {
    type Applied: std::fmt::Debug;

    fn apply(&self, case: &MutationCaseV1) -> Result<Self::Applied, String>;
    fn execute_linked(
        &self,
        applied: &Self::Applied,
        proof_targets: &[ProofTargetV1],
        capsules: &[ReproCapsuleIdV1],
    ) -> Result<MutationResultV1, String>;
    fn cleanup(&self, applied: Self::Applied) -> Result<(), String>;
}

pub fn run_mutations_v1<B: MutationBackendV1>(
    plan: &MutationPlanV1,
    backend: &B,
) -> Result<MutationReportV1, MutationErrorV1> {
    validate_plan(plan)?;
    let mut results = Vec::with_capacity(plan.cases.len());
    for case in &plan.cases {
        let applied = backend.apply(case).map_err(MutationErrorV1::Backend)?;
        let execution = backend.execute_linked(&applied, &case.proof_targets, &case.capsules);
        let cleanup = backend.cleanup(applied);
        if let Err(error) = cleanup {
            return Err(MutationErrorV1::Backend(error));
        }
        let mut result = execution.map_err(MutationErrorV1::Backend)?;
        result.id = case.id.clone();
        result.evidence.sort();
        result.evidence.dedup();
        results.push(result);
    }
    let killed = results.iter().filter(|result| result.killed).count();
    Ok(MutationReportV1 {
        killed,
        survived: results.len() - killed,
        results,
    })
}

fn validate_plan(plan: &MutationPlanV1) -> Result<(), MutationErrorV1> {
    if plan.maximum_cases == 0
        || plan.cases.is_empty()
        || plan.cases.len() > plan.maximum_cases
        || plan.cases.windows(2).any(|pair| pair[0].id >= pair[1].id)
        || plan.cases.iter().any(|case| {
            case.id.is_empty()
                || (case.proof_targets.is_empty() && case.capsules.is_empty())
                || case.proof_targets.iter().any(invalid_proof_target)
                || case.capsules.iter().any(|capsule| capsule.0.is_empty())
                || invalid_operator(&case.operator)
        })
    {
        return Err(MutationErrorV1::Invalid);
    }
    Ok(())
}

fn invalid_operator(operator: &MutationOperatorV1) -> bool {
    match operator {
        MutationOperatorV1::InvertCondition { symbol, .. }
        | MutationOperatorV1::RemoveOperation { symbol, .. }
        | MutationOperatorV1::ChangeNumericSign { symbol, .. }
        | MutationOperatorV1::RemoveRngGate { symbol, .. }
        | MutationOperatorV1::AllowStaleGeneration { symbol }
        | MutationOperatorV1::RemoveFence { symbol } => symbol.is_empty(),
        MutationOperatorV1::ChangeSelector { symbol, from, to }
        | MutationOperatorV1::ChangeQueryStage { symbol, from, to } => {
            symbol.is_empty() || from.is_empty() || to.is_empty() || from == to
        }
        MutationOperatorV1::SkipMaterialField { material, field } => {
            material.is_empty() || field.is_empty()
        }
    }
}

fn invalid_proof_target(target: &ProofTargetV1) -> bool {
    let safe = |value: &str| {
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    };
    !safe(&target.package)
        || !safe(&target.test_target)
        || target.test_name.as_ref().is_some_and(|name| !safe(name))
}
