//! Checked deterministic Cartesian expansion for experiment dimensions.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::experiment::{
    ExperimentDimensionKindV1, ExperimentDimensionV1, ExperimentErrorV1, ExperimentValueV1,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentCaseV1 {
    pub ordinal: usize,
    pub assignments: BTreeMap<ExperimentDimensionKindV1, ExperimentValueV1>,
}

pub fn expand_experiment_matrix_v1(
    dimensions: &[ExperimentDimensionV1],
    maximum_cases: usize,
) -> Result<Vec<ExperimentCaseV1>, ExperimentErrorV1> {
    if maximum_cases == 0
        || dimensions
            .windows(2)
            .any(|pair| pair[0].kind >= pair[1].kind)
        || dimensions.iter().any(|dimension| {
            dimension.values.is_empty()
                || dimension.values.windows(2).any(|pair| pair[0] >= pair[1])
                || dimension.values.iter().any(|value| {
                    matches!(value, ExperimentValueV1::Identity(identity) if identity.is_empty())
                })
        })
    {
        return Err(ExperimentErrorV1::Invalid);
    }
    let case_count = dimensions
        .iter()
        .try_fold(1_usize, |count, dimension| {
            count.checked_mul(dimension.values.len())
        })
        .ok_or(ExperimentErrorV1::Budget)?;
    if case_count > maximum_cases {
        return Err(ExperimentErrorV1::Budget);
    }
    let mut assignments = vec![BTreeMap::new()];
    for dimension in dimensions {
        let mut expanded = Vec::with_capacity(
            assignments
                .len()
                .checked_mul(dimension.values.len())
                .ok_or(ExperimentErrorV1::Budget)?,
        );
        for existing in assignments {
            for value in &dimension.values {
                let mut candidate = existing.clone();
                candidate.insert(dimension.kind, value.clone());
                expanded.push(candidate);
            }
        }
        assignments = expanded;
    }
    Ok(assignments
        .into_iter()
        .enumerate()
        .map(|(ordinal, assignments)| ExperimentCaseV1 {
            ordinal,
            assignments,
        })
        .collect())
}
