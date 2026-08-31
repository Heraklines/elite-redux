//! Atomic turn and stored-replacement orchestration.

use std::collections::BTreeSet;

use er_content::moves::MoveDefinitionError;
use er_content::pack::ContentPack;
use er_rng::audit::{RngDraw, RngReason, RngStream};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_state::battle::{
    BattleOutcome, BattleState, CommandCollectionState, FaintOccurrence, ReplacementProgress,
};
use er_state::digest::compute_mechanical_state_digest;
use er_state::pokemon::PokemonState;
use er_state::snapshot::GameState;
use er_state::validation::StateValidationError;
use er_types::battle_command::{
    BattleCommandError, CommandSet, ReplacementSelection, validate_turn_result_operation_id,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleSide, FaintOccurrenceId, FieldSlot, MoveId, PokemonId,
};
use er_types::battle_model::{
    ActionDisposition, BattleStat, CapabilitySubject, ResolvedAction, ResolvedActionKind,
    StatusKind,
};
use er_types::{OperationId, SafeU53};

use crate::ability::AbilityError;
use crate::ability_pipeline::{
    AbilityPipelineError, DefensiveAbilityInput, DefensiveAbilityOutcome, SwitchInOutcome,
    evaluate_defensive_ability, evaluate_switch_in_ability,
};
use crate::action_order::{
    ActionOrderError, PendingAction, UnsupportedOrdering,
    build_pending_action_queue_from_commands_validated, effective_speed,
};
use crate::command::NormalizedBattleCommand;
use crate::error::{BattleInvariantError, BattleResolveError};
use crate::faint::{FaintCandidate, FaintQueueError, queue_faint};
use crate::legality::{
    CommandLegalityError, normalize_command_set_trusted, validate_state_content,
    validate_state_content_trusted,
};
use crate::move_effect::{
    DefensiveAbilityBlockReason, DefensiveAbilityGate, DefensiveAbilityGateError,
    DefensiveAbilityGateInput, DefensiveAbilityGateResult, DefensiveAbilityGateUnsupportedReason,
    MoveEffectError, MoveTargetResult, TargetEffectDisposition,
};
use crate::move_pipeline::{
    MovePipelineDisposition, MovePipelineError, MovePipelineResult, TargetSelectionError,
    resolve_move_validated,
};
use crate::outcome::derive_battle_outcome;
use crate::presentation::{
    PresentationCausalEvent, ReplacementPresentationInput, TurnPresentationInput,
    build_replacement_presentation_plan, build_turn_presentation_plan,
};
use crate::replacement::{
    ReplacementError, apply_selected_replacement, resolve_no_legal_replacement,
    resolve_not_required, stored_faint_source, validate_stored_replacement_operation,
};
use crate::resolver::{
    BattleMutation, BattleNextDecision, BattleReplacementTransition, BattleTransition,
    validate_battle_mutation_evidence,
};
use crate::stat_stage::{MIN_STAT_STAGE, StatStageError, set_stage};
use crate::status::{
    StatusApplicationOutcome, StatusError, StatusResidualInput, StatusResidualOutcome,
    resolve_residual,
};
use crate::switch::{SwitchError, resolve_switch};
use crate::type_effectiveness::TypeEffectivenessError;
use crate::{accuracy::AccuracyError, critical::CriticalError, damage::DamageError};

