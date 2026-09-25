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
            Cue::RecoilMessage { pokemon } => (PresentationCueFamilyV1::Move, Some(Payload::RecoilMessage { holder: *pokemon })),
            Cue::MoveNoEffect { pokemon, move_id } => (
                PresentationCueFamilyV1::Move,
                Some(Payload::MoveNoEffect {
                    holder: *pokemon,
                    move_id: *move_id,
                }),
            ),
            Cue::Switched { pokemon, slot } => {
                observations.push(CurrentDefenderObservationV1::Summoned {
                    ordinal,
                    holder: *pokemon,
                });
                (
                    PresentationCueFamilyV1::Switch,
                    Some(Payload::Switched {
                        holder: *pokemon,
                        slot: *slot,
                    }),
                )
            }
            Cue::MoveUsed { pokemon, move_id } => (
                PresentationCueFamilyV1::Move,
                Some(Payload::MoveUsed {
                    holder: *pokemon,
                    move_id: *move_id,
                }),
            ),
            Cue::HpChanged {
                pokemon,
                before,
                after,
            } => (
                PresentationCueFamilyV1::Hp,
                Some(Payload::HpChanged {
                    holder: *pokemon,
                    change: player_safe_hp_change(before_state_run(before)?, *pokemon, *before, *after)?,
                }),
            ),
            // Source Faint text is queued behind the actual faint animation
            // callback/removal. Keep this mechanical observation for the
            // retained phase owner instead of displaying it during MoveEffect.
            Cue::Fainted { pokemon } if candidate.current_turn_execution.as_ref().is_some_and(|turn|
                matches!(&turn.stage, er_state::current_turn_execution::CurrentTurnStageV1::AwaitingInterlude { faints }
                    if faints.iter().any(|faint| faint.pokemon == *pokemon))) => continue,
            Cue::Fainted { pokemon } => (
                PresentationCueFamilyV1::Faint,
                Some(Payload::Fainted { holder: *pokemon }),
            ),
            Cue::BattleWon => (
                PresentationCueFamilyV1::Terminal,
                Some(Payload::BattleEnded { won: true }),
            ),
            Cue::BattleLost => (
                PresentationCueFamilyV1::Terminal,
                Some(Payload::BattleEnded { won: false }),
            ),
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

fn before_state_run(
    before: &GameStateV6,
) -> Result<&er_state::m7_state::RunStateV3, GameRuntimeV6Error> {
    before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Invalid)
}

fn player_safe_hp_change(
    run: &er_state::m7_state::RunStateV3,
    holder: er_types::battle_ids::PokemonId,
    before: u32,
    after: u32,
) -> Result<crate::m9e_material_v6::GamePresentationHpChangeV1, GameRuntimeV6Error> {
    use crate::m9e_material_v6::GamePresentationHpChangeV1 as HpChange;
    let player = run.party.iter().find(|pokemon| pokemon.id == holder);
    let enemy = run
        .battle
        .as_ref()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .enemy_party
        .iter()
        .find(|pokemon| pokemon.id == holder);
    let max_hp = match (player, enemy) {
        (Some(pokemon), None) | (None, Some(pokemon)) => pokemon.max_hp,
        _ => return Err(GameRuntimeV6Error::Invalid),
    };
    if max_hp == 0 || before > max_hp || after > max_hp || before == after {
        return Err(GameRuntimeV6Error::Invalid);
    }
    if player.is_some() {
        return Ok(HpChange::PlayerExact {
            before,
            after,
            max_hp,
        });
    }
    let bar = |hp: u32| {
        u16::try_from(u64::from(hp) * 10_000 / u64::from(max_hp))
            .map_err(|_| GameRuntimeV6Error::Invalid)
    };
    Ok(HpChange::EnemyBar {
        before_ten_thousandths: bar(before)?,
        after_ten_thousandths: bar(after)?,
    })
}
