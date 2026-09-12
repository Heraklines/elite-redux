//! Typed Rare Candy receipt and common-material replay; no Faint/XP stand-in.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error as E;
use er_state::current_reward_candy::{CurrentRewardCandyV1 as Candy,CurrentRewardCandyPhaseV1 as Phase};
use er_state::current_reward_selection::CurrentRewardSelectionV1 as Selection;
use er_state::current_experience_owner::{CurrentFriendshipClockRequestV1 as Clock,CurrentFriendshipClockPurposeV1 as Purpose};
use er_state::m9e_state_v6::GameStateV6;
use er_types::{SafeU53,PresentationEventId};
use er_types::battle_ids::PokemonId;

pub(crate) fn selection(state:&GameStateV6,pending:SafeU53)->Result<&Selection,E>{
    state.current_battle_participation.as_ref().and_then(|p|p.experience.as_ref())
        .and_then(|p|p.pending.iter().find(|p|p.id==pending)).and_then(|p|p.victory_tail.as_ref())
        .and_then(|p|p.reward.as_deref()).ok_or(E::Action)
}
pub(crate) fn owner(state:&GameStateV6,pending:SafeU53)->Result<&Candy,E>{selection(state,pending)?.candy.as_deref().ok_or(E::Action)}
pub(crate) fn owner_mut(state:&mut GameStateV6,pending:SafeU53)->Result<&mut Candy,E>{
    state.current_battle_participation.as_mut().and_then(|p|p.experience.as_mut())
        .and_then(|p|p.pending.iter_mut().find(|p|p.id==pending)).and_then(|p|p.victory_tail.as_mut())
        .and_then(|p|p.reward.as_deref_mut()).and_then(|p|p.candy.as_deref_mut()).ok_or(E::Action)
}
pub(crate) fn clock(candy:&Candy)->Option<&Clock>{
    if !matches!(candy.phase,Phase::Friendship){return None;}
    if candy.max_utc.is_none()&&candy.max_clock.is_some(){candy.max_clock.as_ref()}
    else if candy.event_utc.is_none(){candy.event_clock.as_ref()}else{None}
}
fn allocate(state:&mut GameStateV6,pending:SafeU53,holder:PokemonId,purpose:Purpose)->Result<Clock,E>{
    Ok(Clock{request:state.identities.allocate_platform_request_id().map_err(|_|E::Action)?,pending,recipient:holder,purpose})
}
pub(crate) fn prepare(before:&GameStateV6,content:&PreparedGameContentV2,pending:SafeU53,offer:u8,holder:PokemonId)->Result<GameStateV6,E>{
    let selection=selection(before,pending)?;
    if selection.candy.is_some()||selection.tm.is_some()||!selection.declined_tms.is_empty()
        ||selection.offers.get(usize::from(offer)).is_none_or(|o|o.source_id!="RARE_CANDY"||o.args.is_some())
    {return Err(E::Action);}
    // The fully regenerated offer and positively owned initial inventory prove
    // no candy/friendship booster. Historical absence cannot enter this branch.
    let run=before.active_run.as_ref().ok_or(E::Action)?;
    let pokemon=selection.party_before.iter().find(|p|p.id==holder).ok_or(E::Action)?;
    if run.party!=selection.party_before||!run.modifiers.is_empty()||!selection.run_before.valid(){return Err(E::Action);}
    let mut head_pokemon=crate::current_reward_candy_source::apply_level(pokemon,content)?;
    head_pokemon.stats=pokemon.stats;head_pokemon.hp=pokemon.hp;head_pokemon.max_hp=pokemon.max_hp;
    let profile=before.current_friendship_profile.as_ref().ok_or(E::Action)?;
    if pokemon.owner_seat!=Some(profile.owner_seat){return Err(E::Action);}
    let mut next=before.clone();
    let candy=Candy{pending,offer,holder,pokemon_before:Box::new(pokemon.clone()),profile_before:Box::new(profile.clone()),pokemon_head:Box::new(head_pokemon),
        pokemon_after:None,phase:Phase::Queued,max_clock:None,max_utc:None,
        event_clock:None,event_utc:None,message_event:None,stats_event:None};
    let mut owned=selection.clone();
    owned.stage=er_state::current_reward_selection::CurrentRewardStageV1::CandyPending{offer,holder};
    owned.candy=Some(Box::new(candy));
    crate::current_reward_selection::set_selection(&mut next,pending,owned)?;
    // Source apply begins in the next owned Candy transaction.
    Ok(next)
}

