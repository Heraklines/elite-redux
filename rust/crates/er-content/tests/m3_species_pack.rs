use std::error::Error;

use er_canonical::{canonicalize, content_digest};
use er_content::abilities::selected_ability_definitions;
use er_content::moves::selected_move_definitions;
use er_content::pack::{
    CapabilityManifestError, ContentPack, ContentPackError, ORACLE_GAME_SHA,
    SELECTED_SCHEMA_VERSION, TypeChartError, selected_capability_manifest, selected_content_pack,
    selected_type_chart,
};
use er_content::species::{
    SpeciesBaseStats, SpeciesDefinitionError, SpeciesLookupError, find_species, lookup_species,
    selected_species_definitions, validate_selected_species,
};
use er_types::battle_ids::{AbilityId, ContentPackHash, MoveId, SpeciesId};
use er_types::battle_model::{
    CapabilityStatus, CapabilitySubject, PokemonType, PokemonTyping, SingleTypeMultiplier,
    StatusKind, TerrainKind, UnsupportedReasonCode, WeatherKind,
};
use er_types::ids::SafeU53;
use serde_json::{Map, Value};

fn species_id(value: u64) -> SpeciesId {
    SpeciesId::new(SafeU53::new(value).unwrap_or(SafeU53::ZERO))
}

fn move_id(value: u64) -> MoveId {
    MoveId::new(SafeU53::new(value).unwrap_or(SafeU53::ZERO))
}

fn ability_id(value: u64) -> AbilityId {
    AbilityId::new(SafeU53::new(value).unwrap_or(SafeU53::ZERO))
}

fn error(message: &str) -> Box<dyn Error> {
    Box::new(std::io::Error::other(message.to_owned()))
}

#[test]
fn selected_species_match_manifest_values_and_order() -> Result<(), Box<dyn Error>> {
    let definitions = selected_species_definitions();
    validate_selected_species(&definitions)?;

    let ids: Vec<u64> = definitions
        .iter()
        .map(|definition| u64::from(definition.id))
        .collect();
    assert_eq!(ids, vec![1, 7, 19, 23, 50, 52]);

    assert_eq!(
        definitions[0].base_types,
        PokemonTyping {
            primary: PokemonType::Grass,
            secondary: Some(PokemonType::Poison),
        }
    );
    assert_eq!(
        definitions[0].base_stats,
        SpeciesBaseStats {
            hp: 47,
            attack: 49,
            defense: 49,
            special_attack: 65,
            special_defense: 65,
            speed: 45,
        }
    );
    assert_eq!(
        definitions[1].base_types,
        PokemonTyping {
            primary: PokemonType::Water,
            secondary: None,
        }
    );
    assert_eq!(
        definitions[1].base_stats,
        SpeciesBaseStats {
            hp: 50,
            attack: 48,
            defense: 65,
            special_attack: 50,
            special_defense: 64,
            speed: 43,
        }
    );
    assert_eq!(
        definitions[2].base_types,
        PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        }
    );
    assert_eq!(
        definitions[2].base_stats,
        SpeciesBaseStats {
            hp: 30,
            attack: 56,
            defense: 35,
            special_attack: 25,
            special_defense: 35,
            speed: 72,
        }
    );
    assert_eq!(
        definitions[3].base_types,
        PokemonTyping {
            primary: PokemonType::Poison,
            secondary: None,
        }
    );
    assert_eq!(
        definitions[3].base_stats,
        SpeciesBaseStats {
            hp: 55,
            attack: 60,
            defense: 49,
            special_attack: 40,
            special_defense: 59,
            speed: 55,
        }
    );
    assert_eq!(
        definitions[4].base_types,
        PokemonTyping {
            primary: PokemonType::Ground,
            secondary: None,
        }
    );
    assert_eq!(
        definitions[4].base_stats,
        SpeciesBaseStats {
            hp: 10,
            attack: 55,
            defense: 25,
            special_attack: 35,
            special_defense: 45,
            speed: 95,
        }
    );
    assert_eq!(
        definitions[5].base_types,
        PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        }
    );
    assert_eq!(
        definitions[5].base_stats,
        SpeciesBaseStats {
            hp: 40,
            attack: 55,
            defense: 35,
            special_attack: 65,
            special_defense: 40,
            speed: 90,
        }
    );
    assert!(
        definitions
            .iter()
            .all(|definition| definition.capability == CapabilityStatus::Supported)
    );
    Ok(())
}

