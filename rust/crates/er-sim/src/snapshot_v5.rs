//! Restorable simulated-pair snapshot V5.

use er_state::migration_v4::GameStateV4;
use er_types::M6_RESTORABLE_SNAPSHOT_VERSION;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot_v4::{PairSnapshotV4Error, RestorablePairSnapshotV4};

pub const RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V5: u32 = M6_RESTORABLE_SNAPSHOT_VERSION;
pub const PAIR_DETERMINISM_DIGEST_SCHEMA_VERSION_V4: u32 = 4;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorablePairSnapshotV5 {
    pub schema_version: u32,
    pub base: RestorablePairSnapshotV4,
    pub host_game_v4: GameStateV4,
    pub guest_game_v4: GameStateV4,
}

impl RestorablePairSnapshotV5 {
    pub fn new(
        base: RestorablePairSnapshotV4,
        host_game_v4: GameStateV4,
        guest_game_v4: GameStateV4,
    ) -> Result<Self, PairSnapshotV5Error> {
        let snapshot = Self {
            schema_version: RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V5,
            base,
            host_game_v4,
            guest_game_v4,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub fn validate(&self) -> Result<(), PairSnapshotV5Error> {
        if self.schema_version != RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V5 {
            return Err(PairSnapshotV5Error::SchemaVersion {
                expected: RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V5,
                actual: self.schema_version,
            });
        }
        self.base.validate().map_err(PairSnapshotV5Error::Base)?;
        self.host_game_v4
            .validate()
            .map_err(PairSnapshotV5Error::HostGame)?;
        self.guest_game_v4
            .validate()
            .map_err(PairSnapshotV5Error::GuestGame)?;
        if self.host_game_v4.base != self.base.host_game_v3.base
            || self.guest_game_v4.base != self.base.guest_game_v3.base
        {
            return Err(PairSnapshotV5Error::StateFrontierMismatch);
        }
        if self.host_game_v4.battle_content_hash_v3 != self.guest_game_v4.battle_content_hash_v3
            || self.host_game_v4.semantic_catalog_hash != self.guest_game_v4.semantic_catalog_hash
        {
            return Err(PairSnapshotV5Error::ContentIdentityMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum PairSnapshotV5Error {
    #[error("pair snapshot V5 schema must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("base pair snapshot V4 is invalid: {0}")]
    Base(#[source] PairSnapshotV4Error),
    #[error("host GameStateV4 is invalid: {0}")]
    HostGame(#[source] er_state::migration_v4::MigrationV4Error),
    #[error("guest GameStateV4 is invalid: {0}")]
    GuestGame(#[source] er_state::migration_v4::MigrationV4Error),
    #[error("V4 endpoint state does not match the V4 pair frontier")]
    StateFrontierMismatch,
    #[error("host and guest prepared-content identities differ")]
    ContentIdentityMismatch,
}
