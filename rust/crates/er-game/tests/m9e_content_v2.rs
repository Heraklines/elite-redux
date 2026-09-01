use std::error::Error;
use std::sync::Arc;

use er_game::m7_content::GameContentBundleV1;
use er_game::m9e_content_v2::{
    BOOTSTRAP_CONTENT_SCHEMA_VERSION_V1, BootstrapContentPackV1, BootstrapModeDefinitionV2,
    GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V2, GameContentBundleV2, LevelMoveDefinitionV1,
    PreparedGameContentV2, PresentationContentPackV1, StarterDefinitionV2,
};
use er_types::battle_ids::{GameModeId, MoveId, SpeciesId};
use er_types::run_ids::BiomeId;
use er_types::{CatalogHash, GameContentBundleHash, RunDifficultyV1, SafeU53};
use er_world::content_v2::{
    BiomeDefinitionV2, BiomeSpeciesPoolV2, GameModeDefinitionV2 as WorldModeDefinitionV2,
    WORLD_CONTENT_PACK_SCHEMA_VERSION_V2, WeightedOracleCodeV2, WorldContentPackV2,
};

const CORE: &[u8] = include_bytes!("../../../fixtures/m9/solo-entry/content-pack.json");
const PRESENTATION: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/presentation-content-pack-v1.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture value is safe")
}

fn zero_catalog() -> CatalogHash {
    CatalogHash::parse("0".repeat(64)).expect("zero catalog hash is representable")
}

fn zero_bundle() -> GameContentBundleHash {
    GameContentBundleHash::parse(format!("blake3-v1:{}", "0".repeat(64)))
        .expect("zero bundle hash is representable")
}

fn world(core: &GameContentBundleV1) -> Result<WorldContentPackV2, Box<dyn Error>> {
    let mut world = WorldContentPackV2 {
        schema_version: WORLD_CONTENT_PACK_SCHEMA_VERSION_V2,
        oracle_sha: core.oracle_sha.clone(),
        content_hash: zero_catalog(),
        modes: vec![WorldModeDefinitionV2 {
            id: GameModeId::new(safe(0)),
            key: "classic".to_owned(),
            starting_level: 5,
            starting_money: safe(1_200),
            starting_biome: BiomeId::new(safe(0)),
            challenge_selection: false,
            cooperative: false,
            supported: true,
        }],
        biomes: vec![BiomeDefinitionV2 {
            id: BiomeId::new(safe(0)),
            key: "biome/0".to_owned(),
            pokemon_pools: vec![BiomeSpeciesPoolV2 {
                tier: 0,
                time_of_day: 0,
                species: vec![SpeciesId::try_from_u64(1)?],
            }],
            trainer_pools: Vec::new(),
            trainer_chance_denominator: 0,
            weather_pool: vec![WeightedOracleCodeV2 { code: 0, weight: 1 }],
            terrain_pool: vec![WeightedOracleCodeV2 { code: 0, weight: 1 }],
            links: Vec::new(),
        }],
    };
    world.content_hash = world.recompute_hash()?;
    Ok(world)
}

fn bundle() -> Result<GameContentBundleV2, Box<dyn Error>> {
    let core: GameContentBundleV1 = serde_json::from_slice(CORE)?;
    let oracle_sha = core.oracle_sha.clone();
    let mut bootstrap = BootstrapContentPackV1 {
        schema_version: BOOTSTRAP_CONTENT_SCHEMA_VERSION_V1,
        oracle_sha: oracle_sha.clone(),
        content_hash: zero_catalog(),
        modes: vec![BootstrapModeDefinitionV2 {
            mode: GameModeId::new(safe(0)),
            key: "classic".to_owned(),
            starting_level: 5,
            starting_money: safe(1_200),
            starting_biome: BiomeId::new(safe(0)),

            challenge_selection: false,
            cooperative: false,
            supported: true,
        }],
        starters: vec![StarterDefinitionV2 {
            species_id: SpeciesId::try_from_u64(1)?,
            form_index: 0,
            cost: 3,
            ability_index: 0,
            level_moves: vec![LevelMoveDefinitionV1 {
                level: 1,
                move_id: MoveId::try_from_u64(22)?,
            }],
        }],
        choices: Vec::new(),
        difficulties: vec![RunDifficultyV1::Youngster, RunDifficultyV1::Ace],
        maximum_starter_cost: 10,
        maximum_starters: 6,
    };
    bootstrap.content_hash = bootstrap.recompute_hash()?;
    let presentation: PresentationContentPackV1 = serde_json::from_slice(PRESENTATION)?;
    let world_v2 = world(&core)?;
    let mut value = GameContentBundleV2 {
        schema_version: GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V2,
        oracle_sha,
        core: Arc::new(core),
        world_v2: Arc::new(world_v2),
        bootstrap: Arc::new(bootstrap),
        presentation: Arc::new(presentation),
        content_hash: zero_bundle(),
    };
    value.content_hash = value.recompute_hash()?;
    Ok(value)
}

#[test]
fn content_v2_prepares_one_cross_referenced_identity() -> Result<(), Box<dyn Error>> {
    let value = bundle()?;
    let first = PreparedGameContentV2::prepare(Arc::new(value.clone()))?;
    let second = PreparedGameContentV2::prepare(Arc::new(value))?;
    assert_eq!(first.content_hash(), second.content_hash());
    assert_eq!(first.bundle().bootstrap.starters.len(), 1);
    assert_eq!(first.bundle().presentation.mappings.len(), 55);
    assert_eq!(
        first.core().bundle().battle.moves.iter().flatten().count(),
        5
    );
    Ok(())
}

#[test]
fn unresolved_starter_move_fails_closed() -> Result<(), Box<dyn Error>> {
    let mut value = bundle()?;
    Arc::make_mut(&mut value.bootstrap).starters[0].level_moves[0].move_id =
        MoveId::try_from_u64(9_999)?;
    Arc::make_mut(&mut value.bootstrap).content_hash = value.bootstrap.recompute_hash()?;
    value.content_hash = value.recompute_hash()?;
    assert!(PreparedGameContentV2::prepare(Arc::new(value)).is_err());
    Ok(())
}