#[test]
fn species_lookup_and_mutation_rejection_are_fail_closed() -> Result<(), Box<dyn Error>> {
    let definitions = selected_species_definitions();
    assert_eq!(lookup_species(species_id(7))?, definitions[1]);
    let found = find_species(&definitions, species_id(50))?;
    assert_eq!(found.base_types.primary, PokemonType::Ground);
    assert!(matches!(
        lookup_species(species_id(408)),
        Err(SpeciesLookupError::UnsupportedId { id }) if id == species_id(408)
    ));
    assert!(matches!(
        find_species(&definitions, species_id(408)),
        Err(SpeciesLookupError::UnsupportedId { id }) if id == species_id(408)
    ));

    let mut altered = definitions[0].clone();
    altered.base_stats.hp += 1;
    assert!(matches!(
        altered.validate(),
        Err(SpeciesDefinitionError::DefinitionMismatch { id }) if id == species_id(1)
    ));

    let mut outside = definitions[0].clone();
    outside.id = species_id(408);
    assert!(matches!(
        outside.validate(),
        Err(SpeciesDefinitionError::UnsupportedId { id }) if id == species_id(408)
    ));

    let mut unsupported = definitions[0].clone();
    unsupported.capability = CapabilityStatus::Unsupported {
        reason_code: UnsupportedReasonCode::OutsideSelectedContent,
    };
    assert!(matches!(
        unsupported.validate(),
        Err(SpeciesDefinitionError::UnsupportedCapability { id }) if id == species_id(1)
    ));

    let mut reordered = definitions;
    reordered.swap(0, 1);
    assert!(validate_selected_species(&reordered).is_err());
    Ok(())
}

#[test]
fn type_chart_is_exact_sorted_and_neutral_by_absence() -> Result<(), Box<dyn Error>> {
    let chart = selected_type_chart();
    chart.validate()?;
    let entries: Vec<(PokemonType, PokemonType, SingleTypeMultiplier)> = chart
        .entries
        .iter()
        .map(|entry| (entry.attack, entry.defense, entry.multiplier))
        .collect();
    assert_eq!(
        entries,
        vec![
            (
                PokemonType::Fire,
                PokemonType::Water,
                SingleTypeMultiplier::Half
            ),
            (
                PokemonType::Fire,
                PokemonType::Grass,
                SingleTypeMultiplier::Two
            ),
            (
                PokemonType::Electric,
                PokemonType::Water,
                SingleTypeMultiplier::Two
            ),
            (
                PokemonType::Electric,
                PokemonType::Grass,
                SingleTypeMultiplier::Half
            ),
            (
                PokemonType::Electric,
                PokemonType::Ground,
                SingleTypeMultiplier::Zero
            ),
            (
                PokemonType::Grass,
                PokemonType::Water,
                SingleTypeMultiplier::Two
            ),
            (
                PokemonType::Grass,
                PokemonType::Grass,
                SingleTypeMultiplier::Half
            ),
            (
                PokemonType::Grass,
                PokemonType::Poison,
                SingleTypeMultiplier::Half
            ),
            (
                PokemonType::Grass,
                PokemonType::Ground,
                SingleTypeMultiplier::Two
            ),
            (
                PokemonType::Poison,
                PokemonType::Grass,
                SingleTypeMultiplier::Two
            ),
            (
                PokemonType::Poison,
                PokemonType::Poison,
                SingleTypeMultiplier::Half
            ),
            (
                PokemonType::Poison,
                PokemonType::Ground,
                SingleTypeMultiplier::Half
            ),
        ]
    );
    assert_eq!(
        chart.multiplier(PokemonType::Electric, PokemonType::Ground),
        SingleTypeMultiplier::Zero
    );
    assert_eq!(
        chart.multiplier(PokemonType::Electric, PokemonType::Water),
        SingleTypeMultiplier::Two
    );
    assert_eq!(
        chart.multiplier(PokemonType::Normal, PokemonType::Normal),
        SingleTypeMultiplier::One
    );
    Ok(())
}

