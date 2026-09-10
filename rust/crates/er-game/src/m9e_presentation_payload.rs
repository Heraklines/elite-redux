//! Exact presentation parameters retained with the existing event identity.
use er_types::SafeU53;
use er_types::battle_ids::{AbilityId, MoveId, PokemonId, SpeciesId};
use serde::{Deserialize, Serialize};

use super::GameMaterialV6Error;
use crate::m9e_content_v2::{PresentationCueFamilyV1, PresentationSemanticIdV1};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GamePresentationAchievementV1 {
    MaxFriendship,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum GamePresentationPayloadV1 {
    StarterCandy {
        root: SpeciesId,
        /// Source displays the complete scaled request, even when saturated.
        scaled_count: i64,
        before_candy: SafeU53,
        after_candy: SafeU53,
    },
    AchievementUnlocked {
        achievement: GamePresentationAchievementV1,
        utc_milliseconds: i64,
    },
    AbilityShown {
        holder: PokemonId,
        ability: AbilityId,
        innate_slot: Option<u8>,
    },
    HpRestored {
        holder: PokemonId,
        before: u32,
        after: u32,
        requested_heal: u32,
    },
    AbilityHidden {
        holder: PokemonId,
        ability: AbilityId,
        innate_slot: Option<u8>,
    },
    MoveNoEffect {
        holder: PokemonId,
        move_id: MoveId,
    },
    ExperienceGained {
        pokemon: PokemonId,
        experience: er_types::run_ids::Experience,
    },
    LevelUp {
        pokemon: PokemonId,
        previous_level: u16,
        new_level: u16,
    },
}

impl GamePresentationPayloadV1 {
    pub fn validate(&self, semantic: PresentationSemanticIdV1) -> Result<(), GameMaterialV6Error> {
        let (family, valid) = match self {
            Self::StarterCandy {
                root,
                scaled_count,
                before_candy,
                after_candy,
            } => (
                PresentationCueFamilyV1::Reward,
                root.get() != SafeU53::ZERO
                    && scaled_count.unsigned_abs() <= 9_007_199_254_740_991
                    && before_candy.get() < 9_999
                    && after_candy.get() <= 9_999,
            ),
            Self::AchievementUnlocked {
                utc_milliseconds, ..
            } => (
                PresentationCueFamilyV1::Reward,
                (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(utc_milliseconds),
            ),
            Self::AbilityShown {
                holder,
                ability,
                innate_slot,
            }
            | Self::AbilityHidden {
                holder,
                ability,
                innate_slot,
            } => (
                PresentationCueFamilyV1::Ability,
                holder.get() != SafeU53::ZERO
                    && ability.get() != SafeU53::ZERO
                    && innate_slot.is_none_or(|slot| slot < 3),
            ),
            Self::HpRestored {
                holder,
                before,
                after,
                requested_heal,
            } => (
                PresentationCueFamilyV1::Hp,
                holder.get() != SafeU53::ZERO
                    && *after > *before
                    && *requested_heal > 0
                    && after - before <= *requested_heal,
            ),
            Self::MoveNoEffect { holder, move_id } => (
                PresentationCueFamilyV1::Move,
                holder.get() != SafeU53::ZERO && move_id.get() != SafeU53::ZERO,
            ),
            Self::ExperienceGained {
                pokemon,
                experience,
            } => (
                PresentationCueFamilyV1::Progression,
                pokemon.get() != SafeU53::ZERO && experience.get() != SafeU53::ZERO,
            ),
            Self::LevelUp {
                pokemon,
                previous_level,
                new_level,
            } => (
                PresentationCueFamilyV1::Progression,
                pokemon.get() != SafeU53::ZERO
                    && *previous_level > 0
                    && *new_level > *previous_level,
            ),
        };
        if !valid || semantic != PresentationSemanticIdV1::Cue(family) {
            return Err(GameMaterialV6Error::Invalid);
        }
        Ok(())
    }
}
