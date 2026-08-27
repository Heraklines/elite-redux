//! Atomic EXP, move, evolution, fusion, form, and ability transitions.

use er_content::pack::m6_prepared::PreparedBattleContentV3;
use er_content::species::SpeciesBaseStats;
use er_state::m7_state::{
    FusionOriginV1, FusionStateV1, GameStateV5, PokemonStateV5, StoredPokemonV1,
};
use er_types::battle_ids::{MoveId, MoveSlotIndex, PokemonId};
use er_types::battle_model::{AbilityLoadout, BattleStat, BattleStats, MoveSlotState};
use er_types::run_ids::Experience;
use er_types::{EvolutionId, InventoryItemId, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{EvolutionConditionV1, EvolutionDefinitionV1, PreparedProgressionContentV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ProgressionMutationV1 {
    ExperienceChanged {
        pokemon: PokemonId,
        before: Experience,
        after: Experience,
    },
    LevelChanged {
        pokemon: PokemonId,
        before: u16,
        after: u16,
    },
    FriendshipChanged {
        pokemon: PokemonId,
        before: u16,
        after: u16,
    },
    MoveChanged {
        pokemon: PokemonId,
        slot: MoveSlotIndex,
        before: Option<MoveId>,
        after: Option<MoveId>,
    },
    EvolutionCompleted {
        pokemon: PokemonId,
        evolution: EvolutionId,
    },
    FusionChanged {
        pokemon: PokemonId,
        fused: bool,
    },
    FormChanged {
        pokemon: PokemonId,
        before: u16,
        after: u16,
    },
    AbilityChanged {
        pokemon: PokemonId,
        before: AbilityLoadout,
        after: AbilityLoadout,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionTransitionV1 {
    pub after_state: GameStateV5,
    pub mutations: Vec<ProgressionMutationV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LearnMoveResultV1 {
    Learned(MoveSlotIndex),
    NeedsReplacement,
    AlreadyKnown,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProgressionError {
    #[error("game state is invalid: {0}")]
    State(String),
    #[error("Pokémon is absent from the persistent party/storage graph")]
    Pokemon,
    #[error("progression or battle content is absent")]
    Content,
    #[error("experience/stat calculation overflowed")]
    Overflow,
    #[error("move is not learnable, remindable, or valid for the selected slot")]
    Move,
    #[error("evolution is ineligible or references invalid content")]
    Evolution,
    #[error("fusion, form, or ability change is invalid")]
    FormAbility,
}

pub fn grant_experience(
    before: &GameStateV5,
    progression: &PreparedProgressionContentV1,
    battle: &PreparedBattleContentV3,
    pokemon_id: PokemonId,
    amount: Experience,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    before
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    let mut after = before.clone();
    let pokemon = persistent_pokemon_mut(&mut after, pokemon_id)?;
    let definition = progression
        .species(pokemon.species_id, pokemon.form_index)
        .ok_or(ProgressionError::Content)?;
    let growth = progression
        .growth_rate(definition.growth_rate)
        .ok_or(ProgressionError::Content)?;
    let before_experience = pokemon.experience;
    let next_experience = pokemon
        .experience
        .get()
        .get()
        .checked_add(amount.get().get())
        .and_then(|value| SafeU53::new(value).ok())
        .map(Experience::new)
        .ok_or(ProgressionError::Overflow)?;
    let before_level = pokemon.level;
    pokemon.experience = next_experience;
    pokemon.level = level_for_experience(&growth.experience_by_level, next_experience)?;
    if pokemon.level != before_level {
        recalculate_stats(pokemon, progression, battle)?;
    }
    let mut mutations = vec![ProgressionMutationV1::ExperienceChanged {
        pokemon: pokemon_id,
        before: before_experience,
        after: next_experience,
    }];
    if pokemon.level != before_level {
        mutations.push(ProgressionMutationV1::LevelChanged {
            pokemon: pokemon_id,
            before: before_level,
            after: pokemon.level,
        });
    }
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations,
    })
}

pub fn change_friendship(
    before: &GameStateV5,
    pokemon_id: PokemonId,
    delta: i32,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    let mut after = before.clone();
    let pokemon = persistent_pokemon_mut(&mut after, pokemon_id)?;
    let previous = pokemon.friendship;
    let next = i32::from(previous)
        .checked_add(delta)
        .ok_or(ProgressionError::Overflow)?
        .clamp(0, i32::from(u16::MAX));
    pokemon.friendship = u16::try_from(next).map_err(|_| ProgressionError::Overflow)?;
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations: vec![ProgressionMutationV1::FriendshipChanged {
            pokemon: pokemon_id,
            before: previous,
            after: u16::try_from(next).map_err(|_| ProgressionError::Overflow)?,
        }],
    })
}

pub fn learn_level_move(
    before: &GameStateV5,
    progression: &PreparedProgressionContentV1,
    pokemon_id: PokemonId,
    move_id: MoveId,
) -> Result<(GameStateV5, LearnMoveResultV1), ProgressionError> {
    let mut after = before.clone();
    let pokemon = persistent_pokemon_mut(&mut after, pokemon_id)?;
    let definition = progression
        .species(pokemon.species_id, pokemon.form_index)
        .ok_or(ProgressionError::Content)?;
    if !definition
        .level_moves
        .iter()
        .any(|entry| entry.move_id == move_id && entry.level <= pokemon.level)
    {
        return Err(ProgressionError::Move);
    }
    if pokemon
        .moves
        .iter()
        .flatten()
        .any(|slot| slot.move_id == move_id)
    {
        return Ok((after, LearnMoveResultV1::AlreadyKnown));
    }
    let Some(index) = pokemon.moves.iter().position(Option::is_none) else {
        return Ok((after, LearnMoveResultV1::NeedsReplacement));
    };
    let slot = MoveSlotIndex::new(u8::try_from(index).map_err(|_| ProgressionError::Move)?)
        .map_err(|_| ProgressionError::Move)?;
    pokemon.moves[index] = Some(MoveSlotState {
        move_id,
        pp_used: 0,
        pp_ups: 0,
        max_pp_override: None,
    });
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok((after, LearnMoveResultV1::Learned(slot)))
}

pub fn replace_move(
    before: &GameStateV5,
    pokemon_id: PokemonId,
    slot: MoveSlotIndex,
    move_id: MoveId,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    let mut after = before.clone();
    let pokemon = persistent_pokemon_mut(&mut after, pokemon_id)?;
    if pokemon
        .moves
        .iter()
        .flatten()
        .any(|entry| entry.move_id == move_id)
    {
        return Err(ProgressionError::Move);
    }
    let index = usize::from(slot.get());
    let previous = pokemon.moves[index].map(|entry| entry.move_id);
    pokemon.moves[index] = Some(MoveSlotState {
        move_id,
        pp_used: 0,
        pp_ups: 0,
        max_pp_override: None,
    });
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations: vec![ProgressionMutationV1::MoveChanged {
            pokemon: pokemon_id,
            slot,
            before: previous,
            after: Some(move_id),
        }],
    })
}

