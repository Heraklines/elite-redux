use std::error::Error;

use er_run::capability::{CapabilityManifestError, selected_run_capability_manifest};
use er_run::content::{RUN_CONTENT_HASH_DOMAIN, RunContentError, selected_run_content_pack};
use er_types::battle_ids::ContentPackHash;
use er_types::run_ids::ModifierId;
use er_types::run_model::ModifierTier;

fn battle_hash() -> Result<ContentPackHash, Box<dyn Error>> {
    Ok(ContentPackHash::new(format!(
        "blake3-v1:{}",
        "0".repeat(64)
    ))?)
}

#[test]
fn selected_pack_is_typed_and_retains_numeric_holes() -> Result<(), Box<dyn Error>> {
    let pack = selected_run_content_pack(battle_hash()?)?;
    assert_eq!(
        pack.m4_oracle_sha,
        "45c89493e7edec9c4da247a98cd7858b1f015c09"
    );
    assert_eq!(
        pack.m3_parity_oracle_sha,
        "3b534099919efae827019d4a3f3c4ab0ecd6d67b"
    );
    assert!(pack.growth_rates[0].is_none());
    assert_eq!(
        pack.growth_rates[3]
            .as_ref()
            .map(|value| value.key.as_str()),
        Some("MEDIUM_SLOW")
    );
    assert!(pack.modifiers[8].is_none());
    assert!(pack.species_progression[1].is_none());
    let progression = pack.species_progression[932]
        .as_ref()
        .ok_or("Nacli progression missing")?;
    assert_eq!(
        (
            progression.parity_level_before,
            progression.parity_level_after
        ),
        (16, 17)
    );
    assert_eq!(progression.base_experience, 56);
    assert_eq!(progression.level_moves.len(), 1);
    assert_eq!(progression.level_moves[0].move_id.to_string(), "34");
    assert_eq!(progression.evolutions[0].minimum_level, 23);
    assert_eq!(
        progression
            .current_moves
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        vec!["1", "52", "77", "78"]
    );
    assert_eq!(
        pack.biomes[2]
            .as_ref()
            .ok_or("Grass biome missing")?
            .base_routes
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        vec!["3"]
    );
    assert_eq!(
        pack.biomes[4]
            .as_ref()
            .ok_or("Metropolis biome missing")?
            .base_routes
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        vec!["30"]
    );
    assert_eq!(
        pack.biomes[9]
            .as_ref()
            .ok_or("Lake biome missing")?
            .base_routes
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        vec!["8", "7", "26"]
    );
    assert_eq!(
        pack.modifier_by_registry_key("LOCK_CAPSULE")
            .map(|value| value.id.to_string()),
        Some("7".to_owned())
    );
    assert_eq!(
        pack.modifier_by_registry_key("GOLDEN_EXP_CHARM")
            .ok_or("Golden EXP Charm missing")?
            .tier,
        None
    );
    assert_eq!(
        pack.modifier_by_registry_key("LOCK_CAPSULE")
            .ok_or("Lock Capsule missing")?
            .tier,
        Some(ModifierTier::Rogue)
    );
    assert!(!pack.market_rules.supports_reroll);
    assert!(!RUN_CONTENT_HASH_DOMAIN.is_empty());
    Ok(())
}

#[test]
fn selected_manifest_is_fail_closed_and_prohibits_replica_generation() -> Result<(), Box<dyn Error>>
{
    let manifest = selected_run_capability_manifest()?;
    manifest.validate()?;
    assert!(manifest.replica_generation_forbidden);
    assert!(!manifest.replica_may_generate());
    Ok(())
}

#[test]
fn duplicate_modifier_key_fails_before_hash_acceptance() -> Result<(), Box<dyn Error>> {
    let pack = selected_run_content_pack(battle_hash()?)?;
    let mut changed = pack.clone();
    let Some(mut duplicate) = changed.modifiers[1].clone() else {
        return Err("selected ID 1 missing".into());
    };
    duplicate.id = ModifierId::try_from_u64(2)?;
    changed.modifiers[2] = Some(duplicate);
    assert!(matches!(
        changed.validate(),
        Err(RunContentError::Duplicate {
            kind: "modifier registry key",
            ..
        })
    ));
    Ok(())
}

#[test]
fn biome_market_cannot_gain_reward_shop_capabilities() -> Result<(), Box<dyn Error>> {
    let mut manifest = selected_run_capability_manifest()?;
    manifest.biome_market_actions.clear();
    assert!(matches!(
        manifest.validate(),
        Err(CapabilityManifestError::EmptySupported {
            kind: "biome market action"
        })
    ));
    Ok(())
}
