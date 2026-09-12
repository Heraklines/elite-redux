//! Actual Growl stat animation/message descendants and exact event ownership.
use super::*;
use crate::m9e_material_v6::GamePresentationPayloadV1;
use er_state::current_turn_execution::CurrentStatStageChildPhaseV1 as F;

pub(super) fn transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6,GameRuntimeV6Error> {
    let failure=||GameRuntimeV6Error::Action;
    let run=before.active_run.as_ref().ok_or_else(failure)?;
    let turn=before.current_turn_execution.as_ref().ok_or_else(failure)?;
    if operation_id.as_str().is_empty() || revision==SafeU53::ZERO
        || run.control.revision!=revision || run.control.kind!=GameControlKindV2::Waiting
        || run.control.actionable || turn.authority!=authority_seat || before.current_presentation.is_none()
    { return Err(failure()); }
    let child=crate::current_stat_stage_execution::validate(before,content)?.clone();
    let callback=match &phase {
        GameOwnedPhaseV1::StatStageBegin=>None,
        GameOwnedPhaseV1::StatStagePresentation{event_id,animation}=>Some((*event_id,*animation)),
        _=>return Err(failure()),
    };
    let (mut candidate,request)=crate::current_stat_stage_execution::advance(before,content,callback)?;
    let mut presentation=Vec::new();
    if let Some(animation)=request {
        let payload=if animation {
            GamePresentationPayloadV1::StatStageAnimation { holder:child.target,stat:child.stat,before:child.before,after:child.after(),tween_milliseconds:1750 }
        } else {
            GamePresentationPayloadV1::StatStageMessage { holder:child.target,stat:child.stat,before:child.before,after:child.after() }
        };
        let semantic=PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Move);
        let mapping=content.presentation(semantic).ok_or_else(failure)?;
        if mapping.blocking!=er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput {return Err(failure());}
        presentation.push(GamePresentationEffectV2 {
            event_id:PresentationEventId::new(revision),semantic,blocking:mapping.blocking,skip:mapping.skip,payload:Some(payload),
        });
        assign_presentations(&mut candidate,&mut presentation)?;
        let event_id=presentation.first().ok_or_else(failure)?.event_id;
        candidate.current_turn_execution.as_mut().and_then(|turn|turn.stat_child.as_mut()).ok_or_else(failure)?.phase=
            if animation { F::Animation{event_id} } else { F::Message{event_id} };
    }
    install_waiting(&mut candidate,revision)?;
    candidate.validate_with(content).map_err(|_|GameRuntimeV6Error::Invalid)?;
    let next_control=candidate.active_run.as_ref().ok_or_else(failure)?.control.clone();
    let before_digest=game_state_digest(before).map_err(material_error)?;
    let after_digest=game_state_digest(&candidate).map_err(material_error)?;
    Ok(GameTransitionMaterialV6 {
        schema_version:crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain:GameActionDomainV2::Progression,operation_id,authority_seat,authority_revision:revision,
        content_identity:before.content_identity.clone(),accepted_action:None,owned_phase:Some(phase),
        mutations:vec![GameMutationEvidenceV2 {ordinal:0,domain:GameActionDomainV2::Progression,kind:GameMutationKindV2::StateChanged,before_digest:before_digest.clone(),after_digest:after_digest.clone()}],
        before_digest,after_digest,after_state:candidate,next_control,presentation,rng_audit:Vec::new(),platform_effects:Vec::new(),
    })
}