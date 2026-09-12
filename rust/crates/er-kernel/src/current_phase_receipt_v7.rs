//! Exact current phase presentation identities; receipt existence is not an ack.
use super::*;
use crate::snapshot_v7::{CurrentPhasePresentationKindV1 as K, PendingCurrentPhaseAckV1};
use er_game::m9e_material_v6::GamePresentationPayloadV1 as P;
use er_state::current_faint_execution::CurrentFaintPhaseV1 as F;
use er_types::PresentationEventId;

pub(crate) fn expected_presentations(state: &GameStateV6) -> Vec<PendingCurrentPhaseAckV1> {
    use er_state::current_victory_execution::CurrentVictoryDescendantV1 as D;
    let Some(owner) = state
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
    else {
        return Vec::new();
    };
    let mut expected = Vec::new();
    if let Some(source) = &owner.source_progression {
        let faint = match &source.initial_faint.phase {
            Some(F::Animation { address, event_id }) => {
                Some((address.pending_id, *event_id, K::FaintAnimation))
            }
            Some(F::Message { address, event_id }) => {
                Some((address.pending_id, *event_id, K::FaintMessage))
            }
            _ => None,
        };
        if let Some((pending, event_id, kind)) = faint {
            expected.push(PendingCurrentPhaseAckV1 {
                pending,
                event_id,
                kind,
            });
        }
    }
    for pending in &owner.pending {
        if let Some(tm)=pending.victory_tail.as_ref().and_then(|t|t.reward.as_ref()).and_then(|r|r.tm.as_ref()) {
            if let Some(event_id)=tm.phase.event() {
                expected.push(PendingCurrentPhaseAckV1{pending:pending.id,event_id,kind:K::RewardTm});
            }
        }
        let Some(victory) = &pending.victory else {
            continue;
        };
        let event_id = match &victory.descendant {
            D::AwardPresentation { event_id, .. }
            | D::PartyAwardPresentation { event_id, .. }
            | D::LevelUpPresentation { event_id, .. }
            | D::HidePartyBarPresentation { event_id, .. } => *event_id,
            _ => continue,
        };
        expected.push(PendingCurrentPhaseAckV1 {
            pending: pending.id,
            event_id,
            kind: K::Victory,
        });
    }
    expected
}

pub(crate) fn expected_presentation(
    state: &GameStateV6,
    event_id: PresentationEventId,
) -> Option<PendingCurrentPhaseAckV1> {
    let matches: Vec<_> = expected_presentations(state)
        .into_iter()
        .filter(|expected| expected.event_id == event_id)
        .collect();
    if matches.len() == 1 {
        matches.first().copied()
    } else {
        None
    }
}

pub(crate) fn receipt_matches(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
    ack: PendingCurrentPhaseAckV1,
) -> bool {
    if expected_presentation(state, ack.event_id) != Some(ack) {
        return false;
    }
    if ack.kind == K::Victory {
        let victory = crate::snapshot_v7::PendingVictoryAckV1 {
            pending: ack.pending,
            event_id: ack.event_id,
        };
        return super::current_phase_v7::victory_presentation(state, ack.event_id) == Some(victory)
            && super::current_phase_v7::victory_receipt_matches(state, content, victory);
    }
    if ack.kind==K::RewardTm {
        let Some(payload)=reward_tm_payload(state,ack.event_id)else{return false;};
        let semantic=er_game::m9e_content_v2::PresentationSemanticIdV1::Cue(er_game::m9e_content_v2::PresentationCueFamilyV1::Progression);
        let Some(mapping)=content.presentation(semantic)else{return false;};
        let effect=GamePresentationEffectV2{event_id:ack.event_id,semantic,blocking:mapping.blocking,skip:mapping.skip,
            payload:Some(payload)};
        return mapping.blocking==er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput&&er_canonical::fixture_digest(&effect).ok().is_some_and(|hash|
            state.current_presentation.as_ref().is_some_and(|owner|owner.receipts.iter().any(|r|r.event_id==ack.event_id&&r.effect_sha256==hash)));
    }
    let Some(phase) = state
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| owner.source_progression.as_ref())
        .and_then(|source| source.initial_faint.phase.as_ref())
    else {
        return false;
    };
    let holder = phase.address().pokemon;
    let payload = match ack.kind {
        K::FaintAnimation => P::FaintAnimation {
            holder,
            tween_milliseconds: 500,
        },
        K::FaintMessage => P::FaintMessage { holder },
        K::Victory | K::RewardTm => return false,
    };
    let semantic = er_game::m9e_content_v2::PresentationSemanticIdV1::Cue(
        er_game::m9e_content_v2::PresentationCueFamilyV1::Faint,
    );
    let Some(mapping) = content.presentation(semantic) else {
        return false;
    };
    let effect = GamePresentationEffectV2 {
        event_id: ack.event_id,
        semantic,
        blocking: mapping.blocking,
        skip: mapping.skip,
        payload: Some(payload),
    };
    er_canonical::fixture_digest(&effect)
        .ok()
        .is_some_and(|hash| {
            state.current_presentation.as_ref().is_some_and(|owner| {
                owner.receipts.iter().any(|receipt| {
                    receipt.event_id == ack.event_id && receipt.effect_sha256 == hash
                })
            })
        })
}

pub(crate) fn reward_tm_payload(state:&GameStateV6,event_id:PresentationEventId)->Option<P>{
    use er_state::current_reward_tm::CurrentRewardTmMessageKindV1 as K;
    use er_game::m9e_material_v6::GamePresentationMoveLearningV1 as S;
    let selection=state.current_battle_participation.as_ref()?.experience.as_ref()?.pending.first()?.victory_tail.as_ref()?.reward.as_ref()?;
    let tm=selection.tm.as_ref()?;
    if tm.phase.event()!=Some(event_id){return None;}
    let kind=tm.messages.last().filter(|m|m.event_id==event_id)?.kind;
    if kind==K::Learned{return Some(P::MoveLearned{holder:tm.holder,move_id:tm.movement});}
    let step=match kind{
        K::Intro=>S::WantsToLearn,K::ForgetQuestion=>S::WhichMove,K::NotLearned=>S::DidNotLearn,
        K::Forgotten=>S::Forgot{old_move:selection.party_before.iter().find(|p|p.id==tm.holder)?.moves.get(usize::from(tm.slot))?.as_ref()?.move_id},
        K::Learned=>return None,
    };
    Some(P::MoveLearning{holder:tm.holder,move_id:tm.movement,step})
}
