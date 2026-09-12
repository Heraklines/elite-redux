//! Explicit source EggData ownership. Historical absence remains unknown.
use crate::current_friendship_profile::CurrentFriendshipProfileError;
use er_types::{SafeU53, battle_ids::SpeciesId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Exact ten fields persisted by cached399d system/egg-data.ts. This is storage
/// shape only; it never authorizes an arbitrary reward/random construction.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentSourceEggV1 {
    pub id: SafeU53,
    pub tier: u8,
    pub source_type: u8,
    pub hatch_waves: i32,
    pub timestamp: i64,
    pub variant_tier: u8,
    pub is_shiny: bool,
    pub species: SpeciesId,
    pub egg_move_index: u8,
    pub override_hidden_ability: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAutoEggRestockV1 {
    pub enabled: bool,
    pub target_count: u32,
    pub gacha_type: u8,
    /// Source VoucherType order REGULAR, PLUS, PREMIUM, GOLDEN.
    pub per_voucher: [bool; 4],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentEggAccountV1 {
    pub eggs: Vec<CurrentSourceEggV1>,
    pub auto_restock: CurrentAutoEggRestockV1,
    pub voucher_counts: [SafeU53; 4],
    pub unlock_pity: [SafeU53; 4],
    pub same_species_counters: BTreeMap<u32, SafeU53>,
}

impl CurrentEggAccountV1 {
    /// Called only by the explicit fresh full-account constructor, never restore.
    pub fn fresh() -> Self {
        Self {
            eggs: Vec::new(),
            auto_restock: CurrentAutoEggRestockV1 {
                enabled: false,
                target_count: 50,
                gacha_type: 1,
                per_voucher: [true, true, true, false],
            },
            voucher_counts: [SafeU53::ZERO; 4],
            unlock_pity: [SafeU53::ZERO; 4],
            same_species_counters: BTreeMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), CurrentFriendshipProfileError> {
        if self.eggs.len() > 10_000
            || self.auto_restock.target_count > 10_000
            || self.auto_restock.gacha_type > 3
            || self.same_species_counters.len() > 4_096
            || self.same_species_counters.contains_key(&0)
            || self.unlock_pity.iter().any(|pity| pity.get() > 10)
            || self.eggs.iter().any(|egg| {
                egg.tier > 3
                    || egg.source_type > 5
                    || egg.variant_tier > 2
                    || egg.egg_move_index > 3
                    || egg.species.get() == SafeU53::ZERO
                    || !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&egg.timestamp)
            })
        {
            return Err(CurrentFriendshipProfileError);
        }
        Ok(())
    }
}
