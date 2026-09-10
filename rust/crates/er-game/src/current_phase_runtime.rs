//! Automatic source phase transactions. No public menu action is fabricated.
use super::*;
use er_state::current_experience_owner::{
    CurrentExperienceOwnerV1, CurrentFriendshipClockRequestV1, CurrentPendingExperienceV1,
};
use er_state::current_experience_settlement::{
    CurrentExperienceAwardV1, CurrentLearnMoveBatchV1, CurrentLevelUpChildrenV1,
};
use er_state::current_turn_execution::{
    CurrentTurnExecutionV1, CurrentTurnFaintV1, CurrentTurnStageV1,
};
use er_state::current_victory_execution::{
    CurrentVictoryDescendantV1, CurrentVictoryExecutionV1,
};
use er_types::SeatId;

use crate::m9e_material_v6::GamePresentationPayloadV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum GameOwnedPhaseV1 {
    TurnStep,
    TurnFinish,
    FriendshipBegin,
    FriendshipClock {
        request: CurrentFriendshipClockRequestV1,
        utc_milliseconds: i64,
    },
    /// Actual applyPartyExp insertion at the retained Victory frontier.
    VictoryBegin,
    /// The source XP gain prompt for the retained phase cursor entry.
    AwardBegin,
    /// Runs only after that prompt was acknowledged; applies the award.
    AwardApply,
    /// Actual LevelUpPhase.start: recalculate stats after the applied award.
    LevelUpApply,
    /// Actual LevelUpPhase.end: create the retained learn/evolution children.
    LevelUpChildren,
    /// Spawn or consume the retained child frontier (learn batch, evolution).
    VictoryDescendant,
    /// Every retained interlude entry is Complete; return the turn to its owner.
    PendingResolve,
}

pub(super) fn begin_owned_turn(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    commands: &CommandSet,
    authority: &TurnAuthorityContextV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    if before.current_turn_execution.is_some() || before.current_presentation.is_none() {
        return Err(GameRuntimeV6Error::Action);
    }
    let targeting = er_battle::current_target_execution::CurrentTargetExecution::from_state(before)
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let chunk = er_battle::m7_resolver::begin_current_turn(
        &project_v5(before),
        commands,
        &content.battle,
        authority,
        &targeting,
        SafeU53::ZERO,
    )
    .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let mut candidate = adopt_v5_with_turn(
        before,
        chunk.transition.after_state,
        before.current_battle_participation.clone(),
        Some(chunk.continuation),
    )?;
    install_waiting(&mut candidate, authority.revision)?;
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        rng_audit: chunk.transition.rng_audit,
        ..Default::default()
    })
}

fn install_waiting(
    candidate: &mut GameStateV6,
    revision: SafeU53,
) -> Result<(), GameRuntimeV6Error> {
    candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?
        .control = GameControlPlanV2 {
        schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: safe_increment(revision)?,
        kind: GameControlKindV2::Waiting,
        owner_seat: None,
        action_context: None,
        menu: None,
        actionable: false,
    };
    Ok(())
}

impl GameRuntimeV6 {
    /// Kernel-owned automatic ingress; the retained live phase, not caller
    /// supplied award arithmetic, determines whether this transaction can run.
    pub fn execute_owned_phase(
        &mut self,
        operation_id: OperationId,
        authority_seat: SeatId,
        phase: GameOwnedPhaseV1,
    ) -> Result<PreparedGameTransitionV2, GameRuntimeV6Error> {
        let before = self.state.as_ref().ok_or(GameRuntimeV6Error::Action)?;
        let transition = phase_transition(
            before,
            &self.content,
            operation_id,
            authority_seat,
            self.material_ledger.next_authority_revision,
            phase,
        )?;
        let material = GameMaterialV6::GameAction(transition.clone());
        let material_bytes = material.canonical_bytes().map_err(material_error)?;
        let mut state = self.state.clone();
        let mut ledger = self.material_ledger.clone();
        let outcome = apply_game_material_v6_with_retention(
            &mut state,
            &mut ledger,
            &self.content,
            &material_bytes,
            self.material_retention,
        )
        .map_err(material_error)?;
        if outcome != GameMaterialApplyOutcomeV6::Applied
            || state.as_ref() != Some(&transition.after_state)
        {
            return Err(GameRuntimeV6Error::CandidateMismatch);
        }
        let prepared = PreparedGameTransitionV2 {
            candidate: transition.after_state,
            next_control: transition.next_control,
            mutations: transition.mutations,
            rng_audit: transition.rng_audit,
            presentation: transition.presentation,
            platform_effects: transition.platform_effects,
            material,
            material_bytes,
        };
        self.state = state;
        self.material_ledger = ledger;
        Ok(prepared)
    }
}