pub fn remind_move(
    before: &GameStateV5,
    progression: &PreparedProgressionContentV1,
    pokemon_id: PokemonId,
    move_id: MoveId,
    slot: MoveSlotIndex,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    let pokemon = persistent_pokemon(before, pokemon_id)?;
    let definition = progression
        .species(pokemon.species_id, pokemon.form_index)
        .ok_or(ProgressionError::Content)?;
    if definition.reminder_moves.binary_search(&move_id).is_err() {
        return Err(ProgressionError::Move);
    }
    replace_move(before, pokemon_id, slot, move_id)
}

pub fn complete_evolution(
    before: &GameStateV5,
    progression: &PreparedProgressionContentV1,
    battle: &PreparedBattleContentV3,
    pokemon_id: PokemonId,
    evolution_id: EvolutionId,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    let evolution = progression
        .evolution(evolution_id)
        .ok_or(ProgressionError::Evolution)?;
    let pokemon = persistent_pokemon(before, pokemon_id)?;
    if pokemon.pause_evolutions
        || pokemon.species_id != evolution.source_species
        || pokemon.form_index != evolution.source_form
        || !evolution_eligible(before, pokemon, evolution)
    {
        return Err(ProgressionError::Evolution);
    }
    let mut after = before.clone();
    if let Some(item) = evolution.consume_item {
        consume_inventory(&mut after, item)?;
    }
    let pokemon = persistent_pokemon_mut(&mut after, pokemon_id)?;
    pokemon.species_id = evolution.target_species;
    pokemon.form_index = evolution.target_form;
    pokemon.evolution.last_completed = Some(evolution_id);
    apply_species_form(pokemon, battle)?;
    recalculate_stats(pokemon, progression, battle)?;
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations: vec![ProgressionMutationV1::EvolutionCompleted {
            pokemon: pokemon_id,
            evolution: evolution_id,
        }],
    })
}

