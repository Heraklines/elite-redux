//! Pure M4 battle-settlement preparation over the complete [`GameStateV2`] graph.
//!
//! Settlement is deliberately a boundary-only transition.  It freezes the
//! evidence that was already recorded by battle resolution, removes fainted
//! participants from the retained recipient set, and marks the source battle
//! settled.  It does not award experience, advance the wave, consume random
//! state, or execute any callback-driven content.

use std::collections::BTreeSet;

use er_state::battle_v2::{BattleStateV2, DefeatedEnemyRecord, WaveRewardEvidence};
use er_state::game_v2::GameStateV2;
use er_types::SeatId;
use er_types::battle_ids::{BattleId, PokemonId, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::run_ids::Money;
use er_types::run_model::{RunOutcome, RunStage};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The typed input for one source-battle settlement boundary.
///
/// There are intentionally no callbacks, replacements, reward values, or
/// participant lists in this input.  Those values are owned by the battle
/// state and are copied into the prepared evidence only after preflight.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BattleSettlementInput {
    pub source_battle_id: BattleId,
    pub wave: WaveIndex,
}

/// Evidence frozen by the settlement boundary.
///
/// The vectors retain the exact battle order.  `rng_unchanged` is a typed
/// proof marker for this pure transition and is always `true` on success.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BattleSettlementEvidence {
    pub source_battle_id: BattleId,
    pub wave: WaveIndex,
    pub retained_participants: Vec<PokemonId>,
    pub defeated_enemies: Vec<DefeatedEnemyRecord>,
    pub scattered_money: Money,
    pub wave_reward_evidence: Vec<WaveRewardEvidence>,
    pub rng_unchanged: bool,
}

/// The complete staged state and evidence for one settlement boundary.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedBattleSettlement {
    pub after_state: GameStateV2,
    pub evidence: BattleSettlementEvidence,
}

/// Errors raised before settlement can stage any candidate state.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SettlementError {
    #[error("the complete game state is invalid")]
    InvalidState,
    #[error("settlement requires an active battle")]
    MissingBattle,
    #[error("settlement requires the Battle run stage")]
    InvalidStage,
    #[error("the source battle identity does not match the active battle")]
    WrongSourceBattle,
    #[error("the source wave does not match the active battle")]
    WrongWave,
    #[error("the active battle has already been settled")]
    AlreadySettled,
    #[error("the active battle outcome is not terminal")]
    NonTerminalOutcome,
    #[error("the battle outcome contradicts the living party state")]
    OutcomeMismatch,
    #[error("a participant is not a player-party Pokémon")]
    UnknownParticipant,
    #[error("a participant does not have a valid player owner")]
    ParticipantOwnerMismatch,
    #[error("a participant appears more than once")]
    DuplicateParticipant,
    #[error("a defeated enemy is not an encounter Pokémon")]
    UnknownDefeatedEnemy,
    #[error("a defeated enemy appears more than once")]
    DuplicateDefeatedEnemy,
    #[error("a defeated enemy record has a player owner")]
    DefeatedEnemyOwnerMismatch,
    #[error("a defeated enemy record names a living enemy")]
    LivingDefeatedEnemy,
    #[error("settlement input contains unsupported callbacks")]
    UnsupportedCallback,
}

/// Prepare the exact boundary transition for a terminal source battle.
///
/// The input state and all of its RNG values remain untouched.  A successful
/// candidate only changes battle participation/settlement evidence and the
/// run stage; wave advancement and progression distribution are separate
/// transitions.
pub fn prepare_battle_settlement(
    before: &GameStateV2,
    input: &BattleSettlementInput,
) -> Result<PreparedBattleSettlement, SettlementError> {
    let battle = before
        .battle
        .as_ref()
        .ok_or(SettlementError::MissingBattle)?;

    preflight_state(before, battle, input)?;

    // The battle is the sole owner of these values.  Caller-authored
    // replacements cannot enter the transition.
    let retained_participants = battle
        .participation
        .player_participants
        .iter()
        .copied()
        .filter(|pokemon| {
            before
                .player_party
                .iter()
                .find(|record| record.id == *pokemon)
                .is_some_and(|record| !record.fainted)
        })
        .collect::<Vec<_>>();
    let defeated_enemies = battle.participation.defeated_enemies.clone();
    let scattered_money = battle.settlement.scattered_money;
    let wave_reward_evidence = battle.settlement.wave_reward_evidence.clone();
    let source_battle_id = battle.battle_id;
    let wave = battle.wave;

    let mut after_state = before.clone();
    {
        let after_battle = after_state
            .battle
            .as_mut()
            .ok_or(SettlementError::MissingBattle)?;
        after_battle.participation.player_participants = retained_participants.clone();
        after_battle.settlement.settled = true;
    }
    after_state.run.stage = RunStage::AwaitingWaveAdvance;
    after_state
        .validate()
        .map_err(|_| SettlementError::InvalidState)?;

    let evidence = BattleSettlementEvidence {
        source_battle_id,
        wave,
        retained_participants,
        defeated_enemies,
        scattered_money,
        wave_reward_evidence,
        rng_unchanged: true,
    };

    Ok(PreparedBattleSettlement {
        after_state,
        evidence,
    })
}