pub(super) fn assign_presentations(
    state: &mut GameStateV6,
    effects: &mut [GamePresentationEffectV2],
) -> Result<(), GameRuntimeV6Error> {
    if let Some(owner) = &mut state.current_presentation {
        let mut next = owner.next_event_id;
        for effect in effects {
            effect.event_id = PresentationEventId::new(next);
            owner.receipts.push(
                er_state::current_presentation::CurrentPresentationReceiptV1 {
                    event_id: effect.event_id,
                    effect_sha256: er_canonical::fixture_digest(effect)
                        .map_err(|_| GameRuntimeV6Error::Invalid)?,
                },
            );
            next = safe_increment(next)?;
        }
        let excess = owner
            .receipts
            .len()
            .saturating_sub(er_state::current_presentation::MAX_CURRENT_PRESENTATION_RECEIPTS_V1);
        owner.receipts.drain(..excess);
        owner.next_event_id = next;
    }
    Ok(())
}

pub(crate) fn validate_owned_phase_transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    transition: &GameTransitionMaterialV6,
) -> Result<(), GameRuntimeV6Error> {
    let phase = transition
        .owned_phase
        .clone()
        .ok_or(GameRuntimeV6Error::Action)?;
    let expected = phase_transition(
        before,
        content,
        transition.operation_id.clone(),
        transition.authority_seat,
        transition.authority_revision,
        phase,
    )?;
    if &expected != transition {
        return Err(GameRuntimeV6Error::CandidateMismatch);
    }
    Ok(())
}

pub(crate) fn validate_current_turn_transition(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    transition: &GameTransitionMaterialV6,
) -> Result<(), GameRuntimeV6Error> {
    if transition.owned_phase.is_some() {
        return Ok(());
    }
    let previous = before.and_then(|state| state.current_turn_execution.as_ref());
    let next = transition.after_state.current_turn_execution.as_ref();
    match (previous, next) {
        (None, None) => Ok(()),
        (Some(previous), Some(next)) if previous == next => Ok(()),
        (None, Some(next))
            if transition.domain == GameActionDomainV2::BattleTurn
                && matches!(
                    transition.accepted_action,
                    Some(GameActionV1::Battle { .. })
                ) =>
        {
            let before = before.ok_or(GameRuntimeV6Error::Invalid)?;
            let authority = TurnAuthorityContextV1 {
                authority_seat: transition.authority_seat,
                revision: transition.authority_revision,
            };
            let expected = begin_owned_turn(before, content, &next.accepted_commands, &authority)?;
            let mut candidate = expected.candidate.ok_or(GameRuntimeV6Error::Invalid)?;
            let mut presentation = transition.presentation.clone();
            assign_presentations(&mut candidate, &mut presentation)?;
            if candidate != transition.after_state
                || expected.rng_audit != transition.rng_audit
                || presentation != transition.presentation
                || !transition.platform_effects.is_empty()
            {
                return Err(GameRuntimeV6Error::CandidateMismatch);
            }
            Ok(())
        }
        _ => Err(GameRuntimeV6Error::Action),
    }
}

