//! Shared internal contract for M6B routine mapping modules.
//!
//! Family modules may emit only complete typed program specifications. An
//! unrecognized class/operand shape returns `Ok(None)` from the family mapper;
//! callers keep that behavior unit unresolved rather than manufacturing a
//! neutral operation.

use er_content::m6_catalog::{CatalogBehaviorUnit, CatalogOperand};
use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2};
use er_mechanics::m6::ProgramBudgetV2;
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2, ScheduledEventSpecV1,
    SelectorArenaV2,
};
use er_mechanics::{
    HookBindingV2, MechanicHookV2, MechanicsProgramV2, ProgramRange, RngSiteBindingV1,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{BehaviorUnitId, M6_MECHANICS_PROGRAM_VERSION};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum MappingFamily {
    Moves,
    Abilities,
    Items,
    StatusField,
    SwitchTarget,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct MappingRuleId {
    pub family: MappingFamily,
    pub ordinal: u32,
    pub version: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoutineProgramSpec {
    pub rule: MappingRuleId,
    pub behavior_unit: BehaviorUnitId,
    pub bindings: Vec<HookBindingV2>,
    pub conditions: ConditionArenaV2,
    pub selectors: SelectorArenaV2,
    pub values: ValueArenaV2,
    pub operations: Vec<MechanicOperationV2>,
    pub scheduled_events: Vec<ScheduledEventSpecV1>,
    pub rng_sites: Vec<RngSiteBindingV1>,
    pub spawned_instances: u16,
    pub presentation_cues: u16,
    pub selected_targets: u16,
}

impl RoutineProgramSpec {
    pub fn single_trigger(
        rule: MappingRuleId,
        behavior_unit: BehaviorUnitId,
        hook: MechanicHookV2,
        operation: MechanicOperationV2,
    ) -> Result<Self, RoutineCompileError> {
        if hook.is_query() || operation.is_query() {
            return Err(RoutineCompileError::TriggerQueryMismatch);
        }
        Ok(Self {
            rule,
            bindings: vec![HookBindingV2 {
                hook,
                authored_priority: 0,
                binding_ordinal: 0,
                behavior_unit: behavior_unit.clone(),
                condition_root: None,
                selector_root: None,
                operations: ProgramRange {
                    start: 0,
                    length: 1,
                },
            }],
            behavior_unit,
            conditions: ConditionArenaV2::default(),
            selectors: SelectorArenaV2::default(),
            values: ValueArenaV2::default(),
            operations: vec![operation],
            scheduled_events: Vec::new(),
            rng_sites: Vec::new(),
            spawned_instances: 0,
            presentation_cues: 0,
            selected_targets: 0,
        })
    }

    pub fn single_query(
        rule: MappingRuleId,
        behavior_unit: BehaviorUnitId,
        hook: MechanicHookV2,
        stage: QueryModifierStageV2,
        modifier: QueryModifierV2,
        values: ValueArenaV2,
    ) -> Result<Self, RoutineCompileError> {
        let query = hook
            .query()
            .map_err(|_| RoutineCompileError::TriggerQueryMismatch)?;
        Ok(Self {
            rule,
            bindings: vec![HookBindingV2 {
                hook,
                authored_priority: 0,
                binding_ordinal: 0,
                behavior_unit: behavior_unit.clone(),
                condition_root: None,
                selector_root: None,
                operations: ProgramRange {
                    start: 0,
                    length: 1,
                },
            }],
            behavior_unit,
            conditions: ConditionArenaV2::default(),
            selectors: SelectorArenaV2::default(),
            values,
            operations: vec![MechanicOperationV2::Query {
                query,
                stage,
                modifier,
            }],
            scheduled_events: Vec::new(),
            rng_sites: Vec::new(),
            spawned_instances: 0,
            presentation_cues: 0,
            selected_targets: 0,
        })
    }

    pub fn build(
        self,
        program_id: MechanicsProgramId,
    ) -> Result<MechanicsProgramV2, RoutineCompileError> {
        let budget = ProgramBudgetV2 {
            hook_bindings: exact_u16("hook_bindings", self.bindings.len())?,
            condition_nodes: exact_u16("condition_nodes", self.conditions.len())?,
            selector_nodes: exact_u16("selector_nodes", self.selectors.len())?,
            value_nodes: exact_u16("value_nodes", self.values.0.len())?,
            operations: exact_u16("operations", self.operations.len())?,
            scheduled_events: exact_u16("scheduled_events", self.scheduled_events.len())?,
            rng_draws: exact_u16("rng_draws", self.rng_sites.len())?,
            spawned_instances: self.spawned_instances,
            presentation_cues: self.presentation_cues,
            selected_targets: self.selected_targets,
        };
        let program = MechanicsProgramV2 {
            schema_version: M6_MECHANICS_PROGRAM_VERSION,
            id: program_id,
            source: self.behavior_unit.source.clone(),
            behavior_units: vec![self.behavior_unit],
            bindings: self.bindings,
            conditions: self.conditions,
            selectors: self.selectors,
            values: self.values,
            operations: self.operations,
            scheduled_events: self.scheduled_events,
            rng_sites: self.rng_sites,
            budget,
        };
        program.validate().map_err(RoutineCompileError::Program)?;
        Ok(program)
    }
}

pub fn implementation_name(unit: &CatalogBehaviorUnit) -> Option<&str> {
    unit.semantic
        .implementation
        .as_ref()
        .map(|value| value.name.as_str())
}

pub fn operand(
    unit: &CatalogBehaviorUnit,
    index: usize,
) -> Result<&CatalogOperand, RoutineCompileError> {
    unit.semantic
        .operands
        .get(index)
        .ok_or(RoutineCompileError::MissingOperand { index })
}

pub fn safe_integer_operand(
    unit: &CatalogBehaviorUnit,
    index: usize,
) -> Result<i64, RoutineCompileError> {
    match operand(unit, index)? {
        CatalogOperand::SafeInteger { value } => Ok(*value),
        _ => Err(RoutineCompileError::OperandKind {
            index,
            expected: "SAFE_INTEGER",
        }),
    }
}

pub fn boolean_operand(
    unit: &CatalogBehaviorUnit,
    index: usize,
) -> Result<bool, RoutineCompileError> {
    match operand(unit, index)? {
        CatalogOperand::Boolean { value } => Ok(*value),
        _ => Err(RoutineCompileError::OperandKind {
            index,
            expected: "BOOLEAN",
        }),
    }
}

pub fn string_operand<'a>(
    unit: &'a CatalogBehaviorUnit,
    index: usize,
) -> Result<&'a str, RoutineCompileError> {
    match operand(unit, index)? {
        CatalogOperand::String { value } => Ok(value),
        _ => Err(RoutineCompileError::OperandKind {
            index,
            expected: "STRING",
        }),
    }
}

fn exact_u16(resource: &'static str, value: usize) -> Result<u16, RoutineCompileError> {
    u16::try_from(value).map_err(|_| RoutineCompileError::ResourceOverflow { resource, value })
}

#[derive(Debug, Error)]
pub enum RoutineCompileError {
    #[error("trigger/query hook and operation kinds do not match")]
    TriggerQueryMismatch,
    #[error("behavior unit is missing operand {index}")]
    MissingOperand { index: usize },
    #[error("operand {index} must be {expected}")]
    OperandKind {
        index: usize,
        expected: &'static str,
    },
    #[error("{resource} count {value} exceeds u16")]
    ResourceOverflow {
        resource: &'static str,
        value: usize,
    },
    #[error("compiled mechanics program is invalid: {0}")]
    Program(#[source] er_mechanics::MechanicsProgramV2Error),
}
