//! First live source reward owner. Generation is replayed from captured live
//! predicates; selection accepts an ordinal only, never a client effect payload.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error as Error;
use crate::current_reward_first_pool::FirstRewardPool;
use crate::current_reward_roll::{Offer, PregenArgs, RollError};
use crate::current_reward_healing::{heal, HealingItem, HealingContext};
use er_state::current_reward_selection::{CurrentRewardSelectionV1 as Selection, CurrentRewardOfferV1 as OwnedOffer, CurrentRewardArgsV1 as Args, CurrentRewardStageV1 as Stage, CurrentRewardSpeciesItemV1 as Species};
use er_state::current_reward_run::CurrentRewardRunV1;
use er_state::current_initial_victory_tail::{CurrentInitialVictoryTailV1 as Tail, CurrentInitialVictoryTailPhaseV1 as Phase};
use er_state::m9e_state_v6::GameStateV6;
use er_state::m7_state::PokemonStateV5;
use er_types::battle_ids::{MenuInstanceId, PokemonId};
use er_types::{SafeU53, SeatId, GameActionV1, RewardActionV1, GameMenuCancelV2, GameControlKindV2, OperationId};
fn invalid()->Error { Error::Action }
fn source_error(_:RollError)->Error { Error::Domain("source reward context or generator is unresolved".into()) }
fn tail(state:&GameStateV6,id:SafeU53)->Result<&Tail,Error>{
    let owner=state.current_battle_participation.as_ref().and_then(|p|p.experience.as_ref()).ok_or_else(invalid)?;
    if owner.pending.len()!=1{return Err(invalid());}
    owner.pending.first().filter(|p|p.id==id).and_then(|p|p.victory_tail.as_ref()).ok_or_else(invalid)
}
pub(crate) fn set_selection(state:&mut GameStateV6,id:SafeU53,value:Selection)->Result<(),Error>{
    state.current_battle_participation.as_mut().and_then(|p|p.experience.as_mut()).and_then(|o|o.pending.iter_mut().find(|p|p.id==id)).and_then(|p|p.victory_tail.as_mut()).ok_or_else(invalid)?.reward=Some(Box::new(value));
    Ok(())
}
fn owned_run(state:&GameStateV6)->Result<&CurrentRewardRunV1,Error>{
    state.current_battle_participation.as_ref().and_then(|p|p.experience.as_ref()).and_then(|o|o.source_progression.as_ref()).and_then(|s|s.reward_run.as_ref()).ok_or_else(invalid)
}
fn set_run(state:&mut GameStateV6,value:CurrentRewardRunV1)->Result<(),Error>{
    state.current_battle_participation.as_mut().and_then(|p|p.experience.as_mut()).and_then(|o|o.source_progression.as_mut()).ok_or_else(invalid)?.reward_run=Some(value);Ok(())
}
fn owned(offer:Offer)->OwnedOffer {
    use crate::current_reward_generators::SpeciesItem as S;
    let args=offer.pregen_args.map(|a|match a{
        PregenArgs::Berry{kind}=>Args::Berry{kind},PregenArgs::TemporaryStat{stat}=>Args::TemporaryStat{stat},
        PregenArgs::BaseStat{stat}=>Args::BaseStat{stat},PregenArgs::Mint{nature}=>Args::Mint{nature},
        PregenArgs::AttackType{kind}=>Args::AttackType{kind},PregenArgs::Tera{kind}=>Args::Tera{kind},
        PregenArgs::EvolutionItem{item}=>Args::EvolutionItem{item},PregenArgs::SpeciesItem(key)=>Args::SpeciesItem{key:match key{
            S::LightBall=>Species::LightBall,S::ThickClub=>Species::ThickClub,S::MetalPowder=>Species::MetalPowder,
            S::QuickPowder=>Species::QuickPowder,S::DeepSeaScale=>Species::DeepSeaScale,S::DeepSeaTooth=>Species::DeepSeaTooth,
        }},
    });
    OwnedOffer{source_id:offer.id,name:offer.name,group:offer.group,tier:offer.tier,upgrade_count:offer.upgrade_count,args}
}
fn generate(state:&GameStateV6,content:&PreparedGameContentV2)->Result<(Selection,er_rng::phaser::PhaserRdgState),Error>{
    let run=state.active_run.as_ref().ok_or_else(invalid)?;
    let run_before=owned_run(state)?.clone();
    let mut pool=FirstRewardPool::from_state(state,content,&run_before).map_err(source_error)?;
    // Source updateSeed resets the stream before regeneration. This records the
    // reset state, not a claim that the preceding battle RNG already equals it.
    let rng_before=pool.state().state_string;let mut budget=4096;
    pool.regenerate(&mut budget).map_err(source_error)?;
    let rng_regenerated=pool.state().state_string;
    let offers=crate::current_reward_roll::three_options_with_budget(&mut pool,&mut budget).map_err(source_error)?.into_iter().map(owned).collect();
    let after=pool.state();
    Ok((Selection{offers,rng_before,rng_regenerated,rng_audit:pool.audit(),rng_after:after.state_string.clone(),party_before:run.party.clone(),run_before,stage:Stage::Choice,tm:None,declined_tms:Vec::new()},after))
}
pub(crate) fn begin(before:&GameStateV6,content:&PreparedGameContentV2,id:SafeU53)->Result<GameStateV6,Error>{
    crate::current_initial_victory_tail::validate(before,id)?;
    let existing=tail(before,id)?;
    if !matches!(existing.phase,Phase::RewardSelectionPending{..})||existing.reward.is_some(){return Err(invalid());}
    let (selection,rng)=generate(before,content)?;
    if !selection.structurally_valid(){return Err(invalid());}
    let mut state=before.clone();state.active_run.as_mut().ok_or_else(invalid)?.run_rng.rdg=rng;
    set_selection(&mut state,id,selection)?;validate(&state,content,id)?;Ok(state)
}
fn healing(id:&str)->Option<HealingItem>{match id{
    "POTION"=>Some(HealingItem::Potion),"SUPER_POTION"=>Some(HealingItem::SuperPotion),
    "HYPER_POTION"=>Some(HealingItem::HyperPotion),"MAX_POTION"=>Some(HealingItem::MaxPotion),_=>None,
}}
fn apply(selection:&Selection,offer:u8,holder:Option<PokemonId>)->Result<(Vec<PokemonStateV5>,CurrentRewardRunV1),Error>{
    let option=selection.offers.get(usize::from(offer)).ok_or_else(invalid)?;
    let mut party=selection.party_before.clone();let mut inventory=selection.run_before.clone();
    if option.args.is_some(){return Err(Error::Domain("source generated reward effect is unresolved".into()));}
    let ball=match option.source_id.as_str(){"POKEBALL"=>Some(0),"GREAT_BALL"=>Some(1),"ULTRA_BALL"=>Some(2),"ROGUE_BALL"=>Some(3),"MASTER_BALL"=>Some(4),_=>None};
    let lure=match option.source_id.as_str(){"LURE"=>Some(10),"SUPER_LURE"=>Some(15),"MAX_LURE"=>Some(30),_=>None};
    if let Some(kind)=ball {if holder.is_some(){return Err(invalid());}inventory.add_ball_reward(kind).map_err(|_|invalid())?;}
    else if let Some(duration)=lure {if holder.is_some()||!inventory.add_lure(duration).map_err(|_|invalid())?{return Err(invalid());}}
    else if let Some(item)=healing(&option.source_id){
        let pokemon=party.iter_mut().find(|p|Some(p.id)==holder).ok_or_else(invalid)?;
        if pokemon.hp==0||pokemon.hp>=pokemon.max_hp||pokemon.fainted{return Err(invalid());}
        *pokemon=heal(pokemon,item,HealingContext::SourceNeutralMultiplierOne).map_err(|_|invalid())?;
    }else{return Err(Error::Domain(format!("source {} reward descendants remain unresolved",option.source_id)));}
    Ok((party,inventory))
}
/// Structural replay is deliberately nonrecursive. It owns all live changes
/// after the immutable XP preimage, including the complete Pokemon values.
pub(crate) fn validate_live(state:&GameStateV6,id:SafeU53)->Result<(),Error>{
    let tail=tail(state,id)?;
    let Some(selection)=tail.reward.as_deref()else{return Ok(());};
    if !matches!(tail.phase,Phase::RewardSelectionPending{..})||!selection.structurally_valid(){return Err(invalid());}
    let run=state.active_run.as_ref().ok_or_else(invalid)?;
    if run.run_rng.rdg.state_string!=selection.rng_after{return Err(invalid());}
    for declined in &selection.declined_tms {
        if !matches!(declined.phase,er_state::current_reward_tm::CurrentRewardTmPhaseV1::Declined{..}){return Err(invalid());}
        let replay=crate::current_reward_tm::replay(state,selection,declined)?;
        let tracker=selection.tm.as_ref().map(|tm|tm.tracker_before.as_ref()).or(state.current_achievement_tracker.as_ref()).ok_or_else(invalid)?;
        if replay.party!=selection.party_before||replay.history!=er_state::current_reward_tm::CurrentUsedTmsV1::Undefined||&replay.tracker!=tracker{return Err(invalid());}
    }
    if let Some(tm)=selection.tm.as_deref(){
        use er_state::current_reward_tm::CurrentRewardTmPhaseV1 as T;
        if matches!(tm.phase,T::Declined{..})&&matches!(selection.stage,Stage::Choice){
            let replay=crate::current_reward_tm::replay(state,selection,tm)?;
            if replay.party!=run.party||replay.history!=*crate::current_reward_tm::history(state,tm.holder)?
                ||state.current_achievement_tracker.as_ref()!=Some(&replay.tracker)||owned_run(state)?!=&selection.run_before{return Err(invalid());}
            return Ok(());
        }
        let (offer,holder)=match selection.stage {
            Stage::TmPending{offer,holder} if !matches!(tm.phase,T::Complete{..}|T::Declined{..})=>(offer,holder),
            Stage::Applied{offer,holder:Some(holder)} if matches!(tm.phase,T::Complete{..})=>(offer,holder),
            _=>return Err(invalid()),
        };
        if holder!=tm.holder||selection.offers.get(usize::from(offer)).is_none_or(|o|o.source_id!="TM_CASE"||o.args.is_some()){return Err(invalid());}
        let replay=crate::current_reward_tm::replay(state,selection,tm)?;
        if replay.party!=run.party||replay.history!=*crate::current_reward_tm::history(state,holder)?
            ||state.current_achievement_tracker.as_ref()!=Some(&replay.tracker)||owned_run(state)?!=&selection.run_before{return Err(invalid());}
        return Ok(());
    }
    let (party,inventory)=match selection.stage{
        Stage::Applied{offer,holder}=>apply(selection,offer,holder)?,
        Stage::Holder{offer}=>{
            let option=selection.offers.get(usize::from(offer)).ok_or_else(invalid)?;
            if option.args.is_some()||(healing(&option.source_id).is_none()&&option.source_id!="TM_CASE"){return Err(invalid());}
            (selection.party_before.clone(),selection.run_before.clone())
        },
        Stage::TmMove{offer,holder}=>{
            if selection.offers.get(usize::from(offer)).is_none_or(|o|o.source_id!="TM_CASE"||o.args.is_some())
                ||!selection.party_before.iter().any(|p|p.id==holder){return Err(invalid());}
            (selection.party_before.clone(),selection.run_before.clone())
        },
        Stage::TmPending{..}=>return Err(invalid()),
        Stage::Choice=>(selection.party_before.clone(),selection.run_before.clone()),
    };
    if party!=run.party||&inventory!=owned_run(state)?{return Err(invalid());}Ok(())
}
/// Full content validation regenerates the entire menu on a retained preimage.
/// It does not call state.validate(), tail projection, or itself recursively.
pub(crate) fn validate(state:&GameStateV6,content:&PreparedGameContentV2,id:SafeU53)->Result<(),Error>{
    validate_live(state,id)?;
    let Some(selection)=tail(state,id)?.reward.as_deref()else{return Ok(());};
    let mut before=state.clone();before.active_run.as_mut().ok_or_else(invalid)?.party=selection.party_before.clone();set_run(&mut before,selection.run_before.clone())?;
    if let Some(tm)=selection.tm.as_deref(){
        crate::current_reward_tm::set_history(&mut before,tm.holder,tm.history_before.clone())?;
        before.current_achievement_tracker=Some(*tm.tracker_before.clone());
        content.battle.move_definition(tm.movement).map_err(|_|invalid())?;

    }
    let mut last_attempt_event=None;
    for tm in selection.declined_tms.iter().chain(selection.tm.iter().map(Box::as_ref)) {
        if tm.messages.len()>4096||tm.messages.windows(2).any(|pair|pair[0].event_id>=pair[1].event_id){return Err(invalid());}
        if let Some(first)=tm.messages.first(){
            if last_attempt_event.is_some_and(|previous|previous>=first.event_id){return Err(invalid());}
            last_attempt_event=tm.messages.last().map(|m|m.event_id);
        }
        for message in &tm.messages {
            use crate::m9e_content_v2::{PresentationSemanticIdV1,PresentationCueFamilyV1};
            let semantic=PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Progression);
            let mapping=content.presentation(semantic).ok_or_else(invalid)?;
            if mapping.blocking!=er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput{return Err(invalid());}
            let effect=crate::m9e_material_v6::GamePresentationEffectV2{event_id:message.event_id,semantic,blocking:mapping.blocking,skip:mapping.skip,
                payload:Some(crate::current_reward_tm::payload(selection,tm,message.kind)?)};
            let hash=er_canonical::fixture_digest(&effect).map_err(|_|invalid())?;
            if !state.current_presentation.as_ref().is_some_and(|owner|owner.receipts.iter().any(|r|r.event_id==message.event_id&&r.effect_sha256==hash)){return Err(invalid());}
        }
        let event=tm.phase.event().or_else(||match tm.phase{
            er_state::current_reward_tm::CurrentRewardTmPhaseV1::Complete{event_id}|er_state::current_reward_tm::CurrentRewardTmPhaseV1::Declined{event_id}=>Some(event_id),_=>None,
        });
        if event.is_some_and(|event|tm.messages.last().is_none_or(|m|m.event_id!=event)){return Err(invalid());}
    }
    let (expected,_)=generate(&before,content)?;
    if expected.rng_audit!=selection.rng_audit||expected.offers!=selection.offers||expected.rng_before!=selection.rng_before||expected.rng_regenerated!=selection.rng_regenerated||expected.rng_after!=selection.rng_after{return Err(invalid());}Ok(())
}
pub(crate) fn select(before:&GameStateV6,content:&PreparedGameContentV2,id:SafeU53,ordinal:u32)->Result<GameStateV6,Error>{
    validate(before,content,id)?;
    let mut selection=tail(before,id)?.reward.as_deref().ok_or_else(invalid)?.clone();
    if matches!(selection.stage,Stage::Choice)&&selection.tm.as_ref().is_some_and(|tm|matches!(tm.phase,er_state::current_reward_tm::CurrentRewardTmPhaseV1::Declined{..})) {
        if selection.declined_tms.len()>=4096{return Err(invalid());}
        selection.declined_tms.push(*selection.tm.take().ok_or_else(invalid)?);
    }
    let (offer,holder)=match selection.stage{
        Stage::Choice=>{
            let index=usize::try_from(ordinal).map_err(|_|invalid())?;
            let option=selection.offers.get(index).ok_or_else(invalid)?;
            let offer=u8::try_from(index).map_err(|_|invalid())?;
            if healing(&option.source_id).is_some()||option.source_id=="TM_CASE"{
                selection.stage=Stage::Holder{offer};let mut state=before.clone();set_selection(&mut state,id,selection)?;validate(&state,content,id)?;return Ok(state);
            }(offer,None)
        },
        Stage::Holder{offer}=>{
            let p=selection.party_before.get(usize::try_from(ordinal).map_err(|_|invalid())?).ok_or_else(invalid)?;
            if selection.offers[usize::from(offer)].source_id=="TM_CASE"{
                if crate::current_reward_tm::available(p)?.is_empty(){return Err(invalid());}
                selection.stage=Stage::TmMove{offer,holder:p.id};
                let mut state=before.clone();set_selection(&mut state,id,selection)?;validate(&state,content,id)?;return Ok(state);
            }(offer,Some(p.id))
        },
        Stage::TmMove{offer,holder}=>{
            let tm=crate::current_reward_tm::prepare(before,content,&selection,holder,ordinal)?;
            selection.tm=Some(Box::new(tm));selection.stage=Stage::TmPending{offer,holder};
            let mut state=before.clone();set_selection(&mut state,id,selection)?;validate(&state,content,id)?;return Ok(state);
        },
        Stage::TmPending{..}=>{
            use er_state::current_reward_tm::CurrentRewardTmPhaseV1 as T;
            let tm=selection.tm.as_mut().ok_or_else(invalid)?;
            tm.phase=match (&tm.phase,ordinal) {
                (T::Replace,0)=>T::ForgetQueued,(T::Replace,1)=>T::Stop,
                (T::ChooseSlot,0..=3)=>{tm.slot=ordinal as u8;T::LearningQueued},
                (T::ChooseSlot,4)=>T::Stop,(T::Stop,0)=>T::DeclineQueued,
                (T::Stop,1)=>{tm.slot=4;T::Queued},_=>return Err(invalid()),
            };
            let mut state=before.clone();set_selection(&mut state,id,selection)?;validate(&state,content,id)?;return Ok(state);
        },
        Stage::Applied{..}=>return Err(invalid()),
    };
    let (party,inventory)=apply(&selection,offer,holder)?;
    selection.stage=Stage::Applied{offer,holder};let mut state=before.clone();state.active_run.as_mut().ok_or_else(invalid)?.party=party;set_run(&mut state,inventory)?;set_selection(&mut state,id,selection)?;validate(&state,content,id)?;Ok(state)
}
pub(crate) fn cancel_holder(before:&GameStateV6,content:&PreparedGameContentV2,id:SafeU53)->Result<GameStateV6,Error>{
    validate(before,content,id)?;let mut selection=tail(before,id)?.reward.as_deref().ok_or_else(invalid)?.clone();
    selection.stage=match selection.stage{Stage::Holder{..}=>Stage::Choice,Stage::TmMove{offer,..}=>Stage::Holder{offer},Stage::TmPending{offer,holder}=>{
        let tm=selection.tm.as_mut().ok_or_else(invalid)?;
        if !matches!(tm.phase,er_state::current_reward_tm::CurrentRewardTmPhaseV1::ChooseSlot){return Err(invalid());}
        tm.phase=er_state::current_reward_tm::CurrentRewardTmPhaseV1::Stop;Stage::TmPending{offer,holder}
    },_=>return Err(invalid())};
    let mut state=before.clone();set_selection(&mut state,id,selection)?;validate(&state,content,id)?;Ok(state)
}
pub(crate) fn install_control(state:&mut GameStateV6,id:SafeU53,instance:MenuInstanceId,revision:SafeU53,seat:SeatId)->Result<(),Error>{
    let selection=tail(state,id)?.reward.as_deref().ok_or_else(invalid)?;
    let run=state.active_run.as_ref().ok_or_else(invalid)?;
    if selection.party_before.iter().any(|p|p.owner_seat!=Some(seat)){return Err(invalid());}
    let action=|ordinal|GameActionV1::Reward{action:RewardActionV1::Select{option_ordinal:ordinal}};
    let (entries,cancel)=match selection.stage{
        Stage::Choice=>(selection.offers.iter().enumerate().map(|(i,_)|(format!("reward/{}/offer/{i}",id.get()),action(i as u32))).collect::<Vec<_>>(),GameMenuCancelV2::Disabled),
        Stage::Holder{..}=>(run.party.iter().enumerate().map(|(i,p)|(format!("reward/{}/holder/{}",id.get(),p.id.get().get()),action(i as u32))).collect::<Vec<_>>(),GameMenuCancelV2::Back{action:Box::new(GameActionV1::Reward{action:RewardActionV1::Decline})}),
        Stage::TmMove{holder,..}=>{
            let p=selection.party_before.iter().find(|p|p.id==holder).ok_or_else(invalid)?;
            (crate::current_reward_tm::available(p)?.iter().enumerate().map(|(i,m)|(format!("reward/{}/tm/{}",id.get(),m.get().get()),action(i as u32))).collect::<Vec<_>>(),GameMenuCancelV2::Back{action:Box::new(GameActionV1::Reward{action:RewardActionV1::Decline})})
        },
        Stage::TmPending{holder,..}=>{
            use er_state::current_reward_tm::CurrentRewardTmPhaseV1 as T;
            let tm=selection.tm.as_ref().ok_or_else(invalid)?;
            let keys=match tm.phase{
                T::Replace=>vec!["yes-replace".to_owned(),"no-replace".to_owned()],
                T::Stop=>vec!["yes-stop".to_owned(),"no-stop".to_owned()],
                T::ChooseSlot=>{
                    let p=selection.party_before.iter().find(|p|p.id==holder).ok_or_else(invalid)?;
                    let mut keys=p.moves.iter().enumerate().map(|(i,slot)|slot.as_ref().map(|m|format!("forget/{i}/{}",m.move_id.get().get())).ok_or_else(invalid)).collect::<Result<Vec<_>,_>>()?;
                    keys.push("do-not-learn".into());keys
                },_=>return Err(invalid()),
            };
            let cancel=if matches!(tm.phase,T::ChooseSlot){GameMenuCancelV2::Back{action:Box::new(GameActionV1::Reward{action:RewardActionV1::Decline})}}else{GameMenuCancelV2::Disabled};
            (keys.into_iter().enumerate().map(|(i,key)|(format!("reward/{}/tm/{key}",id.get()),action(i as u32))).collect::<Vec<_>>(),cancel)
        },
        Stage::Applied{..}=>return Err(invalid()),
    };
    let operation=OperationId::new(format!("m9e/reward/{}/{}/{}",id.get(),instance.get().get(),revision.get())).map_err(|_|invalid())?;
    let control=crate::m7_progression_control::generic_vertical_control_v2(instance,revision,seat,operation,GameControlKindV2::Reward,"m9e/current-reward",&entries,cancel).map_err(|_|invalid())?;
    state.active_run.as_mut().ok_or_else(invalid)?.control=control;Ok(())
}
pub(crate) fn audit(state:&GameStateV6,id:SafeU53)->Result<Vec<er_rng::audit::RngDraw>,Error>{
    Ok(tail(state,id)?.reward.as_deref().ok_or_else(invalid)?.rng_audit.clone())
}