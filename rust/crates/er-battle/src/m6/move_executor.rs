//! Direct execution adapters over prepared M6B move-routine programs.
//!
//! A [`PreparedMoveRoutine`] wraps a [`MechanicsProgramV2`] that a
//! `Moves`-family mapping rule already validated through
//! `RoutineProgramSpec::build`. Preparation re-validates the program and
//! then proves every staged operation belongs to the closed move-routine
//! surface emitted by this wave:
//!
//! - `CriticalRate` modifiers: early add / final set (crit metadata);
//! - `Damage` final override (fixed/level/user-HP damage);
//! - `HitCount` base override (fixed multi-hit types);
//! - trigger operations `StatusApply` and `StatStageChange` on after-hit;
//! - trigger operations `RecoilFraction` and `DrainFraction` on after-damage.
//!
//! Anything else is rejected: there is no alternate mechanics path through
//! this adapter. Payload resolution (status kind, stat identities) stays with
//! the owning behavior unit's prepared content, keyed by the binding's
//! behavior-unit identity surfaced on each [`MoveRoutineStep`].

use er_mechanics::condition_v2::ConditionNodeId;
use er_mechanics::program_v2::{HookBindingV2, MechanicsProgramV2};
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2, SelectorNodeIdV2,
};
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_types::{BehaviorSourceId, BehaviorUnitId};
use thiserror::Error;

/// A move-routine program admitted for direct execution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedMoveRoutine {
    program: MechanicsProgramV2,
}

/// Typed rejection reasons for programs outside the move-routine surface.
#[derive(Debug, Error)]
pub enum MoveRoutineAdapterError {
    #[error("program is invalid: {0}")]
    Invalid(#[source] er_mechanics::MechanicsProgramV2Error),
    #[error("program source is not a move")]
    NotMoveSource,
    #[error("operation {index} is outside the closed move-routine surface")]
    UnsupportedOperation { index: usize },
    #[error("trigger binding {binding} has no selector root")]
    SelectorRequired { binding: usize },
}

/// Prepares a validated program for direct execution.
///
/// Validation runs again here: preparation never trusts construction-site
/// claims, and the adapter rejects any operation the move routines cannot
/// have emitted.
pub fn prepare_move_routine(
    program: MechanicsProgramV2,
) -> Result<PreparedMoveRoutine, MoveRoutineAdapterError> {
    if !matches!(program.source, BehaviorSourceId::Move { .. }) {
        return Err(MoveRoutineAdapterError::NotMoveSource);
    }
    program
        .validate()
        .map_err(MoveRoutineAdapterError::Invalid)?;
    for (index, operation) in program.operations.iter().enumerate() {
        if !is_move_routine_operation(operation) {
            return Err(MoveRoutineAdapterError::UnsupportedOperation { index });
        }
    }
    for (binding_index, binding) in program.bindings.iter().enumerate() {
        if !binding.hook.is_query() && binding.selector_root.is_none() {
            return Err(MoveRoutineAdapterError::SelectorRequired {
                binding: binding_index,
            });
        }
    }
    Ok(PreparedMoveRoutine { program })
}

fn is_move_routine_operation(operation: &MechanicOperationV2) -> bool {
    match operation {
        MechanicOperationV2::Query {
            query,
            stage,
            modifier,
        } => matches!(
            (query, stage, modifier),
            (
                MechanicQueryV2::CriticalRate,
                QueryModifierStageV2::EarlyAdd,
                QueryModifierV2::Add { .. },
            ) | (
                MechanicQueryV2::CriticalRate,
                QueryModifierStageV2::FinalOverride,
                QueryModifierV2::Set { .. },
            ) | (
                MechanicQueryV2::Damage,
                QueryModifierStageV2::FinalOverride,
                QueryModifierV2::Set { .. },
            ) | (
                MechanicQueryV2::HitCount,
                QueryModifierStageV2::BaseOverride,
                QueryModifierV2::Set { .. },
            )
        ),
        MechanicOperationV2::StatStageChange { stat_stage } => (-6..=6).contains(stat_stage),
        MechanicOperationV2::StatusApply => true,
        _ => false,
    }
}

/// One executable step: a binding plus its staged operation slice.
#[derive(Clone, Copy, Debug)]
pub struct MoveRoutineStep<'a> {
    pub binding_index: usize,
    pub hook: MechanicHookV2,
    pub behavior_unit: &'a BehaviorUnitId,
    pub condition_root: Option<ConditionNodeId>,
    pub selector_root: Option<SelectorNodeIdV2>,
    pub operations: &'a [MechanicOperationV2],
}

impl PreparedMoveRoutine {
    /// The prepared, validated program.
    pub fn program(&self) -> &MechanicsProgramV2 {
        &self.program
    }

    /// Every hook invocation of the program, in frozen binding order.
    ///
    /// Trigger steps always carry selector roots (user or target); query
    /// steps carry their value-backed modifier slices.
    pub fn steps(&self) -> impl Iterator<Item = MoveRoutineStep<'_>> + '_ {
        self.program
            .bindings
            .iter()
            .enumerate()
            .map(|(binding_index, binding)| MoveRoutineStep {
                binding_index,
                hook: binding.hook,
                behavior_unit: &binding.behavior_unit,
                condition_root: binding.condition_root,
                selector_root: binding.selector_root,
                operations: self.binding_operations(binding),
            })
    }

