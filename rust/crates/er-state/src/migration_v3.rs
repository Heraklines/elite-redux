use std::collections::BTreeSet;

use er_types::battle_ids::{BattleId, PokemonId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::game_v2::GameStateV2;
use crate::mechanic_state::{HeldItemStateV1, MechanicStateError, MechanicStateStoreV1};

pub const GAME_STATE_SCHEMA_VERSION_V3: u32 = 3;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonMechanicExtensionV3 {
    pub pokemon_id: PokemonId,
    pub held_items: Vec<HeldItemStateV1>,
    pub mechanics: MechanicStateStoreV1,
}

impl PokemonMechanicExtensionV3 {
    fn validate(&self) -> Result<(), MigrationV3Error> {
        let mut previous = None;
        for item in &self.held_items {
            item.validate().map_err(MigrationV3Error::MechanicState)?;
            if previous.is_some_and(|key: &str| item.registry_key.as_str() <= key) {
                return Err(MigrationV3Error::HeldItemsOutOfOrder {
                    pokemon: self.pokemon_id,
                });
            }
            previous = Some(item.registry_key.as_str());
        }
        self.mechanics
            .validate()
            .map_err(MigrationV3Error::MechanicState)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleMechanicExtensionV3 {
    pub battle_id: BattleId,
    pub mechanics: MechanicStateStoreV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameStateV3 {
    pub schema_version: u32,
    pub battle_content_hash_v2: String,
    pub base: GameStateV2,
    pub pokemon_extensions: Vec<PokemonMechanicExtensionV3>,
    pub battle_extension: Option<BattleMechanicExtensionV3>,
}

impl GameStateV3 {
    pub fn validate(&self) -> Result<(), MigrationV3Error> {
        if self.schema_version != GAME_STATE_SCHEMA_VERSION_V3 {
            return Err(MigrationV3Error::SchemaVersion {
                expected: GAME_STATE_SCHEMA_VERSION_V3,
                actual: self.schema_version,
            });
        }
        self.base
            .validate()
            .map_err(|error| MigrationV3Error::InvalidV2(error.to_string()))?;
        validate_content_hash(&self.battle_content_hash_v2)?;

        let expected = pokemon_ids(&self.base);
        let mut actual = BTreeSet::new();
        let mut previous = None;
        for extension in &self.pokemon_extensions {
            extension.validate()?;
            if previous.is_some_and(|id| extension.pokemon_id <= id) {
                return Err(MigrationV3Error::PokemonExtensionsOutOfOrder);
            }
            if !actual.insert(extension.pokemon_id) {
                return Err(MigrationV3Error::DuplicatePokemonExtension {
                    pokemon: extension.pokemon_id,
                });
            }
            previous = Some(extension.pokemon_id);
        }
        if expected != actual {
            return Err(MigrationV3Error::PokemonExtensionClosure {
                expected: expected.len(),
                actual: actual.len(),
            });
        }
        match (&self.base.battle, &self.battle_extension) {
            (None, None) => {}
            (Some(battle), Some(extension)) if battle.battle_id == extension.battle_id => {
                extension
                    .mechanics
                    .validate()
                    .map_err(MigrationV3Error::MechanicState)?;
            }
            _ => return Err(MigrationV3Error::BattleExtensionMismatch),
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MigrationEvidenceV3 {
    pub source_schema_version: u32,
    pub target_schema_version: u32,
    pub migrated_pokemon: usize,
    pub active_battle: bool,
    pub rng_draws: u32,
}

pub fn migrate_game_v2_to_v3(
    state: &GameStateV2,
    battle_content_hash_v2: String,
) -> Result<(GameStateV3, MigrationEvidenceV3), MigrationV3Error> {
    state
        .validate()
        .map_err(|error| MigrationV3Error::InvalidV2(error.to_string()))?;
    validate_content_hash(&battle_content_hash_v2)?;
    let ids = pokemon_ids(state);
    let pokemon_extensions = ids
        .iter()
        .copied()
        .map(|pokemon_id| PokemonMechanicExtensionV3 {
            pokemon_id,
            held_items: Vec::new(),
            mechanics: MechanicStateStoreV1::default(),
        })
        .collect();
    let battle_extension = state
        .battle
        .as_ref()
        .map(|battle| BattleMechanicExtensionV3 {
            battle_id: battle.battle_id,
            mechanics: MechanicStateStoreV1::default(),
        });
    let migrated = GameStateV3 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V3,
        battle_content_hash_v2,
        base: state.clone(),
        pokemon_extensions,
        battle_extension,
    };
    migrated.validate()?;
    let evidence = MigrationEvidenceV3 {
        source_schema_version: state.schema_version,
        target_schema_version: GAME_STATE_SCHEMA_VERSION_V3,
        migrated_pokemon: ids.len(),
        active_battle: state.battle.is_some(),
        rng_draws: 0,
    };
    Ok((migrated, evidence))
}

fn pokemon_ids(state: &GameStateV2) -> BTreeSet<PokemonId> {
    let mut ids: BTreeSet<PokemonId> = state
        .player_party
        .iter()
        .map(|pokemon| pokemon.id)
        .collect();
    if let Some(battle) = &state.battle {
        ids.extend(battle.enemy_party.iter().map(|pokemon| pokemon.id));
    }
    ids
}

fn validate_content_hash(value: &str) -> Result<(), MigrationV3Error> {
    let Some(digest) = value.strip_prefix("blake3-v1:") else {
        return Err(MigrationV3Error::ContentHash);
    };
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(MigrationV3Error::ContentHash);
    }
    Ok(())
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum MigrationV3Error {
    #[error("GameStateV3 schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("M4 state is invalid: {0}")]
    InvalidV2(String),
    #[error("M5 battle content hash is malformed")]
    ContentHash,
    #[error("held items for Pokemon {pokemon} must be sorted and unique")]
    HeldItemsOutOfOrder { pokemon: PokemonId },
    #[error("Pokemon mechanic extensions must be sorted and unique")]
    PokemonExtensionsOutOfOrder,
    #[error("duplicate Pokemon mechanic extension {pokemon}")]
    DuplicatePokemonExtension { pokemon: PokemonId },
    #[error("Pokemon mechanic extension closure differs: expected {expected}, got {actual}")]
    PokemonExtensionClosure { expected: usize, actual: usize },
    #[error("battle mechanic extension does not match active battle")]
    BattleExtensionMismatch,
    #[error("mechanic state is invalid: {0}")]
    MechanicState(#[source] MechanicStateError),
}
