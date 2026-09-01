use std::error::Error;
use std::sync::Arc;

use er_content_compiler::m9e_bundle::build_m9_engineering_bundle_v2;
use er_game::m9e_content_v2::PreparedGameContentV2;

macro_rules! fixture {
    ($path:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/",
            $path
        ))
    };
}

const BATTLE: &[u8] = fixture!("m9/engineering/battle-content-pack-v3.json");
const RUN: &[u8] = fixture!("m9/engineering/run-content-pack-v3.json");
const PROGRESSION: &[u8] = fixture!("m9/engineering/progression-content-pack-v2.json");
const WORLD: &[u8] = fixture!("m9/engineering/world-content-pack-v2.json");
const SCENARIOS: &[u8] = fixture!("m9/engineering/scenario-content-pack-v2.json");
const AI: &[u8] = fixture!("m9/engineering/ai-policy-pack-v2.json");
const BOOTSTRAP: &[u8] = fixture!("m9/engineering/bootstrap-content-pack-v1.json");
const PRESENTATION: &[u8] = fixture!("m9/engineering/presentation-content-pack-v1.json");
const CATALOG: &[u8] = fixture!("m7/run-behavior-unit-manifest-v1.json");
const IMPLEMENTATIONS: &[u8] = fixture!("m7/m7-behavior-implementation-v2.json");
const BUNDLE: &[u8] = fixture!("m9/engineering/game-content-bundle-v2.json");

fn build() -> Result<er_game::m9e_content_v2::GameContentBundleV2, Box<dyn Error>> {
    Ok(build_m9_engineering_bundle_v2(
        BATTLE,
        RUN,
        PROGRESSION,
        WORLD,
        SCENARIOS,
        AI,
        BOOTSTRAP,
        PRESENTATION,
        CATALOG,
        IMPLEMENTATIONS,
    )?)
}

#[test]
fn direct_bundle_is_byte_stable_and_prepares_without_v1_domains() -> Result<(), Box<dyn Error>> {
    let first = build()?;
    let second = build()?;
    assert_eq!(first, second);
    assert_eq!(serde_json::to_vec(&first)?, BUNDLE);
    assert!(
        !BUNDLE
            .windows(b"\"core\"".len())
            .any(|window| window == b"\"core\"")
    );
    assert!(
        !BUNDLE
            .windows(b"world_v2".len())
            .any(|window| window == b"world_v2")
    );
    let prepared = PreparedGameContentV2::prepare(Arc::new(first))?;
    assert_eq!(prepared.identity().bundle_hash, *prepared.content_hash());
    Ok(())
}