fn phase_transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6, GameRuntimeV6Error> {
    before
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let run = before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let turn = before
        .current_turn_execution
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    if matches!(
        phase,
        GameOwnedPhaseV1::TurnStep | GameOwnedPhaseV1::TurnFinish
    ) {
        return turn_step_transition(
            before,
            content,
            operation_id,
            authority_seat,
            revision,
            phase,
        );
    }
    if !matches!(
        phase,
        GameOwnedPhaseV1::FriendshipBegin | GameOwnedPhaseV1::FriendshipClock { .. }
    ) {
        return victory_transition(
            before,
            content,
            operation_id,
            authority_seat,
            revision,
            phase,
        );
    }
    let CurrentTurnStageV1::AwaitingInterlude { faints } = &turn.stage else {
        return Err(GameRuntimeV6Error::Action);
    };
    let owner = before
        .current_battle_participation
        .as_ref()
        .and_then(|value| value.experience.as_ref())
        .ok_or(GameRuntimeV6Error::Action)?;
    let pending = owner
        .pending
        .iter()
        .find(|pending| {
            pending
                .friendship
                .as_ref()
                .is_some_and(|value| !value.complete)
        })
        .ok_or(GameRuntimeV6Error::Action)?;
    if operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || run.control.revision != revision
        || run.control.actionable
        || run.control.kind != GameControlKindV2::Waiting
        || turn.authority != authority_seat
        || owner.authority != authority_seat
        || before.current_presentation.is_none()
        || !faints.iter().any(|faint| {
            faint.pokemon == pending.source.pokemon
                && faint.slot.side == er_types::battle_ids::BattleSide::Enemy
        })
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let previous_clock = pending
        .friendship
        .as_ref()
        .and_then(|value| value.clock.as_ref());
    let (mut candidate, payloads) = match &phase {
        GameOwnedPhaseV1::TurnStep | GameOwnedPhaseV1::TurnFinish => {
            return Err(GameRuntimeV6Error::Invalid);
        }
        GameOwnedPhaseV1::FriendshipBegin => {
            crate::current_friendship_execution::prepare_next_friendship(before, content)?
        }
        GameOwnedPhaseV1::FriendshipClock {
            request,
            utc_milliseconds,
        } => crate::current_friendship_execution::prepare_clock_result(
            before,
            content,
            request,
            *utc_milliseconds,
        )?,
    };
    let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Reward);
    let mapping = content
        .presentation(semantic)
        .ok_or(GameRuntimeV6Error::Invalid)?;
    let mut presentation = payloads
        .into_iter()
        .map(|payload| GamePresentationEffectV2 {
            // Overwritten by the canonical current frontier before publication.
            event_id: PresentationEventId::new(revision),
            semantic,
            blocking: mapping.blocking,
            skip: mapping.skip,
            payload: Some(payload),
        })
        .collect::<Vec<_>>();
    assign_presentations(&mut candidate, &mut presentation)?;
    let next_control = normalize_next_control(&mut candidate, safe_increment(revision)?)?;
    let next_clock = candidate
        .current_battle_participation
        .as_ref()
        .and_then(|value| value.experience.as_ref())
        .and_then(|owner| owner.pending.iter().find(|value| value.id == pending.id))
        .and_then(|value| value.friendship.as_ref())
        .and_then(|value| value.clock.as_ref());
    let platform_effects = next_clock
        .filter(|next| Some(*next) != previous_clock)
        .map(|request| {
            vec![GamePlatformEffectV2::CurrentFriendshipClock {
                request: request.clone(),
            }]
        })
        .unwrap_or_default();
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let before_digest = game_state_digest(before).map_err(material_error)?;
    let after_digest = game_state_digest(&candidate).map_err(material_error)?;
    let mut mutations = vec![GameMutationEvidenceV2 {
        ordinal: 0,
        domain: GameActionDomainV2::Progression,
        kind: GameMutationKindV2::StateChanged,
        before_digest: before_digest.clone(),
        after_digest: after_digest.clone(),
    }];
    if let Some(GamePlatformEffectV2::CurrentFriendshipClock { request }) = platform_effects.first()
    {
        if request.request.get() != before.identities.next_platform_request_id
            || safe_increment(request.request.get())?
                != candidate.identities.next_platform_request_id
        {
            return Err(GameRuntimeV6Error::Invalid);
        }
        mutations.push(GameMutationEvidenceV2 {
            ordinal: 1,
            domain: GameActionDomainV2::Progression,
            kind: GameMutationKindV2::IdentityAllocated {
                domain: GameIdentityDomainV1::PlatformRequest,
                identity: request.request.get(),
            },
            before_digest: before_digest.clone(),
            after_digest: after_digest.clone(),
        });
    } else if before.identities.next_platform_request_id
        != candidate.identities.next_platform_request_id
    {
        return Err(GameRuntimeV6Error::Invalid);
    }
    Ok(GameTransitionMaterialV6 {
        schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain: GameActionDomainV2::Progression,
        operation_id,
        authority_seat,
        authority_revision: revision,
        content_identity: before.content_identity.clone(),
        accepted_action: None,
        owned_phase: Some(phase),
        before_digest,
        after_digest,
        mutations,
        rng_audit: Vec::new(),
        after_state: candidate,
        next_control,
        presentation,
        platform_effects,
    })
}

