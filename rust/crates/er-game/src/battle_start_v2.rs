//! Atomic M4 encounter-plan to battle-state construction.

use er_rng::battle::BattleRngState;
use er_run::encounter_plan::EncounterPlan;
use er_run::transition::GameContentBundle;
use er_state::battle_v2::{
    BATTLE_STATE_SCHEMA_VERSION_V2, BattleParticipationState, BattleSettlementState, BattleStateV2,
};
use er_state::field::FieldState;
use er_state::game_v2::GameStateV2;
use er_state::pokemon_v2::PokemonStateV2;
use er_types::SafeU53;
use er_types::SeatId;
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{BattleSide, FaintOccurrenceId, FieldSlot, TurnIndex};
use er_types::battle_model::{
    BattleOutcome, CapabilityStatus, GlobalAbilitySuppressionState, TerrainKind, TerrainState,
    WeatherKind, WeatherState,
};
use er_types::run_ids::Money;
use er_types::run_model::{RunOutcome, RunStage};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BattleStartV2Error {
    #[error("encounter plan is invalid: {0}")]
    InvalidPlan(String),
    #[error("game state is invalid before battle start: {0}")]
    InvalidBefore(String),
    #[error("encounter plan does not match the run frontier")]
    FrontierMismatch,
    #[error("encounter lead identity is absent from its owning party")]
    MissingLead,
    #[error("encounter reaches content outside the supported battle slice")]
    UnsupportedContent,
    #[error("battle allocator overflowed")]
    AllocatorOverflow,
    #[error("battle field construction failed: {0}")]
    Field(String),
    #[error("battle command-state construction failed: {0}")]
    Command(String),
    #[error("game state is invalid after battle start: {0}")]
    InvalidAfter(String),
}

/// Folds one validated, authority-prepared encounter plan into a complete
/// `BattleStateV2`. The input state is never mutated.
pub fn start_battle_v2(
    before: &GameStateV2,
    plan: &EncounterPlan,
    authority_seat: SeatId,
    content: &GameContentBundle,
) -> Result<GameStateV2, BattleStartV2Error> {
    before
        .validate()
        .map_err(|error| BattleStartV2Error::InvalidBefore(error.to_string()))?;
    plan.validate()
        .map_err(|error| BattleStartV2Error::InvalidPlan(error.to_string()))?;
    if plan.run_id != before.run.run_id
        || plan.wave != before.run.wave
        || plan.biome != before.run.biome.biome
        || plan.content_hash.as_ref() != Some(&before.run_content_hash)
        || before.battle.is_some()
    {
        return Err(BattleStartV2Error::FrontierMismatch);
    }
    if before.battle_content_hash != content.battle.hash
        || before.run_content_hash != content.run.run_content_hash
        || before
            .player_party
            .iter()
            .chain(plan.enemy_party.iter())
            .any(|pokemon| !pokemon_content_is_supported(pokemon, content))
    {
        return Err(BattleStartV2Error::UnsupportedContent);
    }
    if plan
        .player_leads
        .iter()
        .any(|id| before.player_party.iter().all(|pokemon| pokemon.id != *id))
        || plan
            .enemy_leads
            .iter()
            .any(|id| plan.enemy_party.iter().all(|pokemon| pokemon.id != *id))
    {
        return Err(BattleStartV2Error::MissingLead);
    }

    let battle_id = before.run.next_battle_id;
    let next_battle_value = battle_id
        .get()
        .get()
        .checked_add(1)
        .ok_or(BattleStartV2Error::AllocatorOverflow)?;
    let next_battle_id = er_types::battle_ids::BattleId::new(
        SafeU53::new(next_battle_value).map_err(|_| BattleStartV2Error::AllocatorOverflow)?,
    );
    let mut field = FieldState::empty_for_format(&plan.format)
        .map_err(|error| BattleStartV2Error::Field(error.to_string()))?;
    for (position, pokemon) in plan.player_leads.iter().copied().enumerate() {
        let position = u8::try_from(position).map_err(|_| BattleStartV2Error::MissingLead)?;
        let slot = FieldSlot::new(BattleSide::Player, position)
            .map_err(|error| BattleStartV2Error::Field(error.to_string()))?;
        let entry = field
            .slots
            .iter_mut()
            .find(|entry| entry.slot == slot)
            .ok_or(BattleStartV2Error::MissingLead)?;
        entry.occupant = Some(pokemon);
    }
    for (position, pokemon) in plan.enemy_leads.iter().copied().enumerate() {
        let position = u8::try_from(position).map_err(|_| BattleStartV2Error::MissingLead)?;
        let slot = FieldSlot::new(BattleSide::Enemy, position)
            .map_err(|error| BattleStartV2Error::Field(error.to_string()))?;
        let entry = field
            .slots
            .iter_mut()
            .find(|entry| entry.slot == slot)
            .ok_or(BattleStartV2Error::MissingLead)?;
        entry.occupant = Some(pokemon);
    }
    field
        .validate_for_format(&plan.format)
        .map_err(|error| BattleStartV2Error::Field(error.to_string()))?;

    let turn = TurnIndex::new(SafeU53::new(1).expect("turn one is safe"))
        .map_err(|error| BattleStartV2Error::Command(error.to_string()))?;
    let command_state = CommandCollectionState::new(Vec::new(), Vec::new())
        .map_err(|error| BattleStartV2Error::Command(error.to_string()))?;
    let battle = BattleStateV2 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V2,
        battle_id,
        wave: plan.wave,
        wave_seed: plan.battle_seed.clone(),
        turn,
        format: plan.format.clone(),
        authority_seat,
        enemy_party: plan.enemy_party.clone(),
        field,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng: BattleRngState::new(plan.battle_seed.clone(), turn),
        command_state,
        participation: BattleParticipationState {
            player_participants: plan.player_leads.clone(),
            defeated_enemies: Vec::new(),
        },
        settlement: BattleSettlementState {
            source_battle_id: battle_id,
            settled: false,
            scattered_money: Money::ZERO,
            wave_reward_evidence: Vec::new(),
        },
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(
            SafeU53::new(1).expect("first faint occurrence is safe"),
        ),
        outcome: BattleOutcome::Ongoing,
    };

    let mut after = before.clone();
    after.run.next_battle_id = next_battle_id;
    after.run.stage = RunStage::Battle;
    after.run.outcome = RunOutcome::InProgress;
    after.run.active_surface = None;
    after.run.progression.tasks.clear();
    after.run.progression.active_index = None;
    after.battle = Some(battle);
    after
        .validate()
        .map_err(|error| BattleStartV2Error::InvalidAfter(error.to_string()))?;
    Ok(after)
}

fn pokemon_content_is_supported(pokemon: &PokemonStateV2, content: &GameContentBundle) -> bool {
    let species = content
        .battle
        .species
        .iter()
        .find(|definition| definition.id == pokemon.species_id)
        .is_some_and(|definition| definition.capability == CapabilityStatus::Supported);
    let moves = pokemon.moves.iter().flatten().all(|slot| {
        content
            .battle
            .moves
            .iter()
            .find(|definition| definition.id == slot.move_id)
            .is_some_and(|definition| definition.capability == CapabilityStatus::Supported)
    });
    let abilities = std::iter::once(Some(pokemon.abilities.active))
        .chain(pokemon.abilities.passives)
        .flatten()
        .all(|ability| {
            content
                .battle
                .abilities
                .iter()
                .find(|definition| definition.id == ability)
                .is_some_and(|definition| definition.capability == CapabilityStatus::Supported)
        });
    species && moves && abilities
}
