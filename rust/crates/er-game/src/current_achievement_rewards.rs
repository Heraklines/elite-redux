//! Reward recipe arithmetic shared by actual achievement dispatch. This helper
//! is not an admission path: the caller must own an outstanding first-unlock
//! clock and, for Flash, must already have inserted the actual Egg descendant.
use er_progression::current_friendship::add_resolved_starter_candy;
use er_state::current_friendship_profile::CurrentFriendshipProfileV1;
use er_state::m7_state::RunStateV3;
use er_types::{RunDifficultyV1, SafeU53};

use crate::m9e_material_v6::GamePresentationPayloadV1;
use crate::m9e_runtime_v6::GameRuntimeV6Error;

pub(crate) fn prepare_achievement_team_candy(
    profile: &CurrentFriendshipProfileV1,
    run: &RunStateV3,
    difficulty: RunDifficultyV1,
    per_mon: u8,
) -> Result<(CurrentFriendshipProfileV1, Vec<GamePresentationPayloadV1>), GameRuntimeV6Error> {
    let fail = || GameRuntimeV6Error::Action;
    // Only reached, pinned achievement candyTeam recipes are admitted.
    if !matches!(per_mon, 10 | 20 | 30) || run.party.is_empty() || run.party.len() > 6 {
        return Err(fail());
    }
    profile.validate().map_err(|_| fail())?;
    let count = match difficulty {
        RunDifficultyV1::Youngster => i64::from(per_mon),
        RunDifficultyV1::Ace => i64::from(per_mon) * 3 / 2,
        RunDifficultyV1::Elite => i64::from(per_mon) * 2,
        RunDifficultyV1::Hell => i64::from(per_mon) * 3,
        RunDifficultyV1::Mystery => return Err(fail()),
    };
    let mut candidate = profile.clone();
    let mut presentations = Vec::new();
    // Source's Set is by Pokemon object identity. Distinct party objects sharing
    // a root both grant, including fainted objects, against each updated balance.
    for pokemon in &run.party {
        if pokemon.owner_seat != Some(profile.owner_seat)
            || pokemon.form_index != 0
            || pokemon.fusion.is_some()
            || !matches!(pokemon.species_id.get().get(), 1 | 4 | 7)
        {
            return Err(fail());
        }
        let index = candidate
            .accounts
            .binary_search_by_key(&pokemon.species_id, |row| row.species)
            .map_err(|_| fail())?;
        let account = &mut candidate.accounts[index];
        let before = account.candy_count;
        // Source passes fromEgg=true, so there is no rate lookup or scaling.
        // Zero is an unused arithmetic argument here, not an inferred run rate.
        let result = add_resolved_starter_candy(
            i64::try_from(before.get()).map_err(|_| fail())?,
            count,
            true,
            true,
            false,
            0,
        )
        .map_err(|_| fail())?;
        account.candy_count = SafeU53::new(u64::try_from(result.candy_count).map_err(|_| fail())?)
            .map_err(|_| fail())?;
        if let Some(scaled_count) = result.candy_bar_count {
            presentations.push(GamePresentationPayloadV1::StarterCandy {
                root: account.species,
                scaled_count,
                before_candy: before,
                after_candy: account.candy_count,
            });
        }
    }
    Ok((candidate, presentations))
}
