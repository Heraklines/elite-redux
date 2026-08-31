//! Pure Training Session encounter state transitions from the pinned M7 oracle.
use std::collections::BTreeSet;

use er_state::m7_state::PokemonStateV5;
use er_types::battle_ids::{AbilityId, PokemonId};
use er_types::run_ids::NatureId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const BASE_MYSTERY_ENCOUNTER_SPAWN_WEIGHT_V1: u32 = 10;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TrainingSessionErrorV1 {
    #[error("selected Pokémon is missing, fainted, or still unavailable")]
    Pokemon,
    #[error("training selection is invalid")]
    Selection,
}

pub fn remove_pokemon_for_training_v1(
    party: &mut Vec<PokemonStateV5>,
    field: &mut [Option<PokemonId>],
    pokemon: PokemonId,
) -> Result<PokemonStateV5, TrainingSessionErrorV1> {
    let index = party
        .iter()
        .position(|candidate| candidate.id == pokemon)
        .ok_or(TrainingSessionErrorV1::Pokemon)?;
    for occupant in field {
        if *occupant == Some(pokemon) {
            *occupant = None;
        }
    }
    Ok(party.remove(index))
}

pub fn training_pokemon_selectable_v1(pokemon: &PokemonStateV5) -> bool {
    !pokemon.fainted && pokemon.hp > 0
}

pub fn select_training_pokemon_v1(
    pokemon: &PokemonStateV5,
) -> Result<PokemonId, TrainingSessionErrorV1> {
    training_pokemon_selectable_v1(pokemon)
        .then_some(pokemon.id)
        .ok_or(TrainingSessionErrorV1::Pokemon)
}

pub const fn training_boss_segments_v1(wave: u32, divisor: u32, cap: u8) -> u8 {
    let value = 2 + wave / divisor;
    if value > cap as u32 { cap } else { value as u8 }
}

pub fn non_maxed_iv_indexes_v1(pokemon: &PokemonStateV5) -> Vec<usize> {
    pokemon
        .ivs
        .iter()
        .enumerate()
        .filter_map(|(index, value)| (value.get() < 31).then_some(index))
        .collect()
}

pub fn improve_training_ivs_v1(
    pokemon: &mut PokemonStateV5,
    shuffled_indexes: &[usize],
) -> Result<Vec<usize>, TrainingSessionErrorV1> {
    let mut improved = Vec::new();
    for index in shuffled_indexes.iter().rev().copied() {
        if improved.len() == 2 {
            break;
        }
        let Some(current) = pokemon.ivs.get(index).map(|value| value.get()) else {
            return Err(TrainingSessionErrorV1::Selection);
        };
        if current >= 31 {
            continue;
        }
        let correction = u8::from(current <= 21 && current % 5 == 1);
        let increment = if current <= 10 {
            10
        } else if current <= 20 {
            5
        } else {
            3
        };
        let next = current
            .checked_add(correction)
            .and_then(|value| value.checked_add(increment))
            .unwrap_or(31)
            .min(31);
        pokemon.ivs[index] =
            er_state::pokemon_v2::Iv::new(next).map_err(|_| TrainingSessionErrorV1::Selection)?;
        improved.push(index);
    }
    Ok(improved)
}

pub fn nature_training_options_v1(natures: &[NatureId]) -> Vec<NatureId> {
    natures.to_vec()
}