fn turn_step_transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6, GameRuntimeV6Error> {
    let owner = before
        .current_turn_execution
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let run = before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    if owner.stage != CurrentTurnStageV1::ReadyForMove
        || owner.authority != authority_seat
        || operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || run.control.kind != GameControlKindV2::Waiting
        || run.control.actionable
        || run.control.revision != revision
        || has_pending_experience(before)
        || before.current_presentation.is_none()
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let targeting = er_battle::current_target_execution::CurrentTargetExecution::from_state(before)
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let authority = TurnAuthorityContextV1 {
        authority_seat,
        revision: owner.authority_revision,
    };
    let chunk = if phase == GameOwnedPhaseV1::TurnFinish {
        er_battle::m7_resolver::finish_current_turn(
            &project_v5(before),
            owner,
            &content.battle,
            &authority,
            &targeting,
        )
    } else {
        er_battle::m7_resolver::step_current_turn(
            &project_v5(before),
            owner,
            &content.battle,
            &authority,
            &targeting,
        )
    }
    .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let events = er_battle::m7_resolver::current_observation_events(&chunk.transition)
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let after_run = chunk
        .transition
        .after_state
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let participation = before
        .current_battle_participation
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?
        .observe_current_chunk(run, after_run, &events, owner, &chunk.continuation)
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let mut candidate = adopt_v5_with_turn(
        before,
        chunk.transition.after_state,
        Some(participation),
        Some(chunk.continuation),
    )?;
    install_waiting(&mut candidate, revision)?;
    if candidate
        .current_turn_execution
        .as_ref()
        .is_some_and(|turn| turn.stage == CurrentTurnStageV1::Complete)
        && !has_pending_experience(&candidate)
    {
        let menu_instance = owner
            .accepted_commands
            .entries
            .iter()
            .find_map(|entry| match entry {
                AcceptedBattleCommand::Human { proposal, .. } => Some(proposal.menu_instance_id),
                _ => None,
            })
            .ok_or(GameRuntimeV6Error::Invalid)?;
        candidate.current_turn_execution = None;
        match chunk.transition.outcome {
            BattleOutcome::Ongoing => {
                let next_owner = next_battle_control_owner(&candidate)?;
                install_battle_command_control(
                    &mut candidate,
                    next_owner,
                    authority_seat,
                    safe_increment(revision)?,
                    menu_instance,
                )?;
            }
            BattleOutcome::Victory => {
                candidate.profile.statistics.battles_won =
                    safe_increment(candidate.profile.statistics.battles_won)?;
                let final_wave = candidate
                    .active_run
                    .as_ref()
                    .is_some_and(|run| is_final_wave(content, run.mode, run.wave));
                if final_wave {
                    candidate
                        .active_run
                        .as_mut()
                        .ok_or(GameRuntimeV6Error::Action)?
                        .outcome = RunOutcome::Victory;
                    candidate.profile.statistics.runs_won =
                        safe_increment(candidate.profile.statistics.runs_won)?;
                } else {
                    install_progression_or_reward_control(
                        &mut candidate,
                        content,
                        authority_seat,
                        safe_increment(revision)?,
                        menu_instance,
                    )?;
                }
            }
            BattleOutcome::Defeat => {
                candidate
                    .active_run
                    .as_mut()
                    .ok_or(GameRuntimeV6Error::Action)?
                    .outcome = RunOutcome::Defeat;
            }
        }
    }
    let mut presentation = super::current_battle_presentation::project_current_battle_cues(
        before,
        &mut candidate,
        content,
        &operation_id,
        revision,
        &chunk.transition.presentation,
    )?;
    assign_presentations(&mut candidate, &mut presentation)?;
    let next_control = candidate
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?
        .control
        .clone();
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
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
        rng_audit: chunk.transition.rng_audit,
        after_state: candidate,
        next_control,
        presentation,
        platform_effects: Vec::new(),
    })
}