/// Replay all content-bearing Pokemon/account bytes from the actual immutable
/// reward parent. Source clocks remain external inputs bound to owned requests.
pub(crate) fn install_replay(state:&mut GameStateV6,content:&PreparedGameContentV2,pending:SafeU53)->Result<Vec<crate::m9e_material_v6::GamePresentationPayloadV1>,E>{
    let candy=owner(state,pending)?.clone();
    let run=state.active_run.as_ref().ok_or(E::Action)?;
    let difficulty=state.current_run_difficulty.ok_or(E::Action)?;
    if difficulty.run_id!=run.run_id{return Err(E::Action);}
    let frozen=crate::current_reward_candy_source::apply_level(&candy.pokemon_before,content)?;
    let (mut profile,effects)=crate::current_reward_candy_account::replay(&candy,run,content.identity(),difficulty.difficulty)?;
    let mut pokemon=frozen.clone();
    if candy.event_utc.is_none(){
        // Source Date input suspends addFriendship before synchronous calculateStats.
        pokemon.stats=candy.pokemon_before.stats;pokemon.max_hp=candy.pokemon_before.max_hp;pokemon.hp=candy.pokemon_before.hp;
    }else if !matches!(candy.phase,Phase::LevelStart){
        // Actual LevelUp.start, after synchronous Candy stats, owns this update.
        let rewards=profile.rewards.as_mut().ok_or(E::Action)?;
        rewards.highest_level=rewards.highest_level.max(SafeU53::new(u64::from(pokemon.level)).map_err(|_|E::Action)?);
    }
    let target=state.active_run.as_mut().ok_or(E::Action)?.party.iter_mut().find(|p|p.id==candy.holder).ok_or(E::Action)?;
    *target=pokemon;
    state.current_friendship_profile=Some(profile);
    owner_mut(state,pending)?.pokemon_after=candy.event_utc.map(|_|Box::new(frozen));
    Ok(effects)
}

pub(crate) fn settle_clock(before:&GameStateV6,content:&PreparedGameContentV2,request:&Clock,utc:i64)
    ->Result<(GameStateV6,Vec<crate::m9e_material_v6::GamePresentationPayloadV1>),E>{
    let candy=owner(before,request.pending)?;
    if clock(candy)!=Some(request)||request.request.get()>=before.identities.next_platform_request_id
        ||!(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc){return Err(E::Action);}
    let mut next=before.clone();
    match request.purpose {
        Purpose::MaxAchievement=>{
            let follow=allocate(&mut next,request.pending,request.recipient,Purpose::TimedEvent)?;
            let candy=owner_mut(&mut next,request.pending)?;candy.max_utc=Some(utc);candy.event_clock=Some(follow);
        }
        Purpose::TimedEvent=>{
            let candy=owner_mut(&mut next,request.pending)?;candy.event_utc=Some(utc);candy.phase=Phase::LevelStart;
        }
    }
    let all=install_replay(&mut next,content,request.pending)?;
    let run=before.active_run.as_ref().ok_or(E::Action)?;
    let difficulty=before.current_run_difficulty.ok_or(E::Action)?;
    let (_,prior)=crate::current_reward_candy_account::replay(candy,run,content.identity(),difficulty.difficulty)?;
    if !all.starts_with(&prior){return Err(E::Action);}
    Ok((next,all[prior.len()..].to_vec()))
}