#[test]
fn type_chart_rejects_neutral_duplicate_unsorted_and_altered_entries() {
    let mut neutral = selected_type_chart();
    neutral.entries[0].multiplier = SingleTypeMultiplier::One;
    assert!(matches!(
        neutral.validate(),
        Err(TypeChartError::NeutralEntry { index: 0 })
    ));

    let mut duplicate = selected_type_chart();
    duplicate.entries[1] = duplicate.entries[0];
    assert!(matches!(
        duplicate.validate(),
        Err(TypeChartError::DuplicatePair { index: 1, .. })
    ));

    let mut unsorted = selected_type_chart();
    unsorted.entries.swap(0, 1);
    assert!(matches!(
        unsorted.validate(),
        Err(TypeChartError::Unsorted { index: 1 })
    ));

    let mut altered = selected_type_chart();
    altered.entries[0].multiplier = SingleTypeMultiplier::Two;
    assert!(matches!(
        altered.validate(),
        Err(TypeChartError::DefinitionMismatch)
    ));
}

#[test]
fn capability_manifest_matches_exact_subject_order_and_cases() -> Result<(), Box<dyn Error>> {
    let manifest = selected_capability_manifest();
    manifest.validate()?;
    let subjects: Vec<CapabilitySubject> = manifest
        .entries
        .iter()
        .map(|entry| entry.subject.clone())
        .collect();
    assert_eq!(
        subjects,
        vec![
            CapabilitySubject::Move(move_id(1)),
            CapabilitySubject::Move(move_id(52)),
            CapabilitySubject::Move(move_id(77)),
            CapabilitySubject::Move(move_id(78)),
            CapabilitySubject::Move(move_id(351)),
            CapabilitySubject::Move(move_id(589)),
            CapabilitySubject::Ability(ability_id(0)),
            CapabilitySubject::Ability(ability_id(22)),
            CapabilitySubject::Ability(ability_id(25)),
            CapabilitySubject::Status(StatusKind::Poison),
            CapabilitySubject::Status(StatusKind::Paralysis),
            CapabilitySubject::Status(StatusKind::Burn),
            CapabilitySubject::Weather(WeatherKind::None),
            CapabilitySubject::Terrain(TerrainKind::None),
        ]
    );

    let positives: Vec<Vec<&str>> = vec![
        vec!["physical-hit"],
        vec!["burn-application"],
        vec!["poison-application"],
        vec!["paralysis-application"],
        vec!["special-hit-priority"],
        vec!["spread-stage-down"],
        vec!["none-ability-no-trigger"],
        vec!["intimidate-switch-in"],
        vec!["wonder-guard-block"],
        vec!["poison-application"],
        vec!["paralysis-application"],
        vec!["burn-application"],
        vec!["physical-hit"],
        vec!["physical-hit"],
    ];
    let edges: Vec<Vec<&str>> = vec![
        vec!["critical-hit", "pp-unusable-rejected"],
        vec!["burn-residual", "burn-physical-penalty"],
        vec![
            "miss",
            "poison-type-immunity",
            "grass-powder-immunity",
            "existing-status-rejected",
        ],
        vec![
            "paralysis-full-stop",
            "paralysis-speed-order",
            "grass-powder-immunity",
        ],
        vec!["always-hit", "wonder-guard-block"],
        vec!["stage-floor-cap"],
        vec!["physical-hit"],
        vec!["intimidate-stage-floor"],
        vec![
            "wonder-guard-super-effective-pass",
            "wonder-guard-status-pass",
        ],
        vec!["poison-residual"],
        vec!["paralysis-full-stop", "paralysis-speed-order"],
        vec!["burn-residual", "burn-physical-penalty"],
        vec!["special-hit-priority"],
        vec!["spread-stage-down"],
    ];
    for (index, entry) in manifest.entries.iter().enumerate() {
        assert_eq!(entry.status, CapabilityStatus::Supported);
        let actual_positive: Vec<&str> = entry
            .required_positive_cases
            .iter()
            .map(String::as_str)
            .collect();
        let actual_edges: Vec<&str> = entry
            .required_edge_cases
            .iter()
            .map(String::as_str)
            .collect();
        assert_eq!(actual_positive, positives[index]);
        assert_eq!(actual_edges, edges[index]);
    }
    assert!(
        manifest
            .find(&CapabilitySubject::Move(move_id(351)))
            .is_some()
    );
    Ok(())
}

