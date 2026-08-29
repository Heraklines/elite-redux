//! Deterministic work and diagnostic wall-clock evidence.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeterministicCostEvidenceV1 {
    pub internal_events: u64,
    pub hooks_collected: u64,
    pub conditions_evaluated: u64,
    pub selectors_resolved: u64,
    pub query_modifiers: u64,
    pub rng_draws: u64,
    pub mutations: u64,
    pub materials_encoded: u64,
    pub bytes_hashed: u64,
    pub ui_projections: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WallClockPerformanceEvidenceV1 {
    pub total_nanos: u64,
    pub allocations: u64,
    pub bytes_allocated: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceAttributionV1 {
    pub subsystem: String,
    pub behavior_unit: Option<String>,
    pub content_id: Option<String>,
    pub operation_id: Option<String>,
    pub transition_id: Option<String>,
    pub environment_id: Option<u64>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CostEvidenceErrorV1 {
    #[error("deterministic cost aggregation overflowed")]
    Overflow,
    #[error("performance attribution subsystem is empty")]
    Attribution,
}

impl DeterministicCostEvidenceV1 {
    pub fn checked_add(&self, other: &Self) -> Result<Self, CostEvidenceErrorV1> {
        macro_rules! add {
            ($field:ident) => {
                self.$field
                    .checked_add(other.$field)
                    .ok_or(CostEvidenceErrorV1::Overflow)?
            };
        }
        Ok(Self {
            internal_events: add!(internal_events),
            hooks_collected: add!(hooks_collected),
            conditions_evaluated: add!(conditions_evaluated),
            selectors_resolved: add!(selectors_resolved),
            query_modifiers: add!(query_modifiers),
            rng_draws: add!(rng_draws),
            mutations: add!(mutations),
            materials_encoded: add!(materials_encoded),
            bytes_hashed: add!(bytes_hashed),
            ui_projections: add!(ui_projections),
        })
    }
}
