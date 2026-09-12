//! Fresh source-owned MAX_FRIENDSHIP reward state; not an inferred legacy dex.
use er_types::{SafeU53, battle_ids::SpeciesId};
use serde::{Deserialize, Serialize};

use super::{CurrentFriendshipProfileError, MAX_CURRENT_FRIENDSHIP_ACCOUNTS_V1};

pub const CURRENT_FRIENDSHIP_RIBBON_V1: u64 = 0x2000_0000;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipRibbonV1 {
    pub species: SpeciesId,
    pub bits: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipRewardProfileV1 {
    pub schema_version: u32,
    /// Actual fresh account initializer is zero; LevelUp.start raises this
    /// high-water before evaluating level achievements and calculating stats.
    pub highest_level: SafeU53,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub achievements: Option<crate::current_achievement_execution::CurrentAchievementUnlocksV1>,
    /// Source GameStats fresh counter, advanced once by actual Victory.start.
    pub pokemon_defeated: SafeU53,
    /// Actual Date.now input. Presence implements source Object.hasOwn:
    /// timestamp zero is already unlocked and cannot grant again.
    pub max_friendship_unlocked_at: Option<i64>,
    /// Sparse nonzero entries; fresh initDexData gives every allSpecies entry
    /// RibbonData(0). This cut can add only the actual friendship OR flag.
    pub ribbons: Vec<CurrentFriendshipRibbonV1>,
    /// Actual packed bytes, preserving the qualified category-index aliases.
    pub cosmetic_bits: Vec<u8>,
}

impl CurrentFriendshipRewardProfileV1 {
    pub fn fresh() -> Self {
        // GameData640/652 and initDexData6851 at pinned399d: {}, [] and 0.
        Self {
            schema_version: 1,
            highest_level: SafeU53::ZERO,
            achievements: Some(crate::current_achievement_execution::CurrentAchievementUnlocksV1::fresh()),
            pokemon_defeated: SafeU53::ZERO,
            max_friendship_unlocked_at: None,
            ribbons: Vec::new(),
            cosmetic_bits: Vec::new(),
        }
    }

    pub fn max_is_unlocked(&self) -> bool {
        self.max_friendship_unlocked_at.is_some()
    }

    pub fn validate(&self) -> Result<(), CurrentFriendshipProfileError> {
        if self.schema_version != 1
            || self.achievements.as_ref().is_some_and(|value| !value.valid())
            || self.max_friendship_unlocked_at.is_some_and(|date| {
                !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&date)
            })
            || self.ribbons.len() > MAX_CURRENT_FRIENDSHIP_ACCOUNTS_V1
            || self.ribbons.iter().any(|ribbon| {
                ribbon.species.get() == SafeU53::ZERO
                    || ribbon.bits.get() != CURRENT_FRIENDSHIP_RIBBON_V1
            })
            || self
                .ribbons
                .windows(2)
                .any(|pair| pair[0].species >= pair[1].species)
        {
            return Err(CurrentFriendshipProfileError);
        }
        match self.max_friendship_unlocked_at {
            None if self.ribbons.is_empty() && self.cosmetic_bits.is_empty() => Ok(()),
            Some(_)
                if !self.ribbons.is_empty()
                    && self.cosmetic_bits.as_slice() == [0, 0, 0, 0, 128, 1] =>
            {
                Ok(())
            }
            _ => Err(CurrentFriendshipProfileError),
        }
    }
}
