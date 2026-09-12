//! Automatic source phase transactions. No public menu action is fabricated.
use super::*;
use er_state::current_experience_owner::CurrentFriendshipClockRequestV1;
use er_state::current_turn_execution::CurrentTurnStageV1;
use er_types::SeatId;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum GameOwnedPhaseV1 {
    TurnStep,
    TurnFinish,
    FriendshipBegin,
    FaintBegin {
        pending: SafeU53,
    },
    FaintPresentation {
        pending: SafeU53,
        event_id: PresentationEventId,
        animation: bool,
    },
    Victory {
        pending: SafeU53,
        menu_instance: MenuInstanceId,
    },
    VictoryTail {
        pending: SafeU53,
    },
    VictoryPresentation {
        pending: SafeU53,
        event_id: PresentationEventId,
    },
    AchievementClock {
        request: er_state::current_achievement_execution::CurrentAchievementClockRequestV1,
        utc_milliseconds: i64,
    },
    FlashEgg {
        input: Box<er_state::current_achievement_execution::CurrentFlashEggInputsV1>,
    },
    FriendshipClock {
        request: CurrentFriendshipClockRequestV1,
        utc_milliseconds: i64,
    },
}

/// The observation owner remains restricted to 1v1. Controlled mechanics may
/// retain actions only with an explicitly incomplete tracker and no XP owner;
/// absence alone never grants source progression or achievement authority.
pub(super) fn unobserved_mechanical_battle(state: &GameStateV6) -> bool {
    state.current_presentation.is_some()
        && state.current_targeting.is_some()
        && state.current_achievement_tracker.as_ref().is_some_and(|tracker| {
            tracker.history == er_state::current_achievement_tracker::CurrentAchievementHistoryV1::UnobservedMechanicalFixture
        })
        && state.active_run.as_ref().and_then(|run| run.battle.as_ref()).is_some_and(|battle| {
            match state.current_battle_participation.as_ref() {
                Some(participation) => participation.experience.is_none()
                    && battle.format == er_types::battle_ids::BattleFormat::single(),
                None => battle.format.player_capacity == 2 && battle.format.enemy_capacity == 2,
            }
        })
}

