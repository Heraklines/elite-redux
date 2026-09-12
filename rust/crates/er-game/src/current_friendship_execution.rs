//! Source-owned ordinary fresh Classic friendship phase. External input is a
//! response to an owned absolute-clock request, never resolved award arithmetic.
use er_progression::current_friendship::{
    ExistingStarterAccount, FriendshipSourceProvenance, PINNED_FRIENDSHIP_CAPS,
    ResolvedFriendshipMode, ResolvedFriendshipStarter, ResolvedPositiveFriendship,
    add_resolved_starter_candy,
};
use er_progression::current_friendship_phase::{finish_phase_tail, prepare_phase_head};
use er_state::current_experience_owner::{
    CurrentExperienceExecutionOriginV1, CurrentFriendshipAwardV1, CurrentFriendshipClockPurposeV1,
    CurrentFriendshipClockRequestV1, CurrentFriendshipHeadV1, CurrentFriendshipPhaseV1,
};
use er_state::current_friendship_profile::{
    CURRENT_FRIENDSHIP_RIBBON_V1, CurrentFriendshipRibbonV1,
};
use er_state::m9e_state_v6::{GameStateV6, GameStateV6ContentContext};
use er_types::{RunDifficultyV1, SafeU53};

use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_material_v6::{GamePresentationAchievementV1, GamePresentationPayloadV1};
use crate::m9e_runtime_v6::GameRuntimeV6Error;

// Source table order is significant: TimedEventManager.activeEvent uses find.
// Each interval is strictly open, exactly as startDate < now && now < endDate.
// The focused source oracle must compare all eleven rows and boundary samples.
const EVENTS: [(i64, i64, u8, bool); 11] = [
    (1_775_001_600_000, 1_775_174_400_000, 3, false),
    (1_770_940_800_000, 1_772_496_000_000, 3, false),
    (1_766_102_400_000, 1_767_571_200_000, 3, false),
    (1_734_739_200_000, 1_735_948_800_000, 3, false),
    (1_738_108_800_000, 1_738_540_800_000, 3, false),
    (1_739_145_600_000, 1_740_096_000_000, 3, true),
    (1_740_614_400_000, 1_741_046_400_000, 4, false),
    (1_743_379_200_000, 1_743_638_400_000, 3, false),
    (1_746_230_400_000, 1_747_094_400_000, 3, false),
    (1_750_204_800_000, 1_751_241_600_000, 3, false),
    (1_761_782_400_000, 1_762_905_600_000, 3, false),
];

fn event_rate(utc: i64) -> Result<(u8, bool), GameRuntimeV6Error> {
    // Date.TimeClip rejects values beyond this bound. Scheduler milliseconds
    // never enter this function; the external callback explicitly names UTC.
    if !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc) {
        return Err(GameRuntimeV6Error::Invalid);
    }
    Ok(EVENTS
        .iter()
        .find(|(start, end, _, _)| *start < utc && utc < *end)
        .map_or((3, false), |(_, _, rate, fusion)| (*rate, *fusion)))
}

fn candy_rate(difficulty: RunDifficultyV1, wave: u64) -> Result<u8, GameRuntimeV6Error> {
    if !(1..=200).contains(&wave) {
        return Err(GameRuntimeV6Error::Invalid);
    }
    // Actual er.rewards.candy* tables and tierEquivalentWaves=20. The fresh
    // normal-Classic origin owns normal pacing, zero challenge favour and no
    // endless continuation; arbitrary absent legacy fields cannot use this path.
    let rates = match difficulty {
        RunDifficultyV1::Youngster => [2, 2, 2, 2, 3, 3, 4, 5, 6, 8],
        RunDifficultyV1::Ace => [1, 1, 1, 2, 2, 3, 4, 4, 6, 7],
        RunDifficultyV1::Elite => [1, 1, 1, 1, 1, 1, 2, 3, 4, 5],
        RunDifficultyV1::Hell => [1, 2, 3, 4, 6, 6, 8, 10, 10, 11],
        RunDifficultyV1::Mystery => return Err(GameRuntimeV6Error::Action),
    };
    rates
        .get(usize::try_from((wave - 1) / 20).map_err(|_| GameRuntimeV6Error::Invalid)?)
        .copied()
        .ok_or(GameRuntimeV6Error::Invalid)
}

