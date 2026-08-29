//! Closed M4 run-stage, surface, and action vocabulary.
//!
//! This module intentionally depends only on `er-types` identifiers. Content
//! definitions and state containers live in higher crates; an action can carry
//! only the stable identities and values admitted by the M4 contract.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

use crate::battle_ids::{MoveId, MoveSlotIndex, PokemonId};
use crate::run_ids::{BiomeId, Money, RouteNodeId, RunOfferId, RunStockId};

/// The complete run lifecycle vocabulary. There is no implicit or fallback
/// stage: contradictory stage data is rejected by the state validator.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunStage {
    Battle,
    AwaitingWaveAdvance,
    Progression,
    Surface,
    Complete,
}

/// Terminal and non-terminal run outcomes.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunOutcome {
    InProgress,
    Victory,
    Defeat,
}

/// A run surface kind used in retained control and authority material.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunSurfaceKind {
    MoveLearn,
    RewardShop,
    BiomeMarket,
    Crossroads,
    BiomeSelect,
}

/// TypeScript uses the five numeric modifier tiers as stable content values.
/// Encoding the discriminant as a number keeps canonical material independent
/// of Rust variant spelling while still rejecting every value outside 0..=4.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum ModifierTier {
    Common = 0,
    Great = 1,
    Ultra = 2,
    Rogue = 3,
    Master = 4,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ModifierTierError {
    #[error("modifier tier {value} is outside 0..=4")]
    OutOfRange { value: u8 },
}

impl ModifierTier {
    pub const fn get(self) -> u8 {
        self as u8
    }

    pub const fn into_inner(self) -> u8 {
        self as u8
    }

    pub fn new(value: u8) -> Result<Self, ModifierTierError> {
        Self::try_from(value)
    }
}

impl TryFrom<u8> for ModifierTier {
    type Error = ModifierTierError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Common),
            1 => Ok(Self::Great),
            2 => Ok(Self::Ultra),
            3 => Ok(Self::Rogue),
            4 => Ok(Self::Master),
            value => Err(ModifierTierError::OutOfRange { value }),
        }
    }
}

impl From<ModifierTier> for u8 {
    fn from(value: ModifierTier) -> Self {
        value.get()
    }
}

impl Serialize for ModifierTier {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(self.get())
    }
}

impl<'de> Deserialize<'de> for ModifierTier {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u8::deserialize(deserializer)?;
        Self::try_from(value).map_err(serde::de::Error::custom)
    }
}

/// One move-learning menu decision. A candidate chooses the offered move;
/// replacement chooses a stable Pokémon/slot; Undo and Cancel are terminal
/// menu options with no hidden payload.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LearnMoveDecision {
    Candidate { move_id: MoveId },
    Replace { slot: MoveSlotIndex },
    Undo,
    Cancel,
}

/// Regular reward/shop actions. Reroll and lock are deliberately absent from
/// the biome market action vocabulary.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RewardAction {
    SelectFree {
        offer: RunOfferId,
        target: Option<PokemonId>,
    },
    Skip,
    Buy {
        offer: RunOfferId,
        target: Option<PokemonId>,
        price: Money,
    },
    Reroll,
    ToggleLock {
        tier: ModifierTier,
    },
}

/// Biome market has buy and leave only; it never acquires reward-shop lock or
/// reroll actions.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BiomeMarketAction {
    Buy {
        stock: RunStockId,
        target: Option<PokemonId>,
        price: Money,
    },
    Leave,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CrossroadsAction {
    Stay,
    MoveOn,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeSelectAction {
    pub route_node: RouteNodeId,
    pub biome: BiomeId,
}

/// One typed interaction action. The tag is explicit on the wire so a payload
/// can never be interpreted as another surface's action.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunSurfaceAction {
    LearnMove(LearnMoveDecision),
    Reward(RewardAction),
    BiomeMarket(BiomeMarketAction),
    Crossroads(CrossroadsAction),
    BiomeSelect(BiomeSelectAction),
}