#[test]
fn capability_manifest_rejects_duplicates_unsorted_and_missing_coverage() {
    let mut duplicate = selected_capability_manifest();
    duplicate.entries[1].subject = duplicate.entries[0].subject.clone();
    assert!(matches!(
        duplicate.validate(),
        Err(CapabilityManifestError::DuplicateSubject { index: 1, .. })
    ));

    let mut unsorted = selected_capability_manifest();
    unsorted.entries.swap(0, 6);
    assert!(matches!(
        unsorted.validate(),
        Err(CapabilityManifestError::Unsorted { index: 1 })
    ));

    let mut missing = selected_capability_manifest();
    missing.entries[0].required_edge_cases.clear();
    assert!(matches!(
        missing.validate(),
        Err(CapabilityManifestError::MissingCoverage { .. })
    ));

    let mut altered = selected_capability_manifest();
    altered.entries[0].required_positive_cases[0] = "not-the-oracle-case".to_owned();
    assert!(matches!(
        altered.validate(),
        Err(CapabilityManifestError::DefinitionMismatch)
    ));

    let mut outside = selected_capability_manifest();
    outside.entries[5].subject = CapabilitySubject::Move(move_id(590));
    assert!(matches!(
        outside.validate(),
        Err(CapabilityManifestError::DefinitionMismatch)
    ));

    let mut unsupported_claims = selected_capability_manifest();
    unsupported_claims.entries[0].status = CapabilityStatus::Unsupported {
        reason_code: UnsupportedReasonCode::OutsideSelectedContent,
    };
    assert!(matches!(
        unsupported_claims.validate(),
        Err(CapabilityManifestError::UnsupportedClaims { .. })
    ));
}

#[test]
fn selected_pack_assembles_exact_metadata_and_integrated_content() -> Result<(), Box<dyn Error>> {
    let pack = selected_content_pack()?;
    assert_eq!(pack.schema_version, SELECTED_SCHEMA_VERSION);
    assert_eq!(pack.oracle_game_sha, ORACLE_GAME_SHA);
    assert_eq!(pack.species, selected_species_definitions());
    assert_eq!(pack.moves, selected_move_definitions());
    assert_eq!(pack.abilities, selected_ability_definitions());
    assert_eq!(pack.type_chart, selected_type_chart());
    assert_eq!(pack.capability_manifest, selected_capability_manifest());
    Ok(())
}

