use std::collections::BTreeSet;
use std::error::Error;

use er_progression::content_v2::{
    CaptureBallDefinitionV2, ExperienceBoostV2, ExperienceSourceFormV2, LevelMoveV2,
    PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V2, ProgressionContentPackV2,
    ProgressionContentV2Error, SpeciesExperienceMetadataV2, SpeciesProgressionDefinitionV2,
};
use er_progression::{GrowthRateDefinitionV1, NatureDefinitionV1};
use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::run_ids::{Experience, GrowthRateId, NatureId};
use er_types::{CatalogHash, InventoryItemId, OracleSha, SafeU53};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture value is safe")
}

fn pack() -> Result<ProgressionContentPackV2, Box<dyn Error>> {
    let species = SpeciesId::try_from_u64(1)?;
    let move_id = MoveId::try_from_u64(22)?;
    let mut pack = ProgressionContentPackV2 {
        schema_version: PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V2,
        oracle_sha: OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7")?,
        content_hash: CatalogHash::parse("0".repeat(64))?,
        growth_rates: vec![GrowthRateDefinitionV1 {
            id: GrowthRateId::new(1),
            experience_by_level: (0_u64..=100)
                .map(|value| Experience::new(safe(value * value * value)))
                .collect(),
        }],
        natures: vec![NatureDefinitionV1 {
            id: NatureId::new(1),
            increased_stat: None,
            decreased_stat: None,
        }],
        capture_balls: vec![CaptureBallDefinitionV2 {
            item: InventoryItemId::new(safe(1)),
            registry_key: "POKEBALL".to_owned(),
            catch_multiplier_numerator: 1,
            catch_multiplier_denominator: 1,
            guaranteed: false,
        }],
        species: vec![SpeciesProgressionDefinitionV2 {
            species,
            form: 0,
            experience: None,
            growth_rate: GrowthRateId::new(1),
            base_friendship: 50,
            catch_rate: 45,
            level_moves: vec![LevelMoveV2 { level: -1, move_id }],
            reminder_moves: Vec::new(),
            tm_moves: Vec::new(),
            evolutions: Vec::new(),
        }],
        evolutions: Vec::new(),
    };
    pack.content_hash = pack.recompute_hash()?;
    Ok(pack)
}

#[test]
fn signed_special_learnset_levels_are_preserved() -> Result<(), Box<dyn Error>> {
    let pack = pack()?;
    pack.validate(
        &BTreeSet::from([SpeciesId::try_from_u64(1)?]),
        &BTreeSet::from([MoveId::try_from_u64(22)?]),
    )?;
    assert_eq!(pack.species[0].level_moves[0].level, -1);
    Ok(())
}

#[test]
fn unknown_move_reference_fails_closed() -> Result<(), Box<dyn Error>> {
    let pack = pack()?;
    assert!(
        pack.validate(
            &BTreeSet::from([SpeciesId::try_from_u64(1)?]),
            &BTreeSet::new(),
        )
        .is_err()
    );
    Ok(())
}

fn metadata(
    base: u64,
    source_form: ExperienceSourceFormV2,
    count: u16,
    key: Option<&str>,
    sprite: &str,
) -> Result<SpeciesExperienceMetadataV2, Box<dyn Error>> {
    Ok(SpeciesExperienceMetadataV2 {
        base_exp: SafeU53::new(base)?,
        source_form,
        source_form_count: count,
        source_form_key: key.map(str::to_owned),
        source_sprite_key: sprite.to_owned(),
        boost: ExperienceBoostV2::from_source_sprite_key(sprite),
    })
}

