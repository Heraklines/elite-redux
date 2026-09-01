use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{
    GameContentBundleV2, PreparedGameContentV2, PresentationSemanticIdV1,
};
use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::{AiPolicyId, GameControlKindV2, SafeU53, ScenarioId};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture value is safe")
}

#[test]
fn direct_content_v2_prepares_every_current_domain() -> Result<(), Box<dyn Error>> {
    let value: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let first = PreparedGameContentV2::prepare(Arc::new(value.clone()))?;
    let second = PreparedGameContentV2::prepare(Arc::new(value))?;
    assert_eq!(first.identity(), second.identity());
    assert_eq!(
        first.bundle().battle.species.iter().flatten().count(),
        1_962
    );
    assert_eq!(first.bundle().progression.species.len(), 3_384);
    assert_eq!(first.bundle().world.biomes.len(), 35);
    assert_eq!(first.bundle().scenarios.scenarios.len(), 91);
    assert_eq!(first.bundle().ai.behavior_bindings.len(), 2_586);
    assert_eq!(first.bundle().meta.classifications.len(), 6_870);
    assert_eq!(first.bundle().bootstrap.starters.len(), 706);
    assert_eq!(first.bundle().presentation.mappings.len(), 55);
    assert!(
        first
            .progression
            .species(SpeciesId::new(safe(1)), 0)
            .is_some()
    );
    assert!(first.scenarios.scenario(ScenarioId::ZERO).is_some());
    assert!(first.ai.policy(AiPolicyId::new(safe(3))).is_some());
    assert!(
        first
            .presentation(PresentationSemanticIdV1::Control(
                GameControlKindV2::BattleCommand
            ))
            .is_some()
    );
    Ok(())
}

#[test]
fn unresolved_starter_move_fails_closed() -> Result<(), Box<dyn Error>> {
    let mut value: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Arc::make_mut(&mut value.bootstrap).starters[0].level_moves[0].move_id =
        MoveId::try_from_u64(9_999)?;
    Arc::make_mut(&mut value.bootstrap).content_hash = value.bootstrap.recompute_hash()?;
    value.content_hash = value.recompute_hash()?;
    assert!(PreparedGameContentV2::prepare(Arc::new(value)).is_err());
    Ok(())
}

#[test]
fn direct_bundle_rejects_legacy_core_fields() -> Result<(), Box<dyn Error>> {
    let mut value: serde_json::Value = serde_json::from_slice(BUNDLE)?;
    value
        .as_object_mut()
        .expect("bundle is an object")
        .insert("core".to_owned(), serde_json::json!({}));
    assert!(serde_json::from_value::<GameContentBundleV2>(value).is_err());
    Ok(())
}