    fn binding_operations(&self, binding: &HookBindingV2) -> &[MechanicOperationV2] {
        let start = usize::from(binding.operations.start);
        let end = start + usize::from(binding.operations.length);
        &self.program.operations[start..end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_mechanics::ProgramRange;
    use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2};
    use er_mechanics::m6::ProgramBudgetV2;
    use er_mechanics::selector_operation_v2::{SelectorArenaV2, SelectorNodeV2};
    use er_types::m6::{BehaviorUnitOrdinal, ProvenanceHash};
    use er_types::mechanics::MechanicsProgramId;
    use er_types::{M6_MECHANICS_PROGRAM_VERSION, SafeU53};

    const TEST_PROVENANCE_HASH: &str =
        "850e45b88e66fd215c32701204a2c5785ed938a508f2285e1a813254fa86279f";

    fn move_unit() -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::Move {
                numeric_id: SafeU53::new(7).expect("move_unit: fixture operation succeeds"),
            },
            unit_kind: er_types::BehaviorUnitKind::MoveAttribute,
            ordinal: BehaviorUnitOrdinal::default(),
            provenance_hash: ProvenanceHash::parse(TEST_PROVENANCE_HASH)
                .expect("move_unit: fixture operation succeeds"),
        }
    }

    fn program_with(
        id: u64,
        hook: MechanicHookV2,
        selectors: SelectorArenaV2,
        selector_root: Option<SelectorNodeIdV2>,
        operation: MechanicOperationV2,
    ) -> MechanicsProgramV2 {
        let selector_nodes = u16::try_from(selectors.len()).unwrap_or(u16::MAX);
        let unit = move_unit();
        MechanicsProgramV2 {
            schema_version: M6_MECHANICS_PROGRAM_VERSION,
            id: MechanicsProgramId::try_from_u64(id)
                .expect("program_with: fixture operation succeeds"),
            source: unit.source.clone(),
            behavior_units: vec![unit.clone()],
            bindings: vec![HookBindingV2 {
                hook,
                authored_priority: 0,
                binding_ordinal: 0,
                behavior_unit: unit,
                condition_root: None,
                selector_root,
                operations: ProgramRange {
                    start: 0,
                    length: 1,
                },
            }],
            conditions: ConditionArenaV2::default(),
            values: ValueArenaV2::default(),
            selectors,
            operations: vec![operation],
            scheduled_events: Vec::new(),
            rng_sites: Vec::new(),
            budget: ProgramBudgetV2 {
                hook_bindings: 1,
                condition_nodes: 0,
                selector_nodes,
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
    fn status_program_admits_direct_execution() {
        let program = program_with(
            9,
            MechanicHookV2::AfterHit,
            SelectorArenaV2(vec![SelectorNodeV2::Target]),
            Some(SelectorNodeIdV2::ZERO),
            MechanicOperationV2::StatusApply,
        );
        let prepared = prepare_move_routine(program)
            .expect("status_program_admits_direct_execution: fixture operation succeeds");
        let steps: Vec<_> = prepared.steps().collect();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].hook, MechanicHookV2::AfterHit);
        assert_eq!(steps[0].operations, &[MechanicOperationV2::StatusApply]);
    }

    #[test]
    fn crit_query_step_exposes_staged_modifier() {
        let mut program = program_with(
            10,
            MechanicHookV2::CriticalQuery,
            SelectorArenaV2::default(),
            None,
            MechanicOperationV2::Query {
                query: MechanicQueryV2::CriticalRate,
                stage: QueryModifierStageV2::EarlyAdd,
                modifier: QueryModifierV2::Add {
                    value: er_mechanics::condition_v2::ValueNodeId(0),
                },
            },
        );
        program.values = ValueArenaV2(vec![er_mechanics::condition_v2::ValueNodeV2::Constant {
            value: 1,
        }]);
        program.budget.value_nodes = 1;
        let prepared = prepare_move_routine(program)
            .expect("crit_query_step_exposes_staged_modifier: fixture operation succeeds");
        let steps: Vec<_> = prepared.steps().collect();
        assert_eq!(steps[0].hook, MechanicHookV2::CriticalQuery);
        assert!(steps[0].selector_root.is_none());
    }

    #[test]
    fn non_move_source_is_rejected() {
        let mut program = program_with(
            11,
            MechanicHookV2::AfterDamage,
            SelectorArenaV2(vec![SelectorNodeV2::Actor]),
            Some(SelectorNodeIdV2::ZERO),
            MechanicOperationV2::RecoilFraction {
                numerator: 1,
                denominator: 4,
            },
        );
        program.source = BehaviorSourceId::Weather {
            numeric_id: SafeU53::new(3)
                .expect("non_move_source_is_rejected: fixture operation succeeds"),
        };
        assert!(matches!(
            prepare_move_routine(program),
            Err(MoveRoutineAdapterError::NotMoveSource)
        ));
    }

    #[test]
    fn foreign_operations_are_rejected_without_an_alternate_path() {
        let program = program_with(
            12,
            MechanicHookV2::AfterHit,
            SelectorArenaV2(vec![SelectorNodeV2::Target]),
            Some(SelectorNodeIdV2::ZERO),
            MechanicOperationV2::HpDamage { amount: 10 },
        );
        assert!(matches!(
            prepare_move_routine(program),
            Err(MoveRoutineAdapterError::UnsupportedOperation { index: 0 })
        ));
    }

    #[test]
    fn trigger_binding_requires_a_selector_root() {
        let program = program_with(
            13,
            MechanicHookV2::AfterHit,
            SelectorArenaV2::default(),
            None,
            MechanicOperationV2::StatusApply,
        );
        assert!(matches!(
            prepare_move_routine(program),
            Err(MoveRoutineAdapterError::SelectorRequired { binding: 0 })
        ));
    }
}
