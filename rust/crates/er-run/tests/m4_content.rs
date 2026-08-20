use er_types::battle_ids::ContentPackHash;
use er_types::run_ids::ModifierId;
use er_run::capability::{selected_run_capability_manifest, CapabilityManifestError};
use er_run::content::{selected_run_content_pack, RunContentError, RUN_CONTENT_HASH_DOMAIN};

fn battle_hash() -> ContentPackHash {
    ContentPackHash::new(format!("blake3-v1:{}", "0".repeat(64))).expect("test hash is valid")
}

#[test]
fn selected_pack_is_typed_and_retains_numeric_holes() {
    let pack = selected_run_content_pack(battle_hash()).expect("selected content constants are valid");
    assert_eq!(pack.oracle_game_sha, "45c89493e7edec9c4da247a98cd7858b1f015c09");
    assert!(pack.growth_rates[0].is_none());
    assert_eq!(pack.growth_rates[3].as_ref().map(|value| value.key.as_str()), Some("MEDIUM_SLOW"));
    assert!(pack.modifiers[8].is_none());
    assert_eq!(pack.modifier_by_registry_key("LOCK_CAPSULE").map(|value| value.id.to_string()), Some("7".to_owned()));
    assert!(!pack.market_rules.supports_reroll);
    assert!(!RUN_CONTENT_HASH_DOMAIN.is_empty());
}

#[test]
fn selected_manifest_is_fail_closed_and_prohibits_replica_generation() {
    let manifest = selected_run_capability_manifest();
    manifest.validate().expect("selected capability manifest is valid");
    assert!(manifest.replica_generation_forbidden);
    assert!(!manifest.replica_may_generate());
}

#[test]
fn duplicate_modifier_key_fails_before_hash_acceptance() {
    let pack = selected_run_content_pack(battle_hash()).expect("selected content constants are valid");
    let mut changed = pack.clone();
    let mut duplicate = changed.modifiers[1].clone().expect("selected ID 1 exists");
    duplicate.id = ModifierId::try_from_u64(2).expect("test ID is safe");
    changed.modifiers[2] = Some(duplicate);
    assert!(matches!(changed.validate(), Err(RunContentError::Duplicate { kind: "modifier registry key", .. })));
}

#[test]
fn biome_market_cannot_gain_reward_shop_capabilities() {
    let mut manifest = selected_run_capability_manifest();
    manifest.biome_market_actions.clear();
    assert!(matches!(manifest.validate(), Err(CapabilityManifestError::EmptySupported { kind: "biome market action" })));
}