/// Resolve one complete admitted turn as an atomic transition.
pub fn resolve_turn(
    before: &GameState,
    commands: &CommandSet,
    authority_epoch: AuthorityEpoch,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleTransition, BattleResolveError> {
    validate_state_content(before, content)?;
    resolve_turn_validated(
        before,
        commands,
        authority_epoch,
        material_operation_id,
        content,
        |_, _, _, _| Ok::<(), BattleResolveError>(()),
    )
}

/// Resolve a turn after the enclosing immutable-content owner has already
/// validated the retained content pack.
#[doc(hidden)]
pub fn resolve_turn_trusted(
    before: &GameState,
    commands: &CommandSet,
    authority_epoch: AuthorityEpoch,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleTransition, BattleResolveError> {
    resolve_turn_trusted_with_finalizer(
        before,
        commands,
        authority_epoch,
        material_operation_id,
        content,
        |_, _, _, _| Ok::<(), BattleResolveError>(()),
    )
}

/// Resolve a trusted turn and run one game-owned finalizer before the
/// resolver's final after-state validation, digest, and mutation-evidence
/// proof. The returned transition is never exposed before that combined
/// proof succeeds. The finalizer's decision argument is a pre-finalization
/// hint; authoritative outcome and decision metadata are derived afterward.
#[doc(hidden)]
pub fn resolve_turn_trusted_with_finalizer<Finalizer, FinalizerError>(
    before: &GameState,
    commands: &CommandSet,
    authority_epoch: AuthorityEpoch,
    material_operation_id: &OperationId,
    content: &ContentPack,
    finalizer: Finalizer,
) -> Result<BattleTransition, FinalizerError>
where
    Finalizer: FnOnce(
        &GameState,
        &mut GameState,
        &mut Vec<BattleMutation>,
        BattleNextDecision,
    ) -> Result<(), FinalizerError>,
    FinalizerError: From<BattleResolveError>,
{
    validate_state_content_trusted(before, content)
        .map_err(BattleResolveError::from)
        .map_err(FinalizerError::from)?;
    resolve_turn_validated(
        before,
        commands,
        authority_epoch,
        material_operation_id,
        content,
        finalizer,
    )
}

fn resolve_turn_validated<Finalizer, FinalizerError>(
    before: &GameState,
    commands: &CommandSet,
    authority_epoch: AuthorityEpoch,
    material_operation_id: &OperationId,
    content: &ContentPack,
    finalizer: Finalizer,
) -> Result<BattleTransition, FinalizerError>
where
    Finalizer: FnOnce(
        &GameState,
        &mut GameState,
        &mut Vec<BattleMutation>,
        BattleNextDecision,
    ) -> Result<(), FinalizerError>,
    FinalizerError: From<BattleResolveError>,
{
    if authority_epoch == AuthorityEpoch::ZERO {
        return Err(FinalizerError::from(map_faint_input_error(
            FaintQueueError::ZeroAuthorityEpoch,
        )));
    }
    let before_battle = active_battle(before)?;
    validate_turn_result_operation_id(
        material_operation_id,
        before_battle.battle_id,
        before_battle.wave,
        before_battle.turn,
    )
    .map_err(CommandLegalityError::Command)
    .map_err(BattleResolveError::from)?;
    let before_digest =
        compute_mechanical_state_digest(before).map_err(BattleResolveError::from)?;
    let normalized = normalize_command_set_trusted(before, commands, content)
        .map_err(BattleResolveError::from)?;
    let mut queue =
        build_pending_action_queue_from_commands_validated(before, normalized.entries(), content)
            .map_err(|source| map_action_order_error(source, before, false))?;
    let mut after = before.clone();
    let mut runtime = RngRuntime::from_states(
        before.run_rng.clone(),
        Some(before_battle.battle_rng.clone()),
    )
    .map_err(BattleResolveError::from)?;
    let gate = ContentDefensiveAbilityGate { content };
    let mut action_order = Vec::new();
    let mut mutations = Vec::new();
    let mut causal_events = Vec::new();
    let mut turn_occurrence = 0_u32;
    let mut flinched = BTreeSet::new();

    while let Some(action) = queue
        .pop_next(&after, &mut runtime)
        .map_err(|source| map_action_order_error(source, &after, true))?
    {
        if matches!(action.command, NormalizedBattleCommand::Fight { .. })
            && flinched.remove(&action.actor)
        {
            push_pending_action(
                &mut action_order,
                &action,
                ActionDisposition::CancelledByFlinch,
            )?;
            continue;
        }
        match &action.command {
            NormalizedBattleCommand::Switch { .. } => {
                resolve_switch_action(
                    &mut after,
                    &action,
                    content,
                    &mut action_order,
                    &mut mutations,
                    &mut causal_events,
                )?;
            }
            NormalizedBattleCommand::Fight { .. } => {
                let newly_flinched = resolve_move_action(
                    &mut after,
                    &action,
                    content,
                    &gate,
                    &mut runtime,
                    authority_epoch,
                    &mut turn_occurrence,
                    &mut action_order,
                    &mut mutations,
                    &mut causal_events,
                )?;
                flinched.extend(newly_flinched);
            }
        }
        {
            let battle = active_battle_mut(&mut after)?;
            drain_internal_faint_heads(battle, &mut mutations, &mut causal_events)?;
            update_outcome(battle, &mut mutations, &mut causal_events);
            if battle.outcome != BattleOutcome::Ongoing {
                break;
            }
        }
    }

    if active_battle(&after)?.outcome == BattleOutcome::Ongoing {
        resolve_residual_phase(
            &mut after,
            authority_epoch,
            &mut turn_occurrence,
            &mut action_order,
            &mut mutations,
            &mut causal_events,
        )?;
        let battle = active_battle_mut(&mut after)?;
        drain_internal_faint_heads(battle, &mut mutations, &mut causal_events)?;
        update_outcome(battle, &mut mutations, &mut causal_events);
    }

    clear_command_collection(&mut after, &mut mutations, &mut causal_events)?;
    if active_battle(&after)?.outcome == BattleOutcome::Ongoing {
        advance_turn_boundary(&mut after, &mut runtime, &mut mutations, &mut causal_events)?;
    } else {
        sync_rng_state(&mut after, &runtime)?;
    }

    let finalizer_decision_hint = {
        let battle = active_battle(&after)?;
        next_decision(battle, battle.outcome)
    };
    finalizer(before, &mut after, &mut mutations, finalizer_decision_hint)?;
    validate_after_state_trusted(&after, content)?;
    let (outcome, next_decision) = {
        let battle = active_battle(&after)?;
        let outcome = battle.outcome;
        (outcome, next_decision(battle, outcome))
    };
    let after_digest = compute_mechanical_state_digest(&after).map_err(BattleResolveError::from)?;
    let presentation = build_turn_presentation_plan(TurnPresentationInput::new(
        material_operation_id,
        &action_order,
        &causal_events,
        outcome,
    ))
    .map_err(BattleResolveError::from)?;
    validate_battle_mutation_evidence(before, &after, &mutations)
        .map_err(BattleResolveError::from)?;

    Ok(BattleTransition {
        before_state: before.clone(),
        after_state: after,
        before_digest,
        after_digest,
        accepted_commands: commands.clone(),
        action_order,
        mutations,
        presentation,
        rng_audit: runtime.audit_entries().to_vec(),
        outcome,
        next_decision,
    })
}

/// Resolve one stored player faint decision without consuming RNG or advancing
/// the public battle turn.
pub fn resolve_replacement(
    before: &GameState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleReplacementTransition, BattleResolveError> {
    validate_state_content(before, content)?;
    resolve_replacement_validated(
        before,
        occurrence,
        selection,
        material_operation_id,
        content,
    )
}

/// Resolve a replacement after the enclosing immutable-content owner has
/// already validated the retained content pack.
#[doc(hidden)]
pub fn resolve_replacement_trusted(
    before: &GameState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleReplacementTransition, BattleResolveError> {
    validate_state_content_trusted(before, content)?;
    resolve_replacement_validated(
        before,
        occurrence,
        selection,
        material_operation_id,
        content,
    )
}

fn resolve_replacement_validated(
    before: &GameState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleReplacementTransition, BattleResolveError> {
    let before_digest = compute_mechanical_state_digest(before)?;
    let mut after = before.clone();

    let primary = {
        let battle = active_battle_mut(&mut after)?;
        let stored = stored_faint_source(battle, occurrence)
            .map_err(|source| map_replacement_error(source, false))?;
        validate_stored_replacement_operation(material_operation_id, battle.battle_id, stored)
            .map_err(|source| map_replacement_error(source, false))?;
        match selection {
            ReplacementSelection::Selected { .. } => {
                apply_selected_replacement(battle, occurrence, selection)
                    .map_err(|source| map_replacement_error(source, false))?
            }
            ReplacementSelection::NoLegalReplacement => {
                // `er-game` constructs this branch only as an internal
                // deterministic intent. The resolver independently proves
                // that the stored owner has no legal candidate.
                resolve_no_legal_replacement(battle, occurrence)
                    .map_err(|source| map_replacement_error(source, false))?
            }
        }
    };

    let mut mutations = Vec::with_capacity(primary.mutations.len());
    let mut causal_events = Vec::with_capacity(primary.mutations.len());
    for mutation in primary.mutations.iter().cloned() {
        record_mutation(&mut mutations, &mut causal_events, mutation);
    }
    if matches!(*selection, ReplacementSelection::Selected { .. }) {
        let incoming_slot = primary.occurrence.slot;
        let ability_subject = slot_ability_subject(&after, incoming_slot);
        let ability_outcome =
            evaluate_switch_in_ability(active_battle(&after)?, incoming_slot, content)
                .map_err(|source| map_ability_pipeline_error(source, ability_subject))?;
        apply_switch_in_outcome(
            &mut after,
            &ability_outcome,
            &mut mutations,
            &mut causal_events,
        )?;
    }
    {
        let battle = active_battle_mut(&mut after)?;
        drain_internal_faint_heads(battle, &mut mutations, &mut causal_events)?;
        update_outcome(battle, &mut mutations, &mut causal_events);
    }

    validate_after_state_trusted(&after, content)?;
    let after_digest = compute_mechanical_state_digest(&after)?;
    let battle = active_battle(&after)?;
    let outcome = battle.outcome;
    let next_decision = next_decision(battle, outcome);
    let presentation = build_replacement_presentation_plan(ReplacementPresentationInput::new(
        material_operation_id,
        &causal_events,
        outcome,
    ))?;
    validate_battle_mutation_evidence(before, &after, &mutations)?;

    Ok(BattleReplacementTransition {
        before_state: before.clone(),
        after_state: after,
        before_digest,
        after_digest,
        occurrence: primary.occurrence,
        selection: primary.selection,
        mutations,
        presentation,
        outcome,
        next_decision,
    })
}

struct ContentDefensiveAbilityGate<'a> {
    content: &'a ContentPack,
}

impl DefensiveAbilityGate for ContentDefensiveAbilityGate<'_> {
    fn evaluate(
        &self,
        input: DefensiveAbilityGateInput<'_>,
    ) -> Result<DefensiveAbilityGateResult, DefensiveAbilityGateError> {
        let outcome = evaluate_defensive_ability(
            DefensiveAbilityInput {
                ability_id: input.target.abilities.active,
                ability_suppressed: input.target.abilities.active_suppressed,
                global_suppressed: input.abilities_ignored,
                move_category: input.move_category,
                type_effectiveness: input.effectiveness,
            },
            self.content,
        )
        .map_err(|source| match source {
            AbilityPipelineError::Ability(AbilityError::UnsupportedContent { .. }) => {
                DefensiveAbilityGateError::Unsupported {
                    reason: DefensiveAbilityGateUnsupportedReason::UnsupportedAbilityEffect,
                }
            }
            AbilityPipelineError::UnsupportedSuppression { .. } => {
                DefensiveAbilityGateError::Unsupported {
                    reason: DefensiveAbilityGateUnsupportedReason::DynamicSuppression,
                }
            }
            AbilityPipelineError::Ability(_)
            | AbilityPipelineError::Format(_)
            | AbilityPipelineError::Field(_)
            | AbilityPipelineError::MissingSourceOccupant { .. }
            | AbilityPipelineError::MissingPartyPokemon { .. }
            | AbilityPipelineError::MissingDefensiveTarget { .. }
            | AbilityPipelineError::NativeTypeImmunityTerminal { .. } => {
                DefensiveAbilityGateError::InvalidContext
            }
        })?;

        Ok(match outcome {
            DefensiveAbilityOutcome::Passed { .. } => DefensiveAbilityGateResult::Pass,
            DefensiveAbilityOutcome::Blocked { ability_id, .. } => {
                DefensiveAbilityGateResult::Blocked {
                    ability: Some(ability_id),
                    reason: DefensiveAbilityBlockReason::NonSuperEffectiveAttack,
                }
            }
        })
    }
}

fn resolve_switch_action(
    state: &mut GameState,
    action: &PendingAction,
    content: &ContentPack,
    action_order: &mut Vec<ResolvedAction>,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    let resolution = {
        let battle = active_battle_mut(state)?;
        resolve_switch(battle, &action.command, |updated, evidence| {
            evaluate_switch_in_ability(updated, evidence.slot, content)
        })
    };
    let resolution = resolution.map_err(map_switch_error)?;
    let ability_subject = switch_ability_subject(state, action);
    let ability_outcome = resolution
        .post_switch
        .map_err(|source| map_ability_pipeline_error(source, ability_subject))?;

    push_pending_action(action_order, action, ActionDisposition::Executed)?;
    record_mutation(mutations, causal_events, resolution.mutation);
    apply_switch_in_outcome(state, &ability_outcome, mutations, causal_events)
}

fn apply_switch_in_outcome(
    state: &mut GameState,
    outcome: &SwitchInOutcome,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    match outcome {
        SwitchInOutcome::Triggered {
            source, ability_id, ..
        }
        | SwitchInOutcome::NoMutation {
            source, ability_id, ..
        } => causal_events.push(PresentationCausalEvent::ability_activated(
            *source,
            *ability_id,
        )),
        SwitchInOutcome::NoOp { .. }
        | SwitchInOutcome::Suppressed { .. }
        | SwitchInOutcome::NotApplicable { .. } => {}
    }

    for attempt in outcome.attempts() {
        causal_events.push(PresentationCausalEvent::stat_stage_attempted(
            attempt.target,
            BattleStat::Attack,
            attempt.mutation.before,
            attempt.mutation.after,
        ));
    }

    for change in outcome.mutations() {
        let target = find_pokemon_mut(state, change.target_slot, change.target)?;
        set_stage(
            &mut target.stat_stages,
            BattleStat::Attack,
            change.mutation.after,
        );
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::StatStageChanged {
                pokemon: change.target,
                stat: BattleStat::Attack,
                before: change.mutation.before,
                after: change.mutation.after,
            },
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn resolve_move_action(
    state: &mut GameState,
    action: &PendingAction,
    content: &ContentPack,
    gate: &ContentDefensiveAbilityGate<'_>,
    runtime: &mut RngRuntime,
    authority_epoch: AuthorityEpoch,
    turn_occurrence: &mut u32,
    action_order: &mut Vec<ResolvedAction>,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<Vec<PokemonId>, BattleResolveError> {
    let rng_audit_start = runtime.audit_entries().len();
    let result = {
        let battle = active_battle_mut(state)?;
        resolve_move_validated(battle, &action.command, content, runtime, gate)
    }
    .map_err(|source| map_move_pipeline_error(source, state, action))?;
    sync_rng_state(state, runtime)?;

    let action_sequence = push_pending_action(action_order, action, move_disposition(&result))?;

    let new_battle_draws = runtime
        .audit_entries()
        .iter()
        .skip(rng_audit_start)
        .filter(|draw| draw.stream == RngStream::Battle)
        .collect::<Vec<_>>();
    let paralysis_draw_first = new_battle_draws
        .first()
        .is_some_and(|draw| draw.reason == RngReason::ParalysisActivation);
    if paralysis_draw_first {
        let draw = new_battle_draws[0];
        record_battle_rng_draw(draw, mutations, causal_events)?;
    }
    if let Some(pp) = result.pp_mutation {
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::PpChanged {
                pokemon: pp.pokemon,
                move_slot: pp.move_slot,
                before: pp.before,
                after: pp.after,
            },
        );
    }
    for draw in new_battle_draws
        .into_iter()
        .skip(usize::from(paralysis_draw_first))
    {
        record_battle_rng_draw(draw, mutations, causal_events)?;
    }
    causal_events.push(PresentationCausalEvent::move_used(
        action_sequence,
        result.actor,
        result.move_id,
        action.targets.clone(),
    ));

    for target in &result.targets {
        if let (
            Some(pokemon),
            TargetEffectDisposition::DefensiveAbilityBlocked {
                ability: Some(ability_id),
                ..
            },
        ) = (target.pokemon, target.disposition)
        {
            causal_events.push(PresentationCausalEvent::ability_activated(
                pokemon, ability_id,
            ));
        }
        append_target_mutations(target, mutations, causal_events);
        if let Some(request) = target.faint_request {
            queue_faint_action(
                state,
                FaintCandidate::from(&request),
                authority_epoch,
                turn_occurrence,
                action_order,
                mutations,
                causal_events,
            )?;
        }
    }
    Ok(result
        .targets
        .iter()
        .filter(|target| target.flinched)
        .filter_map(|target| target.pokemon)
        .collect())
}

fn record_battle_rng_draw(
    draw: &RngDraw,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    let before = draw
        .before_state
        .battle
        .clone()
        .ok_or(RngError::MissingBattleState)?;
    let after = draw
        .after_state
        .battle
        .clone()
        .ok_or(RngError::MissingBattleState)?;
    if before == after {
        return Ok(());
    }
    record_mutation(
        mutations,
        causal_events,
        BattleMutation::BattleRngChanged { before, after },
    );
    Ok(())
}

fn move_disposition(result: &MovePipelineResult) -> ActionDisposition {
    match result.disposition {
        MovePipelineDisposition::SkippedActorInactive => ActionDisposition::SkippedActorInactive,
        MovePipelineDisposition::CancelledByParalysis => ActionDisposition::CancelledByParalysis,
        MovePipelineDisposition::Executed => {
            if result
                .targets
                .iter()
                .any(|target| target.disposition == TargetEffectDisposition::Executed)
            {
                ActionDisposition::Executed
            } else if result.targets.iter().any(|target| {
                matches!(
                    target.disposition,
                    TargetEffectDisposition::Missed
                        | TargetEffectDisposition::NativeTypeImmune
                        | TargetEffectDisposition::DefensiveAbilityBlocked { .. }
                )
            }) {
                ActionDisposition::Missed
            } else {
                ActionDisposition::NoEffect
            }
        }
    }
}

fn append_target_mutations(
    target: &MoveTargetResult,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) {
    if let Some(hp) = target.hp_mutation {
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::HpChanged {
                pokemon: hp.pokemon,
                before: hp.before,
                after: hp.after,
            },
        );
    }
    for status in &target.status_effects {
        if let StatusApplicationOutcome::Applied { mutation } = status
            && let Some(pokemon) = target.pokemon
        {
            record_mutation(
                mutations,
                causal_events,
                BattleMutation::StatusChanged {
                    pokemon,
                    before: mutation.before,
                    after: mutation.after,
                },
            );
        }
    }
    for stage in &target.stat_stage_effects {
        if let Some(pokemon) = target.pokemon {
            if stage.changed {
                record_mutation(
                    mutations,
                    causal_events,
                    BattleMutation::StatStageChanged {
                        pokemon,
                        stat: stage.stat,
                        before: stage.before,
                        after: stage.after,
                    },
                );
            } else if stage.delta < 0
                && stage.before == MIN_STAT_STAGE
                && stage.after == MIN_STAT_STAGE
            {
                causal_events.push(PresentationCausalEvent::stat_stage_attempted(
                    pokemon,
                    stage.stat,
                    stage.before,
                    stage.after,
                ));
            }
        }
    }
}

fn resolve_residual_phase(
    state: &mut GameState,
    authority_epoch: AuthorityEpoch,
    turn_occurrence: &mut u32,
    action_order: &mut Vec<ResolvedAction>,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    let occupied_slots: Vec<(FieldSlot, PokemonId)> = active_battle(state)?
        .field
        .slots
        .iter()
        .filter_map(|entry| entry.occupant.map(|pokemon| (entry.slot, pokemon)))
        .collect();

    for (slot, pokemon_id) in occupied_slots {
        let pokemon = find_pokemon(state, slot, pokemon_id)?.clone();
        let outcome = resolve_residual(StatusResidualInput {
            status: pokemon.status,
            hp: pokemon.hp,
            max_hp: pokemon.max_hp,
        })
        .map_err(|source| map_status_error(source, Some(pokemon.status.kind), None, true))?;
        let StatusResidualOutcome::Applied { mutation } = outcome else {
            continue;
        };

        let speed = effective_speed(&pokemon)
            .map_err(|source| map_action_order_error(source, state, true))?;
        {
            let target = find_pokemon_mut(state, slot, pokemon_id)?;
            target.status = mutation.status_after;
            target.hp = mutation.hp_after;
            target.fainted = mutation.hp_after == 0;
        }
        push_non_command_action(
            action_order,
            ResolvedActionKind::ResidualStatus,
            pokemon_id,
            slot,
            speed,
        )?;
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::StatusChanged {
                pokemon: pokemon_id,
                before: mutation.status_before,
                after: mutation.status_after,
            },
        );
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::HpChanged {
                pokemon: pokemon_id,
                before: mutation.hp_before,
                after: mutation.hp_after,
            },
        );

        if mutation.hp_after == 0 {
            queue_faint_action(
                state,
                FaintCandidate::new(pokemon_id, slot),
                authority_epoch,
                turn_occurrence,
                action_order,
                mutations,
                causal_events,
            )?;
        }
    }
    Ok(())
}

fn queue_faint_action(
    state: &mut GameState,
    candidate: FaintCandidate,
    authority_epoch: AuthorityEpoch,
    turn_occurrence: &mut u32,
    action_order: &mut Vec<ResolvedAction>,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    let speed = effective_speed(find_pokemon(state, candidate.slot, candidate.pokemon)?)
        .map_err(|source| map_action_order_error(source, state, true))?;
    let queued = {
        let battle = active_battle_mut(state)?;
        queue_faint(battle, candidate, authority_epoch, *turn_occurrence)
    }
    .map_err(map_faint_error)?;
    *turn_occurrence = turn_occurrence
        .checked_add(1)
        .ok_or(FaintQueueError::TurnOccurrenceOverflow)
        .map_err(map_faint_error)?;
    record_mutation(mutations, causal_events, queued.mutation);
    push_non_command_action(
        action_order,
        ResolvedActionKind::Faint,
        candidate.pokemon,
        candidate.slot,
        speed,
    )?;
    Ok(())
}

fn push_pending_action(
    action_order: &mut Vec<ResolvedAction>,
    action: &PendingAction,
    disposition: ActionDisposition,
) -> Result<SafeU53, BattleResolveError> {
    let sequence = next_action_sequence(action_order)?;
    action_order.push(ResolvedAction {
        sequence,
        kind: action.kind,
        actor: action.actor,
        source_slot: action.source_slot,
        command_operation_id: Some(action.command_operation_id.clone()),
        effective_speed: action.effective_speed,
        timing_modifier: action.timing_modifier,
        move_priority: action.move_priority,
        bracket_modifier: action.bracket_modifier,
        tie_order: action.tie_order,
        disposition,
    });
    Ok(sequence)
}

fn push_non_command_action(
    action_order: &mut Vec<ResolvedAction>,
    kind: ResolvedActionKind,
    actor: PokemonId,
    source_slot: FieldSlot,
    effective_speed: u32,
) -> Result<(), BattleResolveError> {
    let sequence = next_action_sequence(action_order)?;
    action_order.push(ResolvedAction {
        sequence,
        kind,
        actor,
        source_slot,
        command_operation_id: None,
        effective_speed,
        timing_modifier: 0,
        move_priority: 0,
        bracket_modifier: 0,
        tie_order: SafeU53::ZERO,
        disposition: ActionDisposition::Executed,
    });
    Ok(())
}

fn next_action_sequence(action_order: &[ResolvedAction]) -> Result<SafeU53, BattleResolveError> {
    let value = u64::try_from(action_order.len()).map_err(|_| RngError::SliceTooLong)?;
    SafeU53::new(value).map_err(|_| RngError::SliceTooLong.into())
}

fn record_mutation(
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
    mutation: BattleMutation,
) {
    causal_events.push(PresentationCausalEvent::mutation(mutation.clone()));
    mutations.push(mutation);
}

fn clear_command_collection(
    state: &mut GameState,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    let battle = active_battle_mut(state)?;
    let before = battle.command_state.clone();
    let after = CommandCollectionState::new(Vec::new(), before.tombstones.clone())
        .map_err(CommandLegalityError::Command)?;
    if before != after {
        battle.command_state = after.clone();
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::CommandCollectionChanged { before, after },
        );
    }
    Ok(())
}

fn advance_turn_boundary(
    state: &mut GameState,
    runtime: &mut RngRuntime,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    let before_turn = active_battle(state)?.turn;
    let before_rng = active_battle(state)?.battle_rng.clone();
    runtime.increment_turn()?;
    sync_rng_state(state, runtime)?;
    let after_turn = active_battle(state)?.battle_rng.turn;
    let after_rng = active_battle(state)?.battle_rng.clone();
    active_battle_mut(state)?.turn = after_turn;
    if before_rng != after_rng {
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::BattleRngChanged {
                before: before_rng,
                after: after_rng,
            },
        );
    }
    record_mutation(
        mutations,
        causal_events,
        BattleMutation::TurnAdvanced {
            before: before_turn,
            after: after_turn,
        },
    );
    Ok(())
}

