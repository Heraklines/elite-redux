use er_canonical::canonical_bytes;
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_production::{
    LegacySaveBackupReferenceV1, MechanicalCompatibilityIdentityV1, ProductionReleaseId, SaveSlotId,
};
use er_save::TypeScriptSaveEnvelopeV1;
use er_types::SafeU53;
use er_web::{
    ProductionSaveMigrationMetadataV1, ProductionSaveMigrationOutputV1,
    migrate_production_save_v2_native,
};
use std::sync::Arc;

const CONTENT: &[u8] = include_bytes!("../../../fixtures/m8/browser-reference/content-pack.json");
const TEMPLATE: &[u8] = include_bytes!("../../../fixtures/m8/browser-reference/session-start.json");

#[test]
fn production_migration_preserves_source_and_returns_restorable_kernel_snapshot()
-> Result<(), Box<dyn std::error::Error>> {
    let bundle: GameContentBundleV1 = serde_json::from_slice(CONTENT)?;
    let content = PreparedGameContentV1::prepare(Arc::new(bundle))?;
    let template: RestorableKernelSnapshotV6 = serde_json::from_slice(TEMPLATE)?;
    let source = canonical_bytes(&TypeScriptSaveEnvelopeV1 {
        schema_version: 1,
        game_content_hash: content.identity().content_hash.to_string(),
        profile: template.game_state.profile.clone(),
        run: template.game_state.active_run.clone(),
    })?;
    let immutable_source = source.clone();
    let metadata = canonical_bytes(&ProductionSaveMigrationMetadataV1 {
        schema_version: 1,
        slot: SaveSlotId("slot-0".to_owned()),
        pseudonymous_account_id: "account-test".to_owned(),
        cloud_generation: SafeU53::new(1)?,
        release_id: ProductionReleaseId("release-test".to_owned()),
        kernel_generation: 1,
        mechanical_identity: MechanicalCompatibilityIdentityV1 {
            schema_version: 1,
            mechanics_sha256: "a".repeat(64),
            content_hash: content.identity().content_hash.to_string(),
            authority_protocol: "er-coop-47".to_owned(),
            active_model_identity: "model-test".to_owned(),
        },
        save_schema: 1,
        legacy_backup: LegacySaveBackupReferenceV1("legacy-backup-test".to_owned()),
    })?;
    let first = migrate_production_save_v2_native(CONTENT, &source, TEMPLATE, &metadata)?;
    let second = migrate_production_save_v2_native(CONTENT, &source, TEMPLATE, &metadata)?;
    assert_eq!(source, immutable_source);
    assert_eq!(first, second);
    let output: ProductionSaveMigrationOutputV1 = serde_json::from_slice(&first)?;
    let restored: RestorableKernelSnapshotV6 = serde_json::from_slice(&output.session_start_bytes)?;
    assert_eq!(restored.game_state.profile, template.game_state.profile);
    assert_eq!(
        restored.game_state.active_run,
        template.game_state.active_run
    );
    assert!(!output.envelope_bytes.is_empty());
    Ok(())
}