pub(crate) fn presentation(candy:&Candy,stats:bool)->Result<crate::m9e_material_v6::GamePresentationPayloadV1,E>{
    let after=candy.pokemon_after.as_ref().ok_or(E::Action)?;
    if stats {Ok(crate::m9e_material_v6::GamePresentationPayloadV1::LevelStats{holder:candy.holder,
        previous_level:candy.pokemon_before.level,level:after.level,previous_stats:candy.pokemon_before.stats,stats:after.stats})}
    else {Ok(crate::m9e_material_v6::GamePresentationPayloadV1::CandyLevelMessage{holder:candy.holder,level:after.level})}
}
pub(crate) fn advance(before:&GameStateV6,content:&PreparedGameContentV2,pending:SafeU53,callback:Option<PresentationEventId>)
    ->Result<(GameStateV6,Option<bool>),E>{
    let candy=owner(before,pending)?;
    let request=match (&candy.phase,callback){
        (Phase::LevelStart,None)=>Some(false),
        (Phase::Message{event_id},Some(received))if *event_id==received=>Some(true),
        (Phase::Stats{event_id},Some(received))if *event_id==received=>None,
        _=>return Err(E::Action),
    };
    let mut next=before.clone();
    if request.is_none(){
        crate::current_reward_candy_source::empty_children(candy.pokemon_after.as_ref().ok_or(E::Action)?,candy.pokemon_before.level,content)?;
        owner_mut(&mut next,pending)?.phase=Phase::Complete;
        let mut selected=selection(&next,pending)?.clone();
        selected.stage=er_state::current_reward_selection::CurrentRewardStageV1::Applied{offer:candy.offer,holder:Some(candy.holder)};
        crate::current_reward_selection::set_selection(&mut next,pending,selected)?;
    }
    // The enclosing owned transition binds the new event/phase before replay.
    Ok((next,request))
}
pub(crate) fn begin(before:&GameStateV6,content:&PreparedGameContentV2,pending:SafeU53)->Result<GameStateV6,E>{
    let candy=owner(before,pending)?;
    if !matches!(candy.phase,Phase::Queued){return Err(E::Action);}
    let needs_max=candy.pokemon_head.friendship==255&&!candy.profile_before.rewards.as_ref().ok_or(E::Action)?.max_is_unlocked();
    let mut next=before.clone();
    let request=allocate(&mut next,pending,candy.holder,if needs_max{Purpose::MaxAchievement}else{Purpose::TimedEvent})?;
    let retained=owner_mut(&mut next,pending)?;
    retained.phase=Phase::Friendship;
    if needs_max{retained.max_clock=Some(request);}else{retained.event_clock=Some(request);}
    let effects=install_replay(&mut next,content,pending)?;
    if !effects.is_empty(){return Err(E::Action);}
    Ok(next)
}
pub(crate) fn validate_live(state:&GameStateV6,pending:SafeU53)->Result<(),E>{
    let selection=selection(state,pending)?;let candy=owner(state,pending)?;
    let run=state.active_run.as_ref().ok_or(E::Action)?;
    let difficulty=state.current_run_difficulty.ok_or(E::Action)?;
    if candy.pending!=pending||selection.tm.is_some()||!selection.declined_tms.is_empty()
        ||selection.party_before.len()!=1||selection.party_before[0]!=*candy.pokemon_before
        ||candy.pokemon_before.id!=candy.holder||difficulty.run_id!=run.run_id
        ||selection.offers.get(usize::from(candy.offer)).is_none_or(|o|o.source_id!="RARE_CANDY"||o.args.is_some())
        ||run.party.len()!=1{return Err(E::Action);}
    let expected_stage=if matches!(candy.phase,Phase::Complete){
        er_state::current_reward_selection::CurrentRewardStageV1::Applied{offer:candy.offer,holder:Some(candy.holder)}
    }else{er_state::current_reward_selection::CurrentRewardStageV1::CandyPending{offer:candy.offer,holder:candy.holder}};
    if selection.stage!=expected_stage{return Err(E::Action);}
    let needs_max=candy.pokemon_head.friendship==255&&!candy.profile_before.rewards.as_ref().ok_or(E::Action)?.max_is_unlocked();
    for (request,purpose) in [(candy.max_clock.as_ref(),Purpose::MaxAchievement),(candy.event_clock.as_ref(),Purpose::TimedEvent)]{
        if request.is_some_and(|r|r.request.get()==SafeU53::ZERO||r.pending!=pending||r.recipient!=candy.holder||r.purpose!=purpose
            ||r.request.get()>=state.identities.next_platform_request_id){return Err(E::Action);}
    }
    if candy.max_utc.is_some()&&candy.max_clock.is_none()||candy.event_utc.is_some()&&candy.event_clock.is_none()
        ||candy.max_clock.as_ref().zip(candy.event_clock.as_ref()).is_some_and(|(a,b)|a.request>=b.request)
        ||(!needs_max&&(candy.max_clock.is_some()||candy.max_utc.is_some())){return Err(E::Action);}
    let mut head=(*candy.pokemon_before).clone();
    head.level=head.level.checked_add(1).ok_or(E::Action)?;
    head.experience=candy.pokemon_head.experience; // Content replay below proves the growth threshold.
    head.friendship=crate::current_reward_candy_source::friendship(head.friendship)?;
    if head!=*candy.pokemon_head{return Err(E::Action);}
    let queued=matches!(candy.phase,Phase::Queued);
    let complete_friendship=!matches!(candy.phase,Phase::Queued|Phase::Friendship);
    if queued&&(candy.max_clock.is_some()||candy.event_clock.is_some())
        ||!queued&&needs_max&&candy.max_clock.is_none()
        ||!queued&&(!needs_max||candy.max_utc.is_some())&&candy.event_clock.is_none()
        ||complete_friendship!=candy.event_utc.is_some()
        ||complete_friendship!=candy.pokemon_after.is_some(){return Err(E::Action);}
    let mut expected_pokemon=if queued {(*candy.pokemon_before).clone()}else{head};
    if let Some(frozen)=&candy.pokemon_after{expected_pokemon=(**frozen).clone();}
    if run.party[0]!=expected_pokemon{return Err(E::Action);}
    let mut profile=if queued{(*candy.profile_before).clone()}else{
        crate::current_reward_candy_account::replay(candy,run,&state.content_identity,difficulty.difficulty)?.0
    };
    if matches!(candy.phase,Phase::Message{..}|Phase::Stats{..}|Phase::Complete){
        let rewards=profile.rewards.as_mut().ok_or(E::Action)?;
        rewards.highest_level=rewards.highest_level.max(SafeU53::new(u64::from(expected_pokemon.level)).map_err(|_|E::Action)?);
    }
    if state.current_friendship_profile.as_ref()!=Some(&profile){return Err(E::Action);}
    match candy.phase{
        Phase::Queued|Phase::Friendship|Phase::LevelStart if candy.message_event.is_none()&&candy.stats_event.is_none()=>{},
        Phase::Message{event_id} if candy.message_event==Some(event_id)&&candy.stats_event.is_none()=>{},
        Phase::Stats{event_id} if candy.stats_event==Some(event_id)&&candy.message_event.is_some_and(|old|old<event_id)=>{},
        Phase::Complete if candy.message_event.zip(candy.stats_event).is_some_and(|(a,b)|a<b)=>{},
        _=>return Err(E::Action),
    }
    Ok(())
}

