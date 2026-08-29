use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_content::m6_catalog::{CatalogResolution, SemanticCatalogV1};
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{BehaviorSourceId, BehaviorUnitId, CatalogHash};
use serde::Deserialize;

#[derive(Deserialize)]
struct WitnessPlan {
    witnesses: Vec<RoutineWitness>,
}

#[derive(Deserialize)]
struct RoutineWitness {
    behavior_unit: BehaviorUnitId,
    expected_hook: String,
    expected_source: BehaviorSourceId,
}

fn catalog() -> Result<ValidatedSemanticCatalog, Box<dyn Error>> {
    let catalog = SemanticCatalogV1::from_bytes(include_bytes!(
        "../../../fixtures/m6/semantic-catalog-v1.json"
    ))?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())?;
    Ok(ValidatedSemanticCatalog::new(SemanticCatalogInput::new(
        catalog, raw_hash,
    ))?)
}

#[test]
fn routine_mapping_is_deterministic_complete_and_buildable() -> Result<(), Box<dyn Error>> {
    let catalog = catalog()?;
    let first = map_routine_catalog(catalog.behavior_units())?;
    let second = map_routine_catalog(catalog.behavior_units())?;
    assert_eq!(first, second);
    assert_eq!(first.total(), catalog.behavior_units().len());

    let resolved_operand_count = catalog
        .behavior_units()
        .iter()
        .filter(|unit| unit.semantic.resolution == CatalogResolution::ResolvedOperands)
        .count();
    assert_eq!(resolved_operand_count, 46);
    assert_eq!(first.mapped.len(), resolved_operand_count);
    assert_eq!(first.unresolved.len(), 9_388 - resolved_operand_count);

    let mut units = BTreeSet::new();
    for (index, spec) in first.mapped.into_iter().enumerate() {
        assert!(units.insert(spec.behavior_unit.clone()));
        let program_id = MechanicsProgramId::try_from_u64(u64::try_from(index)? + 1)?;
        let program = spec.build(program_id)?;
        program.validate()?;
    }
    Ok(())
}

#[test]
fn routine_specs_match_frozen_oracle_witness_hooks() -> Result<(), Box<dyn Error>> {
    let catalog = catalog()?;
    let mapped = map_routine_catalog(catalog.behavior_units())?;
    let plan: WitnessPlan = serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/oracle-witness-plan-v1.json"
    ))?;
    let witnesses: BTreeMap<BehaviorUnitId, RoutineWitness> = plan
        .witnesses
        .into_iter()
        .map(|witness| (witness.behavior_unit.clone(), witness))
        .collect();
    assert_eq!(mapped.mapped.len(), 46);
    for spec in mapped.mapped {
        let witness = witnesses
            .get(&spec.behavior_unit)
            .ok_or("mapped behavior unit has no oracle witness")?;
        assert_eq!(witness.expected_source, spec.behavior_unit.source);
        assert!(!spec.bindings.is_empty());
        for binding in &spec.bindings {
            let hook = serde_json::to_value(binding.hook)?
                .as_str()
                .ok_or("hook did not serialize as a string")?
                .to_owned();
            assert_eq!(hook, witness.expected_hook);
        }
    }
    Ok(())
}