fn mapped_pack() -> Result<ProgressionContentPackV2, Box<dyn Error>> {
    let mut pack = pack()?;
    pack.species[0].experience = Some(metadata(
        70,
        ExperienceSourceFormV2::Species,
        2,
        None,
        "ordinary",
    )?);
    let mut first = pack.species[0].clone();
    first.form = 1;
    first.experience = Some(metadata(
        100,
        ExperienceSourceFormV2::Form(0),
        2,
        Some("ordinary"),
        "ordinary",
    )?);
    let mut second = first.clone();
    second.form = 2;
    // formSpriteKey can override formKey; classification must follow the former.
    second.experience = Some(metadata(
        200,
        ExperienceSourceFormV2::Form(1),
        2,
        Some("different-form-key"),
        "mega",
    )?);
    pack.species.extend([first, second]);
    pack.content_hash = pack.recompute_hash()?;
    Ok(pack)
}

fn validate_metadata_pack(
    pack: &mut ProgressionContentPackV2,
) -> Result<(), ProgressionContentV2Error> {
    pack.content_hash = pack.recompute_hash()?;
    pack.validate(
        &BTreeSet::from([pack.species[0].species]),
        &BTreeSet::from([pack.species[0].level_moves[0].move_id]),
    )
}

#[test]
fn historical_species_bytes_and_missing_experience_remain_explicit() -> Result<(), Box<dyn Error>> {
    let pack = pack()?;
    let historical = r#"{"species":1,"form":0,"growth_rate":1,"base_friendship":50,"catch_rate":45,"level_moves":[{"level":-1,"move_id":22}],"reminder_moves":[],"tm_moves":[],"evolutions":[]}"#;
    let decoded: SpeciesProgressionDefinitionV2 = serde_json::from_str(historical)?;
    assert_eq!(decoded, pack.species[0]);
    assert_eq!(serde_json::to_string(&decoded)?, historical);
    let bytes = serde_json::to_vec(&pack)?;
    let restored: ProgressionContentPackV2 = serde_json::from_slice(&bytes)?;
    assert_eq!(restored.recompute_hash()?, pack.content_hash);
    assert_eq!(serde_json::to_vec(&restored)?, bytes);
    let prepared = restored.prepare(
        &BTreeSet::from([SpeciesId::try_from_u64(1)?]),
        &BTreeSet::from([MoveId::try_from_u64(22)?]),
    )?;
    assert_eq!(
        prepared.experience_for_source_form(SpeciesId::try_from_u64(1)?, 0),
        Err(ProgressionContentV2Error::ExperienceUnsupported),
    );
    assert_eq!(
        prepared.experience_for_source_form(SpeciesId::try_from_u64(2)?, 0),
        Err(ProgressionContentV2Error::ExperienceUnsupported),
    );
    Ok(())
}

#[test]
fn source_form_lookup_distinguishes_species_row_and_first_form() -> Result<(), Box<dyn Error>> {
    let mut pack = mapped_pack()?;
    validate_metadata_pack(&mut pack)?;
    let prepared = pack.clone().prepare(
        &BTreeSet::from([SpeciesId::try_from_u64(1)?]),
        &BTreeSet::from([MoveId::try_from_u64(22)?]),
    )?;
    let species = SpeciesId::try_from_u64(1)?;
    assert_eq!(
        pack.species[0]
            .experience
            .as_ref()
            .ok_or("base metadata")?
            .base_exp,
        SafeU53::new(70)?
    );
    let first = prepared.experience_for_source_form(species, 0)?;
    assert_eq!(first.base_exp, SafeU53::new(100)?);
    assert_eq!(first.source_form, ExperienceSourceFormV2::Form(0));
    let second = prepared.experience_for_source_form(species, 1)?;
    assert_eq!(second.base_exp, SafeU53::new(200)?);
    assert_eq!(second.source_form, ExperienceSourceFormV2::Form(1));
    assert_eq!(second.boost, ExperienceBoostV2::Mega);
    assert_eq!(
        second.source_form_key.as_deref(),
        Some("different-form-key")
    );
    assert_eq!(prepared.experience_for_source_form(species, 2)?, first);
    assert_eq!(
        prepared.experience_for_source_form(species, u16::MAX)?,
        first
    );
    let bytes = serde_json::to_vec(&pack)?;
    let restored: ProgressionContentPackV2 = serde_json::from_slice(&bytes)?;
    assert_eq!(restored, pack);
    assert_eq!(serde_json::to_vec(&restored)?, bytes);

    pack.species.truncate(1);
    pack.species[0].experience = Some(metadata(64, ExperienceSourceFormV2::Species, 0, None, "")?);
    validate_metadata_pack(&mut pack)?;
    let prepared = pack.prepare(
        &BTreeSet::from([species]),
        &BTreeSet::from([MoveId::try_from_u64(22)?]),
    )?;
    for index in [0, 1, u16::MAX] {
        let value = prepared.experience_for_source_form(species, index)?;
        assert_eq!(value.base_exp, SafeU53::new(64)?);
        assert_eq!(value.source_form, ExperienceSourceFormV2::Species);
    }
    Ok(())
}

