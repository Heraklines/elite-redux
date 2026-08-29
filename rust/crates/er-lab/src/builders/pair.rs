//! Shared-specification pair construction and recovery replay boundaries.

use er_game::m7_content::PreparedGameContentV1;
use er_sim::snapshot::RestorablePairSnapshotV2;
use er_types::SeatId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scenario::{PairRecoveryScenarioV1, ScenarioSpecificationV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairStableScenarioV1 {
    pub shared: Box<ScenarioSpecificationV1>,
    pub host_seat: SeatId,
    pub guest_seat: SeatId,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PairScenarioErrorV1 {
    #[error("pair seats or shared specification are invalid")]
    Invalid,
    #[error("pair constructor failed: {0}")]
    Constructor(String),
    #[error("mid-transaction pair recovery requires capsule replay")]
    ReplayRequired,
}

pub trait CanonicalPairScenarioFactoryV1: std::fmt::Debug {
    fn construct_pair(
        &self,
        specification: &ScenarioSpecificationV1,
        host_seat: SeatId,
        guest_seat: SeatId,
        content: &PreparedGameContentV1,
    ) -> Result<RestorablePairSnapshotV2, String>;
}

pub fn build_pair_v1<F: CanonicalPairScenarioFactoryV1>(
    factory: &F,
    specification: &PairStableScenarioV1,
    content: &PreparedGameContentV1,
) -> Result<RestorablePairSnapshotV2, PairScenarioErrorV1> {
    if specification.host_seat == specification.guest_seat
        || matches!(
            specification.shared.as_ref(),
            ScenarioSpecificationV1::SoloRecovery(_) | ScenarioSpecificationV1::PairRecovery(_)
        )
    {
        return Err(PairScenarioErrorV1::Invalid);
    }
    factory
        .construct_pair(
            &specification.shared,
            specification.host_seat,
            specification.guest_seat,
            content,
        )
        .map_err(PairScenarioErrorV1::Constructor)
}

pub fn recovery_requires_replay_v1(
    recovery: &PairRecoveryScenarioV1,
) -> Result<(), PairScenarioErrorV1> {
    if recovery.capsule.0.is_empty() {
        Err(PairScenarioErrorV1::Invalid)
    } else {
        Err(PairScenarioErrorV1::ReplayRequired)
    }
}
