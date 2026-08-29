//! M3A-08 owns canonical mechanical snapshots.

use er_canonical::{CanonicalError, canonical_bytes};
use er_rng::phaser::RunRngState;
use er_types::battle_ids::{BattleId, ContentPackHash, GameModeId, WaveIndex};
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::battle::BattleState;
use crate::validation::{StateValidationError, validate_game_state};

pub const GAME_STATE_SCHEMA_VERSION: u32 = 1;

/// Complete canonical mechanical state for the supported M3 run slice.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GameState {
    pub schema_version: u32,
    pub content_hash: ContentPackHash,
    pub mode: GameModeId,
    pub wave: WaveIndex,
    pub next_battle_id: BattleId,
    pub run_rng: RunRngState,
    pub battle: Option<BattleState>,
}

impl GameState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        content_hash: ContentPackHash,
        mode: GameModeId,
        wave: WaveIndex,
        next_battle_id: BattleId,
        run_rng: RunRngState,
        battle: Option<BattleState>,
    ) -> Result<Self, StateValidationError> {
        let state = Self {
            schema_version: GAME_STATE_SCHEMA_VERSION,
            content_hash,
            mode,
            wave,
            next_battle_id,
            run_rng,
            battle,
        };
        validate_game_state(&state)?;
        Ok(state)
    }

    pub fn validate(&self) -> Result<(), StateValidationError> {
        validate_game_state(self)
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, SnapshotError> {
        canonical_game_state_bytes(self)
    }
}

impl<'de> Deserialize<'de> for GameState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct GameStateWire {
            schema_version: u32,
            content_hash: ContentPackHash,
            mode: GameModeId,
            wave: WaveIndex,
            next_battle_id: BattleId,
            run_rng: RunRngState,
            battle: Option<BattleState>,
        }

        let wire = GameStateWire::deserialize(deserializer)?;
        let state = Self {
            schema_version: wire.schema_version,
            content_hash: wire.content_hash,
            mode: wire.mode,
            wave: wire.wave,
            next_battle_id: wire.next_battle_id,
            run_rng: wire.run_rng,
            battle: wire.battle,
        };
        validate_game_state(&state).map_err(serde::de::Error::custom)?;
        Ok(state)
    }
}

#[derive(Debug, Error)]
pub enum SnapshotError {
    #[error("mechanical state is invalid: {0}")]
    Validation(#[from] StateValidationError),
    #[error("canonical encoding failed: {0}")]
    Canonical(#[from] CanonicalError),
    #[error("snapshot JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("snapshot bytes are valid JSON but are not the canonical GameState encoding")]
    NonCanonicalEncoding,
}

/// Validate and encode the complete mechanical state with canonical key order.
pub fn canonical_game_state_bytes(state: &GameState) -> Result<Vec<u8>, SnapshotError> {
    validate_game_state(state)?;
    Ok(canonical_bytes(state)?)
}

/// Decode only exact canonical GameState bytes; no defaults or repair are used.
pub fn decode_canonical_game_state(bytes: &[u8]) -> Result<GameState, SnapshotError> {
    let state: GameState = serde_json::from_slice(bytes)?;
    let canonical = canonical_game_state_bytes(&state)?;
    if canonical == bytes {
        Ok(state)
    } else {
        Err(SnapshotError::NonCanonicalEncoding)
    }
}
