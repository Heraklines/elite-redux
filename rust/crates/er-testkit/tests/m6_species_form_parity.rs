//! M6 system proof: exact species/form battle-metadata parity against the
//! frozen raw-source oracle catalog.
//!
//! Loads the frozen `rust/fixtures/m6` catalogs through `CARGO_MANIFEST_DIR`
//! ancestor resolution and drives the pure adapters in
//! `er_battle::m6::system::species_form_parity` over them:
//!
//! - exact identity closure: 2,018 species plus their 534-form closure with
//!   zero residual in either direction; every species carries exact battle
//!   metadata — 1,082 identities compiled straight from oracle bytes, 936
//!   resolved through the pinned extraction-gap derivation seams (dump
//!   drafts, authored rosters, exact kit clones) with provenance attached;
//! - cross-catalog closure: the semantic catalog's SPECIES behavior units
//!   match the raw species identity set exactly;
//! - canonical base-form identity: the empty catalog key registers as a
//!   first-class base form and carries real transition chains;
//! - explicit typeless battle typing: form `493:18:unknown` copies as
//!   [`er_types::battle_model::BattleTyping::Typeless`] and never enters
//!   type-chart lookup;
//! - overlay admission over every canonical base identity plus negative
//!   invalid-combination witnesses through the real `forms` transitions;
//! - transform exclusions and the copied battle-metadata surface over every
//!   one of the 534 form identities;
//! - fail-closed resolution witnesses for tampered oracle values.

use std::path::PathBuf;

use serde_json::json;

use er_battle::m6::bespoke::forms::{FormsOutcomeV2, admit_tera, cleanup_on_switch};
use er_battle::m6::bespoke::transform_imposter::{
    TransformBattlerFactsV2, TransformImposterFactsV2, TransformSourceMoveFactsV2,
    apply_transform_copy, clear_transform_copy, copied_field_evidence, plan_transform_copy,
};
use er_battle::m6::system::species_form_parity::{
    AbilityTable, ORACLE_FORM_CLOSURE_COUNT, ORACLE_SPECIES_CLOSURE_COUNT, ResolvedFormMetadata,
    SpeciesContentEvidence, compile_form_entry,
    compile_species_entry_with_context, prove_overlay_admission, prove_transform_copy_surface,
    verify_identity_closure,
};
use er_content::m6_catalog::{CatalogEffectKind, SemanticCatalogV1};
use er_content::m6_pack::species_gap::{
    self, ErGapSpeciesClass, ErGapSpeciesSource, validate_derivation,
};
use er_state::bespoke_v2::forms::{FormIdentityV2, FormsStateV2};
use er_state::bespoke_v2::transform_imposter::{
    TRANSFORM_COPIED_PP_CAP, TransformCopiedAbilitiesV2, TransformCopiedGenderV2,
    TransformCopyTriggerV2, TransformFormCopyStateV2,
};
use er_types::SafeU53;
use er_types::battle_ids::{AbilityId, BattleSide, FieldSlot, MoveId, PokemonId};
use er_types::battle_model::{BattleStats, BattleTyping, StatStages};
use er_types::mechanics::MechanicScope;

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

fn frozen_closure(
    raw: &serde_json::Value,
) -> er_battle::m6::system::species_form_parity::SpeciesFormClosure {
    verify_identity_closure(
        raw["species"].as_array().expect("species array"),
        raw["forms"].as_array().expect("forms array"),
        &ability_table(raw),
    )
    .expect("frozen catalog satisfies exact identity closure")
}

