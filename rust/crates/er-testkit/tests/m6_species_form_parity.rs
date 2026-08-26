//! M6 system proof: exact species/form battle-metadata parity against the
//! frozen raw-source oracle catalog.
//!
//! Loads the frozen `rust/fixtures/m6` catalogs through `CARGO_MANIFEST_DIR`
//! ancestor resolution and drives the pure adapters in
//! `er_battle::m6::system::species_form_parity` over them:
//!
//! - exact identity closure: 2,018 species plus their 534-form closure with
//!   zero residual in either direction and exact content identity for every
//!   extracted field;
//! - cross-catalog closure: the semantic catalog's SPECIES behavior units
//!   match the raw species identity set exactly;
//! - overlay admission: exhaustive stance/Mega/Tera persistence and cleanup
//!   chains through the real `forms` family transitions, including negative
//!   invalid-combination witnesses;
//! - transform exclusions and the copied battle-metadata surface over every
//!   registrable typed form identity;
//! - fail-closed resolution witnesses for tampered oracle values.

use std::path::PathBuf;

use er_battle::m6::system::species_form_parity::{
    AbilityTable, ORACLE_FORM_CLOSURE_COUNT, ORACLE_SPECIES_CLOSURE_COUNT,
    SpeciesContentEvidence, compile_form_entry, compile_species_entry, prove_overlay_admission,
    prove_transform_copy_surface, verify_identity_closure,
};
use er_content::m6_catalog::{CatalogEffectKind, SemanticCatalogV1};
use er_types::{BehaviorSourceId, battle_ids::AbilityId};

/// Walks up from the crate manifest so the frozen fixture resolves under any
/// integration layout (crate dir, workspace root, or a relocated checkout
/// that keeps `fixtures/m6` or `rust/fixtures/m6` on the ancestor chain).
fn resolve_fixture(name: &str) -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        for candidate in [
            dir.join("fixtures/m6").join(name),
            dir.join("rust/fixtures/m6").join(name),
        ] {
            if candidate.is_file() {
                return candidate;
            }
        }
        if !dir.pop() {
            break;
        }
    }
    panic!(
        "frozen m6 fixture `{name}` not found above {}",
        env!("CARGO_MANIFEST_DIR")
    );
}

fn load_fixture(name: &str) -> serde_json::Value {
    let path = resolve_fixture(name);
    let bytes =
        std::fs::read(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    serde_json::from_slice(&bytes)
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()))
}

fn ability_table(raw: &serde_json::Value) -> AbilityTable {
    AbilityTable::from_catalog_values(raw["abilities"].as_array().expect("abilities array"))
        .expect("frozen ability table resolves")
}

fn frozen_closure(raw: &serde_json::Value) -> er_battle::m6::system::species_form_parity::SpeciesFormClosure {
    verify_identity_closure(
        raw["species"].as_array().expect("species array"),
        raw["forms"].as_array().expect("forms array"),
        &ability_table(raw),
    )
    .expect("frozen catalog satisfies exact identity closure")
}

