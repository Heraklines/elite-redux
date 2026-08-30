use std::sync::Arc;

use er_canonical::canonical_bytes;
use er_game::m7_content::PreparedGameContentV1;
use er_kernel::game_kernel_v6::GameKernelV6;
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_save::{GameSaveV1, migrate_typescript_save_v1};
use er_state::m7_state::{GAME_STATE_SCHEMA_VERSION_V5, GameStateV5};
use er_types::GameContentIdentity;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    BrowserInstanceId, LegacySaveBackupReferenceV1, MechanicalCompatibilityIdentityV1,
    PlatformTimestamp, ProductionContractErrorV1, ProductionReleaseId, SaveGeneration,
    SaveMigratorId, SaveSlotId, valid_sha256, validate_identifier,
};

pub const PRODUCTION_SAVE_ENVELOPE_VERSION_V2: u32 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SaveRuntimeOriginV1 {
    LegacyTypeScript,
    Rust,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveMigrationReceiptV1 {
    pub schema_version: u32,
    pub source_runtime: SaveRuntimeOriginV1,
    pub source_schema: u32,
    pub source_hash: String,
    pub target_runtime: SaveRuntimeOriginV1,
    pub target_schema: u32,
    pub target_hash: String,
    pub migrator_id: SaveMigratorId,
    pub validation_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionSaveEnvelopeV2 {
    pub envelope_version: u32,
    pub slot: SaveSlotId,
    pub pseudonymous_account_id: String,
    pub cloud_generation: SaveGeneration,
    pub origin_runtime: SaveRuntimeOriginV1,
    pub release_id: ProductionReleaseId,
    pub kernel_generation: u64,
    pub mechanical_identity: MechanicalCompatibilityIdentityV1,
    pub authority_protocol: String,
    pub save_schema: u32,
    pub content_hash: String,
    pub payload_hash: String,
    pub payload: Vec<u8>,
    pub migration: Option<SaveMigrationReceiptV1>,
    pub legacy_backup: Option<LegacySaveBackupReferenceV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveLeaseV1 {
    pub schema_version: u32,
    pub slot: SaveSlotId,
    pub holder: BrowserInstanceId,
    pub generation: SaveGeneration,
    pub expires_at: PlatformTimestamp,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedSaveMigrationV1 {
    pub source_bytes: Vec<u8>,
    pub target_payload: Vec<u8>,
    pub receipt: SaveMigrationReceiptV1,
}

pub trait ProductionSaveMigratorV1: std::fmt::Debug {
    fn migrator_id(&self) -> SaveMigratorId;
    fn source_schema(&self) -> u32;
    fn target_schema(&self) -> u32;
    fn migrate(&self, source: &[u8]) -> Result<Vec<u8>, ProductionContractErrorV1>;
    fn validate_fresh_restore(&self, target: &[u8]) -> Result<String, ProductionContractErrorV1>;
}

#[derive(Clone, Debug)]
pub struct LegacyTypeScriptSaveMigratorV1 {
    pub content_identity: GameContentIdentity,
}

impl ProductionSaveMigratorV1 for LegacyTypeScriptSaveMigratorV1 {
    fn migrator_id(&self) -> SaveMigratorId {
        SaveMigratorId("legacy-typescript-v1-to-rust-v1".to_owned())
    }

    fn source_schema(&self) -> u32 {
        1
    }

    fn target_schema(&self) -> u32 {
        1
    }

    fn migrate(&self, source: &[u8]) -> Result<Vec<u8>, ProductionContractErrorV1> {
        migrate_typescript_save_v1(source, &self.content_identity)
            .and_then(|save| save.canonical_bytes())
            .map_err(|_| ProductionContractErrorV1::Save("legacy migration"))
    }

    fn validate_fresh_restore(&self, target: &[u8]) -> Result<String, ProductionContractErrorV1> {
        let save = GameSaveV1::decode_canonical(target, &self.content_identity)
            .map_err(|_| ProductionContractErrorV1::Save("fresh migrated restore"))?;
        save.validate(&self.content_identity)
            .map_err(|_| ProductionContractErrorV1::Save("migrated state validation"))?;
        Ok(sha256(target))
    }
}

impl SaveMigrationReceiptV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        self.migrator_id.validate("save migrator")?;
        if self.schema_version != 1
            || self.source_schema == 0
            || self.target_schema == 0
            || !valid_sha256(&self.source_hash)
            || !valid_sha256(&self.target_hash)
            || !valid_sha256(&self.validation_digest)
            || !matches!(self.target_runtime, SaveRuntimeOriginV1::Rust)
        {
            return Err(ProductionContractErrorV1::Save("migration receipt"));
        }
        Ok(())
    }
}

impl ProductionSaveEnvelopeV2 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        self.slot.validate("save slot")?;
        validate_identifier(&self.pseudonymous_account_id, "save account")?;
        self.release_id.validate("save release")?;
        self.mechanical_identity.validate()?;
        if self.envelope_version != PRODUCTION_SAVE_ENVELOPE_VERSION_V2
            || self.kernel_generation == 0
            || self.authority_protocol != "er-coop-47"
            || self.save_schema == 0
            || self.content_hash.is_empty()
            || self.payload.is_empty()
            || self.payload.len() > 268_435_456
            || !valid_sha256(&self.payload_hash)
            || sha256(&self.payload) != self.payload_hash
        {
            return Err(ProductionContractErrorV1::Save("save envelope"));
        }
        if let Some(receipt) = &self.migration {
            receipt.validate()?;
            if receipt.target_schema != self.save_schema || receipt.target_hash != self.payload_hash
            {
                return Err(ProductionContractErrorV1::Save("migration target mismatch"));
            }
        }
        if matches!(self.origin_runtime, SaveRuntimeOriginV1::Rust)
            && self.migration.is_some()
            && self.legacy_backup.is_none()
        {
            return Err(ProductionContractErrorV1::Save(
                "missing immutable legacy backup",
            ));
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, ProductionContractErrorV1> {
        self.validate()?;
        canonical_bytes(self)
            .map_err(|error| ProductionContractErrorV1::Canonical(error.to_string()))
    }
}

impl SaveLeaseV1 {
    pub fn validate(&self, now: PlatformTimestamp) -> Result<(), ProductionContractErrorV1> {
        self.slot.validate("lease slot")?;
        self.holder.validate("lease holder")?;
        if self.schema_version != 1 || self.expires_at.0 <= now.0 {
            return Err(ProductionContractErrorV1::Save("save lease"));
        }
        Ok(())
    }
}

pub fn prepare_copy_on_write_migration_v1<M: ProductionSaveMigratorV1>(
    source: &[u8],
    source_runtime: SaveRuntimeOriginV1,
    migrator: &M,
) -> Result<PreparedSaveMigrationV1, ProductionContractErrorV1> {
    if source.is_empty() || source.len() > 268_435_456 {
        return Err(ProductionContractErrorV1::Save("migration source size"));
    }
    let source_copy = source.to_vec();
    let first = migrator.migrate(source)?;
    let second = migrator.migrate(source)?;
    if first != second || first.is_empty() || first.len() > 268_435_456 {
        return Err(ProductionContractErrorV1::Save(
            "nondeterministic migration",
        ));
    }
    let first_validation = migrator.validate_fresh_restore(&first)?;
    let second_validation = migrator.validate_fresh_restore(&second)?;
    if first_validation != second_validation || !valid_sha256(&first_validation) {
        return Err(ProductionContractErrorV1::Save(
            "restore validation mismatch",
        ));
    }
    let receipt = SaveMigrationReceiptV1 {
        schema_version: 1,
        source_runtime,
        source_schema: migrator.source_schema(),
        source_hash: sha256(source),
        target_runtime: SaveRuntimeOriginV1::Rust,
        target_schema: migrator.target_schema(),
        target_hash: sha256(&first),
        migrator_id: migrator.migrator_id(),
        validation_digest: first_validation,
    };
    receipt.validate()?;
    Ok(PreparedSaveMigrationV1 {
        source_bytes: source_copy,
        target_payload: first,
        receipt,
    })
}

pub fn restore_game_save_to_kernel_snapshot_v1(
    save: &GameSaveV1,
    template: &RestorableKernelSnapshotV6,
    content: Arc<PreparedGameContentV1>,
) -> Result<Vec<u8>, ProductionContractErrorV1> {
    save.validate(content.identity())
        .map_err(|_| ProductionContractErrorV1::Save("save state validation"))?;
    if template.content_identity != *content.identity()
        || template.protocol.is_some()
        || !template.pending_presentations.is_empty()
        || !template.prepared_transactions.is_empty()
        || !template.pressed_keys.is_empty()
    {
        return Err(ProductionContractErrorV1::Save("unsafe session template"));
    }
    let state = GameStateV5 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: content.identity().clone(),
        profile: save.profile.clone(),
        active_run: save.run.clone(),
    };
    let kernel = GameKernelV6::new(
        state,
        content.clone(),
        template.input_router.clone(),
        template.scheduler.clone(),
        None,
        SafeU53::new(0).map_err(|_| ProductionContractErrorV1::Save("replay sequence"))?,
        None,
    )
    .map_err(|_| ProductionContractErrorV1::Save("fresh kernel construction"))?;
    let snapshot = kernel.snapshot();
    let restored = GameKernelV6::from_snapshot(snapshot.clone(), content)
        .map_err(|_| ProductionContractErrorV1::Save("fresh kernel restore"))?;
    if restored.snapshot() != snapshot {
        return Err(ProductionContractErrorV1::Save(
            "snapshot continuation mismatch",
        ));
    }
    canonical_bytes(&snapshot)
        .map_err(|error| ProductionContractErrorV1::Canonical(error.to_string()))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