#[test]
fn inconsistent_experience_cohorts_and_classifications_fail_validation()
-> Result<(), Box<dyn Error>> {
    for case in 0..8 {
        let mut pack = mapped_pack()?;
        match case {
            0 => pack.species[0].experience = None,
            1 => pack.species[1].experience = None,
            2 => {
                pack.species[1]
                    .experience
                    .as_mut()
                    .ok_or("metadata")?
                    .source_form = ExperienceSourceFormV2::Form(1)
            }
            3 => {
                pack.species[1]
                    .experience
                    .as_mut()
                    .ok_or("metadata")?
                    .source_form_count = 1
            }
            4 => {
                pack.species[1]
                    .experience
                    .as_mut()
                    .ok_or("metadata")?
                    .source_form_key = None
            }
            5 => {
                pack.species[2].experience.as_mut().ok_or("metadata")?.boost =
                    ExperienceBoostV2::Other
            }
            6 => {
                let value = pack.species[0].experience.as_mut().ok_or("metadata")?;
                value.source_sprite_key = "mega".to_owned();
                value.boost = ExperienceBoostV2::Mega;
            }
            _ => {
                pack.species.pop();
            }
        }
        assert_eq!(
            validate_metadata_pack(&mut pack),
            Err(ProgressionContentV2Error::ExperienceMetadata),
            "case {case}"
        );
    }
    let mut pack = mapped_pack()?;
    pack.species[2].form = 3;
    assert_eq!(
        validate_metadata_pack(&mut pack),
        Err(ProgressionContentV2Error::ExperienceMetadata)
    );
    Ok(())
}

#[test]
fn experience_classes_are_closed_and_every_metadata_field_is_hashed() -> Result<(), Box<dyn Error>>
{
    for (sprite, expected) in [
        ("mega", ExperienceBoostV2::Mega),
        ("mega-x", ExperienceBoostV2::MegaX),
        ("mega-y", ExperienceBoostV2::MegaY),
        ("primal", ExperienceBoostV2::Primal),
        ("gigantamax", ExperienceBoostV2::Gigantamax),
        ("eternamax", ExperienceBoostV2::Eternamax),
        ("mega-z", ExperienceBoostV2::Other),
        ("gigantamax-single", ExperienceBoostV2::Other),
        ("gigantamax-rapid", ExperienceBoostV2::Other),
        ("origin", ExperienceBoostV2::Other),
        ("", ExperienceBoostV2::Other),
    ] {
        assert_eq!(ExperienceBoostV2::from_source_sprite_key(sprite), expected);
    }
    let pack = mapped_pack()?;
    let original = pack.recompute_hash()?;
    for case in 0..6 {
        let mut changed = pack.clone();
        let value = changed.species[2].experience.as_mut().ok_or("metadata")?;
        match case {
            0 => value.base_exp = SafeU53::new(201)?,
            1 => value.source_form = ExperienceSourceFormV2::Species,
            2 => value.source_form_count = 3,
            3 => value.source_form_key = Some("changed".to_owned()),
            4 => value.source_sprite_key = "other".to_owned(),
            _ => value.boost = ExperienceBoostV2::Other,
        }
        assert_ne!(changed.recompute_hash()?, original, "field {case}");
    }
    let value = serde_json::to_value(pack.species[2].experience.as_ref().ok_or("metadata")?)?;
    for (field, invalid) in [
        ("boost", serde_json::json!("MEGA_Z")),
        ("base_exp", serde_json::json!(-1)),
        ("base_exp", serde_json::json!(1.5)),
        ("base_exp", serde_json::json!(9_007_199_254_740_992_u64)),
        ("source_form_count", serde_json::json!(65536)),
        (
            "source_form",
            serde_json::json!({"kind": "FORM", "index": 0, "extra": true}),
        ),
        ("source_form", serde_json::json!({"kind": "OTHER"})),
        ("unknown", serde_json::json!(true)),
    ] {
        let mut invalid_value = value.clone();
        invalid_value[field] = invalid;
        assert!(
            serde_json::from_value::<SpeciesExperienceMetadataV2>(invalid_value).is_err(),
            "{field}"
        );
    }
    Ok(())
}