fn sync_rng_state(state: &mut GameState, runtime: &RngRuntime) -> Result<(), BattleResolveError> {
    let battle_rng = runtime
        .battle_state()
        .cloned()
        .ok_or(RngError::MissingBattleState)?;
    state.run_rng = runtime.run_state();
    active_battle_mut(state)?.battle_rng = battle_rng;
    Ok(())
}

fn find_pokemon(
    state: &GameState,
    slot: FieldSlot,
    pokemon: PokemonId,
) -> Result<&PokemonState, BattleResolveError> {
    let battle = active_battle(state)?;
    party_for_side(battle, slot.side)
        .iter()
        .find(|candidate| candidate.id == pokemon)
        .ok_or(CommandLegalityError::ActorMismatch {
            slot,
            actor: pokemon,
        })
        .map_err(Into::into)
}

fn find_pokemon_mut(
    state: &mut GameState,
    slot: FieldSlot,
    pokemon: PokemonId,
) -> Result<&mut PokemonState, BattleResolveError> {
    let battle = active_battle_mut(state)?;
    party_for_side_mut(battle, slot.side)
        .iter_mut()
        .find(|candidate| candidate.id == pokemon)
        .ok_or(CommandLegalityError::ActorMismatch {
            slot,
            actor: pokemon,
        })
        .map_err(Into::into)
}

