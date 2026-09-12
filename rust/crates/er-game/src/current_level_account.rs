//! Actual LevelUp.start account work precedes calculateStats and presentation.
//! Reached achievements are requests for the shared source reward dispatcher.
use er_state::current_experience_settlement::CurrentLevelUpV1;
use er_state::current_victory_execution::CurrentVictoryDescendantV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::SafeU53;
use crate::current_source_progression::current_source_progression;
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CurrentLevelAchievement {
    Level100,
    Level250,
    Level1000,
}

impl CurrentLevelAchievement {
    pub(crate) fn source_key(self) -> &'static str {
        match self { Self::Level100 => "LV_100", Self::Level250 => "LV_250", Self::Level1000 => "LV_1000" }
    }

    fn threshold(self) -> u16 {
        match self { Self::Level100 => 100, Self::Level250 => 250, Self::Level1000 => 1000 }
    }
}

#[derive(Debug)]
pub(crate) struct CurrentLevelAccountCandidate {
    pub(crate) state: GameStateV6,
    /// Source declaration order, using the actual level holder. These still
    /// require source unlock checks, captured clocks and reward descendants.
    pub(crate) achievements: Vec<CurrentLevelAchievement>,
}

pub(crate) fn prepare_current_level_account(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    level_up: &CurrentLevelUpV1,
) -> Result<CurrentLevelAccountCandidate, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    current_source_progression(before, content)?;
    let owner = before.current_battle_participation.as_ref()
        .and_then(|p| p.experience.as_ref()).ok_or_else(failure)?;
    let retained = owner.pending.iter().find(|p| p.id == level_up.award.phase.pending_id)
        .and_then(|p| p.victory.as_ref()).ok_or_else(failure)?;
    if !matches!(&retained.descendant, CurrentVictoryDescendantV1::LevelUpStart { level_up: actual } if actual == level_up) {
        return Err(failure());
    }
    let pokemon = before.active_run.as_ref().and_then(|run| run.party.get(usize::from(level_up.award.phase.party_index))).ok_or_else(failure)?;
    if pokemon.id != level_up.award.phase.pokemon || pokemon.level != level_up.new_level
        || level_up.previous_level != level_up.award.last_level
        || level_up.new_level <= level_up.previous_level || pokemon.stats != level_up.previous_stats
    { return Err(failure()); }
    let mut candidate = before.clone();
    let rewards = candidate.current_friendship_profile.as_mut()
        .and_then(|profile| profile.rewards.as_mut()).ok_or_else(failure)?;
    let observed = SafeU53::new(u64::from(level_up.new_level)).map_err(|_| failure())?;
    rewards.highest_level = rewards.highest_level.max(observed);
    // Pinned399d LevelAchv thresholds100/250/1000, actual source observation
    // 83330acd/run34413859846 and audited account initializer highestLevel0.
    // Validation runs even when the account already has a higher high-water
    // value. It consumes the Pokemon's current level, not that account value.
    let achievements = [CurrentLevelAchievement::Level100, CurrentLevelAchievement::Level250, CurrentLevelAchievement::Level1000]
        .into_iter().filter(|achievement| level_up.new_level >= achievement.threshold()).collect();
    Ok(CurrentLevelAccountCandidate { state: candidate, achievements })
}
