//! Versioned M4 battle state with encounter-owned enemies only.

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use er_rng::battle::BattleRngState;
use er_types::SeatId;
use er_types::battle_command::CommandCollectionState;
pub use er_types::battle_ids::{
    BattleFormat, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, MoveSlotIndex, PartyIndex,
    PokemonId, TurnIndex, WaveIndex,
};
pub use er_types::battle_model::{
    ArenaConditionState, BattleOutcome, FaintOccurrence, GlobalAbilitySuppressionState,
    TerrainState, WeatherState,
};

use crate::field::FieldState;
use crate::pokemon_v2::PokemonStateV2;

pub const BATTLE_STATE_SCHEMA_VERSION_V2: u32 = 2;

/// The final participation evidence frozen at the wave boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleParticipationState {
    pub player_participants: Vec<PokemonId>,
    pub defeated_enemies: Vec<DefeatedEnemyRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DefeatedEnemyRecord {
    pub pokemon: PokemonId,
    pub owner_seat: Option<SeatId>,
}

/// Closed reward evidence retained with the battle until settlement.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WaveRewardEvidence {
    pub pokemon: PokemonId,
    pub experience: er_types::run_ids::Experience,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleSettlementState {
    pub source_battle_id: BattleId,
    pub settled: bool,
    pub scattered_money: er_types::run_ids::Money,
    pub wave_reward_evidence: Vec<WaveRewardEvidence>,
}

/// Canonical mechanical state for one active encounter.
///
/// The player party is owned by [`crate::game_v2::GameStateV2`]. `field` only
/// stores stable IDs into that game-owned vector for player slots and this
/// battle-owned `enemy_party` vector for enemy slots.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleStateV2 {
    pub schema_version: u32,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub wave_seed: String,
    pub turn: TurnIndex,
    pub format: BattleFormat,
    pub authority_seat: SeatId,
    pub enemy_party: Vec<PokemonStateV2>,
    pub field: FieldState,
    pub weather: WeatherState,
    pub terrain: TerrainState,
    pub arena_conditions: Vec<ArenaConditionState>,
    pub global_ability_suppression: GlobalAbilitySuppressionState,
    pub battle_rng: BattleRngState,
    pub command_state: CommandCollectionState,
    pub participation: BattleParticipationState,
    pub settlement: BattleSettlementState,
    pub faint_queue: Vec<FaintOccurrence>,
    pub next_faint_occurrence: FaintOccurrenceId,
    pub outcome: BattleOutcome,
}

#[derive(Debug, Error)]
pub enum BattleStateV2Error {
    #[error("BattleStateV2 schema version must be {expected}, got {actual}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("battle ID must be positive")]
    ZeroBattleId,
    #[error("battle turn does not match battle RNG turn")]
    BattleRngTurnMismatch { battle: TurnIndex, rng: TurnIndex },
    #[error("battle RNG state is invalid: {0}")]
    BattleRng(#[source] er_rng::phaser::RngError),
    #[error("battle format is invalid: {0}")]
    Format(#[from] crate::format::FormatTopologyError),
    #[error("field state is invalid: {0}")]
    Field(#[from] crate::field::FieldStateError),
    #[error("field conditions are invalid: {0}")]
    Conditions(#[from] crate::conditions::ConditionStateError),
    #[error("enemy Pokémon {index} is invalid: {source}")]
    Pokemon {
        index: usize,
        #[source]
        source: crate::pokemon_v2::PokemonStateV2Error,
    },
}

impl BattleStateV2 {
    pub fn validate(&self) -> Result<(), BattleStateV2Error> {
        if self.schema_version != BATTLE_STATE_SCHEMA_VERSION_V2 {
            return Err(BattleStateV2Error::SchemaVersionMismatch {
                expected: BATTLE_STATE_SCHEMA_VERSION_V2,
                actual: self.schema_version,
            });
        }
        if self.battle_id == BattleId::ZERO {
            return Err(BattleStateV2Error::ZeroBattleId);
        }
        if self.turn != self.battle_rng.turn {
            return Err(BattleStateV2Error::BattleRngTurnMismatch {
                battle: self.turn,
                rng: self.battle_rng.turn,
            });
        }
        self.battle_rng
            .validate()
            .map_err(BattleStateV2Error::BattleRng)?;
        crate::format::validate_m3_supported(&self.format)?;
        self.field.validate_for_format(&self.format)?;
        crate::conditions::validate_m3_conditions(
            &self.weather,
            &self.terrain,
            &self.arena_conditions,
            &self.global_ability_suppression,
        )?;
        for (index, pokemon) in self.enemy_party.iter().enumerate() {
            pokemon
                .validate()
                .map_err(|source| BattleStateV2Error::Pokemon { index, source })?;
        }
        Ok(())
    }

    pub fn enemy(&self, id: PokemonId) -> Option<&PokemonStateV2> {
        self.enemy_party.iter().find(|pokemon| pokemon.id == id)
    }
}

/// Borrowed complete battle world. Player records are never copied into the
/// battle state and are resolved from the game root at the access boundary.
#[derive(Debug)]
pub struct BattleWorldStateV2<'a> {
    pub player_party: &'a [PokemonStateV2],
    pub battle: &'a BattleStateV2,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedBattleWorldV2 {
    pub player_party: Vec<PokemonStateV2>,
    pub battle: BattleStateV2,
}

impl<'a> BattleWorldStateV2<'a> {
    pub fn new(player_party: &'a [PokemonStateV2], battle: &'a BattleStateV2) -> Self {
        Self {
            player_party,
            battle,
        }
    }

    pub fn resolve(&self) -> ResolvedBattleWorldV2 {
        ResolvedBattleWorldV2 {
            player_party: self.player_party.to_vec(),
            battle: self.battle.clone(),
        }
    }

    pub fn player(&self, id: PokemonId) -> Option<&'a PokemonStateV2> {
        self.player_party.iter().find(|pokemon| pokemon.id == id)
    }

    pub fn party_index(&self, index: PartyIndex) -> Option<&'a PokemonStateV2> {
        self.player_party.get(usize::from(index.get()))
    }
}
