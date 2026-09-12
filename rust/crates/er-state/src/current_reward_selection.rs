//! Retained first actual source reward selection. Snapshots never nominate a
//! generated offer: content-aware validation regenerates this complete record.
use crate::current_reward_run::CurrentRewardRunV1;
use crate::m7_state::PokemonStateV5;
use er_types::battle_ids::PokemonId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRewardSelectionV1 {
    pub offers: Vec<CurrentRewardOfferV1>,
    pub rng_before: String,
    pub rng_audit: Vec<er_rng::audit::RngDraw>,
    pub rng_regenerated: String,
    pub rng_after: String,
    /// Complete pre-reward party, not a mutable substitute for the retained XP
    /// endpoint. XP validates this preimage; reward replay binds the live party.
    pub party_before: Vec<PokemonStateV5>,
    pub run_before: CurrentRewardRunV1,
    pub stage: CurrentRewardStageV1,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRewardOfferV1 {
    pub source_id: String,
    pub name: String,
    pub group: Option<String>,
    pub tier: u16,
    pub upgrade_count: u16,
    pub args: Option<CurrentRewardArgsV1>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "generator",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum CurrentRewardArgsV1 {
    Berry { kind: u8 },
    TemporaryStat { stat: u8 },
    BaseStat { stat: u8 },
    Mint { nature: u8 },
    AttackType { kind: u8 },
    Tera { kind: u8 },
    EvolutionItem { item: u16 },
    SpeciesItem { key: CurrentRewardSpeciesItemV1 },
    FormChangeItem { item: u16 },
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentRewardSpeciesItemV1 {
    LightBall,
    ThickClub,
    MetalPowder,
    QuickPowder,
    DeepSeaScale,
    DeepSeaTooth,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CurrentRewardStageV1 {
    Choice,
    Holder {
        offer: u8,
    },
    /// Apply was accepted exactly once. Completing this receipt does not claim
    /// execution of the subsequent NewBattle/encounter descendants.
    Applied {
        offer: u8,
        holder: Option<PokemonId>,
    },
}
impl CurrentRewardSelectionV1 {
    pub fn structurally_valid(&self) -> bool {
        (1..=3).contains(&self.offers.len())
            && self.party_before.len() == 1
            && self.run_before.valid()
            && self.rng_audit.len() <= 4096
            && self.rng_audit.iter().all(|draw| draw.validate().is_ok())
            && [&self.rng_before, &self.rng_regenerated, &self.rng_after]
                .iter()
                .all(|s| s.starts_with("!rnd,") && s.len() <= 512)
            && self.offers.iter().all(|o| {
                !o.source_id.is_empty()
                    && o.source_id.len() <= 128
                    && !o.name.is_empty()
                    && o.name.len() <= 256
                    && o.tier <= 4
                    && o.upgrade_count <= 4096
                    && o.group.as_ref().is_none_or(|g| g.len() <= 128)
            })
            && match &self.stage {
                CurrentRewardStageV1::Choice => true,
                CurrentRewardStageV1::Holder { offer }
                | CurrentRewardStageV1::Applied { offer, .. } => {
                    usize::from(*offer) < self.offers.len()
                }
            }
    }
}
/// Initial source ownership cannot acquire inventory merely by restoring a
/// changed snapshot. Historical None remains unknown; post-selection changes
/// require the single retained receipt and its content-aware effect replay.
pub fn initial_inventory_valid(
    inventory: Option<&CurrentRewardRunV1>,
    receipts: &[&CurrentRewardSelectionV1],
) -> bool {
    let fresh = CurrentRewardRunV1::fresh_ordinary_with_startup_map();
    match (inventory, receipts) {
        (None, []) => true,
        (Some(live), []) => live == &fresh,
        (Some(live), [receipt]) => {
            live.valid()
                && receipt.structurally_valid()
                && receipt.run_before == fresh
                && (matches!(receipt.stage, CurrentRewardStageV1::Applied { .. })
                    || live == &receipt.run_before)
        }
        _ => false,
    }
}
