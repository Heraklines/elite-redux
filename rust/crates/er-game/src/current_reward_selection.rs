//! First live source reward owner. Generation is replayed from captured live
//! predicates; selection accepts an ordinal only, never a client effect payload.
use crate::current_reward_first_pool::FirstRewardPool;
use crate::current_reward_healing::{HealingContext, HealingItem, heal};
use crate::current_reward_roll::{Offer, PregenArgs, RollError};
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error as Error;
use er_state::current_initial_victory_tail::{
    CurrentInitialVictoryTailPhaseV1 as Phase, CurrentInitialVictoryTailV1 as Tail,
};
use er_state::current_reward_run::CurrentRewardRunV1;
use er_state::current_reward_selection::{
    CurrentRewardArgsV1 as Args, CurrentRewardOfferV1 as OwnedOffer,
    CurrentRewardSelectionV1 as Selection, CurrentRewardSpeciesItemV1 as Species,
    CurrentRewardStageV1 as Stage,
};
use er_state::m7_state::PokemonStateV5;
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::{MenuInstanceId, PokemonId};
use er_types::{
    GameActionV1, GameControlKindV2, GameMenuCancelV2, OperationId, RewardActionV1, SafeU53, SeatId,
};
fn invalid() -> Error {
    Error::Action
}
fn source_error(_: RollError) -> Error {
    Error::Domain("source reward context or generator is unresolved".into())
}
fn tail(state: &GameStateV6, id: SafeU53) -> Result<&Tail, Error> {
    let owner = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .ok_or_else(invalid)?;
    if owner.pending.len() != 1 {
        return Err(invalid());
    }
    owner
        .pending
        .first()
        .filter(|p| p.id == id)
        .and_then(|p| p.victory_tail.as_ref())
        .ok_or_else(invalid)
}
fn set_selection(state: &mut GameStateV6, id: SafeU53, value: Selection) -> Result<(), Error> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.iter_mut().find(|p| p.id == id))
        .and_then(|p| p.victory_tail.as_mut())
        .ok_or_else(invalid)?
        .reward = Some(Box::new(value));
    Ok(())
}
fn owned_run(state: &GameStateV6) -> Result<&CurrentRewardRunV1, Error> {
    state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.source_progression.as_ref())
        .and_then(|s| s.reward_run.as_ref())
        .ok_or_else(invalid)
}
fn set_run(state: &mut GameStateV6, value: CurrentRewardRunV1) -> Result<(), Error> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.source_progression.as_mut())
        .ok_or_else(invalid)?
        .reward_run = Some(value);
    Ok(())
}
fn owned(offer: Offer) -> OwnedOffer {
    use crate::current_reward_generators::SpeciesItem as S;
    let args = offer.pregen_args.map(|a| match a {
        PregenArgs::Berry { kind } => Args::Berry { kind },
        PregenArgs::TemporaryStat { stat } => Args::TemporaryStat { stat },
        PregenArgs::BaseStat { stat } => Args::BaseStat { stat },
        PregenArgs::Mint { nature } => Args::Mint { nature },
        PregenArgs::AttackType { kind } => Args::AttackType { kind },
        PregenArgs::Tera { kind } => Args::Tera { kind },
        PregenArgs::EvolutionItem { item } => Args::EvolutionItem { item },
        PregenArgs::SpeciesItem(key) => Args::SpeciesItem {
            key: match key {
                S::LightBall => Species::LightBall,
                S::ThickClub => Species::ThickClub,
                S::MetalPowder => Species::MetalPowder,
                S::QuickPowder => Species::QuickPowder,
                S::DeepSeaScale => Species::DeepSeaScale,
                S::DeepSeaTooth => Species::DeepSeaTooth,
            },
        },
    });
    OwnedOffer {
        source_id: offer.id,
        name: offer.name,
        group: offer.group,
        tier: offer.tier,
        upgrade_count: offer.upgrade_count,
        args,
    }
}
fn generate(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(Selection, er_rng::phaser::PhaserRdgState), Error> {
    let run = state.active_run.as_ref().ok_or_else(invalid)?;
    let run_before = owned_run(state)?.clone();
    let mut pool =
        FirstRewardPool::from_state(state, content, &run_before).map_err(source_error)?;
    // Source updateSeed resets the stream before regeneration. This records the
    // reset state, not a claim that the preceding battle RNG already equals it.
    let rng_before = pool.state().state_string;
    let mut budget = 4096;
    pool.regenerate(&mut budget).map_err(source_error)?;
    let rng_regenerated = pool.state().state_string;
    let offers = crate::current_reward_roll::three_options_with_budget(&mut pool, &mut budget)
        .map_err(source_error)?
        .into_iter()
        .map(owned)
        .collect();
    let after = pool.state();
    Ok((
        Selection {
            offers,
            rng_before,
            rng_regenerated,
            rng_audit: pool.audit(),
            rng_after: after.state_string.clone(),
            party_before: run.party.clone(),
            run_before,
            stage: Stage::Choice,
        },
        after,
    ))
}
pub(crate) fn begin(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<GameStateV6, Error> {
    crate::current_initial_victory_tail::validate(before, id)?;
    let existing = tail(before, id)?;
    if !matches!(existing.phase, Phase::RewardSelectionPending { .. }) || existing.reward.is_some()
    {
        return Err(invalid());
    }
    let (selection, rng) = generate(before, content)?;
    if !selection.structurally_valid() {
        return Err(invalid());
    }
    let mut state = before.clone();
    state.active_run.as_mut().ok_or_else(invalid)?.run_rng.rdg = rng;
    set_selection(&mut state, id, selection)?;
    validate(&state, content, id)?;
    Ok(state)
}
fn healing(id: &str) -> Option<HealingItem> {
    match id {
        "POTION" => Some(HealingItem::Potion),
        "SUPER_POTION" => Some(HealingItem::SuperPotion),
        "HYPER_POTION" => Some(HealingItem::HyperPotion),
        "MAX_POTION" => Some(HealingItem::MaxPotion),
        _ => None,
    }
}
fn apply(
    selection: &Selection,
    offer: u8,
    holder: Option<PokemonId>,
) -> Result<(Vec<PokemonStateV5>, CurrentRewardRunV1), Error> {
    let option = selection
        .offers
        .get(usize::from(offer))
        .ok_or_else(invalid)?;
    let mut party = selection.party_before.clone();
    let mut inventory = selection.run_before.clone();
    if option.args.is_some() {
        return Err(Error::Domain(
            "source generated reward effect is unresolved".into(),
        ));
    }
    let ball = match option.source_id.as_str() {
        "POKEBALL" => Some(0),
        "GREAT_BALL" => Some(1),
        "ULTRA_BALL" => Some(2),
        "ROGUE_BALL" => Some(3),
        "MASTER_BALL" => Some(4),
        _ => None,
    };
    let lure = match option.source_id.as_str() {
        "LURE" => Some(10),
        "SUPER_LURE" => Some(15),
        "MAX_LURE" => Some(30),
        _ => None,
    };
    if let Some(kind) = ball {
        if holder.is_some() {
            return Err(invalid());
        }
        inventory.add_ball_reward(kind).map_err(|_| invalid())?;
    } else if let Some(duration) = lure {
        if holder.is_some() || !inventory.add_lure(duration).map_err(|_| invalid())? {
            return Err(invalid());
        }
    } else if let Some(item) = healing(&option.source_id) {
        let pokemon = party
            .iter_mut()
            .find(|p| Some(p.id) == holder)
            .ok_or_else(invalid)?;
        if pokemon.hp == 0 || pokemon.hp >= pokemon.max_hp || pokemon.fainted {
            return Err(invalid());
        }
        *pokemon = heal(pokemon, item, HealingContext::SourceNeutralMultiplierOne)
            .map_err(|_| invalid())?;
    } else {
        return Err(Error::Domain(format!(
            "source {} reward descendants remain unresolved",
            option.source_id
        )));
    }
    Ok((party, inventory))
}
/// Structural replay is deliberately nonrecursive. It owns all live changes
/// after the immutable XP preimage, including the complete Pokemon values.
pub(crate) fn validate_live(state: &GameStateV6, id: SafeU53) -> Result<(), Error> {
    let tail = tail(state, id)?;
    let Some(selection) = tail.reward.as_deref() else {
        return Ok(());
    };
    if !matches!(tail.phase, Phase::RewardSelectionPending { .. })
        || !selection.structurally_valid()
    {
        return Err(invalid());
    }
    let run = state.active_run.as_ref().ok_or_else(invalid)?;
    if run.run_rng.rdg.state_string != selection.rng_after {
        return Err(invalid());
    }
    let (party, inventory) = match selection.stage {
        Stage::Applied { offer, holder } => apply(selection, offer, holder)?,
        Stage::Holder { offer } => {
            let option = selection
                .offers
                .get(usize::from(offer))
                .ok_or_else(invalid)?;
            if option.args.is_some() || healing(&option.source_id).is_none() {
                return Err(invalid());
            }
            (selection.party_before.clone(), selection.run_before.clone())
        }
        Stage::Choice => (selection.party_before.clone(), selection.run_before.clone()),
    };
    if party != run.party || &inventory != owned_run(state)? {
        return Err(invalid());
    }
    Ok(())
}
/// Full content validation regenerates the entire menu on a retained preimage.
/// It does not call state.validate(), tail projection, or itself recursively.
pub(crate) fn validate(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<(), Error> {
    validate_live(state, id)?;
    let Some(selection) = tail(state, id)?.reward.as_deref() else {
        return Ok(());
    };
    let mut before = state.clone();
    before.active_run.as_mut().ok_or_else(invalid)?.party = selection.party_before.clone();
    set_run(&mut before, selection.run_before.clone())?;
    let (expected, _) = generate(&before, content)?;
    if expected.rng_audit != selection.rng_audit
        || expected.offers != selection.offers
        || expected.rng_before != selection.rng_before
        || expected.rng_regenerated != selection.rng_regenerated
        || expected.rng_after != selection.rng_after
    {
        return Err(invalid());
    }
    Ok(())
}
pub(crate) fn select(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
    ordinal: u32,
) -> Result<GameStateV6, Error> {
    validate(before, content, id)?;
    let mut selection = tail(before, id)?
        .reward
        .as_deref()
        .ok_or_else(invalid)?
        .clone();
    let (offer, holder) = match selection.stage {
        Stage::Choice => {
            let index = usize::try_from(ordinal).map_err(|_| invalid())?;
            let option = selection.offers.get(index).ok_or_else(invalid)?;
            let offer = u8::try_from(index).map_err(|_| invalid())?;
            if healing(&option.source_id).is_some() {
                selection.stage = Stage::Holder { offer };
                let mut state = before.clone();
                set_selection(&mut state, id, selection)?;
                validate(&state, content, id)?;
                return Ok(state);
            }
            (offer, None)
        }
        Stage::Holder { offer } => {
            let p = selection
                .party_before
                .get(usize::try_from(ordinal).map_err(|_| invalid())?)
                .ok_or_else(invalid)?;
            (offer, Some(p.id))
        }
        Stage::Applied { .. } => return Err(invalid()),
    };
    let (party, inventory) = apply(&selection, offer, holder)?;
    selection.stage = Stage::Applied { offer, holder };
    let mut state = before.clone();
    state.active_run.as_mut().ok_or_else(invalid)?.party = party;
    set_run(&mut state, inventory)?;
    set_selection(&mut state, id, selection)?;
    validate(&state, content, id)?;
    Ok(state)
}
pub(crate) fn cancel_holder(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<GameStateV6, Error> {
    validate(before, content, id)?;
    let mut selection = tail(before, id)?
        .reward
        .as_deref()
        .ok_or_else(invalid)?
        .clone();
    if !matches!(selection.stage, Stage::Holder { .. }) {
        return Err(invalid());
    }
    selection.stage = Stage::Choice;
    let mut state = before.clone();
    set_selection(&mut state, id, selection)?;
    validate(&state, content, id)?;
    Ok(state)
}
pub(crate) fn install_control(
    state: &mut GameStateV6,
    id: SafeU53,
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
) -> Result<(), Error> {
    let selection = tail(state, id)?.reward.as_deref().ok_or_else(invalid)?;
    let run = state.active_run.as_ref().ok_or_else(invalid)?;
    if selection
        .party_before
        .iter()
        .any(|p| p.owner_seat != Some(seat))
    {
        return Err(invalid());
    }
    let action = |ordinal| GameActionV1::Reward {
        action: RewardActionV1::Select {
            option_ordinal: ordinal,
        },
    };
    let (entries, cancel) = match selection.stage {
        Stage::Choice => (
            selection
                .offers
                .iter()
                .enumerate()
                .map(|(i, _)| (format!("reward/{}/offer/{i}", id.get()), action(i as u32)))
                .collect::<Vec<_>>(),
            GameMenuCancelV2::Disabled,
        ),
        Stage::Holder { .. } => (
            run.party
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    (
                        format!("reward/{}/holder/{}", id.get(), p.id.get().get()),
                        action(i as u32),
                    )
                })
                .collect::<Vec<_>>(),
            GameMenuCancelV2::Back {
                action: Box::new(GameActionV1::Reward {
                    action: RewardActionV1::Decline,
                }),
            },
        ),
        Stage::Applied { .. } => return Err(invalid()),
    };
    let operation = OperationId::new(format!(
        "m9e/reward/{}/{}/{}",
        id.get(),
        instance.get().get(),
        revision.get()
    ))
    .map_err(|_| invalid())?;
    let control = crate::m7_progression_control::generic_vertical_control_v2(
        instance,
        revision,
        seat,
        operation,
        GameControlKindV2::Reward,
        "m9e/current-reward",
        &entries,
        cancel,
    )
    .map_err(|_| invalid())?;
    state.active_run.as_mut().ok_or_else(invalid)?.control = control;
    Ok(())
}
pub(crate) fn audit(
    state: &GameStateV6,
    id: SafeU53,
) -> Result<Vec<er_rng::audit::RngDraw>, Error> {
    Ok(tail(state, id)?
        .reward
        .as_deref()
        .ok_or_else(invalid)?
        .rng_audit
        .clone())
}