fn party_for_side(battle: &BattleState, side: BattleSide) -> &[PokemonState] {
    match side {
        BattleSide::Player => &battle.player_party,
        BattleSide::Enemy => &battle.enemy_party,
    }
}

fn party_for_side_mut(battle: &mut BattleState, side: BattleSide) -> &mut [PokemonState] {
    match side {
        BattleSide::Player => &mut battle.player_party,
        BattleSide::Enemy => &mut battle.enemy_party,
    }
}

fn active_battle(state: &GameState) -> Result<&BattleState, BattleResolveError> {
    state
        .battle
        .as_ref()
        .ok_or_else(|| CommandLegalityError::MissingBattle.into())
}

fn active_battle_mut(state: &mut GameState) -> Result<&mut BattleState, BattleResolveError> {
    state
        .battle
        .as_mut()
        .ok_or_else(|| CommandLegalityError::MissingBattle.into())
}

fn validate_after_state_trusted(
    state: &GameState,
    content: &ContentPack,
) -> Result<(), BattleResolveError> {
    match validate_state_content_trusted(state, content) {
        Ok(()) => Ok(()),
        Err(CommandLegalityError::State(source)) => {
            Err(BattleInvariantError::invalid_after_state(source).into())
        }
        Err(CommandLegalityError::UnsupportedCapability { subject }) => {
            Err(BattleInvariantError::UnsupportedEffectReached { subject }.into())
        }
        Err(CommandLegalityError::Content(source)) => Err(BattleResolveError::Content(source)),
        Err(source) => Err(BattleResolveError::Legality(source)),
    }
}

