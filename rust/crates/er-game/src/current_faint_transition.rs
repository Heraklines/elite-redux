//! Actual initial Faint descendants and their distinct presentation receipts.
use super::*;
use crate::m9e_material_v6::GamePresentationPayloadV1;
use er_state::current_faint_execution::CurrentFaintPhaseV1 as F;

pub(super) fn transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let turn = before.current_turn_execution.as_ref().ok_or_else(failure)?;
    let pending = match &phase {
        GameOwnedPhaseV1::FaintBegin { pending }
        | GameOwnedPhaseV1::FaintPresentation { pending, .. } => *pending,
        _ => return Err(failure()),
    };
    if operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || run.control.revision != revision
        || run.control.kind != GameControlKindV2::Waiting
        || run.control.actionable
        || turn.authority != authority_seat
        || before.current_presentation.is_none()
    {
        return Err(failure());
    }
    let (mut candidate, request) = match &phase {
        GameOwnedPhaseV1::FaintBegin { .. } => {
            let prelude = crate::current_faint_execution::prepare_current_enemy_faint(
                before, content, pending,
            )?;
            if !prelude.achievements.is_empty() {
                return Err(GameRuntimeV6Error::Domain(format!(
                    "Faint achievement requests require owned reward dispatch: {}",
                    prelude.achievements.join(",")
                )));
            }
            let payload = GamePresentationPayloadV1::FaintAnimation {
                holder: prelude.address.pokemon,
                tween_milliseconds: 500,
            };
            (prelude.state, Some((prelude.address, payload, true)))
        }
        GameOwnedPhaseV1::FaintPresentation {
            event_id,
            animation: true,
            ..
        } => {
            let candidate = crate::current_faint_execution::complete_current_faint_animation(
                before, content, pending, *event_id,
            )?;
            let source = candidate
                .current_battle_participation
                .as_ref()
                .and_then(|owner| owner.experience.as_ref())
                .and_then(|owner| owner.source_progression.as_ref())
                .ok_or_else(failure)?;
            let Some(F::MessageReady { address }) = &source.initial_faint.phase else {
                return Err(failure());
            };
            let address = address.clone();
            let payload = GamePresentationPayloadV1::FaintMessage {
                holder: address.pokemon,
            };
            (candidate, Some((address, payload, false)))
        }
        GameOwnedPhaseV1::FaintPresentation {
            event_id,
            animation: false,
            ..
        } => (
            crate::current_faint_execution::complete_current_faint_message(
                before, content, pending, *event_id,
            )?,
            None,
        ),
        _ => return Err(failure()),
    };
    let mut presentation = Vec::new();
    if let Some((address, payload, animation)) = request {
        let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Faint);
        let mapping = content.presentation(semantic).ok_or_else(failure)?;
        presentation.push(GamePresentationEffectV2 {
            event_id: PresentationEventId::new(revision),
            semantic,
            blocking: mapping.blocking,
            skip: mapping.skip,
            payload: Some(payload),
        });
        assign_presentations(&mut candidate, &mut presentation)?;
        let event_id = presentation.first().ok_or_else(failure)?.event_id;
        let source = candidate
            .current_battle_participation
            .as_mut()
            .and_then(|owner| owner.experience.as_mut())
            .and_then(|owner| owner.source_progression.as_mut())
            .ok_or_else(failure)?;
        source.initial_faint.phase = Some(if animation {
            F::Animation { address, event_id }
        } else {
            F::Message { address, event_id }
        });
    }
    install_waiting(&mut candidate, revision)?;
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let next_control = candidate
        .active_run
        .as_ref()
        .ok_or_else(failure)?
        .control
        .clone();
    let before_digest = game_state_digest(before).map_err(material_error)?;
    let after_digest = game_state_digest(&candidate).map_err(material_error)?;
    Ok(GameTransitionMaterialV6 {
        schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain: GameActionDomainV2::Progression,
        operation_id,
        authority_seat,
        authority_revision: revision,
        content_identity: before.content_identity.clone(),
        accepted_action: None,
        owned_phase: Some(phase),
        mutations: vec![GameMutationEvidenceV2 {
            ordinal: 0,
            domain: GameActionDomainV2::Progression,
            kind: GameMutationKindV2::StateChanged,
            before_digest: before_digest.clone(),
            after_digest: after_digest.clone(),
        }],
        before_digest,
        after_digest,
        after_state: candidate,
        next_control,
        presentation,
        rng_audit: Vec::new(),
        platform_effects: Vec::new(),
    })
}