pub(crate) fn prepare_clock_result(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    request: &CurrentFriendshipClockRequestV1,
    utc: i64,
) -> Result<(GameStateV6, Vec<GamePresentationPayloadV1>), GameRuntimeV6Error> {
    before
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let owner = before
        .current_battle_participation
        .as_ref()
        .and_then(|observation| observation.experience.as_ref())
        .ok_or(GameRuntimeV6Error::Action)?;
    let run = before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let profile = before
        .current_friendship_profile
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let difficulty = before
        .current_run_difficulty
        .ok_or(GameRuntimeV6Error::Action)?;
    if owner.execution_origin != Some(CurrentExperienceExecutionOriginV1::FreshNormalClassic)
        || profile.owner_seat != owner.authority
        || difficulty.run_id != run.run_id
        || !content.supports_current_experience_mode(run.mode)
        || !run.modifiers.is_empty()
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let pending_index = owner
        .pending
        .iter()
        .position(|pending| {
            pending
                .friendship
                .as_ref()
                .is_some_and(|phase| !phase.complete)
        })
        .ok_or(GameRuntimeV6Error::Action)?;
    let pending = &owner.pending[pending_index];
    let phase = pending
        .friendship
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    if pending.id != request.pending || phase.clock.as_ref() != Some(request) {
        return Err(GameRuntimeV6Error::Action);
    }
    phase
        .validate(pending)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let head = phase.head.as_ref().ok_or(GameRuntimeV6Error::Invalid)?;
    let pokemon_index = run
        .party
        .iter()
        .position(|pokemon| pokemon.id == request.recipient)
        .ok_or(GameRuntimeV6Error::Action)?;
    let pokemon = &run.party[pokemon_index];
    // The first registered source-root closure is the actual base Kanto trio.
    // Neither an arbitrary prepared form nor a convenient existing account is
    // evidence of PokemonSpecies.getRootSpeciesId / GameData normalization.
    if pokemon.owner_seat != Some(profile.owner_seat)
        || pokemon.hp == 0
        || pokemon.form_index != 0
        || pokemon.fusion.is_some()
        || !matches!(pokemon.species_id.get().get(), 1 | 4 | 7)
        || !pokemon.held_items.is_empty()
        || pokemon.friendship != head.after
    {
        return Err(GameRuntimeV6Error::Action);
    }
    if request.purpose == CurrentFriendshipClockPurposeV1::MaxAchievement {
        return settle_max_clock(before, content, pending_index, request, utc);
    }
    let account_index = profile
        .accounts
        .binary_search_by_key(&pokemon.species_id, |row| row.species)
        .map_err(|_| GameRuntimeV6Error::Action)?;
    let account = &profile.accounts[account_index];
    let source_id =
        u32::try_from(pokemon.species_id.get().get()).map_err(|_| GameRuntimeV6Error::Action)?;
    let cost = crate::current_friendship_profile::PINNED_STARTER_COSTS
        .iter()
        .find(|(species, _)| *species == source_id)
        .map(|(_, cost)| *cost)
        .ok_or(GameRuntimeV6Error::Action)?;
    let (multiplier, fusions) = event_rate(utc)?;
    let rate = candy_rate(difficulty.difficulty, run.wave.get().get())?;
    let provenance = er_canonical::fixture_digest(&(
        &before.content_identity,
        run.run_id,
        run.wave,
        difficulty,
        request,
        utc,
        pokemon.species_id,
        cost,
        multiplier,
        rate,
    ))
    .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let resolved = ResolvedPositiveFriendship {
        provenance: FriendshipSourceProvenance {
            oracle_sha: before.content_identity.oracle_sha.as_str().to_owned(),
            resolution_sha256: provenance,
        },
        pokemon_species: source_id,
        starter: ResolvedFriendshipStarter {
            source_root: source_id,
            candy_account_root: source_id,
            starter_cost: f64::from(cost),
        },
        fusion_starter: None,
        // BattleScene.applyPartyExp calls addFriendship(3) in normal pacing.
        // Empty actual modifier/held-item collections establish no booster call.
        boosted_amount: 3.0,
        capped: false,
        fun_debug: false,
        mode: ResolvedFriendshipMode::Classic {
            candy_multiplier: f64::from(multiplier),
        },
        event_boosts_fusions: fusions,
        friendship_caps: PINNED_FRIENDSHIP_CAPS.to_vec(),
        total_candy_rate: rate,
    };
    let arithmetic_head = prepare_phase_head(f64::from(head.before), 3.0, Some(3.0), false, false)
        .map_err(|_| GameRuntimeV6Error::Action)?;
    let tail = finish_phase_tail(
        &arithmetic_head,
        &[ExistingStarterAccount {
            species_id: source_id,
            friendship_progress: account.friendship_progress.get(),
            candy_count: i64::try_from(account.candy_count.get())
                .map_err(|_| GameRuntimeV6Error::Invalid)?,
        }],
        &resolved,
    )
    .map_err(|_| GameRuntimeV6Error::Action)?;
    let plan = tail.plan;
    let result = plan
        .accounts
        .first()
        .filter(|_| plan.accounts.len() == 1)
        .ok_or(GameRuntimeV6Error::Invalid)?;
    let after_friendship = head.after;
    if plan.friendship != f64::from(after_friendship) {
        return Err(GameRuntimeV6Error::Invalid);
    }
    let award = CurrentFriendshipAwardV1 {
        request: request.clone(),
        utc_milliseconds: utc,
        source_root: pokemon.species_id,
        candy_root: pokemon.species_id,
        pokemon_friendship_before: head.before,
        pokemon_friendship_after: after_friendship,
        progress_before: account.friendship_progress,
        progress_after: SafeU53::new(result.friendship_progress)
            .map_err(|_| GameRuntimeV6Error::Invalid)?,
        candy_before: account.candy_count,
        candy_after: SafeU53::new(
            u64::try_from(result.candy_count).map_err(|_| GameRuntimeV6Error::Invalid)?,
        )
        .map_err(|_| GameRuntimeV6Error::Invalid)?,
        max_clock: head.max_clock.clone(),
        max_utc_milliseconds: head.max_utc_milliseconds,
    };
    let mut candidate = before.clone();
    candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .party[pokemon_index]
        .friendship = after_friendship;
    let updated = candidate
        .current_friendship_profile
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .accounts
        .get_mut(account_index)
        .ok_or(GameRuntimeV6Error::Invalid)?;
    updated.friendship_progress = award.progress_after;
    updated.candy_count = award.candy_after;
    let updated_pending = candidate
        .current_battle_participation
        .as_mut()
        .and_then(|observation| observation.experience.as_mut())
        .and_then(|owner| owner.pending.get_mut(pending_index))
        .ok_or(GameRuntimeV6Error::Invalid)?;
    let recipients = CurrentFriendshipPhaseV1::recipients(updated_pending);
    let updated_phase = updated_pending
        .friendship
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?;
    updated_phase.clock = None;
    updated_phase.head = None;
    updated_phase.awards.push(award);
    updated_phase.complete = updated_phase.awards.len() == recipients.len();
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let payloads = plan
        .intents
        .into_iter()
        .map(|intent| match intent {
            er_progression::current_friendship::FriendshipIntent::ShowStarterCandy {
                root,
                scaled_count,
                before_candy,
                after_candy,
            } => Ok(GamePresentationPayloadV1::StarterCandy {
                root: er_types::battle_ids::SpeciesId::new(safe(u64::from(root))?),
                scaled_count,
                before_candy: safe(
                    u64::try_from(before_candy).map_err(|_| GameRuntimeV6Error::Invalid)?,
                )?,
                after_candy: safe(
                    u64::try_from(after_candy).map_err(|_| GameRuntimeV6Error::Invalid)?,
                )?,
            }),
            _ => Err(GameRuntimeV6Error::Invalid),
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((candidate, payloads))
}

fn safe(value: u64) -> Result<SafeU53, GameRuntimeV6Error> {
    SafeU53::new(value).map_err(|_| GameRuntimeV6Error::Invalid)
}

/// A source call begins by changing Pokemon friendship. Its account tail cannot
/// run until the exact retained Date request has returned. The caller publishes
/// the candidate and request together as one ordinary game material.
pub(crate) fn prepare_next_friendship(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(GameStateV6, Vec<GamePresentationPayloadV1>), GameRuntimeV6Error> {
    before
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let observation = before
        .current_battle_participation
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let owner = observation
        .experience
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let run = before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let profile = before
        .current_friendship_profile
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let rewards = profile.rewards.as_ref().ok_or(GameRuntimeV6Error::Action)?;
    if owner.execution_origin != Some(CurrentExperienceExecutionOriginV1::FreshNormalClassic)
        || before.current_targeting.is_none()
        || !run.modifiers.is_empty()
        || profile.owner_seat != owner.authority
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let index = owner
        .pending
        .iter()
        .position(|pending| {
            pending
                .friendship
                .as_ref()
                .is_some_and(|phase| !phase.complete)
        })
        .ok_or(GameRuntimeV6Error::Action)?;
    let pending = &owner.pending[index];
    let phase = pending
        .friendship
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    if phase.clock.is_some() || phase.head.is_some() {
        return Err(GameRuntimeV6Error::Action);
    }
    let recipients = CurrentFriendshipPhaseV1::recipients(pending);
    let Some(recipient) = recipients.get(phase.awards.len()).copied() else {
        let mut candidate = before.clone();
        phase_mut(&mut candidate, index)?.complete = true;
        candidate
            .validate_with(content)
            .map_err(|_| GameRuntimeV6Error::Invalid)?;
        return Ok((candidate, Vec::new()));
    };
    let pokemon = run
        .party
        .iter()
        .find(|pokemon| pokemon.id == recipient)
        .ok_or(GameRuntimeV6Error::Action)?;
    if pokemon.hp == 0
        || pokemon.owner_seat != Some(profile.owner_seat)
        || pokemon.form_index != 0
        || pokemon.fusion.is_some()
        || !matches!(pokemon.species_id.get().get(), 1 | 4 | 7)
        || !pokemon.held_items.is_empty()
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let after = pokemon.friendship.saturating_add(3).min(255);
    let purpose = if after == 255 && !rewards.max_is_unlocked() {
        CurrentFriendshipClockPurposeV1::MaxAchievement
    } else {
        CurrentFriendshipClockPurposeV1::TimedEvent
    };
    let mut candidate = before.clone();
    let request = CurrentFriendshipClockRequestV1 {
        request: candidate
            .identities
            .allocate_platform_request_id()
            .map_err(|_| GameRuntimeV6Error::Invalid)?,
        pending: pending.id,
        recipient,
        purpose,
    };
    candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .party
        .iter_mut()
        .find(|value| value.id == recipient)
        .ok_or(GameRuntimeV6Error::Invalid)?
        .friendship = after;
    if after == 255 && purpose == CurrentFriendshipClockPurposeV1::TimedEvent {
        award_ribbon(&mut candidate, pokemon.species_id)?;
    }
    let phase = phase_mut(&mut candidate, index)?;
    phase.head = Some(CurrentFriendshipHeadV1 {
        recipient,
        before: pokemon.friendship,
        after,
        max_clock: None,
        max_utc_milliseconds: None,
    });
    phase.clock = Some(request);
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    Ok((candidate, Vec::new()))
}

fn phase_mut(
    state: &mut GameStateV6,
    index: usize,
) -> Result<&mut CurrentFriendshipPhaseV1, GameRuntimeV6Error> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|value| value.experience.as_mut())
        .and_then(|owner| owner.pending.get_mut(index))
        .and_then(|value| value.friendship.as_mut())
        .ok_or(GameRuntimeV6Error::Invalid)
}

fn award_ribbon(
    state: &mut GameStateV6,
    species: er_types::battle_ids::SpeciesId,
) -> Result<(), GameRuntimeV6Error> {
    // The admitted base Kanto trio each has itself as its complete source line.
    // Evolved/custom/fused species require their actual line resolver first.
    if !matches!(species.get().get(), 1 | 4 | 7) {
        return Err(GameRuntimeV6Error::Action);
    }
    let rewards = state
        .current_friendship_profile
        .as_mut()
        .and_then(|value| value.rewards.as_mut())
        .ok_or(GameRuntimeV6Error::Action)?;
    match rewards
        .ribbons
        .binary_search_by_key(&species, |row| row.species)
    {
        Ok(_) => {}
        Err(index) => rewards.ribbons.insert(
            index,
            CurrentFriendshipRibbonV1 {
                species,
                bits: safe(CURRENT_FRIENDSHIP_RIBBON_V1)?,
            },
        ),
    }
    Ok(())
}

fn settle_max_clock(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    index: usize,
    request: &CurrentFriendshipClockRequestV1,
    utc: i64,
) -> Result<(GameStateV6, Vec<GamePresentationPayloadV1>), GameRuntimeV6Error> {
    if !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc) {
        return Err(GameRuntimeV6Error::Action);
    }
    let run = before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let profile = before
        .current_friendship_profile
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    if profile
        .rewards
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?
        .max_is_unlocked()
        || run.party.is_empty()
        || run.party.len() > 6
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let difficulty = before
        .current_run_difficulty
        .ok_or(GameRuntimeV6Error::Action)?;
    let count = match difficulty.difficulty {
        RunDifficultyV1::Youngster => 10,
        RunDifficultyV1::Ace => 15,
        RunDifficultyV1::Elite => 20,
        RunDifficultyV1::Hell => 30,
        RunDifficultyV1::Mystery => return Err(GameRuntimeV6Error::Action),
    };
    let rate = candy_rate(difficulty.difficulty, run.wave.get().get())?;
    let species = run
        .party
        .iter()
        .find(|pokemon| pokemon.id == request.recipient)
        .ok_or(GameRuntimeV6Error::Action)?
        .species_id;
    let mut candidate = before.clone();
    let mut payloads = vec![GamePresentationPayloadV1::AchievementUnlocked {
        achievement: GamePresentationAchievementV1::MaxFriendship,
        utc_milliseconds: utc,
    }];
    let updated_profile = candidate
        .current_friendship_profile
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?;
    updated_profile
        .rewards
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .max_friendship_unlocked_at = Some(utc);
    // Source iterates object identity in actual party order, including fainted
    // recipients and multiple objects sharing one root. Read each live balance
    // after earlier grants; never deduplicate by species or truncate to a helper cap.
    for pokemon in &run.party {
        if pokemon.owner_seat != Some(profile.owner_seat)
            || pokemon.form_index != 0
            || pokemon.fusion.is_some()
            || !matches!(pokemon.species_id.get().get(), 1 | 4 | 7)
        {
            return Err(GameRuntimeV6Error::Action);
        }
        let account = updated_profile
            .accounts
            .binary_search_by_key(&pokemon.species_id, |row| row.species)
            .map_err(|_| GameRuntimeV6Error::Action)?;
        let row = &mut updated_profile.accounts[account];
        let previous = row.candy_count;
        let result = add_resolved_starter_candy(
            i64::try_from(previous.get()).map_err(|_| GameRuntimeV6Error::Invalid)?,
            count,
            true,
            true,
            false,
            rate,
        )
        .map_err(|_| GameRuntimeV6Error::Action)?;
        row.candy_count =
            safe(u64::try_from(result.candy_count).map_err(|_| GameRuntimeV6Error::Invalid)?)?;
        if let Some(scaled_count) = result.candy_bar_count {
            payloads.push(GamePresentationPayloadV1::StarterCandy {
                root: row.species,
                scaled_count,
                before_candy: previous,
                after_candy: row.candy_count,
            });
        }
    }
    updated_profile
        .rewards
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .cosmetic_bits = vec![0, 0, 0, 0, 128, 1];
    award_ribbon(&mut candidate, species)?;
    let next_request = candidate
        .identities
        .allocate_platform_request_id()
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let phase = phase_mut(&mut candidate, index)?;
    let head = phase.head.as_mut().ok_or(GameRuntimeV6Error::Invalid)?;
    head.max_clock = Some(request.clone());
    head.max_utc_milliseconds = Some(utc);
    phase.clock = Some(CurrentFriendshipClockRequestV1 {
        request: next_request,
        pending: request.pending,
        recipient: request.recipient,
        purpose: CurrentFriendshipClockPurposeV1::TimedEvent,
    });
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    Ok((candidate, payloads))
}

/// Source event/rate resolution is shared only through the typed Candy receipt.
/// It does not accept a caller-nominated multiplier or synthesize a Faint cursor.
pub(crate) fn candy_rates(
    candy:&er_state::current_reward_candy::CurrentRewardCandyV1,utc:i64,
    difficulty:RunDifficultyV1,wave:u64,
)->Result<(u8,bool,u8),GameRuntimeV6Error>{
    if candy.pokemon_before.id!=candy.holder || candy.profile_before.owner_seat!=candy.pokemon_before.owner_seat.ok_or(GameRuntimeV6Error::Action)?
        || ![candy.max_utc,candy.event_utc].contains(&Some(utc)) {
        return Err(GameRuntimeV6Error::Action);
    }
    let (multiplier,fusions)=event_rate(utc)?;
    Ok((multiplier,fusions,candy_rate(difficulty,wave)?))
}