fn pending_resolved(pending: &CurrentPendingExperienceV1) -> bool {
    matches!(
        pending.victory.as_ref().map(|victory| &victory.descendant),
        Some(CurrentVictoryDescendantV1::Complete)
    )
}

fn active_pending<'a>(
    owner: &'a CurrentExperienceOwnerV1,
    faints: &[CurrentTurnFaintV1],
) -> Result<(usize, &'a CurrentPendingExperienceV1), GameRuntimeV6Error> {
    let index = owner
        .pending
        .iter()
        .position(|pending| !pending_resolved(pending))
        .ok_or(GameRuntimeV6Error::Action)?;
    let pending = &owner.pending[index];
    if !faints.iter().any(|faint| {
        faint.pokemon == pending.source.pokemon
            && faint.slot.side == er_types::battle_ids::BattleSide::Enemy
    }) {
        return Err(GameRuntimeV6Error::Action);
    }
    Ok((index, pending))
}

fn pending_mut(
    state: &mut GameStateV6,
    index: usize,
) -> Result<&mut CurrentPendingExperienceV1, GameRuntimeV6Error> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|value| value.experience.as_mut())
        .and_then(|owner| owner.pending.get_mut(index))
        .ok_or(GameRuntimeV6Error::Invalid)
}

fn victory_mut(
    state: &mut GameStateV6,
    index: usize,
) -> Result<&mut CurrentVictoryExecutionV1, GameRuntimeV6Error> {
    pending_mut(state, index)?
        .victory
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)
}

fn advance_victory(
    victory: &mut CurrentVictoryExecutionV1,
    award: CurrentExperienceAwardV1,
) -> Result<(), GameRuntimeV6Error> {
    victory.completed.push(award);
    victory.next_phase = u8::try_from(victory.completed.len())
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    victory.descendant = if usize::from(victory.next_phase) == victory.phases.len() {
        CurrentVictoryDescendantV1::Complete
    } else {
        CurrentVictoryDescendantV1::Ready
    };
    Ok(())
}

fn turn_menu_base(
    turn: &CurrentTurnExecutionV1,
) -> Result<MenuInstanceId, GameRuntimeV6Error> {
    turn.accepted_commands
        .entries
        .iter()
        .find_map(|entry| match entry {
            AcceptedBattleCommand::Human { proposal, .. } => Some(proposal.menu_instance_id),
            _ => None,
        })
        .ok_or(GameRuntimeV6Error::Invalid)
}

fn descendant_menu_instance(
    run: &RunStateV3,
    base: MenuInstanceId,
) -> Result<MenuInstanceId, GameRuntimeV6Error> {
    let current = run
        .control
        .menu
        .as_ref()
        .map(|menu| menu.instance_id)
        .or_else(|| {
            run.control
                .action_context
                .as_ref()
                .map(|context| context.menu_instance)
        })
        .unwrap_or(base);
    MenuInstanceId::new(safe_increment(current.get())?)
        .map_err(|_| GameRuntimeV6Error::Invalid)
}

fn install_learn_batch_control(
    candidate: &mut GameStateV6,
    pending_id: SafeU53,
    batch: &CurrentLearnMoveBatchV1,
    authority_seat: SeatId,
    revision: SafeU53,
    base_instance: MenuInstanceId,
) -> Result<(), GameRuntimeV6Error> {
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let owner = run
        .party
        .iter()
        .find(|pokemon| pokemon.id == batch.children.parent.level_up.award.phase.pokemon)
        .and_then(|pokemon| pokemon.owner_seat)
        .ok_or(GameRuntimeV6Error::Action)?;
    let menu_instance = descendant_menu_instance(run, base_instance)?;
    let context = GameActionContextV1 {
        operation_id: OperationId::new(format!(
            "current/learn-batch/{}/{}",
            pending_id.get(),
            revision.get()
        ))
        .map_err(|_| GameRuntimeV6Error::Invalid)?,
        authority_seat: owner,
        authority_revision: revision,
        menu_instance,
    };
    let mut control =
        crate::m7_progression_control::current_learn_move_batch_control(&context, batch)
            .map_err(|_| GameRuntimeV6Error::Invalid)?;
    control
        .action_context
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .authority_seat = authority_seat;
    run.control = control;
    Ok(())
}

