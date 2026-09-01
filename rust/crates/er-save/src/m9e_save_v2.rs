use er_canonical::{canonical_bytes, content_digest};
use er_state::m9e_state_v6::GameStateV6;
use er_types::{GameContentIdentityV2, SafeU53, SaveChecksum};
use serde::{Deserialize, Serialize};
use thiserror::Error;
pub const GAME_SAVE_SCHEMA_VERSION_V2: u32 = 2;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameSaveV2 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentityV2,
    pub generation: SafeU53,
    pub state: GameStateV6,
    pub checksum: SaveChecksum,
}
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameSaveV2Error {
    #[error("save V2 is invalid")]
    Invalid,
    #[error("save V2 canonical encoding failed: {0}")]
    Canonical(String),
}
#[derive(Serialize)]
struct ChecksumView<'a> {
    schema_version: u32,
    content_identity: &'a GameContentIdentityV2,
    generation: SafeU53,
    state: &'a GameStateV6,
}
impl GameSaveV2 {
    pub fn new(
        content_identity: GameContentIdentityV2,
        generation: SafeU53,
        state: GameStateV6,
    ) -> Result<Self, GameSaveV2Error> {
        let checksum = checksum(&ChecksumView {
            schema_version: GAME_SAVE_SCHEMA_VERSION_V2,
            content_identity: &content_identity,
            generation,
            state: &state,
        })?;
        let value = Self {
            schema_version: GAME_SAVE_SCHEMA_VERSION_V2,
            content_identity,
            generation,
            state,
            checksum,
        };
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<(), GameSaveV2Error> {
        if self.schema_version != GAME_SAVE_SCHEMA_VERSION_V2
            || self.generation == SafeU53::ZERO
            || self.state.content_identity != self.content_identity
            || self.checksum
                != checksum(&ChecksumView {
                    schema_version: self.schema_version,
                    content_identity: &self.content_identity,
                    generation: self.generation,
                    state: &self.state,
                })?
        {
            return Err(GameSaveV2Error::Invalid);
        }
        self.state.validate().map_err(|_| GameSaveV2Error::Invalid)
    }
    pub fn encode(&self) -> Result<Vec<u8>, GameSaveV2Error> {
        self.validate()?;
        canonical_bytes(self).map_err(|e| GameSaveV2Error::Canonical(e.to_string()))
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, GameSaveV2Error> {
        let value: Self = serde_json::from_slice(bytes).map_err(|_| GameSaveV2Error::Invalid)?;
        if value.encode()? != bytes {
            return Err(GameSaveV2Error::Invalid);
        }
        Ok(value)
    }
}
fn checksum<T: Serialize>(value: &T) -> Result<SaveChecksum, GameSaveV2Error> {
    content_digest(value)
        .map_err(|e| GameSaveV2Error::Canonical(e.to_string()))
        .and_then(|v| {
            SaveChecksum::parse(format!("sha256-v1:{v}")).map_err(|_| GameSaveV2Error::Invalid)
        })
}
