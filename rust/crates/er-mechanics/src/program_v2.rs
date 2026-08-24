//! Complete MechanicsProgramV2 DTO and total validation.

use std::collections::BTreeSet;

use er_types::mechanics::MechanicsProgramId;
use er_types::{BehaviorSourceId, BehaviorUnitId, M6_MECHANICS_PROGRAM_VERSION, RngSiteId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::condition_v2::{
    ConditionArenaErrorV2, ConditionArenaV2, ConditionNodeId, ValueArenaV2, ValueErrorV2,
};
use crate::m6::{
    MechanicsProgramV2Contract, MechanicsProgramV2ContractError, ProgramBudgetV2,
    RngSiteBindingContractV1,
};
use crate::program::ProgramRange;
use crate::selector_operation_v2::{
    MechanicOperationV2, OperationErrorV2, ScheduledEventError, ScheduledEventSpecV1,
    SelectorArenaV2, SelectorErrorV2, SelectorNodeIdV2, compare_scheduled_events,
};
use crate::v2::MechanicHookV2;

pub type RngSiteBindingV1 = RngSiteBindingContractV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HookBindingV2 {
    pub hook: MechanicHookV2,
    /// Lower authored priorities execute first inside a hook stage.
    pub authored_priority: i16,
    pub binding_ordinal: u16,
    pub behavior_unit: BehaviorUnitId,
    pub condition_root: Option<ConditionNodeId>,
    pub selector_root: Option<SelectorNodeIdV2>,
    pub operations: ProgramRange,
}

impl HookBindingV2 {
    fn order_key(&self) -> (u8, i16, &BehaviorUnitId, u16) {
        (
            self.hook.stage(),
            self.authored_priority,
            &self.behavior_unit,
            self.binding_ordinal,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicsProgramV2 {
    pub schema_version: u32,
    pub id: MechanicsProgramId,
    pub source: BehaviorSourceId,
    pub behavior_units: Vec<BehaviorUnitId>,
    pub bindings: Vec<HookBindingV2>,
    pub conditions: ConditionArenaV2,
    pub selectors: SelectorArenaV2,
    pub values: ValueArenaV2,
    pub operations: Vec<MechanicOperationV2>,
    pub scheduled_events: Vec<ScheduledEventSpecV1>,
    pub rng_sites: Vec<RngSiteBindingV1>,
    pub budget: ProgramBudgetV2,
}

impl MechanicsProgramV2 {
    pub fn contract(&self) -> MechanicsProgramV2Contract {
        MechanicsProgramV2Contract {
            schema_version: self.schema_version,
            id: self.id,
            source: self.source.clone(),
            behavior_units: self.behavior_units.clone(),
            rng_sites: self.rng_sites.clone(),
            budget: self.budget,
        }
    }

    pub fn validate(&self) -> Result<(), MechanicsProgramV2Error> {
        if self.schema_version != M6_MECHANICS_PROGRAM_VERSION {
            return Err(MechanicsProgramV2Error::SchemaVersion {
                expected: M6_MECHANICS_PROGRAM_VERSION,
                actual: self.schema_version,
            });
        }
        self.contract()
            .validate()
            .map_err(MechanicsProgramV2Error::Contract)?;
        self.validate_lengths()?;

        let owned_units: BTreeSet<&BehaviorUnitId> = self.behavior_units.iter().collect();
        let declared_rng_sites: BTreeSet<&RngSiteId> = self
            .rng_sites
            .iter()
            .map(|binding| &binding.site.id)
            .collect();

        let mut condition_roots = Vec::new();
        let mut selector_roots = Vec::new();
        let mut value_roots = Vec::new();
        let mut covered_operations = vec![false; self.operations.len()];
        let mut previous_binding: Option<(u8, i16, &BehaviorUnitId, u16)> = None;

        for (index, binding) in self.bindings.iter().enumerate() {
            binding
                .behavior_unit
                .validate()
                .map_err(|_| MechanicsProgramV2Error::InvalidBindingBehaviorUnit { index })?;
            if !owned_units.contains(&binding.behavior_unit) {
                return Err(MechanicsProgramV2Error::UnownedBindingBehaviorUnit { index });
            }
            let order_key = binding.order_key();
            if previous_binding
                .as_ref()
                .is_some_and(|previous| previous >= &order_key)
            {
                return Err(MechanicsProgramV2Error::BindingsNotSortedUnique);
            }
            previous_binding = Some(order_key);

            let end = binding
                .operations
                .end()
                .ok_or(MechanicsProgramV2Error::OperationRangeOverflow { binding: index })?;
            if binding.operations.length == 0 || end > self.operations.len() {
                return Err(MechanicsProgramV2Error::InvalidOperationRange { binding: index });
            }
            if let Some(root) = binding.condition_root {
                condition_roots.push(root.0);
            }
            if let Some(root) = binding.selector_root {
                selector_roots.push(root);
            }

            let query =
                if binding.hook.is_query() {
                    Some(binding.hook.query().map_err(|_| {
                        MechanicsProgramV2Error::InvalidQueryHook { binding: index }
                    })?)
                } else {
                    None
                };
            let operation_start = usize::from(binding.operations.start);
            for (offset, covered) in covered_operations[operation_start..end]
                .iter_mut()
                .enumerate()
            {
                let operation_index = operation_start + offset;
                if *covered {
                    return Err(MechanicsProgramV2Error::OverlappingOperationRange {
                        operation: operation_index,
                    });
                }
                *covered = true;
                let operation = &self.operations[operation_index];
                operation
                    .validate()
                    .map_err(|source| MechanicsProgramV2Error::Operation {
                        index: operation_index,
                        source,
                    })?;
                match (query, operation.query()) {
                    (Some(expected), Some(actual)) if expected == actual => {}
                    (Some(_), Some(_)) => {
                        return Err(MechanicsProgramV2Error::QueryKindMismatch { binding: index });
                    }
                    (Some(_), None) => {
                        return Err(MechanicsProgramV2Error::MutationOnQuery { binding: index });
                    }
                    (None, Some(_)) => {
                        return Err(MechanicsProgramV2Error::QueryOnTrigger { binding: index });
                    }
                    (None, None) => {}
                }
                value_roots.extend(operation.value_references().into_iter().map(|id| id.0));
            }
        }

        if covered_operations.iter().any(|covered| !covered) {
            return Err(MechanicsProgramV2Error::UnreachableOperation);
        }

        self.conditions
            .validate(&condition_roots)
            .map_err(MechanicsProgramV2Error::Conditions)?;
        self.selectors
            .validate(&selector_roots)
            .map_err(MechanicsProgramV2Error::Selectors)?;
        self.values
            .validate(&value_roots)
            .map_err(MechanicsProgramV2Error::Values)?;

        for site in self.selectors.rng_sites() {
            if !declared_rng_sites.contains(site) {
                return Err(MechanicsProgramV2Error::UnknownSelectorRngSite);
            }
        }

        let mut event_ids = BTreeSet::new();
        let mut previous_event: Option<&ScheduledEventSpecV1> = None;
        for (index, event) in self.scheduled_events.iter().enumerate() {
            event
                .validate()
                .map_err(|source| MechanicsProgramV2Error::ScheduledEvent { index, source })?;
            if !owned_units.contains(&event.source_behavior_unit) {
                return Err(MechanicsProgramV2Error::UnownedScheduledEventBehaviorUnit { index });
            }
            if !event_ids.insert(event.event_id) {
                return Err(MechanicsProgramV2Error::DuplicateScheduledEventId);
            }
            if previous_event.is_some_and(|previous| {
                compare_scheduled_events(previous, event) != std::cmp::Ordering::Less
            }) {
                return Err(MechanicsProgramV2Error::ScheduledEventsNotSortedUnique);
            }
            if event
                .rng_sites
                .iter()
                .any(|site| !declared_rng_sites.contains(site))
            {
                return Err(MechanicsProgramV2Error::UnknownScheduledEventRngSite { index });
            }
            previous_event = Some(event);
        }
        Ok(())
    }

    fn validate_lengths(&self) -> Result<(), MechanicsProgramV2Error> {
        for (resource, actual, budget) in [
            (
                "hook_bindings",
                self.bindings.len(),
                self.budget.hook_bindings,
            ),
            (
                "condition_nodes",
                self.conditions.len(),
                self.budget.condition_nodes,
            ),
            (
                "selector_nodes",
                self.selectors.len(),
                self.budget.selector_nodes,
            ),
            ("value_nodes", self.values.0.len(), self.budget.value_nodes),
            ("operations", self.operations.len(), self.budget.operations),
            (
                "scheduled_events",
                self.scheduled_events.len(),
                self.budget.scheduled_events,
            ),
            ("rng_draws", self.rng_sites.len(), self.budget.rng_draws),
        ] {
            if actual > usize::from(budget) {
                return Err(MechanicsProgramV2Error::LengthAboveBudget {
                    resource,
                    actual,
                    budget,
                });
            }
        }
        Ok(())
    }
}

#[derive(Debug, Error, PartialEq)]
pub enum MechanicsProgramV2Error {
    #[error("mechanics program schema must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("mechanics program contract header is invalid: {0}")]
    Contract(#[source] MechanicsProgramV2ContractError),
    #[error("{resource} length {actual} exceeds declared budget {budget}")]
    LengthAboveBudget {
        resource: &'static str,
        actual: usize,
        budget: u16,
    },
    #[error("hook bindings must be strictly sorted and unique")]
    BindingsNotSortedUnique,
    #[error("binding {index} carries an invalid behavior-unit identity")]
    InvalidBindingBehaviorUnit { index: usize },
    #[error("binding {index} references a behavior unit not owned by the program")]
    UnownedBindingBehaviorUnit { index: usize },
    #[error("binding {binding} operation range overflows")]
    OperationRangeOverflow { binding: usize },
    #[error("binding {binding} operation range is empty or out of bounds")]
    InvalidOperationRange { binding: usize },
    #[error("operation {operation} belongs to multiple bindings")]
    OverlappingOperationRange { operation: usize },
    #[error("program contains an operation unreachable from any binding")]
    UnreachableOperation,
    #[error("binding {binding} uses a malformed query hook")]
    InvalidQueryHook { binding: usize },
    #[error("binding {binding} query operation modifies a different query")]
    QueryKindMismatch { binding: usize },
    #[error("binding {binding} places a mutation operation on a query hook")]
    MutationOnQuery { binding: usize },
    #[error("binding {binding} places a query operation on a trigger hook")]
    QueryOnTrigger { binding: usize },
    #[error("condition arena is invalid: {0}")]
    Conditions(#[source] ConditionArenaErrorV2),
    #[error("selector arena is invalid: {0}")]
    Selectors(#[source] SelectorErrorV2),
    #[error("value arena is invalid: {0}")]
    Values(#[source] ValueErrorV2),
    #[error("operation {index} is invalid: {source}")]
    Operation {
        index: usize,
        #[source]
        source: OperationErrorV2,
    },
    #[error("selector references an RNG site not declared by the program")]
    UnknownSelectorRngSite,
    #[error("scheduled event {index} is invalid: {source}")]
    ScheduledEvent {
        index: usize,
        #[source]
        source: ScheduledEventError,
    },
    #[error("scheduled event {index} references a behavior unit not owned by the program")]
    UnownedScheduledEventBehaviorUnit { index: usize },
    #[error("scheduled event IDs must be unique")]
    DuplicateScheduledEventId,
    #[error("scheduled events must be strictly sorted and unique")]
    ScheduledEventsNotSortedUnique,
    #[error("scheduled event {index} references an unknown RNG site")]
    UnknownScheduledEventRngSite { index: usize },
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::{BehaviorUnitKind, BehaviorUnitOrdinal, ProvenanceHash, SafeU53};

    fn unit() -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::Move {
                numeric_id: SafeU53::new(1).expect("fixture must be valid"),
            },
            unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
            ordinal: BehaviorUnitOrdinal::ZERO,
            provenance_hash: ProvenanceHash::parse("0".repeat(64)).expect("fixture must be valid"),
        }
    }

    fn program() -> MechanicsProgramV2 {
        let unit = unit();
        MechanicsProgramV2 {
            schema_version: M6_MECHANICS_PROGRAM_VERSION,
            id: MechanicsProgramId::try_from_u64(1).expect("fixture must be valid"),
            source: unit.source.clone(),
            behavior_units: vec![unit.clone()],
            bindings: vec![HookBindingV2 {
                hook: MechanicHookV2::BeforeMove,
                authored_priority: 0,
                binding_ordinal: 0,
                behavior_unit: unit,
                condition_root: None,
                selector_root: None,
                operations: ProgramRange {
                    start: 0,
                    length: 1,
                },
            }],
            conditions: ConditionArenaV2::default(),
            selectors: SelectorArenaV2::default(),
            values: ValueArenaV2::default(),
            operations: vec![MechanicOperationV2::StatusApply],
            scheduled_events: Vec::new(),
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
                selected_targets: 0,
            },
        }
    }

    #[test]
    fn minimal_trigger_program_validates() {
        assert_eq!(program().validate(), Ok(()));
    }

    #[test]
    fn mutation_on_query_fails_closed() {
        let mut program = program();
        program.bindings[0].hook = MechanicHookV2::MovePowerQuery;
        assert!(matches!(
            program.validate(),
            Err(MechanicsProgramV2Error::MutationOnQuery { .. })
        ));
    }
}