fn drain_internal_faint_heads(
    battle: &mut BattleState,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) -> Result<(), BattleResolveError> {
    loop {
        let Some(head) = unresolved_head(battle) else {
            return Ok(());
        };
        match head.replacement {
            ReplacementProgress::NotRequired => {
                let resolved =
                    resolve_not_required(battle, head.id).map_err(map_replacement_after_error)?;
                for mutation in resolved.mutations {
                    record_mutation(mutations, causal_events, mutation);
                }
            }
            ReplacementProgress::Pending | ReplacementProgress::NoLegalReplacement => {
                return Ok(());
            }
            ReplacementProgress::Selected { .. } => return Ok(()),
            ReplacementProgress::Applied => return Ok(()),
        }
    }
}

fn unresolved_head(battle: &BattleState) -> Option<FaintOccurrence> {
    battle
        .faint_queue
        .iter()
        .copied()
        .find(|entry| entry.replacement != ReplacementProgress::Applied)
}

fn update_outcome(
    battle: &mut BattleState,
    mutations: &mut Vec<BattleMutation>,
    causal_events: &mut Vec<PresentationCausalEvent>,
) {
    let before = battle.outcome;
    let after = derive_battle_outcome(battle);
    if before != after {
        battle.outcome = after;
        record_mutation(
            mutations,
            causal_events,
            BattleMutation::OutcomeChanged { before, after },
        );
    }
}

fn next_decision(battle: &BattleState, outcome: BattleOutcome) -> BattleNextDecision {
    if outcome != BattleOutcome::Ongoing {
        return BattleNextDecision::Complete(outcome);
    }
    if let Some(head) = unresolved_head(battle) {
        BattleNextDecision::Replacement {
            occurrence: head.id,
        }
    } else {
        BattleNextDecision::CommandFrontier
    }
}

fn map_state_error(source: StateValidationError, after_state: bool) -> BattleResolveError {
    if after_state {
        BattleInvariantError::invalid_after_state(source).into()
    } else {
        BattleInvariantError::invalid_before(source).into()
    }
}

/// The frozen public surface has no lower-level variant for these branches.
/// They are admitted-state contradictions, so they remain invariant failures
/// rather than being coerced into a successful or alternate gameplay path.
fn map_pipeline_contradiction(after_state: bool) -> BattleResolveError {
    map_state_error(
        StateValidationError::Command(BattleCommandError::AdmissionSourceMismatch),
        after_state,
    )
}

fn map_legality_command(source: BattleCommandError) -> BattleResolveError {
    BattleResolveError::Legality(CommandLegalityError::Command(source))
}

fn map_unsupported_effect(subject: CapabilitySubject) -> BattleResolveError {
    BattleInvariantError::UnsupportedEffectReached { subject }.into()
}

fn map_action_order_error(
    source: ActionOrderError,
    state: &GameState,
    after_state: bool,
) -> BattleResolveError {
    match source {
        ActionOrderError::MissingBattle => CommandLegalityError::MissingBattle.into(),
        ActionOrderError::State(source) => map_state_error(source, after_state),
        ActionOrderError::Content(source) => BattleResolveError::Content(source),
        ActionOrderError::Rng(source) => BattleResolveError::Rng(source),
        ActionOrderError::Unsupported(reason) => match reason {
            UnsupportedOrdering::ArenaCondition => {
                if let Some(subject) = arena_condition_subject(state) {
                    map_unsupported_effect(subject)
                } else {
                    map_pipeline_contradiction(after_state)
                }
            }
            UnsupportedOrdering::TrickRoom
            | UnsupportedOrdering::ExplicitSetOrder
            | UnsupportedOrdering::PursuitInterception
            | UnsupportedOrdering::SelfSwitchingMove => map_pipeline_contradiction(after_state),
        },
        ActionOrderError::CommandCountMismatch { .. }
        | ActionOrderError::UnexpectedCommand { .. }
        | ActionOrderError::DuplicateCommand { .. }
        | ActionOrderError::SwitchDestinationMismatch { .. }
        | ActionOrderError::SwitchDestinationFainted { .. }
        | ActionOrderError::MoveIdentityMismatch { .. } => {
            CommandLegalityError::CommandSetMismatch.into()
        }
        ActionOrderError::MissingCommand { .. } => {
            CommandLegalityError::IncompleteCommandFrontier.into()
        }
        ActionOrderError::ActorMismatch { slot, actor } => {
            CommandLegalityError::ActorMismatch { slot, actor }.into()
        }
        ActionOrderError::UnknownActor { actor } => {
            CommandLegalityError::NoLegalCommand { actor }.into()
        }
        ActionOrderError::FaintedActor { actor } => {
            CommandLegalityError::ActorFainted { actor }.into()
        }
        ActionOrderError::MissingMoveSlot { actor, .. }
        | ActionOrderError::InvalidSpeedStage { actor, .. }
        | ActionOrderError::SpeedOverflow { actor } => {
            CommandLegalityError::NoLegalCommand { actor }.into()
        }
        ActionOrderError::UnsupportedMove { move_id } => {
            map_unsupported_effect(CapabilitySubject::Move(move_id))
        }
        ActionOrderError::UnsupportedSpeedStatus { status, .. } => {
            map_unsupported_effect(CapabilitySubject::Status(status))
        }
        ActionOrderError::TieOrderOverflow => map_pipeline_contradiction(after_state),
    }
}