fn preflight_state(
    state: &GameStateV2,
    battle: &BattleStateV2,
    input: &BattleSettlementInput,
) -> Result<(), SettlementError> {
    if battle.settlement.settled {
        return Err(SettlementError::AlreadySettled);
    }

    if state.player_party.len() > 6 {
        return Err(SettlementError::InvalidState);
    }
    let Some(expected_next_battle_id) = battle
        .battle_id
        .get()
        .get()
        .checked_add(1)
        .and_then(|value| er_types::SafeU53::new(value).ok())
        .map(BattleId::new)
    else {
        return Err(SettlementError::InvalidState);
    };
    if state.run.next_battle_id != expected_next_battle_id {
        return Err(SettlementError::InvalidState);
    }

    if !matches!(state.run.stage, RunStage::Battle)
        || state.run.active_surface.is_some()
        || !state.run.progression.tasks.is_empty()
        || state.run.progression.active_index.is_some()
        || !matches!(state.run.outcome, RunOutcome::InProgress)
    {
        return Err(SettlementError::InvalidStage);
    }
    if input.source_battle_id != battle.battle_id
        || battle.settlement.source_battle_id != battle.battle_id
    {
        return Err(SettlementError::WrongSourceBattle);
    }
    if input.wave != battle.wave || state.run.wave != battle.wave {
        return Err(SettlementError::WrongWave);
    }

    match battle.outcome {
        BattleOutcome::Ongoing => return Err(SettlementError::NonTerminalOutcome),
        BattleOutcome::Victory => {
            if battle.enemy_party.iter().any(|pokemon| !pokemon.fainted) {
                return Err(SettlementError::OutcomeMismatch);
            }
        }
        BattleOutcome::Defeat => {
            if state.player_party.iter().any(|pokemon| !pokemon.fainted) {
                return Err(SettlementError::OutcomeMismatch);
            }
        }
    }

    // Classify settlement-owned evidence before the complete state check so
    // callers receive the closed settlement error rather than losing the first
    // divergent record behind a generic invalid-state boundary.
    validate_party_graph(state, battle)?;
    validate_participation(state, battle)?;
    validate_defeated_enemies(battle)?;
    state
        .validate()
        .map_err(|_| SettlementError::InvalidState)?;
    Ok(())
}

fn validate_party_graph(
    state: &GameStateV2,
    battle: &BattleStateV2,
) -> Result<(), SettlementError> {
    let mut ids = BTreeSet::new();
    for pokemon in &state.player_party {
        if !ids.insert(pokemon.id) {
            return Err(SettlementError::InvalidState);
        }
        let Some(owner) = pokemon.owner_seat else {
            return Err(SettlementError::InvalidState);
        };
        if !is_human_owner(battle, owner)? {
            return Err(SettlementError::InvalidState);
        }
    }
    for pokemon in &battle.enemy_party {
        if !ids.insert(pokemon.id) || pokemon.owner_seat.is_some() {
            return Err(SettlementError::InvalidState);
        }
    }

    // Field slots are stable references into exactly one owner vector.  The
    // nested battle validator checks topology; this checks cross-owner links.
    for field_slot in &battle.field.slots {
        let Some(pokemon) = field_slot.occupant else {
            continue;
        };
        let record = match field_slot.slot.side {
            er_types::battle_ids::BattleSide::Player => {
                state.player_party.iter().find(|value| value.id == pokemon)
            }
            er_types::battle_ids::BattleSide::Enemy => {
                battle.enemy_party.iter().find(|value| value.id == pokemon)
            }
        };
        let expected_owner = er_state::format::owner_seat_for(&battle.format, field_slot.slot)
            .map_err(|_| SettlementError::InvalidState)?;
        let Some(record) = record else {
            return Err(SettlementError::InvalidState);
        };
        if record.owner_seat != expected_owner {
            return Err(SettlementError::InvalidState);
        }
    }

    for occurrence in &battle.faint_queue {
        let record = state
            .player_party
            .iter()
            .find(|value| value.id == occurrence.pokemon)
            .or_else(|| {
                battle
                    .enemy_party
                    .iter()
                    .find(|value| value.id == occurrence.pokemon)
            });
        let Some(record) = record else {
            return Err(SettlementError::InvalidState);
        };
        if record.owner_seat != occurrence.owner_seat {
            return Err(SettlementError::InvalidState);
        }
    }
    Ok(())
}

fn is_human_owner(battle: &BattleStateV2, owner: SeatId) -> Result<bool, SettlementError> {
    er_state::format::human_seats(&battle.format)
        .map(|seats| seats.contains(&owner))
        .map_err(|_| SettlementError::InvalidState)
}

fn validate_participation(
    state: &GameStateV2,
    battle: &BattleStateV2,
) -> Result<(), SettlementError> {
    let mut participants = BTreeSet::new();
    for pokemon in &battle.participation.player_participants {
        if !participants.insert(*pokemon) {
            return Err(SettlementError::DuplicateParticipant);
        }
        let Some(record) = state.player_party.iter().find(|value| value.id == *pokemon) else {
            return Err(SettlementError::UnknownParticipant);
        };
        if record.owner_seat.is_none() {
            return Err(SettlementError::ParticipantOwnerMismatch);
        }
    }
    Ok(())
}

fn validate_defeated_enemies(battle: &BattleStateV2) -> Result<(), SettlementError> {
    let mut defeated = BTreeSet::new();
    for record in &battle.participation.defeated_enemies {
        if !defeated.insert(record.pokemon) {
            return Err(SettlementError::DuplicateDefeatedEnemy);
        }
        if record.owner_seat.is_some() {
            return Err(SettlementError::DefeatedEnemyOwnerMismatch);
        }
        let Some(enemy) = battle
            .enemy_party
            .iter()
            .find(|value| value.id == record.pokemon)
        else {
            return Err(SettlementError::UnknownDefeatedEnemy);
        };
        if !enemy.fainted {
            return Err(SettlementError::LivingDefeatedEnemy);
        }
    }
    Ok(())
}
