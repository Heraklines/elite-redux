//! Typed save projections for M7 run-mode state that lives outside the battle resolver.
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const MODE_SAVE_PROJECTION_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FairyLuckSaveV1 {
    pub bonus: i64,
    pub expiry_wave: i64,
}

pub const fn fairy_luck_save_v1(bonus: i64, expiry_wave: i64) -> FairyLuckSaveV1 {
    FairyLuckSaveV1 { bonus, expiry_wave }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapNodeSaveV1 {
    pub biome: u32,
    pub revealed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapSaveV1 {
    pub nodes: Vec<MapNodeSaveV1>,
    pub travel_target: Option<u32>,
    pub fragments: u32,
    pub previous_biome: Option<u32>,
    pub biome_length: Option<u32>,
    pub biome_start_wave: u32,
    pub biome_overstay_anchor: Option<u32>,
    pub fairy_luck: FairyLuckSaveV1,
    pub biome_history: Vec<u32>,
    pub carried_weather: Option<u32>,
}

pub fn map_save_data_v1(state: &MapSaveV1) -> MapSaveV1 {
    state.clone()
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunBuffSaveV1 {
    pub source_key: String,
    pub label: String,
    pub kind: String,
    pub magnitude: i64,
    pub waves_left: Option<u32>,
}

pub fn run_buff_save_data_v1(buffs: &[RunBuffSaveV1]) -> Vec<RunBuffSaveV1> {
    buffs.to_vec()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunPacingV1 {
    Normal,
    Sprint,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunPacingProfileV1 {
    pub final_wave: u32,
    pub progression_scale: u32,
    pub checkpoint_interval: u32,
    pub major_checkpoint_interval: u32,
    pub mystery_encounter_max_wave: u32,
    pub mystery_encounter_target: u32,
    pub finale_routing_start_wave: u32,
}

pub const fn run_pacing_profile_v1(pacing: RunPacingV1) -> RunPacingProfileV1 {
    match pacing {
        RunPacingV1::Normal => RunPacingProfileV1 {
            final_wave: 200,
            progression_scale: 1,
            checkpoint_interval: 10,
            major_checkpoint_interval: 50,
            mystery_encounter_max_wave: 180,
            mystery_encounter_target: 24,
            finale_routing_start_wave: 170,
        },
        RunPacingV1::Sprint => RunPacingProfileV1 {
            final_wave: 100,
            progression_scale: 2,
            checkpoint_interval: 5,
            major_checkpoint_interval: 25,
            mystery_encounter_max_wave: 90,
            mystery_encounter_target: 16,
            finale_routing_start_wave: 85,
        },
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommunityChallengeDraftV1 {
    pub challenge_values: BTreeMap<u32, i64>,
}

pub fn save_community_challenge_draft_v1(
    draft: &CommunityChallengeDraftV1,
) -> Option<CommunityChallengeDraftV1> {
    (!draft.challenge_values.is_empty()).then(|| draft.clone())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndlessContinuationSaveV1 {
    pub wave: u32,
    pub seed: String,
    pub endless_cycle: u32,
}

pub fn endless_save_data_v1(state: &EndlessContinuationSaveV1) -> EndlessContinuationSaveV1 {
    state.clone()
}

pub fn retired_standalone_endless_save_v1(bytes: &[u8]) -> bool {
    bytes.starts_with(b"{\"version\":0,")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EnemyAiProfileV1 {
    Wild,
    Trainer,
    Boss,
}

pub const fn enemy_ai_profile_v1(profile: EnemyAiProfileV1) -> EnemyAiProfileV1 {
    profile
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShinyLabSaveV1 {
    pub available_effects: BTreeSet<String>,
    pub owned_effects: BTreeMap<String, BTreeSet<String>>,
}

pub fn ensure_shiny_lab_save_v1(save: Option<ShinyLabSaveV1>) -> ShinyLabSaveV1 {
    save.unwrap_or_default()
}

pub fn save_shiny_lab_system_v1(save: &ShinyLabSaveV1) -> ShinyLabSaveV1 {
    save.clone()
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingCacheSaveV1 {
    pub completed_waves: BTreeSet<u32>,
    pub party_species: Vec<u32>,
}

pub fn training_cache_save_data_v1(state: &TrainingCacheSaveV1) -> TrainingCacheSaveV1 {
    state.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_save_projections_clone_without_aliasing_or_hidden_state() {
        assert_eq!(
            fairy_luck_save_v1(2, 7),
            FairyLuckSaveV1 {
                bonus: 2,
                expiry_wave: 7,
            }
        );
        assert_eq!(run_pacing_profile_v1(RunPacingV1::Sprint).final_wave, 100);
        assert!(save_community_challenge_draft_v1(&CommunityChallengeDraftV1::default()).is_none());
        let buffs = vec![RunBuffSaveV1 {
            source_key: "event".to_owned(),
            label: "Event".to_owned(),
            kind: "luck".to_owned(),
            magnitude: 2,
            waves_left: Some(3),
        }];
        let mut saved = run_buff_save_data_v1(&buffs);
        saved[0].magnitude = 4;
        assert_eq!(buffs[0].magnitude, 2);
        assert!(retired_standalone_endless_save_v1(
            b"{\"version\":0,\"wave\":20}"
        ));
        assert!(!retired_standalone_endless_save_v1(b"{\"version\":1}"));
    }
}
