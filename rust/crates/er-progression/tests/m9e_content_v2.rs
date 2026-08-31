use std::collections::BTreeSet;
use std::error::Error;

use er_progression::content_v2::{
    CaptureBallDefinitionV2, LevelMoveV2, PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V2,
    ProgressionContentPackV2, SpeciesProgressionDefinitionV2,
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