pub(crate) fn validate(state:&GameStateV6,content:&PreparedGameContentV2,pending:SafeU53)->Result<(),E>{
    validate_live(state,pending)?;
    let candy=owner(state,pending)?;
    let frozen=crate::current_reward_candy_source::apply_level(&candy.pokemon_before,content)?;
    let mut head=frozen.clone();head.stats=candy.pokemon_before.stats;head.hp=candy.pokemon_before.hp;head.max_hp=candy.pokemon_before.max_hp;
    if head!=*candy.pokemon_head||candy.pokemon_after.as_deref().is_some_and(|p|p!=&frozen){return Err(E::Action);}
    for (event,stats) in [(candy.message_event,false),(candy.stats_event,true)]{
        let Some(event_id)=event else{continue;};
        let semantic=crate::m9e_content_v2::PresentationSemanticIdV1::Cue(crate::m9e_content_v2::PresentationCueFamilyV1::Progression);
        let mapping=content.presentation(semantic).ok_or(E::Action)?;
        let effect=crate::m9e_material_v6::GamePresentationEffectV2{event_id,semantic,blocking:mapping.blocking,skip:mapping.skip,payload:Some(presentation(candy,stats)?)};
        let hash=er_canonical::fixture_digest(&effect).map_err(|_|E::Action)?;
        if mapping.blocking!=er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
            ||state.current_presentation.as_ref().is_none_or(|owner|!owner.receipts.iter().any(|r|r.event_id==event_id&&r.effect_sha256==hash))
        {return Err(E::Action);}
    }
    Ok(())
}