//! Common-material Candy clock and presentation transactions.
use super::*;
use er_state::current_reward_candy::CurrentRewardCandyPhaseV1 as C;

pub(super) fn transition(before:&GameStateV6,content:&PreparedGameContentV2,operation_id:OperationId,
    authority_seat:SeatId,revision:SafeU53,phase:GameOwnedPhaseV1)->Result<GameTransitionMaterialV6,GameRuntimeV6Error>{
    let failure=||GameRuntimeV6Error::Action;
    let pending=match &phase{GameOwnedPhaseV1::RewardCandy{pending,..}=>*pending,
        GameOwnedPhaseV1::FriendshipClock{request,..}=>request.pending,_=>return Err(failure())};
    crate::current_reward_candy::validate(before,content,pending)?;
    let run=before.active_run.as_ref().ok_or_else(failure)?;
    let owner=before.current_battle_participation.as_ref().and_then(|p|p.experience.as_ref()).ok_or_else(failure)?;
    if operation_id.as_str().is_empty()||revision==SafeU53::ZERO||run.control.revision!=revision
        ||run.control.kind!=GameControlKindV2::Waiting||run.control.actionable||owner.authority!=authority_seat
        ||before.current_presentation.is_none(){return Err(failure());}
    let candy=crate::current_reward_candy::owner(before,pending)?.clone();
    let (mut candidate,payloads,requested)=match &phase{
        GameOwnedPhaseV1::FriendshipClock{request,utc_milliseconds}=>{
            let (next,payloads)=crate::current_reward_candy::settle_clock(before,content,request,*utc_milliseconds)?;
            (next,payloads,None)
        }
        GameOwnedPhaseV1::RewardCandy{callback,..} if matches!(candy.phase,C::Queued)&&callback.is_none()=>
            (crate::current_reward_candy::begin(before,content,pending)?,Vec::new(),None),
        GameOwnedPhaseV1::RewardCandy{callback,..}=>{
            let (next,request)=crate::current_reward_candy::advance(before,content,pending,*callback)?;
            (next,Vec::new(),request)
        }
        _=>return Err(failure()),
    };
    let semantic=PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Progression);
    let mapping=content.presentation(semantic).ok_or_else(failure)?;
    if mapping.blocking!=er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput{return Err(failure());}
    let mut presentation=payloads.into_iter().map(|payload|GamePresentationEffectV2{
        event_id:PresentationEventId::new(revision),semantic,blocking:mapping.blocking,skip:mapping.skip,payload:Some(payload)
    }).collect::<Vec<_>>();
    if let Some(stats)=requested{
        presentation.push(GamePresentationEffectV2{event_id:PresentationEventId::new(revision),semantic,
            blocking:mapping.blocking,skip:mapping.skip,payload:Some(crate::current_reward_candy::presentation(&candy,stats)?)});
    }
    assign_presentations(&mut candidate,&mut presentation)?;
    if let Some(stats)=requested{
        let event_id=presentation.last().ok_or_else(failure)?.event_id;
        let owner=crate::current_reward_candy::owner_mut(&mut candidate,pending)?;
        if stats{owner.phase=C::Stats{event_id};owner.stats_event=Some(event_id);}
        else{owner.phase=C::Message{event_id};owner.message_event=Some(event_id);}
        crate::current_reward_candy::install_replay(&mut candidate,content,pending)?;
    }
    let prior_clock=crate::current_reward_candy::clock(&candy);
    let next_clock=crate::current_reward_candy::clock(crate::current_reward_candy::owner(&candidate,pending)?);
    let platform_effects=next_clock.filter(|clock|Some(*clock)!=prior_clock).map(|request|
        vec![GamePlatformEffectV2::CurrentFriendshipClock{request:request.clone()}]).unwrap_or_default();
    install_waiting(&mut candidate,revision)?;
    candidate.validate_with(content).map_err(|_|GameRuntimeV6Error::Invalid)?;
    let next_control=candidate.active_run.as_ref().ok_or_else(failure)?.control.clone();
    let before_digest=game_state_digest(before).map_err(material_error)?;
    let after_digest=game_state_digest(&candidate).map_err(material_error)?;
    Ok(GameTransitionMaterialV6{schema_version:crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain:GameActionDomainV2::Progression,operation_id,authority_seat,authority_revision:revision,
        content_identity:before.content_identity.clone(),accepted_action:None,owned_phase:Some(phase),
        mutations:vec![GameMutationEvidenceV2{ordinal:0,domain:GameActionDomainV2::Progression,kind:GameMutationKindV2::StateChanged,
            before_digest:before_digest.clone(),after_digest:after_digest.clone()}],
        before_digest,after_digest,after_state:candidate,next_control,presentation,platform_effects,rng_audit:Vec::new()})
}