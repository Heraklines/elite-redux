//! Source Victory.start counter precedes applyPartyExp and its friendship loop.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;
use er_state::current_experience_owner::CurrentFriendshipPhaseV1;
use er_state::current_faint_execution::CurrentFaintPhaseV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::SafeU53;

pub(crate) fn validate(state: &GameStateV6) -> Result<(), GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    let Some(owner) = state
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
    else {
        return Ok(());
    };
    let Some(source) = &owner.source_progression else {
        return Ok(());
    };
    let rewards = state
        .current_friendship_profile
        .as_ref()
        .and_then(|profile| profile.rewards.as_ref())
        .ok_or_else(failure)?;
    let baseline = if let Some(previous) = owner.first_reward_predecessor.as_ref() {
        let previous: GameStateV6 =
            serde_json::from_value((**previous).clone()).map_err(|_| failure())?;
        let prior = previous
            .current_friendship_profile
            .as_ref()
            .and_then(|profile| profile.rewards.as_ref())
            .ok_or_else(failure)?
            .pokemon_defeated;
        if prior.get() != 1 {
            return Err(failure());
        }
        prior
    } else {
        SafeU53::ZERO
    };
    if owner.pending.len() > 1 {
        return Err(failure());
    }
    let Some(pending) = owner.pending.first() else {
        return if rewards.pokemon_defeated == baseline {
            Ok(())
        } else {
            Err(failure())
        };
    };
    match pending.victory_defeated_total {
        None => {
            if rewards.pokemon_defeated != baseline
                || pending.victory.is_some()
                || pending
                    .friendship
                    .as_ref()
                    .is_some_and(|phase| phase != &CurrentFriendshipPhaseV1::default())
            {
                return Err(failure());
            }
        }
        Some(total) => {
            if baseline.get().checked_add(1) != Some(total.get())
                || rewards.pokemon_defeated != total
                || !matches!(&source.initial_faint.phase, Some(CurrentFaintPhaseV1::ReadyForVictory { address })
                    if address.pending_id == pending.id)
            {
                return Err(failure());
            }
        }
    }
    Ok(())
}

pub(crate) fn begin(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    pending_id: SafeU53,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    validate(before)?;
    let source = crate::current_source_progression::current_source_progression(before, content)?;
    if !matches!(&source.initial_faint.phase, Some(CurrentFaintPhaseV1::ReadyForVictory { address })
        if address.pending_id == pending_id)
    {
        return Err(failure());
    }
    let pending = before
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| {
            owner
                .pending
                .iter()
                .find(|pending| pending.id == pending_id)
        })
        .ok_or_else(failure)?;
    if pending.victory_defeated_total.is_some() {
        return Ok(before.clone());
    }
    let mut candidate = before.clone();
    let rewards = candidate
        .current_friendship_profile
        .as_mut()
        .and_then(|profile| profile.rewards.as_mut())
        .ok_or_else(failure)?;
    let total = SafeU53::new(
        rewards
            .pokemon_defeated
            .get()
            .checked_add(1)
            .ok_or_else(failure)?,
    )
    .map_err(|_| failure())?;
    rewards.pokemon_defeated = total;
    candidate
        .current_battle_participation
        .as_mut()
        .and_then(|owner| owner.experience.as_mut())
        .and_then(|owner| {
            owner
                .pending
                .iter_mut()
                .find(|pending| pending.id == pending_id)
        })
        .ok_or_else(failure)?
        .victory_defeated_total = Some(total);
    validate(&candidate)?;
    Ok(candidate)
}