#[test]
fn species_and_form_closure_is_exact_with_zero_residual() {
    // The pinned derivation table must stand on its own before it may feed
    // the parity closure.
    validate_derivation().expect("generated derivation table validates");

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

    // Frozen content-evidence split: static-constructor extractions versus
    // pinned-seam derivations. Every identity carries exact battle content.
    let extracted = closure
        .species
        .iter()
        .filter(|metadata| matches!(&metadata.content, SpeciesContentEvidence::Extracted(_)))
        .count();
    let derived = closure
        .species
        .iter()
        .filter(|metadata| matches!(&metadata.content, SpeciesContentEvidence::Derived(_)))
        .count();
    assert_eq!(extracted + derived, ORACLE_SPECIES_CLOSURE_COUNT);
    assert_eq!(extracted, 1082);
    assert_eq!(derived, 936);

    // Exact content identity: independently recompiling every oracle entry in
    // ascending order reproduces the compiled metadata bit-for-bit.
    let mut compiled = Vec::new();
    for entry in species_entries {
        compiled.push(
            compile_species_entry_with_context(entry, &table, &compiled).expect("recompiled"),
        );
    }
    for metadata in &closure.species {
        let expected = compiled
            .iter()
            .find(|candidate| candidate.id == metadata.id)
            .expect("recompiled identity");
        assert_eq!(*expected, *metadata, "species {} recompiles exactly", metadata.id);

        let content = closure.species_content(metadata.id).expect("content");
        let weight = f64::from_bits(content.weight_bits);
        let height = f64::from_bits(content.height_bits);
        assert!(weight > 0.0 && weight.is_finite(), "{} weight positive", metadata.id);
        assert!(height > 0.0 && height.is_finite(), "{} height positive", metadata.id);

        if let SpeciesContentEvidence::Derived(derived) = &metadata.content {
            // Provenance travels with every derived identity.
            assert!(!derived.provenance.is_empty());
            match derived.class {
                ErGapSpeciesClass::DumpCustom => {
                    assert!(metadata.id >= 10_000 && metadata.id < 70_001);
                }
                ErGapSpeciesClass::BaseSpeciesAlias | ErGapSpeciesClass::SpeciesClone => {
                    // Kit clones must equal their compiled source exactly:
                    // the copy rule is behavioral, not declarative.
                    let record = species_gap::resolve(metadata.id).expect("pinned record");
                    let ErGapSpeciesSource::ContentOf(source_species) = record.source else {
                        panic!("class/source coherence broke for {}", metadata.id);
                    };
                    let source_content =
                        closure.species_content(source_species).expect("compiled source");
                    assert_eq!(
                        &derived.content,
                        source_content,
                        "clone {} equals its source {}",
                        metadata.id,
                        source_species
                    );
                }
                ErGapSpeciesClass::AuthoredNewcomer | ErGapSpeciesClass::PitchRoster => {
                    assert!(metadata.id >= 70_001);
                    assert!(
                        derived.provenance.contains("er-newcomer-species")
                            || derived.provenance.contains("fakemon-pitch-species")
                    );
                }
            }
        }
    }

    // Pinned-seam spot witnesses: the dump custom derives its draft verbatim
    // (Ghost/Flying PHANTOWL at 63.8 kg), the regional alias equals its
    // extracted base species, and the pitch roster names its pinned revision.
    let phantowl = closure.species_content(10_000).expect("PHANTOWL content");
    assert_eq!(
        phantowl.typing,
        BattleTyping::Typed(er_types::battle_model::PokemonTyping {
            primary: er_types::battle_model::PokemonType::Ghost,
            secondary: Some(er_types::battle_model::PokemonType::Flying),
        })
    );
    assert_eq!(f64::from_bits(phantowl.weight_bits), 63.8);
    let alias_evidence = closure.derived_evidence(10_143).expect("alias evidence");
    assert_eq!(
        &alias_evidence.content,
        closure.species_content(2019).expect("base content"),
        "regional alias inherits its base species' exact battle metadata"
    );
    let tremburr = closure.derived_evidence(70_033).expect("pitch evidence");
    assert!(tremburr.provenance.contains("pinned revision"));

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
fn empty_string_is_a_first_class_base_form_key() {
    // The canonical base-form presentation registers like any named key and
    // carries a battler through a real Tera chain.
    let base = FormIdentityV2::new(25, "").expect("empty canonical key registers");
    assert_eq!(base.form_key, "");
    assert_eq!(FormIdentityV2::new(25, ""), Ok(base.clone()));

    let scope = MechanicScope::Field {
        slot: FieldSlot::new(BattleSide::Player, 0).expect("in-range slot"),
    };
    let state = FormsStateV2::default()
        .register_battler(scope.clone(), base.clone())
        .expect("base-form registration validates");
    let applied = admit_tera(&state, BattleSide::Player, &scope, 0).expect("tera applies");
    assert_eq!(applied.outcome, FormsOutcomeV2::Applied);
    let cleaned = cleanup_on_switch(&applied.state, &scope).expect("switch-out cleanup");
    let battler = cleaned.state.battler(&scope).expect("battler stays registered");
    assert_eq!(battler.current.form_key, "");
}

#[test]
fn overlay_admission_holds_for_every_species_identity() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let closure = frozen_closure(&raw);

    let evidence = prove_overlay_admission(&closure).expect("overlay admission proof");

    // Every one of the 2,018 species identities registered its canonical
    // base form (the empty key included), completed a Tera chain, and the
    // 157 multi-key species completed stance and Mega chains; single-key
    // identities proved their negative witnesses instead.
    assert_eq!(evidence.species_admission_checked, ORACLE_SPECIES_CLOSURE_COUNT);
    assert_eq!(evidence.base_form_registrations, ORACLE_SPECIES_CLOSURE_COUNT);
    assert_eq!(evidence.tera_admissions, ORACLE_SPECIES_CLOSURE_COUNT);
    assert_eq!(evidence.stance_pairs_exercised, 157);
    assert_eq!(evidence.mega_pairs_exercised, 157);
    assert_eq!(evidence.single_key_negative_witnesses, 1861);
}

