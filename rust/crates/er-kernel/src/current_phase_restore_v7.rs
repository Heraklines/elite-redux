//! GameSave lacks kernel acknowledgements: reissue its exact retained phase prompt.
use super::*;
use crate::snapshot_v7::{CurrentPhasePresentationKindV1 as K, PendingCurrentPhaseAckV1};
use er_game::m9e_content_v2::{PresentationCueFamilyV1, PresentationSemanticIdV1};
use er_game::m9e_material_v6::GamePresentationPayloadV1 as P;
use er_state::current_experience_owner::CurrentExperienceExecutionOriginV1;
use er_state::current_turn_execution::CurrentTurnStageV1;
use er_state::current_victory_execution::CurrentVictoryDescendantV1 as D;

pub(super) fn owned_waiting_phase(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
    local_seat: SeatId,
) -> bool {
    let Some(run) = &state.active_run else { return false; };
    let Some(battle) = &run.battle else { return false; };
    let Some(turn) = &state.current_turn_execution else { return false; };
    let Some(owner) = state.current_battle_participation.as_ref()
        .and_then(|participation| participation.experience.as_ref()) else { return false; };
    let expected = current_phase_receipt_v7::expected_presentations(state);
    run.control.kind == GameControlKindV2::Waiting
        && !run.control.actionable
        && run.control.owner_seat.is_none()
        && run.control.menu.is_none()
        && run.control.action_context.is_none()
        && content.world.mode(run.mode).is_some_and(|mode| !mode.cooperative)
        && battle.authority_seat == local_seat
        && turn.authority == local_seat
        && matches!(&turn.stage, CurrentTurnStageV1::AwaitingInterlude { faints } if faints.len() == 1)
        && owner.authority == local_seat
        && owner.execution_origin == Some(CurrentExperienceExecutionOriginV1::FreshNormalClassic)
        && owner.source_progression.is_some()
        && owner.pending.len() == 1
        && expected.len() == 1
        && expected[0].pending == owner.pending[0].id
        && run.party.iter().chain(run.storage.iter().map(|stored| &stored.pokemon))
            .all(|pokemon| pokemon.owner_seat == Some(local_seat))
        && battle.enemy_party.iter().all(|pokemon| pokemon.owner_seat.is_none())
        && current_phase_receipt_v7::receipt_matches(state, content, expected[0])
        && state.validate_with(content).is_ok()
}

fn retained_effect(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
    ack: PendingCurrentPhaseAckV1,
) -> Result<GamePresentationEffectV2, GameKernelV7Error> {
    if !current_phase_receipt_v7::receipt_matches(state, content, ack) {
        return Err(GameKernelV7Error::Invalid);
    }
    let owner = state.current_battle_participation.as_ref()
        .and_then(|participation| participation.experience.as_ref())
        .ok_or(GameKernelV7Error::Invalid)?;
    let (family, payload) = match ack.kind {
        K::FaintAnimation | K::FaintMessage => {
            let phase = owner.source_progression.as_ref()
                .and_then(|source| source.initial_faint.phase.as_ref())
                .ok_or(GameKernelV7Error::Invalid)?;
            let holder = phase.address().pokemon;
            (PresentationCueFamilyV1::Faint, if ack.kind == K::FaintAnimation {
                P::FaintAnimation { holder, tween_milliseconds: 500 }
            } else { P::FaintMessage { holder } })
        }
        K::Victory => {
            let pending = owner.pending.iter().find(|pending| pending.id == ack.pending)
                .ok_or(GameKernelV7Error::Invalid)?;
            let descendant = &pending.victory.as_ref().ok_or(GameKernelV7Error::Invalid)?.descendant;
            let payload = match descendant {
                D::AwardPresentation { award, event_id } if *event_id == ack.event_id =>
                    P::ExperienceGain { holder: award.phase.pokemon, amount: award.experience, party_bar: false },
                D::PartyAwardPresentation { award, event_id, .. } if *event_id == ack.event_id =>
                    P::ExperienceGain { holder: award.phase.pokemon, amount: award.experience, party_bar: true },
                D::LevelUpPresentation { end, event_id } if *event_id == ack.event_id => {
                    let level = &end.level_up;
                    let pokemon = state.active_run.as_ref()
                        .and_then(|run| run.party.get(usize::from(level.award.phase.party_index)))
                        .ok_or(GameKernelV7Error::Invalid)?;
                    P::LevelStats { holder: pokemon.id, previous_level: level.previous_level,
                        level: level.new_level, previous_stats: level.previous_stats, stats: pokemon.stats }
                }
                D::HidePartyBarPresentation { award, event_id } if *event_id == ack.event_id =>
                    P::HidePartyExperience { holder: award.phase.pokemon },
                _ => return Err(GameKernelV7Error::Invalid),
            };
            (PresentationCueFamilyV1::Progression, payload)
        }
    };
    let semantic = PresentationSemanticIdV1::Cue(family);
    let mapping = content.presentation(semantic).ok_or(GameKernelV7Error::Invalid)?;
    let effect = GamePresentationEffectV2 { event_id: ack.event_id, semantic,
        blocking: mapping.blocking, skip: mapping.skip, payload: Some(payload) };
    let hash = er_canonical::fixture_digest(&effect).map_err(|_| GameKernelV7Error::Invalid)?;
    if !state.current_presentation.as_ref().is_some_and(|owner|
        owner.receipts.iter().any(|receipt|
            receipt.event_id == effect.event_id && receipt.effect_sha256 == hash))
    { return Err(GameKernelV7Error::Invalid); }
    Ok(effect)
}

pub(super) fn reissue_effects(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
    local_seat: SeatId,
    role: GameKernelRoleV7,
    has_protocol: bool,
) -> Result<Vec<GameKernelEffectV7>, GameKernelV7Error> {
    let expected = current_phase_receipt_v7::expected_presentations(state);
    if expected.is_empty() { return Ok(Vec::new()); }
    if role != GameKernelRoleV7::Authority || has_protocol
        || !owned_waiting_phase(state, content, local_seat)
    { return Err(GameKernelV7Error::Invalid); }
    // No event allocation, receipt append, phase mutation or inferred acknowledgement.
    Ok(vec![GameKernelEffectV7::Presentation(retained_effect(state, content, expected[0])?)])
}
