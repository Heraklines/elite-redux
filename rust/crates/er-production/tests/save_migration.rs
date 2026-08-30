use er_production::{
    LegacyTypeScriptSaveMigratorV1, ProductionSaveMigratorV1, SaveRuntimeOriginV1,
    prepare_copy_on_write_migration_v1,
};
use er_save::{GameSaveV1, TypeScriptSaveEnvelopeV1};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    BattleContentPackHashV3, CatalogHash, GameContentBundleHash, GameContentIdentity, OracleSha,
    SafeU53,
};

#[test]
fn legacy_migration_is_deterministic_idempotent_and_preserves_source()
-> Result<(), Box<dyn std::error::Error>> {
    let identity = content_identity()?;
    let source = er_canonical::canonical_bytes(&TypeScriptSaveEnvelopeV1 {
        schema_version: 1,
        game_content_hash: identity.content_hash.to_string(),
        profile: profile()?,
        run: None,
    })?;
    let immutable = source.clone();
    let migrator = LegacyTypeScriptSaveMigratorV1 {
        content_identity: identity.clone(),
    };
    let first = prepare_copy_on_write_migration_v1(
        &source,
        SaveRuntimeOriginV1::LegacyTypeScript,
        &migrator,
    )?;
    let second = prepare_copy_on_write_migration_v1(
        &source,
        SaveRuntimeOriginV1::LegacyTypeScript,
        &migrator,
    )?;
    assert_eq!(source, immutable);
    assert_eq!(first, second);
    assert_eq!(first.source_bytes, source);
    assert_eq!(
        migrator.validate_fresh_restore(&first.target_payload)?,
        first.receipt.validation_digest
    );
    assert_eq!(
        GameSaveV1::decode_canonical(&first.target_payload, &identity)?.canonical_bytes()?,
        first.target_payload
    );
    Ok(())
}

#[test]
fn unsupported_or_corrupt_legacy_sources_fail_without_output()
-> Result<(), Box<dyn std::error::Error>> {
    let migrator = LegacyTypeScriptSaveMigratorV1 {
        content_identity: content_identity()?,
    };
    assert!(
        prepare_copy_on_write_migration_v1(
            br#"{"schema_version":99}"#,
            SaveRuntimeOriginV1::LegacyTypeScript,
            &migrator,
        )
        .is_err()
    );
    assert!(
        prepare_copy_on_write_migration_v1(
            b"not-json",
            SaveRuntimeOriginV1::LegacyTypeScript,
            &migrator,
        )
        .is_err()
    );
    Ok(())
}

fn content_identity() -> Result<GameContentIdentity, Box<dyn std::error::Error>> {
    Ok(GameContentIdentity {
        oracle_sha: OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7")?,
        content_hash: GameContentBundleHash::parse(format!("blake3-v1:{}", "a".repeat(64)))?,
        battle_content_hash: BattleContentPackHashV3::parse(format!(
            "blake3-v3:{}",
            "b".repeat(64)
        ))?,
        semantic_catalog_hash: CatalogHash::parse("c".repeat(64))?,
    })
}

fn profile() -> Result<ProfileStateV1, Box<dyn std::error::Error>> {
    Ok(ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(SafeU53::new(1)?)?,
        },
        dex: DexState::default(),
    })
}
