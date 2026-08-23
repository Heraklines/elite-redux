use er_state::migration_v3::GameStateV3;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot_v3::RestorablePairSnapshotV3;

pub const RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V4: u32 = 4;
pub const PAIR_DETERMINISM_DIGEST_SCHEMA_VERSION_V3: u32 = 3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorablePairSnapshotV4 {
    pub schema_version: u32,
    pub base: RestorablePairSnapshotV3,
    pub host_game_v3: GameStateV3,
    pub guest_game_v3: GameStateV3,
}

impl RestorablePairSnapshotV4 {
    pub fn validate(&self) -> Result<(), PairSnapshotV4Error> {
        if self.schema_version != RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V4 {
            return Err(PairSnapshotV4Error::SchemaVersion {
                expected: RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION_V4,
                actual: self.schema_version,
            });
        }
        self.base
            .validate()
            .map_err(|error| PairSnapshotV4Error::Base(error.to_string()))?;
        self.host_game_v3.validate()?;
        self.guest_game_v3.validate()?;
        if self.host_game_v3.base != self.base.host.game.state
            || self.guest_game_v3.base != self.base.guest.game.state
        {
            return Err(PairSnapshotV4Error::StateFrontierMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum PairSnapshotV4Error {
    #[error("pair snapshot V4 schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("base pair snapshot V3 is invalid: {0}")]
    Base(String),
    #[error("V3 game state is invalid: {0}")]
    Game(#[from] er_state::migration_v3::MigrationV3Error),
    #[error("V3 endpoint state does not match the base pair frontier")]
    StateFrontierMismatch,
}
