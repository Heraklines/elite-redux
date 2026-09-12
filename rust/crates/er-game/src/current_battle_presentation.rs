//! Source-ordered projection of actual retained action cues.
//! Bookkeeping binds the outer material identity, never the turn's older identity.
use super::*;
use er_battle::m7_resolver::BattlePresentationCueV5;
use er_state::current_defender_dispatch::{
    CurrentDefenderDispatchV1, CurrentDefenderObservationV1,
};

pub(super) fn project_current_battle_cues(
    before: &GameStateV6,
    candidate: &mut GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: &OperationId,
    revision: SafeU53,
    cues: &[BattlePresentationCueV5],
) -> Result<Vec<GamePresentationEffectV2>, GameRuntimeV6Error> {
    use crate::m9e_material_v6::GamePresentationPayloadV1 as Payload;
    use BattlePresentationCueV5 as Cue;
    let mut observations = Vec::new();
    let mut effects = Vec::with_capacity(cues.len());
    for (index, cue) in cues.iter().enumerate() {
        let ordinal = u16::try_from(index).map_err(|_| GameRuntimeV6Error::Invalid)?;
        let (family, payload) = match cue {
            Cue::AbilityShown {
                pokemon,
                ability,
                innate_slot,
            } => {
                if ability.get().get() != 5082 {
                    return Err(GameRuntimeV6Error::Invalid);
                }
                observations.push(CurrentDefenderObservationV1::Applied {
                    ordinal,
                    holder: *pokemon,
                    innate_slot: *innate_slot,
                });
                (
                    PresentationCueFamilyV1::Ability,
                    Some(Payload::AbilityShown {
                        holder: *pokemon,
                        ability: *ability,
                        innate_slot: *innate_slot,
                    }),
                )
            }
            Cue::AbilityHeal {
                pokemon,
                before,
                after,
                requested_heal,
            } => (
                PresentationCueFamilyV1::Hp,
                Some(Payload::HpRestored {
                    holder: *pokemon,
                    before: *before,
                    after: *after,
                    requested_heal: *requested_heal,
                }),
            ),
            Cue::AbilityHidden {
                pokemon,
                ability,
                innate_slot,
            } => (
                PresentationCueFamilyV1::Ability,
                Some(Payload::AbilityHidden {
                    holder: *pokemon,
                    ability: *ability,
                    innate_slot: *innate_slot,
                }),
            ),
            Cue::MoveNoEffect { pokemon, move_id } => (
                PresentationCueFamilyV1::Move,
                Some(Payload::MoveNoEffect {
                    holder: *pokemon,
                    move_id: *move_id,
                }),
            ),
            Cue::Switched { pokemon, .. } => {
                observations.push(CurrentDefenderObservationV1::Summoned {
                    ordinal,
                    holder: *pokemon,
                });
                (PresentationCueFamilyV1::Switch, None)
            }
            Cue::MoveUsed { .. } => (PresentationCueFamilyV1::Move, None),
            Cue::HpChanged { .. } => (PresentationCueFamilyV1::Hp, None),
            // Source Faint text is queued behind the actual faint animation
            // callback/removal. Keep this mechanical observation for the
            // retained phase owner instead of displaying it during MoveEffect.
            Cue::Fainted { pokemon } if candidate.current_turn_execution.as_ref().is_some_and(|turn|
                matches!(&turn.stage, er_state::current_turn_execution::CurrentTurnStageV1::AwaitingInterlude { faints }
                    if faints.iter().any(|faint| faint.pokemon == *pokemon))) => continue,
            Cue::Fainted { .. } => (PresentationCueFamilyV1::Faint, None),
            Cue::BattleWon | Cue::BattleLost => (PresentationCueFamilyV1::Terminal, None),
        };
        let semantic = PresentationSemanticIdV1::Cue(family);
        let mapping = content
            .presentation(semantic)
            .ok_or(GameRuntimeV6Error::Invalid)?;
        if let Some(payload) = &payload {
            payload
                .validate(semantic)
                .map_err(|_| GameRuntimeV6Error::Invalid)?;
        }
        effects.push(GamePresentationEffectV2 {
            event_id: PresentationEventId::new(revision),
            semantic,
            blocking: mapping.blocking,
            skip: mapping.skip,
            payload,
        });
    }
    candidate.current_defender_dispatch = CurrentDefenderDispatchV1::observe(
        before.current_defender_dispatch.as_ref(),
        before
            .active_run
            .as_ref()
            .ok_or(GameRuntimeV6Error::Invalid)?,
        candidate
            .active_run
            .as_ref()
            .ok_or(GameRuntimeV6Error::Invalid)?,
        operation_id,
        revision,
        &observations,
    )
    .map_err(|_| GameRuntimeV6Error::Invalid)?;
    Ok(effects)
}