fn install_evolution_control(
    candidate: &mut GameStateV6,
    pending_id: SafeU53,
    children: &CurrentLevelUpChildrenV1,
    authority_seat: SeatId,
    revision: SafeU53,
    base_instance: MenuInstanceId,
) -> Result<(), GameRuntimeV6Error> {
    let pokemon_id = children.parent.level_up.award.phase.pokemon;
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let owner = run
        .party
        .iter()
        .find(|pokemon| pokemon.id == pokemon_id)
        .and_then(|pokemon| pokemon.owner_seat)
        .ok_or(GameRuntimeV6Error::Action)?;
    let menu_instance = descendant_menu_instance(run, base_instance)?;
    let operation = OperationId::new(format!(
        "current/evolution/{}/{}",
        pending_id.get(),
        revision.get()
    ))
    .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let mut control = crate::m7_progression_control::evolution_control(
        menu_instance,
        revision,
        owner,
        operation,
        pokemon_id,
        &children.evolution_candidates,
    )
    .map_err(|_| GameRuntimeV6Error::Invalid)?;
    control
        .action_context
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .authority_seat = authority_seat;
    run.control = control;
    Ok(())
}

fn finish_owned_battle_tail(
    candidate: &mut GameStateV6,
    content: &PreparedGameContentV2,
    turn: &CurrentTurnExecutionV1,
    authority_seat: SeatId,
    revision: SafeU53,
) -> Result<(), GameRuntimeV6Error> {
    let outcome = candidate
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .map(|battle| battle.outcome)
        .ok_or(GameRuntimeV6Error::Action)?;
    let menu_base = turn_menu_base(turn)?;
    match outcome {
        BattleOutcome::Ongoing => {
            let next_owner = next_battle_control_owner(candidate)?;
            install_battle_command_control(
                candidate,
                next_owner,
                authority_seat,
                revision,
                menu_base,
            )?;
        }
        BattleOutcome::Victory => {
            candidate.profile.statistics.battles_won =
                safe_increment(candidate.profile.statistics.battles_won)?;
            let final_wave = candidate
                .active_run
                .as_ref()
                .is_some_and(|run| is_final_wave(content, run.mode, run.wave));
            if final_wave {
                candidate
                    .active_run
                    .as_mut()
                    .ok_or(GameRuntimeV6Error::Action)?
                    .outcome = RunOutcome::Victory;
                candidate.profile.statistics.runs_won =
                    safe_increment(candidate.profile.statistics.runs_won)?;
            } else {
                install_progression_or_reward_control(
                    candidate,
                    content,
                    authority_seat,
                    revision,
                    menu_base,
                )?;
            }
        }
        BattleOutcome::Defeat => {
            candidate
                .active_run
                .as_mut()
                .ok_or(GameRuntimeV6Error::Action)?
                .outcome = RunOutcome::Defeat;
        }
    }
    Ok(())
}