#[test]
fn compiled_experience_bridge_never_reinterprets_species_rows() -> Result<(), Box<dyn Error>> {
    // Hand-authored metadata fixture: proves row semantics, not the generated source export.
    let species = SpeciesId::try_from_u64(1)?;
    let prepared = mapped_pack()?.prepare(&BTreeSet::from([species]), &BTreeSet::from([MoveId::try_from_u64(22)?]))?;
    assert_eq!(prepared.experience_for_compiled_form(species, 0), Err(ProgressionContentV2Error::ExperienceUnsupported));
    for (row, source_index, base) in [(1, 0, 100), (2, 1, 200)] {
        let value = prepared.experience_for_compiled_form(species, row)?;
        assert_eq!(value.source_form, ExperienceSourceFormV2::Form(source_index));
        assert_eq!(value.base_exp, SafeU53::new(base)?);
    }
    for row in [3, u16::MAX] {
        assert_eq!(prepared.experience_for_compiled_form(species, row), Err(ProgressionContentV2Error::ExperienceUnsupported));
    }
    assert_eq!(prepared.experience_for_compiled_form(SpeciesId::try_from_u64(2)?, 1), Err(ProgressionContentV2Error::ExperienceUnsupported));
    assert_eq!(prepared.experience_for_compiled_form(species, 2)?.boost, ExperienceBoostV2::Mega);
    Ok(())
}

#[test]
fn compiled_experience_bridge_requires_metadata_and_exact_no_form_identity() -> Result<(), Box<dyn Error>> {
    let species = SpeciesId::try_from_u64(1)?;
    let mut source = pack()?;
    let historical = source.clone().prepare(&BTreeSet::from([species]), &BTreeSet::from([MoveId::try_from_u64(22)?]))?;
    assert_eq!(historical.experience_for_compiled_form(species, 0), Err(ProgressionContentV2Error::ExperienceUnsupported));
    source.species[0].experience = Some(metadata(64, ExperienceSourceFormV2::Species, 0, None, "")?);
    validate_metadata_pack(&mut source)?;
    let prepared = source.prepare(&BTreeSet::from([species]), &BTreeSet::from([MoveId::try_from_u64(22)?]))?;
    let value = prepared.experience_for_compiled_form(species, 0)?;
    assert_eq!(value.base_exp, SafeU53::new(64)?);
    assert_eq!(value.source_form, ExperienceSourceFormV2::Species);
    for row in [1, u16::MAX] {
        assert_eq!(prepared.experience_for_compiled_form(species, row), Err(ProgressionContentV2Error::ExperienceUnsupported));
    }
    Ok(())
}