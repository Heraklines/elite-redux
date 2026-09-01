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
