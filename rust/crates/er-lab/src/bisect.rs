//! Typed hermetic cross-version capsule bisect without shell-command input.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scenario::ReproCapsuleIdV1;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GitRevisionV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HermeticBuildIdentityV1 {
    pub toolchain: String,
    pub cargo_lock_digest: String,
    pub target: String,
    pub profile: String,
    pub feature_digest: String,
    pub environment_digest: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BisectOutcomeV1 {
    Good,
    Bad,
    Incompatible,
    BuildFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BisectPlanV1 {
    pub capsule: ReproCapsuleIdV1,
    pub exact_failure_oracle: String,
    pub ordered_revisions: Vec<GitRevisionV1>,
    pub build: HermeticBuildIdentityV1,
    pub maximum_builds: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BisectStepV1 {
    pub revision: GitRevisionV1,
    pub outcome: BisectOutcomeV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BisectReportV1 {
    pub exact_first_bad: Option<GitRevisionV1>,
    pub last_good: Option<GitRevisionV1>,
    pub steps: Vec<BisectStepV1>,
    pub incompatible: Vec<GitRevisionV1>,
    pub build_failures: Vec<GitRevisionV1>,
    pub complete: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BisectErrorV1 {
    #[error("bisect plan, revision, identity, or budget is invalid")]
    Invalid,
    #[error("bisect endpoints are not GOOD and BAD")]
    Endpoints,
    #[error("bisect backend failed: {0}")]
    Backend(String),
}

pub trait HermeticBisectBackendV1: std::fmt::Debug {
    fn evaluate(
        &self,
        revision: &GitRevisionV1,
        capsule: &ReproCapsuleIdV1,
        exact_failure_oracle: &str,
        build: &HermeticBuildIdentityV1,
    ) -> Result<BisectOutcomeV1, String>;
}

pub fn bisect_reproduction_v1<B: HermeticBisectBackendV1>(
    plan: &BisectPlanV1,
    backend: &B,
) -> Result<BisectReportV1, BisectErrorV1> {
    validate_plan(plan)?;
    let mut cache = BTreeMap::new();
    let mut steps = Vec::new();
    let first = evaluate_index(0, plan, backend, &mut cache, &mut steps)?;
    let last_index = plan.ordered_revisions.len() - 1;
    let last = evaluate_index(last_index, plan, backend, &mut cache, &mut steps)?;
    if first != BisectOutcomeV1::Good || last != BisectOutcomeV1::Bad {
        return Err(BisectErrorV1::Endpoints);
    }
    let mut low = 0_usize;
    let mut high = last_index;
    let mut complete = true;
    while high - low > 1 {
        if steps.len() == plan.maximum_builds {
            complete = false;
            break;
        }
        let middle = low + (high - low) / 2;
        match evaluate_index(middle, plan, backend, &mut cache, &mut steps)? {
            BisectOutcomeV1::Good => low = middle,
            BisectOutcomeV1::Bad => high = middle,
            BisectOutcomeV1::Incompatible | BisectOutcomeV1::BuildFailed => {
                complete = false;
                break;
            }
        }
    }
    let mut incompatible = cache
        .iter()
        .filter(|(_, outcome)| **outcome == BisectOutcomeV1::Incompatible)
        .map(|(index, _)| plan.ordered_revisions[*index].clone())
        .collect::<Vec<_>>();
    incompatible.sort();
    let mut build_failures = cache
        .iter()
        .filter(|(_, outcome)| **outcome == BisectOutcomeV1::BuildFailed)
        .map(|(index, _)| plan.ordered_revisions[*index].clone())
        .collect::<Vec<_>>();
    build_failures.sort();
    Ok(BisectReportV1 {
        exact_first_bad: complete.then(|| plan.ordered_revisions[high].clone()),
        last_good: complete.then(|| plan.ordered_revisions[low].clone()),
        steps,
        incompatible,
        build_failures,
        complete,
    })
}

fn evaluate_index<B: HermeticBisectBackendV1>(
    index: usize,
    plan: &BisectPlanV1,
    backend: &B,
    cache: &mut BTreeMap<usize, BisectOutcomeV1>,
    steps: &mut Vec<BisectStepV1>,
) -> Result<BisectOutcomeV1, BisectErrorV1> {
    if let Some(outcome) = cache.get(&index) {
        return Ok(*outcome);
    }
    if steps.len() == plan.maximum_builds {
        return Err(BisectErrorV1::Invalid);
    }
    let revision = &plan.ordered_revisions[index];
    let outcome = backend
        .evaluate(
            revision,
            &plan.capsule,
            &plan.exact_failure_oracle,
            &plan.build,
        )
        .map_err(BisectErrorV1::Backend)?;
    cache.insert(index, outcome);
    steps.push(BisectStepV1 {
        revision: revision.clone(),
        outcome,
    });
    Ok(outcome)
}

fn validate_plan(plan: &BisectPlanV1) -> Result<(), BisectErrorV1> {
    let identity_fields = [
        &plan.build.toolchain,
        &plan.build.cargo_lock_digest,
        &plan.build.target,
        &plan.build.profile,
        &plan.build.feature_digest,
        &plan.build.environment_digest,
    ];
    if plan.capsule.0.is_empty()
        || plan.exact_failure_oracle.is_empty()
        || plan.maximum_builds < 2
        || plan.ordered_revisions.len() < 2
        || plan.ordered_revisions.len() > 1_000_000
        || identity_fields
            .iter()
            .any(|value| value.is_empty() || value.as_str() == "UNKNOWN")
        || plan.ordered_revisions.iter().any(|revision| {
            revision.0.len() != 40
                || !revision
                    .0
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        || plan
            .ordered_revisions
            .windows(2)
            .any(|pair| pair[0] == pair[1])
    {
        return Err(BisectErrorV1::Invalid);
    }
    Ok(())
}
