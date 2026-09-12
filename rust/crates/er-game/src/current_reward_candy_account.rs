//! Replay the actual reward-addressed addFriendship(6,true) account tail.
use er_types::GameContentIdentityV2;
use crate::m9e_material_v6::{GamePresentationPayloadV1 as P, GamePresentationAchievementV1 as A};
use crate::m9e_runtime_v6::GameRuntimeV6Error as E;
use er_state::current_reward_candy::CurrentRewardCandyV1 as Candy;
use er_state::current_friendship_profile::{CurrentFriendshipProfileV1,CurrentFriendshipRibbonV1,CURRENT_FRIENDSHIP_RIBBON_V1};
use er_state::m7_state::RunStateV3;
use er_types::{RunDifficultyV1,SafeU53};
use er_progression::current_friendship::{ExistingStarterAccount,FriendshipSourceProvenance,ResolvedPositiveFriendship,
    ResolvedFriendshipStarter,ResolvedFriendshipMode,PINNED_FRIENDSHIP_CAPS};
use er_progression::current_friendship_phase::{prepare_phase_head,finish_phase_tail};

fn safe(value:u64)->Result<SafeU53,E>{SafeU53::new(value).map_err(|_|E::Action)}

pub(crate) fn replay(
    candy:&Candy,run:&RunStateV3,identity:&GameContentIdentityV2,difficulty:RunDifficultyV1,
)->Result<(CurrentFriendshipProfileV1,Vec<P>),E>{
    let mut profile=(*candy.profile_before).clone();
    let pokemon=&candy.pokemon_before;
    let after=super::current_reward_candy_source::friendship(pokemon.friendship)?;
    let mut effects=Vec::new();
    let rewards=profile.rewards.as_ref().ok_or(E::Action)?;
    let needs_max=after==255&&!rewards.max_is_unlocked();
    if candy.max_utc.is_some()&&!needs_max{return Err(E::Action);}
    if needs_max {
        let Some(utc)=candy.max_utc else {
            if candy.event_utc.is_some(){return Err(E::Action);}
            return Ok((profile,effects));
        };
        crate::current_friendship_execution::candy_rates(candy,utc,difficulty,run.wave.get().get())?;
        // The shared recipe applies the difficulty multiplier exactly once.
        let per_mon=10;
        let (mut updated,team)=crate::current_achievement_rewards::prepare_achievement_team_candy(
            &profile,run,difficulty,per_mon)?;
        let rewards=updated.rewards.as_mut().ok_or(E::Action)?;
        rewards.max_friendship_unlocked_at=Some(utc);
        rewards.cosmetic_bits=vec![0,0,0,0,128,1];
        effects.push(P::AchievementUnlocked{achievement:A::MaxFriendship,utc_milliseconds:utc});
        effects.extend(team);profile=updated;
    }
    if after==255 {
        let rewards=profile.rewards.as_mut().ok_or(E::Action)?;
        if let Err(index)=rewards.ribbons.binary_search_by_key(&pokemon.species_id,|row|row.species){
            rewards.ribbons.insert(index,CurrentFriendshipRibbonV1{species:pokemon.species_id,bits:safe(CURRENT_FRIENDSHIP_RIBBON_V1)?});
        }
    }
    let Some(utc)=candy.event_utc else{return Ok((profile,effects));};
    let (multiplier,fusions,rate)=crate::current_friendship_execution::candy_rates(candy,utc,difficulty,run.wave.get().get())?;
    let source_id=u32::try_from(pokemon.species_id.get().get()).map_err(|_|E::Action)?;
    let cost=crate::current_friendship_profile::PINNED_STARTER_COSTS.iter()
        .find(|(id,_)|*id==source_id).map(|(_,cost)|*cost).ok_or(E::Action)?;
    let index=profile.accounts.binary_search_by_key(&pokemon.species_id,|row|row.species).map_err(|_|E::Action)?;
    let account=&profile.accounts[index];
    let resolution=er_canonical::fixture_digest(&(identity,candy.pending,candy.offer,candy.holder,
        candy.event_clock.as_ref(),utc,difficulty,run.wave,cost,multiplier,rate)).map_err(|_|E::Action)?;
    let resolved=ResolvedPositiveFriendship{
        provenance:FriendshipSourceProvenance{oracle_sha:identity.oracle_sha.as_str().to_owned(),resolution_sha256:resolution},
        pokemon_species:source_id,starter:ResolvedFriendshipStarter{source_root:source_id,candy_account_root:source_id,starter_cost:f64::from(cost)},
        fusion_starter:None,boosted_amount:6.0,capped:true,fun_debug:false,
        mode:ResolvedFriendshipMode::Classic{candy_multiplier:f64::from(multiplier)},event_boosts_fusions:fusions,
        friendship_caps:PINNED_FRIENDSHIP_CAPS.to_vec(),total_candy_rate:rate,
    };
    let head=prepare_phase_head(f64::from(pokemon.friendship),6.0,Some(6.0),true,false).map_err(|_|E::Action)?;
    let tail=finish_phase_tail(&head,&[ExistingStarterAccount{species_id:source_id,
        friendship_progress:account.friendship_progress.get(),candy_count:i64::try_from(account.candy_count.get()).map_err(|_|E::Action)?}],&resolved).map_err(|_|E::Action)?;
    if tail.plan.friendship!=f64::from(after)||tail.plan.accounts.len()!=1{return Err(E::Action);}
    let result=&tail.plan.accounts[0];
    profile.accounts[index].friendship_progress=safe(result.friendship_progress)?;
    profile.accounts[index].candy_count=safe(u64::try_from(result.candy_count).map_err(|_|E::Action)?)?;
    for intent in tail.plan.intents {
        let er_progression::current_friendship::FriendshipIntent::ShowStarterCandy{root,scaled_count,before_candy,after_candy}=intent
            else{return Err(E::Action);};
        effects.push(P::StarterCandy{root:er_types::battle_ids::SpeciesId::new(safe(u64::from(root))?),scaled_count,
            before_candy:safe(u64::try_from(before_candy).map_err(|_|E::Action)?)?,after_candy:safe(u64::try_from(after_candy).map_err(|_|E::Action)?)?});
    }
    Ok((profile,effects))
}