fn arena_condition_subject(state: &GameState) -> Option<CapabilitySubject> {
    state
        .battle
        .as_ref()?
        .arena_conditions
        .first()
        .map(|condition| CapabilitySubject::ArenaCondition(condition.condition.clone()))
}

fn map_faint_input_error(source: FaintQueueError) -> BattleResolveError {
    match source {
        FaintQueueError::ZeroAuthorityEpoch => {
            map_legality_command(BattleCommandError::OperationGrammarMismatch {
                context: "turn result",
            })
        }
        source => map_faint_error(source),
    }
}

fn map_faint_error(source: FaintQueueError) -> BattleResolveError {
    match source {
        FaintQueueError::InvalidField { source } => {
            map_state_error(StateValidationError::Field(source), true)
        }
        FaintQueueError::InvalidSlot { source, .. } => {
            map_state_error(StateValidationError::Format(source), true)
        }
        FaintQueueError::CandidateActorMismatch { slot, pokemon } => map_state_error(
            StateValidationError::CommandActorMismatch {
                slot,
                actor: pokemon,
            },
            true,
        ),
        FaintQueueError::CandidatePartyDuplicate { pokemon } => {
            map_state_error(StateValidationError::DuplicatePokemonId { pokemon }, true)
        }
        FaintQueueError::CandidateOwnerMismatch {
            pokemon,
            actual,
            expected,
        } => match (expected, actual) {
            (Some(_), actual) => map_state_error(
                StateValidationError::InvalidPlayerOwner {
                    pokemon,
                    owner: actual,
                },
                true,
            ),
            (None, Some(owner)) => {
                map_state_error(StateValidationError::EnemyHasOwner { pokemon, owner }, true)
            }
            (None, None) => map_pipeline_contradiction(true),
        },
        FaintQueueError::CandidateAlreadyQueued { slot, pokemon } => map_state_error(
            StateValidationError::DuplicateUnresolvedFaint { slot, pokemon },
            true,
        ),
        FaintQueueError::DuplicateQueueOccurrence { id } => {
            map_state_error(StateValidationError::DuplicateFaintOccurrence { id }, true)
        }
        FaintQueueError::DuplicateQueueSubject { slot, pokemon } => map_state_error(
            StateValidationError::DuplicateUnresolvedFaint { slot, pokemon },
            true,
        ),
        FaintQueueError::QueueAllocatorMismatch { id, next } => map_state_error(
            StateValidationError::FaintAllocatorMismatch { id, next },
            true,
        ),
        FaintQueueError::NonCausalQueue => {
            map_state_error(StateValidationError::NonCausalFaintQueue, true)
        }
        FaintQueueError::InvalidStoredOccurrence { id } => {
            map_state_error(StateValidationError::FaintCoordinateMismatch { id }, true)
        }
        FaintQueueError::CandidateSlotMissing { .. }
        | FaintQueueError::CandidateSlotEmpty { .. }
        | FaintQueueError::CandidatePartyMissing { .. }
        | FaintQueueError::CandidateHpNonZero { .. }
        | FaintQueueError::CandidateNotFainted { .. }
        | FaintQueueError::OccurrenceAllocatorExhausted { .. }
        | FaintQueueError::TurnOccurrenceOverflow
        | FaintQueueError::SourceCoordinateMismatch { .. }
        | FaintQueueError::ZeroAuthorityEpoch => map_pipeline_contradiction(true),
    }
}

fn map_switch_error(source: SwitchError) -> BattleResolveError {
    match source {
        SwitchError::NotSwitchCommand => map_pipeline_contradiction(true),
        SwitchError::InvalidSourceTopology { source, .. } => {
            map_state_error(StateValidationError::Format(source), true)
        }
        SwitchError::InvalidField { source } => {
            map_state_error(StateValidationError::Field(source), true)
        }
        SwitchError::SourceSlotMissing { .. } => CommandLegalityError::CommandSetMismatch.into(),
        SwitchError::SourceSlotEmpty { slot } => {
            CommandLegalityError::EmptyFieldSlot { slot }.into()
        }
        SwitchError::ActorMismatch { slot, actor, .. } => {
            CommandLegalityError::ActorMismatch { slot, actor }.into()
        }
        SwitchError::ActiveActorMissing { .. } => map_pipeline_contradiction(true),
        SwitchError::ActiveOwnerMismatch {
            slot,
            actor,
            expected,
            actual,
        } => map_state_error(
            StateValidationError::FieldOwnerMismatch {
                slot,
                pokemon: actor,
                expected,
                actual,
            },
            true,
        ),
        SwitchError::ActiveActorFainted { actor } => {
            CommandLegalityError::ActorFainted { actor }.into()
        }
        SwitchError::IncomingPartySlotMissing { .. }
        | SwitchError::IncomingPartyIdentityMismatch { .. }
        | SwitchError::IncomingFainted { .. }
        | SwitchError::IncomingAlreadyOnField { .. } => {
            CommandLegalityError::CommandSetMismatch.into()
        }
        SwitchError::IncomingOwnerMismatch {
            slot,
            incoming,
            expected,
            actual,
        } => map_state_error(
            StateValidationError::FieldOwnerMismatch {
                slot,
                pokemon: incoming,
                expected,
                actual,
            },
            true,
        ),
    }
}

fn map_ability_pipeline_error(
    source: AbilityPipelineError,
    subject: Option<CapabilitySubject>,
) -> BattleResolveError {
    match source {
        AbilityPipelineError::Ability(source) => map_ability_error(source),
        AbilityPipelineError::Format(source) => {
            map_state_error(StateValidationError::Format(source), true)
        }
        AbilityPipelineError::Field(source) => {
            map_state_error(StateValidationError::Field(source), true)
        }
        AbilityPipelineError::MissingSourceOccupant { slot }
        | AbilityPipelineError::MissingDefensiveTarget { slot } => {
            CommandLegalityError::EmptyFieldSlot { slot }.into()
        }
        AbilityPipelineError::MissingPartyPokemon { slot, pokemon, .. } => map_state_error(
            StateValidationError::MissingFieldOccupant { slot, pokemon },
            true,
        ),
        AbilityPipelineError::UnsupportedSuppression { .. } => subject
            .map(map_unsupported_effect)
            .unwrap_or_else(|| map_pipeline_contradiction(true)),
        AbilityPipelineError::NativeTypeImmunityTerminal { .. } => map_pipeline_contradiction(true),
    }
}

fn map_ability_error(source: AbilityError) -> BattleResolveError {
    match source {
        AbilityError::InvalidContentPack { source } => BattleResolveError::Content(source),
        AbilityError::UnsupportedContent { ability_id, .. } => {
            map_unsupported_effect(CapabilitySubject::Ability(ability_id))
        }
    }
}

fn switch_ability_subject(state: &GameState, action: &PendingAction) -> Option<CapabilitySubject> {
    let NormalizedBattleCommand::Switch { field_slot, .. } = &action.command else {
        return None;
    };
    let incoming = action.incoming?;
    let battle = state.battle.as_ref()?;
    party_for_side(battle, field_slot.side)
        .iter()
        .find(|pokemon| pokemon.id == incoming)
        .map(|pokemon| CapabilitySubject::Ability(pokemon.abilities.active))
}