pub fn choose_training_nature_v1(pokemon: &mut PokemonStateV5, nature: NatureId) -> NatureId {
    pokemon.effective_nature = nature;
    nature
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrainingAbilityOptionV1 {
    pub ability: AbilityId,
    pub name: String,
    pub description: String,
    pub source_index: u8,
}

pub fn ability_training_options_v1(
    abilities: impl IntoIterator<Item = TrainingAbilityOptionV1>,
) -> Vec<TrainingAbilityOptionV1> {
    let mut names = BTreeSet::new();
    abilities
        .into_iter()
        .filter(|ability| names.insert(ability.name.clone()))
        .collect()
}

pub fn choose_training_ability_v1(
    options: &[TrainingAbilityOptionV1],
    option_index: usize,
) -> Result<u8, TrainingSessionErrorV1> {
    options
        .get(option_index)
        .map(|option| option.source_index)
        .ok_or(TrainingSessionErrorV1::Selection)
}

pub fn training_ability_description_v1(
    options: &[TrainingAbilityOptionV1],
    option_index: usize,
) -> Option<&str> {
    options
        .get(option_index)
        .map(|option| option.description.as_str())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrainingEnemyConfigV1 {
    pub pokemon: PokemonStateV5,
    pub boss_segments: u8,
    pub transferable_items: Vec<(String, u32, bool)>,
}

pub fn training_enemy_config_v1(
    pokemon: &PokemonStateV5,
    boss_segments: u8,
) -> TrainingEnemyConfigV1 {
    TrainingEnemyConfigV1 {
        pokemon: pokemon.clone(),
        boss_segments,
        transferable_items: pokemon
            .held_items
            .iter()
            .map(|item| (item.registry_key.clone(), item.stack_count, false))
            .collect(),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SeenEncounterDataV1 {
    pub encounter_type: u32,
    pub tier: u32,
    pub wave_index: u32,
    pub selected_option: i32,
}

impl SeenEncounterDataV1 {
    pub const fn new(
        encounter_type: u32,
        tier: u32,
        wave_index: u32,
        selected_option: Option<i32>,
    ) -> Self {
        Self {
            encounter_type,
            tier,
            wave_index,
            selected_option: match selected_option {
                Some(value) => value,
                None => -1,
            },
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueuedEncounterV1 {
    pub encounter_type: u32,
    pub spawn_percent: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MysteryEncounterSaveDataV1 {
    pub encountered_events: Vec<SeenEncounterDataV1>,
    pub encounter_spawn_chance: u32,
    pub queued_encounters: Vec<QueuedEncounterV1>,
}

impl MysteryEncounterSaveDataV1 {
    pub fn new(source: Option<Self>) -> Self {
        source.unwrap_or(Self {
            encountered_events: Vec::new(),
            encounter_spawn_chance: BASE_MYSTERY_ENCOUNTER_SPAWN_WEIGHT_V1,
            queued_encounters: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use er_state::m7_state::{EvolutionStateV1, POKEMON_STATE_SCHEMA_VERSION_V5};
    use er_state::mechanic_state_v2::MechanicStateStoreV2;
    use er_state::pokemon::{
        AbilityLoadout, BattleStats, PokemonTyping, StatStages, StatusKind, StatusState,
    };
    use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
    use er_types::SafeU53;
    use er_types::battle_ids::{AbilityId, PokemonId, SpeciesId};
    use er_types::battle_model::PokemonType;
    use er_types::run_ids::{Experience, NatureId};

    use super::*;

    fn pokemon() -> PokemonStateV5 {
        PokemonStateV5 {
            schema_version: POKEMON_STATE_SCHEMA_VERSION_V5,
            id: PokemonId::new(SafeU53::new(1).expect("id")),
            owner_seat: None,
            species_id: SpeciesId::new(SafeU53::new(1).expect("species")),
            form_index: 0,
            gender: None,
            level: 5,
            experience: Experience::new(SafeU53::ZERO),
            types: PokemonTyping {
                primary: PokemonType::Normal,
                secondary: None,
            },
            stats: BattleStats {
                hp: 10,
                attack: 5,
                defense: 5,
                special_attack: 5,
                special_defense: 5,
                speed: 5,
            },
            hp: 10,
            max_hp: 10,
            status: StatusState {
                kind: StatusKind::None,
                toxic_turn_count: 0,
                sleep_turns_remaining: None,
            },
            stat_stages: StatStages {
                attack: 0,
                defense: 0,
                special_attack: 0,
                special_defense: 0,
                speed: 0,
                accuracy: 0,
                evasion: 0,
            },
            moves: [None, None, None, None],
            abilities: AbilityLoadout {
                active: AbilityId::ZERO,
                passives: [None, None, None],
                active_suppressed: false,
                passive_suppressed: [false; 3],
            },
            ivs: [
                Iv::new(1).expect("iv"),
                Iv::new(11).expect("iv"),
                Iv::new(21).expect("iv"),
                Iv::new(31).expect("iv"),
                Iv::new(31).expect("iv"),
                Iv::new(31).expect("iv"),
            ],
            nature: NatureId::new(0),
            effective_nature: NatureId::new(0),
            friendship: 0,
            permanent_bonuses: PermanentStatBonuses {
                hp: 0,
                attack: 0,
                defense: 0,
                special_attack: 0,
                special_defense: 0,
                speed: 0,
            },
            pause_evolutions: false,
            held_items: Vec::new(),
            mechanics: MechanicStateStoreV2::default(),
            fusion: None,
            evolution: EvolutionStateV1 {
                last_completed: None,
                cancelled: Vec::new(),
            },
            tera_type: None,
            shiny: false,
            variant: 0,
            capture: None,
            fainted: false,
        }
    }

    #[test]
    fn training_selection_iv_nature_and_ability_are_deterministic() {
        let mut trainee = pokemon();
        assert!(training_pokemon_selectable_v1(&trainee));
        assert_eq!(non_maxed_iv_indexes_v1(&trainee), vec![0, 1, 2]);
        assert_eq!(
            improve_training_ivs_v1(&mut trainee, &[0, 1, 2]).expect("ivs"),
            vec![2, 1]
        );
        assert_eq!(trainee.ivs[2].get(), 25);
        assert_eq!(trainee.ivs[1].get(), 17);
        assert_eq!(training_boss_segments_v1(100, 50, 5), 4);
        let ability = AbilityId::new(SafeU53::new(1).expect("ability"));
        let options = ability_training_options_v1([
            TrainingAbilityOptionV1 {
                ability,
                name: "One".to_owned(),
                description: "first".to_owned(),
                source_index: 0,
            },
            TrainingAbilityOptionV1 {
                ability,
                name: "One".to_owned(),
                description: "duplicate".to_owned(),
                source_index: 1,
            },
        ]);
        assert_eq!(options.len(), 1);
        assert_eq!(choose_training_ability_v1(&options, 0), Ok(0));
        assert_eq!(training_ability_description_v1(&options, 0), Some("first"));
    }

    #[test]
    fn training_removal_and_mystery_save_constructors_preserve_state() {
        let trainee = pokemon();
        let id = trainee.id;
        let mut party = vec![trainee];
        let mut field = [Some(id), None];
        let removed = remove_pokemon_for_training_v1(&mut party, &mut field, id).expect("remove");
        assert_eq!(removed.id, id);
        assert!(party.is_empty());
        assert_eq!(field, [None, None]);
        assert_eq!(SeenEncounterDataV1::new(2, 3, 4, None).selected_option, -1);
        let save = MysteryEncounterSaveDataV1::new(None);
        assert!(save.encountered_events.is_empty());
        assert_eq!(
            save.encounter_spawn_chance,
            BASE_MYSTERY_ENCOUNTER_SPAWN_WEIGHT_V1
        );
    }
}
