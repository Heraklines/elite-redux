//! Complete M4 V2 state validation.
//!
//! Validation is fail-closed: no field is inferred, repaired, defaulted, or
//! reconstructed. Every nested root is checked before cross-owner references.

use std::collections::BTreeSet;

use er_types::battle_ids::{BattleId, BattleSide, FieldSlot, PokemonId};
use er_types::battle_model::{BattleOutcome, FaintOccurrence, ReplacementProgress};
use er_types::run_model::{RunOutcome, RunStage};
use er_types::{SafeU53, SeatId};
use thiserror::Error;

use crate::battle_v2::{BattleStateV2, BattleStateV2Error};
use crate::field::FieldStateError;
use crate::format::FormatTopologyError;
use crate::game_v2::{GAME_STATE_SCHEMA_VERSION_V2, GameStateV2};
use crate::pokemon_v2::{PokemonStateV2, PokemonStateV2Error};
use crate::run_v2::{ProgressionTask, RunStateValidationError};

const MAX_PARTY_SIZE: usize = 6;

#[derive(Debug, Error)]
pub enum StateValidationErrorV2 {
    #[error("GameStateV2 schema version must be {expected}, got {actual}")]
    GameSchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("run state is invalid: {0}")]
    Run(#[from] RunStateValidationError),
    #[error("battle state is invalid: {0}")]
    Battle(#[from] BattleStateV2Error),
    #[error("format topology is invalid: {0}")]
    Format(#[from] FormatTopologyError),
    #[error("field topology is invalid: {0}")]
    Field(#[from] FieldStateError),
    #[error("player party has {actual} records; maximum is {maximum}")]
    PlayerPartyTooLarge { actual: usize, maximum: usize },
    #[error("enemy party has {actual} records; maximum party size is {maximum}")]
    EnemyPartyTooLarge { actual: usize, maximum: usize },
    #[error("battle outcome does not agree with living party state")]
    BattleOutcomeMismatch,
    #[error("player party record {index} is invalid: {source}")]
    PlayerPokemon {
        index: usize,
        #[source]
        source: PokemonStateV2Error,
    },
    #[error("enemy party record {index} is invalid: {source}")]
    EnemyPokemon {
        index: usize,
        #[source]
        source: PokemonStateV2Error,
    },
    #[error("Pokémon ID {pokemon:?} appears more than once across the V2 graph")]
    DuplicatePokemonId { pokemon: PokemonId },
    #[error("player Pokémon {pokemon:?} has no owner seat")]
    PlayerMissingOwner { pokemon: PokemonId },
    #[error("player Pokémon {pokemon:?} owner seat {owner:?} is not human")]
    InvalidPlayerOwner { pokemon: PokemonId, owner: SeatId },
    #[error("enemy Pokémon {pokemon:?} must not have owner seat {owner:?}")]
    EnemyHasOwner { pokemon: PokemonId, owner: SeatId },
    #[error("field occupant {pokemon:?} in {slot:?} is absent from the matching owner vector")]
    MissingFieldOccupant { slot: FieldSlot, pokemon: PokemonId },
    #[error("field occupant {pokemon:?} in {slot:?} has owner {actual:?}, expected {expected:?}")]
    FieldOwnerMismatch {
        slot: FieldSlot,
        pokemon: PokemonId,
        expected: Option<SeatId>,
        actual: Option<SeatId>,
    },
    #[error("authority seat {seat:?} is not a human player seat")]
    InvalidAuthoritySeat { seat: SeatId },
    #[error("game wave and battle wave disagree")]
    WaveMismatch,
    #[error("battle allocator disagrees with active battle")]
    NextBattleIdMismatch,
    #[error("battle settlement source does not identify the active battle")]
    SettlementSourceMismatch,
    #[error("active battle cannot be settled while run stage is BATTLE")]
    SettledBattleInBattleStage,
    #[error("player participation list contains duplicate Pokémon {pokemon:?}")]
    DuplicateParticipant { pokemon: PokemonId },
    #[error("player participation references unknown Pokémon {pokemon:?}")]
    UnknownParticipant { pokemon: PokemonId },
    #[error("player participation Pokémon {pokemon:?} has wrong owner")]
    ParticipantOwnerMismatch { pokemon: PokemonId },
    #[error("defeated enemy evidence references unknown Pokémon {pokemon:?}")]
    UnknownDefeatedEnemy { pokemon: PokemonId },
    #[error("defeated enemy evidence contains duplicate Pokémon {pokemon:?}")]
    DuplicateDefeatedEnemy { pokemon: PokemonId },
    #[error("defeated enemy evidence gives Pokémon {pokemon:?} a human owner")]
    DefeatedEnemyOwner { pokemon: PokemonId },
    #[error("faint occurrence {id:?} has invalid cross-owner references")]
    FaintOwnerMismatch {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("run stage contradicts complete nested state")]
    StageInvariant,
}

pub fn validate_game_state_v2(state: &GameStateV2) -> Result<(), StateValidationErrorV2> {
    if state.schema_version != GAME_STATE_SCHEMA_VERSION_V2 {
        return Err(StateValidationErrorV2::GameSchemaVersionMismatch {
            expected: GAME_STATE_SCHEMA_VERSION_V2,
            actual: state.schema_version,
        });
    }
    state.run.validate()?;

    if state.player_party.len() > MAX_PARTY_SIZE {
        return Err(StateValidationErrorV2::PlayerPartyTooLarge {
            actual: state.player_party.len(),
            maximum: MAX_PARTY_SIZE,
        });
    }
    let mut all_ids = BTreeSet::new();
    for (index, pokemon) in state.player_party.iter().enumerate() {
        pokemon
            .validate()
            .map_err(|source| StateValidationErrorV2::PlayerPokemon { index, source })?;
        if !all_ids.insert(pokemon.id) {
            return Err(StateValidationErrorV2::DuplicatePokemonId {
                pokemon: pokemon.id,
            });
        }
        if pokemon.owner_seat.is_none() {
            return Err(StateValidationErrorV2::PlayerMissingOwner {
                pokemon: pokemon.id,
            });
        }
    }

    match &state.battle {
        Some(battle) => {
            validate_battle(state, battle, &mut all_ids)?;
            validate_stage_with_battle(state)?;
        }
        None => validate_stage_without_battle(state)?,
    }
    Ok(())
}

fn validate_battle(
    state: &GameStateV2,
    battle: &BattleStateV2,
    all_ids: &mut BTreeSet<PokemonId>,
) -> Result<(), StateValidationErrorV2> {
    battle.validate()?;
    if state.run.wave != battle.wave {
        return Err(StateValidationErrorV2::WaveMismatch);
    }
    let expected_next = battle
        .battle_id
        .get()
        .get()
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .map(BattleId::new)
        .ok_or(StateValidationErrorV2::NextBattleIdMismatch)?;
    if state.run.next_battle_id != expected_next {
        return Err(StateValidationErrorV2::NextBattleIdMismatch);
    }

    let human_seats = crate::format::human_seats(&battle.format)?;
    if !human_seats.contains(&battle.authority_seat) {
        return Err(StateValidationErrorV2::InvalidAuthoritySeat {
            seat: battle.authority_seat,
        });
    }
    if battle.enemy_party.len() > MAX_PARTY_SIZE {
        return Err(StateValidationErrorV2::EnemyPartyTooLarge {
            actual: battle.enemy_party.len(),
            maximum: MAX_PARTY_SIZE,
        });
    }
    for pokemon in &state.player_party {
        let Some(owner) = pokemon.owner_seat else {
            return Err(StateValidationErrorV2::PlayerMissingOwner {
                pokemon: pokemon.id,
            });
        };
        if !human_seats.contains(&owner) {
            return Err(StateValidationErrorV2::InvalidPlayerOwner {
                pokemon: pokemon.id,
                owner,
            });
        }
    }

    for pokemon in &battle.enemy_party {
        if let Some(owner) = pokemon.owner_seat {
            return Err(StateValidationErrorV2::EnemyHasOwner {
                pokemon: pokemon.id,
                owner,
            });
        }
        if !all_ids.insert(pokemon.id) {
            return Err(StateValidationErrorV2::DuplicatePokemonId {
                pokemon: pokemon.id,
            });
        }
    }

    for field_slot in &battle.field.slots {
        let Some(pokemon_id) = field_slot.occupant else {
            continue;
        };
        let in_player = state
            .player_party
            .iter()
            .find(|pokemon| pokemon.id == pokemon_id);
        let in_enemy = battle
            .enemy_party
            .iter()
            .find(|pokemon| pokemon.id == pokemon_id);
        let expected_owner = crate::format::owner_seat_for(&battle.format, field_slot.slot)?;
        let actual_owner = match field_slot.slot.side {
            BattleSide::Player => in_player.and_then(|pokemon| pokemon.owner_seat),
            BattleSide::Enemy => in_enemy.and_then(|pokemon| pokemon.owner_seat),
        };
        if (field_slot.slot.side == BattleSide::Player && in_player.is_none())
            || (field_slot.slot.side == BattleSide::Enemy && in_enemy.is_none())
        {
            return Err(StateValidationErrorV2::MissingFieldOccupant {
                slot: field_slot.slot,
                pokemon: pokemon_id,
            });
        }
        if actual_owner != expected_owner {
            return Err(StateValidationErrorV2::FieldOwnerMismatch {
                slot: field_slot.slot,
                pokemon: pokemon_id,
                expected: expected_owner,
                actual: actual_owner,
            });
        }
    }

    let mut participants = BTreeSet::new();
    for pokemon in &battle.participation.player_participants {
        if !participants.insert(*pokemon) {
            return Err(StateValidationErrorV2::DuplicateParticipant { pokemon: *pokemon });
        }
        let Some(record) = state.player_party.iter().find(|value| value.id == *pokemon) else {
            return Err(StateValidationErrorV2::UnknownParticipant { pokemon: *pokemon });
        };
        if record.owner_seat.is_none() {
            return Err(StateValidationErrorV2::ParticipantOwnerMismatch { pokemon: *pokemon });
        }
    }
    let mut defeated = BTreeSet::new();
    for record in &battle.participation.defeated_enemies {
        if !defeated.insert(record.pokemon) {
            return Err(StateValidationErrorV2::DuplicateDefeatedEnemy {
                pokemon: record.pokemon,
            });
        }
        let Some(enemy) = battle
            .enemy_party
            .iter()
            .find(|value| value.id == record.pokemon)
        else {
            return Err(StateValidationErrorV2::UnknownDefeatedEnemy {
                pokemon: record.pokemon,
            });
        };
        if enemy.owner_seat.is_some() || record.owner_seat.is_some() {
            return Err(StateValidationErrorV2::DefeatedEnemyOwner {
                pokemon: record.pokemon,
            });
        }
    }

    if battle.settlement.source_battle_id != battle.battle_id {
        return Err(StateValidationErrorV2::SettlementSourceMismatch);
    }
    if battle.settlement.settled && matches!(state.run.stage, RunStage::Battle) {
        return Err(StateValidationErrorV2::SettledBattleInBattleStage);
    }
    let enemy_alive = battle.enemy_party.iter().any(|pokemon| pokemon.hp > 0);
    let player_alive = state.player_party.iter().any(|pokemon| pokemon.hp > 0);
    if (matches!(battle.outcome, BattleOutcome::Victory) && enemy_alive)
        || (matches!(battle.outcome, BattleOutcome::Defeat) && player_alive)
    {
        return Err(StateValidationErrorV2::BattleOutcomeMismatch);
    }
    validate_faint_owners(state, battle)?;
    Ok(())
}

fn validate_faint_owners(
    state: &GameStateV2,
    battle: &BattleStateV2,
) -> Result<(), StateValidationErrorV2> {
    for occurrence in &battle.faint_queue {
        let Some(record) = state
            .player_party
            .iter()
            .find(|pokemon| pokemon.id == occurrence.pokemon)
            .or_else(|| {
                battle
                    .enemy_party
                    .iter()
                    .find(|pokemon| pokemon.id == occurrence.pokemon)
            })
        else {
            return Err(StateValidationErrorV2::FaintOwnerMismatch { id: occurrence.id });
        };
        if record.owner_seat != occurrence.owner_seat {
            return Err(StateValidationErrorV2::FaintOwnerMismatch { id: occurrence.id });
        }
    }
    Ok(())
}

fn validate_stage_with_battle(state: &GameStateV2) -> Result<(), StateValidationErrorV2> {
    let run = &state.run;
    let Some(battle) = state.battle.as_ref() else {
        return Err(StateValidationErrorV2::StageInvariant);
    };
    match run.stage {
        RunStage::Battle => {
            if run.active_surface.is_some()
                || !run.progression.tasks.is_empty()
                || battle.settlement.settled
                || !matches!(run.outcome, RunOutcome::InProgress)
            {
                return Err(StateValidationErrorV2::StageInvariant);
            }
        }
        RunStage::AwaitingWaveAdvance => {
            if run.active_surface.is_some()
                || !run.progression.tasks.is_empty()
                || !matches!(
                    battle.outcome,
                    BattleOutcome::Victory | BattleOutcome::Defeat
                )
                || !battle.settlement.settled
                || !matches!(run.outcome, RunOutcome::InProgress)
            {
                return Err(StateValidationErrorV2::StageInvariant);
            }
        }
        _ => return Err(StateValidationErrorV2::StageInvariant),
    }
    Ok(())
}

fn validate_stage_without_battle(state: &GameStateV2) -> Result<(), StateValidationErrorV2> {
    let run = &state.run;
    match run.stage {
        RunStage::Progression => {
            if run.active_surface.is_some()
                || run.progression.tasks.is_empty()
                || run.progression.active_index.is_none()
                || !matches!(run.outcome, RunOutcome::InProgress)
            {
                return Err(StateValidationErrorV2::StageInvariant);
            }
            if run
                .progression
                .tasks
                .iter()
                .any(|task| matches!(task.task, ProgressionTask::UnsupportedEvolution(_)))
            {
                return Err(StateValidationErrorV2::StageInvariant);
            }
        }
        RunStage::Surface => {
            if run.active_surface.is_none()
                || !run.progression.tasks.is_empty()
                || !matches!(run.outcome, RunOutcome::InProgress)
            {
                return Err(StateValidationErrorV2::StageInvariant);
            }
        }
        RunStage::Complete => {
            if !matches!(run.outcome, RunOutcome::Victory | RunOutcome::Defeat)
                || run.active_surface.is_some()
                || !run.progression.tasks.is_empty()
            {
                return Err(StateValidationErrorV2::StageInvariant);
            }
        }
        RunStage::Battle | RunStage::AwaitingWaveAdvance => {
            return Err(StateValidationErrorV2::StageInvariant);
        }
    }
    Ok(())
}

pub fn validate_pokemon_graph_v2(party: &[PokemonStateV2]) -> Result<(), StateValidationErrorV2> {
    let mut ids = BTreeSet::new();
    for (index, pokemon) in party.iter().enumerate() {
        pokemon
            .validate()
            .map_err(|source| StateValidationErrorV2::PlayerPokemon { index, source })?;
        if !ids.insert(pokemon.id) {
            return Err(StateValidationErrorV2::DuplicatePokemonId {
                pokemon: pokemon.id,
            });
        }
    }
    Ok(())
}

pub fn validate_v2_faint_occurrence(
    occurrence: &FaintOccurrence,
    battle: &BattleStateV2,
) -> Result<(), StateValidationErrorV2> {
    let exists = battle
        .enemy_party
        .iter()
        .any(|pokemon| pokemon.id == occurrence.pokemon);
    if !exists {
        return Err(StateValidationErrorV2::FaintOwnerMismatch { id: occurrence.id });
    }
    if !matches!(
        occurrence.replacement,
        ReplacementProgress::NotRequired | ReplacementProgress::Applied
    ) {
        return Ok(());
    }
    Ok(())
}