#[test]
fn selected_pack_hash_is_deterministic_and_validates_preimage() -> Result<(), Box<dyn Error>> {
    let first = selected_content_pack()?;
    let second = selected_content_pack()?;
    assert_eq!(first, second);
    assert_eq!(first.hash, first.recompute_hash()?);
    assert!(first.hash.as_str().starts_with(ContentPackHash::PREFIX));
    assert_eq!(
        first.hash.as_str().len(),
        ContentPackHash::PREFIX.len() + 64
    );
    assert!(
        first
            .hash
            .as_str()
            .strip_prefix(ContentPackHash::PREFIX)
            .is_some_and(|hex| hex
                .bytes()
                .all(|digit| digit.is_ascii_hexdigit() && !digit.is_ascii_uppercase()))
    );

    let mut value = serde_json::to_value(&first)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| error("content pack did not serialize as an object"))?;
    let stored_hash = object
        .remove("hash")
        .ok_or_else(|| error("content pack hash field was absent"))?;
    assert_eq!(stored_hash, serde_json::to_value(&first.hash)?);
    assert_eq!(object.len(), 7);
    assert!(!object.contains_key("hash"));

    let canonical = canonicalize(&value)?;
    assert!(!canonical.contains('\n'));
    assert!(!canonical.contains("blake3-v1:"));
    assert!(canonical.contains(r#""delta":-1"#));
    let raw_hash = first
        .hash
        .as_str()
        .strip_prefix(ContentPackHash::PREFIX)
        .ok_or_else(|| error("content hash prefix was absent"))?;
    assert_eq!(content_digest(&value)?, raw_hash);
    Ok(())
}

#[test]
fn content_pack_rejects_mutations_and_strict_unknown_fields() -> Result<(), Box<dyn Error>> {
    let mut altered_hash = selected_content_pack()?;
    altered_hash.hash =
        ContentPackHash::new(format!("{}{}", ContentPackHash::PREFIX, "0".repeat(64)))?;
    assert!(matches!(
        altered_hash.validate(),
        Err(ContentPackError::HashMismatch { .. })
    ));

    let mut altered_schema = selected_content_pack()?;
    altered_schema.schema_version = 2;
    assert!(matches!(
        altered_schema.validate(),
        Err(ContentPackError::SchemaVersionMismatch { .. })
    ));

    let mut altered_oracle = selected_content_pack()?;
    altered_oracle.oracle_game_sha = "0000000000000000000000000000000000000000".to_owned();
    assert!(matches!(
        altered_oracle.validate(),
        Err(ContentPackError::OracleGameShaMismatch { .. })
    ));

    let mut altered_species = selected_content_pack()?;
    altered_species.species[0].base_stats.hp += 1;
    assert!(matches!(
        altered_species.validate(),
        Err(ContentPackError::Species(_))
    ));

    let mut altered_move = selected_content_pack()?;
    altered_move.moves[0].base_pp += 1;
    assert!(matches!(
        altered_move.validate(),
        Err(ContentPackError::Moves(_))
    ));

    let mut altered_ability = selected_content_pack()?;
    altered_ability.abilities.swap(0, 1);
    assert!(matches!(
        altered_ability.validate(),
        Err(ContentPackError::Abilities(_))
    ));

    let mut altered_chart = selected_content_pack()?;
    altered_chart.type_chart.entries[0].multiplier = SingleTypeMultiplier::Two;
    assert!(matches!(
        altered_chart.validate(),
        Err(ContentPackError::TypeChart(_))
    ));

    let mut altered_capability = selected_content_pack()?;
    altered_capability.capability_manifest.entries[0].required_positive_cases[0] =
        "not-the-oracle-case".to_owned();
    assert!(matches!(
        altered_capability.validate(),
        Err(ContentPackError::CapabilityManifest(_))
    ));

    let mut unknown = serde_json::to_value(selected_content_pack()?)?;
    let object = unknown
        .as_object_mut()
        .ok_or_else(|| error("content pack did not serialize as an object"))?;
    object.insert("unknown_field".to_owned(), Value::Bool(true));
    assert!(serde_json::from_value::<ContentPack>(unknown).is_err());

    let mut species_unknown = serde_json::to_value(selected_species_definitions()[0].clone())?;
    let species_object = species_unknown
        .as_object_mut()
        .ok_or_else(|| error("species did not serialize as an object"))?;
    species_object.insert("unknown_field".to_owned(), Value::Bool(true));
    assert!(
        serde_json::from_value::<er_content::species::SpeciesDefinition>(species_unknown).is_err()
    );
    Ok(())
}

#[test]
fn strict_nested_capability_entries_reject_unknown_fields() -> Result<(), Box<dyn Error>> {
    let manifest = selected_capability_manifest();
    let mut entry = serde_json::to_value(&manifest.entries[0])?;
    let entry_object = entry
        .as_object_mut()
        .ok_or_else(|| error("capability entry did not serialize as an object"))?;
    entry_object.insert("unknown_field".to_owned(), Value::Bool(true));
    assert!(serde_json::from_value::<er_content::pack::CapabilityEntry>(entry).is_err());

    let mut subject_entry = serde_json::to_value(&manifest.entries[0])?;
    let subject = subject_entry
        .get_mut("subject")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| error("capability subject did not serialize as an object"))?;
    subject.insert("unknown_field".to_owned(), Value::Bool(true));
    assert!(serde_json::from_value::<er_content::pack::CapabilityEntry>(subject_entry).is_err());
    Ok(())
}

#[test]
fn direct_content_pack_round_trip_preserves_the_frozen_hash() -> Result<(), Box<dyn Error>> {
    let pack = selected_content_pack()?;
    let encoded = serde_json::to_string(&pack)?;
    let decoded: ContentPack = serde_json::from_str(&encoded)?;
    assert_eq!(decoded, pack);

    let mut object: Map<String, Value> = serde_json::from_str(&encoded)?;
    object.insert(
        "hash".to_owned(),
        Value::String(format!("{}{}", ContentPackHash::PREFIX, "f".repeat(64))),
    );
    assert!(serde_json::from_value::<ContentPack>(Value::Object(object)).is_err());
    Ok(())
}
