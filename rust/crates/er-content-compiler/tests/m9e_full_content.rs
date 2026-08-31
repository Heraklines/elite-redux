use std::error::Error;

use er_content::pack::m6_prepared::prepare_content;
use er_content_compiler::m9e_full_content::build_m9_engineering_battle_pack_v1;

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
