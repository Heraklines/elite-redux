use er_types::{GameContentIdentityV2, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_state::{GameStateV5, ProfileStateV1, RunStateV3};

pub const GAME_STATE_SCHEMA_VERSION_V6: u32 = 6;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameIdentityAllocatorStateV1 {
    pub next_run_id: SafeU53,
    pub next_pokemon_id: SafeU53,
    pub next_battle_id: SafeU53,
    pub next_storage_slot_id: SafeU53,
    pub next_modifier_instance_id: SafeU53,
    pub next_scenario_instance_id: SafeU53,
    pub next_platform_request_id: SafeU53,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameStateV6 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentityV2,
    pub identities: GameIdentityAllocatorStateV1,
    pub profile: ProfileStateV1,
    pub active_run: Option<RunStateV3>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameStateV6Error {
    #[error("game state V6 schema or allocator is invalid")]
    Invalid,
    #[error("game state V5 source is invalid: {0}")]
    Source(String),
    #[error("game identity allocator exhausted")]
    Exhausted,
}

impl GameIdentityAllocatorStateV1 {
    pub fn validate(&self) -> Result<(), GameStateV6Error> {
        if [
            self.next_run_id,
            self.next_pokemon_id,
            self.next_battle_id,
            self.next_storage_slot_id,
            self.next_modifier_instance_id,
            self.next_scenario_instance_id,
            self.next_platform_request_id,
        ]
        .contains(&SafeU53::ZERO)
        {
            return Err(GameStateV6Error::Invalid);
        }
        Ok(())
    }

    pub fn allocate(value: &mut SafeU53) -> Result<SafeU53, GameStateV6Error> {
        let allocated = *value;
        *value = SafeU53::new(
            value
                .get()
                .checked_add(1)
                .ok_or(GameStateV6Error::Exhausted)?,
        )
        .map_err(|_| GameStateV6Error::Exhausted)?;
        Ok(allocated)
    }
}

impl GameStateV6 {
    pub fn validate(&self) -> Result<(), GameStateV6Error> {
        if self.schema_version != GAME_STATE_SCHEMA_VERSION_V6 {
            return Err(GameStateV6Error::Invalid);
        }
        self.identities.validate()?;
        let legacy = GameStateV5 {
            schema_version: crate::m7_state::GAME_STATE_SCHEMA_VERSION_V5,
            content_identity: er_types::GameContentIdentity {
                oracle_sha: self.content_identity.oracle_sha.clone(),
                content_hash: self.content_identity.bundle_hash.clone(),
                battle_content_hash: self.content_identity.battle_hash.clone(),
                semantic_catalog_hash: self.content_identity.semantic_catalog_hash.clone(),
            },
            profile: self.profile.clone(),
            active_run: self.active_run.clone(),
        };
        legacy
            .validate()
            .map_err(|error| GameStateV6Error::Source(error.to_string()))
    }

    pub fn migrate_from_v5(
        source: GameStateV5,
        content_identity: GameContentIdentityV2,
        identities: GameIdentityAllocatorStateV1,
    ) -> Result<Self, GameStateV6Error> {
        source
            .validate()
            .map_err(|error| GameStateV6Error::Source(error.to_string()))?;
        if source.content_identity.oracle_sha != content_identity.oracle_sha
            || source.content_identity.battle_content_hash != content_identity.battle_hash
            || source.content_identity.semantic_catalog_hash
                != content_identity.semantic_catalog_hash
        {
            return Err(GameStateV6Error::Invalid);
        }
        let value = Self {
            schema_version: GAME_STATE_SCHEMA_VERSION_V6,
            content_identity,
            identities,
            profile: source.profile,
            active_run: source.active_run,
        };
        value.validate()?;
        Ok(value)
    }
}
