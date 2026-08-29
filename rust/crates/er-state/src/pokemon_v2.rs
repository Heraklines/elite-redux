//! Versioned M4 Pokémon state.
//!
//! The V2 record is deliberately a parallel migration target. The M3 record
//! remains untouched and is not used as a deserialization fallback.

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use er_types::SeatId;
use er_types::battle_ids::{PokemonId, SpeciesId};
use er_types::battle_model::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonTyping, StatStages, StatusState,
};
use er_types::run_ids::{Experience, GrowthRateId, NatureId};

use crate::pokemon::{
    AbilityLoadoutValidationError, MOVE_SLOT_COUNT, PokemonStateError, StatStagesValidationError,
    StatusValidationError, TypingValidationError, validate_ability_loadout,
    validate_m3_ability_loadout, validate_m3_status_state, validate_m3_typing,
    validate_move_slot_metadata, validate_stat_stages, validate_status_state, validate_typing,
};

pub const POKEMON_STATE_SCHEMA_VERSION_V2: u32 = 2;

/// A bounded individual value. IVs are canonical values, not derived data.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Iv(u8);

impl Iv {
    pub const MAX: u8 = 31;

    pub const fn new(value: u8) -> Result<Self, IvError> {
        if value > Self::MAX {
            Err(IvError::OutOfRange { value })
        } else {
            Ok(Self(value))
        }
    }