pub fn fuse_pokemon(
    before: &GameStateV5,
    primary: PokemonId,
    partner: PokemonId,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    if primary == partner {
        return Err(ProgressionError::FormAbility);
    }
    let partner_state = persistent_pokemon(before, partner)?.clone();
    let origin = fusion_origin(before, partner)?;
    let mut after = before.clone();
    let primary_state = persistent_pokemon_mut(&mut after, primary)?;
    if primary_state.fusion.is_some() {
        return Err(ProgressionError::FormAbility);
    }
    primary_state.fusion = Some(FusionStateV1 {
        partner: Box::new(partner_state),
        origin,
    });
    remove_persistent_pokemon(&mut after, partner)?;
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations: vec![ProgressionMutationV1::FusionChanged {
            pokemon: primary,
            fused: true,
        }],
    })
}

pub fn unfuse_pokemon(
    before: &GameStateV5,
    pokemon_id: PokemonId,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    let mut after = before.clone();
    let fusion = persistent_pokemon_mut(&mut after, pokemon_id)?
        .fusion
        .take()
        .ok_or(ProgressionError::FormAbility)?;
    let run = after.active_run.as_mut().ok_or(ProgressionError::Pokemon)?;
    match fusion.origin {
        FusionOriginV1::Party { index } => {
            let index = usize::from(index);
            if run.party.len() >= crate::lifecycle::PARTY_CAPACITY || index > run.party.len() {
                return Err(ProgressionError::FormAbility);
            }
            run.party.insert(index, *fusion.partner);
        }
        FusionOriginV1::Storage { slot } => {
            if run.storage.iter().any(|stored| stored.slot == slot) {
                return Err(ProgressionError::FormAbility);
            }
            run.storage.push(StoredPokemonV1 {
                slot,
                pokemon: *fusion.partner,
            });
            run.storage.sort_by_key(|stored| stored.slot);
        }
    }
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations: vec![ProgressionMutationV1::FusionChanged {
            pokemon: pokemon_id,
            fused: false,
        }],
    })
}

pub fn change_persistent_form(
    before: &GameStateV5,
    progression: &PreparedProgressionContentV1,
    battle: &PreparedBattleContentV3,
    pokemon_id: PokemonId,
    form: u16,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    if progression
        .species(persistent_pokemon(before, pokemon_id)?.species_id, form)
        .is_none()
    {
        return Err(ProgressionError::FormAbility);
    }
    let mut after = before.clone();
    let pokemon = persistent_pokemon_mut(&mut after, pokemon_id)?;
    let previous = pokemon.form_index;
    pokemon.form_index = form;
    apply_species_form(pokemon, battle)?;
    recalculate_stats(pokemon, progression, battle)?;
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations: vec![ProgressionMutationV1::FormChanged {
            pokemon: pokemon_id,
            before: previous,
            after: form,
        }],
    })
}

pub fn change_ability_loadout(
    before: &GameStateV5,
    pokemon_id: PokemonId,
    loadout: AbilityLoadout,
) -> Result<ProgressionTransitionV1, ProgressionError> {
    er_state::pokemon::validate_ability_loadout(&loadout)
        .map_err(|_| ProgressionError::FormAbility)?;
    let mut after = before.clone();
    let pokemon = persistent_pokemon_mut(&mut after, pokemon_id)?;
    let previous = pokemon.abilities;
    pokemon.abilities = loadout;
    after
        .validate()
        .map_err(|error| ProgressionError::State(error.to_string()))?;
    Ok(ProgressionTransitionV1 {
        after_state: after,
        mutations: vec![ProgressionMutationV1::AbilityChanged {
            pokemon: pokemon_id,
            before: previous,
            after: loadout,
        }],
    })
}

fn level_for_experience(
    thresholds: &[Experience],
    experience: Experience,
) -> Result<u16, ProgressionError> {
    let level = thresholds.partition_point(|threshold| *threshold <= experience);
    let level = if level <= 1 { 1 } else { level - 1 };
    u16::try_from(level).map_err(|_| ProgressionError::Overflow)
}