#[test]
fn transform_copy_surface_is_exhaustive_and_fail_closed() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let closure = frozen_closure(&raw);

    let evidence =
        prove_transform_copy_surface(&closure).expect("transform copy surface proof");

    assert_eq!(evidence.copied_fields, copied_field_evidence());
    assert_eq!(evidence.copied_fields.len(), 8);
    // Every one of the 534 form identities — empty catalog keys included —
    // projected onto a validated plan and completed an apply/clear cycle.
    assert_eq!(evidence.copy_plans_projected, ORACLE_FORM_CLOSURE_COUNT);
    assert_eq!(evidence.apply_clear_cycles, ORACLE_FORM_CLOSURE_COUNT);
    // The single typeless identity (`493:18:unknown`) copies as the explicit
    // TYPELESS presentation instead of being skipped or mis-typed.
    assert_eq!(evidence.typeless_copies, 1);
}

/// Builds battler facts for one frozen form identity, as the parity harness
/// observes them.
fn form_facts(pokemon: u64, side: BattleSide, form: &ResolvedFormMetadata) -> TransformBattlerFactsV2 {
    TransformBattlerFactsV2 {
        pokemon: PokemonId::try_from_u64(pokemon).expect("in-range pokemon id"),
        slot: FieldSlot::new(side, 0).expect("in-range field slot"),
        fainted: false,
        transformed: false,
        behind_illusion: false,
        has_substitute: false,
        fusion: false,
        species: SafeU53::new(form.species).expect("in-range species"),
        form_key: form.id.clone(),
        typing: form.content.typing,
        gender: TransformCopiedGenderV2::Unknown,
        stats: BattleStats {
            hp: form.content.base_stats.hp,
            attack: form.content.base_stats.attack,
            defense: form.content.base_stats.defense,
            special_attack: form.content.base_stats.special_attack,
            special_defense: form.content.base_stats.special_defense,
            speed: form.content.base_stats.speed,
        },
        stages: StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        moveset: vec![TransformSourceMoveFactsV2 {
            move_id: MoveId::try_from_u64(1).expect("move id 1 is in range"),
            pp: TRANSFORM_COPIED_PP_CAP + 9,
        }],
        abilities: TransformCopiedAbilitiesV2 {
            active: form.content.ability_slots.active,
            passives: form.content.ability_slots.passives,
        },
    }
}

