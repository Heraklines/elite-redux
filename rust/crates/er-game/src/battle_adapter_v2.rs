//! Lossless battle-mechanics projection between M4 ownership and the M3
//! resolver's battle-local state.

use er_state::battle::BattleState;
use er_state::game_v2::GameStateV2;
use er_state::pokemon::PokemonState;
use er_state::pokemon_v2::PokemonStateV2;
use er_state::snapshot::GameState;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BattleAdapterV2Error {
    #[error("M4 game state is invalid: {0}")]
    InvalidV2(String),
    #[error("M4 state has no active battle")]
    MissingBattle,
    #[error("battle Pokémon projection is invalid: {0}")]
    InvalidPokemon(String),
    #[error("M3 mechanics projection is invalid: {0}")]
    InvalidV1(String),
    #[error("M3 mechanics result changed battle identity")]
    IdentityMismatch,
    #[error("M3 mechanics result changed party ownership")]
    PartyMismatch,
}

pub fn project_battle_v2_to_v1(state: &GameStateV2) -> Result<GameState, BattleAdapterV2Error> {
    state
        .validate()
        .map_err(|error| BattleAdapterV2Error::InvalidV2(error.to_string()))?;
    let battle = state
        .battle
        .as_ref()
        .ok_or(BattleAdapterV2Error::MissingBattle)?;
    let player_party = state
        .player_party
        .iter()
        .map(project_pokemon)
        .collect::<Result<Vec<_>, _>>()?;
    let enemy_party = battle
        .enemy_party
        .iter()
        .map(project_pokemon)
        .collect::<Result<Vec<_>, _>>()?;
    let battle_v1 = BattleState {
        battle_id: battle.battle_id,
        wave: battle.wave,
        wave_seed: battle.wave_seed.clone(),
        turn: battle.turn,
        format: battle.format.clone(),
        authority_seat: battle.authority_seat,
        player_party,
        enemy_party,
        field: battle.field.clone(),
        weather: battle.weather.clone(),
        terrain: battle.terrain.clone(),
        arena_conditions: battle.arena_conditions.clone(),
        global_ability_suppression: battle.global_ability_suppression.clone(),
        battle_rng: battle.battle_rng.clone(),
        command_state: battle.command_state.clone(),
        faint_queue: battle.faint_queue.clone(),
        next_faint_occurrence: battle.next_faint_occurrence,
        outcome: battle.outcome,
    };
    GameState::new(
        state.battle_content_hash.clone(),
        state.mode,
        state.run.wave,
        state.run.next_battle_id,
        state.run.run_rng.clone(),
        Some(battle_v1),
    )
    .map_err(|error| BattleAdapterV2Error::InvalidV1(error.to_string()))
}

/// Merges a resolved M3 mechanics state into the M4 owner graph while
/// preserving progression-only fields and run ownership.
pub fn merge_battle_v1_into_v2(
    before: &GameStateV2,
    resolved: &GameState,
) -> Result<GameStateV2, BattleAdapterV2Error> {
    before
        .validate()
        .map_err(|error| BattleAdapterV2Error::InvalidV2(error.to_string()))?;
    resolved
        .validate()
        .map_err(|error| BattleAdapterV2Error::InvalidV1(error.to_string()))?;
    let before_battle = before
        .battle
        .as_ref()
        .ok_or(BattleAdapterV2Error::MissingBattle)?;
    let battle = resolved
        .battle
        .as_ref()
        .ok_or(BattleAdapterV2Error::MissingBattle)?;
    if resolved.content_hash != before.battle_content_hash
        || battle.battle_id != before_battle.battle_id
        || battle.wave != before_battle.wave
        || resolved.next_battle_id != before.run.next_battle_id
    {
        return Err(BattleAdapterV2Error::IdentityMismatch);
    }
    if battle.player_party.len() != before.player_party.len()
        || battle.enemy_party.len() != before_battle.enemy_party.len()
    {
        return Err(BattleAdapterV2Error::PartyMismatch);
    }

    let mut after = before.clone();
    for (target, source) in after.player_party.iter_mut().zip(&battle.player_party) {
        merge_pokemon(target, source)?;
    }
    let after_battle = after
        .battle
        .as_mut()
        .ok_or(BattleAdapterV2Error::MissingBattle)?;
    for (target, source) in after_battle.enemy_party.iter_mut().zip(&battle.enemy_party) {
        merge_pokemon(target, source)?;
    }
    after_battle.turn = battle.turn;
    after_battle.field = battle.field.clone();
    after_battle.weather = battle.weather.clone();
    after_battle.terrain = battle.terrain.clone();
    after_battle.arena_conditions = battle.arena_conditions.clone();
    after_battle.global_ability_suppression = battle.global_ability_suppression.clone();
    after_battle.battle_rng = battle.battle_rng.clone();
    after_battle.command_state = battle.command_state.clone();
    after_battle.faint_queue = battle.faint_queue.clone();
    after_battle.next_faint_occurrence = battle.next_faint_occurrence;
    after_battle.outcome = battle.outcome;
    after.run.run_rng = resolved.run_rng.clone();
    after
        .validate()
        .map_err(|error| BattleAdapterV2Error::InvalidV2(error.to_string()))?;
    Ok(after)
}

fn project_pokemon(value: &PokemonStateV2) -> Result<PokemonState, BattleAdapterV2Error> {
    PokemonState::new(
        value.id,
        value.owner_seat,
        value.species_id,
        value.form_index,
        value.level,
        value.types,
        value.stats,
        value.hp,
        value.max_hp,
        value.status,
        value.stat_stages,
        value.moves,
        value.abilities,
        value.fainted,
    )
    .map_err(|error| BattleAdapterV2Error::InvalidPokemon(error.to_string()))
}

fn merge_pokemon(
    target: &mut PokemonStateV2,
    source: &PokemonState,
) -> Result<(), BattleAdapterV2Error> {
    if target.id != source.id
        || target.owner_seat != source.owner_seat
        || target.species_id != source.species_id
        || target.form_index != source.form_index
        || target.level != source.level
    {
        return Err(BattleAdapterV2Error::PartyMismatch);
    }
    target.types = source.types;
    target.stats = source.stats;
    target.hp = source.hp;
    target.max_hp = source.max_hp;
    target.status = source.status;
    target.stat_stages = source.stat_stages;
    target.moves = source.moves;
    target.abilities = source.abilities;
    target.fainted = source.fainted;
    Ok(())
}
