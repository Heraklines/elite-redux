use er_content::pack::m5_pack::BattleContentPackV2;
use er_mechanics::{BindingKind, MechanicOperation};
use er_types::mechanics::{HookOrdinal, MechanicHook, MechanicQuery, MechanicsProgramId};
use thiserror::Error;

use crate::mechanics::{ExecutableMechanic, OrderedMechanicSource};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedMechanicOperation {
    pub source_index: usize,
    pub program_id: MechanicsProgramId,
    pub hook_ordinal: HookOrdinal,
    pub operation_ordinal: u16,
    pub operation: MechanicOperation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HookExecutionPlan {
    pub hook: MechanicHook,
    pub sources: Vec<OrderedMechanicSource>,
    pub operations: Vec<PlannedMechanicOperation>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueryExecutionPlan {
    pub query: MechanicQuery,
    pub sources: Vec<OrderedMechanicSource>,
    pub operations: Vec<PlannedMechanicOperation>,
}

pub fn plan_hook(
    pack: &BattleContentPackV2,
    sources: &[OrderedMechanicSource],
    hook: MechanicHook,
) -> Result<HookExecutionPlan, MechanicsPlanningError> {
    let operations = plan_bindings(
        pack,
        sources,
        |binding| matches!(binding, BindingKind::Trigger { hook: candidate } if *candidate == hook),
    )?;
    Ok(HookExecutionPlan {
        hook,
        sources: sources.to_vec(),
        operations,
    })
}

pub fn plan_query(
    pack: &BattleContentPackV2,
    sources: &[OrderedMechanicSource],
    query: MechanicQuery,
) -> Result<QueryExecutionPlan, MechanicsPlanningError> {
    let operations = plan_bindings(
        pack,
        sources,
        |binding| matches!(binding, BindingKind::Query { query: candidate, .. } if *candidate == query),
    )?;
    Ok(QueryExecutionPlan {
        query,
        sources: sources.to_vec(),
        operations,
    })
}

fn plan_bindings<F>(
    pack: &BattleContentPackV2,
    sources: &[OrderedMechanicSource],
    accepts: F,
) -> Result<Vec<PlannedMechanicOperation>, MechanicsPlanningError>
where
    F: Fn(&BindingKind) -> bool,
{
    let mut operations = Vec::new();
    for (source_index, source) in sources.iter().enumerate() {
        let ExecutableMechanic::Program(program_id) = &source.executable else {
            return Err(MechanicsPlanningError::BespokeRequiresExecutor);
        };
        let program_id = *program_id;
        let program_index = usize::try_from(program_id.get().get())
            .map_err(|_| MechanicsPlanningError::MissingProgram { program_id })?;
        let program = pack
            .programs
            .get(program_index)
            .and_then(Option::as_ref)
            .ok_or(MechanicsPlanningError::MissingProgram { program_id })?;
        for binding in &program.bindings {
            if !accepts(&binding.binding) {
                continue;
            }
            let start = usize::from(binding.operations.start);
            let end = binding
                .operations
                .end()
                .ok_or(MechanicsPlanningError::InvalidOperationRange { program_id })?;
            let selected = program
                .operations
                .get(start..end)
                .ok_or(MechanicsPlanningError::InvalidOperationRange { program_id })?;
            for (offset, operation) in selected.iter().enumerate() {
                let operation_ordinal = u16::try_from(start + offset)
                    .map_err(|_| MechanicsPlanningError::OperationOrdinalOverflow { program_id })?;
                operations.push(PlannedMechanicOperation {
                    source_index,
                    program_id,
                    hook_ordinal: binding.hook_ordinal,
                    operation_ordinal,
                    operation: operation.clone(),
                });
            }
        }
    }
    operations.sort_by_key(|operation| {
        (
            operation.source_index,
            operation.hook_ordinal,
            operation.program_id,
            operation.operation_ordinal,
        )
    });
    Ok(operations)
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MechanicsPlanningError {
    #[error("mechanics plan references missing program {program_id}")]
    MissingProgram { program_id: MechanicsProgramId },
    #[error("mechanics program {program_id} has an invalid operation range")]
    InvalidOperationRange { program_id: MechanicsProgramId },
    #[error("mechanics program {program_id} operation ordinal overflowed")]
    OperationOrdinalOverflow { program_id: MechanicsProgramId },
    #[error("bespoke mechanic requires the central bespoke executor")]
    BespokeRequiresExecutor,
}
