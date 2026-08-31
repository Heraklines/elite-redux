use std::error::Error;
use std::sync::Arc;

use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_content::pack::m6_prepared::prepare_content;
use er_content_compiler::m9::{
    M9_BOOTSTRAP_ORACLE_SHA, build_m9_game_content_bundle, build_m9_vertical_slice_pack,
};
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};

const BASE_BUNDLE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m8/browser-reference/content-pack.json"
));
const STARTER: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/starter-oracle-v1.json"
));
const SEMANTIC: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/semantic/semantic-catalog-v1.json"
));
const BESPOKE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/semantic/bespoke-clusters-v1.json"
));
const PACK_FIXTURE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/battle-content-pack-v3.json"
));
const BUNDLE_FIXTURE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/content-pack.json"
));

#[test]
fn pinned_oracle_builds_nonempty_validated_v3_pack() -> Result<(), Box<dyn Error>> {
    let pack = build_m9_vertical_slice_pack(STARTER, SEMANTIC, BESPOKE)?;
    assert_eq!(pack.oracle_sha.as_str(), M9_BOOTSTRAP_ORACLE_SHA);
    assert_eq!(pack.species.iter().flatten().count(), 2);
    assert_eq!(pack.moves.iter().flatten().count(), 5);
    assert_eq!(pack.abilities.iter().flatten().count(), 5);
    assert!(pack.programs.iter().flatten().count() > 0);
    prepare_content(pack.clone())?;

    let bytes = serde_json::to_vec(&pack)?;
    assert_eq!(bytes, PACK_FIXTURE);
    let decoded = load_battle_content_pack_v3(&bytes)?;
    assert_eq!(decoded, pack);

    let bundle = build_m9_game_content_bundle(BASE_BUNDLE, STARTER, SEMANTIC, BESPOKE)?;
    assert_eq!(bundle.battle.species.iter().flatten().count(), 2);
    assert_eq!(bundle.battle.moves.iter().flatten().count(), 5);
    assert_eq!(bundle.battle.abilities.iter().flatten().count(), 5);
    PreparedGameContentV1::prepare(Arc::new(bundle.clone()))?;
    let encoded_bundle = serde_json::to_vec(&bundle)?;
    assert_eq!(encoded_bundle, BUNDLE_FIXTURE);
    let decoded_bundle: GameContentBundleV1 = serde_json::from_slice(&encoded_bundle)?;
    assert_eq!(decoded_bundle, bundle);
    Ok(())
}
