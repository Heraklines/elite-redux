use std::sync::Arc;

use er_canonical::canonical_bytes;
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_production::{
    LegacySaveBackupReferenceV1, LegacyTypeScriptSaveMigratorV1, MechanicalCompatibilityIdentityV1,
    ProductionReleaseId, ProductionSaveEnvelopeV2, RUST_PREVIEW_SAVE_NAMESPACE_V1, SaveGeneration,
    SaveRuntimeOriginV1, SaveSlotId, prepare_copy_on_write_migration_v1,
    restore_game_save_to_kernel_snapshot_v1,
};
use er_save::GameSaveV1;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionSaveMigrationMetadataV1 {
    pub schema_version: u32,
    pub slot: SaveSlotId,
    pub pseudonymous_account_id: String,
    pub cloud_generation: SafeU53,
    pub release_id: ProductionReleaseId,
    pub kernel_generation: u64,
    pub mechanical_identity: MechanicalCompatibilityIdentityV1,
    pub save_schema: u32,
    pub legacy_backup: LegacySaveBackupReferenceV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionSaveMigrationOutputV1 {
    pub schema_version: u32,
    pub envelope_bytes: Vec<u8>,
    pub session_start_bytes: Vec<u8>,
}

pub fn migrate_production_save_v2_native(
    content_bytes: &[u8],
    legacy_bytes: &[u8],
    template_bytes: &[u8],
    metadata_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let bundle: GameContentBundleV1 =
        serde_json::from_slice(content_bytes).map_err(|error| error.to_string())?;
    let content = Arc::new(
        PreparedGameContentV1::prepare(Arc::new(bundle)).map_err(|error| error.to_string())?,
    );
    let metadata: ProductionSaveMigrationMetadataV1 =
        serde_json::from_slice(metadata_bytes).map_err(|error| error.to_string())?;
    if metadata.schema_version != 1
        || metadata.kernel_generation == 0
        || metadata.save_schema != 1
        || metadata.mechanical_identity.content_hash != content.identity().content_hash.to_string()
    {
        return Err("production save migration metadata is incompatible".to_owned());
    }
    let template: RestorableKernelSnapshotV6 =
        serde_json::from_slice(template_bytes).map_err(|error| error.to_string())?;
    let migrator = LegacyTypeScriptSaveMigratorV1 {
        content_identity: content.identity().clone(),
    };
    let prepared = prepare_copy_on_write_migration_v1(
        legacy_bytes,
        SaveRuntimeOriginV1::LegacyTypeScript,
        &migrator,
    )
    .map_err(|error| error.to_string())?;
    let save = GameSaveV1::decode_canonical(&prepared.target_payload, content.identity())
        .map_err(|error| error.to_string())?;
    let session_start_bytes = restore_game_save_to_kernel_snapshot_v1(&save, &template, content)
        .map_err(|error| error.to_string())?;
    let envelope = ProductionSaveEnvelopeV2 {
        envelope_version: 2,
        save_namespace: RUST_PREVIEW_SAVE_NAMESPACE_V1.to_owned(),
        slot: metadata.slot,
        pseudonymous_account_id: metadata.pseudonymous_account_id,
        cloud_generation: SaveGeneration(metadata.cloud_generation),
        origin_runtime: SaveRuntimeOriginV1::Rust,
        release_id: metadata.release_id,
        kernel_generation: metadata.kernel_generation,
        mechanical_identity: metadata.mechanical_identity,
        authority_protocol: "er-coop-47".to_owned(),
        save_schema: metadata.save_schema,
        content_hash: content_hash(&save),
        payload_hash: prepared.receipt.target_hash.clone(),
        payload: prepared.target_payload,
        migration: Some(prepared.receipt),
        legacy_backup: Some(metadata.legacy_backup),
    };
    envelope.validate().map_err(|error| error.to_string())?;
    canonical_bytes(&ProductionSaveMigrationOutputV1 {
        schema_version: 1,
        envelope_bytes: envelope
            .canonical_bytes()
            .map_err(|error| error.to_string())?,
        session_start_bytes,
    })
    .map_err(|error| error.to_string())
}

fn content_hash(save: &GameSaveV1) -> String {
    save.game_content_hash.to_string()
}

pub fn restore_production_save_v2_native(
    content_bytes: &[u8],
    envelope_bytes: &[u8],
    template_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let bundle: GameContentBundleV1 =
        serde_json::from_slice(content_bytes).map_err(|error| error.to_string())?;
    let content = Arc::new(
        PreparedGameContentV1::prepare(Arc::new(bundle)).map_err(|error| error.to_string())?,
    );
    let envelope: ProductionSaveEnvelopeV2 =
        serde_json::from_slice(envelope_bytes).map_err(|error| error.to_string())?;
    envelope.validate().map_err(|error| error.to_string())?;
    if envelope.content_hash != content.identity().content_hash.to_string() {
        return Err("production save content identity differs from release".to_owned());
    }
    let save = GameSaveV1::decode_canonical(&envelope.payload, content.identity())
        .map_err(|error| error.to_string())?;
    let template: RestorableKernelSnapshotV6 =
        serde_json::from_slice(template_bytes).map_err(|error| error.to_string())?;
    restore_game_save_to_kernel_snapshot_v1(&save, &template, content)
        .map_err(|error| error.to_string())
}