fn slot_ability_subject(state: &GameState, slot: FieldSlot) -> Option<CapabilitySubject> {
    let battle = state.battle.as_ref()?;
    let pokemon_id = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == slot)
        .and_then(|entry| entry.occupant)?;
    party_for_side(battle, slot.side)
        .iter()
        .find(|pokemon| pokemon.id == pokemon_id)
        .map(|pokemon| CapabilitySubject::Ability(pokemon.abilities.active))
}

fn move_target_ability_subject(
    state: &GameState,
    action: &PendingAction,
) -> Option<CapabilitySubject> {
    let battle = state.battle.as_ref()?;
    action.targets.iter().find_map(|slot| {
        let pokemon_id = battle
            .field
            .slots
            .iter()
            .find(|entry| entry.slot == *slot)
            .and_then(|entry| entry.occupant)?;
        party_for_side(battle, slot.side)
            .iter()
            .find(|pokemon| pokemon.id == pokemon_id)
            .map(|pokemon| CapabilitySubject::Ability(pokemon.abilities.active))
    })
}

fn move_actor_status(state: &GameState, action: &PendingAction) -> Option<StatusKind> {
    let battle = state.battle.as_ref()?;
    party_for_side(battle, action.source_slot.side)
        .iter()
        .find(|pokemon| pokemon.id == action.actor)
        .map(|pokemon| pokemon.status.kind)
}

fn map_move_pipeline_error(
    source: MovePipelineError,
    state: &GameState,
    action: &PendingAction,
) -> BattleResolveError {
    let move_id = action.move_id;
    match source {
        MovePipelineError::Content(source) => BattleResolveError::Content(source),
        MovePipelineError::WrongCommandKind(_) => map_pipeline_contradiction(true),
        MovePipelineError::MissingActorState { actor, slot } => map_state_error(
            StateValidationError::MissingFieldOccupant {
                slot,
                pokemon: actor,
            },
            true,
        ),
        MovePipelineError::MissingTargetState { pokemon, slot } => map_state_error(
            StateValidationError::MissingFieldOccupant { slot, pokemon },
            true,
        ),
        MovePipelineError::MissingMoveSlot { actor, .. }
        | MovePipelineError::MoveIdentityMismatch { actor, .. } => {
            CommandLegalityError::NoLegalCommand { actor }.into()
        }
        MovePipelineError::UnsupportedMove { move_id } => {
            map_unsupported_effect(CapabilitySubject::Move(move_id))
        }
        MovePipelineError::InvalidPp {
            actor,
            move_slot,
            source,
            ..
        } => CommandLegalityError::InvalidPp {
            pokemon: actor,
            move_slot: usize::from(move_slot.get()),
            source,
        }
        .into(),
        MovePipelineError::PpUnavailable { actor, .. } => {
            CommandLegalityError::NoLegalCommand { actor }.into()
        }
        MovePipelineError::PpOverflow { .. } => map_pipeline_contradiction(true),
        MovePipelineError::TargetSelection(source) => map_target_selection_error(source),
        MovePipelineError::Paralysis(source) => {
            map_status_error(source, move_actor_status(state, action), move_id, true)
        }
        MovePipelineError::Effect(source) => map_move_effect_error(source, state, action, move_id),
    }
}

fn map_target_selection_error(source: TargetSelectionError) -> BattleResolveError {
    match source {
        TargetSelectionError::Empty | TargetSelectionError::AllEnemiesCount => {
            map_legality_command(BattleCommandError::EmptyTargetSelection)
        }
        TargetSelectionError::Duplicate { .. } => {
            map_legality_command(BattleCommandError::DuplicateTargetSelection)
        }
        TargetSelectionError::NonCanonicalOrder => {
            map_legality_command(BattleCommandError::UnsortedTargetSelection)
        }
        TargetSelectionError::NearOtherCount
        | TargetSelectionError::NearOtherNotCanonical { .. }
        | TargetSelectionError::SlotOutsideCapacity { .. }
        | TargetSelectionError::SameSide { .. }
        | TargetSelectionError::AllEnemiesNotCanonical
        | TargetSelectionError::UnsupportedTarget { .. } => {
            map_legality_command(BattleCommandError::AdmissionSourceMismatch)
        }
    }
}

fn map_move_effect_error(
    source: MoveEffectError,
    state: &GameState,
    action: &PendingAction,
    move_id: Option<MoveId>,
) -> BattleResolveError {
    match source {
        MoveEffectError::Content(source) => BattleResolveError::Content(source),
        MoveEffectError::InvalidMoveDefinition { source, .. } => map_move_definition_error(source),
        MoveEffectError::UnsupportedEffect { move_id, .. }
        | MoveEffectError::UnsupportedEffectChance { move_id, .. } => {
            map_unsupported_effect(CapabilitySubject::Move(move_id))
        }
        MoveEffectError::MissingDamagePower { .. }
        | MoveEffectError::InvalidDamageCategory { .. }
        | MoveEffectError::EmptyTargetSet
        | MoveEffectError::HpDamageOverflow { .. } => map_pipeline_contradiction(true),
        MoveEffectError::TypeEffectiveness(source) => map_type_effectiveness_error(source, move_id),
        MoveEffectError::DefensiveAbility(source) => {
            map_defensive_gate_error(source, state, action, move_id)
        }
        MoveEffectError::Accuracy(source) => map_accuracy_error(source, move_id),
        MoveEffectError::Critical(source) => map_critical_error(source, move_id),
        MoveEffectError::Damage(source) => map_damage_error(source),
        MoveEffectError::Status(source) => {
            map_status_error(source, move_actor_status(state, action), move_id, true)
        }
        MoveEffectError::StatStage(source) => map_stat_stage_error(source, true),
        MoveEffectError::SecondaryEffectRng(source) => BattleResolveError::Rng(source),
    }
}

fn map_move_definition_error(source: MoveDefinitionError) -> BattleResolveError {
    match source {
        MoveDefinitionError::UnsupportedId { id }
        | MoveDefinitionError::UnsupportedCapability { id }
        | MoveDefinitionError::UnsupportedEffect { id, .. } => {
            map_unsupported_effect(CapabilitySubject::Move(id))
        }
        MoveDefinitionError::UnsupportedStatus { status, .. } => {
            map_unsupported_effect(CapabilitySubject::Status(status))
        }
        MoveDefinitionError::InvalidBasePp { .. }
        | MoveDefinitionError::InvalidPower { .. }
        | MoveDefinitionError::InvalidAccuracy { .. }
        | MoveDefinitionError::InvalidEffectChance { .. }
        | MoveDefinitionError::StatusMoveHasPower { .. }
        | MoveDefinitionError::DamagingMoveHasNoPower { .. }
        | MoveDefinitionError::DamagingMoveHasNoDamageEffect { .. }
        | MoveDefinitionError::StatusMoveHasDamageEffect { .. }
        | MoveDefinitionError::EmptyEffectList { .. }
        | MoveDefinitionError::DuplicateFlag { .. }
        | MoveDefinitionError::DuplicateEffect { .. }
        | MoveDefinitionError::DefinitionMismatch { .. } => map_pipeline_contradiction(true),
    }
}

fn map_type_effectiveness_error(
    source: TypeEffectivenessError,
    move_id: Option<MoveId>,
) -> BattleResolveError {
    match source {
        TypeEffectivenessError::UnsupportedAttackType { .. } => move_id
            .map(|move_id| map_unsupported_effect(CapabilitySubject::Move(move_id)))
            .unwrap_or_else(|| map_pipeline_contradiction(true)),
        TypeEffectivenessError::InvalidChart { .. }
        | TypeEffectivenessError::InvalidDefenderTyping { .. }
        | TypeEffectivenessError::CompositionOutOfRange { .. } => map_pipeline_contradiction(true),
    }
}

