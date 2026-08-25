use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_content::m6_catalog::SemanticCatalogV1;
use er_content_compiler::m6::abilities::mapped_unit_count;
use er_content_compiler::m6::items::map_items_unit;
use er_content_compiler::m6::moves::map_moves_unit;
use er_content_compiler::m6::moves::move_compiled_site_total;
use er_content_compiler::m6::status_field::map_status_field_unit;
use er_content_compiler::m6::switch_target::map_switch_target_unit;
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

    let expected_moves = usize::try_from(move_compiled_site_total())?;
    let expected_abilities = mapped_unit_count(catalog.behavior_units());
    assert_eq!(expected_moves, 315);
    let expected_items = catalog
        .behavior_units()
        .iter()
        .filter(|unit| matches!(map_items_unit(unit), Ok(Some(_))))
        .count();
    let expected_status_field = catalog
        .behavior_units()
        .iter()
        .filter(|unit| matches!(map_status_field_unit(unit), Ok(Some(_))))
        .count();
    let expected_switch_target = catalog
        .behavior_units()
        .iter()
        .filter(|unit| matches!(map_switch_target_unit(unit), Ok(Some(_))))
        .count();
    assert_eq!(expected_abilities, 6);
    assert_eq!(expected_items, 0);
    assert_eq!(expected_status_field, 0);
    assert_eq!(expected_switch_target, 6);
    let mut mapped_move_classes = BTreeMap::<String, usize>::new();
    for unit in catalog.behavior_units() {
        if map_moves_unit(unit)?.is_some() {
            let class = unit
                .semantic
                .implementation
                .as_ref()
                .map_or("<none>", |implementation| implementation.name.as_str());
            *mapped_move_classes.entry(class.to_owned()).or_default() += 1;
        }
    }
    let actual_moves = mapped_move_classes.values().sum::<usize>();
    assert_eq!(
        actual_moves, expected_moves,
        "move coverage drift: {mapped_move_classes:?}"
    );
    assert_eq!(
        first.mapped.len(),
        expected_moves
            + expected_abilities
            + expected_items
            + expected_status_field
            + expected_switch_target
    );
    assert_eq!(first.unresolved.len(), 9_388 - first.mapped.len());

    let mut units = BTreeSet::new();
    for (index, spec) in first.mapped.into_iter().enumerate() {
        assert!(units.insert(spec.behavior_unit.clone()));
        let program_id = MechanicsProgramId::try_from_u64(u64::try_from(index)? + 1)?;
        let program = spec.build(program_id)?;
        program.validate()?;
    }
    Ok(())
}