#[test]
fn species_and_form_closure_is_exact_with_zero_residual() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let table = ability_table(&raw);
    let species_entries = raw["species"].as_array().expect("species array");
    let form_entries = raw["forms"].as_array().expect("forms array");

    let closure = verify_identity_closure(species_entries, form_entries, &table)
        .expect("frozen catalog satisfies exact identity closure");

    assert_eq!(closure.species.len(), ORACLE_SPECIES_CLOSURE_COUNT);
    assert_eq!(closure.forms.len(), ORACLE_FORM_CLOSURE_COUNT);
    assert_eq!(closure.registry.len(), ORACLE_SPECIES_CLOSURE_COUNT);
    assert!(
        closure
            .species
            .iter()
            .all(|metadata| closure.registry.covers(metadata.id))
    );
    assert!(!closure.registry.covers(0));
    assert!(!closure.registry.covers(999_999));

    // Frozen content-evidence split: identities extracted through the static
    // constructor path versus explicit extraction gaps.
    let extracted = closure
        .species
        .iter()
        .filter(|metadata| matches!(&metadata.content, SpeciesContentEvidence::Extracted(_)))
        .count();
    let identity_only = closure
        .species
        .iter()
        .filter(|metadata| matches!(&metadata.content, SpeciesContentEvidence::IdentityOnly))
        .count();
    assert_eq!(extracted + identity_only, ORACLE_SPECIES_CLOSURE_COUNT);
    assert_eq!(identity_only, 936);
    assert_eq!(extracted, 1082);

    // Exact content identity: independently recompiling every oracle entry
    // reproduces the compiled metadata bit-for-bit; every physical constant
    // is positive and finite; no active ability slot is absent.
    for metadata in &closure.species {
        let entry = species_entries
            .iter()
            .find(|entry| entry["id"] == metadata.id)
            .expect("oracle entry");
        let recomputed =
            compile_species_entry(entry, &table).expect("recompiled species entry");
        assert_eq!(&recomputed, metadata, "species {} recompiles exactly", metadata.id);
    }
    for (entry, resolved) in form_entries.iter().zip(&closure.forms) {
        let recomputed = compile_form_entry(entry, &table).expect("recompiled form");
        assert_eq!(recomputed, *resolved, "form {} recompiles exactly", resolved.id.as_str());
        let weight = f64::from_bits(resolved.content.weight_bits);
        let height = f64::from_bits(resolved.content.height_bits);
        assert!(weight > 0.0 && weight.is_finite(), "form weight positive");
        assert!(height > 0.0 && height.is_finite(), "form height positive");
        assert_ne!(
            resolved.content.ability_slots.active,
            AbilityId::ZERO,
            "form active ability must be present"
        );
    }
    for id in closure
        .forms_by_species
        .keys()
        .copied()
        .collect::<Vec<_>>()
    {
        let content = closure.species_content(id).expect("form-bearing extracted");
        let weight = f64::from_bits(content.weight_bits);
        let height = f64::from_bits(content.height_bits);
        assert!(weight > 0.0 && weight.is_finite(), "species weight positive");
        assert!(height > 0.0 && height.is_finite(), "species height positive");
    }

    // The frozen oracle permits canonical (index-zero) forms whose
    // constructor overrides species defaults; exactly three such identities
    // exist (172:0:, 665:0:meadow, 925:0:four), each still content-identical
    // to its own oracle entry per the recompile comparison above.
    let overrides = closure
        .forms_by_species
        .iter()
        .filter(|(species_id, indices)| {
            indices.first().is_some_and(|&index| {
                closure.forms[index].content
                    != *closure.species_content(**species_id).expect("extracted")
            })
        })
        .count();
    assert_eq!(overrides, 3, "frozen canonical overrides are pinned");

    // Zero residual: the grouped form closure accounts for every form exactly
    // once, covers exactly the form-bearing species, and keeps dense
    // ascending form indices.
    let grouped_forms: usize = closure.forms_by_species.values().map(Vec::len).sum();
    assert_eq!(grouped_forms, ORACLE_FORM_CLOSURE_COUNT);
    assert_eq!(closure.forms_by_species.len(), 159);
    for (&species_id, indices) in &closure.forms_by_species {
        assert!(
            indices
                .iter()
                .enumerate()
                .all(|(position, &index)| closure.forms[index].form_index == position as u32),
            "species {species_id} keeps dense form indices"
        );
    }
}

#[test]
fn semantic_catalog_species_units_match_the_raw_closure() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let semantic_bytes = std::fs::read(resolve_fixture("semantic-catalog-v1.json"))
        .expect("frozen semantic catalog exists");
    let semantic = SemanticCatalogV1::from_bytes(&semantic_bytes).expect("valid semantic catalog");
    semantic.validate().expect("semantic catalog validates");

    // Both catalogs carry the same oracle identity.
    let raw_oracle = raw["oracle_sha"].as_str().expect("raw oracle sha");
    assert_eq!(raw_oracle, semantic.oracle_sha, "catalogs share the oracle sha");

    let mut semantic_species_ids: Vec<u64> = semantic
        .behavior_units
        .iter()
        .filter(|unit| unit.semantic.effect.kind == CatalogEffectKind::SpeciesDefinition)
        .map(|unit| match &unit.id.source {
            BehaviorSourceId::Species { numeric_id } => numeric_id.get(),
            other => panic!("species definition unit carries {other:?}"),
        })
        .collect();
    semantic_species_ids.sort_unstable();
    semantic_species_ids.dedup();

    let raw_species_ids: Vec<u64> = raw["species"]
        .as_array()
        .expect("species array")
        .iter()
        .map(|entry| entry["id"].as_u64().expect("numeric species id"))
        .collect();

    // Zero residual in both directions.
    assert_eq!(semantic_species_ids, raw_species_ids);
    assert_eq!(semantic_species_ids.len(), ORACLE_SPECIES_CLOSURE_COUNT);
}

#[test]
fn overlay_admission_holds_for_every_species_identity() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let closure = frozen_closure(&raw);

    let evidence = prove_overlay_admission(&closure).expect("overlay admission proof");

    // Every species identity passed the admission gate; the 1,859 identities
    // whose canonical catalog form key is empty failed closed on the frozen
    // identity contract; all 159 registrable bases completed Tera chains and
    // the 75 multi-key species completed stance and Mega chains.
    assert_eq!(evidence.species_admission_checked, ORACLE_SPECIES_CLOSURE_COUNT);
    assert_eq!(evidence.unregistrable_canonical_identities, 1859);
    assert_eq!(evidence.registrable_bases, 159);
    assert_eq!(evidence.tera_admissions, 159);
    assert_eq!(evidence.stance_pairs_exercised, 75);
    assert_eq!(evidence.mega_pairs_exercised, 75);
}

#[test]
fn transform_copy_surface_is_exhaustive_and_fail_closed() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let closure = frozen_closure(&raw);

    let evidence =
        prove_transform_copy_surface(&closure).expect("transform copy surface proof");

    assert_eq!(evidence.copied_fields.len(), 8);
    // Every registrable typed form identity projected onto a validated plan
    // and completed an apply/clear cycle; the single typeless identity
    // (`493:18:unknown`, `PokemonType.UNKNOWN`) has no representation in the
    // closed typed surface and is reported as a counted contract gap.
    assert_eq!(evidence.copy_plans_projected, 431);
    assert_eq!(evidence.apply_clear_cycles, 431);
    assert_eq!(evidence.unrepresentable_typeless_targets, 1);
}

