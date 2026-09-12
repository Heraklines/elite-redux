//! Retained LevelAchv first-unlock clocks, before actual LevelUp stat work.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_material_v6::{GamePresentationAchievementV1 as A, GamePresentationPayloadV1 as P};
use crate::m9e_runtime_v6::GameRuntimeV6Error as E;
use er_state::current_achievement_execution::{
    CurrentAchievementClockRequestV1, CurrentAchievementKeyV1 as K,
    CurrentLevelAchievementExecutionV1,
};
use er_state::current_experience_settlement::CurrentLevelUpV1;
use er_state::current_victory_execution::CurrentVictoryExecutionV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::SafeU53;

fn cursor(state: &GameStateV6, pending: SafeU53) -> Result<&CurrentVictoryExecutionV1, E> {
    state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.iter().find(|p| p.id == pending))
        .and_then(|p| p.victory.as_ref())
        .ok_or(E::Action)
}
fn cursor_mut(
    state: &mut GameStateV6,
    pending: SafeU53,
) -> Result<&mut CurrentVictoryExecutionV1, E> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.iter_mut().find(|p| p.id == pending))
        .and_then(|p| p.victory.as_mut())
        .ok_or(E::Action)
}
pub(crate) fn clock(
    state: &GameStateV6,
    pending: SafeU53,
) -> Option<&CurrentAchievementClockRequestV1> {
    cursor(state, pending)
        .ok()?
        .level_achievements
        .as_ref()?
        .clock
        .as_ref()
}
fn advance(
    state: &mut GameStateV6,
    retained: &mut CurrentLevelAchievementExecutionV1,
) -> Result<(), E> {
    if usize::from(retained.next) == retained.achievements.len() {
        retained.clock = None;
        return Ok(());
    }
    let unlocks = state
        .current_friendship_profile
        .as_ref()
        .and_then(|p| p.rewards.as_ref())
        .and_then(|p| p.achievements.as_ref())
        .ok_or(E::Action)?;
    while let Some(key) = retained.achievements.get(usize::from(retained.next)) {
        if !unlocks.contains(*key) {
            break;
        }
        retained.next = retained.next.checked_add(1).ok_or(E::Invalid)?;
    }
    retained.clock = if let Some(key) = retained.achievements.get(usize::from(retained.next)) {
        Some(CurrentAchievementClockRequestV1 {
            request: state
                .identities
                .allocate_platform_request_id()
                .map_err(|_| E::Invalid)?,
            pending: retained.level_up.award.phase.pending_id,
            achievement: *key,
        })
    } else {
        None
    };
    Ok(())
}
/// Returns the retained parent only after all reached source keys are complete.
pub(crate) fn begin(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    level: &CurrentLevelUpV1,
) -> Result<(GameStateV6, Option<CurrentLevelUpV1>), E> {
    let pending = level.award.phase.pending_id;
    if cursor(before, pending)?.level_achievements.is_some() {
        return Err(E::Action);
    }
    let account =
        crate::current_level_account::prepare_current_level_account(before, content, level)?;
    let achievements = account
        .achievements
        .iter()
        .map(|key| match key.source_key() {
            "LV_100" => Ok(K::Level100),
            "LV_250" => Ok(K::Level250),
            "LV_1000" => Ok(K::Level1000),
            _ => Err(E::Invalid),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut candidate = account.state;
    let mut retained = CurrentLevelAchievementExecutionV1 {
        level_up: level.clone(),
        achievements,
        next: 0,
        clock: None,
    };
    advance(&mut candidate, &mut retained)?;
    let done = retained.clock.is_none();
    cursor_mut(&mut candidate, pending)?.level_achievements = (!done).then_some(retained);
    Ok((candidate, done.then(|| level.clone())))
}
pub(crate) fn settle(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    request: &CurrentAchievementClockRequestV1,
    utc: i64,
) -> Result<(GameStateV6, Option<CurrentLevelUpV1>, Vec<P>), E> {
    crate::current_source_progression::current_source_progression(before, content)?;
    let mut retained = cursor(before, request.pending)?
        .level_achievements
        .clone()
        .ok_or(E::Action)?;
    if !retained.valid(request.pending)
        || retained.clock.as_ref() != Some(request)
        || request.request.get() >= before.identities.next_platform_request_id
    {
        return Err(E::Action);
    }
    let profile = before
        .current_friendship_profile
        .as_ref()
        .ok_or(E::Action)?;
    let run = before.active_run.as_ref().ok_or(E::Action)?;
    let difficulty = before.current_run_difficulty.ok_or(E::Action)?;
    if difficulty.run_id != run.run_id {
        return Err(E::Action);
    }
    let per_mon = request.achievement.level_candy().ok_or(E::Action)?;
    let (mut updated, candy) = crate::current_achievement_rewards::prepare_achievement_team_candy(
        profile,
        run,
        difficulty.difficulty,
        per_mon,
    )?;
    let unlocks = updated
        .rewards
        .as_mut()
        .and_then(|p| p.achievements.as_mut())
        .ok_or(E::Action)?;
    if !unlocks.insert(request.achievement, utc) {
        return Err(E::Action);
    }
    let achievement = match request.achievement {
        K::Level100 => A::Level100,
        K::Level250 => A::Level250,
        K::Level1000 => A::Level1000,
        K::RealisticFlash => return Err(E::Action),
    };
    let mut payloads = vec![P::AchievementUnlocked {
        achievement,
        utc_milliseconds: utc,
    }];
    payloads.extend(candy);
    let mut candidate = before.clone();
    candidate.current_friendship_profile = Some(updated);
    retained.next = retained.next.checked_add(1).ok_or(E::Invalid)?;
    retained.clock = None;
    advance(&mut candidate, &mut retained)?;
    let done = retained.clock.is_none();
    let parent = done.then(|| retained.level_up.clone());
    cursor_mut(&mut candidate, request.pending)?.level_achievements = (!done).then_some(retained);
    Ok((candidate, parent, payloads))
}
