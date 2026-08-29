//! Typed run-meta state for achievements, quests, factions, challenges, and terminal outcomes.
use std::collections::{BTreeMap, BTreeSet};

use er_types::run_model::RunOutcome;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const RUN_META_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AchievementProgressV1 {
    pub key: String,
    pub progress: u64,
    pub target: u64,
    pub unlocked: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuestProgressV1 {
    pub key: String,
    pub step: u32,
    pub target: u32,
    pub completed: bool,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunDifficultyV1 {
    Youngster,
    Ace,
    Elite,
    Hell,
    Mystery,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunMetaStateV1 {
    pub schema_version: u32,
    pub flags: BTreeMap<String, bool>,
    pub counters: BTreeMap<String, u64>,
    pub achievements: BTreeMap<String, AchievementProgressV1>,
    pub quests: BTreeMap<String, QuestProgressV1>,
    pub faction_standing: BTreeMap<String, i64>,
    pub challenges: BTreeMap<String, i64>,
    pub titles: BTreeSet<String>,
    pub difficulty: RunDifficultyV1,
    pub outcome: RunOutcome,
}

impl Default for RunMetaStateV1 {
    fn default() -> Self {
        Self {
            schema_version: RUN_META_SCHEMA_VERSION_V1,
            flags: BTreeMap::new(),
            counters: BTreeMap::new(),
            achievements: BTreeMap::new(),
            quests: BTreeMap::new(),
            faction_standing: BTreeMap::new(),
            challenges: BTreeMap::new(),
            titles: BTreeSet::new(),
            difficulty: RunDifficultyV1::Youngster,
            outcome: RunOutcome::InProgress,
        }
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RunMetaErrorV1 {
    #[error("run-meta identity is empty")]
    Identity,
    #[error("run-meta arithmetic overflowed")]
    Overflow,
    #[error("run-meta transition is illegal")]
    Transition,
}

impl RunMetaStateV1 {
    pub fn set_flag(&mut self, key: String, value: bool) -> Result<(), RunMetaErrorV1> {
        if key.is_empty() {
            return Err(RunMetaErrorV1::Identity);
        }
        self.flags.insert(key, value);
        Ok(())
    }

    pub fn increment_counter(&mut self, key: String, amount: u64) -> Result<u64, RunMetaErrorV1> {
        if key.is_empty() {
            return Err(RunMetaErrorV1::Identity);
        }
        let current = self.counters.get(&key).copied().unwrap_or(0);
        let next = current
            .checked_add(amount)
            .ok_or(RunMetaErrorV1::Overflow)?;
        self.counters.insert(key, next);
        Ok(next)
    }

    pub fn record_achievement(
        &mut self,
        key: String,
        amount: u64,
        target: u64,
    ) -> Result<bool, RunMetaErrorV1> {
        if key.is_empty() || target == 0 {
            return Err(RunMetaErrorV1::Identity);
        }
        let entry = self
            .achievements
            .entry(key.clone())
            .or_insert(AchievementProgressV1 {
                key,
                progress: 0,
                target,
                unlocked: false,
            });
        entry.progress = entry
            .progress
            .checked_add(amount)
            .ok_or(RunMetaErrorV1::Overflow)?
            .min(entry.target);
        let newly_unlocked = !entry.unlocked && entry.progress >= entry.target;
        entry.unlocked |= newly_unlocked;
        Ok(newly_unlocked)
    }

    pub fn advance_quest(
        &mut self,
        key: String,
        amount: u32,
        target: u32,
    ) -> Result<bool, RunMetaErrorV1> {
        if key.is_empty() || target == 0 {
            return Err(RunMetaErrorV1::Identity);
        }
        let entry = self.quests.entry(key.clone()).or_insert(QuestProgressV1 {
            key,
            step: 0,
            target,
            completed: false,
        });
        entry.step = entry
            .step
            .checked_add(amount)
            .ok_or(RunMetaErrorV1::Overflow)?
            .min(entry.target);
        entry.completed = entry.step >= entry.target;
        Ok(entry.completed)
    }

    pub fn change_faction_standing(
        &mut self,
        faction: String,
        delta: i64,
    ) -> Result<i64, RunMetaErrorV1> {
        if faction.is_empty() {
            return Err(RunMetaErrorV1::Identity);
        }
        let current = self.faction_standing.get(&faction).copied().unwrap_or(0);
        let next = current.checked_add(delta).ok_or(RunMetaErrorV1::Overflow)?;
        self.faction_standing.insert(faction, next);
        Ok(next)
    }

    pub fn set_challenge(&mut self, key: String, value: i64) -> Result<(), RunMetaErrorV1> {
        if key.is_empty() {
            return Err(RunMetaErrorV1::Identity);
        }
        if value == 0 {
            self.challenges.remove(&key);
        } else {
            self.challenges.insert(key, value);
        }
        Ok(())
    }

    pub fn grant_title(&mut self, title: String) -> bool {
        !title.is_empty() && self.titles.insert(title)
    }

    pub fn enter_terminal(&mut self, outcome: RunOutcome) -> Result<(), RunMetaErrorV1> {
        if self.outcome != RunOutcome::InProgress || outcome == RunOutcome::InProgress {
            return Err(RunMetaErrorV1::Transition);
        }
        self.outcome = outcome;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RunMetaConditionV1 {
    Flag { key: String, value: bool },
    CounterAtLeast { key: String, value: u64 },
    AchievementUnlocked(String),
    QuestCompleted(String),
    FactionAtLeast { faction: String, standing: i64 },
    ChallengeActive(String),
    Difficulty(RunDifficultyV1),
    InProgress,
}

pub fn evaluate_run_meta_condition_v1(
    state: &RunMetaStateV1,
    condition: &RunMetaConditionV1,
) -> bool {
    match condition {
        RunMetaConditionV1::Flag { key, value } => state.flags.get(key) == Some(value),
        RunMetaConditionV1::CounterAtLeast { key, value } => state
            .counters
            .get(key)
            .is_some_and(|actual| actual >= value),
        RunMetaConditionV1::AchievementUnlocked(key) => state
            .achievements
            .get(key)
            .is_some_and(|entry| entry.unlocked),
        RunMetaConditionV1::QuestCompleted(key) => {
            state.quests.get(key).is_some_and(|entry| entry.completed)
        }
        RunMetaConditionV1::FactionAtLeast { faction, standing } => state
            .faction_standing
            .get(faction)
            .is_some_and(|actual| actual >= standing),
        RunMetaConditionV1::ChallengeActive(key) => state.challenges.contains_key(key),
        RunMetaConditionV1::Difficulty(difficulty) => state.difficulty == *difficulty,
        RunMetaConditionV1::InProgress => state.outcome == RunOutcome::InProgress,
    }
}

pub const fn difficulty_multiplier_percent_v1(difficulty: RunDifficultyV1) -> u32 {
    match difficulty {
        RunDifficultyV1::Youngster => 100,
        RunDifficultyV1::Ace => 115,
        RunDifficultyV1::Elite => 130,
        RunDifficultyV1::Hell => 150,
        RunDifficultyV1::Mystery => 150,
    }
}

pub fn scaled_meta_value_v1(
    value: u64,
    difficulty: RunDifficultyV1,
) -> Result<u64, RunMetaErrorV1> {
    value
        .checked_mul(u64::from(difficulty_multiplier_percent_v1(difficulty)))
        .map(|scaled| scaled / 100)
        .ok_or(RunMetaErrorV1::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn achievements_quests_and_factions_advance_once() {
        let mut state = RunMetaStateV1::default();
        assert_eq!(state.record_achievement("wins".to_owned(), 1, 2), Ok(false));
        assert_eq!(state.record_achievement("wins".to_owned(), 1, 2), Ok(true));
        assert_eq!(state.record_achievement("wins".to_owned(), 1, 2), Ok(false));
        assert_eq!(state.advance_quest("route".to_owned(), 2, 2), Ok(true));
        assert_eq!(
            state.change_faction_standing("guild".to_owned(), -3),
            Ok(-3)
        );
        assert!(evaluate_run_meta_condition_v1(
            &state,
            &RunMetaConditionV1::AchievementUnlocked("wins".to_owned())
        ));
    }

    #[test]
    fn challenges_flags_titles_and_terminal_fail_closed() {
        let mut state = RunMetaStateV1::default();
        state.set_flag("intro".to_owned(), true).expect("flag");
        state
            .set_challenge("mono".to_owned(), 1)
            .expect("challenge");
        assert!(state.grant_title("Champion".to_owned()));
        assert!(!state.grant_title("Champion".to_owned()));
        assert!(evaluate_run_meta_condition_v1(
            &state,
            &RunMetaConditionV1::ChallengeActive("mono".to_owned())
        ));
        state.enter_terminal(RunOutcome::Victory).expect("terminal");
        assert_eq!(
            state.enter_terminal(RunOutcome::Defeat),
            Err(RunMetaErrorV1::Transition)
        );
    }

    #[test]
    fn difficulty_scaling_is_integer_and_deterministic() {
        assert_eq!(scaled_meta_value_v1(200, RunDifficultyV1::Hell), Ok(300));
        assert_eq!(
            difficulty_multiplier_percent_v1(RunDifficultyV1::Youngster),
            100
        );
    }
}
