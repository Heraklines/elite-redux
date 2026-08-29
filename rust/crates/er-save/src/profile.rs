//! Canonical account-local profile preferences and summary statistics.
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const PROFILE_PERSISTENCE_SCHEMA_VERSION_V1: u32 = 1;
pub const LEADERBOARD_SAVE_STATS_VERSION_V1: u32 = 1;
pub const RUN_HISTORY_LIMIT_V1: usize = 25;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StarterPreferenceV1 {
    pub species_id: u32,
    pub attributes: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedStarterV1 {
    pub species_id: u32,
    pub form_index: u16,
    pub ability_index: u8,
    pub passive: bool,
    pub nature_id: u16,
    pub move_ids: Vec<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedChallengeV1 {
    pub id: u32,
    pub value: i64,
    pub severity: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SavedDifficultyV1 {
    Youngster,
    Hell,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedFunModeConfigV1 {
    pub difficulty: SavedDifficultyV1,
    pub debug_mode: bool,
    pub randomize_pokemon: bool,
    pub randomize_types: bool,
    pub randomize_abilities: bool,
    pub randomize_level_up_moves: bool,
    pub mega_mode: bool,
    pub mega_mix_mode: bool,
    pub shuffle_stats: bool,
    pub shuffle_evolutions: bool,
    pub item_chaos: bool,
    pub weather_roulette: bool,
    pub scramble_moves: bool,
    pub ability_avalanche: bool,
    pub moody_mode: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunHistoryEntryV1 {
    pub timestamp_ms: u64,
    pub session_bytes: Vec<u8>,
    pub victory: bool,
    pub favorite: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShowdownTeamPresetV1 {
    pub name: String,
    pub folder: Option<String>,
    pub team_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfilePersistenceV1 {
    pub schema_version: u32,
    pub starter_preferences: BTreeMap<u32, StarterPreferenceV1>,
    pub last_team: Option<Vec<SavedStarterV1>>,
    pub last_challenges: Option<Vec<SavedChallengeV1>>,
    pub last_fun_mode: Option<SavedFunModeConfigV1>,
    pub settings: BTreeMap<String, i64>,
    pub control_settings: BTreeMap<String, BTreeMap<String, i64>>,
    pub mapping_configs: BTreeMap<String, Vec<u8>>,
    pub tutorial_flags: BTreeMap<String, bool>,
    pub seen_dialogues: BTreeSet<String>,
    pub run_history: BTreeMap<u64, RunHistoryEntryV1>,
    pub showdown_team_presets: Vec<ShowdownTeamPresetV1>,
}

impl Default for ProfilePersistenceV1 {
    fn default() -> Self {
        Self {
            schema_version: PROFILE_PERSISTENCE_SCHEMA_VERSION_V1,
            starter_preferences: BTreeMap::new(),
            last_team: None,
            last_challenges: None,
            last_fun_mode: None,
            settings: BTreeMap::new(),
            control_settings: BTreeMap::new(),
            mapping_configs: BTreeMap::new(),
            tutorial_flags: BTreeMap::new(),
            seen_dialogues: BTreeSet::new(),
            run_history: BTreeMap::new(),
            showdown_team_presets: Vec::new(),
        }
    }
}

impl ProfilePersistenceV1 {
    pub fn save_starter_preferences(
        &mut self,
        preferences: BTreeMap<u32, StarterPreferenceV1>,
    ) -> bool {
        let filtered = preferences
            .into_iter()
            .filter(|(_, value)| !value.attributes.is_empty())
            .collect::<BTreeMap<_, _>>();
        if filtered.is_empty() || filtered == self.starter_preferences {
            return false;
        }
        self.starter_preferences = filtered;
        true
    }

    pub fn save_last_team(&mut self, starters: Vec<SavedStarterV1>) -> bool {
        if starters.is_empty() {
            return false;
        }
        self.last_team = Some(starters);
        true
    }

    pub fn save_last_challenges(&mut self, challenges: &[SavedChallengeV1]) -> bool {
        let active = challenges
            .iter()
            .filter(|challenge| challenge.value != 0)
            .cloned()
            .collect::<Vec<_>>();
        if active.is_empty() {
            return false;
        }
        self.last_challenges = Some(active);
        true
    }

    pub fn save_last_fun_mode(&mut self, config: SavedFunModeConfigV1) {
        self.last_fun_mode = Some(config);
    }

    pub fn save_setting(&mut self, setting: String, value_index: i64) -> bool {
        if setting.is_empty() {
            return false;
        }
        self.settings.insert(setting, value_index);
        true
    }

    pub fn save_control_setting(
        &mut self,
        storage_key: String,
        setting: String,
        value_index: i64,
    ) -> bool {
        if storage_key.is_empty() || setting.is_empty() {
            return false;
        }
        self.control_settings
            .entry(storage_key)
            .or_default()
            .insert(setting, value_index);
        true
    }

    pub fn save_mapping_config(&mut self, device_name: &str, custom_bytes: Vec<u8>) -> bool {
        if device_name.is_empty() {
            return false;
        }
        self.mapping_configs
            .insert(device_name.to_lowercase(), custom_bytes);
        true
    }

    pub fn save_tutorial_flag(&mut self, tutorial: String, status: bool) -> bool {
        if tutorial.is_empty() {
            return false;
        }
        self.tutorial_flags.insert(tutorial, status);
        true
    }

    pub fn save_seen_dialogue(&mut self, dialogue: String) -> bool {
        !dialogue.is_empty() && self.seen_dialogues.insert(dialogue)
    }

    pub fn save_run_history(&mut self, entry: RunHistoryEntryV1) {
        while self.run_history.len() >= RUN_HISTORY_LIMIT_V1 {
            let Some(oldest) = self
                .run_history
                .first_key_value()
                .map(|(timestamp, _)| *timestamp)
            else {
                break;
            };
            self.run_history.remove(&oldest);
        }
        self.run_history.insert(entry.timestamp_ms, entry);
    }

    pub fn save_showdown_team_preset(
        &mut self,
        preset: ShowdownTeamPresetV1,
        index: Option<usize>,
    ) -> usize {
        if let Some(index) = index.filter(|index| *index < self.showdown_team_presets.len()) {
            let preserved_folder = self.showdown_team_presets[index].folder.clone();
            self.showdown_team_presets[index] = ShowdownTeamPresetV1 {
                folder: preserved_folder,
                ..preset
            };
            index
        } else {
            self.showdown_team_presets.push(ShowdownTeamPresetV1 {
                folder: None,
                ..preset
            });
            self.showdown_team_presets.len() - 1
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeaderboardSaveStatsInputV1 {
    pub achievement_count: i64,
    pub achievement_points: i64,
    pub ribbons: i64,
    pub sessions_won: i64,
    pub shiny_species: BTreeSet<u32>,
    pub black_shiny_species: BTreeSet<u32>,
    pub shiny_caught: i64,
    pub shiny_hatched: i64,
    pub shiny_lab_effects: BTreeSet<String>,
    pub relic_kinds_acquired: Vec<String>,
    pub eggs_pulled: i64,
    pub highest_damage: i64,
    pub highest_heal: i64,
    pub black_market_runs: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeaderboardSaveStatsV1 {
    pub version: u32,
    pub achievement_count: u64,
    pub achievement_points: u64,
    pub ribbons: u64,
    pub sessions_won: u64,
    pub shiny_species: u64,
    pub black_shiny_species: u64,
    pub shiny_caught: u64,
    pub shiny_hatched: u64,
    pub shiny_lab_effects: u64,
    pub unique_relics: u64,
    pub eggs_pulled: u64,
    pub highest_damage: u64,
    pub highest_heal: u64,
    pub black_market_runs: u64,
}

pub const fn non_negative_integer_v1(value: i64) -> u64 {
    if value < 0 { 0 } else { value as u64 }
}

pub fn build_leaderboard_save_stats_v1(
    input: &LeaderboardSaveStatsInputV1,
) -> LeaderboardSaveStatsV1 {
    let unique_relics = input
        .relic_kinds_acquired
        .iter()
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .len() as u64;
    LeaderboardSaveStatsV1 {
        version: LEADERBOARD_SAVE_STATS_VERSION_V1,
        achievement_count: non_negative_integer_v1(input.achievement_count),
        achievement_points: non_negative_integer_v1(input.achievement_points),
        ribbons: non_negative_integer_v1(input.ribbons),
        sessions_won: non_negative_integer_v1(input.sessions_won),
        shiny_species: input.shiny_species.len() as u64,
        black_shiny_species: input.black_shiny_species.len() as u64,
        shiny_caught: non_negative_integer_v1(input.shiny_caught),
        shiny_hatched: non_negative_integer_v1(input.shiny_hatched),
        shiny_lab_effects: input.shiny_lab_effects.len() as u64,
        unique_relics,
        eggs_pulled: non_negative_integer_v1(input.eggs_pulled),
        highest_damage: non_negative_integer_v1(input.highest_damage),
        highest_heal: non_negative_integer_v1(input.highest_heal),
        black_market_runs: non_negative_integer_v1(input.black_market_runs),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_preferences_filter_and_history_bound_match_oracle() {
        let mut profile = ProfilePersistenceV1::default();
        assert!(!profile.save_starter_preferences(BTreeMap::new()));
        assert!(!profile.save_last_team(Vec::new()));
        assert!(!profile.save_last_challenges(&[SavedChallengeV1 {
            id: 1,
            value: 0,
            severity: 2,
        }]));
        assert!(profile.save_last_challenges(&[
            SavedChallengeV1 {
                id: 1,
                value: 0,
                severity: 2,
            },
            SavedChallengeV1 {
                id: 2,
                value: 3,
                severity: 4,
            },
        ]));
        assert_eq!(
            profile.last_challenges.as_ref().expect("challenges").len(),
            1
        );
        assert!(profile.save_seen_dialogue("intro".to_owned()));
        assert!(!profile.save_seen_dialogue("intro".to_owned()));
        assert!(profile.save_mapping_config("GAMEPAD", vec![1, 2]));
        assert!(profile.mapping_configs.contains_key("gamepad"));
        for timestamp_ms in 0..=RUN_HISTORY_LIMIT_V1 as u64 {
            profile.save_run_history(RunHistoryEntryV1 {
                timestamp_ms,
                session_bytes: vec![timestamp_ms as u8],
                victory: false,
                favorite: false,
            });
        }
        assert_eq!(profile.run_history.len(), RUN_HISTORY_LIMIT_V1);
        assert!(!profile.run_history.contains_key(&0));
    }

    #[test]
    fn leaderboard_stats_are_non_negative_and_relics_unique() {
        let stats = build_leaderboard_save_stats_v1(&LeaderboardSaveStatsInputV1 {
            achievement_count: 2,
            achievement_points: 10,
            ribbons: -1,
            sessions_won: 4,
            shiny_species: BTreeSet::from([1, 2]),
            black_shiny_species: BTreeSet::from([2]),
            shiny_caught: 3,
            shiny_hatched: 1,
            shiny_lab_effects: BTreeSet::from(["spark".to_owned()]),
            relic_kinds_acquired: vec!["seal".to_owned(), "".to_owned(), "seal".to_owned()],
            eggs_pulled: 5,
            highest_damage: 12,
            highest_heal: 8,
            black_market_runs: 1,
        });
        assert_eq!(stats.ribbons, 0);
        assert_eq!(stats.shiny_species, 2);
        assert_eq!(stats.unique_relics, 1);
    }
}
