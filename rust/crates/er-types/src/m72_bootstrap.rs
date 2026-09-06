//! Core-owned M7.2 run-bootstrap identities and actions.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::battle_ids::{GameModeId, PokemonId};
use crate::{SafeU53, SeatId};

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SetupChoiceIdV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum SetupChoiceValueV1 {
    Boolean(bool),
    Integer(i64),
    Identity(String),
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunDifficultyV1 {
    Youngster,
    Ace,
    Elite,
    Hell,
    Mystery,
}

impl RunDifficultyV1 {
    pub const fn production(self) -> bool {
        !matches!(self, Self::Mystery)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StarterSelectionV1 {
    pub pokemon_id: PokemonId,
    pub species_id: SafeU53,
    pub form_index: u16,
    pub ability_index: u8,
    pub cost: u16,
    pub owner_seat: SeatId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BootstrapActionV1 {
    OpenNewGame,
    OpenExistingSaves,
    SelectExistingSave(String),
    SelectMode(GameModeId),
    SelectChallenge {
        id: SetupChoiceIdV1,
        value: SetupChoiceValueV1,
    },
    SelectStarter(StarterSelectionV1),
    RemoveStarter(PokemonId),
    ConfirmStarters,
    SelectDifficulty(RunDifficultyV1),
    SelectSaveSlot(String),
    Confirm,
    Cancel,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BootstrapActionErrorV1 {
    #[error("bootstrap identity is empty")]
    EmptyIdentity,
    #[error("starter cost is zero")]
    ZeroStarterCost,
    #[error("Mystery difficulty is developer-only")]
    DeveloperOnlyDifficulty,
}

impl BootstrapActionV1 {
    pub fn validate(&self, developer_mode: bool) -> Result<(), BootstrapActionErrorV1> {
        match self {
            Self::SelectChallenge { id, value } => {
                if id.0.is_empty()
                    || matches!(value, SetupChoiceValueV1::Identity(value) if value.is_empty())
                {
                    return Err(BootstrapActionErrorV1::EmptyIdentity);
                }
            }
            Self::SelectStarter(starter) if starter.cost == 0 => {
                return Err(BootstrapActionErrorV1::ZeroStarterCost);
            }
            Self::SelectDifficulty(RunDifficultyV1::Mystery) if !developer_mode => {
                return Err(BootstrapActionErrorV1::DeveloperOnlyDifficulty);
            }
            Self::SelectSaveSlot(slot) if slot.is_empty() => {
                return Err(BootstrapActionErrorV1::EmptyIdentity);
            }
            Self::SelectExistingSave(slot) if slot.is_empty() || slot.len() > 256 => {
                return Err(BootstrapActionErrorV1::EmptyIdentity);
            }
            _ => {}
        }
        Ok(())
    }
}