fn map_defensive_gate_error(
    source: DefensiveAbilityGateError,
    state: &GameState,
    action: &PendingAction,
    move_id: Option<MoveId>,
) -> BattleResolveError {
    match source {
        DefensiveAbilityGateError::Unsupported { .. } => move_target_ability_subject(state, action)
            .or_else(|| move_id.map(CapabilitySubject::Move))
            .map(map_unsupported_effect)
            .unwrap_or_else(|| map_pipeline_contradiction(true)),
        DefensiveAbilityGateError::InvalidContext => map_pipeline_contradiction(true),
    }
}

fn map_accuracy_error(source: AccuracyError, move_id: Option<MoveId>) -> BattleResolveError {
    match source {
        AccuracyError::InvalidContext(_)
        | AccuracyError::InvalidDraw { .. }
        | AccuracyError::RangeOverflow { .. } => map_pipeline_contradiction(true),
        AccuracyError::Unsupported { .. } => move_id
            .map(|move_id| map_unsupported_effect(CapabilitySubject::Move(move_id)))
            .unwrap_or_else(|| map_pipeline_contradiction(true)),
        AccuracyError::Rng(source) => BattleResolveError::Rng(source),
    }
}

fn map_critical_error(source: CriticalError, move_id: Option<MoveId>) -> BattleResolveError {
    match source {
        CriticalError::InvalidContext(_)
        | CriticalError::InvalidDraw { .. }
        | CriticalError::RangeOverflow { .. } => map_pipeline_contradiction(true),
        CriticalError::Unsupported { .. } => move_id
            .map(|move_id| map_unsupported_effect(CapabilitySubject::Move(move_id)))
            .unwrap_or_else(|| map_pipeline_contradiction(true)),
        CriticalError::Rng(source) => BattleResolveError::Rng(source),
    }
}

fn map_damage_error(source: DamageError) -> BattleResolveError {
    match source {
        DamageError::InvalidLevel
        | DamageError::StatusCategory
        | DamageError::InvalidPower
        | DamageError::InvalidOffensiveStat
        | DamageError::InvalidDefensiveStat
        | DamageError::InvalidPositiveMultiplier { .. }
        | DamageError::InvalidNonNegativeMultiplier { .. }
        | DamageError::NonFiniteArithmetic
        | DamageError::InvalidDamageInteger
        | DamageError::InvalidVarianceRange
        | DamageError::JsMath(_) => map_pipeline_contradiction(true),
        DamageError::Rng(source) => BattleResolveError::Rng(source),
    }
}

fn map_stat_stage_error(source: StatStageError, after_state: bool) -> BattleResolveError {
    match source {
        StatStageError::UnsupportedStatus { status } => {
            map_unsupported_effect(CapabilitySubject::Status(status))
        }
        StatStageError::NonFiniteValue
        | StatStageError::EffectiveStatOverflow
        | StatStageError::UnsupportedStat { .. } => map_pipeline_contradiction(after_state),
    }
}

fn map_status_error(
    source: StatusError,
    fallback_status: Option<StatusKind>,
    move_id: Option<MoveId>,
    after_state: bool,
) -> BattleResolveError {
    match source {
        StatusError::UnsupportedStatus { status } => {
            map_unsupported_effect(CapabilitySubject::Status(status))
        }
        StatusError::UnsupportedBypass { .. } => fallback_status
            .map(|status| map_unsupported_effect(CapabilitySubject::Status(status)))
            .or_else(|| {
                move_id.map(|move_id| map_unsupported_effect(CapabilitySubject::Move(move_id)))
            })
            .unwrap_or_else(|| map_pipeline_contradiction(after_state)),
        StatusError::InvalidStatusState { .. }
        | StatusError::InvalidMaxHp
        | StatusError::InvalidHp
        | StatusError::InvalidChance { .. }
        | StatusError::TurnCountOverflow
        | StatusError::SafeInteger(_) => map_pipeline_contradiction(after_state),
        StatusError::Rng(source) => BattleResolveError::Rng(source),
    }
}

fn map_replacement_after_error(source: ReplacementError) -> BattleResolveError {
    map_replacement_error(source, true)
}

fn map_replacement_error(source: ReplacementError, after_state: bool) -> BattleResolveError {
    match source {
        ReplacementError::InvalidField { source } => {
            map_state_error(StateValidationError::Field(source), after_state)
        }
        ReplacementError::InvalidSlot { source, .. } => {
            map_state_error(StateValidationError::Format(source), after_state)
        }
        ReplacementError::NoUnresolvedOccurrence => CommandLegalityError::UnresolvedFaint.into(),
        ReplacementError::NotQueueHead { requested, .. } => {
            CommandLegalityError::ReplacementNotCurrent {
                occurrence: requested,
            }
            .into()
        }
        ReplacementError::ReplacementNotRequired { occurrence } => {
            CommandLegalityError::ReplacementNotRequired { occurrence }.into()
        }
        ReplacementError::ProgressNotPending { occurrence, .. } => {
            CommandLegalityError::ReplacementNotCurrent { occurrence }.into()
        }
        ReplacementError::InvalidStoredProgress { occurrence } => map_state_error(
            StateValidationError::InvalidReplacementProgress { id: occurrence },
            after_state,
        ),
        ReplacementError::StoredFieldMismatch { occurrence } => map_state_error(
            StateValidationError::DetachedFaintOccurrence { id: occurrence },
            after_state,
        ),
        ReplacementError::StoredPartyMissing { occurrence }
        | ReplacementError::StoredPartyDuplicate { occurrence }
        | ReplacementError::StoredActorNotFainted { occurrence } => map_state_error(
            StateValidationError::InvalidFaintPokemon { id: occurrence },
            after_state,
        ),
        ReplacementError::StoredOwnerMismatch { occurrence } => map_state_error(
            StateValidationError::FaintOwnerMismatch { id: occurrence },
            after_state,
        ),
        ReplacementError::CandidatePartySlotMissing { .. }
        | ReplacementError::CandidatePartyIdentityMismatch { .. }
        | ReplacementError::CandidateOwnerMismatch { .. }
        | ReplacementError::CandidateNotLiving { .. }
        | ReplacementError::CandidateAlreadyOnField { .. }
        | ReplacementError::CandidatePartyDuplicate { .. } => {
            if after_state {
                map_pipeline_contradiction(true)
            } else {
                CommandLegalityError::CommandSetMismatch.into()
            }
        }
        ReplacementError::LegalReplacementExists => {
            if after_state {
                map_pipeline_contradiction(true)
            } else {
                CommandLegalityError::LegalReplacementExists.into()
            }
        }
        ReplacementError::NoLegalReplacementExternal => {
            if after_state {
                map_pipeline_contradiction(true)
            } else {
                map_legality_command(BattleCommandError::NoLegalReplacementProposal)
            }
        }
        ReplacementError::MissingOwner => {
            if after_state {
                map_pipeline_contradiction(true)
            } else {
                map_legality_command(BattleCommandError::OperationGrammarMismatch {
                    context: "replacement",
                })
            }
        }
        ReplacementError::Operation(source) => CommandLegalityError::Command(source).into(),
        ReplacementError::PartyIndexInvariant { index } => {
            CommandLegalityError::SlotIndexInvariant { index }.into()
        }
        ReplacementError::StoredSourceCoordinateMismatch { occurrence } => map_state_error(
            StateValidationError::FaintCoordinateMismatch { id: occurrence },
            after_state,
        ),
    }
}