    pub const fn get(self) -> u8 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum IvError {
    #[error("IV {value} is outside 0..=31")]
    OutOfRange { value: u8 },
}

impl TryFrom<u8> for Iv {
    type Error = IvError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

/// Permanent stat additions retained by the V2 progression record.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PermanentStatBonuses {
    pub hp: u32,
    pub attack: u32,
    pub defense: u32,
    pub special_attack: u32,
    pub special_defense: u32,
    pub speed: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonProgressionState {
    pub experience: Experience,
    pub growth_rate: GrowthRateId,
    pub ivs: [Iv; 6],
    pub nature: NatureId,
    pub effective_nature: NatureId,
    pub friendship: u16,
    pub permanent_bonuses: PermanentStatBonuses,
    pub pause_evolutions: bool,
}

impl PokemonProgressionState {
    pub fn validate(&self) -> Result<(), PokemonProgressionValidationError> {
        for iv in self.ivs {
            if iv.get() > Iv::MAX {
                return Err(PokemonProgressionValidationError::InvalidIv { value: iv.get() });
            }
        }
        if !matches!(self.growth_rate.get(), 2 | 3) {
            return Err(PokemonProgressionValidationError::UnsupportedGrowthRate {
                value: self.growth_rate.get(),
            });
        }
        if !matches!(self.nature.get(), 0 | 3 | 10 | 15 | 24) {
            return Err(PokemonProgressionValidationError::UnsupportedNature {
                value: self.nature.get(),
            });
        }
        if !matches!(self.effective_nature.get(), 0 | 3 | 10 | 15 | 24) {
            return Err(
                PokemonProgressionValidationError::UnsupportedEffectiveNature {
                    value: self.effective_nature.get(),
                },
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PokemonProgressionValidationError {
    #[error("IV {value} is outside 0..=31")]
    InvalidIv { value: u8 },
    #[error("growth rate {value} is outside the selected M4 capability")]
    UnsupportedGrowthRate { value: u8 },
    #[error("nature {value} is outside the selected M4 capability")]
    UnsupportedNature { value: u8 },
    #[error("effective nature {value} is outside the selected M4 capability")]
    UnsupportedEffectiveNature { value: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonStateV2 {
    pub schema_version: u32,
    pub id: PokemonId,
    pub owner_seat: Option<SeatId>,
    pub species_id: SpeciesId,
    pub form_index: u16,
    pub level: u16,
    pub types: PokemonTyping,
    pub stats: BattleStats,
    pub hp: u32,
    pub max_hp: u32,
    pub status: StatusState,
    pub stat_stages: StatStages,
    pub moves: [Option<MoveSlotState>; MOVE_SLOT_COUNT],
    pub abilities: AbilityLoadout,
    pub fainted: bool,
    pub progression: PokemonProgressionState,
}

impl<'de> Deserialize<'de> for PokemonStateV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PokemonStateV2Wire {
            schema_version: u32,
            id: PokemonId,
            owner_seat: Option<SeatId>,
            species_id: SpeciesId,
            form_index: u16,
            level: u16,
            types: PokemonTyping,
            stats: BattleStats,
            hp: u32,
            max_hp: u32,
            status: StatusState,
            stat_stages: StatStages,
            moves: [Option<MoveSlotState>; MOVE_SLOT_COUNT],
            abilities: AbilityLoadout,
            fainted: bool,
            progression: PokemonProgressionState,
        }

        let wire = PokemonStateV2Wire::deserialize(deserializer)?;
        let state = Self {
            schema_version: wire.schema_version,
            id: wire.id,
            owner_seat: wire.owner_seat,
            species_id: wire.species_id,
            form_index: wire.form_index,
            level: wire.level,
            types: wire.types,
            stats: wire.stats,
            hp: wire.hp,
            max_hp: wire.max_hp,
            status: wire.status,
            stat_stages: wire.stat_stages,
            moves: wire.moves,
            abilities: wire.abilities,
            fainted: wire.fainted,
            progression: wire.progression,
        };
        state.validate().map_err(serde::de::Error::custom)?;
        Ok(state)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PokemonStateV2Error {
    #[error("PokemonStateV2 schema version must be {expected}, got {actual}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("level must be positive")]
    ZeroLevel,
    #[error("PokemonStateV2 has invalid M3 fields: {0}")]
    M3(#[from] PokemonStateError),
    #[error("progression state is invalid: {0}")]
    Progression(#[from] PokemonProgressionValidationError),
    #[error("typing is invalid: {0}")]
    Typing(#[from] TypingValidationError),
    #[error("status is invalid: {0}")]
    Status(#[from] StatusValidationError),
    #[error("stat stages are invalid: {0}")]
    StatStages(#[from] StatStagesValidationError),
    #[error("ability loadout is invalid: {0}")]
    AbilityLoadout(#[from] AbilityLoadoutValidationError),
}

impl PokemonStateV2 {
    pub fn validate(&self) -> Result<(), PokemonStateV2Error> {
        if self.schema_version != POKEMON_STATE_SCHEMA_VERSION_V2 {
            return Err(PokemonStateV2Error::SchemaVersionMismatch {
                expected: POKEMON_STATE_SCHEMA_VERSION_V2,
                actual: self.schema_version,
            });
        }
        if self.level == 0 {
            return Err(PokemonStateV2Error::ZeroLevel);
        }

        validate_typing(&self.types)?;
        validate_status_state(&self.status)?;
        validate_stat_stages(&self.stat_stages)?;
        validate_ability_loadout(&self.abilities)?;
        validate_m3_typing(&self.types)?;
        validate_m3_status_state(&self.status)?;
        validate_m3_ability_loadout(&self.abilities)?;

        if self.max_hp == 0 {
            return Err(PokemonStateV2Error::M3(PokemonStateError::ZeroMaxHp));
        }
        if self.hp > self.max_hp {
            return Err(PokemonStateV2Error::M3(
                PokemonStateError::HpExceedsMaximum {
                    hp: self.hp,
                    max_hp: self.max_hp,
                },
            ));
        }
        if self.fainted != (self.hp == 0) {
            return Err(PokemonStateV2Error::M3(
                PokemonStateError::FaintedMismatch {
                    hp: self.hp,
                    fainted: self.fainted,
                },
            ));
        }
        if self.stats.hp != self.max_hp {
            return Err(PokemonStateV2Error::M3(
                PokemonStateError::StatsHpMismatch {
                    stats_hp: self.stats.hp,
                    max_hp: self.max_hp,
                },
            ));
        }
        for (slot, move_slot) in self.moves.iter().enumerate() {
            if let Some(move_slot) = move_slot {
                validate_move_slot_metadata(move_slot).map_err(|source| {
                    PokemonStateV2Error::M3(PokemonStateError::MoveSlot { slot, source })
                })?;
            }
        }
        self.progression.validate()?;
        Ok(())
    }
}

pub use er_types::battle_ids::{MoveSlotIndex, PartyIndex};
pub use er_types::battle_model::{BattleStat, PokemonType, StatusKind};
