use std::collections::BTreeSet;
use std::error::Error;

use er_content::pack::m6_prepared::prepare_content;
use er_content_compiler::m9e_full_content::{
    build_m9_engineering_battle_pack_v1, build_m9_engineering_bootstrap_content_v1,
    build_m9_engineering_world_content_v2,
};

const DEFINITIONS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/complete-battle-definitions-v1.json"
));
const SEMANTIC: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m7/m6-refresh/semantic-catalog-v1.json"
));
const BESPOKE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m7/m6-refresh/bespoke-clusters-v1.json"
));
const PACK: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/battle-content-pack-v3.json"
));

const WORLD: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/world-content-pack-v2.json"
));
const BOOTSTRAP: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/bootstrap-content-pack-v1.json"
));

#[test]
fn complete_pinned_definitions_build_one_prepared_battle_pack() -> Result<(), Box<dyn Error>> {
    let pack = build_m9_engineering_battle_pack_v1(DEFINITIONS, SEMANTIC, BESPOKE)?;
    assert_eq!(pack.species.iter().flatten().count(), 1_962);
    assert_eq!(pack.forms.len(), 3_384);
    assert_eq!(pack.moves.iter().flatten().count(), 1_109);
    assert_eq!(pack.abilities.iter().flatten().count(), 1_261);
    assert_eq!(pack.held_items.len(), 215);
    assert_eq!(pack.field_content.statuses.iter().flatten().count(), 8);
    assert_eq!(pack.field_content.weather.iter().flatten().count(), 13);
    assert_eq!(pack.field_content.terrain.iter().flatten().count(), 6);
    assert_eq!(
        pack.field_content.side_conditions.len()
            + pack.field_content.battler_tags.len()
            + pack.field_content.arena_tags.len()
            + pack.field_content.positional_tags.len(),
        168
    );
    assert_eq!(pack.programs.iter().flatten().count(), 3_678);
    assert_eq!(pack.classifications.0.len(), 9_411);
    assert_eq!(pack.type_chart.entries.len(), 120);
    assert_eq!(serde_json::to_vec(&pack)?, PACK);
    prepare_content(pack)?;
    Ok(())
}

#[test]
fn complete_pinned_world_preserves_pool_dimensions() -> Result<(), Box<dyn Error>> {
    let battle = build_m9_engineering_battle_pack_v1(DEFINITIONS, SEMANTIC, BESPOKE)?;
    let species = battle
        .species
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let world = build_m9_engineering_world_content_v2(DEFINITIONS, &species)?;
    assert_eq!(world.modes.len(), 9);
    assert_eq!(world.biomes.len(), 35);
    assert!(
        world
            .biomes
            .iter()
            .map(|biome| biome.pokemon_pools.len())
            .sum::<usize>()
            > 250
    );
    assert!(
        world
            .biomes
            .iter()
            .map(|biome| biome.trainer_pools.len())
            .sum::<usize>()
            > 50
    );
    assert_eq!(serde_json::to_vec(&world)?, WORLD);
    Ok(())
}

#[test]
fn complete_bootstrap_catalog_cross_references_full_battle_and_world() -> Result<(), Box<dyn Error>>
{
    let battle = build_m9_engineering_battle_pack_v1(DEFINITIONS, SEMANTIC, BESPOKE)?;
    let species = battle
        .species
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let world = build_m9_engineering_world_content_v2(DEFINITIONS, &species)?;
    let bootstrap = build_m9_engineering_bootstrap_content_v1(DEFINITIONS, &battle, &world)?;
    assert_eq!(bootstrap.modes.len(), 9);
    assert_eq!(bootstrap.starters.len(), 706);
    assert_eq!(bootstrap.maximum_starter_cost, 10);
    assert_eq!(bootstrap.maximum_starters, 6);
    assert_eq!(serde_json::to_vec(&bootstrap)?, BOOTSTRAP);
    Ok(())
}