fn victory_transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6, GameRuntimeV6Error> {
    let run = before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let turn = before
        .current_turn_execution
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let CurrentTurnStageV1::AwaitingInterlude { faints } = &turn.stage else {
        return Err(GameRuntimeV6Error::Action);
    };
    let owner = before
        .current_battle_participation
        .as_ref()
        .and_then(|value| value.experience.as_ref())
        .ok_or(GameRuntimeV6Error::Action)?;
    if operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || run.control.revision != revision
        || run.control.actionable
        || run.control.kind != GameControlKindV2::Waiting
        || turn.authority != authority_seat
        || owner.authority != authority_seat
        || before.current_presentation.is_none()
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let next_revision = safe_increment(revision)?;
    let mut candidate = before.clone();
    let mut presentation = Vec::new();
    match &phase {
        GameOwnedPhaseV1::VictoryBegin => {
            let (index, pending) = active_pending(owner, faints)?;
            if pending.victory.is_some()
                || !pending
                    .friendship
                    .as_ref()
                    .is_some_and(|phase| phase.complete)
            {
                return Err(GameRuntimeV6Error::Action);
            }
            let phases =
                crate::current_experience_settlement::plan_current_victory_experience(
                    before, content, pending.id,
                )?;
            let descendant = if phases.is_empty() {
                CurrentVictoryDescendantV1::Complete
            } else {
                CurrentVictoryDescendantV1::Ready
            };
            pending_mut(&mut candidate, index)?.victory = Some(CurrentVictoryExecutionV1 {
                phases,
                next_phase: 0,
                completed: Vec::new(),
                descendant,
            });
        }
        GameOwnedPhaseV1::AwardBegin => {
            let (index, pending) = active_pending(owner, faints)?;
            let victory = pending.victory.as_ref().ok_or(GameRuntimeV6Error::Action)?;
            if victory.descendant != CurrentVictoryDescendantV1::Ready {
                return Err(GameRuntimeV6Error::Action);
            }
            let phase_row = victory
                .phases
                .get(usize::from(victory.next_phase))
                .ok_or(GameRuntimeV6Error::Action)?
                .clone();
            let award =
                crate::current_experience_settlement::prepare_current_experience_phase(
                    before, content, &phase_row,
                )?;
            let semantic =
                PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Progression);
            let mapping = content
                .presentation(semantic)
                .ok_or(GameRuntimeV6Error::Invalid)?;
            presentation.push(GamePresentationEffectV2 {
                // Overwritten by the canonical current frontier before publication.
                event_id: PresentationEventId::new(revision),
                semantic,
                blocking: mapping.blocking,
                skip: mapping.skip,
                payload: Some(GamePresentationPayloadV1::ExperienceGained {
                    pokemon: award.phase.pokemon,
                    experience: award.experience,
                }),
            });
            assign_presentations(&mut candidate, &mut presentation)?;
            let event_id = presentation
                .first()
                .map(|effect| effect.event_id)
                .ok_or(GameRuntimeV6Error::Invalid)?;
            victory_mut(&mut candidate, index)?.descendant =
                CurrentVictoryDescendantV1::AwardPresentation { award, event_id };
        }
        GameOwnedPhaseV1::AwardApply => {
            let (index, pending) = active_pending(owner, faints)?;
            let Some(CurrentVictoryDescendantV1::AwardPresentation { award, .. }) =
                pending.victory.as_ref().map(|victory| &victory.descendant)
            else {
                return Err(GameRuntimeV6Error::Action);
            };
            let award = award.clone();
            let (next, level_up) =
                crate::current_experience_settlement::apply_current_experience_award(
                    before, content, &award,
                )?;
            candidate = next;
            let victory = victory_mut(&mut candidate, index)?;
            if let Some(level_up) = level_up {
                victory.descendant = CurrentVictoryDescendantV1::LevelUpStart { level_up };
            } else {
                advance_victory(victory, award)?;
            }
        }
        GameOwnedPhaseV1::LevelUpApply => {
            let (index, pending) = active_pending(owner, faints)?;
            let Some(CurrentVictoryDescendantV1::LevelUpStart { level_up }) =
                pending.victory.as_ref().map(|victory| &victory.descendant)
            else {
                return Err(GameRuntimeV6Error::Action);
            };
            let level_up = level_up.clone();
            let (next, end) =
                crate::current_experience_settlement::apply_current_level_up(
                    before, content, &level_up,
                )?;
            candidate = next;
            let semantic =
                PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Progression);
            let mapping = content
                .presentation(semantic)
                .ok_or(GameRuntimeV6Error::Invalid)?;
            presentation.push(GamePresentationEffectV2 {
                // Overwritten by the canonical current frontier before publication.
                event_id: PresentationEventId::new(revision),
                semantic,
                blocking: mapping.blocking,
                skip: mapping.skip,
                payload: Some(GamePresentationPayloadV1::LevelUp {
                    pokemon: level_up.award.phase.pokemon,
                    previous_level: level_up.previous_level,
                    new_level: level_up.new_level,
                }),
            });
            assign_presentations(&mut candidate, &mut presentation)?;
            let event_id = presentation
                .first()
                .map(|effect| effect.event_id)
                .ok_or(GameRuntimeV6Error::Invalid)?;
            victory_mut(&mut candidate, index)?.descendant =
                CurrentVictoryDescendantV1::LevelUpPresentation { end, event_id };
        }
        GameOwnedPhaseV1::LevelUpChildren => {
            let (index, pending) = active_pending(owner, faints)?;
            let Some(CurrentVictoryDescendantV1::LevelUpPresentation { end, .. }) =
                pending.victory.as_ref().map(|victory| &victory.descendant)
            else {
                return Err(GameRuntimeV6Error::Action);
            };
            let children =
                crate::current_experience_settlement::plan_current_level_up_children(
                    before, content, end,
                )?;
            victory_mut(&mut candidate, index)?.descendant =
                CurrentVictoryDescendantV1::LevelUpChildren { children };
        }
        GameOwnedPhaseV1::VictoryDescendant => {
            let (index, pending) = active_pending(owner, faints)?;
            let victory = pending.victory.as_ref().ok_or(GameRuntimeV6Error::Action)?;
            let children = match &victory.descendant {
                CurrentVictoryDescendantV1::LevelUpChildren { children } => children.clone(),
                CurrentVictoryDescendantV1::LearnMoveBatch { batch } if batch.complete => {
                    batch.children.clone()
                }
                _ => return Err(GameRuntimeV6Error::Action),
            };
            let menu_base = turn_menu_base(turn)?;
            match &victory.descendant {
                CurrentVictoryDescendantV1::LevelUpChildren { .. }
                    if !children.learn_move_candidates.is_empty() =>
                {
                    let batch =
                        crate::current_experience_settlement::begin_current_learn_move_batch(
                            before, content, &children,
                        )?;
                    let complete = batch.complete;
                    victory_mut(&mut candidate, index)?.descendant =
                        CurrentVictoryDescendantV1::LearnMoveBatch { batch: batch.clone() };
                    if !complete {
                        install_learn_batch_control(
                            &mut candidate,
                            pending.id,
                            &batch,
                            authority_seat,
                            next_revision,
                            menu_base,
                        )?;
                    }
                }
                _ if !children.evolution_candidates.is_empty() => {
                    victory_mut(&mut candidate, index)?.descendant =
                        CurrentVictoryDescendantV1::Evolution {
                            children: children.clone(),
                        };
                    install_evolution_control(
                        &mut candidate,
                        pending.id,
                        &children,
                        authority_seat,
                        next_revision,
                        menu_base,
                    )?;
                }
                _ => {
                    advance_victory(
                        victory_mut(&mut candidate, index)?,
                        children.parent.level_up.award.clone(),
                    )?;
                }
            }
        }
        GameOwnedPhaseV1::PendingResolve => {
            if owner.pending.iter().any(|pending| !pending_resolved(pending)) {
                return Err(GameRuntimeV6Error::Action);
            }
            if turn.finalization_done {
                candidate.current_turn_execution = None;
                finish_owned_battle_tail(
                    &mut candidate,
                    content,
                    turn,
                    authority_seat,
                    next_revision,
                )?;
            } else {
                candidate
                    .current_turn_execution
                    .as_mut()
                    .ok_or(GameRuntimeV6Error::Invalid)?
                    .stage = CurrentTurnStageV1::ReadyForMove;
            }
        }
        _ => return Err(GameRuntimeV6Error::Invalid),
    }
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let before_digest = game_state_digest(before).map_err(material_error)?;
    let after_digest = game_state_digest(&candidate).map_err(material_error)?;
    let next_control = normalize_next_control(&mut candidate, next_revision)?;
    Ok(GameTransitionMaterialV6 {
        schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain: GameActionDomainV2::Progression,
        operation_id,
        authority_seat,
        authority_revision: revision,
        content_identity: before.content_identity.clone(),
        accepted_action: None,
        owned_phase: Some(phase),
        before_digest,
        after_digest,
        mutations: vec![GameMutationEvidenceV2 {
            ordinal: 0,
            domain: GameActionDomainV2::Progression,
            kind: GameMutationKindV2::StateChanged,
            before_digest: before_digest.clone(),
            after_digest: after_digest.clone(),
        }],
        rng_audit: Vec::new(),
        after_state: candidate,
        next_control,
        presentation,
        platform_effects: Vec::new(),
    })
}
