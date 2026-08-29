//! Typed, offline migration from the M3 canonical snapshot into the M4 V2 graph.
//!
//! Migration is a pure validation-and-copy boundary. It does not draw RNG,
//! publish effects, derive progression, or repair incomplete evidence.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::SeatId;
use er_types::battle_ids::{BattleId, BattleSide, ContentPackHash, PokemonId};
use er_types::run_ids::{Experience, GrowthRateId, NatureId, RunContentPackHash};

use crate::battle_v2::{
    BATTLE_STATE_SCHEMA_VERSION_V2, BattleParticipationState, BattleSettlementState, BattleStateV2,
};
use crate::game_v2::{GAME_STATE_SCHEMA_VERSION_V2, GameStateV2};
use crate::pokemon::PokemonState as PokemonStateV1;
use crate::pokemon_v2::{
    Iv, POKEMON_STATE_SCHEMA_VERSION_V2, PermanentStatBonuses, PokemonProgressionState,
    PokemonStateV2,
};
use crate::run_v2::RunStateV2;
use crate::snapshot::GameState as GameStateV1;

pub const M3_PARITY_ORACLE_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
pub const M4_ORACLE_SHA: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MigrationStateSide {
    Initial,
    Final,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3PokemonCompanionKey {
    pub fixture_id: String,
    pub state_side: MigrationStateSide,
    pub party_side: BattleSide,
    pub pokemon_id: PokemonId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3PokemonCompanion {
    pub key: M3PokemonCompanionKey,
    pub source_party_index: u8,
    pub stable_roster_index: u8,
    pub owner_seat: Option<SeatId>,
    pub experience: Experience,
    pub growth_rate: GrowthRateId,
    pub ivs: [Iv; 6],
    pub nature: NatureId,
    pub effective_nature: NatureId,
    pub friendship: u16,
    pub permanent_bonuses: PermanentStatBonuses,
    pub pause_evolutions: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3BattleCompanion {
    pub fixture_id: String,
    pub state_side: MigrationStateSide,
    pub participation: BattleParticipationState,
    pub settlement: BattleSettlementState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3ToM4MigrationContext {
    pub m3_parity_oracle_sha: String,
    pub m4_oracle_sha: String,
    pub battle_content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub run: RunStateV2,
    pub fixture_id: String,
    pub state_side: MigrationStateSide,
    pub companions: Vec<M3PokemonCompanion>,
    pub battle: Option<M3BattleCompanion>,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum MigrationError {
    #[error("M3 state or companion schema is not the supported version")]
    WrongSchema,
    #[error("M3/M4 oracle identity does not match the frozen migration contract")]
    WrongOracle,
    #[error("battle or run content identity does not match the migration context")]
    ContentIdentity,
    #[error("a required M3 Pokémon or battle companion is missing")]
    MissingCompanion,
    #[error("a companion key appears more than once")]
    DuplicateCompanion,
    #[error("a companion does not identify a Pokémon or battle in the selected M3 state")]
    UnknownCompanion,
    #[error("source-party and stable-roster ordering evidence conflicts")]
    PartyOrderConflict,
    #[error("M3 owner evidence conflicts with its typed companion")]
    OwnerConflict,
    #[error("the M3 input graph is invalid")]
    InvalidV1,
    #[error("the migrated M4 V2 graph is invalid")]
    InvalidV2,
}

pub fn migrate_m3_game_state(
    input: &GameStateV1,
    context: &M3ToM4MigrationContext,
) -> Result<GameStateV2, MigrationError> {
    validate_provenance(input, context)?;
    input.validate().map_err(|_| MigrationError::InvalidV1)?;
    context
        .run
        .validate()
        .map_err(|_| MigrationError::InvalidV2)?;

    if context.run.wave != input.wave
        || context.run.next_battle_id != input.next_battle_id
        || context.run.run_rng != input.run_rng
    {
        return Err(MigrationError::ContentIdentity);
    }

    let (player_party, battle) = match input.battle.as_ref() {
        Some(source_battle) => {
            let battle_evidence = context
                .battle
                .as_ref()
                .ok_or(MigrationError::MissingCompanion)?;
            validate_battle_companion(battle_evidence, context, source_battle.battle_id)?;
            let player_party =
                migrate_party(&source_battle.player_party, BattleSide::Player, context)?;
            let enemy_party =
                migrate_party(&source_battle.enemy_party, BattleSide::Enemy, context)?;
            let battle = BattleStateV2 {
                schema_version: BATTLE_STATE_SCHEMA_VERSION_V2,
                battle_id: source_battle.battle_id,
                wave: source_battle.wave,
                wave_seed: source_battle.wave_seed.clone(),
                turn: source_battle.turn,
                format: source_battle.format.clone(),
                authority_seat: source_battle.authority_seat,
                enemy_party,
                field: source_battle.field.clone(),
                weather: source_battle.weather.clone(),
                terrain: source_battle.terrain.clone(),
                arena_conditions: source_battle.arena_conditions.clone(),
                global_ability_suppression: source_battle.global_ability_suppression.clone(),
                battle_rng: source_battle.battle_rng.clone(),
                command_state: source_battle.command_state.clone(),
                participation: battle_evidence.participation.clone(),
                settlement: battle_evidence.settlement.clone(),
                faint_queue: source_battle.faint_queue.clone(),
                next_faint_occurrence: source_battle.next_faint_occurrence,
                outcome: source_battle.outcome,
            };
            (player_party, Some(battle))
        }
        None => {
            if context.battle.is_some() || !context.companions.is_empty() {
                return Err(MigrationError::UnknownCompanion);
            }
            (Vec::new(), None)
        }
    };

    let output = GameStateV2 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V2,
        battle_content_hash: context.battle_content_hash.clone(),
        run_content_hash: context.run_content_hash.clone(),
        mode: input.mode,
        run: context.run.clone(),
        player_party,
        battle,
    };
    output.validate().map_err(|_| MigrationError::InvalidV2)?;
    Ok(output)
}

fn validate_provenance(
    input: &GameStateV1,
    context: &M3ToM4MigrationContext,
) -> Result<(), MigrationError> {
    if input.schema_version != crate::snapshot::GAME_STATE_SCHEMA_VERSION
        || context.fixture_id.is_empty()
    {
        return Err(MigrationError::WrongSchema);
    }
    if context.m3_parity_oracle_sha != M3_PARITY_ORACLE_SHA
        || context.m4_oracle_sha != M4_ORACLE_SHA
    {
        return Err(MigrationError::WrongOracle);
    }
    if input.content_hash != context.battle_content_hash {
        return Err(MigrationError::ContentIdentity);
    }

    let mut keys = BTreeSet::new();
    for companion in &context.companions {
        if companion.key.fixture_id != context.fixture_id
            || companion.key.state_side != context.state_side
        {
            return Err(MigrationError::UnknownCompanion);
        }
        if !keys.insert(companion.key.clone()) {
            return Err(MigrationError::DuplicateCompanion);
        }
    }
    if let Some(battle) = &context.battle {
        if battle.fixture_id != context.fixture_id || battle.state_side != context.state_side {
            return Err(MigrationError::UnknownCompanion);
        }
    }
    Ok(())
}

fn validate_battle_companion(
    companion: &M3BattleCompanion,
    context: &M3ToM4MigrationContext,
    battle_id: BattleId,
) -> Result<(), MigrationError> {
    if companion.fixture_id != context.fixture_id || companion.state_side != context.state_side {
        return Err(MigrationError::UnknownCompanion);
    }
    if companion.settlement.source_battle_id != battle_id {
        return Err(MigrationError::ContentIdentity);
    }
    Ok(())
}

fn migrate_party(
    source: &[PokemonStateV1],
    party_side: BattleSide,
    context: &M3ToM4MigrationContext,
) -> Result<Vec<PokemonStateV2>, MigrationError> {
    let mut companions_by_key = BTreeMap::new();
    for companion in &context.companions {
        if companion.key.party_side != party_side {
            continue;
        }
        if companions_by_key
            .insert(companion.key.pokemon_id, companion)
            .is_some()
        {
            return Err(MigrationError::DuplicateCompanion);
        }
    }

    let mut source_indexes = BTreeSet::new();
    let mut stable_indexes = BTreeSet::new();
    let mut records = Vec::with_capacity(source.len());
    for (source_index, pokemon) in source.iter().enumerate() {
        let source_index =
            u8::try_from(source_index).map_err(|_| MigrationError::PartyOrderConflict)?;
        let Some(companion) = companions_by_key.get(&pokemon.id) else {
            return Err(MigrationError::MissingCompanion);
        };
        if companion.source_party_index != source_index {
            return Err(MigrationError::PartyOrderConflict);
        }
        if !source_indexes.insert(companion.source_party_index)
            || !stable_indexes.insert(companion.stable_roster_index)
        {
            return Err(MigrationError::PartyOrderConflict);
        }
        if pokemon.owner_seat != companion.owner_seat
            || (party_side == BattleSide::Enemy && companion.owner_seat.is_some())
        {
            return Err(MigrationError::OwnerConflict);
        }
        records.push((companion.stable_roster_index, pokemon, companion));
    }

    if companions_by_key.len() != source.len() {
        return Err(MigrationError::UnknownCompanion);
    }
    records.sort_by_key(|(stable_index, _, _)| *stable_index);
    for (expected, (stable_index, _, _)) in records.iter().enumerate() {
        let expected = u8::try_from(expected).map_err(|_| MigrationError::PartyOrderConflict)?;
        if *stable_index != expected {
            return Err(MigrationError::PartyOrderConflict);
        }
    }

    records
        .into_iter()
        .map(|(_, pokemon, companion)| migrate_pokemon(pokemon, companion))
        .collect()
}

fn migrate_pokemon(
    source: &PokemonStateV1,
    companion: &M3PokemonCompanion,
) -> Result<PokemonStateV2, MigrationError> {
    let pokemon = PokemonStateV2 {
        schema_version: POKEMON_STATE_SCHEMA_VERSION_V2,
        id: source.id,
        owner_seat: source.owner_seat,
        species_id: source.species_id,
        form_index: source.form_index,
        level: source.level,
        types: source.types,
        stats: source.stats,
        hp: source.hp,
        max_hp: source.max_hp,
        status: source.status,
        stat_stages: source.stat_stages,
        moves: source.moves,
        abilities: source.abilities,
        fainted: source.fainted,
        progression: PokemonProgressionState {
            experience: companion.experience,
            growth_rate: companion.growth_rate,
            ivs: companion.ivs,
            nature: companion.nature,
            effective_nature: companion.effective_nature,
            friendship: companion.friendship,
            permanent_bonuses: companion.permanent_bonuses,
            pause_evolutions: companion.pause_evolutions,
        },
    };
    pokemon.validate().map_err(|_| MigrationError::InvalidV2)?;
    Ok(pokemon)
}