fn recalculate_stats(
    pokemon: &mut PokemonStateV5,
    progression: &PreparedProgressionContentV1,
    battle: &PreparedBattleContentV3,
) -> Result<(), ProgressionError> {
    let species = battle
        .species(pokemon.species_id)
        .map_err(|_| ProgressionError::Content)?;
    let base = species.base_stats;
    let nature = progression
        .nature(pokemon.effective_nature)
        .ok_or(ProgressionError::Content)?;
    let previous_max = pokemon.max_hp;
    let stats = calculate_stats(pokemon, base, nature)?;
    pokemon.stats = stats;
    pokemon.max_hp = stats.hp;
    if !pokemon.fainted {
        let gained = if pokemon.max_hp > previous_max {
            pokemon.max_hp - previous_max
        } else {
            0
        };
        pokemon.hp = pokemon
            .hp
            .checked_add(gained)
            .ok_or(ProgressionError::Overflow)?
            .min(pokemon.max_hp);
    }
    Ok(())
}

fn calculate_stats(
    pokemon: &PokemonStateV5,
    base: SpeciesBaseStats,
    nature: &crate::NatureDefinitionV1,
) -> Result<BattleStats, ProgressionError> {
    let level = u64::from(pokemon.level);
    let hp = hp_stat(
        base.hp,
        pokemon.ivs[0].get(),
        pokemon.permanent_bonuses.hp,
        level,
    )?;
    Ok(BattleStats {
        hp,
        attack: other_stat(
            base.attack,
            pokemon.ivs[1].get(),
            pokemon.permanent_bonuses.attack,
            level,
            BattleStat::Attack,
            nature,
        )?,
        defense: other_stat(
            base.defense,
            pokemon.ivs[2].get(),
            pokemon.permanent_bonuses.defense,
            level,
            BattleStat::Defense,
            nature,
        )?,
        special_attack: other_stat(
            base.special_attack,
            pokemon.ivs[3].get(),
            pokemon.permanent_bonuses.special_attack,
            level,
            BattleStat::SpecialAttack,
            nature,
        )?,
        special_defense: other_stat(
            base.special_defense,
            pokemon.ivs[4].get(),
            pokemon.permanent_bonuses.special_defense,
            level,
            BattleStat::SpecialDefense,
            nature,
        )?,
        speed: other_stat(
            base.speed,
            pokemon.ivs[5].get(),
            pokemon.permanent_bonuses.speed,
            level,
            BattleStat::Speed,
            nature,
        )?,
    })
}

fn hp_stat(base: u32, iv: u8, bonus: u32, level: u64) -> Result<u32, ProgressionError> {
    let value = u64::from(base)
        .checked_mul(2)
        .and_then(|value| value.checked_add(u64::from(iv)))
        .and_then(|value| value.checked_add(u64::from(bonus)))
        .and_then(|value| value.checked_mul(level))
        .and_then(|value| value.checked_div(100))
        .and_then(|value| value.checked_add(level))
        .and_then(|value| value.checked_add(10))
        .ok_or(ProgressionError::Overflow)?;
    u32::try_from(value).map_err(|_| ProgressionError::Overflow)
}

fn other_stat(
    base: u32,
    iv: u8,
    bonus: u32,
    level: u64,
    stat: BattleStat,
    nature: &crate::NatureDefinitionV1,
) -> Result<u32, ProgressionError> {
    let mut value = u64::from(base)
        .checked_mul(2)
        .and_then(|value| value.checked_add(u64::from(iv)))
        .and_then(|value| value.checked_add(u64::from(bonus)))
        .and_then(|value| value.checked_mul(level))
        .and_then(|value| value.checked_div(100))
        .and_then(|value| value.checked_add(5))
        .ok_or(ProgressionError::Overflow)?;
    if nature.increased_stat == Some(stat) {
        value = value
            .checked_mul(110)
            .and_then(|value| value.checked_div(100))
            .ok_or(ProgressionError::Overflow)?;
    } else if nature.decreased_stat == Some(stat) {
        value = value
            .checked_mul(90)
            .and_then(|value| value.checked_div(100))
            .ok_or(ProgressionError::Overflow)?;
    }
    u32::try_from(value).map_err(|_| ProgressionError::Overflow)
}

fn apply_species_form(
    pokemon: &mut PokemonStateV5,
    battle: &PreparedBattleContentV3,
) -> Result<(), ProgressionError> {
    let species = battle
        .species(pokemon.species_id)
        .map_err(|_| ProgressionError::Content)?;
    pokemon.types = species.typing;
    pokemon.abilities = AbilityLoadout {
        active: species.ability_slots.active,
        passives: species.ability_slots.passives,
        active_suppressed: false,
        passive_suppressed: [false; 3],
    };
    Ok(())
}