pub(super) fn begin_owned_turn(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    commands: &CommandSet,
    authority: &TurnAuthorityContextV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    if before.current_turn_execution.is_some()
        || before.current_presentation.is_none()
        || (before.current_battle_participation.is_none() && !unobserved_mechanical_battle(before))
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let (command_state, mut command_audit) =
        crate::current_random_target_admission::stage_complete_commands(before, commands, content)?;
    let command_sequence = command_state
        .current_random_target_commands
        .as_ref()
        .and_then(|owner| owner.entries.last())
        .map(|entry| entry.draw.sequence.get())
        .map(|sequence| {
            SafeU53::new(sequence.checked_add(1).ok_or(GameRuntimeV6Error::Invalid)?)
                .map_err(|_| GameRuntimeV6Error::Invalid)
        })
        .transpose()?
        .unwrap_or(SafeU53::ZERO);
    let targeting =
        er_battle::current_target_execution::CurrentTargetExecution::from_state(&command_state)
            .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let chunk = er_battle::m7_resolver::begin_current_turn(
        &project_v5(&command_state),
        commands,
        &content.battle,
        authority,
        &targeting,
        command_sequence,
    )
    .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let mut candidate = adopt_v5_with_turn(
        &command_state,
        chunk.transition.after_state,
        before.current_battle_participation.clone(),
        Some(chunk.continuation),
    )?;
    install_waiting(&mut candidate, authority.revision)?;
    fold_action_tracker(before, &mut candidate, content, &[], &[])?;
    command_audit.extend(chunk.transition.rng_audit);
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        rng_audit: command_audit,
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

fn fold_action_tracker(
    before: &GameStateV6,
    candidate: &mut GameStateV6,
    content: &PreparedGameContentV2,
    events: &[er_state::current_battle_source_events::CurrentBattleSourceEventV1],
    cues: &[er_battle::m7_resolver::BattlePresentationCueV5],
) -> Result<(), GameRuntimeV6Error> {
    use er_state::current_achievement_tracker::CurrentAchievementHistoryV1;
    let tracker = before
        .current_achievement_tracker
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    if candidate.current_achievement_tracker.as_ref() != Some(tracker) {
        return Err(GameRuntimeV6Error::CandidateMismatch);
    }
    match tracker.history {
        CurrentAchievementHistoryV1::FreshComplete => {
            let (next, requests) =
                crate::current_achievement_action::fold_current_achievement_action(
                    before, candidate, content, events, cues,
                )?;
            if !requests.is_empty() {
                return Err(GameRuntimeV6Error::Domain(format!(
                    "action achievement requests require owned reward dispatch: {}",
                    requests.join(",")
                )));
            }
            candidate.current_achievement_tracker = Some(next);
        }
        CurrentAchievementHistoryV1::UnobservedMechanicalFixture => {
            // This explicit test provenance retains its actual data as an
            // incomplete history. It cannot authorize Faint, XP or rewards.
        }
    }
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
    if matches!(phase, GameOwnedPhaseV1::VictoryTail { .. }) {
        return current_victory_transition::transition(
            before,
            content,
            operation_id,
            authority_seat,
            revision,
            phase,
        );
    }
    let turn = before
        .current_turn_execution
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    if matches!(
        phase,
        GameOwnedPhaseV1::FaintBegin { .. } | GameOwnedPhaseV1::FaintPresentation { .. }
    ) {
        return current_faint_transition::transition(
            before,
            content,
            operation_id,
            authority_seat,
            revision,
            phase,
        );
    }
    if matches!(
        phase,
        GameOwnedPhaseV1::Victory { .. }
            | GameOwnedPhaseV1::VictoryPresentation { .. }
            | GameOwnedPhaseV1::AchievementClock { .. }
            | GameOwnedPhaseV1::FlashEgg { .. }
    ) {
        return current_victory_transition::transition(
            before,
            content,
            operation_id,
            authority_seat,
            revision,
            phase,
        );
    }
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
        GameOwnedPhaseV1::TurnStep
        | GameOwnedPhaseV1::TurnFinish
        | GameOwnedPhaseV1::Victory { .. }
        | GameOwnedPhaseV1::VictoryPresentation { .. }
        | GameOwnedPhaseV1::VictoryTail { .. }
        | GameOwnedPhaseV1::AchievementClock { .. }
        | GameOwnedPhaseV1::FlashEgg { .. }
        | GameOwnedPhaseV1::FaintBegin { .. }
        | GameOwnedPhaseV1::FaintPresentation { .. } => {
            return Err(GameRuntimeV6Error::Invalid);
        }
        GameOwnedPhaseV1::FriendshipBegin => {
            let started = crate::current_victory_start::begin(before, content, pending.id)?;
            crate::current_friendship_execution::prepare_next_friendship(&started, content)?
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

#[path = "current_faint_transition.rs"]
mod current_faint_transition;
#[path = "current_victory_transition.rs"]
mod current_victory_transition;

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
    let participation = match before.current_battle_participation.as_ref() {
        Some(participation) => Some(
            participation
                .observe_current_chunk(run, after_run, &events, owner, &chunk.continuation)
                .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?,
        ),
        None if unobserved_mechanical_battle(before) => None,
        None => return Err(GameRuntimeV6Error::Action),
    };
    let mut candidate = adopt_v5_with_turn(
        before,
        chunk.transition.after_state,
        participation,
        Some(chunk.continuation),
    )?;
    install_waiting(&mut candidate, revision)?;
    if candidate
        .current_turn_execution
        .as_ref()
        .is_some_and(|turn| turn.stage == CurrentTurnStageV1::Complete)
        && chunk.transition.outcome == BattleOutcome::Ongoing
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
        let next_owner = next_battle_control_owner(&candidate)?;
        install_battle_command_control(
            &mut candidate,
            next_owner,
            authority_seat,
            safe_increment(revision)?,
            menu_instance,
        )?;
    }
    fold_action_tracker(
        before,
        &mut candidate,
        content,
        chunk
            .transition
            .source_events
            .as_deref()
            .ok_or(GameRuntimeV6Error::Invalid)?,
        &chunk.transition.presentation,
    )?;
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
