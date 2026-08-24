//! Explicit, atomic GameStateV3 → GameStateV4 migration.
//!
//! Migration consumes zero RNG and preserves the complete M4 base state,
//! Pokémon ordering, held items, mechanic addresses, instance IDs, counters,
//! payloads, and creation ordinals. Every live V1 mechanic instance requires
//! an explicit old-program/source → new-program/behavior-unit binding.

use std::collections::BTreeSet;

use er_canonical::content_digest;
use er_types::mechanics::{MechanicSourceId, MechanicSourceKind, MechanicsProgramId};
use er_types::{
    BattleContentPackHashV3, BehaviorSourceId, BehaviorUnitId, CatalogHash,
    M6_GAME_STATE_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::game_v2::GameStateV2;
use crate::mechanic_state::{HeldItemStateV1, MechanicInstanceStateV1};
use crate::mechanic_state_v2::{MechanicStateStoreV2, MechanicStateV2Error};
use crate::migration_v3::{GameStateV3, MigrationV3Error};
use er_types::battle_ids::{BattleId, PokemonId};

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstanceMigrationBindingV1 {
    pub source: MechanicSourceId,
    pub old_program_id: MechanicsProgramId,
    pub new_program_id: MechanicsProgramId,
    pub behavior_unit: BehaviorUnitId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M5ToM6MigrationContext {
    pub source_content_hash_v2: String,
    pub target_content_hash_v3: BattleContentPackHashV3,
    pub semantic_catalog_hash: CatalogHash,
    pub bindings: Vec<InstanceMigrationBindingV1>,
    pub target_programs: Vec<MechanicsProgramId>,
    pub target_behavior_units: Vec<BehaviorUnitId>,
    pub held_item_registry_keys: Vec<String>,
}

impl M5ToM6MigrationContext {
    pub fn validate(&self) -> Result<(), MigrationV4Error> {
        validate_v2_content_hash(&self.source_content_hash_v2)?;
        validate_sorted_unique(&self.target_programs)
            .map_err(|_| MigrationV4Error::TargetProgramsNotSortedUnique)?;
        if self.target_programs.contains(&MechanicsProgramId::ZERO) {
            return Err(MigrationV4Error::ZeroTargetProgramId);
        }
        validate_sorted_unique(&self.target_behavior_units)
            .map_err(|_| MigrationV4Error::TargetBehaviorUnitsNotSortedUnique)?;
        for unit in &self.target_behavior_units {
            unit.validate()
                .map_err(|_| MigrationV4Error::InvalidBehaviorUnit)?;
        }
        validate_sorted_unique(&self.held_item_registry_keys)
            .map_err(|_| MigrationV4Error::HeldItemKeysNotSortedUnique)?;
        if self.held_item_registry_keys.iter().any(String::is_empty) {
            return Err(MigrationV4Error::EmptyHeldItemRegistryKey);
        }

        let mut previous = None;
        for binding in &self.bindings {
            binding
                .source
                .validate()
                .map_err(|_| MigrationV4Error::InvalidSource)?;
            if binding.old_program_id == MechanicsProgramId::ZERO
                || binding.new_program_id == MechanicsProgramId::ZERO
            {
                return Err(MigrationV4Error::ZeroBindingProgramId);
            }
            binding
                .behavior_unit
                .validate()
                .map_err(|_| MigrationV4Error::InvalidBehaviorUnit)?;
            if !source_matches_behavior(&binding.source, &binding.behavior_unit.source) {
                return Err(MigrationV4Error::SourceBehaviorMismatch);
            }
            if self
                .target_programs
                .binary_search(&binding.new_program_id)
                .is_err()
            {
                return Err(MigrationV4Error::UnknownTargetProgram {
                    program_id: binding.new_program_id,
                });
            }
            if self
                .target_behavior_units
                .binary_search(&binding.behavior_unit)
                .is_err()
            {
                return Err(MigrationV4Error::UnknownTargetBehaviorUnit);
            }
            let key = (&binding.source, binding.old_program_id);
            if previous.is_some_and(|value| value >= key) {
                return Err(MigrationV4Error::BindingsNotSortedUnique);
            }
            previous = Some(key);
        }
        Ok(())
    }

    fn binding_for(
        &self,
        instance: &MechanicInstanceStateV1,
    ) -> Option<(MechanicsProgramId, BehaviorUnitId)> {
        self.bindings
            .binary_search_by(|binding| {
                (&binding.source, binding.old_program_id)
                    .cmp(&(&instance.address.source, instance.program_id))
            })
            .ok()
            .map(|index| {
                let binding = &self.bindings[index];
                (binding.new_program_id, binding.behavior_unit.clone())
            })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonMechanicExtensionV4 {
    pub pokemon_id: PokemonId,
    pub held_items: Vec<HeldItemStateV1>,
    pub mechanics: MechanicStateStoreV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleMechanicExtensionV4 {
    pub battle_id: BattleId,
    pub mechanics: MechanicStateStoreV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameStateV4 {
    pub schema_version: u32,
    pub battle_content_hash_v3: BattleContentPackHashV3,
    pub semantic_catalog_hash: CatalogHash,
    pub base: GameStateV2,
    pub pokemon_extensions: Vec<PokemonMechanicExtensionV4>,
    pub battle_extension: Option<BattleMechanicExtensionV4>,
}

impl GameStateV4 {
    pub fn validate(&self) -> Result<(), MigrationV4Error> {
        if self.schema_version != M6_GAME_STATE_SCHEMA_VERSION {
            return Err(MigrationV4Error::SchemaVersion {
                expected: M6_GAME_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        self.base
            .validate()
            .map_err(|error| MigrationV4Error::InvalidBase(error.to_string()))?;

        let expected = pokemon_ids(&self.base);
        let mut actual = BTreeSet::new();
        let mut previous = None;
        for extension in &self.pokemon_extensions {
            if previous.is_some_and(|id| extension.pokemon_id <= id) {
                return Err(MigrationV4Error::PokemonExtensionsNotSortedUnique);
            }
            previous = Some(extension.pokemon_id);
            actual.insert(extension.pokemon_id);
            validate_held_items(&extension.held_items, extension.pokemon_id)?;
            extension
                .mechanics
                .validate()
                .map_err(MigrationV4Error::MechanicState)?;
        }
        if expected != actual {
            return Err(MigrationV4Error::PokemonExtensionClosure {
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
                    .map_err(MigrationV4Error::MechanicState)?;
            }
            _ => return Err(MigrationV4Error::BattleExtensionMismatch),
        }
        Ok(())
    }

    pub fn validate_against(
        &self,
        context: &M5ToM6MigrationContext,
    ) -> Result<(), MigrationV4Error> {
        self.validate()?;
        context.validate()?;
        if self.battle_content_hash_v3 != context.target_content_hash_v3
            || self.semantic_catalog_hash != context.semantic_catalog_hash
        {
            return Err(MigrationV4Error::TargetContentIdentityMismatch);
        }
        for extension in &self.pokemon_extensions {
            validate_store_against(&extension.mechanics, context)?;
            for item in &extension.held_items {
                if context
                    .held_item_registry_keys
                    .binary_search(&item.registry_key)
                    .is_err()
                {
                    return Err(MigrationV4Error::UnknownHeldItem {
                        registry_key: item.registry_key.clone(),
                    });
                }
            }
        }
        if let Some(extension) = &self.battle_extension {
            validate_store_against(&extension.mechanics, context)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MigrationEvidenceV4 {
    pub source_schema_version: u32,
    pub target_schema_version: u32,
    pub before_digest: String,
    pub after_digest: String,
    pub migrated_pokemon: usize,
    pub migrated_instances: usize,
    pub active_battle: bool,
    pub rng_draws: u32,
}

pub fn migrate_m5_to_m6(
    input: &GameStateV3,
    context: &M5ToM6MigrationContext,
) -> Result<(GameStateV4, MigrationEvidenceV4), MigrationV4Error> {
    input.validate().map_err(MigrationV4Error::InvalidV3)?;
    context.validate()?;
    if input.battle_content_hash_v2 != context.source_content_hash_v2 {
        return Err(MigrationV4Error::SourceContentIdentityMismatch);
    }

    let before_digest = format!("blake3-v1:{}", content_digest(input)?);
    let pokemon_extensions = input
        .pokemon_extensions
        .iter()
        .map(|extension| {
            let mechanics =
                MechanicStateStoreV2::migrate_from_v1(&extension.mechanics, |instance| {
                    context.binding_for(instance)
                })?;
            Ok(PokemonMechanicExtensionV4 {
                pokemon_id: extension.pokemon_id,
                held_items: extension.held_items.clone(),
                mechanics,
            })
        })
        .collect::<Result<Vec<_>, MechanicStateV2Error>>()?;
    let battle_extension = input
        .battle_extension
        .as_ref()
        .map(
            |extension| -> Result<BattleMechanicExtensionV4, MechanicStateV2Error> {
                Ok(BattleMechanicExtensionV4 {
                    battle_id: extension.battle_id,
                    mechanics: MechanicStateStoreV2::migrate_from_v1(
                        &extension.mechanics,
                        |instance| context.binding_for(instance),
                    )?,
                })
            },
        )
        .transpose()?;

    let migrated = GameStateV4 {
        schema_version: M6_GAME_STATE_SCHEMA_VERSION,
        battle_content_hash_v3: context.target_content_hash_v3.clone(),
        semantic_catalog_hash: context.semantic_catalog_hash.clone(),
        base: input.base.clone(),
        pokemon_extensions,
        battle_extension,
    };
    migrated.validate_against(context)?;
    let after_digest = format!("blake3-v1:{}", content_digest(&migrated)?);
    let migrated_instances = migrated
        .pokemon_extensions
        .iter()
        .map(|extension| extension.mechanics.instances.len())
        .sum::<usize>()
        + migrated
            .battle_extension
            .as_ref()
            .map_or(0, |extension| extension.mechanics.instances.len());
    let evidence = MigrationEvidenceV4 {
        source_schema_version: input.schema_version,
        target_schema_version: migrated.schema_version,
        before_digest,
        after_digest,
        migrated_pokemon: migrated.pokemon_extensions.len(),
        migrated_instances,
        active_battle: migrated.base.battle.is_some(),
        rng_draws: 0,
    };
    Ok((migrated, evidence))
}

fn validate_store_against(
    store: &MechanicStateStoreV2,
    context: &M5ToM6MigrationContext,
) -> Result<(), MigrationV4Error> {
    for instance in &store.instances {
        if context
            .target_programs
            .binary_search(&instance.program_id)
            .is_err()
        {
            return Err(MigrationV4Error::UnknownTargetProgram {
                program_id: instance.program_id,
            });
        }
        if context
            .target_behavior_units
            .binary_search(&instance.source_behavior_unit)
            .is_err()
        {
            return Err(MigrationV4Error::UnknownTargetBehaviorUnit);
        }
    }
    Ok(())
}

fn validate_held_items(
    items: &[HeldItemStateV1],
    pokemon: PokemonId,
) -> Result<(), MigrationV4Error> {
    let mut previous = None;
    for item in items {
        item.validate()
            .map_err(|error| MigrationV4Error::InvalidHeldItem(error.to_string()))?;
        if previous.is_some_and(|key: &str| item.registry_key.as_str() <= key) {
            return Err(MigrationV4Error::HeldItemsNotSortedUnique { pokemon });
        }
        previous = Some(item.registry_key.as_str());
    }
    Ok(())
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

fn validate_v2_content_hash(value: &str) -> Result<(), MigrationV4Error> {
    let Some(body) = value.strip_prefix("blake3-v1:") else {
        return Err(MigrationV4Error::SourceContentHashFormat);
    };
    if body.len() != 64
        || !body
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(MigrationV4Error::SourceContentHashFormat);
    }
    Ok(())
}

fn validate_sorted_unique<T: Ord>(values: &[T]) -> Result<(), ()> {
    if values.windows(2).any(|window| window[0] >= window[1]) {
        Err(())
    } else {
        Ok(())
    }
}

fn source_matches_behavior(source: &MechanicSourceId, behavior: &BehaviorSourceId) -> bool {
    match (
        source.kind,
        source.numeric_id,
        source.registry_key.as_deref(),
        behavior,
    ) {
        (MechanicSourceKind::Move, Some(left), None, BehaviorSourceId::Move { numeric_id })
        | (
            MechanicSourceKind::ActiveAbility,
            Some(left),
            None,
            BehaviorSourceId::ActiveAbility { numeric_id },
        )
        | (
            MechanicSourceKind::PassiveAbility,
            Some(left),
            None,
            BehaviorSourceId::PassiveAbility { numeric_id },
        )
        | (
            MechanicSourceKind::MajorStatus,
            Some(left),
            None,
            BehaviorSourceId::MajorStatus { numeric_id },
        )
        | (
            MechanicSourceKind::Weather,
            Some(left),
            None,
            BehaviorSourceId::Weather { numeric_id },
        )
        | (
            MechanicSourceKind::Terrain,
            Some(left),
            None,
            BehaviorSourceId::Terrain { numeric_id },
        ) => left == *numeric_id,
        (
            MechanicSourceKind::HeldItem,
            None,
            Some(left),
            BehaviorSourceId::HeldItem { registry_key },
        )
        | (
            MechanicSourceKind::VolatileStatus,
            None,
            Some(left),
            BehaviorSourceId::VolatileStatus { registry_key },
        )
        | (
            MechanicSourceKind::SideCondition,
            None,
            Some(left),
            BehaviorSourceId::SideCondition { registry_key },
        )
        | (
            MechanicSourceKind::ArenaTag,
            None,
            Some(left),
            BehaviorSourceId::ArenaTag { registry_key },
        )
        | (
            MechanicSourceKind::BattlerTag,
            None,
            Some(left),
            BehaviorSourceId::BattlerTag { registry_key },
        )
        | (
            MechanicSourceKind::PositionalTag,
            None,
            Some(left),
            BehaviorSourceId::PositionalTag { registry_key },
        )
        | (
            MechanicSourceKind::Bespoke,
            None,
            Some(left),
            BehaviorSourceId::Bespoke { registry_key },
        ) => left == registry_key,
        _ => false,
    }
}

#[derive(Debug, Error)]
pub enum MigrationV4Error {
    #[error("GameStateV4 schema must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("GameStateV3 is invalid: {0}")]
    InvalidV3(#[source] MigrationV3Error),
    #[error("base GameStateV2 is invalid: {0}")]
    InvalidBase(String),
    #[error("canonical migration digest failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("M5 source content hash must be `blake3-v1:` plus 64 lowercase hex characters")]
    SourceContentHashFormat,
    #[error("M5 state content identity does not match the migration context")]
    SourceContentIdentityMismatch,
    #[error("M6 state content identity does not match the migration context")]
    TargetContentIdentityMismatch,
    #[error("migration bindings must be strictly sorted and unique by source/old program")]
    BindingsNotSortedUnique,
    #[error("migration source identity is invalid")]
    InvalidSource,
    #[error("migration binding program IDs must be positive")]
    ZeroBindingProgramId,
    #[error("target program IDs must be positive")]
    ZeroTargetProgramId,
    #[error("target program IDs must be strictly sorted and unique")]
    TargetProgramsNotSortedUnique,
    #[error("target behavior units must be strictly sorted and unique")]
    TargetBehaviorUnitsNotSortedUnique,
    #[error("behavior-unit identity is invalid")]
    InvalidBehaviorUnit,
    #[error("migration source and behavior-unit source differ")]
    SourceBehaviorMismatch,
    #[error("migration binding references unknown target program {program_id}")]
    UnknownTargetProgram { program_id: MechanicsProgramId },
    #[error("migration binding references an unknown target behavior unit")]
    UnknownTargetBehaviorUnit,
    #[error("held-item registry keys must be strictly sorted and unique")]
    HeldItemKeysNotSortedUnique,
    #[error("held-item registry key must not be empty")]
    EmptyHeldItemRegistryKey,
    #[error("held items for Pokémon {pokemon} must be strictly sorted and unique")]
    HeldItemsNotSortedUnique { pokemon: PokemonId },
    #[error("held item is invalid: {0}")]
    InvalidHeldItem(String),
    #[error("held item {registry_key} is absent from M6 content")]
    UnknownHeldItem { registry_key: String },
    #[error("Pokémon mechanic extensions must be strictly sorted and unique")]
    PokemonExtensionsNotSortedUnique,
    #[error("Pokémon extension closure differs: expected {expected}, got {actual}")]
    PokemonExtensionClosure { expected: usize, actual: usize },
    #[error("battle mechanic extension does not match the active battle")]
    BattleExtensionMismatch,
    #[error("mechanic state is invalid: {0}")]
    MechanicState(#[from] MechanicStateV2Error),
}
