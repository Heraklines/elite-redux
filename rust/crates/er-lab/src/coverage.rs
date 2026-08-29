//! Closed, bounded M7.2 coverage identities and novelty tracking.

use std::collections::BTreeSet;

use er_types::GameControlKindV2;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum CoverageTargetV1 {
    BehaviorUnit(String),
    MechanicHook(String),
    ControlKind(GameControlKindV2),
    MenuEdge(String),
    MaterialKind(String),
    ScenarioNode(String),
    AiPolicyBranch(String),
    ProtocolTransition(String),
    StatePredicate(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoverageObservationV1 {
    pub reached: Vec<CoverageTargetV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CoverageErrorV1 {
    #[error("coverage bound or identity is invalid")]
    Invalid,
    #[error("coverage capacity is exhausted")]
    Capacity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoverageTrackerV1 {
    maximum_targets: usize,
    reached: BTreeSet<CoverageTargetV1>,
}

impl CoverageTrackerV1 {
    pub fn new(maximum_targets: usize) -> Result<Self, CoverageErrorV1> {
        if maximum_targets == 0 {
            return Err(CoverageErrorV1::Invalid);
        }
        Ok(Self {
            maximum_targets,
            reached: BTreeSet::new(),
        })
    }

    pub fn observe(
        &mut self,
        mut observation: CoverageObservationV1,
    ) -> Result<Vec<CoverageTargetV1>, CoverageErrorV1> {
        observation.reached.sort();
        observation.reached.dedup();
        if observation.reached.iter().any(invalid_target) {
            return Err(CoverageErrorV1::Invalid);
        }
        let novel = observation
            .reached
            .into_iter()
            .filter(|target| !self.reached.contains(target))
            .collect::<Vec<_>>();
        if self
            .reached
            .len()
            .checked_add(novel.len())
            .is_none_or(|count| count > self.maximum_targets)
        {
            return Err(CoverageErrorV1::Capacity);
        }
        self.reached.extend(novel.iter().cloned());
        Ok(novel)
    }

    pub fn reached(&self, target: &CoverageTargetV1) -> bool {
        self.reached.contains(target)
    }

    pub fn snapshot(&self) -> CoverageObservationV1 {
        CoverageObservationV1 {
            reached: self.reached.iter().cloned().collect(),
        }
    }
}

fn invalid_target(target: &CoverageTargetV1) -> bool {
    match target {
        CoverageTargetV1::ControlKind(_) => false,
        CoverageTargetV1::BehaviorUnit(value)
        | CoverageTargetV1::MechanicHook(value)
        | CoverageTargetV1::MenuEdge(value)
        | CoverageTargetV1::MaterialKind(value)
        | CoverageTargetV1::ScenarioNode(value)
        | CoverageTargetV1::AiPolicyBranch(value)
        | CoverageTargetV1::ProtocolTransition(value)
        | CoverageTargetV1::StatePredicate(value) => value.is_empty(),
    }
}
