use std::collections::BTreeSet;
use std::error::Error;

use er_content::m6_catalog::{CatalogResolution, SemanticCatalogV1};
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_types::CatalogHash;
use er_types::mechanics::MechanicsProgramId;

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
