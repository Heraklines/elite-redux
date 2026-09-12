//! Exact current phase presentation identities; receipt existence is not an ack.
use super::*;
use crate::snapshot_v7::{CurrentPhasePresentationKindV1 as K, PendingCurrentPhaseAckV1};
use er_game::m9e_material_v6::GamePresentationPayloadV1 as P;
use er_state::current_faint_execution::CurrentFaintPhaseV1 as F;

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
        K::Victory => return false,
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
