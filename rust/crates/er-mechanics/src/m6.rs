//! Compile-time M6 Mechanics IR V2 contract surface.
//!
//! Execution DTOs are introduced behind this validated header so the G21
//! identity, ownership, RNG, and budget invariants cannot drift during M6A.

use std::collections::BTreeSet;

use er_types::{
    BehaviorUnitId, M6_MECHANICS_PROGRAM_VERSION, MechanicSourceId, MechanicsProgramId,
    RngSiteDefinitionV1, RngSiteId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgramBudgetV2 {
    pub hook_bindings: u16,
    pub condition_nodes: u16,
    pub selector_nodes: u16,
    pub value_nodes: u16,
    pub operations: u16,
    pub scheduled_events: u16,
    pub rng_draws: u16,
    pub spawned_instances: u16,
    pub presentation_cues: u16,
    pub selected_targets: u16,
}

impl ProgramBudgetV2 {
    pub const CEILING: Self = Self {
        hook_bindings: 96,
        condition_nodes: 384,
        selector_nodes: 192,
        value_nodes: 384,
        operations: 384,
        scheduled_events: 64,
        rng_draws: 96,
        spawned_instances: 96,
        presentation_cues: 192,
        selected_targets: 32,
    };

    pub fn validate(self) -> Result<(), MechanicsProgramV2ContractError> {
        let ceiling = Self::CEILING;
        for (resource, actual, maximum) in [
            ("hook_bindings", self.hook_bindings, ceiling.hook_bindings),
            (
                "condition_nodes",
                self.condition_nodes,
                ceiling.condition_nodes,
            ),
            (
                "selector_nodes",
                self.selector_nodes,
                ceiling.selector_nodes,
            ),
            ("value_nodes", self.value_nodes, ceiling.value_nodes),
            ("operations", self.operations, ceiling.operations),
            (
                "scheduled_events",
                self.scheduled_events,
                ceiling.scheduled_events,
            ),
            ("rng_draws", self.rng_draws, ceiling.rng_draws),
            (
                "spawned_instances",
                self.spawned_instances,
                ceiling.spawned_instances,
            ),
            (
                "presentation_cues",
                self.presentation_cues,
                ceiling.presentation_cues,
            ),
            (
                "selected_targets",
                self.selected_targets,
                ceiling.selected_targets,
            ),
        ] {
            if actual > maximum {
                return Err(MechanicsProgramV2ContractError::BudgetAboveCeiling {
                    resource,
                    actual,
                    maximum,
                });
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RngSiteBindingContractV1 {
    pub site: RngSiteDefinitionV1,
    pub execution_ordinal: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicsProgramV2Contract {
    pub schema_version: u32,
    pub id: MechanicsProgramId,
    pub source: MechanicSourceId,
    pub behavior_units: Vec<BehaviorUnitId>,
    pub rng_sites: Vec<RngSiteBindingContractV1>,
    pub budget: ProgramBudgetV2,
}

impl MechanicsProgramV2Contract {
    pub fn validate(&self) -> Result<(), MechanicsProgramV2ContractError> {
        if self.schema_version != M6_MECHANICS_PROGRAM_VERSION {
            return Err(MechanicsProgramV2ContractError::SchemaVersion {
                actual: self.schema_version,
            });
        }
        if self.id == MechanicsProgramId::ZERO {
            return Err(MechanicsProgramV2ContractError::ZeroProgramId);
        }
        self.source
            .validate()
            .map_err(|_| MechanicsProgramV2ContractError::InvalidSource)?;
        self.budget.validate()?;
        if self.behavior_units.is_empty() {
            return Err(MechanicsProgramV2ContractError::MissingBehaviorUnit);
        }
        let mut previous = None;
        let mut behavior_units = BTreeSet::new();
        for behavior_unit in &self.behavior_units {
            behavior_unit
                .validate()
                .map_err(|_| MechanicsProgramV2ContractError::InvalidBehaviorUnit)?;
            if behavior_unit.source != self.source {
                return Err(MechanicsProgramV2ContractError::BehaviorSourceMismatch);
            }
            if previous.is_some_and(|value| value >= behavior_unit) {
                return Err(MechanicsProgramV2ContractError::BehaviorUnitsNotSortedUnique);
            }
            previous = Some(behavior_unit);
            behavior_units.insert(behavior_unit);
        }
        let mut rng_ids = BTreeSet::<&RngSiteId>::new();
        let mut previous_ordinal = None;
        for binding in &self.rng_sites {
            if !rng_ids.insert(&binding.site.id) {
                return Err(MechanicsProgramV2ContractError::DuplicateRngSite);
            }
            if previous_ordinal.is_some_and(|value| value >= binding.execution_ordinal) {
                return Err(MechanicsProgramV2ContractError::RngSitesNotOrdered);
            }
            previous_ordinal = Some(binding.execution_ordinal);
            let owner = binding
                .site
                .owner
                .as_ref()
                .ok_or(MechanicsProgramV2ContractError::RngSiteMissingOwner)?;
            if !behavior_units.contains(owner) {
                return Err(MechanicsProgramV2ContractError::RngSiteOwnerMismatch);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MechanicsProgramV2ContractError {
    #[error("M6 mechanics program schema must be version 2, got {actual}")]
    SchemaVersion { actual: u32 },
    #[error("mechanics program ID must be positive")]
    ZeroProgramId,
    #[error("mechanics source identity is invalid")]
    InvalidSource,
    #[error("mechanics program must own at least one behavior unit")]
    MissingBehaviorUnit,
    #[error("mechanics behavior-unit identity is invalid")]
    InvalidBehaviorUnit,
    #[error("mechanics behavior unit belongs to a different source")]
    BehaviorSourceMismatch,
    #[error("mechanics behavior units must be strictly sorted and unique")]
    BehaviorUnitsNotSortedUnique,
    #[error("mechanics RNG site is duplicated")]
    DuplicateRngSite,
    #[error("mechanics RNG sites must have strictly increasing execution ordinals")]
    RngSitesNotOrdered,
    #[error("mechanics RNG site must name its behavior-unit owner")]
    RngSiteMissingOwner,
    #[error("mechanics RNG site owner is not owned by the program")]
    RngSiteOwnerMismatch,
    #[error("program budget {resource} {actual} exceeds ceiling {maximum}")]
    BudgetAboveCeiling {
        resource: &'static str,
        actual: u16,
        maximum: u16,
    },
}

#[cfg(test)]
mod tests {
    use er_types::{
        BehaviorUnitKind, BehaviorUnitOrdinal, MechanicSourceKind, ProvenanceHash, SafeU53,
    };

    use super::*;

    fn program() -> MechanicsProgramV2Contract {
        let source = MechanicSourceId::numeric(MechanicSourceKind::Move, SafeU53::new(1).unwrap());
        MechanicsProgramV2Contract {
            schema_version: M6_MECHANICS_PROGRAM_VERSION,
            id: MechanicsProgramId::try_from_u64(1).unwrap(),
            source: source.clone(),
            behavior_units: vec![BehaviorUnitId {
                source,
                unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
                ordinal: BehaviorUnitOrdinal::ZERO,
                provenance_hash: ProvenanceHash::parse("0".repeat(64)).unwrap(),
            }],
            rng_sites: Vec::new(),
            budget: ProgramBudgetV2 {
                hook_bindings: 1,
                condition_nodes: 0,
                selector_nodes: 0,
                value_nodes: 0,
                operations: 1,
                scheduled_events: 0,
                rng_draws: 0,
                spawned_instances: 0,
                presentation_cues: 0,
                selected_targets: 1,
            },
        }
    }

    #[test]
    fn valid_contract_binds_a_sorted_behavior_unit() {
        assert_eq!(program().validate(), Ok(()));
    }

    #[test]
    fn duplicate_behavior_unit_fails_closed() {
        let mut program = program();
        program
            .behavior_units
            .push(program.behavior_units[0].clone());
        assert_eq!(
            program.validate(),
            Err(MechanicsProgramV2ContractError::BehaviorUnitsNotSortedUnique)
        );
    }
}