#[test]
fn typeless_identity_copies_explicitly_and_stays_out_of_the_chart() {
    let raw = load_fixture("raw-source-catalog-v2.json");
    let closure = frozen_closure(&raw);

    let target_form = closure
        .forms
        .iter()
        .find(|form| form.id.as_str() == "493:18:unknown")
        .expect("frozen oracle carries the typeless Arceus presentation");
    assert!(target_form.content.typing.is_typeless());
    assert!(target_form.content.typing.typed().is_none());

    let subject_form = closure
        .forms
        .iter()
        .find(|form| !form.content.typing.is_typeless())
        .expect("closure holds typed forms");

    let facts = TransformImposterFactsV2 {
        trigger: TransformCopyTriggerV2::MoveTransform,
        subject: form_facts(1, BattleSide::Player, subject_form),
        target: Some(form_facts(2, BattleSide::Enemy, target_form)),
    };

    let plan = plan_transform_copy(&facts).expect("typeless target plans");
    assert!(
        plan.copied.typing.is_typeless(),
        "copied typing must be the explicit typeless presentation"
    );
    assert_eq!(plan.copied.form_key.as_str(), "493:18:unknown");
    assert_eq!(plan.copied.stats.attack, target_form.content.base_stats.attack);
    assert_eq!(plan.evidence, copied_field_evidence());

    let applied =
        apply_transform_copy(&TransformFormCopyStateV2::default(), &plan).expect("copy applies");
    let cleared = clear_transform_copy(&applied.state, plan.subject).expect("clears");
    let position = cleared
        .state
        .position_of(plan.subject)
        .expect("tombstone present");
    assert!(!cleared.state.entries[position].active);
    // The typed copied surface never carries an UNKNOWN effectiveness entry:
    // the typeless presentation has no PokemonType to look up.
    let wire = serde_json::to_value(plan.copied.typing).expect("serialize typing");
    assert_eq!(
        wire.get("kind").and_then(serde_json::Value::as_str),
        Some("TYPELESS")
    );
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
    unknown_type["typing"]["primary"]["member"] = json!("NOT_A_TYPE");
    assert!(matches!(
        compile_species_entry_with_context(&unknown_type, &table, &[]),
        Err(E::UnknownEnumMember { owner: "PokemonType", .. })
    ));

    // Wrong symbol owner fails closed.
    let mut wrong_owner = species_entries[0].clone();
    wrong_owner["typing"]["primary"]["owner"] = json!("NotAPokemonType");
    assert!(matches!(
        compile_species_entry_with_context(&wrong_owner, &table, &[]),
        Err(E::SymbolOwnerMismatch { .. })
    ));

    // Unknown AbilityId member fails closed.
    let mut unknown_ability = species_entries[0].clone();
    unknown_ability["ability_slots"][0]["member"] = json!("NOT_AN_ABILITY");
    assert!(matches!(
        compile_species_entry_with_context(&unknown_ability, &table, &[]),
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
    reshaped["id"] = json!("999:7:divergent");
    assert!(matches!(
        compile_form_entry(&reshaped, &table),
        Err(E::FormIdShapeMismatch { .. })
    ));

    // A base stat total that disagrees with the resolved sum fails closed.
    let mut tampered_total = species_entries[0].clone();
    let declared = tampered_total["base_stat_total"]["value"].as_u64().expect("total");
    tampered_total["base_stat_total"]["value"] = json!(declared + 1);
    assert!(matches!(
        compile_species_entry_with_context(&tampered_total, &table, &[]),
        Err(E::BaseStatTotalMismatch { .. })
    ));

    // Partial content inside an explicit extraction gap fails closed.
    let gap_position = species_entries
        .iter()
        .position(|entry| entry.get("extraction_gap").is_some())
        .expect("the frozen catalog declares extraction gaps");
    let mut partial_gap = species_entries[gap_position].clone();
    partial_gap["weight"] = json!({ "kind": "SAFE_INTEGER", "value": 10 });
    assert!(matches!(
        compile_species_entry_with_context(&partial_gap, &table, &[]),
        Err(E::MixedIdentityEvidence { field: "weight", .. })
    ));

    // An unrecognized gap marker fails closed instead of guessing a seam.
    let mut unknown_marker = species_entries[gap_position].clone();
    unknown_marker["extraction_gap"] = json!("SOMETHING_ELSE");
    assert!(matches!(
        compile_species_entry_with_context(&unknown_marker, &table, &[]),
        Err(E::ClosureViolated(detail)) if detail.contains("unknown extraction gap")
    ));

    // A kit-clone identity compiled without its copy context fails closed.
    let alias_position = species_entries
        .iter()
        .position(|entry| entry["id"] == 10143)
        .expect("the frozen catalog carries the RATTATA_ALOLAN alias");
    assert!(matches!(
        compile_species_entry_with_context(&species_entries[alias_position], &table, &[]),
        Err(E::UnknownGapCopySource { id: 10143, source: 2019 })
    ));

    // A divergence between the pinned derivation key and the oracle key
    // fails closed: the two provenance chains must agree.
    let mut rebound = species_entries.clone();
    rebound[alias_position]["key"] = json!("NOT_THE_PINNED_KEY");
    assert!(matches!(
        verify_identity_closure(&rebound, &form_entries, &table),
        Err(E::GapKeyBindingMismatch { id: 10143, .. })
    ));

    // A dense-index violation across a species' forms fails closed: the
    // tampered identity stays internally consistent (id string, index, and
    // key agree) but breaks the per-species form closure.
    let mut sparse_forms = form_entries.clone();
    let second_position = sparse_forms
        .iter()
        .position(|entry| entry["species_id"] == 201 && entry["form_index"] == 1)
        .expect("Unown keeps multiple indexed forms");
    sparse_forms[second_position]["id"] = json!("201:97:");
    sparse_forms[second_position]["form_key"] = json!("");
    sparse_forms[second_position]["form_index"] = json!(97);
    assert!(matches!(
        verify_identity_closure(&species_entries, &sparse_forms, &table),
        Err(E::ClosureViolated(detail)) if detail.contains("dense")
    ));

    // A residual form pointing outside the closed species registry fails
    // closed instead of widening the closure.
    let mut residual_forms = form_entries.clone();
    let mut phantom = form_entries[0].clone();
    phantom["id"] = json!("888888:0:phantom");
    phantom["species_id"] = json!(888888);
    phantom["form_key"] = json!("phantom");
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
