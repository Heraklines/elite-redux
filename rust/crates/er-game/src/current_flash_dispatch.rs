//! Initial WaveWon Flash dispatch precedes source XP child insertion.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_material_v6::{GamePresentationAchievementV1 as A, GamePresentationPayloadV1 as P};
use crate::m9e_runtime_v6::GameRuntimeV6Error as E;
use er_state::current_achievement_execution::{
    CurrentAchievementClockRequestV1, CurrentAchievementKeyV1 as K,
    CurrentFlashAchievementExecutionV1 as F, CurrentFlashEggInputsV1, CurrentFlashEggRequestV1,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::SafeU53;
fn cursor(state: &GameStateV6, id: SafeU53) -> Result<&F, E> {
    state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.iter().find(|p| p.id == id))
        .and_then(|p| p.victory_tail.as_ref())
        .and_then(|p| p.flash.as_ref())
        .ok_or(E::Action)
}
fn cursor_mut(state: &mut GameStateV6, id: SafeU53) -> Result<&mut F, E> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.iter_mut().find(|p| p.id == id))
        .and_then(|p| p.victory_tail.as_mut())
        .and_then(|p| p.flash.as_mut())
        .ok_or(E::Action)
}
pub(crate) fn clock(state: &GameStateV6, id: SafeU53) -> Option<&CurrentAchievementClockRequestV1> {
    cursor(state, id).ok()?.clock.as_ref()
}
pub(crate) fn egg_request(state: &GameStateV6, id: SafeU53) -> Option<&CurrentFlashEggRequestV1> {
    cursor(state, id).ok()?.egg_request.as_ref()
}
pub(crate) fn waiting(state: &GameStateV6, id: SafeU53) -> bool {
    clock(state, id).is_some() || egg_request(state, id).is_some()
}
/// Caller has already checked exact initial Faint/turn and WaveWon predicate.
pub(crate) fn begin(state: &mut GameStateV6, pending: SafeU53) -> Result<Option<F>, E> {
    let profile = state.current_friendship_profile.as_ref().ok_or(E::Action)?;
    let unlocks = profile
        .rewards
        .as_ref()
        .and_then(|r| r.achievements.as_ref())
        .ok_or(E::Action)?;
    if unlocks.contains(K::RealisticFlash) {
        return Ok(None);
    }
    let account = profile.egg_account.as_ref().ok_or(E::Action)?;
    account.validate().map_err(|_| E::Action)?;
    if account != &er_state::current_egg_account::CurrentEggAccountV1::fresh() {
        return Err(E::Action);
    }
    let request = state
        .identities
        .allocate_platform_request_id()
        .map_err(|_| E::Invalid)?;
    Ok(Some(F {
        clock: Some(CurrentAchievementClockRequestV1 {
            request,
            pending,
            achievement: K::RealisticFlash,
        }),
        egg_request: None,
        unlocked_at: None,
        completed_input: None,
    }))
}
pub(crate) fn settle_clock(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    request: &CurrentAchievementClockRequestV1,
    utc: i64,
) -> Result<(GameStateV6, Vec<P>), E> {
    crate::current_source_progression::current_source_progression(before, content)?;
    validate(before, request.pending)?;
    if cursor(before, request.pending)?.clock.as_ref() != Some(request) {
        return Err(E::Action);
    }
    let mut candidate = before.clone();
    if !candidate
        .current_friendship_profile
        .as_mut()
        .and_then(|p| p.rewards.as_mut())
        .and_then(|r| r.achievements.as_mut())
        .ok_or(E::Action)?
        .insert(K::RealisticFlash, utc)
    {
        return Err(E::Action);
    }
    let egg_request = candidate
        .identities
        .allocate_platform_request_id()
        .map_err(|_| E::Invalid)?;
    let retained = cursor_mut(&mut candidate, request.pending)?;
    retained.clock = None;
    retained.unlocked_at = Some(utc);
    retained.egg_request = Some(CurrentFlashEggRequestV1 {
        request: egg_request,
        pending: request.pending,
    });
    Ok((
        candidate,
        vec![P::AchievementUnlocked {
            achievement: A::RealisticFlash,
            utc_milliseconds: utc,
        }],
    ))
}
pub(crate) fn settle_egg(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    input: &CurrentFlashEggInputsV1,
) -> Result<(GameStateV6, Vec<P>), E> {
    crate::current_source_progression::current_source_progression(before, content)?;
    validate(before, input.pending)?;
    let retained = cursor(before, input.pending)?;
    if retained.egg_request
        != Some(CurrentFlashEggRequestV1 {
            request: input.request,
            pending: input.pending,
        })
    {
        return Err(E::Action);
    }
    let profile = before
        .current_friendship_profile
        .as_ref()
        .ok_or(E::Action)?;
    let egg = crate::current_flash_egg::prepare_initial_flash_egg(
        profile.egg_account.as_ref().ok_or(E::Action)?,
        input,
    )?;
    let mut updated = profile.clone();
    updated.egg_account = Some(egg); // Actual Egg insertion precedes source candyTeam.
    let run = before.active_run.as_ref().ok_or(E::Action)?;
    let difficulty = before.current_run_difficulty.ok_or(E::Action)?;
    if difficulty.run_id != run.run_id {
        return Err(E::Action);
    }
    let (updated, payloads) = crate::current_achievement_rewards::prepare_achievement_team_candy(
        &updated,
        run,
        difficulty.difficulty,
        10,
    )?;
    let mut candidate = before.clone();
    candidate.current_friendship_profile = Some(updated);
    let retained = cursor_mut(&mut candidate, input.pending)?;
    retained.egg_request = None;
    retained.completed_input = Some(input.clone());
    Ok((candidate, payloads))
}
pub(crate) fn validate(state: &GameStateV6, id: SafeU53) -> Result<(), E> {
    let Ok(flash) = cursor(state, id) else {
        return Ok(());
    };
    if !flash.valid(id) {
        return Err(E::Action);
    }
    let profile = state.current_friendship_profile.as_ref().ok_or(E::Action)?;
    let unlocks = profile
        .rewards
        .as_ref()
        .and_then(|r| r.achievements.as_ref())
        .ok_or(E::Action)?;
    let actual = unlocks
        .rows
        .iter()
        .find(|r| r.achievement == K::RealisticFlash)
        .map(|r| r.utc_milliseconds);
    if actual != flash.unlocked_at
        || flash
            .clock
            .as_ref()
            .is_some_and(|r| r.request.get() >= state.identities.next_platform_request_id)
        || flash
            .egg_request
            .as_ref()
            .is_some_and(|r| r.request.get() >= state.identities.next_platform_request_id)
        || flash
            .completed_input
            .as_ref()
            .is_some_and(|input| input.request.get() >= state.identities.next_platform_request_id)
    {
        return Err(E::Action);
    }
    let owner = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .ok_or(E::Action)?;
    let pending = owner.pending.iter().find(|p| p.id == id).ok_or(E::Action)?;
    let tracker = state
        .current_achievement_tracker
        .as_ref()
        .ok_or(E::Action)?;
    let run = state.active_run.as_ref().ok_or(E::Action)?;
    if tracker.history
        != er_state::current_achievement_tracker::CurrentAchievementHistoryV1::FreshComplete
        || tracker.run_id != run.run_id
        || !tracker
            .battle
            .as_ref()
            .is_some_and(|b| b.player_ever_acted && !b.flash_failed)
        || (flash.completed_input.is_none() && pending.victory.is_some())
    {
        return Err(E::Action);
    }
    let lapsed = pending.victory_tail.as_ref().is_some_and(|t| matches!(&t.phase,
        er_state::current_initial_victory_tail::CurrentInitialVictoryTailPhaseV1::RewardSelectionPending { .. }));
    validate_egg(state, id, lapsed)?;
    Ok(())
}

pub(crate) fn validate_egg(state: &GameStateV6, id: SafeU53, lapsed: bool) -> Result<(), E> {
    let retained = cursor(state, id)?;
    let account = state
        .current_friendship_profile
        .as_ref()
        .and_then(|p| p.egg_account.as_ref())
        .ok_or(E::Action)?;
    // This is a comparison with the explicitly owned first-account preimage,
    // not restoration of missing historical inventory or voucher data.
    let fresh = er_state::current_egg_account::CurrentEggAccountV1::fresh();
    let mut expected = if let Some(input) = &retained.completed_input {
        crate::current_flash_egg::prepare_initial_flash_egg(&fresh, input)?
    } else {
        fresh
    };
    if lapsed {
        let egg = expected.eggs.first_mut().ok_or(E::Action)?;
        if egg.hatch_waves != 25 {
            return Err(E::Action);
        }
        egg.hatch_waves = 24;
    }
    if &expected != account {
        return Err(E::Action);
    }
    Ok(())
}
