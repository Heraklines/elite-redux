//! Explicit M9 admissions for source-extracted static damage-drain attributes.
//! Frozen M6 compilation remains unchanged; existing program IDs are preserved.

use er_content::m6_catalog::CatalogResolution;
use er_mechanics::selector_operation_v2::MechanicOperationV2;
use er_types::{BehaviorClassificationKindV2, BehaviorSourceId, MechanicsProgramId};

use crate::m6::moves::map_moves_unit;
use crate::m6::{
    BehaviorCompileOutcome, ProgramAllocation, SemanticCompileOutput, ValidatedSemanticCatalog,
};
use crate::m9e_full_content::FullContentBuildErrorV1;

pub(crate) fn admit_static_move_drains(
    catalog: &ValidatedSemanticCatalog,
    output: &mut SemanticCompileOutput,
) -> Result<(), FullContentBuildErrorV1> {
    let mut admitted = std::collections::BTreeSet::new();
    for (index, unit) in catalog.behavior_units().iter().enumerate() {
        if unit.semantic.resolution != CatalogResolution::BespokeGap
            || !matches!(unit.id.source, BehaviorSourceId::Move { .. })
            || unit.semantic.effect.attribute.as_deref() != Some("HitHealAttr")
        {
            continue;
        }
        let Some(spec) = map_moves_unit(unit)
            .map_err(|error| FullContentBuildErrorV1::Semantic(error.to_string()))?
        else {
            continue;
        };
        if !matches!(
            spec.operations.as_slice(),
            [MechanicOperationV2::DrainFraction { .. }]
        ) {
            return Err(FullContentBuildErrorV1::Semantic(
                "static drain admission produced a different operation".to_owned(),
            ));
        }
        let classification = output.classifications.0.get_mut(index).ok_or_else(|| {
            FullContentBuildErrorV1::Semantic("missing drain classification".to_owned())
        })?;
        let record = output.units.get_mut(index).ok_or_else(|| {
            FullContentBuildErrorV1::Semantic("missing drain compile record".to_owned())
        })?;
        if classification.behavior_unit != unit.id
            || classification.kind != BehaviorClassificationKindV2::Bespoke
            || record.unit != unit.id
            || !matches!(record.outcome, BehaviorCompileOutcome::BespokeCluster(_))
        {
            return Err(FullContentBuildErrorV1::Semantic(
                "drain admission does not match frozen classification".to_owned(),
            ));
        }
        let next = output
            .programs
            .last()
            .map_or(1, |value| u64::from(value.id.get()) + 1);
        let id = MechanicsProgramId::try_from_u64(next)
            .map_err(|error| FullContentBuildErrorV1::Semantic(error.to_string()))?;
        let program = spec
            .build(id)
            .map_err(|error| FullContentBuildErrorV1::Semantic(error.to_string()))?;
        output.programs.push(ProgramAllocation {
            id,
            source: unit.id.source.clone(),
            behavior_units: vec![unit.id.clone()],
        });
        output.routine_programs.push(program);
        classification.kind = BehaviorClassificationKindV2::Compiled;
        classification.programs = vec![id];
        classification.bespoke = None;
        classification.unsupported_reason = None;
        record.outcome = BehaviorCompileOutcome::Compiled { program: id };
        admitted.insert(unit.id.clone());
    }
    for entry in &mut output.bespoke.entries {
        entry.behavior_units.retain(|unit| !admitted.contains(unit));
    }
    output
        .bespoke
        .entries
        .retain(|entry| !entry.behavior_units.is_empty());
    output.report.compiled_unit_count += admitted.len();
    output.report.bespoke_unit_count = output
        .report
        .bespoke_unit_count
        .checked_sub(admitted.len())
        .ok_or_else(|| {
            FullContentBuildErrorV1::Semantic("drain closure count underflow".to_owned())
        })?;
    output.report.program_count = output.programs.len();
    Ok(())
}
