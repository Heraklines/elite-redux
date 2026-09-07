use std::collections::BTreeSet;
use std::error::Error;

use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_content_compiler::m9e_progression::build_m9_engineering_progression_v2;

const DEFINITIONS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/complete-progression-definitions-v1.json"
));
const BATTLE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/battle-content-pack-v3.json"
));
const PROGRESSION: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/progression-content-pack-v2.json"
));

#[test]
fn complete_progression_catalog_is_source_bound_and_byte_stable() -> Result<(), Box<dyn Error>> {
    let battle = load_battle_content_pack_v3(BATTLE)?;
    let species = battle
        .species
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let moves = battle
        .moves
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let first = build_m9_engineering_progression_v2(DEFINITIONS, &species, &moves)?;
    let second = build_m9_engineering_progression_v2(DEFINITIONS, &species, &moves)?;

    assert_eq!(first, second);
    assert_eq!(serde_json::to_vec(&first)?, PROGRESSION);
    assert_eq!(first.growth_rates.len(), 6);
    assert_eq!(first.natures.len(), 25);
    assert_eq!(first.capture_balls.len(), 6);
    assert_eq!(first.species.len(), 3_384);
    assert_eq!(first.evolutions.len(), 793);
    assert_eq!(
        first
            .species
            .iter()
            .map(|definition| definition.level_moves.len())
            .sum::<usize>(),
        72_230
    );
    assert_eq!(
        first
            .species
            .iter()
            .map(|definition| definition.tm_moves.len())
            .sum::<usize>(),
        132_218
    );
    Ok(())
}

// Small hand-reviewed source-shape cases. These are not a fresh pinned-source export.
fn small_definitions(with_experience: bool) -> serde_json::Value {
    let mut species = Vec::new();
    for (row, key, sprite, base, boost) in [
        (0, None, "ordinary", 70, "OTHER"),
        (1, Some("ordinary"), "ordinary", 100, "OTHER"),
        (2, Some("sprite-override"), "mega", 200, "MEGA"),
    ] {
        let mut value = serde_json::json!({
            "species_id": 1, "form_index": row, "form_key": key,
            "growth_rate": 2, "base_friendship": 50, "catch_rate": 45,
            "level_moves": [{"level": -1, "move_id": 22}],
            "reminder_moves": [22], "evolution_moves": [], "tm_moves": []
        });
        if with_experience {
            value["experience"] = serde_json::json!({
                "base_exp": base,
                "source_form": if row == 0 {
                    serde_json::json!({"kind": "SPECIES"})
                } else {
                    serde_json::json!({"kind": "FORM", "index": row - 1})
                },
                "source_form_count": 2, "source_form_key": key,
                "source_sprite_key": sprite, "boost": boost
            });
        }
        species.push(value);
    }
    let conditions = (0..15)
        .map(|index| (index.to_string(), serde_json::json!(index)))
        .collect::<serde_json::Map<_, _>>();
    serde_json::json!({
        "schema_version": 1, "oracle_sha": "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7",
        "special_learnset_levels": {"relearn": -1, "evolution": 0},
        "stat_names": {}, "evolution_condition_keys": conditions,
        "growth_rates": [{"id": 2, "experience_by_level": (1_u64..=100).map(|level| level * level * level).collect::<Vec<_>>()}],
        "natures": [{"id": 0, "increased_stat": null, "decreased_stat": null}],
        "capture_balls": [{"item_id": 1, "registry_key": "POKEBALL", "catch_multiplier_numerator": 1, "catch_multiplier_denominator": 1, "guaranteed": false}],
        "species": species, "evolutions": []
    })
}

fn compile_small(
    value: &serde_json::Value,
) -> Result<er_progression::content_v2::ProgressionContentPackV2, Box<dyn Error>> {
    Ok(build_m9_engineering_progression_v2(
        &serde_json::to_vec(value)?,
        &BTreeSet::from([er_types::battle_ids::SpeciesId::try_from_u64(1)?]),
        &BTreeSet::from([er_types::battle_ids::MoveId::try_from_u64(22)?]),
    )?)
}

#[test]
fn experience_export_fields_compile_without_changing_historical_rows() -> Result<(), Box<dyn Error>>
{
    use er_progression::content_v2::{ExperienceBoostV2, ExperienceSourceFormV2};
    use er_types::SafeU53;
    use er_types::battle_ids::{MoveId, SpeciesId};

    let historical = compile_small(&small_definitions(false))?;
    assert!(
        historical
            .species
            .iter()
            .all(|row| row.experience.is_none())
    );
    assert!(!serde_json::to_string(&historical)?.contains("experience\""));
    let current = compile_small(&small_definitions(true))?;
    assert_ne!(current.content_hash, historical.content_hash);
    let mut without_metadata = current.clone();
    for row in &mut without_metadata.species {
        row.experience = None;
    }
    without_metadata.content_hash = without_metadata.recompute_hash()?;
    assert_eq!(without_metadata, historical);
    assert_eq!(
        serde_json::to_vec(&without_metadata)?,
        serde_json::to_vec(&historical)?
    );
    assert_eq!(
        current
            .species
            .iter()
            .map(|row| row.form)
            .collect::<Vec<_>>(),
        [0, 1, 2]
    );
    assert_eq!(
        current.species[0]
            .experience
            .as_ref()
            .ok_or("species metadata")?
            .base_exp,
        SafeU53::new(70)?
    );
    let prepared = current.prepare(
        &BTreeSet::from([SpeciesId::try_from_u64(1)?]),
        &BTreeSet::from([MoveId::try_from_u64(22)?]),
    )?;
    let first = prepared.experience_for_source_form(SpeciesId::try_from_u64(1)?, 0)?;
    assert_eq!(first.base_exp, SafeU53::new(100)?);
    assert_eq!(first.source_form, ExperienceSourceFormV2::Form(0));
    let boosted = prepared.experience_for_source_form(SpeciesId::try_from_u64(1)?, 1)?;
    assert_eq!(boosted.base_exp, SafeU53::new(200)?);
    assert_eq!(boosted.boost, ExperienceBoostV2::Mega);
    assert_eq!(boosted.source_form_key.as_deref(), Some("sprite-override"));
    Ok(())
}

#[test]
fn malformed_experience_export_fails_without_reinterpreting_form_rows() {
    for case in 0..7 {
        let mut value = small_definitions(true);
        match case {
            0 => value["species"][1]["experience"]["source_form"]["index"] = serde_json::json!(1),
            1 => value["species"][2]["experience"]["boost"] = serde_json::json!("OTHER"),
            2 => value["species"][2]["experience"]["boost"] = serde_json::json!("MEGA_Z"),
            3 => value["species"][1]["experience"]["source_form_key"] = serde_json::json!("forged"),
            4 => value["species"][1]["experience"] = serde_json::Value::Null,
            5 => {
                value["species"][1]["experience"]["base_exp"] =
                    serde_json::json!(9_007_199_254_740_992_u64)
            }
            _ => value["species"][1]["experience"]["source_form_count"] = serde_json::json!(0),
        }
        assert!(compile_small(&value).is_err(), "case {case}");
    }
}