fn evolution_eligible(
    state: &GameStateV5,
    pokemon: &PokemonStateV5,
    evolution: &EvolutionDefinitionV1,
) -> bool {
    evolution
        .conditions
        .iter()
        .all(|condition| condition_satisfied(state, pokemon, condition))
}

fn condition_satisfied(
    state: &GameStateV5,
    pokemon: &PokemonStateV5,
    condition: &EvolutionConditionV1,
) -> bool {
    let Some(run) = state.active_run.as_ref() else {
        return false;
    };
    match condition {
        EvolutionConditionV1::Level(level) => pokemon.level >= *level,
        EvolutionConditionV1::Item(item) => run
            .inventory
            .entries
            .iter()
            .any(|entry| entry.item == *item && entry.count > 0),
        EvolutionConditionV1::Friendship(friendship) => pokemon.friendship >= *friendship,
        EvolutionConditionV1::KnowsMove(move_id) => pokemon
            .moves
            .iter()
            .flatten()
            .any(|slot| slot.move_id == *move_id),
        EvolutionConditionV1::Biome(biome) => run.world.biome == *biome,
        EvolutionConditionV1::Mode(mode) => run.mode == *mode,
        EvolutionConditionV1::Compound(conditions) => conditions
            .iter()
            .all(|condition| condition_satisfied(state, pokemon, condition)),
    }
}

fn consume_inventory(
    state: &mut GameStateV5,
    item: InventoryItemId,
) -> Result<(), ProgressionError> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(ProgressionError::Evolution)?;
    let index = run
        .inventory
        .entries
        .iter()
        .position(|entry| entry.item == item && entry.count > 0)
        .ok_or(ProgressionError::Evolution)?;
    if run.inventory.entries[index].count == 1 {
        run.inventory.entries.remove(index);
    } else {
        run.inventory.entries[index].count -= 1;
    }
    Ok(())
}

fn fusion_origin(state: &GameStateV5, id: PokemonId) -> Result<FusionOriginV1, ProgressionError> {
    let run = state.active_run.as_ref().ok_or(ProgressionError::Pokemon)?;
    if let Some(index) = run.party.iter().position(|pokemon| pokemon.id == id) {
        return Ok(FusionOriginV1::Party {
            index: u8::try_from(index).map_err(|_| ProgressionError::Overflow)?,
        });
    }
    run.storage
        .iter()
        .find(|stored| stored.pokemon.id == id)
        .map(|stored| FusionOriginV1::Storage { slot: stored.slot })
        .ok_or(ProgressionError::Pokemon)
}

fn persistent_pokemon(
    state: &GameStateV5,
    id: PokemonId,
) -> Result<&PokemonStateV5, ProgressionError> {
    let run = state.active_run.as_ref().ok_or(ProgressionError::Pokemon)?;
    run.party
        .iter()
        .find(|pokemon| pokemon.id == id)
        .or_else(|| {
            run.storage
                .iter()
                .find(|stored| stored.pokemon.id == id)
                .map(|stored| &stored.pokemon)
        })
        .ok_or(ProgressionError::Pokemon)
}

fn persistent_pokemon_mut(
    state: &mut GameStateV5,
    id: PokemonId,
) -> Result<&mut PokemonStateV5, ProgressionError> {
    let run = state.active_run.as_mut().ok_or(ProgressionError::Pokemon)?;
    if let Some(index) = run.party.iter().position(|pokemon| pokemon.id == id) {
        return run.party.get_mut(index).ok_or(ProgressionError::Pokemon);
    }
    run.storage
        .iter_mut()
        .find(|stored| stored.pokemon.id == id)
        .map(|stored| &mut stored.pokemon)
        .ok_or(ProgressionError::Pokemon)
}

fn remove_persistent_pokemon(
    state: &mut GameStateV5,
    id: PokemonId,
) -> Result<(), ProgressionError> {
    let run = state.active_run.as_mut().ok_or(ProgressionError::Pokemon)?;
    if let Some(index) = run.party.iter().position(|pokemon| pokemon.id == id) {
        run.party.remove(index);
        return Ok(());
    }
    let index = run
        .storage
        .iter()
        .position(|stored| stored.pokemon.id == id)
        .ok_or(ProgressionError::Pokemon)?;
    run.storage.remove(index);
    Ok(())
}