#[test]
fn resolution_fails_closed_on_tampered_oracle_values() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let table = ability_table(&raw);
    let species_entries = raw["species"].as_array().expect("species array").clone();
    let form_entries = raw["forms"].as_array().expect("forms array").clone();
    use er_battle::m6::system::species_form_parity::SpeciesFormParityError as E;

    // Unknown PokemonType member fails closed.
    let mut unknown_type = species_entries[0].clone();
    unknown_type["typing"]["primary"]["member"] = serde_json::json!("NOT_A_TYPE");
    assert!(matches!(
        compile_species_entry(&unknown_type, &table),
        Err(E::UnknownEnumMember { owner: "PokemonType", .. })
    ));

    // Wrong symbol owner fails closed.
    let mut wrong_owner = species_entries[0].clone();
    wrong_owner["typing"]["primary"]["owner"] = serde_json::json!("NotAPokemonType");
    assert!(matches!(
        compile_species_entry(&wrong_owner, &table),
        Err(E::SymbolOwnerMismatch { .. })
    ));

    // Unknown AbilityId member fails closed.
    let mut unknown_ability = species_entries[0].clone();
    unknown_ability["ability_slots"][0]["member"] = serde_json::json!("NOT_AN_ABILITY");
    assert!(matches!(
        compile_species_entry(&unknown_ability, &table),
        Err(E::UnknownEnumMember { owner: "AbilityId", .. })
    ));

    // A duplicated ability table row fails closed.
    let mut duplicated_abilities =
        raw["abilities"].as_array().expect("abilities array").clone();
    duplicated_abilities.push(duplicated_abilities[0].clone());
    assert!(matches!(
        AbilityTable::from_catalog_values(&duplicated_abilities),
        Err(E::DuplicateAbilityMember(_))
    ));

    // A compound form id that diverges from its fields fails closed.
    let mut reshaped = form_entries[0].clone();
    reshaped["id"] = serde_json::json!("999:7:divergent");
    assert!(matches!(
        compile_form_entry(&reshaped, &table),
        Err(E::FormIdShapeMismatch { .. })
    ));

    // A base stat total that disagrees with the resolved sum fails closed.
    let mut tampered_total = species_entries[0].clone();
    let declared = tampered_total["base_stat_total"]["value"].as_u64().expect("total");
    tampered_total["base_stat_total"]["value"] = serde_json::json!(declared + 1);
    assert!(matches!(
        compile_species_entry(&tampered_total, &table),
        Err(E::BaseStatTotalMismatch { .. })
    ));

    // Partial content inside an explicit extraction gap fails closed.
    let gap_position = species_entries
        .iter()
        .position(|entry| entry.get("extraction_gap").is_some())
        .expect("the frozen catalog declares extraction gaps");
    let mut partial_gap = species_entries[gap_position].clone();
    partial_gap["weight"] = serde_json::json!({ "kind": "SAFE_INTEGER", "value": 10 });
    assert!(matches!(
        compile_species_entry(&partial_gap, &table),
        Err(E::MixedIdentityEvidence { field: "weight", .. })
    ));

    // A dense-index violation across a species' forms fails closed: the
    // tampered identity stays internally consistent (id string, index, and
    // key agree) but breaks the per-species form closure.
    let mut sparse_forms = form_entries.clone();
    let second_position = sparse_forms
        .iter()
        .position(|entry| entry["species_id"] == 201 && entry["form_index"] == 1)
        .expect("Unown keeps multiple indexed forms");
    sparse_forms[second_position]["id"] = serde_json::json!("201:97:");
    sparse_forms[second_position]["form_key"] = serde_json::json!("");
    sparse_forms[second_position]["form_index"] = serde_json::json!(97);
    assert!(matches!(
        verify_identity_closure(&species_entries, &sparse_forms, &table),
        Err(E::ClosureViolated(detail)) if detail.contains("dense")
    ));

    // A residual form pointing outside the closed species registry fails
    // closed instead of widening the closure.
    let mut residual_forms = form_entries.clone();
    let mut phantom = form_entries[0].clone();
    phantom["id"] = serde_json::json!("888888:0:phantom");
    phantom["species_id"] = serde_json::json!(888888);
    phantom["form_key"] = serde_json::json!("phantom");
    residual_forms.push(phantom);
    assert!(matches!(
        verify_identity_closure(&species_entries, &residual_forms, &table),
        Err(E::UnknownFormSpecies { species: 888888, .. })
    ));
    let mut duplicate_keys = species_entries.clone();
    duplicate_keys[1]["key"] = duplicate_keys[0]["key"].clone();
    assert!(matches!(
        verify_identity_closure(&duplicate_keys, &form_entries, &table),
        Err(E::ClosureViolated(detail)) if detail.contains("duplicate species key")
    ));
}
