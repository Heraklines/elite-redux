use er_types::battle_ids::{BattleId, GameModeId, MoveId, PokemonId, SpeciesId};
use er_types::run_ids::GameRunId;
use er_types::{
    GameContentIdentityV2, HeldItemInstanceId, PlatformRequestId, RunModifierInstanceId, SafeU53,
    ScenarioInstanceId, StorageSlotId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_state::{GameStateV5, PokemonStateV5, ProfileStateV1, RunStateV3};

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

pub trait GameStateV6ContentContext {
    fn identity(&self) -> &GameContentIdentityV2;
    fn has_mode(&self, mode: GameModeId) -> bool;
    fn has_species_form(&self, species: SpeciesId, form: u16) -> bool;
    fn has_move(&self, move_id: MoveId) -> bool;
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameStateV6Error {
    #[error("game state V6 schema or allocator is invalid")]
    Invalid,
    #[error("game state V5 source is invalid: {0}")]
    Source(String),
    #[error("game state V6 content identity or reference is invalid")]
    Content,
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

    pub fn derive(active_run: Option<&RunStateV3>) -> Result<Self, GameStateV6Error> {
        let mut maxima = IdentityMaxima::default();
        if let Some(run) = active_run {
            maxima.run = Some(run.run_id.get());
            maxima.observe_run(run);
        }
        Ok(Self {
            next_run_id: next_after(maxima.run)?,
            next_pokemon_id: next_after(maxima.pokemon)?,
            next_battle_id: next_after(maxima.battle)?,
            next_storage_slot_id: next_after(maxima.storage_slot)?,
            next_modifier_instance_id: next_after(maxima.modifier)?,
            next_scenario_instance_id: next_after(maxima.scenario_instance)?,
            next_platform_request_id: next_after(maxima.platform_request)?,
        })
    }

    pub fn validate_against(
        &self,
        active_run: Option<&RunStateV3>,
    ) -> Result<(), GameStateV6Error> {
        self.validate()?;
        let minimum = Self::derive(active_run)?;
        if self.next_run_id < minimum.next_run_id
            || self.next_pokemon_id < minimum.next_pokemon_id
            || self.next_battle_id < minimum.next_battle_id
            || self.next_storage_slot_id < minimum.next_storage_slot_id
            || self.next_modifier_instance_id < minimum.next_modifier_instance_id
            || self.next_scenario_instance_id < minimum.next_scenario_instance_id
            || self.next_platform_request_id < minimum.next_platform_request_id
        {
            return Err(GameStateV6Error::Invalid);
        }
        Ok(())
    }

    pub fn allocate_run_id(&mut self) -> Result<GameRunId, GameStateV6Error> {
        allocate(&mut self.next_run_id).map(GameRunId::new)
    }

    pub fn allocate_pokemon_id(&mut self) -> Result<PokemonId, GameStateV6Error> {
        allocate(&mut self.next_pokemon_id).map(PokemonId::new)
    }

    pub fn allocate_battle_id(&mut self) -> Result<BattleId, GameStateV6Error> {
        allocate(&mut self.next_battle_id).map(BattleId::new)
    }

    pub fn allocate_storage_slot_id(&mut self) -> Result<StorageSlotId, GameStateV6Error> {
        allocate(&mut self.next_storage_slot_id).map(StorageSlotId::new)
    }

    pub fn allocate_modifier_instance_id(
        &mut self,
    ) -> Result<RunModifierInstanceId, GameStateV6Error> {
        allocate(&mut self.next_modifier_instance_id).map(RunModifierInstanceId::new)
    }

    pub fn allocate_held_item_instance_id(
        &mut self,
    ) -> Result<HeldItemInstanceId, GameStateV6Error> {
        allocate(&mut self.next_modifier_instance_id).map(HeldItemInstanceId::new)
    }

    pub fn allocate_scenario_instance_id(
        &mut self,
    ) -> Result<ScenarioInstanceId, GameStateV6Error> {
        allocate(&mut self.next_scenario_instance_id).map(ScenarioInstanceId::new)
    }

    pub fn allocate_platform_request_id(&mut self) -> Result<PlatformRequestId, GameStateV6Error> {
        allocate(&mut self.next_platform_request_id).map(PlatformRequestId::new)
    }
}

impl GameStateV6 {
    pub fn validate(&self) -> Result<(), GameStateV6Error> {
        if self.schema_version != GAME_STATE_SCHEMA_VERSION_V6 {
            return Err(GameStateV6Error::Invalid);
        }
        self.identities.validate_against(self.active_run.as_ref())?;
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

    pub fn validate_with(
        &self,
        content: &impl GameStateV6ContentContext,
    ) -> Result<(), GameStateV6Error> {
        self.validate()?;
        if &self.content_identity != content.identity() {
            return Err(GameStateV6Error::Content);
        }
        if let Some(run) = &self.active_run {
            if !content.has_mode(run.mode) {
                return Err(GameStateV6Error::Content);
            }
            for pokemon in run
                .party
                .iter()
                .chain(run.storage.iter().map(|stored| &stored.pokemon))
                .chain(run.battle.iter().flat_map(|battle| &battle.enemy_party))
            {
                validate_pokemon_content(pokemon, content)?;
            }
        }
        Ok(())
    }

    pub fn migrate_from_v5(
        source: GameStateV5,
        content_identity: GameContentIdentityV2,
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
        let identities = GameIdentityAllocatorStateV1::derive(source.active_run.as_ref())?;
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

#[derive(Default)]
struct IdentityMaxima {
    run: Option<SafeU53>,
    pokemon: Option<SafeU53>,
    battle: Option<SafeU53>,
    storage_slot: Option<SafeU53>,
    modifier: Option<SafeU53>,
    scenario_instance: Option<SafeU53>,
    platform_request: Option<SafeU53>,
}

impl IdentityMaxima {
    fn observe_run(&mut self, run: &RunStateV3) {
        for pokemon in &run.party {
            self.observe_pokemon(pokemon);
        }
        for stored in &run.storage {
            observe_max(&mut self.storage_slot, stored.slot.get());
            self.observe_pokemon(&stored.pokemon);
        }
        for modifier in &run.modifiers {
            observe_max(&mut self.modifier, modifier.id.get());
        }
        if let Some(battle) = &run.battle {
            observe_max(&mut self.battle, battle.battle_id.get());
            for pokemon in &battle.enemy_party {
                self.observe_pokemon(pokemon);
            }
        }
    }

    fn observe_pokemon(&mut self, pokemon: &PokemonStateV5) {
        observe_max(&mut self.pokemon, pokemon.id.get());
        for item in &pokemon.held_items {
            observe_max(&mut self.modifier, item.instance_id.get());
        }
        if let Some(fusion) = &pokemon.fusion {
            self.observe_pokemon(&fusion.partner);
        }
    }
}

fn validate_pokemon_content(
    pokemon: &PokemonStateV5,
    content: &impl GameStateV6ContentContext,
) -> Result<(), GameStateV6Error> {
    if !content.has_species_form(pokemon.species_id, pokemon.form_index)
        || pokemon
            .moves
            .iter()
            .flatten()
            .any(|move_slot| !content.has_move(move_slot.move_id))
    {
        return Err(GameStateV6Error::Content);
    }
    if let Some(fusion) = &pokemon.fusion {
        validate_pokemon_content(&fusion.partner, content)?;
    }
    Ok(())
}

fn allocate(counter: &mut SafeU53) -> Result<SafeU53, GameStateV6Error> {
    let allocated = *counter;
    let next = allocated
        .get()
        .checked_add(1)
        .ok_or(GameStateV6Error::Exhausted)?;
    let next = SafeU53::new(next).map_err(|_| GameStateV6Error::Exhausted)?;
    *counter = next;
    Ok(allocated)
}

fn next_after(maximum: Option<SafeU53>) -> Result<SafeU53, GameStateV6Error> {
    match maximum {
        None => SafeU53::new(1).map_err(|_| GameStateV6Error::Exhausted),
        Some(value) => {
            let next = value
                .get()
                .checked_add(1)
                .ok_or(GameStateV6Error::Exhausted)?;
            SafeU53::new(next).map_err(|_| GameStateV6Error::Exhausted)
        }
    }
}

fn observe_max(maximum: &mut Option<SafeU53>, candidate: SafeU53) {
    if maximum.is_none_or(|current| candidate > current) {
        *maximum = Some(candidate);
    }
}

#[cfg(test)]
mod tests {
    use er_types::SafeU53;

    use super::{GameIdentityAllocatorStateV1, GameStateV6Error};

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("test value is safe")
    }

    fn allocator(value: SafeU53) -> GameIdentityAllocatorStateV1 {
        GameIdentityAllocatorStateV1 {
            next_run_id: value,
            next_pokemon_id: value,
            next_battle_id: value,
            next_storage_slot_id: value,
            next_modifier_instance_id: value,
            next_scenario_instance_id: value,
            next_platform_request_id: value,
        }
    }

    #[test]
    fn empty_state_derives_one_and_domain_allocations_are_independent() {
        let mut value = GameIdentityAllocatorStateV1::derive(None).expect("empty state derives");
        assert_eq!(value, allocator(safe(1)));
        assert_eq!(
            value.allocate_run_id().expect("run allocates").get(),
            safe(1)
        );
        assert_eq!(
            value
                .allocate_pokemon_id()
                .expect("pokemon allocates")
                .get(),
            safe(1)
        );
        assert_eq!(
            value.allocate_battle_id().expect("battle allocates").get(),
            safe(1)
        );
        assert_eq!(
            value
                .allocate_storage_slot_id()
                .expect("storage slot allocates")
                .get(),
            safe(1)
        );
        assert_eq!(
            value
                .allocate_modifier_instance_id()
                .expect("modifier allocates")
                .get(),
            safe(1)
        );
        assert_eq!(
            value
                .allocate_held_item_instance_id()
                .expect("held item allocates")
                .get(),
            safe(2)
        );
        assert_eq!(
            value
                .allocate_scenario_instance_id()
                .expect("scenario allocates")
                .get(),
            safe(1)
        );
        assert_eq!(
            value
                .allocate_platform_request_id()
                .expect("platform request allocates")
                .get(),
            safe(1)
        );
    }

    #[test]
    fn exhausted_allocation_is_atomic() {
        let mut value = allocator(SafeU53::MAX);
        assert_eq!(
            value.allocate_pokemon_id(),
            Err(GameStateV6Error::Exhausted)
        );
        assert_eq!(value.next_pokemon_id, SafeU53::MAX);
        assert_eq!(value.next_battle_id, SafeU53::MAX);
    }

    #[test]
    fn allocator_validation_rejects_zero_and_below_minimum() {
        let mut zero = allocator(safe(1));
        zero.next_run_id = SafeU53::ZERO;
        assert_eq!(zero.validate(), Err(GameStateV6Error::Invalid));
        assert!(allocator(safe(1)).validate_against(None).is_ok());
    }
}
